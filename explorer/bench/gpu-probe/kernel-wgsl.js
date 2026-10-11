// The Deep tab's per-pixel loop in WGSL, generated from one template per degree, plane
// and arithmetic: `explorer/deep-gpu-model`'s `model.rs` (the `f32` kernel, on the
// `F32Pair` orbit) and `model_ds.rs` (the double-single kernel, on the `HiLo` orbit),
// ported line for line with the interior switch off and no skip table.
//
// What the port leaves out, and nothing else: the interior gate and proof (so `zv`/`ze`,
// the derivative and the proof's 72 bytes are gone; `dz_*` stay in the state, untouched,
// so that the struct is the model's), and the skip. Every order of operations, constant,
// regime switch and integer exponent test is the model's. Helpers are `wgsl.rs`'s, one
// function per builtin or bit idiom.
//
// The double-single error-free transforms route every arithmetic result through `G`, the
// same guard `ds-wgsl.js` compiles in several forms; which form survives this adapter's
// compilers is what the self-test answers. The `f32` kernel is unguarded, as `model.rs`
// is: a contraction there costs one rounding per site, a tolerance and not a defect.
//
// A GPU that flushes subnormals (D3D12 does) can still leave the double-single kernel's
// `d_lo` an ulp or two from the model's, which keeps them: near the quick path's `2^-76`
// gate an error term falls below `2^-126` (`model_ds.rs`, on the gate). That moves
// nothing above the pair's rounding, but it is a difference in bits, which the probe
// counts by comparing every word of the state rather than `n` alone.

import { FORMS } from "./ds-wgsl.js";

export const RUNNING = 0;
export const ESCAPED = 1;
export const CAPPED = 2;

/** Bytes per pixel of state: `PixelState` and `DsPixelState` without the proof. */
export const STATE_BYTES = { f32: 48, ds: 56 };

/**
 * Those structs' words in order, for reading the state back: the order of the model's
 * `PixelState::bits` and `DsPixelState::bits`, which is what the export writes.
 */
export const STATE_NAMES = {
  f32: ["d.re", "d.im", "s", "m", "n", "status", "frac", "dz_mantissa", "dz_exponent", "rebases", "steps", "scaled"],
  ds: ["d_hi.re", "d_hi.im", "d_lo.re", "d_lo.im", "s", "m", "n", "status", "frac", "dz_mantissa", "dz_exponent", "rebases", "steps", "scaled"],
};

/** The forms the kernel can be compiled with: those whose guard needs no extra binding. */
export const KERNEL_FORMS = FORMS.filter((f) => !f.control && f.name !== "storage").map((f) => f.name);

const view = new DataView(new ArrayBuffer(4));

/** An `f32` value as an exact WGSL hexadecimal float literal (normal values only). */
function hexf(x) {
  view.setFloat32(0, x, true);
  const bits = view.getUint32(0, true);
  if (bits === 0) return "0.0f";
  const sign = bits >>> 31 ? "-" : "";
  const exponent = ((bits >>> 23) & 0xff) - 127;
  const mantissa = ((bits & 0x7fffff) << 1).toString(16).padStart(6, "0");
  return `${sign}0x1.${mantissa}p${exponent}f`;
}

/** `2^e` as a literal. */
const pow2 = (e) => `0x1p${e}f`;

/** `C(d, k)` for `k = 0..=d`. */
function binomial(d) {
  const out = [];
  for (let k = 0; k <= d; k++) {
    let value = 1;
    for (let i = 0; i < k; i++) value = (value * (d - i)) / (i + 1);
    out.push(value);
  }
  return out;
}

/** `QUICK_FLOOR / (D-1)`, truncated toward zero as Rust's integer division is. */
const quickExponent = (floor, degree) => Math.trunc(floor / (degree - 1));

/**
 * The module for one kernel: `scheme` is "f32" or "ds", `degree` 2 to 6, `julia` a
 * boolean, `form` a guard name from `ds-wgsl.js`, and `workgroup` the threads per
 * workgroup. `smooth` is how the smooth fraction's logs and divisions are taken:
 * "builtin" is WGSL's `log` and `/`, which is what a production kernel would write and
 * which differs from the model by a few `f32` ulps (`wgsl.rs` on `log`); "exact" forms
 * each in double-single and rounds once, which is the correctly rounded `ln` and quotient
 * the model's CPU run computes, so that a pixel's whole state can be held bit for bit.
 * Entry points: `init`, `pass_all`, `pass_list`, `compact`, `args`.
 */
export function kernelSource({ scheme, degree, julia, form = "plain", workgroup = 64, smooth = "exact" }) {
  if (degree < 2 || degree > 6) throw new Error(`degree ${degree} is not one the kernel draws`);
  const guard = FORMS.find((f) => f.name === form);
  if (guard === undefined || !KERNEL_FORMS.includes(form)) throw new Error(`form ${form} cannot guard the kernel`);
  if (smooth !== "exact" && smooth !== "builtin") throw new Error(`smooth ${smooth} is not exact or builtin`);
  const ds = scheme === "ds";
  const lnBase = degree === 2 ? "LN_2" : hexf(Math.log(degree));
  const common = commonSource({ degree, workgroup, lnBase, ds, guard, smooth });
  const body = ds ? dsSource({ degree, julia }) : f32Source({ degree, julia });
  return common + body + entrySource({ workgroup });
}

/** `x` as a double-single literal, `vec2<f32>(hi, lo)`, from a JS double. */
function dsLiteral(x) {
  const high = Math.fround(x);
  return `vec2<f32>(${hexf(high)}, ${hexf(Math.fround(x - high))})`;
}

/** Terms of the atanh series `ln m = 2u(1 + u²/3 + u⁴/5 + ...)`: `|u|² <= 0.0295`, so 11. */
const ATANH_TERMS = 11;

