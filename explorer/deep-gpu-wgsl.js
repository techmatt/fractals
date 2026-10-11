// The Deep tab's per-pixel loop in WGSL: `explorer/deep-gpu-model`'s double-single kernel
// (`model_ds.rs`, on the `HiLo` orbit) with its interior gate and proof (`proof.rs`),
// ported line for line, one module per degree and plane. No skip table.
//
// Every order of operations, constant, regime switch, integer exponent test and proof
// margin is the model's, and the model's helpers are written out the way `wgsl.rs` says
// WGSL spells them. What a pixel carries between passes is the model's `DsPixelState`, 128
// bytes with the proof (56 without it), so any sequence of pass budgets leaves exactly the
// state one unbounded pass does, which is what lets a caller size passes by time without
// moving a pixel.
//
// Every double-single error-free transform routes each arithmetic result through `G`, a
// guard compiled in one of several forms (`FORMS`); which form survives an adapter's
// shader compilers is what the primitive self-test (`selfTestSource`) answers. The proof's
// magnitude arithmetic goes through `G` as well, so a device that needs a form gets it
// there too, and its square root is corrected to the correctly rounded one the model takes
// (`sqrt_rn`), so that the proof's words, and with them the step a sample is proved
// interior at, are the model's bit for bit. A device that flushes subnormals can still leave `d_lo` an ulp or two from
// the model near the quick path's `2^-76` gate (`model_ds.rs`, on the gate); that is an
// accuracy bound and not a defect, and a frame a self-test holds bit for bit must be one
// that provokes no flush (`deep-gpu-model`'s `export --ftz-check`).
//
// This module is text and numbers only: no device, no buffers. `explorer/bench/gpu-probe/`
// compiles its double-single kernel from here, so there is one kernel text with two
// callers.

/** Pixel status, `model.rs`'s codes. */
export const RUNNING = 0;
export const ESCAPED = 1;
export const CAPPED = 2;
export const INTERIOR = 3;
export const GATED = 4;

/**
 * `Frame.interior`, the gated policy (`frame.rs`'s `GatedPolicy`): 0 is the switch off;
 * `cap` runs a gated sample the proof never closes on to the cap and ends it `CAPPED`;
 * `flag` ends it `GATED` there; `handoff` ends it `GATED` as soon as its discs are spent.
 */
export const POLICY = { off: 0, cap: 1, flag: 2, handoff: 3 };

/** Uniform and buffer element sizes, in bytes. */
export const FRAME_BYTES = 64;
export const FRAME_LO_BYTES = 32;
export const PARAMS_BYTES = 48;
export const ORBIT_POINT_BYTES = 16;
export const COUNTERS_BYTES = 16;
export const OUT_BYTES = 8;

/** Bytes a pixel's state takes: with the interior proof compiled in, and without. */
export const stateBytes = (interior) => (interior ? 128 : 56);

/** The state's words, in order: `DsPixelState::bits`, then the proof's `Proof::bits`. */
export const STATE_NAMES = [
  "d_hi.re", "d_hi.im", "d_lo.re", "d_lo.im", "s", "m", "n", "status", "frac", "dz_mantissa", "dz_exponent", "rebases", "steps", "scaled",
];
export const PROOF_NAMES = [
  "radius0.m", "radius0.e", "radius1.m", "radius1.e", "radius2.m", "radius2.e", "radius3.m", "radius3.e",
  "center.re", "center.im", "center_e", "from.m", "from.e", "delta.m", "delta.e", "anchored", "budget", "phase",
];

/** `out[i]`'s first word where the pixel did not escape; the second is then its status. */
export const OUT_NONE = 0xffffffff;

/**
 * One pixel of the `out` buffer read back: `{status, n, frac}`. An escaped pixel's
 * smooth count is `n + frac`; every other status carries neither.
 */
export function decodeOut(word0, word1) {
  if (word0 >>> 0 !== OUT_NONE) return { status: ESCAPED, n: word0 >>> 0, frac: f32FromBits(word1) };
  return { status: word1 >>> 0, n: 0, frac: 0 };
}

/** The entry points every kernel module has. */
export const ENTRY_POINTS = ["init", "pass_all", "pass_list", "compact", "args", "emit"];

/**
 * The bind group layouts, as plain descriptors (`visibility` 4 is `GPUShaderStage.COMPUTE`).
 * Group 0 is bound by every entry point; group 1, the indirect arguments, only by `args`,
 * since one buffer may not be a writable binding and a dispatch's indirect buffer at once.
 */
export const LAYOUT = [
  [
    { binding: 0, visibility: 4, buffer: { type: "uniform" } }, // frame, FRAME_BYTES
    { binding: 1, visibility: 4, buffer: { type: "uniform" } }, // frame_lo, FRAME_LO_BYTES
    { binding: 2, visibility: 4, buffer: { type: "uniform" } }, // params, PARAMS_BYTES
    { binding: 3, visibility: 4, buffer: { type: "read-only-storage" } }, // orbit, 16 a point
    { binding: 4, visibility: 4, buffer: { type: "storage" } }, // states, stateBytes() a pixel
    { binding: 5, visibility: 4, buffer: { type: "storage" } }, // counters, 4 u32
    { binding: 6, visibility: 4, buffer: { type: "storage" } }, // list, 4 a pixel
    { binding: 7, visibility: 4, buffer: { type: "storage" } }, // out, 8 a pixel
  ],
  [{ binding: 0, visibility: 4, buffer: { type: "storage" } }], // indirect, 16 bytes
];

