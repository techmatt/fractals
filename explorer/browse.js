// Browse: the gallery across the whole window, for a visitor who came to look at the
// pictures *(explorer_browse_ckpt153)*.
//
// **The narrow panel stays as it is, and this is where the room is.** The Gallery tab is a
// third of a window beside a viewer, and it is kept uncluttered on purpose (Matt): a
// dropdown, two chip rows and a grid. Browse is the same shelf with the viewer put away —
// the tracked tiles at their own size in as many columns as the window holds, the same
// Collection dropdown, the same two chip rows under the same rules, and three rows the
// narrow panel does not carry: which fractal family drew a picture, whether its location
// is centred on a minibrot, and whether it is a spiral. Nothing else — no pinned, no colour
// cell — because every row is one more thing to read before the pictures.
//
// **A tile opens a preview, and the preview is drawn, not fetched.** The tile goes up at
// once, scaled to the preview's box, so there is never an empty frame; then the explorer's
// own renderer draws the seat's link in the viewer's three stages — a quarter-resolution
// field, one sample a pixel, then `FINAL_SUPERSAMPLE` each way — each replacing the last,
// with the Render bar's small cousin under it. The box fits the window and stops at
// `PREVIEW_MAX` pixels wide, which bounds what a stage costs on a large screen.
//
// **Every step and every close cancels the picture in flight**, through the pool's own
// `cancel` and the colouring worker's `stop`, and a generation counter drops whatever a
// cancelled stage still hands back. The pool is Browse's own, made on the way in and given
// back on the way out, so the viewer's pool is never cancelled from here and nothing here
// outlives the layer: the main viewer is untouched until **Open in explorer**, which hands
// the row to the page exactly as a tile in the narrow panel does.
//
// **Browse is a way of looking, not a picture.** It writes no address and no link, and no
// key of the permalink contract names it. It does say what it shows (`onScreen`), because
// the page's Copy link copies what is on screen: a preview's seat, or the collection.

import * as gallery from "./gallery.js";
import { PREVIEW_DIVISOR, shadeApart } from "./render.js";
import { sizeFor } from "./screensaver.js";

/** The widest a preview is drawn, in pixels. */
export const PREVIEW_MAX = 1600;

/** How many tiles the first task builds, and how many each task after it adds. A window
 *  of 316-pixel tiles shows about thirty; the rest are built a task at a time, as the
 *  panel builds its own — see `fill` in `gallery.js`. */
const FIRST_TILES = 60;
const MORE_TILES = 120;

/** How far past the visible tiles a picture is asked for, as a share of the window. */
const AHEAD = "50%";

/** The family a link that names none is drawing, which is the contract's first. */
const HOME_FAMILY = "mandelbrot";

/** The degree words the family row reads a numbered family with. */
const DEGREES = { 3: "Cubic", 4: "Quartic", 5: "Quintic", 6: "Sextic" };

/**
 * What a reader calls each family: `Mandelbrot`, `Cubic Multibrot`, `Quartic Julia`,
 * `Phoenix`. A rule over the contract's one shape for a family name — a word, and a degree
 * where the family is one of a numbered series — so a family the contract gains is named
 * without an edit here, and one it cannot read is shown as its own name.
 */
export function familyName(family) {
  if (family === "phoenix") return "Phoenix";
  if (family === "phoenix_plane") return "Phoenix plane";
  const parts = /^([a-z]+)(\d*)$/.exec(family);
  if (parts === null) return family;
  const word = parts[1][0].toUpperCase() + parts[1].slice(1);
  if (parts[2] === "") return word;
  const degree = DEGREES[parts[2]];
  return degree === undefined ? `${word} ${parts[2]}` : `${degree} ${word}`;
}

/** The family a seat's link draws — its `f`, or the contract's first where it names none. */
export function familyOf(seat) {
  return new URLSearchParams(seat.link).get("f") ?? HOME_FAMILY;
}

/** A yes-or-no row's two words. */
const yesNo = (value) => (value ? "Yes" : "No");

/**
 * Where the preview bar stands at the start of each stage, and how much of it the stage
 * is: by the samples each computes, as the Render bar's `STAGE_SPAN` is.
 */
