// What a family costs, and what the nine specialized call sites buy.
//
// `modes.mjs` holds the family still and sweeps the modes; this holds the mode
// still — `smooth`, the only one the specialization reaches — and sweeps the
// families. Each is drawn at its OWN home view, because a family's home is the
// frame it comes back with when nobody names one, and comparing nine families
// over one rectangle would mostly be comparing how much of each is off screen.
//
// Two modules, and the second is the whole point. The committed one takes the
// specialized `smooth` site per family; a module built with `--cfg generic_loop`
// sends `smooth` down the fallthrough with everything else. The specialization is
// invisible from outside the module, so the only way to know a rebuild still has
// it is to run the loop it replaced. A bare cfg and never a cargo feature: a
// feature enters the crate's metadata hash, and the committed module would stop
// rebuilding to its own bytes.
//
//   cargo build --manifest-path explorer/engine-wasm/Cargo.toml --release \
//     --target wasm32-unknown-unknown --target-dir artifacts/generic-wasm \
//     --config 'build.rustflags=["--cfg","generic_loop"]'
//   node explorer/bench/families.mjs \
//     artifacts/generic-wasm/wasm32-unknown-unknown/release/explorer_engine_wasm.wasm
//
// With no argument only the first column is measured, which is the cheap run.

import { load, RAMP } from "./engine.mjs";
import { record } from "./output.mjs";
import { CONSTANTS as ANCHORS } from "../catalog.js";
import { FAMILIES } from "../permalink.js";
import { familySpecOf } from "../render.js";

const WIDTH = 1280;
const HEIGHT = 720;
// Three, so the median is the middle one: a wasm frame's first run is
// baseline-compiled and the tiered-up runs are what the page actually gets.
const RUNS = 3;

const [, , generic = "", out = "families.json"] = process.argv;

/** The family's shipped constants, in the shape `familySpecOf` reads them. */
function constantsOf(family) {
  const held = {};
  for (const [key, text] of Object.entries(ANCHORS[family] ?? {})) held[key] = { text };
  return held;
}

const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

/** Every family's `smooth` frame through one module, timed. */
async function sweep(url) {
  const { plan, band } = await load(url);
  const measured = {};
  for (const family of FAMILIES) {
    const spec = { schema: 1, family: familySpecOf(family, constantsOf(family)) };
    const home = plan(spec).home;
    const full = {
      ...spec,
      viewport: { center_re: String(home.x), center_im: String(home.y), width: String(home.w) },
      resolution: [WIDTH, HEIGHT],
      mode: "smooth",
      colormap: RAMP,
    };
    const shape = plan(full);
    if (!shape.ok) throw new Error(`${family}: ${shape.why}`);
    const runs = [];
    for (let run = 0; run < RUNS; run++) {
      const started = process.hrtime.bigint();
      band(full, shape, 0, HEIGHT);
      runs.push(Number(process.hrtime.bigint() - started) / 1e6);
    }
    measured[family] = { maxiter: shape.maxiter, field_ms: median(runs) };
    const ms = median(runs).toFixed(0).padStart(6);
    console.log(`${family.padEnd(12)} cap ${String(shape.maxiter).padStart(5)}   ${ms} ms`);
  }
  return measured;
}

console.log(`specialized (the committed module), ${WIDTH}x${HEIGHT} smooth, each family at home:`);
const special = await sweep();

let loop = null;
if (generic) {
  console.log("\ngeneric (--cfg generic_loop):");
  loop = await sweep(generic);
} else {
  console.log("\nno generic module given; the second column is not measured");
}

// Relative to the cheapest family, which is what a reader wants: the absolute
// numbers are this machine, and the ratios are the arithmetic.
const cheapest = Math.min(...Object.values(special).map((row) => row.field_ms));
console.log("\nrelative to the cheapest family:");
const rows = {};
for (const family of FAMILIES) {
  const row = {
    maxiter: special[family].maxiter,
    field_ms: special[family].field_ms,
    relative: special[family].field_ms / cheapest,
    generic_ms: loop ? loop[family].field_ms : null,
    speedup: loop ? loop[family].field_ms / special[family].field_ms : null,
  };
  rows[family] = row;
  const tail =
    row.speedup === null
      ? ""
      : `   generic ${row.generic_ms.toFixed(0).padStart(6)} ms   ${row.speedup.toFixed(2)}x`;
  console.log(`  ${family.padEnd(12)} ${row.relative.toFixed(2).padStart(5)}x${tail}`);
}

record(out, { width: WIDTH, height: HEIGHT, runs: RUNS, rows });
