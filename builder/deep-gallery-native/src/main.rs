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

/// `p` steps of `z ↦ z^D + c` from `z = w`, with `∂/∂w` and `∂/∂c` of the result.
/// `None` where the orbit leaves `|z| ≤ 8` on the way, the bound [`orient`] uses.
fn segment(
    w: (&Fx, &Fx),
    c: (&Fx, &Fx),
    period: u32,
    degree: u32,
) -> Option<(Fx, Fx, [f64; 2], [f64; 2])> {
    let slope = degree as f64;
    let (mut z_re, mut z_im) = (*w.0, *w.1);
    let (mut a, mut b) = ([1.0f64, 0.0], [0.0f64, 0.0]);
    for _ in 0..period {
        let (zr, zi) = (z_re.to_f64(), z_im.to_f64());
        if !(zr * zr + zi * zi <= 64.0) {
            return None;
        }
        let [sr, si] = if degree == 2 {
            [zr, zi]
        } else {
            cpow_f64([zr, zi], degree - 1)
        };
        let (gr, gi) = (slope * sr, slope * si);
        a = [gr * a[0] - gi * a[1], gr * a[1] + gi * a[0]];
        b = [gr * b[0] - gi * b[1] + 1.0, gr * b[1] + gi * b[0]];
        let (re, im) = if degree == 2 {
            let x2 = z_re.sqr();
            let y2 = z_im.sqr();
            let xy = z_re.mul(&z_im);
            (x2.sub(&y2), xy.shl1())
        } else {
            cpow_fx(&z_re, &z_im, degree)
        };
        z_re = re.add(c.0);
        z_im = im.add(c.1);
    }
    let finite = a.iter().chain(b.iter()).all(|v| v.is_finite());
    finite.then_some((z_re, z_im, a, b))
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

/// `deep-render.js`'s `bodyShare`, natively: the rows the interior component through the
/// tile's centre spans, as a share of its height, or `None` where there is nothing to
/// measure — no interior within four samples of the centre, a component that reaches the
/// edge, or one under four rows.
fn body_share(bytes: &[u8], width: usize, height: usize) -> Option<f64> {
    let inside =
        |at: usize| f64::from_le_bytes(bytes[at * 8..at * 8 + 8].try_into().unwrap()).is_nan();
    let (cx, cy) = (width / 2, height / 2);
    let mut start = None;
    'search: for r in 0..=4usize {
        for y in cy.saturating_sub(r)..=(cy + r).min(height - 1) {
            for x in cx.saturating_sub(r)..=(cx + r).min(width - 1) {
                if inside(y * width + x) {
                    start = Some(y * width + x);
                    break 'search;
                }
            }
        }
    }
    let start = start?;
    let mut seen = vec![false; width * height];
    let mut stack = vec![start];
    seen[start] = true;
    let (mut top, mut bottom) = (height, 0);
    while let Some(at) = stack.pop() {
        let (x, y) = (at % width, at / width);
        if x == 0 || y == 0 || x == width - 1 || y == height - 1 {
            return None;
        }
        top = top.min(y);
        bottom = bottom.max(y);
        for next in [at - 1, at + 1, at - width, at + width] {
            if !seen[next] && inside(next) {
                seen[next] = true;
                stack.push(next);
            }
        }
    }
    let rows = bottom - top + 1;
    (rows >= 4).then(|| rows as f64 / height as f64)
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
    }
}

fn cmul(a: [f64; 2], b: [f64; 2]) -> [f64; 2] {
    [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]]
}

fn cdiv(a: [f64; 2], b: [f64; 2]) -> [f64; 2] {
    let n = b[0] * b[0] + b[1] * b[1];
    [
        (a[0] * b[0] + a[1] * b[1]) / n,
        (a[1] * b[0] - a[0] * b[1]) / n,
    ]
}

fn fx_add_f64(x: &Fx, v: f64) -> Option<Fx> {
    Fx::from_f64(v, x.n).map(|d| x.add(&d))
}

