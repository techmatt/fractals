//! The deep frames, the controls, and the one walk of a sample grid the
//! harnesses share.
//!
//! **Why a directory module and not a third `tests/*.rs`.** Every file directly
//! under `tests/` is its own crate, so `tests/measure.rs` cannot `use` anything
//! out of `tests/frames.rs`: the only thing two integration-test binaries can
//! share is a module they both declare, and a module inside a subdirectory is
//! the one shape cargo does not also compile as a test binary of its own. So the
//! data lives here and both binaries say `mod common;`.
//!
//! What is here is the part that is a *record* — where the frames are, how wide,
//! at what cap — and the two helpers that turn one into something the kernel can
//! be asked about. What measures anything is in `tests/measure.rs`.
#![allow(dead_code)]

use perturb::kernel::{Kernel, Outcome};
use perturb::policy;
use perturb::reference::Reference;
use perturb::{Anchor, Spec};

/// One deep frame: where it is, how wide, and the cap it was measured at.
///
/// **Named rather than positional, and that is the whole reason it is a struct**
/// *(deep_refactor_ckpt138)*. This was a six-field tuple decoded as `frame.4`
/// and `frame.5` at four call sites, and those two are both `u32` — a cap and
/// the multiple of the policy cap it is — so swapping them would have drawn a
/// picture and moved a table rather than failing.
pub struct Frame {
    pub label: &'static str,
    pub re: &'static str,
    pub im: &'static str,
    pub width: f64,
    /// The cap every number on this frame was taken at.
    pub maxiter: u32,
    /// What multiple of `cap::for_width` that is, which
    /// `the_deep_frames_are_spellable_and_at_the_cap_they_claim` checks.
    pub multiple: u32,
}

impl Frame {
    /// The same frame as a [`Control`], which is what the harnesses that take
    /// both lists walk. Never a Julia frame: the descent that found these was
    /// on the parameter plane.
    pub fn control(&self) -> Control {
        Control {
            label: self.label,
            re: self.re,
            im: self.im,
            width: self.width,
            julia: false,
        }
    }
}

/// **Deep frames with escaping structure in them.**
///
/// Five were found at the policy's own cap; the two `body` frames are the route
/// that walks every rung at **four times** it, which is what it takes at this
/// depth to see a frame that has genuine interior in it rather than exterior
/// the cap gave up on.
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
pub const DEEP_FRAMES: &[Frame] = &[
    Frame {
        label: "tangle 1e-22",
        re: "-0.745017728290198619298817365858",
        im: "0.149934432756897045833502403382",
        width: 1e-22,
        maxiter: 93_600,
        multiple: 1,
    },
    Frame {
        label: "tangle 1e-28",
        re: "-0.74501772829019861929877929889763684",
        im: "0.14993443275689704583350282968726721",
        width: 1e-28,
        maxiter: 117_518,
        multiple: 1,
    },
    Frame {
        label: "tangle 1e-40",
        re: "-0.7450177282901986192987792989188510315333046875",
        im: "0.1499344327568970458335028296517884911675546875",
        width: 1e-40,
        maxiter: 165_354,
        multiple: 1,
    },
    Frame {
        label: "pinch 1e-28",
        re: "-0.74501772828897655304632685480388684",
        im: "0.14993443275858764694789167606226721",
        width: 1e-28,
        maxiter: 117_518,
        multiple: 1,
    },
    // **The deepest frame a link can spell.** Not the deepest the crate draws —
    // a rung costs about five seconds a tile here and the descent was still
    // going down — but the deepest whose centre fits the 64 characters
    // `explorer/deep-link.js` caps a coordinate at, with the eight guard digits
    // that put the truncation well under a pixel. It is 63.
    Frame {
        label: "tangle 1e-54",
        re: "-0.745017728290198619298779298918851031533262270733325571484375",
        im: "0.149934432756897045833502829651788491167588360989048041953125",
        width: 1e-54,
        maxiter: 221_162,
        multiple: 1,
    },
    Frame {
        label: "body 1e-22",
        re: "-0.745017728288852579046129865858",
        im: "0.149934432757626550615361778382",
        width: 1e-22,
        maxiter: 374_400,
        multiple: 4,
    },
    Frame {
        label: "body 1e-28",
        re: "-0.74501772828885257904614927236638684",
        im: "0.14993443275762655061538134007789221",
        width: 1e-28,
        maxiter: 470_072,
        multiple: 4,
    },
];

/// The frame as the Deep tab would be asked for it, after `explorer/?`.
///
/// Derived rather than typed, for the reason every other link on this site is:
/// a centre written twice is a centre that can disagree with itself, and the
/// one in the row above is the one the numbers were taken at.
pub fn link(frame: &Frame) -> String {
    format!(
        "dv=2&x={}&y={}&w=1e-{}&n={}",
        frame.re,
        frame.im,
        decade(frame.width),
        frame.maxiter
    )
}

/// The width's own decade, which every one of these is an exact power of ten of.
pub fn decade(width: f64) -> i32 {
    -width.log10().round() as i32
}

/// The audit's anchor: a period-2838 minibrot nucleus in the seahorse valley,
/// atom size 6.478e-12. `tests/oracle.rs`'s own constants, and the frame the
/// whole tab is priced on.
pub const ANCHOR_RE: &str = "-0.74501772828532335842941892835857434";
pub const ANCHOR_IM: &str = "0.14993443275456819177805709088257971";

/// One frame a policy is asked about, with no cap of its own: the width's is
/// what it must settle from.
#[derive(Clone, Copy)]
pub struct Control {
    pub label: &'static str,
    pub re: &'static str,
    pub im: &'static str,
    pub width: f64,
    /// Whether this is the Julia set at that point rather than the parameter
    /// plane around it.
    pub julia: bool,
}

