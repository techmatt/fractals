//! The per-sample loop: `f64` deltas against the reference orbit, with rebasing.
//!
//! This is where the frame's time goes, and everything in it is `f64`. The
//! high-precision arithmetic paid for one orbit ([`crate::reference`]) and is
//! gone by the time this runs; what a sample carries is its *difference* from
//! that orbit, which is small enough that 53 bits describe it to more places than
//! the picture has.
//!
//! ```text
//! δ' = (2·Z[m] + δ)·δ + dc          the delta recurrence
//! z  = Z[m] + δ                     the actual iterate, and what escapes
//! ```
//!
//! **The Julia case is the same loop with `dc` spent once.** Holding `c` fixed
//! and moving `z₀` instead, the delta of a pixel from a reference *point* obeys
//! `δ' = (2·Z[m] + δ)·δ` with no `dc` term at all — the offset that was added
//! every step becomes the delta the loop starts from, and the entry index moves
//! from `Z₀` to whichever point of the orbit the view is anchored at. Nothing
//! else changes, because the stored orbit `Z₀ = 0, Z₁ = c, …` is the critical
//! orbit of `c` and therefore *is* the Julia orbit of `z = 0`, shifted by one
//! from the Julia orbit of `z = c`. Rebasing in particular is untouched and
//! stays exact: see below.
//!
//! **Rebasing is Zhuoran's**, and it is what replaces the whole apparatus of
//! glitch detection and secondary references: when `|z| < |δ|` the delta has
//! grown past the thing it is a perturbation of and has stopped carrying any
//! information, so `δ := z` and `m := 0` restarts it against `Z[0] = 0` — which
//! is a valid reference for every point, being the orbit of the origin. The same
//! move covers the reference running out. The archive's kernel does exactly this
//! and carries no Pauldelbrot test, no secondary reference and no correction
//! pass.
//!
//! **And it stays exact in the Julia case, which is the reason there is no
//! second reference in this file.** `δ := z` is only a rebase at all because
//! `Z₀ = 0` — the delta is the iterate itself, with no subtraction and so no
//! cancellation. Under `z ↦ z² + c` the stored orbit from index 0 is the orbit
//! of the critical point, which is a perfectly good reference for any `z`, so
//! the same two lines say the same true thing. Rebasing onto a reference that
//! started anywhere else would need `δ := z − Z₀` in `f64`, and that subtraction
//! is exactly the precision a deep frame does not have to spare.
//!
//! ## Where a skip table would go
//!
//! Bivariate linear approximation replaces a run of steps of the loop below with
//! one `δ ← A·δ + B·dc`, read out of a table built off the reference orbit. The
//! seam would be the top of [`Kernel::sample`]'s loop, marked there: a lookup on
//! `(m, |δ|²)` that either advances `m` and `n` by a run length or falls through
//! to the single step below it.
//!
//! **It was built, priced and taken back out — see §6 of the crate README**,
//! which is where the measurement lives and is the only thing this should be
//! rebuilt from.

use crate::reference::{BAILOUT, Reference};

/// How far `|dz|²` has to fall before a sample is taken as interior, as a
/// power-of-two exponent. See [`Kernel::interior`] and [`Kernel::floor`].
///
/// `|dz|²` is carried as a mantissa in `[1, 2^64)` and a power-of-two exponent,
/// and the test `|dz|² < 2^floor` is exact — gated by an integer compare that is
/// false on all but the last handful of an interior sample's iterations, so the
/// `f64` compare behind it costs nothing on the frames that never reach it.
///
/// **Swept, not guessed.** See the crate README for the table.
pub const INTERIOR_EXPONENT: i32 = -64;

const TWO64: f64 = 18446744073709551616.0;
const TWO64_INV: f64 = 1.0 / TWO64;

/// What one sample came to.
#[derive(Clone, Copy, Debug)]
pub struct Outcome {
    /// The engine's smooth iteration count, or `NaN` for interior — the engine's
    /// own spelling, and the one [`fractal_engine::field`] uses.
    pub smooth: f64,
    /// Iterations actually taken, which is what a cost study counts.
    pub iterations: u32,
    /// Times the delta was rebased.
    pub rebases: u32,
    /// The interior switch stopped this sample early, rather than the cap.
    pub detected_interior: bool,
    /// `|δ|² == 0` with `dc ≠ 0`: the sample landed exactly on the reference
    /// orbit. The archive's only glitch test, kept as a diagnostic and never as a
    /// branch in the picture — rebasing covers it.
    pub degenerate: bool,
    /// `|dz|²` where the sample stopped, as the switch's own two numbers: a
    /// mantissa in `[1, 2^64)` and a power-of-two exponent.
    ///
    /// **The switch compares these; this hands them out**, which is the whole of
    /// the difference. `detected_interior` says *proven* and nothing about a
    /// sample that is merely on its way there, and the cap policy
    /// ([`crate::policy`]) needs the second thing: a sample the cap gave up on
    /// with `|dz|` collapsing is one the picture already paints correctly, and
    /// one with `|dz|` enormous is exterior the cap stopped short of. Nothing in
    /// the picture reads either number.
    ///
    /// **Meaningless where [`Kernel::interior`] is off**, because the product is
    /// only maintained under the switch: `(1.0, 0)` then, and it says nothing.
    pub dz_mantissa: f64,
    pub dz_exponent: i32,
}

