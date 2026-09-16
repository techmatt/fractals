//! The wallpaper project's `band_autolevel/v1`, as the stops surgery it is.
//!
//! **The operator is not in the engine and this is not a second operator.** Over
//! in `fractal-wallpapers` it is Python — `coloring/autolevel.py` — and it works
//! in two halves that are worth keeping apart, because only one of them is here:
//!
//! 1. **measure**, which reads a *finished picture's* Oklab lightness, projects
//!    three statistics onto the band of finished wallpapers and derives a curve;
//! 2. **apply**, which pushes that curve through the **colormap's own stops** and
//!    renders again.
//!
//! A run recorded what it did, so the measurement is already made: a permalink
//! carries the curve the run derived and this module is the second half alone.
//! That is the whole reason the explorer can show a gallery seat's own colour —
//! it never has to read a picture it has not drawn yet.
//!
//! **It lives on this side of the boundary because the colormap does.** The page
//! has no filesystem, so a map crosses as control points and is baked by
//! [`fractal_engine::colormap::Colormap::from_stops_baked`]; curving the stops
//! before that call is the same edit the operator makes when it writes a levelled
//! colormap file and points `colormap_dir` at it. Nothing downstream can tell the
//! difference, which is the point.
//!
//! **Ottosson's matrices are the engine's, not a copy.** Every conversion here
//! goes through `fractal_engine::colormap`'s own public `srgb_to_linear`,
//! `linear_to_srgb`, `linear_srgb_to_oklab` and `oklab_to_linear_srgb`. The
//! Python side has one copy of those matrices for the same stated reason, and a
//! third written out here is how two halves of one picture come to disagree about
//! what a colour is.
//!
//! ## What the arithmetic is, in order
//!
//! ```text
//! densify      every segment cut into DENSIFY parts, interpolated in Oklab
//! apply_curve   the piecewise tone curve, on lightness alone
//! cap_lightness  walk a moved lightness back until its stop keeps RETAIN chroma
//! gamut_fit     pull chroma in by bisection until the colour fits sRGB, keep L
//! ```
//!
//! The two bisections are why this is not four lines. A lightness the curve moved
//! can leave the sRGB cube, and clipping each channel independently rotates hue
//! and moves lightness — the one axis the curve exists to control. So an
//! out-of-gamut colour has its `a` and `b` scaled down until it fits, and a stop
//! that would lose more than [`RETAIN`] of its chroma has its new lightness walked
//! back toward the old one until it does not.
//!
//! The iteration counts, the retention and the subdivision factor are the
//! operator's own constants, transcribed rather than chosen — a different number
//! here is a different picture from the one the gallery ships.

use fractal_engine::colormap::{
    linear_srgb_to_oklab, linear_to_srgb, oklab_to_linear_srgb, srgb8_to_oklab, srgb_to_linear,
};
use serde::Deserialize;

/// The operator's name, as it appears in a run's stamp and in a permalink.
pub const OPERATOR: &str = "band_autolevel/v1";

/// How many parts each segment of the ramp is cut into before the curve is spent
/// on it. `autolevel.DENSIFY`. The engine bakes its lookup table by interpolating
/// the stops in Oklab, so subdividing in the same space is the identity for the
/// palette and only makes the tone curve's sampling finer.
const DENSIFY: usize = 8;

/// How much of a stop's chroma has to survive the move. `autolevel.CHROMA_RETAIN`.
const RETAIN: f64 = 0.85;

/// Bisection steps in the gamut pull-back. `autolevel.gamut_fit`.
const GAMUT_STEPS: usize = 28;

/// Bisection steps in the chroma cap's walk-back. `autolevel.cap_lightness`.
const CAP_STEPS: usize = 18;

/// How close a round trip has to land for a colour to count as inside the gamut.
/// `autolevel._in_gamut`.
const IN_GAMUT: f64 = 1e-6;

/// The tone curve one render earned, as the operator wrote it down.
///
/// Four numbers and nothing else, because [`Curve::lightness`] reads four numbers
/// and nothing else: the black and white points the picture was measured at, where
/// each is being sent, and the exponent that carries the midtone. Every other
/// field of a run's `curve` block — `mid_in`, `sides`, `clamped`, the band it was
/// projected onto — is how the curve was *arrived at*, which a replay does not
/// need and a link should not carry.
#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Curve {
    pub black_pt: f64,
    pub white_pt: f64,
    pub exponent: f64,
    pub out_ends: [f64; 2],
}

