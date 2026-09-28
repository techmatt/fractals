//! The dive: find a minibrot near a view, then land in it *(deep_dive_block_ckpt154)*.
//!
//! `builder/README.md`'s *How the first set was found* is the method, worked by hand for the
//! Deep tab's gallery and the double descent; this module is that method as code the page and
//! the native tool both run, so a frame the tool finds is a link the page opens identically.
//! Four pieces, each a function a caller can hold to one sentence:
//!
//! - **The rung rule** ([`pick`]): of the copies a search found, largest first, the first that
//!   is a real step down from where the dive stands and whose landing fits the explicit
//!   ceiling.
//! - **The landings** ([`center`], [`halfway`], [`mapped`]): the copy framed; the symmetry
//!   stage geometrically halfway between that frame and the view the copy was found in; and a
//!   whole-set view carried into the copy by its complex scale `σ = d·l^{1/(D−1)}`
//!   ([`orient`]), placed exactly by [`twin`]'s multiple shooting where a nucleus near the
//!   view anchors it.
//! - **The cap rule** ([`cap_for`]): the width's own cap, or the copy's period times the
//!   landing's count, whichever is more; and a landing whose product passes
//!   [`crate::cap::EXPLICIT_CEILING`] is refused rather than drawn short ([`fits`]).
//! - **The colouring rule** ([`coloring`], [`choose`]): the λ smoothness test over
//!   [`LAMBDAS`], with the period the field's 3rd-to-97th-percentile range of `g` over a
//!   number of cycles.
//!
//! Nothing here draws. A landing is a centre as text, a width and a cap, which is a `dv=3`
//! link less its colour; the page draws it like any link.

use crate::fx::{Fx, pow2};
use crate::reference::{cpow_f64, cpow_fx};
use crate::{cap, nuclei, progress};

// ------------------------------------------------------------------------- the scale

/// A copy's complex scale, as logarithms: `σ = d·l^{1/(D−1)}`, with `d = dz_p/dc` and
/// `l = ∏_{k=1}^{p−1} D·z_k^{D−1}` at the nucleus, principal root.
///
/// A whole-set coordinate `C` is the copy's point `c = nucleus + C/σ`; the copy is `1/|σ|`
/// across and turned by `−arg σ`. Kept as `log₂` and an argument because `|σ|` of a deep copy
/// is past what an `f64` exponent carries long before the copy stops being interesting.
#[derive(Clone, Copy, Debug)]
pub struct Scale {
    /// `log₂|σ|`.
    pub log2: f64,
    /// `arg σ`, radians.
    pub arg: f64,
    /// `log₂|l|`.
    pub l_log2: f64,
    /// `arg l`, radians.
    pub l_arg: f64,
}

impl Scale {
    /// `s = 1/σ`, the copy's own scale in the plane: `c = nucleus + s·C`.
    pub fn inverse(&self) -> [f64; 2] {
        let magnitude = (-self.log2).exp2();
        [magnitude * (-self.arg).cos(), magnitude * (-self.arg).sin()]
    }
}

/// [`Scale`] at a period-`period` nucleus, or `None` where the orbit leaves `|z| ≤ 8` before
/// the period is up, which means `c` is not a nucleus of that period.
///
/// Moved here from `builder/deep-gallery-native`, where the double descent and the gallery's
/// copy-mapped frames were built on it; the numbers are unchanged.
pub fn orient(c_re: &Fx, c_im: &Fx, period: u32, degree: u32) -> Option<Scale> {
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
    // log2 and argument of d and of l^{1/(D-1)} (principal branch; the other branches are the
    // Multibrot set's own symmetry).
    let d_log = d_exp as f64 + 0.5 * (d_re * d_re + d_im * d_im).log2();
    let d_arg = d_im.atan2(d_re);
    let l_log = l_exp as f64 + 0.5 * (l_re * l_re + l_im * l_im).log2();
    let l_arg = l_im.atan2(l_re);
    let root = 1.0 / (degree as f64 - 1.0);
    Some(Scale {
        log2: d_log + root * l_log,
        arg: d_arg + root * l_arg,
        l_log2: l_log,
        l_arg,
    })
}

/// Hold a scaled mantissa in `[1, 2^64)` by its larger component.
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

// ------------------------------------------------------------------------- the twin

/// `p` steps of `z ↦ z^D + c` from `z = w`, with `∂/∂w` and `∂/∂c` of the result. `None`
/// where the orbit leaves `|z| ≤ 8` on the way, the bound [`orient`] uses.
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

