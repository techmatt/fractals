// The atlas page.
//
// Two rules run through everything below, and they are the reason this file is not
// shorter.
//
// **The record's keys, never composed ones.** A dot's frame is the decimal strings the
// maker wrote down. They are handed to `explorer/permalink.js`, which is the only thing
// on this site allowed an opinion about what a view is, and what comes back is what gets
// drawn. Nothing here resolves a location through a position in a list, or through an
// index into anything derived from live data next door: that shape draws at a moving
// target, and the day the pool grows the pictures stay put while the links under them
// quietly point somewhere else.
//
// **The picture and the link are the same view, by construction.** Every render on this
// page goes through `emit` and then `parse` — the link is built first, and what is drawn
// is whatever the contract made of it. So "this dot opens at this picture" is not a
// promise two code paths keep in step; it is one code path. `atlas.test.mjs` pins the
// last link in that chain, which is that the explorer's own `DEFAULT_PALETTE` is still
// the map the record's node view names.
//
// Everything that draws is the explorer's: its permalink contract, its spec builder, its
// worker pool, its committed wasm module. This page adds no export and asks the engine
// for nothing it did not already answer.

import { PROVENANCE } from "../explorer/palettes.js";
import { pixelGrid, Renderer } from "../explorer/render.js";
import { contractOf, modeFor, opened, paletteFor } from "./links.js";
import { cellRect, load } from "./record.js";
import { heatOf, place, platesOf, spreadOf } from "./plot.js";

const notice = document.getElementById("notice");
const caution = document.getElementById("caution");
const stage = document.getElementById("stage");
const bar = document.getElementById("bar");
const plates = document.getElementById("plates");
const legend = document.getElementById("legend");
const chosen = document.getElementById("chosen");
const judged = document.getElementById("judged");
const judgedCount = document.getElementById("judged-count");
const status = document.getElementById("status");
const provenance = document.getElementById("provenance");

const pickers = {
  partition: document.getElementById("partition"),
  layout: document.getElementById("layout"),
  density: document.getElementById("density"),
  palette: document.getElementById("palette"),
};

/** How long a pointer has to settle on a dot before the renderer is asked for it. */
const SETTLE = 180;

/** The smallest a lit density bin is ever drawn, in pixels. */
const HEAT_FLOOR = 14;

let record = null;
let renderer = null;
let contract = null;
let partition = null;
let showing = [];
let selected = null;
let settling = 0;

// ------------------------------------------------------------------- the contract

/** A dot as the contract reads it, or the reason it cannot be read. */
function dotLink(dot) {
  try {
    const answer = opened(contract, {
      family: dot.family,
      viewport: dot.viewport,
      palette: paletteFor(record, dot, pickers.palette.value),
      mode: modeFor(record, dot),
    });
    return { ...answer, href: `../explorer/index.html?${answer.query}` };
  } catch (error) {
    return { refused: error.message };
  }
}

// --------------------------------------------------------------------- the renders

// One renderer, one frame at a time — `Renderer.field` cancels whatever was in flight
// when it is called, so two callers would take turns throwing each other's work away.
// What is queued is therefore a list rather than a promise chain, in two lanes: the
// plates a layout wants, and the one preview the pointer is waiting for. The preview
// goes first because somebody is looking at it, and the plate in flight is allowed to
// finish because abandoning it would cost more than the wait.
const plateJobs = [];
let previewJob = null;
let pumping = false;

function pump() {
  if (pumping) return;
  pumping = true;
  (async () => {
    for (;;) {
      let job = previewJob;
      previewJob = null;
      if (job === null) job = plateJobs.shift() ?? null;
      if (job === null) break;
      try {
        await job();
      } catch (error) {
        refused(error);
      }
    }
    pumping = false;
  })();
}

function enqueue(job) {
  plateJobs.push(job);
  pump();
}

/** The one job somebody is waiting on. A newer one replaces it rather than joining it. */
function preview(job) {
  previewJob = job;
  pump();
}

/** Abandon everything queued: a new layout, or a new partition. */
function stopDrawing() {
  plateJobs.length = 0;
  previewJob = null;
  renderer.cancel();
}

function refused(error) {
  say(error.message);
}

function say(text) {
  status.textContent = text;
}

/** One frame onto one canvas, at the canvas's own display size. */
async function drawInto(canvas, view, note) {
  const box = canvas.getBoundingClientRect();
  if (box.width < 8 || box.height < 8) return;
  const grid = pixelGrid(Math.round(box.width), Math.round(box.height));
  canvas.width = grid.width;
  canvas.height = grid.height;
  if (!renderer.resolves(view.x.value, view.y.value, view.w.value, grid.width, grid.height)) {
    canvas.classList.add("past-the-wall");
    say(`${note}: past what f64 places apart at this size — the explorer refuses it too.`);
    return;
  }
  canvas.classList.remove("past-the-wall");
  const field = await renderer.field(view, grid.width, grid.height);
  if (field === null) return;
  const { image } = renderer.shade(field, view);
  canvas.getContext("2d").putImageData(image, 0, 0);
  canvas.classList.add("drawn");
}

