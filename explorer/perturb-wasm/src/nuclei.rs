//! The minibrots in and around a view: find them, rank them, frame them.
//!
//! A view of the Mandelbrot set at depth holds many nuclei and the reader can see
//! only the structure, not which of them are worth going to. This module answers
//! "what is near here, largest first" in two halves, cheap then expensive:
//!
//! - **Atom domains say where and roughly what.** The index at which a sample's
//!   `|z|` is smallest is the period of the component whose atom domain it lies
//!   in ([`crate::kernel::Domain`]), so a coarse grid over the frame partitions
//!   it into one region per nucleus and costs one walk of a few thousand cells.
//! - **Newton says exactly where.** `z_p(c) = 0` solved from the best cell of
//!   each region, in fixed point, which is what turns a region into a centre a
//!   link can carry.
//!
//! ## The derivative does not go in fixed point
//!
//! This is the one thing in here that is not the obvious construction, and it is
//! worth reading before changing anything. `d = dz_p/dc` at a nucleus of atom
//! size 1e-44 is of order **1e44**, and [`Fx`]'s integer limb holds up to about
//! 4.6e18: carried there it would overflow, and fixed point overflows *silently*
//! — the same failure [`crate::reference::orbit`]'s bailout check exists to
//! avoid, arriving as a plausible wrong answer rather than as an error.
//!
//! It does not need to be there. A Newton correction and a size estimate want
//! **relative** precision, so `d` and the size product `A` ride as an `f64`
//! mantissa with a power-of-two exponent — [`crate::kernel`]'s own representation
//! for `|dz|²`, for the same reason. Only `z` stays in fixed point, because `z`
//! is a coordinate and collapses to the atom's own scale.
//!
//! Two things follow. The step costs **three `Fx` multiplies per orbit step**
//! rather than seven, which is most of why a solve is affordable at all. And the
//! `f64` projection of `z_k` is enough for both products: [`Fx::to_f64`] keeps
//! two limbs from the top non-zero one, so it is relative rather than absolute
//! precision and a tiny `z` projects as well as a large one.
//!
//! ## How far Newton gets
//!
//! The correction is formed in `f64`, so one step improves the answer to about
//! sixteen digits past the size of the step itself. From a seed a grid cell away
//! at 1e-22 that is 1e-22 → 1e-38 → 1e-54 → 1e-70: **three or four steps**, not
//! the dozen a linearly converging method would want.

use crate::fx::{Fx, pow2};
use crate::kernel::Kernel;
use crate::reference::{BAILOUT, Reference};
use crate::{Spec, progress, reference};

/// How many samples across and down the domain grid is, by default.
///
/// The cap policy's own probe grid ([`crate::policy::PROBE_COLS`]), and for its
/// reason: it is a few thousand cells of the frame's own sample grid, which is
/// about a thousandth of one pass. The page passes its own.
pub const GRID_COLS: u32 = 64;
/// See [`GRID_COLS`].
pub const GRID_ROWS: u32 = 36;

/// How wide a preview tile is drawn beside the minibrot it frames, as a multiple
/// of the body's own width.
///
/// **Twelve** *(find_minibrots_cap2_ckpt145; it was six)*, which puts the copy's
/// black body at about **a quarter of a 16:9 frame's height**. The size estimate is
/// the copy's scale and not its extent: a copy is roughly as tall as the whole set
/// is, about two of its own sizes, so at six the body filled 0.59 to 0.61 of the
/// height on every real-axis copy measured and read as the picture rather than as
/// a place in one. At twelve it is 0.25 to 0.27 — a copy with its surroundings in
/// frame, which is what a reader zooms out from to find the two-, four- and
/// eight-fold frames around it. Ten gave 0.30 to 0.37 and sixteen 0.19 to 0.20;
/// twelve is inside the fifth-to-a-third the brief asked for at every one. A body at
/// 1× is a black tile.
///
/// **A copy the page opens is framed by its measured body now, and this is the
/// preview's framing and the fallback's** *(find_minibrots_bulbs_ckpt145)*: see
/// [`copy_width`], and `explorer/deep.js`'s `measured`. A bulb keeps this framing.
pub const TILE_BODIES: f64 = 12.0;

/// How many periods of its own nucleus a preview tile is iterated for.
///
/// **Eight, and the width policy cannot supply it.** This is the most consequential
/// number in this module and it was measured rather than chosen —
/// `tests/frames.rs`'s `what_a_preview_tile_needs` is the table. At a tile of a
/// period-94,776 minibrot the width policy gives about 150,000 iterations, which
/// is **one and a half periods**, and the tile comes back **100% unresolved: a
/// flat black rectangle, drawn slowly**. Two and four periods are the same
/// picture. At eight, 74% of the tile escapes and the minibrot is there; at
/// sixteen it is 85% and the rest is the body, and past that nothing moves.
///
/// | periods | escaped | starved |
/// |--:|--:|--:|
/// | 1.5 (the width policy) | 0.0% | 100% |
/// | 4 | 0.0% | 100% |
/// | **8** | **74.4%** | 25.6% |
/// | 16 | 85.4% | 14.5% |
/// | 32 | 85.4% | 14.5% |
///
/// A point near a period-`p` minibrot needs many periods before anything about it
/// resolves, and a *tile* is the one frame on this site that knows its own period
/// — it is centred on a nucleus that was just solved. Everywhere else the cap is
/// the frame's to ask for ([`crate::policy`]) precisely because nothing knows
/// what the frame contains.
///
/// **The same eight at every degree** *(deep_degrees_ckpt140)*: re-measured on each
/// higher degree's `tangle 1e-22`, eight periods resolves 73% to 94% of a tile and
/// sixteen adds at most fifteen points more — at or past the knee everywhere. The crate
/// README §10 has the table.
///
/// ⚠ **And this is what makes a deep tile expensive**, which is a finding rather
/// than a tuning: the cost is `samples × 8p`, and `p` at the depths
/// `tests/frames.rs` lives at is of the order of the cap itself. See the crate
/// README.
pub const TILE_PERIODS: u32 = 8;

/// The cap a preview tile of a period-`p` nucleus is drawn at: whichever of the
/// width policy and [`TILE_PERIODS`] periods is larger, under the **automatic**
/// ceiling, [`crate::cap::AUTOMATIC_CEILING`]: a tile is drawn unasked, for every
/// entry a search finds, so it is the explorer choosing a cap by itself. It binds
/// from period 125,000.
///
/// The width policy is still the floor because a *shallow* minibrot's period can
/// be small enough that eight of them is less depth than the frame deserves.
pub fn tile_cap(period: u32, width: f64) -> u32 {
    periods_cap(period, TILE_PERIODS, width, crate::cap::AUTOMATIC_CEILING)
}

/// How many periods of its own nucleus a minibrot is iterated for **once it is
/// opened** — the frame a list entry goes to, and the `n` its link carries.
///
/// **Thirty-two, and a preview tile's eight is not enough for it** *(Matt,
/// find_minibrots_cap2_ckpt145)*. [`TILE_PERIODS`] was chosen on the share of a
/// 316-pixel tile that escapes, and at that size eight reads. The frame a reader
/// opens is the viewer's own, several times the pixels, and there a copy drawn at
/// about thirteen periods came back as an all-black blob with nothing of its own
/// edge resolved; at about thirty-two it resolved. A blob is the failure this cap
/// exists to prevent, so the open frame pays four times a tile's periods, and the
/// preview keeps its eight because it is drawn unasked.
pub const OPEN_PERIODS: u32 = 32;

/// The cap an opened minibrot of period `p` is drawn at: whichever of the width
/// policy and [`OPEN_PERIODS`] periods is larger, under the **explicit** ceiling,
/// [`crate::cap::EXPLICIT_CEILING`] *(Matt, cap_split_ckpt145)*: a reader opens
/// one entry on purpose, and the cap is written into its link as `n`.
///
/// ⚠ **The ceiling binds from period 62,500.** Past it a copy is drawn at the two
/// million iterations the explicit ceiling allows, which is fewer than thirty-two
/// of its periods and falls to eight — [`TILE_PERIODS`] — at period 250,000. Under
/// the single million-iteration ceiling this replaced, it bound from 31,250, and
/// the double descent's M₂ (period 32,761) opened at 30.5 periods.
pub fn open_cap(period: u32, width: f64) -> u32 {
    periods_cap(period, OPEN_PERIODS, width, crate::cap::EXPLICIT_CEILING)
}

/// The width policy or `periods` of a period-`p` nucleus, whichever is larger, under
/// the ceiling the caller means.
fn periods_cap(period: u32, periods: u32, width: f64, ceiling: f64) -> u32 {
    crate::cap::for_width(width)
        .max(period.saturating_mul(periods))
        .min(ceiling as u32)
}

/// Newton steps a solve will take before giving up on a seed.
///
/// **Eight, against an expectation of three or four.** The module header says
/// why the expectation is low; the margin is for a seed that starts further out
/// than a grid cell, which happens when a domain's best cell sits at the edge of
/// its region.
pub const MAX_STEPS: u32 = 8;

/// One seed: a region of the frame, the period it belongs to, and the best cell
/// in it.
#[derive(Clone, Copy, Debug)]
pub struct Seed {
    pub period: u32,
    /// The cell's offset **from the view centre**, which is what a caller adds
    /// to the centre to get a starting `c`.
    ///
    /// Not the `dc` the kernel took: that is measured from the *reference*, and
    /// a frame drawn against a reference it is not centred on would have every
    /// seed displaced by the difference. Taking it off here rather than at each
    /// caller is one subtraction in one place instead of the same one in two.
    pub from_re: f64,
    pub from_im: f64,
    /// `|z|²` at the period. Smaller is nearer the nucleus.
    pub minimum: f64,
    /// Cells of the grid that reported this period — the region's size, and what
    /// says a domain is real rather than one stray cell.
    pub cells: u32,
}

