// The shade recipe's controls, without the DOM around them.
//
// The seven keys of the engine's palette recipe were link-only for two drafts: a
// figure's link could set them and the page gave a reader no way to. This module is
// what a control *is*, apart from what it looks like — which widget each key takes,
// what it is called in front of a reader, and the two functions that move a value
// between a control and the recipe.
//
// **A control's value and a link's spelling of it are the same string.** That is the
// whole design. A number box holds `0.75` and the link says `gamma=0.75`; a menu holds
// `soft_knee` beside a box holding `0.35` and the link says `rolloff=soft_knee:0.35`.
// So every control writes what a link would write and reads it back through
// `permalink.js`'s own reader — the bounds, the refusals and the sentences a reader is
// shown are the contract's, and there is no second opinion about what a value means.
//
// Nothing here touches the document. `explorer.js` builds the boxes and wires the
// events; `permalink.test.mjs` round-trips every key through exactly the functions the
// page calls, which is what makes "the control shows what the link says" a tested
// property rather than a hopeful one.

import { SHADE_KEYS, defaultShade, shadeKey } from "./permalink.js";
import * as travel from "./period-range.js";

/**
 * How each key's box steps, and where a tagged kind opens.
 *
 * **What a control is called is not here**, because it is the key's own word with a
 * capital on it. Every other control on the page is named for what it does; these are
 * named for what the link says, so a reader who has just read `rolloff=aces` in the
 * address bar finds Rolloff on the page and not Highlights. A step is a sensible nudge
 * and is no kind of bound — a value out of range is refused by the contract and refused
 * again by the engine, exactly as with a mode's parameters.
 *
 * `opening` is the one number here that needs saying out loud. A tagged kind that takes
 * a parameter has **no default** — the contract refuses `transfer=edge` without its
 * weight, because a kind that needs one is incomplete without one — so a menu that
 * offers `edge` has to open it somewhere. These are the wallpaper project's own values,
 * counted off its records: of the 1,334 renders that ask for the edge transfer the
 * weights are 0.25, 0.5, 1 and 2, and every one of the 274 that ask for a soft knee
 * asks for 0.35. A reader moves it the moment they have it.
 *
 * `offered: false` keeps a key off the page and nowhere else. It is still read from a
 * link, still handed to the engine and still written by Copy link; what goes is the
 * control. **Rolloff is the one**, counted off the published gallery record the studio's
 * left panel is built from: all 1,000 seated recipes leave it at `none`, so the knob
 * turned nothing any picture there was made with. Transfer stays, because four of the
 * thousand ask for the edge transfer (weights 0.25, 1 and 2) and the rest for `value`:
 * four distinct values. `min` and `max` bound a slider's travel and nothing else — phase
 * wraps modulo one in the engine, so its slider covers every picture there is.
 *
 * **Gamma's slider travels in powers of two**, from 1/4 to 4 with 1 in the middle, so a
 * step toward 2 and a step toward 1/2 are the same size of change and a reader's hand
 * lands back on 1. The range is counted off the same record: 985 of the thousand seats
 * leave gamma at 1, and the other fifteen run from 0.383 to 2.04 — a log₂ of −1.38 to
 * 1.03 — so ±2 holds every one of them with room past both ends. The box beside it takes
 * any positive number, and a value past the travel parks the slider at its end.
 *
 * **Cycles' slider runs 1 to 4 in whole steps**, the box's own step, because a whole
 * number of cycles is what a reader picks; the box still takes a typed value past 4, or
 * between two whole ones, and the slider parks at the nearest place it has.
 *
 * **Scale is the switch, and `under` is what it swaps** *(palette_modes_ckpt143)*. A key
 * with `under` is shown only while the recipe's scale is one of those it names, the way
 * the Render mode select swaps the mode's own parameters: gamma, cycles and transfer
 * reshape the `[0, 1]` a leveled stretch produces, and absolute produces none, so under
 * absolute they are hidden rather than shown doing nothing — and kept, so switching back
 * finds them where they were. Period is absolute's alone. Lambda and phase are both
 * scales'.
 *
 * **Lambda's slider is linear over its whole range**, 0 to 1, because that range is the
 * contract's bound and both ends are the named cases: 1 the field as it is, 0 its log.
 * **Period's travels in cycles across the frame** *(period_slider_ckpt155)*, and its ends are
 * the frame's own: one cycle across the frame's spread at the left, the aliasing limit at the
 * right, log in between (`period-range.js` measures both). So its `range` is handed in by the
 * page rather than written here, and `sliderAt` and `sliderText` take it. It was a decade
 * slider from 10⁻³ to 10⁵ until then, and on any one frame most of that was a flat colour or
 * noise. The box still takes any positive period, and the link still carries the period.
 *
 * **Both were kept as they were when Hold look arrived** *(palette_hold_ckpt145)*, and the
 * reason is measured rather than argued. Unheld, one 0.01 step of Lambda moves the average
 * pixel of the deep zoom's target 0.17 to 0.30 of a turn — a quarter of a turn is what two
 * unrelated pictures differ by — and no scale on the slider cures that, because the jump is
 * the whole palette sliding at a deep `ν`. Held (`hold.js`), the same step moves it 0.003 to
 * 0.005 of a turn there and 0.010 to 0.024 on a shallow frame: small and visible, which is
 * what a linear 0 to 1 at one step a pixel of the 8rem slider gives.
 *
 * **Straighten iter is the one control not named for its key** *(Matt, explorer_knee_ckpt157)*.
 * The link says `knee=5000`, and a reader meets a box of that name beside Rolloff's knee,
 * which is a different thing; the brief named it for what it does to the iteration count, so
 * `label` says so here and the key keeps its engine name in the link. It is a tick box and
 * the knee's number beside it: unticked is off, no `knee` in the link, and ticking it opens
 * the knee at `STRAIGHTEN.knee`. Absolute's alone, like Period.
 */
