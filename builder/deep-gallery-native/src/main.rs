//! The Deep tab's gallery: the native perturbation path, driven from
//! `builder/deep_gallery.py` (deep_gallery_sheet_ckpt144, promoted by
//! deep_gallery_build_ckpt144). `builder/README.md`'s *The Deep tab's gallery* is the method.
//!
//!   search  --re R --im I --w W [--deg D] [--budget B] [--want N]
//!   field   --re R --im I --w W [--deg D] [--jre JR --jim JI [--anchor origin]] --res WxH [--ss S]
//!           (--cap N | --settle [--from N]) [--out PATH] [--threads T]
//!   settle  (same frame args) [--from N]
//!   orient  --re R --im I --period P [--deg D]      the copy's complex scale
//!   solve   --re R --im I --period P [--deg D] [--places K]
//!
//! Every answer is one JSON object on stdout.

use perturb::fx::{Fx, pow2};
use perturb::reference::{cpow_f64, cpow_fx};
use perturb::{Anchor, Spec, cap, compute_rows, nuclei, policy};
use std::collections::HashMap;
use std::sync::atomic::{AtomicU32, Ordering};
use std::time::Instant;

fn args() -> (String, HashMap<String, String>) {
    let raw: Vec<String> = std::env::args().skip(1).collect();
    let cmd = raw.first().cloned().unwrap_or_default();
    let mut map = HashMap::new();
    let mut i = 1;
    while i < raw.len() {
        let key = raw[i].trim_start_matches("--").to_string();
        if i + 1 < raw.len() && !raw[i + 1].starts_with("--") {
            map.insert(key, raw[i + 1].clone());
            i += 2;
        } else {
            map.insert(key, String::new());
            i += 1;
        }
    }
    (cmd, map)
}

fn spec_of(a: &HashMap<String, String>) -> Spec {
    let res: Vec<u32> = a
        .get("res")
        .map(|s| s.split('x').map(|v| v.parse().unwrap()).collect())
        .unwrap_or(vec![1280, 720]);
    let julia = match (a.get("jre"), a.get("jim")) {
        (Some(r), Some(i)) => Some((r.clone(), i.clone())),
        _ => None,
    };
    Spec {
        center_re: a["re"].clone(),
        center_im: a["im"].clone(),
        width: a["w"].parse().unwrap(),
        resolution: [res[0], res[1]],
        supersample: a.get("ss").map(|s| s.parse().unwrap()).unwrap_or(1),
        maxiter: a.get("cap").map(|s| s.parse().unwrap()),
        reference: None,
        period: None,
        julia,
        // A Julia frame's anchor is the caller's, chosen the way `deep-render.js`'s
        // `anchorOf` chooses it: the nearer of `z = c` and `z = 0`.
        anchor: match a.get("anchor").map(String::as_str) {
            Some("origin") => Anchor::Origin,
            _ => Anchor::Parameter,
        },
        interior: true,
        degree: a.get("deg").map(|s| s.parse().unwrap()).unwrap_or(2),
    }
}

fn places_for(size: f64) -> usize {
    // A tile of six bodies at 1280 across wants a sample placed to ~1e-3 of itself.
    ((-(size * 6.0 / 1280.0).log10()).ceil() as i64 + 4).max(20) as usize
}

/// `l = ∏_{k=1}^{p-1} D·z_k^{D-1}` and `d = dz_p/dc`, both as mantissa × 2^exp, at `c`.
/// The copy's coordinate is `C = d · l^{1/(D-1)} · Δc`.
fn orient(c_re: &Fx, c_im: &Fx, period: u32, degree: u32) -> Option<(f64, f64, f64, f64)> {
    let n = c_re.n;
    let slope = degree as f64;
    let mut z_re = Fx::zero(n);
    let mut z_im = Fx::zero(n);
    let (mut d_re, mut d_im, mut d_exp) = (0.0f64, 0.0f64, 0i32);
    let (mut l_re, mut l_im, mut l_exp) = (1.0f64, 0.0f64, 0i32);
    for k in 0..period {
        let (zr, zi) = (z_re.to_f64(), z_im.to_f64());
        if !(zr * zr + zi * zi <= 64.0) {
            return None;
        }
        let (sr, si) = if degree == 2 {
            (zr, zi)
        } else {
            let [a, b] = cpow_f64([zr, zi], degree - 1);
            (a, b)
        };
        let one = pow2(-d_exp);
        let mut nr = slope * (sr * d_re - si * d_im) + one;
        let mut ni = slope * (sr * d_im + si * d_re);
        let mut ne = d_exp;
        renorm(&mut nr, &mut ni, &mut ne);
        (d_re, d_im, d_exp) = (nr, ni, ne);
        if k >= 1 {
            let mut pr = slope * (sr * l_re - si * l_im);
            let mut pi = slope * (sr * l_im + si * l_re);
            let mut pe = l_exp;
            renorm(&mut pr, &mut pi, &mut pe);
            (l_re, l_im, l_exp) = (pr, pi, pe);
        }
        if degree == 2 {
            let x2 = z_re.sqr();
            let y2 = z_im.sqr();
            let xy = z_re.mul(&z_im);
            z_re = x2.sub(&y2).add(c_re);
            z_im = xy.shl1().add(c_im);
        } else {
            let (re, im) = cpow_fx(&z_re, &z_im, degree);
            z_re = re.add(c_re);
            z_im = im.add(c_im);
        }
    }
    // log2 and argument of d and of l^{1/(D-1)} (principal branch; the other
    // branches are the Multibrot set's own symmetry).
    let d_log = d_exp as f64 + 0.5 * (d_re * d_re + d_im * d_im).log2();
    let d_arg = d_im.atan2(d_re);
    let l_log = l_exp as f64 + 0.5 * (l_re * l_re + l_im * l_im).log2();
    let l_arg = l_im.atan2(l_re);
    let root = 1.0 / (degree as f64 - 1.0);
    Some((d_log + root * l_log, d_arg + root * l_arg, l_log, l_arg))
}

