// Two builds of `perturb.wasm`, held to each other byte for byte.
//
//   node explorer/bench/perturb-parity.mjs <old.wasm> <new.wasm> [filter]
//
// Over every spec in `perturb-wasm/tests/parity-specs.jsonl` (the native pins' own
// list): the reference orbit, `compute_band` over the whole tile and over the tile cut
// in two, `compute_samples` over a scattered list, and `band_ran` / `band_saved` after
// each. Wasm takes `ln` from another library than native does, so the module is held
// to its predecessor rather than to the native pins.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { load } from "./perturb.mjs";

const [oldPath, newPath, filter] = process.argv.slice(2);
if (!oldPath || !newPath) {
  console.error("usage: perturb-parity.mjs <old.wasm> <new.wasm> [filter]");
  process.exit(2);
}

const specsUrl = new URL("../perturb-wasm/tests/parity-specs.jsonl", import.meta.url);
const specs = readFileSync(specsUrl, "utf8")
  .split("\n")
  .filter((line) => line.trim() !== "")
  .map((line) => {
    const [label, json] = line.split("\t");
    return { label, spec: JSON.parse(json) };
  })
  .filter(({ label }) => !filter || label.includes(filter));

const encoder = new TextEncoder();

function harness(module) {
  const { wasm } = module;
  const put = (bytes) => {
    const at = wasm.alloc(bytes.length);
    new Uint8Array(wasm.memory.buffer, at, bytes.length).set(bytes);
    return at;
  };
  const take = (out, length) => {
    const copy = new Uint8Array(wasm.memory.buffer, out, length).slice();
    wasm.dealloc(out, length);
    return copy;
  };
  const band = (spec, orbit, rowStart, rowEnd) => {
    const text = encoder.encode(JSON.stringify(spec));
    const s = put(text);
    const o = put(orbit);
    const out = wasm.compute_band(s, text.length, o, orbit.length, rowStart, rowEnd);
    wasm.dealloc(s, text.length);
    wasm.dealloc(o, orbit.length);
    if (out === 0) throw new Error("compute_band refused");
    const ss = spec.supersample ?? 1;
    const bytes = (rowEnd - rowStart) * ss * spec.resolution[0] * ss * 8;
    return { bytes: take(out, bytes), ran: wasm.band_ran(), saved: wasm.band_saved() };
  };
  const samples = (spec, orbit, indices) => {
    const text = encoder.encode(JSON.stringify(spec));
    const s = put(text);
    const o = put(orbit);
    const list = new Uint8Array(new Uint32Array(indices).buffer);
    const l = put(list);
    const out = wasm.compute_samples(s, text.length, o, orbit.length, l, indices.length);
    wasm.dealloc(s, text.length);
    wasm.dealloc(o, orbit.length);
    wasm.dealloc(l, list.length);
    if (out === 0) throw new Error("compute_samples refused");
    return {
      bytes: take(out, indices.length * 8),
      ran: wasm.band_ran(),
      saved: wasm.band_saved(),
    };
  };
  return { reference: module.reference, band, samples };
}

const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

function run(h, spec) {
  const orbit = h.reference(spec);
  const rows = spec.resolution[1];
  const whole = h.band(spec, orbit, 0, rows);
  const mid = Math.floor(rows / 2);
  const parts = [];
  if (mid > 0) parts.push(h.band(spec, orbit, 0, mid));
  parts.push(h.band(spec, orbit, mid, rows));
  const count = spec.resolution[0] * rows * (spec.supersample ?? 1) ** 2;
  const stride = count % 7 === 0 ? 5 : 7;
  const indices = Array.from({ length: count }, (_, i) => (i * stride) % count).reverse();
  const listed = h.samples(spec, orbit, indices);
  // Lists of one, two and three: a lone sample, a pair, and a pair plus a sample alone.
  const short = [1, 2, 3].map((n) => h.samples(spec, orbit, indices.slice(0, n)));
  return { orbit, whole, parts, listed, short };
}

const [oldModule, newModule] = await Promise.all([
  load(pathToFileURL(resolve(oldPath))),
  load(pathToFileURL(resolve(newPath))),
]);
const [a, b] = [harness(oldModule), harness(newModule)];

let compared = 0;
let identical = 0;
const started = performance.now();
for (const { label, spec } of specs) {
  const t0 = performance.now();
  const x = run(a, spec);
  const t1 = performance.now();
  const y = run(b, spec);
  const t2 = performance.now();
  const problems = [];
  if (!same(x.orbit, y.orbit)) problems.push("orbit");
  if (!same(x.whole.bytes, y.whole.bytes)) problems.push("band bytes");
  if (x.whole.ran !== y.whole.ran || x.whole.saved !== y.whole.saved) {
    problems.push(`band counters ${x.whole.ran}/${x.whole.saved} vs ${y.whole.ran}/${y.whole.saved}`);
  }
  x.parts.forEach((p, i) => {
    const q = y.parts[i];
    if (!same(p.bytes, q.bytes) || p.ran !== q.ran || p.saved !== q.saved) {
      problems.push(`half ${i}`);
    }
  });
  if (!same(x.listed.bytes, y.listed.bytes)) problems.push("samples bytes");
  x.short.forEach((p, i) => {
    const q = y.short[i];
    if (!same(p.bytes, q.bytes) || p.ran !== q.ran || p.saved !== q.saved) {
      problems.push(`list of ${i + 1}`);
    }
    if (!same(p.bytes, x.listed.bytes.slice(0, (i + 1) * 8))) problems.push(`old list of ${i + 1} vs whole list`);
    if (!same(q.bytes, y.listed.bytes.slice(0, (i + 1) * 8))) problems.push(`new list of ${i + 1} vs whole list`);
  });
  if (x.listed.ran !== y.listed.ran || x.listed.saved !== y.listed.saved) {
    problems.push("samples counters");
  }
  // And within each module: the list is the band, sample for sample.
  for (const r of [x, y]) {
    const view = new DataView(r.whole.bytes.buffer);
    const lv = new DataView(r.listed.bytes.buffer);
    const count = r.whole.bytes.length / 8;
    const stride = count % 7 === 0 ? 5 : 7;
    for (let k = 0; k < count; k++) {
      const index = (((count - 1 - k) * stride) % count);
      if (view.getBigUint64(index * 8, true) !== lv.getBigUint64(k * 8, true)) {
        problems.push(`listed != banded at ${index}`);
        break;
      }
    }
  }
  compared += 1;
  if (problems.length === 0) identical += 1;
  console.log(
    `${problems.length === 0 ? "same" : "DIFF"}  ${label.padEnd(36)} old ${(t1 - t0).toFixed(0).padStart(6)} ms  new ${(t2 - t1).toFixed(0).padStart(6)} ms  ran ${x.whole.ran} saved ${x.whole.saved}${problems.length ? "  " + problems.join(", ") : ""}`,
  );
}
console.log(
  `\n${identical} of ${compared} specs identical (${((performance.now() - started) / 1000).toFixed(1)} s)`,
);
process.exit(identical === compared ? 0 : 1);
