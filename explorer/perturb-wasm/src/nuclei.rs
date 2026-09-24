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
/// *(find_minibrots_bulbs_ckpt145)*.
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
/// — which is largest first — and at most `want` of them.
pub fn copies_first(read: Vec<(Nucleus, Reading)>, want: usize) -> Vec<(Nucleus, Reading)> {
    let any_copy = read.iter().any(|(_, reading)| reading.kind == Kind::Copy);
    read.into_iter()
        .filter(|(_, reading)| (reading.kind == Kind::Copy) == any_copy)
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

/// How far under [`bulb_scale`] a nucleus may sit and still be read as a bulb of
/// the component above it rather than as a copy of its own.
///
/// **Ported, not chosen** *(find_minibrots_bulbs_ckpt145)*: this is `BULB_SLACK` in
/// the wallpapers repository's `discovery/minibrot.py`, which is where it was
/// measured. The bulbs attached to the main body read 0.98 to 1.40 of the law on
/// every plane and every `m` from 2 to 11; degree two's largest primitive copy, at
/// period 3, reads 0.099 of it. A third is between the two with room either side.
pub const BULB_SLACK: f64 = 3.0;

/// How many of its own sizes a component's nucleus may sit from the point being
/// read and still count as one the point hangs off. `ENCLOSE_K` in the same file.
pub const ENCLOSE_K: f64 = 2.0;

/// How far from a primitive `m`-th root of unity the parent's multiplier may point and
/// the nucleus still be an `m`-bulb on it, as `|λ̂^m − 1|·m/2π` — about
/// `|arg λ/2π − p/m|·m²`. See [`rooted`].
///
/// **The one thing here that is not the wallpapers repository's, and why it had to
/// be added** *(find_minibrots_bulbs_ckpt145)*. That repository's law was measured
/// for `m` up to 11, where a copy reads a tenth of it or less. At the depths Find
/// minibrots works `m` runs to the hundreds, the law falls as `1/m³`, and a third of it
/// no longer separates anything: **the audit anchor** — period 2,838, a copy whose
/// body was measured by area against the whole set — reads as an 86-bulb of a
/// period-33 component under the law alone, and so do a period-69 and a period-72
/// copy on the antenna. So at degree two the law names a candidate parent and this
/// asks whether the nucleus is rooted on it: a `p/m` bulb hangs where the parent's
/// multiplier is `e^{2πip/m}`, with `p` prime to `m`.
///
/// Measured at degree two: every bulb reads **0 to 0.011** — the main body's, the
/// period-2 and period-3 components', and the eight the last prompt's cases and this
/// one's found, `m` from 2 to 13 — and the four copies the law misnamed read **1.31 to
/// 149**. A tenth is a factor of nine and more from both.
///
/// ⚠ **Degree two only.** Above it the cycle search in [`multiplier`] lands on another
/// of the `q`-cycles (it read `|λ|` of 1.8 to 2.0 on three plain bulbs), so neither
/// this nor any reading built on `λ` means anything there, and [`classify`] takes the
/// law alone — which that repository measured on all five planes, and which named every
/// degree-three-to-six bulb measured here correctly. A copy at those degrees with an
/// `m` large enough to fool the law would be offered as a bulb; none was seen.
pub const ROOTED_WITHIN: f64 = 0.1;

/// How far every `λ̂^{m/r}`, for `r` a prime factor of `m`, must stay from one for the
/// root to be *primitive* — `p` prime to `m`. A multiplier near `−1`, the seahorse
/// valley's, is a 2nd root and not an 86th, however close its 86th power is to one.
pub const PRIMITIVE_APART: f64 = 0.1;

/// Newton solves one [`classify`] may spend. `ENCLOSE_MAX_SOLVES` there: the
/// chain it solves is a handful of entries on everything measured.
pub const CLASSIFY_MAX_SOLVES: usize = 12;

/// How big a satellite bulb of index `m` is against the component it hangs off:
/// `2·sin(π/m) / (m²·(d−1))`.
///
/// The wallpapers repository's `bulb_scale`, ported as it stands. It is the
/// smallest such bulb, the one at internal angle `1/m`; the others run up to `m/π`
/// times larger and pass the same test with room to spare. The `1/(d−1)` is what
/// makes degrees three to six read the same as two.
pub fn bulb_scale(m: u32, degree: u32) -> f64 {
    if m < 2 {
        return f64::INFINITY;
    }
    let m = m as f64;
    2.0 * sine(core::f64::consts::PI / m) / (m * m * (degree.max(2) - 1) as f64)
}

/// `sin x` for `0 < x ≤ π/2`, by its series to `x²¹`: within a unit or two of the last
/// place there, which is far past what a law with a slack of three needs. Written out
/// because `f64::sin` brings its whole implementation into the module for this one
/// call.
fn sine(x: f64) -> f64 {
    let x2 = x * x;
    let mut term = x;
    let mut sum = x;
    for k in 1..11 {
        term *= -x2 / ((2 * k) * (2 * k + 1)) as f64;
        sum += term;
    }
    sum
}

/// A copy of the set, or a bulb on something bigger.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Kind {
    Copy,
    /// A satellite bulb of index `m` on the component of period `parent` — period 1
    /// being the main body.
    Bulb {
        parent: u32,
        m: u32,
    },
}

