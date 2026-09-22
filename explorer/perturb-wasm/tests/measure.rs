//! What the deep frames cost, and what the rules on them settle at.
//!
//! The measurement half of what was one 800-line `tests/frames.rs`
//! *(deep_refactor_ckpt138)*. The frames themselves — where they are, how wide,
//! at what cap — are the record in `tests/common`, and `tests/frames.rs` is the
//! two cheap pins that hold that record honest. Everything here renders
//! something, every test is `#[ignore]`d, and each one prints a table the crate
//! README carries.
//!
//! ```text
//! cargo test --release --test measure -- --ignored --nocapture
//! ```
//!
//! ⚠ **These are the numbers in the README, so a run that disagrees is either a
//! finding or a regression and never a rounding.** The seconds columns are this
//! box on this day and drift about 30%; the shares, the settled caps and the
//! domain counts are the frame's own and do not.

mod common;

use common::*;
use perturb::nuclei;
use perturb::policy;
use perturb::{Anchor, Spec, cap};
use std::time::Instant;

/// A tile small enough that a sweep of all seven at eight times the cap is
/// twenty seconds rather than minutes, and large enough that a share means
/// something.
const TILE: (u32, u32) = (32, 18);

fn spec_of(frame: &Frame, maxiter: Option<u32>) -> Spec {
    Spec {
        center_re: frame.re.to_string(),
        center_im: frame.im.to_string(),
        width: frame.width,
        resolution: [TILE.0, TILE.1],
        supersample: 1,
        maxiter: maxiter.or(Some(frame.maxiter)),
        reference: None,
        period: None,
        julia: None,
        anchor: Anchor::Parameter,
        interior: true,
        degree: frame.degree,
    }
}

/// What one walk of a frame came to. The plain loop, and nothing in front of it.
struct Walk {
    samples: usize,
    escaped: usize,
    /// Unresolved samples the interior switch **proved** bounded, rather than
    /// the ones the cap gave up on.
    detected: usize,
    /// `NaN`, not proven, and out of iterations: the frame is cap-starved here,
    /// and a deeper cap would move these samples rather than confirm them.
    capped: usize,
    total_iterations: u64,
}

impl Walk {
    fn mean_iterations(&self) -> f64 {
        self.total_iterations as f64 / self.samples as f64
    }
    fn share(&self, of: usize) -> f64 {
        100.0 * of as f64 / self.samples as f64
    }
}

fn walk(spec: &Spec) -> Walk {
    let orbit = spec.reference_orbit().unwrap();
    let mut run = Walk {
        samples: 0,
        escaped: 0,
        detected: 0,
        capped: 0,
        total_iterations: 0,
    };
    walk_frame(spec, &orbit, |outcome| {
        run.samples += 1;
        run.total_iterations += outcome.iterations as u64;
        if outcome.smooth.is_nan() {
            if outcome.detected_interior {
                run.detected += 1;
            } else {
                run.capped += 1;
            }
        } else {
            run.escaped += 1;
        }
    });
    run
}

/// **What a deeper cap resolves**, which is the question the policy cap leaves
/// open on every one of these frames.
///
/// Not one of them has a single *proven* interior sample: the interior switch
/// needs `|dz|²` under `2^-64` and that takes many periods of whatever
/// component a sample is in, while at these depths the nearby periods are of
/// the same order as the cap itself. So a frame's unresolved share is not
/// interior — it is **cap-starved**, and this is what says by how much.
///
/// **Every rung is a multiple of the width's own policy cap**, and never of the
/// frame's committed one, so the four columns mean the same thing on the `body`
/// pair — whose committed cap is already four times the policy's — as they do
/// on the other five.
#[test]
#[ignore = "~20 s: seven frames, four caps each, the deepest at eight times the policy's"]
fn what_a_deeper_cap_resolves() {
    println!("\n| frame | cap | escaped | proven interior | cap-starved | mean iterations |");
    println!("|---|--:|--:|--:|--:|--:|");
    for frame in frames_at(measure_degree()) {
        for multiple in [1u32, 2, 4, 8] {
            let cap = multiple * cap::for_width(frame.width);
            let run = walk(&spec_of(frame, Some(cap)));
            println!(
                "| {} | {}× = {} | {:.1}% | {:.1}% | {:.1}% | {:.0} |",
                frame.label,
                multiple,
                cap,
                run.share(run.escaped),
                run.share(run.detected),
                run.share(run.capped),
                run.mean_iterations(),
            );
        }
    }
}

