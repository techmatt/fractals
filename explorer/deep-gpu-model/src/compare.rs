//! The comparison harness: `perturb`'s `f64` kernel and the model, on the same samples
//! of the same frame, and what separates them.
//!
//! This is CPU-side code and uses `f64` freely; the model path it drives does not. Both
//! kernels see the same `perturb::Spec`, the same reference orbit (`Spec::reference_orbit`,
//! narrowed for the model by [`GpuOrbit::from_reference`]) and the same sample grid. The
//! `f64` kernel takes its offsets from `Spec::dc`; the model forms its own from the frame
//! constants ([`Frame::dc_mantissa`]), which is part of what is being measured.
//!
//! **Two floors**, both `f64` against `f64`, so that a disagreement is not blamed on `f32`
//! when `perturb` itself moves that much:
//!
//! - **rounded** ([`narrowed_reference`]): the same kernel on the reference rounded to
//!   `f32`. What storing the reference in `f32` costs on its own.
//! - **moved** ([`moved_spec`]): the same kernel on a *different* reference, the view
//!   centre moved by a pixel or two (a Julia frame, whose reference is fixed by `c`, takes
//!   its other anchor instead). A real second opinion: on a chaotic orbit `f64` itself is
//!   not noise-free, and this is how much two honest `f64` renders disagree.

use std::fs;
use std::io::Write as _;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};
use std::time::Instant;

use perturb::fx::Fx;
use perturb::kernel::Kernel;
use perturb::reference::Reference;
use perturb::{Anchor, Spec};

use crate::bla::{BlaOptions, ENTRY_BYTES, GpuTable, HEADER_BYTES, INTERIOR_BYTES, Search};
use crate::frame::{Frame, FrameLo, GatedPolicy, spec_of};
use crate::json;
use crate::model::{self, BlaStats, CAPPED, ESCAPED, GATED, INTERIOR};
use crate::model_ds;
use crate::orbit::{Encoding, GpuOrbit};
use crate::survivors;

/// One frame to compare, as a corpus row names it.
#[derive(Debug, Clone)]
pub struct FrameSpec {
    pub id: String,
    pub re: String,
    pub im: String,
    pub w: f64,
    pub n: Option<u32>,
    pub degree: u32,
    pub julia: Option<(String, String)>,
    pub anchor: Anchor,
    pub period: Option<u32>,
    /// The row's Deep link (`dv=3&â€¦`), carried into a dump's metadata so a colouring
    /// script can colour the frame the way that link is coloured on the site.
    pub link: Option<String>,
}

impl FrameSpec {
    /// Reads one line of the corpus schema:
    /// `{id, re, im, w, n, degree, julia_re, julia_im, anchor, period, ...}`.
    pub fn from_row(line: &str) -> Result<FrameSpec, String> {
        let m = json::parse_object(line)?;
        let text = |k: &str| {
            json::get(&m, k)
                .and_then(|v| v.as_str())
                .map(str::to_string)
        };
        let re = text("re").ok_or("row has no re")?;
        let im = text("im").ok_or("row has no im")?;
        let w = json::get(&m, "w")
            .and_then(|v| v.as_f64())
            .ok_or("row has no w")?;
        let n = json::get(&m, "n").and_then(|v| v.as_u32());
        let degree = json::get(&m, "degree")
            .and_then(|v| v.as_u32())
            .unwrap_or(2);
        let julia = match (text("julia_re"), text("julia_im")) {
            (Some(a), Some(b)) => Some((a, b)),
            _ => None,
        };
        let anchor = match text("anchor").as_deref() {
            Some("origin") => Anchor::Origin,
            _ => Anchor::Parameter,
        };
        let period = json::get(&m, "period").and_then(|v| v.as_u32());
        Ok(FrameSpec {
            id: text("id").unwrap_or_else(|| format!("{re},{im},{w}")),
            re,
            im,
            w,
            n,
            degree,
            julia,
            anchor,
            period,
            link: text("link"),
        })
    }

    /// The `perturb::Spec` this frame is at `resolution`, with `cap` as its iteration
    /// cap (the row's own when `None`) and the interior switch as given.
    pub fn spec(&self, resolution: [u32; 2], cap: Option<u32>, interior: bool) -> Spec {
        let julia = self.julia.as_ref().map(|(a, b)| (a.as_str(), b.as_str()));
        spec_of(
            &self.re,
            &self.im,
            self.w,
            resolution,
            cap.or(self.n),
            self.degree,
            julia,
            if julia.is_some() {
                self.anchor
            } else {
                Anchor::Parameter
            },
            if julia.is_some() { None } else { self.period },
            interior,
        )
    }
}

/// How a comparison runs.
#[derive(Debug, Clone)]
pub struct Options {
    pub resolution: [u32; 2],
    /// Replaces the row's cap when set.
    pub cap: Option<u32>,
    /// Lowers the row's cap to at most this, when set.
    pub cap_max: Option<u32>,
    pub encodings: Vec<Encoding>,
    pub interior: bool,
    pub threads: usize,
    /// Steps per pass for the model; `u32::MAX` is one pass.
    pub budget: u32,
    pub dump: Option<PathBuf>,
    /// Puts the cap in a dump's file names (`<id>_n<cap>.â€¦`), for a cap ladder that
    /// dumps one frame several times.
    pub cap_in_name: bool,
    /// Also runs the `f64` kernel on the `f32`-narrowed reference
    /// ([`narrowed_reference`]) and reports its agreement as `floor`.
    pub floor: bool,
    /// Also runs the `f64` kernel on a second reference ([`moved_spec`]) and reports its
    /// agreement as `floor_moved`.
    pub floor_moved: bool,
    /// How far the second reference sits from the view centre, in samples (across, up).
    pub move_px: [f64; 2],
    /// Run the model without the skip table, with it, or both (each encoding twice,
    /// the second keyed `<encoding>+bla`).
    pub bla: BlaMode,
    pub bla_options: BlaOptions,
    /// Lookup orders to run the skip in as well, after `bla_options.search`, each keyed
    /// `<encoding>+bla:<order>`. They draw the same field (`field_hash` says so) and
    /// differ in the entries read.
    pub extra_searches: Vec<Search>,
    /// Also runs every order with the gate flipped from `bla_options.gate`, keyed
    /// `â€¦+gate` (or `â€¦+nogate`). The same field again, and fewer reads.
    pub flip_gate: bool,
    /// Also runs the double-single kernel on the `HiLo` orbit, keyed `ds` (and `ds+bla`
    /// with the skip).
    pub ds: bool,
    /// The skip tolerance of the double-single kernel's own table.
    pub ds_eps: f64,
    /// Also runs the survivors' way once per threshold, keyed `survivors@<threshold>`
    /// (and `â€¦+bla`): `F32Pair` first, `HiLo` double-single for what is still running.
    pub survivors: Vec<u32>,
    /// What becomes of a gated sample the interior proof does not close on, in every model
    /// (the `f64` kernel's own is always `cap`). A sample a model hands back `GATED` is
    /// settled the way the policy means it to be, by the CPU: it takes `perturb`'s value
    /// before the agreement is measured, and the line counts it as `gated`.
    pub interior_policy: GatedPolicy,
}

