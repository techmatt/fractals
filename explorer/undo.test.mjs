// The way back held to its own promises: one action is one entry however many times it
// settles, a step back and forward lands on the same picture, a new action after a step
// back drops what was ahead, and the cap evicts from the end nobody is standing on.
//
//   node --test explorer/undo.test.mjs

import assert from "node:assert/strict";
import { test } from "node:test";

import { MAX, Trail } from "./undo.js";

/** The links of every entry, oldest first — what a test asserts the shape of. */
function links(trail) {
  return trail.entries.map(({ entry }) => entry.query);
}

test("an empty trail has nowhere to go", () => {
  const trail = new Trail();
  assert.equal(trail.current, null);
  assert.equal(trail.currentKey, null);
  assert.equal(trail.canBack, false);
  assert.equal(trail.canForward, false);
  assert.equal(trail.back(), null);
  assert.equal(trail.forward(), null);
});

test("a settle on the picture under the cursor refreshes it rather than pushing", () => {
  const trail = new Trail();
  // One action, settling twice: the picture, and then the same picture with the tone its
  // pass measured. Same key, because the key is the query with the measurements dropped.
  trail.commit("a", { query: "f=m&x=0", opts: {} });
  assert.equal(trail.commit("a", { query: "f=m&x=0&lv=p3", opts: {} }), "refreshed");
  assert.deepEqual(links(trail), ["f=m&x=0&lv=p3"]);
  assert.equal(trail.at, 0);
  assert.equal(trail.canBack, false);
});

test("a refresh keeps what is ahead of the cursor", () => {
  const trail = new Trail();
  trail.commit("a", { query: "a", opts: {} });
  trail.commit("b", { query: "b", opts: {} });
  trail.back();
  // Restoring "a" settles on "a": the step back must not throw "b" away.
  assert.equal(trail.commit("a", { query: "a&lv=p3", opts: {} }), "refreshed");
  assert.deepEqual(links(trail), ["a&lv=p3", "b"]);
  assert.equal(trail.canForward, true);
});

test("back and forward walk the pictures in order", () => {
  const trail = new Trail();
  for (const key of ["a", "b", "c"]) trail.commit(key, { query: key, opts: {} });
  assert.equal(trail.back().query, "b");
  assert.equal(trail.back().query, "a");
  assert.equal(trail.back(), null, "the oldest picture is the end of the way back");
  assert.equal(trail.forward().query, "b");
  assert.equal(trail.forward().query, "c");
  assert.equal(trail.forward(), null, "the newest picture is the end of the way forward");
});

test("a new action after a step back drops what was ahead", () => {
  const trail = new Trail();
  for (const key of ["a", "b", "c"]) trail.commit(key, { query: key, opts: {} });
  trail.back();
  trail.back();
  assert.equal(trail.commit("d", { query: "d", opts: {} }), "pushed");
  assert.deepEqual(links(trail), ["a", "d"]);
  assert.equal(trail.canForward, false);
});

test("an entry carries what the picture was opened with", () => {
  const trail = new Trail();
  trail.commit("a", { query: "a", opts: { key: "seat-7", what: "this wallpaper" } });
  assert.deepEqual(trail.current.opts, { key: "seat-7", what: "this wallpaper" });
});

test("the cap evicts from the front, and the cursor goes with it", () => {
  const trail = new Trail({ max: 3 });
  for (const key of ["a", "b", "c", "d", "e"]) trail.commit(key, { query: key, opts: {} });
  assert.deepEqual(links(trail), ["c", "d", "e"]);
  assert.equal(trail.current.query, "e");
  assert.equal(trail.back().query, "d");
  assert.equal(trail.back().query, "c");
  assert.equal(trail.back(), null);
});

test("the cap is a few hundred pictures", () => {
  assert.equal(MAX, 300);
  const trail = new Trail();
  for (let i = 0; i < MAX + 10; i++) trail.commit(`k${i}`, { query: `k${i}`, opts: {} });
  assert.equal(trail.entries.length, MAX);
  assert.equal(trail.entries[0].key, "k10");
});
