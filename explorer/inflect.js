// The Inflection tab: Julia morphing, at a plain Julia's cost, as a trial.
//
// **It is a trial and it is built to be thrown away.** Matt does not yet know whether he
// likes these pictures, so this is its own tab, degree 2 only, and every piece of it is a
// file that can be deleted: this one, `inflect-link.js`, `inflect.rs`, one panel of
// markup, one block of stylesheet, and the branches in `explorer.js` that name `inflect`.
// Nothing about the pipeline, the galleries, the records or the other two contracts is
// touched by it, and nothing inflected can reach any of them.
//
// **The math, in three lines.** An ordinary Julia render iterates `z ← z² + c` from the
// pixel's own coordinate. An inflection at `p` replaces `z` by `(z − p)² + p` first. With
// the list `p₁ … pₙ` in click order a pixel goes through `pₙ` first and `p₁` last, and
// only then iterates. `inflect.rs` does that and nothing else, which is why every mode,
// palette, shade recipe and tone curve on this page works here untouched: none of them is
// told anything.
//
// **This tab does not draw.** That is the whole of why it is cheap. The picture is the
// ordinary viewer's — the same pool, the same stages, the same cache, the same `f64`
// floor — and an inflected view is an ordinary view carrying one extra field. So the mode
// picker, the palette strip, the shade recipe, Autolevel, the wheel, the drag, the arrow
// keys and the download all work here because none of them knows this tab exists. What
// this module owns is three things: which `c` the set is of, the ordered list, and what a
// **click** on the canvas means.
//
// The one control that is held while this tab shows is the **family picker**, in
// `explorer.js`'s `syncFamilyLock`: the pre-map is defined here for `z² + c` and the
// module refuses anything else by name, so a live picker would be a control whose every
// other entry is a refusal. The Start row below is where the set is chosen instead.
//
// **The gesture split**, which was a choice:
//
// - **A click — press and release without moving — inflects.** The point joins the list
//   and becomes the centre, and the width is re-derived (see `widthAfter`).
// - **A drag pans**, exactly as everywhere else on this page.
// - **A drag that starts on a point's marker moves that point**, live, at preview
//   quality, coalesced.
// - **The wheel zooms**, exactly as everywhere else.
//
// No modifier key, and that is the point of it: the press with no movement was already a
// gesture this page threw away (`release` returns early on a zero-length drag), so
// nothing a reader can already do here has been taken away or given a second meaning. A
// modifier would have been safer and would also have made the tab's one verb the one
// thing a visitor has to be told about.

import * as inflectLink from "./inflect-link.js";

/**
 * Starting `c` values worth sculpting, and why each.
 *
 * **They all have no interior, and that is the rule** *(inflection_sheet2_ckpt136,
 * correcting this list's first version)*. The first set of presets were `c` inside small
 * minibrots — the rabbit, the basilica, the airplane — chosen because solid nodes joined
 * by filaments is what sculpts in real deep-zoom morphing. Here it is exactly wrong: the
 * pre-map sends a disc of interior two-to-one onto a disc of interior, so a filled node
 * inflects to a **black disc with a rim on it**, and the first contact sheet was half
 * black because of it.
 *
 * What sculpts here is a Julia set with no interior at all, which is a property of `c`
 * that can be decided rather than guessed: iterate `z ← z² + c` from the critical point
 * `z₀ = 0`, find the cycle it settles on, and take the multiplier `|λ| = |∏ 2z|` around
 * that cycle. Under one the cycle attracts, it has a basin, and the basin is the
 * interior — reject. Over one it repels, nothing is drawn into it, and the Julia set is a
 * dendrite or a dust with empty interior — keep. Exactly one is parabolic, which has a
 * basin too.
 *
 * So these are **Misiurewicz points**, where the critical orbit is strictly preperiodic
 * and the set is a dendrite, plus one `c` just outside the set where the Julia set is a
 * dust that still has the shape of the connected set beside it. Each was found by
 * `scratch/inflect2-seeds.mjs`, checked by that test, and then picked off a rendered
 * survey of forty-seven candidates for having visibly different character from the rest.
 * The names are the ones the literature uses where it has one.
 */
export const SEEDS = [
  { name: "Dendrite", cx: "0", cy: "1", why: "c = i, the classic dendrite — open, sparse branching" },
  { name: "Branches", cx: "-0.101096364", cy: "0.956286511", why: "a Misiurewicz point with long clean arms" },
  { name: "Hooks", cx: "-0.506294458", cy: "0.683991968", why: "hooked filaments, nodes that curl" },
  { name: "Feathers", cx: "0.164679752", cy: "0.630301832", why: "dense feathering — the finest filigree here" },
  { name: "Star", cx: "0.437924241", cy: "0.341892084", why: "five-armed nodes, the easiest to aim at" },
  { name: "Lace", cx: "0.141232142", cy: "0.687966245", why: "fine lace, close-packed branch points" },
  { name: "Spine", cx: "-1.5436890126920763", cy: "0", why: "the Feigenbaum point — a spine on the real axis" },
  { name: "Spiral dust", cx: "0.382624004", cy: "0.229711513", why: "just outside the set beside elephant valley: spirals, and dust rather than a dendrite" },
];

