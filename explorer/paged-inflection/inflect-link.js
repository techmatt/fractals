// **PAGED** — this file is out of the explorer's working set and nothing the page
// loads imports it. `README.md` beside it says why, what was learned, and how to put
// the tab back. Do not wire it in again without Matt asking for it.
//
// The Inflection tab's link contract — its own, beside the other two and inside neither.
//
// **Why a third contract rather than two keys added to the first.** An inflected picture
// is not a shallow view with a list bolted on: it is a different *kind* of picture. It
// names one family because the pre-map is defined here for one, it carries an ordered
// list whose order is the picture, and — the reason that settles it — the standing rule
// on this tab is that **nothing inflected enters the pipeline, a gallery, a record, or
// any shallow tab's keys or links**. A key on `permalink.js` would be a key
// `builder/links.py` could derive, a gallery seat could carry and a figure row could
// cite; a marker of its own cannot be reached by any of them. So the shallow contract
// does not move at all — `VERSION`, `READS`, the key sweep and every ruling are exactly
// where they were — and this is a trial that can be deleted by deleting three files.
//
// **The marker is `iv`, and it is what dispatches.** `permalink.js` owns the one-line
// question for the reason it owns `dv`: the page sorts a query before it loads a reader.
//
// **What is shared is shared rather than copied**: the seven shade keys, the `level`
// operator, the mode roster, each mode's parameters and what they may be, the two
// encoders and the coordinate limit all come from `permalink.js` by import. None of them
// has anything to do with inflection, and a second spelling of any of them is how two
// readers of one thing drift apart.
//
// ```
// iv · cx · cy · q · x · y · w · a · m · the mode's parameters · p · the shade keys · level
// ```
//
// `q` is the whole of what is new: the ordered points, flat, `re,im,re,im,…`, in click
// order — which is the order they are *applied in reverse*, so the list reads the way it
// was built rather than the way it is spent. The comma is `level`'s own separator and
// goes through `encodeCurve` for `level`'s own reason.
//
// Nothing here touches the DOM or the module, so `inflect-link.test.mjs` runs it under
// node's own runner with nothing installed.

import {
  COORDINATE_LIMIT,
  INFLECT_MARKER,
  LEVEL_KEY,
  MODES,
  MODE_PARAMETERS,
  NICHE_MODES,
  PARAMETERS,
  PermalinkError,
  SHADE_KEYS,
  UI_KEYS,
  defaultShade,
  encode,
  encodeCurve,
  shortest,
} from "../permalink.js";

/** Re-exported rather than declared — see the note above it in `permalink.js`. */
export const MARKER = INFLECT_MARKER;

/** The contract version this module emits, and the versions it reads. */
export const VERSION = 1;
export const READS = [1];

/** The family every inflected picture is drawn on. Not a key: there is one, and a key
 *  for it would be a key with one legal value. */
export const FAMILY = "julia";

/** The most points a link may carry, which is `inflect.rs`'s `MAX_INFLECTIONS`.
 *
 *  Stated on both sides on purpose. The module refuses past it so that a spec written by
 *  hand cannot get through; this refuses past it so that a reader who pasted a long link
 *  is told before a frame is started rather than after one is refused. */
export const MAX_POINTS = 32;

/** The key carrying the ordered points. */
const POINTS_KEY = "q";

/** The aspect a link means when it says nothing — the shallow contract's, because a
 *  canvas is a canvas. */
export const DEFAULT_ASPECT = { across: 16, down: 9 };

const ASPECT = /^(\d{1,5}):(\d{1,5})$/;
const ASPECT_LIMIT = 10000;
const DECIMAL = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

/** The keys that are this contract's own rather than a mode's, so the key sweep can tell
 *  "no such key" from "not this mode's key" — different mistakes, and a reader given the
 *  wrong one of the two looks in the wrong place. */
const KNOWN_FIXED = new Set([
  MARKER,
  "cx",
  "cy",
  POINTS_KEY,
  "x",
  "y",
  "w",
  "a",
  "m",
  "p",
  LEVEL_KEY.key,
  ...SHADE_KEYS.map((spec) => spec.key),
]);

/** Every key this contract spells, a mode's parameters included. */
const KNOWN = new Set([...KNOWN_FIXED, ...Object.values(MODE_PARAMETERS).flat()]);

function stripLeadingQuestion(search) {
  return typeof search === "string" && search.startsWith("?") ? search.slice(1) : (search ?? "");
}

function coordinate(text, key) {
  if (text === null || text === undefined) return null;
  if (text.length > COORDINATE_LIMIT) {
    throw new PermalinkError(
      `${key} is ${text.length} characters, and a coordinate is capped at ${COORDINATE_LIMIT}.`,
    );
  }
  if (!DECIMAL.test(text)) {
    throw new PermalinkError(
      `${key} has to be a decimal number, with or without an exponent; the link says ${text}.`,
    );
  }
  const value = Number(text);
  if (!Number.isFinite(value)) {
    throw new PermalinkError(`${key} is not a number this arithmetic can hold: ${text}.`);
  }
  return { text, value };
}

