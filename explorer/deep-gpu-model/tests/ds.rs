//! The double-single kernel (`src/model_ds.rs`), the survivors' way (`src/survivors.rs`),
//! and the skip applied to a double-single delta: passes, agreement with `perturb`'s
//! `f64` kernel against the `f32` model on the same frames, and what the survivors' driver
//! keeps and redoes.
//!
//! The agreement rulings are not the floor rulings of `tests/agreement.rs`: the
//! double-single kernel reads the reference to 48 bits and carries the delta to 48, so it
//! is held to beating the `f32` model by orders of magnitude in the median and to a share
//! more than 0.1 off well under the `f64` kernel's own on a reference rounded to `f32`.
//! Measured numbers are in each test's comment (64x36 unless said otherwise).

use deep_gpu_model::bla::{self, BlaLo, BlaOptions, GpuTable};
use deep_gpu_model::compare::{
    Agreement, FrameSpec, agree, narrowed_reference, run_f64, run_model, run_model_ds,
    run_model_survivors,
};
use deep_gpu_model::model::{BlaStats, RUNNING};
use deep_gpu_model::model_ds::{self, DsPixelState};
use deep_gpu_model::survivors;
use deep_gpu_model::{Encoding, Frame, FrameLo, GpuOrbit};

const THREADS: usize = 8;

struct Setup {
    spec: perturb::Spec,
    orbit: perturb::reference::Reference,
    pair: GpuOrbit,
    hilo: GpuOrbit,
    frame: Frame,
    lo: FrameLo,
}

fn setup(row: &str, res: [u32; 2], cap: Option<u32>) -> Setup {
    let fs = FrameSpec::from_row(row).unwrap();
    let spec = fs.spec(res, cap, true);
    let orbit = spec.reference_orbit().unwrap();
    let pair = GpuOrbit::from_reference(&orbit, Encoding::F32Pair);
    let hilo = GpuOrbit::from_reference(&orbit, Encoding::HiLo);
    let frame = Frame::from_spec(&spec, hilo.len()).unwrap();
    let lo = FrameLo::from_spec(&spec, &frame).unwrap();
    Setup {
        spec,
        orbit,
        pair,
        hilo,
        frame,
        lo,
    }
}

const DIVE_5: &str = r#"{"id": "random-dives#5", "re": "-0.75765813056425443555", "im": "0.07282660995819819077", "w": 7.255822008177002e-09, "n": 38347, "degree": 2}"#;
const DIVE_501: &str = r#"{"id": "random-dives#501", "re": "0.64774731161734500930901700212431872380828355273804", "im": "0.51776563981107259688773400463987628082965300802274", "w": 8.662732633712781e-42, "n": 1471930, "degree": 5}"#;
const MISIUREWICZ_JULIA: &str = r#"{"id": "figure:math-misiurewicz-pairs#5", "re": "-0.6352281642333808681320495886221720723227", "im": "0.6451971639494320595845265674548798440034", "w": 5.4912e-16, "n": 66734, "degree": 3, "julia_re": "-0.6352281642333808681320495886221720723227", "julia_im": "0.6451971639494320595845265674548798440034", "anchor": "parameter"}"#;
const DEGREE_SIX: &str = r#"{"id": "dive-sheet:u0496", "re": "0.84705383614488507118", "im": "0.45497047478211847321", "w": 7.284373984668588e-07, "n": 30368, "degree": 6}"#;
/// `scratch/gpu-model/corpus-unique.jsonl` line 2331: where stage 1 found `f32` furthest
/// past the rounded reference.
const JULIA3_END: &str = r#"{"id": "go:julia3-end", "re": "-0.584132815944058992898512215843141062", "im": "0.5924584988096639248232840130634390744", "w": 9.56660258469484e-19, "n": 1607102, "degree": 3, "julia_re": "-0.58413281594404725991481", "julia_im": "0.59245849880966115110917", "anchor": "parameter"}"#;

/// `f64`, the `f32` model on `F32Pair`, the `f64` kernel on the rounded reference, and
/// the double-single kernel, each against the first.
fn measure(row: &str, res: [u32; 2], cap: Option<u32>) -> (Agreement, Agreement, Agreement) {
    let s = setup(row, res, cap);
    let f64_field = run_f64(&s.spec, &s.orbit, THREADS);
    let floor = run_f64(&s.spec, &narrowed_reference(&s.orbit), THREADS);
    let f32_field = run_model(&s.frame, &s.pair, THREADS, u32::MAX);
    let ds_field = run_model_ds(&s.frame, &s.lo, &s.hilo, None, THREADS, u32::MAX);
    assert_eq!(ds_field.nonfinite, 0, "{row}: a delta left f32");
    (
        agree(&f64_field.smooth, &f32_field.smooth),
        agree(&f64_field.smooth, &floor.smooth),
        agree(&f64_field.smooth, &ds_field.smooth),
    )
}