// ---------------------------------------------------------------- the cap policy

/// One walk of the policy's own probe cells at one cap.
struct Probed {
    escaped: usize,
    proven: usize,
    starved: usize,
    /// `log₂|dz|²` of each starved sample.
    logs: Vec<f64>,
    samples: usize,
    iterations: u64,
}

impl Probed {
    fn mean_iterations(&self) -> f64 {
        self.iterations as f64 / self.samples as f64
    }
    /// The share of the whole probe past a bar — the stopping rule's number.
    fn fault(&self, bar: f64) -> f64 {
        self.logs.iter().filter(|value| **value > bar).count() as f64 / self.samples as f64
    }
}

/// The same cells `policy::probe_rows` would take at this cap, tallied the way
/// the sweep below needs them: every starved sample's `|dz|²` kept, rather than
/// counted against one bar.
fn probe_at(spec: &Spec, maxiter: u32) -> Probed {
    let spec = Spec {
        maxiter: Some(maxiter),
        ..spec.clone()
    };
    let orbit = spec.reference_orbit().unwrap();
    let mut run = Probed {
        escaped: 0,
        proven: 0,
        starved: 0,
        logs: Vec::new(),
        samples: 0,
        iterations: 0,
    };
    walk_cells(
        &spec,
        &orbit,
        policy::PROBE_COLS,
        policy::PROBE_ROWS,
        0,
        policy::PROBE_ROWS,
        |outcome| {
            run.samples += 1;
            run.iterations += outcome.iterations as u64;
            if !outcome.smooth.is_nan() {
                run.escaped += 1;
            } else if outcome.detected_interior {
                run.proven += 1;
            } else {
                run.starved += 1;
                run.logs.push(outcome.dz_log2());
            }
        },
    );
    run
}

/// **Where the policy settles, and what it costs**, on the seven deep frames and
/// the six controls.
///
/// This is the table the crate README's cap-policy section carries. `decision`
/// is the whole escalation's sample-iterations against the fine pass's at the
/// settled cap — what asking the question costs against drawing the answer.
#[test]
#[ignore = "~80 s: thirteen frames, each walked to the cap it settles on"]
fn where_the_policy_settles() {
    println!(
        "\n| frame | policy cap | settled | × | the cap's fault, rung by rung | mean iterations | decision |"
    );
    println!("|---|--:|--:|--:|:--|--:|--:|");
    for frame in every_frame_at(measure_degree()) {
        let (label, width) = (frame.label, frame.width);
        let spec = canvas_spec(&frame, None);
        let policy_cap = cap::for_width(width);
        let settled = policy::settle(&spec, policy::PROBE_COLS, policy::PROBE_ROWS).unwrap();
        assert_eq!(
            settled.rungs[0].maxiter, policy_cap,
            "{label}: the walk opens at the width's own cap"
        );
        // **A frame can run out of ceiling, and that is a row rather than a failure**
        // *(deep_degrees_ckpt140)*: degree six's `body 1e-22` is still more than a tenth
        // the cap's fault at a million, and the page says so in a sentence. The
        // degree-2 frames never do, and the table marks the one that does.
        let ceiling = if settled.at_ceiling {
            " (at the ceiling)"
        } else {
            ""
        };
        let rungs = settled
            .rungs
            .iter()
            .map(|rung| format!("{:.1}%", 100.0 * rung.fault_share()))
            .collect::<Vec<_>>()
            .join(" → ");
        let at_policy = probe_at(&spec, policy_cap);
        let at_settled = probe_at(&spec, settled.maxiter);
        let render = at_settled.mean_iterations() * FINE_LANES;
        println!(
            "| {} | {} | **{}**{ceiling} | {}× | {} | {:.0} → {:.0} | {:.2}% |",
            label,
            policy_cap,
            settled.maxiter,
            settled.maxiter / policy_cap.max(1),
            rungs,
            at_policy.mean_iterations(),
            at_settled.mean_iterations(),
            100.0 * settled.iterations as f64 / render,
        );
    }
}