/// Which of the model's two paths a comparison runs.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BlaMode {
    Off,
    On,
    Both,
}

impl BlaMode {
    fn runs(self) -> &'static [bool] {
        match self {
            BlaMode::Off => &[false],
            BlaMode::On => &[true],
            BlaMode::Both => &[false, true],
        }
    }
}

impl Default for Options {
    fn default() -> Self {
        Options {
            resolution: [160, 90],
            cap: None,
            cap_max: None,
            encodings: vec![Encoding::F32Pair, Encoding::HiLo],
            interior: true,
            threads: std::thread::available_parallelism()
                .map(|n| n.get())
                .unwrap_or(4),
            budget: u32::MAX,
            dump: None,
            cap_in_name: false,
            floor: false,
            floor_moved: false,
            move_px: [1.5, 1.0],
            bla: BlaMode::Off,
            bla_options: BlaOptions::default(),
            extra_searches: Vec::new(),
            flip_gate: false,
            ds: false,
            ds_eps: crate::bla::EPSILON_DS_DEFAULT,
            survivors: Vec::new(),
            interior_policy: GatedPolicy::Cap,
        }
    }
}

/// `perturb`'s field: one smooth count per sample, `NaN` interior.
#[derive(Debug, Clone)]
pub struct F64Field {
    pub smooth: Vec<f64>,
    pub iterations: Vec<u32>,
    pub rebases: Vec<u32>,
    pub wall_s: f64,
}

/// The model's field.
#[derive(Debug, Clone)]
pub struct ModelField {
    /// `n + frac` on an escape, `NaN` otherwise: comparable with [`F64Field::smooth`].
    pub smooth: Vec<f64>,
    pub status: Vec<u32>,
    pub steps: Vec<u32>,
    /// Delta steps taken in the scaled regime.
    pub scaled: Vec<u32>,
    pub rebases: Vec<u32>,
    /// Of `steps`, those that were skips; the iterations they covered; the table
    /// entries the lookups read. All zero with the switch off.
    pub bla_steps: Vec<u32>,
    pub skipped: Vec<u32>,
    pub reads: Vec<u32>,
    /// Lookups that read at least one entry.
    pub probes: Vec<u32>,
    /// The gate fired and the proof never closed, however the sample ended: escaped (a
    /// parabolic creep), capped ("gated, unproven" under `GatedPolicy::Cap`, painted as
    /// interior), or handed back `GATED`.
    pub unproven: Vec<bool>,
    /// Samples whose final delta mantissa is not finite.
    pub nonfinite: usize,
    pub wall_s: f64,
}

impl ModelField {
    /// Settles every `GATED` sample the way the policy that returned it means: on the
    /// CPU's `f64` kernel, whose field is `f64_smooth`. Returns how many there were.
    pub fn settle_gated(&mut self, f64_smooth: &[f64]) -> usize {
        let mut gated = 0;
        for (i, &s) in self.status.iter().enumerate() {
            if s == GATED {
                self.smooth[i] = f64_smooth[i];
                gated += 1;
            }
        }
        gated
    }
}

/// Rows `0..height` over `threads` workers, two rows at a time, reassembled in order.
pub fn par_rows<T: Send>(height: u32, threads: usize, f: impl Fn(u32) -> Vec<T> + Sync) -> Vec<T> {
    let next = AtomicU32::new(0);
    let mut parts: Vec<(u32, Vec<T>)> = std::thread::scope(|scope| {
        let workers: Vec<_> = (0..threads.max(1))
            .map(|_| {
                scope.spawn(|| {
                    let mut mine = Vec::new();
                    loop {
                        let first = next.fetch_add(2, Ordering::Relaxed);
                        if first >= height {
                            break;
                        }
                        for row in first..(first + 2).min(height) {
                            mine.push((row, f(row)));
                        }
                    }
                    mine
                })
            })
            .collect();
        workers
            .into_iter()
            .flat_map(|w| w.join().expect("worker panicked"))
            .collect()
    });
    parts.sort_by_key(|(row, _)| *row);
    parts.into_iter().flat_map(|(_, v)| v).collect()
}

/// Runs `perturb`'s kernel over the frame.
pub fn run_f64(spec: &Spec, orbit: &Reference, threads: usize) -> F64Field {
    let start = Instant::now();
    let kernel = Kernel::new(orbit, spec.maxiter(), spec.interior).at_entry(spec.entry());
    let offset = spec.centre_offset().unwrap_or((0.0, 0.0));
    let julia = spec.julia.is_some();
    let w = spec.sample_width();
    let rows = par_rows(spec.sample_height(), threads, |row| {
        (0..w)
            .map(|col| {
                let (a, b) = spec.dc(offset, col, row);
                let o = kernel.sample_at(spec.degree, julia, a, b);
                (o.smooth, o.iterations, o.rebases)
            })
            .collect()
    });
    F64Field {
        smooth: rows.iter().map(|r| r.0).collect(),
        iterations: rows.iter().map(|r| r.1).collect(),
        rebases: rows.iter().map(|r| r.2).collect(),
        wall_s: start.elapsed().as_secs_f64(),
    }
}

