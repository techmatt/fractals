//! Double-single arithmetic: a value as an unevaluated pair of `f32`, `hi + lo`, about
//! 48 bits of significand, in operations a WGSL shader can write one line for one line.
//!
//! Stage 1 measured an `f32` kernel as a sound preview that re-deals speckle on long
//! orbits, with the error dominated by the `f32`-rounded reference; and the
//! [`Encoding::HiLo`](crate::orbit::Encoding::HiLo) reference bought nothing there,
//! because the delta arithmetic that read it still rounded to 24 bits. This module is the
//! number type a kernel needs to spend that reference: the delta carried as a [`Ds`], and
//! a `HiLo` point read straight into one by [`from_hi_lo`].
//!
//! # What a `Ds` is
//!
//! `hi` is the `f32` nearest the value and `lo` the `f32` nearest what is left, so
//! `|lo| <= ulp(hi) / 2` (normalized). Every operation here returns a normalized pair.
//! The `HiLo` orbit buffer is normalized by construction ([`crate::orbit`] rounds `hi`
//! to nearest and `lo` to nearest of the exact remainder), which is why reading it costs
//! nothing.
//!
//! # The arithmetic rules, and the two hazards
//!
//! Everything is `f32`, with no fused multiply-add and no `f64`, except [`from_f64`] and
//! [`to_f64`], which are CPU-side setup and the test harness's and never on the
//! per-pixel path. The error-free transforms below are only error-free if every add and
//! every multiply is its own correctly rounded operation, in the order written. Two
//! things a WGSL compiler is allowed to do break that, and each site where one could is
//! marked:
//!
//! - **`REASSOCIATION HAZARD`**: an expression like `(a + b) - a` that is `b` in real
//!   arithmetic, and is exactly the rounding error in floating point. A compiler that
//!   reassociates folds the error term to zero, and the pair silently becomes an `f32`.
//!   WGSL forbids value-changing reassociation, so this hazard is a broken backend or a
//!   fast-math mode, and catastrophic when it happens.
//! - **`CONTRACTION HAZARD`**: an `a * b + c` that a backend may fuse into one rounding,
//!   which WGSL cannot forbid (see [`crate::model`]). Two kinds, and the marks say which:
//!   a **catastrophic** site is one where the multiply is inexact and its rounded result
//!   is read again elsewhere (`two_prod`'s `ah·bh - p` if a backend fuses `p = a·b` into
//!   it), so fusing changes the error term wholesale; a **benign** site is one where
//!   fusing only drops one rounding of a term already `2^-24` below the result (`mul`'s
//!   cross terms), costing accuracy nothing. Dekker's partial products `ah·bh`, `ah·bl`,
//!   `al·bh`, `al·bl` are exact by construction, so contracting any of them with the add
//!   that follows is harmless. `split`'s `t - a` with `t = 4097·a` looks catastrophic and
//!   is not: fused, it still returns a valid 12-bit split (measured over 2,000,000 random
//!   significands: no part wider than 12 bits, and `two_prod` exact on every one), just a
//!   different one for a significand within about `2^-11` of 2 (509 of them), so
//!   `two_prod`'s outputs do not move. Its vector catches the contraction without the
//!   contraction mattering.
//!
//! The catastrophic cases are what [`self_test_vectors`] exists for: inputs on which a
//! reassociated or fused evaluation gives a different answer, for a WebGPU page to run on
//! the device and compare bit for bit before trusting a DS kernel on it.
//!
//! # Ranges
//!
//! [`two_sum`] is error-free for any finite inputs whose sum does not overflow; on a GPU
//! that flushes subnormals, also only while its error term is normal, which holds when
//! `|a + b| >= 2^-102` or the error is zero. [`split`] multiplies by `4097`, so its input
//! must satisfy `|a| < 2^115` (`4097 · 2^115 < 2^128` with room for the rounding).
//! [`two_prod`] is error-free on any implementation when each nonzero operand lies in
//! `[2^-100, 2^115)`, their exponents sum to at least `-80` (so the smallest partial
//! product, `al·bl >= 2^(ea+eb-46)`, is normal), and `|a·b| < 2^127`. The kernel this
//! feeds keeps its operands where `model.rs` keeps them: the scaled delta's mantissa in
//! `[2^-32, 2^33)`, a reference component at most 2, and the careful path's operands
//! rescaled to at most 2. Outside the range nothing goes wrong loudly: a flushed partial
//! product loses a term below `2^-126` absolute, so the result degrades towards `f32`
//! accuracy by that much and no further.
//!
//! # Cost
//!
//! Every doc comment gives an op count in `f32` adds and muls (a subtraction is an add,
//! a negation and a power-of-two scaling by [`wgsl::ldexp_exact`] are free of `f32`
//! arithmetic). For scale: a plain `f32` complex multiply is 6.

