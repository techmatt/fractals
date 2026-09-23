// The Phoenix tab *(phoenix_tab_ckpt140, 2026-09-22)*.
//
// The Phoenix recurrence z ↦ z² + c + p·z₋₁ has two planes. The one the rest of this page
// has always drawn, `phoenix`, fixes `c` and `p` and lets the pixel be z₀: a Julia-type
// set. This tab draws the other one, `phoenix_plane` (the engine's `phoenix_m`), which
// fixes `p`, opens every orbit at z₀ = z₋₁ = 0 and lets the pixel be `c`. Each point of it
// is one of those sets, so it is a map of them, and a click opens the one under the
// pointer on the viewer: that `c`, this `p`, and whatever mode and palette the viewer has.
//
// **The plane is drawn here, live, on a pool of its own.** The atlas's plane is a picture
// rendered once next door with marks over it, and this one has to move with `p`, so it is
// the pattern the walk, the Saved tab and the preview card already use instead: a second
// `Renderer` over the compiled module, one job at a time, never the viewer's. It draws at
// one sample a pixel in the panel's style, below, because it is a map to aim with rather
// than a picture to keep; the picture is what the click opens.
//
// **One style for the whole panel** *(phoenix_keypoints_and_plane_ckpt141)*. The plane,
// the preview card over it and every tile are drawn in the style `phoenix-points.json`
// carries — `smooth`, Violet Rosewood, gamma 0.38 — and never in the viewer's palette,
// which a click into a set is free to change. `builder/phoenix_points.py`'s `STYLE` is the
// one place it is written; the tiles are drawn in it there and the plane reads it here.
// What a click opens is the viewer's: its mode and its palette.
//
// **It is the viewer's gestures, a size smaller.** The wheel zooms about the pointer, a
// drag pans, a press that does not move is the click. The frame and `p` are this browser
// tab's session, so Back to Phoenix plane finds the plane where the click left it.
//
// The preview card is `julia-preview.js`, mounted a second time over this plane with its
// own flag: the same machinery at one sample a pixel, off until the box says otherwise.
//
// **Starting points** *(phoenix_named_points_ckpt141)*. A grid of tiles under the plane and
// its `p` *(phoenix_plane_restore_ckpt141)*, read from `phoenix-points.json`: the classic,
// and seven `(p, c)` the curation passes seated, which `python -m builder phoenix-points`
// chose for spread over `p`. A tile is the **whole set** at its `(p, c)`, at the family's
// home view *(phoenix_keypoints_and_plane_ckpt141)*, and a click is a click on the plane
// there: `p` moves to the point's, the plane opens at the frame the record boxes that `p`'s
// set in, `c` is marked, and the set opens on the viewer in the viewer's mode and palette.
// The frame is set rather than kept, because the reader's last zoom, recentred on a `c`
// at the set's edge, can hold little but exterior. Most of those `p` are
// complex, and the plane is drawn at the whole of it. The control stays real: the slider
// and the box are `Re p`, `Im p` is shown beside them, and moving either sets `Im p` back
// to zero.

import * as juliaPreview from "./julia-preview.js";
import { heldOut, stopOf } from "./outermost.js";
import { Renderer } from "./render.js";

/** Where the frame and `p` are kept between visits to the tab, in this session. */
const KEY = "explorer.phoenix-plane";

/** Where the preview card's own flag is kept, apart from the viewer's card's. */
const PREVIEW_KEY = "explorer.phoenix-preview";

/** The classic Ushiki instance, as a point of this plane: `c = 0.5667` on the `p = −0.5`
 *  plane. Marked only while the plane is that plane, because on any other `p` the classic
 *  set is not a point of it. */
const CLASSIC = { x: 0.5667, y: 0, p: -0.5 };

/** The p control's range and step, which the slider and the box share. */
const P_LEAST = -1;
const P_MOST = 1;
const P_DECIMALS = 3;

/** One notch of the wheel. How far out it may go is `outermost.js`'s, as on the viewer. */
const WHEEL_ZOOM = 1.15;

/** A press that moves less than this, in CSS pixels, is a click and not a drag. */
const CLICK_SLOP = 4;

