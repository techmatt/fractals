// The Deep tab's link contract — its own, beside the shallow one and never inside it.
//
// **Why a second contract rather than a wider first one.** A deep view is not a shallow
// view with more digits. Its centre is a decimal that no double can hold, its iteration
// cap is a number the reader chose rather than the depth policy's answer, and it names no
// family and no mode because there is only one of each down here. Widening
// `permalink.js` to carry those would have moved three of its own rulings at once: that
// `x` is echoed as written and read as a double, that the cap is emphatically not a key,
// and that `f` and `m` say what is being drawn. Every shallow link ever written is held
// by those rulings, so the deep view gets a contract of its own and the shallow one does
// not move — `VERSION`, `READS`, the unknown-key sweep and the cap ruling are all exactly
// where they were.
//
// **The marker is `dv`, and it is what dispatches.** A query carrying it is a deep link
// and is read here; a query without it is a shallow link and is read there. Each refuses
// the other's marker by its own unknown-key rule, so a deep link pasted into a page that
// did not understand it is a visible refusal rather than a shallow picture at a rounded
// coordinate — which is the failure this whole file exists to make impossible.
//
// **What is shared is the colour, and it is shared rather than copied.** The seven shade
// keys, the `level` operator and the two encoders come from `permalink.js` by import.
// They are the engine's palette recipe and a URL's escaping rule, neither of which has
// anything to do with how deep the view is, and a second spelling of either is how two
// readers of one thing drift apart.
//
// ```
// dv · cx · cy · x · y · w · n · a · p · the shade keys · level
// ```
//
// Nothing here touches the DOM or the module, so `deep-link.test.mjs` runs it under
// node's own runner with nothing installed.

import {
  COORDINATE_LIMIT,
  DEEP_MARKER,
  LEVEL_KEY,
  PermalinkError,
  SHADE_KEYS,
  UI_KEYS,
  defaultShade,
  encode,
  encodeCurve,
  shortest,
} from "./permalink.js";
import * as fx from "./deep-fx.js";

/** The key that says a query is a deep view.
 *
 *  Re-exported rather than declared: it lives in `permalink.js`, because the page has to
 *  ask which reader a query belongs to before it loads either one, and this module is the
 *  half that should not be in a cold open. */
export const MARKER = DEEP_MARKER;

/** The contract version this module emits. Two, and it reads both.
 *
 *  **Version 2 is the Julia case**, and it is a version rather than a widening
 *  for the shallow contract's own reason. `cx` and `cy` have a default — absent
 *  is the Mandelbrot set — so every v1 link still parses and still means exactly
 *  what it meant, which is the test a widening passes. What bumps it is that the
 *  answer to "what does this tab draw" is no longer one recurrence: a link can
 *  now say which of two sets it is a picture of, and that is worth saying in the
 *  version rather than leaving a reader to find out from a key. */
export const VERSION = 2;

/** The versions this module reads. */
export const READS = [1, 2];

/** The key carrying the iteration cap.
 *
 *  **It is always emitted, and that is the opposite of the shallow contract's ruling.**
 *  There, the cap is the engine's depth policy answering for a width and a key for it
 *  would let a link say "this frame, but shallower" — a different picture wearing the
 *  same name. Here the cap is not the policy's: a deep frame's policy cap runs to six
 *  figures and costs minutes, so the number in force is one a reader chose and part of
 *  what they are sending. A deep link without it would open at whatever this page's
 *  policy said today, which is the same failure from the other side. */
const CAP_KEY = "n";

/** The most iterations a link may name. The kernel's own ceiling is a million; a link
 *  that named more would be asking for a frame that never finishes. */
export const CAP_LIMIT = 1_000_000;

/** The shallow contract's own cap on a coordinate's length, re-exported rather than
 *  restated — a URL is one thing however deep the picture is, and a caller that needs to
 *  know whether a place it has just computed can be spelled should ask this contract
 *  rather than carry a 64 of its own. */
