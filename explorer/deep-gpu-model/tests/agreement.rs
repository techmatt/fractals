//! The model against `perturb`'s `f64` kernel, on frames the site draws.
//!
//! Two kinds of ruling, and each test says which it makes.
//!
//! - **Strict**, on well-conditioned frames, where the `f64` field does not move when its
//!   inputs move by an `f32` rounding: at least 99% of the samples both kernels escape at
//!   agree to within 0.1 of a smooth count, and no sample changes class.
//! - **At the floor**, on frames whose field is sensitive at that scale (most of the Deep
//!   tab's dives, whose pictures are boundary from edge to edge). There the `f64` kernel
//!   disagrees with itself as soon as its reference is rounded to `f32` and nothing else
//!   changes ([`narrowed_reference`]), and the model is held to that: its share of samples
//!   more than 0.1 apart is at most twice that floor's share plus two points, and its
//!   class changes at most twice the floor's plus half a percent of the frame. The factor
//!   of two is the model's second error source of the same size, `f32` arithmetic on the
//!   delta, which the floor does not have. Where the floor is already high that doubling
//!   would allow everything, so each allowance is also capped at the floor plus ten points
//!   (shares) or plus five points (class changes), which keeps the ruling one a model can
//!   fail on every row. The measured numbers at 64x36 are in each test's comment; none of
//!   these frames sits at its tolerance.
//! - **No class changes where the floor has none**, on the frames that exercise the
//!   careful step: a reference point at zero (Julia frames anchored at `z = 0`, deep
//!   enough that the delta is scaled from the first step) and opened minibrots at degree
//!   five, centred on the nucleus, with and without the period.
//!
//! All frames are rows of the site's own records (`explorer/random-dives.jsonl`,
//! `builder/data/deep-judges-scores.jsonl`, `explorer/deep-gallery.jsonl`,
//! `article/figure-recipes.jsonl`) or `perturb`'s own deep test frames, spelled out here.

use deep_gpu_model::compare::{
    Agreement, FrameSpec, ModelField, agree, narrowed_reference, run_f64, run_model,
};
use deep_gpu_model::model::{self, INTERIOR, RUNNING};
use deep_gpu_model::{Encoding, Frame, GpuOrbit};

const THREADS: usize = 8;

struct Measured {
    model: Agreement,
    floor: Agreement,
    field: ModelField,
}

fn measure(row: &str, res: [u32; 2], cap: Option<u32>, interior: bool, enc: Encoding) -> Measured {
    let fs = FrameSpec::from_row(row).unwrap();
    let spec = fs.spec(res, cap, interior);
    let orbit = spec.reference_orbit().unwrap();
    let f64_field = run_f64(&spec, &orbit, THREADS);
    let floor_field = run_f64(&spec, &narrowed_reference(&orbit), THREADS);
    let gpu = GpuOrbit::from_reference(&orbit, enc);
    let frame = Frame::from_spec(&spec, gpu.len()).unwrap();
    let field = run_model(&frame, &gpu, THREADS, u32::MAX);
    Measured {
        model: agree(&f64_field.smooth, &field.smooth),
        floor: agree(&f64_field.smooth, &floor_field.smooth),
        field,
    }
}

fn strict(row: &str, res: [u32; 2], cap: Option<u32>) {
    for enc in [Encoding::F32Pair, Encoding::HiLo] {
        let m = measure(row, res, cap, true, enc);
        let a = &m.model;
        assert!(a.both_escaped > 0, "{row}: nothing escaped");
        assert!(
            a.within_tenth() >= 0.99,
            "{row} {enc:?}: {:.4} within 0.1",
            a.within_tenth()
        );
        assert_eq!(
            a.f64_only_escaped + a.model_only_escaped,
            0,
            "{row} {enc:?}: class changes"
        );
        assert_eq!(m.field.nonfinite, 0);
    }
}

