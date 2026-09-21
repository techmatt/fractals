//! Deep frames that have something in them, as cases.
//!
//! The anchor ladder this crate is priced on has one blind spot: every rung
//! below the minibrot's own 6.5e-12 atom is inside its body and **100%
//! interior**, so anything measured down there is measured on a picture with no
//! exterior in it. `tests/descend.rs` is the program that went and found frames
//! without that defect, and these seven are what it settled on — committed here
//! so that any later deep work (the cap policy, a nucleus reference, a second
//! reference orbit) has the same frames to run against rather than finding its
//! own and reporting numbers nothing can be compared with.
//!
//! They were found for a skip table that has since been taken back out; **§6 of
//! the crate README is the measurement and the ruling**, and §6's open problem —
//! that at these depths the policy cap paints exterior as interior — is what
//! [`what_a_deeper_cap_resolves`] below is the evidence for.
//!
//! ```text
//! cargo test --release --test frames -- --ignored --nocapture
//! ```
//!
//! The two tests that are not ignored are cheap on purpose: they render nothing,
//! and they hold every case to still being a frame a link can spell and still
//! being at the cap its row claims.

use perturb::kernel::Kernel;
use perturb::policy;
use perturb::{Anchor, Spec, cap};

/// A tile small enough that a sweep of all seven at eight times the cap is
/// twenty seconds rather than minutes, and large enough that a share means
/// something.
const TILE: (u32, u32) = (32, 18);

/// **Deep frames with escaping structure in them.**
///
/// Each is `(label, centre re, centre im, width, cap, the multiple of the
/// policy cap that is)`. Five were found at the policy's own cap; the two
/// `body` frames are the route that walks every rung at **four times** it,
/// which is what it takes at this depth to see a frame that has genuine
/// interior in it rather than exterior the cap gave up on.
///
/// Found by `tests/descend.rs` — a descent from the anchor's own minibrot at
/// 1e-11, recentring each rung on the busiest boundary neighbourhood a 64×64
/// tile offers and shrinking the width tenfold, with the centre carried as an
/// exact decimal the whole way.
///
/// **The centres are trimmed to what a link can spell** — the width's decade
/// and eight digits more — and the trimmed frame is the one that was measured,
/// so the number in a table and the picture behind a link are the same frame.
/// [`link`] is the `dv` query each one opens under, and the crate README spells
/// all seven out.
pub const DEEP_FRAMES: &[(&str, &str, &str, f64, u32, u32)] = &[
    (
        "tangle 1e-22",
        "-0.745017728290198619298817365858",
        "0.149934432756897045833502403382",
        1e-22,
        93_600,
        1,
    ),
    (
        "tangle 1e-28",
        "-0.74501772829019861929877929889763684",
        "0.14993443275689704583350282968726721",
        1e-28,
        117_518,
        1,
    ),
    (
        "tangle 1e-40",
        "-0.7450177282901986192987792989188510315333046875",
        "0.1499344327568970458335028296517884911675546875",
        1e-40,
        165_354,
        1,
    ),
    (
        "pinch 1e-28",
        "-0.74501772828897655304632685480388684",
        "0.14993443275858764694789167606226721",
        1e-28,
        117_518,
        1,
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
        1,
    ),
    (
        "body 1e-22",
        "-0.745017728288852579046129865858",
        "0.149934432757626550615361778382",
        1e-22,
        374_400,
        4,
    ),
    (
        "body 1e-28",
        "-0.74501772828885257904614927236638684",
        "0.14993443275762655061538134007789221",
        1e-28,
        470_072,
        4,
    ),
];

/// The frame as the Deep tab would be asked for it, after `explorer/?`.
///
/// Derived rather than typed, for the reason every other link on this site is:
/// a centre written twice is a centre that can disagree with itself, and the
/// one in the tuple above is the one the numbers were taken at.
pub fn link(frame: &(&str, &str, &str, f64, u32, u32)) -> String {
    format!(
        "dv=2&x={}&y={}&w=1e-{}&n={}",
        frame.1,
        frame.2,
        decade(frame.3),
        frame.4
    )
}

/// The width's own decade, which every one of these is an exact power of ten of.
fn decade(width: f64) -> i32 {
    -width.log10().round() as i32
}