impl Control {
    /// A frame on the parameter plane, which all but one of them are.
    const fn at(label: &'static str, re: &'static str, im: &'static str, width: f64) -> Control {
        Control {
            label,
            re,
            im,
            width,
            julia: false,
        }
    }
}

/// **The frames a cap policy has to leave alone**, which are as much of the case
/// as the seven above.
///
/// A rule that resolves the deep frames by escalating everything has solved
/// nothing: these six are what it must walk past at the width's own cap, and
/// they are the reason the stopping rule reads a derivative rather than a share.
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
pub const CONTROL_FRAMES: &[Control] = &[
    Control::at("anchor 2e-11", ANCHOR_RE, ANCHOR_IM, 2e-11),
    Control::at("anchor 1e-22", ANCHOR_RE, ANCHOR_IM, 1e-22),
    Control::at("misiurewicz 1e-22", "0", "1", 1e-22),
    Control::at("home 3", "0", "0", 3.0),
    Control::at("seahorse 1e-6", "-0.745017", "0.149934", 1e-6),
    Control {
        label: "julia anchor 2e-9",
        re: ANCHOR_RE,
        im: ANCHOR_IM,
        width: 2e-9,
        julia: true,
    },
];

/// The canvas `explorer/README.md` prices the tab on, and the supersample its
/// last pass ends at.
///
/// The policy's probe is a subset of **this** grid rather than a tile of its
/// own, so every number taken through [`canvas_spec`] is a number the page
/// would take.
pub const CANVAS: (u32, u32) = (1136, 636);
pub const FINE_SUPERSAMPLE: u32 = 2;

/// Lanes in the fine pass, which is four fifths of a Render's wait.
pub const FINE_LANES: f64 =
    (CANVAS.0 * FINE_SUPERSAMPLE) as f64 * (CANVAS.1 * FINE_SUPERSAMPLE) as f64;

/// The seven and the six as one list.
pub fn every_frame() -> Vec<Control> {
    DEEP_FRAMES
        .iter()
        .map(Frame::control)
        .chain(CONTROL_FRAMES.iter().copied())
        .collect()
}

/// The seven, and the one control the nucleus search is asked about: the
/// shallowest deep frame the prompt asks for, which is the anchor the whole tab
/// is priced on.
pub fn search_frames() -> Vec<Control> {
    DEEP_FRAMES
        .iter()
        .map(Frame::control)
        .chain(
            CONTROL_FRAMES
                .iter()
                .copied()
                .filter(|frame| frame.label == "anchor 2e-11"),
        )
        .collect()
}

/// A frame as the Deep tab asks for it: the tab's canvas, the fine pass's
/// supersample, and no nucleus — the tab has no solver, so the reference is the
/// view's own centre.
pub fn canvas_spec(frame: &Control, maxiter: Option<u32>) -> Spec {
    Spec {
        center_re: frame.re.to_string(),
        center_im: frame.im.to_string(),
        width: frame.width,
        resolution: [CANVAS.0, CANVAS.1],
        supersample: FINE_SUPERSAMPLE,
        maxiter,
        reference: None,
        period: None,
        julia: frame
            .julia
            .then(|| (frame.re.to_string(), frame.im.to_string())),
        anchor: Anchor::Parameter,
        interior: true,
    }
}

/// Walk `cols × rows` cells of a spec's sample grid and hand each outcome back.
///
/// **Written to match [`policy::probe_rows`], which is shipped behaviour and
/// stays exactly as it is** *(deep_refactor_ckpt138)*. Four harnesses across
/// two files each had their own copy of this loop — build the orbit, make a
/// kernel at the spec's entry, take the centre offset, walk rows and columns,
/// `spec.dc`, `sample_with` — differing only in what they tallied, and one of
/// them had quietly dropped the clamp on [`policy::spread`]. They tally through
/// the closure now and the walk is one thing.
///
/// `cols` and `rows` are the grid to spread over the frame, exactly as a probe's
/// are: pass `spec.sample_width()` and `spec.sample_height()` to visit every
/// cell, since a cell spread over a grid its own size is itself.
pub fn walk_cells(
    spec: &Spec,
    orbit: &Reference,
    cols: u32,
    rows: u32,
    row_start: u32,
    row_end: u32,
    mut each: impl FnMut(Outcome),
) {
    let kernel = Kernel::new(orbit, spec.maxiter(), spec.interior).at_entry(spec.entry());
    let offset = spec.centre_offset().unwrap_or((0.0, 0.0));
    let julia = spec.julia.is_some();
    let sample_width = spec.sample_width().max(1);
    let sample_height = spec.sample_height().max(1);
    let cols = cols.clamp(1, sample_width);
    let rows = rows.clamp(1, sample_height);

    for j in row_start..row_end.min(rows) {
        let row = policy::spread(j, rows, sample_height);
        for i in 0..cols {
            let col = policy::spread(i, cols, sample_width);
            let (re, im) = spec.dc(offset, col, row);
            each(if julia {
                kernel.sample_with::<true>(re, im)
            } else {
                kernel.sample_with::<false>(re, im)
            });
        }
    }
}

/// Every cell of a spec's own sample grid, which is [`walk_cells`] asked for the
/// grid it already has.
pub fn walk_frame(spec: &Spec, orbit: &Reference, each: impl FnMut(Outcome)) {
    let (cols, rows) = (spec.sample_width(), spec.sample_height());
    walk_cells(spec, orbit, cols, rows, 0, rows, each);
}