/** How long the plane waits after a change before it draws, so that a wheel spun or a
 *  slider dragged draws the frame it stops at rather than every frame on the way. */
const SETTLE_MS = 70;

/** The largest the plane is drawn at, in device pixels across. It is a map a panel wide,
 *  and past this a wider screen buys sharpness nobody aims with. */
const MOST_WIDTH = 720;

/** The starting points' record, beside this module. */
const POINTS_URL = new URL("./phoenix-points.json", import.meta.url);

/** A starting point's tile, the staged gallery's own size, which the builder draws at. */
const TILE = { width: 316, height: 178 };

/** A number as the tile's label spells it: three places, a real minus sign. */
function spelled(value) {
  return Number(value.toFixed(P_DECIMALS)).toString().replace("-", "−");
}

/** `p` as the tile's label spells it, dropping an imaginary part of zero. */
function spelledP([re, im]) {
  if (im === 0) return `p = ${spelled(re)}`;
  return `p = ${spelled(re)} ${im < 0 ? "−" : "+"} ${spelled(Math.abs(im))}i`;
}

/**
 * Mount the tab.
 *
 * `host` is what this borrows from the page: the compiled module, the tab's elements, the
 * plane's home frame and default `p`, a way to turn the record's style into a view's look,
 * a way to build the set a point opens and to open it, and the page's status line.
 */
