//! The per-pixel loop: `perturb`'s kernel restated in `f32`, `i32` and `u32`.
//!
//! The order of operations inside one iteration is `Kernel::run`'s exactly: step,
//! advance (with the periodic wrap), reconstruct `z`, escape, interior switch, cap,
//! rebase. Where the narrow types force a change, the change is named at the line that
//! makes it and summarized here.
//!
//! # The delta, scaled
//!
//! The delta is `δ = d · 2^s`: an `f32` complex mantissa `d` and one `i32` exponent `s`
//! per pixel. There are two regimes, and `s == 0` says which one a pixel is in.
//!
//! - **Unscaled, `s == 0`.** `d` is `δ` itself, at least `2^-62` in its larger component.
//! - **Scaled, `s < 0`.** While the larger component of `δ` is below `2^-60`, `d` is kept
//!   with its larger component in `[2^-32, 2^33)` and `s` carries the rest.
//!
//! **The step has two paths, and which one runs is decided per step from the sizes of
//! `Z`, `d` and the product, and from `s`** (compares against constants while unscaled,
//! integer exponents while scaled), so that no value on either path leaves `f32`'s normal
//! range except a term already below the rounding of what it is added to.
//!
//! - **The quick path** is `perturb`'s step in the delta's units:
//!   `d' = F(Z, δ) · d + dc · 2^-s`, with `δ` formed once, unscaled, for the terms of `F`
//!   that are powers of it (`d · 2^s` by one multiply down to `s = -93`, where that is
//!   exact, and by `ldexp_exact` below). It runs when `max(|Z|, |δ|)^(D-1)` is at least
//!   `2^-90` (so `F` and every intermediate of its Horner form are normal), when `δ` is
//!   either at least `2^-100` or `2^30` below `|Z|` (so a `δ` flushed to zero stands only
//!   beside a term that dwarfs it), when `dc · 2^-s` is finite, and when the product
//!   `F · d` comes out at least `2^-100` in the delta's units. On the corpus frames
//!   measured that is every step but a Mandelbrot pixel's first (`δ = 0` at `Z = 0`) and
//!   a few dozen others a frame. The gate costs about 1.4 times per step on a CPU against
//!   the model before it (10.5 ns against 7.3 on an unscaled dive, one thread).
//! - **The careful path** is everything else: a reference point near zero (at a
//!   minibrot's nucleus, at `Z[0]` after every rebase and every periodic wrap, and at the
//!   first step of a Julia frame anchored at `z = 0`), or a `δ` and a `Z` both small. It
//!   rescales `Z` and `δ` by `2^-v`, `v` the larger of their exponents, so that both are
//!   at most 2; forms `F` from them, which is then `F · 2^((D-1)v)`; rescales `F` by its
//!   own exponent; and multiplies by `d`. The product and `dc` are then two mantissas
//!   against two exponents, added at the larger exponent, and the sum is the new delta
//!   with an `s` of its own. At `Z = 0` this is `δ' = δ^D (+ dc)` with `δ^D` as small as
//!   it is (`2^-500` at degree five is a mantissa and an exponent like any other), where
//!   forming `δ` unscaled would have flushed it, and with it the pixel's whole history.
//!
//! **Why this scheme.** It is the cheapest that reaches the link's depth. A delta
//! renormalized every step (a float-exponent number) pays an exponent extraction and two
//! scalings on every operand of every step; this one pays a few compares a step (two
//! exponent extractions more while scaled), scales `δ` only in the scaled regime, changes `s`
//! only when the mantissa has drifted by `2^32` or the careful path ran. Shallower than
//! about `1e-18` no step is scaled. Deeper, the scaled share is larger than one might
//! guess, because a pixel near a minibrot shadows the reference for a long time while
//! its delta grows by a period's multiplier per period: measured, 27% of the delta steps
//! at `1e-22`, 49% at `1e-28`, 63% at `1e-40`, 74% at `1e-54` (the tangle frames, at
//! their caps) and 53% at the corpus's deepest, `8.66e-42`. A per-frame exponent
//! instead of a per-pixel one would be cheaper still in storage, but the delta outgrows
//! any one exponent within a single pixel's orbit (it starts at the pixel spacing and
//! ends near 1), so the frame would have to pick between underflow at the start and
//! overflow at the end. One `i32` per pixel is four bytes of state. The hysteresis
//! (scale below `2^-62`, unscale at `2^-60`, recenter the mantissa outside
//! `[2^-32, 2^33)`) is what keeps the regime switch from firing every step on a delta
//! that sits at a boundary; every switch is an exact power-of-two scaling, so the regime
//! a pixel is in never changes its value.
//!
//! The deepest frame in the site's corpus is `8.66e-42` across at degree 5, a pixel step
//! of about `2^-147`; the link's limit is near `1e-54`, about `2^-190` a step. Both sit
//! well inside an `i32` exponent and inside [`crate::wgsl::ldexp_exact`], which does the scaling
//! by integer arithmetic on the exponent field rather than through WGSL's `ldexp`, whose
//! result is only specified for exponents in `[-126, 128]`.
//!
//! # Adjustments the narrow types demand
//!
//! - **Nothing on the per-pixel path relies on an infinity or a NaN**, which WGSL lets an
//!   implementation assume never occur. Every test that could read one is decided on an
//!   integer exponent or a compare against a finite constant first.
//! - **The rebase test in the scaled regime compares scaled values.** `|δ|²` underflows
//!   `f32` near `2^-63`, so `|z|² < |δ|²` cannot be asked of unscaled numbers there.
//!   It is asked of `z · 2^-s` and `d` instead, which is the same comparison exactly up
//!   to rounding. Where `|Z|` exceeds `2^(61+s)` the answer is no without arithmetic, an
//!   integer compare on `Z`'s exponent that also keeps `Z · 2^-s` finite. In the unscaled
//!   regime a rebase onto a `z` below `2^-62` forms `z · 2^64` the same way, so that a
//!   small `z` arrives scaled rather than flushed.
//! - **`|z|²` at the escape could overflow `f32`** from degree 4 up (`|z|` can reach about
//!   `2^(16D)` on the step that escapes). A `z` whose larger component is at least `2^62`
//!   has escaped without `|z|²` being formed, and its smooth fraction is computed from `z`
//!   rescaled by its own exponent, with the exponent added back in the log domain.
//! - **The interior switch's `|dz|²` is a mantissa in `[1, 2)` and an `i32` exponent**,
//!   renormalized after each multiply rather than once per `2^64` the way `perturb` does
//!   it, because one step's factor `D²|z|^(2(D-1))` reaches `2^160` at degree 6 and
//!   `f32` stops at `2^128`. Where `|z|` is below `2^-60`, `|z|²` is formed from `z`
//!   rescaled by its own exponent too, so that it never underflows; the switch fires on
//!   an underflow only when `z` is exactly zero, `perturb`'s `derivative == 0` case. The
//!   threshold test `|dz|² < 2^floor` becomes the integer compare `exponent < floor`,
//!   exact for a mantissa in `[1, 2)`.
//! - **The smooth count is a `u32` count and a separate `f32` fraction.** `n + frac` is
//!   `perturb`'s `smooth_count_at`; an `f32` holding the sum would lose the fraction
//!   above `2^23` iterations and quantize to 2 above `2^24`.
//! - **No `degenerate` flag.** `perturb` keeps it for diagnostics and never draws with
//!   it.
//!
//! # The reference, and hi/lo
//!
//! With [`Encoding::HiLo`], `Z = hi + lo` per component, and the two places where the
//! low part survives rounding take it: `z = Z + δ` is formed as `hi + (lo + δ)`, and the
//! step's `2Z + δ` (degree 2) or `D·Z + δ` (the innermost Horner term above it) as
//! `2hi + (2lo + δ)`. **That parenthesization is a reassociation hazard in WGSL**: a
//! compiler that rewrites it as `(hi + lo) + δ` rounds `lo` away and silently turns the
//! `HiLo` kernel into the `F32Pair` one. The shader has to defeat that. The powers `Z^j`
//! at degree 3 and up are formed from `hi` alone.
//!
//! # Arithmetic rules
//!
//! The per-pixel path (`init`, `pass`, and everything they call) uses `f32`, `i32` and
//! `u32` only: no `f64`, no `mul_add` or other fused operation, every multiply and add
//! written as its own operation in the order `perturb` writes it. The only place the
//! result depends on the compiler preserving an order it might otherwise reassociate is
//! the hi/lo sums above, flagged where they are written.
//!
//! **Contraction is the other order hazard, and WGSL cannot forbid it.** WGSL has no
//! `precise` and no `NoContraction`, and every backend a browser compiles through (DXC,
//! SPIR-V drivers, Metal in its default math mode) may fuse an `a * b + c` into one
//! rounding: `factor`'s Horner steps, the complex products `f0*d0 - f1*d1`, `|z|²`, and
//! `dc_mantissa`'s `offset + across * spacing` all have that shape. So a shader is held
//! to this model with a tolerance, never bit for bit; a contracted multiply-add differs
//! from this one by at most one rounding per site, the same size as the rounding the
//! model already carries there. Bit identity is a claim this model makes only about
//! itself: passes of any budget leave exactly the state one unbounded pass does.