/// What [`twin`] found: the nucleus, the Newton steps it took (each `|δc|`), the copy's scale
/// `s = 1/σ` and the dynamic scale on the chosen branch.
#[derive(Clone, Debug)]
pub struct Twin {
    pub c_re: Fx,
    pub c_im: Fx,
    pub steps: Vec<f64>,
    pub s: [f64; 2],
    pub dynamic: [f64; 2],
}

/// The copy of `M_B` inside the copy `A`: the period-`p_A·p_B` nucleus near
/// `c_A + s_A·c_B`, found by **multiple shooting on the renormalised orbit**
/// *(double_descent_ckpt145; moved here from `builder/deep-gallery-native`)*.
///
/// `A`'s neighbourhood is `c_A + s_A·M` with `s_A = 1/(d·r)`, `r = l^{1/(D−1)}` (branch
/// `branch`), and the first return near the critical point is `z ↦ λ·z^D + z_p(c)`, which
/// `z = w/r` turns into `w ↦ w^D + C`. So at the twin the `p_B` returns `z_{k·p_A}` sit near
/// `ζ_k/r`, with `ζ` the orbit of `c_B` under `ζ ↦ ζ^D + c_B`.
///
/// **Why not Newton on `z_{p_A·p_B}(c)` from the first-order place**: that place misses by the
/// tuning's nonlinearity, 0.04% to 0.34% of the offset on every case measured, which on the
/// favicon seat was a hundred thousand twin frames, and a period-`p_A·p_B` orbit started there
/// escapes long before it is done. Shooting holds each of the `p_B` returns as its own unknown,
/// so an error is carried `p_A` iterations at a time rather than `p_A·p_B`, and Newton
/// converges from the guess. Every Fx here is at `c_a`'s limb count.
pub fn twin(
    c_a: (&Fx, &Fx),
    period: u32,
    c_b: (&Fx, &Fx),
    period_b: u32,
    degree: u32,
    branch: u32,
) -> Result<Twin, String> {
    let n = c_a.0.n;
    let scale = orient(c_a.0, c_a.1, period, degree).ok_or("A's orbit escapes: not a nucleus")?;
    let b_scale =
        orient(c_b.0, c_b.1, period_b, degree).ok_or("B's orbit escapes: not a nucleus")?;
    let turn = 2.0 * std::f64::consts::PI * branch as f64 / (degree as f64 - 1.0);
    let root = 1.0 / (degree as f64 - 1.0);
    // s_A = 1/(d·r) and the dynamic scale 1/r, on the chosen branch.
    let s1_mag = (-scale.log2).exp2();
    let s1_arg = -(scale.arg + turn);
    let s1 = [s1_mag * s1_arg.cos(), s1_mag * s1_arg.sin()];
    let dyn_mag = (-root * scale.l_log2).exp2();
    let dyn_arg = -(root * scale.l_arg + turn);
    let dynamic = [dyn_mag * dyn_arg.cos(), dyn_mag * dyn_arg.sin()];

    // ζ, c_B's own orbit under ζ ↦ ζ^D + c_B, in fixed point so that its period holds.
    let mut zeta = vec![(0.0f64, 0.0f64); period_b as usize];
    let (mut zr, mut zi) = (Fx::zero(c_b.0.n), Fx::zero(c_b.0.n));
    for k in 1..period_b as usize {
        let (re, im) = if degree == 2 {
            (zr.sqr().sub(&zi.sqr()), zr.mul(&zi).shl1())
        } else {
            cpow_fx(&zr, &zi, degree)
        };
        zr = re.add(c_b.0);
        zi = im.add(c_b.1);
        zeta[k] = (zr.to_f64(), zi.to_f64());
    }
    let offset = cmul(s1, [c_b.0.to_f64(), c_b.1.to_f64()]);
    let mut c_re = fx_add_f64(c_a.0, offset[0]).ok_or("the twin does not fit")?;
    let mut c_im = fx_add_f64(c_a.1, offset[1]).ok_or("the twin does not fit")?;
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

    // M_B inside A is about |s_A|·|s_B| across; converged is well under that.
    let expected = s1_mag * (-b_scale.log2).exp2();
    let mut steps = Vec::new();
    const MOST: u32 = 40;
    for step in 0..MOST {
        progress::report(step, MOST);
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
        // δw_{k+1} = r_k + A_k·δw_k + B_k·δc, δw_0 = 0 and δw_p = 0, **eliminated backward**
        // from the closing condition *(deep_dive_block_ckpt154)*: δw_k = γ_k + η_k·δc with
        // γ_p = η_p = 0 and δw_k = (δw_{k+1} − r_k − B_k·δc)/A_k. It was eliminated forward
        // from δw_0, and forward the chain grows like the product of the returns' multipliers —
        // 1e16 by the 998th return of a seahorse-valley copy — so every δw_k was a difference
        // of two numbers that size and the second step carried a return out of the plane. The
        // forward map expands, so backward it contracts. A_0 is zero (w_0 is the critical
        // point), which is why the first segment closes the system rather than being divided.
        let mut back = vec![([0.0f64; 2], [0.0f64; 2]); p + 1];
        let (mut gamma, mut eta) = ([0.0f64; 2], [0.0f64; 2]);
        for k in (1..p).rev() {
            let (r, a, b) = segs[k];
            gamma = cdiv([gamma[0] - r[0], gamma[1] - r[1]], a);
            eta = cdiv([eta[0] - b[0], eta[1] - b[1]], a);
            back[k] = (gamma, eta);
        }
        // δw_1 = r_0 + B_0·δc, and δw_1 = γ_1 + η_1·δc.
        let (r0, _, b0) = segs[0];
        let dc = cdiv(
            [r0[0] - gamma[0], r0[1] - gamma[1]],
            [eta[0] - b0[0], eta[1] - b0[1]],
        );
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
            for k in 1..p {
                let (ga, et) = back[k];
                let d = [
                    ga[0] + et[0] * dc[0] - et[1] * dc[1],
                    ga[1] + et[0] * dc[1] + et[1] * dc[0],
                ];
                nw[k].0 = fx_add_f64(&w[k].0, t * d[0]).ok_or("step does not fit")?;
                nw[k].1 = fx_add_f64(&w[k].1, t * d[1]).ok_or("step does not fit")?;
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
    Ok(Twin {
        c_re,
        c_im,
        steps,
        s: s1,
        dynamic,
    })
}

// ------------------------------------------------------------------------ the budget

/// How many periods of its copy the symmetry stage is iterated for: the tab's own tile rule,
/// [`nuclei::TILE_PERIODS`], which is what the gallery's symmetry stages asked for.
pub const HALFWAY_PERIODS: u32 = nuclei::TILE_PERIODS;

/// Where a dive lands, and how many of the copy's periods it is iterated for.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Landing {
    /// The copy, framed as Find minibrots frames one: [`nuclei::copy_width`], thirty-two
    /// periods ([`nuclei::OPEN_PERIODS`]).
    Center,
    /// The symmetry stage: centred on the copy, geometrically halfway from the framed width
    /// to the view the copy was found in, at [`HALFWAY_PERIODS`].
    Halfway,
    /// A whole-set view carried into the copy. `count` is the view's own cap: a view mapped
    /// into a period-`p` copy escapes after about `p` times its own counts, which is the
    /// ceiling trap the gallery's spirals fell into.
    Mapped { count: u32 },
}

impl Landing {
    /// The periods the landing's cap is a multiple of.
    pub fn count(&self) -> u32 {
        match self {
            Landing::Center => nuclei::OPEN_PERIODS,
            Landing::Halfway => HALFWAY_PERIODS,
            Landing::Mapped { count } => *count,
        }
    }
}

/// Whether a copy of `period` can be drawn at `count` of its periods under the explicit
/// ceiling. **A landing that does not fit is refused, never drawn short**: a copy at fewer
/// periods than it asks for is the all-black blob Find minibrots' thirty-two exist to prevent.
pub fn fits(period: u32, count: u32) -> bool {
    period as f64 * count as f64 <= cap::EXPLICIT_CEILING
}

/// The iterations a landing asks for: the copy's period times the landing's count.
pub fn need(period: u32, count: u32) -> f64 {
    period as f64 * count as f64
}

/// **The cap rule**: the width's own cap, or `period × count`, whichever is more, under the
/// explicit ceiling. It is written into the landing's link as `n`, so the link opens pinned.
/// No probe is run: the product is the depth the landing asks for, and a probe is a question
/// about what a frame nobody has sized needs.
pub fn cap_for(period: u32, count: u32, width: f64) -> u32 {
    cap::for_width(width)
        .max(period.saturating_mul(count))
        .min(cap::EXPLICIT_CEILING as u32)
}

// ------------------------------------------------------------------------ the rung rule

/// One copy a search found, as the rung rule reads it: its offset from the searched view's
/// centre (an exact decimal difference, narrowed after), its size and whether it is a copy.
#[derive(Clone, Copy, Debug)]
pub struct Candidate {
    pub period: u32,
    pub off_re: f64,
    pub off_im: f64,
    pub size_log2: f64,
    pub copy: bool,
}

/// A copy the dive has already landed on, in the same coordinates as the candidates.
#[derive(Clone, Copy, Debug)]
pub struct Rung {
    pub off_re: f64,
    pub off_im: f64,
    pub size_log2: f64,
}

/// A rung's body must be under this share of the last rung's: a real step down rather than a
/// step sideways to a sibling of about the same size. The gallery's rule.
pub const RUNG_SHRINK: f64 = 8.0;

/// A copy nearer an earlier rung than this many of that rung's bodies, in the larger
/// coordinate, is that rung found again. The gallery's rule.
pub const RUNG_APART: f64 = 1.5;

/// With no earlier rung, a copy whose framed width is over this share of the view's is the
/// view's own copy rather than a step into it.
pub const FRESH_SHARE: f64 = 0.5;

/// Why no rung was taken.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Refusal {
    /// The search found no copy at all.
    NoCopy,
    /// Copies, but none a real step down from where the dive stands.
    NoneSmaller,
    /// A step down, but its landing passes the explicit ceiling: the smallest `need`.
    OverBudget { period: u32 },
}