/// Where one Newton step landed.
#[derive(Clone, Debug)]
pub struct Step {
    pub c_re: Fx,
    pub c_im: Fx,
    /// `|Δc|`, the correction just applied. The convergence test is the caller's.
    pub moved: f64,
    /// `log₂|l|`, `l = ∏ 2·z_k` for `k = 1..p`. **`1/|l|` is the atom
    /// *domain*** — the neighbourhood the nucleus dominates — and not the
    /// minibrot. See [`Step::size_log2`].
    pub window_log2: f64,
    /// `log₂` of the minibrot's own width: `−log₂|b·l²|`, Vepstas' estimate,
    /// with `b = 1 + Σ 1/l_k`.
    ///
    /// **The square is the whole point and it is the prompt's own arithmetic.**
    /// A minibrot found in a view at 1e-n sits near 1e-2n, which is exactly the
    /// relation between the domain and the body: the domain is at the view's
    /// scale, and the body is its square over an `O(1)` correction. On the
    /// audit's anchor `1/|l|` is 9.75e-6 and the body is **6.478e-12**, the
    /// number the crate README has recorded since the kernel landed — a factor
    /// of 14.7 apart from the bare square, which is `|b|`.
    ///
    /// A tile framed on the domain would put the minibrot in it at a millionth
    /// of the frame, which is to say nowhere. Both numbers are carried because
    /// ranking, framing and the "already fills this view" test all want the
    /// body, and only the seed search wants the domain.
    ///
    /// Kept as logarithms because `|l|` at these depths runs past what an `f64`
    /// exponent holds long before the frames stop being interesting.
    pub size_log2: f64,
    /// The orbit left the bailout disc before the period was up, so this `c` is
    /// not in the set and the step means nothing.
    pub escaped: bool,
}

/// A nucleus, solved.
#[derive(Clone, Debug)]
pub struct Nucleus {
    pub period: u32,
    pub c_re: Fx,
    pub c_im: Fx,
    /// `log₂` of the **minibrot's own width** — see [`Step::size_log2`], which
    /// is where the difference between this and the domain is argued. A body of
    /// 1e-44 is about −146 here.
    pub size_log2: f64,
    /// `log₂|l|`: the atom *domain* is `2^-window_log2` across. Carried so that
    /// a caller can say how far apart two nuclei have to be to be two.
    pub window_log2: f64,
    /// Newton steps taken.
    pub steps: u32,
    /// The last correction applied, as a share of the atom size. Small is
    /// converged; this is reported rather than asserted, the way
    /// [`Reference::period_residual`] is.
    pub residual: f64,
}

impl Nucleus {
    /// The atom size itself, where an `f64` still holds it, and zero where the
    /// exponent has run out underneath it.
    pub fn size(&self) -> f64 {
        if self.size_log2 < -1060.0 {
            0.0
        } else {
            pow2(self.size_log2.floor() as i32) * (self.size_log2 - self.size_log2.floor()).exp2()
        }
    }
}

// ------------------------------------------------------------------ the cheap half

/// The distinct atom domains a coarse grid of this frame falls into, best cell
/// first within each.
///
/// **One seed per period, which is the cheap deduplication.** Two nuclei of the
/// same period in one view is possible and rare; what catches it is not this but
/// the landing test in [`search`], because two seeds that converge to the same
/// point are one nucleus however they were grouped.
///
/// The orbit is the frame's own and is **borrowed**, as everywhere else in this
/// crate that takes one.
pub fn seeds(spec: &Spec, orbit: &Reference, cols: u32, rows: u32) -> Vec<Seed> {
    seeds_in_rows(spec, orbit, cols, rows, 0, rows)
}

/// [`seeds`] over probe rows `[row_start, row_end)` alone, which is how the page
/// spreads the walk across the pool.
///
/// **Merging is the caller's, and it is two lines**: a period that appears in two
/// bands has its `cells` added and keeps the smaller `minimum` with the cell that
/// produced it. Nothing else about a seed is order-dependent, which is why the
/// walk can be cut at all.
pub fn seeds_in_rows(
    spec: &Spec,
    orbit: &Reference,
    cols: u32,
    rows: u32,
    row_start: u32,
    row_end: u32,
) -> Vec<Seed> {
    let kernel = Kernel::new(orbit, spec.maxiter(), spec.interior).at_entry(spec.entry());
    let offset = spec.centre_offset().unwrap_or((0.0, 0.0));
    let julia = spec.julia.is_some();
    let sample_width = spec.sample_width().max(1);
    let sample_height = spec.sample_height().max(1);
    let cols = cols.clamp(1, sample_width);
    let rows = rows.clamp(1, sample_height);

    let mut found: Vec<Seed> = Vec::new();
    let last = row_end.min(rows);
    let cells = last.saturating_sub(row_start) * cols;
    for j in row_start..last {
        let row = spread(j, rows, sample_height);
        for i in 0..cols {
            progress::report((j - row_start) * cols + i, cells);
            let col = spread(i, cols, sample_width);
            let (re, im) = spec.dc(offset, col, row);
            let domain = kernel.domain_at(spec.degree, julia, re, im);
            if domain.period == 0 || !domain.minimum.is_finite() {
                continue;
            }
            match found.iter_mut().find(|seed| seed.period == domain.period) {
                Some(seed) => {
                    seed.cells += 1;
                    if domain.minimum < seed.minimum {
                        seed.minimum = domain.minimum;
                        seed.from_re = re - offset.0;
                        seed.from_im = im - offset.1;
                    }
                }
                None => found.push(Seed {
                    period: domain.period,
                    from_re: re - offset.0,
                    from_im: im - offset.1,
                    minimum: domain.minimum,
                    cells: 1,
                }),
            }
        }
    }
    // **Widest domain first, and that is the ranking that matters**, because a
    // solve is the expensive half and only a budgeted few of these will get one.
    // The cells a domain takes on the grid are a free measure of how much of the
    // frame that nucleus dominates, and the domain's scale is the body's square
    // root — so the biggest minibrot is very likely to be under the most cells,
    // while `minimum` says only how squarely one cell happened to hit. Nearest
    // approach breaks the tie, since that cell is the better Newton seed.
    found.sort_by(|a, b| {
        b.cells.cmp(&a.cells).then(
            a.minimum
                .partial_cmp(&b.minimum)
                .unwrap_or(core::cmp::Ordering::Equal),
        )
    });
    found
}

// -------------------------------------------------------------- the expensive half

/// One Newton step on `z_p(c) = 0`, from `c`, for `z ↦ z^degree + c`.
///
/// See the module header for why `d` and `A` are scaled `f64` and only `z` is
/// fixed point.
///
/// **At degree `D` the derivative is `D·z^{D−1}`** *(deep_degrees_ckpt140)*, in
/// both of the products: `d ← D·z^{D−1}·d + 1` and `l ← l·D·z^{D−1}`. The power is
/// formed from the `f64` projection of `z`, which is the module header's point
/// about relative precision made once more — `z^{D−1}` wants sixteen digits of
/// `z`, not two hundred. At degree two every line is the one that was here.
///
/// **And the escape guard is the reference orbit's**, for the reference orbit's
/// reason: at degree four an iterate under the bailout raised to the fourth
/// power wraps the signed integer limb, silently. Above degree two a step is
/// abandoned as escaped once `|z| > 8`, which is outside every Multibrot set of
/// these degrees — `|z| > 2^{1/(D−1)}` already escapes — so nothing that could
/// be a nucleus is lost to it.
pub fn newton_step(c_re: &Fx, c_im: &Fx, period: u32, degree: u32) -> Step {
    let n = c_re.n;
    let bailout_sq = if degree == 2 { BAILOUT * BAILOUT } else { 64.0 };
    let slope = degree as f64;

    let mut z_re = Fx::zero(n);
    let mut z_im = Fx::zero(n);
    // `d`, as mantissa × 2^exponent. `d₀ = 0`.
    let (mut d_re, mut d_im, mut d_exp) = (0.0f64, 0.0f64, 0i32);
    // `l`, the same way, opening at one and taking its factors from `k ≥ 1`:
    // `z₀` is the origin and `2·z₀` would make the product identically zero,
    // which is the same trap the interior switch's own derivative avoids.
    let (mut l_re, mut l_im, mut l_exp) = (1.0f64, 0.0f64, 0i32);
    // `b = 1 + Σ 1/l_k`, Vepstas' correction, an `O(1)` number that needs no
    // exponent of its own — the terms are bounded by `1/|l|` and die as it grows.
    let (mut b_re, mut b_im) = (1.0f64, 0.0f64);

    for k in 0..period {
        let (zr, zi) = (z_re.to_f64(), z_im.to_f64());
        if !(zr * zr + zi * zi <= bailout_sq) {
            return Step {
                c_re: *c_re,
                c_im: *c_im,
                moved: f64::NAN,
                window_log2: f64::NAN,
                size_log2: f64::NAN,
                escaped: true,
            };
        }

        // `z^{D−1}`, which at degree two is `z` itself.
        let (sr, si) = if degree == 2 {
            (zr, zi)
        } else {
            let [a, b] = reference::cpow_f64([zr, zi], degree - 1);
            (a, b)
        };

        // `d ← 2·z·d + 1`, at degree two. The `+1` is added at the mantissa's own
        // scale and vanishes once `|d|` is large, which is correct rather than
        // lossy: it is below the last bit of the thing beside it.
        let one = pow2(-d_exp);
        let mut next_re = slope * (sr * d_re - si * d_im) + one;
        let mut next_im = slope * (sr * d_im + si * d_re);
        let mut next_exp = d_exp;
        renormalize(&mut next_re, &mut next_im, &mut next_exp);
        d_re = next_re;
        d_im = next_im;
        d_exp = next_exp;

        if k >= 1 {
            let mut product_re = slope * (sr * l_re - si * l_im);
            let mut product_im = slope * (sr * l_im + si * l_re);
            let mut product_exp = l_exp;
            renormalize(&mut product_re, &mut product_im, &mut product_exp);
            l_re = product_re;
            l_im = product_im;
            l_exp = product_exp;

            // `b += 1/l`. **Guarded on the exponent rather than on `k`**, and
            // the guard is a compare per step rather than a latch, because `l`
            // is not monotone: `|2·z|` is below one wherever the orbit passes
            // near the origin, so a product that has grown can come back. Above
            // 2^64 the term is 5e-20 against a `b` of order ten, which is four
            // orders below where an `f64` sum could notice it.
            if product_exp <= 64 {
                let norm = product_re * product_re + product_im * product_im;
                if norm > 0.0 && norm.is_finite() {
                    let scale = pow2(-product_exp) / norm;
                    b_re += product_re * scale;
                    b_im -= product_im * scale;
                }
            }
        }

        // `z ← z² + c`, the only thing still in fixed point, and the only place
        // this loop spends a multiply worth counting.
        if degree == 2 {
            let x2 = z_re.sqr();
            let y2 = z_im.sqr();
            let xy = z_re.mul(&z_im);
            z_re = x2.sub(&y2).add(c_re);
            z_im = xy.shl1().add(c_im);
        } else {
            let (re, im) = reference::cpow_fx(&z_re, &z_im, degree);
            z_re = re.add(c_re);
            z_im = im.add(c_im);
        }
    }

    // `Δc = z_p / d_p`, taken on the mantissas and scaled once at the end.
    let (zr, zi) = (z_re.to_f64(), z_im.to_f64());
    let norm = d_re * d_re + d_im * d_im;
    let window_log2 = l_exp as f64 + 0.5 * (l_re * l_re + l_im * l_im).log2();
    // `size = 1/|b·l²|`, as a logarithm: `−log₂|b| − 2·log₂|l|`. At degree `D`
    // the power is `D/(D−1)` — see `body_power`.
    let size_log2 = -0.5 * (b_re * b_re + b_im * b_im).log2() - body_power(degree) * window_log2;
    if !(norm > 0.0) || !norm.is_finite() {
        // A derivative of zero is `c` already at the nucleus — or a period that
        // was never a period. Either way there is no step to take.
        return Step {
            c_re: *c_re,
            c_im: *c_im,
            moved: 0.0,
            window_log2,
            size_log2,
            escaped: false,
        };
    }
    let scale = pow2(-d_exp);
    let dc_re = (zr * d_re + zi * d_im) / norm * scale;
    let dc_im = (zi * d_re - zr * d_im) / norm * scale;
    let moved = (dc_re * dc_re + dc_im * dc_im).sqrt();

    // A correction the coordinate cannot hold is a converged one: below the last
    // fraction bit there is nothing left to subtract.
    let (Some(step_re), Some(step_im)) = (Fx::from_f64(dc_re, n), Fx::from_f64(dc_im, n)) else {
        return Step {
            c_re: *c_re,
            c_im: *c_im,
            moved: if moved.is_finite() { moved } else { 0.0 },
            window_log2,
            size_log2,
            escaped: false,
        };
    };
    Step {
        c_re: c_re.sub(&step_re),
        c_im: c_im.sub(&step_im),
        moved,
        window_log2,
        size_log2,
        escaped: false,
    }
}