// ---------------------------------------------------------------------- the plates

/** The plane view a plate is a picture of: the record's own family, at the plate's frame. */
function plateView(frame) {
  return opened(contract, {
    family: partition.plane.family,
    viewport: { x: String(frame.x), y: String(frame.y), w: String(frame.width) },
    palette: record.nodeView.palette,
    mode: record.nodeView.mode,
  }).view;
}

function element(tag, className, text) {
  const made = document.createElement(tag);
  if (className) made.className = className;
  if (text !== undefined) made.textContent = text;
  return made;
}

/** One dot as the link it is. A plain click opens it; settling on it previews it here. */
function dotElement(dot, at) {
  const answer = dotLink(dot);
  const anchor = element("a", "dot");
  anchor.dataset.key = dot.key;
  anchor.style.left = `${at.u * 100}%`;
  anchor.style.top = `${at.v * 100}%`;
  if (dot.judged !== null) anchor.classList.add("judged");
  if (answer.refused) {
    anchor.classList.add("refused");
    anchor.setAttribute("aria-label", `no link: ${answer.refused}`);
  } else {
    anchor.href = answer.href;
    anchor.setAttribute(
      "aria-label",
      `open in fractal explorer — ${dot.family} at width ${dot.viewport.w}, ` +
        `standing for ${dot.keepers} keepers`,
    );
  }
  anchor.addEventListener("pointerenter", () => hover(dot));
  anchor.addEventListener("focus", () => hover(dot));
  return anchor;
}

function buildPlate(plate) {
  const figure = element("figure", "plate");
  if (plate.key === "plane") figure.classList.add("plate-whole");
  const stageBox = element("div", "plate-stage");
  const render = element("canvas", "plate-render");
  const heat = element("canvas", "plate-heat");
  const leaders = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  leaders.setAttribute("class", "plate-leaders");
  leaders.setAttribute("preserveAspectRatio", "none");
  const marks = element("div", "plate-marks");
  const dots = element("div", "plate-dots");

  for (const mark of plate.marks) {
    const box = element("span", "mark", mark.label);
    box.style.left = `${mark.u * 100}%`;
    box.style.top = `${mark.v * 100}%`;
    box.style.width = `${mark.width * 100}%`;
    box.style.height = `${mark.height * 100}%`;
    marks.append(box);
  }

  stageBox.append(render, heat, leaders, marks, dots);
  const caption = element("figcaption");
  caption.append(element("b", null, plate.title), element("span", null, plate.note));
  figure.append(stageBox, caption);
  return { figure, render, heat, leaders, dots, plate };
}

/** Where each of a plate's dots goes, which is the layout's only chance to lie. */
function positions(built) {
  const { plate, dots } = built;
  const truth = plate.dots.map((dot) => place(plate.frame, dot.at));
  if (!plate.spread) return truth.map((at, index) => ({ at, dot: plate.dots[index] }));
  const box = dots.getBoundingClientRect();
  const moved = spreadOf(truth, Math.max(1, box.width), Math.max(1, box.height));
  return moved.map((at, index) => ({
    at,
    from: at.moved ? truth[index] : null,
    dot: plate.dots[index],
  }));
}

function fillPlate(built) {
  const placed = positions(built);
  built.dots.replaceChildren(...placed.map(({ dot, at }) => dotElement(dot, at)));
  const leaders = placed.filter((entry) => entry.from);
  built.leaders.setAttribute("viewBox", "0 0 100 100");
  built.leaders.replaceChildren(
    ...leaders.map(({ at, from }) => {
      const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
      line.setAttribute("x1", `${from.u * 100}`);
      line.setAttribute("y1", `${from.v * 100}`);
      line.setAttribute("x2", `${at.u * 100}`);
      line.setAttribute("y2", `${at.v * 100}`);
      return line;
    }),
  );
  drawHeat(built);
}

