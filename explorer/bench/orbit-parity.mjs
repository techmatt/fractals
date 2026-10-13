// Two `perturb.wasm` modules, held to computing the same reference orbit byte for
// byte — and, with `--time`, timed against each other on one thread.
//
// The Rust side pins the orbit natively (`fractal-wallpapers/perturbation/tests/orbit_parity.rs`); this
// is the same question asked of the modules the page actually runs, because a
// change to the fixed-point arithmetic is compiled twice and only one of those is
// what a reader's browser executes.
//
//   node explorer/bench/orbit-parity.mjs [--old <wasm>] [--new <wasm>] [--time] [--runs N]
//
// `--old` defaults to the committed `explorer/perturb.wasm` and `--new` to the
// crate's own release build. Nothing here writes a file.

import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { load } from "./perturb.mjs";

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : fallback;
};
const asUrl = (path) => (path ? pathToFileURL(resolve(path)) : null);

const oldUrl = asUrl(option("--old", null)) ?? new URL("../perturb.wasm", import.meta.url);
const newUrl =
  asUrl(option("--new", null)) ??
  new URL("../perturb-wasm/target/wasm32-unknown-unknown/release/perturb.wasm", import.meta.url);
const timing = args.includes("--time");
const runs = Number(option("--runs", "3"));
const onlyTime = args.includes("--time-only");

const RESOLUTION = [1076, 576];
const WIDTHS = [1e-10, 1e-20, 1e-30, 1e-45, 1e-60, 1e-80, 1e-100, 1e-112];
const ANCHOR = ["-0.74501772828532335842941892835857434", "0.14993443275456819177805709088257971"];
const D3 = [
  "-0.3406250238987602341718262542321568083579609375",
  "1.2712298518725010680403152454016209423447578125",
];
const BASES = {
  2: [ANCHOR, ["-1.9", "0.0"], ["-0.75", "0.1"], ["-0.1011", "0.9563"], ["0.2", "0.0"]],
  3: [D3, ["0.1", "0.2"], ["-0.5", "0.3"], ["0.0", "0.7"]],
};
const bases = (degree) =>
  BASES[degree] ?? [["0.1", "0.2"], ["-0.5", "0.3"], ["0.3", "0.4"], ["-0.6", "0.2"]];

// A 64-bit LCG in BigInt, so that the digits are the same on every run.
let state = 0x0b5e55edc0ffeen;
const MASK = (1n << 64n) - 1n;
const digits = (count) => {
  let out = "";
  for (let i = 0; i < count; i++) {
    state = (state * 6364136223846793005n + 1442695040888963407n) & MASK;
    out += String(Number((state >> 33n) % 10n));
  }
  return out;
};
const lengthen = (base, tail) => (base.includes(".") ? base + tail : `${base}.${tail}`);

const view = (re, im, width, maxiter, degree, extra = {}) => ({
  schema: 1,
  center_re: re,
  center_im: im,
  width,
  resolution: RESOLUTION,
  maxiter,
  degree,
  ...extra,
});

function specs() {
  const out = [];
  for (let degree = 2; degree <= 6; degree++) {
    bases(degree).forEach(([baseRe, baseIm], b) => {
      for (const width of WIDTHS) {
        const re = lengthen(baseRe, digits(140));
        const im = lengthen(baseIm, digits(140));
        out.push([`m d${degree} b${b} w${width}`, view(re, im, width, 2000, degree)]);
        for (const anchor of ["parameter", "origin"]) {
          out.push([
            `j-${anchor} d${degree} b${b} w${width}`,
            view("0", "0", width, 1000, degree, { julia_re: re, julia_im: im, anchor }),
          ]);
        }
      }
      const re = lengthen(baseRe, digits(80));
      const im = lengthen(baseIm, digits(80));
      out.push([
        `p777 d${degree} b${b}`,
        view(re, im, 1e-45, 5000, degree, { reference_re: re, reference_im: im, period: 777 }),
      ]);
    });
  }
  for (const width of [1e-12, 1e-30, 1e-60]) {
    out.push([
      `p2838 w${width}`,
      view(...ANCHOR, width, 100000, 2, {
        reference_re: ANCHOR[0],
        reference_im: ANCHOR[1],
        period: 2838,
      }),
    ]);
  }
  for (const [degree, b, width, maxiter] of [
    [2, 0, 1e-40, 60000],
    [2, 1, 1e-112, 30000],
    [3, 0, 1e-54, 30000],
    [5, 1, 1e-100, 20000],
    [6, 3, 1e-30, 20000],
  ]) {
    const [baseRe, baseIm] = bases(degree)[b];
    const re = lengthen(baseRe, digits(130));
    const im = lengthen(baseIm, digits(130));
    out.push([`long d${degree} b${b} w${width}`, view(re, im, width, maxiter, degree)]);
  }
  return out;
}