impl Outcome {
    /// `log₂|dz|²` where the sample stopped, saturating at `-inf` on a sample
    /// that passed exactly through the origin.
    ///
    /// Computed here rather than in the loop: the loop returns the pair it
    /// already holds, and a logarithm no picture reads has no business in it.
    pub fn dz_log2(&self) -> f64 {
        self.dz_exponent as f64 + self.dz_mantissa.log2()
    }
}

/// What one sample's orbit says about the nucleus it is nearest.
///
/// **The atom domain, which is the cheap half of finding a minibrot.** The index
/// at which a sample's `|z|` is smallest is the period of the hyperbolic
/// component whose *atom domain* the sample lies in — the neighbourhood over
/// which that component's nucleus dominates the orbit — so a coarse grid of
/// these partitions a view into one region per nucleus, and hands
/// [`crate::nuclei`] a period and a starting point per region. Newton does the
/// expensive half.
///
/// **Rebasing does not disturb it.** A rebase replaces `δ` with the iterate and
/// restarts `m`, which leaves the reconstructed `z = Z[m] + δ` exactly where it
/// was, so the minimum is taken over the same sequence a plain loop would walk.
#[derive(Clone, Copy, Debug)]
pub struct Domain {
    /// The iteration index of the smallest `|z|` the sample reached, counting
    /// from one. Zero only where the sample took no step at all.
    pub period: u32,
    /// `|z|²` there — how near this sample passed to that nucleus, and so which
    /// sample of a region is the best seed for a solve.
    pub minimum: f64,
    /// The sample left the bailout disc before the cap. Its domain still means
    /// something; the sample is simply outside the set.
    pub escaped: bool,
    /// Iterations taken, which is what a cost study counts.
    pub iterations: u32,
}

/// The reference orbit plus the policy a frame reads it under.
pub struct Kernel<'a> {
    pub reference: &'a Reference,
    pub maxiter: u32,
    /// Derivative-based interior detection.
    ///
    /// **Why it exists.** The engine has no interior shortcut of any kind: no
    /// cardioid or bulb test, no cycle detection, so every interior sample pays
    /// the full cap. On the audit's anchor frame that is 38.9% of samples paying
    /// 48,551 iterations each, which is more than half the frame's time.
    ///
    /// **What it tests.** `dz_n = ∏ 2·z_k` is the derivative of the `n`-fold map
    /// along the orbit. Inside a hyperbolic component the orbit falls into an
    /// attracting cycle and that product decays geometrically at the cycle's
    /// multiplier; outside it grows. So a product that has fallen under
    /// [`INTERIOR_EXPONENT`] is taken to be in the basin of an attractor and
    /// never to escape. The derivative
    /// with respect to `z₀` — the usual one — is useless here, because
    /// Mandelbrot fixes `z₀ = 0` and the product is identically zero from its
    /// first factor. **On a Julia frame the two coincide**: `z₀` is the pixel
    /// and is exactly what varies, so `∏ 2·z_k` *is* the derivative with respect
    /// to it, and the same test means the more ordinary thing.
    ///
    /// **Why it is a switch.** It is a heuristic with a threshold, and a
    /// threshold that fires early paints an escaping sample black. So it ships
    /// only against evidence: the crate's README carries the rung-by-rung
    /// comparison of ON against OFF that decided [`crate::SHIPS_INTERIOR`].
    pub interior: bool,
    /// The exponent [`interior`](Self::interior) fires at, defaulting to
    /// [`INTERIOR_EXPONENT`].
    ///
    /// A field rather than a bare constant because it is the one number in this
    /// crate that was chosen by sweeping it, and a sweep needs somewhere to put
    /// the value it is trying. Lower is later and safer; higher is sooner and
    /// eventually wrong. Nothing on the boundary sets it.
    pub floor: i32,
    /// The index of the stored orbit a Julia sample's delta starts against:
    /// one at `z = c`, zero at `z = 0`. Ignored by [`Kernel::sample`], which
    /// always starts at `Z₀` with a delta of zero.
    pub entry: usize,
}

impl<'a> Kernel<'a> {
    pub fn new(reference: &'a Reference, maxiter: u32, interior: bool) -> Self {
        Kernel {
            reference,
            maxiter,
            interior,
            floor: INTERIOR_EXPONENT,
            entry: 0,
        }
    }

