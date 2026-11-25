// Every example location of every custom mode, drawn through the explorer's own request
// path under Node, for `custom-compare.py` to hold against the pipeline's picture.
//
//   node explorer/bench/custom-parity.mjs <out dir> [--size 640x400] [--shard i/n] [--stack keep|mode]
//                                         [--only <mode or id>,…] [--palette <entry>]
//
// `--palette` draws each example on that entry of its mode's set instead of the one it opens
// on (under `--stack mode`), as a swatch press does, and names it `<id>@<entry>`: how a palette
// entry no Example opens on is held to `custom-natives.mjs --palette`'s picture.
// Each example goes the page's way: `exampleQuery` writes its link, `permalink.parse` reads
// it back as a view, and `requestOf` turns the view into the module's request, which
// `style.wasm` (the committed module) then draws as the pool draws: one exact `measure` in a
// keeper instance, shared through `export_measure`/`import_measure` with a helper instance,
// then `TILE`-sized tiles stitched, every other one the helper's. Under `--palette` the
// keeper measures the example as it opens and `recolour`s to the entry, as a swatch press
// does (a refusal measures afresh, and the row says `recoloured: false`). `--stack keep`
// swaps in the stack the keep was drawn with (the bundle's `shown[].stack`), which is what
// the byte comparison against the native picture needs; `--stack mode` keeps the custom state the example opens with, the published look.
// Writes `<id>.rgba` and one `results.jsonl` line per example. One thread a process; shard
// across processes for speed.

import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { parse, encode } from "../permalink.js";
import { contractOf, exampleCustom, exampleQuery, offeredExamples, requestOf, tilesOf, SUPERSAMPLE } from "../style.js";

const here = (name) => fileURLToPath(new URL(`../${name}`, import.meta.url));
const args = process.argv.slice(2);
const out = args[0];
const option = (name, fallback) => {
  const at = args.indexOf(name);
  return at === -1 ? fallback : args[at + 1];
};
const [width, height] = option("--size", "640x400").split("x").map(Number);
const [shard, shards] = option("--shard", "0/1").split("/").map(Number);
const which = option("--stack", "keep");
const only = option("--only", null)?.split(",") ?? null;
const entry = option("--palette", null);
if (entry !== null && which !== "mode") throw new Error("--palette draws the published stack: pass --stack mode");
mkdirSync(out, { recursive: true });

const bundle = JSON.parse(readFileSync(here("custom-modes.json"), "utf8"));
// Two instances, as two of the pool's workers: the keeper measures (or recolours) and
// shares its measure; the helper takes it and draws every other tile.
const compiled = await WebAssembly.compile(readFileSync(here("style.wasm")));
const encoder = new TextEncoder();
const decoder = new TextDecoder();
function instance() {
  const wasm = new WebAssembly.Instance(compiled, {}).exports;
  // `last_error` is a plain sentence; every other answer is JSON.
  const plain = (pointer) => {
    pointer >>>= 0;
    const length = new DataView(wasm.memory.buffer).getUint32(pointer, true);
    const value = decoder.decode(new Uint8Array(wasm.memory.buffer, pointer + 4, length).slice());
    wasm.dealloc(pointer, length + 4);
    return value;
  };
  const text = (pointer) => JSON.parse(plain(pointer));
  /** `name(handle, ptr, len)` over `raw` copied in, its JSON answer out. */
  const send = (name, handle, raw) => {
    const pointer = wasm.alloc(raw.length);
    new Uint8Array(wasm.memory.buffer, pointer, raw.length).set(raw);
    const answer = handle === null ? text(wasm[name](pointer, raw.length)) : text(wasm[name](handle, pointer, raw.length));
    wasm.dealloc(pointer, raw.length);
    return answer;
  };
  const open = (request) => {
    const opened = send("open", null, encoder.encode(JSON.stringify(request)));
    if (!opened.ok) throw new Error(opened.why);
    return opened;
  };
  const exported = (handle) => {
    const pointer = wasm.export_measure(handle) >>> 0;
    if (pointer === 0) throw new Error(plain(wasm.last_error()));
    const length = new DataView(wasm.memory.buffer).getUint32(pointer, true);
    const bytes = new Uint8Array(wasm.memory.buffer.slice(pointer + 4, pointer + 4 + length));
    wasm.dealloc(pointer, length + 4);
    return bytes;
  };
  return { wasm, plain, text, send, open, exported };
}
const keeper = instance();
const helper = instance();

// The parse context: only what an example link names is ever read, so `home` and
// `constants` answer for any family without the engine, and `palettes` is the one map an
// example link carries. `p` is never drawn while Matched palette is on.
const written = (value) => ({ text: value, value: Number(value) });
const context = {
  home: () => ({ x: written("0"), y: written("0"), w: written("3") }),
  constants: () => ({ cx: written("0"), cy: written("0") }),
  palettes: new Map([["twilight_shifted", { cyclic: true }]]),
  defaultPalette: "twilight_shifted",
  settled: () => ({}),
  curve: () => null,
  customs: contractOf(bundle),
};

