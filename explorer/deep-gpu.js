// The Deep tab's GPU path *(gpu_deep_ship_ckpt162)*: the device, the self-test that earns
// it, and the pass loop that draws a field on it.
//
// **The GPU is the reader's to turn on, and off is off** *(gpu_optin_downloads_ckpt162)*.
// Until the Deep tab's GPU box is ticked (or `?kernel=gpu` asks), nothing here touches
// WebGPU: no adapter, no device, no kernel module fetched, no self-test (`DeepGpu.off`).
// **Once it is ticked, the GPU draws a Deep frame only where this page load's self-test
// passed, and the CPU kernel draws it otherwise.** The self-test is stage 2's: the exported vectors
// through every double-single primitive bit for bit, then two small exported frames
// (`deep-gpu-selftest/`) word for word, `frac` excepted, at two budget schedules each so
// that the resume path is tested too. Any miss, no WebGPU, no adapter, or a fallback
// adapter (a software rasterizer is not a GPU path) leaves the CPU kernel drawing; the
// reason goes to the tab's log, and the box says the GPU is unavailable (`DeepGpu.standing`).
//
// **What a frame on the GPU hands back is the field the CPU kernel would**: one `f64` lane a
// sample, the smooth count where it escaped and `NaN` where it did not, so nothing
// downstream of `DeepRenderer.field` knows which kernel drew it. The kernel is
// `deep-gpu-wgsl.js`, the model's double-single loop with its interior proof
// (`deep-gpu-model`), its skip table where the frame's has a live run (`deep-gpu-bla.js`,
// *gpu_deep_depth_ckpt163*) and its exact orbit points where the orbit flushed (`hiLoOrbit`),
// run under the `handoff` policy: a sample the proof gives up on ends
// `GATED` and is finished by the CPU kernel, which restarts it from the first iteration
// with its own `f64` loop and its own proof (`compute_samples`). So is every sample still
// running when the frame's tail is thin enough at a step checkpoint (`handsTail`), and so
// is every unfinished sample after a lost device. A frame whose quarter pass says it is cheap
// stays on the CPU altogether (`cheap`).
//
// **Passes are sized by time, and that never moves a pixel.** All of a sample's progress
// lives in its state on the device, and the model guarantees any sequence of budgets leaves
// the state one unbounded run does, so a pass is sized to about `PASS_TARGET_MS` of the
// device's own time (its timestamps, where it has them; the wall time to the read-back
// where not), and cut into dispatches of about `DISPATCH_TARGET_MS`, each its own
// submission, so that the desktop and every other context on the card get it between them
// and no dispatch comes near Windows' two-second device timeout. One pass is in flight at
// a time, and the page's event loop runs between passes. The picture is the same however
// the passes and dispatches fell. What the CPU is handed is decided at step checkpoints
// and never by the clock, so a machine draws the same picture every time.
//
// The pure parts (the frame and orbit builders, the value a sample's `out` word means, the
// budget and tail rules, the health policy, the `kernel` key) are exported and held by
// `deep-gpu.test.mjs`; the device code needs a browser and is held by the bench pages.
// `deep-gpu-wgsl.js` is imported only when the GPU is first asked for, so a page that never
// opens the Deep tab never fetches it.

/** Pixel status, `deep-gpu-wgsl.js`'s codes (the test holds them equal). */
export const RUNNING = 0;
export const ESCAPED = 1;
export const CAPPED = 2;
export const INTERIOR = 3;
export const GATED = 4;
/** `out[i]`'s first word where the sample did not escape (`deep-gpu-wgsl.js`'s). */
export const OUT_NONE = 0xffffffff;
/** `Frame.interior`'s policy code the Deep tab runs: a sample the proof gives up on is
 *  handed to the CPU (`POLICY.handoff` in `deep-gpu-wgsl.js`). */
export const HANDOFF = 3;
/** Bytes of `Frame` and `FrameLo`, and of a sample's state with the proof and without. */
export const FRAME_BYTES = 64;
export const FRAME_LO_BYTES = 32;
export const STATE_BYTES = { proof: 128, plain: 56 };
/** Where a dispatch's `budget` and `base` sit in `Params` (`deep-gpu-wgsl.js`'s). */
export const PARAMS_BUDGET = 0;
export const PARAMS_BASE = 36;

/** Threads per workgroup, and the most workgroups one dimension of a dispatch may take
 *  unless the adapter says otherwise. The kernel indexes samples along `x` alone. */
export const WORKGROUP = 64;
const DEFAULT_MAX_GROUPS = 65535;

/** What one pass is sized to, in milliseconds of the device's own time: how often the
 *  counts are read back, and so the latency of a Cancel, the same order as the CPU's bands.
 *  It is not what the desktop waits on; a dispatch is (`DISPATCH_TARGET_MS`). */
export const PASS_TARGET_MS = 100;
/**
 * What one dispatch is sized to, in milliseconds *(gpu_deep_ship_ckpt162, resets)*. A GPU
 * whose compute preempts only at dispatch boundaries (this box's RTX 2060 SUPER says so:
 * "Compute Preemption: Dispatch") makes the desktop compositor, and every other context on
 * the card, wait out each dispatch whole; a 100 ms dispatch is a visible hitch ten times a
 * second, and a dispatch is also the unit Windows' device timeout counts. So a pass's steps
 * are cut into runs (`chunks`), each dispatched over every workgroup and about this long at
 * the cost the last pass measured, and **each submitted on its own**: with a second device
 * timing a one-workgroup dispatch every 16 ms, 8 ms dispatches in one submission still kept
 * it waiting 80 to 110 ms (the scheduler switched only between submissions), and submitted
 * apart, under 30 ms. The read-back is still paid once a pass. Over six heavy frames, 12 ms
 * dispatches took the other context's 99th-percentile wait from 105 ms to 28 ms for no
 * measurable cost (88.7 s of field against 89.7 s).
 *
 * **Steps, not workgroups.** Cutting the frame's workgroups into runs instead cost 6 to 36
 * percent: while few samples are still running they sit in a few runs, and each run's
 * dispatch then holds the card for a handful of busy workgroups. A chunk over every
 * workgroup keeps every running sample in flight, and costs only a read of each state.
 * Workgroups are cut only where a single step over all of them is past the limit.
 */
export const DISPATCH_TARGET_MS = 12;
/**
 * The most sample-steps one dispatch may take however cheap the last pass measured: the
 * one bound on a dispatch that holds whatever the estimate says, so that a clock the card
 * drops between passes cannot stretch one far. On this box a sample-step costs 0.09 to
 * 0.14 ns at degree two and 0.34 to 0.47 ns at degrees five and six at full clock, and
 * up to 10.6 ns in a frame's first pass after six seconds idle (the dispatch's whole time
 * over its sample-steps, so a fixed cost of starting counts as cost). The cap binds only on the cheap kernels, at about 3 to 5 ms of them at full clock,
 * and the worst it allows here at the coldest cost measured is 0.36 s, or 0.57 s at an
 * inferred 17 ns: clear of Windows' default two-second timeout, where 2^27 was not.
 */
export const MAX_DISPATCH_WORK = 1 << 25;
/** The same, before anything has been measured (a frame's first pass, run at the clock an
 *  idle card is still climbing from): 11 ms here at the coldest 10.6 ns a sample-step
 *  measured, and under 2 s on a device about 180 times slower than that. */
export const FIRST_DISPATCH_WORK = 1 << 20;
/** The most dispatches one pass submits, which `Runner`'s slots and timestamps are sized
 *  to; `dispatchPlan` never plans more. */
export const MAX_DISPATCHES = 128;
/**
 * The most a frame's first pass submits: a pass's worth of dispatches at their target, so
 * that the pass nothing has measured is about one pass long whatever the cost, and Cancel
 * lands as soon on it as on any other. Without it the first pass took all `FIRST_BUDGET`
 * steps at the cold clock, a dispatch a step at the first-pass cap: 160 to 330 ms on
 * degree-four to -six frames here.
 */
export function firstDispatches(sizing) {
  return Math.max(1, Math.min(sizing.most, MAX_DISPATCHES, Math.ceil(sizing.pass / sizing.dispatch)));
}
/** A dispatch's timestamp duration is read as at least this: Chrome quantizes them. */
export const TIMESTAMP_FLOOR_MS = 0.1;
/** Every frame's first pass, before it has been measured: small enough for a phone. */
export const FIRST_BUDGET = 32;
export const MIN_BUDGET = 16;
export const MAX_BUDGET = 1 << 20;
/** How much one pass may grow over the last; shrinking is immediate. */
export const GROWTH = 4;
/** The step checkpoints `CHECKPOINT · 2^k` at which the tail rule is asked. */
export const CHECKPOINT = 1024;
/**
 * How many samples still running the CPU takes over from the GPU, by kernel, at a pool of
 * `TAIL_WORKERS` *(gpu_deep_ship_ckpt162, Phase 4)*. A thin tail leaves the GPU
 * latency-bound: a step costs about the same with 300 samples running as with 5,000 (1.4 to
 * 2.7 microseconds a step for the plain kernels on this box, 8 to 14 with the interior
 * proof), so it finishes `n` samples at `n / L` steps a second, while twelve workers run 340
 * to 1,360 million. The two break even near `L · R`: about 1,500 samples for the plain
 * kernels and 5,000 with the proof, alike across degrees two to six. These are the
 * constants that minimized the modelled wait over 24 measured tail-heavy frames, a little
 * above break-even because most of a tail escapes well short of the cap.
 */
export const TAIL_SAMPLES = { plain: 2000, proof: 8000 };
/** The pool `TAIL_SAMPLES` was measured with: the CPU's side scales with its workers. */
export const TAIL_WORKERS = 12;
/**
 * The CPU's estimated full-stage iterations a worker under which a frame stays on the CPU
 * *(gpu_deep_ship_ckpt162, Phase 4)*. Read off the quarter pass where the CPU drew it,
 * which counts what it ran, and off its census where the GPU did (deep_wait_ckpt163). The full stage runs sixteen times its samples, and measured 14.8
 * to 22.0 times its iterations over 109 frames, so the estimate can fall up to about a
 * quarter short. Where the quarter ran 15 M iterations or fewer at twelve workers (a CPU
 * field of 0.1 to 0.7 s) the GPU measured 0.70 to 1.09 times the CPU's speed on 44 frames,
 * its fixed costs (waking from idle, the first passes, the read-back) the whole of its
 * time; from 24 M it measured 1.17 times or better on all but one. No frame fell between,
 * and the threshold, 18.75 M a quarter, sits in the middle of that unmeasured gap.
 * Iterations and not time, so a frame goes the same way on every load.
 */
export const CHEAP_ITERATIONS_PER_WORKER = 25e6;
/** Below this share of samples running, passes run the compacted list, re-cut every
 *  `COMPACT_EVERY` passes. */
export const COMPACT_BELOW = 0.1;
export const COMPACT_EVERY = 8;
/** The picture is read back and handed up at most this often, and only once at least
 *  `PARTIAL_GAIN` more of the frame has finished. */
export const PARTIAL_MS = 500;
export const PARTIAL_GAIN = 0.05;
/** A frame smaller than this stays on the CPU unless `?kernel=gpu` asks: overhead-bound. */
export const GPU_MIN_SAMPLES = 65536;
/** Lost devices a session survives; the next turns the GPU off until a reload. */
export const MAX_LOSSES = 2;
/** Failed acquisitions a session survives (no adapter handed out, a device refused, the
 *  self-test's files or the kernel module not fetched): the browser's or the machine's
 *  moment and not the arithmetic, so a later frame asks again, until this many. */
export const MAX_MISSES = 3;
/**
 * **A frame the GPU may draw waits for the self-test's outcome, not for a clock**
 * *(deep_wait_ckpt163)*. It used to wait `8 q` (its quarter pass's time, between 3 and 30
 * seconds) and then go to the CPU, so on a fresh profile, whose test lands at about 5 s, the
 * first frame of a link was the CPU's picture and the same link a minute later the GPU's:
 * the clock chose a picture, which the Deep tab's rule forbids. Now a frame the counts say
 * the GPU should draw waits for the answer, and this bound is a liveness guard only: a test
 * still running at it is abandoned for the session, its late answer ignored, so every frame
 * after goes the same way as the one that gave up.
 */
