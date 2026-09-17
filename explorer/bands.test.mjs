// The pool's one claim on the byte-identity chain, held to the committed module.
//
// `README.md` argues that a banded assembly is bit for bit what a whole-frame pass
// produces, because a band is a range of OUTPUT rows and its coordinates are formed
// from the whole viewport with the global row index. Nothing about how many workers
// are in the pool reaches the arithmetic — the pool decides only where the cuts
// fall. That was an argument and not a measurement, and the pool is now sized from
// `navigator.hardwareConcurrency` rather than pinned at eight, so the number of cuts
// is a property of the reader's machine. This runs it.
//
// Two pools, a small one and a large one, over the anchor view: the same frame, cut
// differently, assembled and compared byte for byte. The cut itself comes from
// `render.js` — a test that re-derived it would be testing its own copy.
//
//   node --test explorer/bands.test.mjs
//
// The frame is small on purpose. What is being tested is where the cuts fall, not
// how long the arithmetic takes, and the anchor's iteration cap comes from the
// plane width rather than the pixel count — so a 320x180 frame runs the same depth
// per sample as the 1280x720 one the benches use, at a sixteenth of the samples.

import test from "node:test";
import assert from "node:assert/strict";

import { load, RAMP } from "./bench/engine.mjs";
import { bandsOf, recut } from "./render.js";

/** The hard location deep in the spike that every explorer harness measures on. */
const ANCHOR = {
  center_re: "0.4104135054546244",
  center_im: "0.20967482476903096",
  width: "0.5622541254857749",
};

const { plan, band } = await load();

/**
 * The anchor's field, assembled from the bands a pool of `workers` would be given.
 *
 * `smooth` reads one lane, so a band's bytes are its own rows and nothing else and
 * concatenating them in row order IS the frame. The assertion below keeps that true:
 * a two-lane mode would need the lane-major placement `render.js` does, and this
 * would quietly compare the wrong thing.
 */
function assemble(spec, shape, height, workers) {
  const pieces = bandsOf(height, workers).map(([start, end]) => band(spec, shape, start, end));
  const total = pieces.reduce((sum, piece) => sum + piece.length, 0);
  const frame = new Uint8Array(total);
  let at = 0;
  for (const piece of pieces) {
    frame.set(piece, at);
    at += piece.length;
  }
  return frame;
}

function anchorFrame(width, height, supersample) {
  const spec = {
    schema: 1,
    family: { kind: "mandelbrot" },
    viewport: ANCHOR,
    resolution: [width, height],
    mode: "smooth",
    colormap: RAMP,
    ...(supersample > 1 ? { supersample } : {}),
  };
  const shape = plan(spec);
  assert.ok(shape.ok, shape.why);
  assert.equal(shape.lanes, 1, "this test assembles by concatenation, which needs one lane");
  return { spec, shape };
}

test("a two-worker and a sixteen-worker field of the anchor are the same bytes", () => {
  const [width, height] = [320, 180];
  const { spec, shape } = anchorFrame(width, height, 1);

  const small = bandsOf(height, 2);
  const large = bandsOf(height, 16);
  assert.notDeepEqual(small, large, "the two pools have to cut the frame differently");

  assert.deepEqual(assemble(spec, shape, height, 2), assemble(spec, shape, height, 16));
});

test("and the same above one sample per pixel, where a band is not a row of samples", () => {
  // A band is a range of output rows at every supersample, so the pool's cuts and
  // the sample grid are two different things. At `ss` they come apart, which is the
  // case where a band boundary could reach the arithmetic and does not.
  const [width, height] = [192, 108];
  const { spec, shape } = anchorFrame(width, height, 2);

  assert.deepEqual(assemble(spec, shape, height, 2), assemble(spec, shape, height, 16));
});

/**
 * The pool re-cuts what is still queued when a band reports it cost more than the duration
 * the cut is aimed at, so that abandoning a pass never waits out a long band. That makes a
 * frame one whose cuts are not all decided before it starts, which is a third way of
 * cutting and lands under the same claim as the other two.
 */
test("a queue re-cut partway through is the same rows and the same bytes", () => {
  const [width, height] = [320, 180];
  const { spec, shape } = anchorFrame(width, height, 1);

  const planned = bandsOf(height, 2);
  const finer = recut(planned, 11);
  assert.notDeepEqual(planned, finer, "the re-cut has to cut differently to be worth testing");

  // Exactly the rows that were queued, in order, and none of them twice.
  assert.equal(finer[0][0], 0);
  assert.equal(finer.at(-1)[1], height);
  for (let at = 1; at < finer.length; at++) assert.equal(finer[at][0], finer[at - 1][1]);

  const assembled = finer.map(([start, end]) => band(spec, shape, start, end));
  const total = assembled.reduce((sum, piece) => sum + piece.length, 0);
  const frame = new Uint8Array(total);
  let cursor = 0;
  for (const piece of assembled) {
    frame.set(piece, cursor);
    cursor += piece.length;
  }
  assert.deepEqual(frame, assemble(spec, shape, height, 2));
});

test("a re-cut holds to the floor it is given, and the default floor is the pool's", () => {
  // Overhead is what the row floor is for, and overhead is a duration: eight rows is a
  // message and a copy for nothing at a screen's size, and over a second under a direct
  // trap at a deep zoom — where the floor is the reason a pass cannot be cut fine enough
  // to abandon. So a cut with a measurement behind it passes its own floor of one row.
  for (const [start, end] of recut(bandsOf(720, 4), 1)) assert.ok(end - start >= 8);
  const finest = recut(bandsOf(720, 4), 1, 1);
  assert.ok(finest.length > 720 / 8, "a measured cut can go below the pool's row floor");
  for (const [start, end] of finest) assert.ok(end - start >= 1);
  assert.equal(finest.at(-1)[1], 720, "and still covers the frame exactly");
});

test("the whole frame in one band is the same bytes as any pool's", () => {
  const [width, height] = [320, 180];
  const { spec, shape } = anchorFrame(width, height, 1);

  assert.deepEqual(band(spec, shape, 0, height), assemble(spec, shape, height, 16));
});
