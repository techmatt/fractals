// New coloring's aliasing guard held to its promises. `node --test explorer/aliasing.test.mjs`.
//
// A smooth field measures low and is left alone; a field whose neighbours sit a turn apart
// measures high and has its period lengthened, never more than `TRIES` times; the interior is
// not measured; and a wider field is read at the quarter pass's spacing.

import assert from "node:assert/strict";
import test from "node:test";

import * as aliasing from "./aliasing.js";

/** Black to white, sequential. */
const GREY = aliasing.tableOf({ stops: [[0, [0, 0, 0]], [1, [255, 255, 255]]] });

function fieldOf(width, height, at) {
  const values = new Float64Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) values[y * width + x] = at(x, y);
  return { values, width, height, supersample: 1 };
}

test("a smooth ramp is under the line and keeps its period", () => {
  const field = fieldOf(200, 100, (x) => 10 + x);
  const shade = { lambda: 1, period: 400, phase: 0 };
  const guarded = aliasing.guard(field, shade, GREY);
  assert.ok(guarded.before < aliasing.THRESHOLD, `measured ${guarded.before}`);
  assert.equal(guarded.redraws, 0);
  assert.equal(guarded.period, 400);
});

test("a field that jumps half a turn between neighbours is lengthened, a bounded number of times", () => {
  // A checkerboard of values half a period apart: every neighbour is the far end of the map.
  const field = fieldOf(200, 100, (x, y) => 10 + ((x + y) % 2) * 50);
  const shade = { lambda: 1, period: 100, phase: 0 };
  const guarded = aliasing.guard(field, shade, GREY);
  assert.ok(guarded.before > aliasing.THRESHOLD);
  assert.ok(guarded.redraws >= 1 && guarded.redraws <= aliasing.TRIES);
  assert.equal(guarded.period, 100 * aliasing.STRETCH ** guarded.redraws);
  assert.ok(guarded.after < guarded.before);
});

test("the interior is not measured, and a field with too little outside answers null", () => {
  const inside = fieldOf(50, 50, () => Number.NaN);
  assert.equal(aliasing.roughness(inside, { lambda: 1, period: 1, phase: 0 }, GREY), null);
  const guarded = aliasing.guard(inside, { lambda: 1, period: 7, phase: 0 }, GREY);
  assert.deepEqual(guarded, { period: 7, redraws: 0, before: null, after: null });
});

test("a mirrored map comes back the way it went", () => {
  const folded = aliasing.tableOf({ stops: [[0, [0, 0, 0]], [1, [255, 255, 255]]] }, true);
  const last = folded.length / 3 - 1;
  assert.equal(folded[0], 0);
  assert.equal(folded[last * 3], 0);
  assert.ok(folded[Math.round(last / 2) * 3] > 250);
});

test("a wide field is read at the quarter pass's spacing", () => {
  // Stripes two pixels wide: pixel neighbours mostly agree, but read every third pixel they
  // alternate, which is what the same plane looks like at a quarter of the width.
  const narrow = fieldOf(aliasing.MEASURE_WIDTH, 50, (x) => 10 + (Math.floor(x / 2) % 2) * 50);
  const wide = fieldOf(aliasing.MEASURE_WIDTH * 3, 50, (x) => 10 + (Math.floor(x / 6) % 2) * 50);
  const shade = { lambda: 1, period: 100, phase: 0 };
  const a = aliasing.roughness(narrow, shade, GREY);
  const b = aliasing.roughness(wide, shade, GREY);
  assert.ok(Math.abs(a - b) < 20, `narrow ${a}, wide ${b}`);
});
