// The Walk tab: a simplified mining pipeline, run in the browser, where a reader can watch
// it choose.
//
// **What it does, once per walk.** Pick a parameter plane. Descend it the way the
// viewport sampler does: a quad-tree over the plane's home box, one cheap probe per cell
// saying which of its quarters straddle the set's edge, and — where the sampler takes
// every straddling cell in turn — the judge's opinion of each quarter's smooth picture
// choosing which one to go into. At a width drawn from the band the sampler draws in, the
// place is judged once more; if it clears the bar, a handful of rendering recipes are tried
// there and the best are kept as tiles. Then the next walk starts.
//
// **What it does not claim to be.** It is not the pipeline. The sampler is exhaustive and
// this is greedy; the pipeline judges JPEG-decoded pictures and this judges the canvas; the
// jitter is `Math.random` and not the sampler's hash. What it keeps are the parts a
// reader can see the point of: the straddle test, the screen's refusals, the gate's score,
// and the bar a place has to clear before anything is spent colouring it.
//
// **Two renderers, never one.** The viewer's renderer runs one job at a time and a new job
// cancels the old, so a walk scoring pictures through it would cancel whatever the reader
// is looking at, and the reader's every pan would cancel the walk. The walk has a pool of
// its own over the same compiled module, kept small so the viewer stays quick; its screen
// runs on two workers of its own because the battery iterates on the thread it is called
// from.
//
// **Nothing persists.** Found pictures are blob URLs in this page's memory, and a reload
// forgets them. Each tile is a permalink, which is how one outlives the page.

import * as link from "./permalink.js";
import { SETTLED } from "./catalog.js";
import { PROVENANCE } from "./palettes.js";
import { Renderer, specOf } from "./render.js";
import * as judges from "./judges.js";

// ------------------------------------------------------------------- the pipeline's numbers

/** The sampler's home box is the family's home view scaled by this (`HOME_SHARE`). */
const HOME_SHARE = 0.9;

/** The straddle probe: the sampler's `dump-field` geometry and cap. */
const PROBE = { width: 64, height: 36, maxiter: 256 };

/** The screen's node field (`screen::NODE_WIDTH`, and 16:9). */
const NODE = { width: 384, height: 216 };

/** Where a picture is judged: candidate geometry. The descent draws at one sample a pixel,
 *  because it judges dozens of pictures a walk; mining draws at the pipeline's two. */
const JUDGED = { width: 640, height: 360 };
const DESCENT_SUPERSAMPLE = 1;
const MINING_SUPERSAMPLE = 2;

/** The map the screen colours its frame through for the occupancy floor — the pipeline's
 *  own, `screen::run` is always handed it. */
const SCREEN_MAP = "twilight_shifted";

/** The map the descent's smooth pictures are coloured through before the judge reads them. */
const DESCENT_MAP = "twilight_shifted";

/** The solve's bar on the fine head (`solve.DEFAULT_FINE_BAR`), as the bake read it. */
const FINE_BAR = PROVENANCE.readings.fine_bar;

/** A found tile's picture: the gallery's tile size. */
const TILE = { width: 316, height: 178 };

/** The planes the viewport sampler serves (`SERVED`): the five parameter planes and the
 *  pinned Phoenix slice, which is the explorer's own Phoenix constants. Phoenix has no
 *  Julia twin, which is the only thing that sets it apart here. */
const PLANES = ["mandelbrot", "multibrot3", "multibrot4", "multibrot5", "multibrot6", "phoenix"];

/** The thirteen modes the pipeline accepts (`mode_policy.accepted()`), in the engine's
 *  catalog order. `curvature` is accepted and not mined — `mode_policy.UNMINED` — so it is
 *  listed and starts unticked. */
const MINED_MODES = [
  "smooth",
  "tia",
  "stripe",
  "curvature",
  "smooth_mean_angle",
  "smooth_angle_min",
  "smooth_stripe",
  "smooth_curvature",
  "direct_trap_screen",
  "direct_trap_multiply",
  "direct_trap_lines",
  "threads",
  "itinerary",
];
const UNMINED = new Set(["curvature"]);