use crate::bla::{self, GpuTable};
use crate::frame::Frame;
use crate::orbit::{Encoding, GpuOrbit};
use crate::wgsl::{exponent_of, exponent_of_max, ldexp_exact, log, max_abs};

/// The pixel is still iterating.
pub const RUNNING: u32 = 0;
/// `|z|² > 2^32`: `n` and `frac` hold the smooth count.
pub const ESCAPED: u32 = 1;
/// The cap was reached: interior as far as the picture is concerned.
pub const CAPPED: u32 = 2;
/// The interior switch proved it.
pub const INTERIOR: u32 = 3;

/// `BAILOUT²`, exact in `f32`.
const BAILOUT_SQ: f32 = 4_294_967_296.0;
/// `ln(65536)`.
const LN_BAILOUT: f32 = 11.090_355;
const LN_2: f32 = core::f32::consts::LN_2;

/// The unscaled regime holds a delta whose larger component is at least `2^-62`.
const SCALE_BELOW: i32 = -62;
/// `2^SCALE_BELOW`, as WGSL would spell it: `bitcast<f32>(65u << 23u)`.
const SCALE_FLOOR: f32 = f32::from_bits(((127 + SCALE_BELOW) as u32) << 23);
/// A scaled delta whose larger component reaches `2^-60` is unscaled.
const UNSCALE_AT: i32 = -60;
/// A scaled mantissa is recentered when its exponent leaves `[-32, 32]`.
const DRIFT: i32 = 32;
/// In the scaled regime, `|Z|` at or above `2^(REBASE_GATE + 1 + s)` cannot rebase.
const REBASE_GATE: i32 = 60;
/// An unscaled `z` below `2^-62` rebases as `z · 2^REBASE_LIFT`, with `s = -REBASE_LIFT`.
const REBASE_LIFT: i32 = 64;

/// The quick path wants `max(|Z|, |δ|)^(D-1)` at least `2^QUICK_FLOOR`.
const QUICK_FLOOR: i32 = -90;
/// ... a `δ` at least `2^DELTA_FLOOR`, or one `2^DELTA_BESIDE` below `|Z|` ...
const DELTA_FLOOR: i32 = -100;
const DELTA_BESIDE: i32 = 30;
/// ... and `F · d` at least `2^-100` in the delta's units.
const PRODUCT_SIZE: f32 = f32::from_bits((127 - 100) << 23);
/// `dc · 2^-s` is formed only while `sc - s` is at most this, far from overflowing.
const DC_HEADROOM: i32 = 100;
/// An exponent no value has: the larger of two exponents is the other one.
const NO_EXPONENT: i32 = -100_000;

