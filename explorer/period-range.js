// The Period slider's travel, measured off the frame on the screen *(period_slider_ckpt155)*.
// Pure, like `hold.js` and `fit.js` beside it: no document, no module, and one test file.
//
// **What the eye sees under the absolute scale is how far the palette turns from one pixel
// to the next**, which is the per-pixel change of `T_λ(ν)` over `period`. That change runs
// over orders of magnitude between frames — a shallow frame's log field moves a few
// hundredths a pixel, a deep linear one hundreds — so a slider over raw `period`, however
// many decades it spans, spends most of its travel on a flat colour or on noise, and near the
// dense end one pixel of travel is a different picture. Matt's pair: two deep frames at 0.166
// (noise) and 37.2 (smooth) with their thumbs in nearly the same place.
//
// So the slider moves in **palette cycles across the frame**, on a log scale, between two
// ends measured off the frame:
//
// - **the sparse end**, one cycle across the frame's robust spread of `T_λ(ν)`, its
//   `SPREAD_LOW`th to `SPREAD_HIGH`th percentile (New coloring's span, not min to max);
// - **the dense end**, the aliasing limit: the period at which the median change between
//   neighbouring pixels is `DENSE_TURNS` of a turn.
//
// Between them a position is `log(cycles)`, so each step of travel multiplies the number of
// bands by the same factor, which is the nearest thing to a constant perceptual step.
//
// **Only the control moves.** `period` stays in its own units in every link, video and
// contract; this module turns a period into a thumb position and back, and nothing else.

import { FLOOR, PERIOD_FIGURES, compress } from "./hold.js";

/** The robust spread the sparse end is one cycle across: New coloring's percentiles. */
export const SPREAD_LOW = 3;
export const SPREAD_HIGH = 97;

/**
 * **How far the palette turns between neighbouring pixels at the dense end**: a tenth of a
 * turn at the median pair. The brief's first guess was half a turn, the Nyquist line for the
 * median pixel, and on real frames that is well past the edge: the per-pixel change is skewed,
 * so by the time the median pair is half a palette apart most of the rest of the frame is
 * static, and the last two fifths of the travel were noise. Measured against the aliasing
 * guard's own line (`aliasing.THRESHOLD`, where a colouring reads as static) on five deep
 * frames and two shallow ones, the frame crosses it with the median pair 0.07 to 0.12 of a
 * turn apart — so a tenth puts the dense end at the edge of noise, which is what it is for.
 * `explorer/README.md`'s *The Period slider* has the reading.
 */
export const DENSE_TURNS = 0.1;

/**
 * How many samples the spread is read from, and how many lattice points the neighbouring
 * pairs are read at — each point paired with the pixel to its right and the one below it.
 * **Few, because this runs on the main thread** each time a frame's picture lands: at a
 * quarter of a million samples, `hold.reference`'s count, a measure cost 60 to 130 ms; at
 * these it is 12 to 16 ms on a full pass, and the two ends move by 4% at most.
 */
export const SAMPLES = 1 << 15;
export const PAIRS = 1 << 13;

/**
 * The narrowest and widest a travel may be, as the ratio of its two periods. A frame that is
 * already noise at one cycle across it — every pixel beside a copy's boundary — would give a
 * travel with no length, so the sparse end is pushed out to a decade past the dense one; a
 * frame whose neighbours hardly change at all would give one thirty decades long.
 */
export const MIN_RATIO = 10;
export const MAX_RATIO = 1e6;

/** The slider's steps, end to end. Finer than any slider is wide, so the hand is the limit. */
export const STEPS = 1000;

/** The travel where there is no frame to measure — before the first picture, or under a
 *  direct trap, which has no field and on which the absolute scale acts on nothing: the eight
 *  decades the slider ran over before it was measured, dense end on the right. */
export const FALLBACK = { sparse: 1e5, dense: 1e-3 };

/** Fewer exterior pairs or samples than this is not a measurement, and no range is given. */
export const MIN_SAMPLES = 64;

const remembered = new WeakMap();

/**
 * What a frame says about its periods, whatever `λ` they will be read under: the spread's
 * two `ν` percentiles, and the neighbouring pairs' `ν`s. `null` where the field has too
 * little outside the set.
 *
 * `field` is either tab's — `{ values, width, height, supersample }`, lane 0 read as the
 * `width·ss × height·ss` grid, `NaN` inside the set. A pixel is read at its first sample,
 * and its neighbour is the next pixel over, so the pairs are a pixel apart at the field's
 * own size. Memoized on the field's array, so a recolour measures nothing twice.
 */
