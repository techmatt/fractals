//! The kernel against a brute-force oracle, below the `f64` wall.
//!
//! Every sample iterated **directly** in the same fixed-point arithmetic the
//! reference orbit uses — no reference, no delta, no rebasing — so the only thing
//! the comparison can be measuring is the perturbation.
//!
//! **Ignored by default**, and run with:
//!
//! ```text
//! cargo test --release --test oracle -- --ignored --nocapture
//! ```
//!
//! `--nocapture` is worth having: each test prints the per-rung table the
//! crate's README quotes.

use perturb::fx::Fx;
use perturb::kernel::{Kernel, smooth_count};
use perturb::reference::{self, BAILOUT};
use perturb::{Anchor, Spec, cap};

/// The audit's anchor: a period-2838 minibrot nucleus in the seahorse valley,
/// atom size 6.478e-12.
const ANCHOR_RE: &str = "-0.74501772828532335842941892835857434";
const ANCHOR_IM: &str = "0.14993443275456819177805709088257971";
const ANCHOR_PERIOD: u32 = 2838;

/// The anchor's ladder. 2e-11 is the audit's own framing — about 3.1 atom sizes,
/// so the minibrot is an island in frame — and every rung below it is past what
/// `f64` can address at all.
///
/// **Only the top rung has any exterior in it**, and that is a fact about the
/// view rather than about the kernel: the atom is 6.478e-12 across, so a frame
/// narrower than that is inside the minibrot's body and every sample of it is
/// interior. A nucleus is the wrong place to look for structure below its own
/// atom size. These rungs still say something — that the kernel and the oracle
/// agree about *which* samples are interior at every depth, and what rebasing
/// costs as the view goes down — and [`MISIUREWICZ`] is where the escaping half
/// of the question is asked.
const RUNGS: &[f64] = &[2e-11, 1e-13, 1e-16, 1e-19, 1e-22, 1e-25, 1e-28];

/// `c = i`: a Misiurewicz point, and the ladder that has structure all the way
/// down.
///
/// Exactly representable — `0 + 1i`, no solve and no stored digits — on the
/// boundary, and the set is asymptotically self-similar about it, so a frame of
/// any width straddles real structure rather than flat interior. Its orbit is
/// preperiodic and repelling (`0 → i → i−1 → −i → i−1 → …`, preperiod 1,
/// period 2), so escape times grow like the logarithm of the width: 33
/// iterations at 1e-4 and 94 at 1e-28. Short orbits, which is why this is the
/// ladder that can afford an oracle on every sample of every rung.
const MISIUREWICZ: (&str, &str) = ("0", "1");

/// A ladder that reaches the same depth as [`RUNGS`] and starts above the `f64`
/// wall rather than below it.
const DEEP_RUNGS: &[f64] = &[1e-4, 1e-8, 1e-13, 1e-16, 1e-19, 1e-22, 1e-25, 1e-28];

/// Small, because the oracle is the expensive half.
const TILE: (u32, u32) = (16, 9);

/// One sample, iterated the long way.
fn oracle(c_re: &Fx, c_im: &Fx, maxiter: u32) -> f64 {
    let n = c_re.n;
    oracle_from(&Fx::zero(n), &Fx::zero(n), c_re, c_im, maxiter)
}

/// The same, from a named `z₀` — which is what a Julia sample is: the parameter
/// held and the *start* varying, where Mandelbrot holds the start at zero and
/// varies the parameter.
fn oracle_from(x0: &Fx, y0: &Fx, c_re: &Fx, c_im: &Fx, maxiter: u32) -> f64 {
    let bailout_sq = BAILOUT * BAILOUT;
    let mut x = *x0;
    let mut y = *y0;
    for step in 1..=maxiter {
        let x2 = x.sqr();
        let y2 = y.sqr();
        let xy = x.mul(&y);
        let next = x2.sub(&y2).add(c_re);
        y = xy.shl1().add(c_im);
        x = next;
        let (fx, fy) = (x.to_f64(), y.to_f64());
        let magnitude_sq = fx * fx + fy * fy;
        if magnitude_sq > bailout_sq {
            return smooth_count(step, magnitude_sq);
        }
    }
    f64::NAN
}

