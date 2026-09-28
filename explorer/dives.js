// Keep diving, and the Dives collection it fills *(keep_diving_ckpt154)*.
//
// **Keep diving is Go pressed over and over, from one place.** It reads the sentence and
// *New coloring on arrival* as they stand before each press, so it varies nothing the reader
// did not leave open: *a random wallpaper* is drawn again on every press. **_This view_ is
// the view the box was ticked on, frozen** *(keep_diving_anchor_ckpt154)*, in either
// dropdown, and the landings are drawn off-screen into Dives while the main view stays where
// it was. The one exception is the loop that descends — *this view* and *its center* or
// *halfway in* (`chains`) — where each press starts from the last landing and the main view
// follows it, because the descent is what is being watched. What this module holds is the
// part with no page in it — which loop a sentence makes, and what a press's outcome means
// for the next — and `deep.js`'s *the dive* runs it.
//
// **Dives is a collection of this session's landings**, in the Gallery tab's dropdown from
// the first landing and gone on a reload. Its rows have a gallery row's shape, so the panel
// and Browse show them as they show any collection, with a deep link where a seat has a
// shallow one and a picture in memory where a seat has a file. Nothing of it is written
// anywhere: it is not in the staged record, and `builder check` never sees it.

/** How long a landing of the descending loop stays on screen, whole, before the next press
 *  starts: long enough to see the picture the press drew, and short enough that a chain of
 *  ten is a minute. A loop drawing off-screen has nothing on screen to hold. */
export const HOLD_MS = 2000;

/** How many presses in a row may draw random wallpapers and land nowhere before the loop
 *  says so and stops. Each press already retries its draw; this is what keeps a plane whose
 *  wallpapers all refuse from searching for ever. */
export const DRY_PRESSES = 3;

/** The collection's name, which is what the dropdown's value and a row's `collections`
 *  key spell. */
export const NAME = "dives";

/** The size a tile is kept at, which is the staged gallery's own. */
export const TILE_WIDTH = 316;

/**
 * Whether a loop on this sentence descends: *this view* and a landing centred on the copy it
 * found, so that each press starts from the last landing and the main view follows it
 * *(keep_diving_anchor_ckpt154)*. Every other sentence is drawn off-screen from the view the
 * box was ticked on.
 */
export function chains(from, to) {
  return from === "view" && (to === "center" || to === "halfway");
}

/**
 * Whether nothing in a loop's sentence is drawn afresh: *this view* on both sides, from a
 * view that no longer moves. The rung rule is deterministic, so every press would land on
 * the first one's frame, and only *New coloring on arrival* makes the next landing another
 * picture.
 */
export function fixed(from, to) {
  return from === "view" && to === "view";
}

/** What the status line says once a loop drawing off-screen has landed: the loop's own count
 *  and the collection's, which Go adds to as well. */
export function landedSaid(landings, dives) {
  return dives == null ? `Dive ${landings} landed.` : `Dive ${landings} landed; Dives · ${dives}.`;
}

/**
 * What the loop does after one press, from what the press answered.
 *
 * `outcome` is `deep.js`'s `dive()`: `{ landed, complete }` where it landed, `{ refused,
 * random, permanent }` where it did not, `{ barred }` where it could not start, `{ error }`
 * where it threw, and `{ superseded }` where something else took the tab over — a Cancel, a
 * link, the way back, a moved view. `dry` is how many presses in a row have landed nowhere
 * before this one. `aside` is whether the loop draws off-screen, which has no landing on
 * screen to hold; `repeats` whether the next press would draw this one's picture again
 * (`fixed`, with the colour box off).
 *
 * Answers `{ go: true, hold }` to press again, holding the landing first where there is one,
 * or `{ stop: sentence }`, which is what the status line says.
 */
export function loopStep(outcome, dry = 0, { aside = false, repeats = false } = {}) {
  if (outcome.superseded) return { stop: "Keep diving stopped." };
  if (outcome.barred !== undefined) return { stop: `Keep diving stopped. ${outcome.barred}` };
  if (outcome.error !== undefined) return { stop: `Keep diving stopped. ${outcome.error}` };
  if (outcome.landed) {
    if (!outcome.complete) return { stop: "Keep diving stopped: the landing was not drawn to the end." };
    if (repeats) {
      return {
        stop:
          "Keep diving stopped after one dive: this view inside a copy near this view lands " +
          "in the same place every time. Tick New coloring on arrival to draw it again in " +
          "new colors.",
      };
    }
    return { go: true, hold: !aside };
  }
  // **A chain runs out where the copy is this view's to find.** Near a random wallpaper, a
  // press that found nothing says only that this draw was a poor one, and the next press
  // draws again; near this view, the next press would ask the same question of the same
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
 * The Dives entry in the header's list of collections: an axis of its own, so the dropdown
 * groups it apart from the staged ones, and its rows carried on it rather than in a file.
 */
export function collection() {
  return { name: NAME, axis: "session", label: "Dives", session: true, seats: 0, rows: [] };
}

/**
 * One landing as a gallery row, added to `into` and returned.
 *
 * `index` in `collections` falls with every landing, so the collection's presentation order —
 * ascending, as every collection's is — is newest first. `centered` is true where the landing
 * is centred on the copy it found; a carried view is placed by it and is not. A deep frame is
 * drawn smooth and nothing else, and has no colour reading, so it carries no hue: the hue row
 * is left empty for this collection rather than filed under a family nobody measured.
 */
export function add(into, { link, family, palette, landing, said, thumb, picture, width, height }) {
  into.seats += 1;
  const row = {
    kind: "image",
    key: `dive-${into.seats}`,
    link,
    thumb,
    picture,
    width,
    height,
    alt: said,
    collections: { [NAME]: -into.seats },
    mode: "smooth",
    hue: null,
    hues: [],
    palette,
    family,
    centered: landing === "center" || landing === "halfway",
    spiral: null,
    deep: true,
    said,
  };
  into.rows.push(row);
  return row;
}
