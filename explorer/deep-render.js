// The deep renderer: `perturb.wasm` over a pool, and `engine.wasm` to colour what it drew.
//
// **Two modules, and they meet at a buffer of `f64` lanes.** `perturb.wasm` computes the
// smooth field of `z^d + c` for degrees two to six below the `f64` floor and knows nothing
// about colour; `engine.wasm` colours a smooth field and knows nothing about where it came
// from. What crosses between them is exactly what `engine.wasm`'s own `compute_band`
// produces for `smooth` — one lane, little-endian `f64`, `NaN` for the interior — so the
// existing `shade_level` reads it without being told which kernel drew it. Nothing in
// either module is linked into the other, which is what keeps the shallow path exactly as
// fast and exactly as many bytes as it was.
//
// **The shade spec carries a placeholder viewport, and that is sound rather than a
// shortcut.** `engine.wasm` refuses any spec whose viewport `f64` cannot resolve, and a
// deep viewport is precisely one of those — so the spec handed to `shade_level` names the
// Mandelbrot home instead. What makes that honest is that the colouring never reads it:
// `colour` in `engine-wasm/src/lib.rs` takes `sample_width`, `sample_height`, `out_width`,
// `out_height` and `supersample` off the viewport and nothing else, because a percentile
// stretch is a statement about the numbers in the buffer and not about where they were
// taken. `deep-shade.test.mjs` holds that to the committed module rather than to this
// comment: the same lanes under two different viewports come back byte for byte the same
// picture.
//
// **The orbit is the shape of everything here.** One high-precision reference orbit per
// frame, computed in one worker, sent to each of the others once, and held there across
// every band. A band call never computes one. See `deep-worker.js`.

import { BAND_TARGET_MS, bandsOf, recut } from "./render.js";
import { stopsOf } from "./stops.js";
import * as fx from "./deep-fx.js";

/** The pool, sized like the viewer's. A deep frame is the most arithmetic this page ever
 *  asks for, so there is no reason to give it less of the machine than a shallow one. */
const MAX_WORKERS = 16;
const DEFAULT_WORKERS = 8;

/**
 * The rows a band is cut to before anything about this frame has been measured.
 *
 * **Small, deliberately.** The viewer's opening cut is four bands to a worker, which is
 * right when a whole frame is a second: a quarter of it is a quarter of a second and the
 * per-band message is noise beside it. A deep frame is seconds to minutes, so a quarter of
 * one is a cancel the reader waits half a minute for. Two rows is a cut that is certainly
 * too fine and costs a few messages to find that out; the first band to report replaces it
 * with a measurement and everything still queued is re-cut to `BAND_TARGET_MS`. Erring
 * fine is the cheap direction: the overhead of a band that was too small is microseconds,
 * and the cost of one that was too big is the reader waiting.
 */
const OPENING_BAND_ROWS = 2;

/** How far over target a band may be predicted to run before the queue is re-cut. */
const RECUT_OVER = 1.5;

/**
 * The cap policy's probe grid: how many of the frame's own sample cells one rung of the
 * escalation looks at.
 *
 * **The page names it rather than the module**, because how finely to probe is a cost and
 * the pool is what pays it; `perturb-wasm`'s `policy::PROBE_COLS` and `PROBE_ROWS` are the
 * same two numbers as the crate's own default, and its harness measures at them. 2,304
 * samples is about a thousandth of one pass of a deep frame, and measured over the
 * thirteen frames of `perturb-wasm/tests/common` the whole escalation costs 0.08% to 0.22% of the
 * fine pass it decides the cap for.
 *
 * The rows are cut across the pool exactly as a band's are: one worker walking the whole
 * probe of the deepest frame at eight times the policy cap is about seven seconds nobody
 * can cancel, and over eight workers it is under a second.
 */
const PROBE_COLS = 64;
const PROBE_ROWS = 36;

/** The atom-domain grid the nucleus search walks, which is the probe's own — the same
 *  cells of the same frame, for the same cost reason. `perturb-wasm`'s `nuclei::GRID_COLS`
 *  and `GRID_ROWS` are the crate's defaults and its harness measures at them. */
const GRID_COLS = 64;
const GRID_ROWS = 36;

/** Newton steps one seed gets. The crate's `nuclei::MAX_STEPS`, against an expectation of
 *  three or four: the correction is formed in `f64`, so a step is worth sixteen digits
 *  past the size of the step before it and a solve converges quadratically. */
const NEWTON_STEPS = 8;

/** `2^k` where an `f64` still holds it, for a size that arrived as a logarithm because
 *  `|l|` at these depths runs past what an exponent carries. Zero underneath that, which
 *  is a minibrot no link could reach anyway. */
function sizeOf(log2) {
  if (!Number.isFinite(log2) || log2 < -1060) return 0;
  return 2 ** log2;
}

/** How many fraction digits a centre needs to place a pixel of a frame this wide: the
 *  width's own decade and eight guard digits, which is `tests/descend.rs`'s rule for the
 *  committed deep frames and puts the truncation well under a pixel. Held under
 *  `deep-fx`'s own ceiling, past which a coordinate is refused outright. */
function digitsFor(width) {
  const decade = width > 0 && Number.isFinite(width) ? Math.ceil(-Math.log10(width)) : 0;
  return Math.min(fx.MAX_SCALE, Math.max(0, decade) + 8);
}

/** A plain decimal's fraction, truncated toward zero. The text is always `to_decimal`'s —
 *  sign, digits, point, digits, never an exponent — so this is a substring and not a
 *  re-spelling, which is what keeps it exact down to the digit it stops at. */
function trim(text, digits) {
  const point = text.indexOf(".");
  if (point < 0) return text;
  return text.slice(0, point + 1 + digits);
}

/** Whether two solves landed on one minibrot — asked of **where they stopped and not of
 *  what they were asked for**, because a harmonic of a period lands on that period's own
 *  nucleus. `step` is one sample of the frame: two centres closer than that are one dot on
 *  the screen, and a harmonic is at distance zero. */
function near(a, b, step) {
  const apart = Math.max(
    Math.abs(fx.difference(a.x.dec, b.x.dec)),
    Math.abs(fx.difference(a.y.dec, b.y.dec)),
  );
  return apart <= step;
}

/** The share of a frame's height a copy's body should fill once it is opened: a quarter,
 *  `nuclei::TILE_BODIES`' own target. */
export const BODY_TARGET = 0.25;

