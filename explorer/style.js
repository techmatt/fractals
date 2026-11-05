// The custom (experimental) render mode: `style.wasm`, its worker pool, and what a view
// becomes as that module's request.
//
// A custom mode is one of the wallpaper project's published styles: a stack of layers
// over one orbit, drawn by the engine's own compositor (`fractal-wallpapers/engine/
// README.md`, *Styles* and *The style module*), so the explorer draws the pipeline's
// picture of it. `custom-modes.json` is that project's `style bundle`, committed whole:
// each mode's public name, its matched map, its knobs, its default stack, and the keeps it
// shows, which are the example locations here. This file is pure where it can be, so the
// request a view becomes is held by `style.test.mjs` without a browser.
//
// **Drawing is three steps on several workers** (Matt, MESSAGE #834 of this item: a frame
// takes 14 to 93 s on one thread at 1280x800 ss2). A quarter-size picture first, whole;
// then the full-size tiles against that preview's balance (`measure` on the small frame),
// spread over the pool and composited as they land; then the tone measure at the picture's
// own size, and the tiles again, which stitch to the pipeline's picture byte for byte. A
// new view, knob or palette cancels the pass at once: workers inside a call are terminated
// and replaced, since a wasm call cannot be interrupted.

import { familySpecOf } from "./render.js";

/** Output pixels a tile is, each side. Small enough that a tile of the slowest mode lands
 *  in about a second on one thread, so cancelling wastes little and the picture fills
 *  visibly; large enough that the Lanczos apron each tile re-gathers stays a small share. */
export const TILE = 128;

/** How much smaller the preview is than the picture, each side. */
export const PREVIEW_DIVISOR = 4;

/** The supersample the screen and the keeps are drawn at. */
export const SUPERSAMPLE = 2;

/** At most this many workers, and half the machine's threads by default: the box's load
 *  budget (MESSAGE #834), leaving the page, the engine's own pool and the rest of the
 *  machine room while the slowest modes run for a minute. */
export const MAX_STYLE_WORKERS = 8;

export function poolSize(threads = globalThis.navigator?.hardwareConcurrency ?? 4) {
  // The harnesses' seam, as `__viewer` is theirs: a bench sharing a busy machine sets it.
  const asked = globalThis.__customWorkers;
  if (Number.isInteger(asked) && asked > 0) return Math.min(MAX_STYLE_WORKERS, asked);
  return Math.max(1, Math.min(MAX_STYLE_WORKERS, Math.floor(threads / 2)));
}

/** The bundle, by public name: `{name, style, palette, variant, what, knobs, stack, shown}`. */
export function modesOf(bundle) {
  return new Map(bundle.modes.map((mode) => [mode.name, mode]));
}

/** What `permalink.js` reads a link's custom keys against: each mode's knobs and whether
 *  it has a projection a link may place. */
export function contractOf(bundle) {
  return new Map(
    bundle.modes.map((mode) => [
      mode.name,
      { knobs: mode.knobs, projection: projectionKind(mode.stack) },
    ]),
  );
}

/** The one projection a stack draws through (`log_polar`), or `null`. */
export function projectionKind(stack) {
  const kinds = Object.keys(stack.projection ?? {});
  return kinds.length === 1 ? kinds[0] : null;
}

/** A custom state at a mode's defaults. */
export function freshCustom(name) {
  return { name, knobs: {}, matched: true, autotone: true, projection: null };
}

/** The stack a custom state draws: the published one, without its tone pass when Auto tone
 *  is off. The knobs are not applied here: the module applies them, by the pipeline's rule. */
export function stackOf(mode, custom) {
  if (custom.autotone !== false) return mode.stack;
  const { tone: _tone, ...rest } = mode.stack;
  return rest;
}

/** A map as the module takes it, from the explorer's own baked stops: `{name, kind, stops}`,
 *  the library file's shape less its prose. Reverse is the one shade key a custom mode can
 *  honour, by reversing the stops; the rest are the stack's own palette layers'. */
