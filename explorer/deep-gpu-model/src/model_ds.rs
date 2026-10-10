//! The per-pixel loop in double-single: [`crate::model`]'s kernel with the delta carried
//! as a pair of `f32` per component (about 48 bits), the reference read as one from the
//! [`Encoding::HiLo`] buffer, and `dc` formed as one ([`Frame::dc_ds`]).
//!
//! Stage 1 measured the `f32` kernel as a sound preview whose error on long orbits is
//! dominated by the reference rounded to `f32`, and found that the `HiLo` reference bought
//! nothing there because every operation that read it still rounded to 24 bits. Here
//! every operation on the carried state is a [`ds`] operation, so the low half of the
//! reference survives into the delta.
//!
//! # Same loop, wider state
//!
//! The order of operations, the regimes, the quick and careful paths, the rebasing rule,
//! the escape and smooth fraction, the interior gate and proof (with its
//! [`crate::frame::GatedPolicy`] fallback) and the skip switch are [`crate::model`]'s,
//! line for line; its module doc is the reference for why each is there. What differs:
//!
//! - **The delta is `δ = (d_hi + d_lo) · 2^s` per component.** `s` is managed on the
//!   high parts with `model.rs`'s thresholds (scale below `2^-62`, unscale at `2^-60`,
//!   recenter outside `[2^-32, 2^33)`), and every power-of-two scaling is applied to both
//!   parts by [`ds::ldexp`], which is exact while `lo` stays normal and flushes it to a
//!   signed zero below. The state's own ranges keep `lo` normal: an unscaled `d_hi` is at
//!   least `2^-62` and a scaled one at least `2^-32`, so a nonzero `lo` that is not
//!   simply small for being exact is at least about `2^-86`. `δ` itself, unscaled for the
//!   powers in `F`, is always formed by [`ds::ldexp`], never by a multiply by `2^s` as
//!   `model.rs` does above `K_FLOOR`: the multiply would leave a subnormal `lo` that a GPU
//!   flushes and the CPU keeps.
//! - **The quick path's gate is tighter**, because a double-single product is only
//!   error-free while its partial products are normal (`ds.rs`, *Ranges*): Dekker's
//!   `al·bl` sits about `2^-48` below the product. So the quick path wants
//!   `max(|Z|, |δ|)^(D-1)` at least `2^-64` (`model.rs`: `2^-90`), `F · d` at least
//!   `2^-76` (`2^-100`), and a `δ` below `2^-100` at least `2^50` below `|Z|` (`2^30`),
//!   so that the flushed `δ` is under the pair's rounding of `F` rather than the `f32`
//!   rounding. Under those, what a GPU flushes is at most `2^-126` absolute against a sum
//!   at least `2^-64`, which is under the `2^-48` the pair carries. The careful path takes
//!   what the quick one now refuses (near a nucleus and after a rebase, where `|Z|` is
//!   small); how many steps that moves per pixel was not measured.
//! - **The careful path is the same rescaling in double-single**: `Z` and `δ` moved to the
//!   unit `2^v` by [`ds::ldexp`], `F` formed there and rescaled by its own exponent,
//!   multiplied by `d`, and added to `dc` at the larger exponent. Every operand is then
//!   at most 2 and every partial product normal, whatever the frame's depth.
//! - **The skip** applies `A·δ + B·dc` with `A` and `B` read as pairs ([`bla::apply_ds`],
//!   which says why the table carries low halves) and the lookup reads `d_hi`.
//!
//! # Where the high part alone is read
//!
//! Only decisions and outputs read `hi` alone; nothing carried does.
//!
//! - **Every regime and gate decision** (`settle`, `renormalize`, the quick path's gate,
//!   the careful path's `v`, the rebase gate `|Z| <= 2^(61+s)`): each decides which exact
//!   representation of the same value to use, and `hi` is within half an `f32` ulp of
//!   it.
//! - **The escape test and `|z|²`**, from `z_hi`: escape at `|z|² > 2^32` is a threshold
//!   whose `2^-24` blur moves a sample's count only when `|z|` sits within that of the
//!   bailout, the same as in `f64` at its own rounding.
//! - **The smooth fraction**, `1 - log_D(ln|z| / ln 65536)` from `z_hi`: its error is
//!   about `2^-24` absolute, which no color map shows and which the `f32` model shares.
//! - **The rebase compare `|z|² < |δ|²`**, from `z_hi` and `d_hi`: a borderline decision
//!   can go either way, as it can between `f64` kernels, and the rebased state is the
//!   whole pair `z` either way.
//! - **The interior gate's `|dz|²`** and the skip's lookup radius: magnitudes against
//!   thresholds. The gate decides only when the proof starts; **the proof itself reads
//!   the whole pair** (`z` as `hi + lo`, so its distance to the disc's centre keeps the
//!   low half), with the double-single margins in [`FrameLo::margins`]: 256 times between
//!   discs as `perturb` has them, a step's defect at `2^-38` of `|δ|` (degree two) where
//!   the `f32` kernel's is `2^-18`, which is what lets this kernel prove cycles the `f32`
//!   one cannot (`proof.rs`, `f32_cannot_prove_every_cycle`).
//!
//! One carried value can lose its low half where `model.rs` loses nothing it had: the
//! rebase of a non-periodic reference at its last point while scaled with
//! `|Z| >= 2^(61+s)` takes `z = Z + δ` unscaled, and `δ`'s `lo` flushes there once `δ` is
//! below about `2^-102`. That is an exhausted reference on a frame deeper than `1e-30`,
//! which `perturb` itself avoids by forming its references long enough.
//!
//! # Cost in `f32` operations
//!
//! Counted from the code, `f32` adds and multiplies only (compares, exponent reads and
//! [`ds::ldexp`] are integer work and the same in both kernels), per quick step on the
//! parameter plane: the step `F · d + dc`, the reconstruction `z = Z + δ`, `|z|²` and
//! `|δ|²`, and (for `model.rs`) the two multiplies that form `δ` from `d`. The `f32`
//! column is `F32Pair`; `HiLo` in `model.rs` adds 6 (8 at degree two).
//!
//! | degree | `F` in `f32` | step in `f32` | `F` in DS | step in DS | ratio |
//! |--:|--:|--:|--:|--:|--:|
//! | 2 | 4 | 22 | 44 | 266 | 12.1 |
//! | 3 | 20 | 38 | 386 | 608 | 16.0 |
//! | 4 | 36 | 54 | 742 | 964 | 17.9 |
//! | 5 | 52 | 70 | 1,098 | 1,320 | 18.9 |
//! | 6 | 68 | 86 | 1,454 | 1,676 | 19.5 |
//!
//! In DS, `F` is `Z^2` by [`ds::c_sqr`] (82) and each higher power by [`ds::c_mul`]
//! (136), the leading `D·Z + δ` by [`ds::c_scale`] and [`ds::c_add`] (84), and each of
//! the `D − 2` Horner steps a `c_mul`, a `c_scale` and a `c_add` (220); then `F · d` is a
//! `c_mul` (136), `+ dc` and `Z + δ` a `c_add` each (40 and 40), and `|z|²` and `|δ|²`
//! are read off the high parts (3 and 3). A Julia step saves the `+ dc`: 40 in DS, 2 in
//! `f32`. Per pass, [`Frame::dc_ds`] is 84 against 4. A skip is 312 against 14. The
//! powers of `Z` are most of the cost from degree four up (an orbit buffer holding
//! `Z^(D-1)` in DS would remove `(D − 2)` products a step); nothing here does that.
//!
//! # Arithmetic rules
//!
//! [`crate::model`]'s, with [`ds`]'s two hazards on top: every error-free transform is
//! marked there, and a backend that reassociates or contracts one turns this kernel back
//! into an `f32` one at twelve to twenty times the cost, which is what
//! [`ds::self_test_vectors`] exists to catch on the device.