/** The keeper population over this plate's own frame, on a log scale. */
function drawHeat(built) {
  const canvas = built.heat;
  const on = pickers.density.value === "on";
  canvas.hidden = !on;
  // The plate goes to a ghost of itself while the heatmap is on. Ninety-seven lit bins
  // of forty thousand cannot compete with a full-strength render for a reader's eye, and
  // the question the heatmap answers is not one the picture underneath is answering.
  canvas.parentElement.classList.toggle("heated", on);
  if (!on) return;
  const box = canvas.getBoundingClientRect();
  canvas.width = Math.max(1, Math.round(box.width));
  canvas.height = Math.max(1, Math.round(box.height));
  const context = canvas.getContext("2d");
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.filter = "blur(3px)";
  const frame = built.plate.frame;
  // Quietest first, so the busiest bin is never painted over by a neighbour that holds
  // eleven keepers. The record's own order is by position, which is the wrong one here.
  const order = [...partition.density.cells].sort((a, b) => a[2] - b[2]);
  for (const cell of order) {
    const rect = cellRect(partition, cell);
    const corner = place(frame, [rect.left, rect.top]);
    const width = (rect.width / frame.width) * canvas.width;
    const height = (rect.height / frame.height) * canvas.height;
    const x = corner.u * canvas.width;
    const y = corner.v * canvas.height;
    if (x + width < 0 || y + height < 0 || x > canvas.width || y > canvas.height) continue;
    const heat = heatOf(cell[2], partition.density.peak);
    context.globalAlpha = heat.alpha;
    context.fillStyle = heat.color;
    // A bin is a two-hundredth of the plane, which is four pixels at a plot's width, and
    // ninety-seven of forty thousand are lit. Drawn at its true size the whole grid is a
    // dusting nobody can see, so a lit bin is grown to a floor and drawn from its centre.
    const wide = Math.max(HEAT_FLOOR * heat.grow, width);
    const tall = Math.max(HEAT_FLOOR * heat.grow, height);
    context.fillRect(x - (wide - width) / 2, y - (tall - height) / 2, wide, tall);
  }
  context.globalAlpha = 1;
}

// ------------------------------------------------------------------- the side panel

function hover(dot) {
  window.clearTimeout(settling);
  settling = window.setTimeout(() => select(dot), SETTLE);
}

function select(dot) {
  if (selected !== null && selected.key === dot.key) return;
  selected = dot;
  for (const marked of document.querySelectorAll(".is-current")) {
    marked.classList.remove("is-current");
  }
  for (const marked of document.querySelectorAll(`[data-key="${CSS.escape(dot.key)}"]`)) {
    marked.classList.add("is-current");
  }
  showChosen(dot);
}

function keysOf(dot) {
  const list = element("dl", "keys");
  for (const [key, value] of Object.entries(dot.viewport)) {
    list.append(element("dt", null, key), element("dd", null, value));
  }
  return list;
}

function showChosen(dot) {
  const answer = dotLink(dot);
  chosen.replaceChildren();

  const well = element("div", "chosen-well");
  let canvas = null;
  if (dot.judged !== null && dot.judged.thumb) {
    const image = element("img");
    image.src = `../assets/images/atlas/${dot.judged.thumb.file}`;
    image.width = dot.judged.thumb.width;
    image.height = dot.judged.thumb.height;
    image.alt = `A colored render of the place this dot stands for, in ${dot.judged.palette}.`;
    well.append(image);
  } else {
    canvas = element("canvas", "chosen-render");
    well.append(canvas);
  }
  chosen.append(well);

  const how =
    dot.judged !== null
      ? `Drawn and judged before this page loaded: ${dot.judged.mode} through ` +
        `${dot.judged.palette}, scored ${dot.judged.score.toFixed(1)}.`
      : `Drawn here, just now, in the renderer this page carries: ${modeFor(record, dot)} ` +
        `through ${paletteFor(record, dot, pickers.palette.value)}. No judge has looked at it.`;
  chosen.append(element("p", "how", how));

  const stands = element(
    "p",
    "stands",
    `${dot.keepers.toLocaleString()} keepers came out of this place, and the thinning left ` +
      `this one dot for all of them. The location judge put it at ${dot.score.toFixed(2)}.`,
  );
  chosen.append(stands);
  chosen.append(keysOf(dot));

  if (answer.refused) {
    chosen.append(element("p", "how", `No link: ${answer.refused}`));
  } else {
    const open = element("a", "open", "open in fractal explorer");
    open.href = answer.href;
    chosen.append(open);
    const cap = renderer.maxiter(answer.view.w.value);
    chosen.append(
      element(
        "p",
        "how",
        `The depth policy asks for ${cap.toLocaleString()} iterations at this width.`,
      ),
    );
  }

  if (canvas !== null && !answer.refused) {
    preview(() => drawInto(canvas, answer.view, dot.key));
  }
}