/// **What the settled cap changes about the picture**, which is the point of the
/// whole exercise: the share of each frame that was painted interior at the
/// policy cap and escapes at the settled one.
#[test]
#[ignore = "~80 s: two walks of thirteen frames"]
fn what_the_settled_cap_repaints() {
    println!("\n| frame | escaped | proven interior | unresolved | repainted |");
    println!("|---|--:|--:|--:|--:|");
    for frame in every_frame_at(measure_degree()) {
        let (label, width) = (frame.label, frame.width);
        let spec = canvas_spec(&frame, None);
        let policy_cap = cap::for_width(width);
        let settled = policy::settle(&spec, policy::PROBE_COLS, policy::PROBE_ROWS).unwrap();
        let before = probe_at(&spec, policy_cap);
        let after = probe_at(&spec, settled.maxiter);
        let share = |count: usize| 100.0 * count as f64 / before.samples as f64;
        println!(
            "| {} | {:.1}% → {:.1}% | {:.1}% → {:.1}% | {:.1}% → {:.1}% | **{:.1}%** |",
            label,
            share(before.escaped),
            share(after.escaped),
            share(before.proven),
            share(after.proven),
            share(before.starved),
            share(after.starved),
            share(after.escaped.saturating_sub(before.escaped)),
        );
    }
}

/// **The sweep that chose the bar and the share**, and the reason neither is
/// quoted to a second digit: over five bars and five shares, thirteen frames
/// settle on almost exactly the same caps.
#[test]
#[ignore = "~100 s: thirteen frames at every rung, for twenty-five rules at once"]
fn the_bar_and_the_share_sit_on_a_plateau() {
    const BARS: &[f64] = &[8.0, 12.0, 16.0, 20.0, 24.0];
    const SHARES: &[f64] = &[0.05, 0.08, 0.10, 0.12, 0.15];
    const MOST_RUNGS: usize = 6;
    let ceiling = cap::CEILING as u32;
    print!("\n| frame |");
    for bar in BARS {
        for share in SHARES {
            print!(" {}/{:.0}% |", bar, share * 100.0);
        }
    }
    println!();
    for frame in every_frame_at(measure_degree()) {
        let (label, width) = (frame.label, frame.width);
        let policy_cap = cap::for_width(width);
        let spec = canvas_spec(&frame, None);
        // Every rung's fault share at every bar, walked once and read
        // twenty-five ways.
        let mut table: Vec<(u32, Vec<f64>)> = Vec::new();
        let mut maxiter = policy_cap;
        loop {
            let probed = probe_at(&spec, maxiter);
            table.push((maxiter, BARS.iter().map(|bar| probed.fault(*bar)).collect()));
            if maxiter >= ceiling || table.len() >= MOST_RUNGS {
                break;
            }
            maxiter = maxiter.saturating_mul(2).min(ceiling);
        }
        print!("| {} |", label);
        for (index, _) in BARS.iter().enumerate() {
            for share in SHARES {
                let settled = table
                    .iter()
                    .find(|(_, faults)| faults[index] <= *share)
                    .unwrap_or(table.last().unwrap())
                    .0;
                print!(" {}× |", settled / policy_cap.max(1));
            }
        }
        println!();
    }
}

