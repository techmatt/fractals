// What the tone operator costs, split from what the colouring costs.
//
// Every view a reader *makes* — a bare page, a pan, a zoom — is levelled: the module
// colours the finished field with no curve, measures the Oklab tone of what it drew, and
// where that tone sits outside the band of finished wallpapers colours the same field again
// through the curve it derived. That is two colourings and a measurement where a replayed
// view pays one colouring, and on the page it reads as a recolour of 1 565 ms against 398.
//
// This says which of the three the second is. `shade` alone is a colouring; `shade_level`
// with the derive bit is the whole operator; the difference between them, less one more
// colouring, is `level::tone_stats` — a million and three quarters of Oklab conversions and
// four selections over vectors it grows from nothing.
//
//   node explorer/bench/level.mjs [out.json] [runs]

import { load, RAMP } from "./engine.mjs";
import { record } from "./output.mjs";

const [, , out = "level.json", runs = "3"] = process.argv;
const RUNS = Number(runs);
const engine = await load();

/** The canvas `page.mjs` measures on, at the supersample the finishing pass uses — which is
 *  the frame the operator actually acts on, and four times the samples of the one-sample
 *  picture a reader sees before it. */
const WIDTH = 884;
const HEIGHT = 496;
const SUPERSAMPLE = 2;

const SPIKE = {
  center_re: "0.4104135054546244",
  center_im: "0.20967482476903096",
  width: "0.5622541254857749",
};

const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const time = (run) => {
  const started = process.hrtime.bigint();
  run();
  return Number(process.hrtime.bigint() - started) / 1e6;
};

const spec = {
  schema: 1,
  family: { kind: "mandelbrot" },
  viewport: SPIKE,
  resolution: [WIDTH, HEIGHT],
  supersample: SUPERSAMPLE,
  mode: "smooth",
  colormap: RAMP,
};
const shape = engine.plan(spec);
const lanes = engine.band(spec, shape, 0, HEIGHT);
console.log(
  `${WIDTH}×${HEIGHT} at ${SUPERSAMPLE}× — ${(WIDTH * HEIGHT * SUPERSAMPLE ** 2 / 1e6).toFixed(2)}M samples, ` +
    `${shape.lanes} lane, cap ${shape.maxiter}`,
);

/**
 * A map of `count` control points, which is what the real library's are.
 *
 * **The stop count is the variable, and it is why this sweeps.** A curve does not act on the
 * picture, it acts on the map — `level::curved_stops` densifies the stops, moves each one's
 * lightness, and pulls its chroma back into sRGB by a 28-step bisection with an 18-step cap
 * bisection inside it. That is per stop and not per pixel, so a two-stop ramp says nothing
 * about a map with hundreds, and the library's maps have hundreds.
 */
function mapOf(count) {
  const stops = [];
  for (let index = 0; index < count; index++) {
    const at = index / (count - 1);
    stops.push([
      at,
      [
        Math.round(255 * (0.5 + 0.5 * Math.sin(6.28 * at))),
        Math.round(255 * (0.5 + 0.5 * Math.sin(6.28 * at + 2.1))),
        Math.round(255 * (0.5 + 0.5 * Math.sin(6.28 * at + 4.2))),
      ],
    ]);
  }
  return { kind: "sequential", stops };
}

/** What the library holds, as `palettes.jsonl` counts them: most maps are one of these. */
const STOP_COUNTS = [2, 16, 64, 256, 1024];

const rows = {};
for (const count of STOP_COUNTS) {
  const at = { ...spec, colormap: count === 2 ? RAMP : mapOf(count) };
  // `shade` and `shade_level` both take the lanes and free them, so each run is handed its
  // own copy and the copy is not timed.
  const plain = [];
  const levelled = [];
  for (let run = 0; run < RUNS; run++) {
    plain.push(time(() => engine.shade(at, lanes.slice())));
    levelled.push(time(() => engine.shadeLevel(at, lanes.slice(), true)));
  }
  const one = median(plain);
  const both = median(levelled);
  const acted = engine.shadeLevel(at, lanes.slice(), true).acts;
  rows[count] = {
    stops: count,
    acted,
    shade_ms: one,
    shade_level_ms: both,
    over_ms: both - one,
    x: Number((both / one).toFixed(3)),
  };
  console.log(
    `${String(count).padStart(5)} stops   shade ${one.toFixed(0).padStart(5)} ms   ` +
      `+ derive ${both.toFixed(0).padStart(6)} ms   ` +
      `the curve costs ${(both - one).toFixed(0).padStart(6)} ms   ${(both / one).toFixed(2)}x` +
      (acted ? "" : "   (the curve does not act)"),
  );
}

record(out, {
  width: WIDTH,
  height: HEIGHT,
  supersample: SUPERSAMPLE,
  samples: WIDTH * HEIGHT * SUPERSAMPLE ** 2,
  rows,
});
