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
// `Renderer` over the compiled module, one job at a time, never the viewer's. It draws
// `smooth` at one sample a pixel in the viewer's palette, because it is a map to aim with
// rather than a picture to keep; the picture is what the click opens.
//
// **It is the viewer's gestures, a size smaller.** The wheel zooms about the pointer, a
// drag pans, a press that does not move is the click. The frame and `p` are this browser
// tab's session, so Back to Phoenix plane finds the plane where the click left it.
//
// The preview card is `julia-preview.js`, mounted a second time over this plane with its
// own flag: the same machinery at one sample a pixel, off until the box says otherwise.

import * as juliaPreview from "./julia-preview.js";
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

/** One notch of the wheel, and the widest the plane may be zoomed out to. */
const WHEEL_ZOOM = 1.15;
const WIDEST = 8;

/** A press that moves less than this, in CSS pixels, is a click and not a drag. */
const CLICK_SLOP = 4;

/** How long the plane waits after a change before it draws, so that a wheel spun or a
 *  slider dragged draws the frame it stops at rather than every frame on the way. */
const SETTLE_MS = 70;

/** The largest the plane is drawn at, in device pixels across. It is a map a panel wide,
 *  and past this a wider screen buys sharpness nobody aims with. */
const MOST_WIDTH = 720;

/**
 * Mount the tab.
 *
 * `host` is what this borrows from the page: the compiled module, the tab's elements, the
 * plane's home frame and default `p`, the viewer's palette and recipe, a way to build the
 * set a point opens and to open it, and the page's status line.
 */
export function mount(host) {
  const { module, canvas, plane, slider, box, previewToggle, card, note, wholeButton } = host;
  const { home, defaultP, look, setOf, open, planeView, say } = host;
  const paint = canvas.getContext("2d", { alpha: false });

  let renderer = null;
  let starting = null;
  let timer = 0;
  let drawing = false;
  let owed = false;
  /** The viewer's palette and recipe the plane was last drawn in, as a key. */
  let drawnLook = null;
  let shown = false;
  /** The last picture drawn, as a bitmap, and the frame it was drawn at, so a drag or a
   *  wheel can slide it before the next frame is drawn. */
  let last = null;
  /** A press in progress: where it started, the frame it started on, and whether it has
   *  moved far enough to be a drag. */
  let drag = null;

  const kept = restored();
  let frame = kept?.frame ?? { ...home() };
  let p = kept?.p ?? defaultP();
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
    viewFor: (cx, cy) => setOf(cx, cy, current()),
    deriving: () => false,
    quiet: () => !drawing,
    live: () => shown && drag === null,
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
      window.sessionStorage.setItem(KEY, JSON.stringify({ frame, p }));
    } catch {
      // A browser that stores nothing still has the plane; Back finds it at its home.
    }
  }

  // ---------------------------------------------------------------------- the view

  /** The plane as a view the page can draw, emit or hold: this frame, this `p`. */
  function current() {
    return planeView({ x: frame.x, y: frame.y, w: frame.w, p });
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
    if (!shown) return;
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
    const colour = look();
    const view = { ...current(), ...colour, mode: "smooth", params: {}, level: null };
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
      drawnLook = JSON.stringify(colour);
      markClassic();
      note.hidden = true;
    } catch (error) {
      note.textContent = `The plane could not be drawn: ${error.message}`;
      note.hidden = false;
    } finally {
      drawing = false;
      if (owed) schedule();
    }
  }

  /** The classic set's point, as the viewer's crosshair is drawn: a dark stroke under a
   *  light one, four arms with the point itself left clear. */
  function markClassic() {
    if (p !== CLASSIC.p) return;
    const { px, py } = canvasAt(CLASSIC.x, CLASSIC.y);
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
      paint.stroke();
    }
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

  function syncP() {
    const text = p.toFixed(P_DECIMALS);
    slider.value = text;
    box.value = text;
  }

  function setP(value) {
    if (!Number.isFinite(value)) {
      syncP();
      return;
    }
    const next = Number(Math.min(P_MOST, Math.max(P_LEAST, value)).toFixed(P_DECIMALS));
    if (next === p) {
      syncP();
      return;
    }
    p = next;
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
    open(c.cx, c.cy, current());
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
      const w = Math.min(WIDEST, frame.w * factor);
      // About the pointer: the point under it stays under it.
      const under = planeAt(event.offsetX, event.offsetY);
      const kept = w / frame.w;
      frame = {
        x: under.x + (frame.x - under.x) * kept,
        y: under.y + (frame.y - under.y) * kept,
        w,
      };
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
    /** The viewer's palette or recipe moved, so the plane is owed a redraw in it. */
    recolor() {
      if (shown && JSON.stringify(look()) !== drawnLook) schedule();
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
