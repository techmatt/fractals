// The colormaps' control points, which are beside the page rather than in it.
//
// `palettes.js` is an index: for every one of the library's maps it says whether the
// picker lists it, whether it closes on the colour it opened with, where its colours
// start in `palettes.bin` and how many stops it has. This module is the blob's reader.
//
// **Why the gradients are not in the module.** A link built from a gallery seat's
// recipe has to be able to name the map that seat was drawn in, and the published
// record alone seats 451 distinct maps — so the explorer carries the whole library
// rather than the 126 it used to. Inline, the stops of 1,021 maps are about twelve
// megabytes of JavaScript source that a browser parses before it draws anything; as
// three bytes a stop they are about one megabyte of binary fetched once, beside the
// wasm, on the same boot the page already waits through.
//
// **The positions are derived and are not in the file.** Stop `i` of a map with `n` of
// them sits at exactly `i/(n-1)`, which is true of every map in the tracked library and
// is checked at bake time — `builder/explorer.py`'s `blob` refuses a map it is not true
// of rather than rounding one into the format. So a stop costs three bytes and not
// eleven, and nothing about a gradient is approximated: the colours are the library's
// own sRGB8 and the positions are the ones the library's own files spell.
//
// **Planar and byte-delta on disk, interleaved here** *(explorer_slim_ckpt131)*. A map's
// span of the blob holds its reds, then its greens, then its blues, each byte the
// difference from the one before it in that channel, mod 256. That is what lets gzip take
// the file from 897 KB on the wire to 185 KB, since a gradient's neighbouring stops are
// close and their differences are small and repeat. It is the same length as the
// interleaved form and each map occupies the same span, so the index addresses it
// unchanged; `install` undoes it once and `stopsOf` reads `r g b` as it always did.
//
// **The blob is untracked.** It is the one library-sized thing the explorer needs, and
// what is committed is the index that addresses it; `python -m builder explorer
// --palettes-only` writes it. A clone that has not baked it gets the sentence below
// rather than a page that draws nothing for no stated reason.

import { PALETTES, PROVENANCE } from "./palettes.js";

/** The blob, once it is here. */
let held = null;

/** Each map's control points in the shape the module's spec takes, built on demand. */
const BUILT = new Map();

/**
 * How many built maps are kept, the least recently asked for going first.
 *
 * **Kept without a bound, this was the screensaver's only growth** *(profiling_pass_ckpt146)*:
 * it shows a different map almost every picture, and a map of a few hundred stops is two
 * arrays and a number a stop — about 23 KB of heap a picture, 3.7 MB to 7.8 MB over twenty
 * minutes at *Fastest*, heading for the whole library's ~20 MB over a long enough run.
 * Building one is a loop over a few hundred bytes of the blob, so a pan or a download that
 * re-asks for the map on the screen still finds it here, and nothing else pays for its going.
 */
const BUILT_KEPT = 64;

/** Whether the gradients have arrived. */
export function ready() {
  return held !== null;
}

/**
 * Take the blob, having first checked it is the one this index was baked against.
 *
 * The length is the whole of the check and it is worth having: an index and a blob that
 * disagree do not fail, they draw the wrong colours — map `n`'s bytes read at map
 * `n+1`'s offset are a real gradient belonging to somebody else. A stale blob beside a
 * fresh index is exactly what a rebake nobody re-served produces. A blob in the other
 * layout is the same length, which is why `fetchStops` also holds it to the index's hash.
 */
export function install(bytes) {
  const { bytes: wanted, file, layout } = PROVENANCE.blob;
  if (layout !== LAYOUT) {
    throw new Error(`the index says ${file} is laid out ${layout}, and this reader reads ${LAYOUT}`);
  }
  if (bytes.length !== wanted) {
    throw new Error(
      `${file} is ${bytes.length} bytes and the index beside it was baked ` +
        `against ${wanted}. Rebake with \`python -m builder explorer --palettes-only\`.`,
    );
  }
  held = interleave(bytes);
  BUILT.clear();
}

/** The layout this reader undoes, as `builder/explorer.py`'s `BLOB_LAYOUT` spells it. */
const LAYOUT = "planar-delta";

/** Each map's planar deltas, back to `r g b` a stop. */
export function interleave(bytes) {
  const out = new Uint8Array(bytes.length);
  for (const { at, stops } of PALETTES.values()) {
    for (let channel = 0; channel < 3; channel += 1) {
      let value = 0;
      const from = at + channel * stops;
      for (let index = 0; index < stops; index += 1) {
        value = (value + bytes[from + index]) & 0xff;
        out[at + index * 3 + channel] = value;
      }
    }
  }
  return out;
}

/** Whether the bytes are the ones the index was baked against. Where the page has no
 *  `crypto.subtle` (plain http off localhost) the length check in `install` is all there is. */
async function matchesIndex(bytes) {
  if (!globalThis.crypto?.subtle) return true;
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  const hex = [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return hex === PROVENANCE.blob.sha256;
}

/** Fetch the blob from beside the page, and take it. */
export async function fetchStops(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `${PROVENANCE.blob.file} is not there (${response.status}). It is untracked — the ` +
        "gradients are a megabyte of binary and what is committed is the index that " +
        "addresses them — so a fresh clone bakes it with `python -m builder explorer " +
        "--palettes-only`.",
    );
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!(await matchesIndex(bytes))) {
    throw new Error(
      `${PROVENANCE.blob.file} is not the blob the index beside it was baked against. ` +
        "Rebake with `python -m builder explorer --palettes-only`.",
    );
  }
  install(bytes);
}

/**
 * One map as the engine's control points: its kind, and `[position, [r, g, b]]` a stop.
 *
 * Built once per name and kept, because a pan re-sends the same spec and a download
 * sends it again at another size. The shape is the module's `ColormapSpec` exactly —
 * the page has no filesystem, so a map crosses the boundary as its stops and is baked
 * by the engine's own `Colormap::from_stops_baked` on the other side.
 */
export function stopsOf(name) {
  const built = BUILT.get(name);
  if (built !== undefined) {
    // To the back of the queue: `Map` iterates in insertion order, so the front is the
    // least recently asked for.
    BUILT.delete(name);
    BUILT.set(name, built);
    return built;
  }
  if (held === null) {
    throw new Error(`the colormaps have not been read yet, so ${name} has no gradient`);
  }
  const map = PALETTES.get(name);
  if (map === undefined) throw new Error(`there is no colormap called ${name}`);
  const last = map.stops - 1;
  const stops = new Array(map.stops);
  for (let index = 0; index < map.stops; index += 1) {
    const at = map.at + index * 3;
    stops[index] = [index / last, [held[at], held[at + 1], held[at + 2]]];
  }
  const made = { kind: map.cyclic ? "cyclic" : "sequential", stops };
  BUILT.set(name, made);
  while (BUILT.size > BUILT_KEPT) BUILT.delete(BUILT.keys().next().value);
  return made;
}
