// Finding the features an inflection is placed on, in a rendered field, without eyes.
//
// **What this is for.** The published practice for Julia morphing says *where* to click in
// words — `explorer/README.md` cites the sources — and the words are about features of the
// picture in front of you: the central node of the shortest arm makes a disk, a node
// beside it makes a tree, a node beyond it makes a line. A person reads those off the
// screen. A script has to find them, and that is what this module does.
//
// It is **not** a renderer and knows nothing about inflection, Julia sets or the engine. It
// takes a field — one `f64` a sample, `NaN` where the orbit never escaped, which is what
// `compute_band` produces for a one-lane mode — and answers questions about the shape in
// it. So it is testable under node with no wasm and no browser, and it would work on any
// escape-time picture.
//
// **The structure it finds is the picture's, not the set's.** For a `c` outside the
// Mandelbrot set the Julia set is a dust: no two points of it are connected. The *picture*
// is not dusty, because escape time is smooth and its deep level sets are filaments that
// hug where the dust is dense. This module masks the deepest samples and treats what it
// gets as a shape, which is exactly what a person clicking on the screen is doing. That is
// the right target and it is worth saying out loud, because it means "node" here is a
// feature of a rendering at a resolution, not an invariant of the set.
//
// Four steps, and each is its own export so a caller can look at the middle of it:
//
//   1. `maskOf`      the deepest share of the samples: where the filaments are
//   2. `armsFrom`    cut a disc out of the centre; what is left, per arm, with lengths
//   3. `nodesIn`     branch points, by counting the arms crossing a small circle
//   4. `featuresAt`  the three named choices — centre, beside, beyond — off the above
//
// **Nothing here is loaded by the explorer page.** It is imported by the scripts that
// build contact sheets under `scratch/`. `README.md`'s *Next* says what it could become.

/**
 * The deepest `share` of the finite samples, as a 0/1 mask.
 *
 * **Deep means close to the set.** A sample that took a long time to escape is one whose
 * orbit lingered near the Julia set, so thresholding escape time from above is the
 * cheapest way to say *where the structure is*. `NaN` — never escaped, so interior — is
 * deeper than any finite count and always in the mask.
 *
 * The threshold is a **share of the frame** rather than an absolute count, because escape
 * counts run over orders of magnitude between one view and the next and a fixed number
 * would mask everything in one frame and nothing in another. Three percent is about the
 * thinnest a filament can be at these resolutions and still be connected enough to walk.
 */
export function maskOf(field, width, height, { share = 0.03 } = {}) {
  const total = width * height;
  const finite = [];
  let interior = 0;
  for (let at = 0; at < total; at += 1) {
    const value = field[at];
    if (Number.isNaN(value)) interior += 1;
    else finite.push(value);
  }
  const mask = new Uint8Array(total);
  const wanted = Math.max(1, Math.round(total * share) - interior);
  let cut = Infinity;
  let strict = false;
  if (finite.length > 0 && wanted > 0) {
    finite.sort((a, b) => b - a);
    cut = finite[Math.min(wanted, finite.length) - 1];
    // **A tie at the cut can be most of the frame, and then the share means nothing.** A
    // flat region — a background the caller filled, or a view where a whole corner
    // escaped on the same iteration — puts thousands of samples on exactly the cut value,
    // and `>=` masks all of them. So where the tie overruns the share, the cut is taken
    // strictly, which drops the flat region entirely rather than half of it arbitrarily.
    // If that leaves nothing, nothing is the honest answer: a frame with no contrast has
    // no structure in it, and a mask of an arbitrary slab of equal samples would make
    // every pixel of it look like a node.
    let atLeast = 0;
    for (const value of finite) if (value >= cut) atLeast += 1;
    strict = atLeast > wanted * 2;
  }
  for (let at = 0; at < total; at += 1) {
    const value = field[at];
    mask[at] = Number.isNaN(value) || (strict ? value > cut : value >= cut) ? 1 : 0;
  }
  return mask;
}