fn size_of(log2: f64) -> f64 {
    if log2 < -1060.0 { 0.0 } else { log2.exp2() }
}

/// **The rung rule**: of `found`, largest first as a search returns them, the first that is a
/// copy, a step down from where the dive stands, and whose landing at `count` periods fits.
///
/// A step down is the gallery's: with `earlier` rungs, a body under an eighth of the last one's
/// and more than one and a half bodies from every one of them — each view is centred on the
/// last nucleus, so the search finds that copy again, and this is what stops the chain taking
/// it twice. With none, it is a copy whose frame is under half the view's width, so a view
/// already framed on its copy steps into it rather than landing where it stands.
pub fn pick(
    found: &[Candidate],
    width: f64,
    degree: u32,
    earlier: &[Rung],
    count: u32,
) -> Result<usize, Refusal> {
    let mut over: Option<u32> = None;
    let mut any_copy = false;
    for (index, one) in found.iter().enumerate() {
        if !one.copy {
            continue;
        }
        any_copy = true;
        let size = size_of(one.size_log2);
        let smaller = match earlier.last() {
            Some(last) => size < size_of(last.size_log2) / RUNG_SHRINK,
            None => nuclei::copy_width(size, degree) < width * FRESH_SHARE,
        };
        let apart = earlier.iter().all(|rung| {
            let body = size_of(rung.size_log2);
            (one.off_re - rung.off_re)
                .abs()
                .max((one.off_im - rung.off_im).abs())
                > RUNG_APART * body
        });
        if !smaller || !apart {
            continue;
        }
        if !fits(one.period, count) {
            over = Some(over.map_or(one.period, |p| p.min(one.period)));
            continue;
        }
        return Ok(index);
    }
    Err(match (any_copy, over) {
        (false, _) => Refusal::NoCopy,
        (true, Some(period)) => Refusal::OverBudget { period },
        (true, None) => Refusal::NoneSmaller,
    })
}