    /// The same kernel entered at another point of the orbit — which is how a
    /// Julia view says which of its two anchors it is drawn from.
    pub fn at_entry(mut self, entry: usize) -> Self {
        self.entry = entry;
        self
    }

    /// The same kernel with the interior threshold moved — for the sweep the
    /// README reports, and for nothing else.
    pub fn at_floor(mut self, floor: i32) -> Self {
        self.floor = floor;
        self
    }

    /// One sample, given its offset from the reference point.
    ///
    /// `dc` is the *geometry*: the sample's position in the frame plus the
    /// distance from the view centre to the reference, and never a difference of
    /// two absolute coordinates — which at 1e-28 would be the difference of two
    /// numbers that are the same `f64`.
    pub fn sample(&self, dc_re: f64, dc_im: f64) -> Outcome {
        self.run::<false>(dc_re, dc_im)
    }

    /// One sample of a Julia frame, given its offset from the anchor point.
    ///
    /// The same number [`Kernel::sample`] takes, spent differently: there it is
    /// added at every step, here it is the delta the loop opens with and the
    /// recurrence carries no `dc` at all. The count is the pixel's own — `n`
    /// counts steps and never the reference index, so entering at `Z₁` costs it
    /// nothing.
    pub fn sample_julia(&self, delta_re: f64, delta_im: f64) -> Outcome {
        self.run::<true>(delta_re, delta_im)
    }

    /// One sample with the fork named, so a caller that has already taken it —
    /// a band fill, a sweep — takes it once rather than once a sample.
    ///
    /// ⚠ **`inline(never)`, and it is worth 63%.** `run` is `inline(always)`, so
    /// without this the whole per-sample loop lands inside
    /// [`crate::compute_rows`]'s row-and-column loop — and measured on the anchor
    /// at 96×54 that took the plain path from **4.79 ns a sample-iteration to
    /// 7.80**, with the bytes unchanged. Whatever the register allocator is doing
    /// with the band's own loop, it is not doing it while this one is in the same
    /// body. [`Kernel::sample`] gets the same treatment for free by not being
    /// `inline(always)`, which is what the band fill used to call and is why the
    /// price was never visible before.
    #[inline(never)]
    pub fn sample_with<const JULIA: bool>(&self, a_re: f64, a_im: f64) -> Outcome {
        self.run::<JULIA>(a_re, a_im)
    }

    /// The loop, once, for both.
    ///
    /// **`JULIA` is a const parameter and not a field, and the reason is
    /// arithmetic rather than taste**: `x + 0.0` is not `x` when `x` is `-0.0`,
    /// so a `dc` of zero carried as data would cost the Julia path two additions
    /// an iteration that no optimizer is allowed to remove. Monomorphized, each
    /// loop is exactly the loop it would have been written as by hand, and the
    /// Mandelbrot one is byte for byte the loop that was here before.
    #[inline(always)]
    fn run<const JULIA: bool>(&self, a_re: f64, a_im: f64) -> Outcome {
        // Everything the loop reads more than once, read once. A field access
        // through `&Reference` is a load the optimizer cannot always hoist past
        // the indexing below it, and this loop runs tens of thousands of times
        // per sample and millions of times per frame.
        let points = &self.reference.points[..];
        let periodic = self.reference.periodic;
        let track_interior = self.interior;
        let floor = self.floor;
        let maxiter = self.maxiter;
        let length = points.len();
        let last = length - 1;
        let bailout_sq = BAILOUT * BAILOUT;
        let offset_is_zero = a_re == 0.0 && a_im == 0.0;
        // Spent every step, or spent once — never both.
        let (dc_re, dc_im) = if JULIA { (0.0, 0.0) } else { (a_re, a_im) };

        let mut delta_re = if JULIA { a_re } else { 0.0f64 };
        let mut delta_im = if JULIA { a_im } else { 0.0f64 };
        // Where the delta is measured from. Clamped, because a reference that
        // escaped in one step has no `Z₁` to enter at.
        let start = if JULIA { self.entry.min(last) } else { 0 };
        // `Z[m]`, carried across the step rather than loaded twice.
        let mut zr = points[start][0];
        let mut zi = points[start][1];
        let mut m = start;
        let mut n = 0u32;
        let mut rebases = 0u32;
        let mut degenerate = false;

        // |dz|², as a mantissa in [1, 2^64) and a power-of-two exponent. Only
        // touched under the switch.
        let mut derivative = 1.0f64;
        let mut exponent = 0i32;

        loop {
            // ---- the BLA seam: a skip table would be consulted here, and one
            // was. It bought 1.0× to 2.6× on a frame with a picture in it and
            // moved that picture at every tolerance it fires at — §6 of the
            // crate README, which is the only thing to rebuild this from. ----
            let ar = zr + zr + delta_re;
            let ai = zi + zi + delta_im;
            let mut next_re = ar * delta_re - ai * delta_im;
            let mut next_im = ar * delta_im + ai * delta_re;
            if !JULIA {
                next_re += dc_re;
                next_im += dc_im;
            }
            delta_re = next_re;
            delta_im = next_im;

            m += 1;
            n += 1;
            if periodic && m >= length {
                // `Z[period] = 0 = Z[0]`, so the index wraps and the delta is
                // untouched. This is the whole payoff of naming a period.
                m = 0;
            }

            let point = points[m];
            zr = point[0];
            zi = point[1];
            let z_re = zr + delta_re;
            let z_im = zi + delta_im;
            let z_norm_sq = z_re * z_re + z_im * z_im;

            if z_norm_sq > bailout_sq {
                return Outcome {
                    smooth: smooth_count(n, z_norm_sq),
                    iterations: n,
                    rebases,
                    detected_interior: false,
                    degenerate,
                    dz_mantissa: derivative,
                    dz_exponent: exponent,
                };
            }

            if track_interior {
                derivative *= 4.0 * z_norm_sq;
                if derivative >= TWO64 {
                    derivative *= TWO64_INV;
                    exponent += 64;
                } else {
                    while derivative < 1.0 {
                        if derivative == 0.0 {
                            // `z` passed exactly through the origin: this is the
                            // nucleus itself, and it is interior.
                            return interior_outcome(n, rebases, true, degenerate, 0.0, exponent);
                        }
                        derivative *= TWO64;
                        exponent -= 64;
                    }
                }
                // `derivative · 2^exponent < 2^floor`, exactly. The integer
                // compare is the gate and is false on all but the last handful
                // of iterations of an interior sample, so the `f64` compare
                // behind it costs nothing on the frames that do not use it.
                if exponent <= floor + 64 && derivative < pow2_at_most(floor - exponent) {
                    return interior_outcome(n, rebases, true, degenerate, derivative, exponent);
                }
            }

            if n >= maxiter {
                return interior_outcome(n, rebases, false, degenerate, derivative, exponent);
            }

            let delta_norm_sq = delta_re * delta_re + delta_im * delta_im;
            if delta_norm_sq == 0.0 && !offset_is_zero {
                degenerate = true;
            }
            // Rebase: the delta has outgrown the iterate it perturbs, or the
            // reference has no step `m+1` to offer.
            if z_norm_sq < delta_norm_sq || (!periodic && m >= last) {
                delta_re = z_re;
                delta_im = z_im;
                zr = points[0][0];
                zi = points[0][1];
                m = 0;
                rebases += 1;
            }
        }
    }

