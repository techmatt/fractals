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
//! **Both halves are here.** A run recorded what it did, so for a gallery seat
//! the measurement is already made: its permalink carries the curve the run
//! derived, and the apply half replays it — which is the whole reason the explorer
//! can show a seat's own colour without reading a picture it has not drawn yet.
//! A view a reader made has no record, and since `autolevel_port_ckpt127` the
//! measure half is ported too ([`tone_stats`], [`derive_curve`]) and runs on the
//! finished picture that view drew. Its pins are at the foot of this file: the
//! stored curve out of the stored statistics on every backfill row, bit for bit,
//! and the stored statistics out of the operator's own decoded pixels.
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

// --------------------------------------------------------------------------- //
// The measure half: a finished picture to the curve its tone earns.
// --------------------------------------------------------------------------- //

/// The band of finished wallpapers each statistic is projected onto, `[low, high]`.
///
/// Transcribed from `data/coloring/levels_band.json` next door, full doubles,
/// sha256 `49d4f43b200904c5967df788308834be163698081d85802df978554261aa63a1`
/// (derived 2026-08-15, 48 images) — the sha every recorded stamp names. A
/// different band is a different operator's answer, and a gallery seat levelled
/// under this one would stop agreeing with a view levelled here.
const BAND_BLACK: [f64; 2] = [0.0, 0.3008176686683185];
const BAND_WHITE: [f64; 2] = [0.8629886965307019, 0.9960350764349456];
const BAND_MID: [f64; 2] = [0.2663290436868155, 0.7380826210003913];

/// The robust black and white percentiles of Oklab L. `autolevel.CLIP_LO`, `CLIP_HI`.
const CLIP_LO: f64 = 0.5;
const CLIP_HI: f64 = 99.5;

/// Oklab L floor of the structure mask the midtone is read over. `autolevel.MASK_L`.
const MASK_L: f64 = 0.04;

/// Oklab chroma at or below which a pixel reads as neutral. `autolevel.CHROMA_NEUTRAL`.
const CHROMA_NEUTRAL: f64 = 0.06;

/// A neutral subset thinner than this share reads no black point.
/// `autolevel.NEUTRAL_FRACTION_MIN`.
const NEUTRAL_FRACTION_MIN: f64 = 0.05;

/// A neutral black this far above the all-pixel black means the dark tail is
/// coloured rather than dim. `autolevel.DARK_MARGIN`.
const DARK_MARGIN: f64 = 0.10;

/// How few neutral pixels are too few for a percentile to mean anything.
/// `autolevel.NEUTRAL_PIXELS_MIN`; the test is strictly more than this.
const NEUTRAL_PIXELS_MIN: usize = 64;

/// The exponent is clamped to `[1/this, this]`. `autolevel.EXPONENT_CLAMP`.
const EXPONENT_CLAMP: f64 = 2.0;

/// White and black closer than this have no range to curve. `autolevel.MIN_RANGE`.
const MIN_RANGE: f64 = 0.05;

/// The three statistics the band is read on. `autolevel.tone_stats`, the fields
/// [`derive_curve`] reads and nothing else.
#[derive(Debug, Clone, Copy, PartialEq, Deserialize)]
pub struct ToneStats {
    /// The guarded black point: `None` where the chroma guard declares it
    /// unmeasurable.
    pub black_pt: Option<f64>,
    pub black_pt_all: f64,
    pub white_pt: f64,
    pub mid: f64,
}

