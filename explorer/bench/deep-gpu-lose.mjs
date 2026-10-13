// A lost device under the Deep tab, forced, and what is on screen and held after it
// *(deep_holes_ckpt163)*.
//
// The rule it holds the page to: **what is on screen and held is always drawn by the kernel
// the page now uses**, and the picture a loss leaves is the one a fresh load of the same
// link draws on this machine, byte for byte. A loss is forced with `DeepGpu.loseForTesting()`
// (`device.destroy()`, which Chrome recovers from); an unrecoverable one patches
// `navigator.gpu.requestAdapter` to hand out nothing first, so every recovery attempt misses.
//
//   1. recover, idle: A then B on the GPU, the device lost with B up; once `gpu ready`, B is
//      still up and is a fresh GPU load's B, everything held is the GPU's at the same
//      identity, and a step back puts up a fresh GPU load's A.
//   2. recover, mid-frame: the device lost once the full stage's bar is about half way; the
//      frame lands as a fresh GPU load's, `data-kernel=gpu`.
//   3. recover, mid-quarter: the same during a quarter the census sends to the GPU.
//   4. unrecoverable, idle and mid-frame: the box says the GPU is unavailable, the picture
//      up is redrawn as a fresh `kernel=cpu` load's, nothing the GPU drew is held, a step
//      back draws the CPU's picture, and a recolour lands.
//   5. untick with a GPU picture up: redrawn as a fresh `kernel=cpu` load's, and a recolour
//      lands.
//
//   node explorer/bench/deep-gpu-lose.mjs [--port=8000] [--only=1,2,…]
//        [--a=<frame>] [--b=<frame>] [--mid=<frame>] [--quarter=<frame>]
//
// Frames are named from `deep-gpu-frames.mjs` (`FRAMES`, or `LADDER` for the quarter's):
// A and B the GPU draws in a few seconds, the quarter's one at 1e-80 whose census sends its
// quarter to the GPU. A reference that the ticked box draws on the CPU (the cheap rule) is a
// FAIL that says so, since it would prove nothing. References are fresh loads in a browser
// of their own. `python -m builder serve` must be up. Prints a line per case and a summary,
// records `artifacts/explorer-bench/deep-gpu-lose.json`, and exits 1 on any FAIL. Needs a
// WebGPU adapter; no part of `builder check` or CI.

import { open, sleep } from "./cdp.mjs";
import { FRAMES, LADDER } from "./deep-gpu-frames.mjs";
import { record } from "./output.mjs";

const option = (name) => process.argv.find((arg) => arg.startsWith(`--${name}=`))?.split("=").slice(1).join("=");
const PORT = option("port") ?? process.env.PORT ?? "8000";
const ORIGIN = `http://localhost:${PORT}/explorer/`;
const only = option("only")?.split(",") ?? null;
const named = (name) => {
  const link = FRAMES[name] ?? LADDER[name];
  if (link === undefined) throw new Error(`no frame named ${name}`);
  return { name, link };
};
const A = named(option("a") ?? "anchor 2e-11");
const B = named(option("b") ?? "deep-gallery#4");
const MID = named(option("mid") ?? B.name);
const QUARTER = named(option("quarter") ?? "B-1e-80");
const WITHIN = 900000;

/** The log, the box ticked, and nothing else: as a reader who ticked it has the page. */
const INSTRUMENT = `(() => {
  try { localStorage.setItem("explorer.deep-log", "1"); localStorage.setItem("explorer.deep-gpu", "on"); } catch {}
  window.__deepLog = [];
  const print = console.log;
  console.log = function (...args) {
    if (typeof args[0] === "string" && args[0].startsWith("[deep ")) {
      const event = args[0].replace(/^\\[deep [^\\]]*\\] /, "");
      if (event.startsWith("worker") || event === "bands") return;
      let detail = null;
      try { detail = JSON.parse(JSON.stringify(args[1] ?? null)); } catch {}
      window.__deepLog.push({ t: performance.now(), event, detail });
      return;
    }
    return print.apply(this, args);
  };
})();`;

