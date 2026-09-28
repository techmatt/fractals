// The Dive block's rules, and Dive results *(keep_diving_ckpt154; two slots since
// dive_slots_ckpt154)*.
//
// **The block is two frames and an action.** *Search for minibrots near [A], then [dive into
// [B] | zoom out to symmetry point | save those minibrots]*. A is where the search runs: the
// view (live until Here pins it), a pasted link, or a random wallpaper. B is what a dive
// carries into the copy it finds: nothing (its centre), a pinned view, a pasted link, or a
// random wallpaper. What this module holds is the part with no page in it — which sentences
// descend, which may loop, what a press's outcome means for the next, how a pasted text is
// read, and the list the results collect in — and `deep.js`'s *the dive* runs it.
//
// **Dive results is this session's landings**, newest first, in the Deep tab under a switch
// beside its Gallery. Nothing of it is written anywhere: a reload is the end of it, and Clear
// is the end of it sooner.

/** How long a landing of the descending loop stays on screen, whole, before the next press
 *  starts: long enough to see the picture the press drew, and short enough that a chain of
 *  ten is a minute. A loop drawing off-screen has nothing on screen to hold. */
export const HOLD_MS = 2000;

/** How many presses in a row may draw random wallpapers and land nowhere before the loop
 *  says so and stops. Each press already retries its draw; this is what keeps a plane whose
 *  wallpapers all refuse from searching for ever. */
export const DRY_PRESSES = 3;

/** The size a result's tile is kept at, which is the Deep gallery's own. */
export const TILE_WIDTH = 316;

/**
 * **How many copies _save those minibrots_ keeps** from one search: the largest, each framed
 * at its centre. Eight is two rows of the results grid, and past the eighth the copies a
 * search returns are small enough that most of them are the same shape at the same depth.
 */
export const SAVE_COUNT = 8;

/** The A slot's modes, and the B slot's, in the order their buttons stand. */
export const A_MODES = ["here", "paste", "random"];
export const B_MODES = ["none", "here", "paste", "random"];

/** Whether A follows the view: *Here*, not yet pinned. */
export function live(a) {
  return a.mode === "here" && !a.pinned;
}

/**
 * Whether a sentence descends: A live, and a landing centred on the copy it found — *dive
 * into* with B on *None*, or *zoom out to symmetry point*. Each press then starts from the
 * last landing, so pressing Go again goes a rung further down, and Keep diving on it follows
 * each landing on screen.
 */
export function chains(a, action, b) {
  return live(a) && (action === "halfway" || (action === "into" && b.mode === "none"));
}

/** Whether a press draws something afresh: a slot on *Random* that the action reads. */
export function draws(a, action, b) {
  return a.mode === "random" || (action === "into" && b.mode === "random");
}

/**
 * Whether Keep diving may run: only where the next press can be another picture than this
 * one — a random draw, or the descent. Anything else would land on the same frame every time.
 */
export function keepable(a, action, b) {
  return draws(a, action, b) || chains(a, action, b);
}

/** Why Keep diving is unavailable, as its title says it, or `null`. */
export function keepBarred(a, action, b) {
  if (keepable(a, action, b)) return null;
  return (
    "Keep diving needs something to change between dives: a slot on Random, or A on Here " +
    "(following the view) with B on None, which descends."
  );
}

/** What the status line says once a loop drawing off-screen has landed a round: the loop's
 *  own count and the results', which Go adds to as well. `saved` is a batch's size. */
export function landedSaid(landings, results, saved = null) {
  const head = saved === null ? `Dive ${landings} landed` : `Round ${landings} saved ${saved}`;
  return results == null ? `${head}.` : `${head}; Dive results · ${results}.`;
}

/**
 * What the loop does after one press, from what the press answered.
 *
 * `outcome` is `deep.js`'s `dive()`: `{ landed, complete }` where it landed, `{ refused,
 * random, permanent }` where it did not, `{ barred }` where it could not start, `{ error }`
 * where it threw, and `{ superseded }` where something else took the tab over — a Cancel, a
 * link, the way back, a moved view. `dry` is how many presses in a row have landed nowhere
 * before this one. `aside` is whether the loop draws off-screen, which has no landing on
 * screen to hold.
 *
 * Answers `{ go: true, hold }` to press again, holding the landing first where there is one,
 * or `{ stop: sentence }`, which is what the status line says.
 */
export function loopStep(outcome, dry = 0, { aside = false } = {}) {
  if (outcome.superseded) return { stop: "Keep diving stopped." };
  if (outcome.barred !== undefined) return { stop: `Keep diving stopped. ${outcome.barred}` };
  if (outcome.error !== undefined) return { stop: `Keep diving stopped. ${outcome.error}` };
  if (outcome.landed) {
    if (!outcome.complete) return { stop: "Keep diving stopped: the landing was not drawn to the end." };
    return { go: true, hold: !aside };
  }
  // **A chain runs out where the copy is this view's to find.** Near a random wallpaper, a
  // press that found nothing says only that this draw was a poor one, and the next press
  // draws again; near a fixed place, the next press would ask the same question of the same
  // place and get the same answer.
  if (outcome.random && !outcome.permanent) {
    if (dry + 1 >= DRY_PRESSES) {
      return { stop: `Keep diving stopped: ${dry + 1} presses in a row landed nowhere. ${outcome.refused}` };
    }
    return { go: true, hold: false };
  }
  return { stop: `The chain ran out. ${outcome.refused}` };
}

/**
 * **A pasted text as a link's query**, or `null`: the part after `?` of a whole explorer
 * address, or a query pasted bare, with any `#` fragment and surrounding space taken off.
 * Whether it is a link the page can read is the contract's to say, not this.
 */
export function queryIn(text) {
  let held = String(text ?? "").trim();
  if (held === "") return null;
  const hash = held.indexOf("#");
  if (hash >= 0) held = held.slice(0, hash);
  const mark = held.indexOf("?");
  if (mark >= 0) held = held.slice(mark + 1);
  else if (/^[a-z]+:\/\//i.test(held)) return null;
  held = held.trim();
  return held.includes("=") ? held : null;
}

/**
 * **Dive results**: the landings of this session, newest first. A row is `{ key, link, thumb,
 * said, width, height }`, `thumb` an object URL the list owns and gives back at `clear`.
 */
export class Results {
  constructor(release = () => {}) {
    this.rows = [];
    this.made = 0;
    this.release = release;
  }

  get size() {
    return this.rows.length;
  }

  /** Put a landing at the front, and hand back its row. */
  add({ link, thumb, said, width, height }) {
    this.made += 1;
    const row = { key: `dive-${this.made}`, link, thumb, said, width, height };
    this.rows.unshift(row);
    return row;
  }

  /** Every row gone, and every picture given back. */
  clear() {
    for (const row of this.rows) this.release(row.thumb);
    this.rows = [];
  }
}
