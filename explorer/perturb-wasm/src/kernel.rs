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
//! **Rebasing is Zhuoran's**, and it is what replaces the whole apparatus of
//! glitch detection and secondary references: when `|z| < |δ|` the delta has
//! grown past the thing it is a perturbation of and has stopped carrying any
//! information, so `δ := z` and `m := 0` restarts it against `Z[0] = 0` — which
//! is a valid reference for every point, being the orbit of the origin. The same
//! move covers the reference running out. The archive's kernel does exactly this
//! and carries no Pauldelbrot test, no secondary reference and no correction
//! pass.
//!
//! ## Where a skip table would go
//!
//! Bivariate linear approximation replaces a run of steps of the loop below with
//! one `δ ← A·δ + B·dc`, read out of a table built off the reference orbit, and
//! it is worth an order of magnitude on a frame that spends most of its
//! iterations far from the boundary. It is deliberately **not** built here: it
//! changes nothing about what a picture *is*, only how long it takes, and it
//! wants the correctness of the plain loop settled first. The seam is the top of
//! [`Kernel::sample`]'s loop, marked there — a lookup on `(m, |δ|)` that either
//! advances `m` and `n` by a run length or falls through to the single step
//! below it.

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
    /// first factor.
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
}

impl<'a> Kernel<'a> {
    pub fn new(reference: &'a Reference, maxiter: u32, interior: bool) -> Self {
        Kernel {
            reference,
            maxiter,
            interior,
            floor: INTERIOR_EXPONENT,
        }
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
        let offset_is_zero = dc_re == 0.0 && dc_im == 0.0;

        let mut delta_re = 0.0f64;
        let mut delta_im = 0.0f64;
        // `Z[m]`, carried across the step rather than loaded twice.
        let mut zr = points[0][0];
        let mut zi = points[0][1];
        let mut m = 0usize;
        let mut n = 0u32;
        let mut rebases = 0u32;
        let mut degenerate = false;

        // |dz|², as a mantissa in [1, 2^64) and a power-of-two exponent. Only
        // touched under the switch.
        let mut derivative = 1.0f64;
        let mut exponent = 0i32;

        loop {
            // ---- the BLA seam: a skip table would be consulted here. ----
            let ar = zr + zr + delta_re;
            let ai = zi + zi + delta_im;
            let next_re = ar * delta_re - ai * delta_im + dc_re;
            let next_im = ar * delta_im + ai * delta_re + dc_im;
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
                            return interior_outcome(n, rebases, true, degenerate);
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
                    return interior_outcome(n, rebases, true, degenerate);
                }
            }

            if n >= maxiter {
                return interior_outcome(n, rebases, false, degenerate);
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

fn interior_outcome(n: u32, rebases: u32, detected: bool, degenerate: bool) -> Outcome {
    Outcome {
        smooth: f64::NAN,
        iterations: n,
        rebases,
        detected_interior: detected,
        degenerate,
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

    fn kernel_at(centre: &str, centre_im: &str, limbs: usize, maxiter: u32) -> reference::Reference {
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
}
