// The download: the view on the screen, drawn again at a wallpaper's size.
//
// It is the **same render** the canvas gets — `Renderer.field` over the same pool,
// the same spec, the same iteration cap — with two numbers changed: the output
// resolution, and how many samples each output pixel is made of. There is no
// second render path here, and there deliberately is not one: a download that
// drew the picture its own way would eventually draw a different picture, and
// nobody would know which of the two was the renderer's.
//
// **Supersampling is the engine's, not the canvas's.** At `ss` the frame is
// iterated on a grid `ss` times finer on each axis and reduced by
// `resample::downsample` — Lanczos-3 in linear light, the same filter a finished
// wallpaper is written through — inside wasm. Scaling a canvas would be a box
// filter over gamma-encoded bytes, which is a different picture and a worse one.
// So a 3840x2160 at 2 is what the wallpaper pipeline would have drawn for this
// spec, apart from its shape.
//
// **Shape is not resolution.** A link carries an aspect and never a pixel count,
// and the plane *width* is what a view is: downloading at a different shape keeps
// that width and shows more or less height. The estimate's tooltip says so,
// because a reader who expects a crop would otherwise read the extra sky as a bug.
//
// What is capped and why is `withinLimits` below.

import { shadeApart, specOf } from "./render.js";

/** The offered sizes, and the shape each of them is. */
const PRESETS = [
  { name: "1920 × 1080", width: 1920, height: 1080 },
  { name: "2560 × 1440", width: 2560, height: 1440 },
  { name: "3840 × 2160", width: 3840, height: 2160 },
];

/** The size menu's first entry, which is no fixed size: the canvas's own pixel grid.
 *
 *  It is the default because the screen's pass now ends at two samples a pixel, so at
 *  2× this entry is the picture already on the screen and is saved without being drawn
 *  again. A wallpaper's size is one pick down the same menu. */
const SHOWN = "shown";

/** The default: the picture as shown, at the antialiasing a render sheet uses. */
const DEFAULT_SIZE = SHOWN;
const DEFAULT_PRESET = 1;
const DEFAULT_SUPERSAMPLE = 2;

/** The samples toggle. Two settings: the one-sample picture a quick look wants, and the
 *  two a pixel the screen's own finished pass ends at, which is what a render sheet uses.
 *  Past two the memory ceiling below refuses the two larger presets. */
const SUPERSAMPLES = [1, 2];

/** The most samples one download may iterate.
 *
 *  **This is a memory ceiling and not a patience one.** Colouring a frame holds
 *  the whole of it in one wasm heap at once — the lanes as they arrived, the
 *  field narrowed to `f32`, and then `Vec<[f64; 3]>` of linear-light colour,
 *  which is twenty-four bytes for every *sample* and by far the largest of the
 *  three. That is the engine's own shape and a native render carries it too; what
 *  is different here is that `wasm32` has a four-gigabyte address space and no way
 *  to spill. Sixty million samples is about two and a half gigabytes of that, and
 *  is the largest count measured to complete rather than trap.
 *
 *  It is a cap on SAMPLES and not on pixels, because a supersample costs its
 *  square: 3840x2160 at 2 is thirty-three million and fits, and the same frame at
 *  4 is a hundred and thirty-three million and could not be made to fit by any
 *  amount of waiting. */
const MAX_SAMPLES = 60_000_000;

/** The most output pixels, and the longest side. A canvas is what a PNG is made
 *  on, and every browser caps one — Chrome by area, others lower and by side. Both
 *  of these are far under the lowest cap in circulation. */
const MAX_PIXELS = 33_554_432;
const MAX_SIDE = 8192;
const MIN_SIDE = 16;

/** What a mode costs, as the seconds measured over one 1280x720 frame on one thread —
 *  the `after` column of the per-mode table in `explorer/README.md`, typed. It is typed
 *  and so it goes stale silently: this table was last left behind by a re-measure that
 *  refreshed the README and not it, and every field cost here was about twice what the
 *  module did.
 *
 *  It is a **prior and not a promise**, and only the fallback: it is one machine on one
 *  day, at the mandelbrot home view, and a deep frame iterates more per sample than a
 *  shallow one. The estimate beside the button is scaled from what drawing THIS view on
 *  the screen took, and this table is read only before that pass has finished. A direct
 *  trap has no shade, because its bands arrive painted. */