/// Measured at 64x36 (median `|Δ smooth|` and share over 0.1; `f32` / rounded-reference
/// floor / DS): `random-dives#5` (7.3e-9, degree 2) 3.8e-3 22.4% / 5.8e-4 14.0% / 4.9e-8
/// 0.31%; `random-dives#501` (8.7e-42, degree 5, cap 1.2e5) 6.1e-4 20.6% / 5.0e-4 19.5% /
/// 2.8e-8 1.26%; the degree-three Misiurewicz Julia panel (5.5e-16) 2.3e-3 17.4% / 7.2e-4
/// 11.0% / 3.2e-8 0.04%; `dive-sheet:u0496` (7.3e-7, degree 6) 8.3e-5 11.6% / 7.0e-5
/// 11.5% / 2.4e-8 0.18%. No class changes in any column.
#[test]
fn double_single_agrees_far_more_closely_than_f32() {
    for (row, cap) in [
        (DIVE_5, None),
        (DIVE_501, Some(120_000)),
        (MISIUREWICZ_JULIA, None),
        (DEGREE_SIX, None),
    ] {
        let (f32a, floor, dsa) = measure(row, [64, 36], cap);
        eprintln!(
            "{}: f32 p50 {:.2e} over 0.1 {:.4}; floor p50 {:.2e} over 0.1 {:.4}; ds p50 {:.2e} over 0.1 {:.4}",
            &row[8..row[8..].find('"').unwrap() + 8],
            f32a.p50,
            f32a.over[1],
            floor.p50,
            floor.over[1],
            dsa.p50,
            dsa.over[1]
        );
        assert!(dsa.p50 < 1e-6 && dsa.p50 * 100.0 < f32a.p50, "{row}");
        assert!(
            dsa.over[1] < 0.02 && dsa.over[1] * 5.0 < floor.over[1],
            "{row}"
        );
        assert_eq!(dsa.f64_only_escaped + dsa.model_only_escaped, 0, "{row}");
    }
}

/// `go:julia3-end` at 16x9, where every sample of the `f32` model is more than 0.1 off
/// (median 921) and so is every sample of the `f64` kernel on the rounded reference
/// (median 101), and on its other anchor (median 1,039): the frame is chaotic at any
/// precision below `f64`'s. Measured: DS median 1.5e-3, 24.3% over 0.1, no class changes.
/// At 64x36: `f32` 947 and 99.96%, rounded floor 113 and 99.4%, DS 2.6e-3 and 29.1%.
#[test]
fn julia3_end_is_tracked_in_double_single() {
    let (f32a, floor, dsa) = measure(JULIA3_END, [16, 9], None);
    eprintln!(
        "go:julia3-end 16x9: f32 p50 {:.3e} over 0.1 {:.4}; floor p50 {:.3e} over 0.1 {:.4}; ds p50 {:.3e} over 0.1 {:.4}",
        f32a.p50, f32a.over[1], floor.p50, floor.over[1], dsa.p50, dsa.over[1]
    );
    assert!(f32a.over[1] > 0.9 && floor.over[1] > 0.9);
    assert!(dsa.p50 < 0.01 && dsa.over[1] < 0.4);
    assert_eq!(dsa.f64_only_escaped + dsa.model_only_escaped, 0);
}

