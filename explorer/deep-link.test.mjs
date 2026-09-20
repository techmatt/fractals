// The Deep tab's link contract, held to itself — and held to leaving the shallow one
// exactly where it was.
//
// node --test explorer/deep-link.test.mjs

import test from "node:test";
import assert from "node:assert/strict";

import * as deep from "./deep-link.js";
import * as link from "./permalink.js";

/** The page's context, as much of it as a contract needs. */
const PALETTES = new Map([
  ["twilight_shifted", { cyclic: true }],
  ["inferno", { cyclic: false }],
  ["magma", { cyclic: false }],
]);

const context = {
  palettes: PALETTES,
  defaultPalette: "twilight_shifted",
  deepHome: () => ({ x: "-0.5", y: "0", w: "3" }),
  // The kernel's policy, restated at the one width these tests lean on rather than
  // imported: this suite runs with nothing installed and no wasm.
  deepCap: (width) => (width === 3 ? 4000 : 48551),
};

const ANCHOR =
  "dv=1&x=-0.74501772828532335842941892835857434&y=0.14993443275456819177805709088257971&w=2e-11&n=48551&p=inferno";

test("the anchor parses to the place it names, digit for digit", () => {
  const view = deep.parse(`?${ANCHOR}`, context);
  assert.equal(view.x.text, "-0.74501772828532335842941892835857434");
  assert.equal(view.y.text, "0.14993443275456819177805709088257971");
  assert.equal(view.w.value, 2e-11);
  assert.equal(view.maxiter, 48551);
  assert.equal(view.palette, "inferno");
});

test("parse then emit is a fixed point, and a v1 link settles into its v2 spelling", () => {
  const once = deep.canonicalize(`?${ANCHOR}`, context);
  // The version is the only thing that moves. Every digit of the place, the
  // width, the cap and the palette comes back as it went in, which is what it
  // means for v2 to have added a key rather than changed one.
  assert.equal(once, ANCHOR.replace("dv=1", "dv=2"));
  assert.equal(deep.canonicalize(`?${once}`, context), once);
});

test("a centre is normalized to one spelling and loses no digit", () => {
  const written = "-0.745017728285323358429418928358574340000";
  const view = deep.parse(`?dv=1&x=${written}&y=0&w=2e-11&n=48551&p=inferno`, context);
  assert.equal(view.x.text, "-0.74501772828532335842941892835857434");
  // Two spellings of one place are one link, which is what lets Saved dedupe them.
  const a = deep.canonicalize(`?dv=1&x=${written}&y=0&w=2e-11&n=48551&p=inferno`, context);
  const b = deep.canonicalize("?dv=1&x=-0.74501772828532335842941892835857434&y=0&w=2e-11&n=48551&p=inferno", context);
  assert.equal(a, b);
});

test("the cap is always written, even when it is the policy's own answer", () => {
  const view = deep.parse("?dv=1&w=2e-11&p=inferno", context);
  assert.equal(view.maxiter, 48551);
  assert.match(deep.emit(view), /&n=48551/);
});

test("a cap outside the kernel's range is refused by name", () => {
  assert.throws(() => deep.parse("?dv=1&n=0&p=inferno", context), /iteration cap/);
  assert.throws(() => deep.parse("?dv=1&n=2000000&p=inferno", context), /iteration cap/);
  assert.throws(() => deep.parse("?dv=1&n=12.5&p=inferno", context), /whole number/);
});

test("an unknown key is refused rather than ignored", () => {
  assert.throws(() => deep.parse("?dv=1&p=inferno&m=stripe", context), /does not know: m/);
  assert.throws(() => deep.parse("?dv=1&p=inferno&f=julia", context), /does not know: f/);
  assert.throws(() => deep.parse("?dv=1&p=inferno&weight=0.5", context), /does not know: weight/);
});

test("a key given twice is refused", () => {
  assert.throws(() => deep.parse("?dv=1&p=inferno&w=1e-20&w=1e-21", context), /gives w twice/);
});

test("a version this page does not speak is refused", () => {
  assert.throws(() => deep.parse("?dv=3&p=inferno", context), /deep contract v2/);
  assert.throws(() => deep.parse("?dv=x&p=inferno", context), /deep contract v2/);
});

test("the colour keys are the shallow contract's, in their existing spellings", () => {
  const query =
    "dv=1&x=-0.5&y=0&w=2e-11&n=48551&p=inferno&gamma=0.75&cycles=2&phase=0.25&reverse=1&transfer=edge:0.5";
  const view = deep.parse(`?${query}`, context);
  assert.equal(view.shade.gamma, 0.75);
  assert.equal(view.shade.cycles, 2);
  assert.equal(view.shade.phase, 0.25);
  assert.equal(view.shade.reverse, true);
  assert.deepEqual(view.shade.transfer, { kind: "edge", weight: 0.5 });
  // And they come back spelled the way the shallow contract spells them.
  assert.equal(deep.emit(view), query.replace("dv=1", "dv=2"));
});

