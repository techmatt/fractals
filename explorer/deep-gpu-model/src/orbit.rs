//! The reference orbit as the GPU would hold it.
//!
//! `perturb` keeps `Z[m]` as an `f64` pair, rounded from its fixed-point orbit by
//! `Fx::to_f64`. A WGSL storage buffer holds no `f64`, so the orbit is narrowed once on
//! the CPU, in one of two encodings chosen at run time:
//!
//! - [`Encoding::F32Pair`]: `(re, im)` as two `f32`, eight bytes a point. Rounding the
//!   reference to 24 bits is the first place precision goes, and this is the encoding
//!   that measures how much.
//! - [`Encoding::HiLo`]: each component as `hi + lo`, with `hi` the `f32` nearest the
//!   `f64` and `lo` the `f32` nearest what is left, sixteen bytes a point. Together they
//!   carry about 48 bits of the `f64`.
//!
//! **Double rounding.** `Fx::to_f64` sums the top two limbs and is not guaranteed to be
//! correctly rounded, and narrowing that `f64` to `f32` rounds again, so `hi` can differ
//! from the correctly rounded `f32` of the exact orbit point in its last bit. That is a
//! difference of one `f32` ulp at most and it is the same on the CPU and the GPU, since
//! both read this buffer.
//!
//! **No subnormals.** A narrowed component below `f32`'s normal range (an `re` under
//! `1.18e-38`, or a `lo` under the `hi` of a point smaller than about `2^-101`) is stored
//! as a signed zero, which is what a GPU that flushes subnormals would read anyway; the
//! CPU, the scaled rebase path and a GPU therefore all read one buffer the same way.
//! That flush is an **absolute** error, up to `2^-126` a component, which no relative
//! bound on the stored point covers: below about `2^-101` (`HiLo`'s `lo`) or `2^-126`
//! (`hi`) the stored point can be off by more than its own size. [`GpuOrbit::flush`] says
//! whether it happened anywhere in the orbit, and the interior proof adds the term where
//! it did ([`crate::proof`]).
//!
//! Layout per point: `F32Pair` is `[re, im]`; `HiLo` is `[re_hi, im_hi, re_lo, im_lo]`,
//! one `vec4<f32>` with the two `hi` first, so that a shader reading only `.xy` reads
//! exactly the `F32Pair` orbit.

use perturb::reference::Reference;

/// How the reference orbit is stored for the per-pixel loop.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Encoding {
    /// One `f32` per component: eight bytes a point.
    F32Pair,
    /// A high and a low `f32` per component: sixteen bytes a point.
    HiLo,
}

impl Encoding {
    /// Bytes per reference point, as the GPU buffer would hold it.
    pub fn bytes_per_point(self) -> usize {
        match self {
            Encoding::F32Pair => 8,
            Encoding::HiLo => 16,
        }
    }

    /// The name the comparison harness prints and parses.
    pub fn name(self) -> &'static str {
        match self {
            Encoding::F32Pair => "f32pair",
            Encoding::HiLo => "hilo",
        }
    }

    /// Parses `f32pair` or `hilo`.
    pub fn parse(text: &str) -> Option<Encoding> {
        match text {
            "f32pair" | "pair" => Some(Encoding::F32Pair),
            "hilo" => Some(Encoding::HiLo),
            _ => None,
        }
    }
}

/// `x` rounded to `f32`, with a subnormal result stored as a signed zero. CPU-side
/// setup: every `f32` the per-pixel path reads from a buffer is narrowed this way.
pub fn narrow(x: f64) -> f32 {
    let y = x as f32;
    if y.is_subnormal() {
        0.0f32.copysign(y)
    } else {
        y
    }
}

/// The narrowed orbit and the two flags the loop reads.
#[derive(Debug, Clone)]
pub struct GpuOrbit {
    pub encoding: Encoding,
    /// Four `f32` per point, whatever the encoding: the `lo` pair is zero for
    /// `F32Pair`, and the loop for that encoding never reads it. The buffer the GPU
    /// would hold is [`GpuOrbit::gpu_bytes`] long, not this.
    pub points: Vec<[f32; 4]>,
    /// `Z[len] = Z[0]`: the index wraps instead of the delta rebasing at the end.
    pub periodic: bool,
    /// [`FLUSH`] when narrowing flushed a nonzero component (a `hi`, or under `HiLo` a
    /// `lo`) to zero anywhere in the orbit, so that a stored point may be off by up to
    /// `2^-FLUSH` beyond its relative rounding; [`crate::proof::OFF`] when nothing was. A
    /// uniform beside `periodic`, read by the interior proof ([`crate::proof::Iterate`]).
    pub flush: i32,
}

/// The absolute error a flush can leave in one stored point, as `2^-FLUSH`: under
/// `2^-126` a component, so under `2^-125.5` for the pair, by either encoding.
pub const FLUSH: i32 = 125;

impl GpuOrbit {
    /// Narrows `perturb`'s orbit. This is CPU-side setup and the one place the orbit's
    /// `f64` is read.
    pub fn from_reference(reference: &Reference, encoding: Encoding) -> GpuOrbit {
        let mut flushed = false;
        // `x` narrowed, noting a nonzero `x` stored as zero.
        let mut keep = |x: f64| {
            let y = narrow(x);
            flushed |= x != 0.0 && y == 0.0;
            y
        };
        let points = reference
            .points
            .iter()
            .map(|&[re, im]| {
                let re_hi = keep(re);
                let im_hi = keep(im);
                match encoding {
                    Encoding::F32Pair => [re_hi, im_hi, 0.0, 0.0],
                    Encoding::HiLo => {
                        // `re - re_hi` is exact in f64: `re_hi` is within half an f32
                        // ulp of `re`, so the difference lies on `re`'s own ulp grid
                        // with at most 29 significant bits. It then rounds once to f32.
                        let re_lo = keep(re - re_hi as f64);
                        let im_lo = keep(im - im_hi as f64);
                        [re_hi, im_hi, re_lo, im_lo]
                    }
                }
            })
            .collect();
        GpuOrbit {
            encoding,
            points,
            periodic: reference.periodic,
            flush: if flushed { FLUSH } else { crate::proof::OFF },
        }
    }

    pub fn len(&self) -> usize {
        self.points.len()
    }

    pub fn is_empty(&self) -> bool {
        self.points.is_empty()
    }

    /// The bytes a GPU storage buffer of this orbit would take.
    pub fn gpu_bytes(&self) -> usize {
        self.points.len() * self.encoding.bytes_per_point()
    }
}