/**
 * **The body a preview tile holds, measured** *(find_minibrots_bulbs_ckpt145)*: the rows
 * the interior component through the tile's centre spans, as a share of its height.
 *
 * The lanes are the field `field()` resolves with, one `f64` a sample and `NaN` for the
 * interior, so this reads the tile before it is coloured. The component is 4-connected and
 * starts at the interior sample nearest the centre within four samples — the tile is centred
 * on the nucleus, which is interior — so a copy's cardioid and its bulbs count and the
 * filaments round it do not.
 *
 * `null` where there is nothing to measure: no interior near the centre, a component that
 * reaches the tile's edge (a lower bound, not a measurement), or one under four rows, where
 * a row either way is more than a tenth of the answer. `tests/measure.rs`'s `body_share` is
 * the same measurement natively, and is what the fallback factors were calibrated with.
 */
export function bodyShare(values, width, height) {
  const inside = (at) => Number.isNaN(values[at]);
  const cx = width >> 1;
  const cy = height >> 1;
  let start = -1;
  search: for (let r = 0; r <= 4; r++) {
    for (let y = Math.max(0, cy - r); y <= Math.min(height - 1, cy + r); y++) {
      for (let x = Math.max(0, cx - r); x <= Math.min(width - 1, cx + r); x++) {
        if (inside(y * width + x)) {
          start = y * width + x;
          break search;
        }
      }
    }
  }
  if (start < 0) return null;
  const seen = new Uint8Array(width * height);
  const stack = [start];
  seen[start] = 1;
  let top = height;
  let bottom = 0;
  while (stack.length > 0) {
    const at = stack.pop();
    const x = at % width;
    const y = (at - x) / width;
    if (x === 0 || y === 0 || x === width - 1 || y === height - 1) return null;
    top = Math.min(top, y);
    bottom = Math.max(bottom, y);
    for (const next of [at - 1, at + 1, at - width, at + width]) {
      if (!seen[next] && inside(next)) {
        seen[next] = 1;
        stack.push(next);
      }
    }
  }
  const rows = bottom - top + 1;
  return rows < 4 ? null : rows / height;
}

/** The viewport the shade spec names, so that `engine.wasm` has one it can resolve.
 *
 *  Left empty, which the module reads as the family's own home view — the most obviously
 *  placeholder thing available, and one whose resolvability is not a number written down
 *  here. See the note at the top of this file for why the colouring cannot see it. */
const SHADE_VIEWPORT = {};

/** The spec `shade_level` is handed for a deep field.
 *
 *  `palette` is the view's seven shade keys handed over as they stand — they ARE the
 *  engine's palette recipe, which is why the deep link spells them the shallow link's way
 *  and why nothing is translated here. `autolevel` rides beside them under the operator's
 *  own field names, as it does on the shallow path.
 *
 *  `colormap` is passed in rather than looked up, which is `rampSpecOf`'s shape and is
 *  there for `rampSpecOf`'s reason: it lets `deep.test.mjs` hand the module a map without
 *  the blob, and the blob is a fetch this page makes and a test does not. */
export function shadeSpecOf(view, colormap, width, height, { supersample = 1, level = true } = {}) {
  const spec = {
    schema: 1,
    // **A placeholder too, and for the viewport's reason** *(deep_degrees_ckpt140)*: the
    // colouring reads the buffer and not the family, so a degree-5 field is shaded under
    // the Mandelbrot name. `deep.test.mjs` holds that to the committed module.
    family: { kind: "mandelbrot" },
    viewport: SHADE_VIEWPORT,
    resolution: [width, height],
    mode: "smooth",
    palette: view.shade,
    colormap,
  };
  if (supersample > 1) spec.supersample = supersample;
  if (level && view.level) {
    spec.autolevel = {
      black_pt: view.level.black_pt,
      white_pt: view.level.white_pt,
      exponent: view.level.exponent,
      out_ends: view.level.out_ends,
    };
  }
  return spec;
}

/** The spec `perturb.wasm` is handed for a frame.
 *
 *  The centre crosses as **text** and nothing else will do: the module's own `Spec::parse`
 *  refuses a coordinate written as a JSON number by name, because a number has already
 *  lost the digits both this file and that one exist for. */
export function deepSpecOf(
  view,
  width,
  height,
  { supersample = 1, reference = null, period = null, interior = true } = {},
) {
  const spec = {
    schema: 1,
    center_re: view.x.text,
    center_im: view.y.text,
    width: view.w.value,
    resolution: [width, height],
    maxiter: view.maxiter,
  };
  if (supersample > 1) spec.supersample = supersample;
  // **The interior switch, only where it is turned off** *(profiling_pass_ckpt146)*: the
  // kernel ships it on, so a spec with the switch on is byte for byte the spec it was. It
  // never moves a pixel — a sample it stops early is one the plain loop runs to the cap,
  // and both write `NaN` — so which way it is set is a speed and nothing else. See
  // `switchFor` in `deep.js`.
  if (interior === false) spec.interior = false;
  // The degree, where it is not two: the kernel's default is two, so a degree-2 spec is
  // byte for byte the spec it was before the member existed.
  if ((view.degree ?? 2) !== 2) spec.degree = view.degree;
  if (view.julia !== null && view.julia !== undefined) {
    spec.julia_re = view.julia.x.text;
    spec.julia_im = view.julia.y.text;
    spec.anchor = anchorOf(view);
  } else if (reference !== null) {
    spec.reference_re = reference.x;
    spec.reference_im = reference.y;
  }
  // **A named period makes the reference periodic**, which is the whole payoff of having
  // solved a nucleus: the orbit is stored for one period and the index wraps instead of
  // rebasing. It rides beside the reference rather than inside it because the kernel takes
  // it that way, and a tile centred on its own nucleus names no reference at all — the
  // centre already is one.
  if (period !== null && period > 0) spec.period = period;
  return spec;
}

/**
 * Which of a Julia frame's two anchors it is drawn from: the nearer one.
 *
 * **Derived from the view and never carried in the link**, which is the ruling
 * worth stating. Both anchors are points of the same stored orbit and both are
 * exact, so they are two spellings of one picture — what differs is only how much
 * of the pixel step survives into the `f64` delta, and that is a property of where
 * the frame is rather than a decision anybody made about it. A link that carried
 * the anchor would be carrying a precision choice as though it were part of the
 * picture, and would go stale the moment the reader panned.
 *
 * The distance is the larger of the two components, because that is the number the
 * kernel's own `delta_ulps` is taken against. Ties go to the parameter, which is
 * where the filigree is and so where a reader is more likely to be.
 */
export function anchorOf(view) {
  if (!view.julia) return null;
  const toParameter = Math.max(
    Math.abs(fx.difference(view.x.dec, view.julia.x.dec)),
    Math.abs(fx.difference(view.y.dec, view.julia.y.dec)),
  );
  const toOrigin = Math.max(Math.abs(fx.toNumber(view.x.dec)), Math.abs(fx.toNumber(view.y.dec)));
  return toOrigin < toParameter ? "origin" : "parameter";
}