const QUIET = `(() => {
  const deep = document.getElementById("deep-render");
  const prog = document.getElementById("deep-progress");
  const dot = document.getElementById("render-state")?.dataset.state;
  const deepQuiet = !deep || deep.textContent !== "Cancel";
  return deepQuiet && (!prog || prog.hidden) && (dot === "final" || dot === "stopped");
})()`;

/** `deep-same.mjs`'s digest of the canvas, and what the page says drew it. */
const STATE = `(() => {
  const c = document.getElementById("canvas");
  const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
  let h = 2166136261;
  for (let i = 0; i < d.length; i++) { h ^= d[i]; h = Math.imul(h, 16777619) >>> 0; }
  const k = document.getElementById("deep-kernel");
  const g = globalThis.__deepGpu;
  return {
    hash: h,
    kernel: k?.dataset.kernel ?? null,
    identity: k?.dataset.identity ?? null,
    said: k?.textContent ?? "",
    stats: document.getElementById("deep-stats")?.textContent ?? "",
    query: location.search,
    box: document.getElementById("deep-gpu")?.dataset.state ?? null,
    status: g?.health?.status ?? null,
    losses: g?.health?.losses ?? null,
    using: g?.using ?? null,
  };
})()`;

/** Rest: quiet, a kernel line written, and the canvas the same across three reads apart. */
async function rest(page, within = WITHIN) {
  const deadline = Date.now() + within;
  let last = null;
  let same = 0;
  while (Date.now() < deadline) {
    await sleep(500);
    const quiet = await page.evaluate(QUIET).catch(() => false);
    if (!quiet) {
      same = 0;
      continue;
    }
    const now = await page.evaluate(STATE).catch(() => null);
    if (now === null || now.kernel === null) {
      same = 0;
      continue;
    }
    same = last !== null && now.hash === last.hash ? same + 1 : 0;
    last = now;
    if (same >= 2) return now;
  }
  return null;
}

const mark = (page) => page.evaluate(`window.__deepLog.length`);
const logSince = (page, from) => page.evaluate(`window.__deepLog.slice(${from})`);

/** Wait for a log event after `from`, or give up. */
async function heard(page, from, event, within = 120000) {
  return page.until(`window.__deepLog.slice(${from}).some((e) => e.event === ${JSON.stringify(event)})`, { within, every: 100 });
}

/** A link's address on the Deep tab, in demo mode (`?demo=1`), which is what puts
 *  `globalThis.__demo` on the page for `land`; references load the same way. */
const address = (link, kernel = null) => `${ORIGIN}?${link}&panel=deep&demo=1${kernel === null ? "" : `&kernel=${kernel}`}`;

async function navigate(page, link, kernel = null) {
  await page.send("Page.navigate", { url: address(link, kernel) });
  await sleep(500);
  return rest(page);
}

/** Through the page's own door for a link, which puts it on the trail a step back walks. */
async function land(page, link) {
  await page.evaluate(`globalThis.__demo.open(${JSON.stringify(`${link}&panel=deep`)})`);
  await sleep(500);
  return rest(page);
}

const stepBack = `(() => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true })); return true; })()`;

/** A recolour lands: Random phase pressed, the canvas changes, and no "found no field". */
async function recolours(page) {
  const before = await page.evaluate(STATE);
  const from = await mark(page);
  await page.evaluate(`(() => { document.getElementById("view-phase").click(); return true; })()`);
  const now = await rest(page, 60000);
  const log = await logSince(page, from);
  const missing = log.some((e) => e.event === "recolour found no field");
  return { ok: now !== null && now.hash !== before.hash && !missing, missing, before: before.hash, after: now?.hash ?? null };
}

const held = (page) => page.evaluate(`globalThis.__deepHeld?.() ?? null`);

/**
 * Lose the device inside the page at the moment `when` (an expression over `stage`, the last
 * stage the log named, `done`, the bar, and `g`, the device) first holds, polled every 5 ms
 * so that a short GPU quarter is not missed between two of the harness's polls; `adapterless`
 * patches `requestAdapter` first, so the loss is unrecoverable.
 */
