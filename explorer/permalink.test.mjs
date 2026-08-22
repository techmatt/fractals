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
//
// Three keys are emitted whether or not they were chosen — `p`, and a family's own
// constants — because their defaults live outside this module, in the baked
// colormap set and the wallpaper project's shipped anchors. That is a property
// worth its own tests: an old link without them still parses to the default, and
// every canonical string names what it was drawn from.
//
// Version 1 links still parse and re-emit as version 2. There are tests for that
// too, because "the old links still work" is the only promise a URL contract makes
// that anybody will check a decade later.

import assert from "node:assert/strict";
import test from "node:test";

import {
  canonicalize,
  coordinateOf,
  defaultShade,
  emit,
  FAMILIES,
  fieldKey,
  fresh,
  MODE_PARAMETERS,
  MODES,
  parse,
  PermalinkError,
  SHADE_KEYS,
  VERSION,
} from "./permalink.js";
import { CONSTANTS, CURVES, MODES as IDENTITIES } from "./catalog.js";
import * as shade from "./shade.js";
import { DEFAULT_PALETTE, PALETTES } from "./palettes.js";

import { readFileSync } from "node:fs";

// Each family's own home view, as `Family::home_view()` gives it and as the page
// reads it back out of the wasm module at load. Written here as text because that
// is what the contract handles: strings in, strings out. Every row but the Julias'
// is `Extent::frame` evaluated on a measured bounding box; the dynamical planes
// come home to the whole plane by the engine's stated exception, because a Julia
// set is a different shape for every `c` and there is nothing to measure.
const HOMES = {
  mandelbrot: ["-0.77", "0", "4.4"],
  multibrot3: ["0", "0", "5.2"],
  multibrot4: ["-0.23", "0", "4.4"],
  multibrot5: ["0", "0", "3.6"],
  julia: ["0", "0", "3"],
  julia3: ["0", "0", "3"],
  julia4: ["0", "0", "3"],
  julia5: ["0", "0", "3"],
  phoenix: ["0.04", "0", "5"],
};

const written = (text) => ({ text, value: Number(text) });

function homeOf(family) {
  const [x, y, w] = HOMES[family];
  return { x: written(x), y: written(y), w: written(w) };
}

function constantsOf(family) {
  const held = {};
  for (const [key, text] of Object.entries(CONSTANTS[family] ?? {})) held[key] = written(text);
  return held;
}

const CONTEXT = {
  home: homeOf,
  constants: constantsOf,
  palettes: PALETTES,
  defaultPalette: DEFAULT_PALETTE,
};

/** `p` as every canonical string carries it, when nobody picked a palette. */
const HOUSE = `p=${encodeURIComponent(DEFAULT_PALETTE)}`;

/** The constants a family's canonical string always carries, in emit order. */
function seeds(family) {
  return Object.entries(constantsOf(family))
    .map(([key, held]) => `${key}=${encodeURIComponent(held.text)}`)
    .join("&");
}

/** The location the wasm spike was benchmarked at — the one deep-ish anchor on record.
 *  Written as it was written then, under version 1 and before `p` was always emitted. */
const ANCHOR = "x=0.4104135054546244&y=0.20967482476903096&w=0.5622541254857749";

/** Every key a mandelbrot link can have, each set to something that is not its default. */
const EVERYTHING =
  `v=${VERSION}&m=smooth_stripe&density=9&weight=0.6&x=-0.1&y=0.85&w=0.44&a=21:9&p=cmr.wildfire` +
  "&gamma=0.75&cycles=3&phase=0.25&reverse=1&mirror=1&transfer=edge:1.5&rolloff=soft_knee:0.6";

test("an empty query is the home view, and emits the version and the palette", () => {
  const view = parse("", CONTEXT);
  assert.equal(view.family, "mandelbrot");
  assert.equal(view.mode, "smooth");
  assert.equal(view.x.text, "-0.77");
  assert.equal(view.palette, DEFAULT_PALETTE);
  assert.deepEqual(view.shade, defaultShade());
  assert.deepEqual(view.params, {});
  assert.equal(emit(view, CONTEXT), `v=${VERSION}&${HOUSE}`);
});

