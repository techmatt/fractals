// The permalink contract, version 1. This module owns parse, validate and
// canonicalize, and nothing else in the explorer is allowed a second opinion
// about what a link means.
//
// A URL is the only part of this page that is permanent. The picture can be
// redrawn, the controls can be rearranged, the renderer can be rebuilt — a link
// somebody saved has to keep naming the same view a decade later. So the rules
// here are deliberately unforgiving:
//
//   * `v` says which contract a link was written against, and an unknown `v` is
//     refused rather than read hopefully. Adding a key that has a default never
//     bumps it — an old link is still a complete statement. Changing what a key
//     MEANS does bump it, because then an old link is a wrong statement.
//   * An unknown key is refused. A typo that silently rendered the default view
//     would look exactly like the link working.
//   * Defaults are omitted on emit, so the canonical string carries what somebody
//     actually chose and nothing else. `p` is the one exception and is ALWAYS
//     emitted: the palette is the only default whose meaning lives outside this
//     file, in the baked set, and a bare link that inherited `DEFAULT_PALETTE`
//     would quietly change colour the day that set is rebuilt. Naming it costs a
//     key and buys a link that draws the same picture forever. Parsing is
//     unchanged — a link with no `p` still means the default — so this adds no key
//     and changes no meaning, and `v` stays 1.
//   * `x`, `y` and `w` are echoed back VERBATIM. The decimal string is the
//     identity of a location; `f64` is a lossy view of it that stops being enough
//     the moment deep zoom arrives, and a round trip through a double would
//     rewrite a link that was more precise than today's renderer.
//
// The names are the article's, because a URL is read by people: `mandelbrot`,
// `smooth`, `twilight_shifted`, and the engine's own spelling for every knob.
//
// Emit order: v · f · m · x · y · w · a · p · then the shade parameters, in the
// order the engine's own palette recipe declares them.

/** The contract version this module speaks. */
export const VERSION = 1;

/** Families this draft renders. */
export const FAMILIES = ["mandelbrot"];

/**
 * Families the contract knows and this draft will not draw.
 *
 * Reserved from day one rather than left unknown: a link written for one of these
 * is a link to a picture this page will eventually show, and "not yet" is a
 * different answer from "that is not a family".
 */
export const RESERVED_FAMILIES = ["julia", "multibrot3", "multibrot4", "multibrot5", "phoenix"];

/** Modes this draft renders. */
export const MODES = ["smooth"];

/** The engine's other production modes, reserved on the same terms as the families. */
export const RESERVED_MODES = [
  "tia",
  "stripe",
  "exp_smoothing",
  "gaussian_int",
  "trap_circle",
  "curvature",
  "smooth_mean_angle",
  "smooth_angle_min",
  "smooth_trap_circle",
  "smooth_stripe",
  "smooth_curvature",
  "direct_trap_ring",
  "direct_trap_screen",
  "direct_trap_multiply",
  "direct_trap_lines",
  "threads",
  "itinerary",
];

/**
 * Keys the contract has spelled and v1 refuses.
 *
 * `cx` and `cy` are the dynamical-plane constant a Julia set needs and `pp` is
 * the Phoenix `p`. They are named here so that adding them later is filling in a
 * hole rather than widening the contract, and so that a hopeful link carrying one
 * gets told which half of the problem it has.
 */
export const RESERVED_KEYS = {
  cx: "the dynamical-plane constant belongs to a family this draft does not render",
  cy: "the dynamical-plane constant belongs to a family this draft does not render",
  pp: "the Phoenix memory constant belongs to a family this draft does not render",
};

/** The aspect a link means when it says nothing. */
export const DEFAULT_ASPECT = { across: 16, down: 9 };

/** The longest a coordinate string may be. Long enough for far more digits than
 *  `f64` carries, short enough that a link is not an attack surface. */
export const COORDINATE_LIMIT = 64;

/** The largest side an aspect may name. An aspect is a shape, not a resolution. */
const ASPECT_LIMIT = 10000;

const DECIMAL = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
const ASPECT = /^(\d{1,5}):(\d{1,5})$/;

