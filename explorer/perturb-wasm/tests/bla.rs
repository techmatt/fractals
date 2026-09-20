//! The skip table against the loop it stands for.
//!
//! Two kernels, one spec, one orbit — `tests/oracle.rs`'s shape, with the plain
//! loop in the oracle's place. That is the only comparison available: a skip
//! changes how long a sample takes and, where it is wrong, what the sample says,
//! and **only `smooth` crosses the wasm boundary** — `iterations`, `rebases` and
//! the skip counters do not, so no harness on the page can see any of this.
//!
//! **Ignored by default**, and run with:
//!
//! ```text
//! cargo test --release --test bla -- --ignored --nocapture
//! ```
//!
//! The two tests that are not ignored are the cheap ones, and they are the two
//! that assert rather than report: that a band is still bit for bit the rows a
//! whole-frame pass would produce **with the knob on**, and that at the tightest
//! tolerance the skip decides what the plain loop decides.

use perturb::bla::{self, Table};
use perturb::kernel::Kernel;
use perturb::reference::Reference;
use perturb::{Anchor, Spec, cap};
use std::time::Instant;

/// The audit's anchor: a period-2838 minibrot nucleus in the seahorse valley.
const ANCHOR_RE: &str = "-0.74501772828532335842941892835857434";
const ANCHOR_IM: &str = "0.14993443275456819177805709088257971";

/// The tolerances swept.
///
/// `2^-53` is the smallest that means anything — below it the dropped term is
/// asked to be under the last bit of the term beside it. The top two are an
/// **adjustment the first run asked for**: at the anchor's own width no skip
/// fires at all below about `1e-9`, because a merged radius has to clear
/// `|B|·dcmax` and `dcmax` there is `1.1e-11` rather than the `1e-28` a deep
/// frame has, so the interesting range at a wide frame is above `1e-6` and not
/// below it.
const EPSILONS: &[f64] = &[1.1102230246251565e-16, 1e-12, 1e-9, 1e-6, 1e-4, 1e-3];

/// Samples a frame, in the sweep. Small enough that the whole thing is minutes
/// and large enough that a p99 over the escaping samples means something.
const TILE: (u32, u32) = (64, 36);

fn mandelbrot(width: f64) -> Spec {
    Spec {
        center_re: ANCHOR_RE.to_string(),
        center_im: ANCHOR_IM.to_string(),
        width,
        resolution: [TILE.0, TILE.1],
        supersample: 1,
        maxiter: None,
        reference: None,
        period: None,
        julia: None,
        anchor: Anchor::Parameter,
        interior: false,
        bla: None,
    }
}

/// The Julia set of the anchor's own `c`, at `z = c` — the link
/// `explorer/README.md` carries, **at the policy cap** rather than at the 8,000
/// that link pins by hand. 40,578 against 8,000 is a fivefold difference in what
/// a skip has to work with, and pricing the link's own cap would have priced a
/// frame nothing else in this crate is measured at.
fn julia(width: f64) -> Spec {
    Spec {
        center_re: ANCHOR_RE.to_string(),
        center_im: ANCHOR_IM.to_string(),
        width,
        resolution: [TILE.0, TILE.1],
        supersample: 1,
        maxiter: None,
        reference: None,
        period: None,
        julia: Some((ANCHOR_RE.to_string(), ANCHOR_IM.to_string())),
        anchor: Anchor::Parameter,
        interior: false,
        bla: None,
    }
}

/// The frames the sweep walks: the two the tab actually opens, then the anchor
/// ladder's own deeper rungs out to the deepest that runs in the time this has.
fn frames() -> Vec<(String, Spec)> {
    let mut out = vec![
        ("mandelbrot 2e-11".to_string(), mandelbrot(2e-11)),
        ("julia 2e-9".to_string(), julia(2e-9)),
        // The deepest frame either ladder carries that still has exterior in it,
        // and the reason it is here: every Mandelbrot rung below 6.5e-12 is
        // inside the minibrot's own body and 100% interior, so the columns that
        // say whether the skip *moved* anything have nothing to read on them.
        ("julia 2e-10".to_string(), julia(2e-10)),
    ];
    for width in [1e-16f64, 1e-19, 1e-22, 1e-28] {
        out.push((format!("mandelbrot {width:e}"), mandelbrot(width)));
    }
    out
}

