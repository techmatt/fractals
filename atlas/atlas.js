// The atlas page.
//
// One mark per place the search kept, over a plate of the plane those places sit in. The
// plate was rendered once, next door, and landed as a picture; this page draws no fractal
// at all. What it does draw is the marks, and what it owes each mark is three pictures and
// three links.
//
// **It is one fixed frame.** The three slots and the plate are sized once, in pixels, from
// the viewport, and there is no text inside the frame at all. The page used to carry a
// caption under each slot and a line of scores under the row, and both changed height with
// whichever mark was under the pointer — which moved the plate under the pointer, which
// moved the mark. What those captions said is a `title` on the slot now: a tooltip is drawn
// over the page rather than in it, so it can say as much as it likes and nothing reflows.
//
// The engine is here for one export. `permalink.js` decides whether a canonical link
// spells `x`, `y` and `w` by comparing them against the family's home view, and home is
// the engine's answer rather than a table anybody may type. So the committed module is
// instantiated for `plan` and nothing else: no workers, no rendering, no palettes baked
// into a canvas. That is also why this page has to be served — a browser will not load a
// module, or a `.wasm`, over `file://`.

import { contractOf, opened } from "./links.js";
import { load } from "./record.js";

/** The three pictures a place carries, in the order the page shows them. */
const SLOTS = [
  ["julia", "Julia"],
  ["mandelbrot", "Mandelbrot"],
  ["render", "Render"],
];

/** Where a render slot's recipe came from, said in words a reader of this article has. */
const SOURCE = {
  seated: "seated in the published gallery",
  "best recipe by p_fine": "best recipe by the fine score",
  "best recipe by p_ge4": "best recipe by P(≥4)",
  "human-judged location view": "a view a person rated",
  "human-judged recipe": "a recipe a person rated",
};

const EXPLORER = "../explorer/index.html";

/** Each slot's width, as a share of the plate's. Three of them, centred, and no gaps. */
const SLOT_SHARE = 0.3;

/** What the frame leaves below itself, so the whole of it is on screen at once. */
const BOTTOM = 16;

/** The narrowest plate worth drawing 152 marks on, whatever the viewport says. */
const LEAST = 320;

const notice = document.getElementById("notice");
const frame = document.getElementById("frame");
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
 * Size the frame, once, from the viewport.
 *
 * The frame has one aspect ratio of its own — the plate's, plus the strip's share of it —
 * so fitting it into the room below the intro is one division and no branches. Nothing
 * here reads the hover state, and nothing the hover state does reaches back in.
 */
function fit({ plateAspect, slotAspect, slotNative }) {
  const ratio = plateAspect + SLOT_SHARE * slotAspect;
  const room = frame.parentElement.clientWidth;
  const above = frame.getBoundingClientRect().top + window.scrollY;
  const tall = window.innerHeight - above - BOTTOM;
  // The third bound is the pictures themselves: a slot wider than the thumbnail the maker
  // landed is a soft picture pretending to be a big one, and on a tall screen the column
  // is wide enough to ask for one.
  const most = slotNative / SLOT_SHARE;
  const width = Math.max(LEAST, Math.floor(Math.min(room, tall / ratio, most)));

  const slotWidth = Math.floor(width * SLOT_SHARE);
  const slotHeight = Math.round(slotWidth * slotAspect);
  frame.style.width = `${width}px`;
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
    const node = made("button", `mark mark-${dot.class}`);
    node.type = "button";
    node.style.left = `${(dot.px / partition.plate.width) * 100}%`;
    node.style.top = `${(dot.py / partition.plate.height) * 100}%`;
    node.setAttribute(
      "aria-label",
      `${dot.class === "seated" ? "A seated place" : "A kept place"} at ` +
        `${point(Object.values(dot.sides)[0].at)}`,
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

start().catch((error) => {
  notice.replaceChildren(
    made("p", null, "The atlas could not be read."),
    made("p", null, String(error.message ?? error)),
  );
});