/** A link this module refuses, with the sentence to put in front of a reader. */
export class PermalinkError extends Error {
  constructor(message) {
    super(message);
    this.name = "PermalinkError";
  }
}

/**
 * The engine's palette recipe, key by key: what it is called in a link, what the
 * engine's own default is, and how a value is read and written.
 *
 * One key per real engine parameter and no others. The smooth coloring itself has
 * no parameter to expose — `mode::resolve("smooth", …)` is a field and a curve,
 * both fixed by the mode — so there is no sweep key and none is reserved. What is
 * here is the shade side: the palette recipe the engine records beside every
 * render it makes.
 */
const SHADE_KEYS = [
  {
    key: "gamma",
    read: (text) => positive(text, "gamma"),
    write: (value) => number(value),
    fallback: 1,
    same: (a, b) => a === b,
  },
  {
    key: "cycles",
    read: (text) => positive(text, "cycles"),
    write: (value) => number(value),
    fallback: 1,
    same: (a, b) => a === b,
  },
  {
    key: "phase",
    read: (text) => finite(text, "phase"),
    write: (value) => number(value),
    fallback: 0,
    same: (a, b) => a === b,
  },
  {
    key: "reverse",
    read: (text) => flag(text, "reverse"),
    write: (value) => (value ? "1" : "0"),
    fallback: false,
    same: (a, b) => a === b,
  },
  {
    key: "mirror",
    read: (text) => flag(text, "mirror"),
    write: (value) => (value ? "1" : "0"),
    fallback: false,
    same: (a, b) => a === b,
  },
  {
    key: "transfer",
    read: readTransfer,
    write: writeTagged,
    fallback: { kind: "value" },
    same: sameTagged,
  },
  {
    key: "rolloff",
    read: readRolloff,
    write: writeTagged,
    fallback: { kind: "none" },
    same: sameTagged,
  },
];

/** The shade parameters as they are when nobody has said otherwise. */
export function defaultShade() {
  const shade = {};
  for (const spec of SHADE_KEYS) {
    shade[spec.key] = typeof spec.fallback === "object" ? { ...spec.fallback } : spec.fallback;
  }
  return shade;
}

/**
 * Read a query string into a view, or throw a `PermalinkError` saying why not.
 *
 * `context.home` supplies the coordinate defaults as the strings they will be
 * echoed as — the engine's own home view, formatted once by the caller, so this
 * module never restates a number the engine owns. `context.palettes` is the baked
 * set, which is what makes `p` checkable at all.
 */
export function parse(search, context) {
  const home = context.home;
  const palettes = context.palettes;
  const params = new URLSearchParams(stripLeadingQuestion(search));

  const seen = new Set();
  for (const key of params.keys()) {
    if (seen.has(key)) {
      throw new PermalinkError(`the link gives ${key} twice, and there is no rule for which wins.`);
    }
    seen.add(key);
  }

  if (seen.size === 0) {
    return { version: VERSION, family: FAMILIES[0], mode: MODES[0], ...home, aspect: { ...DEFAULT_ASPECT }, palette: context.defaultPalette, shade: defaultShade() };
  }

  const version = params.get("v");
  if (version === null) {
    throw new PermalinkError("the link carries no v, so there is no way to know which set of rules it was written against.");
  }
  if (version !== String(VERSION)) {
    throw new PermalinkError(`this page speaks permalink v${VERSION} and the link says v=${version}. It was written for a version of this page that no longer exists, or for one that does not exist yet.`);
  }

  const known = new Set(["v", "f", "m", "x", "y", "w", "a", "p", ...SHADE_KEYS.map((s) => s.key)]);
  for (const key of seen) {
    if (known.has(key)) continue;
    if (key in RESERVED_KEYS) {
      throw new PermalinkError(`${key} is reserved and not yet read: ${RESERVED_KEYS[key]}.`);
    }
    throw new PermalinkError(`the link carries a key this page does not know: ${key}.`);
  }

  const family = params.get("f") ?? FAMILIES[0];
  if (!FAMILIES.includes(family)) {
    if (RESERVED_FAMILIES.includes(family)) {
      throw new PermalinkError(`${family} is not yet — this explorer draws mandelbrot, and the other families are reserved.`);
    }
    throw new PermalinkError(`there is no family called ${family}.`);
  }

  const mode = params.get("m") ?? MODES[0];
  if (!MODES.includes(mode)) {
    if (RESERVED_MODES.includes(mode)) {
      throw new PermalinkError(`${mode} is not yet — this explorer draws the smooth mode, and the engine's other production modes are reserved.`);
    }
    throw new PermalinkError(`there is no mode called ${mode}.`);
  }

  const x = coordinate(params.get("x"), "x") ?? home.x;
  const y = coordinate(params.get("y"), "y") ?? home.y;
  const w = coordinate(params.get("w"), "w") ?? home.w;
  if (!(w.value > 0)) {
    throw new PermalinkError(`w is the width of the view in the plane, so it has to be positive; the link says ${w.text}.`);
  }

  const aspect = readAspect(params.get("a"));

  const palette = params.get("p") ?? context.defaultPalette;
  if (!palettes.has(palette)) {
    throw new PermalinkError(`there is no palette called ${palette} in the curated set.`);
  }

  const shade = defaultShade();
  for (const spec of SHADE_KEYS) {
    const text = params.get(spec.key);
    if (text !== null) shade[spec.key] = spec.read(text);
  }
  if (shade.mirror && palettes.get(palette).cyclic) {
    throw new PermalinkError(`${palette} is cyclic, so folding it would halve the cycle it was drawn to have. Folding is the seam fix for a map that has a seam.`);
  }

  return { version: VERSION, family, mode, x, y, w, aspect, palette, shade };
}

