//! The interior proof, restated in `f32`, `i32` and `u32`: `perturb`'s `Kernel::prove`
//! (interior_switch_fix_ckpt162) as a module a WGSL kernel can call once per step. Both
//! kernels call it ([`crate::model`] with the `f32` margins in [`crate::Frame`],
//! [`crate::model_ds`] with the double-single ones in [`crate::FrameLo`]), behind the old
//! `|dz|²` threshold, which is now only the gate.
//!
//! # The rule being ported
//!
//! The old `|dz|² < 2^floor` test is only a **gate**. A gated sample runs on, and stops as
//! interior only when a disc about its orbit maps into itself: `B(z_{s+k}, ρ_k) ⊂ B(z_s,
//! ρ₀)` for some `k ≥ 1`. The image of a disc of radius `ρ` about `z` under `z^D + c` lies
//! within `(|z| + ρ)^D − |z|^D` of `f(z)`, so the radius is carried exactly, a step at a
//! time. The disc is anchored at the lowest `|z|` since the gate and re-anchored at every
//! new low after that step's test; [`RADII`] radii are tried at once, a power of two apart;
//! a disc is carried as long past its anchor as the gate took (at least
//! [`PROOF_MIN_BUDGET`] steps), and then the sample runs on unproven, still gated, until a
//! new low re-arms it. Beside a parabolic point no disc closes, since a disc mapped into
//! itself holds an attracting fixed point of `f^k` that an escaping orbit does not have.
//!
//! # The interface
//!
//! [`Proof`] is a 72-byte `Copy` struct that lives in the pixel's state. Its life:
//!
//! 1. [`Proof::IDLE`] until the gate fires; then [`Proof::arm`] with the gated step's `z`,
//!    its `δ`, and `n`. That anchors the first disc.
//! 2. After every later step's escape test, [`Proof::advance`] with the new `z` and `δ`
//!    (before the rebase, where `Kernel::prove` makes its test): it carries every disc a
//!    step, returns `true` when one has come back inside itself (the sample is interior),
//!    and then applies the re-arm rule ([`Proof::rearm_if_lower`]).
//! 3. Whenever the loop rebases (`δ := z`, `m := 0`) while gated, [`Proof::rebased`]: the
//!    iterate the discs are about moves by the reference's rounding there, and the radii
//!    take the move. A skip ([`crate::bla`]) carries no disc across it:
//!    [`Proof::break_disc`], and the sample waits for a new low.
//! 4. **At the cap, [`Proof::gated`] is the fallback**: a sample still gated there is
//!    "gated, unproven", which the caller paints as capped (interior as far as the picture
//!    is concerned, the cap's verdict and not the proof's) or hands to the CPU's `f64`
//!    kernel when it must know.
//!
//! `z` comes in as an [`Iterate`], `(v + lo) · 2^e`: the model's `zv` and `ze` with `lo`
//! zero, or a double-single kernel's pair, with the orbit's flush term
//! ([`Iterate::read_from`]). `δ` comes in as `d · 2^s`, its leading part.
//!
//! # What changed to fit the types, and why
//!
//! - **Everything with a range is a [`Mag`]**, an `f32` mantissa in `[1, 2)` and an `i32`
//!   exponent, rounded up by every operation that forms one. A radius runs from `2^-14`
//!   of a `|z|` that may itself be `2^-500` (a scaled pixel at a minibrot's nucleus) up to
//!   the bailout, and `ρ^D` leaves `f32` within a step at either end.
//! - **The radii start at powers of two**: `ρ₀ = 2^(ce − 2 − spacing·i)`, with `ce` the
//!   exponent of the anchor's larger component, so `ρ₀ ≤ |z_s|/4` as `perturb`'s is and
//!   each is an exact number that needs no storage. `spacing` is 8 (`perturb`'s 256) for a
//!   double-single kernel and 4 for an `f32` one, whose smallest disc must stay well
//!   above `f32`'s resolution of `z_s` (`2^-14` of it against `perturb`'s `2^-26`).
//! - **The disc is about the iterate the kernel represents, and the step's own error is
//!   carried into its radius.** This is the substantive change, and the next section says
//!   why `f32` forces it.
//!
//! # What "sound" means, and what f32 changes
//!
//! `perturb` makes the proof about the orbit its kernel computes: the radii carry the
//! exact map's image of a disc about each computed iterate, and the next computed iterate
//! is taken to be that image's centre, with only an absolute margin of about thirty ulps
//! at the containment test. Each step's own rounding is not carried. In `f64` that
//! rounding is `2^-53` beside discs of `2^-26` and up.
//!
//! **In `f32` that claim is unsound, measured.** At `c = 1/4` exactly (the main cusp, on
//! the boundary, with no attracting cycle) an `f32` orbit stalls on a fixed point of the
//! rounded map, `z = fl(z² + 1/4)` about `2^-12` below `1/2`, some thousands of steps in.
//! There `|f'|` is about `1 − 2^-11` and the computed iterates stand still, so a disc
//! carried without the step's rounding contracts onto its own centre and closes: the
//! margins of `perturb`'s kind, transcribed at `f32`'s scale, prove the cusp interior at
//! `n = 30,120`, armed by the gate on the stalled orbit
//! (`tests::shipped_style_margins_prove_the_cusp`). The true map moves each of those
//! iterates by the rounding the kernel threw away, and that is what the disc's
//! contraction was spent on.
//!
//! So the port carries it. Write `Z_m` for the **exact** reference orbit (`perturb`'s
//! fixed-point one, whose truncation is taken as exact, as `perturb` takes it), `Ẑ_m` for
//! the point the buffer stores, `δ_j` for the delta the kernel holds (an exact number),
//! `c = c_ref + dc` with `dc` the exact `f32` mantissa and exponent the kernel adds, and
//! `w_j = Z_{m_j} + δ_j` for the iterate the state represents. Then `f_c(w_j) = Z_{m+1} +
//! δ*_{j+1}` with `δ*` the exact delta step, so **the step's defect `|f_c(w_j) − w_{j+1}|`
//! is the error of the computed delta alone**, a quantity of `δ`'s size and not of `Z`'s;
//! this is what keeps the proof possible at depth. The discs are carried about `w_j`:
//!
//! ```text
//! ρ_{j+1} ≥ (|w_j| + ρ_j)^D − |w_j|^D + e_{j+1},    e_{j+1} ≥ |f_c(w_j) − w_{j+1}|
//! ```
//!
//! and the containment test asks `|w_{s+k} − centre| + ρ_k < ρ₀` with `|w − ẑ|` (the
//! computed `z` against the represented one, the reference's rounding plus the rounding of
//! `Ẑ + δ`) bounded at the test only. By induction, `f_c^k` maps the closed disc
//! `B̄(centre, ρ₀)` into `B̄(w_{s+k}, ρ_k)`, which lies inside the open `B(centre, ρ₀)`.
//!
//! **What a proof then says.** A holomorphic map of a disc into a compact subset of itself
//! has an attracting fixed point there (Schwarz–Pick), so `f_c` has an attracting cycle.
//!
//! - **On a Mandelbrot plane that is the verdict itself**: `c` lies in a hyperbolic
//!   component, in the interior of the set, whatever the kernel's orbit before the anchor
//!   was. The claim is about the sample's parameter as the kernel holds it, `c_ref + dc`,
//!   and needs nothing about how far the computed orbit drifted on the way in, which is
//!   more than `perturb`'s proof claims.
//! - **On a Julia plane** it says the represented iterate `w_s` lies in the attracting
//!   basin. The sample's own point lies in it only if the kernel's error up to `s` left
//!   its true orbit inside the disc, which nothing bounds: the same limit `perturb`
//!   states, that the proof is about the orbit the kernel computes.
//!
//! **The limits, all of them.** (1) The defect bound `e` is an a-priori bound from
//! operation counts under the standard model of rounding (each `f32` operation within
//! `2^-24` relative; WGSL's own looser builtins named where they are read), with a factor
//! of two to spare; it is not checked by interval arithmetic, and a backend that breaks
//! the model (a reassociated double-single sum, a flush the analysis did not foresee)
//! breaks the claim. (2) The periodic wrap is taken as exact, `Z[len] = Z[0] = 0`, as
//! `perturb` takes it. (3) A skip's linearization error is not carried, hence
//! [`Proof::break_disc`]. (4) **What `f32` costs is completeness, not soundness**: the
//! defect a return gathers is about `k · κ_step · |δ|` (each step's, carried on by the
//! derivative from there), and a disc closes only where that is well under the disc,
//! roughly `k · κ_step·|δ| < (1 − |λ|)·ρ₀`. At degree two `κ_step` is `2^-18` in an `f32`
//! kernel and `2^-38` in a double-single one on a `HiLo` reference. So an `f32` kernel
//! proves cycles of thousands of steps when `|δ|` is near `|z|` and far longer ones when
//! the pixel shadows its reference, and misses a cycle whose closest approach to the
//! critical point is far below its defect, since every disc starts at a quarter of that
//! approach (`tests::f32_cannot_prove_every_cycle`: a period-4 centre, the period-4 point
//! near `−1.9408`, and the period-16 band at `−1.4`, all proved on double-single margins).
//! A sample that cannot close runs gated to its cap, black either way.
//!
//! # The margins, derived
//!
//! [`Margins`] is per frame, built on the CPU in `f64`, and holds every margin as a power
//! of two the loop applies by exponent arithmetic. With `u` the delta arithmetic's unit
//! roundoff (`2^-24` for `f32`; `2^-44` for a double-single kernel, generous against its
//! operations' `2^-46` to `2^-48`) and `u_Z` the stored reference's relative error
//! (`2^-23` for [`Encoding::F32Pair`], whose `hi` may be an ulp off the correctly rounded
//! `f32` (see [`crate::orbit`]), and for either encoding read by an `f32` kernel, which
//! forms `Z^j` from `hi` alone; `2^-47` for `HiLo` read as a double-single pair):
//!
//! - **The step's defect**, `e = κ_step · M^(D−1) · |δ_j| + κ_add · |δ_{j+1}|`, with
//!   `M = |w_j| + 2|δ_j|`, which bounds `|Z_m| + |δ_j|` since `|Ẑ_m| ≤ |ẑ_j| + |δ_j|`.
//!   Forming `F(Ẑ, δ) = Σ C(D,k)·Ẑ^(D−k)·δ^(k−1)` in Horner form and multiplying by `δ`
//!   costs at most `c_D = 3(D−2) + 5(D−1) + 4` roundings relative to `F̄ = Σ C(D,k)·|Z|^(D−k)
//!   ·|δ|^(k−1) ≤ D·M^(D−1)` (the powers of `Z`, the Horner levels with their binomial
//!   products, the complex product, the careful path's flush of a term `2^-126` below its
//!   sum). Reading `Ẑ` for `Z` moves `F` by `|∂F/∂Z| · u_Z|Z| ≤ D(D−1)·M^(D−2)·u_Z|Z|`.
//!   So `κ_step = 2D·(c_D·u + (D−1)·u_Z)`. The add of `dc` rounds once more relative to
//!   `δ_{j+1}`: `κ_add = 4u` (`2u`, doubled).
//! - **The point**, `|ẑ − w| ≤ κ_pt · (|ẑ| + |δ|)`: the rounding of `Ẑ + δ` (two, under
//!   `HiLo`'s `hi + (lo + δ)`) and the reference's own, `u_Z|Z| ≤ u_Z(|ẑ| + |δ|)`. So
//!   `κ_pt = 2(2u + u_Z)`. Read at the anchor (the disc about the centre holds `w_s`
//!   only after its radius takes the difference), at the test, and at a rebase, where
//!   `δ := ẑ` moves `w` by that much.
//! - **The flush**, `2^-flush` absolute ([`crate::orbit::GpuOrbit::flush`], carried in
//!   [`Iterate::flush`]). `u_Z` is a relative bound, and the buffer breaks it where
//!   `orbit::narrow` stored a component (or `HiLo`'s `lo`) below `f32`'s normal range as
//!   zero: there `|Ẑ − Z|` may reach `2^-126` a component, more than `|Z|` itself, and at
//!   exactly the low-`|z|` steps the proof anchors on. Where the orbit flushed anything the
//!   point margin gains `2^-flush` and the step's defect `2D(D−1)·M^(D−2)·|δ_j|·2^-flush`
//!   (`2^6` covers `2D(D−1)` to degree 6). The term is frame-wide rather than per point,
//!   because a stored zero cannot say whether it was flushed; where nothing was, it is off
//!   and nothing moves. **`flush` is measured**: the largest flushed component, which is
//!   exactly the error it left, rounded up to a power of two with the pair's `√2`
//!   ([`crate::orbit::flush_bound`]); `2^-125` ([`crate::orbit::FLUSH`]) is that bound at
//!   its loosest. It was the constant `2^-125` until a deep minibrot showed what that
//!   costs: the flushed points are the nucleus's returns, `2^-268` and `2^-322` on the D
//!   frames, and a `2^-125` margin beside discs of `2^-155` to `2^-290` closed none of
//!   them, where the measured one closes every sample at `perturb`'s 622 steps. The
//!   measured term covers a stored zero only if the kernel reads the iterate there as
//!   `Z · 2^-s + d` (`model::reads_scaled`): formed unscaled with `s` below `-187`, `δ`
//!   underflowed and `ẑ` was `0`, an error of `|δ|` that `2^-125` had covered by accident.
//!   It costs only discs whose radii are within a few powers of two of the measured term,
//!   so a frame whose reference skims `2^-126` at some unrelated step still pays `2^-125`
//!   everywhere; carrying an exponent per point would remove that (README, *Deep
//!   interior*).
//! - **The radius recurrence's own rounding**, [`GROW`]: `(|w| + ρ)^D − |w|^D` is formed in
//!   units where the larger of the two is in `[1, 2)`, as `ρ · g` with `g = Σ_{j=1..D}
//!   C(D,j)·|w|^(D−j)·ρ^(j−1)`, a sum of positive terms, at most `3D − 1 ≤ 17` roundings:
//!   under `2^-19.9`. `GROW = 1 + 2^-18` covers it with room, and since radii are `f32` in
//!   either kernel it does not depend on the precision. Over a cycle of `p` steps it costs
//!   a factor `e^(p · 2^-18)` on the multiplier a disc must beat.
//! - **Every other magnitude** is rounded up by `1 + 2^-20` per add or product (two
//!   roundings, `2^-23`) and `1 + 2^-19` per square root (WGSL's `sqrt` is about 4.5 ULP).
//!
//! `perturb`'s `2^-40` per step and `2^-48` at the test are this derivation at `f64` with
//! the step's defect left out.