function commonSource({ degree, workgroup, lnBase, ds, guard, smooth }) {
  return /* wgsl */ `
// Generated by kernel-wgsl.js: ${ds ? "double-single" : "f32"} kernel, degree ${degree}.

struct Frame {
  width_px: u32,
  height_px: u32,
  offset_m: vec2<f32>,
  spacing_m: f32,
  sc: i32,
  maxiter: u32,
  degree: u32,
  julia: u32,
  entry: u32,
  interior: u32,
  floor: i32,
  margins: vec4<i32>,
}

struct FrameLo {
  offset_lo: vec2<f32>,
  spacing_lo: f32,
  pad: u32,
  margins: vec4<i32>,
}

// Per run: the budget, the orbit's two uniforms, the pixel count, and the guard's knobs.
struct Params {
  budget: u32,
  periodic: u32,
  length: u32,
  count: u32,
  one: f32,
  zero: f32,
  uzero: u32,
  flag: u32,
}

const RUNNING: u32 = 0u;
const ESCAPED: u32 = 1u;
const CAPPED: u32 = 2u;

const BAILOUT_SQ: f32 = 4294967296.0f;
const LN_BAILOUT: f32 = ${hexf(11.090355)};
const LN_2: f32 = ${hexf(Math.LN2)};
const LN_BASE: f32 = ${lnBase};

const SCALE_FLOOR: f32 = ${pow2(-62)};
const UNSCALE_AT: i32 = -60;
const DRIFT: i32 = 32;
const REBASE_GATE: i32 = 60;
const REBASE_LIFT: i32 = 64;
const DELTA_FLOOR: i32 = -100;
const DC_HEADROOM: i32 = 100;
const NO_EXPONENT: i32 = -100000;
const ESCAPE_BIG: f32 = ${pow2(62)};
const DM1: i32 = ${degree - 1};

@group(0) @binding(0) var<uniform> frame: Frame;
${ds ? "@group(0) @binding(1) var<uniform> frame_lo: FrameLo;" : "// binding 1, frame_lo, is the double-single kernel's alone."}
@group(0) @binding(2) var<uniform> params: Params;
@group(0) @binding(3) var<storage, read> orbit: array<${ds ? "vec4<f32>" : "vec2<f32>"}>;
@group(0) @binding(4) var<storage, read_write> states: array<PixelState>;
// [0] pixels still running after a pass, [1] the compacted list's length, [2] delta steps
// the pass took over every pixel.
@group(0) @binding(5) var<storage, read_write> counters: array<atomic<u32>, 4>;
@group(0) @binding(6) var<storage, read_write> list: array<u32>;
// A group of its own: bound only for args(), never beside the dispatch that reads it.
@group(1) @binding(0) var<storage, read_write> indirect: array<u32, 4>;

var<workgroup> wg: array<f32, ${workgroup}>;
var<workgroup> wg_running: atomic<u32>;
var<workgroup> wg_steps: atomic<u32>;
// The guard's workgroup slot: this invocation's local index, set by every entry point.
var<private> slot: u32;
// The delta steps the last run() took, for the pass's count.
var<private> taken_steps: u32;

// ---- wgsl.rs: exponent reads and an exact ldexp, by integer arithmetic on the bits.

fn exponent_of(x: f32) -> i32 {
  return i32((bitcast<u32>(x) >> 23u) & 0xffu) - 127;
}

fn exponent_of_max(a: f32, b: f32) -> i32 {
  return i32(max(bitcast<u32>(a) & 0x7f800000u, bitcast<u32>(b) & 0x7f800000u) >> 23u) - 127;
}

fn ldexp_exact(x: f32, e: i32) -> f32 {
  let b = bitcast<u32>(x);
  let field = i32((b >> 23u) & 0xffu);
  if (field == 0) {
    return bitcast<f32>(b & 0x80000000u);
  }
  if (field == 255) {
    return x;
  }
  // The model saturates the add; no exponent here comes near an i32's range, and the
  // clamp keeps it total all the same.
  let moved = field + clamp(e, -1024, 1024);
  if (moved <= 0) {
    return bitcast<f32>(b & 0x80000000u);
  }
  if (moved >= 255) {
    return bitcast<f32>((b & 0x80000000u) | 0x7f800000u);
  }
  return bitcast<f32>((b & 0x807fffffu) | (u32(moved) << 23u));
}

fn ldexp2(d: vec2<f32>, e: i32) -> vec2<f32> {
  return vec2<f32>(ldexp_exact(d.x, e), ldexp_exact(d.y, e));
}

fn max_abs(a: f32, b: f32) -> f32 {
  return max(abs(a), abs(b));
}

fn reaches(v: vec2<f32>, t: f32) -> bool {
  return abs(v.x) >= t || abs(v.y) >= t;
}

${dsOpsSource(guard)}
${smooth === "exact" ? exactSmoothSource() : builtinSmoothSource()}

// The pixel's offset from the reference, f32 half: (col + 0.5 - W/2, H/2 - row - 0.5).
fn across_of(col: u32) -> f32 {
  return f32(col) + 0.5f - f32(frame.width_px) * 0.5f;
}

fn down_of(row: u32) -> f32 {
  return f32(frame.height_px) * 0.5f - (f32(row) + 0.5f);
}
`;
}

// ---- The f32 kernel: model.rs with HILO false.