test("the home view written out in full canonicalizes to the version and the palette", () => {
  const spelled = `?v=${VERSION}&f=mandelbrot&m=smooth&x=-0.77&y=0&w=4.4&a=16:9`;
  assert.equal(canonicalize(spelled, CONTEXT), `v=${VERSION}&${HOUSE}`);
});

test("a version 1 link still parses, and settles as version 2", () => {
  // Nothing a v1 link could say has changed meaning, so the whole of the upgrade is
  // the number: the same coordinates, the same palette rule, the same defaults.
  assert.equal(canonicalize(`v=1&${ANCHOR}`, CONTEXT), `v=${VERSION}&${ANCHOR}&${HOUSE}`);
  assert.equal(canonicalize("v=1&p=viridis&gamma=2", CONTEXT), `v=${VERSION}&p=viridis&gamma=2`);
  assert.equal(parse("v=1&f=mandelbrot&m=smooth", CONTEXT).mode, "smooth");
  // And a version nobody has written yet is still refused rather than read hopefully.
  assert.throws(() => parse("v=3&x=0", CONTEXT), PermalinkError);
  assert.throws(() => parse("v=1.0&x=0", CONTEXT), PermalinkError);
  assert.throws(() => parse("x=0&y=0", CONTEXT), /carries no v/);
});

test("the spike's anchor keeps its coordinates and gains the palette it was drawn in", () => {
  const settled = `v=${VERSION}&${ANCHOR}&${HOUSE}`;
  assert.equal(canonicalize(`v=${VERSION}&${ANCHOR}`, CONTEXT), settled);
  assert.equal(canonicalize(`?${settled}`, CONTEXT), settled);
});

test("every family draws, and its constants are emitted whether or not anybody chose them", () => {
  for (const family of FAMILIES) {
    const view = parse(`v=${VERSION}&f=${family}`, CONTEXT);
    assert.equal(view.family, family);
    assert.equal(view.x.text, HOMES[family][0], family);
    const carried = seeds(family);
    const expected = [`v=${VERSION}`, family === "mandelbrot" ? null : `f=${family}`, carried || null, HOUSE]
      .filter(Boolean)
      .join("&");
    assert.equal(emit(view, CONTEXT), expected, family);
    // Which is the point of always emitting them: the constants survive a rebake of
    // the anchors, so a saved link keeps drawing the set it was saved on.
    if (carried) assert.match(emit(view, CONTEXT), /(^|&)cx=/, family);
  }
});

test("encode then decode is the identity, for every family and a mode of each shape", () => {
  // The four shapes of coloring the engine has — one field, a composite, the
  // modulate, a direct trap — over every plane, which is the whole cross product
  // the renderer has to speak. Each carries a moved parameter where the mode has
  // one, so the parameter is in the round trip rather than beside it.
  const REPRESENTATIVE = [
    ["smooth", {}],
    ["stripe", { density: 9 }],
    ["gaussian_int", {}],
    ["smooth_stripe", { density: 9, weight: 0.6 }],
    ["smooth_trap_circle", { radius: 0.8 }],
    ["threads", { sigma: 0.2, weight: 0.7 }],
    ["itinerary", { shift: 0.8 }],
    ["direct_trap_ring", { radius: 1.2, threshold: 0.07, opacity: 0.5 }],
    ["direct_trap_multiply", { threshold: 0.12 }],
  ];
  for (const family of FAMILIES) {
    for (const [mode, params] of REPRESENTATIVE) {
      const view = { ...fresh(family, mode, CONTEXT), params };
      const emitted = emit(view, CONTEXT);
      const back = parse(emitted, CONTEXT);
      assert.deepEqual(back.params, params, `${family} ${mode}`);
      assert.equal(back.family, family);
      assert.equal(back.mode, mode);
      assert.deepEqual(back.constants, view.constants, `${family} ${mode}`);
      assert.equal(emit(back, CONTEXT), emitted, `${family} ${mode}`);
    }
  }
});