    /// The atom domain one sample falls in: where its `|z|` was smallest, and
    /// when.
    ///
    /// **A second loop rather than a flag on the first, and that is deliberate.**
    /// Everything above this line is the picture, and the picture's loop has been
    /// measured into its present shape twice — the orbit's layout is worth 2.5×
    /// and [`Kernel::sample_with`]'s `inline(never)` a further 63%, neither of
    /// which anybody predicted. A third const parameter would be free *if* the
    /// optimizer agreed, and this file's history is that it does not reliably
    /// agree. The duplication is forty lines and it buys the guarantee that
    /// nothing a nucleus search wants can slow a frame down.
    ///
    /// **No interior switch here, on purpose.** The switch stops a sample as soon
    /// as it is *proven* bounded, which is a place the running minimum may not
    /// have reached yet, and a domain read off a truncated orbit would name the
    /// wrong period. So this walks to the escape or to the cap. It is affordable
    /// because it is asked of a few thousand cells rather than of a frame —
    /// `crate::nuclei` and the page both probe on the cap policy's own grid.
    #[inline(never)]
    pub fn domain_with<const JULIA: bool>(&self, a_re: f64, a_im: f64) -> Domain {
        let points = &self.reference.points[..];
        let periodic = self.reference.periodic;
        let maxiter = self.maxiter;
        let length = points.len();
        let last = length - 1;
        let bailout_sq = BAILOUT * BAILOUT;
        let (dc_re, dc_im) = if JULIA { (0.0, 0.0) } else { (a_re, a_im) };

        let mut delta_re = if JULIA { a_re } else { 0.0f64 };
        let mut delta_im = if JULIA { a_im } else { 0.0f64 };
        let start = if JULIA { self.entry.min(last) } else { 0 };
        let mut zr = points[start][0];
        let mut zi = points[start][1];
        let mut m = start;
        let mut n = 0u32;

        let mut minimum = f64::INFINITY;
        let mut period = 0u32;

        loop {
            let ar = zr + zr + delta_re;
            let ai = zi + zi + delta_im;
            let mut next_re = ar * delta_re - ai * delta_im;
            let mut next_im = ar * delta_im + ai * delta_re;
            if !JULIA {
                next_re += dc_re;
                next_im += dc_im;
            }
            delta_re = next_re;
            delta_im = next_im;

            m += 1;
            n += 1;
            if periodic && m >= length {
                m = 0;
            }

            let point = points[m];
            zr = point[0];
            zi = point[1];
            let z_re = zr + delta_re;
            let z_im = zi + delta_im;
            let z_norm_sq = z_re * z_re + z_im * z_im;

            // The whole of what this loop is for. Strictly less, so the *first*
            // index of a repeated minimum wins — a periodic orbit comes back to
            // the same place and the period is the first return, not the last.
            if z_norm_sq < minimum {
                minimum = z_norm_sq;
                period = n;
            }

            if z_norm_sq > bailout_sq {
                return Domain {
                    period,
                    minimum,
                    escaped: true,
                    iterations: n,
                };
            }
            if n >= maxiter {
                return Domain {
                    period,
                    minimum,
                    escaped: false,
                    iterations: n,
                };
            }

            let delta_norm_sq = delta_re * delta_re + delta_im * delta_im;
            if z_norm_sq < delta_norm_sq || (!periodic && m >= last) {
                delta_re = z_re;
                delta_im = z_im;
                zr = points[0][0];
                zi = points[0][1];
                m = 0;
            }
        }
    }
}

