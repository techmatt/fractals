//! `export`: the GPU bench page's inputs, written by the model it is held to.
//!
//! `export --help` prints the usage below. Two outputs, either or both per run:
//!
//! - **The self-test vectors** (`--vectors FILE`): [`ds::self_test_vectors`] as
//!   `explorer/bench/gpu-probe/vectors.json`, which the page's arithmetic self-test reads.
//! - **Per-frame bundles** (`--frames ... --out DIR`): for each frame, everything a WGSL
//!   port of the per-pixel loop binds (the [`Frame`] and [`FrameLo`] uniforms as the model
//!   lays them out, the orbit as `F32Pair` and as `HiLo`), and what the model says it should
//!   come out as, per pixel: the `f32` kernel and the double-single kernel, each run to the
//!   end with no skip (`n`, `frac`, `status` and `steps` as arrays of their own, and the
//!   whole state but the proof as `f32_state` and `ds_state`, twelve and fourteen words a
//!   pixel in the GPU struct's order), and `perturb`'s `f64` smooth count beside them. One
//!   `<id>.manifest.json` and one `<id>.bin` a frame, and an `index.json` over every
//!   manifest in the directory. The frame is built by [`compare::spec_for`], the orbit
//!   and the uniforms exactly as `compare` builds them, so a bundle is the frame `compare`
//!   runs. The bundles are large and belong under the ignored `artifacts/`.
//!
//! Every bundle is read back from disk after it is written and a spread of its pixels is
//! run again from the decoded bytes alone; the run stops on any bit that differs.

use std::collections::HashMap;
use std::fmt::Write as _;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::Instant;

use deep_gpu_model::compare::{self, FrameSpec, Options, agree, par_rows, run_f64, safe_name};
use deep_gpu_model::frame::{Frame, FrameLo};
use deep_gpu_model::model::{self, CAPPED, ESCAPED, GATED, INTERIOR, PixelState, RUNNING};
use deep_gpu_model::model_ds::{self, DsPixelState};
use deep_gpu_model::orbit::{Encoding, GpuOrbit};
use deep_gpu_model::proof::Margins;
use deep_gpu_model::{ds, json};

