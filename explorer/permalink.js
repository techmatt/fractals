// The permalink contract, version 2. This module owns parse, validate and
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
//     actually chose and nothing else — EXCEPT for the values whose default lives
//     outside this file. See "the always-emitted keys" below.
//   * `x`, `y`, `w` and the family constants are echoed back VERBATIM. The decimal
//     string is the identity of a location; `f64` is a lossy view of it that stops
//     being enough the moment deep zoom arrives, and a round trip through a double
//     would rewrite a link that was more precise than today's renderer.
//
// The names are the article's, because a URL is read by people: `mandelbrot`,
// `smooth_stripe`, `twilight_shifted`, and the engine's own spelling for every
// knob.
//
// ## What version 2 added, and why it is a 2
//
// Draft 1 drew one family in one mode. Version 2 draws every production family and
// every production mode, so `f` and `m` accept values v1 refused, the family
// constants a dynamical plane needs became real keys, and a mode's own parameters
// became keys of their own. None of that would bump the version on its own — a
// key that has a default is a widening, and an old link is still a complete
// statement.
//
// What bumps it is that **`v1` and `v2` links are read by the same rules**. A v1
// link is still parsed, and every v1-legal value still means exactly what it
// meant, so nothing anybody could have saved has changed meaning. But the answer a
// v1 link gets for `f=julia` is no longer "not yet" — it is a picture — and this
// module re-emits it as `v=2`. Saying that in the version is cheaper than leaving
// a reader to discover it.
//
// ## The always-emitted keys
//
// `p` and the family constants are emitted even when they are the default, and
// for one reason: their defaults are not written here. The palette default lives
// in the baked colormap set and the constants in the wallpaper project's shipped
// anchors, so a bare link that inherited either would change picture the day that
// set is rebuilt. Naming them costs a few characters and buys a link that draws
// the same thing forever.
//
// A mode's parameters are the opposite case and are NOT emitted unless somebody
// set one: their defaults live in the engine's mode catalog, which is the same
// place the mode's identity lives, so a link that omits `density` is asking for
// "the stripe mode", not for "a stripe mode at 6". If the catalog ever retunes a
// mode, that link should move with it — that is what naming a mode is for.
//
// Emit order: v · f · cx · cy · px · py · zx · zy · m · the mode's parameters · x · y · w ·
// a · p · then the shade parameters, in the order the engine's own palette recipe
// declares them.

/** The contract version this module emits. */
export const VERSION = 2;

/** The versions this module reads. See the note above on why 1 is still one of them. */
export const READS = [1, 2];

/**
 * The families this page draws, by the name a link carries.
 *
 * A name is the whole recurrence including its exponent, because one picture gets
 * one name: `mandelbrot` is the degree-2 parameter plane and `multibrot3` is the
 * degree-3 one, and the same rule gives the dynamical plane `julia` through
 * `julia5`. That is the engine's own view of it too — a `Family::Multibrot` at
 * degree 2 *is* the Mandelbrot set — spelled the way a reader would say it.
 */
export const FAMILIES = [
  "mandelbrot",
  "multibrot3",
  "multibrot4",
  "multibrot5",
  "julia",
  "julia3",
  "julia4",
  "julia5",
  "phoenix",
];

/**
 * The families that are not a place to look, with the reason.
 *
 * `fractional_multibrot` is a real family and is drawn in the article, but it is
 * **render-only**: a non-integer degree needs a branch cut, so the engine gives it
 * no home view and no place in anything but a written render. Named here so that a
 * hopeful link is told which half of the problem it has.
 */
export const RENDER_ONLY_FAMILIES = {
  fractional_multibrot:
    "a non-integer degree is render-only — it has no home view to open at, because " +
    "the picture is about the branch cut rather than about a place",
};

