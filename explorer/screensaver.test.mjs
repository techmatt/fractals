// The screensaver's pure parts: the interval table, the overrun rule, the correction and
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
  fullscreenKey,
  overrunLimit,
  sizeFor,
  SUPERSAMPLE,
} from "./screensaver.js";

test("the intervals are the seven the picker offers, and the default is one of them", () => {
  assert.deepEqual(
    EVERY.map((one) => one.value),
    ["fastest", "10s", "30s", "1m", "5m", "10m", "30m"],
  );
  assert.notEqual(everyOf(DEFAULT_EVERY), null);
  assert.equal(everyOf("45s"), null);
  assert.equal(budgetOf("1m"), 60);
  // Fastest is a four-second floor.
  assert.equal(everyOf("fastest").seconds, 4);
  assert.equal(budgetOf("fastest"), 4);
  // A value nobody offers is priced as the default, never as zero.
  assert.equal(budgetOf("nonsense"), budgetOf(DEFAULT_EVERY));
});

test("a picture is letterboxed at its own aspect", () => {
  assert.deepEqual(sizeFor({ across: 16, down: 9 }, 1920, 1080), { width: 1920, height: 1080 });
  assert.deepEqual(sizeFor({ across: 16, down: 9 }, 1920, 1200), { width: 1920, height: 1080 });
  assert.deepEqual(sizeFor({ across: 1, down: 1 }, 1920, 1080), { width: 1080, height: 1080 });
  assert.deepEqual(sizeFor({ across: 21, down: 9 }, 1000, 1000).width, 1000);
});

test("every interval draws at two samples a pixel each way", () => {
  assert.equal(SUPERSAMPLE, 2);
});

test("a render is cancelled past twice its price, never inside twice the interval", () => {
  // A seat priced over its interval is waited for, up to twice its price.
  assert.equal(overrunLimit(20, 4), 40);
  // A cheap seat has twice the interval.
  assert.equal(overrunLimit(1.4, 4), 8);
  assert.equal(overrunLimit(6.5, 60), 120);
  // And never under a second.
  assert.equal(overrunLimit(0.1, 0.2), 1);
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

test("the full-screen hint names the key this platform's browser uses", () => {
  assert.equal(fullscreenKey("Win32"), "F11");
  assert.equal(fullscreenKey("Linux x86_64"), "F11");
  assert.equal(fullscreenKey("MacIntel"), "⌃⌘F");
  assert.equal(fullscreenKey("macOS"), "⌃⌘F");
});
