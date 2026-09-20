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
    /// Of those, the ones the interior switch **proved** bounded rather than the
    /// ones the cap gave up on. Zero with the switch off, where the two are not
    /// distinguishable and every unresolved sample is only unresolved.
    detected: usize,
    /// `NaN`, not proven, and out of iterations: the frame is cap-starved here,
    /// and a deeper cap would move these samples rather than confirm them.
    capped: usize,
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
    let (mut detected, mut capped) = (0usize, 0usize);

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
            if outcome.smooth.is_nan() {
                if outcome.detected_interior {
                    detected += 1;
                } else {
                    capped += 1;
                }
            }
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
        detected,
        capped,
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

// -------------------------------------------------- the frames that have something in them

/// **Deep frames with escaping structure in them**, which is the one thing the
/// ladder above does not have: every anchor rung below the minibrot's 6.5e-12
/// atom is inside its body and 100% interior, so the columns that say whether
/// the skip *moved* anything have nothing to read on them.
///
/// Found by `tests/descend.rs` — a descent from the anchor's own minibrot at
/// 1e-11, recentring each rung on the busiest boundary neighbourhood a 64×64
/// tile offers and shrinking the width tenfold, with the centre carried as an
/// exact decimal the whole way. Each is `(label, centre re, centre im, width,
/// cap)`, the cap being the policy's at that width, and each is given as a
/// `dv` link in `README.md`.
///
/// **The centres are trimmed to what a link can spell** — the width's decade
/// and eight digits more — and the trimmed frame is the one measured, so the
/// number in a table and the picture behind a link are the same frame.
const DEEP_FRAMES: &[(&str, &str, &str, f64, u32)] = &[
    (
        "tangle 1e-22",
        "-0.745017728290198619298817365858",
        "0.149934432756897045833502403382",
        1e-22,
        93_600,
    ),
    (
        "tangle 1e-28",
        "-0.74501772829019861929877929889763684",
        "0.14993443275689704583350282968726721",
        1e-28,
        117_518,
    ),
    (
        "tangle 1e-40",
        "-0.7450177282901986192987792989188510315333046875",
        "0.1499344327568970458335028296517884911675546875",
        1e-40,
        165_354,
    ),
    (
        "pinch 1e-28",
        "-0.74501772828897655304632685480388684",
        "0.14993443275858764694789167606226721",
        1e-28,
        117_518,
    ),
    // **The deepest frame a link can spell.** Not the deepest the crate draws —
    // a rung costs about five seconds a tile here and the descent was still
    // going down — but the deepest whose centre fits the 64 characters
    // `explorer/deep-link.js` caps a coordinate at, with the eight guard digits
    // that put the truncation well under a pixel. It is 63.
    (
        "tangle 1e-54",
        "-0.745017728290198619298779298918851031533262270733325571484375",
        "0.149934432756897045833502829651788491167588360989048041953125",
        1e-54,
        221_162,
    ),
];

/// The tolerances the deep sweep walks: the shipped recommendation, the
/// tightest tolerance that means anything, and the one decade above.
const DEEP_EPSILONS: &[f64] = &[1.1102230246251565e-16, 1e-12, 1e-9];

/// Finer than 1e-12, for the frames where 1e-12 moves something.
const FINER: &[f64] = &[
    1e-12,
    3e-13,
    1e-13,
    3e-14,
    1e-14,
    3e-15,
    1e-15,
    3e-16,
    1.1102230246251565e-16,
];

/// The fine pass's sample lanes: 908×512 at two samples a side, the canvas
/// `explorer/README.md`'s cost table was taken on.
const FINE_LANES: f64 = 1_859_584.0;
/// Wasm against native on this kernel, `README.md` §4.
const WASM_OVER_NATIVE: f64 = 1.05;
/// The pool's effective parallelism, derived in `audit_perturb_bla_ckpt137`
/// from the anchor's own 62.7 s fine pass against its single-thread price.
const PARALLELISM: f64 = 4.7;

/// **What a person waits**, from what a sweep measures: the frame's own
/// sample-iterations at the frame's own price, in a browser, over the pool.
/// Nanoseconds a sample-iteration — the crate's own unit of price. Free
/// rather than a method on [`Walk`], because the seconds are the best of
/// several passes and the count is one walk's.
fn ns_per_iteration(seconds: f64, iterations: u64) -> f64 {
    1e9 * seconds / iterations.max(1) as f64
}

fn fine_pass_seconds(mean_iterations: f64, ns: f64) -> f64 {
    FINE_LANES * mean_iterations * ns * 1e-9 * WASM_OVER_NATIVE / PARALLELISM
}