const USAGE: &str = "\
export: the GPU bench page's inputs, out of the model.

  --vectors FILE           write ds::self_test_vectors() as the page's vectors.json
  --frames FILE[,FILE..]   JSONL corpus files (compare's row schema); ids are looked up
                           across all of them, the first row with an id wins
  --ids a,b,..             the frames to export (required with --frames)
  --res WxH                samples, one per pixel (default 320x180)
  --cap N                  replace every frame's cap (1e6 style accepted)
  --cap-max N              lower each frame's own cap to at most N
  --interior on|off        perturb's interior switch on all three kernels (default off);
                           on is compare's default policy, cap
  --threads N              worker threads (default: all)
  --verify N               pixels re-run from the written bytes, spread over the frame
                           (default 256; 0 skips the check)
  --out DIR                where the bundles and index.json go

Each frame writes <base>.manifest.json and <base>.bin (<base> is the id with anything but
letters, digits and -_.@ as _), and index.json is rewritten over every *.manifest.json in
DIR, so runs with different caps can share one directory.
";

/// The bundle format's name and version, in every manifest and the index.
const FORMAT: &str = "deep-gpu-model/gpu-probe-bundle/2";

/// Every array in a `.bin` starts on a multiple of this.
const ALIGN: usize = 16;

fn main() {
    if let Err(e) = run() {
        eprintln!("export: {e}\n(export --help for usage)");
        std::process::exit(1);
    }
}

/// A count written either as an integer or in `1e6` style (`compare`'s rule).
fn count(k: &str, v: &str) -> Result<u32, String> {
    let x: f64 = v
        .parse()
        .map_err(|_| format!("--{k}: {v} is not a number"))?;
    if !(x >= 0.0 && x <= u32::MAX as f64 && x.fract() == 0.0) {
        return Err(format!("--{k}: {v} is not a whole number in range"));
    }
    Ok(x as u32)
}

fn run() -> Result<(), String> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.iter().any(|a| a == "--help" || a == "-h") {
        print!("{USAGE}");
        return Ok(());
    }
    let mut flags = HashMap::new();
    let mut i = 0;
    while i < args.len() {
        let key = args[i]
            .strip_prefix("--")
            .ok_or_else(|| format!("unexpected argument {}", args[i]))?;
        let value = args
            .get(i + 1)
            .ok_or_else(|| format!("--{key} needs a value"))?;
        flags.insert(key.to_string(), value.clone());
        i += 2;
    }
    let get = |k: &str| flags.get(k).cloned();
    let parse_u32 =
        |k: &str| -> Result<Option<u32>, String> { get(k).map(|v| count(k, &v)).transpose() };

    if let Some(path) = get("vectors") {
        let n = write_vectors(Path::new(&path))?;
        println!("vectors: {n} cases to {path}");
    }
    let Some(files) = get("frames") else {
        if get("vectors").is_none() {
            return Err("--frames or --vectors is required".into());
        }
        return Ok(());
    };
    let ids = get("ids").ok_or("--ids is required with --frames")?;
    let out = PathBuf::from(get("out").ok_or("--out is required with --frames")?);

    let mut opts = Options {
        resolution: [320, 180],
        interior: false,
        ..Options::default()
    };
    if let Some(res) = get("res") {
        let (a, b) = res.split_once('x').ok_or("--res is WxH")?;
        opts.resolution = [
            a.parse().map_err(|_| "--res width")?,
            b.parse().map_err(|_| "--res height")?,
        ];
    }
    opts.cap = parse_u32("cap")?;
    opts.cap_max = parse_u32("cap-max")?;
    if let Some(t) = parse_u32("threads")? {
        opts.threads = t.max(1) as usize;
    }
    if let Some(v) = get("interior") {
        opts.interior = match v.as_str() {
            "on" => true,
            "off" => false,
            _ => return Err("--interior is on or off".into()),
        };
    }
    let verify = parse_u32("verify")?.unwrap_or(256);

    let mut rows: Vec<FrameSpec> = Vec::new();
    for path in files.split(',').map(str::trim) {
        let text = fs::read_to_string(path).map_err(|e| format!("{path}: {e}"))?;
        for line in text.lines().filter(|l| !l.trim().is_empty()) {
            rows.push(FrameSpec::from_row(line).map_err(|e| format!("{path}: {e}"))?);
        }
    }
    fs::create_dir_all(&out).map_err(|e| format!("{}: {e}", out.display()))?;
    for id in ids.split(',').map(str::trim) {
        let row = rows
            .iter()
            .find(|r| r.id == id)
            .ok_or_else(|| format!("no row has id {id}"))?;
        let t0 = Instant::now();
        let bundle = build(row, &opts)?;
        let base = safe_name(&row.id);
        let bin_path = out.join(format!("{base}.bin"));
        fs::write(&bin_path, &bundle.bin).map_err(|e| e.to_string())?;
        let manifest_path = out.join(format!("{base}.manifest.json"));
        fs::write(&manifest_path, manifest(&bundle, &base)).map_err(|e| e.to_string())?;
        // What the page will read is what is on disk, so that is what is checked.
        let written = fs::read(&bin_path).map_err(|e| e.to_string())?;
        let text = fs::read_to_string(&manifest_path).map_err(|e| e.to_string())?;
        let checked = check(&written, &text, verify, opts.threads)?;
        println!(
            "{id}: {} bytes, orbit {} points, cap {}, {} pixels re-run and equal, {:.1} s",
            bundle.bin.len(),
            bundle.orbit_len,
            bundle.frame.maxiter,
            checked,
            t0.elapsed().as_secs_f64()
        );
    }
    write_index(&out)?;
    Ok(())
}

/// The self-test vectors in the page's format: one case per line, inputs and outputs as
/// `u32` bit patterns. Returns the number of cases.
fn write_vectors(path: &Path) -> Result<usize, String> {
    let cases = ds::self_test_vectors();
    let mut text = String::from(
        "{\n \"generator\": \"deep-gpu-model ds::self_test_vectors (src/ds.rs), written by export --vectors\",\n \"cases\": [\n",
    );
    for (k, (op, input, output)) in cases.iter().enumerate() {
        let list = |v: &[u32]| {
            v.iter()
                .map(|u| u.to_string())
                .collect::<Vec<_>>()
                .join(",")
        };
        let sep = if k + 1 < cases.len() { "," } else { "" };
        let _ = writeln!(
            text,
            "  {{\"op\":\"{op}\",\"in\":[{}],\"out\":[{}]}}{sep}",
            list(input),
            list(output)
        );
    }
    text.push_str(" ]\n}\n");
    fs::write(path, text).map_err(|e| format!("{}: {e}", path.display()))?;
    Ok(cases.len())
}