use crate::bla::{self, GpuTable};
use crate::ds::{self, Cds, Ds};
use crate::frame::{Frame, FrameLo};
use crate::model::{
    BAILOUT_SQ, BlaStats, CAPPED, DC_HEADROOM, DELTA_FLOOR, DRIFT, ESCAPE_BIG, ESCAPED, FLAG,
    GATED, HANDOFF, INTERIOR, NO_EXPONENT, REBASE_GATE, REBASE_LIFT, RUNNING, SCALE_FLOOR,
    UNSCALE_AT, binomial, derivative_step, reaches, smooth_fraction,
};
use crate::orbit::{Encoding, GpuOrbit};
use crate::proof::{self, Iterate, Proof};
use crate::wgsl::{exponent_of, exponent_of_max, max_abs};

/// The quick path wants `max(|Z|, |δ|)^(D-1)` at least `2^QUICK_FLOOR_DS`.
const QUICK_FLOOR_DS: i32 = -64;
/// ... a `δ` at least `2^DELTA_FLOOR`, or one `2^DELTA_BESIDE_DS` below `|Z|` ...
const DELTA_BESIDE_DS: i32 = 50;
/// ... and `F · d` at least `2^-76` in the delta's units.
const PRODUCT_SIZE_DS: f32 = f32::from_bits((127 - 76) << 23);

