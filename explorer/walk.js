// The Walk tab: a simplified mining pipeline, run in the browser, where a reader can watch
// it choose.
//
// **What it does, once per walk.** Pick a parameter plane. Descend it the way the
// viewport sampler does: a quad-tree over the plane's home box, one cheap probe per cell
// saying which of its quarters straddle the set's edge, and — where the sampler takes
// every straddling cell in turn — one straddling quarter at random. That first pass is
// quick and out of sight: nothing is judged, and only the frame it stops at, at a width
// drawn from the root band, goes through the screen. That frame is the walk's root, a
// genuine piece of the boundary. From the root the walk goes on rung by rung with the
// viewer following, and here the judge's opinion of each quarter's smooth picture chooses
// which one to go into, until its score has peaked. At the best frame it saw, if that clears
// the bar, a handful of rendering recipes are tried and the best are kept as tiles. Then
// the next walk starts.
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
// **Nothing persists unless it is saved.** Found pictures are blob URLs in this page's
// memory, and a reload forgets them. Each tile is a permalink, which is how one outlives
// the page: its save mark, or Save all found, puts it on the Saved tab *(saved_tab_ckpt131)*.

import * as link from "./permalink.js";
import { SETTLED } from "./catalog.js";
import { HUES, colorOf } from "./hues.js";
import { Renderer, specOf } from "./render.js";
import * as judges from "./judges.js";

// ------------------------------------------------------------------- the pipeline's numbers

/** The sampler's home box is the family's home view scaled by this (`HOME_SHARE`). */
const HOME_SHARE = 0.9;

/** The straddle probe: the sampler's `dump-field` geometry and cap. The cap is a shortcut
 *  only the wide rungs can afford, so below `wide` the probe runs at the width's own
 *  iteration cap; at depth 256 would read escaping points as interior. */
const PROBE = { width: 64, height: 36, maxiter: 256, wide: 1e-3 };

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

/** A found tile's picture: the gallery's tile size. */
const TILE = { width: 316, height: 178 };

/** The planes the viewport sampler serves (`SERVED`): the five parameter planes and the
 *  pinned Phoenix slice, which is the explorer's own Phoenix constants. Phoenix has no
 *  Julia twin, which is the only thing that sets it apart here. */
const PLANES = ["mandelbrot", "multibrot3", "multibrot4", "multibrot5", "multibrot6", "phoenix"];

/** The thirteen modes the pipeline accepts (`mode_policy.accepted()`). The config lists
 *  them in the viewer's Mode select order, which the host hands over as `modeOrder`, so
 *  the two lists cannot drift; this set only says which of those the walk may draw. */
const MINED_MODES = new Set([
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
]);

/** How many modes at the foot of that order start unticked *(walk_modes_order_ckpt131)*:
 *  the three direct traps and the two curvature modes, the gallery's least seated. */
const UNTICKED_TAIL = 5;

/** What a new tab's config opens at: the pipeline's draw, where the page can make it. A
 *  place is painted once in each ticked mode *(walk_view_ckpt132)*, which is eight at the
 *  default ticks, where hunt and mine's `PER_LOCATION` draws three; the pipeline keeps every
 *  one and lets the solve choose, and a tab that did would fill with pictures nobody would
 *  pick, so it keeps the best. The modes are set in `mount`, where their order is known. */
const DEFAULTS = {
  planes: new Set(PLANES),
  julia: true,
  widest: 1e-3,
  narrowest: 1e-4,
  rungs: 20,
  patience: 0.2,
  keep: 1,
  bar: 0.5,
  // Recipes rank on the number the tile shows *(saved_tab_ckpt131_addendum1)*: the fine
  // head is an opt-in, and nothing of it downloads until it is ticked.
  fine: false,
};

/** Where a composite's texture weight opens when this page derives none for its mode: the
 *  explorer's own hand-switch default, `TEXTURE_DEFAULT`. */
const TEXTURE_DEFAULT = 0.5;

/**
 * When stage two calls a peak *(walk_tune_ckpt131)*. It used to stop after two rungs under
 * the best, and at low scores that is two noisy readings. Descents stopped by 5e-5, three
 * decades short of the seats, and a silent root (a score near zero) counted as a peak at
 * rung two. So a peak counts only once the best rung has cleared the config's patience floor
 * (`P≥3`, 0.20 by default). Even then the score must stay under that best for this many
 * rungs running: two while the best is under `PATIENT_ABOVE`, three above it, because a
 * high best is worth a longer look before the descent gives it up. Under the floor the
 * descent goes on until the cap, the resolution floor or a dead end.
 */
const PATIENT_ABOVE = 0.5;
const patienceOf = (best) => (best < PATIENT_ABOVE ? 2 : 3);

/** How many times stage one backs up, and how many roots the screen may refuse, before the
 *  walk gives the plane up. Both are cheap: a back is one probe, a refusal one screen. */
const MOST_BACKS = 64;
const MOST_REFUSED_ROOTS = 16;

/** During a walk the viewer is framed wider than the cell it is weighing, so that the
 *  quarters and their labels sit inside the picture: the cell takes this share of the
 *  viewport's width, or of its height where the canvas is wider than 16:9. A quarter's
 *  jitter reaches an eighth of the cell past its edge, so the margin clears it. */
const CELL_SHARE = 0.65;

/** How long the viewer holds a rung's finished state — its last label drawn — before the
 *  next one replaces it *(walk_console_ckpt131)*. The walk keeps computing through it; only
 *  the repaint waits. */
const DWELL_MS = 400;

/**
 * The four quarters, in the order a card's chips read them, each with the color it is always
 * drawn in *(walk_view_ckpt132)*. The color is bound to the position, so "zooming into red"
 * means upper-left on every rung of every walk. `a` is the column and `b` the row, counting
 * up. The four are Okabe and Ito's vermillion, yellow and reddish purple with a brighter
 * blue. Their least separation, as CIE Lab distance under simulated protanopia,
 * deuteranopia and tritanopia (Machado 2009, full severity), is 34, against 21 for the
 * obvious red, sky, yellow and pink. They are stroked over a dark under-stroke, as every
 * box on the viewer is, so they read on light palettes too.
 */
const QUARTERS = [
  { a: 0, b: 1, where: "upper-left", name: "red", ink: "#d55e00" },
  { a: 1, b: 1, where: "upper-right", name: "blue", ink: "#3d8bff" },
  { a: 0, b: 0, where: "lower-left", name: "yellow", ink: "#f0e442" },
  { a: 1, b: 0, where: "lower-right", name: "pink", ink: "#cc79a7" },
];

// ------------------------------------------------------------------- small things

const pick = (items) => items[Math.floor(Math.random() * items.length)];
const shuffled = (items) => items.sort(() => Math.random() - 0.5);
const score = (value) => value.toFixed(2);
const width = (value) => value.toExponential(1);
const megabytes = (bytes) => (bytes / 1e6).toFixed(1);

/** A screen refusal, as a reader would say it: the gate's reason in a few words. A card
 *  calls every skipped quarter "empty" and keeps the reason for its tooltip. */
const REFUSALS = {
  interior_cap: "mostly inside the set",
  instant_escape: "almost everything escapes at once",
  flat: "too flat",
  occupancy_floor: "too empty",
};