use crate::orbit::Encoding;
use crate::wgsl::{exponent_of, exponent_of_max, ldexp_exact, sqrt};

/// Discs tried about one anchor, as in `perturb`.
pub const RADII: usize = 4;

/// The fewest steps a disc is carried past its anchor, however early the gate fired.
pub const PROOF_MIN_BUDGET: u32 = 4096;

/// Not gated: [`Proof::advance`] does nothing.
pub const IDLE: u32 = 0;
/// Gated, with discs carried from the current anchor.
pub const CARRYING: u32 = 1;
/// Gated, the discs given up (past their budget, all dead, or broken by a skip): waiting
/// for a new low `|z|` to re-arm.
pub const WAITING: u32 = 2;

/// A margin exponent of zero switches its term off: `κ = 1` is never a margin.
pub const OFF: i32 = 0;

/// What one [`Proof`] takes in per-pixel state.
pub const PROOF_BYTES: usize = 72;

/// The exponent [`Mag::ZERO`] carries: below any other, so a maximum of two exponents
/// is the other one.
const ZERO_E: i32 = -100_000;
/// A radius at `2^14` or more is dead. Past 1 a radius never shrinks again (`(a + ρ)^D −
/// a^D ≥ ρ^D ≥ ρ`), and every `ρ₀` is at most `|z_s|/4 < 2^14`, so it can never prove;
/// pinning it here keeps its exponent from growing `D`-fold a step.
const DEAD_E: i32 = 14;