/**
 * The `params` uniform's 48 bytes: `budget` delta steps per pixel this pass, the orbit's
 * `periodic` flag and point count, the pixel `count`, the guard's knobs (1.0, 0.0, 0, 0,
 * written at run time so nothing folds), and the `HiLo` orbit's `flush` (`GpuOrbit::flush`:
 * 0 when narrowing flushed nothing, else the `f` with every point within `2^-f`).
 */
export function paramsBytes({ budget, periodic, length, count, flush }) {
  const buffer = new ArrayBuffer(PARAMS_BYTES);
  new Uint32Array(buffer, 0, 4).set([budget >>> 0, periodic ? 1 : 0, length >>> 0, count >>> 0]);
  new Float32Array(buffer, 16, 2).set([1.0, 0.0]);
  new Uint32Array(buffer, 24, 2).set([0, 0]);
  new Int32Array(buffer, 32, 1).set([flush | 0]);
  return buffer;
}

/**
 * The guard's forms, by name: a one-line body for `G` and what it tries. `knobs` is a
 * uniform filled at run time (one = 1.0, zero = 0.0, uzero = 0, flag = 0), so none is a
 * constant a compiler can fold. Subtracting the zero rather than adding it keeps a
 * negative zero negative. A form whose body names `scratch` needs the self-test's fourth
 * binding and cannot guard a kernel.
 */
export const FORMS = [
  { name: "plain", body: "return x;", note: "no defence; the textbook code" },
  { name: "mul-one", body: "return x * knobs.one;", note: "multiply by a runtime 1.0" },
  { name: "sub-zero", body: "return x - knobs.zero;", note: "subtract a runtime 0.0" },
  { name: "bitcast", body: "return bitcast<f32>(bitcast<u32>(x));", note: "a bare bitcast round trip, provably the identity" },
  { name: "bitcast-xor", body: "return bitcast<f32>(bitcast<u32>(x) ^ knobs.uzero);", note: "bitcast round trip through an xor with a runtime 0u" },
  { name: "select", body: "return select(x, knobs.zero, knobs.flag != 0u);", note: "select() on a runtime flag that is always false" },
  { name: "workgroup", body: "wg[slot] = x; return wg[slot];", note: "store to and reload from workgroup memory" },
];

/** The forms a kernel can be compiled with, in the order a caller should try them. */
export const KERNEL_FORMS = FORMS.map((f) => f.name);

// ---- The primitive self-test ----------------------------------------------------------

/** The self-test's op codes, in the order its `switch` takes them; the first six are stage 2's. */
export const SELFTEST_OPS = ["two_sum", "quick_two_sum", "split", "two_prod", "ds_add", "ds_mul", "two_sqr", "ds_sqr", "ds_mul_f32"];
/** How many f32 inputs each op reads from its case. */
export const SELFTEST_ARITY = { two_sum: 2, quick_two_sum: 2, split: 1, two_prod: 2, ds_add: 4, ds_mul: 4, two_sqr: 1, ds_sqr: 2, ds_mul_f32: 3 };
/** u32 slots per case in the input buffer: the op, up to four inputs, padding. */
export const SELFTEST_STRIDE = 8;
/** Threads per workgroup in the self-test; also its workgroup scratch length. */
export const SELFTEST_WORKGROUP = 64;
/**
 * The self-test's bind group layout for every form that needs no scratch: cases, results,
 * knobs. Explicit, since an "auto" layout drops the knobs a plain guard never reads.
 */
export const SELFTEST_LAYOUT = [
  { binding: 0, visibility: 4, buffer: { type: "read-only-storage" } },
  { binding: 1, visibility: 4, buffer: { type: "storage" } },
  { binding: 2, visibility: 4, buffer: { type: "uniform" } },
];

/**
 * The self-test module for one guard form (a `FORMS` entry, or any `{name, body}`), entry
 * point `main`. Bindings: 0 the cases (read-only storage, `SELFTEST_STRIDE` u32 a case:
 * the op's index in `SELFTEST_OPS`, then its inputs as f32 bits), 1 the results (storage,
 * two u32 a case), 2 the knobs (uniform, 16 bytes: 1.0f, 0.0f, 0u, 0u), and 3 a scratch
 * storage buffer of one f32 a case, declared only by a form whose body names it. The ops
 * are the kernel's own text, `dsOpsSource`'s.
 */
