// Hold look: what the absolute scale's Lambda and Period do while the box beside them is
// ticked. Pure, like `shade.js`: no document, no module, and one test file.
//
// **The picture under the absolute scale is `frac(T(ν)/period + phase)`**, with `T` the
// Box–Cox compression `(ν^λ − 1)/λ` (`ln ν` at `λ = 0`) and `ν` floored where the engine
// floors it — `Palette::place_absolute` in the engine's `coloring.rs`. Nothing here changes
// that, or what a link says: a held move is a move of more than one key, written into the
// same keys a link has always carried.
//
// What is held is **the colour at one value of the field**, the reference `ν_m`, the median
// escaped value of the frame on the screen: `frac(T(ν_m)/period + phase)`. A move of Lambda
// or Period re-solves Phase so that it stays; Phase is free. Period itself is the page's to
// set — a moved Lambda brings it along to keep the cycles across the frame
// (`period-range.js`, since period_slider_ckpt155, which retired the band-density solve that
// used to live here). The solve is exact in closed form and gives up only the rounding the
// written phase takes (`PHASE_PLACES`).

/** The smallest value the engine reads a field value as: `f32::MIN_POSITIVE`, which is
 *  `COMPRESSION_FLOOR` in the engine's `coloring.rs`. */
export const FLOOR = 2 ** -126;

/** How many samples the median is taken over, at most. A frame is millions of samples and
 *  the median of an even stride through a quarter of a million is the frame's to well
 *  inside a band; the stride is a fixed function of the field, so a frame always answers
 *  the same. */
export const REFERENCE_SAMPLES = 1 << 18;

/** A solved period is written at four significant figures, right to a part in ten thousand,
 *  so a link does not carry seventeen digits of solve. `fit.js` and `period-range.js` write
 *  at it. */
export const PERIOD_FIGURES = 4;

/** A held phase is written at four places, a ten-thousandth of a turn. It is solved after
 *  the period is rounded, so the colour at `ν_m` is held to that and not to the period's
 *  rounding as well. */
export const PHASE_PLACES = 4;

/**
 * The engine's compression of one value, in `f64`: `Palette::absolute_value`.
 *
 * With a `knee` *(explorer_knee_ckpt157, Straighten iter)* it is the knee mapping: `ν − 1`
 * at and above the knee, and `(knee − 1) + knee · T_λ(ν / knee)` below it, which meets that
 * line in value and slope. `null` is off, and the plain Box–Cox it always was. Every module
 * here that reads the absolute scale's `g` reads it through this, knee and all.
 */
export function compress(nu, lambda, knee = null) {
  const value = Math.max(nu, FLOOR);
  if (knee === null || knee === undefined) return boxCox(value, lambda);
  return value >= knee ? boxCox(value, 1) : knee - 1 + knee * boxCox(value / knee, lambda);
}

function boxCox(value, lambda) {
  return lambda === 0 ? Math.log(value) : (value ** lambda - 1) / lambda;
}

/** Where in the gradient `nu` lands, in `[0, 1)`. */
export function colourAt(nu, { lambda, period, phase, knee = null }) {
  return wrap(compress(nu, lambda, knee) / period + phase);
}

function wrap(turns) {
  const turned = turns - Math.floor(turns);
  return turned >= 1 ? 0 : turned;
}

const remembered = new WeakMap();

/**
 * The reference `ν_m` of a field, or `null` where it has no escaped sample.
 *
 * The field is either tab's — `{ values, width, height, supersample }`, lane-major — and
 * the value the absolute scale lays out is lane 0 (the base, where a mode composites two),
 * which is what is read. A sample with no value is interior and is not counted. Memoized on
 * the field's own array, so a recolour asks nothing twice and a new frame is a new answer.
 */
export function reference(field) {
  if (field === null || field === undefined || !field.values) return null;
  if (remembered.has(field.values)) return remembered.get(field.values);
  const ss = field.supersample ?? 1;
  const count = Math.min(field.values.length, field.width * ss * field.height * ss);
  const stride = Math.max(1, Math.floor(count / REFERENCE_SAMPLES));
  const taken = [];
  for (let at = 0; at < count; at += stride) {
    const value = field.values[at];
    if (Number.isFinite(value)) taken.push(Math.max(value, FLOOR));
  }
  let answer = null;
  if (taken.length > 0) {
    const sorted = Float64Array.from(taken).sort();
    const middle = sorted.length >> 1;
    answer = sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  }
  remembered.set(field.values, answer);
  return answer;
}

/**
 * What a hold keeps, measured off a recipe at `nu`: `{ nu, colour }`.
 *
 * Taken once when a hold starts and kept while it lasts, rather than re-measured off each
 * written recipe: the written numbers are rounded, and a drag re-measured off its own
 * rounding would walk. The page re-takes it whenever the recipe was moved by anything but
 * the hold, and whenever a new frame changes `nu`.
 */
export function anchor(shade, nu) {
  return { nu, colour: colourAt(nu, shade) };
}

/**
 * `next` — a recipe whose Lambda, Period or knee just moved — with Phase re-solved so that
 * the colour `held` names is still where it was. The rest is returned as it came.
 */
export function resolve(next, held) {
  const { nu } = held;
  const g = compress(nu, next.lambda, next.knee ?? null);
  const phase = places(wrap(held.colour - g / next.period), PHASE_PLACES);
  return { ...next, phase: phase >= 1 ? 0 : phase };
}

function places(value, count) {
  return Number(value.toFixed(count));
}
