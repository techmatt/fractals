// The explorer: a studio, and an address bar that is always a valid permalink.
//
// Two panels. On the left, pictures somebody can open: a thousand seated wallpapers, or
// the atlas of every place the search kept. On the right, the viewer — the canvas, and
// under it only the controls one would actually turn. Everything about what a link MEANS
// lives in `permalink.js` and everything about how a picture is MADE lives in
// `render.js`. What is here is the part a reader touches, and the one rule that binds it
// together: after every settled view the URL is rewritten to the canonical string, so
// the thing in the address bar is the thing to send somebody.
//
// **One direction of travel.** Every picture on the left is a link, and a link is the
// only way a picture gets into the viewer: a gallery tile parses the permalink its record
// carries, an atlas mark parses the one its slot derived, a control writes one key of the
// view and re-parses. There is no second path by which something becomes the current
// picture, which is what keeps the address bar honest — anything that can be opened here
// can be sent to somebody else.
//
// **The controls are derived, never typed.** Which families exist and which modes a link
// may name come from the contract, and which of those the Mode select lists from the
// gallery record; what a mode is for comes from the baked catalog; which
// parameters a mode has comes from the contract and what they are set to comes from the
// module's own plan; which palettes there are, and what each is filed under, come from
// the baked index. Nothing here holds a second opinion about the engine's catalog, so a
// mode retuned over there arrives by rebuilding.
//
// ## What the regrouping dropped
//
// The page used to be an article page with a canvas in it: a masthead, an introductory
// paragraph, a section nav, a footer, and a line of provenance under everything. A studio
// is not read, so the prose is gone — the `<title>`, the bar and the controls say what
// this is. The provenance line is kept, folded into Details, because what the page was
// baked from is a fact about the picture and not a paragraph about the page.

import * as link from "./permalink.js";
import * as shade from "./shade.js";
import { CONSTANTS as ANCHORS, MODES as IDENTITIES } from "./catalog.js";
import { DEFAULT_PALETTE, PALETTES, PROVENANCE } from "./palettes.js";
import { fetchStops } from "./stops.js";
import * as download from "./download.js";
import * as picker from "./picker.js";
import * as gallery from "./gallery.js";
import {
  PREVIEW_DIVISOR,
  Renderer,
  familySpecOf,
  pixelGrid,
  shadeApart,
  specOf,
} from "./render.js";

/** How far one arrow key moves the view, as a share of its width. */
const PAN_STEP = 0.1;
/** What one press of `+` or `-` multiplies the width by. */
const KEY_ZOOM = 1.4;
/** How much one wheel notch multiplies the width by. */
const WHEEL_ZOOM = 1.15;

/** Samples per pixel, on each axis, of the last stage of a pass.
 *
 *  The pass used to end at one sample a pixel, and a fractal's edges alias at one. So
 *  it ends at two: the same field iterated on a grid twice as fine each way and reduced
 *  inside wasm by the engine's own filter — Lanczos-3 in linear light, which is what a
 *  download at 2× and a finished wallpaper are written through. Not a canvas scaled
 *  down, which would be a box filter over gamma-encoded bytes and a different picture. */
const FINAL_SUPERSAMPLE = 2;

/** Which panel the left side shows when nothing says otherwise. */
const DEFAULT_PANEL = "gallery";

/** What separates a panel from the thing it is open at, in the UI key: `atlas:phoenix`.
 *  The atlas carries five planes and which one is open is worth sending somebody; it is
 *  still furniture, so it rides in the key the contract tolerates and never reads. */
const PANEL_AT = ":";

/** How a mode's parameter is stepped in its control, and what it is called.
 *
 *  The label is the reader's word for it and the step is a sensible nudge; neither
 *  is an engine constant and neither bounds anything — the contract refuses a value
 *  out of range and the engine refuses it again. What a parameter is SET to when
 *  nobody has moved it comes from the module's plan, never from here. */
const CONTROLS = {
  density: {
    label: "Stripe density",
    step: 1,
    tip: "How many stripes wrap around each band: higher is finer.",
  },
  radius: { label: "Trap radius", step: 0.1, tip: "The size of the shape the orbit is measured against." },
  sigma: { label: "Kernel width", step: 0.05, tip: "How soft the threads are: higher is broader and smoother." },
  weight: {
    label: "Texture",
    step: 0.05,
    tip: "How strongly the detail layer shows over the smooth base: 0 is the base alone.",
  },
  shift: { label: "Shift", step: 0.1, tip: "How far each region's colors are moved along the palette." },
  threshold: { label: "Threshold", step: 0.01, tip: "How close the orbit must come before it paints." },
  opacity: { label: "Opacity", step: 0.05, tip: "How strongly each painted stroke covers what is under it." },
};

/** The one plain sentence each shade control says on hover. */
const SHADE_TIPS = {
  gamma: "Above 1 gives more of the picture to the start of the palette, below 1 to its end.",
  cycles: "How many times the palette repeats across the picture.",
  phase: "Where in the palette the coloring starts.",
  transfer: "How the palette is spread over the picture: by value, by where detail changes, or evenly.",
  rolloff: "How the brightest colors are eased off.",
  reverse: "Runs the palette backward.",
  mirror: "Plays the palette forward and then back, so it has no hard seam.",
};

/** The order the Mode select lists the gallery's modes in.
 *
 *  Seat count in the published n=1000 record, most first, ties by name, with `curvature`
 *  moved to second-to-last *(explorer_polish, 2026-09-16)*. Baked here rather than counted
 *  at load, so a reseated gallery does not reshuffle a menu somebody has learnt. A mode
 *  the gallery offers that is not named here, or one only listed because a link arrived
 *  in it, goes after these in the contract's order. */
const MODE_ORDER = [
  "tia",
  "stripe",
  "smooth",
  "threads",
  "smooth_mean_angle",
  "smooth_angle_min",
  "itinerary",
  "smooth_stripe",
  "direct_trap_multiply",
  "direct_trap_lines",
  "direct_trap_screen",
  "curvature",
  "smooth_curvature",
];

/** What each coordinate box is called, in the words the link spells them with. */
const COORDINATES = { x: "x", y: "y", w: "width" };

const canvas = document.getElementById("canvas");
const screen = canvas.getContext("2d", { alpha: false });
const frame = document.createElement("canvas");
const frameScreen = frame.getContext("2d", { alpha: false });

