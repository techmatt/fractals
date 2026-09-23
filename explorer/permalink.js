// The permalink contract, version 3. This module owns parse, validate and
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
// **Two parameters are the exception since version 3**, and `DERIVED` names them: an
// angle mode's `weight` and a screened or multiplied trap's `opacity`. Absent, those
// mean "taken from this view" — the page measures the view and derives the value —
// rather than the catalog's constant. See "What version 3 changed" below.
//
// Emit order: v · f · cx · cy · px · py · zx · zy · m · the mode's parameters · x · y · w ·
// a · p · then the shade parameters, in the order the engine's own palette recipe
// declares them · level.
//
// ## What version 3 changed, and why it is a 3
//
// Version 3 changed what an absent `weight` or `opacity` MEANS under the modes `DERIVED`
// lists, and a change of meaning is exactly what the rules above say bumps `v`. Under
// v1 and v2 an absent value was the catalog's settled constant — 0.85 for an angle
// mode's texture, the trap's own opacity — and every picture drawn before v3 was drawn
// at it. Under v3 it asks the page to derive the value from the view in front of it.
//
// So an older link is still read by its own rules: `parse` fills an absent derived
// parameter of a v1 or v2 link with the catalog's constant, which `context.settled`
// supplies out of the baked catalog, and the view re-emits as v3 with the number
// written down. Nothing anybody saved changes picture. A v3 link the page writes always
// carries the value in force, derived or not, so an absent one only ever arrives from a
// person who left it out on purpose.
//
// ## `level`, and why it is last
//
// A gallery seat is not drawn through the map its recipe names. Every candidate the
// wallpaper project makes goes through `band_autolevel/v1`, which measures the
// finished picture's tone and, where that tone sits outside the band of finished
// wallpapers, pushes a curve through the MAP'S OWN STOPS and renders again. So a
// link built from a seat's recipe alone draws the right geometry in the wrong
// colour — 29.51 of 255 apart, on a scale where re-encoding the same JPEG costs
// about 2.4.
//
// `level` carries the curve that run recorded, so the link draws what the gallery
// shipped. It is last in the emit order because it is the last thing that happens
// to a colour: the map is chosen, the recipe is spent on it, and then the operator's
// curve moves the ramp. Absent means the operator did not act, which is what every
// link written before this key existed meant — so none of them changed picture.
//
// It is NOT one of the seven shade keys and must not become one. Those seven are the
// engine's own `Palette` recipe, handed to the module as they stand; this is a
// separate operator that lives in the wallpaper project's Python, and the module
// applies it to the stops before it bakes them.
//
// ## The keys that are not about the picture
//
// The page the reader touches is a studio: a viewer on the right, and on the left a
// panel that is either the gallery or the atlas. Which of those two is open is worth
// keeping in a link — sending somebody the atlas is sending them the atlas — and it is
// emphatically not part of the picture. So `UI_KEYS` is a short list of keys this
// contract **tolerates and never reads**: `parse` lets one through without complaint
// and puts nothing in the view for it, `emit` never writes one, and therefore the
// canonical string of a view does not carry one. A reader who copies the link gets the
// picture; the page, which knows it also has panels, adds its own key back on top.
//
// Two rules keep that from becoming a second contract by the back door. **A UI key
// never refuses a link** — not even with a value this page does not recognize, because
// a panel nobody can open is a page that opens the other one, and a picture is never
// worth withholding over furniture. And **a UI key never decides what is drawn**: the
// moment one would, it is a picture key and belongs in the emit order above with a
// default and a reader.

/** The contract version this module emits. */
export const VERSION = 3;

/** The versions this module reads. See the note above on why 1 is still one of them. */
export const READS = [1, 2, 3];

