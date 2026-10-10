//! Per-frame constants, and `dc` formed the way the GPU would form it.
//!
//! `perturb` gives each sample its offset as an `f64` pair, `Spec::dc`:
//! `offset + ((col + 0.5) / W - 0.5) · width` across and the same down. A shader cannot
//! take that pair, and narrowing it to `f32` would underflow below about 1e-38 anyway.
//! So the frame is reduced on the CPU to a few constants, each an `f32` mantissa
//! against one shared power of two, and every invocation builds its own `dc` from its
//! integer column and row:
//!
//! ```text
//! dc = (offset_m + (col + 0.5 - W/2) · spacing_m,
//!       offset_m' + (H/2 - row - 0.5) · spacing_m) · 2^sc
//! ```
//!
//! `col + 0.5 - W/2` is a half-integer and exact in `f32` for any width below `2^22`.
//! The product rounds once and the sum rounds once (written as two operations, never a
//! fused multiply-add), so the mantissa carries about two `f32` roundings where
//! `perturb`'s carries two `f64` ones, plus the narrowing of `offset` and `spacing`
//! themselves. **The residual against `Spec::dc` is a relative error of a few parts in
//! `2^24` of `max(|offset|, |pixel offset|)`**: a tenth of a millionth of a pixel on a
//! frame centered on its reference. Where the reference is far from the center in pixel
//! units (a Julia frame anchored at `c` and viewed away from it), `offset_m` dominates
//! the sum and the pixel offset keeps only `24 - log2(|offset| / spacing)` bits; past
//! `2^24` pixels of offset the samples of a row collapse onto one another. That is a
//! property of an `f32` delta, not of this construction, and
//! [`Frame::offset_in_pixels`] reports it per frame.

use perturb::{Anchor, Spec};

use crate::ds::{self, Cds};
use crate::orbit::{Encoding, narrow};
use crate::proof::{Margins, Precision};
use crate::wgsl;

/// Everything the per-pixel loop reads that is the same for every pixel of a frame.
/// Plain `f32`, `i32` and `u32` fields in `#[repr(C)]` order, so it is a uniform buffer
/// as it stands: `offset_m` is a `vec2<f32>` at offset 8, and the struct is 64 bytes, the
/// last 16 of them the interior proof's margins.
#[repr(C)]
#[derive(Debug, Clone, Copy)]
pub struct Frame {
    /// Samples across and down.
    pub width_px: u32,
    pub height_px: u32,
    /// The view center's offset from the reference's starting point, as a mantissa
    /// against `2^sc`.
    pub offset_m: [f32; 2],
    /// The distance between neighbouring samples, as a mantissa against `2^sc`.
    pub spacing_m: f32,
    /// The frame's shared exponent: `dc = dc_m · 2^sc`.
    pub sc: i32,
    pub maxiter: u32,
    /// 2 to 6.
    pub degree: u32,
    /// 1 on a Julia plane, 0 on the parameter plane.
    pub julia: u32,
    /// The reference index a Julia sample starts at (1 at the `z = c` anchor).
    pub entry: u32,
    /// 0 with the interior switch off; otherwise the switch runs, and the value is the
    /// [`GatedPolicy`]'s code, what becomes of a sample the gate fired on and the proof
    /// never closed ([`crate::model`]'s module doc).
    pub interior: u32,
    /// The interior switch's gate: a sample with `|dz|² < 2^floor` is handed to the proof.
    pub floor: i32,
    /// The proof's margins for an `f32` kernel at this degree ([`proof::Margins::new`]).
    pub margins: Margins,
}

/// What becomes of a gated sample the proof never closes on, set per frame in
/// [`Frame::interior`]. The proof is sound at either precision but not complete: a cycle
/// whose return gathers more rounding than its disc holds is never proved, and a sample
/// beside a parabolic point (which is not interior) is gated for as long as it creeps.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GatedPolicy {
    /// Run on to the escape or the cap; at the cap the status is `CAPPED`, painted as
    /// interior, which is what `perturb` does with a sample it cannot prove.
    Cap = 1,
    /// Run on to the escape or the cap; at the cap the status is `GATED`, so that the
    /// caller can hand the sample to the CPU's `f64` kernel.
    Flag = 2,
    /// Stop with `GATED` as soon as the proof gives up (its discs spent or dead), and leave
    /// the rest to the CPU. A parabolic sample is handed over too, escaping or not.
    Handoff = 3,
}

