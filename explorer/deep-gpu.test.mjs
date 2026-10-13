// The Deep tab's GPU path, held where a GPU is not needed *(gpu_deep_ship_ckpt162)*: the
// frame and orbit the page builds for the device against the tracked self-test bundles
// `deep-gpu-model` exported, the meaning of a sample's `out` word, the pass-sizing and
// tail rules, the strips a frame too big for the device is cut into, the health policy and
// the reader's opt-in, the background compile's order and when it waits or stops, the
// self-test vectors against a JavaScript reference of the same arithmetic, and the
// `kernel` key that never reaches a link. What needs a device
// is held by `bench/gpu-probe/kernel-check.html` and the tab's own self-test.
//
// node --test explorer/deep-gpu.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import * as gpu from "./deep-gpu.js";
import * as W from "./deep-gpu-wgsl.js";
import * as B from "./deep-gpu-bla.js";
import * as deepLink from "./deep-link.js";
import * as link from "./permalink.js";
import { load as loadPerturb } from "./bench/perturb.mjs";

const MODULE = new URL("./perturb.wasm", import.meta.url);
const missing = !existsSync(MODULE);
const perturb = missing ? null : await loadPerturb();
const skip = missing ? "explorer/perturb.wasm is not built" : false;

const SELFTEST = new URL("./deep-gpu-selftest/", import.meta.url);
const selftest = JSON.parse(readFileSync(new URL("selftest.json", SELFTEST), "utf8"));
const rows = readFileSync(new URL("frames.jsonl", SELFTEST), "utf8")
  .split("\n")
  .filter((line) => line.trim() !== "")
  .map((line) => JSON.parse(line));

const TYPED = { u8: Uint8Array, u32: Uint32Array, f32: Float32Array, f64: Float64Array };

function bundle(id) {
  const entry = selftest.frames.find((f) => f.id === id);
  const manifest = JSON.parse(readFileSync(new URL(entry.manifest, SELFTEST), "utf8"));
  const bin = readFileSync(new URL(entry.bin, SELFTEST));
  const buffer = bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength);
  const arrays = {};
  for (const a of manifest.arrays) arrays[a.name] = new TYPED[a.dtype](buffer, a.offset, a.count);
  return { manifest, arrays, row: rows.find((r) => r.id === id) };
}

/** The spec `perturb.wasm` is handed for a self-test frame, as `deepSpecOf` would write it. */
function specOf({ manifest, row }) {
  const spec = {
    schema: 1,
    center_re: row.re,
    center_im: row.im,
    width: row.w,
    resolution: [manifest.width_px, manifest.height_px],
    maxiter: row.n,
  };
  if (row.degree !== 2) spec.degree = row.degree;
  if (row.julia_re !== undefined) {
    spec.julia_re = row.julia_re;
    spec.julia_im = row.julia_im;
    spec.anchor = row.anchor ?? "parameter";
  }
  if (row.period !== undefined) spec.period = row.period;
  return spec;
}

const bitsOf = (x) => {
  const v = new DataView(new ArrayBuffer(4));
  v.setFloat32(0, x, true);
  return v.getUint32(0, true);
};
const f32Of = (u) => {
  const v = new DataView(new ArrayBuffer(4));
  v.setUint32(0, u >>> 0, true);
  return v.getFloat32(0, true);
};

// ---- One spelling of every shared number ------------------------------------------------

test("the status codes, sizes and policy are the kernel module's own", () => {
  assert.deepEqual([gpu.RUNNING, gpu.ESCAPED, gpu.CAPPED, gpu.INTERIOR, gpu.GATED], [W.RUNNING, W.ESCAPED, W.CAPPED, W.INTERIOR, W.GATED]);
  assert.equal(gpu.OUT_NONE, W.OUT_NONE);
  assert.equal(gpu.HANDOFF, W.POLICY.handoff);
  assert.equal(gpu.FRAME_BYTES, W.FRAME_BYTES);
  assert.equal(gpu.FRAME_LO_BYTES, W.FRAME_LO_BYTES);
  assert.equal(gpu.STATE_BYTES.proof, W.stateBytes(true));
  assert.equal(gpu.STATE_BYTES.plain, W.stateBytes(false));
  // A dispatch's budget and base land where the kernel reads them, and `paramsBytes`
  // writes the base 0.
  assert.equal(gpu.PARAMS_BUDGET, W.PARAMS_BUDGET);
  assert.equal(gpu.PARAMS_BASE, W.PARAMS_BASE);
  const params = W.paramsBytes({ budget: 7, periodic: true, length: 9, count: 11, flush: 0 });
  assert.equal(new DataView(params).getUint32(W.PARAMS_BUDGET, true), 7);
  assert.equal(new DataView(params).getUint32(W.PARAMS_BASE, true), 0);
  // A strip's first row lands after the base, and is 0 for a frame drawn whole, so the
  // self-test's frames run exactly the kernel they always did.
  assert.equal(new DataView(params).getUint32(W.PARAMS_ROW0, true), 0);
  assert.equal(new DataView(W.paramsBytes({ budget: 1, periodic: false, length: 2, count: 3, flush: 0, row0: 4097 })).getUint32(W.PARAMS_ROW0, true), 4097);
  for (const julia of [false, true]) {
    const source = W.kernelSource({ degree: 2, julia, interior: true, form: W.KERNEL_FORMS[0], workgroup: gpu.WORKGROUP, smooth: "builtin" });
    assert.match(source, /flush: i32,\n {2}base: u32,\n {2}row0: u32,/);
    // Every row a sample's `dc` is formed from is its strip's plus `row0`.
    assert.equal((source.match(/let row = i \/ frame\.width_px \+ params\.row0;/g) ?? []).length, julia ? 2 : 1);
    assert.doesNotMatch(source, /let row = i \/ frame\.width_px;/);
  }
  // The self-test frames run each schedule the page runs, and the bundles are slim and
  // provoke no flush: a device that flushes subnormals passes them for the right reason.
  assert.ok(selftest.budgets.length >= 2);
  for (const f of selftest.frames) {
    const { manifest } = bundle(f.id);
    assert.equal(manifest.ftz.differ, 0, `${f.id} moves under a flushing run`);
    assert.equal(manifest.interior, true, `${f.id} does not test the proof`);
  }
});

// ---- Narrowing and the orbit ------------------------------------------------------------

test("narrow rounds to f32 and stores a subnormal as a signed zero", () => {
  assert.equal(gpu.narrow(1 / 3), Math.fround(1 / 3));
  assert.ok(Object.is(gpu.narrow(1e-40), 0));
  assert.ok(Object.is(gpu.narrow(-1e-40), -0));
  assert.ok(Object.is(gpu.narrow(-0), -0));
  assert.equal(gpu.narrow(2 ** -126), 2 ** -126);
  assert.ok(Object.is(gpu.narrow(2 ** -127), 0));
  assert.ok(Object.is(gpu.narrow(1e-300), 0));
  assert.equal(gpu.narrow(3e38), Math.fround(3e38));
});

test("pow2 and the exponent reads are exact", () => {
  for (const e of [-1022, -366, -75, -1, 0, 1, 52, 1023]) {
    assert.equal(gpu.pow2(e), 2 ** e);
    assert.equal(gpu.frameExponent(gpu.pow2(e)), e);
    assert.equal(gpu.frameExponent(gpu.pow2(e) * 1.999), e);
  }
  assert.equal(gpu.frameExponent(0), 0);
  assert.equal(gpu.frameExponent(-1), 0);
  assert.equal(gpu.exponentBits(5e-324), -1023);
});

/** A packed reference of `points`, `perturb.wasm`'s layout. */
function packed(points, flags = 0) {
  const buffer = new ArrayBuffer(16 + 16 * points.length);
  const view = new DataView(buffer);
  view.setUint32(0, points.length, true);
  view.setUint32(4, flags, true);
  points.forEach(([re, im], k) => {
    view.setFloat64(16 + 16 * k, re, true);
    view.setFloat64(24 + 16 * k, im, true);
  });
  return buffer;
}

