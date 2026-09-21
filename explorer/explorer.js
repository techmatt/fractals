// The explorer: a studio, and an address bar that is always a valid permalink.
//
// Two panels. On the left, pictures somebody can open: a thousand seated wallpapers, the
// atlas of every place the search kept, or what a walk run here has found. On the right, the viewer — the canvas, and
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
import * as saving from "./saved.js";
import * as juliaPreview from "./julia-preview.js";
import { Trail } from "./undo.js";
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

/**
 * The words a button names a plane with: `Mandelbrot`, `Multibrot 6`, `Phoenix`, and
 * `Julia` for a Julia set of any degree, whose degree is the parent plane's to say and is
 * on the button beside it.
 *
 * A rule rather than a table, over the one shape every family name in the contract has —
 * a word, and a degree where the family is one of a numbered series. The spelling it
 * produces is the atlas record's `slot_labels`, which is where a reader meets these words
 * elsewhere on this page; it is derived here rather than read from there because the atlas
 * is mounted only when its panel is first opened, and a button is named at load. Details'
 * Family select still spells a family the way a link spells it, which is the same split
 * the palettes make: shown by a display name, addressed by its own.
 */
function planeName(family) {
  if (family in PARENT_PLANE) return "Julia";
  const parts = /^([a-z]+)(\d*)$/.exec(family);
  if (parts === null) return family;
  const word = parts[1][0].toUpperCase() + parts[1].slice(1);
  return parts[2] === "" ? word : `${word} ${parts[2]}`;
}

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
const saveButton = document.getElementById("save-view");
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
/** The Deep tab's contract context: the same palette set, and the two numbers neither
 *  contract owns. Built beside `contract` at boot. */
let deepContext = null;

/**
 * `deep-link.js`, once something has needed it.
 *
 * **Not a static import, and the 8 KB is the reason.** That module pulls in exact `BigInt`
 * arithmetic, and a reader who never opens the Deep tab should not download either — the
 * eager bundle is what the first frame waits through. What the page needs at the door is
 * only the *question* — is this a deep link — and that is one line in `permalink.js`,
 * which is eager anyway. So the marker is asked there and the reader is fetched here,
 * when a deep link is actually in front of the page: in the address, in the saved list,
 * or because the tab was opened.
 */
let deepRules = null;

/** Fetch the deep contract, once, and let every synchronous caller see it. */
async function loadDeepRules() {
  if (deepRules === null) {
    deepRules = await import("./deep-link.js");
    // Anything asked about a deep link before this landed was told `null`. The answers
    // are cached, so they are dropped and the marks on the page are dressed again.
    canonicalLinks.clear();
    if (saved !== null) saving.remark(saved);
  }
  return deepRules;
}
let view = null;
let grid = { width: 0, height: 0 };
let settleTimer = 0;
let panel = null;
let palettes = null;
let tiles = null;
/** The Julia preview under the pointer, once the page is up. */
let juliaCard = null;
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

/** The modes the Mode select offers: the published collection's, which the gallery header
 *  carries as `modes`. `null` until the header is read, and where it cannot be, every mode the
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

/** Where the value of the mode's derived parameter comes from: `stored`, `derived`,
 *  `default` or `pinned`. The parameter is `link.DERIVED`'s — an angle mode's texture weight, a trap's
 *  opacity — and the other modes have none, which leaves this with nothing to say.
 *
 *  **`stored` replays what a view arrived with**, the same as a tone curve: a seat, an atlas
 *  mark or a link carries the number its picture was drawn at, and a mode switch back into
 *  the mode a seat sits in carries that seat's own. **`derived` takes it from the view**:
 *  a view that arrived without one, a switch into a trap mode no seat here sits in, and
 *  every view after the first change a reader makes to a stored one. The weight is
 *  measured on the one-sample field before it is coloured and the opacity on a probe
 *  before anything is painted, and either lands in `view.params`, which is what the box
 *  shows and Copy link writes. **`default` is `TEXTURE_DEFAULT`**, which a switch into an
 *  angle mode no seat here sits in opens at, and it holds like a pinned one. **`pinned` is
 *  a number the reader typed**, and it holds
 *  through pans and zooms until the mode changes. A link cannot say which of these
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

/** The texture weight a mode switch opens a screened composite at, where no seat sits at
 *  that place in that mode *(Matt, explorer_three_collections_texture_ckpt130)*. The
 *  catalog's 0.85 is what every composite was mined at until the weight was drawn per
 *  candidate, and the drawn weights clear the judges more often the lower they sit; 0.5 is
 *  the texture seen without drowning the escape structure. It is written into the view, so
 *  the link carries it and the contract is unmoved: a link that leaves `weight` out still
 *  asks for it to be taken from the view. `threads` is already settled here. */
const TEXTURE_DEFAULT = 0.5;

/** A hand switch's parameters for a mode no seat at this place sits in. */
function switchedParams(mode) {
  const params = { ...(seatedParams[mode] ?? {}) };
  const settled = SETTLED[mode]?.weight;
  if (settled !== undefined && settled !== TEXTURE_DEFAULT) params.weight = TEXTURE_DEFAULT;
  return params;
}

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
  syncSave();
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
  // A download is about to have every core it can get, and a hover is not what they are
  // for. `previewable` keeps it away until the download is done.
  if (on) juliaCard?.hide();
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

/**
 * A message under the canvas with something to press at the end of it.
 *
 * The one place the page makes an offer rather than a statement, and it exists for the
 * one moment where saying no would be unhelpful: a reader who has zoomed until the
 * arithmetic gives out has asked, as plainly as this page allows, for the thing the Deep
 * tab does. Telling them it is impossible, when a tab three inches to the left does it,
 * would be a sentence that is no longer true.
 */
function offer(text, label, action) {
  say(text);
  const button = document.createElement("button");
  button.type = "button";
  button.className = "say-action";
  button.textContent = label;
  button.addEventListener("click", action);
  status.append(" ", button);
}

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

/** A refusal: the picture is not drawn, and the reason is on the page.
 *
 *  **The dot stops with it.** It opens on `rendering`, which is the truth while the
 *  module is fetching and the first pass is ahead; a refusal is the end of that pass and
 *  the dot has to say so, because the studio is hidden behind the notice and nothing else
 *  will move it. It read `Rendering` forever otherwise — a link carrying `mirror=1` with
 *  no palette key refuses (the default map is cyclic), and a harness watching the dot and
 *  the stat line rather than the notice reads that as a page that hung silently, which is
 *  what cost `explorer_shade_pool_ckpt136` two runs. */
function refuse(message) {
  notice.textContent = message;
  notice.hidden = false;
  studio.hidden = true;
  showState("stopped");
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

/**
 * The plan a deep view implies, which is a constant rather than a question.
 *
 * The Deep tab draws `smooth` and nothing else — one field, coloured after the fact — so
 * it is not a direct trap, and the tone operator acts on it. Asking `engine.wasm` would
 * mean building a spec around a viewport it refuses, to be told what is already known.
 */
const DEEP_SHAPE = { ok: true, direct: false, levels: true };

/**
 * Whose colour the Palette section is turning.
 *
 * The viewer's view, or the Deep tab's while that tab owns the viewer. Both carry the
 * same three fields — `palette`, `shade` and `level` — and they carry them in the same
 * shapes, because the deep link spells the colour keys the shallow link's way and both
 * hand them to the same `Palette` recipe on the module's boundary. So one set of controls
 * serves both, and the indirection is here rather than a second Palette section.
 */
function tinting() {
  return deep !== null && deep.owns() ? deep.view() : view;
}

/** And the plan those controls read, for whichever view that is. */
function tintedShape() {
  return deep !== null && deep.owns() ? DEEP_SHAPE : planOf(view);
}

/**
 * Write back a colour the reader just turned, to whichever view it belongs to.
 *
 * A deep recolour never re-iterates — the field is kept, and that is what the Deep tab's
 * cache is for — so the two sides differ in what follows the write and not in the write.
 */
function tint(changes, { moved = true, moving = false } = {}) {
  if (deep !== null && deep.owns()) {
    deep.tint(changes);
    syncShade();
    return;
  }
  view = { ...view, ...changes };
  if (moved) changed();
  syncShade();
  // `moving` is a hand still on the control — see `live`. Everything else draws at once.
  if (moving) live();
  else draw();
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
  // Down in the Deep tab a zoom is exact arithmetic on a decimal centre, and it draws
  // nothing. There is no floor to refuse at: going deeper is what that tab is for.
  if (deepOwns()) {
    deep.zoom(px, py, factor);
    return;
  }
  const anchor = planeAt(px, py);
  const width = view.w.value * factor;
  if (factor < 1 && !renderer.resolves(view.x.value, view.y.value, width, grid.width, grid.height)) {
    const wall =
      "This is as deep as this renderer can zoom here. It does its arithmetic in 64-bit " +
      "floating point, which carries about 16 significant digits, and at this " +
      "magnification the coordinates of neighboring pixels differ only in the last few " +
      "of them. Any deeper and adjacent pixels would round to the same number, so there " +
      "would be nothing left to draw. Going further needs higher-precision arithmetic, " +
      "which this renderer does not have.";
    // On the two sets `z² + c` draws, the page now has that arithmetic in a tab of its
    // own, and this frame is exactly what it opens at.
    if (carryable() !== null) {
      offer(
        `${wall} The Deep tab does, with a different kernel — slower, and this frame carries over.`,
        "Open this frame in Deep",
        () => showPanel("deep"),
      );
      return;
    }
    say(wall);
    return;
  }
  const scale = width / view.w.value;
  const before = view;
  moveTo(
    anchor.x + (view.x.value - anchor.x) * scale,
    anchor.y + (view.y.value - anchor.y) * scale,
    width,
  );
  reproject(before);
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
  paintMark();
}

/**
 * Put the picture that is up where the view now current would have drawn it.
 *
 * **A drag has always had this and a wheel did not.** Dragging slides the last frame under
 * the hand, so a pan already shows the reader where they are going while the pass runs; a
 * wheel zoom and an arrow key changed the view and left the old picture exactly where it
 * was, at the wrong scale and about the wrong point, until the quarter-resolution preview
 * replaced it a few hundred milliseconds later. Nothing about it was wrong except that it
 * was a picture of somewhere else.
 *
 * `before` is the view as it was. The old frame covers a rectangle of the plane, and where
 * that rectangle falls on the canvas now is exactly what `canvasAt` answers, so this is the
 * move rather than an approximation of it — one `drawImage` for a pan, a zoom, or both at
 * once. **It touches nothing but the canvas**: the frame buffer keeps the picture it was
 * given, so the next `present` and the next reprojection both start from the real one.
 */
function reproject(before) {
  const scale = before.w.value / view.w.value;
  const at = canvasAt(before.x.value, before.y.value);
  const width = grid.width * scale;
  const height = grid.height * scale;
  screen.fillStyle = "#000";
  screen.fillRect(0, 0, grid.width, grid.height);
  screen.imageSmoothingEnabled = true;
  screen.drawImage(frame, at.px - width / 2, at.py - height / 2, width, height);
  paintMark();
}

/**
 * Hand the off-screen frame to somebody else to draw, then put it up.
 *
 * The Deep tab's seam onto the canvas. Everything else on this page hands over a finished
 * `ImageData` and lets `present` blit it; the deep tab composes — a stale bitmap somewhere
 * that is not the whole canvas, and a box over it — so it needs the context rather than a
 * picture. What it does not need is its own canvas: going through `frame` keeps the double
 * buffer this page has always had, so a compose never shows a half-drawn screen.
 */
function compose(draw) {
  draw(frameScreen, grid);
  screen.drawImage(frame, 0, 0);
  paintMark();
}

// ------------------------------------------------------------------- the mark
//
// A point of the plane drawn over the picture. Two things use it and both are `c`: the
// crosshair Julia here shows while it is under the pointer, so that "here" is a place a
// reader can see before pressing anything, and the mark Back to a plane leaves on the `c`
// it came back from, which goes on its own.

/** The marked point as `{ family, x, y }`, or `null`. The family is carried because a
 *  plane coordinate means nothing on another plane: a mark left over from the view a
 *  Julia was opened from is not painted, rather than painted somewhere wrong. */
let mark = null;
let markTimer = 0;

/** How long the mark Back leaves on `c` stays up. */
const MARK_FOR = 1600;

/** The crosshair's arm, as a share of the canvas's shorter side, and the share of it left
 *  clear at the middle so that the point is not covered by its own mark. */
const MARK_ARM = 0.05;
const MARK_CLEAR = 0.35;

/** Where a point of the plane falls on the canvas, in the current view. */
function canvasAt(x, y) {
  return {
    px: ((x - view.x.value) / view.w.value + 0.5) * grid.width,
    py: (0.5 - (y - view.y.value) / planeHeight()) * grid.height,
  };
}

/**
 * Paint the mark, where there is one and it is on this plane and on the canvas.
 *
 * Onto the screen and never into `frame`, so that a drag's preview slides the picture
 * without the mark going with it, and every stage of a pass puts the mark back over the
 * picture it just drew. Four arms, each stroked twice — a wide dark stroke under a narrow
 * light one — because either alone is invisible against some picture on this page.
 *
 * The point is rounded to a whole pixel and the light stroke has a floor under its width,
 * both for the same reason: a hairline between two pixel centres is drawn as two half-lit
 * ones, and the first version of this mark came out at about half the brightness it asked
 * for and read as a smudge rather than as a crosshair.
 */
function paintMark() {
  paintOverlay();
  if (mark === null || mark.family !== view.family) return;
  const at = canvasAt(mark.x, mark.y);
  const px = Math.round(at.px);
  const py = Math.round(at.py);
  if (px < 0 || px > grid.width || py < 0 || py > grid.height) return;
  const arm = Math.min(grid.width, grid.height) * MARK_ARM;
  const clear = Math.round(arm * MARK_CLEAR);
  screen.save();
  for (const [ink, width, floor] of [["rgba(0, 0, 0, 0.6)", 0.22, 5], ["#fff", 0.09, 2]]) {
    screen.strokeStyle = ink;
    screen.lineWidth = Math.max(floor, Math.round(arm * width));
    screen.beginPath();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      screen.moveTo(px + dx * clear, py + dy * clear);
      screen.lineTo(px + dx * Math.round(arm), py + dy * Math.round(arm));
    }
    screen.stroke();
  }
  screen.restore();
}

