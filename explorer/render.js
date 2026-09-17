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

/** No band shorter than this, however many workers there are. */
const MIN_BAND_ROWS = 8;

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
 */
export function bandsOf(height, workers) {
  const target = Math.max(
    1,
    Math.min(Math.ceil(height / MIN_BAND_ROWS), workers * BANDS_PER_WORKER),
  );
  const rows = Math.ceil(height / target);
  const bands = [];
  for (let start = 0; start < height; start += rows) {
    bands.push([start, Math.min(height, start + rows)]);
  }
  return bands;
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
export function specOf(view, width, height, { colormap = true, supersample = 1, level = true } = {}) {
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
    this.ramped = null;
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

    const count =
      wanted ?? Math.min(MAX_WORKERS, navigator.hardwareConcurrency || DEFAULT_WORKERS);
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
  field(view, width, height, { supersample = 1, onProgress } = {}) {
    const shape = this.plan(specOf(view, width, height, { colormap: false, supersample }));
    if (!shape.ok) return Promise.reject(new Error(shape.why));
    return this.#run(view, width, height, shape, { supersample, onProgress });
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
  ramp(view, samples, { direct = false } = {}) {
    const text = JSON.stringify(rampSpecOf(view, stopsOf(view.palette), samples, { direct }));
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

  #run(view, width, height, shape, { supersample, onProgress }) {
    this.cancel();
    const generation = this.generation;

    // A direct trap composites samples from the gradient as it iterates, so its
    // band is already coloured and its spec needs the map in it.
    const spec = JSON.stringify(specOf(view, width, height, { colormap: shape.direct, supersample }));
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

    const bands = bandsOf(height, this.workers.length);

    return new Promise((resolve, reject) => {
      this.job = {
        generation,
        spec,
        shape,
        width,
        height,
        supersample,
        sampleWidth,
        sampleHeight,
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
      probe: job.shape.probe === true,
      bytes: job.shape.probe
        ? span * job.width * PROBE_BYTES
        : job.shape.direct
          ? span * job.width * 4
          : span * job.supersample * job.sampleWidth * job.shape.lanes * 8,
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
    if (job.shape.direct) {
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
        const lanes = field.values;
        worker.postMessage(
          {
            kind: "shade",
            spec: JSON.stringify(
              specOf(view, field.width, field.height, {
                supersample: field.supersample,
                level: !derive,
              }),
            ),
            lanes: lanes.buffer,
            bytes: field.width * field.height * 4,
            derive,
          },
          [lanes.buffer],
        );
        return;
      }
      worker.terminate();
      if (event.data.refused) {
        reject(new Error("the renderer refused this palette recipe"));
        return;
      }
      // A worker.js older than the page — a browser's cached copy from before `level`
      // existed — answers without the key. It also drew no curve, so `null` is the truth
      // about its picture; the warning is what says the page is running two versions.
      if (derive && !("level" in event.data)) {
        console.warn(
          "shade worker reported no level: worker.js is older than render.js (a cached " +
            "copy?); the picture is unlevelled. Reload bypassing the cache.",
          Object.keys(event.data),
        );
      }
      resolve({
        image: new ImageData(
          new Uint8ClampedArray(event.data.image),
          field.width,
          field.height,
        ),
        ...(derive ? { level: event.data.level ?? null } : {}),
        elapsed: performance.now() - started,
      });
    };
    worker.postMessage({ kind: "start", module });
  });
}

/**
 * The spec `Renderer.ramp` shades: the view's recipe, map and curve over a field that is
 * the ramp itself. `colormap` is the map's control points, passed in so a test can hand
 * the module a map without the blob. See `ramp` for why each fixed field is what it is.
 */
export function rampSpecOf(view, colormap, samples, { direct = false } = {}) {
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
  if (!direct && view.level) {
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