test("the HiLo orbit splits each component exactly and bounds what flushing left", () => {
  const points = [
    [0, 0],
    [-0.75, 0.1],
    [Math.PI / 7, -Math.E / 11],
    [1.2345678901234567, -1e-20],
  ];
  const hilo = gpu.hiLoOrbit(packed(points, 2));
  assert.equal(hilo.count, 4);
  assert.equal(hilo.periodic, true);
  assert.equal(hilo.flush, 0);
  points.forEach(([re, im], k) => {
    const [reHi, imHi, reLo, imLo] = hilo.points.slice(4 * k, 4 * k + 4);
    assert.equal(reHi, Math.fround(re));
    assert.equal(imHi, Math.fround(im));
    // hi + lo carries the f64 to about 48 bits: within an f32 ulp of the low part.
    assert.ok(Math.abs(reHi + reLo - re) <= Math.abs(re) * 2 ** -46);
    assert.ok(Math.abs(imHi + imLo - im) <= Math.abs(im) * 2 ** -46);
  });
  // A component near zero flushes: 2^-200 is stored as zero, and the bound says so.
  const flushed = gpu.hiLoOrbit(packed([[0.5, 2 ** -200], [2 ** -300, 0.25]]));
  assert.equal(flushed.points[1], 0);
  assert.equal(flushed.points[4], 0);
  // The worst flushed exponent is -200, so the bound is 2^-(-200 + 2) = 2^-198.
  assert.equal(flushed.flush, 198);
  // A low part under the normal range flushes as well, at the least bound.
  const low = gpu.hiLoOrbit(packed([[1 + 2 ** -30 * 2 ** -100, 0]]));
  assert.equal(low.flush, 0, "a low part of 2^-130 rounds into the f64 and never existed");
  const lowFlush = gpu.hiLoOrbit(packed([[2 ** -100 + 2 ** -128, 0]]));
  assert.equal(lowFlush.points[2], 0);
  // The low part is 2^-128, so the bound is 2^-126; a flush never claims less than 2^-125.
  assert.equal(lowFlush.flush, 126);
  const justUnder = gpu.hiLoOrbit(packed([[2 ** -127, 0]]));
  assert.equal(justUnder.flush, 125);
});

test("the margins are the model's, for both precisions and every degree", () => {
  // The DS table the perturb notes give, and the f32 values the bundles carry.
  assert.deepEqual([2, 3, 4, 5, 6].map((d) => gpu.margins(d, "ds").step), [38, 37, 36, 35, 35]);
  for (const d of [2, 3, 4, 5, 6]) {
    const ds = gpu.margins(d, "ds");
    assert.deepEqual([ds.spacing, ds.point, ds.add], [8, 41, 42]);
    const single = gpu.margins(d, "f32");
    assert.deepEqual([single.spacing, single.point, single.add], [4, 21, 22]);
  }
  for (const f of selftest.frames) {
    const { manifest } = bundle(f.id);
    assert.deepEqual(gpu.margins(manifest.degree, "f32"), manifest.frame.margins);
    assert.deepEqual(gpu.margins(manifest.degree, "ds"), manifest.frame_lo.margins);
  }
});

test("the frame uniforms are the model's bytes for each self-test frame, from perturb's plan", { skip }, () => {
  for (const f of selftest.frames) {
    const b = bundle(f.id);
    const spec = specOf(b);
    const plan = perturb.plan(spec);
    assert.equal(plan.ok, true, plan.why);
    assert.equal(plan.sample_width, b.manifest.width_px);
    const { frame, frameLo } = gpu.frameBuffers(plan, b.manifest.orbit_len, b.manifest.frame.interior);
    assert.deepEqual(new Uint8Array(frame), b.arrays.frame, `${f.id}: Frame`);
    assert.deepEqual(new Uint8Array(frameLo), b.arrays.frame_lo, `${f.id}: FrameLo`);
    // And the policy the tab runs is written where the model writes it.
    const handoff = new DataView(gpu.frameBuffers(plan, b.manifest.orbit_len, gpu.HANDOFF).frame);
    assert.equal(handoff.getUint32(40, true), gpu.HANDOFF);
    const off = new DataView(gpu.frameBuffers({ ...plan, interior: false }, b.manifest.orbit_len, gpu.HANDOFF).frame);
    assert.equal(off.getUint32(40, true), 0);
  }
});

test("the HiLo orbit of perturb's reference is the bundle's, bit for bit, with its flush", { skip }, () => {
  for (const f of selftest.frames) {
    const b = bundle(f.id);
    const reference = perturb.reference(specOf(b));
    const hilo = gpu.hiLoOrbit(reference);
    assert.equal(hilo.count, b.manifest.orbit_len);
    assert.equal(hilo.periodic, b.manifest.periodic);
    assert.equal(hilo.flush, b.manifest.flush_hilo);
    assert.deepEqual(new Uint32Array(hilo.points.buffer), new Uint32Array(b.arrays.orbit_hilo.slice().buffer), `${f.id}: orbit`);
    // The exact points *(gpu_deep_depth_ckpt163)*: kept where anything flushed, byte for
    // byte the model's, and absent where nothing did.
    if (b.arrays.orbit_exact === undefined) assert.equal(hilo.exact, null, `${f.id}: no exact points`);
    else assert.ok(Buffer.from(hilo.exact).equals(Buffer.from(b.arrays.orbit_exact.slice().buffer)), `${f.id}: exact points`);
  }
  assert.equal(gpu.EXACT_BYTES, W.EXACT_BYTES);
  assert.ok(selftest.frames.some((f) => bundle(f.id).arrays.orbit_exact !== undefined), "a self-test frame reads exact points");
});

test("an off-centre reference and a Julia anchor give the model's offset split", { skip }, () => {
  // No bundle carries a nonzero offset, so this holds the split itself: hi + lo against
  // 2^sc recovers the plan's f64 offset to double-single accuracy.
  const spec = {
    schema: 1,
    center_re: "-0.74501772828532335842941892835857434",
    center_im: "0.14993443275456819177805709088257971",
    width: 2e-11,
    resolution: [64, 36],
    maxiter: 2000,
    reference_re: "-0.745017728285323358429418928358574",
    reference_im: "0.149934432754568191778057090882579",
  };
  const plan = perturb.plan(spec);
  assert.equal(plan.ok, true);
  assert.notEqual(plan.offset_re, 0);
  const { frame, frameLo } = gpu.frameBuffers(plan, 2001, gpu.HANDOFF);
  const f = new DataView(frame);
  const l = new DataView(frameLo);
  const unit = gpu.pow2(f.getInt32(20, true));
  const re = (f.getFloat32(8, true) + l.getFloat32(0, true)) * unit;
  const spacing = (f.getFloat32(16, true) + l.getFloat32(8, true)) * unit;
  assert.ok(Math.abs(re - plan.offset_re) <= Math.abs(plan.offset_re) * 2 ** -45);
  assert.ok(Math.abs(spacing - plan.spacing) <= plan.spacing * 2 ** -45);
  assert.equal(f.getUint32(36, true), 0);
  // A Julia frame at z = c starts at index 1, clamped to the orbit it is given.
  const julia = perturb.plan({ schema: 1, center_re: "-0.1", center_im: "0.65", width: 1e-9, resolution: [16, 9], maxiter: 500, julia_re: "-0.1", julia_im: "0.65", anchor: "parameter" });
  assert.equal(julia.entry, 1);
  assert.equal(new DataView(gpu.frameBuffers(julia, 501, 0).frame).getUint32(36, true), 1);
  assert.equal(new DataView(gpu.frameBuffers(julia, 1, 0).frame).getUint32(36, true), 0);
});

// ---- The out word -----------------------------------------------------------------------

test("a sample's out word becomes the CPU kernel's lane, and the rest are handed back", () => {
  const words = new Uint32Array(2 * 7);
  const set = (i, a, b) => {
    words[2 * i] = a;
    words[2 * i + 1] = b;
  };
  set(0, 41, bitsOf(0.25)); // escaped
  set(1, gpu.OUT_NONE, gpu.CAPPED);
  set(2, gpu.OUT_NONE, gpu.INTERIOR);
  set(3, gpu.OUT_NONE, gpu.GATED);
  set(4, gpu.OUT_NONE, gpu.RUNNING);
  set(5, 7, bitsOf(NaN)); // escaped, fraction not finite: perturb's (n + 1)
  set(6, 0, bitsOf(-0.5));
  const values = new Float64Array(7).fill(-1);
  const final = new Uint8Array(7);
  const done = gpu.fillValues(words, values, { final, fallback: (i) => 100 + i });
  assert.equal(done, 5);
  assert.equal(values[0], 41.25);
  assert.ok(Number.isNaN(values[1]));
  assert.ok(Number.isNaN(values[2]));
  assert.equal(values[3], 103);
  assert.equal(values[4], 104);
  assert.equal(values[5], 8);
  assert.equal(values[6], -0.5);
  assert.deepEqual([...final], [1, 1, 1, 0, 0, 1, 1]);
  assert.deepEqual([...gpu.unfinished(final)], [3, 4]);
  // Without a fallback an unfinished lane is left exactly as it was.
  const kept = new Float64Array(7).fill(-1);
  gpu.fillValues(words, kept);
  assert.equal(kept[3], -1);
  assert.equal(kept[4], -1);
});