/// Rounds a sum or a product up: it has at most two roundings of `2^-24` in it.
const UP: f32 = 1.0 + 1.0 / 1_048_576.0; // 1 + 2^-20
/// Rounds a magnitude up: WGSL's `sqrt`, its argument's three roundings, and this multiply.
const UP_SQRT: f32 = 1.0 + 1.0 / 524_288.0; // 1 + 2^-19
/// Rounds a carried radius up. See the module doc.
pub const GROW: f32 = 1.0 + 1.0 / 262_144.0; // 1 + 2^-18

/// A non-negative magnitude, `m · 2^e`, with `m` in `[1, 2)`, or zero. Everything the
/// proof forms as one is an upper bound on the quantity it names. WGSL: a struct of an
/// `f32` and an `i32`, 8 bytes.
#[repr(C)]
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Mag {
    pub m: f32,
    pub e: i32,
}

impl Mag {
    pub const ZERO: Mag = Mag { m: 0.0, e: ZERO_E };

    /// `2^e`, exactly.
    pub const fn pow2(e: i32) -> Mag {
        Mag { m: 1.0, e }
    }

    #[inline(always)]
    fn is_zero(self) -> bool {
        self.m == 0.0
    }

    /// The value, for tests and the harness.
    pub fn to_f64(self) -> f64 {
        if self.is_zero() {
            0.0
        } else {
            self.m as f64 * 2f64.powi(self.e)
        }
    }
}

/// `m · 2^e` for a finite `m ≥ 0`, put in [`Mag`]'s form. Exact.
#[inline(always)]
fn settle(m: f32, e: i32) -> Mag {
    let x = exponent_of(m);
    if x == -127 {
        return Mag::ZERO;
    }
    Mag {
        m: ldexp_exact(m, -x),
        e: e + x,
    }
}

/// `|v| · 2^e`, rounded up: `v` rescaled by its own exponent, so that nothing over- or
/// underflows whatever `e` is. A component `2^126` below the other flushes to zero, which
/// moves the square by `2^-250` of itself.
#[inline(always)]
fn mag_of(v: [f32; 2], e: i32) -> Mag {
    let x = exponent_of_max(v[0], v[1]);
    if x == -127 {
        return Mag::ZERO;
    }
    let a = ldexp_exact(v[0], -x);
    let b = ldexp_exact(v[1], -x);
    settle(sqrt(a * a + b * b) * UP_SQRT, e + x)
}

/// `a + b`, rounded up, added at the larger exponent. The smaller term flushes to zero
/// only `2^126` below the larger, inside the rounding up.
#[inline(always)]
fn add(a: Mag, b: Mag) -> Mag {
    if a.is_zero() {
        return b;
    }
    if b.is_zero() {
        return a;
    }
    let at = if a.e > b.e { a.e } else { b.e };
    let sum = ldexp_exact(a.m, a.e - at) + ldexp_exact(b.m, b.e - at);
    settle(sum * UP, at)
}

/// `a · b`, rounded up.
#[inline(always)]
fn mul(a: Mag, b: Mag) -> Mag {
    if a.is_zero() || b.is_zero() {
        return Mag::ZERO;
    }
    settle(a.m * b.m * UP, a.e + b.e)
}

/// `a · 2^k`, exactly.
#[inline(always)]
fn scale(a: Mag, k: i32) -> Mag {
    if a.is_zero() {
        return Mag::ZERO;
    }
    Mag { m: a.m, e: a.e + k }
}

/// `a < b`, exactly: both are in [`Mag`]'s form.
#[inline(always)]
fn lt(a: Mag, b: Mag) -> bool {
    if b.is_zero() {
        return false;
    }
    if a.is_zero() {
        return true;
    }
    if a.e != b.e {
        return a.e < b.e;
    }
    a.m < b.m
}