const loseWhen = (when, adapterless = false) => `(() => {
  const t = setInterval(() => {
    const g = globalThis.__deepGpu;
    if (!g || !g.device) return;
    const stage = [...window.__deepLog].reverse().find((e) => e.event === "stage")?.detail?.stage ?? null;
    const done = Number(getComputedStyle(document.getElementById("deep-bar")).getPropertyValue("--done") || 0);
    if (!(${when})) return;
    clearInterval(t);
    ${adapterless ? "navigator.gpu.requestAdapter = async () => null;" : ""}
    window.__lostAt = { stage, done, passes: g.last?.passes ?? null };
    g.loseForTesting();
  }, 5);
  return true;
})()`;

const unrecoverable = `(() => { navigator.gpu.requestAdapter = async () => null; globalThis.__deepGpu.loseForTesting(); return true; })()`;

// ---------------------------------------------------------------------- references

const debug = 9500 + Math.floor(Math.random() * 380);
const ref = await open({ port: debug, width: 1920, height: 1055 });
const page = await open({ port: debug + 9, width: 1920, height: 1055 });
for (const each of [ref, page]) await each.send("Page.addScriptToEvaluateOnNewDocument", { source: INSTRUMENT });

const cases = [];
let failed = 0;
const say = (row) => {
  cases.push(row);
  if (row.verdict !== "PASS") failed += 1;
  console.log(`${row.verdict} ${row.case}: ${row.note}`);
};
const wants = (n) => only === null || only.includes(String(n));

const references = {};
try {
  await ref.send("Page.navigate", { url: `${ORIGIN}?v=4` });
  await sleep(1000);
  const adapter = await ref.evaluate(`(async () => {
    if (!navigator.gpu) return null;
    const a = await navigator.gpu.requestAdapter();
    if (!a) return null;
    const i = a.info ?? {};
    return [i.vendor, i.architecture, i.description].filter(Boolean).join(" ") || "an adapter";
  })()`);
  if (adapter === null) {
    console.log("SKIP: this browser has no WebGPU adapter");
    record("deep-gpu-lose.json", { skipped: "no adapter" });
    process.exit(0);
  }
  console.log(`adapter: ${adapter}`);
  const needs = new Map();
  const need = (frame, kernel) => needs.set(`${frame.name}|${kernel}`, { frame, kernel });
  if (wants(1)) [A, B].forEach((f) => need(f, "gpu"));
  if (wants(2)) need(MID, "gpu");
  if (wants(3)) need(QUARTER, "gpu");
  if (wants(4)) {
    need(A, "gpu");
    [A, B, MID].forEach((f) => need(f, "cpu"));
  }
  if (wants(5)) need(B, "cpu");
  for (const [key, { frame, kernel }] of needs) {
    const state = await navigate(ref, frame.link, kernel === "cpu" ? "cpu" : null);
    references[key] = state;
    const drew = state?.kernel ?? "-";
    console.log(`reference ${frame.name} ${kernel}: ${drew} ${state?.hash ?? "never came to rest"}`);
  }
} finally {
  await ref.close().catch(() => {});
}

/** The reference, or a FAIL row saying why it proves nothing. */
function reference(caseName, frame, kernel) {
  const state = references[`${frame.name}|${kernel}`];
  if (state == null) {
    say({ case: caseName, verdict: "FAIL", note: `the reference ${frame.name} (${kernel}) never came to rest` });
    return null;
  }
  if (state.kernel !== kernel) {
    say({ case: caseName, verdict: "FAIL", note: `the ticked reference of ${frame.name} was drawn on the ${state.kernel}: choose a frame the GPU draws` });
    return null;
  }
  return state;
}

const matches = (got, want, kernel) => got !== null && got.hash === want.hash && got.kernel === kernel;
const allGpu = (snapshot, identity) =>
  snapshot !== null &&
  snapshot.held.filter((e) => e.stage === "full").every((e) => e.kernel === "gpu" && e.identity === identity);
