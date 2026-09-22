// The visitor's own list of pictures, kept in this browser *(saved_tab_ckpt131)*.
//
// **A saved picture is a permalink and nothing else.** No pixel is stored: the Saved tab
// draws each one again from its link, the way every picture on this page is drawn, and a
// link is a few hundred characters where a thumbnail would be tens of kilobytes. So the
// whole list is one `localStorage` value, `{ v, items: [{ link, added }] }`, written on
// every change and read at boot. Nothing leaves the browser and nothing needs a server.
//
// **Keyed by the canonical link.** The same picture arrives here spelled several ways — a
// gallery row's link as the builder wrote it, an atlas slot's as the frame derived it, the
// viewer's as it emits one — so every link is parsed and emitted again through the
// contract before it is compared or stored. Saving is idempotent on that string, and a
// mark on a tile anywhere on the page asks the same question of it.
//
// **Tolerant, never throwing.** A missing key, a value some other version wrote, a
// private window whose storage throws on access: each reads as an empty list, and a write
// that fails (the quota, or storage switched off) keeps the list in memory and says so,
// rather than taking the page down over furniture.
//
// Nothing here touches the DOM at import, so the store runs under node's own test runner
// against a storage shim; `mark` is the one function that builds an element, and only
// when it is called.

/** The one key, spelled with the site's name because the github.io origin is shared by
 *  every project page under it. */
export const KEY = "fractal-website.explorer.saved";

/** The schema's version. A value carrying another reads as empty rather than guessed at. */
export const VERSION = 1;

/** The most pictures the list holds. A link is at most a few hundred characters, so five
 *  thousand of them is under two million, well inside the five-million-character quota a
 *  browser gives an origin; a list that reaches it is told so, and nothing is evicted. */
export const MAX = 5000;

/** The items of a stored value, or `[]` for anything that is not one. */
export function decode(text) {
  if (typeof text !== "string" || text === "") return [];
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    return [];
  }
  if (value === null || typeof value !== "object" || value.v !== VERSION) return [];
  if (!Array.isArray(value.items)) return [];
  const seen = new Set();
  const items = [];
  for (const item of value.items) {
    if (item === null || typeof item !== "object" || typeof item.link !== "string") continue;
    if (item.link === "" || seen.has(item.link)) continue;
    seen.add(item.link);
    items.push({ link: item.link, added: typeof item.added === "string" ? item.added : "" });
    if (items.length >= MAX) break;
  }
  return items;
}

/** A list as the value it is stored as. */
export function encode(items) {
  return JSON.stringify({ v: VERSION, items: items.map(({ link, added }) => ({ link, added })) });
}

/**
 * What an import holds, as `[{ link, added }]` with the links still raw: a file this page
 * exported, a bare JSON array of links or of `{ link }`, or text with one link to a line —
 * a full explorer URL, or the query alone with or without its `?`. `added` is kept where
 * the import carries one and is `null` where it does not.
 */
export function parseImport(text) {
  const trimmed = String(text ?? "").trim();
  if (trimmed === "") return [];
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const value = JSON.parse(trimmed);
      const list = Array.isArray(value) ? value : Array.isArray(value?.items) ? value.items : null;
      if (list !== null) {
        return list
          .map((item) =>
            typeof item === "string"
              ? { link: queryOf(item), added: null }
              : item !== null && typeof item === "object" && typeof item.link === "string"
                ? { link: queryOf(item.link), added: typeof item.added === "string" ? item.added : null }
                : { link: "", added: null },
          );
      }
    } catch {
      // Not JSON after all: read it as lines.
    }
  }
  return trimmed
    .split(/\s+/)
    .filter((token) => token !== "")
    .map((token) => ({ link: queryOf(token), added: null }));
}

/** The query of a link however it was written: a whole URL, `?…`, or the bare query. The
 *  fragment goes, because the explorer's links carry none. */
export function queryOf(text) {
  let query = String(text).trim();
  const hash = query.indexOf("#");
  if (hash >= 0) query = query.slice(0, hash);
  const mark = query.indexOf("?");
  if (mark >= 0) query = query.slice(mark + 1);
  return query;
}

/**
 * The list, in memory, mirrored to storage.
 *
 * `canonical(query)` is the contract's round trip, returning the canonical query or `null`
 * for a string that is not a link this page can open. `storage` is `localStorage` in the
 * page and a shim under test; `now` gives the time an item is stamped with; `persist` is
 * asked once, on the first save of the page's life.
 */
export class Saved {
  constructor({ storage, canonical, now = () => new Date().toISOString(), persist = () => {} }) {
    this.storage = storage;
    this.canonical = (query) => {
      try {
        return canonical(query);
      } catch {
        return null;
      }
    };
    this.now = now;
    this.persist = persist;
    this.persisted = false;
    /** Why the last write failed, or `null` while the list is where it should be. */
    this.failed = null;
    this.listeners = new Set();
    this.items = [];
    this.index = new Set();
    this.reload();
  }

  /** Read the list again from storage, as at boot or after another tab wrote it. */
  reload() {
    let text = null;
    try {
      text = this.storage?.getItem(KEY) ?? null;
    } catch {
      text = null;
    }
    this.items = decode(text);
    this.index = new Set(this.items.map((item) => item.link));
    this.#tell();
  }

