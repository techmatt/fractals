//! The comparison harness: `perturb`'s `f64` kernel and the model, on the same samples
//! of the same frame, and what separates them.
//!
//! This is CPU-side code and uses `f64` freely; the model path it drives does not. Both
//! kernels see the same `perturb::Spec`, the same reference orbit (`Spec::reference_orbit`,
//! narrowed for the model by [`GpuOrbit::from_reference`]) and the same sample grid. The
//! `f64` kernel takes its offsets from `Spec::dc`; the model forms its own from the frame
//! constants ([`Frame::dc_mantissa`]), which is part of what is being measured.

use std::fs;
use std::io::Write as _;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};
use std::time::Instant;

use perturb::kernel::Kernel;
use perturb::reference::Reference;
use perturb::{Anchor, Spec};

use crate::frame::{Frame, spec_of};
use crate::json;
use crate::model::{self, CAPPED, ESCAPED, INTERIOR};
use crate::orbit::{Encoding, GpuOrbit};

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
    /// Also runs the `f64` kernel on the `f32`-narrowed reference
    /// ([`narrowed_reference`]) and reports its agreement as `floor`.
    pub floor: bool,
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
            floor: false,
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
    /// Samples whose final delta mantissa is not finite.
    pub nonfinite: usize,
    pub wall_s: f64,
}

/// Rows `0..height` over `threads` workers, two rows at a time, reassembled in order.
fn par_rows<T: Send>(height: u32, threads: usize, f: impl Fn(u32) -> Vec<T> + Sync) -> Vec<T> {
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

/// Runs the model over the frame, in passes of `budget` steps per pixel.
pub fn run_model(frame: &Frame, orbit: &GpuOrbit, threads: usize, budget: u32) -> ModelField {
    let start = Instant::now();
    let rows = par_rows(frame.height_px, threads, |row| {
        (0..frame.width_px)
            .map(|col| model::run_pixel(frame, orbit, col, row, budget))
            .collect()
    });
    ModelField {
        smooth: rows.iter().map(model::smooth_f64).collect(),
        status: rows.iter().map(|s| s.status).collect(),
        steps: rows.iter().map(|s| s.steps).collect(),
        scaled: rows.iter().map(|s| s.scaled).collect(),
        rebases: rows.iter().map(|s| s.rebases).collect(),
        nonfinite: rows
            .iter()
            .filter(|s| !(s.d[0].is_finite() && s.d[1].is_finite()))
            .count(),
        wall_s: start.elapsed().as_secs_f64(),
    }
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
    /// `|Δ smooth|` over the samples both escape at.
    pub p50: f64,
    pub p90: f64,
    pub p99: f64,
    pub max: f64,
    /// Shares of the both-escaped samples whose `|Δ smooth|` exceeds 0.01, 0.1, 1, 10.
    pub over: [f64; 4],
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
    for (&x, &y) in f64_smooth.iter().zip(model_smooth) {
        match (x.is_nan(), y.is_nan()) {
            (false, false) => diffs.push((x - y).abs()),
            (true, true) => a.both_interior += 1,
            (false, true) => a.f64_only_escaped += 1,
            (true, false) => a.model_only_escaped += 1,
        }
    }
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
    }
    a
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

fn safe_name(id: &str) -> String {
    id.chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.' {
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

/// Compares one frame, and returns its JSON line.
pub fn compare_frame(fs_: &FrameSpec, opts: &Options) -> Result<String, String> {
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
    let t0 = Instant::now();
    let orbit = spec.reference_orbit()?;
    let ref_s = t0.elapsed().as_secs_f64();
    let f64_field = run_f64(&spec, &orbit, opts.threads);

    let mut out = String::new();
    out.push_str(&format!(
        "{{\"id\":\"{}\",\"width\":{:e},\"degree\":{},\"julia\":{},\"resolution\":[{},{}],\"cap\":{},\"interior\":{},\"samples\":{},\"ref_points\":{},\"ref_periodic\":{},\"ref_s\":{:.3}",
        fs_.id.replace('"', "'"),
        spec.width,
        spec.degree,
        spec.julia.is_some(),
        opts.resolution[0],
        opts.resolution[1],
        spec.maxiter(),
        opts.interior,
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
    if opts.floor {
        let narrowed = narrowed_reference(&orbit);
        let floor_field = run_f64(&spec, &narrowed, opts.threads);
        let a = agree(&f64_field.smooth, &floor_field.smooth);
        out.push_str(&format!(
            ",\"floor\":{{\"both_escaped\":{},\"f64_only_escaped\":{},\"model_only_escaped\":{},\"p50\":{},\"p90\":{},\"p99\":{},\"max\":{},\"over_0.01\":{:.5},\"over_0.1\":{:.5},\"over_1\":{:.5},\"over_10\":{:.5}}}",
            a.both_escaped,
            a.f64_only_escaped,
            a.model_only_escaped,
            num(a.p50),
            num(a.p90),
            num(a.p99),
            num(a.max),
            a.over[0],
            a.over[1],
            a.over[2],
            a.over[3]
        ));
    }

    if let Some(dir) = &opts.dump {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        write_f64(
            &dir.join(format!("{}.f64.bin", safe_name(&fs_.id))),
            &f64_field.smooth,
        )
        .map_err(|e| e.to_string())?;
    }

    out.push_str(",\"models\":{");
    for (k, &enc) in opts.encodings.iter().enumerate() {
        let gpu = GpuOrbit::from_reference(&orbit, enc);
        let frame = Frame::from_spec(&spec, gpu.len())?;
        let mf = run_model(&frame, &gpu, opts.threads, opts.budget);
        let a = agree(&f64_field.smooth, &mf.smooth);
        let count = |c: u32| mf.status.iter().filter(|&&s| s == c).count();
        if k > 0 {
            out.push(',');
        }
        out.push_str(&format!(
            "\"{}\":{{\"escaped\":{},\"capped\":{},\"proven\":{},\"both_escaped\":{},\"both_interior\":{},\"f64_only_escaped\":{},\"model_only_escaped\":{},\"p50\":{},\"p90\":{},\"p99\":{},\"max\":{},\"over_0.01\":{:.5},\"over_0.1\":{:.5},\"over_1\":{:.5},\"over_10\":{:.5},\"mean_steps\":{:.1},\"scaled_share\":{:.4},\"mean_rebases\":{:.3},\"max_rebases\":{},\"nonfinite\":{},\"offset_px\":{},\"sc\":{},\"ref_bytes\":{},\"wall_s\":{:.3}}}",
            enc.name(),
            count(ESCAPED),
            count(CAPPED),
            count(INTERIOR),
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
            mean_u32(&mf.steps),
            mean_u32(&mf.scaled) / mean_u32(&mf.steps).max(1.0),
            mean_u32(&mf.rebases),
            mf.rebases.iter().max().copied().unwrap_or(0),
            mf.nonfinite,
            num(frame.offset_in_pixels()),
            frame.sc,
            gpu.gpu_bytes(),
            mf.wall_s
        ));
        if let Some(dir) = &opts.dump {
            let narrowed: Vec<f32> = mf.smooth.iter().map(|&x| x as f32).collect();
            let base = safe_name(&fs_.id);
            write_f64(&dir.join(format!("{base}.{}.bin", enc.name())), &mf.smooth)
                .map_err(|e| e.to_string())?;
            write_f32(
                &dir.join(format!("{base}.{}.f32.bin", enc.name())),
                &narrowed,
            )
            .map_err(|e| e.to_string())?;
        }
    }
    out.push_str("}}");
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