/**
 * What makes one reference orbit a different object from another, as a string.
 *
 * Not "where it is" — that is the reach test, and it is a distance rather than a
 * comparison. This is the part of an orbit that has to **match**, and every piece of it
 * is a way a held orbit would be silently wrong for a frame rather than merely unhelpful:
 *
 * - **the limb count**, because the points were computed to that many and a deeper view
 *   wants precision they do not carry;
 * - **the period**, because a periodic orbit is stored for one period and the kernel's
 *   index wraps into it — hand one to a frame that wanted the full walk and it says the
 *   reference returns to the origin when it does not;
 * - **which set, and at what parameter.** A Julia orbit and a Mandelbrot orbit are never
 *   swapped for each other even at the same point, because a view entered at `Z₁` is
 *   handed an orbit one step longer.
 * - **the degree**, because the orbit of `z³ + c` at a point is not the orbit of `z² + c`
 *   there, and a degree change keeps the centre, the width and the cap.
 *
 * One string rather than a field-by-field compare because the compare was the thing that
 * had to be remembered: `julia` was wanted when the Julia case landed and `period` when a
 * nucleus could be the reference, and each was a line somebody had to think to add. The
 * same move `deepLink.fieldKey` already makes for a field.
 */
export function orbitKey(view, limbs, period = null) {
  const plane = view.julia ? `j:${view.julia.x.text},${view.julia.y.text}` : "m";
  const set = `${plane}^${view.degree ?? 2}`;
  return `${set}|${limbs}|${period ?? "-"}`;
}

/** One pool worker, instantiated and ready. */
function spawn(module) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./deep-worker.js", import.meta.url), { type: "module" });
    worker.onmessage = (event) => {
      if (event.data.kind === "ready") {
        worker.onerror = null;
        resolve(worker);
      }
    };
    // As `render.js`'s: a worker whose script never arrived rejects rather than leaving the
    // tab on "starting the deep renderer…" for good (profiling_pass_ckpt146).
    worker.onerror = (event) => {
      worker.terminate();
      reject(new Error(`a deep worker did not start (${event.message || "its script did not load"})`));
    };
    worker.postMessage({ kind: "start", module });
  });
}

/**
 * Everything the Deep tab needs to draw, once `perturb.wasm` is compiled and the pool is up.
 *
 * **One request per worker at a time, matched by id, and a worker is idle exactly when it
 * has none outstanding** *(deep_tab_activity_and_layout_ckpt141)*. That sentence replaces a
 * hand-kept `idle` list and a worker handler that each caller swapped in and out, and the
 * pair of them was the bug the test frame was stuck on: a cancel left in-flight workers off
 * the list, the next probe's handler swallowed their late bands, and after three gestures
 * during a pass no worker was idle and the frame never started. Nothing is kept by hand
 * now — `#slot.busy` is the only record of whether a worker is working, and the router
 * that clears it is installed once, when the worker is born.
 *
 * **Cancel ends every worker that is working, and the pool comes back idle.** A wasm call
 * cannot be interrupted, and the long ones — a reference orbit at a million, a probe rung
 * beside a parabolic point — are seconds to minutes, so a cancel that waited for them was
 * not a cancel. A busy worker is terminated and a fresh one started from the module already
 * compiled, which costs a few milliseconds; it is fed the held orbit again the next time a
 * request needs it, and that is the whole cost of being able to stop anything.
 */
