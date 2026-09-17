// A mode's derived parameters, held to the committed module.
//
// `engine-wasm`'s native tests hold the probe's hit test to `Painter::trace` and the
// first-order opacity to the stack `trace` paints. What is here is the page's claims about
// the module it actually runs:
//
//   * a derived texture weight **replays** to the bytes it drew, which is what lets Copy
//     link write one number and a link reopen what was seen;
//   * a derived opacity lands the typical painted pixel where it says it does;
//   * a probe with nothing in it derives nothing, and says so;
//   * a derived value is three significant figures, so the link spells it short.
//
//   node --test explorer/derive.test.mjs

import test from "node:test";
import assert from "node:assert/strict";

import { load, RAMP } from "./bench/engine.mjs";

const { plan, band, shadeLevel, probe, deriveOpacity } = await load();

/** The hard location deep in the spike that every explorer harness measures on. */
const ANCHOR = {
  center_re: "0.4104135054546244",
  center_im: "0.20967482476903096",
  width: "0.5622541254857749",
};

function specOf(mode, extra = {}) {
  return {
    schema: 1,
    family: { kind: "mandelbrot" },
    viewport: ANCHOR,
    resolution: [96, 54],
    mode,
    colormap: RAMP,
    ...extra,
  };
}

/** Oklab lightness of a gray sRGB8 value, which is all a ramp paints. */
function lightness(value) {
  const c = value / 255;
  return Math.cbrt(c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
}

const threeFigures = (value) => Number(value.toPrecision(3)) === value;

test("a derived texture weight replays to the bytes it drew", () => {
  for (const mode of ["smooth_mean_angle", "smooth_angle_min", "smooth_curvature"]) {
    const spec = specOf(mode);
    const shape = plan(spec);
    assert.ok(shape.ok, shape.why);
    const lanes = band(spec, shape, 0, 54);
    const derived = shadeLevel(spec, lanes, 2);
    assert.ok(derived.weight !== null, mode);
    assert.ok(derived.weight >= 0.05 && derived.weight <= shape.params.weight, `${mode}: ${derived.weight}`);
    assert.ok(threeFigures(derived.weight), `${mode}: ${derived.weight}`);
    const replayed = shadeLevel({ ...spec, params: { weight: derived.weight } }, lanes, 0);
    assert.equal(replayed.weight, null, "a replay derives nothing");
    assert.deepEqual(replayed.image, derived.image, mode);
  }
});

test("only a composite derives a weight", () => {
  const spec = specOf("smooth");
  const lanes = band(spec, plan(spec), 0, 54);
  assert.equal(shadeLevel(spec, lanes, 2).weight, null);
});

test("a derived opacity lands the typical painted pixel at mid-lightness", () => {
  for (const mode of ["direct_trap_multiply", "direct_trap_lines"]) {
    const spec = specOf(mode);
    const counts = probe(spec);
    const answer = deriveOpacity(spec, counts);
    assert.ok(answer.ok, answer.why);
    const { opacity, hit_share: share } = answer.probed;
    assert.ok(share > 0 && opacity !== null, mode);
    assert.ok(threeFigures(opacity), `${mode}: ${opacity}`);
    const painted = { ...spec, params: { opacity } };
    const image = band(painted, plan(painted), 0, 54);
    const ground = mode === "direct_trap_multiply" ? 1 : 0;
    const touched = [];
    for (let at = 0; at < image.length; at += 4) {
      const l = lightness(image[at]);
      if (Math.abs(l - ground) > 0.02) touched.push(l);
    }
    touched.sort((a, b) => a - b);
    const median = touched[Math.floor(touched.length / 2)];
    // The probe is its own grid, so the frame's median is near the target rather than on it.
    assert.ok(Math.abs(median - 0.5) < 0.1, `${mode}: median painted lightness ${median}`);
  }
});

test("the screened cross is held to its cap, and says the capped value", () => {
  const spec = specOf("direct_trap_screen");
  const answer = deriveOpacity(spec, probe(spec));
  assert.ok(answer.probed.opacity <= 0.15, String(answer.probed.opacity));
});

test("a probe with nothing in it derives nothing", () => {
  const spec = specOf("direct_trap_multiply", {
    viewport: { center_re: "100", center_im: "100", width: "1" },
  });
  const answer = deriveOpacity(spec, probe(spec));
  assert.ok(answer.ok);
  assert.equal(answer.probed.opacity, null);
  assert.equal(answer.probed.hit_share, 0);
});

test("only a screened or multiplied trap is probed", () => {
  assert.equal(probe(specOf("smooth")), null);
  const spec = specOf("smooth");
  assert.equal(deriveOpacity(spec, new Uint8Array(8)).ok, false);
});