// ------------------------------------------------- the nuclei in and around a frame

/// The tile a preview is drawn at: the staged gallery's own 316 px, at 16:9 and
/// one sample a pixel.
const TILE_PREVIEW: (u32, u32) = (316, 178);

/// What a tile is actually *timed* at here, and what that is scaled by to reach
/// [`TILE_PREVIEW`].
///
/// **Timed small on purpose.** A deep tile at the real size is minutes, and
/// forty of them twice over is an afternoon; the cost is linear in the samples
/// and the per-frame overhead is one reference orbit of a few milliseconds, so a
/// small tile measured and multiplied says the same thing for a fortieth of the
/// wait. Every tile figure below is marked as scaled.
const TILE_TIMED: (u32, u32) = (80, 45);
const TILE_SCALE: f64 =
    (TILE_PREVIEW.0 * TILE_PREVIEW.1) as f64 / (TILE_TIMED.0 * TILE_TIMED.1) as f64;

/// The pool's effective parallelism on this machine, as `explorer/README.md`
/// measures it — what turns a native second into a reader's second.
const POOL: f64 = 4.7;

/// Wasm's own overhead over native on this loop, from the crate README §4.
const WASM: f64 = 1.05;

/// `explorer/permalink.js`'s `COORDINATE_LIMIT`, which the deep contract shares.
const COORDINATE_LIMIT: usize = 64;

/// The digits a centre needs to place a pixel of a frame this wide: the width's
/// own decade, plus the eight guard digits `tests/descend.rs` spends, which put
/// the truncation well under a pixel.
fn digits_for(width: f64) -> usize {
    (-width.log10()).ceil().max(0.0) as usize + 8
}

/// Whether a `dv` link can carry this frame — the question the prompt asks to be
/// answered per entry rather than argued in general.
fn spellable(c_re: &perturb::fx::Fx, c_im: &perturb::fx::Fx, width: f64) -> bool {
    let digits = digits_for(width);
    c_re.to_decimal(digits).len() <= COORDINATE_LIMIT
        && c_im.to_decimal(digits).len() <= COORDINATE_LIMIT
}

/// The tile spec for one nucleus: centred on it, framed at [`nuclei::TILE_BODIES`] of
/// its body, and — where `periodic` — drawn against **its own orbit**, wrapped
/// at its period, which is the reference the prompt asks to be priced.
fn tile_spec(nucleus: &nuclei::Nucleus, periodic: bool) -> Spec {
    let width = nucleus.size() * nuclei::TILE_BODIES;
    let digits = digits_for(width);
    Spec {
        center_re: nucleus.c_re.to_decimal(digits),
        center_im: nucleus.c_im.to_decimal(digits),
        width,
        resolution: [TILE_TIMED.0, TILE_TIMED.1],
        supersample: 1,
        // **Not the width policy.** See `nuclei::TILE_PERIODS`: at the width
        // policy's cap a deep tile is a flat black rectangle.
        maxiter: Some(nuclei::tile_cap(nucleus.period, width)),
        reference: None,
        period: periodic.then_some(nucleus.period),
        julia: None,
        anchor: Anchor::Parameter,
        interior: true,
        degree: 2,
    }
}

/// Draw a tile and give back what it cost and what was in it.
fn draw(spec: &Spec) -> (f64, f64, f64) {
    let started = Instant::now();
    let orbit = spec.reference_orbit().unwrap();
    let (mut interior, mut rebases, mut samples) = (0u64, 0u64, 0u64);
    walk_frame(spec, &orbit, |outcome| {
        samples += 1;
        rebases += outcome.rebases as u64;
        if outcome.smooth.is_nan() {
            interior += 1;
        }
    });
    (
        started.elapsed().as_secs_f64(),
        100.0 * interior as f64 / samples as f64,
        rebases as f64 / samples as f64,
    )
}

