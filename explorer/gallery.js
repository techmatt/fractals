// The gallery panel: thousands of seated wallpapers, one collection at a time, and nothing
// said about any of them.
//
// The pictures are the curation passes' tentative galleries — the general one, published,
// and a collection per hue family and per mode — landed here as one staged gallery
// directory beside the others. What the panel shows is the pictures, a dropdown of
// collections and two rows of filters, and that is deliberate: a tile with a name, a score
// or an id under it is a page asking to be read, and this one is asking to be looked at.
// Everything a tile could say about itself the viewer says better the moment it is opened,
// because then it is saying it about a picture being drawn.
//
// **A tile sets the viewer to that seat's own recipe.** The record carries each seat's
// canonical permalink — built next door by `python -m builder seats`, through this page's
// own `permalink.js` rather than a second URL writer — so opening a tile is parsing a
// link, exactly as arriving on one is. Where the link cannot be the whole picture the row
// says so in `gap`, and the page passes that sentence on rather than quietly drawing
// something close. The tone curve lives on the run's record rather than in the recipe,
// and the link carries it wherever a record holds one.
//
// **And the filters are a question asked of the collection.** The mode row tallies what
// drew each picture wherever it stands, but the hue row changes what it is asking: in the
// general gallery and the mode collections it tallies which family leads a picture, and
// inside a collection cut on one family — where every seat leads in that family already —
// it drops that family and tallies what each picture *also* contains. The record carries
// both readings, and `builder/seats.py` says at what bar a picture contains a hue.
//
// **A header, and a file per collection** *(explorer_slim_ckpt131)*. `gallery.jsonl` is
// the header alone: the collections, each naming its own file, and the modes the
// published one seats, which is all the Mode select needs and all the page waits for
// before its first frame. A collection's rows are fetched the first time the panel shows
// it and kept, so the general gallery costs about 115 KB of rows where the union cost
// 605 KB, and choosing a collection already shown fetches nothing. The collections
// overlap, so a seat is a row in each file that seats it, and each row's `collections`
// still maps every collection it stands in to its place there. A picture shared by two
// collections is one tile URL, so it is one download however often it is shown.
//
// **The record is committed and the pictures are not.** They are tens of megabytes of
// tiles and stay out of git history until this is deployed, so a clone has the record and
// no images. That is a panel that says what is missing, not a page that fails to start:
// the viewer is the page, and the gallery is one of two things the side panel can show.

import { colorOf } from "./hues.js";

/** The staged gallery this panel shows, by the slug that is its directory's name. */
const SLUG = "seated-candidates";

/** Where that directory sits, relative to this module. */
const DIRECTORY = `../assets/images/galleries/${SLUG}/`;

/** The collection the panel opens on, which is the published gallery. */
export const GENERAL = "general";

/** What the dropdown groups each axis under. The general collection stands alone. */
const AXIS_LABELS = { family: "Color family", mode: "Mode" };

/** The axis a collection cut on one hue family is named by, which is the one the hue chips
 *  change their question inside. */
const FAMILY_AXIS = "family";

/** What the hue row is called when it tallies which family leads each picture, and what it
 *  is called when it tallies which families are merely in one. */
const HUE_HEADS = { dominant: "Color family", contains: "Also contains" };

/**
 * Whether this browser lets a stylesheet draw a `<select>` and its drop-down, which is
 * what allows a colour dot inside an option.
 *
 * It gates the two pieces of markup that only mean anything under base appearance — the
 * button the closed control becomes, and the `<legend>` a group heading is spelled with
 * there — so a browser without it gets the options it gets today and nothing extra in the
 * shadow of a control it draws itself. The dots go on either way: an empty span carries no
 * text into an option's label, and the option's value is set rather than read off it.
 */
const DRAWN = typeof CSS !== "undefined" && CSS.supports("appearance", "base-select");

/**
 * The dot that shows a family's own colour — the codebook's `light_vivid` cell for that
 * hue, by way of `hues.js`, which is the one source both the chips and the dropdown read.
 *
 * **The colour goes on as a custom property rather than as a background.** The closed
 * select shows a *clone* of the chosen option's content, and what survives the clone is
 * the style attribute; a rule in the stylesheet supplies the shape and this supplies the
 * one thing that differs per family. A family the wheel does not name draws neutral.
 */
function hueDot(value) {
  const dot = document.createElement("span");
  dot.className = "hue";
  const color = value === null ? null : colorOf(value);
  if (color !== null) dot.style.setProperty("--c", color);
  else dot.classList.add("is-unfiled");
  return dot;
}

/**
 * How far past the visible tiles a picture is asked for, as a share of the panel's height.
 * Enough that a steady scroll meets pictures already there, and little enough that a
 * visitor who opens the panel and looks at the first screen downloads about that screen.
 */