use crate::orbit::narrow;
use crate::wgsl;

/// A double-single value, `hi + lo` with `|lo| <= ulp(hi) / 2`. WGSL: a `vec2<f32>`,
/// `.x` the high part.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Ds {
    pub hi: f32,
    pub lo: f32,
}

/// A complex double-single, `[re, im]`. WGSL: a `vec4<f32>` laid out as
/// `[re_hi, re_lo, im_hi, im_lo]`, or two `vec2<f32>`.
pub type Cds = [Ds; 2];

/// Veltkamp's splitting constant for a 24-bit significand: `2^12 + 1`.
const SPLITTER: f32 = 4097.0;

/// Knuth's two-sum: `s = fl(a + b)` and `e` with `s + e == a + b` exactly, for any
/// order of magnitude of `a` and `b`. 6 adds.
#[inline(always)]
pub fn two_sum(a: f32, b: f32) -> (f32, f32) {
    let s = a + b;
    // REASSOCIATION HAZARD: `s - a` is `b` in real arithmetic, and so is `s - bb` `a`;
    // folding either makes `e` zero.
    let bb = s - a;
    let e = (a - (s - bb)) + (b - bb);
    (s, e)
}

/// Dekker's fast two-sum: as [`two_sum`], but only for `|a| >= |b|` (or `a` zero). 3 adds.
#[inline(always)]
pub fn quick_two_sum(a: f32, b: f32) -> (f32, f32) {
    let s = a + b;
    // REASSOCIATION HAZARD: `b - (s - a)` is zero in real arithmetic.
    let e = b - (s - a);
    (s, e)
}

/// Veltkamp's split: `a == hi + lo` exactly, each part with at most 12 significant bits
/// (`lo` 11 and a sign), so that a product of two parts is exact in `f32`. Requires
/// `|a| < 2^115`. 1 mul, 3 adds.
#[inline(always)]
pub fn split(a: f32) -> (f32, f32) {
    let t = SPLITTER * a;
    // CONTRACTION HAZARD, benign: `t - a` fused as `fma(4097, a, -a)` is `4096·a` exactly
    // instead of `fl(t - a)`. The split it gives is still a 12-bit split (module docs),
    // a different one only where `4097·a` crosses a binade.
    // REASSOCIATION HAZARD: `t - (t - a)` is `a` in real arithmetic; folded, `hi = a`,
    // `lo = 0`, and the partial products in `two_prod` stop being exact.
    let hi = t - (t - a);
    let lo = a - hi;
    (hi, lo)
}

/// Dekker's two-product: `p = fl(a · b)` and `e` with `p + e == a · b` exactly, inside
/// the range in the module docs. 7 muls, 10 adds (17): the product, two splits, four
/// exact partial products, and the four adds that collect them.
#[inline(always)]
pub fn two_prod(a: f32, b: f32) -> (f32, f32) {
    let p = a * b;
    let (ah, al) = split(a);
    let (bh, bl) = split(b);
    // CONTRACTION HAZARD, catastrophic: a backend that fuses `p = a * b` into the first
    // subtraction (`fma(-a, b, ah * bh)`) reads `a · b` unrounded there, and `e` comes out
    // as the rounding error of that subtraction instead of `p`'s, usually about `2^-12` of
    // it. Fusing any partial product with its add is harmless: each is exact.
    let e = (((ah * bh - p) + ah * bl) + al * bh) + al * bl;
    (p, e)
}

/// [`two_prod`] of `a` with itself, splitting once: `p + e == a²` exactly. 5 muls,
/// 7 adds (12).
#[inline(always)]
pub fn two_sqr(a: f32) -> (f32, f32) {
    let p = a * a;
    let (h, l) = split(a);
    let hl = h * l;
    // CONTRACTION HAZARD, catastrophic: as in `two_prod`, if `p` is fused into `h·h - p`.
    let e = ((h * h - p) + (hl + hl)) + l * l;
    (p, e)
}

