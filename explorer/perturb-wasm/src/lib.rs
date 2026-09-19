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
//! Degree-2 Mandelbrot, `smooth`, and nothing else. No other family has a delta
//! recurrence written here; no other mode's channels are reduced. It is not a
//! wider engine, it is one kernel — which is the shape the explorer's own README
//! already said a deep renderer would have to take.

use crate::fx::Fx;
use crate::json::Value;
use crate::kernel::Kernel;
use crate::reference::Reference;

pub mod fx;
pub mod json;
pub mod kernel;
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
    /// **This crate's own ceiling, and provisional.** The engine's is 67,000 and
    /// exists to stop a raised base being re-clipped; this one exists to stop a
    /// mistyped width from asking for a frame that never finishes. The formula
    /// reaches it at a width of about 1e-227, which is past where `f64` holds a
    /// width at all — so in practice it binds on nothing, and the number to watch
    /// is the one the formula gives: 48,551 at 2e-11, 117,518 at 1e-28.
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
    pub interior: bool,
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
    "interior",
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

        Ok(Spec {
            center_re,
            center_im,
            width,
            resolution,
            supersample: count_of("supersample").unwrap_or(1),
            maxiter: count_of("maxiter"),
            reference,
            period: count_of("period"),
            interior,
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

    pub fn limbs(&self) -> usize {
        reference::limbs_for(self.width, self.sample_width())
    }

    /// The reference orbit this spec asks for.
    pub fn reference_orbit(&self) -> Result<Reference, String> {
        let limbs = self.limbs();
        let (re, im) = match &self.reference {
            Some((re, im)) => (re.as_str(), im.as_str()),
            None => (self.center_re.as_str(), self.center_im.as_str()),
        };
        let c_re = Fx::parse(re, limbs).ok_or_else(|| format!("`{re}` is not a decimal"))?;
        let c_im = Fx::parse(im, limbs).ok_or_else(|| format!("`{im}` is not a decimal"))?;
        Ok(reference::orbit(&c_re, &c_im, self.maxiter(), self.period))
    }

    /// How far the view centre is from the reference point, in `f64`, taken in
    /// fixed point.
    ///
    /// **Never `f64(center) − f64(reference)`.** At the depths this crate is for,
    /// those two are the same `f64` and the difference is exactly zero — which
    /// would draw the reference's own neighbourhood wherever the view actually
    /// is, and look entirely plausible.
    pub fn centre_offset(&self) -> Result<(f64, f64), String> {
        let Some((re, im)) = &self.reference else {
            return Ok((0.0, 0.0));
        };
        let limbs = self.limbs();
        let parse = |text: &str| Fx::parse(text, limbs).ok_or_else(|| format!("`{text}` is not a decimal"));
        Ok((
            parse(&self.center_re)?.sub(&parse(re)?).to_f64(),
            parse(&self.center_im)?.sub(&parse(im)?).to_f64(),
        ))
    }

    /// `dc` for sample cell `(col, row)` of the supersampled grid.
    ///
    /// The geometry is the engine's `Viewport::sample_point`, offset by the
    /// reference rather than added to the centre: row 0 is the top of the image
    /// and so the largest imaginary part, which is why the vertical term is
    /// subtracted.
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
    let kernel = Kernel::new(orbit, spec.maxiter(), spec.interior);
    let offset = spec.centre_offset().unwrap_or((0.0, 0.0));
    let width = spec.sample_width();
    let mut bytes = Vec::with_capacity(((last - first) * width) as usize * 8);
    for row in first..last {
        for col in 0..width {
            let (dc_re, dc_im) = spec.dc(offset, col, row);
            bytes.extend_from_slice(&kernel.sample(dc_re, dc_im).smooth.to_le_bytes());
        }
    }
    bytes
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
    let report = match read {
        Ok(spec) => format!(
            concat!(
                r#"{{"ok":true,"maxiter":{},"limbs":{},"fraction_bits":{},"#,
                r#""sample_width":{},"sample_height":{},"interior":{},"#,
                r#""reference_bytes":{},"ceiling":{}}}"#
            ),
            spec.maxiter(),
            spec.limbs(),
            64 * (spec.limbs() - 1),
            spec.sample_width(),
            spec.sample_height(),
            spec.interior,
            REFERENCE_HEADER
                + 16 * match spec.period {
                    Some(period) => period as usize,
                    None => spec.maxiter() as usize + 1,
                },
            cap::CEILING as u32,
        ),
        Err(why) => format!(r#"{{"ok":false,"why":{}}}"#, json::quote(&why)),
    };
    release_text(&report)
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
        let narrowed = -0.74501772828532335842941892835857434f64
            - -0.74501772828532335842941892835857000f64;
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
}
