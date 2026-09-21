// The bug hunt's shared harness: a headless Chrome over raw CDP, with a witness log and a
// watchdog.
//
//   python -m builder serve                    # in another terminal; PORT= moves it
//   node explorer/bench/hunt/smoke.mjs         # the harness's own self-test
//   node explorer/bench/hunt/u1-links.mjs      # one unit; u1..u8 are the hunt itself
//   node explorer/bench/hunt/probe-oom.mjs     # a probe: one question, one measurement
//
// It began in `scratch/`, which does not survive a wipe, and moved here whole
// *(pre_closeout_ckpt138, 2026-09-20)* — the same trip `kernel.mjs`, `modes.mjs`,
// `sweep.mjs`, `cut.mjs` and `level.mjs` each made before it. The one-shot probes that
// confirmed a finding now fixed did not come: what is here is what a next hunt runs again.
//
// **This is a second CDP client and that is deliberate.** `bench/cdp.mjs` is one directory
// up and is not this: its `send` has no timeout, its `evaluate` throws, it captures no
// console and answers no dialog. A bench harness times a page that works, and its runs set
// patiences of three and four hundred seconds on purpose; a hunt is looking for a page that
// does not work, where **a hang is itself a finding** and an unexplained console line is
// another. Giving `cdp.mjs` a watchdog would start throwing under `page.mjs` and `walk.mjs`;
// taking this one's away would cost the hunt its two best instruments. The honest shared
// surface is `sleep` and the wait-for-a-target loop, which is not worth a third file.
// `bench/engine.mjs` and `bench/perturb.mjs` open the same way, saying what they are not.
//
// **And the units here assert, where nothing else in `bench/` does.** Each records a
// `findings` list beside its rows, in `artifacts/explorer-bench/`. They still exit zero and
// `builder check` still runs none of them: what they produce is a report somebody reads.
//
// Four ways it differs from the acceptance run it was extracted from, each of which cost
// somebody a run:
//
//  * `open()` waits for the studio **or** the notice. An acceptance run waits only for the
//    studio, so every refusal costs it its whole 40 s timeout — unaffordable when a fuzz
//    unit sends hundreds of them.
//  * `refused()` is the refusal predicate written once: the notice visible, the studio
//    hidden, and the dot on `stopped`. The dot is part of it. A harness that watched the
//    dot and the stat line instead of the notice read a refusal as a silent hang, which
//    cost `explorer_shade_pool_ckpt136` two runs (see `refuse()` in `explorer.js`).
//  * the witness log takes console errors and warnings, thrown exceptions, unhandled
//    rejections and `Log.entryAdded` — the last for what the console API never sees, a 404
//    among them — and filters an allowlist of *explained* warnings, so what surfaces is
//    what nobody has accounted for.
//  * every evaluate is on a watchdog. A call that does not answer is itself a finding, and
//    the page is torn down and respawned rather than the run stalling on the bug it found.
//
// **Eight things that looked like findings and were not**, kept because each cost a
// verification and a next hunt would pay for them again:
//
//  * the boot notice read as a refusal — `index.html` ships it *visible*, so a harness that
//    reads notice-up-studio-down as refused calls every slow load refused. `open()` excludes
//    the boot sentence by name for exactly this.
//  * `window.confirm` blocking every evaluate read as a hang. The Saved panel asks before
//    Clear all and before a destructive import; dialogs are accepted and recorded here.
//  * 967 lazy gallery tiles with no `src` read as broken images.
//  * gallery tiles read as anchors, where they are buttons.
//  * the Saved panel's sentences read off `#status`; it speaks in `#saved-progress`.
//  * a wheel storm read as a hang, when its final pass genuinely costs 17.6 s.
//  * Download all read as never finishing, when Chrome had silently overwritten a
//    same-name zip from the run before.
//  * "Whole Julia set" read as broken, where it is deliberately disabled at a plane's home.
//
// ⚠ **And one contamination, which is why runs are serial.** The first link fuzz ran four
// browsers against one `builder serve` and got `ERR_CONNECTION_REFUSED` on the gallery's
// tile flood — which drew the home view under someone else's link and looked exactly like a
// wrong-picture bug. Three such refusals survive even in a clean re-run: that is a capacity
// limit of the dev server, not of the site.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const CHROME =
  process.env.CHROME ?? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
export const EDGE =
  process.env.EDGE ?? "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
/** The `builder serve` every unit talks to. One port for the whole harness: the old
 *  spread across 8011-8014 was four servers at once, and the note above is why that is
 *  not the plan any more. `PORT=8014 node explorer/bench/hunt/u1-links.mjs`. */
export const SITE = Number(process.env.PORT ?? 8000);

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Warnings this page is entitled to emit, and why. Anything else is a finding. */
const EXPLAINED = [
  /a dropped file could not be read/, // explorer.js: a file with nothing of ours in it.
  // The browser asks every origin for this unbidden and the site ships none. Filtered
  // so it does not drown every unit; it is in the report as its own small finding.
  /favicon\.ico/,
];

