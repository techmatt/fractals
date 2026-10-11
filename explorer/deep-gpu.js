// The Deep tab's GPU path *(gpu_deep_ship_ckpt162)*: the device, the self-test that earns
// it, and the pass loop that draws a field on it.
//
// **The GPU draws a Deep frame only where this page load's self-test passed, and the CPU
// kernel draws it otherwise, silently.** The self-test is stage 2's: the exported vectors
// through every double-single primitive bit for bit, then two small exported frames
// (`deep-gpu-selftest/`) word for word, `frac` excepted, at two budget schedules each so
// that the resume path is tested too. Any miss, no WebGPU, no adapter, or a fallback
// adapter (a software rasterizer is not a GPU path) leaves the CPU kernel drawing, and the
// reason goes to the tab's log and nowhere else.
//
// **What a frame on the GPU hands back is the field the CPU kernel would**: one `f64` lane a
// sample, the smooth count where it escaped and `NaN` where it did not, so nothing
// downstream of `DeepRenderer.field` knows which kernel drew it. The kernel is
// `deep-gpu-wgsl.js`, the model's double-single loop with its interior proof
// (`deep-gpu-model`), run under the `handoff` policy: a sample the proof gives up on ends
// `GATED` and is finished by the CPU kernel, which restarts it from the first iteration
// with its own `f64` loop and its own proof (`compute_samples`). So is every sample still
// running when the frame's tail is thin enough at a step checkpoint (`handsTail`), and so
// is every unfinished sample after a lost device. A frame whose quarter pass says it is cheap
// stays on the CPU altogether (`cheap`).
//
// **Passes are sized by time, and that never moves a pixel.** All of a sample's progress
// lives in its state on the device, and the model guarantees any sequence of budgets leaves
// the state one unbounded run does, so a pass is sized to about `PASS_TARGET_MS` from the
// last one's wall time, well clear of Windows' two-second device timeout, and the picture
// is the same however the passes fell. What the CPU is handed is decided at step
// checkpoints and never by the clock, so a machine draws the same picture every time.
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

/** Threads per workgroup, and the most workgroups one dimension of a dispatch may take
 *  unless the adapter says otherwise. The kernel indexes samples along `x` alone. */
export const WORKGROUP = 64;
const DEFAULT_MAX_GROUPS = 65535;

/** What one pass is sized to, in milliseconds: twenty times clear of the two-second
 *  timeout, and the latency of a Cancel, the same order as the CPU's bands. */
export const PASS_TARGET_MS = 100;
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
 * *(gpu_deep_ship_ckpt162, Phase 4)*. Read off the quarter pass, which is always the CPU's
 * and counts what it ran. The full stage runs sixteen times its samples, and measured 14.8
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
/** The least a frame waits for a self-test still running before it goes to the CPU. */
export const READY_WAIT_MS = 3000;
/** The most, however slow the frame's quarter pass was. */
export const MAX_READY_WAIT_MS = 30000;
/** And under `?kernel=gpu`, which a harness asks for in order to measure the GPU. */
export const FORCED_WAIT_MS = 120000;

/**
 * How long a full stage waits for a self-test still running, from what its quarter pass
 * took on the CPU (`null` where there was none). The full stage is sixteen times the
 * quarter's samples, so the CPU would take about `16 q`; the GPU draws such a frame in a
 * third of that or less, so waiting pays wherever the test lands inside about `10 q`.
 * **Eight quarter passes**, half the CPU's own cost, bounded below by `READY_WAIT_MS` and
 * above by `MAX_READY_WAIT_MS`: a test that never lands costs at most half a frame more,
 * and the common one, landing a few seconds after the quarter pass, draws the frame on the
 * GPU rather than sending it to the CPU after an idle wait. Time decides only which kernel
 * draws, never a pixel of what either draws.
 */
