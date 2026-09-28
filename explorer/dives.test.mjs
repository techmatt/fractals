// Keep diving's loop and the Dives collection held to their promises: a chain that runs out
// stops, a random draw that lands nowhere is drawn again a bounded number of times, anything
// that takes the tab over stops it, and Dives is newest first, carries its own pictures, and
// is shown through the gallery's own seams rather than a copy of them.
//
//   node --test explorer/dives.test.mjs

import assert from "node:assert/strict";
import { test } from "node:test";

import { DRY_PRESSES, HOLD_MS, NAME, add, chains, collection, fixed, landedSaid, loopStep } from "./dives.js";
import { isSession, membersOf, tileURL } from "./gallery.js";

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

test("only this view with a centred landing descends; every other sentence draws aside", () => {
  assert.equal(chains("view", "center"), true);
  assert.equal(chains("view", "halfway"), true);
  for (const [from, to] of [["view", "view"], ["view", "seat"], ["seat", "center"], ["seat", "halfway"], ["seat", "view"], ["seat", "seat"]]) {
    assert.equal(chains(from, to), false, `${from} / ${to}`);
  }
});

test("a loop drawing aside presses again at once, with no landing on screen to hold", () => {
  assert.deepEqual(loopStep({ landed: true, complete: true }, 0, { aside: true }), { go: true, hold: false });
});

test("this view inside a copy near this view stops after one landing unless it is recolored", () => {
  assert.equal(fixed("view", "view"), true);
  assert.equal(fixed("seat", "view"), false);
  assert.equal(fixed("view", "seat"), false);
  const next = loopStep({ landed: true, complete: true }, 0, { aside: true, repeats: true });
  assert.match(next.stop, /same place every time/);
});

test("the status line after a landing aside names the loop's count and the collection's", () => {
  assert.equal(landedSaid(7, 7), "Dive 7 landed; Dives · 7.");
  assert.equal(landedSaid(3, 9), "Dive 3 landed; Dives · 9.");
  assert.equal(landedSaid(1, null), "Dive 1 landed.");
});

function landing(n) {
  return {
    link: `dv=3&x=-0.${n}&y=0.1&w=1e-12&n=1000&p=BuGn`,
    family: "mandelbrot",
    palette: "BuGn",
    landing: n % 2 === 0 ? "center" : "view",
    said: `landing ${n}`,
    thumb: `blob:thumb-${n}`,
    picture: `blob:picture-${n}`,
    width: 316,
    height: 178,
  };
}

test("Dives is a session collection, empty until its first landing", () => {
  const dives = collection();
  assert.equal(dives.name, NAME);
  assert.equal(dives.seats, 0);
  assert.equal(isSession(dives), true);
  assert.equal(isSession({ name: "general", axis: "general" }), false);
});

test("Dives is newest first, in the gallery's own presentation order", () => {
  const dives = collection();
  for (const n of [1, 2, 3]) add(dives, landing(n));
  assert.equal(dives.seats, 3);
  const order = membersOf(dives.rows, NAME).map((row) => row.said);
  assert.deepEqual(order, ["landing 3", "landing 2", "landing 1"]);
  assert.equal(new Set(dives.rows.map((row) => row.key)).size, 3);
});

test("a dive row is deep, carries its link as given, and is centred only on a centred landing", () => {
  const dives = collection();
  const centred = add(dives, landing(2));
  const carried = add(dives, landing(3));
  assert.equal(centred.deep, true);
  assert.equal(centred.link, landing(2).link);
  assert.equal(centred.centered, true);
  assert.equal(carried.centered, false);
  assert.equal(centred.hue, null);
  assert.deepEqual(centred.hues, []);
});

test("a dive's tile is the picture it carries; a seat's is its file", () => {
  const dives = collection();
  const row = add(dives, landing(1));
  assert.equal(tileURL(row, "http://localhost/explorer/"), "blob:thumb-1");
  const seat = { file: "0123.webp" };
  assert.match(tileURL(seat, "http://localhost/explorer/gallery.js"), /galleries\/seated-candidates\/0123\.webp$/);
});
