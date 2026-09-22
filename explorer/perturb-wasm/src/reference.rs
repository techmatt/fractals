//! The reference orbit: one high-precision orbit per frame, projected to `f64`.
//!
//! Everything expensive about a deep frame happens in [`crate::kernel`], in
//! `f64`, against the numbers this module produces. It runs **once per frame**,
//! costs a few milliseconds, and is then a read-only buffer — which is why
//! [`crate::reference_orbit`] hands it to JavaScript rather than recomputing it:
//! the page's workers cannot share memory (no `SharedArrayBuffer`, because
//! GitHub Pages will not send COOP/COEP), and a `resolve` runs once per band per
//! worker, so an orbit computed inside one would be computed some fifty times a
//! frame.

use crate::fx::{Fx, MAX_LIMBS};

/// Escape radius, and it is the engine's: `iterate::BAILOUT`.
pub const BAILOUT: f64 = 65536.0;

/// Fraction bits kept past what the view can resolve.
///
/// The archive's rule, `hp::prec_bits(out_width, frame_width) = max(53,
/// ceil(log2(out_width / frame_width)) + 64)`, and the thing worth noticing is
/// what is *not* in it: no term for the orbit length, the supersample, the period
/// or `|c|`. Precision here buys the ability to tell two neighbouring samples
/// apart, and that is a property of the grid and nothing else. The orbit-length
/// term a reader expects belongs to the *delta*, and the delta is `f64` and is
/// kept honest by rebasing instead.
pub const GUARD_BITS: f64 = 64.0;

/// The limb count a view deserves: enough fraction bits to separate two adjacent
/// samples, plus [`GUARD_BITS`], plus the one limb that holds the integer part.
///
/// At width 2e-11 across 480 samples that is 109 bits and **3 limbs**; at 1e-28
/// it is 166 bits and **4**. The clamp at the top is [`MAX_LIMBS`], which is past
/// where `f64` can hold the width at all.
pub fn limbs_for(width: f64, sample_width: u32) -> usize {
    limbs_pow(width, sample_width, 1)
}

/// The limb count for a view whose neighbouring samples are told apart only at
/// `step^power`, and not at `step`.
///
/// **This is the Julia origin anchor's rule** *(deep_degrees_ckpt140)*. At `z = 0`
/// the first step is `z₁ = z₀^d + c`, so two pixels one step apart at `z₀` are
/// `step^d` apart at `z₁`, and everything after that is iterated from `z₁`. The
/// reference `c` and its orbit therefore have to hold `c` to the bits that
/// separate `step^d`, which is `d` times the view's own — sized for `step` alone,
/// the orbit's last bit is coarser than the difference between two pixels and the
/// picture is of the truncation. `audit_deep_families_ckpt140` measured it on the
/// shipped d=2 tab: a median error of **6.6 smooth counts at 1e-30 and 34 at
/// 1e-36**, against 6e-14 with the bits this gives. `power = 1` is
/// [`limbs_for`], which is every other view.
///
/// The clamp is [`MAX_LIMBS`], and [`limbs_pow_fits`] is the question of whether
/// it bound, so a caller that must not draw at a clamped count can ask.
pub fn limbs_pow(width: f64, sample_width: u32, power: u32) -> usize {
    (fraction_limbs(width, sample_width, power) + 1).clamp(3, MAX_LIMBS)
}

/// Whether [`limbs_pow`] holds all the bits it was asked for, or was clamped.
pub fn limbs_pow_fits(width: f64, sample_width: u32, power: u32) -> bool {
    fraction_limbs(width, sample_width, power) < MAX_LIMBS
}

fn fraction_limbs(width: f64, sample_width: u32, power: u32) -> usize {
    if !(width > 0.0) || sample_width == 0 {
        return 2;
    }
    let bits =
        power.max(1) as f64 * (sample_width as f64 / width).log2().ceil().max(0.0) + GUARD_BITS;
    ((bits / 64.0).ceil() as usize).max(1)
}

