// The deep zoom video's fields: every keyframe of `data/deep-zoom-descent.keyframes.json`
// rendered headless through the committed `perturb.wasm`, one `f64` lane of smooth count per
// sample and `NaN` for the interior.
//
// One renderer for the whole descent, the shallow end included, so that `nu` means the same
// thing at every depth and a colouring of it can be one fixed function. Not a figure maker
// and not part of `build` or `check`; `builder/README.md` has the commands.
//
//   node builder/zoom_fields.mjs --caps        widths from the fit rule, caps from the probe,
//                                              written into the record
//   node builder/zoom_fields.mjs [--only k,k]  the fields, deepest first, skipping any
//                                              keyframe already on disk
//   node builder/zoom_fields.mjs --agree       neighbouring keyframes compared where they
//                                              overlap
//   ... --record <path>                        any of the above on another record, such as
//                                              an automatic descent's (`descent.py`); its
//                                              caps are that command's, so no `--caps`
//
// Fields land in `artifacts/deep-zoom/fields/` (or `FRACTAL_WEBSITE_ZOOM_DIR`/fields), one
// `k<NN>.f64` and one `k<NN>.json` each. The `.f64` is written under a temporary name and
// renamed once whole, so a run that is stopped resumes at the keyframe it was on.

import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { cpus } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { load } from "../explorer/bench/perturb.mjs";

const ROOT = new URL("../", import.meta.url);
/** The record this run reads: the deep zoom video's, or the one `--record` names — an
 *  automatic descent's (`builder/descent.py`). */
const RECORD = (() => {
  const at = process.argv.indexOf("--record");
  return at >= 0
    ? resolve(process.argv[at + 1])
    : fileURLToPath(new URL("./data/deep-zoom-descent.keyframes.json", import.meta.url));
})();
/** The file a band worker runs: this one, whoever imported it. */
const WORKER = new URL(import.meta.url);

/** Output rows a worker is handed at a time: small enough that twelve stay busy to the end. */
const BAND_ROWS = 8;
/** The probe's grid, `deep-render.js`'s `PROBE_COLS` and `PROBE_ROWS`. */
const PROBE = [64, 36];

/** `artifacts/deep-zoom/` for the deep zoom video, which had it first, and
 *  `artifacts/<name>/` for any other record — `zoom.py`'s `zoom_dir`. */
export function zoomDir() {
  const moved = process.env.FRACTAL_WEBSITE_ZOOM_DIR;
  if (moved) return moved;
  const { name } = readRecord();
  const dir = name === "deep-zoom-descent" ? "deep-zoom" : name;
  return fileURLToPath(new URL(`artifacts/${dir}/`, ROOT));
}

const fieldsDir = () => `${zoomDir()}/fields`;
const tag = (k) => `k${String(k).padStart(2, "0")}`;

function readRecord() {
  return JSON.parse(readFileSync(RECORD, "utf8"));
}

/** The record as JSON, with a keyframe and a short list of numbers each on one line: fifty
 *  keyframes spelled five lines apiece is a record nobody reads. */
function writeRecord(record) {
  const text = JSON.stringify(record, null, 2)
    .replace(/\[\s+(-?[\d.e+-]+),\s+(-?[\d.e+-]+)(?:,\s+(-?[\d.e+-]+))?\s+\]/g, (_, a, b, c) =>
      c === undefined ? `[${a}, ${b}]` : `[${a}, ${b}, ${c}]`,
    )
    .replace(/\{\n\s+("k": [^}]+?)\n\s+\}/g, (_, body) => `{ ${body.replace(/,\n\s+/g, ", ")} }`);
  writeFileSync(RECORD, `${text}\n`);
}

function baseSpec(record, width) {
  const spec = {
    schema: 1,
    center_re: record.center_re,
    center_im: record.center_im,
    width,
    resolution: record.keyframes.grid,
  };
  if (record.keyframes.supersample > 1) spec.supersample = record.keyframes.supersample;
  if (record.degree !== 2) spec.degree = record.degree;
  return spec;
}

/** The Deep tab's settle (`DeepRenderer.settle`), on one thread: open at the width policy's
 *  cap, probe the frame's own cells, double while the cap is at fault. */
function settle(p, record, width) {
  return settleSpec(p, baseSpec(record, width));
}

/** The same settle for any `perturb.wasm` spec without a cap — a keyframe's, or one
 *  `deep-render.js`'s `deepSpecOf` built from a link (`builder/deep_figures.mjs`). */
export function settleSpec(p, base) {
  const width = base.width;
  let maxiter = p.maxiter(width);
  const rungs = [];
  for (;;) {
    const orbit = p.reference({ ...base, maxiter });
    if (orbit === null) throw new Error(`no reference orbit at width ${width}`);
    const counts = p.probe({ ...base, maxiter }, orbit, PROBE[0], PROBE[1], 0, PROBE[1]);
    rungs.push(counts);
    const fault = counts.samples > 0 ? counts.fault / counts.samples : 0;
    const next = p.nextCap(maxiter);
    if (fault <= p.faultShare() || next === maxiter) {
      return { maxiter, orbit, counts, fault, rungs: rungs.length, atCeiling: fault > p.faultShare() };
    }
    maxiter = next;
  }
}

