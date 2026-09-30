// The pointers down on a canvas, and the pinch two of them make
// *(mobile_followups_ckpt157)*.
//
// The viewer and the Phoenix plane both take a drag from one pointer and a pinch from two,
// and this is the bookkeeping the two share: which pointers are down, where each one is,
// and what the pair measured when the second landed. It knows nothing about a view, a
// frame or a canvas. A point is whatever `{ x, y }` its caller hands it, canvas pixels on
// the viewer and CSS pixels on the Phoenix plane, and what a pinch does to a picture is
// the caller's.
//
// **The order inside `lift` is the whole reason this is one file.** A pinch is measured
// off two pointers, so it has to be measured before the lifted one is forgotten. The viewer
// once forgot first and measured second *(phone_support_ckpt157)*: it threw on the missing
// pointer before the pinch was cleared, so a pinch never zoomed and every pan after one
// slid the picture and drew nothing until a reload.

/**
 * A tracker for one canvas.
 *
 * - `press(id, at, primary)` — a pointer went down. Returns `"drag"` for the first,
 *   `"pinch"` for the second, and `null` for a third, which changes nothing.
 * - `move(id, at)` — a pointer moved. Returns whether it is one that is down.
 * - `pinched()` — the pinch as it stands, `{ ratio, mid, held }`, or `null` where there is
 *   none to measure: `ratio` is the fingers' spread over their spread at the press, `mid`
 *   is their middle now, and `held` is their middle at the press.
 * - `lift(id)` — a pointer came up, or was cancelled. Returns `null` for one that was not
 *   down, and otherwise `{ pinch, measured }`: whether a pinch was under way, and what it
 *   measured at the lift. A pinch ends at its first lift and takes every pointer with it,
 *   so the finger still down is not a drag.
 * - `pinching` — whether a pinch is under way.
 */
export function tracker() {
  const pointers = new Map();
  /** The fingers' spread and middle when the second one landed, or `null`. */
  let pinch = null;

  function spread() {
    const [a, b] = [...pointers.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  function middle() {
    const [a, b] = [...pointers.values()];
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }

  function pinched() {
    if (pinch === null || pointers.size !== 2) return null;
    return { ratio: spread() / pinch.spread, mid: middle(), held: pinch.mid };
  }

  return {
    press(id, at, primary) {
      // A first finger starts from nothing: a pointer whose release never arrived would
      // otherwise be counted as the other half of a pinch for as long as the page is open.
      if (primary) {
        pointers.clear();
        pinch = null;
      }
      pointers.set(id, at);
      if (pointers.size === 1) return "drag";
      if (pointers.size === 2) {
        pinch = { spread: spread(), mid: middle() };
        return "pinch";
      }
      return null;
    },
    move(id, at) {
      if (!pointers.has(id)) return false;
      pointers.set(id, at);
      return true;
    },
    pinched,
    lift(id) {
      if (!pointers.has(id)) return null;
      const measured = pinched();
      pointers.delete(id);
      if (pinch === null) return { pinch: false, measured: null };
      pinch = null;
      pointers.clear();
      return { pinch: true, measured };
    },
    get pinching() {
      return pinch !== null;
    },
  };
}