/**
 * The family constants a link may carry, by the family that has them.
 *
 * `c` is half a dynamical location's identity — the same `c` the wallpaper
 * project's walk requires and refuses to guess — `p` is the Phoenix memory
 * coefficient, and `z₋₁` is the previous iterate its recurrence starts with. All
 * three are decimal strings for the same reason a coordinate is.
 *
 * **`z₋₁` was absent from v2's first draft and is now a key**, because the reason
 * for leaving it out was wrong. A non-zero `z₋₁` is indeed a different set rather
 * than a different view of one — but that is the argument FOR spelling it, not
 * against: most of the Phoenix work the wallpaper project holds carries one, so a
 * link that could not say it would quietly draw the classic slice under a name
 * that meant something else. Absent still means the origin, so every link written
 * before this key existed still draws exactly what it drew.
 */
export const CONSTANTS = {
  mandelbrot: [],
  multibrot3: [],
  multibrot4: [],
  multibrot5: [],
  julia: ["cx", "cy"],
  julia3: ["cx", "cy"],
  julia4: ["cx", "cy"],
  julia5: ["cx", "cy"],
  phoenix: ["cx", "cy", "px", "py", "zx", "zy"],
};

/** Every constant key the contract spells, in emit order. */
const CONSTANT_KEYS = ["cx", "cy", "px", "py", "zx", "zy"];

