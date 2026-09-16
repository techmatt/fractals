// The palette picker: a tab strip over the whole library, and a gradient per row.
//
// The explorer used to offer a single `<select>` of 77 curated names. It now carries
// every one of the library's maps — a link built from a gallery seat has to be able to
// name the map that seat was drawn in, and the published record alone seats 451 distinct
// maps — and a thousand names in one menu is not a picker, it is a list. So the maps are
// laid out the three ways somebody actually looks for one:
//
//   * **Popular** — 24 of the most seated maps, `seats` being how many wallpapers of the
//     published record were drawn in each, curated for range: `popular.json` lists them,
//     and `builder/picker.py` is the rule that wrote it — a map too like one already on
//     the list is passed over, and no hue family holds more than three. Where a reader
//     who does not know what they want should start, so it should not be four of one
//     ramp.
//   * **A hue family** — the colour a map most often PRODUCES, read off the candidate
//     ledger rather than off the gradient. A map of mostly blue stops that keeps landing
//     in orange pictures is filed under orange here, because what a reader is choosing is
//     the picture and not the ramp.
//   * **All** — every name, filtered by typing. A link may name any map in the library,
//     so there has to be one place that holds all of them.
//
// Both readings come off the baked index, which freezes them in `explorer/palettes.jsonl`
// rather than deriving them at bake time; `builder/explorer.py --roster` is what rewrites
// them. Nothing here computes either.
//
// **A map is shown by its display name and addressed by its own.** `palette-names.json`
// gives most of the library a name a reader can read — `wallhaven_wallhaven-1joljg` is
// shown as a colour and a material — and every row, tab and filter here uses it. What
// `onPick` is handed, and so what a link carries, is the underlying name, and a row's
// tooltip says both. A map with no entry is shown as itself.
//
// **The strip is drawn from the control points the renderer bakes**, through `stops.js`,
// so a row and the picture it opens cannot disagree about a colour. There is a swatch PNG
// beside the page — `python -m builder explorer` writes one — and this deliberately does
// not use it: the blob is already fetched to draw with, and a second copy of the same
// colours is a second thing to keep in step.

import { HUES } from "./hues.js";
import { PALETTES } from "./palettes.js";
import { stopsOf } from "./stops.js";

/** How many maps the Popular tab holds where its record could not be read, taken by seats
 *  alone. The record is the list; this is only what a page without it still shows. */
const POPULAR = 24;

/** The swatch's backing store. Wide enough that a map with hundreds of stops lands about
 *  one stop to a pixel, which is as much of a gradient as a strip this size can say. */
const STRIP = { width: 160, height: 12 };

/** Every map, with the two readings the tabs are built out of and the name it is shown by. */
function roster(names) {
  return [...PALETTES].map(([name, map]) => ({
    name,
    shown: names[name] ?? name,
    family: map.family,
    seats: map.seats,
  }));
}

/** By seats, then by the name shown: a tie in a count is broken by something stable. */
function bySeats(a, b) {
  return b.seats - a.seats || a.shown.localeCompare(b.shown);
}

/** What a row's tooltip calls a map: both names where they differ. */
export function bothNames(map) {
  return map.shown === map.name ? map.name : `${map.shown} · ${map.name}`;
}

/**
 * The tabs, in order: Popular, each family some map is filed under, then All.
 *
 * A family nothing is filed under gets no tab rather than an empty one, which is the
 * rule the library page's sections already follow. The 92 maps the ledger never saw in
 * a picture carry no family at all and so appear only under All, which is the honest
 * place for them: nothing is known about what they produce.
 */
function tabsOf(maps, listed) {
  const held = new Map();
  for (const map of maps) {
    if (map.family === null || map.family === undefined) continue;
    held.set(map.family, (held.get(map.family) ?? 0) + 1);
  }
  const ordered = [
    ...HUES.filter((hue) => held.has(hue)),
    ...[...held.keys()].filter((hue) => !HUES.includes(hue)).sort(),
  ];
  const byName = new Map(maps.map((map) => [map.name, map]));
  const popular = listed === null
    ? [...maps].sort(bySeats).slice(0, POPULAR)
    : listed.map((name) => byName.get(name)).filter((map) => map !== undefined);
  return [
    { id: "popular", label: "Popular", count: popular.length, maps: popular },
    ...ordered.map((hue) => ({
      id: `hue:${hue}`,
      label: hue,
      count: held.get(hue),
      maps: maps.filter((map) => map.family === hue).sort(bySeats),
    })),
    {
      id: "all",
      label: "All",
      count: maps.length,
      maps: [...maps].sort((a, b) => a.shown.localeCompare(b.shown)),
    },
  ];
}

/** One map's gradient, drawn from the control points the renderer will bake.
 *
 *  Interpolated in sRGB between stops, where the engine interpolates in Oklab. On a map
 *  with 257 or 512 of them — which is nearly every map here — a strip this wide lands
 *  about one stop to a pixel and the two readings are the same pixels; on the few short
 *  maps the difference is inside one step of the ramp. What matters is that the colours
 *  are the library's own and not a second set. */
