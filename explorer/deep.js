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
  // **The state this closure is, and the four rules that hold it together.** Everything
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
  //    the rest of the session.
  // 4. **`owns` is whether the viewer's canvas is this tab's**, and `shown` whether the
  //    tab is the one on screen. Nothing may draw unless it owns the canvas; the tab keeps
  //    its `view` either way, which is what lets a reader leave and come back to the frame
  //    they left.
  //
  // The rest is cache and bookkeeping: `fields` is up to `CACHE_LIMIT` fields by
  // `deepLink.fieldKey` for a recolour, `finished` the fine pass's own picture for a
  // download, `measure` what the last pass of *this* frame cost (and `null` the moment the
  // frame or its cap moves), `quarterMs` what the auto-preview decides on, `colouring` the
  // shade in flight, `pinnedCap` whether the reader set the cap by hand, and `cameFrom`
  // the Mandelbrot frame *Julia at this c* was pressed on.
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
  /** The fine pass's picture, once it has landed — what a download at the canvas's own size
   *  saves instead of drawing it again. Cleared by every pass, because a picture of the
   *  view before is not this one. */
  let finished = null;
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
    // **`??=` remembers the promise, and a rejected one has to be forgotten.** Memoizing
    // the start is what makes two callers arriving together share one fetch and one
    // compile; memoizing a *failure* makes a fetch that 404'd once the answer for the rest
    // of the session, so every later Render fails the same way without ever retrying. The
    // catch is attached before the assignment, so what is remembered is the promise that
    // clears itself.
    starting ??= (async () => {
      host.stat("starting the deep renderer…");
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
    // **Before the await, not after it.** The pool takes a moment to start on the first
    // render of a session — a fetch, a compile and a worker apiece — and a Render button
    // that stayed pressable through it would start a second pass on a second press.
    running = { upto, auto, stage: "preview", started: performance.now() };
    finished = null;
    syncControls();
    host.showState("rendering");
    host.say("");

    const stages = [
      { name: "preview", width: grid.width / PREVIEW_DIVISOR, height: grid.height / PREVIEW_DIVISOR, supersample: 1 },
      { name: "full", width: grid.width, height: grid.height, supersample: 1 },
      { name: "fine", width: grid.width, height: grid.height, supersample: FINAL_SUPERSAMPLE },
    ];
    const wanted = upto === "preview" ? stages.slice(0, 1) : stages;

    try {
      // **Inside the guard.** A pool that fails to start — a fetch that 404s, a module
      // that will not compile — is a throw like any other, and a throw from outside the
      // try left `running` set: the button read *Cancel* for the rest of the session and
      // nothing was said. It is the same failure as a field that raises, and takes the
      // same exit.
      const deep = await pool();
      if (generation !== pass) return;

      let target = view;
      if (upto === "full" && !pinnedCap) {
        const chosen = await settleCap(deep, target, grid, generation);
        if (generation !== pass) return;
        if (chosen !== null && chosen.maxiter !== target.maxiter) target = chosen.frame;
      }

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
        if (stage.name === "fine") finished = shaded.image;
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
   * **Only for a Render, and only when the reader has not chosen a cap.** An auto-preview
   * is the cheap look and pays for nothing; a pinned cap is a choice and escalation is a
   * policy, so a typed cap and a cap a link carries are drawn exactly as they are asked
   * for. That distinction is `pinnedCap`, which already existed for the zoom.
   *
   * The probe is a few thousand of the frame's own sample cells, so the three passes below
   * run **once**, at the settled cap — measured at 0.08% to 0.22% of the fine pass.
   */
  async function settleCap(deep, from, grid, generation) {
    running.stage = "settling";
    els.progress.style.removeProperty("--done");
    els.progress.textContent = "choosing an iteration cap…";
    host.stat(`choosing an iteration cap · from ${from.maxiter.toLocaleString("en-US")}`);
    const chosen = await deep.settle(from, grid.width, grid.height, {
      supersample: FINAL_SUPERSAMPLE,
      onRung: (counts) => {
        if (generation !== pass) return;
        els.progress.textContent = `choosing an iteration cap · ${counts.maxiter.toLocaleString("en-US")}`;
      },
    });
    if (chosen === null || generation !== pass) return null;

    // **`view === from` is the whole guard, and object identity is what says it.** A
    // gesture during a committed render moves `view` without cancelling the pass — that is
    // the tab's own design, and every mutation replaces the object — so adopting the
    // settled cap into a view the reader has since moved would put this frame's answer on
    // a different frame.
    const frame = { ...from, maxiter: chosen.maxiter };
    if (chosen.maxiter !== from.maxiter && view === from) {
      view = frame;
      host.settle();
    }
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
   * It takes the pass, so the tab's own Cancel stops it and its progress goes through the
   * tab's own line as well as the button's bar. Hands back the picture, the link that
   * picture is of — **written after the cap has settled**, because the cap is part of what
   * a deep link says — and the three names a file is spelled from.
   */
  async function picture(width, height, { supersample = 1, onProgress, holder = {} } = {}) {
    const generation = ++pass;
    running = { upto: "download", auto: false, stage: "download", started: performance.now() };
    finished = null;
    syncControls();
    host.showState("rendering");
    try {
      const deep = await pool();
      if (generation !== pass) return null;

      let target = view;
      if (!pinnedCap) {
        const chosen = await settleCap(deep, target, { width, height }, generation);
        if (generation !== pass) return null;
        if (chosen !== null && chosen.maxiter !== target.maxiter) target = chosen.frame;
      }

      running.stage = "fine";
      const field = await deep.field(target, width, height, {
        supersample,
        onProgress: (done, elapsed) => {
          if (generation !== pass) return;
          report({ name: "fine", width, height, supersample }, done, elapsed);
          onProgress?.(done, elapsed);
        },
      });
      if (field === null || generation !== pass) return null;
      // The caller's holder becomes the tab's, so that the tab's own Cancel stops the
      // colouring as well as the field — a download-sized shade is seconds holding a
      // couple of gigabytes, and two ways out that stop different halves is one way out
      // too few.
      colouring = holder;
      const shaded = await deep.shade(field, target, colouring, { derive: host.deriving() });
      if (shaded === null || generation !== pass) return null;
      // A view the reader made measures its own curve on the frame being saved, exactly as
      // the shallow download does — so the link on the file is the link that redraws it.
      const drawnAs = host.deriving() ? { ...target, level: shaded.level } : target;
      host.showState("final");
      return {
        image: shaded.image,
        query: deepLink.emit(drawnAs),
        name: {
          family: drawnAs.julia === null ? "mandelbrot" : "julia",
          mode: "smooth",
          palette: drawnAs.palette,
        },
      };
    } finally {
      if (generation === pass) {
        running = null;
        syncControls();
      }
    }
  }

  /** What the tab says about the cap it chose: nothing where the width's own answer drew
   *  the frame, and a plain sentence where it did not. */
  function say_settled(chosen) {
    const count = (value) => value.toLocaleString("en-US");
    if (chosen.atCeiling) {
      host.say(
        `${Math.round(chosen.fault * 100)}% of this frame is still escaping at ` +
          `${count(chosen.maxiter)} iterations, the most this renderer will run, so some of ` +
          "what is painted as set is not. Zoom out, or narrow the frame.",
      );
      return;
    }
    if (chosen.maxiter === chosen.from) return;
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
    clearMinibrots();
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
    const generation = ++pass;
    const grid = host.grid();
    const target = view;
    running = { upto: "minibrots", auto: false, stage: "searching", started: performance.now() };
    syncControls();
    host.say("");
    clearMinibrots();

    try {
      const deep = await pool();
      if (generation !== pass) return;

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
      // A cap is a picture choice everywhere else on this tab — it is what `pinnedCap`
      // exists to defend — but here it is a floor under correctness, and moving the
      // reader's picture and rewriting their link as a side effect of pressing a search
      // button would be the wrong trade. Where the cap is already settled this costs one
      // rung, because `settle` starts where it is and stops as soon as the fault share is
      // met.
      running.stage = "settling";
      const floor = await deep.settle(target, grid.width, grid.height, {
        supersample: 1,
        onRung: (counts) => {
          if (generation !== pass) return;
          host.stat(`finding the cap to search at · ${counts.maxiter.toLocaleString("en-US")}`);
        },
      });
      if (floor === null || generation !== pass) return;
      running.stage = "searching";
      const searched =
        floor.maxiter > target.maxiter ? { ...target, maxiter: floor.maxiter } : target;
      host.stat(
        searched === target
          ? "looking for nuclei…"
          : `looking for nuclei · to ${floor.maxiter.toLocaleString("en-US")}`,
      );
      const found = await deep.nuclei(searched, grid.width, grid.height, {
        supersample: 1,
        tileSamples: TILE.width,
      });
      if (found === null || generation !== pass) return;

      if (found.length === 0) {
        host.stat("");
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

      for (const nucleus of reachable) {
        if (generation !== pass) return;
        const frame = frameOf(nucleus);
        if (tileSeconds(frame.maxiter) * 1000 > TILE_BUDGET_MS) continue;
        const field = await deep.field(frame, TILE.width, TILE.height, {
          supersample: 1,
          period: nucleus.period,
        });
        if (field === null || generation !== pass) return;
        const shaded = await deep.shade(field, frame, {}, { derive: false });
        if (shaded === null || generation !== pass) return;
        paintTile(nucleus, shaded.image);
      }
      host.stat("");
    } catch (error) {
      host.say(String(error.message ?? error));
    } finally {
      if (generation === pass) {
        running = null;
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
    els.julia.title =
      julia && cameFrom !== null ? "Back to the frame this Julia set was opened from." : "";
    els.origin.hidden = !julia;
    // **Mandelbrot only.** There are no minibrots on a dynamical plane: a Julia set has no
    // parameter-space nuclei in it, so the button is not disabled there, it is absent.
    els.minibrots.hidden = julia;
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
        "deeper — a frame can take minutes. Nothing here draws until you press Render.",
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
  els.minibrots.addEventListener("click", findMinibrots);
  els.back.addEventListener("click", () => host.leave(view));
  els.save.addEventListener("click", () => host.save(deepLink.emit(view)));

  return {
    /** The view the tab is standing on, for the colour controls and for a link. */
    view: () => view,
    /** Whether the tab owns the viewer — whether the picture on screen is the deep one. */
    owns: () => shown && owns,
    link: () => deepLink.emit(view),

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
    /** The finished picture at the canvas's own size, once the fine pass has landed. */
    shown: () => finished,
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
