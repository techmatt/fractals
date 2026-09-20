// What a frame costs as a function of how finely it is cut into bands.
//
// The pool aims a band at `BAND_TARGET_MS` and subdivides the queue as bands report what
// they cost, so a deep or expensive view is drawn in hundreds of bands rather than the
// forty-six a cheap one takes. That is deliberate — a cancel costs one band, so a band is
// how long the page can ignore the reader — and it is only free if a band has no fixed
// cost of its own.
//
// It has one. Every `compute_band` call parses the spec, resolves a plan, and allocates its
// own output; a direct trap's band additionally iterates `3 * ss` sample rows past itself
// at each edge so that its Lanczos-3 reduction has a neighbourhood, which at one output row
// per band is most of what it computes. This prices both, on one thread, with no pool and
// no browser in the way.
//
//   node explorer/bench/cut.mjs [out.json] [runs]

import { load, RAMP } from "./engine.mjs";
import { record } from "./output.mjs";

const [, , out = "cut.json", runs = "3"] = process.argv;
const RUNS = Number(runs);
const { plan, band } = await load();

/** The canvas the page draws on at a 1600x1000 window, which is what `page.mjs` measures. */
const WIDTH = 884;
const HEIGHT = 496;

/** How many bands to cut the frame into. 46 is `bandsOf` for twelve workers; the rest are
 *  what the duration target's re-cut reaches on an expensive view. */
const CUTS = [1, 12, 46, 91, 181, 410];

/** A direct trap at this frame on one thread is three minutes, and the question is a ratio
 *  rather than a duration, so its case is measured on a frame an eighth the samples and at
 *  the same band ROWS — a band's padding overhead is `(rows + 6) / rows` and does not care
 *  how wide the frame is. */
const TRAP_WIDTH = 312;
const TRAP_HEIGHT = 176;
const TRAP_CUTS = [1, 16, 44, 88];

const SPIKE = { center_re: "0.4104135054546244", center_im: "0.20967482476903096", width: "0.5622541254857749" };

const CASES = [
  { name: "smooth", supersample: 1, spec: { mode: "smooth" } },
  { name: "smooth@2", supersample: 2, spec: { mode: "smooth" } },
  {
    name: "direct_trap_ring@2",
    supersample: 2,
    width: TRAP_WIDTH,
    height: TRAP_HEIGHT,
    cuts: TRAP_CUTS,
    runs: 1,
    spec: { mode: "direct_trap_ring", params: { radius: 0.5 }, colormap: RAMP },
  },
];

const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

/** The row ranges `bandsOf`/`recut` would produce for this many pieces, evenly. */
function ranges(height, pieces) {
  const cut = [];
  for (let piece = 0; piece < pieces; piece++) {
    cut.push([
      Math.round((piece * height) / pieces),
      Math.round(((piece + 1) * height) / pieces),
    ]);
  }
  return cut.filter(([start, end]) => end > start);
}

const rows = {};
for (const view of CASES) {
  const width = view.width ?? WIDTH;
  const height = view.height ?? HEIGHT;
  const spec = {
    schema: 1,
    family: { kind: "mandelbrot" },
    viewport: SPIKE,
    resolution: [width, height],
    ...view.spec,
  };
  if (view.supersample > 1) spec.supersample = view.supersample;
  const shape = plan(spec);
  const whole = [];
  for (const pieces of view.cuts ?? CUTS) {
    const cut = ranges(height, pieces);
    const timed = [];
    for (let attempt = 0; attempt < (view.runs ?? RUNS); attempt++) {
      const started = process.hrtime.bigint();
      for (const [start, end] of cut) band(spec, shape, start, end);
      timed.push(Number(process.hrtime.bigint() - started) / 1e6);
    }
    const ms = median(timed);
    if (pieces === 1) whole.push(ms);
    const over = ms / whole[0];
    const perBand = height / cut.length;
    rows[`${view.name}:${pieces}`] = {
      bands: cut.length,
      rows_a_band: Number(perBand.toFixed(2)),
      median_ms: ms,
      x_whole: Number(over.toFixed(3)),
    };
    console.log(
      `${view.name.padEnd(20)} ${String(cut.length).padStart(4)} bands  ` +
        `${perBand.toFixed(1).padStart(6)} rows  ${ms.toFixed(0).padStart(7)} ms  ` +
        `${over.toFixed(2)}x the whole frame`,
    );
  }
}

record(out, { width: WIDTH, height: HEIGHT, cap: plan({ schema: 1, family: { kind: "mandelbrot" }, viewport: SPIKE, resolution: [WIDTH, HEIGHT], mode: "smooth" }).maxiter, rows });