test("the quarter field stands in for a sample by its nearest cell", () => {
  const preview = { values: Float64Array.from({ length: 6 }, (_, i) => i), width: 3, height: 2, supersample: 1 };
  const at = gpu.previewOf(preview, 12, 8);
  assert.equal(at(0), 0);
  assert.equal(at(11), 2);
  assert.equal(at(4 * 12 + 4), 4);
  assert.equal(at(8 * 12 - 1), 5);
  assert.equal(gpu.previewOf(null, 12, 8), null);
});

// ---- Pass sizing and the tail -----------------------------------------------------------

test("a budget stays in its bounds and never overflows the pass's step count", () => {
  assert.equal(gpu.clampBudget(1, 100), gpu.MIN_BUDGET);
  assert.equal(gpu.clampBudget(1e12, 1), gpu.MAX_BUDGET);
  assert.equal(gpu.clampBudget(1e9, 4_000_000), Math.floor(0xffffffff / 4_000_000));
  for (const running of [1, 1000, 2_073_600, 4_194_240]) {
    for (const budget of [1, 32, 5000, 1e6, 1e9]) {
      const b = gpu.clampBudget(budget, running);
      assert.ok(b * running <= 0xffffffff, `${b} steps over ${running} samples`);
      assert.ok(b >= 1);
    }
  }
});

test("passes grow at most fourfold, shrink at once, and aim at the target", () => {
  const t = gpu.PASS_TARGET_MS;
  // A tenth of the target for 32 steps: the next pass wants 320, and may take 128.
  assert.equal(gpu.nextBudget({ budget: 32, ms: t / 10, running: 1000 }), 128);
  // On target.
  assert.equal(gpu.nextBudget({ budget: 4096, ms: t, running: 1000 }), 4096);
  // Four times the target: a quarter, at once.
  assert.equal(gpu.nextBudget({ budget: 4096, ms: 4 * t, running: 1000 }), 1024);
  // A pass too fast to measure grows by the factor and no more.
  assert.equal(gpu.nextBudget({ budget: 100, ms: 0, running: 10 }), 400);
  assert.equal(gpu.nextBudget({ budget: 4096, ms: 50, running: 1000, target: 25 }), 2048);
});

test("a pass is cut into dispatches each inside the limit, steps first", () => {
  const limitOf = ({ cost, target = gpu.DISPATCH_TARGET_MS, maxWork = gpu.MAX_DISPATCH_WORK }) =>
    Math.floor(Math.min(maxWork / gpu.WORKGROUP, cost > 0 ? target / cost : Infinity));
  const cases = [];
  for (const groups of [1, 3, 9, 100, 256, 1000, 9684, 32400, 65535]) {
    for (const budget of [1, 16, 32, 333, 4096, 65536, 1 << 20]) {
      for (const cost of [null, 1e-7, 1e-6, 1e-5, 1e-4, 1e-2, 1]) cases.push({ groups, budget, cost });
    }
  }
  for (const c of cases) {
    const plan = gpu.dispatchPlan(c);
    const limit = Math.max(1, limitOf(c));
    const list = gpu.dispatchesOf(plan, c.groups);
    const what = JSON.stringify({ ...c, ...plan });
    assert.ok(plan.budget >= 1 && plan.budget <= c.budget, what);
    assert.equal(list.length, plan.slices * plan.chunks, what);
    // Never more than a pass has room for, however slow the cost.
    assert.ok(list.length <= gpu.MAX_DISPATCHES, what);
    // Every dispatch inside the limit, unless one step over one workgroup is past it, or one
    // step over every workgroup would need more slices than a pass has room for.
    const widened = Math.ceil(c.groups / limit) > gpu.MAX_DISPATCHES;
    for (const d of list) assert.ok(d.groups * d.budget <= limit || (d.budget === 1 && (d.groups === 1 || widened)), what);
    // Every workgroup is covered once a chunk, and the chunks sum to the pass's steps.
    const firsts = list.filter((d) => d.budget === list[0].budget && list.indexOf(d) < plan.slices);
    assert.equal(firsts.reduce((sum, d) => sum + d.groups, 0), c.groups, what);
    firsts.forEach((d, k) => assert.equal(d.base, k * plan.per * gpu.WORKGROUP, what));
    let steps = 0;
    for (let k = 0; k < list.length; k += plan.slices) steps += list[k].budget;
    assert.equal(steps, plan.budget, what);
    assert.ok(list.every((d, k) => d.last === k >= list.length - plan.slices), what);
    // Workgroups are cut only where a single step over all of them is past the limit.
    if (plan.slices > 1) assert.ok(c.groups > limit, what);
  }
  // Nothing measured: only the first pass's work cap bounds a dispatch. A frame's first
  // pass over the working canvas (9,684 workgroups) is cut into runs of steps, every one
  // over the whole frame and inside the cap.
  const first = gpu.dispatchPlan({ budget: gpu.FIRST_BUDGET, groups: 9684, maxWork: gpu.FIRST_DISPATCH_WORK });
  assert.deepEqual([first.budget, first.slices], [gpu.FIRST_BUDGET, 1]);
  assert.equal(first.step, Math.floor(gpu.FIRST_DISPATCH_WORK / (gpu.WORKGROUP * 9684)));
  assert.equal(first.chunks, Math.ceil(gpu.FIRST_BUDGET / first.step));
  // And held to about a pass's worth of dispatches, the way a frame's first pass is run.
  const sizing = { pass: gpu.PASS_TARGET_MS, dispatch: gpu.DISPATCH_TARGET_MS, most: gpu.MAX_DISPATCHES };
  const firstMost = gpu.firstDispatches(sizing);
  assert.equal(firstMost, Math.ceil(gpu.PASS_TARGET_MS / gpu.DISPATCH_TARGET_MS));
  const held = gpu.dispatchPlan({ budget: gpu.FIRST_BUDGET, groups: 9684, maxWork: gpu.FIRST_DISPATCH_WORK, most: firstMost });
  assert.ok(held.budget <= gpu.FIRST_BUDGET && held.slices * held.chunks <= firstMost, JSON.stringify(held));
  assert.equal(gpu.firstDispatches({ pass: 100, dispatch: 1e9, most: 128 }), 1);
  // A step over every workgroup past the limit: workgroups are cut, as few times as will do.
  const wide = gpu.dispatchPlan({ budget: 8, groups: 9684, maxWork: 4096 * gpu.WORKGROUP });
  assert.deepEqual([wide.slices, wide.per, wide.step, wide.chunks], [3, 3228, 1, 8]);
  assert.throws(() => gpu.dispatchPlan({ budget: 32, groups: 10, most: NaN }), /no dispatch plan/);
  // At the cost measured, a 100 ms pass is about 100 / DISPATCH_TARGET_MS dispatches.
  const cost = 100 / (4096 * 9684);
  const plan = gpu.dispatchPlan({ budget: 4096, groups: 9684, cost, maxWork: Infinity });
  const fewest = Math.ceil(100 / gpu.DISPATCH_TARGET_MS);
  assert.equal(plan.budget, 4096);
  assert.ok(plan.slices * plan.chunks >= fewest && plan.slices * plan.chunks <= fewest + 2, JSON.stringify(plan));
  // A thin list cannot be sliced: it is cut by steps.
  const thin = gpu.dispatchPlan({ budget: 40000, groups: 20, cost: 100 / (40000 * 20), maxWork: Infinity });
  assert.deepEqual([thin.slices, thin.budget], [1, 40000]);
  assert.ok(thin.chunks >= fewest && thin.chunks <= fewest + 2);
  // More than a submission holds: fewer steps.
  const most = gpu.dispatchPlan({ budget: 1 << 20, groups: 9684, cost: 1e-5 });
  assert.ok(most.budget < 1 << 20 && most.slices * most.chunks <= gpu.MAX_DISPATCHES);
  // A cost no step fits: the widest frame in `MAX_DISPATCHES` slices of one step, not 5,462.
  const slow = gpu.dispatchPlan({ budget: 32, groups: 65535, cost: 1 });
  assert.deepEqual([slow.budget, slow.slices, slow.chunks], [1, gpu.MAX_DISPATCHES, 1]);
  assert.equal(gpu.dispatchesOf(slow, 65535).reduce((sum, d) => sum + d.groups, 0), 65535);
});