/** What a new tab's config opens at: the pipeline's draw, where the page can make it.
 *  Three recipes a place is hunt and mine's `PER_LOCATION`, each a different mode; the
 *  pipeline keeps every one and lets the solve choose, and a tab that did would fill with
 *  pictures nobody would pick, so it keeps the best. */
const DEFAULTS = {
  planes: new Set(PLANES),
  julia: true,
  modes: new Set(MINED_MODES.filter((mode) => !UNMINED.has(mode))),
  roster: "random",
  widest: 0.1,
  narrowest: 1e-3,
  recipes: 3,
  keep: 1,
  bar: 0.5,
};

/** Where a composite's texture weight opens when this page derives none for its mode: the
 *  explorer's own hand-switch default, `TEXTURE_DEFAULT`. */
const TEXTURE_DEFAULT = 0.5;

/** How many times a walk backs up before it gives the plane up. */
const MOST_BACKS = 8;

/** How many lines the console keeps. */
const CONSOLE_LINES = 60;

/** Which quarter a child is, by its column and row within its parent (`b` counts up). */
const QUARTER = [
  ["lower-left", "upper-left"],
  ["lower-right", "upper-right"],
];

// ------------------------------------------------------------------- small things

const pick = (items) => items[Math.floor(Math.random() * items.length)];
const shortWidth = (w) => (w >= 0.01 ? w.toFixed(3) : w.toPrecision(2));
const score = (value) => value.toFixed(2);
const megabytes = (bytes) => (bytes / 1e6).toFixed(1);

/** A screen refusal, as a reader would say it. */
const REFUSALS = {
  interior_cap: (reading) => `mostly inside the set (${score(reading)} of it)`,
  instant_escape: () => "almost everything escapes at once",
  flat: () => "too flat: the escape times barely vary",
  occupancy_floor: (reading) => `too empty: detail in only ${score(reading)} of the frame`,
};

/** A pool of workers that each run the engine's screen on one frame at a time. */
class Screeners {
  constructor(module, count) {
    this.waiting = [];
    this.pending = new Map();
    this.next = 0;
    this.idle = [];
    for (let index = 0; index < count; index++) {
      const worker = new Worker(new URL("./worker.js", import.meta.url), { type: "module" });
      worker.onmessage = (event) => {
        if (event.data.kind === "ready") {
          this.idle.push(worker);
          this.#pump();
          return;
        }
        if (event.data.kind !== "screened") return;
        this.pending.get(event.data.id)?.(event.data.report);
        this.pending.delete(event.data.id);
        this.idle.push(worker);
        this.#pump();
      };
      worker.postMessage({ kind: "start", module });
    }
  }

  #pump() {
    while (this.idle.length > 0 && this.waiting.length > 0) {
      const worker = this.idle.shift();
      const { id, spec, occupancy } = this.waiting.shift();
      worker.postMessage({ kind: "screen", id, spec, occupancy });
    }
  }

  /** The screen's report on one spec. */
  screen(spec, occupancy = true) {
    return new Promise((resolve) => {
      const id = this.next++;
      this.pending.set(id, resolve);
      this.waiting.push({ id, spec: JSON.stringify(spec), occupancy });
      this.#pump();
    });
  }
}

// ------------------------------------------------------------------- the tab