fn spec_at(width: f64, periodic: bool, offset_frames: f64) -> Spec {
    let limbs = reference::limbs_for(width, TILE.0);
    // The view centre, nudged off the nucleus by a fraction of the frame so that
    // the reference is genuinely somewhere else. In fixed point, because at
    // 1e-28 the nudge is invisible to an `f64` addition.
    let anchor_re = Fx::parse(ANCHOR_RE, limbs).unwrap();
    let nudge = Fx::from_f64(offset_frames * width, limbs).unwrap();
    Spec {
        center_re: decimal(&anchor_re.add(&nudge), limbs),
        center_im: ANCHOR_IM.to_string(),
        width,
        resolution: [TILE.0, TILE.1],
        supersample: 1,
        maxiter: None,
        reference: periodic.then(|| (ANCHOR_RE.to_string(), ANCHOR_IM.to_string())),
        period: periodic.then_some(ANCHOR_PERIOD),
        julia: None,
        anchor: Anchor::Parameter,
        interior: false,
    }
}

/// The Julia set of `c`, framed on one of its two anchors.
///
/// **`c = i` is the ladder for the same reason it is the Mandelbrot one.** Its
/// Julia set is a dendrite — no interior at all, structure at every scale, and
/// asymptotically self-similar about both of the points this kernel can anchor
/// at, since `0 → i → i−1 → −i → i−1 → …` puts the critical point on the set.
/// So every rung has escaping samples in it rather than flat interior, and the
/// parameter is exactly representable with no stored digits to be wrong about.
fn julia_spec(c: (&str, &str), width: f64, anchor: Anchor) -> Spec {
    let (centre_re, centre_im) = match anchor {
        Anchor::Parameter => (c.0.to_string(), c.1.to_string()),
        Anchor::Origin => ("0".to_string(), "0".to_string()),
    };
    Spec {
        center_re: centre_re,
        center_im: centre_im,
        width,
        resolution: [TILE.0, TILE.1],
        supersample: 1,
        maxiter: None,
        reference: None,
        period: None,
        julia: Some((c.0.to_string(), c.1.to_string())),
        anchor,
        interior: false,
    }
}

fn misiurewicz_spec(width: f64) -> Spec {
    Spec {
        center_re: MISIUREWICZ.0.to_string(),
        center_im: MISIUREWICZ.1.to_string(),
        width,
        resolution: [TILE.0, TILE.1],
        supersample: 1,
        maxiter: None,
        reference: None,
        period: None,
        julia: None,
        anchor: Anchor::Parameter,
        interior: false,
    }
}

/// A fixed-point value back as a decimal string, so it can go into a spec the
/// way a real centre does: repeated multiplication of the fraction by ten, one
/// digit per pass, which needs no division and no 128-bit anything.
fn decimal(value: &Fx, limbs: usize) -> String {
    let (negative, magnitude) = if value.is_neg() {
        (true, value.neg())
    } else {
        (false, *value)
    };
    let integer = magnitude.w[limbs - 1];
    let mut fraction = magnitude;
    fraction.w[limbs - 1] = 0;
    let places = (64 * (limbs - 1)) / 3; // comfortably past log10(2^bits)
    let mut digits = String::with_capacity(places);
    for _ in 0..places {
        let mut carry = 0u64;
        for index in 0..limbs {
            let low = (fraction.w[index] & 0xffff_ffff) * 10 + carry;
            let high = (fraction.w[index] >> 32) * 10 + (low >> 32);
            fraction.w[index] = (low & 0xffff_ffff) | ((high & 0xffff_ffff) << 32);
            carry = high >> 32;
        }
        digits.push((b'0' + fraction.w[limbs - 1] as u8) as char);
        fraction.w[limbs - 1] = 0;
    }
    format!("{}{}.{}", if negative { "-" } else { "" }, integer, digits)
}

struct Rung {
    width: f64,
    maxiter: u32,
    limbs: usize,
    compared: usize,
    interior_disagreements: usize,
    worst: f64,
    median: f64,
    /// Escaping samples within a **relative** 1e-6 of the oracle, as a share of
    /// those compared.
    ///
    /// Relative and not absolute, because the escape counts on these rungs run
    /// to twenty thousand: an absolute 1e-6 on a count of 20,236 is asking for
    /// eleven digits of a number the picture reads four of. An absolute
    /// threshold called half of the anchor's samples a disagreement when their
    /// median difference was 1.0e-6 — five parts in ten billion.
    agreeing: f64,
    /// The median relative error, which is what the anchor ladder is actually
    /// held to. A share is a summary of the tail; this is a summary of the
    /// typical sample, and on a frame where the tail is chaos it is the number
    /// that says whether the kernel works.
    median_relative: f64,
    rebases_mean: f64,
    rebases_max: u32,
}