fn renorm(re: &mut f64, im: &mut f64, e: &mut i32) {
    const T: f64 = 18446744073709551616.0;
    let mut far = re.abs().max(im.abs());
    if !(far > 0.0) || !far.is_finite() {
        return;
    }
    while far >= T {
        *re /= T;
        *im /= T;
        *e += 64;
        far /= T;
    }
    while far < 1.0 {
        *re *= T;
        *im *= T;
        *e -= 64;
        far *= T;
    }
}

fn limbs_for_size(size_log2: f64) -> usize {
    // Fraction bits to hold a coordinate to 1e-6 of the body, plus guard.
    let bits = (-size_log2 + 20.0 + 64.0).max(128.0);
    ((bits / 64.0).ceil() as usize + 1).min(16)
}

fn settle_json(s: &policy::Settled) -> String {
    let r = s.settled();
    format!(
        "{{\"maxiter\":{},\"from\":{},\"steps\":{},\"at_ceiling\":{},\"escaped\":{:.4},\"proven\":{:.4},\"starved\":{:.4},\"fault\":{:.4},\"mean_iter\":{:.1}}}",
        s.maxiter,
        s.from,
        s.steps,
        s.at_ceiling,
        r.escaped as f64 / r.samples as f64,
        r.proven as f64 / r.samples as f64,
        r.starved as f64 / r.samples as f64,
        r.fault as f64 / r.samples as f64,
        r.iterations as f64 / r.samples as f64
    )
}

