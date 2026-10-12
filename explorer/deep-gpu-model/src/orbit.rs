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
//! whether it happened anywhere in the orbit and bounds how much it left, and the
//! interior proof adds the term where it did ([`crate::proof`]).
//!
//! **The bound is measured, not assumed.** A flushed component's error is exactly the
//! `f64` that was stored as zero, so narrowing knows it; `flush` is the largest of them,
//! rounded up to a power of two with room for the pair. `2^-125`, the bound that holds
//! for any flush, is what this comes to only when a component just under `2^-126` was
//! flushed. The points that flush are, overwhelmingly, a minibrot's near-zero returns,
//! `|Z|` about `2^-268` at a period-311 nucleus framed at `1e-60` and `2^-322` deeper,
//! which are also where the proof anchors; a frame-wide `2^-125` against discs of
//! `2^-155` and below closed nothing on such a frame (README, *Deep interior*).
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
    /// Where narrowing flushed a nonzero component (a `hi`, or under `HiLo` a `lo`) to
    /// zero anywhere in the orbit, the `f` for which every stored point is within `2^-f`
    /// of the orbit beyond its relative rounding ([`flush_bound`]), at least [`FLUSH`];
    /// [`crate::proof::OFF`] when nothing was. A uniform beside `periodic`, read by the
    /// interior proof ([`crate::proof::Iterate`]) for an iterate formed from a flushed
    /// point.
    pub flush: i32,
    /// **The flushed points kept exactly** *(gpu_deep_depth_ckpt163)*: under `HiLo`, where
    /// anything flushed, one entry a point. A point narrowing flushed nothing of is `(its
    /// stored point, 0)`; one it flushed is the point times `2^-e`, `e` its larger
    /// component's exponent, narrowed the same way and so (all but a component far below
    /// the other) flushed nowhere, with `e`. The loop reads it only where it forms `Z` in
    /// the delta's units (`model_ds.rs`), so that a minibrot's near-zero returns, `2^-322`
    /// at a period-311 nucleus framed at `1e-110`, are no longer zero there and the proof
    /// carries no flush term for them. Empty where nothing flushed, and for `F32Pair`.
    pub exact: Vec<([f32; 4], i32)>,
}

/// The absolute error any flush can leave in one stored point, as `2^-FLUSH`: under
/// `2^-126` a component, so under `2^-125.5` for the pair, by either encoding. The
/// smallest value [`flush_bound`] returns, and what it returns for a component flushed
/// from just under `2^-126`.
pub const FLUSH: i32 = 125;

/// The binary exponent of a nonzero finite `|x|`, so that `|x|` lies in `[2^e, 2^(e+1))`
/// for a normal `x`; an `f64` subnormal gives `-1023`, above which it lies too. CPU-side
/// setup, read off the bits so that nothing rests on `log2`'s rounding.
fn exponent_f64(x: f64) -> i32 {
    ((x.to_bits() >> 52) & 0x7ff) as i32 - 1023
}

/// `2^-flush_bound(e)` bounds a point's absolute flush error when every flushed component
/// is below `2^(e+1)`: the pair's error is at most `√2 · 2^(e+1) < 2^(e+2)`. Never below
/// [`FLUSH`], and never [`crate::proof::OFF`], since a flushed component is under
/// `2^-126` and so `e <= -127`.
pub fn flush_bound(e: i32) -> i32 {
    let f = -(e + 2);
    if f < FLUSH { FLUSH } else { f }
}

impl GpuOrbit {
    /// Narrows `perturb`'s orbit. This is CPU-side setup and the one place the orbit's
    /// `f64` is read.
    pub fn from_reference(reference: &Reference, encoding: Encoding) -> GpuOrbit {
        // The largest exponent of a nonzero `x` stored as zero, which is exactly the error
        // that left in its component: under `HiLo` a flushed `hi` flushes its `lo`, which
        // is the same `x`, and a flushed `lo` is `re - re_hi` exactly (below).
        let mut worst: Option<i32> = None;
        let mut flushed: Vec<bool> = Vec::with_capacity(reference.points.len());
        let mut keep = |x: f64, any: &mut bool| {
            let y = narrow(x);
            if x != 0.0 && y == 0.0 {
                let e = exponent_f64(x);
                worst = Some(worst.map_or(e, |w| w.max(e)));
                *any = true;
            }
            y
        };
        let points: Vec<[f32; 4]> = reference
            .points
            .iter()
            .map(|&[re, im]| {
                let mut any = false;
                let re_hi = keep(re, &mut any);
                let im_hi = keep(im, &mut any);
                let point = match encoding {
                    Encoding::F32Pair => [re_hi, im_hi, 0.0, 0.0],
                    Encoding::HiLo => {
                        // `re - re_hi` is exact in f64: `re_hi` is within half an f32
                        // ulp of `re`, so the difference lies on `re`'s own ulp grid
                        // with at most 29 significant bits. It then rounds once to f32.
                        let re_lo = keep(re - re_hi as f64, &mut any);
                        let im_lo = keep(im - im_hi as f64, &mut any);
                        [re_hi, im_hi, re_lo, im_lo]
                    }
                };
                flushed.push(any);
                point
            })
            .collect();
        let exact = if encoding == Encoding::HiLo && worst.is_some() {
            reference
                .points
                .iter()
                .zip(&points)
                .zip(&flushed)
                .map(|((&[re, im], &stored), &any)| {
                    if !any {
                        return (stored, 0);
                    }
                    let e = exponent_f64(re.abs().max(im.abs()));
                    let unit = f64::from_bits(((1023 - e) as u64) << 52);
                    let (re, im) = (re * unit, im * unit);
                    let re_hi = narrow(re);
                    let im_hi = narrow(im);
                    (
                        [
                            re_hi,
                            im_hi,
                            narrow(re - re_hi as f64),
                            narrow(im - im_hi as f64),
                        ],
                        e,
                    )
                })
                .collect()
        } else {
            Vec::new()
        };
        GpuOrbit {
            encoding,
            points,
            periodic: reference.periodic,
            flush: worst.map_or(crate::proof::OFF, flush_bound),
            exact,
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
