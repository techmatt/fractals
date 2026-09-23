// The renderer: a pool of workers that compute field bands, and a main-thread
// wasm instance that plans a pass and shades the assembled field.
//
// Split from the page itself so that what draws a picture and what handles a
// mouse are two different files, and so that the timing harness under `scratch/`
// measures the same code the page runs rather than an imitation of it.
//
// The shape of a pass:
//
//   1. Ask the module what this view implies — how many lanes the mode's coloring
//      reads, whether it paints during the iteration instead, what the iteration
//      cap is, and whether the view is drawable at all.
//   2. A quarter-resolution field, each axis divided by four. It is a SEPARATE
//      field of the same rectangle rather than a subsample of the full one, so it
//      is normalized against its own samples — which is why the preview can be a
//      shade off the picture that replaces it.
//   3. The full-resolution field, in bands, dispatched from a queue.
//   3a. The same field again at two samples a pixel each way, which is the picture the
//      pass ends on; the page drives that stage, and this file only carries the
//      `supersample` a download already used.
//   4. All are cached by geometry, so a palette change re-shades and never
//      re-iterates — except under the four direct-trap modes, which have no field
//      to re-shade and are cached on the colour too.
//
// Cancellation is by generation rather than by termination: a pan bumps the
// generation, no further bands are dispatched, and the band still in flight is
// finished and thrown away. Killing a worker mid-band would cost a wasm
// instantiation to save at most one band of work.
//
// **One spec, and the module answers what it implies.** Everything below builds
// the same JSON object and hands it to `plan`, `compute_band` or `shade`. There is
// no table here of which mode reads how many fields, which family takes a
// constant, or what a mode's parameters default to: the module is asked. That is
// what keeps adding a family to the engine from being a change to this file.

import { stopsOf } from "./stops.js";

/**
 * The last few passes, band by band, for a harness to read.
 *
 * **What a profiler cannot see.** A band's arithmetic happens in a worker, and how much of
 * the pool was busy while a frame was drawn is the difference between a frame that is slow
 * because the recurrence is expensive and one that is slow because eleven workers spent
 * the tail waiting on the twelfth. Nothing on the page reads this — it is an array that
 * grows to `PASSES_KEPT` and stops — and `bench/page.mjs` is what it is for.
 *
 * On `globalThis` because the harness drives the real page over CDP and has no import of
 * its own; `walk.js`'s `__walk` is the same seam for the same reason.
 */
const PASSES_KEPT = 24;
export const passes = [];
globalThis.__render = { passes };

/** The pool is the machine's, up to this. Eight was a guess and it cost a twelve-core
 *  machine a third of its frame; the ceiling is here because the returns stop, not
 *  because anything breaks above it — a frame is cut into at most `height /
 *  MIN_BAND_ROWS` bands, so past about sixteen workers on a laptop-sized canvas the
 *  extra ones are queueing for a band that is not there. */
export const MAX_WORKERS = 16;

/** What the pool is sized at when the browser will not say how many cores it has.
 *  Every engine in circulation reports it, and the ones that do not are the ones
 *  reporting nothing on purpose — a machine with cores worth using, told to look
 *  like it has none. One worker was the old answer and it is the wrong guess. */
export const DEFAULT_WORKERS = 8;

/** How much finer the band queue is than the pool. More bands than workers is
 *  what makes an interior-heavy row band cost somebody else's idle time instead
 *  of the whole frame's, and it is what bounds how long a cancel takes. */
const BANDS_PER_WORKER = 4;

/**
 * No band shorter than this in a cut that has nothing measured to go on.
 *
 * **It is a guard against overhead, and the overhead is the message rather than the
 * arithmetic** *(explorer_perf_audit_ckpt136)*. This used to say the overhead was a
 * duration and leave it there. It is now measured from both sides, and the two answers
 * disagree in a way worth writing down. `bench/cut.mjs` draws one frame of `smooth` as a
 * single band and as four hundred and ten, at one sample a pixel and at two, and the four
 * readings are within a percent of each other: **a field band carries no engine-side fixed
 * cost at all.** So the floor was lowered to one row, which let the quarter-resolution
 * preview reach the pool's own four-bands-to-a-worker target — 42 bands over 124 rows
 * instead of sixteen — and its utilisation went from 0.54–0.67 to 0.77–0.99, which is the
 * imbalance the floor was causing and it was real.
 *
 * And the preview got **slower**: 14 ms to 61 ms at the home view, and worse on seven of the
 * ladder's nine. A band is a `postMessage`, a transfer, and a `#place` on the main thread,
 * which is where the pass is assembled and where every band's answer is serialized — about
 * 1.8 ms a band, measured as the difference across those two cuts. A harness that calls the
 * module directly cannot see a millisecond of that, which is why the floor survived a
 * measurement that appeared to retire it.
 *
 * At a screen's height this never binds — the four-per-worker target cuts at eleven rows —
 * so the whole of what it decides is the preview, and eight rows is the reading that won.
 */
const MIN_BAND_ROWS = 8;

/**
 * What one band is aimed at costing, in milliseconds.
 *
 * **A cancel costs one band, so a band is how long the page can ignore the reader.** The
 * pool abandons a pass by generation rather than by termination, which means the band a
 * worker is already inside is finished and thrown away; until it is, that worker cannot
 * touch the view the reader has just asked for. Cut at four bands to a worker and nothing
 * else, a band is about a quarter of the whole frame — milliseconds under `smooth` at a
 * screen's size, and seconds under a direct trap at `FINAL_SUPERSAMPLE`. The frame did not
 * get slower; the unit of "please wait" did.
 *
 * So the cut is aimed at a duration instead. A quarter of a second is short enough that a
 * mode switch feels immediate and long enough that the per-band message and copy are
 * noise. **It is a target and never a promise**: the first band of a pass is cut before
 * anything about that pass has been measured, and a band whose rows are all interior costs
 * what it costs.
 */
export const BAND_TARGET_MS = 250;

/** How far over target a band may be predicted to run before the rest of the queue is
 *  re-cut. Slack, so that a pass whose bands land a little over target is left alone
 *  rather than re-cut on every message. */
const RECUT_OVER = 1.5;

/**
 * How much of the target an in-flight band must still have left before a cancel terminates
 * its worker rather than waiting for it.
 *
 * **The gate is time, not mode.** Terminating is right exactly when waiting would cost
 * more than a wasm instantiation, and that is a question about this band rather than about
 * the recurrence: a pan under a direct trap at preview resolution is cheap and a pan is
 * the one gesture that must never pay for an instantiation, because it makes a cancel per
 * frame. At four times the target — a second — the reader has noticed, and a few
 * milliseconds of instantiation is the cheaper of the two.
 */
const KILL_OVER = 4;

/**
 * How many OUTPUT rows a band computes beyond its own, at any supersample.
 *
 * A direct trap is reduced in the band that painted it, and its Lanczos-3 kernel reaches
 * three output pixels either side — so `paint_band` iterates three output rows past itself
 * at each end and keeps only its own. That is what makes a painted band cut-independent and
 * it is not free: a band of `rows` rows does `(rows + 6) / rows` of its own work.
 *
 * **A band of the shade pads by the same three, for the same reason** *(the pooled shade)*.
 * Colouring is per sample and needs no neighbours; the reduction after it is the same
 * Lanczos-3 at the same reach, so `shade_band` is handed the padded sample rows and keeps
 * only its own output rows. The module states the rule once more in its length check — a
 * buffer that is not exactly this pad is refused rather than coloured — so the two
 * statements are tied rather than merely alike.
 *
 * **At one sample a pixel it is zero.** The taps are then the identity — `lanczos3` is 1 at
 * 0 and 0 at every other integer — so the preview and the one-sample pass pad nothing and
 * this only ever applies to the finishing supersample.
 */
export const TRAP_PAD_ROWS = 6;