/// What one walk of a frame came to.
struct Walk {
    smooth: Vec<f64>,
    iterations: Vec<u32>,
    total_iterations: u64,
    skipped: u64,
    skips: u64,
    interior: usize,
    seconds: f64,
}

impl Walk {
    fn mean_iterations(&self) -> f64 {
        self.total_iterations as f64 / self.smooth.len() as f64
    }
}

fn walk(spec: &Spec, orbit: &Reference, interior: bool, table: Option<&Table>) -> Walk {
    let mut kernel = Kernel::new(orbit, spec.maxiter(), interior).at_entry(spec.entry());
    if let Some(table) = table {
        kernel = kernel.with_bla(table);
    }
    match (spec.julia.is_some(), table.is_some()) {
        (false, false) => walk_with::<false, false>(spec, &kernel),
        (false, true) => walk_with::<false, true>(spec, &kernel),
        (true, false) => walk_with::<true, false>(spec, &kernel),
        (true, true) => walk_with::<true, true>(spec, &kernel),
    }
}

fn walk_with<const JULIA: bool, const BLA: bool>(spec: &Spec, kernel: &Kernel) -> Walk {
    let offset = spec.centre_offset().unwrap();
    let count = (spec.resolution[0] * spec.resolution[1]) as usize;
    let mut smooth = Vec::with_capacity(count);
    let mut iterations = Vec::with_capacity(count);
    let (mut total, mut skipped, mut skips, mut interior) = (0u64, 0u64, 0u64, 0usize);

    let at = Instant::now();
    for row in 0..spec.resolution[1] {
        for col in 0..spec.resolution[0] {
            let (re, im) = spec.dc(offset, col, row);
            let outcome = kernel.sample_with::<JULIA, BLA>(re, im);
            smooth.push(outcome.smooth);
            iterations.push(outcome.iterations);
            total += outcome.iterations as u64;
            skipped += outcome.skipped as u64;
            skips += outcome.skips as u64;
            interior += outcome.smooth.is_nan() as usize;
        }
    }
    let seconds = at.elapsed().as_secs_f64();
    Walk {
        smooth,
        iterations,
        total_iterations: total,
        skipped,
        skips,
        interior,
        seconds,
    }
}

/// What the skip did to the picture, against the plain walk of the same frame.
struct Difference {
    to_interior: usize,
    to_escaping: usize,
    count_mismatches: usize,
    compared: usize,
    median: f64,
    p99: f64,
    worst: f64,
    median_relative: f64,
    p99_relative: f64,
    worst_relative: f64,
}

fn difference(plain: &Walk, skip: &Walk) -> Difference {
    let (mut to_interior, mut to_escaping, mut mismatches) = (0, 0, 0);
    let mut absolute: Vec<f64> = Vec::new();
    let mut relative: Vec<f64> = Vec::new();
    for index in 0..plain.smooth.len() {
        let (a, b) = (plain.smooth[index], skip.smooth[index]);
        match (a.is_nan(), b.is_nan()) {
            (false, true) => to_interior += 1,
            (true, false) => to_escaping += 1,
            (true, true) => {}
            (false, false) => {
                if plain.iterations[index] != skip.iterations[index] {
                    mismatches += 1;
                }
                let error = (a - b).abs();
                absolute.push(error);
                relative.push(error / a.abs().max(1.0));
            }
        }
    }
    let at = |sorted: &[f64], share: f64| -> f64 {
        if sorted.is_empty() {
            return 0.0;
        }
        sorted[(((sorted.len() - 1) as f64) * share).round() as usize]
    };
    absolute.sort_by(|a, b| a.partial_cmp(b).unwrap());
    relative.sort_by(|a, b| a.partial_cmp(b).unwrap());
    Difference {
        to_interior,
        to_escaping,
        count_mismatches: mismatches,
        compared: absolute.len(),
        median: at(&absolute, 0.5),
        p99: at(&absolute, 0.99),
        worst: absolute.last().copied().unwrap_or(0.0),
        median_relative: at(&relative, 0.5),
        p99_relative: at(&relative, 0.99),
        worst_relative: relative.last().copied().unwrap_or(0.0),
    }
}

