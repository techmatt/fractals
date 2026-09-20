// Every colormap in the library, through four tone curves, hashed: the acceptance test
// for `level::curved_stops`, and the only one that covers the whole library.
//
//   node explorer/bench/curves.mjs [module.wasm] [count]
//
// **This is the one harness here that is a comparison rather than a reading.** Everything
// else in `bench/` measures; this hashes, so that a change to the operator's arithmetic can
// be held to drawing what it drew. Run it against the committed module and against a
// candidate and diff the two hashes — `explorer_shade_pool_ckpt136` rewrote the gamut test
// that `curved_stops` spends most of its time in, and **1,022 maps × 4 curves = 4,088
// levelled ramps came back with one unchanged hash**, which is what the bound of zero on
// that change means.
//
// The probe is a shaded ramp rather than a picture: a spec carrying `autolevel` replays the
// curve through `curved_stops`, bakes the 4,096-entry table from what comes back, and looks
// a 512-sample ramp up through it. Every stop of the map reaches some entry of that table,
// so a wrong stop anywhere moves a pixel of the strip. It needs the sibling checkout, for
// the colormap files; it says so and stops where there is none.
//
// About twenty minutes over the whole library on this machine, so `count` narrows it.

import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { load } from "./engine.mjs";

const [, , module = "explorer/engine.wasm", count = "9999"] = process.argv;
const engine = await load(pathToFileURL(module));

/** The wallpaper project's colormap files, which is where a map's stops live. */
const DIRECTORY = "../fractal-wallpapers/data/palettes";
let files;
try {
  files = readdirSync(DIRECTORY)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .slice(0, Number(count));
} catch {
  console.log(`no colormap library at ${DIRECTORY}; this needs the sibling checkout`);
  process.exit(0);
}

/**
 * Four curves, chosen to reach every branch of `Curve::lightness` and both bisections: a
 * gentle one, one that lifts the shadows hard, one with no tails and a heavy midtone, and
 * one whose core is a tenth of the range so most of the ramp runs through the tails.
 */
const CURVES = [
  { black_pt: 0.05, white_pt: 0.95, exponent: 1.0, out_ends: [0.08, 0.92] },
  { black_pt: 0.2, white_pt: 0.7, exponent: 0.6, out_ends: [0.05, 0.98] },
  { black_pt: 0.0, white_pt: 1.0, exponent: 2.4, out_ends: [0.15, 0.6] },
  { black_pt: 0.35, white_pt: 0.45, exponent: 1.8, out_ends: [0.02, 0.99] },
];

const SAMPLES = 512;

/** The ramp itself, with a row of zeros and a row of ones under it so that the frame's
 *  half-percent stretch lands exactly on 0 and 1 and leaves the ramp where it is — the
 *  same trick `render.js`'s `rampLanes` plays for the palette strip. */
const lanes = new Uint8Array(SAMPLES * 3 * 8);
{
  const values = new Float64Array(lanes.buffer);
  for (let at = 0; at < SAMPLES; at++) values[at] = at / (SAMPLES - 1);
  for (let at = 0; at < SAMPLES; at++) values[2 * SAMPLES + at] = 1;
}

const digest = createHash("sha256");
let drawn = 0;
let refused = 0;
for (const name of files) {
  const file = JSON.parse(readFileSync(`${DIRECTORY}/${name}`, "utf8"));
  for (const curve of CURVES) {
    const spec = {
      schema: 1,
      family: { kind: "mandelbrot" },
      viewport: { center_re: "0", center_im: "0", width: "4" },
      resolution: [SAMPLES, 3],
      mode: "smooth",
      colormap: { kind: file.kind, stops: file.stops },
      autolevel: curve,
    };
    try {
      digest.update(engine.shade(spec, lanes.slice()));
      drawn++;
    } catch {
      refused++;
    }
  }
}
console.log(`${files.length} maps x ${CURVES.length} curves: ${drawn} drawn, ${refused} refused`);
console.log(digest.digest("hex"));