/**
 * The most of a padded band's work that may go on rows belonging to its neighbours.
 *
 * **The duration target and the pad pull against each other, and the pad wins where they
 * meet.** Cut at `BAND_TARGET_MS` a direct trap's finishing pass reaches about two rows a
 * band, where the pad is three times the band — measured at 3.3x the whole frame's work on
 * one thread, which is most of the fifteen seconds that pass used to cost. Held to a
 * quarter, the floor is `TRAP_PAD_ROWS / TRAP_PAD_SHARE` rows and the frame is cut into
 * twenty bands rather than three hundred.
 *
 * What pays for it is cancel latency, and it is already paid for: a band over `KILL_OVER`
 * targets is terminated rather than waited out, which is the mechanism `#abandon` exists
 * for and is exactly the case a direct trap's band is. A coarse cut makes the kill path the
 * one a trap cancels through, instead of making the whole frame four times the work so that
 * the wait path can be used.
 */
const TRAP_PAD_SHARE = 0.25;

/**
 * How a frame of `height` OUTPUT rows is cut up for a pool of this many workers.
 *
 * The pool's one claim on the byte-identity chain lives here: a band is a range of
 * output rows, a band's coordinates are formed from the whole viewport with the
 * global row index, and so nothing about *where* the cuts fall reaches the
 * arithmetic. Two pools of different sizes cut the same frame differently and
 * assemble the same bytes.
 *
 * Exported so `bands.test.mjs` can hold that claim to the committed module rather
 * than to a second copy of this function.
 *
 * `least` is the fewest rows a band may have, `MIN_BAND_ROWS` unless the caller has a
 * reason of its own — a direct trap's padded band does; see `TRAP_PAD_SHARE`. It bounds the
 * cut from the coarse side, so a frame of fewer than `least * workers * BANDS_PER_WORKER`
 * rows gets fewer bands than the pool would like rather than bands that are too small.
 */
export function bandsOf(height, workers, least = MIN_BAND_ROWS) {
  // `floor`, so that the floor is a floor: `ceil` asks for one more piece than the frame
  // can give at that size and leaves the remainder as a straggler below it.
  const target = Math.max(
    1,
    Math.min(Math.floor(height / Math.max(1, least)), workers * BANDS_PER_WORKER),
  );
  // Through `recut`, which is where the even distribution lives — the rest of this function
  // was a stepped loop that left the remainder as a last short band, which is a message and
  // a copy for a few rows on a field pass and a band below its own floor on a padded one.
  return recut([[0, height]], Math.ceil(height / target), least);
}

/**
 * Re-cut the ranges still queued into bands of at most `rows` rows each.
 *
 * The rows themselves do not move: every range is subdivided in place, so what comes back
 * covers exactly what went in. That is the whole reason this is safe to do in the middle
 * of a pass — `bands.test.mjs` holds the pool to assembling the same bytes however the
 * frame is cut, and a re-cut is one more cut.
 */
export function recut(queue, rows, least = MIN_BAND_ROWS) {
  const out = [];
  for (const [start, end] of queue) {
    const span = end - start;
    // As many pieces as the target wants, and never more than the floor allows — so the
    // floor holds by construction rather than by a check. `least` is that floor, and it is
    // the caller's because a cut aimed at a duration carries its own: a band cut to last a
    // quarter of a second is never too cheap to be worth sending, however few rows it is.
    const wanted = Math.max(1, Math.ceil(span / Math.max(1, rows)));
    const most = Math.max(1, Math.floor(span / Math.max(1, least)));
    const pieces = Math.min(wanted, most);
    // Evenly, rather than in whole steps with the remainder left over: a 45-row range cut
    // at 8 is six bands of 8 and a straggler of 5, and the straggler is a message and a
    // copy for five rows of work.
    for (let piece = 0; piece < pieces; piece++) {
      out.push([
        start + Math.round((piece * span) / pieces),
        start + Math.round(((piece + 1) * span) / pieces),
      ]);
    }
  }
  return out;
}

/** Each axis of the preview, as a fraction of the full pass. */
export const PREVIEW_DIVISOR = 4;

/** How many fields to keep. The three stages of the current view — preview, one sample a
 *  pixel, and the supersampled finish — and the same three of one view back. */
const CACHE_LIMIT = 6;

/** The engine's family spec for each name the permalink carries.
 *
 *  The one place the contract's vocabulary meets the engine's, and it is a
 *  renaming rather than a decision: a permalink says `multibrot3` because a name
 *  should carry its exponent, and the engine says `{kind, degree}` because it
 *  matches on the recurrence. The constants are passed through as the decimal
 *  strings they arrived as — they are half of a dynamical location's identity, and
 *  a round trip through a double would rewrite them. */
export function familySpecOf(family, constants) {
  const c = () => [constants.cx.text, constants.cy.text];
  switch (family) {
    case "mandelbrot":
      return { kind: "mandelbrot" };
    case "multibrot3":
    case "multibrot4":
    case "multibrot5":
    case "multibrot6":
      return { kind: "multibrot", degree: Number(family.slice(-1)) };
    case "julia":
      return { kind: "julia", degree: 2, c: c() };
    case "julia3":
    case "julia4":
    case "julia5":
    case "julia6":
      return { kind: "julia", degree: Number(family.slice(-1)), c: c() };
    case "phoenix":
      // `z_prev` is the engine's own key for the previous iterate the recurrence
      // starts with, and it crosses as a decimal pair like every other constant.
      return {
        kind: "phoenix",
        c: c(),
        p: [constants.px.text, constants.py.text],
        z_prev: [constants.zx.text, constants.zy.text],
      };
    case "phoenix_plane":
      // The engine's `phoenix_m`: the same recurrence with `c` the pixel and the
      // orbit opened at z₀ = z₋₁ = 0, so `p` is all it is told.
      return { kind: "phoenix_m", p: [constants.px.text, constants.py.text] };
    default:
      throw new Error(`no engine family for ${family}`);
  }
}

/**
 * One view as the module's spec.
 *
 * `palette` is handed over as it stands, because the permalink's seven shade keys
 * ARE the engine's palette recipe — same names, same shapes, same defaults — and
 * translating between two spellings of one thing is how they drift apart. `level`
 * is not one of the seven and is handed over beside them, under the operator's own
 * field names: it is a separate operator that curves the ramp before the recipe is
 * spent on it, and a key in the wrong object would be refused by the module.
 *
 * The colormap is left out of a field pass that does not need it. Only the direct
 * traps read the gradient while they iterate; for every other mode the map is a
 * shade-time input, and baking a lookup table into every band would be a table per
 * band.
 */
export function specOf(
  view,
  width,
  height,
  { colormap = true, supersample = 1, level = true, maxiter = null } = {},
) {
  const spec = {
    schema: 1,
    family: familySpecOf(view.family, view.constants),
    viewport: { center_re: view.x.text, center_im: view.y.text, width: view.w.text },
    resolution: [width, height],
    mode: view.mode,
    palette: view.shade,
  };
  // Omitted at one, which is the module's own default, so the screen's specs are
  // the strings they have always been and the plan cache does not split in two.
  if (supersample > 1) spec.supersample = supersample;
  // A probe's knob and never a picture's: the Walk tab's straddle probe asks for the
  // sampler's 256, and nothing a link opens sets it, so the screen's specs never carry it.
  if (maxiter !== null) spec.maxiter = maxiter;
  if (Object.keys(view.params).length > 0) spec.params = view.params;
  if (colormap) spec.colormap = stopsOf(view.palette);
  // The tone operator acts on the map's stops, so it travels with the colormap and is
  // left out of the specs that carry none — a field pass has no ramp to curve, and a
  // plan is a question rather than a render. `view.level` is absent on a view built
  // before the key existed, which is the same thing as the operator not having acted.
  // `level: false` leaves it out for a shade that is to measure its own curve: a picture
  // drawn through a curve is already levelled, and the module refuses to level it twice.
  if (colormap && level && view.level) {
    spec.autolevel = {
      black_pt: view.level.black_pt,
      white_pt: view.level.white_pt,
      exponent: view.level.exponent,
      out_ends: view.level.out_ends,
    };
  }
  return spec;
}

