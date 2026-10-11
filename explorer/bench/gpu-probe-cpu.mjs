// The GPU probe's CPU half: the shipped kernel (`perturb.wasm`, through `perturb.mjs`) timed
// on the bundles in `artifacts/gpu-probe/`, at the same frames, resolution and cap the page
// runs the WGSL port on. Workers default to the Deep tab's count on this machine,
// min(16, cores), each a worker thread holding its own instance and taking bands of BAND rows
// from one queue. Steps are the f64 iteration counts the bundle carries, so steps/s reads
// beside the page's; each frame's result is also held to the bundle's own f64 field.
//
//   node explorer/bench/gpu-probe-cpu.mjs [--workers N] [--ids a,b] [--rows FILE]
//
// `--rows` is a JSONL of corpus rows, read only for a Mandelbrot frame's `period`, which a
// bundle's manifest does not carry; none of the six exported frames has one. Like the rest of
// `bench/` it asserts nothing.
import { readFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";

const ROOT = new URL("../../", import.meta.url);
const BAND = 4;

if (!isMainThread) {
  const { load } = await import(new URL("explorer/bench/perturb.mjs", ROOT));
  const p = await load(new URL("explorer/perturb.wasm", ROOT));
  const { spec, orbit } = workerData;
  parentPort.on("message", ([r0, r1]) => {
    if (r0 < 0) process.exit(0);
    const out = p.band(spec, orbit, r0, r1);
    parentPort.postMessage([r0, r1, out], [out.buffer]);
  });
  parentPort.postMessage(null);
} else {
  const args = process.argv.slice(2);
  const opt = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
  const workers = Number(opt("--workers", Math.min(16, availableParallelism())));
  const only = opt("--ids", null)?.split(",");
  const dir = new URL("artifacts/gpu-probe/", ROOT);
  const index = JSON.parse(readFileSync(new URL("index.json", dir), "utf8"));
  const rowsFile = opt("--rows", null);
  const rows = rowsFile
    ? Object.fromEntries(
        readFileSync(rowsFile, "utf8")
          .trim()
          .split("\n")
          .map((l) => JSON.parse(l))
          .map((r) => [r.id, r]),
      )
    : {};
  const { load } = await import(new URL("explorer/bench/perturb.mjs", ROOT));
  const p = await load(new URL("explorer/perturb.wasm", ROOT));
  console.log(`perturb.wasm, ${workers} workers, bands of ${BAND} rows, node ${process.version}`);
  console.log("frame                      res      cap      steps      ref s   wall s   steps/s    vs bundle f64: max|d| >1e-6  class");
  for (const e of index.frames) {
    if (only && !only.includes(e.id)) continue;
    const m = JSON.parse(readFileSync(new URL(e.manifest, dir), "utf8"));
    const row = rows[e.id];
    const spec = {
      schema: 1,
      center_re: m.spec.re,
      center_im: m.spec.im,
      width: m.width,
      resolution: [m.width_px, m.height_px],
      supersample: 1,
      maxiter: m.cap,
      interior: false,
      degree: m.degree,
    };
    if (m.julia) Object.assign(spec, { julia_re: m.spec.julia_re, julia_im: m.spec.julia_im, anchor: m.spec.anchor });
    if (!m.julia && row?.period) spec.period = row.period;
    const bin = readFileSync(new URL(m.bin, dir));
    const arr = (name, T) => {
      const a = m.arrays.find((x) => x.name === name);
      return new T(bin.buffer.slice(bin.byteOffset + a.offset, bin.byteOffset + a.offset + a.bytes));
    };
    const iters = arr("f64_iterations", Uint32Array);
    const f64 = arr("f64_smooth", Float64Array);
    let steps = 0;
    for (const v of iters) steps += v;

    const t0 = performance.now();
    const orbit = p.reference(spec);
    const refS = (performance.now() - t0) / 1000;

    const H = m.height_px;
    const W = m.width_px;
    const got = new Float64Array(W * H);
    let next = 0;
    let done = 0;
    const t1 = performance.now();
    await new Promise((resolve) => {
      const pool = [];
      for (let i = 0; i < workers; i++) {
        const w = new Worker(new URL(import.meta.url), { workerData: { spec, orbit } });
        pool.push(w);
        const feed = () => {
          if (next >= H) return w.postMessage([-1, -1]);
          const r0 = next;
          next = Math.min(H, next + BAND);
          w.postMessage([r0, next]);
        };
        w.on("message", (msg) => {
          if (msg) {
            const [r0, r1, out] = msg;
            got.set(new Float64Array(out.buffer, out.byteOffset, (r1 - r0) * W), r0 * W);
            done += r1 - r0;
            if (done === H) {
              pool.forEach((x) => x.terminate());
              return resolve();
            }
          }
          feed();
        });
      }
    });
    const wall = (performance.now() - t1) / 1000;
    let maxd = 0;
    let over = 0;
    let cls = 0;
    for (let i = 0; i < got.length; i++) {
      const a = got[i];
      const b = f64[i];
      if (Number.isNaN(a) !== Number.isNaN(b)) {
        cls++;
        continue;
      }
      if (Number.isNaN(a)) continue;
      const d = Math.abs(a - b);
      if (d > maxd) maxd = d;
      if (d > 1e-6) over++;
    }
    console.log(
      `${e.id.padEnd(26)} ${`${W}x${H}`.padEnd(8)} ${String(m.cap).padEnd(8)} ${steps.toExponential(3).padEnd(10)} ${refS.toFixed(3).padStart(6)} ${wall.toFixed(2).padStart(8)}   ${(steps / wall).toExponential(2)}    ${maxd.toExponential(2)} ${String(over).padStart(6)} ${String(cls).padStart(6)}`,
    );
  }
}
