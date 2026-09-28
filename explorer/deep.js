// The Deep tab: the Mandelbrot set below the `f64` floor, drawn on purpose.
//
// **It is a deliberate, rare, slower mode, and the whole design follows from that.** A
// deep frame is seconds to minutes where a shallow one is a fraction of a second, so the
// one thing this tab must never do is start a *long* one by accident. A gesture here does
// not draw the frame it lands on: it slides the last picture as a stale bitmap and draws a
// box saying what would be drawn.
//
// **What follows a gesture on its own is the one-sample pass, and `autoRender` is the
// switch** *(deep_ui_ckpt140, 2026-09-21)*. Ticked — which it is unless this viewer turned
// it off — a settled frame change cancels whatever is in flight and draws the new frame at
// the quarter pass and then one sample a pixel, and so does arriving: entering the tab and
// opening a link are frame changes too *(Matt, interior_seam_deep_autorender_ckpt146)*.
// Unticked, the tab is press-to-render and the only thing that starts by itself is the
// quarter pass, and only once the last one came back under `AUTO_PREVIEW_MS`, a threshold
// measured on this machine and this view rather than assumed; the canvas is then empty
// until something of this tab's own is drawn, never the picture it was entered over. **The screen is always one sample a pixel** *(deep_tab_activity_and_layout_
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
import { BODY_TARGET, DeepRenderer, bodyShare, deepSpecOf } from "./deep-render.js";
import { HOLD_MS, SAVE_COUNT, chains, draws, keepBarred, landedSaid, loopStep, queryIn } from "./dives.js";
import { stopOf } from "./outermost.js";

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
 * What an iteration costs with the kernel's interior switch on, against one with it off,
 * where the switch does not fire — the price the full pass pays for asking.
 *
 * **Measured in the committed module, and taken low** *(profiling_pass_ckpt146)*: on
 * frames the switch never fires on, off ran in 0.50 to 0.73 of the time on did, the lanes
 * identical, so the price is 1.4x to 2x. The rule below keeps the switch on unless
 * turning it off is cheaper at the low end of that range, so a frame near the crossing
 * keeps the setting the kernel ships.
 */
const SWITCH_PRICE = 1.4;

/**
 * Whether the full pass should run with the interior switch on, read off the quarter pass
 * of the same frame.
 *
 * **The switch never moves a pixel**: a sample it stops early is one the plain loop runs to
 * the cap, and both write `NaN`. So this is a speed and nothing else, and the quarter pass —
 * drawn with it on, the kernel's default — says exactly what the plain loop would have run:
 * `ran` is what it did run and `saved` what the switch spared it. The plain loop runs
 * `ran + saved` at the lower price; the switch runs `ran` at `SWITCH_PRICE`. A sixteenth of
 * the samples is a sample of the frame's interior share, which is the thing that decides
 * it and the thing the crate README showed no width can stand in for.
 */
function switchFor(quarter) {
  if (quarter?.ran == null || quarter.saved == null || quarter.ran <= 0) return true;
  return quarter.ran + quarter.saved >= SWITCH_PRICE * quarter.ran;
}

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

/** Where the auto-render flag is remembered: `localStorage`, so it is the viewer's and
 *  outlives the tab *(Matt, interior_seam_deep_autorender_ckpt146)*. On is what the tab is
 *  meant to be, and off is for a machine or a moment that does not want it; a reader who
 *  turned it off on a slow laptop should not have to turn it off again on every visit. A
 *  way of working and not part of a picture, so no link carries it. */
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
 * The degrees *Find minibrots* is offered at.
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

/** How many random wallpapers one press of Go draws before it says none would do
 *  *(deep_dive_block_ckpt154)*: a draw fails when no copy near it is a step down that fits
 *  the ceiling, or its landing cannot be spelled, and a few tries turn most of those into a
 *  landing without making a press that cannot succeed take minutes. */
const RANDOM_TRIES = 4;

/** How much wider than the view a mapped landing searches when the copies in the view are
 *  all past the budget: the view, then sixteen times it, then 256, and never past the set's
 *  outermost frame. */
const WIDEN = [1, 16, 256];

/**
 * The Dive block's one bar, by the part of a press it is in: `[from, width]` of the bar.
 * The search is most of what a press waits on before anything is drawn and has most of the
 * first half, a mapped landing's own search round its view and its shooting the rest of it,
 * and the pass that draws where it landed the second half.
 */
const DIVE_SPANS = {
  probe: [0, 0.15],
  search: [0.15, 0.25],
  anchorProbe: [0.4, 0.03],
  anchor: [0.43, 0.04],
  land: [0.47, 0.03],
  render: [0.5, 0.5],
};

/** Where *New coloring on arrival* is remembered: the viewer's, like Auto-render, and off
 *  unless they ticked it. */