/**
 * One pool worker, instantiated and ready for a band.
 *
 * The module arrives compiled, so what this costs is an instantiation and a heap — which
 * is why the pool can afford to throw a worker away mid-band when waiting for it would
 * cost more. Written once because it happens in two places: starting the pool, and putting
 * a fresh worker in the place of one that was abandoned.
 */
function spawn(module) {
  return new Promise((resolve) => {
    const worker = new Worker(new URL("./worker.js", import.meta.url), { type: "module" });
    worker.onmessage = (event) => {
      if (event.data.kind === "ready") resolve(worker);
    };
    worker.postMessage({ kind: "start", module });
  });
}

/**
 * Everything the page needs to draw, once the module is compiled and the pool is up.
 */
export class Renderer {
  constructor(module, shader, workers) {
    this.module = module;
    this.shader = shader;
    this.workers = workers;
    this.idle = [...workers];
    this.generation = 0;
    this.queue = [];
    this.job = null;
    /** What each busy worker is inside: its band's rows, when it was posted, and what that
     *  band was predicted to cost. The pool's only view of work it cannot see. */
    this.inflight = new Map();
    /**
     * Milliseconds per output row per sample-per-pixel, as the last bands measured it.
     *
     * **Normalized by the supersample so that a pass's own stages inform each other.** The
     * preview, the one-sample field and the supersampled finish are the same arithmetic
     * over different sample counts, so a cost per row alone would say the finish is as
     * cheap as the preview that came before it and cut it sixteen times too coarse. Per
     * row per sample, the preview's measurement is a usable opening guess for the finish.
     *
     * It survives a pass, because the best guess about the next cut is the last thing
     * measured; it is only ever a guess, and every pass re-measures and re-cuts from its
     * own bands. `null` until a band has been timed.
     */
    this.rowCost = null;
    this.fields = new Map();
    this.plans = new Map();
    /** The frame-wide statistics a pooled shade spends, by field and transfer. A palette,
     *  phase, cycles, gamma or level edit changes none of them, which is the whole reason
     *  a recolour is a colouring and nothing else. */
    this.measured = new Map();
    this.ramped = null;
    this.shading = new ShadeWorker(module);
  }

