// Fit, held to its promises. `node --test explorer/fit.test.mjs`.
//
// A fit is three numbers chosen so that Absolute runs the palette `PASSES` times across the
// stretch Leveled measures, in the compression that matches Leveled's shape. What is worth
// testing is that sentence measured — the turns between the stretch's ends, and where each
// quantile of a frame lands under both scales — and the things a reader leans on: that the
// numbers are ones the contract writes, that a frame with nothing in it is no fit rather
// than a wrong one, and that the fit leans to the log where the log is as good.

import assert from "node:assert/strict";
import test from "node:test";

import * as fit from "./fit.js";
import { compress } from "./hold.js";

const LEVELED = { gamma: 1, cycles: 1, phase: 0, lambda: 1, transfer: { kind: "value" } };

/** A sorted frame: `count` samples whose ranks run through `shape`, a map of `[0, 1)`. */
function frame(count, shape) {
  return Float64Array.from({ length: count }, (_, at) => shape((at + 0.5) / count)).sort();
}

/** Deep-ish: a bulk a little above the floor of the frame, and a long thin tail. */
const DEEP = frame(20000, (u) => 30000 * (1 + 0.2 * u + 1.5 * u ** 12));
/** Shallow: escape counts from a few to a thousand, most of them low. */
const SHALLOW = frame(20000, (u) => 5 + 900 * u ** 3);

/** Leveled's turn for a value, as the engine lays it at the recipe above. */
function leveledTurn(sorted, nu) {
  const at = (p) => sorted[Math.round((p / 100) * (sorted.length - 1))];
  const low = at(fit.CLIP_LOW);
  const high = at(fit.CLIP_HIGH);
  return Math.min(1, Math.max(0, (nu - low) / (high - low)));
}

/** Absolute's turn, unwrapped. */
function absoluteTurn(recipe, nu) {
  return compress(nu, recipe.lambda) / recipe.period + recipe.phase;
}

/** The turns a recipe lays between the stretch's two ends. */
function span(sorted, recipe) {
  const at = (p) => sorted[Math.round((p / 100) * (sorted.length - 1))];
  return absoluteTurn(recipe, at(fit.CLIP_HIGH)) - absoluteTurn(recipe, at(fit.CLIP_LOW));
}

test("a fit runs the palette PASSES times across the stretch, bottom end at the phase", () => {
  for (const sorted of [DEEP, SHALLOW]) {
    const found = fit.fitSorted(sorted, LEVELED);
    assert.ok(found !== null);
    // To the rounding of a four-figure period.
    assert.ok(Math.abs(span(sorted, found) / fit.PASSES - 1) < 1e-3, `span ${span(sorted, found)}`);
    const bottom = absoluteTurn(found, sorted[Math.round((fit.CLIP_LOW / 100) * (sorted.length - 1))]);
    const off = bottom - Math.round(bottom);
    assert.ok(Math.abs(off) < 1e-3, `bottom lands ${off} off a whole turn`);
  }
});

test("its λ is Leveled's shape: the best line in that λ is within a tenth of a turn", () => {
  for (const sorted of [DEEP, SHALLOW]) {
    const found = fit.fitSorted(sorted, LEVELED);
    assert.ok(found.miss < 0.1, `miss ${found.miss}`);
    // And the miss is the line's, measured here: the least-squares line in the chosen λ.
    const nus = Array.from({ length: 1000 }, (_, at) => sorted[Math.floor(((at + 0.5) / 1000) * sorted.length)]);
    const x = nus.map((nu) => compress(nu, found.lambda));
    const t = nus.map((nu) => leveledTurn(sorted, nu));
    const mean = (a) => a.reduce((sum, v) => sum + v) / a.length;
    const [xm, tm] = [mean(x), mean(t)];
    const slope = mean(x.map((v, at) => (v - xm) * (t[at] - tm))) / mean(x.map((v) => (v - xm) ** 2));
    const miss = Math.sqrt(mean(x.map((v, at) => (tm + slope * (v - xm) - t[at]) ** 2)));
    assert.ok(Math.abs(miss - found.miss) < 1e-9);
  }
});

