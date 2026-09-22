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
    /// The degree of `z^d + c` the frame is of — two for the seven below, and the
    /// degree its descent was run at for [`DEGREE_FRAMES`].
    pub degree: u32,
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
            degree: self.degree,
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
        degree: 2,
    },
    Frame {
        label: "tangle 1e-28",
        re: "-0.74501772829019861929877929889763684",
        im: "0.14993443275689704583350282968726721",
        width: 1e-28,
        maxiter: 117_518,
        multiple: 1,
        degree: 2,
    },
    Frame {
        label: "tangle 1e-40",
        re: "-0.7450177282901986192987792989188510315333046875",
        im: "0.1499344327568970458335028296517884911675546875",
        width: 1e-40,
        maxiter: 165_354,
        multiple: 1,
        degree: 2,
    },
    Frame {
        label: "pinch 1e-28",
        re: "-0.74501772828897655304632685480388684",
        im: "0.14993443275858764694789167606226721",
        width: 1e-28,
        maxiter: 117_518,
        multiple: 1,
        degree: 2,
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
        degree: 2,
    },
    Frame {
        label: "body 1e-22",
        re: "-0.745017728288852579046129865858",
        im: "0.149934432757626550615361778382",
        width: 1e-22,
        maxiter: 374_400,
        multiple: 4,
        degree: 2,
    },
    Frame {
        label: "body 1e-28",
        re: "-0.74501772828885257904614927236638684",
        im: "0.14993443275762655061538134007789221",
        width: 1e-28,
        maxiter: 470_072,
        multiple: 4,
        degree: 2,
    },
];