/// **What the nucleus search finds on each frame, and what each half of it
/// costs.**
///
/// The three halves are priced apart because they scale differently and only one
/// of them is a surprise: detection is one walk of the probe grid at the frame's
/// own settled cap, a solve is a few Newton steps at the nucleus's period, and a
/// tile is an ordinary small render. The last column is the question a later
/// prompt needs answered — what naming the nucleus as the reference is worth,
/// which §2 of the crate README measured as 20.5 rebases a sample going to zero.
#[test]
#[ignore = "minutes: the whole search on eight frames, with every tile drawn twice"]
fn what_the_nucleus_search_finds_and_what_it_costs() {
    println!(
        "\n| frame | settled cap | detect s | domains | solved | s/solve | kept | reachable |"
    );
    println!("|---|--:|--:|--:|--:|--:|--:|--:|");
    let mut entries: Vec<(String, nuclei::Nucleus, f64)> = Vec::new();

    for frame in search_frames() {
        let (label, width) = (frame.label, frame.width);
        let base = canvas_spec(&frame, None);
        let settled = policy::settle(&base, policy::PROBE_COLS, policy::PROBE_ROWS).unwrap();
        let spec = canvas_spec(&frame, Some(settled.maxiter));

        let orbit = spec.reference_orbit().unwrap();
        let started = Instant::now();
        let found = nuclei::seeds(&spec, &orbit, nuclei::GRID_COLS, nuclei::GRID_ROWS);
        let detect = started.elapsed().as_secs_f64();

        let started = Instant::now();
        let kept = nuclei::search(&spec, nuclei::GRID_COLS, nuclei::GRID_ROWS, 12, 6).unwrap();
        let solving = started.elapsed().as_secs_f64() - detect;
        let solved = found.len().min(12);

        let reachable = kept
            .iter()
            .filter(|n| spellable(&n.c_re, &n.c_im, n.size() * nuclei::TILE_BODIES))
            .count();
        println!(
            "| {label} | {} | {detect:.2} | {} | {solved} | {:.2} | {} | {reachable} of {} |",
            settled.maxiter,
            found.len(),
            solving / solved.max(1) as f64,
            kept.len(),
            kept.len(),
        );
        for nucleus in kept {
            entries.push((label.to_string(), nucleus, width));
        }
    }

    println!("\n| frame | period | body | tile width | digits | steps | residual | link |");
    println!("|---|--:|--:|--:|--:|--:|--:|:--|");
    for (label, nucleus, _) in &entries {
        let width = nucleus.size() * nuclei::TILE_BODIES;
        let digits = digits_for(width);
        let spelling = nucleus.c_re.to_decimal(digits);
        println!(
            "| {label} | {} | {:.3e} | {width:.3e} | {} | {} | {:.1e} | {} |",
            nucleus.period,
            nucleus.size(),
            spelling.len(),
            nucleus.steps,
            nucleus.residual,
            if spellable(&nucleus.c_re, &nucleus.c_im, width) {
                "yes"
            } else {
                "**past 64 characters**"
            },
        );
    }

    println!(
        "\n**Tiles.** Timed at {}x{} and scaled by {TILE_SCALE:.0}x to {}x{}, then by wasm's \
         {WASM:.2}x over native and the pool's {POOL:.1}x — so the last column is what a \
         reader waits for one tile.",
        TILE_TIMED.0, TILE_TIMED.1, TILE_PREVIEW.0, TILE_PREVIEW.1,
    );
    println!(
        "\n| frame | period | tile cap | interior | view-centre ref | nucleus ref | gain | rebases | reader waits |"
    );
    println!("|---|--:|--:|--:|--:|--:|--:|--:|--:|");
    let mut timed: Vec<String> = Vec::new();
    for (label, nucleus, _) in &entries {
        // The largest of each frame only: the tile table is the expensive one, and the
        // biggest nucleus is both the worst case and the one a reader sees first.
        if timed.contains(label) {
            continue;
        }
        timed.push(label.clone());
        let width = nucleus.size() * nuclei::TILE_BODIES;
        let (plain, interior, before) = draw(&tile_spec(nucleus, false));
        let (wrapped, _, after) = draw(&tile_spec(nucleus, true));
        println!(
            "| {label} | {} | {} | {interior:.0}% | {plain:.2} s | {wrapped:.2} s | **{:.2}x** | {before:.1} / {after:.1} | **{:.0} s** |",
            nucleus.period,
            nuclei::tile_cap(nucleus.period, width),
            plain / wrapped,
            wrapped * TILE_SCALE * WASM / POOL,
        );
    }
}

