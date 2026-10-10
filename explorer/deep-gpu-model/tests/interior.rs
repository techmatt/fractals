//! The interior switch never paints an escaping sample black, in either kernel: the gate
//! and the proof (`src/proof.rs`) wired into `src/model.rs` and `src/model_ds.rs`.
//!
//! `perturb`'s `tests/interior.rs`, on the GPU model. Stage 1 found the old switch (the
//! `|dz|²` threshold as the verdict) calling escaping samples interior beside a parabolic
//! point: the degree-2 main cusp and the imploded Julia set of `scratch/gpu-model/
//! longorbit.jsonl`, where `|dz|²` decays like a power of `n` rather than geometrically.
//! These are `perturb`'s constructions of those frames, the gate passed in a million
//! steps rather than ten million, and the cusp again at every degree the kernel draws.
//!
//! Each holds, on a row of five samples down the frame's middle and in both kernels (the
//! `f32` one on `F32Pair`, the double-single one on `HiLo`): that the switch-off loop
//! escapes every sample; that half way through the gate's passage the gate has fired, so
//! the old rule would have stopped the sample there; and that the switch on lands on
//! exactly the state the switch off does (count, fraction, delta, steps, rebases), under
//! the policies that run a gated sample on. That identity is the kernels' without the
//! skip; with it a carrying proof suppresses the lookup and the bits differ by the skip's
//! error (`src/model.rs`'s module doc), so the skip is not run here. Under `GatedPolicy::Handoff` the same samples
//! come back `GATED`, before their escape: the CPU's to finish.

use deep_gpu_model::compare::FrameSpec;
use deep_gpu_model::frame::GatedPolicy;
use deep_gpu_model::model::{self, ESCAPED, GATED, PixelState, RUNNING};
use deep_gpu_model::model_ds::{self, DsPixelState};
use deep_gpu_model::proof::Proof;
use deep_gpu_model::{Encoding, Frame, FrameLo, GpuOrbit};

/// What a run ends in, whichever kernel: every field but `|dz|²` (which the switch off
/// never forms), and the proof.
#[derive(Debug, Clone, Copy, PartialEq)]
struct End {
    fields: [u32; 12],
    proof: Proof,
}

impl End {
    fn status(&self) -> u32 {
        self.fields[1]
    }
    fn n(&self) -> u32 {
        self.fields[0]
    }
    /// Everything the switch does not touch.
    fn picture(&self) -> [u32; 12] {
        self.fields
    }
}

fn of_f32(st: &PixelState) -> End {
    let b = st.bits();
    // n, status, frac, then d, s, m, rebases, steps, scaled; dz (7, 8) left out.
    End {
        fields: [
            b[4], b[5], b[6], b[0], b[1], b[2], b[3], b[9], b[10], b[11], 0, 0,
        ],
        proof: st.proof,
    }
}

fn of_ds(st: &DsPixelState) -> End {
    let b = st.bits();
    End {
        fields: [
            b[6], b[7], b[8], b[0], b[1], b[2], b[3], b[4], b[5], b[11], b[12], b[13],
        ],
        proof: st.proof,
    }
}

/// One frame of the row, set up for both kernels.
struct Setup {
    pair: GpuOrbit,
    hilo: GpuOrbit,
    frame: Frame,
    lo: FrameLo,
}

impl Setup {
    fn new(row: &str, cap: u32, interior: bool) -> Setup {
        let spec = FrameSpec::from_row(row)
            .unwrap()
            .spec([5, 1], Some(cap), interior);
        let orbit = spec.reference_orbit().unwrap();
        let pair = GpuOrbit::from_reference(&orbit, Encoding::F32Pair);
        let hilo = GpuOrbit::from_reference(&orbit, Encoding::HiLo);
        let frame = Frame::from_spec(&spec, pair.len()).unwrap();
        let lo = FrameLo::from_spec(&spec, &frame).unwrap();
        Setup {
            pair,
            hilo,
            frame,
            lo,
        }
    }