/// The frame as the Deep tab would be asked for it, after `explorer/?`.
///
/// Derived rather than typed, for the reason every other link on this site is:
/// a centre written twice is a centre that can disagree with itself, and the
/// one in the row above is the one the numbers were taken at.
pub fn link(frame: &Frame) -> String {
    // Degree two as it was always written, `dv=2`, which the page still reads; a
    // higher degree needs `f`, which is the deep contract's v3.
    let head = if frame.degree == 2 {
        "dv=2".to_string()
    } else {
        format!("dv=3&f=multibrot{}", frame.degree)
    };
    format!(
        "{head}&x={}&y={}&w=1e-{}&n={}",
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
    /// The degree of `z^d + c`.
    pub degree: u32,
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
            degree: 2,
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
        degree: 2,
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

/// **The deep frames at degrees three to six** *(deep_degrees_ckpt140)*: the same
/// seven kinds of frame as [`DEEP_FRAMES`], found the same way.
///
/// `tests/descend.rs`'s `descend_to_deep_frames_at_a_degree`, one run a degree,
/// from that degree's island pin at 1e-11 (`DEGREE_STARTS` there, [`PINS`] here)
/// and down the tangle, pinch and body routes. What is kept is what `DEEP_FRAMES` keeps at degree two — tangle 1e-22,
/// 1e-28, 1e-40 and 1e-54, pinch 1e-28, and the two body frames at four times the
/// policy cap — so a table at one degree reads against the table at another row
/// for row. The cap policy's plateau and the interior floor are swept over these.
pub const DEGREE_FRAMES: &[Frame] = &[
    // DEGREE_FRAMES_BEGIN
    Frame {
        label: "tangle 1e-22",
        re: "-0.340625023898760234171805700925",
        im: "1.271229851872501068040291958815",
        width: 1e-22,
        maxiter: 93_600,
        multiple: 1,
        degree: 3,
    },
    Frame {
        label: "tangle 1e-28",
        re: "-0.3406250238987602341718262542609375",
        im: "1.2712298518725010680403152453696875",
        width: 1e-28,
        maxiter: 117_518,
        multiple: 1,
        degree: 3,
    },
    Frame {
        label: "tangle 1e-40",
        re: "-0.3406250238987602341718262542321568083579609375",
        im: "1.2712298518725010680403152454016209423447578125",
        width: 1e-40,
        maxiter: 165_354,
        multiple: 1,
        degree: 3,
    },
    Frame {
        label: "pinch 1e-28",
        re: "-0.3406250238980782571419349051984375",
        im: "1.2712298518735892308443788026196875",
        width: 1e-28,
        maxiter: 117_518,
        multiple: 1,
        degree: 3,
    },
    Frame {
        label: "tangle 1e-54",
        re: "-0.340625023898760234171826254232156808357943993790096253515625",
        im: "1.271229851872501068040315245401620942344765705390226025859375",
        width: 1e-54,
        maxiter: 221_162,
        multiple: 1,
        degree: 3,
    },
    Frame {
        label: "body 1e-22",
        re: "-0.340625023898767139691352575925",
        im: "1.271229851872539678627838833815",
        width: 1e-22,
        maxiter: 374_400,
        multiple: 4,
        degree: 3,
    },
    Frame {
        label: "body 1e-28",
        re: "-0.3406250238987671396913635659015625",
        im: "1.2712298518725396786278241732915625",
        width: 1e-28,
        maxiter: 470_072,
        multiple: 4,
        degree: 3,
    },
    Frame {
        label: "tangle 1e-22",
        re: "-1.084215082747245276018633006823",
        im: "0.290514556109782469750415216417",
        width: 1e-22,
        maxiter: 93_600,
        multiple: 1,
        degree: 4,
    },
    Frame {
        label: "tangle 1e-28",
        re: "-1.0842150827472452760186477286433125",
        im: "0.2905145561097824697503754932841875",
        width: 1e-28,
        maxiter: 117_518,
        multiple: 1,
        degree: 4,
    },
    Frame {
        label: "tangle 1e-40",
        re: "-1.0842150827472452760186477286446576742119140625",
        im: "0.2905145561097824697503754932925986641428203125",
        width: 1e-40,
        maxiter: 165_354,
        multiple: 1,
        degree: 4,
    },
    Frame {
        label: "pinch 1e-28",
        re: "-1.0842150827473777523423712290964375",
        im: "0.2905145561097111803715572745810625",
        width: 1e-28,
        maxiter: 117_518,
        multiple: 1,
        degree: 4,
    },
    Frame {
        label: "tangle 1e-54",
        re: "-1.084215082747245276018647728644657674211920644027785620859375",
        im: "0.290514556109782469750375493292598664142807683482494413984375",
        width: 1e-54,
        maxiter: 221_162,
        multiple: 1,
        degree: 4,
    },
    Frame {
        label: "body 1e-22",
        re: "-1.084215082747245124011633006823",
        im: "0.290514556109751933967383966417",
        width: 1e-22,
        maxiter: 374_400,
        multiple: 4,
        degree: 4,
    },
    Frame {
        label: "body 1e-28",
        re: "-1.0842150827472451240116581303933125",
        im: "0.2905145561097519339673801825654375",
        width: 1e-28,
        maxiter: 470_072,
        multiple: 4,
        degree: 4,
    },
    Frame {
        label: "tangle 1e-22",
        re: "-0.887826199618715930869574574631",
        im: "0.544060594138298891586804446989",
        width: 1e-22,
        maxiter: 93_600,
        multiple: 1,
        degree: 5,
    },
    Frame {
        label: "tangle 1e-28",
        re: "-0.8878261996187159308695538640606875",
        im: "0.5440605941382988915868246804343125",
        width: 1e-28,
        maxiter: 117_518,
        multiple: 1,
        degree: 5,
    },
    Frame {
        label: "tangle 1e-40",
        re: "-0.8878261996187159308695538640917728500029921875",
        im: "0.5440605941382988915868246804138956270278984375",
        width: 1e-40,
        maxiter: 165_354,
        multiple: 1,
        degree: 5,
    },
    Frame {
        label: "pinch 1e-28",
        re: "-0.8878261996185125802562794865606875",
        im: "0.5440605941383281888832624905905625",
        width: 1e-28,
        maxiter: 117_518,
        multiple: 1,
        degree: 5,
    },
    Frame {
        label: "tangle 1e-54",
        re: "-0.887826199618715930869553864091772850002956453437043331796875",
        im: "0.544060594138298891586824680413895627027934585266413727421875",
        width: 1e-54,
        maxiter: 221_162,
        multiple: 1,
        degree: 5,
    },
    Frame {
        label: "body 1e-22",
        re: "-0.887826199618712926642230824631",
        im: "0.544060594138304480228726321989",
        width: 1e-22,
        maxiter: 374_400,
        multiple: 4,
        degree: 5,
    },
    Frame {
        label: "body 1e-28",
        re: "-0.8878261996187129266422396680919375",
        im: "0.5440605941383044802287059596530625",
        width: 1e-28,
        maxiter: 470_072,
        multiple: 4,
        degree: 5,
    },
    Frame {
        label: "tangle 1e-22",
        re: "-0.97814760030409143375984930042",
        im: "0.207911690569975076968217298648",
        width: 1e-22,
        maxiter: 93_600,
        multiple: 1,
        degree: 6,
    },
    Frame {
        label: "tangle 1e-28",
        re: "-0.9781476003040914337598312680996875",
        im: "0.2079116905699750769682179078120625",
        width: 1e-28,
        maxiter: 117_518,
        multiple: 1,
        degree: 6,
    },
    Frame {
        label: "tangle 1e-40",
        re: "-0.9781476003040914337598312681419437890025390625",
        im: "0.2079116905699750769682179077864814427233515625",
        width: 1e-40,
        maxiter: 165_354,
        multiple: 1,
        degree: 6,
    },
    Frame {
        label: "pinch 1e-28",
        re: "-0.9781476002959672129150508627403125",
        im: "0.2079116905712067999932501301245625",
        width: 1e-28,
        maxiter: 117_518,
        multiple: 1,
        degree: 6,
    },
    Frame {
        label: "tangle 1e-54",
        re: "-0.978147600304091433759831268141943789002568595083169304921875",
        im: "0.207911690569975076968217907786481442723335463836722352109375",
        width: 1e-54,
        maxiter: 221_162,
        multiple: 1,
        degree: 6,
    },
    Frame {
        label: "body 1e-22",
        re: "-0.97814760030409144112567742542",
        im: "0.207911690569975189726904798648",
        width: 1e-22,
        maxiter: 374_400,
        multiple: 4,
        degree: 6,
    },
    Frame {
        label: "body 1e-28",
        re: "-0.9781476003040914411256336627403125",
        im: "0.2079116905699751897269378488901875",
        width: 1e-28,
        maxiter: 470_072,
        multiple: 4,
        degree: 6,
    },
    // DEGREE_FRAMES_END
];

/// The frames at one degree: [`DEEP_FRAMES`] at two, and that degree's rows of
/// [`DEGREE_FRAMES`] above it.
pub fn frames_at(degree: u32) -> Vec<&'static Frame> {
    if degree == 2 {
        DEEP_FRAMES.iter().collect()
    } else {
        DEGREE_FRAMES
            .iter()
            .filter(|frame| frame.degree == degree)
            .collect()
    }
}

/// Each degree's `M(2,1)` Misiurewicz point, to 45 digits — the `c = i` control's
/// counterpart: a deep boundary frame genuinely finished at the policy cap.
pub const M21: &[(u32, &str, &str)] = &[
    (
        3,
        "-0.340625019316606640194394244037830888977210103",
        "1.27122987841870623913561299102106497672841433",
    ),
    (
        4,
        "-1.08421508149135118187966600826108320387999295",
        "0.290514555507251444503813188624929073684246285",
    ),
    (
        5,
        "-0.887826199632931252074933435849640258600100571",
        "0.544060594866340874808016663435373936434552876",
    ),
    (
        6,
        "-0.978147600733805637928566747869599532459737809",
        "0.207911690817759337101742284405125166216584761",
    ),
];

/// **Each degree's island pin** *(deep_degrees_ckpt140)*: a minibrot of about 1e-12
/// found off that degree's `M(2,1)`, whose body `nuclei`'s size estimate was held
/// to an area measured without it — `nuclei.rs`'s pin tests and the crate README
/// §10. `(degree, period, re, im, body)`, the body being the measured one.
pub const PINS: &[(u32, u32, &str, &str, f64)] = &[
    (
        3,
        12,
        "-0.340625023896664202920126013425",
        "1.271229851873307358570127896315",
        3.4792e-12,
    ),
    (
        4,
        13,
        "-1.084215082746655198570484569323",
        "0.290514556108830899669391778917",
        1.4068e-12,
    ),
    (
        5,
        13,
        "-0.887826199618012593110848012131",
        "0.544060594135647520437421634489",
        3.4052e-12,
    ),
    (
        6,
        13,
        "-0.978147600299778310338872737920",
        "0.207911690569371132751240736148",
        5.9105e-12,
    ),
];

/// The controls at a degree: [`CONTROL_FRAMES`] at two, and above it their
/// counterparts — the island pin at about three bodies, as the anchor at 2e-11 is
/// about three atoms; that island at 1e-22, inside its body; the degree's `M(2,1)`
/// at 1e-22; the whole set; and the Julia set of the pin's `c` at 2e-9.
pub fn controls_at(degree: u32) -> Vec<Control> {
    if degree == 2 {
        return CONTROL_FRAMES.to_vec();
    }
    let &(_, _, re, im, body) = PINS.iter().find(|pin| pin.0 == degree).expect("a pin");
    let &(_, m_re, m_im) = M21.iter().find(|m| m.0 == degree).expect("an M(2,1)");
    let at = |label: &'static str, re: &'static str, im: &'static str, width: f64, julia: bool| {
        Control {
            label,
            re,
            im,
            width,
            julia,
            degree,
        }
    };
    vec![
        at("island 3 bodies", re, im, 3.0 * body, false),
        at("island 1e-22", re, im, 1e-22, false),
        at("misiurewicz 1e-22", m_re, m_im, 1e-22, false),
        at("home 3", "0", "0", 3.0, false),
        at("julia island 2e-9", re, im, 2e-9, true),
    ]
}

/// The seven and the six as one list.
pub fn every_frame() -> Vec<Control> {
    every_frame_at(2)
}

/// The same at one degree.
pub fn every_frame_at(degree: u32) -> Vec<Control> {
    frames_at(degree)
        .into_iter()
        .map(Frame::control)
        .chain(controls_at(degree))
        .collect()
}

/// The degree a measurement is asked at: `MEASURE_DEGREE`, or two.
///
/// An environment variable rather than a test per degree, so that the four can run
/// side by side, each a few minutes to an hour, and the default run is the table
/// the README has always carried.
pub fn measure_degree() -> u32 {
    std::env::var("MEASURE_DEGREE")
        .ok()
        .and_then(|text| text.parse().ok())
        .unwrap_or(2)
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
        degree: frame.degree,
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
            each(kernel.sample_at(spec.degree, julia, re, im));
        }
    }
}

/// Every cell of a spec's own sample grid, which is [`walk_cells`] asked for the
/// grid it already has.
pub fn walk_frame(spec: &Spec, orbit: &Reference, each: impl FnMut(Outcome)) {
    let (cols, rows) = (spec.sample_width(), spec.sample_height());
    walk_cells(spec, orbit, cols, rows, 0, rows, each);
}
