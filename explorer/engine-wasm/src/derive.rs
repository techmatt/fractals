//! A mode's own parameters, taken from the view rather than from the catalog.
//!
//! Two modes' settled constants were settled for no view in particular, and each fails
//! in a way the view could have predicted:
//!
//! - **An angle mode's texture weight.** The texture is stretched against its own frame,
//!   so its *amplitude* is already the view's; how *busy* it is from one pixel to the
//!   next is not, and at 0.85 a view whose texture changes at every pixel is noise laid
//!   over the picture. [`weight`] measures that busyness and sets the weight so the
//!   texture's contribution lands at one contrast.
//! - **A direct trap's opacity.** A trap composites a sample at every near miss and has no
//!   whole-frame normalization, so a view whose orbits rarely come close paints a black
//!   (screen) or white (multiply) frame, and one whose orbits come close thousands of
//!   times saturates. [`probe_row`] counts a view's near misses on a small grid and
//!   [`opacity`] sets the alpha at which the typical hit pixel lands mid-lightness.
//!
//! **Neither is a second renderer.** The weight reads the lanes [`crate::shade_level`]
//! already holds, through the engine's own [`Stretch`]. The probe is the one place this
//! crate walks an orbit itself — `Painter::trace` returns a colour, and the question here
//! is how many samples went into it — so its hit test is written to be `trace`'s line for
//! line, and the tests at the foot of this file hold the two to each other.
//!
//! **The constants are this file's and the page never restates them.** They were chosen
//! by pilot (`explorer_param_derive_ckpt128`), against one view Matt judged by eye and a
//! spread of seats and failures around it; the report beside that prompt has the numbers.

use fractal_engine::coloring::{Blend, Coloring, Stretch, Transform};
use fractal_engine::colormap::Colormap;
use fractal_engine::direct_trap::{Painter, Shape};
use fractal_engine::family::Family;
use fractal_engine::field::Field;
use fractal_engine::iterate::BAILOUT;
use fractal_engine::viewport::Viewport;

// ------------------------------------------------------------------------ weight

/// The texture contribution a derived weight aims at: weight times roughness.
///
/// Calibrated on one view — `smooth_mean_angle` at `w = 7.98e-8` on `cmr.jungle`,
/// mirrored, where 0.85 is far too strong and about 0.1 is right by eye — on the page's
/// default 884x496 canvas, where that view's roughness is 0.197.
pub const WEIGHT_TARGET: f64 = 0.0197;

/// How many significant figures a derived value keeps. A link carries the number and the
/// picture is drawn at it, so the number is rounded before anything is drawn rather than
/// after: three figures is finer than the eye and short enough to read in an address bar.
pub const FIGURES: i32 = 3;

/// `value` to [`FIGURES`] significant figures, as the nearest double to that decimal, so
/// that JavaScript's shortest spelling of it is the decimal itself.
pub fn rounded(value: f64) -> f64 {
    if !(value > 0.0) || !value.is_finite() {
        return value;
    }
    let places = FIGURES - 1 - value.log10().floor() as i32;
    if places <= 0 {
        return value.round();
    }
    let scale = 10f64.powi(places);
    (value * scale).round() / scale
}

/// The least a derived weight may be. Below this the texture is gone, and a mode whose
/// texture is gone is the plain smooth mode under another name.
pub const WEIGHT_FLOOR: f64 = 0.05;

/// How much the stretched texture changes between neighbouring samples `stride` apart,
/// on average, where the base has a value at both — the only place the weight acts.
///
/// The position is the one `coloring::composite` places the texture at: the frame's own
/// stretch, then the texture layer's transform. `None` where no neighbouring pair has a
/// base and a texture at both ends, which is a view with nothing for a weight to do.
pub fn roughness(base: &Field, texture: &Field, transform: Transform, stride: u32) -> Option<f64> {
    let stretch = Stretch::measure(texture);
    let width = texture.width as usize;
    let height = texture.height as usize;
    let stride = stride.max(1) as usize;
    let at = |index: usize| {
        let value = texture.values[index];
        (value.is_finite() && base.values[index].is_finite())
            .then(|| transform.apply(stretch.position(value as f64)))
    };
    let mut sum = 0.0;
    let mut count = 0u64;
    for row in (0..height).step_by(stride) {
        for col in (0..width).step_by(stride) {
            let index = row * width + col;
            let Some(here) = at(index) else { continue };
            if col + stride < width {
                if let Some(right) = at(index + stride) {
                    sum += (right - here).abs();
                    count += 1;
                }
            }
            if row + stride < height {
                if let Some(below) = at(index + stride * width) {
                    sum += (below - here).abs();
                    count += 1;
                }
            }
        }
    }
    (count > 0).then(|| sum / count as f64)
}

