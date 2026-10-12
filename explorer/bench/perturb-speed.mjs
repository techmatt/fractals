// Single-thread price of the perturbation kernel, in ns per sample-iteration, for one
// or more builds of `perturb.wasm`, measured interleaved so drift lands on all alike.
//
//   node explorer/bench/perturb-speed.mjs <a.wasm> [b.wasm ...] [--rounds N] [--case name]
//
// Each case is one tile drawn with `compute_band` after a warm-up band; the figure is the
// best of the rounds, `elapsed / band_ran`.

import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { load } from "./perturb.mjs";

const args = process.argv.slice(2);
let rounds = 5;
let only = null;
const paths = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--rounds") rounds = Number(args[++i]);
  else if (args[i] === "--case") only = args[++i];
  else paths.push(args[i]);
}

const T54 = {
  re: "-0.745017728290198619298779298918851031533262270733325571484375",
  im: "0.149934432756897045833502829651788491167588360989048041953125",
};
const T54_D5 = {
  re: "-0.887826199618715930869553864091772850002956453437043331796875",
  im: "0.544060594138298891586824680413895627027934585266413727421875",
};
const ANCHOR = {
  re: "-0.74501772828532335842941892835857434",
  im: "0.14993443275456819177805709088257971",
};

const base = (frame, extra) => ({
  schema: 1,
  center_re: frame.re,
  center_im: frame.im,
  ...extra,
});

// Long orbit: the tangle at 1e-54, a 221k-point orbit (3.5 MB) — DRAM-resident on a pool.
// Short orbit: the anchor's period-2838 nucleus wrapped, 45 kB — L1/L2-resident.
const CASES = [
  ["d2 long off", base(T54, { width: 1e-54, maxiter: 221162, degree: 2, interior: false, resolution: [24, 14] })],
  ["d2 long on", base(T54, { width: 1e-54, maxiter: 221162, degree: 2, interior: true, resolution: [24, 14] })],
  ["d5 long off", base(T54_D5, { width: 1e-54, maxiter: 221162, degree: 5, interior: false, resolution: [12, 7] })],
  ["d5 long on", base(T54_D5, { width: 1e-54, maxiter: 221162, degree: 5, interior: true, resolution: [12, 7] })],
  [
    "d2 short off",
    base(ANCHOR, {
      width: 2e-11, maxiter: 60000, degree: 2, interior: false, resolution: [24, 14],
      reference_re: ANCHOR.re, reference_im: ANCHOR.im, period: 2838,
    }),
  ],
  [
    "d2 short on",
    base(ANCHOR, {
      width: 2e-11, maxiter: 60000, degree: 2, interior: true, resolution: [24, 14],
      reference_re: ANCHOR.re, reference_im: ANCHOR.im, period: 2838,
    }),
  ],
  // Parabolic: every sample gated, carried by `prove`, and run past its budget to escape.
  [
    "d2 cusp on",
    {
      schema: 1, center_re: "0.25000000000986960440108935861883", center_im: "0", width: 9.3e-17,
      maxiter: 2000000, interior: true, resolution: [5, 1],
    },
  ],
  [
    "d4 cusp on",
    {
      schema: 1, center_re: "0.47247039372044704118879333634817", center_im: "0", width: 9.3e-17,
      maxiter: 2000000, interior: true, resolution: [5, 1], degree: 4,
    },
  ],
].filter(([name]) => !only || name.includes(only));

const modules = await Promise.all(paths.map((p) => load(pathToFileURL(resolve(p)))));
const encoder = new TextEncoder();

function prepare(module, spec) {
  const { wasm } = module;
  const orbit = module.reference(spec);
  const text = encoder.encode(JSON.stringify(spec));
  const s = wasm.alloc(text.length);
  new Uint8Array(wasm.memory.buffer, s, text.length).set(text);
  const o = wasm.alloc(orbit.length);
  new Uint8Array(wasm.memory.buffer, o, orbit.length).set(orbit);
  const rows = spec.resolution[1];
  const bytes = rows * spec.resolution[0] * 8;
  return () => {
    const t0 = performance.now();
    const out = wasm.compute_band(s, text.length, o, orbit.length, 0, rows);
    const ms = performance.now() - t0;
    wasm.dealloc(out, bytes);
    return { ms, ran: wasm.band_ran(), saved: wasm.band_saved() };
  };
}

for (const [name, spec] of CASES) {
  const runs = modules.map((m) => prepare(m, spec));
  // Warm, and let V8's background tier-up land: wasm has no on-stack replacement, so a
  // function is optimized from its next call after the compile finishes.
  runs.forEach((r) => r());
  runs.forEach((r) => r());
  await new Promise((done) => setTimeout(done, 500));
  runs.forEach((r) => r());
  const best = runs.map(() => Infinity);
  let ran = 0;
  let saved = 0;
  for (let k = 0; k < rounds; k++) {
    runs.forEach((r, i) => {
      const got = r();
      ran = got.ran;
      saved = got.saved;
      best[i] = Math.min(best[i], (got.ms * 1e6) / got.ran);
    });
  }
  const cells = best.map((ns, i) => `${ns.toFixed(3)}${i > 0 ? ` (${(best[0] / ns).toFixed(3)}x)` : ""}`);
  console.log(`${name.padEnd(14)} ran ${String(ran).padStart(11)} saved ${String(saved).padStart(11)}  ns/it ${cells.join("  ")}`);
}