/// What [`classify`] read, and what it read it from.
#[derive(Clone, Debug)]
pub struct Reading {
    pub kind: Kind,
    /// The periods the verdict was taken over, the main body's `1` first: every
    /// component that qualified as one this nucleus hangs off.
    pub chain: Vec<u32>,
    /// Newton solves spent, the root test's cycle search counted as one.
    pub solves: u32,
    /// Where the law named a parent at degree two: how far the parent's multiplier
    /// points from a primitive `m`-th root of unity — see [`rooted`], and infinite where
    /// the root is not primitive. `None` where the law named none, above degree two, or
    /// where the cycle was not found.
    pub rooted: Option<f64>,
}

/// `z ↦ z^d + c` in fixed point, for [`chain`] and [`multiplier`].
///
/// **Not inlined, and that is a size decision rather than a speed one.** The release
/// profile is `opt-level = 3` with LTO, and each inlined copy of this — five degrees
/// of `cpow_fx` over `Fx` — is kilobytes of module. The two readings call it a few
/// thousand times per nucleus, where a call is nothing beside the multiplies it makes.
/// [`newton_step`] keeps its own copy, since it is the solve's hot loop.
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

/// The record minima of `|z_k|` along the critical orbit at `c`, for `2 ≤ k < period`.
///
/// Each `k` at which `|z_k|` sets a new low is a period whose component the point
/// sits near, and they arrive nested, lowest first — the chain the wallpapers
/// repository's `scan` reads, taken here in fixed point because `c` is a nucleus
/// far below what an `f64` can place.
pub fn chain(c_re: &Fx, c_im: &Fx, period: u32, degree: u32) -> Vec<u32> {
    let n = c_re.n;
    let bailout_sq = if degree == 2 { BAILOUT * BAILOUT } else { 64.0 };
    let mut z_re = Fx::zero(n);
    let mut z_im = Fx::zero(n);
    let mut best = f64::INFINITY;
    let mut found = Vec::new();
    for k in 1..period {
        (z_re, z_im) = advance(&z_re, &z_im, c_re, c_im, degree);
        let (zr, zi) = (z_re.to_f64(), z_im.to_f64());
        let norm = zr * zr + zi * zi;
        if !(norm <= bailout_sq) {
            break;
        }
        // `z_1 = c`, and its record is the main body's, which is prepended rather
        // than read.
        if norm < best {
            best = norm;
            if k >= 2 {
                found.push(k);
            }
        }
    }
    found
}