export function stageSpans(finalSupersample) {
  const samples = [1 / PREVIEW_DIVISOR ** 2, 1, finalSupersample ** 2];
  const whole = samples.reduce((sum, share) => sum + share, 0);
  let at = 0;
  return samples.map((share) => {
    const from = at;
    at += share / whole;
    return { from, width: share / whole };
  });
}

/**
 * The preview's box in CSS pixels and the grid it is drawn at in device pixels.
 *
 * The box is the seat's own aspect, as large as the room allows and no wider than
 * `PREVIEW_MAX`. The grid is the box at the screen's pixel ratio, held to `PREVIEW_MAX`
 * across as well, so a high-density screen costs what a plain one does; and it is in
 * multiples of `PREVIEW_DIVISOR`, as the viewer's is, so the quarter stage is a whole grid.
 */
export function previewSize(aspect, room, ratio = 1) {
  const box = sizeFor(aspect, Math.min(PREVIEW_MAX, room.width), room.height);
  const scale = Math.min(ratio, PREVIEW_MAX / box.width);
  const step = (value) => Math.max(PREVIEW_DIVISOR, Math.round(value / PREVIEW_DIVISOR) * PREVIEW_DIVISOR);
  return { box, grid: { width: step(box.width * scale), height: step(box.height * scale) } };
}

/**
 * Wire Browse to its layer.
 *
 * `host` is what it borrows from the page: the layer's elements; `pool()` for a renderer of
 * its own over the compiled module; `parse` for a seat's link; `derive` for the view a link
 * draws with its derived parameters taken, which is the Download row's; `finalSupersample`,
 * the viewer's; `base` for the tiles' URLs; and `onOpen(row)` and `onLeave()`, the page's
 * side of leaving with a picture and without one.
 */