test("the cost is the densest dispatch's, floored, or twice the average without timestamps", () => {
  const dispatches = [
    { groups: 100, budget: 10 },
    { groups: 50, budget: 10 },
  ];
  assert.equal(gpu.dispatchCost({ dispatches, durations: [1, 1], wallMs: 9 }), 1 / 500);
  assert.equal(gpu.dispatchCost({ dispatches, durations: [0, 0], wallMs: 9 }), gpu.TIMESTAMP_FLOOR_MS / 500);
  assert.equal(gpu.dispatchCost({ dispatches, durations: null, wallMs: 3 }), 6 / 1500);
});

test("a frame's passes in brief", () => {
  const record = { passes: 3, dispatches: 9, trace: [[32, "a", 10, 5, 1.5, 2, 1], [128, "a", 9, 40, 30.25, 4, 8.5], [512, "c", 2, 12, 9, 3, 4]] };
  assert.deepEqual(gpu.passStats(record), { passes: 3, dispatches: 9, maxPassMs: 30.25, maxDispatchMs: 8.5, maxWallMs: 40, over: [] });
  assert.deepEqual(gpu.passStats({ passes: 1, dispatches: 1, trace: [[32, "a", 0, 7, null, 1, null]] }), { passes: 1, dispatches: 1, maxPassMs: null, maxDispatchMs: null, maxWallMs: 7, over: [] });
  // A pass past twice either target is kept whole, with its index: by its device time, its
  // widest dispatch, or its wall time where it has no timestamps.
  const t = gpu.PASS_TARGET_MS;
  const d = gpu.DISPATCH_TARGET_MS;
  const rows = [[32, "a", 10, 5, 1.5, 2, 1], [64, "a", 9, 2 * t + 9, 2 * t + 1, 9, 12], [64, "l", 8, 30, 25, 2, 2 * d + 1], [8, "a", 7, 2 * t + 1, null, 1, null]];
  const over = gpu.passStats({ passes: 4, dispatches: 14, trace: rows }).over;
  assert.deepEqual(over, [[1, ...rows[1]], [2, ...rows[2]], [3, ...rows[3]]]);
  const many = Array.from({ length: 20 }, () => rows[1]);
  assert.equal(gpu.passStats({ passes: 20, dispatches: 180, trace: many }).over.length, gpu.OVER_KEPT);
});

test("checkpoints are 1024 · 2^k and no pass steps over one", () => {
  assert.deepEqual([1024, 2048, 4096, 1 << 20].map(gpu.isCheckpoint), [true, true, true, true]);
  assert.deepEqual([0, 512, 1023, 1536, 3072, 5000].map(gpu.isCheckpoint), [false, false, false, false, false, false]);
  let spent = 0;
  const hit = [];
  for (const budget of [32, 128, 512, 2048, 8192, 8192, 8192, 8192]) {
    spent += gpu.landOn(spent, budget);
    if (gpu.isCheckpoint(spent)) hit.push(spent);
  }
  assert.deepEqual(hit.slice(0, 4), [1024, 2048, 4096, 8192]);
  assert.equal(gpu.landOn(1000, 100), 24);
  assert.equal(gpu.landOn(1024, 100), 100);
});

test("the tail is handed over at a checkpoint below the cap and nowhere else", () => {
  // At 1024 steps of a 1,024,000 cap, 0.999 of the cap is still to run.
  const at = { spent: 1024, maxiter: 1_024_000 };
  assert.equal(gpu.handsTail({ ...at, running: 7992, interior: true }), true);
  assert.equal(gpu.handsTail({ ...at, running: 7993, interior: true }), false);
  assert.equal(gpu.handsTail({ ...at, running: 1998, interior: false }), true);
  assert.equal(gpu.handsTail({ ...at, running: 1999, interior: false }), false);
  // Half the workers, half the tail.
  assert.equal(gpu.handsTail({ ...at, running: 3996, interior: true, workers: 6 }), true);
  assert.equal(gpu.handsTail({ ...at, running: 3997, interior: true, workers: 6 }), false);
  // Near the cap the CPU would redo nearly everything: the GPU keeps the last stretch.
  assert.equal(gpu.handsTail({ spent: 1 << 20, running: 2000, maxiter: 1_300_000, interior: true }), false);
  assert.equal(gpu.handsTail({ spent: 1 << 20, running: 2000, maxiter: 4_000_000, interior: true }), true);
  assert.equal(gpu.handsTail({ spent: 2047, running: 10, maxiter: 1e6, interior: true }), false);
  assert.equal(gpu.handsTail({ spent: 2048, running: 0, maxiter: 1e6, interior: true }), false);
  assert.equal(gpu.handsTail({ spent: 2048, running: 10, maxiter: 2000, interior: true }), false);
  assert.equal(gpu.handsTail({ spent: 2048, running: 10, maxiter: 1e6, interior: true, scale: 0 }), false);
});

test("a full stage the quarter pass says is cheap stays on the CPU", () => {
  const most = gpu.CHEAP_ITERATIONS_PER_WORKER * 12;
  assert.equal(gpu.cheap({ iterations: most - 1, workers: 12 }), true);
  assert.equal(gpu.cheap({ iterations: most, workers: 12 }), false);
  assert.equal(gpu.cheap({ iterations: most / 2, workers: 6 }), false);
  assert.equal(gpu.cheap({ iterations: null, workers: 12 }), false);
});

test("compaction starts under its share and re-cuts every eighth pass", () => {
  assert.equal(gpu.passMode(500_000, 1_000_000, null), "all");
  assert.equal(gpu.passMode(99_999, 1_000_000, null), "compact");
  const modes = [];
  for (let listed = 0; listed < 16; listed++) modes.push(gpu.passMode(10, 1_000_000, listed));
  assert.equal(modes.filter((m) => m === "compact").length, 2);
  assert.equal(modes[gpu.COMPACT_EVERY - 1], "compact");
});

test("a frame the device cannot hold is the CPU's", () => {
  const limits = { maxStorageBufferBindingSize: 2 ** 31 - 4, maxBufferSize: 2 ** 32, maxComputeWorkgroupsPerDimension: 65535 };
  const hd = 1920 * 1080;
  assert.equal(gpu.fits({ samples: hd, degree: 2, interior: true, orbitPoints: 1e6, limits }), null);
  assert.equal(gpu.fits({ samples: hd, degree: 7, interior: true, orbitPoints: 10, limits }), "degree");
  // Past one dispatch, or one binding, is drawn in strips now *(gpu_optin_downloads_ckpt162)*.
  assert.equal(gpu.fits({ samples: 3840 * 2160, sampleWidth: 3840, degree: 2, interior: false, orbitPoints: 10, limits }), null);
  assert.equal(gpu.fits({ samples: 7680 * 4320, sampleWidth: 7680, degree: 2, interior: true, orbitPoints: 10, limits }), null);
  const small = { maxStorageBufferBindingSize: 128 << 20, maxBufferSize: 256 << 20, maxComputeWorkgroupsPerDimension: 65535 };
  // 2.07 M samples of 128-byte state is 265 MB, past a 128 MB binding: two strips.
  assert.equal(gpu.fits({ samples: hd, sampleWidth: 1920, degree: 2, interior: true, orbitPoints: 10, limits: small }), null);
  assert.equal(gpu.fits({ samples: hd, degree: 2, interior: false, orbitPoints: 10, limits: small }), null);
  // Only a row wider than a strip can hold is refused.
  const tiny = { maxStorageBufferBindingSize: 1 << 20, maxBufferSize: 1 << 20, maxComputeWorkgroupsPerDimension: 65535 };
  assert.equal(gpu.fits({ samples: 32768 * 4, sampleWidth: 32768, degree: 2, interior: true, orbitPoints: 10, limits: tiny }), "row");
  // And the Download row's estimate, which knows no width, assumes the widest row.
  assert.equal(gpu.fits({ samples: 60e6, degree: 2, interior: true, orbitPoints: 0, limits }), null);
  assert.equal(gpu.fits({ samples: 1000, degree: 2, interior: false, orbitPoints: 1e7, limits: small }), "orbit");
});

