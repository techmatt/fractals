// The explorer page: a canvas, a small bar, and an address bar that is always a
// valid permalink.
//
// Everything about what a link MEANS lives in `permalink.js` and everything about
// how a picture is MADE lives in `render.js`. What is here is the part a reader
// touches — dragging, the wheel, the keys, the picker — and the one rule that
// binds them together: after every settled view the URL is rewritten to the
// canonical string, so the thing in the address bar is the thing to send somebody.

import * as link from "./permalink.js";
import { DEFAULT_PALETTE, PALETTES, PROVENANCE } from "./palettes.js";
import { PREVIEW_DIVISOR, Renderer, pixelGrid } from "./render.js";

/** How far one arrow key moves the view, as a share of its width. */
const PAN_STEP = 0.1;
/** What one press of `+` or `-` multiplies the width by. */
const KEY_ZOOM = 1.4;
/** How much one wheel notch multiplies the width by. */
const WHEEL_ZOOM = 1.15;

const canvas = document.getElementById("canvas");
const screen = canvas.getContext("2d", { alpha: false });
const frame = document.createElement("canvas");
const frameScreen = frame.getContext("2d", { alpha: false });

const stage = document.getElementById("stage");
const bar = document.getElementById("bar");
const status = document.getElementById("status");
const readout = document.getElementById("readout");
const picker = document.getElementById("palette");
const copyButton = document.getElementById("copy");
const notice = document.getElementById("notice");

let renderer = null;
let contract = null;
let view = null;
let grid = { width: 0, height: 0 };
let settleTimer = 0;

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

/** Re-color the picture already on the screen, with no field computed. */
function reshade() {
  const key = link.fieldKey(view, contract, grid.width, grid.height);
  const field = renderer.cached(key);
  if (field === undefined) return false;
  const shaded = renderer.shade(field, view);
  present(shaded.image);
  say(`recolored in ${shaded.elapsed.toFixed(0)} ms`);
  settle();
  return true;
}

let drawing = 0;

/** The whole pass: preview, then full resolution, either served from the cache. */
async function draw() {
  updateReadout();
  const pass = ++drawing;
  renderer.cancel();

  if (reshade()) return;

  const previewGrid = {
    width: grid.width / PREVIEW_DIVISOR,
    height: grid.height / PREVIEW_DIVISOR,
  };
  const previewKey = link.fieldKey(view, contract, previewGrid.width, previewGrid.height);
  const fullKey = link.fieldKey(view, contract, grid.width, grid.height);

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

/** Form controls keep their own keys: the palette list is a select, and a reader
 *  arrowing through it is picking a colour, not panning the plane. */
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

picker.addEventListener("change", () => {
  view = { ...view, palette: picker.value };
  // A cyclic map cannot be folded, so a recipe that arrived folded is dropped
  // rather than carried onto a map it is refused on.
  if (view.shade.mirror && PALETTES.get(view.palette).cyclic) {
    view = { ...view, shade: { ...view.shade, mirror: false } };
  }
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

  const home = renderer.home();
  contract = {
    home: {
      x: link.coordinateOf(home.x),
      y: link.coordinateOf(home.y),
      w: link.coordinateOf(home.w),
    },
    palettes: PALETTES,
    defaultPalette: DEFAULT_PALETTE,
  };

  for (const name of PALETTES.keys()) {
    const option = document.createElement("option");
    option.value = name;
    option.textContent = name;
    picker.append(option);
  }

  try {
    view = link.parse(window.location.search, contract);
  } catch (error) {
    refuse(`${error.message} Nothing has been drawn, because guessing what was meant would be worse than saying so.`);
    return;
  }

  picker.value = view.palette;
  stage.style.aspectRatio = `${view.aspect.across} / ${view.aspect.down}`;
  document.getElementById("provenance").textContent =
    `${PROVENANCE.count} curated palettes, baked from fractal-wallpapers ` +
    `${PROVENANCE.wallpapers_commit.slice(0, 12)} on ${PROVENANCE.baked}.`;

  clearNotice();
  stage.hidden = false;
  bar.hidden = false;
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
