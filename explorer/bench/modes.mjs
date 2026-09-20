// What each mode costs in wasm, at the frame the explorer actually draws.
//
// The wallpapers repo has this column for the native engine, measured at 384x216
// over three frames; this is the same question asked of the browser build at the
// one resolution the page uses, so the two can be compared rather than assumed
// equal. Field and shade are timed apart, because the page pays them apart.
//
// A second module may be named, the way `families.mjs` takes one, and then every mode is
// timed through both with the runs alternated: the way to price a build flag per mode, and
// the only honest way to do it, because measuring one column now and the other later is how
// a loaded machine gets read as a code change. What it was written for:
//
//   cargo build --manifest-path explorer/engine-wasm/Cargo.toml --release //     --target wasm32-unknown-unknown --target-dir artifacts/simd-wasm //     --config 'build.rustflags=["-C","target-feature=+simd128"]'
//   node explorer/bench/modes.mjs //     artifacts/simd-wasm/wasm32-unknown-unknown/release/explorer_engine_wasm.wasm

import { load, RAMP } from "./engine.mjs";
import { record } from "./output.mjs";

const [, , other = null] = process.argv;
const { plan, band, shade } = await load();
const against = other === null ? null : await load(new URL(`../../${other}`, import.meta.url));

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

/** One module's field and shade for one spec, timed apart. */
function timed(engine, spec, shape) {
  let started = process.hrtime.bigint();
  const lanes = engine.band(spec, shape, 0, HEIGHT);
  const field = Number(process.hrtime.bigint() - started) / 1e6;
  started = process.hrtime.bigint();
  if (!shape.direct) engine.shade(spec, lanes);
  return [field, Number(process.hrtime.bigint() - started) / 1e6];
}

const rows = {};
for (const mode of MODES) {
  const spec = { schema: 1, family: { kind: "mandelbrot" }, viewport, resolution: [WIDTH, HEIGHT], mode, colormap: RAMP };
  const shape = plan(spec);
  if (!shape.ok) { console.log(`${mode}: ${shape.why}`); continue; }
  const fields = [];
  const shades = [];
  const theirs = [];
  const theirShades = [];
  for (let run = 0; run < RUNS; run++) {
    // Alternated, and the order flipped between runs.
    const mine = () => { const [f, s] = timed({ band, shade }, spec, shape); fields.push(f); shades.push(s); };
    const yours = () => {
      if (against === null) return;
      const [f, s] = timed(against, spec, against.plan(spec));
      theirs.push(f);
      theirShades.push(s);
    };
    if (run % 2 === 0) { mine(); yours(); } else { yours(); mine(); }
  }
  rows[mode] = { lanes: shape.lanes, direct: shape.direct, field_ms: median(fields), shade_ms: median(shades) };
  let line = `${mode.padEnd(20)} field ${median(fields).toFixed(0).padStart(6)} ms   shade ${median(shades).toFixed(0).padStart(5)} ms`;
  if (against !== null) {
    rows[mode].other_field_ms = median(theirs);
    rows[mode].other_shade_ms = median(theirShades);
    rows[mode].x_field = Number((median(fields) / median(theirs)).toFixed(3));
    rows[mode].x_shade = shape.direct ? null : Number((median(shades) / median(theirShades)).toFixed(3));
    line +=
      `   |  other ${median(theirs).toFixed(0).padStart(6)} / ${median(theirShades).toFixed(0).padStart(5)} ms` +
      `   x ${rows[mode].x_field.toFixed(2)} field` +
      (shape.direct ? "" : ` / ${rows[mode].x_shade.toFixed(2)} shade`);
  }
  console.log(line);
}

const base = rows.smooth.field_ms;
const ratios = Object.fromEntries(Object.entries(rows).map(([mode, row]) => [mode, row.field_ms / base]));
console.log("\nrelative to smooth:");
for (const [mode, ratio] of Object.entries(ratios)) console.log(`  ${mode.padEnd(20)} ${ratio.toFixed(2)}x`);
record("modes.json", { width: WIDTH, height: HEIGHT, other, rows, ratios });