/**
 * The canonical query string for a view: keys in contract order, defaults left out.
 *
 * This is what goes in the address bar, what "copy link" copies, and — over the
 * keys that decide the arithmetic rather than the color — what the field cache is
 * keyed on. Returned without a leading `?` so a caller can decide whether an empty
 * canonical string means `?v=1` or nothing at all.
 */
export function emit(view, context) {
  const home = context.home;
  const parts = [`v=${VERSION}`];
  if (view.family !== FAMILIES[0]) parts.push(`f=${encode(view.family)}`);
  if (view.mode !== MODES[0]) parts.push(`m=${encode(view.mode)}`);
  for (const key of ["x", "y", "w"]) {
    if (view[key].text !== home[key].text) parts.push(`${key}=${encode(view[key].text)}`);
  }
  if (view.aspect.across !== DEFAULT_ASPECT.across || view.aspect.down !== DEFAULT_ASPECT.down) {
    parts.push(`a=${view.aspect.across}:${view.aspect.down}`);
  }
  // Never conditional: see the contract note at the top of this file.
  parts.push(`p=${encode(view.palette)}`);
  for (const spec of SHADE_KEYS) {
    const value = view.shade[spec.key];
    if (spec.same(value, spec.fallback)) continue;
    parts.push(`${spec.key}=${encode(spec.write(value))}`);
  }
  return parts.join("&");
}

/**
 * Percent-encode a value, and leave the colon alone.
 *
 * A colon is legal unencoded in a query string, and it is the separator both the
 * aspect and the tagged shade values use, so `a=21:9` beats `a=21%3A9` for the one
 * thing a URL is for — being read by a person. The `+` of an exponent is NOT left
 * alone and must not be: a raw `+` in a query string means a space, so a link
 * carrying `w=1e+3` unencoded arrives here as `1e 3` and is refused.
 */
function encode(text) {
  return encodeURIComponent(text).replaceAll("%3A", ":");
}

/** Parse and re-emit: the fixed point every link settles to. */
export function canonicalize(search, context) {
  return emit(parse(search, context), context);
}

/**
 * The part of the canonical string that decides the arithmetic.
 *
 * The field is what costs seconds, and none of the palette or shade keys can
 * change it — that is the whole point of computing the field apart from the
 * color. So the cache is keyed on the geometry alone, plus the pixel grid it was
 * sampled on, and changing a palette hits a field that is already there.
 */
export function fieldKey(view, context, pixelWidth, pixelHeight) {
  const geometry = { ...view, palette: context.defaultPalette, shade: defaultShade() };
  return `${emit(geometry, context)}&px=${pixelWidth}x${pixelHeight}`;
}