// ------------------------------------------------------------------ the sweep

/// **The differential.** Every frame, every tolerance, the interior switch both
/// ways: what the skip buys and what it costs.
#[test]
#[ignore = "minutes: every frame walked once a tolerance, twice, both ways"]
fn what_the_skip_buys_and_what_it_costs() {
    println!(
        "\n| frame | cap | switch | ε | speedup | skipped | mean run | mean iterations | interior | → interior | → escaping | count Δ | median Δ | p99 Δ | worst Δ | median Δ/ν | p99 Δ/ν |"
    );
    println!("|---|--:|:--|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|");
    for (label, spec) in frames() {
        let orbit = spec.reference_orbit().unwrap();
        let dc_bound = spec.dc_bound();
        for interior in [false, true] {
            let switch = if interior { "on" } else { "off" };
            let mut plain_seconds = f64::INFINITY;
            let mut best: Vec<(f64, Walk, Table)> = Vec::new();
            let mut plain: Option<Walk> = None;
            // Alternated, so a box that drifts drifts through both sides.
            for pass in 0..2 {
                let run = walk(&spec, &orbit, interior, None);
                plain_seconds = plain_seconds.min(run.seconds);
                if pass == 0 {
                    plain = Some(run);
                }
                for (index, &epsilon) in EPSILONS.iter().enumerate() {
                    let table =
                        Table::build(&orbit, epsilon, dc_bound, bla::MIN_LEVEL).unwrap();
                    let run = walk(&spec, &orbit, interior, Some(&table));
                    if pass == 0 {
                        best.push((run.seconds, run, table));
                    } else {
                        best[index].0 = best[index].0.min(run.seconds);
                    }
                }
            }
            let plain = plain.unwrap();
            for (index, &epsilon) in EPSILONS.iter().enumerate() {
                let (seconds, run, _) = &best[index];
                let how = difference(&plain, run);
                println!(
                    "| {label} | {} | {switch} | {epsilon:.1e} | **{:.2}×** | {:.1}% | {:.0} | {:.0} | {:.1}% | {} | {} | {} | {:.2e} | {:.2e} | {:.2e} | {:.1e} | {:.1e} |",
                    spec.maxiter(),
                    plain_seconds / seconds,
                    100.0 * run.skipped as f64 / run.total_iterations.max(1) as f64,
                    run.skipped as f64 / run.skips.max(1) as f64,
                    plain.mean_iterations(),
                    100.0 * plain.interior as f64 / plain.smooth.len() as f64,
                    how.to_interior,
                    how.to_escaping,
                    how.count_mismatches,
                    how.median,
                    how.p99,
                    how.worst,
                    how.median_relative,
                    how.p99_relative,
                );
                let _ = how.worst_relative;
                let _ = how.compared;
            }
        }
    }
}

/// **What the interior switch is worth, with the skip and without it.** The
/// audit found it a net loss at the anchor; a skip changes the arithmetic it is
/// competing against, so the question has to be asked again beside the table
/// rather than inherited from the run that answered it without one.
#[test]
#[ignore = "minutes"]
fn what_the_interior_switch_is_worth_beside_the_skip() {
    println!("\n| frame | cap | interior | plain: off → on | skip at 1e-6: off → on | wrongly painted |");
    println!("|---|--:|--:|--:|--:|--:|");
    for (label, spec) in frames() {
        let orbit = spec.reference_orbit().unwrap();
        let table = Table::build(&orbit, 1e-6, spec.dc_bound(), bla::MIN_LEVEL).unwrap();
        let plain_off = walk(&spec, &orbit, false, None);
        let plain_on = walk(&spec, &orbit, true, None);
        let skip_off = walk(&spec, &orbit, false, Some(&table));
        let skip_on = walk(&spec, &orbit, true, Some(&table));
        let wrong = (0..plain_off.smooth.len())
            .filter(|&i| !plain_off.smooth[i].is_nan() && skip_on.smooth[i].is_nan())
            .count();
        println!(
            "| {label} | {} | {:.1}% | {:.0} → {:.0} ms ({:+.0}%) | {:.0} → {:.0} ms ({:+.0}%) | {wrong} |",
            spec.maxiter(),
            100.0 * plain_off.interior as f64 / plain_off.smooth.len() as f64,
            1e3 * plain_off.seconds,
            1e3 * plain_on.seconds,
            100.0 * (plain_on.seconds / plain_off.seconds - 1.0),
            1e3 * skip_off.seconds,
            1e3 * skip_on.seconds,
            100.0 * (skip_on.seconds / skip_off.seconds - 1.0),
        );
    }
}