function f32Source({ degree, julia }) {
  const D = degree;
  const b = binomial(D);
  const quick = pow2(quickExponent(-90, D));
  const lit = (x) => `${x}.0f`;
  let factor;
  if (D === 2) {
    factor = `  return vec2<f32>(p.x + p.x + t.x, p.y + p.y + t.y);`;
  } else {
    const lines = [`  let pw1 = p;`];
    for (let j = 2; j < D; j++) {
      lines.push(
        `  let pw${j} = vec2<f32>(pw${j - 1}.x * p.x - pw${j - 1}.y * p.y, pw${j - 1}.x * p.y + pw${j - 1}.y * p.x);`,
      );
    }
    lines.push(`  var pr = t.x + ${lit(b[D - 1])} * p.x;`);
    lines.push(`  var pi = t.y + ${lit(b[D - 1])} * p.y;`);
    for (let k = D - 2; k >= 1; k--) {
      lines.push(`  {`);
      lines.push(`    let tr = pr * t.x - pi * t.y;`);
      lines.push(`    let ti = pr * t.y + pi * t.x;`);
      lines.push(`    pr = tr + ${lit(b[k])} * pw${D - k}.x;`);
      lines.push(`    pi = ti + ${lit(b[k])} * pw${D - k}.y;`);
      lines.push(`  }`);
    }
    lines.push(`  return vec2<f32>(pr, pi);`);
    factor = lines.join("\n");
  }
  return /* wgsl */ `
// ---- model.rs, the f32 kernel on the F32Pair orbit (${julia ? "Julia" : "parameter plane"}).

struct PixelState {
  d: vec2<f32>,
  s: i32,
  m: u32,
  n: u32,
  status: u32,
  frac: f32,
  dz_mantissa: f32,
  dz_exponent: i32,
  rebases: u32,
  steps: u32,
  scaled: u32,
}

struct Delta {
  d: vec2<f32>,
  s: i32,
}

struct Scale {
  dc: vec2<f32>,
  dc_fits: bool,
  k: f32,
}

const QUICK_FLOOR: i32 = -90;
const DELTA_BESIDE: i32 = 30;
const PRODUCT_SIZE: f32 = ${pow2(-100)};
const QUICK_SIZE: f32 = ${quick};
const K_FLOOR: i32 = -93;

fn dc_mantissa(col: u32, row: u32) -> vec2<f32> {
  let across = across_of(col);
  let down = down_of(row);
  let re = across * frame.spacing_m;
  let im = down * frame.spacing_m;
  return vec2<f32>(frame.offset_m.x + re, frame.offset_m.y + im);
}

fn scale_of(dc_m: vec2<f32>, sc: i32, s: i32) -> Scale {
  var out: Scale;
  out.dc_fits = sc - s <= DC_HEADROOM;
  out.dc = vec2<f32>(0.0f, 0.0f);
  if (out.dc_fits) {
    out.dc = ldexp2(dc_m, sc - s);
  }
  out.k = 0.0f;
  if (s >= K_FLOOR) {
    out.k = ldexp_exact(1.0f, s);
  }
  return out;
}

fn delta_at_step(d: vec2<f32>, s: i32, scale: Scale) -> vec2<f32> {
  if (s >= K_FLOOR) {
    return vec2<f32>(d.x * scale.k, d.y * scale.k);
  }
  return ldexp2(d, s);
}

fn settle(d: vec2<f32>, e: i32) -> Delta {
  let x = exponent_of(max_abs(d.x, d.y));
  if (x == -127) {
    return Delta(ldexp2(d, 0), 0);
  }
  if (x + e >= UNSCALE_AT) {
    return Delta(ldexp2(d, e), 0);
  }
  return Delta(ldexp2(d, -x), e + x);
}

fn renormalize(d: vec2<f32>, s: i32) -> Delta {
  if (s == 0) {
    if (abs(d.x) >= SCALE_FLOOR || abs(d.y) >= SCALE_FLOOR) {
      return Delta(d, 0);
    }
    return settle(d, 0);
  }
  let e = exponent_of(max_abs(d.x, d.y));
  if (e == -127) {
    return Delta(ldexp2(d, 0), s);
  }
  if (e + s >= UNSCALE_AT) {
    return Delta(ldexp2(d, s), 0);
  }
  if (e < -DRIFT || e > DRIFT) {
    return Delta(ldexp2(d, -e), s + e);
  }
  return Delta(d, s);
}

fn cmul(a: vec2<f32>, b: vec2<f32>) -> vec2<f32> {
  return vec2<f32>(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x);
}

// F with d' = F * d (+ dc): Horner's form over the powers of Z.
fn factor(p: vec2<f32>, t: vec2<f32>) -> vec2<f32> {
${factor}
}

fn careful_step(p: vec2<f32>, d: vec2<f32>, s: i32, dc_m: vec2<f32>, dc_e: i32, sc: i32) -> Delta {
  let ez = exponent_of_max(p.x, p.y);
  let ed = s + exponent_of_max(d.x, d.y);
  let v = select(ed, ez, ez > ed);
  let zv = ldexp2(p, -v);
  let f = factor(zv, ldexp2(d, s - v));
  let ef = exponent_of_max(f.x, f.y);
  let g = cmul(ldexp2(f, -ef), d);
  let ge = DM1 * v + ef + s;
  var gx = NO_EXPONENT;
  let gxe = exponent_of_max(g.x, g.y);
  if (gxe != -127) {
    gx = ge + gxe;
  }
  let at = select(dc_e, gx, gx > dc_e);
  if (at == NO_EXPONENT) {
    return Delta(vec2<f32>(0.0f, 0.0f), s);
  }
  var sum = ldexp2(g, ge - at);
${julia ? "" : "  let c = ldexp2(dc_m, sc - at);\n  sum = vec2<f32>(sum.x + c.x, sum.y + c.y);"}
  return settle(sum, at);
}

fn init_state(i: u32) -> PixelState {
  var st: PixelState;
  st.d = vec2<f32>(0.0f, 0.0f);
  st.s = 0;
  st.m = 0u;
${julia ? `  let col = i % frame.width_px;
  let row = i / frame.width_px;
  let start = settle(dc_mantissa(col, row), frame.sc);
  st.d = start.d;
  st.s = start.s;
  st.m = frame.entry;` : ""}
  st.n = 0u;
  st.status = RUNNING;
  st.frac = 0.0f;
  st.dz_mantissa = 1.0f;
  st.dz_exponent = 0;
  st.rebases = 0u;
  st.steps = 0u;
  st.scaled = 0u;
  return st;
}

// One pixel, at most budget delta steps; true while it is still running.
fn run(i: u32, budget: u32) -> bool {
  taken_steps = 0u;
  var st = states[i];
  if (st.status != RUNNING || budget == 0u) {
    return false;
  }
  let col = i % frame.width_px;
  let row = i / frame.width_px;
  let periodic = params.periodic != 0u;
  let length = params.length;
  let last = length - 1u;
  let maxiter = frame.maxiter;
  let sc = frame.sc;
  let dc_m = dc_mantissa(col, row);
  var dc_e = NO_EXPONENT;
${julia ? "" : `  let dce = exponent_of(max_abs(dc_m.x, dc_m.y));
  if (dce != -127) {
    dc_e = sc + dce;
  }`}

  var d = st.d;
  var s = st.s;
  var scale = scale_of(dc_m, sc, s);
  var m = st.m;
  var n = st.n;
  var rebases = st.rebases;
  var steps = st.steps;
  var scaled = st.scaled;
  var status = RUNNING;
  var frac = st.frac;
  var taken = 0u;

  loop {
    if (taken >= budget) {
      break;
    }
    // ---- step: d' = F(Z[m], delta) * d (+ dc), in the delta's units.
    let s0 = s;
    let p = orbit[m];
    var gate: bool;
    if (s == 0) {
      gate = reaches(p, QUICK_SIZE) || reaches(d, QUICK_SIZE);
    } else {
      let em = exponent_of_max(d.x, d.y);
      let ez = exponent_of_max(p.x, p.y);
      let ed = s + em;
      let v = select(ed, ez, ez > ed);
      gate = DM1 * v >= QUICK_FLOOR && (ed >= DELTA_FLOOR || ez >= ed + DELTA_BESIDE);
    }
${julia ? "" : "    gate = gate && scale.dc_fits;"}
    let product = cmul(factor(p, delta_at_step(d, s, scale)), d);
${julia ? "    let next = product;" : "    let next = vec2<f32>(product.x + scale.dc.x, product.y + scale.dc.y);"}
    if (gate && reaches(product, PRODUCT_SIZE)) {
      d = next;
    } else {
      let r = careful_step(p, d, s, dc_m, dc_e, sc);
      d = r.d;
      if (r.s != s) {
        s = r.s;
        scale = scale_of(dc_m, sc, s);
      }
    }
    taken += 1u;
    steps += 1u;
    if (s0 != 0) {
      scaled += 1u;
    }
    m += 1u;
    n += 1u;
    if (periodic && m >= length) {
      m = 0u;
    }

    // ---- reconstruct and escape.
    let q = orbit[m];
    var z: vec2<f32>;
    if (s != 0 && exponent_of_max(q.x, q.y) <= REBASE_GATE + s) {
      let zq = ldexp2(q, -s);
      let zs = vec2<f32>(zq.x + d.x, zq.y + d.y);
      z = ldexp2(zs, s);
    } else {
      let t = delta_at_step(d, s, scale);
      z = vec2<f32>(q.x + t.x, q.y + t.y);
    }
    let big = reaches(z, ESCAPE_BIG);
    var z_norm_sq = BAILOUT_SQ;
    if (!big) {
      z_norm_sq = z.x * z.x + z.y * z.y;
    }
    if (big || z_norm_sq > BAILOUT_SQ) {
      frac = smooth_fraction(z, z_norm_sq, big);
      status = ESCAPED;
      break;
    }

    // ---- cap.
    if (n >= maxiter) {
      status = CAPPED;
      break;
    }

    // ---- renormalize, then rebase.
    let rn = renormalize(d, s);
    d = rn.d;
    if (rn.s != s) {
      s = rn.s;
      scale = scale_of(dc_m, sc, s);
    }
    let exhausted = !periodic && m >= last;
    var rebase = false;
    var rd = vec2<f32>(0.0f, 0.0f);
    var rs = 0;
    if (s == 0) {
      let delta_norm_sq = d.x * d.x + d.y * d.y;
      if (z_norm_sq < delta_norm_sq || exhausted) {
        rebase = true;
        if (reaches(z, SCALE_FLOOR)) {
          rd = z;
          rs = 0;
        } else {
          let lq = ldexp2(q, REBASE_LIFT);
          let ld = ldexp2(d, REBASE_LIFT);
          rd = vec2<f32>(lq.x + ld.x, lq.y + ld.y);
          rs = -REBASE_LIFT;
        }
      }
    } else {
      if (exponent_of(max_abs(q.x, q.y)) <= REBASE_GATE + s) {
        let zq = ldexp2(q, -s);
        let zs = vec2<f32>(zq.x + d.x, zq.y + d.y);
        let zs_norm_sq = zs.x * zs.x + zs.y * zs.y;
        let delta_norm_sq = d.x * d.x + d.y * d.y;
        if (zs_norm_sq < delta_norm_sq || exhausted) {
          rebase = true;
          rd = zs;
          rs = s;
        }
      } else if (exhausted) {
        rebase = true;
        rd = z;
        rs = 0;
      }
    }
    if (rebase) {
      let r2 = renormalize(rd, rs);
      d = r2.d;
      if (r2.s != s) {
        s = r2.s;
        scale = scale_of(dc_m, sc, s);
      }
      m = 0u;
      rebases += 1u;
    }
  }

  st.d = d;
  st.s = s;
  st.m = m;
  st.n = n;
  st.status = status;
  st.frac = frac;
  st.rebases = rebases;
  st.steps = steps;
  st.scaled = scaled;
  states[i] = st;
  taken_steps = taken;
  return status == RUNNING;
}
`;
}