/** Whether `(x, y)` is on the mask, with anything off the grid counted as off. */
function on(mask, width, height, x, y) {
  return x >= 0 && y >= 0 && x < width && y < height && mask[y * width + x] === 1;
}

/**
 * Connected components of `mask`, 8-connected, as a label image and their sizes.
 *
 * Iterative rather than recursive, and over a typed stack: a filament through a 480x270
 * frame is tens of thousands of pixels and a recursive flood would blow the stack.
 */
export function componentsOf(mask, width, height) {
  const labels = new Int32Array(width * height).fill(-1);
  const sizes = [];
  const stack = new Int32Array(width * height);
  for (let seed = 0; seed < width * height; seed += 1) {
    if (mask[seed] !== 1 || labels[seed] !== -1) continue;
    const label = sizes.length;
    let top = 0;
    stack[top++] = seed;
    labels[seed] = label;
    let size = 0;
    while (top > 0) {
      const at = stack[--top];
      size += 1;
      const x = at % width;
      const y = (at - x) / width;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const next = ny * width + nx;
          if (mask[next] !== 1 || labels[next] !== -1) continue;
          labels[next] = label;
          stack[top++] = next;
        }
      }
    }
    sizes.push(size);
  }
  return { labels, sizes };
}

/**
 * The arms leaving a point: cut a disc out of the mask and label what is left.
 *
 * **Cutting rather than ray-walking, and that is the whole trick.** The obvious way to
 * measure an arm is to walk outward along a ray and see how far the mask holds, which
 * fails on every arm that curves — and these arms are spirals, so they all curve. Removing
 * a disc of radius `inner` around the centre severs the arms from each other at the hub;
 * each is then a connected component, and its reach is just the largest radius any of its
 * pixels has. A spiral that wraps right round the centre is measured correctly, and so is
 * one that leaves the frame.
 *
 * Only components that **touch the cut** are arms. A speck of filament elsewhere in the
 * frame is not attached to this hub and is not something an arm-length is meaningful for.
 *
 * `angle` is measured where the arm meets the cut, not at its tip: that is the direction a
 * reader would call the arm's, and a spiral's tip can be anywhere.
 */
export function armsFrom(mask, width, height, centre, inner) {
  const cut = new Uint8Array(mask);
  const inner2 = inner * inner;
  const near = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const d2 = (x - centre.x) ** 2 + (y - centre.y) ** 2;
      if (d2 <= inner2) {
        cut[y * width + x] = 0;
        continue;
      }
      // The ring just outside the cut: where an arm's direction is read.
      if (d2 <= (inner + 2) ** 2) near.push(y * width + x);
    }
  }
  const { labels } = componentsOf(cut, width, height);
  const arms = new Map();
  for (const at of near) {
    const label = labels[at];
    if (label < 0) continue;
    const x = at % width;
    const y = (at - x) / width;
    const angle = Math.atan2(y - centre.y, x - centre.x);
    let arm = arms.get(label);
    if (arm === undefined) {
      arm = { label, sin: 0, cos: 0, touching: 0, length: 0, pixels: 0, tip: null };
      arms.set(label, arm);
    }
    arm.sin += Math.sin(angle);
    arm.cos += Math.cos(angle);
    arm.touching += 1;
  }
  if (arms.size === 0) return [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const label = labels[y * width + x];
      if (label < 0) continue;
      const arm = arms.get(label);
      if (arm === undefined) continue;
      arm.pixels += 1;
      const radius = Math.hypot(x - centre.x, y - centre.y);
      if (radius > arm.length) {
        arm.length = radius;
        arm.tip = { x, y };
      }
    }
  }
  return [...arms.values()]
    .map((arm) => ({
      angle: Math.atan2(arm.sin, arm.cos),
      length: arm.length,
      pixels: arm.pixels,
      tip: arm.tip,
      label: arm.label,
    }))
    .sort((a, b) => a.length - b.length);
}

