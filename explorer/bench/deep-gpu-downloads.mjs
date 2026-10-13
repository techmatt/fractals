// Deep downloads on the GPU against the CPU, through the real Download row
// *(gpu_optin_downloads_ckpt162)*.
//
// One browser with the GPU box ticked (`explorer.deep-gpu`) and the tab's log on. Each case
// lands a frame, sets the Download row's size and samples, presses PNG, and keeps what the
// tab's log says drew the file (`field on the gpu`, with its strips, handed samples and
// passes, or `field on the cpu` and why), the wall time from the press to `file finished`,
// the Render line's bar at every poll (which must never run backward), and the PNG. The
// same case under `kernel=cpu` is the reference, and the two files are held to the visible
// rule (`visible.mjs`): 1% matches, 5% is acceptable. `--cancel` also cancels a long GPU
// download part way and then draws another, which must land on the GPU with no device lost.
//
// Display-driver resets (System event 4101) are counted from each case's start, so a reset
// is placed under the case that was running.
//
// Needs `python -m builder serve` up. Records to `artifacts/explorer-bench/<--out>`.
//
//   node explorer/bench/deep-gpu-downloads.mjs [--frames=a,b] [--cases=1920x1080@4,..]
//        [--kernels=gpu,cpu] [--cancel] [--out=deep-gpu-downloads.json] [--port=8000]

import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inflateSync } from "node:zlib";

import { open, sleep } from "./cdp.mjs";
import { FRAMES } from "./deep-gpu-frames.mjs";
import { record } from "./output.mjs";
import { verdictOf, visible } from "./visible.mjs";

const option = (name) => process.argv.find((arg) => arg.startsWith(`--${name}=`))?.split("=").slice(1).join("=");
const PORT = option("port") ?? process.env.PORT ?? "8000";
const ORIGIN = `http://localhost:${PORT}/explorer/`;
const OUT = option("out") ?? "deep-gpu-downloads.json";
const KERNELS = (option("kernels") ?? "gpu,cpu").split(",");
const NAMES = (option("frames") ?? "anchor 2e-11").split(",");
/** `WxH@N`, N the samples a pixel the row's chips are labelled by (1, 4 or 16). */
const CASES = (option("cases") ?? "1920x1080@4").split(",").map((spec) => {
  const [size, n] = spec.split("@");
  const [width, height] = size.split("x").map(Number);
  return { width, height, samples: Number(n) };
});
const WITHIN = 3 * 3600 * 1000;

/** System event 4101 since `since` (ISO), counted from a time: the log is circular. */
function resets(since) {
  if (process.platform !== "win32") return null;
  try {
    const command = `Get-WinEvent -FilterHashtable @{LogName='System'; Id=4101; StartTime=[datetime]::Parse('${since}')} -ErrorAction SilentlyContinue | ForEach-Object { $_.TimeCreated.ToString('o') }; exit 0`;
    const said = execFileSync("powershell", ["-NoProfile", "-Command", command], { encoding: "utf8" });
    return said.split(/\r?\n/).filter((line) => line.trim() !== "");
  } catch {
    return null;
  }
}

