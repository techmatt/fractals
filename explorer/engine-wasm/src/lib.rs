//! The renderer the explorer page runs, as a raw `wasm32-unknown-unknown` module.
//!
//! Two exports carry the page, and the seam between them is the whole design:
//!
//! ```text
//! compute_field(spec, row_start, row_end) -> f32 bytes   expensive, split over workers
//! shade(field, palette, shade params)     -> RGBA bytes  cheap, main thread, instant
//! ```
//!
//! A field is what costs seconds; a color is what costs milliseconds. Computing
//! them apart is what lets a worker own a band of rows, and lets a palette change
//! recolor a picture that is already on the screen without iterating anything
//! again. It is the same seam [`fractal_engine`] keeps between its `field` and
//! `coloring` modules, held open one level further out so that JavaScript sits in
//! it.
//!
//! No wasm-bindgen. The module is the engine plus this file, JS owns every buffer
//! through [`alloc`] and [`dealloc`], and nothing is generated.
//!
//! **The engine decides everything a picture depends on.** The iteration cap is
//! `maxiter::for_width`, the coloring is whatever `mode::resolve` says `smooth`
//! is, the stretch and the colormap bake are the engine's, and the last pass is
//! `resample::downsample` at one sample per pixel. This file chooses a row range
//! and nothing else.

use fractal_engine::coloring::{Coloring, Palette, Rolloff, Transfer, Transform};
use fractal_engine::colormap::{Bake, Colormap, Kind};
use fractal_engine::family::Family;
use fractal_engine::field::{Field, FieldSpec};
use fractal_engine::viewport::Viewport;
use fractal_engine::{coloring, iterate, maxiter, mode, resample};
use num_complex::Complex;

/// Samples per output pixel per axis. One: an explorer draws at the resolution it
/// shows, and a finished wallpaper is what supersampling is for.
const SUPERSAMPLE: u32 = 1;

/// The one family this module renders. Every other name the permalink reserves is
/// refused in JavaScript before it reaches here; this is the second refusal.
const FAMILY_MANDELBROT: u32 = 0;
/// The one mode this module renders.
const MODE_SMOOTH: u32 = 0;

fn family_of(id: u32) -> Option<Family> {
    (id == FAMILY_MANDELBROT).then_some(Family::Multibrot { degree: 2 })
}

fn coloring_of(id: u32, family: &Family) -> Option<Coloring> {
    (id == MODE_SMOOTH)
        .then(|| mode::resolve("smooth", Some(family)).ok())
        .flatten()
}

/// The field a coloring reads, and the curve it reads it through.
///
/// Draft-1's one mode is a single-field coloring, so this destructuring is total
/// for what ships. A composite or a direct trap has neither shape, which is
/// exactly why the reserved mode names are refused rather than approximated.
fn single_field(coloring: &Coloring) -> Option<(FieldSpec, Transform)> {
    match coloring {
        Coloring::Field { field, transform } => Some((*field, *transform)),
        _ => None,
    }
}

fn viewport(cx: f64, cy: f64, fw: f64, px_w: u32, px_h: u32) -> Viewport {
    Viewport {
        center: Complex::new(cx, cy),
        width: fw,
        out_width: px_w,
        out_height: px_h,
        supersample: SUPERSAMPLE,
    }
}

/// Hand a `Vec` to JavaScript and forget it: the caller owns it until `dealloc`.
fn release(mut bytes: Vec<u8>) -> *mut u8 {
    let ptr = bytes.as_mut_ptr();
    std::mem::forget(bytes);
    ptr
}