fn deep(frame: &(&str, &str, &str, f64, u32), maxiter: Option<u32>) -> Spec {
    Spec {
        center_re: frame.1.to_string(),
        center_im: frame.2.to_string(),
        width: frame.3,
        resolution: [TILE.0, TILE.1],
        supersample: 1,
        maxiter,
        reference: None,
        period: None,
        julia: None,
        anchor: Anchor::Parameter,
        interior: false,
        bla: None,
    }
}

/// **What the box is worth today**, against the price `README.md` §4 committed.
///
/// The work held equal the way that section held it — the anchor at a cap no
/// sample escapes from, the switch off — so a run of this sweep says in its own
/// first line whether the machine under it is the machine the table was taken
/// on. A speedup is a ratio and survives a slow box; a nanosecond is not, and
/// every wait below is derived from one.
fn the_box_today() {
    /// `README.md` §4: perturbation, interior off, native.
    const COMMITTED_NS: f64 = 4.80;
    let mut spec = mandelbrot(2e-11);
    spec.maxiter = Some(1_200);
    let orbit = spec.reference_orbit().unwrap();
    let mut best = f64::INFINITY;
    let mut walked = None;
    for _ in 0..5 {
        let run = walk(&spec, &orbit, false, None);
        best = best.min(run.seconds);
        walked = Some(run.total_iterations);
    }
    let ns = ns_per_iteration(best, walked.unwrap());
    println!(
        "\nThe plain loop is **{ns:.2} ns a sample-iteration** today, against the {COMMITTED_NS:.2} \
         `README.md` §4 committed — {:+.0}%.\n",
        100.0 * (ns / COMMITTED_NS - 1.0)
    );
}

/// One frame's worth of the differential, as rows of the deep table.
fn measure(label: &str, spec: &Spec) {
    let orbit = spec.reference_orbit().unwrap();
    let dc_bound = spec.dc_bound();
    for interior in [false, true] {
        let switch = if interior { "on" } else { "off" };
        let mut plain_seconds = f64::INFINITY;
        let mut best: Vec<(f64, Walk)> = Vec::new();
        let mut plain: Option<Walk> = None;
        for pass in 0..2 {
            let run = walk(spec, &orbit, interior, None);
            plain_seconds = plain_seconds.min(run.seconds);
            if pass == 0 {
                plain = Some(run);
            }
            for (index, &epsilon) in DEEP_EPSILONS.iter().enumerate() {
                let table = Table::build(&orbit, epsilon, dc_bound, bla::MIN_LEVEL).unwrap();
                let run = walk(spec, &orbit, interior, Some(&table));
                if pass == 0 {
                    best.push((run.seconds, run));
                } else {
                    best[index].0 = best[index].0.min(run.seconds);
                }
            }
        }
        let plain = plain.unwrap();
        let count = plain.smooth.len() as f64;
        let plain_ns = ns_per_iteration(plain_seconds, plain.total_iterations);
        println!(
            "| {label} | {} | {switch} | plain | — | {:.1}% | {:.1}% | {:.1}% | {:.0} | {:.2} | — | {:.0} s | — | — | — | — |",
            spec.maxiter(),
            100.0 * (count - plain.interior as f64) / count,
            100.0 * plain.detected as f64 / count,
            100.0 * plain.capped as f64 / count,
            plain.mean_iterations(),
            plain_ns,
            fine_pass_seconds(plain.mean_iterations(), plain_ns),
        );
        for (index, &epsilon) in DEEP_EPSILONS.iter().enumerate() {
            let (seconds, run) = &best[index];
            let how = difference(&plain, run);
            let ns = ns_per_iteration(*seconds, run.total_iterations);
            println!(
                "| {label} | {} | {switch} | {epsilon:.1e} | **{:.2}×** | {:.1}% | {:.1}% | {:.1}% | {:.0} | {:.2} | {:.1}% | {:.0} s | {} | {} | {} | {:.2e} |",
                spec.maxiter(),
                plain_seconds / seconds,
                100.0 * (count - run.interior as f64) / count,
                100.0 * run.detected as f64 / count,
                100.0 * run.capped as f64 / count,
                run.mean_iterations(),
                ns,
                100.0 * run.skipped as f64 / run.total_iterations.max(1) as f64,
                fine_pass_seconds(run.mean_iterations(), ns),
                how.to_interior,
                how.to_escaping,
                how.count_mismatches,
                how.worst,
            );
        }
    }
}

