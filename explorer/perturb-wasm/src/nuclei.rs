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
use crate::{Spec, reference};

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
/// **Six**, which puts the body at a sixth of the frame: large enough to read as
/// a minibrot rather than a dot, small enough that the filaments around it are in
/// the picture. A body at 1× is a black tile.
pub const TILE_BODIES: f64 = 6.0;

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
/// ⚠ **And this is what makes a deep tile expensive**, which is a finding rather
/// than a tuning: the cost is `samples × 8p`, and `p` at the depths
/// `tests/frames.rs` lives at is of the order of the cap itself. See the crate
/// README.
pub const TILE_PERIODS: u32 = 8;

/// The cap a preview tile of a period-`p` nucleus is drawn at: whichever of the
/// width policy and [`TILE_PERIODS`] periods is larger, under the ceiling.
///
/// The width policy is still the floor because a *shallow* minibrot's period can
/// be small enough that eight of them is less depth than the frame deserves.
pub fn tile_cap(period: u32, width: f64) -> u32 {
    crate::cap::for_width(width)
        .max(period.saturating_mul(TILE_PERIODS))
        .min(crate::cap::CEILING as u32)
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
    for j in row_start..row_end.min(rows) {
        let row = spread(j, rows, sample_height);
        for i in 0..cols {
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
    distinct.truncate(want);
    Ok(distinct)
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