/// A `z` whose larger component reaches `2^62` has escaped; below it `|z|²` is finite.
const ESCAPE_BIG: f32 = f32::from_bits((127 + 62) << 23);
/// Below `2^-60` in its larger component, `|z|²` is formed from `z` rescaled.
const SMALL_Z: f32 = f32::from_bits((127 - 60) << 23);

/// Everything one pixel carries from one pass to the next.
///
/// Plain `f32`, `i32` and `u32`, laid out as WGSL lays out the same struct: `d` is a
/// `vec2<f32>` (8-byte aligned, at offset 0) and every other field a 4-byte scalar, 48
/// bytes, a multiple of the struct's 8-byte alignment with no padding. The last three
/// fields (`rebases`, `steps` and `scaled`) are measurement counters, kept inside so that
/// a pass needs no second buffer; the kernel itself needs the first nine, 36 bytes, which
/// WGSL would round to 40.
#[repr(C)]
#[derive(Debug, Clone, Copy)]
pub struct PixelState {
    /// The delta's mantissa: `δ = d · 2^s`.
    pub d: [f32; 2],
    /// The delta's exponent; 0 in the unscaled regime.
    pub s: i32,
    /// The reference index `δ` is measured against.
    pub m: u32,
    /// Iterations so far.
    pub n: u32,
    /// [`RUNNING`], [`ESCAPED`], [`CAPPED`] or [`INTERIOR`].
    pub status: u32,
    /// The smooth fraction, set at the escape: the smooth count is `n + frac`.
    pub frac: f32,
    /// `|dz|²` as `dz_mantissa · 2^dz_exponent`, the mantissa in `[1, 2)`.
    pub dz_mantissa: f32,
    pub dz_exponent: i32,
    /// Rebases so far (measurement).
    pub rebases: u32,
    /// Delta steps taken so far (measurement; equal to `n` until steps can be skipped).
    pub steps: u32,
    /// Delta steps taken in the scaled regime (measurement).
    pub scaled: u32,
}

/// What the GPU stores per pixel between passes.
pub const STATE_BYTES: usize = 48;

impl PixelState {
    /// Every field's bits, for bit-identity tests.
    pub fn bits(&self) -> [u32; 12] {
        [
            self.d[0].to_bits(),
            self.d[1].to_bits(),
            self.s as u32,
            self.m,
            self.n,
            self.status,
            self.frac.to_bits(),
            self.dz_mantissa.to_bits(),
            self.dz_exponent as u32,
            self.rebases,
            self.steps,
            self.scaled,
        ]
    }
}

/// The state a pixel starts in.
pub fn init(frame: &Frame, col: u32, row: u32) -> PixelState {
    let (d, s, m) = if frame.julia != 0 {
        // Julia: the pixel's offset is the starting delta, and `dc` is never added.
        let (d, s) = settle(frame.dc_mantissa(col, row), frame.sc);
        (d, s, frame.entry)
    } else {
        ([0.0, 0.0], 0, 0)
    };
    PixelState {
        d,
        s,
        m,
        n: 0,
        status: RUNNING,
        frac: 0.0,
        dz_mantissa: 1.0,
        dz_exponent: 0,
        rebases: 0,
        steps: 0,
        scaled: 0,
    }
}

/// What the skip did to one pixel, in a buffer of its own so that [`PixelState`] is the
/// same struct with the switch on or off. The first four fields are measurement only.
/// `hint` is state, and only [`bla::Search::Hint`] has it: a level below 32, which a
/// shader would keep in five spare bits of `status` rather than a word of its own.
#[repr(C)]
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct BlaStats {
    /// Delta steps that were skips (each also counted once in [`PixelState::steps`]).
    pub bla_steps: u32,
    /// Iterations those skips covered.
    pub skipped: u32,
    /// Table entries read by lookups, hits and misses alike (32 bytes each, and 16 more
    /// from the interior buffer when the switch runs).
    pub reads: u32,
    /// Lookups that read at least one entry; `probes − bla_steps` found nothing.
    pub probes: u32,
    /// The last skip's level, relative to the table's lowest; 0 after a miss.
    pub hint: u32,
}

/// Advances one pixel by at most `budget` delta steps, and returns how many it took.
/// A pixel that has stopped takes none. The result after any sequence of passes is
/// bit-identical to one pass with an unbounded budget.
pub fn pass(
    state: &mut PixelState,
    frame: &Frame,
    orbit: &GpuOrbit,
    col: u32,
    row: u32,
    budget: u32,
) -> u32 {
    let mut unused = BlaStats::default();
    dispatch(state, &mut unused, frame, orbit, None, col, row, budget)
}

/// [`pass`] with the skip table switched on. A skip is one delta step whatever its
/// length, and is never split across passes: the budget counts delta steps, so passes
/// of any budget leave the state one unbounded pass does.
#[allow(clippy::too_many_arguments)]
pub fn pass_bla(
    state: &mut PixelState,
    stats: &mut BlaStats,
    frame: &Frame,
    orbit: &GpuOrbit,
    table: &GpuTable,
    col: u32,
    row: u32,
    budget: u32,
) -> u32 {
    dispatch(state, stats, frame, orbit, Some(table), col, row, budget)
}

#[allow(clippy::too_many_arguments)]
fn dispatch(
    state: &mut PixelState,
    stats: &mut BlaStats,
    frame: &Frame,
    orbit: &GpuOrbit,
    table: Option<&GpuTable>,
    col: u32,
    row: u32,
    budget: u32,
) -> u32 {
    if state.status != RUNNING || budget == 0 {
        return 0;
    }
    let hilo = orbit.encoding == Encoding::HiLo;
    macro_rules! go {
        ($($d:literal),*) => {
            match (frame.degree, frame.julia != 0, hilo, table.is_some()) {
                $(
                    ($d, false, false, false) => run::<$d, false, false, false>(state, stats, frame, orbit, table, col, row, budget),
                    ($d, false, true, false) => run::<$d, false, true, false>(state, stats, frame, orbit, table, col, row, budget),
                    ($d, true, false, false) => run::<$d, true, false, false>(state, stats, frame, orbit, table, col, row, budget),
                    ($d, true, true, false) => run::<$d, true, true, false>(state, stats, frame, orbit, table, col, row, budget),
                    ($d, false, false, true) => run::<$d, false, false, true>(state, stats, frame, orbit, table, col, row, budget),
                    ($d, false, true, true) => run::<$d, false, true, true>(state, stats, frame, orbit, table, col, row, budget),
                    ($d, true, false, true) => run::<$d, true, false, true>(state, stats, frame, orbit, table, col, row, budget),
                    ($d, true, true, true) => run::<$d, true, true, true>(state, stats, frame, orbit, table, col, row, budget),
                )*
                (other, _, _, _) => panic!("degree {other} is not one the kernel draws"),
            }
        };
    }
    go!(2, 3, 4, 5, 6)
}

