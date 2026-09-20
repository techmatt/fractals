// **PAGED** — this file is out of the explorer's working set and nothing the page
// loads imports it. `README.md` beside it says why, what was learned, and how to put
// the tab back. Do not wire it in again without Matt asking for it.
//
// The feature finder, on shapes whose answers are known by construction.
//
// `node --test explorer/paged-inflection/features.test.mjs`, nothing installed. The point of testing it on
// drawn shapes rather than on a Julia set is that a Julia set has no right answer written
// down anywhere — if the finder disagreed with one, I could not say which was wrong. A
// three-armed star has exactly three arms, and the shortest one is the one I drew short.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  angleBetween,
  armsAt,
  armsFrom,
  componentsOf,
  featuresAt,
  maskOf,
  nodesIn,
  planeAt,
} from "./features.js";

const W = 201;
const H = 201;
const MID = { x: 100, y: 100 };

/** A field that is shallow everywhere, so `draw` can carve deep structure into it. */
function blank(value = 1) {
  return new Float64Array(W * H).fill(value);
}

/** A thick line of deep samples from `a` to `b`. */
function stroke(field, a, b, { deep = 1000, thickness = 2 } = {}) {
  const steps = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y)) * 2;
  for (let step = 0; step <= steps; step += 1) {
    const t = step / steps;
    const x = a.x + (b.x - a.x) * t;
    const y = a.y + (b.y - a.y) * t;
    for (let dy = -thickness; dy <= thickness; dy += 1) {
      for (let dx = -thickness; dx <= thickness; dx += 1) {
        const px = Math.round(x + dx);
        const py = Math.round(y + dy);
        if (px < 0 || py < 0 || px >= W || py >= H) continue;
        field[py * W + px] = deep;
      }
    }
  }
  return field;
}

/** `n` arms from the middle, the `short` index drawn at half length. */
function star(n, { short = null, long = 80 } = {}) {
  const field = blank();
  for (let arm = 0; arm < n; arm += 1) {
    const angle = (arm / n) * Math.PI * 2;
    const reach = arm === short ? long / 2 : long;
    stroke(field, MID, {
      x: MID.x + reach * Math.cos(angle),
      y: MID.y + reach * Math.sin(angle),
    });
  }
  return field;
}

// ------------------------------------------------------------------------- the mask

test("the mask is the deepest share, and interior is always in it", () => {
  const field = blank();
  for (let at = 0; at < field.length; at += 1) field[at] = at % 97; // contrast to cut
  field[0] = NaN;
  field[1] = 5000;
  const mask = maskOf(field, W, H, { share: 0.001 });
  assert.equal(mask[0], 1, "NaN is deeper than any finite count");
  assert.equal(mask[1], 1);
  assert.equal(mask[2], 0, "a shallow sample is not");
});

test("a flat region does not become the mask by winning a tie", () => {
  // The background is one value and the strokes another: `>=` at the cut would mask the
  // whole background, which is the degenerate case every other test here rests on.
  const field = stroke(blank(), { x: 20, y: 100 }, { x: 180, y: 100 });
  const mask = maskOf(field, W, H, { share: 0.2 });
  const size = mask.reduce((sum, bit) => sum + bit, 0);
  assert.ok(size > 100 && size < W * H * 0.05, `masked ${size}: the stroke and not the frame`);
  assert.equal(mask[100 * W + 100], 1, "on the stroke");
  assert.equal(mask[10 * W + 10], 0, "off it");
});

test("the mask's size follows the share it was asked for", () => {
  const field = new Float64Array(W * H);
  for (let at = 0; at < field.length; at += 1) field[at] = at;
  const count = (share) => maskOf(field, W, H, { share }).reduce((sum, bit) => sum + bit, 0);
  assert.ok(Math.abs(count(0.1) - W * H * 0.1) < W * H * 0.01);
  assert.ok(count(0.5) > count(0.1));
});

// ------------------------------------------------------------------- the components

test("components are 8-connected and counted apart", () => {
  const mask = new Uint8Array(W * H);
  mask[10 * W + 10] = 1;
  mask[11 * W + 11] = 1; // diagonal: the same component
  mask[50 * W + 50] = 1; // far away: its own
  const { sizes } = componentsOf(mask, W, H);
  assert.deepEqual(sizes.sort((a, b) => b - a), [2, 1]);
});

// ------------------------------------------------------------------------- the arms

test("a star's arms are counted, and the short one is shortest", () => {
  for (const n of [3, 4, 5, 6]) {
    const field = star(n, { short: 1 });
    const mask = maskOf(field, W, H, { share: 0.06 });
    const arms = armsFrom(mask, W, H, MID, 12).filter((arm) => arm.pixels >= 20);
    assert.equal(arms.length, n, `${n} arms`);
    // Sorted by length, and the one drawn at half reach is first.
    const wanted = (1 / n) * Math.PI * 2;
    assert.ok(Math.abs(angleBetween(arms[0].angle, wanted)) < 0.25, `${n}: shortest is arm 1`);
    assert.ok(arms[0].length < arms[1].length * 0.75);
  }
});

test("a spiral arm is measured by its reach and not by a ray", () => {
  // A quarter-turn spiral: a ray from the hub leaves it almost at once, so a ray-walking
  // finder would read this as a stub. Cutting the hub out measures the whole of it.
  const field = blank();
  let last = { x: MID.x + 14, y: MID.y };
  for (let step = 1; step <= 60; step += 1) {
    const angle = step * 0.05;
    const radius = 14 + step * 1.1;
    const next = { x: MID.x + radius * Math.cos(angle), y: MID.y + radius * Math.sin(angle) };
    stroke(field, last, next);
    last = next;
  }
  const mask = maskOf(field, W, H, { share: 0.06 });
  const arms = armsFrom(mask, W, H, MID, 12).filter((arm) => arm.pixels >= 20);
  assert.equal(arms.length, 1);
  assert.ok(arms[0].length > 70, `reach ${arms[0].length.toFixed(0)} should be the spiral's`);
});