/// `C(d, k)` for `k = 0..=d`, as the `f32` the radius step multiplies by. Exact.
const fn binomial(d: usize) -> [f32; 7] {
    let mut out = [0.0f32; 7];
    let mut k = 0;
    while k <= d {
        let mut value = 1u32;
        let mut i = 0;
        while i < k {
            value = value * (d - i) as u32 / (i + 1) as u32;
            i += 1;
        }
        out[k] = value as f32;
        k += 1;
    }
    out
}

/// `(a + ρ)^D − a^D`, rounded up by [`GROW`]: in the unit `2^u` where the larger of `a`
/// and `ρ` is in `[1, 2)`, it is `ρ · g` with `g = Σ_{j=1..D} C(D,j)·â^(D−j)·ρ̂^(j−1)`, a
/// sum of positive terms, at least 1 and at most `2^(D−1)·(2^D − 1)`, formed in Horner
/// form in `ρ̂`. `ρ`'s own mantissa multiplies `g`, so a `ρ̂` that flushed beside `a`
/// loses only its higher terms, `2^-126` of `g` and below.
#[inline(always)]
pub fn carry_radius<const D: usize>(a: Mag, r: Mag) -> Mag {
    let u = if a.e > r.e { a.e } else { r.e };
    let ah = ldexp_exact(a.m, a.e - u);
    let rh = ldexp_exact(r.m, r.e - u);
    let b = const { binomial(D) };
    // `pw[k] = â^k`.
    let mut pw = [1.0f32; 7];
    let mut k = 1;
    while k < D {
        pw[k] = pw[k - 1] * ah;
        k += 1;
    }
    // `q_D = C(D,D)·â^0 = 1`, then down to `q_1 = D·â^(D−1)`.
    let mut h = 1.0f32;
    let mut j = D - 1;
    while j >= 1 {
        h = h * rh + b[j] * pw[D - j];
        j -= 1;
    }
    settle(h * r.m * GROW, r.e + (D as i32 - 1) * u)
}

/// How the kernel's arithmetic is carried, for [`Margins::new`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Precision {
    /// `f32` deltas: [`crate::model`]'s kernel.
    F32,
    /// Double-single deltas ([`crate::ds`]), a pair of `f32` per component.
    DoubleSingle,
}

/// The proof's margins for one frame, each a power of two `2^-k` stored as `k`, and the
/// rung spacing. The module doc derives them. A field may be set to [`OFF`] to measure
/// what a margin costs; with `step` and `add` off the claim is `perturb`'s, which is not
/// sound at `f32`. Four `i32`, 16 bytes, so that it sits in a uniform buffer as it stands.
#[repr(C)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Margins {
    /// `ρ₀` of disc `i` is `2^(ce − 2 − spacing·i)`.
    pub spacing: i32,
    /// `κ_pt`: `|ẑ − w| ≤ 2^-point · (|ẑ| + |δ|)`.
    pub point: i32,
    /// `κ_step`: the step's defect on `M^(D−1)·|δ_j|`.
    pub step: i32,
    /// `κ_add`: the step's defect on `|δ_{j+1}|`.
    pub add: i32,
}

impl Margins {
    /// The margins for a kernel of this degree, delta precision, and reference encoding.
    /// CPU-side setup, in `f64`.
    pub fn new(degree: u32, precision: Precision, encoding: Encoding) -> Margins {
        let d = degree as f64;
        let (u, uz, spacing) = match (precision, encoding) {
            (Precision::F32, _) => (2f64.powi(-24), 2f64.powi(-23), 4),
            (Precision::DoubleSingle, Encoding::F32Pair) => (2f64.powi(-44), 2f64.powi(-23), 8),
            (Precision::DoubleSingle, Encoding::HiLo) => (2f64.powi(-44), 2f64.powi(-47), 8),
        };
        let c_d = 3.0 * (d - 2.0) + 5.0 * (d - 1.0) + 4.0;
        // The largest power of two at least as large as `κ`, as its negated exponent.
        let exponent = |kappa: f64| (-kappa.log2()).floor() as i32;
        Margins {
            spacing,
            point: exponent(2.0 * (2.0 * u + uz)),
            step: exponent(2.0 * d * (c_d * u + (d - 1.0) * uz)),
            add: exponent(4.0 * u),
        }
    }
}

/// An iterate as the kernel holds it: `z = (v + lo) · 2^e`. An `f32` kernel passes the
/// model's `zv` and `ze` with `lo` zero; a double-single kernel its `hi` and `lo`.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Iterate {
    pub v: [f32; 2],
    pub lo: [f32; 2],
    pub e: i32,
    /// The reference's absolute error beyond `u_Z`, `2^-flush`, or [`OFF`]: the orbit's
    /// [`crate::orbit::GpuOrbit::flush`], through [`Iterate::read_from`].
    pub flush: i32,
}

impl Iterate {
    /// An `f32` iterate, `v · 2^e`.
    pub fn single(v: [f32; 2], e: i32) -> Iterate {
        Iterate {
            v,
            lo: [0.0, 0.0],
            e,
            flush: OFF,
        }
    }

    /// A double-single iterate, `(hi + lo) · 2^e`.
    pub fn pair(hi: [f32; 2], lo: [f32; 2], e: i32) -> Iterate {
        Iterate {
            v: hi,
            lo,
            e,
            flush: OFF,
        }
    }

    /// The same iterate, formed from a reference whose stored points may be off by
    /// `2^-flush` absolute ([`crate::orbit::GpuOrbit::flush`]).
    pub fn read_from(self, flush: i32) -> Iterate {
        Iterate { flush, ..self }
    }
}

/// The flush term, `2^-flush`, or zero when it is [`OFF`].
#[inline(always)]
fn flush_term(flush: i32) -> Mag {
    if flush == OFF {
        Mag::ZERO
    } else {
        Mag::pow2(-flush)
    }
}

/// `2D(D−1)` at every degree the kernel takes is at most 60, under `2^6`: the flush
/// term's factor in the step's defect.
const FLUSH_STEP: i32 = 6;

/// The proof's per-pixel state. Plain `f32`, `i32` and `u32`, laid out as WGSL would lay
/// out the same struct: four [`Mag`]s at 0, the centre's `vec2<f32>` at 32 (8-aligned),
/// then 4-byte scalars, 72 bytes with no padding.
#[repr(C)]
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Proof {
    /// `ρ_k` of each disc, about the represented iterate; dead at `2^DEAD_E`.
    pub radius: [Mag; RADII],
    /// The anchor, `centre · 2^centre_e`, its larger component in `[1, 2)`: the disc's
    /// centre is this exact number, `ẑ_s`'s leading part.
    pub center: [f32; 2],
    pub center_e: i32,
    /// `|w_j|` of the last iterate, rounded up: what the next step's radii grow from.
    pub from: Mag,
    /// `|δ_j|` of the last iterate, rounded up: what the next step's defect is sized by.
    pub delta: Mag,
    /// `n` at the anchor.
    pub anchored: u32,
    /// How many steps past its anchor a disc is carried.
    pub budget: u32,
    /// [`IDLE`], [`CARRYING`] or [`WAITING`].
    pub phase: u32,
}