/// `perturb`'s orbit with every point rounded to `f32` and back. The `f64` kernel run on
/// it measures what storing the reference in `f32` costs on its own, with every other
/// operation still `f64`: a floor the model cannot be expected to beat with
/// [`Encoding::F32Pair`], and a yardstick for how sensitive a frame is to a relative
/// error of `2^-24` per step.
pub fn narrowed_reference(orbit: &Reference) -> Reference {
    Reference {
        points: orbit
            .points
            .iter()
            .map(|&[a, b]| [a as f32 as f64, b as f32 as f64])
            .collect(),
        escaped: orbit.escaped,
        periodic: orbit.periodic,
        period_residual: orbit.period_residual,
        limbs: orbit.limbs,
    }
}

/// The frame drawn by `perturb` from a different reference, for the `moved` floor: a
/// second opinion in `f64` whose only change is which orbit the deltas are taken from.
///
/// On the parameter plane the reference is the view centre moved by `px` samples (across,
/// up), formed in `perturb`'s fixed point so no digit of the centre is lost, and any named
/// nucleus period is dropped: the moved point is not a nucleus. On a Julia plane the
/// orbit is fixed by `c`, so the second opinion is the other anchor (`z = 0` against
/// `z = c`), which changes the offsets every sample starts from and which point of the
/// orbit they are measured against. Returns the spec and a phrase saying which was done.
pub fn moved_spec(spec: &Spec, px: [f64; 2]) -> Result<(Spec, String), String> {
    let mut moved = spec.clone();
    if spec.julia.is_some() {
        moved.anchor = match spec.anchor {
            Anchor::Parameter => Anchor::Origin,
            Anchor::Origin => Anchor::Parameter,
        };
        if !moved.limbs_fit() {
            return Err("the other anchor needs more limbs than perturb forms".into());
        }
        let name = match moved.anchor {
            Anchor::Origin => "origin",
            Anchor::Parameter => "parameter",
        };
        return Ok((moved, format!("anchor {name}")));
    }
    let limbs = spec.limbs();
    let spacing = spec.width / spec.sample_width() as f64;
    // Every fraction bit of the limbs, in decimal: 64 bits is under 20 digits a limb.
    let places = (limbs - 1) * 20;
    let shift = |text: &str, by: f64| -> Result<String, String> {
        let at = Fx::parse(text, limbs).ok_or_else(|| format!("`{text}` is not a decimal"))?;
        let by = Fx::from_f64(by, limbs).ok_or("the shift is not finite")?;
        Ok(at.add(&by).to_decimal(places))
    };
    moved.reference = Some((
        shift(&spec.center_re, px[0] * spacing)?,
        shift(&spec.center_im, px[1] * spacing)?,
    ));
    moved.period = None;
    Ok((
        moved,
        format!("reference moved by ({}, {}) samples", px[0], px[1]),
    ))
}

/// Runs the model over the frame, in passes of `budget` steps per pixel.
pub fn run_model(frame: &Frame, orbit: &GpuOrbit, threads: usize, budget: u32) -> ModelField {
    run_model_bla(frame, orbit, None, threads, budget)
}

/// [`run_model`], with the skip table switched on when one is given.
pub fn run_model_bla(
    frame: &Frame,
    orbit: &GpuOrbit,
    table: Option<&GpuTable>,
    threads: usize,
    budget: u32,
) -> ModelField {
    let start = Instant::now();
    let rows = par_rows(frame.height_px, threads, |row| {
        (0..frame.width_px)
            .map(|col| match table {
                None => (
                    model::run_pixel(frame, orbit, col, row, budget),
                    BlaStats::default(),
                ),
                Some(t) => model::run_pixel_bla(frame, orbit, t, col, row, budget),
            })
            .collect()
    });
    ModelField {
        smooth: rows.iter().map(|r| model::smooth_f64(&r.0)).collect(),
        status: rows.iter().map(|r| r.0.status).collect(),
        steps: rows.iter().map(|r| r.0.steps).collect(),
        scaled: rows.iter().map(|r| r.0.scaled).collect(),
        rebases: rows.iter().map(|r| r.0.rebases).collect(),
        bla_steps: rows.iter().map(|r| r.1.bla_steps).collect(),
        skipped: rows.iter().map(|r| r.1.skipped).collect(),
        reads: rows.iter().map(|r| r.1.reads).collect(),
        probes: rows.iter().map(|r| r.1.probes).collect(),
        unproven: rows
            .iter()
            .map(|r| r.0.proof.gated() && r.0.status != INTERIOR)
            .collect(),
        nonfinite: rows
            .iter()
            .filter(|r| !(r.0.d[0].is_finite() && r.0.d[1].is_finite()))
            .count(),
        wall_s: start.elapsed().as_secs_f64(),
    }
}

/// The double-single kernel over the frame ([`crate::model_ds`]), on a `HiLo` orbit, with
/// the skip table switched on when one is given.
pub fn run_model_ds(
    frame: &Frame,
    lo: &FrameLo,
    orbit: &GpuOrbit,
    table: Option<&GpuTable>,
    threads: usize,
    budget: u32,
) -> ModelField {
    let start = Instant::now();
    let rows = par_rows(frame.height_px, threads, |row| {
        (0..frame.width_px)
            .map(|col| match table {
                None => (
                    model_ds::run_pixel_ds(frame, lo, orbit, col, row, budget),
                    BlaStats::default(),
                ),
                Some(t) => model_ds::run_pixel_ds_bla(frame, lo, orbit, t, col, row, budget),
            })
            .collect()
    });
    ModelField {
        smooth: rows.iter().map(|r| model_ds::smooth_f64_ds(&r.0)).collect(),
        status: rows.iter().map(|r| r.0.status).collect(),
        steps: rows.iter().map(|r| r.0.steps).collect(),
        scaled: rows.iter().map(|r| r.0.scaled).collect(),
        rebases: rows.iter().map(|r| r.0.rebases).collect(),
        bla_steps: rows.iter().map(|r| r.1.bla_steps).collect(),
        skipped: rows.iter().map(|r| r.1.skipped).collect(),
        reads: rows.iter().map(|r| r.1.reads).collect(),
        probes: rows.iter().map(|r| r.1.probes).collect(),
        unproven: rows
            .iter()
            .map(|r| r.0.proof.gated() && r.0.status != INTERIOR)
            .collect(),
        nonfinite: rows.iter().filter(|r| !r.0.finite()).count(),
        wall_s: start.elapsed().as_secs_f64(),
    }
}