/**
 * How many arms the mask sends across a circle of radius `radius` about `(x, y)`.
 *
 * The crossing number, read on a circle rather than on a 3x3 neighbourhood: a tip sends
 * one, a plain filament sends two, and a branch point sends three or more. A circle a few
 * pixels out is what makes this robust at a coarse render — a 3x3 test answers a question
 * about one pixel's neighbours, which at this resolution is mostly a question about
 * aliasing.
 *
 * The runs are counted **around** the circle, so a run spanning the seam at ±π is one run
 * and not two.
 */
export function armsAt(mask, width, height, x, y, radius, samples = 64) {
  const hits = new Uint8Array(samples);
  for (let step = 0; step < samples; step += 1) {
    const angle = (step / samples) * Math.PI * 2;
    hits[step] = on(
      mask,
      width,
      height,
      Math.round(x + radius * Math.cos(angle)),
      Math.round(y + radius * Math.sin(angle)),
    )
      ? 1
      : 0;
  }
  let runs = 0;
  for (let step = 0; step < samples; step += 1) {
    if (hits[step] === 1 && hits[(step - 1 + samples) % samples] === 0) runs += 1;
  }
  // All the way round with no gap: a closed ring, which is not a branch point but is a
  // node in every sense a reader means — the middle of a disk. Reported as its own count.
  if (runs === 0 && hits[0] === 1) return samples;
  return runs;
}

/**
 * The branch points of the mask: where three or more arms meet.
 *
 * Non-maximum suppression by `spacing` keeps one node per feature — a branch point is
 * several pixels wide at these resolutions and would otherwise be reported a dozen times —
 * and the one kept is the **deepest**, which is the one closest to the set.
 *
 * Candidates are mask pixels only, and the mask is a few percent of the frame, so this is
 * a circle-read over tens of thousands of pixels rather than over all of them.
 */
export function nodesIn(
  field,
  mask,
  width,
  height,
  { radius = 6, minArms = 3, spacing = 10, limit = 400 } = {},
) {
  const found = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (mask[y * width + x] !== 1) continue;
      const arms = armsAt(mask, width, height, x, y, radius);
      if (arms < minArms) continue;
      const value = field[y * width + x];
      found.push({ x, y, arms, depth: Number.isNaN(value) ? Infinity : value });
    }
  }
  found.sort((a, b) => b.depth - a.depth || b.arms - a.arms);
  const kept = [];
  const spacing2 = spacing * spacing;
  for (const node of found) {
    if (kept.length >= limit) break;
    if (kept.some((held) => (held.x - node.x) ** 2 + (held.y - node.y) ** 2 < spacing2)) continue;
    kept.push(node);
  }
  return kept;
}

/** The signed difference between two angles, in `(-π, π]`. */
export function angleBetween(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d <= -Math.PI) d += Math.PI * 2;
  return d;
}

/**
 * The three named places to click, read off one field: **centre**, **beside**, **beyond**.
 *
 * This is the published practice turned into arithmetic. The sources say to work within
 * the *shortest arm* — the arm is the one that comes round again as the construction
 * repeats — and that a click at the central node makes a disk, one beside it a tree, and
 * one beyond it a line. So:
 *
 * - the **shortest arm** is `armsFrom`'s first entry: the arm whose pixels reach least far
 *   from the hub. Arms that are a handful of pixels are dropped first — they are specks
 *   the mask happened to leave attached, not arms;
 * - **centre** is the deepest node inside that arm's wedge nearest the hub;
 * - **beyond** is the next node outward in the same wedge, and where the wedge has only
 *   one node it is the arm's own tip, which is the furthest point of it;
 * - **beside** is the deepest node at about the centre node's radius but a good angle off
 *   it, which is the neighbouring feature rather than one further along.
 *
 * Every answer is a pixel, and `null` where the frame does not have one — a caller gets a
 * refusal rather than a plausible pixel it did not mean.
 */