    fn with(&self, policy: GatedPolicy) -> Setup {
        Setup {
            pair: self.pair.clone(),
            hilo: self.hilo.clone(),
            frame: self.frame.with_policy(policy),
            lo: self.lo,
        }
    }

    /// Sample `col` to its end in passes of `budget`, in the `f32` kernel or the
    /// double-single one.
    fn run(&self, ds: bool, col: u32, budget: u32) -> End {
        if ds {
            of_ds(&model_ds::run_pixel_ds(
                &self.frame,
                &self.lo,
                &self.hilo,
                col,
                0,
                budget,
            ))
        } else {
            of_f32(&model::run_pixel(&self.frame, &self.pair, col, 0, budget))
        }
    }
}

/// The five samples of the row, three ways each (switch off, switch on, and switch on with
/// the cap half way through the gate), in one kernel, a thread a sample.
///
/// `passage` is `T`, how many steps the gate takes to pass: `π/√x` at `x` past the cusp,
/// the last `T` steps of a sample's orbit or all of it where the escape comes sooner.
fn holds(name: &str, row: &str, passage: u32, cap: u32, ds: bool) {
    let kernel = if ds { "ds" } else { "f32" };
    let off = Setup::new(row, cap, false);
    let on = Setup::new(row, cap, true);
    let flag = on.with(GatedPolicy::Flag);
    let handoff = on.with(GatedPolicy::Handoff);
    std::thread::scope(|scope| {
        for col in 0..5u32 {
            let (off, on, flag, handoff) = (&off, &on, &flag, &handoff);
            scope.spawn(move || {
                let id = format!("{name} {kernel} sample {col}");
                let b = off.run(ds, col, u32::MAX);
                assert_eq!(b.status(), ESCAPED, "{id}: the plain loop did not escape");
                // Half way through the passage the product is at about its smallest, and
                // under the gate: the rule this replaced stopped the sample by there.
                let midway = b.n() - (b.n() / 2).min(passage / 2);
                let half = Setup::new(row, midway, true).run(ds, col, u32::MAX);
                assert!(
                    half.proof.gated(),
                    "{id}: the gate had not fired at {midway}, so this proves nothing"
                );
                // Switched on, run on under either policy and in passes of an odd size:
                // exactly the switch-off sample, and the proof never closed.
                let a = on.run(ds, col, u32::MAX);
                assert_eq!(
                    a.status(),
                    ESCAPED,
                    "{id}: painted {} at {}",
                    a.status(),
                    a.n()
                );
                assert_eq!(a.picture(), b.picture(), "{id}");
                assert!(a.proof.gated(), "{id}: never gated");
                let passed = on.run(ds, col, 99_991);
                assert_eq!(passed, a, "{id}: passes");
                assert_eq!(flag.run(ds, col, u32::MAX), a, "{id}: flag");
                // Handed off: back as soon as the discs are spent, long before the escape.
                let h = handoff.run(ds, col, u32::MAX);
                assert_eq!(h.status(), GATED, "{id}: handoff");
                assert!(h.n() < b.n(), "{id}: handed off at {} of {}", h.n(), b.n());
                eprintln!(
                    "{id}: escapes at {}, gated at {}, handed off at {}",
                    b.n(),
                    a.proof.budget,
                    h.n()
                );
            });
        }
    });
}

const CUSP_D2: &str = r#"{"id": "cusp d2", "re": "0.25000000000986960440108935861883", "im": "0", "w": 9.3e-17, "degree": 2}"#;
const IMPLOSION_D2: &str = r#"{"id": "implosion d2", "re": "0", "im": "0", "w": 0.5, "degree": 2, "julia_re": "0.25000000000246740110027233965471", "julia_im": "0", "anchor": "origin"}"#;

/// The main cusp, `c = 1/4 + (π/T)²` with `T` a million: the exterior there is a channel
/// along the real axis, and every sample of the row is in it.
#[test]
fn the_main_cusp_is_not_interior() {
    holds("cusp d2", CUSP_D2, 1_000_000, 2_000_000, false);
    holds("cusp d2", CUSP_D2, 1_000_000, 2_000_000, true);
}