/** How near a click has to fall to a point's marker to grab it rather than inflect,
 *  in pixels on the canvas. A finger's width rather than a pixel: the markers are small
 *  and the cost of missing is a click that inflects where one meant to drag. */
const GRAB_RADIUS = 14;

/**
 * How far the snap may move a click, as a share of the view's width, and on how fine a
 * grid it looks.
 *
 * **A snap is a correction and not a search.** At three percent of the width it moves a
 * click by about twenty pixels at most, which is near enough that a reader reads it as
 * "it went where I meant" rather than "it went somewhere else"; a wider one would find a
 * better node and put the point where nobody pointed. The grid is finer than the screen
 * over that span — 64 samples across three percent of the width is about a third of a
 * pixel — so the snap can land on structure the picture is only hinting at.
 */
const SNAP_SHARE = 0.03;
const SNAP_GRID = 64;

/** The marker's radius and its ink. Drawn over the picture after every stage, like the
 *  mark and the walk's overlay, and never into the frame buffer. */
const MARKER_RADIUS = 5;
const MARKER_INK = "#3d8bff";
const MARKER_UNDER = "rgba(0, 0, 0, 0.65)";

/**
 * The width a view takes after a click at `p`.
 *
 * **The square root, and it is the same one the Deep tab's *Same view at z = 0* takes.**
 * The pre-map is two-to-one about `p` and fixes it, so content that sat within `r` of `p`
 * comes back within about `√r` of it. A click that kept the width would therefore show a
 * tiny disc of the new structure in the middle of an otherwise unchanged frame, and a
 * click deep in — where `r` is small and `√r` is enormously larger — would show almost
 * nothing of what the click just made.
 *
 * Half-width to half-width: `h' = √h`, so `w' = 2√(w/2) = √(2w)`. The fixed point is
 * `w = 2`, which is about the scale the whole construction lives at, so repeated clicks
 * settle there from either side rather than running away.
 */
export function widthAfter(width) {
  return Math.sqrt(2 * width);
}

