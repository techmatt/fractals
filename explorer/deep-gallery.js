// The Deep tab's gallery *(deep_gallery_build_ckpt144)*: deep frames a click opens.
//
// **The register is `deep-gallery.jsonl`**, one row a frame, `{subject, link}` and nothing
// that can be derived from the link. Rows are grouped by subject in the order each subject
// first appears, so a frame appended anywhere joins its subject's group, and a new subject
// is a new group at the end. `python -m builder deep-gallery thumbs` bakes a tile per row
// into `deep-gallery/`, named by the 64-bit FNV-1a of the row's link, which is `tileName`
// below and `builder/deep_gallery.py`'s `fnv`: one rule for both sides, and nothing about
// the tile is written into the register.
//
// **Always open, the way the Gallery tab is** *(Matt, explorer_nav_layout_ckpt145)*. It was
// a `<details>` folded until a click, and the fold was one more thing between a reader and
// the pictures. The register is fetched when the Deep tab is first mounted, which is when
// it is first wanted, and a tile is a lazy `<img>`, so nothing is drawn off the wire while
// the panel is hidden. A tile is a link and a click is the Deep tab's `open` of it, the door
// a saved deep picture comes through, so the way back returns from it like any other.

import { describe } from "./deep-link.js";

/** The register, beside this module. */
const REGISTER_URL = new URL("./deep-gallery.jsonl", import.meta.url);

/** The tiles, one per row. The size is the builder's `THUMB`. */
const TILES_URL = new URL("./deep-gallery/", import.meta.url);
const TILE = { width: 316, height: 178 };

const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const MASK = (1n << 64n) - 1n;

/** A row's tile file: 64-bit FNV-1a of its link's UTF-8 bytes, as sixteen hex digits. */
export function tileName(link) {
  let hash = FNV_OFFSET;
  for (const byte of new TextEncoder().encode(link)) {
    hash = ((hash ^ BigInt(byte)) * FNV_PRIME) & MASK;
  }
  return `${hash.toString(16).padStart(16, "0")}.webp`;
}

/** The register's rows, refusing a row that is anything but a subject and a deep link. */
export function rowsOf(text) {
  const rows = [];
  for (const [index, line] of text.split("\n").entries()) {
    if (line.trim() === "") continue;
    const row = JSON.parse(line);
    const keys = Object.keys(row).sort().join(",");
    if (keys !== "link,subject" || !String(row.link).startsWith("dv=")) {
      throw new Error(`line ${index + 1} is not a subject and a deep link`);
    }
    rows.push(row);
  }
  return rows;
}

/** Rows by subject, each subject where it first appears. */
export function grouped(rows) {
  const groups = new Map();
  for (const row of rows) {
    if (!groups.has(row.subject)) groups.set(row.subject, []);
    groups.get(row.subject).push(row);
  }
  return groups;
}

/**
 * Mount the gallery, and fetch its register.
 *
 * `open(link)` is the page's door for a deep link; `context` is the deep contract's, which
 * a tile's label is described with.
 */
export function mount({ grid, note, context, open }) {
  let loading = null;

  function load() {
    loading ??= fetch(REGISTER_URL)
      .then((response) => {
        if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
        return response.text();
      })
      .then((text) => {
        const tiles = [];
        for (const [subject, rows] of grouped(rowsOf(text))) {
          const head = document.createElement("h3");
          head.className = "deep-gallery-subject";
          head.textContent = subject;
          tiles.push(head, ...rows.map((row) => tileOf(row)));
        }
        grid.replaceChildren(...tiles);
      })
      .catch((error) => {
        loading = null;
        note.textContent = `The gallery could not be loaded: ${error.message}`;
        note.hidden = false;
      });
    return loading;
  }

  function tileOf(row) {
    const entry = document.createElement("button");
    entry.type = "button";
    entry.className = "minibrot deep-gallery-tile";
    const well = document.createElement("div");
    well.className = "minibrot-tile";
    const picture = document.createElement("img");
    picture.src = new URL(tileName(row.link), TILES_URL).href;
    picture.width = TILE.width;
    picture.height = TILE.height;
    picture.alt = "";
    picture.loading = "lazy";
    well.append(picture);
    entry.append(well);
    let said = row.subject;
    try {
      said = `${row.subject}: ${describe(`?${row.link}`, context).said}`;
    } catch {
      // A row the contract refuses still opens, and says so when it is clicked.
    }
    entry.title = said;
    entry.setAttribute("aria-label", said);
    entry.addEventListener("click", () => open(row.link));
    return entry;
  }

  load();
}