/// One array in a `.bin`: little-endian, `count` elements of `dtype` from `offset`.
#[derive(Debug, Clone)]
struct Array {
    name: &'static str,
    dtype: &'static str,
    count: usize,
    offset: usize,
    bytes: usize,
}

/// A `.bin` being written: each array padded to [`ALIGN`] before it starts.
#[derive(Default)]
struct Bin {
    bytes: Vec<u8>,
    arrays: Vec<Array>,
}

impl Bin {
    fn push(&mut self, name: &'static str, dtype: &'static str, count: usize, data: Vec<u8>) {
        while !self.bytes.len().is_multiple_of(ALIGN) {
            self.bytes.push(0);
        }
        self.arrays.push(Array {
            name,
            dtype,
            count,
            offset: self.bytes.len(),
            bytes: data.len(),
        });
        self.bytes.extend_from_slice(&data);
    }
}

fn le_u32(v: impl IntoIterator<Item = u32>) -> Vec<u8> {
    v.into_iter().flat_map(u32::to_le_bytes).collect()
}

fn le_f32(v: impl IntoIterator<Item = f32>) -> Vec<u8> {
    v.into_iter().flat_map(f32::to_le_bytes).collect()
}

/// [`Frame`] as the 64 bytes of its `#[repr(C)]` layout (`frame.rs` tests the offsets),
/// written field by field.
fn frame_bytes(f: &Frame) -> Vec<u8> {
    let m = &f.margins;
    let mut b = le_u32([f.width_px, f.height_px]);
    b.extend(le_f32([f.offset_m[0], f.offset_m[1], f.spacing_m]));
    b.extend(le_u32([
        f.sc as u32,
        f.maxiter,
        f.degree,
        f.julia,
        f.entry,
        f.interior,
        f.floor as u32,
    ]));
    b.extend(margins_bytes(m));
    b
}

/// [`FrameLo`] as the 32 bytes of its layout.
fn frame_lo_bytes(lo: &FrameLo) -> Vec<u8> {
    let mut b = le_f32([lo.offset_lo[0], lo.offset_lo[1], lo.spacing_lo]);
    b.extend(le_u32([lo.pad]));
    b.extend(margins_bytes(&lo.margins));
    b
}

fn margins_bytes(m: &Margins) -> Vec<u8> {
    le_u32([m.spacing, m.point, m.step, m.add].map(|x| x as u32))
}

/// Little-endian words out of `bytes`.
fn words(bytes: &[u8]) -> Vec<u32> {
    let (whole, _) = bytes.as_chunks::<4>();
    whole.iter().map(|c| u32::from_le_bytes(*c)).collect()
}

fn margins_from(w: &[u32]) -> Margins {
    Margins {
        spacing: w[0] as i32,
        point: w[1] as i32,
        step: w[2] as i32,
        add: w[3] as i32,
    }
}

/// [`frame_bytes`] read back.
fn frame_from(bytes: &[u8]) -> Frame {
    let w = words(bytes);
    let f = f32::from_bits;
    Frame {
        width_px: w[0],
        height_px: w[1],
        offset_m: [f(w[2]), f(w[3])],
        spacing_m: f(w[4]),
        sc: w[5] as i32,
        maxiter: w[6],
        degree: w[7],
        julia: w[8],
        entry: w[9],
        interior: w[10],
        floor: w[11] as i32,
        margins: margins_from(&w[12..16]),
    }
}

/// [`frame_lo_bytes`] read back.
fn frame_lo_from(bytes: &[u8]) -> FrameLo {
    let w = words(bytes);
    FrameLo {
        offset_lo: [f32::from_bits(w[0]), f32::from_bits(w[1])],
        spacing_lo: f32::from_bits(w[2]),
        pad: w[3],
        margins: margins_from(&w[4..8]),
    }
}

/// One frame's bundle, built and not yet written.
struct Bundle {
    row: FrameSpec,
    spec: perturb::Spec,
    frame: Frame,
    lo: FrameLo,
    orbit_len: usize,
    periodic: bool,
    /// Each encoding's own measured flush ([`GpuOrbit::flush`]): narrowing differs, so
    /// `HiLo` can flush a component (a `lo` residue, or a point `F32Pair` keeps) the pair
    /// does not, and the two values need not agree. A kernel reads its own orbit's.
    flush: i32,
    flush_hilo: i32,
    bin: Vec<u8>,
    arrays: Vec<Array>,
    /// What the manifest says about the run, as JSON members (no braces).
    summary: String,
}