const studio = document.getElementById("studio");
const stage = document.getElementById("stage");
const status = document.getElementById("status");
const stats = document.getElementById("stats");
const opened = document.getElementById("opened");
const readout = document.getElementById("readout");
const differs = document.getElementById("differs");
const familyPicker = document.getElementById("family");
const modePicker = document.getElementById("mode");
const constantStrip = document.getElementById("constants");
const coordinateStrip = document.getElementById("coordinates");
const paramStrip = document.getElementById("params");
const copyButton = document.getElementById("copy");
const notice = document.getElementById("notice");
const shadeBar = document.getElementById("shade-bar");
const shadeReset = document.getElementById("shade-reset");
const shadeNote = document.getElementById("shade-note");
const levelToggle = document.getElementById("level-toggle");
const levelNote = document.getElementById("level-note");
const levelWhy = document.getElementById("level-why");
const levelExplained = document.getElementById("level-explained");
const details = document.getElementById("details");
const renderState = document.getElementById("render-state");

let renderer = null;
let contract = null;
let view = null;
let grid = { width: 0, height: 0 };
let settleTimer = 0;
let panel = null;
let palettes = null;
let tiles = null;
const homes = new Map();

/** `palette-names.json`: the name each map is shown by. A map it does not name, or a page
 *  that could not read it, shows the map's own name — which is also the name a link, Copy
 *  link and a downloaded file carry, always. */
let paletteNames = {};

/** The name a reader is shown for a map. */
function shownName(name) {
  return paletteNames[name] ?? name;
}

/** Both names, where they differ: what a tooltip or Details says. */
function bothNamesOf(name) {
  const shown = shownName(name);
  return shown === name ? name : `${shown} · ${name}`;
}

/** The modes the Mode select offers: the gallery record's, which are the gallery panel's
 *  mode chips. `null` until the record is read, and where it cannot be, every mode the
 *  contract knows. A link may still name any of those, and `syncModes` adds its mode to
 *  the select for as long as that view is up. */
let offeredModes = null;

/** The curve the current view came with, kept while it is switched off.
 *
 *  The operator measures a finished picture and derives a curve from it; only the second
 *  half of that crossed into this page, so the explorer can replay a curve and cannot
 *  invent one. A reader who switches autolevel off to see what the seat looked like
 *  underneath has to be able to switch it back on, and the only curve there is is the one
 *  that arrived — so it is held here rather than lost to the toggle. */
let heldCurve = null;

/** Whether a download is drawing the current view.
 *
 *  While one is, the view is **held still**: a wheel notch that pans the canvas
 *  would cancel the pass the download is waiting on, and a reader who has been
 *  watching a two-minute render would lose it to a scroll they did not mean.
 *  Everything that would move the view checks this and says so; the Download button,
 *  which is the progress bar while it draws, is the way out: pressed, it cancels. */
let busy = false;

function locked() {
  if (!busy) return false;
  say("A download is rendering this view. Press its bar to cancel.");
  return true;
}

/** Freeze or release every control that would change what is being drawn. */
function setBusy(on) {
  busy = on;
  for (const control of [familyPicker, modePicker, copyButton, levelToggle]) control.disabled = on;
  for (const strip of [constantStrip, coordinateStrip, paramStrip]) {
    for (const control of strip.querySelectorAll("input")) control.disabled = on;
  }
  for (const control of shadeBar.querySelectorAll("input, select, button")) control.disabled = on;
  shadeReset.disabled = on;
  // Released, neither the fold nor the reset is simply enabled again: whether the fold
  // may be touched is the current map's business, whether there is anything to reset is
  // the recipe's, and the sync is what knows both.
  if (shadeWidgets.size > 0) syncShade();
}

// ------------------------------------------------------------------- what to say

/** A message under the canvas: a refusal, an error, a saved file, a copied link. */
function say(text) {
  status.textContent = text;
}

/** The render stat line — what the pass is doing, and what the finished one cost. It is
 *  the first line of Details, so nothing numeric sits above the controls but a download's
 *  estimate. */
function stat(text) {
  stats.textContent = text;
}

/** The one word each state of the render-state dot says, on hover and to a screen reader.
 *
 *  `rendering` is the field being iterated, with at most a stretched preview up;
 *  `sharpening` is the one-sample picture up while the final pass runs; `final` is the
 *  finished picture, the only state a download's estimate reads "ready" in. `stopped` is
 *  a pass that ended short of that: a refusal, an error, or a view too deep to sharpen. */
const RENDER_STATES = {
  rendering: "Rendering",
  sharpening: "Sharpening",
  final: "Final",
  stopped: "Stopped",
};

function showState(state) {
  renderState.dataset.state = state;
  renderState.title = RENDER_STATES[state];
  renderState.setAttribute("aria-label", RENDER_STATES[state]);
}

/** A refusal: the picture is not drawn, and the reason is on the page. */
function refuse(message) {
  notice.textContent = message;
  notice.hidden = false;
  studio.hidden = true;
}

function clearNotice() {
  notice.hidden = true;
  notice.textContent = "";
}

// ------------------------------------------------------------------- the contract

/** A family's shipped constants, as the decimal strings they were recorded as. */
function seedConstants(family) {
  const held = {};
  for (const [key, text] of Object.entries(ANCHORS[family] ?? {})) {
    held[key] = { text, value: Number(text) };
  }
  return held;
}

/**
 * A family's home view, asked of the module once and remembered.
 *
 * The constants are handed over because the engine's family spec wants them, not
 * because the answer depends on them: a Julia set is a different shape for every
 * `c`, so no one frame contains every member and the whole plane is where it comes
 * home to whatever `c` it is.
 */
function homeOf(family) {
  if (!homes.has(family)) {
    const raw = renderer.home(familySpecOf(family, seedConstants(family)));
    homes.set(family, {
      x: link.coordinateOf(raw.x),
      y: link.coordinateOf(raw.y),
      w: link.coordinateOf(raw.w),
    });
  }
  return homes.get(family);
}

/** What the module makes of the current view, at a size that does not matter. */
function planOf(current) {
  return renderer.plan(specOf(current, 16, 9, { colormap: false }));
}

// ------------------------------------------------------------------- the geometry

/** The plane height of the current view, from the pixel grid it is drawn on. */
function planeHeight() {
  return view.w.value * (grid.height / grid.width);
}

/** Where in the plane a point of the canvas is, in the current view. */
function planeAt(px, py) {
  const across = px / grid.width - 0.5;
  const down = 0.5 - py / grid.height;
  return {
    x: view.x.value + across * view.w.value,
    y: view.y.value + down * planeHeight(),
  };
}

/** Move to a freshly computed geometry, with the coordinates written shortest.
 *
 *  A move is a view the reader made rather than one they opened, so whatever was opened
 *  stops being what is on the screen: the note about it goes, and the grid's mark with
 *  it. Everything else about the picture — the mode, the map, the recipe, the curve —
 *  is still theirs and travels with them. */
function moveTo(x, y, w) {
  view = {
    ...view,
    x: link.coordinateOf(x),
    y: link.coordinateOf(y),
    w: link.coordinateOf(w),
  };
  leaveSeat();
}