test("a frame is cut into even strips of whole rows that the device holds", () => {
  const limits = { maxStorageBufferBindingSize: 2 ** 31 - 4, maxBufferSize: 2 ** 32, maxComputeWorkgroupsPerDimension: 65535 };
  const most = 65535 * gpu.WORKGROUP;
  // A frame the device holds whole is one strip, the frame it always drew.
  assert.equal(gpu.stripRows({ sampleWidth: 2152, sampleHeight: 1152, interior: true, limits }), 1152);
  assert.equal(gpu.stripRows({ sampleWidth: 2048, sampleHeight: 2047, interior: true, limits }), 2047);
  // 2048 x 2048 is 64 samples past one dispatch: two strips of 1024.
  assert.equal(gpu.stripRows({ sampleWidth: 2048, sampleHeight: 2048, interior: true, limits }), 1024);
  // The default download, 1920 x 1080 at 4x: 8.3 M samples, two strips of 1080 rows.
  assert.equal(gpu.stripRows({ sampleWidth: 3840, sampleHeight: 2160, interior: true, limits }), 1080);
  for (const [w, h] of [
    [3840, 2160],
    [7680, 4320],
    [10240, 5760],
    [15360, 8640],
    [32768, 1832],
    [4097, 4099],
  ]) {
    for (const interior of [true, false]) {
      const rows = gpu.stripRows({ sampleWidth: w, sampleHeight: h, interior, limits });
      const strips = Math.ceil(h / rows);
      assert.ok(rows * w <= most, `${w}x${h}: a strip fits one dispatch`);
      assert.ok(rows * w * gpu.STATE_BYTES[interior ? "proof" : "plain"] <= limits.maxStorageBufferBindingSize);
      // Even: the last strip is never more than one row a strip short of the rest.
      assert.ok(h - (strips - 1) * rows >= rows - strips, `${w}x${h}: the last strip is no sliver`);
      // And no more strips than the limits force.
      assert.equal(strips, Math.ceil(h / Math.floor(Math.min(most, Math.floor(limits.maxStorageBufferBindingSize / gpu.STATE_BYTES[interior ? "proof" : "plain"])) / w)));
    }
  }
  // The state binding binds first where it is the smaller.
  const small = { maxStorageBufferBindingSize: 128 << 20, maxBufferSize: 256 << 20, maxComputeWorkgroupsPerDimension: 65535 };
  assert.equal(gpu.stripRows({ sampleWidth: 1920, sampleHeight: 1080, interior: true, limits: small }), 540);
  assert.equal(gpu.stripRows({ sampleWidth: 1 << 21, sampleHeight: 4, interior: true, limits: small }), 0);
});

test("the GPU is the reader's to turn on, and off touches no WebGPU", async () => {
  const touched = [];
  const before = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    get: () => ({
      get gpu() {
        touched.push("navigator.gpu");
        return undefined;
      },
    }),
  });
  try {
    const off = new gpu.DeepGpu();
    assert.equal(off.off, true, "not chosen is off");
    assert.deepEqual(off.standing(), { state: "off" });
    assert.equal(await off.start(), false);
    assert.equal(await off.ready(), false);
    assert.equal(await off.refuses({ samples: 1e7, degree: 2, interior: true, orbitPoints: 10 }), "not chosen");
    assert.equal(off.likely(1e7), false);
    off.prepare({ degree: 2, julia: false });
    assert.deepEqual(await off.draw({ live: () => true }), { status: "unserved", why: "off" });
    assert.equal(await off.choose(false), false);
    assert.equal(off.health.status, "untested", "an untouched GPU has nothing to report");
    assert.deepEqual(touched, [], "off never asks for WebGPU");

    // `?kernel=cpu` beats a ticked box, and `?kernel=gpu` an unticked one.
    const cpu = new gpu.DeepGpu({ kernel: "cpu", chosen: true });
    assert.equal(cpu.off, true);
    assert.equal(await cpu.start(), false);
    assert.equal(await cpu.refuses({ samples: 1e7, degree: 2, interior: true, orbitPoints: 10 }), "asked for the CPU");
    assert.deepEqual(cpu.standing(), { state: "forced", kernel: "cpu", unavailable: null });
    assert.deepEqual(touched, []);
    assert.equal(new gpu.DeepGpu({ kernel: "gpu" }).off, false);

    // Ticking it asks, then and not before; here there is no WebGPU, which is final and
    // the box says why.
    let changes = 0;
    const kernels = [];
    const chosen = new gpu.DeepGpu({ changed: () => (changes += 1), onKernel: (change) => kernels.push(change) });
    assert.equal(await chosen.choose(true), false);
    assert.ok(touched.length > 0, "a tick asks for WebGPU");
    assert.ok(changes >= 2, "the box hears the tick and the outcome");
    assert.deepEqual(chosen.standing(), { state: "unavailable", why: "no-webgpu" });
    assert.equal(chosen.using, "cpu");
    assert.deepEqual(kernels, [], "a GPU that never drew retires nothing going off");
    // Unticked, it is off again, and a box ticked on an earlier visit asks at the pool's start.
    await chosen.choose(false);
    assert.deepEqual(chosen.standing(), { state: "off" });
    const remembered = new gpu.DeepGpu({ chosen: true });
    assert.equal(remembered.off, false);
    assert.deepEqual(remembered.standing(), { state: "waiting" }, "nothing tests it until a frame wants it");
  } finally {
    if (before) Object.defineProperty(globalThis, "navigator", before);
    else delete globalThis.navigator;
  }
});

test("unticking gives a passed device up without counting a loss", () => {
  const h = new gpu.Health();
  h.passed();
  h.stoodDown();
  assert.equal(h.status, "untested");
  assert.equal(h.losses, 0);
  assert.equal(h.wants, true, "a later tick tests a fresh device");
  const lost = new gpu.Health();
  for (let k = 0; k <= gpu.MAX_RECOVERIES; k++) lost.lost("hung");
  lost.stoodDown();
  assert.equal(lost.status, "off", "off for the page load stays off");
});

test("a page load recovers from three lost devices, and a failed self-test is final", () => {
  assert.equal(gpu.MAX_RECOVERIES, 3);
  assert.deepEqual(gpu.RECOVERY_DELAYS_MS, [0, 1000, 4000]);
  const h = new gpu.Health();
  assert.equal(h.wants, true);
  h.passed();
  assert.equal(h.usable, true);
  for (let k = 1; k <= gpu.MAX_RECOVERIES; k++) {
    h.lost("hung");
    assert.equal(h.status, "lost", `loss ${k} is recovered from`);
    assert.equal(h.usable, false);
    assert.equal(h.unrecovered, false);
    h.passed();
    assert.equal(h.usable, true);
  }
  h.lost("hung once more");
  assert.equal(h.status, "off");
  assert.equal(h.unrecovered, true, "the device went, not the arithmetic");
  assert.equal(h.wants, false);
  h.passed();
  assert.equal(h.usable, false, "off for the page load");
  const failed = new gpu.Health();
  failed.failed("vectors");
  assert.equal(failed.status, "off");
  assert.equal(failed.unrecovered, false);
  assert.equal(failed.wants, false);
});

test("a recovery's misses spend its attempts and are not losses, and the last ends it", () => {
  const h = new gpu.Health();
  h.passed();
  h.lost("hung");
  h.attemptMissed("no-adapter");
  h.attemptMissed("lost during the self-test");
  assert.equal(h.status, "lost", "two attempts spent, one left");
  assert.equal(h.losses, 1, "a loss under the recovery's own test is not a new loss");
  assert.equal(h.misses, 0, "nor a first acquisition's miss");
  h.passed();
  assert.equal(h.attempts, 0, "a recovery that passes leaves the next one all its attempts");
  h.lost("hung again");
  for (let k = 0; k < gpu.RECOVERY_DELAYS_MS.length; k++) h.attemptMissed("no-adapter");
  assert.equal(h.status, "off");
  assert.equal(h.unrecovered, true);
});

/** `acquire` over scripted outcomes: what each attempt resolves, and the waits it asked. */
async function acquired(health, outcomes, { stop = () => false } = {}) {
  const attempts = [];
  const waits = [];
  const passed = await gpu.acquire({
    health,
    attempt: async ({ recovering }) => {
      attempts.push(recovering);
      return outcomes.shift() ?? { passed: true };
    },
    wait: async (ms) => {
      waits.push(ms);
    },
    stop,
  });
  return { passed, attempts, waits };
}

