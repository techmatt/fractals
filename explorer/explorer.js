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
import * as modeParams from "./params.js";
import { CONSTANTS as ANCHORS, MODES as IDENTITIES, SETTLED } from "./catalog.js";
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
  probeGrid,
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
 *  download at 4× and a finished wallpaper are written through. Not a canvas scaled
 *  down, which would be a box filter over gamma-encoded bytes and a different picture. */
const FINAL_SUPERSAMPLE = 2;

/** Which panel the left side shows when nothing says otherwise. */
const DEFAULT_PANEL = "gallery";

/** What separated a panel from the plane it was open at, in the UI key: `atlas:phoenix`.
 *  The plane follows the view now and is not written; an older address that says one
 *  still opens its panel. */
const PANEL_AT = ":";

/** Each Julia family's parameter plane: where its `c` is a point. Julia here goes one way
 *  along this and Back the other. Phoenix is on neither side, because no family here is
 *  the plane its `c` is drawn from. */
const PARENT_PLANE = {
  julia: "mandelbrot",
  julia3: "multibrot3",
  julia4: "multibrot4",
  julia5: "multibrot5",
  julia6: "multibrot6",
};
const JULIA_OF = Object.fromEntries(Object.entries(PARENT_PLANE).map(([julia, plane]) => [plane, julia]));

/** Where a parent view opened by Julia here is held for Back: this tab's session, never the
 *  link, which carries only the Julia view. */
const HELD_PARENT = "explorer.julia-parent";

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

/** The mode both mode lists open with, whatever the counts or the alphabet would say.
 *
 *  *(Matt, 2026-09-17.)* `smooth` is the mode the article teaches first and the one a
 *  reader arriving here has already met, so it heads the Mode select and the gallery
 *  panel's mode chips alike — the chips are tallied and sorted at load, so the pin is a
 *  fact this page states rather than an order a count happens to produce. Named once and
 *  handed to the panel, because two spellings of one editorial decision is one of them
 *  going stale. */
const MODE_FIRST = "smooth";

/** The order the Mode select lists the gallery's modes in.
 *
 *  `MODE_FIRST`, then seat count in the published n=1000 record, most first, ties by name,
 *  with `curvature` moved to second-to-last *(explorer_polish, 2026-09-16)*. Baked here
 *  rather than counted at load, so a reseated gallery does not reshuffle a menu somebody
 *  has learnt. A mode the gallery offers that is not named here, or one only listed
 *  because a link arrived in it, goes after these in the contract's order. */
