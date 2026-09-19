// The deep renderer: `perturb.wasm` over a pool, and `engine.wasm` to colour what it drew.
//
// **Two modules, and they meet at a buffer of `f64` lanes.** `perturb.wasm` computes the
// smooth field of the degree-2 Mandelbrot set below the `f64` floor and knows nothing
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
// frame, computed on this thread, sent to each worker once, and held there across every
// band. A band call never computes one. See `deep-worker.js`.

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
export function deepSpecOf(view, width, height, { supersample = 1, reference = null } = {}) {
  const spec = {
    schema: 1,
    center_re: view.x.text,
    center_im: view.y.text,
    width: view.w.value,
    resolution: [width, height],
    maxiter: view.maxiter,
  };
  if (supersample > 1) spec.supersample = supersample;
  if (reference !== null) {
    spec.reference_re = reference.x;
    spec.reference_im = reference.y;
  }
  return spec;
}

/** One pool worker, instantiated and ready. */
function spawn(module) {
  return new Promise((resolve) => {
    const worker = new Worker(new URL("./deep-worker.js", import.meta.url), { type: "module" });
    worker.onmessage = (event) => {
      if (event.data.kind === "ready") resolve(worker);
    };
    worker.postMessage({ kind: "start", module });
  });
}

/**
 * Everything the Deep tab needs to draw, once `perturb.wasm` is compiled and the pool is up.
 *
 * Cancellation is by generation, as it is in the viewer's renderer: a new pass bumps the
 * generation, no further bands are dispatched, and the band still in flight is finished and
 * thrown away. What makes that bearable here is the band cut — a cancel costs one band, so
 * a band is how long the tab can ignore the reader, which is why the cut is aimed at a
 * duration and opens fine.
 */
export class DeepRenderer {
  constructor(module, planner, workers, shading) {
    this.module = module;
    /** A main-thread instance, for `plan`, the cap policy and the reference orbit. */
    this.planner = planner;
    this.workers = workers;
    this.idle = [...workers];
    /** The page's own shade worker, over `engine.wasm`. Deep fields are coloured there for
     *  the reason the viewer's final stage is: a recolour of a frame that took a minute
     *  must not freeze the page for half a second. */
    this.shading = shading;
    this.generation = 0;
    this.queue = [];
    this.job = null;
    this.inflight = new Map();
    /** Milliseconds per output row per sample-per-pixel, as the last bands measured it. */
    this.rowCost = null;
    /** The reference orbit the workers are holding: its bytes, the point it is of, the cap
     *  and the limb count it was computed at, and its reach. `null` before the first. */
    this.orbit = null;
    this.orbits = 0;
  }