/**
 * The families this page draws, by the name a link carries.
 *
 * A name is the whole recurrence including its exponent, because one picture gets
 * one name: `mandelbrot` is the degree-2 parameter plane and `multibrot3` is the
 * degree-3 one, and the same rule gives the dynamical plane `julia` through
 * `julia6`. That is the engine's own view of it too — a `Family::Multibrot` at
 * degree 2 *is* the Mandelbrot set — spelled the way a reader would say it.
 *
 * `phoenix_plane` is the Phoenix recurrence over its parameter plane: `c` is the point
 * and the orbit opens at z₀ = z₋₁ = 0, so each point of it is a `phoenix` at that `c`
 * and the plane's own `p` *(phoenix_tab_ckpt140)*. The engine calls it `phoenix_m`, the
 * Mandelbrot-type Phoenix; a link says what it is rather than which kind it is, and
 * `render.js` renames it the way it renames `multibrot3`.
 */
export const FAMILIES = [
  "mandelbrot",
  "multibrot3",
  "multibrot4",
  "multibrot5",
  "multibrot6",
  "julia",
  "julia3",
  "julia4",
  "julia5",
  "julia6",
  "phoenix",
  "phoenix_plane",
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
  multibrot6: [],
  julia: ["cx", "cy"],
  julia3: ["cx", "cy"],
  julia4: ["cx", "cy"],
  julia5: ["cx", "cy"],
  julia6: ["cx", "cy"],
  phoenix: ["cx", "cy", "px", "py", "zx", "zy"],
  // `c` is the pixel and z₋₁ is the origin by the plane's definition, so `p` is the one
  // constant left. It is a pair like the Julia set's own `p`, and the page's control
  // writes `py=0`: the engine takes a complex `p` for free, and a link can say one.
  phoenix_plane: ["px", "py"],
};

/** Every constant key the contract spells, in emit order. */
const CONSTANT_KEYS = ["cx", "cy", "px", "py", "zx", "zy"];

/**
 * The constants that are two halves of one number, and the number each names.
 *
 * **A link carries both or neither**, which is the deep contract's rule arriving
 * here *(pre_closeout_ckpt138, 2026-09-20)*. Half of one of these used to be
 * filled from the shipped anchor: `?v=3&f=julia&cx=-0.4` drew
 * c = −0.4 − 0.6514609012382414i, which is neither the set the link half-named nor
 * the anchor, and the address bar then canonicalized to that hybrid — so a reader
 * who saved it had a link naming a set nobody chose. A truncated link is the
 * realistic route in, and the page could not tell them.
 *
 * **`x` without `y` is not the same thing and stays fine.** A frame coordinate has
 * a stated default, the home view, so half a frame still names a place somebody
 * could have meant. Half an identity names a different object.
 *
 * Declared rather than derived. `CONSTANT_KEYS` chunked in twos happens to give
 * these three pairs today, and that is an accident of the emit order rather than a
 * rule — `both()` below holds the two tables to each other instead.
 */
const CONSTANT_PAIRS = [
  ["cx", "cy", "one number — the c of z² + c"],
  ["px", "py", "one number — the Phoenix memory coefficient p"],
  ["zx", "zy", "one number — the previous iterate z₋₁ the recurrence starts with"],
];

/** Every paired key, so the pair table can be held to the key table. */
const PAIRED_KEYS = new Set(CONSTANT_PAIRS.flatMap(([re, im]) => [re, im]));

/** A family's constants are pairs, and a link that names half of one is refused. */
function both(params, family) {
  for (const key of CONSTANTS[family]) {
    if (!PAIRED_KEYS.has(key)) {
      throw new PermalinkError(`${key} is a constant this contract does not know how to pair.`);
    }
  }
  for (const [re, im, names] of CONSTANT_PAIRS) {
    if (!CONSTANTS[family].includes(re)) continue;
    const given = params.get(re) !== null ? re : params.get(im) !== null ? im : null;
    if (given === null) continue;
    const missing = given === re ? im : re;
    if (params.get(missing) !== null) continue;
    throw new PermalinkError(
      `${re} and ${im} are the two halves of ${names}, so a link carries both or neither; ` +
        `this one names ${given} and not ${missing}.`,
    );
  }
}

