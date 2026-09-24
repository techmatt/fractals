//! The perturbation kernel the explorer will run below the `f64` floor, as a raw
//! `wasm32-unknown-unknown` module of its own.
//!
//! ```text
//! plan(spec)                              -> JSON     what this spec implies, or why not
//! reference_orbit(spec)                   -> f64 pairs one orbit, computed once per frame
//! compute_band(spec, orbit, rows)         -> f64 lane  the smooth field, NaN for interior
//! ```
//!
//! **A separate crate and a separate module, on purpose.** `engine.wasm` is the
//! shallow renderer and nothing here is linked into it: the shallow path cannot
//! be slowed, re-ordered or re-bytes by anything in this file, and a shallow
//! permalink drawn today draws the same pixels tomorrow. The two meet on the
//! page, at a buffer of `f64` lanes — this module's output is what
//! `engine.wasm`'s `smooth` band produces, in the same layout, so the existing
//! `shade_level` colours it without knowing which kernel drew it.
//!
//! **The reference orbit crosses the boundary as a buffer.** It costs a few
//! milliseconds and the frame costs seconds, so the arithmetic is not the
//! problem; the problem is that the page's workers cannot share memory — no
//! `SharedArrayBuffer`, because GitHub Pages will not send COOP/COEP — and a
//! band's `resolve` runs once per band per worker. An orbit computed inside one
//! would be computed some fifty times a frame. So [`reference_orbit`] is called
//! once, its buffer is copied out to each worker, and [`compute_band`] is handed
//! it.
//!
//! No wasm-bindgen, no dependencies at all, JS owns every buffer through
//! [`alloc`] and [`dealloc`], and the spec crosses as a JSON string — the same
//! conventions `engine-wasm` keeps, for the same reasons.
//!
//! ## What this does not do
//!
//! `z^d + c` at integer degrees two to six, on both of its planes — the Multibrot
//! set of that degree and its Julia sets — in `smooth`, and nothing else. No
//! other family has a delta recurrence written here; no other mode's channels are
//! reduced. It is not a wider engine, it is one kernel with the degree as a const
//! parameter — which is the shape the explorer's own README already said a deep
//! renderer would have to take.

use crate::fx::Fx;
use crate::json::Value;
use crate::kernel::Kernel;
use crate::reference::Reference;

pub mod fx;
pub mod json;
pub mod kernel;
pub mod nuclei;
pub mod policy;
pub mod progress;
pub mod reference;

/// The record's own version, in the same spirit as every JSONL record in this
/// repository.
pub const SCHEMA: u32 = 1;

/// Whether [`kernel::Kernel::interior`] is on when a spec does not say.
///
/// **On**, and the README carries the evidence and the caveat. Across both
/// ladders, and at every threshold from `2^-300` to `2^-4`, it never painted
/// interior a sample the plain run escaped from. What it *saves* depends
/// entirely on the view: 75% to 98% on a frame inside a minibrot, and −9% on the
/// audit's anchor, where only about seventeen periods fit inside the cap and
/// `|dz|` has no room to fall.
pub const SHIPS_INTERIOR: bool = true;

/// The fewest representable numbers one sample step may span in the delta before
/// a frame is refused. See [`Spec::delta_ulps`].
///
/// **Four, and it is the engine's own `viewport::RESOLUTION_ULPS` restated** —
/// the same shape as [`cap::for_width`], and restated for the same reason, which
/// is that this crate does not link the engine. The number says the same thing on
/// both sides of the floor: below it a picture is of the arithmetic rather than
/// of the set, and the honest answer is a sentence.
pub const DELTA_ULPS: f64 = 4.0;

// ------------------------------------------------------------------- the cap policy

/// The engine's own depth policy, continued past the point where it gives up.
///
/// `maxiter::for_width` is `BASE · (1 + PER_OCTAVE · log₂(HOME_WIDTH / width))`
/// clamped to `[FLOOR, CEILING]`, and its `CEILING` of 67,000 saturates at a
/// width of about 4.7e-16. That is fine for a renderer that refuses to go deeper
/// and wrong for one that does: every perturbation-depth view would be flattened
/// to the same cap, and a frame at 1e-28 would be a black disc.
///
/// So the shape is the engine's, restated rather than imported — this crate does
/// not link the engine — and only the ceiling moves. **Touching
/// `maxiter::for_width` itself was never an option**: it is read by
/// `spec.rs::resolve`, `MaxiterSpec::caps`, `screen.rs`, `expand.rs`, the wasm
/// `maxiter_for_width` and Python's `engine.maxiter_for`, so a wider ceiling
/// there moves the cap of every shallow picture the project has.
pub mod cap {
    /// The view width the policy is calibrated at, the engine's `HOME_WIDTH`.
    pub const HOME_WIDTH: f64 = 3.0;
    /// The engine's `BASE`.
    pub const BASE: f64 = 4000.0;
    /// The engine's `PER_OCTAVE`.
    pub const PER_OCTAVE: f64 = 0.30;
    /// The engine's `FLOOR`.
    pub const FLOOR: f64 = 200.0;
    /// **This crate's own ceiling, and it stays at a million by Matt's ruling.**
    /// The engine's is 67,000 and exists to stop a raised base being re-clipped;
    /// this one bounds how far a frame may ask. The width formula alone reaches it
    /// only at about 1e-227 — it gives 48,551 at 2e-11 and 117,518 at 1e-28 — but
    /// the probe's doublings ([`policy::next_cap`]) do reach it, and it binds on
    /// the degree-6 near-parabolic body frames, which are still a fifth the cap's
    /// fault here. The limit is kept and the page says where it binds, rather than
    /// being raised (`README.md` §10).
    pub const CEILING: f64 = 1_000_000.0;

    /// The iteration cap for a view of the given plane width.
    pub fn for_width(width: f64) -> u32 {
        if width.is_nan() || width <= 0.0 {
            return BASE as u32;
        }
        let octaves = (HOME_WIDTH / width).log2();
        let raw = BASE * (1.0 + PER_OCTAVE * octaves);
        raw.clamp(FLOOR, CEILING) as u32
    }
}

// ------------------------------------------------------------------------ the spec

/// One frame, as JSON.
///
/// The centre is **text** and stays text until it reaches [`Fx::parse`]. That is
/// the one thing this boundary exists to get right: the engine's own
/// `spec::decimal` is `str::parse::<f64>`, and at 1e-28 the digits it discards
/// are the ones that say where the view is. The width is a plain `f64` and
/// wants no more — 1e-28 is nowhere near what an exponent cannot hold, and it is
/// the *spacing between* coordinates rather than a coordinate.
#[derive(Debug, Clone)]
pub struct Spec {
    pub center_re: String,
    pub center_im: String,
    pub width: f64,
    pub resolution: [u32; 2],
    pub supersample: u32,
    /// An explicit cap, overriding [`cap::for_width`]. Unlike the engine's wasm,
    /// where this is a probe's knob and never a picture's, here it is also the
    /// escape hatch for a view whose policy cap is more than a reader will wait
    /// for.
    pub maxiter: Option<u32>,
    /// The reference point, defaulting to the view centre. A nucleus is worth
    /// naming: it makes the orbit periodic, which is both smaller and better
    /// behaved than a walk out to the cap.
    pub reference: Option<(String, String)>,
    /// The reference's period, where it is a nucleus. The orbit is then stored
    /// for one period and the index wraps instead of rebasing.
    pub period: Option<u32>,
    /// The Julia parameter: the `c` of `z ↦ z² + c`, held fixed while `z₀` is the
    /// pixel. **Absent is the Mandelbrot set**, which is what every spec written
    /// before this member existed is.
    pub julia: Option<(String, String)>,
    /// Which point of the reference orbit a Julia view's offset is taken from.
    /// No meaning without [`Spec::julia`], and refused without it.
    pub anchor: Anchor,
    pub interior: bool,
    /// The degree of `z ↦ z^d + c`, from two to six *(deep_degrees_ckpt140)*.
    /// **Absent is two**, which is what every spec written before this member
    /// existed is, and it is the one member that means the same thing on both
    /// sides of the Mandelbrot/Julia fork: the Multibrot set of degree `d` and the
    /// Julia sets of that same recurrence.
    pub degree: u32,
}

