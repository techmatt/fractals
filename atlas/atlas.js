// The atlas page.
//
// One mark per place the search kept, over a plate of the plane those places sit in. The
// plate was rendered once, next door, and landed as a picture; this page draws no fractal
// at all. What it does draw is the marks, and what it owes each mark is three pictures and
// three links.
//
// **It is full bleed and it is one fixed frame.** The stage under the site bar takes the
// whole window; the strip and the plate are sized once, in pixels, from what is left, and
// there is no text inside the frame at all. The page used to carry a caption under each
// slot and a line of scores under the row, and both changed height with whichever mark was
// under the pointer — which moved the plate under the pointer, which moved the mark. What
// those captions said is a `title` on the slot now: a tooltip is drawn over the page rather
// than in it, so it can say as much as it likes and nothing reflows. The three labels are
// the one piece of text the frame carries and they sit *on* the pictures, for the same
// reason: a row of labels is a height, and a height is a thing that can change.
//
// The engine is here for one export. `permalink.js` decides whether a canonical link
// spells `x`, `y` and `w` by comparing them against the family's home view, and home is
// the engine's answer rather than a table anybody may type. So the committed module is
// instantiated for `plan` and nothing else: no workers, no rendering, no palettes baked
// into a canvas. That is also why this page has to be served — a browser will not load a
// module, or a `.wasm`, over `file://`.

import { contractOf, opened } from "./links.js";
import { load } from "./record.js";

/** The three pictures a place carries, in the order the page shows them, left to right. */
const SLOTS = [
  ["mandelbrot", "Mandelbrot"],
  ["julia", "Julia"],
  ["gallery", "Gallery"],
];

/** Where a gallery slot's recipe came from, said in words a reader of this article has. */
const SOURCE = {
  seated: "the wallpaper the published gallery seats here",
  "best row by the fine score": "the best-scoring wallpaper drawn here",
};

/** Which kind of place a picture came from, as the class that colors its border. */
const FROM = { mandelbrot: "from-mandelbrot", julia: "from-julia" };

const EXPLORER = "../explorer/index.html";

/** Each slot's width, as a share of the plate's. Three of them and two gaps span it. */
const SLOT_SHARE = 0.32;

/** The gap under the strip, as the same share of the plate's width the side gaps get. */
const GAP_SHARE = (1 - 3 * SLOT_SHARE) / 2;

/** How far past its own pixels a slot picture may be stretched before the frame stops.
 *  Full bleed means the figure grows with the window, and on a tall window the height is
 *  what binds; past about here a thumbnail is being enlarged rather than shown. */
const MOST_UPSCALE = 1.6;

/** The narrowest plate worth drawing a hundred and fifty marks on. */
const LEAST = 320;

/** The shortest the stage goes, whatever a window with no height says. */
const LEAST_TALL = 280;

const stage = document.getElementById("stage");
const notice = document.getElementById("notice");
const frame = document.getElementById("frame");
const strip = frame.querySelector(".strip");
const plate = document.getElementById("plate");
const plateImage = document.getElementById("plate-image");

const slots = new Map();
for (const [name] of SLOTS) {
  const node = document.querySelector(`.slot[data-slot="${name}"]`);
  slots.set(name, { node, image: node.querySelector("img") });
}

/** The committed module, instantiated for `plan` and nothing else. */
async function planner() {
  const response = await fetch(new URL("../explorer/engine.wasm", import.meta.url));
  if (!response.ok) throw new Error(`engine.wasm: ${response.status} ${response.statusText}`);
  const { instance } = await WebAssembly.instantiate(await response.arrayBuffer(), {});
  const engine = instance.exports;
  return (spec) => {
    const raw = new TextEncoder().encode(JSON.stringify(spec));
    const pointer = engine.alloc(raw.length);
    new Uint8Array(engine.memory.buffer, pointer, raw.length).set(raw);
    const out = engine.plan(pointer, raw.length);
    engine.dealloc(pointer, raw.length);
    const size = new DataView(engine.memory.buffer).getUint32(out, true);
    const body = new TextDecoder().decode(new Uint8Array(engine.memory.buffer, out + 4, size));
    engine.dealloc(out, size + 4);
    return JSON.parse(body);
  };
}