function readAspect(text) {
  if (text === null) return { ...DEFAULT_ASPECT };
  const found = ASPECT.exec(text);
  if (!found) {
    throw new PermalinkError(`a is the aspect, written across:down — the link says ${text}.`);
  }
  const across = Number(found[1]);
  const down = Number(found[2]);
  if (across < 1 || down < 1 || across > ASPECT_LIMIT || down > ASPECT_LIMIT) {
    throw new PermalinkError(
      `an aspect's two sides are each between 1 and ${ASPECT_LIMIT}; the link says ${text}.`,
    );
  }
  return { across, down };
}

/**
 * The ordered points, from `q`.
 *
 * **Flat and not paired, and the odd count is the refusal that matters.** A list written
 * `re,im,re,im` cannot lose a point without losing a number, so a truncated link is a
 * refusal rather than a picture with one fewer inflection in it — which would draw
 * perfectly well and be the wrong picture. Each coordinate keeps its text, because a
 * point is a place and this contract echoes a place as written for the shallow one's
 * reason.
 */
export function readPoints(text) {
  if (text === null || text === "") return [];
  const numbers = text.split(",");
  if (numbers.length % 2 !== 0) {
    throw new PermalinkError(
      `${POINTS_KEY} is the inflection points as re,im pairs, so it takes an even count of ` +
        `numbers; the link gives ${numbers.length}.`,
    );
  }
  if (numbers.length / 2 > MAX_POINTS) {
    throw new PermalinkError(
      `an inflected picture carries at most ${MAX_POINTS} points, and the link gives ` +
        `${numbers.length / 2}.`,
    );
  }
  const points = [];
  for (let at = 0; at < numbers.length; at += 2) {
    points.push({
      re: coordinate(numbers[at], `${POINTS_KEY}[${at / 2}].re`),
      im: coordinate(numbers[at + 1], `${POINTS_KEY}[${at / 2}].im`),
    });
  }
  return points;
}

/** The points back as `q`'s text. */
export function writePoints(points) {
  return points.flatMap((point) => [point.re.text, point.im.text]).join(",");
}

/**
 * Read a query into an inflected view, or throw a `PermalinkError` saying why not.
 *
 * `context.home(family)` and `context.constants(family)` are the shallow contract's own,
 * so the `c` and the frame a link that names none opens at are the page's julia anchor —
 * one answer to "where does a julia open" rather than two. `context.palettes` is the
 * baked set, which is what makes `p` checkable at all.
 */
export function parse(search, context) {
  const params = new URLSearchParams(stripLeadingQuestion(search));

  const seen = new Set();
  for (const key of params.keys()) {
    if (seen.has(key)) {
      throw new PermalinkError(`the link gives ${key} twice, and there is no rule for which wins.`);
    }
    seen.add(key);
  }

  const version = params.get(MARKER);
  if (version === null) {
    throw new PermalinkError(`the link carries no ${MARKER}, so it is not an inflected view.`);
  }
  if (!/^\d+$/.test(version) || !READS.includes(Number(version))) {
    throw new PermalinkError(
      `this page speaks inflection ${MARKER}=${VERSION} and the link says ${MARKER}=${version}.`,
    );
  }

  const mode = params.get("m") ?? MODES[0];
  if (!MODES.includes(mode)) {
    if (mode in NICHE_MODES) {
      throw new PermalinkError(`${mode} is not offered here: ${NICHE_MODES[mode]}.`);
    }
    throw new PermalinkError(`there is no mode called ${mode}.`);
  }

  const wanted = MODE_PARAMETERS[mode] ?? [];
  for (const key of seen) {
    if (UI_KEYS.has(key)) continue;
    if (!KNOWN.has(key)) {
      throw new PermalinkError(`the link carries a key this tab does not know: ${key}.`);
    }
    // A parameter this contract spells, under a mode that has no room for it. Told apart
    // from an unknown key because they are different mistakes: one is a typo and the
    // other is a link built for a different mode.
    if (!KNOWN_FIXED.has(key) && !wanted.includes(key)) {
      throw new PermalinkError(`the ${mode} mode has no ${key} parameter.`);
    }
  }

  const seeds = context.constants(FAMILY);
  const cx = coordinate(params.get("cx"), "cx") ?? seeds.cx;
  const cy = coordinate(params.get("cy"), "cy") ?? seeds.cy;

  const inflections = readPoints(params.get(POINTS_KEY));

  const home = context.home(FAMILY);
  const x = coordinate(params.get("x"), "x") ?? home.x;
  const y = coordinate(params.get("y"), "y") ?? home.y;
  const w = coordinate(params.get("w"), "w") ?? home.w;
  if (!(w.value > 0)) {
    throw new PermalinkError(
      `w is the width of the view in the plane, so it has to be positive; the link says ${w.text}.`,
    );
  }

  const aspect = readAspect(params.get("a"));

  const palette = params.get("p") ?? context.defaultPalette;
  if (!context.palettes.has(palette)) {
    throw new PermalinkError(
      `there is no palette called ${palette} among the ones this page carries.`,
    );
  }

  const values = {};
  for (const key of wanted) {
    const text = params.get(key);
    if (text === null) continue;
    if (!DECIMAL.test(text)) {
      throw new PermalinkError(`${key} has to be a number; the link says ${text}.`);
    }
    const value = Number(text);
    if (!Number.isFinite(value)) {
      throw new PermalinkError(`${key} is not a number this arithmetic can hold: ${text}.`);
    }
    if (!PARAMETERS[key].check(value)) {
      throw new PermalinkError(`${key} has to be ${PARAMETERS[key].says}; the link says ${text}.`);
    }
    values[key] = value;
  }

  const shade = defaultShade();
  for (const spec of SHADE_KEYS) {
    const text = params.get(spec.key);
    if (text !== null) shade[spec.key] = spec.read(text);
  }
  if (shade.mirror && context.palettes.get(palette).cyclic) {
    throw new PermalinkError(
      `${palette} is cyclic, so folding it would halve the cycle it was drawn to have. ` +
        "Folding is the seam fix for a map that has a seam.",
    );
  }

  const levelText = params.get(LEVEL_KEY.key);
  const level = levelText === null ? LEVEL_KEY.fallback : LEVEL_KEY.read(levelText);

  return {
    version: VERSION,
    family: FAMILY,
    constants: { cx, cy },
    inflections,
    mode,
    params: values,
    x,
    y,
    w,
    aspect,
    palette,
    shade,
    level,
  };
}

