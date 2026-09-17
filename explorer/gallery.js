// The gallery panel: a thousand seated wallpapers, and nothing said about any of them.
//
// The pictures are one published tentative gallery — the seats a curation solve settled
// on, landed here as a staged gallery directory beside the others. What the panel shows
// is the pictures and two rows of filters, and that is deliberate: a tile with a name, a
// score or an id under it is a page asking to be read, and this one is asking to be
// looked at. Everything a tile could say about itself the viewer says better the moment
// it is opened, because then it is saying it about a picture being drawn.
//
// **A tile sets the viewer to that seat's own recipe.** The record carries each seat's
// canonical permalink — built next door by `python -m builder seats`, through this page's
// own `permalink.js` rather than a second URL writer — so opening a tile is parsing a
// link, exactly as arriving on one is. Where the link cannot be the whole picture the row
// says so in `gap`, and the page passes that sentence on rather than quietly drawing
// something close. The tone curve lives on the run's record rather than in the recipe,
// and the link carries it wherever a record holds one.
//
// **The record is committed and the pictures are not.** They are a couple of hundred
// megabytes of JPEG and stay out of git history until this is deployed, so a clone has
// the record and no images. That is a panel that says what is missing, not a page that
// fails to start: the viewer is the page, and the gallery is one of two things the side
// panel can show.

import { colorOf } from "./hues.js";

/** The staged gallery this panel shows, by the slug that is its directory's name. */
const SLUG = "seated-candidates";

/** Where that directory sits, relative to this module. */
const DIRECTORY = `../assets/images/galleries/${SLUG}/`;

/** One JSONL record, as rows. A blank line is nothing and a bad line is worth naming. */
function rowsOf(text, where) {
  const rows = [];
  text.split("\n").forEach((line, index) => {
    const trimmed = line.trim();
    if (trimmed === "") return;
    try {
      rows.push(JSON.parse(trimmed));
    } catch (error) {
      throw new Error(`${where}:${index + 1}: ${error.message}`);
    }
  });
  return rows;
}

/**
 * The gallery's record: its header, and one row per picture in presentation order.
 *
 * **Presentation order, not seat order.** The seating is the solve's rank order, and its
 * strongest rows look alike: opened on `seat`, the panel's first screen was spirals, three
 * of them in one palette. The tentative gallery's own page opens on the permutation
 * `curation.page_order` spreads modes and colours with, and `order` is that permutation,
 * so both pages open on the same tiles. Sorted here rather than trusted to the file, so
 * the field is what is read.
 */