/// The point a Julia view measures its offset from, which is always a point of
/// the stored reference orbit and never an arbitrary place.
///
/// The orbit is `Z₀ = 0, Z₁ = c, Z₂ = c² + c, …` — the critical orbit of `c` —
/// and it is simultaneously the Julia orbit of `z = 0` and, shifted by one, the
/// Julia orbit of `z = c`. So both anchors are *on* it, their offsets are exact
/// fixed-point subtractions, and which one a frame uses changes nothing about
/// the mathematics: it changes only how much of the pixel step survives into
/// `f64`. See [`Spec::delta_ulps`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Anchor {
    /// `z = c`, entered at index 1. Where the filigree is.
    Parameter,
    /// `z = 0`, entered at index 0 — the critical point itself, and the one
    /// place the picture has exact two-fold symmetry.
    Origin,
}

const KNOWN: &[&str] = &[
    "schema",
    "center_re",
    "center_im",
    "width",
    "resolution",
    "supersample",
    "maxiter",
    "reference_re",
    "reference_im",
    "period",
    "julia_re",
    "julia_im",
    "anchor",
    "interior",
    "degree",
];

impl Spec {
    pub fn parse(text: &str) -> Result<Spec, String> {
        let object = json::object(text).ok_or("the spec is not a flat JSON object")?;
        if let Some(name) = object.unknown(KNOWN) {
            return Err(format!("the spec carries no member named `{name}`"));
        }
        match object.get("schema") {
            Some(Value::Num(version)) if *version == SCHEMA as f64 => {}
            Some(Value::Num(version)) => {
                return Err(format!("this module reads schema {SCHEMA}, not {version}"));
            }
            _ => return Err("the spec needs a `schema`".to_string()),
        }

        let text_of = |key: &str| -> Result<String, String> {
            match object.get(key) {
                Some(Value::Str(value)) => Ok(value.clone()),
                Some(Value::Num(_)) => Err(format!(
                    "`{key}` has to be a string: a coordinate written as a JSON number \
                     has already lost the digits this module exists for"
                )),
                _ => Err(format!("the spec needs a `{key}`")),
            }
        };
        let count_of = |key: &str| -> Option<u32> {
            match object.get(key) {
                Some(Value::Num(value)) if *value >= 1.0 && value.fract() == 0.0 => {
                    Some(*value as u32)
                }
                _ => None,
            }
        };

        let center_re = text_of("center_re")?;
        let center_im = text_of("center_im")?;
        let width = match object.get("width") {
            Some(Value::Num(value)) if *value > 0.0 && value.is_finite() => *value,
            _ => return Err("the spec needs a positive `width`".to_string()),
        };
        let resolution = match object.get("resolution") {
            Some(Value::Nums(pair)) if pair.len() == 2 && pair[0] >= 1.0 && pair[1] >= 1.0 => {
                [pair[0] as u32, pair[1] as u32]
            }
            None => [1, 1],
            _ => return Err("`resolution` is two positive integers".to_string()),
        };
        let reference = match (object.get("reference_re"), object.get("reference_im")) {
            (None, None) => None,
            _ => Some((text_of("reference_re")?, text_of("reference_im")?)),
        };
        let interior = match object.get("interior") {
            Some(Value::Bool(value)) => *value,
            None | Some(Value::Null) => SHIPS_INTERIOR,
            _ => return Err("`interior` is a boolean".to_string()),
        };
        let julia = match (object.get("julia_re"), object.get("julia_im")) {
            (None, None) => None,
            _ => Some((text_of("julia_re")?, text_of("julia_im")?)),
        };
        let anchor = match object.get("anchor") {
            None | Some(Value::Null) => Anchor::Parameter,
            Some(Value::Str(name)) if name == "parameter" => Anchor::Parameter,
            Some(Value::Str(name)) if name == "origin" => Anchor::Origin,
            Some(_) => return Err("`anchor` is \"parameter\" or \"origin\"".to_string()),
        };
        let period = count_of("period");
        let degree = match object.get("degree") {
            None | Some(Value::Null) => 2,
            Some(Value::Num(value))
                if value.fract() == 0.0 && kernel::DEGREES.contains(&(*value as u32)) =>
            {
                *value as u32
            }
            Some(_) => {
                return Err(format!(
                    "`degree` is a whole number from {} to {}: this kernel draws z^d + c at                      integer degrees and no others",
                    kernel::DEGREES.start(),
                    kernel::DEGREES.end()
                ));
            }
        };

        // Each of these three is a member that means something only on the other
        // side of the fork, and a spec that carries both is a spec whose author
        // believed something untrue about what is being drawn. Said rather than
        // ignored, for the reason every refusal in this module is a sentence.
        if julia.is_some() {
            if reference.is_some() {
                return Err(
                    "a Julia frame's reference is the critical orbit of its own \
                            `julia_re`/`julia_im`, so it cannot also be given a \
                            `reference_re`/`reference_im`"
                        .to_string(),
                );
            }
            if period.is_some() {
                return Err(
                    "`period` wraps a Mandelbrot nucleus's reference, and a Julia \
                            frame's reference is a critical orbit rather than a nucleus"
                        .to_string(),
                );
            }
        } else if object.get("anchor").is_some() {
            return Err(
                "`anchor` says which point of the Julia reference a view is offset \
                        from, and this spec has no `julia_re`"
                    .to_string(),
            );
        }

        Ok(Spec {
            center_re,
            center_im,
            width,
            resolution,
            supersample: count_of("supersample").unwrap_or(1),
            maxiter: count_of("maxiter"),
            reference,
            period,
            julia,
            anchor,
            interior,
            degree,
        })
    }

    pub fn sample_width(&self) -> u32 {
        self.resolution[0] * self.supersample
    }

    pub fn sample_height(&self) -> u32 {
        self.resolution[1] * self.supersample
    }

    pub fn plane_height(&self) -> f64 {
        self.width * (self.resolution[1] as f64 / self.resolution[0] as f64)
    }

    pub fn maxiter(&self) -> u32 {
        self.maxiter.unwrap_or_else(|| cap::for_width(self.width))
    }

    /// The limb count this frame's reference orbit is computed at.
    ///
    /// The view's own rule everywhere but one place: **a Julia frame anchored at
    /// `z = 0` is sized for `step^d`**, because its first step raises the pixel
    /// offset to the degree and the orbit has to tell two of those apart. See
    /// [`reference::limbs_pow`], which is where the measurement is.
    pub fn limbs(&self) -> usize {
        reference::limbs_pow(self.width, self.sample_width(), self.limb_power())
    }

    /// The power of the sample step the reference has to resolve: the degree at
    /// the Julia origin anchor, where `z₁ = z₀^d + c`, and one everywhere else.
    fn limb_power(&self) -> u32 {
        match (&self.julia, self.anchor) {
            (Some(_), Anchor::Origin) => self.degree,
            _ => 1,
        }
    }

    /// Whether [`Spec::limbs`] holds every bit the frame needs, rather than stopping
    /// at [`fx::MAX_LIMBS`]. Only the origin anchor can reach the clamp at a width a
    /// double still holds.
    pub fn limbs_fit(&self) -> bool {
        reference::limbs_pow_fits(self.width, self.sample_width(), self.limb_power())
    }