export class DeepRenderer {
  constructor(module, planner, workers, shading) {
    this.module = module;
    /** A main-thread instance, for `plan` and the policy's small questions. Never for an
     *  orbit, which is a worker's (see `#reference`). */
    this.planner = planner;
    /** The pool: `{ worker, ready, busy, fed }` a worker. `busy` is the request in flight
     *  or `null`; `ready` resolves once a (re)started worker is up; `fed` is the stamp of
     *  the orbit it holds. */
    this.slots = workers.map((worker) => this.#slotOf(worker));
    /** The page's own shade worker, over `engine.wasm`. Deep fields are coloured there for
     *  the reason the viewer's final stage is: a recolour of a frame that took a minute
     *  must not freeze the page for half a second. */
    this.shading = shading;
    this.generation = 0;
    this.queue = [];
    this.job = null;
    this.requests = 0;
    /** Milliseconds per output row per sample-per-pixel, as the last bands measured it. */
    this.rowCost = null;
    /** The reference orbit the pool holds: its bytes, the point it is of, the cap and the
     *  limb count it was computed at, its stamp, and its reach. `null` before the first. */
    this.orbit = null;
    this.orbits = 0;
    /** When any worker was last heard from — a reply or a progress message. What the tab's
     *  watchdog reads: a pool that has said nothing for ten seconds is not a slow frame. */
    this.heard = performance.now();
    /** Called with every message a worker sends, for the tab's log. `null` is silence. */
    this.onMessage = null;
  }

  static async start(url, engineShading, wanted) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${url}: ${response.status} ${response.statusText}`);
    const module = await WebAssembly.compile(await response.arrayBuffer());
    // The module's one import, and on this thread there is nobody to tell: the planner
    // answers `plan` and the policy's constants, all of which are microseconds.
    const planner = new WebAssembly.Instance(module, PLANNER_IMPORTS).exports;
    const count =
      wanted ?? Math.min(MAX_WORKERS, navigator.hardwareConcurrency || DEFAULT_WORKERS);
    const workers = [];
    for (let index = 0; index < Math.max(1, count); index++) workers.push(await spawn(module));
    return new DeepRenderer(module, planner, workers, engineShading);
  }

  get workerCount() {
    return this.slots.length;
  }

  /** Whether any worker has a request in flight. */
  get busy() {
    return this.slots.some((slot) => slot.busy !== null);
  }

  #slotOf(worker) {
    const slot = { worker, ready: Promise.resolve(), busy: null, fed: null };
    this.#route(slot);
    return slot;
  }

  /** The one handler a worker ever has. A reply settles the request with its id and frees
   *  the worker; a progress message goes to that request's listener; anything else — a
   *  reply to a request that was cancelled — is dropped, and the worker is still free. */
  #route(slot) {
    slot.worker.onmessage = (event) => {
      const message = event.data;
      this.heard = performance.now();
      this.onMessage?.(message);
      const busy = slot.busy;
      if (busy === null || message.id !== busy.id) return;
      if (message.kind === "progress") {
        busy.onProgress?.(message.done, message.total);
        return;
      }
      slot.busy = null;
      busy.resolve(message);
    };
  }

  /** Put a worker back as it was born: terminated, restarted from the compiled module, and
   *  holding no orbit. Whatever it was asked is answered `null`. */
  #restart(slot) {
    const busy = slot.busy;
    slot.busy = null;
    slot.worker.terminate();
    slot.fed = null;
    slot.ready = spawn(this.module).then((worker) => {
      slot.worker = worker;
      this.#route(slot);
    });
    // Whoever next waits on the slot hears a failed start; nobody waiting is not a fault.
    slot.ready.catch(() => {});
    busy?.resolve(null);
  }

  /**
   * Ask one worker one thing, and resolve with its reply — or with `null` where the request
   * was cancelled before it was answered.
   *
   * The worker must be free; every caller here waits for a reply before it asks the same
   * worker again, which is what one-at-a-time means, and a request sent to a busy worker
   * is a mistake of this file's and is thrown as one.
   *
   * **A request asked before a cancel is never sent after it** *(deep_stall_ckpt143)*. A
   * cancel restarts a busy worker and `ready` is then a pending start, so everything asked
   * of that worker waits on it — a cancelled pass's orbit feed as well as the new pass's.
   * The one asked first resumed first, took the worker for a generation nobody wanted, and
   * the new pass's request found it busy and threw this file's own mistake: the pass died
   * as *the deep render failed*, measured over CDP on a zoom during a tangle 1e-22 pass. So
   * the generation is read when a request is asked, and one the pool has moved past while
   * it waited resolves `null`, which is what a cancelled request already means here.
   */
  async #send(slot, message, { onProgress, transfer = [] } = {}) {
    const generation = this.generation;
    await slot.ready;
    if (generation !== this.generation) return null;
    if (slot.busy !== null) throw new Error("a deep worker was asked two things at once");
    const id = ++this.requests;
    return new Promise((resolve) => {
      slot.busy = { id, kind: message.kind, resolve, onProgress, at: performance.now() };
      slot.worker.postMessage({ ...message, id }, transfer);
    });
  }

  /** Write a string into the planner's heap, call an export with it, and free it.
   *
   *  The same shape `deep-worker.js` uses on its own instance, for the same reason: a
   *  spec goes in, something comes back, and the allocation is nobody's business
   *  afterwards. */
  #with(text, call) {
    const raw = new TextEncoder().encode(text);
    const pointer = this.planner.alloc(raw.length);
    new Uint8Array(this.planner.memory.buffer, pointer, raw.length).set(raw);
    try {
      return call(pointer, raw.length);
    } finally {
      this.planner.dealloc(pointer, raw.length);
    }
  }

  /** Read back what a report-returning export left: four bytes of little-endian length,
   *  then the UTF-8, and the whole buffer freed. */
  #take(out) {
    const size = new DataView(this.planner.memory.buffer).getUint32(out, true);
    const body = new TextDecoder().decode(
      new Uint8Array(this.planner.memory.buffer, out + 4, size),
    );
    this.planner.dealloc(out, size + 4);
    return JSON.parse(body);
  }

  /** What this spec implies, or why it cannot be drawn: the kernel's own answer. */
  plan(spec) {
    return this.#with(JSON.stringify(spec), (pointer, length) =>
      this.#take(this.planner.plan(pointer, length)),
    );
  }

  /** The kernel's cap policy — the engine's shape, with the engine's ceiling lifted. */
  maxiter(width) {
    return this.planner.maxiter_for_width(width);
  }

  /** How many 64-bit limbs a view of this width and this many samples across is computed
   *  at: the one number that says what the reference orbit will cost. */
  limbs(width, sampleWidth) {
    return this.planner.limbs_for_width(width, sampleWidth);
  }

  /** How wide a preview tile of a minibrot this size is — twelve body widths, the crate's
   *  `nuclei::TILE_BODIES`, which is also the frame an entry opens at. */
  tileWidth(size) {
    return this.planner.tile_width(size);
  }

  /** How wide a copy of this size is framed before its body has been measured, or where
   *  it cannot be: twelve sizes times the degree's calibrated factor, the crate's
   *  `nuclei::copy_width`. A bulb keeps `tileWidth`. */
  copyWidth(size, degree = 2) {
    return this.planner.copy_width(size, degree);
  }

  /**
   * The cap a preview tile of a period-`p` nucleus is drawn at.
   *
   * **Asked and never guessed**, and it is emphatically not the width policy: a tile needs
   * eight periods of its own nucleus before a minibrot's neighbourhood resolves at all, and
   * the width policy at a tile's width gives about one and a half. `nuclei::TILE_PERIODS`
   * in the crate is where that is measured; a page that used the width's answer would draw
   * a flat black rectangle, slowly.
   */
  tileCap(period, width) {
    return this.planner.tile_cap(period, width);
  }

  /**
   * The cap an opened minibrot of period `p` is drawn at, and the `n` its link carries:
   * thirty-two periods of it, or the width policy where that is more, under the ceiling.
   *
   * **Four times a tile's**, because a tile's eight was measured on a 316-pixel preview
   * and the frame a reader opens is the viewer's own, where a copy at about thirteen
   * periods is an all-black blob. `nuclei::OPEN_PERIODS` is where that is said.
   */
  openCap(period, width) {
    return this.planner.open_cap(period, width);
  }

  /** The share of a frame that may still be the cap's fault before the cap is raised.
   *  The kernel's `policy::FAULT_SHARE`, asked rather than restated. */
  get faultShare() {
    return this.planner.fault_share();
  }

  /**
   * **The cap this frame asks for**, walked a rung at a time.
   *
   * Opens at the view's own cap — the width policy's, since a reader who has pinned one
   * never reaches here — renders [`PROBE_COLS`] × [`PROBE_ROWS`] of the frame's own sample
   * cells at it, and doubles while more than `faultShare` of those cells died at the cap
   * with `|dz|` grown past the escape radius. The crate's `policy` module is where the
   * three kinds of cap-death are set out and why only that one is a fault; what is here is
   * the loop and the pool.
   *
   * `onStep` hears the rung's two halves as they go: `{ phase: "orbit", done, total, cap,
   * rung }` in iterations of the reference, then `{ phase: "probe", done, total, cap, rung }`
   * in cells of the probe, summed over the pool.
   *
   * Resolves with `{ maxiter, from, steps, atCeiling, fault, rungs, iterations, elapsed }`,
   * or `null` where a newer generation started while it ran.
   *
   * **The probe is a subset of the frame, not a smaller picture of it**: the cells, the
   * limb count, the geometry and the reference orbit are the frame's own, so the fine pass
   * runs once, at the cap this settled on, and nothing about the decision is an
   * approximation of the thing being decided.
   */
  async settle(view, width, height, { supersample = 1, onRung, onStep } = {}) {
    this.cancel();
    const generation = this.generation;
    const started = performance.now();
    const from = view.maxiter;
    let at = view;
    let iterations = 0;
    const rungs = [];

    for (;;) {
      const rung = rungs.length + 1;
      const cap = at.maxiter;
      const reference = await this.#reference(at, width, height, supersample, null, {
        generation,
        onProgress: (done, total) => onStep?.({ phase: "orbit", done, total, cap, rung }),
      });
      if (generation !== this.generation) return null;
      if (reference === null) {
        throw new Error("the kernel could not compute a reference orbit for this view");
      }
      const spec = deepSpecOf(at, width, height, { supersample, reference });
      const counts = await this.#probe(JSON.stringify(spec), generation, (done, total) =>
        onStep?.({ phase: "probe", done, total, cap, rung }),
      );
      if (counts === null || generation !== this.generation) return null;
      iterations += counts.iterations;
      rungs.push(counts);
      onRung?.(counts, rungs.length);

      const fault = counts.samples > 0 ? counts.fault / counts.samples : 0;
      const next = this.planner.next_cap(at.maxiter);
      // Resolved, or there is nowhere left to go: `next_cap` saturates at the kernel's
      // ceiling and hands back the cap it was given, which is what ends the walk.
      if (fault <= this.faultShare || next === at.maxiter) {
        return {
          maxiter: at.maxiter,
          from,
          steps: rungs.length - 1,
          atCeiling: fault > this.faultShare,
          fault,
          rungs,
          iterations,
          elapsed: performance.now() - started,
        };
      }
      at = { ...at, maxiter: next };
    }
  }

  /** One rung's counts, over the pool. The probe's rows are cut between the workers and
   *  the counts summed; a band that comes back refused is the rung's error. */
  async #probe(spec, generation, onProgress) {
    const shares = await this.#shares(
      "probe",
      "counts",
      "the kernel refused to probe this view",
      spec,
      PROBE_COLS,
      PROBE_ROWS,
      generation,
      onProgress,
    );
    if (shares === null) return null;
    const total = {
      maxiter: 0,
      samples: 0,
      escaped: 0,
      proven: 0,
      starved: 0,
      fault: 0,
      iterations: 0,
    };
    for (const counts of shares) {
      for (const key of ["samples", "escaped", "proven", "starved", "fault", "iterations"]) {
        total[key] += counts[key];
      }
      total.maxiter = Math.max(total.maxiter, counts.maxiter);
    }
    return total;
  }

  /**
   * The minibrots in and around this view, largest first.
   *
   * **Three phases, and only the third streams.** The domain walk goes over the pool in
   * bands like a probe; the solves go over the pool too, one seed to a worker, because a
   * Newton step reads no orbit and so any worker can take any step of any seed. Only when
   * every solve is in can the list be *ranked*, which is what the reader is promised —
   * largest first — so the tiles are drawn after that, one at a time, and `onFound` is
   * what lets the caller put each one up as it lands.
   *
   * Drawing is serial and has to be: the pool holds one reference orbit between all its
   * workers, and every tile wants a different one. That is also why the view's own orbit
   * is gone afterwards and the next Render recomputes it.
   *
   * Resolves with `null` where a newer generation started, as everything here does.
   */
  async nuclei(view, width, height, { supersample = 1, tileSamples = 316, budget = 12, want = 6, onStep } = {}) {
    this.cancel();
    const generation = this.generation;
    const reference = await this.#reference(view, width, height, supersample, null, {
      generation,
      onProgress: (done, total) => onStep?.({ phase: "orbit", done, total }),
    });
    if (generation !== this.generation) return null;
    if (reference === null) {
      throw new Error("the kernel could not compute a reference orbit for this view");
    }
    const spec = JSON.stringify(deepSpecOf(view, width, height, { supersample, reference }));
    const seeds = await this.#seeds(spec, generation, (done, total) =>
      onStep?.({ phase: "seeds", done, total }),
    );
    if (seeds === null || generation !== this.generation) return null;

    // Widest domain first: the cells a domain takes on the grid are a free measure of how
    // much of the frame its nucleus dominates, and a domain's scale is its body's square
    // root — so this is the cheap proxy for "largest", spent before any solve is.
    seeds.sort((a, b) => b.cells - a.cells || a.minimum - b.minimum);
    // **Twelve solves for six entries**, which is `tests/measure.rs`'s own budget: the
    // harmonics and the one body that contains the whole view are only found by solving
    // them, so a budget equal to `want` returns fewer than `want`. Twelve is two rounds
    // over an eight-worker pool, and a solve is 0.05 s at 2e-11 and 2 s at 1e-54.
    const chosen = seeds.slice(0, budget);
    const degree = view.degree ?? 2;
    const limbs = this.planner.nucleus_limbs(view.w.value, tileSamples, degree);

    let settled = 0;
    const lanes = this.slots.map((slot, index) => {
      const mine = chosen.filter((_, at) => at % this.slots.length === index);
      return this.#solveEach(slot, mine, view, limbs, generation, () =>
        onStep?.({ phase: "solves", done: ++settled, total: chosen.length }),
      );
    });
    const solved = (await Promise.all(lanes)).flat();
    if (generation !== this.generation) return null;

    // **Lowest period first, then one nucleus per place** — `perturb-wasm`'s `nuclei`
    // module keeps the same two rules in the same order, and its own tests are where they
    // are argued. A period-`p` nucleus satisfies `z_kp(c) = 0` for every multiple, so the
    // walk reports harmonics and Newton takes each of them to the *same point* with a
    // collapsed size; keeping the lowest period at each place is what makes the size real.
    // And a minibrot larger than the view is not in the view, it contains it.
    const step = view.w.value / (width * supersample);
    const distinct = [];
    for (const nucleus of solved.sort((a, b) => a.period - b.period)) {
      if (distinct.some((held) => near(held, nucleus, step))) continue;
      if (!(nucleus.size > 0) || nucleus.size >= view.w.value) continue;
      distinct.push(nucleus);
    }
    distinct.sort((a, b) => b.sizeLog2 - a.sizeLog2);

    // **Copies first, and bulbs only where the view holds no copy**
    // *(find_minibrots_bulbs_ckpt145)*. A satellite bulb is a nucleus like any other and
    // the walk finds them readily — seven of the thirteen entries the last check opened
    // were bulbs — but a bulb is not a copy. Every distinct nucleus is read, not only the
    // first `want`, because a list of copies is filled from all of them; `perturb-wasm`'s
    // `nuclei::classify` is the reading and `nuclei::copies_first` the same rule natively.
    let read = 0;
    const readings = this.slots.map((slot, index) => {
      const mine = distinct.filter((_, at) => at % this.slots.length === index);
      return this.#classifyEach(slot, mine, limbs, degree, generation, () =>
        onStep?.({ phase: "classify", done: ++read, total: distinct.length }),
      );
    });
    await Promise.all(readings);
    if (generation !== this.generation) return null;
    const copies = distinct.filter((nucleus) => nucleus.kind === "copy");
    return (copies.length > 0 ? copies : distinct).slice(0, want);
  }

  /** Every nucleus in this lane read as a copy or a bulb, on this worker, in turn. A
   *  reading the module refuses leaves its nucleus a copy, which is what the list offered
   *  before there was a reading at all. */
  async #classifyEach(slot, mine, limbs, degree, generation, onRead) {
    for (const nucleus of mine) {
      if (generation !== this.generation) return;
      const reply = await this.#send(slot, {
        kind: "classify",
        request: JSON.stringify({
          c_re: nucleus.x.text,
          c_im: nucleus.y.text,
          period: nucleus.period,
          limbs,
          degree,
          size_log2: nucleus.sizeLog2,
        }),
      });
      const reading = reply?.reading ?? null;
      nucleus.kind = reading?.ok ? reading.kind : "copy";
      nucleus.parent = reading?.ok ? reading.parent : 0;
      nucleus.m = reading?.ok ? reading.m : 0;
      onRead();
    }
  }

  /** The domain walk over the pool, its rows cut between the workers and its seeds merged
   *  by period: cells add, and the smallest approach keeps its cell. */
  async #seeds(spec, generation, onProgress) {
    const shares = await this.#shares(
      "seeds",
      "found",
      "the kernel refused to walk this view",
      spec,
      GRID_COLS,
      GRID_ROWS,
      generation,
      onProgress,
    );
    if (shares === null) return null;
    const merged = new Map();
    for (const found of shares) {
      for (const seed of found.seeds) {
        const held = merged.get(seed.period);
        if (held === undefined) merged.set(seed.period, { ...seed });
        else {
          held.cells += seed.cells;
          if (seed.minimum < held.minimum) {
            held.minimum = seed.minimum;
            held.from_re = seed.from_re;
            held.from_im = seed.from_im;
          }
        }
      }
    }
    return [...merged.values()];
  }

  /** Every seed in this lane, solved on this worker, in turn. */
  async #solveEach(slot, mine, view, limbs, generation, onSolved) {
    const solved = [];
    for (const seed of mine) {
      if (generation !== this.generation) return solved;
      const nucleus = await this.#solve(slot, seed, view, limbs, generation);
      onSolved();
      if (nucleus !== null) solved.push(nucleus);
    }
    return solved;
  }

  /**
   * Newton from one seed until it stops moving.
   *
   * **The centre is exact on the way in and on the way out.** The seed's offset is a
   * fraction of the view's width and so an `f64`, which becomes an exact decimal through
   * `fromNumber` and is added to the centre in `deep-fx`'s own arithmetic; the module
   * hands back every digit of what it stored, and that text goes straight back in as the
   * next step's input. Nothing is narrowed between steps, which is the only reason a
   * solve converges past 1e-38 at all.
   */
  async #solve(slot, seed, view, limbs, generation) {
    let re = fx.text(fx.add(view.x.dec, fx.fromNumber(seed.from_re) ?? fx.ZERO));
    let im = fx.text(fx.add(view.y.dec, fx.fromNumber(seed.from_im) ?? fx.ZERO));
    // The body is the view's width squared, near enough — to the power `d/(d−1)` at degree
    // `d`, `nuclei::body_power` — and this is eight digits below it. Newton stalls at its
    // own `f64` floor well above this; the stall is the real end.
    const degree = view.degree ?? 2;
    const power = degree === 2 ? 2 : degree / (degree - 1);
    const tolerance = view.w.value ** power * 1e-8;
    let last = Infinity;
    for (let step = 1; step <= NEWTON_STEPS; step++) {
      if (generation !== this.generation) return null;
      const reply = await this.#send(slot, {
        kind: "newton",
        request: JSON.stringify({ c_re: re, c_im: im, period: seed.period, limbs, degree }),
      });
      const answer = reply?.step ?? null;
      if (answer === null || !answer.ok || answer.escaped) return null;
      re = answer.c_re;
      im = answer.c_im;
      const done = answer.moved <= tolerance || !(answer.moved < last);
      last = answer.moved;
      if (done || step === NEWTON_STEPS) {
        // **Trimmed here and nowhere earlier.** The module hands back every digit of what
        // it stored — `64(limbs-1)`, about two hundred — because that text goes straight
        // back in as the next step's input and a truncation between steps would be
        // precision thrown away once a step. But `deep-fx` caps a coordinate at
        // `MAX_SCALE` digits and refuses anything longer, so the *answer* has to come down
        // to what the picture needs: the tile's own decade and eight guard digits, which
        // puts the truncation far under one of its pixels. Not doing this was worth
        // finding: `fx.parse` returned null on every solve and the list came back empty.
        const digits = digitsFor(sizeOf(answer.size_log2) * this.planner.tile_width(1));
        const trimmed = { x: trim(re, digits), y: trim(im, digits) };
        // **The two refusals are not the same refusal, and only one of them is this
        // seed's fault.** A coordinate that is not a decimal at all means the module
        // answered with something unreadable — drop the seed, the way an unconverged one
        // is dropped. A coordinate that is merely *longer than `deep-fx` carries* means
        // the trim above did not do its job, which is this page's own mistake and is
        // exactly the bug that made every solve come back empty with a clean console.
        // That one is said out loud rather than counted as a seed that did not converge.
        for (const [axis, text] of Object.entries(trimmed)) {
          if (fx.refusal(text) === fx.TOO_LONG) {
            throw new Error(
              `the solver's ${axis} is ${text.length} digits, past what a coordinate carries` +
                " — the trim to the tile's own decade did not happen",
            );
          }
        }
        const dec = { x: fx.parse(trimmed.x), y: fx.parse(trimmed.y) };
        if (dec.x === null || dec.y === null) return null;
        return {
          period: seed.period,
          x: { text: fx.text(dec.x), dec: dec.x },
          y: { text: fx.text(dec.y), dec: dec.y },
          sizeLog2: answer.size_log2,
          windowLog2: answer.window_log2,
          size: sizeOf(answer.size_log2),
          steps: step,
          residual: last,
        };
      }
    }
    return null;
  }

  /**
   * Cut `rows` of the frame's own grid across the pool and ask every worker for its
   * share, as one request each.
   *
   * **What a band of a probe and a band of the domain walk have in common**, which is
   * everything except the tally: the same cut, the same one-request round trip, the same
   * refusal. Resolves with one answer per worker, or `null` where the pool is empty or a
   * newer generation has started; throws the kernel's own sentence where a share was
   * refused. `onProgress(done, total)` hears the cells walked so far over the whole pool,
   * summed from each worker's own report of its share.
   */
  async #shares(kind, field, refusal, spec, cols, rows, generation, onProgress) {
    const workers = this.slots.length;
    if (workers === 0) return null;
    const ranges = [];
    for (let index = 0; index < workers; index++) {
      const start = Math.floor((index * rows) / workers);
      const end = Math.floor(((index + 1) * rows) / workers);
      if (end > start) ranges.push([start, end]);
    }
    if (!(await this.#feedAll(generation))) return null;
    const done = ranges.map(() => 0);
    const total = cols * rows;
    const answers = await Promise.all(
      ranges.map(([rowStart, rowEnd], index) =>
        this.#send(
          this.slots[index],
          { kind, spec, cols, rows, rowStart, rowEnd },
          {
            onProgress: (cells) => {
              done[index] = cells;
              onProgress?.(done.reduce((sum, count) => sum + count, 0), total);
            },
          },
        ),
      ),
    );
    if (generation !== this.generation || answers.some((reply) => reply === null)) return null;
    for (const reply of answers) {
      if (!reply[field]?.ok) throw new Error(reply[field]?.why ?? refusal);
    }
    return answers.map((reply) => reply[field]);
  }

  /**
   * Stop whatever the pool is doing, and come back idle.
   *
   * The generation moves, so everything still awaiting drops its answer on the floor; and
   * every worker with a request in flight is ended and restarted, so nothing is still
   * running when this returns. That second half is what a reader's Cancel means — a probe
   * rung, an orbit and a band are all things a wasm call cannot be talked out of.
   */
  cancel() {
    this.generation += 1;
    this.queue = [];
    const job = this.job;
    this.job = null;
    for (const slot of this.slots) {
      if (slot.busy !== null) this.#restart(slot);
    }
    if (job !== null) job.resolve(null);
  }

  /** Throw away the pool and the orbit every worker is holding. */
  stop() {
    this.cancel();
    for (const slot of this.slots) slot.worker.terminate();
    this.slots = [];
    this.orbit = null;
  }

  /**
   * Whether the orbit the pool holds can still draw this frame.
   *
   * Three things have to hold, and each of them is a way the orbit would be wrong rather
   * than merely unhelpful. **Its identity**, which is [`orbitKey`] — the limb count,
   * because the orbit's points were computed to that many and a deeper view wants more
   * precision than they carry; the period, because a periodic orbit is a different object
   * rather than a shorter one; and which set it is the orbit of. **The cap**,
   * because an orbit run to fewer iterations than the frame asks for would have the kernel
   * rebasing its way through the difference. And **the reach**: the reference has to be
   * inside the frame being drawn, which is the conservative reading of "still within its
   * reach" and costs nothing to be conservative about.
   *
   * The gesture this keeps it for is the one that matters: a zoom in about a point near
   * the middle of the frame stays inside the old frame, so a descent pays for one orbit
   * rather than one per rung.
   */
  #reaches(view, limbs, aspect, period) {
    const held = this.orbit;
    if (held === null) return false;
    // **Everything about the orbit that is its identity is one string**, which is what
    // keeps this test honest as the kind grows: a new field of a reference — `julia` when
    // the Julia case landed, `period` when a nucleus could be one — is a field of the key
    // rather than a line somebody has to remember to add here.
    if (held.key !== orbitKey(view, limbs, period)) return false;
    if (held.maxiter < view.maxiter) return false;
    // **A Julia frame's orbit does not depend on its frame at all.** It is the
    // critical orbit of the parameter, so the reach test is only "the same
    // parameter, computed deeply enough and far enough" — and a pan or a zoom
    // inside a Julia view never recomputes one.
    if (view.julia !== null) return true;
    // In decimal, and it has to be: two deep coordinates agree in every digit a double
    // holds, so `Number(a) - Number(b)` is exactly zero and would say the reference is at
    // the centre wherever it actually is.
    const across = Math.abs(fx.difference(view.x.dec, held.x.dec));
    const down = Math.abs(fx.difference(view.y.dec, held.y.dec));
    const half = view.w.value / 2;
    return across <= half && down <= half * aspect;
  }

  /**
   * Make sure the pool has the orbit this frame needs, computing one if the held one will
   * not do. Resolves with the reference the frame's spec should name, or `null` where the
   * kernel refused to produce one or the generation moved on.
   *
   * **Computed in a worker, never on this thread** *(deep_tab_activity_and_layout_
   * ckpt141)*. At a cap of a million an orbit is seconds, and on the page's own thread
   * those were seconds in which nothing — the progress line, the spinner, Cancel — could
   * run. The first worker computes it and keeps it, and the bytes it hands back are what
   * every other worker is fed from, lazily, by [`#feedAll`].
   */
  async #reference(view, width, height, supersample, period = null, { generation, onProgress } = {}) {
    // **The limbs are the spec's, asked of `plan`, and not the width's** *(deep_degrees_ckpt140)*.
    // A Julia frame anchored at `z = 0` is computed at twice the view's bits, because its
    // first step squares the pixel offset — so the width's own count would be the key of
    // an orbit the kernel never computes for this frame, and a held orbit at the width's
    // count would pass the identity test above while being short of the bits this frame
    // needs. The kernel decides the count; this reads it.
    const planned = this.plan(deepSpecOf(view, width, height, { supersample, period }));
    const limbs = planned.ok ? planned.limbs : this.limbs(view.w.value, width * supersample);
    if (this.#reaches(view, limbs, height / width, period)) {
      return { x: this.orbit.x.text, y: this.orbit.y.text, kept: true };
    }

    // The reference is the view's own centre. For an ordinary frame that is the best point
    // available; for a preview tile it is the nucleus the search solved, and the centre
    // *is* the nucleus — which is why a tile names a period and no reference.
    const spec = deepSpecOf(view, width, height, { supersample, period });
    const slot = this.slots[0];
    if (slot === undefined) return null;
    const reply = await this.#send(
      slot,
      { kind: "reference", spec: JSON.stringify(spec) },
      { onProgress },
    );
    if (reply === null || (generation !== undefined && generation !== this.generation)) return null;
    if (reply.orbit === null) return null;

    this.orbits += 1;
    this.orbit = {
      x: view.x,
      y: view.y,
      // What this orbit *is* — the set, the parameter, the limbs, the period — as the one
      // string `#reaches` compares. Where it is stays `x` and `y`, because that is a
      // distance and not a comparison.
      key: orbitKey(view, limbs, period),
      // The parameter this orbit is the critical orbit of, as text. `null` on the
      // Mandelbrot side, where the orbit is of the frame's own reference point. In the
      // key as well as here: the whole record goes to `onOrbit`, which is what the page
      // says an orbit is, and that stays a description rather than becoming a compare.
      julia: view.julia ? { x: view.julia.x.text, y: view.julia.y.text } : null,
      limbs,
      maxiter: view.maxiter,
      // `null` for the ordinary walk; a period where this orbit wraps.
      period: period ?? null,
      points: reply.points,
      bytes: reply.orbit.byteLength,
      stamp: this.orbits,
      packed: reply.orbit,
    };
    // The worker that computed it holds it already.
    slot.fed = this.orbit.stamp;
    return { x: this.orbit.x.text, y: this.orbit.y.text, kept: false };
  }

  /** Hand the held orbit to every worker that does not have it yet — the others after a
   *  new one is computed, and a restarted worker after a cancel. Resolves `false` where the
   *  generation moved on while it ran. */
  async #feedAll(generation) {
    const held = this.orbit;
    if (held === null) return generation === this.generation;
    const hungry = this.slots.filter((slot) => slot.fed !== held.stamp);
    const replies = await Promise.all(
      hungry.map((slot) => {
        const copy = held.packed.slice(0);
        return this.#send(slot, { kind: "orbit", orbit: copy }, { transfer: [copy] }).then(
          (reply) => {
            if (reply !== null) slot.fed = held.stamp;
            return reply;
          },
        );
      }),
    );
    return generation === this.generation && replies.every((reply) => reply !== null);
  }

  /**
   * Compute one deep field over the whole pool, and resolve with it.
   *
   * Resolves with `null` if a newer generation started while this one was running, as the
   * viewer's renderer does and for the same reason: a promise nobody settles holds its
   * whole `await` chain alive.
   */
  async field(
    view,
    width,
    height,
    { supersample = 1, period = null, interior = true, onProgress, onOrbit, onStep } = {},
  ) {
    this.cancel();
    const generation = this.generation;

    // **Asked before the orbit, not after it.** A frame the kernel will refuse —
    // a Julia view too far from both its anchors for the width it is asking for —
    // should cost a sentence rather than a reference orbit, and the refusal is
    // the module's own words either way.
    const refusal = this.plan(deepSpecOf(view, width, height, { supersample, period }));
    if (!refusal.ok) throw new Error(refusal.why);

    const reference = await this.#reference(view, width, height, supersample, period, {
      generation,
      onProgress: (done, total) => onStep?.({ phase: "orbit", done, total }),
    });
    if (generation !== this.generation) return null;
    if (reference === null) throw new Error("the kernel could not compute a reference orbit for this view");
    onOrbit?.({ ...this.orbit, packed: undefined, kept: reference.kept });

    // A tile centred on its own nucleus names the period and **not** the reference: the
    // centre already is the reference, and naming it as well would put the same point in
    // the spec twice.
    const spec = deepSpecOf(view, width, height, {
      supersample,
      period,
      reference: period === null ? reference : null,
      interior,
    });
    const shape = this.plan(spec);
    if (!shape.ok) throw new Error(shape.why);
    if (!(await this.#feedAll(generation))) return null;

    const sampleWidth = width * supersample;
    const values = new Float64Array(sampleWidth * height * supersample);
    const bands = this.#cut(bandsOf(height, this.slots.length), supersample, true);

    return new Promise((resolve, reject) => {
      this.job = {
        generation,
        spec: JSON.stringify(spec),
        width,
        height,
        supersample,
        sampleWidth,
        values,
        rows: height,
        done: 0,
        onProgress,
        resolve,
        reject,
        started: performance.now(),
        ran: 0,
        saved: 0,
      };
      this.queue = bands;
      for (const slot of this.slots) this.#dispatch(slot, this.job);
    });
  }

  /**
   * How finely to cut, given what a band is costing: bands of about `BAND_TARGET_MS`.
   *
   * `opening` is the first cut of a pass, which has no measurement of its own behind it —
   * and where nothing at all has been measured yet it is `OPENING_BAND_ROWS` rather than
   * the viewer's four-to-a-worker, for the reason that constant gives.
   */
  #cut(bands, supersample, opening = false) {
    if (this.rowCost === null) {
      return opening ? recut(bands, OPENING_BAND_ROWS, 1) : bands;
    }
    const perRow = this.rowCost * supersample * supersample;
    const rows = BAND_TARGET_MS / perRow;
    const widest = bands.reduce((most, [start, end]) => Math.max(most, end - start), 0);
    return rows * RECUT_OVER < widest ? recut(bands, rows, 1) : bands;
  }

  /** Give this worker the next band of the job, if there is one and the job is current. */
  #dispatch(slot, job) {
    if (job !== this.job || job.generation !== this.generation || this.queue.length === 0) return;
    if (slot.busy !== null) return;
    const [rowStart, rowEnd] = this.queue.shift();
    const span = rowEnd - rowStart;
    const at = performance.now();
    this.#send(slot, {
      kind: "band",
      spec: job.spec,
      rowStart,
      rowEnd,
      bytes: span * job.supersample * job.sampleWidth * 8,
    }).then((reply) => this.#collect(slot, reply, job, at, span));
  }

  #collect(slot, reply, job, at, span) {
    if (reply === null || job !== this.job || job.generation !== this.generation) return;
    const cost = (performance.now() - at) / (span * job.supersample * job.supersample);
    this.rowCost = this.rowCost === null ? cost : (this.rowCost + cost) / 2;
    this.queue = this.#cut(this.queue, job.supersample);
    if (reply.refused) {
      this.job = null;
      job.reject(new Error("the kernel refused this view"));
      return;
    }
    const rows = (reply.rowEnd - reply.rowStart) * job.supersample;
    job.values.set(
      new Float64Array(reply.band),
      reply.rowStart * job.supersample * job.sampleWidth,
    );
    job.done += reply.rowEnd - reply.rowStart;
    // Iterations, summed over the pass; one band without the pair makes the pass's `null`.
    job.ran = reply.ran === null || job.ran === null ? null : job.ran + reply.ran;
    job.saved = reply.saved === null || job.saved === null ? null : job.saved + reply.saved;
    if (job.onProgress) {
      job.onProgress(job.done / job.rows, performance.now() - job.started, rows);
    }
    if (job.done >= job.rows) {
      this.job = null;
      job.resolve({
        values: job.values,
        width: job.width,
        height: job.height,
        supersample: job.supersample,
        elapsed: performance.now() - job.started,
        ran: job.ran,
        saved: job.saved,
      });
      return;
    }
    this.#dispatch(slot, job);
  }

  /**
   * Colour a deep field through `engine.wasm`, in the page's own kept shade worker.
   *
   * The field is handed over and its buffer detached, exactly as the viewer's final stage
   * hands one over — so a caller keeping the field for a recolour passes a copy, and the
   * arithmetic of what that costs is in `deep.js` where the cache is.
   */
  shade(field, view, holder = {}, { derive = false } = {}) {
    return this.shading.shade(field, view, holder, {
      derive,
      spec: shadeSpecOf(view, stopsOf(view.palette), field.width, field.height, {
        supersample: field.supersample,
        level: !derive,
      }),
    });
  }
}

/** The imports the page's own instance is given: `env.progress` is the module's one import
 *  (`perturb-wasm/src/progress.rs`), and the planner never makes a call long enough to
 *  have anything to report. */
const PLANNER_IMPORTS = { env: { progress() {} } };