/// What a table costs to build and to hold, at the two caps the policy's ends
/// produce, for a few minimum levels.
#[test]
#[ignore = "seconds"]
fn what_the_table_costs() {
    println!("\n| cap | orbit points | min level | levels | entries | bytes | vs the orbit | build |");
    println!("|--:|--:|--:|--:|--:|--:|--:|--:|");
    for cap in [48_551u32, 1_000_000] {
        let mut spec = mandelbrot(2e-11);
        spec.maxiter = Some(cap);
        let orbit = spec.reference_orbit().unwrap();
        let orbit_bytes = perturb::REFERENCE_HEADER + 16 * orbit.len();
        for min_level in [0u32, 2, 4, 6, 8] {
            let at = Instant::now();
            let table = Table::build(&orbit, 1e-6, spec.dc_bound(), min_level).unwrap();
            let took = at.elapsed().as_secs_f64();
            println!(
                "| {cap} | {} | {min_level} | {}–{} | {} | {} | {:.2}× | {:.1} ms |",
                orbit.len(),
                table.min_level(),
                table.max_level(),
                table.entries(),
                table.bytes(),
                table.bytes() as f64 / orbit_bytes as f64,
                1e3 * took,
            );
        }
    }
}

/// Which levels actually fire, which is what says whether a minimum level costs
/// anything.
#[test]
#[ignore = "seconds"]
fn which_runs_the_table_actually_gives() {
    println!("\n| frame | ε | longest run offered | runs taken | mean run | share skipped |");
    println!("|---|--:|--:|--:|--:|--:|");
    for (label, spec) in frames() {
        let orbit = spec.reference_orbit().unwrap();
        for &epsilon in EPSILONS {
            let table = Table::build(&orbit, epsilon, spec.dc_bound(), bla::MIN_LEVEL).unwrap();
            let mut longest = 0u32;
            for m in 1..orbit.len().min(20_000) {
                if let Some((_, run)) = table.lookup(m, 0.0, u32::MAX, None) {
                    longest = longest.max(run);
                }
            }
            let run = walk(&spec, &orbit, false, Some(&table));
            println!(
                "| {label} | {epsilon:.1e} | {longest} | {} | {:.0} | {:.1}% |",
                run.skips,
                run.skipped as f64 / run.skips.max(1) as f64,
                100.0 * run.skipped as f64 / run.total_iterations.max(1) as f64,
            );
        }
    }
}

// ------------------------------------------------------------------- the pins

/// **The band-assembly pin, with the knob on.**
///
/// `explorer/deep.test.mjs` holds three bands of the shipped frame to being byte
/// for byte the whole frame — *"a cut moved the arithmetic, which it must not"*.
/// This is that assertion asked of the one thing in this crate that could
/// plausibly break it: a skip whose run length depended on where a band started
/// would fail here and nowhere else, because every sample of the band would
/// still be a plausible number.
#[test]
fn a_band_is_still_the_rows_a_whole_frame_would_have_drawn_with_the_skip_on() {
    for width in [2e-11f64, 1e-19] {
        let mut spec = mandelbrot(width);
        spec.resolution = [24, 18];
        spec.maxiter = Some(4_000);
        spec.bla = Some(1e-6);
        let orbit = spec.reference_orbit().unwrap();
        assert!(spec.bla_table(&orbit).is_some(), "no table at {width:e}");

        let whole = perturb::compute_rows(&spec, &orbit, 0, 18);
        let mut cut = Vec::new();
        for (first, last) in [(0u32, 5u32), (5, 13), (13, 18)] {
            cut.extend_from_slice(&perturb::compute_rows(&spec, &orbit, first, last));
        }
        assert_eq!(whole, cut, "a cut moved the arithmetic at {width:e}");
        // And the skip did something, or this pin is pinning the plain loop.
        let kernel = Kernel::new(&orbit, spec.maxiter(), spec.interior);
        let table = spec.bla_table(&orbit).unwrap();
        let kernel = kernel.with_bla(&table);
        let offset = spec.centre_offset().unwrap();
        let (re, im) = spec.dc(offset, 3, 3);
        assert!(
            kernel.sample(re, im).skips > 0,
            "no sample skipped at {width:e}"
        );
    }
}