/** The first `k` whose frame holds the set's bounding box, at the grid's aspect. */
function widths(record) {
  const [cols, rows] = record.keyframes.grid;
  const aspect = rows / cols;
  const cx = Number(record.center_re);
  const cy = Number(record.center_im);
  const { re, im } = record.fit;
  const needed = Math.max(
    2 * Math.max(cx - re[0], re[1] - cx),
    (2 * Math.max(cy - im[0], im[1] - cy)) / aspect,
  );
  const out = [];
  for (let k = 0; ; k++) {
    const width = record.target_width * 2 ** k;
    out.push(width);
    if (width >= needed) return { widths: out, needed };
  }
}

async function caps() {
  const record = readRecord();
  const p = await load();
  const { widths: list, needed } = widths(record);
  const [cols, rows] = record.keyframes.grid;
  const samples = cols * rows * record.keyframes.supersample ** 2;
  const frames = [];
  let estimate = 0;
  for (const [k, width] of list.entries()) {
    const s = settle(p, record, width);
    const mean = s.counts.iterations / s.counts.samples;
    const escaped = s.counts.escaped / s.counts.samples;
    // The audit's measured rate on this box: 133.5 s for 8,294,400 samples at a probe mean of
    // 15,285, so about 1.05 ns a sample-iteration over the pool.
    const seconds = (samples * mean * 1.053e-9);
    estimate += seconds;
    frames.push({ k, width, maxiter: s.maxiter, probe_mean: Math.round(mean), escaped: +escaped.toFixed(4) });
    console.log(
      `${tag(k)} w=${width.toExponential(4)} cap=${s.maxiter} rungs=${s.rungs} mean=${Math.round(mean)} ` +
        `escaped=${(100 * escaped).toFixed(1)}% est=${seconds.toFixed(0)}s${s.atCeiling ? " CEILING" : ""}`,
    );
  }
  record.keyframes.frames = frames;
  writeRecord(record);
  console.log(`fit needs ${needed.toFixed(4)}: ${frames.length} keyframes, k=0..${frames.length - 1}`);
  console.log(`estimated field time ${(estimate / 60).toFixed(1)} min`);
}

async function render(p, record, frame, threads) {
  const spec = { ...baseSpec(record, frame.width), maxiter: frame.maxiter };
  const { field, seconds } = await renderSpec(p, spec, threads, tag(frame.k));
  const out = field;
  const [cols, rows] = record.keyframes.grid;
  const ss = record.keyframes.supersample;
  let interior = 0;
  let sum = 0;
  let low = Infinity;
  let high = -Infinity;
  for (const v of out) {
    if (Number.isNaN(v)) {
      interior++;
      continue;
    }
    sum += v;
    if (v < low) low = v;
    if (v > high) high = v;
  }
  const escaped = out.length - interior;
  return {
    field: out,
    meta: {
      k: frame.k,
      width: frame.width,
      maxiter: frame.maxiter,
      grid: [cols * ss, rows * ss],
      center_re: record.center_re,
      center_im: record.center_im,
      interior_share: interior / out.length,
      nu_mean: escaped ? sum / escaped : null,
      nu_min: escaped ? low : null,
      nu_max: escaped ? high : null,
      seconds: Math.round(seconds * 10) / 10,
      threads,
    },
  };
}

/** One whole field for any `perturb.wasm` spec that names its cap: the reference orbit once,
 *  then bands of output rows across `threads` workers. `f64` smooth counts, `NaN` for the
 *  interior, row-major at the spec's sample grid. The keyframes above and every deep figure
 *  (`builder/deep_figures.mjs`) are drawn by this and nothing else. */
export async function renderSpec(p, spec, threads, name = "frame") {
  const started = performance.now();
  const orbit = p.reference(spec);
  if (orbit === null) throw new Error(`no reference orbit for ${name}`);
  const [cols, rows] = spec.resolution;
  const ss = spec.supersample ?? 1;
  const out = new Float64Array(cols * ss * rows * ss);
  const bands = [];
  for (let r = 0; r < rows; r += BAND_ROWS) bands.push([r, Math.min(rows, r + BAND_ROWS)]);
  let next = 0;
  let done = 0;
  await new Promise((resolve, reject) => {
    for (let i = 0; i < threads; i++) {
      const worker = new Worker(WORKER, { workerData: { spec, orbit } });
      const feed = () => {
        if (next < bands.length) worker.postMessage(bands[next++]);
        else worker.terminate();
      };
      worker.on("message", ({ start, lanes }) => {
        out.set(new Float64Array(lanes.buffer, lanes.byteOffset, lanes.byteLength / 8), start * ss * cols * ss);
        if (++done === bands.length) resolve();
        feed();
      });
      worker.on("error", reject);
      feed();
    }
  });
  return { field: out, seconds: (performance.now() - started) / 1000 };
}

