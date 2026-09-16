// The atlas frame, as a piece rather than a page.
//
// One mark per place the search kept, over a plate of the plane those places sit in, and
// three slots above it that fill with whatever mark is being pointed at. The plate was
// rendered once, next door, and landed as a picture; nothing here draws a fractal at all.
// What it does draw is the marks, and what it owes each mark is three pictures and three
// links.
//
// **It is one fixed rectangle and nothing in it reflows.** The strip and the plate are
// sized once, in pixels, from the box the host gives, and there is no text inside the frame
// but the three labels, which sit *on* the pictures. The page used to carry a caption under
// each slot and a line of scores under the row, and both changed height with whichever mark
// was under the pointer — which moved the plate under the pointer, which moved the mark.
// What those captions said is a `title` on the slot now: a tooltip is drawn over the page
// rather than in it, so it can say as much as it likes and nothing reflows. The three
// labels are the one piece of text the frame carries, for the same reason.
//
// **Two pages mount one**, which is why the frame is here and not in `atlas.js`: the atlas
// page shows it full bleed under the site bar, and the explorer's studio shows the same
// frame in a panel beside its canvas. So the frame is measured against the host it is
// mounted in rather than against the window, and every file it fetches — the record, the
// thumbnails, the engine — is resolved against `options.base` rather than against whichever
// document is carrying it. A page in `explorer/` and a page in `atlas/` both find them.
//
// The engine is here for one export. `permalink.js` decides whether a canonical link
// spells `x`, `y` and `w` by comparing them against the family's home view, and home is
// the engine's answer rather than a table anybody may type. So the committed module is
// instantiated for `plan` and nothing else: no workers, no rendering, no palettes baked
// into a canvas. That is also why a page carrying a frame has to be served — a browser
// will not load a module, or a `.wasm`, over `file://`.

import { contractOf, opened } from "./links.js";
import { load } from "./record.js";

/** The three pictures a place carries, in the order the frame shows them, left to right. */
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

/** Each slot's width, as a share of the plate's. Three of them and two gaps span it. */
const SLOT_SHARE = 0.32;

/** The gap under the strip, as the same share of the plate's width the side gaps get. */
const GAP_SHARE = (1 - 3 * SLOT_SHARE) / 2;

/** How far past its own pixels a slot picture may be stretched before the frame stops.
 *  Full bleed means the figure grows with its host, and in a tall box the height is what
 *  binds; past about here a thumbnail is being enlarged rather than shown. */
const MOST_UPSCALE = 1.6;

/** The narrowest plate worth drawing a hundred and fifty marks on. */
const LEAST = 320;