/// `2^k`, saturating at infinity above the exponent range and at zero below it.
/// Neither end is reachable from the one call site; the saturation is there so
/// the function is total.
#[inline(always)]
fn pow2_at_most(k: i32) -> f64 {
    if k > 1023 {
        f64::INFINITY
    } else if k >= -1022 {
        f64::from_bits(((k + 1023) as u64) << 52)
    } else {
        0.0
    }
}

fn interior_outcome(
    n: u32,
    rebases: u32,
    detected: bool,
    degenerate: bool,
    dz_mantissa: f64,
    dz_exponent: i32,
) -> Outcome {
    Outcome {
        smooth: f64::NAN,
        iterations: n,
        rebases,
        detected_interior: detected,
        degenerate,
        dz_mantissa,
        dz_exponent,
    }
}

/// The engine's smooth count, restated.
///
/// `nu = (n + 1) − log_d( ln|z| / ln B )`, with `B = 65536` and `d = 2`. This is
/// `fractal_engine::iterate::smooth_count` written out rather than called: the
/// engine's copy is private, and the audit's ruling was to re-state it here with
/// a test pinning it to the engine's own output rather than open a function next
/// door for it. `smooth-cases.json` is that pin — 400 samples of the engine's
/// `smooth` field, committed, and `cargo test` holds this to them bit for bit.
///
/// The fallback matters and is the engine's: an overshoot that is not finite and
/// positive gives back the integer count rather than a `NaN`, because `NaN` in
/// this field means *interior* and a poisoned exterior sample would paint black.
pub fn smooth_count(n: u32, magnitude_sq: f64) -> f64 {
    let log_z = 0.5 * magnitude_sq.ln();
    let overshoot = log_z / BAILOUT.ln();
    if overshoot.is_finite() && overshoot > 0.0 {
        (n + 1) as f64 - overshoot.ln() / core::f64::consts::LN_2
    } else {
        (n + 1) as f64
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::fx::Fx;
    use crate::reference;

    /// Iterate a point the plain way, in `f64`, exactly as the engine does.
    fn plain(c_re: f64, c_im: f64, maxiter: u32) -> f64 {
        let (mut x, mut y) = (0.0f64, 0.0f64);
        let bailout_sq = BAILOUT * BAILOUT;
        for n in 1..=maxiter {
            let next = x * x - y * y + c_re;
            y = 2.0 * x * y + c_im;
            x = next;
            let magnitude_sq = x * x + y * y;
            if magnitude_sq > bailout_sq {
                return smooth_count(n, magnitude_sq);
            }
        }
        f64::NAN
    }

    fn kernel_at(
        centre: &str,
        centre_im: &str,
        limbs: usize,
        maxiter: u32,
    ) -> reference::Reference {
        let c_re = Fx::parse(centre, limbs).unwrap();
        let c_im = Fx::parse(centre_im, limbs).unwrap();
        reference::orbit(&c_re, &c_im, maxiter, None)
    }

    /// Where `f64` is still right, the two must agree — and on a shallow view
    /// they are bit-equal far more often than not.
    ///
    /// Not held to its worst sample: `tests/probe.rs` takes the same grid three
    /// ways, against a 320-bit oracle as well, and the worst disagreement there
    /// is a point within an ulp of the boundary where the plain loop is the one
    /// that is wrong. What a shallow frame can honestly claim is the share.
    #[test]
    fn a_shallow_frame_matches_the_plain_f64_loop() {
        let maxiter = 4000;
        let orbit = kernel_at("-0.5", "0.0", 3, maxiter);
        let kernel = Kernel::new(&orbit, maxiter, false);
        let (mut compared, mut equal, mut close) = (0, 0, 0);
        for row in 0..41 {
            for col in 0..41 {
                let dc_re = (col as f64 - 20.0) * 0.06;
                let dc_im = (row as f64 - 20.0) * 0.06;
                let ours = kernel.sample(dc_re, dc_im).smooth;
                let theirs = plain(-0.5 + dc_re, dc_im, maxiter);
                assert_eq!(
                    ours.is_nan(),
                    theirs.is_nan(),
                    "interior disagreed at ({dc_re}, {dc_im})"
                );
                if ours.is_nan() {
                    continue;
                }
                compared += 1;
                if ours == theirs {
                    equal += 1;
                }
                if (ours - theirs).abs() < 1e-6 {
                    close += 1;
                }
            }
        }
        assert!(compared > 500, "only {compared} samples escaped");
        assert!(
            close as f64 / compared as f64 > 0.98,
            "only {close} of {compared} were within 1e-6"
        );
        assert!(
            equal as f64 / compared as f64 > 0.50,
            "only {equal} of {compared} were bit-equal"
        );
    }

    #[test]
    fn the_origin_is_a_valid_reference_for_anything() {
        let maxiter = 2000;
        let zero = Fx::zero(3);
        let orbit = reference::orbit(&zero, &zero, maxiter, None);
        let kernel = Kernel::new(&orbit, maxiter, false);
        // Far outside: escapes at once. Deep inside: never.
        assert!(kernel.sample(2.0, 2.0).smooth < 8.0);
        assert!(kernel.sample(-0.2, 0.0).smooth.is_nan());
    }

    #[test]
    fn rebasing_happens_and_the_answer_survives_it() {
        let maxiter = 4000;
        let orbit = kernel_at("-0.5", "0.0", 3, maxiter);
        let kernel = Kernel::new(&orbit, maxiter, false);
        // A point far from the reference rebases early and often.
        let outcome = kernel.sample(1.4, 0.9);
        assert!(outcome.rebases > 0);
        let theirs = plain(0.9, 0.9, maxiter);
        assert!((outcome.smooth - theirs).abs() < 1e-9);
    }

    #[test]
    fn a_periodic_reference_draws_what_the_full_one_draws() {
        let maxiter = 20_000;
        let c_re = Fx::parse("-1.7548776662466927600495", 4).unwrap();
        let c_im = Fx::zero(4);
        let full = reference::orbit(&c_re, &c_im, maxiter, None);
        let wrapped = reference::orbit(&c_re, &c_im, maxiter, Some(3));
        assert!(wrapped.periodic && wrapped.len() == 3);
        let a = Kernel::new(&full, maxiter, false);
        let b = Kernel::new(&wrapped, maxiter, false);
        let mut compared = 0;
        for row in -5..=5 {
            for col in -5..=5 {
                let dc_re = col as f64 * 8e-3;
                let dc_im = row as f64 * 8e-3;
                let one = a.sample(dc_re, dc_im).smooth;
                let two = b.sample(dc_re, dc_im).smooth;
                assert_eq!(one.is_nan(), two.is_nan());
                if !one.is_nan() {
                    assert!((one - two).abs() < 1e-6, "{one} vs {two}");
                    compared += 1;
                }
            }
        }
        assert!(compared > 40, "only {compared} escaped");
    }

    #[test]
    fn the_interior_switch_stops_early_and_never_moves_an_escaping_sample() {
        let maxiter = 5000;
        let orbit = kernel_at("-0.5", "0.0", 3, maxiter);
        let on = Kernel::new(&orbit, maxiter, true);
        let off = Kernel::new(&orbit, maxiter, false);
        let mut saved = 0u64;
        let mut inside = 0;
        for row in 0..41 {
            for col in 0..41 {
                let dc_re = (col as f64 - 20.0) * 0.03;
                let dc_im = (row as f64 - 20.0) * 0.03;
                let a = on.sample(dc_re, dc_im);
                let b = off.sample(dc_re, dc_im);
                if b.smooth.is_nan() {
                    assert!(a.smooth.is_nan(), "ON escaped where OFF did not");
                    saved += (b.iterations - a.iterations) as u64;
                    inside += 1;
                } else {
                    assert!(
                        !a.smooth.is_nan(),
                        "ON painted ({dc_re}, {dc_im}) interior; OFF escaped at {}",
                        b.smooth
                    );
                    assert_eq!(a.smooth, b.smooth);
                }
            }
        }
        assert!(inside > 100, "only {inside} interior samples");
        assert!(saved > 0, "the switch saved nothing");
    }

    #[test]
    fn the_smooth_count_is_continuous_across_an_escape_step() {
        // Just past the bailout and far past it differ by about one step.
        let near = smooth_count(10, BAILOUT * BAILOUT * 1.000001);
        let far = smooth_count(10, BAILOUT * BAILOUT * BAILOUT * BAILOUT);
        assert!((near - 11.0).abs() < 1e-5);
        assert!((far - 10.0).abs() < 1e-9);
    }

    #[test]
    fn a_degenerate_overshoot_falls_back_to_the_integer_count() {
        assert_eq!(smooth_count(7, f64::INFINITY), 8.0);
        assert_eq!(smooth_count(7, 0.0), 8.0);
    }

    // ------------------------------------------------------------------ julia

    /// Iterate a Julia sample the plain way: `c` held, `z₀` the pixel.
    fn plain_julia(z_re: f64, z_im: f64, c_re: f64, c_im: f64, maxiter: u32) -> f64 {
        let (mut x, mut y) = (z_re, z_im);
        let bailout_sq = BAILOUT * BAILOUT;
        for n in 1..=maxiter {
            let next = x * x - y * y + c_re;
            y = 2.0 * x * y + c_im;
            x = next;
            let magnitude_sq = x * x + y * y;
            if magnitude_sq > bailout_sq {
                return smooth_count(n, magnitude_sq);
            }
        }
        f64::NAN
    }

    /// The Douady rabbit: `c` in the period-3 bulb, so it is **inside** the
    /// Mandelbrot set. That matters twice over — the critical orbit is bounded,
    /// so the reference runs to the cap rather than escaping in a few steps, and
    /// the Julia set is filled, so a frame of it has interior as well as
    /// boundary. A `c` outside the set gives a dust with neither.
    const JULIA_C: (&str, &str, f64, f64) = ("-0.123", "0.745", -0.123, 0.745);

    /// What a grid of samples came to against something to compare it with.
    ///
    /// **The share and the median, never the worst sample**, which is the
    /// ruling `tests/oracle.rs` already makes for the Mandelbrot ladders and it
    /// holds here for the same reason: on a boundary where escape counts run to
    /// the hundreds, the last bit of the arithmetic decides them, and the plain
    /// `f64` loop is as often the wrong one as this kernel is. A worst-case
    /// assertion would be asserting that chaos is not chaotic. A *systematic*
    /// error — the wrong recurrence, the wrong entry, a missing term — moves the
    /// median, which is what these are held to.
    #[derive(Debug)]
    struct Agreement {
        compared: usize,
        equal: usize,
        within: usize,
        median_relative: f64,
    }

    fn agreement(pairs: &[(f64, f64)]) -> Agreement {
        let mut relative: Vec<f64> = Vec::new();
        let (mut equal, mut within) = (0, 0);
        for &(ours, theirs) in pairs {
            if ours.to_bits() == theirs.to_bits() {
                equal += 1;
            }
            let error = (ours - theirs).abs();
            if error < 1e-6 {
                within += 1;
            }
            relative.push(error / theirs.abs().max(1.0));
        }
        relative.sort_by(|a, b| a.partial_cmp(b).unwrap());
        Agreement {
            compared: pairs.len(),
            equal,
            within,
            median_relative: relative.get(relative.len() / 2).copied().unwrap_or(0.0),
        }
    }

    /// Where `f64` is still right, the Julia kernel must agree with the plain
    /// loop — the same claim the Mandelbrot side makes, and the one that says
    /// the delta recurrence without its `dc` is the right recurrence.
    #[test]
    fn a_shallow_julia_frame_matches_the_plain_f64_loop() {
        let maxiter = 4000;
        let (c_text, c_im_text, c_re, c_im) = JULIA_C;
        let orbit = kernel_at(c_text, c_im_text, 3, maxiter);
        // Entered at `Z₁ = c`: the frame is the neighbourhood of `z = c`.
        let kernel = Kernel::new(&orbit, maxiter, false).at_entry(1);
        let mut pairs = Vec::new();
        for row in 0..41 {
            for col in 0..41 {
                let delta_re = (col as f64 - 20.0) * 0.06;
                let delta_im = (row as f64 - 20.0) * 0.06;
                let ours = kernel.sample_julia(delta_re, delta_im).smooth;
                let theirs = plain_julia(c_re + delta_re, c_im + delta_im, c_re, c_im, maxiter);
                assert_eq!(
                    ours.is_nan(),
                    theirs.is_nan(),
                    "({delta_re}, {delta_im}): {ours} against {theirs}"
                );
                if !theirs.is_nan() {
                    pairs.push((ours, theirs));
                }
            }
        }
        let how = agreement(&pairs);
        println!("shallow julia against the plain loop: {how:?}");
        assert!(how.compared > 800, "only {} escaping samples", how.compared);
        // The interior masks agreed exactly, above, sample for sample.
        assert!(
            how.median_relative < 1e-12,
            "median relative error {:e}",
            how.median_relative
        );
        // About half are bit-equal — 840 of 1,681 as this was written, which is
        // as near half as makes no difference and is not a number to assert to
        // the sample. The bar is that a large share of them agree to the last
        // bit, which a kernel carrying the wrong recurrence could not manage at
        // all.
        assert!(
            how.equal * 5 > how.compared * 2,
            "only {} of {} were bit-equal",
            how.equal,
            how.compared
        );
        assert!(
            how.within * 100 >= how.compared * 95,
            "only {} of {} were within 1e-6",
            how.within,
            how.compared
        );
    }

    /// **The two anchors are two spellings of one picture.** Both are points of
    /// the stored orbit, so a frame drawn from either is the same mathematics
    /// with a different `f64` starting delta — and where both can resolve the
    /// frame, they have to agree.
    #[test]
    fn the_two_anchors_draw_the_same_julia_picture() {
        let maxiter = 2000;
        let (c_text, c_im_text, c_re, c_im) = JULIA_C;
        let orbit = kernel_at(c_text, c_im_text, 3, maxiter);
        let from_c = Kernel::new(&orbit, maxiter, false).at_entry(1);
        let from_zero = Kernel::new(&orbit, maxiter, false).at_entry(0);
        let mut pairs = Vec::new();
        for row in 0..21 {
            for col in 0..21 {
                // One frame, named twice: as an offset from `c` and as an offset
                // from the origin, which differ by `c` itself.
                let z_re = c_re + (col as f64 - 10.0) * 0.05;
                let z_im = c_im + (row as f64 - 10.0) * 0.05;
                let a = from_c.sample_julia(z_re - c_re, z_im - c_im).smooth;
                let b = from_zero.sample_julia(z_re, z_im).smooth;
                assert_eq!(a.is_nan(), b.is_nan(), "({z_re}, {z_im}): {a} against {b}");
                if !a.is_nan() {
                    pairs.push((a, b));
                }
            }
        }
        let how = agreement(&pairs);
        println!("the two anchors against each other: {how:?}");
        assert!(how.compared > 100, "only {} escaping samples", how.compared);
        assert!(
            how.median_relative < 1e-12,
            "median relative error {:e}",
            how.median_relative
        );
        assert!(
            how.within * 100 >= how.compared * 95,
            "only {} of {} were within 1e-6",
            how.within,
            how.compared
        );
    }

    /// **The count is the pixel's own, and the entry index cannot shift it.**
    /// An off-by-one here would move every escape count in the frame by one and
    /// look like nothing at all, so it is asserted against the plain loop at the
    /// one sample whose delta is exactly zero: the anchor itself.
    #[test]
    fn a_julia_sample_counts_its_own_steps_and_not_the_reference_index() {
        let maxiter = 500;
        // Outside the set, so the orbit of `c` escapes and there is a count to
        // be wrong about.
        let orbit = kernel_at("0.5", "0.5", 3, maxiter);
        let kernel = Kernel::new(&orbit, maxiter, false).at_entry(1);
        let ours = kernel.sample_julia(0.0, 0.0);
        let theirs = plain_julia(0.5, 0.5, 0.5, 0.5, maxiter);
        assert!(!theirs.is_nan(), "the anchor was supposed to escape");
        assert!(
            (ours.smooth - theirs).abs() < 1e-9,
            "the pixel at the anchor read {} and the plain loop {theirs}",
            ours.smooth
        );
        // And from the origin the same orbit is one step longer, which is the
        // whole content of the entry index.
        let from_zero = Kernel::new(&orbit, maxiter, false).at_entry(0);
        let at_origin = from_zero.sample_julia(0.0, 0.0);
        assert_eq!(at_origin.iterations, ours.iterations + 1);
    }

    /// Rebasing under the Julia recurrence: a sample whose iterate falls past
    /// its own delta restarts against `Z₀ = 0`, which is the orbit of the
    /// critical point and a true reference for any `z`. If that were wrong the
    /// picture would be wrong only where it rebases, which is the boundary.
    #[test]
    fn a_julia_sample_that_rebases_still_lands_where_the_plain_loop_does() {
        let maxiter = 3000;
        let (c_text, c_im_text, c_re, c_im) = JULIA_C;
        let orbit = kernel_at(c_text, c_im_text, 3, maxiter);
        let kernel = Kernel::new(&orbit, maxiter, false).at_entry(1);
        let mut rebased = 0;
        let mut pairs = Vec::new();
        for row in 0..31 {
            for col in 0..31 {
                let delta_re = (col as f64 - 15.0) * 0.02;
                let delta_im = (row as f64 - 15.0) * 0.02;
                let ours = kernel.sample_julia(delta_re, delta_im);
                if ours.rebases == 0 {
                    continue;
                }
                rebased += 1;
                let theirs = plain_julia(c_re + delta_re, c_im + delta_im, c_re, c_im, maxiter);
                assert_eq!(ours.smooth.is_nan(), theirs.is_nan());
                if !theirs.is_nan() {
                    pairs.push((ours.smooth, theirs));
                }
            }
        }
        let how = agreement(&pairs);
        println!("{rebased} rebasing samples against the plain loop: {how:?}");
        assert!(rebased > 20, "only {rebased} samples rebased at all");
        assert!(
            how.median_relative < 1e-12,
            "median relative error {:e} over {} escaping samples",
            how.median_relative,
            how.compared
        );
    }
}