/// Passes of 1, 3 or 1000 steps leave exactly the state one unbounded pass does, on
/// frames that scale, rebase, take the careful step, wrap a periodic reference and run
/// both planes, with and without the skip.
#[test]
fn ds_passes_are_bit_identical_whatever_the_budget() {
    for row in [
        r#"{"id": "random-dives#501", "re": "0.64774731161734500930901700212431872380828355273804", "im": "0.51776563981107259688773400463987628082965300802274", "w": 8.662732633712781e-42, "n": 20000, "degree": 5}"#,
        DIVE_5,
        r#"{"id": "deep-gallery#33", "re": "0", "im": "0", "w": 7.787286674045785e-08, "n": 34239, "degree": 2, "julia_re": "-0.74937053247003823168823992075369", "julia_im": "0.041472667068168900034718746387049", "anchor": "origin"}"#,
        r#"{"id": "julia-i-origin-1e-35", "re": "0", "im": "0", "w": 1e-35, "n": 20000, "degree": 2, "julia_re": "0", "julia_im": "1", "anchor": "origin"}"#,
        r#"{"id": "nucleus-3116-periodic", "re": "0.64774731161734500930901700212431871126941013022100244438793490777767414164458935", "im": "0.51776563981107259688773400463987632330403073150911819396055504521478466034303479", "w": 1.474220271796546e-40, "n": 20000, "degree": 5, "period": 3116}"#,
    ] {
        let s = setup(row, [16, 9], None);
        let table = GpuTable::build(
            &s.orbit,
            &s.frame,
            &BlaOptions {
                epsilon: bla::EPSILON_DS_DEFAULT,
                ..BlaOptions::default()
            },
        );
        let (mut rebased, mut skips) = (0, 0);
        for r in 0..9 {
            for col in 0..16 {
                let whole = model_ds::run_pixel_ds(&s.frame, &s.lo, &s.hilo, col, r, u32::MAX);
                let (whole_bla, stats) =
                    model_ds::run_pixel_ds_bla(&s.frame, &s.lo, &s.hilo, &table, col, r, u32::MAX);
                rebased += whole.rebases;
                skips += stats.bla_steps;
                for budget in [1u32, 3, 1000] {
                    let mut st = model_ds::init_ds(&s.frame, &s.lo, col, r);
                    while st.status == RUNNING {
                        let took =
                            model_ds::pass_ds(&mut st, &s.frame, &s.lo, &s.hilo, col, r, budget);
                        assert!(took <= budget);
                    }
                    assert_eq!(st.bits(), whole.bits(), "{row} {col},{r} budget {budget}");
                    assert_eq!(st.proof.bits(), whole.proof.bits());
                    let mut st = model_ds::init_ds(&s.frame, &s.lo, col, r);
                    let mut st_stats = BlaStats::default();
                    while st.status == RUNNING {
                        model_ds::pass_ds_bla(
                            &mut st,
                            &mut st_stats,
                            &s.frame,
                            &s.lo,
                            &s.hilo,
                            &table,
                            col,
                            r,
                            budget,
                        );
                    }
                    assert_eq!(st.bits(), whole_bla.bits(), "{row} {col},{r} bla {budget}");
                    assert_eq!(st.proof.bits(), whole_bla.proof.bits());
                    assert_eq!(st_stats, stats);
                }
            }
        }
        assert!(rebased > 0, "{row}: no pixel rebased");
        eprintln!("{row:.40}: {rebased} rebases, {skips} skips");
    }
}

/// An empty table is the kernel without the skip, bit for bit.
#[test]
fn ds_with_an_empty_table_is_ds_without_one() {
    let s = setup(DIVE_5, [16, 9], None);
    let empty = GpuTable::empty(s.orbit.periodic);
    for r in 0..9 {
        for col in 0..16 {
            let a = model_ds::run_pixel_ds(&s.frame, &s.lo, &s.hilo, col, r, 7);
            let (b, _) = model_ds::run_pixel_ds_bla(&s.frame, &s.lo, &s.hilo, &empty, col, r, 7);
            assert_eq!(a.bits(), b.bits());
        }
    }
}

#[test]
#[should_panic(expected = "HiLo")]
fn ds_refuses_an_f32_pair_orbit() {
    let s = setup(DIVE_5, [4, 2], None);
    model_ds::run_pixel_ds(&s.frame, &s.lo, &s.pair, 0, 0, 100);
}

/// Threshold 0 redoes every pixel: the double-single field, bit for bit. A threshold past
/// the cap redoes none: the `f32` field. Between, a pixel keeps the `f32` result exactly
/// when it stopped first, and the counters add up.
#[test]
fn survivors_keep_what_stopped_and_redo_what_runs() {
    let s = setup(DIVE_5, [24, 14], None);
    let mut kept_and_redone = (0, 0);
    for r in 0..14 {
        for col in 0..24 {
            let f = deep_gpu_model::model::run_pixel(&s.frame, &s.pair, col, r, u32::MAX);
            let d: DsPixelState =
                model_ds::run_pixel_ds(&s.frame, &s.lo, &s.hilo, col, r, u32::MAX);
            let all =
                survivors::run_pixel_survivors(&s.frame, &s.lo, &s.pair, &s.hilo, col, r, 64, 0);
            assert!(all.redone && all.f32_steps == 0);
            assert_eq!(all.ds_state.unwrap().bits(), d.bits());
            let none = survivors::run_pixel_survivors(
                &s.frame,
                &s.lo,
                &s.pair,
                &s.hilo,
                col,
                r,
                64,
                u32::MAX,
            );
            assert!(!none.redone && none.ds_steps == 0);
            assert_eq!(none.f32_state.bits(), f.bits());
            let threshold = 3000;
            let mid = survivors::run_pixel_survivors(
                &s.frame, &s.lo, &s.pair, &s.hilo, col, r, 64, threshold,
            );
            if f.n <= threshold {
                // Stopped by the threshold (the step that reaches it still takes its
                // escape, interior and cap tests): the `f32` result stands.
                assert!(!mid.redone);
                assert_eq!((mid.status, mid.n, mid.frac), (f.status, f.n, f.frac));
                kept_and_redone.0 += 1;
            } else {
                assert!(mid.redone, "{col},{r}: n {}", f.n);
                assert_eq!(mid.f32_steps, threshold);
                assert_eq!((mid.status, mid.n, mid.frac), (d.status, d.n, d.frac));
                assert_eq!(mid.ds_steps, d.steps);
                kept_and_redone.1 += 1;
            }
        }
    }
    eprintln!("survivors at 3000: {kept_and_redone:?} kept, redone");
    assert!(kept_and_redone.0 > 0 && kept_and_redone.1 > 0);
    // The field-level runner agrees with the per-pixel one.
    let (field, cost) = run_model_survivors(
        &s.frame,
        &s.lo,
        &s.pair,
        &s.hilo,
        (None, None),
        THREADS,
        64,
        3000,
    );
    assert_eq!(cost.redone, kept_and_redone.1);
    assert_eq!(field.smooth.len(), 24 * 14);
}