/// What the survivors' way cost over a frame, in delta steps.
#[derive(Debug, Clone, Default)]
pub struct SurvivorCost {
    /// Per sample: the `f32` kernel's steps (kept or wasted) and the re-run's.
    pub f32_steps: Vec<u32>,
    pub ds_steps: Vec<u32>,
    /// Samples re-run in double-single.
    pub redone: usize,
}

/// The survivors' way over the frame ([`crate::survivors`]): the `f32` kernel on
/// `orbit_f32`, and the double-single kernel on `orbit_hilo` for every sample still
/// running at `threshold`. The field's `steps` are the two kernels' together.
#[allow(clippy::too_many_arguments)]
pub fn run_model_survivors(
    frame: &Frame,
    lo: &FrameLo,
    orbit_f32: &GpuOrbit,
    orbit_hilo: &GpuOrbit,
    tables: (Option<&GpuTable>, Option<&GpuTable>),
    threads: usize,
    budget: u32,
    threshold: u32,
) -> (ModelField, SurvivorCost) {
    let start = Instant::now();
    let rows = par_rows(frame.height_px, threads, |row| {
        (0..frame.width_px)
            .map(|col| {
                survivors::run_pixel_survivors_bla(
                    frame, lo, orbit_f32, orbit_hilo, tables.0, tables.1, col, row, budget,
                    threshold,
                )
            })
            .collect()
    });
    let field = ModelField {
        smooth: rows.iter().map(|r| r.smooth_f64()).collect(),
        status: rows.iter().map(|r| r.status).collect(),
        steps: rows.iter().map(|r| r.f32_steps + r.ds_steps).collect(),
        scaled: rows
            .iter()
            .map(|r| r.f32_state.scaled + r.ds_state.map_or(0, |d| d.scaled))
            .collect(),
        rebases: rows
            .iter()
            .map(|r| r.ds_state.map_or(r.f32_state.rebases, |d| d.rebases))
            .collect(),
        bla_steps: rows.iter().map(|r| r.bla.bla_steps).collect(),
        skipped: rows.iter().map(|r| r.bla.skipped).collect(),
        reads: rows.iter().map(|r| r.bla.reads).collect(),
        probes: rows.iter().map(|r| r.bla.probes).collect(),
        unproven: rows
            .iter()
            .map(|r| {
                let proof = r.ds_state.map_or(r.f32_state.proof, |d| d.proof);
                proof.gated() && r.status != INTERIOR
            })
            .collect(),
        nonfinite: rows
            .iter()
            .filter(|r| match r.ds_state {
                Some(d) => !d.finite(),
                None => !(r.f32_state.d[0].is_finite() && r.f32_state.d[1].is_finite()),
            })
            .count(),
        wall_s: start.elapsed().as_secs_f64(),
    };
    let cost = SurvivorCost {
        f32_steps: rows.iter().map(|r| r.f32_steps).collect(),
        ds_steps: rows.iter().map(|r| r.ds_steps).collect(),
        redone: rows.iter().filter(|r| r.redone).count(),
    };
    (field, cost)
}

/// How the two fields agree.
#[derive(Debug, Clone, Default)]
pub struct Agreement {
    pub samples: usize,
    pub both_escaped: usize,
    pub both_interior: usize,
    /// `perturb` escapes and the model does not.
    pub f64_only_escaped: usize,
    /// The model escapes and `perturb` does not.
    pub model_only_escaped: usize,
    /// `|Î” smooth|` over the samples both escape at.
    pub p50: f64,
    pub p90: f64,
    pub p99: f64,
    pub max: f64,
    /// Shares of the both-escaped samples whose `|Î” smooth|` exceeds 0.01, 0.1, 1, 10.
    pub over: [f64; 4],
    /// Shares of the both-escaped samples whose `|Î” smooth|` exceeds each of [`LADDER`].
    pub ladder: Vec<f64>,
    /// The same, split by the decade of the iteration count (see [`IterBin`]).
    pub by_iter: Vec<IterBin>,
}

/// One decade of iteration count: samples whose smooth count is in
/// `[10^decade, 10^(decade+1))` (decade 0 takes everything below 10). A both-escaped
/// sample is placed by `perturb`'s count; a class change by the count of whichever side
/// escaped.
#[derive(Debug, Clone, Default)]
pub struct IterBin {
    pub decade: u32,
    pub both_escaped: usize,
    /// Of `both_escaped`, how many exceed 0.1 and 1.
    pub over_tenth: usize,
    pub over_one: usize,
    /// The largest `|Î” smooth|` in the decade.
    pub max: f64,
    pub class_changes: usize,
}

/// The thresholds of [`Agreement::ladder`], fine enough that a colouring's own visible
/// threshold can be read off a corpus run afterwards without running it again.
pub const LADDER: [f64; 11] = [
    0.001, 0.003, 0.01, 0.03, 0.1, 0.3, 1.0, 3.0, 10.0, 100.0, 1000.0,
];

/// The decade bin a smooth count falls in, `0..=9`.
fn decade_of(n: f64) -> u32 {
    if n < 10.0 {
        0
    } else {
        (n.log10().floor() as u32).min(9)
    }
}

impl Agreement {
    /// Mismatched classes as a share of all samples.
    pub fn mismatch_share(&self) -> f64 {
        (self.f64_only_escaped + self.model_only_escaped) as f64 / self.samples.max(1) as f64
    }

    /// The share of both-escaped samples within `0.1` smooth of each other.
    pub fn within_tenth(&self) -> f64 {
        1.0 - self.over[1]
    }
}

pub const THRESHOLDS: [f64; 4] = [0.01, 0.1, 1.0, 10.0];

