// The Deep tab's coordinates are exact, and this is where that is held.
//
// node --test explorer/deep-fx.test.mjs

import test from "node:test";
import assert from "node:assert/strict";

import * as fx from "./deep-fx.js";

test("a decimal survives the round trip it exists for", () => {
  const written = "-0.74501772828532335842941892835857434";
  assert.equal(fx.text(fx.parse(written)), written);
  // And the double does not, which is the whole reason this module is here.
  assert.notEqual(String(Number(written)), written);
});

test("an exponent is read and written back as a plain decimal", () => {
  assert.equal(fx.text(fx.parse("2e-11")), "0.00000000002");
  assert.equal(fx.text(fx.parse("1.5E+3")), "1500");
  assert.equal(fx.text(fx.parse("-3e-5")), "-0.00003");
});

test("trailing zeros are trimmed, and the value is not", () => {
  assert.equal(fx.text(fx.parse("1.2300")), "1.23");
  assert.equal(fx.text(fx.parse("0.000")), "0");
  assert.equal(fx.scaleOf(fx.parse("1.2300")), 2);
});

test("what is not a decimal is null rather than a guess", () => {
  for (const bad of ["", " ", "abc", "1.2.3", "1e", "--1", "0x10", "1,5", null, undefined]) {
    assert.equal(fx.parse(bad), null, `${bad} should not parse`);
  }
});

test("a coordinate past MAX_SCALE is refused rather than truncated", () => {
  const long = `0.${"1".repeat(fx.MAX_SCALE + 1)}`;
  assert.equal(fx.parse(long), null);
  const fits = `0.${"1".repeat(fx.MAX_SCALE)}`;
  assert.equal(fx.scaleOf(fx.parse(fits)), fx.MAX_SCALE);
});

test("addition is exact where a double is not", () => {
  // Thirty-five digits of centre plus a step twenty-four decades below it. In `f64` the
  // step vanishes entirely; here every digit of both survives.
  const centre = fx.parse("-0.74501772828532335842941892835857434");
  const step = fx.parse("1e-24");
  const moved = fx.add(centre, step);
  // The twenty-fourth fraction digit, and nothing else, moves — toward zero, because the
  // centre is negative and the step is not.
  assert.equal(fx.text(moved), "-0.74501772828532335842941792835857434");
  assert.equal(fx.toNumber(centre), fx.toNumber(moved));
  assert.notEqual(fx.compare(centre, moved), 0);
});

test("adding and subtracting the same step comes back to the same place", () => {
  const centre = fx.parse("-0.7450177282853233584294189283585743412345");
  const step = fx.fromNumber(2.5e-32);
  const there = fx.add(centre, step);
  const back = fx.sub(there, step);
  assert.equal(fx.text(back), fx.text(centre));
});

test("a thousand steps land exactly where one of a thousand times does", () => {
  // A drag is many small additions and a link is one number, so the two have to agree.
  const step = fx.fromNumber(1e-30);
  let walked = fx.parse("0.5");
  for (let n = 0; n < 1000; n++) walked = fx.add(walked, step);
  const once = fx.add(fx.parse("0.5"), fx.parse("1e-27"));
  assert.equal(fx.text(walked), fx.text(once));
  // And the scale did not ratchet: the trim is what keeps a thousand additions from
  // leaving a thousand digits behind.
  assert.ok(fx.scaleOf(walked) <= 30, `scale grew to ${fx.scaleOf(walked)}`);
});

test("fromNumber is the double's own shortest spelling", () => {
  for (const value of [0.1, -2.5e-17, 1 / 3, 6.478e-12, 1e-100]) {
    assert.equal(Number(fx.text(fx.fromNumber(value))), value);
  }
  assert.equal(fx.fromNumber(Infinity), null);
  assert.equal(fx.fromNumber(NaN), null);
  // A denormal is past MAX_SCALE and comes back null rather than truncated. It is not a
  // step any gesture makes — the guard is doing what it is for.
  assert.equal(fx.fromNumber(5e-324), null);
});

test("a difference is taken in decimal and narrowed after", () => {
  const a = fx.parse("-0.74501772828532335842941892835857434");
  const b = fx.parse("-0.74501772828532335842941892835857000");
  // The subtraction a double would have done is exactly zero.
  assert.equal(Number(fx.text(a)) - Number(fx.text(b)), 0);
  // Taken in decimal it is the number that is actually there.
  assert.ok(Math.abs(fx.difference(a, b) + 4.34e-33) < 1e-38, `${fx.difference(a, b)}`);
});

test("comparison orders what a double cannot tell apart", () => {
  const a = fx.parse("0.100000000000000000001");
  const b = fx.parse("0.100000000000000000002");
  assert.equal(Number(fx.text(a)), Number(fx.text(b)));
  assert.equal(fx.compare(a, b), -1);
  assert.equal(fx.compare(b, a), 1);
  assert.equal(fx.compare(a, fx.parse("0.1000000000000000000010")), 0);
});

test("zero is zero however it is spelled", () => {
  for (const spelling of ["0", "-0", "0.000", "0e-30", "-0.0"]) {
    assert.ok(fx.isZero(fx.parse(spelling)), spelling);
    assert.equal(fx.text(fx.parse(spelling)), "0");
  }
});