impl GatedPolicy {
    /// The value [`Frame::interior`] carries.
    pub fn code(self) -> u32 {
        self as u32
    }

    /// The name the comparison harness prints and parses.
    pub fn name(self) -> &'static str {
        match self {
            GatedPolicy::Cap => "cap",
            GatedPolicy::Flag => "flag",
            GatedPolicy::Handoff => "handoff",
        }
    }

    /// Parses `cap`, `flag` or `handoff`.
    pub fn parse(text: &str) -> Option<GatedPolicy> {
        match text {
            "cap" => Some(GatedPolicy::Cap),
            "flag" => Some(GatedPolicy::Flag),
            "handoff" => Some(GatedPolicy::Handoff),
            _ => None,
        }
    }
}

impl Frame {
    /// Reduces a `perturb::Spec` to the frame constants. CPU-side setup: this is where
    /// the `f64` offset is read and narrowed.
    pub fn from_spec(spec: &Spec, orbit_len: usize) -> Result<Frame, String> {
        let offset = spec.centre_offset()?;
        let width_px = spec.sample_width();
        let height_px = spec.sample_height();
        let spacing = spec.width / width_px as f64;
        // The shared exponent: the larger of the offset and the frame's own width,
        // so both mantissas are at most about 2 and the pixel term keeps every bit it
        // can.
        let big = offset.0.abs().max(offset.1.abs()).max(spec.width);
        let sc = exponent_f64(big);
        let unit = 2f64.powi(-sc);
        // `Kernel::run` clamps the entry the same way, for an orbit that escaped at
        // its first step.
        let entry = spec.entry().min(orbit_len.saturating_sub(1)) as u32;
        Ok(Frame {
            width_px,
            height_px,
            offset_m: [narrow(offset.0 * unit), narrow(offset.1 * unit)],
            spacing_m: narrow(spacing * unit),
            sc,
            maxiter: spec.maxiter(),
            degree: spec.degree,
            julia: spec.julia.is_some() as u32,
            entry,
            interior: if spec.interior {
                GatedPolicy::Cap.code()
            } else {
                0
            },
            floor: perturb::kernel::INTERIOR_EXPONENT,
            margins: Margins::new(spec.degree, Precision::F32, Encoding::F32Pair),
        })
    }

    /// The same frame with a gated sample treated by `policy`; a frame with the interior
    /// switch off is returned as it is.
    pub fn with_policy(mut self, policy: GatedPolicy) -> Frame {
        if self.interior != 0 {
            self.interior = policy.code();
        }
        self
    }

    /// `dc` for sample `(col, row)`, as an `f32` mantissa pair against `2^sc`. This is
    /// the per-pixel half and uses `f32` only.
    #[inline(always)]
    pub fn dc_mantissa(&self, col: u32, row: u32) -> [f32; 2] {
        let across = col as f32 + 0.5 - self.width_px as f32 * 0.5;
        let down = self.height_px as f32 * 0.5 - (row as f32 + 0.5);
        let re = across * self.spacing_m;
        let im = down * self.spacing_m;
        [self.offset_m[0] + re, self.offset_m[1] + im]
    }