/// One reference orbit, as the kernel reads it.
///
/// `points[m]` is `Z[m]` as `[re, im]`, starting at `Z[0] = 0`.
///
/// **Interleaved, and measurably so.** The kernel reads both halves of one index
/// together and nothing else, so a pair in one sixteen-byte line is one cache
/// miss rather than two and one bounds check rather than two. A 48,552-point
/// orbit is 777 KB and does not sit in L2, so how it is laid out is most of what
/// the loop is doing: this layout and the hoisting that came with it are worth
/// about 2.5× on the anchor frame, which the crate README prices. It is also the
/// layout the buffer crossing to JavaScript already wanted.
pub struct Reference {
    pub points: Vec<[f64; 2]>,
    /// The orbit left the bailout disc before the cap, so the kernel must rebase
    /// when it runs off the end rather than wrapping.
    pub escaped: bool,
    /// The caller named a period and `Z[period]` came back to the origin, so the
    /// stored orbit is one period long and index `period` wraps to `0`.
    pub periodic: bool,
    /// `|Z[period]|` — how far from a true nucleus the centre actually is. Zero at
    /// a perfect one; reported rather than asserted, because it is the one number
    /// that says whether the wrap above is a shortcut or a lie.
    pub period_residual: f64,
    /// Limbs the orbit was computed at.
    pub limbs: usize,
}

impl Reference {
    pub fn len(&self) -> usize {
        self.points.len()
    }

    pub fn is_empty(&self) -> bool {
        self.points.is_empty()
    }
}

/// Iterate `Z' = Z² + C` from `Z[0] = 0` in fixed point, storing every step.
///
/// **The bailout check comes before the precision, not after it.** Three of the
/// four candidate arithmetics in the audit fail differently on an orbit that
/// escapes — astro-float degrades to inf/NaN, dashu panics outright with "out of
/// memory" as its exponent runs away, and fixed point, which is what this is,
/// overflows its integer limb *silently*. A reference is normally a point in or
/// near the set and the question never arises; it arises the moment a caller
/// passes a reference that is neither, and a silent wrap would be a picture
/// rather than an error.
///
/// With `period` set the orbit is stored for exactly one period and
/// [`Reference::periodic`] is true, which is the whole reason a nucleus is worth
/// naming: a period-2838 reference at a cap of 48,551 is 45 KB instead of 777 KB,
/// and the kernel's wrap replaces its rebase.
pub fn orbit(c_re: &Fx, c_im: &Fx, maxiter: u32, period: Option<u32>) -> Reference {
    let n = c_re.n;
    let limit = match period {
        Some(p) => p.max(1),
        None => maxiter,
    };
    let bailout_sq = BAILOUT * BAILOUT;

    let mut x = Fx::zero(n);
    let mut y = Fx::zero(n);
    let mut points = Vec::with_capacity(limit as usize + 1);
    points.push([0.0, 0.0]);

    let mut escaped = false;
    for _ in 0..limit {
        let x2 = x.sqr();
        let y2 = y.sqr();
        let xy = x.mul(&y);
        let next_x = x2.sub(&y2).add(c_re);
        y = xy.shl1().add(c_im);
        x = next_x;

        let (fx, fy) = (x.to_f64(), y.to_f64());
        points.push([fx, fy]);
        if fx * fx + fy * fy > bailout_sq {
            // Escaped: keep the escaping step and stop. Anything past it is
            // outside the disc the delta recurrence is linearised in.
            escaped = true;
            break;
        }
    }

    match period {
        Some(_) if !escaped => {
            // `Z[p]` is the residual, and the stored orbit is `Z[0..p)`.
            let [last_re, last_im] = points.pop().unwrap();
            Reference {
                points,
                escaped,
                periodic: true,
                period_residual: (last_re * last_re + last_im * last_im).sqrt(),
                limbs: n,
            }
        }
        _ => Reference {
            points,
            escaped,
            periodic: false,
            period_residual: f64::NAN,
            limbs: n,
        },
    }
}