// ------------------------------------------------------------------------ the landings

/// Where a dive lands: the centre as exact text, the width, the cap, and the turn the
/// picture carries (a mapped view is its whole-set view turned by `arg s`, which the explorer
/// does not undo because it draws no rotation).
#[derive(Clone, Debug)]
pub struct Frame {
    pub re: String,
    pub im: String,
    pub width: f64,
    pub cap: u32,
    /// Degrees, `(−180, 180]`. Zero for the two landings centred on the copy.
    pub turn: f64,
    /// For a mapped landing anchored on a nucleus: the twin's period and the shooting steps.
    pub twin: Option<(u64, Vec<f64>)>,
}

/// The fraction digits a centre needs to place a pixel of a frame this wide: the width's own
/// decade and eight guard digits, `deep-render.js`'s `digitsFor`.
pub fn digits_for(width: f64) -> usize {
    let decade = if width > 0.0 && width.is_finite() {
        (-width.log10()).ceil().max(0.0) as usize
    } else {
        0
    };
    decade + 8
}

/// The copy, framed: [`nuclei::copy_width`] of its size, thirty-two periods.
pub fn center(c_re: &str, c_im: &str, period: u32, size_log2: f64, degree: u32) -> Frame {
    let width = nuclei::copy_width(size_of(size_log2), degree);
    Frame {
        re: c_re.to_string(),
        im: c_im.to_string(),
        width,
        cap: cap_for(period, Landing::Center.count(), width),
        turn: 0.0,
        twin: None,
    }
}