    /// `dc` for sample `(col, row)` in double-single, against `2^sc`: the same sum as
    /// [`Frame::dc_mantissa`] with `offset` and `spacing` read as `hi + lo` pairs.
    /// `col + 0.5 - W/2` is exact in `f32`, so the product is [`ds::mul_f32`] and the sum
    /// one accurate [`ds::add`]: about `2^-47` of `max(|offset|, |pixel offset|)`, where
    /// the `f32` sum carries `2^-24`. Without it the delta could be carried to 48 bits and
    /// would still start from a `dc` rounded to 24. Per pixel and `f32` only; 84 `f32`
    /// operations a pass (42 a component), against [`Frame::dc_mantissa`]'s 4.
    #[inline(always)]
    pub fn dc_ds(&self, lo: &FrameLo, col: u32, row: u32) -> Cds {
        let across = col as f32 + 0.5 - self.width_px as f32 * 0.5;
        let down = self.height_px as f32 * 0.5 - (row as f32 + 0.5);
        let spacing = ds::from_hi_lo(self.spacing_m, lo.spacing_lo);
        let re = ds::mul_f32(spacing, across);
        let im = ds::mul_f32(spacing, down);
        [
            ds::add(ds::from_hi_lo(self.offset_m[0], lo.offset_lo[0]), re),
            ds::add(ds::from_hi_lo(self.offset_m[1], lo.offset_lo[1]), im),
        ]
    }

    /// The view center's distance from the reference, in samples (Chebyshev). Above
    /// `2^24` an `f32` delta cannot tell neighbouring samples apart; above about `2^20`
    /// it keeps four bits or fewer of the pixel position.
    pub fn offset_in_pixels(&self) -> f64 {
        let far = wgsl::max_abs(self.offset_m[0], self.offset_m[1]) as f64;
        far / self.spacing_m as f64
    }
}

/// What a double-single kernel adds to [`Frame`]: the low halves of the offset and the
/// spacing, each the `f32` nearest what the high half (the [`Frame`] field) left of the
/// `f64` value, against the same `2^sc`, and the interior proof's margins for a
/// double-single kernel on a `HiLo` reference, which replace [`Frame::margins`]. A uniform
/// of its own, 32 bytes (`offset_lo` a `vec2<f32>` at 0, `spacing_lo` at 8, a pad word,
/// the margins at 16), rather than more fields on [`Frame`]: the `f32` kernel's uniform
/// carries nothing it does not read, and a shader binds this one only in its DS variant.
#[repr(C)]
#[derive(Debug, Clone, Copy)]
pub struct FrameLo {
    pub offset_lo: [f32; 2],
    pub spacing_lo: f32,
    pub pad: u32,
    pub margins: Margins,
}

impl FrameLo {
    /// The low halves for `frame`, which [`Frame::from_spec`] made from `spec`. CPU-side
    /// setup, `f64`: `x·2^-sc − hi` is exact in `f64`, since `hi` is within half an `f32`
    /// ulp of `x·2^-sc` (the argument [`crate::orbit`] makes for the reference's `lo`).
    pub fn from_spec(spec: &Spec, frame: &Frame) -> Result<FrameLo, String> {
        let offset = spec.centre_offset()?;
        let spacing = spec.width / spec.sample_width() as f64;
        let unit = 2f64.powi(-frame.sc);
        let lo = |x: f64, hi: f32| narrow(x * unit - hi as f64);
        Ok(FrameLo {
            offset_lo: [
                lo(offset.0, frame.offset_m[0]),
                lo(offset.1, frame.offset_m[1]),
            ],
            spacing_lo: lo(spacing, frame.spacing_m),
            pad: 0,
            margins: Margins::new(frame.degree, Precision::DoubleSingle, Encoding::HiLo),
        })
    }
}

/// The unbiased binary exponent of a positive finite `f64`: `x` is in `[2^e, 2^(e+1))`.
fn exponent_f64(x: f64) -> i32 {
    if x.is_nan() || x <= 0.0 || !x.is_finite() {
        return 0;
    }
    let field = ((x.to_bits() >> 52) & 0x7ff) as i32;
    if field == 0 {
        // Subnormal f64: far below anything a frame reaches, but total all the same.
        return -1023;
    }
    field - 1023
}

