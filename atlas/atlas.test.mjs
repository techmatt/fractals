// The atlas's link contract, held to the record.
//
//   node --test atlas/atlas.test.mjs
//
// Two guards run through all of it, and they are the two things most likely to break
// silently years from now.
//
// **One function builds every link.** `links.js`'s `opened` is called by the frame and by
// this test, and by nothing else, so there is no second spelling to drift. A link that is
// *nearly* the picture beside it is the one failure the atlas exists to refuse: the
// reader lands somewhere that does not match what they were just looking at and has no
// way to know which half is wrong.
//
// **`DEFAULT_PALETTE` is pinned by name, with its reason.** The record's canonical map is
// what the two neighborhood plates are drawn through, and it is also where a link falls
// back when the explorer does not bake the map a render was scored in. Both of those are
// true today only because the maker picked the map the explorer opens at. Neither fact is
// written down anywhere the other can see, so a rebake that moved the default would leave
// every fallback link opening in a map no picture on this page is drawn in — and nothing
// would go red, because both halves would still be internally consistent.
//
// Nothing below renders. The engine is instantiated for `plan` alone — the home views
// decide whether a link spells `x`, `y` and `w` at all — and the rest is the contract.

import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import * as link from "../explorer/permalink.js";
import { DEFAULT_PALETTE, PALETTES } from "../explorer/palettes.js";
import { specOf } from "../explorer/render.js";
import { install } from "../explorer/stops.js";
import { contractOf, opened, refusals } from "./links.js";

const HERE = new URL("./", import.meta.url);
const IMAGES = new URL("../assets/images/atlas/", import.meta.url);

const engine = new WebAssembly.Instance(
  new WebAssembly.Module(readFileSync(fileURLToPath(new URL("../explorer/engine.wasm", HERE)))),
  {},
).exports;

// The gradients live in `explorer/palettes.bin`, which is untracked — a megabyte of
// control points, where what is committed is the index that addresses them. A clone that
// has not baked it, which is every CI run, still holds the frame claim below; it just
// asks for the spec without a colormap in it. The flag says which happened rather than
// leaving a weaker test looking like the same test.
const BLOB = fileURLToPath(new URL("../explorer/palettes.bin", HERE));
const gradients = existsSync(BLOB);
if (gradients) install(new Uint8Array(readFileSync(BLOB)));

function plan(spec) {
  const raw = new TextEncoder().encode(JSON.stringify(spec));
  const pointer = engine.alloc(raw.length);
  new Uint8Array(engine.memory.buffer, pointer, raw.length).set(raw);
  const out = engine.plan(pointer, raw.length);
  engine.dealloc(pointer, raw.length);
  const size = new DataView(engine.memory.buffer).getUint32(out, true);
  const body = new TextDecoder().decode(new Uint8Array(engine.memory.buffer, out + 4, size));
  engine.dealloc(out, size + 4);
  return JSON.parse(body);
}

const CONTRACT = contractOf((familySpec) => {
  const answer = plan({ schema: 1, family: familySpec });
  if (!answer.ok) throw new Error(answer.why);
  return answer.home;
});

/** The record, read off disk. `record.js` fetches; a test has no server to fetch from. */
function rowsOf(name) {
  return readFileSync(fileURLToPath(new URL(name, HERE)), "utf8")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line));
}

const index = rowsOf("atlas.jsonl");
const method = index.find((row) => row.kind === "method");
const partitions = index
  .filter((row) => row.kind === "partition")
  .map((row) => ({ ...row, dots: rowsOf(row.file).filter((entry) => entry.kind === "dot") }));

/** Every slot on the site, with the dot it belongs to, for the loops below. */
const everySlot = partitions.flatMap((partition) =>
  partition.dots.flatMap((dot) =>
    Object.entries(dot.slots).map(([name, slot]) => ({
      where: `${partition.partition}/${dot.id}/${name}`,
      slot,
      dot,
      partition,
    })),
  ),
);

/** A staged plane's slot pictures are untracked, so a clone has the record and none of the
 *  files. One of them present means the ingest ran here, and then all of them are held. */
const unlanded = (partition) =>
  partition.pictures === "staged" &&
  !partition.dots.some((dot) =>
    Object.values(dot.slots).some((slot) => existsSync(fileURLToPath(new URL(slot.file, IMAGES)))),
  );

/** The three pictures a dot carries, in the order `frame.js` lays them out. */
const SLOTS = ["mandelbrot", "julia", "gallery"];

/** Which plane a family belongs to, which is what the gallery slot's border says. */
const PLANE_OF_FAMILY = {
  mandelbrot: "mandelbrot",
  multibrot3: "mandelbrot",
  multibrot4: "mandelbrot",
  multibrot5: "mandelbrot",
  multibrot6: "mandelbrot",
  julia: "julia",
  julia3: "julia",
  julia4: "julia",
  julia5: "julia",
  julia6: "julia",
  phoenix: "julia",
};

// --------------------------------------------------------------- the pin