// ------------------------------------------------------------------- the walk's overlay
//
// While a walk runs, the viewer shows the cell it is standing in and draws the cells it is
// weighing over the picture: each child a rectangle in the plane, labelled with what the
// judge said of it. Painted like the mark — onto the screen after every stage, never into
// `frame` — and on the family it was drawn for only.

/** `{ family, cells: [{ x, y, w, h, label, state, ink }] }`, or `null`. `state` is
 *  `weighing`, `skipped` or `chosen`, or `cell` for the faint outline of the cell they
 *  subdivide — the walk frames the viewer wider than that cell, so the quarters sit inside
 *  the picture. `ink` is the quarter's own color, which is its position's
 *  *(walk_view_ckpt132)*; a cell without one is stroked in the state's. */
let overlay = null;

/** The ink a cell without one of its own is stroked in, over a dark under-stroke that keeps
 *  it legible. */
const OVERLAY_INK = {
  weighing: "#fff",
  cell: "rgba(255, 255, 255, 0.4)",
};

/** How far a skipped quarter is faded: still drawn, in its color, so the picture and the
 *  stack's row agree on all four. */
const SKIPPED_ALPHA = 0.5;

function paintOverlay() {
  if (overlay === null || overlay.family !== view.family) return;
  const unit = Math.max(1, Math.round(Math.min(grid.width, grid.height) / 360));
  screen.save();
  screen.font = `${12 * unit}px system-ui, sans-serif`;
  screen.textBaseline = "top";
  for (const cell of overlay.cells) {
    const a = canvasAt(cell.x - cell.w / 2, cell.y + cell.h / 2);
    const b = canvasAt(cell.x + cell.w / 2, cell.y - cell.h / 2);
    const [left, top, width, height] = [a.px, a.py, b.px - a.px, b.py - a.py];
    const ink = cell.ink ?? OVERLAY_INK[cell.state] ?? OVERLAY_INK.weighing;
    const faint = cell.state === "cell";
    const skipped = cell.state === "skipped";
    screen.globalAlpha = skipped ? SKIPPED_ALPHA : 1;
    screen.setLineDash(skipped ? [6 * unit, 4 * unit] : faint ? [2 * unit, 3 * unit] : []);
    const under = faint ? "rgba(0, 0, 0, 0.25)" : "rgba(0, 0, 0, 0.55)";
    const extra = cell.state === "chosen" ? 2 * unit : 0;
    for (const [stroke, lineWidth] of [[under, 3 * unit + extra], [ink, unit + extra]]) {
      screen.strokeStyle = stroke;
      screen.lineWidth = lineWidth;
      screen.strokeRect(left, top, width, height);
    }
    if (cell.label) {
      const pad = 3 * unit;
      const box = screen.measureText(cell.label).width + 2 * pad;
      const inset = unit + extra;
      screen.setLineDash([]);
      screen.fillStyle = "rgba(0, 0, 0, 0.65)";
      screen.fillRect(left + inset, top + inset, box, 16 * unit);
      screen.fillStyle = ink;
      screen.fillText(cell.label, left + inset + pad, top + inset + 2 * unit);
    }
  }
  screen.restore();
}

/** The walk's own pictures, while the viewer is showing them rather than drawing: each
 *  `{ x, y, w, h, image, dim }`, a frame of the plane and the `ImageData` the walk computed
 *  for it, widest first. `null` whenever the viewer's renderer owns the screen; any pass
 *  that starts takes it away. *(walk_console_ckpt131)* */
let walkLayers = null;

/** How far a layer the walk has already left behind is darkened, so the frame it stands in
 *  reads as the picture and the one around it as context. */
const WALK_BACKDROP = 0.45;

/** Each layer's picture as a canvas, made once: `drawImage` scales a canvas and not an
 *  `ImageData`. */
const walkCanvases = new WeakMap();

function walkCanvasOf(image) {
  let made = walkCanvases.get(image);
  if (made === undefined) {
    made = document.createElement("canvas");
    made.width = image.width;
    made.height = image.height;
    made.getContext("2d").putImageData(image, 0, 0);
    walkCanvases.set(image, made);
  }
  return made;
}

/** Paint the walk's layers into `frame`, stretched to where their frames fall in the view,
 *  over black where they do not reach, and put the overlay back over them. */
function paintWalk() {
  frameScreen.fillStyle = "#000";
  frameScreen.fillRect(0, 0, grid.width, grid.height);
  frameScreen.imageSmoothingEnabled = true;
  for (const layer of walkLayers) {
    const a = canvasAt(layer.x - layer.w / 2, layer.y + layer.h / 2);
    const b = canvasAt(layer.x + layer.w / 2, layer.y - layer.h / 2);
    frameScreen.globalAlpha = layer.dim ? WALK_BACKDROP : 1;
    frameScreen.drawImage(walkCanvasOf(layer.image), a.px, a.py, b.px - a.px, b.py - a.py);
  }
  frameScreen.globalAlpha = 1;
  screen.drawImage(frame, 0, 0);
  paintMark();
}

/** Put the walk's cells over the picture, or take them away, and repaint. */
function showOverlay(next) {
  if (overlay === null && next === null) return;
  overlay = next;
  screen.drawImage(frame, 0, 0);
  paintMark();
}

/** Mark a point, or take the mark away, and repaint the picture that is up. */
function showMark(point) {
  clearTimeout(markTimer);
  if (mark === null && point === null) return;
  mark = point;
  screen.drawImage(frame, 0, 0);
  paintMark();
}

/** Mark a point for the pass that is about to draw, and for a moment after it lands.
 *  Nothing is repainted here: the picture up is the one being left, and the mark belongs
 *  over the one arriving. */
function flashMark(point) {
  clearTimeout(markTimer);
  mark = point;
  markTimer = setTimeout(() => showMark(null), MARK_FOR);
}

let drawing = 0;

/** The finished picture of the view on the screen — the last stage's, and only once it
 *  has landed. What a download at the screen's own size saves instead of drawing it
 *  again; cleared by every pass, because a picture of the view before is not this one. */
let finished = null;

/** The worker colouring the last stage, while it is. A pass that starts stops it. */
let colouring = {};

/**
 * The map the picture on the screen was drawn through, with the tone curve on it.
 *
 * **The curve is spent once a pass and this is where the answer is kept.** It acts on the
 * map rather than on the picture, so drawing the palette strip through the curve again
 * would be `level::curved_stops` a second time on the same map for the same stops — per
 * stop, and hundreds of milliseconds of main thread on a map with hundreds of them. What
 * the pass hands back goes here and the strip takes it.
 *
 * Held with what it is an answer *about*, and spent only where both agree: the stops
 * depend on the map's name and on the curve, and on nothing else in the recipe — the fold
 * and the flip are the bake's and happen after, and gamma, cycles and phase place a value
 * on the table rather than making it. `null` where the last pass curved nothing, which is
 * every view with no curve in force and is most of them.
 */
let curved = null;

/** What the pass drew through, for the strip: the map, the curve it answers for, and the
 *  stops themselves. A pass that curved nothing clears it. */
function keepStops(stops, level = view.level) {
  curved =
    stops === null || stops === undefined
      ? null
      : { palette: view.palette, level: JSON.stringify(level ?? null), stops };
}

/** The curved stops for this view, or `null` where the kept ones answer a different
 *  question — a palette the reader has just changed, or a curve this pass has not drawn
 *  yet. Then the strip asks for the curve as it always did. */
function curvedFor(subject) {
  if (curved === null || subject.palette !== curved.palette) return null;
  return JSON.stringify(subject.level ?? null) === curved.level ? curved.stops : null;
}

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
  inFlight = running;
  try {
    await running;
  } finally {
    if (inFlight === running) inFlight = null;
    if (pass === drawing) holdCopy(false);
    if (wantsLive) {
      wantsLive = false;
      draw();
    }
  }
}

/** The pass that is running, while it is. `live` waits on it rather than cutting it off. */
let inFlight = null;

/** Whether a control moved while a pass was running, so the latest value is still owed. */
let wantsLive = false;