/// The power of the atom domain `1/|l|` the minibrot's body is: two at degree two,
/// `D/(D−1)` at degree `D`.
///
/// **The renormalisation, which is where the number comes from.** Near a
/// period-`p` nucleus the `p`-th iterate is `z ↦ λ·z^D + β·Δc` to first order,
/// with `λ = l` the multiplier product and `β = b·l` the parameter derivative.
/// Rescaling `z = s·w` with `λ·s^{D−1} = 1` makes it `w ↦ w^D + β·λ^{1/(D−1)}·Δc`,
/// the whole Multibrot set again — so the copy is `1/|β·λ^{1/(D−1)}|` across,
/// which is `1/|b·l^{D/(D−1)}|`. At `D = 2` that is Vepstas' `1/|b·l²|`. What it
/// changes on the page: a view at 1e-n finds its minibrots near 1e-2n at degree
/// two, and near 1e-(D/(D−1))n at degree `D` — 1e-1.5n at three, 1e-1.2n at six.
pub fn body_power(degree: u32) -> f64 {
    if degree == 2 {
        2.0
    } else {
        degree as f64 / (degree as f64 - 1.0)
    }
}

/// Newton from a starting `c`, until it stops moving.
///
/// Stops on three things and says which by what it returns: the correction fell
/// under `tolerance`, the correction stopped shrinking — Newton at its `f64`
/// floor, which is the ordinary end — or [`MAX_STEPS`]. `None` where the orbit
/// escaped, which means the seed's period was not a period of anything here.
pub fn solve(c_re: &Fx, c_im: &Fx, period: u32, degree: u32, tolerance: f64) -> Option<Nucleus> {
    let (mut re, mut im) = (*c_re, *c_im);
    let mut last = f64::INFINITY;
    let (mut size_log2, mut window_log2) = (f64::NAN, f64::NAN);
    for step in 1..=MAX_STEPS {
        let taken = newton_step(&re, &im, period, degree);
        if taken.escaped {
            return None;
        }
        re = taken.c_re;
        im = taken.c_im;
        size_log2 = taken.size_log2;
        window_log2 = taken.window_log2;
        let done = taken.moved <= tolerance || !(taken.moved < last);
        last = taken.moved;
        if done {
            return Some(Nucleus {
                period,
                c_re: re,
                c_im: im,
                size_log2,
                window_log2,
                steps: step,
                residual: last,
            });
        }
    }
    Some(Nucleus {
        period,
        c_re: re,
        c_im: im,
        size_log2,
        window_log2,
        steps: MAX_STEPS,
        residual: last,
    })
}

/// The limb count a nucleus found from a view of this width is solved at.
///
/// **From the atom's scale and not the view's.** A minibrot found at depth `n`
/// sits near depth `2n`, so a solve carried at the view's own limb count would
/// run out of fraction bits exactly where the answer starts: at 1e-22 the view
/// wants four limbs and the nucleus wants five. The grid is the tile's, since
/// the tile is what the answer has to place a pixel of.
pub fn limbs_for_nucleus(width: f64, tile_samples: u32, degree: u32) -> usize {
    let atom = body_scale(width, degree);
    let wanted = if atom > 0.0 && atom.is_finite() {
        reference::limbs_for(atom, tile_samples)
    } else {
        reference::limbs_for(width, tile_samples)
    };
    wanted.max(reference::limbs_for(width, tile_samples) + 1)
}

/// Where the bodies a view of this width finds sit: `width²` at degree two, and
/// `width^{D/(D−1)}` at degree `D`. See [`body_power`].
pub fn body_scale(width: f64, degree: u32) -> f64 {
    if degree == 2 {
        width * width
    } else {
        width.powf(body_power(degree))
    }
}

// ------------------------------------------------------------------- both halves

/// Every nucleus this frame has, largest first, in one call.
///
/// **The page does not call this**, exactly as it does not call
/// [`crate::policy::settle`]: it walks the grid over the pool and drives the
/// solves one step at a time so that a reader can cancel between them. This is
/// the same search in one piece, for the native harness and for anything that has
/// a whole machine.
///
/// `budget` caps the **solves**, which is what the search actually spends, and
/// `want` caps the list that comes back. Two nuclei are the same nucleus when
/// Newton lands them within a period and half an atom of each other, which is
/// the deduplication the periods themselves cannot do.
pub fn search(
    spec: &Spec,
    cols: u32,
    rows: u32,
    budget: usize,
    want: usize,
) -> Result<Vec<Nucleus>, String> {
    let mut distinct = candidates(spec, cols, rows, budget)?;
    distinct.truncate(want);
    Ok(distinct)
}

/// [`search`] as the list offers it: every candidate [`classify`]'d, **the copies
/// largest first, and the bulbs only where the view holds no copy**
/// *(find_minibrots_bulbs_ckpt145; read by the root since dive_primitive_only_ckpt154)*.
///
/// A separate door rather than a change to [`search`], because `search` is also
/// what `builder/deep-gallery-native` descends by, and that tool's picks were made
/// under the old order.
pub fn find(
    spec: &Spec,
    cols: u32,
    rows: u32,
    budget: usize,
    want: usize,
) -> Result<Vec<(Nucleus, Reading)>, String> {
    let read: Vec<(Nucleus, Reading)> = candidates(spec, cols, rows, budget)?
        .into_iter()
        .map(|nucleus| {
            let reading = classify(&nucleus, spec.degree);
            (nucleus, reading)
        })
        .collect();
    Ok(copies_first(read, want))
}

/// The copies in `read`, or its bulbs where it holds none, in the order they came
/// — which is largest first — and at most `want` of them. A reading that is
/// [`Kind::Unresolved`] is neither and is never offered *(dive_primitive_only_ckpt154)*.
pub fn copies_first(read: Vec<(Nucleus, Reading)>, want: usize) -> Vec<(Nucleus, Reading)> {
    let any_copy = read.iter().any(|(_, reading)| reading.kind == Kind::Copy);
    read.into_iter()
        .filter(|(_, reading)| match reading.kind {
            Kind::Copy => any_copy,
            Kind::Bulb { .. } => !any_copy,
            Kind::Unresolved(_) => false,
        })
        .take(want)
        .collect()
}

/// Every distinct nucleus in and around the frame, largest first, before the list
/// is cut: [`search`] without its `want`.
fn candidates(spec: &Spec, cols: u32, rows: u32, budget: usize) -> Result<Vec<Nucleus>, String> {
    let orbit = spec.reference_orbit()?;
    let limbs = limbs_for_nucleus(spec.width, spec.sample_width(), spec.degree);
    let centre_re = Fx::parse(&spec.center_re, limbs)
        .ok_or_else(|| format!("`{}` is not a decimal", spec.center_re))?;
    let centre_im = Fx::parse(&spec.center_im, limbs)
        .ok_or_else(|| format!("`{}` is not a decimal", spec.center_im))?;
    let mut found: Vec<Nucleus> = Vec::new();
    let mut spent = 0usize;
    for seed in seeds(spec, &orbit, cols, rows) {
        if spent >= budget {
            break;
        }
        spent += 1;
        let Some(from_re) = Fx::from_f64(seed.from_re, limbs) else {
            continue;
        };
        let Some(from_im) = Fx::from_f64(seed.from_im, limbs) else {
            continue;
        };
        // The tolerance is the atom's own scale taken eight digits finer, and
        // the atom's scale is the view's width squared until a solve says
        // otherwise. Newton stalls well above it and the stall is the real stop.
        let tolerance = body_scale(spec.width, spec.degree) * 1e-8;
        let Some(nucleus) = solve(
            &centre_re.add(&from_re),
            &centre_im.add(&from_im),
            seed.period,
            spec.degree,
            tolerance,
        ) else {
            continue;
        };
        if !nucleus.size_log2.is_finite() {
            continue;
        }
        found.push(nucleus);
    }

    // **Smallest period first, and then one nucleus per place.** The order matters and is
    // the whole of the harmonics fix: a period-`p` nucleus satisfies `z_kp(c) = 0` for
    // every multiple `k`, so the domain walk reports `2p`, `3p`, `6p` as readily as `p`
    // and Newton takes each of them to the *same point*. Those solves are not wrong, they
    // are the same minibrot named badly — and their size is degenerate, because the
    // product `l = ∏ 2·z_k` runs through `z_p = 0` and collapses. Measured on the audit's
    // anchor before this was here: periods 5,676, 8,514, 17,028, 22,704 and 39,732 — 2×,
    // 3×, 6×, 8× and 14× of 2,838 — all at the anchor's own centre, reporting bodies of
    // 1e11 to 1e44. Keeping the lowest period at each place is what makes the size right.
    found.sort_by_key(|nucleus| nucleus.period);
    let step = spec.width / spec.sample_width().max(1) as f64;
    let mut distinct: Vec<Nucleus> = Vec::new();
    for nucleus in found {
        // **Deduplicated by where Newton lands, and not by what it was asked for.** Two
        // solves nearer than one sample of the frame are one place: no two distinct nuclei
        // a reader could tell apart are that close, and every harmonic is exactly there.
        if distinct.iter().any(|kept| same_place(kept, &nucleus, step)) {
            continue;
        }
        // **A minibrot bigger than the view is not in the view, it contains it.** The
        // tangle frames all sit inside one period-14,190 body of 5.2e-13, which the walk
        // duly finds from 1e-22 and from 1e-54 alike; offering it as somewhere to go would
        // be offering the reader the room they are standing in.
        if !(nucleus.size() > 0.0) || nucleus.size() >= spec.width {
            continue;
        }
        distinct.push(nucleus);
    }

    distinct.sort_by(|a, b| {
        b.size_log2
            .partial_cmp(&a.size_log2)
            .unwrap_or(core::cmp::Ordering::Equal)
    });
    Ok(distinct)
}

