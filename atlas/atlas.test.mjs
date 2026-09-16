// The atlas's link contract, held to the record.
//
//   node --test atlas/atlas.test.mjs
//
// Two guards run through all of it, and they are the two things most likely to break
// silently years from now.
//
// **One function builds every link.** `links.js`'s `opened` is called by the page and by
// this test, and by nothing else, so there is no second spelling to drift. A link that is
// *nearly* the picture beside it is the one failure this page exists to refuse: the
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
import { contractOf, opened, refusals } from "./links.js";

const HERE = new URL("./", import.meta.url);
const IMAGES = new URL("../assets/images/atlas/", import.meta.url);

const engine = new WebAssembly.Instance(
  new WebAssembly.Module(readFileSync(fileURLToPath(new URL("../explorer/engine.wasm", HERE)))),
  {},
).exports;

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
    Object.entries(dot.slots).map(([name, slot]) => ({ where: `${dot.id}/${name}`, slot })),
  ),
);

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

// ------------------------------------------------------- the rest of the contract

test("a link built from a slot draws that slot's own frame, verbatim", () => {
  for (const { where, slot } of everySlot) {
    const { view } = opened(CONTRACT, slot);
    const spec = specOf(view, 320, 180);
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
  // Fifty-three of these slots are a Julia set drawn whole, which *is* the family's home
  // view, and the canonical spelling of a home view omits `x`, `y` and `w`. So the claim
  // is not that a link always names its frame — it is that a link which does not name one
  // means the frame the record gives, which is the property the page depends on.
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
          "caption is warning about a link that works",
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

test("every picture the record names is on disk", () => {
  for (const partition of partitions) {
    assert.ok(
      existsSync(fileURLToPath(new URL(partition.plate.file, IMAGES))),
      `${partition.partition}: the plate names ${partition.plate.file}, which is not there`,
    );
  }
  for (const { where, slot } of everySlot) {
    assert.ok(
      existsSync(fileURLToPath(new URL(slot.file, IMAGES))),
      `${where}: names ${slot.file}, which is not there`,
    );
  }
});

test("the plate a partition is drawn over opens in the explorer too", () => {
  for (const partition of partitions) {
    const plate = partition.plate;
    const { query } = opened(CONTRACT, {
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