export function readyWait(quarterMs) {
  if (!(quarterMs > 0)) return READY_WAIT_MS;
  return Math.min(MAX_READY_WAIT_MS, Math.max(READY_WAIT_MS, 8 * quarterMs));
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
 */
export function hiLoOrbit(packed) {
  const buffer = packed instanceof ArrayBuffer ? packed : packed.buffer.slice(packed.byteOffset, packed.byteOffset + packed.byteLength);
  const head = new DataView(buffer);
  const count = head.getUint32(0, true);
  const flags = head.getUint32(4, true);
  const pairs = new Float64Array(buffer, 16, 2 * count);
  const points = new Float32Array(4 * count);
  let worst = null;
  const keep = (x) => {
    const y = narrow(x);
    if (x !== 0 && y === 0) {
      const e = exponentBits(x);
      worst = worst === null ? e : Math.max(worst, e);
    }
    return y;
  };
  for (let k = 0; k < count; k++) {
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
  return {
    points,
    count,
    periodic: (flags & 2) !== 0,
    flush: worst === null ? 0 : Math.max(FLUSH, -(worst + 2)),
  };
}

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
 * budget step just measured, growing at most `GROWTH` times and shrinking at once. The
 * running set only shrinks, so the cost of a step only falls, and this errs safe.
 */
export function nextBudget({ budget, wallMs, running, target = PASS_TARGET_MS }) {
  const perStep = wallMs / Math.max(1, budget);
  const want = perStep > 0 ? target / perStep : budget * GROWTH;
  return clampBudget(Math.min(want, budget * GROWTH), running);
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
 * Whether the device can hold this frame at all, or the reason it cannot: a degree the
 * kernel does not draw, a dispatch past one dimension's workgroups, or a buffer past the
 * adapter's limits. Such a frame is the CPU's, whatever else is true.
 */
export function fits({ samples, degree, interior, orbitPoints, limits }) {
  if (!(degree >= 2 && degree <= 6)) return "degree";
  const groups = Math.ceil(samples / WORKGROUP);
  if (groups > (limits.maxComputeWorkgroupsPerDimension ?? DEFAULT_MAX_GROUPS)) return "dispatch";
  const state = samples * (interior ? STATE_BYTES.proof : STATE_BYTES.plain);
  const binding = limits.maxStorageBufferBindingSize;
  const buffer = limits.maxBufferSize;
  if (state > binding || state > buffer) return "state";
  if (16 * orbitPoints > binding || 16 * orbitPoints > buffer) return "orbit";
  if (8 * samples > binding || 8 * samples > buffer) return "out";
  return null;
}

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

  get usable() {
    return this.status === "ready";
  }

  /** Whether a frame should (re)start the device and its self-test. */
  get wants() {
    return this.status === "untested" || this.status === "lost" || this.status === "unavailable";
  }
}

// ---- The device -----------------------------------------------------------------------

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

/** Pop a validation scope and the out-of-memory scope under it; the first error of the
 *  two, or `null`. Both are always popped, so no scope is left behind. */
async function popBoth(device) {
  // Both popped before either is awaited: a scope is the device's and not this call's, so
  // nothing else may push between them.
  const [validation, memory] = await Promise.all([device.popErrorScope(), device.popErrorScope()]);
  return validation ?? memory;
}

/** One frame's buffers on the device, for `count` samples, with the proof or without. */
class Runner {
  constructor(device, count, interior) {
    const usage = GPUBufferUsage;
    const make = (size, flags, label) => device.createBuffer({ size: Math.max(16, Math.ceil(size / 4) * 4), usage: flags, label });
    this.device = device;
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
    this.indirect = make(16, usage.STORAGE | usage.INDIRECT, "deep indirect");
    this.countsRead = make(16, usage.MAP_READ | usage.COPY_DST, "deep counts read");
    this.outRead = make(8 * count, usage.MAP_READ | usage.COPY_DST, "deep out read");
    this.groups = Math.ceil(count / WORKGROUP);
  }

  destroy() {
    for (const b of [this.frame, this.frameLo, this.params, this.states, this.counters, this.list, this.out, this.indirect, this.countsRead, this.outRead]) {
      try {
        b.destroy();
      } catch {
        // A lost device's buffers are gone already.
      }
    }
  }

  bind(layouts, orbit) {
    const buffers = [this.frame, this.frameLo, this.params, orbit, this.states, this.counters, this.list, this.out];
    this.group0 = this.device.createBindGroup({ layout: layouts[0], entries: buffers.map((buffer, binding) => ({ binding, resource: { buffer } })) });
    this.group1 = this.device.createBindGroup({ layout: layouts[1], entries: [{ binding: 0, resource: { buffer: this.indirect } }] });
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

  /** One pass of `budget` steps over every sample or the list; resolves the samples still
   *  running after it and the steps it took. */
  async pass(p, budget, mode, guard) {
    const device = this.device;
    device.queue.writeBuffer(this.params, 0, new Uint32Array([budget]));
    const encoder = device.createCommandEncoder();
    if (mode === "compact") {
      encoder.clearBuffer(this.counters, 4, 4);
      const c = encoder.beginComputePass();
      c.setBindGroup(0, this.group0);
      c.setBindGroup(1, this.group1);
      c.setPipeline(p.compact);
      c.dispatchWorkgroups(this.groups);
      c.setPipeline(p.args);
      c.dispatchWorkgroups(1);
      c.end();
    }
    encoder.clearBuffer(this.counters, 0, 4);
    encoder.clearBuffer(this.counters, 8, 4);
    const pass = encoder.beginComputePass();
    pass.setBindGroup(0, this.group0);
    if (mode === "all") {
      pass.setPipeline(p.all);
      pass.dispatchWorkgroups(this.groups);
    } else {
      pass.setPipeline(p.list);
      pass.dispatchWorkgroupsIndirect(this.indirect, 0);
    }
    pass.end();
    encoder.copyBufferToBuffer(this.counters, 0, this.countsRead, 0, 16);
    device.queue.submit([encoder.finish()]);
    await guard(this.countsRead.mapAsync(GPUMapMode.READ));
    const counts = new Uint32Array(this.countsRead.getMappedRange().slice(0));
    this.countsRead.unmap();
    return { running: counts[0], steps: counts[2] };
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
 * small-frame rule (never the self-test or the device's limits).
 */
export class DeepGpu {
  constructor({ kernel = null, log = () => {}, warm = [] } = {}) {
    this.kernel = kernel;
    this.log = log;
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
    this.idle = Promise.resolve();
    this.lostSignal = null;
    this.fault = null;
    /** What the last frame did, for the bench pages: passes, steps, handed samples. */
    this.last = null;
    /** `handsTail`'s `scale`, as an instance's so that a bench page can measure another. */
    this.tailScale = 1;
  }

  /** Acquire the device and test it, once, in the background; resolves whether it passed.
   *  Safe to call again: a test in flight is shared, and a lost device is re-acquired. */
  start() {
    if (this.kernel === "cpu") return Promise.resolve(false);
    if (this.testing !== null) return this.testing;
    if (!this.health.wants) return Promise.resolve(this.health.usable);
    const started = performance.now();
    const losses = this.health.losses;
    this.testing = this.#open()
      .then(() => {
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
      });
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
    if (this.kernel === "cpu" || !this.health.usable || this.device === null) return;
    if (!(degree >= 2 && degree <= 6)) return;
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
        if (this.device !== device) return;
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
  async ready(within = READY_WAIT_MS) {
    if (this.kernel === "cpu") return false;
    if (this.health.usable) return true;
    if (this.health.status === "off") return false;
    const testing = this.start();
    let timer;
    const waited = await Promise.race([testing, new Promise((resolve) => (timer = setTimeout(() => resolve(false), within)))]);
    clearTimeout(timer);
    return waited === true && this.health.usable;
  }

  /** Why a frame of this shape stays on the CPU, or `null` where the GPU may draw it.
   *  `quarterMs`, what the frame's quarter pass took on the CPU, sets how long it may wait
   *  on a self-test still running (`readyWait`); `iterations`, the CPU's estimate of the
   *  stage from that pass, keeps a cheap one on the CPU (`cheap`) without waiting at all. */
  async refuses({ samples, degree, interior, orbitPoints, quarterMs = null, iterations = null, workers = TAIL_WORKERS }) {
    if (this.kernel === "cpu") return "asked for the CPU";
    if (this.kernel !== "gpu" && samples < GPU_MIN_SAMPLES) return "small";
    if (this.kernel !== "gpu" && cheap({ iterations, workers })) return "cheap";
    if (!(await this.ready(this.kernel === "gpu" ? FORCED_WAIT_MS : readyWait(quarterMs)))) return `not ready (${this.health.status}${this.health.why ? `: ${this.health.why}` : ""})`;
    return fits({ samples, degree, interior, orbitPoints, limits: this.limits });
  }

  /** Whether a frame of `samples` would go to the GPU as things stand — ready, not small,
   *  and inside the device's limits with the proof's state, the larger — without waiting
   *  on anything. The Download row's estimate asks it; a frame still asks `refuses`. */
  likely(samples) {
    if (this.kernel === "cpu" || !this.health.usable || this.limits === null) return false;
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
    try {
      device = await adapter.requestDevice({
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
    await this.#selfTest(W, device);
  }

  /** Give up the device after a loss, counting it; the next frame retries. */
  #drop(why) {
    if (this.device === null && this.health.status !== "ready") return;
    this.health.lost(why);
    this.log("gpu lost", { why, losses: this.health.losses, status: this.health.status });
    this.#release();
  }

  #release() {
    const device = this.device;
    this.device = null;
    this.runner = null;
    this.orbit = null;
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
      const value = await Promise.race([promise, lost]);
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
        const both = device.createPipelineLayout({ bindGroupLayouts: this.layouts });
        const make = (entryPoint, layout) => device.createComputePipelineAsync({ layout, compute: { module, entryPoint } });
        const [init, all, list, compact, args, emit] = await Promise.all([
          make("init", plain),
          make("pass_all", plain),
          make("pass_list", plain),
          make("compact", plain),
          make("args", both),
          make("emit", plain),
        ]);
        this.log("gpu kernel compiled", { degree, julia, interior, ms: Math.round(performance.now() - started) });
        return { init, all, list, compact, args, emit };
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
        const Typed = { u8: Uint8Array, u32: Uint32Array, f32: Float32Array }[a.dtype];
        arrays[a.name] = new Typed(bin, a.offset, a.count);
      }
      for (const [first, rest] of plan.budgets) {
        const missed = await this.#frameTest(W, device, guard, manifest, arrays, first, rest);
        if (missed !== null) throw new Error(`self-test: ${manifest.id} at ${first} then ${rest}: ${missed}`);
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
  async #frameTest(W, device, guard, manifest, arrays, first, rest) {
    const count = manifest.width_px * manifest.height_px;
    const interior = manifest.interior === true;
    const p = await this.#pipelines(W, device, manifest.degree, manifest.julia, interior);
    device.pushErrorScope("validation");
    const runner = new Runner(device, count, interior);
    const orbit = device.createBuffer({ size: Math.max(16, arrays.orbit_hilo.byteLength), usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    try {
      device.queue.writeBuffer(orbit, 0, arrays.orbit_hilo);
      device.queue.writeBuffer(runner.frame, 0, arrays.frame);
      device.queue.writeBuffer(runner.frameLo, 0, arrays.frame_lo);
      device.queue.writeBuffer(runner.params, 0, W.paramsBytes({ budget: 0, periodic: manifest.periodic, length: manifest.orbit_len, count, flush: manifest.flush_hilo ?? 0 }));
      runner.bind(this.layouts, orbit);
      runner.init(p);
      let running = count;
      let passes = 0;
      const limit = 4 * (manifest.cap + 8);
      while (running > 0 && passes < limit) {
        ({ running } = await runner.pass(p, passes === 0 ? first : rest, "all", guard));
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

  async #draw(job) {
    const W = await wgsl();
    const device = this.device;
    if (device === null || !this.health.usable) return { status: "unserved", why: "no device" };
    const guard = this.#guard(device);
    const { plan, values } = job;
    const count = plan.sample_width * plan.sample_height;
    const interior = plan.interior === true;
    const started = performance.now();
    let final = null;
    // `trace` is a pass a row: its budget, its mode's initial, the samples running after it,
    // and its wall time in milliseconds.
    const record = {
      count,
      degree: plan.degree,
      julia: Boolean(plan.julia),
      interior,
      maxiter: plan.maxiter,
      passes: 0,
      spent: 0,
      compacts: 0,
      partials: 0,
      handed: 0,
      tail: false,
      trace: [],
    };
    this.last = record;
    try {
      const p = await this.#pipelines(W, device, plan.degree, plan.julia, interior);
      if (!job.live()) return { status: "cancelled" };

      // The orbit, kept on the device for as long as the pool holds it.
      if (this.orbit === null || this.orbit.stamp !== job.orbit.stamp) {
        this.orbit?.buffer.destroy();
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
        this.orbit = { stamp: job.orbit.stamp, buffer, count: hilo.count, periodic: hilo.periodic, flush: hilo.flush };
      }
      const orbit = this.orbit;

      // The frame's buffers, kept while frames keep their size.
      if (this.runner === null || this.runner.count !== count || this.runner.interior !== interior) {
        this.runner?.destroy();
        this.runner = null;
        device.pushErrorScope("out-of-memory");
        device.pushErrorScope("validation");
        const runner = new Runner(device, count, interior);
        const invalid = await popBoth(device);
        if (invalid) {
          runner.destroy();
          throw new Unserved(`buffers for ${count} samples: ${invalid.message}`);
        }
        this.runner = runner;
      }
      const runner = this.runner;
      const { frame, frameLo } = frameBuffers(plan, orbit.count, HANDOFF);
      device.queue.writeBuffer(runner.frame, 0, frame);
      device.queue.writeBuffer(runner.frameLo, 0, frameLo);
      device.queue.writeBuffer(runner.params, 0, W.paramsBytes({ budget: 0, periodic: orbit.periodic, length: orbit.count, count, flush: orbit.flush }));
      runner.bind(this.layouts, orbit.buffer);
      runner.init(p);

      const fallback = previewOf(job.preview, plan.sample_width, plan.sample_height);
      let running = count;
      let budget = FIRST_BUDGET;
      let listed = null;
      let lastPartial = performance.now();
      let partialDone = 0;
      for (;;) {
        if (!job.live()) return { status: "cancelled" };
        const mode = passMode(running, count, listed);
        const steps = landOn(record.spent, clampBudget(budget, running));
        const at = performance.now();
        const counted = await runner.pass(p, steps, mode, guard);
        const wallMs = performance.now() - at;
        record.passes += 1;
        record.spent += steps;
        record.trace.push([steps, mode[0], counted.running, Math.round(wallMs)]);
        if (mode === "compact") {
          record.compacts += 1;
          listed = 0;
        } else if (mode === "list") listed += 1;
        running = counted.running;
        job.onPass?.();
        if (!job.live()) return { status: "cancelled" };
        job.onProgress?.((count - running) / count, performance.now() - started);
        if (running === 0) break;
        const workers = job.workers ?? TAIL_WORKERS;
        if (handsTail({ spent: record.spent, running, maxiter: plan.maxiter, interior, workers, scale: this.tailScale })) {
          record.tail = true;
          break;
        }
        budget = nextBudget({ budget: steps, wallMs, running });
        const done = (count - running) / count;
        if (job.onPartial && performance.now() - lastPartial >= PARTIAL_MS && done - partialDone >= PARTIAL_GAIN) {
          // `final` is set only once a read-back has landed: a loss before any leaves it
          // `null`, which sends the whole frame to the bands.
          const settled = final ?? new Uint8Array(count);
          await runner.emit(p, guard, (words) => fillValues(words, values, { final: settled, fallback }));
          final = settled;
          lastPartial = performance.now();
          partialDone = done;
          record.partials += 1;
          if (!job.live()) return { status: "cancelled" };
          job.onPartial();
        }
      }
      // **What a partial marked final stays final**: a sample's status only ever leaves
      // `RUNNING` once, so the last emit adds to the marks and never takes one back, and a
      // device lost under it keeps the earlier read-back's (`final` is assigned only after
      // the read has run).
      const settled = final ?? new Uint8Array(count);
      await runner.emit(p, guard, (words) => fillValues(words, values, { final: settled }));
      final = settled;
      const handed = unfinished(final);
      record.handed = handed.length;
      record.ms = performance.now() - started;
      return { status: "done", handed };
    } catch (error) {
      if (error instanceof Unserved) {
        this.log("gpu declined the frame", { why: error.message });
        return { status: "unserved", why: error.message };
      }
      // Anything else under a frame is the device's: count it as a loss and finish on the
      // CPU, from what the last read-back had settled.
      this.#drop(error instanceof GpuLost ? error.message : `the frame threw: ${error?.message ?? error}`);
      return { status: "lost", handed: final === null ? null : unfinished(final) };
    }
  }

  /** For the bench pages: lose the device on purpose. */
  loseForTesting() {
    this.device?.destroy();
  }
}