/// The symmetry stage: centred on the copy, at the geometric mean of the copy's frame and the
/// view it was found in, eight periods.
pub fn halfway(
    c_re: &str,
    c_im: &str,
    period: u32,
    size_log2: f64,
    degree: u32,
    found_in: f64,
) -> Frame {
    let framed = nuclei::copy_width(size_of(size_log2), degree);
    let width = (framed * found_in.max(framed)).sqrt();
    Frame {
        re: c_re.to_string(),
        im: c_im.to_string(),
        width,
        cap: cap_for(period, Landing::Halfway.count(), width),
        turn: 0.0,
        twin: None,
    }
}

/// The limbs a mapped landing is computed at: enough for its own frame across a wide grid,
/// and one more.
pub fn limbs_for_landing(width: f64) -> usize {
    (crate::reference::limbs_for(width, 4096) + 1).min(crate::fx::MAX_LIMBS)
}

/// A whole-set view `(C, width, count)` carried into the copy `A`.
///
/// **The place is `twin + s·(C − c_B)`**, where `c_B` is a nucleus near `C` and `twin` its copy
/// inside `A`, solved by [`twin`]. The first-order place `c_A + s·C` misses by the tuning's
/// nonlinearity, a fraction of a percent of `|s·C|`, and that is thousands of frames once the
/// view is narrow; anchored on a nucleus the miss is that fraction of `|s·(C − c_B)|`, which is
/// a fraction of the frame. Without an anchor, or where the shooting does not converge, the
/// first-order place is taken and the caller is told (`twin` is `None`).
#[allow(clippy::too_many_arguments)]
pub fn mapped(
    a: (&str, &str, u32),
    degree: u32,
    view: (&str, &str, f64, u32),
    anchor: Option<(&str, &str, u32)>,
) -> Result<Frame, String> {
    let (a_re, a_im, period) = a;
    let (v_re, v_im, v_width, count) = view;
    // The scale first, at a count good for the copy itself.
    let probe = 6usize.max(limbs_for_landing(v_width * 1e-3));
    let pa_re = Fx::parse(a_re, probe).ok_or("A's centre is not a decimal")?;
    let pa_im = Fx::parse(a_im, probe).ok_or("A's centre is not a decimal")?;
    let scale = orient(&pa_re, &pa_im, period, degree).ok_or("A is not a nucleus of its period")?;
    let s = scale.inverse();
    let s_mag = (-scale.log2).exp2();
    let width = v_width * s_mag;
    if !(width > 0.0) || !width.is_finite() {
        return Err("the landing's width is past what a double holds".into());
    }
    let n = limbs_for_landing(width);
    let c_re = Fx::parse(a_re, n).ok_or("A's centre is not a decimal")?;
    let c_im = Fx::parse(a_im, n).ok_or("A's centre is not a decimal")?;
    let big_re = Fx::parse(v_re, n).ok_or("the view's centre is not a decimal")?;
    let big_im = Fx::parse(v_im, n).ok_or("the view's centre is not a decimal")?;

    let mut solved = None;
    if let Some((b_re, b_im, period_b)) = anchor {
        let nb_re = Fx::parse(b_re, n).ok_or("the anchor is not a decimal")?;
        let nb_im = Fx::parse(b_im, n).ok_or("the anchor is not a decimal")?;
        let product = period.checked_mul(period_b);
        if let (Some(product), Ok(found)) = (
            product,
            twin(
                (&c_re, &c_im),
                period,
                (&nb_re, &nb_im),
                period_b,
                degree,
                0,
            ),
        ) {
            // The local scale at the anchor, `σ_B/σ_twin`, and not the copy's own `s`: the
            // tuning map is only near-linear where the copy is deep; on the airship and a
            // period-15 copy it is 1–8% off in size and up to 5° in turn (README §11). Both
            // scales are the nuclei's own, so
            // the local map is exact to first order about the anchor; of the `D−1` branches the
            // one nearest `s` is the one continuous with the copy.
            let local = match (
                orient(&found.c_re, &found.c_im, product, degree),
                orient(&nb_re, &nb_im, period_b, degree),
            ) {
                (Some(at_twin), Some(at_b)) => {
                    let magnitude = (at_b.log2 - at_twin.log2).exp2();
                    let base = at_b.arg - at_twin.arg;
                    let want = s[1].atan2(s[0]);
                    let branches = (degree - 1) as i32;
                    let turn = 2.0 * std::f64::consts::PI / branches as f64;
                    let angle = (0..branches)
                        .map(|k| base + turn * k as f64)
                        .min_by(|x, y| {
                            let off = |a: f64| (a - want).sin().atan2((a - want).cos()).abs();
                            off(*x).total_cmp(&off(*y))
                        })
                        .unwrap();
                    [magnitude * angle.cos(), magnitude * angle.sin()]
                }
                _ => s,
            };
            let off = [big_re.sub(&nb_re).to_f64(), big_im.sub(&nb_im).to_f64()];
            let moved = cmul(local, off);
            let re = fx_add_f64(&found.c_re, moved[0]).ok_or("the landing does not fit")?;
            let im = fx_add_f64(&found.c_im, moved[1]).ok_or("the landing does not fit")?;
            solved = Some((re, im, local, product as u64, found.steps));
        }
    }
    let (re, im, local, twin) = match solved {
        Some((re, im, local, p, steps)) => (re, im, local, Some((p, steps))),
        None => {
            let moved = cmul(s, [big_re.to_f64(), big_im.to_f64()]);
            let re = fx_add_f64(&c_re, moved[0]).ok_or("the landing does not fit")?;
            let im = fx_add_f64(&c_im, moved[1]).ok_or("the landing does not fit")?;
            (re, im, s, None)
        }
    };
    let width = v_width * local[0].hypot(local[1]);
    let places = digits_for(width);
    let turn = local[1].atan2(local[0]).to_degrees();
    Ok(Frame {
        re: re.to_decimal(places),
        im: im.to_decimal(places),
        width,
        cap: cap_for(period, count, width),
        turn,
        twin,
    })
}