export function mount(host) {
  const { contract, palettes, shownName, planeName, juliaOf } = host;
  const config = {
    ...DEFAULTS,
    planes: new Set(DEFAULTS.planes),
    modes: new Set(DEFAULTS.modes),
  };
  let state = "idle"; // idle | loading | running | paused
  let resume = null;
  let renderer = null;
  let screeners = null;
  let scorer = null; // a `Judges`, or `null` where the runtime would not load
  let loop = null;
  const timings = { probe: [], screen: [], render: [], shade: [], gate: [], fine: [], walk: [] };
  const found = [];
  /** One row per walk, for whoever is measuring the tab: where it went and what it saw. */
  const walks = [];

  // ----------------------------------------------------------------- the console

  function log(text) {
    const line = document.createElement("li");
    line.textContent = text;
    host.console.prepend(line);
    while (host.console.children.length > CONSOLE_LINES) host.console.lastElementChild.remove();
  }

  function progress(text) {
    host.progress.textContent = text;
  }

  function syncButton() {
    host.start.textContent = state === "running" ? "Pause" : state === "loading" ? "Loading…" : "Start";
    host.start.disabled = state === "loading";
  }

  // ----------------------------------------------------------------- the config

  function checkbox(parent, label, checked, onChange, title = "") {
    const box = document.createElement("label");
    box.className = "walk-check";
    if (title) box.title = title;
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = checked;
    input.addEventListener("change", () => onChange(input.checked));
    box.append(input, ` ${label}`);
    parent.append(box);
    return input;
  }

  function group(title, hint = "") {
    const section = document.createElement("fieldset");
    section.className = "walk-group";
    const legend = document.createElement("legend");
    legend.textContent = title;
    section.append(legend);
    if (hint) {
      const note = document.createElement("p");
      note.className = "walk-hint";
      note.textContent = hint;
      section.append(note);
    }
    host.fields.append(section);
    return section;
  }

  function number(parent, label, value, { min, max, step }, onChange, title = "") {
    const box = document.createElement("label");
    box.className = "walk-number";
    if (title) box.title = title;
    const input = document.createElement("input");
    input.type = "number";
    input.className = "param";
    Object.assign(input, { min, max, step, value });
    input.addEventListener("change", () => {
      const read = Number(input.value);
      if (Number.isFinite(read) && read >= min && read <= max) {
        onChange(read);
      } else {
        input.value = String(value);
      }
    });
    box.append(`${label} `, input);
    parent.append(box);
    return input;
  }

  function buildConfig() {
    const planes = group("Planes", "A walk picks one of these at random.");
    for (const family of PLANES) {
      checkbox(planes, planeName(family), config.planes.has(family), (on) => {
        if (on) config.planes.add(family);
        else config.planes.delete(family);
      });
    }
    checkbox(
      planes,
      "Julia twin",
      config.julia,
      (on) => {
        config.julia = on;
      },
      "At the bottom of a walk, also try the Julia set whose c is the place it reached.",
    );

    const modes = group("Modes", "Each recipe draws one of these.");
    for (const mode of MINED_MODES) {
      checkbox(modes, mode, config.modes.has(mode), (on) => {
        if (on) config.modes.add(mode);
        else config.modes.delete(mode);
      });
    }

    const drawable = [...palettes].filter(([, map]) => map.random).length;
    const roster = group("Palettes");
    for (const [value, label] of [
      ["random", `The ${drawable} that Random palette draws from`],
      ["all", `All ${palettes.size}`],
    ]) {
      const box = document.createElement("label");
      box.className = "walk-check";
      const input = document.createElement("input");
      input.type = "radio";
      input.name = "walk-roster";
      input.checked = config.roster === value;
      input.addEventListener("change", () => {
        if (input.checked) config.roster = value;
      });
      box.append(input, ` ${label}`);
      roster.append(box);
    }

    const depth = group("Target width", "Drawn log-uniformly between these two.");
    number(depth, "widest", config.widest, { min: 1e-6, max: 1, step: "any" }, (v) => {
      config.widest = v;
    });
    number(depth, "narrowest", config.narrowest, { min: 1e-9, max: 1, step: "any" }, (v) => {
      config.narrowest = v;
    });

    const mining = group("At a place");
    number(mining, "recipes tried", config.recipes, { min: 1, max: 32, step: 1 }, (v) => {
      config.recipes = v;
    });
    number(mining, "kept", config.keep, { min: 1, max: 32, step: 1 }, (v) => {
      config.keep = v;
    });
    number(
      mining,
      "bar, P≥3",
      config.bar,
      { min: 0, max: 1, step: 0.01 },
      (v) => {
        config.bar = v;
      },
      "The render judge's probability that a place's smooth picture is at least a 3. A place under it is not colored. The pipeline's own release gate is P≥4 at 0.50 on a colored picture, and P≥3 at 0.50 is the bar it falls back on for a mode with too few places.",
    );
  }

  // ----------------------------------------------------------------- start and pause

  async function begin() {
    state = "loading";
    syncButton();
    log("Starting the walk's renderer.");
    const cores = navigator.hardwareConcurrency || 8;
    renderer = await Renderer.over(host.module, Math.max(1, Math.min(4, Math.floor(cores / 3))));
    if (typeof renderer.shader.screen !== "function") {
      throw new Error("this page's renderer is older than the walk and has no screen");
    }
    screeners = new Screeners(host.module, 2);
    try {
      scorer = await judges.load((what, got, of) => {
        const name = { runtime: "the judge runtime", gate: "the render judge" }[what];
        progress(`Downloading ${name}… ${megabytes(got)} of ${megabytes(of)} MB`);
      });
      log(`The render judge is running on ${scorer.backend === "webgpu" ? "the GPU (WebGPU)" : "the CPU (WebAssembly)"}.`);
    } catch (error) {
      console.warn("the judges could not be loaded", error);
      scorer = null;
      log("The judges could not be loaded here, so the walk runs on the screen's gates alone and picks among what passes at random.");
    }
    progress("");
  }

  async function toggle() {
    if (state === "running") {
      pause("Paused.");
      return;
    }
    if (state === "loading") return;
    if (renderer === null) {
      try {
        await begin();
      } catch (error) {
        console.error("the walk could not start", error);
        state = "idle";
        syncButton();
        log(`The walk could not start: ${error.message ?? error}.`);
        progress("");
        return;
      }
    }
    state = "running";
    syncButton();
    if (resume !== null) {
      log("Carrying on.");
      const go = resume;
      resume = null;
      go();
    }
    loop ??= forever().catch((error) => {
      console.error("the walk stopped", error);
      log(`The walk stopped: ${error.message ?? error}.`);
      state = "idle";
      loop = null;
      syncButton();
    });
  }

  function pause(why) {
    if (state !== "running") return;
    state = "paused";
    syncButton();
    log(why);
  }

  /** Every step of a walk passes through here: it returns at once while the walk runs, and
   *  otherwise waits for Start. */
  function going() {
    if (state === "running" && !host.busy()) return Promise.resolve();
    return new Promise((resolve) => {
      if (state === "running") {
        // A download holds the viewer still; the walk waits on it rather than moving it.
        setTimeout(() => going().then(resolve), 500);
        return;
      }
      const previous = resume;
      resume = () => {
        previous?.();
        resolve();
      };
    });
  }

  // ----------------------------------------------------------------- views and pictures

  /** A view of `family` at a frame, in `mode` and `palette`. */
  function viewAt(family, frame, { mode = "smooth", palette = DESCENT_MAP, constants = null } = {}) {
    const base = link.fresh(family, mode, contract);
    return {
      ...base,
      constants: constants ?? base.constants,
      x: link.coordinateOf(frame.x),
      y: link.coordinateOf(frame.y),
      w: link.coordinateOf(frame.w),
      palette,
    };
  }

  function timed(bucket, started) {
    timings[bucket].push(performance.now() - started);
  }

  /** The straddle probe: each quarter's share of the set's interior, by `[a][b]`. */
  async function straddles(family, cell) {
    const started = performance.now();
    const field = await renderer.field(viewAt(family, cell), PROBE.width, PROBE.height, {
      maxiter: PROBE.maxiter,
    });
    timed("probe", started);
    if (field === null) return null;
    const halfW = PROBE.width / 2;
    const halfH = PROBE.height / 2;
    const shares = [
      [0, 0],
      [0, 0],
    ];
    for (let row = 0; row < PROBE.height; row++) {
      // Row 0 is the top of the frame, and `b` counts up from the bottom.
      const b = row < halfH ? 1 : 0;
      for (let col = 0; col < PROBE.width; col++) {
        if (Number.isNaN(field.values[row * PROBE.width + col])) shares[col < halfW ? 0 : 1][b] += 1;
      }
    }
    for (const a of [0, 1]) for (const b of [0, 1]) shares[a][b] /= halfW * halfH;
    return shares;
  }

  /** The engine's screen on one frame: `{ passed, fate, reading }`. */
  async function screened(view) {
    const started = performance.now();
    const spec = specOf({ ...view, mode: "smooth", palette: SCREEN_MAP, params: {} }, NODE.width, NODE.height);
    const report = await screeners.screen(spec, true);
    timed("screen", started);
    if (!report.ok) throw new Error(report.why);
    const failed = report.verdicts.find((verdict) => !verdict.passed);
    return { passed: report.passed, fate: report.fate, reading: failed?.reading ?? null };
  }

  /** A picture of `view` at candidate geometry, as `ImageData`, and the view it was drawn
   *  at — which carries the texture weight or trap opacity this page derived for it. */
  async function picture(view, supersample) {
    const derived = link.DERIVED[view.mode];
    let drawn = view;
    let started = performance.now();
    if (derived === "opacity") {
      const counts = await renderer.probe(view, 160, 90);
      if (counts === null) return null;
      const probed = renderer.deriveOpacity(view, counts);
      if (probed.opacity !== null) drawn = { ...view, params: { ...view.params, opacity: probed.opacity } };
    }
    let field = null;
    if (derived === "weight") {
      // Measured on the one-sample field, exactly where the viewer measures it.
      const once = await renderer.field(view, JUDGED.width, JUDGED.height);
      if (once === null) return null;
      const measured = renderer.shade(once, view, { deriveWeight: true });
      if (measured.weight !== null) drawn = { ...view, params: { ...view.params, weight: measured.weight } };
      if (supersample === 1) field = once;
    }
    field ??= await renderer.field(drawn, JUDGED.width, JUDGED.height, { supersample });
    timed("render", started);
    if (field === null) return null;
    started = performance.now();
    const image = renderer.shade(field, drawn).image;
    timed("shade", started);
    return { image, view: drawn };
  }

  /** The gate's `{ p2, p3, p4 }` on a picture, or a coin where there is no judge. */
  async function gated(image) {
    if (scorer === null) {
      const coin = Math.random();
      return { p2: coin, p3: coin, p4: coin, coin: true };
    }
    const started = performance.now();
    const read = await scorer.gate(image);
    timed("gate", started);
    return read;
  }

  // ----------------------------------------------------------------- the descent

  /** The plane's home box, and the rungs of the band the target falls in. */
  function boxOf(family) {
    const home = contract.home(family);
    const w = home.w.value * HOME_SHARE;
    return { x: home.x.value, y: home.y.value, w, h: (w * 9) / 16 };
  }

  /** Cell `(i, j)` of rung `r`, unjittered. */
  function cellOf(box, r, i, j) {
    const w = box.w / 2 ** r;
    const h = box.h / 2 ** r;
    return { r, i, j, x: box.x - box.w / 2 + (i + 0.5) * w, y: box.y - box.h / 2 + (j + 0.5) * h, w, h };
  }

  /** The frame a cell is drawn at: its own width, its centre moved up to a quarter cell. */
  function jittered(cell) {
    return {
      ...cell,
      x: cell.x + (Math.random() - 0.5) * 0.5 * cell.w,
      y: cell.y + (Math.random() - 0.5) * 0.5 * cell.h,
    };
  }

  /** The cells of one rung the walk is weighing, as the overlay draws them. */
  function cellsOf(children) {
    return children.map((child) => ({
      x: child.frame.x,
      y: child.frame.y,
      w: child.frame.w,
      h: child.frame.h,
      state: child.state,
      label: child.label,
    }));
  }

  /**
   * Weigh the quarters of `cell` that straddle the set's edge: screen them where the rung is
   * in the band, then judge each survivor's smooth picture. Returns them best first.
   */
  async function weigh(family, box, cell, first) {
    await going();
    const shares = await straddles(family, cell);
    if (shares === null) return [];
    const children = [];
    for (const a of [0, 1]) {
      for (const b of [0, 1]) {
        const share = shares[a][b];
        if (share <= 0 || share >= 1) continue;
        const child = cellOf(box, cell.r + 1, 2 * cell.i + a, 2 * cell.j + b);
        children.push({ cell: child, frame: jittered(child), where: QUARTER[a][b], state: "weighing", label: "" });
      }
    }
    const rung = cell.r + 1;
    log(
      `Probing the cell at width ${shortWidth(cell.w)} · ${children.length} of 4 quarters straddle the set's edge.`,
    );
    if (children.length === 0) return [];
    host.follow(viewAt(family, cell), cellsOf(children));

    const screening = rung >= first;
    if (screening) {
      await going();
      const verdicts = await Promise.all(children.map((child) => screened(viewAt(family, child.frame))));
      const refused = [];
      children.forEach((child, index) => {
        const verdict = verdicts[index];
        if (verdict.passed) return;
        child.state = "refused";
        child.label = "refused";
        refused.push(`the ${child.where} (${REFUSALS[verdict.fate]?.(verdict.reading) ?? verdict.fate})`);
      });
      if (refused.length > 0) log(`The screen refused ${refused.join("; ")}.`);
      host.showCells(cellsOf(children));
    }

    const standing = children.filter((child) => child.state !== "refused");
    for (const child of standing) {
      await going();
      const drawn = await picture(viewAt(family, child.frame), DESCENT_SUPERSAMPLE);
      if (drawn === null) continue;
      child.read = await gated(drawn.image);
      child.label = score(child.read.p3);
      host.showCells(cellsOf(children));
    }
    const ranked = standing
      .filter((child) => child.read !== undefined)
      .sort((x, y) => y.read.p3 - x.read.p3 || Math.random() - 0.5);
    walks.at(-1)?.rungs.push({
      rung,
      straddling: children.length,
      refused: children.length - standing.length,
      p3: ranked.map((child) => Number(child.read.p3.toFixed(4))),
    });
    if (ranked.length > 0) {
      const best = ranked[0];
      best.state = "chosen";
      host.showCells(cellsOf(children));
      log(
        scorer === null
          ? `Picked the ${best.where} at random.`
          : `The judge likes the ${best.where} best (${score(best.read.p3)}).`,
      );
    }
    return ranked;
  }

  /**
   * One walk down one plane, to a width drawn from the band. Returns the place it reached —
   * `{ family, frame, read }` — or `null` where the plane gave out first.
   */
  async function descend(family) {
    const box = boxOf(family);
    const lo = Math.log(config.narrowest);
    const hi = Math.log(config.widest);
    const target = Math.exp(lo + Math.random() * (hi - lo));
    const first = Math.max(1, Math.ceil(Math.log2(box.w / config.widest)));
    const last = Math.max(first, Math.floor(Math.log2(box.w / config.narrowest)));
    const bottom = Math.min(last, Math.max(first, Math.round(Math.log2(box.w / target))));
    log(
      `A new walk on ${planeName(family)}, aiming for a width near ${shortWidth(box.w / 2 ** bottom)}: ${bottom} halvings down.`,
    );

    const row = { family, target, first, bottom, rungs: [], backs: 0, outcome: "descending" };
    walks.push(row);
    const stack = [{ cell: cellOf(box, 0, 0, 0), ranked: null }];
    let backs = 0;
    while (stack.length > 0) {
      const level = stack.at(-1);
      level.ranked ??= await weigh(family, box, level.cell, first);
      const next = level.ranked.shift();
      if (next === undefined) {
        stack.pop();
        backs += 1;
        row.backs = backs;
        if (stack.length === 0 || backs > MOST_BACKS) break;
        log("Nothing here is worth going into, so the walk backs up a rung and tries the next-best cell.");
        continue;
      }
      if (next.cell.r >= bottom) {
        row.outcome = "reached";
        return { family, frame: next.frame, read: next.read };
      }
      stack.push({ cell: next.cell, ranked: null });
    }
    row.outcome = "gave out";
    log(`${planeName(family)} gave out before the walk reached its width, so it starts again somewhere else.`);
    return null;
  }

  // ----------------------------------------------------------------- mining

  /** A recipe's parameters before anything is measured: a composite whose weight this page
   *  does not derive opens where the explorer's hand switch opens it. A derived weight or
   *  opacity is left out here and measured by `picture`. */
  function handParams(mode) {
    const settled = SETTLED[mode]?.weight;
    if (link.DERIVED[mode] === undefined && settled !== undefined && settled !== TEXTURE_DEFAULT) {
      return { weight: TEXTURE_DEFAULT };
    }
    return {};
  }

  /** The palettes a recipe may draw. */
  function roster() {
    const names = [...palettes].filter(([, map]) => config.roster === "all" || map.random).map(([name]) => name);
    return names.length > 0 ? names : [...palettes.keys()];
  }

  /** The Julia twin of a place: its centre as `c`, at the Julia family's home frame. */
  function twinOf(place) {
    const julia = juliaOf[place.family];
    const constants = { cx: link.coordinateOf(place.frame.x), cy: link.coordinateOf(place.frame.y) };
    const home = contract.home(julia);
    const frame = { x: home.x.value, y: home.y.value, w: home.w.value };
    return { family: julia, frame, constants };
  }

  /** Judge a place's smooth picture, and say whether it clears the bar. */
  async function judgePlace(place) {
    await going();
    const view = viewAt(place.family, place.frame, { constants: place.constants });
    const drawn = await picture(view, DESCENT_SUPERSAMPLE);
    if (drawn === null) return null;
    return gated(drawn.image);
  }

  /** Try recipes at a place that cleared the bar, and keep the best as tiles. */
  async function mine(place) {
    if (config.modes.size === 0) {
      log("No modes are ticked, so there is nothing to color this place in.");
      return;
    }
    if (scorer !== null && scorer.fineSession === null) {
      progress("Downloading the fine judge…");
      try {
        await scorer.loadFine((what, got, of) =>
          progress(`Downloading the fine judge… ${megabytes(got)} of ${megabytes(of)} MB`),
        );
        log("The fine judge is ready; recipes are ranked by it from here.");
      } catch (error) {
        console.warn("the fine judge could not be loaded", error);
        log("The fine judge could not be loaded, so recipes are ranked by the render judge alone.");
      }
      progress("");
    }
    // Modes without replacement, as `hunt.modes_for` draws them: a place tried three times
    // is tried in three modes.
    const modes = [...config.modes].sort(() => Math.random() - 0.5);
    const maps = roster();
    const tried = [];
    for (let index = 0; index < config.recipes; index++) {
      await going();
      const mode = modes[index % modes.length];
      const palette = pick(maps);
      const base = viewAt(place.family, place.frame, { mode, palette, constants: place.constants });
      // The pipeline's shade is the identity with the fold read off the map: a sequential
      // map is mirrored and a cyclic one is not. Phase is its `--phase-draw`, uniform, and a
      // direct trap keeps phase 0 because phase does nothing there.
      const direct = mode.startsWith("direct_trap_");
      const view = {
        ...base,
        params: handParams(mode),
        shade: {
          ...base.shade,
          mirror: !palettes.get(palette).cyclic,
          phase: direct ? 0 : Number(Math.random().toFixed(3)),
        },
      };
      host.follow(view);
      const drawn = await picture(view, MINING_SUPERSAMPLE);
      if (drawn === null) continue;
      const read = await gated(drawn.image);
      let fine = null;
      if (scorer?.fineSession) {
        const started = performance.now();
        fine = await scorer.fine(drawn.image);
        timed("fine", started);
      }
      const rank = fine ?? read.p4;
      log(
        `Recipe ${index + 1} of ${config.recipes}: ${mode} in ${shownName(palette)} · ` +
          `P≥4 ${score(read.p4)}${fine === null ? "" : ` · fine ${fineText(fine)}`}.`,
      );
      tried.push({ view: drawn.view, image: drawn.image, read, fine, rank });
      (walks.at(-1).recipes ??= []).push({ family: place.family, mode, palette, p4: read.p4, fine });
    }
    tried.sort((x, y) => y.rank - x.rank);
    const kept = tried.slice(0, config.keep);
    for (const one of kept) await keep(one);
    if (kept.length > 0) {
      log(`Kept the best ${kept.length}: ${kept.map((one) => `${one.view.mode} (${rankText(one)})`).join(", ")}.`);
    }
  }

  function rankText(one) {
    return one.fine === null ? `P≥4 ${score(one.read.p4)}` : `fine ${fineText(one.fine)}`;
  }

  /** The fine head's number, which lives far below 0.01 — its bar is `FINE_BAR` — so it is
   *  written to two significant figures rather than to a fixed place. */
  function fineText(value) {
    return value.toPrecision(2);
  }

  /** A found picture, as a tile at the top of the list. */
  async function keep(one) {
    const canvas = document.createElement("canvas");
    canvas.width = one.image.width;
    canvas.height = one.image.height;
    canvas.getContext("2d").putImageData(one.image, 0, 0);
    const small = document.createElement("canvas");
    small.width = TILE.width;
    small.height = TILE.height;
    const ink = small.getContext("2d");
    ink.imageSmoothingQuality = "high";
    ink.drawImage(canvas, 0, 0, TILE.width, TILE.height);
    const blob = await new Promise((resolve) => small.toBlob(resolve, "image/webp", 0.85));
    const query = link.emit(one.view, contract);
    found.unshift({ query, rank: one.rank });

    const tile = document.createElement("button");
    tile.type = "button";
    tile.className = "tile walk-tile is-ready";
    tile.title = `${one.view.mode} in ${shownName(one.view.palette)} on ${planeName(one.view.family)}`;
    const image = document.createElement("img");
    image.width = TILE.width;
    image.height = TILE.height;
    image.alt = tile.title;
    image.src = URL.createObjectURL(blob);
    const badge = document.createElement("span");
    badge.className = "walk-score";
    badge.textContent = rankText(one);
    badge.title =
      one.fine === null
        ? "The render judge's probability that this picture is at least a 4."
        : `One member of the fine judge (seed 0): its probability that this picture is at least a 4. ` +
          `The pipeline seats on the mean of three seeds, at ${FINE_BAR} or above.`;
    tile.append(image, badge);
    tile.addEventListener("click", () => {
      pause("A found picture was opened, so the walk paused.");
      for (const other of host.found.querySelectorAll(".tile")) other.classList.toggle("is-open", other === tile);
      host.open(query, "this found picture");
    });
    host.found.prepend(tile);
    host.note.textContent = `${found.length} found. They last until the page is closed.`;
  }

  // ----------------------------------------------------------------- the loop

  async function forever() {
    for (;;) {
      await going();
      const planes = [...config.planes];
      if (planes.length === 0) {
        log("No planes are ticked. Tick one in Walk config and press Start.");
        pause("Paused.");
        continue;
      }
      const started = performance.now();
      const family = pick(planes);
      const place = await descend(family);
      if (place === null) continue;
      const places = [{ ...place, constants: null }];
      if (config.julia && juliaOf[family] !== undefined) places.push(twinOf(place));
      for (const [index, one] of places.entries()) {
        const read = index === 0 ? place.read : await judgePlace(one);
        if (read == null) continue;
        (walks.at(-1).places ??= []).push({
          family: one.family,
          w: one.frame.w,
          p3: read.p3,
          mined: read.p3 >= config.bar,
        });
        const what = index === 0 ? `the place at width ${shortWidth(one.frame.w)}` : `its Julia twin, at c = ${one.constants.cx.text.slice(0, 9)}, ${one.constants.cy.text.slice(0, 9)}`;
        if (index > 0) host.follow(viewAt(one.family, one.frame, { constants: one.constants }));
        if (read.p3 < config.bar) {
          log(`The judge gives ${what} ${score(read.p3)}, under the ${score(config.bar)} bar, so it is not colored.`);
          continue;
        }
        log(`The judge gives ${what} ${score(read.p3)}, over the ${score(config.bar)} bar. Trying ${config.recipes} recipes.`);
        await mine(one);
      }
      timed("walk", started);
      walks.at(-1).ms = Math.round(performance.now() - started);
    }
  }

  // ----------------------------------------------------------------- the handle

  buildConfig();
  syncButton();
  host.start.addEventListener("click", toggle);
  window.__walk = { timings, found, config, walks };

  return {
    running: () => state === "running",
    pause,
  };
}