/** Zoom by `factor` about a point of the canvas, refusing to pass the `f64` wall. */
function zoomAbout(px, py, factor) {
  const anchor = planeAt(px, py);
  const width = view.w.value * factor;
  if (factor < 1 && !renderer.resolves(view.x.value, view.y.value, width, grid.width, grid.height)) {
    say("This is as deep as the renderer can zoom: neighboring pixels would land on the same number.");
    return;
  }
  const scale = width / view.w.value;
  moveTo(
    anchor.x + (view.x.value - anchor.x) * scale,
    anchor.y + (view.y.value - anchor.y) * scale,
    width,
  );
  draw();
}

// ------------------------------------------------------------------- drawing

/** Resize the backing store to the canvas's display size, in multiples of four. */
function resize() {
  const box = canvas.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  const wanted = pixelGrid(box.width * ratio, box.height * ratio);
  if (wanted.width === grid.width && wanted.height === grid.height) return false;
  grid = wanted;
  canvas.width = grid.width;
  canvas.height = grid.height;
  frame.width = grid.width;
  frame.height = grid.height;
  return true;
}

function present(image) {
  frameScreen.putImageData(image, 0, 0);
  screen.drawImage(frame, 0, 0);
}

let drawing = 0;

/** The finished picture of the view on the screen — the last stage's, and only once it
 *  has landed. What a download at the screen's own size saves instead of drawing it
 *  again; cleared by every pass, because a picture of the view before is not this one. */
let finished = null;

/** The worker colouring the last stage, while it is. A pass that starts stops it. */
let colouring = {};

/** What the finished stage of this view cost: `{ key, samples, field, shade }`, seconds.
 *
 *  A download's estimate is scaled from it. Kept across a recolour of the same field —
 *  whose key names the geometry and not the palette — with the shade re-measured, and
 *  dropped the moment the field it timed is not the one being drawn. */
let measure = null;

/** The measurement, where there is one for the view on the screen. */
function measured() {
  return measure;
}

/**
 * The whole pass: a quarter-resolution preview, one sample a pixel, then the finished
 * picture at `FINAL_SUPERSAMPLE`. Each stage is served from the cache where it can be.
 *
 * **The stages are there to be looked at, and the last one is the picture.** A recolour
 * of a view already drawn puts its one-sample field up first because that is
 * milliseconds on this thread, and then colours the supersampled field in a worker of
 * its own: four times the samples is seconds on the slower shades, and a palette strip
 * that froze the page for them would be a strip nobody could scroll.
 */
async function draw() {
  updateReadout();
  syncShade();
  const pass = ++drawing;
  renderer.cancel();
  colouring.stop?.();
  colouring = {};
  finished = null;
  showState("rendering");
  say("");
  panel?.describe();

  const shape = planOf(view);
  if (!shape.ok) {
    measure = null;
    stat("");
    say(shape.why);
    showState("stopped");
    return;
  }

  const previewGrid = {
    width: grid.width / PREVIEW_DIVISOR,
    height: grid.height / PREVIEW_DIVISOR,
  };
  const previewKey = link.fieldKey(view, contract, previewGrid.width, previewGrid.height, shape.direct);
  const fullKey = link.fieldKey(view, contract, grid.width, grid.height, shape.direct);
  const finalKey = `${fullKey}&ss=${FINAL_SUPERSAMPLE}`;
  const size = `${grid.width}×${grid.height}`;
  if (measure?.key !== finalKey) {
    measure = null;
    panel?.describe();
  }

  try {
    // Inside the try, because a recipe the engine refuses — a rank transfer under the
    // modulate, which spends its base by rank already — throws from `shade` rather than
    // from the plan, and a refusal a reader caused with a control has to be said rather
    // than left to the console.
    const cachedFull = renderer.cached(fullKey);
    if (cachedFull !== undefined) {
      present(renderer.shade(cachedFull, view).image);
    } else {
      const cachedPreview = renderer.cached(previewKey);
      if (cachedPreview !== undefined) {
        stretch(renderer.shade(cachedPreview, view).image);
      } else {
        stat(`iterating at ${previewGrid.width}×${previewGrid.height}…`);
        const preview = await renderer.field(view, previewGrid.width, previewGrid.height);
        if (preview === null || pass !== drawing) return;
        renderer.remember(previewKey, preview);
        stretch(renderer.shade(preview, view).image);
      }

      stat(`iterating at ${size} on ${renderer.workerCount} workers…`);
      const full = await renderer.field(view, grid.width, grid.height);
      if (full === null || pass !== drawing) return;
      renderer.remember(fullKey, full);
      present(renderer.shade(full, view).image);
    }
    settle();
    showState("sharpening");

    // A grid twice as fine is a grid `f64` may stop resolving before the screen's does.
    // The module says so, and the one-sample picture stays up with its reason beside it
    // rather than the pass failing over a stage that only sharpens.
    const fine = renderer.plan(
      specOf(view, grid.width, grid.height, { colormap: false, supersample: FINAL_SUPERSAMPLE }),
    );
    if (!fine.ok) {
      stat(`${size} at one sample a pixel · ${fine.why}`);
      showState("stopped");
      return;
    }

    let field = renderer.cached(finalKey);
    const recolor = field !== undefined;
    if (!recolor) {
      stat(`${size} · iterating at ${FINAL_SUPERSAMPLE}× on ${renderer.workerCount} workers…`);
      field = await renderer.field(view, grid.width, grid.height, { supersample: FINAL_SUPERSAMPLE });
      if (field === null || pass !== drawing) return;
      renderer.remember(finalKey, field);
    } else if (!shape.direct) {
      stat(`${size} · coloring at ${FINAL_SUPERSAMPLE}×…`);
    }

    // A direct trap arrived painted and reduced, so there is nothing to colour. Anything
    // else goes to a worker with a copy of its field: the one in the cache has to stay
    // whole for the next recolour, and a transfer would detach it.
    const shaded = shape.direct
      ? renderer.shade(field, view)
      : await shadeApart(renderer.module, { ...field, values: field.values.slice() }, view, colouring);
    if (shaded === null || pass !== drawing) return;
    present(shaded.image);
    finished = shaded.image;
    showState("final");
    // Where the field came off the cache its `elapsed` is still the pass that iterated
    // it, so a recolour keeps the field's cost and re-measures only the shade. The fastest
    // shade of this field is the one kept: the page's first shade starts a worker while
    // the gallery is still loading, and measured about five times a recolour's.
    const shadeSeconds = shaded.elapsed / 1000;
    measure = {
      key: finalKey,
      samples: grid.width * grid.height * FINAL_SUPERSAMPLE * FINAL_SUPERSAMPLE,
      field: (field.elapsed ?? 0) / 1000,
      shade: measure?.key === finalKey ? Math.min(measure.shade, shadeSeconds) : shadeSeconds,
    };
    stat(
      recolor
        ? `${size} at ${FINAL_SUPERSAMPLE}× · recolored in ${shaded.elapsed.toFixed(0)} ms`
        : `${size} at ${FINAL_SUPERSAMPLE}× · field ${(field.elapsed / 1000).toFixed(2)} s ` +
            `· shade ${shaded.elapsed.toFixed(0)} ms`,
    );
    panel?.describe();
  } catch (error) {
    // Including a recipe the engine refuses outright — a rank transfer under the
    // modulate, which spends its base by rank already. The control keeps what was
    // asked for, so a reader can see what to change; the address bar keeps naming the
    // picture that is still on the screen, because a refused recipe is not a view.
    say(String(error.message ?? error));
    if (pass === drawing) showState("stopped");
  }
}