export function selfTestSource(form) {
  const guard = typeof form === "string" ? FORMS.find((f) => f.name === form) : form;
  if (guard === undefined) throw new Error(`no guard form ${form}`);
  const scratch = guard.body.includes("scratch");
  return /* wgsl */ `
struct Knobs {
  one: f32,
  zero: f32,
  uzero: u32,
  flag: u32,
}

@group(0) @binding(0) var<storage, read> cases: array<u32>;
@group(0) @binding(1) var<storage, read_write> results: array<u32>;
@group(0) @binding(2) var<uniform> knobs: Knobs;
${scratch ? "@group(0) @binding(3) var<storage, read_write> scratch: array<f32>;" : ""}

var<workgroup> wg: array<f32, ${SELFTEST_WORKGROUP}>;
// The guard's scratch slot: the local index for the workgroup form, the global one for a
// storage form.
var<private> slot: u32;
${dsOpsSource(guard, "knobs")}
@compute @workgroup_size(${SELFTEST_WORKGROUP})
fn main(@builtin(global_invocation_id) gid: vec3<u32>,
        @builtin(local_invocation_index) lid: u32) {
  let i = gid.x;
  let count = arrayLength(&results) / 2u;
  if (i >= count) {
    return;
  }
  slot = ${scratch ? "i" : "lid"};
  let base = i * ${SELFTEST_STRIDE}u;
  let op = cases[base];
  let a = bitcast<f32>(cases[base + 1u]);
  let b = bitcast<f32>(cases[base + 2u]);
  let c = bitcast<f32>(cases[base + 3u]);
  let d = bitcast<f32>(cases[base + 4u]);
  var r = vec2<f32>(0.0f, 0.0f);
  switch (op) {
    case 0u: { r = two_sum(a, b); }
    case 1u: { r = quick_two_sum(a, b); }
    case 2u: { r = split(a); }
    case 3u: { r = two_prod(a, b); }
    case 4u: { r = ds_add(vec2<f32>(a, b), vec2<f32>(c, d)); }
    case 5u: { r = ds_mul(vec2<f32>(a, b), vec2<f32>(c, d)); }
    case 6u: { r = two_sqr(a); }
    case 7u: { r = ds_sqr(vec2<f32>(a, b)); }
    case 8u: { r = ds_mul_f32(vec2<f32>(a, b), c); }
    default: {}
  }
  results[2u * i] = bitcast<u32>(r.x);
  results[2u * i + 1u] = bitcast<u32>(r.y);
}
`;
}

/**
 * The self-test's input buffer for `cases` (`[{op, in: [u32...], out}]`, the vectors file's
 * shape): `SELFTEST_STRIDE` u32 a case. Throws on an op or arity it does not know.
 */
export function selfTestCases(cases) {
  const packed = new Uint32Array(cases.length * SELFTEST_STRIDE);
  cases.forEach((c, i) => {
    const op = SELFTEST_OPS.indexOf(c.op);
    if (op < 0) throw new Error(`self-test: unknown op ${c.op}`);
    if (c.in.length !== SELFTEST_ARITY[c.op]) throw new Error(`self-test: ${c.op} wants ${SELFTEST_ARITY[c.op]} inputs`);
    packed[i * SELFTEST_STRIDE] = op;
    c.in.forEach((u, k) => (packed[i * SELFTEST_STRIDE + 1 + k] = u >>> 0));
  });
  return packed;
}

// ---- Literals -------------------------------------------------------------------------

const view = new DataView(new ArrayBuffer(4));

function f32FromBits(u) {
  view.setUint32(0, u >>> 0, true);
  return view.getFloat32(0, true);
}