/** Why a descent stopped, as the sentence on the last card it made. */
const ENDS = { peak: "past the peak", floor: "as deep as it can draw", cap: "rung cap", "dead end": "dead end" };

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
  const modeOrder = host.modeOrder.filter((mode) => MINED_MODES.has(mode));
  /** How many of the maps this page carries stand under each family, in wheel order.
   *  Counted off the baked index's own `families`, which the roster record froze: a page
   *  that read the colours itself would be deriving what the bake was written to fix. */
  const filed = new Map(
    HUES.map((hue) => [
      hue,
      [...palettes].filter(([, map]) => (map.families ?? []).includes(hue)).length,
    ]),
  );
  const config = {
    ...DEFAULTS,
    planes: new Set(DEFAULTS.planes),
    modes: new Set(modeOrder.slice(0, -UNTICKED_TAIL)),
    families: new Set(HUES),
  };
  let state = "idle"; // idle | loading | running | paused
  /** Whether the viewer follows the walk *(walk_detach_ckpt131)*. It is the other half of
   *  what `state` used to mean alone: opening a found picture, or moving the view, hands the
   *  viewer to the reader and leaves the walk running on its own renderer. Start, Back to the
   *  walk, and showing the tab again after hiding it a running walk hand it back. */
  let attached = true;
  let resume = null;
  let renderer = null;
  let screeners = null;
  let scorer = null; // a `Judges`, or `null` until loaded or where the runtime would not load
  let judgeless = false; // the runtime would not load here, so the walk goes without
  let fineless = false; // the fine head would not load here, so the gate ranks alone
  /** The download in flight, as `{ controller, what, got }`, or `null`. */
  let download = null;
  let loop = null;
  let phase = "root"; // root | deep | mine: which stage a timing is filed under
  const timings = { probe: [], screen: [], render: [], shade: [], gate: [], fine: [], walk: [] };
  const found = [];
  /** One row per walk, for whoever is measuring the tab: where it went and what it saw. */
  const walks = [];
  /** What the walk last put on the viewer: the frame it stands in and the cells over it, so
   *  a pause can put the frame back at its own framing and a resume can widen it again.
   *  `null` while a recipe is up, which is already framed as itself. */
  let shown = null;

  /** Whether the Walk tab is the one showing, or Saved, which leaves a walk alone. */
  let onTab = true;

  /** The status line beside Start: a download's progress, and the few things the walk has
   *  to say that are not a step of it — that it could not start, or had nothing to walk. */
  function progress(text) {
    host.progress.textContent = text;
  }

  /**
   * Pause while a download is under way is the same button as Pause while walking, and stops
   * the download.
   *
   * **The walk view owns the region under the picture** *(walk_view_ckpt132)*. While a walk
   * is running or paused and the viewer is the walk's, the viewer's controls are not on the
   * page at all and the walk view is in their place. They come back when the viewer does:
   * a pan, an opened picture, or hiding the tab. Back to the walk, or Start, puts the walk
   * view back.
   */
  function syncButton() {
    host.start.textContent = state === "running" || state === "loading" ? "Pause" : "Start";
    host.back.hidden = attached;
    const owns = attached && onTab && (state === "running" || state === "paused");
    const showing = !host.view.hidden;
    host.view.hidden = !owns;
    host.controls.hidden = owns;
    strip.running(state === "running");
    // The picture may give up some height to the two strips *(walk_strip_ckpt132)*, so the
    // canvas is sized again whenever the walk view comes or goes.
    host.walking(owns);
    if (showing !== owns) host.relayout();
  }

  // ----------------------------------------------------------------- the walk strip

  /**
   * The walk, one card per frame *(walk_strip_ckpt132)*: the top half of the walk view, a
   * filmstrip that runs right and keeps its newest card in sight. It replaced the one-line
   * rows of `walk_view_ckpt132`, and there is no text log anywhere now.
   *
   * A **frame card** is one frame the descent stood in. Over its thumbnail is that frame's
   * own `P≥3`, the number the peak rule tracks; the thumbnail is the picture the walk judged
   * of it, framed and boxed as the viewer shows it, with its four quarters in their inks and a
   * skipped one dashed and dim; under it the four quarters' `P≥3` as a 2×2 of chips, in
   * their positions and inks, filling in as they are judged, the chosen one outlined; and at
   * the foot one short sentence. The card being worked on is lit, and the leg's best so far
   * carries the BEST mark on the card itself.
   *
   * A **text card** is the root search, which becomes the root's frame card when the root
   * lands, or the plane giving out. A **divider** is the slim card a Julia twin's own cards
   * follow, in the same strip, because one place is one strip.
   *
   * A walk that ends without mining **lingers** for `LINGER_MS` before a new walk clears it,
   * so its last sentence can be read. The new walk searches for its root meanwhile, out of
   * sight as ever, and waits on `ready` before it touches the strip.
   */
  const strip = (() => {
    const LINGER_MS = 4000;
    const THUMB = { width: 288, height: 162 };
    let cards = [];
    let best = null;
    let lingerUntil = 0;
    let pending = null; // `{ plane, timer, done: Promise }` while a lingering strip waits to clear
    const canvases = new WeakMap();

    function span(className, text) {
      const one = document.createElement("span");
      one.className = className;
      one.textContent = text;
      return one;
    }

    function canvasOf(image) {
      let made = canvases.get(image);
      if (made === undefined) {
        made = document.createElement("canvas");
        made.width = image.width;
        made.height = image.height;
        made.getContext("2d").putImageData(image, 0, 0);
        canvases.set(image, made);
      }
      return made;
    }

    /** The card's picture as the viewer frames it: the frame at `CELL_SHARE` of the width,
     *  the pictures behind it dimmed, and its quarters boxed in their inks. */
    function thumbnail(card) {
      const ink = card.canvas.getContext("2d");
      const { frame } = card;
      const w = frame.w / CELL_SHARE;
      const h = (w * THUMB.height) / THUMB.width;
      const left = frame.x - w / 2;
      const top = frame.y + h / 2;
      const at = (box) => [
        ((box.x - box.w / 2 - left) / w) * THUMB.width,
        ((top - (box.y + box.h / 2)) / h) * THUMB.height,
        (box.w / w) * THUMB.width,
        (box.h / h) * THUMB.height,
      ];
      ink.globalAlpha = 1;
      ink.fillStyle = "#000";
      ink.fillRect(0, 0, THUMB.width, THUMB.height);
      ink.imageSmoothingQuality = "high";
      for (const layer of card.layers) {
        ink.globalAlpha = layer.dim ? 0.45 : 1;
        ink.drawImage(canvasOf(layer.image), ...at(layer.frame));
      }
      ink.globalAlpha = 1;
      ink.setLineDash([2, 3]);
      ink.strokeStyle = "rgba(255, 255, 255, 0.4)";
      ink.lineWidth = 1;
      ink.strokeRect(...at(frame));
      for (const [slot, quarter] of (card.quarters ?? []).entries()) {
        const skipped = quarter.p3 === null;
        const chosen = slot === card.chosen;
        ink.globalAlpha = skipped ? 0.5 : 1;
        ink.setLineDash(skipped ? [5, 3] : []);
        for (const [stroke, lineWidth] of [["rgba(0, 0, 0, 0.55)", chosen ? 5 : 3], [QUARTERS[slot].ink, chosen ? 3 : 1.5]]) {
          ink.strokeStyle = stroke;
          ink.lineWidth = lineWidth;
          ink.strokeRect(...at(quarter.frame));
        }
      }
      ink.globalAlpha = 1;
      ink.setLineDash([]);
    }

    /** One card's element, rebuilt around its canvas, which is kept. */
    function draw(card) {
      const el = card.el;
      el.className = `walk-card is-${card.kind}`;
      if (card === best) el.classList.add("is-best");
      if (card.peak) el.classList.add("is-peak", `is-${card.peak}`);
      if (card.kind !== "frame") {
        el.replaceChildren(span("walk-card-said", card.said));
        return;
      }
      el.title = `${card.plane} at width ${width(card.frame.w)}`;
      const head = document.createElement("div");
      head.className = "walk-card-head";
      head.append(span("walk-card-score", score(card.p3)));
      head.title = "This frame's own P≥3, the number the peak rule follows.";
      if (card === best) head.append(span("walk-best", "best"));
      const parts = [head, card.canvas];
      if (card.quarters !== null) {
        const grid = document.createElement("div");
        grid.className = "walk-card-quarters";
        card.quarters.forEach((quarter, slot) => {
          const { where, name, ink } = QUARTERS[slot];
          const text = quarter.p3 === undefined ? "…" : quarter.p3 === null ? "empty" : score(quarter.p3);
          const chip = span("walk-chip", text);
          chip.style.setProperty("--ink", ink);
          chip.title = `The ${where}, ${name}: ${quarter.p3 === null ? quarter.why : quarter.p3 === undefined ? "being weighed" : `P≥3 ${score(quarter.p3)}`}`;
          if (quarter.p3 === null) chip.classList.add("is-empty");
          if (slot === card.chosen) chip.classList.add("is-chosen");
          grid.append(chip);
        });
        parts.push(grid);
      }
      const said = span("walk-card-said", "");
      if (card.into !== null && card.said === "") {
        const name = span("walk-into-name", QUARTERS[card.into].name);
        name.style.setProperty("--ink", QUARTERS[card.into].ink);
        said.append("zoom into ", name);
      } else {
        said.textContent = card.said;
      }
      parts.push(said);
      el.replaceChildren(...parts);
      thumbnail(card);
    }

    /** Redraw `card`, light the last one, and keep the newest in sight unless the reader has
     *  scrolled back along the strip. */
    function show(...changed) {
      const list = host.strip;
      const pinned = list.scrollWidth - list.scrollLeft - list.clientWidth < 48;
      for (const card of changed) draw(card);
      for (const card of cards) card.el.classList.toggle("is-live", card === cards.at(-1));
      if (pinned) list.scrollLeft = list.scrollWidth;
    }

    function add(card) {
      card.el = document.createElement("li");
      cards.push(card);
      host.strip.append(card.el);
      show(card);
      return card;
    }

    function clear(plane) {
      cards = [];
      best = null;
      host.strip.replaceChildren();
      host.strip.scrollLeft = 0;
      add({ kind: "text", said: `${plane} · searching for a root` });
    }

    return {
      /** A new walk. The strip clears at once, or once a lingering one has been read. */
      begin(plane) {
        const wait = lingerUntil - performance.now();
        lingerUntil = 0;
        if (wait <= 0) {
          clear(plane);
          return;
        }
        let release;
        const done = new Promise((resolve) => {
          release = resolve;
        });
        pending = { done };
        setTimeout(() => {
          pending = null;
          clear(plane);
          release();
        }, wait);
      },
      /** Resolves once the strip is this walk's: after a lingering one has cleared. */
      ready: () => pending?.done ?? Promise.resolve(),
      /** The strip ends here without mining: the next walk leaves it up a while first. */
      linger() {
        lingerUntil = performance.now() + LINGER_MS;
      },
      /** The root search gave out: its card says so. */
      gaveOut(plane) {
        const card = cards.at(-1);
        card.said = `${plane} · no root got past the screen`;
        show(card);
      },
      /** The slim card a Julia twin's own cards follow. */
      divider(text) {
        add({ kind: "divider", said: text });
      },
      /**
       * A frame the walk stands in, with its own `P≥3`, the layers it is shown over and a
       * first sentence. The root search's text card becomes the root's frame card.
       */
      frame(plane, frame, p3, layers, said = "") {
        const card = {
          kind: "frame",
          plane,
          frame,
          p3,
          layers,
          said,
          quarters: null,
          chosen: null,
          into: null,
          peak: null,
          canvas: Object.assign(document.createElement("canvas"), THUMB),
        };
        const last = cards.at(-1);
        if (last?.kind === "text") {
          card.el = last.el;
          cards[cards.length - 1] = card;
          show(card);
          return card;
        }
        return add(card);
      },
      /** The card's four quarters are set out, at the frames they are judged at. */
      quarters(card, frames) {
        card.quarters = frames.map((frame) => ({ frame, p3: undefined, why: "" }));
        card.said = "";
        show(card);
      },
      /** A quarter's reading: its `P≥3`, or `null` and why, where the quarter was skipped. */
      chip(card, slot, p3, why = "") {
        Object.assign(card.quarters[slot], { p3, why });
        show(card);
      },
      /** The quarter the walk goes into; the sentence says so while nothing overrides it. */
      choose(card, slot) {
        card.chosen = slot;
        card.into = slot;
        show(card);
      },
      /** The card's sentence. */
      say(card, text) {
        card.said = text;
        show(card);
      },
      /** The leg's best so far, which a new leg's first card takes over. */
      best(card) {
        const was = best;
        best = card;
        show(...[was, card].filter((one) => one !== null && cards.includes(one)));
      },
      /** The descent's end: the best card is outlined, over or under the bar, and says so. */
      peak(card, over, text) {
        card.peak = over ? "over" : "under";
        card.said = text;
        show(card);
      },
      running(on) {
        host.strip.classList.toggle("is-running", on);
      },
    };
  })();

  // ----------------------------------------------------------------- the candidates

  /**
   * The lower strip of the walk view *(walk_view_ckpt132)*: a place's candidates, one per
   * ticked mode, each a small tile with its mode and the render judge's `P≥4`, filling in as
   * they are drawn. The ones kept are outlined. Ranked on the fine head, the tiles are in
   * its order, best first; otherwise they stay in the order they were drawn, which is the
   * Mode select's.
   *
   * They outlast the decision on purpose. A place's candidates stay up through the start of
   * the next walk and go at the end of its first descent, so they can still be compared
   * while the next root is being found.
   */
  const candidates = (() => {
    let tried = [];
    let expected = 0;
    let place = "";
    const SMALL = { width: 240, height: 135 };

    function thumbnail(image) {
      const full = document.createElement("canvas");
      full.width = image.width;
      full.height = image.height;
      full.getContext("2d").putImageData(image, 0, 0);
      const small = document.createElement("canvas");
      small.width = SMALL.width;
      small.height = SMALL.height;
      const ink = small.getContext("2d");
      ink.imageSmoothingQuality = "high";
      ink.drawImage(full, 0, 0, SMALL.width, SMALL.height);
      return small;
    }

    function render() {
      const order = config.fine ? [...tried].sort((x, y) => y.rank - x.rank) : tried;
      const kept = new Set([...tried].sort((x, y) => y.rank - x.rank).slice(0, config.keep));
      const tiles = order.map((one) => {
        const tile = document.createElement("figure");
        tile.className = "walk-candidate";
        if (kept.has(one)) tile.classList.add("is-kept");
        tile.title = `${one.mode} in ${shownName(one.palette)}`;
        const caption = document.createElement("figcaption");
        caption.append(span("walk-candidate-mode", one.mode), span("walk-candidate-score", `P≥4 ${score(one.p4)}`));
        tile.append(one.canvas, caption);
        return tile;
      });
      for (let index = tried.length; index < expected; index++) {
        const waiting = document.createElement("div");
        waiting.className = "walk-candidate is-waiting";
        tiles.push(waiting);
      }
      host.candidates.replaceChildren(...tiles);
      host.candidatesNote.hidden = tiles.length > 0;
      host.candidatesPlace.textContent = tiles.length > 0 ? place : "";
      return tiles[order.indexOf(tried.at(-1))];
    }

    /** Bring the newest tile into sight along the row, which is its tiles' offset parent. */
    function reach(tile) {
      if (tile === undefined) return;
      const list = host.candidates;
      const end = tile.offsetLeft + tile.offsetWidth;
      if (end > list.scrollLeft + list.clientWidth) list.scrollLeft = end - list.clientWidth;
      else if (tile.offsetLeft < list.scrollLeft) list.scrollLeft = tile.offsetLeft;
    }

    function span(className, text) {
      const one = document.createElement("span");
      one.className = className;
      one.textContent = text;
      return one;
    }

    return {
      clear() {
        tried = [];
        expected = 0;
        render();
      },
      /** A place is being mined: the last place's tiles go, and `count` wait for theirs.
       *  `where` names the place on the row's rule, which outlasts the strip above moving on. */
      begin(count, where) {
        tried = [];
        expected = count;
        place = where;
        host.candidates.scrollLeft = 0;
        render();
      },
      /** One candidate drawn, or `null` where its picture could not be. */
      add(one) {
        if (one === null) {
          expected -= 1;
        } else {
          const { image, ...kept } = one;
          tried.push({ ...kept, canvas: thumbnail(image) });
        }
        reach(render());
      },
      /** The fine head or the kept count changed: the order and the outlines follow. */
      refresh() {
        render();
      },
    };
  })();


  // ----------------------------------------------------------------- the downloads

  /** Start one download: a signal for it, and a progress line that says what and how much. */
  function downloading(what) {
    const controller = new AbortController();
    download = { controller, what, got: 0 };
    // `now` names the file where one download is several, runtime then gate.
    const shown = (got, of, now = what) => {
      if (download?.controller !== controller) return;
      download.got = got;
      download.what = now;
      progress(
        of > 0
          ? `Downloading ${now}… ${megabytes(got)} of ${megabytes(of)} MB`
          : `Downloading ${now}… ${megabytes(got)} MB`,
      );
    };
    return { signal: controller.signal, shown, done: () => {
      if (download?.controller === controller) download = null;
      progress("");
    } };
  }

  /**
   * Stop the download in flight, if there is one, and say so in one line. Whatever had
   * fully arrived is kept by `judges.js`, and the browser's cache holds the rest of what
   * it saw, so the next Start does not download it again.
   */
  function stopDownload(why) {
    if (download === null) return false;
    const { controller, what, got } = download;
    download = null;
    controller.abort();
    progress(
      `Stopped downloading ${what}${got > 0 ? ` (${megabytes(got)} MB in)` : ""}; what had fully arrived is kept for the next Start.`,
    );
    return true;
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
      "Also walk the Julia set whose c is the best place the descent found: from its home view, by the same rung rule.",
    );

    const modes = group("Modes", "A place that clears the bar is painted once in each of these.");
    for (const mode of modeOrder) {
      checkbox(modes, mode, config.modes.has(mode), (on) => {
        if (on) config.modes.add(mode);
        else config.modes.delete(mode);
      });
    }

    const maps = group(
      "Palettes",
      "A recipe's map is drawn from the checked families together. A family's maps are the " +
        "ones that have made that colour often; what a walk finds is not filtered by it.",
    );
    for (const hue of HUES) {
      const held = filed.get(hue) ?? 0;
      const input = checkbox(
        maps,
        hue,
        config.families.has(hue),
        (on) => {
          if (on) config.families.add(hue);
          else config.families.delete(hue);
        },
        `${held} of this page's ${palettes.size} maps give at least a twentieth of their ` +
          `mined pictures to ${hue}.`,
      );
      // The family's own swatch, between the box and its name, and the count after it: the
      // same dot and the same tally the gallery panel's hue chips wear, from `hues.js`.
      const label = input.parentElement;
      const dot = document.createElement("span");
      dot.className = "hue";
      const color = colorOf(hue);
      if (color !== null) dot.style.setProperty("--c", color);
      label.insertBefore(dot, input.nextSibling);
      const tally = document.createElement("span");
      tally.className = "count";
      tally.textContent = held;
      label.append(tally);
    }

    const depth = group(
      "Depth",
      "The root's width is drawn log-uniformly between the first two; the descent below it stops where the judge peaks, or at the cap.",
    );
    number(depth, "widest", config.widest, { min: 1e-6, max: 1, step: "any" }, (v) => {
      config.widest = v;
    });
    number(depth, "narrowest", config.narrowest, { min: 1e-9, max: 1, step: "any" }, (v) => {
      config.narrowest = v;
    });
    number(
      depth,
      "rungs below the root, at most",
      config.rungs,
      { min: 0, max: 40, step: 1 },
      (v) => {
        config.rungs = v;
      },
      "Each rung halves the width. Twenty take a root at 0.001 to about 1e-9.",
    );
    number(
      depth,
      "peak counts from P≥3",
      config.patience,
      { min: 0, max: 1, step: 0.01 },
      (v) => {
        config.patience = v;
      },
      "A descent can stop on a peak only once its best rung has scored this. Until then it keeps going down, to the cap or as deep as the arithmetic can draw. After that it stops once the score has stayed under the best for two rungs running, or three once the best is over 0.5.",
    );

    const mining = group("At a place");
    number(mining, "kept", config.keep, { min: 1, max: 13, step: 1 }, (v) => {
      config.keep = v;
      candidates.refresh();
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
    checkbox(
      mining,
      "rank with the gallery's fine head",
      config.fine,
      (on) => {
        config.fine = on;
        candidates.refresh();
      },
      "Choose which recipes to keep by the fine head the gallery's solve ranks on, rather than by the render judge's P≥4 the tiles show. It downloads (5.1 MB) the next time a place is mined, and a kept tile may then show a lower number than one passed over.",
    );
  }

  // ----------------------------------------------------------------- start and pause

  /** What Start has to have before the walk can run: the renderer, and the judges unless
   *  they could not load here. Throws an `AbortError` where the download was stopped. */
  async function begin() {
    if (renderer === null) {
      const cores = navigator.hardwareConcurrency || 8;
      renderer = await Renderer.over(host.module, Math.max(1, Math.min(4, Math.floor(cores / 3))));
      if (typeof renderer.shader.screen !== "function") {
        throw new Error("this page's renderer is older than the walk and has no screen");
      }
      screeners = new Screeners(host.module, 2);
    }
    // Paused while the renderer was starting: nothing is downloaded until Start again.
    if (scorer !== null || judgeless || state !== "loading") return;
    const named ={ runtime: "the judge runtime", gate: "the render judge" };
    const { signal, shown, done } = downloading(named.runtime);
    try {
      scorer = await judges.load((what, got, of) => shown(got, of, named[what]), signal);
      done();
    } catch (error) {
      done();
      if (judges.stopped(error, signal)) throw error;
      console.warn("the judges could not be loaded", error);
      judgeless = true;
      progress("No judge could load here, so the walk picks at random among what the screen passes.");
    }
  }

  async function toggle() {
    if (state === "running" || state === "loading") {
      pause("Paused.");
      return;
    }
    if (renderer === null || (scorer === null && !judgeless)) {
      state = "loading";
      syncButton();
      try {
        await begin();
      } catch (error) {
        // A stopped download has said so already, and `pause` has set the state.
        if (judges.stopped(error)) return;
        console.error("the walk could not start", error);
        state = "idle";
        syncButton();
        progress(`The walk could not start: ${error.message ?? error}.`);
        return;
      }
      // Paused while the last step finished: the walk waits for the next Start.
      if (state !== "loading") return;
    }
    // Start hands the viewer back to the walk as well: a reader who presses it wants to watch.
    const was = attached;
    attached = true;
    state = "running";
    syncButton();
    if (!was) clearOpen();
    // Widened again whether or not a step was parked: one still in flight at the pause
    // parks nothing, and only recorded what it would have shown.
    if (shown !== null) display(shown);
    if (resume !== null) {
      const go = resume;
      resume = null;
      go();
    }
    loop ??= forever().catch((error) => {
      console.error("the walk stopped", error);
      progress(`The walk stopped: ${error.message ?? error}.`);
      state = "idle";
      loop = null;
      syncButton();
    });
  }

  /** Pause, and give the viewer back its normal framing — unless whoever paused is about to
   *  put a view of their own up, which is `reframe: false`. */
  function pause(why, { reframe = true } = {}) {
    // **Leaving means stopping** *(explorer_slim_ckpt131)*. A download in flight is cut off
    // whether the walk was starting or already mining, and that is the line the console
    // gets. A walk that had not started yet goes back to waiting for Start.
    stopDownload(why);
    if (state === "loading") {
      state = loop === null ? "idle" : "paused";
      syncButton();
      return;
    }
    if (state !== "running") return;
    state = "paused";
    paintEra += 1;
    syncButton();
    // A detached viewer is showing the reader's picture, which a pause leaves alone.
    if (reframe && attached) unframe();
  }

  /** Hand the viewer to the reader and leave the walk running *(walk_detach_ckpt131)*:
   *  whatever it would have painted is only recorded, and queued repaints are dropped. */
  function detach() {
    // Before any walk has run there is nothing to go back to.
    if (!attached || loop === null) return;
    attached = false;
    paintEra += 1;
    syncButton();
  }

  /** Hand the viewer back: the walk's last frame, as the walk drew it, with no full-quality
   *  pass — whether the walk is running or paused. */
  function attach() {
    if (attached) return;
    attached = true;
    paintEra += 1;
    syncButton();
    clearOpen();
    if (shown !== null) paint(shown);
  }

  /** The found tile marked as open stops being so once the viewer is the walk's again. */
  function clearOpen() {
    for (const tile of host.found.querySelectorAll(".tile.is-open")) tile.classList.remove("is-open");
  }

  /** Every step of a walk passes through here: it returns at once while the walk runs, and
   *  otherwise waits for Start. */
  function going() {
    // A download holds the viewer still, and so the walk while it follows the viewer; a
    // detached walk moves nothing the download is drawing, and goes on.
    if (state === "running" && !(attached && host.busy())) return Promise.resolve();
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

  /** The view the viewer is shown for `frame`: the same centre, wide enough that the frame
   *  takes `CELL_SHARE` of it. Only the viewer is widened — every probe, screen and judged
   *  picture is of the frame itself. */
  function framedAround(frame) {
    const aspect = host.aspect();
    const w = Math.max(frame.w, frame.h / aspect) / CELL_SHARE;
    return { ...frame, w };
  }

  /** The cells, over a faint outline of the frame they subdivide. */
  function outlined(frame, cells) {
    return [{ x: frame.x, y: frame.y, w: frame.w, h: frame.h, state: "cell", label: "" }, ...cells];
  }

  // What the viewer shows while a walk runs is only what the walk computed
  // *(walk_console_ckpt131)*: the picture it judged of the frame it stands in, with the
  // picture before it dimmed around it, and the quarters boxed over both. The viewer's own
  // renderer never starts on it. Every repaint goes through one queue, so that a rung's
  // finished state can be held for `DWELL_MS` while the walk carries on computing the next.

  /** The tail of the repaint queue, and the pause count it was queued under: a pause drops
   *  whatever is still waiting, because the viewer is the reader's again. */
  let painting = Promise.resolve();
  let paintEra = 0;

  /** Queue one repaint, and hold the screen for `dwell` ms after it. */
  function onScreen(paint, dwell = 0) {
    const era = paintEra;
    painting = painting.then(async () => {
      if (era !== paintEra || state !== "running" || !attached) return;
      paint();
      if (dwell > 0) await sleep(dwell);
    });
  }

  /** Put what `next` describes on the viewer: `{ view, frame, layers, cells, widened }`, where
   *  `view` is of `frame` itself and `layers` are `{ frame, image, dim }`. A widened entry is
   *  framed so `frame` takes `CELL_SHARE` of the viewer and has its cells over it; a recipe
   *  is not widened and has none. While the walk is paused nothing is pushed — the viewer is
   *  the reader's — and a step still finishing only records what it would have shown. The
   *  same holds while the viewer is detached, so Back to the walk has its latest frame. */
  function display(next, dwell = 0) {
    shown = next;
    if (state !== "running" || !attached) return;
    onScreen(() => paint(next), dwell);
  }

  function paint(entry) {
    const layers = entry.layers.map((layer) => ({ ...layer.frame, image: layer.image, dim: layer.dim ?? false }));
    if (!entry.widened) {
      host.showWalk(entry.view, layers);
      return;
    }
    const wide = { ...entry.view, w: link.coordinateOf(framedAround(entry.frame).w) };
    host.showWalk(wide, layers, outlined(entry.frame, entry.cells));
  }

  /** New states and labels on the cells already up. */
  function relabel(cells, dwell = 0) {
    if (shown === null) return;
    shown.cells = cells;
    const { frame } = shown;
    if (state === "running" && attached) onScreen(() => host.showCells(outlined(frame, cells)), dwell);
  }

  /** Where a pause leaves the viewer: the view the walk stands in, at its own framing, drawn
   *  by the viewer's renderer at full quality. */
  function unframe() {
    if (shown !== null) host.follow(shown.view);
  }

  /** A step's time, filed under its own name and again under the stage it ran in. */
  function timed(bucket, started) {
    const took = performance.now() - started;
    timings[bucket].push(took);
    (timings[`${phase}.${bucket}`] ??= []).push(took);
  }

  /** The straddle probe: each quarter's share of the set's interior, by `[a][b]`. */
  async function straddles(family, cell, { maxiter, constants }) {
    const started = performance.now();
    const field = await renderer.field(viewAt(family, cell, { constants }), PROBE.width, PROBE.height, {
      maxiter,
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
      ink: child.ink,
    }));
  }

  /** Quarter `(a, b)` of a frame, unjittered: stage two's rung rule, which is the quad-tree's
   *  own split carried on below the root's frame rather than the plane's box. */
  function quarterOf(frame, a, b) {
    const w = frame.w / 2;
    const h = frame.h / 2;
    return { x: frame.x + (a - 0.5) * w, y: frame.y + (b - 0.5) * h, w, h };
  }

  /**
   * Weigh the quarters of `parent` that straddle the set's edge: screen them, then judge
   * each survivor's smooth picture. Returns them best first. This is stage two's rung, and
   * the one the viewer follows: the parent's own picture widened on the screen, `layers`
   * behind it, its quarters boxed inside. Each quarter carries the picture it was judged on,
   * which is the next rung's parent picture.
   *
   * `constants` is a Julia twin's `c`. Where `alone` is set and no quarter straddles, every
   * quarter is weighed instead, and only the screen can refuse one: the judge alone chooses.
   * That is how a dust Julia set is descended, since it has no interior to straddle at any
   * depth. The returned list records which rule it used, as `ranked.alone`.
   */
  async function weigh(family, parent, { rung, constants = null, layers, alone = false, card }) {
    await going();
    const shares = await straddles(family, parent, { maxiter: null, constants });
    if (shares === null) return [];
    // All four quarters are set out, every rung *(walk_view_ckpt132)*: one the walk skips is
    // drawn dim and dashed in its color and reads "empty" on its card, so the picture and the
    // strip agree on four.
    const children = QUARTERS.map((quarter, slot) => {
      const cell = quarterOf(parent, quarter.a, quarter.b);
      const share = shares[quarter.a][quarter.b];
      return { ...quarter, slot, cell, frame: jittered(cell), share, state: "weighing", label: "" };
    });
    strip.quarters(
      card,
      children.map((child) => child.frame),
    );
    const skip = (child, why) => {
      child.state = "skipped";
      child.label = "empty";
      strip.chip(card, child.slot, null, why);
    };
    const straddlers = children.filter((child) => child.share > 0 && child.share < 1);
    const judgedAlone = straddlers.length === 0 && alone;
    for (const child of children) {
      if (judgedAlone || straddlers.includes(child)) continue;
      skip(child, child.share >= 1 ? "all inside the set" : "no part of the set in it");
    }
    const weighed = children.filter((child) => child.state === "weighing");
    display(
      {
        view: viewAt(family, parent, { constants }),
        frame: parent,
        layers,
        cells: cellsOf(children),
        widened: true,
      },
      weighed.length === 0 ? DWELL_MS : 0,
    );
    if (weighed.length === 0) return Object.assign([], { alone: false });

    await going();
    const verdicts = await Promise.all(weighed.map((child) => screened(viewAt(family, child.frame, { constants }))));
    weighed.forEach((child, index) => {
      const verdict = verdicts[index];
      if (verdict.passed) return;
      child.refused = true;
      skip(child, `the screen: ${REFUSALS[verdict.fate] ?? verdict.fate}`);
    });
    const standing = weighed.filter((child) => !child.refused);
    relabel(cellsOf(children), standing.length === 0 ? DWELL_MS : 0);

    for (const child of standing) {
      await going();
      const drawn = await picture(viewAt(family, child.frame, { constants }), DESCENT_SUPERSAMPLE);
      if (drawn === null) {
        strip.chip(card, child.slot, null, "its picture could not be drawn");
        continue;
      }
      child.image = drawn.image;
      child.read = await gated(drawn.image);
      child.label = score(child.read.p3);
      strip.chip(card, child.slot, child.read.p3);
      if (child !== standing.at(-1)) relabel(cellsOf(children));
    }
    const ranked = standing
      .filter((child) => child.read !== undefined)
      .sort((x, y) => y.read.p3 - x.read.p3 || Math.random() - 0.5);
    walks.at(-1)?.rungs.push({
      family,
      rung,
      w: parent.w / 2,
      straddling: straddlers.length,
      alone: judgedAlone,
      refused: weighed.length - standing.length,
      p3: ranked.map((child) => Number(child.read.p3.toFixed(4))),
    });
    // The rung's finished state — its last label, and the chosen quarter where there is one —
    // is the one the viewer dwells on.
    if (ranked.length > 0) {
      ranked[0].state = "chosen";
      strip.choose(card, ranked[0].slot);
    }
    if (standing.length > 0) relabel(cellsOf(children), DWELL_MS);
    ranked.alone = judgedAlone;
    return ranked;
  }

  /** The quarters of quad-tree cell `cell` that straddle the set's edge, in random order:
   *  stage one's whole rung, one probe and no picture. */
  async function straddling(family, box, cell) {
    const maxiter = cell.w >= PROBE.wide ? PROBE.maxiter : null;
    const shares = await straddles(family, cell, { maxiter });
    if (shares === null) return [];
    const children = [];
    for (const a of [0, 1]) {
      for (const b of [0, 1]) {
        if (shares[a][b] > 0 && shares[a][b] < 1) children.push(cellOf(box, cell.r + 1, 2 * cell.i + a, 2 * cell.j + b));
      }
    }
    return shuffled(children);
  }

  /**
   * Stage one: a quick descent down one plane to a width drawn from the root band, out of the
   * viewer's sight. The sampler's quad-tree, one straddle probe a cell, a straddling quarter
   * taken at random, and a back-up where none straddles; nothing is judged, and only the
   * frame it stops at goes through the screen. A refused root is dropped for the next
   * straddling cell without a word. Returns the root — `{ family, frame }` — or `null`
   * where the plane gave out first.
   */
  async function descend(family) {
    const box = boxOf(family);
    const lo = Math.log(config.narrowest);
    const hi = Math.log(config.widest);
    const target = Math.exp(lo + Math.random() * (hi - lo));
    const first = Math.max(1, Math.ceil(Math.log2(box.w / config.widest)));
    const last = Math.max(first, Math.floor(Math.log2(box.w / config.narrowest)));
    const bottom = Math.min(last, Math.max(first, Math.round(Math.log2(box.w / target))));

    const row = { family, target, bottom, rungs: [], probes: 0, backs: 0, refused: 0, outcome: "descending" };
    walks.push(row);
    const stack = [{ cell: cellOf(box, 0, 0, 0), open: null }];
    while (stack.length > 0) {
      await going();
      const level = stack.at(-1);
      if (level.open === null) {
        level.open = await straddling(family, box, level.cell);
        row.probes += 1;
      }
      const next = level.open.shift();
      if (next === undefined) {
        stack.pop();
        if (++row.backs > MOST_BACKS) break;
        continue;
      }
      if (next.r < bottom) {
        stack.push({ cell: next, open: null });
        continue;
      }
      const frame = jittered(next);
      const verdict = await screened(viewAt(family, frame));
      if (verdict.passed) {
        row.outcome = "reached";
        return { family, frame };
      }
      if (++row.refused >= MOST_REFUSED_ROOTS) break;
    }
    row.outcome = "gave out";
    return null;
  }

  /**
   * Stage two: from a root, keep descending by the same rung rule — the root's frame split
   * into quarters, the straddling ones screened and judged, the best one gone into — until
   * the judge has peaked (`patienceOf`, once the best has cleared the patience floor), `f64`
   * stops resolving the mining grid, or the rung cap. Returns the best frame seen, which is
   * where the place is mined, with why the descent stopped and how many rungs it went down.
   *
   * This is the part the viewer follows, rung by rung, on the pictures it judges: `rootImage`
   * is the root's, and each rung's parent is shown over the one before it, dimmed.
   *
   * If a Julia twin's home frame has no straddling quarter, its `c` is outside the set and
   * its Julia set is dust. From then on it is descended on the judge alone (`weigh`'s
   * `alone`).
   */
  async function deepen(family, root, { read: rootRead, card: rootCard }, constants = null) {
    let best = { frame: root, read: rootRead, rung: 0, card: rootCard };
    strip.best(rootCard);
    let frame = root;
    let read = rootRead;
    let card = rootCard;
    let layers = rootCard.layers;
    let depth = 0;
    let behind = 0;
    let stop = "cap";
    let alone = false;
    /** The frame the walk stands in gets its card, and the best mark if it is the best. */
    const cardOf = () => {
      if (card.frame === frame) return;
      card = strip.frame(planeName(family), frame, read.p3, layers);
      if (best.frame === frame) {
        best.card = card;
        strip.best(card);
      }
    };
    for (let rung = 1; rung <= config.rungs; rung++) {
      const grid = { width: JUDGED.width * MINING_SUPERSAMPLE, height: JUDGED.height * MINING_SUPERSAMPLE };
      if (!renderer.resolves(frame.x, frame.y, frame.w / 2, grid.width, grid.height)) {
        stop = "floor";
        break;
      }
      cardOf();
      const parent = frame;
      const twinHome = constants !== null && rung === 1;
      const ranked = await weigh(family, parent, { rung, constants, layers, alone: alone || twinHome, card });
      if (ranked.length === 0) {
        stop = "dead end";
        break;
      }
      if (ranked.alone) alone = true;
      const top = ranked[0];
      layers = [{ ...layers.at(-1), dim: true }, { frame: top.frame, image: top.image }];
      frame = top.frame;
      read = top.read;
      depth = rung;
      if (top.read.p3 > best.read.p3) {
        best = { frame: top.frame, read: top.read, rung, card: null };
        behind = 0;
      } else {
        behind += 1;
      }
      if (best.read.p3 >= config.patience && behind >= patienceOf(best.read.p3)) {
        stop = "peak";
        break;
      }
    }
    // A descent that ran out of rungs or of arithmetic ends in a frame no card has shown yet,
    // and it may be the best: it gets a card of its own, with no quarters.
    if (stop === "cap" || stop === "floor") cardOf();
    strip.say(card, ENDS[stop]);
    const row = walks.at(-1);
    (row.deep ??= []).push({
      family,
      twin: constants !== null,
      root_w: root.w,
      root_p3: rootRead.p3,
      stop,
      rungs: row.rungs.filter((one) => one.family === family).length,
      best_rung: best.rung,
      best_w: best.frame.w,
      best_p3: best.read.p3,
      alone,
    });
    return { ...best, stop, depth, last: card };
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

  /**
   * The palettes a recipe may draw: the **union** of the checked families' maps.
   *
   * A map stands under a family when it gave at least a twentieth of its mined pictures
   * to it, which is a fact about what the map has made and not about its gradient — so a
   * walk narrowed to teal paints in maps that make teal often, and what it finds is not
   * held to being teal. Nothing here filters a result.
   *
   * **None checked draws from all of them**, rather than from nothing: a reader who
   * unticks the last box has said nothing about what they want. And an index that files
   * no map at all — an older module, or a bake on a checkout with no such table — draws
   * from everything, which is what this did before the families existed.
   */
  function roster() {
    const wanted = config.families.size > 0 ? config.families : new Set(HUES);
    const names = [...palettes]
      .filter(([, map]) => (map.families ?? []).some((hue) => wanted.has(hue)))
      .map(([name]) => name);
    return names.length > 0 ? names : [...palettes.keys()];
  }

  /** The Julia twin of a place: its centre as `c`, at the Julia family's home frame. */
  function twinOf(root) {
    const julia = juliaOf[root.family];
    const constants = { cx: link.coordinateOf(root.frame.x), cy: link.coordinateOf(root.frame.y) };
    const home = contract.home(julia);
    const frame = { x: home.x.value, y: home.y.value, w: home.w.value, h: (home.w.value * 9) / 16 };
    return { family: julia, frame, constants };
  }

  /** Judge a place's smooth picture: `{ read, image }`, the picture being what the viewer
   *  shows of the place. */
  async function judgePlace(place) {
    await going();
    const view = viewAt(place.family, place.frame, { constants: place.constants });
    const drawn = await picture(view, DESCENT_SUPERSAMPLE);
    if (drawn === null) return null;
    return { read: await gated(drawn.image), image: drawn.image };
  }

  /** Try recipes at a place that cleared the bar, and keep the best as tiles. `where` is
   *  the place as the candidates' rule names it. */
  async function mine(place, where) {
    // One recipe a ticked mode *(walk_view_ckpt132)*, in the Mode select's order, each with
    // its own palette and phase: eight at the default ticks, so a place is seen once in each
    // way the walk may paint it, where three draws over modes × palettes saw three.
    const modes = modeOrder.filter((mode) => config.modes.has(mode));
    if (modes.length === 0) {
      progress("No modes are ticked, so a place has nothing to be painted in.");
      return;
    }
    candidates.begin(modes.length, where);
    // A pause mid-download stops it, and the walk asks again when it is started again.
    while (config.fine && scorer !== null && scorer.fineSession === null && !fineless) {
      const { signal, shown, done } = downloading("the fine judge");
      try {
        await scorer.loadFine((what, got, of) => shown(got, of), signal);
        done();
      } catch (error) {
        done();
        if (judges.stopped(error, signal)) {
          await going();
          continue;
        }
        console.warn("the fine judge could not be loaded", error);
        progress("The fine judge could not load, so the render judge ranks recipes alone.");
        fineless = true;
        break;
      }
    }
    const maps = roster();
    const tried = [];
    for (const mode of modes) {
      await going();
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
      const drawn = await picture(view, MINING_SUPERSAMPLE);
      if (drawn === null) {
        candidates.add(null);
        continue;
      }
      // The recipe as the walk drew it, at its own framing, held long enough to be seen.
      display(
        { view: drawn.view, frame: place.frame, layers: [{ frame: place.frame, image: drawn.image }], cells: [], widened: false },
        DWELL_MS,
      );
      const read = await gated(drawn.image);
      let fine = null;
      if (config.fine && scorer?.fineSession) {
        const started = performance.now();
        fine = await scorer.fine(drawn.image);
        timed("fine", started);
      }
      const rank = fine ?? read.p4;
      candidates.add({ mode, palette, p4: read.p4, fine, rank, image: drawn.image });
      tried.push({ view: drawn.view, image: drawn.image, read, fine, rank });
      (walks.at(-1).recipes ??= []).push({ family: place.family, w: place.frame.w, mode, palette, p4: read.p4, fine });
    }
    tried.sort((x, y) => y.rank - x.rank);
    const kept = tried.slice(0, config.keep);
    for (const one of kept) await keep(one);
  }

  /**
   * The number a kept picture is shown with: the render judge's `P≥4`, the number the
   * descent already speaks in.
   *
   * **Shown and ranked on** *(saved_tab_ckpt131_addendum1)*. By default the recipes at a
   * place are ranked on this same number, so the best badge is the one kept. The fine head,
   * the pipeline's own ranking key, is the config's opt-in; with it ticked a kept picture
   * can show a lower number than one the walk passed over, because one member's reading
   * lives far below 0.01 and is not a number to put on a badge.
   */
  function rankText(one) {
    return `P≥4 ${score(one.read.p4)}`;
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
    badge.title = "How likely a person is to rate this 4 or 5.";
    tile.append(image, badge);
    tile.addEventListener("click", () => {
      // A download holds the viewer, and opening refuses; the viewer stays the walk's.
      if (host.busy()) {
        host.open(query, "this found picture");
        return;
      }
      detach("A found picture is open. The walk carries on; Back to the walk returns to it.");
      for (const other of host.found.querySelectorAll(".tile")) other.classList.toggle("is-open", other === tile);
      host.open(query, "this found picture");
    });
    // The save mark beside it, and the head's Save all found once there is anything to
    // save *(saved_tab_ckpt131)*. Found pictures last until the page closes; saved ones stay.
    const cell = document.createElement("div");
    cell.className = "tile-cell";
    cell.append(tile, host.mark(query));
    host.saveAll.hidden = false;
    host.found.prepend(cell);
    host.note.textContent = `${found.length} found. They last until the page is closed.`;
  }

  // ----------------------------------------------------------------- the loop

  async function forever() {
    for (;;) {
      await going();
      const planes = [...config.planes];
      if (planes.length === 0) {
        progress("No planes are ticked. Tick one in Walk config and press Start.");
        pause("Paused.");
        continue;
      }
      const started = performance.now();
      const family = pick(planes);
      phase = "root";
      strip.begin(planeName(family));
      const root = await descend(family);
      // The search is out of sight, so it runs while a lingering strip is still being read.
      await strip.ready();
      if (root === null) {
        strip.gaveOut(planeName(family));
        strip.linger();
        continue;
      }
      const row = walks.at(-1);
      row.root_ms = Math.round(performance.now() - started);
      // The twin is walked after the parent, and takes its `c` at the parent's best frame
      // *(walk_tune_ckpt131)*. A root-band `c` sits outside the set nearly every time, so a
      // twin taken there is dust and every one dead-ended at its first rung.
      const legs = [{ ...root, constants: null }];
      const twin = config.julia && juliaOf[family] !== undefined;
      /** Whether the strip ends on a place that was mined; one that does not lingers. */
      let mined = false;
      for (let index = 0; index < legs.length; index++) {
        const one = legs[index];
        const leg = performance.now();
        const last = !(index === 0 && twin);
        phase = "root";
        mined = false;
        // One place is one strip: the twin's cards follow its parent's, after a divider.
        if (index > 0) strip.divider("Julia twin");
        await going();
        const judged = await judgePlace(one);
        if (judged === null) continue;
        const layers = [{ frame: one.frame, image: judged.image }];
        judged.card = strip.frame(planeName(one.family), one.frame, judged.read.p3, layers, index === 0 ? "root" : "home view");
        display({
          view: viewAt(one.family, one.frame, { constants: one.constants }),
          frame: one.frame,
          layers,
          cells: [],
          widened: true,
        });
        phase = "deep";
        const best = await deepen(one.family, one.frame, judged, one.constants);
        const over = best.read.p3 >= config.bar;
        // The peak card is outlined and says the verdict; where it is also the last card,
        // the verdict follows why the descent stopped.
        const peak = best.card ?? best.last;
        const verdict = `peak ${score(best.read.p3)} · ${over ? "over the bar" : "under the bar"}`;
        strip.peak(peak, over, peak === best.last ? `${ENDS[best.stop]} · ${verdict}` : verdict);
        if (best.stop === "dead end" && !over && last && peak !== best.last) strip.say(best.last, "dead end · restart");
        // The last place's candidates stay up until this walk's first descent is over.
        if (index === 0) candidates.clear();
        const place = { family: one.family, frame: best.frame, constants: one.constants };
        if (index === 0 && twin) legs.push(twinOf(place));
        const read = best.read;
        (row.places ??= []).push({
          family: one.family,
          twin: index > 0,
          root_w: one.frame.w,
          w: best.frame.w,
          rung: best.rung,
          stop: best.stop,
          alone: row.deep?.at(-1)?.alone ?? false,
          p3: read.p3,
          mined: read.p3 >= config.bar,
          deep_ms: Math.round(performance.now() - leg),
        });
        if (!over) continue;
        phase = "mine";
        const mining = performance.now();
        const where = `${index === 0 ? planeName(family) : `Julia twin of ${planeName(family)}`} at ${width(best.frame.w)}`;
        await mine(place, where);
        mined = true;
        row.places.at(-1).mine_ms = Math.round(performance.now() - mining);
      }
      if (!mined) strip.linger();
      phase = "root";
      timed("walk", started);
      row.ms = Math.round(performance.now() - started);
    }
  }

  // ----------------------------------------------------------------- the handle

  buildConfig();
  syncButton();
  host.start.addEventListener("click", toggle);
  window.__walk = { timings, found, config, walks };

  /** Whether a hidden tab left a walk to take up again when it is shown. */
  let hiddenGoing = false;

  host.back.addEventListener("click", attach);
  host.saveAll.addEventListener("click", () => {
    const tally = host.keepAll(found.map(({ query }) => query));
    const said = tally.added === 0
      ? "Every found picture is already saved."
      : `Saved ${tally.added} found ${tally.added === 1 ? "picture" : "pictures"}.`;
    host.note.textContent = tally.full > 0 ? `${said} Saved is full, so ${tally.full} were left out.` : said;
  });

  return {
    running: () => state === "running",
    attached: () => attached,
    pause,
    detach,
    /** The tab was hidden: the walk pauses, and any download stops, as ever. */
    hide(why) {
      hiddenGoing = hiddenGoing || state === "running" || state === "loading";
      pause(why);
      // The controls come back with the reader's panel: a paused walk still owns the region
      // under the picture only while its own tab is up.
      onTab = false;
      syncButton();
    },
    /** The tab is shown again: a walk that was going when it was hidden goes on, and the
     *  viewer is the walk's again. Nothing else starts one. */
    reveal() {
      onTab = true;
      syncButton();
      if (!hiddenGoing) return;
      hiddenGoing = false;
      if (state === "paused" || state === "idle") toggle();
    },
  };
}
