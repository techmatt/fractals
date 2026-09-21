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

import { DERIVED } from "./permalink.js";
import { PROBE_WIDTH, shadeApart, specOf } from "./render.js";

/** The offered sizes, and the shape each of them is. */
const PRESETS = [
  { name: "1920 × 1080", width: 1920, height: 1080 },
  { name: "2560 × 1440", width: 2560, height: 1440 },
  { name: "3840 × 2160", width: 3840, height: 2160 },
];

/** A size menu entry that is no fixed size: the canvas's own pixel grid.
 *
 *  The screen's pass ends at two samples a pixel each way, so at 4× this entry is the picture
 *  already on the screen and is saved without being drawn again. It was the default
 *  until the display's own size could be offered, and still is where that cannot. */
const SHOWN = "shown";

/** The reader's own display, in device pixels: what a wallpaper for this machine is.
 *
 *  `screen.width × screen.height` is in CSS pixels, so it is scaled by the device pixel
 *  ratio. The CSS size was itself rounded on the way out, so the product can land half a
 *  pixel over: a 2560 × 1440 panel at 150% reports 1707 × 960, which scales to 2560.5.
 *  Taking a quarter off before the floor gives 2560 back, and still absorbs a product a
 *  hair under a whole number. It is the default wherever it can be read, and where it
 *  cannot the menu opens at As shown. */
const SCREEN = "screen";

/** The display's size in device pixels, or `null` where the browser will not say. */
export function screenSize() {
  const shown = globalThis.screen;
  const ratio = globalThis.devicePixelRatio || 1;
  const device = (css) => Math.floor((css ?? 0) * ratio + 0.25);
  const width = device(shown?.width);
  const height = device(shown?.height);
  return width > 0 && height > 0 ? { width, height } : null;
}

const DEFAULT_PRESET = 1;
const DEFAULT_SUPERSAMPLE = 2;

/** The samples toggle. Three settings: the one-sample picture a quick look wants; the
 *  two a pixel each way the screen's own finished pass ends at, which is what a render
 *  sheet uses and the default; and four each way, for holding a download at 4× against
 *  the same picture at 16×. The memory ceiling below is what bounds the third: 2560 × 1440
 *  at 16× is 59 million samples and fits, and 3840 × 2160 at 16× is refused by name.
 *
 *  A setting is a factor on each axis, and it is labelled by the samples per pixel it
 *  makes, which is also what it costs: `2` is shown as `4×`. */
const SUPERSAMPLES = [1, 2, 4];

/** The two files a picture can be saved as, each with its own button.
 *
 *  PNG is the picture exactly. JPG is several times smaller and what a wallpaper usually
 *  is, at quality 95 through the browser's own canvas encoder — the same `toBlob` the PNG
 *  goes through, so the pixels handed to either are the same pixels. What that encoder
 *  does with color at 95 is the browser's to decide: Chrome and Edge store color at half
 *  resolution each way (4:2:0) at every quality below 1, which the explorer's README says
 *  more about. */
const FORMATS = {
  png: { type: "image/png", extension: "png", label: "PNG" },
  jpg: { type: "image/jpeg", extension: "jpg", label: "JPG", quality: 0.95 },
};

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
    return "A size is two whole numbers of pixels.";
  }
  if (width < MIN_SIDE || height < MIN_SIDE) {
    return `Nothing smaller than ${MIN_SIDE} pixels on a side.`;
  }
  if (width > MAX_SIDE || height > MAX_SIDE) {
    return `Nothing longer than ${MAX_SIDE} pixels on a side: browsers cap the size of an image they can save.`;
  }
  if (width * height > MAX_PIXELS) {
    return `${MAX_PIXELS / 1e6} million pixels is the largest image this page can save.`;
  }
  const samples = width * height * supersample * supersample;
  if (samples > MAX_SAMPLES) {
    return (
      `${saidAsCount(samples)} samples is more than a browser tab has memory for; ` +
      `${saidAsCount(MAX_SAMPLES)} is the most. Ask for fewer samples per pixel, or a smaller size.`
    );
  }
  return null;
}

/** The name a saved file gets: family, mode, palette and size.
 *
 *  `multibrot3_smooth_mean_angle_dimensionality-25_3840x2160.png`, so that a folder of
 *  downloads reads as what is in it. A palette name may carry spaces and punctuation —
 *  `Oxide & Copper Edge` — which a file name spells as hyphens. Two downloads of one view
 *  at one size land on one name, and the browser numbers them. The extension is the
 *  format's, `png` or `jpg`, and is the only thing the format changes. */