impl Curve {
    /// Every number finite, and the two ends in the order they are written.
    pub fn validate(&self) -> Result<(), String> {
        for (name, value) in [
            ("black_pt", self.black_pt),
            ("white_pt", self.white_pt),
            ("exponent", self.exponent),
            ("out_ends[0]", self.out_ends[0]),
            ("out_ends[1]", self.out_ends[1]),
        ] {
            if !value.is_finite() {
                return Err(format!("{OPERATOR}: {name} is not a finite number"));
            }
        }
        if !(self.white_pt > self.black_pt) {
            return Err(format!(
                "{OPERATOR}: the white point has to sit above the black point, and this curve \
                 says {} above {}",
                self.white_pt, self.black_pt
            ));
        }
        if !(self.exponent > 0.0) {
            return Err(format!(
                "{OPERATOR}: the exponent has to be positive, and this curve says {}",
                self.exponent
            ));
        }
        Ok(())
    }

    /// One stop's lightness through the piecewise curve. `autolevel.apply_curve`.
    ///
    /// ```text
    /// L <= b      L * lo/b                            (tail: 0 -> 0)
    /// b <  L <  w lo + (hi - lo) * ((L-b)/(w-b))**p    (core)
    /// L >= w      hi + (1-hi) * (L-w)/(1-w)            (tail: 1 -> 1)
    /// ```
    fn lightness(&self, lightness: f64) -> f64 {
        let (black, white) = (self.black_pt, self.white_pt);
        let (low, high) = (self.out_ends[0], self.out_ends[1]);
        if lightness <= black {
            return if black > 1e-9 {
                lightness * (low / black)
            } else {
                low
            };
        }
        if lightness >= white {
            return if white < 1.0 - 1e-9 {
                high + (1.0 - high) * (lightness - white) / (1.0 - white)
            } else {
                high
            };
        }
        let position = (lightness - black) / (white - black).max(1e-9);
        low + (high - low) * position.powf(self.exponent)
    }
}

/// sRGB on the 0–255 scale to Oklab, the way `palettes.space.oklab` reads a
/// fractional colour: linearize each channel off 255, then Ottosson.
fn oklab_of(rgb: [f64; 3]) -> [f64; 3] {
    linear_srgb_to_oklab([
        srgb_to_linear(rgb[0] / 255.0),
        srgb_to_linear(rgb[1] / 255.0),
        srgb_to_linear(rgb[2] / 255.0),
    ])
}

/// Oklab back to the 0–255 scale, clipped and **not** rounded.
///
/// `fractal_engine::colormap::linear_to_srgb` clamps its input to the unit
/// interval and returns inside it, which is exactly what the Python side's
/// `clip(_linear_to_srgb(linear), 0, 1)` does over every input either can be
/// handed. The clip is not a gamut fit and this function does not pretend to be
/// one — [`gamut_fit`] is.
fn srgb_of(lab: [f64; 3]) -> [f64; 3] {
    let linear = oklab_to_linear_srgb(lab);
    [
        linear_to_srgb(linear[0]) * 255.0,
        linear_to_srgb(linear[1]) * 255.0,
        linear_to_srgb(linear[2]) * 255.0,
    ]
}

/// `(is it inside, what it converts to)` — asked by round trip, because the
/// conversion clips. Asking the *clipped* output whether it is in range always
/// answers yes; an in-gamut colour survives Oklab → sRGB → Oklab unchanged and an
/// out-of-gamut one does not, which is the only question that tells them apart.
fn in_gamut(lab: [f64; 3]) -> (bool, [f64; 3]) {
    let rgb = srgb_of(lab);
    let back = oklab_of(rgb);
    let far = (0..3)
        .map(|channel| (back[channel] - lab[channel]).abs())
        .fold(0.0_f64, f64::max);
    (far < IN_GAMUT, rgb)
}

/// Round half to even, which is what `numpy.rint` does and what
/// `f64::round` does not — the latter rounds a half away from zero, and a stop
/// landing exactly on one would come back a byte off the operator's own answer.
fn rint(value: f64) -> f64 {
    let nearest = value.round();
    if (value - value.trunc()).abs() == 0.5 && nearest % 2.0 != 0.0 {
        nearest - value.signum()
    } else {
        nearest
    }
}