/// With a skip table on the `f32` kernel the threshold still holds: a skip covers many
/// iterations in one delta step, so the threshold is the `f32` phase's cap and no run
/// crosses it. A pixel the unbounded `f32` run stops before the threshold keeps exactly
/// that result; every other is handed over at `n = threshold` exactly. Before the fix, at
/// threshold 1000 on `random-dives#501`, 539 of 576 pixels kept an `f32` result past it.
#[test]
fn survivors_with_a_skip_stop_at_the_threshold() {
    let s = setup(DIVE_501, [16, 9], Some(120_000));
    let table = GpuTable::build(&s.orbit, &s.frame, &BlaOptions::default());
    let threshold = 1000;
    let (mut kept, mut redone) = (0, 0);
    for r in 0..9 {
        for col in 0..16 {
            let (f, _) =
                deep_gpu_model::model::run_pixel_bla(&s.frame, &s.pair, &table, col, r, u32::MAX);
            let got = survivors::run_pixel_survivors_bla(
                &s.frame,
                &s.lo,
                &s.pair,
                &s.hilo,
                Some(&table),
                None,
                col,
                r,
                u32::MAX,
                threshold,
            );
            if got.redone {
                assert_eq!(got.f32_state.n, threshold, "{col},{r}");
                redone += 1;
            } else {
                assert!(got.n <= threshold, "{col},{r}: kept at n {}", got.n);
                kept += 1;
            }
            if f.n < threshold {
                assert!(!got.redone);
                assert_eq!((got.status, got.n, got.frac), (f.status, f.n, f.frac));
            }
        }
    }
    eprintln!("survivors+bla at {threshold}: {kept} kept, {redone} redone");
    assert!(redone > 0);
}

/// Why the table carries low halves for this kernel: with them zeroed, `A` and `B` are
/// `f32` mantissas again and every skip rounds `A·δ` to 24 bits. Measured on
/// `random-dives#501` at 64x36, `ε = 2^-48` (37 skips a pixel, 2.7 times fewer delta
/// steps): 1.09% over 0.1 and a median of 2.8e-8 with them, against 1.26% and 2.8e-8
/// without the skip, and 7.2% and 1.9e-6 with them zeroed.
#[test]
fn the_skip_needs_its_low_halves() {
    let s = setup(DIVE_501, [64, 36], Some(120_000));
    let f64_field = run_f64(&s.spec, &s.orbit, THREADS);
    let table = GpuTable::build(
        &s.orbit,
        &s.frame,
        &BlaOptions {
            epsilon: bla::EPSILON_DS_DEFAULT,
            ..BlaOptions::default()
        },
    );
    let mut zeroed = table.clone();
    zeroed.lo = vec![BlaLo::default(); table.lo.len()];
    let none = run_model_ds(&s.frame, &s.lo, &s.hilo, None, THREADS, u32::MAX);
    let with = run_model_ds(&s.frame, &s.lo, &s.hilo, Some(&table), THREADS, u32::MAX);
    let without = run_model_ds(&s.frame, &s.lo, &s.hilo, Some(&zeroed), THREADS, u32::MAX);
    let (a0, a1, a2) = (
        agree(&f64_field.smooth, &none.smooth),
        agree(&f64_field.smooth, &with.smooth),
        agree(&f64_field.smooth, &without.smooth),
    );
    let skips = with.bla_steps.iter().map(|&x| x as f64).sum::<f64>() / with.bla_steps.len() as f64;
    eprintln!(
        "#501 ds: no skip p50 {:.2e} over 0.1 {:.4}; skip p50 {:.2e} over 0.1 {:.4} ({skips:.1} skips); lo zeroed p50 {:.2e} over 0.1 {:.4}",
        a0.p50, a0.over[1], a1.p50, a1.over[1], a2.p50, a2.over[1]
    );
    assert!(skips > 10.0);
    assert!(a1.over[1] <= a0.over[1] + 0.005);
    assert!(a2.over[1] > 3.0 * a1.over[1] && a2.p50 > 10.0 * a1.p50);
}
