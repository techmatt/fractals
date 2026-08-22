// The explorer page: a canvas, a strip of controls, and an address bar that is
// always a valid permalink.
//
// Everything about what a link MEANS lives in `permalink.js` and everything about
// how a picture is MADE lives in `render.js`. What is here is the part a reader
// touches — dragging, the wheel, the keys, the pickers — and the one rule that
// binds them together: after every settled view the URL is rewritten to the
// canonical string, so the thing in the address bar is the thing to send somebody.
//
// The controls are **derived, never typed**. Which families exist and which modes
// are offered come from the contract; what a mode is for comes from the baked
// catalog; which parameters a mode has comes from the contract and what they are
// set to comes from the module's own plan. Nothing here holds a second opinion
// about the engine's catalog, so a mode retuned over there arrives by rebuilding.

import * as link from "./permalink.js";
import { CONSTANTS as ANCHORS, MODES as IDENTITIES } from "./catalog.js";
import { DEFAULT_PALETTE, PALETTES, PROVENANCE } from "./palettes.js";
import { PREVIEW_DIVISOR, Renderer, familySpecOf, pixelGrid, specOf } from "./render.js";

/** How far one arrow key moves the view, as a share of its width. */
const PAN_STEP = 0.1;
/** What one press of `+` or `-` multiplies the width by. */
const KEY_ZOOM = 1.4;
/** How much one wheel notch multiplies the width by. */
const WHEEL_ZOOM = 1.15;

/** How a mode's parameter is stepped in its control, and what it is called.
 *
 *  The label is the reader's word for it and the step is a sensible nudge; neither
 *  is an engine constant and neither bounds anything — the contract refuses a value
 *  out of range and the engine refuses it again. What a parameter is SET to when
 *  nobody has moved it comes from the module's plan, never from here. */
const CONTROLS = {
  density: { label: "Stripe density", step: 1 },
  radius: { label: "Trap radius", step: 0.1 },
  sigma: { label: "Kernel width", step: 0.05 },
  weight: { label: "Texture", step: 0.05 },
  shift: { label: "Shift", step: 0.1 },
  threshold: { label: "Threshold", step: 0.01 },
  opacity: { label: "Opacity", step: 0.05 },
};

const canvas = document.getElementById("canvas");
const screen = canvas.getContext("2d", { alpha: false });
const frame = document.createElement("canvas");
const frameScreen = frame.getContext("2d", { alpha: false });

const stage = document.getElementById("stage");
const bar = document.getElementById("bar");
const status = document.getElementById("status");
const readout = document.getElementById("readout");
const familyPicker = document.getElementById("family");
const modePicker = document.getElementById("mode");
const picker = document.getElementById("palette");
const constantStrip = document.getElementById("constants");
const paramStrip = document.getElementById("params");
const copyButton = document.getElementById("copy");
const notice = document.getElementById("notice");

let renderer = null;
let contract = null;
let view = null;
let grid = { width: 0, height: 0 };
let settleTimer = 0;
const homes = new Map();

// ------------------------------------------------------------------- what to say

function say(text) {
  status.textContent = text;
}