fn at_floor(row: &str, res: [u32; 2], cap: Option<u32>) -> Measured {
    let mut last = None;
    for enc in [Encoding::F32Pair, Encoding::HiLo] {
        let m = measure(row, res, cap, true, enc);
        let (a, f) = (&m.model, &m.floor);
        assert!(a.both_escaped > 0, "{row}: nothing escaped");
        assert!(
            a.over[1] <= (2.0 * f.over[1] + 0.02).min(f.over[1] + 0.10),
            "{row} {enc:?}: {:.4} over 0.1 against a floor of {:.4}",
            a.over[1],
            f.over[1]
        );
        let changes = a.mismatch_share();
        let floor_changes = f.mismatch_share();
        assert!(
            changes <= (2.0 * floor_changes + 0.005).min(floor_changes + 0.05),
            "{row} {enc:?}: class changes {changes:.4} against a floor of {floor_changes:.4}"
        );
        assert_eq!(m.field.nonfinite, 0, "{row} {enc:?}: a delta left f32");
        last = Some(m);
    }
    last.unwrap()
}

const RES: [u32; 2] = [64, 36];

// ---- degree two, shallow.

/// The Misiurewicz figure's parameter-plane panel, 3e-3. Measured: 99.9% within 0.1
/// with either encoding, no class changes.
#[test]
fn shallow_misiurewicz_is_strict() {
    strict(
        r#"{"id": "figure:math-misiurewicz-pairs#3", "re": "-0.1010963638456221610257854", "im": "0.9562865108091415007710961", "w": 0.003, "n": 15958, "degree": 2}"#,
        RES,
        None,
    );
}

/// The home view, width 3. Measured: 99.6% within 0.1, no class changes.
#[test]
fn home_view_is_strict() {
    strict(
        r#"{"id": "figure:deep-descent-rungs#1", "re": "-0.5", "im": "0", "w": 3.0, "n": 4000, "degree": 2}"#,
        RES,
        None,
    );
}

/// Shallow dives, 4e-4 down to 7e-9. These are boundary from edge to edge and do not
/// hold the strict ruling: measured over 0.1 (f32pair / hilo / floor) 3.1% / 2.7% / 2.7%
/// at 4e-4, 13.0% / 12.6% / 12.4% at 1.3e-4, 1.9% / 1.9% / 1.6% at 1.9e-5, and
/// 22.4% / 22.3% / 14.0% at 7.3e-9; no class changes on any of them.
#[test]
fn shallow_dives_sit_at_the_floor() {
    for row in [
        r#"{"id": "random-dives#360", "re": "-0.77835109286356332696", "im": "-0.13683221767788043204", "w": 0.00039948129891142207, "n": 19449, "degree": 2}"#,
        r#"{"id": "random-dives#9", "re": "-0.74644891464091792817", "im": "-0.11090703609776693008", "w": 0.00013230358144154355, "n": 21362, "degree": 2}"#,
        r#"{"id": "figure:deep-descent-rungs#3", "re": "-0.782601462031970873215191715691", "im": "0.150070431906352576566418312168", "w": 1.94e-05, "n": 24686, "degree": 2}"#,
        r#"{"id": "random-dives#5", "re": "-0.75765813056425443555", "im": "0.07282660995819819077", "w": 7.255822008177002e-09, "n": 38347, "degree": 2}"#,
    ] {
        let m = at_floor(row, RES, None);
        assert!(m.model.p50 < 1e-2, "{row}: median {}", m.model.p50);
    }
}

// ---- deep: the scaled delta.

/// A degree-five dive at 6.1e-24, well conditioned. Measured: 99.8% within 0.1, no class
/// changes, median 1e-6.
#[test]
fn deep_degree_five_is_strict() {
    strict(
        r#"{"id": "dive-sheet:u0022", "re": "0.52093689271739730953818398045212", "im": "0.63474437559861043650730586091996", "w": 6.112854140377199e-24, "n": 593070, "degree": 5}"#,
        RES,
        Some(120_000),
    );
}

/// The corpus's deepest frame, 8.66e-42 at degree five: a pixel step of about `2^-145`,
/// below `f32`'s normal range, so every pixel starts scaled. Measured: 20.6% over 0.1
/// against a floor of 19.5%, median 6e-4, no class changes, every delta finite.
#[test]
fn deepest_corpus_frame_sits_at_the_floor() {
    let row = r#"{"id": "random-dives#501", "re": "0.64774731161734500930901700212431872380828355273804", "im": "0.51776563981107259688773400463987628082965300802274", "w": 8.662732633712781e-42, "n": 1471930, "degree": 5}"#;
    let m = at_floor(row, RES, Some(120_000));
    assert!(m.model.p50 < 1e-2);
    assert_eq!(m.model.f64_only_escaped + m.model.model_only_escaped, 0);
}

