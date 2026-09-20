// The Deep tab: the Mandelbrot set below the `f64` floor, drawn on purpose.
//
// **It is a deliberate, rare, slower mode, and the whole design follows from that.** A
// deep frame is seconds to minutes where a shallow one is a fraction of a second, so the
// one thing this tab must never do is start one by accident. A gesture here does not
// render: it slides the last picture as a stale bitmap and draws a box saying what would
// be drawn, and a **Render** button is what commits it. The single exception is the
// quarter-resolution pass, which may start by itself once the last one came back under
// `AUTO_PREVIEW_MS` — a threshold measured on this machine and this view rather than
// assumed.
//
// **The ordinary explorer does not get slower, heavier or different for any of this.**
// `perturb.wasm` and this module are fetched on the first open of the tab and never
// before, the way the Walk and Saved tabs are; `engine.wasm` is byte-identical to what it
// was; and a shallow permalink draws the same pixels it drew yesterday. The two kernels
// are separate crates and separate modules, and nothing in one is linked into the other.
//
// **The centre is exact for the whole life of the tab.** It arrives as a decimal string,
// lives as a `BigInt` fixed point in `deep-fx.js`, and is handed to the kernel as text.
// Nothing here routes a deep coordinate through `coordinateOf`, `shortest`, or any other
// f64 re-spelling — that is what `deep-fx.js` exists for, and the one place a double is
// allowed in is the *size* of a step, which is a fraction of a width that is itself a
// double.
//
// What this tab is: smooth, `z² + c`, degree 2. No mode picker, because there is one mode
// down here, and no family picker, because the two sets this kernel draws are two ways of
// reading one recurrence rather than two families — **Julia at this c** holds the `c` the
// view is centred on and lets `z` vary instead, which is the same orbit seen from the
// other side and the same reference orbit to draw it from. Palette, the shade recipe and
// Autolevel work exactly as they do everywhere else, because a deep field is a smooth
// field and `engine.wasm` colours it without being told which kernel drew it.

import * as fx from "./deep-fx.js";
import * as deepLink from "./deep-link.js";
import { DeepRenderer, deepSpecOf } from "./deep-render.js";

/**
 * How long the last quarter-resolution pass may have taken for the next one to start on
 * its own, in milliseconds.
 *
 * **Provisional, and it is a measurement of this view on this machine rather than a guess
 * about deep views in general.** The cost of a deep frame runs over four orders of
 * magnitude with the width, the cap and how much of the frame is interior, so no constant
 * could be right for all of them — what makes this one safe is that it is applied to the
 * reading the previous pass took. Under it, a gesture settles into a picture and the tab
 * feels like the explorer; over it, nothing draws until Render, and the reader is never
 * surprised by a wait they did not ask for.
 */
const AUTO_PREVIEW_MS = 1500;

/** How long after the last gesture the auto-preview considers starting. Long enough that a
 *  drag followed by a wheel notch is one settle rather than two. */
const SETTLE_MS = 350;

/** Each axis of the quarter-resolution pass, as a fraction of the full one. The viewer's
 *  own `PREVIEW_DIVISOR`, because a preview that was a different rectangle would shift as
 *  it sharpened. */
const PREVIEW_DIVISOR = 4;

/** Samples per pixel, each way, of the last pass. The viewer's `FINAL_SUPERSAMPLE`. */
const FINAL_SUPERSAMPLE = 2;

/**
 * How much of the viewport the pending frame takes while a gesture is being shown.
 *
 * The Walk tab's number, and the same reasoning: at 65% the frame and a margin of what is
 * around it are both in sight, so a box drawn inside the picture reads as a box rather
 * than as the edge of the canvas. Nothing is re-rendered for it — the stale bitmap is
 * drawn where it falls at this framing, which is the whole point.
 */
const PENDING_FRAMING = 0.65;

/** How far the stale picture is dimmed while it is standing in for one that has not been
 *  drawn. The walk's backdrop, for the walk's reason: dim says *old* without hiding it. */
const STALE_ALPHA = 0.55;

/** The ink the pending frame is boxed in, and the dark under-stroke that keeps it visible
 *  over a light palette. The walk's chosen inks; this is one box rather than four, and it
 *  takes the one that reads as *this is the subject*. */
const PENDING_INK = "#3d8bff";