export function mount(host) {
  const els = host.elements;

  /** The whole construction, in click order. The *view* carries a prefix of it — see
   *  `depth` — so that stepping back and forward is not a destructive edit. */
  let points = [];
  /** How many of them are in force. `points.slice(0, depth)` is what draws. */
  let depth = 0;
  /** The index being dragged, or `null`. */
  let dragging = null;
  let shown = false;
  /** The `c` the points in `points` were placed on, as the two decimal strings. See
   *  `held`: a construction outlives leaving the tab and does not outlive its own set. */
  let builtOn = { cx: null, cy: null };

  /** Whether this tab is the one deciding what a click on the canvas means. */
  function owns() {
    return shown;
  }

  /** The points in force, as the view carries them. */
  function inForce() {
    return points.slice(0, depth);
  }

  /** Push the construction into the viewer's view and draw it.
   *
   *  `how` is `draw` for a committed change and `live` for one the reader's hand is still
   *  on — the same two the shade sliders use, so a dragged point coalesces exactly the way
   *  a dragged slider does rather than stacking passes up behind the hand. */
  function commit(how = "draw", extra = {}) {
    host.setView({ inflections: inForce(), ...extra }, how);
    sync();
  }

  // ------------------------------------------------------------------ the stack

  /** One row of the stack: its number, where it is, and what it does. */
  function rowOf(point, index) {
    const row = document.createElement("li");
    row.className = "inflect-row";
    if (index >= depth) row.classList.add("inflect-row-off");

    const number = document.createElement("span");
    number.className = "inflect-number";
    number.textContent = String(index + 1);

    const where = document.createElement("code");
    where.className = "inflect-where";
    where.textContent = `${point.re.text}, ${point.im.text}`;

    const drop = document.createElement("button");
    drop.type = "button";
    drop.className = "inflect-drop";
    drop.textContent = "×";
    drop.title = `Take point ${index + 1} out of the construction.`;
    drop.addEventListener("click", () => {
      points.splice(index, 1);
      if (depth > points.length) depth = points.length;
      else if (index < depth) depth -= 1;
      commit();
    });

    row.append(number, where, drop);
    return row;
  }

  /** The panel, from the state. Called after every change, including one the canvas made. */
  function sync() {
    els.stack.replaceChildren(...points.map(rowOf));
    els.empty.hidden = points.length > 0;
    els.count.textContent =
      points.length === 0
        ? ""
        : depth === points.length
          ? `${depth} point${depth === 1 ? "" : "s"}`
          : `${depth} of ${points.length}`;
    els.undo.disabled = points.length === 0;
    els.clear.disabled = points.length === 0;
    els.back.disabled = depth === 0;
    els.forward.disabled = depth === points.length;
    // The select follows the `c` in force rather than keeping whatever was last chosen:
    // a `c` brought in from the viewer, or arrived on a link, is one of the six about as
    // often as not, and a picker showing "Choose a set…" over the rabbit is a control
    // disagreeing with the picture beside it.
    const held = host.currentC();
    if (points.length > 0) builtOn = held;
    const known = SEEDS.find((seed) => seed.cx === held.cx && seed.cy === held.cy);
    els.seed.value = known === undefined ? "" : `${known.cx},${known.cy}`;
    els.seedSay.textContent = `z² + c at c = ${held.cx}, ${held.cy}`;
  }

  els.undo.addEventListener("click", () => {
    if (points.length === 0) return;
    points.pop();
    if (depth > points.length) depth = points.length;
    commit();
  });

  els.clear.addEventListener("click", () => {
    if (points.length === 0) return;
    points = [];
    depth = 0;
    commit();
  });

  els.back.addEventListener("click", () => {
    if (depth === 0) return;
    depth -= 1;
    commit();
  });

  els.forward.addEventListener("click", () => {
    if (depth === points.length) return;
    depth += 1;
    commit();
  });

  // ------------------------------------------------------------------- the start

  for (const seed of SEEDS) {
    const option = document.createElement("option");
    option.value = `${seed.cx},${seed.cy}`;
    option.textContent = seed.name;
    option.title = seed.why;
    els.seed.append(option);
  }

  els.seed.addEventListener("change", () => {
    const [cx, cy] = els.seed.value.split(",");
    // A new set is a new construction: the points were placed on the old one's nodes and
    // mean nothing on this one's. Clearing them is the honest move, and a tab that kept
    // them would be showing a construction nobody built.
    points = [];
    depth = 0;
    host.setC(cx, cy);
    commit();
  });

  // -------------------------------------------------------------- what a click means

  /**
   * The point on the set nearest where a click landed, or the click itself.
   *
   * **This is the difference between a tab and a black disc, and it was measured rather
   * than assumed.** The pre-map wraps a neighbourhood of `p` twice around `p`, so what
   * has to be at `p` is *structure*. A click a few pixels inside a node inflects the
   * node's interior: a disc of interior maps onto a disc of interior and the picture is a
   * black disc with a rim. The first contact sheet was half black for exactly this, and
   * so was the first working build of this tab.
   *
   * The search: iterate a small grid about the click and take the escaping sample that
   * took longest to escape. A sample that escapes is outside the set; one that takes a
   * long time about it is against the boundary. It reads the picture *as inflected*,
   * because that is the picture the reader clicked on.
   *
   * One 64x64 field over the pool, which is a thousandth of the frame the click is about
   * to start, so the toggle is on by default and costs nothing worth saying.
   */
  async function snapped(at) {
    if (!els.snap.checked) return { at, why: "" };
    const radius = host.width() * SNAP_SHARE;
    let lanes;
    try {
      lanes = await host.probe(at.x, at.y, radius * 2, SNAP_GRID);
    } catch {
      return { at, why: "" };
    }
    // A newer pass took the pool, or the plan was refused: the click stands where it fell
    // rather than waiting or failing. A snap is an improvement on a click and never a
    // precondition for one.
    if (lanes === null) return { at, why: "" };
    let best = null;
    for (let row = 0; row < SNAP_GRID; row += 1) {
      for (let col = 0; col < SNAP_GRID; col += 1) {
        const value = lanes[row * SNAP_GRID + col];
        if (!Number.isFinite(value)) continue; // interior: it never escaped
        if (best === null || value > best.value) {
          best = {
            value,
            x: at.x + (2 * radius * (col + 0.5)) / SNAP_GRID - radius,
            y: at.y + radius - (2 * radius * (row + 0.5)) / SNAP_GRID,
          };
        }
      }
    }
    // Every sample interior: the click is deep inside a node and there is no boundary
    // within reach of it. **Said rather than silently allowed**, because the picture that
    // follows is the one this whole function exists to warn about — and said *back to the
    // caller* rather than straight to the page, because the pass this click is about to
    // start opens by clearing the line.
    if (best === null) {
      return {
        at,
        why:
          "Every sample near that click is inside the set, so there was no node to snap " +
          "to. Inflecting the interior gives a plain disc: click on a filament, or on the " +
          "edge of a node.",
      };
    }
    return { at: { x: best.x, y: best.y }, why: "" };
  }

  /** Which point's marker the canvas point `(px, py)` is on, or `null`. The topmost of
   *  the ones in force wins, which is the last one placed — the one a reader is most
   *  likely to be adjusting. */
  function grabbed(px, py) {
    const held = inForce();
    for (let at = held.length - 1; at >= 0; at -= 1) {
      const where = host.canvasAt(held[at].re.value, held[at].im.value);
      if (Math.hypot(where.px - px, where.py - py) <= GRAB_RADIUS) return at;
    }
    return null;
  }

  return {
    owns,
    seeds: SEEDS,
    show() {
      shown = true;
      sync();
    },
    hide() {
      shown = false;
      dragging = null;
    },

    /** The whole construction and the cursor, for the link and for Reset. */
    state() {
      return { points: [...points], depth };
    },

    /** Take a construction whole — from a link, or from the Saved tab. */
    open(list) {
      points = list.map((point) => ({ ...point }));
      depth = points.length;
      sync();
    },

    /**
     * The construction this tab already had, for a reader coming back to it — or nothing,
     * where the `c` has moved since it was built.
     *
     * **Leaving does not throw the work away.** The *view* goes back to the plain Julia
     * set on the way out, because a picture whose markers are gone and whose tab is
     * closed should not still be the inflected one — but the list is the reader's, and
     * they may have gone to the palette picker for ten seconds.
     *
     * **A different `c` does throw it away**, and that is the same rule as choosing
     * another set from the Start row. A point is a place on *this* set's filaments; the
     * same coordinate on another set is a place nobody picked, and carrying it over would
     * be the tab showing a construction that was never built. `c` can move while the tab
     * is away — the `cx` box in Details, or *Julia at this c* in the Deep tab — so the
     * comparison is made here rather than assumed away.
     */
    held(cx, cy) {
      if (points.length === 0) return [];
      if (cx !== builtOn.cx || cy !== builtOn.cy) {
        points = [];
        depth = 0;
        sync();
        return [];
      }
      return inForce();
    },

    /** A press: `true` when it grabbed a point, which is what stops the pan. */
    press(px, py) {
      dragging = grabbed(px, py);
      return dragging !== null;
    },

    /** A move with a point grabbed. Live and coalesced — see `commit`. */
    move(px, py) {
      if (dragging === null) return false;
      const at = host.planeAt(px, py);
      points[dragging] = {
        re: inflectLink.coordinateOf(at.x),
        im: inflectLink.coordinateOf(at.y),
      };
      commit("live");
      return true;
    },

    /** The release that ends a point's drag: the same construction, drawn out in full. */
    release() {
      if (dragging === null) return false;
      dragging = null;
      commit();
      return true;
    },

    /**
     * A click: the point joins the list and becomes the centre.
     *
     * **A click while stepped back truncates**, the way an editor's undo history does:
     * the forward half was a construction this click is no longer on the way to, and
     * keeping it would leave Forward stepping into a point placed on a picture that no
     * longer exists.
     */
    async click(px, py) {
      if (points.length >= inflectLink.MAX_POINTS) {
        host.say(
          `This tab carries at most ${inflectLink.MAX_POINTS} inflections. Past that the ` +
            "structure a click lands on is finer than the sample grid, so what a reader " +
            "would be steering is aliasing.",
        );
        return;
      }
      const width = host.width();
      const { at, why } = await snapped(host.planeAt(px, py));
      points = points.slice(0, depth);
      points.push({ re: inflectLink.coordinateOf(at.x), im: inflectLink.coordinateOf(at.y) });
      depth = points.length;
      // The width is read before the snap and spent after it: the snap runs a pass of its
      // own over the pool, and a width read on the far side of that would be whatever the
      // page had got to rather than what the reader was looking at when they clicked.
      commit("draw", { x: at.x, y: at.y, w: widthAfter(width) });
      // After the pass has started, which is what clears the line. See `snapped`.
      if (why !== "") host.say(why);
    },

    /** The markers, over the picture, after every stage. A point that is stepped past is
     *  drawn hollow — it is in the construction and not in this picture. */
    paint(screen) {
      if (!shown || points.length === 0) return;
      screen.save();
      points.forEach((point, index) => {
        const where = host.canvasAt(point.re.value, point.im.value);
        const live = index < depth;
        screen.beginPath();
        screen.arc(where.px, where.py, MARKER_RADIUS, 0, Math.PI * 2);
        screen.lineWidth = 3;
        screen.strokeStyle = MARKER_UNDER;
        screen.stroke();
        screen.lineWidth = 1.5;
        screen.strokeStyle = MARKER_INK;
        screen.stroke();
        if (live) {
          screen.fillStyle = MARKER_INK;
          screen.fill();
        }
      });
      screen.restore();
    },

    /** The cursor a pointer over `(px, py)` should have: a grab where a point is. */
    cursorAt(px, py) {
      return grabbed(px, py) === null ? "" : "grab";
    },

    sync,
  };
}