/**
 * An inflected view as its canonical query string.
 *
 * `cx`, `cy` and `q` are **never conditional**. The `c` is what the picture is of and the
 * points are what it is: a link that left either to a default would be a link whose
 * meaning moved the day the page's julia anchor did, and the shallow contract's own
 * reason for always spelling a family's constants applies here twice over.
 */
export function emit(view, context) {
  const home = context.home(FAMILY);
  const parts = [`${MARKER}=${VERSION}`];
  parts.push(`cx=${encode(view.constants.cx.text)}`);
  parts.push(`cy=${encode(view.constants.cy.text)}`);
  parts.push(`${POINTS_KEY}=${encodeCurve(writePoints(view.inflections))}`);
  if (view.mode !== MODES[0]) parts.push(`m=${encode(view.mode)}`);
  for (const key of MODE_PARAMETERS[view.mode] ?? []) {
    const value = view.params[key];
    if (value !== undefined) parts.push(`${key}=${encode(shortest(value))}`);
  }
  for (const key of ["x", "y", "w"]) {
    if (view[key].text !== home[key].text) parts.push(`${key}=${encode(view[key].text)}`);
  }
  if (view.aspect.across !== DEFAULT_ASPECT.across || view.aspect.down !== DEFAULT_ASPECT.down) {
    parts.push(`a=${view.aspect.across}:${view.aspect.down}`);
  }
  parts.push(`p=${encode(view.palette)}`);
  for (const spec of SHADE_KEYS) {
    const value = view.shade[spec.key];
    if (spec.same(value, spec.fallback)) continue;
    parts.push(`${spec.key}=${encode(spec.write(value))}`);
  }
  const level = view.level ?? LEVEL_KEY.fallback;
  if (!LEVEL_KEY.same(level, LEVEL_KEY.fallback)) {
    parts.push(`${LEVEL_KEY.key}=${encodeCurve(LEVEL_KEY.write(level))}`);
  }
  return parts.join("&");
}

/** Parse and re-emit: the fixed point every inflected link settles to. */
export function canonicalize(search, context) {
  return emit(parse(search, context), context);
}

/** A view of this `c` with nothing clicked.
 *
 *  The page builds its own opening view through the shallow parser, because the tab is the
 *  viewer and a view has to be one the viewer understands. This is the contract's own
 *  answer to the same question — what an inflected view of this `c` is before anything is
 *  clicked — and it is what `inflect-link.test.mjs` holds `emit` to on the empty case. */
export function fresh(constants, context) {
  const home = context.home(FAMILY);
  return {
    version: VERSION,
    family: FAMILY,
    constants,
    inflections: [],
    mode: MODES[0],
    params: {},
    x: home.x,
    y: home.y,
    w: home.w,
    aspect: { ...DEFAULT_ASPECT },
    palette: context.defaultPalette,
    shade: defaultShade(),
    level: null,
  };
}

/** A number as a coordinate: the text and the value, the shallow contract's spelling. */
export function coordinateOf(value) {
  return { text: shortest(value), value };
}