/// `numpy.percentile(values, q)` under its default `linear` method, **bit for bit**.
///
/// Not the engine's `coloring::percentile`, which is nearest-rank and answers a
/// different number. numpy forms the virtual index as `n*q + (1 + q*(1-α-β)) - 1`
/// with `α = β = 1`, and its `_lerp` switches form at a weight of one half so that
/// the interpolation is exact at both ends; both orders of operation are kept here,
/// because a percentile one unit of last place off is a curve that is not the
/// operator's. Selects rather than sorts, so it reorders `values`.
fn percentile(values: &mut [f64], q: f64) -> f64 {
    let n = values.len();
    let quantile = q / 100.0;
    let virtual_index = n as f64 * quantile + (1.0 + quantile * (1.0 - 1.0 - 1.0)) - 1.0;
    if virtual_index >= (n - 1) as f64 {
        return values.iter().copied().fold(f64::NEG_INFINITY, f64::max);
    }
    if virtual_index < 0.0 {
        return values.iter().copied().fold(f64::INFINITY, f64::min);
    }
    let previous = virtual_index.floor();
    let gamma = virtual_index - previous;
    let below = previous as usize;
    let (_, &mut a, upper) = values.select_nth_unstable_by(below, f64::total_cmp);
    let b = upper.iter().copied().fold(f64::INFINITY, f64::min);
    let difference = b - a;
    if gamma >= 0.5 {
        b - difference * (1.0 - gamma)
    } else {
        a + difference * gamma
    }
}

/// `numpy.median`: the middle value, or the mean of the middle two.
fn median(values: &mut [f64]) -> f64 {
    let n = values.len();
    let half = n / 2;
    if n % 2 == 1 {
        return *values.select_nth_unstable_by(half, f64::total_cmp).1;
    }
    let (lower, &mut high, _) = values.select_nth_unstable_by(half, f64::total_cmp);
    let low = lower.iter().copied().fold(f64::NEG_INFINITY, f64::max);
    (low + high) / 2.0
}

/// One rendered picture's tone statistics. `autolevel.tone_stats`.
///
/// `rgb` is packed three or four bytes a pixel — `channels` says which — and only
/// the first three are read. Per pixel: sRGB8 to Oklab through the engine's own
/// conversion (the same arithmetic as `palettes.space.lightness_and_chroma`, whose
/// table is the same expression evaluated at the 256 codes), kept as lightness and
/// `hypot(a, b)`.
pub fn tone_stats(rgb: &[u8], channels: usize) -> ToneStats {
    let count = rgb.len() / channels;
    let mut table = [0.0_f64; 256];
    for (code, linear) in table.iter_mut().enumerate() {
        *linear = srgb_to_linear(code as f64 / 255.0);
    }
    let mut lightness = Vec::with_capacity(count);
    let mut neutral = Vec::new();
    let mut structure = Vec::new();
    for pixel in rgb.chunks_exact(channels) {
        let [lit, green_red, blue_yellow] = linear_srgb_to_oklab([
            table[pixel[0] as usize],
            table[pixel[1] as usize],
            table[pixel[2] as usize],
        ]);
        lightness.push(lit);
        if lit > MASK_L {
            structure.push(lit);
        }
        if green_red.hypot(blue_yellow) <= CHROMA_NEUTRAL {
            neutral.push(lit);
        }
    }

    let neutrals = neutral.len();
    let share = neutrals as f64 / count as f64;
    let neutral_black = (neutrals > NEUTRAL_PIXELS_MIN).then(|| percentile(&mut neutral, CLIP_LO));
    let middle = if structure.is_empty() {
        median(&mut lightness.clone())
    } else {
        median(&mut structure)
    };
    let all_black = percentile(&mut lightness, CLIP_LO);
    let white = percentile(&mut lightness, CLIP_HI);

    let black = match neutral_black {
        Some(value) if share >= NEUTRAL_FRACTION_MIN && value - all_black <= DARK_MARGIN => {
            Some(value)
        }
        _ => None,
    };
    ToneStats {
        black_pt: black,
        black_pt_all: all_black,
        white_pt: white,
        mid: middle,
    }
}

/// `(projected, side)` — inside a band a value is itself, outside it is the nearest
/// edge. `autolevel.project`.
fn project(value: f64, band: [f64; 2]) -> f64 {
    if value < band[0] {
        band[0]
    } else if value > band[1] {
        band[1]
    } else {
        value
    }
}

/// What the operator decided about one picture.
#[derive(Debug, Clone, Copy)]
pub enum Decision {
    /// White and black too close to curve. `applies: false`.
    Degenerate,
    /// All three statistics already in band: the exact identity, and no curve.
    Identity(Curve),
    /// A curve that moves the picture.
    Acts(Curve),
}