let index = 0;
for (const mode of bundle.modes) {
  // Under `--stack mode` only the buttons the page offers: a keep it does not offer draws
  // another button's picture, and has no native of its own in `custom-natives.mjs`'s set.
  const offered = new Set(offeredExamples(mode, encode).map(({ index: at }) => at));
  for (const [order, shown] of mode.shown.entries()) {
    const keepId = `${mode.style}__${order}`;
    const id = entry === null ? keepId : `${keepId}@${entry}`;
    if (which === "mode" && !offered.has(order)) continue;
    if (only && !only.includes(mode.name) && !only.includes(mode.style) && !only.includes(keepId)) continue;
    if (entry !== null && !mode.palettes?.some((each) => each.colormap === entry)) continue;
    if (index++ % shards !== shard) continue;
    const row = { id, mode: mode.name, keep: shown.keep, stack: which };
    try {
      const query = exampleQuery(mode, shown, { palette: "twilight_shifted", encode });
      const view = parse(query, context);
      row.query = query;
      row.reached = exampleCustom(mode, shown).reached;
      const custom = entry === null ? view.custom : { ...view.custom, palette: entry, matched: true };
      const drawn = which === "keep" ? { ...mode, stack: shown.stack } : mode;
      const made = {
        bundle,
        mode: drawn,
        custom: which === "keep" ? { ...custom, knobs: {}, autotone: true } : custom,
        view,
        maxiter: view.maxiter,
        stopsOf: () => {
          throw new Error("an example draws its matched map");
        },
        width,
        height,
        supersample: SUPERSAMPLE,
      };
      const request = requestOf(made);
      // With `--palette`, the page's swatch press: the example as it opens is measured, and
      // the entry is a recolour of that frame (measured afresh where the module refuses).
      const opensOn = entry === null ? null : requestOf({ ...made, custom: which === "keep" ? { ...view.custom, knobs: {}, autotone: true } : view.custom });
      const opened = keeper.open(opensOn ?? request);
      let started = performance.now();
      let picture = new Uint8Array(width * height * 4);
      const pixels = (side, at, length) => {
        if (at === 0) throw new Error(side.plain(side.wasm.last_error()));
        const out = new Uint8Array(side.wasm.memory.buffer.slice(at, at + length));
        side.wasm.dealloc(at, length);
        return out;
      };
      let helped = null;
      if (opened.post === true) {
        // A post stage reads the whole frame: one pass, as the page draws it (`StylePool`).
        if (opensOn !== null) {
          keeper.wasm.close(opened.handle);
          Object.assign(opened, keeper.open(request));
        }
        picture = pixels(keeper, keeper.wasm.frame(opened.handle) >>> 0, width * height * 4);
        row.whole = (performance.now() - started) / 1000;
      } else {
        const measured = keeper.text(keeper.wasm.measure(opened.handle, 0, 0, 0));
        if (!measured.ok) throw new Error(measured.why);
        if (opensOn !== null) {
          const recoloured = keeper.send("recolour", opened.handle, encoder.encode(JSON.stringify(request)));
          row.recoloured = recoloured.ok;
          if (!recoloured.ok) {
            row.refused = recoloured.why;
            keeper.wasm.close(opened.handle);
            Object.assign(opened, keeper.open(request));
            const again = keeper.text(keeper.wasm.measure(opened.handle, 0, 0, 0));
            if (!again.ok) throw new Error(again.why);
          }
        }
        row.measure = (performance.now() - started) / 1000;
        // The measure shared, as the pool shares it: the helper draws every other tile.
        helped = helper.open(request);
        const taken = helper.send("import_measure", helped.handle, keeper.exported(opened.handle));
        if (!taken.ok) throw new Error(taken.why);
        started = performance.now();
        for (const [n, tile] of tilesOf(width, height).entries()) {
          const [side, handle] = n % 2 === 0 ? [keeper, opened.handle] : [helper, helped.handle];
          const at = side.wasm.tile(handle, tile.x, tile.y, tile.width, tile.height) >>> 0;
          const rgba = pixels(side, at, tile.width * tile.height * 4);
          for (let r = 0; r < tile.height; r++) {
            picture.set(rgba.subarray(r * tile.width * 4, (r + 1) * tile.width * 4), ((tile.y + r) * width + tile.x) * 4);
          }
        }
        row.tiles = (performance.now() - started) / 1000;
      }
      keeper.wasm.close(opened.handle);
      if (helped) helper.wasm.close(helped.handle);
      writeFileSync(join(out, `${id}.rgba`), picture);
      row.ok = true;
    } catch (error) {
      row.ok = false;
      row.why = String(error?.message ?? error);
    }
    appendFileSync(join(out, "results.jsonl"), JSON.stringify(row) + "\n");
    console.log(JSON.stringify(row));
  }
}