test("a constant is echoed verbatim, and belongs to the family that has one", () => {
  const spelled =
    `v=${VERSION}&f=phoenix&cx=0.56670000000000000001&cy=-0.0e0&px=-0.5&py=0&zx=0&zy=0`;
  assert.equal(canonicalize(spelled, CONTEXT), `${spelled}&${HOUSE}`);
  assert.throws(() => parse(`v=${VERSION}&cx=0.3`, CONTEXT), /mandelbrot has none/);
  assert.throws(() => parse(`v=${VERSION}&f=julia&px=0.3`, CONTEXT), /julia has cx and cy/);
  assert.throws(() => parse(`v=${VERSION}&f=julia&cx=0x10`, CONTEXT), /decimal number/);
});

test("z₋₁ is a phoenix constant, and a link written before it existed still means zero", () => {
  // The one key version 2 gained after it shipped, and the whole reason it is a
  // widening rather than a version 3: absent means the origin, which is what every
  // link written without it already drew. Most of the Phoenix work the wallpaper
  // project holds carries a non-zero one, so a contract that could not say it would
  // quietly draw the classic slice under a name that meant something else.
  const classic = `v=${VERSION}&f=phoenix&${seeds("phoenix")}`;
  assert.equal(canonicalize(`v=${VERSION}&f=phoenix`, CONTEXT), `${classic}&${HOUSE}`);
  assert.equal(canonicalize("v=1&f=phoenix", CONTEXT), `${classic}&${HOUSE}`);
  assert.equal(parse(`v=${VERSION}&f=phoenix`, CONTEXT).constants.zx.text, "0");

  const memory = `v=${VERSION}&f=phoenix&cx=0.5667&cy=0&px=-0.5&py=0&zx=0.2398&zy=-0.4506`;
  const view = parse(memory, CONTEXT);
  assert.equal(view.constants.zx.text, "0.2398");
  assert.equal(view.constants.zy.value, -0.4506);
  assert.equal(emit(view, CONTEXT), `${memory}&${HOUSE}`);

  assert.throws(() => parse(`v=${VERSION}&zx=0.3`, CONTEXT), /mandelbrot has none/);
  assert.throws(() => parse(`v=${VERSION}&f=julia&zy=0.3`, CONTEXT), /julia has cx and cy/);
});

test("a mode's parameters are its own, and a mode with none refuses them all", () => {
  assert.deepEqual(parse(`v=${VERSION}&m=stripe&density=9`, CONTEXT).params, { density: 9 });
  assert.throws(() => parse(`v=${VERSION}&density=9`, CONTEXT), /the smooth mode has no density/);
  assert.throws(() => parse(`v=${VERSION}&m=stripe&weight=0.5`, CONTEXT), /stripe mode has no weight/);
  assert.throws(() => parse(`v=${VERSION}&m=smooth_stripe&sigma=0.2`, CONTEXT), /has no sigma/);
  assert.throws(() => parse(`v=${VERSION}&m=stripe&density=0`, CONTEXT), /has to be positive/);
  assert.throws(() => parse(`v=${VERSION}&m=threads&weight=2`, CONTEXT), /between 0 and 1/);
});

test("a parameter nobody moved stays out of the link, so a retuned mode moves with it", () => {
  // The opposite ruling from `p` and the constants, and the reason is that a mode's
  // defaults live in the same catalog its identity does: a link that says `stripe`
  // and nothing else is asking for the stripe mode, not for a stripe mode at 6.
  assert.equal(canonicalize(`v=${VERSION}&m=stripe`, CONTEXT), `v=${VERSION}&m=stripe&${HOUSE}`);
  assert.equal(
    canonicalize(`v=${VERSION}&m=stripe&density=6`, CONTEXT),
    `v=${VERSION}&m=stripe&density=6&${HOUSE}`,
  );
});

test("every key round-trips, and comes back in contract order", () => {
  assert.equal(canonicalize(EVERYTHING, CONTEXT), EVERYTHING);
  const view = parse(EVERYTHING, CONTEXT);
  assert.equal(view.mode, "smooth_stripe");
  assert.deepEqual(view.params, { density: 9, weight: 0.6 });
  assert.equal(view.aspect.across, 21);
  assert.equal(view.palette, "cmr.wildfire");
  assert.deepEqual(view.shade.transfer, { kind: "edge", weight: 1.5 });
  assert.deepEqual(view.shade.rolloff, { kind: "soft_knee", knee: 0.6 });
  assert.equal(view.shade.reverse, true);
  assert.equal(view.shade.mirror, true);
});