/// `perturb`'s own deep frames at 1e-28, 1e-40 and 1e-54 (the deepest a link spells), at
/// their own caps. These frames are dominated by samples that escape within a few
/// percent of a cap of 1e5, and an `f32` rounding of the reference alone moves 84% to
/// 89% of them by more than 0.1, so the share ruling says little here (it allows the
/// floor plus ten points) and the class-change ruling (the floor plus five points, against
/// 11% to 15% measured for both) carries them. Mostly a smoke test: every delta stays
/// finite at the link's depth, and the frame's shared exponent is as deep as claimed.
#[test]
fn link_depth_frames_stay_finite_smoke() {
    for (row, sc_below) in [
        (
            r#"{"id": "tangle-1e-28", "re": "-0.74501772829019861929877929889763684", "im": "0.14993443275689704583350282968726721", "w": 1e-28, "n": 117518, "degree": 2}"#,
            -90,
        ),
        (
            r#"{"id": "tangle-1e-40", "re": "-0.7450177282901986192987792989188510315333046875", "im": "0.1499344327568970458335028296517884911675546875", "w": 1e-40, "n": 165354, "degree": 2}"#,
            -130,
        ),
        (
            r#"{"id": "tangle-1e-54", "re": "-0.745017728290198619298779298918851031533262270733325571484375", "im": "0.149934432756897045833502829651788491167588360989048041953125", "w": 1e-54, "n": 221162, "degree": 2}"#,
            -175,
        ),
    ] {
        let m = at_floor(row, [32, 18], None);
        assert!(m.model.both_escaped > 0);
        // The frame's shared exponent is where the scaling starts.
        let fs = FrameSpec::from_row(row).unwrap();
        let spec = fs.spec([32, 18], None, true);
        let orbit = spec.reference_orbit().unwrap();
        let frame = Frame::from_spec(&spec, orbit.len()).unwrap();
        assert!(frame.sc < sc_below, "{row}: sc {}", frame.sc);
    }
}

// ---- the careful step: a reference point at zero.

fn no_class_changes(row: &str, res: [u32; 2], cap: Option<u32>) -> Measured {
    let mut last = None;
    for enc in [Encoding::F32Pair, Encoding::HiLo] {
        let m = measure(row, res, cap, true, enc);
        let (a, f) = (&m.model, &m.floor);
        assert!(a.both_escaped > 0, "{row}: nothing escaped");
        assert_eq!(f.f64_only_escaped + f.model_only_escaped, 0, "{row}: floor");
        assert_eq!(
            a.f64_only_escaped + a.model_only_escaped,
            0,
            "{row} {enc:?}: class changes"
        );
        assert!(
            a.over[1] <= (2.0 * f.over[1] + 0.02).min(f.over[1] + 0.10),
            "{row} {enc:?}: {:.4} over 0.1 against a floor of {:.4}",
            a.over[1],
            f.over[1]
        );
        assert_eq!(m.field.nonfinite, 0, "{row} {enc:?}: a delta left f32");
        last = Some(m);
    }
    last.unwrap()
}