// ------------------------------------------------------------------ copy or bulb

/// How nearly a nucleus has to return to the origin before anything is read from it:
/// `|z_p(c)|` under this many of the component's own `z` scale `|s_z|`.
///
/// **What it catches is a solve that never converged** *(dive_primitive_only_ckpt154)*.
/// The page keeps whatever eight Newton steps reached, and at the Mandelbrot home view one
/// of them was a "period-15 copy" at `−0.17771144 + 0.632926556i` whose `|z₁₅|` is 0.375:
/// no period-15 nucleus is anywhere near it, and the Vepstas size read off it (1.7e-2) was
/// a number about nothing. A real nucleus arrives here to eight guard digits below its tile
/// — about 1e-7 of its own size, so `|z_p|` near 1e-7 of `|s_z|` — which this passes with
/// four orders to spare.
pub const NUCLEUS_WITHIN: f64 = 1e-3;

/// A nucleus whose Newton step `z_p/b` is under this many of its own sizes is read where it
/// is; one further off is solved again first. `|z_p|` against `|s_z|`, which is the same
/// ratio, since the size is `|s_z/b|`.
pub const POLISHED: f64 = 1e-12;

/// Newton steps the root solve takes on one cusp before it says it did not converge.
///
/// A copy's cusp is a regular root and converges quadratically in four to eight steps from
/// the renormalized guess. A satellite's root is a singular one — `(f^p)''` vanishes there —
/// and converges linearly, at a ratio of 0.3 to 0.5 a step on every case measured, which is
/// twenty to forty steps to [`ROOT_CONVERGED`]. Forty-eight is that with room.
pub const ROOT_MAX_STEPS: u32 = 48;

/// A root is converged when a step moves `c` by less than this many of the component's
/// sizes. A copy's quadratic steps pass it on the way to the coordinate's floor; a
/// satellite's linear ones reach it, which is what the collapse test needs.
pub const ROOT_CONVERGED: f64 = 1e-10;

/// **A regular root is taken as soon as it shows itself** *(measured on a degree-six copy
/// at 1e-22, whose five cusps each took four passes where three said everything)*: a step
/// under this share of the one before it, which was itself under this share of the size.
/// That is quadratic convergence, which only a regular root has, and there `z` is as good as
/// `c` — within a millionth of the size — so the literal test reads as written. A
/// satellite's steps fall by 0.07 to 0.5 each and never meet it; they run on to
/// [`ROOT_CONVERGED`].
pub const QUADRATIC: f64 = 1e-3;

/// How far from the nucleus, in the component's own sizes, a root may land and still be
/// this component's. Every root measured is within two of them — a copy's cusp at a quarter
/// of a size, a satellite's root at up to 0.9 — so eight is a root somewhere else.
pub const ROOT_NEAR: f64 = 8.0;

/// **The test as the brief states it**: at the root, `|f^q(z) − z|` under this many of
/// `|s_z|`, for a proper divisor `q` of the period. On every copy measured the smallest is
/// 1.5 of `|s_z|` or more, at every cusp of every degree.
pub const COLLIDES_WITHIN: f64 = 1e-3;

/// **The same test, read where it can be read**: the centroid `y` of the cycle point's
/// `f^q`-orbit is `q`-periodic, `|f^q(y) − y|` under this many of `|s_z|`, and its cycle's
/// multiplier `λ_q` satisfies `|λ_q^m − 1|` under this, `m = p/q`. See [`classify`] for why the
/// literal test cannot decide a satellite of large `m` alone. On a satellite converged to
/// [`ROOT_CONVERGED`] both are 1e-12 or less; on a copy the nearest `|λ_q^m − 1|` measured
/// is 0.66.
pub const PARABOLIC_WITHIN: f64 = 1e-6;

/// A copy of the set, a bulb on something bigger, or neither said.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Kind {
    /// A primitive component: at every one of its `d − 1` roots the cycle point still has
    /// the full period.
    Copy,
    /// A satellite: at its root the period-`p` cycle collapses onto one of period
    /// `parent`, which divides `p`, and `m = p/parent`. Period 1 is the main body.
    Bulb { parent: u32, m: u32 },
    /// The root test could not be carried out, so this is **not** a copy. Never a guess.
    Unresolved(Unresolved),
}

/// Why a reading is [`Kind::Unresolved`].
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Unresolved {
    /// `z_p(c)` is nowhere near zero: the solve that produced this point did not converge.
    NotANucleus,
    /// The orbit passes through zero before the period: the point is a nucleus of a lower
    /// period, and the component has no size of its own.
    Harmonic,
    /// The orbit left the bailout disc during the root solve.
    Escaped,
    /// The Newton system had no step to take.
    Singular,
    /// The root Newton found is more than [`ROOT_NEAR`] sizes from the nucleus.
    Wandered,
    /// [`ROOT_MAX_STEPS`] passed without the root converging or a collapse being found.
    Unconverged,
}

impl Unresolved {
    /// The words the page logs and says.
    pub fn reason(self) -> &'static str {
        match self {
            Unresolved::NotANucleus => "not a nucleus: the solve did not converge",
            Unresolved::Harmonic => "a nucleus of a lower period",
            Unresolved::Escaped => "the root solve escaped",
            Unresolved::Singular => "the root solve had no step to take",
            Unresolved::Wandered => "the root solve left the component",
            Unresolved::Unconverged => "the root solve did not converge",
        }
    }
}

/// What [`classify`] read, and what it cost.
#[derive(Clone, Debug)]
pub struct Reading {
    pub kind: Kind,
    /// Roots solved: `d − 1` for a copy, fewer where a satellite's root came first.
    pub cusps: u32,
    /// Orbit steps spent, over every pass of every root and every divisor's cycle.
    pub steps: u64,
}

/// A complex number as a mantissa pair and a power-of-two exponent, for the derivatives of
/// `f^p`, which run far past what an `f64` exponent holds — the module header's argument,
/// made for four products at once rather than two.
#[derive(Clone, Copy, Debug)]
struct Wide {
    re: f64,
    im: f64,
    exp: i32,
}

impl Wide {
    const ZERO: Wide = Wide {
        re: 0.0,
        im: 0.0,
        exp: 0,
    };
    const ONE: Wide = Wide {
        re: 1.0,
        im: 0.0,
        exp: 0,
    };

    fn new(re: f64, im: f64) -> Wide {
        let mut out = Wide { re, im, exp: 0 };
        renormalize(&mut out.re, &mut out.im, &mut out.exp);
        out
    }

    fn zero(&self) -> bool {
        self.re == 0.0 && self.im == 0.0
    }

    #[inline(never)]
    fn mul(self, other: Wide) -> Wide {
        let mut out = Wide {
            re: self.re * other.re - self.im * other.im,
            im: self.re * other.im + self.im * other.re,
            exp: self.exp + other.exp,
        };
        renormalize(&mut out.re, &mut out.im, &mut out.exp);
        out
    }

    #[inline(never)]
    fn scale(self, k: f64) -> Wide {
        let mut out = Wide {
            re: self.re * k,
            im: self.im * k,
            exp: self.exp,
        };
        renormalize(&mut out.re, &mut out.im, &mut out.exp);
        out
    }

    #[inline(never)]
    fn add(self, other: Wide) -> Wide {
        if self.zero() {
            return other;
        }
        if other.zero() {
            return self;
        }
        let (big, small) = if self.exp >= other.exp {
            (self, other)
        } else {
            (other, self)
        };
        let factor = power_of_two(small.exp - big.exp);
        let mut out = Wide {
            re: big.re + small.re * factor,
            im: big.im + small.im * factor,
            exp: big.exp,
        };
        renormalize(&mut out.re, &mut out.im, &mut out.exp);
        out
    }

    fn sub(self, other: Wide) -> Wide {
        self.add(Wide {
            re: -other.re,
            im: -other.im,
            exp: other.exp,
        })
    }

    #[inline(never)]
    fn div(self, other: Wide) -> Option<Wide> {
        let norm = other.re * other.re + other.im * other.im;
        if !(norm > 0.0) || !norm.is_finite() {
            return None;
        }
        let mut out = Wide {
            re: (self.re * other.re + self.im * other.im) / norm,
            im: (self.im * other.re - self.re * other.im) / norm,
            exp: self.exp - other.exp,
        };
        renormalize(&mut out.re, &mut out.im, &mut out.exp);
        Some(out)
    }

    #[inline(never)]
    fn pow(self, k: u32) -> Wide {
        let (mut acc, mut base, mut k) = (Wide::ONE, self, k);
        while k > 0 {
            if k & 1 == 1 {
                acc = acc.mul(base);
            }
            base = base.mul(base);
            k >>= 1;
        }
        acc
    }

    /// `log₂|w|`, and `−∞` at zero.
    fn log2(self) -> f64 {
        if self.zero() {
            return f64::NEG_INFINITY;
        }
        self.exp as f64 + 0.5 * (self.re * self.re + self.im * self.im).log2()
    }

    fn to_f64(self) -> (f64, f64) {
        let scale = power_of_two(self.exp);
        (self.re * scale, self.im * scale)
    }
}

/// `2^k` for any `k`, saturating: [`pow2`] is exact where an `f64` exponent reaches and
/// wraps past the top of it.
fn power_of_two(k: i32) -> f64 {
    if k > 1023 {
        f64::INFINITY
    } else if k < -1100 {
        0.0
    } else {
        pow2(k)
    }
}

fn bailout_sq(degree: u32) -> f64 {
    if degree == 2 { BAILOUT * BAILOUT } else { 64.0 }
}

/// `z ↦ z^d + c` in fixed point, for the root solve and the collapse test.
///
/// **Not inlined, and that is a size decision rather than a speed one.** The release
/// profile is `opt-level = 3` with LTO, and each inlined copy of this — five degrees
/// of `cpow_fx` over `Fx` — is kilobytes of module. [`newton_step`] keeps its own copy,
/// since it is the solve's hot loop.
#[inline(never)]
fn advance(z_re: &Fx, z_im: &Fx, c_re: &Fx, c_im: &Fx, degree: u32) -> (Fx, Fx) {
    if degree == 2 {
        let x2 = z_re.sqr();
        let y2 = z_im.sqr();
        let xy = z_re.mul(z_im);
        (x2.sub(&y2).add(c_re), xy.shl1().add(c_im))
    } else {
        let (re, im) = reference::cpow_fx(z_re, z_im, degree);
        (re.add(c_re), im.add(c_im))
    }
}

