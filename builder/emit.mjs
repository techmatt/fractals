// The permalink contract, asked rather than restated.
//
// `builder/links.py` works out what each figure of this site was drawn at. It does not
// work out what that view's URL is, and it must not: `explorer/permalink.js` is the only
// thing allowed an opinion about what a link means, and a second one written in Python
// would be a contract with two authors. So the derivation ends here — a JSON object of
// views in on stdin, a JSON object of canonical query strings out on stdout, through the
// contract's own `emit`.
//
// Two things are checked before a link is handed back, and both are properties the
// registry would otherwise have to be trusted for:
//
//   * **it parses**, under the same `parse` the page reads a reader's URL with, so a
//     view this repository can describe and the contract will not accept is a refusal
//     here rather than a broken link on a page;
//   * **parse then emit is a fixed point**, which is what makes the canonical string the
//     identity of a view rather than one spelling of it.
//
// The family's home views come out of the committed wasm module, by the same `plan`
// export the page asks — because whether `x`, `y` and `w` are omitted from a canonical
// string depends on what home is, and a table of home views typed here would be a third
// author. Node instantiates the module for `plan` alone: no workers, no rendering.
//
//   node builder/emit.mjs < views.json

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  canonicalize,
  coordinateOf,
  emit,
  parse,
  PermalinkError,
  settledParams,
} from "../explorer/permalink.js";
import { DEFAULT_PALETTE, PALETTES } from "../explorer/palettes.js";
import { familySpecOf } from "../explorer/render.js";
import { CONSTANTS, SETTLED } from "../explorer/catalog.js";

const WASM = fileURLToPath(new URL("../explorer/engine.wasm", import.meta.url));

/** The module, instantiated for `plan` and nothing else. */
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

const homes = new Map();

/** A family's own home view, read out of the module. */
function homeOf(family) {
  if (!homes.has(family)) {
    const answer = plan({ schema: 1, family: familySpecOf(family, seedConstants(family)) });
    if (!answer.ok) throw new Error(`${family}: ${answer.why}`);
    homes.set(family, {
      x: coordinateOf(answer.home.x),
      y: coordinateOf(answer.home.y),
      w: coordinateOf(answer.home.w),
    });
  }
  return homes.get(family);
}

function seedConstants(family) {
  const held = {};
  for (const [key, text] of Object.entries(CONSTANTS[family] ?? {})) {
    held[key] = { text, value: Number(text) };
  }
  return held;
}

const CONTEXT = {
  home: homeOf,
  constants: seedConstants,
  palettes: PALETTES,
  defaultPalette: DEFAULT_PALETTE,
  settled: (mode) => SETTLED[mode],
};

const written = (text) => ({ text, value: Number(text) });

/** One derived view as the contract's own shape. */
function viewOf(derived) {
  const constants = {};
  for (const [key, text] of Object.entries(derived.constants)) constants[key] = written(text);
  return {
    family: derived.family,
    constants,
    mode: derived.mode,
    // A record's picture was drawn at the catalog's constant wherever it names none, and
    // its link says so: under permalink v3 an absent weight or opacity is one to derive.
    params: settledParams(derived.mode, derived.params ?? {}, CONTEXT),
    x: written(derived.x),
    y: written(derived.y),
    w: written(derived.w),
    aspect: { across: 16, down: 9 },
    palette: derived.palette,
    shade: derived.shade,
    // The recorded tone curve, where the caller found one on the run that drew the
    // picture. A caller that has none says nothing, which is `null` — the contract's own
    // fallback — so a view built before this key existed emits exactly the link it did.
    level: derived.level ?? null,
  };
}

function answer(derived) {
  const view = viewOf(derived);
  const link = emit(view, CONTEXT);
  const again = canonicalize(link, CONTEXT);
  if (again !== link) {
    return { ok: false, why: `the contract does not settle on this view: ${link} became ${again}` };
  }
  parse(link, CONTEXT);
  // The cap the page will draw this link at. It is NOT a permalink key — the engine's
  // depth policy owns it, and a link carries a place rather than a budget — so a figure
  // whose record pinned a different one is a figure this link would not reproduce. The
  // caller compares, and refuses rather than landing the reader on a shallower picture.
  const answered = plan({
    schema: 1,
    family: familySpecOf(view.family, view.constants),
    viewport: { center_re: view.x.text, center_im: view.y.text, width: view.w.text },
    mode: view.mode,
    ...(Object.keys(view.params).length > 0 ? { params: view.params } : {}),
  });
  if (!answered.ok) return { ok: false, why: answered.why };
  return { ok: true, link, maxiter: answered.maxiter };
}

const wanted = JSON.parse(readFileSync(0, "utf8"));
const found = {};
for (const [id, derived] of Object.entries(wanted)) {
  try {
    found[id] = answer(derived);
  } catch (error) {
    if (!(error instanceof PermalinkError) && !(error instanceof Error)) throw error;
    found[id] = { ok: false, why: error.message };
  }
}
process.stdout.write(JSON.stringify(found));