const DIVE_COLOURING = "explorer.deep-dive-coloring";

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
  /** Whether the picture up is a full pass — the frame drawn to the end at the canvas's own
   *  size — rather than the quarter pass. Meaningful only while `drawn` is set; it is what
   *  `showsFinished` reads for the arrival refit *(site_audit_ckpt147)*. */
  let drawnFull = false;
  /** The view the gestures have moved to. Equal to `drawn` when nothing is pending. */
  let view = deepLink.fresh(context);
  /** The last picture drawn, as a canvas, and the view it was of. */
  let stale = null;
  /**
   * The last few frames drawn, held whole so that the way back to any of them costs nothing
   * *(explorer_deep_polish_ckpt142; a history since deep_tab_undo_and_layout_ckpt144)*:
   * `{ frame, view, canvas, image, key, field, full }`, newest first — the frame's key, its
   * view, its picture as a canvas, the image a download saves (`null` for a quarter
   * picture), its field by its cache key, and whether that field is the full pass. `stale`
   * is not enough for this: an auto pass puts its quarter picture there within a second of a
   * stray gesture, and the picture that took minutes is gone.
   *
   * It is what Cancel returns to when it cancels a pass the reader did not ask for, and
   * what a step back onto a held frame puts up. **A frame is held as far as it was drawn**
   * *(Matt, ckpt144)*: a frame left after its quarter pass is its quarter picture, because
   * "with its pixels" means whatever pixels it had, and one drawn to the end is its full
   * one. A frame is one entry, at its best stage.
   *
   * **`HELD_LIMIT` entries**, and the bound is memory: a full entry is its field, 8 bytes a
   * pixel, plus the canvas and the image, 4 each — 11.6 MB at a 1136×636 canvas and about
   * 46 MB for four. Four is the frame a stray gesture took away and the three before it,
   * which is as far back as a Ctrl+Z run goes before somebody would rather press Render.
   */
  let held = [];
  const HELD_LIMIT = 4;
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

  /**
   * Hold the picture just put up, straight after `keep`, as its frame's entry in `held`. A
   * derived tone is the picture's own, so the view held carries the curve it was drawn
   * with. A quarter picture never replaces a full one of the same frame — a Render again
   * lands its quarter pass first — it only brings that entry to the front.
   */
  function hold(of, shaded, key, field, full) {
    const frame = deepLink.fieldKey(of, 1, 1);
    const at = held.findIndex((entry) => entry.frame === frame);
    const was = at < 0 ? null : held.splice(at, 1)[0];
    if (was !== null && was.full && !full) {
      held.unshift(was);
      return;
    }
    const level = host.deriving() ? shaded.level : of.level;
    held.unshift({
      frame,
      view: { ...of, level },
      canvas: stale.canvas,
      image: full ? shaded.image : null,
      key,
      field,
      full,
    });
    held.length = Math.min(held.length, HELD_LIMIT);
  }

  /** The entry `held` keeps for `of`'s frame — the place, the set and the cap, whatever its
   *  colour — or `null`. */
  function heldFor(of) {
    const frame = deepLink.fieldKey(of, 1, 1);
    return held.find((entry) => entry.frame === frame) ?? null;
  }

  /** What Cancel goes back to: the newest frame held that is not the one the reader is on,
   *  which is the frame the gesture left. */
  function leftBehind() {
    const frame = deepLink.fieldKey(view, 1, 1);
    return held.find((entry) => entry.frame !== frame) ?? null;
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
   * Put a held picture back as the view `to`, which is its frame: at once where the colour
   * is the one it was drawn in, and by a recolour of its held field where the reader has
   * turned the palette since — never by iterating. Stops whatever pass is in flight.
   */
  function putBack(to, entry) {
    stop();
    disarm();
    // To the front: the frame put back is the one a later Cancel would leave.
    held = [entry, ...held.filter((each) => each !== entry)];
    const inked = { ...to, level: host.deriving() ? entry.view.level : to.level };
    if (deepLink.emit(inked) !== deepLink.emit(entry.view)) {
      view = to;
      remember(entry.key, entry.field);
      recolour(entry.view);
      clearMinibrots();
      syncControls();
      return;
    }
    view = to.capFrom === entry.view.capFrom ? entry.view : { ...entry.view, capFrom: to.capFrom };
    drawn = view;
    drawnFull = entry.full;
    stale = { canvas: entry.canvas, view };
    // Only a full picture is one a download at the canvas's size can save.
    finished = entry.image;
    finishedSamples = entry.full ? 1 : 0;
    remember(entry.key, entry.field);
    paint();
    clearMinibrots();
    const which = entry.full ? "full pass" : "quarter pass";
    stat(`${which} ${entry.canvas.width}×${entry.canvas.height} · put back without drawing · cap ${count(view.maxiter)}${ceilingSaid(view)}`);
    host.showState("final");
    host.settle();
    syncControls();
  }

  /**
   * Cancel, for a pass the reader did not ask for: stop it, and go back to the frame the
   * gesture left, with the pixels it had *(Matt, explorer_deep_polish_ckpt142; any held
   * frame since ckpt144)*. A stray drag with Auto-render ticked starts a pass on its own and
   * dims the picture that took minutes; this is the way back from it that costs nothing.
   */
  function revert() {
    const entry = leftBehind();
    if (entry === null) return;
    putBack(inColour(entry.view), entry);
  }

  /**
   * Draw what is currently true: the last picture, where it falls, and the pending frame
   * over it if the reader has moved.
   *
   * **This is the whole of what a gesture does.** No pass is started, nothing is
   * iterated, and the picture on screen is honestly labelled as the old one.
   */
  function paint() {
    // **Nothing to slide is an empty canvas, never the last picture of something else**
    // *(interior_seam_deep_autorender_ckpt146)*. With no picture of this tab's own the
    // canvas used to keep whatever was there — the shallow view it was entered from, or a
    // frame a link replaced — so a `panel=deep` link drew a different raster on each load.
    // `swap`'s reason, applied everywhere.
    if (stale === null) {
      if (owns) {
        host.compose((ink, grid) => {
          ink.fillStyle = "#000";
          ink.fillRect(0, 0, grid.width, grid.height);
        });
      }
      return;
    }
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
    // The sentence is the bar's hover title and the live region's words, never a line of
    // its own *(deep_tab_controls_grid_ckpt144)*: nothing up only while a pass runs may
    // move the controls under the picture.
    els.bar.title = els.progress.textContent;
    els.bar.style.setProperty("--done", String(running.done ?? 0));
    els.bar.dataset.state = running.sharpening ? "sharpening" : "rendering";
    // Idle is a class and not `hidden`, so the spinner keeps its place on the Render row.
    els.spinner.classList.toggle("is-idle", !running.live);
    // A dive's one bar and status line: its search, its landing, and then the pass that
    // draws where it landed, each a share of the bar (`DIVE_SPANS`).
    if (running.upto === "dive" || running.dive) {
      const [from, width] = DIVE_SPANS[running.dive ? "render" : (running.divePhase ?? "probe")];
      els.diveBar.style.setProperty("--done", String(from + width * (running.done ?? 0)));
      els.diveBar.dataset.state = running.sharpening ? "sharpening" : "rendering";
      // A loop drawing aside leads with its own count, since the main view says nothing of it.
      els.diveStatus.textContent = (running.lead ?? "") + els.progress.textContent;
    }
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
  async function render(upto, { auto = false, probe = !auto, dive = false, onStage = null } = {}) {
    const generation = ++pass;
    const grid = host.grid();
    readLog();
    // **Before the await, not after it.** The pool takes a moment to start on the first
    // render of a session — a fetch, a compile and a worker apiece — and a Render button
    // that stayed pressable through it would start a second pass on a second press.
    // `dive` is a pass the Dive block started, whose bar and Cancel follow it too.
    running = { upto, auto, dive, stage: "starting", started: performance.now(), done: 0 };
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

      // Read off the quarter pass once it has landed; the quarter pass itself asks for the
      // switch, which is what makes its reading the plain loop's too.
      let interior = true;
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
            interior: stage.name === "preview" ? true : interior,
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
        if (stage.name === "preview") interior = switchFor(field);
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
        drawnFull = stage.name === "full";
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
        hold(target, shaded, key, field, stage.name === "full");
        paint();
        host.settle();
        said(stage, field, shaded, cached, target);
        // What a caller wants done once a stage is up — the Dive block's New coloring on
        // arrival, off the quarter field — before the next stage is shaded in its colour.
        if (onStage !== null) {
          await onStage(stage);
          if (generation !== pass) return;
        }
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
      // The interior switch as the screen's quarter pass of this frame reads it, where
      // that pass is still held; the kernel's own default where it is not.
      const grid = host.grid();
      const quarter = fields.get(
        deepLink.fieldKey(target, grid.width / PREVIEW_DIVISOR, grid.height / PREVIEW_DIVISOR, 1),
      );
      const field = await deep.field(target, width, height, {
        supersample,
        interior: switchFor(quarter),
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
    if (step.phase === "classify") return `copy or bulb, ${step.done} of ${step.total}`;
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
  /** The best stage of `of` whose field is kept — the full pass, else the quarter — or
   *  `undefined` where neither is. */
  function keptStage(of) {
    const grid = host.grid();
    const stages = [
      { width: grid.width, height: grid.height, supersample: 1 },
      { width: grid.width / PREVIEW_DIVISOR, height: grid.height / PREVIEW_DIVISOR, supersample: 1 },
    ];
    return stages.find(
      (each) => fields.has(deepLink.fieldKey(of, each.width, each.height, each.supersample)),
    );
  }

  async function recolour(of = drawn) {
    if (of === null) return;
    const grid = host.grid();
    const stage = keptStage(of);
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
    const full = stage.width === grid.width && stage.height === grid.height;
    drawnFull = full;
    if (current && full) {
      finished = shaded.image;
      finishedSamples = 1;
    }
    if (current) hold(drawn, shaded, key, field, full);
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
    // Every change of frame comes through here, and Keep diving follows only its own
    // landings: a reader who moved the view has taken it back.
    endKeeping("Keep diving stopped: the view moved.");
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
    // bites, the width is the stop's and the centre stays where it is
    // *(explorer_shallow_deep_parity_ckpt144)*, so a zoom back in returns where this began.
    const stop = width > view.w.value ? outermost() : null;
    let held = false;
    if (stop !== null) {
      if (view.w.value >= stop.w) return false;
      held = width > stop.w;
      width = Math.min(width, stop.w);
    }
    const pull = held ? 0 : pullOf(width);
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
    const x = held ? view.x.dec : fx.add(view.x.dec, shiftAcross);
    const y = held ? view.y.dec : fx.add(view.y.dec, shiftDown);
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

  /**
   * Root (r): the set's home frame — the Mandelbrot or Multibrot set whole, or for a Julia
   * view the whole plane — which is the viewer's Root and the frame a zoom out stops at
   * the width of. The cap is the width's again unless the reader pinned one.
   */
  function rootOf(of) {
    const home = context.deepHome(deepLink.familyOf(of));
    const x = fx.parse(home.x);
    const y = fx.parse(home.y);
    if (x === null || y === null) return null;
    return {
      ...of,
      x: deepLink.coordinateOf(x),
      y: deepLink.coordinateOf(y),
      w: deepLink.widthOf(Number(home.w)),
    };
  }

  function atRoot() {
    const root = rootOf(view);
    return root === null || deepLink.fieldKey(root, 1, 1) === deepLink.fieldKey(view, 1, 1);
  }

  function toRoot() {
    const root = rootOf(view);
    if (root === null || atRoot()) return;
    view = pinned() ? root : { ...root, maxiter: policyCap(root.w.value), capFrom: "width" };
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

  // ----------------------------------------------------------------- find minibrots

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
   * Which view the list is for: `"deep"`, or `"shallow"` when the viewer's own Find minibrots
   * ran the search on its frame *(explorer_shallow_deep_parity_ckpt144)*. The list is one
   * element under the grid in both views, so a list goes when the view it was found in does.
   */
  let minibrotSide = "deep";

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

  /** The view one entry opens: its own centre, at thirty-two periods of its own nucleus
   *  (`renderer.openCap`). The palette and the shade recipe come with the reader, because a
   *  preview a reader cannot recognise as theirs is a different picture of the same place.
   *  `base` is the view searched, which is the tab's own unless the viewer asked.
   *
   *  **How wide depends on what it is** *(find_minibrots_bulbs_ckpt145)*. A copy is framed
   *  so that its body fills about a quarter of the height: by `measured` — the width its
   *  preview's body asked for — once the preview is drawn, and before that, or where the
   *  preview is never drawn or holds no usable body, by `renderer.copyWidth`, twelve sizes
   *  times the degree's calibrated factor. A bulb keeps twelve of its own sizes, which puts
   *  it on the edge of its parent. */
  function frameOf(nucleus, base = view) {
    const width =
      nucleus.measured ??
      (nucleus.kind === "bulb"
        ? renderer.tileWidth(nucleus.size)
        : renderer.copyWidth(nucleus.size, base.degree ?? 2));
    return {
      ...base,
      x: nucleus.x,
      y: nucleus.y,
      w: deepLink.widthOf(width),
      maxiter: renderer.openCap(nucleus.period, width),
      // Not the width's and not the reader's: the cap a minibrot's own period asks for,
      // written into the link like any settled cap.
      capFrom: "tile",
      julia: null,
    };
  }

  /** The frame an entry's preview tile is drawn at: the entry's own, at the tile's eight
   *  periods rather than the open frame's thirty-two. A preview is drawn unasked, and four
   *  times its cost would put most of a list past `TILE_BUDGET_MS`. */
  function previewOf(frame, nucleus) {
    return { ...frame, maxiter: renderer.tileCap(nucleus.period, frame.w.value) };
  }

  /** The list and its note gone, whoever they were for. */
  function dropList() {
    clearMinibrots();
    els.minibrotNote.hidden = true;
    minibrotSide = "deep";
  }

  function clearMinibrots() {
    if (minibrots === null) return;
    minibrots = null;
    minibrotSide = "deep";
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
   *
   * **The viewer's own Find minibrots is this search** *(explorer_shallow_deep_parity_ckpt144)*:
   * `from` is its view, carried across the floor exactly as entering the tab carries it,
   * and `pick` is where an entry goes when clicked — the viewer decides which of the two
   * views can draw it. With neither, it is the tab's own search on the tab's own frame.
   * Nothing about the tab's view moves either way, and the render bar and status the
   * viewer shows are its own: this writes only the tab's hidden Render line.
   */
  async function findMinibrots({ from = null, pick = null } = {}) {
    const target = from === null ? view : carry(from);
    if (target === null || target.julia !== null || running !== null) return;
    if (!MINIBROT_DEGREES.has(target.degree ?? 2)) return;
    const side = from === null ? "deep" : "shallow";
    const generation = ++pass;
    readLog();
    running = {
      upto: "minibrots",
      auto: false,
      side,
      stage: "searching",
      started: performance.now(),
      done: 0,
    };
    enterStage("starting", { live: false });
    activity("starting the deep renderer…", 0);
    syncControls();
    host.say("");
    dropList();

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
      // met. `nucleiNear` is that search, and the Dive block's too.
      const found = await nucleiNear(deep, target, generation);
      if (found === null || generation !== pass) return;

      const left = leftOutSaid(found);
      if (found.length === 0) {
        minibrotSide = side;
        els.minibrotNote.hidden = false;
        els.minibrotNote.textContent = `No minibrot was found in this view.${left}`;
        return;
      }

      minibrots = found;
      minibrotSide = side;
      show(found, target, pick);
      // **The unreachable ones are said rather than hidden.** A `dv` centre is capped at 64
      // characters, and a minibrot found in a view at 1e-n sits near 1e-2n — so below about
      // 1e-30 the best entries are places this site can find and cannot spell a link to.
      const reachable = found.filter((one) => spellable(one));
      const lost = found.length - reachable.length;
      els.minibrotNote.hidden = false;
      const bulbs = found[0].kind === "bulb";
      els.minibrotNote.textContent =
        (bulbs
          ? `No copy of the set in this view; ${found.length} satellite ` +
            `${found.length === 1 ? "bulb" : "bulbs"}, largest first.`
          : `${found.length} found, largest first.`) +
        (lost === 0
          ? ""
          : ` ${lost} of them ${lost === 1 ? "sits" : "sit"} deeper than a link can spell a ` +
            "center for, so they are listed without one.") +
        left;

      let tile = 0;
      for (const nucleus of reachable) {
        if (generation !== pass) return;
        tile += 1;
        const frame = previewOf(frameOf(nucleus, target), nucleus);
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
        // **A copy is framed by the body its preview holds** — the interior component
        // through the tile's centre, measured on the lanes before they are coloured — and
        // not by the size estimate, which gives a copy's scale and not its extent. The
        // entry is re-aimed at the width that puts that body at a quarter of the height.
        if (nucleus.kind !== "bulb") {
          const share = bodyShare(
            field.values,
            field.width * field.supersample,
            field.height * field.supersample,
          );
          if (share !== null) {
            nucleus.measured = (frame.w.value * share) / BODY_TARGET;
            aim(nucleus, target);
          }
        }
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
        // The viewer's bar is the viewer's picture, which a search for it never touched.
        if (side === "deep") host.showState(drawn === null ? "stopped" : "final");
        syncControls();
      }
      host.onSearch?.();
    }
  }

  /**
   * The minibrots in and around `target`, at a cap settled for the search alone — Find
   * minibrots' search, and the Dive block's. `null` where a newer generation took over.
   * `prefix` leads the Render line's words, and `phase` names the Dive block's share of its
   * bar as the search moves from the probe to the walk.
   */
  async function nucleiNear(deep, target, generation, { prefix = "", phase = null, budget, want, enough } = {}) {
    const grid = host.grid();
    const shareOf = (step) => (step.total > 0 ? step.done / step.total : null);
    if (phase !== null) running.divePhase = phase.probe;
    enterStage("probe");
    activity(`${prefix}finding the cap to search at…`, 0);
    const floor = await deep.settle(target, grid.width, grid.height, {
      supersample: 1,
      onStep: (step) => {
        if (generation !== pass) return;
        activity(
          `${prefix}finding the cap to search at · trying ${count(step.cap)} · ${said_step(step)}`,
          shareOf(step),
        );
      },
    });
    if (floor === null || generation !== pass) return null;
    const searched =
      floor.maxiter > target.maxiter ? { ...target, maxiter: floor.maxiter } : target;
    const looking =
      searched === target ? "looking for nuclei" : `looking for nuclei to ${count(floor.maxiter)}`;
    if (phase !== null) running.divePhase = phase.search;
    enterStage("searching");
    activity(`${prefix}${looking}…`, 0);
    const found = await deep.nuclei(searched, grid.width, grid.height, {
      supersample: 1,
      tileSamples: TILE.width,
      ...(budget === undefined ? {} : { budget }),
      ...(want === undefined ? {} : { want }),
      ...(enough === undefined ? {} : { enough }),
      onStep: (step) => {
        if (generation !== pass) return;
        activity(`${prefix}${looking} · ${said_step(step)}`, shareOf(step));
      },
    });
    if (found === null || generation !== pass) return null;
    return found;
  }

  /** Whether a `dv` link can carry this entry's frame — the same 64 characters every other
   *  coordinate on this site is held to. */
  function spellable(nucleus) {
    return (
      nucleus.x.text.length <= deepLink.COORDINATE_LIMIT &&
      nucleus.y.text.length <= deepLink.COORDINATE_LIMIT
    );
  }

  /** The list, as entries with nothing drawn in them yet, framed on `base` and sent to `pick`
   *  when clicked — or to this tab, where nobody else asked. */
  function show(found, base, pick) {
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
      nucleus.entry = entry;
      aim(nucleus, base);
      const seconds = tileSeconds(previewOf(nucleus.frame, nucleus).maxiter);
      well.textContent = !reachable
        ? "past what a link can spell"
        : seconds * 1000 > TILE_BUDGET_MS
          ? `a preview here is about ${said_time(seconds)}`
          : "";
      entry.append(well);

      const said = document.createElement("span");
      said.className = "minibrot-said";
      // A bulb is said to be one, and whose: the list offers bulbs only where the view
      // holds no copy, and an entry that called a disc on something's edge a minibrot
      // would be the promise this label exists to stop making.
      const what =
        nucleus.kind === "bulb"
          ? `bulb, period ${nucleus.period.toLocaleString("en-US")} on period ` +
            nucleus.parent.toLocaleString("en-US")
          : `period ${nucleus.period.toLocaleString("en-US")}`;
      said.textContent = `${what} · ${exponent(nucleus.size)} across`;
      entry.append(said);

      // **The frame this entry was aimed at**, and never one derived at click time: by
      // then `view` may have moved, and an entry that quietly re-aims is an entry that
      // sends a reader somewhere they were not shown. The one re-aim is its own preview
      // landing, which measures the copy the entry then goes to (`aim`).
      if (reachable) entry.addEventListener("click", () => (pick ?? swap)({ ...nucleus.frame }));
      nucleus.node = well;
      els.minibrotList.append(entry);
    }
  }

  /** Point an entry at the frame `frameOf` gives it now, and say so in its title. */
  function aim(nucleus, base) {
    const frame = frameOf(nucleus, base);
    nucleus.frame = frame;
    const what = nucleus.kind === "bulb" ? "bulb" : "minibrot";
    nucleus.entry.title = spellable(nucleus)
      ? `Go to this ${what}: ${frame.w.text} across, ${frame.maxiter.toLocaleString("en-US")} iterations.`
      : `This ${what}'s center needs more digits than a link carries, so the tab cannot open it.`;
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

  // ----------------------------------------------------------------- the dive
  //
  // **Search for minibrots near [A], then [dive into [B] | zoom out to symmetry point | save
  // those minibrots]** *(deep_dive_block_ckpt154; two slots since dive_slots_ckpt154)*. A is
  // where the search runs — the view, live until Here pins it, a pasted link, or a random
  // wallpaper — and B is what a dive carries into the copy it finds: nothing, which lands on
  // the copy's centre, a pinned view, a pasted link, or a random wallpaper. One press is Find
  // minibrots' search, the rung rule, a landing, and a pass of where it landed;
  // `perturb-wasm`'s `dive` module is the arithmetic, and `builder/README.md`'s *How the first
  // set was found* the method it formalises. What lands is an ordinary `dv=3` link with its
  // cap pinned, so a press is a navigation like a gallery tile and one step back undoes it;
  // the status line says where it came from, and nothing of that enters the link. Every
  // landing joins Dive results.

  /**
   * The copies this dive has landed on, how many rungs down it is, and the place it landed:
   * `{ place, rungs, depth }`, or `null`. **A press from that place is the next rung of the
   * same chain** — the rung rule holds the next copy to under an eighth of the last and away
   * from every earlier one, which is what keeps a view centred on the copy it just landed on
   * from finding that copy again. From anywhere else a press starts a chain of its own.
   *
   * **A mapped landing hands on its depth and not its copies.** It lands inside the copy's
   * neighbourhood on purpose, so every copy round it is within the distance that means "that
   * copy again", and a press from there refused every one of them. Its copy is not what the
   * view is centred on, so the next press reads the view afresh.
   */
  let chain = null;
  /** Landings the budget refused at one place, by key: `{ place, reasons }`. Greyed while A
   *  stands there, with the sentence as the reason. The keys are `center`, `halfway`, and
   *  `carried:<place>` for a view B carries. */
  let refusedAt = null;
  /** What the Dive block's status line says at rest: the last press's provenance, or why it
   *  did not land. */
  let diveSaid = "";
  /** Whether a landing takes a New coloring as it arrives. */
  let diveColouring = storedFlag(DIVE_COLOURING);
  /**
   * **Keep diving** *(keep_diving_ckpt154)*: `keepDiving`'s loop object while it is on — the
   * hold's timer, the frozen `anchor`, whether it draws `aside`, its count — and `null`. The
   * object is the loop's own generation — a loop that finds `keeping` is no longer the object
   * it started with has been stopped, whatever else happened. Not remembered: a page that
   * starts searching on its own the moment it opens is a surprise.
   */
  let keeping = null;
  /** A press of Go still running, so that Keep diving ticked during it takes that press as
   *  its first rather than cancelling it to start again. */
  let pressing = null;

  /**
   * **The two slots** *(dive_slots_ckpt154)*. `mode` is the lit button. `view` is the frame
   * a pinned Here or a Paste holds, as a deep view — `null` for A on Here while it is live,
   * and for None and Random. `picture` is that frame's thumbnail once drawn (a canvas), and
   * `failed` why it could not be; `shows` is what the thumbnail was last painted from, so a
   * sync repaints only what changed. `pasting` is whether the paste field is open, because
   * the clipboard could not be read.
   */
  const slots = { a: slotOf(els.diveA, "A", "here"), b: slotOf(els.diveB, "B", "none") };

  function slotOf(root, name, mode) {
    const thumb = root.querySelector(".dive-thumb");
    return {
      name,
      mode,
      view: null,
      picture: null,
      failed: null,
      shows: null,
      pasting: false,
      els: {
        root,
        thumb,
        canvas: thumb.querySelector("canvas"),
        img: thumb.querySelector("img"),
        said: thumb.querySelector(".dive-thumb-said"),
        modes: [...root.querySelectorAll(".dive-modes button")],
        paste: root.querySelector(".dive-paste"),
      },
    };
  }

  /** The slots as `dives.js`'s rules read them. */
  function shapeOf(slot) {
    return { mode: slot.mode, pinned: slot.view !== null };
  }

  /** The place a view stands on — its set, centre and width, and not its cap or colour. */
  function placeOf(of) {
    return deepLink.fieldKey({ ...of, maxiter: 0 }, 1, 1);
  }

  /** A plane as a sentence names it. */
  function planeWords(of) {
    const degree = of.degree ?? 2;
    return degree === 2 ? "the Mandelbrot set" : `Multibrot ${degree}`;
  }

  /** Why the Dive block cannot run on this view, or `null`. */
  function diveBarred() {
    if (view.julia !== null) {
      return (
        "Dive finds minibrots, which live on the Mandelbrot and Multibrot planes and not in a " +
        "Julia set. Back to the Mandelbrot set (j) first."
      );
    }
    if (!MINIBROT_DEGREES.has(view.degree ?? 2)) {
      return "Dive works on the Mandelbrot set and the Multibrot sets of degrees 3 to 6.";
    }
    return null;
  }

  /** Why a slot's frame cannot be used from this view, or `null`: it holds a view on another
   *  plane, which a plane change since it was pinned or pasted leaves behind. */
  function slotBarred(slot) {
    if (slot.view === null || deepLink.familyOf(slot.view) === deepLink.familyOf(view)) return null;
    return (
      `${slot.name} holds a view on ${planeWords(slot.view)}, and this view is on ` +
      `${planeWords(view)}. Choose ${slot.name} again on this plane.`
    );
  }

  /** The place A stands on for the budget's greys, or `null` where A is a random draw, which
   *  may fit where another did not. */
  function placeOfA(here = view) {
    if (slots.a.mode === "random") return null;
    return placeOf(slots.a.view ?? here);
  }

  /** What a landing is keyed by in `refusedAt`: the symmetry point, the centre, or the view
   *  B carries. */
  function greyKey(action, b) {
    if (action === "halfway") return "halfway";
    if (b.mode === "none") return "center";
    return b.view === null ? null : `carried:${placeOf(b.view)}`;
  }

  /** Why a landing is greyed where A stands, or `null`: the budget refused it there already,
   *  or the view B carries asks for more than the ceiling in even a period-2 copy. */
  function landingBarred(action, b = slots.b) {
    if (action === "save") return null;
    if (action === "into" && b.view !== null && 2 * b.view.maxiter > deepLink.CAP_LIMIT) {
      return (
        `The view B carries is drawn at ${count(b.view.maxiter)} iterations, and carried into ` +
        `even a period-2 copy it would ask for ${count(2 * b.view.maxiter)}, past the ` +
        `${count(deepLink.CAP_LIMIT)} ceiling.`
      );
    }
    const place = placeOfA();
    const key = greyKey(action, b);
    if (place === null || key === null || refusedAt?.place !== place) return null;
    return refusedAt.reasons[key] ?? null;
  }

  /** Why Go cannot run the sentence as it stands, or `null`. */
  function pressBarred() {
    const action = els.diveAction.value;
    return (
      diveBarred() ??
      slotBarred(slots.a) ??
      (action === "into" ? slotBarred(slots.b) : null) ??
      landingBarred(action)
    );
  }

  /** Why no rung was taken, as the status line says it. */
  function refusalSaid(picked, where, landing) {
    if (picked.refusal === "no_copy") return `No minibrot was found near ${where}.`;
    if (picked.refusal === "none_smaller") {
      return `No copy near ${where} is a step down from where the dive stands.`;
    }
    const called = landing === "center" ? "its center" : landing === "halfway" ? "its symmetry point" : "that view";
    return (
      `The nearest copy a step down, period ${count(picked.period)}, needs ` +
      `${count(picked.need)} iterations for ${called}, past the ${count(deepLink.CAP_LIMIT)} ` +
      "ceiling."
    );
  }

  /**
   * **What the root test could not read**, as a sentence the status line appends, each one
   * logged with its reason *(dive_primitive_only_ckpt154)*. `nuclei::classify` calls a nucleus
   * a copy only where every root it has was solved and none collapsed; a reading it could not
   * finish is not a copy and is never landed on or listed, and this is where that is said
   * rather than hidden. Empty where nothing was left out.
   */
  function leftOutSaid(found) {
    const left = found?.unresolved ?? [];
    for (const one of left) log("nucleus left out", one);
    if (left.length === 0) return "";
    return ` Left out ${left.length === 1 ? "one nucleus" : `${count(left.length)} nuclei`} the root test could not read.`;
  }

  /** Of `list`, the nucleus nearest `of`'s centre in the larger coordinate, or `null`. */
  function nearest(list, of) {
    let best = null;
    let apart = Infinity;
    for (const one of list) {
      const far = Math.max(
        Math.abs(fx.difference(one.x.dec, of.x.dec)),
        Math.abs(fx.difference(one.y.dec, of.y.dec)),
      );
      if (far < apart) {
        best = one;
        apart = far;
      }
    }
    return best;
  }

  /** A random wallpaper of this plane, as a deep view with the geometry and cap its link
   *  gives — the seat's colour is never used — or `null` where the gallery has none. */
  async function seatOf(family) {
    const seat = await host.randomSeat(family);
    if (seat === null) return null;
    const carried = carry(seat.view);
    return carried === null ? null : { key: seat.key, view: carried };
  }

  /** A slot's fixed frame, in a sentence. */
  function slotWords(slot) {
    return slot.mode === "paste" ? `the pasted view (${slot.name})` : `the pinned view (${slot.name})`;
  }

  /**
   * Where A says to search: `{ near, where, random }`, drawing a wallpaper where A is on
   * Random, or `{ why, permanent }` where it has none. `null` where a newer generation took
   * over. `here` is what a live A means: the view, or the view Keep diving froze.
   */
  async function nearOf(a, family, generation, here) {
    if (a.mode === "random") {
      const seat = await seatOf(family);
      if (generation !== pass) return null;
      if (seat === null) return { why: "No wallpaper in the gallery is on this plane.", permanent: true };
      return { near: seat.view, where: `wallpaper ${seat.key}`, random: true };
    }
    if (a.view !== null) return { near: a.view, where: slotWords(a), random: false };
    return { near: here, where: "this view", random: false };
  }

  /** The frame a landing answer names, as a view in this tab's colour, or `null` where its
   *  centre is past what a link can spell. */
  function frameOfAnswer(answer, degree, here) {
    try {
      const x = fx.parse(answer.re);
      const y = fx.parse(answer.im);
      if (x === null || y === null) throw new Error("unreadable");
      const frame = {
        version: deepLink.VERSION,
        degree,
        julia: null,
        x: deepLink.coordinateOf(x),
        y: deepLink.coordinateOf(y),
        w: deepLink.widthOf(answer.width),
        maxiter: answer.cap,
        // The cap a copy's own period asks for, written into the link as a found minibrot's is.
        capFrom: "tile",
        aspect: here.aspect,
        palette: view.palette,
        shade: view.shade,
        level: view.level,
      };
      deepLink.parse(`?${deepLink.emit(frame)}`, context);
      return frame;
    } catch {
      return null;
    }
  }

  /**
   * One attempt at a press of *dive into* or *zoom out to symmetry point*: find the copy,
   * take the rung, land. Resolves `null` where a newer generation took over, `{ why, grey }`
   * where nothing landed, and `{ frame, chain, said }` where it did.
   *
   * `a` and `b` are the slots as the press read them; `here` is what a live A means — the
   * view, for Go and for the descending loop, and the view Keep diving was ticked on for
   * every other loop *(keep_diving_anchor_ckpt154)*. The colour is always the view's.
   */
  async function diveOnce(deep, generation, { a, action, b }, here = view) {
    const family = deepLink.familyOf(here);
    const degree = here.degree ?? 2;
    const from = await nearOf(a, family, generation, here);
    if (from === null) return null;
    if (from.near === undefined) return { why: from.why, permanent: from.permanent };
    const { near } = from;
    let where = from.where;
    let into = null;
    let intoWords = "";
    if (action === "into" && b.mode === "random") {
      const seat = await seatOf(family);
      if (generation !== pass) return null;
      if (seat === null) return { why: "No wallpaper in the gallery is on this plane.", permanent: true };
      into = seat.view;
      intoWords = `wallpaper ${seat.key}`;
    } else if (action === "into" && b.mode !== "none") {
      into = b.view;
      intoWords = slotWords(b);
    }
    const landing = action === "halfway" ? "halfway" : into === null ? "center" : "mapped";
    // A mapped landing's count is its view's own cap: that view carried into a period-`p`
    // copy escapes after about `p` times its own counts.
    const periods = into !== null ? into.maxiter : deep.landingPeriods(landing);
    if (into !== null && 2 * periods > deepLink.CAP_LIMIT) {
      return {
        why:
          `${intoWords[0].toUpperCase()}${intoWords.slice(1)} is drawn at ${count(periods)} ` +
          "iterations, too many to carry into any copy under the ceiling.",
      };
    }
    const prefix = `near ${where} · `;
    const continuing = !from.random && chain !== null && chain.place === placeOf(near);
    const rungs = continuing ? chain.rungs : [];
    const depth = continuing ? chain.depth : 0;
    // **A mapped landing looks further out before it gives up on the budget**: a view carried
    // into a period-`p` copy needs `p` times its own cap, which near a wallpaper's own narrow
    // frame is almost never there — its copies run to hundreds. The lower periods are the
    // larger copies round it, so the search widens about the same centre, `WIDEN` times at a
    // step, and says so. A press with an earlier rung to step down from never widens.
    const widths = into !== null && rungs.length === 0 ? WIDEN : [1];
    let found = null;
    let searched = near;
    let picked = null;
    for (const factor of widths) {
      const wide = near.w.value * factor;
      if (factor > 1 && wide > outermost()?.w) break;
      searched =
        factor === 1
          ? near
          : { ...near, w: deepLink.widthOf(wide), maxiter: policyCap(wide), capFrom: "width" };
      const asked = searched;
      found = await nucleiNear(deep, searched, generation, {
        prefix: factor === 1 ? prefix : `${prefix}${factor} times wider · `,
        phase: { probe: "probe", search: "search" },
        budget: 24,
        want: 12,
        // The rung rule's answer is settled once every copy larger than the one it takes has
        // been read, so the reading stops there (`renderer.nuclei`'s `enough`).
        enough: (list) => deep.pick(asked, list, rungs, periods).index != null,
      });
      if (found === null) return null;
      picked = deep.pick(searched, found, rungs, periods);
      if (!picked.ok) throw new Error(picked.why);
      if (picked.refusal !== "over_budget") break;
    }
    const left = leftOutSaid(found);
    if (picked.index === null) {
      return {
        why: refusalSaid(picked, where, landing) + left,
        refusal: picked.refusal,
        // The budget is this place's to fail only where the count is: a random wallpaper,
        // on either side, may fit where this one did not.
        grey: picked.refusal === "over_budget" && !from.random && b.mode !== "random" ? greyKey(action, b) : null,
      };
    }
    if (searched !== near) where += `, searched ${count(searched.w.value / near.w.value)} times wider`;
    const copy = found[picked.index];
    const base = {
      degree,
      re: copy.x.text,
      im: copy.y.text,
      period: copy.period,
      size_log2: copy.sizeLog2,
    };
    let request;
    if (landing === "center") request = { landing: "center", ...base };
    else if (landing === "halfway") request = { landing: "halfway", ...base, found_in: near.w.value };
    else {
      // **Placed by a nucleus near the view**, whose copy inside this one the shooting finds
      // exactly — the first-order place misses by the tuning's nonlinearity, which is
      // thousands of frames once the view is narrow. The search just run is round that view
      // already where the view is the one searched; anywhere else it is searched too.
      let around = found;
      if (into !== searched) {
        around = await nucleiNear(deep, into, generation, {
          prefix: `around ${intoWords} · `,
          phase: { probe: "anchorProbe", search: "anchor" },
          budget: 24,
          want: 12,
        });
        if (around === null) return null;
      }
      const anchor = nearest(around, into);
      request = {
        landing: "mapped",
        ...base,
        view_re: into.x.text,
        view_im: into.y.text,
        view_width: into.w.value,
        count: periods,
        ...(anchor === null
          ? {}
          : { anchor_re: anchor.x.text, anchor_im: anchor.y.text, anchor_period: anchor.period }),
      };
    }
    running.divePhase = "land";
    enterStage("landing");
    activity(`${prefix}landing…`, 0);
    const answer = await deep.land(request, {
      onProgress: (done, total) => {
        if (generation === pass) {
          activity(`${prefix}placing it · shooting step ${done + 1}`, total > 0 ? done / total : null);
        }
      },
    });
    if (answer === null || generation !== pass) return null;
    if (!answer.ok) return { why: answer.why };

    // **An ordinary link, or nowhere**: the frame goes through the contract's own reader, so a
    // centre past what a link can spell is refused here rather than landed on and stranded.
    const frame = frameOfAnswer(answer, degree, here);
    if (frame === null) return { why: `The copy near ${where} lands deeper than a link can spell a center.` };
    const placed =
      request.landing !== "mapped"
        ? ""
        : `, turned ${Math.round(answer.turn)}°, ` +
          (answer.twin_period === null
            ? "placed to first order"
            : `placed by its period-${count(answer.twin_period)} twin`);
    const landed =
      landing === "center" ? "at its center" : landing === "halfway" ? "at its symmetry point" : `with ${intoWords} inside it`;
    const said =
      `${planeWords(here)[0].toUpperCase()}${planeWords(here).slice(1)} · a period-${count(copy.period)} ` +
      `copy ${exponent(copy.size)} across near ${where}, rung ${depth + 1} · landed ${landed}${placed} · ` +
      `${count(answer.cap)} iterations.${left}`;
    const next = request.landing === "mapped" ? [] : [...rungs, copy];
    return { frame, chain: { place: placeOf(frame), rungs: next, depth: depth + 1 }, said };
  }

  /**
   * **Save those minibrots** *(dive_slots_ckpt154)*: the copies near A, largest first, each
   * framed at its centre the way *dive into* with B on None frames one — `SAVE_COUNT` of
   * them, skipping a bulb, a copy past what a link can spell, and one whose landing is past
   * the ceiling. Resolves `null` where a newer generation took over, `{ why }` where none
   * would do, and `{ landings: [{ frame, said }], where }` otherwise.
   */
  async function saveOnce(deep, generation, { a }, here = view) {
    const family = deepLink.familyOf(here);
    const degree = here.degree ?? 2;
    const from = await nearOf(a, family, generation, here);
    if (from === null) return null;
    if (from.near === undefined) return { why: from.why, permanent: from.permanent };
    const prefix = `near ${from.where} · `;
    const found = await nucleiNear(deep, from.near, generation, {
      prefix,
      phase: { probe: "probe", search: "search" },
      budget: 24,
      want: 12,
    });
    if (found === null) return null;
    // **The copies Go would take**, in the order it would take them: `dive::pick` asked again
    // and again with each copy it answered struck out, so a batch holds the same rung rule a
    // press does — a copy framed at under half the view's width, whose landing fits the
    // ceiling — and never the body the view is itself centred on. A centre past what a link
    // can spell is struck out before it is asked.
    const periods = deep.landingPeriods("center");
    const offered = found.map((one) => (spellable(one) ? one : { ...one, kind: "bulb" }));
    const copies = [];
    let refused = null;
    while (copies.length < SAVE_COUNT) {
      const picked = deep.pick(from.near, offered, [], periods);
      if (!picked.ok) throw new Error(picked.why);
      if (picked.index === null) {
        refused = picked;
        break;
      }
      copies.push(found[picked.index]);
      offered[picked.index] = { ...offered[picked.index], kind: "bulb" };
    }
    const left = leftOutSaid(found);
    if (copies.length === 0) {
      return { why: refusalSaid(refused, from.where, "center") + left, refusal: refused.refusal };
    }
    running.divePhase = "land";
    enterStage("landing");
    const landings = [];
    for (const [at, copy] of copies.entries()) {
      activity(`${prefix}framing ${at + 1} of ${copies.length}…`, at / copies.length);
      const answer = await deep.land({
        landing: "center",
        degree,
        re: copy.x.text,
        im: copy.y.text,
        period: copy.period,
        size_log2: copy.sizeLog2,
      });
      if (answer === null || generation !== pass) return null;
      if (!answer.ok) continue;
      const frame = frameOfAnswer(answer, degree, here);
      if (frame === null) continue;
      const said =
        `${planeWords(here)[0].toUpperCase()}${planeWords(here).slice(1)} · a period-${count(copy.period)} ` +
        `copy ${exponent(copy.size)} across near ${from.where}, ${at + 1} of the ${copies.length} ` +
        `largest · framed at its center · ${count(answer.cap)} iterations.`;
      landings.push({ frame, said });
    }
    if (landings.length === 0) return { why: `No copy near ${from.where} could be framed.${left}` };
    return { landings, where: from.where, random: from.random, left };
  }

  /**
   * **Go.** Search, take the rung, land, draw — Cancel stops any of it, and what lands is a
   * link the way back remembers as one step. The palette stays the reader's unless *New
   * coloring on arrival* is ticked, which colours the landing off its quarter pass. *Save
   * those minibrots* moves nothing: its landings are drawn off-screen into Dive results.
   *
   * `aside` is Keep diving's loop object where the loop draws off-screen
   * *(keep_diving_anchor_ckpt154)*: the press reads a live A as `aside.anchor`, lands through
   * `landAside` rather than `arrive`, and leaves the view, the way back, the address and the
   * main picture exactly as they were. It runs on with the tab hidden, so it touches nothing
   * of the viewer's either.
   */
  async function dive({ aside = null } = {}) {
    const barred = pressBarred() ?? (running?.upto === "download" ? "A download is running." : null);
    if (barred !== null) {
      syncControls();
      return { barred };
    }
    const action = els.diveAction.value;
    const sentence = {
      a: { name: "A", mode: slots.a.mode, view: slots.a.view },
      action,
      b: { name: "B", mode: slots.b.mode, view: slots.b.view },
    };
    const batch = action === "save";
    // A batch draws aside whoever pressed it: it is several landings, and none of them is
    // where the reader asked to go.
    const drawAside = aside ?? (batch ? { anchor: null, lead: () => "" } : null);
    if (running !== null) stop();
    if (drawAside === null) disarm();
    const generation = ++pass;
    readLog();
    running = {
      upto: "dive",
      auto: false,
      aside: aside !== null,
      lead: aside === null ? null : aside.lead(),
      stage: "starting",
      started: performance.now(),
      done: 0,
      divePhase: "probe",
    };
    enterStage("starting", { live: false });
    activity("starting the deep renderer…", 0);
    syncControls();
    if (aside === null) host.say("");
    if (aside === null || minibrotSide === "deep") dropList();
    let landed = null;
    let outcome = SUPERSEDED;
    const here = aside?.anchor ?? view;
    const random = draws(shapeOf(slots.a), action, shapeOf(slots.b));
    try {
      const deep = await pool();
      if (generation !== pass) return SUPERSEDED;
      readLog();
      if (aside === null || owns) unsettle();
      const tries = random ? RANDOM_TRIES : 1;
      let why = "";
      for (let attempt = 1; attempt <= tries && landed === null; attempt++) {
        const tried = batch
          ? await saveOnce(deep, generation, sentence, here)
          : await diveOnce(deep, generation, sentence, here);
        if (tried === null || generation !== pass) return SUPERSEDED;
        if (tried.frame !== undefined || tried.landings !== undefined) {
          landed = tried;
        } else {
          why = tried.why;
          // Whether the next press may land where this one did not: a random wallpaper drawn
          // again may, unless the plane has none or the copy near a fixed place was the one
          // that ran out.
          const chainOut = sentence.a.mode !== "random" && ["none_smaller", "no_copy"].includes(tried.refusal);
          outcome = { refused: tried.why, random: random && !chainOut, permanent: tried.permanent === true };
          if (tried.grey) {
            const place = placeOfA(here);
            const reasons = refusedAt?.place === place ? refusedAt.reasons : {};
            refusedAt = { place, reasons: { ...reasons, [tried.grey]: tried.why } };
          }
        }
      }
      if (landed === null) {
        diveSaid = tries > 1 ? `Tried ${tries} random wallpapers and none would do. ${why}` : why;
        outcome = { ...outcome, refused: diveSaid };
      }
      if (landed !== null && batch) return await saveAside(deep, generation, landed, drawAside);
      if (landed !== null && aside !== null) return await landAside(deep, generation, landed, aside);
    } catch (error) {
      diveSaid = String(error.message ?? error);
      outcome = { error: diveSaid };
      console.error("the dive failed", { view: deepLink.emit(view) }, error);
    } finally {
      // A press that landed on screen hands `running` to `arrive`'s pass; one that landed
      // aside, or nowhere, ends here.
      if (generation === pass && (landed === null || drawAside !== null)) {
        running = null;
        watch();
        if (aside === null) host.showState(drawn === null ? "stopped" : "final");
        syncControls();
      }
    }
    if (generation !== pass) return SUPERSEDED;
    if (landed === null || drawAside !== null) return outcome;
    chain = landed.chain;
    diveSaid = landed.said;
    const complete = await arrive(landed.frame, landed.said);
    return { landed: true, complete };
  }

  /** What a press answers where something else took the tab over before it was done. */
  const SUPERSEDED = { superseded: true };

  /**
   * Put a landing up the way a link is put up, and draw it: the quarter pass, the full one,
   * and — where it is ticked — a New coloring off the quarter field before the full one is
   * shaded, so the full pass lands in it.
   *
   * Resolves once the pass has ended, however it ended, and says whether it drew the landing
   * to the end. **Whatever of the landing reached the canvas joins Dive results** — the full
   * picture where the pass finished, the quarter one where it was stopped after that — and a
   * landing stopped before anything of it was shown joins nothing, because nobody saw it.
   */
  async function arrive(frame, said) {
    cameFrom = null;
    view = frame;
    drawn = null;
    stale = null;
    settledAt = null;
    clearMinibrots();
    paint();
    syncControls();
    host.settle();
    stat("");
    host.showState("stopped");
    const onStage = diveColouring
      ? async (stage) => {
          if (stage.name === "preview") await host.newColoring?.({ inPlace: true });
        }
      : null;
    // `render` takes its generation before its first await, so `pass` just after the call
    // is this pass's, and a pass still current when it resolves was not taken over.
    const rendering = render("screen", { probe: false, dive: true, onStage });
    const mine = pass;
    await rendering;
    const place = placeOf(frame);
    if (stale !== null && placeOf(stale.view) === place) {
      host.onLanded?.({ link: deepLink.emit(stale.view), canvas: stale.canvas, said });
    }
    return mine === pass && drawn !== null && drawnFull && placeOf(drawn) === place;
  }

  /**
   * **A landing drawn off-screen** *(keep_diving_anchor_ckpt154)*: the pass `render` would
   * draw of it — the quarter pass, which reads the interior switch and is what *New coloring
   * on arrival* is sized off, and the full pass at the canvas's own size and one sample a
   * pixel — into a canvas of its own, which joins Dive results exactly as an on-screen
   * landing's does. So a result is the same picture whichever way its landing was drawn, and
   * the one thing skipped is shading the quarter pass nobody sees.
   *
   * Nothing of the tab moves: not `view`, `drawn`, the held pictures, the field cache or the
   * address. The colour is the view's as it stands when the full pass is shaded, or the one
   * New coloring draws for this landing alone through `host.coloringFor`, which tints
   * nothing. Resolves `{ landed, complete, results }` — the list's size once it has joined —
   * or `SUPERSEDED`.
   */
  async function landAside(deep, generation, landed, aside) {
    const grid = host.grid();
    const stages = [
      { name: "preview", width: grid.width / PREVIEW_DIVISOR, height: grid.height / PREVIEW_DIVISOR, supersample: 1 },
      { name: "full", width: grid.width, height: grid.height, supersample: 1 },
    ];
    running.dive = true;
    running.stages = stages;
    if (aside.lead !== undefined) running.lead = aside.lead();
    const drawnFields = {};
    let interior = true;
    for (const stage of stages) {
      const span = spanOf(stage);
      running.sharpening = stage.name === "full";
      enterStage(stage.name);
      activity(`${said_stage(stage)}…`, span.from);
      const field = await deep.field(landed.frame, stage.width, stage.height, {
        supersample: 1,
        interior: stage.name === "preview" ? true : interior,
        onProgress: (done, elapsed) => {
          if (generation === pass) report(stage, done, elapsed);
        },
        onStep: (step) => {
          if (generation === pass) activity(`${said_stage(stage)} · ${said_step(step)}`, span.from);
        },
      });
      if (field === null || generation !== pass) return SUPERSEDED;
      if (stage.name === "preview") interior = switchFor(field);
      drawnFields[stage.name] = field;
    }
    let frame = inColour(landed.frame);
    if (diveColouring) {
      enterStage("coloring", { live: false });
      activity("choosing a new coloring…", 1);
      const drawnColour = await host.coloringFor?.(drawnFields.preview, frame);
      if (generation !== pass) return SUPERSEDED;
      if (drawnColour != null) frame = { ...frame, ...drawnColour };
    }
    enterStage("coloring", { live: false });
    activity(`${said_stage(stages[1])} · coloring`, 1);
    const holder = {};
    colouring = holder;
    const shaded = await deep.shade(drawnFields.full, frame, holder, { derive: host.deriving() });
    if (shaded === null || generation !== pass) return SUPERSEDED;
    if (host.deriving()) frame = { ...frame, level: shaded.level };
    log("landed aside", {});
    const canvas = document.createElement("canvas");
    canvas.width = shaded.image.width;
    canvas.height = shaded.image.height;
    canvas.getContext("2d").putImageData(shaded.image, 0, 0);
    const results = await host.onLanded?.({ link: deepLink.emit(frame), canvas, said: landed.said });
    return { landed: true, complete: true, results: results ?? null };
  }

  /** *Save those minibrots*' landings, each drawn off-screen into Dive results in turn, led
   *  on the status line by which one it is. Resolves as `landAside` does, with `saved`. */
  async function saveAside(deep, generation, batch, aside) {
    const lead = aside.lead?.() ?? "";
    let results = null;
    for (const [at, one] of batch.landings.entries()) {
      const drawnAside = await landAside(deep, generation, one, {
        lead: () => `${lead}Saving ${at + 1} of ${batch.landings.length}: `,
      });
      if (drawnAside.superseded) return SUPERSEDED;
      results = drawnAside.results;
    }
    const saved = batch.landings.length;
    diveSaid =
      `Saved ${saved === 1 ? "one copy" : `the ${saved} largest copies`} near ${batch.where} to ` +
      "Dive results" + (results === null ? "." : `, which holds ${results}.`) + (batch.left ?? "");
    return { landed: true, complete: true, results, saved: batch.landings.length };
  }

  /** Go: one press, remembered while it runs so Keep diving can take it over. */
  function press() {
    const ongoing = dive();
    pressing = ongoing;
    ongoing.finally(() => {
      if (pressing === ongoing) pressing = null;
    });
    return ongoing;
  }

  /**
   * **Keep diving** *(keep_diving_ckpt154; anchored since keep_diving_anchor_ckpt154)*: press,
   * land, press again, with fresh draws each time. `loopStep` in `dives.js` says what each
   * press's answer means for the next, and `keepable` where it may run at all: a slot on
   * Random, or the descent.
   *
   * **A live A is frozen when the box is ticked** — `anchor`, the view then, or the one a Go
   * already running leaves, since that press finishes as the Go it was. Every press reads it
   * as A, draws its landing off-screen (`landAside`) and adds it to Dive results, and the
   * main view, the way back and the address stay put. **The descent is the exception**
   * (`chains`): a live A and a centred landing press from the last landing, on screen, each
   * landing held `HOLD_MS` and one step back.
   *
   * It stops on its own where a chain runs out or a press cannot start, and it is stopped by
   * the box, Cancel, a change of view (`moved`, which every gesture and every control that
   * moves the frame goes through) or of the sentence, and by anything else that takes the
   * tab over — a link, the way back — which is a press superseded. Since a loop drawing
   * aside never moves the view, a moved view is always the reader's. A descending loop also
   * stops on leaving the tab; one drawing aside runs on, so that Dive results can fill while
   * the reader is elsewhere.
   */
  async function keepDiving() {
    const action = els.diveAction.value;
    const batch = action === "save";
    const mine = {
      timer: 0,
      wake: null,
      holding: false,
      anchor: null,
      aside: !chains(shapeOf(slots.a), action, shapeOf(slots.b)),
      landings: 0,
      results: null,
      saved: null,
      /** What the status line leads with while a press of this loop runs. */
      lead() {
        const next = `${batch ? "Round" : "Dive"} ${this.landings + 1}: `;
        return this.landings === 0 ? next : `${landedSaid(this.landings, this.results, this.saved)} ${next}`;
      },
    };
    keeping = mine;
    syncControls();
    let dry = 0;
    let first = pressing;
    while (keeping === mine) {
      if (first === null) {
        mine.anchor ??= view;
        // A loop drawing aside stands on its anchor; a view that is somewhere else was moved.
        if (mine.aside && placeOf(view) !== placeOf(mine.anchor)) {
          return endKeeping("Keep diving stopped: the view moved.");
        }
      }
      const aside = first === null && mine.aside;
      const outcome = await (first ?? dive(aside ? { aside: mine } : {}));
      first = null;
      if (keeping !== mine) {
        // Unticked mid-press: the press finished as the one it was, and is counted.
        if (aside && outcome.landed) {
          diveSaid = `${landedSaid(mine.landings + 1, outcome.results, outcome.saved ?? null)} Keep diving stopped.`;
          syncControls();
        }
        return;
      }
      const next = loopStep(outcome, dry, { aside });
      if (outcome.landed && aside) {
        mine.landings += 1;
        mine.results = outcome.results;
        mine.saved = outcome.saved ?? null;
        diveSaid = landedSaid(mine.landings, mine.results, mine.saved);
      }
      if (next.stop !== undefined) {
        return endKeeping(outcome.landed && aside ? `${diveSaid} ${next.stop}` : next.stop);
      }
      dry = outcome.landed ? 0 : dry + 1;
      if (!next.hold) continue;
      const at = pass;
      const place = placeOf(view);
      mine.holding = true;
      syncControls();
      await new Promise((resolve) => {
        mine.wake = resolve;
        mine.timer = setTimeout(resolve, HOLD_MS);
      });
      mine.holding = false;
      if (keeping !== mine) return;
      if (pass !== at || placeOf(view) !== place) return endKeeping("Keep diving stopped: the view changed.");
    }
  }

  /**
   * The tab giving up the canvas: what it was drawing stops, except the viewer's own search,
   * which runs on where it was started, and **a Keep diving loop drawing aside**
   * *(keep_diving_anchor_ckpt154)*, which draws nothing on the canvas and runs on. A loop on
   * screen follows its landings in the main view and never out of sight, so it stops, saying
   * `said`.
   */
  function leaving(said) {
    const aside = keeping?.aside === true && (running === null || running.aside === true);
    if (!aside) endKeeping(said);
    if (running?.side !== "shallow" && running?.aside !== true) stop();
  }

  /** Stop Keep diving where it is on, saying why, and untick the box. A press in flight is
   *  left to finish, the way a press of Go would be; Cancel is what stops that. */
  function endKeeping(said = null) {
    if (keeping === null) return;
    clearTimeout(keeping.timer);
    keeping.wake?.();
    keeping = null;
    if (said !== null) diveSaid = said;
    syncControls();
  }

  // ------------------------------------------------------------------ the slots' pictures

  /** Paint `source` over a slot's canvas, cropped to fill it. */
  function paintThumb(slot, source) {
    const canvas = slot.els.canvas;
    const ink = canvas.getContext("2d");
    ink.fillStyle = "#000";
    ink.fillRect(0, 0, canvas.width, canvas.height);
    if (source === null) return;
    const scale = Math.max(canvas.width / source.width, canvas.height / source.height);
    const width = source.width * scale;
    const height = source.height * scale;
    ink.imageSmoothingQuality = "high";
    ink.drawImage(source, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height);
  }

  /** A copy of a canvas, so a slot's picture outlives the one it was taken from. */
  function copyOf(source) {
    const canvas = document.createElement("canvas");
    canvas.width = source.width;
    canvas.height = source.height;
    canvas.getContext("2d").drawImage(source, 0, 0);
    return canvas;
  }

  /** Pin the view as a slot's frame, with the picture on screen where it is this frame's. */
  function pin(slot) {
    slot.mode = "here";
    slot.view = view;
    slot.failed = null;
    slot.picture = stale !== null && !pending() && placeOf(stale.view) === placeOf(view) ? copyOf(stale.canvas) : null;
  }

  /**
   * The home view of `family`'s plane, for a slot on Random where no plate was baked: the
   * set's outermost frame, as the tab's own home names it.
   */
  function homeOf(family) {
    const home = context.deepHome(family);
    const x = fx.parse(home.x);
    const y = fx.parse(home.y);
    if (x === null || y === null) return null;
    const degree = family === "mandelbrot" ? 2 : Number(family.replace("multibrot", ""));
    const width = Number(home.w);
    return {
      ...view,
      degree,
      julia: null,
      x: deepLink.coordinateOf(x),
      y: deepLink.coordinateOf(y),
      w: deepLink.widthOf(width),
      maxiter: policyCap(width),
      capFrom: "width",
    };
  }

  /** The frame a slot's thumbnail is drawn of where no picture of it is at hand, or `null`. */
  function wantsDrawing(slot) {
    if (slot.picture !== null || slot.failed !== null) return null;
    if (slot.view !== null) return slot.view;
    if (slot.mode === "random" && host.plateOf(deepLink.familyOf(view)) === null) {
      return homeOf(deepLink.familyOf(view));
    }
    return null;
  }

  /** Whether a slot's thumbnail is being drawn, so that two syncs start one draw. */
  let thumbing = false;

  /**
   * **A thumbnail the tab has no picture of is drawn when the tab is idle** — a pasted link,
   * a view pinned before its pass landed — at the slot's own size, in the frame's own colour.
   * Every call into the pool cancels what the pool was doing, so a pass that starts takes the
   * pool back at once, and the thumbnail is drawn again the next time nothing is running.
   */
  async function drawThumbs() {
    if (thumbing || running !== null) return;
    const slot = [slots.a, slots.b].find((one) => wantsDrawing(one) !== null);
    if (slot === undefined) return;
    const frame = wantsDrawing(slot);
    const wanted = slot.view;
    thumbing = true;
    try {
      const deep = await pool();
      if (running !== null || slot.view !== wanted) return;
      const { width, height } = slot.els.canvas;
      const field = await deep.field(frame, width, height, { supersample: 1 });
      if (field === null || slot.view !== wanted) return;
      const shaded = await deep.shade(field, frame, {}, { derive: false });
      if (shaded === null || slot.view !== wanted) return;
      const canvas = document.createElement("canvas");
      canvas.width = shaded.image.width;
      canvas.height = shaded.image.height;
      canvas.getContext("2d").putImageData(shaded.image, 0, 0);
      slot.picture = canvas;
    } catch (error) {
      if (slot.view === wanted) slot.failed = String(error.message ?? error);
    } finally {
      thumbing = false;
      syncDive();
    }
  }

  /** A slot's thumbnail, its words, its lit button and its paste field, as they now are. */
  function syncSlot(slot, shownFor) {
    const { thumb, img, said, modes, paste } = slot.els;
    for (const button of modes) button.setAttribute("aria-pressed", String(button.dataset.mode === slot.mode));
    paste.hidden = !slot.pasting;
    const plate = slot.mode === "random" ? host.plateOf(deepLink.familyOf(view)) : null;
    img.hidden = plate === null;
    if (plate !== null && img.getAttribute("src") !== plate) img.src = plate;
    slot.els.canvas.hidden = plate !== null;
    let source = null;
    let words;
    if (slot.mode === "none") words = "its center";
    else if (slot.mode === "random") {
      words = "random";
      if (plate === null) source = slot.picture;
    } else if (slot.view === null) {
      words = "live";
      source = stale?.canvas ?? null;
    } else {
      words = slot.mode === "paste" ? "pasted" : "pinned";
      source = slot.picture;
      if (source === null) words = slot.failed !== null ? `${words} · not drawn` : `${words} · drawing…`;
    }
    if (source !== slot.shows) {
      slot.shows = source;
      paintThumb(slot, source);
    }
    said.textContent = words;
    const opens = slot.view !== null && slotBarred(slot) === null;
    thumb.setAttribute("aria-disabled", String(!opens));
    thumb.title = opens
      ? `Go to ${slot.mode === "paste" ? "the pasted" : "the pinned"} view. One step back returns.`
      : slot.view === null && slot.mode === "here"
        ? "This view, as it is drawn now."
        : (slotBarred(slot) ?? `${slot.name}: ${words}.`);
    thumb.setAttribute("aria-label", `${slot.name}: ${words}`);
    if (shownFor !== undefined) slot.els.root.hidden = !shownFor;
  }

  /** The Dive block, synced to the view: the slots, what is greyed and why, the status line
   *  at rest, and Cancel while a press is running. */
  function syncDive() {
    const barred = diveBarred();
    const downloading = running?.upto === "download";
    const action = els.diveAction.value;
    els.diveAction.disabled = barred !== null || downloading;
    for (const option of els.diveAction.options) {
      option.disabled = option.value === "halfway" && landingBarred("halfway") !== null;
    }
    syncSlot(slots.a);
    syncSlot(slots.b, action === "into");
    // The budget greys B's buttons as it greys the landing: None where the centre was
    // refused here, and the button of a view B carries where carrying it was.
    for (const button of slots.b.els.modes) {
      const mode = button.dataset.mode;
      const reason =
        mode === "none"
          ? landingBarred("into", { mode: "none", view: null })
          : (mode === "here" || mode === "paste") && slots.b.mode === mode
            ? landingBarred("into", slots.b)
            : null;
      button.classList.toggle("is-barred", reason !== null);
      button.title = reason ?? button.dataset.said ?? button.title;
    }
    for (const slot of [slots.a, slots.b]) {
      for (const button of slot.els.modes) button.disabled = barred !== null || downloading;
    }
    const reason = barred ?? pressBarred();
    // Faded and never natively disabled, as Shallow mode is: the title is the reason. While
    // Keep diving is on it is the one pressing Go, and a second driver would race it.
    els.diveGo.setAttribute("aria-disabled", String(reason !== null || downloading || keeping !== null));
    els.diveGo.title =
      keeping !== null
        ? "Keep diving is pressing Go. Untick it, or Cancel, to press it yourself."
        : (reason ??
          (action === "save"
            ? "Search, and save the largest copies to Dive results. The view stays where it is."
            : "Search, land and draw. One step back undoes it."));
    els.diveColor.checked = diveColouring;
    els.diveKeep.checked = keeping !== null;
    const keepReason = keepBarred(shapeOf(slots.a), action, shapeOf(slots.b));
    els.diveKeep.disabled = keeping === null && (keepReason !== null || barred !== null);
    els.diveKeep.title = keeping === null && keepReason !== null ? keepReason : els.diveKeep.dataset.said;
    const diving = running !== null && (running.upto === "dive" || running.dive === true);
    els.diveCancel.hidden = !diving && keeping === null;
    if (!diving) {
      const holding = keeping?.holding ? ` Next dive in ${HOLD_MS / 1000} s.` : "";
      els.diveStatus.textContent = (reason ?? diveSaid) + holding;
      const there = chain !== null && chain.place === placeOf(view) && !pending();
      els.diveBar.style.setProperty("--done", there ? "1" : "0");
      els.diveBar.dataset.state = there ? "final" : "rendering";
    }
    if (running === null && !thumbing) queueMicrotask(drawThumbs);
  }

  /**
   * **Paste** *(dive_slots_ckpt154)*: an explorer link off the clipboard into a slot. The
   * browser asks the first time; where it will not read the clipboard, the slot opens a field
   * to paste into instead. A link that is not on this view's plane, or is on a plane Dive
   * does not search, is refused with the reason and leaves the slot as it was.
   */
  async function pasteInto(slot) {
    let text = null;
    try {
      text = await navigator.clipboard.readText();
    } catch {
      text = null;
    }
    if (text === null) {
      slot.pasting = true;
      diveSaid = `The clipboard could not be read. Paste a link into the field under ${slot.name}.`;
      syncControls();
      slot.els.paste.focus();
      return;
    }
    take(slot, text);
  }

  /** A pasted text into a slot, or the reason it will not go. */
  function take(slot, text) {
    const refuse = (why) => {
      diveSaid = why;
      syncControls();
    };
    const query = queryIn(text);
    if (query === null) {
      slot.pasting = true;
      return refuse("That is not an explorer link. Copy link in the explorer writes one.");
    }
    const read = host.readLink(query);
    if (read.why !== undefined) return refuse(read.why);
    let frame;
    try {
      frame = read.deep !== undefined ? deepLink.parse(`?${read.deep}`, context) : carry(read.shallow);
    } catch (error) {
      return refuse(String(error.message ?? error));
    }
    if (frame === null) return refuse("That link is on a plane the Deep tab does not draw, and Dive does not search.");
    if (frame.julia !== null) {
      return refuse("That link is a Julia set. Minibrots live on the Mandelbrot and Multibrot planes.");
    }
    if (!MINIBROT_DEGREES.has(frame.degree ?? 2)) {
      return refuse("Dive works on the Mandelbrot set and the Multibrot sets of degrees 3 to 6.");
    }
    if (deepLink.familyOf(frame) !== deepLink.familyOf(view)) {
      return refuse(
        `That link is on ${planeWords(frame)}, and this view is on ${planeWords(view)}. ` +
          "A dive stays on one plane.",
      );
    }
    endKeeping("Keep diving stopped: the sentence changed.");
    slot.mode = "paste";
    slot.view = frame;
    slot.picture = null;
    slot.failed = null;
    slot.pasting = false;
    slot.els.paste.value = "";
    diveSaid = `${slot.name} is the pasted view, ${frame.w.text} across.`;
    syncControls();
  }

  /** A mode button pressed: what each one means is in `index.html`'s titles. */
  function choose(slot, mode) {
    if (mode === "paste") {
      pasteInto(slot);
      return;
    }
    slot.pasting = false;
    if (mode === "here") {
      // A's Here follows the view, and a press on a live A pins it; a press on a pinned A
      // lets it follow again. B's Here always pins, since B has no live mode.
      if (slot === slots.a && slot.mode === "here" && slot.view !== null) slot.view = null;
      else if (slot === slots.a && slot.mode !== "here") slot.view = null;
      else pin(slot);
      slot.mode = "here";
    } else {
      slot.mode = mode;
      slot.view = null;
    }
    if (slot.view === null) slot.picture = null;
    slot.failed = null;
    slot.shows = undefined;
    endKeeping("Keep diving stopped: the sentence changed.");
    syncControls();
  }

  function storedFlag(key) {
    try {
      return window.localStorage.getItem(key) === "on";
    } catch {
      return false;
    }
  }

  function storeFlag(key, value) {
    try {
      if (value) window.localStorage.setItem(key, "on");
      else window.localStorage.removeItem(key);
    } catch {
      /* A browser that stores nothing still has the box; it forgets it on a reload. */
    }
  }

  // ----------------------------------------------------------------- the controls

  /** Pin the cap at `value`, held to the kernel's floor and ceiling. Says whether the view
   *  moved, which is what `recapping` restarts a pass on. */
  function setCap(value) {
    const wanted = Math.round(value);
    const held = Math.max(deepLink.CAP_FLOOR, Math.min(deepLink.CAP_LIMIT, wanted));
    if (held === view.maxiter && pinned()) return false;
    view = { ...view, maxiter: held, capFrom: "reader" };
    moved();
    return true;
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
      // Ticked unless this viewer has said otherwise, so absent is on.
      return window.localStorage.getItem(AUTO_RENDER) !== "off";
    } catch {
      // A browser that stores nothing still has the box; it forgets it on a reload.
      return true;
    }
  }

  function setAuto(value) {
    autoRender = value;
    els.auto.checked = value;
    try {
      window.localStorage.setItem(AUTO_RENDER, value ? "on" : "off");
    } catch {
      /* As above. */
    }
    syncControls();
    // Ticking it over a frame that is not drawn draws it, rather than waiting for another
    // gesture to prove the reader meant it: on is "the canvas is the frame".
    if (value && shown && owns && pending()) moved();
  }

  /**
   * Whether Render is Cancel just now: **whenever anything is running** *(Matt,
   * deep_tab_undo_and_layout_ckpt144)*.
   *
   * It used to be a pass somebody commanded, a pass the watchdog had found silent, or one
   * with a finished picture to go back to — and an auto pass with none of those kept the
   * button as *Render* or *Render again*, on the old reasoning that pressing Render through
   * a pass nobody asked for should upgrade it to the probed one. That is the state Matt
   * found with no Cancel on the page: the first frame after entering the tab, or a gesture
   * before any pass had finished, drawing *full resolution 46% · about 15 s left* with a
   * spinner and nothing to stop it with. The upgrade is *Render again* once the pass lands,
   * which is where ckpt142 had already put it for every pass with a picture behind it.
   */
  function cancellable() {
    return running !== null;
  }

  /**
   * Whether Cancel goes back as well as stopping: a pass that started on its own, with a
   * picture of another frame held to go back to.
   *
   * **One button, and what it does follows from who started the pass**
   * *(explorer_deep_polish_ckpt142)*. A pass the reader commanded — Render, a link, a step
   * back — is a frame they asked for, and Cancel stops it where it is, as it always has. A
   * pass that started by itself after a gesture is one they may never have wanted, and the
   * picture it dimmed may have taken minutes: there Cancel is the way back to it, at once.
   */
  function revertible() {
    return (
      running !== null &&
      running.auto &&
      leftBehind() !== null &&
      running.upto !== "download" &&
      running.upto !== "minibrots" &&
      running.upto !== "dive"
    );
  }

  function syncControls() {
    const busy = running !== null;
    const why = busy ? null : refused();
    // **Anything running makes the button Cancel** *(ckpt144)* — see `cancellable`, which
    // says why the old exception for a pass that started on its own is gone. What Cancel
    // does still depends on who started it: see `revertible`.
    const committed = busy && !running.auto;
    const cancel = cancellable();
    els.render.textContent = cancel ? "Cancel" : pending() || drawn === null ? "Render" : "Render again";
    els.render.classList.toggle("is-running", cancel);
    // What Cancel will do is its hover title, and nowhere else *(deep_tab_controls_grid_ckpt144)*:
    // the sentence that used to say it under the Render line was up only while a pass ran.
    els.render.title = !cancel
      ? ""
      : revertible()
        ? "Stop, and go back to the frame you left, as it was drawn, without drawing it again."
        : !autoRender && committed && pending()
          ? "This is still drawing the frame you left. Cancel stops it; tick Auto-render and a new frame takes over on its own."
          : "Stop this render.";
    els.render.disabled = why !== null;
    els.progress.hidden = !busy;
    if (busy) {
      showActivity();
    } else {
      els.spinner.classList.add("is-idle");
      els.progress.classList.remove("is-stalled");
      // At rest the bar says whether the picture up is the frame: full when it is, empty
      // when nothing has been drawn or the reader has moved off it.
      els.bar.style.setProperty("--done", drawn !== null && !pending() ? "1" : "0");
      els.bar.dataset.state = drawn !== null && !pending() ? "final" : "rendering";
      els.bar.title = "";
    }
    els.auto.checked = autoRender;
    // **Iterations fades for its limits and a download, never for a pass** *(Matt,
    // iter_buttons_live_ckpt145)*: a press during one restarts it at the new cap
    // (`recapping`, below).
    const downloading = running?.upto === "download";
    els.cap.value = String(view.maxiter);
    els.capUp.disabled = downloading || view.maxiter >= deepLink.CAP_LIMIT;
    els.capDown.disabled = downloading || view.maxiter <= deepLink.CAP_FLOOR;
    syncDetails();

    // **A navigation button fades only for a reason of its own** *(Matt,
    // explorer_nav_layout_ckpt145)*. They all used to fade for as long as a pass the reader
    // started ran, which read as "not now" about buttons that had nothing to wait for: a
    // press during a pass cancels it and acts (`interrupting`, below), the way Cancel stops
    // one. What is left is the button's own reason, and a download, which is a file the
    // reader asked for and may be minutes of work that one press would throw away.
    const julia = view.julia !== null;
    els.julia.textContent = julia ? "Back to the Mandelbrot set (j)" : "Julia at this c (j)";
    els.julia.disabled = downloading;
    els.julia.title =
      julia && cameFrom !== null ? "Back to the frame this Julia set was opened from." : "";
    els.origin.hidden = !julia;
    // **Mandelbrot only.** There are no minibrots on a dynamical plane: a Julia set has no
    // parameter-space nuclei in it, so the button is not disabled there, it is absent. The
    // same at a degree whose size estimate did not land against a measured pin — see
    // `MINIBROT_DEGREES`. While its own search runs it says so and waits.
    els.minibrots.hidden = julia || !MINIBROT_DEGREES.has(view.degree ?? 2);
    els.minibrots.disabled = downloading || running?.upto === "minibrots";
    els.minibrots.textContent = running?.upto === "minibrots" ? "Looking…" : "Find minibrots";
    els.root.disabled = downloading || atRoot();
    els.origin.disabled =
      downloading || (julia && fx.isZero(view.x.dec) && fx.isZero(view.y.dec));
    // **Shallow mode fades where the frame cannot cross**, by `host.resolves` — the viewer's
    // own `resolvesShallow`, which asks the engine module and also refuses a Julia `c` a
    // double cannot hold — and **is never natively disabled**: a disabled button takes no
    // hover, and the title is the one place that says why it is faded. `aria-disabled`
    // tells a screen reader the same, and a press still goes to `host.leave`, which refuses
    // and says why in the line under the picture.
    const crosses = host.resolves(view);
    els.back.setAttribute("aria-disabled", String(downloading || !crosses));
    // Two reasons it might not go, and the title names the one in force. A parameter
    // that cannot cross is the more surprising of the two, because the frame would
    // draw perfectly well next door — as a different set.
    const carries =
      view.julia === null ||
      (deepLink.exactInDouble(view.julia.x) && deepLink.exactInDouble(view.julia.y));
    els.back.title = !carries
      ? "This Julia set's c has more digits than the ordinary explorer carries, so it cannot be taken back: rounding it would open a different Julia set."
      : crosses
        ? "The ordinary explorer, at this frame."
        : "This frame is too deep for the ordinary explorer to resolve. Zoom out here first.";
    els.back.hidden = false;

    // What the tab says about itself, in one line: what Render would do, and what is
    // drawing itself.
    if (why !== null) {
      els.note.textContent = why;
    } else if (busy) {
      // **What a busy tab has to say is Cancel's title now**, set above: a committed pass of
      // a frame the reader has since left runs on for minutes showing the picture they moved
      // off, and a pass that started on its own goes back rather than stopping. Both were a
      // line here until a line that came and went with every pass moved the grid.
      els.note.textContent = "";
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
    syncDive();
    if (shown && owns) host.onColour();
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
        "deeper — a frame can take minutes. Auto-render draws each frame you open or move to " +
        "at the width's own cap; Render also checks whether the frame needs a higher one.",
    );
  }

  /**
   * Come into the tab.
   *
   * `from` is the viewer's own view where it is on one of the families this kernel draws,
   * and the frame is carried over: its coordinates are already exact decimal text, so
   * nothing is lost crossing the floor. Anywhere else the tab opens at the last deep view
   * it had, or at the Mandelbrot home, and says which families deep draws.
   *
   * Returns whether a frame was carried in, which is when the page switches a Leveled
   * colour to a fitted Absolute one *(absolute_fit_ckpt147)*: a tab come back to on its own
   * frame keeps whatever scale the reader left it at.
   */
  function enter(from) {
    warn();
    let arrived = false;
    if (from !== null) {
      const carried = carry(from);
      if (carried !== null) {
        arrived = true;
        // A loop drawing aside runs on out of the tab, and the frame carried in on the way
        // back is a move of the view like any other *(keep_diving_anchor_ckpt154)*.
        if (placeOf(carried) !== placeOf(view)) {
          endKeeping("Keep diving stopped: coming back into the tab brought the viewer's frame with it.");
        }
        view = carried;
        drawn = null;
        stale = null;
        // A frame carried in from the viewer is a fresh start, and Cancel going back to a
        // deep frame from before it would be going somewhere the reader has since left.
        held = [];
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
    // **Arriving draws the frame, with Auto-render on** *(Matt,
    // interior_seam_deep_autorender_ckpt146: "never renders unasked" was never the
    // intent)*. The same pass a settled gesture starts — quarter, then full at one sample a
    // pixel, no cap probe — and no settle wait, because nothing is still moving. A frame
    // already drawn is left as it is.
    if (autoRender && running === null && pending() && refused() === null) {
      render("screen", { auto: true });
    }
    return arrived;
  }

  /** A shallow view as a deep one, where it is a frame this tab can take. */
  function carry(from) {
    const x = fx.parse(from.x.text);
    const y = fx.parse(from.y.text);
    if (x === null || y === null) return null;
    // A shallow Julia view brings its parameter with it, which is the same trip
    // *Shallow mode* makes in the other direction. The constants are
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
      // **A cap the shallow view holds crosses with it**, since permalink v4 gave it one:
      // it is the same `n` in both contracts, and one that a found minibrot or a link
      // settled is a picture choice on either side of the floor. Held here as the
      // reader's, which is how a `dv` link that names `n` opens.
      maxiter: from.maxiter ?? policyCap(from.w.value),
      capFrom: from.maxiter == null ? "width" : "reader",
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
    // Nothing is running here, since anything running makes this Cancel. A committed pass
    // is the one that may probe the cap, and it picks a quarter field an auto pass left
    // straight back out of the cache.
    render("screen");
  });

  els.auto.addEventListener("change", () => setAuto(els.auto.checked));

  /**
   * A cap control, pressed while a pass runs: the pass stops and starts again at the new
   * cap *(Matt, iter_buttons_live_ckpt145)*. Seeing mid-pass that the cap is too low is
   * exactly when a reader wants to raise it, and Halve and Double used to fade for the
   * whole of a pass the reader started. The pass comes back as what it was — a Render as
   * a Render, an auto pass as an auto pass, so Cancel still goes back where it would have —
   * and never through the settle timer, which draws nothing with Auto-render off.
   *
   * **Restarted, not continued.** The kernel hands back an escape count per sample and
   * keeps no orbit state, so a pixel that had not escaped by the old cap has to be iterated
   * from zero at the new one; carrying `z` and its derivative across a pass would be an
   * export `perturb-wasm` does not have. What a restart can reuse is the reference orbit
   * the pool holds, which survives a cancel: once it has landed, a restart draws off it
   * for as long as the new cap is within the iterations it was run to (`sameOrbit` in
   * `deep-render.js`), which Halve always is and Double usually is.
   *
   * A download is never taken this way, and a minibrot search is left to `moved()`, which
   * treats it as any change to the frame: the search settles a cap of its own and draws
   * nothing at this one.
   */
  function recapping(act) {
    return () => {
      if (running?.upto === "download") return;
      const was = running;
      if (!act() || was === null || was.upto === "minibrots" || was.upto === "dive") return;
      stop();
      disarm();
      render(was.upto, { auto: was.auto });
    };
  }

  els.capUp.addEventListener(
    "click",
    recapping(() => setCap(view.maxiter * CAP_STEP)),
  );
  els.capDown.addEventListener(
    "click",
    recapping(() => setCap(view.maxiter / CAP_STEP)),
  );
  els.cap.addEventListener(
    "change",
    recapping(() => {
      const wanted = Number(els.cap.value);
      const changed = Number.isFinite(wanted) && setCap(wanted);
      els.cap.value = String(view.maxiter);
      return changed;
    }),
  );
  els.policy.addEventListener(
    "click",
    recapping(() => {
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
      return changed;
    }),
  );

  /**
   * A navigation button, pressed while a pass runs: the pass stops and the button acts
   * *(Matt, explorer_nav_layout_ckpt145)*. Stopped and not reverted, even where Cancel would
   * go back — the press is going somewhere else, and a picture restored on the way would
   * be drawn over at once. A download is never taken this way, and the buttons it holds are
   * faded while it runs.
   */
  function interrupting(act) {
    return () => {
      if (running?.upto === "download") return;
      if (running !== null) stop();
      act();
    };
  }

  els.julia.addEventListener(
    "click",
    interrupting(() => (view.julia === null ? toJulia() : toMandelbrot())),
  );
  els.origin.addEventListener("click", interrupting(toOrigin));
  els.minibrots.addEventListener("click", interrupting(() => findMinibrots()));

  // The Dive block. Go is faded rather than disabled where a landing is greyed, so its title
  // says why; a press on it then does nothing but say so in the status line.
  els.diveGo.addEventListener("click", () => {
    if (els.diveGo.getAttribute("aria-disabled") === "true") return;
    press();
  });
  els.diveCancel.addEventListener("click", () => {
    endKeeping();
    stop();
    diveSaid = "Stopped.";
    host.showState(drawn === null ? "stopped" : "final");
    syncControls();
  });
  // A changed sentence is a question Keep diving was not asked, so it stops; the press in
  // flight finishes as the one it was.
  els.diveAction.addEventListener("change", () => {
    endKeeping("Keep diving stopped: the sentence changed.");
    syncControls();
  });
  els.diveKeep.dataset.said = els.diveKeep.title;
  for (const slot of [slots.a, slots.b]) {
    for (const button of slot.els.modes) {
      button.dataset.said = button.title;
      button.addEventListener("click", () => choose(slot, button.dataset.mode));
    }
    // A thumbnail holding a frame goes to it, as a link does: one step back returns.
    slot.els.thumb.addEventListener("click", () => {
      if (slot.els.thumb.getAttribute("aria-disabled") === "true") return;
      host.openLink(deepLink.emit(slot.view));
    });
    // The field a slot opens where the clipboard could not be read: a paste into it, or
    // Enter after typing, is taken as the link.
    slot.els.paste.addEventListener("paste", (event) => {
      const text = event.clipboardData?.getData("text");
      if (!text) return;
      event.preventDefault();
      take(slot, text);
    });
    slot.els.paste.addEventListener("keydown", (event) => {
      if (event.key === "Enter") take(slot, slot.els.paste.value);
      if (event.key === "Escape") {
        slot.pasting = false;
        syncControls();
      }
    });
  }
  els.diveKeep.addEventListener("change", () => {
    if (els.diveKeep.checked && keeping === null) keepDiving();
    else if (!els.diveKeep.checked) endKeeping();
  });
  els.diveColor.addEventListener("change", () => {
    diveColouring = els.diveColor.checked;
    storeFlag(DIVE_COLOURING, diveColouring);
  });
  els.root.addEventListener("click", interrupting(toRoot));
  // Faded is not disabled here (see `syncControls`), so a press on a frame that cannot
  // cross still lands, and `host.leave` says why it will not go.
  els.back.addEventListener("click", () => {
    if (running?.upto !== "download") host.leave(view);
  });

  return {
    /** The view the tab is standing on, for the colour controls and for a link. */
    view: () => view,
    /** The family this view is, by the shallow contract's name — what a download is named
     *  from, so the row that names it need not load the deep contract to ask. */
    family: () => deepLink.familyOf(view),
    /** Whether the tab owns the viewer — whether the picture on screen is the deep one. */
    owns: () => shown && owns,
    link: (options) => deepLink.emit(view, options),
    /** `j` while this tab owns the viewer: the tab's own *Julia at this c*, or its way back,
     *  exactly as a click on it — and nothing where the button is disabled
     *  *(pre_closeout_website_ckpt140)*. */
    pressJulia() {
      if (!els.julia.disabled && !els.julia.hidden) els.julia.click();
    },
    /** `r` while this tab owns the viewer: its own Root, as a click on it. */
    pressRoot() {
      if (!els.root.disabled) els.root.click();
    },

    // ------------------------------------------------ Find minibrots, for the viewer

    /** Search the viewer's frame `from`, and send a clicked entry to `pick`. */
    findFor: (from, pick) => findMinibrots({ from, pick }),
    /** Which view a running search is for, or `null` where none is running. */
    searching: () => (running?.upto === "minibrots" ? running.side : null),
    /** The viewer moved: its search stops and its list goes. The tab's own are untouched. */
    dropShallow() {
      if (running?.side === "shallow") stop();
      if (minibrotSide === "shallow") dropList();
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
    /** The kept field of the picture up, or `null`: what the colour controls' Hold look
     *  takes its reference value from *(palette_hold_ckpt145)*. The stage a recolour would
     *  colour, so the reference and the picture it holds are of one field. */
    shownField() {
      if (drawn === null) return null;
      const stage = keptStage(drawn);
      if (stage === undefined) return null;
      return fields.get(deepLink.fieldKey(drawn, stage.width, stage.height, stage.supersample));
    },
    /** Whether the picture up is of the frame the tab is standing on — its set, its place
     *  and its cap — which is when a fit waiting on the frame may be taken off it
     *  *(absolute_fit_ckpt147)*. Before the first stage of a new frame lands, the picture up
     *  is still the last one's. */
    showsView() {
      return drawn !== null && deepLink.fieldKey(drawn, 1, 1) === deepLink.fieldKey(view, 1, 1);
    },
    /** Whether the picture up is that frame's full pass — its final stage, drawn to the end —
     *  and not the quarter pass that lands first *(site_audit_ckpt147)*. The arrival fit is
     *  taken off whichever lands first, and taken once more when this turns true. */
    showsFinished() {
      return (
        drawnFull &&
        drawn !== null &&
        deepLink.fieldKey(drawn, 1, 1) === deepLink.fieldKey(view, 1, 1)
      );
    },
    /** The place the tab stands on — its set, its centre and its width, and not its cap — as
     *  one string. The arrival refit waits on a place: a cap the probe or the reader moves
     *  is still this frame being drawn to the end, and a pan or a zoom is another frame. */
    place() {
      return deepLink.fieldKey({ ...view, maxiter: 0 }, 1, 1);
    },

    show() {
      // A list the viewer found is about the viewer's frame, which is not on the screen now.
      if (running?.side === "shallow") stop();
      if (minibrotSide === "shallow") dropList();
      shown = true;
      owns = true;
      paint();
      syncControls();
    },
    hide() {
      shown = false;
      owns = false;
      disarm();
      leaving("Keep diving stopped: the Deep tab was left.");
      if (minibrotSide === "deep") dropList();
    },
    /** The reader took the viewer for something else; the tab keeps its view. */
    detach() {
      owns = false;
      disarm();
      leaving("Keep diving stopped: the viewer was taken for something else.");
      if (minibrotSide === "deep") dropList();
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
      const kept = heldFor(next);
      if (kept !== null) {
        putBack(next, kept);
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
      paint();
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
    /** The canvas changed size: repainted, and the controls asked again, because whether
     *  the frame still resolves in `f64` — Shallow mode's fade — is a question of the grid. */
    resized() {
      paint();
      syncControls();
    },
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
