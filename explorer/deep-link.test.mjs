// The Deep tab's link contract, held to itself — and held to leaving the shallow one
// exactly where it was. The last two groups are the paged Inflection tab's `iv` marker,
// which both of these contracts go on refusing although the tab is gone.
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

test("parse then emit is a fixed point, and a v1 link settles into its v3 spelling", () => {
  const once = deep.canonicalize(`?${ANCHOR}`, context);
  // The version is the only thing that moves. Every digit of the place, the
  // width, the cap and the palette comes back as it went in, which is what it
  // means for v2 and v3 to have added a key rather than changed one.
  assert.equal(once, ANCHOR.replace("dv=1", "dv=3"));
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

test("a link that names no cap opens at the width's and writes none until one is settled", () => {
  const view = deep.parse("?dv=1&w=2e-11&p=inferno", context);
  assert.equal(view.maxiter, 48551);
  assert.doesNotMatch(deep.emit(view), /[?&]n=/);
  assert.match(deep.emit({ ...view, capFrom: "probe" }), /&n=48551/);
});

test("a cap outside the kernel's range is refused by name", () => {
  assert.throws(() => deep.parse("?dv=1&n=0&p=inferno", context), /iteration cap/);
  assert.throws(() => deep.parse("?dv=1&n=2000001&p=inferno", context), /iteration cap/);
  // The explicit ceiling itself reads, in this contract as in the shallow one.
  assert.equal(deep.parse("?dv=1&n=2000000&p=inferno", context).maxiter, 2_000_000);
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
  assert.throws(() => deep.parse("?dv=4&p=inferno", context), /deep contract v3/);
  assert.throws(() => deep.parse("?dv=x&p=inferno", context), /deep contract v3/);
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
  assert.equal(deep.emit(view), query.replace("dv=1", "dv=3"));
});

test("a tone curve rides along under its own name", () => {
  const curve = "level=band_autolevel/v1:0.45,0.98,1.41,0.45,0.98";
  const view = deep.parse(`?dv=1&w=2e-11&n=48551&p=inferno&${curve}`, context);
  assert.equal(view.level.operator, "band_autolevel/v1");
  assert.equal(view.level.black_pt, 0.45);
  assert.ok(deep.emit(view).endsWith(curve), deep.emit(view));
});

test("under the absolute scale the deep contract drops the curve too", () => {
  const curve = "level=band_autolevel/v1:0.45,0.98,1.41,0.45,0.98";
  const view = deep.parse(`?dv=1&w=2e-11&n=48551&p=inferno&scale=absolute&${curve}`, context);
  assert.equal(view.level, null);
  assert.doesNotMatch(deep.emit(view), /level=/);
  assert.match(deep.emit(view), /scale=absolute/);
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

test("the shallow contract moved once, and reads n by this contract's rule", () => {
  // v4 is the one move: the cap became a shallow key *(find_minibrots_cap2_ckpt145)*, in
  // this contract's spelling and range. Nothing else about the shallow reader moved.
  assert.equal(link.VERSION, 4);
  assert.deepEqual(link.READS, [1, 2, 3, 4]);
  assert.equal(link.COORDINATE_LIMIT, 64);
  assert.equal(deep.CAP_LIMIT, link.CAP_LIMIT);
  assert.equal(deep.CAP_FLOOR, link.CAP_FLOOR);
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
  // A v3 link never carried one, so one that does is refused rather than read.
  assert.throws(() => link.parse("?v=3&n=48551", shallow), /a key this page does not know: n/);
  assert.equal(link.parse("?v=4&n=48551", shallow).maxiter, 48551);
  // The same refusals, word for word, on either side.
  assert.equal(link.parse("?v=4&n=2000000", shallow).maxiter, 2_000_000);
  for (const bad of ["49", "2000001", "1e5", "-3"]) {
    const said = (() => {
      try {
        deep.parse(`?dv=3&n=${bad}`, context);
      } catch (error) {
        return error.message;
      }
      return null;
    })();
    assert.ok(said !== null, bad);
    assert.throws(() => link.parse(`?v=4&n=${bad}`, shallow), { message: said });
  }
});

test("the UI key rides on a deep link as it rides on a shallow one", () => {
  const view = deep.parse(`?${ANCHOR}&panel=deep`, context);
  assert.equal(view.palette, "inferno");
  // And is never emitted: the canonical string of a view is the picture alone.
  assert.equal(deep.emit(view), ANCHOR.replace("dv=1", "dv=3"));
});

test("a fresh view is the home frame at the width's cap, and does not write it", () => {
  const view = deep.fresh(context);
  assert.equal(view.x.text, "-0.5");
  assert.equal(view.w.value, 3);
  assert.equal(view.maxiter, 4000);
  assert.equal(view.capFrom, "width");
  assert.equal(deep.emit(view), "dv=3&x=-0.5&y=0&w=3&p=twilight_shifted");
  assert.equal(view.degree, 2);
});

test("the cap is written once it is settled, and a link that names one opens pinned", () => {
  // The bug this is the fix for: a link copied while the probe was deciding carried the
  // width's cap, and a link-carried cap is drawn as pinned.
  const unsettled = { ...deep.fresh(context), maxiter: 55926 };
  assert.doesNotMatch(deep.emit(unsettled), /[?&]n=/);
  for (const capFrom of ["probe", "reader", "tile"]) {
    assert.match(deep.emit({ ...unsettled, capFrom }), /&n=55926&/);
  }
  // A view built somewhere that says nothing about its cap keeps the old rule.
  const { capFrom, ...silent } = unsettled;
  assert.equal(capFrom, "width");
  assert.match(deep.emit(silent), /&n=55926&/);

  const named = deep.parse(`?${ANCHOR}`, context);
  assert.equal(named.capFrom, "reader");
  const bare = deep.parse(`?${ANCHOR.replace("&n=48551", "")}`, context);
  assert.equal(bare.capFrom, "width");
  assert.equal(bare.maxiter, 48551);
  // Both round-trip: the absent key comes back absent, the named one named.
  assert.equal(deep.emit(bare), ANCHOR.replace("dv=1", "dv=3").replace("&n=48551", ""));
  assert.equal(deep.emit(named), ANCHOR.replace("dv=1", "dv=3"));
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
  assert.equal(deep.canonicalize(`?${JULIA}`, context), JULIA.replace("dv=2", "dv=3"));
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

// ------------------------------------------- the paged Inflection tab's marker

// A fifth tab sculpted a Julia set by inflection under a third contract, `iv=1`, and it
// is **paged out** — `paged-inflection/README.md`. Its own suite went with it, and these
// two groups are the part of it that stays, because a URL outlives the trial: somebody's
// saved link still spells `iv`, and the plain Julia set underneath it is a different
// picture wearing that picture's name. So both live contracts have to go on refusing the
// key, and the page has to go on being able to sort a query onto it.

test("iv is sorted by its own marker, and belongs to neither live contract", () => {
  assert.equal(link.INFLECT_MARKER, "iv");
  assert.equal(link.isInflected("?iv=1&q=0.1,0.2"), true);
  assert.equal(link.isInflected("?v=3&f=julia"), false);
  assert.equal(link.isInflected(`?${ANCHOR}`), false);
  assert.equal(link.isDeep("?iv=1&q=0.1,0.2"), false);
});

test("the shallow and deep contracts both refuse iv and q", () => {
  const shallow = {
    palettes: PALETTES,
    defaultPalette: "twilight_shifted",
    home: () => ({ x: "-0.5", y: "0", w: "3" }),
    constants: () => ({}),
    settled: () => ({}),
  };
  assert.throws(() => link.parse("?v=3&iv=1", shallow), /does not know: iv/);
  assert.throws(() => link.parse("?v=3&q=0.1,0.2", shallow), /does not know: q/);
  assert.throws(() => deep.parse(`?${ANCHOR}&iv=1`, context), /iv/);
  assert.throws(() => deep.parse(`?${ANCHOR}&q=0.1,0.2`, context), /q/);
});

// ------------------------------------------------------------ the degree (v3)

/** A degree-3 frame: the tangle route's 1e-22 rung is not needed for a contract test,
 *  only a place, a width and a cap. */
const CUBIC = "dv=3&f=multibrot3&x=0.3818029588214199545907&y=0.6232633974651050655314&w=1e-20&n=48551&p=inferno";

test("f names the degree in the shallow contract's spelling, and settles to itself", () => {
  const view = deep.parse(`?${CUBIC}`, context);
  assert.equal(view.degree, 3);
  assert.equal(view.julia, null);
  assert.equal(deep.familyOf(view), "multibrot3");
  assert.equal(deep.canonicalize(`?${CUBIC}`, context), CUBIC);
  // Every name `f` can take is a shallow family, spelled the shallow way.
  for (const name of deep.FAMILIES.keys()) assert.ok(link.FAMILIES.includes(name), name);
});

test("a julia family carries its degree and its parameter, in that order", () => {
  const query =
    "dv=3&f=julia5&cx=0.2&cy=0.1&x=0.2&y=0.1&w=1e-12&n=48551&p=inferno";
  const view = deep.parse(`?${query}`, context);
  assert.equal(view.degree, 5);
  assert.equal(view.julia.x.text, "0.2");
  assert.equal(deep.familyOf(view), "julia5");
  assert.equal(deep.emit(view), query);
});

test("absent f is degree two on either plane, so a degree-2 link names no family", () => {
  assert.equal(deep.parse(`?${ANCHOR}`, context).degree, 2);
  assert.equal(deep.parse(`?${JULIA}`, context).degree, 2);
  // And spelling the default is accepted and dropped, since it says nothing.
  const spelled = deep.canonicalize(`?${ANCHOR.replace("dv=1", "dv=3&f=mandelbrot")}`, context);
  assert.equal(spelled, ANCHOR.replace("dv=1", "dv=3"));
  const julia = deep.canonicalize(`?${JULIA.replace("dv=2", "dv=3&f=julia")}`, context);
  assert.equal(julia, JULIA.replace("dv=2", "dv=3"));
});

test("a family that contradicts the parameter is refused, and so is one it cannot draw", () => {
  assert.throws(() => deep.parse("?dv=3&f=julia3&p=inferno", context), /cx and cy/);
  assert.throws(
    () => deep.parse("?dv=3&f=multibrot4&cx=0.2&cy=0.1&p=inferno", context),
    /parameter plane.*f=julia4/,
  );
  assert.throws(() => deep.parse("?dv=3&f=fractional_multibrot&p=inferno", context), /f is the family/);
  assert.throws(() => deep.parse("?dv=3&f=multibrot7&p=inferno", context), /f is the family/);
  assert.throws(() => deep.parse("?dv=3&f=burning_ship&p=inferno", context), /f is the family/);
  // And an older version never knew the key at all.
  assert.throws(() => deep.parse("?dv=2&f=multibrot3&p=inferno", context), /does not know: f/);
});

test("the degree is part of what a field is, and part of what Saved says", () => {
  const cubic = deep.parse(`?${CUBIC}`, context);
  const quadratic = { ...cubic, degree: 2 };
  assert.notEqual(deep.fieldKey(cubic, 320, 180), deep.fieldKey(quadratic, 320, 180));
  const said = deep.describe(CUBIC, context);
  assert.equal(said.family, "multibrot3");
  assert.match(said.said, /^degree 3 · width 1e-20$/);
  const julia = deep.describe("dv=3&f=julia4&cx=0.2&cy=0.1&w=1e-12&n=48551&p=inferno", context);
  assert.equal(julia.family, "julia4");
  assert.match(julia.said, /^degree 4 · Julia at c = 0\.2 \+ 0\.1i/);
});

test("a degree-d link with no frame opens at its own family's home", () => {
  const asked = [];
  const homes = {
    ...context,
    deepHome: (family) => {
      asked.push(family);
      return family === "multibrot3" ? { x: "0", y: "0", w: "3.2" } : context.deepHome();
    },
  };
  const view = deep.parse("?dv=3&f=multibrot3&p=inferno", homes);
  assert.equal(view.w.value, 3.2);
  assert.deepEqual(asked, ["multibrot3"]);
});

// ------------------------------------------------------------ the Deep tab's gallery
//
// `deep-gallery.jsonl` is a register of links this contract reads *(deep_gallery_build_
// ckpt144)*, so it is held here: every row is a fixed point in the page's own palette
// roster, and pins its cap, which is what a gallery frame is drawn at. The tile a row names
// is the builder's hash of the link, so the two sides are held to one known value.

import { readFileSync } from "node:fs";
import { PALETTES as ROSTER } from "./palettes.js";
import { grouped, rowsOf, tileName } from "./deep-gallery.js";

const REGISTER = rowsOf(readFileSync(new URL("./deep-gallery.jsonl", import.meta.url), "utf8"));
const roster = { ...context, palettes: ROSTER };

test("every gallery row is a canonical deep link that pins its cap", () => {
  assert.ok(REGISTER.length > 0);
  for (const row of REGISTER) {
    assert.equal(deep.canonicalize(`?${row.link}`, roster), row.link, row.link);
    assert.equal(deep.parse(`?${row.link}`, roster).capFrom, "reader", row.link);
  }
});

test("every deep figure link the site carries is a canonical deep link that pins its cap", () => {
  // `explorer/links.jsonl` holds the Deep zoom page's figures beside every shallow one
  // (deep_figures_ckpt145). `permalink.test.mjs` passes a `dv` row over to here, so each
  // is held to the contract that reads it and to opening at the cap its picture was drawn at.
  const rows = readFileSync(new URL("./links.jsonl", import.meta.url), "utf8")
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line))
    .filter((row) => row.link?.startsWith(`${deep.MARKER}=`));
  assert.ok(rows.length > 0, "no figure carries a deep link");
  for (const row of rows) {
    assert.equal(deep.canonicalize(`?${row.link}`, roster), row.link, row.id);
    assert.equal(deep.parse(`?${row.link}`, roster).capFrom, "reader", row.id);
  }
});

test("a gallery row's tile is named as the builder names it, and subjects keep their order", () => {
  assert.equal(
    tileName(
      "dv=3&f=multibrot4&x=0.46213756663599396642203&y=0.63716077751275259356461&w=2.95e-16&n=67810&p=gemini-25&phase=0.274&scale=absolute&period=812",
    ),
    "ec75f6976409f43f.webp",
  );
  const rows = [
    { subject: "a", link: "dv=3" },
    { subject: "b", link: "dv=3" },
    { subject: "a", link: "dv=3" },
  ];
  assert.deepEqual([...grouped(rows).keys()], ["a", "b"]);
  assert.equal(grouped(rows).get("a").length, 2);
  assert.throws(() => rowsOf('{"subject": "a", "link": "dv=3", "n": 1}'));
});
