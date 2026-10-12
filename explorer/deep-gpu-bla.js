// The Deep tab's GPU skip table *(gpu_deep_depth_ckpt163)*: `deep-gpu-model`'s `bla.rs`
// build, ported line for line, so that the double-single kernel can step over the long
// stretches of a deep frame where the delta is small beside the reference.
//
// **BLA is the GPU path's alone** *(Matt, ckpt163)*. `perturb`'s CPU kernel has no skip,
// by ruling, and nothing here reaches it; a sample the GPU hands the CPU is restarted from
// its first iteration on the CPU's own loop, as before. The table is the model's: a run of
// `2^k` steps from orbit index `j·2^k + 1` is one linear step `δ' = A·δ + B·dc` valid while
// `|δ|` is inside the run's radius, merged up a binary tree of levels from leaves one step
// long, with the guards `bla.rs`'s module doc derives (no run reaches the index where a
// non-periodic reference rebases, no leaf lands past the bailout, none crosses a periodic
// wrap; the cap and the interior floor are the lookup's). Its tolerance is the
// double-single kernel's own rounding unit, `2^-48`, at which the model moved no measured
// frame by more than 0.04 points (`bla.rs`, `apply_ds`).
//
// **Built here from the pool's own `f64` orbit, as the model builds it, bit for bit.** Every
// operation is an `f64` one in the model's order; the one function the two languages would
// not round alike, `hypot`, is the model's `hypot64` in both (a scaled square root, which
// IEEE rounds the same everywhere). `deep-gpu.test.mjs` holds this build to tables the model
// exported. The device reads two buffers: the 528-byte header (a uniform) and the runs,
// 64 bytes each: `bla.rs`'s `BlaEntry` (32 bytes), its `BlaLo` (16, the double-single
// kernel's `A` and `B` to 48 bits) and its `BlaInterior` (16, the products the interior
// switch reads), side by side, so that the kernel binds one buffer and not three.
//
// The build is the model's streamed one, a stack of one pending run a level, held in flat
// typed arrays rather than objects so that a two-million-point orbit costs no allocation a
// point: a product `(mantissa, exponent)` is two numbers, and every mantissa a product takes
// is in `[1, 2)`, so its renormalization is one compare.

/** `2^-48`, `bla.rs`'s `EPSILON_DS_DEFAULT`. */
export const EPSILON = 2 ** -48;
export const MIN_LEVEL = 4;
export const MAX_LEVEL = 24;
/** Levels the header holds, `LEVEL_LIMIT`; no level is above `LEVEL_LIMIT - 1`. */
export const LEVEL_LIMIT = 31;
export const HEADER_BYTES = 528;
/** One run: its entry at 0, its low halves at 32, its interior products at 48. */
export const RUN_BYTES = 64;
/** `perturb`'s escape radius. */
const BAILOUT = 65536;

const F64 = new Float64Array(1);
const U32 = new Uint32Array(F64.buffer);
const F32 = new Float32Array(1);
const U32F = new Uint32Array(F32.buffer);

/** `2^k` exactly, for `k` in `[-1022, 1023]`, by its bits. */
const POW2 = new Float64Array(2046);
for (let k = -1022; k <= 1023; k++) {
  U32[0] = 0;
  U32[1] = (k + 1023) << 20;
  POW2[k + 1022] = F64[0];
}

/** Rust's `f64::max` and `min`: a `NaN` operand gives the other. */
const fmax = (a, b) => (Number.isNaN(a) ? b : Number.isNaN(b) ? a : Math.max(a, b));
const fmin = (a, b) => (Number.isNaN(a) ? b : Number.isNaN(b) ? a : Math.min(a, b));

/** `x · 2^e`, exact while the result is normal (`scale64`). */
export function scale64(x, e) {
  while (e > 1000) {
    x *= POW2[2022];
    e -= 1000;
  }
  while (e < -1000) {
    x *= POW2[22];
    e += 1000;
  }
  return x * POW2[e + 1022];
}

