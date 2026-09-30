// A zoom's field coloured exactly as the explorer's Deep tab colours it: the absolute scale,
// Straighten iter's knee and all, through the committed `engine.wasm`.
//
//   node builder/zoom_shade.mjs <palette> --field <in.f64> --width W --height H
//        --period L --phase P --lambda λ [--knee K] [--mirror] [--reverse] --out <out.rgb>
//
// The field is raw little-endian f64, `W × H`, NaN inside the set — the lane a deep field
// crosses in. The spec is `deep-render.js`'s `shadeSpecOf` of a view whose shade is the
// contract's defaults with those keys set, so nothing here knows how a knee bends `g`: that
// is `Palette::absolute_value` in the engine, and this is its caller. Writes `W × H` RGB
// triples, raw. `builder/zoom.py`'s `knee` mapping is the one caller
// (explorer_knee_ckpt157).

import { readFileSync, writeFileSync } from "node:fs";
import { load } from "../explorer/bench/engine.mjs";
import { defaultShade } from "../explorer/permalink.js";
import { shadeSpecOf } from "../explorer/deep-render.js";
import { install, stopsOf } from "../explorer/stops.js";
import { PALETTES } from "../explorer/palettes.js";

const args = process.argv.slice(2);
const name = args[0];
const option = (flag) => {
  const at = args.indexOf(flag);
  return at >= 0 ? args[at + 1] : null;
};
const need = (flag) => {
  const value = option(flag);
  if (value === null) throw new Error(`zoom_shade: ${flag} is required`);
  return value;
};
if (!name || name.startsWith("--") || !PALETTES.has(name)) {
  throw new Error(`zoom_shade: there is no palette called ${name} in explorer/palettes.js`);
}

const root = new URL("../explorer/", import.meta.url);
install(new Uint8Array(readFileSync(new URL("palettes.bin", root))));
const engine = await load(new URL("engine.wasm", root));

const knee = option("--knee");
const shade = {
  ...defaultShade(),
  mirror: args.includes("--mirror"),
  reverse: args.includes("--reverse"),
  scale: "absolute",
  lambda: Number(need("--lambda")),
  period: Number(need("--period")),
  phase: Number(need("--phase")),
  knee: knee === null ? null : Number(knee),
};
const width = Number(need("--width"));
const height = Number(need("--height"));
const spec = shadeSpecOf({ shade, level: null }, stopsOf(name), width, height);
const lanes = new Uint8Array(readFileSync(need("--field")));
if (lanes.length !== width * height * 8) {
  throw new Error(`zoom_shade: the field is ${lanes.length} bytes, not ${width}×${height} f64`);
}
const shaded = engine.shadeLevel(spec, lanes, 0);
if (shaded === null) throw new Error("zoom_shade: engine.wasm refused the spec");
const rgb = new Uint8Array(width * height * 3);
for (let at = 0; at < width * height; at += 1) {
  rgb.set(shaded.image.subarray(4 * at, 4 * at + 3), 3 * at);
}
writeFileSync(need("--out"), rgb);
