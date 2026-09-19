// The Saved list held to its own promises: a stored value it cannot read is an empty list
// and never a throw, a link is one entry however it was spelled, the cap holds, and an
// import reads every shape an export or a paste can take.
//
//   node --test explorer/saved.test.mjs

import assert from "node:assert/strict";
import { test } from "node:test";

import { KEY, MAX, Saved, VERSION, decode, encode, parseImport, queryOf } from "./saved.js";

/** `localStorage`'s surface over a Map, with a switch that makes it throw. */
function shim(initial = null) {
  const map = new Map(initial === null ? [] : [[KEY, initial]]);
  return {
    map,
    broken: false,
    getItem(key) {
      if (this.broken) throw new Error("SecurityError");
      return map.has(key) ? map.get(key) : null;
    },
    setItem(key, value) {
      if (this.broken) {
        const error = new Error("quota");
        error.name = "QuotaExceededError";
        throw error;
      }
      map.set(key, value);
    },
  };
}

/** A stand-in for the contract's round trip: keys sorted, and anything without `f=`
 *  refused, which is enough to tell two spellings of one link from two links. */
function canonical(query) {
  const params = new URLSearchParams(query);
  if (!params.has("f")) return null;
  return [...params].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join("&");
}

let tick = 0;
const clock = () => new Date(Date.UTC(2026, 8, 18, 0, 0, tick++)).toISOString();

function store(storage = shim()) {
  return new Saved({ storage, canonical, now: clock });
}

test("anything that is not this version's value reads as an empty list", () => {
  for (const text of [null, "", "not json", "null", "[]", "{}", '{"v":2,"items":[]}', '{"v":1,"items":{}}']) {
    assert.deepEqual(decode(text), []);
  }
  const items = decode('{"v":1,"items":[{"link":"f=m"},{"link":7},null,{"link":"f=m"},{"link":"f=j","added":"x"}]}');
  assert.deepEqual(items, [
    { link: "f=m", added: "" },
    { link: "f=j", added: "x" },
  ]);
});

test("a storage that throws on read or write never takes the list down", () => {
  const storage = shim();
  storage.broken = true;
  const saved = store(storage);
  assert.equal(saved.size, 0);
  assert.equal(saved.add("f=m&x=1"), "added");
  assert.equal(saved.size, 1);
  assert.match(saved.failed, /full/);
  storage.broken = false;
  saved.add("f=j");
  assert.equal(saved.failed, null);
  assert.equal(decode(storage.map.get(KEY)).length, 2);
});

test("one picture is one entry, however its link was spelled", () => {
  const storage = shim();
  const saved = store(storage);
  assert.equal(saved.add("x=1&f=m"), "added");
  assert.equal(saved.add("f=m&x=1"), "already");
  assert.equal(saved.add("x=1"), "refused");
  assert.equal(saved.size, 1);
  assert.ok(saved.has("f=m&x=1"));
  assert.equal(saved.toggle("x=1&f=m"), "removed");
  assert.equal(saved.size, 0);
  assert.equal(saved.toggle("f=m&x=1"), "added");
  // Written on every change, and read back by a second store over the same storage.
  assert.deepEqual(store(storage).items.map((item) => item.link), ["f=m&x=1"]);
  assert.equal(JSON.parse(storage.map.get(KEY)).v, VERSION);
});

test("newest first, and a merge keeps a batch's order ahead of what was there", () => {
  const saved = store();
  saved.add("f=a");
  saved.add("f=b");
  assert.deepEqual(saved.items.map((item) => item.link), ["f=b", "f=a"]);
  const tally = saved.merge([{ link: "f=c" }, { link: "f=d" }, { link: "f=a" }, { link: "nope" }]);
  assert.deepEqual(tally, { added: 2, already: 1, refused: 1, full: 0 });
  assert.deepEqual(saved.items.map((item) => item.link), ["f=c", "f=d", "f=b", "f=a"]);
});

test("the cap holds, and nothing already saved is evicted by it", () => {
  const items = Array.from({ length: MAX - 1 }, (_, i) => ({ link: `f=m&i=${i}`, added: "2026" }));
  const saved = store(shim(encode(items)));
  assert.equal(saved.size, MAX - 1);
  assert.equal(saved.add("f=m&i=new"), "added");
  assert.ok(saved.full);
  assert.equal(saved.add("f=m&i=more"), "full");
  assert.deepEqual(saved.merge([{ link: "f=j&a=1" }, { link: "f=j&a=2" }]).full, 2);
  assert.equal(saved.size, MAX);
});

test("persistence is asked for once, on the first save", () => {
  let asked = 0;
  const saved = new Saved({ storage: shim(), canonical, now: clock, persist: () => (asked += 1) });
  saved.add("f=a");
  saved.add("f=b");
  saved.merge([{ link: "f=c" }]);
  assert.equal(asked, 1);
});

test("an import reads an export, a JSON list, and pasted lines of links", () => {
  const exported = store();
  exported.add("f=a");
  exported.add("f=b");
  const back = parseImport(exported.exported());
  assert.deepEqual(back.map((entry) => entry.link), ["f=b", "f=a"]);
  assert.ok(back.every((entry) => typeof entry.added === "string"));

  assert.deepEqual(parseImport('["?f=a", {"link": "f=b"}, 3]').map((entry) => entry.link), ["f=a", "f=b", ""]);
  const pasted = parseImport(
    "https://techmatt.github.io/fractal-website/explorer/?f=m&x=1#top\n\n  ?f=j\r\nf=p&y=2 ",
  );
  assert.deepEqual(pasted.map((entry) => entry.link), ["f=m&x=1", "f=j", "f=p&y=2"]);
  assert.deepEqual(parseImport("   "), []);
  assert.equal(queryOf("explorer/index.html?f=m"), "f=m");
});

test("clear empties the list and writes it", () => {
  const storage = shim();
  const saved = store(storage);
  saved.add("f=a");
  let heard = 0;
  saved.subscribe(() => (heard += 1));
  saved.clear();
  assert.equal(saved.size, 0);
  assert.equal(heard, 1);
  assert.deepEqual(decode(storage.map.get(KEY)), []);
});