/** The binary exponent of a positive finite `f64`, subnormals included (`exp64`). */
export function exp64(x) {
  F64[0] = x;
  const field = (U32[1] >>> 20) & 0x7ff;
  if (field === 0) return exp64(x * POW2[1222]) - 200;
  return field - 1023;
}

/** `sqrt(x² + y²)` as the model forms it (`hypot64`): scaled by the larger component's
 *  exponent, so that it neither overflows nor underflows, and rounded alike everywhere. */
export function hypot64(x, y) {
  const big = fmax(Math.abs(x), Math.abs(y));
  if (big === 0 || !Number.isFinite(big)) return big;
  const e = exp64(big);
  const a = scale64(x, -e);
  const b = scale64(y, -e);
  return scale64(Math.sqrt(a * a + b * b), e);
}

/** `x` rounded to `f32`, a subnormal result a signed zero (`orbit.rs`'s `narrow`). */
function narrow(x) {
  const y = Math.fround(x);
  if (y !== 0 && Math.abs(y) < 2 ** -126) return y < 0 ? -0 : 0;
  return y;
}

/** The largest `f32` at most `x`, for `x` in `[1, 4)` (`f32_down`). */
function f32Down(x) {
  const y = Math.fround(x);
  if (y <= x) return y;
  F32[0] = y;
  U32F[0] -= 1;
  return F32[0];
}

// ---- Products: a positive quantity as a mantissa in [1, 2) and an exponent; zero is (0, 0).
// The functions return the mantissa and leave the exponent in `PE`.

let PE = 0;

/** `norm`: any positive finite `m` against `e`. */
function norm(m, e) {
  if (m === 0 || !Number.isFinite(m)) {
    PE = 0;
    return 0;
  }
  const x = exp64(m);
  PE = e + x;
  return scale64(m, -x);
}

/** `mul` of two products: both mantissas in `[1, 2)`, so the product is in `[1, 4)` and its
 *  renormalization is `exp64`'s 0 or 1, exactly what `norm` would take. */
function mul(am, ae, bm, be) {
  if (am === 0 || bm === 0) {
    PE = 0;
    return 0;
  }
  const m = am * bm;
  if (m >= 2) {
    PE = ae + be + 1;
    return m * 0.5;
  }
  PE = ae + be;
  return m;
}

/** `smaller`: the first where it is the smaller, a zero first. Returns which, 0 or 1. */
function smaller(am, ae, bm, be) {
  if (am === 0) return 0;
  if (bm === 0) return 1;
  return ae < be || (ae === be && am <= bm) ? 0 : 1;
}

/** `norm_sq`: `|z|²` as a product, without underflowing for a small `z`. */
function normSq(re, im) {
  const big = Math.max(Math.abs(re), Math.abs(im));
  if (big === 0) {
    PE = 0;
    return 0;
  }
  const e = exp64(big);
  const a = scale64(re, -e);
  const b = scale64(im, -e);
  return norm(a * a + b * b, 2 * e);
}

// ---- A run while it is built: thirteen numbers, `bla.rs`'s `Build`.
const A0 = 0;
const A1 = 1;
const B0 = 2;
const B1 = 3;
const R = 4;
const DM = 5; // deriv, over the inner points: what is stored
const DE = 6;
const MM = 7; // dmin, its smallest prefix
const ME = 8;
const FM = 9; // full, over every landing index: build time only
const FE = 10;
const GM = 11; // dfull, its smallest prefix
const GE = 12;
const WIDTH = 13;
/** "No prefix": larger than any product. */
const NO_PREFIX_E = 1 << 28;

/**
 * The largest `|dc|` any sample of the frame carries (`dc_bound`), off the frame's own
 * `f32` constants at its four corners, with `2^-20` for the per-pixel sum's rounding.
 * `frame` is `{sampleWidth, sampleHeight, offsetM, spacingM, sc}`, the `Frame` uniform's.
 */