async function fields(only) {
  const record = readRecord();
  const frames = record.keyframes.frames;
  if (frames.length === 0) throw new Error("the record has no keyframes yet: run --caps first");
  mkdirSync(fieldsDir(), { recursive: true });
  const p = await load();
  const threads = cpus().length;
  // Deepest first: the expensive end is the one worth knowing about early.
  const todo = frames.filter((f) => (only ? only.includes(f.k) : true));
  const started = performance.now();
  for (const frame of todo) {
    const path = `${fieldsDir()}/${tag(frame.k)}`;
    if (existsSync(`${path}.f64`) && existsSync(`${path}.json`)) {
      const held = JSON.parse(readFileSync(`${path}.json`, "utf8"));
      if (held.maxiter === frame.maxiter && held.width === frame.width) {
        console.log(`${tag(frame.k)} held`);
        continue;
      }
    }
    const { field, meta } = await render(p, record, frame, threads);
    writeFileSync(`${path}.f64.part`, Buffer.from(field.buffer));
    renameSync(`${path}.f64.part`, `${path}.f64`);
    writeFileSync(`${path}.json`, `${JSON.stringify(meta, null, 2)}\n`);
    console.log(
      `${tag(frame.k)} w=${frame.width.toExponential(4)} cap=${frame.maxiter} ${meta.seconds}s ` +
        `interior=${(100 * meta.interior_share).toFixed(2)}% nu=[${meta.nu_min?.toFixed(1)}, ${meta.nu_max?.toFixed(1)}] ` +
        `elapsed=${((performance.now() - started) / 60000).toFixed(1)}min`,
    );
  }
}

/** Keyframe `k`'s 2x2 blocks against keyframe `k+1`'s central half: the block of four finer
 *  samples centred exactly on each coarser sample. `nu` varies inside a block, so the two
 *  never agree exactly; what is looked for is a median difference well under a band. */
function agree() {
  const record = readRecord();
  const [cols, rows] = record.keyframes.grid;
  const load64 = (k) => {
    const bytes = readFileSync(`${fieldsDir()}/${tag(k)}.f64`);
    return new Float64Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 8);
  };
  const frames = record.keyframes.frames;
  let fine = null;
  for (let i = 0; i + 1 < frames.length; i++) {
    const k = frames[i].k;
    if (!existsSync(`${fieldsDir()}/${tag(k)}.f64`) || !existsSync(`${fieldsDir()}/${tag(k + 1)}.f64`)) {
      fine = null;
      continue;
    }
    fine = fine ?? load64(k);
    const coarse = load64(k + 1);
    const diffs = [];
    // The yardstick: the same statistic between two fine samples two apart, which is how
    // much nu moves across one coarse sample on its own.
    const spread = [];
    let maskAgree = 0;
    let maskTotal = 0;
    // Coarse sample c sits on the corner shared by fine columns 2c - cols/2 and the next.
    for (let r = rows / 4; r < (3 * rows) / 4; r++) {
      for (let c = cols / 4; c < (3 * cols) / 4; c++) {
        const fr = 2 * r - rows / 2;
        const fc = 2 * c - cols / 2;
        const block = [
          fine[fr * cols + fc],
          fine[fr * cols + fc + 1],
          fine[(fr + 1) * cols + fc],
          fine[(fr + 1) * cols + fc + 1],
        ];
        const inside = block.filter(Number.isNaN).length;
        const v = coarse[r * cols + c];
        maskTotal++;
        if ((inside === 4) === Number.isNaN(v) || (inside > 0 && inside < 4)) maskAgree++;
        if (inside === 0 && !Number.isNaN(v)) {
          const mean = (block[0] + block[1] + block[2] + block[3]) / 4;
          diffs.push(Math.abs(mean - v) / v);
          const across = fine[fr * cols + fc + 2];
          if (!Number.isNaN(across)) spread.push(Math.abs(across - block[0]) / block[0]);
        }
      }
    }
    diffs.sort((a, b) => a - b);
    spread.sort((a, b) => a - b);
    const q = (x, list = diffs) => (list.length ? list[Math.floor(x * (list.length - 1))] : NaN);
    console.log(
      `${tag(k)}|${tag(k + 1)} relative |dnu| median=${q(0.5).toExponential(2)} p99=${q(0.99).toExponential(2)} ` +
        `(two fine samples apart: median=${q(0.5, spread).toExponential(2)}) ` +
        `interior agrees on ${((100 * maskAgree) / maskTotal).toFixed(3)}%`,
    );
    fine = coarse;
  }
}

// The command line runs only when this file is the one node was started on: a deep figure
// imports `renderSpec` and `settleSpec` from here, and a worker is this file again.
if (!isMainThread) {
  const p = await load();
  const { spec, orbit } = workerData;
  parentPort.on("message", ([start, end]) => {
    const lanes = p.band(spec, orbit, start, end);
    parentPort.postMessage({ start, lanes }, [lanes.buffer]);
  });
} else if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const args = process.argv.slice(2);
  const at = args.indexOf("--only");
  const only = at >= 0 ? args[at + 1].split(",").map(Number) : null;
  if (args.includes("--caps")) await caps();
  else if (args.includes("--agree")) agree();
  else await fields(only);
}