/// The twin of a primitive copy: the period-`p²` nucleus of `M₂`, the copy of `M₁` inside
/// `M₁`, found by **multiple shooting on the renormalised orbit**
/// (double_descent_ckpt145).
///
/// `M₁`'s neighbourhood is `c₁ + s₁·M` with `s₁ = 1/(d·r)`, `r = l^{1/(D−1)}` (branch
/// `j`), and the first return near the critical point is `z ↦ λ·z^D + z_p(c)`, which
/// `z = w/r` turns into `w ↦ w^D + C`. So at `M₂` the returns `z_{kp}` sit near `ζ_k/r`,
/// with `ζ` the orbit of `c₁` under `ζ ↦ ζ^D + c₁`, and `c` near `c₁ + s₁·c₁`.
///
/// **Why not Newton on `z_{p²}(c)` from that guess**: the guess is right to the tuning's
/// nonlinearity, about 1e-3 of `|s₁·c₁|` on the seat it was built for, which is a hundred
/// thousand twin frames, and a period-`p²` orbit started there escapes long before `p²`.
/// Shooting holds each of the `p` returns as its own unknown, so an error is carried
/// `p` iterations at a time rather than `p²`, and Newton converges from the guess.
///
/// **Generalised to a pair** (addendum 1): the twin of location `B` inside the copy `A`
/// is `c_A + s_A·c_B`, and the copy of `M_B` there has period `p_A·p_B` — `p_B` returns of
/// `p_A` steps each, seeded from `c_B`'s own orbit. `A = B` is the case above; `A` may be
/// any nucleus, a copy of a copy included, which is how a chain descends.
fn twin(
    c1: (&Fx, &Fx),
    period: u32,
    cb: (&Fx, &Fx),
    period_b: u32,
    degree: u32,
    branch: u32,
) -> Result<(Fx, Fx, Vec<f64>, [f64; 2], [f64; 2]), String> {
    let n = c1.0.n;
    let (scale_log2, scale_arg, l_log, l_arg) =
        orient(c1.0, c1.1, period, degree).ok_or("A's orbit escapes: not a nucleus")?;
    let (b_scale_log2, ..) =
        orient(cb.0, cb.1, period_b, degree).ok_or("B's orbit escapes: not a nucleus")?;
    let turn = 2.0 * std::f64::consts::PI * branch as f64 / (degree as f64 - 1.0);
    let root = 1.0 / (degree as f64 - 1.0);
    // s₁ = 1/(d·r) and the dynamic scale 1/r, on the chosen branch.
    let s1_mag = (-scale_log2).exp2();
    let s1_arg = -(scale_arg + turn);
    let s1 = [s1_mag * s1_arg.cos(), s1_mag * s1_arg.sin()];
    let dyn_mag = (-root * l_log).exp2();
    let dyn_arg = -(root * l_arg + turn);
    let dynamic = [dyn_mag * dyn_arg.cos(), dyn_mag * dyn_arg.sin()];

    // ζ, c_B's own orbit under ζ ↦ ζ^D + c_B, in fixed point so that its period holds.
    let mut zeta = vec![(0.0f64, 0.0f64); period_b as usize];
    let (mut zr, mut zi) = (Fx::zero(cb.0.n), Fx::zero(cb.0.n));
    for k in 1..period_b as usize {
        let (re, im) = if degree == 2 {
            (zr.sqr().sub(&zi.sqr()), zr.mul(&zi).shl1())
        } else {
            cpow_fx(&zr, &zi, degree)
        };
        zr = re.add(cb.0);
        zi = im.add(cb.1);
        zeta[k] = (zr.to_f64(), zi.to_f64());
    }
    let offset = cmul(s1, [cb.0.to_f64(), cb.1.to_f64()]);
    let mut c_re = fx_add_f64(c1.0, offset[0]).ok_or("the twin does not fit")?;
    let mut c_im = fx_add_f64(c1.1, offset[1]).ok_or("the twin does not fit")?;
    let p = period_b as usize;
    let mut w: Vec<(Fx, Fx)> = (0..p)
        .map(|k| {
            let v = cmul(dynamic, [zeta[k].0, zeta[k].1]);
            (
                Fx::from_f64(v[0], n).unwrap_or(Fx::zero(n)),
                Fx::from_f64(v[1], n).unwrap_or(Fx::zero(n)),
            )
        })
        .collect();
    w[0] = (Fx::zero(n), Fx::zero(n));

    // M_B inside M_A is about |s_A|·|s_B| across; converged is well under that.
    let expected = s1_mag * (-b_scale_log2).exp2();
    let mut steps = Vec::new();
    for _ in 0..40 {
        // One pass over the p_B segments of p_A steps: residuals and both derivatives.
        let mut segs = Vec::with_capacity(p);
        for k in 0..p {
            let (f_re, f_im, a, b) = segment((&w[k].0, &w[k].1), (&c_re, &c_im), period, degree)
                .ok_or("a segment escaped")?;
            let (t_re, t_im) = if k + 1 < p {
                (w[k + 1].0, w[k + 1].1)
            } else {
                (Fx::zero(n), Fx::zero(n))
            };
            let r = [f_re.sub(&t_re).to_f64(), f_im.sub(&t_im).to_f64()];
            segs.push((r, a, b));
        }
        // δw_{k+1} = r_k + A_k·δw_k + B_k·δc, δw_0 = 0 and δw_p = 0.
        let (mut alpha, mut beta) = ([0.0f64; 2], [0.0f64; 2]);
        let mut chain = Vec::with_capacity(p);
        for (r, a, b) in &segs {
            let na = cmul(*a, alpha);
            let nb = cmul(*a, beta);
            alpha = [na[0] + r[0], na[1] + r[1]];
            beta = [nb[0] + b[0], nb[1] + b[1]];
            chain.push((alpha, beta));
        }
        let dc = cdiv([-alpha[0], -alpha[1]], beta);
        if !(dc[0].is_finite() && dc[1].is_finite()) {
            return Err("the shooting system is singular".into());
        }
        let moved = dc[0].hypot(dc[1]);
        steps.push(moved);
        // Backtrack while the step would carry a segment out of the disc.
        let mut t = 1.0;
        let mut accepted = false;
        for _ in 0..12 {
            let nc_re = fx_add_f64(&c_re, t * dc[0]).ok_or("step does not fit")?;
            let nc_im = fx_add_f64(&c_im, t * dc[1]).ok_or("step does not fit")?;
            let mut nw = w.clone();
            for k in 0..p - 1 {
                let (al, be) = chain[k];
                let d = [
                    al[0] + be[0] * dc[0] - be[1] * dc[1],
                    al[1] + be[0] * dc[1] + be[1] * dc[0],
                ];
                nw[k + 1].0 = fx_add_f64(&w[k + 1].0, t * d[0]).ok_or("step does not fit")?;
                nw[k + 1].1 = fx_add_f64(&w[k + 1].1, t * d[1]).ok_or("step does not fit")?;
            }
            let fine = (0..p)
                .all(|k| segment((&nw[k].0, &nw[k].1), (&nc_re, &nc_im), period, degree).is_some());
            if fine {
                c_re = nc_re;
                c_im = nc_im;
                w = nw;
                accepted = true;
                break;
            }
            t *= 0.5;
        }
        if !accepted {
            return Err("no step keeps the returns bounded".into());
        }
        if moved < expected * 1e-9 {
            break;
        }
    }
    Ok((c_re, c_im, steps, s1, dynamic))
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
            let (parent, m) = match reading.kind {
                nuclei::Kind::Bulb { parent, m } => (parent, m),
                nuclei::Kind::Copy => (0, 0),
            };
            let chain: Vec<String> = reading.chain.iter().map(u32::to_string).collect();
            println!(
                "{{\"kind\":\"{}\",\"parent\":{},\"m\":{},\"chain\":[{}]}}",
                kind_name(reading.kind),
                parent,
                m,
                chain.join(",")
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
                Ok((c_re, c_im, steps, s1, dynamic)) => {
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
        _ => {
            eprintln!("usage: search | find | classify | settle | field | orient | solve | twin");
            std::process::exit(2);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fx(text: &str) -> Fx {
        Fx::parse(text, 6).unwrap()
    }

    /// The airship's twin inside itself is a period-9 copy, found by shooting and then
    /// confirmed by a plain Newton solve that lands on the same point, at about `|s|²`.
    #[test]
    fn the_airships_twin_is_its_period_nine_copy() {
        let (re, im) = (fx("-1.7548776662466927600495088963585286918946"), fx("0"));
        let (t_re, t_im, steps, s, _) = twin((&re, &im), 3, (&re, &im), 3, 2, 0).unwrap();
        let s_mag = s[0].hypot(s[1]);
        let last = *steps.last().unwrap();
        assert!(last < 1e-9 * s_mag * s_mag, "not converged: {steps:?}");
        let solved = nuclei::solve(&t_re, &t_im, 9, 2, 0.0).unwrap();
        let apart = solved
            .c_re
            .sub(&t_re)
            .to_f64()
            .hypot(solved.c_im.sub(&t_im).to_f64());
        assert!(apart < 1e-25, "shooting and Newton disagree by {apart:e}");
        let ratio = solved.size() / (s_mag * s_mag);
        assert!((0.8..1.25).contains(&ratio), "size is {ratio} of |s|²");
    }

    /// A pair: B = the main body's period-2 bulb nucleus inside the airship is period 6.
    #[test]
    fn a_pairs_twin_has_the_product_period() {
        let (re, im) = (fx("-1.7548776662466927600495088963585286918946"), fx("0"));
        let (b_re, b_im) = (fx("-1"), fx("0"));
        let (t_re, t_im, _, _, _) = twin((&re, &im), 3, (&b_re, &b_im), 2, 2, 0).unwrap();
        let solved = nuclei::solve(&t_re, &t_im, 6, 2, 0.0).unwrap();
        let apart = solved
            .c_re
            .sub(&t_re)
            .to_f64()
            .hypot(solved.c_im.sub(&t_im).to_f64());
        assert!(apart < 1e-25, "shooting and Newton disagree by {apart:e}");
    }
}
