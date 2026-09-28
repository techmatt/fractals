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

import { firstQuery } from "./permalink.js";

/** How long a landing of the descending loop stays on screen, whole, before the next press
 *  starts: long enough to see the picture the press drew, and short enough that a chain of
 *  ten is a minute. A loop drawing off-screen has nothing on screen to hold. */
export const HOLD_MS = 2000;

/** How many presses in a row may draw and land nowhere before the loop says so and stops.
 *  Each press already retries its draw; this is what keeps a plane whose wallpapers all
 *  refuse from searching for ever. It was 3 *(until dive_mixture_ckpt154)*, and the first
 *  run at the defaults ended on its own inside ninety seconds with nothing else able to end
 *  it: the mixture's descents refuse more often than a carry does, and a loop meant to run
 *  until Stop should not end on a short run of poor draws. Ten presses is forty draws. */
export const DRY_PRESSES = 10;

/** The size a result's tile is kept at: two to a row of the panel, sharp on a 2x screen
 *  *(dive_mixture_ckpt154; it was the Deep gallery's 316)*. */
export const TILE_WIDTH = 640;

/**
 * **The landing mixture** *(dive_mixture_ckpt154)*: what `python -m builder dive-candidates`
 * drew, which is the set of results Matt liked, as the share of presses that land each way.
 * `carry` is a frame carried into the copy; `center` and `halfway` are the copy's centre and
 * its symmetry point. The generator's `LANDING_WEIGHT` was seat 0.35 and view 0.35, and both
 * of those are a frame carried in, so `carry` is their sum. Its route adaptation, which halves
 * a route that stops landing, never fired in the run the sheet came from, so the weights are
 * the ones it started with.
 */
export const MIXTURE = { carry: 0.7, center: 0.15, halfway: 0.15 };

/**
 * Where B is Random, the share of carried frames that are **A itself**, carried into its own
 * nearby copy; the rest are another random wallpaper of the plane. The generator's "this view
 * inside it" searched from the view 60% of the time (`FROM_WEIGHT`), which made it A carried
 * into its own copy 0.35 × 0.6 = 21% of all presses, against 49% for another wallpaper: three
 * tenths of the carries, not the half the brief remembered.
 */
export const CARRY_SELF = 0.3;

/**
 * **A centre or a halfway landing goes down first**, as the generator's did: this share of
 * them press Go on the copy's centre a random `DESCENT` rungs deep before the last press,
 * and the rest land from A directly. The generator descended only where the search ran from
 * the view (`FROM_WEIGHT`'s 0.6) and started from a fresh random wallpaper otherwise, which
 * is the same as no descent.
 */
export const DESCEND_SHARE = 0.6;
export const DESCENT = [1, 8];

/**
 * Whether a press draws its landing from the mixture: *dive into* with B on Random, every
 * press; and with B on a frame of its own (Here or Paste), every press Keep diving makes, so
 * a loop sometimes lands on the centre or the halfway point instead. A single Go with B on a
 * frame does exactly that one dive, and B on None is unchanged.
 */
export function mixes(action, b, looping = false) {
  return action === "into" && (b.mode === "random" || (looping && b.mode !== "none"));
}

/**
 * One draw from the mixture for B as it stands: `{ landing, carry, rungs }`. `landing` is
 * `carry`, `center` or `halfway`; `carry` names the frame carried — `self` (A), `seat` (a random
 * wallpaper) or `b` (B's own frame) — and is `null` otherwise; `rungs` is how far down a centre
 * or halfway landing goes first. `random` is a uniform draw in `[0, 1)`, for the tests.
 */
export function variantOf(b, random = Math.random) {
  const u = random();
  if (u < MIXTURE.carry) {
    const carry = b.mode !== "random" ? "b" : random() < CARRY_SELF ? "self" : "seat";
    return { landing: "carry", carry, rungs: 0 };
  }
  const landing = u < MIXTURE.carry + MIXTURE.center ? "center" : "halfway";
  const [low, high] = DESCENT;
  const rungs = random() < DESCEND_SHARE ? low + Math.floor(random() * (high - low + 1)) : 0;
  return { landing, carry: null, rungs };
}

/**
 * **A variant in words**, as a result's tile and the status line name it: *A inside its copy*,
 * *center, 3 rungs down*. `taken` is the rungs actually gone down, which a descent that ran
 * out early makes fewer than it drew.
 */