/// Compute rows `[row_start, row_end)` of the field, as little-endian `f32`.
///
/// The coordinates are formed from the **whole** viewport — `sample_point(col,
/// row)` with the global row index — so a band is bit for bit the rows the
/// engine's own whole-frame pass would have produced. A band that re-derived its
/// own sub-viewport would land on almost the same coordinates and draw seams
/// between the bands at the last place of the arithmetic.
///
/// Returns `(row_end - row_start) * px_w * 4` bytes, or null if the family or the
/// mode is one this module does not render. `NaN` marks a sample with no value,
/// which is the engine's own spelling for the interior.
#[unsafe(no_mangle)]
#[allow(clippy::too_many_arguments)]
pub extern "C" fn compute_field(
    family_id: u32,
    mode_id: u32,
    cx: f64,
    cy: f64,
    fw: f64,
    px_w: u32,
    px_h: u32,
    row_start: u32,
    row_end: u32,
) -> *mut u8 {
    let Some(family) = family_of(family_id) else {
        return std::ptr::null_mut();
    };
    let Some((spec, _)) = coloring_of(mode_id, &family).as_ref().and_then(single_field) else {
        return std::ptr::null_mut();
    };
    if px_w == 0 || row_end > px_h || row_start >= row_end {
        return std::ptr::null_mut();
    }

    let view = viewport(cx, cy, fw, px_w, px_h);
    let maxiter = maxiter::for_width(fw);
    let wants = spec.wants();

    let mut bytes = Vec::with_capacity(((row_end - row_start) * px_w) as usize * 4);
    for row in row_start..row_end {
        for col in 0..px_w {
            let orbit = iterate::run(&family, view.sample_point(col, row), maxiter, &wants);
            let value = spec.reduce(&orbit).map_or(f32::NAN, |value| value as f32);
            bytes.extend_from_slice(&value.to_le_bytes());
        }
    }
    release(bytes)
}

/// Color an assembled field, and return `px_w * px_h * 4` RGBA bytes.
///
/// **The whole field, and not a band.** The engine normalizes a frame against its
/// own distribution — the 0.5th and 99.5th percentiles of its valid samples — so a
/// band shaded alone would be stretched against its own histogram and would not
/// match its neighbours. That percentile pair is the only whole-field statistic on
/// this path at the shipped transfer; the other two transfers the palette recipe
/// can ask for bring one each, and both are equally frame-wide.
///
/// The colormap arrives as its control points rather than as a name, because the
/// page has no filesystem to load one from: `positions_ptr` addresses `stops_len`
/// `f64` positions over `[0, 1]`, and `colors_ptr` the same many sRGB8 triples.
/// The positions are `f64` and not a quantized byte — the engine does not require
/// a map's stops to be evenly spaced, and rounding them would bend every gradient
/// slightly rather than fail loudly.
#[unsafe(no_mangle)]
#[allow(clippy::too_many_arguments)]
pub extern "C" fn shade(
    mode_id: u32,
    field_ptr: *const u8,
    px_w: u32,
    px_h: u32,
    positions_ptr: *const f64,
    colors_ptr: *const u8,
    stops_len: u32,
    cyclic: u32,
    gamma: f64,
    cycles: f64,
    phase: f64,
    reverse: u32,
    mirror: u32,
    transfer_kind: u32,
    transfer_weight: f64,
    rolloff_kind: u32,
    rolloff_knee: f64,
) -> *mut u8 {
    let Some(family) = family_of(FAMILY_MANDELBROT) else {
        return std::ptr::null_mut();
    };
    let Some((_, transform)) = coloring_of(mode_id, &family).as_ref().and_then(single_field) else {
        return std::ptr::null_mut();
    };
    if px_w == 0 || px_h == 0 || field_ptr.is_null() || stops_len < 2 {
        return std::ptr::null_mut();
    }
    if positions_ptr.is_null() || colors_ptr.is_null() {
        return std::ptr::null_mut();
    }

    let count = (px_w as usize) * (px_h as usize);
    let raw = unsafe { std::slice::from_raw_parts(field_ptr, count * 4) };
    let field = Field {
        values: raw
            .chunks_exact(4)
            .map(|four| f32::from_le_bytes([four[0], four[1], four[2], four[3]]))
            .collect(),
        width: px_w,
        height: px_h,
    };

    let positions = unsafe { std::slice::from_raw_parts(positions_ptr, stops_len as usize) };
    let colors = unsafe { std::slice::from_raw_parts(colors_ptr, stops_len as usize * 3) };
    let stops: Vec<(f64, [u8; 3])> = positions
        .iter()
        .zip(colors.chunks_exact(3))
        .map(|(&position, rgb)| (position, [rgb[0], rgb[1], rgb[2]]))
        .collect();
    let kind = if cyclic == 1 {
        Kind::Cyclic
    } else {
        Kind::Sequential
    };
    let bake = Bake {
        reverse: reverse == 1,
        mirror: mirror == 1,
    };
    let Ok(colormap) = Colormap::from_stops_baked("explorer", kind, &stops, bake) else {
        return std::ptr::null_mut();
    };

    let palette = Palette {
        gamma,
        cycles,
        phase,
        bake,
        transfer: match transfer_kind {
            1 => Transfer::Edge {
                weight: transfer_weight,
            },
            2 => Transfer::Rank,
            _ => Transfer::Value,
        },
        rolloff: match rolloff_kind {
            1 => Rolloff::SoftKnee { knee: rolloff_knee },
            2 => Rolloff::Reinhard,
            3 => Rolloff::Aces,
            _ => Rolloff::None,
        },
    };
    if palette.validate().is_err() {
        return std::ptr::null_mut();
    }

    let mut linear = coloring::shade(&field, transform, &palette, &colormap);
    if palette.rolloff != Rolloff::None {
        // `coloring::paint` rolls the highlights off after it colors and before
        // anything averages them. This path calls `coloring::shade` directly — it
        // has a field already — so the same last step is taken here rather than
        // dropped on the way past.
        for pixel in &mut linear {
            *pixel = palette.rolloff.shade(*pixel);
        }
    }
    let rgb = resample::downsample(
        &linear,
        px_w as usize,
        px_h as usize,
        px_w as usize,
        px_h as usize,
        SUPERSAMPLE,
    );

    let mut rgba = Vec::with_capacity(count * 4);
    for pixel in rgb.chunks_exact(3) {
        rgba.extend_from_slice(pixel);
        rgba.push(255);
    }
    release(rgba)
}