/** What one wheel notch and one key press multiply the width by. The viewer's own, so the
 *  gesture feels the same on both sides of the floor. */
const WHEEL_ZOOM = 1.15;
const KEY_ZOOM = 1.4;
const PAN_STEP = 0.1;

/** The factor the iteration buttons move the cap by. */
const CAP_STEP = 2;

/** Where the cost warning records that it has been shown. Per session, so a reader who
 *  comes back tomorrow is told again and one who is exploring is not told twice. */
const WARNED = "explorer.deep-warned";

/**
 * Mount the Deep tab.
 *
 * `host` is the page: the elements this tab owns, the surface it draws on, and the few
 * things only `explorer.js` knows — where the viewer is, what the grid is, and how to put
 * a sentence under the canvas.
 */
export function mount(host) {
  const els = host.elements;
  const context = host.context;

  let renderer = null;
  let starting = null;

  /** The view the picture on screen is of, once one has been drawn. */
  let drawn = null;
  /** The view the gestures have moved to. Equal to `drawn` when nothing is pending. */
  let view = deepLink.fresh(context);
  /** The last picture drawn, as a canvas, and the view it was of. */
  let stale = null;
  /** Fields kept for a recolour, by `deepLink.fieldKey`. */
  const fields = new Map();
  /** How long the last quarter pass took, which is what auto-preview reads. */
  let quarterMs = null;
  /** The pass in flight: its generation and what it is doing. */
  let pass = 0;
  let running = null;
  let settleTimer = 0;
  let shown = false;
  let owns = false;
  let colouring = {};
  /** Whether the reader has set a cap of their own, which a zoom then leaves alone. */
  let pinnedCap = false;
  /**
   * The Mandelbrot view *Julia at this c* was pressed on, so the way back is the
   * frame it came from rather than a frame derived from where the reader has got to.
   *
   * `null` for a Julia view that arrived as a link, and the button says so: there is
   * nothing in a link that says where its reader was standing when they made it, and
   * inventing one would be putting a fact in front of a reader that nobody knows.
   */
  let cameFrom = null;

  /**
   * How many fields are kept.
   *
   * **Three, which is the current view's three stages and nothing else**, and the
   * arithmetic is why. A deep field is one `f64` a sample: at a 1136×636 canvas the
   * quarter pass is 0.4 MB, the full pass 5.8 MB, and the supersampled finish 23 MB — so
   * the current view alone is about 29 MB held. The viewer keeps six because its fields
   * are the same size and its frames are cheap to recompute; here a field is the most
   * expensive thing on the page and the largest, and keeping one view back would double
   * the memory to save a re-iterate the reader has to press a button for anyway.
   */
  const CACHE_LIMIT = 3;

  function remember(key, field) {
    fields.delete(key);
    fields.set(key, field);
    while (fields.size > CACHE_LIMIT) fields.delete(fields.keys().next().value);
  }

  // ----------------------------------------------------------------- the geometry

  /** The plane height of a view on the current grid. */
  function planeHeight(of) {
    const grid = host.grid();
    return of.w.value * (grid.height / grid.width);
  }

  /** Whether the gestures have moved the view off the picture that is up. */
  function pending() {
    return drawn === null || deepLink.fieldKey(view, 1, 1) !== deepLink.fieldKey(drawn, 1, 1);
  }

  /**
   * The viewport the canvas is showing: the view itself when it is what was drawn, and
   * the pending frame widened to `PENDING_FRAMING` when it is not.
   */
  function display() {
    if (!pending()) return view;
    return { ...view, w: deepLink.widthOf(view.w.value / PENDING_FRAMING) };
  }

  /**
   * Where `of`'s frame falls on a canvas showing `on`, in pixels.
   *
   * The two centres are subtracted **in decimal** and the difference narrowed after, which
   * is the whole reason this is not four lines of arithmetic: two deep centres agree in
   * every digit a double holds, so `Number(a) - Number(b)` is exactly zero and would draw
   * every frame in the middle of the canvas however far it had been panned.
   */
  function place(of, on) {
    const grid = host.grid();
    const scale = of.w.value / on.w.value;
    const across = (fx.difference(of.x.dec, on.x.dec) / on.w.value) * grid.width;
    const down = -(fx.difference(of.y.dec, on.y.dec) / planeHeight(on)) * grid.height;
    const width = grid.width * scale;
    const height = grid.height * scale;
    return {
      x: grid.width / 2 + across - width / 2,
      y: grid.height / 2 + down - height / 2,
      width,
      height,
    };
  }

  // ----------------------------------------------------------------- what is on screen

  /** Keep the picture just drawn, so a gesture has something to slide. */
  function keep(image, of) {
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    canvas.getContext("2d").putImageData(image, 0, 0);
    stale = { canvas, view: of };
  }

  /**
   * Draw what is currently true: the last picture, where it falls, and the pending frame
   * over it if the reader has moved.
   *
   * **This is the whole of what a gesture does.** No pass is started, nothing is
   * iterated, and the picture on screen is honestly labelled as the old one.
   */
  function paint() {
    if (stale === null) return;
    const on = display();
    const at = place(stale.view, on);
    host.compose((ink, grid) => {
      ink.fillStyle = "#000";
      ink.fillRect(0, 0, grid.width, grid.height);
      ink.imageSmoothingEnabled = true;
      ink.globalAlpha = pending() ? STALE_ALPHA : 1;
      ink.drawImage(stale.canvas, at.x, at.y, at.width, at.height);
      ink.globalAlpha = 1;
      if (!pending()) return;
      const box = place(view, on);
      ink.lineWidth = 3;
      ink.strokeStyle = "rgba(0,0,0,0.65)";
      ink.strokeRect(box.x, box.y, box.width, box.height);
      ink.lineWidth = 1.5;
      ink.strokeStyle = PENDING_INK;
      ink.strokeRect(box.x, box.y, box.width, box.height);
    });
  }

  // ----------------------------------------------------------------- the renderer

  async function pool() {
    if (renderer !== null) return renderer;
    starting ??= (async () => {
      host.stat("starting the deep renderer…");
      renderer = await DeepRenderer.start(
        new URL("./perturb.wasm", import.meta.url),
        host.shading(),
      );
      return renderer;
    })();
    return starting;
  }

  /** The kernel's own cap for a width, once the module is up; the engine's before that. */
  function policyCap(width) {
    return renderer === null ? context.deepCap(width) : renderer.maxiter(width);
  }

  function stop() {
    pass += 1;
    running = null;
    renderer?.cancel();
    colouring.stop?.();
    colouring = {};
    syncControls();
  }

  /**
   * Draw the view, through as many stages as `upto` asks for.
   *
   * `"preview"` is the quarter-resolution pass alone, which is the only thing that ever
   * starts by itself. `"full"` is what Render commits: the quarter pass first, so there is
   * something to look at within a fraction of the wait, then one sample a pixel, then the
   * same grid at two samples each way — the passes the explorer normally stages.
   */
  async function render(upto, { auto = false } = {}) {
    const generation = ++pass;
    const grid = host.grid();
    const target = view;
    // **Before the await, not after it.** The pool takes a moment to start on the first
    // render of a session — a fetch, a compile and a worker apiece — and a Render button
    // that stayed pressable through it would start a second pass on a second press.
    running = { upto, auto, stage: "preview", started: performance.now() };
    syncControls();
    host.showState("rendering");
    host.say("");

    const deep = await pool();
    if (generation !== pass) return;

    const stages = [
      { name: "preview", width: grid.width / PREVIEW_DIVISOR, height: grid.height / PREVIEW_DIVISOR, supersample: 1 },
      { name: "full", width: grid.width, height: grid.height, supersample: 1 },
      { name: "fine", width: grid.width, height: grid.height, supersample: FINAL_SUPERSAMPLE },
    ];
    const wanted = upto === "preview" ? stages.slice(0, 1) : stages;

    try {
      for (const stage of wanted) {
        running.stage = stage.name;
        const key = deepLink.fieldKey(target, stage.width, stage.height, stage.supersample);
        let field = fields.get(key);
        const cached = field !== undefined;
        if (!cached) {
          const started = performance.now();
          field = await deep.field(target, stage.width, stage.height, {
            supersample: stage.supersample,
            onProgress: (done, elapsed) => {
              if (generation !== pass) return;
              report(stage, done, elapsed);
            },
            onOrbit: (orbit) => {
              if (generation === pass) running.orbit = orbit;
            },
          });
          if (field === null || generation !== pass) return;
          if (stage.name === "preview") quarterMs = performance.now() - started;
          remember(key, field);
        }
        // A copy, because the shade takes the buffer and detaches it, and the one in the
        // cache has to stay whole for the next recolour.
        const shaded = await deep.shade(
          { ...field, values: field.values.slice() },
          target,
          colouring,
          { derive: host.deriving() },
        );
        if (shaded === null || generation !== pass) return;
        if (host.deriving()) {
          view = { ...view, level: shaded.level };
          if (drawn !== null) drawn = { ...drawn, level: shaded.level };
          host.onColour();
        }
        drawn = target;
        keep(shaded.image, target);
        paint();
        host.settle();
        said(stage, field, shaded, cached);
      }
      host.showState("final");
    } catch (error) {
      host.say(String(error.message ?? error));
      console.error("the deep render failed", { view: deepLink.emit(view) }, error);
      host.showState("stopped");
    } finally {
      if (generation === pass) {
        running = null;
        syncControls();
      }
    }
  }

  /**
   * What the progress line says while a stage runs, and the time left.
   *
   * **The estimate comes from the bands this pass has already finished** and from nothing
   * else — not from a table, not from the last view, not from a cost per sample settled
   * somewhere. A deep frame's cost swings over orders of magnitude with how much of it is
   * interior, and the only honest predictor of the rest of *this* frame is the part of it
   * that has already been drawn.
   */
  function report(stage, done, elapsed) {
    const percent = Math.round(done * 100);
    els.progress.style.setProperty("--done", `${percent}%`);
    const left = done > 0.02 ? (elapsed / done) * (1 - done) : null;
    const remaining = left === null ? "" : ` · about ${said_time(left / 1000)} left`;
    els.progress.textContent = `${STAGE_SAID[stage.name]} ${percent}%${remaining}`;
    host.stat(`${stage.width}×${stage.height}${stage.supersample > 1 ? ` at ${stage.supersample ** 2}×` : ""} · ${percent}%`);
  }

  const STAGE_SAID = {
    preview: "quarter resolution",
    full: "full resolution",
    fine: "four samples a pixel",
  };

  function said_time(seconds) {
    if (seconds < 1) return "a second";
    if (seconds < 90) return `${Math.round(seconds)} s`;
    return `${Math.round(seconds / 60)} min`;
  }

  /** The stat line for a stage that has landed. */
  function said(stage, field, shaded, cached) {
    const size = `${stage.width}×${stage.height}`;
    const samples = stage.supersample > 1 ? ` at ${stage.supersample ** 2}×` : "";
    const orbit = running?.orbit;
    const orbitSaid =
      orbit === undefined
        ? ""
        : ` · orbit ${orbit.points.toLocaleString("en-US")} points, ${orbit.limbs} limbs${orbit.kept ? " (kept)" : ""}`;
    host.stat(
      cached
        ? `${size}${samples} · recolored in ${shaded.elapsed.toFixed(0)} ms`
        : `${size}${samples} · field ${(field.elapsed / 1000).toFixed(2)} s · shade ${shaded.elapsed.toFixed(0)} ms${orbitSaid}`,
    );
  }

  /**
   * Colour the best field already kept, at the best size it was kept at.
   *
   * **This is what the cache is for.** A deep field costs seconds to minutes and a
   * palette costs a shade, so a recolour walks back from the finished stage to the
   * cheapest one that is here and colours that. Nothing re-iterates.
   */
  async function recolour() {
    const grid = host.grid();
    const deep = await pool();
    const stages = [
      { width: grid.width, height: grid.height, supersample: FINAL_SUPERSAMPLE },
      { width: grid.width, height: grid.height, supersample: 1 },
      { width: grid.width / PREVIEW_DIVISOR, height: grid.height / PREVIEW_DIVISOR, supersample: 1 },
    ];
    for (const stage of stages) {
      const field = fields.get(deepLink.fieldKey(view, stage.width, stage.height, stage.supersample));
      if (field === undefined) continue;
      const generation = ++pass;
      const shaded = await deep.shade(
        { ...field, values: field.values.slice() },
        view,
        colouring,
        { derive: host.deriving() },
      );
      if (shaded === null || generation !== pass) return;
      if (host.deriving()) {
        view = { ...view, level: shaded.level };
        drawn = { ...drawn, level: shaded.level };
        host.onColour();
      }
      drawn = view;
      keep(shaded.image, view);
      paint();
      host.stat(`${stage.width}×${stage.height} · recolored in ${shaded.elapsed.toFixed(0)} ms`);
      host.settle();
      return;
    }
  }

  // ----------------------------------------------------------------- the gestures

  /** After a gesture: repaint, and consider the quarter pass. */
  function moved() {
    paint();
    host.settle();
    syncControls();
    clearTimeout(settleTimer);
    if (running !== null) return;
    settleTimer = setTimeout(() => {
      // **The only pass that ever starts by itself**, and only on the evidence of the last
      // one. Nothing here can reach the full passes.
      if (!shown || !owns || running !== null || !pending()) return;
      if (refused() !== null) return;
      if (quarterMs === null || quarterMs > AUTO_PREVIEW_MS) {
        syncControls();
        return;
      }
      render("preview", { auto: true });
    }, SETTLE_MS);
  }

  /** Pan by a pixel offset. The step is a double and the centre is not: the offset is
   *  turned into an exact decimal and added, so nothing about the place is re-spelled. */
  function pan(dx, dy) {
    const grid = host.grid();
    const acrossStep = fx.fromNumber(-(dx / grid.width) * view.w.value);
    const downStep = fx.fromNumber((dy / grid.height) * planeHeight(view));
    if (acrossStep === null || downStep === null) return;
    view = {
      ...view,
      x: deepLink.coordinateOf(fx.add(view.x.dec, acrossStep)),
      y: deepLink.coordinateOf(fx.add(view.y.dec, downStep)),
    };
    moved();
  }

  /**
   * Zoom about a point of the canvas.
   *
   * The anchor is the centre plus an offset, and the new centre is the anchor plus the old
   * offset scaled — so what is added to the exact centre is `offset × (1 − scale)`, one
   * double, once. Written this way rather than as `anchor + (centre − anchor) × scale`
   * precisely because the second spelling forms the anchor as a coordinate, and a
   * coordinate formed in `f64` down here is the bug this tab exists to avoid.
   */
  function zoom(px, py, factor) {
    const grid = host.grid();
    const on = display();
    const scale = factor;
    // The point is taken on what the canvas is SHOWING, which is the widened frame while
    // something is pending — so the wheel zooms about what is under the pointer rather
    // than about where that pointer would be on a picture nobody is looking at.
    const acrossOffset = (px / grid.width - 0.5) * on.w.value;
    const downOffset = (0.5 - py / grid.height) * planeHeight(on);
    const centreAcross = fx.difference(view.x.dec, on.x.dec);
    const centreDown = fx.difference(view.y.dec, on.y.dec);
    const shiftAcross = fx.fromNumber((acrossOffset - centreAcross) * (1 - scale));
    const shiftDown = fx.fromNumber((downOffset - centreDown) * (1 - scale));
    if (shiftAcross === null || shiftDown === null) return;
    const width = view.w.value * scale;
    if (!(width > 0) || !Number.isFinite(width)) return;
    view = {
      ...view,
      x: deepLink.coordinateOf(fx.add(view.x.dec, shiftAcross)),
      y: deepLink.coordinateOf(fx.add(view.y.dec, shiftDown)),
      w: deepLink.widthOf(width),
    };
    if (!pinnedCap) view = { ...view, maxiter: policyCap(width) };
    moved();
  }

  // ----------------------------------------------------------------- the two sets

  /**
   * Move to a view of the other set, keeping the frame where the reader can see
   * what happened.
   *
   * **Nothing is slid and nothing is dimmed.** A gesture keeps the last picture
   * because the new frame is a piece of the old one; here the frame does not move
   * at all and the set under it does, so the picture that is up is not a stale
   * view of this one — it is a picture of something else at the same coordinates.
   * Boxing it would draw the box exactly on the edge of the canvas and say
   * nothing. So the canvas is cleared and the tab is honestly back at "nothing
   * drawn yet", which is what it is.
   */
  function swap(next) {
    view = next;
    drawn = null;
    stale = null;
    host.compose((ink, grid) => {
      ink.fillStyle = "#000";
      ink.fillRect(0, 0, grid.width, grid.height);
    });
    host.stat("");
    host.say("");
    // The fields are NOT cleared: the cache is keyed on the set as well as the
    // frame, so the two views cannot be confused for one another, and a small
    // enough pair of frames survives the trip both ways.
    moved();
  }

  /** The Julia set of this view's own centre, framed on that centre. */
  function toJulia() {
    if (view.julia !== null) return;
    cameFrom = view;
    swap({ ...view, julia: { x: view.x, y: view.y } });
  }

  /**
   * Back to the Mandelbrot set.
   *
   * The frame that was left, where the reader came from one; otherwise the frame
   * this Julia view implies — the parameter's own place, at the width being
   * looked at. A pasted link carries no history, and this is the honest
   * reconstruction of what it would have been.
   */
  function toMandelbrot() {
    if (view.julia === null) return;
    const home = cameFrom ?? {
      ...view,
      julia: null,
      x: view.julia.x,
      y: view.julia.y,
      maxiter: pinnedCap ? view.maxiter : policyCap(view.w.value),
    };
    cameFrom = null;
    swap({ ...home, palette: view.palette, shade: view.shade, level: view.level });
  }

  /**
   * The same structure, at the critical point, where it is exactly two-fold
   * symmetric.
   *
   * **The frame widens to the square root of itself, and it has to.** `z ↦ z² + c`
   * maps the disc of radius `r` about 0 *onto* the disc of radius `r²` about `c`,
   * two to one — so what sits at `z = c` at a width of 2e-9 sits at `z = 0` at a
   * width of 6e-5, and a button that kept the width would land a reader deep inside
   * the basin of the attracting cycle, where every sample is interior and the
   * picture is black. Measured, on the audit's own `c`: it drew a black frame, which
   * is what sent this through the arithmetic.
   *
   * The cap is deliberately **not** re-derived from the new width. The two frames are
   * the same picture and their escape counts differ by exactly one step — the step
   * that takes 0 to c — so the cap that drew one is the cap that draws the other, and
   * the width policy's answer for a frame 4 decades wider would be a different
   * picture of the same place.
   */
  function toOrigin() {
    if (view.julia === null) return;
    const root = Math.sqrt(2 * view.w.value);
    if (!(root > 0) || !Number.isFinite(root)) return;
    view = {
      ...view,
      x: deepLink.coordinateOf(fx.ZERO),
      y: deepLink.coordinateOf(fx.ZERO),
      w: deepLink.widthOf(root),
    };
    moved();
  }

  /**
   * Why this frame cannot be drawn, in the kernel's words, or `null`.
   *
   * Asked of the module rather than worked out here, and asked before the reader
   * presses anything: a frame too far from both its anchors is refused by `plan`,
   * and a tab that only found that out on Render would have taken the press and
   * given back a sentence.
   */
  function refused() {
    if (renderer === null || view.julia === null) return null;
    const grid = host.grid();
    if (grid.width < 1 || grid.height < 1) return null;
    const answer = renderer.plan(deepSpecOf(view, grid.width, grid.height));
    return answer.ok ? null : answer.why;
  }

  // ----------------------------------------------------------------- the controls

  function setCap(value) {
    const wanted = Math.round(value);
    const held = Math.max(deepLink.CAP_FLOOR, Math.min(deepLink.CAP_LIMIT, wanted));
    if (held === view.maxiter) return;
    pinnedCap = true;
    view = { ...view, maxiter: held };
    moved();
  }

  function syncControls() {
    const busy = running !== null;
    const why = busy ? null : refused();
    // **An auto-preview does not take the button.** It is a pass the reader did not ask
    // for, so turning Render into Cancel while it runs would put the one control this tab
    // has out of reach at exactly the moment it is wanted: a reader who gestures and then
    // wants the picture would press Render and stop a render instead. Cancel is for a pass
    // somebody commanded; pressing Render through an auto-preview upgrades it.
    const committed = busy && !running.auto;
    els.render.textContent = committed ? "Cancel" : pending() || drawn === null ? "Render" : "Render again";
    els.render.classList.toggle("is-running", committed);
    els.render.disabled = why !== null;
    els.progress.hidden = !busy;
    if (!busy) els.progress.style.removeProperty("--done");
    els.cap.value = String(view.maxiter);
    els.capUp.disabled = committed || view.maxiter >= deepLink.CAP_LIMIT;
    els.capDown.disabled = committed || view.maxiter <= deepLink.CAP_FLOOR;
    els.width.textContent = view.w.text;
    els.centre.textContent = `${view.x.text}\n${view.y.text}`;
    els.centre.title = `${view.x.text} + ${view.y.text}i`;

    // The parameter, where there is one. A Mandelbrot view has no `c` to show:
    // every point of it is one.
    const julia = view.julia !== null;
    // Both halves of the row, or neither: an empty `dd` still takes its cell in the
    // grid and shifts every label after it into the wrong column.
    els.paramRow.hidden = !julia;
    els.paramValue.hidden = !julia;
    if (julia) {
      els.param.textContent = `${view.julia.x.text}\n${view.julia.y.text}`;
      els.param.title = `${view.julia.x.text} + ${view.julia.y.text}i`;
    }
    els.julia.textContent = julia ? "Back to the Mandelbrot set" : "Julia at this c";
    els.julia.disabled = committed;
    els.julia.title = julia
      ? cameFrom !== null
        ? "Back to the frame this Julia set was opened from."
        : "Open the Mandelbrot set at this c, at the width you are looking at."
      : "Draw the Julia set of this view's own center — the same c, with z varying instead.";
    els.origin.hidden = !julia;
    els.origin.disabled = committed || (julia && fx.isZero(view.x.dec) && fx.isZero(view.y.dec));
    els.back.disabled = committed;
    // Two reasons it might not go, and the title names the one in force. A parameter
    // that cannot cross is the more surprising of the two, because the frame would
    // draw perfectly well next door — as a different set.
    const carries =
      view.julia === null ||
      (deepLink.exactInDouble(view.julia.x) && deepLink.exactInDouble(view.julia.y));
    els.back.title = !carries
      ? "This Julia set's c has more digits than the ordinary explorer carries, so it cannot be taken back: rounding it would open a different Julia set."
      : host.resolves(view)
        ? "Open this frame in the ordinary explorer, which can still draw it."
        : "This frame is below what the ordinary explorer's arithmetic can resolve, so it cannot be carried back.";
    els.back.hidden = false;

    // What the tab says about itself, in one line: what Render would do, and whether the
    // quarter pass will start on its own.
    if (why !== null) {
      els.note.textContent = why;
    } else if (busy) {
      els.note.textContent = "";
    } else if (drawn === null) {
      els.note.textContent = "Nothing has been drawn yet. Render draws this frame.";
    } else if (pending()) {
      els.note.textContent =
        quarterMs !== null && quarterMs <= AUTO_PREVIEW_MS
          ? "The picture is the last one drawn, boxed where this frame sits. A quick preview will follow on its own; Render draws it properly."
          : "The picture is the last one drawn, boxed where this frame sits. Nothing will be drawn until you press Render.";
    } else {
      els.note.textContent = "";
    }
    host.onColour();
  }

  // ----------------------------------------------------------------- getting in and out

  /** Say the cost, once a session, on the first entry. */
  function warn() {
    let told = null;
    try {
      told = window.sessionStorage.getItem(WARNED);
    } catch {
      told = null;
    }
    if (told === "1") return;
    try {
      window.sessionStorage.setItem(WARNED, "1");
    } catch {
      /* A private window. Saying it twice is better than not saying it. */
    }
    host.say(
      "Below about 1e-13 the ordinary renderer has nothing left to draw with, so this tab " +
        "uses a different kernel: one high-precision orbit per frame, and a perturbation " +
        "of it per sample. It is several times slower than the explorer and gets slower " +
        "as you go deeper — a frame can take minutes. Nothing here draws until you press " +
        "Render.",
    );
  }

  /**
   * Come into the tab.
   *
   * `from` is the viewer's own view where it is on Mandelbrot degree 2, and the frame is
   * carried over: its coordinates are already exact decimal text, so nothing is lost
   * crossing the floor. Anywhere else the tab opens at the last deep view it had, or at
   * the Mandelbrot home, and says that deep is Mandelbrot only.
   */
  function enter(from) {
    warn();
    if (from !== null) {
      const carried = carry(from);
      if (carried !== null) {
        view = carried;
        drawn = null;
        stale = null;
        fields.clear();
        pinnedCap = false;
        cameFrom = null;
      }
    } else if (drawn === null && stale === null) {
      host.say(
        "Deep draws z² + c and nothing else: the Mandelbrot set, and the Julia set of any c on it.",
      );
    }
    owns = true;
    paint();
    syncControls();
    host.settle();
  }

  /** A shallow view as a deep one, where it is a frame this tab can take. */
  function carry(from) {
    const x = fx.parse(from.x.text);
    const y = fx.parse(from.y.text);
    if (x === null || y === null) return null;
    // A shallow Julia view brings its parameter with it, which is the same trip
    // *Back to the explorer* makes in the other direction. The constants are
    // already decimal text on that side, so nothing is lost crossing the floor —
    // and a `c` that came from a double stays exactly the `c` that double spells.
    let julia = null;
    if (from.family === "julia") {
      const re = fx.parse(from.constants.cx.text);
      const im = fx.parse(from.constants.cy.text);
      if (re === null || im === null) return null;
      julia = { x: deepLink.coordinateOf(re), y: deepLink.coordinateOf(im) };
    }
    return {
      version: deepLink.VERSION,
      julia,
      x: deepLink.coordinateOf(x),
      y: deepLink.coordinateOf(y),
      w: deepLink.widthOf(from.w.value),
      maxiter: policyCap(from.w.value),
      aspect: from.aspect,
      palette: from.palette,
      shade: from.shade,
      level: from.level,
    };
  }

  // ----------------------------------------------------------------- the wiring

  els.render.addEventListener("click", () => {
    if (running !== null && !running.auto) {
      stop();
      host.stat("stopped");
      host.showState("stopped");
      return;
    }
    // Through an auto-preview: that pass is abandoned and the committed one starts, which
    // picks its quarter field straight back out of the cache if it had finished.
    render("full");
  });

  els.capUp.addEventListener("click", () => setCap(view.maxiter * CAP_STEP));
  els.capDown.addEventListener("click", () => setCap(view.maxiter / CAP_STEP));
  els.cap.addEventListener("change", () => {
    const wanted = Number(els.cap.value);
    if (Number.isFinite(wanted)) setCap(wanted);
    els.cap.value = String(view.maxiter);
  });
  els.policy.addEventListener("click", () => {
    pinnedCap = false;
    const wanted = policyCap(view.w.value);
    if (wanted !== view.maxiter) {
      view = { ...view, maxiter: wanted };
      moved();
    } else {
      syncControls();
    }
  });

  els.julia.addEventListener("click", () => (view.julia === null ? toJulia() : toMandelbrot()));
  els.origin.addEventListener("click", toOrigin);
  els.back.addEventListener("click", () => host.leave(view));
  els.save.addEventListener("click", () => host.save(deepLink.emit(view)));

  return {
    /** The view the tab is standing on, for the colour controls and for a link. */
    view: () => view,
    /** Whether the tab owns the viewer — whether the picture on screen is the deep one. */
    owns: () => shown && owns,
    link: () => deepLink.emit(view),

    show() {
      shown = true;
      owns = true;
      paint();
      syncControls();
    },
    hide() {
      shown = false;
      owns = false;
      clearTimeout(settleTimer);
      stop();
    },
    /** The reader took the viewer for something else; the tab keeps its view. */
    detach() {
      owns = false;
      clearTimeout(settleTimer);
      stop();
    },
    enter,

    /** Open a deep link. Nothing but the quarter pass runs unasked — and that only on the
     *  usual evidence, so a link opened cold shows its frame and waits for Render. */
    open(query) {
      view = deepLink.parse(`?${query}`, context);
      drawn = null;
      stale = null;
      fields.clear();
      pinnedCap = true;
      // A link says where it points and not where its writer was standing.
      cameFrom = null;
      owns = true;
      warn();
      syncControls();
      host.settle();
      host.stat("");
      host.say("");
      host.showState("stopped");
      render("preview");
    },

    /** A colour control moved. The field is kept, so this never re-iterates. */
    tint(changes) {
      view = { ...view, ...changes };
      if (drawn !== null) drawn = { ...drawn, ...changes };
      host.settle();
      if (drawn === null || running !== null) {
        syncControls();
        return;
      }
      recolour();
    },

    pan,
    zoom,
    /** An arrow key, as a share of the width. */
    nudge(across, down) {
      pan(-across * PAN_STEP * host.grid().width, down * PAN_STEP * host.grid().height);
    },
    wheel: (px, py, out) => zoom(px, py, out ? WHEEL_ZOOM : 1 / WHEEL_ZOOM),
    key: (px, py, out) => zoom(px, py, out ? KEY_ZOOM : 1 / KEY_ZOOM),
    repaint: paint,
    stop,
  };
}
