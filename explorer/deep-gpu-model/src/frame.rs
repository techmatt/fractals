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

use crate::orbit::narrow;
use crate::wgsl;

/// Everything the per-pixel loop reads that is the same for every pixel of a frame.
/// Plain `f32`, `i32` and `u32` fields in `#[repr(C)]` order, so it is a uniform buffer
/// as it stands: `offset_m` is a `vec2<f32>` at offset 8, and the struct is 48 bytes.
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
    /// 1 when the interior switch runs.
    pub interior: u32,
    /// The interior switch's threshold: `|dz|² < 2^floor` proves interior.
    pub floor: i32,
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
            interior: spec.interior as u32,
            floor: perturb::kernel::INTERIOR_EXPONENT,
        })
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

    /// The view center's distance from the reference, in samples (Chebyshev). Above
    /// `2^24` an `f32` delta cannot tell neighbouring samples apart; above about `2^20`
    /// it keeps four bits or fewer of the pixel position.
    pub fn offset_in_pixels(&self) -> f64 {
        let far = wgsl::max_abs(self.offset_m[0], self.offset_m[1]) as f64;
        far / self.spacing_m as f64
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

    /// The uniform buffer's WGSL layout: `offset_m` (a `vec2<f32>`, 8-byte aligned) at 8.
    #[test]
    fn frame_is_48_bytes_in_wgsl_layout() {
        assert_eq!(size_of::<Frame>(), 48);
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
}