/// The frame as `compare` runs it, both kernels and `perturb` over every pixel, and the
/// `.bin` that holds the inputs and the results.
fn build(row: &FrameSpec, opts: &Options) -> Result<Bundle, String> {
    let spec = compare::spec_for(row, opts)?;
    let reference = spec.reference_orbit()?;
    let pair = GpuOrbit::from_reference(&reference, Encoding::F32Pair);
    let hilo = GpuOrbit::from_reference(&reference, Encoding::HiLo);
    // `compare` builds each kernel's frame from its own orbit's length and its policy;
    // the two orbits are one length, and with the switch off the policy is never read.
    let frame = Frame::from_spec(&spec, pair.len())?.with_policy(opts.interior_policy);
    let lo = FrameLo::from_spec(&spec, &frame)?;

    let t = Instant::now();
    let f64_field = run_f64(&spec, &reference, opts.threads);
    let f64_s = t.elapsed().as_secs_f64();
    let t = Instant::now();
    let f32_states: Vec<PixelState> = par_rows(frame.height_px, opts.threads, |row| {
        (0..frame.width_px)
            .map(|col| model::run_pixel(&frame, &pair, col, row, u32::MAX))
            .collect()
    });
    let f32_s = t.elapsed().as_secs_f64();
    let t = Instant::now();
    let ds_states: Vec<DsPixelState> = par_rows(frame.height_px, opts.threads, |row| {
        (0..frame.width_px)
            .map(|col| model_ds::run_pixel_ds(&frame, &lo, &hilo, col, row, u32::MAX))
            .collect()
    });
    let ds_s = t.elapsed().as_secs_f64();

    let pixels = f32_states.len();
    let points = pair.len();
    let mut bin = Bin::default();
    bin.push("frame", "u8", 64, frame_bytes(&frame));
    bin.push("frame_lo", "u8", 32, frame_lo_bytes(&lo));
    bin.push(
        "orbit_f32pair",
        "f32",
        points * 2,
        le_f32(pair.points.iter().flat_map(|p| [p[0], p[1]])),
    );
    bin.push(
        "orbit_hilo",
        "f32",
        points * 4,
        le_f32(hilo.points.iter().flat_map(|p| *p)),
    );
    bin.push(
        "f32_n",
        "u32",
        pixels,
        le_u32(f32_states.iter().map(|s| s.n)),
    );
    bin.push(
        "f32_frac",
        "f32",
        pixels,
        le_f32(f32_states.iter().map(|s| s.frac)),
    );
    bin.push(
        "f32_status",
        "u32",
        pixels,
        le_u32(f32_states.iter().map(|s| s.status)),
    );
    bin.push(
        "f32_steps",
        "u32",
        pixels,
        le_u32(f32_states.iter().map(|s| s.steps)),
    );
    bin.push("ds_n", "u32", pixels, le_u32(ds_states.iter().map(|s| s.n)));
    bin.push(
        "ds_frac",
        "f32",
        pixels,
        le_f32(ds_states.iter().map(|s| s.frac)),
    );
    bin.push(
        "ds_status",
        "u32",
        pixels,
        le_u32(ds_states.iter().map(|s| s.status)),
    );
    bin.push(
        "ds_steps",
        "u32",
        pixels,
        le_u32(ds_states.iter().map(|s| s.steps)),
    );
    // The whole state as the GPU stores it, proof aside: what a port is held to word for
    // word, so that a delta that drifts without moving `n` is seen.
    bin.push(
        "f32_state",
        "u32",
        pixels * 12,
        le_u32(f32_states.iter().flat_map(PixelState::bits)),
    );
    bin.push(
        "ds_state",
        "u32",
        pixels * 14,
        le_u32(ds_states.iter().flat_map(DsPixelState::bits)),
    );
    bin.push(
        "f64_smooth",
        "f64",
        pixels,
        f64_field
            .smooth
            .iter()
            .flat_map(|x| x.to_le_bytes())
            .collect(),
    );
    bin.push(
        "f64_iterations",
        "u32",
        pixels,
        le_u32(f64_field.iterations.iter().copied()),
    );

    // How each kernel came out and how far it is from `f64`: what the page's own numbers
    // should be near, before it has measured anything.
    let classes = |status: &mut dyn Iterator<Item = u32>| {
        let mut c = [0usize; 5];
        for s in status {
            c[s.min(4) as usize] += 1;
        }
        format!(
            "{{\"running\":{},\"escaped\":{},\"capped\":{},\"interior\":{},\"gated\":{}}}",
            c[RUNNING as usize],
            c[ESCAPED as usize],
            c[CAPPED as usize],
            c[INTERIOR as usize],
            c[GATED as usize]
        )
    };
    let closeness = |smooth: &[f64]| {
        let a = agree(&f64_field.smooth, smooth);
        format!(
            "{{\"both_escaped\":{},\"class_changes\":{},\"p50\":{},\"p99\":{},\"max\":{},\"over_0.1\":{:.5},\"over_1\":{:.5}}}",
            a.both_escaped,
            a.f64_only_escaped + a.model_only_escaped,
            num(a.p50),
            num(a.p99),
            num(a.max),
            a.over[1],
            a.over[2]
        )
    };
    let mean = |v: &mut dyn Iterator<Item = u32>| {
        let (sum, n) = v.fold((0f64, 0usize), |(s, n), x| (s + x as f64, n + 1));
        sum / n.max(1) as f64
    };
    let f32_smooth: Vec<f64> = f32_states.iter().map(model::smooth_f64).collect();
    let ds_smooth: Vec<f64> = ds_states.iter().map(model_ds::smooth_f64_ds).collect();
    let summary = format!(
        "\"f64\":{{\"escaped\":{},\"mean_iterations\":{:.1},\"wall_s\":{:.3}}},\"f32\":{{\"classes\":{},\"mean_steps\":{:.1},\"vs_f64\":{},\"wall_s\":{:.3}}},\"ds\":{{\"classes\":{},\"mean_steps\":{:.1},\"vs_f64\":{},\"wall_s\":{:.3}}}",
        f64_field.smooth.iter().filter(|x| !x.is_nan()).count(),
        mean(&mut f64_field.iterations.iter().copied()),
        f64_s,
        classes(&mut f32_states.iter().map(|s| s.status)),
        mean(&mut f32_states.iter().map(|s| s.steps)),
        closeness(&f32_smooth),
        f32_s,
        classes(&mut ds_states.iter().map(|s| s.status)),
        mean(&mut ds_states.iter().map(|s| s.steps)),
        closeness(&ds_smooth),
        ds_s
    );

    Ok(Bundle {
        row: row.clone(),
        spec,
        frame,
        lo,
        orbit_len: points,
        periodic: pair.periodic,
        flush: pair.flush,
        flush_hilo: hilo.flush,
        bin: bin.bytes,
        arrays: bin.arrays,
        summary,
    })
}