export const SETTLE_BOUND_MS = 30000;
/** And under `?kernel=gpu`, which a harness asks for in order to measure the GPU. */
export const FORCED_WAIT_MS = 120000;

/**
 * **The quarter pass on the GPU** *(deep_wait_ckpt163)*: where the box is ticked, the
 * self-test has passed, and the CPU's census of the frame (one quarter sample in sixteen,
 * drawn first) says the quarter would run at least this many iterations a worker, the
 * quarter is the GPU's too. 150 M a worker is a CPU quarter of 1.5 to 2 s here, where the
 * GPU's fixed costs (its first passes, a read-back, a compile on first use) are well under
 * what it saves; a frame the census puts there is a hundred times the cheap line, so it is
 * one whose full pass the GPU draws as well. Iterations and not time, so a frame goes the
 * same way on every load.
 */
export const QUARTER_ITERATIONS_PER_WORKER = 150e6;
/** Degrees four to six compile two to three times longer on first use, and the quarter
 *  waits for that compile where the full pass would have overlapped it. */
export const QUARTER_HIGH_DEGREE_FACTOR = 3;

/** Whether the census's estimate of the quarter's iterations puts the quarter on the GPU. */
export function quarterOnGpu({ iterations, degree = 2, workers = TAIL_WORKERS }) {
  const line = QUARTER_ITERATIONS_PER_WORKER * workers * (degree >= 4 ? QUARTER_HIGH_DEGREE_FACTOR : 1);
  return iterations != null && iterations >= line;
}

// ---- The debugging key ----------------------------------------------------------------

/**
 * `?kernel=cpu|gpu`, taken off a query string *(gpu_deep_ship_ckpt162)*: a debugging
 * override and no part of the link contract. Resolves `{kernel, search}`: the value asked
 * for (`null` where the key is absent or says neither) and the query without every
 * `kernel` entry, the rest of it spelled exactly as it was, so neither link parser ever
 * sees the key and no link written from the view can carry it.
 */
export function takeKernel(search) {
  const body = search.startsWith("?") ? search.slice(1) : search;
  if (body === "") return { kernel: null, search };
  let kernel = null;
  let found = false;
  const decode = (text) => {
    try {
      return decodeURIComponent(text.replaceAll("+", " "));
    } catch {
      return text;
    }
  };
  const kept = body.split("&").filter((part) => {
    const at = part.indexOf("=");
    if (decode(at < 0 ? part : part.slice(0, at)) !== "kernel") return true;
    found = true;
    const value = at < 0 ? "" : decode(part.slice(at + 1));
    if (value === "cpu" || value === "gpu") kernel = value;
    return false;
  });
  if (!found) return { kernel: null, search };
  return { kernel, search: kept.length > 0 ? `?${kept.join("&")}` : "" };
}

// ---- Numbers the frame is built from -------------------------------------------------

const scratch = new DataView(new ArrayBuffer(8));

/** `x` rounded to `f32`, a subnormal result stored as a signed zero (`orbit.rs`'s
 *  `narrow`): `Math.fround` keeps subnormals and the device flushes them. */
export function narrow(x) {
  const y = Math.fround(x);
  if (y !== 0 && Math.abs(y) < 2 ** -126) return y < 0 ? -0 : 0;
  return y;
}

/** The biased exponent of an `f64`, less 1023: `orbit.rs`'s `exponent_f64` (a subnormal
 *  gives -1023). */
export function exponentBits(x) {
  scratch.setFloat64(0, x, true);
  return ((scratch.getUint32(4, true) >>> 20) & 0x7ff) - 1023;
}

/** `frame.rs`'s `exponent_f64`: `x` in `[2^e, 2^(e+1))`, and 0 for anything not positive
 *  and finite. */
export function frameExponent(x) {
  if (!(x > 0) || !Number.isFinite(x)) return 0;
  return exponentBits(x);
}

/** `2^e` exactly, by its bits, for `e` in the normal range. */
export function pow2(e) {
  if (!Number.isInteger(e) || e < -1022 || e > 1023) throw new Error(`2^${e} is out of range`);
  scratch.setUint32(0, 0, true);
  scratch.setUint32(4, (e + 1023) << 20, true);
  return scratch.getFloat64(0, true);
}

/**
 * The interior proof's margins, `proof.rs`'s `Margins::new`: `{spacing, point, step, add}`
 * for an `f32` kernel (`Frame`'s) or a double-single one on a `HiLo` orbit (`FrameLo`'s).
 */
export function margins(degree, precision) {
  const d = degree;
  const ds = precision === "ds";
  const u = ds ? 2 ** -44 : 2 ** -24;
  const uz = ds ? 2 ** -47 : 2 ** -23;
  const spacing = ds ? 8 : 4;
  const cd = 3 * (d - 2) + 5 * (d - 1) + 4;
  const exponent = (kappa) => Math.floor(-Math.log2(kappa));
  return {
    spacing,
    point: exponent(2 * (2 * u + uz)),
    step: exponent(2 * d * (cd * u + (d - 1) * uz)),
    add: exponent(4 * u),
  };
}

/**
 * The `Frame` and `FrameLo` uniforms for a frame, `frame.rs`'s `from_spec` for both, read
 * off `perturb.wasm`'s own `plan` of the spec rather than re-derived: `offset_re/im` are the
 * offset `compute_rows` forms `dc` from, `spacing` its sample step, `entry` the orbit index
 * a sample starts at (clamped to the orbit as `Frame::from_spec` does). `policy` is
 * `Frame.interior`: 0 with the switch off, else the gated policy's code.
 */
export function frameBuffers(plan, orbitLength, policy) {
  const offset = [plan.offset_re, plan.offset_im];
  const big = Math.max(Math.abs(offset[0]), Math.abs(offset[1]), plan.width);
  const sc = frameExponent(big);
  const unit = pow2(-sc);
  const offsetM = offset.map((x) => narrow(x * unit));
  const spacingM = narrow(plan.spacing * unit);
  const frame = new ArrayBuffer(FRAME_BYTES);
  const f = new DataView(frame);
  f.setUint32(0, plan.sample_width, true);
  f.setUint32(4, plan.sample_height, true);
  f.setFloat32(8, offsetM[0], true);
  f.setFloat32(12, offsetM[1], true);
  f.setFloat32(16, spacingM, true);
  f.setInt32(20, sc, true);
  f.setUint32(24, plan.maxiter, true);
  f.setUint32(28, plan.degree, true);
  f.setUint32(32, plan.julia ? 1 : 0, true);
  f.setUint32(36, Math.min(plan.entry, Math.max(0, orbitLength - 1)), true);
  f.setUint32(40, plan.interior ? policy : 0, true);
  f.setInt32(44, plan.interior_floor, true);
  const single = margins(plan.degree, "f32");
  [single.spacing, single.point, single.step, single.add].forEach((m, k) => f.setInt32(48 + 4 * k, m, true));
  const frameLo = new ArrayBuffer(FRAME_LO_BYTES);
  const l = new DataView(frameLo);
  l.setFloat32(0, narrow(offset[0] * unit - offsetM[0]), true);
  l.setFloat32(4, narrow(offset[1] * unit - offsetM[1]), true);
  l.setFloat32(8, narrow(plan.spacing * unit - spacingM), true);
  l.setUint32(12, 0, true);
  const double = margins(plan.degree, "ds");
  [double.spacing, double.point, double.step, double.add].forEach((m, k) => l.setInt32(16 + 4 * k, m, true));
  return { frame, frameLo };
}

/** `orbit.rs`'s `FLUSH`: the least `flush` any flushed component gives. */
const FLUSH = 125;

/**
 * `perturb.wasm`'s packed reference (`count`, flags, the period residual, then `f64`
 * pairs from byte 16) as the device holds it: `orbit.rs`'s `GpuOrbit` under `HiLo`, one
 * `[re_hi, im_hi, re_lo, im_lo]` a point, a subnormal component stored as a signed zero,
 * and `flush`, the bound on what that flushing left (0 where nothing flushed).
 *
 * Where anything flushed, `exact` too *(gpu_deep_depth_ckpt163)*: `orbit.rs`'s exact points,
 * `EXACT_BYTES` a point as the kernel binds them, a point narrowing flushed some of kept as
 * the point times `2^-e` (`e` its larger component's exponent) with `e`, and every other as
 * stored with 0. The kernel reads them where it forms `Z` in the delta's units, so that a
 * minibrot's near-zero returns are their true size there; `null` where nothing flushed.
 */
export function hiLoOrbit(packed) {
  const buffer = packed instanceof ArrayBuffer ? packed : packed.buffer.slice(packed.byteOffset, packed.byteOffset + packed.byteLength);
  const head = new DataView(buffer);
  const count = head.getUint32(0, true);
  const flags = head.getUint32(4, true);
  const pairs = new Float64Array(buffer, 16, 2 * count);
  const points = new Float32Array(4 * count);
  const flushed = new Uint8Array(count);
  let worst = null;
  let k = 0;
  const keep = (x) => {
    const y = narrow(x);
    if (x !== 0 && y === 0) {
      const e = exponentBits(x);
      worst = worst === null ? e : Math.max(worst, e);
      flushed[k] = 1;
    }
    return y;
  };
  for (k = 0; k < count; k++) {
    const re = pairs[2 * k];
    const im = pairs[2 * k + 1];
    const reHi = keep(re);
    const imHi = keep(im);
    points[4 * k] = reHi;
    points[4 * k + 1] = imHi;
    // Exact in f64, for the reason `orbit.rs` gives, then rounded once.
    points[4 * k + 2] = keep(re - reHi);
    points[4 * k + 3] = keep(im - imHi);
  }
  let exact = null;
  if (worst !== null) {
    exact = new ArrayBuffer(EXACT_BYTES * count);
    const values = new Float32Array(exact);
    const exponents = new Int32Array(exact);
    const words = EXACT_BYTES / 4;
    for (let j = 0; j < count; j++) {
      const at = words * j;
      if (flushed[j] === 0) {
        values.set(points.subarray(4 * j, 4 * j + 4), at);
        continue;
      }
      const re = pairs[2 * j];
      const im = pairs[2 * j + 1];
      const e = exponentBits(Math.max(Math.abs(re), Math.abs(im)));
      const sr = re * pow2(-e);
      const si = im * pow2(-e);
      const hr = narrow(sr);
      const hi = narrow(si);
      values[at] = hr;
      values[at + 1] = hi;
      values[at + 2] = narrow(sr - hr);
      values[at + 3] = narrow(si - hi);
      exponents[at + 4] = e;
    }
  }
  return {
    points,
    count,
    periodic: (flags & 2) !== 0,
    flush: worst === null ? 0 : Math.max(FLUSH, -(worst + 2)),
    exact,
  };
}

/** Bytes of one exact orbit point, `deep-gpu-wgsl.js`'s `EXACT_BYTES`. */
export const EXACT_BYTES = 32;

// ---- What a sample's `out` word means -------------------------------------------------

/**
 * Fill `values` from the `emit` buffer: an escaped sample's smooth count `n + frac`, the
 * model's `smooth` and `perturb`'s `(n + 1) − log_D(…)` (where the fraction is not finite,
 * `n + 1`, the CPU kernel's own fallback); `NaN` where it was capped or proved interior.
 * A sample still running or handed back is left alone in `values` unless `fallback` gives
 * it a stand-in. `final`, where given, is marked for every sample that now holds its last
 * value. Returns how many samples are final.
 */
export function fillValues(words, values, { final = null, fallback = null } = {}) {
  const fracs = new Float32Array(words.buffer, words.byteOffset, words.length);
  let done = 0;
  for (let i = 0; i < values.length; i++) {
    const first = words[2 * i];
    if (first !== OUT_NONE) {
      const frac = fracs[2 * i + 1];
      values[i] = Number.isFinite(frac) ? first + frac : first + 1;
    } else {
      const status = words[2 * i + 1];
      if (status !== CAPPED && status !== INTERIOR) {
        if (fallback !== null) values[i] = fallback(i);
        continue;
      }
      values[i] = NaN;
    }
    if (final !== null) final[i] = 1;
    done += 1;
  }
  return done;
}