test("keys given out of order come back in contract order", () => {
  const shuffled = `v=${VERSION}&rolloff=aces&p=viridis&w=0.44&cy=0.3&transfer=rank&f=julia&cx=-0.5&y=0.85&gamma=2&x=-0.1`;
  assert.equal(
    canonicalize(shuffled, CONTEXT),
    `v=${VERSION}&f=julia&cx=-0.5&cy=0.3&x=-0.1&y=0.85&w=0.44&p=viridis&gamma=2&transfer=rank&rolloff=aces`,
  );
});

test("a key set to its engine default is dropped on emit, and p is the exception", () => {
  const spelled =
    `v=${VERSION}&f=mandelbrot&m=smooth&a=16:9&${HOUSE}` +
    "&gamma=1&cycles=1&phase=0&reverse=0&mirror=0&transfer=value&rolloff=none";
  assert.equal(canonicalize(spelled, CONTEXT), `v=${VERSION}&${HOUSE}`);
});

test("a coordinate is echoed verbatim, not reformatted through a double", () => {
  // More digits than `f64` carries, and a needlessly explicit exponent. Both come
  // back exactly as written: the string is the identity of the location, and this
  // page is not the thing that gets to decide it was too precise.
  const wordy = `v=${VERSION}&x=0.40000000000000000000000000001&y=-0.0e0&w=1.250e-3`;
  assert.equal(canonicalize(wordy, CONTEXT), `${wordy}&${HOUSE}`);
});

test("an exponent's plus sign is encoded, because a raw one in a query means a space", () => {
  assert.equal(canonicalize(`v=${VERSION}&w=1.25e%2B3`, CONTEXT), `v=${VERSION}&w=1.25e%2B3&${HOUSE}`);
  assert.throws(() => parse(`v=${VERSION}&w=1.25e+3`, CONTEXT), /decimal number/);
});

test("a coordinate this page generates is the shortest string that reads back the same", () => {
  const value = 4.4 / 3;
  const made = coordinateOf(value);
  assert.equal(Number(made.text), value);
  assert.equal(made.text, "1.4666666666666668");
});

test("the field key ignores everything that cannot change the field", () => {
  const one = parse(`v=${VERSION}&x=-0.1&y=0.85&w=0.44&p=viridis&gamma=2`, CONTEXT);
  const two = parse(`v=${VERSION}&x=-0.1&y=0.85&w=0.44&p=magma&rolloff=aces`, CONTEXT);
  assert.equal(fieldKey(one, CONTEXT, 1280, 720), fieldKey(two, CONTEXT, 1280, 720));
  const elsewhere = parse(`v=${VERSION}&x=-0.2&y=0.85&w=0.44`, CONTEXT);
  assert.notEqual(fieldKey(one, CONTEXT, 1280, 720), fieldKey(elsewhere, CONTEXT, 1280, 720));
  assert.notEqual(fieldKey(one, CONTEXT, 1280, 720), fieldKey(one, CONTEXT, 640, 360));
  // A family, a mode and a mode's parameter all decide the arithmetic.
  const julia = parse(`v=${VERSION}&f=julia&x=-0.1&y=0.85&w=0.44&p=viridis`, CONTEXT);
  assert.notEqual(fieldKey(one, CONTEXT, 1280, 720), fieldKey(julia, CONTEXT, 1280, 720));
  const dense = parse(`v=${VERSION}&m=stripe&density=9`, CONTEXT);
  const plain = parse(`v=${VERSION}&m=stripe`, CONTEXT);
  assert.notEqual(fieldKey(dense, CONTEXT, 640, 360), fieldKey(plain, CONTEXT, 640, 360));
});

test("a direct trap is keyed on its colour too, because it has no field to recolour", () => {
  const one = parse(`v=${VERSION}&m=direct_trap_ring&p=viridis`, CONTEXT);
  const two = parse(`v=${VERSION}&m=direct_trap_ring&p=magma`, CONTEXT);
  assert.equal(fieldKey(one, CONTEXT, 640, 360, false), fieldKey(two, CONTEXT, 640, 360, false));
  assert.notEqual(fieldKey(one, CONTEXT, 640, 360, true), fieldKey(two, CONTEXT, 640, 360, true));
});

