// Which seat each link a friend sent is, asked of the explorer's own reader.
//
// `builder/votes.py` hands over the text a friend pasted and every seat's link; this reads
// the text the way the Saved tab's import does (`saved.js`'s `parseImport` and `queryOf`),
// parses each link with `permalink.js`, and names the seat whose recipe it is. Two links
// are the same recipe when `emit` spells them the same with `level` taken off: `level` is
// the tone curve a pass derived from the rest of the recipe, and the gallery's links gained
// it after friends had already copied some of them. `emit` is also what normalizes a
// float's spelling, so the match is exact and there is no tolerance anywhere.
//
// The context is `go.mjs`'s SHALLOW one, copied rather than shared because that script
// runs at import; a change to one is a change to both.
//
//   node builder/votes.mjs < ask.json
//   ask:    {text, seats: {key: link}, go: {name: target}}
//   answer: {links: [{link, key} | {link, reason, detail}], ignored, unreadable_seats}

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import * as link from "../explorer/permalink.js";
import { parseImport, queryOf } from "../explorer/saved.js";
import { DEFAULT_PALETTE, PALETTES } from "../explorer/palettes.js";
import { familySpecOf } from "../explorer/render.js";
import { CONSTANTS, CURVES, SETTLED } from "../explorer/catalog.js";

const WASM = fileURLToPath(new URL("../explorer/engine.wasm", import.meta.url));

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

const SHALLOW = {
  home: homeOf,
  constants: seedConstants,
  palettes: PALETTES,
  defaultPalette: DEFAULT_PALETTE,
  settled: (mode) => SETTLED[mode],
  curve: (mode) => CURVES[mode],
  cap: (width) => engine.maxiter_for_width(width),
};

/** The recipe a query names, spelled canonically with the tone curve taken off. */
function recipeOf(query) {
  const view = link.parse(`?${query}`, SHALLOW);
  return link.emit({ ...view, level: link.LEVEL_KEY.fallback }, SHALLOW);
}

// ------------------------------------------------------------------ reading the paste

/** A token that is a link rather than words around one. */
function looksLikeLink(token) {
  if (/^https?:\/\//i.test(token)) {
    return /techmatt\.github\.io|localhost|127\.0\.0\.1|\/explorer\b|\/go\//i.test(token);
  }
  return /^(\?|v=|dv=|iv=|go\/)/.test(token) || /[?&]v=\d/.test(token);
}

/** Punctuation a sentence or a chat client puts around a link, and that no link ends in. */
function trimmed(token) {
  let out = token.replace(/^[<("'[]+/, "");
  out = out.replace(/[>"',;.\]]+$/, "");
  if (token.startsWith("(") && out.endsWith(")")) out = out.slice(0, -1);
  return out;
}

/** Every link in the text, raw, and how many other words there were. */
function linksIn(text) {
  const body = String(text ?? "").trim();
  if (body.startsWith("{") || body.startsWith("[")) {
    try {
      JSON.parse(body);
      return { raws: parseImport(body).map((item) => item.link), ignored: 0 };
    } catch {
      // Not JSON after all: read it as text.
    }
  }
  const raws = [];
  let ignored = 0;
  for (const token of body.split(/\s+/)) {
    if (token === "") continue;
    const candidate = trimmed(token);
    if (looksLikeLink(candidate)) raws.push(candidate);
    else ignored += 1;
  }
  return { raws, ignored };
}

/** A `go/<name>/` short link, forwarded to its target's query; anything else as it is. */
function throughGo(raw, go) {
  const found = /(?:^|\/)go\/([a-z0-9-]+)\/?(?:index\.html)?$/i.exec(raw.split(/[?#]/)[0]);
  if (found === null) return null;
  const target = go[found[1]];
  return target === undefined ? { unknown: found[1] } : { query: queryOf(target) };
}

function read(raw, byRecipe, go) {
  let query;
  const short = throughGo(raw, go);
  if (short !== null) {
    if (short.unknown !== undefined) {
      return { link: raw, reason: "unparseable", detail: `no short link go/${short.unknown}` };
    }
    query = short.query;
  } else {
    query = queryOf(raw);
  }
  const search = `?${query}`;
  if (link.isInflected(search)) {
    return { link: raw, reason: "unparseable", detail: "a paged Inflection tab link" };
  }
  if (link.isDeep(search)) {
    return { link: raw, reason: "deep view", detail: "a Deep tab view, which no seat is" };
  }
  const keys = [...new URLSearchParams(query).keys()];
  if (keys.length > 0 && keys.every((key) => link.UI_KEYS.has(key))) {
    return { link: raw, reason: "collection link", detail: "a gallery grid, not one picture" };
  }
  let recipe;
  try {
    recipe = recipeOf(query);
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    return { link: raw, reason: "unparseable", detail: error.message };
  }
  const key = byRecipe.get(recipe);
  if (key === undefined) {
    return { link: raw, reason: "not a wallpaper", detail: "parses, and no seat draws it" };
  }
  return { link: raw, key };
}

const ask = JSON.parse(readFileSync(0, "utf8"));
const byRecipe = new Map();
const unreadable = [];
for (const [key, seatLink] of Object.entries(ask.seats)) {
  try {
    const recipe = recipeOf(seatLink);
    // Two seats one recipe would make a vote ambiguous; the record says it never happens,
    // and this is where it would be said if it ever did.
    if (byRecipe.has(recipe)) {
      unreadable.push({ key, detail: `the same recipe as seat ${byRecipe.get(recipe)}` });
    } else {
      byRecipe.set(recipe, key);
    }
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    unreadable.push({ key, detail: error.message });
  }
}
const { raws, ignored } = linksIn(ask.text);
process.stdout.write(
  JSON.stringify({
    links: raws.map((raw) => read(raw, byRecipe, ask.go ?? {})),
    ignored,
    unreadable_seats: unreadable,
  }),
);
