// The custom (experimental) render mode, without a browser: what a link says, what an
// example location opens with, and what a view becomes as `style.wasm`'s request.
//
// The pictures themselves are held elsewhere, because they take minutes: `bench/
// custom-parity.mjs` (Node) and `bench/custom-browser.mjs` (the served page) draw every
// example, and `bench/custom-compare.py` holds them to the pipeline's bytes.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { canonicalize, emit, encode, parse, PermalinkError } from "./permalink.js";
import {
  contractOf,
  exampleCustom,
  exampleQuery,
  familyOf,
  libraryColormap,
  modesOf,
  offeredExamples,
  poolSize,
  requestOf,
  roundEven,
  stackOf,
  tilesOf,
} from "./style.js";

const bundle = JSON.parse(readFileSync(new URL("./custom-modes.json", import.meta.url), "utf8"));
const modes = modesOf(bundle);

const written = (text) => ({ text, value: Number(text) });
const CONTEXT = {
  home: () => ({ x: written("-0.77"), y: written("0"), w: written("4.4") }),
  constants: () => ({ cx: written("0"), cy: written("0") }),
  palettes: new Map([
    ["twilight_shifted", { cyclic: true }],
    ["Blues", { cyclic: false }],
  ]),
  defaultPalette: "twilight_shifted",
  settled: () => ({}),
  curve: () => null,
  customs: contractOf(bundle),
};

/** Each example as `[mode, shown, id]`, numbered as `style wasm-parity` numbers them. */
const EXAMPLES = bundle.modes.flatMap((mode) => mode.shown.map((shown, index) => [mode, shown, `${mode.style}__${index}`]));

/** The keeps no setting of the published mode reaches (item 003, ruling C): drawn with a
 *  stack whose tone or layers are not the published one's. */
const UNREACHED = ["bronze_packing__0", "bronze_packing__1", "bronze_packing__2", "lit_petals__1", "lit_petals__2"];

test("the bundle is the nine published modes, each with its knobs and an example", () => {
  assert.equal(bundle.schema, 1);
  assert.equal(bundle.modes.length, 9);
  for (const mode of bundle.modes) {
    assert.ok(mode.shown.length > 0, mode.name);
    assert.ok(bundle.colormaps[mode.palette], `${mode.name}'s map is carried`);
    for (const knob of mode.knobs) {
      assert.ok(knob.range[0] <= knob.default && knob.default <= knob.range[1], `${mode.name} ${knob.name}`);
      assert.ok(knob.label && knob.what, `${mode.name} ${knob.name} is labelled`);
    }
  }
});

test("an example opens at the mode's defaults, plus the setting that reproduces its keep", () => {
  const unreached = EXAMPLES.filter(([mode, shown]) => !exampleCustom(mode, shown).reached).map(([, , id]) => id);
  assert.deepEqual(unreached, UNREACHED);
  const tunnel = modes.get("arch-tunnel");
  assert.deepEqual(exampleCustom(tunnel, tunnel.shown[0]).custom.knobs, { turns: 3 });
  const silk = modes.get("silk-waves");
  for (const shown of silk.shown) assert.equal(exampleCustom(silk, shown).custom.autotone, false);
  const brass = modes.get("brass-foam");
  assert.deepEqual(exampleCustom(brass, brass.shown[0]).custom, {
    name: "brass-foam",
    knobs: {},
    matched: true,
    autotone: true,
    projection: null,
  });
});

test("each mode offers one button a picture: 22 of the 23 keeps", () => {
  const offered = bundle.modes.flatMap((mode) => offeredExamples(mode, encode).map(({ index }) => `${mode.style}__${index}`));
  assert.equal(offered.length, 22);
  assert.ok(!offered.includes("lit_petals__1"), "soft-petals' second draws its first's picture");
  const unreached = bundle.modes.flatMap((mode) =>
    offeredExamples(mode, encode).filter(({ reached }) => !reached).map(({ index }) => `${mode.style}__${index}`),
  );
  assert.deepEqual(unreached, ["bronze_packing__0", "bronze_packing__1", "bronze_packing__2", "lit_petals__2"]);
});

test("an example's link is a fixed point, and reads back as the example's request", () => {
  for (const [mode, shown, id] of EXAMPLES) {
    const query = exampleQuery(mode, shown, { palette: "twilight_shifted", encode });
    const view = parse(query, CONTEXT);
    assert.equal(canonicalize(emit(view, CONTEXT), CONTEXT), emit(view, CONTEXT), id);
    assert.deepEqual(view.custom, exampleCustom(mode, shown).custom, id);
    const request = requestOf({ bundle, mode, custom: view.custom, view, maxiter: view.maxiter, width: 640, height: 400 });
    const { location } = request;
    assert.equal(familyOf(location.family), familyOf(shown.location.family), id);
    assert.equal(location.family.degree ?? 2, shown.location.family.degree ?? 2, id);
    assert.deepEqual(location.family.c ?? null, shown.location.family.c ?? null, id);
    assert.deepEqual(location.viewport, shown.location.viewport, id);
    assert.equal(location.maxiter, shown.location.maxiter, id);
    assert.deepEqual(location.projection ?? null, shown.location.projection ?? null, id);
    assert.deepEqual(request.colormap, bundle.colormaps[mode.palette], id);
    assert.deepEqual(request.resolution, [640, 400]);
    assert.equal(request.supersample, 2);
  }
});