  get size() {
    return this.items.length;
  }

  get full() {
    return this.items.length >= MAX;
  }

  /** Whether a canonical link is saved. */
  has(key) {
    return key !== null && this.index.has(key);
  }

  /** Save one link, newest first. `added`, `already`, `full`, or `refused` for a string
   *  that is not a link. */
  add(query) {
    const key = this.canonical(query);
    if (key === null) return "refused";
    if (this.index.has(key)) return "already";
    if (this.full) return "full";
    this.items.unshift({ link: key, added: this.now() });
    this.index.add(key);
    this.#firstSave();
    this.#write();
    return "added";
  }

  /** Remove one link, by any spelling of it. */
  remove(query) {
    const key = this.canonical(query) ?? query;
    if (!this.index.has(key)) return false;
    this.items = this.items.filter((item) => item.link !== key);
    this.index.delete(key);
    this.#write();
    return true;
  }

  /** Saved becomes unsaved and the other way round: what a mark does when it is pressed. */
  toggle(query) {
    const key = this.canonical(query);
    if (key === null) return "refused";
    if (this.index.has(key)) {
      this.remove(key);
      return "removed";
    }
    return this.add(key);
  }

  clear() {
    if (this.items.length === 0) return;
    this.items = [];
    this.index.clear();
    this.#write();
  }

  /**
   * Add many links at once, as an import does, and write once.
   * `entries` is `[{ link, added }]` in the order they should end up in, newest first; an
   * entry without a time is stamped now. Returns `{ added, already, refused, full }`.
   */
  merge(entries) {
    const tally = { added: 0, already: 0, refused: 0, full: 0 };
    const fresh = [];
    const stamp = this.now();
    for (const entry of entries) {
      const key = this.canonical(entry.link);
      if (key === null) {
        tally.refused += 1;
      } else if (this.index.has(key)) {
        tally.already += 1;
      } else if (this.items.length + fresh.length >= MAX) {
        tally.full += 1;
      } else {
        this.index.add(key);
        fresh.push({ link: key, added: entry.added ?? stamp });
        tally.added += 1;
      }
    }
    if (fresh.length > 0) {
      // Newest first by the time each carries; the sort is stable, so a batch stamped
      // alike keeps the order it arrived in, ahead of everything saved before it.
      this.items = [...fresh, ...this.items].sort((a, b) =>
        a.added < b.added ? 1 : a.added > b.added ? -1 : 0,
      );
      this.#firstSave();
      this.#write();
    }
    return tally;
  }

  /** The list as a file this page can import again. */
  exported() {
    return JSON.stringify({ v: VERSION, items: this.items }, null, 1);
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  #firstSave() {
    if (this.persisted) return;
    this.persisted = true;
    try {
      this.persist();
    } catch {
      // A browser that will not say is a browser that keeps the default, which is fine.
    }
  }

  #write() {
    try {
      this.storage.setItem(KEY, encode(this.items));
      this.failed = null;
    } catch (error) {
      this.failed = error?.name === "QuotaExceededError"
        ? "This browser's storage is full, so the latest change is kept only until the page is closed."
        : "This browser would not store the list, so it is kept only until the page is closed.";
    }
    this.#tell();
  }

  #tell() {
    for (const listener of this.listeners) listener(this);
  }
}

/** A bookmark, drawn in the ink it sits on: hollow until the picture is saved. */
const GLYPH =
  '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
  '<path d="M6.5 3.5h11v17l-5.5-4.2-5.5 4.2z"/></svg>';

/**
 * A save mark: a small button that saves or unsaves one picture, and wears its state.
 *
 * Every mark on the page is one of these, and every mark carries its canonical link in
 * `data-key`, so `remark` puts them all right with one query of the document whenever the
 * list changes — no mark keeps a listener that would outlive its tile. `key` may be `null`
 * (an atlas slot showing nothing), which hides the mark.
 */
export function mark(saved, key = null) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "save-mark";
  button.innerHTML = GLYPH;
  button.addEventListener("click", (event) => {
    // A mark sits on a tile that opens its picture; saving is not opening.
    event.stopPropagation();
    const now = button.dataset.key;
    if (!now) return;
    const answer = saved.toggle(now);
    if (answer === "full") button.title = `Saved is full at ${MAX} pictures. Remove some to save more.`;
  });
  point(saved, button, key);
  return button;
}

/** Point a mark at another picture, or at none. */
export function point(saved, button, key) {
  if (key === null) {
    delete button.dataset.key;
    button.hidden = true;
    return;
  }
  button.dataset.key = key;
  button.hidden = false;
  dress(saved, button);
}

/** A mark's pressed state and the words that go with it. */
function dress(saved, button) {
  const on = saved.has(button.dataset.key ?? null);
  button.setAttribute("aria-pressed", String(on));
  const said = on ? "Saved. Press to remove it from Saved." : "Save this picture";
  button.title = said;
  button.setAttribute("aria-label", said);
}

/** Every mark on the page, dressed for the list as it now is. */
export function remark(saved, root = document) {
  for (const button of root.querySelectorAll(".save-mark[data-key]")) dress(saved, button);
}
