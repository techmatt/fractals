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
//!   find    (search's args)                          Find minibrots' list, copies first
//!   classify --re R --im I --period P --size-log2 S [--deg D]     copy or bulb
//!   twin    --re R --im I --period P [--bre BR --bim BI --bperiod BP] [--deg D]
//!           [--branch J]                             the copy of B inside the copy A
//!
//! The Dive block's arithmetic, natively (deep_dive_block_ckpt154) — `perturb::dive`, the
//! same functions `perturb.wasm` exports as `dive_pick`, `dive_land` and `coloring_rule`:
//!
//!   pick    (find's args) --count N [--rungs "RE,IM,LOG2;…"]   Find minibrots' list and the
//!                                                    rung the Dive block takes from it
//!   land    --landing center|halfway|mapped --re R --im I --period P --size-log2 S [--deg D]
//!           [--found-in W] [--vre VR --vim VI --vw VW --count N [--are AR --aim AI --aperiod Q]]
//!   coloring --field PATH --res WxH [--ss S] (--cycles-pick U | --cycles C) --pick U
//!                                                    New coloring's cycles, λ and period
//!
//! Every answer is one JSON object on stdout.

use perturb::dive::{self, body_share, orient, twin};
use perturb::fx::Fx;
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

/// The whole frame's lanes, little-endian `f64`, row bands spread over `threads`.
fn lanes(spec: &Spec, threads: u32) -> Vec<u8> {
    let orbit = spec.reference_orbit().unwrap();
    let rows = spec.sample_height();
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
                        out.push((first, compute_rows(spec, &orbit, first, last)));
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
    parts.into_iter().flat_map(|p| p.1).collect()
}

/// The Deep tab's preview tile, `deep.js`'s `TILE`.
const TILE: [u32; 2] = [316, 178];
/// The share of the frame's height an opened copy's body fills, `deep-render.js`'s
/// `BODY_TARGET`.
const BODY_TARGET: f64 = 0.25;