/** Put a quarter-resolution picture up at full size while the real one computes. */
function stretch(image) {
  const small = document.createElement("canvas");
  small.width = image.width;
  small.height = image.height;
  small.getContext("2d").putImageData(image, 0, 0);
  screen.imageSmoothingEnabled = true;
  screen.drawImage(small, 0, 0, grid.width, grid.height);
  frameScreen.drawImage(small, 0, 0, grid.width, grid.height);
}

function updateReadout() {
  const cap = renderer.maxiter(view.w.value);
  const level = view.level === null ? "" : `  ·  levels by ${view.level.operator}`;
  readout.textContent =
    `${bothNamesOf(view.palette)}  ·  ${view.mode}  ·  ` +
    `${view.aspect.across}:${view.aspect.down}  ·  ${cap} iterations at this width${level}`;
  syncCoordinates();
}

/** Write the canonical permalink into the address bar, and re-price a download.
 *
 *  Both are properties of the settled view: the estimate is per mode, and whether
 *  a supersampled grid still resolves in `f64` is per width.
 *
 *  **The panel rides along and is not part of the link.** `emit` writes the picture and
 *  nothing else; which side panel is open is a UI key the contract tolerates and never
 *  reads, added here on top. So the address bar restores the whole page and a link
 *  copied out of it is the picture. */
function settle() {
  panel?.describe();
  clearTimeout(settleTimer);
  settleTimer = setTimeout(() => {
    const picture = link.emit(view, contract);
    const at = showing === "atlas" && plane && plane !== home ? `${PANEL_AT}${plane}` : "";
    const furniture = showing === DEFAULT_PANEL ? "" : `&panel=${encodeURIComponent(showing + at)}`;
    history.replaceState(null, "", `?${picture}${furniture}`);
  }, 0);
}

// ------------------------------------------------------------------- the controls

/** Fill a select with names, showing what each one is for where that is known. */
function fill(select, names, titles) {
  select.replaceChildren();
  for (const name of names) {
    const option = document.createElement("option");
    option.value = name;
    option.textContent = name;
    if (titles && titles.get(name)) option.title = titles.get(name);
    select.append(option);
  }
}

/**
 * One key of the link, retyped: the contract reads it, or says why it will not.
 *
 * Every text box in Details goes through here — the family constants and the three
 * coordinates alike — and the route is deliberately the long way round: the current view
 * is emitted, one key is replaced, and the whole string is parsed back. That way a typed
 * coordinate is read by exactly the reader a link's coordinate is read by, refused with
 * exactly the sentence a link would be refused with, and echoed back verbatim in the box
 * rather than reformatted through a float.
 */
function retype(key, text) {
  if (locked()) return false;
  const params = new URLSearchParams(link.emit(view, contract));
  params.set(key, text);
  try {
    view = link.parse(`?${params}`, contract);
  } catch (error) {
    say(error.message);
    return false;
  }
  leaveSeat();
  return true;
}

/**
 * The text boxes for a family's own constants, or nothing where it has none.
 *
 * A constant is typed rather than dragged because it is half of a dynamical
 * location's identity: what belongs in the box is the decimal string a record
 * carries, and a slider cannot spell one.
 */
function buildConstants() {
  constantStrip.replaceChildren();
  for (const key of link.CONSTANTS[view.family]) {
    const label = document.createElement("label");
    label.textContent = {
      cx: "c re", cy: "c im", px: "p re", py: "p im", zx: "z₋₁ re", zy: "z₋₁ im",
    }[key];
    label.htmlFor = `constant-${key}`;
    const input = document.createElement("input");
    input.type = "text";
    input.id = `constant-${key}`;
    input.className = "constant";
    input.value = view.constants[key].text;
    input.addEventListener("change", () => {
      if (retype(key, input.value.trim())) {
        homes.delete(view.family);
        draw();
      } else {
        input.value = view.constants[key].text;
      }
    });
    constantStrip.append(label, input);
  }
}

/** The three coordinate boxes: where the view is, and how wide.
 *
 *  Built once and synced after every move, because a drag and a wheel notch write them
 *  as surely as typing does. What is in the box is the text the link carries — the
 *  decimal string is the identity of a location, and a box that reformatted it would be
 *  the one place on the page where a coordinate lost precision. */
const coordinateBoxes = new Map();

function buildCoordinates() {
  coordinateStrip.replaceChildren();
  for (const [key, label] of Object.entries(COORDINATES)) {
    const name = document.createElement("label");
    name.textContent = label;
    name.htmlFor = `coordinate-${key}`;
    const input = document.createElement("input");
    input.type = "text";
    input.id = `coordinate-${key}`;
    input.className = "constant";
    input.addEventListener("change", () => {
      if (retype(key, input.value.trim())) draw();
      else input.value = view[key].text;
    });
    coordinateBoxes.set(key, input);
    coordinateStrip.append(name, input);
  }
}

function syncCoordinates() {
  for (const [key, input] of coordinateBoxes) {
    if (document.activeElement !== input) input.value = view[key].text;
  }
}

/**
 * The number boxes for the current mode's own parameters.
 *
 * The set comes from the contract and the value from the module's plan, so a box
 * opens at whatever the engine's catalog settled on. A box the reader has not
 * touched stays out of the link — see the note in `permalink.js` on why a mode's
 * parameter is not an always-emitted key.
 */
function buildParams() {
  paramStrip.replaceChildren();
  const settled = planOf(view).params ?? {};
  for (const key of link.MODE_PARAMETERS[view.mode] ?? []) {
    const control = CONTROLS[key];
    const label = document.createElement("label");
    label.textContent = control.label;
    label.htmlFor = `param-${key}`;
    label.title = control.tip;
    const input = document.createElement("input");
    input.type = "number";
    input.id = `param-${key}`;
    input.className = "param";
    input.title = control.tip;
    input.step = control.step;
    input.value = view.params[key] ?? settled[key] ?? "";
    input.addEventListener("change", () => {
      const value = Number(input.value);
      if (!Number.isFinite(value)) {
        input.value = view.params[key] ?? settled[key] ?? "";
        return;
      }
      view = { ...view, params: { ...view.params, [key]: value } };
      leaveSeat();
      draw();
    });
    paramStrip.append(label, input);
  }
}