/// The weight at which this texture's contribution lands at [`WEIGHT_TARGET`], held to
/// `[WEIGHT_FLOOR, ceiling]`, where the ceiling is the catalog's own settled weight.
pub fn weight(roughness: f64, ceiling: f64) -> f64 {
    if !(roughness > 0.0) {
        return ceiling;
    }
    rounded(WEIGHT_TARGET / roughness).clamp(WEIGHT_FLOOR.min(ceiling), ceiling)
}

// ----------------------------------------------------------------------- opacity

/// Which hit pixel is the typical one: this quantile of the probe's hit pixels, ordered
/// by how much paint they take.
pub const OPACITY_QUANTILE: f64 = 0.5;

/// The Oklab lightness the typical hit pixel is aimed at.
pub const OPACITY_LIGHTNESS: f64 = 0.5;

/// The bytes the probe writes per pixel: hits, then load, as little-endian `f32`.
pub const PROBE_BYTES: usize = 8;

/// Linear-light luminance, Rec. 709 weights: a sample's brightness as one number.
fn luminance(rgb: [f64; 3]) -> f64 {
    0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]
}

/// One probe pixel: how many near misses the orbit made, and how much paint they carry.
///
/// Each hit composites `alpha = opacity · f` with `f = 1 − key`, and for the two blends
/// the production traps use the whole stack is a product:
///
/// ```text
/// screen from black:     1 − c = Π (1 − opacity · f · S)
/// multiply from white:       c = Π (1 − opacity · f · (1 − S))
/// ```
///
/// with `S` the sample's luminance. So the pixel's `load` is `Σ f·S` (screen) or
/// `Σ f·(1 − S)` (multiply), and to first order in the opacity the pixel is
/// `1 − exp(−opacity · load)` or `exp(−opacity · load)`. Everything but the loop is
/// `trace`'s, and the loop is `trace`'s too: seed, step, distance, the key through the
/// transform, bailout after the hit test.
pub fn probe_pixel(
    painter: &Painter,
    shape: Shape,
    radius: f64,
    merge: Blend,
    transform: Transform,
    family: &Family,
    pixel: num_complex::Complex<f64>,
    maxiter: u32,
    colormap: &Colormap,
) -> (u32, f64) {
    let bailout_sq = BAILOUT * BAILOUT;
    let threshold = painter.threshold();
    let (mut z, mut z_prev, c) = family.seed(pixel);
    let mut hits = 0u32;
    let mut load = 0.0;
    for _ in 1..=maxiter {
        let next = family.step(z, z_prev, c);
        z_prev = z;
        z = next;
        let distance = shape.distance(z, radius);
        if distance < threshold {
            let key = transform.apply((distance / threshold).clamp(0.0, 1.0));
            let sample = luminance(colormap.lookup(key));
            let paint = if merge == Blend::Multiply {
                1.0 - sample
            } else {
                sample
            };
            hits += 1;
            load += (1.0 - key) * paint;
        }
        if z.norm_sqr() > bailout_sq {
            break;
        }
    }
    (hits, load)
}

/// Whether a direct coloring's stack has the product form [`probe_pixel`] relies on.
pub fn probes(coloring: &Coloring) -> bool {
    matches!(
        coloring,
        Coloring::Direct {
            merge: Blend::Screen | Blend::Multiply,
            ..
        }
    )
}