/// The reference orbit of `Z' = Z^d + C` from `Z[0] = 0`, at any degree the
/// kernel draws. Degree two is [`orbit`], untouched.
///
/// **The one thing the degree forces is an overflow guard, and it is the same
/// silent wrap the bailout check exists for.** [`orbit`] checks the bailout on
/// the `f64` projection *after* the step, which at degree two is safe: an iterate
/// under `2^16` squares to `2^32`, inside the signed integer limb. At degree four
/// the same step reaches `2^64` and wraps with no error at all. So once `|Z| ≥ 8`
/// the orbit continues in `f64` — `8^6` is still far inside the limb — and that
/// loses nothing, because an iterate that size is outside every set this draws and
/// on its way out: what the kernel reads off it is `|z|` against the bailout and
/// a smooth count, which want relative precision, and `f64` is relative precision.
/// `audit_deep_families_ckpt140` held the same tail against a fixed-point oracle at
/// every degree and it agreed to 7e-15.
///
/// `z^d` in fixed point is `d − 1` complex multiplies of the iterate by itself, four
/// `Fx` multiplies each. That is 26 ms of orbit at degree two and 140 at six, native,
/// against a frame of seconds.
pub fn orbit_of(degree: u32, c_re: &Fx, c_im: &Fx, maxiter: u32, period: Option<u32>) -> Reference {
    if degree == 2 {
        return orbit(c_re, c_im, maxiter, period);
    }
    let n = c_re.n;
    let limit = match period {
        Some(p) => p.max(1),
        None => maxiter,
    };
    let bailout_sq = BAILOUT * BAILOUT;
    let c = [c_re.to_f64(), c_im.to_f64()];

    let mut x = Fx::zero(n);
    let mut y = Fx::zero(n);
    // `Some` once the orbit has left for `f64`, and never `None` again.
    let mut tail: Option<[f64; 2]> = None;
    let mut points = Vec::with_capacity(limit as usize + 1);
    points.push([0.0, 0.0]);

    let mut escaped = false;
    for _ in 0..limit {
        let point = match tail {
            Some(z) => {
                let w = cpow_f64(z, degree);
                [w[0] + c[0], w[1] + c[1]]
            }
            None => {
                let (re, im) = cpow_fx(&x, &y, degree);
                x = re.add(c_re);
                y = im.add(c_im);
                [x.to_f64(), y.to_f64()]
            }
        };
        points.push(point);
        let norm = point[0] * point[0] + point[1] * point[1];
        if norm > bailout_sq {
            escaped = true;
            break;
        }
        if tail.is_some() || norm >= 64.0 {
            tail = Some(point);
        }
    }

    match period {
        Some(_) if !escaped => {
            let [last_re, last_im] = points.pop().unwrap();
            Reference {
                points,
                escaped,
                periodic: true,
                period_residual: (last_re * last_re + last_im * last_im).sqrt(),
                limbs: n,
            }
        }
        _ => Reference {
            points,
            escaped,
            periodic: false,
            period_residual: f64::NAN,
            limbs: n,
        },
    }
}

/// `(x + iy)^d` in fixed point, by repeated multiplication.
pub fn cpow_fx(x: &Fx, y: &Fx, degree: u32) -> (Fx, Fx) {
    let (mut re, mut im) = (*x, *y);
    for _ in 1..degree {
        let next_re = re.mul(x).sub(&im.mul(y));
        let next_im = re.mul(y).add(&im.mul(x));
        re = next_re;
        im = next_im;
    }
    (re, im)
}