impl Proof {
    /// A sample the gate has not fired on.
    pub const IDLE: Proof = Proof {
        radius: [Mag::ZERO; RADII],
        center: [0.0, 0.0],
        center_e: 0,
        from: Mag::ZERO,
        delta: Mag::ZERO,
        anchored: 0,
        budget: 0,
        phase: IDLE,
    };

    /// The gate has fired and no proof has closed: at the cap, "gated, unproven".
    pub fn gated(&self) -> bool {
        self.phase != IDLE
    }

    /// Every field's bits, in layout order, for bit-identity tests.
    pub fn bits(&self) -> [u32; 18] {
        let mut out = [0u32; 18];
        for (i, r) in self.radius.iter().enumerate() {
            out[2 * i] = r.m.to_bits();
            out[2 * i + 1] = r.e as u32;
        }
        out[8] = self.center[0].to_bits();
        out[9] = self.center[1].to_bits();
        out[10] = self.center_e as u32;
        out[11] = self.from.m.to_bits();
        out[12] = self.from.e as u32;
        out[13] = self.delta.m.to_bits();
        out[14] = self.delta.e as u32;
        out[15] = self.anchored;
        out[16] = self.budget;
        out[17] = self.phase;
        out
    }

    /// Arms the proof at the step the gate fired on: `z` and `δ = d · 2^s` that step's,
    /// `n` its count. The first disc is anchored there, and every disc is carried for
    /// `max(n, PROOF_MIN_BUDGET)` steps past its anchor.
    pub fn arm(z: Iterate, d: [f32; 2], s: i32, n: u32, margins: &Margins) -> Proof {
        let mut proof = Proof::IDLE;
        proof.budget = if n > PROOF_MIN_BUDGET {
            n
        } else {
            PROOF_MIN_BUDGET
        };
        let mv = mag_of(z.v, z.e);
        proof.anchor(z, mv, mag_of(d, s), n, margins);
        proof
    }

    /// Carries every disc one step to the iterate `z` (with `δ = d · 2^s`, before any
    /// rebase), at count `n`, and returns `true` if one has come back inside the disc it
    /// started as: the sample is interior. Otherwise re-anchors at a new low `|z|`. Does
    /// nothing on a sample that is not gated.
    #[inline(always)]
    pub fn advance<const D: usize>(
        &mut self,
        z: Iterate,
        d: [f32; 2],
        s: i32,
        n: u32,
        margins: &Margins,
    ) -> bool {
        if self.phase == IDLE {
            return false;
        }
        let mv = mag_of(z.v, z.e);
        if self.phase == WAITING {
            // Nothing is carried: only a new low matters, and `from` and `delta` are set
            // afresh by the anchor. A parabolic sample spends most of its gated steps
            // here, so this is the cheap path.
            if self.lower(mv) {
                self.anchor(z, mv, mag_of(d, s), n, margins);
            }
            return false;
        }
        let dmag = mag_of(d, s);
        if n.wrapping_sub(self.anchored) > self.budget {
            self.phase = WAITING;
        }
        if self.phase == CARRYING && self.carry::<D>(z, mv, dmag, margins) {
            return true;
        }
        if self.lower(mv) {
            self.anchor(z, mv, dmag, n, margins);
        } else {
            self.from = add(mv, offset(z, mv, dmag, margins));
            self.delta = dmag;
        }
        false
    }

    /// The re-arm rule on its own: a gated sample whose `|z|` is below its anchor's is
    /// anchored again there, with a fresh budget. [`Proof::advance`] applies it after its
    /// test; a caller that steps without advancing (past a skip) may apply it directly.
    /// Returns whether it re-anchored.
    pub fn rearm_if_lower(
        &mut self,
        z: Iterate,
        d: [f32; 2],
        s: i32,
        n: u32,
        margins: &Margins,
    ) -> bool {
        let mv = mag_of(z.v, z.e);
        if self.phase == IDLE || !self.lower(mv) {
            return false;
        }
        self.anchor(z, mv, mag_of(d, s), n, margins);
        true
    }

    /// The loop rebased (`δ := z`, `m := 0`) after the last [`Proof::advance`]. The
    /// represented iterate moves from `Z_m + δ` to `ẑ` by at most `κ_pt·(|ẑ| + |δ|)`, plus
    /// the flush term `2^-flush` (the orbit's [`crate::orbit::GpuOrbit::flush`]), so every
    /// live disc grows by that, and the next step's `|δ|` is `|ẑ|`.
    pub fn rebased(&mut self, margins: &Margins, flush: i32) {
        if self.phase == IDLE {
            return;
        }
        if self.phase == CARRYING {
            let jump = add(
                scale(add(self.from, self.delta), -margins.point),
                flush_term(flush),
            );
            for r in self.radius.iter_mut() {
                if r.e < DEAD_E {
                    *r = add(*r, jump);
                }
            }
        }
        self.delta = self.from;
    }

    /// The loop moved `z` by more than one step (a skip): no disc is carried across that.
    /// The sample stays gated and waits for a new low.
    pub fn break_disc(&mut self) {
        if self.phase == CARRYING {
            self.phase = WAITING;
        }
    }

    /// `|z|` below the anchor's, both as [`mag_of`] forms them. Never, below an anchor
    /// that is exactly zero.
    #[inline(always)]
    fn lower(&self, mv: Mag) -> bool {
        lt(mv, mag_of(self.center, self.center_e))
    }

    /// Anchors the discs at `z`. The disc is about the exact number `centre`, and its
    /// carried radius starts at `ρ₀` plus the distance from the centre to the represented
    /// iterate (`lo` and the point margin), so it holds the iterate the next step grows
    /// from.
    fn anchor(&mut self, z: Iterate, mv: Mag, dmag: Mag, n: u32, margins: &Margins) {
        let off = offset(z, mv, dmag, margins);
        let x = exponent_of_max(z.v[0], z.v[1]);
        if x == -127 {
            // `z` exactly zero: the orbit passed through the critical point, and a disc of
            // a quarter of `|δ|` (or of `2^-120`) is a guess like any other.
            self.center = [0.0, 0.0];
            self.center_e = if dmag.is_zero() { -120 } else { dmag.e };
        } else {
            self.center = [ldexp_exact(z.v[0], -x), ldexp_exact(z.v[1], -x)];
            self.center_e = z.e + x;
        }
        let mut i = 0;
        while i < RADII {
            self.radius[i] = add(Mag::pow2(rung(self.center_e, i, margins)), off);
            i += 1;
        }
        self.from = add(mv, off);
        self.delta = dmag;
        self.anchored = n;
        self.phase = CARRYING;
    }