/// One row of the probe, appended to `out` as [`PROBE_BYTES`] per sample.
#[allow(clippy::too_many_arguments)]
pub fn probe_row(
    painter: &Painter,
    coloring: &Coloring,
    view: &Viewport,
    family: &Family,
    maxiter: u32,
    colormap: &Colormap,
    row: u32,
    out: &mut Vec<u8>,
) {
    let Coloring::Direct {
        shape,
        trap_radius,
        merge,
        transform,
        ..
    } = coloring
    else {
        return;
    };
    for col in 0..view.sample_width() {
        let (hits, load) = probe_pixel(
            painter,
            *shape,
            *trap_radius,
            *merge,
            *transform,
            family,
            view.sample_point(col, row),
            maxiter,
            colormap,
        );
        out.extend_from_slice(&(hits as f32).to_le_bytes());
        out.extend_from_slice(&(load as f32).to_le_bytes());
    }
}

/// What a probe says: the opacity it derives, and what that was read off.
#[derive(Debug, serde::Serialize)]
pub struct Probed {
    /// `None` where no probe pixel was hit at all: no opacity changes an empty mask.
    pub opacity: Option<f64>,
    /// The share of probe pixels with at least one hit.
    pub hit_share: f64,
    /// The load of the typical hit pixel, which the opacity was solved for.
    pub load: Option<f64>,
}

/// The opacity at which the [`OPACITY_QUANTILE`] hit pixel lands at
/// [`OPACITY_LIGHTNESS`], to first order, held to `[0, cap]`.
///
/// `cap` is the painter's own clamp — 1, or the screened cross's — so the number a page
/// shows is the opacity in force rather than one `Painter::new` will quietly lower.
pub fn opacity(probe: &[u8], merge: Blend, cap: f64) -> Probed {
    let mut loads: Vec<f64> = Vec::new();
    let mut pixels = 0usize;
    for pixel in probe.chunks_exact(PROBE_BYTES) {
        pixels += 1;
        let hits = f32::from_le_bytes(pixel[0..4].try_into().expect("four bytes"));
        let load = f32::from_le_bytes(pixel[4..8].try_into().expect("four bytes"));
        if hits > 0.0 {
            loads.push(load as f64);
        }
    }
    let hit_share = if pixels == 0 {
        0.0
    } else {
        loads.len() as f64 / pixels as f64
    };
    if loads.is_empty() {
        return Probed {
            opacity: None,
            hit_share,
            load: None,
        };
    }
    loads.sort_by(f64::total_cmp);
    let at = ((loads.len() - 1) as f64 * OPACITY_QUANTILE).round() as usize;
    let load = loads[at];
    // A neutral's Oklab lightness is the cube root of its linear value.
    let linear = OPACITY_LIGHTNESS.powi(3);
    let wanted = if merge == Blend::Multiply {
        -linear.ln()
    } else {
        -(1.0 - linear).ln()
    };
    let opacity = if load > 0.0 {
        rounded(wanted / load).clamp(0.0, cap)
    } else {
        cap
    };
    Probed {
        opacity: Some(opacity),
        hit_share,
        load: Some(load),
    }
}

