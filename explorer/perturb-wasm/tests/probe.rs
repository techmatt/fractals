//! A scratch probe, not a proof: where the kernel and the oracle disagree, and
//! whether a plain `f64` loop is nearer to one than the other.
//!
//! ```text
//! cargo test --release --test probe -- --ignored --nocapture
//! ```

use perturb::fx::Fx;
use perturb::kernel::{Kernel, smooth_count};
use perturb::reference::{self, BAILOUT};
use perturb::Anchor;

fn oracle(c_re: &Fx, c_im: &Fx, maxiter: u32) -> (f64, u32) {
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
            return (smooth_count(step, magnitude_sq), step);
        }
    }
    (f64::NAN, maxiter)
}

fn plain(c_re: f64, c_im: f64, maxiter: u32) -> (f64, u32) {
    let bailout_sq = BAILOUT * BAILOUT;
    let (mut x, mut y) = (0.0f64, 0.0f64);
    for step in 1..=maxiter {
        let next = x * x - y * y + c_re;
        y = 2.0 * x * y + c_im;
        x = next;
        let magnitude_sq = x * x + y * y;
        if magnitude_sq > bailout_sq {
            return (smooth_count(step, magnitude_sq), step);
        }
    }
    (f64::NAN, maxiter)
}

#[test]
#[ignore = "probe"]
fn three_ways_on_a_shallow_grid() {
    let limbs = 5;
    let maxiter = 4000u32;
    let centre = (-0.5f64, 0.0f64);
    let c_re = Fx::parse("-0.5", limbs).unwrap();
    let c_im = Fx::zero(limbs);
    let orbit = reference::orbit(&c_re, &c_im, maxiter, None);
    let kernel = Kernel::new(&orbit, maxiter, false);

    let mut rows: Vec<(f64, f64, f64, f64, f64, f64)> = Vec::new();
    for row in 0..61 {
        for col in 0..61 {
            let dx = (col as f64 - 30.0) * 0.04;
            let dy = (row as f64 - 30.0) * 0.04;
            let ours = kernel.sample(dx, dy).smooth;
            let (truth, _) = oracle(
                &c_re.add(&Fx::from_f64(dx, limbs).unwrap()),
                &c_im.add(&Fx::from_f64(dy, limbs).unwrap()),
                maxiter,
            );
            let (theirs, _) = plain(centre.0 + dx, centre.1 + dy, maxiter);
            if truth.is_nan() {
                continue;
            }
            rows.push((
                dx,
                dy,
                ours,
                truth,
                theirs,
                (ours - truth).abs(),
            ));
        }
    }
    rows.sort_by(|a, b| b.5.partial_cmp(&a.5).unwrap());
    let escaping = rows.len();
    let exact = rows.iter().filter(|r| r.5 == 0.0).count();
    let close = rows.iter().filter(|r| r.5 < 1e-6).count();
    println!(
        "{escaping} escaping samples: {exact} bit-equal to the oracle, {close} within 1e-6"
    );
    println!("worst ten, perturbation vs oracle vs plain f64:");
    for row in rows.iter().take(10) {
        println!(
            "  dc ({:+.4}, {:+.4})  perturb {:>12.4}  oracle {:>12.4}  plain {:>12.4}  |p-o| {:.3e}  |f-o| {:.3e}",
            row.0,
            row.1,
            row.2,
            row.3,
            row.4,
            row.5,
            (row.4 - row.3).abs()
        );
    }
    let perturb_worse = rows
        .iter()
        .filter(|r| r.5 > (r.4 - r.3).abs())
        .count();
    println!(
        "perturbation further from the oracle than plain f64 on {perturb_worse} of {escaping}"
    );
}