// ---- The guard and ds.rs's arithmetic, shared: the double-single kernel runs on them,
// and so does either kernel's exact smooth fraction.

function dsOpsSource(guard) {
  return /* wgsl */ `
// A complex double-single: each component a vec2, .x the high part.
struct Cds {
  re: vec2<f32>,
  im: vec2<f32>,
}

// The guard. Form: ${guard.name} (${guard.note}).
fn G(x: f32) -> f32 {
  ${guard.body.replaceAll("knobs.", "params.")}
}

// ---- ds.rs: the error-free transforms and the pair arithmetic built on them.

fn two_sum(a: f32, b: f32) -> vec2<f32> {
  let s = G(a + b);
  let bb = G(s - a);
  let err = G(G(a - G(s - bb)) + G(b - bb));
  return vec2<f32>(s, err);
}

fn quick_two_sum(a: f32, b: f32) -> vec2<f32> {
  let s = G(a + b);
  let err = G(b - G(s - a));
  return vec2<f32>(s, err);
}

fn split(a: f32) -> vec2<f32> {
  let c = G(4097.0f * a);
  let high = G(c - G(c - a));
  let low = G(a - high);
  return vec2<f32>(high, low);
}

fn two_prod(a: f32, b: f32) -> vec2<f32> {
  let p = G(a * b);
  let x = split(a);
  let y = split(b);
  let err = G(G(G(G(G(x.x * y.x) - p) + G(x.x * y.y)) + G(x.y * y.x)) + G(x.y * y.y));
  return vec2<f32>(p, err);
}

fn two_sqr(a: f32) -> vec2<f32> {
  let p = G(a * a);
  let x = split(a);
  let hl = G(x.x * x.y);
  let err = G(G(G(G(x.x * x.x) - p) + G(hl + hl)) + G(x.y * x.y));
  return vec2<f32>(p, err);
}

fn ds_add(a: vec2<f32>, b: vec2<f32>) -> vec2<f32> {
  var se = two_sum(a.x, b.x);
  let tf = two_sum(a.y, b.y);
  var e = G(se.y + tf.x);
  se = quick_two_sum(se.x, e);
  e = G(se.y + tf.y);
  return quick_two_sum(se.x, e);
}

fn ds_sub(a: vec2<f32>, b: vec2<f32>) -> vec2<f32> {
  return ds_add(a, vec2<f32>(-b.x, -b.y));
}

fn ds_mul(a: vec2<f32>, b: vec2<f32>) -> vec2<f32> {
  let pe = two_prod(a.x, b.x);
  let e = G(pe.y + G(G(a.x * b.y) + G(a.y * b.x)));
  return quick_two_sum(pe.x, e);
}

fn ds_sqr(a: vec2<f32>) -> vec2<f32> {
  let pe = two_sqr(a.x);
  let c = G(a.x * a.y);
  let e = G(pe.y + G(c + c));
  return quick_two_sum(pe.x, e);
}

fn ds_mul_f32(a: vec2<f32>, b: f32) -> vec2<f32> {
  let pe = two_prod(a.x, b);
  let e = G(pe.y + G(a.y * b));
  return quick_two_sum(pe.x, e);
}

fn ds_double(a: vec2<f32>) -> vec2<f32> {
  return vec2<f32>(G(a.x + a.x), G(a.y + a.y));
}

fn c_add(a: Cds, b: Cds) -> Cds {
  return Cds(ds_add(a.re, b.re), ds_add(a.im, b.im));
}

fn c_mul(a: Cds, b: Cds) -> Cds {
  return Cds(ds_sub(ds_mul(a.re, b.re), ds_mul(a.im, b.im)), ds_add(ds_mul(a.re, b.im), ds_mul(a.im, b.re)));
}

fn c_sqr(a: Cds) -> Cds {
  return Cds(ds_sub(ds_sqr(a.re), ds_sqr(a.im)), ds_double(ds_mul(a.re, a.im)));
}

fn c_scale(a: Cds, s: f32) -> Cds {
  return Cds(ds_mul_f32(a.re, s), ds_mul_f32(a.im, s));
}

`;
}
// ---- The smooth fraction, model.rs's smooth_fraction from z (z_hi in double-single).

