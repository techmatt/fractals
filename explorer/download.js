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
// that width and shows more or less height. The control says so in one line,
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

/** The default: a good desktop wallpaper, at the antialiasing a render sheet uses. */
const DEFAULT_PRESET = 1;
const DEFAULT_SUPERSAMPLE = 2;

const SUPERSAMPLES = [1, 2, 4];

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

/** What a mode costs, as the seconds `explorer/bench/modes.mjs` measured over one
 *  1280x720 frame on one thread — the table in `explorer/README.md`, typed.
 *
 *  It is a **prior and not a promise**: it is one machine on one day, at the
 *  mandelbrot home view and so at that view's iteration cap, and a deep frame
 *  iterates more per sample than a shallow one. It exists so that the reader is
 *  told roughly what they are asking for BEFORE they ask for it; from the first
 *  band that lands the estimate is the measured rate instead, and the prior is not
 *  consulted again. A direct trap has no shade, because its bands arrive painted. */
const FRAME = 1280 * 720;
const COST = {
  smooth: { field: 2.27, shade: 0.157 },
  direct_trap_lines: { field: 6.12, shade: 0 },
  direct_trap_multiply: { field: 7.85, shade: 0 },
  direct_trap_screen: { field: 8.2, shade: 0 },
  direct_trap_ring: { field: 10.35, shade: 0 },
  itinerary: { field: 12.12, shade: 0.694 },
  trap_circle: { field: 13.08, shade: 0.309 },
  smooth_trap_circle: { field: 13.32, shade: 0.372 },
  curvature: { field: 19.86, shade: 0.485 },
  smooth_curvature: { field: 20.75, shade: 0.357 },
  smooth_mean_angle: { field: 23.38, shade: 0.492 },
  smooth_angle_min: { field: 24.1, shade: 0.53 },
  threads: { field: 25.35, shade: 0.227 },
  tia: { field: 26.67, shade: 0.351 },
  exp_smoothing: { field: 27.65, shade: 0.171 },
  gaussian_int: { field: 28.3, shade: 0.467 },
  smooth_stripe: { field: 43.35, shade: 0.473 },
  stripe: { field: 46.06, shade: 0.454 },
};

/** Seconds this download is expected to take, before any of it has happened. */
export function estimate(mode, samples, workers) {
  const cost = COST[mode];
  if (cost === undefined) return null;
  // The field is spread over the pool; the shade is one worker on one thread,
  // which is why it is a bigger share of the wait than of the work.
  return (cost.field * samples) / FRAME / workers + (cost.shade * samples) / FRAME;
}