/// **The differential, on frames that have escaping structure in them.**
///
/// The sweep above asked what the skip costs where the answer could only be a
/// price; this one asks what it costs where the answer can also be a wrong
/// picture. Every frame is walked plain and at three tolerances, the interior
/// switch both ways, alternated, best of two — and where a frame is cap-starved
/// it is walked again at twice the cap, because a sample that ran out of
/// iterations is a sample whose cost the policy is still deciding.
#[test]
#[ignore = "minutes: four deep frames, three tolerances, both ways, twice"]
fn what_the_skip_buys_on_a_frame_with_structure() {
    assert!(!DEEP_FRAMES.is_empty(), "no deep frames are committed yet");
    the_box_today();
    println!(
        "\n| frame | cap | switch | ε | speedup | escaped | proven interior | cap-starved | mean iterations | ns | skipped | fine pass | → interior | → escaping | count Δ | worst Δ |"
    );
    println!("|---|--:|:--|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|");
    for frame in DEEP_FRAMES {
        let spec = deep(frame, None);
        measure(frame.0, &spec);
        // Is it cap-starved? One cheap walk with the switch on says so: an
        // unresolved sample the switch did not prove is one the cap stopped.
        let orbit = spec.reference_orbit().unwrap();
        let probe = walk(&spec, &orbit, true, None);
        if probe.capped * 20 > probe.smooth.len() {
            let doubled = 2 * spec.maxiter();
            let label = format!("{} at 2× cap", frame.0);
            measure(&label, &deep(frame, Some(doubled)));
        }
    }
}

/// **What a deeper cap resolves**, which is the question the policy cap leaves
/// open on every one of these frames.
///
/// Not one of them has a single *proven* interior sample: the interior switch
/// needs `|dz|²` under `2^-64` and that takes many periods of whatever
/// component a sample is in, while at these depths the nearby periods are of
/// the same order as the cap itself. So the frame's unresolved share is not
/// interior — it is **cap-starved**, and this is what says by how much. A
/// smaller tile than the sweep's, because the deepest arm is eight times the
/// policy cap and the question is a share rather than a price.
#[test]
#[ignore = "minutes"]
fn what_a_deeper_cap_resolves_on_a_deep_frame() {
    println!("\n| frame | cap | escaped | proven interior | cap-starved | mean iterations |");
    println!("|---|--:|--:|--:|--:|--:|");
    for frame in DEEP_FRAMES {
        for multiple in [1u32, 2, 4, 8] {
            let mut spec = deep(frame, None);
            spec.resolution = [32, 18];
            spec.maxiter = Some(multiple * frame.4);
            let orbit = spec.reference_orbit().unwrap();
            let run = walk(&spec, &orbit, true, None);
            let count = run.smooth.len() as f64;
            println!(
                "| {} | {}× = {} | {:.1}% | {:.1}% | {:.1}% | {:.0} |",
                frame.0,
                multiple,
                spec.maxiter(),
                100.0 * (count - run.interior as f64) / count,
                100.0 * run.detected as f64 / count,
                100.0 * run.capped as f64 / count,
                run.mean_iterations(),
            );
        }
    }
}

/// **The largest tolerance that moves nothing**, where 1e-12 moves something.
///
/// The recommendation `1e-12` was the largest tolerance that moved nothing on
/// frames whose escaping samples were all shallow. A deep frame's escaping
/// samples run for tens of thousands of iterations before they leave, and a
/// merged radius they were inside at step 200 is not one they are inside at
/// step 90,000 — so the tolerance the recommendation rests on is exactly what
/// this walks back down.
#[test]
#[ignore = "minutes"]
fn the_largest_tolerance_that_moves_nothing_on_a_deep_frame() {
    println!("\n| frame | switch | ε | skipped | → interior | → escaping | count Δ | worst Δ | verdict |");
    println!("|---|:--|--:|--:|--:|--:|--:|--:|:--|");
    for frame in DEEP_FRAMES {
        let spec = deep(frame, None);
        let orbit = spec.reference_orbit().unwrap();
        let dc_bound = spec.dc_bound();
        for interior in [false, true] {
            let switch = if interior { "on" } else { "off" };
            let plain = walk(&spec, &orbit, interior, None);
            for &epsilon in FINER {
                let table = Table::build(&orbit, epsilon, dc_bound, bla::MIN_LEVEL).unwrap();
                let run = walk(&spec, &orbit, interior, Some(&table));
                let how = difference(&plain, &run);
                let moved = how.to_interior + how.to_escaping + how.count_mismatches;
                println!(
                    "| {} | {switch} | {epsilon:.1e} | {:.1}% | {} | {} | {} | {:.2e} | {} |",
                    frame.0,
                    100.0 * run.skipped as f64 / run.total_iterations.max(1) as f64,
                    how.to_interior,
                    how.to_escaping,
                    how.count_mismatches,
                    how.worst,
                    if moved == 0 { "**nothing moved**" } else { "moved" },
                );
                if moved == 0 {
                    break;
                }
            }
        }
    }
}

