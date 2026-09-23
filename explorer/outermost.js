// How far out a gesture may zoom
// *(explorer_deep_polish_ckpt142)*.
//
// **The stop is the family's home view, which is the engine's.** `engine.wasm`'s `home` is
// the engine's `Family::home_view`: for a set whose extent the engine measured — the
// Mandelbrot and Multibrot sets, the Phoenix plane — that extent with its 10% margin, which
// is the whole set with room round it; for a dynamical plane, whose shape changes with every
// `c`, the stated exception of the whole plane, 3 across about the origin. Nothing here
// restates either number: the page asks the module, and this file only says what a gesture
// does with the answer.
//
// **A home that is not the extent of what is on screen stops twice as far out** — 6 across
// for a dynamical plane. The whole-plane home is a starting frame and not an extent, and a
// Julia set at `c` near −2 runs out to ±2 on the real axis, so a stop at 3 would be a wall
// in front of the whole set the stop exists to show. The Phoenix plane is the other such
// home: its extent was measured at the anchor's `p`, and the plane moves with `p` — the
// record's own boxes for its starting points run from 0.85 to 4.8 across. A set measured at
// the constants it is drawn with stops at its home exactly, since that frame is the whole
// set with its margin.
//
// **The stop is a width and not a place** *(explorer_shallow_deep_parity_ckpt144)*: a zoom
// that reaches it keeps the centre the view has, so a zoom back in returns where it began.
//
// **The limit is on gestures and nothing else.** A link that opens wider than the stop opens
// as it was written; from there a zoom out does nothing and a zoom in works as ever.

/** How much wider than its home a family whose home is not its extent may be zoomed out to. */
export const LOOSE_STOP = 2;

/** The frame a gesture may not zoom out past: `{ x, y, w }` as numbers, from a home whose
 *  coordinates are numbers. `loose` is whether that home is a starting frame rather than
 *  the extent of the set — a dynamical plane, or the Phoenix plane. */
export function stopOf(home, loose) {
  return { x: home.x, y: home.y, w: loose ? home.w * LOOSE_STOP : home.w };
}

/**
 * A zoom out, held to the stop *(Matt, explorer_shallow_deep_parity_ckpt144)*: the frame the
 * gesture asked for where it is no wider than the stop, and otherwise **the stop's width
 * about the centre the view already has**. Returns `null` where the view is already at the
 * stop or wider, so the gesture does nothing.
 *
 * The centre used to be drawn home over the last four widths before the stop, and to be the
 * home's at it. That made the stop a place rather than a width: a zoom out that reached it
 * and a zoom back in landed somewhere else than where the reader had been. Now the only
 * thing the stop changes is how wide the frame gets, so a zoom back in returns to where the
 * zoom out began, and Root (r) is the way to the home itself.
 *
 * Only for a zoom *out*: a zoom in is never touched, however far out it starts.
 */
export function heldOut(asked, current, stop) {
  if (current.w >= stop.w) return null;
  if (asked.w <= stop.w) return asked;
  return { x: current.x, y: current.y, w: stop.w };
}