test("an arm that is not attached to the hub is not an arm", () => {
  const field = star(3);
  stroke(field, { x: 20, y: 180 }, { x: 40, y: 180 });
  const mask = maskOf(field, W, H, { share: 0.06 });
  const arms = armsFrom(mask, W, H, MID, 12).filter((arm) => arm.pixels >= 20);
  assert.equal(arms.length, 3);
});

// ------------------------------------------------------------------------ the nodes

test("the crossing count tells a tip from a filament from a branch", () => {
  const field = star(3);
  const mask = maskOf(field, W, H, { share: 0.06 });
  assert.ok(armsAt(mask, W, H, MID.x, MID.y, 10) >= 3, "the hub branches");
  // Along one arm, away from the hub and short of the tip: two crossings.
  assert.equal(armsAt(mask, W, H, MID.x + 40, MID.y, 6), 2, "mid-arm is a filament");
  // Past the tip of that arm: the circle catches the arm coming in and nothing else.
  assert.equal(armsAt(mask, W, H, MID.x + 78, MID.y, 6), 1, "the tip is an end");
});

test("nodes are found at branch points and thinned to one apiece", () => {
  const field = star(4);
  // A second hub, well away from the first.
  for (let arm = 0; arm < 3; arm += 1) {
    const angle = (arm / 3) * Math.PI * 2;
    stroke(field, { x: 40, y: 40 }, { x: 40 + 22 * Math.cos(angle), y: 40 + 22 * Math.sin(angle) });
  }
  const mask = maskOf(field, W, H, { share: 0.12 });
  const nodes = nodesIn(field, mask, W, H, { radius: 7, spacing: 12 });
  const near = (x, y) => nodes.filter((n) => Math.hypot(n.x - x, n.y - y) < 12).length;
  assert.equal(near(MID.x, MID.y), 1, "one node at the main hub, not a dozen");
  assert.equal(near(40, 40), 1, "one node at the second hub");
});

// --------------------------------------------------------------------- the features

test("centre, beside and beyond land where the shape says they should", () => {
  // Three long arms and one short one; the short arm carries two nodes of its own, so the
  // wedge has a centre and a beyond, and the other arms supply a beside.
  const field = blank();
  for (const angle of [Math.PI / 2, Math.PI, (3 * Math.PI) / 2]) {
    stroke(field, MID, { x: MID.x + 85 * Math.cos(angle), y: MID.y + 85 * Math.sin(angle) });
  }
  // The short arm runs east; a fork at 30px and another at 55px.
  stroke(field, MID, { x: MID.x + 60, y: MID.y });
  for (const [at, span] of [[30, 12], [55, 10]]) {
    stroke(field, { x: MID.x + at, y: MID.y }, { x: MID.x + at + 6, y: MID.y - span });
    stroke(field, { x: MID.x + at, y: MID.y }, { x: MID.x + at + 6, y: MID.y + span });
  }
  // And a fork on the north arm at the same radius, which is what `beside` should find:
  // the neighbouring feature, at the central node's own distance out.
  stroke(field, { x: MID.x, y: MID.y - 30 }, { x: MID.x - 14, y: MID.y - 36 });
  stroke(field, { x: MID.x, y: MID.y - 30 }, { x: MID.x + 14, y: MID.y - 36 });
  const found = featuresAt(field, W, H, { centre: MID, share: 0.14, inner: 14, nodeRadius: 7 });

  assert.notEqual(found.shortest, null);
  assert.ok(Math.abs(angleBetween(found.shortest.angle, 0)) < 0.3, "the short arm runs east");

  assert.notEqual(found.centre, null);
  assert.ok(found.centre.x > MID.x, "the centre node is out along the short arm");
  assert.ok(Math.abs(found.centre.x - (MID.x + 30)) < 10, "and it is the first fork");

  assert.notEqual(found.beyond, null);
  assert.ok(found.beyond.x > found.centre.x, "beyond is further out than centre");

  assert.notEqual(found.beside, null);
  assert.ok(
    Math.abs(angleBetween(found.beside.angle, found.centre.angle)) > Math.PI / 4,
    "beside is well off the short arm's direction",
  );
});

test("an empty frame refuses rather than guessing", () => {
  const found = featuresAt(blank(), W, H, { centre: MID, share: 0.03 });
  assert.equal(found.centre, null);
  assert.equal(found.beside, null);
});

// ---------------------------------------------------------------------- the geometry

test("angleBetween wraps at the seam", () => {
  assert.ok(Math.abs(angleBetween(Math.PI - 0.1, -Math.PI + 0.1) - -0.2) < 1e-12);
  assert.equal(angleBetween(0.5, 0.5), 0);
});

test("a pixel goes back to the plane through the viewport it was drawn on", () => {
  const view = { x: 0, y: 0, w: 4 };
  const mid = planeAt(view, 200, 100, 99.5, 49.5);
  assert.ok(Math.abs(mid.re) < 1e-12 && Math.abs(mid.im) < 1e-12);
  const right = planeAt(view, 200, 100, 199, 49.5);
  assert.ok(right.re > 1.97 && right.re < 2.0, `right edge ${right.re}`);
  // Rows run downward and the imaginary axis runs up.
  assert.ok(planeAt(view, 200, 100, 99.5, 0).im > 0);
});