const INSTRUMENT = `(() => {
  try { localStorage.setItem("explorer.deep-log", "1"); localStorage.setItem("explorer.deep-gpu", "on"); } catch {}
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

const QUIET = `(() => {
  const deep = document.getElementById("deep-render");
  const dot = document.getElementById("render-state")?.dataset.state;
  return !!deep && deep.textContent !== "Cancel" && (dot === "final" || dot === "stopped");
})()`;

/** An RGBA raster out of a PNG the browser's canvas encoder wrote: 8-bit RGB or RGBA,
 *  not interlaced, every filter type. */
function decodePng(bytes) {
  let at = 8;
  let width = 0;
  let height = 0;
  let type = 0;
  const data = [];
  while (at < bytes.length) {
    const length = bytes.readUInt32BE(at);
    const kind = bytes.toString("latin1", at + 4, at + 8);
    const body = bytes.subarray(at + 8, at + 8 + length);
    if (kind === "IHDR") {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      if (body[8] !== 8 || body[12] !== 0) throw new Error("not an 8-bit, non-interlaced PNG");
      type = body[9];
    } else if (kind === "IDAT") data.push(body);
    else if (kind === "IEND") break;
    at += 12 + length;
  }
  const channels = type === 6 ? 4 : type === 2 ? 3 : 0;
  if (channels === 0) throw new Error(`PNG colour type ${type}`);
  const raw = inflateSync(Buffer.concat(data));
  const stride = width * channels;
  const out = new Uint8Array(width * height * 4);
  let prev = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const row = new Uint8Array(stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? row[x - channels] : 0;
      const b = prev[x];
      const c = x >= channels ? prev[x - channels] : 0;
      let v = line[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      row[x] = v & 255;
    }
    for (let x = 0; x < width; x++) {
      const o = 4 * (y * width + x);
      out[o] = row[x * channels];
      out[o + 1] = row[x * channels + 1];
      out[o + 2] = row[x * channels + 2];
      out[o + 3] = channels === 4 ? row[x * channels + 3] : 255;
    }
    prev = row;
  }
  return { w: width, h: height, data: out };
}

const downloads = mkdtempSync(join(tmpdir(), "deep-downloads-"));
const page = await open({ port: 9700 + Math.floor(Math.random() * 200), width: 1280, height: 800 });
await page.send("Page.addScriptToEvaluateOnNewDocument", { source: INSTRUMENT });
await page.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: downloads, eventsEnabled: true });

const started = new Date().toISOString();
const rows = [];
const say = (...args) => console.log(...args);

/** Land `link` on the Deep tab and wait for the screen's own pass to come to rest. */
async function land(link, kernel) {
  const query = `${link}&panel=deep${kernel === "cpu" ? "&kernel=cpu" : ""}`;
  await page.send("Page.navigate", { url: `${ORIGIN}?${query}` });
  await sleep(1500);
  await page.until(QUIET, { within: 1800000, every: 500 });
  await sleep(500);
  await page.until(QUIET, { within: 1800000, every: 500 });
}

/** Move a landed file to a name of its own, so the next run of the same frame and size cannot
 *  overwrite it before the two are compared. */
let landed = 0;
function kept(file) {
  const to = join(downloads, `run-${++landed}-${file}`);
  renameSync(join(downloads, file), to);
  return to;
}

/** Set the row and press PNG; resolves what the press did. `cancelAt`, a fraction of the
 *  bar, cancels the download there instead of waiting for it. */
async function download({ width, height, samples }, { cancelAt = null, loseAt = null } = {}) {
  const preset = `${width} × ${height}`;
  const set = await page.evaluate(`(() => {
    const sel = document.getElementById('download-size');
    const want = [...sel.options].find((o) => o.textContent === ${JSON.stringify(preset)});
    if (want) sel.value = want.value;
    else {
      sel.value = 'custom';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      const w = document.getElementById('download-width'), h = document.getElementById('download-height');
      w.value = ${width}; h.value = ${height};
      for (const el of [w, h]) { el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }
    }
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    const chip = [...document.querySelectorAll('#download-samples button')].find((b) => b.textContent === '${samples}×');
    chip?.click();
    return { size: sel.value, chip: chip?.getAttribute('aria-pressed'), estimate: document.getElementById('download-estimate').textContent };
  })()`);
  // A file is this press's when it is new or newer: two runs of one frame and size share a
  // name, and Chrome overwrites the first rather than numbering the second.
  const before = new Map(readdirSync(downloads).map((f) => [f, statSync(join(downloads, f)).mtimeMs]));
  const fresh = (f) => f.endsWith(".png") && (!before.has(f) || statSync(join(downloads, f)).mtimeMs > before.get(f));
  const mark = await page.evaluate(`(document.getElementById('download-png').click(), window.__deepLog.length)`);
  const t0 = Date.now();
  const bar = [];
  let cancelled = false;
  let lostAt = null;
  let finished = null;
  let file = null;
  while (Date.now() - t0 < WITHIN) {
    await sleep(500);
    const now = await page.evaluate(`(() => {
      const log = window.__deepLog.slice(${mark});
      const done = Number(getComputedStyle(document.getElementById('deep-bar')).getPropertyValue('--done') || 0);
      return { done, finished: log.find((e) => e.event === 'file finished') ?? null,
               failed: log.find((e) => e.event === 'failed') ?? null,
               note: document.getElementById('status')?.textContent ?? '' };
    })()`);
    bar.push(+now.done.toFixed(4));
    if (cancelAt !== null && !cancelled && now.done >= cancelAt) {
      await page.evaluate(`document.getElementById('download-png').click()`);
      cancelled = true;
      await sleep(3000);
      break;
    }
    if (loseAt !== null && lostAt === null && now.done >= loseAt) {
      await page.evaluate(`window.__deepGpu?.loseForTesting()`);
      lostAt = now.done;
    }
    if (now.failed) break;
    if (now.finished && finished === null) finished = Date.now();
    if (finished !== null) {
      file = readdirSync(downloads).find(fresh) ?? null;
      if (file) break;
      // A finished field whose file never lands is a miss to report, not hours to wait out.
      if (Date.now() - finished > 60000) break;
    }
  }
  const log = await page.evaluate(`window.__deepLog.slice(${mark})`);
  const field = log.find((e) => e.event === "field on the gpu" || e.event === "field on the cpu") ?? null;
  const first = log[0]?.t ?? null;
  const done = log.find((e) => e.event === "file finished");
  let backward = 0;
  for (let k = 1; k < bar.length; k++) if (bar[k] < bar[k - 1] - 1e-9) backward += 1;
  return {
    set,
    cancelled,
    lostAt,
    barMax: bar.length ? Math.max(...bar) : null,
    kernel: field === null ? null : field.event.endsWith("gpu") ? "gpu" : "cpu",
    field: field?.detail ?? null,
    lost: log.filter((e) => e.event === "gpu lost").map((e) => e.detail),
    events: [...new Set(log.map((e) => e.event))],
    // From the press to the field's colouring done, in the page's own clock; and to the file.
    ms: done && first !== null ? Math.round(done.t - first) : null,
    wallMs: finished === null ? null : finished - t0,
    bar: { polls: bar.length, backward, last: bar.at(-1) ?? null },
    file: file === null ? null : kept(file),
  };
}

try {
  for (const name of NAMES) {
    const link = FRAMES[name];
    if (!link) throw new Error(`no frame ${name}`);
    for (const shape of CASES) {
      const row = { frame: name, ...shape, runs: {} };
      for (const kernel of KERNELS) {
        const since = new Date().toISOString();
        await land(link, kernel);
        const run = await download(shape);
        run.since = since;
        run.resets = resets(since);
        row.runs[kernel] = run;
        say(`${name} ${shape.width}x${shape.height}@${shape.samples} ${kernel}: ${run.kernel} ${run.ms} ms` +
          `${run.field?.strips ? ` strips=${run.field.strips}` : ""}${run.field?.handed != null ? ` handed=${run.field.handed}` : ""}` +
          `${run.field?.why ? ` why=${run.field.why}` : ""} bar-back=${run.bar.backward} resets=${run.resets?.length ?? "?"}`);
      }
      if (row.runs.gpu?.file && row.runs.cpu?.file) {
        const cpu = decodePng(readFileSync(row.runs.cpu.file));
        const gpu = decodePng(readFileSync(row.runs.gpu.file));
        const { moved, visible: seen } = visible(cpu, gpu);
        row.agree = { moved: +(100 * moved).toFixed(3), visible: +(100 * seen).toFixed(3), verdict: verdictOf(seen), w: cpu.w, h: cpu.h };
        say(`  agree: ${row.agree.visible}% visible (${row.agree.verdict}), ${row.agree.moved}% moved`);
      }
      for (const run of Object.values(row.runs)) if (run.file) rmSync(run.file, { force: true });
      rows.push(row);
      record(OUT, { started, frames: NAMES, cases: CASES, rows, resetsSoFar: resets(started) });
    }
  }
  if (process.argv.includes("--cancel")) {
    const since = new Date().toISOString();
    await land(FRAMES["anchor 2e-11"], "gpu");
    const cut = await download({ width: 3840, height: 2160, samples: 4 }, { cancelAt: 0.3 });
    const said = await page.evaluate(`document.getElementById('deep-render').textContent`);
    const next = await download({ width: 1920, height: 1080, samples: 4 });
    const cancel = { since, cut, renderAfter: said, next, resets: resets(since) };
    say(`cancel: cut at ${cut.bar.last} (${cut.kernel}), then ${next.kernel} in ${next.ms} ms, lost ${cut.lost.length + next.lost.length}`);
    for (const run of [cut, next]) if (run.file) rmSync(run.file, { force: true });
    record(OUT, { started, frames: NAMES, cases: CASES, rows, cancel, resetsSoFar: resets(started) });
  }
  if (process.argv.includes("--lose")) {
    // A device lost part way through a download's second strip: the file still lands, all
    // one kernel's (resumed at the strip it lost where the device recovers as itself,
    // deep_holes_ckpt163), and the bar never runs past the end.
    const since = new Date().toISOString();
    await land(FRAMES["anchor 2e-11"], "gpu");
    const lost = await download({ width: 1920, height: 1080, samples: 4 }, { loseAt: 0.7 });
    let agree = null;
    await land(FRAMES["anchor 2e-11"], "cpu");
    const cpu = await download({ width: 1920, height: 1080, samples: 4 });
    if (lost.file && cpu.file) {
      const { moved, visible: seen } = visible(decodePng(readFileSync(cpu.file)), decodePng(readFileSync(lost.file)));
      agree = { moved: +(100 * moved).toFixed(3), visible: +(100 * seen).toFixed(3), verdict: verdictOf(seen) };
    }
    say(`lose: at ${lost.lostAt}, ${lost.kernel} losses=${lost.field?.losses} handed=${lost.field?.handed} file=${!!lost.file} barMax=${lost.barMax} agree=${JSON.stringify(agree)}`);
    for (const run of [lost, cpu]) if (run.file) rmSync(run.file, { force: true });
    record(OUT, { started, frames: NAMES, cases: CASES, rows, lose: { since, lost, agree, resets: resets(since) }, resetsSoFar: resets(started) });
  }
} finally {
  const all = resets(started);
  say(`display-driver resets during the run: ${all?.length ?? "?"}${all?.length ? ` at ${all.join(", ")}` : ""}`);
  await page.close();
  rmSync(downloads, { recursive: true, force: true });
}
process.exit(0);
