// The custom (experimental) render mode's controls, and its picture.
//
// The mode select's last entry. Choosing it shows a second select of the published custom
// modes by their public names, Matched palette and Auto tone, the mode's knobs as sliders
// with a reset, and one button per example location. Everything here writes `view.custom`
// (`permalink.js`'s `CUSTOM_KEY` has its link keys) and asks the page to draw; the picture
// itself is `style.js`'s pool, three steps on several workers. The page hands in what it
// owns through `host`, so this file holds no view of its own.

import { encode } from "./permalink.js";
import {
  Cancelled,
  StylePool,
  colormapOf,
  exampleQuery,
  freshCustom,
  modesOf,
  offeredExamples,
  requestOf,
  roundEven,
  wholeKnob,
  SUPERSAMPLE,
} from "./style.js";

/** The mode select's value for this mode. Never a name in `permalink.js`'s `MODES`, which
 *  the Walk tab's roster and the gallery's facets are built from: a custom mode is in
 *  neither. */
export const CUSTOM_OPTION = "custom";
export const CUSTOM_LABEL = "custom (experimental)";

/** Where the module and the record are, beside the page. */
const MODULE = new URL("./style.wasm", import.meta.url);

/** How a knob's number box rounds what it shows: enough digits for its range's step. */
function stepOf(knob) {
  if (wholeKnob(knob)) return 1;
  const span = knob.range[1] - knob.range[0];
  return span >= 20 ? 1 : span >= 2 ? 0.1 : span >= 0.2 ? 0.01 : 0.001;
}

/** The finest a knob is set: a whole-number knob by one, any other by a tenth of its box's
 *  step, which is the slider's step too. The box shows this many digits and a typed value is
 *  rounded to it, so the box, the slider and the link say one number (004_bug_hunt: Light
 *  direction typed as 45.5 showed 46, and drew and linked 45.5). */
function finestOf(knob) {
  return wholeKnob(knob) ? 1 : stepOf(knob) / 10;
}

function digitsOf(step) {
  return Math.max(0, -Math.floor(Math.log10(step) + 1e-9));
}

function shown(value, step) {
  return Number(value.toFixed(digitsOf(step))).toString();
}

/**
 * Install the controls. `host` is the page:
 *
 *   view(), setCustom(custom|null, {draw}), openLink(query), locked(), busy(), palette(),
 *   say(text), stopsOf(name), elements: {bar, picker, matched, autotone, reset, knobs,
 *   examples, note}
 */
