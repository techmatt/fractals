// The measure half of `band_autolevel/v1`, held to the committed module.
//
// `engine-wasm`'s own tests hold the port to the operator on a native build. That is
// not the module: wasm's `cbrt`, `ln` and `powf` are its own libm and not the native
// one, and a curve that is the operator's on the native build and a unit of last place
// off in the browser is a curve nobody would notice was wrong. So the first test runs
// the module's `derive_level` on the pixels the native test reads, and asks for the
// operator's own verdict and curve, to within `MODULE_TOLERANCE` below.
//
// The rest are the page's two claims about `shade_level`: it is `shade` when it is not
// asked to derive, and a curve it derived **replays** to the same bytes — which is the
// whole reason Copy link can write five numbers and a link can reopen what was seen.
//
// The last few hold the palette strip to the same module: it is a ramp shaded through
// the table the picture uses, curve included, so it lives beside the curve's tests.
//
//   node --test explorer/level.test.mjs
//
// The pixels are in ignored `artifacts/level-derive/`, written on a machine with the
// wallpaper checkout by `engine-wasm/make-derive-cases.py`. Without them that test says
// it is skipped and why; the other tests need nothing but the module.

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { load, RAMP } from "./bench/engine.mjs";
import { rampLanes, rampSpecOf } from "./render.js";

const { plan, band, shade, shadeLevel, deriveLevel } = await load();

const CASES = JSON.parse(
  readFileSync(new URL("./engine-wasm/level-derive-cases.json", import.meta.url), "utf-8"),
);
const PIXELS = new URL("../artifacts/level-derive/", import.meta.url);

/** The hard location deep in the spike that every explorer harness measures on. */
const ANCHOR = {
  center_re: "0.4104135054546244",
  center_im: "0.20967482476903096",
  width: "0.5622541254857749",
};

/** A map with no white in it, so a field picture through it sits below the band. */
const DIM = { kind: "sequential", stops: [[0, [0, 0, 0]], [0.5, [40, 30, 70]], [1, [120, 110, 130]]] };

function specOf(mode, colormap, extra = {}) {
  return {
    schema: 1,
    family: { kind: "mandelbrot" },
    viewport: ANCHOR,
    resolution: [96, 54],
    supersample: 2,
    mode,
    colormap,
    ...extra,
  };
}

function lanesOf(spec) {
  const shape = plan(spec);
  assert.ok(shape.ok, shape.why);
  return { shape, lanes: band(spec, shape, 0, spec.resolution[1]) };
}

const bits = (value) => {
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, value, true);
  return view.getBigUint64(0, true);
};

/** How far the module may sit from the operator: a few units of last place.
 *
 *  Not zero, and that is measured rather than conceded. The native build derives all
 *  4,411 stored curves bit for bit (`engine-wasm`'s tests); the module's `cbrt` is
 *  wasm's own libm and lands one unit of last place away on some pixels, which moves a
 *  percentile by as much. No explorer view is ever compared with a stored curve — a
 *  seat replays its own — so what this holds is the verdict and the numbers to well
 *  inside anything a stop list can see. */
const MODULE_TOLERANCE = 1e-12;

function sameCurve(ours, theirs, what) {
  let far = 0;
  for (const [name, a, b] of [
    ["black_pt", ours.black_pt, theirs.black_pt],
    ["white_pt", ours.white_pt, theirs.white_pt],
    ["exponent", ours.exponent, theirs.exponent],
    ["out_ends[0]", ours.out_ends[0], theirs.out_ends[0]],
    ["out_ends[1]", ours.out_ends[1], theirs.out_ends[1]],
  ]) {
    assert.ok(
      Math.abs(a - b) <= MODULE_TOLERANCE,
      `${what}: ${name} is ${a} in the module and ${b} in the operator`,
    );
    far = Math.max(far, Math.abs(a - b));
  }
  return far;
}

test("the module derives the operator's curve from the operator's own pixels", (t) => {
  const curves = new Map(CASES.curves.filter((c) => c.key !== null).map((c) => [c.key, c.curve]));
  let read = 0;
  for (const stats of CASES.stats) {
    const path = new URL(`${stats.key}.rgb`, PIXELS);
    if (!existsSync(path)) continue;
    const rgb = readFileSync(path);
    const rgba = new Uint8Array((rgb.length / 3) * 4);
    for (let pixel = 0, at = 0; at < rgb.length; pixel += 4, at += 3) {
      rgba[pixel] = rgb[at];
      rgba[pixel + 1] = rgb[at + 1];
      rgba[pixel + 2] = rgb[at + 2];
      rgba[pixel + 3] = 255;
    }
    const theirs = curves.get(stats.key);
    const ours = deriveLevel(rgba);
    assert.equal(ours.acts, theirs.applies && !theirs.identity, `${stats.key}: act or not`);
    const far = sameCurve(ours.curve, theirs, stats.key);
    t.diagnostic(`${stats.key}: largest difference ${far}${bits(far) === 0n ? " (exact)" : ""}`);
    read += 1;
  }
  if (read === 0) {
    t.skip("no decoded bases in artifacts/level-derive; run engine-wasm/make-derive-cases.py");
  }
});