fn walk(spec: Spec) -> Rung {
    let maxiter = spec.maxiter();
    let limbs = spec.limbs();
    let orbit = spec.reference_orbit().unwrap();
    let kernel = Kernel::new(&orbit, maxiter, false).at_entry(spec.entry());
    let offset = spec.centre_offset().unwrap();

    // **The oracle's own precision is its own business, and at the origin
    // anchor it needs twice the kernel's.** A Julia sample anchored at `z = 0`
    // has `z₁ = z₀² + c`, so the thing that tells two neighbouring pixels apart
    // is the *square* of a spacing — 4e-59 at the bottom rung. Fixed point is
    // absolute precision: at the frame's own four limbs that is below the last
    // bit and every pixel of the tile becomes the same number, so the oracle
    // draws a flat tile and calls the kernel wrong. The kernel is not: it
    // carries the delta in `f64`, which is *relative* precision and holds 4e-59
    // to sixteen digits. Doubling the limbs is the oracle catching up, and the
    // first run of this ladder without it is the reason the sentence is here.
    //
    // **And since `deep_degrees_ckpt140` the kernel's own orbit is sized that way
    // too**, because it had the same problem and no oracle to hide behind: its `c`
    // was held to the view's bits, which is short of what separates `step²`. So
    // the oracle now takes one limb past what the spec asks for, which is past the
    // squared step by construction.
    let oracle_limbs = if spec.julia.is_some() && spec.entry() == 0 {
        (limbs + 1).min(perturb::fx::MAX_LIMBS)
    } else {
        limbs
    };

    let centre_re = Fx::parse(&spec.center_re, oracle_limbs).unwrap();
    let centre_im = Fx::parse(&spec.center_im, oracle_limbs).unwrap();
    // For a Julia rung the parameter is held and the grid is `z₀`; for a
    // Mandelbrot one the grid is the parameter and `z₀` is zero. One walk, and
    // the fork is here and in the two lines below that use it.
    let julia = spec.julia.as_ref().map(|(re, im)| {
        (
            Fx::parse(re, oracle_limbs).unwrap(),
            Fx::parse(im, oracle_limbs).unwrap(),
        )
    });

    let mut interior_disagreements = 0usize;
    let mut errors: Vec<f64> = Vec::new();
    let mut relative: Vec<f64> = Vec::new();
    let mut rebases_total = 0u64;
    let mut rebases_max = 0u32;
    let mut samples = 0u64;

    for row in 0..spec.resolution[1] {
        for col in 0..spec.resolution[0] {
            let (dc_re, dc_im) = spec.dc(offset, col, row);
            let outcome = match &julia {
                Some(_) => kernel.sample_julia(dc_re, dc_im),
                None => kernel.sample(dc_re, dc_im),
            };
            rebases_total += outcome.rebases as u64;
            rebases_max = rebases_max.max(outcome.rebases);
            samples += 1;

            // The oracle's own coordinate: the view centre plus the same
            // geometry, formed from the grid rather than by undoing the offset
            // in `f64`.
            let (geometry_re, geometry_im) = spec.dc((0.0, 0.0), col, row);
            let c_re = centre_re.add(&Fx::from_f64(geometry_re, oracle_limbs).unwrap());
            let c_im = centre_im.add(&Fx::from_f64(geometry_im, oracle_limbs).unwrap());
            let truth = match &julia {
                // The grid is `z₀`, iterated under the held parameter.
                Some((param_re, param_im)) => {
                    oracle_from(&c_re, &c_im, param_re, param_im, maxiter)
                }
                None => oracle(&c_re, &c_im, maxiter),
            };

            if outcome.smooth.is_nan() != truth.is_nan() {
                interior_disagreements += 1;
                println!(
                    "  DISAGREE at {:e}: kernel {} (n={}, rebases={}), oracle {}, cap {maxiter}",
                    spec.width, outcome.smooth, outcome.iterations, outcome.rebases, truth
                );
                continue;
            }
            if !truth.is_nan() {
                let error = (outcome.smooth - truth).abs();
                errors.push(error);
                relative.push(error / truth.abs().max(1.0));
            }
        }
    }
    errors.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let mut sorted_relative = relative.clone();
    sorted_relative.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let compared = errors.len();
    Rung {
        width: spec.width,
        maxiter,
        limbs,
        compared,
        interior_disagreements,
        worst: errors.last().copied().unwrap_or(0.0),
        median: if compared == 0 {
            0.0
        } else {
            errors[compared / 2]
        },
        agreeing: if compared == 0 {
            1.0
        } else {
            relative.iter().filter(|error| **error < 1e-6).count() as f64 / compared as f64
        },
        median_relative: if compared == 0 {
            0.0
        } else {
            sorted_relative[compared / 2]
        },
        rebases_mean: rebases_total as f64 / samples as f64,
        rebases_max,
    }
}