test("an unknown key is refused", () => {
  assert.throws(() => parse(`v=${VERSION}&zoom=3`, CONTEXT), /does not know: zoom/);
  assert.throws(() => parse(`v=${VERSION}&pp=0.5`, CONTEXT), /does not know: pp/);
});

test("a family or a mode this page does not draw says which kind of no it is", () => {
  assert.throws(() => parse(`v=${VERSION}&f=fractional_multibrot`, CONTEXT), /render-only/);
  assert.throws(() => parse(`v=${VERSION}&f=burningship`, CONTEXT), /no family called burningship/);
  assert.throws(() => parse(`v=${VERSION}&m=de`, CONTEXT), /niche mode/);
  assert.throws(() => parse(`v=${VERSION}&m=lighting`, CONTEXT), /no mode called lighting/);
});

test("a coordinate is a decimal string, capped, and a width is positive", () => {
  assert.throws(() => parse(`v=${VERSION}&x=0x10`, CONTEXT), /decimal number/);
  assert.throws(() => parse(`v=${VERSION}&x=NaN`, CONTEXT), /decimal number/);
  assert.throws(() => parse(`v=${VERSION}&x=0.${"1".repeat(70)}`, CONTEXT), /capped at 64/);
  assert.throws(() => parse(`v=${VERSION}&w=0`, CONTEXT), /has to be positive/);
  assert.throws(() => parse(`v=${VERSION}&w=-1`, CONTEXT), /has to be positive/);
});

test("the same key twice is refused, because there is no rule for which wins", () => {
  assert.throws(() => parse(`v=${VERSION}&x=0&x=1`, CONTEXT), /twice/);
});

test("a palette outside the baked set is refused, and an unoffered one is not", () => {
  assert.throws(() => parse(`v=${VERSION}&p=no_such_map`, CONTEXT), /no palette called no_such_map/);
  assert.ok(PALETTES.has(DEFAULT_PALETTE));
  assert.equal(PALETTES.get(DEFAULT_PALETTE).offered, true);
  // The baked set is wider than the offered one: a map this site drew a figure in has
  // to be nameable, or the explorer cannot open that figure at all. It is still not on
  // the menu — see the note in `builder/explorer.py`.
  assert.equal(PALETTES.get("Ice Walk").offered, false);
  assert.equal(parse(`v=${VERSION}&p=Ice%20Walk`, CONTEXT).palette, "Ice Walk");
});

test("folding a cyclic map is refused, because there is no seam to fix", () => {
  assert.equal(PALETTES.get("twilight").cyclic, true);
  assert.throws(() => parse(`v=${VERSION}&p=twilight&mirror=1`, CONTEXT), /halve the cycle/);
  assert.equal(PALETTES.get("viridis").cyclic, false);
  assert.equal(
    canonicalize(`v=${VERSION}&p=viridis&mirror=1`, CONTEXT),
    `v=${VERSION}&p=viridis&mirror=1`,
  );
});

test("a tagged shade value needs exactly the parameter its kind takes", () => {
  assert.throws(() => parse(`v=${VERSION}&transfer=edge`, CONTEXT), /needs its weight/);
  assert.throws(() => parse(`v=${VERSION}&transfer=rank:2`, CONTEXT), /takes no value/);
  assert.throws(() => parse(`v=${VERSION}&transfer=edge:-1`, CONTEXT), /at least 0/);
  assert.throws(() => parse(`v=${VERSION}&rolloff=soft_knee:1`, CONTEXT), /below 1/);
  assert.throws(() => parse(`v=${VERSION}&rolloff=filmic`, CONTEXT), /none, soft_knee, reinhard, aces/);
});

// ------------------------------------------------------------ the recipe's controls
//
// The seven shade keys were link-only for two drafts and now have controls, so what a
// control says and what a link says have to be the same statement. `shade.js` is where
// a control's value crosses into the recipe; these hold that crossing to the contract
// rather than to a second reading of it.

/** A control value per key, spelled the way its control holds it. Every key of the
 *  recipe is here, and a key added without a spelling fails the first test below —
 *  which is the point: a new knob arrives with its coverage or it does not arrive. */