/// Where the interior switch should fire: catch rate and safety against the
/// threshold, on the audit's anchor frame.
///
/// The frame is 38.9% interior at a cap of 48,551, and only about seventeen
/// periods of the minibrot fit inside that cap — so how far `|dz|²` has had time
/// to fall is the whole question, and a threshold picked for elegance rather
/// than measured is a threshold that catches nothing.
#[test]
#[ignore = "probe"]
fn where_the_interior_switch_should_fire() {
    let spec = perturb::Spec {
        center_re: "-0.74501772828532335842941892835857434".to_string(),
        center_im: "0.14993443275456819177805709088257971".to_string(),
        width: 2e-11,
        resolution: [96, 54],
        supersample: 1,
        maxiter: None,
        reference: None,
        period: None,
        julia: None,
        anchor: Anchor::Parameter,
        interior: true,
        bla: None,
    };
    let maxiter = spec.maxiter();
    let orbit = spec.reference_orbit().unwrap();
    let off = Kernel::new(&orbit, maxiter, false);

    // The truth, once.
    let mut truth = Vec::new();
    let mut without = 0u64;
    for row in 0..spec.resolution[1] {
        for col in 0..spec.resolution[0] {
            let (dx, dy) = spec.dc((0.0, 0.0), col, row);
            let outcome = off.sample(dx, dy);
            without += outcome.iterations as u64;
            truth.push(outcome.smooth);
        }
    }
    let inside = truth.iter().filter(|v| v.is_nan()).count();
    println!(
        "anchor 96x54, cap {maxiter}: {inside} of {} interior",
        truth.len()
    );
    println!("| floor | caught | wrongly painted | iterations saved |");
    println!("|--:|--:|--:|--:|");
    for floor in [-300i32, -200, -160, -120, -100, -80, -64, -48, -32, -24, -16, -12, -8, -4] {
        let on = Kernel::new(&orbit, maxiter, true).at_floor(floor);
        let (mut caught, mut wrong) = (0u32, 0u32);
        let mut with = 0u64;
        let mut index = 0usize;
        for row in 0..spec.resolution[1] {
            for col in 0..spec.resolution[0] {
                let (dx, dy) = spec.dc((0.0, 0.0), col, row);
                let outcome = on.sample(dx, dy);
                with += outcome.iterations as u64;
                if truth[index].is_nan() {
                    if outcome.detected_interior {
                        caught += 1;
                    }
                } else if outcome.smooth.is_nan() {
                    wrong += 1;
                }
                index += 1;
            }
        }
        println!(
            "| {floor} | {caught} | {wrong} | {:.1}% |",
            100.0 * (1.0 - with as f64 / without as f64)
        );
    }
}

