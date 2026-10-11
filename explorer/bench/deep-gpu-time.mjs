// What a reader waits for on the Deep tab, GPU kernel against CPU kernel, frame by frame,
// on this machine's real adapter *(gpu_deep_ship_ckpt162)*.
//
// Two headless Chromes at the working size (a maximized window on a 1920x1080 display at
// 100%, which the Deep tab draws at 1076x576), one opened with `kernel=cpu` and one under
// the rule a reader who ticked the GPU box gets (no `kernel=`, and `explorer.deep-gpu` set
// to `on` before the page's scripts run, in that browser alone: the GPU is opt-in since
// gpu_optin_downloads_ckpt162, so an unticked browser would never touch it; a frame the
// quarter pass calls cheap stays on the CPU there too; `--forced` opens it with
// `kernel=gpu` instead, which beats the box and draws every frame on the device), each kept
// open for the whole run. Every frame of `deep-gpu-frames.mjs`'s
// seeded sample is landed in each by the page's own door for a link (`openAny`, reached
// through demo mode's `open`, the way a Saved tile or a gallery tile opens one), so the
// ticked reader's realistic case is measured: the page is up, the pool is started, the
// self-test has passed, and the frame is one more link. One browser draws at a time; the
// other idles.
//
// Per frame and per kernel it records, off the Deep tab's own log (`explorer.deep-log`):
// the **wall** time from the link landing to the full pass finished (the quarter pass, the
// reference orbit, the full field, and both colourings: what a reader waits for); the
// quarter pass and the full field apart; and on the GPU the device's own share (`kernelMs`,
// the field's time less the tail, any kernel compile logged apart as `compileMs`), the
// samples handed to the CPU and the CPU's time on them (`tailMs`). Then both pictures are
// compared by stage 2's visible-pixel rule (`visible.mjs`, the CPU picture the reference).
//
// After the warm run, a stratified subset is drawn again **cold**: a fresh navigation per
// frame, timed from navigation start, with the GPU browser unforced (no `kernel=`, the box
// ticked), which is a reader who ticked it on an earlier visit opening a deep link in a new
// tab: the page loads, the pool starts, the self-test runs beside the quarter pass, and the
// full stage goes to the GPU only if it passed in time. The first frame of each browser is a fresh profile's first visit and is
// recorded as such.
//
//   node explorer/bench/deep-gpu-time.mjs [--limit=N] [--cold=N] [--port=8000] [--seed=162] [--forced]
//                                         [--from=N] [--out=deep-gpu-time.json] [--names=file.json]
//
// A GPU frame that loses its device, or finds the GPU off after an earlier loss, is kept as
// `lostFirst` and drawn again in a fresh browser, which acquires a fresh adapter: a driver
// reset is the machine's moment, and a run should say it happened rather than time the CPU
// under the GPU's name for the rest of the sample. `--from` starts the sample part way, for
// a run a reset cut short, and `--out` names the record so the two halves both survive.
// `--names` keeps only the frames a JSON list names, in the sample's order, for a re-run of
// a subset against an earlier record.
//
// Each GPU frame keeps the device's pass record off the log (`passes`: passes, dispatches,
// the longest pass and dispatch by the device's timestamps, the longest pass by the wall),
// and the run keeps how many display-driver resets Windows logged while it ran, where
// PowerShell can say.
//
// `python -m builder serve` must be up and nothing else heavy may run: it is a timing. It
// records `artifacts/explorer-bench/deep-gpu-time.json` after every frame, so a run cut
// short keeps what it measured. No part of `builder check` or CI. About an hour.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

import { open, sleep } from "./cdp.mjs";
import { sample, shapeOf } from "./deep-gpu-frames.mjs";
import { record } from "./output.mjs";
import { verdictOf, visible } from "./visible.mjs";

const option = (name) => process.argv.find((arg) => arg.startsWith(`--${name}=`))?.split("=")[1];
const PORT = option("port") ?? process.env.PORT ?? "8000";
const ORIGIN = `http://localhost:${PORT}/explorer/`;
const SEED = Number(option("seed") ?? 162);
const LIMIT = Number(option("limit") ?? Infinity);
const COLD = Number(option("cold") ?? 24);
const WIDTH = 1920;
const HEIGHT = 1055;
const WITHIN = 1200000;
const FORCED = process.argv.includes("--forced");
const FROM = Number(option("from") ?? 0);
const OUT = option("out") ?? "deep-gpu-time.json";
const NAMES = option("names") ? new Set(JSON.parse(readFileSync(option("names"), "utf8"))) : null;

