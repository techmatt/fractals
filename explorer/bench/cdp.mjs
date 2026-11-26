// A headless Chrome on the other end of a websocket, and nothing installed to get there.
//
// Node has `WebSocket` in the global scope, unflagged since 22.0 and stable since 22.4, so
// CI's node 22 has it as a local node 24 does; Chrome speaks CDP over one, so a
// browser-driven harness in this repository needs no `node_modules` — which is the only
// reason there is one in `bench/` at all. The three kernel harnesses beside this file
// answer "what does the arithmetic cost"; a pool, a cancel and a canvas upload only exist
// in a browser, and this is how they are reached.
//
// Deliberately small: launch, send, evaluate, screenshot, close. Everything that knows
// what the explorer is lives in `page.mjs`.

import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Where Chrome is on this machine, unless `CHROME` says otherwise. */
const CHROME = process.env.CHROME ?? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Launch Chrome on a throwaway profile and attach to its first page.
 *
 * A throwaway profile per run because the explorer keeps a Saved list in `localStorage`
 * and a cold-load measurement is only cold on a browser that has not been here before.
 * `flags` are extra Chrome switches, for a harness that needs one.
 *
 * `port` 0 (the default) lets Chrome pick a free debugging port, read back from the
 * profile's `DevToolsActivePort`, so two harnesses at once never share one. A harness
 * that names a port gets that port, refused if another Chrome already holds it.
 */
export async function open({ port = 0, width = 1600, height = 1000, headless = true, flags = [] } = {}) {
  // A second Chrome on a port already held cannot listen there, so the poll below would
  // find the first one's page and drive it: two runs of one harness would press each
  // other's buttons and save each other's downloads (015). Refused instead.
  if (port !== 0) {
    try {
      await fetch(`http://localhost:${port}/json/version`);
      throw new Error(`port ${port} already has a Chrome debugging on it (another run of this harness?): pass a free port`);
    } catch (error) {
      if (error.message.startsWith(`port ${port}`)) throw error;
      // Nothing listening: the port is free.
    }
  }
  const profile = mkdtempSync(join(tmpdir(), "explorer-bench-"));
  const args = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    "--no-first-run",
    "--no-default-browser-check",
    // The harness measures the page, so nothing else on the machine's behalf: no
    // background fetching, no crash reporter, no first-run network round trips.
    "--disable-background-networking",
    "--disable-features=Translate,MediaRouter",
    `--window-size=${width},${height}`,
    ...flags,
    "about:blank",
  ];
  if (headless) args.unshift("--headless=new");
  const chrome = spawn(CHROME, args, { stdio: "ignore" });
  // A harness that dies on an error without reaching `close` still takes its Chrome with
  // it, so the next run does not find a stray one (015 left one holding its port).
  const kill = () => chrome.kill();
  process.once("exit", kill);

  let target = null;
  for (let tries = 0; tries < 80 && target === null; tries++) {
    await sleep(150);
    try {
      // Chrome writes the port it chose on the first line, once it is listening.
      if (port === 0) port = Number(readFileSync(join(profile, "DevToolsActivePort"), "utf8").split("\n")[0]);
      // `localhost`, not 127.0.0.1: Chrome on this machine sometimes listens on [::1] only.
      const listed = await (await fetch(`http://localhost:${port}/json/list`)).json();
      target = listed.find((entry) => entry.type === "page") ?? null;
    } catch {
      // Chrome is not listening yet.
    }
  }
  if (target === null) {
    kill();
    throw new Error("Chrome did not come up on the debugging port");
  }

  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });

  let next = 0;
  const pending = new Map();
  const listeners = [];
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id !== undefined && pending.has(message.id)) {
      const [resolve, reject] = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(`${message.error.message} (${message.error.code})`));
      else resolve(message.result);
      return;
    }
    for (const listener of listeners) listener(message);
  });

  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++next;
      pending.set(id, [resolve, reject]);
      socket.send(JSON.stringify({ id, method, params }));
    });

  /** Evaluate an expression in the page and get its value back, awaiting a promise. */
  const evaluate = async (expression) => {
    const answer = await send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
      // So the harness may click a button and dispatch a key: both are gestures the page
      // is allowed to refuse without one.
      userGesture: true,
    });
    if (answer.exceptionDetails) {
      throw new Error(answer.exceptionDetails.exception?.description ?? "evaluate threw");
    }
    return answer.result?.value;
  };

  /** Poll `expression` until it is truthy, and give up after `within` milliseconds. */
  const until = async (expression, { within = 120000, every = 25 } = {}) => {
    const deadline = Date.now() + within;
    for (;;) {
      if (await evaluate(expression)) return true;
      if (Date.now() > deadline) return false;
      await sleep(every);
    }
  };

  const on = (listener) => {
    listeners.push(listener);
    return () => listeners.splice(listeners.indexOf(listener), 1);
  };

  const close = async () => {
    try {
      socket.close();
    } catch {
      // Already gone.
    }
    process.off("exit", kill);
    kill();
    await sleep(300);
    try {
      rmSync(profile, { recursive: true, force: true });
    } catch {
      // Windows holds a lock on a profile for a moment after the process ends; a
      // leftover temp directory is not worth failing a measurement over.
    }
  };

  await send("Page.enable");
  await send("Runtime.enable");
  return { send, evaluate, until, on, close, profile, port };
}
