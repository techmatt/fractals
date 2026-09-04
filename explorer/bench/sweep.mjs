// Every family and every mode through the generalized module, once each.
//
// Two questions: does it draw at all, and is what comes back a picture rather
// than a flat rectangle. The second matters more than it sounds — a mode whose
// parameters landed wrong still returns a buffer.

import { load, RAMP } from "./engine.mjs";
import { record } from "./output.mjs";

const { plan, frame } = await load();

const JULIA_C = ["-0.07810228973371881", "-0.6514609012382414"];
const FAMILIES = {
  mandelbrot: { kind: "mandelbrot" },
  multibrot3: { kind: "multibrot", degree: 3 },
  multibrot4: { kind: "multibrot", degree: 4 },
  multibrot5: { kind: "multibrot", degree: 5 },
  julia: { kind: "julia", degree: 2, c: JULIA_C },
  julia3: { kind: "julia", degree: 3, c: JULIA_C },
  julia5: { kind: "julia", degree: 5, c: JULIA_C },
  phoenix: { kind: "phoenix", c: ["0.5667", "0"], p: ["-0.5", "0"] },
  // The classic slice's twin, one step of memory away from it. Most of the Phoenix
  // work the wallpaper project holds has a non-zero z₋₁, and a spec that carried the
  // constant and drew the classic set anyway would look exactly like one that worked.
  phoenix_memory: {
    kind: "phoenix",
    c: ["-0.5266783574752247", "-0.652322729101436"],
    p: ["-0.28353182998131243", "-0.02545285599096059"],
    z_prev: ["-0.10324356398202189", "0.43684294503006016"],
  },
};
const MODES = [
  "smooth", "tia", "stripe", "gaussian_int", "trap_circle", "curvature",
  "smooth_mean_angle", "smooth_angle_min", "smooth_trap_circle", "smooth_stripe",
  "smooth_curvature", "direct_trap_ring", "direct_trap_screen", "direct_trap_multiply",
  "direct_trap_lines", "threads", "itinerary",
];
const PARAMS = {
  stripe: { density: 9 }, smooth_stripe: { density: 9, weight: 0.6 },
  trap_circle: { radius: 1.5 }, smooth_trap_circle: { radius: 0.6 },
  threads: { sigma: 0.25, weight: 0.7 }, itinerary: { shift: 0.8 },
  direct_trap_ring: { threshold: 0.08, opacity: 0.5, radius: 1.2 },
  smooth_curvature: { weight: 0.4 },
};
const SIZE = [96, 54];

const specOf = (family, mode, params) => ({
  schema: 1, family: FAMILIES[family], resolution: SIZE, mode,
  ...(params ? { params } : {}), colormap: RAMP,
});

const distinct = (image) => new Set(Array.from({ length: image.length / 4 }, (_, i) => image[i * 4])).size;

const rows = [];
let broken = 0;
for (const family of Object.keys(FAMILIES)) {
  for (const mode of MODES) {
    const spec = specOf(family, mode, null);
    try {
      const { shape, image } = frame(spec);
      const tones = distinct(image);
      rows.push({ family, mode, lanes: shape.lanes, direct: shape.direct, exact: shape.exact, tones });
      if (tones < 4) { console.log(`FLAT  ${family} ${mode}: ${tones} tones`); broken++; }
    } catch (error) {
      console.log(`FAIL  ${family} ${mode}: ${error.message}`);
      broken++;
    }
  }
}

// Every parameter the contract offers, on the family it is most visible over.
console.log("\nparameters:");
for (const [mode, params] of Object.entries(PARAMS)) {
  const plain = frame(specOf("julia", mode, null));
  const tuned = frame(specOf("julia", mode, params));
  const moved = plain.image.some((value, at) => value !== tuned.image[at]);
  console.log(`  ${mode} ${JSON.stringify(params)}: ${moved ? "moves the picture" : "NO EFFECT"}`);
  if (!moved) broken++;
}

// The refusals that have to be refusals.
console.log("\nrefusals:");
for (const [what, spec] of [
  ["an unknown mode", specOf("julia", "nautilus", null)],
  ["a parameter the mode has no room for", specOf("julia", "smooth", { density: 3 })],
  ["a modulate under a rank transfer", { ...specOf("julia", "itinerary", null), palette: { transfer: { kind: "rank" } } }],
  ["a fractional degree", { schema: 1, family: { kind: "fractional_multibrot", degree: "2.5" }, resolution: SIZE, colormap: RAMP }],
  ["a julia with no c", { schema: 1, family: { kind: "julia" }, resolution: SIZE, colormap: RAMP }],
  ["a multibrot at degree 9", { schema: 1, family: { kind: "multibrot", degree: 9 }, resolution: SIZE, colormap: RAMP }],
  ["mirror on a cyclic map", { ...specOf("julia", "smooth", null), palette: { mirror: true }, colormap: { ...RAMP, kind: "cyclic" } }],
]) {
  const answer = plan(spec);
  console.log(`  ${what}: ${answer.ok ? "ACCEPTED — wrong" : answer.why.slice(0, 96)}`);
  if (answer.ok) broken++;
}

// The home view each family comes back with, which is what a bare link means.
console.log("\nhome views:");
const homes = {};
for (const family of Object.keys(FAMILIES)) {
  const answer = plan({ schema: 1, family: FAMILIES[family] });
  homes[family] = answer.home;
  console.log(`  ${family}: x ${answer.home.x} y ${answer.home.y} w ${answer.home.w}`);
}

record("sweep.json", { rows, homes });
console.log(`\n${rows.length} family/mode pairs drawn, ${broken} problems`);