  /**
   * Compile the module once, instantiate it here for planning and shading, and
   * start the pool.
   *
   * `wanted` is for the timing harness; the page passes nothing and gets what the
   * machine says it has, capped.
   */
  static async start(url, wanted) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${url}: ${response.status} ${response.statusText}`);
    // Streaming, so the two hundred kilobytes are compiled as they arrive rather than
    // after: the module is the largest thing a cold open fetches and the compile is the
    // longest task before the first pass. It needs `application/wasm` on the response, which
    // Pages sends and `builder serve` sends, and it is a browser feature rather than a
    // guarantee — so a response it will not take falls back to the buffer it always used,
    // and the page opens either way.
    // The clone is taken before the body is touched, because a body is read once and a
    // fallback that had nothing left to read would be no fallback at all.
    const spare = response.clone();
    let module;
    try {
      module = await WebAssembly.compileStreaming(response);
    } catch {
      module = await WebAssembly.compile(await spare.arrayBuffer());
    }
    const count =
      wanted ?? Math.min(MAX_WORKERS, navigator.hardwareConcurrency || DEFAULT_WORKERS);
    const renderer = await Renderer.over(module, count);
    renderer.shading.warm();
    return renderer;
  }

  /**
   * A second renderer over a module already compiled: its own instance, its own pool of
   * `count` workers, its own one job at a time. What the Walk tab draws through, so that a
   * walk scoring a picture never cancels the pass the viewer is drawing.
   */
  static async over(module, count) {
    const shader = new WebAssembly.Instance(module, {}).exports;
    // Together, not one after another. A worker costs a thread, a module instantiation and a
    // message round trip, and twelve of those in sequence is the pool's whole startup on the
    // critical path of the first picture; started at once they overlap, and the pool is ready
    // when the slowest of them is.
    const workers = await Promise.all(
      Array.from({ length: Math.max(1, count) }, () => spawn(module)),
    );
    return new Renderer(module, shader, workers);
  }

  get workerCount() {
    return this.workers.length;
  }

  /**
   * Give the workers back, and everything they were holding.
   *
   * **A document that navigates away does not take its threads with it.** Chrome keeps the
   * old document alive for the back/forward cache, and its pool with it, so eight loads in
   * one tab stood at a hundred and fifteen live workers and the ninth could not instantiate
   * the module at all — a page that answered with neither a picture nor a notice
   * *(explorer_bug_hunt_ckpt138, finding 1)*. `pagehide` in `explorer.js` is what calls
   * this; nothing inside a document needs it, because nothing inside a document leaks.
   *
   * The cached fields go too. They are the largest thing here after the workers and the
   * only reason to keep one is a pass that is no longer going to happen.
   */
  stop() {
    this.cancel();
    for (const worker of this.workers) worker.terminate();
    this.workers = [];
    this.idle = [];
    this.inflight.clear();
    this.fields.clear();
    this.plans.clear();
    this.measured.clear();
    this.shading.stop();
  }

  /** Write a string into the module's heap, and hand back what frees it. */
  #put(text) {
    const raw = new TextEncoder().encode(text);
    const pointer = this.shader.alloc(raw.length);
    new Uint8Array(this.shader.memory.buffer, pointer, raw.length).set(raw);
    return [pointer, raw.length];
  }

  /**
   * What this spec implies, or why it cannot be drawn.
   *
   * Memoized on the spec itself: the page asks on every pass and every re-shade,
   * and the answer is a property of the spec.
   */
  plan(spec) {
    const text = JSON.stringify(spec);
    const held = this.plans.get(text);
    if (held !== undefined) return held;

    const [pointer, length] = this.#put(text);
    const out = this.shader.plan(pointer, length);
    this.shader.dealloc(pointer, length);
    const size = new DataView(this.shader.memory.buffer).getUint32(out, true);
    const body = new TextDecoder().decode(new Uint8Array(this.shader.memory.buffer, out + 4, size));
    this.shader.dealloc(out, size + 4);

    const answer = JSON.parse(body);
    if (this.plans.size > 64) this.plans.clear();
    this.plans.set(text, answer);
    return answer;
  }

  /** The family's own home view, read out of the module rather than restated here. */
  home(familySpec) {
    const answer = this.plan({ schema: 1, family: familySpec });
    if (!answer.ok) throw new Error(answer.why);
    return answer.home;
  }

  /** The iteration cap the engine's policy gives a view of this width. */
  maxiter(width) {
    return this.shader.maxiter_for_width(width);
  }

  /**
   * Whether `f64` still places two neighbouring samples of this view apart.
   *
   * The floor is the engine's, read out of the module. Below it the picture would
   * be of the arithmetic rather than of the set, and the page stops zooming.
   */
  resolves(x, y, w, width, height) {
    return this.shader.resolution_ulps(x, y, w, width, height) >= this.shader.resolution_ulps_floor();
  }

  /**
   * Throw away every in-flight band, and stop dispatching.
   *
   * The abandoned pass is **resolved with `null`**, not left pending. A promise
   * nobody will ever settle holds its whole `await` chain alive — the assembled
   * field, the view, the caller's local state — for as long as the page is open,
   * and a reader who drags across the set makes one per drag.
   */
  cancel() {
    this.generation += 1;
    this.queue = [];
    const job = this.job;
    this.job = null;
    this.#abandon();
    if (job !== null) job.resolve(null);
  }

  /**
   * Take back the workers whose in-flight band is not worth waiting out.
   *
   * A band is abandoned by generation everywhere else on this page — the worker finishes
   * it, the answer is dropped, and the worker is free. That is right while a band is
   * short: killing it would cost a wasm instantiation to save a fraction of a frame, and a
   * reader dragging across the set cancels once a frame.
   *
   * It stops being right when the band is long. Under a direct trap at the finishing
   * supersample a single band runs for seconds, and every worker is inside one, so a
   * reader who switches to `smooth` waits out the picture they have just abandoned before
   * the one they asked for can start — the page is busy, and busy on nothing. There the
   * instantiation is the cheap side, and `shadeApart` already makes the same trade for the
   * same reason.
   *
   * **Which side a band is on is measured, not assumed.** A band predicted to have more
   * than `KILL_OVER` targets left to run is killed; so is one that has already run that
   * long, which is the same judgement from the other side and is the only one available
   * before a pass has timed a band of its own. Everything else is left to finish, so the
   * pan case pays nothing.
   */
  #abandon() {
    const now = performance.now();
    const bar = BAND_TARGET_MS * KILL_OVER;
    for (const [worker, band] of [...this.inflight]) {
      const elapsed = now - band.at;
      const left = Math.max(0, band.predicted - elapsed);
      if (left <= bar && elapsed <= bar) continue;
      this.inflight.delete(worker);
      this.#replace(worker);
    }
  }

  /** Terminate one worker and put a fresh one in its place, ready for the next dispatch.
   *  The module is compiled once and held, so this is an instantiation and not a build. */
  #replace(worker) {
    worker.terminate();
    const at = this.workers.indexOf(worker);
    const idle = this.idle.indexOf(worker);
    if (idle !== -1) this.idle.splice(idle, 1);
    spawn(this.module).then((fresh) => {
      // The pool may have been torn down while it was starting, in which case the fresh
      // worker is the only thing that knows about itself and goes no further.
      if (at === -1 || this.workers[at] !== worker) {
        fresh.terminate();
        return;
      }
      this.workers[at] = fresh;
      this.idle.push(fresh);
      this.#dispatch(fresh);
    });
  }

  /** A field already computed for this geometry, or `undefined`. */
  cached(key) {
    return this.fields.get(key);
  }

  remember(key, field) {
    this.fields.delete(key);
    this.fields.set(key, field);
    while (this.fields.size > CACHE_LIMIT) {
      this.fields.delete(this.fields.keys().next().value);
    }
  }

  /**
   * Compute one field over the whole pool, and resolve with it.
   *
   * Resolves with `null` if a newer generation started while this one was running:
   * the caller's answer is no longer wanted, and saying so is cheaper than
   * checking a stale generation everywhere downstream.
   *
   * What comes back is lane-major `f64` for a mode that makes a field, and finished
   * RGBA for one that paints during the iteration. Which it is comes from the plan,
   * and both are assembled by rows the same way.
   *
   * `maxiter` overrides the depth policy's cap, and only the Walk tab's probe passes it.
   */
  field(view, width, height, { supersample = 1, onProgress, maxiter = null } = {}) {
    const shape = this.plan(specOf(view, width, height, { colormap: false, supersample, maxiter }));
    if (!shape.ok) return Promise.reject(new Error(shape.why));
    return this.#run(view, width, height, shape, { supersample, onProgress, maxiter });
  }

  /**
   * Count a direct trap's near misses on a small grid over the whole pool, and resolve
   * with `{ values, width, height }`: `PROBE_BYTES` per pixel, what `derive_opacity`
   * reads. The same bands and the same cancellation as a field, because it is the same
   * orbits at a fraction of the samples.
   */
  probe(view, width, height) {
    const shape = this.plan(specOf(view, width, height, { colormap: false }));
    if (!shape.ok) return Promise.reject(new Error(shape.why));
    return this.#run(view, width, height, { ...shape, probe: true }, { supersample: 1 });
  }

  /**
   * The opacity a probe derives, asked of the module on this thread: `{ opacity, hit_share,
   * load }`, `opacity` null where nothing in the probe was hit. Milliseconds: the probe is
   * a sort of a few thousand numbers.
   */
  deriveOpacity(view, probed) {
    const wasm = this.shader;
    const [pointer, length] = this.#put(JSON.stringify(specOf(view, probed.width, probed.height)));
    const bytes = probed.values;
    const probePointer = wasm.alloc(bytes.length);
    new Uint8Array(wasm.memory.buffer, probePointer, bytes.length).set(bytes);
    const out = wasm.derive_opacity(pointer, length, probePointer, bytes.length);
    wasm.dealloc(probePointer, bytes.length);
    wasm.dealloc(pointer, length);
    const size = new DataView(wasm.memory.buffer).getUint32(out, true);
    const body = new TextDecoder().decode(new Uint8Array(wasm.memory.buffer, out + 4, size));
    wasm.dealloc(out, size + 4);
    const answer = JSON.parse(body);
    if (!answer.ok) throw new Error(answer.why);
    return answer.probed;
  }

  /**
   * The palette as this view spends it: `samples` RGBA pixels, the colour a field value of
   * `i / (samples - 1)` becomes once the mode's curve has placed it.
   *
   * **The module draws it, through the table the picture is drawn through.** There is no
   * export that hands a table over, and a second bake in JavaScript is a second opinion
   * about OKLab, folds and wraps that would drift the first time the engine moved. So this
   * shades a field made to be the ramp: one row of it, a row of zeros and a row of ones
   * under it, so the frame's half-percent stretch lands exactly on 0 and 1 and leaves the
   * ramp where it is. The mode is `smooth`, a single field under a linear curve, and the
   * transfer is `value`: both are what come *before* the strip's 0 to 1, and a strip that
   * folded them in would be a picture of this frame's histogram rather than of the palette.
   * Everything after that point is the view's own — the map and its tone curve, the fold
   * and the flip, gamma, cycles and phase, and the rolloff — with one exception: a direct
   * trap spends no gamma, cycles or phase, so under one they are left out here as well.
   *
   * At one sample a pixel the module encodes each colour without a filter, so the pixels
   * are the table's own lookups. Memoized on the spec, which is what a recolour re-sends.
   */
  ramp(view, samples, { direct = false, stops = null } = {}) {
    const text = JSON.stringify(
      rampSpecOf(view, stops ?? stopsOf(view.palette), samples, { direct, curved: stops !== null }),
    );
    if (this.ramped !== null && this.ramped.text === text) return this.ramped.pixels;

    const lanes = rampLanes(samples);
    const wasm = this.shader;
    const [pointer, length] = this.#put(text);
    const lanePointer = wasm.alloc(lanes.length);
    new Uint8Array(wasm.memory.buffer, lanePointer, lanes.length).set(lanes);
    // `shade` frees the lanes, as it does for a picture; the spec is this caller's.
    const out = wasm.shade(pointer, length, lanePointer, lanes.length);
    wasm.dealloc(pointer, length);
    if (out === 0) throw new Error("the renderer refused this palette recipe");
    const bytes = samples * 3 * 4;
    const pixels = new Uint8ClampedArray(wasm.memory.buffer, out, samples * 4).slice();
    wasm.dealloc(out, bytes);
    this.ramped = { text, pixels };
    return pixels;
  }

  #run(view, width, height, shape, { supersample, onProgress, maxiter = null }) {
    this.cancel();
    const generation = this.generation;

    // A direct trap composites samples from the gradient as it iterates, so its
    // band is already coloured and its spec needs the map in it.
    const spec = JSON.stringify(
      specOf(view, width, height, { colormap: shape.direct, supersample, maxiter }),
    );
    // A band is a range of OUTPUT rows at every supersample, which is what lets a
    // direct trap reduce its own band. What comes back behind those rows is the
    // sample grid, and that is what the lanes are sized on.
    const sampleWidth = width * supersample;
    const sampleHeight = height * supersample;
    const values = shape.probe
      ? new Uint8Array(width * height * PROBE_BYTES)
      : shape.direct
        ? new Uint8ClampedArray(width * height * 4)
        : new Float64Array(sampleWidth * sampleHeight * shape.lanes);

    // Four bands to a worker is the load-balancing floor — it is what makes an
    // interior-heavy band cost somebody else's idle time rather than the whole frame's —
    // and the duration target only ever cuts finer than that, never coarser. So a cheap
    // pass is cut exactly as it always was, and an expensive one is subdivided.
    // The opening cut takes the coarser of the two floors: the pool's own row floor, which
    // is a message-overhead guard, and a padded band's, which is a work guard. They are not
    // the same kind of thing and the pad's is the larger where it applies.
    const bands = this.#cut(
      bandsOf(
        height,
        this.workers.length,
        Math.max(MIN_BAND_ROWS, this.#least(supersample, shape)),
      ),
      supersample,
      shape,
    );

    const record = {
      kind: shape.probe ? "probe" : shape.direct ? "direct" : "field",
      width,
      height,
      supersample,
      workers: this.workers.length,
      at: performance.now(),
      bands: [],
      elapsed: null,
    };
    passes.push(record);
    while (passes.length > PASSES_KEPT) passes.shift();

    return new Promise((resolve, reject) => {
      this.job = {
        record,
        generation,
        spec,
        shape,
        width,
        height,
        supersample,
        sampleWidth,
        sampleHeight,
        values,
        // **Progress is rows, not bands.** The queue is re-cut mid-pass as the bands
        // report what they cost, so a count of bands is a denominator that moves.
        rows: height,
        done: 0,
        onProgress,
        resolve,
        reject,
        started: performance.now(),
      };
      this.queue = bands;
      for (const worker of [...this.idle]) this.#dispatch(worker);
    });
  }

  /**
   * How finely to cut, given what a band is costing: bands of about `BAND_TARGET_MS`.
   *
   * Only ever finer than the cut it is handed. Nothing is measured yet on the first pass
   * of a session, and then this is the identity.
   *
   * `shape` is the plan, for the one mode family whose bands are not free to be any size:
   * see `#least`.
   */
  #cut(bands, supersample, shape) {
    const least = this.#least(supersample, shape);
    const widest = bands.reduce((most, [start, end]) => Math.max(most, end - start), 0);
    // Nothing measured yet, and `bandsOf` already cut no finer than the floor allows.
    if (this.rowCost === null) return bands;
    const perRow = this.rowCost * supersample * supersample;
    const rows = Math.max(least, BAND_TARGET_MS / perRow);
    // Down to a single row, because this cut is aimed at a duration and a duration is what
    // the row floor was standing in for. A view deep enough that one row of it costs more
    // than the target is a view whose cancel cannot be made any cheaper than one row, and
    // that is the floor being honest rather than the floor being ignored.
    return rows * RECUT_OVER < widest ? recut(bands, rows, least) : bands;
  }

  /**
   * The fewest rows a band of this pass may have **once something has been measured**.
   *
   * One row everywhere but a direct trap at more than one sample a pixel, where a band
   * computes `TRAP_PAD_ROWS` rows it will throw away and the floor is what keeps that from
   * being most of the frame. See `TRAP_PAD_SHARE`.
   *
   * One row and not `MIN_BAND_ROWS`, because that floor is a guess at what is worth a
   * message and this is the case where the target has a measurement behind it: a view deep
   * enough that one row costs more than `BAND_TARGET_MS` is a view whose cancel cannot be
   * made cheaper than one row. The opening cut takes the coarser of the two — see `#run`.
   */
  #least(supersample, shape) {
    const padded = shape?.direct === true && supersample > 1;
    return padded ? Math.ceil(TRAP_PAD_ROWS / TRAP_PAD_SHARE) : 1;
  }

  #dispatch(worker) {
    const job = this.job;
    if (job === null || job.generation !== this.generation || this.queue.length === 0) {
      if (!this.idle.includes(worker)) this.idle.push(worker);
      return;
    }
    const [rowStart, rowEnd] = this.queue.shift();
    const index = this.idle.indexOf(worker);
    if (index !== -1) this.idle.splice(index, 1);
    const span = rowEnd - rowStart;
    const perRow = (this.rowCost ?? 0) * job.supersample * job.supersample;
    this.inflight.set(worker, { at: performance.now(), rows: span, predicted: span * perRow });
    worker.onmessage = (event) => this.#collect(worker, event.data, job);
    if (job.shade) {
      const [lanes, transfer] = this.#laneBand(job, rowStart, rowEnd);
      worker.postMessage(
        {
          kind: "shade_band",
          job: job.generation,
          spec: job.spec,
          stats: job.stats,
          lanes,
          rowStart,
          rowEnd,
          bytes: span * job.width * 4,
        },
        transfer,
      );
      return;
    }
    worker.postMessage({
      job: job.generation,
      spec: job.spec,
      rowStart,
      rowEnd,
      probe: job.shape.probe === true,
      bytes: job.shape.probe
        ? span * job.width * PROBE_BYTES
        : job.shape.direct
          ? span * job.width * 4
          : span * job.supersample * job.sampleWidth * job.shape.lanes * 8,
    });
  }

  /**
   * The lanes one band of a shade is handed: its own sample rows and the pad either side,
   * lane-major, in a buffer of its own that is transferred.
   *
   * **The copy is the one the field cache forces and there is no way around it.** The
   * assembled field has to stay whole for the next recolour, and a transfer detaches what
   * it sends — so a band's rows are copied out. What it is not is the copy this replaced:
   * the whole field used to be sliced in one go for one worker, and now each band copies
   * its own share, which is the same bytes moved and then twelve heaps growing in parallel
   * instead of one growing alone.
   */
  #laneBand(job, rowStart, rowEnd) {
    const ss = job.supersample;
    const pad = ss === 1 ? 0 : TRAP_PAD_ROWS / 2;
    const first = Math.max(0, rowStart - pad) * ss;
    const last = Math.min(job.height, rowEnd + pad) * ss;
    const rows = last - first;
    const stride = job.sampleWidth * job.sampleHeight;
    const lanes = new Float64Array(rows * job.sampleWidth * job.shape.lanes);
    for (let lane = 0; lane < job.shape.lanes; lane++) {
      const at = lane * stride;
      lanes.set(
        job.lanes.subarray(at + first * job.sampleWidth, at + last * job.sampleWidth),
        lane * rows * job.sampleWidth,
      );
    }
    return [lanes.buffer, [lanes.buffer]];
  }

  /**
   * What that band cost, and what the rest of the queue should be cut at because of it.
   *
   * **Measured from the pass being drawn, and only from it.** A band that comes back after
   * its pass was abandoned is a true measurement of a picture nobody is looking at any
   * more, and seeding the next cut with it would cut the reader's actual view to a mode
   * they have just left. The estimate is a guess about what is next, so it is taken from
   * what is current.
   *
   * The re-cut is what makes the target self-calibrating: the opening cut of a pass is a
   * guess carried from the last one, the first band to report replaces the guess with a
   * measurement, and everything still queued is subdivided to match. A mode the page has
   * never drawn, on a machine nobody has measured, converges after one band.
   */
  #timed(worker, job) {
    const band = this.inflight.get(worker);
    if (band === undefined) return;
    this.inflight.delete(worker);
    const elapsed = performance.now() - band.at;
    job.record.bands.push({ at: band.at - job.record.at, rows: band.rows, ms: elapsed });
    // A shade band is a colouring and the estimate is about iteration, so it says
    // nothing here: seeding `rowCost` with one would cut the next field pass to what a
    // palette lookup costs.
    if (job.shade || job.generation !== this.generation || band.rows <= 0) return;
    const cost = elapsed / (band.rows * job.supersample * job.supersample);
    this.rowCost = this.rowCost === null ? cost : (this.rowCost + cost) / 2;
    this.queue = this.#cut(this.queue, job.supersample, job.shape);
  }

  #collect(worker, message, job) {
    if (message.kind !== "band") return;
    this.#timed(worker, job);
    if (message.job !== this.generation) {
      // A band from a view the reader has already moved on from. Dropped, and the
      // worker goes back in the pool for whatever is current now.
      if (!this.idle.includes(worker)) this.idle.push(worker);
      this.#dispatch(worker);
      return;
    }
    if (message.refused) {
      job.reject(new Error("the renderer refused this view"));
      this.job = null;
      return;
    }
    this.#place(job, message);
    job.done += message.rowEnd - message.rowStart;
    if (job.onProgress) job.onProgress(job.done / job.rows);
    if (job.done >= job.rows) {
      this.job = null;
      job.record.elapsed = performance.now() - job.started;
      job.resolve({
        values: job.values,
        shade: job.shade === true,
        width: job.width,
        height: job.height,
        supersample: job.supersample,
        shape: job.shape,
        elapsed: performance.now() - job.started,
      });
      if (!this.idle.includes(worker)) this.idle.push(worker);
      return;
    }
    this.#dispatch(worker);
  }

  /**
   * Write one band into the assembled frame.
   *
   * A field band is **lane-major** — lane 0's rows, then lane 1's — so it lands in
   * as many pieces as the coloring has fields, one per lane's own stride. A
   * painted band is one run of RGBA.
   */
  #place(job, message) {
    if (job.shape.probe) {
      job.values.set(new Uint8Array(message.band), message.rowStart * job.width * PROBE_BYTES);
      return;
    }
    if (job.shade || job.shape.direct) {
      job.values.set(new Uint8ClampedArray(message.band), message.rowStart * job.width * 4);
      return;
    }
    const span = (message.rowEnd - message.rowStart) * job.supersample;
    const band = new Float64Array(message.band);
    const stride = job.sampleWidth * job.sampleHeight;
    for (let lane = 0; lane < job.shape.lanes; lane++) {
      job.values.set(
        band.subarray(lane * span * job.sampleWidth, (lane + 1) * span * job.sampleWidth),
        lane * stride + message.rowStart * job.supersample * job.sampleWidth,
      );
    }
  }

  /**
   * Colour an assembled field, on this thread, and return it as `ImageData`.
   *
   * On this thread and not in a worker because the field is already here and the
   * shade is milliseconds: the whole reason the field and the colour are separate
   * exports is that one of them is cheap. A direct trap arrives already painted —
   * it never made a field — so there is nothing to do but hand the pixels over.
   */
  shade(field, view, { deriveWeight = false } = {}) {
    const started = performance.now();
    if (field.shape.direct) {
      return {
        image: new ImageData(field.values.slice(), field.width, field.height),
        elapsed: performance.now() - started,
      };
    }

    const wasm = this.shader;
    const [pointer, length] = this.#put(
      JSON.stringify(specOf(view, field.width, field.height, { supersample: field.supersample })),
    );
    const lanes = new Uint8Array(field.values.buffer, field.values.byteOffset, field.values.byteLength);
    const lanePointer = wasm.alloc(lanes.length);
    new Uint8Array(wasm.memory.buffer, lanePointer, lanes.length).set(lanes);

    // `shade_level` takes the lanes buffer and frees it — see its doc comment — so the
    // spec is deallocated here and the lanes deliberately are not. Asked to derive the
    // texture weight, it measures these lanes before it colours them, draws at what it
    // derived, and says what that was. The tone curve is never measured on this thread:
    // what is drawn here is a stage before the finished picture, and the curve belongs to
    // that one.
    const out = wasm.shade_level(
      pointer,
      length,
      lanePointer,
      lanes.length,
      deriveWeight ? DERIVE_WEIGHT : 0,
    );
    wasm.dealloc(pointer, length);
    if (out === 0) throw new Error("the renderer refused this palette recipe");

    const count = field.width * field.height;
    const header = new DataView(wasm.memory.buffer, out, SHADE_HEADER);
    const weight = header.getUint8(1) === 1 ? header.getFloat64(LEVEL_HEADER, true) : null;
    const rgba = new Uint8ClampedArray(wasm.memory.buffer, out + SHADE_HEADER, count * 4).slice();
    wasm.dealloc(out, SHADE_HEADER + count * 4);
    return {
      image: new ImageData(rgba, field.width, field.height),
      ...(deriveWeight ? { weight } : {}),
      elapsed: performance.now() - started,
    };
  }

  /**
   * Colour an assembled field **over the whole pool**, and return it as `ImageData`.
   *
   * The screen's finishing stage and every recolour of it. A shade used to be one
   * worker's whole job — 194 to 430 ms with eleven workers idle, and on a cheap view more
   * than the field it colours — because a frame is normalized against its own
   * distribution and a band coloured alone would be stretched against its own histogram.
   * Split into a reduction that answers those numbers and a colouring that is handed them,
   * every band is independent and the bytes are the whole frame's. `bands.test.mjs` holds
   * that to the module.
   *
   * Three things happen here and the order is the whole of it:
   *
   * 1. **The statistics, once.** In the kept worker, over the whole field, and
   *    **remembered** — they depend on the field and on the recipe's `transfer` and on
   *    nothing else, so a palette, gamma, cycles, phase or level edit spends the same
   *    answer and pays no reduction at all.
   * 2. **The stops, once.** The tone curve acts on the map rather than on the picture, so
   *    it is worth exactly one application: `curve_stops` measures it off the picture (a
   *    view the reader made) or replays the one the spec carries (a seat or a link), and
   *    what the bands are handed is the curved stops. The strip takes the same stops.
   * 3. **The colouring, over the pool.** One band a worker.
   *
   * A derived view colours twice, which is what the operator is: once to have a picture to
   * measure, once through the map that measurement curved. Both passes are pooled.
   *
   * **Where the statistics are the field over again, this hands the job back.** The
   * modulate and a rank transfer normalize by a sort of the frame's own samples — eight
   * bytes a sample — and sending that to twelve workers would cost more than the colouring
   * it splits. `shade_stats` says so and the one-worker shade takes it, unchanged.
   */
  async shadePooled(field, view, holder = {}, { derive = false, key = null } = {}) {
    const started = performance.now();
    // Cancelled once, here, and **not again between the phases**: the generation is what
    // says whether somebody else has asked for a different picture, and a phase that
    // bumped it on its way past would answer that question wrong for the phase after it.
    this.cancel();
    const generation = this.generation;
    const stats = await this.#statsOf(field, view, key, holder);
    if (stats === null || this.generation !== generation) return null;
    if (stats === false) {
      // Not poolable, and the one-worker shade is still the right answer — the page's own
      // kept worker, which holds a heap sized to a screen's frame rather than paying for a
      // fresh instance on every final pass the way a download's does. It takes the field by
      // transfer, so it gets a copy: the cache has to keep its own whole.
      return this.shading.shade({ ...field, values: field.values.slice() }, view, holder, {
        derive,
      });
    }

    const plain = specOf(view, field.width, field.height, {
      supersample: field.supersample,
      level: false,
    });
    let stops = null;
    let level = null;
    let image = null;

    if (derive) {
      const first = await this.#shadeBands(field, plain, stats, holder, generation);
      if (first === null) return null;
      const curved = await this.shading.curve(plain, first, holder);
      if (curved === null || this.generation !== generation) return null;
      if (!curved.ok) throw new Error(curved.why);
      stops = curved.colormap;
      level = curved.curve;
      image = curved.acts
        ? await this.#shadeBands(field, { ...plain, colormap: stops }, stats, holder, generation)
        : first;
      if (image === null) return null;
    } else if (view.level) {
      // A curve the view already carries. `resolve` would spend it again in every band,
      // and a per-stop cost is exactly what must not be paid per band.
      const replayed = specOf(view, field.width, field.height, {
        supersample: field.supersample,
      });
      const curved = await this.shading.curve(replayed, null, holder);
      if (curved === null || this.generation !== generation) return null;
      if (!curved.ok) throw new Error(curved.why);
      stops = curved.colormap;
      const levelled = { ...plain, colormap: stops };
      image = await this.#shadeBands(field, levelled, stats, holder, generation);
      if (image === null) return null;
    } else {
      image = await this.#shadeBands(field, plain, stats, holder, generation);
      if (image === null) return null;
    }

    return {
      image: new ImageData(image, field.width, field.height),
      ...(derive ? { level } : {}),
      stops,
      elapsed: performance.now() - started,
    };
  }

  /**
   * The statistics for this field, measured once in the kept worker and remembered.
   *
   * `false` where this coloring has none worth sending, `null` where the pass was
   * abandoned while they were being measured.
   */
  async #statsOf(field, view, key, holder) {
    const spec = specOf(view, field.width, field.height, {
      colormap: false,
      supersample: field.supersample,
      level: false,
    });
    // The transfer is the only part of the recipe a statistic reads, so it is the only
    // part of the recipe in the key.
    const remembered =
      key === null ? null : `${key}|${JSON.stringify(spec.palette?.transfer ?? null)}`;
    if (remembered !== null && this.measured.has(remembered)) {
      return this.measured.get(remembered);
    }
    const answer = await this.shading.stats(field, spec, holder);
    if (answer === null) return null;
    if (!answer.ok) throw new Error(answer.why);
    const held = answer.pooled ? answer.text : false;
    if (remembered !== null) {
      this.measured.set(remembered, held);
      while (this.measured.size > CACHE_LIMIT * 2) {
        this.measured.delete(this.measured.keys().next().value);
      }
    }
    return held;
  }

  /**
   * One pooled colouring of a field: the bands dispatched over the pool and assembled.
   *
   * **One band a worker**, where a field pass cuts four. A field band's cost is a property
   * of its rows — an interior-heavy band runs to the cap on every sample and a band of
   * open plane does not — so a field is cut finer than the pool to give the stragglers
   * somebody else's idle time. Colouring is a lookup per sample and costs the same
   * wherever the band lands, so there is nothing to balance and every extra band is a
   * message, a copy and a `#place` for no gain.
   */
  #shadeBands(field, spec, stats, holder, generation) {
    if (this.generation !== generation) return Promise.resolve(null);
    const { width, height, supersample } = field;
    const least = supersample > 1 ? Math.ceil(TRAP_PAD_ROWS / TRAP_PAD_SHARE) : MIN_BAND_ROWS;
    const bands = recut([[0, height]], Math.ceil(height / this.workers.length), least);
    const record = {
      kind: "shade",
      width,
      height,
      supersample,
      workers: this.workers.length,
      at: performance.now(),
      bands: [],
      elapsed: null,
    };
    passes.push(record);
    while (passes.length > PASSES_KEPT) passes.shift();

    return new Promise((resolve, reject) => {
      holder.stop = () => {
        if (this.generation === generation) this.cancel();
        else resolve(null);
      };
      this.job = {
        shade: true,
        record,
        generation,
        spec: JSON.stringify(spec),
        stats,
        shape: field.shape,
        width,
        height,
        supersample,
        sampleWidth: width * supersample,
        sampleHeight: height * supersample,
        lanes: field.values,
        values: new Uint8ClampedArray(width * height * 4),
        rows: height,
        done: 0,
        resolve,
        reject,
        started: performance.now(),
      };
      this.queue = bands;
      for (const worker of [...this.idle]) this.#dispatch(worker);
    }).then((answer) => (answer === null ? null : answer.values));
  }

}