/// One pass of `f^p` from `z` at `c`: where it lands, and its four derivatives — `a = ∂/∂z`,
/// the multiplier, `b = ∂/∂c`, `e = ∂²/∂z²` and `g = ∂²/∂z∂c`. `each` sees every iterate
/// `z_k`, `k = 1..=p`. `None` where the orbit escapes.
struct Pass {
    z: (Fx, Fx),
    a: Wide,
    b: Wide,
    e: Wide,
    g: Wide,
}

#[inline(never)]
fn pass(
    z0: &(Fx, Fx),
    c: &(Fx, Fx),
    period: u32,
    degree: u32,
    each: &mut dyn FnMut(u32, &Fx, &Fx),
) -> Option<Pass> {
    let (mut z_re, mut z_im) = *z0;
    let (mut a, mut b, mut e, mut g) = (Wide::ONE, Wide::ZERO, Wide::ZERO, Wide::ZERO);
    let slope = degree as f64;
    let bend = (degree * (degree - 1)) as f64;
    let bailout = bailout_sq(degree);
    for k in 1..=period {
        let (x, y) = (z_re.to_f64(), z_im.to_f64());
        if !(x * x + y * y <= bailout) {
            return None;
        }
        // `d·z^{d−1}` and `d(d−1)·z^{d−2}`, from the `f64` projection of `z` taken wide —
        // the power of a small `z` at degree six is past an `f64`'s exponent.
        let under = Wide::new(x, y).pow(degree - 2);
        let s1 = under.mul(Wide::new(x, y)).scale(slope);
        let s2 = under.scale(bend);
        let e_next = s2.mul(a).mul(a).add(s1.mul(e));
        let g_next = s2.mul(a).mul(b).add(s1.mul(g));
        a = s1.mul(a);
        b = s1.mul(b).add(Wide::ONE);
        e = e_next;
        g = g_next;
        (z_re, z_im) = advance(&z_re, &z_im, &c.0, &c.1, degree);
        each(k, &z_re, &z_im);
    }
    Some(Pass {
        z: (z_re, z_im),
        a,
        b,
        e,
        g,
    })
}

/// At the nucleus: `b = dz_p/dc`, `A = ∏_{k=1}^{p−1} d·z_k^{d−1}` — the copy's multiplier
/// product with the critical point left out, [`Step::window_log2`]'s `l` — and `z_p`.
fn at_nucleus(c: &(Fx, Fx), period: u32, degree: u32) -> Option<(Wide, Wide, Wide)> {
    let n = c.0.n;
    let (mut z_re, mut z_im) = (Fx::zero(n), Fx::zero(n));
    let (mut b, mut product) = (Wide::ZERO, Wide::ONE);
    let slope = degree as f64;
    let bailout = bailout_sq(degree);
    for k in 0..period {
        let (x, y) = (z_re.to_f64(), z_im.to_f64());
        if !(x * x + y * y <= bailout) {
            return None;
        }
        let s1 = Wide::new(x, y).pow(degree - 1).scale(slope);
        b = s1.mul(b).add(Wide::ONE);
        if k >= 1 {
            product = product.mul(s1);
        }
        (z_re, z_im) = advance(&z_re, &z_im, &c.0, &c.1, degree);
    }
    Some((b, product, Wide::new(z_re.to_f64(), z_im.to_f64())))
}

/// The proper divisors of `p`, ascending.
fn divisors(p: u32) -> Vec<u32> {
    let mut low = Vec::new();
    let mut high = Vec::new();
    let mut q = 1;
    while q * q <= p {
        if p % q == 0 {
            low.push(q);
            if q * q != p && q != 1 {
                high.push(p / q);
            }
        }
        q += 1;
    }
    low.retain(|&q| q < p);
    high.reverse();
    low.extend(high);
    low
}

/// The `k`-th roots of unity, `e^{2πij/k}` for `j = 0..k`, `k` from 1 to 5 — written out
/// with square roots rather than formed with `sin` and `cos`, for [`advance`]'s reason.
fn unity(k: u32) -> Vec<(f64, f64)> {
    let half3 = 0.75f64.sqrt();
    let five = 5.0f64.sqrt();
    let (c1, s1) = ((five - 1.0) / 4.0, (10.0 + 2.0 * five).sqrt() / 4.0);
    let (c2, s2) = (-(five + 1.0) / 4.0, (10.0 - 2.0 * five).sqrt() / 4.0);
    match k {
        1 => vec![(1.0, 0.0)],
        2 => vec![(1.0, 0.0), (-1.0, 0.0)],
        3 => vec![(1.0, 0.0), (-0.5, half3), (-0.5, -half3)],
        4 => vec![(1.0, 0.0), (0.0, 1.0), (-1.0, 0.0), (0.0, -1.0)],
        _ => vec![(1.0, 0.0), (c1, s1), (c2, s2), (c2, -s2), (c1, -s1)],
    }
}

/// One `k`-th root of the unit complex number `u`, by Newton from the half-angle — which is
/// the answer at `k = 2`. Which root does not matter: every cusp is tried, so the guesses
/// are multiplied through by all of [`unity`]. `None` where Newton does not arrive.
fn unit_root(u: (f64, f64), k: u32) -> Option<(f64, f64)> {
    if k == 1 {
        return Some(u);
    }
    let mul = |a: (f64, f64), b: (f64, f64)| (a.0 * b.0 - a.1 * b.1, a.0 * b.1 + a.1 * b.0);
    let (hr, hi) = (1.0 + u.0, u.1);
    let norm = (hr * hr + hi * hi).sqrt();
    let mut v = if norm > 1e-3 {
        (hr / norm, hi / norm)
    } else {
        (0.0, 1.0)
    };
    for _ in 0..64 {
        let [pr, pi] = reference::cpow_f64([v.0, v.1], k - 1);
        let full = mul((pr, pi), v);
        let (fr, fi) = (full.0 - u.0, full.1 - u.1);
        if fr * fr + fi * fi < 1e-30 {
            return Some(v);
        }
        let (dr, di) = (k as f64 * pr, k as f64 * pi);
        let dn = dr * dr + di * di;
        if !(dn > 0.0) {
            return None;
        }
        v = (
            v.0 - (fr * dr + fi * di) / dn,
            v.1 - (fi * dr - fr * di) / dn,
        );
    }
    None
}