/// **A copy or a bulb** *(find_minibrots_bulbs_ckpt145)*: the wallpapers
/// repository's `generations` reading, ported, over the chain at this nucleus.
///
/// The chain's entries are solved at their own periods from this nucleus, and one
/// counts where Newton lands within [`ENCLOSE_K`] of its own sizes of here and is
/// bigger than this nucleus. The main body is prepended at period 1, size 1. Then
/// the chain is split into generations — a copy and the bulbs hanging off it: an
/// entry joins the generation above when it is a bulb of **any** member of it, a
/// multiple `m` of that member's period no smaller than [`BULB_SLACK`] under
/// [`bulb_scale`]; otherwise it starts one. This nucleus is a bulb when it would
/// join the last generation — **and, at degree two, is rooted on the member it would
/// hang off**, its multiplier within [`ROOTED_WITHIN`] of a primitive `m`-th root of
/// unity — and a copy otherwise. The second half is this module's and not the
/// wallpapers repository's, and [`ROOTED_WITHIN`] says why it had to be added and why
/// only at degree two.
///
/// ⚠ **Only entries whose period divides this one's are solved**, which is the
/// cheap part and the one departure. A bulb's parent always divides it, so no bulb
/// is missed for it. What a non-dividing entry can do in the full reading is open
/// a generation between the parent and here, which turns a would-be bulb into a
/// copy; that takes a component this nucleus is not tuned into lying within two of
/// its own sizes of here, and it did not happen on any case measured.
pub fn classify(nucleus: &Nucleus, degree: u32) -> Reading {
    let period = nucleus.period;
    let mut reading = Reading {
        kind: Kind::Copy,
        chain: vec![1],
        solves: 0,
        rooted: None,
    };
    // `(period, log₂ size, where)`: the main body at the origin, one across.
    let mut held: Vec<(u32, f64, Option<(Fx, Fx)>)> = vec![(1, 0.0, None)];
    let tolerance = (nucleus.size() * 1e-8).max(f64::MIN_POSITIVE);
    for q in chain(&nucleus.c_re, &nucleus.c_im, period, degree) {
        if period % q != 0 || reading.solves as usize >= CLASSIFY_MAX_SOLVES {
            continue;
        }
        reading.solves += 1;
        let Some(found) = solve(&nucleus.c_re, &nucleus.c_im, q, degree, tolerance) else {
            continue;
        };
        if !found.size_log2.is_finite() || found.size_log2 <= nucleus.size_log2 {
            continue;
        }
        // A harmonic of an entry already held lands on it, with a size that is not one.
        let apart_log2 = |re: &Fx, im: &Fx| {
            let dx = found.c_re.sub(re).to_f64();
            let dy = found.c_im.sub(im).to_f64();
            (dx * dx + dy * dy).sqrt().log2()
        };
        if held.iter().any(|(_, size_log2, at)| {
            at.as_ref()
                .is_some_and(|(re, im)| apart_log2(re, im) < size_log2 - 20.0)
        }) {
            continue;
        }
        if apart_log2(&nucleus.c_re, &nucleus.c_im) > ENCLOSE_K.log2() + found.size_log2 {
            continue;
        }
        held.push((q, found.size_log2, Some((found.c_re, found.c_im))));
        reading.chain.push(q);
    }

    // `record` is a bulb of `prior` — the wallpapers repository's `_is_bulb_of`.
    let bulb_of = |record: (u32, f64), prior: (u32, f64)| -> Option<u32> {
        let (below, above) = (record.0, prior.0);
        if above == 0 || below <= above || below % above != 0 {
            return None;
        }
        let m = below / above;
        let floor = prior.1 + (bulb_scale(m, degree) / BULB_SLACK).log2();
        (record.1 >= floor).then_some(m)
    };
    let mut last: Vec<(u32, f64)> = Vec::new();
    for &(q, size_log2, _) in &held {
        let joins = last
            .iter()
            .any(|&prior| bulb_of((q, size_log2), prior).is_some());
        if !joins {
            last.clear();
        }
        last.push((q, size_log2));
    }
    // The nearest parent: the last member of the generation this one would join.
    if let Some((parent, m)) = last
        .iter()
        .rev()
        .find_map(|&prior| bulb_of((period, nucleus.size_log2), prior).map(|m| (prior.0, m)))
    {
        if degree == 2 {
            reading.solves += 1;
            reading.rooted = rooted(nucleus, parent, m, degree);
            if reading.rooted.is_some_and(|off| off <= ROOTED_WITHIN) {
                reading.kind = Kind::Bulb { parent, m };
            }
        } else {
            reading.kind = Kind::Bulb { parent, m };
        }
    }
    reading
}