const FRAME = 1280 * 720;
const COST = {
  smooth: { field: 1.55, shade: 0.044 },
  smooth_trap_circle: { field: 1.71, shade: 0.18 },
  trap_circle: { field: 1.71, shade: 0.188 },
  itinerary: { field: 1.86, shade: 0.397 },
  direct_trap_lines: { field: 3.98, shade: 0 },
  direct_trap_screen: { field: 4.51, shade: 0 },
  direct_trap_multiply: { field: 5.65, shade: 0 },
  tia: { field: 6.77, shade: 0.208 },
  threads: { field: 7.03, shade: 0.091 },
  direct_trap_ring: { field: 7.1, shade: 0 },
  smooth_curvature: { field: 7.32, shade: 0.227 },
  curvature: { field: 7.38, shade: 0.206 },
  gaussian_int: { field: 10.51, shade: 0.232 },
  smooth_angle_min: { field: 10.52, shade: 0.236 },
  smooth_mean_angle: { field: 10.64, shade: 0.263 },
  stripe: { field: 18.55, shade: 0.203 },
  smooth_stripe: { field: 19.05, shade: 0.221 },
};

/** Seconds this download is expected to take, from the prior table. */
export function estimate(mode, samples, workers) {
  const cost = COST[mode];
  if (cost === undefined) return null;
  // The field is spread over the pool; the shade is one worker on one thread,
  // which is why it is a bigger share of the wait than of the work.
  return (cost.field * samples) / FRAME / workers + (cost.shade * samples) / FRAME;
}

/** Seconds this download is expected to take, scaled from a measured pass of the view.
 *
 *  `measured` is `{ samples, field, shade }`, in seconds, from the screen's own finished
 *  pass. Both halves are linear in samples — the field over the same pool, the shade one
 *  pass over the frame — so the ratio of sample counts is the whole of the scaling. */
export function scaled(measured, samples) {
  if (!measured || !(measured.samples > 0)) return null;
  return ((measured.field + measured.shade) * samples) / measured.samples;
}

/** A wait in a few words — `~5 s`, `~40 s`, `~3 min` — and never a pixel count. */
export function saidShort(seconds) {
  if (!Number.isFinite(seconds)) return "";
  if (seconds < 1.5) return "~1 s";
  if (seconds < 10) return `~${Math.round(seconds)} s`;
  if (seconds < 90) return `~${Math.round(seconds / 5) * 5} s`;
  return `~${Math.round(seconds / 60)} min`;
}

export function saidAsCount(samples) {
  return samples < 1e6
    ? `${Math.round(samples / 1e3)} thousand`
    : `${(samples / 1e6).toFixed(1)} million`;
}

/** Whether these dimensions may be asked for, and the reason where they may not. */
export function withinLimits(width, height, supersample) {
  if (!Number.isInteger(width) || !Number.isInteger(height)) {
    return "a size is two whole numbers of pixels";
  }
  if (width < MIN_SIDE || height < MIN_SIDE) {
    return `nothing smaller than ${MIN_SIDE} pixels on a side`;
  }
  if (width > MAX_SIDE || height > MAX_SIDE) {
    return `nothing longer than ${MAX_SIDE} pixels on a side — a canvas is what a PNG is made on, and every browser caps one`;
  }
  if (width * height > MAX_PIXELS) {
    return `${MAX_PIXELS / 1e6} million pixels is as large a canvas as this can encode`;
  }
  const samples = width * height * supersample * supersample;
  if (samples > MAX_SAMPLES) {
    return (
      `${saidAsCount(samples)} samples is past what a browser survives — coloring a frame holds all of it ` +
      `in one 32-bit address space at once, and ${saidAsCount(MAX_SAMPLES)} is the ceiling. ` +
      `Ask for fewer samples per pixel, or a smaller size.`
    );
  }
  return null;
}

/** The name a saved file gets: family, mode, palette and size.
 *
 *  `multibrot3_smooth_mean_angle_dimensionality-25_3840x2160.png`, so that a folder of
 *  downloads reads as what is in it. A palette name may carry spaces and punctuation —
 *  `Oxide & Copper Edge` — which a file name spells as hyphens. Two downloads of one view
 *  at one size land on one name, and the browser numbers them. */
