// What a Julia frame costs against the Mandelbrot frame it came from.
//
//   node explorer/bench/julia.mjs
//
// The question *Julia at this c* raises is whether the second picture is a different
// price from the first, and it has to be asked with everything else held: the same `c`,
// the same width, the same cap, the same grid, the same committed `perturb.wasm`, one
// thread and one band. Anything a pool or a canvas would add is the same on both sides
// and would only add noise to a ratio.
//
// Two numbers come out of it and they answer different questions. **Milliseconds a
// frame** is what a reader waits, and it moves with how much of the frame is interior —
// a deep Julia frame around `z = c` is mostly boundary where the Mandelbrot frame at the
// same place is mostly minibrot. **Nanoseconds a sample-iteration** is what the kernel
// costs, and that is the one that says whether the Julia path is the same loop: it
// should be, because it is, minus two additions an iteration.
//
// Nothing here asserts anything, the same as the rest of `bench/`.

import { load } from "./perturb.mjs";
import { record } from "./output.mjs";

const [, , out = "julia.json", runs = "3"] = process.argv;
const RUNS = Number(runs);
const perturb = await load();

/** The audit's anchor: a period-2838 minibrot nucleus in the seahorse valley. */
const ANCHOR = {
  center_re: "-0.74501772828532335842941892835857434",
  center_im: "0.14993443275456819177805709088257971",
};

/** Small enough that the whole sweep is a couple of minutes on one thread. */
const [WIDTH, HEIGHT] = [221, 124];

/** Three widths, because the interior share is what moves the frame time and it moves
 *  in opposite directions on the two sides as the view goes down. */
const WIDTHS = [2e-9, 2e-10, 2e-11];

const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

/** One frame, timed, with the reference orbit outside the clock: it is computed once a
 *  frame by the page too, and it is the same orbit on both sides. */
function time(spec) {
  const orbit = perturb.reference(spec);
  const runs = [];
  let interior = 0;
  for (let run = 0; run < RUNS; run++) {
    const started = process.hrtime.bigint();
    const band = perturb.band(spec, orbit, 0, HEIGHT);
    runs.push(Number(process.hrtime.bigint() - started) / 1e6);
    if (run === 0) {
      const lanes = new Float64Array(band.buffer);
      interior = lanes.filter((value) => Number.isNaN(value)).length / lanes.length;
    }
  }
  // The orbit alone, so the price of the jump can be stated rather than guessed.
  const orbitStarted = process.hrtime.bigint();
  perturb.reference(spec);
  const orbitMs = Number(process.hrtime.bigint() - orbitStarted) / 1e6;
  return { median_ms: median(runs), runs, interior, orbit_ms: orbitMs, orbit_bytes: orbit.length };
}

const rows = {};
for (const width of WIDTHS) {
  const cap = perturb.maxiter(width);
  const frame = { ...ANCHOR, schema: 1, width, resolution: [WIDTH, HEIGHT], maxiter: cap };
  const mandelbrot = time(frame);
  const julia = time({ ...frame, julia_re: ANCHOR.center_re, julia_im: ANCHOR.center_im });

  // Sample-iterations, which is the only way to compare two frames whose samples do not
  // do the same amount of work. `plan` does not report it, so it is counted here.
  const both = { mandelbrot, julia };
  for (const [name, taken] of Object.entries(both)) {
    rows[`${width.toExponential()}:${name}`] = { cap, ...taken };
  }
  console.log(
    `width ${width.toExponential()} cap ${cap}: ` +
      `mandelbrot ${mandelbrot.median_ms.toFixed(0)} ms (${(100 * mandelbrot.interior).toFixed(0)}% interior), ` +
      `julia ${julia.median_ms.toFixed(0)} ms (${(100 * julia.interior).toFixed(0)}% interior), ` +
      `ratio ${(julia.median_ms / mandelbrot.median_ms).toFixed(2)}x, ` +
      `orbit ${mandelbrot.orbit_ms.toFixed(1)} / ${julia.orbit_ms.toFixed(1)} ms`,
  );
}

// ---------------------------------------------------------------- the loop itself
//
// **A frame time cannot answer "is the Julia loop the same price", and the table above
// is why**: the two frames do wildly different amounts of work, because the interior
// share is different and an interior sample either stops early or pays the whole cap.
// So the loop is priced with the work held equal instead — a cap low enough that no
// sample of either frame escapes, and the interior switch off, which makes every sample
// of both run exactly `cap` iterations and nothing else. What is left in the difference
// is the recurrence: the Julia one is the Mandelbrot one minus two additions.
const LOOP_CAP = 1200;
const loop = {};
for (const [name, extra] of [
  ["mandelbrot", {}],
  ["julia", { julia_re: ANCHOR.center_re, julia_im: ANCHOR.center_im }],
]) {
  const spec = {
    ...ANCHOR,
    ...extra,
    schema: 1,
    width: 2e-11,
    resolution: [WIDTH, HEIGHT],
    maxiter: LOOP_CAP,
    interior: false,
  };
  const orbit = perturb.reference(spec);
  const runs = [];
  let escaping = 1;
  for (let run = 0; run < RUNS; run++) {
    const started = process.hrtime.bigint();
    const band = perturb.band(spec, orbit, 0, HEIGHT);
    runs.push(Number(process.hrtime.bigint() - started) / 1e6);
    if (run === 0) {
      const lanes = new Float64Array(band.buffer);
      escaping = lanes.filter((value) => !Number.isNaN(value)).length;
    }
  }
  const iterations = WIDTH * HEIGHT * LOOP_CAP;
  const ns = (median(runs) * 1e6) / iterations;
  loop[name] = { median_ms: median(runs), escaping, ns_per_sample_iteration: ns };
  console.log(
    `${name} loop, cap ${LOOP_CAP}, interior off: ${median(runs).toFixed(0)} ms, ` +
      `${ns.toFixed(2)} ns/sample-iteration, ${escaping} samples escaped (0 is the point)`,
  );
}

record(out, { width: WIDTH, height: HEIGHT, runs: RUNS, rows, loop_cap: LOOP_CAP, loop });