export function variantWords(variant, taken = variant.rungs) {
  if (variant.landing === "carry") {
    if (variant.carry === "self") return "A inside its copy";
    if (variant.carry === "seat") return "a random wallpaper inside its copy";
    return "B inside its copy";
  }
  const head = variant.landing === "center" ? "center" : "halfway in";
  if (taken === 0) return head;
  return `${head}, ${taken} ${taken === 1 ? "rung" : "rungs"} down`;
}

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
 * one — a random draw, the descent, or the mixture, which *dive into* with B on a frame draws
 * from while the loop runs. Anything else would land on the same frame every time.
 */
export function keepable(a, action, b) {
  return draws(a, action, b) || chains(a, action, b) || mixes(action, b, true);
}

/** Why Keep diving is unavailable, as its title says it, or `null`. */
export function keepBarred(a, action, b) {
  if (keepable(a, action, b)) return null;
  return (
    "Keep diving needs something to change between dives: a slot on Random, dive into with " +
    "B on a frame, or A on Here (following the view) with B on None, which descends."
  );
}

/** What the status line says once a loop drawing off-screen has landed a round: the loop's
 *  own count and the results', which Go adds to as well. `saved` is a batch's size, and
 *  `variant` the words of the mixture's draw, where the press made one. */
export function landedSaid(landings, results, saved = null, variant = null) {
  const head =
    (saved === null ? `Dive ${landings} landed` : `Round ${landings} saved ${saved}`) +
    (variant ? ` (${variant})` : "");
  return results == null ? `${head}.` : `${head}; Dive results · ${results}.`;
}

/**
 * What the loop does after one press, from what the press answered.
 *
 * `outcome` is `deep.js`'s `dive()`: `{ landed, complete }` where it landed, `{ refused,
 * random, permanent }` where it did not, `{ barred }` where it could not start, `{ error }`
 * where it threw, and `{ superseded }` where something else took the tab over — a link, the
 * way back, a moved view. `dry` is how many presses in a row have landed nowhere before this
 * one. `aside` is whether the press drew off-screen, which has no landing on screen to hold.
 *
 * Answers `{ go: true, hold }` to press again, holding the landing first where there is one,
 * or `{ stop: sentence }`, which is what the status line says.
 *
 * **Only Stop and leaving the tab end a loop** *(dive_mixture_ckpt154)*, and both end it
 * before its press answers, so neither reaches here. A press the reader took the tab from —
 * a moved view, a tile opened, a pass of their own — is pressed again once the tab is idle,
 * and so is a landing on screen they moved off before it was drawn to the end; the page has
 * by then turned a descent that was following its landings into one drawing aside.
 */
export function loopStep(outcome, dry = 0, { aside = false } = {}) {
  if (outcome.superseded) return { go: true, hold: false };
  if (outcome.barred !== undefined) return { stop: `Keep diving stopped. ${outcome.barred}` };
  if (outcome.error !== undefined) return { stop: `Keep diving stopped. ${outcome.error}` };
  if (outcome.landed) {
    if (!outcome.complete) return { go: true, hold: false };
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
 *
 * **The first link and nothing after it**: the contract's `firstQuery`, the one reader of a
 * pasted text, so a paste that carries one link twice reads as that link and not as a query
 * naming its keys twice *(duplicate_key_links_ckpt154)*.
 */
export function queryIn(text) {
  const held = String(text ?? "").trim();
  if (held === "") return null;
  if (!held.includes("?") && /^[a-z]+:\/\//i.test(held)) return null;
  const query = firstQuery(held);
  return query.includes("=") ? query : null;
}

/**
 * **Dive results**: the landings of this session, newest first. A row is `{ key, link, thumb,
 * said, variant, width, height }`, `thumb` an object URL the list owns and gives back at
 * `clear`, and `variant` the words the tile names its landing by, or `null`.
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
  add({ link, thumb, said, variant = null, width, height }) {
    this.made += 1;
    const row = { key: `dive-${this.made}`, link, thumb, said, variant, width, height };
    this.rows.unshift(row);
    return row;
  }

  /** Every row gone, and every picture given back. */
  clear() {
    for (const row of this.rows) this.release(row.thumb);
    this.rows = [];
  }
}