/** Display-driver resets (System log, event 4101) Windows has logged since `since` (an ISO
 *  time), or `null` off Windows. Counted from a time and never as a difference of totals:
 *  the System log is circular, so an old event rolling off would cancel a new one. */
function resets(since) {
  if (process.platform !== "win32") return null;
  try {
    const command = `(Get-WinEvent -FilterHashtable @{LogName='System'; Id=4101; StartTime=[datetime]::Parse('${since}')} -ErrorAction SilentlyContinue | Measure-Object).Count`;
    const said = execFileSync("powershell", ["-NoProfile", "-Command", command], { encoding: "utf8" });
    return Number(said.trim());
  } catch {
    return null;
  }
}

/** The first frame each browser draws, outside the sample: a fresh profile's first visit. */
const PRIMER = "dv=3&x=-0.7436438870371587&y=0.131825904205312&w=1e-12&p=inferno&scale=absolute";

/** Before any of the page's scripts: the Deep tab's log on, and each line kept in the page
 *  with its time rather than printed. Worker chatter is dropped. */
const INSTRUMENT = `(() => {
  try { localStorage.setItem("explorer.deep-log", "1"); } catch {}
  window.__deepLog = [];
  const print = console.log;
  console.log = function (...args) {
    if (typeof args[0] === "string" && args[0].startsWith("[deep ")) {
      const event = args[0].replace(/^\\[deep [^\\]]*\\] /, "");
      if (event.startsWith("worker")) return;
      let detail = null;
      try { detail = JSON.parse(JSON.stringify(args[1] ?? null)); } catch {}
      window.__deepLog.push({ t: performance.now(), event, detail });
      return;
    }
    return print.apply(this, args);
  };
})();`;

/** Before any of the GPU browser's scripts, and never the CPU browser's: the Deep tab's GPU
 *  box ticked, as a reader who ticked it on an earlier visit has it. The box is remembered
 *  in `localStorage` as `on` or `off` and is off where it was never ticked. */
const TICKED = `(() => {
  try { localStorage.setItem("explorer.deep-gpu", "on"); } catch {}
})();`;

const QUIET = `(() => {
  const deep = document.getElementById("deep-render");
  const prog = document.getElementById("deep-progress");
  const dot = document.getElementById("render-state")?.dataset.state;
  const deepQuiet = !deep || deep.textContent !== "Cancel";
  return deepQuiet && (!prog || prog.hidden) && (dot === "final" || dot === "stopped");
})()`;

const HASH = `(() => {
  const c = document.getElementById("canvas");
  const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
  let h = 2166136261;
  for (let i = 0; i < d.length; i += 3) { h ^= d[i]; h = Math.imul(h, 16777619) >>> 0; }
  return h;
})()`;

const CANVAS = `(() => {
  const c = document.getElementById("canvas");
  const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
  let s = "";
  for (let i = 0; i < d.length; i += 0x8000) s += String.fromCharCode.apply(null, d.subarray(i, i + 0x8000));
  return { w: c.width, h: c.height, b64: btoa(s) };
})()`;

/** Resolves with the log from `mark` on once the full pass has finished or failed. */
const FINISHED = (mark, within) => `new Promise((resolve) => {
  const until = performance.now() + ${within};
  const ask = () => {
    const log = (window.__deepLog ?? []).slice(${mark});
    const end = log.find((e) => (e.event === "finished" && e.detail?.upto !== "preview") || e.event === "failed");
    if (end) resolve({ log, kernel: document.getElementById("deep-kernel")?.dataset.kernel ?? null,
      said: document.getElementById("deep-kernel")?.textContent ?? "" });
    else if (performance.now() > until) resolve(null);
    else setTimeout(ask, 25);
  };
  ask();
})`;

/** The GPU's record of the frame it last drew, where the page exposes it: `deep.js` puts it
 *  on `__deepGpu` where `kernel=` was asked or the log is on, which `INSTRUMENT` turns on. */
