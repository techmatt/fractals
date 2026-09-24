// Hold look: what the absolute scale's Lambda and Period do while the box beside them is
// ticked. Pure, like `shade.js`: no document, no module, and one test file.
//
// **The picture under the absolute scale is `frac(T(ν)/period + phase)`**, with `T` the
// Box–Cox compression `(ν^λ − 1)/λ` (`ln ν` at `λ = 0`) and `ν` floored where the engine
// floors it — `Palette::place_absolute` in the engine's `coloring.rs`. Nothing here changes
// that, or what a link says: a held move is a move of more than one key, written into the
// same keys a link has always carried.
//
// Two things are held at one value of the field, the reference `ν_m`, the median escaped
// value of the frame on the screen:
//
// - **the band density there**, `T′(ν_m)/period = ν_m^(λ−1)/period` turns per unit of `ν`;
// - **the colour there**, `frac(T(ν_m)/period + phase)`.
//
// A move of Lambda re-solves Period for the first and Phase for the second; a move of Period
// re-solves Phase alone; Phase is free. Both solves are exact in closed form — the density
// is `ν_m^(λ−1)/period`, so the new period is `period · ν_m^(λ′−λ)` — and what they give up
// is only the rounding the written numbers take (`PERIOD_FIGURES`, `PHASE_PLACES`). Away from
// `ν_m` the picture moves as much as the new λ bends the field against the old one, which is
// what a held Lambda is for.

/** The smallest value the engine reads a field value as: `f32::MIN_POSITIVE`, which is
 *  `COMPRESSION_FLOOR` in the engine's `coloring.rs`. */
export const FLOOR = 2 ** -126;

/** How many samples the median is taken over, at most. A frame is millions of samples and
 *  the median of an even stride through a quarter of a million is the frame's to well
 *  inside a band; the stride is a fixed function of the field, so a frame always answers
 *  the same. */
export const REFERENCE_SAMPLES = 1 << 18;

/** A held period is written at four significant figures: the density it holds is then
 *  right to a part in ten thousand, and a link does not carry seventeen digits of solve. */
export const PERIOD_FIGURES = 4;

/** A held phase is written at four places, a ten-thousandth of a turn. It is solved after
 *  the period is rounded, so the colour at `ν_m` is held to that and not to the period's
 *  rounding as well. */
export const PHASE_PLACES = 4;

/** The engine's compression of one value, in `f64`. */
export function compress(nu, lambda) {
  const value = Math.max(nu, FLOOR);
  return lambda === 0 ? Math.log(value) : (value ** lambda - 1) / lambda;
}

/** Turns per unit of `ν` at `nu`: the band density a recipe lays there. */
export function density(nu, lambda, period) {
  return Math.max(nu, FLOOR) ** (lambda - 1) / period;
}

/** Where in the gradient `nu` lands, in `[0, 1)`. */
export function colourAt(nu, { lambda, period, phase }) {
  return wrap(compress(nu, lambda) / period + phase);
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
 * What a hold keeps, measured off a recipe at `nu`: `{ nu, density, colour }`.
 *
 * Taken once when a hold starts and kept while it lasts, rather than re-measured off each
 * written recipe: the written numbers are rounded, and a drag re-measured off its own
 * rounding would walk. The page re-takes it whenever the recipe was moved by anything but
 * the hold, and whenever a new frame changes `nu`.
 */
export function anchor(shade, nu) {
  return {
    nu,
    density: density(nu, shade.lambda, shade.period),
    colour: colourAt(nu, shade),
  };
}

/**
 * `next` — a recipe with `key` just moved to what its control says — with the other keys
 * re-solved so that `held` still holds. Lambda re-solves Period and Phase; Period re-solves
 * Phase; any other key is returned as it came.
 */
export function resolve(next, key, held) {
  if (key !== "lambda" && key !== "period") return next;
  const { nu } = held;
  const period =
    key === "lambda"
      ? figures(Math.max(nu, FLOOR) ** (next.lambda - 1) / held.density, PERIOD_FIGURES)
      : next.period;
  const phase = places(wrap(held.colour - compress(nu, next.lambda) / period), PHASE_PLACES);
  return { ...next, period, phase: phase >= 1 ? 0 : phase };
}

function figures(value, count) {
  return Number(value.toPrecision(count));
}

function places(value, count) {
  return Number(value.toFixed(count));
}