/// The `Spec` a corpus row or a command line describes, built as a struct literal the
/// way `builder/deep-gallery-native` builds it.
#[allow(clippy::too_many_arguments)]
pub fn spec_of(
    re: &str,
    im: &str,
    width: f64,
    resolution: [u32; 2],
    maxiter: Option<u32>,
    degree: u32,
    julia: Option<(&str, &str)>,
    anchor: Anchor,
    period: Option<u32>,
    interior: bool,
) -> Spec {
    Spec {
        center_re: re.into(),
        center_im: im.into(),
        width,
        resolution,
        supersample: 1,
        maxiter,
        reference: None,
        period,
        julia: julia.map(|(a, b)| (a.into(), b.into())),
        anchor,
        interior,
        degree,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::mem::{offset_of, size_of};

    /// The uniform buffer's WGSL layout: `offset_m` (a `vec2<f32>`, 8-byte aligned) at 8,
    /// the margins (four `i32`) at 48.
    #[test]
    fn frame_is_64_bytes_in_wgsl_layout() {
        assert_eq!(size_of::<Margins>(), 16);
        assert_eq!(size_of::<Frame>(), 64);
        assert_eq!(offset_of!(Frame, width_px), 0);
        assert_eq!(offset_of!(Frame, height_px), 4);
        assert_eq!(offset_of!(Frame, offset_m), 8);
        assert_eq!(offset_of!(Frame, spacing_m), 16);
        assert_eq!(offset_of!(Frame, sc), 20);
        assert_eq!(offset_of!(Frame, maxiter), 24);
        assert_eq!(offset_of!(Frame, degree), 28);
        assert_eq!(offset_of!(Frame, julia), 32);
        assert_eq!(offset_of!(Frame, entry), 36);
        assert_eq!(offset_of!(Frame, interior), 40);
        assert_eq!(offset_of!(Frame, floor), 44);
        assert_eq!(offset_of!(Frame, margins), 48);
    }

    #[test]
    fn dc_matches_perturb_to_f32_rounding() {
        let spec = spec_of(
            "-0.745",
            "0.15",
            1e-30,
            [160, 90],
            Some(1000),
            2,
            None,
            Anchor::Parameter,
            None,
            true,
        );
        let frame = Frame::from_spec(&spec, 2).unwrap();
        let offset = spec.centre_offset().unwrap();
        let unit = 2f64.powi(frame.sc);
        for &(col, row) in &[(0u32, 0u32), (159, 89), (80, 45), (13, 70)] {
            let (re, im) = spec.dc(offset, col, row);
            let m = frame.dc_mantissa(col, row);
            let (mre, mim) = (m[0] as f64 * unit, m[1] as f64 * unit);
            assert!((mre - re).abs() <= 1e-6 * spec.width, "{col} {row}");
            assert!((mim - im).abs() <= 1e-6 * spec.width, "{col} {row}");
        }
    }

    #[test]
    fn frame_lo_is_32_bytes_in_wgsl_layout() {
        assert_eq!(size_of::<FrameLo>(), 32);
        assert_eq!(offset_of!(FrameLo, offset_lo), 0);
        assert_eq!(offset_of!(FrameLo, spacing_lo), 8);
        assert_eq!(offset_of!(FrameLo, margins), 16);
    }

    /// The double-single `dc` agrees with `perturb`'s `f64` one to about `2^-47` of the
    /// frame, where the `f32` one agrees to `2^-24`; off-centre, so the offset term counts.
    #[test]
    fn dc_ds_matches_perturb_to_double_single_rounding() {
        let spec = spec_of(
            "-0.745",
            "0.15",
            1e-30,
            [160, 90],
            Some(1000),
            2,
            None,
            Anchor::Parameter,
            None,
            true,
        );
        let mut off = spec.clone();
        off.reference = Some(("-0.74500000000000000000000000000137".into(), "0.15".into()));
        for spec in [spec, off] {
            let frame = Frame::from_spec(&spec, 2).unwrap();
            let lo = FrameLo::from_spec(&spec, &frame).unwrap();
            let offset = spec.centre_offset().unwrap();
            let unit = 2f64.powi(frame.sc);
            for &(col, row) in &[(0u32, 0u32), (159, 89), (80, 45), (13, 70)] {
                let (re, im) = spec.dc(offset, col, row);
                let m = frame.dc_ds(&lo, col, row);
                let (mre, mim) = (ds::to_f64(m[0]) * unit, ds::to_f64(m[1]) * unit);
                assert!((mre - re).abs() <= 2e-14 * spec.width, "{col} {row}");
                assert!((mim - im).abs() <= 2e-14 * spec.width, "{col} {row}");
            }
        }
    }
}
