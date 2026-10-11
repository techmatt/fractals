// The Deep tab's GPU kernel held to its CPU kernel, picture against picture, on this
// machine's real adapter *(gpu_deep_ship_ckpt162)*.
//
// For each frame: load it with `kernel=cpu`, let it come to rest, read the canvas; load it
// again with `kernel=gpu`, rest, read again, and read the Details line's `data-kernel`. The
// two canvases are compared by stage 2's visible-pixel rule (`visible.mjs`), with the CPU
// picture as the reference: a frame **matches** at 1% visible or less and is **acceptable**
// at 5% or less. `link-fidelity.mjs` is what proves the CPU kernel exact; this proves the GPU
// draws the same picture a reader would see.
//
// A GPU load whose Details line says the CPU drew it is a **named skip** with the GPU's own
// reason, never a pass; a browser with no WebGPU adapter at all skips the whole run by name.
// The frames are the stage-2 views past 1e-50 (A, B, C, and D, the degree-3 minibrot whose
// interior the kernel's proof settles), the deep links the site publishes, one Mandelbrot
// and one Julia set per degree 2 to 6, `random-dives#337`, a long tail of samples at
// the cap, and the golden-mean Siegel boundary, the frame nearest the 1% line. They
// live in `deep-gpu-frames.mjs`, which `deep-gpu-time.mjs` draws its larger sample from.
//
//   node explorer/bench/deep-gpu-agree.mjs [--only=<name>,<name>] [--port=8000]
//
// `python -m builder serve` must be up. It prints a row per frame and records
// `artifacts/explorer-bench/deep-gpu-agree.json`; it exits 1 when any frame is past 5% or a
// load never came to rest, and lists every frame past 1%. No part of `builder check` or CI,
// which have no adapter; about twenty minutes, most of it the CPU loads.

import { open, sleep } from "./cdp.mjs";
import { FRAMES } from "./deep-gpu-frames.mjs";
import { record } from "./output.mjs";
import { ACCEPTABLE, MATCH, verdictOf, visible } from "./visible.mjs";

const option = (name) => process.argv.find((arg) => arg.startsWith(`--${name}=`))?.split("=")[1];
const only = option("only")?.split(",") ?? null;
const PORT = option("port") ?? process.env.PORT ?? "8000";
const ORIGIN = `http://localhost:${PORT}/explorer/`;

const QUIET = `(() => {
  const deep = document.getElementById("deep-render");
  const prog = document.getElementById("deep-progress");
  const dot = document.getElementById("render-state")?.dataset.state;
  const deepQuiet = !deep || deep.textContent !== "Cancel";
  return deepQuiet && (!prog || prog.hidden) && (dot === "final" || dot === "stopped");
})()`;

/** The Details lines and a digest of the canvas: what rest waits on. */
const STATE = `(() => {
  const c = document.getElementById("canvas");
  const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
  let h = 2166136261;
  for (let i = 0; i < d.length; i += 3) { h ^= d[i]; h = Math.imul(h, 16777619) >>> 0; }
  const k = document.getElementById("deep-kernel");
  const g = globalThis.__deepGpu;
  return {
    hash: h,
    kernel: k?.dataset.kernel ?? null,
    said: k?.textContent ?? "",
    stats: document.getElementById("deep-stats")?.textContent ?? "",
    full: window.__fullPass ?? null,
    why: g ? (g.health?.why ?? null) : null,
    status: g ? (g.health?.status ?? null) : null,
  };
})()`;

/** The canvas's RGBA as base64, so a 1.7 MB raster crosses CDP as one string. */
const CANVAS = `(() => {
  const c = document.getElementById("canvas");
  const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
  let s = "";
  for (let i = 0; i < d.length; i += 0x8000) s += String.fromCharCode.apply(null, d.subarray(i, i + 0x8000));
  return { w: c.width, h: c.height, b64: btoa(s) };
})()`;

