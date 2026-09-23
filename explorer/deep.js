// The Deep tab: the Mandelbrot set below the `f64` floor, drawn on purpose.
//
// **It is a deliberate, rare, slower mode, and the whole design follows from that.** A
// deep frame is seconds to minutes where a shallow one is a fraction of a second, so the
// one thing this tab must never do is start a *long* one by accident. A gesture here does
// not draw the frame it lands on: it slides the last picture as a stale bitmap and draws a
// box saying what would be drawn.
//
// **What follows a gesture on its own is the one-sample pass, and `autoRender` is the
// switch** *(deep_ui_ckpt140, 2026-09-21)*. Ticked — which it is on entering — a settled
// frame change cancels whatever is in flight and draws the new frame at the quarter pass
// and then one sample a pixel; unticked, the tab is press-to-render and the only thing that
// starts by itself is the quarter pass, and only once the last one came back under
// `AUTO_PREVIEW_MS`, a threshold measured on this machine and this view rather than
// assumed. **The screen is always one sample a pixel** *(deep_tab_activity_and_layout_
// ckpt141)*: what Render adds over an auto pass is the cap probe, and more samples than one
// are the Download row's to spend, on a file.
//
// The bug that ruling is the fix for was never in the staging: a 1× pass *is* run first and
// *is* put up the moment it lands. It was that a gesture during a committed render moved
// `view` and cancelled nothing, so the pass ran on for minutes on the frame the reader had
// left, `moved()`'s auto-preview bailed on `running !== null`, and what the canvas showed
// the whole time was the previous frame's picture.
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
// What this tab is: smooth, `z^d + c` for integer degrees two to six *(deep_degrees_ckpt140)*.
// No mode picker, because there is one mode down here, and no family picker: the degree
// comes in with the view the reader carried over or the link they opened, and the two sets
// of each degree are two ways of reading one recurrence rather than two families —
// **Julia at this c** holds the `c` the view is centred on and lets `z` vary instead, which
// is the same orbit seen from the other side and the same reference orbit to draw it from,
// and it keeps the degree. Palette, the shade recipe and
// Autolevel work exactly as they do everywhere else, because a deep field is a smooth
// field and `engine.wasm` colours it without being told which kernel drew it.

import * as fx from "./deep-fx.js";
import * as deepLink from "./deep-link.js";
import { DeepRenderer, deepSpecOf } from "./deep-render.js";
import { homeward, stopOf } from "./outermost.js";

/**
 * How long the last quarter-resolution pass may have taken for the next one to start on
 * its own, in milliseconds — **with auto-render off**, which is the only state this reaches
 * now. Ticked, a frame change draws itself whatever the last pass cost, because it is the
 * reader's standing instruction rather than the tab's guess.
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

/** How long after the last gesture the tab considers drawing what it landed on — an
 *  auto-render when the box is ticked, the quarter pass alone when it is not. Long enough
 *  that a drag followed by a wheel notch is one settle rather than two. */
const SETTLE_MS = 350;

/** Each axis of the quarter-resolution pass, as a fraction of the full one. The viewer's
 *  own `PREVIEW_DIVISOR`, because a preview that was a different rectangle would shift as
 *  it sharpened. */
const PREVIEW_DIVISOR = 4;

/**
 * How long the pool may say nothing before the tab says so, in milliseconds.
 *
 * **Ten seconds, against a pool that reports ten times a second** *(deep_tab_activity_and_
 * layout_ckpt141)*. Every stage a worker runs now tells the page how far it has got — the
 * orbit in iterations, the probe in cells, the passes in bands — at most every hundred
 * milliseconds, so a live frame is never quiet for long. A pool that has been quiet for a
 * hundred times that is not a slow frame, it is a stranded one, and the line counts the
 * silence and Render becomes Cancel so the way out is the button already under the pointer.
 */
const WATCHDOG_MS = 10000;

/**
 * The `localStorage` flag that turns the tab's log on: every stage it enters and every
 * progress message a worker sends, with a timestamp and the frame's link, on the console.
 *
 * Off unless somebody sets it — `localStorage.setItem("explorer.deep-log", "1")` in the
 * console, and `removeItem` to stop — and read at the start of each pass, so it takes
 * effect on the next Render without a reload. **Off costs the read and nothing else**:
 * the worker's messages are routed past the log without a call, because the hook it would
 * be called through is left `null`.
 */
const LOG_FLAG = "explorer.deep-log";

/** Where the auto-render flag is remembered. The tab's own session, the Julia preview's
 *  pattern and the Julia preview's reason: a way of working, not part of a picture, so no
 *  link carries it and the browser does not keep it past the tab. */
const AUTO_RENDER = "explorer.deep-auto-render";

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

/**
 * The degrees *Nearby minibrots* is offered at.
 *
 * **A set, and a measured one** *(deep_degrees_ckpt140)*: a degree is in it only where the
 * crate's body-size estimate landed against a pin measured independently of it —
 * `perturb-wasm/README.md` §10 has the table. Where it did not, a list would rank and
 * frame minibrots by a size nobody had checked, and the button is absent rather than
 * wrong. **Every degree's did**, to within 0.4% of an area measurement, and a preview
 * tile resolves at the same eight periods at every degree — so it is every degree, and
 * the set is kept as the place a degree would be taken back out.
 */
