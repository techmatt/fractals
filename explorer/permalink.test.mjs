// The permalink contract, held to itself. `node --test explorer/permalink.test.mjs`.
//
// No test framework and nothing installed: `node:test` and `node:assert` are the
// runtime's own, which is the same bargain the rest of this repository makes —
// plain files, no bundler, no npm.
//
// What is worth testing here is not that the parser works. It is that a link
// written today still means the same picture in ten years, which comes down to
// three properties: every key survives a round trip unchanged, canonicalization
// is a fixed point, and a coordinate is echoed rather than reformatted.

import assert from "node:assert/strict";
import test from "node:test";

import {
  canonicalize,
  coordinateOf,
  defaultShade,
  emit,
  fieldKey,
  parse,
  PermalinkError,
  VERSION,
} from "./permalink.js";
import { DEFAULT_PALETTE, PALETTES } from "./palettes.js";

// The mandelbrot's own home view, as `Family::Multibrot { degree: 2 }.home_view()`
// gives it and as the page reads it back out of the wasm module at load. Written
// here as text because that is what the contract handles: strings in, strings out.
const HOME = {
  x: { text: "-0.77", value: -0.77 },
  y: { text: "0", value: 0 },
  w: { text: "4.4", value: 4.4 },
};

const CONTEXT = { home: HOME, palettes: PALETTES, defaultPalette: DEFAULT_PALETTE };

/** The location the wasm spike was benchmarked at — the one deep-ish anchor on record. */
const ANCHOR = "v=1&x=0.4104135054546244&y=0.20967482476903096&w=0.5622541254857749";

/** Every key the contract has, each set to something that is not its default. */
const EVERYTHING =
  "v=1&x=-0.1&y=0.85&w=0.44&a=21:9&p=cmr.wildfire" +
  "&gamma=0.75&cycles=3&phase=0.25&reverse=1&mirror=1&transfer=edge:1.5&rolloff=soft_knee:0.6";

test("an empty query is the home view, and canonicalizes to the bare version", () => {
  const view = parse("", CONTEXT);
  assert.equal(view.x.text, "-0.77");
  assert.equal(view.palette, DEFAULT_PALETTE);
  assert.deepEqual(view.shade, defaultShade());
  assert.equal(emit(view, CONTEXT), `v=${VERSION}`);
});

test("the home view written out in full canonicalizes back to the bare version", () => {
  assert.equal(canonicalize("?v=1&f=mandelbrot&m=smooth&x=-0.77&y=0&w=4.4&a=16:9", CONTEXT), "v=1");
});

test("the spike's anchor re-emits byte for byte", () => {
  assert.equal(canonicalize(ANCHOR, CONTEXT), ANCHOR);
  assert.equal(canonicalize(`?${ANCHOR}`, CONTEXT), ANCHOR);
});

test("every key round-trips, and comes back in contract order", () => {
  assert.equal(canonicalize(EVERYTHING, CONTEXT), EVERYTHING);
  const view = parse(EVERYTHING, CONTEXT);
  assert.equal(view.aspect.across, 21);
  assert.equal(view.aspect.down, 9);
  assert.equal(view.palette, "cmr.wildfire");
  assert.deepEqual(view.shade.transfer, { kind: "edge", weight: 1.5 });
  assert.deepEqual(view.shade.rolloff, { kind: "soft_knee", knee: 0.6 });
  assert.equal(view.shade.reverse, true);
  assert.equal(view.shade.mirror, true);
});

test("keys given out of order come back in contract order", () => {
  const shuffled = "v=1&rolloff=aces&p=viridis&w=0.44&transfer=rank&y=0.85&gamma=2&x=-0.1";
  assert.equal(
    canonicalize(shuffled, CONTEXT),
    "v=1&x=-0.1&y=0.85&w=0.44&p=viridis&gamma=2&transfer=rank&rolloff=aces",
  );
});

test("a key set to its engine default is dropped on emit", () => {
  const spelled =
    "v=1&f=mandelbrot&m=smooth&a=16:9&p=" +
    encodeURIComponent(DEFAULT_PALETTE) +
    "&gamma=1&cycles=1&phase=0&reverse=0&mirror=0&transfer=value&rolloff=none";
  assert.equal(canonicalize(spelled, CONTEXT), "v=1");
});

test("a coordinate is echoed verbatim, not reformatted through a double", () => {
  // More digits than `f64` carries, and a needlessly explicit exponent. Both come
  // back exactly as written: the string is the identity of the location, and this
  // page is not the thing that gets to decide it was too precise.
  const wordy = "v=1&x=0.40000000000000000000000000001&y=-0.0e0&w=1.250e-3";
  assert.equal(canonicalize(wordy, CONTEXT), wordy);
});

test("an exponent's plus sign is encoded, because a raw one in a query means a space", () => {
  assert.equal(canonicalize("v=1&w=1.25e%2B3", CONTEXT), "v=1&w=1.25e%2B3");
  assert.throws(() => parse("v=1&w=1.25e+3", CONTEXT), /decimal number/);
});

