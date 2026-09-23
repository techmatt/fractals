// A palette as the engine bakes it, lifted once into a lookup table the deep zoom's recolour
// tool can index: a linear ramp shaded through the committed `engine.wasm` under a stretch
// fixed at [0, 1], so every entry is the colour the engine gives that position.
//
//   node builder/zoom_palette.mjs <name> [--mirror] [--reverse] [--out <path>]
//
// Writes `SIZE` RGB triples, raw, to `artifacts/deep-zoom/palettes/<name>[-mirror][-reverse].rgb`
// (or `--out`). The table is sixteen times the engine's own 4096 entries, so it samples the
// engine's lookup rather than approximating it; the recolour indexes it with floor(x * SIZE).
// Nothing about the colouring is reimplemented here: the stops come from `palettes.bin`
// through `stops.js`, and the bake, the fold and the lookup are the module's.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { load } from "../explorer/bench/engine.mjs";
import { defaultShade } from "../explorer/permalink.js";
import { install, stopsOf } from "../explorer/stops.js";
import { PALETTES } from "../explorer/palettes.js";

export const SIZE = 65536;

/** `zoom_fields.mjs`'s output root, spelled the same way. */
function zoomDir() {
  const moved = process.env.FRACTAL_WEBSITE_ZOOM_DIR;
  return moved ? moved : fileURLToPath(new URL("../artifacts/deep-zoom/", import.meta.url));
}
const COLS = 4096;
const ROWS = SIZE / COLS;

const args = process.argv.slice(2);
const name = args[0];
if (!name || name.startsWith("--")) {
  console.error("usage: node builder/zoom_palette.mjs <name> [--mirror] [--reverse] [--out <path>]");
  process.exit(2);
}
if (!PALETTES.has(name)) throw new Error(`there is no palette called ${name} in explorer/palettes.js`);
const mirror = args.includes("--mirror");
const reverse = args.includes("--reverse");
if (mirror && PALETTES.get(name).cyclic) {
  throw new Error(`${name} is cyclic, and the link contract refuses to fold a cyclic map`);
}
const at = args.indexOf("--out");
const suffix = `${mirror ? "-mirror" : ""}${reverse ? "-reverse" : ""}`;
const out = at >= 0 ? args[at + 1] : `${zoomDir()}/palettes/${name}${suffix}.rgb`;

install(new Uint8Array(readFileSync(fileURLToPath(new URL("../explorer/palettes.bin", import.meta.url)))));
const engine = await load();

const shade = { ...defaultShade(), mirror, reverse };
const spec = {
  schema: 1,
  family: { kind: "mandelbrot" },
  viewport: {},
  resolution: [COLS, ROWS],
  mode: "smooth",
  palette: shade,
  colormap: stopsOf(name),
};

const ramp = new Float64Array(SIZE);
for (let i = 0; i < SIZE; i++) ramp[i] = (i + 0.5) / SIZE;
const bytes = () => new Uint8Array(ramp.buffer.slice(0));

// The statistics' shape is the module's own: measure the ramp, then pin its stretch.
const measured = engine.shadeStats({ ...spec, colormap: undefined }, bytes());
if (!measured.ok || !measured.pooled) throw new Error(`shade_stats: ${JSON.stringify(measured)}`);
const stats = measured.stats;
const stretch = stats.Field?.Value;
if (stretch === undefined) throw new Error(`unexpected statistics ${JSON.stringify(stats)}`);
stretch.low = 0;
stretch.span = 1;
stretch.flat = false;

// One band that is the whole ramp, so the lanes handed over are the field entire.
const rgba = engine.shadeBand(spec, stats, bytes(), 0, ROWS);
const rgb = new Uint8Array(SIZE * 3);
for (let i = 0; i < SIZE; i++) rgb.set(rgba.subarray(4 * i, 4 * i + 3), 3 * i);

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, rgb);
console.log(`${out}: ${SIZE} entries of ${name}${suffix}`);