test("a recovery is three attempts spaced 0, 1 and 4 seconds, and ends ready or off", async () => {
  // A recovery that passes on its third attempt, after a miss and a loss under its test.
  const h = new gpu.Health();
  h.passed();
  h.lost("hung");
  const back = await acquired(h, [{ missed: "no-adapter" }, { lost: "lost during the self-test" }, { passed: true }]);
  assert.equal(back.passed, true);
  assert.deepEqual(back.attempts, [true, true, true]);
  assert.deepEqual(back.waits, [1000, 4000], "the first attempt is at once");
  assert.equal(h.status, "ready");
  assert.equal(h.losses, 1);

  // Every attempt missing turns the GPU off for the page load, with no limbo.
  const gone = new gpu.Health();
  gone.passed();
  gone.lost("hung");
  const off = await acquired(gone, [{ missed: "no-adapter" }, { missed: "no-adapter" }, { missed: "no-adapter" }, { passed: true }]);
  assert.equal(off.passed, false);
  assert.equal(off.attempts.length, 3, "no fourth attempt");
  assert.equal(gone.status, "off");
  assert.equal(gone.unrecovered, true);

  // A self-test that fails on the new device is the arithmetic's, and final.
  const wrong = new gpu.Health();
  wrong.passed();
  wrong.lost("hung");
  assert.equal((await acquired(wrong, [{ failed: "vectors" }])).passed, false);
  assert.equal(wrong.status, "off");
  assert.equal(wrong.unrecovered, false);
});

test("a first test that loses its device becomes that loss's recovery, and a miss waits", async () => {
  const h = new gpu.Health();
  const first = await acquired(h, [{ lost: "lost during the self-test" }, { passed: true }]);
  assert.equal(first.passed, true);
  assert.deepEqual(first.attempts, [false, true], "the test, then the recovery's first attempt");
  assert.deepEqual(first.waits, []);
  assert.equal(h.losses, 1);
  assert.equal(h.status, "ready");

  const missed = new gpu.Health();
  const later = await acquired(missed, [{ missed: "no-adapter" }]);
  assert.equal(later.passed, false);
  assert.deepEqual(later.attempts, [false], "a first test's miss is not retried at once");
  assert.equal(missed.status, "unavailable");
  assert.equal(missed.wants, true, "the next frame asks again");

  // The recovery it becomes is said once, before its first attempt, so that its bound runs
  // from there and not from the first test's start.
  const told = [];
  const turned = new gpu.Health();
  const outcomes = [{ lost: "lost during the self-test" }, { passed: true }];
  await gpu.acquire({
    health: turned,
    attempt: async ({ recovering }) => {
      told.push(`attempt ${recovering}`);
      return outcomes.shift();
    },
    wait: async () => {},
    onRecover: () => told.push("recovering"),
  });
  assert.deepEqual(told, ["attempt false", "recovering", "attempt true"]);
});

test("a test or a recovery out of time is off, and a recovery's says the device went", () => {
  const test = new gpu.Health();
  test.timedOut("the self-test did not answer in 30 s");
  assert.equal(test.status, "off");
  assert.equal(test.unrecovered, false, "a test out of time is not a lost device");

  const recovery = new gpu.Health();
  recovery.passed();
  recovery.lost("hung");
  recovery.timedOut("the recovery did not answer in 30 s");
  assert.equal(recovery.status, "off");
  assert.equal(recovery.unrecovered, true, "the box says the card stopped responding");
});

test("an acquisition stopped (abandoned, or the box unticked) moves nothing", async () => {
  // Stopped after an attempt that passed: the caller gives the device up, and the GPU
  // stays where it was, a recovery still owed.
  const h = new gpu.Health();
  h.passed();
  h.lost("hung");
  let stopped = false;
  const out = await gpu.acquire({
    health: h,
    attempt: async () => {
      stopped = true;
      return { passed: true };
    },
    wait: async () => {},
    stop: () => stopped,
  });
  assert.equal(out, false);
  assert.equal(h.status, "lost", "a re-tick resumes the recovery");
  assert.equal(h.wants, true);
  // Stopped between attempts: no further attempt is made.
  const between = new gpu.Health();
  between.passed();
  between.lost("hung");
  let asked = 0;
  await gpu.acquire({
    health: between,
    attempt: async () => {
      asked += 1;
      return { missed: "no-adapter" };
    },
    wait: async () => {},
    stop: () => asked >= 1 && between.attempts >= 1,
  });
  assert.equal(asked, 1);
  assert.equal(between.attempts, 1);
});

test("the kernel the page uses is the ready device's identity, the CPU once off, and undecided between", () => {
  const h = new gpu.Health();
  assert.equal(gpu.kernelNow(h, null), null, "untested: nothing has said");
  h.passed();
  assert.equal(gpu.kernelNow(h, "NVIDIA turing|fma"), "NVIDIA turing|fma");
  h.lost("hung");
  assert.equal(gpu.kernelNow(h, null), null, "recovering: the last answer stands");
  h.passed();
  assert.equal(gpu.kernelNow(h, "NVIDIA turing|split"), "NVIDIA turing|split", "another identity is another kernel");
  for (let k = 0; k < gpu.MAX_RECOVERIES; k++) h.lost("hung");
  assert.equal(gpu.kernelNow(h, null), "cpu");
});

test("an acquisition that failed for the moment is asked again, until the third", () => {
  const h = new gpu.Health();
  h.unavailable("no-adapter");
  assert.equal(h.status, "unavailable");
  assert.equal(h.wants, true, "the next frame asks again");
  assert.equal(h.losses, 0, "a miss is not a loss");
  h.passed();
  assert.equal(h.usable, true);
  h.lost("hung");
  assert.equal(h.status, "lost", "a miss and a loss are counted apart");
  h.passed();
  h.unavailable("E_OUTOFMEMORY");
  h.unavailable("no-adapter");
  assert.equal(h.status, "off");
  assert.equal(h.wants, false);
});

test("a quarter goes to the GPU by the census's iterations, never by a clock", () => {
  const line = gpu.QUARTER_ITERATIONS_PER_WORKER * 12;
  assert.equal(gpu.quarterOnGpu({ iterations: null, workers: 12 }), false);
  assert.equal(gpu.quarterOnGpu({ iterations: line - 1, workers: 12 }), false);
  assert.equal(gpu.quarterOnGpu({ iterations: line, workers: 12 }), true);
  // Degrees four to six ask for no more since the background compile (deep_holes_ckpt163).
  assert.equal(gpu.QUARTER_HIGH_DEGREE_FACTOR, 1);
  assert.equal(gpu.quarterOnGpu({ iterations: line - 1, degree: 5, workers: 12 }), false);
  assert.equal(gpu.quarterOnGpu({ iterations: line, degree: 5, workers: 12 }), true);
  // A quarter the GPU takes is far above the cheap line: its full pass is the GPU's too.
  assert.ok(gpu.QUARTER_ITERATIONS_PER_WORKER * 16 > 50 * gpu.CHEAP_ITERATIONS_PER_WORKER);
  assert.equal(gpu.readyWait, undefined, "no clock decides which kernel draws");
});

// ---- The background compile -------------------------------------------------------------

const spell = ({ degree, julia, interior }) => `d${degree}${julia ? "J" : "M"}${interior ? "+" : "-"}`;
/** What the self-test leaves compiled: degree two's two planes and degree three's
 *  Mandelbrot, the switch on. */
const TESTED = new Set(["d2M+", "d2J+", "d3M+"]);

test("the background compile's order: cheap plain kernels, then pairs by how often they are drawn", () => {
  assert.deepEqual(gpu.WARM_ORDER.map(spell), [
    "d2M-", "d3M-", "d2J-",
    "d4M+", "d4M-", "d5M+", "d5M-", "d6M+", "d6M-",
    "d3J+", "d3J-", "d4J+", "d4J-", "d5J+", "d5J-", "d6J+", "d6J-",
  ]);
  // With what the self-test leaves, the order and it name all twenty kernels once each.
  const named = [...TESTED, ...gpu.warmLeft(gpu.WARM_ORDER, (k) => TESTED.has(spell(k))).map(spell)];
  assert.equal(new Set(named).size, 20);
  assert.equal(named.length, 20);
  // What is left is the order less what is there, in the same order.
  const has = new Set(["d2M-", "d4M+", "d6J-"]);
  assert.deepEqual(gpu.warmLeft(gpu.WARM_ORDER, (k) => has.has(spell(k))).slice(0, 4).map(spell), ["d3M-", "d2J-", "d4M-", "d5M+"]);
  assert.deepEqual(gpu.warmLeft(gpu.WARM_ORDER, () => true), []);
});