/** A page under the harness: the browser, the connection, and the witness log. */
export class Page {
  constructor({ port = SITE, debug = 9400, browser = CHROME, width = 1600, height = 1100 } = {}) {
    this.port = port;
    this.debug = debug;
    this.browser = browser;
    this.width = width;
    this.height = height;
    this.logs = [];
    this.hangs = [];
    this.id = 0;
    this.pend = new Map();
    this.dead = false;
    this.dialogs = [];
    this.acceptDialogs = true;
  }

  async start() {
    this.profile = mkdtempSync(join(tmpdir(), "hunt-"));
    this.proc = spawn(this.browser, [
      "--headless=new",
      `--remote-debugging-port=${this.debug}`,
      `--user-data-dir=${this.profile}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--hide-scrollbars",
      "--disable-features=Translate,MediaRouter",
      "about:blank",
    ]);
    let target;
    for (let i = 0; i < 100 && !target; i++) {
      await sleep(200);
      try {
        const list = await (await fetch(`http://127.0.0.1:${this.debug}/json`)).json();
        target = list.find((t) => t.type === "page");
      } catch {}
    }
    if (!target) throw new Error(`no CDP target on ${this.debug}`);
    this.ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((r) => this.ws.addEventListener("open", r));
    this.ws.addEventListener("message", (e) => this.#heard(JSON.parse(e.data)));
    await this.send("Runtime.enable");
    await this.send("Page.enable");
    await this.send("Log.enable");
    // Without this, `Performance.getMetrics` answers with the two page-lifetime
    // counters and no heap at all, which reads as a harness that works.
    await this.send("Performance.enable");
    // **A native dialog blocks every evaluate until somebody answers it.** The Saved
    // panel asks `window.confirm` before Clear all and before a destructive import, and
    // an unanswered one made the watchdog call the page hung. Accepting by default is
    // what a reader does; `this.dialogs` records each so a unit can assert it was asked.
    this.dialogs = [];
    await this.send("Emulation.setDeviceMetricsOverride", {
      width: this.width, height: this.height, deviceScaleFactor: 1, mobile: false,
    });
    return this;
  }

  #note(line) {
    if (EXPLAINED.some((re) => re.test(line))) return;
    this.logs.push(line);
  }

