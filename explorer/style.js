// The custom render modes, Custom and Custom (lab): `style.wasm`, its worker pool, and what a view
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
// spread over the pool and composited as they land; then the tiles again against the tone
// measure at the picture's own size, which stitch to the pipeline's picture byte for byte.
// One worker takes that measure while the rest draw the preview-balanced tiles, and shares
// it (`export_measure`/`import_measure`); a palette switch at the same place re-measures
// from the frame that worker kept (`recolour`), iterating nothing before the tiles. A
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

/**
 * The two tiers the published modes come in (wallpapers 050, Matt's ruling), each its own
 * entry of the Mode select: **curated** (four or five knobs, kept pictures only) and
 * **lab** (knobs optional, an example may be a round-one draft's place). The select's
 * value is `option`; a link never names the tier, only the mode (`custom=<name>`), and the
 * tier is the mode's record's, so a link or a saved view from before the tiers still opens.
 */
export const TIERS = [
  { tier: "curated", option: "custom", label: "Custom", what: "The wallpaper project's published custom modes, drawn by its own compositor." },
  {
    tier: "lab",
    option: "custom-lab",
    label: "Custom (lab)",
    what: "The wallpaper project's experimental custom modes: fewer controls, and some examples are first drafts.",
  },
];

/** A mode's tier: its record's, and curated in a bundle from before the tiers. */
export function tierOf(mode) {
  return mode.tier === "lab" ? "lab" : "curated";
}

/** The bundle, by public name: `{name, style, palette, variant, what, knobs, stack, shown}`. */
export function modesOf(bundle) {
  return new Map(bundle.modes.map((mode) => [mode.name, mode]));
}

/** What `permalink.js` reads a link's custom keys against: each mode's knobs, its palette
 *  set by map name (the default first), and whether it has a projection a link may place.
 *  A style merged into a mode under an old name (`aliasesOf`) is an entry of its own,
 *  `{alias: {name, palette}}`, which the link reads as that mode at that palette. */
export function contractOf(bundle) {
  const contract = new Map(
    bundle.modes.map((mode) => [
      mode.name,
      {
        // `whole`: the module rounds the knob half to even, so the link reads it that way too.
        // `rests`: what an unset knob draws at each palette entry that tunes it (`knobRest`).
        knobs: mode.knobs.map((knob) => ({ ...knob, whole: wholeKnob(knob), rests: restsOf(mode, knob) })),
        palettes: palettesOf(mode).map((entry) => entry.colormap),
        projection: projectionKind(mode.stack),
      },
    ]),
  );
  for (const [old, alias] of aliasesOf(bundle)) {
    if (!contract.has(old)) contract.set(old, { alias });
  }
  return contract;
}

/**
 * A mode's palette set: each map the mode was kept in, with the values tuned for it, the
 * default (the stack's own, `values` empty) first. A bundle from before palette sets
 * carries none, and is the one map it names. **The same array every call**: callers tell
 * the default by identity (`entry === palettesOf(mode)[0]`), and a lab mode with no set
 * read a fresh one-entry array each time as a palette of its own.
 *
 * The sibling's `bundle()` writes the mode's own map first in every set, keeps or none
 * (wallpapers 085), so a set is the default and its kept entries as the bundle has them.
 */
export function palettesOf(mode) {
  let made = ONE_MAP.get(mode);
  if (made) return made;
  made = mode.palettes?.length ? mode.palettes : [{ colormap: mode.palette, values: {} }];
  ONE_MAP.set(mode, made);
  return made;
}
const ONE_MAP = new WeakMap();

/**
 * What a knob the reader has not set draws at a palette entry: the entry's tuned value of
 * the knob's first member, read back through the knob (`(value − offset) / scale`), where
 * the entry tunes it, else the knob's default. The module applies the entry's values and
 * then only the knobs that are set (`styles.at_palette`, then `with_knobs`), so this, not
 * `knob.default`, is the value the slider shows and the one a setting is no setting at
 * (022_bug_hunt: brass-foam's greenhorn draws Star rays at 0.5 with the slider at 0.3, and
 * moving it back to 0.3 dropped the setting and drew 0.5 again). Since wallpapers 087 the
 * bundle writes the same reading as each entry's `rests`, always inside the knob's range.
 */