/// Runs one pixel to its end in passes of `budget` steps.
pub fn run_pixel(frame: &Frame, orbit: &GpuOrbit, col: u32, row: u32, budget: u32) -> PixelState {
    let mut state = init(frame, col, row);
    while state.status == RUNNING {
        pass(&mut state, frame, orbit, col, row, budget.max(1));
    }
    state
}

/// [`run_pixel`] with the skip table switched on.
pub fn run_pixel_bla(
    frame: &Frame,
    orbit: &GpuOrbit,
    table: &GpuTable,
    col: u32,
    row: u32,
    budget: u32,
) -> (PixelState, BlaStats) {
    let mut state = init(frame, col, row);
    let mut stats = BlaStats::default();
    while state.status == RUNNING {
        pass_bla(
            &mut state,
            &mut stats,
            frame,
            orbit,
            table,
            col,
            row,
            budget.max(1),
        );
    }
    (state, stats)
}

/// The smooth count `perturb` would report for this state: `n + frac` on an escape and
/// `NaN` otherwise. Harness side (it forms an `f64`); the GPU would hand `n` and `frac`
/// to the coloring as they are.
pub fn smooth_f64(state: &PixelState) -> f64 {
    if state.status == ESCAPED {
        state.n as f64 + state.frac as f64
    } else {
        f64::NAN
    }
}

/// Values derived from `s` and the pixel's `dc`, formed at the start of every pass and
/// again whenever `s` changes. Never stored: each is a pure function of what the state
/// struct holds, which is part of what keeps passes bit-identical.
#[derive(Clone, Copy)]
struct Scale {
    /// `dc` in the delta's units, `dc_m · 2^(sc - s)`, while `dc_fits`; zero otherwise.
    dc: [f32; 2],
    /// `sc - s <= DC_HEADROOM`: `dc` in the delta's units is finite, and the quick path
    /// may add it.
    dc_fits: bool,
    /// `2^s` while `s >= K_FLOOR`, where `d · k` of a recentered mantissa is normal; 0
    /// below, where `δ` is formed by [`ldexp_exact`] instead.
    k: f32,
}

/// The lowest `s` at which `δ = d · 2^s` is formed by a multiply: `-126 + DRIFT + 1`.
const K_FLOOR: i32 = -126 + DRIFT + 1;

#[inline(always)]
fn scale_of(dc_m: [f32; 2], sc: i32, s: i32) -> Scale {
    let dc_fits = sc - s <= DC_HEADROOM;
    Scale {
        dc: if dc_fits {
            [ldexp_exact(dc_m[0], sc - s), ldexp_exact(dc_m[1], sc - s)]
        } else {
            [0.0, 0.0]
        },
        dc_fits,
        k: if s >= K_FLOOR {
            ldexp_exact(1.0, s)
        } else {
            0.0
        },
    }
}

/// `d · 2^e` for both components.
#[inline(always)]
fn ldexp2(d: [f32; 2], e: i32) -> [f32; 2] {
    [ldexp_exact(d[0], e), ldexp_exact(d[1], e)]
}

/// `δ` itself, unscaled, from a `d` that is recentered (at the start of a step) or
/// negligible beside `Z` (at the reconstruct): one multiply by `k = 2^s` down to
/// `K_FLOOR` (`k = 1`, exactly `d`, at `s == 0`), and [`ldexp_exact`] below, which
/// flushes to a signed zero.
#[inline(always)]
fn delta_at_step(d: [f32; 2], s: i32, scale: &Scale) -> [f32; 2] {
    if s >= K_FLOOR {
        [d[0] * scale.k, d[1] * scale.k]
    } else {
        ldexp2(d, s)
    }
}

/// A delta given as a mantissa against any exponent, put in the state's form: unscaled
/// when its larger component reaches `2^-60`, and otherwise scaled with that component
/// in `[1, 2)`. Exact. A zero delta is an unscaled zero.
#[inline(always)]
fn settle(d: [f32; 2], e: i32) -> ([f32; 2], i32) {
    let big = max_abs(d[0], d[1]);
    let x = exponent_of(big);
    if x == -127 {
        // Zero (or a subnormal, which is zero here).
        return (ldexp2(d, 0), 0);
    }
    if x + e >= UNSCALE_AT {
        return (ldexp2(d, e), 0);
    }
    (ldexp2(d, -x), e + x)
}

/// The delta's mantissa and exponent, moved between the regimes by the rule in the
/// module doc. Exact: every change is a power-of-two scaling of a normal value.
#[inline(always)]
fn renormalize(d: [f32; 2], s: i32) -> ([f32; 2], i32) {
    if s == 0 {
        // The common case, nearly every step of a shallow pixel, decided by two
        // compares: unscaled, and large enough to stay so.
        if d[0].abs() >= SCALE_FLOOR || d[1].abs() >= SCALE_FLOOR {
            return (d, 0);
        }
        return settle(d, 0);
    }
    let big = max_abs(d[0], d[1]);
    let e = exponent_of(big);
    if e == -127 {
        return (ldexp2(d, 0), s);
    }
    if e + s >= UNSCALE_AT {
        return (ldexp2(d, s), 0);
    }
    if !(-DRIFT..=DRIFT).contains(&e) {
        return (ldexp2(d, -e), s + e);
    }
    (d, s)
}