// ------------------------------------------------------------------------ the colouring

/// The λs the smoothness test tries, in order.
pub const LAMBDAS: [f64; 6] = [0.0, 0.15, 0.3, 0.5, 0.75, 1.0];

/// A λ is acceptable where under this share of neighbouring sample pairs are more than a
/// quarter turn apart. The gallery's `ROUGH`.
pub const ROUGH: f64 = 0.04;

/// The cycles New coloring draws its count from, uniformly. It was the gallery's `CYCLES`,
/// 1.5 to 6, and narrowed to 1 to 4 *(Matt, dive_mixture_ckpt154)*: the busy end of that
/// range was where a deep landing read as noise.
pub const CYCLES: (f64, f64) = (1.0, 4.0);

/// The cycles New coloring runs the palette across the field, from a uniform `u ∈ [0, 1)`.
pub fn cycles(u: f64) -> f64 {
    CYCLES.0 + u.clamp(0.0, 1.0) * (CYCLES.1 - CYCLES.0)
}

/// The percentiles of `g` whose range the period divides.
pub const RANGE: (f64, f64) = (3.0, 97.0);

/// The engine's `COMPRESSION_FLOOR`, `hold.js`'s `FLOOR`: `ν` is floored here before it is
/// compressed, exactly as the absolute scale floors it.
pub const FLOOR: f64 = 1.1754943508222875e-38;

/// How many samples the percentiles are read off at most: a stride through the field, as
/// `hold.js`'s reference is taken. The roughness reads every pair.
pub const PERCENTILE_SAMPLES: usize = 1 << 18;

/// One λ, tried.
#[derive(Clone, Copy, Debug)]
pub struct Tried {
    pub lambda: f64,
    pub period: f64,
    pub roughness: f64,
}

/// The engine's Box–Cox of one value.
pub fn compress(nu: f64, lambda: f64) -> f64 {
    let v = nu.max(FLOOR);
    if lambda == 0.0 {
        v.ln()
    } else {
        (v.powf(lambda) - 1.0) / lambda
    }
}

/// `x` to three significant figures, the period's written precision.
fn figures3(x: f64) -> f64 {
    if !(x > 0.0) || !x.is_finite() {
        return x;
    }
    let decade = x.log10().floor() as i32;
    let unit = 10f64.powi(decade - 2);
    (x / unit).round() * unit
}

/// Linear-interpolated percentile (numpy's default), `q` in percent, by selection rather
/// than a sort: the two ranks either side of the percentile are all it reads. Reorders
/// `values`.
fn percentile(values: &mut [f64], q: f64) -> f64 {
    let last = values.len() - 1;
    let at = q / 100.0 * last as f64;
    let low = at.floor() as usize;
    let t = at - low as f64;
    let (_, below, above) = values.select_nth_unstable_by(low, |a, b| a.total_cmp(b));
    let below = *below;
    let next = if low < last {
        above.iter().copied().fold(f64::INFINITY, f64::min)
    } else {
        below
    };
    below + (next - below) * t
}