export function mount(host) {
  const { module, canvas, plane, slider, box, boxIm, previewToggle, card, note, wholeButton } =
    host;
  const { home, defaultP, lookOf, setOf, open, points, planeView, say } = host;
  const paint = canvas.getContext("2d", { alpha: false });

  let renderer = null;
  let starting = null;
  let timer = 0;
  let drawing = false;
  let owed = false;
  /** The panel's style as a view's look — mode, palette, shade, no curve — once the record
   *  has been read. Nothing on the panel draws before it. */
  let style = null;
  let shown = false;
  /** The last picture drawn, as a bitmap, and the frame it was drawn at, so a drag or a
   *  wheel can slide it before the next frame is drawn. */
  let last = null;
  /** A press in progress: where it started, the frame it started on, and whether it has
   *  moved far enough to be a drag. */
  let drag = null;

  /** The starting point the reader last chose, marked while the plane is at its `p`, and
   *  let go by any other way of choosing a place. */
  let chosen = null;
  let loadingPoints = null;

  const kept = restored();
  let frame = kept?.frame ?? { ...home() };
  let p = kept?.p ?? defaultP();
  /** The imaginary part of `p`, zero unless a starting point moved it. */
  let pi = Number.isFinite(kept?.pi) ? kept.pi : 0;
  syncP();

  const preview = juliaPreview.mount({
    module,
    card,
    picture: card.querySelector("canvas"),
    readout: card.querySelector(".julia-preview-said span"),
    fallen: card.querySelector(".julia-preview-fell"),
    off: card.querySelector(".julia-preview-off"),
    toggle: previewToggle,
    storageKey: PREVIEW_KEY,
    name: "Phoenix preview",
    viewFor: (cx, cy) => ({ ...setOf(cx, cy, current()), ...style }),
    deriving: () => false,
    quiet: () => !drawing,
    live: () => shown && drag === null && style !== null,
    say,
  });

  // ------------------------------------------------------------------ the kept state

  function restored() {
    try {
      const held = JSON.parse(window.sessionStorage.getItem(KEY) ?? "null");
      const numbers = [held?.frame?.x, held?.frame?.y, held?.frame?.w, held?.p];
      if (!numbers.every(Number.isFinite) || !(held.frame.w > 0)) return null;
      return held;
    } catch {
      return null;
    }
  }

  function keep() {
    try {
      window.sessionStorage.setItem(KEY, JSON.stringify({ frame, p, pi }));
    } catch {
      // A browser that stores nothing still has the plane; Back finds it at its home.
    }
  }

  // ---------------------------------------------------------------------- the view

  /** The plane as a view the page can draw, emit or hold: this frame, this `p`. */
  function current() {
    return planeView({ x: frame.x, y: frame.y, w: frame.w, p, pi });
  }

  function start() {
    if (renderer !== null) return Promise.resolve(renderer);
    starting ??= Renderer.over(
      module,
      Math.max(1, Math.min(4, Math.floor((navigator.hardwareConcurrency || 8) / 3))),
    ).then((made) => {
      renderer = made;
      return made;
    });
    return starting;
  }

  /** The canvas's pixel grid: its laid-out width at the display's density, capped, and
   *  16:9 because the stylesheet holds its box to that. */
  function grid() {
    const across = Math.max(1, Math.round(canvas.clientWidth * (window.devicePixelRatio || 1)));
    const width = Math.min(MOST_WIDTH, across);
    return { width, height: Math.max(1, Math.round((width * 9) / 16)) };
  }

  /** The point of the plane under a canvas position given in CSS pixels. */
  function planeAt(cssX, cssY) {
    const across = cssX / canvas.clientWidth;
    const down = cssY / canvas.clientHeight;
    const height = (frame.w * 9) / 16;
    return { x: frame.x + (across - 0.5) * frame.w, y: frame.y - (down - 0.5) * height };
  }

  /** Where a point of the plane falls on the canvas, in its own pixels. */
  function canvasAt(x, y) {
    const height = (frame.w * 9) / 16;
    return {
      px: ((x - frame.x) / frame.w + 0.5) * canvas.width,
      py: (0.5 - (y - frame.y) / height) * canvas.height,
    };
  }

  // ---------------------------------------------------------------------- the draw

  function schedule() {
    keep();
    if (!shown) return;
    clearTimeout(timer);
    timer = setTimeout(draw, SETTLE_MS);
  }

  async function draw() {
    timer = 0;
    // The record carries the style, and the plane is drawn in nothing else: until it lands
    // the plane waits, and `loadPoints` asks again when it has.
    if (!shown || style === null) return;
    if (drawing) {
      // The draw in flight is of a frame the reader has left; this one is owed after it.
      owed = true;
      renderer?.cancel();
      return;
    }
    drawing = true;
    owed = false;
    const { width, height } = grid();
    const at = { ...frame };
    const view = { ...current(), ...style };
    try {
      const r = await start();
      const field = await r.field(view, width, height);
      if (field === null) return;
      const shaded = await r.shadePooled(field, view, {});
      if (shaded === null) return;
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      paint.putImageData(shaded.image, 0, 0);
      const bitmap = new OffscreenCanvas(width, height);
      bitmap.getContext("2d").putImageData(shaded.image, 0, 0);
      last = { bitmap, frame: at };
      markPoints();
      note.hidden = true;
    } catch (error) {
      note.textContent = `The plane could not be drawn: ${error.message}`;
      note.hidden = false;
    } finally {
      drawing = false;
      if (owed) schedule();
    }
  }

  /** The marks over the plane: the classic's while the plane is at its `p`, and the chosen
   *  starting point's while the plane is at that one's. A chosen point is the crosshair in a
   *  ring, the classic's included; the classic unchosen is the bare crosshair. */
  function markPoints() {
    const here = chosen !== null && chosen.p[0] === p && chosen.p[1] === pi;
    const classicChosen = here && chosen.source === "classic";
    if (p === CLASSIC.p && pi === 0) crosshair(CLASSIC.x, CLASSIC.y, classicChosen);
    if (!here || classicChosen) return;
    crosshair(chosen.c[0], chosen.c[1], true);
  }

  /** A point of the plane, as the viewer's crosshair is drawn: a dark stroke under a light
   *  one, four arms with the point itself left clear, and a ring round it when `ringed`. */
  function crosshair(cx, cy, ringed) {
    const { px, py } = canvasAt(cx, cy);
    if (px < 0 || py < 0 || px > canvas.width || py > canvas.height) return;
    const arm = Math.max(6, Math.min(canvas.width, canvas.height) * 0.05);
    const clear = arm * 0.35;
    const x = Math.round(px) + 0.5;
    const y = Math.round(py) + 0.5;
    for (const [color, lineWidth] of [
      ["rgb(0 0 0 / 0.8)", 3],
      ["rgb(255 255 255 / 0.95)", 1.25],
    ]) {
      paint.strokeStyle = color;
      paint.lineWidth = lineWidth;
      paint.beginPath();
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        paint.moveTo(x + dx * clear, y + dy * clear);
        paint.lineTo(x + dx * arm, y + dy * arm);
      }
      if (ringed) {
        paint.moveTo(x + arm * 1.25, y);
        paint.arc(x, y, arm * 1.25, 0, 2 * Math.PI);
      }
      paint.stroke();
    }
  }

  // ---------------------------------------------------------------- starting points

  /** Read the record, once: the panel's style, and the tiles. The plane waits on the style,
   *  so a record that will not load says so in the tab's note and nothing is drawn. */
  function loadPoints() {
    loadingPoints ??= fetch(POINTS_URL)
      .then((response) => {
        if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
        return response.json();
      })
      .then((record) => {
        style = lookOf(record.style);
        points.replaceChildren(...record.points.map(tileOf));
        schedule();
      })
      .catch((error) => {
        note.textContent = `The starting points could not be loaded: ${error.message}`;
        note.hidden = false;
      });
    return loadingPoints;
  }

  /** One tile: the whole set at its `(p, c)`, its `p` under it, and a click that goes there. */
  function tileOf(point) {
    const entry = document.createElement("button");
    entry.type = "button";
    entry.className = "minibrot phoenix-point";
    const well = document.createElement("div");
    well.className = "minibrot-tile";
    const picture = document.createElement("img");
    picture.src = new URL(point.file, POINTS_URL).href;
    picture.width = TILE.width;
    picture.height = TILE.height;
    picture.alt = "";
    picture.loading = "lazy";
    well.append(picture);
    entry.title =
      point.source === "classic"
        ? "The classic Phoenix: its whole set, and its place on the plane."
        : "A set the gallery seats a picture in: its whole set, and its place on the plane.";
    entry.append(well);
    const said = document.createElement("span");
    said.className = "minibrot-said";
    said.textContent = spelledP(point.p);
    entry.append(said);
    entry.setAttribute("aria-label", `${point.source === "classic" ? "The classic, " : ""}${said.textContent}`);
    entry.addEventListener("click", () => go(point));
    return entry;
  }

  /** Go to a starting point: `p` to its `p`, the plane at the frame the record boxes that
   *  `p`'s set in, the mark on `c`, and the whole set open on the viewer — a click on the
   *  plane there, arrived at by a tile. */
  function go(point) {
    chosen = point;
    p = point.p[0];
    pi = point.p[1];
    syncP();
    frame = { ...point.plane };
    preview.hide();
    schedule();
    open(point.c[0], point.c[1], current());
  }

  /** While a drag is under way, the last picture slid by the drag, so the plane moves
   *  with the hand before the new frame is drawn. */
  function slide() {
    if (last === null) return;
    const { px, py } = canvasAt(last.frame.x, last.frame.y);
    const scale = last.frame.w / frame.w;
    paint.fillStyle = "#000";
    paint.fillRect(0, 0, canvas.width, canvas.height);
    const drawnWidth = canvas.width * scale;
    const drawnHeight = canvas.height * scale;
    paint.drawImage(last.bitmap, px - drawnWidth / 2, py - drawnHeight / 2, drawnWidth, drawnHeight);
  }

  // ---------------------------------------------------------------------- the p control

  /** The controls show `Re p` at three places, and `Im p` beside the box while it is not
   *  zero. A starting point's `p` is held at the digits its link carries, so the plane its
   *  Back lands on is the plane it was chosen from. */
  function syncP() {
    const text = p.toFixed(P_DECIMALS);
    slider.value = text;
    box.value = text;
    boxIm.hidden = pi === 0;
    boxIm.textContent = pi === 0 ? "" : `${pi < 0 ? "−" : "+"} ${spelled(Math.abs(pi))}i`;
  }

  /** The reader moved `p` by hand. The control is real, so the move is to a real `p`: an
   *  imaginary part a starting point left goes back to zero, the chosen point is let go,
   *  and the plane redraws. */
  function setP(value) {
    if (!Number.isFinite(value)) {
      syncP();
      return;
    }
    const next = Number(Math.min(P_MOST, Math.max(P_LEAST, value)).toFixed(P_DECIMALS));
    if (next === p && pi === 0) {
      syncP();
      return;
    }
    p = next;
    pi = 0;
    chosen = null;
    syncP();
    preview.hide();
    schedule();
  }

  slider.addEventListener("input", () => setP(Number(slider.value)));
  box.addEventListener("change", () => setP(Number(box.value)));

  // ---------------------------------------------------------------------- the gestures

  canvas.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    canvas.setPointerCapture(event.pointerId);
    drag = { x: event.offsetX, y: event.offsetY, frame: { ...frame }, moved: false };
  });

  canvas.addEventListener("pointermove", (event) => {
    if (drag !== null) {
      const dx = event.offsetX - drag.x;
      const dy = event.offsetY - drag.y;
      if (!drag.moved && Math.hypot(dx, dy) < CLICK_SLOP) return;
      if (!drag.moved) {
        drag.moved = true;
        canvas.classList.add("is-dragging");
        preview.hide();
      }
      const perPixel = drag.frame.w / canvas.clientWidth;
      frame = { ...drag.frame, x: drag.frame.x - dx * perPixel, y: drag.frame.y + dy * perPixel };
      slide();
      return;
    }
    if (event.pointerType !== "mouse") return;
    const c = planeAt(event.offsetX, event.offsetY);
    preview.at({
      cx: c.x,
      cy: c.y,
      across: event.offsetX / canvas.clientWidth,
      span: frame.w / canvas.clientWidth,
    });
  });

  function release(event, cancelled) {
    if (drag === null) return;
    const was = drag;
    drag = null;
    canvas.classList.remove("is-dragging");
    if (was.moved) {
      schedule();
      return;
    }
    if (cancelled) return;
    // The click opens what the card is showing where it is up, for the viewer card's
    // reason: the card settles behind the pointer, and a click a pixel from the picture on
    // the screen is the drift it exists to close.
    const c = preview.showing() ?? (() => {
      const at = planeAt(event.offsetX, event.offsetY);
      return { cx: at.x, cy: at.y };
    })();
    preview.hide();
    if (chosen !== null) {
      chosen = null;
      remark();
    }
    open(c.cx, c.cy, current());
  }

  /** The last picture again with the marks as they now stand, for a mark that went away
   *  without the plane moving. */
  function remark() {
    if (last === null || drag !== null) return;
    paint.drawImage(last.bitmap, 0, 0, canvas.width, canvas.height);
    markPoints();
  }

  canvas.addEventListener("pointerup", (event) => release(event, false));
  canvas.addEventListener("pointercancel", (event) => release(event, true));
  canvas.addEventListener("pointerleave", () => {
    if (drag === null) preview.hide();
  });

  canvas.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      const factor = event.deltaY < 0 ? 1 / WHEEL_ZOOM : WHEEL_ZOOM;
      const w = frame.w * factor;
      // About the pointer: the point under it stays under it.
      const under = planeAt(event.offsetX, event.offsetY);
      const kept = w / frame.w;
      const centre = { x: under.x + (frame.x - under.x) * kept, y: under.y + (frame.y - under.y) * kept };
      // Out, no further than the plane's home, and drawn back onto it as it gets there —
      // the viewer's own stop, `outermost.js`.
      const to = factor > 1 ? heldOut(centre, w, frame.w, stopOf(home(), true)) : { ...centre, w };
      if (to === null || (to.w === frame.w && to.x === frame.x && to.y === frame.y)) return;
      frame = to;
      preview.hide();
      slide();
      schedule();
    },
    { passive: false },
  );

  wholeButton.addEventListener("click", () => {
    frame = { ...home() };
    preview.hide();
    schedule();
  });

  new ResizeObserver(() => {
    if (shown) schedule();
  }).observe(plane);

  return {
    /** The tab is showing: draw the plane if it has not been drawn at this size. */
    show() {
      shown = true;
      loadPoints();
      schedule();
    },
    /** The tab is hidden: nothing here draws while nobody can see it. */
    hide() {
      shown = false;
      clearTimeout(timer);
      timer = 0;
      preview.hide();
      renderer?.cancel();
    },
    /** The document is going away: both small pools go with it. */
    stop() {
      preview.stop();
      renderer?.stop();
      renderer = null;
      starting = null;
    },
  };
}