const PRESENTATION = {
  gamma: { step: 0.05, slider: { min: -2, max: 2, step: 0.02, scale: "log" }, under: ["leveled"] },
  cycles: { step: 1, slider: { min: 1, max: 4, step: 1, scale: "linear" }, under: ["leveled"] },
  phase: { step: 0.005, slider: { min: 0, max: 1, scale: "wrap" } },
  reverse: {},
  mirror: {},
  transfer: { step: 0.25, opening: { edge: "0.5" }, under: ["leveled"] },
  rolloff: { step: 0.05, opening: { soft_knee: "0.35" }, offered: false },
  scale: {},
  lambda: { step: 0.05, slider: { min: 0, max: 1, step: 0.01, scale: "linear" } },
  period: {
    step: "any",
    slider: { min: 0, max: travel.STEPS, step: 1, scale: "cycles" },
    under: ["absolute"],
  },
  knee: { step: "any", label: "Straighten iter", under: ["absolute"] },
};

/**
 * **What Straighten iter opens at, and the Lambda that goes with it** *(Matt,
 * explorer_knee_ckpt157)*: the knee and the `λ` the explorer writes wherever it puts a view
 * on the absolute scale itself — the switch from Leveled, a New coloring from Leveled, and the
 * Deep tab's arrival from the viewer. A link that names no knee is never given one.
 *
 * The knee is the brief's 5000. The two are a pair, because at `λ = 1` the knee does nothing
 * and the `λ` is all of what it does below the knee. **0.1, not julia3's 0.157**: on a fresh
 * fit every `λ` from 0 to 0.157 draws the same picture, shallow home views to deep minibrots,
 * and what tells them apart is a recipe fitted shallow and then held while zooming, which is
 * what the knee is for. Fitted on julia3 at w 1.7e-2 and held to its final frame, 0.1 runs
 * 7.7 turns across the stretch, the fit's own 7; 0.157 runs 9.6, and 0.25 13.7.
 * `explorer/README.md`'s *Straighten iter* has the contact sheet and the table.
 */
export const STRAIGHTEN = { knee: 5000, lambda: 0.1 };

/** `recipe` with Straighten iter on at its defaults — the knee and its `λ` together. */
export function straightened(recipe) {
  return { ...recipe, knee: STRAIGHTEN.knee, lambda: STRAIGHTEN.lambda };
}

/**
 * One row per shade key, in the contract's own order: the widget, its words, and for a
 * tagged key the menu of kinds and which of them carries a number.
 *
 * Derived from `SHADE_KEYS` and never typed alongside it, so the page cannot come to
 * offer a set of knobs the contract does not have. A key added to the recipe and not
 * given a row above fails loudly at load rather than quietly going missing from the
 * strip, which is the failure nobody would notice.
 */