/** An `f32` value as an exact WGSL hexadecimal float literal (normal values only). */
export function hexf(x) {
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

/** `x` as a double-single literal, `vec2<f32>(hi, lo)`, from a JS double. */
function dsLiteral(x) {
  const high = Math.fround(x);
  return `vec2<f32>(${hexf(high)}, ${hexf(Math.fround(x - high))})`;
}

// ---- Shared WGSL ----------------------------------------------------------------------

/** `wgsl.rs`: exponent reads and an exact ldexp, by integer arithmetic on the bits. */
export function helpersSource() {
  return /* wgsl */ `
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
  // The model saturates the add; the clamp gives the same answer for every e, since a
  // move of 1024 either way leaves the normal range.
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
`;
}

/**
 * The guard and `ds.rs`'s arithmetic: the error-free transforms and the pair and complex
 * operations built on them. `knobs` is the uniform the guard's body reads (`knobs` in the
 * self-test, `params` in a kernel). The self-test cases the six stage-2 ops plus
 * `two_sqr`, `ds_sqr` and `ds_mul_f32`; `ds_double` is exact and the complex ops are
 * compositions.
 */
export function dsOpsSource(guard, knobs = "params") {
  return /* wgsl */ `
// A complex double-single: each component a vec2, .x the high part.
struct Cds {
  re: vec2<f32>,
  im: vec2<f32>,
}

// The guard. Form: ${guard.name}${guard.note ? ` (${guard.note})` : ""}.
fn G(x: f32) -> f32 {
  ${guard.body.replaceAll("knobs.", `${knobs}.`)}
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

/** Terms of the atanh series `ln m = 2u(1 + u²/3 + u⁴/5 + ...)`: `|u|² <= 0.0295`, so 11. */
const ATANH_TERMS = 11;

/**
 * `model.rs`'s `smooth_fraction` from `z_hi`. "builtin" is WGSL's `log` and `/`, what the
 * Deep tab runs, a few `f32` ulps from the model (`wgsl.rs` on `log`); "exact" forms each
 * log and quotient in double-single and rounds once, the correctly rounded results the
 * model's CPU run takes, so that a whole state, `frac` included, can be held bit for bit.
 */
export function smoothSource(smooth, degree) {
  if (smooth !== "exact" && smooth !== "builtin") throw new Error(`smooth ${smooth} is not exact or builtin`);
  const constants = /* wgsl */ `
const LN_BAILOUT: f32 = ${hexf(11.090355)};
const LN_2: f32 = ${hexf(Math.LN2)};
const LN_BASE: f32 = ${degree === 2 ? "LN_2" : hexf(Math.log(degree))};
`;
  if (smooth === "builtin") {
    return /* wgsl */ `${constants}
// The smooth fraction with WGSL's log and division.
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
  let series = `  var acc = ${dsLiteral(1 / (2 * ATANH_TERMS - 1))};\n`;
  for (let k = ATANH_TERMS - 2; k >= 0; k--) series += `  acc = ds_add(ds_mul(acc, u2), ${dsLiteral(1 / (2 * k + 1))});\n`;
  return /* wgsl */ `${constants}
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

/** `Frame`, `FrameLo` and `Params` as WGSL structs; the layouts `frame.rs` tests. */
export function uniformsSource() {
  return /* wgsl */ `
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

// The double-single half: the low parts of the offset and spacing, and the proof's
// margins for a double-single kernel on a HiLo orbit (spacing, point, step, add).
struct FrameLo {
  offset_lo: vec2<f32>,
  spacing_lo: f32,
  pad: u32,
  margins: vec4<i32>,
}

// Per pass: the budget, the orbit's flag and length, the pixel count, the guard's knobs,
// and the HiLo orbit's flush term (0 off).
struct Params {
  budget: u32,
  periodic: u32,
  length: u32,
  count: u32,
  one: f32,
  zero: f32,
  uzero: u32,
  flag: u32,
  flush: i32,
  pad0: u32,
  pad1: u32,
  pad2: u32,
}
`;
}

// ---- The kernel -----------------------------------------------------------------------

/** `QUICK_FLOOR / (D-1)`, truncated toward zero as Rust's integer division is. */
const quickExponent = (floor, degree) => Math.trunc(floor / (degree - 1));

/**
 * The module for one kernel: `degree` 2 to 6, `julia` a boolean, `interior` whether the
 * gate and proof are compiled in (with them, a frame whose `interior` is 0 still runs with
 * the switch off; without them the state is 56 bytes a pixel and `Frame.interior` is never
 * read, so a frame with the switch on must use a module compiled with it), `form` a guard
 * name from `KERNEL_FORMS`, `workgroup` the threads per workgroup, and `smooth`
 * ("builtin", or "exact" for a bit-for-bit `frac`). Entry points: `ENTRY_POINTS`.
 */
export function kernelSource({ degree, julia, interior, form = "plain", workgroup = 64, smooth = "builtin" }) {
  if (!Number.isInteger(degree) || degree < 2 || degree > 6) throw new Error(`degree ${degree} is not one the kernel draws`);
  const guard = FORMS.find((f) => f.name === form);
  if (guard === undefined) throw new Error(`form ${form} cannot guard the kernel`);
  return (
    `// Generated by deep-gpu-wgsl.js: the double-single kernel, degree ${degree}, ${julia ? "Julia" : "parameter plane"}, interior ${interior ? "compiled in" : "off"}, guard ${form}, smooth ${smooth}.\n` +
    uniformsSource() +
    bindingsSource({ workgroup, orbit: "vec4<f32>", frameLo: true }) +
    helpersSource() +
    dsOpsSource(guard, "params") +
    smoothSource(smooth, degree) +
    pixelOffsetSource() +
    (interior ? proofSource({ degree }) : "") +
    dsKernelSource({ degree, julia, interior }) +
    entrySource({ workgroup, emit: true })
  );
}

/** The bindings and per-invocation scratch every kernel declares. */
export function bindingsSource({ workgroup, orbit, frameLo }) {
  return /* wgsl */ `
const RUNNING: u32 = ${RUNNING}u;
const ESCAPED: u32 = ${ESCAPED}u;
const CAPPED: u32 = ${CAPPED}u;
const INTERIOR: u32 = ${INTERIOR}u;
const GATED: u32 = ${GATED}u;
const FLAG: u32 = ${POLICY.flag}u;
const HANDOFF: u32 = ${POLICY.handoff}u;
const OUT_NONE: u32 = 0xffffffffu;

@group(0) @binding(0) var<uniform> frame: Frame;
${frameLo ? "@group(0) @binding(1) var<uniform> frame_lo: FrameLo;" : "// binding 1, frame_lo, is the double-single kernel's alone."}
@group(0) @binding(2) var<uniform> params: Params;
@group(0) @binding(3) var<storage, read> orbit: array<${orbit}>;
@group(0) @binding(4) var<storage, read_write> states: array<PixelState>;
// [0] pixels still running after a pass, [1] the compacted list's length, [2] delta steps
// the pass took over every pixel.
@group(0) @binding(5) var<storage, read_write> counters: array<atomic<u32>, 4>;
@group(0) @binding(6) var<storage, read_write> list: array<u32>;
// Per pixel, written by emit(): (n, bits of frac) where escaped, (OUT_NONE, status) else.
@group(0) @binding(7) var<storage, read_write> out: array<vec2<u32>>;
// A group of its own: bound only for args(), never beside the dispatch that reads it.
@group(1) @binding(0) var<storage, read_write> indirect: array<u32, 4>;

var<workgroup> wg: array<f32, ${workgroup}>;
var<workgroup> wg_running: atomic<u32>;
var<workgroup> wg_steps: atomic<u32>;
// The guard's workgroup slot: this invocation's local index, set by every entry point.
var<private> slot: u32;
// The delta steps the last run() took, for the pass's count.
var<private> taken_steps: u32;

const SCALE_FLOOR: f32 = ${pow2(-62)};
const UNSCALE_AT: i32 = -60;
const DRIFT: i32 = 32;
const REBASE_GATE: i32 = 60;
const REBASE_LIFT: i32 = 64;
const DELTA_FLOOR: i32 = -100;
const DC_HEADROOM: i32 = 100;
const NO_EXPONENT: i32 = -100000;
const BAILOUT_SQ: f32 = 4294967296.0f;
const ESCAPE_BIG: f32 = ${pow2(62)};

// model::reads_scaled: z is formed in the delta's units where |Z| is not 2^61 or more above
// |delta|, or where Z is stored as zero (ez == -127), so that a deep delta does not underflow.
fn reads_scaled(ez: i32, s: i32) -> bool {
  return s != 0 && (ez == -127 || ez <= REBASE_GATE + s);
}

// model::careful_unit: the careful step's unit, the larger exponent, except that a Z stored
// as zero is no size.
fn careful_unit(ez: i32, ed: i32) -> i32 {
  return select(max(ez, ed), ed, ez == -127);
}
`;
}

