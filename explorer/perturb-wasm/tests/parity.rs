//! **The kernel's bytes, pinned across every frame kind it draws.**
//!
//! A speed change to [`perturb::kernel`] must leave every bit it hands out where it
//! was: the lanes [`compute_rows`] and [`compute_listed`] write, the two counters
//! [`band_ran`] and [`band_saved`] read back, and each sample's whole [`Outcome`] —
//! count, rebases, the interior flag, the degenerate flag and the `|dz|²` pair. This
//! holds all of them to `tests/parity-pins.txt`, one line a spec, over the specs in
//! `tests/parity-specs.jsonl`: the deep frames at degrees two to six, their controls,
//! the Julia anchors, a periodic reference, and the parabolic frames of
//! `tests/interior.rs`, each with the switch off and on, at a small odd tile so the
//! centre cell lands exactly on the reference.
//!
//! The pins were taken from the kernel before any of the run-length and fast-path
//! work, and are native bytes: wasm takes `ln` from another library, so the module is
//! held to its predecessor separately (`explorer/bench/perturb-parity.mjs`).
//!
//! ```text
//! cargo test --release --test parity                      # check
//! PARITY_RECORD=1 cargo test --release --test parity      # re-record (rarely right)
//! ```

use perturb::kernel::{Kernel, Outcome};
use perturb::{Spec, band_ran, band_saved, compute_listed, compute_rows};
use std::fmt::Write as _;
use std::path::PathBuf;
use std::sync::Mutex;
use std::sync::atomic::{AtomicUsize, Ordering};

/// `compute_rows` and the two counters behind it share a static, so a call and the
/// read after it are one critical section.
static BAND: Mutex<()> = Mutex::new(());

fn fnv(hash: &mut u64, bytes: &[u8]) {
    for &byte in bytes {
        *hash ^= byte as u64;
        *hash = hash.wrapping_mul(0x0100_0000_01b3);
    }
}

const FNV: u64 = 0xcbf2_9ce4_8422_2325;

fn outcome_bytes(hash: &mut u64, o: &Outcome) {
    fnv(hash, &o.smooth.to_bits().to_le_bytes());
    fnv(hash, &o.iterations.to_le_bytes());
    fnv(hash, &o.rebases.to_le_bytes());
    fnv(hash, &[o.detected_interior as u8, o.degenerate as u8]);
    fnv(hash, &o.dz_mantissa.to_bits().to_le_bytes());
    fnv(hash, &o.dz_exponent.to_le_bytes());
}

fn crate_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
}

/// One spec's line of the pin file.
fn pin(label: &str, spec: &Spec) -> String {
    let orbit = spec.reference_orbit().unwrap();
    let (w, h) = (spec.sample_width(), spec.sample_height());
    let count = (w * h) as usize;

    // The band, whole, and the two halves of it, which must be the same bytes.
    let (rows, ran, saved, split) = {
        let _band = BAND.lock().unwrap_or_else(|e| e.into_inner());
        let rows = compute_rows(spec, &orbit, 0, h);
        let (ran, saved) = (band_ran(), band_saved());
        let mid = h / 2;
        let mut split = if mid > 0 {
            compute_rows(spec, &orbit, 0, mid)
        } else {
            Vec::new()
        };
        split.extend(compute_rows(spec, &orbit, mid, h));
        (rows, ran, saved, split)
    };
    assert_eq!(rows.len(), count * 8, "{label}: lanes");
    assert!(rows == split, "{label}: a band cut in two drew other bytes");

    // A scattered list in an order no band walks: every sample, reversed and strided.
    let stride = if count % 7 == 0 { 5 } else { 7 };
    let indices: Vec<u32> = (0..count)
        .map(|i| ((i * stride) % count) as u32)
        .rev()
        .collect();
    let (listed, listed_ran, listed_saved) = {
        let _band = BAND.lock().unwrap_or_else(|e| e.into_inner());
        let listed = compute_listed(spec, &orbit, &indices).unwrap();
        (listed, band_ran(), band_saved())
    };
    for (k, &index) in indices.iter().enumerate() {
        let at = index as usize * 8;
        assert_eq!(
            listed[k * 8..k * 8 + 8],
            rows[at..at + 8],
            "{label}: sample {index} listed against banded"
        );
    }
    assert_eq!(
        (listed_ran, listed_saved),
        (ran, saved),
        "{label}: list counters"
    );

    // Every sample's whole outcome, which the lanes alone do not show.
    let kernel = Kernel::new(&orbit, spec.maxiter(), spec.interior).at_entry(spec.entry());
    let offset = spec.centre_offset().unwrap_or((0.0, 0.0));
    let mut outcomes = FNV;
    for row in 0..h {
        for col in 0..w {
            let (re, im) = spec.dc(offset, col, row);
            let o = kernel.sample_at(spec.degree, spec.julia.is_some(), re, im);
            outcome_bytes(&mut outcomes, &o);
        }
    }

    let mut lanes = FNV;
    fnv(&mut lanes, &rows);
    format!("{label}\tlanes={lanes:016x} ran={ran} saved={saved} outcomes={outcomes:016x}")
}