export const CONTROLS = SHADE_KEYS.map((spec) => {
  const shown = PRESENTATION[spec.key];
  if (shown === undefined) throw new Error(`no control for the shade key ${spec.key}`);
  return {
    key: spec.key,
    control: spec.control,
    label: shown.label ?? spec.key[0].toUpperCase() + spec.key.slice(1),
    step: shown.step,
    slider: shown.slider ?? null,
    offered: shown.offered ?? true,
    under: shown.under ?? null,
    choices: spec.control === "choice" ? Object.keys(spec.table) : null,
    kinds:
      spec.table === undefined || spec.control !== "tagged"
        ? null
        : Object.entries(spec.table).map(([kind, held]) => ({
            kind,
            parameter: held.parameter ?? null,
            opening: shown.opening?.[kind] ?? null,
          })),
  };
});

/**
 * The text a link would carry for one key of a recipe, right now.
 *
 * This is what a control displays, and it is the contract's own writer rather than a
 * second formatting of the same number: a recipe that came in from a link and one the
 * reader typed show the same string for the same value.
 */
export function spelling(shade, key) {
  return shadeKey(key).write(shade[key]);
}

/**
 * A recipe with one key set from the text its control says.
 *
 * Throws the contract's own `PermalinkError`, with the sentence a refused link would
 * be shown — so a box typed out of range and a link written out of range say the same
 * thing, and the page never has to phrase a refusal of its own.
 */
export function withKey(shade, key, text) {
  const spec = shadeKey(key);
  // A key whose default is no value at all — the knee — is turned off by an empty box, which
  // is what its control spells off as. Every other key refuses an empty box, as a link does.
  if (spec.fallback === null && text === "") return { ...shade, [key]: null };
  return { ...shade, [key]: spec.read(text) };
}

/**
 * Where a slider sits for the text its key's box holds.
 *
 * A `wrap` slider is phase's: the engine takes phase modulo one, so a link's 1.25 sits
 * where 0.25 does and the box keeps the number the link said. A `log` slider is gamma's,
 * and holds the power of two. A `linear` slider is cycles', and holds the number itself.
 * A `cycles` slider is period's, and sits on `range`, the frame's travel (`period-range.js`),
 * or on its fallback where the page has no frame to hand it. Each parks a value past its
 * travel at the end it passed.
 */
export function sliderAt(control, text, range = travel.FALLBACK) {
  const value = Number(text);
  const { min, max, scale } = control.slider;
  if (scale === "wrap") return ((value % 1) + 1) % 1;
  if (scale === "cycles") return travel.positionOf(range ?? travel.FALLBACK, value);
  const position = scale === "log" ? Math.log2(value) : value;
  return Math.min(max, Math.max(min, position));
}

/**
 * The text a slider position writes into its key, which is what a link would carry.
 *
 * A `log` position is written at three significant figures: a slider step is about one
 * and a half percent, so a fourth figure would be precision the hand did not ask for,
 * and the middle of the travel writes exactly `1`. A `cycles` position is written as the
 * period it stands for on `range`.
 */
export function sliderText(control, position, range = travel.FALLBACK) {
  const value = Number(position);
  if (control.slider.scale === "log") return String(Number((2 ** value).toPrecision(3)));
  if (control.slider.scale === "cycles") {
    return String(travel.periodAt(range ?? travel.FALLBACK, value));
  }
  return String(value);
}

/** Whether a key's control is shown under the scale this recipe is at. A key with no
 *  `under` is shown under both; the others are shown under the scales they name. */
export function shownUnder(control, shade) {
  return control.under === null || control.under.includes(shade.scale);
}

/** Whether a key is at the engine's own default — what a link that omits it means. */
export function isDefault(shade, key) {
  const spec = shadeKey(key);
  return spec.same(shade[key], spec.fallback);
}

/** Which keys are set away from the engine's defaults, in contract order.
 *
 *  What the page counts to decide whether a recipe is worth showing a reader unfolded:
 *  a link that set three keys should not hide them behind a closed group. */
export function chosen(shade) {
  return SHADE_KEYS.map((spec) => spec.key).filter((key) => !isDefault(shade, key));
}

/** The recipe as the engine ships it, for the control that puts everything back. */
export { defaultShade };

/** A tagged value's two halves, as its control holds them: the kind, and the text of
 *  its parameter where it has one. */
export function parts(text) {
  const colon = text.indexOf(":");
  return colon === -1
    ? { kind: text, value: "" }
    : { kind: text.slice(0, colon), value: text.slice(colon + 1) };
}

/** The two halves back into the one string a link carries. */
export function spell(kind, value) {
  return value === "" ? kind : `${kind}:${value}`;
}