const MINIBROT_DEGREES = new Set([2, 3, 4, 5, 6]);

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
  // **The state this closure is, and the five rules that hold it together.** Everything
  // below is a function over these locals, and none of the rules is enforced by anything
  // — which is why they are written here rather than left to be learnt from the call
  // sites, as they were until `deep_refactor_ckpt138`.
  //
  // 1. **`view` is where the reader is; `drawn` is what the picture on the canvas is of.**
  //    They are equal when nothing is pending. A gesture moves `view` and never `drawn`,
  //    which is what `pending()` reads, and `stale` — the last picture, as a canvas, with
  //    the view it was of — is what `paint()` slides under the pending frame. So the tab
  //    always shows a real picture of somewhere, honestly labelled, and never a blank.
  // 2. **`moved()` is the only way to change the frame.** Not because assigning `view` is
  //    guarded, but because `moved()` is what repaints, clears the minibrot list, reaches
  //    `host.settle()` — the address bar and the way back — and arms the settle timer that
  //    may start a quarter pass. A gesture that sets `view` and returns leaves the URL
  //    lying about the page. `swap()` is the same move for a change of *set*, and ends by
  //    calling it.
  // 3. **`pass` is the generation, and every async continuation re-checks it.** A pass
  //    bumps it on the way in and `stop()` bumps it to cancel; a band or a shade that
  //    lands under an old one is dropped on the floor. `running` is the pass in flight and
  //    is what the Render button reads, so it is set *before* the first `await` and
  //    cleared on every exit — the one that was missed made the button read *Cancel* for
  //    the rest of the session. **Only a pass bumps it**, or `stop()`: a recolour keeps a
  //    generation of its own, `tone`, because bumping `pass` without clearing `running`
  //    strands the pass's `finally` and leaves `running` set for good.
  // 4. **`owns` is whether the viewer's canvas is this tab's**, and `shown` whether the
  //    tab is the one on screen. Nothing may draw unless it owns the canvas; the tab keeps
  //    its `view` either way, which is what lets a reader leave and come back to the frame
  //    they left.
  // 5. **A colour change lands on the picture up, whatever is running**
  //    *(deep_stall_ckpt143)*. `recolour` colours `drawn` from its own kept field; it is
  //    never deferred to a pass and never keyed on `view`, which can be a frame nothing has
  //    drawn. `explorer/bench/deep-stall.mjs` drives the sequences that broke this.
  //
  // The rest is cache and bookkeeping: `fields` is up to `CACHE_LIMIT` fields by
  // `deepLink.fieldKey` for a recolour, `finished` the last stage's own picture for a
  // download, `measure` what the last pass of *this* frame cost (and `null` the moment the
  // frame or its cap moves), `quarterMs` what the quarter-pass exception reads, `colouring`
  // the pass's shade in flight (`recolouring` a recolour's), `settledAt` what the probe
  // last said about which frame, `autoRender` whether a frame change draws itself, and
  // `cameFrom` the Mandelbrot frame *Julia at this c* was pressed on. Whether the reader
  // pinned the cap is not a variable any more: it is `view.capFrom`, which travels with the
  // view it is true of.
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
  /**
   * The last frame drawn to the end, held whole so that the way back to it costs nothing
   * *(explorer_deep_polish_ckpt142)*: `{ view, canvas, image, key, field }` — its view, its
   * picture as a canvas and as the image a download saves, and its full-resolution field by
   * its cache key. `stale` is not enough for this: an auto pass puts its quarter picture
   * there within a second of a stray gesture, and the picture that took minutes is gone.
   *
   * It is what Cancel returns to when it cancels a pass the reader did not ask for, and
   * what a step back onto that frame puts up. **One frame, not a history**: a full field is
   * 5.8 MB at a 1136×636 canvas, and the frame the reader was last looking at is the one a
   * stray gesture takes away.
   */
  let settled = null;
  /** Fields kept for a recolour, by `deepLink.fieldKey`. */
  const fields = new Map();
  /** How long the last quarter pass took, which is what the quarter-pass exception reads. */
  let quarterMs = null;
  /**
   * What the last stage cost, and which frame it was a stage of: `{ frame, samples, field,
   * shade }`, in seconds.
   *
   * **The Download row's estimate is scaled from it**, the way the shallow row's is scaled
   * from the viewer's own pass, and for a stronger version of the same reason: a deep
   * frame's cost swings over four orders of magnitude with the width, the cap and how much
   * of it is interior, so there is no table to fall back on and a pass of *this* frame is
   * the only honest predictor there is. `frame` is the view's own key, so a measurement
   * stops answering the moment the frame or its cap moves.
   */
  let measure = null;
  /** The last pass's picture at the canvas's own size, once it has landed — what a download
   *  at that size saves instead of drawing it again — and how many samples a pixel it was
   *  drawn at, which is one: the Download row asks, because it may want more. Cleared by
   *  every pass, because a picture of the view before is not this one.
   */
  let finished = null;
  let finishedSamples = 0;
  /** The pass in flight: its generation and what it is doing. */
  let pass = 0;
  let running = null;
  /** The settle timer `moved()` arms, and `0` when none is: what lets the note promise that
   *  a pending frame follows on its own only when something is going to draw it. */
  let settleTimer = 0;
  let shown = false;
  let owns = false;
  let colouring = {};
  /** A recolour's own generation and holder, apart from the pass's: see `recolour`. */
  let tone = 0;
  let recolouring = {};
  /** What the probe last settled, and of which frame: `{ frame, atCeiling, fault }`, for
   *  Details' *at the ceiling* clause. */
  let settledAt = null;
  /** Whether the log is on, read at the start of each pass (`LOG_FLAG`). */
  let logging = false;
  /** The watchdog's interval, while a worker stage runs. */
  let watchdog = 0;
  /** Whether a settled frame change draws itself. */
  let autoRender = storedAuto();
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
   * **Three: the current view's two stages, and one field back**, and the arithmetic is
   * why. A deep field is one `f64` a sample: at a 1136×636 canvas the quarter pass is
   * 0.4 MB and the full pass 5.8 MB, so a view is 6.2 MB held. The viewer keeps six because
   * its frames are cheap to recompute; here a field is the most expensive thing on the page
   * and the largest, and the one field back is what lets a gesture undone by the next one
   * come back without iterating.
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

  /** Hold a full-resolution picture as `settled`, straight after `keep` has put it up. A
   *  derived tone is the picture's own, so the view held carries the curve it was drawn
   *  with. */
  function hold(of, shaded, key, field) {
    const level = host.deriving() ? shaded.level : of.level;
    settled = { view: { ...of, level }, canvas: stale.canvas, image: shaded.image, key, field };
  }

  /** Whether `of` is the frame `settled` holds: the place, the set and the cap, whatever
   *  its colour. */
  function isSettled(of) {
    return settled !== null && deepLink.fieldKey(settled.view, 1, 1) === deepLink.fieldKey(of, 1, 1);
  }

  /**
   * `frame` in the colour of `from` — the three recolour-only settings a tint writes, and
   * nothing a field is keyed on.
   */
  function inColour(frame, from = view) {
    return { ...frame, palette: from.palette, shade: from.shade, level: from.level };
  }

  /** Whether `a` and `b` are one view but for their colour: everything the link says. */
  function sameFrame(a, b) {
    return deepLink.emit(inColour(a, b)) === deepLink.emit(b);
  }

  /**
   * Shade a stage of the pass in the colour current when it lands *(deep_small_fixes_
   * ckpt142)*. A pass captures its frame when it starts and a colour control moved during
   * it only writes `view`, so a pass that shaded its captured frame landed in the palette
   * the reader had already left. The frame is the pass's; the colour is read at the shade,
   * and read again after it — a tint made while the shade was running shades once more,
   * which is milliseconds against the field it saves.
   */
  async function shadeNow(deep, field, frame, generation) {
    for (;;) {
      const inked = inColour(frame);
      const shaded = await deep.shade(
        { ...field, values: field.values.slice() },
        inked,
        colouring,
        { derive: host.deriving() },
      );
      if (shaded === null || generation !== pass) return null;
      if (deepLink.emit(inColour(inked)) === deepLink.emit(inked)) return { shaded, frame: inked };
    }
  }

  /**
   * Put the settled picture back as the view `to`, which is its frame: at once where the
   * colour is the one it was drawn in, and by a recolour of its held field where the reader
   * has turned the palette since — never by iterating. Stops whatever pass is in flight.
   */
  function putBack(to) {
    stop();
    disarm();
    const inked = { ...to, level: host.deriving() ? settled.view.level : to.level };
    if (deepLink.emit(inked) !== deepLink.emit(settled.view)) {
      view = to;
      remember(settled.key, settled.field);
      recolour(settled.view);
      clearMinibrots();
      syncControls();
      return;
    }
    view = to.capFrom === settled.view.capFrom ? settled.view : { ...settled.view, capFrom: to.capFrom };
    drawn = view;
    stale = { canvas: settled.canvas, view };
    finished = settled.image;
    finishedSamples = 1;
    paint();
    clearMinibrots();
    stat(`full pass ${settled.image.width}×${settled.image.height} · put back without drawing · cap ${count(view.maxiter)}${ceilingSaid(view)}`);
    host.showState("final");
    host.settle();
    syncControls();
  }

  /**
   * Cancel, for a pass the reader did not ask for: stop it, and go back to the last frame
   * drawn to the end with that frame's picture *(Matt, explorer_deep_polish_ckpt142)*. A
   * stray drag with Auto-render ticked starts a pass on its own and dims the picture that
   * took minutes; this is the way back from it that costs nothing.
   */
  function revert() {
    if (settled === null) return;
    putBack(inColour(settled.view));
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
    // **`??=` remembers the promise, and a rejected one has to be forgotten.** Memoizing
    // the start is what makes two callers arriving together share one fetch and one
    // compile; memoizing a *failure* makes a fetch that 404'd once the answer for the rest
    // of the session, so every later Render fails the same way without ever retrying. The
    // catch is attached before the assignment, so what is remembered is the promise that
    // clears itself.
    starting ??= (async () => {
      activity("starting the deep renderer…");
      renderer = await DeepRenderer.start(
        new URL("./perturb.wasm", import.meta.url),
        host.shading(),
      );
      return renderer;
    })().catch((error) => {
      starting = null;
      throw error;
    });
    return starting;
  }

  /** The kernel's own cap for a width, once the module is up; the engine's before that. */
  function policyCap(width) {
    return renderer === null ? context.deepCap(width) : renderer.maxiter(width);
  }

  function stop() {
    pass += 1;
    if (running !== null) log("stopped", { stage: running.stage });
    running = null;
    renderer?.cancel();
    colouring.stop?.();
    colouring = {};
    watch();
    syncControls();
  }

  // ------------------------------------------------------- what the tab says it is doing

  /** Whether the reader has pinned the cap, which a zoom then leaves alone and the probe
   *  never moves. */
  function pinned() {
    return view.capFrom === "reader";
  }

  /** Read the log flag, once a pass. The only cost the log has when it is off. */
  function readLog() {
    try {
      logging = window.localStorage.getItem(LOG_FLAG) !== null;
    } catch {
      logging = false;
    }
    if (renderer !== null) {
      renderer.onMessage = logging
        ? (message) => {
            if (message.kind === "progress") log("worker progress", { id: message.id, done: message.done, total: message.total });
            else log(`worker ${message.kind}`, { id: message.id });
          }
        : null;
    }
  }

  /** One line of the log: when, what, the detail, and the frame it is of. */
  function log(event, detail = {}) {
    if (!logging) return;
    console.log(`[deep ${new Date().toISOString()}] ${event}`, detail, deepLink.emit(view));
  }

  /**
   * Enter a stage of the pass: say it, and start its clock.
   *
   * `live` is whether a worker is doing it — the orbit, the probe, the bands — which is what
   * the spinner shows and what the watchdog is allowed to count. The colouring is the
   * shade worker's and is short, and a stage on this thread cannot be silent in the way a
   * stranded pool is.
   */
  function enterStage(stage, { live = true } = {}) {
    if (running === null) return;
    running.stage = stage;
    running.live = live;
    running.since = performance.now();
    running.stalled = 0;
    log("stage", { stage });
    watch();
  }

  /** Put a sentence and a share on the Render line. `done` is `null` for a stage that has no
   *  share to show yet, which leaves the bar where it was. */
  function activity(text, done = null) {
    if (running === null) return;
    running.text = text;
    if (done !== null) running.done = Math.max(0, Math.min(1, done));
    showActivity();
  }

  function showActivity() {
    if (running === null) return;
    const silent = running.stalled > 0;
    els.progress.textContent = silent
      ? `${running.text} · no progress for ${running.stalled} s`
      : running.text ?? "";
    els.progress.classList.toggle("is-stalled", silent);
    els.bar.style.setProperty("--done", String(running.done ?? 0));
    els.bar.dataset.state = running.sharpening ? "sharpening" : "rendering";
    els.spinner.hidden = !running.live;
  }

  /**
   * The watchdog: once a second while a worker stage runs, how long since the pool last
   * said anything, and past `WATCHDOG_MS` the line says so and counts.
   *
   * It reads the renderer's own `heard`, which every reply and every progress message
   * moves, against the stage's own start — so a stage that has just begun is not silent
   * for the time the one before it took.
   */
  function watch() {
    const wanted = running !== null && running.live;
    if (!wanted) {
      clearInterval(watchdog);
      watchdog = 0;
      return;
    }
    if (watchdog !== 0) return;
    watchdog = setInterval(() => {
      if (running === null || !running.live) {
        watch();
        return;
      }
      const last = Math.max(running.since, renderer?.heard ?? 0);
      const quiet = performance.now() - last;
      const stalled = quiet >= WATCHDOG_MS ? Math.floor(quiet / 1000) : 0;
      if (stalled !== running.stalled) {
        const was = running.stalled;
        running.stalled = stalled;
        if (stalled > 0) log("watchdog", { stage: running.stage, quiet: stalled });
        showActivity();
        if ((was > 0) !== (stalled > 0)) syncControls();
      }
    }, 1000);
  }

  // ----------------------------------------------------------------- rendering

  /**
   * Draw the view: the quarter pass, and then — unless `upto` is `"preview"` — the full
   * pass at one sample a pixel.
   *
   * **One sample a pixel is the screen's, always** *(Matt, deep_tab_activity_and_layout_
   * ckpt141)*. The tab had a samples picker of its own and a supersampled finish behind it;
   * a finer picture of a deep frame is minutes, and minutes spent on the screen are minutes
   * nobody can keep. More samples are for a file, and the Download row is where they are
   * chosen.
   *
   * **`probe` is whether the cap probe may run, and only an explicit Render asks it**
   * *(ckpt141)*. The auto pass after a gesture draws at the width's own cap: the probe is a
   * dozen rungs from the cap to the ceiling on a frame beside a parabolic point, it is not
   * covered by the `AUTO_PREVIEW_MS` guard that keeps an unasked pass cheap, and a drag was
   * enough to start minutes of it. A link opened is drawn the same way, at the cap it
   * carries or, with none, the width's.
   *
   * Every stage is put up the moment it lands and the next replaces it in place, which is
   * what makes a slow frame watchable: the quarter pass is a sixteenth of the full one, so
   * there is something true on the canvas within a fraction of the wait.
   */
  async function render(upto, { auto = false, probe = !auto } = {}) {
    const generation = ++pass;
    const grid = host.grid();
    readLog();
    // **Before the await, not after it.** The pool takes a moment to start on the first
    // render of a session — a fetch, a compile and a worker apiece — and a Render button
    // that stayed pressable through it would start a second pass on a second press.
    running = { upto, auto, stage: "starting", started: performance.now(), done: 0 };
    finished = null;
    finishedSamples = 0;
    enterStage("starting", { live: false });
    activity("starting the deep renderer…", 0);
    syncControls();
    host.showState("rendering");
    host.say("");

    const stages = [
      { name: "preview", width: grid.width / PREVIEW_DIVISOR, height: grid.height / PREVIEW_DIVISOR, supersample: 1 },
      { name: "full", width: grid.width, height: grid.height, supersample: 1 },
    ];
    const wanted = upto === "preview" ? stages.slice(0, 1) : stages;
    const last = wanted[wanted.length - 1];
    // What the bar is measured against: the stages this pass will actually draw, so a
    // preview-only pass fills it and does not stop at a sixteenth.
    running.stages = wanted;

    try {
      // **Inside the guard.** A pool that fails to start — a fetch that 404s, a module
      // that will not compile — is a throw like any other, and a throw from outside the
      // try left `running` set: the button read *Cancel* for the rest of the session and
      // nothing was said. It is the same failure as a field that raises, and takes the
      // same exit.
      const deep = await pool();
      if (generation !== pass) return;
      readLog();
      unsettle();

      let target = view;
      if (probe && upto !== "preview" && !pinned()) {
        const chosen = await settleCap(deep, target, grid, generation);
        if (generation !== pass) return;
        if (chosen !== null) target = chosen.frame;
      }

      for (const stage of wanted) {
        const key = deepLink.fieldKey(target, stage.width, stage.height, stage.supersample);
        let field = fields.get(key);
        const cached = field !== undefined;
        const span = spanOf(stage);
        // The bar's colour: a picture of this frame is up once the quarter pass has
        // landed, so the full stage is the viewer's *sharpening* and not its *rendering*.
        running.sharpening = stage.name === "full";
        enterStage(stage.name);
        // A stage off the cache iterated nothing, so the bar jumps its share rather than
        // filling it.
        activity(`${said_stage(stage)}…`, cached ? span.from + span.width : span.from);
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
            onStep: (step) => {
              if (generation !== pass) return;
              activity(`${said_stage(stage)} · ${said_step(step)}`, span.from);
            },
          });
          if (field === null || generation !== pass) return;
          if (stage.name === "preview") quarterMs = performance.now() - started;
          remember(key, field);
        }
        enterStage("coloring", { live: false });
        activity(`${said_stage(stage)} · coloring`, span.from + span.width);
        // A copy each time, because the shade takes the buffer and detaches it, and the one
        // in the cache has to stay whole for the next recolour. The stage lands in the colour
        // current now rather than the one the pass started in, and so does every stage after.
        const landed = await shadeNow(deep, field, target, generation);
        if (landed === null) return;
        const shaded = landed.shaded;
        target = landed.frame;
        if (host.deriving()) {
          view = { ...view, level: shaded.level };
          if (drawn !== null) drawn = { ...drawn, level: shaded.level };
          host.onColour();
        }
        drawn = target;
        keep(shaded.image, target);
        // What this stage cost, for the Download row's estimate. A cached field's
        // `elapsed` is the cost it was measured at, which is still the cost of that
        // geometry at that cap; what makes a measurement stale is the frame moving, and
        // the key is what says so.
        measure = {
          frame: deepLink.fieldKey(target, 1, 1),
          samples: stage.width * stage.height * stage.supersample * stage.supersample,
          field: field.elapsed / 1000,
          shade: shaded.elapsed / 1000,
        };
        // The picture a download at the canvas's own size can save instead of drawing it
        // again: the pass's last stage, and only where that stage is the canvas's own size
        // — a quarter-resolution preview is not a picture of this canvas.
        if (stage === last && stage.name !== "preview") {
          finished = shaded.image;
          finishedSamples = stage.supersample;
        }
        if (stage.name === "full") hold(target, shaded, key, field);
        paint();
        host.settle();
        said(stage, field, shaded, cached, target);
      }
      log("finished", { upto });
      host.showState("final");
    } catch (error) {
      host.say(String(error.message ?? error));
      console.error("the deep render failed", { view: deepLink.emit(view) }, error);
      log("failed", { message: String(error.message ?? error) });
      host.showState("stopped");
    } finally {
      if (generation === pass) {
        running = null;
        watch();
        syncControls();
      }
    }
  }

  /**
   * A view whose cap is the width's, re-asked of the kernel once the kernel is up.
   *
   * Before the module loads, the only cap policy on the page is the engine's, which stops
   * at 67,000 — so a link with no `n` parsed before the pool started carries that answer,
   * and below about 1e-22 the kernel's own answer is higher. The width's cap is supposed
   * to be the kernel's, so it is put right here, before anything is drawn at it.
   */
  function unsettle() {
    if (renderer === null || view.capFrom !== "width") return;
    const wanted = renderer.maxiter(view.w.value);
    if (wanted === view.maxiter) return;
    view = { ...view, maxiter: wanted };
    host.settle();
  }

  /**
   * **Choose the cap this frame resolves at, before anything is drawn at it.**
   *
   * The problem it exists for is `perturb-wasm/README.md`'s: below about 1e-22 the width
   * policy's cap lands *inside* the frame's own escape-count distribution, so a sixth to a
   * third of a busy frame runs out of iterations and is painted as interior when it was
   * exterior all along. Nothing on the page looks wrong. The rule is the kernel's — start
   * at the width's cap, look at what died there and whether its derivative was collapsing
   * or exploding, and double while the frame is still dying for want of iterations — and
   * what is here is when it is asked and what it says.
   *
   * **For an explicit Render and a download, and only when the reader has not pinned a
   * cap** *(ckpt141; it used to run for an auto pass too)*. A pinned cap is a choice and
   * escalation is a policy, so a typed cap and a cap a link carries are drawn exactly as
   * they are asked for.
   *
   * **The cap box and the address move once, when this has settled**, and not a rung
   * before. Until then the view's `capFrom` is `"width"` and its link names no cap, so a
   * link copied mid-probe is a link to the width's answer and says so by leaving `n` out.
   *
   * The probe is a few thousand of the frame's own sample cells, so the passes below run
   * **once**, at the settled cap — measured at 0.08% to 0.22% of the fine pass. Every
   * sample cell is at one sample a pixel, because that is the only pass the screen draws;
   * a download probes its own grid through `picture`.
   */
  async function settleCap(deep, from, grid, generation, supersample = 1) {
    enterStage("probe");
    activity("choosing an iteration cap…", 0);
    const chosen = await deep.settle(from, grid.width, grid.height, {
      supersample,
      onStep: (step) => {
        if (generation !== pass) return;
        const trying = `choosing an iteration cap · trying ${count(step.cap)}` +
          (step.rung > 1 ? ` (rung ${step.rung})` : "");
        activity(`${trying} · ${said_step(step)}`, step.total > 0 ? step.done / step.total : null);
      },
      onRung: (counts, rung) => {
        if (generation !== pass) return;
        log("rung", { rung, maxiter: counts.maxiter, fault: counts.fault, samples: counts.samples });
      },
    });
    if (chosen === null || generation !== pass) return null;

    // **The guard is that `view` is still `from` but for its colour.** A gesture during a
    // committed render moves `view` without cancelling the pass — that is the tab's own
    // design — so adopting the settled cap into a view the reader has since moved would put
    // this frame's answer on a different frame. It was object identity until
    // deep_small_fixes_ckpt142, and a palette turned mid-probe replaces the object too: the
    // cap went unadopted and the address kept the width's answer under a picture drawn at
    // another. A colour moves no frame, so it is kept and the cap is taken.
    const frame = { ...from, maxiter: chosen.maxiter, capFrom: "probe" };
    if (sameFrame(view, from)) {
      view = inColour(frame);
      host.settle();
    }
    settledAt = {
      frame: deepLink.fieldKey(frame, 1, 1),
      atCeiling: chosen.atCeiling,
      fault: chosen.fault,
    };
    log("settled", { maxiter: chosen.maxiter, from: chosen.from, steps: chosen.steps, atCeiling: chosen.atCeiling });
    say_settled(chosen);
    syncControls();
    return { ...chosen, frame };
  }

  /**
   * **The deep picture at a download's size** *(deep_cap_policy_ckpt138)*.
   *
   * Until this existed the Download row, while the Deep tab held the canvas, drew and
   * stamped the *shallow* view — a correctly-labelled picture of somewhere else. It is the
   * same render the canvas gets and there deliberately is not a second one: the same pool,
   * the same spec, the same cap policy, with two numbers changed, which is the ruling
   * `download.js` opens with and is as true on this side of the floor as on the other.
   *
   * It takes the pass, so the tab's own Cancel stops it, and **its progress is the Render
   * line's**, labelled *file* *(ckpt141)* — the Download row keeps a price and no bar.
   * Hands back the picture, the link that picture is of — **written after the cap has
   * settled**, because the cap is part of what a deep link says — and the three names a
   * file is spelled from.
   */
  async function picture(width, height, { supersample = 1, holder = {} } = {}) {
    const generation = ++pass;
    readLog();
    running = { upto: "download", auto: false, stage: "file", started: performance.now(), done: 0 };
    finished = null;
    finishedSamples = 0;
    const file = { name: "file", width, height, supersample };
    enterStage("file", { live: false });
    activity("file · starting…", 0);
    syncControls();
    host.showState("rendering");
    try {
      const deep = await pool();
      if (generation !== pass) return null;
      readLog();
      unsettle();

      let target = view;
      if (!pinned()) {
        const chosen = await settleCap(deep, target, { width, height }, generation, supersample);
        if (generation !== pass) return null;
        if (chosen !== null) target = chosen.frame;
      }

      enterStage("file");
      activity(`${said_stage(file)}…`, 0);
      const field = await deep.field(target, width, height, {
        supersample,
        onProgress: (done, elapsed) => {
          if (generation !== pass) return;
          report(file, done, elapsed);
        },
        onStep: (step) => {
          if (generation === pass) activity(`${said_stage(file)} · ${said_step(step)}`, 0);
        },
      });
      if (field === null || generation !== pass) return null;
      // The caller's holder becomes the tab's, so that the tab's own Cancel stops the
      // colouring as well as the field — a download-sized shade is seconds holding a
      // couple of gigabytes, and two ways out that stop different halves is one way out
      // too few.
      colouring = holder;
      enterStage("coloring", { live: false });
      activity(`${said_stage(file)} · coloring`, 1);
      const shaded = await deep.shade(field, target, colouring, { derive: host.deriving() });
      if (shaded === null || generation !== pass) return null;
      // A view the reader made measures its own curve on the frame being saved, exactly as
      // the shallow download does — so the link on the file is the link that redraws it.
      const drawnAs = host.deriving() ? { ...target, level: shaded.level } : target;
      log("file finished", { width, height, supersample });
      host.showState("final");
      return {
        image: shaded.image,
        query: deepLink.emit(drawnAs),
        name: {
          family: deepLink.familyOf(drawnAs),
          mode: "smooth",
          palette: drawnAs.palette,
        },
      };
    } finally {
      if (generation === pass) {
        running = null;
        watch();
        syncControls();
      }
    }
  }

  /** What the tab says about a raised cap: nothing where the width's own answer drew the
   *  frame, and a plain sentence under the picture where it did not.
   *
   *  **The ceiling is said in Details' stat line now** *(ckpt141)*, beside the pass it is a
   *  fact about — *at the ceiling: x% undecided* — rather than as a sentence under the
   *  canvas that outlived the frame it described. */
  function say_settled(chosen) {
    if (chosen.atCeiling || chosen.maxiter === chosen.from) return;
    // The rungs carry counts, because they are summed over the pool's bands; the share is
    // taken here, once, against the samples that were actually walked.
    const opening = chosen.rungs[0];
    const was = Math.round((100 * opening.fault) / Math.max(1, opening.samples));
    host.say(
      `Raised the cap to ${count(chosen.maxiter)}: at ${count(chosen.from)}, ${was}% of this ` +
        "frame was still escaping. It is slower for it.",
    );
  }

  /**
   * Where a stage of the running pass falls on the Render line's bar, by the samples each
   * stage of it computes — the same rule `explorer.js`'s `STAGE_SPAN` states for the
   * shallow pass, except that down here the stages are the pass's own: a preview-only
   * render has one stage and fills the whole bar with it.
   */
  function spanOf(stage) {
    const stages = running?.stages?.includes(stage) ? running.stages : [stage];
    const samples = stages.map((s) => s.width * s.height * s.supersample ** 2);
    const whole = samples.reduce((sum, value) => sum + value, 0);
    const index = Math.max(0, stages.indexOf(stage));
    const before = samples.slice(0, index).reduce((sum, value) => sum + value, 0);
    return { from: before / whole, width: samples[index] / whole };
  }

  /**
   * What the Render line says while a stage's bands run, and the time left.
   *
   * **The estimate comes from the bands this pass has already finished** and from nothing
   * else — not from a table, not from the last view, not from a cost per sample settled
   * somewhere. A deep frame's cost swings over orders of magnitude with how much of it is
   * interior, and the only honest predictor of the rest of *this* frame is the part of it
   * that has already been drawn.
   */
  function report(stage, done, elapsed) {
    const percent = Math.round(done * 100);
    const span = spanOf(stage);
    const left = done > 0.02 ? (elapsed / done) * (1 - done) : null;
    const remaining = left === null ? "" : ` · about ${said_time(left / 1000)} left`;
    activity(`${said_stage(stage)} ${percent}%${remaining}`, span.from + span.width * done);
    log("bands", { stage: stage.name, done: Number(done.toFixed(4)) });
  }

  /** What a stage is called while it runs. A file names its own size and samples, because
   *  those are what the Download row asked for. */
  function said_stage(stage) {
    if (stage.name === "preview") return "quarter resolution";
    if (stage.name === "full") return "full resolution";
    const each = stage.supersample ** 2;
    return `file ${stage.width}×${stage.height}${each > 1 ? ` at ${each}×` : ""}`;
  }

  /** A worker's own report of the call it is in, as the Render line says it. */
  function said_step(step) {
    if (step.phase === "orbit") return `reference orbit ${count(step.done)} of ${count(step.total)}`;
    if (step.phase === "probe") return `${count(step.done)} of ${count(step.total)} cells`;
    if (step.phase === "seeds") return `walking ${count(step.done)} of ${count(step.total)} cells`;
    if (step.phase === "solves") return `solved ${step.done} of ${step.total}`;
    return "";
  }

  function count(value) {
    return Math.round(value).toLocaleString("en-US");
  }

  function said_time(seconds) {
    if (seconds < 1) return "a second";
    if (seconds < 90) return `${Math.round(seconds)} s`;
    return `${Math.round(seconds / 60)} min`;
  }

  /**
   * Details' stat line for a stage that has landed: which pass, what it cost, the cap it
   * drew at, and — where the probe ran out of ceiling on this frame — how much of it is
   * still undecided.
   */
  function said(stage, field, shaded, cached, target) {
    const size = `${stage.width}×${stage.height}`;
    const which = stage.name === "preview" ? "quarter pass" : "full pass";
    const orbit = running?.orbit;
    const orbitSaid =
      orbit === undefined
        ? ""
        : ` · orbit ${count(orbit.points)} points, ${orbit.limbs} limbs${orbit.kept ? " (kept)" : ""}`;
    const cost = cached
      ? `recolored in ${shaded.elapsed.toFixed(0)} ms`
      : `${(field.elapsed / 1000).toFixed(2)} s, shade ${shaded.elapsed.toFixed(0)} ms`;
    stat(`${which} ${size} · ${cost} · cap ${count(target.maxiter)}${ceilingSaid(target)}${cached ? "" : orbitSaid}`);
  }

  /** *at the ceiling: x% undecided*, where the probe settled this frame at the ceiling. */
  function ceilingSaid(of) {
    if (settledAt === null || !settledAt.atCeiling) return "";
    if (settledAt.frame !== deepLink.fieldKey(of, 1, 1)) return "";
    return ` · at the ceiling: ${Math.round(settledAt.fault * 100)}% undecided`;
  }

  /** Details' first line. The Deep tab's own, since the shallow Details is not shown here. */
  function stat(text) {
    els.stats.textContent = text;
  }

  /**
   * Colour the picture on the canvas again, from its own kept field, in the view's colour.
   *
   * **This is what the cache is for.** A deep field costs seconds to minutes and a
   * palette costs a shade, so a recolour walks back from the full pass to the cheapest
   * one that is here and colours that. Nothing re-iterates.
   *
   * **It colours `of`, which is the picture up, and never asks what else is running**
   * *(deep_stall_ckpt143)*. It used to colour `view`'s field, and a tint made while a pass
   * ran was not a recolour at all: `tint` left it to the pass's next stage, which on a deep
   * frame is the full field and minutes away. So the picture on screen ignored every phase,
   * palette and cycles change for as long as the pass took, while the Render line kept
   * counting — the tab looked alive and would not recolour. And `view` is not always a frame
   * with a field: a Cancel after the probe had moved the cap, or any gesture with Auto-render
   * off, left `view` pending, and a recolour of it found nothing and did nothing, every time,
   * until somebody pressed Render. The picture up always has its field in the cache — it is
   * the stage that was just drawn — so a colour change always lands on it; a pass in flight
   * still lands its next stage in the colour current then (`shadeNow`).
   *
   * Its own generation, `tone`, and never `pass`: bumping `pass` from here cancelled whatever
   * pass was running without clearing `running`, which is the one move rule 3 above says
   * leaves the tab stuck. A recolour is dropped where a newer one was asked for, where the
   * tab no longer owns the canvas, or where a pass's stage has replaced the picture it
   * started from — that stage was shaded in the current colour already.
   */
  async function recolour(of = drawn) {
    if (of === null) return;
    const grid = host.grid();
    const stages = [
      { width: grid.width, height: grid.height, supersample: 1 },
      { width: grid.width / PREVIEW_DIVISOR, height: grid.height / PREVIEW_DIVISOR, supersample: 1 },
    ];
    const stage = stages.find(
      (each) => fields.has(deepLink.fieldKey(of, each.width, each.height, each.supersample)),
    );
    if (stage === undefined) {
      // The picture up is always a stage that was just kept, so this is a bug and not a
      // state: said in the console, and in the log, rather than a colour that silently
      // never arrives.
      console.warn("deep recolour: no kept field for the picture on the canvas", deepLink.emit(of));
      log("recolour found no field", { frame: deepLink.emit(of) });
      return;
    }
    const key = deepLink.fieldKey(of, stage.width, stage.height, stage.supersample);
    const field = fields.get(key);
    const generation = ++tone;
    const under = stale;
    recolouring.stop?.();
    recolouring = {};
    let shaded;
    try {
      const deep = await pool();
      shaded = await deep.shade(
        { ...field, values: field.values.slice() },
        inColour(of),
        recolouring,
        { derive: host.deriving() },
      );
    } catch (error) {
      if (generation !== tone) return;
      host.say(String(error.message ?? error));
      console.error("the deep recolour failed", { view: deepLink.emit(view) }, error);
      return;
    }
    if (shaded === null || generation !== tone || !owns || stale !== under) return;
    let target = inColour(of);
    if (host.deriving()) {
      view = { ...view, level: shaded.level };
      target = { ...target, level: shaded.level };
      host.onColour();
    }
    drawn = target;
    const current = !pending();
    if (current) drawn = view;
    keep(shaded.image, drawn);
    // A recolour of the full field of the frame the reader is on is that frame drawn to the
    // end in its new colour: what a download at the canvas's size saves, and what Cancel and
    // a step back return to. Of a frame the reader has left, it is only the picture up.
    if (current && stage.width === grid.width && stage.height === grid.height) {
      finished = shaded.image;
      finishedSamples = 1;
      hold(drawn, shaded, key, field);
    }
    paint();
    if (running === null) {
      host.showState(current ? "final" : "stopped");
      stat(`${stage.width}×${stage.height} · recolored in ${shaded.elapsed.toFixed(0)} ms · cap ${count(drawn.maxiter)}${ceilingSaid(drawn)}`);
    }
    host.settle();
    // The frame is drawn now, so the button and the note say so.
    syncControls();
  }

  // ----------------------------------------------------------------- the gestures

  /** Take back a settle timer `moved()` armed. */
  function disarm() {
    clearTimeout(settleTimer);
    settleTimer = 0;
  }

  /**
   * After a gesture: repaint, and consider drawing the frame the reader has landed on.
   *
   * **This is where the pass in flight is cancelled** *(deep_ui_ckpt140)*. It did not used
   * to be, and that was the bug: a gesture during a committed render moved `view`, left the
   * render drawing the frame the reader had left, and then bailed out here on
   * `running !== null` — so for the rest of a pass that could be four minutes the canvas
   * showed the previous frame and nothing was drawn of this one. With auto-render ticked a
   * settled change takes the pass with it; untick it and the tab is press-to-render, with
   * the old quarter-pass exception below and its old guard.
   */
  function moved() {
    paint();
    clearMinibrots();
    host.settle();
    disarm();
    if (!autoRender && running !== null) return syncControls();
    settleTimer = setTimeout(() => {
      settleTimer = 0;
      if (!shown || !owns || !pending()) return syncControls();
      if (refused() !== null) return syncControls();
      if (autoRender) {
        // **A download is not a pass of the canvas and is not cancelled here.** It is a
        // file the reader asked for, of a frame captured when they asked, and taking four
        // minutes of it away because they nudged the wheel is a worse surprise than the one
        // this exists to fix. ⚠ **Nothing reaches this line today**: a download holds the
        // viewer through `setBusy`, so a wheel is refused before it gets here and every
        // control that calls `moved()` is disabled while one runs. It is here so that a
        // control which opens that route later does not quietly become a way to lose a
        // download.
        if (running !== null && running.upto === "download") return;
        if (running !== null) stop();
        render("screen", { auto: true });
        return;
      }
      // **The only pass that ever starts by itself when auto-render is off**, and only on
      // the evidence of the last one. Nothing here can reach the full passes.
      if (running !== null) return;
      if (quarterMs === null || quarterMs > AUTO_PREVIEW_MS) {
        syncControls();
        return;
      }
      render("preview", { auto: true });
    }, SETTLE_MS);
    // After the timer is armed, so the note can say a frame follows on its own.
    syncControls();
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
   * Reframe about a point of the canvas: a new width, and a centre moved `pull` of the way
   * from where it is to that point.
   *
   * The anchor is the centre plus an offset, and the new centre is the anchor plus the old
   * offset scaled — so what is added to the exact centre is `offset × (1 − scale)`, one
   * double, once. Written this way rather than as `anchor + (centre − anchor) × scale`
   * precisely because the second spelling forms the anchor as a coordinate, and a
   * coordinate formed in `f64` down here is the bug this tab exists to avoid.
   *
   * **`pull` is what a box tool needs and a wheel does not** *(Matt,
   * explorer_box_zoom_and_download_row_ckpt140, 2026-09-22)*. A wheel notch holds the point
   * under the pointer still, which is `1 − scale`; a box puts that point at the centre,
   * which is `1`. The arithmetic is otherwise the same, and sharing it is the only reason
   * a box in this tab is a dozen lines rather than its own exact-decimal route.
   */
  function reframe(px, py, pullOf, widthOf) {
    const grid = host.grid();
    const on = display();
    let width = widthOf(on);
    if (!(width > 0) || !Number.isFinite(width)) return false;
    // **Out no further than the set's outermost frame** *(explorer_deep_polish_ckpt142)* —
    // the viewer's stop, `outermost.js`, on the same home the shallow view uses. Where it
    // bites, the width is the stop's and the pull is re-taken for that width, so the point
    // under the pointer still holds for as far as the zoom actually went.
    const stop = width > view.w.value ? outermost() : null;
    if (stop !== null) {
      if (view.w.value > stop.w) return false;
      width = Math.min(width, stop.w);
    }
    const pull = pullOf(width);
    // The point is taken on what the canvas is SHOWING, which is the widened frame while
    // something is pending — so the wheel zooms about what is under the pointer rather
    // than about where that pointer would be on a picture nobody is looking at.
    const acrossOffset = (px / grid.width - 0.5) * on.w.value;
    const downOffset = (0.5 - py / grid.height) * planeHeight(on);
    const centreAcross = fx.difference(view.x.dec, on.x.dec);
    const centreDown = fx.difference(view.y.dec, on.y.dec);
    const shiftAcross = fx.fromNumber((acrossOffset - centreAcross) * pull);
    const shiftDown = fx.fromNumber((downOffset - centreDown) * pull);
    if (shiftAcross === null || shiftDown === null) return false;
    let x = fx.add(view.x.dec, shiftAcross);
    let y = fx.add(view.y.dec, shiftDown);
    if (stop !== null) {
      // Drawn home as the width nears the stop, and exactly home at it — the home's own
      // decimal, not the centre plus a double that nearly reaches it.
      const t = homeward(width, stop.w);
      if (t >= 1) {
        x = stop.xDec;
        y = stop.yDec;
      } else if (t > 0) {
        const towardX = fx.fromNumber(fx.difference(stop.xDec, x) * t);
        const towardY = fx.fromNumber(fx.difference(stop.yDec, y) * t);
        if (towardX !== null) x = fx.add(x, towardX);
        if (towardY !== null) y = fx.add(y, towardY);
      }
    }
    const next = {
      ...view,
      x: deepLink.coordinateOf(x),
      y: deepLink.coordinateOf(y),
      w: deepLink.widthOf(width),
    };
    if (deepLink.fieldKey(next, 1, 1) === deepLink.fieldKey(view, 1, 1)) return false;
    view = next;
    if (!pinned()) view = { ...view, maxiter: policyCap(width), capFrom: "width" };
    moved();
    return true;
  }

  /** The frame no gesture zooms out past, with its centre as exact decimals. */
  function outermost() {
    const home = context.deepHome(deepLink.familyOf(view));
    const xDec = fx.parse(home.x);
    const yDec = fx.parse(home.y);
    if (xDec === null || yDec === null) return null;
    const stop = stopOf({ x: Number(home.x), y: Number(home.y), w: Number(home.w) }, view.julia !== null);
    return { ...stop, xDec, yDec };
  }

  /** Zoom about a point of the canvas: the point under the pointer stays where it is, and
   *  a notch is a notch — the width scales off the view's own, so notches held down while a
   *  frame is pending compound on the frame being asked for rather than on the standin. */
  function zoom(px, py, factor) {
    return reframe(px, py, (width) => 1 - width / view.w.value, () => view.w.value * factor);
  }

  /**
   * Zoom to a box: the point clicked becomes the centre, and `factor` is the box's share of
   * the canvas width. One `moved()`, like every other gesture here.
   *
   * **Both halves come off the frame the canvas is showing**, and that is the whole
   * difference from a wheel notch. A box is a rectangle the reader drew on a picture, so
   * it means that piece of *that* picture — and while a deep frame is pending the picture
   * is the stale one widened to `PENDING_FRAMING`. Taking the centre from the shown frame
   * and the width from the view zoomed about the right place by 1/0.65 too much, which
   * looked like a box that overshot rather than like a bug. Measured, not supposed: with
   * the tab pending at 4.4 across, a box a third of the canvas wide landed at width
   * 1.3228 where the picture said 2.0350.
   */
  function box(px, py, factor) {
    return reframe(px, py, () => 1, (on) => on.w.value * factor);
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
    stat("");
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
      maxiter: pinned() ? view.maxiter : policyCap(view.w.value),
      capFrom: pinned() ? "reader" : "width",
    };
    cameFrom = null;
    swap({ ...home, palette: view.palette, shade: view.shade, level: view.level });
  }

  /**
   * The same structure, at the critical point, where it is exactly `d`-fold
   * symmetric.
   *
   * **The frame widens to the square root of itself, and it has to.** `z ↦ z² + c`
   * maps the disc of radius `r` about 0 *onto* the disc of radius `r²` about `c`,
   * two to one — so what sits at `z = c` at a width of 2e-9 sits at `z = 0` at a
   * width of 6e-5, and a button that kept the width would land a reader deep inside
   * the basin of the attracting cycle, where every sample is interior and the
   * picture is black. Measured, on the audit's own `c`: it drew a black frame, which
   * is what sent this through the arithmetic. At degree `d` the disc of radius `r`
   * maps onto radius `r^d`, `d` to one, so the half-width is the `d`-th root of the
   * half-width: `2·(w/2)^{1/d}`, which at two is the `√(2w)` it always was.
   *
   * The cap is deliberately **not** re-derived from the new width. The two frames are
   * the same picture and their escape counts differ by exactly one step — the step
   * that takes 0 to c — so the cap that drew one is the cap that draws the other, and
   * the width policy's answer for a frame 4 decades wider would be a different
   * picture of the same place.
   */
  function toOrigin() {
    if (view.julia === null) return;
    const degree = view.degree ?? 2;
    const root = degree === 2 ? Math.sqrt(2 * view.w.value) : 2 * (view.w.value / 2) ** (1 / degree);
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

  // ----------------------------------------------------------------- nearby minibrots

  /**
   * What the list is showing, or `null` when there is nothing to show.
   *
   * **Ephemeral, and that word is doing work.** Nothing here is stored, nothing reaches
   * Saved, and no entry has a link contract of its own: an entry's target is an ordinary
   * `dv` frame, which is why clicking one is a navigation like any other and the way back
   * returns from it. The list is cleared by the next search and by any change of location.
   */
  let minibrots = null;

  /**
   * How long a preview tile may be estimated to take before it is drawn on its own.
   *
   * **Five seconds, and the reason it exists at all is a measurement.** A tile is drawn at
   * eight periods of its own nucleus — below that a minibrot's neighbourhood is a flat
   * black rectangle, which `perturb-wasm`'s `nuclei::TILE_PERIODS` is the table for — and
   * the periods at these depths run to six figures. So a tile of a period-95,000 minibrot
   * is about forty seconds, and one of the audit anchor's period-2,838 minibrot is under
   * three: the same feature is cheap at 2e-11 and expensive at 1e-22, and which one a
   * reader is in is not something a constant can know.
   *
   * This is `AUTO_PREVIEW_MS`'s ruling applied to a second place — nothing expensive
   * starts without being asked — and it is why an entry over the budget is still a full
   * entry: it names its minibrot, says what a preview would cost, and **goes to the frame
   * when clicked**, which is what the list is for. The picture is the preview, not the
   * point.
   */
  const TILE_BUDGET_MS = 5000;

  /** The preview tile: the staged gallery's own 316 px, at 16:9 and one sample a pixel. */
  const TILE = { width: 316, height: 178 };

  /** Seconds a tile of this many samples at this cap is expected to take, from the crate's
   *  own ns a sample-iteration, wasm's 5% over native, and the pool. The mean is 0.85 of
   *  the cap on the tiles `tests/measure.rs` measured, which is what a frame mostly inside
   *  a minibrot's body looks like. */
  function tileSeconds(cap) {
    const lanes = TILE.width * TILE.height;
    const threads = Math.max(1, (renderer?.workerCount ?? 8) * 0.6);
    return (lanes * cap * 0.85 * 5.0e-9 * 1.05) / threads;
  }

  /** The view one entry opens: its own centre, framed at six body widths, at the cap the
   *  kernel says a tile of that period needs. The palette and the shade recipe come with
   *  the reader, because a preview a reader cannot recognise as theirs is a different
   *  picture of the same place. */
  function frameOf(nucleus) {
    const width = renderer.tileWidth(nucleus.size);
    return {
      ...view,
      x: nucleus.x,
      y: nucleus.y,
      w: deepLink.widthOf(width),
      maxiter: renderer.tileCap(nucleus.period, width),
      // Not the width's and not the reader's: the cap a minibrot's own period asks for,
      // written into the link like any settled cap.
      capFrom: "tile",
      julia: null,
    };
  }

  function clearMinibrots() {
    if (minibrots === null) return;
    minibrots = null;
    els.minibrotList.replaceChildren();
    els.minibrotList.hidden = true;
    els.minibrotNote.hidden = true;
    syncControls();
  }

  /**
   * Search this view for the minibrots in and around it, and fill the list.
   *
   * Three phases: the atom-domain walk over the pool, the Newton solves over the pool, and
   * then the tiles one at a time — which is the order the ranking forces, since *largest
   * first* cannot be known until every solve is in.
   */
  async function findMinibrots() {
    if (view.julia !== null || running !== null) return;
    if (!MINIBROT_DEGREES.has(view.degree ?? 2)) return;
    const generation = ++pass;
    const grid = host.grid();
    const target = view;
    readLog();
    running = { upto: "minibrots", auto: false, stage: "searching", started: performance.now(), done: 0 };
    enterStage("starting", { live: false });
    activity("starting the deep renderer…", 0);
    syncControls();
    host.say("");
    clearMinibrots();

    try {
      const deep = await pool();
      if (generation !== pass) return;
      readLog();

      // **The search escalates the cap even where the picture does not**
      // *(pre_closeout_ckpt138, 2026-09-20)*. A nucleus is detected by the index of the
      // smallest `|z|` an orbit reaches, and that index can never exceed the cap the walk
      // was given — so a nucleus whose period is past the cap is not merely missed, it is
      // arithmetically undetectable, and the cells that would have reported it report some
      // lower argmin instead, which is a spurious seed. On the committed `tangle 1e-22`
      // this listed **3** where the record says **6**: the link carries `n=93600`, opening
      // a `dv` link pins the cap so nothing settles it, and the largest nucleus there is
      // **period 94,776** — 1,176 over. Every recorded six was measured at the settled cap
      // of 187,200.
      //
      // So the cap is settled for the **search spec alone**, and `view` is not touched.
      // A cap is a picture choice everywhere else on this tab — it is what a pinned
      // `capFrom` exists to defend — but here it is a floor under correctness, and moving the
      // reader's picture and rewriting their link as a side effect of pressing a search
      // button would be the wrong trade. Where the cap is already settled this costs one
      // rung, because `settle` starts where it is and stops as soon as the fault share is
      // met.
      enterStage("probe");
      activity("finding the cap to search at…", 0);
      const floor = await deep.settle(target, grid.width, grid.height, {
        supersample: 1,
        onStep: (step) => {
          if (generation !== pass) return;
          activity(
            `finding the cap to search at · trying ${count(step.cap)} · ${said_step(step)}`,
            step.total > 0 ? step.done / step.total : null,
          );
        },
      });
      if (floor === null || generation !== pass) return;
      const searched =
        floor.maxiter > target.maxiter ? { ...target, maxiter: floor.maxiter } : target;
      const looking =
        searched === target ? "looking for nuclei" : `looking for nuclei to ${count(floor.maxiter)}`;
      enterStage("searching");
      activity(`${looking}…`, 0);
      const found = await deep.nuclei(searched, grid.width, grid.height, {
        supersample: 1,
        tileSamples: TILE.width,
        onStep: (step) => {
          if (generation !== pass) return;
          activity(`${looking} · ${said_step(step)}`, step.total > 0 ? step.done / step.total : null);
        },
      });
      if (found === null || generation !== pass) return;

      if (found.length === 0) {
        els.minibrotNote.hidden = false;
        els.minibrotNote.textContent = "No minibrot was found in this view.";
        return;
      }

      minibrots = found;
      show(found);
      // **The unreachable ones are said rather than hidden.** A `dv` centre is capped at 64
      // characters, and a minibrot found in a view at 1e-n sits near 1e-2n — so below about
      // 1e-30 the best entries are places this site can find and cannot spell a link to.
      const reachable = found.filter((one) => spellable(one));
      const lost = found.length - reachable.length;
      els.minibrotNote.hidden = false;
      els.minibrotNote.textContent =
        `${found.length} found, largest first.` +
        (lost === 0
          ? ""
          : ` ${lost} of them ${lost === 1 ? "sits" : "sit"} deeper than a link can spell a ` +
            "center for, so they are listed without one.");

      let tile = 0;
      for (const nucleus of reachable) {
        if (generation !== pass) return;
        tile += 1;
        const frame = frameOf(nucleus);
        if (tileSeconds(frame.maxiter) * 1000 > TILE_BUDGET_MS) continue;
        enterStage("tiles");
        activity(`drawing previews · ${tile} of ${reachable.length}`, (tile - 1) / reachable.length);
        const field = await deep.field(frame, TILE.width, TILE.height, {
          supersample: 1,
          period: nucleus.period,
          onStep: (step) => {
            if (generation === pass) {
              activity(`drawing previews · ${tile} of ${reachable.length} · ${said_step(step)}`);
            }
          },
        });
        if (field === null || generation !== pass) return;
        const shaded = await deep.shade(field, frame, {}, { derive: false });
        if (shaded === null || generation !== pass) return;
        paintTile(nucleus, shaded.image);
      }
    } catch (error) {
      host.say(String(error.message ?? error));
    } finally {
      if (generation === pass) {
        running = null;
        watch();
        host.showState(drawn === null ? "stopped" : "final");
        syncControls();
      }
    }
  }

  /** Whether a `dv` link can carry this entry's frame — the same 64 characters every other
   *  coordinate on this site is held to. */
  function spellable(nucleus) {
    return (
      nucleus.x.text.length <= deepLink.COORDINATE_LIMIT &&
      nucleus.y.text.length <= deepLink.COORDINATE_LIMIT
    );
  }

  /** The list, as entries with nothing drawn in them yet. */
  function show(found) {
    els.minibrotList.replaceChildren();
    els.minibrotList.hidden = false;
    for (const nucleus of found) {
      const entry = document.createElement("button");
      entry.type = "button";
      entry.className = "minibrot";
      const reachable = spellable(nucleus);
      entry.disabled = !reachable;

      const well = document.createElement("div");
      well.className = "minibrot-tile";
      const frame = frameOf(nucleus);
      const seconds = tileSeconds(frame.maxiter);
      well.textContent = !reachable
        ? "past what a link can spell"
        : seconds * 1000 > TILE_BUDGET_MS
          ? `a preview here is about ${said_time(seconds)}`
          : "";
      entry.append(well);

      const said = document.createElement("span");
      said.className = "minibrot-said";
      said.textContent = `period ${nucleus.period.toLocaleString("en-US")} · ${exponent(nucleus.size)} across`;
      entry.append(said);

      entry.title = reachable
        ? `Go to this minibrot: ${frame.w.text} across, ${frame.maxiter.toLocaleString("en-US")} iterations.`
        : "This minibrot's center needs more digits than a link carries, so the tab cannot open it.";
      // **The frame this entry was built with**, and never one derived at click time: by
      // then `view` may have moved, and an entry that quietly re-aims is an entry that
      // sends a reader somewhere they were not shown.
      if (reachable) entry.addEventListener("click", () => swap({ ...frame }));
      nucleus.node = well;
      els.minibrotList.append(entry);
    }
  }

  /** One tile's picture, once it has been drawn. */
  function paintTile(nucleus, image) {
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    canvas.getContext("2d").putImageData(image, 0, 0);
    nucleus.node.replaceChildren(canvas);
  }

  /** A width as a reader reads it: one figure and a decade. */
  function exponent(value) {
    if (!(value > 0) || !Number.isFinite(value)) return "unknown";
    const decade = Math.floor(Math.log10(value));
    return `${(value / 10 ** decade).toFixed(1)}e${decade}`;
  }

  // ----------------------------------------------------------------- the controls

  function setCap(value) {
    const wanted = Math.round(value);
    const held = Math.max(deepLink.CAP_FLOOR, Math.min(deepLink.CAP_LIMIT, wanted));
    if (held === view.maxiter && pinned()) return;
    view = { ...view, maxiter: held, capFrom: "reader" };
    moved();
  }

  // ------------------------------------------------------------------ Details

  /**
   * One coordinate box, retyped: the deep contract reads it, or says why it will not.
   *
   * **The shallow Details' route, taken on purpose** — `explorer.js`'s `retype`: the view is
   * emitted, one key replaced, and the whole string parsed back, so a typed coordinate is
   * read by exactly the reader a link's coordinate is read by and refused with exactly its
   * sentence, and nothing about the place is re-spelled through a double. What comes back
   * is taken for the frame alone; the colour and the cap stay the view's own, except that a
   * new width re-asks the width's cap where the reader has not pinned one, as a zoom does.
   */
  function retype(key, text) {
    const params = new URLSearchParams(deepLink.emit(view));
    params.set(key, text);
    let read;
    try {
      read = deepLink.parse(`?${params}`, context);
    } catch (error) {
      host.say(error.message);
      return false;
    }
    const next = { ...view, x: read.x, y: read.y, w: read.w };
    if (key === "w" && !pinned()) {
      next.maxiter = policyCap(read.w.value);
      next.capFrom = "width";
    }
    if (deepLink.emit(next) === deepLink.emit(view)) return true;
    view = next;
    moved();
    return true;
  }

  const COORDINATE_BOXES = { x: els.x, y: els.y, w: els.w };
  for (const [key, input] of Object.entries(COORDINATE_BOXES)) {
    input.addEventListener("change", () => {
      if (!retype(key, input.value.trim())) input.value = view[key].text;
    });
  }

  const POWERS = { 2: "²", 3: "³", 4: "⁴", 5: "⁵", 6: "⁶" };

  /** Where the cap in force came from, as Details says it. */
  const CAP_SOURCES = {
    width: "from the width; Render may raise it",
    probe: "settled by the probe",
    reader: "yours",
    tile: "the minibrot's own",
  };

  /** Details, synced to the view: the set, `c` for a Julia view, the three boxes, and the
   *  cap with where it came from. The stat line is written by the passes, not here. */
  function syncDetails() {
    const degree = view.degree ?? 2;
    const julia = view.julia !== null;
    const set = julia ? "Julia set" : degree === 2 ? "Mandelbrot set" : "Multibrot set";
    els.family.textContent = `${set} · z${POWERS[degree] ?? `^${degree}`} + c · degree ${degree}`;
    els.paramGroup.hidden = !julia;
    if (julia) els.param.textContent = `${view.julia.x.text} + ${view.julia.y.text}i`;
    for (const [key, input] of Object.entries(COORDINATE_BOXES)) {
      // Never under the reader's cursor: a drag while they type would take the box away.
      if (document.activeElement !== input) input.value = view[key].text;
    }
    els.capSaid.textContent = `cap ${count(view.maxiter)} · ${CAP_SOURCES[view.capFrom] ?? CAP_SOURCES.reader}`;
  }

  // ------------------------------------------------------------------- auto-render

  function storedAuto() {
    try {
      // Ticked unless this tab has been told otherwise, so absent is on.
      return window.sessionStorage.getItem(AUTO_RENDER) !== "off";
    } catch {
      // A browser that stores nothing still has the box; it forgets it on a reload.
      return true;
    }
  }

  function setAuto(value) {
    autoRender = value;
    els.auto.checked = value;
    try {
      window.sessionStorage.setItem(AUTO_RENDER, value ? "on" : "off");
    } catch {
      /* As above. */
    }
    syncControls();
    // Ticking it over a frame the reader has already moved to draws that frame, rather
    // than waiting for another gesture to prove they meant it. **Not where nothing has
    // been drawn at all**: that is not a frame change, it is arriving, and arriving does
    // not start minutes of work — the same rule `enter` keeps, and Render is right beside
    // the box.
    if (value && drawn !== null && pending()) moved();
  }

  /** Whether Render is Cancel just now: a pass somebody commanded, or any pass the watchdog
   *  has found silent. */
  function cancellable() {
    return running !== null && (!running.auto || running.stalled > 0 || revertible());
  }

  /**
   * Whether Cancel goes back as well as stopping: a pass that started on its own, of a frame
   * that is not the one last drawn to the end, with that one held.
   *
   * **One button, and what it does follows from who started the pass**
   * *(explorer_deep_polish_ckpt142)*. A pass the reader commanded — Render, a link, a step
   * back — is a frame they asked for, and Cancel stops it where it is, as it always has. A
   * pass that started by itself after a gesture is one they may never have wanted, and the
   * picture it dimmed may have taken minutes: there Cancel is the way back to it, at once.
   * Before this, such a pass left Render as Render, so that pressing it would upgrade the
   * pass rather than stop it — the upgrade now waits for the pass to land, one press later
   * as *Render again*, and the way back is under the pointer where it is wanted.
   */
  function revertible() {
    return (
      running !== null &&
      running.auto &&
      settled !== null &&
      !isSettled(view) &&
      running.upto !== "download" &&
      running.upto !== "minibrots"
    );
  }

  function syncControls() {
    const busy = running !== null;
    const why = busy ? null : refused();
    // **A pass that started on its own does not take the button** — until the watchdog
    // says it has gone quiet. It is a pass the reader did not ask for, so turning Render
    // into Cancel while it runs would put the one control this tab has out of reach at
    // exactly the moment it is wanted: a reader who gestures and then wants the picture
    // would press Render and stop a render instead. Cancel is for a pass somebody
    // commanded; pressing Render through one that started on its own upgrades it to the
    // probed pass. **A silent pass is the exception** *(ckpt141)*: ten seconds with nothing
    // from the pool, and the way out is offered on the button already there. **So is a pass
    // with a finished picture behind it** *(explorer_deep_polish_ckpt142)*: there the button
    // is Cancel from the start, and it goes back to that picture — see `revertible`.
    const committed = busy && !running.auto;
    const cancel = cancellable();
    els.render.textContent = cancel ? "Cancel" : pending() || drawn === null ? "Render" : "Render again";
    els.render.classList.toggle("is-running", cancel);
    els.render.title =
      cancel && revertible() ? "Stop, and go back to the last finished picture." : cancel ? "Stop this render." : "";
    els.render.disabled = why !== null;
    els.progress.hidden = !busy;
    if (busy) {
      showActivity();
    } else {
      els.spinner.hidden = true;
      els.progress.classList.remove("is-stalled");
      // At rest the bar says whether the picture up is the frame: full when it is, empty
      // when nothing has been drawn or the reader has moved off it.
      els.bar.style.setProperty("--done", drawn !== null && !pending() ? "1" : "0");
      els.bar.dataset.state = drawn !== null && !pending() ? "final" : "rendering";
    }
    els.auto.checked = autoRender;
    els.cap.value = String(view.maxiter);
    els.capUp.disabled = committed || view.maxiter >= deepLink.CAP_LIMIT;
    els.capDown.disabled = committed || view.maxiter <= deepLink.CAP_FLOOR;
    syncDetails();

    const julia = view.julia !== null;
    els.julia.textContent = julia ? "Back to the Mandelbrot set (j)" : "Julia at this c (j)";
    els.julia.disabled = committed;
    els.julia.title =
      julia && cameFrom !== null ? "Back to the frame this Julia set was opened from." : "";
    els.origin.hidden = !julia;
    // **Mandelbrot only.** There are no minibrots on a dynamical plane: a Julia set has no
    // parameter-space nuclei in it, so the button is not disabled there, it is absent. The
    // same at a degree whose size estimate did not land against a measured pin — see
    // `MINIBROT_DEGREES`.
    els.minibrots.hidden = julia || !MINIBROT_DEGREES.has(view.degree ?? 2);
    els.minibrots.disabled = committed || busy;
    els.minibrots.textContent = running?.upto === "minibrots" ? "Looking…" : "Nearby minibrots";
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
        ? ""
        : "This frame is below what the ordinary explorer can resolve, so it cannot be carried back.";
    els.back.hidden = false;

    // What the tab says about itself, in one line: what Render would do, and what is
    // drawing itself.
    if (why !== null) {
      els.note.textContent = why;
    } else if (busy) {
      // **The one thing a busy tab has to say**, and the reason it says it: a committed
      // pass of a frame the reader has since left runs on for minutes showing the picture
      // they moved off, and until this sentence existed the tab explained none of it. Only
      // with auto-render off, because with it on the same state lasts the 350 ms before the
      // settle timer takes the pass over — and it names Cancel rather than Render, because
      // through a committed pass Render *is* Cancel.
      els.note.textContent =
        !autoRender && committed && pending()
          ? "This is still drawing the frame you left. Cancel stops it; tick Auto-render and a new frame takes over on its own."
          : revertible()
            ? "Cancel goes back to the last finished picture, without drawing it again."
            : "";
    } else if (drawn === null) {
      els.note.textContent = "Nothing has been drawn yet. Render draws this frame.";
    } else if (pending()) {
      // *Follows on its own* only while the settle timer is armed *(deep_stall_ckpt143)*:
      // a Cancel leaves a pending frame nothing is going to draw — after the probe has
      // moved the cap, or after a gesture — and the note used to promise it anyway.
      els.note.textContent = autoRender
        ? settleTimer !== 0
          ? "The last picture drawn, boxed where this frame sits. This frame follows on its own."
          : "The last picture drawn, boxed where this frame sits. Render draws this frame."
        : quarterMs !== null && quarterMs <= AUTO_PREVIEW_MS
          ? "The last picture drawn, boxed where this frame sits. A quick preview will follow on its own; Render draws it properly."
          : "The last picture drawn, boxed where this frame sits. Render draws this frame.";
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
      "This tab is several times slower than the explorer and gets slower as you go " +
        "deeper — a frame can take minutes. Auto-render draws each frame you move to at the " +
        "width's own cap; Render also checks whether the frame needs a higher one.",
    );
  }

  /**
   * Come into the tab.
   *
   * `from` is the viewer's own view where it is on one of the families this kernel draws,
   * and the frame is carried over: its coordinates are already exact decimal text, so
   * nothing is lost crossing the floor. Anywhere else the tab opens at the last deep view
   * it had, or at the Mandelbrot home, and says which families deep draws.
   */
  function enter(from) {
    warn();
    if (from !== null) {
      const carried = carry(from);
      if (carried !== null) {
        view = carried;
        drawn = null;
        stale = null;
        // A frame carried in from the viewer is a fresh start, and Cancel going back to a
        // deep frame from before it would be going somewhere the reader has since left.
        settled = null;
        fields.clear();
        settledAt = null;
        cameFrom = null;
      }
    } else if (drawn === null && stale === null) {
      host.say(
        "Deep draws degrees 2 to 6 and nothing else: the Mandelbrot and Multibrot sets, and the Julia set of any c on them.",
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
    const family = deepLink.FAMILIES.get(from.family);
    if (family === undefined) return null;
    let julia = null;
    if (family.julia) {
      const re = fx.parse(from.constants.cx.text);
      const im = fx.parse(from.constants.cy.text);
      if (re === null || im === null) return null;
      julia = { x: deepLink.coordinateOf(re), y: deepLink.coordinateOf(im) };
    }
    return {
      version: deepLink.VERSION,
      degree: family.degree,
      julia,
      x: deepLink.coordinateOf(x),
      y: deepLink.coordinateOf(y),
      w: deepLink.widthOf(from.w.value),
      maxiter: policyCap(from.w.value),
      capFrom: "width",
      aspect: from.aspect,
      palette: from.palette,
      shade: from.shade,
      level: from.level,
    };
  }

  // ----------------------------------------------------------------- the wiring

  els.render.addEventListener("click", () => {
    if (revertible()) {
      revert();
      host.say("");
      return;
    }
    if (cancellable()) {
      stop();
      host.say("Stopped.");
      host.showState("stopped");
      return;
    }
    // Through a pass that started on its own: that one is abandoned and the committed one
    // starts, which picks its quarter field straight back out of the cache if it finished.
    // A committed pass is the one that may probe the cap.
    render("screen");
  });

  els.auto.addEventListener("change", () => setAuto(els.auto.checked));

  els.capUp.addEventListener("click", () => setCap(view.maxiter * CAP_STEP));
  els.capDown.addEventListener("click", () => setCap(view.maxiter / CAP_STEP));
  els.cap.addEventListener("change", () => {
    const wanted = Number(els.cap.value);
    if (Number.isFinite(wanted)) setCap(wanted);
    els.cap.value = String(view.maxiter);
  });
  els.policy.addEventListener("click", () => {
    const wanted = policyCap(view.w.value);
    const changed = wanted !== view.maxiter;
    view = { ...view, maxiter: wanted, capFrom: "width" };
    if (changed) {
      moved();
    } else {
      // The same number, but no longer anybody's choice: the link drops its `n`.
      host.settle();
      syncControls();
    }
  });

  els.julia.addEventListener("click", () => (view.julia === null ? toJulia() : toMandelbrot()));
  els.origin.addEventListener("click", toOrigin);
  els.minibrots.addEventListener("click", findMinibrots);
  els.back.addEventListener("click", () => host.leave(view));
  els.save.addEventListener("click", () => host.save(deepLink.emit(view)));

  return {
    /** The view the tab is standing on, for the colour controls and for a link. */
    view: () => view,
    /** The family this view is, by the shallow contract's name — what a download is named
     *  from, so the row that names it need not load the deep contract to ask. */
    family: () => deepLink.familyOf(view),
    /** Whether the tab owns the viewer — whether the picture on screen is the deep one. */
    owns: () => shown && owns,
    link: () => deepLink.emit(view),
    /** `j` while this tab owns the viewer: the tab's own *Julia at this c*, or its way back,
     *  exactly as a click on it — and nothing where the button is disabled
     *  *(pre_closeout_website_ckpt140)*. */
    pressJulia() {
      if (!els.julia.disabled && !els.julia.hidden) els.julia.click();
    },

    // ----------------------------------------------------------- what Download borrows
    //
    // The row under the canvas draws whichever view owns it, and while this tab does the
    // four things it needs are the four below: what the kernel makes of this frame at a
    // download's size, what a pass of it measured, the picture already on the screen, and
    // the render itself.

    /** The kernel's answer for this frame at a size that is not the canvas's. Worth asking
     *  per size: a supersample samples a grid `ss` times finer, so a frame the canvas still
     *  resolves can be one a download does not. `null` before the module is up, which is
     *  what `refused` says too. */
    plan: (width, height, supersample = 1) =>
      renderer === null
        ? null
        : renderer.plan(deepSpecOf(view, width, height, { supersample })),
    /** What a pass of *this* frame cost, or `null` where the last one was of another. */
    measured: () =>
      measure !== null && measure.frame === deepLink.fieldKey(view, 1, 1) ? measure : null,
    /** The finished picture at the canvas's own size, once the last stage has landed. */
    shown: () => finished,
    /** How many samples a pixel, each way, that picture was drawn at — `0` where there is
     *  none, and one where there is, because one is all the screen draws *(ckpt141)*.
     *  **Asked rather than assumed** *(deep_ui_ckpt140)*: the Download row used to take it
     *  that this tab ends where the viewer does, at two, and reuse the screen's picture for
     *  a 4× download on the strength of it. */
    finalSupersample: () => finishedSamples,
    picture,

    show() {
      shown = true;
      owns = true;
      paint();
      syncControls();
    },
    hide() {
      shown = false;
      owns = false;
      disarm();
      stop();
    },
    /** The reader took the viewer for something else; the tab keeps its view. */
    detach() {
      owns = false;
      disarm();
      stop();
    },
    enter,

    /** Open a deep link — a saved picture, the address bar, a step back.
     *
     *  **A link is a frame change the reader asked for**, so auto-render draws it the way it
     *  draws any other, at one sample a pixel; untick the box and it is the quarter pass
     *  alone, which is what this always did. Either way the pass is committed rather than
     *  auto — a link is a press — so Cancel is there for it. **It does not probe the cap**
     *  *(ckpt141)*: a link that names one is drawn at it, pinned, and one that names none
     *  is drawn at the width's, as the auto pass draws it; Render is what asks for more. */
    open(query) {
      let next = deepLink.parse(`?${query}`, context);
      // A link with no cap reads the engine's policy until the kernel is up; once it is,
      // the width's cap is the kernel's — which is what a held field was drawn at.
      if (renderer !== null && next.capFrom === "width") {
        next = { ...next, maxiter: renderer.maxiter(next.w.value) };
      }
      // A link says where it points and not where its writer was standing.
      cameFrom = null;
      owns = true;
      warn();
      // **A frame already drawn is put back rather than drawn again**
      // *(explorer_deep_polish_ckpt142)*. This is the door a step back comes through, and
      // the palette change it undoes was a recolour: so the undo is one too. The field
      // cache is kept across a link for the same reason — it is keyed on the set, the
      // frame and the cap, so nothing in it can be taken for another picture.
      if (isSettled(next)) {
        putBack(next);
        return;
      }
      const full = host.grid();
      if (fields.has(deepLink.fieldKey(next, full.width, full.height, 1))) {
        stop();
        disarm();
        view = next;
        clearMinibrots();
        syncControls();
        host.settle();
        recolour(next);
        return;
      }
      view = next;
      drawn = null;
      stale = null;
      settledAt = null;
      syncControls();
      host.settle();
      stat("");
      host.say("");
      host.showState("stopped");
      render(autoRender ? "screen" : "preview", { probe: false });
    },

    /** A colour control moved. The field is kept, so this never re-iterates. The picture up
     *  takes the colour now, whatever is running *(deep_stall_ckpt143)*; a pass in flight is
     *  left to run, and its next stage lands in this colour too (`shadeNow`). */
    tint(changes) {
      view = { ...view, ...changes };
      host.settle();
      if (drawn === null) {
        syncControls();
        return;
      }
      recolour();
    },

    pan,
    zoom,
    box,
    /** An arrow key, as a share of the width. */
    nudge(across, down) {
      pan(-across * PAN_STEP * host.grid().width, down * PAN_STEP * host.grid().height);
    },
    wheel: (px, py, out) => zoom(px, py, out ? WHEEL_ZOOM : 1 / WHEEL_ZOOM),
    key: (px, py, out) => zoom(px, py, out ? KEY_ZOOM : 1 / KEY_ZOOM),
    repaint: paint,
    stop,
    /** The document is going away: the deep pool goes with it.
     *
     *  Distinct from `stop`, which cancels the pass and keeps the workers — a reader who
     *  cancels a deep render is still on the tab. This one is the tab's whole share of
     *  `pagehide`, and it is the larger half of what a deep document holds: `perturb.wasm`
     *  is instantiated once per worker and the reference orbit is held in every one of
     *  them. `DeepRenderer.stop()` existed and had no caller until now. */
    close() {
      stop();
      renderer?.stop();
      renderer = null;
      starting = null;
    },
  };
}