/// The committed cases' own view, three ways: is the kernel or the plain loop
/// the one that is wrong where they differ?
#[test]
#[ignore = "probe"]
fn three_ways_on_the_committed_cases_view() {
    let centre_re = "-0.743643887037158704752191506114774";
    let centre_im = "0.131825904205311970493132056385139";
    let width = 0.02f64;
    let resolution = [20u32, 20u32];
    let spec = perturb::Spec {
        center_re: centre_re.to_string(),
        center_im: centre_im.to_string(),
        width,
        resolution,
        supersample: 1,
        maxiter: None,
        reference: None,
        period: None,
        julia: None,
        anchor: Anchor::Parameter,
        interior: false,
        bla: None,
    };
    let maxiter = spec.maxiter();
    let limbs = 6;
    let c_re = Fx::parse(centre_re, limbs).unwrap();
    let c_im = Fx::parse(centre_im, limbs).unwrap();
    let orbit = reference::orbit(&c_re, &c_im, maxiter, None);
    let kernel = Kernel::new(&orbit, maxiter, false);
    let centre = (
        centre_re.parse::<f64>().unwrap(),
        centre_im.parse::<f64>().unwrap(),
    );

    let (mut escaping, mut perturb_wins, mut plain_wins, mut tie) = (0, 0, 0, 0);
    let mut worst = Vec::new();
    for row in 0..resolution[1] {
        for col in 0..resolution[0] {
            let (dx, dy) = spec.dc((0.0, 0.0), col, row);
            let ours = kernel.sample(dx, dy).smooth;
            let (truth, _) = oracle(
                &c_re.add(&Fx::from_f64(dx, limbs).unwrap()),
                &c_im.add(&Fx::from_f64(dy, limbs).unwrap()),
                maxiter,
            );
            let (theirs, _) = plain(centre.0 + dx, centre.1 + dy, maxiter);
            if truth.is_nan() {
                continue;
            }
            escaping += 1;
            let ours_off = (ours - truth).abs();
            let plain_off = (theirs - truth).abs();
            if ours_off < plain_off {
                perturb_wins += 1;
            } else if plain_off < ours_off {
                plain_wins += 1;
            } else {
                tie += 1;
            }
            if ours_off > 1e-6 {
                worst.push((dx, dy, ours, truth, theirs));
            }
        }
    }
    println!(
        "{escaping} escaping: perturbation nearer the oracle on {perturb_wins}, plain f64 nearer on {plain_wins}, equal on {tie}"
    );
    println!("the {} samples where perturbation is past 1e-6:", worst.len());
    for (dx, dy, ours, truth, theirs) in worst.iter().take(24) {
        println!(
            "  dc ({dx:+.6}, {dy:+.6})  perturb {ours:>11.3}  oracle {truth:>11.3}  plain {theirs:>11.3}"
        );
    }
}

/// `c = i` is a Misiurewicz point — exactly representable, on the boundary, and
/// the set is asymptotically self-similar about it, so a frame of any width
/// straddles real structure. Unlike a nucleus, where everything below the atom
/// size is flat interior.
#[test]
#[ignore = "probe"]
fn what_a_misiurewicz_ladder_looks_like() {
    for width in [1e-4_f64, 1e-8, 1e-13, 1e-19, 1e-28] {
        let limbs = reference::limbs_for(width, 16);
        let maxiter = perturb::cap::for_width(width);
        let c_re = Fx::zero(limbs);
        let c_im = Fx::parse("1", limbs).unwrap();
        let orbit = reference::orbit(&c_re, &c_im, maxiter, None);
        let kernel = Kernel::new(&orbit, maxiter, false);
        let (mut inside, mut escaped, mut worst_step) = (0u32, 0u32, 0u32);
        for row in 0..16 {
            for col in 0..16 {
                let dx = ((col as f64 + 0.5) / 16.0 - 0.5) * width;
                let dy = (0.5 - (row as f64 + 0.5) / 16.0) * width;
                let outcome = kernel.sample(dx, dy);
                if outcome.smooth.is_nan() {
                    inside += 1;
                } else {
                    escaped += 1;
                    worst_step = worst_step.max(outcome.iterations);
                }
            }
        }
        println!(
            "width {width:e}: reference {} points, cap {maxiter}, {escaped} escaped / {inside} interior, deepest escape {worst_step}",
            orbit.len()
        );
    }
}