    /// One step of every live disc, then the containment test against the anchor.
    #[inline(always)]
    fn carry<const D: usize>(&mut self, z: Iterate, mv: Mag, dmag: Mag, margins: &Margins) -> bool {
        // The step's defect, sized by the last iterate and this one's delta.
        let mut defect = Mag::ZERO;
        if margins.step != OFF {
            let m = add(self.from, scale(self.delta, 1));
            let mut p = self.delta;
            let mut k = 1;
            while k < D - 1 {
                p = mul(p, m);
                k += 1;
            }
            // `p = |δ|·M^(D−2)`. A flushed reference point moves `F` by up to
            // `D(D−1)·M^(D−2)·2^-flush` beyond `u_Z|Z|`, doubled to spare.
            if z.flush != OFF {
                defect = scale(p, FLUSH_STEP - z.flush);
            }
            p = mul(p, m);
            defect = add(defect, scale(p, -margins.step));
        }
        if margins.add != OFF {
            defect = add(defect, scale(dmag, -margins.add));
        }
        // `|w − centre|` rounded up, or nothing when `z` is too far out to be inside.
        let near = distance(z, self.center, self.center_e)
            .map(|dist| add(dist, point_margin(z, mv, dmag, margins)));
        let mut proven = false;
        let mut live = false;
        let mut i = 0;
        while i < RADII {
            let r = self.radius[i];
            if r.e < DEAD_E {
                let next = add(carry_radius::<D>(self.from, r), defect);
                if next.e >= DEAD_E {
                    self.radius[i] = Mag::pow2(DEAD_E);
                } else {
                    self.radius[i] = next;
                    live = true;
                    if let Some(far) = near
                        && lt(add(far, next), Mag::pow2(rung(self.center_e, i, margins)))
                    {
                        proven = true;
                    }
                }
            }
            i += 1;
        }
        if !live {
            self.phase = WAITING;
        }
        proven
    }
}

/// `ρ₀`'s exponent for disc `i`.
#[inline(always)]
fn rung(center_e: i32, i: usize, margins: &Margins) -> i32 {
    center_e - 2 - margins.spacing * i as i32
}

/// `|ẑ − w|`: `κ_pt · (|ẑ| + |δ|)`, plus the flush term where the orbit has one.
#[inline(always)]
fn point_margin(z: Iterate, mv: Mag, dmag: Mag, margins: &Margins) -> Mag {
    add(scale(add(mv, dmag), -margins.point), flush_term(z.flush))
}

/// `|ẑ − w|` plus `|lo|`: how far the represented iterate can be from `v · 2^e`.
#[inline(always)]
fn offset(z: Iterate, mv: Mag, dmag: Mag, margins: &Margins) -> Mag {
    add(mag_of(z.lo, z.e), point_margin(z, mv, dmag, margins))
}