/** The modes this page draws: the engine's production roster, in catalog order. */
export const MODES = [
  "smooth",
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
 * The modes the engine has and production does not draw, with the reason.
 *
 * One entry. `de` is niche rather than broken — the engine renders it on demand by
 * name — and it stays out of here because this page offers what the project ships.
 */
export const NICHE_MODES = {
  de: "the distance estimate is a niche mode: the engine renders it by name, and no " +
    "production draw picks it, so this page does not offer it either",
};

/**
 * How a number a mode's parameter carries is checked.
 *
 * These bounds are the contract's, not the engine's. The engine has its own — a
 * texture weight is in `[0, 1]` there too — and this is the first refusal rather
 * than the only one, which is why a bound here is never tighter than the engine's:
 * a link this module accepted and the renderer refused would still say so.
 */
const PARAMETERS = {
  density: { check: (value) => value > 0, says: "positive" },
  radius: { check: (value) => value > 0, says: "positive" },
  sigma: { check: (value) => value > 0, says: "positive" },
  threshold: { check: (value) => value > 0, says: "positive" },
  weight: { check: (value) => value >= 0 && value <= 1, says: "between 0 and 1" },
  opacity: { check: (value) => value >= 0 && value <= 1, says: "between 0 and 1" },
  shift: { check: () => true, says: "a number" },
};

/**
 * Which parameters each mode has, and in what order they are emitted.
 *
 * **A parameter is a number the engine's mode catalog writes down for that mode.**
 * The shape of a coloring is the mode's identity — which field, which blend, which
 * trap shape, which start colour — so none of those is here; what is left is the
 * settled constants. A mode with no row has none, which is most of them: the
 * escape count and the averaging fields have nothing to set.
 *
 * The defaults are the catalog's and are not restated here. See the note at the
 * top on why a mode's parameter is omitted on emit when nobody set it.
 */
export const MODE_PARAMETERS = {
  stripe: ["density"],
  trap_circle: ["radius"],
  smooth_mean_angle: ["weight"],
  smooth_angle_min: ["weight"],
  smooth_trap_circle: ["radius", "weight"],
  smooth_stripe: ["density", "weight"],
  smooth_curvature: ["weight"],
  direct_trap_ring: ["radius", "threshold", "opacity"],
  direct_trap_screen: ["threshold", "opacity"],
  direct_trap_multiply: ["threshold", "opacity"],
  direct_trap_lines: ["threshold", "opacity"],
  threads: ["sigma", "weight"],
  itinerary: ["shift"],
};

/** Every parameter key the contract spells, so an unknown key is told apart from
 *  a key the current mode has no room for. */
const PARAMETER_KEYS = new Set(Object.values(MODE_PARAMETERS).flat());

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
 * The two tagged shade values' vocabularies: a kind, and the one parameter it takes.
 *
 * Declared above the recipe rather than beside the readers, because the recipe names
 * them: a control that offers a reader the kinds a key may take reads them from here,
 * so the menu on the page and the values a link may carry are one list.
 */
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

/**
 * The engine's palette recipe, key by key: what it is called in a link, what the
 * engine's own default is, and how a value is read and written.
 *
 * One key per real engine parameter and no others. What is here is the shade side:
 * the palette recipe the engine records beside every render it makes, which is
 * independent of the mode and whose every default is the identity.
 *
 * **Exported because the page's controls are derived from it.** `shade.js` builds a
 * control per row — which widget from `control`, which menu from `table`, and what it
 * opens at from `fallback`, which is the engine's default and not a number the page
 * types. A control that read a value one way and a link another is the one failure a
 * URL contract cannot survive, so there is one reader and one writer per key and they
 * are these.
 */
export const SHADE_KEYS = [
  {
    key: "gamma",
    control: "number",
    read: (text) => positive(text, "gamma"),
    write: (value) => number(value),
    fallback: 1,
    same: (a, b) => a === b,
  },
  {
    key: "cycles",
    control: "number",
    read: (text) => positive(text, "cycles"),
    write: (value) => number(value),
    fallback: 1,
    same: (a, b) => a === b,
  },
  {
    key: "phase",
    control: "number",
    read: (text) => finite(text, "phase"),
    write: (value) => number(value),
    fallback: 0,
    same: (a, b) => a === b,
  },
  {
    key: "reverse",
    control: "flag",
    read: (text) => flag(text, "reverse"),
    write: (value) => (value ? "1" : "0"),
    fallback: false,
    same: (a, b) => a === b,
  },
  {
    key: "mirror",
    control: "flag",
    read: (text) => flag(text, "mirror"),
    write: (value) => (value ? "1" : "0"),
    fallback: false,
    same: (a, b) => a === b,
  },
  {
    key: "transfer",
    control: "tagged",
    table: TRANSFERS,
    read: readTransfer,
    write: writeTagged,
    fallback: { kind: "value" },
    same: sameTagged,
  },
  {
    key: "rolloff",
    control: "tagged",
    table: ROLLOFFS,
    read: readRolloff,
    write: writeTagged,
    fallback: { kind: "none" },
    same: sameTagged,
  },
];

/** One key's row of the recipe, by the name a link spells it with. */
export function shadeKey(key) {
  const spec = SHADE_KEYS.find((held) => held.key === key);
  if (spec === undefined) throw new PermalinkError(`there is no shade key called ${key}.`);
  return spec;
}

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
 * `context.home(family)` supplies the coordinate defaults as the strings they will
 * be echoed as — the engine's own home view for that family, formatted once by the
 * caller, so this module never restates a number the engine owns.
 * `context.constants(family)` does the same for a family's own constants, from the
 * wallpaper project's shipped anchors. `context.palettes` is the baked set, which
 * is what makes `p` checkable at all.
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

  if (seen.size === 0) return fresh(FAMILIES[0], MODES[0], context);

  const version = params.get("v");
  if (version === null) {
    throw new PermalinkError("the link carries no v, so there is no way to know which set of rules it was written against.");
  }
  if (!READS.includes(Number(version)) || !/^\d+$/.test(version)) {
    throw new PermalinkError(`this page speaks permalink v${VERSION} and the link says v=${version}. It was written for a version of this page that no longer exists, or for one that does not exist yet.`);
  }

  const family = params.get("f") ?? FAMILIES[0];
  if (!FAMILIES.includes(family)) {
    if (family in RENDER_ONLY_FAMILIES) {
      throw new PermalinkError(`${family} is not a view: ${RENDER_ONLY_FAMILIES[family]}.`);
    }
    throw new PermalinkError(`there is no family called ${family}.`);
  }

  const mode = params.get("m") ?? MODES[0];
  if (!MODES.includes(mode)) {
    if (mode in NICHE_MODES) {
      throw new PermalinkError(`${mode} is not offered here: ${NICHE_MODES[mode]}.`);
    }
    throw new PermalinkError(`there is no mode called ${mode}.`);
  }

  const wanted = MODE_PARAMETERS[mode] ?? [];
  const known = new Set([
    "v", "f", "m", "x", "y", "w", "a", "p",
    ...CONSTANTS[family], ...wanted, ...SHADE_KEYS.map((spec) => spec.key),
  ]);
  for (const key of seen) {
    if (known.has(key)) continue;
    if (CONSTANT_KEYS.includes(key)) {
      throw new PermalinkError(`${key} is a constant of a family this link does not name — ${family} has ${CONSTANTS[family].length === 0 ? "none" : CONSTANTS[family].join(" and ")}.`);
    }
    if (PARAMETER_KEYS.has(key)) {
      throw new PermalinkError(`the ${mode} mode has no ${key} parameter.`);
    }
    throw new PermalinkError(`the link carries a key this page does not know: ${key}.`);
  }

  const constants = {};
  const seeds = context.constants(family);
  for (const key of CONSTANTS[family]) {
    constants[key] = coordinate(params.get(key), key) ?? seeds[key];
  }

  const home = context.home(family);
  const x = coordinate(params.get("x"), "x") ?? home.x;
  const y = coordinate(params.get("y"), "y") ?? home.y;
  const w = coordinate(params.get("w"), "w") ?? home.w;
  if (!(w.value > 0)) {
    throw new PermalinkError(`w is the width of the view in the plane, so it has to be positive; the link says ${w.text}.`);
  }

  const aspect = readAspect(params.get("a"));

  const palette = params.get("p") ?? context.defaultPalette;
  if (!context.palettes.has(palette)) {
    throw new PermalinkError(`there is no palette called ${palette} among the ones this page carries.`);
  }

  const values = {};
  for (const key of wanted) {
    const text = params.get(key);
    if (text === null) continue;
    const value = finite(text, key);
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
    throw new PermalinkError(`${palette} is cyclic, so folding it would halve the cycle it was drawn to have. Folding is the seam fix for a map that has a seam.`);
  }

  return { version: VERSION, family, constants, mode, params: values, x, y, w, aspect, palette, shade };
}