export { COORDINATE_LIMIT };

/** The fewest. Below this there is no picture, only the disc. */
export const CAP_FLOOR = 50;

/** The aspect a link means when it says nothing — the shallow contract's, because a
 *  canvas is a canvas. */
export const DEFAULT_ASPECT = { across: 16, down: 9 };

const ASPECT = /^(\d{1,5}):(\d{1,5})$/;
const ASPECT_LIMIT = 10000;

/** Every key this contract spells, so an unknown one is told apart from a misspelled one. */
const KNOWN = new Set([
  MARKER,
  "cx",
  "cy",
  "x",
  "y",
  "w",
  CAP_KEY,
  "a",
  "p",
  LEVEL_KEY.key,
  ...SHADE_KEYS.map((spec) => spec.key),
]);

/**
 * Read a query string into a deep view, or throw a `PermalinkError` saying why not.
 *
 * `context.deepHome()` gives the centre and width a link that names none opens at, as
 * text. `context.deepCap(width)` is the kernel's own cap policy, asked for a link that
 * leaves the cap out — so that a view always has one and `emit` always has one to write.
 * `context.palettes` is the baked set, which is what makes `p` checkable at all.
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
    throw new PermalinkError("this is not a deep link: it carries no dv.");
  }
  if (!/^\d+$/.test(version) || !READS.includes(Number(version))) {
    throw new PermalinkError(
      `this page speaks the deep contract v${VERSION} and the link says ${MARKER}=${version}. ` +
        "It was written for a version of this tab that no longer exists, or for one that does not exist yet.",
    );
  }

  for (const key of seen) {
    if (KNOWN.has(key) || UI_KEYS.has(key)) continue;
    throw new PermalinkError(`the link carries a key the Deep tab does not know: ${key}.`);
  }

  const julia = juliaOf(params);
  const home = context.deepHome();
  // **A Julia link that names no frame opens at `z = c`**, and not at the
  // Mandelbrot home: the home is where the *parameter* plane starts, and on the
  // dynamical plane it means nothing. `z = c` is where the picture is.
  const x = coordinate(params.get("x"), "x") ?? julia?.x ?? coordinate(home.x, "x");
  const y = coordinate(params.get("y"), "y") ?? julia?.y ?? coordinate(home.y, "y");
  const w = width(params.get("w") ?? home.w);

  // A link that leaves the cap out gets the kernel's policy answer for its width, so the
  // view always carries one. Absent is "whatever this width implies" rather than a hole:
  // the key is a reader's override of the policy, and having no override is a state.
  const capText = params.get(CAP_KEY);
  const maxiter = capText === null ? context.deepCap(w.value) : cap(capText);

  const aspect = readAspect(params.get("a"));

  const palette = params.get("p") ?? context.defaultPalette;
  if (!context.palettes.has(palette)) {
    throw new PermalinkError(`there is no palette called ${palette} among the ones this page carries.`);
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

  return { version: VERSION, julia, x, y, w, maxiter, aspect, palette, shade, level };
}

/**
 * The Julia parameter a query names, or `null` where it names none.
 *
 * **The shallow contract's own spelling, deliberately.** `cx` and `cy` are what
 * `permalink.js` calls the same number on the dynamical plane — the `c` of
 * `z² + c`, which is half of a location's identity there — and a second name for
 * one quantity is how two readers of one thing drift apart. What differs is the
 * arithmetic behind them: here they are read into exact decimals, because a deep
 * `c` is a `c` no double can hold and rounding it would draw a different set
 * under the same name.
 */
function juliaOf(params) {
  const re = params.get("cx");
  const im = params.get("cy");
  if (re === null && im === null) return null;
  if (re === null || im === null) {
    throw new PermalinkError(
      "cx and cy are the two halves of one number — the c of z² + c — so a link carries both or neither.",
    );
  }
  return { x: coordinate(re, "cx"), y: coordinate(im, "cy") };
}