fn spec_of(frame: &(&str, &str, &str, f64, u32, u32), maxiter: Option<u32>) -> Spec {
    Spec {
        center_re: frame.1.to_string(),
        center_im: frame.2.to_string(),
        width: frame.3,
        resolution: [TILE.0, TILE.1],
        supersample: 1,
        maxiter: maxiter.or(Some(frame.4)),
        reference: None,
        period: None,
        julia: None,
        anchor: Anchor::Parameter,
        interior: true,
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
    let kernel = Kernel::new(&orbit, spec.maxiter(), spec.interior).at_entry(spec.entry());
    let offset = spec.centre_offset().unwrap();
    let mut run = Walk {
        samples: (spec.resolution[0] * spec.resolution[1]) as usize,
        escaped: 0,
        detected: 0,
        capped: 0,
        total_iterations: 0,
    };
    for row in 0..spec.resolution[1] {
        for col in 0..spec.resolution[0] {
            let (re, im) = spec.dc(offset, col, row);
            let outcome = kernel.sample_with::<false>(re, im);
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
        }
    }
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
    for frame in DEEP_FRAMES {
        for multiple in [1u32, 2, 4, 8] {
            let cap = multiple * cap::for_width(frame.3);
            let run = walk(&spec_of(frame, Some(cap)));
            println!(
                "| {} | {}× = {} | {:.1}% | {:.1}% | {:.1}% | {:.0} |",
                frame.0,
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

/// **The frames are still frames a link can spell**, and still at the cap their
/// own row claims.
///
/// Cheap on purpose — it renders nothing. What it guards is the two ways a
/// committed frame goes quietly wrong: a centre that grew past the 64
/// characters `explorer/deep-link.js` caps a coordinate at, so the `dv` link
/// beside it in `README.md` would be refused by the page rather than by
/// anything here; and a cap that stopped being the policy's, which would make
/// every number ever taken on it a number of a frame the tab does not draw.
#[test]
fn the_deep_frames_are_spellable_and_at_the_cap_they_claim() {
    /// `explorer/permalink.js`'s `COORDINATE_LIMIT`, which the deep contract
    /// shares rather than restating — a URL is one thing however deep it is.
    const COORDINATE_LIMIT: usize = 64;
    assert_eq!(DEEP_FRAMES.len(), 7, "the descent settled on seven");
    for frame in DEEP_FRAMES {
        let (label, re, im, width, maxiter, multiple) = frame;
        assert_eq!(
            multiple * cap::for_width(*width),
            *maxiter,
            "{label} is off the policy"
        );
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
        let decade = decade(*width) as f64;
        assert!(
            digits as f64 > decade + 3.0,
            "{label}: {digits} digits is not enough to place a pixel of a {width:e} frame"
        );
        // And the link is the frame, since it is what a reader opens rather
        // than the tuple.
        let query = link(frame);
        assert!(
            query.contains(&format!("&w=1e-{}&n={maxiter}", decade as i32)),
            "{query}"
        );
        assert!(query.contains(*re) && query.contains(*im), "{query}");
    }
}

/// The policy caps these rows quote, so a reader of a table can check them.
#[test]
fn the_policy_cap_at_the_widths_these_frames_sit_at() {
    assert_eq!(cap::for_width(1e-22), 93_600);
    assert_eq!(cap::for_width(1e-28), 117_518);
    assert_eq!(cap::for_width(1e-40), 165_354);
    assert_eq!(cap::for_width(1e-54), 221_162);
}

// ---------------------------------------------------------------- the cap policy

/// The audit's anchor: a period-2838 minibrot nucleus in the seahorse valley,
/// atom size 6.478e-12. `tests/oracle.rs`'s own constants, and the frame the
/// whole tab is priced on.
const ANCHOR_RE: &str = "-0.74501772828532335842941892835857434";
const ANCHOR_IM: &str = "0.14993443275456819177805709088257971";

/// **The frames a cap policy has to leave alone**, which are as much of the case
/// as the seven above.
///
/// Each is `(label, centre re, centre im, width, julia)`. A rule that resolves
/// the deep frames by escalating everything has solved nothing: these six are
/// what it must walk past at the width's own cap, and they are the reason the
/// stopping rule reads a derivative rather than a share.
///
/// - **anchor 2e-11** is the hard one, and the whole reason
///   [`policy::FAULT_EXPONENT`] is not zero: 38% of it dies at the cap unproven,
///   and almost all of that is the minibrot's own body, whose period of 2,838
///   fits seventeen times into the cap and leaves the switch no room to fire.
/// - **anchor 1e-22** is inside that body — 100% *proven* interior, nothing
///   starved, and it settles before a second orbit is computed.
/// - **misiurewicz 1e-22** is `c = i`, where escape counts are two digits at any
///   depth: a deep frame that is genuinely finished at the policy cap.
/// - **home 3** and **seahorse 1e-6** are ordinary shallow views, which no deep
///   policy has any business moving.
/// - **julia anchor 2e-9** is the tab's other committed link, so the rule is
///   asked about both of the sets this kernel draws.
pub const CONTROL_FRAMES: &[(&str, &str, &str, f64, bool)] = &[
    ("anchor 2e-11", ANCHOR_RE, ANCHOR_IM, 2e-11, false),
    ("anchor 1e-22", ANCHOR_RE, ANCHOR_IM, 1e-22, false),
    ("misiurewicz 1e-22", "0", "1", 1e-22, false),
    ("home 3", "0", "0", 3.0, false),
    ("seahorse 1e-6", "-0.745017", "0.149934", 1e-6, false),
    ("julia anchor 2e-9", ANCHOR_RE, ANCHOR_IM, 2e-9, true),
];

/// The canvas `explorer/README.md` prices the tab on, and the supersample its
/// last pass ends at.
///
/// The policy's probe is a subset of **this** grid rather than a tile of its
/// own, so every number below is a number the page would take.
const CANVAS: (u32, u32) = (1136, 636);
const FINE_SUPERSAMPLE: u32 = 2;

/// Lanes in the fine pass, which is four fifths of a Render's wait.
const FINE_LANES: f64 =
    (CANVAS.0 * FINE_SUPERSAMPLE) as f64 * (CANVAS.1 * FINE_SUPERSAMPLE) as f64;

/// The seven and the six as one list of `(label, re, im, width, julia)`.
fn every_frame() -> Vec<(&'static str, &'static str, &'static str, f64, bool)> {
    DEEP_FRAMES
        .iter()
        .map(|frame| (frame.0, frame.1, frame.2, frame.3, false))
        .chain(CONTROL_FRAMES.iter().copied())
        .collect()
}

/// A frame as the Deep tab asks for it: the tab's canvas, the fine pass's
/// supersample, and no nucleus — the tab has no solver, so the reference is the
/// view's own centre.
fn canvas_spec(
    re: &str,
    im: &str,
    width: f64,
    julia: bool,
    maxiter: Option<u32>,
) -> Spec {
    Spec {
        center_re: re.to_string(),
        center_im: im.to_string(),
        width,
        resolution: [CANVAS.0, CANVAS.1],
        supersample: FINE_SUPERSAMPLE,
        maxiter,
        reference: None,
        period: None,
        julia: julia.then(|| (re.to_string(), im.to_string())),
        anchor: Anchor::Parameter,
        interior: true,
    }
}

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

fn probe_at(spec: &Spec, maxiter: u32) -> Probed {
    let spec = Spec {
        maxiter: Some(maxiter),
        ..spec.clone()
    };
    let orbit = spec.reference_orbit().unwrap();
    let kernel = Kernel::new(&orbit, spec.maxiter(), spec.interior).at_entry(spec.entry());
    let offset = spec.centre_offset().unwrap();
    let julia = spec.julia.is_some();
    let (width, height) = (spec.sample_width(), spec.sample_height());
    let mut run = Probed {
        escaped: 0,
        proven: 0,
        starved: 0,
        logs: Vec::new(),
        samples: (policy::PROBE_COLS * policy::PROBE_ROWS) as usize,
        iterations: 0,
    };
    for j in 0..policy::PROBE_ROWS {
        let row = ((j as u64 * 2 + 1) * height as u64 / (policy::PROBE_ROWS as u64 * 2)) as u32;
        for i in 0..policy::PROBE_COLS {
            let col = ((i as u64 * 2 + 1) * width as u64 / (policy::PROBE_COLS as u64 * 2)) as u32;
            let (re, im) = spec.dc(offset, col, row);
            let outcome = if julia {
                kernel.sample_with::<true>(re, im)
            } else {
                kernel.sample_with::<false>(re, im)
            };
            run.iterations += outcome.iterations as u64;
            if !outcome.smooth.is_nan() {
                run.escaped += 1;
            } else if outcome.detected_interior {
                run.proven += 1;
            } else {
                run.starved += 1;
                run.logs.push(outcome.dz_log2());
            }
        }
    }
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
    for (label, re, im, width, julia) in every_frame() {
        let spec = canvas_spec(re, im, width, julia, None);
        let policy_cap = cap::for_width(width);
        let settled = policy::settle(&spec, policy::PROBE_COLS, policy::PROBE_ROWS).unwrap();
        assert_eq!(
            settled.rungs[0].maxiter, policy_cap,
            "{label}: the walk opens at the width's own cap"
        );
        assert!(!settled.at_ceiling, "{label}: settled by running out of ceiling");
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
            "| {} | {} | **{}** | {}× | {} | {:.0} → {:.0} | {:.2}% |",
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
    for (label, re, im, width, julia) in every_frame() {
        let spec = canvas_spec(re, im, width, julia, None);
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
    for (label, re, im, width, julia) in every_frame() {
        let policy_cap = cap::for_width(width);
        let spec = canvas_spec(re, im, width, julia, None);
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