/// `(hi, lo)` as a [`Ds`], trusting it to be normalized, as the `HiLo` orbit buffer is.
/// 0 ops. WGSL: the `vec4` point's `.x`/`.z` (real) or `.y`/`.w` (imaginary).
#[inline(always)]
pub fn from_hi_lo(hi: f32, lo: f32) -> Ds {
    Ds { hi, lo }
}

/// `(hi, lo)` as a [`Ds`] when it is not known to be normalized: [`quick_two_sum`],
/// so `|hi| >= |lo|` is still required. 3 adds.
#[inline(always)]
pub fn renormalize(hi: f32, lo: f32) -> Ds {
    let (hi, lo) = quick_two_sum(hi, lo);
    Ds { hi, lo }
}

/// An `f32` as a [`Ds`]. 0 ops.
#[inline(always)]
pub fn from_f32(x: f32) -> Ds {
    Ds { hi: x, lo: 0.0 }
}

/// `-a`. 0 ops: both signs flip, exactly.
#[inline(always)]
pub fn neg(a: Ds) -> Ds {
    Ds {
        hi: -a.hi,
        lo: -a.lo,
    }
}

/// `a + b`, the accurate ("IEEE") variant: both parts summed error-free, so the result
/// is good to about `2^-47` relative to `a + b` itself, however much `a` and `b` cancel.
/// 20 adds.
///
/// **This is the one the kernel uses.** The delta step adds terms of opposite sign and
/// unrelated size (`2Zδ`, `δ²`, `dc`), and the reconstruction `z = Z + δ` cancels to
/// nothing near the critical point, which is where speckle is dealt. The sloppy variant
/// ([`add_sloppy`]) is accurate only relative to `|a| + |b|`, so under exactly those
/// cancellations it hands back `f32`-sized errors; the 9 adds it saves are not worth it.
#[inline(always)]
pub fn add(a: Ds, b: Ds) -> Ds {
    let (s, e) = two_sum(a.hi, b.hi);
    let (t, f) = two_sum(a.lo, b.lo);
    let e = e + t;
    let (s, e) = quick_two_sum(s, e);
    let e = e + f;
    let (hi, lo) = quick_two_sum(s, e);
    Ds { hi, lo }
}

/// `a + b`, the sloppy variant: the high parts summed error-free and the low parts
/// plainly. Accurate to about `2^-47` relative to `|a| + |b|`, not to `|a + b|`. Kept for
/// the cost comparison; the kernel uses [`add`]. 11 adds.
#[inline(always)]
pub fn add_sloppy(a: Ds, b: Ds) -> Ds {
    let (s, e) = two_sum(a.hi, b.hi);
    let e = e + (a.lo + b.lo);
    let (hi, lo) = quick_two_sum(s, e);
    Ds { hi, lo }
}

/// `a - b`. 20 adds, as [`add`].
#[inline(always)]
pub fn sub(a: Ds, b: Ds) -> Ds {
    add(a, neg(b))
}

/// `a + b` for an `f32` `b`: [`add`] with `b.lo = 0`, which needs only one two-sum and
/// keeps its accuracy under cancellation. 10 adds.
#[inline(always)]
pub fn add_f32(a: Ds, b: f32) -> Ds {
    let (s, e) = two_sum(a.hi, b);
    let e = e + a.lo;
    let (hi, lo) = quick_two_sum(s, e);
    Ds { hi, lo }
}

/// `a · b`: the high product error-free, the cross terms plainly, `a.lo · b.lo` (`2^-48`
/// relative) dropped. 9 muls, 15 adds (24).
#[inline(always)]
pub fn mul(a: Ds, b: Ds) -> Ds {
    let (p, e) = two_prod(a.hi, b.hi);
    // CONTRACTION HAZARD, benign: either product fused with the add drops a rounding of
    // a term `2^-24` below the result.
    let e = e + (a.hi * b.lo + a.lo * b.hi);
    let (hi, lo) = quick_two_sum(p, e);
    Ds { hi, lo }
}

/// `a²`, bit for bit [`mul`]`(a, a)` (each step of both is exact or rounds the same
/// value), for fewer operations. 6 muls, 12 adds (18).
#[inline(always)]
pub fn sqr(a: Ds) -> Ds {
    let (p, e) = two_sqr(a.hi);
    // CONTRACTION HAZARD, benign: as in `mul`.
    let c = a.hi * a.lo;
    let e = e + (c + c);
    let (hi, lo) = quick_two_sum(p, e);
    Ds { hi, lo }
}