/** The pixel's offset from the frame centre in samples, the `f32` half of `dc`. */
export function pixelOffsetSource() {
  return /* wgsl */ `
// The pixel's offset from the reference, f32 half: (col + 0.5 - W/2, H/2 - row - 0.5).
fn across_of(col: u32) -> f32 {
  return f32(col) + 0.5f - f32(frame.width_px) * 0.5f;
}

fn down_of(row: u32) -> f32 {
  return f32(frame.height_px) * 0.5f - (f32(row) + 0.5f);
}
`;
}

/** `proof.rs`, and `model.rs`'s `derivative_step`, for one degree. */
function proofSource({ degree }) {
  const D = degree;
  const b = binomial(D);
  // carry_radius: pw[k] = ah^k, then Horner in rh from q_D = 1 down to q_1.
  const pw = [];
  for (let k = 2; k < D; k++) pw.push(`  let pw${k} = G(pw${k - 1} * ah);`);
  const horner = [];
  for (let j = D - 1; j >= 1; j--) horner.push(`  h = G(G(h * rh) + G(${b[j]}.0f * pw${D - j}));`);
  // The step's defect: |delta| times M^(D-2), then once more.
  const powers = [];
  for (let k = 1; k < D - 1; k++) powers.push(`    q = mag_mul(q, mm);`);
  const derivative = [];
  for (let k = 1; k < D; k++) {
    derivative.push(`  m = G(m * n2);`, `  x = exponent_of(m);`, `  m = ldexp_exact(m, -x);`, `  ex = ex + (x + e2);`);
  }
  return /* wgsl */ `
// ---- proof.rs: the interior proof, and model.rs's derivative_step (the gate).

struct Mag {
  m: f32,
  e: i32,
}

struct Proof {
  radius: array<Mag, 4>,
  center: vec2<f32>,
  center_e: i32,
  from_m: Mag,
  delta_m: Mag,
  anchored: u32,
  budget: u32,
  phase: u32,
}

struct Iterate {
  v: vec2<f32>,
  lo: vec2<f32>,
  e: i32,
  flush: i32,
}

struct Near {
  ok: bool,
  m: Mag,
}

struct Dz {
  m: f32,
  e: i32,
  nonzero: bool,
}

const RADII: i32 = 4;
const PROOF_MIN_BUDGET: u32 = 4096u;
const IDLE: u32 = 0u;
const CARRYING: u32 = 1u;
const WAITING: u32 = 2u;
const OFF: i32 = 0;
const ZERO_E: i32 = -100000;
const DEAD_E: i32 = 14;
const FLUSH_STEP: i32 = 6;
const UP: f32 = ${hexf(1 + 2 ** -20)};
const UP_SQRT: f32 = ${hexf(1 + 2 ** -19)};
const GROW: f32 = ${hexf(1 + 2 ** -18)};
const SMALL_Z: f32 = ${pow2(-60)};

fn mag_zero() -> Mag {
  return Mag(0.0f, ZERO_E);
}

fn mag_pow2(e: i32) -> Mag {
  return Mag(1.0f, e);
}

fn mag_is_zero(a: Mag) -> bool {
  return a.m == 0.0f;
}

fn mag_settle(m: f32, e: i32) -> Mag {
  let x = exponent_of(m);
  if (x == -127) {
    return mag_zero();
  }
  return Mag(ldexp_exact(m, -x), e + x);
}

fn ds_lt(a: vec2<f32>, b: vec2<f32>) -> bool {
  return a.x < b.x || (a.x == b.x && a.y < b.y);
}

// The square root correctly rounded, as the model's (Rust's) is, for x in [1, 8), the only
// arguments mag_of passes. WGSL's sqrt is only promised within about 4.5 ulps; with it the
// RTX 2060 SUPER's proof words came out an ulp or more from the model's (every radius
// carries the difference on), and with this they agree bit for bit. Each turn reads the exact residual x - r^2 (a two-product, then a two-sum that
// Sterbenz keeps exact) against the residuals at the two midpoints beside r, and moves r
// one ulp toward the root; no square root of a float lies on a midpoint, so the tests
// never tie. The margin UP_SQRT covers WGSL's own sqrt as well: this is for bit identity
// with the model, not for soundness.
fn sqrt_rn(x: f32) -> f32 {
  var r = sqrt(x);
  for (var k = 0; k < 8; k++) {
    // ulp(r) = 2^(e - 23); below a power of two the ulp is half that.
    let u = bitcast<f32>(u32(exponent_of(r) + 104) << 23u);
    var ud = u;
    if ((bitcast<u32>(r) & 0x7fffffu) == 0u) {
      ud = G(u * 0.5f);
    }
    let pe = two_prod(r, r);
    let res = two_sum(G(x - pe.x), -pe.y);
    // x >= (r + u/2)^2: the root is above the upper midpoint.
    if (!ds_lt(res, vec2<f32>(G(r * u), G(G(u * u) * 0.25f)))) {
      r = G(r + u);
      continue;
    }
    // x < (r - ud/2)^2: below the lower one.
    if (ds_lt(res, vec2<f32>(-G(r * ud), G(G(ud * ud) * 0.25f)))) {
      r = G(r - ud);
      continue;
    }
    break;
  }
  return r;
}

fn mag_of(v: vec2<f32>, e: i32) -> Mag {
  let x = exponent_of_max(v.x, v.y);
  if (x == -127) {
    return mag_zero();
  }
  let a = ldexp_exact(v.x, -x);
  let b = ldexp_exact(v.y, -x);
  return mag_settle(G(sqrt_rn(G(G(a * a) + G(b * b))) * UP_SQRT), e + x);
}

fn mag_add(a: Mag, b: Mag) -> Mag {
  if (mag_is_zero(a)) {
    return b;
  }
  if (mag_is_zero(b)) {
    return a;
  }
  let at = select(b.e, a.e, a.e > b.e);
  let sum = G(ldexp_exact(a.m, a.e - at) + ldexp_exact(b.m, b.e - at));
  return mag_settle(G(sum * UP), at);
}

fn mag_mul(a: Mag, b: Mag) -> Mag {
  if (mag_is_zero(a) || mag_is_zero(b)) {
    return mag_zero();
  }
  return mag_settle(G(G(a.m * b.m) * UP), a.e + b.e);
}

fn mag_scale(a: Mag, k: i32) -> Mag {
  if (mag_is_zero(a)) {
    return mag_zero();
  }
  return Mag(a.m, a.e + k);
}

fn mag_lt(a: Mag, b: Mag) -> bool {
  if (mag_is_zero(b)) {
    return false;
  }
  if (mag_is_zero(a)) {
    return true;
  }
  if (a.e != b.e) {
    return a.e < b.e;
  }
  return a.m < b.m;
}

// (a + r)^D - a^D, rounded up by GROW, formed where the larger of a and r is in [1, 2).
fn carry_radius(a: Mag, r: Mag) -> Mag {
  let u = select(r.e, a.e, a.e > r.e);
  let ah = ldexp_exact(a.m, a.e - u);
  let rh = ldexp_exact(r.m, r.e - u);
  let pw1 = ah;
${pw.join("\n")}
  var h = 1.0f;
${horner.join("\n")}
  return mag_settle(G(G(h * r.m) * GROW), r.e + ${D - 1} * u);
}

fn flush_term(flush: i32) -> Mag {
  if (flush == OFF) {
    return mag_zero();
  }
  return mag_pow2(-flush);
}

// rho_0's exponent for disc i.
fn rung(center_e: i32, i: i32) -> i32 {
  return center_e - 2 - frame_lo.margins.x * i;
}

// |z_hat - w|: kappa_pt (|z_hat| + |delta|), plus the flush term where the orbit has one.
fn point_margin(z: Iterate, mv: Mag, dmag: Mag) -> Mag {
  return mag_add(mag_scale(mag_add(mv, dmag), -frame_lo.margins.y), flush_term(z.flush));
}

// |z_hat - w| plus |lo|.
fn offset_of(z: Iterate, mv: Mag, dmag: Mag) -> Mag {
  return mag_add(mag_of(z.lo, z.e), point_margin(z, mv, dmag));
}

// |z_hat - centre 2^ce|, or nothing where |z| >= 2^(ce+3).
fn distance_to(z: Iterate, center: vec2<f32>, center_e: i32) -> Near {
  let x = exponent_of_max(z.v.x, z.v.y);
  if (x != -127 && x + z.e > center_e + 2) {
    return Near(false, mag_zero());
  }
  let k = z.e - center_e;
  let diff = vec2<f32>(
    G(G(ldexp_exact(z.v.x, k) - center.x) + ldexp_exact(z.lo.x, k)),
    G(G(ldexp_exact(z.v.y, k) - center.y) + ldexp_exact(z.lo.y, k)),
  );
  return Near(true, mag_of(diff, center_e));
}

fn proof_idle() -> Proof {
  var p: Proof;
  for (var i = 0; i < RADII; i++) {
    p.radius[i] = mag_zero();
  }
  p.center = vec2<f32>(0.0f, 0.0f);
  p.center_e = 0;
  p.from_m = mag_zero();
  p.delta_m = mag_zero();
  p.anchored = 0u;
  p.budget = 0u;
  p.phase = IDLE;
  return p;
}

fn proof_lower(p: ptr<function, Proof>, mv: Mag) -> bool {
  return mag_lt(mv, mag_of((*p).center, (*p).center_e));
}

fn proof_anchor(p: ptr<function, Proof>, z: Iterate, mv: Mag, dmag: Mag, n: u32) {
  let off = offset_of(z, mv, dmag);
  let x = exponent_of_max(z.v.x, z.v.y);
  if (x == -127) {
    (*p).center = vec2<f32>(0.0f, 0.0f);
    (*p).center_e = select(dmag.e, -120, mag_is_zero(dmag));
  } else {
    (*p).center = vec2<f32>(ldexp_exact(z.v.x, -x), ldexp_exact(z.v.y, -x));
    (*p).center_e = z.e + x;
  }
  for (var i = 0; i < RADII; i++) {
    (*p).radius[i] = mag_add(mag_pow2(rung((*p).center_e, i)), off);
  }
  (*p).from_m = mag_add(mv, off);
  (*p).delta_m = dmag;
  (*p).anchored = n;
  (*p).phase = CARRYING;
}

fn proof_arm(z: Iterate, d: vec2<f32>, s: i32, n: u32) -> Proof {
  var p = proof_idle();
  p.budget = select(PROOF_MIN_BUDGET, n, n > PROOF_MIN_BUDGET);
  let mv = mag_of(z.v, z.e);
  proof_anchor(&p, z, mv, mag_of(d, s), n);
  return p;
}

// One step of every live disc, then the containment test against the anchor.
fn proof_carry(p: ptr<function, Proof>, z: Iterate, mv: Mag, dmag: Mag) -> bool {
  let margins = frame_lo.margins;
  var defect = mag_zero();
  if (margins.z != OFF) {
    let mm = mag_add((*p).from_m, mag_scale((*p).delta_m, 1));
    var q = (*p).delta_m;
${powers.join("\n")}
    if (z.flush != OFF) {
      defect = mag_scale(q, FLUSH_STEP - z.flush);
    }
    q = mag_mul(q, mm);
    defect = mag_add(defect, mag_scale(q, -margins.z));
  }
  if (margins.w != OFF) {
    defect = mag_add(defect, mag_scale(dmag, -margins.w));
  }
  var near = distance_to(z, (*p).center, (*p).center_e);
  if (near.ok) {
    near.m = mag_add(near.m, point_margin(z, mv, dmag));
  }
  let from_m = (*p).from_m;
  var proven = false;
  var live = false;
  for (var i = 0; i < RADII; i++) {
    let r = (*p).radius[i];
    if (r.e < DEAD_E) {
      let next = mag_add(carry_radius(from_m, r), defect);
      if (next.e >= DEAD_E) {
        (*p).radius[i] = mag_pow2(DEAD_E);
      } else {
        (*p).radius[i] = next;
        live = true;
        if (near.ok && mag_lt(mag_add(near.m, next), mag_pow2(rung((*p).center_e, i)))) {
          proven = true;
        }
      }
    }
  }
  if (!live) {
    (*p).phase = WAITING;
  }
  return proven;
}

// Carries every disc a step to z, and returns true if one has come back inside itself;
// otherwise re-anchors at a new low |z|.
fn proof_advance(p: ptr<function, Proof>, z: Iterate, d: vec2<f32>, s: i32, n: u32) -> bool {
  if ((*p).phase == IDLE) {
    return false;
  }
  let mv = mag_of(z.v, z.e);
  if ((*p).phase == WAITING) {
    if (proof_lower(p, mv)) {
      proof_anchor(p, z, mv, mag_of(d, s), n);
    }
    return false;
  }
  let dmag = mag_of(d, s);
  if (n - (*p).anchored > (*p).budget) {
    (*p).phase = WAITING;
  }
  if ((*p).phase == CARRYING) {
    if (proof_carry(p, z, mv, dmag)) {
      return true;
    }
  }
  if (proof_lower(p, mv)) {
    proof_anchor(p, z, mv, dmag, n);
  } else {
    (*p).from_m = mag_add(mv, offset_of(z, mv, dmag));
    (*p).delta_m = dmag;
  }
  return false;
}

// The loop rebased: every live disc grows by the reference's rounding there.
fn proof_rebased(p: ptr<function, Proof>, flush: i32) {
  if ((*p).phase == IDLE) {
    return;
  }
  if ((*p).phase == CARRYING) {
    let jump = mag_add(mag_scale(mag_add((*p).from_m, (*p).delta_m), -frame_lo.margins.y), flush_term(flush));
    for (var i = 0; i < RADII; i++) {
      if ((*p).radius[i].e < DEAD_E) {
        (*p).radius[i] = mag_add((*p).radius[i], jump);
      }
    }
  }
  (*p).delta_m = (*p).from_m;
}

// model.rs's derivative_step: |dz|^2 times one step's D^2 |z|^(2(D-1)), renormalized after
// each multiply. nonzero is false only where z is zero.
fn derivative_step(mantissa: f32, exponent: i32, zv: vec2<f32>, ze: i32, z_norm_sq: f32) -> Dz {
  var n2: f32;
  var e2: i32;
  if (ze == 0 && reaches(zv, SMALL_Z)) {
    n2 = z_norm_sq;
    e2 = 0;
  } else {
    let e = exponent_of_max(zv.x, zv.y);
    if (e == -127) {
      return Dz(mantissa, exponent, false);
    }
    let a = ldexp_exact(zv.x, -e);
    let b = ldexp_exact(zv.y, -e);
    n2 = G(G(a * a) + G(b * b));
    e2 = 2 * (e + ze);
  }
  var m = G(mantissa * ${D * D}.0f);
  var x = exponent_of(m);
  m = ldexp_exact(m, -x);
  var ex = exponent + x;
${derivative.join("\n")}
  return Dz(m, ex, true);
}
`;
}

