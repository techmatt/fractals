// A slot's link, and the one place it is made.
//
// Two things build a link out of an atlas slot: the page, and the test that pins the
// page to the record. If either spelled a view its own way, the picture and the link
// would be two promises kept in step by hand — which is the failure this whole page is
// arranged to make impossible. So they both call `opened` below, and `opened` calls
// `explorer/permalink.js`.
//
// Emit, then parse. `emit` turns a view into the string somebody saves; `parse` turns a
// string into the view a picture is drawn from; asking for the picture through both is
// what makes them the same thing rather than two readings of one record.

import * as link from "../explorer/permalink.js";
import { CONSTANTS as ANCHORS, SETTLED } from "../explorer/catalog.js";
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
 * `homeRaw` takes the engine's own family spec and returns its home view as numbers. It
 * is asked rather than tabulated because whether a link spells `x`, `y` and `w` at all
 * depends on what home is, and a table of home views written here would be a second
 * author. The page instantiates the committed wasm module for `plan` and nothing else —
 * no workers, no rendering: the plane it draws is a picture that was rendered once, next
 * door, and landed.
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
    settled: (mode) => SETTLED[mode],
  };
}

/**
 * What the contract will not accept about a recipe, settled here rather than assumed.
 *
 * A picture on this page was drawn by the renderer next door, which knows maps the
 * explorer does not bake and a fold the contract refuses on a cyclic map. Neither costs
 * the link: the map falls back to the one the explorer opens at, and the fold is
 * dropped. What they cost is the claim that the link *is* the picture, so each one is
 * named and the slot's tooltip says it.
 *
 * The record's own `refused` list carries these too, plus the things a view has no shape
 * for at all — an autolevel pass whose curve the run did not record, a curve a mode's
 * catalog does not give it. The two are
 * held together by `atlas.test.mjs`: the record may not claim a refusal the roster does
 * not make, and may not stay quiet about one it does.
 */
export function refusals({ colormap, shade }) {
  const found = [];
  if (!PALETTES.has(colormap)) found.push(`colormap ${colormap}`);
  const map = PALETTES.get(PALETTES.has(colormap) ? colormap : DEFAULT_PALETTE);
  if (shade?.mirror && map.cyclic) found.push("mirror on a cyclic map");
  return found;
}

/**
 * One atlas slot as a link and as the view that link means.
 *
 * The frame is the record's own keys and nothing else — `x`, `y`, `w`, and whatever
 * constants the family needs, each the decimal string the maker wrote. Nothing is
 * computed from a position in a list, and nothing is rounded on the way through: the
 * decimal string is the identity of a location, and a round trip through a double would
 * quietly rewrite a link that was more precise than today's renderer.
 */
export function opened(contract, slot) {
  const { family, mode } = slot;
  const constants = {};
  for (const key of link.CONSTANTS[family] ?? []) {
    if (slot[key] === undefined) {
      throw new link.PermalinkError(`the record gives no ${key} for a ${family} view.`);
    }
    constants[key] = written(slot[key]);
  }
  const palette = PALETTES.has(slot.colormap) ? slot.colormap : DEFAULT_PALETTE;
  const shade = { ...link.defaultShade(), ...(slot.shade ?? {}) };
  if (shade.mirror && PALETTES.get(palette).cyclic) shade.mirror = false;
  // Whole, and not filtered down to the keys the mode spells: a key the contract does not
  // know is refused by `settledParams` rather than dropped here. Filtering is what let the
  // engine's `texture_weight` fall out of 28 links and the catalog's 0.85 take its place.
  const params = { ...(slot.mode_params ?? {}) };
  // A curved gallery picture opens levelled: the record carries the curve its run recorded,
  // spelled as the contract's own `level` value, and it is read through the contract rather
  // than taken apart here. The curve was measured through the picture's own map, so a link
  // that fell back to the default map drops it rather than bending a map it never saw.
  const level =
    slot.level == null || palette !== slot.colormap ? null : link.LEVEL_KEY.read(slot.level);
  const query = link.emit(
    {
      version: link.VERSION,
      family,
      constants,
      mode,
      // The mark's picture was drawn at the catalog's constant wherever the slot names
      // none, and under permalink v3 an absent weight or opacity is one to derive.
      params: link.settledParams(mode, params, contract),
      x: written(slot.x),
      y: written(slot.y),
      w: written(slot.w),
      aspect: { ...link.DEFAULT_ASPECT },
      palette,
      shade,
      level,
    },
    contract,
  );
  return { query, palette, view: link.parse(query, contract) };
}