/** A view nobody has said anything about: this family, this mode, at home. */
export function fresh(family, mode, context) {
  const constants = {};
  const seeds = context.constants(family);
  for (const key of CONSTANTS[family]) constants[key] = seeds[key];
  return {
    version: VERSION,
    family,
    constants,
    mode,
    params: {},
    ...context.home(family),
    aspect: { ...DEFAULT_ASPECT },
    palette: context.defaultPalette,
    shade: defaultShade(),
  };
}

/**
 * The canonical query string for a view: keys in contract order, defaults left out.
 *
 * This is what goes in the address bar, what "copy link" copies, and — over the
 * keys that decide the arithmetic rather than the colour — what the field cache is
 * keyed on. Returned without a leading `?` so a caller can decide whether an empty
 * canonical string means `?v=2` or nothing at all.
 */
export function emit(view, context) {
  const home = context.home(view.family);
  const parts = [`v=${VERSION}`];
  if (view.family !== FAMILIES[0]) parts.push(`f=${encode(view.family)}`);
  // Never conditional: see the contract note at the top of this file.
  for (const key of CONSTANTS[view.family]) parts.push(`${key}=${encode(view.constants[key].text)}`);
  if (view.mode !== MODES[0]) parts.push(`m=${encode(view.mode)}`);
  for (const key of MODE_PARAMETERS[view.mode] ?? []) {
    const value = view.params[key];
    if (value !== undefined) parts.push(`${key}=${encode(number(value))}`);
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
 * The field is what costs seconds, and for every mode but four none of the palette
 * or shade keys can change it — that is the whole point of computing the field
 * apart from the colour. So the cache is keyed on the geometry alone, plus the
 * pixel grid it was sampled on, and changing a palette hits a field that is already
 * there.
 *
 * **A direct trap is the exception and is keyed on everything.** Those four modes
 * composite samples *from* the gradient during the iteration and never produce a
 * field, so their colour is not separable from their arithmetic and a recolor is a
 * re-render. `direct` is the plan's own answer to that question, so this module
 * does not have to hold a list of which modes they are.
 */
export function fieldKey(view, context, pixelWidth, pixelHeight, direct = false) {
  const geometry = direct
    ? view
    : { ...view, palette: context.defaultPalette, shade: defaultShade() };
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
  if (text === null || text === undefined) return null;
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
