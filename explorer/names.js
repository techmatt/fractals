// What a reader is shown for a mode and a family, where a link spells each by its own name
// *(preclose_website_ckpt156)*.
//
// The same split the palettes make: shown by a display name, addressed by its own. A
// select's option keeps the contract's name as its value, a chip keeps it as the value it
// filters on, and a link never sees anything here. What a reader reads is these words. The
// Walk and Deep readouts are working surfaces and keep the engine's spelling.

import { WORDS } from "./catalog.js";

/** The degree words a numbered family is read with. */
const DEGREES = { 3: "Cubic", 4: "Quartic", 5: "Quintic", 6: "Sextic" };

/**
 * A mode in the words a reader has, lower case, for the middle of a sentence: `picks.py`'s
 * `MODE_WORDS`, baked into `catalog.js`. A mode the bake carries no wording for is shown by
 * its own name rather than not at all.
 */
export function modeWords(mode) {
  return WORDS.get(mode) ?? mode;
}

/** A mode as a label or the start of a sentence: its words, capitalized. */
export function modeName(mode) {
  const words = modeWords(mode);
  return words[0].toUpperCase() + words.slice(1);
}

/**
 * What a reader calls each family: `Mandelbrot`, `Cubic Multibrot`, `Quartic Julia`,
 * `Phoenix`. A rule over the contract's one shape for a family name — a word, and a degree
 * where the family is one of a numbered series — so a family the contract gains is named
 * without an edit here, and one it cannot read is shown as its own name.
 */
export function familyName(family) {
  if (family === "phoenix") return "Phoenix";
  if (family === "phoenix_plane") return "Phoenix plane";
  const parts = /^([a-z]+)(\d*)$/.exec(family);
  if (parts === null) return family;
  const word = parts[1][0].toUpperCase() + parts[1].slice(1);
  if (parts[2] === "") return word;
  const degree = DEGREES[parts[2]];
  return degree === undefined ? `${word} ${parts[2]}` : `${degree} ${word}`;
}