/// **The λ smoothness test** over a field of `width × height` samples, `NaN` for the
/// interior, at `cycles` turns of the palette across the 3rd-to-97th percentile of `g`.
/// `None` where the field has fewer than a hundred exterior samples.
pub fn coloring(values: &[f64], width: usize, height: usize, cycles: f64) -> Option<Vec<Tried>> {
    let count = (width * height).min(values.len());
    let finite = values[..count].iter().filter(|v| v.is_finite()).count();
    if finite < 100 || !(cycles > 0.0) {
        return None;
    }
    let stride = (finite / PERCENTILE_SAMPLES).max(1);
    let mut g = vec![f64::NAN; count];
    let mut tried = Vec::with_capacity(LAMBDAS.len());
    for &lambda in &LAMBDAS {
        let mut taken = Vec::with_capacity(finite / stride + 1);
        let mut seen = 0usize;
        for (at, value) in values[..count].iter().enumerate() {
            if value.is_finite() {
                let v = compress(*value, lambda);
                g[at] = v;
                if seen % stride == 0 {
                    taken.push(v);
                }
                seen += 1;
            } else {
                g[at] = f64::NAN;
            }
        }
        let range = percentile(&mut taken, RANGE.1) - percentile(&mut taken, RANGE.0);
        let period = figures3(range.max(1e-9) / cycles);
        // Neighbouring pairs, across and down, both exterior.
        let (mut pairs, mut rough) = (0usize, 0usize);
        for y in 0..height {
            for x in 0..width {
                let here = g[y * width + x];
                if !here.is_finite() {
                    continue;
                }
                if x + 1 < width {
                    let next = g[y * width + x + 1];
                    if next.is_finite() {
                        pairs += 1;
                        if ((next - here) / period).abs() > 0.25 {
                            rough += 1;
                        }
                    }
                }
                if y + 1 < height {
                    let next = g[(y + 1) * width + x];
                    if next.is_finite() {
                        pairs += 1;
                        if ((next - here) / period).abs() > 0.25 {
                            rough += 1;
                        }
                    }
                }
            }
        }
        let roughness = if pairs == 0 {
            1.0
        } else {
            rough as f64 / pairs as f64
        };
        tried.push(Tried {
            lambda,
            period,
            roughness,
        });
    }
    Some(tried)
}

/// The λ New coloring takes: one of the acceptable ones, `pick ∈ [0, 1)` choosing which, and
/// failing any, the smoothest. A random pick among the acceptable rather than the gallery's
/// nearest-to-a-preferred, because the preferred λ there was itself a rotation for variety.
pub fn choose(tried: &[Tried], pick: f64) -> Tried {
    let fine: Vec<&Tried> = tried.iter().filter(|t| t.roughness < ROUGH).collect();
    if !fine.is_empty() {
        let at = ((pick.clamp(0.0, 1.0) * fine.len() as f64) as usize).min(fine.len() - 1);
        return *fine[at];
    }
    *tried
        .iter()
        .min_by(|a, b| a.roughness.total_cmp(&b.roughness))
        .unwrap()
}

// ------------------------------------------------------------------------ the body