/// `Z + t`, with the low part added first under `HiLo`.
#[inline(always)]
fn add_reference<const HILO: bool>(p: &[f32; 4], t: [f32; 2]) -> [f32; 2] {
    if HILO {
        // REASSOCIATION HAZARD: `hi + (lo + t)`, never `(hi + lo) + t`.
        [p[0] + (p[2] + t[0]), p[1] + (p[3] + t[1])]
    } else {
        [p[0] + t[0], p[1] + t[1]]
    }
}

/// `C(d, k)` for `k = 0..=d`, as the `f32` the step multiplies by. Exact.
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

/// `F` with `δ' = F · δ (+ dc)`: `perturb`'s `factor::<D>`, in `f32`. `t` is `δ` and `p`
/// the reference point, both in one unit: unscaled on the quick path, `2^v` on the
/// careful one.
#[inline(always)]
fn factor<const D: usize, const HILO: bool>(p: &[f32; 4], t: [f32; 2]) -> [f32; 2] {
    let (zr, zi) = (p[0], p[1]);
    if D == 2 {
        if HILO {
            // REASSOCIATION HAZARD: `2hi + (2lo + δ)`.
            return [
                (zr + zr) + ((p[2] + p[2]) + t[0]),
                (zi + zi) + ((p[3] + p[3]) + t[1]),
            ];
        }
        return [zr + zr + t[0], zi + zi + t[1]];
    }
    let b = const { binomial(D) };
    let mut pw = [[0.0f32; 2]; 6];
    pw[1] = [zr, zi];
    let mut j = 2;
    while j < D {
        let [a, c] = pw[j - 1];
        pw[j] = [a * zr - c * zi, a * zi + c * zr];
        j += 1;
    }
    let (mut pr, mut pi) = if HILO {
        // REASSOCIATION HAZARD: `D·hi + (D·lo + δ)`.
        let lead = b[D - 1];
        (
            lead * zr + (lead * p[2] + t[0]),
            lead * zi + (lead * p[3] + t[1]),
        )
    } else {
        (t[0] + b[D - 1] * zr, t[1] + b[D - 1] * zi)
    };
    let mut k = D - 2;
    while k >= 1 {
        let (tr, ti) = (pr * t[0] - pi * t[1], pr * t[1] + pi * t[0]);
        pr = tr + b[k] * pw[D - k][0];
        pi = ti + b[k] * pw[D - k][1];
        k -= 1;
    }
    [pr, pi]
}

/// `max(|v.x|, |v.y|) >= t`, as two compares rather than a float maximum: WGSL
/// `any(abs(v) >= vec2(t))`.
#[inline(always)]
fn reaches(v: [f32; 2], t: f32) -> bool {
    v[0].abs() >= t || v[1].abs() >= t
}

/// `a · b`, complex.
#[inline(always)]
fn cmul(a: [f32; 2], b: [f32; 2]) -> [f32; 2] {
    [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]]
}

/// `1 - log_D(ln|z| / ln 65536)`: the part of `perturb`'s smooth count after `n`.
/// When `big`, `|z|²` was never formed (it could have overflowed at degree 4 and up),
/// and `z` is rescaled by its own exponent first.
#[inline(always)]
fn smooth_fraction<const D: usize>(z: [f32; 2], z_norm_sq: f32, big: bool) -> f32 {
    let ln_sq = if big {
        let e = exponent_of(max_abs(z[0], z[1]));
        let a = ldexp_exact(z[0], -e);
        let b = ldexp_exact(z[1], -e);
        log(a * a + b * b) + (2 * e) as f32 * LN_2
    } else {
        log(z_norm_sq)
    };
    let overshoot = 0.5 * ln_sq / LN_BAILOUT;
    // `|z| > 65536` makes the overshoot greater than 1, so its log is positive and
    // finite; `perturb`'s fallback to the integer count cannot fire.
    let base = if D == 2 { LN_2 } else { log(D as f32) };
    1.0 - log(overshoot) / base
}

/// Multiplies `|dz|²` by one step's `D²·|z|^(2(D-1))`, renormalizing after each
/// multiply so that no intermediate leaves `f32`. `z = zv · 2^ze`. `|z|²` is `z_norm_sq`
/// where `z` is unscaled and at least `2^-60`, and otherwise a mantissa and an exponent
/// formed from `zv` rescaled, so that nothing underflows. Returns `false` only when `z`
/// is zero, which `perturb` reads as the orbit passing through the origin.
#[inline(always)]
fn derivative_step<const D: usize>(
    mantissa: &mut f32,
    exponent: &mut i32,
    zv: [f32; 2],
    ze: i32,
    z_norm_sq: f32,
) -> bool {
    let (n2, e2) = if ze == 0 && reaches(zv, SMALL_Z) {
        (z_norm_sq, 0)
    } else {
        let e = exponent_of_max(zv[0], zv[1]);
        if e == -127 {
            // Zero (or a subnormal, which is zero here).
            return false;
        }
        let a = ldexp_exact(zv[0], -e);
        let b = ldexp_exact(zv[1], -e);
        (a * a + b * b, 2 * (e + ze))
    };
    let mut m = *mantissa * (D * D) as f32;
    let mut e = exponent_of(m);
    m = ldexp_exact(m, -e);
    *exponent += e;
    let mut k = 1;
    while k < D {
        m *= n2;
        e = exponent_of(m);
        m = ldexp_exact(m, -e);
        *exponent += e + e2;
        k += 1;
    }
    *mantissa = m;
    true
}

/// `2^ceil(QUICK_FLOOR / (D-1))`: `max(|Z|, |δ|)` at least this is `(D-1)·v >= QUICK_FLOOR`.
const fn quick_size<const D: usize>() -> f32 {
    // Integer division truncates toward zero, which is the ceiling for a negative floor.
    f32::from_bits(((127 + QUICK_FLOOR / (D as i32 - 1)) as u32) << 23)
}