/// One Oklab colour as sRGB8, pulling back by **chroma** and never by channel.
///
/// Clipping each channel independently rotates hue and moves lightness, which is
/// the one axis the curve exists to control. So an out-of-gamut colour has its `a`
/// and `b` scaled down by a bisection until it fits, and its lightness is kept.
fn gamut_fit(lab: [f64; 3]) -> [u8; 3] {
    let (inside, rgb) = in_gamut(lab);
    let rgb = if inside {
        rgb
    } else {
        let (mut low, mut high) = (0.0_f64, 1.0_f64);
        for _ in 0..GAMUT_STEPS {
            let middle = 0.5 * (low + high);
            let (fits, _) = in_gamut([lab[0], lab[1] * middle, lab[2] * middle]);
            if fits {
                low = middle;
            } else {
                high = middle;
            }
        }
        in_gamut([lab[0], lab[1] * low, lab[2] * low]).1
    };
    [
        rint(rgb[0].clamp(0.0, 255.0)) as u8,
        rint(rgb[1].clamp(0.0, 255.0)) as u8,
        rint(rgb[2].clamp(0.0, 255.0)) as u8,
    ]
}

/// The chroma that survives the gamut pull-back, measured back in Oklab — and
/// measured on the **rounded** sRGB8, because that is what a stop ships as.
fn chroma_after(lab: [f64; 3]) -> f64 {
    let fitted = gamut_fit(lab);
    let back = oklab_of([fitted[0] as f64, fitted[1] as f64, fitted[2] as f64]);
    back[1].hypot(back[2])
}

/// Walk one stop's new lightness back until it keeps [`RETAIN`] of its chroma.
///
/// Only the direction that costs chroma is capped, and the walk-back target is the
/// stop's own original lightness — where retention is one by construction, because
/// the stop came from a real sRGB8 colour. So the bisection always has a valid
/// bracket. `autolevel.cap_lightness`.
fn cap_lightness(before: f64, after: f64, green_red: f64, blue_yellow: f64) -> f64 {
    let chroma = green_red.hypot(blue_yellow);
    if chroma < 1e-6 || (after - before).abs() < 1e-9 {
        return after;
    }
    let threshold = RETAIN * chroma;
    if chroma_after([after, green_red, blue_yellow]) >= threshold {
        return after;
    }
    let (mut good, mut bad) = (before, after);
    for _ in 0..CAP_STEPS {
        let middle = 0.5 * (good + bad);
        if chroma_after([middle, green_red, blue_yellow]) >= threshold {
            good = middle;
        } else {
            bad = middle;
        }
    }
    good
}

/// The ramp, subdivided and interpolated in Oklab. `autolevel.densify`.
///
/// **There is no wrap segment, and adding one would be a bug.** Every colormap the
/// wallpaper project tracks carries an explicit stop at 0 *and* at 1 — a cyclic
/// map's last stop is an explicit closing stop back to the colour it opened with —
/// and the engine's own interpolation holds the end colours beyond the outermost
/// stops rather than wrapping. Folding 1 around to 0 would put two stops on top of
/// each other and leave the ramp spanning only as far as the second-to-last one.
fn densify(stops: &[(f64, [u8; 3])]) -> (Vec<f64>, Vec<[f64; 3]>) {
    let mut ordered: Vec<(f64, [u8; 3])> = stops.to_vec();
    ordered.sort_by(|a, b| a.0.total_cmp(&b.0));
    let lab: Vec<[f64; 3]> = ordered.iter().map(|&(_, rgb)| srgb8_to_oklab(rgb)).collect();

    let mut positions = Vec::with_capacity((ordered.len() - 1) * DENSIFY + 1);
    let mut colours = Vec::with_capacity((ordered.len() - 1) * DENSIFY + 1);
    for index in 0..ordered.len() - 1 {
        let (first, second) = (ordered[index].0, ordered[index + 1].0);
        let (one, other) = (lab[index], lab[index + 1]);
        for step in 0..DENSIFY {
            let fraction = step as f64 / DENSIFY as f64;
            positions.push(first + (second - first) * fraction);
            colours.push([
                one[0] + (other[0] - one[0]) * fraction,
                one[1] + (other[1] - one[1]) * fraction,
                one[2] + (other[2] - one[2]) * fraction,
            ]);
        }
    }
    positions.push(ordered[ordered.len() - 1].0);
    colours.push(lab[lab.len() - 1]);
    (positions, colours)
}