fn report(title: &str, rungs: &[Rung]) {
    println!("\n{title}");
    println!(
        "| width | cap | limbs | escaping | interior disagreements | median Δ | median Δ/ν | worst Δ | within 1e-6 (rel) | rebases mean / max |"
    );
    println!("|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|");
    for rung in rungs {
        println!(
            "| {:e} | {} | {} | {} | {} | {:.2e} | {:.2e} | {:.3e} | {:.1}% | {:.1} / {} |",
            rung.width,
            rung.maxiter,
            rung.limbs,
            rung.compared,
            rung.interior_disagreements,
            rung.median,
            rung.median_relative,
            rung.worst,
            100.0 * rung.agreeing,
            rung.rebases_mean,
            rung.rebases_max,
        );
    }
}

/// **What the anchor ladder is allowed to claim.**
///
/// Every rung: the kernel and the oracle agree about which samples are interior,
/// exactly. The one rung with exterior in it — 2e-11, above the atom size — also
/// has to agree about the smooth count on the overwhelming majority of escaping
/// samples. It is deliberately not held to its *worst* sample, and
/// `tests/probe.rs` says why: at a cap of 48,551 a sample within an ulp of the
/// boundary has an escape count that is chaotically sensitive to the last bit of
/// the arithmetic, and on the worst such sample the plain `f64` loop is
/// **further** from the oracle than this kernel is — 1,730 and 3,832 against a
/// true 3,025. A worst-case assertion here would be asserting that chaos is not
/// chaotic.
fn anchor_assertions(rungs: &[Rung]) {
    for rung in rungs {
        assert_eq!(
            rung.interior_disagreements, 0,
            "{:e}: {} samples disagreed about the interior",
            rung.width, rung.interior_disagreements
        );
        if rung.compared > 0 {
            // The typical sample, not the share and not the tail. At the anchor
            // 84% of escaping samples are within a relative 1e-6 and the median
            // is five parts in ten billion — a bar set at the share would be a
            // bar set on how many of 88 samples happen to sit on the boundary.
            assert!(
                rung.median_relative < 1e-9,
                "{:e}: median relative error {:e} over {} escaping samples",
                rung.width,
                rung.median_relative,
                rung.compared
            );
        }
    }
    assert!(
        rungs[0].compared > 40,
        "the top rung had only {} escaping samples",
        rungs[0].compared
    );
}

/// The reference at the view centre, walked out to the cap.
#[test]
#[ignore = "minutes: every sample iterated the long way in fixed point"]
fn the_kernel_matches_a_brute_force_oracle_at_the_view_centre() {
    let rungs: Vec<Rung> = RUNGS
        .iter()
        .map(|&w| walk(spec_at(w, false, 0.0)))
        .collect();
    report("reference at the view centre", &rungs);
    anchor_assertions(&rungs);
}

/// The reference at the nucleus, stored for one period and wrapped — and the
/// view nudged a quarter of a frame off it, so the centre offset is not zero and
/// has to be taken in fixed point.
#[test]
#[ignore = "minutes: every sample iterated the long way in fixed point"]
fn the_kernel_matches_the_oracle_against_a_periodic_nucleus_reference() {
    let rungs: Vec<Rung> = RUNGS
        .iter()
        .map(|&w| walk(spec_at(w, true, 0.25)))
        .collect();
    report(
        "reference at the period-2838 nucleus, view a quarter-frame off it",
        &rungs,
    );
    anchor_assertions(&rungs);
}

