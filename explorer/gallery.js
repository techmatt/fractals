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
// something close. Most often it is the tone curve: every candidate was made with the
// autolevel operator on, the curve lives on the run's record rather than in the recipe,
// and for the runs that kept no curve there is nothing anybody can replay.
//
// **The record is committed and the pictures are not.** They are a couple of hundred
// megabytes of JPEG and stay out of git history until this is deployed, so a clone has
// the record and no images. That is a panel that says what is missing, not a page that
// fails to start: the viewer is the page, and the gallery is one of two things the side
// panel can show.

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

/** The gallery's record: its header, and one row per picture in the order it seats them. */
export async function load(base) {
  const url = new URL(`${DIRECTORY}gallery.jsonl`, base);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${SLUG}/gallery.jsonl: ${response.status}`);
  const rows = rowsOf(await response.text(), `${SLUG}/gallery.jsonl`);
  const header = rows[0];
  if (header?.kind !== "gallery") throw new Error(`${SLUG}/gallery.jsonl: no header record`);
  return { header, seats: rows.filter((row) => row.kind === "image") };
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

  function say() {
    const all = seats.length;
    note.textContent = showing.length === all
      ? `${all} wallpapers, seated by one solve.`
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

  function chipsInto(host, field, counts, label) {
    host.replaceChildren();
    for (const [value, count] of counts) {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "chip";
      chip.setAttribute("aria-pressed", "false");
      chip.textContent = value === null ? label : value;
      const tally = document.createElement("span");
      tally.className = "count";
      tally.textContent = count;
      chip.append(tally);
      chip.addEventListener("click", () => {
        const set = wanted[field];
        if (set.has(value)) set.delete(value);
        else set.add(value);
        chip.setAttribute("aria-pressed", String(set.has(value)));
        fill();
      });
      host.append(chip);
    }
  }

  return {
    /** Read the record and put the panel up, or say why there is nothing to show. */
    async start() {
      const { seats: loaded } = await load(base);
      seats = loaded;
      chipsInto(modes, "mode", tally(seats, "mode"), "no mode");
      // A seat whose palette the ledger never saw in a picture has no hue family at all.
      // Four of them do, and they get a chip of their own rather than being dropped: a
      // filter that quietly holds back four pictures is worse than one that admits it.
      chipsInto(hues, "hue", tally(seats, "hue"), "unfiled");
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
