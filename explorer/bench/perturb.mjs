// A minimal Node wrapper over the committed `perturb.wasm`: the same calls
// `explorer/deep-render.js` makes, without a browser, a worker pool or a canvas.
//
// The sibling of `engine.mjs`, and deliberately not the tab's renderer — it is the
// shortest thing that speaks the same boundary, so a test can hold the module to what the
// page believes about it.

import { readFileSync } from "node:fs";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Bytes of header on the reference buffer, before the orbit's `f64` pairs. */
export const REFERENCE_HEADER = 16;

export async function load(url = new URL("../perturb.wasm", import.meta.url)) {
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

  /** One reference orbit, packed: `count`, flags, the period residual, then the pairs. */
  const reference = (spec) => {
    const [pointer, length] = put(JSON.stringify(spec));
    const out = wasm.reference_orbit(pointer, length);
    wasm.dealloc(pointer, length);
    if (out === 0) return null;
    const count = new DataView(wasm.memory.buffer).getUint32(out, true);
    const bytes = REFERENCE_HEADER + 16 * count;
    const copy = new Uint8Array(wasm.memory.buffer, out, bytes).slice();
    wasm.dealloc(out, bytes);
    return copy;
  };

  /** One band of OUTPUT rows, as little-endian `f64`: one lane, `NaN` for the interior. */
  const band = (spec, orbit, rowStart, rowEnd) => {
    const [pointer, length] = put(JSON.stringify(spec));
    const at = wasm.alloc(orbit.length);
    new Uint8Array(wasm.memory.buffer, at, orbit.length).set(orbit);
    const out = wasm.compute_band(pointer, length, at, orbit.length, rowStart, rowEnd);
    wasm.dealloc(pointer, length);
    wasm.dealloc(at, orbit.length);
    if (out === 0) throw new Error("compute_band refused");
    const ss = spec.supersample ?? 1;
    const [width] = spec.resolution;
    const bytes = (rowEnd - rowStart) * ss * width * ss * 8;
    const copy = new Uint8Array(wasm.memory.buffer, out, bytes).slice();
    wasm.dealloc(out, bytes);
    return copy;
  };

  /** The whole frame's lanes, in one call. */
  const frame = (spec) => {
    const orbit = reference(spec);
    if (orbit === null) throw new Error("reference_orbit refused");
    return band(spec, orbit, 0, spec.resolution[1]);
  };

  /** One band of the cap policy's probe: counts, not lanes. The same call
   *  `deep-worker.js` makes, with the orbit for the cap being tried. */
  const probe = (spec, orbit, cols, rows, rowStart, rowEnd) => {
    const [pointer, length] = put(JSON.stringify(spec));
    const at = wasm.alloc(orbit.length);
    new Uint8Array(wasm.memory.buffer, at, orbit.length).set(orbit);
    const out = wasm.probe_band(pointer, length, at, orbit.length, cols, rows, rowStart, rowEnd);
    wasm.dealloc(pointer, length);
    wasm.dealloc(at, orbit.length);
    const size = new DataView(wasm.memory.buffer).getUint32(out, true);
    const text = decoder.decode(new Uint8Array(wasm.memory.buffer, out + 4, size));
    wasm.dealloc(out, size + 4);
    return JSON.parse(text);
  };

  return {
    wasm,
    plan,
    reference,
    band,
    frame,
    probe,
    maxiter: (width) => wasm.maxiter_for_width(width),
    limbs: (width, samples) => wasm.limbs_for_width(width, samples),
    faultShare: () => wasm.fault_share(),
    nextCap: (maxiter) => wasm.next_cap(maxiter),
  };
}