test("a coordinate this page generates is the shortest string that reads back the same", () => {
  const value = 4.4 / 3;
  const made = coordinateOf(value);
  assert.equal(Number(made.text), value);
  assert.equal(made.text, "1.4666666666666668");
});

test("the field key ignores everything that cannot change the field", () => {
  const one = parse("v=1&x=-0.1&y=0.85&w=0.44&p=viridis&gamma=2", CONTEXT);
  const two = parse("v=1&x=-0.1&y=0.85&w=0.44&p=magma&rolloff=aces", CONTEXT);
  assert.equal(fieldKey(one, CONTEXT, 1280, 720), fieldKey(two, CONTEXT, 1280, 720));
  const elsewhere = parse("v=1&x=-0.2&y=0.85&w=0.44", CONTEXT);
  assert.notEqual(fieldKey(one, CONTEXT, 1280, 720), fieldKey(elsewhere, CONTEXT, 1280, 720));
  assert.notEqual(fieldKey(one, CONTEXT, 1280, 720), fieldKey(one, CONTEXT, 640, 360));
});

test("a version this page does not speak is refused rather than read hopefully", () => {
  assert.throws(() => parse("v=2&x=0", CONTEXT), PermalinkError);
  assert.throws(() => parse("x=0&y=0", CONTEXT), /carries no v/);
});

test("an unknown key is refused", () => {
  assert.throws(() => parse("v=1&zoom=3", CONTEXT), /does not know: zoom/);
});

test("a reserved key says which half of the problem it has", () => {
  assert.throws(() => parse("v=1&cx=0.3", CONTEXT), /reserved and not yet read/);
  assert.throws(() => parse("v=1&pp=0.5", CONTEXT), /reserved and not yet read/);
});

test("a reserved family or mode is not yet, and a made-up one does not exist", () => {
  assert.throws(() => parse("v=1&f=julia", CONTEXT), /julia is not yet/);
  assert.throws(() => parse("v=1&m=threads", CONTEXT), /threads is not yet/);
  assert.throws(() => parse("v=1&f=burningship", CONTEXT), /no family called burningship/);
  assert.throws(() => parse("v=1&m=lighting", CONTEXT), /no mode called lighting/);
});

test("a coordinate is a decimal string, capped, and a width is positive", () => {
  assert.throws(() => parse("v=1&x=0x10", CONTEXT), /decimal number/);
  assert.throws(() => parse("v=1&x=NaN", CONTEXT), /decimal number/);
  assert.throws(() => parse(`v=1&x=0.${"1".repeat(70)}`, CONTEXT), /capped at 64/);
  assert.throws(() => parse("v=1&w=0", CONTEXT), /has to be positive/);
  assert.throws(() => parse("v=1&w=-1", CONTEXT), /has to be positive/);
});

test("the same key twice is refused, because there is no rule for which wins", () => {
  assert.throws(() => parse("v=1&x=0&x=1", CONTEXT), /twice/);
});

test("a palette outside the curated set is refused", () => {
  assert.throws(() => parse("v=1&p=Ice%20Walk", CONTEXT), /no palette called Ice Walk/);
  assert.ok(PALETTES.has(DEFAULT_PALETTE));
});

test("folding a cyclic map is refused, because there is no seam to fix", () => {
  assert.equal(PALETTES.get("twilight").cyclic, true);
  assert.throws(() => parse("v=1&p=twilight&mirror=1", CONTEXT), /halve the cycle/);
  assert.equal(PALETTES.get("viridis").cyclic, false);
  assert.equal(canonicalize("v=1&p=viridis&mirror=1", CONTEXT), "v=1&p=viridis&mirror=1");
});

test("a tagged shade value needs exactly the parameter its kind takes", () => {
  assert.throws(() => parse("v=1&transfer=edge", CONTEXT), /needs its weight/);
  assert.throws(() => parse("v=1&transfer=rank:2", CONTEXT), /takes no value/);
  assert.throws(() => parse("v=1&transfer=edge:-1", CONTEXT), /at least 0/);
  assert.throws(() => parse("v=1&rolloff=soft_knee:1", CONTEXT), /below 1/);
  assert.throws(() => parse("v=1&rolloff=filmic", CONTEXT), /none, soft_knee, reinhard, aces/);
});

test("an aspect is a shape, and both sides are bounded", () => {
  assert.equal(parse("v=1&a=4:3", CONTEXT).aspect.down, 3);
  assert.throws(() => parse("v=1&a=16x9", CONTEXT), /across:down/);
  assert.throws(() => parse("v=1&a=0:9", CONTEXT), /between 1 and 10000/);
});

test("every palette the picker offers is one a link may name", () => {
  for (const name of PALETTES.keys()) {
    const view = parse(`v=1&p=${encodeURIComponent(name)}`, CONTEXT);
    assert.equal(view.palette, name);
    assert.equal(canonicalize(emit(view, CONTEXT), CONTEXT), emit(view, CONTEXT));
  }
});
