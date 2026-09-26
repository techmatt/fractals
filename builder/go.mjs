// Whether a short link's target is a link the explorer will open, asked of the explorer.
//
// `go/redirects.jsonl` names a view by the query string the explorer reads, and
// `builder/go.py` writes a page that forwards to it. Whether that query means anything is
// not Python's to say: it is read here by the reader the page itself would hand it to —
// `deep-link.js` where the query carries the deep marker, `permalink.js` where it does not,
// the same fork `explorer.js` takes at the door — with the family homes and the width's cap
// out of the committed wasm module, exactly as `emit.mjs` builds its context.
//
// Each answer also carries the query's canonical spelling, because where it differs from
// the target the explorer rewrites the address bar on arrival, and that is worth knowing
// even though it is not a refusal.
//
//   node builder/go.mjs < queries.json      ({name: query} in, {name: answer} out)

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import * as link from "../explorer/permalink.js";
import * as deepLink from "../explorer/deep-link.js";
import { DEFAULT_PALETTE, PALETTES } from "../explorer/palettes.js";
import { familySpecOf } from "../explorer/render.js";
import { CONSTANTS, SETTLED } from "../explorer/catalog.js";

const WASM = fileURLToPath(new URL("../explorer/engine.wasm", import.meta.url));

/** The module, instantiated for `plan` and the width policy and nothing else. */
const engine = new WebAssembly.Instance(
  new WebAssembly.Module(readFileSync(WASM)),
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

function seedConstants(family) {
  const held = {};
  for (const [key, text] of Object.entries(CONSTANTS[family] ?? {})) {
    held[key] = { text, value: Number(text) };
  }
  return held;
}

const homes = new Map();

function homeOf(family) {
  if (!homes.has(family)) {
    const answer = plan({ schema: 1, family: familySpecOf(family, seedConstants(family)) });
    if (!answer.ok) throw new Error(`${family}: ${answer.why}`);
    homes.set(family, {
      x: link.coordinateOf(answer.home.x),
      y: link.coordinateOf(answer.home.y),
      w: link.coordinateOf(answer.home.w),
    });
  }
  return homes.get(family);
}

const cap = (width) => engine.maxiter_for_width(width);

const SHALLOW = {
  home: homeOf,
  constants: seedConstants,
  palettes: PALETTES,
  defaultPalette: DEFAULT_PALETTE,
  settled: (mode) => SETTLED[mode],
  cap,
};

// The page's own deep context before the kernel is up: the home out of `engine.wasm`, and
// the engine's cap, which agrees with the kernel's everywhere the engine answers.
const DEEP = {
  palettes: PALETTES,
  defaultPalette: DEFAULT_PALETTE,
  deepHome: (family = "mandelbrot") => {
    const home = homeOf(family);
    return { x: home.x.text, y: home.y.text, w: home.w.text };
  },
  deepCap: cap,
};

function answer(query) {
  const search = `?${query}`;
  if (link.isInflected(search)) {
    return { ok: false, why: "the link is the paged Inflection tab's, which the explorer refuses" };
  }
  const deep = link.isDeep(search);
  const reader = deep ? deepLink : link;
  const context = deep ? DEEP : SHALLOW;
  reader.parse(search, context);
  return { ok: true, deep, canonical: reader.canonicalize(search, context) };
}

const wanted = JSON.parse(readFileSync(0, "utf8"));
const found = {};
for (const [name, query] of Object.entries(wanted)) {
  try {
    found[name] = answer(query);
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    found[name] = { ok: false, why: error.message };
  }
}
process.stdout.write(JSON.stringify(found));