    /// The reference orbit this spec asks for.
    ///
    /// **A Julia frame's is the critical orbit of its own parameter** — `Z₀ = 0,
    /// Z₁ = c, Z₂ = c² + c, …`, which is byte for byte the orbit a Mandelbrot
    /// frame centred at that `c` computes. That is the whole reason the jump
    /// costs nothing: the workers are already holding it.
    pub fn reference_orbit(&self) -> Result<Reference, String> {
        let limbs = self.limbs();
        let (re, im) = match (&self.julia, &self.reference) {
            (Some((re, im)), _) => (re.as_str(), im.as_str()),
            (None, Some((re, im))) => (re.as_str(), im.as_str()),
            (None, None) => (self.center_re.as_str(), self.center_im.as_str()),
        };
        let c_re = Fx::parse(re, limbs).ok_or_else(|| format!("`{re}` is not a decimal"))?;
        let c_im = Fx::parse(im, limbs).ok_or_else(|| format!("`{im}` is not a decimal"))?;
        // A view entered at `Z₁` has one step less of reference in front of it
        // than one entered at `Z₀`, so it asks for one more point rather than
        // rebasing a step early.
        let steps = self.maxiter() + self.entry() as u32;
        Ok(reference::orbit_of(
            self.degree,
            &c_re,
            &c_im,
            steps,
            self.period,
        ))
    }

    /// The index of the stored orbit a sample's delta starts against.
    ///
    /// One for a Julia view anchored at `z = c`, because `Z₁ = c`; zero for
    /// everything else, `Z₀ = 0` being both the Mandelbrot start and the Julia
    /// orbit of the critical point.
    pub fn entry(&self) -> usize {
        matches!((&self.julia, self.anchor), (Some(_), Anchor::Parameter)) as usize
    }

    /// The point a sample's delta is measured from: the Julia view's anchor, the
    /// named Mandelbrot reference, or the view centre itself.
    fn offset_from(&self) -> Option<(&str, &str)> {
        match (&self.julia, self.anchor) {
            (Some(_), Anchor::Origin) => Some(("0", "0")),
            (Some((re, im)), Anchor::Parameter) => Some((re.as_str(), im.as_str())),
            (None, _) => self
                .reference
                .as_ref()
                .map(|(re, im)| (re.as_str(), im.as_str())),
        }
    }

    /// How far the view centre is from the point the delta is measured from, in
    /// `f64`, taken in fixed point.
    ///
    /// **Never `f64(center) − f64(reference)`.** At the depths this crate is for,
    /// those two are the same `f64` and the difference is exactly zero — which
    /// would draw the reference's own neighbourhood wherever the view actually
    /// is, and look entirely plausible.
    pub fn centre_offset(&self) -> Result<(f64, f64), String> {
        let Some((re, im)) = self.offset_from() else {
            return Ok((0.0, 0.0));
        };
        let limbs = self.limbs();
        let parse =
            |text: &str| Fx::parse(text, limbs).ok_or_else(|| format!("`{text}` is not a decimal"));
        Ok((
            parse(&self.center_re)?.sub(&parse(re)?).to_f64(),
            parse(&self.center_im)?.sub(&parse(im)?).to_f64(),
        ))
    }

    /// How many representable numbers one sample step spans, in the `f64` the
    /// delta starts from.
    ///
    /// **This is the engine's own `resolution_ulps` asked of a different
    /// number.** There the question is whether two neighbouring sample centres
    /// are the same `f64` coordinate; here the coordinates are exact decimals
    /// and it is the *delta* that is a double — the offset from the anchor plus
    /// the pixel's own geometry. A view a long way from its anchor at a width far
    /// below it has an offset whose last bit is coarser than the whole frame, and
    /// every pixel of it would start from the same delta: one flat picture, drawn
    /// with total confidence. [`DELTA_ULPS`] is what that is refused against.
    ///
    /// Infinite where the offset is exactly zero, which is every view centred on
    /// its anchor — including, always, a Mandelbrot frame referenced at its own
    /// centre.
    pub fn delta_ulps(&self) -> f64 {
        let (re, im) = match self.centre_offset() {
            Ok(offset) => offset,
            Err(_) => return f64::INFINITY,
        };
        let far = re.abs().max(im.abs());
        if !(far > 0.0) {
            return f64::INFINITY;
        }
        (self.width / self.sample_width() as f64) / (far.next_up() - far)
    }

    /// `dc` for sample cell `(col, row)` of the supersampled grid — and, for a
    /// Julia frame, the same number under its other name, `δ₀`.
    ///
    /// The geometry is the engine's `Viewport::sample_point`, offset by the
    /// reference rather than added to the centre: row 0 is the top of the image
    /// and so the largest imaginary part, which is why the vertical term is
    /// subtracted.
    ///
    /// **One expression, two jobs, and that is the shape of the whole Julia
    /// case.** For Mandelbrot this is the sample's distance from the reference
    /// *parameter*, and it enters every step of the recurrence; for Julia it is
    /// the sample's distance from the anchor *point*, and it enters once, as the
    /// delta the loop starts from.
    pub fn dc(&self, offset: (f64, f64), col: u32, row: u32) -> (f64, f64) {
        let across = (col as f64 + 0.5) / self.sample_width() as f64 - 0.5;
        let down = 0.5 - (row as f64 + 0.5) / self.sample_height() as f64;
        (
            offset.0 + across * self.width,
            offset.1 + down * self.plane_height(),
        )
    }
}

// --------------------------------------------------------------------- the band

/// The smooth field for sample rows `[first, last)`, as little-endian `f64`.
///
/// One lane, `NaN` for interior — what `engine.wasm`'s `compute_band` produces
/// for `smooth`, in the layout it produces it, so the page's existing
/// `shade_level` colours this without being told which kernel drew it.
///
/// **It is not narrowed through `f32`.** The engine rounds every inexact lane to
/// `f32` on the way out, because that is what a dumped field stores and the
/// picture wanted is the one the pipeline draws. At this depth that rounding is
/// visible: the `f32` step at a smooth count of 65,000 is about 0.008 and at
/// 1,000,000 about 0.06, and the percentile stretch downstream would band on it.
/// The offset is per-frame and the stretch ignores a constant, so the fix is
/// available — but it belongs to whoever puts a picture on a page, and until
/// then this hands over everything it computed.
pub fn compute_rows(spec: &Spec, orbit: &Reference, first: u32, last: u32) -> Vec<u8> {
    let kernel = Kernel::new(orbit, spec.maxiter(), spec.interior).at_entry(spec.entry());
    let offset = spec.centre_offset().unwrap_or((0.0, 0.0));
    let width = spec.sample_width();
    let mut bytes = Vec::with_capacity(((last - first) * width) as usize * 8);
    // The fork is taken once for the band rather than once for each of its
    // samples: the loops are the same text and different monomorphizations, one
    // per set and degree, which is what keeps the degree-2 Mandelbrot loop
    // exactly the loop it was.
    macro_rules! fill_at {
        ($d:literal, $julia:literal) => {
            fill::<$d, $julia>(spec, &kernel, offset, first, last, &mut bytes)
        };
    }
    match (spec.degree, spec.julia.is_some()) {
        (2, false) => fill_at!(2, false),
        (2, true) => fill_at!(2, true),
        (3, false) => fill_at!(3, false),
        (3, true) => fill_at!(3, true),
        (4, false) => fill_at!(4, false),
        (4, true) => fill_at!(4, true),
        (5, false) => fill_at!(5, false),
        (5, true) => fill_at!(5, true),
        (6, false) => fill_at!(6, false),
        (6, true) => fill_at!(6, true),
        // `Spec::parse` refuses any other degree in a sentence, and a `Spec` built
        // by hand with one draws nothing rather than drawing the wrong set.
        _ => {}
    }
    bytes
}

fn fill<const D: usize, const JULIA: bool>(
    spec: &Spec,
    kernel: &Kernel,
    offset: (f64, f64),
    first: u32,
    last: u32,
    bytes: &mut Vec<u8>,
) {
    let width = spec.sample_width();
    for row in first..last {
        for col in 0..width {
            let (re, im) = spec.dc(offset, col, row);
            let outcome = kernel.sample_with::<D, JULIA>(re, im);
            bytes.extend_from_slice(&outcome.smooth.to_le_bytes());
        }
    }
}

// ------------------------------------------------------------------- the exports

