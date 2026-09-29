// Random dives *(random_dives_ckpt155)*: a thousand landings of the Dive block's mixture, the
// third list under the Deep tab's switch.
//
// **The record is `random-dives.jsonl`**, one `{link}` a dive, and its tiles are baked into
// `random-dives/` by `python -m builder random-dives`, named by the same FNV-1a of the link as
// the Deep gallery's (`deep-gallery.js`'s `tileName`). No full-size picture is stored: a tile
// opens its link through the door a Gallery tile does, and the tab draws the frame.
//
// **Shuffled once a page, and fixed for it.** The order is drawn when the record first loads,
// which is when the list is first shown, and it stays for as long as the page does, so a dive
// a reader has scrolled past is where they left it when they come back. **One grid, and no
// More button**: every tile is a lazy `<img>`, so what is off-screen stays off the wire.

import { describe } from "./deep-link.js";
import { tileName } from "./deep-gallery.js";

const RECORD_URL = new URL("./random-dives.jsonl", import.meta.url);
const TILES_URL = new URL("./random-dives/", import.meta.url);
/** The builder's `THUMB`, the Deep gallery's tile. */
const TILE = { width: 316, height: 178 };

/** The record's rows, refusing a row that is anything but a deep link. */
export function rowsOf(text) {
  const rows = [];
  for (const [index, line] of text.split("\n").entries()) {
    if (line.trim() === "") continue;
    const row = JSON.parse(line);
    if (Object.keys(row).join(",") !== "link" || !String(row.link).startsWith("dv=")) {
      throw new Error(`line ${index + 1} is not a deep link`);
    }
    rows.push(row);
  }
  return rows;
}

/** `rows` in a fresh order: Fisher–Yates over `random`, a copy, the rows untouched. */
export function shuffled(rows, random = Math.random) {
  const out = [...rows];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Mount the list. Nothing is fetched until `load()`, which the switch calls the first time
 * it shows Random dives. `open(link)` is the page's door for a deep link; `context` is the
 * deep contract's, which a tile's label is described with.
 */
export function mount({ grid, note, context, open }) {
  let loading = null;

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
    picture.decoding = "async";
    well.append(picture);
    entry.append(well);
    let said = "Random dive";
    try {
      said = `Random dive: ${describe(`?${row.link}`, context).said}`;
    } catch {
      // A row the contract refuses still opens, and says so when it is clicked.
    }
    entry.title = said;
    entry.setAttribute("aria-label", said);
    entry.addEventListener("click", () => open(row.link));
    return entry;
  }

  function load() {
    loading ??= fetch(RECORD_URL)
      .then((response) => {
        if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
        return response.text();
      })
      .then((text) => {
        grid.replaceChildren(...shuffled(rowsOf(text)).map(tileOf));
        note.hidden = true;
      })
      .catch((error) => {
        loading = null;
        note.textContent = `Random dives could not be loaded: ${error.message}`;
        note.hidden = false;
      });
    return loading;
  }

  return { load };
}