/**
 * Redraw for a control the reader's hand is **still on**: one pass at a time, and the
 * last value wins.
 *
 * **A drag is not a queue and it is not a cancel either.** A pointer fires as often as it
 * likes — sixty or a hundred and twenty times a second on the mouse that costs extra —
 * and a slider wired straight to `draw` would either stack passes up behind the hand or
 * abandon each one a few milliseconds in and never finish a picture at all. So a move
 * while a pass is running is remembered rather than acted on, and the pass that follows
 * draws whatever the control says by then: a machine that keeps up recolours every frame,
 * and a machine that does not degrades to the newest value rather than to the oldest
 * queued one. Nothing is cancelled, so no colouring is thrown away half done.
 *
 * `drawPass` clears the flag as it starts, so a pan or a mode change that lands in the
 * middle takes the pending redraw with it rather than adding one after it.
 */
function live() {
  if (inFlight === null) {
    draw();
    return;
  }
  wantsLive = true;
}

/** One pass, as `draw` describes it; `draw` is what releases the copy controls after it. */
async function drawPass() {
  updateReadout();
  syncShade();
  const pass = ++drawing;
  // A pass that starts takes the pending live redraw with it: whatever a slider was
  // owed, this pass is drawing the view that slider left behind.
  wantsLive = false;
  walkLayers = null;
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
  // Whether this view is saved is known from its link now, not once the field lands: a
  // tile opened out of the gallery says Saved at the click rather than seconds after it.
  syncSave();
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

  // **Whether this pass has written a progress line**, which is what the catch below
  // needs to know. A pass that fails having written one has to take it back: the line
  // would otherwise go on saying the picture is being iterated under a stopped dot and a
  // sentence saying it cannot be — which is what a width just above the `f64` floor did,
  // where the *preview* is the pass the module refuses and `1e-15` and below are refused
  // by the plan at the top of this function, which clears the line already. A pass that
  // has written none must leave it alone: a recipe refused on a recolour never reaches a
  // progress line, and the line it finds there describes the picture still on the screen.
  let progressing = false;
  const progress = (text) => {
    progressing = true;
    stat(text);
  };

  try {
    // Inside the try, because a recipe the engine refuses — a rank transfer under the
    // modulate, which spends its base by rank already — throws from `shade` rather than
    // from the plan, and a refusal a reader caused with a control has to be said rather
    // than left to the console.
    // A derived texture weight is measured here, on the one-sample field, before it is
    // coloured: the preview drew at whatever weight was in force, and every stage after this
    // one draws at the weight this one derived.
    // Over the pool, like the finishing stage — a quarter of its samples is still a
    // colouring the main thread has no business doing, and this is the stage a dragged
    // control pays on every frame. The two exceptions stay on this thread and are cheap
    // there: a direct trap arrived painted, and a derived texture weight is measured off
    // these lanes in the one call that colours them.
    const shadeFull = async (full) => {
      if (full.shape.direct || derivingWeight) {
        const shaded = renderer.shade(full, view, { deriveWeight: derivingWeight });
        if (derivingWeight && shaded.weight !== null) {
          view = { ...view, params: { ...view.params, weight: shaded.weight } };
          syncParams();
        }
        present(shaded.image);
        return true;
      }
      const shaded = await renderer.shadePooled(full, view, colouring, { key: fullKey });
      if (shaded === null || pass !== drawing) return false;
      keepStops(shaded.stops);
      present(shaded.image);
      return true;
    };
    const cachedFull = renderer.cached(fullKey);
    if (cachedFull !== undefined) {
      if (!(await shadeFull(cachedFull))) return;
    } else {
      const cachedPreview = renderer.cached(previewKey);
      if (cachedPreview !== undefined) {
        stretch(renderer.shade(cachedPreview, view).image);
      } else {
        progress(`iterating at ${previewGrid.width}×${previewGrid.height}…`);
        const preview = await renderer.field(view, previewGrid.width, previewGrid.height);
        if (preview === null || pass !== drawing) return;
        renderer.remember(previewKey, preview);
        stretch(renderer.shade(preview, view).image);
      }

      progress(`iterating at ${size} on ${renderer.workerCount} workers…`);
      const full = await renderer.field(view, grid.width, grid.height);
      if (full === null || pass !== drawing) return;
      renderer.remember(fullKey, full);
      if (!(await shadeFull(full))) return;
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
      progress(`${size} · iterating at ${FINAL_SUPERSAMPLE ** 2}× on ${renderer.workerCount} workers…`);
      field = await renderer.field(view, grid.width, grid.height, { supersample: FINAL_SUPERSAMPLE });
      if (field === null || pass !== drawing) return;
      renderer.remember(finalKey, field);
    } else if (!shape.direct) {
      progress(`${size} · coloring at ${FINAL_SUPERSAMPLE ** 2}×…`);
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
      : await renderer.shadePooled(field, view, colouring, { derive: deriving, key: finalKey });
    if (shaded === null || pass !== drawing) return;
    // The curve the picture was drawn through is this pass's where it derived one, and
    // the view's where it replayed one — and the view has not been told about a derived
    // curve yet, which is why the level is named here rather than read off it.
    keepStops(shaded.stops, deriving ? shaded.level : view.level);
    // **The picture first, and the controls after it** *(explorer_perf_audit_ckpt136)*. The
    // derived block below ends in `syncFinal`, which redraws the palette strip — and that
    // used to be the second place this page spent the tone curve, because a curve acts on
    // the *map* rather than on the picture and what it costs is per stop. It is spent once
    // now: `shadePooled` curves the stops in the worker and hands them back, and the strip
    // is drawn through the very stops the picture was. What is left here is 512 lookups.
    present(shaded.image);
    finished = shaded.image;
    showState("final");
    if (deriving) {
      view = { ...view, level: shaded.level };
      derivedInBand = shaded.level === null;
      updateReadout();
      syncLevel();
      // **And the strip still in a task of its own**, which is now belt and braces rather
      // than the fix it was: a canvas drawn in the middle of a task is not composited
      // until that task ends, so presenting the picture and then redrawing the strip in
      // the same turn used to put the strip's half-second in front of the picture. The
      // half-second is gone — the stops arrive curved — and the task of its own costs
      // nothing, so it stays.
      setTimeout(() => {
        if (pass !== drawing) return;
        syncFinal();
      }, 0);
      settle();
    }
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
    if (progressing) stat("");
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
  paintMark();
}

function updateReadout() {
  const cap = renderer.maxiter(view.w.value);
  const level = view.level === null ? "" : `  ·  levels by ${view.level.operator}`;
  readout.textContent =
    `${bothNamesOf(view.palette)}  ·  ${view.mode}  ·  ` +
    `${view.aspect.across}:${view.aspect.down}  ·  ${cap} iterations at this width${level}`;
  syncCoordinates();
}

/**
 * The query for whatever is on screen, by whichever contract owns it.
 *
 * **One place, because three things ask it**: the address bar, Copy link and Save. A deep
 * view is written by the deep contract and a shallow one by the shallow one, and the
 * marker in front of it is what tells them apart again.
 */
function currentQuery() {
  if (deepOwns()) return deep.link();
  return link.emit(view, contract);
}

/** Write the canonical permalink into the address bar, and re-price a download.
 *
 *  Both are properties of the settled view: the estimate is per mode, and whether
 *  a supersampled grid still resolves in `f64` is per width.
 *
 *  **The panel rides along and is not part of the link.** `emit` writes the picture and
 *  nothing else; which side panel is open is a UI key the contract tolerates and never
 *  reads, added here on top. So the address bar restores the whole page and a link
 *  copied out of it is the picture.
 *
 *  **And the way back is a second reader of the same event**
 *  *(explorer_undo_redo_ckpt137)*. A picture that has settled enough to be written into
 *  the address bar has settled enough to step back to, so `trail` is committed from here
 *  rather than from a hook on every control — see `remember`. `remember: false` is the
 *  walk's alone. */
function settle({ remember = true } = {}) {
  panel?.describe();
  clearTimeout(settleTimer);
  settleTimer = setTimeout(() => {
    // Whichever contract the picture belongs to — see `currentQuery` — so the address
    // bar is always a link that reopens exactly what is being looked at.
    const picture = currentQuery();
    const furniture = showing === DEFAULT_PANEL ? "" : `&panel=${encodeURIComponent(showing)}`;
    history.replaceState(null, "", `?${picture}${furniture}`);
    syncSave();
  }, 0);
  if (remember) rememberLater();
}

// ------------------------------------------------------------------- the way back
//
// Ctrl/Cmd+Z steps back through the pictures this session has shown, and Ctrl+Shift+Z or
// Ctrl+Y steps forward *(explorer_undo_redo_ckpt137)*. `undo.js` holds the list and the
// cursor; what is here is the two ends of it — when a picture is worth remembering, and
// how one is put back on the screen.
//
// **It rides on `settle`, and that is the whole design.** A picture settled enough to be
// written into the address bar is a picture settled enough to step back to, and `settle`
// is already the one place both contracts agree about that. So there is no hook on the
// mode select, on Random palette, on Julia here or on a gallery tile: each of them ends in
// a settled picture, which is the only thing this needs to know. It also means a step back
// can never address a state the link contract cannot spell, because the entry *is* the
// link.

/** The pictures this session has shown, and where in them the reader is standing. */
const trail = new Trail();
let trailTimer = 0;

/**
 * The key of the entry being restored, while it is being restored, and `null` otherwise.
 *
 * A step back is not an action and must not commit — and the restore is several tasks
 * long, so a flag is needed rather than an ordering. It is cleared by the settle that
 * lands on the restored picture, and **by nothing else**: a settle with any other key on
 * the way there — `showPanel`'s, which fires before `openLink` has replaced the view when
 * a step back leaves the Deep tab — is ignored and leaves the flag up.
 */
let restoring = null;

/**
 * How long after a settle a picture is committed.
 *
 * **Why there is a debounce at all**, when `drawPass` already cancels a superseded pass and
 * a wheel burst therefore settles once: the Deep tab does not. Its `moved` calls back here
 * once per gesture with nothing coalescing, so a wheel burst down there is a settle a
 * notch. And a slider dragged slowly can complete more than one shallow pass. The value is
 * the Deep tab's own `SETTLE_MS`, for the same reason it chose it — long enough that a drag
 * followed by a notch is one picture.
 */
const REMEMBER_MS = 350;

function rememberLater() {
  clearTimeout(trailTimer);
  trailTimer = setTimeout(remember, REMEMBER_MS);
}

/**
 * Commit the settled picture, unless it is the one already under the cursor.
 *
 * **The options a picture was opened with come off the anchor**, which is the last thing
 * that *arrived*: where the settled picture is that picture, its options are the anchor's,
 * and a gallery tile's `key`, its `gap` and the words for it survive into the entry with no
 * second list to keep in step. Anywhere else — a pan, a palette, a mode — there were none.
 */
function remember() {
  if (view === null) return;
  const query = currentQuery();
  const key = keyOf(query);
  if (restoring !== null) {
    if (key === restoring) restoring = null;
    return;
  }
  const opts = anchor !== null && anchor.at === key ? anchor.opts : {};
  trail.commit(key, { query, opts });
}

/**
 * Put an entry back on the screen, through the same door that opened it.
 *
 * Both doors are the page's own: a shallow link goes through `openLink`, and a deep one
 * through the Deep tab's `open` — which draws the quarter pass and **waits for Render**,
 * because that is what a deep link does, and an entry is a link. Returns whether the
 * restore went ahead.
 */
function restore(entry) {
  const { query, opts } = entry;
  restoring = keyOf(query);
  if (link.isDeep(`?${query}`)) {
    deepOpening = true;
    showPanel("deep");
    startDeep()
      .then(() => deep?.open(query))
      .catch((error) => {
        restoring = null;
        console.warn("a step back could not reopen a deep picture", error);
      });
    return true;
  }
  // Coming up out of the Deep tab: the tab keeps its own view and gives the viewer back,
  // exactly as `leaveDeep` does — but without its refusals, because this frame is a
  // shallow link that this page has already drawn rather than a deep one being carried up.
  if (deepOwns()) {
    deep?.detach();
    showPanel(DEFAULT_PANEL);
  }
  return openLink(query, { ...opts, restoring: true });
}

/** One step back (`-1`) or forward (`1`). A restore that could not go ahead puts the
 *  cursor back where it was standing, so a refusal costs the reader nothing. */
function stepTrail(direction) {
  if (view === null || busy) return;
  const entry = direction < 0 ? trail.back() : trail.forward();
  if (entry === null) return;
  if (restore(entry)) return;
  restoring = null;
  if (direction < 0) trail.forward();
  else trail.back();
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
      if (control.live) setParam(key, modeParams.sliderText(key, slider.value), { moving: true });
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
function setParam(key, text, { moving = false } = {}) {
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
  // A hand still on the slider coalesces — see `live`. A texture weight is the one mode
  // parameter that recolours rather than re-iterating, so it is the one that gets here
  // while the hand is moving.
  if (moving) live();
  else draw();
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
  } else if (tuning === "default") {
    paramNote.textContent = `${what} at the explorer's default, and kept as the view moves.`;
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
          if (!planOf(view).direct) {
            setShade(control.key, shade.sliderText(control, slider.value), { moving: true });
          }
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
  tint({ shade: shade.defaultShade() });
});

/**
 * One key of the recipe, as its control now says it.
 *
 * The text a control holds is the text a link carries, so what happens to it here is
 * the contract's own reader — and a refusal is the contract's own sentence, shown as
 * it stands and the control put back to the value that is still in force.
 */
function setShade(key, text, { moving = false } = {}) {
  if (locked()) {
    syncShade();
    return;
  }
  const subject = tinting();
  // A slider fires `change` on release after `input` has already set the same value.
  if (shade.spelling(subject.shade, key) === text) return;
  let next;
  try {
    next = shade.withKey(subject.shade, key, text);
  } catch (error) {
    say(error.message);
    syncShade();
    return;
  }
  tint({ shade: next }, { moving });
}

/** Show what the recipe now says, in every control that carries a piece of it. */
function syncShade() {
  const subject = tinting();
  for (const control of shade.CONTROLS) {
    const held = shadeWidgets.get(control.key);
    if (held === undefined) continue;
    const text = shade.spelling(subject.shade, control.key);
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
  const cyclic = PALETTES.get(subject.palette).cyclic;
  fold.box.disabled = busy || cyclic;
  fold.box.title = cyclic
    ? `${shownName(subject.palette)} already loops back to its first color, so there is no seam to mirror.`
    : SHADE_TIPS.mirror;

  // And a table that reads the same in both directions gives Reverse nothing to turn. The
  // key keeps whatever the link said — a symmetric map sent reversed is the same picture
  // either way — and the chip says why it is resting.
  const flip = shadeWidgets.get("reverse");
  const same = symmetric(subject);
  flip.box.disabled = busy || same;
  flip.box.title = same
    ? `${shownName(subject.palette)} reads the same in both directions, so Reverse would not change it.`
    : SHADE_TIPS.reverse;

  syncFinal();

  // The count names every key set, the ones with no control included: a link that set
  // the rolloff is a recipe this button resets, and its title is where that is said.
  const set = shade.chosen(subject.shade);
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
  const plan = tintedShape();
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
  const subject = tinting();
  paletteShown.textContent = shownName(subject.palette);
  let pixels;
  try {
    pixels = renderer.ramp(subject, paletteStrip.width, {
      direct: tintedShape().direct === true,
      stops: curvedFor(subject),
    });
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
  const plan = tintedShape();
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
  const wanted = listedModes(view.mode);
  const showing = [...modePicker.options].map((option) => option.value);
  if (wanted.join() !== showing.join()) fill(modePicker, wanted, IDENTITIES);
  modePicker.value = view.mode;
}

/** What the Mode select lists, in its order, with `extra` listed too if it is a mode the
 *  contract knows; the Walk tab's config lists modes in this same order. */
function listedModes(extra = null) {
  const offered = offeredModes ?? link.MODES;
  const listed = link.MODES.filter((mode) => offered.includes(mode) || mode === extra);
  return [
    ...MODE_ORDER.filter((mode) => listed.includes(mode)),
    ...listed.filter((mode) => !MODE_ORDER.includes(mode)),
  ];
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
 * The picture the viewer was opened at, which is what Reset to seat goes back to:
 * `{ query, opts, at }` — the permalink it arrived as, the options it arrived with, and
 * the picture key those reduce to. `null` on a bare page, which opened at nothing.
 *
 * It is the last thing that *arrived* and not the last thing on the screen, so it
 * survives every move the reader makes, Julia here included: the way back to the
 * wallpaper somebody opened is the one thing a pan cannot rebuild for them.
 */
let anchor = null;

/**
 * Open a picture from the left panel: its link is parsed, and what the link could not
 * carry is said where the picture is.
 *
 * A tile and a mark both arrive here, because both are the same thing — a permalink that
 * was derived from a record next door. What `gap` says is not this page's sentence: it
 * is the one the builder wrote when it found the run had kept no tone curve, or that the
 * cap the recipe pinned is not the cap the depth policy gives for that width. Saying it
 * is the difference between a picture and a picture that is nearly right.
 *
 * **`restoring` is a step back through it, and it changes exactly one thing**
 * *(explorer_undo_redo_ckpt137)*: the anchor does not move. Reset to seat goes back to what
 * *arrived*, and an undo is not an arrival — it is the reader taking back a move they made
 * since. Everything else here is wanted, and is what makes stepping back onto a gallery
 * tile put its mark and its *not exact* line back with the picture.
 *
 * Returns whether the picture was opened, which is what a step back reads to know its
 * cursor may move.
 */
function openLink(query, opts = {}) {
  if (locked()) return false;
  const { gap = null, key = null, what = "this picture", restoring: stepping = false } = opts;
  let wanted;
  try {
    wanted = link.parse(`?${query}`, contract);
  } catch (error) {
    say(error.message);
    return false;
  }
  interruptWalk(
    stepping
      ? "The view stepped back. The walk carries on; Back to the walk returns to it."
      : "A picture was opened. The walk carries on; Back to the walk returns to it.",
  );
  view = wanted;
  seat = key;
  // What arrived is what Reset to seat puts back, options and all, so a reset re-enters
  // the picture exactly as opening it did — the tile marked, and the sentence about what
  // the link could not carry back under the canvas.
  if (!stepping) anchor = { query, opts, at: pictureKey(view) };
  arrived();
  if (key !== null) tunedFrom = "seat";
  tiles?.mark(key);
  if (opts.from !== "saved") savedPanel?.unmark();
  // The record's sentence names caps, curves and policies, which is Details' vocabulary;
  // the line under the picture only says that there is a difference and where to read it.
  opened.textContent = gap
    ? `This view is close to ${what} but not exact. Details says what differs.`
    : "";
  differs.textContent = gap ? `Not carried by this link: ${gap}.` : "";
  rebuild();
  draw();
  return true;
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
  interruptWalk("You moved the view. The walk carries on; Back to the walk returns to it.");
  leaveSeat();
  // The plane moved under a pointer that may not have: whatever the card was showing is
  // a picture of somewhere else now. The next move over the canvas offers the new place.
  juliaCard?.hide();
  levelling = "derived";
  if (tuning === "stored") tuning = "derived";
  // Two of the buttons say whether this view is the one that was opened and whether it is
  // the whole of its plane, so they are resynced by every move and not only by the routes
  // that rebuild the strips around one.
  syncToggles();
}

/**
 * Open a link by whichever contract owns it *(explorer_download_carries_link_ckpt137)*.
 *
 * **The one door for a link that came from outside the page** — a tile in Saved, and a
 * picture dropped on the canvas. The three branches are the three kinds of link this site
 * has emitted: an ordinary one, a deep one, and one the paged Inflection tab wrote, which
 * is refused by name so that a URL somebody saved is never drawn as the plain Julia set
 * underneath it. The way back has a door of its own, `restore`, because a step back is
 * putting a picture back rather than opening one — it moves no anchor and refuses nothing,
 * having drawn every entry already.
 */
function openAny(query, opts = {}) {
  if (link.isInflected(`?${query}`)) {
    say(INFLECTION_PAGED);
    return false;
  }
  if (!link.isDeep(`?${query}`)) return openLink(query, opts);
  deepOpening = true;
  showPanel("deep");
  startDeep().then(() => deep?.open(query));
  return true;
}

/**
 * A view reduced to the choices somebody made: its canonical query, with the two keys
 * this page writes on its own taken out.
 *
 * A derived parameter and a tone curve are measurements of the picture rather than
 * choices about it, and both land on the view partway through the pass that draws it. So
 * a button greyed because this is the picture that was opened must not come back to life
 * when that pass finishes measuring it.
 */
function pictureKey(current) {
  return keyOf(link.emit(current, contract));
}

/**
 * The same identity, taken off a query rather than off a shallow view.
 *
 * **It is the way back's key as well as the buttons'** *(explorer_undo_redo_ckpt137)*, and
 * it has to work on a deep link too — which is why it reads the query. Both contracts spell
 * the tone curve with `LEVEL_KEY.key` and the deep one has no derived parameters, so the
 * same two deletions say the same thing on either side.
 */
function keyOf(query) {
  const params = new URLSearchParams(query);
  params.delete(link.LEVEL_KEY.key);
  for (const key of new Set(Object.values(link.DERIVED))) params.delete(key);
  return params.toString();
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
 * Index one collection's seats by place and mode, and — where it is the published one —
 * find what each trap mode's seats were most often drawn at. Read off the links the
 * record carries, through the contract, so a seat's parameters are exactly what opening
 * it would give.
 *
 * **Called as each collection arrives** *(explorer_slim_ckpt131)*. The rows are no longer
 * read before the first frame, so a mode switch made before the general collection is here
 * opens a trap at its derived value rather than its seats' usual one, and a seat is found
 * at its place only once a collection holding it has been shown. The general collection is
 * fetched right after the first frame, so the window is short.
 */
function indexSeats(rows, name) {
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
    // an unpublished collection cannot move a default somebody has already seen — and off
    // the whole of it, which is its own file.
    if (name !== gallery.GENERAL) continue;
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

/** Move the atlas's chip to the view's plane, where the atlas is mounted and showing.
 *
 *  **Not while it is hidden** *(explorer_slim_ckpt131)*. Opening a plane loads its plate,
 *  0.2 to 0.3 MB, and a walk that crossed five planes with the panel never on screen
 *  fetched five of them. The panel catches up once when it is shown again, which is when
 *  the plate is looked at. */
function syncPlane() {
  if (showing !== "atlas") return;
  atlasFrame?.open(planeOf(view.family));
}

const tabs = [...document.querySelectorAll(".tab")];

/**
 * Show one of the four left panels.
 *
 * The atlas and the walk are mounted the first time each is opened and never before: the
 * atlas reads its own record and instantiates the wasm module for one export, the walk
 * builds its config, and a reader who came here for the gallery should not wait for
 * either. A failure is the panel's and not the page's — the viewer is what this page is,
 * and a side panel not loading is a note in that panel.
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
  if (showing === "atlas") {
    startAtlas();
    syncPlane();
  }
  // The walk is the one panel with work of its own, so it is the one that has to be told
  // when it stops being seen: a hidden walk pauses, and showing it again takes up a walk
  // the hiding paused, with the viewer back on it *(walk_detach_ckpt131)*. Nothing else
  // starts one — an address saying `panel=walk` included.
  //
  // **Saved is the one exception** *(saved_tab_ckpt131)*: it does nothing to a running walk,
  // so a walk goes on while it is showing, and going from it back to Walk has nothing to
  // take up because nothing was paused.
  if (showing === "walk") {
    if (walk === null) startWalk();
    else walk.reveal();
  } else if (showing !== "saved") {
    walk?.hide("The Walk tab was hidden, so the walk paused.");
  }
  if (showing === "saved") startSaved();
  else savedPanel?.hide();

  // **The Deep tab takes the viewer, and gives it back.** It is the one panel besides the
  // walk whose showing changes what the canvas is a picture of: a deep frame is drawn by a
  // different kernel and cannot be a view of the shallow one. So the viewer is handed over
  // when the tab is shown and the shallow view is drawn again when it is left, and while it
  // is held the sections that mean nothing down here — Mode, the family and the constants —
  // are off the page. Palette stays, because a deep field is a smooth field; and Download
  // stays, because since `deep_cap_policy_ckpt138` the row draws whichever view owns the
  // canvas rather than always the shallow one.
  document.querySelector(".viewer").classList.toggle("is-deep", showing === "deep");
  if (showing === "deep") {
    startDeep().then(() => {
      if (showing !== "deep") return;
      deep?.show();
      if (!deepOpening) deep?.enter(carryable());
      deepOpening = false;
      syncShade();
    });
  } else if (deep !== null) {
    deep.hide();
    syncShade();
    if (walk === null || showing !== "walk") draw();
  }
  settle();
}

/** Whether the Deep tab is being opened on a link rather than entered from the viewer,
 *  in which case the link's own frame is the one to open at. */
let deepOpening = false;

// -------------------------------------------------------------- the paged Inflection tab
//
// The tab that sculpted a Julia set by inflection is **paged out** — Matt's ruling, and
// `paged-inflection/README.md` beside its files says what it was, what it taught and how
// to put it back. Nothing the page loads imports any of it, and there is no tab, no
// panel and no stylesheet block left to reach one.
//
// What stays is the refusal below, because a link outlives the trial: a reader who copied
// one, or saved one, still has `iv` in their hands, and the plain Julia set underneath it
// is a different picture wearing that picture's name. `permalink.js` keeps `iv` as a
// marker it can sort on for exactly this, and both live contracts go on refusing the key.

/** What the page says to a link the paged tab wrote. */
const INFLECTION_PAGED =
  "This link was made by the explorer's Inflection tab, which is no longer part of this " +
  "page. Nothing has been drawn, because the plain Julia set underneath it is not the " +
  "picture the link names.";

// ------------------------------------------------------------------- saved pictures

/**
 * The visitor's saved pictures *(saved_tab_ckpt131)*: the list itself is `saved.js`, made
 * at boot because every save mark on the page asks it a question; the tab that shows the
 * list is mounted the first time it is opened, like the atlas and the walk.
 */
let saved = null;
let savedPanel = null;
let savedStarted = false;

/** Canonical links already worked out, by the spelling they arrived in: a gallery refill
 *  asks again for a thousand links it asked for a moment ago. */
const canonicalLinks = new Map();

/** The link a picture is saved under: its query through the contract and back. */
function canonicalOf(query) {
  let known = canonicalLinks.get(query);
  if (known === undefined) {
    try {
      // **Each contract canonicalizes its own, and the deep one does not truncate.** A
      // deep centre is up to sixty-four characters of decimal and every one of them says
      // where the view is, so putting it through the shallow reader — which holds a
      // coordinate as a double — would store a link to a place nobody asked for.
      known = link.isDeep(`?${query}`)
        ? deepRules === null
          ? null
          : deepRules.canonicalize(`?${query}`, deepContext)
        : link.emit(link.parse(`?${query}`, contract), contract);
    } catch {
      known = null;
    }
    canonicalLinks.set(query, known);
  }
  return known;
}

/** The Save button beside the downloads: which way it points, for the view on the screen.
 *  Held while the pass is still deriving something the link carries, as Copy link is. */
function syncSave() {
  if (saved === null) return;
  const key = canonicalOf(currentQuery());
  const on = saved.has(key);
  saveButton.setAttribute("aria-pressed", String(on));
  saveButton.querySelector(".save-label").textContent = on ? "Saved" : "Save";
  saveButton.disabled = copyHeld;
  saveButton.title = copyHeld
    ? COPY_HELD_TITLE
    : on
      ? "This view is on the Saved tab. Press to remove it."
      : "Keep this view on the Saved tab, in this browser.";
}

function makeSaved() {
  let storage = null;
  try {
    storage = window.localStorage;
  } catch {
    storage = null;
  }
  saved = new saving.Saved({
    storage,
    canonical: canonicalOf,
    persist: () => navigator.storage?.persist?.().catch(() => {}),
  });
  saved.subscribe(() => {
    saving.remark(saved);
    syncSave();
  });
  // Another tab of this page wrote the list: this one reads it again.
  window.addEventListener("storage", (event) => {
    if (event.key === saving.KEY) saved.reload();
  });
  saveButton.addEventListener("click", () => {
    const answer = saved.toggle(currentQuery());
    if (answer === "added") say("Saved. It is on the Saved tab, in this browser.");
    else if (answer === "removed") say("Removed from Saved.");
    else if (answer === "full") say(`Saved is full at ${saving.MAX} pictures. Remove some to save more.`);
  });
}

async function startSaved() {
  if (savedStarted) {
    savedPanel?.show();
    return;
  }
  savedStarted = true;
  try {
    // The Saved tab is one of the three things that can put a deep link in front of the
    // page, so opening it is one of the three that fetches the reader — and it has to be
    // here rather than at the first deep entry, because the panel reads a link
    // synchronously to label a tile.
    await loadDeepRules();
    const { mount } = await import("./saved-panel.js");
    const at = (id) => document.getElementById(id);
    savedPanel = mount({
      saved,
      module: renderer.module,
      renderer,
      download: panel,
      // A deep entry is described rather than parsed: there is no drawing it at a tile's
      // size without the perturbation kernel and a wait, so the panel labels it and the
      // click opens the Deep tab on it.
      // **And an entry the paged Inflection tab wrote is neither.** The panel's own
      // handling of a link it cannot read is what says so: the tile reads *cannot be
      // read* and carries this sentence as its title, which is the truth about it.
      parse: (query) => {
        if (link.isInflected(`?${query}`)) throw new Error(INFLECTION_PAGED);
        return link.isDeep(`?${query}`)
          ? deepRules.describe(query, deepContext)
          : link.parse(`?${query}`, contract);
      },
      parseImport: saving.parseImport,
      shownName,
      planeName,
      open: (query) => {
        openAny(query, { what: "this saved picture", from: "saved" });
      },
      // After Download all: the screen's own pass, if the first picture cut it short.
      settle: () => {
        if (finished === null && walkLayers === null) draw();
      },
      elements: {
        panel: at("panel-saved"),
        tiles: at("saved-tiles"),
        count: at("saved-count"),
        empty: at("saved-empty"),
        warning: at("saved-warning"),
        progress: at("saved-progress"),
        download: at("saved-download"),
        format: at("saved-format"),
        exportFile: at("saved-export"),
        copy: at("saved-copy"),
        importToggle: at("saved-import"),
        importBox: at("saved-import-box"),
        paste: at("saved-paste"),
        importGo: at("saved-import-go"),
        file: at("saved-file"),
        clear: at("saved-clear"),
      },
    });
    if (showing === "saved") savedPanel.show();
  } catch (error) {
    savedStarted = false;
    console.warn("the saved tab could not be started", error);
    document.getElementById("saved-warning").textContent = "The Saved tab could not be loaded.";
  }
}

// ------------------------------------------------------------------- the walk

/** The mounted walk, once its tab has been opened. */
let walk = null;
let walkStarted = false;

/** The reader took the viewer: it stops following the walk, and the walk carries on
 *  *(walk_detach_ckpt131)* — Pause is the one control that stops it. The cells it was
 *  weighing go with it: they were about a view that is no longer the one on screen. */
function interruptWalk(why) {
  walk?.detach(why);
  showOverlay(null);
}

/**
 * The walk moves the viewer: its view, drawn like any other, with nothing about the reader's
 * own session touched — no seat is left, no tone is taken over, and the address bar follows
 * because every view the viewer draws is a link. `cells` goes over the picture.
 */
function followWalk(next, cells = null) {
  view = next;
  seat = null;
  tiles?.mark(null);
  opened.textContent = "";
  differs.textContent = "";
  arrived();
  overlay = cells === null ? null : { family: view.family, cells };
  rebuild();
  draw();
}

/**
 * While a walk runs the viewer draws nothing of its own *(walk_console_ckpt131)*: it shows
 * the pictures the walk computed, at the walk's resolution, and never starts refining them.
 * The view is still set — the address bar and every control follow it as they follow
 * `followWalk` — but the pass that would draw it is stopped rather than started. Pausing
 * goes back through `followWalk`, which draws the view properly.
 */
function showWalk(next, layers, cells = null) {
  view = next;
  seat = null;
  tiles?.mark(null);
  opened.textContent = "";
  differs.textContent = "";
  arrived();
  overlay = cells === null ? null : { family: view.family, cells };
  rebuild();
  updateReadout();
  syncShade();
  drawing += 1;
  renderer.cancel();
  colouring.stop?.();
  colouring = {};
  finished = null;
  measure = null;
  holdCopy(false);
  panel?.describe();
  say("");
  const [top] = layers.slice(-1);
  stat(top ? `${top.image.width}×${top.image.height} · the walk's own picture` : "");
  showState("stopped");
  walkLayers = layers;
  paintWalk();
  // **The one picture the way back does not remember** *(explorer_undo_redo_ckpt137)*. This
  // is the running walk's own display, a frame at a time as it searches: a minute of it
  // would fill the whole trail with pictures nobody chose and bury the ones somebody did.
  // What a reader *did* here still commits — pausing lands on `followWalk`, and opening a
  // found picture goes through `openLink` — so what is lost is only the flicker between.
  settle({ remember: false });
}

async function startWalk() {
  if (walkStarted) return;
  walkStarted = true;
  try {
    const { mount } = await import("./walk.js");
    walk = mount({
      fields: document.getElementById("walk-fields"),
      start: document.getElementById("walk-start"),
      back: document.getElementById("walk-back"),
      progress: document.getElementById("walk-progress"),
      view: document.getElementById("walk-view"),
      controls: document.getElementById("controls"),
      strip: document.getElementById("walk-strip"),
      candidates: document.getElementById("walk-candidates"),
      candidatesNote: document.getElementById("walk-candidates-note"),
      candidatesPlace: document.getElementById("walk-candidates-place"),
      walking: (on) => document.querySelector(".viewer").classList.toggle("is-walking", on),
      relayout,
      found: document.getElementById("walk-found"),
      note: document.getElementById("walk-note"),
      module: renderer.module,
      contract,
      palettes: PALETTES,
      shownName,
      modeOrder: listedModes(),
      planeName,
      juliaOf: JULIA_OF,
      follow: followWalk,
      showWalk,
      showCells: (cells) => showOverlay(cells === null ? null : { family: view.family, cells }),
      open: (query, what) => openLink(query, { what }),
      mark: (query) => saving.mark(saved, canonicalOf(query)),
      saveAll: document.getElementById("walk-save-all"),
      keepAll: (queries) => saved.merge(queries.map((query) => ({ link: query }))),
      busy: () => busy,
      aspect: () => (grid.width > 0 ? grid.height / grid.width : 9 / 16),
    });
  } catch (error) {
    walkStarted = false;
    console.warn("the walk could not be started", error);
    document.getElementById("walk-note").textContent = "The walk could not be loaded.";
  }
}

// ------------------------------------------------------------------- the deep tab

/** The mounted Deep tab, once its tab has been opened. `perturb.wasm` and every module
 *  behind it are fetched then and never before, which is what keeps the ordinary explorer
 *  exactly as heavy as it was. */
let deep = null;
/** The mount, as a promise, so every caller of `startDeep` waits on the same one. */
let deepStarted = null;

/** Whether the Deep tab is the one drawing the picture on the canvas. */
function deepOwns() {
  return deep !== null && deep.owns();
}

/** The frame the viewer would carry into the Deep tab, or `null` where it has none to
 *  carry: deep draws `z² + c` at degree 2 — the Mandelbrot set and its Julia sets — and a
 *  view of anything else is a view of a plane this kernel has no recurrence for. */
function carryable() {
  return view.family === "mandelbrot" || view.family === "julia" ? view : null;
}

/**
 * Take the frame the Deep tab is standing on back to the ordinary explorer.
 *
 * Carried where `f64` can still resolve it, and refused where it cannot — with the
 * refusal being the module's own question rather than a width written down here. A deep
 * frame that came back rounded would be a different place under the same name, which is
 * the one thing this whole tab is built not to do.
 */
function leaveDeep(from) {
  // **Two ways a deep view can fail to cross back, and they are different
  // failures.** A frame below the ordinary arithmetic is a picture nobody could
  // draw; a parameter below it is a picture of *a different set* that would draw
  // perfectly well and be mislabelled. The second is the worse of the two, and it
  // is the one a reader could not possibly spot, so it is named separately.
  if (from.julia && !carriesParameter(from)) {
    say(
      "This Julia set's c has more digits than the ordinary explorer's arithmetic carries, " +
        "so it cannot be taken over: rounding it would open a different Julia set under " +
        "this one's name. The Deep tab is the only place this c exists.",
    );
    return;
  }
  if (!resolvesShallow(from)) {
    say(
      "This frame is below what the ordinary explorer's arithmetic can resolve, so it " +
        "cannot be carried back: every pixel of it would round to the same coordinate. " +
        "Zoom out here first, and the button will take it over.",
    );
    return;
  }
  const family = from.julia ? "julia" : "mandelbrot";
  view = {
    ...link.fresh(family, "smooth", contract),
    x: { text: from.x.text, value: Number(from.x.text) },
    y: { text: from.y.text, value: Number(from.y.text) },
    w: { text: from.w.text, value: from.w.value },
    aspect: view.aspect,
    palette: from.palette,
    shade: from.shade,
    level: from.level,
  };
  if (from.julia) {
    view.constants = {
      cx: { text: from.julia.x.text, value: Number(from.julia.x.text) },
      cy: { text: from.julia.y.text, value: Number(from.julia.y.text) },
    };
  }
  deep?.detach();
  showPanel(DEFAULT_PANEL);
  changed();
  rebuild();
  draw();
}

/** Whether the ordinary renderer would still resolve a deep frame, asked of the module. */
function resolvesShallow(of) {
  return (
    carriesParameter(of) &&
    grid.width > 0 &&
    renderer.resolves(Number(of.x.text), Number(of.y.text), of.w.value, grid.width, grid.height)
  );
}

/** Whether a deep view's Julia parameter, if it has one, survives a double. */
function carriesParameter(of) {
  if (!of.julia || deepRules === null) return true;
  return deepRules.exactInDouble(of.julia.x) && deepRules.exactInDouble(of.julia.y);
}

/**
 * Mount the Deep tab, once.
 *
 * **Memoized on the promise and not on a flag**, which is the difference between this and
 * the three panels above it. Those are started from one place; this one is started from
 * three — the tab, a deep link at the door, and a saved deep picture — and a second caller
 * arriving while the first is still importing would be handed `undefined` and go on to use
 * a `deep` that is still null. `pool()` in `deep.js` is memoized for the same reason.
 */
function startDeep() {
  deepStarted ??= mountDeep();
  return deepStarted;
}

async function mountDeep() {
  const at = (id) => document.getElementById(id);
  try {
    // `deep.js` imports it as well, so this costs one fetch between them and makes the
    // reader available to the synchronous callers the moment the tab exists.
    await loadDeepRules();
    const { mount } = await import("./deep.js");
    deep = mount({
      elements: {
        render: at("deep-render"),
        progress: at("deep-progress"),
        note: at("deep-note"),
        cap: at("deep-cap"),
        capUp: at("deep-cap-up"),
        capDown: at("deep-cap-down"),
        policy: at("deep-cap-policy"),
        centre: at("deep-centre"),
        width: at("deep-width"),
        param: at("deep-param"),
        paramRow: at("deep-param-row"),
        paramValue: at("deep-param-value"),
        julia: at("deep-julia"),
        origin: at("deep-origin"),
        minibrots: at("deep-minibrots"),
        minibrotList: at("deep-minibrot-list"),
        minibrotNote: at("deep-minibrot-note"),
        back: at("deep-back"),
        save: at("deep-save"),
      },
      context: deepContext,
      grid: () => grid,
      compose,
      shading: () => renderer.shading,
      say,
      stat,
      showState,
      settle,
      // A deep view is always one the reader made, so the curve is measured whenever the
      // box is ticked. There is no stored half here: nothing arrives from a run.
      deriving: () => levelOn,
      resolves: resolvesShallow,
      leave: leaveDeep,
      save: (query) => {
        const answer = saved.toggle(query);
        if (answer === "added") say("Saved. It is on the Saved tab, in this browser.");
        else if (answer === "removed") say("Removed from Saved.");
        else if (answer === "full") say(`Saved is full at ${saving.MAX} pictures. Remove some to save more.`);
      },
      onColour: () => {
        palettes?.show(deep.view().palette);
        syncShade();
      },
    });
    document.querySelector(".viewer").classList.toggle("is-deep", showing === "deep");
  } catch (error) {
    deepStarted = null;
    console.warn("the deep tab could not be started", error);
    at("deep-note").textContent = "The Deep tab could not be loaded.";
  }
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
      // Each slot carries a save mark, pointed at whatever the slot is showing.
      slotMark: () => {
        const node = saving.mark(saved);
        return {
          node,
          show: (query) => saving.point(saved, node, query === null ? null : canonicalOf(query)),
        };
      },
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
/** Whether the canvas is showing a slid or scaled preview rather than a settled picture.
 *  `release` needs it for the one path out of a gesture that draws nothing. */
let slid = false;

function canvasPoint(event) {
  const box = canvas.getBoundingClientRect();
  return {
    x: ((event.clientX - box.left) / box.width) * grid.width,
    y: ((event.clientY - box.top) / box.height) * grid.height,
  };
}

/** Slide the last picture drawn, so a drag has something to follow. */
function preview(dx, dy, scale = 1) {
  slid = true;
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
  // Read once and clear: every path below this but the zero-length one ends in a draw.
  const wasSlid = slid;
  slid = false;
  if (pinch !== null) {
    const ratio = spread() / pinch.spread;
    pinch = null;
    pointers.clear();
    drag = null;
    if (Number.isFinite(ratio) && ratio > 0) {
      zoomAbout(grid.width / 2, grid.height / 2, 1 / ratio);
    } else if (deepOwns()) {
      deep.repaint();
    } else {
      draw();
    }
    return;
  }
  if (drag === null) return;
  const dx = drag.at.x - drag.from.x;
  const dy = drag.at.y - drag.from.y;
  drag = null;
  // **A click enters the Julia set the preview is showing** — and only while it is
  // showing, which is what keeps the gesture from surprising anybody: the reader is
  // clicking a picture the page already has in front of them, and a click anywhere the
  // card is not up still does what it has always done, which is nothing but take the
  // focus. It enters at the `c` the card drew rather than at the pointer's own place,
  // because the picture is what was chosen.
  const previewed = event.pointerType === "mouse" ? juliaCard?.showing() : null;
  if (previewed != null && Math.abs(dx) <= CLICK_SLOP && Math.abs(dy) <= CLICK_SLOP) {
    juliaTo(link.coordinateOf(previewed.cx), link.coordinateOf(previewed.cy));
    return;
  }
  // **A gesture that slid the picture and then measured zero has to put it back.** A
  // plain click measures zero too and is the case the comment above describes — nothing
  // was slid there, so nothing is owed. But a *second* press during a drag arrives with
  // the mouse's own pointer id, which leaves `pointers` at one and resets `drag` to a
  // fresh zero-length one under the moves that have already slid the canvas. Returning
  // there left the slid preview on the screen for good, with the dot still reading
  // `rendering` and the view never having moved — a picture that is not the link beside
  // it. Drawing is the same work the release would have done had the drag measured
  // anything, and the field is already cached at this view, so it costs a recolour.
  if (dx === 0 && dy === 0) {
    if (wasSlid) {
      if (deepOwns()) deep.repaint();
      else draw();
    }
    return;
  }
  // The Deep tab pans exactly as far, and draws nothing: the frame moves, the last
  // picture stays where it falls, and Render is what commits it.
  if (deepOwns()) {
    deep.pan(dx, dy);
    return;
  }
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
    // The zoom moved the plane under a pointer that has not moved, so the `c` the card
    // was showing is not the one under the pointer any more. `changed` has already taken
    // the card away; this is what offers the new place, and it waits for the pass the
    // zoom started the way every preview waits.
    hoverPreview(event);
  },
  { passive: false },
);

// ------------------------------------------------- the Julia preview under the pointer
//
// On a parameter plane, the point under the pointer is a `c`. The card draws that `c`'s
// Julia set — see `julia-preview.js` — and a click enters it. The page owns the gate and
// the geometry; the module owns the card, the pool and the stored switch.

/** Whether this is a machine with a pointer that hovers. The preview is a mouse gesture
 *  and there is nothing here for touch: a finger has no hover, and the tap that would
 *  stand in for one is the pan. */
const HOVERS = window.matchMedia?.("(hover: hover) and (pointer: fine)")?.matches ?? false;

/** How far a mouse may travel between press and release and still be a click rather than
 *  a very short pan, in canvas pixels. A hand on a mouse is never quite still, and
 *  exact-zero was only ever safe because nothing was bound to it. */
const CLICK_SLOP = 4;

/** Whether the preview may be showing at all: a parameter plane, drawn by the studio
 *  itself, with nothing in the middle of happening. */
function previewable() {
  return (
    HOVERS &&
    view !== null &&
    view.family in JULIA_OF &&
    !busy &&
    !deepOwns() &&
    walkLayers === null &&
    drag === null &&
    pinch === null
  );
}

/** The pointer is somewhere over the canvas: offer that place to the card, or take the
 *  card away where this is not a place it may show. */
function hoverPreview(event) {
  if (juliaCard === null) return;
  // **A press leaves the card exactly as it is.** A button going down fires a move of its
  // own first, and taking the card away on it would mean the release had nothing left to
  // enter at — the click would be eaten by the gesture that is supposed to make it. A
  // drag that actually moves the view takes the card with it through `changed`, and a
  // press that does not move is the click.
  if (drag !== null || pinch !== null) return;
  if (event.pointerType !== undefined && event.pointerType !== "mouse") {
    juliaCard.hide();
    return;
  }
  if (!previewable()) {
    juliaCard.hide();
    return;
  }
  const at = canvasPoint(event);
  const c = planeAt(at.x, at.y);
  juliaCard.at({
    cx: c.x,
    cy: c.y,
    across: at.x / grid.width,
    span: view.w.value / grid.width,
  });
}

canvas.addEventListener("pointermove", hoverPreview);
canvas.addEventListener("pointerleave", () => juliaCard?.hide());

// --------------------------------------------------------- a picture dropped back
//
// A picture this page saved carries its own link *(explorer_download_carries_link_ckpt137)*,
// and dropping it on the canvas reopens that view. `stamp.js` writes the link on the way
// out and reads it on the way back; what is here is the drop and the sentence for a file
// that has nothing in it.
//
// **The metadata and never the pixels.** The link is read out of the PNG's chunks or the
// JPEG's comment. Nothing here looks at the picture, and there is no inferring a view from
// one: a file without the stamp says so and changes nothing.
//
// **No visible UI.** No drop zone, no outline, no line of instructions — the page says what
// it can do when somebody does it, which is how the two keys of the way back work as well.

/** What a dropped file with nothing of ours in it is told. */
const NO_LINK =
  "That picture carries no explorer link. A picture downloaded from this page does, " +
  "written into the file when it was saved.";

/** Whether a drag is carrying files, which is the only kind this page takes. */
function draggingFiles(event) {
  return [...(event.dataTransfer?.types ?? [])].includes("Files");
}

/**
 * Open the link a dropped file carries. `where` says what is done with it, so that the
 * canvas opens a picture and the Saved tab keeps one.
 */
async function dropped(file, where) {
  if (file === undefined) return;
  let query = null;
  try {
    const { linkInFile } = await import("./stamp.js");
    query = await linkInFile(file);
  } catch (error) {
    console.warn("a dropped file could not be read", error);
  }
  if (query === null) {
    say(NO_LINK);
    return;
  }
  where(query);
}

// A file dropped anywhere on this page would otherwise be *navigated to*, which would take
// the reader off the view they were looking at to a picture of it in a bare tab. So the
// default is refused for a file drag wherever it lands, and the two places that do
// something with one say so themselves.
for (const kind of ["dragover", "drop"]) {
  window.addEventListener(kind, (event) => {
    if (draggingFiles(event)) event.preventDefault();
  });
}

stage.addEventListener("dragover", (event) => {
  if (!draggingFiles(event)) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = "copy";
});

stage.addEventListener("drop", (event) => {
  if (!draggingFiles(event)) return;
  event.preventDefault();
  if (locked()) return;
  dropped(event.dataTransfer.files[0], (query) => openAny(query, { what: "this picture" }));
});

/** Form controls keep their own keys: the pickers are selects and the constants are
 *  text boxes, and a reader typing in one is not panning the plane. */
const TYPING = new Set(["SELECT", "INPUT", "TEXTAREA", "BUTTON", "OPTION"]);

/** The controls that have a text undo of their own: there Ctrl+Z is the browser's, always.
 *  A select and a button have none, which is why neither is here — and a button is the
 *  focus right after Random palette, which is the press a reader is likeliest to take
 *  back. */
const TEXT_FIELDS = new Set(["INPUT", "TEXTAREA"]);

window.addEventListener("keydown", (event) => {
  // A letter means nothing to a button, so the toggles' keys still work with focus on one
  // — the button just pressed, most often.
  const target = event.target instanceof Element ? event.target.tagName : "";
  // **The way back, above everything else here**, because the gate below sends every key
  // with focus on a button or a select straight back to the browser, and those two are
  // exactly where the focus sits after the action a reader wants to take back.
  if ((event.ctrlKey || event.metaKey) && !event.altKey) {
    const pressed = event.key.toLowerCase();
    const back = pressed === "z" && !event.shiftKey;
    const forward = (pressed === "z" && event.shiftKey) || pressed === "y";
    if (back || forward) {
      if (TEXT_FIELDS.has(target) || (event.target instanceof Element && event.target.isContentEditable)) {
        return;
      }
      event.preventDefault();
      // Nothing is said at either end of the trail: a key that does nothing where there is
      // nothing to do is what every program does, and a message here would take the line
      // under the canvas away from something the page had a better reason to say.
      stepTrail(back ? -1 : 1);
      return;
    }
  }
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
    if (deepOwns()) {
      deep.nudge(step[0], step[1]);
      return;
    }
    const before = view;
    moveTo(
      view.x.value + step[0] * PAN_STEP * view.w.value,
      view.y.value + step[1] * PAN_STEP * planeHeight(),
      view.w.value,
    );
    reproject(before);
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
// Five buttons at the right of the Download row, each with a key. They are the whole of
// this row on purpose: anything further is a shortcut, not chrome.
//
// **The labels carry the state** *(explorer_view_buttons_ckpt130, 2026-09-17)*. Where the
// row used to say `Reset view` and `Back` — two words that mean nothing until you know
// which plane you are on and how you got there — it names the thing each button would go
// to: the seat that was opened, the whole of this plane by its own name, and the plane a
// Julia set's `c` is a point of. So the row says where the reader is standing, which is
// why this page has no status strip and no breadcrumb. A button that would change nothing
// is greyed rather than taken away, because a row that loses a button moves the rest of
// them under the pointer.

const seatButton = document.getElementById("view-seat");
const wholeButton = document.getElementById("view-whole");
const juliaButton = document.getElementById("view-julia");
const randomPaletteButton = document.getElementById("view-palette");
const randomPhaseButton = document.getElementById("view-phase");

/** Each button's words and its key, which is what it says on hover. The two that name a
 *  plane are written where they are said, because the name is the view's. */
const TOGGLE_TIPS = {
  seat: "Back to the wallpaper this view was opened at: its frame, its mode and its palette. (S)",
  link: "Back to the picture this link opened at: its frame, its mode and its palette. (S)",
  none: "This page opened at the home view, so there is nothing else to go back to. (S)",
  julia: "Open the Julia set whose c is the center of this view. (J)",
  palette: "A palette drawn at random from the picker, on the same view. (P)",
  phase: "A random phase, with everything else kept. (Shift+P)",
};
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

/** Whether the view is its plane's home frame, which is all Whole ⟨plane⟩ would set. */
function atHome() {
  const home = homeOf(view.family);
  return ["x", "y", "w"].every((key) => view[key].text === home[key].text);
}

/**
 * Every button's face and whether it is live.
 *
 * Reset goes back to a seat or to a link, and the word on it is that split — the same one
 * the tuned-parameter note already makes, a gallery tile being a seat and an atlas mark or
 * a pasted address being a link. The Julia button goes one way on a parameter plane and
 * the other inside a Julia set, and every Julia set has the way back, a copied link's
 * included, because its `c` always names a point of a plane. Phoenix has neither: no
 * family here is the plane its `c` is drawn from, so the button is absent rather than
 * present and saying so.
 */
function syncToggles() {
  const onJulia = view.family in PARENT_PLANE;

  const opened = anchor === null ? "none" : anchor.opts.key ? "seat" : "link";
  seatButton.textContent = opened === "link" ? "Reset to link" : "Reset to seat";
  seatButton.title = TOGGLE_TIPS[opened];
  seatButton.disabled = busy || anchor === null || pictureKey(view) === anchor.at;

  const plane = planeName(view.family);
  wholeButton.textContent = `Whole ${plane}`;
  wholeButton.title = `The whole of ${plane}, keeping the mode and palette. (R)`;
  wholeButton.disabled = busy || atHome();

  const hasJulia = onJulia || view.family in JULIA_OF;
  juliaButton.hidden = !hasJulia;
  if (onJulia) {
    const parent = planeName(PARENT_PLANE[view.family]);
    juliaButton.textContent = `Back to ${parent}`;
    juliaButton.title = `Back to ${parent}, framed on the c this Julia set is drawn at, with c marked. (J)`;
  } else {
    juliaButton.textContent = "Julia here";
    juliaButton.title = TOGGLE_TIPS.julia;
  }
  juliaButton.disabled = busy || !hasJulia;

  for (const button of [randomPaletteButton, randomPhaseButton]) button.disabled = busy;
}

/** Back to the picture the viewer was opened at, exactly as opening it did: the seat's
 *  frame, mode, palette and recipe, its tile marked again, and the sentence about what its
 *  link could not carry back under the canvas. */
function resetToSeat() {
  if (locked() || anchor === null || pictureKey(view) === anchor.at) return;
  openLink(anchor.query, anchor.opts);
}

/** The current plane's home viewport, with the mode, palette and everything else kept. */
function wholePlane() {
  if (locked() || atHome()) return;
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

/**
 * The Julia view a `c` of this plane opens: that degree's Julia set at its home frame,
 * with the mode, palette, recipe and tone carried.
 *
 * **The one place that view is built**, because two things build it now — Julia here, and
 * the preview under the pointer, which is only honest if the picture it draws is the
 * picture entering gives. `cx` and `cy` arrive as coordinates rather than as numbers, so
 * the centre's own decimal strings survive the way they always have.
 */
function juliaViewOf(cx, cy) {
  return carried({
    ...link.fresh(JULIA_OF[view.family], view.mode, contract),
    constants: { cx, cy },
  });
}

/** Enter the Julia set at a `c` of this plane, holding the view being left for Back. */
function juliaTo(cx, cy) {
  const julia = JULIA_OF[view.family];
  const parent = link.emit(view, contract);
  view = juliaViewOf(cx, cy);
  holdParent({ julia, cx: view.constants.cx.text, cy: view.constants.cy.text, parent });
  changed();
  rebuild();
  draw();
}

/** The view's centre as `c`, opened as that plane's Julia set at its home view. The
 *  centre's own decimal strings become `c`, so no precision is lost on the way. */
function juliaHere() {
  juliaTo(view.x, view.y);
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
  // Where this Julia set's `c` is a point of the plane being returned to, marked over the
  // picture that lands so the reader sees the place they came from. It is the centre of
  // the view Julia here left, and of the fallback frame as well, but a reader who has
  // panned the plane since keeps the mark on `c` rather than on the middle of the canvas.
  const at = { family: plane, x: view.constants.cx.value, y: view.constants.cy.value };
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
  flashMark(at);
  draw();
}

/**
 * A palette drawn at random, never the one on screen.
 *
 * **From the maps the seating has proven twice** *(Matt, 2026-09-17)*: the 232 colormaps
 * that seated more than one wallpaper in the published record, which the wallpaper project
 * states as a list and `palettes.jsonl` freezes as a flag on each map. The library is
 * about a thousand maps and most of them arrived by mechanical conversion, so a uniform
 * draw over all of them mostly lands on a map nothing was ever made in. Every map is still
 * selectable by hand, and still resolves in a link: this narrows one button.
 *
 * A baked index that marks none of them — an older module, or a bake on a checkout with no
 * such list — draws from everything, which is what this button did before the list existed.
 */
function randomPalette() {
  const drawable = [...PALETTES].filter(([, map]) => map.random).map(([name]) => name);
  const names = (drawable.length > 0 ? drawable : [...PALETTES.keys()]).filter(
    (name) => name !== view.palette,
  );
  if (names.length > 0) pickPalette(names[Math.floor(Math.random() * names.length)]);
}

/** A random phase, at the slider's own three decimals. */
function randomPhase() {
  setShade("phase", String(Number(Math.random().toFixed(3))));
}

seatButton.addEventListener("click", resetToSeat);
wholeButton.addEventListener("click", wholePlane);
juliaButton.addEventListener("click", toggleJulia);
randomPaletteButton.addEventListener("click", randomPalette);
randomPhaseButton.addEventListener("click", randomPhase);

/** While Julia here is under the pointer or holding the focus, the view's centre is
 *  marked: `here` is then a point on the picture rather than a word on a button. A Julia
 *  set's own button marks nothing, because it is the one being left. */
function hoverJulia(on) {
  const marking = on && !juliaButton.disabled && view.family in JULIA_OF;
  showMark(marking ? { family: view.family, x: view.x.value, y: view.y.value } : null);
}

for (const [event, on] of [["pointerenter", true], ["focus", true], ["pointerleave", false], ["blur", false]]) {
  juliaButton.addEventListener(event, () => hoverJulia(on));
}

/** The five toggles' keys. A bare letter, or Shift and one; with Ctrl, Alt or Meta held a
 *  key is the browser's. */
const TOGGLE_KEYS = {
  s: resetToSeat,
  r: wholePlane,
  j: toggleJulia,
  p: randomPalette,
  P: randomPhase,
};

/** A new mode keeps the place and drops the parameters, because they belonged to
 *  the mode that is being left. */
modePicker.addEventListener("change", () => {
  const mode = modePicker.value;
  // Where a seat sits at this place in the mode being switched to, the switch is back to
  // that seat's picture, parameters and all; anywhere else a trap opens at what its seats
  // were most often drawn at, and the draw takes the derived parameter from the view, and
  // a screened composite opens at `TEXTURE_DEFAULT`.
  const seated = seatsByPlace.get(`${placeOf(view)}|${mode}`);
  const params = seated !== undefined ? { ...seated } : switchedParams(mode);
  view = { ...view, mode, params };
  // A mode that was only listed because the view arrived in it goes, now it is left.
  syncModes();
  changed();
  // The texture default is held as the view moves, the way a number the reader typed is;
  // a trap's opacity is still taken from the view.
  if (seated !== undefined) tuning = "stored";
  else tuning = link.DERIVED[mode] === "weight" ? "default" : "derived";
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
  const subject = tinting();
  const changes = { palette: name };
  // A cyclic map cannot be folded, so a recipe that arrived folded is dropped
  // rather than carried onto a map it is refused on.
  if (subject.shade.mirror && PALETTES.get(name).cyclic) {
    changes.shade = { ...subject.shade, mirror: false };
  }
  palettes.show(name);
  tint(changes);
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
  // The Deep tab has one state and not two: every deep view is one the reader made, so
  // unticking takes the curve away and ticking measures the picture that is up.
  if (deep !== null && deep.owns()) {
    deep.tint({ level: levelOn ? deep.view().level : null });
    syncLevel();
    return;
  }
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
  url.search = `?${currentQuery()}`;
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

/** The canvas's display size changed: the backing store follows, and what is up is drawn
 *  again — the walk's own pictures while it shows them. Also run when the walk view comes
 *  or goes, which moves the picture's size without the window's. */
let resizing = 0;
function relayout() {
  clearTimeout(resizing);
  resizing = setTimeout(() => {
    if (busy) return;
    if (!resize()) return;
    if (deepOwns()) deep.repaint();
    else if (walkLayers !== null) paintWalk();
    else draw();
  }, 200);
}
window.addEventListener("resize", relayout);

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
  // Three small records go out beside them, and each is allowed to fail: the gallery's
  // header, which says which modes the Mode select offers; the display names; and the
  // Popular list. Without any of them the page still draws, showing every mode, every map
  // by its own name, and Popular by seats alone.
  //
  // **The header, not the gallery** *(explorer_slim_ckpt131)*. The Mode select's roster
  // was the only reason the first frame waited on the gallery record, and that record was
  // 605 KB on the wire for 3 KB of what the select needs. The header carries the roster
  // and is under 2 KB; the rows come after the first frame, a collection at a time.
  const [started, , record, names, listed] = await Promise.all([
    Renderer.start(new URL("./engine.wasm", import.meta.url)),
    fetchStops(new URL("./palettes.bin", import.meta.url)),
    gallery.load(import.meta.url).catch((error) => error),
    json(new URL("./palette-names.json", import.meta.url)),
    json(new URL("./popular.json", import.meta.url)),
  ]);
  renderer = started;
  paletteNames = shownNames(names);
  // The published gallery's modes, and not every collection's: a collection may seat a
  // mode the general gallery does not, and the select's roster is the published one's.
  if (!(record instanceof Error) && Array.isArray(record.modes)) offeredModes = record.modes;

  contract = {
    home: homeOf,
    constants: seedConstants,
    palettes: PALETTES,
    defaultPalette: DEFAULT_PALETTE,
    settled: (mode) => SETTLED[mode],
  };

  // What the deep contract needs, which is the shallow one's palette set and two numbers
  // neither contract owns: where the Mandelbrot set comes home to, and what cap a width
  // implies. The home is `engine.wasm`'s and the cap is `perturb.wasm`'s — asked of the
  // engine until that module is up, because the two agree everywhere the engine answers
  // and the tab replaces it with the kernel's the moment it has one.
  deepContext = {
    palettes: PALETTES,
    defaultPalette: DEFAULT_PALETTE,
    deepHome: () => {
      const home = homeOf("mandelbrot");
      return { x: home.x.text, y: home.y.text, w: home.w.text };
    },
    deepCap: (width) => renderer.maxiter(width),
  };

  fill(familyPicker, link.FAMILIES);
  makeSaved();

  // **A deep link is read by the deep contract and never by the shallow one.** The marker
  // is what decides, at the door, before either reader sees a key it would refuse. What
  // the viewer opens at in that case is the Mandelbrot home — the Deep tab has the picture,
  // and the viewer behind it is what Back to the explorer comes out onto.
  const arriving = link.isDeep(window.location.search) ? window.location.search : null;
  // **And a link the paged Inflection tab wrote is refused at that same door**, before the
  // shallow reader sees it — see `INFLECTION_PAGED`. It would be refused either way, by the
  // unknown-key sweep on `iv`, but a reader holding a picture's link is owed the reason
  // rather than the mechanism.
  if (link.isInflected(window.location.search)) {
    refuse(INFLECTION_PAGED);
    return;
  }
  try {
    view =
      arriving === null
        ? link.parse(window.location.search, contract)
        : link.fresh("mandelbrot", "smooth", contract);
  } catch (error) {
    refuse(`${error.message} Nothing has been drawn, because guessing what was meant would be worse than saying so.`);
    return;
  }
  if (arriving !== null || saved.items.some((item) => link.isDeep(`?${item.link}`))) {
    await loadDeepRules();
  }  if (arriving !== null) {
    try {
      deepRules.parse(arriving, deepContext);
    } catch (error) {
      refuse(`${error.message} Nothing has been drawn, because guessing what was meant would be worse than saying so.`);
      return;
    }
  }
  arrived();
  // A bare page names no picture, so there is nothing it arrived with to replay: the
  // explorer's own home view is measured like any view a reader made.
  const named = [...new URLSearchParams(window.location.search).keys()].filter(
    (key) => !link.UI_KEYS.has(key),
  );
  if (named.length === 0) levelling = "derived";
  // And a page that did name one opened at it, which is where Reset to link goes back to.
  // A bare page opened at nothing: its button is greyed and says so.
  if (named.length > 0) {
    anchor = { query: link.emit(view, contract), opts: {}, at: pictureKey(view) };
  }

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
    // The link the saved file carries. The shallow contract's, deliberately, and not
    // `currentQuery()` — see the note on `install`'s context.
    queryOf: () => link.emit(view, contract),
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
    // **The other view this row can be about** *(deep_cap_policy_ckpt138)*. Every member is
    // asked through `deep` rather than captured, because the tab is mounted lazily and may
    // not exist when this is installed; `owns` answering false is what keeps the row the
    // viewer's until it does.
    deep: {
      owns: () => deepOwns(),
      view: () => deep.view(),
      query: () => deep.link(),
      plan: (width, height, supersample) => deep.plan(width, height, supersample),
      measured: () => deep.measured(),
      shown: () => deep.shown(),
      picture: (width, height, options) => deep.picture(width, height, options),
      cancel: () => deep.stop(),
    },
  });
  panel.describe();

  juliaCard = juliaPreview.mount({
    module: renderer.module,
    card: document.getElementById("julia-preview"),
    picture: document.getElementById("julia-preview-picture"),
    readout: document.getElementById("julia-preview-c"),
    fallen: document.getElementById("julia-preview-fell"),
    off: document.getElementById("julia-preview-off"),
    toggle: document.getElementById("julia-preview-on"),
    // The view entering would give, which is the whole point of the card.
    viewFor: (cx, cy) => juliaViewOf(link.coordinateOf(cx), link.coordinateOf(cy)),
    // The same two facts the download row asks for: whether this view measures its own
    // tone, and nothing about the size it is drawn at.
    deriving: () => levelling === "derived" && levelOn,
    // **It yields to the main picture.** Nothing is started while a pass is running, and
    // the settle re-arms instead — a preview that competed with the render it is standing
    // next to would be a preview that made the page feel slower to use.
    quiet: () => inFlight === null,
    live: previewable,
    say,
  });

  // Which panel the link asked for. A UI key is never validated by the contract, so an
  // unknown one lands on the default rather than refusing a picture over furniture.
  if (arriving !== null) {
    // The tab opens on the link's own frame rather than on the viewer's, and draws the
    // quarter pass and nothing else: a link that started a full deep render on arrival
    // would be a link that costs a minute to follow.
    //
    // Mounted and opened BEFORE the panel is shown, so the tab is never on screen standing
    // on a frame the link did not name.
    deepOpening = true;
    rebuild();
    resize();
    await startDeep();
    deep?.open(saving.queryOf(arriving));
    showPanel("deep");
  } else {
    showPanel(new URLSearchParams(window.location.search).get("panel") ?? DEFAULT_PANEL);
    rebuild();
    resize();
    draw();
  }

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
    saveMark: (row) => saving.mark(saved, canonicalOf(row.link)),
    onSeats: indexSeats,
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
