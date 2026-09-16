// The hue wheel: the twelve families, in order, and a colour to show each one as.
//
// Both halves come from the wallpaper project's own codebook — `palettes/codebook.py`,
// where the wheel is twelve hues at thirty-degree steps of **Oklab** hue angle, anchored
// so that `red` sits at 30, which is where sRGB's own red lands. The order is the order
// the palette library page lays its sections out in, and `builder/palettes.py` spells it
// on the Python side for the same reason this file spells it on the JavaScript one: the
// codebook is a module in a repository a clone of this one need not have, and neither a
// page here nor a record here may depend on a checkout of it.
//
// **The hexes are transcribed, not computed, and they are not a new colour language.**
// Each is that hue's `light_vivid` cell — the codebook's own lightness of 0.75 and chroma
// of 0.16, with the chroma pulled in by bisection where the cube will not hold it, which
// is what the codebook does with its own claim factor. So a chip showing `azure` is
// showing the swatch the pipeline means by azure. Converting Oklab in the browser would
// be a third copy of Ottosson's matrices — the engine has one and the project's Python
// has the other — for twelve constants on a wheel that is anchored and does not move.
//
// If the wheel ever did move, the names would move with it, and the names are checked:
// `builder check`'s `library` holds this site's palette record to the hue every map is
// filed under next door.

/** The twelve families in the wheel's order, each with its Oklab angle and its swatch. */
export const WHEEL = [
  { hue: "rose", angle: 0, color: "#fd7eaa" },
  { hue: "red", angle: 30, color: "#ff8573" },
  { hue: "orange", angle: 60, color: "#f6922e" },
  { hue: "yellow", angle: 90, color: "#d4a800" },
  { hue: "lime", angle: 120, color: "#a2bc32" },
  { hue: "green", angle: 150, color: "#55c975" },
  { hue: "teal", angle: 180, color: "#00c9b1" },
  { hue: "cyan", angle: 210, color: "#00c3db" },
  { hue: "azure", angle: 240, color: "#46b9ff" },
  { hue: "blue", angle: 270, color: "#8ea9ff" },
  { hue: "purple", angle: 300, color: "#bd96ff" },
  { hue: "magenta", angle: 330, color: "#e586de" },
];

/** The families in wheel order, which is the order anything that lists them uses. */
export const HUES = WHEEL.map((one) => one.hue);

/**
 * The colour to show a family as, or `null` for anything the wheel does not name.
 *
 * `null` is the honest answer rather than a thirteenth colour: a palette the ledger never
 * saw in a picture is filed under no hue at all, and a swatch invented for it would say
 * the pipeline had an opinion it does not have. The page draws those neutral.
 */
export function colorOf(hue) {
  return WHEEL.find((one) => one.hue === hue)?.color ?? null;
}
