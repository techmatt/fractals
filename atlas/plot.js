// The layouts, and the arithmetic each of them needs.
//
// The population this page draws is savagely uneven and the unevenness is not in the
// dots — it is under them. One bin of the density grid holds two fifths of every keeper
// the search has ever admitted, and the thinning that makes the atlas readable is
// exactly what throws that fact away: a place the search returned to a thousand times
// and a place it found once are the same dot. On top of that a dot's frame is a
// millionth of a plane wide at the median, so *where* it is is nearly as invisible as
// *how deep* it is once the whole family is on screen.
//
// So the plot is not one picture with one right answer, and this file holds three
// treatments rather than the one that won:
//
//   * **plane** — the family drawn whole, dots where they are. Honest and complete, and
//     it spends four fifths of its area on ground nothing was ever found in.
//   * **plates** — the plane, and under it one plate per place the dots actually gather,
//     each a render of that neighbourhood with a rectangle on the plane saying where it
//     came from. An atlas in the sense the word is usually used in.
//   * **spread** — the plane, with dots pushed apart until each can be hit with a
//     pointer, and a hairline from each to where it really is. It breaks position on
//     purpose, and says so by drawing the leader.
//
// The density heatmap is not a fourth treatment: it draws over whichever of the three is
// showing, because the question it answers — *how much came out of here* — is the one
// none of them can answer on its own.

/** How many regional plates the plates layout will draw, at most. */
const PLATE_LIMIT = 6;

/** Single-link clustering happens at this fraction of the plane's width. */
const CLUSTER_SHARE = 1 / 24;

/** A plate is padded this far past the dots it holds, and is never tighter than this. */
const PLATE_PAD = 0.35;
const PLATE_FLOOR = 8;

/** A plate has to be a zoom to be worth drawing. A group whose box is most of the plane
 *  would come back as the plane again, under a number, with a rectangle round the edge —
 *  which is what the pre-thinned `c`-pool produced the first time this ran. */
const MIN_ZOOM = 3;

/** The pixel separation the spread layout pushes dots apart to, and how it gets there. */
const SPREAD_GAP = 15;
const SPREAD_PASSES = 220;
const SPREAD_PULL = 0.035;

/** A frame in the plane: a centre, a size, and the two edges a plot measures from. */
export function frameOf(x, y, width, height) {
  return { x, y, width, height, left: x - width / 2, top: y + height / 2 };
}

/** Where a point in the plane falls inside a frame, as fractions across and down. */
export function place(frame, [x, y]) {
  return { u: (x - frame.left) / frame.width, v: (frame.top - y) / frame.height };
}

function holds(frame, [x, y]) {
  const { u, v } = place(frame, [x, y]);
  return u >= 0 && u <= 1 && v >= 0 && v <= 1;
}

/**
 * The dots grouped by where they gather, single-link at a fraction of the plane.
 *
 * Single-link rather than anything cleverer because the thing being found is a
 * neighbourhood the search kept coming back to, and those are separated by most of a
 * plane — every clustering agrees about them, so the simplest one is the one to read.
 */
function clusters(dots, radius) {
  const owner = dots.map((_, index) => index);
  const find = (index) => (owner[index] === index ? index : (owner[index] = find(owner[index])));
  for (let a = 0; a < dots.length; a++) {
    for (let b = a + 1; b < dots.length; b++) {
      const dx = dots[a].at[0] - dots[b].at[0];
      const dy = dots[a].at[1] - dots[b].at[1];
      if (Math.hypot(dx, dy) <= radius) owner[find(a)] = find(b);
    }
  }
  const held = new Map();
  dots.forEach((dot, index) => {
    const root = find(index);
    if (!held.has(root)) held.set(root, []);
    held.get(root).push(dot);
  });
  return [...held.values()];
}

/** The frame a group of dots wants: their box, padded, at the plane's own shape. */
function frameAround(group, plane, floor) {
  const xs = group.map((dot) => dot.at[0]);
  const ys = group.map((dot) => dot.at[1]);
  const x = (Math.min(...xs) + Math.max(...xs)) / 2;
  const y = (Math.min(...ys) + Math.max(...ys)) / 2;
  const across = plane.aspect[0] / plane.aspect[1];
  const spanX = (Math.max(...xs) - Math.min(...xs)) * (1 + PLATE_PAD * 2);
  const spanY = (Math.max(...ys) - Math.min(...ys)) * (1 + PLATE_PAD * 2);
  const width = Math.max(floor, spanX, spanY * across);
  return frameOf(x, y, width, width / across);
}

/**
 * The plates one layout draws, in the order they are shown.
 *
 * Plate 0 is always the whole plane: whatever else the page does, a reader has to be
 * able to see the family entire with everything marked on it, because that is the claim
 * the section makes. What follows it is the layout's own idea.
 */