/// One map's stops, levelled. `autolevel.curved_stops`.
///
/// The positions are the densified ramp's own and are handed back unrounded. The
/// Python side rounds them to nine decimal places before writing a colormap file,
/// which is a JSON-legibility step taken on the way to disk; there is no disk
/// here, and a position is spent by `from_stops_baked` against a 4,096-entry table
/// where nine decimal places and seventeen index the same entry.
pub fn curved_stops(stops: &[(f64, [u8; 3])], curve: &Curve) -> Vec<(f64, [u8; 3])> {
    // A ramp of fewer than two stops is not a ramp, and `from_stops_baked` is where
    // that is refused. Handing it back untouched keeps the refusal there rather than
    // spending it here as an underflow in the subdivision.
    if stops.len() < 2 {
        return stops.to_vec();
    }
    let (positions, lab) = densify(stops);
    positions
        .into_iter()
        .zip(lab)
        .map(|(position, [lightness, green_red, blue_yellow])| {
            let moved = curve.lightness(lightness);
            let capped = cap_lightness(lightness, moved, green_red, blue_yellow);
            (position, gamut_fit([capped, green_red, blue_yellow]))
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::{Curve, curved_stops};
    use std::path::PathBuf;

    /// **The port against the operator itself, on the operator's own answers.**
    ///
    /// `level-cases.json` beside the crate holds four `(map, curve)` pairs and the
    /// stop list `fractal_wallpapers.coloring.autolevel.curved_stops` returns for
    /// each, as hex. They are not arbitrary: one map of each stop count the library
    /// holds — 33, 34, 257 and 512 — one cyclic and three sequential, one authored
    /// and two extracted and one from matplotlib's CET set, exponents on both sides
    /// of 1 and one clamped at the operator's own ceiling, and the chroma cap firing
    /// on 22 stops in the mildest case and on 1,524 in the hardest. A port that got
    /// the piecewise curve right and the cap's bisection wrong passes none of them.
    ///
    /// Regenerated, when a case has to move, by the operator in the sibling checkout:
    ///
    /// ```text
    /// from fractal_wallpapers.coloring import autolevel
    /// out, capped = autolevel.curved_stops(loaded["stops"], curve)
    /// ```
    ///
    /// The gradients are read from the sibling library rather than restated here,
    /// which is the same path dependency the crate already has on that checkout —
    /// so this test is skipped where the sibling is not there rather than failing,
    /// exactly as `builder check`'s own bake is.
    ///
    /// The measurement behind the fixture is wider than the fixture: **261 maps over
    /// 261 distinct recorded curves, 1,467,495 stop bytes, 0 different** (2026-09-15).
    #[test]
    fn the_port_is_the_operator() {
        let library = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../../fractal-wallpapers/data/palettes");
        if !library.is_dir() {
            eprintln!("no sibling colormap library at {}; skipped", library.display());
            return;
        }
        let fixture = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("level-cases.json");
        let cases: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(&fixture).expect("level-cases.json"))
                .expect("level-cases.json parses");

        for case in cases.as_array().expect("a list of cases") {
            let name = case["map"].as_str().expect("a map name");
            let loaded: serde_json::Value = serde_json::from_str(
                &std::fs::read_to_string(library.join(format!("{name}.json")))
                    .unwrap_or_else(|e| panic!("reading {name}: {e}")),
            )
            .unwrap_or_else(|e| panic!("parsing {name}: {e}"));
            let stops: Vec<(f64, [u8; 3])> = loaded["stops"]
                .as_array()
                .expect("stops")
                .iter()
                .map(|stop| {
                    let rgb = stop[1].as_array().expect("a colour");
                    let channel = |at: usize| rgb[at].as_u64().expect("a channel") as u8;
                    (
                        stop[0].as_f64().expect("a position"),
                        [channel(0), channel(1), channel(2)],
                    )
                })
                .collect();
            let curve: Curve =
                serde_json::from_value(case["curve"].clone()).expect("the recorded curve");

            let ours: String = curved_stops(&stops, &curve)
                .iter()
                .map(|(_, rgb)| format!("{:02x}{:02x}{:02x}", rgb[0], rgb[1], rgb[2]))
                .collect();
            let theirs = case["colors"].as_str().expect("the operator's answer");
            assert_eq!(
                ours.len() / 6,
                theirs.len() / 6,
                "{name}: this port makes {} stop(s) where the operator makes {}",
                ours.len() / 6,
                theirs.len() / 6
            );
            if ours != theirs {
                let at = ours
                    .char_indices()
                    .zip(theirs.chars())
                    .find(|((_, one), other)| one != other)
                    .map(|((index, _), _)| index / 6)
                    .unwrap_or(0);
                panic!(
                    "{name}: stop {at} of {} is {} here and {} in the operator, so this port \
                     and `band_autolevel/v1` no longer agree about the same ramp",
                    ours.len() / 6,
                    &ours[at * 6..at * 6 + 6],
                    &theirs[at * 6..at * 6 + 6]
                );
            }
        }
    }
}
