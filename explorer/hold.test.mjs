// Hold look, held to its promises. `node --test explorer/hold.test.mjs`.
//
// A held move is a move of several keys, so what is worth testing is that the several keys
// land where the one sentence says: the band density and the colour at the reference value
// are what they were, to the rounding the written numbers take, however far and however
// often Lambda and Period are moved — and that nothing else is touched.

import assert from "node:assert/strict";
import test from "node:test";

import * as hold from "./hold.js";

const LOG = { lambda: 0, period: 0.25, phase: 0, gamma: 1, scale: "absolute" };

/** Circular distance in turns. */
function apart(a, b) {
  const d = Math.abs(a - b) % 1;
  return Math.min(d, 1 - d);
}

test("compress is the engine's Box–Cox, the log at zero and ν − 1 at one", () => {
  assert.equal(hold.compress(Math.E, 0), 1);
  assert.equal(hold.compress(5, 1), 4);
  assert.ok(Math.abs(hold.compress(100, 0.3) - (100 ** 0.3 - 1) / 0.3) < 1e-12);
  assert.equal(hold.compress(0, 0), Math.log(hold.FLOOR));
  assert.equal(hold.compress(-3, 0.5), hold.compress(0, 0.5));
});

test("a held Lambda keeps the density and the colour at ν_m, across the whole range", () => {
  for (const nu of [3.2, 232.6, 13334.7, 250000]) {
    const anchor = hold.anchor(LOG, nu);
    let recipe = LOG;
    for (let step = 1; step <= 100; step += 1) {
      const lambda = step / 100;
      recipe = hold.resolve({ ...recipe, lambda }, "lambda", anchor);
      const density = hold.density(nu, recipe.lambda, recipe.period);
      assert.ok(Math.abs(density / anchor.density - 1) < 1e-3, `density at ν ${nu}, λ ${lambda}`);
      assert.ok(apart(hold.colourAt(nu, recipe), anchor.colour) < 1e-4, `colour at ν ${nu}, λ ${lambda}`);
      assert.ok(recipe.phase >= 0 && recipe.phase < 1);
    }
  }
});

test("the new period is period · ν_m^(λ′ − λ)", () => {
  const nu = 13334.7;
  const moved = hold.resolve({ ...LOG, lambda: 0.3 }, "lambda", hold.anchor(LOG, nu));
  const exact = 0.25 * nu ** 0.3;
  assert.ok(Math.abs(moved.period / exact - 1) < 1e-3);
});

test("a held Period keeps the colour at ν_m and leaves Lambda alone", () => {
  const start = { ...LOG, lambda: 0.3, period: 2, phase: 1.6666666666666667 };
  const anchor = hold.anchor(start, 500);
  for (const period of [0.05, 0.5, 7, 600, 1e5]) {
    const moved = hold.resolve({ ...start, period }, "period", anchor);
    assert.equal(moved.period, period);
    assert.equal(moved.lambda, 0.3);
    assert.ok(apart(hold.colourAt(500, moved), anchor.colour) < 1e-4);
  }
});

test("a back-and-forth drag comes home: the anchor, not the last rounding, is what holds", () => {
  const anchor = hold.anchor(LOG, 13334.7);
  let recipe = LOG;
  for (let pass = 0; pass < 20; pass += 1) {
    for (const lambda of [0.37, 0.91, 0.12, 0]) {
      recipe = hold.resolve({ ...recipe, lambda }, "lambda", anchor);
    }
  }
  assert.equal(recipe.period, 0.25);
  assert.ok(apart(recipe.phase, 0) < 1e-4);
});

test("any other key passes through untouched", () => {
  const anchor = hold.anchor(LOG, 100);
  const next = { ...LOG, phase: 0.3 };
  assert.equal(hold.resolve(next, "phase", anchor), next);
  assert.equal(hold.resolve({ ...LOG, gamma: 2 }, "gamma", anchor).gamma, 2);
});

test("the reference is the median of lane 0's escaped samples, and memoized on the field", () => {
  const values = new Float64Array([5, NaN, 1, 9, 3, 1e9, 1e9, 1e9]);
  // Two lanes of four: lane 1 must not be read.
  const field = { values, width: 2, height: 2, supersample: 1 };
  assert.equal(hold.reference(field), 5);
  values[0] = 100;
  assert.equal(hold.reference(field), 5, "a field answers once");
  assert.equal(hold.reference({ values: new Float64Array([NaN, NaN]), width: 2, height: 1 }), null);
  assert.equal(hold.reference(null), null);
  const even = { values: new Float64Array([4, 1, 2, 8]), width: 4, height: 1 };
  assert.equal(hold.reference(even), 3);
});