const TYPED = {
  gamma: ["0.75", "2.5"],
  cycles: ["3", "0.5"],
  phase: ["0.25", "-0.5"],
  reverse: ["1"],
  mirror: ["1"],
  transfer: ["rank", "edge:1.5"],
  rolloff: ["aces", "soft_knee:0.35"],
};

test("every shade key has a control, and it opens at the engine's own default", () => {
  assert.deepEqual(
    shade.CONTROLS.map((control) => control.key),
    SHADE_KEYS.map((spec) => spec.key),
  );
  const engine = defaultShade();
  for (const spec of SHADE_KEYS) {
    assert.ok(TYPED[spec.key], `${spec.key} has no control value under test`);
    // What the control shows when a link says nothing is what a link that says nothing
    // means — read out of the contract, not typed a second time on the page.
    assert.equal(shade.isDefault(engine, spec.key), true, spec.key);
    assert.equal(shade.spelling(engine, spec.key), spec.write(spec.fallback), spec.key);
  }
  assert.deepEqual(shade.chosen(engine), []);
  // A tagged control's menu is the contract's own vocabulary, in its own order.
  const transfer = shade.CONTROLS.find((control) => control.key === "transfer");
  assert.deepEqual(
    transfer.kinds.map((kind) => kind.kind),
    ["value", "edge", "rank"],
  );
  assert.equal(transfer.kinds.find((kind) => kind.kind === "edge").parameter, "weight");
  assert.equal(transfer.kinds.find((kind) => kind.kind === "rank").parameter, null);
});

test("every shade key round-trips from its control, through a link, back to its control", () => {
  // The whole property, key by key: what a reader types into a control is what the
  // address bar carries, and a link somebody sends back shows the same thing in the
  // same control. `viridis` because it is sequential — a cyclic map refuses the fold.
  const base = parse(`v=${VERSION}&p=viridis`, CONTEXT);
  for (const spec of SHADE_KEYS) {
    for (const typed of TYPED[spec.key]) {
      const where = `${spec.key}=${typed}`;
      const view = { ...base, shade: shade.withKey(base.shade, spec.key, typed) };
      const emitted = emit(view, CONTEXT);
      assert.match(emitted, new RegExp(`(^|&)${spec.key}=`), where);
      const back = parse(emitted, CONTEXT);
      assert.equal(shade.spelling(back.shade, spec.key), typed, where);
      assert.deepEqual(shade.chosen(back.shade), [spec.key], where);
      // And the reason a control can be instant: not one of the seven is on the field
      // side of the cache, so every one of them re-shades what is already computed.
      assert.equal(
        fieldKey(view, CONTEXT, 1280, 720),
        fieldKey(base, CONTEXT, 1280, 720),
        where,
      );
    }
  }
});

test("a direct trap is the one mode shape a shade key re-iterates under", () => {
  // Those four composite gradient samples as they iterate and have no field to
  // recolour, so their key carries the recipe — the same ruling the palette picker
  // already pays there, and the reason the page says so under the strip.
  const trap = parse(`v=${VERSION}&m=direct_trap_ring&p=viridis`, CONTEXT);
  for (const spec of SHADE_KEYS) {
    const moved = { ...trap, shade: shade.withKey(trap.shade, spec.key, TYPED[spec.key][0]) };
    assert.notEqual(
      fieldKey(moved, CONTEXT, 640, 360, true),
      fieldKey(trap, CONTEXT, 640, 360, true),
      spec.key,
    );
  }
});

test("a control out of range is refused in the contract's own words", () => {
  // The control never phrases a refusal of its own: it hands the text to the contract
  // and shows the sentence a refused link would be shown.
  const view = parse(`v=${VERSION}&p=viridis`, CONTEXT);
  assert.throws(() => shade.withKey(view.shade, "gamma", "0"), /gamma has to be positive/);
  assert.throws(() => shade.withKey(view.shade, "cycles", "-1"), /cycles has to be positive/);
  assert.throws(() => shade.withKey(view.shade, "phase", "over"), /phase has to be a number/);
  assert.throws(() => shade.withKey(view.shade, "reverse", "2"), /reverse is 0 or 1/);
  assert.throws(() => shade.withKey(view.shade, "transfer", "edge"), /needs its weight/);
  assert.throws(() => shade.withKey(view.shade, "rolloff", "soft_knee:1"), /below 1/);
  assert.throws(() => shade.withKey(view.shade, "gamma", ""), /gamma has to be a number/);
  assert.throws(() => shade.withKey(view.shade, "sweep", "1"), /no shade key called sweep/);
});