/// `deep-render.js`'s `bodyShare`, natively: the rows the interior component through the
/// tile's centre spans, as a share of its height, or `None` where there is nothing to
/// measure. Moved here from `builder/deep-gallery-native` so both native callers share it.
pub fn body_share(bytes: &[u8], width: usize, height: usize) -> Option<f64> {
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
        let found = twin((&re, &im), 3, (&re, &im), 3, 2, 0).unwrap();
        let s_mag = found.s[0].hypot(found.s[1]);
        let last = *found.steps.last().unwrap();
        assert!(
            last < 1e-9 * s_mag * s_mag,
            "not converged: {:?}",
            found.steps
        );
        let solved = nuclei::solve(&found.c_re, &found.c_im, 9, 2, 0.0).unwrap();
        let apart = solved
            .c_re
            .sub(&found.c_re)
            .to_f64()
            .hypot(solved.c_im.sub(&found.c_im).to_f64());
        assert!(apart < 1e-25, "shooting and Newton disagree by {apart:e}");
        let ratio = solved.size() / (s_mag * s_mag);
        assert!((0.8..1.25).contains(&ratio), "size is {ratio} of |s|²");
    }

    /// A pair: B = the main body's period-2 bulb nucleus inside the airship is period 6.
    #[test]
    fn a_pairs_twin_has_the_product_period() {
        let (re, im) = (fx("-1.7548776662466927600495088963585286918946"), fx("0"));
        let (b_re, b_im) = (fx("-1"), fx("0"));
        let found = twin((&re, &im), 3, (&b_re, &b_im), 2, 2, 0).unwrap();
        let solved = nuclei::solve(&found.c_re, &found.c_im, 6, 2, 0.0).unwrap();
        let apart = solved
            .c_re
            .sub(&found.c_re)
            .to_f64()
            .hypot(solved.c_im.sub(&found.c_im).to_f64());
        assert!(apart < 1e-25, "shooting and Newton disagree by {apart:e}");
    }

    /// A mapped landing anchored on the period-2 nucleus lands the view `(-1, 0)` on the
    /// period-6 nucleus inside the airship, and the first-order place is off it.
    #[test]
    fn a_mapped_view_on_a_nucleus_lands_on_its_twin() {
        let airship = "-1.7548776662466927600495088963585286918946";
        let anchored = mapped(
            (airship, "0", 3),
            2,
            ("-1", "0", 0.5, 1000),
            Some(("-1", "0", 2)),
        )
        .unwrap();
        assert_eq!(anchored.twin.as_ref().unwrap().0, 6);
        let n = limbs_for_landing(anchored.width);
        let solved = nuclei::solve(
            &Fx::parse(&anchored.re, n).unwrap(),
            &Fx::parse(&anchored.im, n).unwrap(),
            6,
            2,
            0.0,
        )
        .unwrap();
        let moved = solved
            .c_re
            .sub(&Fx::parse(&anchored.re, n).unwrap())
            .to_f64()
            .hypot(solved.c_im.to_f64());
        assert!(
            moved < anchored.width * 1e-6,
            "{moved:e} from the period-6 nucleus"
        );
        // The cap is three periods of the copy per count, over the width's own.
        assert_eq!(anchored.cap, cap::for_width(anchored.width).max(3000));
        // The airship is on the real axis, so its copy is turned by nothing or half a turn.
        let turn = anchored.turn.abs();
        assert!(
            turn < 1e-6 || (turn - 180.0).abs() < 1e-6,
            "turn {}",
            anchored.turn
        );
    }

    #[test]
    fn the_rung_rule_steps_down_and_respects_the_budget() {
        let one = |period, off: f64, log2, copy| Candidate {
            period,
            off_re: off,
            off_im: 0.0,
            size_log2: log2,
            copy,
        };
        // Largest first: the view's own copy, a bulb, a copy too big for thirty-two periods,
        // and one that fits.
        let found = [
            one(10, 0.0, -3.0, true),
            one(20, 0.3, -8.0, false),
            one(100_000, 0.2, -9.0, true),
            one(50_000, -0.2, -10.0, true),
        ];
        // Fresh at width 1: the first copy's frame (12.7 × 1/8) passes half the view.
        assert_eq!(pick(&found, 1.0, 2, &[], 32), Ok(3));
        // Halfway's eight periods fit the period-100,000 copy.
        assert_eq!(pick(&found, 1.0, 2, &[], 8), Ok(2));
        // A rung at the fourth copy: nothing an eighth of it is left.
        let rung = Rung {
            off_re: -0.2,
            off_im: 0.0,
            size_log2: -10.0,
        };
        assert_eq!(pick(&found, 1.0, 2, &[rung], 32), Err(Refusal::NoneSmaller));
        assert_eq!(
            pick(&found[..2], 1.0, 2, &[], 32),
            Err(Refusal::NoneSmaller)
        );
        assert_eq!(pick(&found[1..2], 1.0, 2, &[], 32), Err(Refusal::NoCopy));
        assert_eq!(
            pick(&found[..3], 1.0, 2, &[], 32),
            Err(Refusal::OverBudget { period: 100_000 })
        );
    }

    #[test]
    fn the_colouring_prefers_a_smooth_lambda() {
        // A field of smooth counts growing across a 64×36 grid: every λ is smooth at two
        // cycles, so the pick chooses among all six.
        let (w, h) = (64usize, 36usize);
        let values: Vec<f64> = (0..w * h).map(|i| 10.0 + (i % w) as f64 * 0.5).collect();
        let tried = coloring(&values, w, h, 2.0).unwrap();
        assert_eq!(tried.len(), 6);
        assert!(tried.iter().all(|t| t.roughness < ROUGH));
        assert_eq!(choose(&tried, 0.0).lambda, 0.0);
        assert_eq!(choose(&tried, 0.999).lambda, 1.0);
        // The period is the 3rd-to-97th range over the cycles, to three figures: the two
        // percentiles fall on the second and the second-to-last columns, 30.5 apart.
        let one = tried.iter().find(|t| t.lambda == 1.0).unwrap();
        assert!((one.period - 15.25).abs() <= 0.051, "period {}", one.period);
        // Too few samples is no answer.
        assert!(coloring(&[f64::NAN; 400], 20, 20, 2.0).is_none());
    }
}