/// Julia sets anchored at `z = 0`, deep enough that the first step is taken at `Z = 0`
/// with a delta far below `f32`'s normal range: `δ' = δ^D` there, which a delta formed
/// unscaled flushes to zero, pinning every pixel to the reference (before the careful
/// step, 576 of 576 samples of the `c = i` frame capped from 1e-29 down). Measured: every
/// sample within 0.1, median 2e-7 or better, at degree two (1e-30 and 1e-45), three
/// (1e-30) and four (1e-40).
#[test]
fn deep_origin_anchored_julia_is_strict() {
    for row in [
        r#"{"id": "julia-i-origin-1e-30", "re": "0", "im": "0", "w": 1e-30, "n": 20000, "degree": 2, "julia_re": "0", "julia_im": "1", "anchor": "origin"}"#,
        r#"{"id": "julia-i-origin-1e-45", "re": "0", "im": "0", "w": 1e-45, "n": 20000, "degree": 2, "julia_re": "0", "julia_im": "1", "anchor": "origin"}"#,
        r#"{"id": "julia-deg3-origin-1e-30", "re": "0", "im": "0", "w": 1e-30, "n": 20000, "degree": 3, "julia_re": "-0.6352281642333808681320495886221720723227", "julia_im": "0.6451971639494320595845265674548798440034", "anchor": "origin"}"#,
        r#"{"id": "julia-deg4-origin-1e-40", "re": "0", "im": "0", "w": 1e-40, "n": 20000, "degree": 4, "julia_re": "0.3261226732769710318848390308533958858192", "julia_im": "1.1187243018613215064422951991895119177729", "anchor": "origin"}"#,
    ] {
        strict(row, RES, None);
    }
}

