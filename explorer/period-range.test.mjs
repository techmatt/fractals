// The Period slider's travel, held to its promises. `node --test explorer/period-range.test.mjs`.
//
// The travel is a thumb's worth of arithmetic over a measurement, so what is worth testing is
// the measurement's meaning — the sparse end is one cycle across the spread, the dense end is
// where the median neighbour pair turns `DENSE_TURNS` — and that the control round-trips: a
// period sits where its position writes it, a period outside parks at an end, and a Lambda
// move that keeps the cycles keeps the thumb.

import assert from "node:assert/strict";
import test from "node:test";

import { compress } from "./hold.js";
import * as travel from "./period-range.js";

/** A field `width × height` whose value is `f(column, row)`, `NaN` where `inside` says. */
function fieldOf(width, height, f, inside = () => false, supersample = 1) {
  const across = width * supersample;
  const values = new Float64Array(across * height * supersample);
  for (let y = 0; y < height * supersample; y += 1) {
    for (let x = 0; x < across; x += 1) {
      const column = x / supersample;
      const row = y / supersample;
      values[y * across + x] = inside(column, row) ? Number.NaN : f(column, row);
    }
  }
  return { values, width, height, supersample };
}

test("on a ramp, the sparse end is one cycle across the spread and the dense end a tenth of a turn a pixel", () => {
  // ν = 10 + column: a change of exactly one a pixel across, none down.
  const field = fieldOf(400, 100, (column) => 10 + column);
  const measured = travel.measure(field);
  const spread = measured.high - measured.low;
  assert.ok(Math.abs(spread / (0.94 * 399) - 1) < 0.02, `spread ${spread}`);
  // Half the pairs are across (a change of one) and half down (none): the median is taken
  // over the ones that move only where more than half do not, which here is exactly half.
  const range = travel.rangeOf(field, 1, 400);
  assert.ok(Math.abs(range.sparse - spread) < 1e-9);
  assert.ok(range.dense > 0 && range.dense <= 1 / travel.DENSE_TURNS);
});

test("a field shown wider than it was drawn has neighbours that far apart", () => {
  // The same plane at two sizes: four a pixel at a quarter, one a pixel at full.
  const quarter = fieldOf(100, 60, (column, row) => 5 + 4 * (column + row));
  const full = fieldOf(400, 240, (column, row) => 5 + column + row);
  const a = travel.rangeOf(quarter, 1, 400);
  const b = travel.rangeOf(full, 1, 400);
  // One frame, one travel, whichever stage measured it.
  assert.ok(Math.abs(a.dense / b.dense - 1) < 0.05, `${a.dense} ${b.dense}`);
  assert.ok(Math.abs(a.sparse / b.sparse - 1) < 0.05, `${a.sparse} ${b.sparse}`);
});

test("the interior is not measured, and a supersampled field is read a pixel at a time", () => {
  const plain = fieldOf(200, 120, (column, row) => 50 + column * 0.3 + row * 0.2);
  const holed = fieldOf(
    200,
    120,
    (column, row) => 50 + column * 0.3 + row * 0.2,
    (column, row) => (column - 100) ** 2 + (row - 60) ** 2 < 900,
  );
  const fine = fieldOf(200, 120, (column, row) => 50 + column * 0.3 + row * 0.2, () => false, 2);
  const [p, h, f] = [plain, holed, fine].map((field) => travel.rangeOf(field, 1, 200));
  assert.ok(Math.abs(h.dense / p.dense - 1) < 0.05);
  assert.ok(Math.abs(f.dense / p.dense - 1) < 0.05);
  assert.ok(Math.abs(f.sparse / p.sparse - 1) < 0.05);
});

test("a travel is never shorter than MIN_RATIO nor longer than MAX_RATIO", () => {
  // Noise: every neighbour a spread apart, so the dense end is past one cycle.
  let seed = 7;
  const noise = fieldOf(200, 120, () => {
    seed = (seed * 16807) % 2147483647;
    return 10 + (seed / 2147483647) * 100;
  });
  const loud = travel.rangeOf(noise, 1, 200);
  assert.ok(Math.abs(loud.sparse / loud.dense - travel.MIN_RATIO) < 1e-9);
  // Almost flat: a spread of a thousand and a neighbour change of a millionth.
  const calm = fieldOf(2000, 10, (column) => (column < 1000 ? 1 + column * 1e-9 : 1001 + column * 1e-9));
  const quiet = travel.rangeOf(calm, 1, 2000);
  assert.ok(quiet.sparse / quiet.dense <= travel.MAX_RATIO * (1 + 1e-9));
});

