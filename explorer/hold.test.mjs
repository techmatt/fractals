// Hold look, held to its promises. `node --test explorer/hold.test.mjs`.
//
// A held move is a move of more than one key, so what is worth testing is that Phase lands
// where the one sentence says: the colour at the reference value is what it was, to the
// rounding the written phase takes, however far and however often Lambda and Period are
// moved — and that Lambda and Period are left as the page set them.

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

test("a held Period keeps the colour at ν_m and leaves Lambda alone", () => {
  const start = { ...LOG, lambda: 0.3, period: 2, phase: 1.6666666666666667 };
  const anchor = hold.anchor(start, 500);
  for (const period of [0.05, 0.5, 7, 600, 1e5]) {
    const moved = hold.resolve({ ...start, period }, anchor);
    assert.equal(moved.period, period);
    assert.equal(moved.lambda, 0.3);
    assert.ok(apart(hold.colourAt(500, moved), anchor.colour) < 1e-4);
  }
});

test("a held Lambda keeps the colour at ν_m and the Period the page gave it", () => {
  for (const nu of [3.2, 232.6, 13334.7, 250000]) {
    const anchor = hold.anchor(LOG, nu);
    for (let step = 1; step <= 100; step += 1) {
      const lambda = step / 100;
      const period = 0.25 * (1 + step);
      const moved = hold.resolve({ ...LOG, lambda, period }, anchor);
      assert.equal(moved.lambda, lambda);
      assert.equal(moved.period, period);
      assert.ok(apart(hold.colourAt(nu, moved), anchor.colour) < 1e-4, `colour at ν ${nu}, λ ${lambda}`);
      assert.ok(moved.phase >= 0 && moved.phase < 1);
    }
  }
});

test("a back-and-forth drag comes home: the anchor, not the last rounding, is what holds", () => {
  const anchor = hold.anchor(LOG, 13334.7);
  let recipe = LOG;
  for (let pass = 0; pass < 20; pass += 1) {
    for (const period of [0.37, 9.1, 0.012, 0.25]) {
      recipe = hold.resolve({ ...recipe, period }, anchor);
    }
  }
  assert.equal(recipe.period, 0.25);
  assert.ok(apart(recipe.phase, 0) < 1e-4);
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