/**
 * Colour an assembled field in a worker of its own, and throw the worker away.
 *
 * The download's shade, and only the download's. On this thread it is
 * milliseconds at a canvas's size and **seconds at a wallpaper's** — a 2560x1440
 * at four samples per pixel is sixty-four times a screen's samples — and a page
 * whose whole architecture is that the main thread never blocks cannot spend ten
 * of those seconds unable to repaint its own cancel button.
 *
 * A worker of its own, and not one of the pool's, because a wasm heap **never
 * gives memory back**: the instance that colours a fifty-nine-million-sample
 * frame grows to a couple of gigabytes and stays there for the rest of the
 * session. Terminating the worker is the only way to hand that back, and it costs
 * one instantiation of a module that is already compiled.
 *
 * `holder` is given a `stop` that ends the colouring for real — this is the one
 * place on the page where terminating a worker is the right answer rather than
 * the lazy one. A field band is cancelled by generation because killing a worker
 * mid-band would cost a wasm instantiation to save one band; a shade is a single
 * indivisible pass of many seconds, there is nothing to let it finish for, and it
 * is holding the memory. A stopped shade resolves with `null`.
 *
 * **`derive` is the operator's measure half, taken on this picture.** Set, the module
 * colours the field with no curve, measures what it drew, and where the tone sits
 * outside the band colours the same field again through the curve it derived — all in
 * one call, because the lanes are freed before the first byte of colour and a second
 * call would have to copy the whole field in again. What comes back carries `level`:
 * the curve in the permalink's own shape where it acted, and `null` where it did not.
 * Unset, the view's own curve is replayed exactly as it always was and `level` is not
 * reported.
 */
