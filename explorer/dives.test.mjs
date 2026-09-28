// The Dive block's rules and Dive results held to their promises: a chain that runs out
// stops, a random draw that lands nowhere is drawn again a bounded number of times, a press the
// reader took the tab from is pressed again, Keep diving runs only where the next press can be
// another picture, the landing mixture draws at the generator's shares, a pasted address is read down to its query, and Dive results is newest first and
// gives its pictures back when cleared.
//
//   node --test explorer/dives.test.mjs

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  B_MODES,
  CARRY_SELF,
  DESCENT,
  DESCEND_SHARE,
  DRY_PRESSES,
  MIXTURE,
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
  mixes,
  queryIn,
  variantOf,
  variantWords,
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

test("a landing the reader moved off before its full pass is pressed again, without a hold", () => {
  assert.deepEqual(loopStep({ landed: true, complete: false }), { go: true, hold: false });
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

test("a press that could not start or threw stops the loop; one the reader took over goes again", () => {
  assert.match(loopStep({ barred: "Dive works on the Mandelbrot set." }).stop, /Mandelbrot/);
  assert.match(loopStep({ error: "boom" }).stop, /boom/);
  assert.deepEqual(loopStep({ superseded: true }), { go: true, hold: false });
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

test("Keep diving runs where a slot is Random, on the descent, or on the mixture, and nowhere else", () => {
  assert.equal(keepable(A.random, "save", B.none), true);
  assert.equal(keepable(A.random, "into", B.here), true);
  assert.equal(keepable(A.pinned, "into", B.random), true);
  assert.equal(keepable(A.live, "into", B.none), true);
  assert.equal(keepable(A.live, "into", B.here), true, "the loop draws B's frame from the mixture");
  assert.equal(keepable(A.paste, "into", B.paste), true);
  assert.equal(keepable(A.live, "save", B.none), false);
  assert.equal(keepable(A.paste, "into", B.none), false);
  assert.equal(keepable(A.pinned, "halfway", B.random), false);
  assert.equal(draws(A.pinned, "halfway", B.random), false, "B's draw is unread off dive into");
  assert.equal(keepBarred(A.random, "into", B.none), null);
  assert.match(keepBarred(A.paste, "into", B.none), /Random/);
});

test("the status line after a round aside names the loop's count and the results'", () => {
  assert.equal(landedSaid(7, 7), "Dive 7 landed; Dive results · 7.");
  assert.equal(landedSaid(3, 24, 8), "Round 3 saved 8; Dive results · 24.");
  assert.equal(landedSaid(1, null), "Dive 1 landed.");
  assert.equal(landedSaid(2, 9, null, "A inside its copy"), "Dive 2 landed (A inside its copy); Dive results · 9.");
});

test("the mixture is B on Random every press, B on a frame only while looping, and never None", () => {
  assert.equal(mixes("into", B.random), true);
  assert.equal(mixes("into", B.here), false, "a single Go does exactly that one dive");
  assert.equal(mixes("into", B.here, true), true);
  assert.equal(mixes("into", B.paste, true), true);
  assert.equal(mixes("into", B.none, true), false);
  assert.equal(mixes("halfway", B.random, true), false);
  assert.equal(mixes("save", B.random, true), false);
});

test("the mixture's shares are the generator's, and add to one", () => {
  assert.ok(Math.abs(MIXTURE.carry + MIXTURE.center + MIXTURE.halfway - 1) < 1e-12);
  assert.equal(MIXTURE.carry, 0.7);
  assert.equal(CARRY_SELF, 0.3);
  assert.equal(DESCEND_SHARE, 0.6);
  assert.deepEqual(DESCENT, [1, 8]);
});

test("a draw lands each way at its share, and a descent goes one to eight rungs down", () => {
  let seed = 3;
  const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const counts = { self: 0, seat: 0, center: 0, halfway: 0, descended: 0, plain: 0 };
  const n = 40000;
  for (let i = 0; i < n; i++) {
    const v = variantOf(B.random, random);
    if (v.landing === "carry") counts[v.carry] += 1;
    else {
      counts[v.landing] += 1;
      if (v.rungs === 0) counts.plain += 1;
      else {
        counts.descended += 1;
        assert.ok(v.rungs >= 1 && v.rungs <= 8 && Number.isInteger(v.rungs));
      }
    }
  }
  const near = (got, want) => Math.abs(got / n - want) < 0.01;
  assert.ok(near(counts.self, 0.7 * 0.3), `self ${counts.self}`);
  assert.ok(near(counts.seat, 0.7 * 0.7), `seat ${counts.seat}`);
  assert.ok(near(counts.center, 0.15) && near(counts.halfway, 0.15));
  assert.ok(near(counts.descended, 0.3 * 0.6));
  for (let i = 0; i < 200; i++) {
    const v = variantOf(B.here, random);
    if (v.landing === "carry") assert.equal(v.carry, "b", "B on a frame carries that frame");
  }
});

test("a variant is named in words", () => {
  assert.equal(variantWords({ landing: "carry", carry: "self", rungs: 0 }), "A inside its copy");
  assert.equal(variantWords({ landing: "carry", carry: "seat", rungs: 0 }), "a random wallpaper inside its copy");
  assert.equal(variantWords({ landing: "carry", carry: "b", rungs: 0 }), "B inside its copy");
  assert.equal(variantWords({ landing: "center", carry: null, rungs: 3 }), "center, 3 rungs down");
  assert.equal(variantWords({ landing: "halfway", carry: null, rungs: 5 }, 1), "halfway in, 1 rung down");
  assert.equal(variantWords({ landing: "center", carry: null, rungs: 0 }), "center");
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