function paint(canvas, name) {
  const context = canvas.getContext("2d", { alpha: false });
  const { stops } = stopsOf(name);
  const image = context.createImageData(STRIP.width, 1);
  const last = stops.length - 1;
  for (let column = 0; column < STRIP.width; column += 1) {
    const at = (column / (STRIP.width - 1)) * last;
    const lower = Math.min(Math.floor(at), last);
    const upper = Math.min(lower + 1, last);
    const fraction = at - lower;
    for (let channel = 0; channel < 3; channel += 1) {
      const from = stops[lower][1][channel];
      const to = stops[upper][1][channel];
      image.data[column * 4 + channel] = Math.round(from + (to - from) * fraction);
    }
    image.data[column * 4 + 3] = 255;
  }
  const strip = document.createElement("canvas");
  strip.width = STRIP.width;
  strip.height = 1;
  strip.getContext("2d").putImageData(image, 0, 0);
  context.imageSmoothingEnabled = false;
  context.drawImage(strip, 0, 0, STRIP.width, STRIP.height);
}

/**
 * Build the picker into the three elements the page gives it.
 *
 * `onPick` is called with a map's name and nothing else: what happens to the view is the
 * page's business, and this module never holds a second opinion about which map is in
 * force — `show` is told, every time, by whoever changed it.
 *
 * `names` is the display-name record and `popular` the Popular record's list, or `null`
 * where it could not be read.
 */
export function install({ tabs, search, filter, list, names, popular, onPick }) {
  const maps = roster(names);
  const groups = tabsOf(maps, popular);
  const buttons = new Map();
  let open = groups[0];
  let picked = null;
  let query = "";

  // Drawn when a row scrolls into the strip and not before. Every map in the library is
  // a row under All, and a thousand gradients painted up front is a second of work for a
  // list nobody has scrolled yet.
  const painter = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const canvas = entry.target;
        painter.unobserve(canvas);
        paint(canvas, canvas.dataset.palette);
      }
    },
    { root: list, rootMargin: "120px" },
  );

  function rowOf(map) {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "swatch";
    row.dataset.palette = map.name;
    row.setAttribute("role", "option");
    row.setAttribute("aria-selected", String(map.name === picked));
    if (map.name === picked) row.classList.add("is-picked");

    const canvas = document.createElement("canvas");
    canvas.width = STRIP.width;
    canvas.height = STRIP.height;
    canvas.dataset.palette = map.name;
    canvas.setAttribute("aria-hidden", "true");

    const name = document.createElement("span");
    name.className = "name";
    name.textContent = map.shown;

    row.title = map.seats === 0
      ? bothNames(map)
      : `${bothNames(map)} — ${map.seats} ${map.seats === 1 ? "wallpaper" : "wallpapers"} ` +
        "of the published record were drawn in it";
    row.append(canvas, name);
    row.addEventListener("click", () => onPick(map.name));
    painter.observe(canvas);
    return row;
  }

  function fillList() {
    const wanted = query === ""
      ? open.maps
      : open.maps.filter(
        (map) => map.shown.toLowerCase().includes(query) || map.name.toLowerCase().includes(query),
      );
    list.replaceChildren(...wanted.map(rowOf));
    if (wanted.length === 0) {
      const empty = document.createElement("p");
      empty.className = "help";
      empty.textContent = `No palette here is named like “${query}”.`;
      list.append(empty);
    }
  }

  function fillTabs() {
    tabs.replaceChildren();
    buttons.clear();
    for (const group of groups) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "palette-tab";
      button.setAttribute("role", "tab");
      button.setAttribute("aria-selected", String(group === open));
      button.textContent = group.label;
      const count = document.createElement("span");
      count.className = "count";
      count.textContent = group.count;
      button.append(count);
      button.addEventListener("click", () => {
        open = group;
        query = "";
        filter.value = "";
        search.hidden = group.id !== "all";
        fillTabs();
        fillList();
        if (group.id === "all") filter.focus();
      });
      buttons.set(group, button);
      tabs.append(button);
    }
    markTabs();
  }

  /** Which tabs hold the map that is in force. A reader who arrived on a link should be
   *  able to see where the map they are looking at lives without opening every tab. */
  function markTabs() {
    for (const [group, button] of buttons) {
      const holds = picked !== null && group.maps.some((map) => map.name === picked);
      button.classList.toggle("holds", holds);
    }
  }

  filter.addEventListener("input", () => {
    query = filter.value.trim().toLowerCase();
    fillList();
  });

  return {
    /** Say which map is in force: it is marked wherever it is shown, and the tabs that
     *  hold it are marked too. */
    show(name) {
      picked = name;
      for (const row of list.querySelectorAll(".swatch")) {
        const mine = row.dataset.palette === name;
        row.classList.toggle("is-picked", mine);
        row.setAttribute("aria-selected", String(mine));
      }
      markTabs();
    },
    /** Put the picker up, opened at Popular. */
    start(name) {
      picked = name;
      search.hidden = true;
      fillTabs();
      fillList();
    },
  };
}
