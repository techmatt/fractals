// A dot's link, and the one place it is made.
//
// Three things build a link out of an atlas row: the page, the offline renderer that
// draws the pre-rendered thumbnails, and the test that pins the two together. If any of
// them spelled a view its own way, the picture and the link would be two promises kept
// in step by hand — which is the failure this whole page is arranged to make impossible.
// So they all call `opened` below, and `opened` calls `explorer/permalink.js`.
//
// Emit, then parse. `emit` turns a view into the string somebody saves; `parse` turns a
// string into the view a picture is drawn from; asking for the picture through both is
// what makes them the same thing rather than two readings of one record.

import * as link from "../explorer/permalink.js";
import { CONSTANTS as ANCHORS } from "../explorer/catalog.js";
import { DEFAULT_PALETTE, PALETTES } from "../explorer/palettes.js";
import { familySpecOf } from "../explorer/render.js";

/** A decimal string as the contract holds one: the text, and the double it reads as. */
export const written = (text) => ({ text, value: Number(text) });

/** A family's shipped constants, as the decimal strings they were recorded as. */
export function seedConstants(family) {
  const held = {};
  for (const [key, text] of Object.entries(ANCHORS[family] ?? {})) held[key] = written(text);
  return held;
}

/**
 * The contract's context, over a `home` the engine answers.
 *
 * `homeRaw` takes the engine's own family spec and returns its home view as numbers —
 * `Renderer.home` on the page, a bare `plan` call anywhere else. It is asked rather than
 * tabulated because whether a link spells `x`, `y` and `w` at all depends on what home
 * is, and a table of home views written here would be a second author.
 */
export function contractOf(homeRaw) {
  const homes = new Map();
  return {
    home(family) {
      if (!homes.has(family)) {
        const raw = homeRaw(familySpecOf(family, seedConstants(family)));
        homes.set(family, {
          x: link.coordinateOf(raw.x),
          y: link.coordinateOf(raw.y),
          w: link.coordinateOf(raw.w),
        });
      }
      return homes.get(family);
    },
    constants: seedConstants,
    palettes: PALETTES,
    defaultPalette: DEFAULT_PALETTE,
  };
}

/**
 * One atlas row as a link and as the view that link means.
 *
 * `viewport` is the record's own keys and nothing else — `x`, `y`, `w`, and whatever
 * constants the family needs, each the decimal string the maker wrote. Nothing is
 * computed from a position in a list, and nothing is rounded on the way through: the
 * decimal string is the identity of a location, and a round trip through a double would
 * quietly rewrite a link that was more precise than today's renderer.
 */
export function opened(contract, { family, viewport, palette, mode }) {
  const constants = {};
  for (const key of link.CONSTANTS[family] ?? []) {
    if (viewport[key] === undefined) {
      throw new link.PermalinkError(`the record gives no ${key} for a ${family} view.`);
    }
    constants[key] = written(viewport[key]);
  }
  const query = link.emit(
    {
      version: link.VERSION,
      family,
      constants,
      mode,
      params: {},
      x: written(viewport.x),
      y: written(viewport.y),
      w: written(viewport.w),
      aspect: { ...link.DEFAULT_ASPECT },
      palette,
      shade: link.defaultShade(),
    },
    contract,
  );
  return { query, view: link.parse(query, contract) };
}

/** The maps the explorer's picker offers, which is what an unjudged place may wear. */
export const OFFERED = [...PALETTES].filter(([, map]) => map.offered).map(([name]) => name);

/**
 * The map a dot is drawn through.
 *
 * A judged dot wears the map its render was scored in — that render exists, and nothing
 * on this page may relabel it. An unjudged one wears either the map the search's own node
 * views use, which is what makes its picture and its link the same picture, or one of the
 * offered roster picked by the dot's **own key**. By the key and never by the clock: a
 * link whose colour changed every time the page opened would not be a link.
 */
export function paletteFor(record, dot, wanted) {
  if (dot.judged !== null && dot.judged !== undefined) return dot.judged.palette;
  if (wanted === "fixed") return record.nodeView.palette;
  let hash = 0;
  for (const character of dot.key) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return OFFERED[hash % OFFERED.length];
}

/** The mode a dot is drawn in: the judge's, or the one the node views were made at. */
export function modeFor(record, dot) {
  return dot.judged !== null && dot.judged !== undefined ? dot.judged.mode : record.nodeView.mode;
}
