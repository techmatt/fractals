// The way back through the pictures this session has shown *(explorer_undo_redo_ckpt137)*.
//
// **An entry is a link and nothing else.** A picture's canonical query is already the
// complete state of it — that is what the address bar carries and what Copy link hands
// out — so a step back is the same door as opening a link, and nothing here can drift
// away from either contract. This module holds the list and the cursor; deciding what a
// picture's key is, and how a link is opened again, are the page's.
//
// **Two things a key is for.** A commit that lands on the picture already under the cursor
// *refreshes* it rather than pushing: one action can settle twice — once with the picture
// and once again when the pass has measured its tone — and those are one entry whose link
// is the second, measured one. Everything else pushes, which drops whatever the cursor
// had ahead of it, because a new action after a step back is a new future.
//
// **Bounded and session-only.** Nothing is stored; a reload starts again. The cap evicts
// from the front, which is the end furthest from where anybody is standing.

/** How many pictures the way back holds. Three hundred short strings is nothing to keep,
 *  and it is far more steps than a reader will ever take back at once. */
export const MAX = 300;

/**
 * The list, and the cursor into it.
 *
 * `commit(key, entry)` is called for every picture that settles; `back()` and `forward()`
 * move the cursor and hand back the entry to restore, or `null` at either end. `current`
 * is what the cursor is on, which is what a commit compares against.
 */
export class Trail {
  constructor({ max = MAX } = {}) {
    this.max = max;
    /** `{ key, entry }`, oldest first. */
    this.entries = [];
    /** Where the cursor stands, or `-1` on an empty list. */
    this.at = -1;
  }

  /** The entry the cursor is on, or `null` before anything has been committed. */
  get current() {
    return this.at < 0 ? null : this.entries[this.at].entry;
  }

  /** The key of the entry the cursor is on, or `null`. */
  get currentKey() {
    return this.at < 0 ? null : this.entries[this.at].key;
  }

  get canBack() {
    return this.at > 0;
  }

  get canForward() {
    return this.at >= 0 && this.at < this.entries.length - 1;
  }

  /**
   * A picture settled. Returns `"refreshed"` where it is the one the cursor is already on
   * and `"pushed"` where it is a new one.
   *
   * A refresh keeps the cursor and keeps everything ahead of it, because nothing happened:
   * the same picture said its link again, more completely than the first time.
   *
   * **`replacing` is the key of a picture this one finishes** *(site_audit_ckpt147)*: where
   * the cursor is on that picture, this one takes its place under its own key, and returns
   * `"refreshed"` too. It is for a change the page made to a picture the reader did not ask
   * for separately — the Deep tab's arrival fit, taken again off the finished frame — so a
   * step back goes past both at once. Where the cursor is on anything else, the picture
   * being finished never got an entry of its own, and this is an ordinary commit.
   */
  commit(key, entry, { replacing = null } = {}) {
    if (replacing !== null && this.at >= 0 && this.entries[this.at].key === replacing) {
      this.entries[this.at] = { key, entry };
      return "refreshed";
    }
    if (this.at >= 0 && this.entries[this.at].key === key) {
      this.entries[this.at] = { key, entry };
      return "refreshed";
    }
    this.entries.length = this.at + 1;
    this.entries.push({ key, entry });
    this.at = this.entries.length - 1;
    while (this.entries.length > this.max) {
      this.entries.shift();
      this.at -= 1;
    }
    return "pushed";
  }

  /** One step back, or `null` where the cursor is on the oldest picture. */
  back() {
    if (!this.canBack) return null;
    this.at -= 1;
    return this.current;
  }

  /** One step forward, or `null` where the cursor is on the newest. */
  forward() {
    if (!this.canForward) return null;
    this.at += 1;
    return this.current;
  }
}