export function dcBound({ sampleWidth, sampleHeight, offsetM, spacingM, sc }) {
  const f = Math.fround;
  const unit = scale64(1, sc);
  let big = 0;
  for (const [col, row] of [
    [0, 0],
    [sampleWidth - 1, 0],
    [0, sampleHeight - 1],
    [sampleWidth - 1, sampleHeight - 1],
  ]) {
    const across = f(f(f(col) + 0.5) - f(f(sampleWidth) * 0.5));
    const down = f(f(f(sampleHeight) * 0.5) - f(f(row) + 0.5));
    const m = [f(offsetM[0] + f(across * spacingM)), f(offsetM[1] + f(down * spacingM))];
    big = fmax(big, hypot64(m[0], m[1]));
  }
  return big * unit * (1 + 1 / 1048576);
}

/**
 * The table over `points` (`f64` pairs, `Z[0] = 0` first; `count` points, one period where
 * `periodic`) at `degree`, merged against `dcmax` (0 on a Julia plane): `build_with`.
 * Returns `{header, runs, levels, valid}`, the bytes the device binds, `levels` 0 for an
 * empty table (an orbit too short to hold a stored run), whose `runs` is one zero run.
 */
export function buildTable({ points, count, periodic, degree, julia, dcmax, epsilon = EPSILON, minLevel = MIN_LEVEL, maxLevel = MAX_LEVEL }) {
  const header = new ArrayBuffer(HEADER_BYTES);
  const h = new DataView(header);
  h.setUint32(12, periodic ? 1 : 0, true);
  const empty = { header, runs: new ArrayBuffer(RUN_BYTES), levels: 0, valid: 0 };
  const eps = epsilon;
  if (!(eps > 0 && eps < 0.25) || Number.isNaN(dcmax) || dcmax < 0 || !(degree >= 2 && degree <= 6)) return empty;
  const len = count;
  // Leaves start at 1. Non-periodic: the highest landing index is `len − 2`, one below the
  // index where the loop rebases. Periodic: a run may land on `len`, which is index 0.
  const leaves = periodic ? Math.max(0, len - 1) : Math.max(0, len - 3);
  if (leaves === 0) return empty;
  let kMax = 0;
  while (kMax < Math.min(maxLevel, LEVEL_LIMIT - 1) && 2 * 2 ** kMax <= leaves) kMax += 1;
  if (minLevel > kMax) return empty;
  const stored = kMax - minLevel + 1;
  // Level `i` holds a run for every `2^(minLevel + i)` leaves, in order.
  const sizes = Array.from({ length: stored }, (_, i) => Math.floor(leaves / 2 ** (minLevel + i)));
  const total = sizes.reduce((sum, n) => sum + n, 0);
  const runs = new ArrayBuffer(Math.max(1, total) * RUN_BYTES);
  const W = new DataView(runs);
  const offsets = [];
  let at = 0;
  for (const n of sizes) {
    offsets.push(at);
    at += n;
  }
  const filled = new Array(stored).fill(0);
  const top = Array.from({ length: stored }, () => [0, 0]);
  let valid = 0;
  const d = degree;
  const guard = (1 + eps) * (1 + eps);
  const landM = norm(d * d, 0);
  const landE = PE;

  /** `split2` of `(v0, v1)` into `W` at `o` (mantissas) and `oe` (exponent). */
  const split2 = (v0, v1, o, oe) => {
    const big = fmax(Math.abs(v0), Math.abs(v1));
    if (big === 0 || !Number.isFinite(big)) {
      W.setFloat32(o, 0, true);
      W.setFloat32(o + 4, 0, true);
      W.setInt32(oe, 0, true);
      return 0;
    }
    const e = exp64(big);
    W.setFloat32(o, narrow(scale64(v0, -e)), true);
    W.setFloat32(o + 4, narrow(scale64(v1, -e)), true);
    W.setInt32(oe, e, true);
    return e;
  };
  /** `split1` of a product into `W` at `o`. */
  const split1 = (m, e, o) => {
    if (m === 0) {
      W.setFloat32(o, 0, true);
      W.setInt32(o + 4, 0, true);
      return;
    }
    const f = Math.fround(m);
    W.setFloat32(o, f >= 2 ? 1 : f, true);
    W.setInt32(o + 4, f >= 2 ? e + 1 : e, true);
  };
  /** The low half of `v` against the high half stored at `o` and exponent `e` (`store_lo`). */
  const low = (v0, v1, o, e, into) => {
    const h0 = W.getFloat32(o, true);
    const h1 = W.getFloat32(o + 4, true);
    if (h0 === 0 && h1 === 0) {
      W.setFloat32(into, 0, true);
      W.setFloat32(into + 4, 0, true);
      return;
    }
    W.setFloat32(into, narrow(scale64(v0, -e) - h0), true);
    W.setFloat32(into + 4, narrow(scale64(v1, -e) - h1), true);
  };
  /** `store` and `store_lo`: run `b` (at `src[base]`) as level `level`'s next. */
  const store = (level, src, base) => {
    const index = offsets[level] + filled[level];
    filled[level] += 1;
    const o = index * RUN_BYTES;
    const aE = split2(src[base + A0], src[base + A1], o, o + 16);
    const bE = split2(src[base + B0], src[base + B1], o + 8, o + 20);
    const r = src[base + R];
    const live = r > 0 && Number.isFinite(r);
    let r2m = 0;
    let r2e = 0;
    if (live) {
      const e = exp64(r);
      const m = scale64(r, -e);
      const sq = m * m;
      // Rounded down, so the stored radius is never larger than the built one.
      if (sq >= 2) {
        r2m = f32Down(sq / 2);
        r2e = 2 * e + 1;
      } else {
        r2m = f32Down(sq);
        r2e = 2 * e;
      }
    }
    W.setFloat32(o + 24, r2m, true);
    W.setInt32(o + 28, r2e, true);
    low(src[base + A0], src[base + A1], o, aE, o + 32);
    low(src[base + B0], src[base + B1], o + 8, bE, o + 40);
    split1(src[base + DM], src[base + DE], o + 48);
    split1(src[base + MM], src[base + ME], o + 56);
    if (live) {
      valid += 1;
      const t = top[level];
      if (t[0] === 0 || r2e > t[1] || (r2e === t[1] && r2m > t[0])) {
        t[0] = r2m;
        t[1] = r2e;
      }
    }
  };

  // The stack: one pending run a level, and whether it holds one.
  const stack = new Float64Array((kMax + 1) * WIDTH);
  const held = new Uint8Array(kMax + 1);
  const c = new Float64Array(WIDTH);

  /** `merge`: `c := c after stack[k]` (the left run `x` is the stack's, the right `y` is `c`). */
  const merge = (k) => {
    const x = k * WIDTH;
    const xa0 = stack[x + A0];
    const xa1 = stack[x + A1];
    const xb0 = stack[x + B0];
    const xb1 = stack[x + B1];
    const ya0 = c[A0];
    const ya1 = c[A1];
    const a0 = ya0 * xa0 - ya1 * xa1;
    const a1 = ya0 * xa1 + ya1 * xa0;
    const ab0 = ya0 * xb0 - ya1 * xb1;
    const ab1 = ya0 * xb1 + ya1 * xb0;
    const b0 = ab0 + c[B0];
    const b1 = ab1 + c[B1];
    const ax = hypot64(xa0, xa1);
    const bx = hypot64(xb0, xb1);
    const reach = c[R] - bx * dcmax;
    const second = ax > 0 ? fmax(reach / ax, 0) : reach >= 0 ? Infinity : 0;
    let r = fmin(stack[x + R], second);
    if (!(Number.isFinite(a0) && Number.isFinite(a1) && Number.isFinite(b0) && Number.isFinite(b1))) r = 0;
    const xfm = stack[x + FM];
    const xfe = stack[x + FE];
    const xgm = stack[x + GM];
    const xge = stack[x + GE];
    // deriv = x.full · y.deriv
    const dm = mul(xfm, xfe, c[DM], c[DE]);
    const de = PE;
    // dmin = smaller(x.dfull, x.full · y.dmin)
    let mm = mul(xfm, xfe, c[MM], c[ME]);
    let me = PE;
    if (smaller(xgm, xge, mm, me) === 0) {
      mm = xgm;
      me = xge;
    }
    // full = x.full · y.full
    const fm = mul(xfm, xfe, c[FM], c[FE]);
    const fe = PE;
    // dfull = smaller(x.dfull, x.full · y.dfull)
    let gm = mul(xfm, xfe, c[GM], c[GE]);
    let ge = PE;
    if (smaller(xgm, xge, gm, ge) === 0) {
      gm = xgm;
      ge = xge;
    }
    c[A0] = a0;
    c[A1] = a1;
    c[B0] = b0;
    c[B1] = b1;
    c[R] = r;
    c[DM] = dm;
    c[DE] = de;
    c[MM] = mm;
    c[ME] = me;
    c[FM] = fm;
    c[FE] = fe;
    c[GM] = gm;
    c[GE] = ge;
  };

  for (let j = 0; j < leaves; j++) {
    const s = j + 1;
    const next = periodic && s + 1 === len ? 0 : s + 1;
    // `leaf`: one step from `Z[s]`, landing on `Z[next]`.
    const zr = points[2 * s];
    const zi = points[2 * s + 1];
    const nr = points[2 * next];
    const ni = points[2 * next + 1];
    let p0 = 1;
    let p1 = 0;
    for (let k = 1; k < d; k++) {
      const t = p0 * zr - p1 * zi;
      p1 = p0 * zi + p1 * zr;
      p0 = t;
    }
    const a0 = d * p0;
    const a1 = d * p1;
    let r = (eps * hypot64(zr, zi)) / (d - 1);
    if (guard * (nr * nr + ni * ni) > BAILOUT * BAILOUT) r = 0;
    if (!(Number.isFinite(a0) && Number.isFinite(a1)) || !Number.isFinite(r)) r = 0;
    // D²·|Zn|^(2(D−1)), the landing factor: a one-step run has no inner point.
    const n2m = normSq(nr, ni);
    const n2e = PE;
    let lm = landM;
    let le = landE;
    for (let k = 1; k < d; k++) {
      lm = mul(lm, le, n2m, n2e);
      le = PE;
    }
    c[A0] = a0;
    c[A1] = a1;
    c[B0] = julia ? 0 : 1;
    c[B1] = 0;
    c[R] = r;
    c[DM] = 1;
    c[DE] = 0;
    c[MM] = 1;
    c[ME] = NO_PREFIX_E;
    c[FM] = lm;
    c[FE] = le;
    c[GM] = lm;
    c[GE] = le;
    let k = 0;
    for (;;) {
      if (k >= minLevel) store(k - minLevel, c, 0);
      if (k === kMax) break;
      if (held[k] === 0) {
        stack.set(c, k * WIDTH);
        held[k] = 1;
        break;
      }
      held[k] = 0;
      merge(k);
      k += 1;
    }
  }

  h.setUint32(0, minLevel, true);
  h.setUint32(4, stored, true);
  h.setUint32(8, (1 << minLevel) - 1, true);
  for (let i = 0; i < stored; i++) {
    const o = 16 + 16 * i;
    h.setUint32(o, offsets[i], true);
    h.setUint32(o + 4, sizes[i], true);
    h.setFloat32(o + 8, top[i][0], true);
    h.setInt32(o + 12, top[i][1], true);
  }
  return { header, runs, levels: stored, valid };
}

// **As a module worker** (`deep-gpu.js`'s `#build`), it builds one table a message, off the
// page's thread, and hands the bytes back without a copy.
if (typeof WorkerGlobalScope !== "undefined" && globalThis instanceof WorkerGlobalScope) {
  globalThis.onmessage = (event) => {
    const table = buildTable(event.data);
    globalThis.postMessage(table, [table.header, table.runs]);
  };
}
