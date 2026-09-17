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
 */
const PRESENTATION = {
  gamma: { step: 0.05, slider: { min: -2, max: 2, step: 0.02, scale: "log" } },
  cycles: { step: 1 },
  phase: { step: 0.005, slider: { min: 0, max: 1, scale: "wrap" } },
  reverse: {},
  mirror: {},
  transfer: { step: 0.25, opening: { edge: "0.5" } },
  rolloff: { step: 0.05, opening: { soft_knee: "0.35" }, offered: false },
};

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
    label: spec.key[0].toUpperCase() + spec.key.slice(1),
    step: shown.step,
    slider: shown.slider ?? null,
    offered: shown.offered ?? true,
    kinds:
      spec.table === undefined
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
  return { ...shade, [key]: shadeKey(key).read(text) };
}

/**
 * Where a slider sits for the text its key's box holds.
 *
 * A `wrap` slider is phase's: the engine takes phase modulo one, so a link's 1.25 sits
 * where 0.25 does and the box keeps the number the link said. A `log` slider is gamma's,
 * and holds the power of two; a value past its travel parks at the end it passed.
 */
export function sliderAt(control, text) {
  const value = Number(text);
  const { min, max, scale } = control.slider;
  if (scale === "wrap") return ((value % 1) + 1) % 1;
  if (scale === "log") return Math.min(max, Math.max(min, Math.log2(value)));
  return value;
}

/**
 * The text a slider position writes into its key, which is what a link would carry.
 *
 * A `log` position is written at three significant figures: a slider step is about one
 * and a half percent, so a fourth figure would be precision the hand did not ask for,
 * and the middle of the travel writes exactly `1`.
 */
export function sliderText(control, position) {
  const value = Number(position);
  if (control.slider.scale === "log") return String(Number((2 ** value).toPrecision(3)));
  return String(value);
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