/// The Misiurewicz ladder: eight rungs from 1e-4 to 1e-28, every sample against
/// the oracle.
///
/// This is the one that tests the arithmetic rather than the chaos. Escape times
/// here are short, so nothing has room to amplify a last-bit difference and the
/// kernel is held to matching the oracle on *every* sample. What it is really
/// testing is the coordinate: at 1e-28 the sample spacing is 6e-30 and every
/// sample in the tile is the same `f64`.
#[test]
#[ignore = "seconds"]
fn the_kernel_matches_the_oracle_all_the_way_down_a_misiurewicz_ladder() {
    let rungs: Vec<Rung> = DEEP_RUNGS
        .iter()
        .map(|&width| walk(misiurewicz_spec(width)))
        .collect();
    report("reference at c = i, a Misiurewicz point", &rungs);
    for rung in &rungs {
        assert!(
            rung.compared > 100,
            "{:e}: only {} escaping samples",
            rung.width,
            rung.compared
        );
        assert_eq!(rung.interior_disagreements, 0, "{:e}", rung.width);
        assert!(
            rung.worst < 1e-6,
            "{:e}: worst smooth error {:e}",
            rung.width,
            rung.worst
        );
    }
}

/// The interior switch, ON against OFF, on both ladders.
///
/// The one thing that must never happen is a sample the switch paints interior
/// that the plain run escapes from. The other direction — a sample the switch
/// misses — costs iterations and nothing else, and is counted rather than
/// asserted on.
#[test]
#[ignore = "minutes"]
fn the_interior_switch_never_paints_an_escaping_sample() {
    println!("\ninterior switch, ON against OFF");
    println!(
        "| view | width | cap | samples | interior | caught by the switch | wrongly painted | iterations saved |"
    );
    println!("|---|---|--:|--:|--:|--:|--:|--:|");
    for (label, spec) in RUNGS
        .iter()
        .map(|&w| ("anchor", spec_at(w, false, 0.0)))
        .chain(DEEP_RUNGS.iter().map(|&w| ("c = i", misiurewicz_spec(w))))
    {
        let maxiter = spec.maxiter();
        let orbit = spec.reference_orbit().unwrap();
        let offset = spec.centre_offset().unwrap();
        let on = Kernel::new(&orbit, maxiter, true);
        let off = Kernel::new(&orbit, maxiter, false);

        let (mut inside, mut caught, mut wrong, mut total) = (0u32, 0u32, 0u32, 0u64);
        let (mut with, mut without) = (0u64, 0u64);
        for row in 0..spec.resolution[1] {
            for col in 0..spec.resolution[0] {
                let (dc_re, dc_im) = spec.dc(offset, col, row);
                let a = on.sample(dc_re, dc_im);
                let b = off.sample(dc_re, dc_im);
                total += 1;
                with += a.iterations as u64;
                without += b.iterations as u64;
                if b.smooth.is_nan() {
                    inside += 1;
                    if a.detected_interior {
                        caught += 1;
                    }
                    assert!(a.smooth.is_nan(), "the switch escaped where OFF did not");
                } else if a.smooth.is_nan() {
                    wrong += 1;
                } else {
                    assert_eq!(
                        a.smooth, b.smooth,
                        "the switch moved an escaping sample at ({dc_re:e}, {dc_im:e})"
                    );
                }
            }
        }
        println!(
            "| {label} | {:e} | {maxiter} | {total} | {inside} | {caught} | {wrong} | {:.1}% |",
            spec.width,
            100.0 * (1.0 - with as f64 / without as f64),
        );
        assert_eq!(
            wrong, 0,
            "{:e}: {wrong} escaping samples painted interior",
            spec.width
        );
    }
}

/// The cap policy, read back at every rung — the numbers the README quotes.
#[test]
fn the_ladders_caps_are_the_engines_shape_past_its_ceiling() {
    for &width in RUNGS {
        let policy = cap::for_width(width);
        assert!(policy > 0);
        // Only the top rung is inside the engine's own ceiling.
        if width < 4.7e-16 {
            assert!(policy > 67_000, "{width:e} gave {policy}");
        }
    }
    assert_eq!(cap::for_width(2e-11), 48_551);
}