/// Compares two smooth fields of equal length.
pub fn agree(f64_smooth: &[f64], model_smooth: &[f64]) -> Agreement {
    let mut a = Agreement {
        samples: f64_smooth.len(),
        ..Agreement::default()
    };
    let mut diffs = Vec::new();
    let mut bins: Vec<IterBin> = (0..10)
        .map(|decade| IterBin {
            decade,
            ..IterBin::default()
        })
        .collect();
    for (&x, &y) in f64_smooth.iter().zip(model_smooth) {
        match (x.is_nan(), y.is_nan()) {
            (false, false) => {
                let d = (x - y).abs();
                diffs.push(d);
                let bin = &mut bins[decade_of(x) as usize];
                bin.both_escaped += 1;
                bin.over_tenth += (d > 0.1) as usize;
                bin.over_one += (d > 1.0) as usize;
                bin.max = bin.max.max(d);
            }
            (true, true) => a.both_interior += 1,
            (false, true) => {
                a.f64_only_escaped += 1;
                bins[decade_of(x) as usize].class_changes += 1;
            }
            (true, false) => {
                a.model_only_escaped += 1;
                bins[decade_of(y) as usize].class_changes += 1;
            }
        }
    }
    a.by_iter = bins
        .into_iter()
        .filter(|b| b.both_escaped + b.class_changes > 0)
        .collect();
    a.ladder = vec![0.0; LADDER.len()];
    a.both_escaped = diffs.len();
    if !diffs.is_empty() {
        diffs.sort_by(|p, q| p.total_cmp(q));
        let at = |q: f64| diffs[((diffs.len() - 1) as f64 * q).round() as usize];
        a.p50 = at(0.5);
        a.p90 = at(0.9);
        a.p99 = at(0.99);
        a.max = *diffs.last().unwrap();
        for (k, t) in THRESHOLDS.iter().enumerate() {
            a.over[k] = diffs.iter().filter(|&&d| d > *t).count() as f64 / diffs.len() as f64;
        }
        // `diffs` is sorted: the share above `t` is what lies past its upper partition.
        for (k, t) in LADDER.iter().enumerate() {
            let within = diffs.partition_point(|&d| d <= *t);
            a.ladder[k] = (diffs.len() - within) as f64 / diffs.len() as f64;
        }
    }
    a
}

/// The agreement members every JSON object in a line carries, after its opening brace
/// and without a trailing comma.
fn agreement_json(a: &Agreement) -> String {
    let ladder: Vec<String> = a.ladder.iter().map(|s| format!("{s:.5}")).collect();
    let bins: Vec<String> = a
        .by_iter
        .iter()
        .map(|b| {
            format!(
                "{{\"decade\":{},\"both_escaped\":{},\"over_0.1\":{},\"over_1\":{},\"max\":{},\"class_changes\":{}}}",
                b.decade,
                b.both_escaped,
                b.over_tenth,
                b.over_one,
                num(b.max),
                b.class_changes
            )
        })
        .collect();
    format!(
        "\"both_escaped\":{},\"both_interior\":{},\"f64_only_escaped\":{},\"model_only_escaped\":{},\"p50\":{},\"p90\":{},\"p99\":{},\"max\":{},\"over_0.01\":{:.5},\"over_0.1\":{:.5},\"over_1\":{:.5},\"over_10\":{:.5},\"ladder\":[{}],\"by_iter\":[{}]",
        a.both_escaped,
        a.both_interior,
        a.f64_only_escaped,
        a.model_only_escaped,
        num(a.p50),
        num(a.p90),
        num(a.p99),
        num(a.max),
        a.over[0],
        a.over[1],
        a.over[2],
        a.over[3],
        ladder.join(","),
        bins.join(",")
    )
}

/// FNV-1a over every sample's smooth count, status and delta steps: two runs that print
/// the same hash drew the same field the same way (a lookup order that changes only the
/// reads keeps it).
fn field_hash(mf: &ModelField) -> u64 {
    let mut h = 0xcbf2_9ce4_8422_2325u64;
    let mut eat = |bytes: &[u8]| {
        for &b in bytes {
            h ^= b as u64;
            h = h.wrapping_mul(0x0000_0100_0000_01b3);
        }
    };
    for i in 0..mf.smooth.len() {
        eat(&mf.smooth[i].to_bits().to_le_bytes());
        eat(&mf.status[i].to_le_bytes());
        eat(&mf.steps[i].to_le_bytes());
        eat(&mf.skipped[i].to_le_bytes());
    }
    h
}

fn mean_u32(v: &[u32]) -> f64 {
    v.iter().map(|&x| x as f64).sum::<f64>() / v.len().max(1) as f64
}

fn num(x: f64) -> String {
    if x.is_finite() {
        format!("{x}")
    } else {
        "null".into()
    }
}

/// `id` as a file name: anything but letters, digits and `-_.@` becomes `_`.
pub fn safe_name(id: &str) -> String {
    id.chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.' || c == '@' {
                c
            } else {
                '_'
            }
        })
        .collect()
}

fn write_f64(path: &Path, values: &[f64]) -> std::io::Result<()> {
    let mut bytes = Vec::with_capacity(values.len() * 8);
    for v in values {
        bytes.extend_from_slice(&v.to_le_bytes());
    }
    fs::write(path, bytes)
}

fn write_f32(path: &Path, values: &[f32]) -> std::io::Result<()> {
    let mut bytes = Vec::with_capacity(values.len() * 4);
    for v in values {
        bytes.extend_from_slice(&v.to_le_bytes());
    }
    fs::write(path, bytes)
}

/// One model's member of a line's `models` object, `"key":{...}`, with `extra` (members
/// with a leading comma, or nothing) before its closing brace.
fn model_json(
    key: &str,
    mf: &ModelField,
    a: &Agreement,
    frame: &Frame,
    ref_bytes: usize,
    extra: &str,
) -> String {
    let count = |c: u32| mf.status.iter().filter(|&&s| s == c).count();
    let steps = mean_u32(&mf.steps);
    let bla_steps = mean_u32(&mf.bla_steps);
    // A GPU workgroup waits on its slowest pixel, so the tail is reported too.
    let mut sorted_steps = mf.steps.clone();
    sorted_steps.sort_unstable();
    if sorted_steps.is_empty() {
        sorted_steps.push(0);
    }
    let mut sorted_reads = mf.reads.clone();
    sorted_reads.sort_unstable();
    if sorted_reads.is_empty() {
        sorted_reads.push(0);
    }
    format!(
        "\"{key}\":{{\"bla_steps\":{:.1},\"ptb_steps\":{:.1},\"skipped\":{:.1},\"reads\":{:.1},\"probes\":{:.1},\"p99_reads\":{},\"max_reads\":{},\"field_hash\":\"{:016x}\",\"escaped\":{},\"capped\":{},\"proven\":{},\"gated\":{},\"unproven\":{},{},\"mean_steps\":{:.1},\"p50_steps\":{},\"p99_steps\":{},\"max_steps\":{},\"scaled_share\":{:.4},\"mean_rebases\":{:.3},\"max_rebases\":{},\"nonfinite\":{},\"offset_px\":{},\"sc\":{},\"ref_bytes\":{},\"wall_s\":{:.3}{extra}}}",
        bla_steps,
        steps - bla_steps,
        mean_u32(&mf.skipped),
        mean_u32(&mf.reads),
        mean_u32(&mf.probes),
        sorted_reads[(sorted_reads.len() - 1) * 99 / 100],
        sorted_reads.last().copied().unwrap_or(0),
        field_hash(mf),
        count(ESCAPED),
        count(CAPPED),
        count(INTERIOR),
        count(GATED),
        mf.unproven.iter().filter(|&&u| u).count(),
        agreement_json(a),
        mean_u32(&mf.steps),
        sorted_steps[sorted_steps.len() / 2],
        sorted_steps[(sorted_steps.len() - 1) * 99 / 100],
        sorted_steps.last().copied().unwrap_or(0),
        mean_u32(&mf.scaled) / mean_u32(&mf.steps).max(1.0),
        mean_u32(&mf.rebases),
        mf.rebases.iter().max().copied().unwrap_or(0),
        mf.nonfinite,
        num(frame.offset_in_pixels()),
        frame.sc,
        ref_bytes,
        mf.wall_s
    )
}