test("Auto tone off drops the stack's tone pass and nothing else", () => {
  const mode = modes.get("gilt-orbs");
  const custom = { name: mode.name, knobs: {}, matched: true, autotone: false, projection: null };
  const { tone, ...rest } = mode.stack;
  assert.ok(tone);
  assert.deepEqual(stackOf(mode, custom), rest);
  assert.equal(stackOf(mode, { ...custom, autotone: true }), mode.stack);
});

test("Matched palette off draws the view's palette, reversed by Reverse", () => {
  const mode = modes.get("gilt-orbs");
  const view = parse(`v=4&custom=gilt-orbs&matched=0&p=Blues&reverse=1`, CONTEXT);
  const baked = { kind: "sequential", stops: [[0, [0, 0, 0]], [0.25, [10, 10, 10]], [1, [255, 255, 255]]] };
  const request = requestOf({ bundle, mode, custom: view.custom, view, maxiter: 500, stopsOf: () => baked, width: 8, height: 5 });
  assert.equal(request.colormap.kind, "sequential");
  assert.deepEqual(request.colormap.stops, [[0, [255, 255, 255]], [0.75, [10, 10, 10]], [1, [0, 0, 0]]]);
  assert.deepEqual(libraryColormap("Blues", baked).stops, baked.stops);
});

test("the custom keys round-trip, defaults left out, knobs in the mode's order", () => {
  const knobs = "light_angle:90,orb_size:0.2,haze:0.5";
  const view = parse(`v=4&f=multibrot3&custom=gilt-orbs&knobs=${knobs}&autotone=0&matched=0&p=Blues`, CONTEXT);
  // haze 0.5 is its default, so it is not held; orb_size comes first in the mode's order.
  assert.deepEqual(view.custom.knobs, { light_angle: 90, orb_size: 0.2 });
  assert.equal(emit(view, CONTEXT), "v=4&f=multibrot3&custom=gilt-orbs&knobs=orb_size:0.2,light_angle:90&matched=0&autotone=0&p=Blues");
});

test("under a custom mode the engine mode's keys are read, held to their rules, and dropped", () => {
  const view = parse("v=4&m=smooth_stripe&density=4&custom=gilt-orbs&p=twilight_shifted", CONTEXT);
  assert.equal(view.mode, "smooth");
  assert.deepEqual(view.params, {});
  assert.equal(emit(view, CONTEXT), "v=4&custom=gilt-orbs&p=twilight_shifted");
  assert.throws(() => parse("v=4&m=smooth_stripe&density=x&custom=gilt-orbs", CONTEXT), PermalinkError);
});

test("a link without a custom mode is the string it always was", () => {
  const plain = "v=4&f=julia&cx=0&cy=0&m=smooth_stripe&density=4&p=twilight_shifted";
  const view = parse(plain, CONTEXT);
  assert.equal(view.custom, null);
  assert.equal(emit(view, CONTEXT), plain);
});

test("a custom link that cannot be read is refused in a sentence", () => {
  const refused = [
    "v=4&custom=no-such-mode",
    "v=4&knobs=orb_size:0.2",
    "v=4&matched=0",
    "v=4&custom=gilt-orbs&knobs=orb_size:9",
    "v=4&custom=gilt-orbs&knobs=no_knob:1",
    "v=4&custom=gilt-orbs&knobs=orb_size",
    "v=4&custom=gilt-orbs&knobs=orb_size:0.2,orb_size:0.25",
    "v=4&custom=gilt-orbs&matched=2",
    "v=4&custom=gilt-orbs&projection=twist:0.1",
    "v=4&custom=arch-tunnel&projection=twist:x",
  ];
  for (const query of refused) {
    assert.throws(() => parse(query, CONTEXT), PermalinkError, query);
    try {
      parse(query, CONTEXT);
    } catch (error) {
      assert.doesNotMatch(error.message, /"knobs"|"custom"|"matched"|"projection"/, query);
    }
  }
});

test("tiles cover the picture once, the centre's first", () => {
  for (const [width, height] of [[640, 400], [1000, 563], [97, 13]]) {
    const tiles = tilesOf(width, height);
    const covered = new Uint8Array(width * height);
    for (const tile of tiles) {
      for (let y = tile.y; y < tile.y + tile.height; y++) {
        for (let x = tile.x; x < tile.x + tile.width; x++) covered[y * width + x] += 1;
      }
    }
    assert.ok(covered.every((count) => count === 1), `${width}x${height}`);
    const first = tiles[0];
    assert.ok(first.x <= width / 2 && width / 2 <= first.x + first.width);
  }
});

test("a whole-number member rounds half to even, as the module does", () => {
  assert.deepEqual([2.5, 3.5, -2.5, 4.4, 4.6].map(roundEven), [2, 4, -2, 4, 5]);
});

test("the pool takes half the machine's threads, one to eight", () => {
  assert.equal(poolSize(1), 1);
  assert.equal(poolSize(12), 6);
  assert.equal(poolSize(64), 8);
});
