// The screensaver's pure parts: the interval table, the fitting ladder, the correction and
// the bag. The part that needs a page is driven by hand and measured in the README.

import assert from "node:assert/strict";
import test from "node:test";

import {
  Bag,
  budgetOf,
  Correction,
  DEFAULT_EVERY,
  EVERY,
  everyOf,
  FASTEST_BUDGET_S,
  fit,
  LADDER,
  sizeFor,
} from "./screensaver.js";

test("the intervals are the seven the picker offers, and the default is one of them", () => {
  assert.deepEqual(
    EVERY.map((one) => one.value),
    ["fastest", "10s", "30s", "1m", "5m", "10m", "30m"],
  );
  assert.notEqual(everyOf(DEFAULT_EVERY), null);
  assert.equal(everyOf("45s"), null);
  assert.equal(budgetOf("1m"), 60);
  assert.equal(budgetOf("fastest"), FASTEST_BUDGET_S);
  // A value nobody offers is priced as the default, never as zero.
  assert.equal(budgetOf("nonsense"), budgetOf(DEFAULT_EVERY));
});

test("a picture is letterboxed at its own aspect", () => {
  assert.deepEqual(sizeFor({ across: 16, down: 9 }, 1920, 1080), { width: 1920, height: 1080 });
  assert.deepEqual(sizeFor({ across: 16, down: 9 }, 1920, 1200), { width: 1920, height: 1080 });
  assert.deepEqual(sizeFor({ across: 1, down: 1 }, 1920, 1080), { width: 1080, height: 1080 });
  assert.deepEqual(sizeFor({ across: 21, down: 9 }, 1000, 1000).width, 1000);
});

test("the ladder opens at four samples a pixel and ends at a quarter of the size", () => {
  assert.deepEqual(LADDER[0], { scale: 1, supersample: 2 });
  assert.deepEqual(LADDER.at(-1), { scale: 0.25, supersample: 1 });
});

test("a seat is fitted to the first step whose price is within the budget", () => {
  // One second per million samples.
  const price = (samples) => samples / 1e6;
  const size = { width: 2000, height: 1000 };
  // 8 M samples at 4x fits a 10 s budget.
  assert.equal(fit({ ...size, budget: 10, price }).supersample, 2);
  // 2 M at 1x fits 3 s where 8 M does not.
  const one = fit({ ...size, budget: 3, price });
  assert.deepEqual([one.scale, one.supersample], [1, 1]);
  // Half the size is 0.5 M.
  assert.equal(fit({ ...size, budget: 1, price }).scale, 0.5);
  // A quarter is 125 thousand.
  const quarter = fit({ ...size, budget: 0.2, price });
  assert.equal(quarter.scale, 0.25);
  assert.deepEqual([quarter.width, quarter.height], [500, 250]);
  // And under that the seat is skipped, with what a quarter would have cost.
  const skipped = fit({ ...size, budget: 0.1, price });
  assert.equal(skipped.skip, true);
  assert.equal(skipped.seconds, 0.125);
});

test("the correction is a clamped median of measured over priced", () => {
  const correction = new Correction({ keep: 3 });
  assert.equal(correction.factor(), 1);
  correction.add(3, 1);
  correction.add(2, 1);
  correction.add(100, 1);
  assert.equal(correction.factor(), 3);
  // Only the last three are kept.
  correction.add(1, 1);
  assert.equal(correction.factor(), 2);
  // One wild seat cannot price every seat after it out of the ladder.
  const wild = new Correction();
  wild.add(50, 1);
  assert.equal(wild.factor(), 4);
  wild.add(0, 1);
  assert.equal(wild.ratios.length, 1);
});

test("the bag draws every seat once before any seat twice", () => {
  const seats = ["a", "b", "c", "d", "e"];
  const bag = new Bag(seats);
  const round = Array.from({ length: seats.length }, () => bag.next());
  assert.deepEqual([...round].sort(), seats);
  const second = Array.from({ length: seats.length }, () => bag.next());
  assert.deepEqual([...second].sort(), seats);
  assert.equal(new Bag([]).next(), null);
});

test("a new round never opens on the seat that closed the last one", () => {
  // Scripted so the second shuffle would open on the first round's last seat: the first
  // leaves [a, b] as it is and draws b then a; the second swaps to [b, a], whose end is a.
  const draws = [0.999, 0];
  const bag = new Bag(["a", "b"], () => draws.shift());
  assert.deepEqual([bag.next(), bag.next()], ["b", "a"]);
  assert.equal(bag.next(), "b");
});