/// **A copy or a bulb, by the root** *(dive_primitive_only_ckpt154, replacing the chain
/// and bulb-law reading of find_minibrots_bulbs_ckpt145)*.
///
/// A hyperbolic component of period `p` is a satellite if and only if, at its root, the
/// cycle point has a lower period `q < p`, `q | p`; a primitive one's root cycle point still
/// has period `p`, two `p`-cycles colliding at its cusp. At degree `d` a component has `d − 1`
/// points where its multiplier is one — a copy's `d − 1` cusps, or a satellite's root and
/// `d − 2` co-roots that look like cusps — so **every one of them is solved**, and a
/// component is a copy only when none collapses.
///
/// 1. **The nucleus is checked** ([`NUCLEUS_WITHIN`]): a point whose orbit does not come
///    back to the origin is not read at all.
/// 2. **Each root is solved** by Newton on the pair `f^p(z) = z`, `(f^p)′(z) = 1`, in the
///    nucleus's own fixed point, from the cusp the renormalization puts it at: near the
///    nucleus `f^p(z) ≈ A·z^d + b·Δc`, which with `z = s_z·w`, `A·s_z^{d−1} = 1` and
///    `Δc = s_z·C/b` is `w ↦ w^d + C`, whose cusps are `w = d^{−1/(d−1)}ζ`, `C = w(1 − 1/d)`
///    for each `(d−1)`-th root of unity `ζ`.
/// 3. **At the root, the test** — [`COLLIDES_WITHIN`]: `|f^q(z) − z|` against `|s_z|`, for
///    every proper divisor `q`. A copy's root is a regular solution of the pair and
///    converges quadratically, `z` with it, so there the test reads as written.
///
///    ⚠ **A satellite's root is singular, and there the literal test cannot be read.** At the
///    root `f^p(z) − z` has a zero of order `m + 1` rather than two, `(f^p)''` vanishes with
///    it, and Newton converges linearly — `c` at a ratio near 0.35 a step, but `z` only as
///    `|Δc|^{1/m}`. The home view's period-2,508 bulb is a 57-bulb on a period-44 component,
///    and after forty steps with `c` good to 1e-20 of its size its cycle point is still 0.87
///    of `|s_z|` from its `f^132` image. So the collapse is read where it is well
///    conditioned ([`PARABOLIC_WITHIN`]): the `m` points of the cycle's `f^q`-orbit ring the
///    point they collapse onto, their centroid lands on it to far better than any one of
///    them, and that point is `q`-periodic with a multiplier `λ_q` whose `m`-th power is one.
///    It is the same statement — the cycle point has period `q` at the root — read off the
///    point it collapses to rather than off one that has not arrived.
/// 4. **Anything else is [`Kind::Unresolved`]**, which the dive and the list treat as not a
///    copy: a root Newton did not converge on, left the component for, or escaped from.
///
/// The parent is the smallest `q` either test finds, and `m = p/q`.
pub fn classify(nucleus: &Nucleus, degree: u32) -> Reading {
    let period = nucleus.period;
    let n = nucleus.c_re.n;
    let mut reading = Reading {
        kind: Kind::Copy,
        cusps: 0,
        steps: 0,
    };
    let unresolved = |why: Unresolved, reading: Reading| Reading {
        kind: Kind::Unresolved(why),
        ..reading
    };

    // **The nucleus is polished where it needs it.** The page's solve stops at a tolerance
    // set by the view, and at the home view that is 9e-8 absolute — half a percent of the
    // period-2,508 bulb it found — and it hands the answer on at its tile's digits. So where
    // Newton's next step from the point given, `z_p/b`, is over [`POLISHED`] of the size, the
    // point is solved again, which is quadratic and two or three steps; a point that was never
    // a nucleus goes somewhere else, which the two checks below catch. A deep nucleus arrives
    // converged and costs the one pass that says so.
    let given = (nucleus.c_re, nucleus.c_im);
    reading.steps += period as u64;
    let Some(first) = at_nucleus(&given, period, degree) else {
        return unresolved(Unresolved::NotANucleus, reading);
    };
    let settled = |(b, product, z_p): (Wide, Wide, Wide)| {
        z_p.log2() <= POLISHED.log2() - product.log2() / (degree - 1) as f64 && !b.zero()
    };
    let (c0, (b0, product, z_p)) = if settled(first) {
        (given, first)
    } else {
        let tolerance = (nucleus.size() * 1e-14).max(f64::MIN_POSITIVE);
        let polished = solve(&nucleus.c_re, &nucleus.c_im, period, degree, tolerance);
        reading.steps += period as u64 * polished.as_ref().map_or(1, |p| p.steps as u64);
        let Some(polished) = polished else {
            return unresolved(Unresolved::NotANucleus, reading);
        };
        let c0 = (polished.c_re, polished.c_im);
        reading.steps += period as u64;
        let Some(again) = at_nucleus(&c0, period, degree) else {
            return unresolved(Unresolved::NotANucleus, reading);
        };
        (c0, again)
    };
    // `|s_z| = |A|^{−1/(d−1)}`: the copy's own `z` scale, and `|s_z/b|` its size in `c`.
    let root_power = (degree - 1) as f64;
    let scale_log2 = -product.log2() / root_power;
    let size_log2 = scale_log2 - b0.log2();
    if !scale_log2.is_finite() || !size_log2.is_finite() {
        return unresolved(Unresolved::Harmonic, reading);
    }
    let moved = Wide::new(
        c0.0.sub(&nucleus.c_re).to_f64(),
        c0.1.sub(&nucleus.c_im).to_f64(),
    );
    // The polish may move the point by less than a size — the smaller of the one measured
    // here and the one the search reported, because a harmonic's measured size is not one:
    // the home view's "period-15 copy" polishes onto the period-3 nucleus 0.125 away, where
    // `z_3 = 0` collapses the product and the size comes out at 1e68.
    let near_log2 = if nucleus.size_log2.is_finite() {
        size_log2.min(nucleus.size_log2)
    } else {
        size_log2
    };
    if z_p.log2() > NUCLEUS_WITHIN.log2() + scale_log2 || moved.log2() > near_log2 {
        return unresolved(Unresolved::NotANucleus, reading);
    }

    // `s_z`, a `(d−1)`-th root of `1/A`: its modulus by logarithm, its direction by Newton.
    let direction = {
        let (re, im) = (product.re, -product.im);
        let norm = (re * re + im * im).sqrt();
        unit_root((re / norm, im / norm), degree - 1)
    };
    let Some(direction) = direction else {
        return unresolved(Unresolved::Singular, reading);
    };
    let floor = scale_log2.floor();
    let s_z = Wide {
        re: direction.0 * (scale_log2 - floor).exp2(),
        im: direction.1 * (scale_log2 - floor).exp2(),
        exp: floor as i32,
    };
    let cusp = (1.0 / degree as f64).powf(1.0 / root_power);
    let divisors = divisors(period);
    let fixed = |value: f64| Fx::from_f64(value, n);

    let mut worst: Option<Unresolved> = None;
    for zeta in unity(degree - 1) {
        reading.cusps += 1;
        let w = Wide::new(cusp * zeta.0, cusp * zeta.1);
        let z_start = s_z.mul(w).to_f64();
        let Some(c_start) = s_z.mul(w).scale(1.0 - 1.0 / degree as f64).div(b0) else {
            return unresolved(Unresolved::Singular, reading);
        };
        let c_start = c_start.to_f64();
        let (Some(zr), Some(zi), Some(cr), Some(ci)) = (
            fixed(z_start.0),
            fixed(z_start.1),
            fixed(c_start.0),
            fixed(c_start.1),
        ) else {
            return unresolved(Unresolved::Singular, reading);
        };
        let mut z = (zr, zi);
        let mut c = (c0.0.add(&cr), c0.1.add(&ci));

        // Newton on the pair, until `c` stops moving by more than [`ROOT_CONVERGED`] sizes.
        // **Every pass also takes `|f^q(z) − z|` at the point it starts from**, `q` a proper
        // divisor, by a cursor over the divisors — they arrive in order, so it is one compare
        // a step. The pass that stops the solve started within a step of the root, so its
        // distances are the root's, and no pass is spent on the literal test alone.
        let mut near = vec![f64::INFINITY; divisors.len()];
        let mut root = (z, c);
        let mut converged = false;
        let mut failed = None;
        let mut previous = f64::INFINITY;
        let mut regular = false;
        for _ in 0..ROOT_MAX_STEPS {
            reading.steps += period as u64;
            let here = z;
            let mut cursor = 0;
            let read = &mut |k: u32, re: &Fx, im: &Fx| {
                if divisors.get(cursor) == Some(&k) {
                    let dx = re.sub(&here.0).to_f64();
                    let dy = im.sub(&here.1).to_f64();
                    near[cursor] = (dx * dx + dy * dy).sqrt();
                    cursor += 1;
                }
            };
            let Some(taken) = pass(&z, &c, period, degree, read) else {
                failed = Some(Unresolved::Escaped);
                break;
            };
            let f = Wide::new(taken.z.0.sub(&z.0).to_f64(), taken.z.1.sub(&z.1).to_f64());
            let off = taken.a.sub(Wide::ONE);
            let det = off.mul(taken.g).sub(taken.b.mul(taken.e));
            let (Some(dz), Some(dc)) = (
                f.mul(taken.g).sub(taken.b.mul(off)).div(det),
                off.mul(off).sub(f.mul(taken.e)).div(det),
            ) else {
                failed = Some(Unresolved::Singular);
                break;
            };
            let (dz, dc_wide) = (dz.to_f64(), dc);
            let dc = dc_wide.to_f64();
            let (Some(zr), Some(zi), Some(cr), Some(ci)) =
                (fixed(dz.0), fixed(dz.1), fixed(dc.0), fixed(dc.1))
            else {
                failed = Some(Unresolved::Wandered);
                break;
            };
            root = (z, c);
            z = (z.0.sub(&zr), z.1.sub(&zi));
            c = (c.0.sub(&cr), c.1.sub(&ci));
            let step = dc_wide.log2() - size_log2;
            let quadratic = previous <= QUADRATIC.log2() && step <= previous + QUADRATIC.log2();
            // A first step already under [`ROOT_CONVERGED`] — a deep copy, whose cusp the
            // renormalization places to that — takes one pass more, which is what shows it
            // regular: cheaper than the collapse test it saves.
            if quadratic || (step <= ROOT_CONVERGED.log2() && previous.is_finite()) {
                converged = true;
                regular = quadratic;
                break;
            }
            previous = step;
        }
        if let Some(why) = failed {
            worst.get_or_insert(why);
            continue;
        }
        let (z, c) = root;
        let apart = Wide::new(c.0.sub(&c0.0).to_f64(), c.1.sub(&c0.1).to_f64());
        if apart.log2() > ROOT_NEAR.log2() + size_log2 {
            worst.get_or_insert(Unresolved::Wandered);
            continue;
        }

        // **The collapse test's centroids, only where the root is not regular** — a
        // satellite's, or one that did not converge. Where Newton converged quadratically the
        // literal test is exact and answers alone; the sums are one more pass, with every
        // divisor that divides a step visited, and the centroids a cycle of each divisor after
        // it, which at a highly composite period is more than a pass of the period itself.
        // Offsets from `z` are taken exactly and summed in `f64`, which holds them to sixteen
        // digits of the ring's own size.
        let mut sums = vec![(0.0f64, 0.0f64); divisors.len()];
        if !regular {
            reading.steps += period as u64;
            let read = &mut |k: u32, re: &Fx, im: &Fx| {
                if k >= period {
                    return;
                }
                let mut offset = None;
                for (at, &q) in divisors.iter().enumerate() {
                    if k % q != 0 {
                        continue;
                    }
                    let (dx, dy) = *offset
                        .get_or_insert_with(|| (re.sub(&z.0).to_f64(), im.sub(&z.1).to_f64()));
                    sums[at].0 += dx;
                    sums[at].1 += dy;
                }
            };
            if pass(&z, &c, period, degree, read).is_none() {
                worst.get_or_insert(Unresolved::Escaped);
                continue;
            }
        }

        let scale = scale_log2.exp2();
        let collides = divisors
            .iter()
            .zip(&near)
            .find(|&(_, &apart)| apart <= COLLIDES_WITHIN * scale)
            .map(|(&q, _)| q);

        let mut collapses = None;
        for (at, &q) in divisors.iter().enumerate() {
            if regular || collides.is_some_and(|hit| hit <= q) {
                break;
            }
            let m = period / q;
            let (Some(yr), Some(yi)) = (fixed(sums[at].0 / m as f64), fixed(sums[at].1 / m as f64))
            else {
                continue;
            };
            let y = (z.0.add(&yr), z.1.add(&yi));
            reading.steps += q as u64;
            let Some(cycle) = pass(&y, &c, q, degree, &mut |_, _, _| {}) else {
                continue;
            };
            let dx = cycle.z.0.sub(&y.0).to_f64();
            let dy = cycle.z.1.sub(&y.1).to_f64();
            let residual = (dx * dx + dy * dy).sqrt();
            let unity_off = cycle.a.pow(m).sub(Wide::ONE).log2();
            if residual <= PARABOLIC_WITHIN * scale && unity_off <= PARABOLIC_WITHIN.log2() {
                collapses = Some(q);
                break;
            }
        }

        match (collides, collapses) {
            (Some(a), Some(b)) => {
                let parent = a.min(b);
                reading.kind = Kind::Bulb {
                    parent,
                    m: period / parent,
                };
                return reading;
            }
            (Some(parent), None) | (None, Some(parent)) => {
                reading.kind = Kind::Bulb {
                    parent,
                    m: period / parent,
                };
                return reading;
            }
            (None, None) if converged => {}
            (None, None) => {
                worst.get_or_insert(Unresolved::Unconverged);
            }
        }
    }
    match worst {
        Some(why) => unresolved(why, reading),
        None => reading,
    }
}

/// How many times a copy's body is its own size across, at each degree — what a
/// frame of [`TILE_BODIES`] sizes is corrected by where the body cannot be measured.
///
/// Indexed by degree; see [`copy_width`]. **Calibrated, not argued**
/// *(find_minibrots_bulbs_ckpt145)*: `tests/measure.rs`'s `what_a_copy_frame_holds`
/// draws four copies a degree at twelve sizes and eight periods, and this is the
/// median of each one's body share over a quarter:
///
/// | degree | shares at twelve sizes | factor |
/// |--:|---|--:|
/// | 2 | 0.236, 0.242, 0.264, 0.270 | 1.06 |
/// | 3 | 0.225, 0.236, 0.264, 0.320 | 1.06 |
/// | 4 | 0.287, 0.287, 0.287, 0.292 | 1.15 |
/// | 5 | 0.281, 0.298, 0.320, 0.326 | 1.28 |
/// | 6 | 0.298, 0.303, 0.303, 0.303 | 1.21 |
///
/// ⚠ **Degree three does not read small.** The brief that asked for this took a
/// period-770 frame at degree three whose body filled half the height as the size
/// estimate's fault; it was a 5-bulb on a period-154 copy, framed by the bulb's size,
/// and the half was the copy's. At thirty-two periods rather than eight every share
/// above is the same to three places but the anchor's, 0.270 against 0.253, so the
/// rim a preview leaves unresolved is not what these measure.
pub const FALLBACK_BODIES: [f64; 7] = [1.0, 1.0, 1.06, 1.06, 1.15, 1.28, 1.21];

