// The atlas's link contract, held to the record.
//
//   node --test atlas/atlas.test.mjs
//
// One claim runs through all of it, and it is the claim most likely to break silently
// years from now: **a permalink built from a row reproduces the picture that row stands
// for.** It holds today because the search's node views are drawn palette-free through
// `twilight_shifted`, and because that is the map `explorer/palettes.js` names as
// `DEFAULT_PALETTE`. Neither of those is written down anywhere the other can see. A
// rebake next year that moved the default, or a maker that changed what a node view is
// drawn at, would leave every dot on the page opening at a picture a shade off the one
// beside it — and nothing would go red, because both halves would still be internally
// consistent. So it is pinned here, by name, with the reason attached.
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
import { contractOf, modeFor, opened, paletteFor, OFFERED } from "./links.js";

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
  .map((row) => ({ ...row, rows: rowsOf(row.file) }));

const CONSTANT_KEYS = ["cx", "cy", "px", "py", "zx", "zy"];

function dotsOf(partition) {
  return partition.rows
    .filter((row) => row.kind === "dot")
    .map((row) => {
      const viewport = { x: row.x, y: row.y, w: row.w };
      for (const key of CONSTANT_KEYS) if (row[key] !== undefined) viewport[key] = row[key];
      return { key: row.location_key, family: row.family, viewport, judged: row.judged ?? null };
    });
}

const RECORD = { nodeView: method.node_view };
const everyDot = partitions.flatMap((partition) => dotsOf(partition));

// --------------------------------------------------------------- the pin

test("the node view is drawn through the map the explorer opens at", () => {
  assert.equal(
    method.node_view.palette,
    DEFAULT_PALETTE,
    "A dot's link carries the palette the picture beside it was drawn in, and for an " +
      "unjudged dot that picture is the search's own node view. The two agree only " +
      "because the node views are drawn through the same map the explorer defaults to. " +
      "If this has failed, one of the two moved: either the maker changed what a node " +
      "view is drawn at, or a rebake changed DEFAULT_PALETTE. Neither is wrong on its " +
      "own; what is wrong is that they no longer say the same thing.",
  );
});

test("the node view's mode is one the contract will accept", () => {
  assert.ok(
    link.MODES.includes(method.node_view.mode),
    `the record's node view is drawn in ${method.node_view.mode}, which is not a mode a link may name`,
  );
});

test("a link built from a row draws that row's own frame, verbatim", () => {
  for (const dot of everyDot) {
    const { view } = opened(CONTRACT, {
      family: dot.family,
      viewport: dot.viewport,
      palette: RECORD.nodeView.palette,
      mode: RECORD.nodeView.mode,
    });
    const spec = specOf(view, method.node_view.width, method.node_view.height);
    assert.equal(spec.viewport.center_re, dot.viewport.x, `${dot.key}: x was rewritten`);
    assert.equal(spec.viewport.center_im, dot.viewport.y, `${dot.key}: y was rewritten`);
    assert.equal(spec.viewport.width, dot.viewport.w, `${dot.key}: w was rewritten`);
    assert.equal(spec.mode, method.node_view.mode, `${dot.key}: the mode moved`);
    assert.deepEqual(spec.palette, link.defaultShade(), `${dot.key}: the shade recipe moved`);
    assert.deepEqual(
      spec.colormap,
      colormapOf(DEFAULT_PALETTE),
      `${dot.key}: the map the picture is drawn through is not the explorer's default`,
    );
  }
});

/** The map as the engine's control points, the way `render.js` hands one over. */
function colormapOf(name) {
  const map = PALETTES.get(name);
  return {
    kind: map.cyclic ? "cyclic" : "sequential",
    stops: map.positions.map((at, index) => [
      at,
      [map.colors[index * 3], map.colors[index * 3 + 1], map.colors[index * 3 + 2]],
    ]),
  };
}

// ------------------------------------------------------- the rest of the contract

test("every row's link is the canonical spelling of its own view", () => {
  for (const dot of everyDot) {
    for (const wanted of ["fixed", "random"]) {
      const { query } = opened(CONTRACT, {
        family: dot.family,
        viewport: dot.viewport,
        palette: paletteFor(RECORD, dot, wanted),
        mode: modeFor(RECORD, dot),
      });
      assert.equal(
        link.canonicalize(query, CONTRACT),
        query,
        `${dot.key}: the contract does not settle on this view`,
      );
    }
  }
});

test("a row's link always names its frame, so the atlas never inherits a home view", () => {
  for (const dot of everyDot) {
    const { query } = opened(CONTRACT, {
      family: dot.family,
      viewport: dot.viewport,
      palette: RECORD.nodeView.palette,
      mode: RECORD.nodeView.mode,
    });
    const keys = new URLSearchParams(query);
    for (const key of ["x", "y", "w", "p"]) {
      assert.ok(keys.has(key), `${dot.key}: the link leaves ${key} to the page's own default`);
    }
  }
});

test("an unjudged dot's palette is the same one every time it is asked for", () => {
  for (const dot of everyDot.filter((entry) => entry.judged === null).slice(0, 40)) {
    const once = paletteFor(RECORD, dot, "random");
    assert.equal(paletteFor(RECORD, dot, "random"), once, `${dot.key}: its colour is not stable`);
    assert.ok(OFFERED.includes(once), `${dot.key}: ${once} is not a map the picker offers`);
  }
});

test("a judged dot wears the map its render was scored in", () => {
  for (const dot of everyDot.filter((entry) => entry.judged !== null)) {
    for (const wanted of ["fixed", "random"]) {
      assert.equal(
        paletteFor(RECORD, dot, wanted),
        dot.judged.palette,
        `${dot.key}: the page would relabel a render that already exists`,
      );
    }
  }
});

test("every pre-rendered thumbnail the record names is on disk", () => {
  for (const dot of everyDot) {
    const thumb = dot.judged?.thumb;
    if (!thumb) continue;
    assert.ok(
      existsSync(fileURLToPath(new URL(thumb.file, IMAGES))),
      `${dot.key}: names ${thumb.file}, which is not there`,
    );
  }
});

test("the plane a partition is drawn over opens in the explorer too", () => {
  for (const partition of partitions) {
    const { query } = opened(CONTRACT, {
      family: partition.plane.family,
      viewport: { x: partition.plane.x, y: partition.plane.y, w: partition.plane.w },
      palette: RECORD.nodeView.palette,
      mode: RECORD.nodeView.mode,
    });
    assert.equal(link.canonicalize(query, CONTRACT), query, `${partition.partition}: plane link`);
  }
});