/// `a · b` for an `f32` `b`. 8 muls, 14 adds (22).
#[inline(always)]
pub fn mul_f32(a: Ds, b: f32) -> Ds {
    let (p, e) = two_prod(a.hi, b);
    // CONTRACTION HAZARD, benign: as in `mul`.
    let e = e + a.lo * b;
    let (hi, lo) = quick_two_sum(p, e);
    Ds { hi, lo }
}

/// `2a`, exactly. 2 adds.
#[inline(always)]
pub fn double(a: Ds) -> Ds {
    Ds {
        hi: a.hi + a.hi,
        lo: a.lo + a.lo,
    }
}

/// `a · 2^e`, both parts through [`wgsl::ldexp_exact`]. 0 `f32` ops (two exponent-field
/// rewrites in integer arithmetic).
///
/// Exact while both parts stay normal. Scaling down far, `lo` (about `2^-24` below `hi`)
/// leaves the normal range first, once `|hi|` falls below about `2^-102`, and becomes a
/// signed zero: the value is then `hi` alone, which is still the nearest `f32` to it, so
/// what is lost is the low half's 24 bits and nothing else; the pair stays normalized.
/// Scaled back up, those bits do not return. A kernel that keeps `hi` in the ranges
/// above never gets there; one that does reads an `f32`-accurate value, not a wrong one.
#[inline(always)]
pub fn ldexp(a: Ds, e: i32) -> Ds {
    Ds {
        hi: wgsl::ldexp_exact(a.hi, e),
        lo: wgsl::ldexp_exact(a.lo, e),
    }
}

/// `a + b`, complex. 40 adds.
#[inline(always)]
pub fn c_add(a: Cds, b: Cds) -> Cds {
    [add(a[0], b[0]), add(a[1], b[1])]
}

/// `a - b`, complex. 40 adds.
#[inline(always)]
pub fn c_sub(a: Cds, b: Cds) -> Cds {
    [sub(a[0], b[0]), sub(a[1], b[1])]
}

/// `a · b`, complex, the schoolbook four products (Gauss's three would trade a product
/// for adds that cancel). 36 muls, 100 adds (136).
#[inline(always)]
pub fn c_mul(a: Cds, b: Cds) -> Cds {
    [
        sub(mul(a[0], b[0]), mul(a[1], b[1])),
        add(mul(a[0], b[1]), mul(a[1], b[0])),
    ]
}

/// `a²`, complex: `(re² - im², 2·re·im)`. 21 muls, 61 adds (82).
#[inline(always)]
pub fn c_sqr(a: Cds) -> Cds {
    [sub(sqr(a[0]), sqr(a[1])), double(mul(a[0], a[1]))]
}

/// `a · s` for a real `f32` `s`. 16 muls, 28 adds (44).
#[inline(always)]
pub fn c_scale(a: Cds, s: f32) -> Cds {
    [mul_f32(a[0], s), mul_f32(a[1], s)]
}

/// `x` as a normalized [`Ds`], each part narrowed the way the orbit buffer is (a
/// subnormal part stored as a signed zero). CPU-side setup only, never on the per-pixel
/// path.
pub fn from_f64(x: f64) -> Ds {
    let hi = narrow(x);
    // Exact in f64: `hi` is within half an f32 ulp of `x` (see `orbit.rs`).
    let lo = narrow(x - hi as f64);
    Ds { hi, lo }
}

/// `hi + lo` in `f64`, rounded once (exact when the two parts span at most 53 bits).
/// Host side only: the comparison harness and the tests.
pub fn to_f64(a: Ds) -> f64 {
    a.hi as f64 + a.lo as f64
}