test("a tone curve rides along under its own name", () => {
  const curve = "level=band_autolevel/v1:0.45,0.98,1.41,0.45,0.98";
  const view = deep.parse(`?dv=1&w=2e-11&n=48551&p=inferno&${curve}`, context);
  assert.equal(view.level.operator, "band_autolevel/v1");
  assert.equal(view.level.black_pt, 0.45);
  assert.ok(deep.emit(view).endsWith(curve), deep.emit(view));
});

test("a cyclic map is refused a fold, in the shallow contract's own words", () => {
  assert.throws(
    () => deep.parse("?dv=1&p=twilight_shifted&mirror=1", context),
    /cyclic/,
  );
});

test("a coordinate past the link's cap says so rather than being truncated", () => {
  const long = `0.${"1".repeat(70)}`;
  assert.throws(() => deep.parse(`?dv=1&x=${long}&p=inferno`, context), /capped at 64/);
});

test("a width has to be a positive number", () => {
  assert.throws(() => deep.parse("?dv=1&w=0&p=inferno", context), /has to be positive/);
  assert.throws(() => deep.parse("?dv=1&w=-1e-9&p=inferno", context), /has to be positive/);
  assert.throws(() => deep.parse("?dv=1&w=wide&p=inferno", context), /decimal number/);
});

test("a palette this page does not carry is refused", () => {
  assert.throws(() => deep.parse("?dv=1&p=nosuchmap", context), /no palette called nosuchmap/);
});

test("the marker is what dispatches, and each contract refuses the other's", () => {
  // The question is `permalink.js`'s, so that the page can ask it without loading this
  // module at all; the answer to it is this one's.
  assert.equal(link.isDeep(`?${ANCHOR}`), true);
  assert.equal(link.isDeep("?v=3&p=inferno"), false);
  assert.equal(link.isDeep(""), false);
  assert.equal(deep.MARKER, link.DEEP_MARKER);

  const shallow = {
    home: () => ({
      x: { text: "-0.5", value: -0.5 },
      y: { text: "0", value: 0 },
      w: { text: "3", value: 3 },
    }),
    constants: () => ({}),
    palettes: PALETTES,
    defaultPalette: "twilight_shifted",
    settled: () => ({}),
  };
  // The shallow reader refuses a deep link, visibly and by its own first rule: a deep
  // link carries no `v`, so it is refused before any key of it is looked at.
  assert.throws(() => link.parse(`?${ANCHOR}`, shallow), /carries no v/);
  // And were one to arrive carrying a `v` as well, the unknown-key sweep has the marker.
  assert.throws(() => link.parse("?v=3&dv=1", shallow), /a key this page does not know: dv/);
  // And this one refuses a shallow link for want of the marker.
  assert.throws(() => deep.parse("?v=3&p=inferno", context), /not a deep link/);
});

test("the shallow contract did not move", () => {
  assert.equal(link.VERSION, 3);
  assert.deepEqual(link.READS, [1, 2, 3]);
  assert.equal(link.COORDINATE_LIMIT, 64);
  // The cap is still not a shallow key, which is the ruling this second contract exists
  // beside rather than inside.
  const shallow = {
    home: () => ({
      x: { text: "-0.5", value: -0.5 },
      y: { text: "0", value: 0 },
      w: { text: "3", value: 3 },
    }),
    constants: () => ({}),
    palettes: PALETTES,
    defaultPalette: "twilight_shifted",
    settled: () => ({}),
  };
  assert.throws(() => link.parse("?v=3&n=48551", shallow), /a key this page does not know: n/);
});

test("the UI key rides on a deep link as it rides on a shallow one", () => {
  const view = deep.parse(`?${ANCHOR}&panel=deep`, context);
  assert.equal(view.palette, "inferno");
  // And is never emitted: the canonical string of a view is the picture alone.
  assert.equal(deep.emit(view), ANCHOR.replace("dv=1", "dv=2"));
});

test("a fresh view is the home frame and carries a cap", () => {
  const view = deep.fresh(context);
  assert.equal(view.x.text, "-0.5");
  assert.equal(view.w.value, 3);
  assert.equal(view.maxiter, 4000);
  assert.equal(deep.emit(view), "dv=2&x=-0.5&y=0&w=3&n=4000&p=twilight_shifted");
});