/**
 * The controls for the engine's palette recipe, and the recipe's own strip.
 *
 * The seven shade keys were link-only for two drafts: a figure's link could set them
 * and a reader could not. What each one is and how a value crosses between a control
 * and the recipe lives in `shade.js`; what is here is the boxes and the events.
 *
 * **Built once and then synced**, never rebuilt. The seven keys do not change with the
 * family or the mode, and a strip rebuilt under a reader's cursor loses whatever they
 * were half way through typing.
 *
 * **Only the offered keys get a control.** A key `shade.js` marks `offered: false` is
 * still read from a link, drawn, and written back by Copy link; it has no widget here,
 * and the Engine defaults button is where a reader learns that a link set it.
 *
 * The two flags are toggle chips, in the gallery filters' own style, because a flag is
 * a thing that is on or off and a chip says which at a glance. They sit together at the
 * end of the strip rather than between the numbers.
 */
const shadeWidgets = new Map();

function buildShade() {
  shadeBar.replaceChildren();
  const chips = document.createElement("span");
  chips.className = "group";
  for (const control of shade.CONTROLS) {
    if (!control.offered) continue;
    const held = {};

    if (control.control === "flag") {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.id = `shade-${control.key}`;
      chip.className = "chip";
      chip.textContent = control.label;
      chip.title = SHADE_TIPS[control.key];
      chip.setAttribute("aria-pressed", "false");
      chip.addEventListener("click", () =>
        setShade(control.key, chip.getAttribute("aria-pressed") === "true" ? "0" : "1"),
      );
      chips.append(chip);
      held.box = chip;
      shadeWidgets.set(control.key, held);
      continue;
    }

    const group = document.createElement("span");
    group.className = "group";
    group.title = SHADE_TIPS[control.key];
    const label = document.createElement("label");
    label.textContent = control.label;
    label.htmlFor = `shade-${control.key}`;
    group.append(label);
    held.group = group;

    if (control.control === "number") {
      if (control.slider !== null) {
        // A slider for the travel and the box beside it for the exact number. The slider
        // recolours as it moves wherever a recolour is cheap; under a direct trap every
        // value is a re-iteration, so there it waits for the hand to let go.
        const slider = document.createElement("input");
        slider.type = "range";
        slider.className = "slider";
        slider.min = control.slider.min;
        slider.max = control.slider.max;
        slider.step = control.step;
        slider.setAttribute("aria-label", control.label);
        slider.addEventListener("input", () => {
          if (!planOf(view).direct) setShade(control.key, slider.value);
        });
        slider.addEventListener("change", () => setShade(control.key, slider.value));
        group.append(slider);
        held.slider = slider;
      }
      const box = document.createElement("input");
      box.type = "number";
      box.id = `shade-${control.key}`;
      box.className = "param";
      box.step = control.step;
      box.addEventListener("change", () => setShade(control.key, box.value.trim()));
      group.append(box);
      held.box = box;
    } else {
      // A tagged key is two controls for one value: the kind, and the one number that
      // kind takes. They write one string between them, which is the string a link
      // carries — `soft_knee:0.35` — so there is nothing here that knows what a knee is.
      const menu = document.createElement("select");
      menu.id = `shade-${control.key}`;
      fill(
        menu,
        control.kinds.map((kind) => kind.kind),
      );
      const name = document.createElement("label");
      name.htmlFor = `shade-${control.key}-value`;
      const box = document.createElement("input");
      box.type = "number";
      box.id = `shade-${control.key}-value`;
      box.className = "param";
      box.step = control.step;
      menu.addEventListener("change", () => {
        // A kind that takes a number has no default to fall back on — the contract
        // refuses `transfer=edge` without its weight — so the menu opens it at the
        // value the wallpaper project's own records use, and the reader moves it.
        const wanted = control.kinds.find((kind) => kind.kind === menu.value);
        const carried = wanted.parameter === null ? "" : box.value.trim() || wanted.opening;
        setShade(control.key, shade.spell(menu.value, carried));
      });
      box.addEventListener("change", () =>
        setShade(control.key, shade.spell(menu.value, box.value.trim())),
      );
      group.append(menu, name, box);
      held.menu = menu;
      held.name = name;
      held.box = box;
    }

    shadeWidgets.set(control.key, held);
    shadeBar.append(group);
  }
  shadeBar.append(chips);
}

/** The one action on the Shade header. It is disabled with nothing to put back, and its
 *  label carries the count that used to be a separate line of text beside the heading. */
shadeReset.addEventListener("click", () => {
  if (locked()) return;
  view = { ...view, shade: shade.defaultShade() };
  leaveSeat();
  syncShade();
  draw();
});

/**
 * One key of the recipe, as its control now says it.
 *
 * The text a control holds is the text a link carries, so what happens to it here is
 * the contract's own reader — and a refusal is the contract's own sentence, shown as
 * it stands and the control put back to the value that is still in force.
 */
function setShade(key, text) {
  if (locked()) {
    syncShade();
    return;
  }
  // A slider fires `change` on release after `input` has already set the same value.
  if (shade.spelling(view.shade, key) === text) return;
  try {
    view = { ...view, shade: shade.withKey(view.shade, key, text) };
  } catch (error) {
    say(error.message);
    syncShade();
    return;
  }
  leaveSeat();
  syncShade();
  draw();
}