/// How wide to frame a copy of this size at this degree when its body cannot be
/// measured: [`TILE_BODIES`] of its size, times the degree's [`FALLBACK_BODIES`].
pub fn copy_width(size: f64, degree: u32) -> f64 {
    let factor = FALLBACK_BODIES.get(degree as usize).copied().unwrap_or(1.0);
    size * TILE_BODIES * factor
}

/// Whether two solves landed on the same nucleus.
///
/// **The period is deliberately not part of this.** It was, and that was the bug:
/// requiring the periods to match lets every harmonic of a nucleus through as a
/// separate entry, which is what [`search`] documents. A place is a place, and
/// what identifies it is where Newton stopped.
///
/// `step` is one sample of the frame the search was run in. Two centres closer
/// than that are one dot on the reader's screen, and no two nuclei this search
/// could usefully tell apart are nearer than a sample of their own view — while
/// a harmonic is at distance exactly zero.
fn same_place(a: &Nucleus, b: &Nucleus, step: f64) -> bool {
    let apart = a
        .c_re
        .sub(&b.c_re)
        .to_f64()
        .abs()
        .max(a.c_im.sub(&b.c_im).to_f64().abs());
    apart <= step
}

/// Hold a scaled mantissa in `[1, 2^64)` by its larger component, so a product
/// of a hundred thousand factors never drifts toward either end of the exponent
/// range. [`crate::kernel`]'s walk, done in both directions.
fn renormalize(re: &mut f64, im: &mut f64, exponent: &mut i32) {
    const TWO64: f64 = 18446744073709551616.0;
    let mut far = re.abs().max(im.abs());
    if !(far > 0.0) || !far.is_finite() {
        return;
    }
    while far >= TWO64 {
        *re /= TWO64;
        *im /= TWO64;
        *exponent += 64;
        far /= TWO64;
    }
    while far < 1.0 {
        *re *= TWO64;
        *im *= TWO64;
        *exponent -= 64;
        far *= TWO64;
    }
}

/// The `index`-th of `count` cells spread evenly across `span`, at the middle of
/// its share. [`crate::policy`]'s own rule, so the two probes look at the same
/// cells of the same frame.
fn spread(index: u32, count: u32, span: u32) -> u32 {
    let numerator = index as u64 * 2 + 1;
    ((numerator * span as u64) / (count as u64 * 2)).min(span as u64 - 1) as u32
}

#[cfg(test)]
mod tests {
    use super::*;

    /// **A tile is held to the automatic ceiling and an opened copy to the explicit
    /// one** *(cap_split_ckpt145)*, and each binds where its doc says. The case is
    /// the double descent's M₂, period 32,761, which the single million-iteration
    /// ceiling held to 30.5 periods.
    #[test]
    fn a_tile_and_an_opened_copy_have_different_ceilings() {
        let width = 1e-20;
        assert_eq!(open_cap(32_761, width), 1_048_352);
        assert_eq!(tile_cap(32_761, width), 262_088);
        assert_eq!(open_cap(62_500, width), 2_000_000);
        assert_eq!(open_cap(70_000, width), 2_000_000);
        assert_eq!(tile_cap(125_000, width), 1_000_000);
        assert_eq!(tile_cap(130_000, width), 1_000_000);
    }

    /// **The anchor is its own test, and neither number in it came from this
    /// code.** `tests/oracle.rs` and the crate README have said since
    /// `build_perturb_kernel_ckpt135` that this centre is a **period-2838**
    /// nucleus of atom size **6.478e-12**. So a solve started a long way off it
    /// has to arrive at both, and a wrong solver cannot do that by accident.
    #[test]
    fn the_anchor_is_found_from_a_point_that_is_not_it() {
        const RE: &str = "-0.74501772828532335842941892835857434";
        const IM: &str = "0.14993443275456819177805709088257971";
        let limbs = 5;
        let truth_re = Fx::parse(RE, limbs).unwrap();
        let truth_im = Fx::parse(IM, limbs).unwrap();
        // Start a quarter of the atom away, which is far outside the answer and
        // well inside the domain.
        let from_re = truth_re.add(&Fx::from_f64(1.6e-12, limbs).unwrap());
        let from_im = truth_im.sub(&Fx::from_f64(1.1e-12, limbs).unwrap());

        let nucleus = solve(&from_re, &from_im, 2838, 2, 1e-30).expect("the anchor is in the set");
        assert!(nucleus.steps <= 5, "took {} steps", nucleus.steps);
        // Back to the committed centre, far past what a double could have held.
        let apart = nucleus
            .c_re
            .sub(&truth_re)
            .to_f64()
            .abs()
            .max(nucleus.c_im.sub(&truth_im).to_f64().abs());
        assert!(apart < 1e-24, "landed {apart:e} from the anchor");
        // And the size the README records, to the figures it records it to.
        let size = nucleus.size();
        assert!(
            (size / 6.478e-12 - 1.0).abs() < 0.02,
            "atom size came out {size:e}, not 6.478e-12"
        );
    }

    /// **A harmonic lands on the same nucleus and reports a nonsense size**, which
    /// is why [`same_place`] does not look at the period and why [`search`] keeps
    /// the lowest one at each place.
    ///
    /// `z_p(c) = 0` implies `z_kp(c) = 0`, so Newton at twice the anchor's period
    /// converges to the anchor — and the size product runs through `z_p = 0` on
    /// the way, collapsing `l` and handing back a body of astronomical size. The
    /// search saw five of these on the anchor before this was fixed: 2×, 3×, 6×,
    /// 8× and 14× of 2,838, every one of them at the anchor's own centre.
    #[test]
    fn a_harmonic_is_the_same_place_and_its_size_is_not_to_be_believed() {
        const RE: &str = "-0.74501772828532335842941892835857434";
        const IM: &str = "0.14993443275456819177805709088257971";
        let limbs = 5;
        let from_re = Fx::parse(RE, limbs)
            .unwrap()
            .add(&Fx::from_f64(1.6e-12, limbs).unwrap());
        let from_im = Fx::parse(IM, limbs)
            .unwrap()
            .sub(&Fx::from_f64(1.1e-12, limbs).unwrap());

        let true_one = solve(&from_re, &from_im, 2838, 2, 1e-30).unwrap();
        let harmonic = solve(&from_re, &from_im, 5676, 2, 1e-30).unwrap();

        // The same point, to far more digits than a sample of any view of it.
        let apart = harmonic
            .c_re
            .sub(&true_one.c_re)
            .to_f64()
            .abs()
            .max(harmonic.c_im.sub(&true_one.c_im).to_f64().abs());
        assert!(apart < 1e-24, "the harmonic landed {apart:e} away");
        // And so the merge catches it at any threshold a real frame would use.
        assert!(same_place(&true_one, &harmonic, 1e-20));
        // While its size is not a size: the product collapsed through `z_p = 0`.
        assert!(
            harmonic.size() > 1.0,
            "the harmonic's size came out {:e}, which would have been believable",
            harmonic.size()
        );
        assert!((true_one.size() / 6.478e-12 - 1.0).abs() < 0.02);
    }

    /// A period that is not one is refused rather than answered.
    #[test]
    fn a_period_nothing_has_gives_no_nucleus() {
        let re = Fx::parse("0.5", 4).unwrap();
        let im = Fx::parse("0.5", 4).unwrap();
        // `0.5 + 0.5i` is outside the set: the orbit escapes long before 2838.
        assert!(solve(&re, &im, 2838, 2, 1e-30).is_none());
    }

    /// The limb count comes from the atom's scale, which is the view's squared,
    /// and is always at least one more than the view's own.
    #[test]
    fn a_nucleus_is_solved_deeper_than_the_view_it_was_found_in() {
        assert!(limbs_for_nucleus(1e-22, 316, 2) > reference::limbs_for(1e-22, 316));
        assert!(limbs_for_nucleus(2e-11, 316, 2) > reference::limbs_for(2e-11, 316));
        // A degenerate width falls back rather than producing nonsense.
        assert!(limbs_for_nucleus(0.0, 316, 2) >= 3);
    }

    /// **The island pins, one a degree** *(deep_degrees_ckpt140)*: the anchor's case at
    /// degrees three to six, and — as there — neither number came from this code.
    ///
    /// Each body was measured by **area**, with nothing of the size formula in it: a
    /// minibrot is the whole Multibrot set of its degree scaled by its size, so the
    /// interior share of a tile around it, over the whole set's interior share on the
    /// same grid at matched caps (`K` and `K·p`), is the size squared. That measure
    /// reproduces the anchor's 6.478e-12 to 3% and every lower-period island of every
    /// degree it was tried on to half a percent (crate README §10). The formula
    /// `1/|b·l^{d/(d−1)}|` is held to it here at 1%, and the solve to landing on the
    /// nucleus from a quarter of a body away.
    #[test]
    fn each_degrees_island_is_found_and_sized_against_a_measured_body() {
        const PINS: &[(u32, u32, &str, &str, f64)] = &[
            (
                3,
                12,
                "-0.340625023896664202920126013425",
                "1.271229851873307358570127896315",
                3.4792e-12,
            ),
            (
                4,
                13,
                "-1.084215082746655198570484569323",
                "0.290514556108830899669391778917",
                1.4068e-12,
            ),
            (
                5,
                13,
                "-0.887826199618012593110848012131",
                "0.544060594135647520437421634489",
                3.4052e-12,
            ),
            (
                6,
                13,
                "-0.978147600299778310338872737920",
                "0.207911690569371132751240736148",
                5.9105e-12,
            ),
        ];
        let limbs = 5;
        for &(degree, period, re, im, body) in PINS {
            let truth_re = Fx::parse(re, limbs).unwrap();
            let truth_im = Fx::parse(im, limbs).unwrap();
            let from_re = truth_re.add(&Fx::from_f64(0.25 * body, limbs).unwrap());
            let from_im = truth_im.sub(&Fx::from_f64(0.2 * body, limbs).unwrap());
            let nucleus = solve(&from_re, &from_im, period, degree, 1e-40)
                .unwrap_or_else(|| panic!("degree {degree}: no nucleus"));
            assert!(
                nucleus.steps <= 6,
                "degree {degree}: took {} steps",
                nucleus.steps
            );
            let apart = nucleus
                .c_re
                .sub(&truth_re)
                .to_f64()
                .abs()
                .max(nucleus.c_im.sub(&truth_im).to_f64().abs());
            // The stored centre has thirty digits, so that is where it can be held.
            assert!(apart < 1e-29, "degree {degree}: landed {apart:e} away");
            assert!(
                (nucleus.size() / body - 1.0).abs() < 0.01,
                "degree {degree}: body came out {:e}, measured {body:e}",
                nucleus.size()
            );
            // And the body sits at the view's width to the power d/(d−1), not squared:
            // the 1e-11 frame this was found from puts it near 1e-11·(d/(d−1)).
            assert!(body_scale(1e-8, degree) > body_scale(1e-8, 2));
        }
    }

