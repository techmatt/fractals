// A mode's parameter controls, without the DOM around them.
//
// Every parameter `permalink.js`'s `MODE_PARAMETERS` names is a slider and a number box,
// the same widget as the shade row's Gamma, Cycles and Phase. This module is what each
// one is — its word, its step, and where its slider travels — and the two functions that
// move a value between the slider and the box. `explorer.js` builds the boxes and wires
// the events; `permalink.test.mjs` holds the mappings to themselves.
//
// **The slider bounds the control, never the value.** A seat, an atlas mark or a link may
// carry any number the contract accepts, and it opens and draws exactly as recorded: the
// box shows the true value and the slider parks at the end nearest it. Nothing here is
// ever written back into a view on load. What a value may be is the contract's to say.
//
// **The ranges are Matt's** *(explorer_controls_ckpt129, 2026-09-17)*, with the ones his
// list left open chosen here and said beside them:
//
// - `density` — whole stripes, 1 to 10. The catalog's 6 sits right of centre.
// - `sigma` — the threads kernel, 0.05 to 10 in two log segments that meet at 0.15, the
//   catalog's own width, at the middle of the travel: 0.05→0.15 on the left half and
//   0.15→10 on the right. The kernel is `exp(−d² / σ²)`, so the left half is where the
//   threads sharpen and the right is where they go to haze.
// - `weight` — the texture, 0 to 1, which is the contract's and the engine's whole range.
// - `shift` — the itinerary's shift, 0 to 1: a distance along the gradient, and 1 is the
//   texture's whole spread carried once round it. The catalog's 0.5 sits at the middle.
// - `threshold` — a direct trap's reach, 0.01 to 0.64 on a log scale, whose middle is
//   0.08: the four traps are calibrated between 0.05 and 0.1, and the engine holds the
//   screened cross under 0.08 whatever it is asked for.
// - `opacity` — a direct trap's stroke, 0 to 1, the contract's range. The screened cross
//   is held under 0.15 by the engine, so past that its slider moves nothing.
// - `radius` — a circle or ring trap, 0.25 to 4 on a log scale with the catalog's 1 in the
//   middle. None of the three modes that take it is in the Mode select; a link still opens
//   them, and the parameter has a control like any other.

/**
 * One row per parameter: its word, what it says on hover, the box's step, and the
 * slider. A slider's `scale` is one of:
 *
 * - `linear` — the slider holds the number itself, between `min` and `max` at `step`;
 * - `log` — the slider holds a fraction of the travel, and the number is geometric
 *   between `min` and `max`, so the middle of the travel is their geometric mean;
 * - `split` — two `log` halves meeting at `mid`, for a range whose interesting end is
 *   much shorter than its other one.
 *
 * `live` says whether the picture follows the slider as it moves or waits for the hand
 * to let go. Only the texture weight is live: it mixes two fields already computed, so
 * a moved weight is a recolour. Every other parameter is part of the field or of a
 * trap's painting and is a re-iteration, so a drag would start one per pixel of travel.
 */
export const CONTROLS = {
  density: {
    label: "Stripe density",
    tip: "How many stripes wrap around each band: higher is finer.",
    step: 1,
    slider: { scale: "linear", min: 1, max: 10, step: 1 },
  },
  radius: {
    label: "Trap radius",
    tip: "The size of the shape the orbit is measured against.",
    step: 0.1,
    slider: { scale: "log", min: 0.25, max: 4 },
  },
  sigma: {
    label: "Kernel width",
    tip: "How soft the threads are: higher is broader and smoother.",
    step: 0.05,
    slider: { scale: "split", min: 0.05, mid: 0.15, max: 10 },
  },
  weight: {
    label: "Texture",
    tip: "How strongly the detail layer shows over the smooth base: 0 is the base alone.",
    step: 0.05,
    slider: { scale: "linear", min: 0, max: 1, step: 0.01 },
    live: true,
  },
  shift: {
    label: "Shift",
    tip: "How far each region's colors are moved along the palette.",
    step: 0.1,
    slider: { scale: "linear", min: 0, max: 1, step: 0.01 },
  },
  threshold: {
    label: "Threshold",
    tip: "How close the orbit must come before it paints.",
    step: 0.01,
    slider: { scale: "log", min: 0.01, max: 0.64 },
  },
  opacity: {
    label: "Opacity",
    tip: "How strongly each painted stroke covers what is under it.",
    step: 0.05,
    slider: { scale: "linear", min: 0, max: 1, step: 0.01 },
  },
};

/** How finely a `log` or `split` slider travels, as a share of its whole length. */
export const FRACTION_STEP = 0.005;

/** The `min`, `max` and `step` an `<input type=range>` is given for a parameter. */
export function travel(key) {
  const { slider } = CONTROLS[key];
  return slider.scale === "linear"
    ? { min: slider.min, max: slider.max, step: slider.step }
    : { min: 0, max: 1, step: FRACTION_STEP };
}

/** Where on a geometric span a value sits, as a fraction of it: unclamped. */
function logFraction(value, low, high) {
  return Math.log(value / low) / Math.log(high / low);
}

/**
 * Where the slider sits for a value — clamped to the travel, which is the one thing this
 * does to a value and the only place it does it. A value at or under nothing on a
 * logarithmic slider parks at its left end.
 */
export function sliderAt(key, value) {
  const { slider } = CONTROLS[key];
  const clamp = (at, low, high) => Math.min(high, Math.max(low, at));
  if (slider.scale === "linear") return clamp(value, slider.min, slider.max);
  if (!(value > 0)) return 0;
  if (slider.scale === "log") return clamp(logFraction(value, slider.min, slider.max), 0, 1);
  const half =
    value <= slider.mid
      ? logFraction(value, slider.min, slider.mid) / 2
      : 0.5 + logFraction(value, slider.mid, slider.max) / 2;
  return clamp(half, 0, 1);
}

/**
 * The text a slider position writes into its parameter, which is what a link will carry.
 *
 * A linear slider writes its own position, which is already a clean decimal at its step.
 * A geometric one writes three significant figures: one step is a two-hundredth of the
 * travel, between one and a half and four percent of the value, so a fourth figure is
 * precision the hand did not ask for; and the middle of a `split` slider writes exactly
 * its `mid`.
 */
export function sliderText(key, position) {
  const { slider } = CONTROLS[key];
  const at = Number(position);
  if (slider.scale === "linear") return String(at);
  let value;
  if (slider.scale === "log") {
    value = slider.min * (slider.max / slider.min) ** at;
  } else if (at <= 0.5) {
    value = slider.min * (slider.mid / slider.min) ** (at * 2);
  } else {
    value = slider.mid * (slider.max / slider.mid) ** ((at - 0.5) * 2);
  }
  return String(Number(value.toPrecision(3)));
}