export function knobRest(mode, entry, knob) {
  const target = knob.set[0];
  const path = typeof target === "string" ? target : target.path;
  const steps = path.split("/").slice(1);
  const [tuned] = at(withValues(mode.stack, entry?.values), steps);
  const [own] = at(mode.stack, steps);
  if (typeof tuned !== "number" || same(tuned, own)) return knob.default;
  const scale = typeof target === "string" ? 1 : (target.scale ?? 1);
  const offset = typeof target === "string" ? 0 : (target.offset ?? 0);
  const value = Number(((tuned - offset) / scale).toPrecision(12));
  return wholeKnob(knob) ? roundEven(value) : value;
}

/** A knob's rests by palette name, only where one differs from its default. */
function restsOf(mode, knob) {
  const rests = {};
  for (const entry of palettesOf(mode)) {
    const rest = knobRest(mode, entry, knob);
    if (rest !== knob.default) rests[entry.colormap] = rest;
  }
  return rests;
}

/** The palette entry a custom state draws: the one it names, else the mode's default. */
export function paletteOf(mode, custom) {
  const set = palettesOf(mode);
  return set.find((entry) => entry.colormap === custom?.palette) ?? set[0];
}

/**
 * Old names that still open a mode, as `name → {name, palette}`: a style merged into a
 * published mode (the sibling's `catalog.json` `aliases`) opens on the palette entry that
 * was it (its `was`), else on the mode's default. A bundle names them as the mode's
 * `aliases`, each a string or `{name, colormap}`; one the bundle does not carry is not
 * known here.
 */
export function aliasesOf(bundle) {
  const out = new Map();
  for (const mode of bundle.modes) {
    const set = palettesOf(mode);
    const at = (colormap) => (colormap && colormap !== set[0].colormap && set.some((e) => e.colormap === colormap) ? colormap : null);
    for (const entry of set) {
      if (entry.was && entry.was !== mode.name) out.set(entry.was, { name: mode.name, palette: at(entry.colormap) });
    }
    for (const alias of mode.aliases ?? []) {
      const old = typeof alias === "string" ? alias : alias.name;
      if (old === mode.name || out.has(old)) continue;
      const was = typeof alias === "string" ? set.find((entry) => entry.was === old)?.colormap : alias.colormap;
      out.set(old, { name: mode.name, palette: at(was) });
    }
  }
  return out;
}

/** A copy of `stack` with each of a palette entry's values written whole at its pointer
 *  (`/`-separated, list indices as numbers), as the sibling's `style_palettes.apply`
 *  writes them. A pointer naming nothing is skipped: the tone pass Auto tone dropped. */
export function withValues(stack, values = {}) {
  const pointers = Object.keys(values);
  if (pointers.length === 0) return stack;
  const out = structuredClone(stack);
  for (const pointer of pointers) {
    const steps = pointer.split("/").slice(1);
    if (steps.includes("*")) continue;
    put(out, steps, structuredClone(values[pointer]));
  }
  return out;
}

/** The one projection a stack draws through (`log_polar`), or `null`. */
export function projectionKind(stack) {
  const kinds = Object.keys(stack.projection ?? {});
  return kinds.length === 1 ? kinds[0] : null;
}

/** A custom state at a mode's defaults. */
export function freshCustom(name) {
  return { name, palette: null, knobs: {}, matched: true, autotone: true, projection: null };
}

/** The stack a custom state draws: the published one at its palette entry's values,
 *  without its tone pass when Auto tone is off. The knobs are not applied here: the module
 *  applies them, by the pipeline's rule, over the entry's values (`styles.at_palette`, then
 *  `with_knobs`). */