fn num(x: f64) -> String {
    if x.is_finite() {
        format!("{x}")
    } else {
        "null".into()
    }
}

/// A JSON string literal.
fn quote(s: &str) -> String {
    format!("\"{}\"", s.replace('\\', "\\\\").replace('"', "\\\""))
}

/// The manifest: flat scalars first (what `index.json` copies), then the decoded uniforms,
/// the orbit's flags, the arrays, and the run's summary.
fn manifest(b: &Bundle, base: &str) -> String {
    let f = &b.frame;
    let lo = &b.lo;
    let margins = |m: &Margins| {
        format!(
            "{{\"spacing\":{},\"point\":{},\"step\":{},\"add\":{}}}",
            m.spacing, m.point, m.step, m.add
        )
    };
    let arrays: Vec<String> = b
        .arrays
        .iter()
        .map(|a| {
            format!(
                "  {{\"name\":\"{}\",\"dtype\":\"{}\",\"count\":{},\"offset\":{},\"bytes\":{}}}",
                a.name, a.dtype, a.count, a.offset, a.bytes
            )
        })
        .collect();
    let opt = |v: Option<&str>| v.map_or("null".to_string(), quote);
    let julia = b.spec.julia.as_ref();
    format!(
        "{{\"format\":\"{FORMAT}\",\"id\":{},\"manifest\":\"{base}.manifest.json\",\"bin\":\"{base}.bin\",\"bin_bytes\":{},\
\"width\":{:e},\"degree\":{},\"julia\":{},\"width_px\":{},\"height_px\":{},\"cap\":{},\"interior\":{},\
\"orbit_len\":{},\"periodic\":{},\"flush\":{},\"flush_hilo\":{},\n\
\"spec\":{{\"re\":{},\"im\":{},\"w\":{:e},\"julia_re\":{},\"julia_im\":{},\"anchor\":\"{}\",\"link\":{}}},\n\
\"frame\":{{\"width_px\":{},\"height_px\":{},\"offset_m\":[{:e},{:e}],\"spacing_m\":{:e},\"sc\":{},\"maxiter\":{},\"degree\":{},\"julia\":{},\"entry\":{},\"interior\":{},\"floor\":{},\"margins\":{}}},\n\
\"frame_lo\":{{\"offset_lo\":[{:e},{:e}],\"spacing_lo\":{:e},\"pad\":{},\"margins\":{}}},\n\
\"pixel_order\":\"row-major, index = row * width_px + col, row 0 at the top (dc's imaginary part largest)\",\n\
\"status_codes\":{{\"running\":{RUNNING},\"escaped\":{ESCAPED},\"capped\":{CAPPED},\"interior\":{INTERIOR},\"gated\":{GATED}}},\n\
\"expected\":\"f32_*: model::run_pixel on orbit_f32pair with frame; ds_*: model_ds::run_pixel_ds on orbit_hilo with frame and frame_lo; both unbounded budget, no skip table. f32_state and ds_state: PixelState::bits and DsPixelState::bits per pixel, 12 and 14 u32, the GPU structs' order. smooth = n + frac where status is escaped. f64_smooth: perturb's f64 kernel, NaN where it did not escape\",\n\
\"arrays\":[\n{}\n],\n\
{}}}\n",
        quote(&b.row.id),
        b.bin.len(),
        b.spec.width,
        f.degree,
        f.julia != 0,
        f.width_px,
        f.height_px,
        f.maxiter,
        f.interior != 0,
        b.orbit_len,
        b.periodic,
        b.flush,
        b.flush_hilo,
        quote(&b.spec.center_re),
        quote(&b.spec.center_im),
        b.spec.width,
        opt(julia.map(|j| j.0.as_str())),
        opt(julia.map(|j| j.1.as_str())),
        match b.spec.anchor {
            perturb::Anchor::Origin => "origin",
            perturb::Anchor::Parameter => "parameter",
        },
        opt(b.row.link.as_deref()),
        f.width_px,
        f.height_px,
        f.offset_m[0],
        f.offset_m[1],
        f.spacing_m,
        f.sc,
        f.maxiter,
        f.degree,
        f.julia,
        f.entry,
        f.interior,
        f.floor,
        margins(&f.margins),
        lo.offset_lo[0],
        lo.offset_lo[1],
        lo.spacing_lo,
        lo.pad,
        margins(&lo.margins),
        arrays.join(",\n"),
        b.summary
    )
}