/// Everything one pixel carries from one pass to the next, in double-single.
///
/// Laid out as WGSL lays out the same struct: `d_hi` and `d_lo` are `vec2<f32>` at 0
/// and 8, then ten 4-byte scalars to 56, then the interior proof's 72-byte [`Proof`], 128
/// bytes, a multiple of the struct's 8-byte alignment with no padding. As in
/// [`crate::model::PixelState`], `rebases`, `steps` and `scaled` are measurement
/// counters; the kernel needs the rest, 116 bytes, which WGSL would round to 120 (44,
/// rounded to 48, with the interior switch off; against 112 and 40 for the `f32` kernel).
#[repr(C)]
#[derive(Debug, Clone, Copy)]
pub struct DsPixelState {
    /// The delta's mantissa, high parts: `δ = (d_hi + d_lo) · 2^s`.
    pub d_hi: [f32; 2],
    /// The delta's mantissa, low parts.
    pub d_lo: [f32; 2],
    /// The delta's exponent; 0 in the unscaled regime.
    pub s: i32,
    /// The reference index `δ` is measured against.
    pub m: u32,
    /// Iterations so far.
    pub n: u32,
    /// [`RUNNING`], [`ESCAPED`], [`CAPPED`], [`INTERIOR`] or [`GATED`].
    pub status: u32,
    /// The smooth fraction, set at the escape: the smooth count is `n + frac`.
    pub frac: f32,
    /// `|dz|²` as `dz_mantissa · 2^dz_exponent`, the mantissa in `[1, 2)`; held at the
    /// gate's value once the gate has fired.
    pub dz_mantissa: f32,
    pub dz_exponent: i32,
    /// Rebases so far (measurement).
    pub rebases: u32,
    /// Delta steps taken so far (measurement).
    pub steps: u32,
    /// Delta steps taken in the scaled regime (measurement).
    pub scaled: u32,
    /// The interior proof: [`Proof::IDLE`] until the gate fires.
    pub proof: Proof,
}

/// What the GPU stores per pixel between passes in the double-single kernel.
pub const DS_STATE_BYTES: usize = 128;