const MODE_ORDER = [
  MODE_FIRST,
  "tia",
  "stripe",
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
const paramNote = document.getElementById("param-note");
const copyButton = document.getElementById("copy");
const copyViewButton = document.getElementById("copy-view");
const notice = document.getElementById("notice");
const shadeBar = document.getElementById("shade-bar");
const shadeReset = document.getElementById("palette-reset");
const shadeNote = document.getElementById("shade-note");
const levelGroup = document.getElementById("level-group");
const levelToggle = document.getElementById("level-toggle");
const details = document.getElementById("details");
const paletteStrip = document.getElementById("palette-strip");
const paletteShown = document.getElementById("palette-shown");
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
 *  link and a downloaded file carry, always. The record's entries are `{name, source}`;
 *  `source` is the builder's business, and this holds the names alone. */
let paletteNames = {};

/** The record's entries reduced to `{underlying: shown}`. */
function shownNames(record) {
  return Object.fromEntries(Object.entries(record ?? {}).map(([name, entry]) => [name, entry.name]));
}

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

/** Where the tone curve in force comes from: `stored` or `derived`.
 *
 *  **A view that arrives replays what it arrived with.** A gallery seat, an atlas mark or
 *  a pasted link carries the curve its run recorded in `level=`, or carries none because
 *  the operator measured that picture and left it alone — and either way what is on the
 *  screen is what the link names. Measuring such a view again here would be taking the
 *  decision a second time at a different size, and the audit behind this page measured
 *  that: the verdict holds and the curve does not. So `stored` replays, and a link with no
 *  `level` stays unlevelled, which is what every such link has always meant.
 *
 *  **The first change a reader makes is a view nobody measured**, so from then on the
 *  page is `derived`: where the Autolevel box is ticked, the finished picture of every pass
 *  is measured in the worker that colours it, and levelled where its tone sits outside the
 *  band. `view.level` then holds the curve the last pass derived, which is what Copy link
 *  writes — five numbers, never a flag, so a link reopens as the picture that was seen
 *  rather than as a fresh measurement of it. A bare page with no picture in its address is
 *  `derived` from the start. Whether anything is measured at all is `levelOn`'s. */
let levelling = "stored";

/** Where the value of the mode's derived parameter comes from: `stored`, `derived` or
 *  `pinned`. The parameter is `link.DERIVED`'s — an angle mode's texture weight, a trap's
 *  opacity — and the other modes have none, which leaves this with nothing to say.
 *
 *  **`stored` replays what a view arrived with**, the same as a tone curve: a seat, an atlas
 *  mark or a link carries the number its picture was drawn at, and a mode switch back into
 *  the mode a seat sits in carries that seat's own. **`derived` takes it from the view**:
 *  a view that arrived without one, a mode switch into a mode no seat here sits in, and
 *  every view after the first change a reader makes to a stored one. The weight is
 *  measured on the one-sample field before it is coloured and the opacity on a probe
 *  before anything is painted, and either lands in `view.params`, which is what the box
 *  shows and Copy link writes. **`pinned` is a number the reader typed**, and it holds
 *  through pans and zooms until the mode changes. A link cannot say which of the three
 *  wrote its number, so a reopened pinned value is `stored`, and moves at the first move
 *  like any other. */
let tuning = "stored";

/** Where a `stored` value came from, for the line beside the box: `seat` or `link`. */
let tunedFrom = "link";

/** What the last probe said — `{ opacity, hit_share, load }` — or `null` where no probe
 *  ran for the view on the screen. */
let probed = null;

/** Probes by `link.probeKey` and grid, a handful deep: a pan back, a recolour or a resize
 *  that lands on the same probe grid asks nothing of the pool. */
const probes = new Map();
const PROBE_CACHE = 8;

/** The gallery's seats by place and mode, each with the parameters it was drawn at. A
 *  mode switch back into a seat's own mode carries these. */
const seatsByPlace = new Map();

/** The value each trap mode's seats were most often drawn at, by mode: what a switch into
 *  that mode opens at before its probe has said anything, and keeps where it says nothing. */
const seatedParams = {};

/** Whether the Autolevel box is ticked. Unticked, the palette is drawn as it is.
 *
 *  **Off unless the view arrived with a curve in force** *(explorer_autolevel_default,
 *  2026-09-16)*. A curved seat, or a link carrying `level=`, opens ticked and replays its
 *  curve; a clean seat, a link with no curve and a bare page open unticked, and a change of
 *  mode, palette or place keeps the box where it was. Ticking it is what asks for a
 *  measurement: a view with no stored curve to give back becomes `derived` at that moment.
 *  No link changed picture by this: an arriving link with no `level` was never measured,
 *  so the only views it moves are the ones a reader goes on to make. */
let levelOn = false;

/** The curve the view arrived with, kept while the box is unticked so ticking it again
 *  puts the same curve back. Meaningless once the view is `derived`. */
let storedCurve = null;

/** Whether the last derived pass found the tone already in band, which the note says. */
let derivedInBand = false;

/** Whether a download is drawing the current view.
 *
 *  While one is, the view is **held still**: a wheel notch that pans the canvas
 *  would cancel the pass the download is waiting on, and a reader who has been
 *  watching a two-minute render would lose it to a scroll they did not mean.
 *  Everything that would move the view checks this and says so; the Download button,
 *  which is the progress bar while it draws, is the way out: pressed, it cancels. */
let busy = false;

/** Whether the pass on the screen is still deriving something a link carries.
 *
 *  A derived tone curve lands on the view when the final stage has measured the picture,
 *  a texture weight when the one-sample stage has, and a trap's opacity when the probe
 *  has. Until then the view holds the last pass's value, so a link copied mid-pass would
 *  name a picture that is never on the screen. **So the copy controls wait**: Copy link
 *  and Copy view are disabled from the start of a pass that derives anything until that
 *  pass ends, whether it finishes, stops short or is overtaken. A pass that derives
 *  nothing leaves them alone, because its view is already the one it will finish on. */
let copyHeld = false;

/** What the two copy buttons say on hover while they are held. */
const COPY_HELD_TITLE = "Available when this view has finished measuring its picture.";
const copyViewTitle = copyViewButton.title;

function syncCopy() {
  copyButton.disabled = busy || copyHeld;
  copyViewButton.disabled = copyHeld;
  copyButton.title = copyHeld ? COPY_HELD_TITLE : "";
  copyViewButton.title = copyHeld ? COPY_HELD_TITLE : copyViewTitle;
}

function holdCopy(on) {
  if (copyHeld === on) return;
  copyHeld = on;
  syncCopy();
}

function locked() {
  if (!busy) return false;
  say("A download is rendering this view. Press its bar to cancel.");
  return true;
}

/** Freeze or release every control that would change what is being drawn. */
function setBusy(on) {
  busy = on;
  for (const control of [familyPicker, modePicker, levelToggle]) control.disabled = on;
  syncCopy();
  for (const strip of [constantStrip, coordinateStrip, paramStrip]) {
    for (const control of strip.querySelectorAll("input")) control.disabled = on;
  }
  // The `?` beside Autolevel only explains, so it stays open while a download runs.
  for (const control of shadeBar.querySelectorAll("input, select, button:not(.why)")) {
    control.disabled = on;
  }
  shadeReset.disabled = on;
  syncToggles();
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
 *  it. Everything else about the picture — the mode, the map, the recipe — is still
 *  theirs and travels with them. The tone curve does not: it was a measurement of the
 *  picture that was on the screen, and the new one is measured when it is drawn. */
function moveTo(x, y, w) {
  view = {
    ...view,
    x: link.coordinateOf(x),
    y: link.coordinateOf(y),
    w: link.coordinateOf(w),
  };
  changed();
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
  const running = drawPass();
  // `drawPass` bumps `drawing` before its first await, so this is the pass just started.
  const pass = drawing;
  try {
    await running;
  } finally {
    if (pass === drawing) holdCopy(false);
  }
}

/** One pass, as `draw` describes it; `draw` is what releases the copy controls after it. */
async function drawPass() {
  updateReadout();
  syncShade();
  const pass = ++drawing;
  holdCopy(false);
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

  // A derived view whose mode the operator does not act on, or whose box is unticked,
  // carries no curve: the module would refuse one under a direct trap or the modulate,
  // and an unticked box is the palette as it is. Otherwise the curve in force while the
  // earlier stages draw is the last one derived — a preview in last pass's tone rather
  // than a flash of the unlevelled picture — and the final stage measures its own.
  const deriving = levelling === "derived" && levelOn && shape.levels;
  if (levelling === "derived" && !deriving && view.level !== null) {
    view = { ...view, level: null };
    updateReadout();
  }

  // A trap's opacity decides every pixel it paints, so it is derived before the first of
  // them: the probe runs over the pool ahead of the preview, and costs a few percent of it.
  const tuned = link.DERIVED[view.mode];
  const derivingOpacity = tuning === "derived" && tuned === "opacity" && shape.direct;
  const derivingWeight = tuning === "derived" && tuned === "weight" && !shape.direct;
  holdCopy(deriving || derivingOpacity || derivingWeight);
  let probeMs = 0;
  probed = null;
  if (derivingOpacity) {
    const at = probeGrid(grid);
    const probeKey = `${link.probeKey(view, contract)}&px=${at.width}x${at.height}`;
    let counts = probes.get(probeKey);
    if (counts === undefined) {
      stat(`probing at ${at.width}×${at.height}…`);
      const started = performance.now();
      try {
        counts = await renderer.probe(view, at.width, at.height);
      } catch (error) {
        say(String(error.message ?? error));
        if (pass === drawing) showState("stopped");
        return;
      }
      if (counts === null || pass !== drawing) return;
      probeMs = performance.now() - started;
      probes.set(probeKey, counts);
      while (probes.size > PROBE_CACHE) probes.delete(probes.keys().next().value);
    }
    probed = renderer.deriveOpacity(view, counts);
    if (probed.opacity !== null) {
      view = { ...view, params: { ...view.params, opacity: probed.opacity } };
    }
    syncParams();
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
    // A derived texture weight is measured here, on the one-sample field, before it is
    // coloured: the preview drew at whatever weight was in force, and every stage after this
    // one draws at the weight this one derived.
    const shadeFull = (full) => {
      const shaded = renderer.shade(full, view, { deriveWeight: derivingWeight });
      if (derivingWeight && shaded.weight !== null) {
        view = { ...view, params: { ...view.params, weight: shaded.weight } };
        syncParams();
      }
      present(shaded.image);
    };
    const cachedFull = renderer.cached(fullKey);
    if (cachedFull !== undefined) {
      shadeFull(cachedFull);
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
      shadeFull(full);
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
      stat(`${size} · iterating at ${FINAL_SUPERSAMPLE ** 2}× on ${renderer.workerCount} workers…`);
      field = await renderer.field(view, grid.width, grid.height, { supersample: FINAL_SUPERSAMPLE });
      if (field === null || pass !== drawing) return;
      renderer.remember(finalKey, field);
    } else if (!shape.direct) {
      stat(`${size} · coloring at ${FINAL_SUPERSAMPLE ** 2}×…`);
    }

    // A direct trap arrived painted and reduced, so there is nothing to colour. Anything
    // else goes to a worker with a copy of its field: the one in the cache has to stay
    // whole for the next recolour, and a transfer would detach it.
    //
    // A derived view is measured in that same worker, on this picture, and coloured again
    // there where the operator acts — so the state below turns final only once the levelled
    // picture is the one on the screen.
    const shaded = shape.direct
      ? renderer.shade(field, view)
      : await renderer.shadeKept(
          { ...field, values: field.values.slice() },
          view,
          colouring,
          { derive: deriving },
        );
    if (shaded === null || pass !== drawing) return;
    if (deriving) {
      view = { ...view, level: shaded.level };
      derivedInBand = shaded.level === null;
      updateReadout();
      syncLevel();
      syncFinal();
      settle();
    }
    present(shaded.image);
    finished = shaded.image;
    showState("final");
    if (derivingOpacity && probed.opacity === null) {
      // No opacity lifts a mask with nothing in it, so the page says what it found rather
      // than guessing at a number.
      say(
        uniform(shaded.image)
          ? "Nothing in this view comes near enough to the trap to paint, so no opacity can bring it out."
          : `Too little of this view comes near the trap to measure, so opacity stays at ${shownParam(view.params.opacity ?? planOf(view).params?.opacity)}.`,
      );
    }
    // Where the field came off the cache its `elapsed` is still the pass that iterated
    // it, so a recolour keeps the field's cost and re-measures only the shade. The fastest
    // shade of this field is the one kept: the page's first shade lands while the gallery
    // is still loading, and used to measure about five times a recolour's.
    const shadeSeconds = shaded.elapsed / 1000;
    measure = {
      key: finalKey,
      samples: grid.width * grid.height * FINAL_SUPERSAMPLE * FINAL_SUPERSAMPLE,
      field: (field.elapsed ?? 0) / 1000,
      shade: measure?.key === finalKey ? Math.min(measure.shade, shadeSeconds) : shadeSeconds,
    };
    const probeCost = probeMs > 0 ? ` · probe ${probeMs.toFixed(0)} ms` : "";
    stat(
      recolor
        ? `${size} at ${FINAL_SUPERSAMPLE ** 2}× · recolored in ${shaded.elapsed.toFixed(0)} ms${probeCost}`
        : `${size} at ${FINAL_SUPERSAMPLE ** 2}× · field ${(field.elapsed / 1000).toFixed(2)} s ` +
            `· shade ${shaded.elapsed.toFixed(0)} ms${probeCost}`,
    );
    panel?.describe();
  } catch (error) {
    // Including a recipe the engine refuses outright — a rank transfer under the
    // modulate, which spends its base by rank already. The control keeps what was
    // asked for, so a reader can see what to change; the address bar keeps naming the
    // picture that is still on the screen, because a refused recipe is not a view.
    say(String(error.message ?? error));
    // The line above is a sentence for a reader; the stack is for whoever has to find it.
    console.error("draw failed", { state: renderState.dataset.state, view }, error);
    if (pass === drawing) showState("stopped");
  }
}

/** Whether every pixel of a picture is the same colour: a trap that painted nothing. */
function uniform(image) {
  const data = image.data;
  for (let at = 4; at < data.length; at += 4) {
    if (data[at] !== data[0] || data[at + 1] !== data[1] || data[at + 2] !== data[2]) return false;
  }
  return true;
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
    const furniture = showing === DEFAULT_PANEL ? "" : `&panel=${encodeURIComponent(showing)}`;
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
  changed();
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
 * A slider and a number box for each of the current mode's own parameters.
 *
 * The set comes from the contract and the value from the module's plan, so a control
 * opens at whatever the engine's catalog settled on. A control the reader has not
 * touched stays out of the link — see the note in `permalink.js` on why a mode's
 * parameter is not an always-emitted key.
 *
 * The slider is `params.js`'s travel and bounds nothing: the box holds the number in
 * force, whatever a link carried, and the slider parks at the end nearest it.
 */
function buildParams() {
  paramStrip.replaceChildren();
  for (const key of link.MODE_PARAMETERS[view.mode] ?? []) {
    const control = modeParams.CONTROLS[key];
    const group = document.createElement("span");
    group.className = "group";
    group.title = control.tip;
    const label = document.createElement("label");
    label.textContent = control.label;
    label.htmlFor = `param-${key}`;
    const slider = document.createElement("input");
    slider.type = "range";
    slider.className = "slider";
    Object.assign(slider, modeParams.travel(key));
    slider.dataset.key = key;
    slider.setAttribute("aria-label", control.label);
    // A texture weight is a recolour and follows the hand; everything else re-iterates
    // and waits for it to let go.
    slider.addEventListener("input", () => {
      if (control.live) setParam(key, modeParams.sliderText(key, slider.value));
    });
    slider.addEventListener("change", () => setParam(key, modeParams.sliderText(key, slider.value)));
    const input = document.createElement("input");
    input.type = "number";
    input.id = `param-${key}`;
    input.className = "param";
    input.step = control.step;
    input.dataset.key = key;
    input.addEventListener("change", () => setParam(key, input.value.trim()));
    group.append(label, slider, input);
    paramStrip.append(group);
  }
  syncParams();
}

/** One mode parameter, as its box or slider now says it. A value that is not a number
 *  puts the control back; a range is the contract's and the engine's to refuse. */
function setParam(key, text) {
  if (locked()) {
    syncParams();
    return;
  }
  const value = Number(text);
  if (text === "" || !Number.isFinite(value)) {
    syncParams();
    return;
  }
  // A slider fires `change` on release after `input` has already set the same value.
  if (view.params[key] === value) return;
  view = { ...view, params: { ...view.params, [key]: value } };
  changed();
  // A number the reader set in the derived control is theirs, and a pan does not measure
  // it away.
  if (key === link.DERIVED[view.mode]) tuning = "pinned";
  syncParams();
  draw();
}

/** A parameter's value as its box shows it: the number in force, which a derivation has
 *  already rounded to the figures the module keeps. */
function shownParam(value) {
  return value === undefined ? "" : String(value);
}

/**
 * The boxes' values and the line beside them, after a derivation moved a value or the
 * reader pinned one. A box somebody is typing in is left alone.
 */
function syncParams() {
  const settled = planOf(view).params ?? {};
  for (const input of paramStrip.querySelectorAll("input")) {
    if (document.activeElement === input) continue;
    const value = view.params[input.dataset.key] ?? settled[input.dataset.key];
    if (input.type === "range") {
      if (value !== undefined) input.value = String(modeParams.sliderAt(input.dataset.key, value));
    } else {
      input.value = shownParam(value);
    }
  }
  const key = link.DERIVED[view.mode];
  if (key === undefined) {
    paramNote.textContent = "";
    return;
  }
  const what = key === "weight" ? "Texture" : "Opacity";
  if (tuning === "pinned") {
    paramNote.textContent = `${what} set by hand, and kept as the view moves.`;
  } else if (tuning === "stored") {
    paramNote.textContent =
      tunedFrom === "seat" ? `${what} as this wallpaper was made.` : `${what} as this link carries it.`;
  } else if (probed !== null && probed.opacity === null) {
    paramNote.textContent = `${what} left as it was: nothing in this view to measure.`;
  } else {
    paramNote.textContent = `${what} taken from this view.`;
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
        slider.step = control.slider.step ?? control.step;
        slider.setAttribute("aria-label", control.label);
        slider.addEventListener("input", () => {
          if (!planOf(view).direct) setShade(control.key, shade.sliderText(control, slider.value));
        });
        slider.addEventListener("change", () =>
          setShade(control.key, shade.sliderText(control, slider.value)),
        );
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
  // Autolevel is written in the page rather than built here, and closes the row: it is a
  // shade setting a reader turns, though not a key a link carries.
  shadeBar.append(chips, levelGroup);
}

/** The one action on the Palette header. It is disabled with nothing to put back, and its
 *  label carries the count that used to be a separate line of text beside the heading. It
 *  resets the shade keys and nothing else: the map itself is a pick, not a setting. */
shadeReset.addEventListener("click", () => {
  if (locked()) return;
  view = { ...view, shade: shade.defaultShade() };
  changed();
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
  changed();
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
      // The box keeps the number the link said; the slider sits where `shade.js` puts it.
      if (held.slider) held.slider.value = String(shade.sliderAt(control, text));
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

  // And a table that reads the same in both directions gives Reverse nothing to turn. The
  // key keeps whatever the link said — a symmetric map sent reversed is the same picture
  // either way — and the chip says why it is resting.
  const flip = shadeWidgets.get("reverse");
  const same = symmetric(view);
  flip.box.disabled = busy || same;
  flip.box.title = same
    ? `${shownName(view.palette)} reads the same in both directions, so Reverse would not change it.`
    : SHADE_TIPS.reverse;

  syncFinal();

  // The count names every key set, the ones with no control included: a link that set
  // the rolloff is a recipe this button resets, and its title is where that is said.
  const set = shade.chosen(view.shade);
  const labels = set.map((key) => shade.CONTROLS.find((control) => control.key === key).label);
  shadeReset.disabled = busy || set.length === 0;
  shadeReset.textContent = set.length === 0 ? "Reset palette" : `Reset palette (${set.length})`;
  shadeReset.title = set.length === 0
    ? "Every shade setting is at its default."
    : `${sentenceList(labels)} ${set.length === 1 ? "differs" : "differ"} from the default.`;

  // Four of the seven are inert under a direct trap, and the engine says so where it
  // paints: those modes composite gradient samples as they iterate and never make a
  // field, so there is no distribution for a gamma or a transfer to spend. What does
  // reach them is the bake — a reversed or folded map is a different gradient — and the
  // rolloff, which acts after a colour has been chosen and has no control here.
  // Where Autolevel is unused as well, which is every direct trap today, it joins the list:
  // this line is the whole of what the shade row has to say about a direct trap, since the
  // box beside it says nothing now but disabled.
  const plan = planOf(view);
  const inert = plan.levels === true
    ? "Gamma, Cycles, Phase and Transfer"
    : "Autolevel, Gamma, Cycles, Phase and Transfer";
  shadeNote.textContent = plan.direct
    ? `This mode paints as it draws, so ${inert} have no effect here. Reverse and Mirror ` +
      "still apply, and each one redraws the picture."
    : "";

  syncLevel();
}

/**
 * The palette strip over the tabs, and the map's display name in the header above it.
 * The underlying name is not shown here; Details and Copy view carry it.
 *
 * Drawn by the module rather than here — see `ramp` in `render.js` — at the canvas's own
 * width, so every column is one lookup. A recipe the module refuses leaves the strip
 * showing the last one it drew; the refusal is said where the picture is.
 */
function syncFinal() {
  paletteShown.textContent = shownName(view.palette);
  let pixels;
  try {
    pixels = renderer.ramp(view, paletteStrip.width, { direct: planOf(view).direct === true });
  } catch {
    return;
  }
  const row = new ImageData(pixels, paletteStrip.width, 1);
  paletteStrip.getContext("2d").putImageData(row, 0, 0);
}

/** How many samples the symmetry test reads the table at, and how far apart, in sRGB8
 *  per channel, a sample and its mirror image may be and still count as the same. On
 *  the library as baked the 301 maps that pass are within one step of their reversal
 *  (the one is the module's rounding) and the nearest map that fails is fourteen away. */
const SYMMETRY_SAMPLES = 256;
const SYMMETRY_TOLERANCE = 2;

/** Whether the test has an answer for a map, by name and fold. */
const SYMMETRIC = new Map();

/**
 * Whether the view's table reads the same backwards, which is when Reverse is inert.
 *
 * **Decided by the table and not by the recipe.** Mirror on passes by construction, but so
 * does a cyclic map whose own stops are an out-and-back. The table is the strip's — the
 * module's `ramp`, through the map and the fold — at gamma 1, one cycle, phase 0 and no
 * tone curve, because each of those places a field value on the table rather than being
 * part of it, and read before Reverse. Where the module cannot answer yet, Mirror is.
 */
function symmetric(view) {
  const key = `${view.shade.mirror ? 1 : 0}|${view.palette}`;
  const known = SYMMETRIC.get(key);
  if (known !== undefined) return known;
  let pixels;
  try {
    const table = { palette: view.palette, shade: { ...shade.defaultShade(), mirror: view.shade.mirror } };
    pixels = renderer.ramp(table, SYMMETRY_SAMPLES);
  } catch {
    return view.shade.mirror;
  }
  let same = true;
  for (let at = 0; same && at < SYMMETRY_SAMPLES; at += 1) {
    const back = (SYMMETRY_SAMPLES - 1 - at) * 4;
    for (let channel = 0; channel < 3; channel += 1) {
      if (Math.abs(pixels[at * 4 + channel] - pixels[back + channel]) > SYMMETRY_TOLERANCE) {
        same = false;
        break;
      }
    }
  }
  SYMMETRIC.set(key, same);
  return same;
}

/** `a`, `a and b`, `a, b and c`. */
function sentenceList(words) {
  return words.length < 2 ? words.join("") : `${words.slice(0, -1).join(", ")} and ${words.at(-1)}`;
}

/**
 * The autolevel box: ticked or not, and nothing beside it.
 *
 * **Both halves of the operator are on this page now**, and which one runs is
 * `levelling`'s business rather than the box's. A view that arrived replays the curve it
 * arrived with; a view the reader made is measured on its own finished picture. The box is
 * the same box for both — it takes the curve away, and gives it back or asks for one — and
 * it opens ticked only on a view that arrived with a curve (see `levelOn`). It is disabled
 * only where the operator has nothing to say: a direct trap, whose statistics describe the
 * ground rather than the picture, and the modulate, which reads a different place in the
 * map per sample so a curved map would not be the same picture with its tone moved.
 *
 * **The row is a label and a box and stops there** *(2026-09-17)*. It used to carry a
 * running sentence — which curve was in force, whether the measurement had found anything
 * to do — that changed under the reader as a view arrived or a pass finished, and reflowed
 * the row with it. A control that rewrites itself while you look at it is a control that
 * has to be read every time. What the sentence said is either already on the page or is
 * Details' to say: the box's own state says whether a curve is in force, `disabled` says
 * the mode has no use for one, and which operator measured it, in band or not, is in the
 * Details readout and in Copy view. The one thing left that a box cannot say — what
 * autolevel *is* — is a tooltip on the box, which is where every other control on this
 * page keeps its explanation.
 */
function syncLevel() {
  const plan = planOf(view);
  const levels = plan.levels === true;
  levelToggle.checked = levels && levelOn;
  levelToggle.disabled = busy || !levels;
}

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
  syncPlane();
  syncToggles();
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
  arrived();
  if (key !== null) tunedFrom = "seat";
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

/** A view just arrived from a link: it replays what it carries. See `levelling`. */
function arrived() {
  levelling = "stored";
  levelOn = view.level !== null;
  storedCurve = view.level;
  derivedInBand = false;
  // A link that carries its derived parameter replays it; one that leaves it out asks for
  // it to be taken from the view, which is what an absent one means since permalink v3.
  const key = link.DERIVED[view.mode];
  tuning = key !== undefined && view.params[key] === undefined ? "derived" : "stored";
  tunedFrom = "link";
}

/** The reader changed the picture: the seat note goes, and the tone is measured from now
 *  on. Every control that moves the view comes through here and the Autolevel box does
 *  not — switching a curve off is looking at the same view. */
function changed() {
  leaveSeat();
  levelling = "derived";
  if (tuning === "stored") tuning = "derived";
}

/** A place, as the identity a seat and a view share: family, constants and frame. */
function placeOf(current) {
  return [
    current.family,
    ...link.CONSTANTS[current.family].map((key) => current.constants[key].text),
    current.x.text,
    current.y.text,
    current.w.text,
  ].join("|");
}

/**
 * Index the gallery's seats by place and mode, and find what each trap mode's seats were
 * most often drawn at. Read off the links the record carries, through the contract, so a
 * seat's parameters are exactly what opening it would give.
 */
function indexSeats(rows) {
  const tallies = {};
  for (const row of rows) {
    let seated;
    try {
      seated = link.parse(`?${row.link}`, contract);
    } catch {
      continue;
    }
    seatsByPlace.set(`${placeOf(seated)}|${seated.mode}`, seated.params);
    // What a trap mode is most often drawn at is read off the published gallery alone, so
    // an unpublished collection cannot move a default somebody has already seen.
    if (!Object.hasOwn(row.collections ?? {}, gallery.GENERAL)) continue;
    const key = link.DERIVED[seated.mode];
    if (key !== "opacity" || seated.params[key] === undefined) continue;
    const tally = (tallies[seated.mode] ??= new Map());
    tally.set(seated.params[key], (tally.get(seated.params[key]) ?? 0) + 1);
  }
  for (const [mode, tally] of Object.entries(tallies)) {
    const [value] = [...tally].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0];
    seatedParams[mode] = { opacity: value };
  }
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

/** The mounted atlas frame, once the tab has been opened. */
let atlasFrame = null;

/**
 * The atlas plane a view belongs to: its own family on a parameter plane or Phoenix, and
 * the parameter plane of the same degree for a Julia set, because a Julia place is a `c`
 * and `c` is a point of that plane. Partitions are named for their families.
 *
 * **The plane chips and the view never drift** *(explorer_controls_ckpt129)*. A chip
 * clicked opens its plane's home view, and a view that lands on another plane by any
 * route — a link, a seat, a family change, Julia here — moves the chip. So which plane is
 * open is the picture's to say and is no longer a key of its own: `panel=atlas:phoenix`
 * from an older address still opens the atlas tab, and the plane comes from the view.
 */
function planeOf(family) {
  return PARENT_PLANE[family] ?? family;
}

/** Move the atlas's chip to the view's plane, where the atlas is mounted. */
function syncPlane() {
  atlasFrame?.open(planeOf(view.family));
}

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
  // An older address may say which plane, after a colon; the view says that now.
  const [name] = String(asked).split(PANEL_AT);
  showing = tabs.some((tab) => tab.dataset.panel === name) ? name : DEFAULT_PANEL;
  for (const tab of tabs) {
    const mine = tab.dataset.panel === showing;
    tab.setAttribute("aria-selected", String(mine));
    document.getElementById(`panel-${tab.dataset.panel}`).hidden = !mine;
  }
  // The Collection select sits in the header row beside the tabs rather than inside the
  // gallery panel, so it is the one control the panel has to hide itself: what it chooses
  // means nothing while the atlas is showing.
  document.getElementById("gallery-collection").hidden = showing !== "gallery";
  if (showing === "atlas") startAtlas();
  settle();
}

async function startAtlas() {
  if (atlasStarted) return;
  atlasStarted = true;
  const host = document.getElementById("atlas-host");
  const note = document.getElementById("atlas-note");
  try {
    const { mount } = await import("../atlas/frame.js");
    atlasFrame = await mount(host, {
      base: new URL("../atlas/", import.meta.url),
      plane: planeOf(view.family),
      onPlane: (name) => {
        const family = atlasFrame.record.partitions.find((one) => one.partition === name)?.family;
        if (family === undefined || !openFamily(family)) syncPlane();
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
    // The view may have moved plane while the record was being read.
    syncPlane();
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
  // A letter means nothing to a button, so the toggles' keys still work with focus on one
  // — the button just pressed, most often.
  const target = event.target instanceof Element ? event.target.tagName : "";
  const toggle = TOGGLE_KEYS[event.key];
  if (toggle && !event.ctrlKey && !event.altKey && !event.metaKey && !event.repeat &&
      (target === "BUTTON" || !TYPING.has(target))) {
    event.preventDefault();
    if (!busy && !(document.activeElement?.isContentEditable)) toggle();
    return;
  }
  if (TYPING.has(target)) return;
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

/** A view on another plane with everything the reader chose carried across: the mode and
 *  its parameters, the aspect, the palette, the shade recipe and the tone. */
function carried(onto) {
  return {
    ...onto,
    params: view.params,
    aspect: view.aspect,
    palette: view.palette,
    shade: view.shade,
    level: view.level,
  };
}

/** A new family is a new plane, so it opens at that plane's own home view. The mode, the
 *  palette and the shade recipe are the reader's and travel with them. Returns whether it
 *  moved, which a download in progress refuses. */
function openFamily(family) {
  if (locked()) return false;
  view = carried(link.fresh(family, view.mode, contract));
  changed();
  rebuild();
  draw();
  return true;
}

familyPicker.addEventListener("change", () => {
  if (!openFamily(familyPicker.value)) familyPicker.value = view.family;
});

// ------------------------------------------------------------------- the view toggles
//
// Four buttons at the right of the Download row, each with a key. They are the whole of
// this row on purpose: anything further is a shortcut, not chrome.

const resetButton = document.getElementById("view-reset");
const juliaButton = document.getElementById("view-julia");
const randomPaletteButton = document.getElementById("view-palette");
const randomPhaseButton = document.getElementById("view-phase");

/** Each button's words and its key, which is what it says on hover. */
const TOGGLE_TIPS = {
  reset: "Back to this plane's home view, keeping the mode and palette. (R)",
  julia: "Open the Julia set whose c is the center of this view. (J)",
  back: "Back to the plane this Julia set's c is a point of. (J)",
  phoenix: "Phoenix has no parameter plane here to take a Julia set from. (J)",
  palette: "A palette drawn at random from the picker, on the same view. (P)",
  phase: "A random phase, with everything else kept. (Shift+P)",
};
resetButton.title = TOGGLE_TIPS.reset;
randomPaletteButton.title = TOGGLE_TIPS.palette;
randomPhaseButton.title = TOGGLE_TIPS.phase;

/** The parent view Julia here left, as `{ julia, cx, cy, parent }` — the Julia family and
 *  `c` it opened, and the parent's canonical query — or `null`. */
function heldParent() {
  try {
    return JSON.parse(sessionStorage.getItem(HELD_PARENT) ?? "null");
  } catch {
    return null;
  }
}

function holdParent(held) {
  try {
    if (held === null) sessionStorage.removeItem(HELD_PARENT);
    else sessionStorage.setItem(HELD_PARENT, JSON.stringify(held));
  } catch {
    // A tab that stores nothing still has Back: it lands on the parent plane at `c`.
  }
}

/** The Julia button's face: Julia here on a parameter plane, Back on a Julia set, and
 *  resting on Phoenix. Every Julia set gets Back, a copied link's included, because its
 *  `c` always names a point of a plane to go back to. */
function syncToggles() {
  const onJulia = view.family in PARENT_PLANE;
  juliaButton.textContent = onJulia ? "Back" : "Julia here";
  const tip = onJulia ? "back" : view.family in JULIA_OF ? "julia" : "phoenix";
  juliaButton.title = TOGGLE_TIPS[tip];
  juliaButton.disabled = busy || tip === "phoenix";
  for (const button of [resetButton, randomPaletteButton, randomPhaseButton]) button.disabled = busy;
}

/** The current plane's home viewport, with the mode, palette and everything else kept. */
function resetView() {
  if (locked()) return;
  const home = homeOf(view.family);
  view = { ...view, x: home.x, y: home.y, w: home.w };
  changed();
  draw();
}

/** Julia here, or Back from it. */
function toggleJulia() {
  if (locked()) return;
  if (view.family in PARENT_PLANE) {
    juliaBack();
  } else if (view.family in JULIA_OF) {
    juliaHere();
  }
}

/** The view's centre as `c`, opened as that plane's Julia set at its home view. The
 *  centre's own decimal strings become `c`, so no precision is lost on the way. */
function juliaHere() {
  const julia = JULIA_OF[view.family];
  const parent = link.emit(view, contract);
  view = carried({
    ...link.fresh(julia, view.mode, contract),
    constants: { cx: view.x, cy: view.y },
  });
  holdParent({ julia, cx: view.constants.cx.text, cy: view.constants.cy.text, parent });
  changed();
  rebuild();
  draw();
}

/**
 * Back to the parameter plane. Where this tab opened the Julia set on the screen, it
 * returns to the view it left; anywhere else — a copied link, a seat, a `c` typed in
 * Details — it lands on the parent plane at `c`, at that plane's home width. Either way
 * the mode, palette and recipe in force now come along, as they did on the way in.
 */
function juliaBack() {
  const plane = PARENT_PLANE[view.family];
  const held = heldParent();
  let geometry = { x: view.constants.cx, y: view.constants.cy, w: homeOf(plane).w };
  if (
    held !== null &&
    held.julia === view.family &&
    held.cx === view.constants.cx.text &&
    held.cy === view.constants.cy.text
  ) {
    try {
      const parent = link.parse(`?${held.parent}`, contract);
      if (parent.family === plane) geometry = parent;
    } catch {
      // A held view this contract no longer reads is no view to go back to.
    }
  }
  view = carried({
    ...link.fresh(plane, view.mode, contract),
    x: geometry.x,
    y: geometry.y,
    w: geometry.w,
  });
  holdParent(null);
  changed();
  rebuild();
  draw();
}

/** A palette drawn at random from every map the picker lists, never the one on screen. */
function randomPalette() {
  const names = [...PALETTES.keys()].filter((name) => name !== view.palette);
  if (names.length > 0) pickPalette(names[Math.floor(Math.random() * names.length)]);
}

/** A random phase, at the slider's own three decimals. */
function randomPhase() {
  setShade("phase", String(Number(Math.random().toFixed(3))));
}

resetButton.addEventListener("click", resetView);
juliaButton.addEventListener("click", toggleJulia);
randomPaletteButton.addEventListener("click", randomPalette);
randomPhaseButton.addEventListener("click", randomPhase);

/** The four toggles' keys. A bare letter, or Shift and one; with Ctrl, Alt or Meta held a
 *  key is the browser's. */
const TOGGLE_KEYS = { r: resetView, j: toggleJulia, p: randomPalette, P: randomPhase };

/** A new mode keeps the place and drops the parameters, because they belonged to
 *  the mode that is being left. */
modePicker.addEventListener("change", () => {
  const mode = modePicker.value;
  // Where a seat sits at this place in the mode being switched to, the switch is back to
  // that seat's picture, parameters and all; anywhere else a trap opens at what its seats
  // were most often drawn at, and the draw takes the derived parameter from the view.
  const seated = seatsByPlace.get(`${placeOf(view)}|${mode}`);
  view = { ...view, mode, params: { ...(seated ?? seatedParams[mode] ?? {}) } };
  // A mode that was only listed because the view arrived in it goes, now it is left.
  syncModes();
  changed();
  tuning = seated !== undefined ? "stored" : "derived";
  tunedFrom = "seat";
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
  changed();
  palettes.show(name);
  draw();
}

levelToggle.addEventListener("change", () => {
  if (locked()) {
    syncLevel();
    return;
  }
  levelOn = levelToggle.checked;
  // A view that arrived with no curve has none to give back, so ticking it on is asking for
  // one to be measured: the view is `derived` from here, the way it would be after a move.
  if (levelOn && levelling === "stored" && storedCurve === null) levelling = "derived";
  if (levelling === "stored") {
    view = { ...view, level: levelOn ? storedCurve : null };
  } else if (!levelOn) {
    view = { ...view, level: null };
  }
  // A derived view ticked on has no curve to put back: the draw measures it, off the field
  // already cached, which is a recolour and not a render.
  //
  // Not `changed`: switching the seat's own curve off is looking at the seat, and the note
  // that says what the link could not carry is still the thing worth reading.
  updateReadout();
  syncLevel();
  draw();
});

/** The picture's permalink, as Copy link writes it: the picture and none of the furniture. */
function permalink() {
  const url = new URL(window.location.href);
  url.search = `?${link.emit(view, contract)}`;
  url.hash = "";
  return url.toString();
}

copyButton.addEventListener("click", async () => {
  const url = permalink();
  try {
    await navigator.clipboard.writeText(url);
    say("Link copied.");
  } catch {
    say(url);
  }
});

/**
 * The whole view as one JSON object, for pasting into a working session rather than for
 * a reader: complete and exact, not pretty.
 *
 * **The recipe is the final stage's spec**, built by the same `specOf` call the pass makes
 * and planned by the same module, so `plan` is the engine's own answer — the cap, the
 * lanes, and every mode parameter at the value it resolved to, not only the ones a link
 * set. Two substitutions, both said here: the colormap is the map's underlying name in
 * place of its hundreds of stops, and `autolevel` is the curve in force. A replayed curve
 * is what the worker was handed; a derived one is what the worker measured and handed
 * back, and `level.source` says which.
 */
function viewRecord() {
  const recipe = specOf(view, grid.width, grid.height, {
    colormap: false,
    supersample: FINAL_SUPERSAMPLE,
  });
  const plan = renderer.plan(recipe);
  recipe.colormap = view.palette;
  if (view.level) {
    const { operator, ...curve } = view.level;
    recipe.autolevel = curve;
  }
  return {
    permalink: permalink(),
    state: renderState.dataset.state,
    stats: stats.textContent,
    recipe,
    plan,
    palette: { name: view.palette, shown: shownName(view.palette) },
    params: {
      derived_key: link.DERIVED[view.mode] ?? null,
      source: link.DERIVED[view.mode] === undefined ? null : tuning,
      ...(probed !== null ? { probe: probed } : {}),
    },
    level: {
      on: levelOn,
      source: levelling === "stored" ? "replayed" : "derived",
      operator: view.level?.operator ?? null,
      curve: view.level,
      ...(levelling === "derived" ? { in_band: derivedInBand } : {}),
    },
    readout: readout.textContent,
    not_carried: differs.textContent || null,
    seat,
    provenance: { line: document.getElementById("provenance").textContent, ...PROVENANCE },
  };
}

/** How long Copy view says Copied before it goes back to its own name. */
const COPIED_FOR = 1500;
let copiedTimer = 0;

copyViewButton.addEventListener("click", async () => {
  const text = JSON.stringify(viewRecord(), null, 2);
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    console.log(text);
    say("The view could not be copied; it is in the console.");
    return;
  }
  copyViewButton.textContent = "Copied";
  clearTimeout(copiedTimer);
  copiedTimer = setTimeout(() => {
    copyViewButton.textContent = "Copy view";
  }, COPIED_FOR);
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
  paletteNames = shownNames(names);
  if (!(record instanceof Error)) {
    // The published gallery's modes, and not every collection's: a collection may seat a
    // mode the general gallery does not, and the select's roster is the published one's.
    offeredModes = [
      ...new Set(gallery.membersOf(record.seats, gallery.GENERAL).map((seat) => seat.mode)),
    ];
  }

  contract = {
    home: homeOf,
    constants: seedConstants,
    palettes: PALETTES,
    defaultPalette: DEFAULT_PALETTE,
    settled: (mode) => SETTLED[mode],
  };
  if (!(record instanceof Error)) indexSeats(record.seats);

  fill(familyPicker, link.FAMILIES);

  try {
    view = link.parse(window.location.search, contract);
  } catch (error) {
    refuse(`${error.message} Nothing has been drawn, because guessing what was meant would be worse than saying so.`);
    return;
  }
  arrived();
  // A bare page names no picture, so there is nothing it arrived with to replay: the
  // explorer's own home view is measured like any view a reader made.
  const named = [...new URLSearchParams(window.location.search).keys()].filter(
    (key) => !link.UI_KEYS.has(key),
  );
  if (named.length === 0) levelling = "derived";

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
    // Whether a download measures its own tone. A derived view's curve is a measurement
    // of the frame on the screen, and a download is a different frame, so it derives
    // again on the picture it draws; a stored view replays its curve at any size.
    deriving: () => levelling === "derived" && levelOn,
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
    collection: document.getElementById("gallery-collection"),
    modes: document.getElementById("gallery-modes"),
    hues: document.getElementById("gallery-hues"),
    // The hue row asks one of two questions depending on the collection, and says which
    // in its own heading, so the panel is handed the heading rather than the text.
    hueHead: document.getElementById("head-gallery-hues"),
    tiles: document.getElementById("gallery-tiles"),
    note: document.getElementById("gallery-note"),
    firstMode: MODE_FIRST,
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
