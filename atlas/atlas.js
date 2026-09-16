// The atlas page.
//
// One dot per place the search kept, over a plate of the plane those places sit in. The
// plate was rendered once, next door, and landed as a picture; this page draws no
// fractal at all. What it does draw is the marks, and what it owes each mark is three
// pictures and three links.
//
// The engine is here for one export. `permalink.js` decides whether a canonical link
// spells `x`, `y` and `w` by comparing them against the family's home view, and home is
// the engine's answer rather than a table anybody may type. So the committed module is
// instantiated for `plan` and nothing else: no workers, no rendering, no palettes baked
// into a canvas. That is also why this page has to be served — a browser will not load a
// module, or a `.wasm`, over `file://`.

import { contractOf, opened } from "./links.js";
import { load } from "./record.js";
import { DEFAULT_PALETTE } from "../explorer/palettes.js";

/** The three pictures a place carries, in the order the page shows them. */
const SLOTS = [
  ["julia", "Julia"],
  ["mandelbrot", "Mandelbrot"],
  ["render", "Render"],
];

/** The search's own name for a population, in words a reader of this article has. */
const POPULATION = {
  seated: "seated",
  human_q4: "human top quarter",
  machine_q4: "model top quarter",
};

/** Where a render slot's recipe came from, said the same way. */
const SOURCE = {
  seated: "seated in the published gallery",
  "best recipe by p_fine": "best recipe by the fine score",
  "best recipe by p_ge4": "best recipe by P(≥4)",
  "human-judged location view": "a view a person rated",
  "human-judged recipe": "a recipe a person rated",
};

const EXPLORER = "../explorer/index.html";

const notice = document.getElementById("notice");
const stage = document.getElementById("stage");
const plate = document.getElementById("plate");
const plateImage = document.getElementById("plate-image");
const line = document.getElementById("dot-line");
const legend = document.getElementById("legend");
const provenance = document.getElementById("provenance");

const frames = new Map();
for (const [name] of SLOTS) {
  const held = document.querySelector(`.slot[data-slot="${name}"]`);
  const empty = held.querySelector(".slot-empty");
  frames.set(name, {
    link: held.querySelector(".slot-frame"),
    image: held.querySelector(".slot-frame img"),
    empty,
    // What the well says before anything has been hovered, kept so that leaving a mark
    // puts the page back where it started rather than into a blanker version of itself.
    idle: empty.textContent,
    what: held.querySelector(".slot-what"),
  });
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
const score = (value) => Number(value).toFixed(4);

/** One element, with its class, its text and whatever else it is given. */
function made(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** What one slot's caption says: what it is, how it was drawn, what its link cannot carry. */
function saidOf(slot, palette) {
  const bits = [
    [null, slot.what ?? SOURCE[slot.source] ?? slot.source ?? "a render"],
    [null, `${slot.mode} · ${slot.colormap}`],
  ];
  if (slot.refused.length > 0) {
    const fell = palette !== slot.colormap ? `; it opens in ${palette}` : "";
    bits.push(["slot-refused", `the link cannot carry: ${slot.refused.join("; ")}${fell}`]);
  }
  return bits;
}

/** The one line under the three pictures: which place this is, and what is known of it. */
function saidAbout(dot) {
  const parts = [];
  for (const [plane, side] of Object.entries(dot.sides)) {
    const what = plane === "julia" ? "c" : "center";
    const scores = [];
    if (side.p_ge4 !== undefined) scores.push(`P(≥4) ${score(side.p_ge4)}`);
    if (side.p_fine !== undefined) scores.push(`fine ${score(side.p_fine)}`);
    if (side.human !== undefined) scores.push(`human ${side.human}`);
    if (side.seat !== undefined) scores.push(`seat ${side.seat.seat} (${side.seat.alias})`);
    const held = side.populations.map((name) => POPULATION[name] ?? name).join(" ∪ ");
    const said = scores.join(", ") || "no score";
    parts.push(`${plane} ${what} ${point(side.at)}: ${said} · ${held}`);
  }
  return parts;
}

/** Fill the three frames and the line from one place, or empty them all. */
function show(dot, links) {
  for (const [name] of SLOTS) {
    const held = frames.get(name);
    const slot = dot === null ? undefined : dot.slots[name];
    if (slot === undefined) {
      held.link.hidden = true;
      held.link.removeAttribute("href");
      held.empty.hidden = false;
      held.empty.textContent = dot === null ? held.idle : "no picture";
      held.what.textContent = "";
      continue;
    }
    const { query, palette } = links.get(slot);
    held.empty.hidden = true;
    held.link.hidden = false;
    held.link.href = `${EXPLORER}?${query}`;
    held.image.src = `../assets/images/atlas/${slot.file}`;
    held.image.alt = `${slot.mode} through ${slot.colormap}, at the ${name} view of this place`;
    held.what.replaceChildren(
      ...saidOf(slot, palette).map(([className, text]) => made("span", className, text)),
    );
  }
  line.replaceChildren(
    ...(dot === null
      ? [made("span", "quiet", "Hover a mark on the plane. Click one to keep it.")]
      : [
          made("span", `chip chip-${dot.class}`, dot.class === "seated" ? "seated" : "top quarter"),
          ...saidAbout(dot).map((text) => made("span", null, text)),
        ]),
  );
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
  // nothing new — and the caption needs the map each one settled on anyway.
  const links = new Map();
  for (const dot of partition.dots) {
    for (const slot of Object.values(dot.slots)) links.set(slot, opened(contract, slot));
  }

  plateImage.src = `../assets/images/atlas/${partition.plate.file}`;
  plateImage.alt =
    `The Mandelbrot parameter plane in gray at its whole view, ${partition.dots.length} marks ` +
    "on it where the search has kept a place.";
  plate.style.aspectRatio = `${partition.plate.aspect[0]} / ${partition.plate.aspect[1]}`;

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

  const tally = method.tally;
  const counted = (value) => value.toLocaleString("en-US");
  legend.replaceChildren(
    made("span", "key key-seated", "gold: holds a seat in the published gallery"),
    made("span", "key key-q4", "green: kept by the judges, not yet seated"),
    made(
      "span",
      "quiet",
      `${counted(tally.dots)} marks of ${counted(tally.queued)} places. ` +
        `${tally.absorbed} merged into a mark of the other plane, and ` +
        `${counted(tally.dropped)} landed inside the ${method.radius_px} px absorption radius ` +
        "of one already drawn.",
    ),
  );
  provenance.textContent =
    `Published record ${method.record}, judge ${method.judge.slice(0, 12)}…, ` +
    `top quarter at ${method.q_bar} and the fine bar at ${method.fine_bar}. ` +
    `${tally.both} of these places were found on both planes and are one mark with two sides. ` +
    `The neighborhood plates are drawn through ${method.canonical_map}, which is the map the ` +
    `explorer opens at; a picture drawn through a map the explorer does not bake opens in ` +
    `${DEFAULT_PALETTE} instead, and its caption says so.`;

  show(null, links);
  notice.hidden = true;
  stage.hidden = false;
}

start().catch((error) => {
  notice.replaceChildren(
    made("p", null, "The atlas could not be read."),
    made("p", null, String(error.message ?? error)),
  );
});