const AHEAD = "50%";

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

/** One file of the gallery's directory, as rows. */
async function fetchRows(base, file) {
  const response = await fetch(new URL(`${DIRECTORY}${file}`, base));
  if (!response.ok) throw new Error(`${SLUG}/${file}: ${response.status}`);
  return rowsOf(await response.text(), `${SLUG}/${file}`);
}

/**
 * The gallery's header: its collections in dropdown order, each naming the file its rows
 * are in, and `modes`, the modes the published collection seats. A few kilobytes, which is
 * why the page can wait for it before its first frame.
 */
export async function load(base) {
  const [header] = await fetchRows(base, "gallery.jsonl");
  if (header?.kind !== "gallery") throw new Error(`${SLUG}/gallery.jsonl: no header record`);
  if (!Array.isArray(header.collections) || header.collections.length === 0) {
    throw new Error(`${SLUG}/gallery.jsonl: the header names no collections`);
  }
  return { header, collections: header.collections, modes: header.modes ?? null };
}

/**
 * One collection's seats, from its own file.
 *
 * **Presentation order, not seat order.** A solve's seating is its rank order, and its
 * strongest rows look alike: opened on it, the panel's first screen was spirals, three of
 * them in one palette. Each tentative gallery's own page opens on the permutation
 * `curation.page_order` spreads modes and colours with, and a row's place in a collection
 * is that permutation, so both pages open on the same tiles.
 */
async function seatsOf(base, collection) {
  const seats = (await fetchRows(base, collection.file)).filter((row) => row.kind === "image");
  for (const seat of seats) {
    if (seat.collections === null || typeof seat.collections !== "object") {
      throw new Error(`${SLUG}/${collection.file}: ${seat.key} belongs to no collection`);
    }
  }
  return seats;
}

/** One collection's seats, in its own presentation order. Sorted here rather than trusted
 *  to the file, so the field is what is read. */
export function membersOf(seats, name) {
  return seats
    .filter((seat) => Object.hasOwn(seat.collections, name))
    .sort((a, b) => a.collections[name] - b.collections[name]);
}

/**
 * How many seats a value of one field holds, most first, so a chip row reads as a shape.
 *
 * `first` is a value pinned to the head of the row whatever its count, which is the page's
 * to name: the mode the article teaches first heads the chips as it heads the Mode select,
 * and a collection where it is the fourth-largest is not a collection where it moves.
 * Nothing pinned is `undefined` rather than `null`, because `null` is a value a chip row
 * really holds — the seats filed under no hue — and pinning it was this row opening on
 * *unfiled 4*.
 */
function tally(seats, field, first = undefined) {
  const held = new Map();
  for (const seat of seats) {
    const value = seat[field] ?? null;
    held.set(value, (held.get(value) ?? 0) + 1);
  }
  return [...held].sort(
    (a, b) =>
      Number(b[0] === first) - Number(a[0] === first) ||
      b[1] - a[1] ||
      String(a[0]).localeCompare(String(b[0])),
  );
}

/**
 * Build the panel into the elements the page gives it.
 *
 * `onPick` is handed the whole row. What a row means — which of its fields is a link and
 * which is a sentence about what the link cannot carry — is the page's business and not
 * this module's, which knows only how to show pictures and which ones are being asked for.
 */