/// The Julia set of that same `c`, at the origin: the cauliflower's basin has imploded,
/// and every point of it passes the gate once and escapes. Twice the passage, because a
/// Julia sample starts part of the way up the approach.
#[test]
fn the_imploded_julia_set_is_not_interior() {
    holds("implosion d2", IMPLOSION_D2, 2_000_000, 3_000_000, false);
    holds("implosion d2", IMPLOSION_D2, 2_000_000, 3_000_000, true);
}

/// The main body's cusp at degrees three to six, `c* = z* − z*^d` with
/// `z* = d^{−1/(d−1)}`, the same distance past it.
#[test]
fn the_main_cusp_is_not_interior_at_any_degree() {
    for (degree, centre) in [
        (3, "0.38490017946962011407385521228681"),
        (4, "0.47247039372044704118879333634817"),
        (5, "0.53499224399100722360367581722575"),
        (6, "0.58235593231951897542857027759502"),
    ] {
        let row = format!(
            r#"{{"id": "cusp d{degree}", "re": "{centre}", "im": "0", "w": 9.3e-17, "degree": {degree}}}"#
        );
        for ds in [false, true] {
            holds(&format!("cusp d{degree}"), &row, 1_000_000, 2_000_000, ds);
        }
    }
}

/// And what the proof is for: on a frame with interior in it, the gated samples are
/// proved and come out `INTERIOR` in both kernels, under every policy, and passes of any
/// size resume a proof in flight exactly. `random-dives#5` has two gated pixels at 24x14
/// (`tests/bla.rs`), proved a period of 685 steps past their last anchor.
#[test]
fn the_proof_proves_interior_and_resumes_across_passes() {
    let row = r#"{"id": "random-dives#5", "re": "-0.75765813056425443555", "im": "0.07282660995819819077", "w": 7.255822008177002e-09, "n": 38347, "degree": 2}"#;
    let spec = FrameSpec::from_row(row).unwrap().spec([24, 14], None, true);
    let orbit = spec.reference_orbit().unwrap();
    let pair = GpuOrbit::from_reference(&orbit, Encoding::F32Pair);
    let hilo = GpuOrbit::from_reference(&orbit, Encoding::HiLo);
    let frame = Frame::from_spec(&spec, pair.len()).unwrap();
    let lo = FrameLo::from_spec(&spec, &frame).unwrap();
    let mut proved = [0u32; 2];
    for (col, row_i) in [(12u32, 6u32), (12, 7)] {
        for policy in [GatedPolicy::Cap, GatedPolicy::Flag, GatedPolicy::Handoff] {
            let f = frame.with_policy(policy);
            let whole = model::run_pixel(&f, &pair, col, row_i, u32::MAX);
            let whole_ds = model_ds::run_pixel_ds(&f, &lo, &hilo, col, row_i, u32::MAX);
            assert_eq!(
                whole.status,
                model::INTERIOR,
                "{policy:?} f32 {col},{row_i}"
            );
            assert_eq!(
                whole_ds.status,
                model::INTERIOR,
                "{policy:?} ds {col},{row_i}"
            );
            proved[0] += 1;
            proved[1] += 1;
            for budget in [1u32, 7, 1000] {
                let mut st = model::init(&f, col, row_i);
                while st.status == RUNNING {
                    model::pass(&mut st, &f, &pair, col, row_i, budget);
                }
                assert_eq!(st.bits(), whole.bits());
                assert_eq!(st.proof.bits(), whole.proof.bits());
                let mut st = model_ds::init_ds(&f, &lo, col, row_i);
                while st.status == RUNNING {
                    model_ds::pass_ds(&mut st, &f, &lo, &hilo, col, row_i, budget);
                }
                assert_eq!(st.bits(), whole_ds.bits());
                assert_eq!(st.proof.bits(), whole_ds.proof.bits());
            }
        }
    }
    assert_eq!(proved, [6, 6]);
}