const noGpu = (snapshot) =>
  snapshot !== null && !snapshot.held.some((e) => e.kernel === "gpu") && !snapshot.fields.some((e) => e.kernel === "gpu");

try {
  // ------------------------------------------------------------------ 1. recover, idle
  if (wants(1)) {
    const refA = reference("1 recover idle", A, "gpu");
    const refB = refA && reference("1 recover idle", B, "gpu");
    if (refA && refB) {
      const a = await navigate(page, A.link);
      const b = await land(page, B.link);
      const before = await page.evaluate(`globalThis.__deepGpu.identity`);
      const from = await mark(page);
      await page.evaluate(`globalThis.__deepGpu.loseForTesting()`);
      const ready = await heard(page, from, "gpu ready");
      const up = await rest(page);
      const after = await page.evaluate(`globalThis.__deepGpu.identity`);
      const kept = await held(page);
      await page.evaluate(stepBack);
      await sleep(500);
      const back = await rest(page);
      const ok = matches(a, refA, "gpu") && matches(b, refB, "gpu") && ready && matches(up, refB, "gpu") && after === before && allGpu(kept, after) && matches(back, refA, "gpu");
      say({
        case: "1 recover idle",
        verdict: ok ? "PASS" : "FAIL",
        note: `B ${up?.hash} (fresh ${refB.hash}) ${up?.kernel}, ready ${ready}, identity ${before === after ? "kept" : `${before} -> ${after}`}, held all GPU ${allGpu(kept, after)}, back to A ${back?.hash} (fresh ${refA.hash})`,
        a, b, up, back, held: kept, before, after,
      });
    }
  }

  // ------------------------------------------------------------- 2. recover, mid-frame
  if (wants(2)) {
    const want = reference("2 recover mid-frame", MID, "gpu");
    if (want) {
      await page.send("Page.navigate", { url: address(MID.link) });
      await page.until(`!!globalThis.__deepGpu`, { within: 60000 });
      await page.evaluate(loseWhen(`stage === "full" && done >= 0.53 && (g.last?.passes ?? 0) > 0`));
      const got = await rest(page);
      const lostAt = await page.evaluate(`window.__lostAt ?? null`);
      const log = await logSince(page, 0);
      const hit = log.some((e) => e.event === "field lost its device");
      const ok = hit && matches(got, want, "gpu");
      say({
        case: "2 recover mid-frame",
        verdict: ok ? "PASS" : "FAIL",
        note: `${got?.hash} (fresh ${want.hash}) ${got?.kernel}, lost at ${JSON.stringify(lostAt)}${hit ? "" : ", but no stage lost its device: the loss missed the frame"}`,
        got, lostAt,
      });
    }
  }

  // ----------------------------------------------------------- 3. recover, mid-quarter
  if (wants(3)) {
    const want = reference("3 recover mid-quarter", QUARTER, "gpu");
    if (want) {
      await page.send("Page.navigate", { url: address(QUARTER.link) });
      await page.until(`!!globalThis.__deepGpu`, { within: 60000 });
      // The first draw a fresh page makes is the quarter's, where its census sends it there.
      await page.evaluate(loseWhen(`stage === "preview" && (g.last?.passes ?? 0) > 0`));
      const got = await rest(page);
      const lostAt = await page.evaluate(`window.__lostAt ?? null`);
      const log = await logSince(page, 0);
      const at = log.findIndex((e) => e.event === "field lost its device" && e.detail?.stage === "quarter");
      const hit = at >= 0;
      // The full stage on the GPU reads only the quarter's census, so its picture is the same
      // whichever kernel redrew the quarter: the quarter itself has to be seen landing on it.
      const quarterGpu = hit && log.slice(at).some((e) => e.event === "field landed" && e.detail?.stage === "preview" && e.detail?.kernel === "gpu");
      const ok = hit && quarterGpu && matches(got, want, "gpu");
      say({
        case: "3 recover mid-quarter",
        verdict: ok ? "PASS" : "FAIL",
        note: `${got?.hash} (fresh ${want.hash}) ${got?.kernel}, lost at ${JSON.stringify(lostAt)}${hit ? (quarterGpu ? ", quarter redrawn on the GPU" : ", but the quarter was not redrawn on the GPU") : ", but no quarter lost its device: its census kept it on the CPU, or the loss missed it"}`,
        got, lostAt,
      });
    }
  }

  // ---------------------------------------------------------------- 4. unrecoverable
  if (wants(4)) {
    const gpuA = reference("4 unrecoverable idle", A, "gpu");
    const cpuA = gpuA && reference("4 unrecoverable idle", A, "cpu");
    const cpuB = cpuA && reference("4 unrecoverable idle", B, "cpu");
    if (gpuA && cpuA && cpuB) {
      await navigate(page, A.link);
      const b = await land(page, B.link);
      const from = await mark(page);
      await page.evaluate(unrecoverable);
      const off = await heard(page, from, "gpu off", 60000);
      await sleep(1000);
      const up = await rest(page);
      const kept = await held(page);
      await page.evaluate(stepBack);
      await sleep(500);
      const back = await rest(page);
      const colour = await recolours(page);
      const ok = b?.kernel === "gpu" && off && up?.box === "unavailable" && matches(up, cpuB, "cpu") && noGpu(kept) && matches(back, cpuA, "cpu") && colour.ok;
      say({
        case: "4 unrecoverable idle",
        verdict: ok ? "PASS" : "FAIL",
        note: `B ${up?.hash} (fresh cpu ${cpuB.hash}) ${up?.kernel}, box ${up?.box}, GPU held ${!noGpu(kept)}, back to A ${back?.hash} (fresh cpu ${cpuA.hash}) ${back?.kernel}, recolour ${colour.ok}`,
        b, up, back, held: kept, colour,
      });
    }
    const cpuMid = reference("4 unrecoverable mid-frame", MID, "cpu");
    if (cpuMid) {
      await page.send("Page.navigate", { url: address(MID.link) });
      await page.until(`!!globalThis.__deepGpu`, { within: 60000 });
      await page.evaluate(loseWhen(`stage === "full" && done >= 0.53 && (g.last?.passes ?? 0) > 0`, true));
      const got = await rest(page);
      const lostAt = await page.evaluate(`window.__lostAt ?? null`);
      const kept = await held(page);
      const colour = await recolours(page);
      const ok = lostAt !== null && got?.box === "unavailable" && matches(got, cpuMid, "cpu") && noGpu(kept) && colour.ok;
      say({
        case: "4 unrecoverable mid-frame",
        verdict: ok ? "PASS" : "FAIL",
        note: `${got?.hash} (fresh cpu ${cpuMid.hash}) ${got?.kernel}, box ${got?.box}, lost at ${JSON.stringify(lostAt)}, GPU held ${!noGpu(kept)}, recolour ${colour.ok}`,
        got, lostAt, held: kept, colour,
      });
    }
  }

  // -------------------------------------------------------------------- 5. untick
  if (wants(5)) {
    const cpuB = reference("5 untick", B, "cpu");
    if (cpuB) {
      const b = await navigate(page, B.link);
      await page.evaluate(`document.getElementById("deep-gpu").click()`);
      await sleep(1000);
      const up = await rest(page);
      const kept = await held(page);
      const colour = await recolours(page);
      const ok = b?.kernel === "gpu" && matches(up, cpuB, "cpu") && noGpu(kept) && colour.ok;
      say({
        case: "5 untick",
        verdict: ok ? "PASS" : "FAIL",
        note: `${up?.hash} (fresh cpu ${cpuB.hash}) ${up?.kernel}, drawn before on the ${b?.kernel}, GPU held ${!noGpu(kept)}, recolour ${colour.ok}`,
        b, up, held: kept, colour,
      });
    }
  }
} finally {
  await page.close().catch(() => {});
}

console.log(`${cases.length - failed}/${cases.length} pass`);
record("deep-gpu-lose.json", { frames: { A: A.name, B: B.name, mid: MID.name, quarter: QUARTER.name }, references, cases });
process.exit(failed > 0 ? 1 : 0);