/// The tone curve for one picture's statistics. `autolevel.derive_curve`, verbatim.
pub fn derive_curve(statistics: &ToneStats) -> Decision {
    let measured_black = statistics.black_pt;
    let black = measured_black.unwrap_or(statistics.black_pt_all);
    let (white, middle) = (statistics.white_pt, statistics.mid);

    if white - black < MIN_RANGE {
        return Decision::Degenerate;
    }

    let low = match measured_black {
        None => black,
        Some(value) => project(value, BAND_BLACK),
    };
    let high = project(white, BAND_WHITE);
    let target = project(middle, BAND_MID);

    let position = (middle - black) / (white - black);
    let wanted = if high > low {
        (target - low) / (high - low)
    } else {
        0.5
    };
    let inside = |value: f64| 1e-4 < value && value < 1.0 - 1e-4;
    let exponent = if !inside(position) || !inside(wanted) {
        1.0
    } else {
        wanted.ln() / position.ln()
    };
    let exponent = exponent.max(1.0 / EXPONENT_CLAMP).min(EXPONENT_CLAMP);

    let curve = Curve {
        black_pt: black,
        white_pt: white,
        exponent,
        out_ends: [low, high],
    };
    if (low - black).abs() < 1e-9 && (high - white).abs() < 1e-9 && (exponent - 1.0).abs() < 1e-9 {
        Decision::Identity(curve)
    } else {
        Decision::Acts(curve)
    }
}

/// A finished picture to the curve that levels it, or `None` where the operator
/// would leave it exactly alone.
pub fn derive(rgb: &[u8], channels: usize) -> Option<Curve> {
    match derive_curve(&tone_stats(rgb, channels)) {
        Decision::Acts(curve) => Some(curve),
        Decision::Identity(_) | Decision::Degenerate => None,
    }
}

#[cfg(test)]
mod tests {
    use super::{Curve, Decision, ToneStats, curved_stops, derive_curve, tone_stats};
    use std::path::PathBuf;

    fn derive_cases() -> serde_json::Value {
        let fixture = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("level-derive-cases.json");
        serde_json::from_str(&std::fs::read_to_string(&fixture).expect("level-derive-cases.json"))
            .expect("level-derive-cases.json parses")
    }

    fn stats_of(value: &serde_json::Value) -> ToneStats {
        serde_json::from_value(value.clone()).expect("four statistics")
    }

    /// Which decision a recorded curve block is, and its curve, as the port spells it.
    fn recorded(curve: &serde_json::Value) -> Decision {
        if curve["applies"] == false {
            return Decision::Degenerate;
        }
        let held = Curve {
            black_pt: curve["black_pt"].as_f64().expect("black_pt"),
            white_pt: curve["white_pt"].as_f64().expect("white_pt"),
            exponent: curve["exponent"].as_f64().expect("exponent"),
            out_ends: [
                curve["out_ends"][0].as_f64().expect("out_ends[0]"),
                curve["out_ends"][1].as_f64().expect("out_ends[1]"),
            ],
        };
        if curve["identity"] == true {
            Decision::Identity(held)
        } else {
            Decision::Acts(held)
        }
    }

    fn same(ours: &Decision, theirs: &Decision) -> bool {
        let bits = |c: &Curve| {
            [
                c.black_pt.to_bits(),
                c.white_pt.to_bits(),
                c.exponent.to_bits(),
                c.out_ends[0].to_bits(),
                c.out_ends[1].to_bits(),
            ]
        };
        match (ours, theirs) {
            (Decision::Degenerate, Decision::Degenerate) => true,
            (Decision::Identity(a), Decision::Identity(b)) | (Decision::Acts(a), Decision::Acts(b)) => {
                bits(a) == bits(b)
            }
            _ => false,
        }
    }