function builtinSmoothSource() {
  return /* wgsl */ `
// The smooth fraction with WGSL's log and division, as a production kernel writes it.
fn smooth_fraction(z: vec2<f32>, z_norm_sq: f32, big: bool) -> f32 {
  var ln_sq: f32;
  if (big) {
    let e = exponent_of(max_abs(z.x, z.y));
    let a = ldexp_exact(z.x, -e);
    let b = ldexp_exact(z.y, -e);
    ln_sq = log(a * a + b * b) + f32(2 * e) * LN_2;
  } else {
    ln_sq = log(z_norm_sq);
  }
  let overshoot = 0.5f * ln_sq / LN_BAILOUT;
  return 1.0f - log(overshoot) / LN_BASE;
}
`;
}

function exactSmoothSource() {
  let series = `  var acc = ${dsLiteral(1 / (2 * ATANH_TERMS - 1))};\n`;
  for (let k = ATANH_TERMS - 2; k >= 0; k--) series += `  acc = ds_add(ds_mul(acc, u2), ${dsLiteral(1 / (2 * k + 1))});\n`;
  return /* wgsl */ `
// The smooth fraction with each log and division formed in double-single and rounded
// once: the correctly rounded results the model's CPU run takes, bar a quotient or a log
// within about 2^-44 of a rounding boundary.

// a / b in double-single: a first quotient, then two corrections from exact residuals.
fn ds_div(a: vec2<f32>, b: vec2<f32>) -> vec2<f32> {
  let q1 = a.x / b.x;
  let r1 = ds_sub(a, ds_mul_f32(b, q1));
  let q2 = r1.x / b.x;
  let r2 = ds_sub(r1, ds_mul_f32(b, q2));
  let q3 = r2.x / b.x;
  return ds_add(quick_two_sum(q1, q2), vec2<f32>(q3, 0.0f));
}

fn div_exact(a: f32, b: f32) -> f32 {
  return ds_div(vec2<f32>(a, 0.0f), vec2<f32>(b, 0.0f)).x;
}

// ln x for a positive normal x: x = m 2^e with m in [sqrt(1/2), sqrt(2)], and
// ln m = 2 atanh(u), u = (m - 1) / (m + 1), by its series in u^2 <= 0.0295.
fn ln_exact(x: f32) -> f32 {
  var e = exponent_of(x);
  var m = ldexp_exact(x, -e);
  if (m > ${hexf(Math.SQRT2)}) {
    m = ldexp_exact(m, -1);
    e = e + 1;
  }
  // m - 1 is exact (Sterbenz), and m + 1 is a two-sum.
  let u = ds_div(vec2<f32>(G(m - 1.0f), 0.0f), two_sum(m, 1.0f));
  let u2 = ds_sqr(u);
${series}  let ln_m = ds_mul(ds_double(u), acc);
  return ds_add(ds_mul_f32(${dsLiteral(Math.LN2)}, f32(e)), ln_m).x;
}

fn smooth_fraction(z: vec2<f32>, z_norm_sq: f32, big: bool) -> f32 {
  var ln_sq: f32;
  if (big) {
    let e = exponent_of(max_abs(z.x, z.y));
    let a = ldexp_exact(z.x, -e);
    let b = ldexp_exact(z.y, -e);
    ln_sq = G(ln_exact(G(G(a * a) + G(b * b))) + G(f32(2 * e) * LN_2));
  } else {
    ln_sq = ln_exact(z_norm_sq);
  }
  let overshoot = div_exact(G(0.5f * ln_sq), LN_BAILOUT);
  return G(1.0f - div_exact(ln_exact(overshoot), LN_BASE));
}
`;
}