test("a knee bends the travel, and above it the travel is the line's", () => {
  // A deep frame, every ν above the knee: the knee at any λ is the line, λ = 1.
  const deepField = fieldOf(300, 200, (column, row) => 12000 + column * 3 + row * 2);
  assert.deepEqual(travel.rangeOf(deepField, 0.157, 300, 5000), travel.rangeOf(deepField, 1, 300));
  // A shallow one, every ν below it: the knee's `g` there is `knee · T_λ(ν / knee)` shifted,
  // so both ends are the plain `T_λ` travel scaled by `knee^(1 − λ)`.
  const shallow = fieldOf(300, 200, (column, row) => 20 + column * 0.5 + row * 0.3);
  const bent = travel.rangeOf(shallow, 0.157, 300, 5000);
  const plain = travel.rangeOf(shallow, 0.157, 300);
  const scale = 5000 ** (1 - 0.157);
  assert.ok(Math.abs(bent.sparse / (plain.sparse * scale) - 1) < 1e-9);
  assert.ok(Math.abs(bent.dense / (plain.dense * scale) - 1) < 1e-9);
  // Straighten iter turned on keeps the cycles across the spread, as a Lambda move does.
  const period = travel.rescaled(shallow, 2.5, 0, 0.157, null, 5000);
  const measured = travel.measure(shallow);
  const cycles = (lambda, knee, p) => travel.spreadOf(measured, lambda, knee) / p;
  assert.ok(Math.abs(cycles(0.157, 5000, period) / cycles(0, null, 2.5) - 1) < 1e-3);
});

test("nothing to measure is no travel", () => {
  assert.equal(travel.rangeOf(null, 1, 100), null);
  assert.equal(travel.rangeOf(fieldOf(40, 20, () => 1, () => true), 1, 40), null);
  assert.equal(travel.rangeOf(fieldOf(40, 20, () => 3), 1, 40), null);
});

test("a position writes a period that sits back at that position, and a period outside parks", () => {
  const range = { sparse: 37.2, dense: 0.166 };
  for (let at = 0; at <= travel.STEPS; at += 25) {
    const period = travel.periodAt(range, at);
    assert.ok(Math.abs(travel.positionOf(range, period) - at) < 0.5, `at ${at}`);
  }
  assert.equal(travel.periodAt(range, 0), 37.2);
  assert.equal(travel.periodAt(range, travel.STEPS), 0.166);
  assert.equal(travel.positionOf(range, 1e6), 0);
  assert.equal(travel.positionOf(range, 1e-6), travel.STEPS);
  // Every step multiplies the number of cycles by the same factor.
  const factor = travel.periodAt(range, 100) / travel.periodAt(range, 200);
  const later = travel.periodAt(range, 800) / travel.periodAt(range, 900);
  assert.ok(Math.abs(factor / later - 1) < 1e-3);
});

test("a Lambda move keeps the cycles across the spread, and so the thumb", () => {
  const field = fieldOf(300, 200, (column, row) => 1000 * Math.exp((column + row) / 120));
  const measured = travel.measure(field);
  const cycles = (lambda, period) =>
    (compress(measured.high, lambda) - compress(measured.low, lambda)) / period;
  for (const [from, to] of [
    [1, 0],
    [0, 0.5],
    [0.3, 1],
  ]) {
    const period = travel.rescaled(field, 2.5, from, to);
    assert.ok(Math.abs(cycles(to, period) / cycles(from, 2.5) - 1) < 1e-3, `${from} → ${to}`);
    const before = travel.positionOf(travel.rangeOf(field, from, 300), 2.5);
    const after = travel.positionOf(travel.rangeOf(field, to, 300), period);
    assert.ok(Math.abs(after - before) < 0.1 * travel.STEPS, `${from} → ${to}: ${before} → ${after}`);
  }
  // With nothing to measure the period is left alone.
  assert.equal(travel.rescaled(null, 2.5, 1, 0), 2.5);
});
