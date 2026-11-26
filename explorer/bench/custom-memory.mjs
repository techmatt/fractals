// What a custom pass costs each worker in memory: a fresh `style.wasm` instance per mode,
// its first example opened, measured whole and one tile drawn, and the memory it grew to
// (004_bug_hunt). A wasm memory never shrinks, so this is what a worker keeps, too.
//
//   node explorer/bench/custom-memory.mjs [640x400] [--only <mode>,…]
//
// `style.js`'s `BYTES_PER_SAMPLE` is the largest `perSample` here with headroom; a new
// mode that reads above it moves that constant (docs/custom-modes.md, *Memory*).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parse, encode } from "../permalink.js";
import { contractOf, exampleQuery, requestOf } from "../style.js";

const here = (name) => fileURLToPath(new URL(`../${name}`, import.meta.url));

const args = process.argv.slice(2);
const at = args.indexOf("--only");
const only = at >= 0 ? args.splice(at, 2)[1].split(",") : null;
const [width, height] = (args[0] ?? "640x400").split("x").map(Number);
const bundle = JSON.parse(readFileSync(here("custom-modes.json"), "utf8"));
const bytes = readFileSync(here("style.wasm"));
const module = await WebAssembly.compile(bytes);
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
for (const mode of bundle.modes) {
  if (only && !only.includes(mode.name)) continue;
  const wasm = (await WebAssembly.instantiate(module, {})).exports;
  const decoder = new TextDecoder();
  const text = (pointer) => {
    pointer >>>= 0;
    const length = new DataView(wasm.memory.buffer).getUint32(pointer, true);
    const value = JSON.parse(decoder.decode(new Uint8Array(wasm.memory.buffer, pointer + 4, length).slice()));
    wasm.dealloc(pointer, length + 4);
    return value;
  };
  const view = parse(exampleQuery(mode, mode.shown[0], { palette: "twilight_shifted", encode }), context);
  const request = requestOf({ bundle, mode, custom: view.custom, view, maxiter: view.maxiter, stopsOf: null, width, height, supersample: 2 });
  const raw = new TextEncoder().encode(JSON.stringify(request));
  const pointer = wasm.alloc(raw.length) >>> 0;
  new Uint8Array(wasm.memory.buffer, pointer, raw.length).set(raw);
  const before = wasm.memory.buffer.byteLength;
  const opened = text(wasm.open(pointer, raw.length));
  const t = performance.now();
  if (opened.post === true) {
    // A post stage reads the whole frame and is drawn in one pass, never tiled.
    const at = wasm.frame(opened.handle);
    wasm.dealloc(at >>> 0, width * height * 4);
  } else {
    text(wasm.measure(opened.handle, 0, 0, 0));
    const [tw, th] = [Math.min(128, width), Math.min(128, height)];
    const at = wasm.tile(opened.handle, 0, 0, tw, th);
    wasm.dealloc(at >>> 0, tw * th * 4);
  }
  wasm.close(opened.handle);
  const after = wasm.memory.buffer.byteLength;
  const samples = width * height * 4;
  console.log(JSON.stringify({ mode: mode.name, width, height, MB: +(after / 1048576).toFixed(1), perSample: Math.round((after - before) / samples), s: +((performance.now() - t) / 1000).toFixed(1) }));
}