/**
 * A number as the shortest string that reads back as the same `f64`.
 *
 * JavaScript's own number-to-string is exactly that, which is why this is a name
 * rather than an algorithm: the property is what matters, and it is worth saying
 * out loud that a coordinate this page generates is round-trip exact.
 */
export function shortest(value) {
  return String(value);
}

/** A freshly generated coordinate: the number, and the text a link will carry. */
export function coordinateOf(value) {
  return { text: shortest(value), value };
}

// ------------------------------------------------------------------ the readers

function stripLeadingQuestion(search) {
  return typeof search === "string" && search.startsWith("?") ? search.slice(1) : (search ?? "");
}

function coordinate(text, key) {
  if (text === null) return null;
  if (text.length > COORDINATE_LIMIT) {
    throw new PermalinkError(`${key} is ${text.length} characters, and a coordinate is capped at ${COORDINATE_LIMIT}.`);
  }
  if (!DECIMAL.test(text)) {
    throw new PermalinkError(`${key} has to be a decimal number, with or without an exponent; the link says ${text}.`);
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
    throw new PermalinkError(`an aspect's two sides are each between 1 and ${ASPECT_LIMIT}; the link says ${text}.`);
  }
  return { across, down };
}

function finite(text, key) {
  if (!DECIMAL.test(text)) {
    throw new PermalinkError(`${key} has to be a number; the link says ${text}.`);
  }
  const value = Number(text);
  if (!Number.isFinite(value)) {
    throw new PermalinkError(`${key} is not a number this arithmetic can hold: ${text}.`);
  }
  return value;
}

function positive(text, key) {
  const value = finite(text, key);
  if (!(value > 0)) {
    throw new PermalinkError(`${key} has to be positive; the link says ${text}.`);
  }
  return value;
}

function flag(text, key) {
  if (text !== "0" && text !== "1") {
    throw new PermalinkError(`${key} is 0 or 1; the link says ${text}.`);
  }
  return text === "1";
}

/** `name` or `name:number` — one tagged value, the way the engine tags its own. */
function tagged(text, key, table) {
  const colon = text.indexOf(":");
  const kind = colon === -1 ? text : text.slice(0, colon);
  const entry = table[kind];
  if (entry === undefined) {
    throw new PermalinkError(`${key} is one of ${Object.keys(table).join(", ")}; the link says ${text}.`);
  }
  if (entry.parameter === undefined) {
    if (colon !== -1) {
      throw new PermalinkError(`${key}=${kind} takes no value after it; the link says ${text}.`);
    }
    return { kind };
  }
  if (colon === -1) {
    throw new PermalinkError(`${key}=${kind} needs its ${entry.parameter} after a colon; the link says ${text}.`);
  }
  const value = finite(text.slice(colon + 1), `${key}'s ${entry.parameter}`);
  entry.check(value, text);
  return { kind, [entry.parameter]: value };
}

const TRANSFERS = {
  value: {},
  edge: {
    parameter: "weight",
    check: (value, text) => {
      if (!(value >= 0)) {
        throw new PermalinkError(`the edge transfer's weight is at least 0; the link says ${text}.`);
      }
    },
  },
  rank: {},
};

const ROLLOFFS = {
  none: {},
  soft_knee: {
    parameter: "knee",
    check: (value, text) => {
      if (!(value >= 0 && value < 1)) {
        throw new PermalinkError(`the rolloff's knee is at least 0 and below 1; the link says ${text}.`);
      }
    },
  },
  reinhard: {},
  aces: {},
};

function readTransfer(text) {
  return tagged(text, "transfer", TRANSFERS);
}

function readRolloff(text) {
  return tagged(text, "rolloff", ROLLOFFS);
}

function writeTagged(value) {
  for (const [name, held] of Object.entries(value)) {
    if (name !== "kind") return `${value.kind}:${number(held)}`;
  }
  return value.kind;
}

function sameTagged(a, b) {
  return writeTagged(a) === writeTagged(b);
}

function number(value) {
  return shortest(value);
}