test("the map this atlas is drawn through is the map the explorer opens at", () => {
  assert.equal(
    method.canonical_map,
    DEFAULT_PALETTE,
    "The two neighborhood plates under every mark are drawn through the record's " +
      "canonical map, and a render whose own map the explorer does not bake opens at the " +
      "explorer's default. Those are the same map today, which is what lets the page say " +
      "'it opens in <default>' and have that mean something a reader has already seen. " +
      "If this has failed, one of the two moved: either the maker changed what a plate is " +
      "drawn at, or a rebake changed DEFAULT_PALETTE. Neither is wrong on its own; what " +
      "is wrong is that they no longer say the same thing.",
  );
});

test("the canonical map is one the explorer actually bakes", () => {
  assert.ok(
    PALETTES.has(method.canonical_map),
    `the record draws its plates through ${method.canonical_map}, which is not baked`,
  );
});

// --------------------------------------------------- the three slots, as the page reads them

test("every dot carries the three pictures the page lays out, in that order", () => {
  // `frame.js` reads `dot.slots[name]` by name and has its own list of the three; a record
  // that dropped one would leave an empty box in the frame with nothing saying why, and one
  // that renamed a slot would leave three.
  for (const partition of partitions) {
    for (const dot of partition.dots) {
      assert.deepEqual(Object.keys(dot.slots), SLOTS, `dot ${dot.id}: the slots the record gives`);
    }
  }
});

test("the gallery slot's kind is the kind of place its own family belongs to", () => {
  // The page paints that border deep blue or deep red, and a reader takes it as the claim
  // that this wallpaper was drawn at a place of that kind. It is written at ingest off the
  // recipe's family rather than copied from the dot, so the two can be compared.
  for (const partition of partitions) {
    for (const dot of partition.dots) {
      const gallery = dot.slots.gallery;
      assert.equal(
        gallery.plane,
        PLANE_OF_FAMILY[gallery.family],
        `dot ${dot.id}: the gallery says ${gallery.plane} and is drawn on ${gallery.family}`,
      );
      assert.equal(gallery.plane, dot.plane, `dot ${dot.id}: the gallery is not this dot's kind`);
    }
  }
});

// ---------------------------------------------------------- the gallery's tone curve

const TONES = ["clean", "curved", "lost"];
const LOST_LEVEL = "autolevel band_autolevel/v1";

test("a gallery slot's tone, level and refusal tell one story", () => {
  // `curved` is the one tone with a curve to replay, and `lost` the one whose link has to
  // say it opens unlevelled; the record spells each of those twice and the two must agree.
  for (const partition of partitions) {
    for (const dot of partition.dots) {
      const gallery = dot.slots.gallery;
      assert.ok(TONES.includes(gallery.tone), `dot ${dot.id}: tone ${gallery.tone}`);
      assert.equal(
        gallery.level !== null,
        gallery.tone === "curved",
        `dot ${dot.id}: tone ${gallery.tone} with level ${gallery.level}`,
      );
      assert.equal(
        gallery.refused.includes(LOST_LEVEL),
        gallery.tone === "lost",
        `dot ${dot.id}: tone ${gallery.tone} and refused ${gallery.refused.join("; ")}`,
      );
      for (const name of ["mandelbrot", "julia"]) {
        assert.equal(dot.slots[name].level, undefined, `dot ${dot.id}/${name}: carries a level`);
      }
    }
  }
});

test("a curved gallery picture opens levelled, and nothing else does", () => {
  for (const { where, slot } of everySlot) {
    const { query, view, palette } = opened(CONTRACT, slot);
    const carried = new URLSearchParams(query).get(link.LEVEL_KEY.key);
    if (slot.level == null || palette !== slot.colormap) {
      assert.equal(carried, null, `${where}: the link levels a picture the record did not`);
      continue;
    }
    assert.ok(
      link.LEVEL_KEY.same(view.level, link.LEVEL_KEY.read(slot.level)),
      `${where}: the link opens at a curve that is not the one the record gives`,
    );
  }
});

// ------------------------------------------------------- the rest of the contract

test("a link built from a slot draws that slot's own frame, verbatim", () => {
  for (const { where, slot } of everySlot) {
    const { view } = opened(CONTRACT, slot);
    const spec = specOf(view, 320, 180, { colormap: gradients });
    assert.equal(spec.viewport.center_re, slot.x, `${where}: x was rewritten`);
    assert.equal(spec.viewport.center_im, slot.y, `${where}: y was rewritten`);
    assert.equal(spec.viewport.width, slot.w, `${where}: w was rewritten`);
    assert.equal(spec.mode, slot.mode, `${where}: the mode moved`);
  }
});

test("every slot's link is the canonical spelling of its own view", () => {
  for (const { where, slot } of everySlot) {
    const { query } = opened(CONTRACT, slot);
    assert.equal(
      link.canonicalize(query, CONTRACT),
      query,
      `${where}: the contract does not settle on this view`,
    );
  }
});