/** `model_ds.rs`'s state, `init_ds` and loop, with the interior switch when `interior`. */
function dsKernelSource({ degree, julia, interior }) {
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
  const I = (text) => (interior ? text : "");
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
  scaled: u32,${I(`
  proof: Proof,`)}
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
const DM1: i32 = ${D - 1};

const ZERO: Cds = Cds(vec2<f32>(0.0f, 0.0f), vec2<f32>(0.0f, 0.0f));

fn hi(v: Cds) -> vec2<f32> {
  return vec2<f32>(v.re.x, v.im.x);
}

fn lo(v: Cds) -> vec2<f32> {
  return vec2<f32>(v.re.y, v.im.y);
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
  var out_: ScaleDs;
  out_.dc_fits = sc - s <= DC_HEADROOM;
  out_.dc = ZERO;
  if (out_.dc_fits) {
    out_.dc = ldexp_c(dc, sc - s);
  }
  return out_;
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
  let v = careful_unit(ez, ed);
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
  st.d_lo = lo(start.d);
  st.s = start.s;
  st.m = frame.entry;` : ""}
  st.n = 0u;
  st.status = RUNNING;
  st.frac = 0.0f;
  st.dz_mantissa = 1.0f;
  st.dz_exponent = 0;
  st.rebases = 0u;
  st.steps = 0u;
  st.scaled = 0u;${I(`
  st.proof = proof_idle();`)}
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
  var taken = 0u;${I(`
  let policy = frame.interior;
  let track_interior = policy != 0u;
  let flush = params.flush;
  var dzm = st.dz_mantissa;
  var dze = st.dz_exponent;
  var proof = st.proof;`)}

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

    // ---- reconstruct and escape: z = zv 2^ze, the pair; the tests read its high parts.
    let q = orbit[m];
    let zq = reference(q);
    var z: Cds;
    var zv: Cds;
    var ze: i32;
    if (reads_scaled(exponent_of_max(q.x, q.y), s)) {
      let zs = c_add(ldexp_c(zq, -s), d);
      z = ldexp_c(zs, s);
      zv = zs;
      ze = s;
    } else {
      z = c_add(zq, ldexp_c(d, s));
      zv = z;
      ze = 0;
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
${I(`
    // ---- interior switch: the gate on the high parts, the proof on the pair.
    if (track_interior) {
      let it = Iterate(hi(zv), lo(zv), ze, flush);
      if (proof.phase == IDLE) {
        let dz = derivative_step(dzm, dze, hi(zv), ze, z_norm_sq);
        dzm = dz.m;
        dze = dz.e;
        if (!dz.nonzero || dze < frame.floor) {
          proof = proof_arm(it, hi(d), s, n);
        }
      } else if (proof_advance(&proof, it, hi(d), s, n)) {
        status = INTERIOR;
        break;
      }
      if (policy == HANDOFF && proof.phase == WAITING) {
        status = GATED;
        break;
      }
    }
`)}
    // ---- cap.
    if (n >= maxiter) {
      status = CAPPED;${I(`
      if (policy == FLAG && proof.phase != IDLE) {
        status = GATED;
      }`)}
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
    } else if (reads_scaled(exponent_of(max_abs(q.x, q.y)), s)) {
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
      rebases += 1u;${I(`
      proof_rebased(&proof, flush);`)}
    }
  }

  st.d_hi = hi(d);
  st.d_lo = lo(d);
  st.s = s;
  st.m = m;
  st.n = n;
  st.status = status;
  st.frac = frac;
  st.rebases = rebases;
  st.steps = steps;
  st.scaled = scaled;${I(`
  st.dz_mantissa = dzm;
  st.dz_exponent = dze;
  st.proof = proof;`)}
  states[i] = st;
  taken_steps = taken;
  return status == RUNNING;
}
`;
}

/** The entry points; `emit` reads `out`, which a caller without that binding leaves out. */
export function entrySource({ workgroup, emit = true }) {
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
${emit ? `
// Per pixel, the field's value as the host reads it back: (n, bits of frac) where escaped,
// (OUT_NONE, status) otherwise; 8 bytes a pixel rather than the whole state.
@compute @workgroup_size(${workgroup})
fn emit(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= params.count) {
    return;
  }
  let status = states[i].status;
  if (status == ESCAPED) {
    out[i] = vec2<u32>(states[i].n, bitcast<u32>(states[i].frac));
  } else {
    out[i] = vec2<u32>(OUT_NONE, status);
  }
}
` : ""}`;
}