/// `z^d` in `f64`, by repeated multiplication — the orbit's tail, and the plain
/// loop the tests hold the kernel to.
pub fn cpow_f64(z: [f64; 2], degree: u32) -> [f64; 2] {
    let mut w = z;
    for _ in 1..degree {
        w = [w[0] * z[0] - w[1] * z[1], w[0] * z[1] + w[1] * z[0]];
    }
    w
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_limb_count_follows_the_view_and_nothing_else() {
        // The audit's anchor: 109 bits, three limbs.
        assert_eq!(limbs_for(2e-11, 480), 3);
        // Ten decades deeper wants a fourth.
        assert_eq!(limbs_for(1e-28, 480), 4);
        assert_eq!(limbs_for(3.0, 480), 3);
        // The orbit length is not an input, so a cap cannot appear in the answer.
        assert_eq!(limbs_for(1e-28, 480), limbs_for(1e-28, 480));
        // Supersample enters only as more samples across, which is the grid.
        assert!(limbs_for(1e-40, 2560) >= limbs_for(1e-40, 480));
    }

    /// The origin anchor's rule is the view's rule with the sample bits multiplied,
    /// and at a power of one it is the view's rule exactly.
    #[test]
    fn a_power_of_the_step_multiplies_the_bits_and_not_the_guard() {
        for width in [3.0, 2e-11, 1e-28, 1e-40] {
            assert_eq!(limbs_pow(width, 480, 1), limbs_for(width, 480));
        }
        // The audit's harness at 16 samples across: four limbs for the view at 1e-30,
        // six for its square — 2 × 104 + 64 = 272 bits.
        assert_eq!(limbs_for(1e-30, 16), 4);
        assert_eq!(limbs_pow(1e-30, 16, 2), 6);
        assert_eq!(limbs_pow(1e-40, 16, 2), 7);
        // And the clamp is reported rather than silent.
        assert!(limbs_pow_fits(1e-40, 2272, 2));
        assert!(!limbs_pow_fits(1e-150, 2272, 2));
        assert_eq!(limbs_pow(1e-150, 2272, 2), MAX_LIMBS);
    }

    #[test]
    fn a_degenerate_view_falls_back_rather_than_producing_nonsense() {
        assert_eq!(limbs_for(0.0, 480), 3);
        assert_eq!(limbs_for(f64::NAN, 480), 3);
        assert_eq!(limbs_for(2e-11, 0), 3);
    }

    #[test]
    fn the_origin_orbit_stays_at_the_origin() {
        let zero = Fx::zero(3);
        let reference = orbit(&zero, &zero, 50, None);
        assert_eq!(reference.len(), 51);
        assert!(
            reference
                .points
                .iter()
                .all(|&[re, im]| re == 0.0 && im == 0.0)
        );
        assert!(!reference.escaped);
    }

    #[test]
    fn an_escaping_reference_stops_at_the_escape_rather_than_overflowing() {
        let c = Fx::parse("1.5", 3).unwrap();
        let reference = orbit(&c, &Fx::zero(3), 10_000, None);
        assert!(reference.escaped);
        assert!(reference.len() < 20, "len was {}", reference.len());
        let last = reference.points.last().unwrap()[0];
        assert!(last.is_finite() && last > BAILOUT);
    }

    /// Degree two is the quadratic orbit exactly, and every other degree stops at
    /// the escape with a finite point rather than a wrapped limb.
    #[test]
    fn a_degree_d_orbit_escapes_rather_than_wrapping() {
        let c = Fx::parse("1.5", 3).unwrap();
        let zero = Fx::zero(3);
        let two = orbit_of(2, &c, &zero, 1000, None);
        let quadratic = orbit(&c, &zero, 1000, None);
        assert_eq!(two.points, quadratic.points);
        for degree in 3..=6 {
            let reference = orbit_of(degree, &c, &zero, 10_000, None);
            assert!(reference.escaped, "degree {degree} never escaped");
            let [re, im] = *reference.points.last().unwrap();
            assert!(re.is_finite() && im.is_finite());
            assert!(re * re + im * im > BAILOUT * BAILOUT, "degree {degree}");
            // `1.5 → 1.5^d + 1.5 → …`: real and positive all the way out.
            assert!(reference.points.iter().all(|p| p[0] >= 0.0 && p[1] == 0.0));
        }
        // The origin is a fixed point at every degree.
        let still = orbit_of(5, &zero, &zero, 50, None);
        assert!(!still.escaped && still.points.iter().all(|p| *p == [0.0, 0.0]));
    }

    /// The period-3 nucleus, which the audit used as its accuracy case.
    #[test]
    fn a_nucleus_comes_back_to_the_origin_after_its_period() {
        let c_re = Fx::parse("-1.7548776662466927600495", 4).unwrap();
        let reference = orbit(&c_re, &Fx::zero(4), 1000, Some(3));
        assert!(reference.periodic);
        assert_eq!(reference.len(), 3);
        assert_eq!(reference.points[0], [0.0, 0.0]);
        assert!(
            reference.period_residual < 1e-22,
            "residual was {:e}",
            reference.period_residual
        );
    }

    /// The digits past the seventeenth are the whole point, so this is the test
    /// that they survive: two centres that are the same `f64` take visibly
    /// different orbits.
    ///
    /// At `c = -1.9`, which is the audit's own chaotic case — a nucleus is the
    /// wrong place to ask, because a superattracting orbit *contracts* a
    /// perturbation and both would converge to the same cycle.
    #[test]
    fn two_centres_the_same_in_f64_take_different_orbits() {
        let wide = Fx::parse("-1.9", 5).unwrap();
        let nudged = Fx::parse("-1.90000000000000000000001", 5).unwrap();
        assert_eq!(wide.to_f64(), nudged.to_f64());
        let a = orbit(&wide, &Fx::zero(5), 200, None);
        let b = orbit(&nudged, &Fx::zero(5), 200, None);
        let apart = a
            .points
            .iter()
            .zip(&b.points)
            .map(|(p, q)| (p[0] - q[0]).abs())
            .fold(0.0f64, f64::max);
        assert!(apart > 1e-6, "orbits never diverged: {apart:e}");
    }
}