/** A deep view nobody has said anything about: the home frame, at the policy's cap. */
export function fresh(context) {
  const home = context.deepHome();
  const w = width(home.w);
  return {
    version: VERSION,
    julia: null,
    x: coordinate(home.x, "x"),
    y: coordinate(home.y, "y"),
    w,
    maxiter: context.deepCap(w.value),
    aspect: { ...DEFAULT_ASPECT },
    palette: context.defaultPalette,
    shade: defaultShade(),
    level: LEVEL_KEY.fallback,
  };
}

/**
 * The canonical query string for a deep view: keys in contract order, the shade keys left
 * out where they are the engine's own defaults.
 *
 * **The place, the width, the cap and the palette are always written.** The palette for
 * the shallow contract's reason — its default lives in the baked colormap set rather than
 * here, so a bare link that inherited it would change picture the day that set was
 * rebaked — and the frame for the same reason one step further out: the deep home is
 * `engine.wasm`'s Mandelbrot home, which is the engine's number and not this file's. The
 * cap for the reason `CAP_KEY` gives. So a deep link names its place unconditionally,
 * which is also the right shape for the one thing a deep link is for.
 *
 * **And the centre is written in one spelling rather than echoed.** The shallow contract
 * echoes a coordinate exactly as it arrived, because reading it would mean reading it into
 * a double and a double cannot give it back. Here it is read into an exact decimal, so
 * writing it back as a plain decimal loses nothing at all — and one spelling per place is
 * what lets the Saved tab tell two links apart by comparing them.
 */