/// The `perturb::Spec` a comparison runs `fs_` at: the resolution, the cap (`opts.cap`, or
/// the row's own lowered to `opts.cap_max`) and the interior switch from `opts`, refused
/// where `perturb` would not draw it. `export` builds its bundles from this too, so a
/// bundle is the frame `compare` runs.
pub fn spec_for(fs_: &FrameSpec, opts: &Options) -> Result<Spec, String> {
    let cap = match (opts.cap, opts.cap_max) {
        (Some(c), _) => Some(c),
        (None, Some(mx)) => Some(fs_.n.unwrap_or(mx).min(mx)),
        (None, None) => None,
    };
    let spec = fs_.spec(opts.resolution, cap, opts.interior);
    if !perturb::kernel::DEGREES.contains(&spec.degree) {
        return Err(format!("{}: degree {} is not drawn", fs_.id, spec.degree));
    }
    if !spec.limbs_fit() {
        return Err(format!(
            "{}: the reference needs more limbs than perturb forms",
            fs_.id
        ));
    }
    Ok(spec)
}

/// Compares one frame, and returns its JSON line.
pub fn compare_frame(fs_: &FrameSpec, opts: &Options) -> Result<String, String> {
    let spec = spec_for(fs_, opts)?;
    let t0 = Instant::now();
    let orbit = spec.reference_orbit()?;
    let ref_s = t0.elapsed().as_secs_f64();
    let f64_field = run_f64(&spec, &orbit, opts.threads);

    let mut out = String::new();
    out.push_str(&format!(
        "{{\"id\":\"{}\",\"width\":{:e},\"degree\":{},\"julia\":{},\"resolution\":[{},{}],\"cap\":{},\"interior\":{},\"interior_policy\":\"{}\",\"samples\":{},\"ref_points\":{},\"ref_periodic\":{},\"ref_s\":{:.3}",
        fs_.id.replace('"', "'"),
        spec.width,
        spec.degree,
        spec.julia.is_some(),
        opts.resolution[0],
        opts.resolution[1],
        spec.maxiter(),
        opts.interior,
        opts.interior_policy.name(),
        f64_field.smooth.len(),
        orbit.len(),
        orbit.periodic,
        ref_s
    ));
    let f64_escaped = f64_field.smooth.iter().filter(|x| !x.is_nan()).count();
    out.push_str(&format!(
        ",\"f64\":{{\"escaped\":{},\"mean_iterations\":{:.1},\"mean_rebases\":{:.3},\"wall_s\":{:.3}}}",
        f64_escaped,
        mean_u32(&f64_field.iterations),
        mean_u32(&f64_field.rebases),
        f64_field.wall_s
    ));
    // What a dump is called: the id, and the cap where a ladder dumps one frame often.
    let base = if opts.cap_in_name {
        safe_name(&format!("{}_n{}", fs_.id, spec.maxiter()))
    } else {
        safe_name(&fs_.id)
    };
    let mut dumped: Vec<String> = Vec::new();
    let dump_f64 = |tag: &str, values: &[f64], dumped: &mut Vec<String>| -> Result<(), String> {
        if let Some(dir) = &opts.dump {
            write_f64(&dir.join(format!("{base}.{tag}.bin")), values).map_err(|e| e.to_string())?;
            dumped.push(tag.to_string());
        }
        Ok(())
    };
    if let Some(dir) = &opts.dump {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        // `perturb`'s iteration counts, `u32` a sample: what a reader bins by.
        let mut bytes = Vec::with_capacity(f64_field.iterations.len() * 4);
        for v in &f64_field.iterations {
            bytes.extend_from_slice(&v.to_le_bytes());
        }
        fs::write(dir.join(format!("{base}.iter.bin")), bytes).map_err(|e| e.to_string())?;
    }
    dump_f64("f64", &f64_field.smooth, &mut dumped)?;

    if opts.floor {
        let narrowed = narrowed_reference(&orbit);
        let floor_field = run_f64(&spec, &narrowed, opts.threads);
        let a = agree(&f64_field.smooth, &floor_field.smooth);
        out.push_str(&format!(
            ",\"floor\":{{{},\"wall_s\":{:.3}}}",
            agreement_json(&a),
            floor_field.wall_s
        ));
        dump_f64("f64rounded", &floor_field.smooth, &mut dumped)?;
    }
    if opts.floor_moved {
        match moved_spec(&spec, opts.move_px) {
            Ok((moved, how)) => {
                let t = Instant::now();
                let moved_orbit = moved.reference_orbit()?;
                let moved_ref_s = t.elapsed().as_secs_f64();
                let moved_field = run_f64(&moved, &moved_orbit, opts.threads);
                let a = agree(&f64_field.smooth, &moved_field.smooth);
                out.push_str(&format!(
                    ",\"floor_moved\":{{\"how\":\"{}\",\"ref_points\":{},\"ref_s\":{:.3},{},\"wall_s\":{:.3}}}",
                    how,
                    moved_orbit.len(),
                    moved_ref_s,
                    agreement_json(&a),
                    moved_field.wall_s
                ));
                dump_f64("f64moved", &moved_field.smooth, &mut dumped)?;
            }
            Err(why) => out.push_str(&format!(
                ",\"floor_moved\":{{\"unavailable\":\"{}\"}}",
                why.replace('"', "'")
            )),
        }
    }

    // The table is a function of the `f64` orbit and the frame, not of the encoding; the
    // `f32` kernels read it, and the survivors' `f32` phase.
    let table = if opts.bla != BlaMode::Off
        && (!opts.encodings.is_empty() || !opts.survivors.is_empty())
    {
        let frame = Frame::from_spec(&spec, orbit.len())?;
        let t = GpuTable::build(&orbit, &frame, &opts.bla_options);
        let points = orbit.len().max(1) as f64;
        out.push_str(&format!(
            ",\"bla\":{{\"eps\":{:e},\"search\":\"{}\",\"gate\":{},\"min_level\":{},\"max_level\":{},\"levels\":{},\"entries\":{},\"valid\":{},\"entry_bytes\":{},\"interior_bytes\":{},\"header_bytes\":{},\"bytes_per_ref_iter\":{:.3},\"bytes_per_ref_iter_interior\":{:.3},\"dc_bound\":{:e},\"build_s\":{:.4}}}",
            t.epsilon,
            t.search.name(),
            t.gate,
            opts.bla_options.min_level,
            t.top_level().map_or(-1, |k| k as i64),
            t.header.levels,
            t.entries.len(),
            t.valid,
            t.entry_bytes(),
            t.interior_bytes(),
            HEADER_BYTES,
            (t.entries.len() * ENTRY_BYTES) as f64 / points,
            (t.entries.len() * (ENTRY_BYTES + INTERIOR_BYTES)) as f64 / points,
            t.dc_bound,
            t.build_s
        ));
        Some(t)
    } else {
        None
    };

    out.push_str(",\"models\":{");
    let mut first = true;
    let mut table = table;
    // Each BLA run once in the table's own order, then once per extra order, then (with
    // `flip_gate`) each of those again with the gate flipped.
    let mut runs: Vec<Option<(Search, bool)>> = Vec::new();
    for &with_bla in opts.bla.runs() {
        if with_bla {
            let orders: Vec<Search> = std::iter::once(opts.bla_options.search)
                .chain(opts.extra_searches.iter().copied())
                .collect();
            let gates: &[bool] = if opts.flip_gate {
                &[false, true]
            } else {
                &[false]
            };
            for &flip in gates {
                for &s in &orders {
                    runs.push(Some((s, opts.bla_options.gate != flip)));
                }
            }
        } else {
            runs.push(None);
        }
    }
    for &enc in opts.encodings.iter() {
        for &run in runs.iter() {
            let with_bla = run.is_some();
            if let (Some(t), Some((s, g))) = (table.as_mut(), run) {
                t.search = s;
                t.gate = g;
            }
            let gpu = GpuOrbit::from_reference(&orbit, enc);
            let frame = Frame::from_spec(&spec, gpu.len())?.with_policy(opts.interior_policy);
            let mut mf = run_model_bla(
                &frame,
                &gpu,
                if with_bla { table.as_ref() } else { None },
                opts.threads,
                opts.budget,
            );
            mf.settle_gated(&f64_field.smooth);
            let a = agree(&f64_field.smooth, &mf.smooth);
            if !first {
                out.push(',');
            }
            first = false;
            let key = match run {
                None => enc.name().to_string(),
                Some((s, g)) => {
                    let mut k = format!("{}+bla", enc.name());
                    if s != opts.bla_options.search {
                        k.push(':');
                        k.push_str(s.name());
                    }
                    if g != opts.bla_options.gate {
                        k.push_str(if g { "+gate" } else { "+nogate" });
                    }
                    k
                }
            };
            out.push_str(&model_json(&key, &mf, &a, &frame, gpu.gpu_bytes(), ""));
            if let Some(dir) = &opts.dump {
                let narrowed: Vec<f32> = mf.smooth.iter().map(|&x| x as f32).collect();
                let tag = safe_name(&key);
                dump_f64(&tag, &mf.smooth, &mut dumped)?;
                write_f32(&dir.join(format!("{base}.{tag}.f32.bin")), &narrowed)
                    .map_err(|e| e.to_string())?;
            }
        }
    }

    // The double-single kernel and the survivors' way: both read the `HiLo` orbit, and
    // with the skip on, a table of their own at `ds_eps` (the survivors' `f32` phase
    // takes the `f32` one). The double-single table's own figures go after `models`.
    let mut ds_bla_json = String::new();
    if opts.ds || !opts.survivors.is_empty() {
        let hilo = GpuOrbit::from_reference(&orbit, Encoding::HiLo);
        let pair = GpuOrbit::from_reference(&orbit, Encoding::F32Pair);
        let frame = Frame::from_spec(&spec, hilo.len())?.with_policy(opts.interior_policy);
        let lo = FrameLo::from_spec(&spec, &frame)?;
        let ds_table = if opts.bla != BlaMode::Off {
            let ds_opts = BlaOptions {
                epsilon: opts.ds_eps,
                ..opts.bla_options
            };
            let t = GpuTable::build(&orbit, &frame, &ds_opts);
            ds_bla_json = format!(
                ",\"ds_bla\":{{\"eps\":{:e},\"entries\":{},\"valid\":{},\"bytes_per_ref_iter\":{:.3},\"build_s\":{:.4}}}",
                t.epsilon,
                t.entries.len(),
                t.valid,
                t.entries.len() as f64 * (ENTRY_BYTES + crate::bla::LO_BYTES) as f64
                    / orbit.len().max(1) as f64,
                t.build_s
            );
            Some(t)
        } else {
            None
        };
        if let Some(t) = table.as_mut() {
            t.search = opts.bla_options.search;
            t.gate = opts.bla_options.gate;
        }
        // Each scheme's key, field, and (for survivors) its threshold and cost.
        type Keyed = (String, ModelField, Option<(u32, SurvivorCost)>);
        let mut keyed: Vec<Keyed> = Vec::new();
        for &with_bla in opts.bla.runs() {
            let suffix = if with_bla { "+bla" } else { "" };
            if opts.ds {
                let t = if with_bla { ds_table.as_ref() } else { None };
                let mf = run_model_ds(&frame, &lo, &hilo, t, opts.threads, opts.budget);
                keyed.push((format!("ds{suffix}"), mf, None));
            }
            for &threshold in &opts.survivors {
                let tables = if with_bla {
                    (table.as_ref(), ds_table.as_ref())
                } else {
                    (None, None)
                };
                let (mf, cost) = run_model_survivors(
                    &frame,
                    &lo,
                    &pair,
                    &hilo,
                    tables,
                    opts.threads,
                    opts.budget,
                    threshold,
                );
                keyed.push((
                    format!("survivors@{threshold}{suffix}"),
                    mf,
                    Some((threshold, cost)),
                ));
            }
        }
        for (key, mut mf, cost) in keyed {
            mf.settle_gated(&f64_field.smooth);
            let a = agree(&f64_field.smooth, &mf.smooth);
            let extra = match &cost {
                None => format!(",\"ds_eps\":{:e}", opts.ds_eps),
                Some((threshold, c)) => format!(
                    ",\"ds_eps\":{:e},\"threshold\":{},\"redone\":{},\"survivor_share\":{:.5},\"f32_steps\":{:.1},\"ds_steps\":{:.1},\"max_ds_steps\":{}",
                    opts.ds_eps,
                    threshold,
                    c.redone,
                    c.redone as f64 / c.f32_steps.len().max(1) as f64,
                    mean_u32(&c.f32_steps),
                    mean_u32(&c.ds_steps),
                    c.ds_steps.iter().max().copied().unwrap_or(0)
                ),
            };
            if !first {
                out.push(',');
            }
            first = false;
            out.push_str(&model_json(&key, &mf, &a, &frame, hilo.gpu_bytes(), &extra));
            if opts.dump.is_some() {
                dump_f64(&safe_name(&key), &mf.smooth, &mut dumped)?;
            }
        }
    }
    out.push('}');
    out.push_str(&ds_bla_json);
    out.push('}');

    // What a reader of the dump needs and the binaries do not say.
    if let Some(dir) = &opts.dump {
        let fields: Vec<String> = dumped.iter().map(|t| format!("\"{t}\"")).collect();
        let link = match &fs_.link {
            Some(l) => format!("\"{}\"", l.replace('\\', "\\\\").replace('"', "\\\"")),
            None => "null".into(),
        };
        let meta = format!(
            "{{\"id\":\"{}\",\"base\":\"{base}\",\"link\":{link},\"width\":{:e},\"degree\":{},\"julia\":{},\"resolution\":[{},{}],\"cap\":{},\"interior\":{},\"interior_policy\":\"{}\",\"fields\":[{}],\"iter\":\"{base}.iter.bin\"}}\n",
            fs_.id.replace('"', "'"),
            spec.width,
            spec.degree,
            spec.julia.is_some(),
            spec.sample_width(),
            spec.sample_height(),
            spec.maxiter(),
            opts.interior,
            opts.interior_policy.name(),
            fields.join(",")
        );
        fs::write(dir.join(format!("{base}.meta.json")), meta).map_err(|e| e.to_string())?;
    }
    Ok(out)
}