  #heard(m) {
    if (m.id && this.pend.has(m.id)) {
      this.pend.get(m.id)(m);
      this.pend.delete(m.id);
      return;
    }
    if (m.method === "Runtime.consoleAPICalled" && ["error", "warning"].includes(m.params.type)) {
      const said = m.params.args
        .map((a) => a.value ?? a.description ?? a.preview?.description ?? a.type)
        .join(" ");
      this.#note(`${m.params.type}: ${said}`);
    }
    if (m.method === "Runtime.exceptionThrown") {
      const d = m.params.exceptionDetails;
      this.#note(`exception: ${d.exception?.description ?? d.text}`);
    }
    if (m.method === "Page.javascriptDialogOpening") {
      this.dialogs.push({ type: m.params.type, said: m.params.message.slice(0, 200) });
      this.send("Page.handleJavaScriptDialog", { accept: this.acceptDialogs !== false }).catch(() => {});
    }
    if (m.method === "Log.entryAdded" && ["error", "warning"].includes(m.params.entry.level)) {
      const e = m.params.entry;
      this.#note(`log(${e.source}/${e.level}): ${e.text}${e.url ? ` [${e.url}]` : ""}`);
    }
  }

  /** A CDP call on a watchdog: no answer inside `timeout` is a hang, recorded and thrown. */
  send(method, params = {}, timeout = 30000) {
    if (this.dead) return Promise.reject(new Error("page is dead"));
    const n = ++this.id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pend.delete(n);
        this.dead = true;
        const where = `${method} ${JSON.stringify(params).slice(0, 160)}`;
        this.hangs.push(where);
        reject(new Error(`HANG after ${timeout}ms: ${where}`));
      }, timeout);
      this.pend.set(n, (m) => {
        clearTimeout(timer);
        resolve(m);
      });
      this.ws.send(JSON.stringify({ id: n, method, params }));
    });
  }

  /** Evaluate in the page. A thrown expression comes back as `{ THREW }` rather than
   *  raising, because a unit wants to record it and go on. */
  async ev(expression, timeout = 30000) {
    const o = await this.send(
      "Runtime.evaluate",
      { expression, returnByValue: true, awaitPromise: true },
      timeout,
    );
    const d = o.result?.exceptionDetails;
    if (d) return { THREW: d.exception?.description ?? d.text };
    return o.result?.result?.value;
  }

  /** Open a query on the explorer and wait until the page has answered it one way or the
   *  other: the studio is up, or the notice is. Returns which.
   *
   *  **The boot notice is not an answer.** `index.html` ships the notice *visible*, saying
   *  "Starting the renderer…", and the studio hidden behind it — that pair is what a reader
   *  sees over `file://` and for the moment the module takes to load. A harness that reads
   *  the pair as a refusal calls every slow load refused, which is what the first run of
   *  U1 did to sixty valid links. So the boot sentence is excluded by name. */
  async open(search = "", { path = "explorer/", settle = 1200, limit = 150 } = {}) {
    await this.send("Page.navigate", { url: `http://localhost:${this.port}/${path}${search}` });
    for (let i = 0; i < limit; i++) {
      await sleep(200);
      const answered = await this.ev(`(() => {
        const s = document.getElementById('studio');
        const n = document.getElementById('notice');
        if (!s || !n) return null;
        const said = n.textContent.trim();
        const booting = said.startsWith('Starting the renderer');
        if (!n.hidden && said && !booting && s.hidden) return 'notice';
        if (!s.hidden) return 'studio';
        return null;
      })()`);
      if (answered) {
        await sleep(settle);
        return answered;
      }
    }
    return "neither";
  }

  /** The refusal, as `explorer.js` writes it: notice up, studio down, dot stopped. */
  refused() {
    return this.ev(`(() => {
      const n = document.getElementById('notice');
      const s = document.getElementById('studio');
      const d = document.getElementById('render-state');
      return {
        notice: !n.hidden && n.textContent.trim().length > 0,
        studioHidden: !!s.hidden,
        dot: d?.dataset.state ?? null,
        said: n.textContent.trim().slice(0, 240),
      };
    })()`);
  }

  /** Everything a unit wants to know after an action, in one round trip. */
  state() {
    return this.ev(`(() => {
      const t = (id) => document.getElementById(id)?.textContent?.trim() ?? null;
      const n = document.getElementById('notice');
      const s = document.getElementById('studio');
      return {
        url: location.search.replace(/^\\?/, ''),
        noticeUp: !n.hidden && n.textContent.trim().length > 0,
        said: n.textContent.trim().slice(0, 240),
        studioHidden: !!s.hidden,
        dot: document.getElementById('render-state')?.dataset.state ?? null,
        status: t('status'),
        stats: t('stats'),
        tab: document.querySelector('.tab[aria-selected="true"]')?.textContent?.trim() ?? null,
        renderButton: t('deep-render'),
        deepProgress: document.getElementById('deep-progress')?.hidden === false,
        walkStart: t('walk-start'),
      };
    })()`);
  }

  /** Wait until nothing is drawing on either path. */
  async settled(limit = 240, step = 250) {
    for (let i = 0; i < limit; i++) {
      const quiet = await this.ev(`(() => {
        const deep = document.getElementById('deep-render');
        const prog = document.getElementById('deep-progress');
        const dot = document.getElementById('render-state')?.dataset.state;
        const deepQuiet = !deep || (deep.textContent !== 'Cancel' && (!prog || prog.hidden));
        return deepQuiet && (dot === 'final' || dot === 'stopped');
      })()`);
      if (quiet) return true;
      await sleep(step);
    }
    return false;
  }

  /** A digest of what is actually on the canvas. The only thing that makes a wrong
   *  picture visible: two links that claim to be one view have to draw one raster. */
  async canvasHash() {
    const data = await this.ev(`(() => {
      const c = document.getElementById('canvas');
      if (!c || !c.width) return null;
      return c.toDataURL('image/png');
    })()`);
    if (typeof data !== "string") return null;
    return createHash("sha256").update(data).digest("hex").slice(0, 16);
  }

  /** Heap, nodes, listeners and documents, after a forced collection. */
  async metrics() {
    try {
      await this.send("HeapProfiler.collectGarbage");
    } catch {}
    const out = await this.send("Performance.getMetrics");
    const m = Object.fromEntries((out.result?.metrics ?? []).map((x) => [x.name, x.value]));
    let workers = 0;
    try {
      const t = await this.send("Target.getTargets");
      workers = (t.result?.targetInfos ?? []).filter((x) => x.type.includes("worker")).length;
    } catch {}
    return {
      heapMB: +(m.JSHeapUsedSize / 1048576).toFixed(1),
      nodes: m.Nodes,
      listeners: m.JSEventListeners,
      documents: m.Documents,
      workers,
    };
  }

  async shot(path) {
    const out = await this.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
    writeFileSync(path, Buffer.from(out.result.data, "base64"));
    return path;
  }

  /** The witness log, drained. Anything in it is a finding until explained. */
  drain() {
    const said = this.logs.slice();
    this.logs.length = 0;
    return said;
  }

  async stop() {
    try {
      this.ws?.close();
    } catch {}
    try {
      this.proc?.kill();
    } catch {}
    await sleep(200);
    // The profile is a temp directory per page and a unit makes several. `bench/cdp.mjs`
    // has always swept its own; this one did not, and a hunt left dozens behind.
    try {
      rmSync(this.profile, { recursive: true, force: true });
    } catch {}
  }
}

/** Start a page, and hand back one that has already answered the home view. */
export async function opened(options = {}) {
  const page = await new Page(options).start();
  await page.open("");
  return page;
}

/** A small reporter so every unit's log reads the same way. */
export function say(...parts) {
  const t = new Date().toTimeString().slice(0, 8);
  console.log(`[${t}]`, ...parts);
}