test("the background compile stops for another device or the box off, and pauses while hidden", () => {
  const device = {};
  assert.equal(gpu.warmState({ device, current: device, off: false }), "go");
  assert.equal(gpu.warmState({ device, current: device, off: false, visibility: "visible" }), "go");
  assert.equal(gpu.warmState({ device, current: device, off: false, visibility: "hidden" }), "pause");
  assert.equal(gpu.warmState({ device, current: {}, off: false }), "stop");
  assert.equal(gpu.warmState({ device, current: null, off: false, visibility: "hidden" }), "stop");
  assert.equal(gpu.warmState({ device, current: device, off: true }), "stop");
});

/** A chain over fakes: `compiled` the kernels there, `events` what happened in order. */
function chainRig({ order = gpu.WARM_ORDER, there = TESTED } = {}) {
  const compiled = new Map([...there].map((name) => [name, Promise.resolve()]));
  const events = [];
  const rig = {
    compiled,
    events,
    now: "go",
    idle: Promise.resolve(),
    busy: null,
    defer: null,
    shown: null,
    fail: new Set(),
    run() {
      return gpu.warmChain({
        order,
        has: (k) => compiled.has(spell(k)),
        compile: (k, background) => {
          const name = spell(k);
          if (!compiled.has(name)) {
            events.push(`${name}${background ? " bg" : ""}`);
            compiled.set(name, rig.fail.has(name) ? Promise.reject(new Error("refused")) : Promise.resolve());
          }
          return compiled.get(name);
        },
        state: () => rig.now,
        idle: () => rig.idle,
        busy: () => rig.busy,
        defer: rig.defer,
        visible: () => new Promise((resolve) => (rig.shown = resolve)),
      });
    },
  };
  return rig;
}

test("the chain compiles what is left, one at a time, in order, and counts what it started", async () => {
  const rig = chainRig();
  rig.fail.add("d5M+");
  const { count, stopped } = await rig.run();
  assert.equal(stopped, false);
  assert.equal(count, 17);
  assert.deepEqual(rig.events, gpu.WARM_ORDER.map(spell).map((name) => `${name} bg`));
});

test("the chain waits for a frame on the device, and shares a compile already under way", async () => {
  const order = gpu.WARM_ORDER.slice(0, 3);
  const rig = chainRig({ order, there: [] });
  let release;
  rig.idle = new Promise((resolve) => (release = resolve));
  const running = rig.run();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(rig.events, [], "nothing beside a frame");
  // A frame of that shape asked first: the chain awaits its compile and does not count it.
  rig.compiled.set("d2M-", Promise.resolve());
  release();
  const { count } = await running;
  assert.equal(count, 2);
  assert.deepEqual(rig.events, ["d3M- bg", "d2J- bg"]);
});

test("a frame queued while the chain waited is waited for too", async () => {
  const rig = chainRig({ order: gpu.WARM_ORDER.slice(0, 1), there: [] });
  let first;
  let second;
  rig.idle = new Promise((resolve) => (first = resolve));
  const running = rig.run();
  const next = new Promise((resolve) => (second = resolve));
  // `draw` replaces `idle` with its own promise before the one before it settles.
  rig.idle = next;
  first();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(rig.events, []);
  second();
  await running;
  assert.deepEqual(rig.events, ["d2M- bg"]);
});

test("the chain starts no compile beside one the page asked for, and asks again after it", async () => {
  const rig = chainRig({ order: gpu.WARM_ORDER.slice(0, 2), there: [] });
  let done;
  rig.busy = new Promise((resolve) => (done = resolve));
  const running = rig.run();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(rig.events, [], "nothing beside the page's compile");
  // That compile was the first kernel's, and a frame went on the device meanwhile.
  rig.compiled.set("d2M-", Promise.resolve());
  let frame;
  rig.idle = new Promise((resolve) => (frame = resolve));
  rig.busy = null;
  done();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(rig.events, [], "the frame is waited for after the compile");
  frame();
  assert.deepEqual(await running, { count: 1, stopped: false });
  assert.deepEqual(rig.events, ["d3M- bg"]);
});

test("the chain's first kernel waits a task, and a pair asked for meanwhile goes first", async () => {
  const rig = chainRig({ order: gpu.WARM_ORDER.slice(0, 2), there: [] });
  let turn;
  let asked = 0;
  rig.defer = () => {
    asked += 1;
    return new Promise((resolve) => (turn = resolve));
  };
  const running = rig.run();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(rig.events, []);
  // The frame queued on the self-test compiles its own kernel in that turn.
  rig.compiled.set("d2M-", Promise.resolve());
  turn();
  assert.deepEqual(await running, { count: 1, stopped: false });
  assert.deepEqual(rig.events, ["d3M- bg"]);
  assert.equal(asked, 1, "once, before the first kernel");
});

test("a box unticked and ticked again on the same device starts the chain again, never two", async () => {
  let modules = 0;
  const device = {
    pushErrorScope() {},
    popErrorScope: async () => null,
    createShaderModule: () => {
      modules += 1;
      return { getCompilationInfo: async () => ({ messages: [] }) };
    },
    createPipelineLayout: () => ({}),
    createComputePipelineAsync: async () => ({}),
  };
  const logged = [];
  const g = new gpu.DeepGpu({ chosen: true, log: (event) => logged.push(event) });
  g.warm = gpu.WARM_ORDER.slice(0, 3);
  g.device = device;
  g.form = "plain";
  g.layouts = [{}];
  g.health.passed();
  assert.equal(g.health.usable, true);
  // A frame on the device holds the chain at its first kernel.
  let frame;
  g.idle = new Promise((resolve) => (frame = resolve));
  assert.equal(await g.start(), true);
  const first = g.warming;
  assert.ok(first !== null, "a usable device with kernels left starts the chain");
  await g.start();
  assert.equal(g.warming, first, "never two chains on one device");
  // Unticked: the chain sees the box off when the frame ends, and stops.
  g.chosen = false;
  frame();
  await first;
  assert.equal(g.warming, null);
  assert.equal(modules, 0);
  // Ticked again before the device was given up: the chain runs to the end.
  g.chosen = true;
  await g.start();
  assert.ok(g.warming !== null);
  await g.warming;
  assert.equal(modules, 3);
  assert.ok(logged.includes("gpu kernels warm"));
  // Nothing left: a tick starts nothing.
  await g.start();
  assert.equal(g.warming, null);
});

test("the chain stops on another device or the box off, and resumes when the tab is shown", async () => {
  const stopping = chainRig({ there: [] });
  stopping.now = "stop";
  assert.deepEqual(await stopping.run(), { count: 0, stopped: true });
  assert.deepEqual(stopping.events, []);

  const hidden = chainRig({ order: gpu.WARM_ORDER.slice(0, 2), there: [] });
  hidden.now = "pause";
  const running = hidden.run();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(hidden.events, [], "nothing while hidden");
  hidden.now = "go";
  hidden.shown();
  assert.deepEqual(await running, { count: 2, stopped: false });

  // A device lost after the first kernel: the chain stops at the next.
  const lost = chainRig({ order: gpu.WARM_ORDER.slice(0, 3), there: [] });
  const compile = lost.compiled.set.bind(lost.compiled);
  lost.compiled.set = (name, value) => {
    lost.now = "stop";
    return compile(name, value);
  };
  assert.deepEqual(await lost.run(), { count: 1, stopped: true });
  assert.deepEqual(lost.events, ["d2M- bg"]);
});

// ---- The vectors, against the arithmetic they test ---------------------------------------

/** `ds.rs`'s operations in JavaScript, every result rounded to f32: a reference the
 *  vectors file has to agree with, so a corrupted file fails here and not on a device. */