/// Appends one line to `path`, or prints it when there is none.
pub fn emit(line: &str, path: Option<&Path>) -> std::io::Result<()> {
    match path {
        Some(p) => {
            let mut f = fs::OpenOptions::new().create(true).append(true).open(p)?;
            f.write_all(line.as_bytes())?;
            f.write_all(b"\n")
        }
        None => {
            println!("{line}");
            Ok(())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The moved reference sits where it was asked to, to the last bit the frame needs,
    /// with every digit of a deep centre carried through the fixed point.
    #[test]
    fn moved_reference_is_where_it_was_asked() {
        let row = r#"{"id":"m","re":"-0.74501772828532335842941892835857434","im":"0.14993443275456819177805709088257971","w":2e-30,"n":5000}"#;
        let spec = FrameSpec::from_row(row).unwrap().spec([64, 36], None, true);
        let (moved, how) = moved_spec(&spec, [1.5, -2.0]).unwrap();
        assert!(how.starts_with("reference moved"), "{how}");
        let spacing = spec.width / 64.0;
        let (dre, dim) = moved.centre_offset().unwrap();
        assert!((dre / spacing + 1.5).abs() < 1e-9, "{}", dre / spacing);
        assert!((dim / spacing - 2.0).abs() < 1e-9, "{}", dim / spacing);
        assert_eq!(moved.period, None);
    }

    #[test]
    fn a_julia_frame_moves_to_its_other_anchor() {
        let row = r#"{"id":"j","re":"0.1","im":"0.6","w":1e-6,"n":5000,"julia_re":"-0.12","julia_im":"0.75"}"#;
        let spec = FrameSpec::from_row(row).unwrap().spec([32, 18], None, true);
        let (moved, how) = moved_spec(&spec, [1.5, 1.0]).unwrap();
        assert_eq!(moved.anchor, Anchor::Origin);
        assert_eq!(how, "anchor origin");
    }

    /// The ladder and the decade bins say what the coarse shares say, and place a sample
    /// by `perturb`'s count.
    #[test]
    fn ladder_and_decades_agree_with_the_shares() {
        let f64s = [5.0, 50.0, 500.0, 5000.0, f64::NAN, 70.0];
        let model = [5.0005, 50.2, 502.0, 5000.0, 9.0, f64::NAN];
        let a = agree(&f64s, &model);
        assert_eq!(a.both_escaped, 4);
        assert_eq!(
            a.ladder[LADDER.iter().position(|&t| t == 0.1).unwrap()],
            a.over[1]
        );
        assert_eq!(
            a.ladder[LADDER.iter().position(|&t| t == 1.0).unwrap()],
            a.over[2]
        );
        let decade = |d: u32| a.by_iter.iter().find(|b| b.decade == d).unwrap().clone();
        assert_eq!(decade(1).both_escaped, 1);
        assert_eq!(decade(1).over_tenth, 1);
        // The class changes: 70 (f64 escaped, decade 1) and 9 (model escaped, decade 0).
        assert_eq!(decade(1).class_changes, 1);
        assert_eq!(decade(0).class_changes, 1);
        assert_eq!(decade(2).over_one, 1);
    }
}