const decimal = (value) =>
  Math.abs(value) < 1e-4 && value !== 0 ? value.toExponential(3) : Number(value).toPrecision(8);
const point = ([x, y]) => `${decimal(x)} ${y < 0 ? "−" : "+"} ${decimal(Math.abs(y))}i`;

/** One element, with its class and its text. */
function made(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/**
 * What one slot's tooltip says: what it is, how it was drawn, what its link cannot carry.
 *
 * This is the whole of what the deleted captions carried that was about the picture. A
 * tooltip can be three lines or one without costing the frame a pixel, which is the point
 * of moving it here.
 */
function titleOf(label, slot, palette) {
  const lines = [
    `${label}: ${slot.what ?? SOURCE[slot.source] ?? slot.source ?? "a render"}`,
    `${slot.mode} · ${slot.colormap}`,
  ];
  if (slot.refused.length > 0) {
    const fell = palette !== slot.colormap ? `; it opens in ${palette}` : "";
    lines.push(`The link cannot carry: ${slot.refused.join("; ")}${fell}.`);
  }
  return lines.join("\n");
}

/** Fill the three slots from one place, or empty them. The boxes stay either way. */
function show(dot, links) {
  for (const [name, label] of SLOTS) {
    const held = slots.get(name);
    const slot = dot === null ? undefined : dot.slots[name];
    // Only the gallery slot carries a kind, and only while a mark is showing: the other
    // two are always what their own label says and keep their border at rest.
    held.node.classList.remove(FROM.mandelbrot, FROM.julia);
    if (slot !== undefined && slot.plane !== undefined) held.node.classList.add(FROM[slot.plane]);
    if (slot === undefined) {
      held.node.removeAttribute("href");
      held.node.title = dot === null ? `${label}: hover a mark on the plane` : `${label}: none`;
      held.image.hidden = true;
      held.image.removeAttribute("src");
      held.image.alt = "";
      continue;
    }
    const { query, palette } = links.get(slot);
    held.node.href = `${EXPLORER}?${query}`;
    held.node.title = titleOf(label, slot, palette);
    held.image.hidden = false;
    held.image.src = `../assets/images/atlas/${slot.file}`;
    held.image.alt = `${slot.mode} through ${slot.colormap}, at the ${name} view of this place`;
  }
}

/**
 * What the stage has to give: the window's width, and the height the site bar leaves.
 *
 * The height is a number rather than `100vh` less a bar, because the bar's own height is
 * whatever the reader's font metrics make it and `100vh` is a promise a phone browser does
 * not keep. The padding comes out of both, because that is the box the figure goes in.
 */
function room() {
  const style = getComputedStyle(stage);
  const above = stage.getBoundingClientRect().top + window.scrollY;
  return {
    padX: parseFloat(style.paddingLeft) + parseFloat(style.paddingRight),
    padY: parseFloat(style.paddingTop) + parseFloat(style.paddingBottom),
    width: document.documentElement.clientWidth,
    height: Math.max(LEAST_TALL, Math.floor(window.innerHeight - above)),
  };
}

/** The stage at its full height, which is what the notice is centred in before the load. */
function stageBox() {
  stage.style.height = `${room().height}px`;
}

/**
 * Size the frame, once, from the viewport.
 *
 * The frame has one aspect ratio of its own — the plate's, plus the strip's share of it,
 * plus the gap between them — so fitting it into the stage is one division and no
 * branches. Nothing here reads the hover state, and nothing the hover state does reaches
 * back in.
 *
 * The strip spans the plate exactly: three slots at `SLOT_SHARE` and two gaps that the
 * flexbox works out from what is left, so the composed object is one rectangle whatever
 * the rounding does.
 *
 * **The stage takes the window's height, or the figure's, whichever is less.** Full bleed
 * is the ask and on any ordinary window the height is what binds, so the stage is the
 * screen. On a narrow one the width binds first and the figure comes out short, and a
 * stage held to the viewport anyway would be a band of empty mat with a small picture in
 * the middle of it.
 */
function fit({ plateAspect, slotAspect, slotNative }) {
  const box = room();
  const ratio = plateAspect + SLOT_SHARE * slotAspect + GAP_SHARE;
  const most = (slotNative * MOST_UPSCALE) / SLOT_SHARE;
  const width = Math.max(
    LEAST,
    Math.floor(Math.min(box.width - box.padX, (box.height - box.padY) / ratio, most)),
  );
  stage.style.height = `${Math.min(box.height, Math.ceil(width * ratio) + box.padY)}px`;

  const slotWidth = Math.floor(width * SLOT_SHARE);
  const slotHeight = Math.round(slotWidth * slotAspect);
  frame.style.width = `${width}px`;
  strip.style.marginBottom = `${Math.round(width * GAP_SHARE)}px`;
  plate.style.width = `${width}px`;
  plate.style.height = `${Math.round(width * plateAspect)}px`;
  for (const { node } of slots.values()) {
    node.style.width = `${slotWidth}px`;
    node.style.height = `${slotHeight}px`;
  }
}

async function start() {
  const plan = await planner();
  const contract = contractOf((spec) => {
    const answer = plan({ schema: 1, family: spec });
    if (!answer.ok) throw new Error(answer.why);
    return answer.home;
  });

  const { method, partitions } = await load(new URL("./", import.meta.url));
  const partition = partitions[0];

  // Every link, built once, through the one function that builds them. A link is the
  // same string every time it is asked for, so asking per hover would be work that says
  // nothing new — and the tooltip needs the map each one settled on anyway.
  const links = new Map();
  for (const dot of partition.dots) {
    for (const slot of Object.values(dot.slots)) links.set(slot, opened(contract, slot));
  }

  plateImage.src = `../assets/images/atlas/${partition.plate.file}`;
  plateImage.alt =
    `The Mandelbrot parameter plane in gray at its whole view, ${partition.dots.length} marks ` +
    "on it where the search has kept a place.";

  let stored = null;
  let hovering = null;
  const nodes = new Map();

  const settle = () => show(hovering ?? stored, links);

  for (const dot of partition.dots) {
    const node = made("button", `mark mark-${dot.plane}`);
    node.type = "button";
    node.style.left = `${(dot.px / partition.plate.width) * 100}%`;
    node.style.top = `${(dot.py / partition.plate.height) * 100}%`;
    node.setAttribute(
      "aria-label",
      `${dot.plane === "mandelbrot" ? "A place on the parameter plane" : "A Julia place"} at ` +
        `${point(dot.place.at)}${dot.place.seat === null ? "" : ", seated"}`,
    );
    const enter = () => {
      hovering = dot;
      settle();
    };
    const leave = () => {
      if (hovering === dot) hovering = null;
      settle();
    };
    node.addEventListener("mouseenter", enter);
    node.addEventListener("focus", enter);
    node.addEventListener("mouseleave", leave);
    node.addEventListener("blur", leave);
    node.addEventListener("click", () => {
      if (stored !== null) nodes.get(stored).classList.remove("is-stored");
      stored = stored === dot ? null : dot;
      if (stored !== null) nodes.get(stored).classList.add("is-stored");
      settle();
    });
    nodes.set(dot, node);
    plate.appendChild(node);
  }

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || stored === null) return;
    nodes.get(stored).classList.remove("is-stored");
    stored = null;
    settle();
  });

  show(null, links);
  notice.hidden = true;
  frame.hidden = false;

  const sizes = {
    plateAspect: partition.plate.aspect[1] / partition.plate.aspect[0],
    slotAspect: method.thumb.height / method.thumb.width,
    slotNative: method.thumb.width,
  };
  fit(sizes);
  // A window that changed size is not a mark that was hovered. The frame is fixed against
  // the one and fitted to the other, because a frame sized for a window nobody has any
  // more is not fixed, it is stale.
  window.addEventListener("resize", () => fit(sizes));
}

// The stage is full height before anything has loaded, so the notice — and the wait, on a
// slow connection — sits in the band the figure is about to fill rather than in a strip
// that jumps open when it arrives.
stageBox();

start().catch((error) => {
  notice.replaceChildren(
    made("p", null, "The atlas could not be read."),
    made("p", null, String(error.message ?? error)),
  );
  // `fit` is what keeps the stage the window's height once there is a frame in it; with
  // no frame there is still a notice to centre, so the stage is resized on its own.
  window.addEventListener("resize", stageBox);
});
