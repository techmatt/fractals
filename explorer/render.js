// The renderer: a pool of workers that compute field bands, and a main-thread
// wasm instance that shades the assembled field.
//
// Split from the page itself so that what draws a picture and what handles a
// mouse are two different files, and so that the timing harness under `scratch/`
// measures the same code the page runs rather than an imitation of it.
//
// The shape of a pass:
//
//   1. A quarter-resolution field, each axis divided by four. It is a SEPARATE
//      field of the same rectangle rather than a subsample of the full one, so it
//      is normalized against its own samples — which is why the preview can be a
//      shade off the picture that replaces it.
//   2. The full-resolution field, in bands, dispatched from a queue.
//   3. Both are cached by geometry, so a palette change re-shades and never
//      re-iterates.
//
// Cancellation is by generation rather than by termination: a pan bumps the
// generation, no further bands are dispatched, and the band still in flight is
// finished and thrown away. Killing a worker mid-band would cost a wasm
// instantiation to save at most one band of work.

import { PALETTES } from "./palettes.js";

/** Workers, capped. Past eight the bands get short enough that the messaging
 *  starts to show, and a visitor's machine has other things to do. */
export const MAX_WORKERS = 8;

/** How much finer the band queue is than the pool. More bands than workers is
 *  what makes an interior-heavy row band cost somebody else's idle time instead
 *  of the whole frame's, and it is what bounds how long a cancel takes. */
const BANDS_PER_WORKER = 4;

/** No band shorter than this, however many workers there are. */
const MIN_BAND_ROWS = 8;

/** Each axis of the preview, as a fraction of the full pass. */
export const PREVIEW_DIVISOR = 4;

/** The one family and the one mode this draft renders, as the wasm module ids them. */
const FAMILY_MANDELBROT = 0;
const MODE_SMOOTH = 0;

const TRANSFER_IDS = { value: 0, edge: 1, rank: 2 };
const ROLLOFF_IDS = { none: 0, soft_knee: 1, reinhard: 2, aces: 3 };

/** How many fields to keep. Two passes of the current view, and one view back. */
const CACHE_LIMIT = 4;

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
    this.fields = new Map();
  }

  /**
   * Compile the module once, instantiate it here for shading, and start the pool.
   *
   * `wanted` is for the timing harness; the page passes nothing and gets what the
   * machine says it has, capped.
   */
  static async start(url, wanted) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${url}: ${response.status} ${response.statusText}`);
    const module = await WebAssembly.compile(await response.arrayBuffer());
    const shader = new WebAssembly.Instance(module, {}).exports;

    const count = wanted ?? Math.min(MAX_WORKERS, navigator.hardwareConcurrency || 1);
    const workers = [];
    for (let index = 0; index < Math.max(1, count); index++) {
      const worker = new Worker(new URL("./worker.js", import.meta.url), { type: "module" });
      const ready = new Promise((resolve) => {
        worker.onmessage = (event) => {
          if (event.data.kind === "ready") resolve();
        };
      });
      worker.postMessage({ kind: "start", module });
      await ready;
      workers.push(worker);
    }
    return new Renderer(module, shader, workers);
  }

  get workerCount() {
    return this.workers.length;
  }

  /** The engine's own home view, read out rather than restated here. */
  home() {
    return {
      x: this.shader.home_center_re(),
      y: this.shader.home_center_im(),
      w: this.shader.home_width(),
    };
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
    if (job !== null) job.resolve(null);
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
   */
  field(view, width, height, onProgress) {
    this.cancel();
    const generation = this.generation;
    const values = new Float32Array(width * height);

    const bands = [];
    const target = Math.max(
      1,
      Math.min(
        Math.ceil(height / MIN_BAND_ROWS),
        this.workers.length * BANDS_PER_WORKER,
      ),
    );
    const rows = Math.ceil(height / target);
    for (let start = 0; start < height; start += rows) {
      bands.push([start, Math.min(height, start + rows)]);
    }

    return new Promise((resolve, reject) => {
      this.job = {
        generation,
        view,
        width,
        height,
        values,
        total: bands.length,
        pending: bands.length,
        onProgress,
        resolve,
        reject,
        started: performance.now(),
      };
      this.queue = bands;
      for (const worker of [...this.idle]) this.#dispatch(worker);
    });
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
    worker.onmessage = (event) => this.#collect(worker, event.data, job);
    worker.postMessage({
      job: job.generation,
      family: FAMILY_MANDELBROT,
      mode: MODE_SMOOTH,
      cx: job.view.x.value,
      cy: job.view.y.value,
      fw: job.view.w.value,
      width: job.width,
      height: job.height,
      rowStart,
      rowEnd,
    });
  }

  #collect(worker, message, job) {
    if (message.kind !== "band") return;
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
    job.values.set(new Float32Array(message.band), message.rowStart * job.width);
    job.pending -= 1;
    if (job.onProgress) job.onProgress((job.total - job.pending) / job.total);
    if (job.pending === 0) {
      this.job = null;
      job.resolve({ values: job.values, width: job.width, height: job.height, elapsed: performance.now() - job.started });
      if (!this.idle.includes(worker)) this.idle.push(worker);
      return;
    }
    this.#dispatch(worker);
  }

  /**
   * Color an assembled field, on this thread, and return it as `ImageData`.
   *
   * On this thread and not in a worker because the field is already here and the
   * shade is milliseconds: the whole reason the field and the color are separate
   * exports is that one of them is cheap.
   */
  shade(field, view) {
    const wasm = this.shader;
    const map = PALETTES.get(view.palette);
    const count = field.width * field.height;

    const fieldBytes = new Uint8Array(field.values.buffer, field.values.byteOffset, count * 4);
    const fieldPointer = wasm.alloc(fieldBytes.length);
    new Uint8Array(wasm.memory.buffer, fieldPointer, fieldBytes.length).set(fieldBytes);

    const positions = new Float64Array(map.positions);
    const positionsPointer = wasm.alloc(positions.byteLength);
    new Uint8Array(wasm.memory.buffer, positionsPointer, positions.byteLength).set(
      new Uint8Array(positions.buffer),
    );
    const colors = new Uint8Array(map.colors);
    const colorsPointer = wasm.alloc(colors.length);
    new Uint8Array(wasm.memory.buffer, colorsPointer, colors.length).set(colors);

    const shade = view.shade;
    const started = performance.now();
    const pointer = wasm.shade(
      MODE_SMOOTH,
      fieldPointer,
      field.width,
      field.height,
      positionsPointer,
      colorsPointer,
      map.positions.length,
      map.cyclic ? 1 : 0,
      shade.gamma,
      shade.cycles,
      shade.phase,
      shade.reverse ? 1 : 0,
      shade.mirror ? 1 : 0,
      TRANSFER_IDS[shade.transfer.kind],
      shade.transfer.weight ?? 0,
      ROLLOFF_IDS[shade.rolloff.kind],
      shade.rolloff.knee ?? 0,
    );
    const elapsed = performance.now() - started;

    wasm.dealloc(fieldPointer, fieldBytes.length);
    wasm.dealloc(positionsPointer, positions.byteLength);
    wasm.dealloc(colorsPointer, colors.length);
    if (pointer === 0) throw new Error("the renderer refused this palette recipe");

    const rgba = new Uint8ClampedArray(wasm.memory.buffer, pointer, count * 4).slice();
    wasm.dealloc(pointer, count * 4);
    return { image: new ImageData(rgba, field.width, field.height), elapsed };
  }
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