const f = Math.fround;
const ref = {
  two_sum(a, b) {
    const s = f(a + b);
    const bb = f(s - a);
    return [s, f(f(a - f(s - bb)) + f(b - bb))];
  },
  quick_two_sum(a, b) {
    const s = f(a + b);
    return [s, f(b - f(s - a))];
  },
  split(a) {
    const c = f(4097 * a);
    const high = f(c - f(c - a));
    return [high, f(a - high)];
  },
  two_prod(a, b) {
    const p = f(a * b);
    const [xh, xl] = ref.split(a);
    const [yh, yl] = ref.split(b);
    return [p, f(f(f(f(f(xh * yh) - p) + f(xh * yl)) + f(xl * yh)) + f(xl * yl))];
  },
  two_sqr(a) {
    const p = f(a * a);
    const [h, l] = ref.split(a);
    const hl = f(h * l);
    return [p, f(f(f(f(h * h) - p) + f(hl + hl)) + f(l * l))];
  },
  ds_add(a0, a1, b0, b1) {
    let [s, se] = ref.two_sum(a0, b0);
    const [t, te] = ref.two_sum(a1, b1);
    let e = f(se + t);
    [s, se] = ref.quick_two_sum(s, e);
    e = f(se + te);
    return ref.quick_two_sum(s, e);
  },
  ds_mul(a0, a1, b0, b1) {
    const [p, pe] = ref.two_prod(a0, b0);
    return ref.quick_two_sum(p, f(pe + f(f(a0 * b1) + f(a1 * b0))));
  },
  ds_sqr(a0, a1) {
    const [p, pe] = ref.two_sqr(a0);
    const c = f(a0 * a1);
    return ref.quick_two_sum(p, f(pe + f(c + c)));
  },
  ds_mul_f32(a0, a1, b) {
    const [p, pe] = ref.two_prod(a0, b);
    return ref.quick_two_sum(p, f(pe + f(a1 * b)));
  },
};

test("every self-test vector is what the double-single arithmetic gives", () => {
  const { cases } = JSON.parse(readFileSync(new URL("vectors.json", SELFTEST), "utf8"));
  assert.equal(cases.length, selftest.vectors.cases);
  const ops = new Set(cases.map((c) => c.op));
  assert.deepEqual([...ops].sort(), [...W.SELFTEST_OPS].sort(), "every primitive is cased");
  for (const c of cases) {
    const got = ref[c.op](...c.in.map(f32Of)).map(bitsOf);
    assert.deepEqual(got, c.out.map((u) => u >>> 0), `${c.op}(${c.in.join(", ")})`);
  }
  // And the cases pack the way the self-test module reads them.
  const packed = W.selfTestCases(cases);
  assert.equal(packed.length, cases.length * W.SELFTEST_STRIDE);
});

// ---- The skip table *(gpu_deep_depth_ckpt163)* --------------------------------------------

test("the skip table is the model's, byte for byte, from the same f64 orbit", () => {
  const frames = selftest.frames.filter((f) => f.bla);
  assert.ok(frames.length > 0, "the self-test holds a frame drawn with a skip table");
  for (const entry of frames) {
    const { manifest, arrays } = bundle(entry.id);
    const f = new DataView(arrays.frame.buffer, arrays.frame.byteOffset, W.FRAME_BYTES);
    const dcmax = manifest.julia
      ? 0
      : B.dcBound({
          sampleWidth: manifest.width_px,
          sampleHeight: manifest.height_px,
          offsetM: [f.getFloat32(8, true), f.getFloat32(12, true)],
          spacingM: f.getFloat32(16, true),
          sc: f.getInt32(20, true),
        });
    const built = B.buildTable({
      points: arrays.orbit_f64,
      count: arrays.orbit_f64.length / 2,
      periodic: manifest.periodic,
      degree: manifest.degree,
      julia: manifest.julia,
      dcmax,
    });
    assert.equal(built.levels, manifest.bla.levels, entry.id);
    assert.equal(built.valid, manifest.bla.valid, entry.id);
    const bytes = (a) => Buffer.from(a.buffer ?? a, a.byteOffset ?? 0, a.byteLength);
    assert.ok(bytes(built.header).equals(bytes(arrays.bla_header)), `${entry.id}: the header`);
    assert.ok(bytes(built.runs).equals(bytes(arrays.bla_runs)), `${entry.id}: the runs`);
  }
  assert.equal(B.HEADER_BYTES, W.BLA_HEADER_BYTES);
  assert.equal(B.RUN_BYTES, W.BLA_RUN_BYTES);
});

test("a skip table is kept while its skips are a share of the window's steps", () => {
  assert.equal(gpu.keepsTable({ steps: 0, skips: 0 }), true, "an empty window decides nothing");
  assert.equal(gpu.keepsTable({ steps: 1000, skips: 1000 * gpu.SKIP_SHARE }), true);
  assert.equal(gpu.keepsTable({ steps: 1000, skips: 1000 * gpu.SKIP_SHARE - 1 }), false);
  // The counts the kernel adds its skips to: the pass's counters, word 3, beside its steps.
  const source = W.kernelSource({ degree: 2, julia: false, interior: true });
  assert.equal((source.match(/atomicAdd\(&counters\[3\], s\);/g) ?? []).length, 1, "the pass counts its skips");
  // One pass entry, walking every pixel or the list, so a backend compiles `run` once.
  assert.equal((source.match(/fn run_pass\(/g) ?? []).length, 1);
  assert.equal((source.match(/run\(i, params\.budget\)/g) ?? []).length, 1);
});

test("a table too short to hold a run is a header of no levels, which finds nothing", () => {
  const points = new Float64Array([0, 0, 0.1, 0.2, 0.3, 0.1, 0.2, 0.2]);
  const t = B.buildTable({ points, count: 4, periodic: false, degree: 2, julia: false, dcmax: 0 });
  assert.equal(t.levels, 0);
  assert.equal(new DataView(t.header).getUint32(4, true), 0);
  assert.equal(t.runs.byteLength, B.RUN_BYTES);
});

test("hypot64 is a scaled square root, exact where the sum is", () => {
  assert.equal(B.hypot64(3, 4), 5);
  assert.equal(B.hypot64(3 * 2 ** -1000, 4 * 2 ** -1000), 5 * 2 ** -1000);
  assert.equal(B.hypot64(3 * 2 ** 1000, 4 * 2 ** 1000), 5 * 2 ** 1000);
  assert.equal(B.hypot64(0, 0), 0);
  assert.equal(B.hypot64(-(2 ** -1074), 0), 2 ** -1074);
});

// ---- The kernel key ---------------------------------------------------------------------

const CONTEXT = {
  palettes: new Map([["inferno", { cyclic: false }]]),
  defaultPalette: "inferno",
  deepHome: () => ({ x: "-0.5", y: "0", w: "3" }),
  deepCap: () => 48551,
};
const DEEP = "dv=3&x=-0.74501772828532335842941892835857434&y=0.14993443275456819177805709088257971&w=2e-11&n=48551&p=inferno";

test("?kernel= is taken off the address whole, and the rest is spelled as it was", () => {
  assert.deepEqual(gpu.takeKernel(`?${DEEP}&kernel=gpu`), { kernel: "gpu", search: `?${DEEP}` });
  assert.deepEqual(gpu.takeKernel(`?kernel=cpu&${DEEP}`), { kernel: "cpu", search: `?${DEEP}` });
  assert.deepEqual(gpu.takeKernel("?kernel=cpu"), { kernel: "cpu", search: "" });
  // A value that is neither is still taken off, and asks for nothing.
  assert.deepEqual(gpu.takeKernel(`?${DEEP}&kernel=fpga`), { kernel: null, search: `?${DEEP}` });
  // Every copy goes; percent-encoding and a plus in the rest are left alone.
  assert.deepEqual(gpu.takeKernel("?a=1%2B2&kernel=gpu&b=x+y&k%65rnel=cpu"), { kernel: "cpu", search: "?a=1%2B2&b=x+y" });
  // No key, no change, to the byte.
  assert.deepEqual(gpu.takeKernel(`?${DEEP}`), { kernel: null, search: `?${DEEP}` });
  assert.deepEqual(gpu.takeKernel(""), { kernel: null, search: "" });
});

test("neither link reader ever sees the key, and no link written from the view carries it", () => {
  // The key is unknown to the deep contract, which refuses it: so it has to be gone first.
  assert.throws(() => deepLink.parse(`?${DEEP}&kernel=gpu`, CONTEXT));
  const { search } = gpu.takeKernel(`?${DEEP}&kernel=gpu`);
  assert.equal(link.isDeep(search), true);
  const view = deepLink.parse(search, CONTEXT);
  const emitted = deepLink.emit(view);
  assert.doesNotMatch(emitted, /kernel/);
  assert.equal(emitted, deepLink.emit(deepLink.parse(`?${DEEP}`, CONTEXT)));
  // And a shallow link loses it the same way, before the shallow reader runs.
  const shallow = gpu.takeKernel("?f=mandelbrot&kernel=cpu");
  assert.equal(shallow.search, "?f=mandelbrot");
  assert.equal(link.isDeep(shallow.search), false);
  assert.equal(link.UI_KEYS.has("kernel"), false, "not a UI key either: it is no part of the contract");
});