/// Opened minibrots at degree five near the corpus's deepest frame (`random-dives#501`),
/// framed at three copy widths with `perturb::nuclei`'s own cap, centred on the nucleus
/// and so passing `Z` within `1e-38` of zero once a period. Before the careful step, 64
/// (period 3116, 1.5e-40) and 140 (period 3154, 2.6e-41) of 2304 samples capped where
/// `perturb` escapes, with the period and without. Measured now (HiLo): no class
/// changes, over 0.1 44.0% against a floor of 40.0%, and 43.3% against 39.8%.
#[test]
fn opened_minibrots_keep_their_class() {
    let p3116 = r#""re": "0.64774731161734500930901700212431871126941013022100244438793490777767414164458935", "im": "0.51776563981107259688773400463987632330403073150911819396055504521478466034303479", "w": 1.474220271796546e-40, "n": 164682, "degree": 5"#;
    let p3154 = r#""re": "0.64774731161734500930901700212431876329709917253092852493769733266465291532194779", "im": "0.51776563981107259688773400463987630602838684158625737878059063620910912332992829", "w": 2.6311062492484754e-41, "n": 167666, "degree": 5"#;
    for row in [
        format!(r#"{{"id": "nucleus-3116", {p3116}}}"#),
        format!(r#"{{"id": "nucleus-3116-periodic", {p3116}, "period": 3116}}"#),
        format!(r#"{{"id": "nucleus-3154", {p3154}}}"#),
        format!(r#"{{"id": "nucleus-3154-periodic", {p3154}, "period": 3154}}"#),
    ] {
        no_class_changes(&row, RES, None);
    }
}

// ---- Julia, both anchors, and the other degrees.

/// The Misiurewicz figure's Julia panels: degree two at 2.4e-3 (anchor `z = c`) and at
/// 4.4 (anchor `z = 0`), degree three and four at 3 (`z = 0`). Measured: all within 0.1
/// at 99.9% or better, no class changes.
#[test]
fn julia_panels_are_strict() {
    for row in [
        r#"{"id": "figure:math-misiurewicz-pairs#2", "re": "-0.1010963638456221610257854", "im": "0.9562865108091415007710961", "w": 0.0024101, "n": 16337, "degree": 2, "julia_re": "-0.1010963638456221610257854", "julia_im": "0.9562865108091415007710961", "anchor": "parameter"}"#,
        r#"{"id": "figure:math-misiurewicz-pairs#1", "re": "0", "im": "0", "w": 4.4, "n": 3336, "degree": 2, "julia_re": "-0.1010963638456221610257854", "julia_im": "0.9562865108091415007710961", "anchor": "origin"}"#,
        r#"{"id": "figure:math-misiurewicz-pairs#4", "re": "0", "im": "0", "w": 3.0, "n": 4000, "degree": 3, "julia_re": "-0.6352281642333808681320495886221720723227", "julia_im": "0.6451971639494320595845265674548798440034", "anchor": "origin"}"#,
        r#"{"id": "figure:math-misiurewicz-pairs#7", "re": "0", "im": "0", "w": 3.0, "n": 4000, "degree": 4, "julia_re": "0.3261226732769710318848390308533958858192", "julia_im": "1.1187243018613215064422951991895119177729", "anchor": "origin"}"#,
    ] {
        strict(row, RES, None);
    }
}

/// Deeper Julia and higher-degree frames: degree three at 5.5e-16 (Julia, `z = c`) and
/// 5.2e-16, degree four at 4.2e-16 (Julia) and 2e-16, a degree-two Julia at 7.8e-8
/// anchored at `z = 0`, degree four at 1.3e-8 and degree six at 7.3e-7. Measured over
/// 0.1 against the floor: 17.4% / 11.0%, 17.5% / 10.7%, 13.2% / 13.4%, 13.6% / 13.7%,
/// 42.0% / 39.9%, 5.2% / 6.1%, 11.5% / 11.5%.
#[test]
fn julia_and_higher_degrees_sit_at_the_floor() {
    for row in [
        r#"{"id": "figure:math-misiurewicz-pairs#5", "re": "-0.6352281642333808681320495886221720723227", "im": "0.6451971639494320595845265674548798440034", "w": 5.4912e-16, "n": 66734, "degree": 3, "julia_re": "-0.6352281642333808681320495886221720723227", "julia_im": "0.6451971639494320595845265674548798440034", "anchor": "parameter"}"#,
        r#"{"id": "figure:math-misiurewicz-pairs#6", "re": "-0.6352281642333808681320495886221720723227", "im": "0.6451971639494320595845265674548798440034", "w": 5.2e-16, "n": 66828, "degree": 3}"#,
        r#"{"id": "figure:math-misiurewicz-pairs#8", "re": "0.3261226732769710318848390308533958858192", "im": "1.1187243018613215064422951991895119177729", "w": 4.1606e-16, "n": 67214, "degree": 4, "julia_re": "0.3261226732769710318848390308533958858192", "julia_im": "1.1187243018613215064422951991895119177729", "anchor": "parameter"}"#,
        r#"{"id": "figure:math-misiurewicz-pairs#9", "re": "0.3261226732769710318848390308533958858192", "im": "1.1187243018613215064422951991895119177729", "w": 2e-16, "n": 68482, "degree": 4}"#,
        r#"{"id": "deep-gallery#33", "re": "0", "im": "0", "w": 7.787286674045785e-08, "n": 34239, "degree": 2, "julia_re": "-0.74937053247003823168823992075369", "julia_im": "0.041472667068168900034718746387049", "anchor": "origin"}"#,
        r#"{"id": "random-dives#383", "re": "0.34018094765382520266", "im": "0.93142588267984900703", "w": 1.3028531819017359e-08, "n": 37334, "degree": 4}"#,
        r#"{"id": "dive-sheet:u0496", "re": "0.84705383614488507118", "im": "0.45497047478211847321", "w": 7.284373984668588e-07, "n": 30368, "degree": 6}"#,
    ] {
        at_floor(row, RES, None);
    }
}

/// With the switch off, nothing is proven interior: the long-orbit frames need this.
#[test]
fn interior_switch_turns_off() {
    let row = r#"{"id": "figure:deep-descent-rungs#1", "re": "-0.5", "im": "0", "w": 3.0, "n": 4000, "degree": 2}"#;
    let on = measure(row, [48, 27], None, true, Encoding::F32Pair);
    let off = measure(row, [48, 27], None, false, Encoding::F32Pair);
    assert!(on.field.status.contains(&INTERIOR));
    assert!(!off.field.status.contains(&INTERIOR));
    assert_eq!(off.model.f64_only_escaped + off.model.model_only_escaped, 0);
}

// ---- passes.

/// Running a pixel in passes of 1, 3 or 1000 steps leaves exactly the state one
/// unbounded pass does, bit for bit, on frames that scale, rebase, take the careful
/// step, wrap a periodic reference's index, and run both planes and both encodings.
#[test]
fn passes_are_bit_identical_whatever_the_budget() {
    for row in [
        r#"{"id": "random-dives#501", "re": "0.64774731161734500930901700212431872380828355273804", "im": "0.51776563981107259688773400463987628082965300802274", "w": 8.662732633712781e-42, "n": 20000, "degree": 5}"#,
        r#"{"id": "random-dives#5", "re": "-0.75765813056425443555", "im": "0.07282660995819819077", "w": 7.255822008177002e-09, "n": 38347, "degree": 2}"#,
        r#"{"id": "deep-gallery#33", "re": "0", "im": "0", "w": 7.787286674045785e-08, "n": 34239, "degree": 2, "julia_re": "-0.74937053247003823168823992075369", "julia_im": "0.041472667068168900034718746387049", "anchor": "origin"}"#,
        r#"{"id": "figure:math-misiurewicz-pairs#2", "re": "-0.1010963638456221610257854", "im": "0.9562865108091415007710961", "w": 0.0024101, "n": 16337, "degree": 2, "julia_re": "-0.1010963638456221610257854", "julia_im": "0.9562865108091415007710961", "anchor": "parameter"}"#,
        r#"{"id": "julia-i-origin-1e-35", "re": "0", "im": "0", "w": 1e-35, "n": 20000, "degree": 2, "julia_re": "0", "julia_im": "1", "anchor": "origin"}"#,
        r#"{"id": "nucleus-3116-periodic", "re": "0.64774731161734500930901700212431871126941013022100244438793490777767414164458935", "im": "0.51776563981107259688773400463987632330403073150911819396055504521478466034303479", "w": 1.474220271796546e-40, "n": 20000, "degree": 5, "period": 3116}"#,
    ] {
        let fs = FrameSpec::from_row(row).unwrap();
        let spec = fs.spec([16, 9], None, true);
        let orbit = spec.reference_orbit().unwrap();
        for enc in [Encoding::F32Pair, Encoding::HiLo] {
            let gpu = GpuOrbit::from_reference(&orbit, enc);
            let frame = Frame::from_spec(&spec, gpu.len()).unwrap();
            let mut rebased = 0;
            for row_i in 0..9 {
                for col in 0..16 {
                    let whole = model::run_pixel(&frame, &gpu, col, row_i, u32::MAX);
                    rebased += whole.rebases;
                    for budget in [1u32, 3, 1000] {
                        let mut st = model::init(&frame, col, row_i);
                        let mut passes = 0u64;
                        while st.status == RUNNING {
                            let took = model::pass(&mut st, &frame, &gpu, col, row_i, budget);
                            assert!(took <= budget);
                            passes += 1;
                        }
                        assert_eq!(
                            st.bits(),
                            whole.bits(),
                            "{row} {enc:?} {col},{row_i} budget {budget}"
                        );
                        assert_eq!(st.proof.bits(), whole.proof.bits());
                        assert!(passes >= (whole.steps as u64).div_ceil(budget as u64));
                    }
                }
            }
            assert!(
                rebased > 0,
                "{row}: no pixel rebased, so the test proves less than it says"
            );
        }
    }
}

/// At 8.66e-42 every pixel starts in the scaled regime and leaves it.
#[test]
fn deepest_frame_starts_scaled_and_unscales() {
    let row = r#"{"id": "random-dives#501", "re": "0.64774731161734500930901700212431872380828355273804", "im": "0.51776563981107259688773400463987628082965300802274", "w": 8.662732633712781e-42, "n": 20000, "degree": 5}"#;
    let fs = FrameSpec::from_row(row).unwrap();
    let spec = fs.spec([16, 9], None, true);
    let orbit = spec.reference_orbit().unwrap();
    let gpu = GpuOrbit::from_reference(&orbit, Encoding::F32Pair);
    let frame = Frame::from_spec(&spec, gpu.len()).unwrap();
    for col in [0u32, 7, 15] {
        let mut st = model::init(&frame, col, 4);
        model::pass(&mut st, &frame, &gpu, col, 4, 1);
        assert!(st.s < -100, "after one step, s = {}", st.s);
        while st.status == RUNNING && st.s != 0 {
            model::pass(&mut st, &frame, &gpu, col, 4, 1);
        }
        assert_eq!(st.s, 0, "the delta never left the scaled regime");
        assert!(st.d[0].is_finite() && st.d[1].is_finite());
    }
}