test("a link leaves a coordinate out only where the record's own frame is home", () => {
  // Every parameter-plane dot's Julia slot is that set drawn whole, which *is* the
  // family's home view, and the canonical spelling of a home view omits `x`, `y` and `w`.
  // So the claim is not that a link always names its frame — it is that a link which does
  // not name one means the frame the record gives, which is the property the page depends
  // on.
  for (const { where, slot } of everySlot) {
    const keys = new URLSearchParams(opened(CONTRACT, slot).query);
    assert.ok(keys.has("p"), `${where}: the link leaves the map to the page's own default`);
    const home = CONTRACT.home(slot.family);
    for (const key of ["x", "y", "w"]) {
      assert.equal(
        keys.get(key) ?? home[key].text,
        slot[key],
        `${where}: the link opens at a ${key} the record did not give`,
      );
    }
  }
});

test("a dynamical slot's link carries the constants that make it that set", () => {
  for (const { where, slot } of everySlot) {
    for (const key of link.CONSTANTS[slot.family] ?? []) {
      assert.equal(
        new URLSearchParams(opened(CONTRACT, slot).query).get(key),
        slot[key],
        `${where}: ${key} is not the one the record gives`,
      );
    }
  }
});

test("the refusals the record claims are the ones the explorer's roster makes", () => {
  for (const { where, slot } of everySlot) {
    for (const said of refusals(slot)) {
      assert.ok(
        slot.refused.includes(said),
        `${where}: the roster refuses "${said}" and the record does not say so — a reader ` +
          "would be told the link is the picture when it is not",
      );
    }
    for (const said of slot.refused) {
      if (!said.startsWith("colormap ") && said !== "mirror on a cyclic map") continue;
      assert.ok(
        refusals(slot).includes(said),
        `${where}: the record claims "${said}" and the roster no longer refuses it — the ` +
          "tooltip is warning about a link that works",
      );
    }
  }
});

test("a link falls back to the default only where the record says it does", () => {
  for (const { where, slot } of everySlot) {
    const { palette } = opened(CONTRACT, slot);
    const fell = palette !== slot.colormap;
    assert.equal(
      fell,
      slot.refused.some((said) => said === `colormap ${slot.colormap}`),
      `${where}: the link ${fell ? "falls back" : "does not fall back"} and the record ` +
        "says otherwise",
    );
    if (fell) assert.equal(palette, DEFAULT_PALETTE, `${where}: it fell back to ${palette}`);
  }
});

test("every picture the record names is on disk", (t) => {
  for (const partition of partitions) {
    assert.ok(
      existsSync(fileURLToPath(new URL(partition.plate.file, IMAGES))),
      `${partition.partition}: the plate names ${partition.plate.file}, which is not there`,
    );
  }
  const skipped = partitions.filter(unlanded).map((partition) => partition.partition);
  for (const { where, slot, partition } of everySlot) {
    if (skipped.includes(partition.partition)) continue;
    assert.ok(
      existsSync(fileURLToPath(new URL(slot.file, IMAGES))),
      `${where}: names ${slot.file}, which is not there`,
    );
  }
  if (skipped.length > 0) {
    t.skip(`slot pictures of the staged ${skipped.join(", ")} not landed on this machine`);
  }
});

test("no two planes name one picture, because one directory holds them all", () => {
  const seen = new Map();
  for (const partition of partitions) {
    const names = [partition.plate.file, ...partition.dots.flatMap((dot) =>
      Object.values(dot.slots).map((slot) => slot.file))];
    for (const name of names) {
      const owner = seen.get(name);
      assert.ok(owner === undefined || owner === partition.partition,
        `${name} is named by both ${owner} and ${partition.partition}`);
      seen.set(name, partition.partition);
    }
  }
});

test("every plane says the words its two location slots and its Julia marks wear", () => {
  for (const partition of partitions) {
    for (const name of ["mandelbrot", "julia"]) {
      assert.equal(typeof partition.slot_labels?.[name], "string", `${partition.partition}: ${name}`);
      assert.ok(partition.slot_labels[name].length > 0, `${partition.partition}: ${name} label`);
    }
    assert.ok(partition.julia_place, `${partition.partition}: no julia_place`);
    assert.ok(["tracked", "staged"].includes(partition.pictures), `${partition.partition}: pictures`);
  }
});

test("every view on a pinned plane is drawn at that plane's own slice", () => {
  for (const { where, slot, partition } of everySlot) {
    const pinned = partition.plate.constants;
    if (pinned === undefined || slot.family !== partition.plate.family) continue;
    for (const [key, text] of Object.entries(pinned)) {
      assert.equal(Number(slot[key]), Number(text), `${where}: ${key} is off the plate's slice`);
    }
  }
});

test("the plate a partition is drawn over opens in the explorer too", () => {
  for (const partition of partitions) {
    const plate = partition.plate;
    // A plane with constants — the Phoenix slice — records them beside its view, keyed as
    // the permalink keys them, so a plate opens at the same slice it was drawn from.
    const { query } = opened(CONTRACT, {
      ...(plate.constants ?? {}),
      family: plate.family,
      x: plate.x,
      y: plate.y,
      w: plate.w,
      mode: plate.mode,
      colormap: method.canonical_map,
      refused: [],
    });
    assert.equal(link.canonicalize(query, CONTRACT), query, `${partition.partition}: plate link`);
  }
});