export function fileNameOf(view, width, height) {
  const palette = String(view.palette)
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${view.family}_${view.mode}_${palette}_${width}x${height}.png`;
}

/**
 * Wire the download control: one row, always open — size, samples, the estimate, and the
 * button, which is also the progress bar while a render is drawing.
 *
 * `context` is what the page owns and this module borrows: the renderer, a reader for the
 * current view, the screen's grid and finished picture, what the pass that drew it cost,
 * somewhere to say things, and the lock that stops the view moving under a render that is
 * drawing it.
 */
export function install(context) {
  const { renderer, currentView, shownGrid, shownImage, measured, finalSupersample, say, setBusy } =
    context;

  const sizePicker = document.getElementById("download-size");
  const custom = document.getElementById("download-custom");
  const widthBox = document.getElementById("download-width");
  const heightBox = document.getElementById("download-height");
  const sampleHost = document.getElementById("download-samples");
  const estimateLine = document.getElementById("download-estimate");
  const go = document.getElementById("download-go");
  const label = document.getElementById("download-label");

  const shownOption = document.createElement("option");
  shownOption.value = SHOWN;
  shownOption.textContent = "As shown";
  sizePicker.append(shownOption);
  for (const [index, preset] of PRESETS.entries()) {
    const option = document.createElement("option");
    option.value = String(index);
    option.textContent = preset.name;
    sizePicker.append(option);
  }
  const customOption = document.createElement("option");
  customOption.value = "custom";
  customOption.textContent = "Custom W × H";
  sizePicker.append(customOption);
  sizePicker.value = DEFAULT_SIZE;

  let supersample = DEFAULT_SUPERSAMPLE;
  const sampleButtons = SUPERSAMPLES.map((factor) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "chip";
    button.textContent = `${factor}×`;
    button.title = factor === 1 ? "one sample a pixel" : `${factor * factor} samples a pixel`;
    button.addEventListener("click", () => {
      supersample = factor;
      syncSamples();
      describe();
    });
    sampleHost.append(button);
    return { factor, button };
  });

  function syncSamples() {
    for (const { factor, button } of sampleButtons) {
      button.setAttribute("aria-pressed", String(factor === supersample));
    }
  }
  syncSamples();

  widthBox.value = PRESETS[DEFAULT_PRESET].width;
  heightBox.value = PRESETS[DEFAULT_PRESET].height;

  let running = null;

  /** What the controls currently ask for. */
  function wanted() {
    const chosen = sizePicker.value;
    const size =
      chosen === "custom"
        ? { width: Number(widthBox.value), height: Number(heightBox.value) }
        : chosen === SHOWN
          ? { width: shownGrid().width, height: shownGrid().height }
          : PRESETS[Number(chosen)];
    return { width: size.width, height: size.height };
  }

  /** The finished picture on the screen, where it is exactly what is being asked for. */
  function ready() {
    if (sizePicker.value !== SHOWN || supersample !== finalSupersample) return null;
    return shownImage();
  }

  /** A refusal, in two words beside the button and a whole sentence behind them. */
  function refuse(short, why) {
    estimateLine.textContent = short;
    estimateLine.title = why;
    go.disabled = true;
  }

  /** The estimate beside the button: `ready`, a wait in a few words, or a refusal. */
  function describe() {
    custom.hidden = sizePicker.value !== "custom";
    // A preset carries its numbers into the boxes, so choosing Custom afterwards starts
    // from the size that was just chosen rather than from whatever was typed there before.
    if (sizePicker.value !== "custom") {
      const { width, height } = wanted();
      widthBox.value = width;
      heightBox.value = height;
    }
    if (running !== null) return;
    const { width, height } = wanted();
    if (ready() !== null) {
      go.disabled = false;
      estimateLine.textContent = "ready";
      estimateLine.title = "the picture on the screen, saved as it is without drawing it again";
      return;
    }
    const refusal = withinLimits(width, height, supersample);
    if (refusal !== null) {
      refuse("too large", refusal);
      return;
    }
    // The module's own answer, at the size actually being asked for. Worth asking here
    // and not only at the press, because a supersample samples a grid `ss` times finer: a
    // deep view the canvas still resolves in `f64` can be one this download does not.
    const view = currentView();
    const shape = renderer.plan(specOf(view, width, height, { colormap: false, supersample }));
    if (!shape.ok) {
      refuse("too deep", shape.why);
      return;
    }
    go.disabled = false;
    const samples = width * height * supersample * supersample;
    const seconds =
      scaled(measured(), samples) ?? estimate(view.mode, samples, renderer.workerCount);
    estimateLine.textContent = saidShort(seconds);
    // Shape is not resolution: a link carries an aspect and the plane width is what a view
    // is, so a different shape keeps that width and shows more or less height.
    estimateLine.title =
      "scaled from how long this view took to draw on the screen. A different shape keeps " +
      "the plane width and shows more or less height, rather than cropping.";
  }

  /** The button is the bar: a fill across it, and how far it has got as its label. */
  function progress(done) {
    const clamped = Math.max(0, Math.min(1, done));
    go.style.setProperty("--done", String(clamped));
    label.textContent = `${Math.round(clamped * 100)}%`;
  }

  function lockSize(on) {
    for (const control of [sizePicker, widthBox, heightBox]) control.disabled = on;
    for (const { button } of sampleButtons) button.disabled = on;
  }

  function finish() {
    running = null;
    go.classList.remove("is-running");
    go.style.removeProperty("--done");
    go.title = "";
    label.textContent = "Download";
    lockSize(false);
    setBusy(false);
    describe();
  }

  async function download() {
    const view = currentView();
    const { width, height } = wanted();
    const samples = width * height * supersample * supersample;

    const drawn = ready();
    if (drawn !== null) {
      const name = fileNameOf(view, drawn.width, drawn.height);
      try {
        await save(drawn, name);
        say(`saved ${name}`);
      } catch (error) {
        say(String(error.message ?? error));
      }
      return;
    }

    const shape = renderer.plan(specOf(view, width, height, { colormap: false, supersample }));
    if (!shape.ok) {
      refuse("too deep", shape.why);
      return;
    }

    running = { cancelled: false, stop: null };
    const mine = running;
    go.classList.add("is-running");
    go.title = "rendering — press to cancel";
    lockSize(true);
    progress(0);
    setBusy(true);

    const started = performance.now();
    // The shade's share of the wait, so that a bar advancing by band does not sit full
    // through a colouring nobody was told about. A direct trap has no shade — its bands
    // arrive painted — and its bar runs the whole way on bands alone.
    const known = measured();
    const shadeSeconds = shape.direct
      ? 0
      : known
        ? (known.shade * samples) / known.samples
        : ((COST[view.mode]?.shade ?? 0) * samples) / FRAME;
    const whole =
      scaled(known, samples) ?? estimate(view.mode, samples, renderer.workerCount) ?? shadeSeconds;
    const shadeShare = whole > 0 ? Math.min(0.5, shadeSeconds / whole) : 0;

    try {
      const field = await renderer.field(view, width, height, {
        supersample,
        onProgress: (done) => {
          if (!mine.cancelled) progress(done * (1 - shadeShare));
        },
      });
      if (field === null || mine.cancelled) {
        say("download cancelled");
        finish();
        return;
      }

      let image;
      if (shape.direct) {
        image = new ImageData(field.values, field.width, field.height);
      } else {
        progress(1 - shadeShare);
        const shaded = await shadeApart(renderer.module, field, view, mine);
        if (shaded === null || mine.cancelled) {
          say("download cancelled");
          finish();
          return;
        }
        image = shaded.image;
      }
      progress(1);

      const name = fileNameOf(view, width, height);
      await save(image, name);
      const spent = (performance.now() - started) / 1000;
      say(`saved ${name} in ${spent.toFixed(1)} s`);
      finish();
    } catch (error) {
      say(String(error.message ?? error));
      finish();
    }
  }

  go.addEventListener("click", () => {
    if (running === null) {
      download();
      return;
    }
    // Pressed while drawing, the bar is the way out. The field is cancelled by generation,
    // exactly as a pan cancels a pass; the colouring by terminating the worker doing it —
    // a shade is one pass of many seconds with nothing to let it finish for, and it is
    // holding a couple of gigabytes while it runs.
    running.cancelled = true;
    renderer.cancel();
    running.stop?.();
  });
  for (const control of [sizePicker, widthBox, heightBox]) {
    control.addEventListener("change", describe);
    control.addEventListener("input", describe);
  }

  return { describe, get running() { return running !== null; } };
}

/** Encode an image as a PNG and hand it to the browser to save. */
function save(image, name) {
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  canvas.getContext("2d", { alpha: false }).putImageData(image, 0, 0);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob === null) {
        reject(new Error("the browser could not encode a PNG this large"));
        return;
      }
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = name;
      anchor.click();
      // Revoked on the next turn: the click has to have been dispatched first,
      // and the blob is tens of megabytes to leave behind.
      setTimeout(() => URL.revokeObjectURL(url), 0);
      resolve();
    }, "image/png");
  });
}

export { MAX_PIXELS, MAX_SAMPLES, MAX_SIDE, PRESETS, SUPERSAMPLES };