const LAST = `(() => {
  const g = globalThis.__deepGpu;
  if (!g) return null;
  const l = g.last;
  return {
    status: g.health?.status ?? null,
    why: g.health?.why ?? null,
    last: l === null ? null : {
      count: l.count, passes: l.passes, spent: l.spent, compacts: l.compacts, partials: l.partials,
      handed: l.handed, tail: l.tail, ms: l.ms ?? null,
      passMs: l.trace.reduce((sum, row) => sum + row[3], 0),
    },
  };
})()`;

/** Quiet, and the canvas the same across three reads apart: the picture a reader keeps. */
async function rest(page, within = 120000) {
  const deadline = Date.now() + within;
  let last = null;
  let same = 0;
  while (Date.now() < deadline) {
    await sleep(300);
    const quiet = await page.evaluate(QUIET).catch(() => false);
    if (!quiet) {
      same = 0;
      continue;
    }
    const hash = await page.evaluate(HASH).catch(() => null);
    same = hash !== null && hash === last ? same + 1 : 0;
    last = hash;
    if (same >= 2) return true;
  }
  return false;
}

/** What the log says about one landing, `t0` the moment it began. */
function summarize(log, t0) {
  const at = (event, test = () => true) => log.find((e) => e.event === event && test(e.detail ?? {}));
  const end = at("finished") ?? at("failed");
  const quarter = at("field landed", (d) => d.stage === "preview");
  const full = at("field landed", (d) => d.stage === "full");
  const fullStage = at("stage", (d) => d.stage === "full");
  const compiled = log.filter((e) => e.event === "gpu kernel compiled");
  const onCpu = at("field on the cpu");
  const onGpu = at("field on the gpu");
  return {
    failed: end?.event === "failed" ? (end.detail?.message ?? "failed") : undefined,
    wallMs: end ? Math.round(end.t - t0) : null,
    // The quarter pass's field (the orbit is computed before it, inside its stage).
    quarterMs: quarter?.detail?.ms ?? null,
    // From the link landing to the full stage starting: the page, the orbit, the quarter
    // pass and its colouring.
    toFullMs: fullStage ? Math.round(fullStage.t - t0) : null,
    fieldMs: full?.detail?.ms ?? null,
    // The full field landed to the pass finished: its colouring and paint.
    afterMs: full && end ? Math.round(end.t - full.t) : null,
    kernel: full?.detail?.kernel ?? null,
    handed: full?.detail?.handed ?? null,
    compileMs: compiled.reduce((sum, e) => sum + (e.detail?.ms ?? 0), 0),
    compiled: compiled.map((e) => `d${e.detail?.degree}${e.detail?.julia ? "J" : "M"}${e.detail?.interior ? "i" : ""}`),
    cpuWhy: onCpu?.detail?.why ?? undefined,
    gpuMs: onGpu ? Math.round(onGpu.detail?.ms ?? 0) : undefined,
    tailMs: onGpu?.detail?.tailMs != null ? Math.round(onGpu.detail.tailMs) : undefined,
    tailRan: onGpu?.detail?.tailRan ?? undefined,
    passes: onGpu?.detail?.passes ?? undefined,
    lost: onGpu?.detail?.lost || undefined,
    quarterRan: quarter?.detail?.ran ?? undefined,
    ready: at("gpu ready")?.detail?.ms ?? undefined,
  };
}

/** Land `link` in an open page through its own door, and time it. */
async function land(page, link) {
  const mark = await page.evaluate(`(() => {
    const mark = window.__deepLog.length;
    window.__t0 = performance.now();
    globalThis.__demo.open(${JSON.stringify(link)});
    return mark;
  })()`);
  const got = await page.evaluate(FINISHED(mark, WITHIN));
  if (got === null) return null;
  const t0 = await page.evaluate("window.__t0");
  return { ...summarize(got.log, t0), said: got.said, data: got.kernel };
}

/** Navigate to `query` in a new document and time it from navigation start. */
async function navigate(page, query) {
  const before = await page.evaluate("performance.timeOrigin").catch(() => 0);
  await page.send("Page.navigate", { url: `${ORIGIN}?${query}` });
  const deadline = Date.now() + 60000;
  for (;;) {
    await sleep(50);
    const now = await page.evaluate("performance.timeOrigin + (window.__deepLog ? 0 : -1e15)").catch(() => before);
    if (now > before) break;
    if (Date.now() > deadline) return null;
  }
  const got = await page.evaluate(FINISHED(0, WITHIN));
  if (got === null) return null;
  return { ...summarize(got.log, 0), said: got.said, data: got.kernel };
}