/** The modes this page draws: `modes.jsonl`'s roster, in catalog order. */
export const MODES = [
  "smooth",
  "tia",
  "stripe",
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
 * Names the engine answers to that this page refuses, with the reason to say back.
 *
 * One entry, and it is not a census: a name absent from `MODES` and absent here is
 * refused as unknown, which is the right answer for one this site does not carry. What
 * earns an entry is a name a reader could reasonably expect to work — `de` is niche
 * rather than broken, the engine renders it on demand, and a bare "there is no mode
 * called de" would read as a bug in this page rather than as a choice.
 */
export const NICHE_MODES = {
  de: "the distance estimate is a niche render mode: the engine renders it by name, and no " +
    "production draw picks it, so this page does not offer it either",
};

/**
 * How a number a mode's parameter carries is checked.
 *
 * These bounds are the contract's, not the engine's. The engine has its own — a
 * texture weight is in `[0, 1]` there too — and this is the first refusal rather
 * than the only one, which is why a bound here is never tighter than the engine's:
 * a link this module accepted and the renderer refused would still say so.
 *
 * **Exported for `paged-inflection/inflect-link.js` and for nothing else**, the way
 * `encode` is exported for `deep-link.js`. That contract is paged out and nothing on the
 * page reads this table, and the export stays because the paged suite still runs against
 * it: a second table of what a `weight` or an `opacity` may be would be a second thing to
 * keep in step. It moves no rule of this contract — the keys, their checks and their
 * sentences are unchanged.
 */
export const PARAMETERS = {
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

/**
 * The parameters a view derives when a v3 link leaves them out, by mode.
 *
 * An angle mode's texture weight and a trap's opacity were settled once for every view,
 * and each fails on views its constant was not settled on: a texture that changes at
 * every pixel buries the picture at 0.85, and a trap whose orbits rarely come close
 * paints a blank frame. The module measures the view and derives the value; this is
 * which keys, under which modes, that happens to. `direct_trap_ring` is not here: it is
 * not a mode the pipeline mines, and nothing measured it.
 */
export const DERIVED = {
  smooth_mean_angle: "weight",
  smooth_angle_min: "weight",
  smooth_curvature: "weight",
  direct_trap_screen: "opacity",
  direct_trap_multiply: "opacity",
  direct_trap_lines: "opacity",
};

/**
 * A view's parameters with the catalog's constant written in wherever a derived one is
 * absent: what a *record* of a picture means, because every picture a record describes
 * was drawn at that constant. Without it a recorded view would emit as a v3 link that
 * asks the page to derive, and open as a picture nobody made. A reader's view never goes
 * through here — an absent value on the page is one still to be derived.
 *
 * **A key the mode has no room for is refused, never dropped.** `emit` writes only the
 * keys `MODE_PARAMETERS` names, so a record that spells a parameter in another word — the
 * engine's `texture_weight` for the contract's `weight` — used to lose it silently, and
 * the constant above took its place: 28 atlas thumbnails opened in the explorer at 0.85
 * over pictures drawn at their own weights *(ckpt141)*. Every writer of a recorded view
 * comes through here, so this is where the other spelling becomes an error.
 */
export function settledParams(mode, params, context) {
  const wanted = MODE_PARAMETERS[mode] ?? [];
  for (const key of Object.keys(params)) {
    if (!wanted.includes(key)) {
      throw new PermalinkError(
        PARAMETER_KEYS.has(key)
          ? `the ${mode} render mode has no ${key} parameter.`
          : `a recorded ${mode} view carries ${key}, which is not a key this contract spells.`,
      );
    }
  }
  const derived = DERIVED[mode];
  if (derived === undefined || params[derived] !== undefined) return params;
  const settled = context.settled?.(mode)?.[derived];
  if (settled === undefined) {
    throw new Error(`the contract context has no settled ${derived} for ${mode}`);
  }
  return { ...params, [derived]: settled };
}

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

/**
 * The tone operators a link may name, and how many numbers each takes.
 *
 * One entry, and the shape is the point: a version is part of the name, so a
 * `band_autolevel/v2` that measured differently would be a value this contract
 * refuses rather than a curve it misread. The parameters are the operator's own
 * field names in the operator's own order — `black_pt`, `white_pt`, `exponent`
 * and the two `out_ends` — which is what the wasm module deserializes them into
 * and what a run's stamp calls them. Nothing is renamed on the way through.
 *
 * The other nine fields of a run's `curve` block are how the curve was *arrived
 * at*: the band it was projected onto, which side of that band each statistic
 * fell, whether the exponent was clamped. A replay does not read any of them, so
 * a link does not carry them.
 */
export const OPERATORS = {
  "band_autolevel/v1": {
    parameters: ["black_pt", "white_pt", "exponent", "out_ends[0]", "out_ends[1]"],
  },
};

/**
 * The `level` key, read and written the way the seven shade keys are.
 *
 * Deliberately its own row rather than an eighth member of `SHADE_KEYS`: those
 * seven ARE the engine's palette recipe and are handed to the module as a unit,
 * and this is a separate operator that acts on the ramp before the recipe is spent
 * on it. A key in the wrong list would be a key handed to the wrong place.
 */
export const LEVEL_KEY = {
  key: "level",
  read: readLevel,
  write: writeLevel,
  fallback: null,
  same: sameLevel,
};

/**
 * The keys the page carries and the picture ignores. See the note in the header.
 *
 * `panel` is which side the studio's left panel is showing. It is exported so the page
 * and the contract spell it once between them: a page that typed `"panel"` beside a
 * contract that had been renamed would go on working until the day somebody sent a
 * link, which is the worst moment to find out.
 *
 * The other four are the screensaver's *(gallery_screensaver_ckpt141)*, written only
 * while `panel=screensaver`: `every` is its interval, and `collection`, `modes` and `hue`
 * are the gallery's own dropdown and chips, which are what it draws its pictures from.
 * They choose which picture comes *next*, never how the one named here is drawn, which
 * is what keeps them furniture.
 */
export const UI_KEYS = new Set(["panel", "every", "collection", "modes", "hue"]);

/**
 * The key that marks a query as the Deep tab's rather than this contract's.
 *
 * **It lives here, in the module that decides what a query means, and not in
 * `deep-link.js`.** The page has to know which of the two readers a query belongs to
 * before it has either answer, at the door, on every boot — and `deep-link.js` pulls in
 * exact `BigInt` arithmetic that a reader who never opens that tab should not download.
 * So the one-line question is here and the answer to it is there.
 *
 * A `dv` reaching this contract's own key sweep is refused by it like any other unknown
 * key, which is what makes the two readers safe to have in one address space.
 */
export const DEEP_MARKER = "dv";

/** Whether a query is a deep link: the marker, and nothing else about it. */
export function isDeep(search) {
  return new URLSearchParams(stripLeadingQuestion(search)).has(DEEP_MARKER);
}

/**
 * The same, for the **paged** Inflection tab — see `paged-inflection/README.md`.
 *
 * The tab is out of the working set and its contract went with it, and this marker stays
 * because a link outlives the trial. A reader who saved or copied one still has `iv` in
 * their hands, and the page sorts on it here so that it can say what the link is rather
 * than refuse it as an unknown key. Both live contracts go on refusing `iv` and `q` by
 * their own unknown-key sweeps, which is what keeps an inflected picture from ever being
 * drawn as the plain Julia set underneath it wearing that picture's name.
 */
export const INFLECT_MARKER = "iv";

/** Whether a query is an inflected link: the marker, and nothing else about it. */
export function isInflected(search) {
  return new URLSearchParams(stripLeadingQuestion(search)).has(INFLECT_MARKER);
}

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

  // A link that says nothing about the picture is the home view, and a link that says
  // nothing about the picture but does open a panel is still the home view: a UI key
  // does not oblige a reader to have written a `v` they had no picture to version.
  if ([...seen].every((key) => UI_KEYS.has(key))) return fresh(FAMILIES[0], MODES[0], context);

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
    throw new PermalinkError(`there is no render mode called ${mode}.`);
  }

  const wanted = MODE_PARAMETERS[mode] ?? [];
  const known = new Set([
    "v", "f", "m", "x", "y", "w", "a", "p", LEVEL_KEY.key,
    ...CONSTANTS[family], ...wanted, ...SHADE_KEYS.map((spec) => spec.key),
  ]);
  for (const key of seen) {
    if (known.has(key) || UI_KEYS.has(key)) continue;
    if (CONSTANT_KEYS.includes(key)) {
      throw new PermalinkError(`${key} is a constant of a family this link does not name — ${family} has ${CONSTANTS[family].length === 0 ? "none" : CONSTANTS[family].join(" and ")}.`);
    }
    if (PARAMETER_KEYS.has(key)) {
      throw new PermalinkError(`the ${mode} render mode has no ${key} parameter.`);
    }
    throw new PermalinkError(`the link carries a key this page does not know: ${key}.`);
  }

  const constants = {};
  const seeds = context.constants(family);
  for (const key of CONSTANTS[family]) {
    constants[key] = coordinate(params.get(key), key) ?? seeds[key];
  }
  // **After the spelling, not before it.** `cx=0x10` with no `cy` is both a half and a
  // number this contract cannot read, and the spelling is the more useful sentence —
  // it names what to fix rather than what else to add.
  both(params, family);

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
  // A link written before v3 meant the catalog's constant by an absent derived parameter,
  // and still does. See "What version 3 changed" at the top.
  if (Number(version) < 3) Object.assign(values, settledParams(mode, values, context));

  const shade = defaultShade();
  for (const spec of SHADE_KEYS) {
    const text = params.get(spec.key);
    if (text !== null) shade[spec.key] = spec.read(text);
  }
  if (shade.mirror && context.palettes.get(palette).cyclic) {
    throw new PermalinkError(`${palette} is cyclic, so folding it would halve the cycle it was drawn to have. Folding is the seam fix for a map that has a seam.`);
  }

  // Whether this mode is one the operator acts on is the module's answer and not
  // this file's: the operator reads a coloring kind, which lives in the engine's
  // mode catalog, and a fourth copy of that catalog here is a fourth thing to keep
  // in step. A link asking for a curve under a direct trap draws nothing and shows
  // the module's own sentence, which is how every other engine refusal arrives.
  const levelText = params.get(LEVEL_KEY.key);
  const level = levelText === null ? LEVEL_KEY.fallback : LEVEL_KEY.read(levelText);

  return { version: VERSION, family, constants, mode, params: values, x, y, w, aspect, palette, shade, level };
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
    level: LEVEL_KEY.fallback,
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
  // Last, because it is the last thing that happens to a colour — see the note at
  // the top. `view.level` is absent on a view built before this key existed, which
  // is the same thing as the operator not having acted.
  const level = view.level ?? LEVEL_KEY.fallback;
  if (!LEVEL_KEY.same(level, LEVEL_KEY.fallback)) {
    parts.push(`${LEVEL_KEY.key}=${encodeCurve(LEVEL_KEY.write(level))}`);
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
 *
 * **Exported for `deep-link.js` and for nothing else.** The Deep tab's links are a
 * contract of their own, but they spell the colour keys the way this one does, and this
 * rule — the colon left alone, the `+` of an exponent emphatically not — is subtle enough
 * that a second copy of it would be a second thing to get right. Exporting it moves no
 * rule of this contract; see the note above `DEEP` in that file.
 */
export function encode(text) {
  return encodeURIComponent(text).replaceAll("%3A", ":");
}

/**
 * The same, and it also leaves the slash and the comma alone.
 *
 * Both are legal unencoded in a query string and both are separators inside one
 * value — `band_autolevel/v1` is the operator's own name and the five numbers are
 * comma-separated — so `level=band_autolevel/v1:0.45,0.98,1.41,0.45,0.98` beats
 * the same string with three characters spelled as percent escapes, for the one
 * thing a URL is for.
 *
 * **Why this is not a widening of [`encode`].** A palette name may carry a comma —
 * `Gold Field, Blood Spark` is one, and it is in `links.jsonl` today as `%2C`. A
 * link that spells it either way parses to the same view, but the *canonical*
 * spelling would move, and re-spelling a permanent URL to tidy up three characters
 * is not a trade this contract makes. So the widening is where it is needed and
 * nowhere else.
 *
 * The `+` of an exponent is encoded here exactly as it is there, and must be: a
 * raw `+` in a query string means a space.
 *
 * Exported beside [`encode`], for `deep-link.js`, for the same reason.
 */
export function encodeCurve(text) {
  return encode(text).replaceAll("%2F", "/").replaceAll("%2C", ",");
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
    : { ...view, params: shadeless(view.params), palette: context.defaultPalette, shade: defaultShade(), level: null };
  return `${emit(geometry, context)}&px=${pixelWidth}x${pixelHeight}`;
}

/** A composite's weight mixes two fields that are already computed, so it is a colour
 *  and not a number the arithmetic reads: a field keyed on it would be iterated again
 *  for every weight a view is derived or dragged to. */
function shadeless(params) {
  const { weight: _, ...rest } = params;
  return rest;
}

/**
 * What a trap's probe of this view depends on: everything its painting does except the
 * opacity the probe is there to derive. The probe grid is fixed by the page, so no size.
 */
export function probeKey(view, context) {
  const { opacity: _, ...params } = view.params;
  return `${emit({ ...view, params, level: null }, context)}&probe`;
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

/**
 * `operator:a,b,c,d,e` — one recorded tone curve, as a link spells it.
 *
 * The same shape as a tagged shade value and one comma-separated list longer,
 * because this operator takes five numbers rather than one. The name carries its
 * version, so the count that follows is the named operator's own and is never
 * guessed from how many numbers arrived.
 */
function readLevel(text) {
  const colon = text.indexOf(":");
  const operator = colon === -1 ? text : text.slice(0, colon);
  const entry = OPERATORS[operator];
  if (entry === undefined) {
    throw new PermalinkError(`level names ${operator}, and the operators this page can replay are ${Object.keys(OPERATORS).join(", ")}.`);
  }
  if (colon === -1) {
    throw new PermalinkError(`level=${operator} needs its ${entry.parameters.length} numbers after a colon, ${entry.parameters.join(", ")}; the link says ${text}.`);
  }
  const parts = text.slice(colon + 1).split(",");
  if (parts.length !== entry.parameters.length) {
    throw new PermalinkError(`${operator} takes ${entry.parameters.length} numbers — ${entry.parameters.join(", ")} — and the link gives ${parts.length}.`);
  }
  const read = parts.map((part, at) => finite(part, `${operator}'s ${entry.parameters[at]}`));
  const [black, white, exponent, low, high] = read;
  if (!(white > black)) {
    throw new PermalinkError(`${operator}'s white point sits above its black point; the link says ${number(white)} above ${number(black)}.`);
  }
  if (!(exponent > 0)) {
    throw new PermalinkError(`${operator}'s exponent is positive; the link says ${number(exponent)}.`);
  }
  return { operator, black_pt: black, white_pt: white, exponent, out_ends: [low, high] };
}

function writeLevel(value) {
  const numbers = [value.black_pt, value.white_pt, value.exponent, ...value.out_ends];
  return `${value.operator}:${numbers.map(number).join(",")}`;
}

function sameLevel(a, b) {
  if (a === null || b === null) return a === b;
  return writeLevel(a) === writeLevel(b);
}

function number(value) {
  return shortest(value);
}
