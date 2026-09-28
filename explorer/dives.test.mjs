// The Dive block's rules and Dive results held to their promises: a chain that runs out
// stops, a random draw that lands nowhere is drawn again a bounded number of times, anything
// that takes the tab over stops it, Keep diving runs only where the next press can be another
// picture, a pasted address is read down to its query, and Dive results is newest first and
// gives its pictures back when cleared.
//
//   node --test explorer/dives.test.mjs

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  B_MODES,
  DRY_PRESSES,
  HOLD_MS,
  Results,
  SAVE_COUNT,
  chains,
  draws,
  keepBarred,
  keepable,
  landedSaid,
  live,
  loopStep,
  queryIn,
} from "./dives.js";

const A = {
  live: { mode: "here", pinned: false },
  pinned: { mode: "here", pinned: true },
  paste: { mode: "paste", pinned: false },
  random: { mode: "random", pinned: false },
};
const B = Object.fromEntries(B_MODES.map((mode) => [mode, { mode }]));

test("a landing drawn to the end is held and pressed again", () => {
  assert.deepEqual(loopStep({ landed: true, complete: true }), { go: true, hold: true });
  assert.ok(HOLD_MS > 0);
});

test("a landing stopped before its full pass stops the loop", () => {
  assert.ok(loopStep({ landed: true, complete: false }).stop);
});

test("a chain that runs out near this view stops, and says so", () => {
  const next = loopStep({ refused: "No copy near this view is a step down.", random: false });
  assert.match(next.stop, /^The chain ran out\. No copy near this view/);
});

test("a random draw that landed nowhere presses again, without a hold", () => {
  assert.deepEqual(loopStep({ refused: "none would do", random: true }, 0), { go: true, hold: false });
});

test("random presses that land nowhere stop after DRY_PRESSES in a row", () => {
  const outcome = { refused: "none would do", random: true };
  for (let dry = 0; dry < DRY_PRESSES - 1; dry++) assert.equal(loopStep(outcome, dry).go, true);
  assert.match(loopStep(outcome, DRY_PRESSES - 1).stop, new RegExp(`${DRY_PRESSES} presses in a row`));
});

test("a plane with no wallpapers is permanent, random or not", () => {
  assert.ok(loopStep({ refused: "No wallpaper in the gallery is on this plane.", random: true, permanent: true }).stop);
});

test("a press that could not start, threw, or was taken over stops the loop", () => {
  assert.match(loopStep({ barred: "Dive works on the Mandelbrot set." }).stop, /Mandelbrot/);
  assert.match(loopStep({ error: "boom" }).stop, /boom/);
  assert.ok(loopStep({ superseded: true }).stop);
});

test("a loop drawing aside presses again at once, with no landing on screen to hold", () => {
  assert.deepEqual(loopStep({ landed: true, complete: true }, 0, { aside: true }), { go: true, hold: false });
});

test("A is live only on Here before it is pinned", () => {
  assert.equal(live(A.live), true);
  assert.equal(live(A.pinned), false);
  assert.equal(live(A.paste), false);
  assert.equal(live(A.random), false);
});

test("only a live A with a centred landing descends", () => {
  assert.equal(chains(A.live, "into", B.none), true);
  assert.equal(chains(A.live, "halfway", B.none), true);
  assert.equal(chains(A.live, "halfway", B.random), true, "B is not read by the symmetry point");
  for (const b of ["here", "paste", "random"]) assert.equal(chains(A.live, "into", B[b]), false, b);
  for (const a of ["pinned", "paste", "random"]) assert.equal(chains(A[a], "into", B.none), false, a);
  assert.equal(chains(A.live, "save", B.none), false);
});

test("Keep diving runs where a slot is Random, or on the descent, and nowhere else", () => {
  assert.equal(keepable(A.random, "save", B.none), true);
  assert.equal(keepable(A.random, "into", B.here), true);
  assert.equal(keepable(A.pinned, "into", B.random), true);
  assert.equal(keepable(A.live, "into", B.none), true);
  assert.equal(keepable(A.live, "save", B.none), false);
  assert.equal(keepable(A.paste, "into", B.none), false);
  assert.equal(keepable(A.live, "into", B.here), false);
  assert.equal(draws(A.pinned, "halfway", B.random), false, "B's draw is unread off dive into");
  assert.equal(keepBarred(A.random, "into", B.none), null);
  assert.match(keepBarred(A.paste, "into", B.none), /Random/);
});

test("the status line after a round aside names the loop's count and the results'", () => {
  assert.equal(landedSaid(7, 7), "Dive 7 landed; Dive results · 7.");
  assert.equal(landedSaid(3, 24, 8), "Round 3 saved 8; Dive results · 24.");
  assert.equal(landedSaid(1, null), "Dive 1 landed.");
});

test("a pasted address is read down to its query", () => {
  const query = "dv=3&x=-0.75&y=0.1&w=1e-12&n=1000";
  assert.equal(queryIn(`https://techmatt.github.io/fractals/explorer/?${query}`), query);
  assert.equal(queryIn(`http://localhost:8000/explorer/index.html?${query}#top`), query);
  assert.equal(queryIn(`  ?${query}\n`), query);
  assert.equal(queryIn(query), query);
  assert.equal(queryIn("https://techmatt.github.io/fractals/explorer/"), null);
  assert.equal(queryIn("a sentence with no link in it"), null);
  assert.equal(queryIn(""), null);
  assert.equal(queryIn(null), null);
});

test("Dive results is newest first, and Clear gives every picture back", () => {
  const released = [];
  const results = new Results((thumb) => released.push(thumb));
  for (const n of [1, 2, 3]) {
    results.add({ link: `dv=3&x=0.${n}`, thumb: `blob:${n}`, said: `landing ${n}`, width: 316, height: 178 });
  }
  assert.equal(results.size, 3);
  assert.deepEqual(results.rows.map((row) => row.said), ["landing 3", "landing 2", "landing 1"]);
  assert.equal(new Set(results.rows.map((row) => row.key)).size, 3);
  results.clear();
  assert.equal(results.size, 0);
  assert.deepEqual(released.sort(), ["blob:1", "blob:2", "blob:3"]);
  const after = results.add({ link: "dv=3&x=0.4", thumb: "blob:4", said: "landing 4", width: 316, height: 178 });
  assert.equal(after.key, "dive-4", "a key is never reused, even across a Clear");
});

test("save those minibrots keeps about eight", () => {
  assert.ok(SAVE_COUNT >= 6 && SAVE_COUNT <= 10);
});