/// **What cap a preview tile of a minibrot needs**, which the width policy cannot
/// answer.
///
/// The first run of [`what_the_nucleus_search_finds_and_what_it_costs`] drew a
/// period-94,776 tile that was **100% interior and took 48 seconds** — a black
/// rectangle, slowly. The cause is not the framing: at the tile's own width the
/// policy gives about 148,000 iterations, which is **one and a half periods** of
/// the thing being drawn, and a point near a period-`p` minibrot needs many
/// periods before anything about it resolves.
///
/// So the tile's cap has to know the period, which — uniquely — it does, because
/// the tile is centred on a nucleus the search has just solved. This walks the
/// candidate rules on a frame's own nuclei and is what the rule in
/// `nuclei::TILE_PERIODS` is chosen from.
#[test]
#[ignore = "~2 min: three nuclei, seven caps each, on a small tile"]
fn what_a_preview_tile_needs() {
    const PROBE_TILE: (u32, u32) = (80, 45);
    // `tangle 1e-22` at the degree `MEASURE_DEGREE` names, two by default.
    let degree = measure_degree();
    let frame = frames_at(degree)[0].control();
    assert_eq!(frame.label, "tangle 1e-22");
    let base = canvas_spec(&frame, None);
    let settled = policy::settle(&base, policy::PROBE_COLS, policy::PROBE_ROWS).unwrap();
    let spec = canvas_spec(&frame, Some(settled.maxiter));
    let kept = nuclei::search(&spec, nuclei::GRID_COLS, nuclei::GRID_ROWS, 12, 3).unwrap();

    println!("\n### degree {degree}\n");
    println!("| period | rule | cap | escaped | proven | starved | mean iters | s (80x45) |");
    println!("|--:|---|--:|--:|--:|--:|--:|--:|");
    for nucleus in &kept {
        let width = nucleus.size() * nuclei::TILE_BODIES;
        let digits = digits_for(width);
        let policy_cap = cap::for_width(width);
        let rules: Vec<(&str, u32)> = vec![
            ("width policy", policy_cap),
            ("2x policy", 2 * policy_cap),
            ("4 periods", 4 * nucleus.period),
            ("8 periods", 8 * nucleus.period),
            ("16 periods", 16 * nucleus.period),
            ("32 periods", 32 * nucleus.period),
        ];
        for (name, wanted) in rules {
            let maxiter = wanted.min(cap::CEILING as u32);
            let tile = Spec {
                center_re: nucleus.c_re.to_decimal(digits),
                center_im: nucleus.c_im.to_decimal(digits),
                width,
                resolution: [PROBE_TILE.0, PROBE_TILE.1],
                supersample: 1,
                maxiter: Some(maxiter),
                reference: None,
                period: Some(nucleus.period),
                julia: None,
                anchor: Anchor::Parameter,
                interior: true,
                degree,
            };
            let started = Instant::now();
            let run = walk(&tile);
            println!(
                "| {} | {name} | {maxiter} | {:.1}% | {:.1}% | {:.1}% | {:.0} | {:.2} |",
                nucleus.period,
                run.share(run.escaped),
                run.share(run.detected),
                run.share(run.capped),
                run.mean_iterations(),
                started.elapsed().as_secs_f64(),
            );
        }
        println!("|  |  |  |  |  |  |  |  |");
    }
}

