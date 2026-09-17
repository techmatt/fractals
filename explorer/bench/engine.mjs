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

  // Rows are OUTPUT rows, at every supersample: a direct trap's band comes back
  // already reduced to them, and a field's comes back as the `ss × ss` samples
  // behind them.
  const band = (spec, shape, rowStart, rowEnd) => {
    const [pointer, length] = put(JSON.stringify(spec));
    const out = wasm.compute_band(pointer, length, rowStart, rowEnd);
    wasm.dealloc(pointer, length);
    if (out === 0) throw new Error("compute_band refused");
    const rows = rowEnd - rowStart;
    const [width] = spec.resolution;
    const ss = spec.supersample ?? 1;
    const bytes = shape.direct
      ? rows * width * 4
      : rows * ss * width * ss * shape.lanes * 8;
    const copy = new Uint8Array(wasm.memory.buffer, out, bytes).slice();
    wasm.dealloc(out, bytes);
    return copy;
  };

  const shade = (spec, lanes) => {
    const [pointer, length] = put(JSON.stringify(spec));
    const lanePointer = wasm.alloc(lanes.length);
    new Uint8Array(wasm.memory.buffer, lanePointer, lanes.length).set(lanes);
    // `shade` frees the lanes buffer; only the spec is this caller's to release.
    const out = wasm.shade(pointer, length, lanePointer, lanes.length);
    wasm.dealloc(pointer, length);
    if (out === 0) throw new Error("shade refused");
    const [width, height] = spec.resolution;
    const bytes = width * height * 4;
    const copy = new Uint8Array(wasm.memory.buffer, out, bytes).slice();
    wasm.dealloc(out, bytes);
    return copy;
  };

  /** The five numbers and the flag in front of `shade_level` and `derive_level`. */
  const header = (pointer) => {
    const view = new DataView(wasm.memory.buffer, pointer, 48);
    const numbers = [8, 16, 24, 32, 40].map((at) => view.getFloat64(at, true));
    return {
      acts: view.getUint8(0) === 1,
      curve: {
        black_pt: numbers[0],
        white_pt: numbers[1],
        exponent: numbers[2],
        out_ends: [numbers[3], numbers[4]],
      },
    };
  };

  /** `shade`, and the operator's measure half on what it made where `derive` is set. */
  const shadeLevel = (spec, lanes, derive) => {
    const [pointer, length] = put(JSON.stringify(spec));
    const lanePointer = wasm.alloc(lanes.length);
    new Uint8Array(wasm.memory.buffer, lanePointer, lanes.length).set(lanes);
    const out = wasm.shade_level(pointer, length, lanePointer, lanes.length, Number(derive));
    wasm.dealloc(pointer, length);
    if (out === 0) return null;
    const [width, height] = spec.resolution;
    // 56: the level header, then the texture weight a derivation would have written.
    const bytes = 56 + width * height * 4;
    const { acts, curve } = header(out);
    const tail = new DataView(wasm.memory.buffer, out, 56);
    const weight = tail.getUint8(1) === 1 ? tail.getFloat64(48, true) : null;
    const image = new Uint8Array(wasm.memory.buffer, out + 56, width * height * 4).slice();
    wasm.dealloc(out, bytes);
    return { acts, curve, weight, image };
  };

  /** A direct trap's near misses at the spec's resolution: hits and load, `f32` each. */
  const probe = (spec) => {
    const [pointer, length] = put(JSON.stringify(spec));
    const [width, height] = spec.resolution;
    const out = wasm.probe_band(pointer, length, 0, height);
    wasm.dealloc(pointer, length);
    if (out === 0) return null;
    const bytes = width * height * 8;
    const copy = new Uint8Array(wasm.memory.buffer, out, bytes).slice();
    wasm.dealloc(out, bytes);
    return copy;
  };

  /** The opacity a probe derives: `{ ok, probed: { opacity, hit_share, load } }`. */
  const deriveOpacity = (spec, counts) => {
    const [pointer, length] = put(JSON.stringify(spec));
    const at = wasm.alloc(counts.length);
    new Uint8Array(wasm.memory.buffer, at, counts.length).set(counts);
    const out = wasm.derive_opacity(pointer, length, at, counts.length);
    wasm.dealloc(at, counts.length);
    wasm.dealloc(pointer, length);
    const size = new DataView(wasm.memory.buffer).getUint32(out, true);
    const text = decoder.decode(new Uint8Array(wasm.memory.buffer, out + 4, size));
    wasm.dealloc(out, size + 4);
    return JSON.parse(text);
  };

  /** The measure half alone, on RGBA: whether it acts, and the curve it derived. */
  const deriveLevel = (rgba) => {
    const pointer = wasm.alloc(rgba.length);
    new Uint8Array(wasm.memory.buffer, pointer, rgba.length).set(rgba);
    const out = wasm.derive_level(pointer, rgba.length);
    wasm.dealloc(pointer, rgba.length);
    if (out === 0) throw new Error("derive_level refused");
    const answer = header(out);
    wasm.dealloc(out, 48);
    return answer;
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

  return { wasm, plan, band, shade, shadeLevel, deriveLevel, probe, deriveOpacity, frame };
}

/** The two-stop ramp used wherever the picture's colours do not matter. */
export const RAMP = { kind: "sequential", stops: [[0, [0, 0, 0]], [1, [255, 255, 255]]] };