/** How many samples of an `out` read-back the interior proof gave up on (`GATED`): of what a
 *  frame hands the CPU, the share its proof sent rather than its tail. */
export function gatedIn(words) {
  let count = 0;
  for (let i = 0; i < words.length; i += 2) count += words[i] === OUT_NONE && words[i + 1] === GATED;
  return count;
}

/** The samples the CPU is to finish: every one not marked in `final`. */
export function unfinished(final) {
  let count = 0;
  for (let i = 0; i < final.length; i++) count += final[i] === 0;
  const list = new Uint32Array(count);
  let k = 0;
  for (let i = 0; i < final.length; i++) if (final[i] === 0) list[k++] = i;
  return list;
}

/** A stand-in for an unfinished sample out of the quarter pass's field, nearest cell. */
export function previewOf(preview, sampleWidth, sampleHeight) {
  if (preview == null || preview.values == null) return null;
  const qw = preview.width * (preview.supersample ?? 1);
  const qh = preview.height * (preview.supersample ?? 1);
  if (!(qw > 0 && qh > 0) || preview.values.length < qw * qh) return null;
  return (i) => {
    const col = i % sampleWidth;
    const row = (i - col) / sampleWidth;
    const qc = Math.min(qw - 1, Math.floor((col * qw) / sampleWidth));
    const qr = Math.min(qh - 1, Math.floor((row * qh) / sampleHeight));
    return preview.values[qr * qw + qc];
  };
}

// ---- Pass sizing and the tail ---------------------------------------------------------

/** A budget inside its bounds: at least `MIN_BUDGET`, at most `MAX_BUDGET`, and never one
 *  whose steps could overflow the pass's u32 count over `running` samples. */
export function clampBudget(budget, running) {
  const most = running > 0 ? Math.floor(0xffffffff / running) : MAX_BUDGET;
  return Math.max(1, Math.min(Math.max(MIN_BUDGET, Math.min(Math.floor(budget), MAX_BUDGET)), most));
}

/**
 * The next pass's budget from the last one's: about `target` milliseconds at the cost a
 * budget step just measured (`ms`, the device's own time where it has timestamps, else the
 * wall time to the read-back), growing at most `GROWTH` times and shrinking at once.
 */
export function nextBudget({ budget, ms, running, target = PASS_TARGET_MS }) {
  const perStep = ms / Math.max(1, budget);
  const want = perStep > 0 ? target / perStep : budget * GROWTH;
  return clampBudget(Math.min(want, budget * GROWTH), running);
}

/**
 * How one pass of `budget` steps over `groups` workgroups is cut into dispatches: `{budget,
 * per, slices, step, chunks}`, `slices` runs of at most `per` workgroups each run `chunks`
 * times at most `step` steps, every dispatch at most `limit` workgroup-steps. `limit` is
 * `target` milliseconds at `cost` (milliseconds a workgroup-step, the densest dispatch
 * last measured; `null` before any) and never more than `maxWork` sample-steps. Steps are
 * cut, and workgroups only where one step over all of them is past the limit
 * (`DISPATCH_TARGET_MS` says why). A pass that would need more than `most` dispatches
 * takes fewer steps, so the budget comes back no larger than it went in; where even one
 * step over every workgroup would need more than `most` slices, the slices widen past the
 * limit to `most` of them, since a pass of more is one `Runner` has no room for (it takes
 * over 23 µs a workgroup-step on the widest frame, 65,535 workgroups, near 800 times this
 * card's degree-six cost at full clock). Counts and the cost only: no clock is read.
 */
export function dispatchPlan({ budget, groups, cost = null, target = DISPATCH_TARGET_MS, maxWork = MAX_DISPATCH_WORK, most = MAX_DISPATCHES }) {
  const g = Math.max(1, groups);
  const timed = cost > 0 ? target / cost : Infinity;
  const limit = Math.max(1, Math.floor(Math.min(maxWork / WORKGROUP, timed)));
  let b = Math.max(1, Math.floor(budget));
  if (![g, limit, b, most].every((x) => x >= 1)) throw new Error(`no dispatch plan for ${JSON.stringify({ budget, groups, cost, target, maxWork, most })}`);
  const per = Math.ceil(g / Math.min(Math.ceil(g / limit), most));
  const slices = Math.ceil(g / per);
  const step = Math.max(1, Math.floor(limit / per));
  if (slices * Math.ceil(b / step) > most) b = Math.max(1, step * Math.floor(most / slices));
  return { budget: b, per, slices, step: Math.min(b, step), chunks: Math.ceil(b / Math.min(b, step)) };
}

/**
 * The cost a pass measured, for the next one's `dispatchPlan`: the densest dispatch's
 * milliseconds a workgroup-step, from `durations` (one a dispatch, `null` without
 * timestamps) over `dispatches` (`{groups, budget}` each); without timestamps, twice the
 * pass's average from `wallMs`, since the work need not be spread evenly.
 */
export function dispatchCost({ dispatches, durations, wallMs }) {
  if (durations != null) {
    let worst = 0;
    dispatches.forEach((d, k) => {
      worst = Math.max(worst, Math.max(durations[k], TIMESTAMP_FLOOR_MS) / (d.groups * d.budget));
    });
    return worst;
  }
  const work = dispatches.reduce((sum, d) => sum + d.groups * d.budget, 0);
  return work > 0 ? (2 * Math.max(wallMs, TIMESTAMP_FLOOR_MS)) / work : null;
}

/** A frame's passes in brief, off its record's `trace`, for the tab's log: passes and
 *  dispatches, the longest pass and dispatch on the device (`null` without timestamps), and
 *  the longest pass's wall time. `over` keeps the first `OVER_KEPT` passes that ran past
 *  twice either target, each as its index and its `trace` row, so that an overshoot can be
 *  placed (which pass, which mode, how many dispatches) without the whole trace. */
export function passStats(record) {
  let pass = null;
  let dispatch = null;
  let wall = 0;
  const over = [];
  record.trace.forEach((row, k) => {
    wall = Math.max(wall, row[3]);
    if (row[4] != null) pass = Math.max(pass ?? 0, row[4]);
    if (row[6] != null) dispatch = Math.max(dispatch ?? 0, row[6]);
    const long = (row[4] ?? row[3]) > 2 * PASS_TARGET_MS || (row[6] ?? 0) > 2 * DISPATCH_TARGET_MS;
    if (long && over.length < OVER_KEPT) over.push([k, ...row]);
  });
  return { passes: record.passes, dispatches: record.dispatches, maxPassMs: pass, maxDispatchMs: dispatch, maxWallMs: wall, over };
}

/** How many overshooting passes `passStats` keeps a frame. */
export const OVER_KEPT = 8;

/** Back to the event loop between passes, past the microtask queue: a page's input and
 *  paint run before the next submission. */
export function yieldTask() {
  if (typeof globalThis.scheduler?.yield === "function") return globalThis.scheduler.yield();
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      resolve();
    };
    channel.port2.postMessage(0);
  });
}

/** Whether `spent` steps is a checkpoint, `CHECKPOINT · 2^k`. */
export function isCheckpoint(spent) {
  if (spent < CHECKPOINT || spent % CHECKPOINT !== 0) return false;
  const k = spent / CHECKPOINT;
  return (k & (k - 1)) === 0;
}

/** `budget`, cut so that a pass never steps over the next checkpoint. */
export function landOn(spent, budget) {
  let next = CHECKPOINT;
  while (next <= spent) next *= 2;
  return Math.min(budget, next - spent);
}

/**
 * The tail rule: at a checkpoint below the cap, with few enough samples still running, the
 * GPU stops and the CPU finishes the rest. Few enough is `TAIL_SAMPLES` for the kernel,
 * scaled to the pool's workers, and scaled again by the share of the cap still to run: the
 * CPU restarts every sample it is handed from the first iteration, so at a checkpoint near
 * the cap it would redo nearly all of what the GPU has already done, and the GPU finishing
 * the last stretch is cheaper. An absolute count and not a share of the frame, because the
 * GPU's cost of a thin tail does not grow with the frame. `scale` is a bench page's knob (0
 * never hands anything over). Steps and counts, never time, so the samples handed over are
 * the same on every run.
 */
export function handsTail({ spent, running, maxiter, interior, workers = TAIL_WORKERS, scale = 1 }) {
  if (!(running > 0 && isCheckpoint(spent) && spent < maxiter)) return false;
  const most = TAIL_SAMPLES[interior ? "proof" : "plain"] * (workers / TAIL_WORKERS) * scale;
  return running <= most * (1 - spent / maxiter);
}

/**
 * Whether a full stage is cheap enough that the CPU draws it as soon as the GPU would:
 * `iterations`, the CPU's estimate of the stage (its quarter pass's iterations, scaled by
 * the samples), under `CHEAP_ITERATIONS_PER_WORKER` for each of its `workers`. `null` where
 * there is no estimate, which is never cheap.
 */
export function cheap({ iterations, workers = TAIL_WORKERS }) {
  return iterations != null && iterations >= 0 && iterations < CHEAP_ITERATIONS_PER_WORKER * workers;
}

/**
 * Which way a pass runs: every sample (`all`), the compacted list (`list`), or the list
 * re-cut first (`compact`). `listed` is how many passes have run since the last cut, or
 * `null` before the first.
 */
export function passMode(running, count, listed) {
  if (listed === null) return running < COMPACT_BELOW * count ? "compact" : "all";
  return listed % COMPACT_EVERY === COMPACT_EVERY - 1 ? "compact" : "list";
}

/**
 * How many sample rows a strip of this frame is *(gpu_optin_downloads_ckpt162)*, or 0 where
 * not even one row fits. A strip is the most whole rows the device holds at once: one
 * dispatch dimension's workgroups for `init`, `compact` and `emit`, which cover every sample
 * of a strip in one dispatch, and a state and an `out` buffer inside the adapter's binding
 * and buffer limits. The strips are then evened out, so the last is not a sliver. A frame
 * the device holds whole is one strip, exactly the frame it always drew.
 */
export function stripRows({ sampleWidth, sampleHeight, interior, limits }) {
  const bytes = Math.min(limits.maxStorageBufferBindingSize, limits.maxBufferSize);
  const most = Math.min(
    (limits.maxComputeWorkgroupsPerDimension ?? DEFAULT_MAX_GROUPS) * WORKGROUP,
    Math.floor(bytes / (interior ? STATE_BYTES.proof : STATE_BYTES.plain)),
    Math.floor(bytes / 8),
  );
  const rows = Math.floor(most / sampleWidth);
  if (!(rows >= 1)) return 0;
  return Math.ceil(sampleHeight / Math.ceil(sampleHeight / rows));
}

/**
 * Whether the device can draw this frame at all, or the reason it cannot: a degree the
 * kernel does not draw, an orbit past the adapter's limits, or a single row too wide for
 * a strip (`stripRows`). Such a frame is the CPU's, whatever else is true. A frame past one
 * dispatch is no longer one of them: it is drawn a strip at a time. `sampleWidth` is the
 * frame's row; where it is not given, a frame of `samples` is taken as rows of at most the
 * widest a download can ask for.
 */
export function fits({ samples, degree, interior, orbitPoints, limits, sampleWidth = Math.min(samples, WIDEST_ROW) }) {
  if (!(degree >= 2 && degree <= 6)) return "degree";
  const binding = limits.maxStorageBufferBindingSize;
  const buffer = limits.maxBufferSize;
  if (16 * orbitPoints > binding || 16 * orbitPoints > buffer) return "orbit";
  const sampleHeight = Math.ceil(samples / Math.max(1, sampleWidth));
  if (stripRows({ sampleWidth, sampleHeight, interior, limits }) === 0) return "row";
  return null;
}

/** The widest sample row a frame can have: an 8192-pixel download at 16× (`download.js`'s
 *  `MAX_SIDE` and its widest supersample). */
export const WIDEST_ROW = 8192 * 4;