/// Re-runs `samples` pixels, spread evenly over the frame, from nothing but a written
/// bundle (the `.bin`'s bytes, and the manifest's text for the offsets and the orbit's two
/// flags), and refuses it on any bit of `n`, `frac`, `status`, `steps` or the whole state
/// that differs from what it holds. Returns how many were checked.
fn check(bytes: &[u8], manifest: &str, samples: u32, threads: usize) -> Result<usize, String> {
    let arrays = arrays_of(manifest)?;
    let top = json::parse_object(&manifest.replace('\n', " "))?;
    let periodic = json::get(&top, "periodic") == Some(&json::Value::Bool(true));
    let flush = match json::get(&top, "flush") {
        Some(json::Value::Num(n)) => n.parse::<i32>().map_err(|e| e.to_string())?,
        _ => return Err("manifest has no flush".into()),
    };
    // `flush` is the `F32Pair` orbit's and `flush_hilo` the `HiLo` orbit's. A bundle written
    // before the two were split carries only `flush`, which then stands for both, as it did
    // when that bundle was checked.
    let flush_hilo = match json::get(&top, "flush_hilo") {
        Some(json::Value::Num(n)) => n.parse::<i32>().map_err(|e| e.to_string())?,
        None => flush,
        _ => return Err("manifest's flush_hilo is not a number".into()),
    };
    let at = |name: &str| -> Result<&[u8], String> {
        let &(offset, len) = arrays
            .get(name)
            .ok_or_else(|| format!("bundle has no {name}"))?;
        bytes
            .get(offset..offset + len)
            .ok_or_else(|| format!("{name} runs past the end of the bin"))
    };
    let frame = frame_from(at("frame")?);
    let lo = frame_lo_from(at("frame_lo")?);
    let orbit = |encoding: Encoding, points: Vec<[f32; 4]>| GpuOrbit {
        encoding,
        points,
        periodic,
        flush: match encoding {
            Encoding::F32Pair => flush,
            Encoding::HiLo => flush_hilo,
        },
    };
    let f = f32::from_bits;
    let pair = orbit(
        Encoding::F32Pair,
        words(at("orbit_f32pair")?)
            .as_chunks::<2>()
            .0
            .iter()
            .map(|p| [f(p[0]), f(p[1]), 0.0, 0.0])
            .collect(),
    );
    let hilo = orbit(
        Encoding::HiLo,
        words(at("orbit_hilo")?)
            .as_chunks::<4>()
            .0
            .iter()
            .map(|p| p.map(f))
            .collect(),
    );

    let expected = |name: &str| at(name).map(words);
    let (f32_n, f32_frac, f32_status, f32_steps) = (
        expected("f32_n")?,
        expected("f32_frac")?,
        expected("f32_status")?,
        expected("f32_steps")?,
    );
    let (ds_n, ds_frac, ds_status, ds_steps) = (
        expected("ds_n")?,
        expected("ds_frac")?,
        expected("ds_status")?,
        expected("ds_steps")?,
    );
    let (f32_state, ds_state) = (expected("f32_state")?, expected("ds_state")?);
    let pixels = (frame.width_px * frame.height_px) as usize;
    let take = (samples as usize).min(pixels);
    if take == 0 {
        return Ok(0);
    }
    let picks: Vec<usize> = (0..take).map(|k| k * pixels / take).collect();
    // One "row" per pick, so `par_rows` spreads them.
    let fails: Vec<String> = par_rows(take as u32, threads, |k| {
        let i = picks[k as usize];
        let (col, row) = ((i as u32) % frame.width_px, (i as u32) / frame.width_px);
        let a = model::run_pixel(&frame, &pair, col, row, u32::MAX);
        let b = model_ds::run_pixel_ds(&frame, &lo, &hilo, col, row, u32::MAX);
        let mut bad = Vec::new();
        if [a.n, a.frac.to_bits(), a.status, a.steps]
            != [f32_n[i], f32_frac[i], f32_status[i], f32_steps[i]]
            || a.bits()[..] != f32_state[12 * i..12 * (i + 1)]
        {
            bad.push(format!("f32 pixel ({col}, {row}) differs"));
        }
        if [b.n, b.frac.to_bits(), b.status, b.steps]
            != [ds_n[i], ds_frac[i], ds_status[i], ds_steps[i]]
            || b.bits()[..] != ds_state[14 * i..14 * (i + 1)]
        {
            bad.push(format!("ds pixel ({col}, {row}) differs"));
        }
        bad
    });
    if !fails.is_empty() {
        return Err(format!(
            "the written bundle does not reproduce: {} ({} in all)",
            fails[0],
            fails.len()
        ));
    }
    Ok(take)
}