/// The multiplier of the period-`q` cycle at this nucleus's `c` that continues the
/// parent's superattracting one: Newton on `f^q(z) − z` from `z = c`, which is on that
/// cycle at the parent's own nucleus. `None` where the orbit escapes or Newton breaks.
///
/// ⚠ **Right at degree two only**: above it this start converges to another of the
/// `q`-cycles, which is why [`classify`] asks it nothing there. See [`ROOTED_WITHIN`].
pub fn multiplier(nucleus: &Nucleus, q: u32, degree: u32) -> Option<(f64, f64)> {
    let n = nucleus.c_re.n;
    let (c_re, c_im) = (&nucleus.c_re, &nucleus.c_im);
    let step = |z_re: &Fx, z_im: &Fx| advance(z_re, z_im, c_re, c_im, degree);
    let slope = degree as f64;
    // The cycle point near the critical point: Newton on `f^q(z) − z` from `z = c`.
    let (mut z_re, mut z_im) = (*c_re, *c_im);
    let mut lambda = (0.0f64, 0.0f64, 0i32);
    for _ in 0..24 {
        let (mut w_re, mut w_im) = (z_re, z_im);
        let (mut l_re, mut l_im, mut l_exp) = (1.0f64, 0.0f64, 0i32);
        for _ in 0..q {
            let (zr, zi) = (w_re.to_f64(), w_im.to_f64());
            if !(zr * zr + zi * zi <= 64.0) {
                return None;
            }
            let [sr, si] = if degree == 2 {
                [zr, zi]
            } else {
                reference::cpow_f64([zr, zi], degree - 1)
            };
            let mut next_re = slope * (sr * l_re - si * l_im);
            let mut next_im = slope * (sr * l_im + si * l_re);
            renormalize(&mut next_re, &mut next_im, &mut l_exp);
            l_re = next_re;
            l_im = next_im;
            (w_re, w_im) = step(&w_re, &w_im);
        }
        lambda = (l_re, l_im, l_exp);
        // `g = f^q(z) − z`, `g' = λ − 1`.
        let g_re = w_re.sub(&z_re).to_f64();
        let g_im = w_im.sub(&z_im).to_f64();
        let scale = pow2(l_exp);
        let (d_re, d_im) = (l_re * scale - 1.0, l_im * scale);
        let norm = d_re * d_re + d_im * d_im;
        if !(norm > 0.0) || !norm.is_finite() {
            return None;
        }
        let dz_re = (g_re * d_re + g_im * d_im) / norm;
        let dz_im = (g_im * d_re - g_re * d_im) / norm;
        let (Some(dr), Some(di)) = (Fx::from_f64(dz_re, n), Fx::from_f64(dz_im, n)) else {
            break;
        };
        z_re = z_re.sub(&dr);
        z_im = z_im.sub(&di);
        let moved = (dz_re * dz_re + dz_im * dz_im).sqrt();
        let here = (z_re.to_f64().powi(2) + z_im.to_f64().powi(2))
            .sqrt()
            .max(1e-300);
        if moved <= here * 1e-12 {
            break;
        }
    }
    let scale = pow2(lambda.2);
    Some((lambda.0 * scale, lambda.1 * scale))
}

