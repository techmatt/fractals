// Dive results *(dive_slots_ckpt154)*: this session's landings, in the Deep tab's lower
// panel under a switch beside its Gallery.
//
// **It replaces Dives**, the Gallery tab collection the landings used to join
// *(keep_diving_ckpt154)*. The Deep tab never showed that collection, so a dive landed where
// its own tab could not see it, and a collection of deep links was a special case in the
// Gallery tab, Browse and the screensaver alike. Here it is the Deep gallery's shape — a tile
// a click opens through the door a deep link comes through — with the newest result in front.
//
// **A landing never switches the panel.** A result that lands while the Gallery is showing
// moves the count on the switch and nothing else; the reader chooses which list is up.
// Nothing of it is stored: a reload is the end of it, and Clear, which asks nothing, is the
// end of it sooner.

import { Results } from "./dives.js";

/**
 * Mount the switch and the results grid.
 *
 * `open(link)` is the page's door for a deep link; `saveMark(link)` is a save mark pointed at
 * one; `copy(link)` puts a link's address on the clipboard and resolves whether it did.
 * Answers `{ add({ link, thumb, said, width, height }), size }`, `thumb` an object URL the
 * list takes over and gives back when it is cleared.
 */
export function mount({ panel, showGallery, showResults, count, clear, grid, note, open, saveMark, copy }) {
  const results = new Results((thumb) => URL.revokeObjectURL(thumb));

  function show(which) {
    const onResults = which === "results";
    panel.classList.toggle("is-results", onResults);
    showGallery.setAttribute("aria-pressed", String(!onResults));
    showResults.setAttribute("aria-pressed", String(onResults));
    clear.hidden = !onResults || results.size === 0;
    panel.scrollTop = 0;
  }

  function sync() {
    count.textContent = String(results.size);
    note.hidden = results.size > 0;
    clear.hidden = !panel.classList.contains("is-results") || results.size === 0;
  }

  function tileOf(row) {
    const cell = document.createElement("div");
    cell.className = "tile-cell dive-result";
    const entry = document.createElement("button");
    entry.type = "button";
    entry.className = "minibrot deep-gallery-tile";
    const well = document.createElement("div");
    well.className = "minibrot-tile";
    const picture = document.createElement("img");
    picture.src = row.thumb;
    picture.width = row.width;
    picture.height = row.height;
    picture.alt = "";
    well.append(picture);
    entry.append(well);
    entry.title = row.said;
    entry.setAttribute("aria-label", row.said);
    entry.addEventListener("click", () => open(row.link));
    const copying = document.createElement("button");
    copying.type = "button";
    copying.className = "dive-copy";
    copying.textContent = "Copy link";
    let timer = 0;
    copying.addEventListener("click", async (event) => {
      event.stopPropagation();
      const done = await copy(row.link);
      clearTimeout(timer);
      copying.textContent = done ? "Copied" : "Could not copy";
      timer = setTimeout(() => {
        copying.textContent = "Copy link";
      }, 1500);
    });
    cell.append(entry, saveMark(row.link), copying);
    return cell;
  }

  showGallery.addEventListener("click", () => show("gallery"));
  showResults.addEventListener("click", () => show("results"));
  clear.addEventListener("click", () => {
    results.clear();
    grid.replaceChildren();
    sync();
  });
  sync();

  return {
    add(landing) {
      const row = results.add(landing);
      grid.prepend(tileOf(row));
      sync();
      return results.size;
    },
    get size() {
      return results.size;
    },
  };
}