test("a tagged control's two halves spell exactly one link value", () => {
  // The menu holds the kind and the box beside it holds the one number that kind takes,
  // and between them they write the string a link carries. A kind that takes nothing
  // writes nothing, which is why the box is not shown beside it.
  assert.deepEqual(shade.parts("soft_knee:0.35"), { kind: "soft_knee", value: "0.35" });
  assert.deepEqual(shade.parts("aces"), { kind: "aces", value: "" });
  assert.equal(shade.spell("soft_knee", "0.35"), "soft_knee:0.35");
  assert.equal(shade.spell("aces", ""), "aces");
  // A kind that takes a number has no default to open at — the contract refuses it
  // without one — so the menu opens it at a value the wallpaper project itself renders,
  // and that value has to be one the contract takes.
  const view = parse(`v=${VERSION}&p=viridis`, CONTEXT);
  for (const control of shade.CONTROLS) {
    for (const kind of control.kinds ?? []) {
      assert.equal(kind.parameter === null, kind.opening === null, kind.kind);
      const spelled = shade.spell(kind.kind, kind.opening ?? "");
      assert.equal(shade.spelling(shade.withKey(view.shade, control.key, spelled), control.key), spelled);
    }
  }
});

test("an aspect is a shape, and both sides are bounded", () => {
  assert.equal(parse(`v=${VERSION}&a=4:3`, CONTEXT).aspect.down, 3);
  assert.throws(() => parse(`v=${VERSION}&a=16x9`, CONTEXT), /across:down/);
  assert.throws(() => parse(`v=${VERSION}&a=0:9`, CONTEXT), /between 1 and 10000/);
});

test("every palette the picker offers is one a link may name", () => {
  for (const name of PALETTES.keys()) {
    const view = parse(`v=${VERSION}&p=${encodeURIComponent(name)}`, CONTEXT);
    assert.equal(view.palette, name);
    assert.equal(canonicalize(emit(view, CONTEXT), CONTEXT), emit(view, CONTEXT));
  }
});

test("every link the site carries parses, and is the canonical spelling of its view", () => {
  // `explorer/links.jsonl` is what an article page's "open in fractal explorer" points
  // at, one row per figure and per gallery tile. A link that stopped parsing would look
  // exactly like a link that worked until somebody clicked it, and a contract change is
  // precisely what could stop one — so the registry is held to the contract here, where
  // the contract lives, rather than in a second reading of it somewhere else.
  const rows = readFileSync(new URL("./links.jsonl", import.meta.url), "utf8")
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line));
  assert.ok(rows.length > 0);
  let linked = 0;
  for (const row of rows) {
    assert.equal(row.schema, 1, row.id);
    assert.equal(row.kind, "link", row.id);
    assert.equal(row.link === undefined, row.no_link !== undefined, row.id);
    if (row.link === undefined) continue;
    linked++;
    const view = parse(row.link, CONTEXT);
    assert.equal(emit(view, CONTEXT), row.link, row.id);
    assert.equal(view.version, VERSION, row.id);
  }
  assert.ok(linked > 0, "no row of the registry carries a link");
});

test("the contract's roster is the engine's production roster, in the same order", () => {
  // The one place the two lists meet. `catalog.js` is baked from `fractal-engine
  // modes` and this one is typed, deliberately — a contract that read its own
  // vocabulary from a generated file could be widened by rebuilding it — so they
  // are compared instead.
  assert.deepEqual(MODES, [...IDENTITIES.keys()]);
  assert.deepEqual([...MODES].sort(), Object.keys(CURVES).sort());
  for (const mode of Object.keys(MODE_PARAMETERS)) assert.ok(MODES.includes(mode), mode);
  for (const family of FAMILIES) assert.ok(HOMES[family], family);
});