/// How nearly the parent's multiplier points at a primitive `m`-th root of unity:
/// `|λ̂^m − 1|·m/2π`, which is about `|arg λ/2π − p/m|·m²` — or infinite where some
/// `λ̂^{m/r}`, `r` a prime factor of `m`, is within [`PRIMITIVE_APART`] of one, so that
/// the root is not primitive. See [`ROOTED_WITHIN`].
///
/// A `p/m` satellite bulb hangs from its parent where the parent's cycle multiplier is
/// `e^{2πip/m}`, and its nucleus sits radially off that root, so the multiplier there
/// points within about `1/m²` of a turn of it. A copy the law misnames has no such
/// relation to the component. Powers are taken by squaring and the distance is a
/// chord, so no angle is formed and no trigonometry enters the module. `None` where
/// the cycle is not found.
pub fn rooted(nucleus: &Nucleus, q: u32, m: u32, degree: u32) -> Option<f64> {
    let (l_re, l_im) = multiplier(nucleus, q, degree)?;
    let modulus = (l_re * l_re + l_im * l_im).sqrt();
    if !modulus.is_finite() || modulus == 0.0 {
        return None;
    }
    let unit = (l_re / modulus, l_im / modulus);
    let power = |mut k: u32| {
        let (mut acc, mut base) = ((1.0f64, 0.0f64), unit);
        while k > 0 {
            if k & 1 == 1 {
                acc = (
                    acc.0 * base.0 - acc.1 * base.1,
                    acc.0 * base.1 + acc.1 * base.0,
                );
            }
            base = (base.0 * base.0 - base.1 * base.1, 2.0 * base.0 * base.1);
            k >>= 1;
        }
        acc
    };
    let off = |z: (f64, f64)| ((z.0 - 1.0) * (z.0 - 1.0) + z.1 * z.1).sqrt();
    let (mut rest, mut r) = (m, 2);
    while rest > 1 {
        if rest % r == 0 {
            if off(power(m / r)) < PRIMITIVE_APART {
                return Some(f64::INFINITY);
            }
            while rest % r == 0 {
                rest /= r;
            }
        }
        r += 1;
    }
    Some(off(power(m)) * m as f64 / (2.0 * core::f64::consts::PI))
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

    /// **The bulb law is the wallpapers repository's, to its own numbers.** Its
    /// docstring gives `2·sin(π/m)/(m²(d−1))` and the `1/(d−1)` that makes the degrees
    /// agree; these are that formula at a few points, worked by hand.
    #[test]
    fn the_bulb_law_is_the_ported_one() {
        assert!((bulb_scale(2, 2) - 0.5).abs() < 1e-15);
        assert!((bulb_scale(3, 2) - 2.0 * (3f64).sqrt() / 2.0 / 9.0).abs() < 1e-15);
        assert!((bulb_scale(4, 3) - 2.0 * (0.5f64).sqrt() / 32.0).abs() < 1e-15);
        assert!(bulb_scale(1, 2).is_infinite());
        for m in 2..200 {
            let x = core::f64::consts::PI / m as f64;
            assert!((sine(x) - x.sin()).abs() < 1e-12, "m = {m}");
        }
    }

    fn solved(re: &str, im: &str, period: u32, degree: u32) -> Nucleus {
        let limbs = 5;
        let re = Fx::parse(re, limbs).unwrap();
        let im = Fx::parse(im, limbs).unwrap();
        solve(&re, &im, period, degree, 1e-40).unwrap()
    }

    /// **The main body's bulbs are bulbs and the real axis's copy is a copy** — the
    /// cases the wallpapers repository's constants were set against.
    #[test]
    fn a_bulb_on_the_main_body_is_a_bulb() {
        // The period-2 disc, the 1/3 bulb, and the 1/2 bulb on the period-2 disc.
        let two = solved("-0.99", "0.01", 2, 2);
        assert_eq!(classify(&two, 2).kind, Kind::Bulb { parent: 1, m: 2 });
        let three = solved("-0.12", "0.74", 3, 2);
        assert_eq!(classify(&three, 2).kind, Kind::Bulb { parent: 1, m: 3 });
        let four = solved("-1.31", "0.0", 4, 2);
        assert_eq!(classify(&four, 2).kind, Kind::Bulb { parent: 2, m: 2 });
        // The period-3 copy on the antenna, and its own period doubling.
        let copy = solved("-1.754", "0.0", 3, 2);
        assert_eq!(classify(&copy, 2).kind, Kind::Copy);
        let doubling = solved("-1.7729", "0.0", 6, 2);
        let reading = classify(&doubling, 2);
        assert_eq!(reading.kind, Kind::Bulb { parent: 3, m: 2 }, "{reading:?}");
        // And a deep one: a period-1,253 bulb the list offered as a minibrot from pin
        // 10's view at 1.8e-8, a 7-bulb on a period-179 copy.
        let deep = solved("-0.057412939209682502", "0.669186045946984554", 1253, 2);
        let reading = classify(&deep, 2);
        assert_eq!(
            reading.kind,
            Kind::Bulb { parent: 179, m: 7 },
            "{reading:?}"
        );
        // And at degree four, where the law is taken alone: a 7-bulb on the island.
        let four = solved("-1.084215082745679884463", "0.290514556109366003724", 91, 4);
        let reading = classify(&four, 4);
        assert_eq!(reading.kind, Kind::Bulb { parent: 13, m: 7 }, "{reading:?}");
    }

    /// **Two copies on the antenna that the law alone calls bulbs** — a period-69 at
    /// 0.6 of the law as a 23-bulb of period 3, and a period-72 as a 12-bulb of period
    /// 6 — which the root test refuses.
    #[test]
    fn the_antennas_copies_are_not_its_bulbs() {
        for (re, im, period) in [
            ("-1.7684014422285", "0.0026810993276", 69),
            ("-1.7691235660421", "0.0024690072851", 72),
        ] {
            let copy = solved(re, im, period, 2);
            let reading = classify(&copy, 2);
            assert_eq!(reading.kind, Kind::Copy, "period {period}: {reading:?}");
            assert!(reading.rooted.is_some_and(|off| off > 1.0), "{reading:?}");
        }
    }

    /// **The anchor and every degree's island are copies**, deep, which is the common
    /// case and the one that must not be read as a bulb.
    #[test]
    fn the_anchor_and_the_islands_are_copies() {
        let anchor = solved(
            "-0.74501772828532335842941892835857434",
            "0.14993443275456819177805709088257971",
            2838,
            2,
        );
        let reading = classify(&anchor, 2);
        assert_eq!(reading.kind, Kind::Copy, "{reading:?}");
        // The law alone named a parent, and it was the root test that refused it: this
        // is the case `ROOTED_WITHIN` exists for, so it is pinned by what it read.
        assert!(reading.rooted.is_some_and(|off| off > 1.0), "{reading:?}");
        for &(degree, period, re, im) in &[
            (
                3,
                12,
                "-0.340625023896664202920126013425",
                "1.271229851873307358570127896315",
            ),
            (
                4,
                13,
                "-1.084215082746655198570484569323",
                "0.290514556108830899669391778917",
            ),
            (
                5,
                13,
                "-0.887826199618012593110848012131",
                "0.544060594135647520437421634489",
            ),
            (
                6,
                13,
                "-0.978147600299778310338872737920",
                "0.207911690569371132751240736148",
            ),
        ] {
            let island = solved(re, im, period, degree);
            let reading = classify(&island, degree);
            assert_eq!(reading.kind, Kind::Copy, "degree {degree}: {reading:?}");
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