export function stackOf(mode, custom) {
  const stack = withValues(mode.stack, paletteOf(mode, custom).values);
  if (custom.autotone !== false) return stack;
  const { tone: _tone, ...rest } = stack;
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

/** The map a custom state draws with: its palette entry's (the mode's matched map by
 *  default), or the view's palette with Matched palette off. */
export function colormapOf(bundle, mode, custom, view, stopsOf) {
  if (custom.matched !== false) return bundle.colormaps[paletteOf(mode, custom).colormap];
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
  if (family.kind === "phoenix") return "phoenix";
  return null;
}

/** The engine's defaults for a Phoenix place's constants (`engine/src/spec.rs`'s
 *  `FamilySpec::Phoenix`): `{"kind": "phoenix"}` alone is the classic Ushiki set. */
export const PHOENIX_DEFAULTS = { c: ["0.5667", "0.0"], p: ["-0.5", "0.0"], z_prev: ["0.0", "0.0"] };

/** A place's constants as the link spells them, `[key, decimal]` pairs: a Julia set's `c`,
 *  and a Phoenix place's `c`, `p` and `z_prev`, the engine's defaults where it names none. */
export function constantsOf(family) {
  if (family.kind === "phoenix") {
    const { c, p, z_prev } = { ...PHOENIX_DEFAULTS, ...family };
    return [
      ["cx", c[0]],
      ["cy", c[1]],
      ["px", p[0]],
      ["py", p[1]],
      ["zx", z_prev[0]],
      ["zy", z_prev[1]],
    ];
  }
  return family.c ? [["cx", family.c[0]], ["cy", family.c[1]]] : [];
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

/** A stack as the engine reads it, for telling two stacks apart: each layer's `blend` and
 *  `opacity` written where the stack leaves them to their serde defaults (`engine/src/
 *  style.rs`'s `Layer`: `normal`, `1.0`). A stack that comes to spell a default (wallpapers
 *  054: bronze_packing's layer 2 writes `opacity: 1.0`, so an entry can set it) draws what
 *  it drew, and its keeps are still reached. */
function asRead(stack) {
  if (!Array.isArray(stack?.layers)) return stack;
  // Both first, so that a member spelt and one left out compare in one key order.
  const layers = stack.layers.map(({ blend = "normal", opacity = 1.0, ...rest }) => ({ blend, opacity, ...rest }));
  return { ...stack, layers };
}

/** The stack members the module treats as whole numbers (`style-wasm`'s `INTEGER_MEMBERS`). */
export const INTEGER_MEMBERS = new Set(["iterations", "hit", "settle", "sectors", "turns", "levels", "arms", "steps", "spokes"]);

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
  // A keep drawn in another of the set's maps opens on that palette, its values with it.
  const entry = palettesOf(mode).find((each) => each.colormap === shown.colormap);
  if (entry && entry !== palettesOf(mode)[0]) custom.palette = entry.colormap;
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
  const reached = same(asRead(turned(base, mode.knobs, settings)), asRead(keep));
  if (reached) custom.knobs = settings;
  return { custom, reached };
}

/** The link query an example opens: its place, at the keep's 16:10, in the mode. */
export function exampleQuery(mode, shown, { palette, encode }) {
  const { location } = shown;
  const family = familyOf(location.family);
  const parts = ["v=4"];
  if (family !== "mandelbrot") parts.push(`f=${family}`);
  for (const [key, value] of constantsOf(location.family)) parts.push(`${key}=${encode(value)}`);
  parts.push(`custom=${encode(mode.name)}`);
  const { custom } = exampleCustom(mode, shown);
  if (custom.palette) parts.push(`tuned=${encode(custom.palette)}`);
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

/**
 * The number of the Example button (from 1, as its label says) whose place the view is at,
 * or `null` at any other place: what tells one Example's download from another's, since the
 * mode, palette and size of two Examples are often one. A place is its family, constants and
 * viewport, held as numbers, so a link's re-spelled decimal is still the same place; the
 * knobs are not part of it. Two Examples at one place (glass-beads' second and third) are
 * told apart by the palette entry each opens on, the view's own where it is one of them.
 */
export function exampleAt(mode, view, encode) {
  const same = (text, field) => field !== undefined && Number(text) === Number(field.text);
  const here = [];
  for (const [number, { shown, custom }] of offeredExamples(mode, encode).entries()) {
    const { family, viewport } = shown.location;
    if (familyOf(family) !== view.family) continue;
    if (!constantsOf(family).every(([key, value]) => same(value, view.constants?.[key]))) continue;
    if (same(viewport.center_re, view.x) && same(viewport.center_im, view.y) && same(viewport.width, view.w)) {
      here.push({ number: number + 1, palette: paletteOf(mode, custom).colormap });
    }
  }
  const palette = view.custom ? paletteOf(mode, view.custom).colormap : null;
  return (here.find((each) => each.palette === palette) ?? here[0])?.number ?? null;
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
    // Moves on every reset, so a call still waiting on a respawn when a later cancel lands
    // is dropped there rather than posted to the fresh worker (004_bug_hunt: each burst of
    // wheel notches otherwise queued one stale preview frame ahead of the current one).
    this.epoch = 0;
    this.ready = this.spawn();
    this.ready.catch(() => {});
  }

  spawn() {
    return new Promise((resolve, reject) => {
      const worker = new Worker(new URL("./style-worker.js", import.meta.url), { type: "module" });
      // Held while it starts, so a reset or a stop in that window terminates it rather than
      // leaving a thread nobody answers to.
      this.spawning = worker;
      this.refuse = reject;
      worker.onmessage = (event) => {
        if (event.data.kind === "ready") {
          if (this.spawning !== worker) return;
          this.spawning = null;
          worker.onmessage = (answer) => this.answer(answer.data);
          worker.onerror = null;
          this.worker = worker;
          resolve(worker);
        }
      };
      worker.onerror = (event) => {
        if (this.spawning === worker) this.spawning = null;
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
    const epoch = this.epoch;
    try {
      await this.ready;
    } catch {
      if (epoch !== this.epoch) throw new Cancelled();
      // A worker that would not start (a respawn under memory pressure) gets one more try.
      this.ready = this.spawn();
      this.ready.catch(() => {});
      await this.ready;
    }
    if (epoch !== this.epoch) throw new Cancelled();
    return new Promise((resolve, reject) => {
      this.pending.push({ resolve, reject });
      this.worker.postMessage(message, transfer);
    });
  }

  /** Throw away whatever it is inside, and start a fresh one in its place. `force` does so
   *  for an idle worker too: a wasm memory never shrinks, so a worker that measured a large
   *  frame holds that frame's peak until it is replaced. */
  reset({ force = false } = {}) {
    this.epoch += 1;
    if (this.pending.length === 0 && !force) return;
    for (const waiting of this.pending.splice(0)) waiting.reject(new Cancelled());
    this.worker?.terminate();
    this.worker = null;
    this.abandon();
    this.ready = this.spawn();
    this.ready.catch(() => {});
  }

  stop() {
    this.epoch += 1;
    for (const waiting of this.pending.splice(0)) waiting.reject(new Cancelled());
    this.worker?.terminate();
    this.worker = null;
    this.abandon();
  }

  /** Terminate a worker still starting, and reject its `ready` as cancelled, so a call
   *  waiting on it ends (the epoch this moved has already cancelled it). */
  abandon() {
    if (!this.spawning) return;
    this.spawning.terminate();
    this.spawning = null;
    this.refuse?.(new Cancelled());
  }
}

/** Bytes of wasm memory a custom pass grows each worker by, per sample, with headroom:
 *  measured 90 to 250 over the nine published modes (004_bug_hunt; `measure` holds every
 *  layer's channels and the linear, lifted and toned frames at once). A memory never
 *  shrinks, so this is what a worker keeps after the pass too. */
export const BYTES_PER_SAMPLE = 256;

/** The most one worker can hold: wasm32's four gibibytes (a memory grows to 3.75 GiB and
 *  no further, measured), less room for the module. */
export const WORKER_MEMORY = 3.75 * 2 ** 30;

/** What a pass's workers may hold between them, counting each at the measurer's cost (as
 *  when every worker measured the whole frame; since website 020 only the first does, and
 *  the rest hold the shared measure and their tiles, so this is conservative): a large
 *  picture (a download, a 4K screen) runs on fewer workers: six gibibytes is a 1600x1000
 *  screen at 4x (1.5 GiB a worker) on four. */
export const PASS_MEMORY = 6 * 2 ** 30;

/** The most samples a custom picture may be: one worker's memory. */
export const MAX_CUSTOM_SAMPLES = Math.floor(WORKER_MEMORY / BYTES_PER_SAMPLE);

/** How many of `size` workers a picture of `samples` runs on within `budget`. */
export function workersFor(samples, size, budget = PASS_MEMORY) {
  return Math.max(1, Math.min(size, Math.floor(budget / (samples * BYTES_PER_SAMPLE))));
}

/** What a recolour keeps of a request: the place, the size, the supersample, and the
 *  mode's stack by name (another mode at one place measures afresh, so a post stage is
 *  never reached by a recolour). The module refuses whatever else its kept frame cannot
 *  serve; this only saves asking where the answer is known. */
export function placeOf(request) {
  return JSON.stringify([request.location, request.resolution, request.supersample, request.style?.name ?? null]);
}

/** One compile per module URL for the page's life, so a pool given back and started again
 *  costs a fetch from cache and no second compile. */
const compiled = new Map();
function compileOnce(url) {
  const key = String(url);
  if (!compiled.has(key)) {
    const made = (async () => {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`${url}: ${response.status} ${response.statusText}`);
      const spare = response.clone();
      try {
        return await WebAssembly.compileStreaming(response);
      } catch {
        return await WebAssembly.compile(await spare.arrayBuffer());
      }
    })();
    made.catch(() => compiled.delete(key));
    compiled.set(key, made);
  }
  return compiled.get(key);
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
    // The first slot's session after a finished tiled pass, which keeps that pass's frame:
    // `{worker, place}`, `place` what a recolour must hold (`placeOf`). A replaced worker
    // has lost it, so it is held by the worker's identity.
    this.kept = null;
  }

  static async start(url, count = poolSize()) {
    const module = await compileOnce(url);
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

  /** Cancel, and replace every worker, idle ones included, so none keeps the memory a
   *  large picture grew it to. */
  recycle() {
    this.pass += 1;
    for (const slot of this.slots) slot.reset({ force: true });
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
      // Every worker is replaced, the one that failed included: a module that trapped (a
      // picture past its memory) is not one to draw the next pass with.
      if (!(error instanceof Cancelled) && pass === this.pass) this.recycle();
      throw error;
    }
  }

  async drawing(pass, request, { preview = true, hooks = {}, workers = this.size }) {
    // A download as large as a worker can hold runs on fewer of them (`workersFor`).
    const slots = this.slots.slice(0, Math.max(1, Math.min(this.size, workers)));
    const live = () => {
      if (pass !== this.pass) throw new Cancelled();
    };
    const [width, height] = request.resolution;
    const text = JSON.stringify(request);
    const place = placeOf(request);
    const picture = new Uint8ClampedArray(width * height * 4);
    const timing = { workers: slots.length };
    const started = performance.now();
    // The first slot measures, keeps the frame, and shares its measure; the rest only tile.
    const [keeper, ...helpers] = slots;
    const kept = this.kept;
    this.kept = null;
    // Progress shares: the preview, the preview-balanced tiles (beside the exact measure),
    // the exact tiles.
    const spans = preview ? [0.03, 0.37, 0.6] : [0, 0.4, 0.6];
    let base = 0;
    const report = (share, done) => hooks.progress?.(Math.min(1, base + share * done));

    const pw = Math.max(1, Math.round(width / PREVIEW_DIVISOR));
    const ph = Math.max(1, Math.round(height / PREVIEW_DIVISOR));
    // The preview runs on the last slot, beside the keeper's first call; nothing lands before
    // it does, since a stretched preview would cover a tile already drawn.
    let previewed = Promise.resolve();
    if (preview) {
      hooks.stage?.("preview");
      const small = JSON.stringify({ ...request, resolution: [pw, ph], supersample: 1 });
      const at = performance.now();
      previewed = slots.at(-1)
        .call({ kind: "frame", job: pass, request: small })
        .then((frame) => {
          live();
          timing.preview = performance.now() - at;
          hooks.preview?.(new Uint8ClampedArray(frame.pixels), frame.width, frame.height);
          base += spans[0];
        });
      previewed.catch(() => {});
      // With one worker the preview is the keeper's own first call: let it finish first.
      if (slots.length === 1) await previewed;
    }

    // Exact tiles over the pool, each slot once its `ready` (its import) has landed.
    const tiles = tilesOf(width, height);
    const land = (tile, rgba) => {
      for (let row = 0; row < tile.height; row += 1) {
        picture.set(rgba.subarray(row * tile.width * 4, (row + 1) * tile.width * 4), ((tile.y + row) * width + tile.x) * 4);
      }
    };
    let exactStarted = false;
    const exact = async (readies) => {
      exactStarted = true;
      const queue = [...tiles];
      let done = 0;
      const at = performance.now();
      await Promise.all(
        slots.map(async (slot, index) => {
          await readies[index];
          live();
          while (queue.length > 0) {
            const tile = queue.shift();
            const answer = await slot.call({ kind: "tile", job: pass, ...tile });
            live();
            const rgba = new Uint8ClampedArray(answer.pixels);
            land(tile, rgba);
            hooks.tile?.(tile, rgba, true);
            done += 1;
            report(spans[2], done / tiles.length);
          }
        }),
      );
      timing.tiles = performance.now() - at;
      timing.total = performance.now() - started;
      // The helpers' sessions go; the keeper's stays, holding the frame a recolour reads.
      for (const slot of helpers) slot.call({ kind: "close", job: pass }).catch(() => {});
      this.kept = { worker: keeper.worker, place };
    };
    // The keeper's measure, exported and taken by every helper: one measure for the pool.
    const share = async () => {
      const exported = await keeper.call({ kind: "export", job: pass });
      live();
      const imports = helpers.map((slot) => slot.call({ kind: "import", job: pass, bytes: exported.bytes }));
      // Awaited by `exact`; handled here too, for a pass cancelled before it gets there.
      for (const call of imports) call.catch(() => {});
      return imports;
    };

    // A palette switch, a knob, Auto tone, at the place and size the keeper's frame holds:
    // re-measured from that frame, iterating nothing. Refused, the pass measures afresh.
    if (kept && kept.worker === keeper.worker && kept.place === place) {
      hooks.stage?.("recolouring");
      const at = performance.now();
      const answer = await keeper.call({ kind: "recolour", job: pass, request: text });
      live();
      timing.recolour = performance.now() - at;
      if (answer.report.ok) {
        timing.recoloured = true;
        timing.measure = timing.recolour;
        const opened = helpers.map((slot) => slot.call({ kind: "open", job: pass, request: text }));
        for (const call of opened) call.catch(() => {});
        const imports = await share();
        await previewed;
        live();
        base = spans[0] + spans[1];
        report(0, 0);
        hooks.stage?.("final", answer.report);
        await exact([Promise.resolve(), ...helpers.map((_, i) => opened[i].then(() => imports[i]))]);
        return { picture, width, height, summary: answer.report, tone: answer.report.tone, timing };
      }
      timing.recoloured = false;
    }

    const first = await keeper.call({ kind: "open", job: pass, request: text });
    live();
    const summary = first.summary;

    if (summary.post === true) {
      // A post stage reads the whole frame (a mosaic's lattice is fixed to it; a ray reads its brightest samples), so the
      // module draws it in one pass on one worker and refuses tiles; the preview above is
      // the same rule at a quarter size.
      hooks.stage?.("whole");
      const at = performance.now();
      const answer = await keeper.call({ kind: "whole", job: pass, width, height });
      live();
      await previewed;
      live();
      picture.set(new Uint8ClampedArray(answer.pixels));
      hooks.tile?.({ x: 0, y: 0, width, height }, picture, true);
      report(1 - base, 1);
      timing.workers = 1;
      timing.whole = performance.now() - at;
      timing.total = performance.now() - started;
      for (const slot of slots) slot.call({ kind: "close", job: pass }).catch(() => {});
      return { picture, width, height, summary, tone: null, timing };
    }

    const opened = Promise.all(helpers.map((slot) => slot.call({ kind: "open", job: pass, request: text })));
    // With helpers, the keeper measures the picture at once while they draw the tiles against
    // the preview's balance; alone, it draws those tiles first, as the screen wants them.
    let measureDone = false;
    timing.sharpening = 0;
    const sharpen = async (workers, until) => {
      await previewed;
      live();
      // Checked in the same turn as the small measures are posted: once the exact measure
      // is in, its import may already be queued, and a small measure after it would replace it.
      if (measureDone) return;
      hooks.stage?.("sharpening");
      const at = performance.now();
      await Promise.all(workers.map((slot) => slot.call({ kind: "measure", job: pass, frame: [pw, ph, 1] })));
      live();
      const queue = [...tiles];
      until?.then(
        () => queue.splice(0),
        () => {},
      );
      let done = 0;
      await Promise.all(
        workers.map(async (slot) => {
          while (queue.length > 0) {
            const tile = queue.shift();
            const answer = await slot.call({ kind: "tile", job: pass, ...tile });
            live();
            if (exactStarted) continue;
            hooks.tile?.(tile, new Uint8ClampedArray(answer.pixels), false);
            done += 1;
            report(spans[1], done / tiles.length);
          }
        }),
      );
      timing.sharpening = performance.now() - at;
    };

    const measuring = async () => {
      hooks.stage?.("measuring");
      const at = performance.now();
      const measured = await keeper.call({ kind: "measure", job: pass });
      measureDone = true;
      live();
      timing.measure = performance.now() - at;
      return measured;
    };

    let measured;
    let sharpened = Promise.resolve();
    if (helpers.length === 0) {
      if (preview) await sharpen([keeper]);
      measured = await measuring();
    } else {
      await opened;
      live();
      const measure = measuring();
      measure.catch(() => {});
      if (preview) {
        sharpened = sharpen(helpers, measure);
        sharpened.catch(() => {});
      }
      measured = await measure;
    }
    const imports = await share();
    await previewed;
    live();
    base = spans[0] + spans[1];
    report(0, 0);
    hooks.stage?.("final", measured.report);
    await exact([Promise.resolve(), ...imports]);
    await sharpened;
    return { picture, width, height, summary, tone: measured.report.tone, timing };
  }
}