export function fileNameOf(view, width, height, extension = "png") {
  const palette = String(view.palette)
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${view.family}_${view.mode}_${palette}_${width}x${height}.${extension}`;
}

/** The widest one-sample field a derived texture weight is measured on, away from the
 *  screen: the walk's candidate width, which is what the weight was fitted against. */
const WEIGHT_WIDTH = 640;

/**
 * A picture of a view as opening its link draws it, at any size and not on the screen:
 * what a saved picture's thumbnail and Download all both are *(saved_tab_ckpt131)*.
 *
 * **A link that leaves out its derived parameter asks for it to be taken from the
 * view**, and arriving at one the viewer does exactly that, so this does too: a trap's
 * opacity from a probe at `PROBE_WIDTH`, and a texture weight from a one-sample field
 * measured before it is coloured, both as the walk's `picture` takes them. A carried tone
 * curve is replayed and an absent one stays absent, which is what `arrived` does with a
 * link. Returns `{ image, view }`, the view carrying what was derived, or `null` where
 * the render was cancelled.
 *
 * `apart` colours in a worker of its own, which is what a download-sized field needs; a
 * thumbnail is milliseconds and is coloured on this thread. `holder.stop` cancels the
 * colouring once it has begun, as the download's cancel does.
 */
export async function pictureOf(
  renderer,
  view,
  width,
  height,
  { supersample = 1, onProgress, holder = {}, apart = true } = {},
) {
  const derived = DERIVED[view.mode];
  let drawn = view;
  if (derived === "opacity" && view.params?.opacity === undefined) {
    const probeHeight = Math.max(1, Math.round((PROBE_WIDTH * height) / width));
    const counts = await renderer.probe(view, PROBE_WIDTH, probeHeight);
    if (counts === null) return null;
    const probed = renderer.deriveOpacity(view, counts);
    if (probed.opacity !== null) drawn = { ...view, params: { ...view.params, opacity: probed.opacity } };
  }
  if (derived === "weight" && view.params?.weight === undefined) {
    const across = Math.min(width, WEIGHT_WIDTH);
    const down = Math.max(1, Math.round((across * height) / width));
    const once = await renderer.field(view, across, down);
    if (once === null) return null;
    const measured = renderer.shade(once, view, { deriveWeight: true });
    if (measured.weight !== null) drawn = { ...view, params: { ...view.params, weight: measured.weight } };
  }
  const field = await renderer.field(drawn, width, height, { supersample, onProgress });
  if (field === null) return null;
  if (!apart || field.shape.direct) return { image: renderer.shade(field, drawn).image, view: drawn };
  const shaded = await shadeApart(renderer.module, field, drawn, holder);
  return shaded === null ? null : { image: shaded.image, view: drawn };
}

/**
 * A picture encoded in one of the formats, as a `Blob`.
 *
 * **Where a `query` is given, the file carries it** *(explorer_download_carries_link_ckpt137)*
 * — written into the PNG's chunks or the JPEG's comment by `stamp.js`, which leaves the
 * image data alone. This is the one encoder both download paths go through, the single
 * picture and Download all's archive, so it is the one place the stamp has to be.
 *
 * A stamp that fails hands over the picture unstamped rather than losing it: a download is
 * what the reader asked for and the link is what the page added. The module is imported
 * here rather than at the top because a download is a gesture minutes into a visit, and
 * the first frame should not carry it.
 */
export async function encode(image, format, query = null) {
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  canvas.getContext("2d", { alpha: false }).putImageData(image, 0, 0);
  const blob = await new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob === null) reject(new Error(`The browser could not encode a ${format.label} this large.`));
      else resolve(blob);
    }, format.type, format.quality);
  });
  if (query === null) return blob;
  try {
    const { stamp } = await import("./stamp.js");
    return await stamp(blob, format.type, query);
  } catch (error) {
    console.warn("the picture could not be given its link", error);
    return blob;
  }
}

/**
 * Wire the download control: one row, always open — size, samples, the estimate, and a
 * button per format, the pressed one of which is also the progress bar while a render is
 * drawing.
 *
 * `context` is what the page owns and this module borrows: the renderer, a reader for the
 * current view and whether its tone is measured or replayed, the screen's grid and
 * finished picture, what the pass that drew it cost, somewhere to say things, and the
 * lock that stops the view moving under a render that is drawing it.
 *
 * `queryOf` is the link the saved file carries, and it is the **shallow** contract's,
 * because that is the contract of the view `currentView()` returns. Asking the page for
 * "the current link" would give the deep one and put it on a shallow picture.
 *
 * **`deep` is the other view this row can be about** *(deep_cap_policy_ckpt138)*. While
 * the Deep tab owns the canvas every one of the five things above has a different answer —
 * the view, the link, the plan, what a pass of it measured, and who draws it — so they
 * come from the tab rather than from here, and the row switches wholesale rather than
 * translating a deep view into a shallow one. Before this the row drew and stamped
 * `currentView()` whatever was on the screen, which meant a reader downloading from the
 * Deep tab got a correctly-labelled picture of somewhere else.
 */
export function install(context) {
  const {
    renderer,
    currentView,
    queryOf,
    deriving,
    shownGrid,
    shownImage,
    measured,
    finalSupersample,
    say,
    setBusy,
    deep = null,
  } = context;

  /** Whether this row is about the Deep tab's picture rather than the viewer's. */
  function onDeep() {
    return deep !== null && deep.owns();
  }

  const sizePicker = document.getElementById("download-size");
  const custom = document.getElementById("download-custom");
  const widthBox = document.getElementById("download-width");
  const heightBox = document.getElementById("download-height");
  const sampleHost = document.getElementById("download-samples");
  const estimateLine = document.getElementById("download-estimate");
  const buttons = Object.entries(FORMATS).map(([key, format]) => {
    const button = document.getElementById(`download-${key}`);
    const label = button.querySelector(".download-label");
    return { format, button, label, title: button.title };
  });

  const display = screenSize();
  if (display !== null) {
    const screenOption = document.createElement("option");
    screenOption.value = SCREEN;
    screenOption.textContent = `This screen (${display.width}×${display.height})`;
    sizePicker.append(screenOption);
  }
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
  sizePicker.value = display !== null ? SCREEN : SHOWN;

  let supersample = DEFAULT_SUPERSAMPLE;
  const sampleButtons = SUPERSAMPLES.map((factor) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "chip";
    button.textContent = `${factor * factor}×`;
    button.title = factor === 1
      ? "One sample per pixel: quicker, with rougher edges."
      : `${factor * factor} samples per pixel: smoother edges, and about ${factor * factor} times as long.`;
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
  /** Whether Download all has the row: its size and samples held, and both buttons off. */
  let batch = false;

  /** What the controls currently ask for. */
  function wanted() {
    const chosen = sizePicker.value;
    const size =
      chosen === "custom"
        ? { width: Number(widthBox.value), height: Number(heightBox.value) }
        : chosen === SHOWN
          ? { width: shownGrid().width, height: shownGrid().height }
          : chosen === SCREEN
            ? display
            : PRESETS[Number(chosen)];
    return { width: size.width, height: size.height };
  }

  /** The finished picture on the screen, where it is exactly what is being asked for.
   *
   *  The Deep tab's fine pass ends at the same `finalSupersample` the viewer's does, so
   *  *As shown* at 4× is the picture already up on either side of the floor. */
  function ready() {
    if (sizePicker.value !== SHOWN || supersample !== finalSupersample) return null;
    return onDeep() ? deep.shown() : shownImage();
  }

  /** A refusal, in two words beside the button and a whole sentence behind them. */
  function refuse(short, why) {
    estimateLine.textContent = short;
    estimateLine.title = why;
    enable(false);
  }

  /** Both buttons at once: a refusal is about the size and the view, never the format. */
  function enable(on) {
    for (const { button } of buttons) button.disabled = !on;
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
    if (running !== null || batch) return;
    const { width, height } = wanted();
    if (ready() !== null) {
      enable(true);
      estimateLine.textContent = "ready";
      estimateLine.title = "The picture on the screen, saved as it is without drawing it again.";
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
    const shape = onDeep()
      ? deep.plan(width, height, supersample)
      : renderer.plan(specOf(currentView(), width, height, { colormap: false, supersample }));
    if (shape !== null && !shape.ok) {
      refuse("too deep", shape.why);
      return;
    }
    const samples = width * height * supersample * supersample;
    if (onDeep()) {
      // **There is no prior for a deep frame and there is not going to be one.** The
      // `COST` table below is one machine, one day and one shallow view; a deep frame's
      // cost swings over four orders of magnitude with the width, the cap and how much of
      // it is interior, which is exactly why the tab's own progress line predicts from the
      // bands it has finished and from nothing else. So the row says it has nothing to say
      // until a pass of this frame has been drawn — the quarter pass is enough — rather
      // than offering a number that would be wrong by a factor of a thousand.
      const known = deep.measured();
      if (known === null) {
        refuse(
          "not priced",
          "A deep frame's cost cannot be guessed from its size: it swings over four orders " +
            "of magnitude with the width, the iteration cap and how much of the frame is " +
            "interior. Press Render in the Deep tab, and this is estimated from what the " +
            "pass took.",
        );
        return;
      }
      enable(true);
      estimateLine.textContent = saidShort(scaled(known, samples));
      estimateLine.title =
        "Estimated from how long this frame took to draw here, and it is the only honest " +
        "estimate there is at this depth. The picture is drawn at the cap the frame " +
        "settles on and carries its own deep link. A different shape shows more or less " +
        "of the picture above and below, rather than cropping it.";
      return;
    }
    enable(true);
    const view = currentView();
    const seconds =
      scaled(measured(), samples) ?? estimate(view.mode, samples, renderer.workerCount);
    estimateLine.textContent = saidShort(seconds);
    // Shape is not resolution: a link carries an aspect and the plane width is what a view
    // is, so a different shape keeps that width and shows more or less height.
    estimateLine.title =
      "Estimated from how long this view took to draw here. A different shape shows more " +
      "or less of the picture above and below, rather than cropping it.";
  }

  /** The button is the bar: a fill across it, and how far it has got as its label. */
  function progress(done) {
    const clamped = Math.max(0, Math.min(1, done));
    running.go.button.style.setProperty("--done", String(clamped));
    running.go.label.textContent = `${Math.round(clamped * 100)}%`;
  }

  /** While one format draws, the other button and the size are held still: the pressed
   *  button stays live, because it is the way to cancel. */
  function lock(on, go) {
    for (const control of [sizePicker, widthBox, heightBox]) control.disabled = on;
    for (const { button } of sampleButtons) button.disabled = on;
    for (const other of buttons) if (other !== go) other.button.disabled = on;
  }

  function finish() {
    const { go } = running;
    running = null;
    go.button.classList.remove("is-running");
    go.button.style.removeProperty("--done");
    go.button.title = go.title;
    go.label.textContent = `Download ${go.format.label}`;
    lock(false, go);
    setBusy(false);
    describe();
  }

  /** The three names a file is spelled from, for whichever view this row is about.
   *
   *  A deep view carries no family and no mode, because down there each has one value:
   *  `z² + c` at degree 2, in `smooth`. So they are named rather than read, and a deep
   *  download lands under the same `family_mode_palette_size` a shallow one does. */
  function naming() {
    if (!onDeep()) return currentView();
    const view = deep.view();
    return {
      family: view.julia === null ? "mandelbrot" : "julia",
      mode: "smooth",
      palette: view.palette,
    };
  }

  /**
   * **The Deep tab's own download**, which is the tab's render at the row's size.
   *
   * The tab draws it — same pool, same spec, same cap policy — so there is one deep
   * renderer and not two, and the picture comes back with the link it is of. Progress runs
   * through both bars: this one, and the tab's own line, which is also where Cancel is.
   */
  async function downloadDeep(go, width, height) {
    const { format } = go;
    running = { cancelled: false, stop: null, go };
    const mine = running;
    go.button.classList.add("is-running");
    go.button.title = "Rendering. Press to cancel.";
    lock(true, go);
    progress(0);
    setBusy(true);
    const started = performance.now();
    // The shade's share of the wait, from the last pass of this frame — the same split the
    // shallow path makes, off the same two halves.
    const known = deep.measured();
    const samples = width * height * supersample * supersample;
    const whole = scaled(known, samples);
    const shadeShare =
      known && whole > 0 ? Math.min(0.5, (known.shade * samples) / known.samples / whole) : 0;

    try {
      const picture = await deep.picture(width, height, {
        supersample,
        holder: mine,
        onProgress: (done) => {
          if (!mine.cancelled) progress(done * (1 - shadeShare));
        },
      });
      if (picture === null || mine.cancelled) {
        say("Download cancelled.");
        finish();
        return;
      }
      progress(1);
      const name = fileNameOf(picture.name, width, height, format.extension);
      await save(picture.image, name, format, picture.query);
      const spent = (performance.now() - started) / 1000;
      say(`Saved ${name} in ${spent.toFixed(1)} s.`);
      finish();
    } catch (error) {
      say(String(error.message ?? error));
      finish();
    }
  }

  async function download(go) {
    const { format } = go;
    const deepRow = onDeep();
    const view = deepRow ? deep.view() : currentView();
    // Read once, with the view: the row is locked from here until the file is handed over,
    // so this is the link of the picture that is about to be drawn. **The deep path reads
    // its link later**, from the render itself, because the cap the frame settles on is
    // part of what a deep link says and it is not known until the frame has been probed.
    const query = deepRow ? null : queryOf();
    const { width, height } = wanted();
    const samples = width * height * supersample * supersample;

    const drawn = ready();
    if (drawn !== null) {
      const name = fileNameOf(naming(), drawn.width, drawn.height, format.extension);
      try {
        await save(drawn, name, format, query ?? deep.query());
        say(`Saved ${name}.`);
      } catch (error) {
        say(String(error.message ?? error));
      }
      return;
    }

    if (deepRow) {
      await downloadDeep(go, width, height);
      return;
    }

    const shape = renderer.plan(specOf(view, width, height, { colormap: false, supersample }));
    if (!shape.ok) {
      refuse("too deep", shape.why);
      return;
    }

    running = { cancelled: false, stop: null, go };
    const mine = running;
    go.button.classList.add("is-running");
    go.button.title = "Rendering. Press to cancel.";
    lock(true, go);
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
        say("Download cancelled.");
        finish();
        return;
      }

      let image;
      if (shape.direct) {
        image = new ImageData(field.values, field.width, field.height);
      } else {
        progress(1 - shadeShare);
        // The tone curve is per frame by design. A view that arrived replays the curve it
        // carries at this size as at any other; a view the reader made is measured again on
        // the picture being saved, because the curve on the screen was measured on a
        // different frame.
        const shaded = await shadeApart(renderer.module, field, view, mine, {
          derive: deriving() && shape.levels,
        });
        if (shaded === null || mine.cancelled) {
          say("Download cancelled.");
          finish();
          return;
        }
        image = shaded.image;
      }
      progress(1);

      const name = fileNameOf(view, width, height, format.extension);
      await save(image, name, format, query);
      const spent = (performance.now() - started) / 1000;
      say(`Saved ${name} in ${spent.toFixed(1)} s.`);
      finish();
    } catch (error) {
      say(String(error.message ?? error));
      finish();
    }
  }

  for (const go of buttons) {
    go.button.addEventListener("click", () => {
      if (batch) return;
      if (running === null) {
        download(go);
        return;
      }
      // Pressed while drawing, the bar is the way out. The field is cancelled by
      // generation, exactly as a pan cancels a pass; the colouring by terminating the
      // worker doing it — a shade is one pass of many seconds with nothing to let it
      // finish for, and it is holding a couple of gigabytes while it runs.
      if (running.go !== go) return;
      running.cancelled = true;
      // Whichever renderer is drawing it. The Deep tab's `stop` is the same one its own
      // Cancel presses, so the two ways out of a deep download are one way out.
      if (onDeep()) deep.cancel();
      else renderer.cancel();
      running.stop?.();
    });
  }
  for (const control of [sizePicker, widthBox, heightBox]) {
    control.addEventListener("change", describe);
    control.addEventListener("input", describe);
  }

  return {
    describe,
    get running() {
      return running !== null || batch;
    },
    /** What the row asks for now: the size and the samples a download would draw at. */
    asked: () => ({ ...wanted(), supersample }),
    /**
     * Hand the row and the view to Download all, or take them back *(saved_tab_ckpt131)*.
     * It draws on the viewer's renderer as a download does, so it holds what a download
     * holds: the size, the samples, both buttons, and every control that would move the
     * view. `false` when a download is already drawing, which has the row first.
     */
    hold(on) {
      if (on && running !== null) return false;
      batch = on;
      lock(on, null);
      setBusy(on);
      if (!on) describe();
      return true;
    },
  };
}

/** Encode an image in one of `FORMATS` and hand it to the browser to save. */
async function save(image, name, format, query) {
  hand(await encode(image, format, query), name);
}

/** Hand a finished file to the browser to save under `name`. */
export function hand(blob, name) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  // Revoked on the next turn: the click has to have been dispatched first, and the blob
  // is tens of megabytes to leave behind.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export { FORMATS, MAX_PIXELS, MAX_SAMPLES, MAX_SIDE, PRESETS, SUPERSAMPLES };