/// **The width at which the interior switch turns from a loss into a win**,
/// with the skip and without it.
///
/// The anchor ladder brackets the minibrot's own 6.5e-12 atom, because that is
/// where a frame stops having exterior in it and starts being body — and the
/// switch's whole return is bodies. The deep frames are below all of it and
/// have no body at all, which is the other half of the rule.
#[test]
#[ignore = "minutes"]
fn where_the_interior_switch_turns_from_a_loss_into_a_win() {
    println!("\n| frame | width | cap | escaped | proven interior | cap-starved | plain: off → on | skip at 1e-12: off → on |");
    println!("|---|--:|--:|--:|--:|--:|--:|--:|");
    let ladder: Vec<(String, Spec)> = [
        2e-11f64, 1e-11, 8e-12, 6.5e-12, 5e-12, 3e-12, 2e-12, 1e-12, 5e-13, 1e-13, 1e-16, 1e-19,
        1e-22, 1e-28,
    ]
    .iter()
    .map(|&width| (format!("anchor {width:e}"), mandelbrot(width)))
    .chain(
        DEEP_FRAMES
            .iter()
            .map(|frame| (frame.0.to_string(), deep(frame, None))),
    )
    .collect();
    for (label, spec) in &ladder {
        let orbit = spec.reference_orbit().unwrap();
        let table = Table::build(&orbit, 1e-12, spec.dc_bound(), bla::MIN_LEVEL).unwrap();
        let plain_off = walk(spec, &orbit, false, None);
        let plain_on = walk(spec, &orbit, true, None);
        let skip_off = walk(spec, &orbit, false, Some(&table));
        let skip_on = walk(spec, &orbit, true, Some(&table));
        let count = plain_on.smooth.len() as f64;
        println!(
            "| {label} | {:e} | {} | {:.1}% | {:.1}% | {:.1}% | {:.0} → {:.0} ms ({:+.0}%) | {:.0} → {:.0} ms ({:+.0}%) |",
            spec.width,
            spec.maxiter(),
            100.0 * (count - plain_on.interior as f64) / count,
            100.0 * plain_on.detected as f64 / count,
            100.0 * plain_on.capped as f64 / count,
            1e3 * plain_off.seconds,
            1e3 * plain_on.seconds,
            100.0 * (plain_on.seconds / plain_off.seconds - 1.0),
            1e3 * skip_off.seconds,
            1e3 * skip_on.seconds,
            100.0 * (skip_on.seconds / skip_off.seconds - 1.0),
        );
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

/// **The deep frames are still frames a link can spell**, and still at the cap
/// the policy gives their width.
///
/// Cheap on purpose — it renders nothing. What it guards is the two ways a
/// committed frame goes quietly wrong: a centre that grew past the 64
/// characters `explorer/deep-link.js` caps a coordinate at, so the `dv` link
/// beside it in `README.md` would be refused by the page rather than by
/// anything here; and a cap that stopped being the policy's, which would make
/// every price in the table beside it a price of a frame the tab does not draw.
#[test]
fn the_deep_frames_are_spellable_and_at_the_policy_cap() {
    /// `explorer/permalink.js`'s `COORDINATE_LIMIT`, which the deep contract
    /// shares rather than restating — a URL is one thing however deep it is.
    const COORDINATE_LIMIT: usize = 64;
    assert!(!DEEP_FRAMES.is_empty(), "no deep frames are committed yet");
    for (label, re, im, width, maxiter) in DEEP_FRAMES {
        assert_eq!(cap::for_width(*width), *maxiter, "{label} is off the policy");
        for text in [re, im] {
            assert!(
                text.len() <= COORDINATE_LIMIT,
                "{label}: a centre of {} characters is past what a link carries",
                text.len()
            );
            assert!(
                perturb::fx::Fx::parse(text, 16).is_some(),
                "{label}: `{text}` is not a decimal"
            );
        }
        // The digits are there to be spent: a centre trimmed so hard that the
        // frame's own pixels fall inside one of its ulps is a frame nobody can
        // return to, and it would look exactly like this one.
        let digits = re.split_once('.').map_or(0, |(_, frac)| frac.len());
        let decade = -width.log10();
        assert!(
            (digits as f64) > decade + 3.0,
            "{label}: {digits} digits is not enough to place a pixel of a {width:e} frame"
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