/** Show what the recipe now says, in every control that carries a piece of it. */
function syncShade() {
  for (const control of shade.CONTROLS) {
    const held = shadeWidgets.get(control.key);
    if (held === undefined) continue;
    const text = shade.spelling(view.shade, control.key);
    if (control.control === "flag") {
      held.box.setAttribute("aria-pressed", String(text === "1"));
    } else if (control.control === "number") {
      held.box.value = text;
      if (held.slider) {
        // Phase wraps modulo one, so a link's 1.25 sits where 0.25 does on the slider,
        // and the box beside it keeps the number the link actually said.
        held.slider.value = String(((Number(text) % 1) + 1) % 1);
      }
    } else {
      const said = shade.parts(text);
      held.menu.value = said.kind;
      const takes = control.kinds.find((kind) => kind.kind === said.kind).parameter;
      held.name.textContent = takes ?? "";
      held.name.hidden = takes === null;
      held.box.value = said.value;
      held.box.hidden = takes === null;
    }
  }

  // Folding a cyclic map is refused by the contract, because it would halve the cycle
  // the map was drawn to have. The control says so where a reader meets it rather than
  // leaving them to find out from a link that will not open.
  const fold = shadeWidgets.get("mirror");
  const cyclic = PALETTES.get(view.palette).cyclic;
  fold.box.disabled = busy || cyclic;
  fold.box.title = cyclic
    ? `${shownName(view.palette)} already loops back to its first color, so there is no seam to mirror.`
    : SHADE_TIPS.mirror;

  // The count names every key set, the ones with no control included: a link that set
  // the rolloff is a recipe this button resets, and its title is where that is said.
  const set = shade.chosen(view.shade);
  const labels = set.map((key) => shade.CONTROLS.find((control) => control.key === key).label);
  shadeReset.disabled = busy || set.length === 0;
  shadeReset.textContent = set.length === 0 ? "Reset shade" : `Reset shade (${set.length})`;
  shadeReset.title = set.length === 0
    ? "Every shade setting is at its default."
    : `${sentenceList(labels)} ${set.length === 1 ? "differs" : "differ"} from the default.`;

  // Four of the seven are inert under a direct trap, and the engine says so where it
  // paints: those modes composite gradient samples as they iterate and never make a
  // field, so there is no distribution for a gamma or a transfer to spend. What does
  // reach them is the bake — a reversed or folded map is a different gradient — and the
  // rolloff, which acts after a colour has been chosen and has no control here.
  shadeNote.textContent = planOf(view).direct
    ? "This mode paints as it draws, so Gamma, Cycles, Phase and Transfer have no effect " +
      "here. Reverse and Mirror still apply, and each one redraws the picture."
    : "";

  syncLevel();
}

/** `a`, `a and b`, `a, b and c`. */
function sentenceList(words) {
  return words.length < 2 ? words.join("") : `${words.slice(0, -1).join(", ")} and ${words.at(-1)}`;
}

/**
 * The autolevel toggle: on where a curve is in force, off where it is not.
 *
 * **It offers a curve and never derives one.** The operator has two halves — measure a
 * finished picture's tone against the band of finished wallpapers, then push the curve
 * that measurement gives through the map's own stops — and only the second half is on
 * this page. So the toggle can replay the curve a link or a gallery seat arrived with,
 * and can put it away, and has nothing to switch on for a view that never carried one.
 * A control that measured a curve of its own would be a second operator, and two
 * operators is how a seat comes to open in a colour the gallery never shipped.
 */
function syncLevel() {
  const carried = view.level ?? heldCurve;
  levelToggle.checked = view.level !== null;
  levelToggle.disabled = busy || carried === null;
  // The long reason lives behind the `?` and is the same two sentences whatever the view;
  // the line beside the box is the one thing true of this view. Which operator measured
  // the curve is Details' business, not this line's.
  if (carried === null) {
    levelNote.textContent = "Available for gallery wallpapers and links that carry a tone curve.";
    return;
  }
  levelNote.textContent = view.level === null
    ? "Off: the palette as it is, without this wallpaper's tone curve."
    : "Leveled to this wallpaper's stored tone curve.";
}

levelExplained.textContent =
  "Leveling is computed once, when a wallpaper is made, by measuring the finished picture. " +
  "This page replays that stored curve, so it can only level a view that came with one.";
levelWhy.title = levelExplained.textContent;
levelWhy.addEventListener("click", () => {
  levelExplained.hidden = !levelExplained.hidden;
  levelWhy.setAttribute("aria-expanded", String(!levelExplained.hidden));
});

/**
 * The Mode select: the gallery's modes, in `MODE_ORDER`, plus the view's own after them.
 *
 * The select offers what the published record seats and nothing else, so a reader
 * choosing a mode is choosing among modes the pool actually makes wallpapers in. A link
 * naming any other mode the contract knows still parses and draws, and that mode is an
 * extra entry here while its view is up — a select that could not show the mode in force
 * would be showing the wrong one.
 */
function syncModes() {
  const offered = offeredModes ?? link.MODES;
  const listed = link.MODES.filter((mode) => offered.includes(mode) || mode === view.mode);
  const wanted = [
    ...MODE_ORDER.filter((mode) => listed.includes(mode)),
    ...listed.filter((mode) => !MODE_ORDER.includes(mode)),
  ];
  const showing = [...modePicker.options].map((option) => option.value);
  if (wanted.join() !== showing.join()) fill(modePicker, wanted, IDENTITIES);
  modePicker.value = view.mode;
}

/** Whatever the reader just chose, drawn — and the strips rebuilt around it. */
function rebuild() {
  familyPicker.value = view.family;
  syncModes();
  palettes?.show(view.palette);
  buildConstants();
  buildParams();
  stage.style.aspectRatio = `${view.aspect.across} / ${view.aspect.down}`;
}

// ------------------------------------------------------------------- what was opened

/** The seat the viewer is showing, where it is showing one. */
let seat = null;

/**
 * Open a picture from the left panel: its link is parsed, and what the link could not
 * carry is said where the picture is.
 *
 * A tile and a mark both arrive here, because both are the same thing — a permalink that
 * was derived from a record next door. What `gap` says is not this page's sentence: it
 * is the one the builder wrote when it found the run had kept no tone curve, or that the
 * cap the recipe pinned is not the cap the depth policy gives for that width. Saying it
 * is the difference between a picture and a picture that is nearly right.
 */
function openLink(query, { gap = null, key = null, what = "this picture" } = {}) {
  if (locked()) return;
  let wanted;
  try {
    wanted = link.parse(`?${query}`, contract);
  } catch (error) {
    say(error.message);
    return;
  }
  view = wanted;
  seat = key;
  heldCurve = view.level;
  tiles?.mark(key);
  // The record's sentence names caps, curves and policies, which is Details' vocabulary;
  // the line under the picture only says that there is a difference and where to read it.
  opened.textContent = gap
    ? `This view is close to ${what} but not exact. Details says what differs.`
    : "";
  differs.textContent = gap ? `Not carried by this link: ${gap}.` : "";
  rebuild();
  draw();
}

/** Stop claiming the picture is the one that was opened. */
function leaveSeat() {
  if (seat === null && opened.textContent === "") return;
  seat = null;
  tiles?.mark(null);
  opened.textContent = "";
  differs.textContent = "";
}

// ------------------------------------------------------------------- the panels

let showing = DEFAULT_PANEL;
let atlasStarted = false;

/** Which plane the atlas panel is open at, where a link named one. Held even while the
 *  panel has not been mounted, because a link may name a plane before a reader has ever
 *  opened the tab. */
let plane = null;

/** The plane the record opens on, learnt at mount. A key says nothing about the default. */
let home = null;

const tabs = [...document.querySelectorAll(".tab")];