/// **The Julia ladder at `z = c`, entered at `Z₁`.**
///
/// This is the one that proves the Julia arithmetic, and it is the same claim as
/// the Misiurewicz ladder above in the other variable: every sample of every
/// rung iterated the long way under a held parameter, from its own `z₀`, with no
/// reference and no delta in front of it. At the bottom rung the sample spacing
/// is 6e-30 and every `z₀` in the tile is the same `f64`, so there is no reading
/// of a passing run in which the delta machinery is working by accident.
#[test]
#[ignore = "seconds"]
fn the_julia_kernel_matches_the_oracle_down_a_dendrite_ladder_at_the_parameter() {
    let rungs: Vec<Rung> = DEEP_RUNGS
        .iter()
        .map(|&width| walk(julia_spec(MISIUREWICZ, width, Anchor::Parameter)))
        .collect();
    report("julia at c = i, anchored at z = c", &rungs);
    julia_assertions(&rungs);
}

/// **And at `z = 0`, entered at `Z₀`** — the critical point, where the picture
/// has exact two-fold symmetry and the delta starts against the orbit's own
/// first point.
#[test]
#[ignore = "seconds"]
fn the_julia_kernel_matches_the_oracle_down_a_dendrite_ladder_at_the_origin() {
    let rungs: Vec<Rung> = DEEP_RUNGS
        .iter()
        .map(|&width| walk(julia_spec(MISIUREWICZ, width, Anchor::Origin)))
        .collect();
    report("julia at c = i, anchored at z = 0", &rungs);
    julia_assertions(&rungs);
}

/// `M(3,1)`, the Misiurewicz point of preperiod 3 and period 1 on the real axis,
/// to 130 digits — **a boundary `c` that is not dyadic**, which is the whole reason
/// it is here.
///
/// `c = i` is exactly representable, so its critical orbit is exact at *any* limb
/// count and a ladder built on it cannot see a reference that was computed short
/// of the bits it needed. This one has 130 digits that all matter, and its orbit
/// stays on the dendrite for about 580 steps before the digits run out, which is
/// long enough for a truncated `c` to show.
const M31: (&str, &str) = (
    "-1.543689012692076361570855971801747986525203297650983935240804037831168673927973866485157914576059125462120829226367060189278756463",
    "0",
);

/// **The origin anchor, at a `c` the orbit cannot hold exactly** *(deep_degrees_ckpt140)*.
///
/// At `z = 0` a pixel's first step is its offset squared, so the reference has to
/// separate `step²` and not `step`. Before this ladder existed the kernel sized the
/// orbit for `step`, and `audit_deep_families_ckpt140` measured what that drew on
/// the committed crate at this `c` and this tile: a median error of **6.6 smooth
/// counts at 1e-30, 34 at 1e-36 and 11 at 1e-40**, against **6e-14** with the bits
/// [`perturb::reference::limbs_pow`] now gives. The dendrite ladders above could
/// not see it, because `c = i` is dyadic.
#[test]
#[ignore = "seconds"]
fn the_origin_anchor_holds_a_non_dyadic_c_to_the_squared_step() {
    let rungs: Vec<Rung> = [1e-20, 1e-30, 1e-36, 1e-40]
        .iter()
        .map(|&width| {
            walk(Spec {
                maxiter: Some(20_000),
                ..julia_spec(M31, width, Anchor::Origin)
            })
        })
        .collect();
    report("julia at M(3,1), anchored at z = 0", &rungs);
    for rung in &rungs {
        assert!(
            rung.compared > 100,
            "{:e}: only {} escaping samples",
            rung.width,
            rung.compared
        );
        assert_eq!(rung.interior_disagreements, 0, "{:e}", rung.width);
        assert!(
            rung.median < 1e-9,
            "{:e}: median smooth error {:e} — the orbit is short of the squared step",
            rung.width,
            rung.median
        );
    }
}

