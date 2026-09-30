// The pointer bookkeeping, held to its promises. `node --test explorer/pointers.test.mjs`.
//
// Two canvases take a pinch through this, and the one bug it has had was an order: the
// lifted pointer forgotten before the pinch was measured. So what is worth testing is that
// a lift measures first and leaves nothing behind, whichever finger it is and however many
// were down.

import assert from "node:assert/strict";
import test from "node:test";

import { tracker } from "./pointers.js";

test("one pointer is a drag and measures no pinch", () => {
  const touches = tracker();
  assert.equal(touches.press(1, { x: 10, y: 10 }, true), "drag");
  assert.equal(touches.pinching, false);
  assert.equal(touches.pinched(), null);
  assert.equal(touches.move(1, { x: 30, y: 10 }), true);
  assert.deepEqual(touches.lift(1), { pinch: false, measured: null });
  assert.equal(touches.lift(1), null);
});

test("a move from a pointer that is not down is not tracked", () => {
  const touches = tracker();
  assert.equal(touches.move(7, { x: 0, y: 0 }), false);
  touches.press(1, { x: 0, y: 0 }, true);
  assert.equal(touches.move(7, { x: 5, y: 5 }), false);
});

test("a second pointer is a pinch, measured against the press", () => {
  const touches = tracker();
  touches.press(1, { x: 100, y: 100 }, true);
  assert.equal(touches.press(2, { x: 200, y: 100 }, false), "pinch");
  assert.equal(touches.pinching, true);
  assert.deepEqual(touches.pinched(), { ratio: 1, mid: { x: 150, y: 100 }, held: { x: 150, y: 100 } });
  touches.move(1, { x: 50, y: 120 });
  touches.move(2, { x: 250, y: 120 });
  assert.deepEqual(touches.pinched(), { ratio: 2, mid: { x: 150, y: 120 }, held: { x: 150, y: 100 } });
});

test("a lift measures the pinch before it forgets the pointer, and ends it", () => {
  for (const first of [1, 2]) {
    const touches = tracker();
    touches.press(1, { x: 100, y: 100 }, true);
    touches.press(2, { x: 200, y: 100 }, false);
    touches.move(2, { x: 400, y: 100 });
    const lifted = touches.lift(first);
    assert.equal(lifted.pinch, true);
    assert.deepEqual(lifted.measured, { ratio: 3, mid: { x: 250, y: 100 }, held: { x: 150, y: 100 } });
    assert.equal(touches.pinching, false);
    // The finger still down is nobody's: not a drag, and its own lift says nothing.
    const other = first === 1 ? 2 : 1;
    assert.equal(touches.move(other, { x: 0, y: 0 }), false);
    assert.equal(touches.lift(other), null);
  }
});

test("a pan after a pinch is a drag again", () => {
  const touches = tracker();
  touches.press(1, { x: 100, y: 100 }, true);
  touches.press(2, { x: 200, y: 100 }, false);
  touches.lift(1);
  assert.equal(touches.press(3, { x: 50, y: 50 }, true), "drag");
  assert.equal(touches.pinched(), null);
  assert.deepEqual(touches.lift(3), { pinch: false, measured: null });
});

test("a first finger starts from nothing, whatever was left down", () => {
  const touches = tracker();
  touches.press(1, { x: 100, y: 100 }, true);
  // Its release never arrives. The next first finger is still a drag, not half a pinch.
  assert.equal(touches.press(2, { x: 300, y: 300 }, true), "drag");
  assert.equal(touches.pinching, false);
  assert.equal(touches.move(1, { x: 0, y: 0 }), false);
});

test("a third finger changes nothing, and a lift with three down measures nothing", () => {
  const touches = tracker();
  touches.press(1, { x: 100, y: 100 }, true);
  touches.press(2, { x: 200, y: 100 }, false);
  assert.equal(touches.press(3, { x: 150, y: 200 }, false), null);
  assert.equal(touches.pinching, true);
  assert.equal(touches.pinched(), null);
  assert.deepEqual(touches.lift(3), { pinch: true, measured: null });
  assert.equal(touches.pinching, false);
});