/// Vectors for a WebGPU page to run the shader's port of these functions on and compare
/// bit for bit, before trusting a DS kernel on that device: `(op, inputs, outputs)`, all
/// `f32` bit patterns. The ops and their arities are `two_sum`, `quick_two_sum`,
/// `two_prod` (2 in, 2 out), `split` (1 in, 2 out), and `ds_add`, `ds_mul`
/// (`[a.hi, a.lo, b.hi, b.lo]` in, `[hi, lo]` out).
///
/// The outputs are what the exact no-FMA sequence gives in IEEE `f32` round to nearest,
/// computed by the functions above; the tests hold every primitive's to the exact
/// error, and hold each catastrophic vector to giving a different answer under the
/// reassociated or fused evaluation it is there to catch. A mismatch on the device means
/// the backend reassociated or contracted where it must not, and the DS kernel would be
/// an `f32` kernel at three times the cost.
// `-3.141_592_6` is π to eight digits on purpose, so that its sum with π cancels to the
// low parts; clippy's `approx_constant` reads it as a misspelt `PI`.
#[allow(clippy::approx_constant)]
pub fn self_test_vectors() -> Vec<(&'static str, Vec<u32>, Vec<u32>)> {
    let b = |x: f32| x.to_bits();
    let mut out = Vec::new();
    let pi = core::f32::consts::PI;
    let e = core::f32::consts::E;
    let below_one = f32::from_bits(0x3f7f_ffff); // 1 - 2^-24
    let above_one = f32::from_bits(0x3f80_0001); // 1 + 2^-23
    let p30 = wgsl::pow2(-30);
    let p24 = wgsl::pow2(-24);

    // two_sum: a tiny addend (reassociation folds `e` to 0), |b| > |a| (the case
    // quick_two_sum gets wrong), a tie, a carry, and two of unrelated sizes and signs.
    // (An exact cancellation has a zero error term and would catch nothing.)
    for (x, y) in [
        (1.0, p30),
        (p30, 1.0),
        (above_one, p24),
        (16_777_215.0, 0.75),
        (-1.0e10, pi),
        (0.1, -1.0e-9),
    ] {
        let (s, t) = two_sum(x, y);
        out.push(("two_sum", vec![b(x), b(y)], vec![b(s), b(t)]));
    }
    for (x, y) in [(1.0, p24), (above_one, p24), (1.0e8, -0.3)] {
        let (s, t) = quick_two_sum(x, y);
        out.push(("quick_two_sum", vec![b(x), b(y)], vec![b(s), b(t)]));
    }
    // split: anything with more than 12 significant bits, which reassociation returns
    // whole as `hi`; and two significands near 2, where `4097a` crosses a binade and the
    // fused `fma(4097, a, -a)` gives a different (still valid) split.
    let near_two = f32::from_bits(0x3fff_fdad); // 1.9999291
    for x in [
        0.1,
        pi,
        below_one,
        -12_345.678,
        1.7 * wgsl::pow2(100),
        near_two,
        -near_two * wgsl::pow2(-20),
    ] {
        let (h, l) = split(x);
        out.push(("split", vec![b(x)], vec![b(h), b(l)]));
    }
    // two_prod: inexact products, where a fused `p` leaves `e` as the rounding error of
    // `ah·bh - a·b` instead, usually thousands of times smaller. (`(1 + 2^-23)²` and
    // `(1 - 2^-24)²` are not here: that rounding is exact on them, and fused agrees.)
    for (x, y) in [
        (above_one, f32::from_bits(0x3f80_0003)),
        (1.1, 1.3),
        (0.1, 0.3),
        (pi, e),
        (-16_777_215.0, 16_777_213.0),
        (1.0e-11, 3.0e-12),
    ] {
        let (p, t) = two_prod(x, y);
        out.push(("two_prod", vec![b(x), b(y)], vec![b(p), b(t)]));
    }
    // ds_add: cancellations of the high parts that leave only the low parts and the
    // error terms, and a sum whose sloppy evaluation differs.
    for (x, y) in [
        (from_hi_lo(1.0, p30), from_hi_lo(-1.0, wgsl::pow2(-31))),
        (from_f64(0.1), from_f64(-0.1 - 1.0e-12)),
        (from_f64(core::f64::consts::PI), from_f64(-3.141_592_6)),
        (from_f64(1.0e6 / 3.0), from_f64(2.0e-3 / 7.0)),
        (sloppy_witness().0, sloppy_witness().1),
    ] {
        let r = add(x, y);
        out.push((
            "ds_add",
            vec![b(x.hi), b(x.lo), b(y.hi), b(y.lo)],
            vec![b(r.hi), b(r.lo)],
        ));
    }
    for (x, y) in [
        (
            from_f64(core::f64::consts::PI),
            from_f64(core::f64::consts::E),
        ),
        (from_f64(0.1), from_f64(10.0)),
        (from_f64(1.0 / 3.0), from_f64(3.0)),
        (
            from_f64(-(1.0 + 2f64.powi(-23) + 2f64.powi(-40))),
            from_f64(1.0 - 2f64.powi(-30)),
        ),
    ] {
        let r = mul(x, y);
        out.push((
            "ds_mul",
            vec![b(x.hi), b(x.lo), b(y.hi), b(y.lo)],
            vec![b(r.hi), b(r.lo)],
        ));
    }
    out
}