test("the fit's numbers are ones a reader could type and a link writes", () => {
  const found = fit.fitSorted(DEEP, LEVELED);
  assert.equal(Math.round(found.lambda * fit.LAMBDA_STEPS), found.lambda * fit.LAMBDA_STEPS);
  assert.ok(found.lambda >= 0 && found.lambda <= 1);
  assert.equal(Number(found.period.toPrecision(4)), found.period);
  assert.ok(found.period > 0);
  assert.equal(Number(found.phase.toFixed(4)), found.phase);
  assert.ok(found.phase >= 0 && found.phase < 1);
});

test("a deep frame is fitted in the log, where a multiplied ν is only a moved phase", () => {
  const found = fit.fitSorted(DEEP, LEVELED);
  assert.equal(found.lambda, 0);
  // And the look holds under a zoom that doubles every escape count: the same bands, the
  // palette turned by a constant.
  const doubled = DEEP.map((nu) => nu * 2);
  const turns = (sorted) => [0.1, 0.5, 0.9].map((u) => absoluteTurn(found, sorted[Math.floor(u * sorted.length)]));
  const [a, b] = [turns(DEEP), turns(doubled)];
  const moved = b[0] - a[0];
  for (let at = 1; at < 3; at += 1) assert.ok(Math.abs(b[at] - a[at] - moved) < 1e-9);
});

test("the log is chosen only where it is as good as the best line to within the slack", () => {
  // Linear through the bulk and no tail: the line in ν is exact, and the log is not.
  const uniform = frame(20000, (u) => 10 + 1000 * u);
  const found = fit.fitSorted(uniform, LEVELED);
  assert.ok(found.lambda > 0, `λ ${found.lambda}`);
  assert.ok(found.miss < 0.01 + fit.LAMBDA_SLACK);
});

test("Leveled's cycles do not move the pass count", () => {
  // They may move λ — the slack is in turns of colour, and three cycles put the log three
  // times as far from Leveled — but the busyness is `PASSES`, whatever Leveled's was.
  for (const cycles of [1, 3]) {
    const found = fit.fitSorted(SHALLOW, { ...LEVELED, cycles });
    const turns = span(SHALLOW, found);
    assert.ok(Math.abs(turns / fit.PASSES - 1) < 1e-3, `${cycles} cycles span ${turns}`);
  }
});

test("Leveled's phase carries across", () => {
  const plain = fit.fitSorted(SHALLOW, LEVELED);
  const turned = fit.fitSorted(SHALLOW, { ...LEVELED, phase: 0.25 });
  const d = (((turned.phase - plain.phase) % 1) + 1) % 1;
  assert.ok(Math.abs(d - 0.25) < 1e-3);
});

test("a frame with nothing to fit is no fit", () => {
  assert.equal(fit.fitSorted(null, LEVELED), null);
  assert.equal(fit.fitSorted(new Float64Array(10).fill(3), LEVELED), null);
  assert.equal(fit.fitSorted(new Float64Array(5000).fill(3), LEVELED), null);
  assert.equal(fit.fit(null, LEVELED), null);
  // All interior: a field of nothing but NaN.
  const inside = { values: new Float32Array(64 * 64).fill(Number.NaN), width: 64, height: 64 };
  assert.equal(fit.fit(inside, LEVELED), null);
});

test("fit reads lane 0 of a field, and nothing past it", () => {
  const width = 128;
  const height = 64;
  const values = new Float32Array(width * height * 2);
  for (let at = 0; at < width * height; at += 1) values[at] = 100 + (at % 997);
  // A second lane of wild values that must not move the fit.
  for (let at = width * height; at < values.length; at += 1) values[at] = 1e9;
  const found = fit.fit({ values, width, height, supersample: 1 }, LEVELED);
  const lane0 = fit.fit({ values: values.slice(0, width * height), width, height }, LEVELED);
  assert.deepEqual(found, lane0);
});