// ---- The double-single kernel: model_ds.rs.

function dsSource({ degree, julia }) {
  const D = degree;
  const b = binomial(D);
  const quick = pow2(quickExponent(-64, D));
  const lit = (x) => `${x}.0f`;
  let factor;
  if (D === 2) {
    factor = `  return c_add(Cds(ds_double(z.re), ds_double(z.im)), t);`;
  } else {
    const lines = [`  let pw1 = z;`, `  let pw2 = c_sqr(z);`];
    for (let j = 3; j < D; j++) lines.push(`  let pw${j} = c_mul(pw${j - 1}, z);`);
    lines.push(`  var p = c_add(c_scale(z, ${lit(b[D - 1])}), t);`);
    for (let k = D - 2; k >= 1; k--) lines.push(`  p = c_add(c_mul(p, t), c_scale(pw${D - k}, ${lit(b[k])}));`);
    lines.push(`  return p;`);
    factor = lines.join("\n");
  }
  return /* wgsl */ `
// ---- model_ds.rs, the double-single kernel on the HiLo orbit (${julia ? "Julia" : "parameter plane"}).

struct PixelState {
  d_hi: vec2<f32>,
  d_lo: vec2<f32>,
  s: i32,
  m: u32,
  n: u32,
  status: u32,
  frac: f32,
  dz_mantissa: f32,
  dz_exponent: i32,
  rebases: u32,
  steps: u32,
  scaled: u32,
}

struct DeltaDs {
  d: Cds,
  s: i32,
}

struct ScaleDs {
  dc: Cds,
  dc_fits: bool,
}

const QUICK_FLOOR_DS: i32 = -64;
const DELTA_BESIDE_DS: i32 = 50;
const PRODUCT_SIZE_DS: f32 = ${pow2(-76)};
const QUICK_SIZE: f32 = ${quick};

// ---- model_ds.rs.

const ZERO: Cds = Cds(vec2<f32>(0.0f, 0.0f), vec2<f32>(0.0f, 0.0f));

fn hi(v: Cds) -> vec2<f32> {
  return vec2<f32>(v.re.x, v.im.x);
}

fn ldexp_c(v: Cds, e: i32) -> Cds {
  return Cds(ldexp2(v.re, e), ldexp2(v.im, e));
}

// Z[m] as a pair, out of the vec4 point [re_hi, im_hi, re_lo, im_lo].
fn reference(p: vec4<f32>) -> Cds {
  return Cds(vec2<f32>(p.x, p.z), vec2<f32>(p.y, p.w));
}

fn dc_ds(col: u32, row: u32) -> Cds {
  let across = across_of(col);
  let down = down_of(row);
  let spacing = vec2<f32>(frame.spacing_m, frame_lo.spacing_lo);
  let re = ds_mul_f32(spacing, across);
  let im = ds_mul_f32(spacing, down);
  return Cds(
    ds_add(vec2<f32>(frame.offset_m.x, frame_lo.offset_lo.x), re),
    ds_add(vec2<f32>(frame.offset_m.y, frame_lo.offset_lo.y), im),
  );
}

fn scale_of(dc: Cds, sc: i32, s: i32) -> ScaleDs {
  var out: ScaleDs;
  out.dc_fits = sc - s <= DC_HEADROOM;
  out.dc = ZERO;
  if (out.dc_fits) {
    out.dc = ldexp_c(dc, sc - s);
  }
  return out;
}

fn settle(d: Cds, e: i32) -> DeltaDs {
  let x = exponent_of(max_abs(d.re.x, d.im.x));
  if (x == -127) {
    return DeltaDs(ldexp_c(d, 0), 0);
  }
  if (x + e >= UNSCALE_AT) {
    return DeltaDs(ldexp_c(d, e), 0);
  }
  return DeltaDs(ldexp_c(d, -x), e + x);
}

fn renormalize(d: Cds, s: i32) -> DeltaDs {
  if (s == 0) {
    if (abs(d.re.x) >= SCALE_FLOOR || abs(d.im.x) >= SCALE_FLOOR) {
      return DeltaDs(d, 0);
    }
    return settle(d, 0);
  }
  let e = exponent_of(max_abs(d.re.x, d.im.x));
  if (e == -127) {
    return DeltaDs(ldexp_c(d, 0), s);
  }
  if (e + s >= UNSCALE_AT) {
    return DeltaDs(ldexp_c(d, s), 0);
  }
  if (e < -DRIFT || e > DRIFT) {
    return DeltaDs(ldexp_c(d, -e), s + e);
  }
  return DeltaDs(d, s);
}

// F with d' = F * d (+ dc), in double-single.
fn factor(z: Cds, t: Cds) -> Cds {
${factor}
}

fn careful_step(z: Cds, d: Cds, s: i32, dc: Cds, dc_e: i32, sc: i32) -> DeltaDs {
  let ez = exponent_of_max(z.re.x, z.im.x);
  let ed = s + exponent_of_max(d.re.x, d.im.x);
  let v = select(ed, ez, ez > ed);
  let f = factor(ldexp_c(z, -v), ldexp_c(d, s - v));
  let ef = exponent_of_max(f.re.x, f.im.x);
  let g = c_mul(ldexp_c(f, -ef), d);
  let ge = DM1 * v + ef + s;
  var gx = NO_EXPONENT;
  let gxe = exponent_of_max(g.re.x, g.im.x);
  if (gxe != -127) {
    gx = ge + gxe;
  }
  let at = select(dc_e, gx, gx > dc_e);
  if (at == NO_EXPONENT) {
    return DeltaDs(ZERO, s);
  }
  var sum = ldexp_c(g, ge - at);
${julia ? "" : "  sum = c_add(sum, ldexp_c(dc, sc - at));"}
  return settle(sum, at);
}

fn init_state(i: u32) -> PixelState {
  var st: PixelState;
  st.d_hi = vec2<f32>(0.0f, 0.0f);
  st.d_lo = vec2<f32>(0.0f, 0.0f);
  st.s = 0;
  st.m = 0u;
${julia ? `  let col = i % frame.width_px;
  let row = i / frame.width_px;
  let start = settle(dc_ds(col, row), frame.sc);
  st.d_hi = hi(start.d);
  st.d_lo = vec2<f32>(start.d.re.y, start.d.im.y);
  st.s = start.s;
  st.m = frame.entry;` : ""}
  st.n = 0u;
  st.status = RUNNING;
  st.frac = 0.0f;
  st.dz_mantissa = 1.0f;
  st.dz_exponent = 0;
  st.rebases = 0u;
  st.steps = 0u;
  st.scaled = 0u;
  return st;
}

fn run(i: u32, budget: u32) -> bool {
  taken_steps = 0u;
  var st = states[i];
  if (st.status != RUNNING || budget == 0u) {
    return false;
  }
  let col = i % frame.width_px;
  let row = i / frame.width_px;
  let periodic = params.periodic != 0u;
  let length = params.length;
  let last = length - 1u;
  let maxiter = frame.maxiter;
  let sc = frame.sc;
  let dc = dc_ds(col, row);
  var dc_e = NO_EXPONENT;
${julia ? "" : `  let dce = exponent_of(max_abs(dc.re.x, dc.im.x));
  if (dce != -127) {
    dc_e = sc + dce;
  }`}

  var d = Cds(vec2<f32>(st.d_hi.x, st.d_lo.x), vec2<f32>(st.d_hi.y, st.d_lo.y));
  var s = st.s;
  var scale = scale_of(dc, sc, s);
  var m = st.m;
  var n = st.n;
  var rebases = st.rebases;
  var steps = st.steps;
  var scaled = st.scaled;
  var status = RUNNING;
  var frac = st.frac;
  var taken = 0u;

  loop {
    if (taken >= budget) {
      break;
    }
    // ---- step: d' = F(Z[m], delta) * d (+ dc), in the delta's units.
    let s0 = s;
    let p = orbit[m];
    let zr = reference(p);
    var gate: bool;
    if (s == 0) {
      gate = reaches(p.xy, QUICK_SIZE) || reaches(hi(d), QUICK_SIZE);
    } else {
      let em = exponent_of_max(d.re.x, d.im.x);
      let ez = exponent_of_max(p.x, p.y);
      let ed = s + em;
      let v = select(ed, ez, ez > ed);
      gate = DM1 * v >= QUICK_FLOOR_DS && (ed >= DELTA_FLOOR || ez >= ed + DELTA_BESIDE_DS);
    }
${julia ? "" : "    gate = gate && scale.dc_fits;"}
    let product = c_mul(factor(zr, ldexp_c(d, s)), d);
${julia ? "    let next = product;" : "    let next = c_add(product, scale.dc);"}
    if (gate && reaches(hi(product), PRODUCT_SIZE_DS)) {
      d = next;
    } else {
      let r = careful_step(zr, d, s, dc, dc_e, sc);
      d = r.d;
      if (r.s != s) {
        s = r.s;
        scale = scale_of(dc, sc, s);
      }
    }
    taken += 1u;
    steps += 1u;
    if (s0 != 0) {
      scaled += 1u;
    }
    m += 1u;
    n += 1u;
    if (periodic && m >= length) {
      m = 0u;
    }

    // ---- reconstruct and escape: z the pair, the tests on its high parts.
    let q = orbit[m];
    let zq = reference(q);
    var z: Cds;
    if (s != 0 && exponent_of_max(q.x, q.y) <= REBASE_GATE + s) {
      let zs = c_add(ldexp_c(zq, -s), d);
      z = ldexp_c(zs, s);
    } else {
      z = c_add(zq, ldexp_c(d, s));
    }
    let z_hi = hi(z);
    let big = reaches(z_hi, ESCAPE_BIG);
    var z_norm_sq = BAILOUT_SQ;
    if (!big) {
      z_norm_sq = z_hi.x * z_hi.x + z_hi.y * z_hi.y;
    }
    if (big || z_norm_sq > BAILOUT_SQ) {
      frac = smooth_fraction(z_hi, z_norm_sq, big);
      status = ESCAPED;
      break;
    }

    // ---- cap.
    if (n >= maxiter) {
      status = CAPPED;
      break;
    }

    // ---- renormalize, then rebase; the compares read hi, the rebased delta is the pair.
    let rn = renormalize(d, s);
    d = rn.d;
    if (rn.s != s) {
      s = rn.s;
      scale = scale_of(dc, sc, s);
    }
    let exhausted = !periodic && m >= last;
    var rebase = false;
    var rd = ZERO;
    var rs = 0;
    let d_hi = hi(d);
    if (s == 0) {
      let delta_norm_sq = d_hi.x * d_hi.x + d_hi.y * d_hi.y;
      if (z_norm_sq < delta_norm_sq || exhausted) {
        rebase = true;
        if (reaches(z_hi, SCALE_FLOOR)) {
          rd = z;
          rs = 0;
        } else {
          rd = c_add(ldexp_c(zq, REBASE_LIFT), ldexp_c(d, REBASE_LIFT));
          rs = -REBASE_LIFT;
        }
      }
    } else if (exponent_of(max_abs(q.x, q.y)) <= REBASE_GATE + s) {
      let zs = c_add(ldexp_c(zq, -s), d);
      let zs_hi = hi(zs);
      let zs_norm_sq = zs_hi.x * zs_hi.x + zs_hi.y * zs_hi.y;
      let delta_norm_sq = d_hi.x * d_hi.x + d_hi.y * d_hi.y;
      if (zs_norm_sq < delta_norm_sq || exhausted) {
        rebase = true;
        rd = zs;
        rs = s;
      }
    } else if (exhausted) {
      rebase = true;
      rd = z;
      rs = 0;
    }
    if (rebase) {
      let r2 = renormalize(rd, rs);
      d = r2.d;
      if (r2.s != s) {
        s = r2.s;
        scale = scale_of(dc, sc, s);
      }
      m = 0u;
      rebases += 1u;
    }
  }

  st.d_hi = hi(d);
  st.d_lo = vec2<f32>(d.re.y, d.im.y);
  st.s = s;
  st.m = m;
  st.n = n;
  st.status = status;
  st.frac = frac;
  st.rebases = rebases;
  st.steps = steps;
  st.scaled = scaled;
  states[i] = st;
  taken_steps = taken;
  return status == RUNNING;
}
`;
}