export function libraryColormap(name, baked, { reverse = false } = {}) {
  const stops = reverse
    ? baked.stops.map(([at, rgb]) => [1 - at, rgb]).reverse()
    : baked.stops.map(([at, rgb]) => [at, rgb]);
  return { schema: 1, name: reverse ? `${name} (reversed)` : name, kind: baked.kind, stops };
}

/** The map a custom state draws with: the mode's matched map, or the view's palette. */
export function colormapOf(bundle, mode, custom, view, stopsOf) {
  if (custom.matched !== false) return bundle.colormaps[mode.palette];
  return libraryColormap(view.palette, stopsOf(view.palette), { reverse: view.shade?.reverse === true });
}

/** A view's place as a location record, as `style render --location` reads one. */
export function locationOf(view, maxiter, custom, mode) {
  const location = {
    schema: 1,
    family: familySpecOf(view.family, view.constants),
    viewport: { center_re: view.x.text, center_im: view.y.text, width: view.w.text },
    maxiter,
  };
  const kind = projectionKind(mode.stack);
  if (kind !== null && custom.projection) location.projection = { [kind]: { ...custom.projection } };
  return location;
}

/**
 * The module's request for a view at `width × height`: the CLI's inputs, which the
 * module turns into the engine's spec by the pipeline's own rules. Knob settings go as
 * the numbers the view holds; `JSON.stringify` writes the shortest round-trip decimal,
 * which the module parses exactly.
 */
export function requestOf({ bundle, mode, custom, view, maxiter, stopsOf, width, height, supersample = SUPERSAMPLE }) {
  return {
    schema: 1,
    location: locationOf(view, maxiter, custom, mode),
    style: stackOf(mode, custom),
    knobs: mode.knobs,
    settings: { ...custom.knobs },
    colormap: colormapOf(bundle, mode, custom, view, stopsOf),
    resolution: [width, height],
    supersample,
  };
}

/** The family name a location's `family` is in a link: `julia6`, `multibrot3`. */
export function familyOf(family) {
  const degree = family.degree ?? 2;
  if (family.kind === "mandelbrot") return degree === 2 ? "mandelbrot" : `multibrot${degree}`;
  if (family.kind === "multibrot") return degree === 2 ? "mandelbrot" : `multibrot${degree}`;
  if (family.kind === "julia") return degree === 2 ? "julia" : `julia${degree}`;
  return null;
}

/** A JSON value at a `/`-pointer with `*` steps: every match. */
function at(node, steps) {
  if (steps.length === 0) return [node];
  const [step, ...rest] = steps;
  if (node === null || typeof node !== "object") return [];
  if (step === "*") return Object.values(node).flatMap((child) => at(child, rest));
  return Object.hasOwn(node, step) ? at(node[step], rest) : [];
}

function put(node, steps, value) {
  const [step, ...rest] = steps;
  if (node === null || typeof node !== "object") return;
  const keys = step === "*" ? Object.keys(node) : Object.hasOwn(node, step) ? [step] : [];
  for (const key of keys) {
    if (rest.length === 0) node[key] = value;
    else put(node[key], rest, value);
  }
}