/** Rest: quiet, a kernel line written, and the canvas the same across three reads apart. */
async function rest(page, within) {
  const deadline = Date.now() + within;
  let last = null;
  let same = 0;
  while (Date.now() < deadline) {
    await sleep(500);
    let quiet = false;
    try {
      quiet = await page.evaluate(QUIET);
    } catch {
      quiet = false;
    }
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

async function draw(page, link, kernel, within) {
  await page.send("Page.navigate", { url: `${ORIGIN}?${link}&panel=deep&kernel=${kernel}` });
  await sleep(500);
  const t0 = Date.now();
  const state = await rest(page, within);
  if (state === null) return null;
  const raw = await page.evaluate(CANVAS);
  const data = Buffer.from(raw.b64, "base64");
  // The full pass's own time, off the stats line ("full pass 884×496 · 6.87 s").
  const full = /full pass [^·]*· ([\d.]+) (ms|s)\b/.exec(state.full ?? state.stats);
  const fullMs = full ? Math.round(Number(full[1]) * (full[2] === "s" ? 1000 : 1)) : null;
  const handed = /; ([\d,]+) pixels? (?:was|were) finished on the CPU/.exec(state.said);
  return {
    ...state,
    wallMs: Date.now() - t0,
    fullMs,
    handed: handed ? Number(handed[1].replaceAll(",", "")) : 0,
    picture: { w: raw.w, h: raw.h, data },
  };
}

/** The full pass's stats line, kept as it is written: a frame that settles its colouring
 *  after landing ends on a recolor's line, which says no field time, often within a poll. */
const FULL_PASS = `document.addEventListener("DOMContentLoaded", () => {
  const s = document.getElementById("deep-stats");
  if (!s) return;
  new MutationObserver(() => {
    if (s.textContent.startsWith("full pass")) window.__fullPass = s.textContent;
  }).observe(s, { childList: true, subtree: true, characterData: true });
});`;

/** `Browser.close` on the browser's own websocket; a page target refuses it. */
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

// A debugging port per run: on Windows a closed headless Chrome can hold its port a while
// after it has stopped answering, and the next run's Chrome then never comes up on it.
const DEBUG_PORT = Number(option("debug-port") ?? 9500 + Math.floor(Math.random() * 400));
const page = await open({ port: DEBUG_PORT, width: 1600, height: 1000 });
const rows = [];
let failed = 0;
let adapter = null;
try {
  await page.send("Page.addScriptToEvaluateOnNewDocument", { source: FULL_PASS });
  await page.send("Page.navigate", { url: `${ORIGIN}?v=4` });
  await sleep(1000);
  adapter = await page.evaluate(`(async () => {
    if (!navigator.gpu) return null;
    const a = await navigator.gpu.requestAdapter();
    if (!a) return null;
    const i = a.info ?? {};
    return [i.vendor, i.architecture, i.description].filter(Boolean).join(" ") || "an adapter";
  })()`);
  if (adapter !== null) console.log(`adapter: ${adapter}`);
  for (const [name, link] of Object.entries(FRAMES)) {
    if (adapter === null) break;
    if (only !== null && !only.includes(name)) continue;
    const row = { name, link };
    const cpu = await draw(page, link, "cpu", 900000);
    const gpu = cpu === null ? null : await draw(page, link, "gpu", 900000);
    if (cpu === null || gpu === null) {
      row.verdict = "BUSY";
      row.error = `${cpu === null ? "cpu" : "gpu"} load never came to rest`;
      failed++;
    } else if (cpu.kernel !== "cpu") {
      row.verdict = "BUSY";
      row.error = `the kernel=cpu load says ${cpu.kernel}`;
      failed++;
    } else if (gpu.kernel !== "gpu") {
      row.verdict = "SKIP";
      row.why = gpu.why ?? gpu.status ?? "the GPU load says the CPU drew it";
    } else {
      Object.assign(row, visible(cpu.picture, gpu.picture));
      row.verdict = verdictOf(row.visible);
      if (row.visible > ACCEPTABLE) failed++;
    }
    // Times are the full pass's own off its stats line; the wall time from navigation to
    // rest is beside it.
    if (cpu !== null) Object.assign(row, { cpuMs: cpu.fullMs, cpuWallMs: cpu.wallMs, cpuStats: cpu.stats });
    if (gpu !== null) Object.assign(row, { gpuMs: gpu.fullMs, gpuWallMs: gpu.wallMs, gpuStats: gpu.stats, handed: gpu.handed });
    rows.push(row);
    const pct = (x) => (x === undefined ? "" : `${(100 * x).toFixed(2)}%`);
    console.log(
      `${name}: ${row.verdict}` +
        (row.visible !== undefined ? ` visible ${pct(row.visible)} moved ${pct(row.moved)}` : "") +
        (row.cpuMs != null ? ` · cpu ${row.cpuMs} ms` : "") +
        (row.gpuMs != null ? ` gpu ${row.gpuMs} ms` : "") +
        (row.handed ? ` (${row.handed} px to the CPU)` : "") +
        (row.why ? ` (${row.why})` : "") +
        (row.error ? ` (${row.error})` : ""),
    );
  }
} finally {
  // `close` kills the process it launched, and on Windows the browser it started can outlive
  // it holding the debugging port, so the browser is asked to go first, on its own target.
  await browserClose(DEBUG_PORT);
  await page.close();
}

if (adapter === null) {
  console.log("SKIPPED: no WebGPU adapter in this browser, so there is no GPU kernel to compare");
  record("deep-gpu-agree.json", { skipped: "no adapter", rows });
  process.exit(0);
}
const past = rows.filter((r) => r.visible !== undefined && r.visible > MATCH).map((r) => r.name);
const skipped = rows.filter((r) => r.verdict === "SKIP").map((r) => r.name);
record("deep-gpu-agree.json", { adapter, rows });
console.log(
  `${rows.length} frames: ${rows.filter((r) => r.verdict === "match").length} match, ` +
    `${rows.filter((r) => r.verdict === "acceptable").length} acceptable, ` +
    `${rows.filter((r) => r.verdict === "different").length} different, ${skipped.length} skipped` +
    (skipped.length ? ` (${skipped.join(", ")})` : "") +
    (past.length ? `; past 1%: ${past.join(", ")}` : ""),
);
process.exit(failed > 0 ? 1 : 0);