/**
 * The GPU's standing for the session. `untested` until a self-test runs, `ready` once one
 * passes, `off` for good after a self-test fails (the arithmetic is wrong, not unlucky) or
 * the WebGPU it needs is missing, and `lost` after a lost device, which the next frame
 * retries with a fresh device and a fresh self-test, until `MAX_LOSSES` turns it `off`.
 * `unavailable` is an acquisition that failed for the moment — no adapter, a device
 * refused, a file not fetched — which the next frame asks again, until `MAX_MISSES`.
 */
export class Health {
  constructor(max = MAX_LOSSES, maxMisses = MAX_MISSES) {
    this.max = max;
    this.maxMisses = maxMisses;
    this.status = "untested";
    this.losses = 0;
    this.misses = 0;
    this.why = null;
  }

  passed() {
    if (this.status !== "off") this.status = "ready";
  }

  failed(why) {
    this.status = "off";
    this.why = why;
  }

  lost(why) {
    this.losses += 1;
    this.why = why;
    if (this.status !== "off") this.status = this.losses >= this.max ? "off" : "lost";
  }

  unavailable(why) {
    this.misses += 1;
    this.why = why;
    if (this.status !== "off") this.status = this.misses >= this.maxMisses ? "off" : "unavailable";
  }

  /** The reader turned the GPU off and the device was given up: not a loss, and nothing
   *  the arithmetic said, so a later tick tests a fresh device. */
  stoodDown() {
    if (this.status === "ready") this.status = "untested";
  }

  get usable() {
    return this.status === "ready";
  }

  /** Whether a frame should (re)start the device and its self-test. */
  get wants() {
    return this.status === "untested" || this.status === "lost" || this.status === "unavailable";
  }
}

// ---- The device -----------------------------------------------------------------------

/** How long a rejected device call waits for `device.lost` before it is taken as the
 *  call's own failure (`#guard`). */
const LOSS_SETTLE_MS = 1000;

/** Thrown where the device was lost under a frame: the frame finishes on the CPU. */
export class GpuLost extends Error {}
/** Thrown where the GPU cannot serve this frame (an allocation refused, say): the frame
 *  is the CPU's, and the device is not at fault. */
class Unserved extends Error {}
/** Thrown where the GPU could not be acquired or tested for the moment — no adapter handed
 *  out, a device the browser refused, a file not fetched — which says nothing about the
 *  arithmetic, so a later frame asks again (`Health.unavailable`). */
class Unavailable extends Error {}

let wgslModule = null;
// A rejected import is forgotten, so a later frame's acquisition asks again.
const wgsl = () =>
  (wgslModule ??= import("./deep-gpu-wgsl.js").catch((error) => {
    wgslModule = null;
    throw new Unavailable(`the kernel module: ${error?.message ?? error}`);
  }));

let blaModule = null;
// The skip table's builder, fetched with the kernel module and forgotten where refused.
const blaBuilder = () =>
  (blaModule ??= import("./deep-gpu-bla.js").catch((error) => {
    blaModule = null;
    throw new Unavailable(`the skip table's builder: ${error?.message ?? error}`);
  }));

const SELFTEST = new URL("./deep-gpu-selftest/", import.meta.url);

/** Compile one module, refusing on any error the compiler reports. */
async function compile(device, code, label) {
  // In a scope of its own, so a module that will not compile is this call's refusal and
  // never an uncaptured error charged to whatever frame runs next.
  device.pushErrorScope("validation");
  const module = device.createShaderModule({ code, label });
  const scoped = await device.popErrorScope();
  const info = await module.getCompilationInfo();
  if (scoped) throw new Error(`${label}: ${scoped.message}`);
  const errors = info.messages.filter((m) => m.type === "error");
  if (errors.length > 0) throw new Error(`${label}: ${errors[0].lineNum}:${errors[0].linePos} ${errors[0].message}`);
  return module;
}

/**
 * Whether a skip table still pays, from the skips the kernel took against the steps it took
 * since the last step checkpoint *(gpu_deep_depth_ckpt163)*. A run saves at least fifteen
 * iterations, and looking runs up costs every sixteenth step a read whether one is found or
 * not: `go:favicon-end` (cap two million) drew 18% slower with its table, whose live runs its
 * deltas almost never fit, for 3% fewer steps. Under `SKIP_SHARE` of the window's steps the
 * table is dropped for the rest of the frame. Counts and not time, so a frame drops it at the
 * same checkpoint on every run.
 */
export function keepsTable({ steps, skips }) {
  return !(steps > 0) || skips >= SKIP_SHARE * steps;
}
/** A run saves at least fifteen iterations a skip, so 2% of the steps saves at least 30% of
 *  the iterations, against the 18% `go:favicon-end`'s lookups cost it. Measured per window
 *  at screen size: the busy deep frames B and C skip on 6.6% of their steps until they finish,
 *  `go:favicon-end` on 0.77%, `go:julia3-end` on none. */
export const SKIP_SHARE = 0.02;

/** The widest frame a skip table is built for, `2^-100` (about 7.9e-31): past it the table
 *  pays (A, B and C from 1e-60 down, 1.3x to 3.6x on the device's field), short of it no
 *  measured frame kept one (*The skip table on the GPU*, `explorer/README.md`). */
export const TABLE_WIDTH = 2 ** -100;

/** The orbit points a skip table is first built over: where they hold no live run, the
 *  frame's table is not built at all. About 20 ms of build. */
export const TABLE_PROBE = 65536;

/** A skip table's header uniform and runs buffer, written from `header` and `runs`. */
function tableBuffers(device, header, runs, label) {
  const made = {
    header: device.createBuffer({ size: header.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST, label: `${label} header` }),
    runs: device.createBuffer({ size: Math.max(64, runs.byteLength), usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST, label: `${label} runs` }),
  };
  device.queue.writeBuffer(made.header, 0, header);
  device.queue.writeBuffer(made.runs, 0, runs);
  return made;
}

/** Pop a validation scope and the out-of-memory scope under it; the first error of the
 *  two, or `null`. Both are always popped, so no scope is left behind. */
async function popBoth(device) {
  // Both popped before either is awaited: a scope is the device's and not this call's, so
  // nothing else may push between them.
  const [validation, memory] = await Promise.all([device.popErrorScope(), device.popErrorScope()]);
  return validation ?? memory;
}

/**
 * A pass's dispatches from its `dispatchPlan`, in the order they run: every slice at the
 * first chunk's steps, then every slice at the next. `base` is the first invocation, so a
 * slice covers samples (or list entries) `base` to `base + 64 · groups`.
 */
export function dispatchesOf(plan, groups) {
  const out = [];
  for (let c = 0, left = plan.budget; c < plan.chunks; c++) {
    const budget = Math.min(plan.step, left);
    left -= budget;
    for (let s = 0; s < plan.slices; s++) {
      const first = s * plan.per;
      out.push({ base: first * WORKGROUP, groups: Math.min(plan.per, groups - first), budget, last: c === plan.chunks - 1 });
    }
  }
  return out;
}

/** One frame's buffers on the device, for `count` samples, with the proof or without. */
class Runner {
  constructor(device, count, interior, timed) {
    const usage = GPUBufferUsage;
    const make = (size, flags, label) => device.createBuffer({ size: Math.max(16, Math.ceil(size / 4) * 4), usage: flags, label });
    this.device = device;
    /** The samples its buffers hold, and the most a strip drawn on them may be. */
    this.capacity = count;
    this.count = count;
    this.interior = interior;
    this.stateBytes = interior ? STATE_BYTES.proof : STATE_BYTES.plain;
    this.frame = make(FRAME_BYTES, usage.UNIFORM | usage.COPY_DST, "deep frame");
    this.frameLo = make(FRAME_LO_BYTES, usage.UNIFORM | usage.COPY_DST, "deep frame_lo");
    this.params = make(48, usage.UNIFORM | usage.COPY_DST, "deep params");
    this.states = make(count * this.stateBytes, usage.STORAGE | usage.COPY_SRC, "deep states");
    this.counters = make(16, usage.STORAGE | usage.COPY_SRC | usage.COPY_DST, "deep counters");
    this.list = make(4 * count, usage.STORAGE, "deep list");
    this.out = make(8 * count, usage.STORAGE | usage.COPY_SRC, "deep out");
    // Each dispatch's `budget` and `base`, copied into `params` before it runs.
    this.slots = make(8 * MAX_DISPATCHES, usage.COPY_SRC | usage.COPY_DST, "deep dispatch slots");
    // The counters, then each dispatch's two timestamps.
    this.read = make(16 + 16 * MAX_DISPATCHES, usage.MAP_READ | usage.COPY_DST, "deep pass read");
    this.outRead = make(8 * count, usage.MAP_READ | usage.COPY_DST, "deep out read");
    this.queries = null;
    if (timed) {
      this.queries = device.createQuerySet({ type: "timestamp", count: 2 * MAX_DISPATCHES, label: "deep dispatch times" });
      this.resolved = make(16 * MAX_DISPATCHES, usage.QUERY_RESOLVE | usage.COPY_SRC, "deep dispatch times resolved");
    }
    this.groups = Math.ceil(count / WORKGROUP);
  }

  /** Draw the next strip, of `count` samples, on these buffers. */
  use(count) {
    if (count > this.capacity) throw new Unserved(`a strip of ${count} samples on buffers for ${this.capacity}`);
    this.count = count;
    this.groups = Math.ceil(count / WORKGROUP);
  }

  destroy() {
    for (const b of [this.frame, this.frameLo, this.params, this.states, this.counters, this.list, this.out, this.slots, this.read, this.outRead, this.queries, this.resolved]) {
      try {
        b?.destroy();
      } catch {
        // A lost device's buffers are gone already.
      }
    }
  }

  bind(layouts, orbit, table, exact) {
    const buffers = [this.frame, this.frameLo, this.params, orbit, this.states, this.counters, this.list, this.out, table.header, table.runs, exact];
    this.group0 = this.device.createBindGroup({ layout: layouts[0], entries: buffers.map((buffer, binding) => ({ binding, resource: { buffer } })) });
  }

  init(p) {
    const encoder = this.device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(p.init);
    pass.setBindGroup(0, this.group0);
    pass.dispatchWorkgroups(this.groups);
    pass.end();
    this.device.queue.submit([encoder.finish()]);
  }

  /**
   * One pass over every sample or the list, as `dispatches` (`dispatchesOf`), in one
   * submission; resolves the samples still running after it, the steps it took, and each
   * dispatch's device time in milliseconds (`durations`, `null` without timestamps or
   * where they read as nonsense). One pass is in flight at a time: this awaits its own
   * read-back before it returns.
   */
  async pass(p, dispatches, mode, guard, split = false) {
    const device = this.device;
    const n = dispatches.length;
    // Past the slots and timestamps a pass has room for, the device would refuse the pass
    // and it would read as a lost one; the frame is declined instead.
    if (n < 1 || n > MAX_DISPATCHES) throw new Unserved(`a pass of ${n} dispatches`);
    const slots = new Uint32Array(2 * n);
    dispatches.forEach((d, k) => {
      slots[2 * k] = d.budget;
      slots[2 * k + 1] = d.base;
    });
    device.queue.writeBuffer(this.slots, 0, slots);
    const buffers = [];
    let encoder = device.createCommandEncoder();
    if (mode === "compact") {
      encoder.clearBuffer(this.counters, 4, 4);
      const c = encoder.beginComputePass();
      c.setBindGroup(0, this.group0);
      c.setPipeline(p.compact);
      c.dispatchWorkgroups(this.groups);
      c.end();
    }
    encoder.clearBuffer(this.counters, 8, 8);
    let cleared = false;
    dispatches.forEach((d, k) => {
      // The running count is the last chunk's alone: every chunk's dispatches add to it.
      if (d.last && !cleared) {
        encoder.clearBuffer(this.counters, 0, 4);
        cleared = true;
      }
      encoder.copyBufferToBuffer(this.slots, 8 * k, this.params, PARAMS_BUDGET, 4);
      encoder.copyBufferToBuffer(this.slots, 8 * k + 4, this.params, PARAMS_BASE, 4);
      const pass = encoder.beginComputePass(
        this.queries === null ? {} : { timestampWrites: { querySet: this.queries, beginningOfPassWriteIndex: 2 * k, endOfPassWriteIndex: 2 * k + 1 } },
      );
      pass.setBindGroup(0, this.group0);
      pass.setPipeline(mode === "all" ? p.all : p.list);
      pass.dispatchWorkgroups(d.groups);
      pass.end();
      if (split && k < n - 1) {
        buffers.push(encoder.finish());
        encoder = device.createCommandEncoder();
      }
    });
    encoder.copyBufferToBuffer(this.counters, 0, this.read, 0, 16);
    if (this.queries !== null) {
      encoder.resolveQuerySet(this.queries, 0, 2 * n, this.resolved, 0);
      encoder.copyBufferToBuffer(this.resolved, 0, this.read, 16, 16 * n);
    }
    buffers.push(encoder.finish());
    if (split) for (const buffer of buffers) device.queue.submit([buffer]);
    else device.queue.submit(buffers);
    const bytes = 16 + (this.queries === null ? 0 : 16 * n);
    await guard(this.read.mapAsync(GPUMapMode.READ, 0, bytes));
    const got = this.read.getMappedRange(0, bytes).slice(0);
    this.read.unmap();
    const counts = new Uint32Array(got, 0, 4);
    let durations = null;
    if (this.queries !== null) {
      const stamps = new BigUint64Array(got, 16, 2 * n);
      durations = [];
      for (let k = 0; k < n; k++) {
        const ms = Number(stamps[2 * k + 1] - stamps[2 * k]) / 1e6;
        // A device may write zeros, or wrap: nonsense is no measurement at all.
        if (!(stamps[2 * k + 1] >= stamps[2 * k]) || stamps[2 * k] === 0n || !(ms < 60000)) {
          durations = null;
          break;
        }
        durations.push(ms);
      }
    }
    return { running: counts[0], steps: counts[2], skips: counts[3], durations };
  }