/// The manifest's `arrays`, by name: `(offset, bytes)`. One array a line, as [`manifest`]
/// writes them, each line a flat object the crate's reader takes.
fn arrays_of(manifest: &str) -> Result<HashMap<String, (usize, usize)>, String> {
    let mut out = HashMap::new();
    for line in manifest.lines().filter(|l| l.contains("\"dtype\"")) {
        let m = json::parse_object(line.trim().trim_end_matches(','))?;
        let field = |k: &str| {
            json::get(&m, k)
                .and_then(|v| v.as_f64())
                .map(|x| x as usize)
                .ok_or_else(|| format!("array line without {k}: {line}"))
        };
        let name = json::get(&m, "name")
            .and_then(|v| v.as_str())
            .ok_or("array line without a name")?;
        out.insert(name.to_string(), (field("offset")?, field("bytes")?));
    }
    Ok(out)
}

/// Rewrites `index.json` over every manifest in `dir`, sorted by file name.
fn write_index(dir: &Path) -> Result<(), String> {
    let mut names: Vec<String> = fs::read_dir(dir)
        .map_err(|e| e.to_string())?
        .filter_map(|e| e.ok())
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .filter(|n| n.ends_with(".manifest.json"))
        .collect();
    names.sort();
    let mut entries = Vec::new();
    for name in &names {
        let text = fs::read_to_string(dir.join(name)).map_err(|e| e.to_string())?;
        // The reader skips the nested members and keeps the flat ones the index copies.
        let m = json::parse_object(&text.replace('\n', " "))?;
        let raw = |k: &str| match json::get(&m, k) {
            Some(json::Value::Str(s)) => quote(s),
            Some(json::Value::Num(n)) => n.clone(),
            Some(json::Value::Bool(b)) => b.to_string(),
            _ => "null".into(),
        };
        let keys = [
            "id",
            "manifest",
            "bin",
            "bin_bytes",
            "width",
            "degree",
            "julia",
            "width_px",
            "height_px",
            "cap",
            "interior",
            "orbit_len",
            "periodic",
        ];
        let members: Vec<String> = keys.iter().map(|k| format!("\"{k}\":{}", raw(k))).collect();
        entries.push(format!("  {{{}}}", members.join(",")));
    }
    let text = format!(
        "{{\"format\":\"{FORMAT}\",\"frames\":[\n{}\n]}}\n",
        entries.join(",\n")
    );
    fs::write(dir.join("index.json"), text).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The bytes as the struct itself lays them out in memory (neither has padding:
    /// `frame.rs` tests every offset).
    fn raw<T>(x: &T) -> Vec<u8> {
        let p = x as *const T as *const u8;
        // SAFETY: `T` is a `#[repr(C)]` struct of 4-byte scalars with no padding, so every
        // byte of it is initialized.
        unsafe { std::slice::from_raw_parts(p, size_of::<T>()) }.to_vec()
    }

    fn small(row: &str, res: [u32; 2], cap: u32) -> Bundle {
        let opts = Options {
            resolution: res,
            cap: Some(cap),
            interior: false,
            ..Options::default()
        };
        build(&FrameSpec::from_row(row).unwrap(), &opts).unwrap()
    }

    /// The uniforms are written field by field and land exactly where `#[repr(C)]` puts
    /// them, and read back to the same bits.
    #[test]
    fn uniforms_are_the_repr_c_bytes() {
        let b = small(
            r#"{"id":"u","re":"-0.745","im":"0.15","w":1e-30,"n":2000}"#,
            [16, 9],
            2000,
        );
        assert_eq!(frame_bytes(&b.frame), raw(&b.frame));
        assert_eq!(frame_lo_bytes(&b.lo), raw(&b.lo));
        assert_eq!(frame_bytes(&frame_from(&raw(&b.frame))), raw(&b.frame));
        assert_eq!(frame_lo_bytes(&frame_lo_from(&raw(&b.lo))), raw(&b.lo));
    }

    /// Every pixel of a bundle, Mandelbrot and Julia, re-runs from its own bytes and
    /// manifest to exactly the `run_pixel` and `run_pixel_ds` states it holds.
    #[test]
    fn a_bundle_reproduces_every_pixel() {
        for row in [
            r#"{"id":"m","re":"-0.745","im":"0.15","w":1e-6,"n":3000}"#,
            r#"{"id":"j","re":"0.1","im":"0.6","w":1e-3,"n":3000,"degree":3,"julia_re":"-0.12","julia_im":"0.75"}"#,
        ] {
            let b = small(row, [24, 14], 3000);
            let text = manifest(&b, "t");
            assert_eq!(check(&b.bin, &text, 24 * 14, 4).unwrap(), 24 * 14);
            // A flipped bit in an expected array is caught.
            let mut bad = b.bin.clone();
            let (offset, _) = arrays_of(&text).unwrap()["ds_steps"];
            bad[offset] ^= 1;
            assert!(check(&bad, &text, 24 * 14, 4).is_err());
            // And so is one in a low part, which no other array carries.
            let mut bad = b.bin.clone();
            let (offset, _) = arrays_of(&text).unwrap()["ds_state"];
            bad[offset + 4 * 2] ^= 1;
            assert!(check(&bad, &text, 24 * 14, 4).is_err());
        }
    }

    /// The vectors file is the page's format and round-trips through the crate's reader.
    #[test]
    fn vectors_cover_every_op_the_page_runs() {
        let ops: Vec<&str> = ds::self_test_vectors().iter().map(|c| c.0).collect();
        for op in [
            "two_sum",
            "quick_two_sum",
            "split",
            "two_prod",
            "ds_add",
            "ds_mul",
        ] {
            assert!(ops.contains(&op), "{op}");
        }
        assert!(ops.iter().all(|op| {
            [
                "two_sum",
                "quick_two_sum",
                "split",
                "two_prod",
                "ds_add",
                "ds_mul",
            ]
            .contains(op)
        }));
    }
}