export function install(host) {
  const { layer, collection, rows, tiles, note, exitButton } = host;
  const { preview, stage, under, canvas, state, openButton, saveButton } = host;
  const { pool, parse, derive, finalSupersample, base, onOpen, onLeave } = host;
  const { saveMark, saving } = host;
  const spans = stageSpans(finalSupersample);

  let active = false;
  let collections = [];
  let chosen = gallery.GENERAL;
  let asked = 0;
  let members = [];
  let showing = [];
  let cutOn = null;
  let observer = null;
  let filling = 0;
  /** Which seat of `showing` the preview is up on, or `-1` with none up. */
  let at = -1;
  /** The pool, as a promise, from the way in to the way out. */
  let renderer = null;
  /** The colouring worker of the stage in flight, whose `stop` ends it. */
  let holder = {};
  /** Which preview render is current: every step and every close moves it. */
  let generation = 0;
  /** Whether a preview render is still drawing, which is what a cancel has to stop. */
  let drawing = false;

  const wanted = { mode: new Set(), hue: new Set(), family: new Set(), centered: new Set(), spiral: new Set() };

  /** What a harness reads: renders begun and cancelled, and where the last one settled. */
  const witness = { started: 0, cancelled: 0, settled: null, stage: null, pool: 0 };
  globalThis.__browse = witness;

  function matches(seat) {
    if (wanted.mode.size > 0 && !wanted.mode.has(seat.mode)) return false;
    if (wanted.family.size > 0 && !wanted.family.has(familyOf(seat))) return false;
    if (wanted.centered.size > 0 && !wanted.centered.has(seat.centered)) return false;
    if (wanted.spiral.size > 0 && !wanted.spiral.has(seat.spiral)) return false;
    if (wanted.hue.size === 0) return true;
    if (cutOn === null) return wanted.hue.has(seat.hue ?? null);
    return (seat.hues ?? []).some((name) => wanted.hue.has(name));
  }

  /** What the line beside the dropdown says: nothing unless a chip narrows the grid. */
  function say() {
    const filtering = Object.values(wanted).some((set) => set.size > 0);
    note.textContent = filtering ? `${showing.length} of ${members.length}` : "";
  }

  function watch() {
    observer?.disconnect();
    observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const picture = entry.target.querySelector("img");
          if (picture && !picture.src) picture.src = picture.dataset.src;
          observer.unobserve(entry.target);
        }
      },
      { root: tiles, rootMargin: `${AHEAD} 0px` },
    );
    for (const tile of tiles.querySelectorAll(".tile")) observer.observe(tile);
  }

  function tileOf(seat, index) {
    const tile = document.createElement("button");
    tile.type = "button";
    tile.className = "tile";
    tile.dataset.key = seat.key;
    const picture = document.createElement("img");
    picture.decoding = "async";
    picture.width = seat.width;
    picture.height = seat.height;
    picture.dataset.src = gallery.tileURL(seat, base);
    picture.alt = seat.alt ?? "";
    picture.addEventListener("load", () => tile.classList.add("is-ready"), { once: true });
    tile.append(picture);
    tile.addEventListener("click", () => show(index));
    // The narrow panel's own mark in the narrow panel's own cell *(browse_chrome_ckpt153
    // addendum)*: the same canonical key in `data-key`, so the page's one `remark` dresses
    // both grids and Saved whichever of them, or another tab, changed the list.
    const cell = document.createElement("div");
    cell.className = "tile-cell";
    cell.append(tile, saveMark(seat));
    return cell;
  }

  /** The preview's Save button, worn for the seat it is on, as a mark would wear it. */
  function dressSave() {
    const seat = at >= 0 ? showing[at] : null;
    const on = seat !== null && saving.has(seat);
    saveButton.setAttribute("aria-pressed", String(on));
    saveButton.textContent = on ? "Saved" : "Save";
    saveButton.title = on ? "Press to remove it from Saved." : "Keep this picture on the Saved tab.";
  }

  /** Show what the chips leave, a window's worth at once and the rest a task at a time. */
  function fill() {
    showing = members.filter(matches);
    const mine = ++filling;
    tiles.replaceChildren(...showing.slice(0, FIRST_TILES).map((seat, i) => tileOf(seat, i)));
    tiles.scrollTop = 0;
    watch();
    say();
    let from = FIRST_TILES;
    const more = () => {
      if (mine !== filling) return;
      const next = showing.slice(from, from + MORE_TILES).map((seat, i) => tileOf(seat, from + i));
      from += MORE_TILES;
      tiles.append(...next);
      for (const tile of next) observer?.observe(tile);
      if (from < showing.length) setTimeout(more, 0);
    };
    if (from < showing.length) setTimeout(more, 0);
  }

  /**
   * Show one collection, with these chips pressed where it has them. The mode and colour
   * rows are the panel's own and ask the panel's questions; the three below are Browse's.
   * Choosing a collection lets go of every chip, for the panel's reason.
   */
  async function choose(name, preset = null) {
    chosen = collections.some((one) => one.name === name) ? name : gallery.GENERAL;
    collection.value = chosen;
    const mine = ++asked;
    const one = collections.find((each) => each.name === chosen);
    let seats;
    try {
      seats = await gallery.seatsOnce(base, one);
    } catch (error) {
      if (mine !== asked) return;
      console.warn(`the ${chosen} collection could not be read`, error);
      tiles.replaceChildren();
      note.textContent = "This collection could not be loaded.";
      return;
    }
    if (mine !== asked) return;
    for (const set of Object.values(wanted)) set.clear();
    cutOn = one?.axis === gallery.FAMILY_AXIS ? chosen : null;
    members = gallery.membersOf(seats, chosen);
    const counts = {
      mode: gallery.tally(members, "mode", host.firstMode),
      hue: cutOn === null ? gallery.tally(members, "hue") : gallery.presence(members, cutOn),
      family: gallery.tally(members, familyOf),
      centered: gallery.tally(members, "centered", true),
      spiral: gallery.tally(members, "spiral", true),
    };
    if (preset !== null) {
      const has = (field, value) => counts[field].some(([held]) => held === value);
      for (const value of preset.modes ?? []) if (has("mode", value)) wanted.mode.add(value);
      if (preset.hue && has("hue", preset.hue)) wanted.hue.add(preset.hue);
    }
    const row = (field, options) => gallery.chipRow(rows[field], counts[field], wanted[field], fill, { field, ...options });
    row("mode", { label: "no render mode" });
    rows.hueHead.textContent = cutOn === null ? gallery.HUE_HEADS.dominant : gallery.HUE_HEADS.contains;
    row("hue", { swatches: true });
    row("family", { name: familyName });
    row("centered", { name: yesNo });
    row("spiral", { name: yesNo });
    fill();
  }

  // ----------------------------------------------------------------- the preview

  function showProgress(done) {
    state.style.setProperty("--done", String(Math.max(0, Math.min(1, done))));
  }

  function showState(name) {
    if (name === "rendering" && state.dataset.state !== "rendering") showProgress(0);
    if (name === "final" || name === "stopped") showProgress(1);
    state.dataset.state = name;
  }

  /** Stop the picture in flight, wherever it is: the pool's bands, the colouring worker,
   *  and whatever a stage still hands back after this. */
  function cancel() {
    generation += 1;
    if (drawing) witness.cancelled += 1;
    drawing = false;
    const running = renderer;
    running?.then((pooled) => pooled?.cancel(), () => {});
    holder.stop?.();
    holder = {};
  }

  /** The room the preview may take: the layer less the bar under the picture. */
  function room() {
    const bar = preview.querySelector(".browse-bar");
    const style = getComputedStyle(preview);
    const padX = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
    const padY = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
    return {
      width: Math.max(16, preview.clientWidth - padX),
      height: Math.max(16, preview.clientHeight - padY - bar.offsetHeight - 8),
    };
  }

  /** Put the picture's box on the stage, at the seat's aspect. */
  function place(box) {
    for (const element of [stage, under, canvas]) {
      element.style.width = `${box.width}px`;
      element.style.height = `${box.height}px`;
    }
  }

  /** Put a stage's picture up, at the preview's grid whatever size it was drawn. */
  function paint(image, grid) {
    const small = document.createElement("canvas");
    small.width = image.width;
    small.height = image.height;
    small.getContext("2d").putImageData(image, 0, 0);
    canvas.width = grid.width;
    canvas.height = grid.height;
    const screen = canvas.getContext("2d", { alpha: false });
    screen.imageSmoothingEnabled = true;
    screen.drawImage(small, 0, 0, grid.width, grid.height);
    canvas.hidden = false;
  }

  /** Colour a field in a worker of its own, which a step or a close stops. */
  async function coloured(pooled, field, view, mine) {
    if (field.shape.direct) return pooled.shade(field, view).image;
    holder = {};
    const shaded = await shadeApart(pooled.module, field, view, holder);
    return shaded === null || mine !== generation ? null : shaded.image;
  }

  /** Draw the seat at `at` in three stages, each replacing the last. */
  async function render(seat) {
    const mine = ++generation;
    drawing = true;
    witness.started += 1;
    witness.settled = null;
    witness.stage = null;
    showState("rendering");
    let view;
    try {
      view = parse(seat.link);
    } catch (error) {
      console.warn(`${seat.key}: its link does not parse`, error);
      showState("stopped");
      drawing = false;
      return;
    }
    const { box, grid } = previewSize(view.aspect, room(), window.devicePixelRatio || 1);
    place(box);
    try {
      const pooled = await renderer;
      if (mine !== generation) return;
      const drawn = await derive(pooled, view, grid.width, grid.height);
      if (drawn === null || mine !== generation) return;
      const quarter = { width: grid.width / PREVIEW_DIVISOR, height: grid.height / PREVIEW_DIVISOR };
      const steps = [
        { size: quarter, supersample: 1, apart: false },
        { size: grid, supersample: 1, apart: true },
        { size: grid, supersample: finalSupersample, apart: true },
      ];
      for (const [index, step] of steps.entries()) {
        const { from, width } = spans[index];
        showProgress(from);
        if (index === 2) showState("sharpening");
        const field = await pooled.field(drawn, step.size.width, step.size.height, {
          supersample: step.supersample,
          onProgress: (done) => {
            if (mine === generation) showProgress(from + width * done);
          },
        });
        if (field === null || mine !== generation) return;
        const image = step.apart ? await coloured(pooled, field, drawn, mine) : pooled.shade(field, drawn).image;
        if (image === null || mine !== generation) return;
        paint(image, grid);
        witness.stage = index;
      }
      showState("final");
      witness.settled = seat.key;
    } catch (error) {
      if (mine !== generation) return;
      // A refused recipe leaves the last stage that landed up, and the tile under it.
      console.warn(`${seat.key}: the preview could not be drawn`, error);
      showState("stopped");
    } finally {
      if (mine === generation) drawing = false;
    }
  }

  /** Open the preview on the seat at `index` of what the chips leave. */
  function show(index) {
    if (index < 0 || index >= showing.length) return;
    cancel();
    at = index;
    const seat = showing[index];
    // The tile, at once and scaled to the box: the picture is never an empty frame.
    under.src = gallery.tileURL(seat, base);
    under.alt = seat.alt ?? "";
    canvas.hidden = true;
    preview.hidden = false;
    preview.dataset.key = seat.key;
    dressSave();
    openButton.focus({ preventScroll: true });
    render(seat);
  }

  /** Back to the grid, on the tile the preview was showing. */
  function closePreview() {
    if (at < 0) return;
    cancel();
    preview.hidden = true;
    const key = showing[at]?.key;
    at = -1;
    tiles.querySelector(`.tile[data-key="${key}"]`)?.focus({ preventScroll: false });
  }

  function step(by) {
    if (at < 0) return;
    const next = Math.max(0, Math.min(showing.length - 1, at + by));
    if (next !== at) show(next);
  }

  // ----------------------------------------------------------------- in and out

  function onKey(event) {
    if (!active) return;
    // Nothing reaches the page underneath: an arrow key would pan a viewer nobody sees.
    event.stopImmediatePropagation();
    if (event.key === "Escape") {
      event.preventDefault();
      if (at >= 0) closePreview();
      else exit();
    } else if (at >= 0 && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
      event.preventDefault();
      step(event.key === "ArrowLeft" ? -1 : 1);
    }
  }

  /** Come in on what the narrow panel is showing: its collection and its two chip rows. */
  async function enter({ collections: listed, collection: name, modes = [], hue = null }) {
    if (active) return false;
    active = true;
    collections = listed;
    witness.pool += 1;
    renderer = pool();
    // A pool that cannot start is said when a preview asks for it, not here: the grid is
    // tiles, and needs no renderer to be looked at.
    renderer.catch((error) => console.warn("Browse could not start its renderer", error));
    gallery.collectionOptions(collection, collections);
    preview.hidden = true;
    at = -1;
    layer.hidden = false;
    await choose(name, { modes, hue });
    if (active) collection.focus({ preventScroll: true });
    return true;
  }

  /** Give everything back: the picture in flight, the pool, the layer. */
  function close() {
    cancel();
    at = -1;
    preview.hidden = true;
    observer?.disconnect();
    observer = null;
    filling += 1;
    asked += 1;
    tiles.replaceChildren();
    const running = renderer;
    renderer = null;
    running?.then((pooled) => pooled.stop(), () => {});
    layer.hidden = true;
    active = false;
  }

  function exit() {
    if (!active) return;
    close();
    onLeave();
  }

  function open() {
    if (!active || at < 0) return;
    const seat = showing[at];
    close();
    onOpen(seat);
  }

  window.addEventListener("keydown", onKey, true);
  collection.addEventListener("change", () => choose(collection.value));
  exitButton.addEventListener("click", exit);
  openButton.addEventListener("click", open);
  // The seat's own link, never the preview's size or stage: `toggle` canonicalizes it
  // exactly as the tile's mark does, so a friend's list maps back to seats by match.
  saveButton.addEventListener("click", () => {
    if (at >= 0) saving.toggle(showing[at]);
  });
  // A click on the mat around the picture is a way back to the grid, as Esc is.
  preview.addEventListener("click", (event) => {
    if (event.target === preview) closePreview();
  });
  // A window that changes size redraws the preview for its new box, once it has settled.
  let resizing = 0;
  window.addEventListener("resize", () => {
    clearTimeout(resizing);
    resizing = setTimeout(() => {
      if (active && at >= 0) show(at);
    }, 200);
  });

  return {
    enter,
    exit,
    /** Give the pool back without handing the viewer anything: the page is going away. */
    stop() {
      if (active) close();
    },
    get active() {
      return active;
    },
    /** What is on screen, for Copy link: the previewed seat, or `null` on the grid, and
     *  the collection either way. */
    onScreen() {
      return { seat: active && at >= 0 ? showing[at] : null, collection: chosen };
    },
    /** The list changed, here or elsewhere: the grid's marks are `remark`'s, this is the rest. */
    redress() {
      if (active && at >= 0) dressSave();
    },
  };
}