export function shadeApart(module, field, view, holder = {}, { derive = false } = {}) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./worker.js", import.meta.url), { type: "module" });
    const started = performance.now();
    holder.stop = () => {
      worker.terminate();
      resolve(null);
    };
    worker.onerror = (event) => {
      worker.terminate();
      reject(new Error(event.message ?? "the shade worker stopped"));
    };
    worker.onmessage = (event) => {
      if (event.data.kind === "ready") {
        const [message, transfer] = shadeMessage(field, view, derive);
        worker.postMessage(message, transfer);
        return;
      }
      worker.terminate();
      settleShade(event.data, field, derive, started, resolve, reject);
    };
    worker.postMessage({ kind: "start", module });
  });
}

/** What a shade worker is asked: the spec as text, the field's lanes transferred, and
 *  whether to measure the curve. The lanes buffer is detached by the transfer.
 *
 *  **`given` is the Deep tab's seam and nothing else uses it.** A deep field is drawn by
 *  `perturb.wasm` and coloured by this module, so its spec is built by `deep-render.js`
 *  against a placeholder viewport — `specOf` could not build it, because a deep view has
 *  no family, no mode and no coordinate a double could carry. Handing the spec in rather
 *  than widening `specOf` keeps the shallow spec exactly one shape. */
function shadeMessage(field, view, derive, given = null) {
  const lanes = field.values;
  const spec =
    given ??
    specOf(view, field.width, field.height, {
      supersample: field.supersample,
      level: !derive,
    });
  return [
    {
      kind: "shade",
      spec: JSON.stringify(spec),
      lanes: lanes.buffer,
      bytes: field.width * field.height * 4,
      derive,
    },
    [lanes.buffer],
  ];
}

