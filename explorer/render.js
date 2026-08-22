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
//   4. Both are cached by geometry, so a palette change re-shades and never
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

/** How many fields to keep. Two passes of the current view, and one view back. */
const CACHE_LIMIT = 4;

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
      return { kind: "multibrot", degree: Number(family.slice(-1)) };
    case "julia":
      return { kind: "julia", degree: 2, c: c() };
    case "julia3":
    case "julia4":
    case "julia5":
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
    default:
      throw new Error(`no engine family for ${family}`);
  }
}

/** The curated maps as the engine's control points, baked once per name. */
const STOPS = new Map();
function colormapOf(name) {
  if (!STOPS.has(name)) {
    const map = PALETTES.get(name);
    const stops = map.positions.map((at, index) => [
      at,
      [map.colors[index * 3], map.colors[index * 3 + 1], map.colors[index * 3 + 2]],
    ]);
    STOPS.set(name, { kind: map.cyclic ? "cyclic" : "sequential", stops });
  }
  return STOPS.get(name);
}

/**
 * One view as the module's spec.
 *
 * `palette` is handed over as it stands, because the permalink's seven shade keys
 * ARE the engine's palette recipe — same names, same shapes, same defaults — and
 * translating between two spellings of one thing is how they drift apart.
 *
 * The colormap is left out of a field pass that does not need it. Only the direct
 * traps read the gradient while they iterate; for every other mode the map is a
 * shade-time input, and baking a lookup table into every band would be a table per
 * band.
 */
export function specOf(view, width, height, { colormap = true } = {}) {
  const spec = {
    schema: 1,
    family: familySpecOf(view.family, view.constants),
    viewport: { center_re: view.x.text, center_im: view.y.text, width: view.w.text },
    resolution: [width, height],
    mode: view.mode,
    palette: view.shade,
  };
  if (Object.keys(view.params).length > 0) spec.params = view.params;
  if (colormap) spec.colormap = colormapOf(view.palette);
  return spec;
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
    this.fields = new Map();
    this.plans = new Map();
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
   *
   * What comes back is lane-major `f64` for a mode that makes a field, and finished
   * RGBA for one that paints during the iteration. Which it is comes from the plan,
   * and both are assembled by rows the same way.
   */
  field(view, width, height, onProgress) {
    this.cancel();
    const generation = this.generation;

    const shape = this.plan(specOf(view, width, height, { colormap: false }));
    if (!shape.ok) return Promise.reject(new Error(shape.why));
    // A direct trap composites samples from the gradient as it iterates, so its
    // band is already coloured and its spec needs the map in it.
    const spec = JSON.stringify(specOf(view, width, height, { colormap: shape.direct }));
    const values = shape.direct
      ? new Uint8ClampedArray(width * height * 4)
      : new Float64Array(width * height * shape.lanes);

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
        spec,
        shape,
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
    const span = rowEnd - rowStart;
    worker.onmessage = (event) => this.#collect(worker, event.data, job);
    worker.postMessage({
      job: job.generation,
      spec: job.spec,
      rowStart,
      rowEnd,
      bytes: job.shape.direct
        ? span * job.width * 4
        : span * job.width * job.shape.lanes * 8,
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
    this.#place(job, message);
    job.pending -= 1;
    if (job.onProgress) job.onProgress((job.total - job.pending) / job.total);
    if (job.pending === 0) {
      this.job = null;
      job.resolve({
        values: job.values,
        width: job.width,
        height: job.height,
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
    const span = message.rowEnd - message.rowStart;
    if (job.shape.direct) {
      job.values.set(new Uint8ClampedArray(message.band), message.rowStart * job.width * 4);
      return;
    }
    const band = new Float64Array(message.band);
    const stride = job.width * job.height;
    for (let lane = 0; lane < job.shape.lanes; lane++) {
      job.values.set(
        band.subarray(lane * span * job.width, (lane + 1) * span * job.width),
        lane * stride + message.rowStart * job.width,
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
  shade(field, view) {
    const started = performance.now();
    if (field.shape.direct) {
      return {
        image: new ImageData(field.values.slice(), field.width, field.height),
        elapsed: performance.now() - started,
      };
    }

    const wasm = this.shader;
    const [pointer, length] = this.#put(
      JSON.stringify(specOf(view, field.width, field.height)),
    );
    const lanes = new Uint8Array(field.values.buffer, field.values.byteOffset, field.values.byteLength);
    const lanePointer = wasm.alloc(lanes.length);
    new Uint8Array(wasm.memory.buffer, lanePointer, lanes.length).set(lanes);

    const out = wasm.shade(pointer, length, lanePointer);
    wasm.dealloc(pointer, length);
    wasm.dealloc(lanePointer, lanes.length);
    if (out === 0) throw new Error("the renderer refused this palette recipe");

    const count = field.width * field.height;
    const rgba = new Uint8ClampedArray(wasm.memory.buffer, out, count * 4).slice();
    wasm.dealloc(out, count * 4);
    return {
      image: new ImageData(rgba, field.width, field.height),
      elapsed: performance.now() - started,
    };
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