export function platesOf(partition, layout) {
  const plane = partition.plane;
  const whole = frameOf(plane.frame.x, plane.frame.y, plane.frame.width, plane.frame.height);
  const first = {
    key: "plane",
    title: partition.title,
    note: partition.says,
    frame: whole,
    dots: partition.dots,
    marks: [],
    spread: layout === "spread",
  };
  if (layout !== "plates") return [first];

  const found = clusters(partition.dots, plane.frame.width * CLUSTER_SHARE)
    .map((group) => ({
      group,
      frame: frameAround(group, plane, partition.radius * PLATE_FLOOR),
      keepers: group.reduce((sum, dot) => sum + dot.keepers, 0),
    }))
    .filter((entry) => whole.width / entry.frame.width >= MIN_ZOOM)
    .sort((a, b) => b.keepers - a.keepers)
    .slice(0, PLATE_LIMIT);

  const plates = found.map(({ group, frame, keepers }, index) => {
    return {
      key: `plate-${index}`,
      title: `Plate ${index + 1}`,
      note:
        `${zoomOf(whole, frame)} · ${group.length} ${group.length === 1 ? "place" : "places"}` +
        ` · ${keepers.toLocaleString()} keepers`,
      frame,
      dots: partition.dots.filter((dot) => holds(frame, dot.at)),
      marks: [],
      spread: false,
    };
  });

  first.marks = plates.map((plate, index) => ({
    label: `${index + 1}`,
    ...boxOf(whole, plate.frame),
  }));
  const shown = new Set(plates.flatMap((plate) => plate.dots.map((dot) => dot.key)));
  const left = partition.dots.length - shown.size;
  first.note =
    plates.length === 0
      ? `${partition.says}. Nothing here gathers tightly enough to be worth a plate of ` +
        `its own — this population is already spaced by its own floor.`
      : `${partition.says}. ${plates.length} ${plates.length === 1 ? "plate" : "plates"} below` +
        `${left > 0 ? `, and ${left} ${left === 1 ? "place is" : "places are"} on no plate` : ""}.`;
  return [first, ...plates];
}

/** How much closer in one frame is than another, as the page says it. */
function zoomOf(whole, frame) {
  const factor = whole.width / frame.width;
  return factor >= 100 ? `×${Math.round(factor / 10) * 10}` : `×${Math.round(factor)}`;
}

/** One frame as a rectangle inside another, in fractions. */
function boxOf(outer, inner) {
  const corner = place(outer, [inner.left, inner.top]);
  return {
    u: corner.u,
    v: corner.v,
    width: inner.width / outer.width,
    height: inner.height / outer.height,
  };
}

/**
 * The spread layout's displaced positions, in pixels.
 *
 * Repulsion to a fixed gap with a spring back to the truth, which is the standard answer
 * to a clumped scatter and is a lie about position however it is tuned. What makes it
 * honest enough to offer is the leader line the page draws with it: a dot that has moved
 * says how far, and a dot that has not is where it says it is.
 */
export function spreadOf(points, width, height, gap = SPREAD_GAP) {
  const held = points.map((point) => ({
    x: point.u * width,
    y: point.v * height,
    ax: point.u * width,
    ay: point.v * height,
  }));
  for (let pass = 0; pass < SPREAD_PASSES; pass++) {
    for (let a = 0; a < held.length; a++) {
      for (let b = a + 1; b < held.length; b++) {
        const dx = held[b].x - held[a].x;
        const dy = held[b].y - held[a].y;
        const apart = Math.hypot(dx, dy) || 0.001;
        if (apart >= gap) continue;
        const push = (gap - apart) / 2 / apart;
        held[a].x -= dx * push;
        held[a].y -= dy * push;
        held[b].x += dx * push;
        held[b].y += dy * push;
      }
    }
    for (const point of held) {
      point.x += (point.ax - point.x) * SPREAD_PULL;
      point.y += (point.ay - point.y) * SPREAD_PULL;
      point.x = Math.min(width, Math.max(0, point.x));
      point.y = Math.min(height, Math.max(0, point.y));
    }
  }
  return held.map((point, index) => ({
    u: point.x / width,
    v: point.y / height,
    from: points[index],
    moved: Math.hypot(point.x - point.ax, point.y - point.ay) > 1,
  }));
}

/**
 * The heatmap's ramp: a cell's share of the busiest one, on a log scale, as a colour.
 *
 * Log because the range is three orders of magnitude and a linear ramp is one bright
 * cell and a hundred and fifteen black ones — which is the same picture as no heatmap at
 * all, drawn more expensively.
 */
export function heatOf(count, peak) {
  const t = Math.log(count + 1) / Math.log(peak + 1);
  // An inferno ramp, and the plate under it is dimmed while it is on. The first ramp
  // here was a blue-to-purple one screened over the render, which was wrong twice: a
  // screen blend reaches the white page behind the plot and gives white, and a purple
  // heat over `twilight_shifted` — a map that is mostly purple — is a mark nobody can
  // pick out of what it is drawn on.
  const stops = [
    [0.0, [26, 12, 60]],
    [0.35, [122, 28, 110]],
    [0.7, [240, 108, 36]],
    [1.0, [252, 252, 176]],
  ];
  let low = stops[0];
  let high = stops[stops.length - 1];
  for (let index = 0; index < stops.length - 1; index++) {
    if (t >= stops[index][0] && t <= stops[index + 1][0]) {
      low = stops[index];
      high = stops[index + 1];
      break;
    }
  }
  const span = high[0] - low[0] || 1;
  const mix = (t - low[0]) / span;
  const channel = (index) => Math.round(low[1][index] + (high[1][index] - low[1][index]) * mix);
  return {
    color: `rgb(${channel(0)}, ${channel(1)}, ${channel(2)})`,
    alpha: 0.6 + 0.4 * t,
    // A bin is drawn bigger as well as hotter. One encoding of the same number twice,
    // which is usually a mistake and is not one here: the whole point of the heatmap is
    // that two fifths of the population came out of one bin, and a colour step alone,
    // at four pixels a bin, is a fact nobody would find.
    grow: 0.55 + 1.15 * t,
  };
}