  static async start(url, engineShading, wanted) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${url}: ${response.status} ${response.statusText}`);
    const module = await WebAssembly.compile(await response.arrayBuffer());
    const planner = new WebAssembly.Instance(module, {}).exports;
    const count =
      wanted ?? Math.min(MAX_WORKERS, navigator.hardwareConcurrency || DEFAULT_WORKERS);
    const workers = [];
    for (let index = 0; index < Math.max(1, count); index++) workers.push(await spawn(module));
    return new DeepRenderer(module, planner, workers, engineShading);
  }

  get workerCount() {
    return this.workers.length;
  }

  /** Write a string into the planner's heap, and hand back what frees it. */
  #put(text) {
    const raw = new TextEncoder().encode(text);
    const pointer = this.planner.alloc(raw.length);
    new Uint8Array(this.planner.memory.buffer, pointer, raw.length).set(raw);
    return [pointer, raw.length];
  }

  /** What this spec implies, or why it cannot be drawn: the kernel's own answer. */
  plan(spec) {
    const [pointer, length] = this.#put(JSON.stringify(spec));
    const out = this.planner.plan(pointer, length);
    this.planner.dealloc(pointer, length);
    const size = new DataView(this.planner.memory.buffer).getUint32(out, true);
    const body = new TextDecoder().decode(
      new Uint8Array(this.planner.memory.buffer, out + 4, size),
    );
    this.planner.dealloc(out, size + 4);
    return JSON.parse(body);
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

  cancel() {
    this.generation += 1;
    this.queue = [];
    const job = this.job;
    this.job = null;
    this.inflight.clear();
    if (job !== null) job.resolve(null);
  }

  /** Throw away the pool and the orbit every worker is holding. */
  stop() {
    this.cancel();
    for (const worker of this.workers) worker.terminate();
    this.workers = [];
    this.idle = [];
    this.orbit = null;
  }

  /**
   * Whether the orbit the workers hold can still draw this frame.
   *
   * Three things have to hold, and each of them is a way the orbit would be wrong rather
   * than merely unhelpful. **The limb count**, because the orbit's points were computed to
   * that many limbs and a deeper view wants more precision than they carry. **The cap**,
   * because an orbit run to fewer iterations than the frame asks for would have the kernel
   * rebasing its way through the difference. And **the reach**: the reference has to be
   * inside the frame being drawn, which is the conservative reading of "still within its
   * reach" and costs nothing to be conservative about — recomputing is fifteen to
   * twenty-five milliseconds against a frame of seconds.
   *
   * The gesture this keeps it for is the one that matters: a zoom in about a point near
   * the middle of the frame stays inside the old frame, so a descent pays for one orbit
   * rather than one per rung.
   */
  #reaches(view, limbs, aspect) {
    const held = this.orbit;
    if (held === null) return false;
    if (held.limbs !== limbs) return false;
    if (held.maxiter < view.maxiter) return false;
    // In decimal, and it has to be: two deep coordinates agree in every digit a double
    // holds, so `Number(a) - Number(b)` is exactly zero and would say the reference is at
    // the centre wherever it actually is.
    const across = Math.abs(fx.difference(view.x.dec, held.x.dec));
    const down = Math.abs(fx.difference(view.y.dec, held.y.dec));
    const half = view.w.value / 2;
    return across <= half && down <= half * aspect;
  }

  /**
   * Make sure every worker is holding the orbit this frame needs, computing one if the
   * held one will not do. Resolves with the reference the frame's spec should name, or
   * `null` where the kernel refused to produce one.
   */
  async #reference(view, width, height, supersample) {
    const limbs = this.limbs(view.w.value, width * supersample);
    if (this.#reaches(view, limbs, height / width)) {
      return { x: this.orbit.x.text, y: this.orbit.y.text, kept: true };
    }

    // The reference is the view's own centre: the tab has no nucleus solver, so the best
    // point available is the middle of what is being drawn.
    const spec = deepSpecOf(view, width, height, { supersample });
    const [pointer, length] = this.#put(JSON.stringify(spec));
    const out = this.planner.reference_orbit(pointer, length);
    this.planner.dealloc(pointer, length);
    if (out === 0) return null;
    const count = new DataView(this.planner.memory.buffer).getUint32(out, true);
    const bytes = REFERENCE_HEADER + 16 * count;
    const packed = new Uint8Array(this.planner.memory.buffer, out, bytes).slice();
    this.planner.dealloc(out, bytes);

    this.orbits += 1;
    this.orbit = {
      x: view.x,
      y: view.y,
      limbs,
      maxiter: view.maxiter,
      points: count,
      bytes: packed.byteLength,
    };
    const stamp = this.orbits;
    await Promise.all(
      this.workers.map(
        (worker) =>
          new Promise((resolve) => {
            const previous = worker.onmessage;
            worker.onmessage = (event) => {
              if (event.data.kind !== "orbited") return;
              worker.onmessage = previous;
              resolve();
            };
            worker.postMessage({ kind: "orbit", orbit: packed.buffer.slice(0), stamp });
          }),
      ),
    );
    return { x: this.orbit.x.text, y: this.orbit.y.text, kept: false };
  }

  /**
   * Compute one deep field over the whole pool, and resolve with it.
   *
   * Resolves with `null` if a newer generation started while this one was running, as the
   * viewer's renderer does and for the same reason: a promise nobody settles holds its
   * whole `await` chain alive.
   */
  async field(view, width, height, { supersample = 1, onProgress, onOrbit } = {}) {
    this.cancel();
    const generation = this.generation;

    const reference = await this.#reference(view, width, height, supersample);
    if (generation !== this.generation) return null;
    if (reference === null) throw new Error("the kernel could not compute a reference orbit for this view");
    onOrbit?.({ ...this.orbit, kept: reference.kept });

    const spec = deepSpecOf(view, width, height, { supersample, reference });
    const shape = this.plan(spec);
    if (!shape.ok) throw new Error(shape.why);

    const sampleWidth = width * supersample;
    const values = new Float64Array(sampleWidth * height * supersample);
    const bands = this.#cut(bandsOf(height, this.workers.length), supersample, true);

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
      };
      this.queue = bands;
      for (const worker of [...this.idle]) this.#dispatch(worker);
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
    this.inflight.set(worker, { at: performance.now(), rows: span });
    worker.onmessage = (event) => this.#collect(worker, event.data, job);
    worker.postMessage({
      kind: "band",
      job: job.generation,
      spec: job.spec,
      rowStart,
      rowEnd,
      bytes: span * job.supersample * job.sampleWidth * 8,
    });
  }

  #timed(worker, job) {
    const band = this.inflight.get(worker);
    if (band === undefined) return;
    this.inflight.delete(worker);
    if (job.generation !== this.generation || band.rows <= 0) return;
    const elapsed = performance.now() - band.at;
    const cost = elapsed / (band.rows * job.supersample * job.supersample);
    this.rowCost = this.rowCost === null ? cost : (this.rowCost + cost) / 2;
    this.queue = this.#cut(this.queue, job.supersample);
  }

  #collect(worker, message, job) {
    if (message.kind !== "band") return;
    this.#timed(worker, job);
    if (message.job !== this.generation) {
      if (!this.idle.includes(worker)) this.idle.push(worker);
      this.#dispatch(worker);
      return;
    }
    if (message.refused) {
      job.reject(new Error("the kernel refused this view"));
      this.job = null;
      return;
    }
    const span = (message.rowEnd - message.rowStart) * job.supersample;
    job.values.set(
      new Float64Array(message.band),
      message.rowStart * job.supersample * job.sampleWidth,
    );
    job.done += message.rowEnd - message.rowStart;
    if (job.onProgress) {
      job.onProgress(job.done / job.rows, performance.now() - job.started, span);
    }
    if (job.done >= job.rows) {
      this.job = null;
      job.resolve({
        values: job.values,
        width: job.width,
        height: job.height,
        supersample: job.supersample,
        elapsed: performance.now() - job.started,
      });
      if (!this.idle.includes(worker)) this.idle.push(worker);
      return;
    }
    this.#dispatch(worker);
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

/** Bytes of header on the reference buffer, before the orbit's `f64` pairs. The module's
 *  own `REFERENCE_HEADER`, which is sixteen rather than the twelve the fields need so that
 *  the pairs start `f64` aligned. */
const REFERENCE_HEADER = 16;
