// **PAGED** — this file is out of the explorer's working set and nothing the page
// loads imports it. `README.md` beside it says why, what was learned, and how to put
// the tab back. Do not wire it in again without Matt asking for it.
//
// The Inflection tab's contract, held to itself — and the other two held to not having
// moved. `node --test explorer/paged-inflection/inflect-link.test.mjs`, nothing installed.
//
// The shallow suite is the model: a URL is the one permanent thing this site emits, and a
// tab that is a trial is exactly the one whose link rules are most likely to be reached
// for and bent. The last group is the one that matters most here — that `iv` is refused by
// the other two readers, and that adding it moved nothing in either.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import * as link from "./inflect-link.js";
import * as shallow from "../permalink.js";
import * as deep from "../deep-link.js";

/** The contract's context: the julia anchor, its home frame, and a few maps. */
const PALETTES = new Map([
  ["twilight_shifted", { cyclic: true }],
  ["pink", { cyclic: false }],
  ["viridis", { cyclic: false }],
]);

const context = {
  palettes: PALETTES,
  defaultPalette: "twilight_shifted",
  home: () => ({
    x: { text: "0", value: 0 },
    y: { text: "0", value: 0 },
    w: { text: "3.2", value: 3.2 },
  }),
  constants: () => ({
    cx: { text: "-0.7269", value: -0.7269 },
    cy: { text: "0.1889", value: 0.1889 },
  }),
  deepHome: () => ({ x: "0", y: "0", w: "3.2" }),
  deepCap: () => 1000,
  settled: () => ({ weight: 0.85, opacity: 0.5 }),
};

const BASE = "iv=1&cx=-0.7269&cy=0.1889&q=0.24,0.12,-0.2,0.24";

// ------------------------------------------------------------------- what it reads

test("a bare marker is the anchor c, at home, with nothing clicked", () => {
  const view = link.parse("?iv=1", context);
  assert.equal(view.family, "julia");
  assert.deepEqual(view.inflections, []);
  assert.equal(view.constants.cx.text, "-0.7269");
  assert.equal(view.mode, "smooth");
  assert.equal(view.w.text, "3.2");
});

test("the points come back in click order, each as text and value", () => {
  const view = link.parse(`?${BASE}`, context);
  assert.equal(view.inflections.length, 2);
  assert.deepEqual(
    view.inflections.map((p) => [p.re.text, p.im.text]),
    [["0.24", "0.12"], ["-0.2", "0.24"]],
  );
  assert.equal(view.inflections[1].im.value, 0.24);
});

test("a coordinate is echoed as written, not reformatted", () => {
  const view = link.parse("?iv=1&q=1.20,0.500", context);
  assert.equal(view.inflections[0].re.text, "1.20");
  assert.equal(view.inflections[0].im.text, "0.500");
  assert.equal(link.emit(view, context).includes("q=1.20,0.500"), true);
});

test("an odd count of numbers is refused rather than rounded down to a point", () => {
  assert.throws(() => link.parse("?iv=1&q=0.1,0.2,0.3", context), /even count/);
});

test("past the ceiling is refused, and at it is not", () => {
  const pairs = (n) => Array.from({ length: n }, () => "0.1,0.2").join(",");
  assert.equal(link.parse(`?iv=1&q=${pairs(link.MAX_POINTS)}`, context).inflections.length, 32);
  assert.throws(() => link.parse(`?iv=1&q=${pairs(link.MAX_POINTS + 1)}`, context), /at most 32/);
});

test("an empty q is no points, and is not a refusal", () => {
  assert.deepEqual(link.parse("?iv=1&q=", context).inflections, []);
});

test("a point that is not a decimal is refused, naming which one", () => {
  assert.throws(() => link.parse("?iv=1&q=0.1,nine", context), /q\[0\]\.im/);
  assert.throws(() => link.parse("?iv=1&q=0.1,0.2,0x3,0.4", context), /q\[1\]\.re/);
});

test("the mode roster is the page's own, and a niche mode says why not", () => {
  assert.equal(link.parse(`?${BASE}&m=stripe&density=6`, context).mode, "stripe");
  assert.throws(() => link.parse(`?${BASE}&m=nonesuch`, context), /no mode called nonesuch/);
  for (const niche of Object.keys(shallow.NICHE_MODES)) {
    assert.throws(() => link.parse(`?${BASE}&m=${niche}`, context), /is not offered here/);
  }
});

test("a parameter under a mode that has no room for it is told from an unknown key", () => {
  assert.throws(() => link.parse(`?${BASE}&density=6`, context), /smooth mode has no density/);
  assert.throws(() => link.parse(`?${BASE}&nonesuch=1`, context), /does not know: nonesuch/);
});

test("a parameter is held to what the shallow contract holds it to", () => {
  assert.throws(() => link.parse(`?${BASE}&m=stripe&density=0`, context), /has to be positive/);
  assert.throws(
    () => link.parse(`?${BASE}&m=smooth_curvature&weight=2`, context),
    /between 0 and 1/,
  );
});

test("the fold is refused on a cyclic map here too", () => {
  assert.throws(() => link.parse(`?${BASE}&mirror=1`, context), /is cyclic/);
  assert.equal(link.parse(`?${BASE}&p=pink&mirror=1`, context).shade.mirror, true);
});