export function install(bundle, host) {
  const modes = modesOf(bundle);
  const { picker, matched, autotone, reset, knobs, examples, note, bar } = host.elements;
  let pool = null;
  let starting = null;

  for (const mode of bundle.modes) {
    const option = document.createElement("option");
    option.value = mode.name;
    option.textContent = mode.name;
    option.title = mode.what;
    picker.append(option);
  }

  function current() {
    return host.view().custom ?? null;
  }

  function modeOf(custom = current()) {
    return custom ? modes.get(custom.name) : null;
  }

  function write(changes) {
    const custom = current();
    if (!custom || host.locked()) return;
    host.setCustom({ ...custom, ...changes });
  }

  picker.addEventListener("change", () => {
    if (host.locked()) return;
    const custom = current();
    // A new mode opens at its own defaults; the palette setting is the reader's and stays.
    host.setCustom({ ...freshCustom(picker.value), matched: custom?.matched ?? true });
  });
  matched.addEventListener("change", () => write({ matched: matched.checked }));
  autotone.addEventListener("change", () => write({ autotone: autotone.checked }));
  reset.addEventListener("click", () => write({ knobs: {} }));

  function setKnob(knob, value) {
    const custom = current();
    if (!custom || host.locked() || inert(knob, custom)) return sync();
    if (!Number.isFinite(value)) return sync();
    // A whole-number knob holds the number the module draws (it rounds half to even), so
    // the box, the slider and the link never say 5 of a picture drawn with 4.
    const rounded = wholeKnob(knob) ? roundEven(value) : Number(value.toFixed(digitsOf(finestOf(knob))));
    const clamped = Math.min(knob.range[1], Math.max(knob.range[0], rounded));
    const next = { ...custom.knobs };
    if (clamped === knob.default) delete next[knob.name];
    else next[knob.name] = clamped;
    host.setCustom({ ...custom, knobs: next });
  }

  /** Whether a knob writes only the tone pass while Auto tone has dropped it from the
   *  stack: the module then writes nothing, so moving it redrew the same picture. */
  function inert(knob, custom) {
    return custom.autotone === false && knob.set.every((target) => (typeof target === "string" ? target : target.path).startsWith("/tone/"));
  }

  /** The knob sliders and the example buttons, rebuilt when the mode changes. */
  let built = null;
  function build(mode) {
    built = mode.name;
    knobs.replaceChildren();
    for (const knob of mode.knobs) {
      const step = stepOf(knob);
      const group = document.createElement("span");
      group.className = "group";
      group.title = knob.what;
      const label = document.createElement("label");
      label.textContent = knob.label;
      label.htmlFor = `knob-${knob.name}`;
      const slider = document.createElement("input");
      slider.type = "range";
      slider.className = "slider";
      slider.min = String(knob.range[0]);
      slider.max = String(knob.range[1]);
      slider.step = String(step === 1 && wholeKnob(knob) ? 1 : step / 10);
      slider.dataset.knob = knob.name;
      slider.setAttribute("aria-label", knob.label);
      // A knob re-iterates the whole frame, so it draws when the hand lets go.
      slider.addEventListener("change", () => setKnob(knob, Number(slider.value)));
      slider.addEventListener("input", () => {
        box.value = shown(Number(slider.value), finestOf(knob));
      });
      const box = document.createElement("input");
      box.type = "number";
      box.className = "param";
      box.id = `knob-${knob.name}`;
      box.min = String(knob.range[0]);
      box.max = String(knob.range[1]);
      box.step = String(step);
      box.dataset.knob = knob.name;
      // An emptied or unreadable box is no setting, not zero (`Number("")` is 0, which
      // clamped every knob to its minimum and redrew).
      box.addEventListener("change", () => setKnob(knob, box.value.trim() === "" ? NaN : Number(box.value)));
      group.append(label, slider, box);
      knobs.append(group);
    }
    examples.replaceChildren();
    const lead = document.createElement("span");
    lead.className = "custom-lead";
    lead.textContent = "Examples";
    examples.append(lead);
    for (const [number, { index, shown: place, reached }] of offeredExamples(mode, encode).entries()) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = String(number + 1);
      // A keep drawn with settings the published mode no longer reaches opens at the
      // published ones, and says so on hover (docs/custom-modes.md, Problems 2).
      button.title = reached
        ? place.caption
        : `${place.caption}: drawn with the published settings; the keep used an earlier version of this mode.`;
      button.setAttribute("aria-label", `Example ${number + 1}: ${button.title}`);
      button.dataset.reached = String(reached);
      // The keep's own number in the bundle's `shown`, which the harnesses address it by.
      button.dataset.example = String(index);
      button.addEventListener("click", () => {
        if (host.locked()) return;
        host.openLink(exampleQuery(mode, place, { palette: host.view().palette, encode }));
      });
      examples.append(button);
    }
  }

  /** Every control here, set from the view. */
  function sync() {
    const custom = current();
    bar.hidden = knobs.hidden = examples.hidden = custom === null;
    note.textContent = "";
    if (custom === null) return;
    const mode = modeOf(custom);
    if (built !== mode.name) build(mode);
    picker.value = mode.name;
    matched.checked = custom.matched !== false;
    autotone.checked = custom.autotone !== false;
    const busy = host.busy();
    for (const control of [picker, matched, autotone, reset]) control.disabled = busy;
    reset.disabled = busy || Object.keys(custom.knobs).length === 0;
    for (const knob of mode.knobs) {
      const value = custom.knobs[knob.name] ?? knob.default;
      // The place's own projection is laid over the knobs (`styles.projected`), so a knob
      // writing a member the place sets does nothing here.
      const placed = Object.keys(custom.projection ?? {}).find((member) =>
        knob.set.some((target) => (typeof target === "string" ? target : target.path).endsWith(`/${member}`) && (typeof target === "string" ? target : target.path).startsWith("/projection/")),
      );
      const untoned = inert(knob, custom);
      for (const control of knobs.querySelectorAll(`[data-knob="${knob.name}"]`)) {
        control.value = control.type === "range" ? String(value) : shown(value, finestOf(knob));
        control.disabled = busy || placed !== undefined || untoned;
        control.closest(".group").title = placed
          ? `This place sets its own ${placed}, so ${knob.label} does nothing here.`
          : untoned
            ? `${knob.label} sets the tone pass, so it does nothing while Auto tone is off.`
            : knob.what;
      }
    }
    for (const button of examples.querySelectorAll("button")) button.disabled = busy;
    note.textContent =
      "Experimental: drawn by the wallpaper project's own compositor, a quick preview first; " +
      "the slowest modes take a minute or more to finish.";
  }

  /** The pool, started the first time a custom mode draws. */
  async function started() {
    if (pool) return pool;
    if (starting === null) {
      // A start the reader left before it landed (`release`) must not install itself.
      const mine = StylePool.start(MODULE).then((made) => {
        if (starting !== mine) {
          made.stop();
          throw new Cancelled();
        }
        pool = made;
        return made;
      });
      starting = mine;
    }
    const waiting = starting;
    try {
      return await waiting;
    } catch (error) {
      if (starting === waiting) starting = null;
      throw error;
    }
  }

  /** The request for the view at `width × height`. */
  function request(view, width, height, maxiter, supersample = SUPERSAMPLE) {
    const custom = view.custom;
    return requestOf({
      bundle,
      mode: modeOf(custom),
      custom,
      view,
      maxiter,
      stopsOf: host.stopsOf,
      width,
      height,
      supersample,
    });
  }

  /** The map the palette strip shows under Matched palette: the mode's own. */
  function stripMap() {
    const custom = current();
    if (!custom) return null;
    const mode = modeOf(custom);
    return { name: mode.palette, shown: `${mode.name}'s own map`, map: colormapOf(bundle, mode, custom) };
  }

  return {
    modes,
    sync,
    request,
    started,
    stripMap,
    modeOf,
    cancel: () => pool?.cancel(),
    // Every worker replaced, so none keeps the memory a download grew it to.
    recycle: () => pool?.recycle(),
    stop: () => pool?.stop(),
    /** Give the pool back: the reader has left the custom modes, and each worker would
     *  otherwise hold its last frame's memory (hundreds of megabytes) until the page goes.
     *  The compiled module is kept, so coming back costs milliseconds. */
    release: () => {
      if (!pool && !starting) return;
      const leaving = pool;
      pool = null;
      // A start still in flight sees `starting` moved and stops what it made.
      starting = null;
      leaving?.stop();
    },
    workers: () => pool?.size ?? null,
  };
}