// ---- Entry points, the same for both kernels.

function entrySource({ workgroup }) {
  return /* wgsl */ `
// ---- Entry points.

@compute @workgroup_size(${workgroup})
fn init(@builtin(global_invocation_id) gid: vec3<u32>,
        @builtin(local_invocation_index) lid: u32) {
  slot = lid;
  if (gid.x < params.count) {
    states[gid.x] = init_state(gid.x);
  }
}

// Every pixel, one invocation each; the running and step counts are summed per workgroup
// first.
@compute @workgroup_size(${workgroup})
fn pass_all(@builtin(global_invocation_id) gid: vec3<u32>,
            @builtin(local_invocation_index) lid: u32) {
  slot = lid;
  var still = false;
  if (gid.x < params.count) {
    still = run(gid.x, params.budget);
  }
  if (still) {
    atomicAdd(&wg_running, 1u);
  }
  if (taken_steps > 0u) {
    atomicAdd(&wg_steps, taken_steps);
  }
  workgroupBarrier();
  if (lid == 0u) {
    let c = atomicLoad(&wg_running);
    if (c > 0u) {
      atomicAdd(&counters[0], c);
    }
    let t = atomicLoad(&wg_steps);
    if (t > 0u) {
      atomicAdd(&counters[2], t);
    }
  }
}

// The pixels the last compact pass listed, dispatched indirectly.
@compute @workgroup_size(${workgroup})
fn pass_list(@builtin(global_invocation_id) gid: vec3<u32>,
             @builtin(local_invocation_index) lid: u32) {
  slot = lid;
  var still = false;
  if (gid.x < atomicLoad(&counters[1])) {
    still = run(list[gid.x], params.budget);
  }
  if (still) {
    atomicAdd(&wg_running, 1u);
  }
  if (taken_steps > 0u) {
    atomicAdd(&wg_steps, taken_steps);
  }
  workgroupBarrier();
  if (lid == 0u) {
    let c = atomicLoad(&wg_running);
    if (c > 0u) {
      atomicAdd(&counters[0], c);
    }
    let t = atomicLoad(&wg_steps);
    if (t > 0u) {
      atomicAdd(&counters[2], t);
    }
  }
}

@compute @workgroup_size(${workgroup})
fn compact(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i < params.count && states[i].status == RUNNING) {
    let k = atomicAdd(&counters[1], 1u);
    list[k] = i;
  }
}

@compute @workgroup_size(1)
fn args() {
  let c = atomicLoad(&counters[1]);
  indirect[0] = (c + ${workgroup - 1}u) / ${workgroup}u;
  indirect[1] = 1u;
  indirect[2] = 1u;
}
`;
}
