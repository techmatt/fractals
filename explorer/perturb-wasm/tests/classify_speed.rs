//! What [`nuclei::classify`] costs, on the nuclei a dive reads *(classify_speed_ckpt155)*.
//!
//! Two harnesses, both `#[ignore]`d. `collect` runs the dive's own search — twelve
//! solves, every distinct nucleus kept — over a frozen frame set and writes the nuclei it
//! would classify; `bench` reads them back and times the reading, so every arm reads
//! identical inputs.
//!
//! ```text
//! cargo test --release --test classify_speed -- --ignored --nocapture collect
//! cargo test --release --test classify_speed -- --ignored --nocapture bench
//! ```
//!
//! The frame set is `artifacts/classify-speed/frames.tsv` (label, degree, re, im, width,
//! cap), drawn from the dive reference, plus the deep frames of `tests/common` named in
//! [`COMMON`]. `CLASSIFY_DIR` moves the directory.

mod common;

use common::*;
use perturb::fx::Fx;
use perturb::nuclei;
use perturb::{Anchor, Spec};
use std::fmt::Write as _;
use std::path::PathBuf;
use std::time::Instant;

/// The deep frames the §12 cost table was measured on, at their degrees.
const COMMON: &[(&str, u32)] = &[
    ("tangle 1e-22", 2),
    ("tangle 1e-54", 2),
    ("tangle 1e-22", 6),
];

/// The Deep tab's tile width, which is what the page sizes a nucleus's limbs by.
const TILE_SAMPLES: u32 = 316;

fn dir() -> PathBuf {
    std::env::var_os("CLASSIFY_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../artifacts/classify-speed")
        })
}

struct View {
    label: String,
    degree: u32,
    re: String,
    im: String,
    width: f64,
    cap: u32,
}

fn views() -> Vec<View> {
    let mut out = Vec::new();
    for &(label, degree) in COMMON {
        let frame = DEEP_FRAMES
            .iter()
            .chain(DEGREE_FRAMES)
            .find(|f| f.label == label && f.degree == degree)
            .unwrap();
        out.push(View {
            label: format!("{label} d{degree}"),
            degree,
            re: frame.re.into(),
            im: frame.im.into(),
            width: frame.width,
            cap: frame.maxiter,
        });
    }
    let text = std::fs::read_to_string(dir().join("frames.tsv")).expect("frames.tsv");
    for line in text.lines().filter(|l| !l.is_empty()) {
        let f: Vec<&str> = line.split('\t').collect();
        out.push(View {
            label: f[0].into(),
            degree: f[1].parse().unwrap(),
            re: f[2].into(),
            im: f[3].into(),
            width: f[4].parse().unwrap(),
            cap: f[5].parse().unwrap(),
        });
    }
    out
}

#[test]
#[ignore]
fn collect() {
    let mut out = String::new();
    for view in views() {
        let spec = Spec {
            center_re: view.re.clone(),
            center_im: view.im.clone(),
            width: view.width,
            resolution: [TILE_SAMPLES, 178],
            supersample: 1,
            maxiter: Some(view.cap),
            reference: None,
            period: None,
            julia: None,
            anchor: Anchor::Parameter,
            interior: true,
            degree: view.degree,
        };
        let limbs = nuclei::limbs_for_nucleus(view.width, TILE_SAMPLES, view.degree);
        let started = Instant::now();
        let found = nuclei::search(&spec, nuclei::GRID_COLS, nuclei::GRID_ROWS, 12, 64).unwrap();
        println!(
            "{}: {} nuclei, periods {:?}, {:.1} s",
            view.label,
            found.len(),
            found.iter().map(|n| n.period).collect::<Vec<_>>(),
            started.elapsed().as_secs_f64()
        );
        for n in &found {
            let places = (limbs * 19).min(((-n.size_log2) * 0.30103) as usize + 20);
            writeln!(
                out,
                "{}\t{}\t{}\t{}\t{}\t{}\t{}",
                view.label,
                view.degree,
                n.period,
                limbs,
                n.size_log2,
                n.c_re.to_decimal(places),
                n.c_im.to_decimal(places)
            )
            .unwrap();
        }
    }
    std::fs::write(dir().join("nuclei.tsv"), out).unwrap();
}