async function picture(page) {
  const raw = await page.evaluate(CANVAS);
  return { w: raw.w, h: raw.h, data: Buffer.from(raw.b64, "base64") };
}

/** The share of pixels not the picture's commonest colour: a solid frame matches itself at
 *  any kernel and proves nothing, so the report says which frames had little to show. */
function structure({ data }) {
  const counts = new Map();
  for (let i = 0; i < data.length; i += 4) {
    const key = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  let most = 0;
  for (const count of counts.values()) most = Math.max(most, count);
  return +(1 - most / (data.length / 4)).toFixed(4);
}

async function browserClose(port) {
  try {
    const { webSocketDebuggerUrl } = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
    const socket = new WebSocket(webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      socket.addEventListener("open", resolve, { once: true });
      socket.addEventListener("error", reject, { once: true });
    });
    socket.send(JSON.stringify({ id: 1, method: "Browser.close" }));
    await sleep(1000);
    socket.close();
  } catch {
    // Already gone.
  }
}

const base = 9500 + Math.floor(Math.random() * 380);
const browsers = {
  cpu: { port: base, query: "kernel=cpu&demo=1" },
  gpu: { port: base + 7, query: FORCED ? "kernel=gpu&demo=1" : "demo=1" },
};
const frames = sample({ seed: SEED })
  .filter((f) => NAMES === null || NAMES.has(f.name))
  .slice(0, LIMIT);
const out = { seed: SEED, forced: FORCED, from: FROM, window: [WIDTH, HEIGHT], started: new Date().toISOString(), frames: frames.length, rows: [], cold: [], first: {} };
const save = () => record(OUT, out);

/** Open (or reopen) one kernel's browser on the primer, and wait for it to settle. */
async function start(kernel) {
  const b = browsers[kernel];
  b.page = await open({ port: b.port, width: WIDTH, height: HEIGHT });
  await b.page.send("Page.addScriptToEvaluateOnNewDocument", { source: INSTRUMENT });
  // The GPU browser opts in; under `--forced` its `kernel=gpu` beats the box anyway.
  if (kernel === "gpu") await b.page.send("Page.addScriptToEvaluateOnNewDocument", { source: TICKED });
  const first = await navigate(b.page, `${PRIMER}&panel=deep&${b.query}`);
  await rest(b.page);
  // The self-test's background compiles (degree two, the switch on and off) land here.
  await sleep(kernel === "gpu" ? 6000 : 1000);
  return first;
}

async function reopen(kernel) {
  const b = browsers[kernel];
  await browserClose(b.port);
  await b.page.close();
  b.port += 13;
  await start(kernel);
}