/** A duration a reader can read: two significant figures, and never `0.0 s`. */
export function saidAs(seconds) {
  if (!Number.isFinite(seconds)) return "an unknown time";
  if (seconds < 1) return "under a second";
  if (seconds < 90) return `about ${Math.round(seconds)} s`;
  const minutes = seconds / 60;
  return minutes < 10 ? `about ${minutes.toFixed(1)} min` : `about ${Math.round(minutes)} min`;
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

/** The name a saved file gets: the view's own identity, minus where it is.
 *
 *  Family, mode and width, so that two downloads of one view at one size land on
 *  one name and the browser numbers them — which is what somebody who has just
 *  tried two palettes wants — while two different modes never collide. */
export function fileNameOf(view, width) {
  return `${view.family}-${view.mode}-${width}.png`;
}

/**
 * Wire the download control.
 *
 * `context` is what the page owns and this module borrows: the renderer, a reader
 * for the current view, somewhere to say things, and the lock that stops the view
 * moving under a render that is drawing it.
 */
export function install(context) {
  const { renderer, currentView, say, setBusy } = context;

  const sizePicker = document.getElementById("download-size");
  const custom = document.getElementById("download-custom");
  const widthBox = document.getElementById("download-width");
  const heightBox = document.getElementById("download-height");
  const samplePicker = document.getElementById("download-supersample");
  const go = document.getElementById("download-go");
  const stop = document.getElementById("download-cancel");
  const help = document.getElementById("download-help");
  const meter = document.getElementById("download-progress");

  for (const [index, preset] of PRESETS.entries()) {
    const option = document.createElement("option");
    option.value = String(index);
    option.textContent = preset.name;
    sizePicker.append(option);
  }
  const customOption = document.createElement("option");
  customOption.value = "custom";
  customOption.textContent = "Custom…";
  sizePicker.append(customOption);
  sizePicker.value = String(DEFAULT_PRESET);

  for (const factor of SUPERSAMPLES) {
    const option = document.createElement("option");
    option.value = String(factor);
    option.textContent = `${factor}×`;
    samplePicker.append(option);
  }
  samplePicker.value = String(DEFAULT_SUPERSAMPLE);

  widthBox.value = PRESETS[DEFAULT_PRESET].width;
  heightBox.value = PRESETS[DEFAULT_PRESET].height;

  let running = null;

  /** What the controls currently ask for. */
  function wanted() {
    const chosen = sizePicker.value;
    const size =
      chosen === "custom"
        ? { width: Number(widthBox.value), height: Number(heightBox.value) }
        : PRESETS[Number(chosen)];
    return { ...size, supersample: Number(samplePicker.value) };
  }

  /** The line under the control: what this will cost, or why it is refused. */
  function describe() {
    custom.hidden = sizePicker.value !== "custom";
    // A preset carries its numbers into the boxes, so choosing Custom afterwards
    // starts from the size that was just on the screen rather than from whatever
    // was typed there three sizes ago.
    if (sizePicker.value !== "custom") {
      const preset = PRESETS[Number(sizePicker.value)];
      widthBox.value = preset.width;
      heightBox.value = preset.height;
    }
    const { width, height, supersample } = wanted();
    const refusal = withinLimits(width, height, supersample);
    go.disabled = refusal !== null;
    if (refusal !== null) {
      help.textContent = refusal;
      return;
    }
    // The module's own answer, at the size actually being asked for. Worth asking
    // here and not only at the press, because a supersample samples a grid `ss`
    // times finer: a deep view the canvas still resolves in `f64` can be one this
    // download does not, and finding that out after the button is worse.
    const view = currentView();
    const shape = renderer.plan(specOf(view, width, height, { colormap: false, supersample }));
    if (!shape.ok) {
      help.textContent = shape.why;
      go.disabled = true;
      return;
    }
    const samples = width * height * supersample * supersample;
    const seconds = estimate(view.mode, samples, renderer.workerCount);
    help.textContent =
      `${saidAsCount(samples)} samples, ${saidAs(seconds)} — the estimate is a table, and becomes ` +
      `the measured rate once bands start landing. A different shape to the one on screen keeps the ` +
      `plane width and shows more or less height, rather than cropping.`;
  }

  function finish() {
    running = null;
    meter.hidden = true;
    stop.hidden = true;
    go.hidden = false;
    setBusy(false);
    describe();
  }

  async function download() {
    const view = currentView();
    const { width, height, supersample } = wanted();
    const samples = width * height * supersample * supersample;

    // The module's own answer first, at the size actually being asked for: a
    // supersample samples a grid `ss` times finer, so a view the canvas still
    // resolves in `f64` can be one this download does not. The refusal is the
    // engine's sentence and is shown as it stands.
    const shape = renderer.plan(specOf(view, width, height, { colormap: false, supersample }));
    if (!shape.ok) {
      help.textContent = shape.why;
      return;
    }

    running = { cancelled: false, stop: null };
    const mine = running;
    go.hidden = true;
    stop.hidden = false;
    meter.hidden = false;
    meter.value = 0;
    setBusy(true);

    const started = performance.now();
    // The shade's share of the wait, from the prior, so that a bar advancing by
    // band does not sit at 100% through a colouring nobody was told about. A
    // direct trap has no shade — its bands arrive painted — and its bar runs the
    // whole way on bands alone.
    const shadeSeconds = shape.direct ? 0 : ((COST[view.mode]?.shade ?? 0) * samples) / FRAME;
    const whole = estimate(view.mode, samples, renderer.workerCount) ?? shadeSeconds;
    const shadeShare = whole > 0 ? Math.min(0.5, shadeSeconds / whole) : 0;

    try {
      help.textContent = `iterating ${width}×${height} at ${supersample}× on ${renderer.workerCount} workers…`;
      const field = await renderer.field(view, width, height, {
        supersample,
        onProgress: (done) => {
          if (mine.cancelled) return;
          meter.value = done * (1 - shadeShare);
          // The measured rate, from the bands that have landed. The table above
          // is not consulted again once there is a real number to use.
          const spent = (performance.now() - started) / 1000;
          const left = done > 0 ? (spent / done) * (1 - done) + shadeSeconds : null;
          help.textContent =
            `iterating ${width}×${height} at ${supersample}× — ${Math.round(done * 100)}%` +
            (left === null ? "" : `, ${saidAs(left)} left`);
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
        help.textContent = `coloring ${width}×${height}…`;
        meter.value = 1 - shadeShare;
        const shaded = await shadeApart(renderer.module, field, view, mine);
        if (shaded === null || mine.cancelled) {
          say("download cancelled");
          finish();
          return;
        }
        image = shaded.image;
      }
      meter.value = 1;

      const name = fileNameOf(view, width);
      await save(image, name);
      const spent = (performance.now() - started) / 1000;
      say(`${name} — ${width}×${height} at ${supersample}×, ${spent.toFixed(1)} s`);
      finish();
      help.textContent =
        `${saidAsCount(samples)} samples in ${spent.toFixed(1)} s, which is ` +
        `${((spent * 1e6) / samples).toFixed(2)} µs a sample over ${renderer.workerCount} workers.`;
    } catch (error) {
      say(String(error.message ?? error));
      help.textContent = String(error.message ?? error);
      finish();
    }
  }

  go.addEventListener("click", download);
  stop.addEventListener("click", () => {
    if (running === null) return;
    running.cancelled = true;
    // The field, by generation, exactly as a pan cancels a pass: no further bands
    // are dispatched and the one in flight is finished and thrown away. The
    // colouring, by terminating the worker doing it — a shade is one pass of many
    // seconds with nothing to let it finish for, and it is holding a couple of
    // gigabytes while it runs.
    renderer.cancel();
    running.stop?.();
  });
  for (const control of [sizePicker, widthBox, heightBox, samplePicker]) {
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
