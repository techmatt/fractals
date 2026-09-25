// Fit: the absolute scale's Lambda, Period and Phase, sized to the frame on the screen.
// Pure, like `hold.js` beside it: no document, no module, and one test file.
//
// **The absolute scale sizes nothing to the frame** — `frac(T(ν)/period + phase)`, with `T`
// the engine's Box–Cox (`hold.compress`) — so a recipe that suits one frame is noise or one
// flat colour on another: at a deep `ν` of eighty-five thousand, `period=1` cycles the
// palette every iteration. Leveled is the frame sizing itself, and a fit is the absolute
// recipe sized off the same stretch Leveled measures — but busier than Leveled, at `PASSES`
// turns of the palette across it where Leveled lays about one.
//
// **Two questions, answered separately.** Which compression — `λ` — is the shape question,
// and it is answered by matching Leveled, below. How many bands — the period — is a taste,
// and it is `PASSES`: the line at the chosen `λ` is scaled so the stretch's two ends, the
// 0.5th and 99.5th percentiles, lie `PASSES` turns apart, and its phase puts the bottom end
// where Leveled puts it, at the recipe's own phase.
//
// **What `λ` matches is where each pixel lands in the gradient, averaged over the pixels.**
// Leveled places a value at `cycles · C(p)^gamma + phase` turns, with `p` its stretched
// position, clamped to `[0, 1]` between the 0.5th and 99.5th percentiles of the compressed
// field (or its rank, under the rank transfer), and `C` the mode's curve. Absolute places it
// at `T_λ(ν)/period + phase′`, which for a fixed `λ` is a straight line in `T_λ(ν)`. So for
// each `λ` on a grid the line is fitted by least squares to Leveled's turn at every quantile
// of the frame's exterior samples — equal ranks, so every pixel counts once — and the
// smallest `λ` whose line misses by little more than the best one's is chosen
// (`LAMBDA_SLACK` says why the smallest). Inside the stretch a line at Leveled's own
// compression is exact; what a line cannot follow is the gamma and the curve, and the tails
// Leveled clamps and Absolute does not. A frame's last half percent can run ten times past
// the rest, and a line in `ν` spends turn after turn on it, which is noise along the
// boundary, while a smaller `λ` folds that tail back in.
//
// It cannot be exact, because Leveled is fitted to a frame's ranks and Absolute is not
// fitted to anything; what it gives is Leveled's spread of the palette over roughly the same
// pixels, repeated `PASSES` times, as one recipe that then holds still while the frame moves.

import { FLOOR, PERIOD_FIGURES, PHASE_PLACES, REFERENCE_SAMPLES, compress } from "./hold.js";

/** The engine's stretch: the percentiles of the compressed field that Leveled maps to the
 *  two ends of the gradient — `CLIP_LOW` and `CLIP_HIGH` in the engine's `coloring.rs`. */
export const CLIP_LOW = 0.5;
export const CLIP_HIGH = 99.5;

/**
 * **How many times a fit runs the palette across the stretch** *(Matt, fit_busier_ckpt147)*:
 * the turns between the frame's 0.5th and 99.5th percentiles, whatever Leveled's Cycles.
 * Leveled lays about one, which reads as calm and flat on a deep frame; Matt's hand-tuned
 * deep tiles run 2 to 12. Change this and nothing else to make fits busier or calmer.
 */
export const PASSES = 7;

/** How many quantiles the line is fitted at: equal steps of rank, so the fit weighs every
 *  pixel alike and a frame of any size is the same size of problem. */
export const QUANTILES = 1000;

/** The `λ` a fit may choose, in hundredths: 0 to 1 in steps of 0.05. A fit's `λ` is a
 *  number a reader reads off the slider and could have typed, and a finer step moves the
 *  picture less than the rounding of the period it comes with. */
export const LAMBDA_STEPS = 20;

/**
 * How much worse than the best line, in turns of root-mean-square miss, a smaller `λ` may be
 * and still be chosen over it.
 *
 * **The fit leans toward the log, and that is the absolute scale's own reason.** On the
 * frames it was measured on, every `λ` from 0 to 1 matches Leveled to within a tenth of a
 * turn, and most to within three hundredths, so least squares alone picks `λ` on detail
 * nobody can see. What does differ is what a zoom does next. Zooming in multiplies a frame's
 * escape counts, and under the log a multiplied `ν` is a moved phase and nothing else — the
 * same bands, the same width — while under `λ = 1` it is that many times as many bands. So
 * the fit takes the smallest `λ` that costs no more than this over the best, which is where
 * Matt's hand-tuned deep figures landed (`λ` 0, period about a half) for the same reason.
 */
export const LAMBDA_SLACK = 0.03;

/** Fewer exterior samples than this is not a distribution, and no fit is offered. */
export const MIN_SAMPLES = 64;

/**
 * The modes whose base field Leveled reads through a curve other than the straight line —
 * `trap_circle`'s log, in the engine's `mode.rs`. Every other mode on the page, the
 * composites included, lays out a base that is a linear field, and lane 0 is that base.
 */
const CURVES = new Map([["trap_circle", "log"]]);

function curve(name, p) {
  if (name === "log") return Math.log1p(p) / Math.LN2;
  return p;
}