    fn solved(re: &str, im: &str, period: u32, degree: u32) -> Nucleus {
        let limbs = 5;
        let re = Fx::parse(re, limbs).unwrap();
        let im = Fx::parse(im, limbs).unwrap();
        solve(&re, &im, period, degree, 1e-40).unwrap()
    }

    /// A nucleus exactly as the page hands one over: the text its solve was trimmed to, at
    /// the limbs the view asked for, and the size that solve reported — no solve here.
    fn as_sent(re: &str, im: &str, period: u32, size_log2: f64) -> Nucleus {
        let limbs = 4;
        Nucleus {
            period,
            c_re: Fx::parse(re, limbs).unwrap(),
            c_im: Fx::parse(im, limbs).unwrap(),
            size_log2,
            window_log2: f64::NAN,
            steps: 0,
            residual: 0.0,
        }
    }

    fn bulb(parent: u32, m: u32) -> Kind {
        Kind::Bulb { parent, m }
    }

    /// **Known satellites are bulbs, with their parent's period**, at every degree
    /// *(dive_primitive_only_ckpt154)*: the period-2 disc, the period-3 bulbs and a
    /// period-4 doubling on the Mandelbrot set; the 1/2 bulb of the airship; a 7-bulb on
    /// a deep period-179 copy that the list once offered as a minibrot; and on the
    /// Multibrots a 3-bulb at degree three, a period doubling and a 7-bulb on the island at
    /// four, a 5-bulb at five, and a 5- and a 7-bulb at six — the degree-six 5-bulb being
    /// one the chain reading called a copy.
    #[test]
    fn a_satellite_is_a_bulb_at_every_degree() {
        let cases: &[(&str, &str, u32, u32, Kind)] = &[
            ("-0.99", "0.01", 2, 2, bulb(1, 2)),
            ("-0.12", "0.74", 3, 2, bulb(1, 3)),
            ("-0.12", "-0.74", 3, 2, bulb(1, 3)),
            ("-1.31", "0.0", 4, 2, bulb(2, 2)),
            ("-1.7729", "0.0", 6, 2, bulb(3, 2)),
            (
                "-0.057412939209682502",
                "0.669186045946984554",
                1253,
                2,
                bulb(179, 7),
            ),
            (
                "-0.55757284295963191",
                "0.54034681531487766",
                3,
                3,
                bulb(1, 3),
            ),
            (
                "-1.0007955738405138172349582101405",
                "0.2023790506946855657252201146390",
                4,
                4,
                bulb(2, 2),
            ),
            (
                "-1.084215082745679884463",
                "0.290514556109366003724",
                91,
                4,
                bulb(13, 7),
            ),
            (
                "-0.4016770846060389754227023350557",
                "0.7013428578911782803732567788002",
                5,
                5,
                bulb(1, 5),
            ),
            (
                "-0.8203947496214776206185925744307",
                "0.1863155796403726787574539613956",
                5,
                6,
                bulb(1, 5),
            ),
            (
                "0.6356051645274391786478898873009",
                "0.0173282660787604024912101538105",
                7,
                6,
                bulb(1, 7),
            ),
        ];
        for &(re, im, period, degree, kind) in cases {
            let reading = classify(&solved(re, im, period, degree), degree);
            assert_eq!(
                reading.kind, kind,
                "degree {degree}, period {period}: {reading:?}"
            );
        }
    }

    /// **Known copies are copies**: the airship, two antenna copies the bulb law alone
    /// called bulbs, the audit anchor, the two home-view copies *save those minibrots*
    /// keeps, and a small copy on each Multibrot — its island, and one more at degrees four
    /// to six. At degree `d` every one of the `d − 1` cusps is solved.
    #[test]
    fn a_primitive_component_is_a_copy_at_every_degree() {
        let cases: &[(&str, &str, u32, u32)] = &[
            ("-1.754", "0.0", 3, 2),
            ("-1.7684014422285", "0.0026810993276", 69, 2),
            ("-1.7691235660421", "0.0024690072851", 72, 2),
            (
                "-0.74501772828532335842941892835857434",
                "0.14993443275456819177805709088257971",
                2838,
                2,
            ),
            ("0.1286682312611", "0.6540651174688", 28, 2),
            ("-0.70974847572", "0.351857770396", 48, 2),
            (
                "-0.340625023896664202920126013425",
                "1.271229851873307358570127896315",
                12,
                3,
            ),
            (
                "-1.084215082746655198570484569323",
                "0.290514556108830899669391778917",
                13,
                4,
            ),
            (
                "-0.9612479284364900478590736371010",
                "0.2100002511203434421317422440054",
                27,
                4,
            ),
            (
                "-0.887826199618012593110848012131",
                "0.544060594135647520437421634489",
                13,
                5,
            ),
            (
                "-0.8665016601801784813949382881269",
                "0.5853843349243676596506317024710",
                10,
                5,
            ),
            (
                "-0.978147600299778310338872737920",
                "0.207911690569371132751240736148",
                13,
                6,
            ),
            (
                "0.8212500109973763848286332187762",
                "0.2100000033070979765734936627953",
                174,
                6,
            ),
        ];
        for &(re, im, period, degree) in cases {
            let reading = classify(&solved(re, im, period, degree), degree);
            assert_eq!(
                reading.kind,
                Kind::Copy,
                "degree {degree}, period {period}: {reading:?}"
            );
            assert_eq!(
                reading.cusps,
                degree - 1,
                "degree {degree}, period {period}"
            );
        }
    }

    /// **The two home-view cases the report named**, as the page sent them.
    ///
    /// The period-2,508 frame is a satellite: a 57-bulb on a period-44 component. It is
    /// also the case that shows why the literal test is not enough alone: its root is
    /// singular, and the collapse is read off the centroid (see [`classify`]). The page's
    /// solve stopped half a percent of a size off it, which the polish takes up.
    ///
    /// The period-15 frame is not a satellite and not a nucleus at all: `|z₁₅|` is 0.375
    /// at the point the page's solve stopped, and Newton from it lands on the period-3
    /// nucleus 0.125 away. So the reading says so rather than calling it anything —
    /// which is still, as the rule requires, not a copy.
    #[test]
    fn the_home_views_two_are_not_copies() {
        let reading = classify(
            &as_sent(
                "-0.75936056493699",
                "0.07103618418549",
                2508,
                -21.126383684402732,
            ),
            2,
        );
        assert_eq!(reading.kind, bulb(44, 57), "{reading:?}");
        let reading = classify(
            &as_sent("-0.17771144", "0.632926556", 15, -5.8829623565480516),
            2,
        );
        assert_eq!(
            reading.kind,
            Kind::Unresolved(Unresolved::NotANucleus),
            "{reading:?}"
        );
        // And the two it kept that are copies, sent the same way.
        for (re, im, period, size_log2) in [
            ("0.1286682312611", "0.6540651174688", 28, -17.98838171872291),
            ("-0.70974847572", "0.351857770396", 48, -16.708326646864215),
        ] {
            let reading = classify(&as_sent(re, im, period, size_log2), 2);
            assert_eq!(reading.kind, Kind::Copy, "period {period}: {reading:?}");
        }
    }

    /// **The first satellites the root test caught that the chain reading passed as
    /// copies**, from the home view's own search: a period-10 doubling of the period-5
    /// bulb, and a period-28 doubling of a period-14 one.
    #[test]
    fn a_doubling_the_chain_reading_missed_is_a_bulb() {
        let ten = solved("-0.52977976343843097", "0.62048990155820362", 10, 2);
        assert_eq!(classify(&ten, 2).kind, bulb(5, 2));
        let twenty_eight = solved("0.13393526793499174", "0.63847591537678685", 28, 2);
        assert_eq!(classify(&twenty_eight, 2).kind, bulb(14, 2));
    }

    /// The divisors the tests run over, and the roots of unity the cusps are guessed from.
    #[test]
    fn the_divisors_and_the_roots_of_unity() {
        assert_eq!(divisors(1), Vec::<u32>::new());
        assert_eq!(divisors(12), vec![1, 2, 3, 4, 6]);
        assert_eq!(divisors(49), vec![1, 7]);
        assert_eq!(divisors(2508).len(), 23);
        for k in 1..=5 {
            for (re, im) in unity(k) {
                let [pr, pi] = reference::cpow_f64([re, im], k);
                assert!((pr - 1.0).abs() < 1e-14 && pi.abs() < 1e-14, "k = {k}");
            }
        }
    }

    /// The body power is two at degree two and `d/(d−1)` above it.
    #[test]
    fn the_body_is_the_domain_to_the_power_d_over_d_minus_one() {
        assert_eq!(body_power(2), 2.0);
        assert_eq!(body_power(3), 1.5);
        assert!((body_power(6) - 1.2).abs() < 1e-15);
        assert!((body_scale(1e-11, 2) / 1e-22 - 1.0).abs() < 1e-12);
        assert!((body_scale(1e-10, 3) / 1e-15 - 1.0).abs() < 1e-9);
        // The limbs follow the body, so a degree-6 nucleus found in a 1e-40 view is
        // solved at fewer limbs than a degree-2 one: its body is at 1e-48, not 1e-80.
        assert!(limbs_for_nucleus(1e-40, 316, 6) < limbs_for_nucleus(1e-40, 316, 2));
    }

    /// The period-1 nucleus of the whole set is the origin, which is the one
    /// case that can be checked against a number everybody knows.
    #[test]
    fn the_cardioids_own_nucleus_is_the_origin() {
        let from_re = Fx::parse("0.04", 4).unwrap();
        let from_im = Fx::parse("-0.03", 4).unwrap();
        let nucleus = solve(&from_re, &from_im, 1, 2, 1e-30).unwrap();
        assert!(nucleus.c_re.to_f64().abs() < 1e-30);
        assert!(nucleus.c_im.to_f64().abs() < 1e-30);
    }
}