/** A shade worker's answer, turned into what `shadeApart` and `ShadeWorker` resolve with. */
function settleShade(data, field, derive, started, resolve, reject) {
  if (data.refused) {
    reject(new Error("the renderer refused this palette recipe"));
    return;
  }
  // A worker.js older than the page — a browser's cached copy from before `level`
  // existed — answers without the key. It also drew no curve, so `null` is the truth
  // about its picture; the warning is what says the page is running two versions.
  if (derive && !("level" in data)) {
    console.warn(
      "shade worker reported no level: worker.js is older than render.js (a cached " +
        "copy?); the picture is unlevelled. Reload bypassing the cache.",
      Object.keys(data),
    );
  }
  resolve({
    image: new ImageData(new Uint8ClampedArray(data.image), field.width, field.height),
    ...(derive ? { level: data.level ?? null } : {}),
    elapsed: performance.now() - started,
  });
}

/**
 * One shade worker the screen keeps, one job in it at a time, and the jobs waiting.
 *
 * **One job is posted at a time**, and the next only once the worker has answered, so the
 * answer that lands is always the job in flight's: no id crosses to `worker.js`, and a
 * browser's cached copy of it answers this the same way it answers `shadeApart`.
 *
 * **A stop is not a termination here.** `shadeApart` kills its worker because the worker
 * holds a download's gigabytes; this one holds a screen's frame and is worth more warm than
 * the shade it would interrupt. A stopped job resolves with `null` at once. If it is still
 * waiting it is never posted, so a run of recolours — a palette list walked with the arrow
 * keys — colours the one in flight and the last one, and nothing between. If it is in
 * flight its answer is dropped when it lands, and the job behind it waits for that; its
 * `elapsed` counts the wait, since that is what the reader waited. A worker that fails is
 * dropped with every job rejected, and the next shade starts another.
 */
export class ShadeWorker {
  constructor(module) {
    this.module = module;
    this.worker = null;
    this.flight = null;
    this.waiting = [];
  }

