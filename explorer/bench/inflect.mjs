// What an inflection costs, asked in the one way that has an answer.
//
//   node explorer/bench/inflect.mjs [width] [height]
//
// One thread, the whole frame in one band, through the committed module — the same shape
// as `families.mjs` and `modes.mjs` beside it, and for the same reason: the pool and the
// canvas are not what is being asked about here.
//
// **The obvious measurement is confounded and this file exists because of it.** Timing
// the tab's own frame with and without a list compares two different *pictures*: the
// pre-map throws most of the plane far from the origin, those samples escape on the first
// iteration, and an inflected frame at the same view comes back several times *faster*
// than the plain one. That is a true and useful thing to know and it is the second panel
// below, but it is not what a pre-map costs — it is what a pre-map does to the picture.
//
// So the first panel holds the work still: a frame entirely **inside** the set at a fixed
// cap, where every sample of both runs the cap to the end and escapes nothing. Same
// samples, same iterations, same channels; the only difference is the pre-map. That
// ratio is the answer, and it is also the regression guard for the thing most likely to
// go quietly wrong — `inflect.rs` writes out the engine's channel table for one family
// precisely so an inflected frame is not paying the generic loop's 3.3x, and the `1 ÷ 0`
// column is the two loops measured against each other on identical work.
//
// Direct traps are not here: their band needs the gradient in the spec and this harness
// carries no colormaps. The question is the field loop, and they take the same pre-map at
// the same one call site.
//
// Nothing here asserts anything, the same as the rest of `bench/`.

import { load } from "./engine.mjs";
import { record } from "./output.mjs";

const [, , widthArg = "640", heightArg = "360"] = process.argv;
const WIDTH = Number(widthArg);
const HEIGHT = Number(heightArg);

const engine = await load();

/** Douady's rabbit: period 3, solid nodes on filaments, the set the tab opens on. */
const C = ["-0.12256117", "0.74486177"];

/** Points on the rabbit's filaments, found the way the tab's snap finds them and then
 *  frozen here — a bench that re-derived its own subject would be measuring the search. */
const POINTS = [
  ["0.5147755787567777", "0.2862978528129436"],
  ["0.8720263359600381", "0.1201944737209997"],
  ["-0.3457812500000001", "0.4519230769230770"],
  ["0.1839843749999999", "-0.5134615384615385"],
  ["-0.6132812500000002", "-0.1442307692307693"],
  ["0.7203125000000000", "0.6038461538461539"],
];

/**
 * A frame deep inside the rabbit's central node, and the cap every sample of it runs to.
 *
 * **The points of this panel are the frame's own centre, repeated**, and they have to be.
 * The pre-map fixes `p` and sends the disc of radius `r` about it onto the disc of radius
 * `r²`, so a tiny frame centred on `p` stays tiny and stays interior however many times
 * it is mapped — nothing escapes at any point count, and the iteration count is the cap,
 * exactly, for every sample of every row of every run. A `p` anywhere else throws this
 * frame somewhere else entirely and the panel stops measuring what it is for: the first
 * draft of this file used the filament points below and read the pre-map as *forty times
 * faster* than no pre-map, which is the confounding this whole file is about, arriving
 * inside the control.
 */
const INSIDE = { x: "-0.12256117", y: "0.74486177", w: "1e-3" };
const CAP = 2000;
const HELD_POINT = [INSIDE.x, INSIDE.y];

const FLAT = {
  gamma: 1,
  cycles: 1,
  phase: 0,
  reverse: false,
  mirror: false,
  transfer: { kind: "value" },
  rolloff: { kind: "none" },
};

function specFor(mode, n, frame, maxiter, points) {
  const spec = {
    schema: 1,
    family: { kind: "julia", degree: 2, c: C },
    viewport: { center_re: frame.x, center_im: frame.y, width: frame.w },
    resolution: [WIDTH, HEIGHT],
    mode,
    palette: FLAT,
  };
  if (maxiter !== null) spec.maxiter = maxiter;
  if (n > 0) spec.inflections = points.slice(0, n);
  return spec;
}

/** The field alone, best of `runs`: the shade is the same work either way and would only
 *  add noise to a ratio. */
function time(mode, n, frame, maxiter, points, runs = 3) {
  const spec = specFor(mode, n, frame, maxiter, points);
  const shape = engine.plan(spec);
  if (!shape.ok) throw new Error(`${mode} at ${n}: ${shape.why}`);
  let best = Infinity;
  for (let run = 0; run < runs; run += 1) {
    const started = performance.now();
    engine.band(spec, shape, 0, HEIGHT);
    best = Math.min(best, performance.now() - started);
  }
  return { ms: best, cap: shape.maxiter };
}

/** The held panel's list: one point, repeated as far as the counts go. */
const HELD = Array.from({ length: Math.max(...[0, 1, 2, 4, 6]) }, () => HELD_POINT);

const MODES = ["smooth", "tia", "stripe", "smooth_stripe", "itinerary", "curvature"];
const COUNTS = [0, 1, 2, 4, 6];

console.log(`${WIDTH}x${HEIGHT}, one thread, best of 3\n`);
console.log(`## The pre-map alone: all interior, cap pinned at ${CAP}, so the work is held still\n`);
console.log(`| mode | ${COUNTS.map(String).join(" | ")} | 1 ÷ 0 | 6 ÷ 0 |`);
console.log(`| --- | ${COUNTS.map(() => "---").join(" | ")} | --- | --- |`);
const held = [];
for (const mode of MODES) {
  const taken = COUNTS.map((n) => time(mode, n, INSIDE, CAP, HELD));
  const seam = taken[1].ms / taken[0].ms;
  const six = taken.at(-1).ms / taken[0].ms;
  console.log(
    `| ${mode} | ${taken.map((t) => `${t.ms.toFixed(0)} ms`).join(" | ")} |` +
      ` ${seam.toFixed(3)}x | ${six.toFixed(3)}x |`,
  );
  held.push({ mode, ms: taken.map((t) => t.ms), seam, six });
}
console.log(
  "\n`1 ÷ 0` is the seam: the same work through the engine's own specialized sweep and " +
    "through this crate's one-family copy of it. Near 1.000 is the whole point of writing " +
    "that table out. `6 ÷ 0` is six complex multiplies a sample against a 2,000-iteration " +
    "orbit.",
);

/** The tab's own opening frame, which is what a reader actually waits for. */
const OPEN = { x: "0", y: "0", w: "3.2" };
console.log(`\n## A real frame, at the depth policy's own cap — a different picture each time\n`);
console.log(`| mode | ${COUNTS.map(String).join(" | ")} | 6 ÷ 0 |`);
console.log(`| --- | ${COUNTS.map(() => "---").join(" | ")} | --- |`);
const real = [];
for (const mode of MODES) {
  const taken = COUNTS.map((n) => time(mode, n, OPEN, null, POINTS));
  const six = taken.at(-1).ms / taken[0].ms;
  console.log(
    `| ${mode} | ${taken.map((t) => `${t.ms.toFixed(0)} ms`).join(" | ")} | ${six.toFixed(2)}x |`,
  );
  real.push({ mode, ms: taken.map((t) => t.ms), six, cap: taken[0].cap });
}
console.log(
  "\nFaster, and by a lot, because it is not the same picture: the pre-map sends most of " +
    "the plane far from the origin and those samples escape on the first iteration. An " +
    "inflected frame is never the slow one.",
);

record("inflect", {
  width: WIDTH,
  height: HEIGHT,
  c: C,
  counts: COUNTS,
  inside: { frame: INSIDE, cap: CAP, rows: held },
  open: { frame: OPEN, rows: real },
});