  /** `emit`, and the `out` words read back and handed to `read` while they are mapped. */
  async emit(p, guard, read) {
    const encoder = this.device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(p.emit);
    pass.setBindGroup(0, this.group0);
    pass.dispatchWorkgroups(this.groups);
    pass.end();
    encoder.copyBufferToBuffer(this.out, 0, this.outRead, 0, 8 * this.count);
    this.device.queue.submit([encoder.finish()]);
    await guard(this.outRead.mapAsync(GPUMapMode.READ, 0, 8 * this.count));
    try {
      return read(new Uint32Array(this.outRead.getMappedRange(0, 8 * this.count)));
    } finally {
      this.outRead.unmap();
    }
  }

  /** Every sample's whole state, for the self-test. */
  async states_(guard) {
    const bytes = this.count * this.stateBytes;
    const staging = this.device.createBuffer({ size: bytes, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    const encoder = this.device.createCommandEncoder();
    encoder.copyBufferToBuffer(this.states, 0, staging, 0, bytes);
    this.device.queue.submit([encoder.finish()]);
    await guard(staging.mapAsync(GPUMapMode.READ));
    const words = new Uint32Array(staging.getMappedRange().slice(0));
    staging.unmap();
    staging.destroy();
    return words;
  }
}

/**
 * The page's GPU: one per Deep pool. `start()` acquires the device and runs the self-test
 * in the background; `serves()` says whether a frame of a given shape may go to it;
 * `draw()` runs one frame's passes and says which samples the CPU still owes.
 *
 * `kernel` is the debugging override: `"cpu"` never touches WebGPU, `"gpu"` lifts the
 * small-frame rule (never the self-test or the device's limits). `chosen` is the reader's
 * box, which the override beats: with neither, the GPU is `off` and never touched.
 * `changed` is called whenever what `standing()` says may have moved.
 */
export class DeepGpu {
  constructor({ kernel = null, chosen = false, log = () => {}, changed = () => {}, warm = [] } = {}) {
    this.kernel = kernel;
    this.chosen = chosen;
    this.log = log;
    this.changed = changed;
    /** Kernels (`{degree, julia, interior}`) compiled in the background once the self-test
     *  passes, so the first frame that wants one does not wait on its compile. */
    this.warm = warm;
    this.health = new Health();
    this.device = null;
    this.form = null;
    this.limits = null;
    this.adapter = null;
    this.testing = null;
    this.layouts = null;
    this.pipelines = new Map();
    this.orbit = null;
    this.runner = null;
    /** The skip table on the device, `{key, header, runs, levels, valid}`, kept while frames
     *  keep its orbit and shape; `empty` is the one with no levels, which finds no run. */
    this.table = null;
    this.empty = null;
    /** The skip table's builder off the page's thread: `undefined` until first asked for,
     *  `null` where no worker can be had. */
    this.tableWorker = undefined;
    /** Whether a frame is drawn with its skip table *(gpu_deep_depth_ckpt163)*: false binds
     *  the empty one, the kernel without the skip bit for bit. An instance's, so that a
     *  bench page can measure both. */
    this.skip = true;
    this.idle = Promise.resolve();
    this.lostSignal = null;
    this.fault = null;
    /** What the last frame did, for the bench pages: passes, steps, handed samples. */
    this.last = null;
    /** `handsTail`'s `scale`, as an instance's so that a bench page can measure another. */
    this.tailScale = 1;
    /** Whether the device writes timestamps. */
    this.timed = false;
    /** The pass and dispatch sizing, as an instance's so that a bench page can measure
     *  another: `pass` and `dispatch` targets in milliseconds, `work` and `first` the most
     *  sample-steps a dispatch takes once measured and before, `most` dispatches a pass,
     *  and `split`, each dispatch its own submission (false puts a pass's dispatches in
     *  one, which is what `DISPATCH_TARGET_MS` measured against). */
    this.sizing = {
      pass: PASS_TARGET_MS,
      dispatch: DISPATCH_TARGET_MS,
      work: MAX_DISPATCH_WORK,
      first: FIRST_DISPATCH_WORK,
      most: MAX_DISPATCHES,
      split: true,
    };
  }

  /** Whether the GPU is not to be touched at all: asked for the CPU by the address, or
   *  neither asked for by it nor chosen by the reader. Read at every door, never kept. */
  get off() {
    return this.kernel === "cpu" || (this.kernel === null && !this.chosen);
  }

  /**
   * Where the GPU stands, for the box: `forced` (the address decides, `kernel` says which),
   * `off` (not chosen), `testing` (a self-test is running), `ready`, `waiting` (chosen and
   * untested, which the next frame that wants it tests), `retrying` (a device lost once, or
   * an acquisition missed, which the next frame asks again), or `unavailable` for the
   * session with `why` one of `no-webgpu`, `fallback`, `failed`, `lost` or `missed`.
   */
  standing() {
    const status = this.health.status;
    const why = this.health.why ?? "";
    const unavailable =
      status !== "off"
        ? null
        : why === "no-webgpu"
          ? "no-webgpu"
          : why === "fallback-adapter"
            ? "fallback"
            : this.health.losses >= this.health.max
              ? "lost"
              : this.health.misses >= this.health.maxMisses
                ? "missed"
                : "failed";
    if (this.kernel !== null) return { state: "forced", kernel: this.kernel, unavailable };
    if (!this.chosen) return { state: "off" };
    if (unavailable !== null) return { state: "unavailable", why: unavailable };
    if (this.testing !== null) return { state: "testing" };
    if (status === "ready" && this.device !== null) return { state: "ready" };
    return { state: status === "lost" || status === "unavailable" ? "retrying" : "waiting" };
  }

  /**
   * The reader ticked or unticked the box. On starts the self-test now; off lets a test or
   * a frame already on the device finish (stopping either would read as a lost device),
   * then gives the device up without counting a loss. Resolves whether the GPU is ready.
   */
  async choose(on) {
    this.chosen = on;
    this.changed();
    if (on) {
      const passed = await this.start();
      this.changed();
      return passed;
    }
    await Promise.allSettled([this.testing, this.idle]);
    if (this.off && this.device !== null) {
      this.#release();
      this.health.stoodDown();
      this.log("gpu stood down");
    }
    this.changed();
    return false;
  }

  /** Acquire the device and test it, once, in the background; resolves whether it passed.
   *  Safe to call again: a test in flight is shared, and a lost device is re-acquired. */
  start() {
    if (this.off) return Promise.resolve(false);
    if (this.testing !== null) return this.testing;
    if (!this.health.wants) return Promise.resolve(this.health.usable);
    const started = performance.now();
    this.testStarted = started;
    const losses = this.health.losses;
    this.testing = this.#open()
      .then(() => {
        // A test a frame stopped waiting for is not passed by landing late: the frames
        // after it would then draw on the GPU, and the one that gave up on the CPU.
        if (this.abandoned) {
          this.#release();
          return false;
        }
        this.health.passed();
        this.log("gpu ready", { form: this.form, ms: Math.round(performance.now() - started), adapter: this.adapter });
        this.#warm();
        return true;
      })
      .catch((error) => {
        // A device lost under the self-test is a loss, and an acquisition that failed for
        // the moment is a miss, each retried by a later frame; anything else the test said
        // is about the arithmetic, and final.
        if (error instanceof GpuLost || this.health.losses > losses) {
          if (this.health.losses === losses) this.#drop(`lost during the self-test: ${error.message}`);
        } else if (error instanceof Unavailable) {
          this.health.unavailable(error.message);
          this.#release();
        } else {
          this.health.failed(String(error?.message ?? error));
          this.#release();
        }
        this.log("gpu off", { why: this.health.why, status: this.health.status });
        return false;
      })
      .finally(() => {
        this.testing = null;
        this.changed();
      });
    this.changed();
    return this.testing;
  }

  /**
   * A frame of this shape is on its way: compile its kernels now, in the background, so
   * that a first use pays its compile beside the reference orbit and the quarter pass
   * rather than after them *(gpu_deep_ship_ckpt162, Phase 4)*. Both of the interior
   * switch's settings, side by side, since the quarter pass has not chosen yet: on seven
   * first-use frames that beat the proof's first and the plain kernel's first. A pair costs
   * 0.4 to about 5 s on first use (4.8 s at degree six on a fresh browser). It also runs for
   * a frame the quarter pass will call cheap, and there competes with the CPU pool for
   * nothing; that is once a kernel a page load (one of 44 cheap frames measured, 0.7 s),
   * and the next frame of that shape the GPU draws finds it compiled. Nothing waits on it:
   * a compile it started is the one the frame then awaits, and a kernel that will not
   * compile is said when a frame asks.
   */
  prepare({ degree, julia }) {
    if (this.off || !(degree >= 2 && degree <= 6)) return;
    // **Asked while the self-test runs, compiled once it passes** *(deep_wait_ckpt163)*: a
    // first frame used to drop the request here, so a degree the self-test does not warm
    // paid its whole compile inside its first draw.
    if (this.testing !== null && !this.health.usable) {
      this.testing.then((passed) => passed && this.prepare({ degree, julia })).catch(() => {});
      return;
    }
    if (!this.health.usable || this.device === null) return;
    const device = this.device;
    (async () => {
      const W = await wgsl();
      if (this.device !== device) return;
      await Promise.all([true, false].map((interior) => this.#pipelines(W, device, degree, julia, interior)));
    })().catch(() => {});
  }

  /** Compile the `warm` kernels in the background, one after another. */
  async #warm() {
    const device = this.device;
    try {
      const W = await wgsl();
      for (const { degree, julia, interior } of this.warm) {
        if (this.device !== device || this.off) return;
        await this.#pipelines(W, device, degree, julia, interior);
      }
    } catch {
      // A kernel that will not compile is refused again, and said, when a frame asks.
    }
  }

  /** Whether the GPU is ready, waiting up to `within` for a self-test in flight (and
   *  starting one where a lost device is due a retry). A page that asked for the GPU by
   *  name waits for the self-test however long it takes, so its frames say which kernel
   *  drew them for a reason and not for a race. */
  async ready(within = SETTLE_BOUND_MS) {
    if (this.off || this.abandoned) return false;
    if (this.health.usable) return true;
    if (this.health.status === "off") return false;
    const testing = this.start();
    let timer;
    const settled = Symbol("bound");
    // From the test's own start, not this frame's ask: a test is one event, and every frame
    // waiting on it gets the same answer.
    const left = Math.max(0, (this.testStarted ?? performance.now()) + within - performance.now());
    const waited = await Promise.race([testing, new Promise((resolve) => (timer = setTimeout(() => resolve(settled), left)))]);
    clearTimeout(timer);
    if (waited === settled) {
      // The liveness guard, not a race: what the frame does now, every frame does.
      this.abandoned = true;
      this.health.failed(`the self-test did not answer in ${Math.round(within / 1000)} s`);
      this.log("gpu off", { why: this.health.why, status: this.health.status });
      this.changed();
      return false;
    }
    return waited === true && this.health.usable;
  }

  /** Why a frame of this shape stays on the CPU, or `null` where the GPU may draw it.
   *  `iterations`, the CPU's estimate of the frame's full stage, keeps a cheap one on the
   *  CPU (`cheap`) without waiting at all; `frameSamples`, the full stage's samples where
   *  this is its quarter, is what `small` reads. A frame neither keeps waits for the
   *  self-test's outcome (`SETTLE_BOUND_MS`). */
  async refuses({ samples, frameSamples = samples, sampleWidth = null, degree, interior, orbitPoints, iterations = null, workers = TAIL_WORKERS }) {
    if (this.kernel === "cpu") return "asked for the CPU";
    if (this.off) return "not chosen";
    if (this.kernel !== "gpu" && frameSamples < GPU_MIN_SAMPLES) return "small";
    if (this.kernel !== "gpu" && cheap({ iterations, workers })) return "cheap";
    if (!(await this.ready(this.kernel === "gpu" ? FORCED_WAIT_MS : SETTLE_BOUND_MS))) return `not ready (${this.health.status}${this.health.why ? `: ${this.health.why}` : ""})`;
    return fits({ samples, degree, interior, orbitPoints, limits: this.limits, ...(sampleWidth == null ? {} : { sampleWidth }) });
  }

  /** Whether a frame of `samples` would go to the GPU as things stand — ready, not small,
   *  and inside the device's limits with the proof's state, the larger — without waiting
   *  on anything. The Download row's estimate asks it; a frame still asks `refuses`. */
  likely(samples) {
    if (this.off || !this.health.usable || this.limits === null) return false;
    if (this.kernel !== "gpu" && samples < GPU_MIN_SAMPLES) return false;
    return fits({ samples, degree: 2, interior: true, orbitPoints: 0, limits: this.limits }) === null;
  }

  // -------------------------------------------------------------------- acquisition

  async #open() {
    const W = await wgsl();
    const gpu = globalThis.navigator?.gpu;
    // No WebGPU and a software adapter are what this browser is, and final; no adapter
    // handed out, or a device refused, is often a moment (another tab holding the GPU, a
    // driver reset, memory short), and a later frame asks again.
    if (!gpu) throw new Error("no-webgpu");
    let adapter;
    try {
      adapter = await gpu.requestAdapter({ powerPreference: "high-performance" });
    } catch (error) {
      throw new Unavailable(`requestAdapter: ${error?.message ?? error}`);
    }
    if (adapter === null) throw new Unavailable("no-adapter");
    const info = adapter.info ?? {};
    if (info.isFallbackAdapter === true || adapter.isFallbackAdapter === true) throw new Error("fallback-adapter");
    this.adapter = [info.vendor, info.architecture, info.description].filter(Boolean).join(" ");
    let device;
    // Timestamps where the adapter has them: a pass is sized from the device's own time,
    // and each dispatch from the densest one last measured (`dispatchCost`).
    const timestamps = adapter.features?.has?.("timestamp-query") === true;
    try {
      device = await adapter.requestDevice({
        requiredFeatures: timestamps ? ["timestamp-query"] : [],
        requiredLimits: {
          maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize,
          maxBufferSize: adapter.limits.maxBufferSize,
          maxStorageBuffersPerShaderStage: adapter.limits.maxStorageBuffersPerShaderStage,
        },
      });
    } catch (error) {
      throw new Unavailable(String(error?.message ?? error));
    }
    this.device = device;
    this.limits = device.limits;
    this.timed = device.features.has("timestamp-query");
    this.fault = null;
    this.lostSignal = device.lost.then((lost) => {
      throw new GpuLost(`${lost.reason ?? "unknown"}: ${lost.message ?? ""}`);
    });
    this.lostSignal.catch(() => {});
    device.lost.then((lost) => {
      if (this.device === device) this.#drop(`device lost (${lost.reason ?? "unknown"}): ${lost.message ?? ""}`);
    });
    device.addEventListener("uncapturederror", (event) => {
      const message = event.error?.message ?? String(event.error);
      this.log("gpu uncaptured error", { message });
      // A fault on the device is a loss for the frame in progress (`#guard` throws it).
      if (this.device === device) this.fault = message;
    });
    this.layouts = W.LAYOUT.map((entries) => device.createBindGroupLayout({ entries }));
    this.pipelines = new Map();
    this.orbit = null;
    this.runner = null;
    this.table = null;
    this.empty = tableBuffers(device, new ArrayBuffer(W.BLA_HEADER_BYTES), new ArrayBuffer(W.BLA_RUN_BYTES), "deep empty table");
    // An orbit that flushed nothing binds this in its exact points' place; the kernel never
    // reads it (`exact_e`).
    this.noExact = device.createBuffer({ size: W.EXACT_BYTES, usage: GPUBufferUsage.STORAGE, label: "deep no exact points" });
    await this.#selfTest(W, device);
  }

  /** Give up the device after a loss, counting it; the next frame retries. */
  #drop(why) {
    if (this.device === null && this.health.status !== "ready") return;
    this.health.lost(why);
    this.log("gpu lost", { why, losses: this.health.losses, status: this.health.status });
    this.#release();
    this.changed();
  }

  #release() {
    const device = this.device;
    this.device = null;
    this.runner = null;
    this.orbit = null;
    this.table = null;
    this.empty = null;
    this.noExact = null;
    this.pipelines = new Map();
    try {
      device?.destroy();
    } catch {
      // Already gone.
    }
  }