/**
 * Show one of the two left panels.
 *
 * The atlas is mounted the first time it is opened and never before: it reads its own
 * record and instantiates the wasm module for one export, and a reader who came here for
 * the gallery should not wait for either. Its failure is the panel's and not the page's —
 * the viewer is what this page is, and one of two side panels not loading is a note in
 * that panel.
 */
function showPanel(asked) {
  const [name, at] = String(asked).split(PANEL_AT);
  showing = tabs.some((tab) => tab.dataset.panel === name) ? name : DEFAULT_PANEL;
  for (const tab of tabs) {
    const mine = tab.dataset.panel === showing;
    tab.setAttribute("aria-selected", String(mine));
    document.getElementById(`panel-${tab.dataset.panel}`).hidden = !mine;
  }
  if (showing === "atlas") {
    plane = at ?? plane;
    startAtlas();
  }
  settle();
}

async function startAtlas() {
  if (atlasStarted) return;
  atlasStarted = true;
  const host = document.getElementById("atlas-host");
  const note = document.getElementById("atlas-note");
  try {
    const { mount } = await import("../atlas/frame.js");
    const frame = await mount(host, {
      base: new URL("../atlas/", import.meta.url),
      plane,
      onPlane: (name) => {
        plane = name;
        settle();
      },
      // Nothing is stored here — no ring on a mark, no Escape to press — but the slots
      // hold the last place they were shown, because a slot that empties when the pointer
      // leaves the mark is a picture nobody can click.
      keep: false,
      linger: true,
      onPick: ({ query, palette, slot }) => {
        const refused = slot?.refused ?? [];
        const gap = refused.length === 0
          ? null
          : `${refused.join("; ")}${
              palette && slot.colormap && palette !== slot.colormap
                ? `, so it opens in ${bothNamesOf(palette)}`
                : ""
            }`;
        openLink(query, { gap, what: "this place" });
      },
    });
    // The default is the record's own first plane, not whichever one this page happened
    // to open at: a link that named `atlas:multibrot4` has to go on saying so when the
    // address bar is rewritten, and the key leaves only the default unsaid, exactly as
    // the picture keys do.
    home = frame.record.partitions[0]?.partition ?? frame.plane;
    plane = frame.plane;
    settle();
    note.textContent =
      "Hover a mark for its neighborhood, its Julia set and a wallpaper drawn there. " +
      "Click the mark to open the wallpaper, or click one of the three to open that one.";
  } catch (error) {
    atlasStarted = false;
    console.warn("the atlas could not be read", error);
    note.textContent = "The atlas could not be loaded.";
  }
}

for (const tab of tabs) {
  tab.addEventListener("click", () => showPanel(tab.dataset.panel));
}

// ------------------------------------------------------------------- the gestures

const pointers = new Map();
let drag = null;
let pinch = null;

function canvasPoint(event) {
  const box = canvas.getBoundingClientRect();
  return {
    x: ((event.clientX - box.left) / box.width) * grid.width,
    y: ((event.clientY - box.top) / box.height) * grid.height,
  };
}

/** Slide the last picture drawn, so a drag has something to follow. */
function preview(dx, dy, scale = 1) {
  showState("rendering");
  screen.fillStyle = "#000";
  screen.fillRect(0, 0, grid.width, grid.height);
  const width = grid.width * scale;
  const height = grid.height * scale;
  screen.drawImage(frame, dx + (grid.width - width) / 2, dy + (grid.height - height) / 2, width, height);
}

canvas.addEventListener("pointerdown", (event) => {
  if (locked()) return;
  canvas.setPointerCapture(event.pointerId);
  pointers.set(event.pointerId, canvasPoint(event));
  if (pointers.size === 1) {
    drag = { from: canvasPoint(event), at: canvasPoint(event) };
  } else if (pointers.size === 2) {
    drag = null;
    pinch = { spread: spread(), width: view.w.value };
  }
});

canvas.addEventListener("pointermove", (event) => {
  if (!pointers.has(event.pointerId)) return;
  pointers.set(event.pointerId, canvasPoint(event));
  if (pinch !== null && pointers.size === 2) {
    preview(0, 0, spread() / pinch.spread);
    return;
  }
  if (drag === null) return;
  drag.at = canvasPoint(event);
  preview(drag.at.x - drag.from.x, drag.at.y - drag.from.y);
});

function release(event) {
  if (!pointers.has(event.pointerId)) return;
  pointers.delete(event.pointerId);
  if (pinch !== null) {
    const ratio = spread() / pinch.spread;
    pinch = null;
    pointers.clear();
    drag = null;
    if (Number.isFinite(ratio) && ratio > 0) {
      zoomAbout(grid.width / 2, grid.height / 2, 1 / ratio);
    } else {
      draw();
    }
    return;
  }
  if (drag === null) return;
  const dx = drag.at.x - drag.from.x;
  const dy = drag.at.y - drag.from.y;
  drag = null;
  if (dx === 0 && dy === 0) return;
  moveTo(
    view.x.value - (dx / grid.width) * view.w.value,
    view.y.value + (dy / grid.height) * planeHeight(),
    view.w.value,
  );
  draw();
}

canvas.addEventListener("pointerup", release);
canvas.addEventListener("pointercancel", release);

function spread() {
  const [a, b] = [...pointers.values()];
  return Math.hypot(a.x - b.x, a.y - b.y);
}

canvas.addEventListener(
  "wheel",
  (event) => {
    event.preventDefault();
    if (locked()) return;
    const at = canvasPoint(event);
    zoomAbout(at.x, at.y, event.deltaY > 0 ? WHEEL_ZOOM : 1 / WHEEL_ZOOM);
  },
  { passive: false },
);

/** Form controls keep their own keys: the pickers are selects and the constants are
 *  text boxes, and a reader typing in one is not panning the plane. */
const TYPING = new Set(["SELECT", "INPUT", "TEXTAREA", "BUTTON", "OPTION"]);

window.addEventListener("keydown", (event) => {
  if (event.target instanceof Element && TYPING.has(event.target.tagName)) return;
  if (busy) return;
  const step = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] }[
    event.key
  ];
  if (step) {
    event.preventDefault();
    moveTo(
      view.x.value + step[0] * PAN_STEP * view.w.value,
      view.y.value + step[1] * PAN_STEP * planeHeight(),
      view.w.value,
    );
    draw();
    return;
  }
  if (event.key === "+" || event.key === "=") {
    event.preventDefault();
    zoomAbout(grid.width / 2, grid.height / 2, 1 / KEY_ZOOM);
  } else if (event.key === "-" || event.key === "_") {
    event.preventDefault();
    zoomAbout(grid.width / 2, grid.height / 2, KEY_ZOOM);
  }
});

/** A new family is a new plane, so it opens at that plane's own home view. The
 *  mode, the palette and the shade recipe are the reader's and travel with them. */