try {
  out.first.cpu = await start("cpu");
  out.first.gpu = await start("gpu");
  const g = browsers.gpu.page;
  out.adapter = await g.evaluate(`(async () => {
    const a = await navigator.gpu?.requestAdapter();
    const i = a?.info ?? {};
    return a ? [i.vendor, i.architecture, i.description].filter(Boolean).join(" ") || "an adapter" : null;
  })()`);
  out.cores = await g.evaluate("navigator.hardwareConcurrency");
  out.canvas = await g.evaluate(`[document.getElementById("canvas").width, document.getElementById("canvas").height]`);
  out.health = await g.evaluate(LAST);
  console.log(`adapter ${out.adapter}, ${out.cores} cores, canvas ${out.canvas.join("x")}, gpu ${out.health?.status}`);
  if (out.adapter === null) throw new Error("no WebGPU adapter: nothing to time");

  for (const [index, frame] of frames.entries()) {
    if (index < FROM) continue;
    const row = { index, ...frame, ...shapeOf(frame.link) };
    const cpu = await land(browsers.cpu.page, frame.link);
    const cpuRest = cpu === null ? false : await rest(browsers.cpu.page);
    const cpuPicture = cpuRest ? await picture(browsers.cpu.page) : null;
    let gpu = await land(browsers.gpu.page, frame.link);
    const down = (got) => got !== null && (got.lost === true || /^not ready \((off|lost|unavailable)/.test(got.cpuWhy ?? ""));
    if (down(gpu)) {
      row.lostFirst = gpu;
      console.log(`${frame.name}: the GPU browser lost its device (${gpu.lost ? "under this frame" : gpu.cpuWhy.slice(0, 60)}); reopening it`);
      await reopen("gpu");
      gpu = await land(browsers.gpu.page, frame.link);
    }
    const gpuLast = gpu === null ? null : await browsers.gpu.page.evaluate(LAST);
    const gpuRest = gpu === null ? false : await rest(browsers.gpu.page);
    const gpuPicture = gpuRest ? await picture(browsers.gpu.page) : null;
    row.cpu = cpu;
    row.gpu = gpu === null ? null : { ...gpu, device: gpuLast?.last ?? null, status: gpuLast?.status, why: gpuLast?.why };
    if (gpu !== null && gpu.kernel === "gpu" && gpu.gpuMs !== undefined && gpu.tailMs !== undefined) {
      row.gpu.kernelMs = gpu.gpuMs - gpu.tailMs;
    }
    if (cpuPicture) row.structure = structure(cpuPicture);
    if (cpuPicture && gpuPicture) {
      Object.assign(row, visible(cpuPicture, gpuPicture));
      row.verdict = verdictOf(row.visible);
    } else row.verdict = "BUSY";
    if (cpu?.wallMs && gpu?.wallMs) row.speedup = +(cpu.wallMs / gpu.wallMs).toFixed(3);
    out.rows.push(row);
    save();
    const pct = (x) => `${(100 * x).toFixed(2)}%`;
    console.log(
      `${index + 1}/${frames.length} ${frame.name} d${row.degree}${row.julia ? "J" : ""} w=${row.w.toExponential(1)}: ` +
        (row.visible !== undefined ? `${row.verdict} ${pct(row.visible)} · ` : `${row.verdict} · `) +
        `cpu ${cpu?.wallMs ?? "-"} ms (field ${cpu?.fieldMs ?? "-"}) · gpu ${gpu?.wallMs ?? "-"} ms ` +
        `(field ${gpu?.fieldMs ?? "-"}, kernel ${row.gpu?.kernelMs ?? "-"}, ${gpu?.handed ?? "-"} px ${row.gpu?.tailMs ?? "-"} ms on the CPU` +
        `${gpu?.compileMs ? `, compile ${gpu.compileMs} ms ${gpu.compiled.join(",")}` : ""}${gpu?.kernel !== "gpu" ? `, drawn on ${gpu?.kernel} ${gpu?.cpuWhy ?? ""}` : ""})` +
        (row.speedup ? ` · ${row.speedup}x` : ""),
    );
    // A browser whose frame never finished is started again rather than trusted.
    if (cpu === null || !cpuRest) await reopen("cpu");
    if (gpu === null || !gpuRest) await reopen("gpu");
  }

  // Cold: every k-th frame of the sample, plus the long tail and the Julia video's end.
  const step = Math.max(1, Math.floor(frames.length / COLD));
  const cold = frames.filter((f, i) => i % step === 0 || f.name === "random-dives#337" || f.name === "go:julia3-end");
  for (const frame of cold.slice(0, COLD + 2)) {
    const row = { ...frame, ...shapeOf(frame.link) };
    row.cpu = await navigate(browsers.cpu.page, `${frame.link}&panel=deep&kernel=cpu`);
    await rest(browsers.cpu.page);
    // Unforced: the ticked reader's rule, so a self-test that has not passed in time is the CPU.
    row.gpu = await navigate(browsers.gpu.page, `${frame.link}&panel=deep`);
    await rest(browsers.gpu.page);
    if (row.cpu?.wallMs && row.gpu?.wallMs) row.speedup = +(row.cpu.wallMs / row.gpu.wallMs).toFixed(3);
    out.cold.push(row);
    save();
    console.log(
      `cold ${frame.name}: cpu ${row.cpu?.wallMs ?? "-"} ms · gpu ${row.gpu?.wallMs ?? "-"} ms on ${row.gpu?.kernel ?? "-"}` +
        `${row.gpu?.compileMs ? ` (compile ${row.gpu.compileMs} ms)` : ""}${row.gpu?.ready ? ` (ready ${row.gpu.ready} ms)` : ""}`,
    );
  }
} finally {
  out.finished = new Date().toISOString();
  out.resets = resets(out.started);
  if (out.resets != null) console.log(`display-driver resets during the run: ${out.resets}`);
  save();
  for (const b of Object.values(browsers)) {
    if (!b.page) continue;
    await browserClose(b.port);
    await b.page.close();
  }
}