/// The careful step, for a `Z` near zero or a `Z` and a `δ` both small: `Z` and `δ` in
/// the unit `2^v`, both at most 2; then `F = f · 2^((D-1)v)`, and
/// `F · δ = (f̂ · d) · 2^((D-1)v + ef + s)` with `f̂` in `[1, 2)`, added to `dc` at the
/// larger of the two exponents. Returns the new delta in the state's form. Kept out of
/// line: it runs on a small share of steps, and inlined it would crowd the quick path.
#[cold]
#[inline(never)]
fn careful_step<const D: usize, const JULIA: bool, const HILO: bool>(
    p: &[f32; 4],
    d: [f32; 2],
    s: i32,
    dc_m: [f32; 2],
    dc_e: i32,
    sc: i32,
) -> ([f32; 2], i32) {
    let dm1 = (D - 1) as i32;
    let ez = exponent_of_max(p[0], p[1]);
    let ed = s + exponent_of_max(d[0], d[1]);
    let v = if ez > ed { ez } else { ed };
    let zv = [
        ldexp_exact(p[0], -v),
        ldexp_exact(p[1], -v),
        ldexp_exact(p[2], -v),
        ldexp_exact(p[3], -v),
    ];
    let f = factor::<D, HILO>(&zv, ldexp2(d, s - v));
    let ef = exponent_of_max(f[0], f[1]);
    let g = cmul(ldexp2(f, -ef), d);
    let ge = dm1 * v + ef + s;
    let gx = match exponent_of_max(g[0], g[1]) {
        -127 => NO_EXPONENT,
        x => ge + x,
    };
    let at = if gx > dc_e { gx } else { dc_e };
    if at == NO_EXPONENT {
        return ([0.0, 0.0], s);
    }
    // Each term at most 2 in the unit `2^at`; the smaller one's flushed components are
    // below the larger one's rounding.
    let mut sum = ldexp2(g, ge - at);
    if !JULIA {
        let c = ldexp2(dc_m, sc - at);
        sum = [sum[0] + c[0], sum[1] + c[1]];
    }
    settle(sum, at)
}