/// Bytes of header on the reference buffer, before the orbit's `f64` pairs.
///
/// Sixteen rather than the twelve the fields need, so the pairs start `f64`
/// aligned: a `DataView` on the JavaScript side does not care, and a
/// `Float64Array` view over the same bytes does.
pub const REFERENCE_HEADER: usize = 16;

/// Pack a reference orbit for the boundary: `count`, flags, the period residual,
/// then `count` interleaved `(re, im)` pairs.
pub fn pack_reference(orbit: &Reference) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(REFERENCE_HEADER + orbit.len() * 16);
    bytes.extend_from_slice(&(orbit.len() as u32).to_le_bytes());
    let flags = (orbit.escaped as u32) | ((orbit.periodic as u32) << 1);
    bytes.extend_from_slice(&flags.to_le_bytes());
    bytes.extend_from_slice(&orbit.period_residual.to_le_bytes());
    for [re, im] in &orbit.points {
        bytes.extend_from_slice(&re.to_le_bytes());
        bytes.extend_from_slice(&im.to_le_bytes());
    }
    bytes
}

/// Read back what [`pack_reference`] wrote.
pub fn unpack_reference(bytes: &[u8]) -> Option<Reference> {
    if bytes.len() < REFERENCE_HEADER || (bytes.len() - REFERENCE_HEADER) % 16 != 0 {
        return None;
    }
    let count = u32::from_le_bytes(bytes[0..4].try_into().ok()?) as usize;
    if count == 0 || (bytes.len() - REFERENCE_HEADER) / 16 != count {
        return None;
    }
    let flags = u32::from_le_bytes(bytes[4..8].try_into().ok()?);
    let period_residual = f64::from_le_bytes(bytes[8..16].try_into().ok()?);
    let mut points = Vec::with_capacity(count);
    for index in 0..count {
        let at = REFERENCE_HEADER + index * 16;
        points.push([
            f64::from_le_bytes(bytes[at..at + 8].try_into().ok()?),
            f64::from_le_bytes(bytes[at + 8..at + 16].try_into().ok()?),
        ]);
    }
    Some(Reference {
        points,
        escaped: flags & 1 != 0,
        periodic: flags & 2 != 0,
        period_residual,
        // The limb count is the reference's own history and no part of how it is
        // read; the kernel never asks.
        limbs: 0,
    })
}

/// What this spec implies, or why it cannot be drawn, as JSON.
///
/// Returns a buffer whose first four bytes are the UTF-8 length, little-endian —
/// `engine-wasm`'s convention, so a page that already speaks to one module
/// speaks to this one.
#[unsafe(no_mangle)]
pub extern "C" fn plan(spec_ptr: *const u8, spec_len: usize) -> *mut u8 {
    let read = text(spec_ptr, spec_len)
        .ok_or_else(|| "the spec is not UTF-8".to_string())
        .and_then(|text| Spec::parse(&text));
    report(read.and_then(|spec| if spec.limbs_fit() {
        Ok(spec)
    } else {
        Err(format!(
            "this frame is drawn from z = 0, where one pixel of it is told apart from the next \
             only at its width to the power {}, and that needs more than the {} limbs this \
             module computes a reference at. Zoom out, or move toward z = c.",
            spec.limb_power(),
            fx::MAX_LIMBS,
        ))
    }).and_then(|spec| match spec.delta_ulps() {
        ulps if ulps >= DELTA_ULPS => Ok(spec),
        ulps => Err(format!(
            "this frame is {} from the point its arithmetic is anchored at, and one pixel of it \
             spans {:.2} of the numbers a double has left there — fewer than the {} it takes to \
             tell two pixels apart. Every sample would start from the same delta and the picture \
             would be flat. Zoom out, or move back toward the anchor.",
            if spec.julia.is_some() {
                "too far"
            } else {
                "too far from its reference"
            },
            ulps,
            DELTA_ULPS,
        )),
    }).map(|spec| {
        format!(
            concat!(
                r#"{{"ok":true,"maxiter":{},"limbs":{},"fraction_bits":{},"#,
                r#""sample_width":{},"sample_height":{},"interior":{},"#,
                r#""julia":{},"anchor":"{}","degree":{},"delta_ulps":{},"#,
                r#""reference_bytes":{},"ceiling":{}}}"#
            ),
            spec.maxiter(),
            spec.limbs(),
            64 * (spec.limbs() - 1),
            spec.sample_width(),
            spec.sample_height(),
            spec.interior,
            spec.julia.is_some(),
            match spec.anchor {
                Anchor::Parameter => "parameter",
                Anchor::Origin => "origin",
            },
            spec.degree,
            // `null` rather than `inf`, which is not JSON — and infinite is the
            // ordinary case, an offset of exactly zero.
            match json::finite(spec.delta_ulps()) {
                Some(ulps) => format!("{ulps:.3}"),
                None => "null".to_string(),
            },
            REFERENCE_HEADER
                + 16 * match spec.period {
                    Some(period) => period as usize,
                    None => spec.maxiter() as usize + 1 + spec.entry(),
                },
            cap::CEILING as u32,
        )
    }))
}

/// The reference orbit for this spec: **once per frame**, and handed to the
/// workers as a buffer.
///
/// Null on a spec that will not parse; the caller has already had the sentence
/// from [`plan`]. The buffer's first four bytes are the orbit's length in points,
/// so a caller can size it before reading it: `16 + 16 * count` bytes in all.
#[unsafe(no_mangle)]
pub extern "C" fn reference_orbit(spec_ptr: *const u8, spec_len: usize) -> *mut u8 {
    let Some(spec) = text(spec_ptr, spec_len).and_then(|text| Spec::parse(&text).ok()) else {
        return std::ptr::null_mut();
    };
    let Ok(orbit) = spec.reference_orbit() else {
        return std::ptr::null_mut();
    };
    release(pack_reference(&orbit))
}

/// Compute output rows `[row_start, row_end)`, as little-endian `f64`.
///
/// A band is a range of **output** rows, as it is in `engine.wasm`: at one sample
/// per pixel the two are the same range, and above it a band is the `supersample`
/// sample rows that reduce to those output rows. The coordinates are formed from
/// the whole viewport with a global row index, so a band is bit for bit the rows
/// a whole-frame pass would have produced.
///
/// The orbit buffer is **borrowed, not taken** — the caller keeps it for the next
/// band, which is the entire reason it crosses the boundary at all.
#[unsafe(no_mangle)]
pub extern "C" fn compute_band(
    spec_ptr: *const u8,
    spec_len: usize,
    orbit_ptr: *const u8,
    orbit_len: usize,
    row_start: u32,
    row_end: u32,
) -> *mut u8 {
    let Some(spec) = text(spec_ptr, spec_len).and_then(|text| Spec::parse(&text).ok()) else {
        return std::ptr::null_mut();
    };
    if row_end > spec.resolution[1] || row_start >= row_end || orbit_ptr.is_null() {
        return std::ptr::null_mut();
    }
    let bytes = unsafe { std::slice::from_raw_parts(orbit_ptr, orbit_len) };
    let Some(orbit) = unpack_reference(bytes) else {
        return std::ptr::null_mut();
    };
    let ss = spec.supersample;
    release(compute_rows(&spec, &orbit, row_start * ss, row_end * ss))
}

// ------------------------------------------------- the minibrots in and around a view