export async function load(base) {
  const url = new URL(`${DIRECTORY}gallery.jsonl`, base);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${SLUG}/gallery.jsonl: ${response.status}`);
  const rows = rowsOf(await response.text(), `${SLUG}/gallery.jsonl`);
  const header = rows[0];
  if (header?.kind !== "gallery") throw new Error(`${SLUG}/gallery.jsonl: no header record`);
  const seats = rows.filter((row) => row.kind === "image");
  seats.sort((a, b) => (a.order ?? Infinity) - (b.order ?? Infinity) || a.seat - b.seat);
  return { header, seats };
}

/** How many seats a value of one field holds, most first, so a chip row reads as a shape. */
function tally(seats, field) {
  const held = new Map();
  for (const seat of seats) {
    const value = seat[field] ?? null;
    held.set(value, (held.get(value) ?? 0) + 1);
  }
  return [...held].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])));
}

/**
 * Build the panel into the elements the page gives it.
 *
 * `onPick` is handed the whole row. What a row means — which of its fields is a link and
 * which is a sentence about what the link cannot carry — is the page's business and not
 * this module's, which knows only how to show pictures and which ones are being asked for.
 */
export function install({ base, modes, hues, tiles, note, onPick }) {
  let seats = [];
  let showing = [];
  const wanted = { mode: new Set(), hue: new Set() };
  let open = null;

  function matches(seat) {
    if (wanted.mode.size > 0 && !wanted.mode.has(seat.mode)) return false;
    if (wanted.hue.size > 0 && !wanted.hue.has(seat.hue ?? null)) return false;
    return true;
  }

  /** Said once, the first time a thumbnail is not there. */
  let landed = true;

  function missing() {
    if (!landed) return;
    landed = false;
    note.textContent =
      `${seats.length} wallpapers, but their pictures could not be loaded here.`;
  }

  function say() {
    if (!landed) return;
    const all = seats.length;
    note.textContent = showing.length === all
      ? `${all} wallpapers from the published gallery.`
      : `${showing.length} of ${all} wallpapers.`;
  }

  function fill() {
    showing = seats.filter(matches);
    const made = showing.map((seat) => {
      const tile = document.createElement("button");
      tile.type = "button";
      tile.className = "tile";
      tile.dataset.key = seat.key;
      if (seat.key === open) tile.classList.add("is-open");
      const picture = document.createElement("img");
      // Native lazy loading rather than an observer of our own: a thousand tiles is
      // exactly the case the attribute exists for, and the browser decides better than a
      // margin somebody guessed at.
      picture.loading = "lazy";
      picture.decoding = "async";
      picture.width = 480;
      picture.height = 270;
      picture.src = new URL(`${DIRECTORY}thumbs/${seat.file}`, base).href;
      picture.alt = seat.alt ?? "";
      // The record commits and the pictures do not, so a tree can hold one without the
      // other: the blob baked, `seats` never run. A thousand broken images is a panel
      // that looks broken rather than one that is unlanded, and the difference is a
      // sentence somebody can act on. Said once, by whichever tile fails first.
      picture.addEventListener("error", missing, { once: true });
      // **Shown when it is whole, and not before.** A browser paints the scanlines of a
      // JPEG it is still receiving, so a grid asking for two hundred thumbnails at once
      // — which is what a reload is here, on a machine with a solve running next door —
      // fills with pictures squashed into bands, and the panel reads as broken rather
      // than as loading. The tile is a dark well until its picture is there.
      if (picture.complete && picture.naturalWidth > 0) tile.classList.add("is-ready");
      else picture.addEventListener("load", () => tile.classList.add("is-ready"), { once: true });
      tile.append(picture);
      tile.addEventListener("click", () => {
        open = seat.key;
        for (const other of tiles.querySelectorAll(".tile")) {
          other.classList.toggle("is-open", other.dataset.key === open);
        }
        onPick(seat);
      });
      return tile;
    });
    tiles.replaceChildren(...made);
    say();
  }

  /** `swatches` marks the color family row, which is also single-choice: choosing a family
   *  lets go of any other, and choosing the one already held clears the row. A mode row
   *  stays a union of whatever is pressed. */
  function chipsInto(host, field, counts, label, swatches = false) {
    host.replaceChildren();
    const chips = [];
    for (const [value, count] of counts) {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "chip";
      chip.setAttribute("aria-pressed", "false");
      // A hue chip wears its family's own colour, which is the codebook's `light_vivid`
      // cell for that hue rather than a colour this page chose. A family the wheel does
      // not name — the four seats filed under nothing — gets the well's neutral, because
      // inventing a thirteenth colour would say the pipeline had an opinion it does not.
      if (swatches) {
        const dot = document.createElement("span");
        dot.className = "hue";
        const color = value === null ? null : colorOf(value);
        if (color !== null) dot.style.background = color;
        else dot.classList.add("is-unfiled");
        chip.append(dot);
      }
      chip.append(value === null ? label : value);
      const tally = document.createElement("span");
      tally.className = "count";
      tally.textContent = count;
      chip.append(tally);
      chip.addEventListener("click", () => {
        const set = wanted[field];
        if (set.has(value)) set.delete(value);
        else {
          if (swatches) set.clear();
          set.add(value);
        }
        for (const [other, held] of chips) other.setAttribute("aria-pressed", String(set.has(held)));
        fill();
      });
      chips.push([chip, value]);
      host.append(chip);
    }
  }

  return {
    /** Put the panel up from the record, or say why there is nothing to show. `record` is
     *  what `load` already answered, where the page asked it first — a failure included,
     *  which is thrown here so that the panel is where it is said. */
    async start(record = null) {
      const answered = record ?? (await load(base));
      if (answered instanceof Error) throw answered;
      const { seats: loaded } = answered;
      seats = loaded;
      chipsInto(modes, "mode", tally(seats, "mode"), "no mode");
      // A seat whose palette the ledger never saw in a picture has no hue family at all.
      // Four of them do, and they get a chip of their own rather than being dropped: a
      // filter that quietly holds back four pictures is worse than one that admits it.
      chipsInto(hues, "hue", tally(seats, "hue"), "unfiled", true);
      fill();
    },
    /** Which seat the viewer is showing, so the grid can mark it. Cleared by any move
     *  that leaves it, because a tile marked open under a picture somebody has since
     *  panned away from is a lie the grid is telling. */
    mark(key) {
      open = key;
      for (const tile of tiles.querySelectorAll(".tile")) {
        tile.classList.toggle("is-open", tile.dataset.key === open);
      }
    },
    /** Say what went wrong where the panel is, rather than on the page. */
    refuse(message) {
      tiles.replaceChildren();
      note.textContent = message;
    },
  };
}