/// A pair on which [`add_sloppy`] and [`add`] differ: the high parts cancel exactly,
/// and the two low parts are far enough apart in size that their plain sum rounds.
fn sloppy_witness() -> (Ds, Ds) {
    // `2^-25 - 3·2^-50` needs 25 bits: the sloppy sum rounds it, the two-sum keeps it.
    let a = from_hi_lo(1.0, wgsl::pow2(-25));
    let b = from_hi_lo(-1.0, -1.5 * wgsl::pow2(-49));
    (a, b)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A deterministic xorshift64*, so the tests need no dependency.
    struct Rng(u64);

    impl Rng {
        fn next(&mut self) -> u64 {
            self.0 ^= self.0 >> 12;
            self.0 ^= self.0 << 25;
            self.0 ^= self.0 >> 27;
            self.0.wrapping_mul(0x2545_f491_4f6c_dd1d)
        }

        /// Uniform in `[0, 1)`, 53 bits.
        fn unit(&mut self) -> f64 {
            (self.next() >> 11) as f64 * 2f64.powi(-53)
        }

        /// `±m · 2^e`, `m` in `[1, 2)` with a full 53-bit significand, `e` in `[lo, hi]`.
        fn value(&mut self, lo: i32, hi: i32) -> f64 {
            let e = lo + (self.next() % (hi - lo + 1) as u64) as i32;
            let m = 1.0 + self.unit();
            let s = if self.next() & 1 == 0 { 1.0 } else { -1.0 };
            s * m * 2f64.powi(e)
        }
    }

    /// `x` as an exact integer significand and exponent, `x == m · 2^e`.
    fn decompose(x: f32) -> (i128, i32) {
        let bits = x.to_bits();
        let field = ((bits >> 23) & 0xff) as i32;
        let frac = (bits & 0x7f_ffff) as i128;
        let (m, e) = if field == 0 {
            (frac, -149)
        } else {
            (frac | 0x80_0000, field - 150)
        };
        (if bits >> 31 == 1 { -m } else { m }, e)
    }

    /// Whether `Σ left == Σ right` exactly, in a common fixed point.
    fn sums_equal(left: &[f32], right: &[f32]) -> bool {
        let terms: Vec<(i128, i32)> = left.iter().chain(right).map(|&x| decompose(x)).collect();
        let base = terms
            .iter()
            .filter(|t| t.0 != 0)
            .map(|t| t.1)
            .min()
            .unwrap_or(0);
        let fixed = |x: f32| {
            let (m, e) = decompose(x);
            if m == 0 {
                return 0;
            }
            assert!(e - base < 100, "terms span too far to compare");
            m << (e - base)
        };
        left.iter().map(|&x| fixed(x)).sum::<i128>()
            == right.iter().map(|&x| fixed(x)).sum::<i128>()
    }

    /// The hazardous evaluations the self-test vectors must tell apart.
    fn split_fused(a: f32) -> (f32, f32) {
        let t = SPLITTER * a;
        let hi = t - SPLITTER.mul_add(a, -a);
        (hi, a - hi)
    }

    fn two_prod_fused(a: f32, b: f32) -> (f32, f32) {
        let p = a * b;
        let (ah, al) = split(a);
        let (bh, bl) = split(b);
        let e = (((-a).mul_add(b, ah * bh) + ah * bl) + al * bh) + al * bl;
        (p, e)
    }

    fn rel(got: Ds, want: f64) -> f64 {
        if want == 0.0 {
            assert_eq!(to_f64(got), 0.0);
            return 0.0;
        }
        ((got.hi as f64 - want) + got.lo as f64).abs() / want.abs()
    }

    fn normalized(a: Ds) -> bool {
        a.hi + a.lo == a.hi
    }

    #[test]
    fn two_sum_and_two_prod_are_error_free() {
        let mut rng = Rng(0x9e37_79b9_7f4a_7c15);
        for _ in 0..200_000 {
            let a = rng.value(-40, 40) as f32;
            let b = rng.value(-40, 40) as f32;
            let (s, e) = two_sum(a, b);
            assert_eq!(s, a + b);
            assert!(sums_equal(&[a, b], &[s, e]), "two_sum {a:e} {b:e}");
            if a.abs() >= b.abs() {
                assert_eq!(quick_two_sum(a, b), (s, e));
            }
            let (p, e) = two_prod(a, b);
            assert_eq!(p, a * b);
            // A product of two f32 is exact in f64, and so is `p + e`.
            assert_eq!(
                p as f64 + e as f64,
                a as f64 * b as f64,
                "two_prod {a:e} {b:e}"
            );
            assert_eq!(two_sqr(a), two_prod(a, a));
            let (h, l) = split(a);
            assert_eq!(h + l, a);
            assert!(decompose(h).0.unsigned_abs() >> decompose(h).0.trailing_zeros() < 1 << 12);
            assert!(decompose(l).0.unsigned_abs() >> decompose(l).0.trailing_zeros() < 1 << 12);
        }
        // Cancellation, exact and near.
        for (a, b) in [
            (1.0f32, -1.0f32),
            (0.1, -0.099_999_99),
            (3.0e7, -2.999_999_8e7),
        ] {
            let (s, e) = two_sum(a, b);
            assert!(sums_equal(&[a, b], &[s, e]));
        }
    }

    #[test]
    fn ds_add_and_mul_stay_within_bounds() {
        let mut rng = Rng(0x2545_f491_4f6c_dd1d);
        let (mut add_max, mut sloppy_max, mut mul_max, mut sqr_max) = (0f64, 0f64, 0f64, 0f64);
        let (mut cancel_max, mut f32_max) = (0f64, 0f64);
        for i in 0..200_000 {
            let x = from_f64(rng.value(-40, 40));
            // Every fourth pair cancels to 2^-k of its size, k up to 50.
            let y = if i % 4 == 0 {
                let k = 1 + (rng.next() % 50) as i32;
                from_f64(-to_f64(x) * (1.0 + (rng.unit() * 2.0 - 1.0) * 2f64.powi(-k)))
            } else {
                from_f64(rng.value(-40, 40))
            };
            let (a, b) = (to_f64(x), to_f64(y));
            let r = add(x, y);
            assert!(normalized(r));
            let e = rel(r, a + b);
            add_max = add_max.max(e);
            if i % 4 == 0 {
                cancel_max = cancel_max.max(e);
                if a + b != 0.0 {
                    sloppy_max = sloppy_max.max(rel(add_sloppy(x, y), a + b));
                }
            }
            let r = mul(x, y);
            assert!(normalized(r));
            mul_max = mul_max.max(rel(r, a * b));
            assert_eq!(sqr(x), mul(x, x));
            sqr_max = sqr_max.max(rel(sqr(x), a * a));
            let z = rng.value(-40, 40) as f32;
            f32_max = f32_max.max(rel(mul_f32(x, z), a * z as f64));
            f32_max = f32_max.max(rel(add_f32(x, z), a + z as f64));
        }
        eprintln!(
            "ds: max relative error add 2^{:.2} (cancelling 2^{:.2}, sloppy 2^{:.2}), \
             mul 2^{:.2}, sqr 2^{:.2}, f32 operand 2^{:.2}",
            add_max.log2(),
            cancel_max.log2(),
            sloppy_max.log2(),
            mul_max.log2(),
            sqr_max.log2(),
            f32_max.log2()
        );
        let bound = 2f64.powi(-44);
        assert!(add_max < bound && mul_max < bound && sqr_max < bound && f32_max < bound);
        // The sloppy add is what the kernel does not use, and this is why.
        assert!(sloppy_max > 2f64.powi(-30));
    }

    #[test]
    fn complex_helpers_match_f64() {
        let mut rng = Rng(0x1234_5678_9abc_def1);
        let mut worst = 0f64;
        for _ in 0..50_000 {
            let a = [from_f64(rng.value(-20, 20)), from_f64(rng.value(-20, 20))];
            let b = [from_f64(rng.value(-20, 20)), from_f64(rng.value(-20, 20))];
            let s = rng.value(-20, 20) as f32;
            let [ar, ai] = [to_f64(a[0]), to_f64(a[1])];
            let [br, bi] = [to_f64(b[0]), to_f64(b[1])];
            // Error measured against the operands' size, as a complex product's is.
            let check = |got: Cds, want: [f64; 2], size: f64| {
                ((to_f64(got[0]) - want[0]).abs() / size)
                    .max((to_f64(got[1]) - want[1]).abs() / size)
            };
            let na = ar.hypot(ai);
            let nb = br.hypot(bi);
            worst = worst.max(check(c_add(a, b), [ar + br, ai + bi], na + nb));
            worst = worst.max(check(c_sub(a, b), [ar - br, ai - bi], na + nb));
            worst = worst.max(check(
                c_mul(a, b),
                [ar * br - ai * bi, ar * bi + ai * br],
                na * nb,
            ));
            worst = worst.max(check(c_sqr(a), [ar * ar - ai * ai, 2.0 * ar * ai], na * na));
            worst = worst.max(check(
                c_scale(a, s),
                [ar * s as f64, ai * s as f64],
                na * s.abs() as f64,
            ));
        }
        eprintln!(
            "ds: complex helpers, max error relative to operand size 2^{:.2}",
            worst.log2()
        );
        assert!(worst < 2f64.powi(-44));
    }

    #[test]
    fn ldexp_scales_both_parts_and_flushes_lo_last() {
        let x = from_f64(core::f64::consts::PI);
        let y = ldexp(x, -60);
        assert_eq!(to_f64(y), to_f64(x) * 2f64.powi(-60));
        assert_eq!(ldexp(y, 60), x);
        // Far down, `lo` flushes first and the value is `hi` alone, still normalized.
        let z = ldexp(x, -125);
        assert_eq!(z.lo, 0.0);
        assert_eq!(z.hi, x.hi * wgsl::pow2(-125));
        assert!(normalized(z));
    }

    #[test]
    fn self_test_vectors_are_exact_and_discriminating() {
        let f = f32::from_bits;
        let vectors = self_test_vectors();
        for (op, inp, outp) in &vectors {
            let i: Vec<f32> = inp.iter().map(|&x| f(x)).collect();
            let o: Vec<f32> = outp.iter().map(|&x| f(x)).collect();
            match *op {
                "two_sum" | "quick_two_sum" => {
                    assert!(sums_equal(&i, &o), "{op} {i:?}");
                    // Reassociated, the error term is zero; every vector has one.
                    assert_ne!(o[1], 0.0, "{op} {i:?} does not discriminate");
                }
                "split" => {
                    assert_eq!(o[0] + o[1], i[0]);
                    // Reassociated, the split is `(a, 0)`.
                    assert_ne!(o[1], 0.0, "split {i:?} does not discriminate");
                    // Fused, it differs exactly on the significands near 2.
                    let near_two = i[0].abs() * wgsl::pow2(-wgsl::exponent_of(i[0])) > 1.999;
                    assert_eq!(split_fused(i[0]) != (o[0], o[1]), near_two, "split {i:?}");
                    let (fh, fl) = split_fused(i[0]);
                    assert_eq!(fh + fl, i[0]);
                }
                "two_prod" => {
                    assert_eq!(o[0] as f64 + o[1] as f64, i[0] as f64 * i[1] as f64);
                    assert_ne!(two_prod_fused(i[0], i[1]).1, o[1], "two_prod {i:?}");
                }
                "ds_add" | "ds_mul" => {
                    let (a, b) = (from_hi_lo(i[0], i[1]), from_hi_lo(i[2], i[3]));
                    let r = from_hi_lo(o[0], o[1]);
                    let want = if *op == "ds_add" {
                        to_f64(a) + to_f64(b)
                    } else {
                        to_f64(a) * to_f64(b)
                    };
                    assert!(rel(r, want) < 2f64.powi(-44), "{op} {i:?}");
                }
                _ => panic!("unknown op {op}"),
            }
        }
        // The |b| > |a| two_sum vector is one quick_two_sum gets wrong.
        let p30 = wgsl::pow2(-30);
        assert_ne!(quick_two_sum(p30, 1.0), two_sum(p30, 1.0));
        // And one ds_add vector is one the sloppy add gets wrong.
        let (a, b) = sloppy_witness();
        assert_ne!(add_sloppy(a, b), add(a, b));
        assert!(
            vectors
                .iter()
                .any(|v| v.0 == "ds_add" && v.1[0] == a.hi.to_bits() && v.1[1] == a.lo.to_bits())
        );
        // A fused two_prod inside ds_mul changes the answer too.
        let (x, y) = (
            from_f64(core::f64::consts::PI),
            from_f64(core::f64::consts::E),
        );
        let (p, e) = two_prod_fused(x.hi, y.hi);
        let fused = renormalize(p, e + (x.hi * y.lo + x.lo * y.hi));
        assert_ne!(fused, mul(x, y));
    }
}