/// One band of the atom-domain walk: the nuclei whose domains these probe rows
/// fall in.
///
/// **A band, for [`probe_band`]'s reason**, and the two are cut the same way over
/// the same grid: the walk runs to the escape or to the cap with no interior
/// shortcut, so on a frame that is mostly inside a minibrot it is seconds on one
/// worker and well under one over the pool. The orbit is **borrowed**, and it is
/// the frame's own.
///
/// Returns `{"ok":true,"seeds":[{"period":…,"from_re":…,"from_im":…,"minimum":…,
/// "cells":…}]}`, the offsets being **from the view centre**, which the page merges across bands by period — `cells` adds
/// and the smallest `minimum` wins, which is what [`nuclei::seeds`] does within
/// one.
#[unsafe(no_mangle)]
#[allow(clippy::too_many_arguments)]
pub extern "C" fn seed_band(
    spec_ptr: *const u8,
    spec_len: usize,
    orbit_ptr: *const u8,
    orbit_len: usize,
    cols: u32,
    rows: u32,
    row_start: u32,
    row_end: u32,
) -> *mut u8 {
    let read = text(spec_ptr, spec_len)
        .ok_or_else(|| "the spec is not UTF-8".to_string())
        .and_then(|text| Spec::parse(&text))
        .and_then(|spec| {
            if orbit_ptr.is_null() {
                return Err("no reference orbit".to_string());
            }
            let bytes = unsafe { std::slice::from_raw_parts(orbit_ptr, orbit_len) };
            let orbit = unpack_reference(bytes).ok_or("the reference orbit is malformed")?;
            let cols = if cols == 0 { nuclei::GRID_COLS } else { cols };
            let rows = if rows == 0 { nuclei::GRID_ROWS } else { rows };
            Ok(nuclei::seeds_in_rows(
                &spec, &orbit, cols, rows, row_start, row_end,
            ))
        });
    report(read.map(|seeds| {
        let mut body = String::from(r#"{"ok":true,"seeds":["#);
        for (index, seed) in seeds.iter().enumerate() {
            if index > 0 {
                body.push(',');
            }
            body.push_str(&format!(
                r#"{{"period":{},"from_re":{:e},"from_im":{:e},"minimum":{:e},"cells":{}}}"#,
                seed.period, seed.from_re, seed.from_im, seed.minimum, seed.cells,
            ));
        }
        body.push_str("]}");
        body
    }))
}

/// One Newton step on `z_p(c) = 0`, from a `c` that arrives as text and leaves
/// as text.
///
/// **One step a call, and that is the cancel granularity.** A wasm call cannot be
/// interrupted, and a step at a period of a hundred thousand is a tenth of a
/// second; the page drives the iteration so that a new search or a navigation
/// stops between steps rather than not at all.
///
/// **The `c` that comes back is the full decimal of what is stored**, all
/// `64(limbs−1)` digits of it, because the page feeds it straight back in as the
/// next step's input and a truncation there would be precision thrown away once
/// a step. `explorer/deep-link.js` is what trims a centre to what a link can
/// carry, and it happens once, at the end.
///
/// Takes `{"c_re":"…","c_im":"…","period":n,"limbs":k}` and returns
/// `{"ok":true,"c_re":"…","c_im":"…","moved":…,"size_log2":…,"window_log2":…,
/// "escaped":false}`.
#[unsafe(no_mangle)]
pub extern "C" fn newton_step(request_ptr: *const u8, request_len: usize) -> *mut u8 {
    const KNOWN: &[&str] = &["c_re", "c_im", "period", "limbs", "degree"];
    let read = text(request_ptr, request_len)
        .ok_or_else(|| "the request is not UTF-8".to_string())
        .and_then(|text| {
            let object = json::object(&text).ok_or("the request is not a flat JSON object")?;
            if let Some(name) = object.unknown(KNOWN) {
                return Err(format!("the request carries no member named `{name}`"));
            }
            let count = |key: &str| match object.get(key) {
                Some(json::Value::Num(value)) if *value >= 1.0 && value.fract() == 0.0 => {
                    Ok(*value as u32)
                }
                _ => Err(format!("`{key}` is a whole number of at least one")),
            };
            let coordinate = |key: &str| match object.get(key) {
                Some(json::Value::Str(value)) => Ok(value.clone()),
                _ => Err(format!(
                    "`{key}` has to be a string: a coordinate written as a JSON number has \
                     already lost the digits this module exists for"
                )),
            };
            let limbs = (count("limbs")? as usize).clamp(3, fx::MAX_LIMBS);
            let period = count("period")?;
            // Absent is two, as it is in a spec.
            let degree = match object.get("degree") {
                None => 2,
                Some(_) => match count("degree") {
                    Ok(degree) if kernel::DEGREES.contains(&degree) => degree,
                    _ => return Err("`degree` is a whole number from 2 to 6".to_string()),
                },
            };
            let re_text = coordinate("c_re")?;
            let im_text = coordinate("c_im")?;
            let c_re = Fx::parse(&re_text, limbs)
                .ok_or_else(|| format!("`{re_text}` is not a decimal"))?;
            let c_im = Fx::parse(&im_text, limbs)
                .ok_or_else(|| format!("`{im_text}` is not a decimal"))?;
            Ok((nuclei::newton_step(&c_re, &c_im, period, degree), limbs))
        });
    report(read.map(|(step, limbs)| {
        let digits = 64 * (limbs - 1);
        format!(
            concat!(
                r#"{{"ok":true,"c_re":"{}","c_im":"{}","moved":{:e},"#,
                r#""size_log2":{:e},"window_log2":{:e},"escaped":{}}}"#
            ),
            step.c_re.to_decimal(digits),
            step.c_im.to_decimal(digits),
            finite(step.moved),
            finite(step.size_log2),
            finite(step.window_log2),
            step.escaped,
        )
    }))
}

/// The limb count a nucleus found in a view of this width is solved at, so the
/// page does not restate the rule. See [`nuclei::limbs_for_nucleus`].
#[unsafe(no_mangle)]
pub extern "C" fn nucleus_limbs(width: f64, tile_samples: u32, degree: u32) -> u32 {
    // A caller that passes no degree passes zero, which is two.
    let degree = if kernel::DEGREES.contains(&degree) {
        degree
    } else {
        2
    };
    nuclei::limbs_for_nucleus(width, tile_samples, degree) as u32
}

/// The cap a preview tile of a period-`p` nucleus is drawn at.
///
/// **The page asks rather than restates**, because this one is not the width
/// policy and a page that guessed it would draw a black rectangle: see
/// [`nuclei::TILE_PERIODS`], which is where the measurement is.
#[unsafe(no_mangle)]
pub extern "C" fn tile_cap(period: u32, width: f64) -> u32 {
    nuclei::tile_cap(period, width)
}

/// The cap an opened minibrot of period `p` is drawn at, and the `n` its link
/// carries — four times a tile's periods. See [`nuclei::OPEN_PERIODS`].
#[unsafe(no_mangle)]
pub extern "C" fn open_cap(period: u32, width: f64) -> u32 {
    nuclei::open_cap(period, width)
}

/// How wide a preview tile is, given the body it frames. See
/// [`nuclei::TILE_BODIES`].
#[unsafe(no_mangle)]
pub extern "C" fn tile_width(size: f64) -> f64 {
    size * nuclei::TILE_BODIES
}

/// What [`newton_step`] means by a number JSON cannot carry: a step that did not
/// move.
///
/// [`json::finite`] is where the rule that `NaN` and the infinities are not JSON
/// lives; the answer is here because it is this export's and not `plan`'s, which
/// says `null` to the same question.
fn finite(value: f64) -> f64 {
    json::finite(value).unwrap_or(0.0)
}

/// This crate's cap policy, so a page does not restate it.
#[unsafe(no_mangle)]
pub extern "C" fn maxiter_for_width(width: f64) -> u32 {
    cap::for_width(width)
}

/// The limb count a view of this width and this many samples across is computed
/// at — the one number that says how much the reference orbit will cost.
#[unsafe(no_mangle)]
pub extern "C" fn limbs_for_width(width: f64, sample_width: u32) -> u32 {
    reference::limbs_for(width, sample_width) as u32
}

// -------------------------------------------------------------- the cap the frame asks for

/// One band of one rung of the cap policy: what died at this spec's cap, and how.
///
/// **A band, for a band's reason.** The probe is a few thousand of the frame's
/// own sample cells at whatever cap is being tried, and on the frames that want
/// four rungs the deepest of them is seconds; cut into row ranges it is spread
/// over the same pool a field is and a reader can cancel between rungs. See
/// [`policy`] for what the three kinds of cap-death are and why only one of them
/// is the cap's fault.
///
/// The orbit is **borrowed, not taken**, exactly as [`compute_band`] borrows it,
/// and it is the orbit for *this rung's* cap. `cols` and `rows` are the probe
/// grid — the page names its own, since how finely to probe is a cost the pool
/// pays; zero takes [`policy::PROBE_COLS`] and [`policy::PROBE_ROWS`].
///
/// Returns the same length-prefixed JSON [`plan`] does.
#[unsafe(no_mangle)]
#[allow(clippy::too_many_arguments)]
pub extern "C" fn probe_band(
    spec_ptr: *const u8,
    spec_len: usize,
    orbit_ptr: *const u8,
    orbit_len: usize,
    cols: u32,
    rows: u32,
    row_start: u32,
    row_end: u32,
) -> *mut u8 {
    let read = text(spec_ptr, spec_len)
        .ok_or_else(|| "the spec is not UTF-8".to_string())
        .and_then(|text| Spec::parse(&text))
        .and_then(|spec| {
            if orbit_ptr.is_null() {
                return Err("no reference orbit".to_string());
            }
            let bytes = unsafe { std::slice::from_raw_parts(orbit_ptr, orbit_len) };
            let orbit = unpack_reference(bytes).ok_or("the reference orbit is malformed")?;
            let cols = if cols == 0 { policy::PROBE_COLS } else { cols };
            let rows = if rows == 0 { policy::PROBE_ROWS } else { rows };
            Ok(policy::probe_rows(
                &spec, &orbit, cols, rows, row_start, row_end,
            ))
        });
    report(read.map(|counts| {
        format!(
            concat!(
                r#"{{"ok":true,"maxiter":{},"samples":{},"escaped":{},"proven":{},"#,
                r#""starved":{},"fault":{},"iterations":{}}}"#
            ),
            counts.maxiter,
            counts.samples,
            counts.escaped,
            counts.proven,
            counts.starved,
            counts.fault,
            counts.iterations,
        )
    }))
}

/// The share of a frame that may still be the cap's fault before the cap is
/// raised. [`policy::FAULT_SHARE`], so that the threshold is written once and
/// the page compares against it rather than restating it.
#[unsafe(no_mangle)]
pub extern "C" fn fault_share() -> f64 {
    policy::FAULT_SHARE
}

/// The next cap to try after one that did not resolve the frame, saturating at
/// [`cap::CEILING`]. [`policy::next_cap`].
#[unsafe(no_mangle)]
pub extern "C" fn next_cap(maxiter: u32) -> u32 {
    policy::next_cap(maxiter)
}

// ------------------------------------------------------------------ the buffers

/// Lend the module `len` bytes. JavaScript owns them until it says otherwise.
#[unsafe(no_mangle)]
pub extern "C" fn alloc(len: usize) -> *mut u8 {
    let mut buffer = Vec::<u8>::with_capacity(len);
    let pointer = buffer.as_mut_ptr();
    std::mem::forget(buffer);
    pointer
}

/// Take back what [`alloc`] lent, or what an export returned.
///
/// # Safety
/// `ptr` and `len` are a pair this module handed out and has not already taken
/// back.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn dealloc(ptr: *mut u8, len: usize) {
    if !ptr.is_null() {
        drop(unsafe { Vec::from_raw_parts(ptr, len, len) });
    }
}