/// The native price of the loop, single thread, ns per sample-iteration: the same six
/// cases `explorer/bench/perturb-speed.mjs` prices in wasm, best of `SPEED_ROUNDS`.
///
/// ```text
/// cargo test --release --test parity -- --ignored --nocapture native_speed
/// ```
#[test]
#[ignore]
fn native_speed() {
    const T54: (&str, &str) = (
        "-0.745017728290198619298779298918851031533262270733325571484375",
        "0.149934432756897045833502829651788491167588360989048041953125",
    );
    const T54_D5: (&str, &str) = (
        "-0.887826199618715930869553864091772850002956453437043331796875",
        "0.544060594138298891586824680413895627027934585266413727421875",
    );
    const ANCHOR: (&str, &str) = (
        "-0.74501772828532335842941892835857434",
        "0.14993443275456819177805709088257971",
    );
    let long = |(re, im): (&str, &str), d: u32, on: bool, res: [u32; 2]| {
        format!(
            r#"{{"schema":1,"center_re":"{re}","center_im":"{im}","width":1e-54,"maxiter":221162,"degree":{d},"interior":{on},"resolution":[{},{}]}}"#,
            res[0], res[1]
        )
    };
    let short = |on: bool| {
        format!(
            r#"{{"schema":1,"center_re":"{0}","center_im":"{1}","width":2e-11,"maxiter":60000,"interior":{on},"resolution":[24,14],"reference_re":"{0}","reference_im":"{1}","period":2838}}"#,
            ANCHOR.0, ANCHOR.1
        )
    };
    let cases = [
        ("d2 long off", long(T54, 2, false, [24, 14])),
        ("d2 long on", long(T54, 2, true, [24, 14])),
        ("d5 long off", long(T54_D5, 5, false, [12, 7])),
        ("d5 long on", long(T54_D5, 5, true, [12, 7])),
        ("d2 short off", short(false)),
        ("d2 short on", short(true)),
    ];
    let rounds: usize = std::env::var("SPEED_ROUNDS")
        .ok()
        .and_then(|t| t.parse().ok())
        .unwrap_or(5);
    for (name, json) in cases {
        let spec = Spec::parse(&json).unwrap();
        let orbit = spec.reference_orbit().unwrap();
        let h = spec.sample_height();
        let _ = compute_rows(&spec, &orbit, 0, h);
        let mut best = f64::INFINITY;
        let mut ran = 0.0;
        for _ in 0..rounds {
            let t0 = std::time::Instant::now();
            let _ = std::hint::black_box(compute_rows(&spec, &orbit, 0, h));
            let ns = t0.elapsed().as_nanos() as f64;
            ran = band_ran();
            best = best.min(ns / ran);
        }
        println!("{name:<14} ran {ran:>11} ns/it {best:.3}");
    }
}

#[test]
fn every_frame_draws_the_bits_it_drew_before() {
    let dir = crate_dir();
    let specs = std::fs::read_to_string(dir.join("tests/parity-specs.jsonl")).unwrap();
    let specs: Vec<(String, Spec)> = specs
        .lines()
        .filter(|line| !line.trim().is_empty())
        .map(|line| {
            let (label, json) = line.split_once('\t').expect("label<TAB>spec");
            let spec = Spec::parse(json).unwrap_or_else(|e| panic!("{label}: {e}"));
            (label.to_string(), spec)
        })
        .collect();

    let next = AtomicUsize::new(0);
    let lines: Vec<Mutex<Option<String>>> = specs.iter().map(|_| Mutex::new(None)).collect();
    let threads = std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(4);
    std::thread::scope(|scope| {
        for _ in 0..threads {
            scope.spawn(|| {
                loop {
                    let i = next.fetch_add(1, Ordering::Relaxed);
                    let Some((label, spec)) = specs.get(i) else {
                        break;
                    };
                    *lines[i].lock().unwrap() = Some(pin(label, spec));
                }
            });
        }
    });
    let mut got = String::new();
    for line in &lines {
        writeln!(got, "{}", line.lock().unwrap().as_ref().unwrap()).unwrap();
    }

    let path = dir.join("tests/parity-pins.txt");
    if std::env::var_os("PARITY_RECORD").is_some() {
        std::fs::write(&path, got.as_bytes()).unwrap();
        println!("recorded {} pins to {}", specs.len(), path.display());
        return;
    }
    let want = std::fs::read_to_string(&path)
        .unwrap()
        .replace("\r\n", "\n");
    let mut moved = Vec::new();
    for (a, b) in want.lines().zip(got.lines()) {
        if a != b {
            moved.push(format!("  want {a}\n  got  {b}"));
        }
    }
    assert_eq!(want.lines().count(), got.lines().count(), "pin count");
    assert!(
        moved.is_empty(),
        "{} of {} specs moved:\n{}",
        moved.len(),
        specs.len(),
        moved.join("\n")
    );
    println!("{} specs, every one identical", specs.len());
}