/// The iteration cap the engine's own policy gives this view.
#[unsafe(no_mangle)]
pub extern "C" fn maxiter_for_width(fw: f64) -> u32 {
    maxiter::for_width(fw)
}

/// How many representable numbers one sample step of this view spans.
///
/// Below [`fractal_engine::viewport::RESOLUTION_ULPS`] two neighbouring sample
/// centers are the same number, and the page stops zooming rather than draw the
/// arithmetic.
#[unsafe(no_mangle)]
pub extern "C" fn resolution_ulps(cx: f64, cy: f64, fw: f64, px_w: u32, px_h: u32) -> f64 {
    viewport(cx, cy, fw, px_w, px_h).resolution_ulps()
}

/// The floor `resolution_ulps` is read against, so the page does not restate it.
#[unsafe(no_mangle)]
pub extern "C" fn resolution_ulps_floor() -> f64 {
    fractal_engine::viewport::RESOLUTION_ULPS
}

/// The family's own home view, so the page does not hardcode one.
#[unsafe(no_mangle)]
pub extern "C" fn home_center_re() -> f64 {
    home().center.re
}
#[unsafe(no_mangle)]
pub extern "C" fn home_center_im() -> f64 {
    home().center.im
}
#[unsafe(no_mangle)]
pub extern "C" fn home_width() -> f64 {
    home().width
}

fn home() -> fractal_engine::family::HomeView {
    Family::Multibrot { degree: 2 }
        .home_view()
        .expect("the parameter plane has a home")
}

#[unsafe(no_mangle)]
pub extern "C" fn alloc(len: usize) -> *mut u8 {
    let mut buffer = Vec::<u8>::with_capacity(len);
    let ptr = buffer.as_mut_ptr();
    std::mem::forget(buffer);
    ptr
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn dealloc(ptr: *mut u8, len: usize) {
    unsafe { drop(Vec::from_raw_parts(ptr, 0, len)) }
}