/** A refusal: the picture is not drawn, and the reason is on the page. */
function refuse(message) {
  notice.textContent = message;
  notice.hidden = false;
  stage.hidden = true;
  bar.hidden = true;
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

/** Move to a freshly computed geometry, with the coordinates written shortest. */
function moveTo(x, y, w) {
  view = {
    ...view,
    x: link.coordinateOf(x),
    y: link.coordinateOf(y),
    w: link.coordinateOf(w),
  };
}

/** Zoom by `factor` about a point of the canvas, refusing to pass the `f64` wall. */
function zoomAbout(px, py, factor) {
  const anchor = planeAt(px, py);
  const width = view.w.value * factor;
  if (factor < 1 && !renderer.resolves(view.x.value, view.y.value, width, grid.width, grid.height)) {
    say("this is as deep as f64 goes — two neighbouring samples would be the same number");
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

/** Re-colour the picture already on the screen, with no field computed. */
function reshade(direct) {
  const key = link.fieldKey(view, contract, grid.width, grid.height, direct);
  const field = renderer.cached(key);
  if (field === undefined) return false;
  const shaded = renderer.shade(field, view);
  present(shaded.image);
  say(`recoloured in ${shaded.elapsed.toFixed(0)} ms`);
  settle();
  return true;
}

let drawing = 0;

/** The whole pass: preview, then full resolution, either served from the cache. */
async function draw() {
  updateReadout();
  const pass = ++drawing;
  renderer.cancel();

  const shape = planOf(view);
  if (!shape.ok) {
    say(shape.why);
    return;
  }
  if (reshade(shape.direct)) return;

  const previewGrid = {
    width: grid.width / PREVIEW_DIVISOR,
    height: grid.height / PREVIEW_DIVISOR,
  };
  const previewKey = link.fieldKey(view, contract, previewGrid.width, previewGrid.height, shape.direct);
  const fullKey = link.fieldKey(view, contract, grid.width, grid.height, shape.direct);

  try {
    const cachedPreview = renderer.cached(previewKey);
    if (cachedPreview !== undefined) {
      stretch(renderer.shade(cachedPreview, view).image);
    } else {
      say(`iterating at ${previewGrid.width}×${previewGrid.height}…`);
      const preview = await renderer.field(view, previewGrid.width, previewGrid.height);
      if (preview === null || pass !== drawing) return;
      renderer.remember(previewKey, preview);
      stretch(renderer.shade(preview, view).image);
    }

    say(`iterating at ${grid.width}×${grid.height} on ${renderer.workerCount} workers…`);
    const full = await renderer.field(view, grid.width, grid.height);
    if (full === null || pass !== drawing) return;
    renderer.remember(fullKey, full);
    const shaded = renderer.shade(full, view);
    present(shaded.image);
    say(
      `${grid.width}×${grid.height} · field ${(full.elapsed / 1000).toFixed(2)} s ` +
        `· shade ${shaded.elapsed.toFixed(0)} ms`,
    );
    settle();
  } catch (error) {
    say(String(error.message ?? error));
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
  readout.textContent =
    `x ${view.x.text}  ·  y ${view.y.text}  ·  w ${view.w.text}  ·  ${cap} iterations`;
}

/** Write the canonical permalink into the address bar. */
function settle() {
  clearTimeout(settleTimer);
  settleTimer = setTimeout(() => {
    history.replaceState(null, "", `?${link.emit(view, contract)}`);
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
      const text = input.value.trim();
      const value = Number(text);
      if (text === "" || !Number.isFinite(value)) {
        say(`${label.textContent} has to be a decimal number — “${input.value}” is not one`);
        input.value = view.constants[key].text;
        return;
      }
      view = { ...view, constants: { ...view.constants, [key]: { text, value } } };
      homes.delete(view.family);
      draw();
    });
    constantStrip.append(label, input);
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
    const input = document.createElement("input");
    input.type = "number";
    input.id = `param-${key}`;
    input.className = "param";
    input.step = control.step;
    input.value = view.params[key] ?? settled[key] ?? "";
    input.addEventListener("change", () => {
      const value = Number(input.value);
      if (!Number.isFinite(value)) {
        input.value = view.params[key] ?? settled[key] ?? "";
        return;
      }
      view = { ...view, params: { ...view.params, [key]: value } };
      draw();
    });
    paramStrip.append(label, input);
  }
}

/**
 * The palette picker's options: the offered maps, and whatever is drawn right now.
 *
 * A few baked maps are not offered — they are here so that a figure of the article can
 * be opened at the map it was drawn in, and not to widen a curated set this site does
 * not own. A link arriving on one still has to be shown truthfully, so it joins the
 * list while it is in force and leaves again the moment the reader picks something
 * else. A select that quietly showed a different name than the picture is drawn in
 * would be worse than either.
 */
function paletteNames() {
  const names = [...PALETTES].filter(([, map]) => map.offered).map(([name]) => name);
  return names.includes(view.palette) ? names : [view.palette, ...names];
}

/** Whatever the reader just chose, drawn — and the strips rebuilt around it. */
function rebuild() {
  familyPicker.value = view.family;
  modePicker.value = view.mode;
  fill(picker, paletteNames());
  picker.value = view.palette;
  buildConstants();
  buildParams();
  stage.style.aspectRatio = `${view.aspect.across} / ${view.aspect.down}`;
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
  screen.fillStyle = "#000";
  screen.fillRect(0, 0, grid.width, grid.height);
  const width = grid.width * scale;
  const height = grid.height * scale;
  screen.drawImage(frame, dx + (grid.width - width) / 2, dy + (grid.height - height) / 2, width, height);
}

canvas.addEventListener("pointerdown", (event) => {
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
  view = {
    ...link.fresh(familyPicker.value, view.mode, contract),
    params: view.params,
    aspect: view.aspect,
    palette: view.palette,
    shade: view.shade,
  };
  rebuild();
  draw();
});

/** A new mode keeps the place and drops the parameters, because they belonged to
 *  the mode that is being left. */
modePicker.addEventListener("change", () => {
  view = { ...view, mode: modePicker.value, params: {} };
  buildParams();
  draw();
});

picker.addEventListener("change", () => {
  view = { ...view, palette: picker.value };
  // A cyclic map cannot be folded, so a recipe that arrived folded is dropped
  // rather than carried onto a map it is refused on.
  if (view.shade.mirror && PALETTES.get(view.palette).cyclic) {
    view = { ...view, shade: { ...view.shade, mirror: false } };
  }
  // Refilled because the map just left may have been an unoffered one, and the picker
  // carries such a map only while it is the one on the screen.
  fill(picker, paletteNames());
  picker.value = view.palette;
  draw();
});

copyButton.addEventListener("click", async () => {
  const url = new URL(window.location.href);
  url.search = `?${link.emit(view, contract)}`;
  url.hash = "";
  try {
    await navigator.clipboard.writeText(url.toString());
    say("link copied");
  } catch {
    say(url.toString());
  }
});

let resizing = 0;
window.addEventListener("resize", () => {
  clearTimeout(resizing);
  resizing = setTimeout(() => {
    if (resize()) draw();
  }, 200);
});

// ------------------------------------------------------------------- starting up

async function main() {
  renderer = await Renderer.start(new URL("./engine.wasm", import.meta.url));

  contract = {
    home: homeOf,
    constants: seedConstants,
    palettes: PALETTES,
    defaultPalette: DEFAULT_PALETTE,
  };

  fill(familyPicker, link.FAMILIES);
  fill(modePicker, link.MODES, IDENTITIES);

  try {
    view = link.parse(window.location.search, contract);
  } catch (error) {
    refuse(`${error.message} Nothing has been drawn, because guessing what was meant would be worse than saying so.`);
    return;
  }

  document.getElementById("provenance").textContent =
    `${PROVENANCE.offered} curated palettes and ${IDENTITIES.size} production modes, baked from ` +
    `fractal-wallpapers ${PROVENANCE.wallpapers_commit.slice(0, 12)} on ${PROVENANCE.baked}.`;

  clearNotice();
  stage.hidden = false;
  bar.hidden = false;
  rebuild();
  resize();
  draw();
}

main().catch((error) => {
  refuse(
    `The explorer could not start: ${error.message ?? error}. It needs to be served over http — ` +
      "opened straight off the filesystem a browser will not load its module, its workers or its " +
      "renderer. `python -m builder serve` puts this tree on localhost.",
  );
});