function same(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** The stack members the module treats as whole numbers (`style-wasm`'s `INTEGER_MEMBERS`). */
export const INTEGER_MEMBERS = new Set(["iterations", "hit", "settle", "sectors", "turns"]);

/** Half to even, as the module's `round_ties_even`. */
export function roundEven(number) {
  const floor = Math.floor(number);
  const rest = number - floor;
  if (rest !== 0.5) return Math.round(number);
  return floor % 2 === 0 ? floor : floor + 1;
}

/** Whether every member a knob writes is a whole number, so its slider steps by one. */
export function wholeKnob(knob) {
  return knob.set.every((target) => INTEGER_MEMBERS.has((typeof target === "string" ? target : target.path).split("/").at(-1)));
}

/** A stack with knob settings applied by the module's rule (`scale·value + offset`, whole
 *  where the member is). Only for deciding which settings reproduce a keep; the picture's
 *  own knobs are always the module's to apply. */
export function turned(stack, knobs, settings) {
  const out = structuredClone(stack);
  for (const knob of knobs) {
    if (settings[knob.name] === undefined) continue;
    for (const target of knob.set) {
      const path = typeof target === "string" ? target : target.path;
      const scale = typeof target === "string" ? 1 : (target.scale ?? 1);
      const offset = typeof target === "string" ? 0 : (target.offset ?? 0);
      const steps = path.split("/").slice(1);
      const whole = INTEGER_MEMBERS.has(steps.at(-1));
      const number = scale * settings[knob.name] + offset;
      put(out, steps, whole ? roundEven(number) : number);
    }
  }
  return out;
}

/**
 * The custom state an example location opens with: the mode's defaults, plus the knob
 * setting or Auto tone that reproduces the keep's own stack where one does (item 003's
 * ruling C). A keep drawn with a stack no setting reaches opens at the defaults and says
 * so (`reached: false`); its picture is then the published look at that place, not the
 * keep's.
 */
export function exampleCustom(mode, shown) {
  const custom = freshCustom(mode.name);
  const kind = projectionKind(mode.stack);
  const placed = kind !== null ? shown.location.projection?.[kind] : undefined;
  if (placed) custom.projection = { ...placed };
  const keep = { ...shown.stack, name: mode.stack.name };
  if (!("tone" in shown.stack) && "tone" in mode.stack) custom.autotone = false;
  const base = stackOf(mode, custom);
  const settings = {};
  for (const knob of mode.knobs) {
    const target = knob.set[0];
    const path = typeof target === "string" ? target : target.path;
    const scale = typeof target === "string" ? 1 : (target.scale ?? 1);
    const offset = typeof target === "string" ? 0 : (target.offset ?? 0);
    const steps = path.split("/").slice(1);
    const [theirs] = at(keep, steps);
    const [ours] = at(base, steps);
    if (theirs === undefined || same(theirs, ours) || typeof theirs !== "number") continue;
    const value = (theirs - offset) / scale;
    if (value >= knob.range[0] && value <= knob.range[1]) settings[knob.name] = value;
  }
  const reached = same(turned(base, mode.knobs, settings), keep);
  if (reached) custom.knobs = settings;
  return { custom, reached };
}

/** The link query an example opens: its place, at the keep's 16:10, in the mode. */
export function exampleQuery(mode, shown, { palette, encode }) {
  const { location } = shown;
  const family = familyOf(location.family);
  const parts = ["v=4"];
  if (family !== "mandelbrot") parts.push(`f=${family}`);
  if (location.family.c) parts.push(`cx=${encode(location.family.c[0])}`, `cy=${encode(location.family.c[1])}`);
  parts.push(`custom=${encode(mode.name)}`);
  const { custom } = exampleCustom(mode, shown);
  const set = mode.knobs.filter((knob) => custom.knobs[knob.name] !== undefined);
  if (set.length > 0) parts.push(`knobs=${set.map((knob) => `${knob.name}:${custom.knobs[knob.name]}`).join(",")}`);
  if (!custom.autotone) parts.push("autotone=0");
  if (custom.projection) {
    parts.push(`projection=${Object.entries(custom.projection).map(([key, value]) => `${key}:${value}`).join(",")}`);
  }
  const { viewport } = location;
  parts.push(`x=${encode(viewport.center_re)}`, `y=${encode(viewport.center_im)}`, `w=${encode(viewport.width)}`);
  if (location.maxiter) parts.push(`n=${location.maxiter}`);
  parts.push("a=16:10", `p=${encode(palette)}`);
  return parts.join("&");
}

/**
 * The examples a mode offers, as `{index, shown, custom, reached}`, `index` the keep's
 * place in the bundle's `shown`. Two keeps at one place that the published settings draw
 * alike are one picture, so the later is not offered (Matt, MESSAGE #844 of item 003:
 * soft-petals' second keep, an older formulation at its first one's place).
 */
export function offeredExamples(mode, encode) {
  const seen = new Set();
  const offered = [];
  for (const [index, shown] of mode.shown.entries()) {
    const same = exampleQuery(mode, shown, { palette: "", encode });
    if (seen.has(same)) continue;
    seen.add(same);
    offered.push({ index, shown, ...exampleCustom(mode, shown) });
  }
  return offered;
}

/** Output tiles of a `width × height` picture, the centre's first. */
export function tilesOf(width, height, size = TILE) {
  const tiles = [];
  for (let y = 0; y < height; y += size) {
    for (let x = 0; x < width; x += size) {
      tiles.push({ x, y, width: Math.min(size, width - x), height: Math.min(size, height - y) });
    }
  }
  const [cx, cy] = [width / 2, height / 2];
  const away = (tile) => Math.hypot(tile.x + tile.width / 2 - cx, tile.y + tile.height / 2 - cy);
  return tiles.sort((a, b) => away(a) - away(b));
}

/** A pass that was cancelled: what every awaited call of it rejects with. */
export class Cancelled extends Error {
  constructor() {
    super("cancelled");
    this.name = "Cancelled";
  }
}

/** One worker and the calls waiting on it, in the order it will answer them. */
class Slot {
  constructor(module) {
    this.module = module;
    this.pending = [];
    this.ready = this.spawn();
    this.ready.catch(() => {});
  }

  spawn() {
    return new Promise((resolve, reject) => {
      const worker = new Worker(new URL("./style-worker.js", import.meta.url), { type: "module" });
      worker.onmessage = (event) => {
        if (event.data.kind === "ready") {
          worker.onmessage = (answer) => this.answer(answer.data);
          worker.onerror = null;
          this.worker = worker;
          resolve(worker);
        }
      };
      worker.onerror = (event) => {
        worker.terminate();
        reject(new Error(`a custom-mode worker did not start (${event.message || "its script did not load"})`));
      };
      worker.postMessage({ kind: "start", module: this.module });
    });
  }

  answer(message) {
    const waiting = this.pending.shift();
    if (!waiting) return;
    if (message.kind === "failed") waiting.reject(new Error(message.why));
    else waiting.resolve(message);
  }

  async call(message, transfer = []) {
    try {
      await this.ready;
    } catch {
      // A worker that would not start (a respawn under memory pressure) gets one more try.
      this.ready = this.spawn();
      this.ready.catch(() => {});
      await this.ready;
    }
    return new Promise((resolve, reject) => {
      this.pending.push({ resolve, reject });
      this.worker.postMessage(message, transfer);
    });
  }

  /** Throw away whatever it is inside, and start a fresh one in its place. */
  reset() {
    if (this.pending.length === 0) return;
    for (const waiting of this.pending.splice(0)) waiting.reject(new Cancelled());
    this.worker?.terminate();
    this.worker = null;
    this.ready = this.spawn();
    this.ready.catch(() => {});
  }

  stop() {
    for (const waiting of this.pending.splice(0)) waiting.reject(new Cancelled());
    this.worker?.terminate();
  }
}

/**
 * The pool: `count` workers over one compiled `style.wasm`, one pass at a time.
 *
 * `draw` runs a pass and resolves with the finished picture's RGBA, or rejects with
 * `Cancelled` when a later `draw` or `cancel` overtook it; every hook it calls belongs to
 * a pass still current.
 */
export class StylePool {
  constructor(module, count) {
    this.module = module;
    this.slots = Array.from({ length: count }, () => new Slot(module));
    this.pass = 0;
  }

  static async start(url, count = poolSize()) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${url}: ${response.status} ${response.statusText}`);
    const spare = response.clone();
    let module;
    try {
      module = await WebAssembly.compileStreaming(response);
    } catch {
      module = await WebAssembly.compile(await spare.arrayBuffer());
    }
    const pool = new StylePool(module, count);
    try {
      await Promise.all(pool.slots.map((slot) => slot.ready));
    } catch (error) {
      pool.stop();
      throw error;
    }
    return pool;
  }

  get size() {
    return this.slots.length;
  }

  cancel() {
    this.pass += 1;
    for (const slot of this.slots) slot.reset();
  }

  stop() {
    this.pass += 1;
    for (const slot of this.slots) slot.stop();
  }

  /**
   * Draw one picture.
   *
   * `request` is the full picture's; with `preview` set, a quarter-size picture comes
   * first (`hooks.preview(rgba, width, height)`), then the tiles against the preview's
   * measure, then the exact pass. `hooks.tile(tile, rgba, exact)` lands each tile,
   * `hooks.stage(name, report)` names a step as it starts or finishes, and
   * `hooks.progress(done)` runs 0 to 1 over the pass.
   */
  async draw(request, options = {}) {
    this.cancel();
    const pass = this.pass;
    try {
      return await this.drawing(pass, request, options);
    } catch (error) {
      // A call that failed for real ends the pass for every worker, so none goes on landing
      // tiles of a picture the caller has already said could not be drawn.
      if (!(error instanceof Cancelled) && pass === this.pass) this.cancel();
      throw error;
    }
  }

  async drawing(pass, request, { preview = true, hooks = {} }) {
    const live = () => {
      if (pass !== this.pass) throw new Cancelled();
    };
    const [width, height] = request.resolution;
    const text = JSON.stringify(request);
    const picture = new Uint8ClampedArray(width * height * 4);
    const tiles = tilesOf(width, height);
    const timing = { workers: this.size };
    const started = performance.now();
    // Progress shares: the preview, the preview-balanced tiles, the exact measure, the
    // exact tiles. Each of the last three is about one picture's iteration spread over
    // the pool, except the measure, which every worker runs whole.
    const spans = preview ? [0.03, 0.27, 0.4, 0.3] : [0, 0, 0.5, 0.5];
    let base = 0;
    const report = (share, done) => hooks.progress?.(Math.min(1, base + share * done));

    const pw = Math.max(1, Math.round(width / PREVIEW_DIVISOR));
    const ph = Math.max(1, Math.round(height / PREVIEW_DIVISOR));
    if (preview) {
      hooks.stage?.("preview");
      const small = JSON.stringify({ ...request, resolution: [pw, ph], supersample: 1 });
      const at = performance.now();
      const frame = await this.slots[0].call({ kind: "frame", job: pass, request: small });
      live();
      timing.preview = performance.now() - at;
      hooks.preview?.(new Uint8ClampedArray(frame.pixels), frame.width, frame.height);
      base += spans[0];
    }

    const opened = await Promise.all(this.slots.map((slot) => slot.call({ kind: "open", job: pass, request: text })));
    live();
    const summary = opened[0].summary;

    const sweep = async (exact, share) => {
      const queue = [...tiles];
      let done = 0;
      await Promise.all(
        this.slots.map(async (slot) => {
          while (queue.length > 0) {
            const tile = queue.shift();
            const answer = await slot.call({ kind: "tile", job: pass, ...tile });
            live();
            const rgba = new Uint8ClampedArray(answer.pixels);
            if (exact) {
              for (let row = 0; row < tile.height; row += 1) {
                picture.set(
                  rgba.subarray(row * tile.width * 4, (row + 1) * tile.width * 4),
                  ((tile.y + row) * width + tile.x) * 4,
                );
              }
            }
            hooks.tile?.(tile, rgba, exact);
            done += 1;
            report(share, done / tiles.length);
          }
        }),
      );
      base += share;
    };

    if (preview) {
      hooks.stage?.("sharpening");
      const at = performance.now();
      await Promise.all(this.slots.map((slot) => slot.call({ kind: "measure", job: pass, frame: [pw, ph, 1] })));
      live();
      await sweep(false, spans[1]);
      timing.sharpening = performance.now() - at;
    }

    hooks.stage?.("measuring");
    let at = performance.now();
    // Every worker measures the whole frame: the measure lives in its session and cannot
    // cross, so the pool pays it once per worker, side by side.
    const measured = await Promise.all(this.slots.map((slot) => slot.call({ kind: "measure", job: pass })));
    live();
    timing.measure = performance.now() - at;
    base += spans[2];
    report(0, 0);
    hooks.stage?.("final", measured[0].report);

    at = performance.now();
    await sweep(true, spans[3]);
    timing.tiles = performance.now() - at;
    timing.total = performance.now() - started;
    for (const slot of this.slots) slot.call({ kind: "close", job: pass }).catch(() => {});
    return { picture, width, height, summary, tone: measured[0].report.tone, timing };
  }
}