fn kind_name(kind: nuclei::Kind) -> &'static str {
    match kind {
        nuclei::Kind::Copy => "copy",
        nuclei::Kind::Bulb { .. } => "bulb",
        nuclei::Kind::Unresolved(_) => "unresolved",
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
                let (olog, oarg) = o.map(|o| (o.log2, o.arg)).unwrap_or((f64::NAN, f64::NAN));
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
            let threads: u32 = a
                .get("threads")
                .map(|s| s.parse().unwrap())
                .unwrap_or_else(|| std::thread::available_parallelism().unwrap().get() as u32);
            let bytes = lanes(&spec, threads);
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
            let (olog, oarg, llog, larg) = o
                .map(|o| (o.log2, o.arg, o.l_log2, o.l_arg))
                .unwrap_or((f64::NAN, f64::NAN, f64::NAN, f64::NAN));
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
        "find" => {
            // Find minibrots' own list: copies first, bulbs only where there is no copy.
            let mut spec = spec_of(&a);
            if spec.maxiter.is_none() {
                let s = policy::settle(&spec, policy::PROBE_COLS, policy::PROBE_ROWS).unwrap();
                spec.maxiter = Some(s.maxiter);
            }
            let budget = a.get("budget").map(|s| s.parse().unwrap()).unwrap_or(24);
            let want = a.get("want").map(|s| s.parse().unwrap()).unwrap_or(12);
            let t = Instant::now();
            let found =
                nuclei::find(&spec, nuclei::GRID_COLS, nuclei::GRID_ROWS, budget, want).unwrap();
            let rows: Vec<String> = found
                .iter()
                .map(|(n, reading)| {
                    let places = places_for(n.size());
                    format!(
                        "{{\"period\":{},\"re\":\"{}\",\"im\":\"{}\",\"size_log2\":{},\"kind\":\"{}\"}}",
                        n.period,
                        n.c_re.to_decimal(places),
                        n.c_im.to_decimal(places),
                        n.size_log2,
                        kind_name(reading.kind)
                    )
                })
                .collect();
            println!(
                "{{\"maxiter\":{},\"seconds\":{:.2},\"nuclei\":[{}]}}",
                spec.maxiter(),
                t.elapsed().as_secs_f64(),
                rows.join(",")
            );
        }
        "frame" => {
            // Find minibrots' framing of an opened copy: the preview tile at
            // `nuclei::copy_width`, 8 periods deep, its body measured, and the frame re-aimed
            // so the body fills `BODY_TARGET` of the height. Where the body cannot be
            // measured, the estimate's width stands, as on the page.
            let degree: u32 = a.get("deg").map(|s| s.parse().unwrap()).unwrap_or(2);
            let period: u32 = a["period"].parse().unwrap();
            let size_log2: f64 = a["size-log2"].parse().unwrap();
            let estimate = nuclei::copy_width(size_log2.exp2(), degree);
            let spec = Spec {
                center_re: a["re"].clone(),
                center_im: a["im"].clone(),
                width: estimate,
                resolution: TILE,
                supersample: 1,
                maxiter: Some(nuclei::tile_cap(period, estimate)),
                reference: None,
                period: None,
                julia: None,
                anchor: Anchor::Parameter,
                interior: true,
                degree,
            };
            let t = Instant::now();
            let threads = std::thread::available_parallelism().unwrap().get() as u32;
            let bytes = lanes(&spec, threads);
            let share = body_share(&bytes, TILE[0] as usize, TILE[1] as usize);
            let width = share.map_or(estimate, |share| estimate * share / BODY_TARGET);
            println!(
                "{{\"estimate\":{:e},\"tile_cap\":{},\"share\":{},\"width\":{:e},\"open_cap\":{},\"seconds\":{:.2}}}",
                estimate,
                spec.maxiter(),
                share.map_or("null".to_string(), |s| format!("{s}")),
                width,
                nuclei::open_cap(period, width),
                t.elapsed().as_secs_f64()
            );
        }
        "classify" => {
            let degree: u32 = a.get("deg").map(|s| s.parse().unwrap()).unwrap_or(2);
            let limbs: usize = a.get("limbs").map(|s| s.parse().unwrap()).unwrap_or(6);
            let nucleus = nuclei::Nucleus {
                period: a["period"].parse().unwrap(),
                c_re: Fx::parse(&a["re"], limbs).unwrap(),
                c_im: Fx::parse(&a["im"], limbs).unwrap(),
                size_log2: a["size-log2"].parse().unwrap(),
                window_log2: f64::NAN,
                steps: 0,
                residual: 0.0,
            };
            let reading = nuclei::classify(&nucleus, degree);
            let (parent, m, reason) = match reading.kind {
                nuclei::Kind::Bulb { parent, m } => (parent, m, "null".to_string()),
                nuclei::Kind::Copy => (0, 0, "null".to_string()),
                nuclei::Kind::Unresolved(why) => (0, 0, format!("\"{}\"", why.reason())),
            };
            println!(
                "{{\"kind\":\"{}\",\"parent\":{},\"m\":{},\"reason\":{},\"cusps\":{}}}",
                kind_name(reading.kind),
                parent,
                m,
                reason,
                reading.cusps
            );
        }
        "twin" => {
            let degree: u32 = a.get("deg").map(|s| s.parse().unwrap()).unwrap_or(2);
            let period: u32 = a["period"].parse().unwrap();
            let branch: u32 = a.get("branch").map(|s| s.parse().unwrap()).unwrap_or(0);
            let limbs: usize = a.get("limbs").map(|s| s.parse().unwrap()).unwrap_or(6);
            let places: usize = a.get("places").map(|s| s.parse().unwrap()).unwrap_or(60);
            let re = Fx::parse(&a["re"], limbs).unwrap();
            let im = Fx::parse(&a["im"], limbs).unwrap();
            // B defaults to A: the twin of a copy's own place inside itself.
            let b_limbs: usize = a.get("blimbs").map(|s| s.parse().unwrap()).unwrap_or(limbs);
            let b_re = Fx::parse(a.get("bre").unwrap_or(&a["re"]), b_limbs).unwrap();
            let b_im = Fx::parse(a.get("bim").unwrap_or(&a["im"]), b_limbs).unwrap();
            let b_period: u32 = a
                .get("bperiod")
                .map(|s| s.parse().unwrap())
                .unwrap_or(period);
            let t = Instant::now();
            match twin((&re, &im), period, (&b_re, &b_im), b_period, degree, branch) {
                Ok(dive::Twin {
                    c_re,
                    c_im,
                    steps,
                    s: s1,
                    dynamic,
                }) => {
                    let steps: Vec<String> = steps.iter().map(|s| format!("{s:e}")).collect();
                    println!(
                        "{{\"ok\":true,\"re\":\"{}\",\"im\":\"{}\",\"steps\":[{}],\"s1\":[{:e},{:e}],\"dynamic\":[{:e},{:e}],\"seconds\":{:.2}}}",
                        c_re.to_decimal(places),
                        c_im.to_decimal(places),
                        steps.join(","),
                        s1[0],
                        s1[1],
                        dynamic[0],
                        dynamic[1],
                        t.elapsed().as_secs_f64()
                    );
                }
                Err(why) => println!("{{\"ok\":false,\"why\":\"{why}\"}}"),
            }
        }
        "pick" => {
            // Find minibrots' list at the frame's settled cap, then the Dive block's rung.
            let mut spec = spec_of(&a);
            if spec.maxiter.is_none() {
                let s = policy::settle(&spec, policy::PROBE_COLS, policy::PROBE_ROWS).unwrap();
                spec.maxiter = Some(s.maxiter);
            }
            let budget = a.get("budget").map(|s| s.parse().unwrap()).unwrap_or(24);
            let want = a.get("want").map(|s| s.parse().unwrap()).unwrap_or(12);
            let count: u32 = a["count"].parse().unwrap();
            let t = Instant::now();
            let found =
                nuclei::find(&spec, nuclei::GRID_COLS, nuclei::GRID_ROWS, budget, want).unwrap();
            let limbs = found.first().map_or(6, |(n, _)| n.c_re.n);
            let centre_re = Fx::parse(&spec.center_re, limbs).unwrap();
            let centre_im = Fx::parse(&spec.center_im, limbs).unwrap();
            let candidates: Vec<dive::Candidate> = found
                .iter()
                .map(|(n, reading)| dive::Candidate {
                    period: n.period,
                    off_re: n.c_re.sub(&centre_re).to_f64(),
                    off_im: n.c_im.sub(&centre_im).to_f64(),
                    size_log2: n.size_log2,
                    copy: reading.kind == nuclei::Kind::Copy,
                })
                .collect();
            let rungs: Vec<dive::Rung> = a
                .get("rungs")
                .map(|text| {
                    text.split(';')
                        .filter(|one| !one.is_empty())
                        .map(|one| {
                            let parts: Vec<&str> = one.split(',').collect();
                            dive::Rung {
                                off_re: Fx::parse(parts[0], limbs)
                                    .unwrap()
                                    .sub(&centre_re)
                                    .to_f64(),
                                off_im: Fx::parse(parts[1], limbs)
                                    .unwrap()
                                    .sub(&centre_im)
                                    .to_f64(),
                                size_log2: parts[2].parse().unwrap(),
                            }
                        })
                        .collect()
                })
                .unwrap_or_default();
            let picked = dive::pick(&candidates, spec.width, spec.degree, &rungs, count);
            let rows: Vec<String> = found
                .iter()
                .map(|(n, reading)| {
                    let places = places_for(n.size());
                    format!(
                        "{{\"period\":{},\"re\":\"{}\",\"im\":\"{}\",\"size_log2\":{},\"kind\":\"{}\"}}",
                        n.period,
                        n.c_re.to_decimal(places),
                        n.c_im.to_decimal(places),
                        n.size_log2,
                        kind_name(reading.kind)
                    )
                })
                .collect();
            let (index, refusal, period) = match picked {
                Ok(index) => (index.to_string(), "null".to_string(), 0),
                Err(dive::Refusal::NoCopy) => ("null".into(), "\"no_copy\"".into(), 0),
                Err(dive::Refusal::NoneSmaller) => ("null".into(), "\"none_smaller\"".into(), 0),
                Err(dive::Refusal::OverBudget { period }) => {
                    ("null".into(), "\"over_budget\"".into(), period)
                }
            };
            println!(
                "{{\"maxiter\":{},\"seconds\":{:.2},\"nuclei\":[{}],\"index\":{},\"refusal\":{},\"period\":{},\"need\":{}}}",
                spec.maxiter(),
                t.elapsed().as_secs_f64(),
                rows.join(","),
                index,
                refusal,
                period,
                dive::need(period, count)
            );
        }
        "land" => {
            let degree: u32 = a.get("deg").map(|s| s.parse().unwrap()).unwrap_or(2);
            let period: u32 = a["period"].parse().unwrap();
            let size_log2: f64 = a
                .get("size-log2")
                .map(|s| s.parse().unwrap())
                .unwrap_or(f64::NAN);
            let t = Instant::now();
            let frame = match a["landing"].as_str() {
                "center" => Ok(dive::center(&a["re"], &a["im"], period, size_log2, degree)),
                "halfway" => Ok(dive::halfway(
                    &a["re"],
                    &a["im"],
                    period,
                    size_log2,
                    degree,
                    a["found-in"].parse().unwrap(),
                )),
                "mapped" => {
                    let count: u32 = a["count"].parse().unwrap();
                    if dive::fits(period, count) {
                        let anchor = a.get("are").map(|are| {
                            (
                                are.as_str(),
                                a["aim"].as_str(),
                                a["aperiod"].parse().unwrap(),
                            )
                        });
                        dive::mapped(
                            (&a["re"], &a["im"], period),
                            degree,
                            (&a["vre"], &a["vim"], a["vw"].parse().unwrap(), count),
                            anchor,
                        )
                    } else {
                        Err(format!("over the ceiling: {}", dive::need(period, count)))
                    }
                }
                other => Err(format!("`{other}` is not a landing")),
            };
            match frame {
                Ok(frame) => {
                    let (twin_period, steps) = match &frame.twin {
                        Some((p, steps)) => (
                            p.to_string(),
                            steps
                                .iter()
                                .map(|s| format!("{s:e}"))
                                .collect::<Vec<_>>()
                                .join(","),
                        ),
                        None => ("null".to_string(), String::new()),
                    };
                    println!(
                        "{{\"ok\":true,\"re\":\"{}\",\"im\":\"{}\",\"width\":{:e},\"cap\":{},\"turn\":{},\"twin_period\":{},\"twin_steps\":[{}],\"seconds\":{:.2}}}",
                        frame.re,
                        frame.im,
                        frame.width,
                        frame.cap,
                        frame.turn,
                        twin_period,
                        steps,
                        t.elapsed().as_secs_f64()
                    );
                }
                Err(why) => println!("{{\"ok\":false,\"why\":\"{why}\"}}"),
            }
        }
        "coloring" => {
            let res: Vec<usize> = a["res"].split('x').map(|v| v.parse().unwrap()).collect();
            let ss: usize = a.get("ss").map(|s| s.parse().unwrap()).unwrap_or(1);
            let (width, height) = (res[0] * ss, res[1] * ss);
            let bytes = std::fs::read(&a["field"]).unwrap();
            let values: Vec<f64> = bytes
                .chunks_exact(8)
                .map(|b| f64::from_le_bytes(b.try_into().unwrap()))
                .collect();
            // `--cycles-pick U` draws the cycles as the page does; `--cycles C` names them.
            let cycles: f64 = match a.get("cycles") {
                Some(c) => c.parse().unwrap(),
                None => dive::cycles(a["cycles-pick"].parse().unwrap()),
            };
            let pick: f64 = a["pick"].parse().unwrap();
            match dive::coloring(&values, width, height, cycles) {
                Some(tried) => {
                    let chosen = dive::choose(&tried, pick);
                    let each: Vec<String> = tried
                        .iter()
                        .map(|t| {
                            format!(
                                "{{\"lambda\":{},\"period\":{},\"roughness\":{}}}",
                                t.lambda, t.period, t.roughness
                            )
                        })
                        .collect();
                    println!(
                        "{{\"ok\":true,\"cycles\":{},\"lambda\":{},\"period\":{},\"roughness\":{},\"tried\":[{}]}}",
                        cycles,
                        chosen.lambda,
                        chosen.period,
                        chosen.roughness,
                        each.join(",")
                    );
                }
                None => println!("{{\"ok\":false,\"why\":\"too little exterior\"}}"),
            }
        }
        _ => {
            eprintln!(
                "usage: search | find | classify | settle | field | orient | solve | twin | pick | land | coloring"
            );
            std::process::exit(2);
        }
    }
}