/// The loop. One iteration is one delta step, a single step or a skip; `budget` bounds
/// them. With `BLA` false the skip's code is compiled out and the loop is the one that
/// ran before the switch existed (`tests/bla.rs` holds its fields to that one's, bit for
/// bit).
#[inline(never)]
#[allow(clippy::too_many_arguments)]
fn run<const D: usize, const JULIA: bool, const HILO: bool, const BLA: bool>(
    st: &mut PixelState,
    stats: &mut BlaStats,
    frame: &Frame,
    orbit: &GpuOrbit,
    table: Option<&GpuTable>,
    col: u32,
    row: u32,
    budget: u32,
) -> u32 {
    let points = &orbit.points[..];
    let periodic = orbit.periodic;
    let length = points.len() as u32;
    let last = length - 1;
    let track_interior = frame.interior != 0;
    let floor = frame.floor;
    let maxiter = frame.maxiter;
    let sc = frame.sc;
    let dm1 = (D - 1) as i32;
    // Recomputed from the pixel's own column and row at every pass rather than stored:
    // it is a pure function of them and the frame.
    let dc_m = frame.dc_mantissa(col, row);
    let dc_e = if JULIA {
        NO_EXPONENT
    } else {
        match exponent_of(max_abs(dc_m[0], dc_m[1])) {
            -127 => NO_EXPONENT,
            e => sc + e,
        }
    };

    let mut d = st.d;
    let mut s = st.s;
    let mut scale = scale_of(dc_m, sc, s);
    let mut m = st.m;
    let mut n = st.n;
    let mut rebases = st.rebases;
    let mut steps = st.steps;
    let mut scaled = st.scaled;
    let mut dzm = st.dz_mantissa;
    let mut dze = st.dz_exponent;
    let mut status = RUNNING;
    let mut frac = st.frac;
    let mut taken = 0u32;
    let mut bla_steps = stats.bla_steps;
    let mut skipped = stats.skipped;
    let mut reads = stats.reads;
    let mut probes = stats.probes;
    let mut hint = stats.hint;

    while taken < budget {
        // ---- the skip: at an index the table is aligned on, the longest run it allows.
        // The landed delta falls through into the same escape, interior, cap and rebase
        // tests a single step's does.
        let s0 = s;
        let mut hit: Option<bla::Hit> = None;
        if BLA && let Some(t) = table {
            let guard = if track_interior {
                Some((dzm, dze, floor))
            } else {
                None
            };
            let before = reads;
            hit = bla::lookup_hinted(t, m, d, s, maxiter - n, guard, &mut hint, &mut reads);
            probes += (reads != before) as u32;
        }
        if let (true, Some(h), Some(t)) = (BLA, hit, table) {
            let (sum, at) = bla::apply::<JULIA>(&t.entries[h.index as usize], d, s, dc_m, sc);
            let (nd, ns) = settle(sum, at);
            d = nd;
            if ns != s {
                s = ns;
                scale = scale_of(dc_m, sc, s);
            }
            taken += 1;
            steps += 1;
            if s0 != 0 {
                scaled += 1;
            }
            bla_steps += 1;
            skipped += h.length;
            m += h.length;
            n += h.length;
            // A run may land on `len`, which is index 0, and never passes it.
            if periodic && m >= length {
                m = 0;
            }
        } else {
            // ---- step: δ' = F(Z[m], δ) · δ (+ dc), in the delta's units.
            let p = &points[m as usize];
            // The quick path's gate. Unscaled, it is two compares against constants: `δ` is
            // at least `2^-62`, so only the size of `max(|Z|, |δ|)` and of the product are in
            // question. Scaled, it reads the exponents.
            let gate = if s == 0 {
                reaches([p[0], p[1]], const { quick_size::<D>() })
                    || reaches(d, const { quick_size::<D>() })
            } else {
                let em = exponent_of_max(d[0], d[1]);
                let ez = exponent_of_max(p[0], p[1]);
                let ed = s + em;
                let v = if ez > ed { ez } else { ed };
                dm1 * v >= QUICK_FLOOR && (ed >= DELTA_FLOOR || ez >= ed + DELTA_BESIDE)
            } && (JULIA || scale.dc_fits);
            // The quick step is formed whatever the gate says (it is finite either way) and
            // kept only when the gate holds and the product is at least `2^-100`: a cancelled
            // `F` whose product with `d` has left the normal range is formed again the
            // careful way. Written so that the kept value does not wait on the decision.
            let product = cmul(factor::<D, HILO>(p, delta_at_step(d, s, &scale)), d);
            let next = if JULIA {
                product
            } else {
                [product[0] + scale.dc[0], product[1] + scale.dc[1]]
            };
            if gate && reaches(product, PRODUCT_SIZE) {
                d = next;
            } else {
                let (nd, ns) = careful_step::<D, JULIA, HILO>(p, d, s, dc_m, dc_e, sc);
                d = nd;
                if ns != s {
                    s = ns;
                    scale = scale_of(dc_m, sc, s);
                }
            }
            taken += 1;
            steps += 1;
            if s0 != 0 {
                scaled += 1;
            }

            m += 1;
            n += 1;
            if periodic && m >= length {
                m = 0;
            }
        }

        // ---- reconstruct and escape. `z = zv · 2^ze`: where `|Z|` is small beside `δ`
        // in the scaled regime, `z` is formed in the delta's units first, so that a `z`
        // below `f32`'s normal range keeps its size for the interior switch.
        let p = &points[m as usize];
        let (z, zv, ze) = if s != 0 && exponent_of_max(p[0], p[1]) <= REBASE_GATE + s {
            let zs = add_reference::<HILO>(
                &[
                    ldexp_exact(p[0], -s),
                    ldexp_exact(p[1], -s),
                    ldexp_exact(p[2], -s),
                    ldexp_exact(p[3], -s),
                ],
                d,
            );
            (ldexp2(zs, s), zs, s)
        } else {
            // `δ` is negligible beside `Z` here when scaled, so a subnormal `d · k`
            // rounds away on any hardware.
            let z = add_reference::<HILO>(p, delta_at_step(d, s, &scale));
            (z, z, 0)
        };
        let big = reaches(z, ESCAPE_BIG);
        let z_norm_sq = if big {
            BAILOUT_SQ
        } else {
            z[0] * z[0] + z[1] * z[1]
        };
        if big || z_norm_sq > BAILOUT_SQ {
            frac = smooth_fraction::<D>(z, z_norm_sq, big);
            status = ESCAPED;
            break;
        }

        // ---- interior switch.
        if track_interior {
            if let (true, Some(h), Some(t)) = (BLA, hit, table) {
                // The run's product of `D²|Z_j|^(2(D−1))` over its inner points, which the
                // lookup has shown keeps every prefix above the floor (and nonzero); then
                // the landing point's factor from the `z` actually landed on, since the
                // radius bounds nothing there.
                let x = &t.interior[h.index as usize];
                let product = dzm * x.deriv_m;
                let e = exponent_of(product);
                dzm = ldexp_exact(product, -e);
                dze += x.deriv_e + e;
                if !derivative_step::<D>(&mut dzm, &mut dze, zv, ze, z_norm_sq) {
                    status = INTERIOR;
                    break;
                }
            } else if !derivative_step::<D>(&mut dzm, &mut dze, zv, ze, z_norm_sq) {
                status = INTERIOR;
                break;
            }
            if dze < floor {
                status = INTERIOR;
                break;
            }
        }

        // ---- cap.
        if n >= maxiter {
            status = CAPPED;
            break;
        }

        // ---- renormalize, then rebase.
        let (rd, rs) = renormalize(d, s);
        d = rd;
        if rs != s {
            s = rs;
            scale = scale_of(dc_m, sc, s);
        }
        let exhausted = !periodic && m >= last;
        let mut rebase_to: Option<([f32; 2], i32)> = None;
        if s == 0 {
            let delta_norm_sq = d[0] * d[0] + d[1] * d[1];
            if z_norm_sq < delta_norm_sq || exhausted {
                if reaches(z, SCALE_FLOOR) {
                    rebase_to = Some((z, 0));
                } else {
                    // A small `z`, formed at `2^-64` so that it is not flushed.
                    let lifted = [
                        ldexp_exact(p[0], REBASE_LIFT),
                        ldexp_exact(p[1], REBASE_LIFT),
                        ldexp_exact(p[2], REBASE_LIFT),
                        ldexp_exact(p[3], REBASE_LIFT),
                    ];
                    let zs = add_reference::<HILO>(&lifted, ldexp2(d, REBASE_LIFT));
                    rebase_to = Some((zs, -REBASE_LIFT));
                }
            }
        } else {
            // Scaled: compare `z · 2^-s` with `d`. With `|Z| >= 2^(61+s)`, `|Z| > 2|δ|`
            // and the answer is no; that integer gate also keeps `Z · 2^-s` finite.
            if exponent_of(max_abs(p[0], p[1])) <= REBASE_GATE + s {
                let zs = add_reference::<HILO>(
                    &[
                        ldexp_exact(p[0], -s),
                        ldexp_exact(p[1], -s),
                        ldexp_exact(p[2], -s),
                        ldexp_exact(p[3], -s),
                    ],
                    d,
                );
                let zs_norm_sq = zs[0] * zs[0] + zs[1] * zs[1];
                let delta_norm_sq = d[0] * d[0] + d[1] * d[1];
                if zs_norm_sq < delta_norm_sq || exhausted {
                    rebase_to = Some((zs, s));
                }
            } else if exhausted {
                rebase_to = Some((z, 0));
            }
        }
        if let Some((nd, ns)) = rebase_to {
            let (rd, rs) = renormalize(nd, ns);
            d = rd;
            if rs != s {
                s = rs;
                scale = scale_of(dc_m, sc, s);
            }
            m = 0;
            rebases += 1;
        }
    }

    st.d = d;
    st.s = s;
    st.m = m;
    st.n = n;
    st.status = status;
    st.frac = frac;
    st.dz_mantissa = dzm;
    st.dz_exponent = dze;
    st.rebases = rebases;
    st.steps = steps;
    st.scaled = scaled;
    if BLA {
        stats.bla_steps = bla_steps;
        stats.skipped = skipped;
        stats.reads = reads;
        stats.probes = probes;
        stats.hint = hint;
    }
    taken
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::mem::{offset_of, size_of};

    /// The struct is what WGSL would lay out: `vec2<f32>` at 0, then ten 4-byte
    /// scalars, 48 bytes, a multiple of the `vec2`'s 8-byte alignment.
    #[test]
    fn state_is_48_bytes_in_wgsl_layout() {
        assert_eq!(size_of::<PixelState>(), STATE_BYTES);
        assert_eq!(STATE_BYTES, 48);
        assert_eq!(STATE_BYTES % 8, 0);
        assert_eq!(offset_of!(PixelState, d), 0);
        assert_eq!(offset_of!(PixelState, s), 8);
        assert_eq!(offset_of!(PixelState, m), 12);
        assert_eq!(offset_of!(PixelState, n), 16);
        assert_eq!(offset_of!(PixelState, status), 20);
        assert_eq!(offset_of!(PixelState, frac), 24);
        assert_eq!(offset_of!(PixelState, dz_mantissa), 28);
        assert_eq!(offset_of!(PixelState, dz_exponent), 32);
        assert_eq!(offset_of!(PixelState, rebases), 36);
        assert_eq!(offset_of!(PixelState, steps), 40);
        assert_eq!(offset_of!(PixelState, scaled), 44);
    }

    #[test]
    fn renormalize_keeps_the_value_and_has_hysteresis() {
        let value = |d: [f32; 2], s: i32| (d[0] as f64 * 2f64.powi(s), d[1] as f64 * 2f64.powi(s));
        // Below 2^-62 an unscaled delta is scaled, exactly.
        let d = [3.0e-20f32, -1.0e-21];
        let (sd, ss) = renormalize(d, 0);
        assert!(ss < 0);
        assert_eq!(value(sd, ss), value(d, 0));
        // A scaled delta whose value reaches 2^-60 is unscaled, exactly.
        let (ud, us) = renormalize([1.5, 0.25], -60);
        assert_eq!(us, 0);
        assert_eq!(value(ud, us), value([1.5, 0.25], -60));
        // Between the two thresholds nothing moves.
        assert_eq!(renormalize([1.5, 0.0], -61), ([1.5, 0.0], -61));
        assert_eq!(renormalize([3.0e-19, 0.0], 0), ([3.0e-19, 0.0], 0));
        // A drifted mantissa is recentered.
        let (rd, rs) = renormalize([2.0e12, 1.0], -150);
        assert!(exponent_of(rd[0]) == 0 && rs == -150 + 40);
        assert_eq!(value(rd, rs), value([2.0e12, 1.0], -150));
        // Far below any scale: s is an i32 and nothing saturates.
        let (fd, fs) = renormalize([1.0, 0.5], -400);
        assert_eq!((fd, fs), ([1.0, 0.5], -400));
        // A zero stays a zero and never becomes a subnormal-derived exponent.
        assert_eq!(renormalize([0.0, 0.0], 0), ([0.0, 0.0], 0));
    }

    #[test]
    fn settle_puts_any_exponent_in_the_state_form() {
        let (d, s) = settle([1.5, -0.75], -500);
        assert_eq!((d, s), ([1.5, -0.75], -500));
        // 3 · 2^-62 is below 2^-60: scaled, with the mantissa in [1, 2).
        let (d, s) = settle([3.0, 0.0], -62);
        assert_eq!((d, s), ([1.5, 0.0], -61));
        // 3 · 2^-61 reaches 2^-60: unscaled.
        let (d, s) = settle([3.0, 0.0], -61);
        assert_eq!((d, s), ([ldexp_exact(3.0, -61), 0.0], 0));
        let (d, s) = settle([1.0, 0.0], -10);
        assert_eq!((d, s), ([ldexp_exact(1.0, -10), 0.0], 0));
    }

    #[test]
    fn smooth_fraction_survives_overflow() {
        // |z| = 2^70: |z|² would overflow f32, the fraction does not.
        let z = [ldexp_exact(1.0, 70), 0.0];
        assert!(max_abs(z[0], z[1]) >= ESCAPE_BIG);
        let frac = smooth_fraction::<5>(z, BAILOUT_SQ, true);
        let expected = 1.0 - ((70.0 * core::f64::consts::LN_2) / 65536f64.ln()).ln() / 5f64.ln();
        assert!((frac as f64 - expected).abs() < 1e-5, "{frac} {expected}");
    }

    /// A `z` far below `2^-63` (where `|z|²` underflows `f32`) still multiplies the
    /// derivative by its true size; only an exact zero proves interior.
    #[test]
    fn derivative_step_does_not_underflow_on_a_small_z() {
        let (mut m, mut e) = (1.0f32, 300);
        let z = [ldexp_exact(1.0, -80), 0.0];
        assert!(derivative_step::<3>(&mut m, &mut e, z, 0, z[0] * z[0]));
        // 9 · 2^-320 · 2^300 = 9 · 2^-20.
        assert_eq!(e, 300 + 3 - 320);
        assert_eq!(m, 9.0 / 8.0);
        assert!(!derivative_step::<3>(&mut m, &mut e, [0.0, 0.0], 0, 0.0));
        // The same z given in the delta's units: 2^-80 = 1 · 2^-80.
        let (mut m2, mut e2) = (1.0f32, 300);
        assert!(derivative_step::<3>(&mut m2, &mut e2, [1.0, 0.0], -80, 1.0));
        assert_eq!((m2, e2), (9.0 / 8.0, 300 + 3 - 320));
    }
}