  /** `promise`, unless the device is lost or faults first, which throws `GpuLost`. */
  #guard(device) {
    const lost = this.lostSignal;
    return async (promise) => {
      let value;
      try {
        value = await Promise.race([promise, lost]);
      } catch (error) {
        if (error instanceof GpuLost) throw error;
        // **A lost device rejects a read-back before it says it is lost** *(found by
        // gpu_optin_downloads_ckpt162's review)*: `mapAsync` fails at once and `device.lost`
        // resolves after, so a loss under the self-test read as a wrong answer, and a
        // failed test is final. A rejection waits a moment for the loss to show itself.
        const gone = await Promise.race([device.lost.then(() => true), new Promise((resolve) => setTimeout(() => resolve(false), LOSS_SETTLE_MS))]);
        if (gone) throw new GpuLost(`the device went away under a read: ${error?.message ?? error}`);
        throw error;
      }
      if (this.fault !== null || this.device !== device) throw new GpuLost(this.fault ?? "the device went away");
      return value;
    };
  }

  /** The pipelines for one kernel module, compiled once per device. */
  async #pipelines(W, device, degree, julia, interior) {
    const key = `${degree}|${julia ? 1 : 0}|${interior ? 1 : 0}|${this.form}`;
    let made = this.pipelines.get(key);
    if (made === undefined) {
      made = (async () => {
        const started = performance.now();
        const code = W.kernelSource({ degree, julia, interior, form: this.form, workgroup: WORKGROUP, smooth: "builtin" });
        const module = await compile(device, code, `deep d${degree}${julia ? " julia" : ""}${interior ? " interior" : ""}`);
        const plain = device.createPipelineLayout({ bindGroupLayouts: [this.layouts[0]] });
        const make = (entryPoint, layout) => device.createComputePipelineAsync({ layout, compute: { module, entryPoint } });
        // `args`, the list's indirect dispatch, is not built: a pass here knows the list's
        // length and cuts it into direct dispatches (`dispatchPlan`).
        const [init, all, list, compact, emit] = await Promise.all([
          make("init", plain),
          make("pass_all", plain),
          make("pass_list", plain),
          make("compact", plain),
          make("emit", plain),
        ]);
        this.log("gpu kernel compiled", { degree, julia, interior, ms: Math.round(performance.now() - started) });
        return { init, all, list, compact, emit };
      })();
      // A module that will not compile is this kernel's and not the device's: its frames
      // are the CPU's, and the refusal is remembered for the session.
      made = made.catch((error) => {
        throw new Unserved(`the d${degree}${julia ? " Julia" : ""} kernel: ${error?.message ?? error}`);
      });
      this.pipelines.set(key, made);
    }
    return made;
  }

  // --------------------------------------------------------------------- self-test

  async #selfTest(W, device) {
    const guard = this.#guard(device);
    // A file not fetched is a miss and not a failure: the network said no, the arithmetic
    // has not been asked.
    const fetched = async (name, as) => {
      try {
        const response = await fetch(new URL(name, SELFTEST));
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return await (as === "json" ? response.json() : response.arrayBuffer());
      } catch (error) {
        throw new Unavailable(`self-test: ${name}: ${error?.message ?? error}`);
      }
    };
    this.form = null;
    const [plan, vectors] = await Promise.all([fetched("selftest.json", "json"), fetched("vectors.json", "json")]);

    // The primitives, form by form until one passes every case bit for bit.
    const cases = vectors.cases;
    const packed = W.selfTestCases(cases);
    for (const form of W.KERNEL_FORMS) {
      const ok = await this.#vectors(W, device, guard, form, cases, packed);
      if (ok) {
        this.form = form;
        break;
      }
      this.log("gpu self-test form missed", { form });
    }
    if (this.form === null) throw new Error("self-test: no guard form passes the vectors");
    this.log("gpu self-test vectors passed", { form: this.form });

    // The frames, word for word, frac excepted, at every budget schedule.
    for (const entry of plan.frames) {
      const manifest = await fetched(entry.manifest, "json");
      const bin = await fetched(entry.bin, "bytes");
      if (bin.byteLength !== manifest.bin_bytes) throw new Error(`self-test: ${entry.bin} is ${bin.byteLength} bytes`);
      const arrays = {};
      for (const a of manifest.arrays) {
        const Typed = { u8: Uint8Array, u32: Uint32Array, f32: Float32Array, f64: Float64Array }[a.dtype];
        arrays[a.name] = new Typed(bin, a.offset, a.count);
      }
      for (const [k, [first, rest]] of plan.budgets.entries()) {
        // The first schedule as one dispatch a pass over every sample; every later one the
        // way a frame runs, the list compacted as it thins, and cut as fine as it goes: a
        // workgroup a dispatch and three chunks of steps a pass, so that every `base` and
        // the running count's clearing are held to the model too.
        const cut = k > 0;
        const missed = await this.#frameTest(W, device, guard, manifest, arrays, first, rest, cut);
        if (missed !== null) throw new Error(`self-test: ${manifest.id} at ${first} then ${rest}${cut ? " cut" : ""}: ${missed}`);
      }
    }
  }

  async #vectors(W, device, guard, form, cases, packed) {
    device.pushErrorScope("validation");
    const input = device.createBuffer({ size: packed.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(input, 0, packed);
    const results = device.createBuffer({ size: cases.length * 8, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
    const staging = device.createBuffer({ size: cases.length * 8, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    const knobs = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const knobData = new ArrayBuffer(16);
    new Float32Array(knobData, 0, 2).set([1, 0]);
    device.queue.writeBuffer(knobs, 0, knobData);
    try {
      const module = await compile(device, W.selfTestSource(form), `deep self-test ${form}`);
      const layout = device.createBindGroupLayout({ entries: W.SELFTEST_LAYOUT });
      const pipeline = await device.createComputePipelineAsync({
        layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
        compute: { module, entryPoint: "main" },
      });
      const group = device.createBindGroup({
        layout,
        entries: [input, results, knobs].map((buffer, binding) => ({ binding, resource: { buffer } })),
      });
      const encoder = device.createCommandEncoder();
      const pass = encoder.beginComputePass();
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, group);
      pass.dispatchWorkgroups(Math.ceil(cases.length / W.SELFTEST_WORKGROUP));
      pass.end();
      encoder.copyBufferToBuffer(results, 0, staging, 0, cases.length * 8);
      device.queue.submit([encoder.finish()]);
      await guard(staging.mapAsync(GPUMapMode.READ));
      const got = new Uint32Array(staging.getMappedRange().slice(0));
      staging.unmap();
      const invalid = await device.popErrorScope();
      if (invalid) throw new Error(`self-test: ${invalid.message}`);
      return cases.every((c, i) => got[2 * i] === c.out[0] >>> 0 && got[2 * i + 1] === c.out[1] >>> 0);
    } finally {
      for (const b of [input, results, staging, knobs]) b.destroy();
    }
  }

  /** One tracked frame at one budget schedule; `null` where every word but `frac` is the
   *  model's, else what differed. */
  async #frameTest(W, device, guard, manifest, arrays, first, rest, cut) {
    const count = manifest.width_px * manifest.height_px;
    const interior = manifest.interior === true;
    const p = await this.#pipelines(W, device, manifest.degree, manifest.julia, interior);
    device.pushErrorScope("validation");
    const runner = new Runner(device, count, interior, this.timed);
    const orbit = device.createBuffer({ size: Math.max(16, arrays.orbit_hilo.byteLength), usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    // A bundle with a skip table is held to the model with it, and every other with none.
    const table = arrays.bla_header ? tableBuffers(device, arrays.bla_header, arrays.bla_runs, "deep self-test table") : null;
    // And its exact points, where its orbit flushed (`orbit.rs`'s, as the page builds them).
    let exact = null;
    if (arrays.orbit_exact) {
      exact = device.createBuffer({ size: arrays.orbit_exact.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST, label: "deep self-test exact" });
      device.queue.writeBuffer(exact, 0, arrays.orbit_exact);
    }
    try {
      device.queue.writeBuffer(orbit, 0, arrays.orbit_hilo);
      device.queue.writeBuffer(runner.frame, 0, arrays.frame);
      device.queue.writeBuffer(runner.frameLo, 0, arrays.frame_lo);
      device.queue.writeBuffer(runner.params, 0, W.paramsBytes({ budget: 0, periodic: manifest.periodic, length: manifest.orbit_len, count, flush: manifest.flush_hilo ?? 0 }));
      runner.bind(this.layouts, orbit, table ?? this.empty, exact ?? this.noExact);
      runner.init(p);
      let running = count;
      let passes = 0;
      let listed = null;
      let listLen = 0;
      const limit = 4 * (manifest.cap + 8);
      while (running > 0 && passes < limit) {
        const budget = passes === 0 ? first : rest;
        const mode = cut ? passMode(running, count, listed) : "all";
        if (mode === "compact") {
          listLen = running;
          listed = 0;
        } else if (mode === "list") listed += 1;
        const groups = mode === "all" ? runner.groups : Math.ceil(listLen / WORKGROUP);
        // Cut: a workgroup a dispatch and a third of the steps, finer than a frame is ever
        // cut (`dispatchPlan` cuts workgroups only where it must), so every `base` is held.
        // A larger fixture widens the slices so the pass stays within `MAX_DISPATCHES`.
        const step = Math.ceil(budget / 3);
        const chunks = Math.ceil(budget / step);
        const per = Math.ceil(groups / Math.min(groups, Math.floor(MAX_DISPATCHES / chunks)));
        const plan = cut ? { budget, per, slices: Math.ceil(groups / per), step, chunks } : { budget, per: groups, slices: 1, step: budget, chunks: 1 };
        ({ running } = await runner.pass(p, dispatchesOf(plan, groups), mode, guard));
        passes += 1;
      }
      if (running > 0) return `${running} samples still running after ${passes} passes`;
      const words = await runner.states_(guard);
      const invalid = await device.popErrorScope();
      if (invalid) throw new Error(`self-test: ${invalid.message}`);
      const stride = runner.stateBytes / 4;
      const state = arrays.ds_state;
      const proof = arrays.ds_proof;
      const FRAC = 8;
      for (let i = 0; i < count; i++) {
        for (let k = 0; k < stride; k++) {
          if (k === FRAC) continue;
          const want = k < 14 ? state[14 * i + k] : proof[18 * i + (k - 14)];
          if (words[stride * i + k] !== want) return `sample ${i} word ${k} is ${words[stride * i + k]}, the model's ${want}`;
        }
      }
      return null;
    } finally {
      runner.destroy();
      orbit.destroy();
      table?.header.destroy();
      table?.runs.destroy();
      exact?.destroy();
    }
  }

  // ------------------------------------------------------------------------- a frame

  /**
   * Draw one frame's field on the device, as far as the GPU takes it.
   *
   * `job`: `plan` (`perturb.wasm`'s plan of the frame's spec), `orbit` (the pool's held
   * orbit record: `packed` and `stamp`), `values` (the field's `Float64Array`, filled in
   * place), `live()` (false once the pool's generation has moved), and optional
   * `onProgress(fraction, elapsedMs)`, `onPass()`, `onPartial()` (the picture so far is in
   * `values`), `preview` (the quarter field, a stand-in for samples not yet finished) and
   * `workers` (the CPU pool the tail goes to, `TAIL_WORKERS` where not said).
   *
   * Resolves `{status: "done", handed}` with the samples the CPU is to finish;
   * `{status: "cancelled"}`; `{status: "lost", handed}` after a lost device, `handed` every
   * sample not finished by the last read-back, or `null` where nothing was read back; or
   * `{status: "unserved", why}` where the device would not take the frame at all.
   *
   * **A frame past what the device holds at once is drawn a strip of whole rows at a time**
   * *(gpu_optin_downloads_ckpt162)*, each strip by exactly the rules a frame always was
   * (its own budgets from `FIRST_BUDGET`, its own first-dispatch caps, its own tail at its
   * own step checkpoints) on one set of buffers, one strip after another. Where the job
   * has `onHanded(indices)`, each strip's tail is handed over the moment that strip ends, so
   * the CPU finishes it while the next strip runs, and `handed` is only what was not; a
   * lost device or a refusal after the first strip hands the rest of the frame over too.
   */
  async draw(job) {
    const prior = this.idle;
    let release;
    this.idle = new Promise((resolve) => (release = resolve));
    try {
      await prior;
      if (!job.live()) return { status: "cancelled" };
      return await this.#draw(job);
    } finally {
      release();
    }
  }

  /**
   * The skip table for a frame *(gpu_deep_depth_ckpt163)*: built from the pool's `f64` orbit
   * as `deep-gpu-model` builds it (`deep-gpu-bla.js`), merged against the frame's own `|dc|`
   * bound, and kept on the device while frames keep the orbit, the plane and that bound, so
   * a recolor or a download of the same view builds nothing.
   */
  async #tableFor(device, held, plan, frame) {
    const f = new DataView(frame);
    const shape = {
      sampleWidth: plan.sample_width,
      sampleHeight: plan.sample_height,
      offsetM: [f.getFloat32(8, true), f.getFloat32(12, true)],
      spacingM: f.getFloat32(16, true),
      sc: f.getInt32(20, true),
    };
    const B = await blaBuilder();
    const dcmax = plan.julia ? 0 : B.dcBound(shape);
    // **No table for a frame wider than `TABLE_WIDTH`**, decided by the frame alone: a run
    // is linear while `|δ|` is under `2^-48 |Z|`, and `δ` starts at about the frame's width,
    // so a frame at 1e-20 has some twenty bits of growth to skip through and one at 1e-60
    // some hundred and fifty. Measured over the 159-frame sample, no frame from 1e-22 up kept
    // its table past its second checkpoint, and building and trying it cost them up to 0.7 s.
    if (!(plan.width < TABLE_WIDTH)) return this.empty;
    const key = `${held.stamp}|${plan.degree}|${plan.julia ? 1 : 0}|${dcmax}`;
    if (this.table?.key === key) return this.table.dead ? this.empty : this.table;
    this.table?.header?.destroy();
    this.table?.runs?.destroy();
    this.table = null;
    const started = performance.now();
    const buffer = held.packed instanceof ArrayBuffer ? held.packed : held.packed.buffer.slice(held.packed.byteOffset, held.packed.byteOffset + held.packed.byteLength);
    const head = new DataView(buffer);
    const count = head.getUint32(0, true);
    const points = new Float64Array(buffer, 16, 2 * count);
    const args = { count, periodic: (head.getUint32(4, true) & 2) !== 0, degree: plan.degree, julia: Boolean(plan.julia), dcmax };
    // **A table with no live run is never built** *(gpu_deep_depth_ckpt163)*: its lookups
    // would find nothing, and on a long orbit the build alone is most of a second
    // (`random-dives#337`, 1.9 million points, none live). Whether any run lives depends on
    // `dcmax` against the orbit's own sizes, which the start of a long orbit already shows,
    // so a table over its first `TABLE_PROBE` points is built first and a dead one ends it.
    // Which way a frame goes is decided by its orbit and frame alone, never by the clock.
    const dead = (why) => {
      this.table = { key, dead: true };
      this.log("gpu table skipped", { ms: Math.round(performance.now() - started), points: count, why });
      return this.empty;
    };
    if (count > TABLE_PROBE) {
      const probe = B.buildTable({ ...args, points: points.subarray(0, 2 * TABLE_PROBE), count: TABLE_PROBE, periodic: false });
      if (probe.valid === 0) return dead(`no live run in its first ${TABLE_PROBE} points`);
    }
    const built = await this.#build(B, { ...args, points });
    const ms = performance.now() - started;
    if (built.levels === 0 || built.valid === 0) return dead(built.levels === 0 ? "too short" : "no live run");
    device.pushErrorScope("out-of-memory");
    device.pushErrorScope("validation");
    const made = tableBuffers(device, built.header, built.runs, "deep table");
    const invalid = await popBoth(device);
    if (invalid) {
      made.header.destroy();
      made.runs.destroy();
      throw new Unserved(`the skip table: ${invalid.message}`);
    }
    this.table = { ...made, key, levels: built.levels, valid: built.valid, ms: Math.round(ms) };
    this.log("gpu table built", { ms: Math.round(ms), points: count, levels: built.levels, runs: built.runs.byteLength / 64, valid: built.valid });
    return this.table;
  }

  /** `buildTable` off the page's thread, in a module worker of `deep-gpu-bla.js`, and on it
   *  where there is no worker to be had. One build at a time: frames draw one at a time. */
  async #build(B, args) {
    if (this.tableWorker === undefined) {
      try {
        this.tableWorker = typeof Worker === "function" ? new Worker(new URL("./deep-gpu-bla.js", import.meta.url), { type: "module", name: "deep skip table" }) : null;
      } catch {
        this.tableWorker = null;
      }
    }
    const worker = this.tableWorker;
    if (worker === null) return B.buildTable(args);
    const points = args.points.slice();
    try {
      return await new Promise((resolve, reject) => {
        worker.onmessage = (event) => resolve(event.data);
        worker.onerror = (event) => reject(new Error(event.message ?? "the worker failed"));
        worker.postMessage({ ...args, points }, [points.buffer]);
      });
    } catch {
      // A worker that will not run is the page's thread's work instead, from then on.
      worker.terminate();
      this.tableWorker = null;
      return B.buildTable(args);
    }
  }

  async #draw(job) {
    // A frame decided before the box was unticked, still queued on `idle`, is the CPU's.
    if (this.off) return { status: "unserved", why: "off" };
    const W = await wgsl();
    const device = this.device;
    if (device === null || !this.health.usable) return { status: "unserved", why: "no device" };
    const guard = this.#guard(device);
    const { plan, values } = job;
    const width = plan.sample_width;
    const height = plan.sample_height;
    const count = width * height;
    const interior = plan.interior === true;
    const rows = stripRows({ sampleWidth: width, sampleHeight: height, interior, limits: this.limits });
    if (rows === 0) return { status: "unserved", why: "a row past the device's limits" };
    const strips = Math.ceil(height / rows);
    const started = performance.now();
    // Every sample's mark once it holds its last value, a strip's a view of it; `null`
    // until a read-back has landed, so that a loss before any sends the frame to the bands.
    let final = null;
    // The strip running, whether any of it has been read back, and how many samples of the
    // strips before it the device finished, for the progress line.
    let strip = 0;
    let stripRead = false;
    let doneBefore = 0;
    let streamed = 0;
    const handedAll = [];
    // `trace` is a pass a row: its budget, its mode's initial, the samples running after it,
    // its wall time in milliseconds (submission to read-back), its device time (the sum of
    // its dispatches' timestamps, `null` without them), its dispatches, and the longest.
    const record = {
      count,
      degree: plan.degree,
      julia: Boolean(plan.julia),
      interior,
      maxiter: plan.maxiter,
      strips,
      rows,
      passes: 0,
      dispatches: 0,
      spent: 0,
      compacts: 0,
      partials: 0,
      handed: 0,
      gated: 0,
      tail: false,
      trace: [],
    };
    this.last = record;
    /** Indices `from` up to `to`, as a list the CPU can finish. */
    const span = (from, to) => {
      const list = new Uint32Array(to - from);
      for (let k = 0; k < list.length; k++) list[k] = from + k;
      return list;
    };
    /** A strip's unfinished samples, as frame indices. */
    const unfinishedAt = (marks, offset) => {
      const list = unfinished(marks);
      for (let k = 0; k < list.length; k++) list[k] += offset;
      return list;
    };
    const hand = (list) => {
      record.handed += list.length;
      if (list.length === 0) return;
      if (job.onHanded) {
        streamed += list.length;
        job.onHanded(list);
      } else handedAll.push(list);
    };
    const joined = (lists) => {
      const all = new Uint32Array(lists.reduce((sum, list) => sum + list.length, 0));
      let at = 0;
      for (const list of lists) {
        all.set(list, at);
        at += list.length;
      }
      return all;
    };
    try {
      const p = await this.#pipelines(W, device, plan.degree, plan.julia, interior);
      if (!job.live()) return { status: "cancelled" };

      // The orbit, kept on the device for as long as the pool holds it.
      if (this.orbit === null || this.orbit.stamp !== job.orbit.stamp) {
        this.orbit?.buffer.destroy();
        this.orbit?.exact?.destroy();
        this.orbit = null;
        const hilo = hiLoOrbit(job.orbit.packed);
        device.pushErrorScope("out-of-memory");
        device.pushErrorScope("validation");
        const buffer = device.createBuffer({ size: Math.max(16, hilo.points.byteLength), usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST, label: "deep orbit" });
        const invalid = await popBoth(device);
        if (invalid) {
          buffer.destroy();
          throw new Unserved(`orbit: ${invalid.message}`);
        }
        device.queue.writeBuffer(buffer, 0, hilo.points);
        let exact = null;
        if (hilo.exact !== null) {
          device.pushErrorScope("out-of-memory");
          device.pushErrorScope("validation");
          exact = device.createBuffer({ size: hilo.exact.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST, label: "deep orbit exact" });
          const invalid = await popBoth(device);
          if (invalid) {
            exact.destroy();
            buffer.destroy();
            throw new Unserved(`orbit's exact points: ${invalid.message}`);
          }
          device.queue.writeBuffer(exact, 0, hilo.exact);
        }
        this.orbit = { stamp: job.orbit.stamp, buffer, exact, count: hilo.count, periodic: hilo.periodic, flush: hilo.flush };
      }
      const orbit = this.orbit;

      // The buffers, for a strip's samples, kept while frames keep their strip's size.
      const capacity = rows * width;
      if (this.runner === null || this.runner.capacity !== capacity || this.runner.interior !== interior) {
        this.runner?.destroy();
        this.runner = null;
        device.pushErrorScope("out-of-memory");
        device.pushErrorScope("validation");
        const runner = new Runner(device, capacity, interior, this.timed);
        const invalid = await popBoth(device);
        if (invalid) {
          runner.destroy();
          throw new Unserved(`buffers for ${capacity} samples: ${invalid.message}`);
        }
        this.runner = runner;
      }
      const runner = this.runner;
      const { frame, frameLo } = frameBuffers(plan, orbit.count, HANDOFF);
      device.queue.writeBuffer(runner.frame, 0, frame);
      device.queue.writeBuffer(runner.frameLo, 0, frameLo);
      let table = this.skip ? await this.#tableFor(device, job.orbit, plan, frame) : this.empty;
      if (!job.live()) return { status: "cancelled" };
      record.table = table === this.empty ? null : { levels: table.levels, valid: table.valid, ms: table.ms, windows: [], dropped: null };
      runner.bind(this.layouts, orbit.buffer, table, orbit.exact ?? this.noExact);
      // The skip's own count since the last step checkpoint, and the steps it was out of.
      let windowSteps = 0;
      let windowSkips = 0;

      const fallback = previewOf(job.preview, width, height);
      // A partial of a frame in strips shows the quarter field where no strip has run yet.
      if (strips > 1 && job.onPartial && fallback !== null) for (let i = 0; i < count; i++) values[i] = fallback(i);
      const sizing = this.sizing;
      const workers = job.workers ?? TAIL_WORKERS;
      let lastPartial = performance.now();
      let partialDone = 0;
      for (strip = 0; strip < strips; strip++) {
        const row0 = strip * rows;
        const offset = row0 * width;
        const n = Math.min(rows, height - row0) * width;
        const view = values.subarray(offset, offset + n);
        const stripFallback = fallback === null ? null : (i) => fallback(i + offset);
        stripRead = false;
        runner.use(n);
        device.queue.writeBuffer(runner.params, 0, W.paramsBytes({ budget: 0, periodic: orbit.periodic, length: orbit.count, count: n, flush: orbit.flush, row0 }));
        runner.init(p);
        let running = n;
        let spent = 0;
        let budget = FIRST_BUDGET;
        let listed = null;
        let listLen = 0;
        // The densest dispatch's cost a workgroup-step, and the workgroups it was measured
        // over: nothing is known before a strip's first pass, which `FIRST_DISPATCH_WORK`
        // bounds.
        let cost = null;
        let costGroups = null;
        for (;;) {
          if (!job.live()) return { status: "cancelled" };
          const mode = passMode(running, n, listed);
          if (mode === "compact") listLen = running;
          const groups = mode === "all" ? runner.groups : Math.ceil(listLen / WORKGROUP);
          // A list is denser than the pass that measured the cost, by at most the share of
          // its workgroups that survive the cut: the first pass over it assumes the worst.
          const assumed = cost === null ? null : cost * Math.max(1, costGroups / groups);
          const cut = dispatchPlan({
            budget: landOn(spent, clampBudget(budget, running)),
            groups,
            cost: assumed,
            target: sizing.dispatch,
            maxWork: cost === null ? sizing.first : sizing.work,
            most: cost === null ? firstDispatches(sizing) : Math.min(sizing.most, MAX_DISPATCHES),
          });
          const steps = cut.budget;
          const dispatches = dispatchesOf(cut, groups);
          const at = performance.now();
          const counted = await runner.pass(p, dispatches, mode, guard, sizing.split === true);
          const wallMs = performance.now() - at;
          const durations = counted.durations;
          const gpuMs = durations === null ? null : durations.reduce((sum, ms) => sum + ms, 0);
          const widest = durations === null ? null : Math.max(...durations);
          record.passes += 1;
          spent += steps;
          record.spent += steps;
          record.dispatches += dispatches.length;
          record.trace.push([steps, mode[0], counted.running, Math.round(wallMs), gpuMs === null ? null : +gpuMs.toFixed(2), dispatches.length, widest === null ? null : +widest.toFixed(2)]);
          windowSteps += counted.steps;
          windowSkips += counted.skips ?? 0;
          if (mode === "compact") {
            record.compacts += 1;
            listed = 0;
          } else if (mode === "list") listed += 1;
          running = counted.running;
          cost = dispatchCost({ dispatches, durations, wallMs });
          costGroups = groups;
          job.onPass?.();
          if (!job.live()) return { status: "cancelled" };
          job.onProgress?.((doneBefore + n - running) / count, performance.now() - started);
          if (running === 0) break;
          // **A table that does not pay is dropped** *(gpu_deep_depth_ckpt163)*, at a step
          // checkpoint, where every sample still running has taken the same steps and the
          // counts are the frame's and not the clock's (`keepsTable`).
          if (table !== this.empty && isCheckpoint(spent)) {
            const keep = keepsTable({ steps: windowSteps, skips: windowSkips });
            record.table.windows.push([spent, windowSteps, windowSkips]);
            windowSteps = 0;
            windowSkips = 0;
            if (!keep) {
              table = this.empty;
              record.table.dropped = spent;
              runner.bind(this.layouts, orbit.buffer, table, orbit.exact ?? this.noExact);
              this.log("gpu table dropped", { spent, windows: record.table.windows });
            }
          }
          if (handsTail({ spent, running, maxiter: plan.maxiter, interior, workers, scale: this.tailScale })) {
            record.tail = true;
            break;
          }
          budget = nextBudget({ budget: steps, ms: gpuMs ?? wallMs, running, target: sizing.pass });
          const done = (doneBefore + n - running) / count;
          if (job.onPartial && performance.now() - lastPartial >= PARTIAL_MS && done - partialDone >= PARTIAL_GAIN) {
            const settled = final ?? new Uint8Array(count);
            await runner.emit(p, guard, (words) => fillValues(words, view, { final: settled.subarray(offset, offset + n), fallback: stripFallback }));
            final = settled;
            stripRead = true;
            lastPartial = performance.now();
            partialDone = done;
            record.partials += 1;
            if (!job.live()) return { status: "cancelled" };
            job.onPartial();
          }
          // The page's own work, and the compositor's turn on the device, before the next.
          await yieldTask();
        }
        // **What a partial marked final stays final**: a sample's status only ever leaves
        // `RUNNING` once, so the last emit adds to the marks and never takes one back, and a
        // device lost under it keeps the earlier read-back's (`final` is assigned only after
        // the read has run).
        const settled = final ?? new Uint8Array(count);
        const marks = settled.subarray(offset, offset + n);
        await runner.emit(p, guard, (words) => {
          fillValues(words, view, { final: marks });
          record.gated += gatedIn(words);
        });
        final = settled;
        stripRead = true;
        const handed = unfinishedAt(marks, offset);
        doneBefore += n - handed.length;
        hand(handed);
      }
      record.ms = performance.now() - started;
      return { status: "done", handed: joined(handedAll), passes: passStats(record) };
    } catch (error) {
      const refused = error instanceof Unserved;
      // A refusal or a loss in the first strip with nothing handed over yet is what it was
      // before strips: a refusal sends the frame to the bands, and a loss finishes it on the
      // CPU from what the last read-back settled, or sends it to the bands where none had.
      if (refused) this.log("gpu declined the frame", { why: error.message, strip });
      else this.#drop(error instanceof GpuLost ? error.message : `the frame threw: ${error?.message ?? error}`);
      if (strip === 0 && streamed === 0 && (refused || final === null)) {
        return refused ? { status: "unserved", why: error.message } : { status: "lost", handed: null, passes: passStats(record) };
      }
      // Past that, the strips already ended stay the GPU's, and everything else is the CPU's:
      // the unfinished samples of the strip that was running, then every later strip.
      const offset = Math.min(strip, strips) * rows * width;
      const rest = [...handedAll];
      if (offset < count) {
        const n = Math.min(rows * width, count - offset);
        rest.push(stripRead ? unfinishedAt(final.subarray(offset, offset + n), offset) : span(offset, offset + n));
        if (offset + n < count) rest.push(span(offset + n, count));
      }
      const handed = joined(rest);
      // `hand` counted the lists already kept; only what the catch added is new.
      record.handed += handed.length - handedAll.reduce((sum, list) => sum + list.length, 0);
      return { status: refused ? "done" : "lost", handed, passes: passStats(record) };
    }
  }

  /** For the bench pages: lose the device on purpose. */
  loseForTesting() {
    this.device?.destroy();
  }
}