export function featuresAt(
  field,
  width,
  height,
  {
    centre = { x: width / 2, y: height / 2 },
    share = 0.03,
    inner = Math.round(Math.min(width, height) * 0.06),
    nodeRadius = 6,
    spacing = 10,
    wedge = Math.PI / 5,
    minArmPixels = 30,
  } = {},
) {
  const mask = maskOf(field, width, height, { share });
  const arms = armsFrom(mask, width, height, centre, inner).filter(
    (arm) => arm.pixels >= minArmPixels,
  );
  const nodes = nodesIn(field, mask, width, height, { radius: nodeRadius, spacing });

  const withPolar = nodes.map((node) => ({
    ...node,
    radius: Math.hypot(node.x - centre.x, node.y - centre.y),
    angle: Math.atan2(node.y - centre.y, node.x - centre.x),
  }));

  const shortest = arms[0] ?? null;
  // **Outside the cut, not merely off the exact centre.** Arms are what is left once a
  // disc of radius `inner` is removed, so a node inside that disc is not on any arm and
  // has no wedge to belong to. Letting them through put the central node a few pixels
  // from the hub, which then collapsed every band measured against its radius.
  const inWedge =
    shortest === null
      ? []
      : withPolar
          .filter(
            (node) =>
              node.radius >= inner &&
              Math.abs(angleBetween(node.angle, shortest.angle)) <= wedge,
          )
          .sort((a, b) => a.radius - b.radius);

  const middle = inWedge[0] ?? null;

  // **Beyond has to be appreciably further out, not merely next in the list.** A node has
  // siblings a few pixels away — the forks of its own branches — and they sort between it
  // and the next node along the arm, so "the second entry" picks a twig off the central
  // node and calls it the node beyond. Requiring half again the radius skips the siblings
  // and lands on the next feature, which is what *further outward* means. Where the arm
  // has no second feature, its tip is the furthest point of it and is the honest answer.
  const beyond =
    middle === null
      ? null
      : (inWedge.find((node) => node.radius > middle.radius * 1.5) ??
        (shortest?.tip
          ? { ...shortest.tip, arms: 1, depth: 0, radius: shortest.length, angle: shortest.angle }
          : null));

  // **Beside is at the centre node's own radius and off its angle**, which is the
  // neighbouring feature rather than one further along — a band around `middle.radius`
  // rather than a ceiling, so the hub itself cannot win it by being nearest of all.
  const beside =
    middle === null
      ? null
      : (withPolar
          .filter(
            (node) =>
              node.radius >= inner &&
              node.radius <= Math.max(middle.radius * 1.8, inner * 3) &&
              Math.abs(angleBetween(node.angle, middle.angle)) > wedge * 1.2,
          )
          .sort((a, b) => b.depth - a.depth)[0] ?? null);

  return {
    mask,
    arms,
    nodes: withPolar,
    shortest,
    centre: middle,
    beside,
    beyond,
    prominent: prominentIn(withPolar, width, height, inner),
  };
}

/**
 * The best feature to *start* on, when there is no previous click to be relative to.
 *
 * **The first click is a different question from the rest.** Centre, beside and beyond are
 * all read against the point last clicked, which is the frame's centre and the point the
 * picture is two-fold about. Before anything has been clicked there is no such point: a
 * dendrite through the middle of the frame has two arms and no shortest one, and asking
 * for its central node is asking about a hub that is not there.
 *
 * What an artist does instead is look for somewhere with structure — a branch point with
 * several arms, well into the frame rather than at its edge, and deep. So: the most-armed
 * node, ties broken by depth, inside the middle of the frame and outside the cut.
 */
export function prominentIn(nodes, width, height, inner) {
  const cx = width / 2;
  const cy = height / 2;
  const reach = Math.min(width, height) * 0.38;
  const near = nodes.filter((node) => {
    const radius = Math.hypot(node.x - cx, node.y - cy);
    return radius >= inner && radius <= reach;
  });
  if (near.length === 0) return null;
  return near.sort((a, b) => b.arms - a.arms || b.depth - a.depth)[0];
}

/** A pixel back to the plane, for a viewport given as centre and width. */
export function planeAt(view, width, height, x, y) {
  const across = view.w / width;
  return {
    re: view.x + (x + 0.5 - width / 2) * across,
    im: view.y - (y + 0.5 - height / 2) * across,
  };
}