/// The opacity `Painter::new` holds this coloring to.
pub fn opacity_cap(shape: Shape, merge: Blend) -> f64 {
    if merge == Blend::Screen && shape == Shape::Cross {
        fractal_engine::direct_trap::SCREEN_CROSS_OPACITY_CAP
    } else {
        1.0
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use fractal_engine::coloring::MergeOrder;
    use fractal_engine::colormap::{Bake, Kind};
    use num_complex::Complex;

    fn ramp() -> Colormap {
        Colormap::from_stops_baked(
            "ramp",
            Kind::Sequential,
            &[(0.0, [0, 0, 0]), (1.0, [255, 255, 255])],
            Bake::default(),
        )
        .expect("a ramp")
    }

    fn painter(merge: Blend, start: &str, opacity: f64) -> Painter {
        Painter::new(
            Shape::Cross,
            1.0,
            Some(0.1),
            opacity,
            merge,
            MergeOrder::default(),
            start,
            Transform::Linear,
        )
        .expect("a painter")
    }

    fn julia() -> Family {
        Family::Julia {
            degree: 2,
            c: Complex::new(-0.8, 0.156),
        }
    }

    /// The probe's hit test is `trace`'s: a pixel the probe counts no hit on is a pixel
    /// `trace` leaves at its start colour, and one it counts a hit on is one `trace`
    /// moved. Over a grid through the whole home view, interior and exterior both.
    #[test]
    fn the_probe_hits_where_trace_paints() {
        let family = julia();
        let map = ramp();
        let multiply = painter(Blend::Multiply, "white", 1.0);
        let home = family.home_view().expect("a home view");
        let view = Viewport {
            center: home.center,
            width: home.width,
            out_width: 64,
            out_height: 36,
            supersample: 1,
        };
        let (mut hit, mut missed) = (0, 0);
        for row in 0..view.sample_height() {
            for col in 0..view.sample_width() {
                let point = view.sample_point(col, row);
                let (hits, _) = probe_pixel(
                    &multiply,
                    Shape::Cross,
                    1.0,
                    Blend::Multiply,
                    Transform::Linear,
                    &family,
                    point,
                    500,
                    &map,
                );
                let (colour, _) = multiply.trace(&family, point, 500, &map);
                // A hit at the very edge of the threshold has f = 0 and paints nothing, so
                // "moved" is the one-way claim; "untouched" is exact.
                if hits == 0 {
                    assert_eq!(
                        colour,
                        [1.0, 1.0, 1.0],
                        "no hit, and trace painted at {point}"
                    );
                    missed += 1;
                } else {
                    hit += 1;
                }
            }
        }
        assert!(
            hit > 0 && missed > 0,
            "the grid has to exercise both: {hit} hit, {missed} not"
        );
    }

    /// The load is the product's exponent: at a small opacity the probe's first-order
    /// answer and `trace`'s actual stack agree closely on every hit pixel.
    #[test]
    fn the_load_predicts_what_trace_paints() {
        let family = julia();
        let map = ramp();
        let alpha = 0.01;
        for (merge, start) in [(Blend::Multiply, "white"), (Blend::Screen, "black")] {
            let painter = painter(merge, start, alpha);
            let mut worst: f64 = 0.0;
            for step in 0..200 {
                let point = Complex::new(-1.2 + step as f64 * 0.012, 0.05 + step as f64 * 0.001);
                let (hits, load) = probe_pixel(
                    &painter,
                    Shape::Cross,
                    1.0,
                    merge,
                    Transform::Linear,
                    &family,
                    point,
                    300,
                    &map,
                );
                if hits == 0 {
                    continue;
                }
                let (colour, _) = painter.trace(&family, point, 300, &map);
                // A gray ramp: every channel is the luminance, so one channel is enough.
                let predicted = if merge == Blend::Multiply {
                    (-alpha * load).exp()
                } else {
                    1.0 - (-alpha * load).exp()
                };
                worst = worst.max((colour[0] - predicted).abs());
            }
            assert!(worst < 0.02, "{merge:?}: first order is off by {worst}");
        }
    }

    #[test]
    fn a_weight_is_held_between_its_floor_and_the_catalog() {
        assert_eq!(weight(0.0, 0.85), 0.85);
        assert_eq!(weight(1e-6, 0.85), 0.85);
        assert_eq!(weight(10.0, 0.85), WEIGHT_FLOOR);
        let middle = WEIGHT_TARGET / 0.5;
        assert_eq!(weight(middle, 0.85), 0.5);
    }

    #[test]
    fn a_derived_value_is_three_figures_that_print_as_themselves() {
        assert_eq!(rounded(0.10677007939579208), 0.107);
        assert_eq!(rounded(0.022743589558065637), 0.0227);
        assert_eq!(rounded(2.0717015612290166e-5), 2.07e-5);
        assert_eq!(rounded(0.85), 0.85);
        assert_eq!(format!("{}", rounded(0.0009778142209584488)), "0.000978");
    }

    #[test]
    fn an_empty_probe_derives_nothing() {
        let empty = [0u8; PROBE_BYTES * 4];
        let probed = opacity(&empty, Blend::Multiply, 1.0);
        assert!(probed.opacity.is_none());
        assert_eq!(probed.hit_share, 0.0);
    }
}
