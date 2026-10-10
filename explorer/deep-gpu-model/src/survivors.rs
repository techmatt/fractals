//! Survivors: the `f32` kernel first, and the double-single kernel only for the pixels
//! still running past a threshold.
//!
//! Stage 1 found the `f32` kernel a sound preview whose disagreement grows with the
//! escape count: short orbits come out as `f64` draws them, and the long ones re-deal
//! speckle. The double-single kernel ([`crate::model_ds`]) costs twelve to twenty times
//! as much a step, so it is spent only where the count says it is needed. A pixel that
//! stops before `threshold` iterations (escaped, capped or proved interior) keeps its
//! `f32` result; a pixel still running at `n >= threshold`, or handed back gated, is run
//! again from its start in double-single, to its end. Its `f32` steps are then wasted work, and the counters
//! say how much, so that a threshold can be chosen from the cost it buys agreement at.
//!
//! The re-run starts over rather than continuing from the `f32` state, because the `f32`
//! state at the threshold already carries the error the re-run is for. Nothing is
//! carried between the two kernels but the decision.

use crate::bla::GpuTable;
use crate::frame::{Frame, FrameLo};
use crate::model::{self, BlaStats, CAPPED, ESCAPED, GATED, PixelState, RUNNING};
use crate::model_ds::{self, DsPixelState};
use crate::orbit::GpuOrbit;

/// One pixel's result and what it cost.
#[derive(Debug, Clone, Copy)]
pub struct Survivor {
    /// The final status, count and fraction: the `f32` kernel's, or the re-run's.
    pub status: u32,
    pub n: u32,
    pub frac: f32,
    /// Delta steps the `f32` kernel took, kept or not.
    pub f32_steps: u32,
    /// Delta steps the double-single re-run took; 0 when the pixel was not re-run.
    pub ds_steps: u32,
    /// Whether the pixel was re-run in double-single.
    pub redone: bool,
    /// The `f32` kernel's state where it stopped: at the threshold, `CAPPED` or `GATED`
    /// there, when re-run.
    pub f32_state: PixelState,
    /// The re-run's final state.
    pub ds_state: Option<DsPixelState>,
    /// The skip's counters, summed over both kernels (zero with no table).
    pub bla: BlaStats,
}

impl Survivor {
    /// `n + frac` on an escape, `NaN` otherwise: comparable with `perturb`'s field.
    pub fn smooth_f64(&self) -> f64 {
        if self.status == ESCAPED {
            self.n as f64 + self.frac as f64
        } else {
            f64::NAN
        }
    }
}

/// Runs one pixel the survivors' way, in passes of `budget` steps: the `f32` kernel on
/// `orbit_f32` (either encoding) until it stops or reaches `threshold` iterations, and
/// then, if it is still running, the double-single kernel on `orbit_hilo` from the start.
#[allow(clippy::too_many_arguments)]
pub fn run_pixel_survivors(
    frame: &Frame,
    lo: &FrameLo,
    orbit_f32: &GpuOrbit,
    orbit_hilo: &GpuOrbit,
    col: u32,
    row: u32,
    budget: u32,
    threshold: u32,
) -> Survivor {
    run_pixel_survivors_bla(
        frame, lo, orbit_f32, orbit_hilo, None, None, col, row, budget, threshold,
    )
}

/// [`run_pixel_survivors`] with a skip table for either kernel or both. The tables may
/// differ: the double-single kernel wants a tighter tolerance ([`crate::bla::apply_ds`]).
///
/// The threshold is the `f32` phase's cap: its frame's `maxiter` is lowered to it, so a
/// skip never runs past it (a lookup bounds a run by the iterations left to the cap, not
/// by delta steps) and the pixel stops at exactly `threshold` iterations, `CAPPED` there
/// (or `GATED`, under [`crate::GatedPolicy::Flag`]) where it would have run on. Up to
/// that cap the run is the unlowered one step for step: nothing else reads `maxiter`.
#[allow(clippy::too_many_arguments)]
pub fn run_pixel_survivors_bla(
    frame: &Frame,
    lo: &FrameLo,
    orbit_f32: &GpuOrbit,
    orbit_hilo: &GpuOrbit,
    table_f32: Option<&GpuTable>,
    table_ds: Option<&GpuTable>,
    col: u32,
    row: u32,
    budget: u32,
    threshold: u32,
) -> Survivor {
    let budget = budget.max(1);
    let first = Frame {
        maxiter: threshold.min(frame.maxiter),
        ..*frame
    };
    let mut st = model::init(&first, col, row);
    let mut bla = BlaStats::default();
    while st.status == RUNNING && st.n < threshold {
        match table_f32 {
            None => model::pass(&mut st, &first, orbit_f32, col, row, budget),
            Some(t) => model::pass_bla(&mut st, &mut bla, &first, orbit_f32, t, col, row, budget),
        };
    }
    // Capped by the threshold rather than the frame: still running there.
    let at_threshold = st.status == CAPPED && first.maxiter < frame.maxiter;
    // A sample the `f32` kernel handed back gated (`GatedPolicy::Flag` or `Handoff`) is a
    // survivor too: the double-single proof may close where the `f32` one could not.
    if st.status != RUNNING && st.status != GATED && !at_threshold {
        return Survivor {
            status: st.status,
            n: st.n,
            frac: st.frac,
            f32_steps: st.steps,
            ds_steps: 0,
            redone: false,
            f32_state: st,
            ds_state: None,
            bla,
        };
    }
    let (ds, ds_bla) = match table_ds {
        None => (
            model_ds::run_pixel_ds(frame, lo, orbit_hilo, col, row, budget),
            BlaStats::default(),
        ),
        Some(t) => model_ds::run_pixel_ds_bla(frame, lo, orbit_hilo, t, col, row, budget),
    };
    Survivor {
        status: ds.status,
        n: ds.n,
        frac: ds.frac,
        f32_steps: st.steps,
        ds_steps: ds.steps,
        redone: true,
        f32_state: st,
        ds_state: Some(ds),
        bla: BlaStats {
            bla_steps: bla.bla_steps + ds_bla.bla_steps,
            skipped: bla.skipped + ds_bla.skipped,
            reads: bla.reads + ds_bla.reads,
            probes: bla.probes + ds_bla.probes,
            hint: ds_bla.hint,
        },
    }
}