function buildJudged() {
  const tiles = partition.dots.filter((dot) => dot.judged !== null && dot.judged.thumb);
  judgedCount.textContent = `${tiles.length} of ${partition.dots.length}`;
  judged.replaceChildren(
    ...tiles.map((dot) => {
      const answer = dotLink(dot);
      const tile = element(answer.refused ? "span" : "a", "tile");
      tile.dataset.key = dot.key;
      if (!answer.refused) {
        tile.href = answer.href;
        tile.setAttribute("aria-label", `open in fractal explorer — ${dot.judged.palette}`);
      }
      const image = element("img");
      image.src = `../assets/images/atlas/${dot.judged.thumb.file}`;
      image.width = dot.judged.thumb.width;
      image.height = dot.judged.thumb.height;
      image.loading = "lazy";
      image.alt = `A colored render of one kept place, in ${dot.judged.palette}.`;
      tile.append(image);
      tile.addEventListener("pointerenter", () => hover(dot));
      tile.addEventListener("focus", () => hover(dot));
      return tile;
    }),
  );
}

// ------------------------------------------------------------------------ the page

function buildLegend() {
  const on = pickers.density.value === "on";
  legend.hidden = !on;
  if (!on) return;
  const [across, down] = partition.density.bins;
  const width = partition.plane.frame.width / across;
  const height = partition.plane.frame.height / down;
  legend.replaceChildren();
  const ramp = element("span", "ramp");
  for (let step = 0; step <= 24; step++) {
    const swatch = element("i");
    const heat = heatOf(Math.round((partition.density.peak * step) / 24), partition.density.peak);
    swatch.style.background = heat.color;
    swatch.style.opacity = `${heat.alpha}`;
    ramp.append(swatch);
  }
  legend.append(
    element("span", null, "1"),
    ramp,
    element("span", null, partition.density.peak.toLocaleString()),
    element(
      "span",
      "legend-note",
      `keepers in a ${width.toPrecision(2)}×${height.toPrecision(2)} bin, on a log scale — ` +
        `${partition.density.cells.length} of ${across * down} bins hold anything, and ` +
        `${partition.density.total.toLocaleString()} keepers are in them.`,
    ),
  );
}

function relayout() {
  stopDrawing();
  selected = null;
  showing = platesOf(partition, pickers.layout.value).map(buildPlate);
  plates.replaceChildren(...showing.map((built) => built.figure));
  for (const built of showing) fillPlate(built);
  buildLegend();
  for (const built of showing) {
    enqueue(() => drawInto(built.render, plateView(built.plate.frame), built.plate.title));
  }
  enqueue(async () =>
    say(
      `${partition.dots.length} places, ${partition.keepers.toLocaleString()} keepers, ` +
        `thinned at r = ${partition.radius}.`,
    ),
  );
  const first = partition.dots.find((dot) => dot.judged !== null) ?? partition.dots[0];
  if (first !== undefined) select(first);
}

function repartition() {
  partition = record.partitions.find((entry) => entry.name === pickers.partition.value);
  buildJudged();
  relayout();
}

function fill(picker, entries) {
  picker.replaceChildren(
    ...entries.map(([value, label]) => {
      const option = element("option", null, label);
      option.value = value;
      return option;
    }),
  );
}

let resizing = 0;
window.addEventListener("resize", () => {
  window.clearTimeout(resizing);
  resizing = window.setTimeout(() => {
    if (showing.length === 0) return;
    relayout();
  }, 250);
});

// ------------------------------------------------------------------- starting up

function stop(message) {
  notice.replaceChildren(element("p", null, message));
  notice.hidden = false;
  stage.hidden = true;
  bar.hidden = true;
}

async function main() {
  renderer = await Renderer.start(new URL("../explorer/engine.wasm", import.meta.url));
  contract = contractOf((familySpec) => renderer.home(familySpec));

  record = await load(new URL("./", import.meta.url));

  if (record.fixture) {
    caution.replaceChildren(
      element("b", null, "Nothing on this page is a real find. "),
      element(
        "span",
        null,
        "The atlas record is a synthetic fixture, written so the page could be designed " +
          "before the search's own record exists. The counts, the separation radii and " +
          "the eight decades of width are the audited population's; the places are not. " +
          "Every key on it opens with ",
      ),
      element("code", null, "fixture:"),
      element("span", null, "."),
    );
    caution.hidden = false;
  }

  fill(
    pickers.partition,
    record.partitions.map((entry) => [entry.name, entry.title]),
  );
  for (const [name, picker] of Object.entries(pickers)) {
    picker.addEventListener("change", name === "partition" ? repartition : relayout);
  }

  provenance.textContent =
    `The plates and every unjudged render are drawn here, by the wallpaper project's own ` +
    `renderer compiled to wasm — ${PROVENANCE.offered} palettes baked from ` +
    `fractal-wallpapers ${PROVENANCE.wallpapers_commit.slice(0, 12)} on ${PROVENANCE.baked}. ` +
    `The record was made ${record.made}.`;

  notice.hidden = true;
  stage.hidden = false;
  bar.hidden = false;
  repartition();
}

main().catch((error) => stop(`${error.message} Nothing has been drawn.`));