test("a field key moves with the arithmetic and not with the colour", () => {
  const a = deep.parse(`?${ANCHOR}`, context);
  const b = deep.parse(`?${ANCHOR.replace("p=inferno", "p=magma")}&gamma=0.5`, context);
  assert.equal(deep.fieldKey(a, 320, 180), deep.fieldKey(b, 320, 180));
  const deeper = deep.parse(`?${ANCHOR.replace("n=48551", "n=60000")}`, context);
  assert.notEqual(deep.fieldKey(a, 320, 180), deep.fieldKey(deeper, 320, 180));
  assert.notEqual(deep.fieldKey(a, 320, 180), deep.fieldKey(a, 320, 180, 2));
});

test("what Saved is told about a deep link needs no renderer", () => {
  const said = deep.describe(ANCHOR, context);
  assert.equal(said.deep, true);
  assert.equal(said.mode, "smooth");
  assert.equal(said.family, "mandelbrot");
  assert.equal(said.palette, "inferno");
  assert.match(said.said, /2e-11/);
});

// ----------------------------------------------------------------- the julia case

/** The anchor's `c`, as the Julia set of itself at `z = c`. */
const JULIA =
  "dv=2&cx=-0.74501772828532335842941892835857434&cy=0.14993443275456819177805709088257971" +
  "&x=-0.74501772828532335842941892835857434&y=0.14993443275456819177805709088257971&w=2e-11&n=48551&p=inferno";

test("a julia link carries its parameter to the last digit", () => {
  const view = deep.parse(`?${JULIA}`, context);
  assert.equal(view.julia.x.text, "-0.74501772828532335842941892835857434");
  assert.equal(view.julia.y.text, "0.14993443275456819177805709088257971");
  // The digits are the whole point: this `c` is not a double, and a round trip
  // through one would name a different set.
  assert.notEqual(String(Number(view.julia.x.text)), view.julia.x.text);
  assert.equal(deep.canonicalize(`?${JULIA}`, context), JULIA);
});

test("a link with no parameter is the mandelbrot set, which is every v1 link", () => {
  assert.equal(deep.parse(`?${ANCHOR}`, context).julia, null);
  assert.equal(deep.fresh(context).julia, null);
});

test("half a parameter is refused, because it is half of one number", () => {
  assert.throws(() => deep.parse("?dv=2&cx=-0.5&p=inferno", context), /both or neither/);
  assert.throws(() => deep.parse("?dv=2&cy=0.5&p=inferno", context), /both or neither/);
});

test("a julia link that names no frame opens at z = c", () => {
  const view = deep.parse("?dv=2&cx=-0.8&cy=0.156&n=4000&p=inferno", context);
  assert.equal(view.x.text, "-0.8");
  assert.equal(view.y.text, "0.156");
  // And a Mandelbrot link with no frame still opens at the Mandelbrot home,
  // which is the thing that would have been quietly broken by sharing a default.
  assert.equal(deep.parse("?dv=1&p=inferno", context).x.text, "-0.5");
});

test("the parameter is part of what a field is, and two sets at one place are two fields", () => {
  const mandelbrot = deep.parse(`?${ANCHOR}`, context);
  const julia = deep.parse(`?${JULIA}`, context);
  // Same centre, same width, same cap — and entirely different pictures.
  assert.equal(mandelbrot.x.text, julia.x.text);
  assert.equal(mandelbrot.w.value, julia.w.value);
  assert.notEqual(deep.fieldKey(mandelbrot, 320, 180), deep.fieldKey(julia, 320, 180));

  // A different `c` at the same frame is a different field too.
  const elsewhere = deep.parse(`?${JULIA.replace("cy=0.149", "cy=0.148")}`, context);
  assert.notEqual(deep.fieldKey(julia, 320, 180), deep.fieldKey(elsewhere, 320, 180));
});

test("Saved is told which set a julia picture is of", () => {
  const said = deep.describe(JULIA, context);
  assert.equal(said.family, "julia");
  assert.match(said.said, /Julia at c = -0\.74501772828532335842941892835857434 \+ 0\.149/);
});

test("a julia link is refused by the shallow contract, marker and all", () => {
  const shallow = {
    palettes: PALETTES,
    defaultPalette: "twilight_shifted",
    home: () => ({ x: "-0.5", y: "0", w: "3" }),
    constants: () => ({}),
    settled: () => ({}),
  };
  // **`cx` and `cy` are keys the shallow contract knows**, which is exactly why
  // the marker has to be what dispatches: a deep julia link pasted into the
  // shallow reader must be refused rather than drawn at a `c` rounded to a
  // double. It is refused at the first door, for carrying no `v` at all…
  assert.throws(() => link.parse(`?${JULIA}`, shallow), /carries no v/);
  // …and at the second, if one were added to it.
  assert.throws(
    () => link.parse("?v=3&dv=2&cx=-0.5&cy=0.1&f=julia", shallow),
    /does not know: dv/,
  );
});