test("shade_level without derive is shade, with a header that says nothing acted", () => {
  const spec = specOf("smooth", DIM);
  const { lanes } = lanesOf(spec);
  const plain = shade(spec, lanes);
  const levelled = shadeLevel(spec, lanes, false);
  assert.equal(levelled.acts, false);
  assert.deepEqual(levelled.image, plain);
});

for (const mode of ["smooth", "smooth_stripe"]) {
  test(`${mode}: a derived curve replays to the bytes the derivation drew`, () => {
    const spec = specOf(mode, DIM);
    const { shape, lanes } = lanesOf(spec);
    assert.equal(shape.levels, true, `${mode} is a coloring the operator acts on`);
    const derived = shadeLevel(spec, lanes, true);
    assert.equal(derived.acts, true, "a dim map under the band has to act, or this tests nothing");
    const replayed = shade({ ...spec, autolevel: derived.curve }, lanes);
    assert.deepEqual(derived.image, replayed);
    assert.notDeepEqual(derived.image, shade(spec, lanes));
  });
}

test("a picture already in band comes back as the plain picture", () => {
  // The anchor through a black-to-white ramp, found in band when this was written; if
  // that ever stops being true the assertion that matters is still the second one.
  const spec = specOf("smooth", RAMP);
  const { lanes } = lanesOf(spec);
  const derived = shadeLevel(spec, lanes, true);
  if (!derived.acts) assert.deepEqual(derived.image, shade(spec, lanes));
  else assert.deepEqual(derived.image, shade({ ...spec, autolevel: derived.curve }, lanes));
});

test("a mode the operator does not act on is never levelled", () => {
  const offered = ["itinerary"];
  let modulate = 0;
  for (const mode of offered) {
    const spec = specOf(mode, DIM);
    const { shape, lanes } = lanesOf(spec);
    if (shape.levels) continue;
    modulate += 1;
    const derived = shadeLevel(spec, lanes, true);
    assert.equal(derived.acts, false, `${mode} was levelled`);
    assert.deepEqual(derived.image, shade(spec, lanes));
  }
  assert.ok(modulate > 0, "none of these modes is one the operator skips, so this tested nothing");
});

test("a spec that already replays a curve is refused a derivation", () => {
  const spec = specOf("smooth", DIM);
  const { lanes } = lanesOf(spec);
  const curve = { black_pt: 0.1, white_pt: 0.6, exponent: 1.2, out_ends: [0.05, 0.9] };
  assert.equal(shadeLevel({ ...spec, autolevel: curve }, lanes, true), null);
});

// The palette strip over the picker is drawn by the module through the table the picture
// is drawn through: `render.js`'s `rampSpecOf` over `rampLanes`. What follows holds that
// construction to the module, and pins the fact the Reverse chip rests on.

const STRIP = 256;
const HUES = {
  kind: "sequential",
  stops: [[0, [20, 10, 60]], [0.4, [200, 60, 40]], [0.7, [240, 200, 90]], [1, [250, 250, 240]]],
};
const RECIPE = {
  gamma: 1,
  cycles: 1,
  phase: 0,
  reverse: false,
  mirror: false,
  transfer: { kind: "value" },
  rolloff: { kind: "none" },
};

function strip(colormap, recipe, options = {}) {
  const view = { shade: { ...RECIPE, ...recipe }, level: options.level ?? null };
  return shade(rampSpecOf(view, colormap, STRIP, options), rampLanes(STRIP)).slice(0, STRIP * 4);
}

test("the strip runs the map from its first color to its last, and ignores the transfer", () => {
  const plain = strip(RAMP, {});
  assert.deepEqual([...plain.slice(0, 3)], [0, 0, 0]);
  assert.deepEqual([...plain.slice((STRIP - 1) * 4, (STRIP - 1) * 4 + 3)], [255, 255, 255]);
  for (let at = 1; at < STRIP; at++) assert.ok(plain[at * 4] >= plain[(at - 1) * 4], `column ${at}`);
  // The transfer spends the map over a frame's histogram, which is before the strip's 0 to 1.
  assert.deepEqual(strip(RAMP, { transfer: { kind: "rank" } }), plain);
  assert.notDeepEqual(strip(RAMP, { gamma: 2 }), plain);
});

test("reverse on a mirrored map changes no byte of the strip", () => {
  for (const map of [RAMP, DIM, HUES]) {
    for (const recipe of [{}, { gamma: 0.45, cycles: 3, phase: 0.2 }, { rolloff: { kind: "aces" } }]) {
      const folded = strip(map, { ...recipe, mirror: true });
      assert.deepEqual(strip(map, { ...recipe, mirror: true, reverse: true }), folded);
      assert.notDeepEqual(strip(map, { ...recipe, reverse: true }), strip(map, recipe));
    }
  }
});

test("under a direct trap the strip spends no gamma, cycles or phase, and keeps the fold", () => {
  const moved = { gamma: 2, cycles: 3, phase: 0.4 };
  assert.deepEqual(strip(HUES, moved, { direct: true }), strip(HUES, {}));
  assert.deepEqual(strip(HUES, { ...moved, mirror: true }, { direct: true }), strip(HUES, { mirror: true }));
});

test("the strip carries the tone curve in force", () => {
  const curve = { black_pt: 0.1, white_pt: 0.6, exponent: 1.2, out_ends: [0.05, 0.9] };
  assert.notDeepEqual(strip(DIM, {}, { level: curve }), strip(DIM, {}));
});
