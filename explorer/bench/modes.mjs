// What each mode costs in wasm, at the frame the explorer actually draws.
//
// The wallpapers repo has this column for the native engine, measured at 384x216
// over three frames; this is the same question asked of the browser build at the
// one resolution the page uses, so the two can be compared rather than assumed
// equal. Field and shade are timed apart, because the page pays them apart.

import { load, RAMP } from "./engine.mjs";
import { record } from "./output.mjs";

const { plan, band, shade } = await load();

const MODES = [
  "smooth", "tia", "stripe", "gaussian_int", "trap_circle", "curvature",
  "smooth_mean_angle", "smooth_angle_min", "smooth_trap_circle", "smooth_stripe",
  "smooth_curvature", "direct_trap_ring", "direct_trap_screen", "direct_trap_multiply",
  "direct_trap_lines", "threads", "itinerary",
];
const WIDTH = 1280;
const HEIGHT = 720;
const RUNS = 2;

const home = plan({ schema: 1, family: { kind: "mandelbrot" } }).home;
const viewport = { center_re: String(home.x), center_im: String(home.y), width: String(home.w) };

const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const rows = {};
for (const mode of MODES) {
  const spec = { schema: 1, family: { kind: "mandelbrot" }, viewport, resolution: [WIDTH, HEIGHT], mode, colormap: RAMP };
  const shape = plan(spec);
  if (!shape.ok) { console.log(`${mode}: ${shape.why}`); continue; }
  const fields = [];
  const shades = [];
  for (let run = 0; run < RUNS; run++) {
    let started = process.hrtime.bigint();
    const lanes = band(spec, shape, 0, HEIGHT);
    fields.push(Number(process.hrtime.bigint() - started) / 1e6);
    started = process.hrtime.bigint();
    if (!shape.direct) shade(spec, lanes);
    shades.push(Number(process.hrtime.bigint() - started) / 1e6);
  }
  rows[mode] = { lanes: shape.lanes, direct: shape.direct, field_ms: median(fields), shade_ms: median(shades) };
  console.log(`${mode.padEnd(20)} field ${median(fields).toFixed(0).padStart(6)} ms   shade ${median(shades).toFixed(0).padStart(5)} ms`);
}

const base = rows.smooth.field_ms;
const ratios = Object.fromEntries(Object.entries(rows).map(([mode, row]) => [mode, row.field_ms / base]));
console.log("\nrelative to smooth:");
for (const [mode, ratio] of Object.entries(ratios)) console.log(`  ${mode.padEnd(20)} ${ratio.toFixed(2)}x`);
record("modes.json", { width: WIDTH, height: HEIGHT, rows, ratios });