/// **Which of the three is right where the Julia kernel and the oracle part.**
///
/// The deep-`c` Julia ladder in `tests/oracle.rs` has a handful of samples that
/// the kernel runs to the cap and the oracle escapes from thousands of
/// iterations earlier. That is either a defect in the delta recurrence or the
/// same chaos this file already pinned on the Mandelbrot side, and the way to
/// tell them apart is a third opinion: a plain `f64` Julia loop, at a width
/// where `f64` is still honest — 2e-9 across sixteen samples is a million
/// representable numbers to a pixel.
///
/// If the kernel were wrong, the plain loop would sit with the oracle and the
/// kernel would be the outlier on every hard sample.
#[test]
#[ignore = "probe"]
fn three_ways_on_a_deep_julia_frame() {
    let limbs = 3;
    let width = 2e-9f64;
    let (c_re_text, c_im_text) = (
        "-0.74501772828532335842941892835857434",
        "0.14993443275456819177805709088257971",
    );
    let c_re = Fx::parse(c_re_text, limbs).unwrap();
    let c_im = Fx::parse(c_im_text, limbs).unwrap();
    let maxiter = perturb::cap::for_width(width);
    // A Julia frame's reference is the critical orbit of its own parameter.
    let orbit = reference::orbit(&c_re, &c_im, maxiter + 1, None);
    let kernel = Kernel::new(&orbit, maxiter, false).at_entry(1);
    let (c_re_f64, c_im_f64) = (c_re.to_f64(), c_im.to_f64());

    let mut rows: Vec<(f64, f64, f64, f64, f64, f64)> = Vec::new();
    let (mut kernel_nearer, mut plain_nearer) = (0, 0);
    for row in 0..16 {
        for col in 0..16 {
            let dx = ((col as f64 + 0.5) / 16.0 - 0.5) * width;
            let dy = (0.5 - (row as f64 + 0.5) / 16.0) * (width * 9.0 / 16.0);
            let ours = kernel.sample_julia(dx, dy).smooth;
            // `z₀` for the oracle and the plain loop: the anchor plus the same
            // geometry, in fixed point and in `f64` respectively.
            let (truth, _) = julia_oracle(
                &c_re.add(&Fx::from_f64(dx, limbs).unwrap()),
                &c_im.add(&Fx::from_f64(dy, limbs).unwrap()),
                &c_re,
                &c_im,
                maxiter,
            );
            let theirs = plain_julia(c_re_f64 + dx, c_im_f64 + dy, c_re_f64, c_im_f64, maxiter);
            // A cap on one side and an escape on the other is a disagreement of
            // at least the distance to the cap, which is what makes it
            // comparable with a count difference.
            let gap = |value: f64| {
                if value.is_nan() != truth.is_nan() {
                    (maxiter as f64 - truth.min(maxiter as f64)).max(1.0)
                } else if truth.is_nan() {
                    0.0
                } else {
                    (value - truth).abs()
                }
            };
            let (ours_gap, theirs_gap) = (gap(ours), gap(theirs));
            if ours_gap < theirs_gap {
                kernel_nearer += 1;
            } else if theirs_gap < ours_gap {
                plain_nearer += 1;
            }
            rows.push((dx, dy, ours, truth, theirs, ours_gap));
        }
    }
    rows.sort_by(|a, b| b.5.partial_cmp(&a.5).unwrap());
    println!("julia at the audit's c, width {width:e}, cap {maxiter}");
    println!("worst ten, perturbation vs oracle vs plain f64:");
    for row in rows.iter().take(10) {
        println!(
            "  z-c ({:+.3e}, {:+.3e})  perturb {:>12.2}  oracle {:>12.2}  plain {:>12.2}",
            row.0, row.1, row.2, row.3, row.4
        );
    }
    println!(
        "nearer the oracle: kernel on {kernel_nearer}, plain f64 on {plain_nearer}, of {} samples",
        rows.len()
    );
}

fn julia_oracle(x0: &Fx, y0: &Fx, c_re: &Fx, c_im: &Fx, maxiter: u32) -> (f64, u32) {
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
            return (smooth_count(step, magnitude_sq), step);
        }
    }
    (f64::NAN, maxiter)
}

fn plain_julia(z_re: f64, z_im: f64, c_re: f64, c_im: f64, maxiter: u32) -> f64 {
    let bailout_sq = BAILOUT * BAILOUT;
    let (mut x, mut y) = (z_re, z_im);
    for step in 1..=maxiter {
        let next = x * x - y * y + c_re;
        y = 2.0 * x * y + c_im;
        x = next;
        let magnitude_sq = x * x + y * y;
        if magnitude_sq > bailout_sq {
            return smooth_count(step, magnitude_sq);
        }
    }
    f64::NAN
}
