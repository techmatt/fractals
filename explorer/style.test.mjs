// The custom render modes, Custom and Custom (lab), without a browser: what a link says, what an
// example location opens with, and what a view becomes as `style.wasm`'s request.
//
// The pictures themselves are held elsewhere, because they take minutes: `bench/
// custom-parity.mjs` (Node) and `bench/custom-browser.mjs` (the served page) draw every
// example, and `bench/custom-compare.py` holds them to the pipeline's bytes.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { canonicalize, emit, encode, parse, PermalinkError } from "./permalink.js";
import {
  aliasesOf,
  constantsOf,
  contractOf,
  exampleAt,
  exampleCustom,
  freshCustom,
  knobRest,
  turned,
  exampleQuery,
  familyOf,
  INTEGER_MEMBERS,
  MAX_CUSTOM_SAMPLES,
  PASS_MEMORY,
  BYTES_PER_SAMPLE,
  WORKER_MEMORY,
  workersFor,
  libraryColormap,
  modesOf,
  offeredExamples,
  palettesOf,
  placeOf,
  poolSize,
  requestOf,
  roundEven,
  stackOf,
  tierOf,
  tilesOf,
  TIERS,
  withValues,
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
 *  stack whose tone or layers are not the published one's. Since wallpapers 050, the lab
 *  tier's round-one drafts and keeps from earlier rounds, and one curated keep
 *  (satin-spiral's second, `glossy_spirals__1`). Since 054, scaled-folds' keep, whose sixth
 *  layer was off (opacity 0) where the published one draws it at 0.9. Since 4c1501e (056 to
 *  067), eleven lab keeps drawn with a round's variant of the stack (tri-mosaic's post
 *  pass, stirred-ink's stir, the stroke widths and tilts, frost-stipple's, grain-fans' and
 *  draped-folds' named variants), or before gilded-leaves' bubble fade. Since a98ff12 (072
 *  to 074), glass-orbs' (its `no_ripples` variant, the ripple glow off). Light-shafts'
 *  (its published stack moved to round two's `subtler` default, 083) is reached again
 *  since 7c62551 shows the round-two `ls2_subtler` keep; feather-plumes' new card
 *  (`fp2_stack_2d84_tempest`) is still not the published stack. Since 232db92 (085, 087)
 *  two more are reached: cauliflower-scales' card is a keep of its published stack, and
 *  chrome-whorl's published `rings` is its kept 0.6. Marbled-pour's card (kept at 10 paper
 *  sheets, 4569f4e) and veil-shards' (its `f_broad` keep, 078b600) were unreached until
 *  7074d32 (094) moved both published stacks to their kept readings. */
const UNREACHED = [
  "teal_filaments__1",
  "star_eye__2",
  "ember_rose__2",
  "flame_veil_teal__0",
  "flame_veil_chalk__2",
  "flame_wisp_amber__0",
  "flame_wisp_spark__0",
  "glossy_spirals__1",
  "banded_lines__1",
  "scaled_folds__0",
  "tri_mosaic__1",
  "tri_mosaic__2",
  "stirred_ink__2",
  "paper_layers__1",
  "mercury_tubes__1",
  "hairline_rays__0",
  "frost_stipple__0",
  "grain_fans__0",
  "draped_folds__0",
  "draped_folds__1",
  "gilded_leaves__0",
  "glass_orbs__0",
  "feather_plumes__0",
  "storm_clouds__0",
  "starburst_veils__0",
];

test("the bundle is the 67 published modes in two tiers, each with an example", () => {
  assert.equal(bundle.schema, 1);
  assert.equal(bundle.modes.length, 67);
  const tiers = bundle.modes.map((mode) => tierOf(mode));
  assert.equal(tiers.filter((tier) => tier === "curated").length, 16);
  assert.equal(tiers.filter((tier) => tier === "lab").length, 51);
  for (const mode of bundle.modes) {
    assert.ok(mode.shown.length > 0, mode.name);
    // A curated mode has four or five knobs (the catalog's tier rule); a lab mode may have none.
    if (tierOf(mode) === "curated") assert.ok(mode.knobs.length >= 3 && mode.knobs.length <= 5, mode.name);
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
    palette: null,
    knobs: {},
    matched: true,
    autotone: true,
    projection: null,
  });
});

test("each mode offers one button a picture: 114 of the 116 keeps", () => {
  const offered = bundle.modes.flatMap((mode) => offeredExamples(mode, encode).map(({ index }) => `${mode.style}__${index}`));
  assert.equal(offered.length, 114);
  assert.equal(EXAMPLES.length, 116);
  // star-eye's third keep draws its second's picture under the published settings, and
  // draped-folds' second its first's (both kept at the same place under round variants).
  const unoffered = ["star_eye__2", "draped_folds__1"];
  assert.deepEqual(
    EXAMPLES.map(([, , id]) => id).filter((id) => !offered.includes(id)),
    unoffered,
  );
  const unreached = bundle.modes.flatMap((mode) =>
    offeredExamples(mode, encode).filter(({ reached }) => !reached).map(({ index }) => `${mode.style}__${index}`),
  );
  assert.deepEqual(
    unreached,
    UNREACHED.filter((id) => !unoffered.includes(id)),
  );
});

test("a Phoenix place opens with its constants, the engine's defaults where it names none", () => {
  const [mode, shown] = EXAMPLES.find(([, each]) => each.location.family.kind === "phoenix" && !each.location.family.c);
  const view = parse(exampleQuery(mode, shown, { palette: "twilight_shifted", encode }), CONTEXT);
  assert.equal(view.family, "phoenix");
  const { location } = requestOf({ bundle, mode, custom: view.custom, view, maxiter: view.maxiter, width: 8, height: 5 });
  assert.deepEqual(location.family.c.map(Number), [0.5667, 0]);
  assert.deepEqual(location.family.p.map(Number), [-0.5, 0]);
  assert.deepEqual(location.family.z_prev.map(Number), [0, 0]);
});

test("each tier is a select entry of its own, and a mode's tier is its record's", () => {
  assert.deepEqual(
    TIERS.map(({ option, label }) => [option, label]),
    [
      ["custom", "Custom"],
      ["custom-lab", "Custom (lab)"],
    ],
  );
  assert.equal(tierOf(modes.get("brass-foam")), "curated");
  assert.equal(tierOf(modes.get("teal-mist")), "lab");
  // A bundle from before the tiers is all curated.
  assert.equal(tierOf({ name: "old" }), "curated");
  // A link names the mode, never the tier: a lab mode's link is `custom=<name>` too.
  const view = parse("v=4&custom=teal-mist", CONTEXT);
  assert.equal(view.custom.name, "teal-mist");
  assert.equal(emit(view, CONTEXT), "v=4&custom=teal-mist&p=twilight_shifted");
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
    const named = Object.fromEntries(constantsOf(shown.location.family));
    const drawn = Object.fromEntries(constantsOf(location.family));
    assert.deepEqual(Object.keys(drawn), Object.keys(named), id);
    for (const key of Object.keys(named)) assert.equal(Number(drawn[key]), Number(named[key]), `${id} ${key}`);
    assert.deepEqual(location.viewport, shown.location.viewport, id);
    assert.equal(location.maxiter, shown.location.maxiter, id);
    assert.deepEqual(location.projection ?? null, shown.location.projection ?? null, id);
    assert.deepEqual(request.colormap, bundle.colormaps[shown.colormap], id);
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

test("a whole-number knob in a link reads as the number the module draws", () => {
  // 004_bug_hunt: `turns:4.5` drew 4 turns while the box and the slider said 5.
  const read = (query) => parse(query, CONTEXT).custom.knobs;
  assert.deepEqual(read("v=4&custom=arch-tunnel&knobs=turns:4.5"), { turns: 4 });
  assert.deepEqual(read("v=4&custom=arch-tunnel&knobs=turns:3.5"), { turns: 4 });
  assert.deepEqual(read("v=4&custom=arch-tunnel&knobs=turns:5.4"), {}, "5 is the default, left out");
  // A fractional knob is read as written.
  assert.deepEqual(read("v=4&custom=arch-tunnel&knobs=arch_glow:0.45"), { arch_glow: 0.45 });
  const once = emit(parse("v=4&custom=arch-tunnel&knobs=turns:4.5", CONTEXT), CONTEXT);
  assert.equal(emit(parse(once, CONTEXT), CONTEXT), once, "and the link it writes is a fixed point");
});

test("an unset knob is at its palette's tuned value, which the link leaves out and nothing else", () => {
  // 022_bug_hunt: greenhorn tunes brass-foam's Star rays to 0.5 (default 0.3); the slider
  // said 0.3, and setting 0.3 was read as no setting, which drew 0.5.
  const mode = modes.get("brass-foam");
  const star = mode.knobs.find((knob) => knob.name === "star_rays");
  const greenhorn = palettesOf(mode).find((entry) => entry.colormap === "greenhorn");
  assert.equal(knobRest(mode, greenhorn, star), 0.5);
  assert.equal(knobRest(mode, palettesOf(mode)[0], star), star.default);
  const read = (query) => parse(query, CONTEXT).custom.knobs;
  assert.deepEqual(read("v=4&custom=brass-foam&tuned=greenhorn&knobs=star_rays:0.3"), { star_rays: 0.3 });
  assert.deepEqual(read("v=4&custom=brass-foam&tuned=greenhorn&knobs=star_rays:0.5"), {}, "its rest");
  assert.deepEqual(read("v=4&custom=brass-foam&knobs=star_rays:0.3"), {}, "the default palette's rest");
  for (const query of ["v=4&custom=brass-foam&tuned=greenhorn&knobs=star_rays:0.3&p=twilight_shifted", "v=4&custom=brass-foam&tuned=greenhorn&p=twilight_shifted"]) {
    assert.equal(emit(parse(query, CONTEXT), CONTEXT), query);
  }
  // Every rest the request draws is the stack's member: what the slider shows is the picture.
  for (const each of bundle.modes) {
    for (const entry of palettesOf(each)) {
      for (const knob of each.knobs) {
        const rest = knobRest(each, entry, knob);
        const custom = { ...freshCustom(each.name), palette: entry === palettesOf(each)[0] ? null : entry.colormap };
        const target = knob.set[0];
        const path = typeof target === "string" ? target : target.path;
        const steps = path.split("/").slice(1);
        const drawn = steps.reduce((node, step) => node?.[step], stackOf(each, custom));
        const asSet = steps.reduce((node, step) => node?.[step], turned(stackOf(each, custom), [knob], { [knob.name]: rest }));
        if (typeof drawn === "number") assert.ok(Math.abs(asSet - drawn) < 1e-9, `${each.name} ${entry.colormap} ${knob.name}`);
      }
    }
  }
});

test("a custom pass fits its workers' memory: fewer workers for a large picture, none past one's", () => {
  // 004_bug_hunt: every worker measures the whole frame, 90 to 250 bytes a sample over the
  // nine modes, and a wasm memory never shrinks.
  assert.ok(MAX_CUSTOM_SAMPLES * BYTES_PER_SAMPLE <= WORKER_MEMORY);
  assert.ok(WORKER_MEMORY < 4 * 2 ** 30);
  assert.ok(MAX_CUSTOM_SAMPLES >= 2560 * 1440 * 4, "a 1440p download at 4x is still offered");
  assert.ok(3840 * 2160 * 4 > MAX_CUSTOM_SAMPLES, "a 4K download at 4x is refused rather than trapping");
  // A typical screen keeps its whole pool; a download a worker can barely hold runs on one.
  assert.equal(workersFor(1200 * 750 * 4, 6), 6);
  assert.equal(workersFor(2560 * 1440 * 4, 8), 1);
  for (const samples of [1e5, 4e6, 8e6, 14e6]) {
    for (const size of [1, 3, 8]) {
      const workers = workersFor(samples, size);
      assert.ok(workers >= 1 && workers <= size);
      assert.ok(workers === 1 || workers * samples * BYTES_PER_SAMPLE <= PASS_MEMORY, `${samples} on ${size}`);
    }
  }
});

test("the whole-number members are the module's own list", (context) => {
  // A second copy lives here (`wholeKnob`, `turned`); a member added next door only would
  // give its slider a fractional step (004_bug_hunt). Read from the sibling checkout where
  // this machine has one.
  const settings = new URL("../local.toml", import.meta.url);
  const root = existsSync(settings) ? /wallpapers_root\s*=\s*"([^"]+)"/.exec(readFileSync(settings, "utf8"))?.[1] : null;
  const source = root ? `${root}/style-wasm/src/lib.rs` : null;
  if (!source || !existsSync(source)) {
    context.skip("no wallpapers checkout named in local.toml");
    return;
  }
  const line = /INTEGER_MEMBERS: \[&str; \d+\] = \[([^\]]*)\]/.exec(readFileSync(source, "utf8"));
  assert.ok(line, "lib.rs still spells INTEGER_MEMBERS");
  const theirs = [...line[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]).sort();
  assert.deepEqual([...INTEGER_MEMBERS].sort(), theirs);
});

// ---------------------------------------------------------------- palette sets (005_palette_cycle)

test("each mode carries its palette set, the mode's own map first, every map in the bundle", () => {
  for (const mode of bundle.modes) {
    const set = palettesOf(mode);
    assert.ok(set.length >= 1, mode.name);
    assert.equal(set[0].colormap, mode.palette, `${mode.name}'s default is its own map`);
    assert.deepEqual(set[0].values, {}, `${mode.name}'s default is the stack's own`);
    assert.equal(new Set(set.map((entry) => entry.colormap)).size, set.length, `${mode.name} names a map once`);
    for (const entry of set) assert.ok(bundle.colormaps[entry.colormap], `${mode.name}: ${entry.colormap} is carried`);
  }
  assert.deepEqual(
    palettesOf(modes.get("brass-foam")).map((entry) => entry.colormap),
    ["bronze_packing", "magma", "teal_tunnel", "twilight", "greenhorn"],
  );
  // A default kept nowhere is still the bundle's first entry (wallpapers 085): chrome-orbs'
  // and neon-loops' own maps, which the page once put back itself. The same array every call.
  for (const [name, set] of [
    ["chrome-orbs", ["chrome_orbs", "mercury_tubes"]],
    ["neon-loops", ["neon_loops", "tan_star_beams", "violet_threads"]],
  ]) {
    const mode = modes.get(name);
    assert.deepEqual(mode.palettes.map((entry) => entry.colormap), set, name);
    assert.equal(palettesOf(mode), mode.palettes, name);
  }
  const lone = modes.get("chrome-orbs");
  assert.equal(palettesOf(lone), palettesOf(lone));
});

test("an unset knob's rest is the bundle's, at every entry of every mode", () => {
  // Wallpapers 087 writes each entry's `rests` (`style_palettes.knob_rest`, read as
  // `knobRest` reads it); the page derives its own from the stack, held to them here.
  for (const mode of bundle.modes) {
    for (const entry of palettesOf(mode)) {
      for (const knob of mode.knobs) {
        const rest = knobRest(mode, entry, knob);
        assert.equal(rest, entry.rests?.[knob.name] ?? knob.default, `${mode.name} ${entry.colormap} ${knob.name}`);
        assert.ok(rest >= knob.range[0] && rest <= knob.range[1], `${mode.name} ${entry.colormap} ${knob.name} in range`);
      }
      for (const name of Object.keys(entry.rests ?? {})) {
        assert.ok(mode.knobs.some((knob) => knob.name === name), `${mode.name} ${entry.colormap}: ${name} is a knob`);
      }
    }
  }
});

test("a download names the Example its view is at, and nothing at any other place", () => {
  for (const mode of bundle.modes) {
    for (const [number, { shown }] of offeredExamples(mode, encode).entries()) {
      const view = parse(exampleQuery(mode, shown, { palette: "twilight_shifted", encode }), CONTEXT);
      assert.equal(exampleAt(mode, view, encode), number + 1, `${mode.name} ${number + 1}`);
    }
  }
  const frost = modes.get("frost-feather");
  const view = parse(exampleQuery(frost, frost.shown[0], { palette: "twilight_shifted", encode }), CONTEXT);
  assert.equal(view.family, "phoenix");
  const moved = { ...view, x: { text: "0.1", value: 0.1 } };
  assert.equal(exampleAt(frost, moved, encode), null);
  // Another family at the same viewport is another place.
  assert.equal(exampleAt(frost, { ...view, family: "mandelbrot" }, encode), null);
});

test("a palette of the set is in the link as `tuned`, the default never, and reads back", () => {
  const view = parse("v=4&custom=glass-whorl&p=twilight_shifted", CONTEXT);
  assert.equal(view.custom.palette, null);
  const on = { ...view, custom: { ...view.custom, palette: "Lilac Vellum" } };
  const query = emit(on, CONTEXT);
  assert.equal(query, "v=4&custom=glass-whorl&tuned=Lilac%20Vellum&p=twilight_shifted");
  assert.equal(parse(query, CONTEXT).custom.palette, "Lilac Vellum");
  assert.equal(canonicalize(query, CONTEXT), query);
  // Naming the mode's own map is the default, and is not written back.
  assert.equal(emit(parse("v=4&custom=glass-whorl&tuned=yas", CONTEXT), CONTEXT), "v=4&custom=glass-whorl&p=twilight_shifted");
  for (const refused of ["v=4&custom=glass-whorl&tuned=Blues", "v=4&tuned=magma", "v=4&custom=lacquer-lobes&tuned=magma"]) {
    assert.throws(() => parse(refused, CONTEXT), PermalinkError, refused);
  }
});

test("a palette of the set draws its own map with Matched palette, and the view's without", () => {
  const mode = modes.get("brass-foam");
  const view = parse("v=4&custom=brass-foam&tuned=magma", CONTEXT);
  const request = requestOf({ bundle, mode, custom: view.custom, view, maxiter: 500, width: 8, height: 5 });
  assert.deepEqual(request.colormap, bundle.colormaps.magma);
  const off = parse("v=4&custom=brass-foam&tuned=magma&matched=0&p=Blues", CONTEXT);
  const baked = { kind: "sequential", stops: [[0, [0, 0, 0]], [1, [255, 255, 255]]] };
  const plain = requestOf({ bundle, mode, custom: off.custom, view: off, maxiter: 500, stopsOf: () => baked, width: 8, height: 5 });
  assert.equal(plain.colormap.name, "Blues");
});

test("a palette switch keeps the place a recolour holds; a pan, a size or another mode does not", () => {
  const mode = modes.get("brass-foam");
  const at = (query, width = 8, other = mode) => {
    const view = parse(query, CONTEXT);
    return placeOf(requestOf({ bundle, mode: other, custom: view.custom, view, maxiter: 500, width, height: 5 }));
  };
  const here = at("v=4&custom=brass-foam");
  assert.equal(at("v=4&custom=brass-foam&tuned=magma"), here);
  assert.equal(at("v=4&custom=brass-foam&autotone=0"), here, "the module refuses what its frame cannot serve");
  assert.notEqual(at("v=4&custom=brass-foam&x=0.25"), here);
  assert.notEqual(at("v=4&custom=brass-foam", 16), here);
  assert.notEqual(at("v=4&custom=brass-foam", 8, modes.get("silk-waves")), here);
});

test("a palette's tuned values are written over the stack whole, tone pass and all", () => {
  const base = { layers: [{ color: { rgb: "#000000" }, opacity: 1 }, { opacity: 0.5 }], tone: { median: 0.2 } };
  const mode = {
    name: "test",
    palette: "a",
    stack: base,
    knobs: [],
    palettes: [
      { colormap: "a", values: {} },
      { colormap: "b", values: { "/layers/0/color": { rgb: "#5a7cff" }, "/layers/1/opacity": 0.0, "/tone/median": 0.3 } },
    ],
  };
  const custom = { ...freshCustom("test"), palette: "b" };
  const tuned = { layers: [{ color: { rgb: "#5a7cff" }, opacity: 1 }, { opacity: 0.0 }], tone: { median: 0.3 } };
  assert.deepEqual(stackOf(mode, custom), tuned);
  assert.deepEqual(base.layers[0].color, { rgb: "#000000" }, "the bundle's stack is not written");
  assert.equal(stackOf(mode, freshCustom("test")), base, "the default is the stack itself");
  assert.deepEqual(stackOf(mode, { ...custom, autotone: false }), { layers: tuned.layers });
  assert.deepEqual(withValues(base, { "/layers/9/opacity": 0.0 }), base, "a pointer naming nothing writes nothing");
});

test("an old name of a style merged into a mode opens that mode, on the palette that was it", () => {
  const merged = structuredClone(bundle);
  const mode = merged.modes.find((each) => each.name === "glass-whorl");
  mode.aliases = ["old_whorl", { name: "older-whorl", colormap: "magma" }, "plain_whorl"];
  mode.palettes.find((entry) => entry.colormap === "Copper Fathom").was = "old_whorl";
  const context = { ...CONTEXT, customs: contractOf(merged) };
  assert.deepEqual(aliasesOf(merged).get("old_whorl"), { name: "glass-whorl", palette: "Copper Fathom" });
  const view = parse("v=4&custom=old_whorl", context);
  assert.equal(view.custom.name, "glass-whorl");
  assert.equal(view.custom.palette, "Copper Fathom");
  assert.equal(emit(view, context), "v=4&custom=glass-whorl&tuned=Copper%20Fathom&p=twilight_shifted");
  assert.equal(parse("v=4&custom=older-whorl", context).custom.palette, "magma");
  assert.equal(parse("v=4&custom=plain_whorl", context).custom.palette, null, "no entry kept: the default");
  // A link's own `tuned` outranks the alias's palette.
  assert.equal(parse("v=4&custom=old_whorl&tuned=hsv", context).custom.palette, "hsv");
  // The bundle as baked (wallpapers 083's `style bundle`) names fourteen: the styles merged
  // into satin-spiral, smooth-bands, glass-beads and feather-plumes.
  const baked = aliasesOf(bundle);
  assert.equal(baked.size, 14);
  assert.deepEqual(baked.get("lilac_kaleidoscope"), { name: "feather-plumes", palette: "lilac_plumes" });
  assert.deepEqual(baked.get("copper_mail"), { name: "glass-beads", palette: "copper_mail" });
  assert.deepEqual(baked.get("violet_star_arms"), { name: "satin-spiral", palette: null }, "the mode's own map");
  assert.equal(parse("v=4&custom=lilac_kaleidoscope", CONTEXT).custom.name, "feather-plumes");
});