/// The Julia set of the audit's own deep `c`: a parameter of thirty-five digits,
/// held, with the grid a neighbourhood of `z = c`. This is the view the tab's
/// button opens, measured.
///
/// **This ladder is held to its median and not to its worst sample, and it has a
/// named allowance for the interior mask** — which is the anchor ladder's ruling
/// rather than the dendrite ladders', and for the anchor ladder's reason. Around
/// a period-2838 nucleus at a cap of forty thousand, a boundary sample's escape
/// count is chaotically sensitive to the last bit of anything, and where the cap
/// falls between the two answers the disagreement shows up as interior rather
/// than as a count. `tests/probe.rs`'s `three_ways_on_a_deep_julia_frame` is
/// what settles who is right on those samples, and the answer is unambiguous:
/// against the fixed-point oracle at 2e-9, **the kernel is nearer on 250 of 256
/// samples and the plain `f64` loop on 1**, with the plain loop reading 20,283
/// where the oracle reads 29,223. The dendrite ladders above, which have no
/// interior at all, are the ones held to every sample.
///
/// The bottom two rungs are entirely interior, and that is the picture rather
/// than the kernel: inside a superattracting basin every point converges to the
/// cycle, so a frame narrower than the structure around `z = c` is filled.
#[test]
#[ignore = "minutes: every sample iterated the long way in fixed point"]
fn the_julia_kernel_matches_the_oracle_at_the_audits_own_deep_c() {
    let rungs: Vec<Rung> = [2e-6, 2e-8, 2e-9, 2e-10, 2e-11, 1e-13]
        .iter()
        .map(|&width| walk(julia_spec((ANCHOR_RE, ANCHOR_IM), width, Anchor::Parameter)))
        .collect();
    report("julia at the audit's anchor, anchored at z = c", &rungs);
    for rung in &rungs {
        // 144 samples a tile, so this is "a couple, and never a corner of the
        // picture". Two is what the 2e-9 rung produced.
        assert!(
            rung.interior_disagreements * 50 <= (TILE.0 * TILE.1) as usize,
            "{:e}: {} samples disagreed about the interior",
            rung.width,
            rung.interior_disagreements
        );
        if rung.compared > 0 {
            assert!(
                rung.median_relative < 1e-9,
                "{:e}: median relative error {:e} over {} escaping samples",
                rung.width,
                rung.median_relative,
                rung.compared
            );
        }
    }
    // The top rungs have to have real exterior in them, or the ladder is only
    // checking that a filled basin is filled.
    assert!(
        rungs[0].compared > 100 && rungs[1].compared > 100,
        "the top rungs had {} and {} escaping samples",
        rungs[0].compared,
        rungs[1].compared
    );
}

/// What a dendrite ladder is allowed to claim, and it is the Misiurewicz
/// ladder's own bar: every sample escapes, every sample agrees about whether it
/// escaped, and the smooth counts agree to a part in a million — not a share and
/// not a median, because a dendrite has no interior and so no boundary samples
/// whose escape count is chaotic.
fn julia_assertions(rungs: &[Rung]) {
    for rung in rungs {
        assert!(
            rung.compared > 100,
            "{:e}: only {} escaping samples",
            rung.width,
            rung.compared
        );
        assert_eq!(rung.interior_disagreements, 0, "{:e}", rung.width);
        assert!(
            rung.worst < 1e-6,
            "{:e}: worst smooth error {:e}",
            rung.width,
            rung.worst
        );
    }
}

/// The round trip the ladder's own scaffolding leans on: a fixed-point value
/// printed as a decimal and parsed back is the same number, and the nudge it
/// carries survived being written out.
#[test]
fn a_nudged_centre_survives_being_written_out_and_read_back() {
    for &width in RUNGS {
        let limbs = reference::limbs_for(width, TILE.0);
        let anchor = Fx::parse(ANCHOR_RE, limbs).unwrap();
        let nudged = anchor.add(&Fx::from_f64(0.25 * width, limbs).unwrap());
        let back = Fx::parse(&decimal(&nudged, limbs), limbs).unwrap();
        // Both directions truncate, so the round trip is exact to the last
        // fraction bit and no further: 2^-128 at three limbs, 2^-192 at four.
        let last_bit = (2.0f64).powi(-64 * (limbs as i32 - 1));
        assert!(
            back.sub(&nudged).to_f64().abs() < 4.0 * last_bit,
            "{width:e}: the decimal did not round-trip"
        );
        let moved = nudged.sub(&anchor).to_f64();
        assert!(
            (moved / (0.25 * width) - 1.0).abs() < 1e-12,
            "{width:e}: nudge came back as {moved:e}"
        );
    }
}