/// The knob is off unless a spec says otherwise, and a spec that says so is read.
#[test]
fn the_knob_is_off_by_default_and_reads_when_it_is_named() {
    let plain = r#"{"schema":1,"center_re":"0","center_im":"0","width":1.0}"#;
    assert_eq!(Spec::parse(plain).unwrap().bla, None);
    let named = r#"{"schema":1,"center_re":"0","center_im":"0","width":1.0,"bla":1e-6}"#;
    assert_eq!(Spec::parse(named).unwrap().bla, Some(1e-6));
    let nulled = r#"{"schema":1,"center_re":"0","center_im":"0","width":1.0,"bla":null}"#;
    assert_eq!(Spec::parse(nulled).unwrap().bla, None);
    let wrong = r#"{"schema":1,"center_re":"0","center_im":"0","width":1.0,"bla":0}"#;
    assert!(Spec::parse(wrong).unwrap_err().contains("tolerance"));
}

/// A Julia frame's `dc` is identically zero, so the `B` half of the recurrence
/// is structurally absent and the table's own `dc` bound is zero.
#[test]
fn a_julia_frames_dc_bound_is_zero_and_a_mandelbrot_frames_is_the_frame() {
    let spec = mandelbrot(2e-11);
    let bound = spec.dc_bound();
    assert!(bound > 0.5 * spec.width && bound < spec.width, "{bound:e}");
    assert_eq!(julia(2e-9).dc_bound(), 0.0);
}

/// **At the tightest tolerance the skip decides what the plain loop decides.**
///
/// `2^-53` asks the dropped quadratic term to be under the last bit of the term
/// beside it, which is as near to "not an approximation" as an approximation
/// gets. The bar here is the interior mask, exactly — the one thing the crate
/// has ever refused to let an approximation move — and the median relative error
/// on what escapes.
#[test]
fn at_the_tightest_tolerance_the_skip_decides_what_the_plain_loop_decides() {
    // The Julia frame, because it is the one of the two the tab opens that has
    // escaping samples *and* fires a skip at this tolerance: at the anchor's own
    // width `2^-53` never answers, which the sweep's own table says and this
    // test would otherwise silently assert nothing about.
    let mut spec = julia(2e-9);
    spec.resolution = [32, 18];
    let orbit = spec.reference_orbit().unwrap();
    let table = Table::build(&orbit, EPSILONS[0], spec.dc_bound(), bla::MIN_LEVEL).unwrap();
    for interior in [false, true] {
        let plain = walk(&spec, &orbit, interior, None);
        let skip = walk(&spec, &orbit, interior, Some(&table));
        let how = difference(&plain, &skip);
        println!(
            "interior={interior}: {} escaping compared, {} → interior, {} → escaping, \
             {} counts moved, median Δ/ν {:e}, worst Δ {:e}, {:.1}% of iterations skipped",
            how.compared,
            how.to_interior,
            how.to_escaping,
            how.count_mismatches,
            how.median_relative,
            how.worst,
            100.0 * skip.skipped as f64 / skip.total_iterations as f64,
        );
        assert!(skip.skips > 0, "the table never answered");
        assert_eq!(how.to_interior, 0, "the skip painted an escaping sample interior");
        assert_eq!(how.to_escaping, 0, "the skip let an interior sample escape");
        assert!(
            how.median_relative < 1e-9,
            "median relative error {:e}",
            how.median_relative
        );
    }
}

/// The policy caps the sweep quotes, so a reader of the table can check them.
#[test]
fn the_frames_are_at_the_policy_cap() {
    assert_eq!(cap::for_width(2e-11), 48_551);
    assert_eq!(cap::for_width(2e-9), 40_578);
    assert_eq!(cap::for_width(1e-28), 117_518);
    assert_eq!(julia(2e-9).maxiter(), 40_578);
}