/** The committed module, instantiated for `plan` and nothing else. */
async function planner(base) {
  const response = await fetch(new URL("../explorer/engine.wasm", base));
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

/**
 * The host's content box, which is the whole of what the frame is fitted to.
 *
 * Padding and border come off because the frame goes inside them: the atlas page hands a
 * bare box it has already sized from the viewport, and a panel may well have a rule and a
 * little air. A host that is not being displayed measures zero, and a fit against zero is
 * refused above rather than written into the frame — a studio panel on another tab is
 * display:none, and a frame that resized itself to nothing while nobody was looking would
 * come back as a 320-pixel plate.
 */
function contentBox(node) {
  const rect = node.getBoundingClientRect();
  const style = getComputedStyle(node);
  const off = (...names) => names.reduce((total, name) => total + parseFloat(style[name] || 0), 0);
  return {
    width: rect.width - off("paddingLeft", "paddingRight", "borderLeftWidth", "borderRightWidth"),
    height: rect.height - off("paddingTop", "paddingBottom", "borderTopWidth", "borderBottomWidth"),
  };
}

/**
 * Build a frame inside `host`, and hand back the handle its page drives it with.
 *
 * ```js
 * const frame = await mount(host, { keep: true });
 * ```
 *
 * `options` says which of the two pages this is:
 *
 * - **`base`** — a `URL` the record, the pictures under `../assets/images/atlas/` and
 *   `../explorer/engine.wasm` are resolved against. It defaults to this module's own
 *   directory, which is where all three are relative to, so a page anywhere in the tree
 *   that mounts a frame gets them right without saying anything.
 * - **`keep`** (default `false`) — whether a click on a mark stores it. Stored, the frame
 *   goes on showing that place when the pointer leaves; a second click on the same mark
 *   lets it go, and so does Escape. This is the atlas page's behavior, and the stored mark
 *   wears `is-stored`.
 * - **`linger`** (default `false`) — whether the slots go on showing the last place the
 *   pointer was over. This is the studio's behavior and it exists so that the three slots
 *   can be clicked at all: hover alone empties them the moment the pointer leaves the
 *   mark, and a picture nobody can reach is not a picture anybody can pick. It is not
 *   `keep` in a second spelling — nothing is stored, no mark wears a ring, and there is
 *   nothing for Escape to let go of. The slots simply hold the last thing they were shown.
 * - **`onPick`** (default absent) — where a click goes instead of the explorer. Given one,
 *   a click on a mark calls `onPick({ dot, slot, query, palette })` for that mark's gallery
 *   slot and a click on a slot calls it for that slot, the frame navigates nowhere, and the
 *   slots are buttons rather than links so that they stay operable from the keyboard.
 *   Absent, each slot is an `<a href>` into the explorer at the view it shows.
 *
 * The handle is `{ record, refit, destroy }`: the record as `record.js` read it, a `refit`
 * that re-sizes the frame to its host and returns the `{ width, height }` it settled on,
 * and a `destroy` that disconnects the observer, unhooks the key handler and takes the
 * frame back out of the host.
 *
 * `mount` adds the `frame-host` class to the host and takes it off again at `destroy`,
 * which is what centres the frame in the box; everything else about the host is its page's.
 */
export async function mount(host, options = {}) {
  const base = options.base ?? new URL("./", import.meta.url);
  const keep = options.keep ?? false;
  const linger = options.linger ?? false;
  const onPick = options.onPick;
  const navigates = onPick === undefined;

  const plan = await planner(base);
  const contract = contractOf((spec) => {
    const answer = plan({ schema: 1, family: spec });
    if (!answer.ok) throw new Error(answer.why);
    return answer.home;
  });

  const record = await load(base);
  const partition = record.partitions[0];

  // Every link, built once, through the one function that builds them. A link is the
  // same string every time it is asked for, so asking per hover would be work that says
  // nothing new — and the tooltip needs the map each one settled on anyway.
  const links = new Map();
  for (const dot of partition.dots) {
    for (const slot of Object.values(dot.slots)) links.set(slot, opened(contract, slot));
  }

  const frame = made("div", "frame");
  const strip = made("div", "strip");
  const explorer = new URL("../explorer/index.html", base);
  const slots = new Map();
  for (const [name, label] of SLOTS) {
    const node = made(navigates ? "a" : "button", "slot");
    if (!navigates) node.type = "button";
    node.dataset.slot = name;
    const image = made("img");
    image.alt = "";
    node.append(image, made("span", "slot-label", label));
    strip.appendChild(node);
    slots.set(name, { node, image, label });
  }
  const plate = made("div", "plate");
  const plateImage = made("img");
  plateImage.src = new URL(`../assets/images/atlas/${partition.plate.file}`, base);
  plateImage.alt =
    `The Mandelbrot parameter plane in gray at its whole view, ${partition.dots.length} marks ` +
    "on it where the search has kept a place.";
  plate.appendChild(plateImage);
  frame.append(strip, plate);

  /** Which place the three slots are showing, so that a click on one knows what it is. */
  let showing = null;

  /** Fill the three slots from one place, or empty them. The boxes stay either way. */
  const show = (dot) => {
    showing = dot;
    for (const [name, { node, image, label }] of slots) {
      const slot = dot === null ? undefined : dot.slots[name];
      // Only the gallery slot carries a kind, and only while a mark is showing: the other
      // two are always what their own label says and keep their border at rest.
      node.classList.remove(FROM.mandelbrot, FROM.julia);
      if (slot !== undefined && slot.plane !== undefined) node.classList.add(FROM[slot.plane]);
      if (slot === undefined) {
        if (navigates) node.removeAttribute("href");
        node.title = dot === null ? `${label}: hover a mark on the plane` : `${label}: none`;
        image.hidden = true;
        image.removeAttribute("src");
        image.alt = "";
        continue;
      }
      const { query, palette } = links.get(slot);
      if (navigates) node.href = `${explorer}?${query}`;
      node.title = titleOf(label, slot, palette);
      image.hidden = false;
      image.src = new URL(`../assets/images/atlas/${slot.file}`, base);
      image.alt = `${slot.mode} through ${slot.colormap}, at the ${name} view of this place`;
    }
  };

  /** One slot of one place, handed out. An empty slot is not a pick and says nothing. */
  const pick = (dot, name) => {
    const slot = dot === null ? undefined : dot.slots[name];
    if (slot === undefined) return;
    const { query, palette } = links.get(slot);
    onPick({ dot, slot, query, palette });
  };

  let stored = null;
  let hovering = null;
  const nodes = new Map();
  const settle = () => show(hovering ?? stored);

  if (!navigates) {
    for (const [name, { node }] of slots) {
      node.addEventListener("click", () => pick(showing, name));
    }
  }

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
      // Lingering, the slots keep what they were last shown, so there is something in
      // them to click. Nothing is stored: `hovering` is still the last place the pointer
      // was over, and the next mark replaces it.
      if (linger) return;
      if (hovering === dot) hovering = null;
      settle();
    };
    node.addEventListener("mouseenter", enter);
    node.addEventListener("focus", enter);
    node.addEventListener("mouseleave", leave);
    node.addEventListener("blur", leave);
    node.addEventListener("click", () => {
      if (keep) {
        if (stored !== null) nodes.get(stored).classList.remove("is-stored");
        stored = stored === dot ? null : dot;
        if (stored !== null) nodes.get(stored).classList.add("is-stored");
        settle();
      }
      // A mark is a place, and the one of its three pictures a place is worth opening at
      // is the wallpaper. The other two are what a picker would go to the slots for.
      if (!navigates) pick(dot, "gallery");
    });
    nodes.set(dot, node);
    plate.appendChild(node);
  }

  const letGo = (event) => {
    if (event.key !== "Escape" || stored === null) return;
    nodes.get(stored).classList.remove("is-stored");
    stored = null;
    settle();
  };
  if (keep) document.addEventListener("keydown", letGo);

  /**
   * The frame has one aspect ratio of its own — the plate's, plus the strip's share of it,
   * plus the gap between them — so fitting it into a box is one division and no branches.
   * Nothing here reads the hover state, and nothing the hover state does reaches back in.
   *
   * The strip spans the plate exactly: three slots at `SLOT_SHARE` and two gaps that the
   * flexbox works out from what is left, so the composed object is one rectangle whatever
   * the rounding does.
   */
  const plateAspect = partition.plate.aspect[1] / partition.plate.aspect[0];
  const slotAspect = record.method.thumb.height / record.method.thumb.width;
  const ratio = plateAspect + SLOT_SHARE * slotAspect + GAP_SHARE;
  const most = (record.method.thumb.width * MOST_UPSCALE) / SLOT_SHARE;

  /** The size the frame was last fitted to. Everything about it follows from the width,
   *  so a box that changed without changing that is a box nothing has to be written for. */
  let fitted = { width: 0, height: 0 };

  const refit = () => {
    const box = contentBox(host);
    if (box.width <= 0 || box.height <= 0) return fitted;
    const width = Math.max(LEAST, Math.floor(Math.min(box.width, box.height / ratio, most)));
    if (width === fitted.width) return fitted;

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
    // The height a page lays a band out with is the composed one the aspect gives, not the
    // box's: a border or two either side is what the difference is, and a page that sized a
    // band from the rendered box would be sizing it from a number the frame does not own.
    fitted = { width, height: Math.ceil(width * ratio) };
    return fitted;
  };

  show(null);
  host.classList.add("frame-host");
  host.appendChild(frame);

  // A host that changed size is not a mark that was hovered. The frame is fixed against
  // the one and fitted to the other, because a frame sized for a box nobody has any more
  // is not fixed, it is stale.
  const observer = new ResizeObserver(() => refit());
  observer.observe(host);

  const destroy = () => {
    observer.disconnect();
    if (keep) document.removeEventListener("keydown", letGo);
    frame.remove();
    host.classList.remove("frame-host");
  };

  return { record, refit, destroy };
}