pub struct Entry {
    pub label: String,
    pub degree: u32,
    pub nucleus: nuclei::Nucleus,
}

pub fn entries() -> Vec<Entry> {
    let text = std::fs::read_to_string(dir().join("nuclei.tsv")).expect("nuclei.tsv");
    text.lines()
        .filter(|l| !l.is_empty())
        .map(|line| {
            let f: Vec<&str> = line.split('\t').collect();
            let limbs: usize = f[3].parse().unwrap();
            Entry {
                label: f[0].into(),
                degree: f[1].parse().unwrap(),
                nucleus: nuclei::Nucleus {
                    period: f[2].parse().unwrap(),
                    c_re: Fx::parse(f[5], limbs).unwrap(),
                    c_im: Fx::parse(f[6], limbs).unwrap(),
                    size_log2: f[4].parse().unwrap(),
                    window_log2: f64::NAN,
                    steps: 0,
                    residual: 0.0,
                },
            }
        })
        .collect()
}

fn verdict(kind: nuclei::Kind) -> String {
    match kind {
        nuclei::Kind::Copy => "copy".into(),
        nuclei::Kind::Bulb { parent, m } => format!("bulb {parent}x{m}"),
        nuclei::Kind::Unresolved(why) => format!("unresolved ({})", why.reason()),
    }
}

#[test]
#[ignore]
fn bench() {
    use nuclei::Solver;
    use std::sync::atomic::Ordering;
    let rounds: usize = std::env::var("CLASSIFY_ROUNDS")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(3);
    println!("| frame | d | period | limbs | fixed point | perturbed | same | fx s | pert s | x |");
    println!("|---|--:|--:|--:|---|---|---|--:|--:|--:|");
    let (mut total_fx, mut total_pert, mut differ) = (0.0, 0.0, 0);
    for entry in entries() {
        let mut times = [Vec::new(), Vec::new()];
        let mut kinds = [None, None];
        for round in 0..rounds {
            // A B, then B A: the order alternates so neither arm always runs on a warm cache
            // or into the other's load.
            let order = if round % 2 == 0 { [0, 1] } else { [1, 0] };
            for arm in order {
                let solver = [Solver::Fx, Solver::Perturbed][arm];
                let started = Instant::now();
                let read = nuclei::classify_by(&entry.nucleus, entry.degree, solver);
                times[arm].push(started.elapsed().as_secs_f64());
                kinds[arm] = Some(read.kind);
            }
        }
        let median = |t: &mut Vec<f64>| {
            t.sort_by(f64::total_cmp);
            t[t.len() / 2]
        };
        let (fx, pert) = (median(&mut times[0]), median(&mut times[1]));
        total_fx += fx;
        total_pert += pert;
        let same = kinds[0] == kinds[1];
        differ += usize::from(!same);
        println!(
            "| {} | {} | {} | {} | {} | {} | {} | {:.4} | {:.4} | {:.1} |",
            entry.label,
            entry.degree,
            entry.nucleus.period,
            entry.nucleus.c_re.n,
            verdict(kinds[0].unwrap()),
            verdict(kinds[1].unwrap()),
            if same { "yes" } else { "**NO**" },
            fx,
            pert,
            fx / pert
        );
    }
    println!(
        "
total: fixed point {total_fx:.2} s, perturbed {total_pert:.2} s, {:.1}x; {differ} verdicts differ;          {} roots glitched to fixed point, {} deep cusps finished there, {} literal tests re-read          (over {rounds} rounds)",
        total_fx / total_pert,
        nuclei::FALLBACKS.load(Ordering::Relaxed),
        nuclei::DEEP.load(Ordering::Relaxed),
        nuclei::REREADS.load(Ordering::Relaxed),
    );
}