familyPicker.addEventListener("change", () => {
  if (locked()) return;
  view = {
    ...link.fresh(familyPicker.value, view.mode, contract),
    params: view.params,
    aspect: view.aspect,
    palette: view.palette,
    shade: view.shade,
    level: view.level,
  };
  leaveSeat();
  rebuild();
  draw();
});

/** A new mode keeps the place and drops the parameters, because they belonged to
 *  the mode that is being left. */
modePicker.addEventListener("change", () => {
  view = { ...view, mode: modePicker.value, params: {} };
  // A mode that was only listed because the view arrived in it goes, now it is left.
  syncModes();
  leaveSeat();
  buildParams();
  // What a download of this view would cost is per mode, so the line under the
  // control moves with the picker rather than at the moment somebody presses it.
  panel?.describe();
  draw();
});

/** A map, picked out of the strip. The recipe travels with the reader, except where
 *  the new map refuses a piece of it. */
function pickPalette(name) {
  if (locked()) return;
  view = { ...view, palette: name };
  // A cyclic map cannot be folded, so a recipe that arrived folded is dropped
  // rather than carried onto a map it is refused on.
  if (view.shade.mirror && PALETTES.get(name).cyclic) {
    view = { ...view, shade: { ...view.shade, mirror: false } };
  }
  leaveSeat();
  palettes.show(name);
  draw();
}

levelToggle.addEventListener("change", () => {
  if (locked()) {
    syncLevel();
    return;
  }
  if (levelToggle.checked) {
    if (heldCurve === null) {
      syncLevel();
      return;
    }
    view = { ...view, level: heldCurve };
  } else {
    heldCurve = view.level ?? heldCurve;
    view = { ...view, level: null };
  }
  // Not a `leaveSeat`: switching the seat's own curve off is looking at the seat, and
  // the note that says what the link could not carry is still the thing worth reading.
  syncLevel();
  draw();
});

copyButton.addEventListener("click", async () => {
  const url = new URL(window.location.href);
  url.search = `?${link.emit(view, contract)}`;
  url.hash = "";
  try {
    await navigator.clipboard.writeText(url.toString());
    say("Link copied.");
  } catch {
    say(url.toString());
  }
});

let resizing = 0;
window.addEventListener("resize", () => {
  clearTimeout(resizing);
  resizing = setTimeout(() => {
    if (busy) return;
    if (resize()) draw();
  }, 200);
});

// ------------------------------------------------------------------- starting up

/** A small JSON record beside the page, or `null` where it cannot be had. */
async function json(url) {
  try {
    const response = await fetch(url);
    return response.ok ? await response.json() : null;
  } catch {
    return null;
  }
}

async function main() {
  // Two fetches and they are independent, so they go together: the module the page
  // draws with, and the megabyte of control points its index addresses. Neither is
  // wanted before the first frame and both are wanted by it.
  //
  // Three small records go out beside them, and each is allowed to fail: the gallery's,
  // which says which modes the Mode select offers; the display names; and the Popular
  // list. Without any of them the page still draws, showing every mode, every map by its
  // own name, and Popular by seats alone.
  const [started, , record, names, listed] = await Promise.all([
    Renderer.start(new URL("./engine.wasm", import.meta.url)),
    fetchStops(new URL("./palettes.bin", import.meta.url)),
    gallery.load(import.meta.url).catch((error) => error),
    json(new URL("./palette-names.json", import.meta.url)),
    json(new URL("./popular.json", import.meta.url)),
  ]);
  renderer = started;
  paletteNames = names ?? {};
  if (!(record instanceof Error)) {
    offeredModes = [...new Set(record.seats.map((seat) => seat.mode))];
  }

  contract = {
    home: homeOf,
    constants: seedConstants,
    palettes: PALETTES,
    defaultPalette: DEFAULT_PALETTE,
  };

  fill(familyPicker, link.FAMILIES);

  try {
    view = link.parse(window.location.search, contract);
  } catch (error) {
    refuse(`${error.message} Nothing has been drawn, because guessing what was meant would be worse than saying so.`);
    return;
  }
  heldCurve = view.level;

  document.getElementById("provenance").textContent =
    `${PROVENANCE.count} palettes and ${IDENTITIES.size} production modes, baked from ` +
    `fractal-wallpapers ${PROVENANCE.wallpapers_commit.slice(0, 12)} on ${PROVENANCE.baked}.`;

  clearNotice();
  studio.hidden = false;

  buildShade();
  buildCoordinates();
  // A link that set part of the recipe opens the group it set. Folded away is the right
  // resting state for a place a reader is more likely to reach by dragging; folded away
  // over values somebody sent in a link is the page hiding what it was asked to show.
  details.open = shade.chosen(view.shade).length > 0;

  palettes = picker.install({
    tabs: document.getElementById("palette-tabs"),
    search: document.getElementById("palette-search"),
    filter: document.getElementById("palette-filter"),
    list: document.getElementById("palette-list"),
    names: paletteNames,
    popular: Array.isArray(listed?.maps) ? listed.maps : null,
    onPick: pickPalette,
  });
  palettes.start(view.palette);

  panel = download.install({
    renderer,
    currentView: () => view,
    shownGrid: () => grid,
    shownImage: () => finished,
    measured,
    finalSupersample: FINAL_SUPERSAMPLE,
    say,
    setBusy,
  });
  panel.describe();

  // Which panel the link asked for. A UI key is never validated by the contract, so an
  // unknown one lands on the default rather than refusing a picture over furniture.
  showPanel(new URLSearchParams(window.location.search).get("panel") ?? DEFAULT_PANEL);

  rebuild();
  resize();
  draw();

  // The gallery is the last thing started and the only one allowed to fail quietly: its
  // pictures are untracked until this is deployed, so a clone has the record and no
  // images, and that is a panel with a sentence in it rather than a page that will not
  // open.
  tiles = gallery.install({
    base: import.meta.url,
    modes: document.getElementById("gallery-modes"),
    hues: document.getElementById("gallery-hues"),
    tiles: document.getElementById("gallery-tiles"),
    note: document.getElementById("gallery-note"),
    onPick: (row) =>
      openLink(row.link, { gap: row.gap, key: row.key, what: "this wallpaper" }),
  });
  tiles.start(record).catch((error) => {
    // The reason goes to the console: it names a record file, and a reader can do
    // nothing with that. `python -m builder seats` is what lands the record on a clone.
    console.warn("the gallery record could not be read", error);
    tiles.refuse("The gallery could not be loaded.");
  });
}

main().catch((error) => {
  refuse(
    `The explorer could not start: ${error.message ?? error}. It needs to be served over http — ` +
      "opened straight off the filesystem a browser will not load its module, its workers or its " +
      "renderer. `python -m builder serve` puts this tree on localhost.",
  );
});