impl DsPixelState {
    /// The bits of every field but the proof, for bit-identity tests (the proof's own are
    /// [`Proof::bits`]).
    pub fn bits(&self) -> [u32; 14] {
        [
            self.d_hi[0].to_bits(),
            self.d_hi[1].to_bits(),
            self.d_lo[0].to_bits(),
            self.d_lo[1].to_bits(),
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

    /// The delta's mantissa as a complex pair.
    #[inline(always)]
    fn delta(&self) -> Cds {
        [
            ds::from_hi_lo(self.d_hi[0], self.d_lo[0]),
            ds::from_hi_lo(self.d_hi[1], self.d_lo[1]),
        ]
    }

    /// Whether every part of the delta is finite (harness side).
    pub fn finite(&self) -> bool {
        self.d_hi.iter().chain(&self.d_lo).all(|x| x.is_finite())
    }
}

const ZERO: Cds = [Ds { hi: 0.0, lo: 0.0 }, Ds { hi: 0.0, lo: 0.0 }];

/// The high parts of a complex pair.
#[inline(always)]
fn hi(v: Cds) -> [f32; 2] {
    [v[0].hi, v[1].hi]
}

/// `v · 2^e`, both parts of both components, by [`ds::ldexp`].
#[inline(always)]
fn ldexp_c(v: Cds, e: i32) -> Cds {
    [ds::ldexp(v[0], e), ds::ldexp(v[1], e)]
}

/// `Z[m]` as a pair: `(re_hi, re_lo)` and `(im_hi, im_lo)` out of the `vec4` point.
#[inline(always)]
fn reference(p: &[f32; 4]) -> Cds {
    [ds::from_hi_lo(p[0], p[2]), ds::from_hi_lo(p[1], p[3])]
}

/// The state a pixel starts in.
pub fn init_ds(frame: &Frame, lo: &FrameLo, col: u32, row: u32) -> DsPixelState {
    let (d, s, m) = if frame.julia != 0 {
        // Julia: the pixel's offset is the starting delta, and `dc` is never added.
        let (d, s) = settle(frame.dc_ds(lo, col, row), frame.sc);
        (d, s, frame.entry)
    } else {
        (ZERO, 0, 0)
    };
    DsPixelState {
        d_hi: hi(d),
        d_lo: [d[0].lo, d[1].lo],
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
        proof: Proof::IDLE,
    }
}

/// Advances one pixel by at most `budget` delta steps, and returns how many it took.
/// The result after any sequence of passes is bit-identical to one pass with an
/// unbounded budget. The orbit must be [`Encoding::HiLo`]: an `F32Pair` orbit has no low
/// half to read, and this kernel refuses it rather than run at three times the cost of
/// `model.rs` with nothing to show for it.
pub fn pass_ds(
    state: &mut DsPixelState,
    frame: &Frame,
    lo: &FrameLo,
    orbit: &GpuOrbit,
    col: u32,
    row: u32,
    budget: u32,
) -> u32 {
    let mut unused = BlaStats::default();
    dispatch(state, &mut unused, frame, lo, orbit, None, col, row, budget)
}

/// [`pass_ds`] with the skip table switched on, [`crate::model::pass_bla`]'s rules: a
/// skip is one delta step and never split across passes.
#[allow(clippy::too_many_arguments)]
pub fn pass_ds_bla(
    state: &mut DsPixelState,
    stats: &mut BlaStats,
    frame: &Frame,
    lo: &FrameLo,
    orbit: &GpuOrbit,
    table: &GpuTable,
    col: u32,
    row: u32,
    budget: u32,
) -> u32 {
    dispatch(
        state,
        stats,
        frame,
        lo,
        orbit,
        Some(table),
        col,
        row,
        budget,
    )
}

#[allow(clippy::too_many_arguments)]
fn dispatch(
    state: &mut DsPixelState,
    stats: &mut BlaStats,
    frame: &Frame,
    lo: &FrameLo,
    orbit: &GpuOrbit,
    table: Option<&GpuTable>,
    col: u32,
    row: u32,
    budget: u32,
) -> u32 {
    assert_eq!(
        orbit.encoding,
        Encoding::HiLo,
        "the double-single kernel reads a HiLo reference"
    );
    if state.status != RUNNING || budget == 0 {
        return 0;
    }
    macro_rules! go {
        ($($d:literal),*) => {
            match (frame.degree, frame.julia != 0, table.is_some()) {
                $(
                    ($d, false, false) => run::<$d, false, false>(state, stats, frame, lo, orbit, table, col, row, budget),
                    ($d, true, false) => run::<$d, true, false>(state, stats, frame, lo, orbit, table, col, row, budget),
                    ($d, false, true) => run::<$d, false, true>(state, stats, frame, lo, orbit, table, col, row, budget),
                    ($d, true, true) => run::<$d, true, true>(state, stats, frame, lo, orbit, table, col, row, budget),
                )*
                (other, _, _) => panic!("degree {other} is not one the kernel draws"),
            }
        };
    }
    go!(2, 3, 4, 5, 6)
}

/// Runs one pixel to its end in passes of `budget` steps.
pub fn run_pixel_ds(
    frame: &Frame,
    lo: &FrameLo,
    orbit: &GpuOrbit,
    col: u32,
    row: u32,
    budget: u32,
) -> DsPixelState {
    let mut state = init_ds(frame, lo, col, row);
    while state.status == RUNNING {
        pass_ds(&mut state, frame, lo, orbit, col, row, budget.max(1));
    }
    state
}

/// [`run_pixel_ds`] with the skip table switched on.
#[allow(clippy::too_many_arguments)]
pub fn run_pixel_ds_bla(
    frame: &Frame,
    lo: &FrameLo,
    orbit: &GpuOrbit,
    table: &GpuTable,
    col: u32,
    row: u32,
    budget: u32,
) -> (DsPixelState, BlaStats) {
    let mut state = init_ds(frame, lo, col, row);
    let mut stats = BlaStats::default();
    while state.status == RUNNING {
        pass_ds_bla(
            &mut state,
            &mut stats,
            frame,
            lo,
            orbit,
            table,
            col,
            row,
            budget.max(1),
        );
    }
    (state, stats)
}

/// The smooth count `perturb` would report: `n + frac` on an escape, `NaN` otherwise.
/// Harness side.
pub fn smooth_f64_ds(state: &DsPixelState) -> f64 {
    if state.status == ESCAPED {
        state.n as f64 + state.frac as f64
    } else {
        f64::NAN
    }
}

/// `dc` in the delta's units, `dc · 2^(sc - s)`, while that is finite; recomputed
/// whenever `s` changes and never stored.
#[derive(Clone, Copy)]
struct Scale {
    dc: Cds,
    dc_fits: bool,
}

#[inline(always)]
fn scale_of(dc: Cds, sc: i32, s: i32) -> Scale {
    let dc_fits = sc - s <= DC_HEADROOM;
    Scale {
        dc: if dc_fits { ldexp_c(dc, sc - s) } else { ZERO },
        dc_fits,
    }
}

/// `model.rs`'s `settle`, deciding on the high parts and scaling both. Exact while `lo`
/// stays normal. A zero delta is an unscaled zero.
#[inline(always)]
fn settle(d: Cds, e: i32) -> (Cds, i32) {
    let x = exponent_of(max_abs(d[0].hi, d[1].hi));
    if x == -127 {
        return (ldexp_c(d, 0), 0);
    }
    if x + e >= UNSCALE_AT {
        return (ldexp_c(d, e), 0);
    }
    (ldexp_c(d, -x), e + x)
}

/// `model.rs`'s `renormalize`, the same thresholds read off the high parts.
#[inline(always)]
fn renormalize(d: Cds, s: i32) -> (Cds, i32) {
    if s == 0 {
        if d[0].hi.abs() >= SCALE_FLOOR || d[1].hi.abs() >= SCALE_FLOOR {
            return (d, 0);
        }
        return settle(d, 0);
    }
    let e = exponent_of(max_abs(d[0].hi, d[1].hi));
    if e == -127 {
        return (ldexp_c(d, 0), s);
    }
    if e + s >= UNSCALE_AT {
        return (ldexp_c(d, s), 0);
    }
    if !(-DRIFT..=DRIFT).contains(&e) {
        return (ldexp_c(d, -e), s + e);
    }
    (d, s)
}

/// `F` with `δ' = F · δ (+ dc)`, `model.rs`'s `factor` in double-single: `2Z + δ` at
/// degree two, and above it Horner's form over the powers of `Z`, `Z^2` by
/// [`ds::c_sqr`]. `z` and `t` in one unit.
#[inline(always)]
fn factor<const D: usize>(z: &Cds, t: Cds) -> Cds {
    if D == 2 {
        return ds::c_add([ds::double(z[0]), ds::double(z[1])], t);
    }
    let b = const { binomial(D) };
    let mut pw = [ZERO; 6];
    pw[1] = *z;
    pw[2] = ds::c_sqr(*z);
    let mut j = 3;
    while j < D {
        pw[j] = ds::c_mul(pw[j - 1], *z);
        j += 1;
    }
    let mut p = ds::c_add(ds::c_scale(*z, b[D - 1]), t);
    let mut k = D - 2;
    while k >= 1 {
        p = ds::c_add(ds::c_mul(p, t), ds::c_scale(pw[D - k], b[k]));
        k -= 1;
    }
    p
}

/// `2^ceil(QUICK_FLOOR_DS / (D-1))`: `max(|Z|, |δ|)` at least this is
/// `(D-1)·v >= QUICK_FLOOR_DS`.
const fn quick_size<const D: usize>() -> f32 {
    f32::from_bits(((127 + QUICK_FLOOR_DS / (D as i32 - 1)) as u32) << 23)
}

/// `model.rs`'s careful step in double-single: `Z` and `δ` in the unit `2^v`, `F` formed
/// there and rescaled by its own exponent, times `d`, added to `dc` at the larger
/// exponent. Returns the new delta in the state's form.
#[cold]
#[inline(never)]
fn careful_step<const D: usize, const JULIA: bool>(
    z: Cds,
    d: Cds,
    s: i32,
    dc: Cds,
    dc_e: i32,
    sc: i32,
) -> (Cds, i32) {
    let dm1 = (D - 1) as i32;
    let ez = exponent_of_max(z[0].hi, z[1].hi);
    let ed = s + exponent_of_max(d[0].hi, d[1].hi);
    let v = if ez > ed { ez } else { ed };
    let f = factor::<D>(&ldexp_c(z, -v), ldexp_c(d, s - v));
    let ef = exponent_of_max(f[0].hi, f[1].hi);
    let g = ds::c_mul(ldexp_c(f, -ef), d);
    let ge = dm1 * v + ef + s;
    let gx = match exponent_of_max(g[0].hi, g[1].hi) {
        -127 => NO_EXPONENT,
        x => ge + x,
    };
    let at = if gx > dc_e { gx } else { dc_e };
    if at == NO_EXPONENT {
        return (ZERO, s);
    }
    let mut sum = ldexp_c(g, ge - at);
    if !JULIA {
        sum = ds::c_add(sum, ldexp_c(dc, sc - at));
    }
    settle(sum, at)
}

/// The loop: `model.rs`'s `run` with the delta, the reference, `dc` and every value
/// carried from one step to the next in double-single.
#[inline(never)]
#[allow(clippy::too_many_arguments)]
fn run<const D: usize, const JULIA: bool, const BLA: bool>(
    st: &mut DsPixelState,
    stats: &mut BlaStats,
    frame: &Frame,
    lo: &FrameLo,
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
    let dc = frame.dc_ds(lo, col, row);
    let dc_e = if JULIA {
        NO_EXPONENT
    } else {
        match exponent_of(max_abs(dc[0].hi, dc[1].hi)) {
            -127 => NO_EXPONENT,
            e => sc + e,
        }
    };

    let mut d = st.delta();
    let mut s = st.s;
    let mut scale = scale_of(dc, sc, s);
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
    let policy = frame.interior;
    let margins = &lo.margins;
    let mut proof = st.proof;

    while taken < budget {
        // ---- the skip, looked up on the high parts and applied to the pair; not while
        // the proof carries discs.
        let s0 = s;
        let mut hit: Option<bla::Hit> = None;
        if BLA
            && proof.phase != proof::CARRYING
            && let Some(t) = table
        {
            let guard = if track_interior && proof.phase == proof::IDLE {
                Some((dzm, dze, floor))
            } else {
                None
            };
            let before = reads;
            hit = bla::lookup_hinted(t, m, hi(d), s, maxiter - n, guard, &mut hint, &mut reads);
            probes += (reads != before) as u32;
        }
        if let (true, Some(h), Some(t)) = (BLA, hit, table) {
            let i = h.index as usize;
            let (sum, at) = bla::apply_ds::<JULIA>(&t.entries[i], &t.lo[i], d, s, dc, sc);
            let (nd, ns) = settle(sum, at);
            d = nd;
            if ns != s {
                s = ns;
                scale = scale_of(dc, sc, s);
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
            if periodic && m >= length {
                m = 0;
            }
        } else {
            // ---- step: δ' = F(Z[m], δ) · δ (+ dc), in the delta's units.
            let p = &points[m as usize];
            let zr = reference(p);
            let gate = if s == 0 {
                reaches([p[0], p[1]], const { quick_size::<D>() })
                    || reaches(hi(d), const { quick_size::<D>() })
            } else {
                let em = exponent_of_max(d[0].hi, d[1].hi);
                let ez = exponent_of_max(p[0], p[1]);
                let ed = s + em;
                let v = if ez > ed { ez } else { ed };
                dm1 * v >= QUICK_FLOOR_DS && (ed >= DELTA_FLOOR || ez >= ed + DELTA_BESIDE_DS)
            } && (JULIA || scale.dc_fits);
            let product = ds::c_mul(factor::<D>(&zr, ldexp_c(d, s)), d);
            let next = if JULIA {
                product
            } else {
                ds::c_add(product, scale.dc)
            };
            if gate && reaches(hi(product), PRODUCT_SIZE_DS) {
                d = next;
            } else {
                let (nd, ns) = careful_step::<D, JULIA>(zr, d, s, dc, dc_e, sc);
                d = nd;
                if ns != s {
                    s = ns;
                    scale = scale_of(dc, sc, s);
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

        // ---- reconstruct and escape: `z = zv · 2^ze`, the pair; the tests read `hi`.
        let p = &points[m as usize];
        let zr = reference(p);
        let (z, zv, ze) = if s != 0 && exponent_of_max(p[0], p[1]) <= REBASE_GATE + s {
            let zs = ds::c_add(ldexp_c(zr, -s), d);
            (ldexp_c(zs, s), zs, s)
        } else {
            let z = ds::c_add(zr, ldexp_c(d, s));
            (z, z, 0)
        };
        let z_hi = hi(z);
        let big = reaches(z_hi, ESCAPE_BIG);
        let z_norm_sq = if big {
            BAILOUT_SQ
        } else {
            z_hi[0] * z_hi[0] + z_hi[1] * z_hi[1]
        };
        if big || z_norm_sq > BAILOUT_SQ {
            frac = smooth_fraction::<D>(z_hi, z_norm_sq, big);
            status = ESCAPED;
            break;
        }

        // ---- interior switch: the gate on the high parts, the proof on the pair.
        if track_interior {
            let it = Iterate::pair(hi(zv), [zv[0].lo, zv[1].lo], ze).read_from(orbit.flush);
            if proof.phase == proof::IDLE {
                let nonzero = if let (true, Some(h), Some(t)) = (BLA, hit, table) {
                    let x = &t.interior[h.index as usize];
                    let product = dzm * x.deriv_m;
                    let e = exponent_of(product);
                    dzm = crate::wgsl::ldexp_exact(product, -e);
                    dze += x.deriv_e + e;
                    derivative_step::<D>(&mut dzm, &mut dze, hi(zv), ze, z_norm_sq)
                } else {
                    derivative_step::<D>(&mut dzm, &mut dze, hi(zv), ze, z_norm_sq)
                };
                if !nonzero || dze < floor {
                    proof = Proof::arm(it, hi(d), s, n, margins);
                }
            } else if BLA && hit.is_some() {
                proof.break_disc();
                proof.rearm_if_lower(it, hi(d), s, n, margins);
            } else if proof.advance::<D>(it, hi(d), s, n, margins) {
                status = INTERIOR;
                break;
            }
            if policy == HANDOFF && proof.phase == proof::WAITING {
                status = GATED;
                break;
            }
        }

        // ---- cap.
        if n >= maxiter {
            status = if policy == FLAG && proof.gated() {
                GATED
            } else {
                CAPPED
            };
            break;
        }

        // ---- renormalize, then rebase; the compares read `hi`, the rebased delta is
        // the whole pair.
        let (rd, rs) = renormalize(d, s);
        d = rd;
        if rs != s {
            s = rs;
            scale = scale_of(dc, sc, s);
        }
        let exhausted = !periodic && m >= last;
        let mut rebase_to: Option<(Cds, i32)> = None;
        let d_hi = hi(d);
        if s == 0 {
            let delta_norm_sq = d_hi[0] * d_hi[0] + d_hi[1] * d_hi[1];
            if z_norm_sq < delta_norm_sq || exhausted {
                if reaches(z_hi, SCALE_FLOOR) {
                    rebase_to = Some((z, 0));
                } else {
                    let zs = ds::c_add(ldexp_c(zr, REBASE_LIFT), ldexp_c(d, REBASE_LIFT));
                    rebase_to = Some((zs, -REBASE_LIFT));
                }
            }
        } else if exponent_of(max_abs(p[0], p[1])) <= REBASE_GATE + s {
            let zs = ds::c_add(ldexp_c(zr, -s), d);
            let zs_hi = hi(zs);
            let zs_norm_sq = zs_hi[0] * zs_hi[0] + zs_hi[1] * zs_hi[1];
            let delta_norm_sq = d_hi[0] * d_hi[0] + d_hi[1] * d_hi[1];
            if zs_norm_sq < delta_norm_sq || exhausted {
                rebase_to = Some((zs, s));
            }
        } else if exhausted {
            rebase_to = Some((z, 0));
        }
        if let Some((nd, ns)) = rebase_to {
            let (rd, rs) = renormalize(nd, ns);
            d = rd;
            if rs != s {
                s = rs;
                scale = scale_of(dc, sc, s);
            }
            m = 0;
            rebases += 1;
            proof.rebased(margins, orbit.flush);
        }
    }

    st.proof = proof;
    st.d_hi = hi(d);
    st.d_lo = [d[0].lo, d[1].lo];
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

    /// The struct is what WGSL would lay out: two `vec2<f32>` at 0 and 8, then ten
    /// 4-byte scalars, then the proof at 56 (8-aligned), 128 bytes, a multiple of the
    /// `vec2`'s 8-byte alignment.
    #[test]
    fn ds_state_is_128_bytes_in_wgsl_layout() {
        assert_eq!(size_of::<DsPixelState>(), DS_STATE_BYTES);
        assert_eq!(DS_STATE_BYTES, 56 + proof::PROOF_BYTES);
        assert_eq!(DS_STATE_BYTES, 128);
        assert_eq!(offset_of!(DsPixelState, proof), 56);
        assert_eq!(DS_STATE_BYTES % 8, 0);
        assert_eq!(offset_of!(DsPixelState, d_hi), 0);
        assert_eq!(offset_of!(DsPixelState, d_lo), 8);
        assert_eq!(offset_of!(DsPixelState, s), 16);
        assert_eq!(offset_of!(DsPixelState, m), 20);
        assert_eq!(offset_of!(DsPixelState, n), 24);
        assert_eq!(offset_of!(DsPixelState, status), 28);
        assert_eq!(offset_of!(DsPixelState, frac), 32);
        assert_eq!(offset_of!(DsPixelState, dz_mantissa), 36);
        assert_eq!(offset_of!(DsPixelState, dz_exponent), 40);
        assert_eq!(offset_of!(DsPixelState, rebases), 44);
        assert_eq!(offset_of!(DsPixelState, steps), 48);
        assert_eq!(offset_of!(DsPixelState, scaled), 52);
    }

    fn value(d: Cds, s: i32) -> [f64; 2] {
        let k = 2f64.powi(s);
        [ds::to_f64(d[0]) * k, ds::to_f64(d[1]) * k]
    }

    fn pair(re: f64, im: f64) -> Cds {
        [ds::from_f64(re), ds::from_f64(im)]
    }

    /// Every regime change scales both parts exactly, so the represented value never
    /// moves, low half included.
    #[test]
    fn renormalize_keeps_the_pair() {
        let third = 1.0 / 3.0;
        for (d, s) in [
            (pair(third * 1e-20, -third * 1e-21), 0),
            (pair(1.5 + third * 1e-9, 0.25), -60),
            (pair(third * 2e12, 1.0), -150),
            (pair(1.0 + third * 1e-7, 0.5), -400),
        ] {
            let (rd, rs) = renormalize(d, s);
            assert_eq!(value(rd, rs), value(d, s), "{d:?} {s}");
            assert_ne!(rd[0].lo, 0.0, "{d:?} {s}: the low half was lost");
        }
        let (z, s) = renormalize(ZERO, 0);
        assert_eq!((hi(z), s), ([0.0, 0.0], 0));
    }

    /// The double-single step keeps what the `f32` one rounds away: one step of
    /// `δ' = (2Z + δ)·δ + dc` against the same step in `f64` from the same inputs.
    #[test]
    fn one_step_is_double_single_accurate() {
        let z = pair(-0.745_123_456_789_012_3, 0.151_234_567_890_123_4);
        let d = pair(1.234_567_890_123_456e-9, -2.345_678_901_234_567e-9);
        let dc = pair(3.141_592_653_589_793e-12, 2.718_281_828_459_045e-12);
        let got = ds::c_add(ds::c_mul(factor::<2>(&z, d), d), dc);
        let [zr, zi] = [ds::to_f64(z[0]), ds::to_f64(z[1])];
        let [dr, di] = [ds::to_f64(d[0]), ds::to_f64(d[1])];
        let (fr, fi) = (2.0 * zr + dr, 2.0 * zi + di);
        let want = [
            fr * dr - fi * di + ds::to_f64(dc[0]),
            fr * di + fi * dr + ds::to_f64(dc[1]),
        ];
        let size = want[0].abs().max(want[1].abs());
        for k in 0..2 {
            let err = (ds::to_f64(got[k]) - want[k]).abs() / size;
            assert!(err < 2f64.powi(-44), "component {k}: 2^{:.1}", err.log2());
        }
    }

    /// Degree six through Horner's form, against the binomial expansion in `f64`.
    #[test]
    fn factor_matches_the_expansion_at_every_degree() {
        let z = pair(0.612_345_678_901_234_5, -0.432_109_876_543_210_9);
        let t = pair(0.012_345_678_901_234_56, 0.023_456_789_012_345_67);
        let zc = [ds::to_f64(z[0]), ds::to_f64(z[1])];
        let tc = [ds::to_f64(t[0]), ds::to_f64(t[1])];
        let mul = |a: [f64; 2], b: [f64; 2]| [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]];
        fn check<const D: usize>(z: &Cds, t: Cds, want: [f64; 2]) {
            let got = factor::<D>(z, t);
            let size = want[0].hypot(want[1]);
            for k in 0..2 {
                let err = (ds::to_f64(got[k]) - want[k]).abs() / size;
                assert!(err < 2f64.powi(-43), "degree {D}: 2^{:.1}", err.log2());
            }
        }
        // F = Σ_{k=1}^{D} C(D,k) Z^(D-k) t^(k-1).
        let expand = |deg: usize| {
            let b = binomial(deg);
            let mut sum = [0.0f64; 2];
            for (k, &bk) in b.iter().enumerate().take(deg + 1).skip(1) {
                let mut term = [bk as f64, 0.0];
                for _ in 0..deg - k {
                    term = mul(term, zc);
                }
                for _ in 0..k - 1 {
                    term = mul(term, tc);
                }
                sum = [sum[0] + term[0], sum[1] + term[1]];
            }
            sum
        };
        check::<2>(&z, t, expand(2));
        check::<3>(&z, t, expand(3));
        check::<4>(&z, t, expand(4));
        check::<5>(&z, t, expand(5));
        check::<6>(&z, t, expand(6));
    }
}