export function install({
  base,
  collection,
  modes,
  hues,
  hueHead,
  tiles,
  note,
  firstMode = undefined,
  onPick,
  saveMark = null,
  onSeats = () => {},
}) {
  /** Each collection's rows once asked for, by name: a promise, so two quick choices of
   *  one collection are one fetch. */
  const fetched = new Map();
  /** Which choice is the latest, so a slow fetch cannot put up a collection since left. */
  let asked = 0;
  let collections = [];
  let chosen = GENERAL;
  let members = [];
  let showing = [];
  const wanted = { mode: new Set(), hue: new Set() };
  let open = null;
  let observer = null;

  /**
   * The family this collection was cut on, where it was cut on one, which is what turns
   * the hue row from a reading into a question.
   *
   * **Inside a colour collection, "which family leads this picture" is the wrong
   * question.** Every seat of the green collection is a green picture, so a row of
   * dominant-hue chips there said green 252, teal 31, lime 12 — a tally of which
   * green-ish cell happened to lead each one, which is a fact about the codebook's
   * boundaries and not about anything a reader can see. What is worth asking of a shelf of
   * green pictures is what *else* is in them, so the row drops the collection's own hue
   * and every other chip counts the seats whose picture contains that family at all.
   */
  let cutOn = null;

  function matches(seat) {
    if (wanted.mode.size > 0 && !wanted.mode.has(seat.mode)) return false;
    if (wanted.hue.size === 0) return true;
    if (cutOn === null) return wanted.hue.has(seat.hue ?? null);
    return (seat.hues ?? []).some((name) => wanted.hue.has(name));
  }

  /** Said once, the first time a tile is not there. */
  let landed = true;

  function missing() {
    if (!landed) return;
    landed = false;
    note.textContent =
      `${members.length} wallpapers, but their pictures could not be loaded here.`;
  }

  /**
   * What the footer says, which is nothing unless a chip is narrowing the grid.
   *
   * **The collection says its own size.** The dropdown's option reads *General gallery ·
   * 1000*, so a footer saying *1000 wallpapers in the general gallery* under the tiles was
   * the same sentence twice, and it cost a line of the panel on every collection whether
   * or not anything was being filtered. What the dropdown cannot say is what the chips
   * have done to it, so that is the whole of what is left here.
   */
  function say() {
    if (!landed) return;
    const filtering = wanted.mode.size > 0 || wanted.hue.size > 0;
    note.textContent = filtering ? `${showing.length} of ${members.length}` : "";
  }

  /**
   * **A tile asks for its picture when it comes near the panel's window, and not before.**
   * Native lazy loading reaches thousands of pixels ahead of the viewport, which in a
   * side panel of three-to-a-row tiles is dozens of pictures nobody scrolled to, so the
   * source waits on an observer of the scroll box. The box is the tile grid where the
   * panels sit side by side and the page where they stack, and the observer is made again
   * on each fill, which is when the grid's contents change.
   */
  function watch() {
    observer?.disconnect();
    const scrolls = getComputedStyle(tiles).overflowY !== "visible";
    observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const picture = entry.target.querySelector("img");
          if (picture && !picture.src) picture.src = picture.dataset.src;
          observer.unobserve(entry.target);
        }
      },
      { root: scrolls ? tiles : null, rootMargin: `${AHEAD} 0px` },
    );
    for (const tile of tiles.querySelectorAll(".tile")) observer.observe(tile);
  }

  function fill() {
    showing = members.filter(matches);
    const made = showing.map((seat) => {
      const tile = document.createElement("button");
      tile.type = "button";
      tile.className = "tile";
      tile.dataset.key = seat.key;
      if (seat.key === open) tile.classList.add("is-open");
      const picture = document.createElement("img");
      picture.decoding = "async";
      picture.width = seat.width;
      picture.height = seat.height;
      picture.dataset.src = new URL(`${DIRECTORY}${seat.file}`, base).href;
      picture.alt = seat.alt ?? "";
      // The record commits and the pictures do not, so a tree can hold one without the
      // other: the record written, `seats` never run here. A grid of broken images is a
      // panel that looks broken rather than one that is unlanded, and the difference is a
      // sentence somebody can act on. Said once, by whichever tile fails first.
      picture.addEventListener("error", missing, { once: true });
      // **Shown when it is whole, and not before.** A browser paints the part of a picture
      // it has received, so a grid asking for a screen of tiles at once fills with
      // pictures cut into bands, and the panel reads as broken rather than as loading.
      // The tile is a dark well until its picture is there.
      picture.addEventListener("load", () => tile.classList.add("is-ready"), { once: true });
      tile.append(picture);
      tile.addEventListener("click", () => {
        open = seat.key;
        for (const other of tiles.querySelectorAll(".tile")) {
          other.classList.toggle("is-open", other.dataset.key === open);
        }
        onPick(seat);
      });
      if (saveMark === null) return tile;
      // A save mark is a button of its own, so it sits beside the tile rather than in it
      // *(saved_tab_ckpt131)*: a button inside a button is not a thing a page may hold.
      const cell = document.createElement("div");
      cell.className = "tile-cell";
      cell.append(tile, saveMark(seat));
      return cell;
    });
    tiles.replaceChildren(...made);
    tiles.scrollTop = 0;
    watch();
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
      chip.setAttribute("aria-pressed", String(wanted[field].has(value)));
      // A hue chip wears its family's own colour, ahead of its name, and so does the
      // dropdown entry for that family's own gallery: one dot, `hueDot` above.
      if (swatches) chip.append(hueDot(value));
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

  /**
   * How many seats contain each family other than the one this collection was cut on,
   * most first, which is what the row means where a collection has a hue of its own.
   *
   * A seat stands under every chip its picture carries, so the counts are not a partition
   * of the collection and are not meant to be read as one; what the record calls contained
   * is a low bar it names, and `seats.py` says which and why.
   */
  function presence(seats, except) {
    const held = new Map();
    for (const seat of seats) {
      for (const name of seat.hues ?? []) {
        if (name === except) continue;
        held.set(name, (held.get(name) ?? 0) + 1);
      }
    }
    return [...held].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])));
  }

  /**
   * Show one collection: its members, the chips they tally to, and the grid.
   *
   * **Choosing a collection lets go of every chip.** A filter is a question asked of the
   * collection, and carrying one across the switch answers the new collection's question
   * with the old one's words: the hue row is a different question either side of a colour
   * collection, and a mode chip held over from the general gallery lands the viewer on a
   * shelf already narrowed by a choice made somewhere else. What the dropdown promises is
   * that collection, so that collection is what arrives.
   */
  async function choose(name) {
    chosen = collections.some((one) => one.name === name) ? name : GENERAL;
    collection.value = chosen;
    const mine = ++asked;
    const one = collections.find((each) => each.name === chosen);
    const named = chosen;
    if (!fetched.has(named)) {
      const rows = seatsOf(base, one);
      fetched.set(named, rows);
      // Forgotten again if it fails, so that choosing it later asks again.
      rows.then(
        (seats) => onSeats(seats, named),
        () => fetched.delete(named),
      );
    }
    let seats;
    try {
      seats = await fetched.get(chosen);
    } catch (error) {
      if (mine !== asked) return;
      console.warn(`the ${chosen} collection could not be read`, error);
      tiles.replaceChildren();
      note.textContent = "This collection could not be loaded.";
      return;
    }
    if (mine !== asked) return;
    wanted.mode.clear();
    wanted.hue.clear();
    cutOn = one?.axis === FAMILY_AXIS ? chosen : null;
    members = membersOf(seats, chosen);
    chipsInto(modes, "mode", tally(members, "mode", firstMode), "no mode");
    if (hueHead) hueHead.textContent = cutOn === null ? HUE_HEADS.dominant : HUE_HEADS.contains;
    // A seat whose palette the ledger never saw in a picture has no hue family at all.
    // Those get a chip of their own rather than being dropped: a filter that quietly holds
    // back pictures is worse than one that admits it. There is no such chip in a colour
    // collection, where the row is asking what a picture contains and the answer for a
    // picture that contains nothing else is simply no chip.
    chipsInto(
      hues,
      "hue",
      cutOn === null ? tally(members, "hue") : presence(members, cutOn),
      "unfiled",
      true,
    );
    fill();
  }

  /**
   * The dropdown, from the header's own list and in its order. A dropdown rather than a
   * chip row, because the chips below it filter and this chooses what is being filtered:
   * the palette picker's hue chips already mean "narrow this list", and a collection is
   * not that.
   */
  function options() {
    collection.replaceChildren();
    // Base appearance draws the closed control from this button, and what it puts in it is
    // a clone of the chosen option — the dot with it, so the control shows the colour it
    // is showing a gallery of. A browser drawing its own control never sees this.
    if (DRAWN) {
      const shown = document.createElement("button");
      shown.type = "button";
      shown.append(document.createElement("selectedcontent"));
      collection.append(shown);
    }
    const groups = new Map();
    for (const one of collections) {
      const option = document.createElement("option");
      option.value = one.name;
      const count = one.seats;
      // A collection cut on one family wears that family's dot — the same span, the same
      // colour and the same source as the chip that filters on it, so the dropdown and the
      // row below it agree about what green looks like. The general gallery and the modes
      // are not colours and get none.
      if (one.axis === FAMILY_AXIS) option.append(hueDot(one.name));
      option.append(
        one.name === GENERAL ? `General gallery · ${count}` : `${one.name} · ${count}`,
      );
      const label = AXIS_LABELS[one.axis];
      if (label === undefined) {
        collection.append(option);
        continue;
      }
      if (!groups.has(label)) {
        const group = document.createElement("optgroup");
        // The heading is spelled twice and each browser reads one of them: the `label`
        // attribute is what a browser drawing its own drop-down shows, and base appearance
        // shows none of it and renders a `<legend>` child instead.
        group.label = label;
        if (DRAWN) {
          const heading = document.createElement("legend");
          heading.textContent = label;
          group.append(heading);
        }
        groups.set(label, group);
        collection.append(group);
      }
      groups.get(label).append(option);
    }
  }

  return {
    /** Put the panel up from the header, or say why there is nothing to show. `record` is
     *  what `load` already answered, where the page asked it first — a failure included,
     *  which is thrown here so that the panel is where it is said. The general
     *  collection's rows are fetched here, which is after the first frame. */
    async start(record = null) {
      const answered = record ?? (await load(base));
      if (answered instanceof Error) throw answered;
      collections = answered.collections;
      options();
      collection.addEventListener("change", () => choose(collection.value));
      await choose(GENERAL);
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
