// A minimal Node wrapper over the committed module: the same three calls
// `explorer/render.js` makes, without a browser, a worker pool or a canvas.
//
// This exists so the kernel can be timed and every family/mode pair exercised
// headlessly. It is deliberately NOT the page's renderer — it is the shortest
// thing that speaks the same boundary.

import { readFileSync } from "node:fs";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export async function load(url = new URL("../engine.wasm", import.meta.url)) {
  const wasm = (await WebAssembly.instantiate(readFileSync(url), {})).instance.exports;

  const put = (text) => {
    const raw = encoder.encode(text);
    const pointer = wasm.alloc(raw.length);
    new Uint8Array(wasm.memory.buffer, pointer, raw.length).set(raw);
    return [pointer, raw.length];
  };

  const plan = (spec) => {
    const [pointer, length] = put(JSON.stringify(spec));
    const out = wasm.plan(pointer, length);
    wasm.dealloc(pointer, length);
    const size = new DataView(wasm.memory.buffer).getUint32(out, true);
    const text = decoder.decode(new Uint8Array(wasm.memory.buffer, out + 4, size));
    wasm.dealloc(out, size + 4);
    return JSON.parse(text);
  };

  const band = (spec, shape, rowStart, rowEnd) => {
    const [pointer, length] = put(JSON.stringify(spec));
    const out = wasm.compute_band(pointer, length, rowStart, rowEnd);
    wasm.dealloc(pointer, length);
    if (out === 0) throw new Error("compute_band refused");
    const rows = rowEnd - rowStart;
    const [width] = spec.resolution;
    const bytes = shape.direct ? rows * width * 4 : rows * width * shape.lanes * 8;
    const copy = new Uint8Array(wasm.memory.buffer, out, bytes).slice();
    wasm.dealloc(out, bytes);
    return copy;
  };

  const shade = (spec, lanes) => {
    const [pointer, length] = put(JSON.stringify(spec));
    const lanePointer = wasm.alloc(lanes.length);
    new Uint8Array(wasm.memory.buffer, lanePointer, lanes.length).set(lanes);
    const out = wasm.shade(pointer, length, lanePointer);
    wasm.dealloc(pointer, length);
    wasm.dealloc(lanePointer, lanes.length);
    if (out === 0) throw new Error("shade refused");
    const [width, height] = spec.resolution;
    const bytes = width * height * 4;
    const copy = new Uint8Array(wasm.memory.buffer, out, bytes).slice();
    wasm.dealloc(out, bytes);
    return copy;
  };

  /** The whole frame, the way the page draws it: bands, then one shade. */
  const frame = (spec) => {
    const shape = plan(spec);
    if (!shape.ok) throw new Error(shape.why);
    const [, height] = spec.resolution;
    const started = process.hrtime.bigint();
    const lanes = band(spec, shape, 0, height);
    const fieldMs = Number(process.hrtime.bigint() - started) / 1e6;
    const painted = process.hrtime.bigint();
    const image = shape.direct ? lanes : shade(spec, lanes);
    const shadeMs = Number(process.hrtime.bigint() - painted) / 1e6;
    return { shape, image, fieldMs, shadeMs };
  };

  return { wasm, plan, band, shade, frame };
}

/** The two-stop ramp used wherever the picture's colours do not matter. */
export const RAMP = { kind: "sequential", stops: [[0, [0, 0, 0]], [1, [255, 255, 255]]] };