    /// **`derive_curve` is the operator's, to the last bit.** Every case in
    /// `level-derive-cases.json` is a row's stored measured statistics and the curve the
    /// operator stored beside them — plus three synthetic statistics for branches no
    /// recorded row reaches, answered by the operator itself. Regenerated by
    /// `make-derive-cases.py`.
    #[test]
    fn the_derivation_is_the_operator() {
        let cases = derive_cases();
        for case in cases["curves"].as_array().expect("curve cases") {
            let ours = derive_curve(&stats_of(&case["measured"]));
            let theirs = recorded(&case["curve"]);
            assert!(
                same(&ours, &theirs),
                "{} ({}): the port derives {ours:?} and the operator stored {theirs:?}",
                case["key"],
                case["why"]
            );
        }
    }

    /// The same, over every row of the sidecar next door, where this machine has it.
    ///
    /// The sidecar lives in the wallpaper project's ignored store, so this is skipped by
    /// name on any other machine; the fixture above is the committed part of the claim.
    #[test]
    fn the_derivation_is_the_operator_on_every_backfill_row() {
        let sidecar = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../../fractal-wallpapers/artifacts/curation/autolevel_backfill.jsonl");
        let Ok(text) = std::fs::read_to_string(&sidecar) else {
            eprintln!("no autolevel_backfill.jsonl at {}; skipped", sidecar.display());
            return;
        };
        let (mut rows, mut different) = (0, Vec::new());
        for line in text.lines().filter(|line| !line.trim().is_empty()) {
            let row: serde_json::Value = serde_json::from_str(line).expect("a backfill row");
            let ours = derive_curve(&stats_of(&row["autolevel"]["measured"]));
            let theirs = recorded(&row["autolevel"]["curve"]);
            rows += 1;
            if !same(&ours, &theirs) {
                different.push(row["key"].to_string());
            }
        }
        eprintln!("{} of {rows} backfill rows derive the stored curve", rows - different.len());
        assert!(different.is_empty(), "{} row(s) differ: {:?}", different.len(), &different[..different.len().min(10)]);
    }

    /// **`tone_stats` reads a picture the way the operator does.** Each stats case is a
    /// base render drawn again at its candidate geometry, JPEG-decoded by PIL; the maker
    /// refuses one whose Python statistics are not the row's stored ones, so the pixels
    /// are the pixels the curve was taken off. The pixels are in ignored `artifacts/`,
    /// and a case without them is skipped by name.
    #[test]
    fn the_measurement_is_the_operator() {
        let cases = derive_cases();
        let pixels = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../artifacts/level-derive");
        for case in cases["stats"].as_array().expect("stats cases") {
            let key = case["key"].as_str().expect("a key");
            let Ok(rgb) = std::fs::read(pixels.join(format!("{key}.rgb"))) else {
                eprintln!("{key}: no decoded base in artifacts/level-derive; skipped (run make-derive-cases.py)");
                continue;
            };
            let expected_len = case["width"].as_u64().unwrap() * case["height"].as_u64().unwrap() * 3;
            assert_eq!(rgb.len() as u64, expected_len, "{key}: the decoded base is the wrong size");
            let ours = tone_stats(&rgb, 3);
            let theirs = stats_of(&case["measured"]);
            let far = |a: f64, b: f64| (a - b).abs();
            match (ours.black_pt, theirs.black_pt) {
                (Some(a), Some(b)) => assert!(far(a, b) < 1e-6, "{key}: black_pt {a} vs {b}"),
                (None, None) => {}
                (a, b) => panic!("{key}: black_pt guard disagrees, {a:?} vs {b:?}"),
            }
            for (name, a, b) in [
                ("black_pt_all", ours.black_pt_all, theirs.black_pt_all),
                ("white_pt", ours.white_pt, theirs.white_pt),
                ("mid", ours.mid, theirs.mid),
            ] {
                assert!(far(a, b) < 1e-6, "{key}: {name} {a} here and {b} in the operator");
            }
            eprintln!(
                "{key}: largest difference {:e}",
                [
                    far(ours.black_pt.unwrap_or(0.0), theirs.black_pt.unwrap_or(0.0)),
                    far(ours.black_pt_all, theirs.black_pt_all),
                    far(ours.white_pt, theirs.white_pt),
                    far(ours.mid, theirs.mid)
                ]
                .into_iter()
                .fold(0.0, f64::max)
            );
        }
    }

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