test("a duplicated key is refused rather than one of them winning", () => {
  assert.throws(() => link.parse(`?${BASE}&x=1&x=2`, context), /twice/);
});

test("a width has to be positive", () => {
  assert.throws(() => link.parse(`?${BASE}&w=0`, context), /has to be positive/);
  assert.throws(() => link.parse(`?${BASE}&w=-1`, context), /has to be positive/);
});

test("the version is checked, and an unread one says so", () => {
  assert.throws(() => link.parse("?iv=2", context), /speaks inflection iv=1/);
  assert.throws(() => link.parse("?iv=x", context), /speaks inflection iv=1/);
  assert.throws(() => link.parse("?x=1", context), /carries no iv/);
});

// ------------------------------------------------------------------- what it writes

test("parse then emit is a fixed point", () => {
  const queries = [
    "iv=1&cx=-0.7269&cy=0.1889&q=",
    `${BASE}`,
    `${BASE}&m=stripe&density=6&x=0.1&y=-0.2&w=1.5&p=pink`,
    `${BASE}&p=pink&mirror=1&cycles=3&phase=0.25&reverse=1&gamma=1.8`,
    `${BASE}&a=21:9`,
    `${BASE}&level=band_autolevel/v1:0.45,0.98,1.41,0.45,0.98`,
  ];
  for (const query of queries) {
    const once = link.canonicalize(`?${query}`, context);
    assert.equal(link.canonicalize(`?${once}`, context), once, query);
  }
});

test("cx, cy and q are always written, even when they are the defaults", () => {
  const emitted = link.emit(link.parse("?iv=1", context), context);
  assert.equal(emitted, "iv=1&cx=-0.7269&cy=0.1889&q=&p=twilight_shifted");
});

test("the comma is left alone in q, the way it is in level", () => {
  const emitted = link.emit(link.parse(`?${BASE}`, context), context);
  assert.equal(emitted.includes("q=0.24,0.12,-0.2,0.24"), true);
});

test("an exponent's plus is encoded, because a raw one would arrive as a space", () => {
  // The refusal first, which is the whole reason the encoding is not optional: a raw `+`
  // in a query string means a space, so `q=1e+10,0` arrives as `1e 10`.
  assert.throws(() => link.parse("?iv=1&q=1e+10,0", context), /1e 10/);
  const emitted = link.emit(link.parse("?iv=1&q=1e%2B10,0", context), context);
  assert.equal(emitted.includes("q=1e%2B10,0"), true);
  assert.equal(link.canonicalize(`?${emitted}`, context), emitted);
});

test("fresh is a view with nothing clicked, and emits", () => {
  const view = link.fresh(context.constants(), context);
  assert.deepEqual(view.inflections, []);
  assert.equal(link.emit(view, context), "iv=1&cx=-0.7269&cy=0.1889&q=&p=twilight_shifted");
});

// ------------------------------------------------- the three contracts, kept apart

test("the marker sorts a query, and only the marker", () => {
  assert.equal(shallow.isInflected("?iv=1&q=0.1,0.2"), true);
  assert.equal(shallow.isInflected("?v=3&f=julia"), false);
  assert.equal(shallow.isInflected("?dv=2"), false);
  assert.equal(shallow.isDeep(`?${BASE}`), false);
});

test("the shallow contract refuses iv and q", () => {
  assert.throws(() => shallow.parse("?v=3&iv=1", context), /does not know: iv/);
  assert.throws(() => shallow.parse("?v=3&q=0.1,0.2", context), /does not know: q/);
});

test("the deep contract refuses iv and q", () => {
  assert.throws(() => deep.parse("?dv=2&iv=1", context), /iv/);
  assert.throws(() => deep.parse("?dv=2&q=0.1,0.2", context), /q/);
});

test("this contract refuses the other two's markers", () => {
  assert.throws(() => link.parse("?iv=1&v=3", context), /does not know: v/);
  assert.throws(() => link.parse("?iv=1&dv=2", context), /does not know: dv/);
  assert.throws(() => link.parse("?iv=1&f=julia3", context), /does not know: f/);
  assert.throws(() => link.parse("?iv=1&n=5000", context), /does not know: n/);
});

test("the shallow contract has not moved", () => {
  assert.equal(shallow.VERSION, 3);
  assert.deepEqual(shallow.READS, [1, 2, 3]);
  assert.equal(shallow.DEEP_MARKER, "dv");
  assert.equal(
    shallow.canonicalize("?v=3&f=julia&x=0.1&p=pink", context),
    "v=3&f=julia&cx=-0.7269&cy=0.1889&x=0.1&p=pink",
  );
});

test("the deep contract has not moved", () => {
  assert.equal(deep.VERSION, 2);
  assert.deepEqual(deep.READS, [1, 2]);
  assert.equal(deep.MARKER, "dv");
});

test("the points' ceiling is one number on both sides of the boundary", () => {
  // `inflect.rs`'s `MAX_INFLECTIONS`, read out of the crate rather than restated: the
  // module refuses past it and this refuses past it, and two ceilings that drifted apart
  // would be a link this page accepts and the renderer will not draw.
  const source = readFileSync(
    new URL("../engine-wasm/src/inflect.rs", import.meta.url),
    "utf8",
  );
  const found = /MAX_INFLECTIONS: usize = (\d+)/.exec(source);
  assert.notEqual(found, null);
  assert.equal(Number(found[1]), link.MAX_POINTS);
});