fn main() {
    let (cmd, a) = args();
    match cmd.as_str() {
        "search" => {
            let mut spec = spec_of(&a);
            if spec.maxiter.is_none() {
                // The page searches at the frame's settled cap.
                let s = policy::settle(&spec, policy::PROBE_COLS, policy::PROBE_ROWS).unwrap();
                spec.maxiter = Some(s.maxiter);
            }
            let budget = a.get("budget").map(|s| s.parse().unwrap()).unwrap_or(24);
            let want = a.get("want").map(|s| s.parse().unwrap()).unwrap_or(12);
            let t = Instant::now();
            let found =
                nuclei::search(&spec, nuclei::GRID_COLS, nuclei::GRID_ROWS, budget, want).unwrap();
            let mut rows = Vec::new();
            for n in &found {
                let places = places_for(n.size());
                let o = orient(&n.c_re, &n.c_im, n.period, spec.degree);
                let (olog, oarg) = o.map(|o| (o.0, o.1)).unwrap_or((f64::NAN, f64::NAN));
                rows.push(format!(
                    "{{\"period\":{},\"re\":\"{}\",\"im\":\"{}\",\"size\":{:e},\"size_log2\":{},\"steps\":{},\"residual\":{:e},\"scale_log2\":{},\"scale_arg\":{}}}",
                    n.period,
                    n.c_re.to_decimal(places),
                    n.c_im.to_decimal(places),
                    n.size(),
                    n.size_log2,
                    n.steps,
                    n.residual,
                    olog,
                    oarg
                ));
            }
            println!(
                "{{\"maxiter\":{},\"seconds\":{:.2},\"nuclei\":[{}]}}",
                spec.maxiter(),
                t.elapsed().as_secs_f64(),
                rows.join(",")
            );
        }
        "settle" => {
            let mut spec = spec_of(&a);
            if let Some(from) = a.get("from") {
                spec.maxiter = Some(from.parse::<u32>().unwrap().max(cap::for_width(spec.width)));
            }
            let s = policy::settle(&spec, policy::PROBE_COLS, policy::PROBE_ROWS).unwrap();
            println!("{}", settle_json(&s));
        }
        "field" => {
            let mut spec = spec_of(&a);
            let t = Instant::now();
            let mut settled = String::from("null");
            if a.contains_key("settle") {
                if let Some(from) = a.get("from") {
                    spec.maxiter =
                        Some(from.parse::<u32>().unwrap().max(cap::for_width(spec.width)));
                }
                let s = policy::settle(&spec, policy::PROBE_COLS, policy::PROBE_ROWS).unwrap();
                spec.maxiter = Some(s.maxiter);
                settled = settle_json(&s);
            }
            let settle_s = t.elapsed().as_secs_f64();
            let orbit = spec.reference_orbit().unwrap();
            let rows = spec.sample_height();
            let threads: u32 = a
                .get("threads")
                .map(|s| s.parse().unwrap())
                .unwrap_or_else(|| std::thread::available_parallelism().unwrap().get() as u32);
            let next = AtomicU32::new(0);
            const CHUNK: u32 = 2;
            let mut parts: Vec<(u32, Vec<u8>)> = std::thread::scope(|scope| {
                let handles: Vec<_> = (0..threads)
                    .map(|_| {
                        scope.spawn(|| {
                            let mut out = Vec::new();
                            loop {
                                let first = next.fetch_add(CHUNK, Ordering::Relaxed);
                                if first >= rows {
                                    break;
                                }
                                let last = (first + CHUNK).min(rows);
                                out.push((first, compute_rows(&spec, &orbit, first, last)));
                            }
                            out
                        })
                    })
                    .collect();
                handles
                    .into_iter()
                    .flat_map(|h| h.join().unwrap())
                    .collect()
            });
            parts.sort_by_key(|p| p.0);
            let bytes: Vec<u8> = parts.into_iter().flat_map(|p| p.1).collect();
            let mut nan = 0usize;
            let count = bytes.len() / 8;
            for i in 0..count {
                let v = f64::from_le_bytes(bytes[i * 8..i * 8 + 8].try_into().unwrap());
                if v.is_nan() {
                    nan += 1;
                }
            }
            if let Some(out) = a.get("out") {
                std::fs::write(out, &bytes).unwrap();
            }
            println!(
                "{{\"maxiter\":{},\"settle\":{},\"settle_seconds\":{:.2},\"seconds\":{:.2},\"samples\":[{},{}],\"interior\":{:.4},\"limbs\":{}}}",
                spec.maxiter(),
                settled,
                settle_s,
                t.elapsed().as_secs_f64(),
                spec.sample_width(),
                spec.sample_height(),
                nan as f64 / count as f64,
                spec.limbs()
            );
        }
        "orient" | "solve" => {
            let degree: u32 = a.get("deg").map(|s| s.parse().unwrap()).unwrap_or(2);
            let period: u32 = a["period"].parse().unwrap();
            let limbs: usize = a.get("limbs").map(|s| s.parse().unwrap()).unwrap_or(6);
            let re = Fx::parse(&a["re"], limbs).unwrap();
            let im = Fx::parse(&a["im"], limbs).unwrap();
            let (re, im, size_log2, steps, residual) = if cmd == "solve" {
                let tol: f64 = a.get("tol").map(|s| s.parse().unwrap()).unwrap_or(0.0);
                match nuclei::solve(&re, &im, period, degree, tol) {
                    Some(n) => (n.c_re, n.c_im, n.size_log2, n.steps, n.residual),
                    None => {
                        println!("{{\"escaped\":true}}");
                        return;
                    }
                }
            } else {
                (re, im, f64::NAN, 0, 0.0)
            };
            let o = orient(&re, &im, period, degree);
            let places: usize =
                a.get("places")
                    .map(|s| s.parse().unwrap())
                    .unwrap_or(if size_log2.is_finite() {
                        places_for(2f64.powf(size_log2))
                    } else {
                        40
                    });
            let (olog, oarg, llog, larg) = o.unwrap_or((f64::NAN, f64::NAN, f64::NAN, f64::NAN));
            println!(
                "{{\"period\":{},\"re\":\"{}\",\"im\":\"{}\",\"size_log2\":{},\"steps\":{},\"residual\":{:e},\"scale_log2\":{},\"scale_arg\":{},\"l_log2\":{},\"l_arg\":{},\"limbs_hint\":{}}}",
                period,
                re.to_decimal(places),
                im.to_decimal(places),
                size_log2,
                steps,
                residual,
                olog,
                oarg,
                llog,
                larg,
                if size_log2.is_finite() {
                    limbs_for_size(size_log2)
                } else {
                    limbs
                }
            );
        }
        _ => {
            eprintln!("usage: search | settle | field | orient | solve");
            std::process::exit(2);
        }
    }
}