export function measure(field) {
  if (field === null || field === undefined || !field.values) return null;
  if (remembered.has(field.values)) return remembered.get(field.values);
  const ss = field.supersample ?? 1;
  const across = field.width * ss;
  const count = Math.min(field.values.length, across * field.height * ss);

  const stride = Math.max(1, Math.floor(count / SAMPLES));
  const taken = [];
  for (let at = 0; at < count; at += stride) {
    const value = field.values[at];
    if (Number.isFinite(value)) taken.push(Math.max(value, FLOOR));
  }

  const lattice = Math.max(1, Math.floor(Math.sqrt((field.width * field.height) / PAIRS)));
  const first = [];
  const second = [];
  const at = (column, row) => field.values[row * ss * across + column * ss];
  for (let row = 0; row < field.height; row += lattice) {
    for (let column = 0; column < field.width; column += lattice) {
      const here = at(column, row);
      if (!Number.isFinite(here)) continue;
      for (const [x, y] of [
        [column + 1, row],
        [column, row + 1],
      ]) {
        if (x >= field.width || y >= field.height) continue;
        const there = at(x, y);
        if (!Number.isFinite(there)) continue;
        first.push(Math.max(here, FLOOR));
        second.push(Math.max(there, FLOOR));
      }
    }
  }

  let answer = null;
  if (taken.length >= MIN_SAMPLES && first.length >= MIN_SAMPLES) {
    const sorted = Float64Array.from(taken).sort();
    answer = {
      low: percentile(sorted, SPREAD_LOW),
      high: percentile(sorted, SPREAD_HIGH),
      least: sorted[0],
      most: sorted[sorted.length - 1],
      first: Float64Array.from(first),
      second: Float64Array.from(second),
      width: field.width,
    };
  }
  remembered.set(field.values, answer);
  return answer;
}

/** Nearest rank, as `fit.js` takes it. */
function percentile(sorted, p) {
  const last = sorted.length - 1;
  return sorted[Math.min(last, Math.round((p / 100) * last))];
}

/** The robust spread of `T_λ(ν)`, falling back to the whole range where the percentiles meet,
 *  or `null` where the frame is one value. */
export function spreadOf(measured, lambda) {
  let spread = compress(measured.high, lambda) - compress(measured.low, lambda);
  if (!(spread > 0)) spread = compress(measured.most, lambda) - compress(measured.least, lambda);
  return spread > 0 ? spread : null;
}

/**
 * The median change of `T_λ(ν)` between neighbouring pixels, in pixels of a frame shown
 * `shownWidth` across. A field drawn at a quarter of that width has neighbours four shown
 * pixels apart, so its change is divided by four: the quarter pass and the full pass then
 * measure one frame alike, near enough that the thumb barely moves between them.
 *
 * Where more than half the pairs do not change at all — a mode whose field is flat in
 * places — the median of the ones that do stands in, and `null` where none do.
 */
export function stepOf(measured, lambda, shownWidth = measured.width) {
  const changes = new Float64Array(measured.first.length);
  let moving = 0;
  for (let index = 0; index < changes.length; index += 1) {
    const change = Math.abs(
      compress(measured.first[index], lambda) - compress(measured.second[index], lambda),
    );
    changes[index] = change;
    if (change > 0) moving += 1;
  }
  changes.sort();
  let step = changes[changes.length >> 1];
  if (!(step > 0)) {
    if (moving === 0) return null;
    step = changes[changes.length - moving + (moving >> 1)];
  }
  return (step * measured.width) / Math.max(1, shownWidth);
}

/**
 * The travel for a frame under `λ`: `{ sparse, dense }`, the periods at its two ends, with
 * `sparse > dense` — or `null` where the frame gives no measurement.
 */
export function rangeOf(field, lambda, shownWidth) {
  const measured = measure(field);
  if (measured === null) return null;
  const spread = spreadOf(measured, lambda);
  const step = stepOf(measured, lambda, shownWidth ?? measured.width);
  if (spread === null && step === null) return null;
  let sparse = spread ?? step / DENSE_TURNS * MIN_RATIO;
  let dense = step === null ? sparse / MAX_RATIO : step / DENSE_TURNS;
  if (sparse / dense < MIN_RATIO) sparse = dense * MIN_RATIO;
  if (sparse / dense > MAX_RATIO) dense = sparse / MAX_RATIO;
  return { sparse, dense };
}

/** Where a period sits on a travel, `0` (one cycle) to `STEPS` (the aliasing limit), parked
 *  at the end it passed where it is outside. */
export function positionOf(range, period) {
  const at = (STEPS * Math.log(range.sparse / period)) / Math.log(range.sparse / range.dense);
  if (!Number.isFinite(at)) return 0;
  return Math.min(STEPS, Math.max(0, at));
}

/** The period a position writes, at the four figures a held period is written at: a step is
 *  a fraction of a percent on a typical travel, and three would repeat itself. */
export function periodAt(range, position) {
  const period = range.sparse * (range.dense / range.sparse) ** (Number(position) / STEPS);
  return Number(period.toPrecision(PERIOD_FIGURES));
}

/**
 * **A moved Lambda brings Period with it**, so the number of cycles across the frame's spread
 * holds: `period · spread(λ′) / spread(λ)`, at four figures. `period` where the frame gives
 * no spread to hold.
 */
export function rescaled(field, period, from, to) {
  const measured = measure(field);
  if (measured === null) return period;
  const before = spreadOf(measured, from);
  const after = spreadOf(measured, to);
  if (before === null || after === null) return period;
  return Number(((period * after) / before).toPrecision(PERIOD_FIGURES));
}