/**
 * The frame's exterior samples, sorted: lane 0 of the field, a stride through at most
 * `REFERENCE_SAMPLES` of them as `hold.reference` takes, floored where the engine floors.
 * `null` where there is no field.
 */
export function samples(field) {
  if (field === null || field === undefined || !field.values) return null;
  const ss = field.supersample ?? 1;
  const count = Math.min(field.values.length, field.width * ss * field.height * ss);
  const stride = Math.max(1, Math.floor(count / REFERENCE_SAMPLES));
  const taken = [];
  for (let at = 0; at < count; at += stride) {
    const value = field.values[at];
    if (Number.isFinite(value)) taken.push(Math.max(value, FLOOR));
  }
  return Float64Array.from(taken).sort();
}

/** The engine's percentile of sorted values: nearest rank, rounded. */
function percentile(sorted, p) {
  const last = sorted.length - 1;
  return sorted[Math.min(last, Math.round((p / 100) * last))];
}

/**
 * The fitted `{ lambda, period, phase }` for a frame's sorted exterior samples, under the
 * recipe `shade` would draw under Leveled in `mode` — or `null` where the frame has nothing
 * to fit: too few samples, or every one of them the same value.
 *
 * `shade.lambda` is Leveled's own compression, the one the stretch is measured on; gamma,
 * cycles, phase and the transfer are its too. The edge transfer is fitted as the value
 * transfer it remaps, being a reshaping of the same stretch by where the picture moves.
 */
export function fitSorted(sorted, shade, mode = null) {
  if (sorted === null || sorted.length < MIN_SAMPLES) return null;
  if (!(sorted[sorted.length - 1] > sorted[0])) return null;

  const levelLambda = shade.lambda;
  const level = (nu) => (levelLambda === 1 ? nu : compress(nu, levelLambda));
  const low = level(percentile(sorted, CLIP_LOW));
  const high = level(percentile(sorted, CLIP_HIGH));
  const span = high > low ? high - low : null;
  const ranked = shade.transfer?.kind === "rank";
  const shape = CURVES.get(mode) ?? "linear";

  const nus = new Float64Array(QUANTILES);
  const target = new Float64Array(QUANTILES);
  for (let at = 0; at < QUANTILES; at += 1) {
    const rank = (at + 0.5) / QUANTILES;
    const nu = sorted[Math.min(sorted.length - 1, Math.floor(rank * sorted.length))];
    let p;
    if (ranked) p = rank;
    else if (span === null) p = 0;
    else p = Math.min(1, Math.max(0, (level(nu) - low) / span));
    nus[at] = nu;
    target[at] = shade.cycles * curve(shape, p) ** shade.gamma;
  }
  let targetMean = 0;
  for (const turn of target) targetMean += turn;
  targetMean /= QUANTILES;

  const lines = [];
  for (let step = 0; step <= LAMBDA_STEPS; step += 1) {
    const lambda = step / LAMBDA_STEPS;
    const x = nus.map((nu) => compress(nu, lambda));
    let xMean = 0;
    for (const value of x) xMean += value;
    xMean /= QUANTILES;
    let sxx = 0;
    let sxt = 0;
    for (let at = 0; at < QUANTILES; at += 1) {
      sxx += (x[at] - xMean) ** 2;
      sxt += (x[at] - xMean) * (target[at] - targetMean);
    }
    if (!(sxx > 0) || !(sxt > 0)) continue;
    const slope = sxt / sxx;
    let miss = 0;
    for (let at = 0; at < QUANTILES; at += 1) {
      miss += (targetMean + slope * (x[at] - xMean) - target[at]) ** 2;
    }
    lines.push({ lambda, slope, xMean, miss: Math.sqrt(miss / QUANTILES) });
  }
  if (lines.length === 0) return null;
  // The smallest λ that is as good as the best to within `LAMBDA_SLACK` — see there.
  const least = Math.min(...lines.map((line) => line.miss));
  const best = lines.find((line) => line.miss <= least + LAMBDA_SLACK);

  // The line's slope is Leveled's; its period is `PASSES` turns across the stretch. Where
  // the stretch has no width — nearly the whole frame one value — the fitted line's own
  // reach across the quantiles stands in for it.
  const x = (nu) => compress(nu, best.lambda);
  let bottom = x(percentile(sorted, CLIP_LOW));
  let reach = x(percentile(sorted, CLIP_HIGH)) - bottom;
  if (!(reach > 0)) {
    bottom = x(nus[0]);
    reach = x(nus[QUANTILES - 1]) - bottom;
  }
  // Written as a reader would write them, and the phase solved after the period is rounded,
  // so the stretch's bottom lands at the recipe's phase, as Leveled lands it, rather than
  // where the rounding moved it.
  const period = Number((reach / PASSES).toPrecision(PERIOD_FIGURES));
  const turns = shade.phase - bottom / period;
  let phase = Number((turns - Math.floor(turns)).toFixed(PHASE_PLACES));
  if (phase >= 1) phase = 0;
  return { lambda: best.lambda, period, phase, miss: best.miss };
}

/** `fitSorted` over a field as either tab holds it. */
export function fit(field, shade, mode = null) {
  return fitSorted(samples(field), shade, mode);
}