  #start() {
    const worker = new Worker(new URL("./worker.js", import.meta.url), { type: "module" });
    worker.onmessage = (event) => {
      if (event.data.kind === "ready") return;
      const job = this.flight;
      this.flight = null;
      // **A reader that throws rejects its job, and the queue moves on regardless**
      // *(deep_stall_ckpt143)*. Uncaught here, a throw — an `ImageData` whose size the
      // answer does not fill, a `JSON.parse` of a reply — left that job's promise pending
      // for good and skipped the pump, so the jobs behind it waited for the next ask. A
      // pending shade is a Deep pass stuck in its colouring stage, which is not a stage the
      // watchdog counts.
      try {
        if (job !== null && !job.stopped) job.settle(event.data);
      } catch (error) {
        job.reject(error);
      } finally {
        this.#pump();
      }
    };
    worker.onerror = (event) => {
      worker.terminate();
      if (this.worker === worker) this.worker = null;
      const failed = [this.flight, ...this.waiting.splice(0)];
      this.flight = null;
      for (const job of failed) {
        if (job !== null && !job.stopped) {
          job.reject(new Error(event.message ?? "the shade worker stopped"));
        }
      }
    };
    worker.postMessage({ kind: "start", module: this.module });
    this.worker = worker;
  }

  /** Post the next job that is still wanted, if nothing is in flight. */
  #pump() {
    if (this.flight !== null) return;
    while (this.waiting.length > 0 && this.waiting[0].stopped) this.waiting.shift();
    const job = this.waiting.shift();
    if (job === undefined) return;
    this.warm();
    this.flight = job;
    this.worker.postMessage(job.message, job.transfer);
  }

  /** Start the worker ahead of the first shade, so that shade is not the one paying. */
  warm() {
    if (this.worker === null) this.#start();
  }

  /** Give the worker back. The page is going away; a job still waiting is dropped
   *  rather than rejected, because there is nobody left to tell. */
  stop() {
    this.worker?.terminate();
    this.worker = null;
    this.flight = null;
    this.waiting.length = 0;
  }

  /**
   * One job in the kept worker, in the order they were asked for.
   *
   * `settle` is the job's own reader of the worker's reply, because this worker answers
   * four different questions now and the reply shape is the question's. A stopped job
   * resolves with `null` at once and its answer is dropped when it lands.
   */
  #ask(message, transfer, holder, settle) {
    return new Promise((resolve, reject) => {
      const job = { message, transfer, resolve, reject, stopped: false, settle: null };
      job.settle = (data) => settle(data, resolve, reject);
      holder.stop = () => {
        job.stopped = true;
        resolve(null);
      };
      this.waiting.push(job);
      this.#pump();
    });
  }

  /** Colour a field, as `shadeApart` does. `field.values` is transferred when it is posted.
   *  `spec` is the Deep tab's seam — see `shadeMessage`. */
  shade(field, view, holder = {}, { derive = false, spec = null } = {}) {
    const [message, transfer] = shadeMessage(field, view, derive, spec);
    const started = performance.now();
    return this.#ask(message, transfer, holder, (data, resolve, reject) =>
      settleShade(data, field, derive, started, resolve, reject),
    );
  }

  /**
   * The frame-wide statistics a pooled shade spends, measured over this whole field.
   *
   * **The lanes are copied rather than transferred**, because the field in the cache has
   * to stay whole for the next recolour — and this is the one place a whole field crosses
   * to a worker at all now. It is worth it once: the answer is remembered, so a run of
   * palette edits over one field measures nothing after the first.
   */
  stats(field, spec, holder = {}) {
    const lanes = field.values.slice();
    return this.#ask(
      { kind: "stats", spec: JSON.stringify(spec), lanes: lanes.buffer },
      [lanes.buffer],
      holder,
      (data, resolve) => {
        // The statistics themselves, as the text a band is handed. A round trip through
        // JavaScript's numbers is exact in both directions — `serde_json` writes the
        // shortest decimal that reads back to the same `f64` and reads one back with
        // `float_roundtrip` — so what a band parses is bit for bit what was measured.
        const answer = JSON.parse(data.answer);
        const text = answer.ok && answer.pooled ? JSON.stringify(answer.stats) : null;
        resolve({ ...answer, text });
      },
    );
  }

  /**
   * The map's stops with this view's tone curve spent on them: measured off `image` where
   * one is given, replayed from the spec where it is not. See `curve_stops`.
   */
  curve(spec, image, holder = {}) {
    const message = { kind: "curve", spec: JSON.stringify(spec) };
    const transfer = [];
    if (image !== null) {
      // The picture is the caller's to keep — it is the one that goes on the screen where
      // no curve acts — so this is a copy and not a transfer.
      const copy = image.slice();
      message.image = copy.buffer;
      transfer.push(copy.buffer);
    }
    return this.#ask(message, transfer, holder, (data, resolve) =>
      resolve(JSON.parse(data.answer)),
    );
  }
}

/**
 * The spec `Renderer.ramp` shades: the view's recipe, map and curve over a field that is
 * the ramp itself. `colormap` is the map's control points, passed in so a test can hand
 * the module a map without the blob. See `ramp` for why each fixed field is what it is.
 */
export function rampSpecOf(view, colormap, samples, { direct = false, curved = false } = {}) {
  const recipe = direct ? { ...view.shade, gamma: 1, cycles: 1, phase: 0 } : view.shade;
  const spec = {
    schema: 1,
    family: { kind: "mandelbrot" },
    viewport: {},
    resolution: [samples, 3],
    mode: "smooth",
    palette: { ...recipe, transfer: { kind: "value" } },
    colormap,
  };
  // `curved` says the map handed in has the curve on it already — the very stops the
  // picture was drawn through, which the pass curved once and kept. Asking for the curve
  // again would spend `level::curved_stops` a second time on the same map for the same
  // answer, and that is per stop and hundreds of milliseconds on a map with hundreds.
  if (!direct && !curved && view.level) {
    spec.autolevel = {
      black_pt: view.level.black_pt,
      white_pt: view.level.white_pt,
      exponent: view.level.exponent,
      out_ends: view.level.out_ends,
    };
  }
  return spec;
}

/** The lanes `rampSpecOf` is shaded over, as bytes: the ramp from 0 to 1 across the first
 *  row, zeros across the second and ones across the third. The two flat rows are a third
 *  of the samples each, so the 0.5th and 99.5th percentiles are exactly 0 and 1. */
export function rampLanes(samples) {
  const lanes = new Float64Array(samples * 3);
  for (let at = 0; at < samples; at++) {
    lanes[at] = at / (samples - 1);
    lanes[2 * samples + at] = 1;
  }
  return new Uint8Array(lanes.buffer);
}

/** What `shade_level` puts in front of the picture: whether a curve acted and whether a
 *  weight was derived, padding, the curve's five `f64`, then the weight. See the crate. */
const LEVEL_HEADER = 48;
const SHADE_HEADER = LEVEL_HEADER + 8;

/** `shade_level`'s bit asking for the texture weight to be derived. */
const DERIVE_WEIGHT = 2;

/** The bytes a probe writes per pixel: hits and load, as `f32`. */
const PROBE_BYTES = 8;

/** How many probe pixels across. A probe walks the picture's own orbits on a grid a few
 *  percent of its size: enough hit pixels for a quantile to mean something, and cheap
 *  beside the quarter-size preview it runs before. */
export const PROBE_WIDTH = 160;

/** The probe grid for a canvas grid: `PROBE_WIDTH` across, at the canvas's own aspect. */
export function probeGrid(grid) {
  return {
    width: PROBE_WIDTH,
    height: Math.max(1, Math.round((PROBE_WIDTH * grid.height) / grid.width)),
  };
}

/**
 * The pixel grid a canvas of this display size is rendered on.
 *
 * Rounded to a multiple of the preview divisor on both axes, so the preview is
 * exactly the same rectangle of the plane at exactly a quarter of the samples. An
 * off-by-one there would give the preview a slightly different aspect and so a
 * slightly different vertical extent, and the picture would shift as it sharpened.
 */
export function pixelGrid(displayWidth, displayHeight) {
  const round = (value) =>
    Math.max(PREVIEW_DIVISOR, Math.round(value / PREVIEW_DIVISOR) * PREVIEW_DIVISOR);
  return { width: round(displayWidth), height: round(displayHeight) };
}