// ------------------------------------------------------------ the interior floor

/// **The interior switch's floor, swept at one degree** *(deep_degrees_ckpt140)* —
/// `MEASURE_DEGREE`, and §3's sweep at every other.
///
/// The frames are the ones with interior in them: at degree two the anchor at 2e-11
/// and the two `body` frames; above it the degree's island pin at about three bodies,
/// which is the anchor's framing, and that degree's two `body` frames. Each is walked
/// once with the switch off and once at every floor, on the cap policy's 64×36, and a
/// sample the switch paints interior that the plain run escapes from is the one
/// thing that must never happen at the floor that ships.
#[test]
#[ignore = "minutes: three frames, eleven floors each"]
fn the_interior_floor_at_a_degree() {
    const FLOORS: &[i32] = &[-300, -160, -120, -100, -80, -64, -48, -32, -16, -8, -4];
    let degree = measure_degree();
    let mut frames: Vec<(Control, u32)> = Vec::new();
    let island = controls_at(degree)
        .into_iter()
        .find(|c| c.label == "anchor 2e-11" || c.label == "island 3 bodies")
        .unwrap();
    frames.push((island, cap::for_width(island.width)));
    for frame in frames_at(degree) {
        if frame.label.starts_with("body") {
            frames.push((frame.control(), frame.maxiter));
        }
    }
    println!("\n### degree {degree}\n");
    println!(
        "| frame | cap | interior (off) | floor | caught | wrongly painted | iterations saved |"
    );
    println!("|---|--:|--:|--:|--:|--:|--:|");
    // **Held at the shipped floor and reported at the others.** At degree six the
    // island frame has one escaping sample the switch paints interior at −4, which is
    // the whole reason the floor is not a free parameter to push toward zero.
    let mut wrong_at_shipped = 0;
    for (frame, maxiter) in frames {
        let spec = Spec {
            resolution: [policy::PROBE_COLS, policy::PROBE_ROWS],
            supersample: 1,
            ..canvas_spec(&frame, Some(maxiter))
        };
        let orbit = spec.reference_orbit().unwrap();
        let offset = spec.centre_offset().unwrap();
        let cells: Vec<(f64, f64)> = (0..spec.resolution[1])
            .flat_map(|row| (0..spec.resolution[0]).map(move |col| (col, row)))
            .map(|(col, row)| spec.dc(offset, col, row))
            .collect();
        let off_kernel = perturb::kernel::Kernel::new(&orbit, maxiter, false);
        let off: Vec<_> = cells
            .iter()
            .map(|&(re, im)| off_kernel.sample_at(degree, frame.julia, re, im))
            .collect();
        let inside = off.iter().filter(|o| o.smooth.is_nan()).count();
        let spent: u64 = off.iter().map(|o| o.iterations as u64).sum();
        for &floor in FLOORS {
            let on = perturb::kernel::Kernel::new(&orbit, maxiter, true).at_floor(floor);
            let (mut caught, mut wrong, mut with) = (0, 0, 0u64);
            for (at, &(re, im)) in cells.iter().enumerate() {
                let o = on.sample_at(degree, frame.julia, re, im);
                with += o.iterations as u64;
                if o.detected_interior {
                    caught += 1;
                }
                if o.smooth.is_nan() && !off[at].smooth.is_nan() {
                    wrong += 1;
                }
            }
            if floor == perturb::kernel::INTERIOR_EXPONENT {
                wrong_at_shipped += wrong;
            }
            println!(
                "| {} | {maxiter} | {inside} | {floor} | {caught} | {wrong} | {:.1}% |",
                frame.label,
                100.0 * (1.0 - with as f64 / spent as f64)
            );
        }
    }
    assert_eq!(
        wrong_at_shipped, 0,
        "at the shipped floor the switch painted an escaping sample interior"
    );
}