// The four shapes the Deep tab spends its orbit time on: interior views, so that
// the orbit runs the whole cap. The widths are the ones the page's rule sizes at
// eight limbs (1e-100) and six (1e-60) across 1076 samples.
const TIMED = [
  ["d2 8 limbs cap 900k", view(...ANCHOR, 1e-100, 900000, 2)],
  ["d3 8 limbs cap 444k", view(lengthen("0.1", digits(120)), lengthen("0.2", digits(120)), 1e-100, 444000, 3)],
  ["d5 8 limbs cap 450k", view(lengthen("0.1", digits(120)), lengthen("0.2", digits(120)), 1e-100, 450000, 5)],
  ["d2 6 limbs cap 245k", view(...ANCHOR, 1e-60, 245000, 2)],
];

const before = await load(oldUrl);
const after = await load(newUrl);
console.log(`old: ${oldUrl.pathname}\nnew: ${newUrl.pathname}`);

if (!onlyTime) {
  let same = 0;
  const limbs = new Set();
  const moved = [];
  let points = 0;
  for (const [label, spec] of specs()) {
    const a = before.reference(spec);
    const b = after.reference(spec);
    // `plan` refuses a view whose limb count was clamped, and names none; the
    // orbit is still computed, at the clamp, and is compared all the same.
    limbs.add(before.plan(spec).limbs ?? 16);
    const equal =
      a !== null && b !== null && a.length === b.length && a.every((byte, i) => byte === b[i]);
    if (equal) {
      same += 1;
      points += (a.length - 16) / 16;
    } else moved.push(label);
  }
  const total = same + moved.length;
  console.log(`parity: ${same}/${total} specs byte-identical (${points} orbit points)`);
  if (moved.length) console.log(`moved: ${moved.join(", ")}`);
  console.log(`limb counts seen by plan: ${[...limbs].sort((x, y) => x - y).join(", ")}`);
  if (moved.length) process.exitCode = 1;
}

if (timing || onlyTime) {
  // The fastest of `runs`, old and new alternating, so that a machine that is
  // busy for a moment slows one run of each rather than every run of one.
  const once = (module, spec) => {
    const start = performance.now();
    const bytes = module.reference(spec);
    return [performance.now() - start, bytes];
  };
  for (const [label, spec] of TIMED) {
    // Warm both once, so that neither pays the tier-up the other has had.
    before.reference({ ...spec, maxiter: 5000 });
    after.reference({ ...spec, maxiter: 5000 });
    const a = { ms: Infinity, bytes: null };
    const b = { ms: Infinity, bytes: null };
    for (let r = 0; r < runs; r++) {
      for (const [module, slot] of [
        [before, a],
        [after, b],
      ]) {
        const [ms, bytes] = once(module, spec);
        slot.ms = Math.min(slot.ms, ms);
        slot.bytes = bytes;
      }
    }
    const equal = a.bytes.length === b.bytes.length && a.bytes.every((byte, i) => byte === b.bytes[i]);
    const count = (a.bytes.length - 16) / 16;
    console.log(
      `${label.padEnd(22)} points ${String(count).padStart(7)}  old ${a.ms.toFixed(0).padStart(5)} ms` +
        `  new ${b.ms.toFixed(0).padStart(5)} ms  x${(a.ms / b.ms).toFixed(2)}  ${equal ? "identical" : "MOVED"}`,
    );
    if (!equal) process.exitCode = 1;
  }
}
