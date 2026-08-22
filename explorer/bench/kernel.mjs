// The field kernel, timed on one thread with no pool and no browser.
//
// What `explorer_generalize` has to hold is the 1280x720 mandelbrot-smooth anchor,
// and a worker pool measures the pool as much as the kernel. This calls the
// committed module directly, whole frame in one band, so the number is the
// arithmetic and nothing else.

import { load, RAMP } from "./engine.mjs";
import { record } from "./output.mjs";

const [, , out = "kernel.json", only = "", runs = "3"] = process.argv;
const { plan, band } = await load();

const ANCHOR = ["0.4104135054546244", "0.20967482476903096", "0.5622541254857749"];
const WIDTH = 1280;
const HEIGHT = 720;
const RUNS = Number(runs);

const home = plan({ schema: 1, family: { kind: "mandelbrot" } }).home;
const views = {
  anchor: { center_re: ANCHOR[0], center_im: ANCHOR[1], width: ANCHOR[2] },
  home: { center_re: String(home.x), center_im: String(home.y), width: String(home.w) },
};

const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const rows = {};
for (const [name, viewport] of Object.entries(views)) {
  if (only && name !== only) continue;
  const spec = { schema: 1, family: { kind: "mandelbrot" }, viewport, resolution: [WIDTH, HEIGHT], mode: "smooth", colormap: RAMP };
  const shape = plan(spec);
  const runs = [];
  for (let run = 0; run < RUNS; run++) {
    const started = process.hrtime.bigint();
    band(spec, shape, 0, HEIGHT);
    runs.push(Number(process.hrtime.bigint() - started) / 1e6);
  }
  rows[`${name}:smooth`] = { maxiter: shape.maxiter, runs, median_ms: median(runs) };
  console.log(`${name} smooth ${WIDTH}x${HEIGHT} cap ${shape.maxiter}: ${median(runs).toFixed(0)} ms  [${runs.map((r) => r.toFixed(0)).join(", ")}]`);
}

record(out, { width: WIDTH, height: HEIGHT, rows });