/// A borrowed UTF-8 buffer, as a `String` this module owns.
fn text(ptr: *const u8, len: usize) -> Option<String> {
    if ptr.is_null() {
        return None;
    }
    let bytes = unsafe { std::slice::from_raw_parts(ptr, len) };
    core::str::from_utf8(bytes).ok().map(str::to_string)
}

/// Hand a buffer to JavaScript, which frees it through [`dealloc`].
fn release(bytes: Vec<u8>) -> *mut u8 {
    let mut bytes = bytes;
    bytes.shrink_to_fit();
    let pointer = bytes.as_mut_ptr();
    std::mem::forget(bytes);
    pointer
}

/// **What every export that answers with a sentence hands back**: the report it
/// produced, or the refusal, as length-prefixed JSON.
///
/// Four exports answer this way — [`plan`], [`probe_band`], [`seed_band`] and
/// [`newton_step`] — and each used to carry its own `{"ok":false,"why":…}` arm
/// *(deep_refactor_ckpt138)*. One of them was going to get it subtly wrong: the
/// page reads `ok` before anything else, so a refusal missing that field is a
/// report the tab treats as an answer. The shape is written once here, and a
/// fifth export gets it by construction.
fn report(answer: Result<String, String>) -> *mut u8 {
    release_text(&match answer {
        Ok(body) => body,
        Err(why) => format!(r#"{{"ok":false,"why":{}}}"#, json::quote(&why)),
    })
}

/// The same, for text: four bytes of little-endian length, then the UTF-8.
fn release_text(text: &str) -> *mut u8 {
    let mut bytes = Vec::with_capacity(4 + text.len());
    bytes.extend_from_slice(&(text.len() as u32).to_le_bytes());
    bytes.extend_from_slice(text.as_bytes());
    release(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    const ANCHOR: &str = r#"{
        "schema": 1,
        "center_re": "-0.74501772828532335842941892835857434",
        "center_im": "0.14993443275456819177805709088257971",
        "width": 2e-11,
        "resolution": [480, 270]
    }"#;

    #[test]
    fn the_anchor_spec_reads_and_implies_the_audits_numbers() {
        let spec = Spec::parse(ANCHOR).unwrap();
        assert_eq!(spec.sample_width(), 480);
        assert_eq!(spec.limbs(), 3);
        assert_eq!(spec.interior, SHIPS_INTERIOR);
        // The audit's depth-aware policy gave 48,551 for this view, and the
        // engine's own formula is what that policy is.
        assert_eq!(spec.maxiter(), 48_551);
    }

    #[test]
    fn the_ceiling_is_this_crates_and_the_shape_is_the_engines() {
        // Where the engine still answers, the two agree.
        assert_eq!(cap::for_width(3.0), 4000);
        assert_eq!(cap::for_width(1.5), 5200);
        // Past the engine's ceiling this one keeps going.
        assert!(cap::for_width(1e-16) > 67_000);
        assert_eq!(cap::for_width(1e-28), 117_518);
        assert_eq!(cap::for_width(1e-300), cap::CEILING as u32);
        assert_eq!(cap::for_width(1e30), cap::FLOOR as u32);
    }

    #[test]
    fn an_unknown_member_is_refused_rather_than_ignored() {
        let text = ANCHOR.replace("supersample", "ss").replace(
            r#""resolution": [480, 270]"#,
            r#""resolution": [480, 270], "deep": true"#,
        );
        let why = Spec::parse(&text).unwrap_err();
        assert!(why.contains("`deep`"), "{why}");
    }

    #[test]
    fn a_centre_written_as_a_number_is_refused_by_name() {
        let text = ANCHOR.replace(
            r#""-0.74501772828532335842941892835857434""#,
            "-0.74501772828532335842941892835857434",
        );
        let why = Spec::parse(&text).unwrap_err();
        assert!(why.contains("has to be a string"), "{why}");
    }

    #[test]
    fn the_centre_offset_is_taken_in_fixed_point_and_not_in_f64() {
        let text = ANCHOR.replace(
            r#""resolution": [480, 270]"#,
            r#""resolution": [480, 270],
               "reference_re": "-0.74501772828532335842941892835857000",
               "reference_im": "0.14993443275456819177805709088257971""#,
        );
        let spec = Spec::parse(&text).unwrap();
        let (dx, dy) = spec.centre_offset().unwrap();
        assert_eq!(dy, 0.0);
        // Three limbs truncate at 2^-128, which is 2.9e-39 — six orders below
        // the offset and twenty-five below the sample spacing this view has.
        assert!((dx + 4.34e-33).abs() < 1e-38, "offset was {dx:e}");
        // The same subtraction the engine would have done.
        let narrowed =
            -0.74501772828532335842941892835857434f64 - -0.74501772828532335842941892835857000f64;
        assert_eq!(narrowed, 0.0);
    }

    /// The geometry has to be the engine's, or a deep frame would be off by half
    /// a pixel from every shallow one.
    #[test]
    fn the_sample_grid_is_the_engines() {
        let spec = Spec::parse(ANCHOR).unwrap();
        let (left, _) = spec.dc((0.0, 0.0), 0, 0);
        let (right, _) = spec.dc((0.0, 0.0), 479, 0);
        let spacing = spec.width / 480.0;
        assert!(
            (left + right).abs() < spacing * 1e-12,
            "the grid is not centred: {left:e} and {right:e}"
        );
        let (_, top) = spec.dc((0.0, 0.0), 0, 0);
        let (_, bottom) = spec.dc((0.0, 0.0), 0, 269);
        assert!(top > 0.0 && bottom < 0.0, "row 0 is not the top");
        assert!(((right - left) - spacing * 479.0).abs() < spacing * 1e-12);
    }

    #[test]
    fn a_reference_buffer_round_trips() {
        let spec = Spec::parse(ANCHOR).unwrap();
        let orbit = spec.reference_orbit().unwrap();
        let packed = pack_reference(&orbit);
        let back = unpack_reference(&packed).unwrap();
        assert_eq!(back.len(), orbit.len());
        assert_eq!(back.points[17], orbit.points[17]);
        assert_eq!(back.escaped, orbit.escaped);
        assert_eq!(back.periodic, orbit.periodic);
        assert_eq!(packed.len(), REFERENCE_HEADER + 16 * orbit.len());
        assert!(unpack_reference(&packed[..packed.len() - 1]).is_none());
        assert!(unpack_reference(&[]).is_none());
    }

    /// The cases the two pins below read: the engine's own output, written by
    /// `scratch/perturb_validate cases` and committed beside this file, standing
    /// in for a dependency on the engine crate.
    fn engine_cases() -> json::Object {
        json::object(include_str!("../smooth-cases.json"))
            .expect("smooth-cases.json is a flat object")
    }

    fn numbers<'a>(cases: &'a json::Object, key: &str) -> &'a [f64] {
        match cases.get(key) {
            Some(Value::Nums(values)) => values,
            _ => panic!("smooth-cases.json has no `{key}`"),
        }
    }

    /// **The formula, pinned bit for bit.**
    ///
    /// `smooth_count` is restated in this crate rather than imported, so the
    /// thing that has to be held to the engine is the closed form and not a
    /// whole render. These cases are the engine's own `(escape step, |z|² at it,
    /// smooth)` triples, read off `Orbit`, so the comparison iterates nothing
    /// and there is nowhere for a difference in arithmetic to hide: an exact
    /// equality is the right assertion and it holds.
    #[test]
    fn the_smooth_formula_is_the_engines_to_the_last_bit() {
        let cases = engine_cases();
        let step = numbers(&cases, "step");
        let magnitude_sq = numbers(&cases, "magnitude_sq");
        let expected = numbers(&cases, "formula");
        assert!(step.len() >= 100, "only {} cases", step.len());
        for index in 0..step.len() {
            let ours = kernel::smooth_count(step[index] as u32, magnitude_sq[index]);
            assert_eq!(
                ours, expected[index],
                "case {index}: step {}, |z|² {:e}",
                step[index], magnitude_sq[index]
            );
        }
    }

    /// **The field, pinned by its distribution — and the distribution is the
    /// engine's error, not this kernel's.**
    ///
    /// The same cases as a whole frame: every sample the engine drew, drawn again
    /// by this kernel. The interior mask is identical and has to be. The smooth
    /// counts are held to a *share* rather than to a worst case, and
    /// `tests/probe.rs` says why: run the same 311 escaping samples against a
    /// 384-bit oracle and **this kernel is nearer the truth on 307 of them and
    /// the plain `f64` loop on 4**. The ~7% that differ by more than 1e-6 are
    /// samples where `f64` has accumulated a visible error over a few thousand
    /// iterations — the audit's own finding that fidelity fails far above the
    /// coordinate wall — so tightening this assertion would be pinning the kernel
    /// to a field that is wrong.
    ///
    /// **Not one of the 311 is bit-equal**, and that is the expected answer
    /// rather than a surprise: the two loops do different arithmetic in a
    /// different order, escape counts here run to thousands, and the last place
    /// of a `f64` parts company long before that. Bit-equality has one right home
    /// and it is the closed form above.
    #[test]
    fn the_smooth_field_matches_the_engines_committed_cases() {
        let cases = engine_cases();
        let Some(Value::Str(centre_re)) = cases.get("center_re") else {
            panic!("no center_re")
        };
        let Some(Value::Str(centre_im)) = cases.get("center_im") else {
            panic!("no center_im")
        };
        let Some(Value::Num(width)) = cases.get("width") else {
            panic!("no width")
        };
        let Some(Value::Num(maxiter)) = cases.get("maxiter") else {
            panic!("no maxiter")
        };
        let dc_re = numbers(&cases, "dc_re");
        let dc_im = numbers(&cases, "dc_im");
        let smooth = numbers(&cases, "smooth");

        let maxiter = *maxiter as u32;
        let limbs = reference::limbs_for(*width, 20);
        let c_re = Fx::parse(centre_re, limbs).unwrap();
        let c_im = Fx::parse(centre_im, limbs).unwrap();
        let orbit = reference::orbit(&c_re, &c_im, maxiter, None);
        let kernel = Kernel::new(&orbit, maxiter, false);

        assert!(dc_re.len() >= 100, "only {} cases", dc_re.len());
        let (mut escaping, mut close, mut inside) = (0, 0, 0);
        for index in 0..dc_re.len() {
            let ours = kernel.sample(dc_re[index], dc_im[index]).smooth;
            // The engine writes `null` for interior, which reads back as NaN.
            let theirs = smooth[index];
            assert_eq!(
                ours.is_nan(),
                theirs.is_nan(),
                "case {index} at ({}, {}): ours {ours}, theirs {theirs}",
                dc_re[index],
                dc_im[index]
            );
            if theirs.is_nan() {
                inside += 1;
                continue;
            }
            escaping += 1;
            if (ours - theirs).abs() < 1e-6 {
                close += 1;
            }
        }
        assert!(escaping > 50 && inside > 20, "{escaping} out / {inside} in");
        assert!(
            close as f64 / escaping as f64 > 0.90,
            "only {close} of {escaping} escaping samples were within 1e-6"
        );
    }

    // ------------------------------------------------------------------ julia

    /// The anchor spec with a Julia parameter bolted on: the same deep `c`, now
    /// drawn as the Julia set of itself at `z = c`.
    fn julia_spec() -> String {
        ANCHOR.replace(
            r#""resolution": [480, 270]"#,
            r#""resolution": [480, 270],
              "julia_re": "-0.74501772828532335842941892835857434",
              "julia_im": "0.14993443275456819177805709088257971""#,
        )
    }

    #[test]
    fn a_julia_frames_reference_is_the_mandelbrot_orbit_at_the_same_c() {
        let mandelbrot = Spec::parse(ANCHOR).unwrap();
        let julia = Spec::parse(&julia_spec()).unwrap();
        assert!(julia.julia.is_some());
        // The one point of difference is the extra step a view entered at `Z₁`
        // needs; every point they share is the same point.
        let theirs = mandelbrot.reference_orbit().unwrap();
        let ours = julia.reference_orbit().unwrap();
        assert_eq!(ours.len(), theirs.len() + 1);
        assert_eq!(&ours.points[..theirs.len()], &theirs.points[..]);
    }

    /// **The origin anchor's orbit is sized for the square of the step**, and the
    /// parameter anchor's is not — the one place a frame's limb count is not the
    /// view's own.
    #[test]
    fn the_origin_anchor_is_computed_at_twice_the_bits() {
        let deep = far_spec(1e-30).replace(r#""schema": 1"#, r#""schema": 1, "anchor": "origin""#);
        let origin = Spec::parse(&deep).unwrap();
        let parameter = Spec::parse(&far_spec(1e-30)).unwrap();
        assert_eq!(parameter.limbs(), reference::limbs_for(1e-30, 480));
        assert_eq!(origin.limbs(), reference::limbs_pow(1e-30, 480, 2));
        assert!(origin.limbs() > parameter.limbs());
        // The orbit is the one that carries them.
        assert_eq!(origin.reference_orbit().unwrap().limbs, origin.limbs());
        // And a frame so narrow that even sixteen limbs cannot hold its square is
        // refused in a sentence rather than drawn at a clamped count.
        let past = far_spec(1e-150).replace(r#""schema": 1"#, r#""schema": 1, "anchor": "origin""#);
        let report = plan_text(&past);
        assert!(report.contains(r#""ok":false"#), "{report}");
        assert!(report.contains("limbs"), "{report}");
    }

    /// **The degree is a member with a default**, so every spec written before it
    /// existed is still degree two, and nothing outside two to six is drawn.
    #[test]
    fn the_degree_is_two_unless_the_spec_says_otherwise() {
        assert_eq!(Spec::parse(ANCHOR).unwrap().degree, 2);
        let with = |degree: &str| {
            ANCHOR.replace(
                r#""schema": 1"#,
                &format!(r#""schema": 1, "degree": {degree}"#),
            )
        };
        for degree in 2..=6 {
            let spec = Spec::parse(&with(&degree.to_string())).unwrap();
            assert_eq!(spec.degree, degree);
            let report = plan_text(&with(&degree.to_string()));
            assert!(
                report.contains(&format!(r#""degree":{degree}"#)),
                "{report}"
            );
        }
        for bad in ["1", "7", "2.5", "\"3\"", "-3"] {
            let why = Spec::parse(&with(bad)).unwrap_err();
            assert!(why.contains("`degree`"), "{bad}: {why}");
        }
        // The origin anchor's orbit is sized for the step to the degree.
        let origin = far_spec(1e-12).replace(
            r#""schema": 1"#,
            r#""schema": 1, "anchor": "origin", "degree": 5"#,
        );
        let spec = Spec::parse(&origin).unwrap();
        assert_eq!(spec.limbs(), reference::limbs_pow(1e-12, 480, 5));
        // And a degree-d reference is the orbit of `z^d + c`: the Julia orbit of a
        // degree-3 frame at `c` is one point longer than the degree-3 Mandelbrot
        // orbit there, and shares every point with it, as at degree two.
        let three = ANCHOR.replace(r#""schema": 1"#, r#""schema": 1, "degree": 3"#);
        let julia = julia_spec().replace(r#""schema": 1"#, r#""schema": 1, "degree": 3"#);
        let m = Spec::parse(&three).unwrap().reference_orbit().unwrap();
        let j = Spec::parse(&julia).unwrap().reference_orbit().unwrap();
        assert_eq!(&j.points[..m.len()], &m.points[..]);
        let quadratic = Spec::parse(ANCHOR).unwrap().reference_orbit().unwrap();
        assert_ne!(
            m.points[2], quadratic.points[2],
            "degree 3 drew the quadratic orbit"
        );
    }

    #[test]
    fn the_entry_index_is_the_anchor_and_nothing_else() {
        assert_eq!(Spec::parse(ANCHOR).unwrap().entry(), 0);
        assert_eq!(Spec::parse(&julia_spec()).unwrap().entry(), 1);
        let origin = julia_spec().replace(r#""schema": 1"#, r#""schema": 1, "anchor": "origin""#);
        let spec = Spec::parse(&origin).unwrap();
        assert_eq!(spec.anchor, Anchor::Origin);
        assert_eq!(spec.entry(), 0);
    }

    /// A view centred on its anchor has an offset of exactly zero, so the pixel
    /// step is all the `f64` is carrying and the question does not arise.
    #[test]
    fn a_view_on_its_anchor_resolves_and_a_far_one_does_not() {
        let spec = Spec::parse(&julia_spec()).unwrap();
        assert!(spec.delta_ulps().is_infinite());
        assert!(Spec::parse(ANCHOR).unwrap().delta_ulps().is_infinite());

        // **The wall is a long way out, and where it is is worth pinning.** The
        // same frame moved to `z = 0` while still anchored at `z = c` has an
        // offset of about 0.76, whose ulp is 1.1e-16 — so at 2e-11 across 480
        // samples a pixel still spans 375 of them and the frame is perfectly
        // drawable. It is the deep widths that cannot afford it.
        let away = far_spec(2e-11);
        assert!(Spec::parse(&away).unwrap().delta_ulps() > 300.0);

        // Nine decades down, the same offset leaves less than one number to a
        // pixel: every sample would start from the same delta.
        let spec = Spec::parse(&far_spec(1e-20)).unwrap();
        assert!(spec.delta_ulps() < DELTA_ULPS, "{}", spec.delta_ulps());

        // And from the origin anchor the very same frame is exact. That is what
        // the second anchor is for, and the only thing it is for.
        let anchored =
            far_spec(1e-20).replace(r#""schema": 1"#, r#""schema": 1, "anchor": "origin""#);
        assert!(Spec::parse(&anchored).unwrap().delta_ulps().is_infinite());
    }

    /// The anchor's `c`, drawn as a Julia set, framed at `z = 0` — a full 0.76
    /// away from the anchor the arithmetic is measured against.
    fn far_spec(width: f64) -> String {
        julia_spec()
            .replace(
                r#""center_re": "-0.74501772828532335842941892835857434""#,
                r#""center_re": "0""#,
            )
            .replace(
                r#""center_im": "0.14993443275456819177805709088257971""#,
                r#""center_im": "0""#,
            )
            .replace(r#""width": 2e-11"#, &format!(r#""width": {width:e}"#))
    }

    #[test]
    fn a_frame_too_far_from_its_anchor_is_refused_in_a_sentence() {
        let report = plan_text(&far_spec(1e-20));
        assert!(report.contains(r#""ok":false"#), "{report}");
        assert!(report.contains("flat"), "{report}");
    }

    #[test]
    fn a_julia_spec_plans_and_says_which_anchor_it_is_drawn_from() {
        let report = plan_text(&julia_spec());
        assert!(report.contains(r#""julia":true"#), "{report}");
        assert!(report.contains(r#""anchor":"parameter""#), "{report}");
        // Infinite is not JSON, and a reader of this report is `JSON.parse`.
        assert!(report.contains(r#""delta_ulps":null"#), "{report}");
        assert!(!report.contains("inf"), "{report}");
    }

    #[test]
    fn the_members_that_mean_nothing_together_are_refused() {
        let with_reference = julia_spec().replace(
            r#""schema": 1"#,
            r#""schema": 1, "reference_re": "0", "reference_im": "0""#,
        );
        assert!(
            Spec::parse(&with_reference)
                .unwrap_err()
                .contains("critical orbit")
        );

        let with_period = julia_spec().replace(r#""schema": 1"#, r#""schema": 1, "period": 2838"#);
        assert!(Spec::parse(&with_period).unwrap_err().contains("nucleus"));

        // And an anchor with nothing to anchor to.
        let stray = ANCHOR.replace(r#""schema": 1"#, r#""schema": 1, "anchor": "origin""#);
        assert!(Spec::parse(&stray).unwrap_err().contains("`julia_re`"));

        // Half a parameter is not a parameter.
        let half = ANCHOR.replace(r#""schema": 1"#, r#""schema": 1, "julia_re": "0.25""#);
        assert!(Spec::parse(&half).unwrap_err().contains("julia_im"));
    }

    /// `plan`'s report, read back as text.
    fn plan_text(spec: &str) -> String {
        let bytes = spec.as_bytes();
        let out = plan(bytes.as_ptr(), bytes.len());
        let size = unsafe { std::ptr::read_unaligned(out as *const u32) } as usize;
        let body = unsafe { std::slice::from_raw_parts(out.add(4), size) };
        let text = String::from_utf8(body.to_vec()).unwrap();
        unsafe { dealloc(out, size + 4) };
        text
    }
}