export function emit(view) {
  const parts = [`${MARKER}=${VERSION}`];
  // **The parameter comes before the frame**, the way `f` does in the shallow
  // contract: it says which set is being drawn, and the centre and width are a
  // statement about where in that set to look.
  if (view.julia) {
    parts.push(`cx=${encode(view.julia.x.text)}`);
    parts.push(`cy=${encode(view.julia.y.text)}`);
  }
  for (const key of ["x", "y"]) parts.push(`${key}=${encode(view[key].text)}`);
  parts.push(`w=${encode(view.w.text)}`);
  parts.push(`${CAP_KEY}=${view.maxiter}`);
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

/** Parse and re-emit: the fixed point every deep link settles to. */
export function canonicalize(search, context) {
  return emit(parse(search, context));
}

/**
 * What a deep link says about itself, without a renderer: for the Saved tab's tiles.
 *
 * A saved deep picture is a place and a width and nothing a thumbnail could be drawn from
 * without the perturbation kernel and a minute of arithmetic, so the tab labels it instead
 * of drawing it. `deep` is what tells the panel that.
 */
export function describe(search, context) {
  const view = parse(search, context);
  return {
    deep: true,
    mode: "smooth",
    family: view.julia === null ? "mandelbrot" : "julia",
    palette: view.palette,
    said:
      view.julia === null
        ? `width ${view.w.text}`
        : `Julia at c = ${view.julia.x.text} ${sign(view.julia.y.text)}i · width ${view.w.text}`,
    view,
  };
}

/** `+ 0.14…` or `− 0.14…`: an imaginary part read as a person would say it. */
function sign(text) {
  return text.startsWith("-") ? `- ${text.slice(1)}` : `+ ${text}`;
}

/**
 * The part of a deep view that decides the arithmetic: what a kept field is keyed on.
 *
 * The set, the centre, the width, the cap and the grid. Not the palette and not one of
 * the seven, because a deep field is `smooth` — one scalar per sample — and nothing on
 * the colour side can move a sample. That is what makes a recolour of a frame that took a
 * minute cost a shade.
 *
 * **The set is in the key and has to be**, because the two are drawn at the same place: a
 * Julia view opens centred on the `c` its Mandelbrot view was centred on, so the two
 * frames agree about the centre, the width and the cap and are entirely different
 * pictures.
 */
export function fieldKey(view, pixelWidth, pixelHeight, supersample = 1) {
  const set = view.julia === null ? "m" : `j${view.julia.x.text},${view.julia.y.text}`;
  return `${set}|${view.x.text}|${view.y.text}|${view.w.text}|${view.maxiter}|${pixelWidth}x${pixelHeight}x${supersample}`;
}

// ------------------------------------------------------------------------ the readers

function stripLeadingQuestion(search) {
  return typeof search === "string" && search.startsWith("?") ? search.slice(1) : (search ?? "");
}

/**
 * A coordinate as an exact decimal and the text it will be written back as.
 *
 * The cap is the shallow contract's 64 characters, and it is the shallow contract's
 * `COORDINATE_LIMIT` rather than a second number: a URL is one thing however deep the
 * picture is. What it bounds here is real — a plain decimal at 1e-45 is about sixty-two
 * characters — so the sentence says what to do about it rather than only that it is long.
 */
function coordinate(text, key) {
  if (text === null || text === undefined) return null;
  if (text.length > COORDINATE_LIMIT) {
    throw new PermalinkError(
      `${key} is ${text.length} characters, and a coordinate is capped at ${COORDINATE_LIMIT}. ` +
        "That is about as deep as a link can spell a place; the view itself can go further.",
    );
  }
  const dec = fx.parse(text);
  if (dec === null) {
    throw new PermalinkError(
      `${key} has to be a decimal number, with or without an exponent; the link says ${text}.`,
    );
  }
  return { text: fx.text(dec), dec };
}

/** A coordinate built here rather than read: an exact decimal, spelled its one way. */
export function coordinateOf(dec) {
  return { text: fx.text(dec), dec };
}

/**
 * Whether a double holds this coordinate exactly — asked of the value and never of
 * the spelling.
 *
 * **This is what decides whether a deep Julia view can go back to the ordinary
 * explorer.** That contract reads a family constant into a double, so a `c` with
 * more digits than one holds would arrive next door as a *different parameter*: not
 * a coarser view of the same set, a different set, under the name of this one. A
 * frame can be too deep to carry back and be honestly refused; a parameter that is
 * too precise to carry back cannot be refused any other way, because nothing about
 * the picture would look wrong.
 */
export function exactInDouble(coordinate) {
  const back = fx.parse(String(fx.toNumber(coordinate.dec)));
  return back !== null && fx.compare(back, coordinate.dec) === 0;
}

/**
 * The width, as a double and the shortest string that reads back as it.
 *
 * **A width is a spacing and not a place**, which is why it is the one number down here
 * that a double still holds honestly: 1e-28 is nowhere near what an exponent cannot carry,
 * and the digits a double drops from a width are digits below the width's own last
 * significant figure rather than digits that say where the view is.
 */
function width(text) {
  if (typeof text !== "string" || text.length > COORDINATE_LIMIT) {
    throw new PermalinkError(`w is the width of the view in the plane, and this is not one: ${text}.`);
  }
  if (fx.parse(text) === null) {
    throw new PermalinkError(`w has to be a decimal number; the link says ${text}.`);
  }
  const value = Number(text);
  if (!(value > 0) || !Number.isFinite(value)) {
    throw new PermalinkError(`w is the width of the view in the plane, so it has to be positive; the link says ${text}.`);
  }
  return { text: shortest(value), value };
}

/** A width built here rather than read. */
export function widthOf(value) {
  return { text: shortest(value), value };
}

function cap(text) {
  if (!/^\d+$/.test(text)) {
    throw new PermalinkError(`${CAP_KEY} is the iteration cap and has to be a whole number; the link says ${text}.`);
  }
  const value = Number(text);
  if (value < CAP_FLOOR || value > CAP_LIMIT) {
    throw new PermalinkError(
      `${CAP_KEY} is the iteration cap and is between ${CAP_FLOOR} and ${CAP_LIMIT.toLocaleString("en-US")}; the link says ${text}.`,
    );
  }
  return value;
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