/// `|ẑ − centre · 2^ce|`, rounded up, formed at the centre's exponent as `(v − centre) +
/// lo` (the low part last, so a double-single `z` keeps its precision). `None` where
/// `|z| ≥ 2^(ce+3)`: then `|z − centre| > 2^(ce+2)`, past every `ρ₀`, and the shift into
/// the centre's units could overflow. Its two roundings are inside [`mag_of`]'s.
#[inline(always)]
fn distance(z: Iterate, center: [f32; 2], center_e: i32) -> Option<Mag> {
    let x = exponent_of_max(z.v[0], z.v[1]);
    if x != -127 && x + z.e > center_e + 2 {
        return None;
    }
    let k = z.e - center_e;
    let diff = [
        (ldexp_exact(z.v[0], k) - center[0]) + ldexp_exact(z.lo[0], k),
        (ldexp_exact(z.v[1], k) - center[1]) + ldexp_exact(z.lo[1], k),
    ];
    Some(mag_of(diff, center_e))
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::mem::{offset_of, size_of};

    #[test]
    fn state_is_72_bytes_in_wgsl_layout() {
        assert_eq!(size_of::<Mag>(), 8);
        assert_eq!(size_of::<Proof>(), PROOF_BYTES);
        assert_eq!(offset_of!(Proof, radius), 0);
        assert_eq!(offset_of!(Proof, center), 32);
        assert_eq!(offset_of!(Proof, center_e), 40);
        assert_eq!(offset_of!(Proof, from), 44);
        assert_eq!(offset_of!(Proof, delta), 52);
        assert_eq!(offset_of!(Proof, anchored), 60);
        assert_eq!(offset_of!(Proof, budget), 64);
        assert_eq!(offset_of!(Proof, phase), 68);
    }

    /// The margins as derived, pinned so that a change to the derivation is seen.
    #[test]
    fn margins_as_derived() {
        let f = |d, p, e| {
            let m = Margins::new(d, p, e);
            (m.spacing, m.point, m.step, m.add)
        };
        use Encoding::*;
        use Precision::*;
        assert_eq!(f(2, F32, F32Pair), (4, 21, 18, 22));
        assert_eq!(f(6, F32, F32Pair), (4, 21, 14, 22));
        assert_eq!(f(2, F32, HiLo), f(2, F32, F32Pair));
        assert_eq!(f(2, DoubleSingle, HiLo), (8, 41, 38, 42));
        assert_eq!(f(6, DoubleSingle, HiLo), (8, 41, 35, 42));
        assert_eq!(f(2, DoubleSingle, F32Pair), (8, 21, 20, 42));
    }

    /// Every rounded-up operation is at least the exact value, at ordinary and extreme
    /// exponents; [`carry_radius`] at least `(a + ρ)^D − a^D` and within `2^-17` of it.
    #[test]
    fn magnitudes_round_up() {
        let exact = |v: [f32; 2], e: i32| (v[0] as f64).hypot(v[1] as f64) * 2f64.powi(e);
        let mut seed = 0x9e37_79b9_u32;
        let mut next = || {
            seed ^= seed << 13;
            seed ^= seed >> 17;
            seed ^= seed << 5;
            (seed as f32 / u32::MAX as f32) * 2.0 - 1.0
        };
        for &e in &[-600, -130, -1, 0, 5, 40] {
            for _ in 0..2000 {
                let v = [next(), next() * 1e-3];
                let w = [next(), next()];
                let a = mag_of(v, e);
                let b = mag_of(w, e - 20);
                assert!(a.to_f64() >= exact(v, e), "{v:?} {e}");
                assert!(a.to_f64() <= exact(v, e) * (1.0 + 2f64.powi(-18)));
                assert!(add(a, b).to_f64() >= a.to_f64() + b.to_f64());
                assert!(mul(a, b).to_f64() >= a.to_f64() * b.to_f64());
                // At e = -600 the product is far below `f64`'s range; the exponents
                // say it.
                if e > -300 {
                    for (r, rf) in [(b, b.to_f64()), (scale(a, 3), a.to_f64() * 8.0)] {
                        let af = a.to_f64();
                        let truth = |d: i32| (af + rf).powi(d) - af.powi(d);
                        let got = [
                            carry_radius::<2>(a, r).to_f64(),
                            carry_radius::<3>(a, r).to_f64(),
                            carry_radius::<6>(a, r).to_f64(),
                        ];
                        for (g, d) in got.iter().zip([2, 3, 6]) {
                            // `f64` cancels in the subtraction where `ρ` is tiny; the
                            // linear term is then the truth to its precision.
                            let t = if rf < af * 1e-6 {
                                d as f64 * af.powi(d - 1) * rf
                            } else {
                                truth(d)
                            };
                            assert!(*g >= t * (1.0 - 1e-12), "D={d} {g} {t}");
                            assert!(*g <= t * (1.0 + 2f64.powi(-17)), "D={d} {g} {t}");
                        }
                    }
                }
            }
        }
        // Exponents far apart: the smaller term flushes, inside the rounding up.
        let big = Mag::pow2(10);
        assert!(add(big, Mag::pow2(-400)).to_f64() > 1024.0);
        assert!(lt(Mag::ZERO, big) && !lt(big, Mag::ZERO) && !lt(Mag::ZERO, Mag::ZERO));
        // A radius beside a tiny `a`, and an `a` beside a tiny radius.
        let r = carry_radius::<3>(Mag::pow2(-500), Mag::pow2(-2));
        assert!(r.to_f64() >= 2f64.powi(-6));
        let r = carry_radius::<3>(Mag::pow2(0), Mag::pow2(-500));
        assert!(r.e == -500 + 1 && r.m >= 1.5);
    }

    /// `z ↦ z^D + c`, in `f32`: a direct iteration, which is the delta recurrence against
    /// `c_ref = 0`, whose reference orbit is exactly zero (`δ = z`, `Z = 0`).
    fn step<const D: usize>(z: [f32; 2], c: [f32; 2]) -> [f32; 2] {
        let mut p = z;
        let mut k = 1;
        while k < D {
            p = [p[0] * z[0] - p[1] * z[1], p[0] * z[1] + p[1] * z[0]];
            k += 1;
        }
        [p[0] + c[0], p[1] + c[1]]
    }

    #[derive(Debug, PartialEq)]
    enum End {
        Proved(u32),
        Escaped(u32),
        Capped,
    }

    /// Runs `c`'s critical orbit in `f32` with the proof: armed when `|dz|²` (kept in
    /// `f64`, the harness's) falls under `2^-64`, or at `arm_at` if that comes first.
    fn run<const D: usize>(c: [f32; 2], cap: u32, arm_at: u32, margins: &Margins) -> End {
        let mut z = [0.0f32, 0.0];
        let mut log_dz = 0.0f64;
        let mut proof = Proof::IDLE;
        for n in 1..=cap {
            z = step::<D>(z, c);
            let norm = z[0] as f64 * z[0] as f64 + z[1] as f64 * z[1] as f64;
            if norm > 4_294_967_296.0 {
                return End::Escaped(n);
            }
            let it = Iterate::single(z, 0);
            if proof.gated() {
                if proof.advance::<D>(it, z, 0, n, margins) {
                    return End::Proved(n);
                }
            } else {
                log_dz += ((D * D) as f64).log2() + (D as f64 - 1.0) * norm.log2();
                if log_dz < -64.0 || n == arm_at {
                    proof = Proof::arm(it, z, 0, n, margins);
                }
            }
        }
        End::Capped
    }

    fn f32_margins(d: u32) -> Margins {
        Margins::new(d, Precision::F32, Encoding::F32Pair)
    }

    /// Attracting cycles are proved: fixed points, period 2, period 3 on the real axis
    /// and the rabbit, and degrees three to six.
    #[test]
    fn attracting_cycles_are_proved() {
        let cap = 1_000_000;
        let cases: [(u32, [f32; 2]); 9] = [
            (2, [0.2, 0.0]),
            (2, [-1.1, 0.0]),
            (2, [-1.754, 0.0]),
            (2, [-0.1225, 0.745]),
            (2, [-1.3, 0.0]),
            (3, [0.2, 0.1]),
            (4, [0.3, 0.0]),
            (5, [0.1, 0.3]),
            (6, [-0.3, 0.2]),
        ];
        for (d, c) in cases {
            let m = f32_margins(d);
            let end = match d {
                2 => run::<2>(c, cap, 0, &m),
                3 => run::<3>(c, cap, 0, &m),
                4 => run::<4>(c, cap, 0, &m),
                5 => run::<5>(c, cap, 0, &m),
                _ => run::<6>(c, cap, 0, &m),
            };
            assert!(matches!(end, End::Proved(_)), "D={d} c={c:?}: {end:?}");
        }
    }

    /// What `f32` cannot prove, pinned so that a change is seen: cycles whose defect
    /// over one return outgrows the disc. In this harness `δ = z`, so the defect is of
    /// `|z|`'s size. The period-4 centre's orbit passes about `1e-6` from the critical
    /// point, and the anchor's discs (a quarter of that and down) are under the defect a
    /// return gathers through iterates near 1; the period-4 point near `−1.9408` and the
    /// period-16 band at `−1.4` gather more than any disc. All three are proved on the
    /// double-single margins from an `f64` orbit (`double_single_margins`).
    #[test]
    fn f32_cannot_prove_every_cycle() {
        let m = f32_margins(2);
        for c in [-1.3107f32, -1.9408, -1.4] {
            assert_eq!(run::<2>([c, 0.0], 1_000_000, 0, &m), End::Capped, "{c}");
        }
    }

    /// The cusp of degree `D`'s main component, on the positive real axis: the fixed
    /// point `z = D^(-1/(D−1))` with `f' = 1`, at `c = z(1 − 1/D)`.
    fn cusp(d: u32) -> f64 {
        let z = (d as f64).powf(-1.0 / (d as f64 - 1.0));
        z * (1.0 - 1.0 / d as f64)
    }

    /// Just outside the cusp the orbit creeps through the bottleneck and escapes; armed
    /// early and re-armed at every low, no disc ever closes, at degrees two to six.
    #[test]
    fn parabolic_creep_is_never_proved() {
        for d in 2..=6u32 {
            let c = (cusp(d) + 2f64.powi(-20)) as f32;
            assert!(c as f64 > cusp(d), "c rounded inside the cusp at D={d}");
            let m = f32_margins(d);
            let c = [c, 0.0];
            let end = match d {
                2 => run::<2>(c, 1_000_000, 64, &m),
                3 => run::<3>(c, 1_000_000, 64, &m),
                4 => run::<4>(c, 1_000_000, 64, &m),
                5 => run::<5>(c, 1_000_000, 64, &m),
                _ => run::<6>(c, 1_000_000, 64, &m),
            };
            assert!(matches!(end, End::Escaped(_)), "D={d}: {end:?}");
        }
    }

    /// At `c = 1/4` exactly the parameter is on the boundary, with no attracting cycle, so
    /// no proof can be true. The `f32` orbit stalls on a fixed point of the rounded map a
    /// few thousand steps in and stands still there for the rest of a million. Armed
    /// early (the disc expires before the stall) and armed by the gate (which fires on the
    /// stalled orbit), neither proves.
    #[test]
    fn the_cusp_itself_is_never_proved() {
        let m = f32_margins(2);
        assert_eq!(run::<2>([0.25, 0.0], 1_000_000, 64, &m), End::Capped);
        assert_eq!(run::<2>([0.25, 0.0], 1_000_000, 0, &m), End::Capped);
    }

    /// The same run, armed by the gate, with the step's defect left out, which is
    /// `perturb`'s claim at `f32`'s scale: the stalled orbit's disc contracts onto its
    /// centre and closes. This is why the port carries the step's rounding (the module
    /// doc).
    #[test]
    fn shipped_style_margins_prove_the_cusp() {
        let m = Margins {
            step: OFF,
            add: OFF,
            ..f32_margins(2)
        };
        let end = run::<2>([0.25, 0.0], 1_000_000, 0, &m);
        assert!(matches!(end, End::Proved(_)), "{end:?}");
    }

    /// The double-single margins, on orbits computed in `f64` and handed over as `hi` and
    /// `lo` (more accurate than a double-single kernel, so inside its margins): the cycles
    /// `f32` proves and the three it cannot are proved, with the discs `perturb` uses; a
    /// creep `2^-30` outside the cusp, which escapes after about 1e5 steps, and the two
    /// parabolic roots themselves are not.
    #[test]
    fn double_single_margins() {
        let m = Margins::new(2, Precision::DoubleSingle, Encoding::HiLo);
        let run_f64 = |c: f64, cap: u32| -> End {
            let mut z = 0.0f64;
            let mut proof = Proof::IDLE;
            for n in 1..=cap {
                z = z * z + c;
                if z * z > 4_294_967_296.0 {
                    return End::Escaped(n);
                }
                let hi = z as f32;
                let lo = (z - hi as f64) as f32;
                let it = Iterate::pair([hi, 0.0], [lo, 0.0], 0);
                if proof.gated() {
                    if proof.advance::<2>(it, [hi, 0.0], 0, n, &m) {
                        return End::Proved(n);
                    }
                } else if n == 64 {
                    proof = Proof::arm(it, [hi, 0.0], 0, n, &m);
                }
            }
            End::Capped
        };
        for c in [-1.754, -1.3107, -1.9408, -1.4] {
            assert!(matches!(run_f64(c, 1_000_000), End::Proved(_)), "{c}");
        }
        assert!(matches!(
            run_f64(0.25 + 2f64.powi(-30), 1_000_000),
            End::Escaped(_)
        ));
        // The two parabolic roots on the real axis, exactly: no proof is true there.
        assert_eq!(run_f64(0.25, 1_000_000), End::Capped);
        assert_eq!(run_f64(-0.75, 1_000_000), End::Capped);
    }

    /// The state machine: idle does nothing, the budget expires into waiting, a new low
    /// re-arms with the same budget, a skip breaks the disc, and a rebase grows the radii.
    #[test]
    fn lifecycle() {
        let m = f32_margins(2);
        let mut p = Proof::IDLE;
        assert!(!p.gated());
        assert!(!p.advance::<2>(Iterate::single([0.5, 0.0], 0), [0.5, 0.0], 0, 9, &m));
        assert_eq!(p, Proof::IDLE);

        // Armed early: the budget is the floor. `z` exactly 1.5: centre 1.5 at exponent 0.
        let z = Iterate::single([1.5, 0.0], 0);
        let mut p = Proof::arm(z, [1.5, 0.0], 0, 10, &m);
        assert_eq!(
            (p.phase, p.budget, p.anchored),
            (CARRYING, PROOF_MIN_BUDGET, 10)
        );
        assert_eq!((p.center, p.center_e), ([1.5, 0.0], 0));
        // Each disc starts at its rung plus the point margin.
        for i in 0..RADII {
            let r = p.radius[i].to_f64();
            let rung = 2f64.powi(-2 - 4 * i as i32);
            assert!(r > rung && r < rung * (1.0 + 2f64.powi(-4)), "{i} {r}");
        }
        // Far out, nothing proves and nothing re-arms; past the budget it waits.
        let far = Iterate::single([3.0, 0.0], 0);
        assert!(!p.advance::<2>(far, [3.0, 0.0], 0, 11, &m));
        assert_eq!((p.phase, p.anchored), (CARRYING, 10));
        assert!(!p.advance::<2>(far, [3.0, 0.0], 0, 11 + PROOF_MIN_BUDGET, &m));
        assert_eq!(p.phase, WAITING);
        // A new low re-arms, with the budget it had.
        let low = Iterate::single([0.75, 0.0], -3);
        assert!(!p.advance::<2>(low, [0.75, 0.0], -3, 5000, &m));
        assert_eq!(
            (p.phase, p.anchored, p.budget),
            (CARRYING, 5000, PROOF_MIN_BUDGET)
        );
        assert_eq!((p.center, p.center_e), ([1.5, 0.0], -4));
        // A rebase grows every live radius by the jump.
        let before = p.radius;
        p.rebased(&m, OFF);
        for (r, b) in p.radius.iter().zip(before) {
            assert!(r.to_f64() > b.to_f64());
        }
        // A skip breaks the disc; the next new low re-arms it.
        p.break_disc();
        assert_eq!(p.phase, WAITING);
        assert!(p.rearm_if_lower(Iterate::single([0.5, 0.0], -4), [0.5, 0.0], -4, 6000, &m));
        assert_eq!((p.phase, p.anchored), (CARRYING, 6000));
        // Past the budget, carrying stops even without a far iterate.
        let same = Iterate::single([0.5, 0.0], -4);
        assert!(!p.advance::<2>(same, [0.5, 0.0], -4, 6000 + PROOF_MIN_BUDGET + 1, &m));
        assert_eq!(p.phase, WAITING);
        assert!(p.gated());
    }
}
