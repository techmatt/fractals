// Every example location of every custom mode, drawn through the explorer's own request
// path under Node, for `custom-compare.py` to hold against the pipeline's picture.
//
//   node explorer/bench/custom-parity.mjs <out dir> [--size 640x400] [--shard i/n] [--stack keep|mode]
//
// Each example goes the page's way: `exampleQuery` writes its link, `permalink.parse` reads
// it back as a view, and `requestOf` turns the view into the module's request, which
// `style.wasm` (the committed module) then draws as the pool draws: one exact `measure`, then
// `TILE`-sized tiles stitched. `--stack keep` swaps in the stack the keep was drawn with (the
// bundle's `shown[].stack`), which is what the byte comparison against the native picture
// needs; `--stack mode` keeps the custom state the example opens with, the published look.
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
mkdirSync(out, { recursive: true });

const bundle = JSON.parse(readFileSync(here("custom-modes.json"), "utf8"));
const { instance } = await WebAssembly.instantiate(readFileSync(here("style.wasm")), {});
const wasm = instance.exports;
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const text = (pointer) => {
  pointer >>>= 0;
  const length = new DataView(wasm.memory.buffer).getUint32(pointer, true);
  const value = JSON.parse(decoder.decode(new Uint8Array(wasm.memory.buffer, pointer + 4, length).slice()));
  wasm.dealloc(pointer, length + 4);
  return value;
};

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
    const id = `${mode.style}__${order}`;
    if (which === "mode" && !offered.has(order)) continue;
    if (index++ % shards !== shard) continue;
    const row = { id, mode: mode.name, keep: shown.keep, stack: which };
    try {
      const query = exampleQuery(mode, shown, { palette: "twilight_shifted", encode });
      const view = parse(query, context);
      row.query = query;
      row.reached = exampleCustom(mode, shown).reached;
      const custom = view.custom;
      const drawn = which === "keep" ? { ...mode, stack: shown.stack } : mode;
      const request = requestOf({
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
      });
      const raw = encoder.encode(JSON.stringify(request));
      const pointer = wasm.alloc(raw.length);
      new Uint8Array(wasm.memory.buffer, pointer, raw.length).set(raw);
      const opened = text(wasm.open(pointer, raw.length));
      wasm.dealloc(pointer, raw.length);
      if (!opened.ok) throw new Error(opened.why);
      let started = performance.now();
      const measured = text(wasm.measure(opened.handle, 0, 0, 0));
      if (!measured.ok) throw new Error(measured.why);
      row.measure = (performance.now() - started) / 1000;
      started = performance.now();
      const picture = new Uint8Array(width * height * 4);
      for (const tile of tilesOf(width, height)) {
        const length = tile.width * tile.height * 4;
        const at = wasm.tile(opened.handle, tile.x, tile.y, tile.width, tile.height) >>> 0;
        if (at === 0) throw new Error(text(wasm.last_error()));
        const rgba = new Uint8Array(wasm.memory.buffer.slice(at, at + length));
        wasm.dealloc(at, length);
        for (let r = 0; r < tile.height; r++) {
          picture.set(rgba.subarray(r * tile.width * 4, (r + 1) * tile.width * 4), ((tile.y + r) * width + tile.x) * 4);
        }
      }
      row.tiles = (performance.now() - started) / 1000;
      wasm.close(opened.handle);
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
