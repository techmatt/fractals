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
use perturb::{Spec, cap};

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
    let bailout_sq = BAILOUT * BAILOUT;
    let mut x = Fx::zero(n);
    let mut y = Fx::zero(n);
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
    let kernel = Kernel::new(&orbit, maxiter, false);
    let offset = spec.centre_offset().unwrap();

    let centre_re = Fx::parse(&spec.center_re, limbs).unwrap();
    let centre_im = Fx::parse(&spec.center_im, limbs).unwrap();

    let mut interior_disagreements = 0usize;
    let mut errors: Vec<f64> = Vec::new();
    let mut relative: Vec<f64> = Vec::new();
    let mut rebases_total = 0u64;
    let mut rebases_max = 0u32;
    let mut samples = 0u64;

    for row in 0..spec.resolution[1] {
        for col in 0..spec.resolution[0] {
            let (dc_re, dc_im) = spec.dc(offset, col, row);
            let outcome = kernel.sample(dc_re, dc_im);
            rebases_total += outcome.rebases as u64;
            rebases_max = rebases_max.max(outcome.rebases);
            samples += 1;

            // The oracle's own coordinate: the view centre plus the same
            // geometry, formed from the grid rather than by undoing the offset
            // in `f64`.
            let (geometry_re, geometry_im) = spec.dc((0.0, 0.0), col, row);
            let c_re = centre_re.add(&Fx::from_f64(geometry_re, limbs).unwrap());
            let c_im = centre_im.add(&Fx::from_f64(geometry_im, limbs).unwrap());
            let truth = oracle(&c_re, &c_im, maxiter);

            if outcome.smooth.is_nan() != truth.is_nan() {
                interior_disagreements += 1;
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
        median: if compared == 0 { 0.0 } else { errors[compared / 2] },
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
    let rungs: Vec<Rung> = RUNGS.iter().map(|&w| walk(spec_at(w, false, 0.0))).collect();
    report("reference at the view centre", &rungs);
    anchor_assertions(&rungs);
}

/// The reference at the nucleus, stored for one period and wrapped — and the
/// view nudged a quarter of a frame off it, so the centre offset is not zero and
/// has to be taken in fixed point.
#[test]
#[ignore = "minutes: every sample iterated the long way in fixed point"]
fn the_kernel_matches_the_oracle_against_a_periodic_nucleus_reference() {
    let rungs: Vec<Rung> = RUNGS.iter().map(|&w| walk(spec_at(w, true, 0.25))).collect();
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
