//! Iteration skipping: a bivariate linear approximation (BLA) table over the reference
//! orbit, built on the CPU in `f64` and stored as a GPU would hold it.
//!
//! This is the model's switch, off by default, and the shipped kernel has none: `perturb`
//! removed its own table (`5fa1515a`, `b84e7e5d`, `394056b2`) because on the frames a
//! reader opens it moved the picture at every tolerance it paid at. Matt reopened it for
//! the GPU path only (ckpt 162), where `f32`'s own rounding already sets the bar: with
//! the switch on, the model is held to agreeing with the `f64` kernel no worse than it
//! does with the switch off, not to agreeing with itself.
//!
//! The structure is that removed table's: its merge rule, its guards, its level layout
//! and its aligned lookup. What is new is the degree, the periodic wrap, and the storage.
//!
//! # What one entry means
//!
//! The exact step at degree `D` is
//!
//! ```text
//! δ' = (Z + δ)^D − Z^D + dc = Σ_{k=1}^{D} C(D,k)·Z^(D−k)·δ^k + dc
//! ```
//!
//! and the approximation keeps the `k = 1` term: one step is `δ' = A·δ + B·dc` with
//! `A = D·Z^(D−1)` and `B = 1` (`B = 0` on a Julia plane, where `dc` is spent once into the
//! starting delta). With `t = |δ|/|Z|`, the dropped terms are at most
//! `|D·Z^(D−1)·δ| · ((1+t)^D − 1 − D·t)/(D·t)`, whose leading part is `(D−1)/2 · t`. Asking
//! it to be a fraction `ε` of the kept term gives `t ≤ 2ε/(D−1)`, and **this table's
//! single-step radius is `r = ε·|Z|/(D−1)`**, a factor of two inside that. The factor
//! pays for the higher terms: at `t = ε/(D−1)` the whole sum is within 7% of its leading
//! part for every `D ≤ 6` and `ε ≤ ¼`, so the dropped part stays under `ε` of the kept
//! one. At `D = 2` this is `ε·|Z|`, the removed table's radius exactly.
//! (`tests/bla.rs` walks the exact recurrence through valid runs at every degree and
//! checks the bound at each step.)
//!
//! Two runs compose (`x` valid from `m` for `lx` steps, then `y` from `m + lx`):
//!
//! ```text
//! A = A_y·A_x     B = A_y·B_x + B_y     l = lx + ly
//! r = min(r_x, max(0, (r_y − |B_x|·dcmax) / |A_x|))
//! ```
//!
//! with `dcmax` a bound on `|dc|` over the whole frame (zero on a Julia plane). By
//! induction through the merge, a `δ` inside an entry's radius stays inside the leaf
//! radius at **every index the run passes through**, which is what makes it safe:
//!
//! - the rebase test `|z| < |δ|` cannot fire inside a run (`|z| ≥ (1−ε)|Z| > |δ|`);
//! - escape cannot happen inside a run: a leaf whose landing point has `(1+ε)|Z|` past
//!   the bailout gets a radius of zero (held at build);
//! - **no run reaches `len − 1`**, the index where the loop rebases on a non-periodic
//!   reference (held at build);
//! - **`n + l < maxiter`**, so no run steps over the cap (held at lookup);
//! - **the interior switch does not fire inside a run**: each entry carries the product
//!   `∏ D²|Z_j|^(2(D−1))` over the run's **inner** points `m+1 … m+l−1` and the smallest
//!   of its prefixes, and a run that would take the pixel's `|dz|²` under the floor at any
//!   inner point is refused (held at lookup).
//!
//! The landing index `m + l` is not an inner point: the radius bounds `δ` where a run
//! starts and where it passes, never where it lands, and the landing is where the loop
//! may rebase (`|z| < |δ|`), so there `|Z|` says nothing about `|z|`. A skip therefore
//! multiplies `|dz|²` by the inner product only, and then takes the ordinary derivative
//! step on the `z` it actually landed on; the landed delta goes through the loop's own
//! escape, interior, cap and rebase tests, exactly as a single step's does.
//!
//! # Periodic references
//!
//! `perturb` stores a periodic reference for one period, `Z[len] = Z[0]`, and wraps the
//! index to 0. **This table builds over the cycle and refuses runs that cross the wrap**:
//! a run may land exactly on index `len` (which is index 0), but none passes through it.
//! Crossing it would need an entry indexed modulo the period, and index 0 is where
//! `Z = 0` and the step is not linear anyway (`δ' = δ^D + dc`), so a run through it is
//! worth nothing at the nucleus it serves. The removed table refused periodic
//! references outright.
//!
//! # Levels and lookup
//!
//! Level-0 entry `j` starts at orbit index `j + 1` and lands at `j + 2`; level-`k` entry
//! `j` is the run of `2^k` that starts at `j·2^k + 1`. Index 0 starts no run (`Z[0] = 0`).
//! Levels below `min_level` are merged but not stored, so the lookup answers at indices
//! `m` with `(m − 1) mod 2^min_level == 0` and nowhere else: one integer test, no read,
//! on every other step. There it reads levels bottom-up from `min_level` and stops at the
//! first that fails, because the radius, the interior floor and the length are each
//! monotone in the level. Each level read is one entry read, and the counters report it.
//! [`Search::Hint`] starts from the level the pixel's last skip used instead, which finds
//! the same run and reads fewer entries where skips are dense.
//!
//! # Storage, as a GPU would hold it
//!
//! The range is the problem, not the precision. At `ε = 2^-24` and a width of `1e-54`,
//! `|B|` reaches `1e30` and climbs past `f32` below about `1e-45`; radii run from `1e-8`
//! down below `f32`'s normal range, and a radius squared underflows `f32` from about
//! `1e-19`. So every quantity is a mantissa and an exponent:
//!
//! - [`BlaEntry`], 32 bytes: `A` and `B` each a `vec2<f32>` mantissa whose larger
//!   component is in `[1, 2]` against an `i32` exponent, and the radius squared as an
//!   `f32` mantissa in `[1, 2)` against an `i32` exponent, rounded down.
//! - [`BlaInterior`], 16 bytes, in a buffer of its own that only a frame with the
//!   interior switch on binds: the run's product and its smallest prefix, each a
//!   mantissa in `[1, 2)` and an exponent.
//! - [`TableHeader`], 528 bytes, a uniform: the stored levels' offsets and counts in
//!   the one flat entry array.
//!
//! `B` is not pre-scaled by the frame: its exponent carries the range, and the product
//! `B·dc` is formed as `(B_m·dc_m)·2^(b_e + sc)` against the frame's own `dc` exponent.
//!
//! # The build
//!
//! In `f64`, from `perturb`'s `f64` orbit. `f64`'s range holds every valid entry at the
//! depths this model is for: a valid merged radius needs `|B|·dcmax` below `ε·|Z|`, so
//! `|B|` stays under about `ε·2^17/dcmax` (1e270 at a width of 1e-280), and an `A` or `B`
//! that overflows marks its entry dead rather than wrong. A leaf `A` at a reference point
//! so small that `Z^(D−1)` underflows `f64` (a `|Z|` under 1e-60 at degree 6) is stored
//! as zero; its true contribution is below `f64`'s range beside the `δ` the radius
//! allows. It is streamed: each leaf is merged up a stack of one pending entry per level,
//! so the working memory is the stack, and the output is the only thing that grows.

use perturb::reference::{BAILOUT, Reference};

use crate::ds;
use crate::frame::Frame;
use crate::orbit::narrow;
use crate::wgsl::{count_trailing_zeros, exponent_of, exponent_of_max, ldexp_exact};

/// `2^-24`: `f32`'s own unit roundoff, the default tolerance.
pub const EPSILON_DEFAULT: f64 = 5.960_464_477_539_063e-8;
/// The double-single kernel's default tolerance, `2^-48`: the pair's own rounding unit,
/// as `2^-24` is `f32`'s. [`apply_ds`] says why it is tighter, and what looser cost.
pub const EPSILON_DS_DEFAULT: f64 = 3.552_713_678_800_501e-15;
/// The shortest stored run is `2^MIN_LEVEL_DEFAULT` steps, the removed table's choice.
pub const MIN_LEVEL_DEFAULT: u32 = 4;
/// The longest run a table offers by default.
pub const MAX_LEVEL_DEFAULT: u32 = 24;
/// The header holds at most this many levels, and no level is above `LEVEL_LIMIT - 1`.
pub const LEVEL_LIMIT: u32 = 31;

/// How a table is built.
#[derive(Debug, Clone, Copy)]
pub struct BlaOptions {
    /// The validity tolerance `ε`, in `(0, ¼)`.
    pub epsilon: f64,
    pub min_level: u32,
    pub max_level: u32,
    /// The order the lookup reads levels in. It changes the reads, never the run found.
    pub search: Search,
    /// The gate: before reading a level, compare `|δ|²` with the level's largest radius
    /// squared, held in the header, and read nothing where even that one fails. It
    /// changes the reads, never the run found. Off by default; see [`GpuTable::gate`].
    pub gate: bool,
}

impl Default for BlaOptions {
    fn default() -> Self {
        BlaOptions {
            epsilon: EPSILON_DEFAULT,
            min_level: MIN_LEVEL_DEFAULT,
            max_level: MAX_LEVEL_DEFAULT,
            search: Search::BottomUp,
            gate: false,
        }
    }
}

/// The order a lookup reads a pixel's candidate levels in.
///
/// Which levels are candidates is decided without a read, from the header and integers
/// alone: the alignment of `m − 1`, the run's length against the cap, and the level's
/// count. Among them, whether a level's entry admits the pixel is **monotone in the
/// level**: a level-`k+1` entry is a level-`k` entry at the same start merged with the
/// next, so its radius is at most the shorter one's (`r = min(r_x, …)`, rounded down
/// alike), its smallest interior prefix is at most the shorter one's, and a dead entry's
/// parent is dead. So either order finds the same longest run, and the field is the same
/// bit for bit (`tests/bla.rs` holds it); only the entries read differ.
///
/// Measured (phase 3, `F32Pair`, 64x36): most lookups on the Deep tab's frames find
/// nothing (81% on a 300-frame corpus slice), a miss costs bottom-up one read, and its
/// hits are short, so nothing beats it there; `Hint` reads 2% more. Where skips are dense
/// the hint reads fewer: 0.67 of bottom-up on the copy-cusp channels, 0.83 at the
/// Feigenbaum point, 0.95 in the parabolic channels, 0.93 on the site's own million-cap
/// frames, and 0.81 across the long-orbit set as a whole. Three more orders were measured
/// and are not kept. Top-down read 1.83 times bottom-up's on the corpus and 0.82 on the
/// long-orbit set; the lowest level first and then top-down, 1.10 and 0.97; a binary
/// search over the levels, 1.02 and 0.91.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum Search {
    /// The removed table's order: up from the lowest level, stopping at the first that
    /// fails. A hit at level `k` costs `k − min_level + 2` reads, a miss one.
    #[default]
    BottomUp,
    /// Starts at the level the pixel's last skip used (per-pixel state below 32, which a
    /// shader keeps in five spare bits of `status`; a miss resets it to the lowest), and
    /// walks up while the entry admits or down until one does.
    Hint,
}

impl Search {
    pub fn parse(s: &str) -> Option<Search> {
        Some(match s {
            "bottom-up" | "bottomup" => Search::BottomUp,
            "hint" => Search::Hint,
            _ => return None,
        })
    }

    pub fn name(self) -> &'static str {
        match self {
            Search::BottomUp => "bottom-up",
            Search::Hint => "hint",
        }
    }
}

/// One stored run, as a WGSL storage buffer holds it:
/// `struct { a: vec2<f32>, b: vec2<f32>, a_e: i32, b_e: i32, r2_m: f32, r2_e: i32 }`,
/// 32 bytes, 8-byte aligned, no padding.
#[repr(C)]
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct BlaEntry {
    /// `A = a · 2^a_e`.
    pub a: [f32; 2],
    /// `B = b · 2^b_e`; zero on a Julia plane.
    pub b: [f32; 2],
    pub a_e: i32,
    pub b_e: i32,
    /// The radius squared, `r2_m · 2^r2_e` with `r2_m` in `[1, 2)`, rounded down.
    /// `r2_m == 0` is a dead entry, never valid.
    pub r2_m: f32,
    pub r2_e: i32,
}

/// The interior switch's half of an entry, in a buffer of its own: 16 bytes.
#[repr(C)]
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct BlaInterior {
    /// `∏_{j=1}^{l−1} D²·|Z_{m+j}|^(2(D−1))`, the inner points only, mantissa in `[1, 2)`
    /// (0 if any `Z` is 0). The landing point's factor is the loop's own derivative step.
    pub deriv_m: f32,
    pub deriv_e: i32,
    /// The smallest prefix of that product; `2^28` (no prefix) on a one-step run.
    pub dmin_m: f32,
    pub dmin_e: i32,
}

/// The double-single half of an entry, in a buffer of its own: `A = (a + a_lo) · 2^a_e`
/// and `B = (b + b_lo) · 2^b_e`, each low half the `f32` nearest what the `f32` mantissa
/// in [`BlaEntry`] left of the `f64` one. 16 bytes, two `vec2<f32>`.
#[repr(C)]
#[derive(Debug, Clone, Copy, PartialEq, Default)]
pub struct BlaLo {
    pub a_lo: [f32; 2],
    pub b_lo: [f32; 2],
}

/// The stored levels, as a uniform buffer holds them: four `u32`, then one `vec4<u32>`
/// per level (`x` the level's offset in the entry array, `y` its count, `z` and `w` the
/// largest stored radius squared on the level as `bitcast<u32>` of its `f32` mantissa and
/// its `i32` exponent, which the gate reads), 528 bytes.
#[repr(C)]
#[derive(Debug, Clone, Copy)]
pub struct TableHeader {
    /// The lowest stored level.
    pub min_level: u32,
    /// How many levels are stored, from `min_level` up; 0 is an empty table.
    pub levels: u32,
    /// `2^min_level − 1`.
    pub mask: u32,
    /// 1 when the reference is periodic.
    pub periodic: u32,
    pub level: [[u32; 4]; LEVEL_LIMIT as usize + 1],
}

/// Bytes per stored entry, without and with the interior buffer.
pub const ENTRY_BYTES: usize = 32;
pub const INTERIOR_BYTES: usize = 16;
pub const HEADER_BYTES: usize = 528;
/// Bytes per entry of the double-single kernel's low halves.
pub const LO_BYTES: usize = 16;

/// A table as the GPU would hold it, and what it cost to build.
#[derive(Debug, Clone)]
pub struct GpuTable {
    pub header: TableHeader,
    pub entries: Vec<BlaEntry>,
    pub interior: Vec<BlaInterior>,
    /// The low halves of each entry's `A` and `B`, which only the double-single kernel
    /// binds ([`apply_ds`]). Built whatever the kernel; an `f32` kernel never reads it.
    pub lo: Vec<BlaLo>,
    pub epsilon: f64,
    /// The frame-wide bound on `|dc|` the radii were merged against.
    pub dc_bound: f64,
    /// Valid (non-dead) entries.
    pub valid: usize,
    pub build_s: f64,
    /// The order lookups read levels in: a shader variant, not data.
    pub search: Search,
    /// Whether lookups take the gate: a shader variant, not data (the header carries each
    /// level's largest radius either way).
    ///
    /// Measured (phase 3, `F32Pair`, 64x36, interior on where shipped): most failed
    /// lookups fail at the lowest level on the radius, and the lowest level's largest
    /// radius alone turns away 77% of those on a 300-frame corpus slice, 99.9% on the main
    /// cusp's channel, 67% on the site's million-cap frames, 22% at the Feigenbaum point
    /// and none on a copy cusp, whose misses are where `|Z|` is small. A per-chunk maximum
    /// (16 or 256 entries) turned away hardly more than the one per level, so the header
    /// holds one per level and costs no buffer and no read. Entries read against
    /// bottom-up without it: 0.45 on the corpus slice, 0.02 to 0.18 in the parabolic
    /// channels, unchanged on the copy cusps; with [`Search::Hint`] as well, 0.46 on the
    /// corpus, 0.64 across the long-orbit set, 0.005 to 0.05 in the channels.
    pub gate: bool,
}

impl GpuTable {
    /// A table with no levels: the BLA path runs and never finds a run.
    pub fn empty(periodic: bool) -> GpuTable {
        GpuTable {
            header: TableHeader {
                min_level: 0,
                levels: 0,
                mask: 0,
                periodic: periodic as u32,
                level: [[0; 4]; LEVEL_LIMIT as usize + 1],
            },
            entries: Vec::new(),
            interior: Vec::new(),
            lo: Vec::new(),
            epsilon: 0.0,
            dc_bound: 0.0,
            valid: 0,
            build_s: 0.0,
            search: Search::BottomUp,
            gate: false,
        }
    }

    /// Bytes of the entry buffer, of the interior buffer, and of the header.
    pub fn entry_bytes(&self) -> usize {
        self.entries.len() * ENTRY_BYTES
    }

    pub fn interior_bytes(&self) -> usize {
        self.interior.len() * INTERIOR_BYTES
    }

    /// Bytes of the low-half buffer a double-single kernel binds.
    pub fn lo_bytes(&self) -> usize {
        self.lo.len() * LO_BYTES
    }

    /// The highest stored level, when any is.
    pub fn top_level(&self) -> Option<u32> {
        (self.header.levels > 0).then(|| self.header.min_level + self.header.levels - 1)
    }

    /// Builds the table for `reference` as the frame draws it. CPU-side setup, `f64`.
    pub fn build(reference: &Reference, frame: &Frame, opts: &BlaOptions) -> GpuTable {
        let start = std::time::Instant::now();
        let dc_bound = if frame.julia != 0 {
            0.0
        } else {
            dc_bound(frame)
        };
        let mut table = build_with(
            &reference.points,
            reference.periodic,
            frame.degree,
            frame.julia != 0,
            dc_bound,
            opts,
        );
        table.build_s = start.elapsed().as_secs_f64();
        table
    }
}

/// The largest `|dc|` any sample of the frame carries, from the frame's own `f32`
/// constants (the four corners, where a convex `|dc|` is largest), with a margin of
/// `2^-20` for the rounding of the per-pixel sum.
pub fn dc_bound(frame: &Frame) -> f64 {
    let unit = scale64(1.0, frame.sc);
    let mut big = 0.0f64;
    for (col, row) in [
        (0, 0),
        (frame.width_px - 1, 0),
        (0, frame.height_px - 1),
        (frame.width_px - 1, frame.height_px - 1),
    ] {
        let m = frame.dc_mantissa(col, row);
        big = big.max((m[0] as f64).hypot(m[1] as f64));
    }
    big * unit * (1.0 + 1.0 / 1_048_576.0)
}

/// `x · 2^e` in `f64`, exact while the result is normal.
fn scale64(mut x: f64, mut e: i32) -> f64 {
    let p = |k: i32| f64::from_bits(((k + 1023) as u64) << 52);
    while e > 1000 {
        x *= p(1000);
        e -= 1000;
    }
    while e < -1000 {
        x *= p(-1000);
        e += 1000;
    }
    x * p(e)
}

/// The binary exponent of a positive finite `f64`, subnormals included.
fn exp64(x: f64) -> i32 {
    let field = ((x.to_bits() >> 52) & 0x7ff) as i32;
    if field == 0 {
        return exp64(x * scale64(1.0, 200)) - 200;
    }
    field - 1023
}

/// A positive quantity as a mantissa in `[1, 2)` and an exponent; zero is `(0, 0)`.
type Product = (f64, i32);

fn norm(m: f64, e: i32) -> Product {
    if m == 0.0 || !m.is_finite() {
        return (0.0, 0);
    }
    let x = exp64(m);
    (scale64(m, -x), e + x)
}

fn mul(a: Product, b: Product) -> Product {
    if a.0 == 0.0 || b.0 == 0.0 {
        return (0.0, 0);
    }
    norm(a.0 * b.0, a.1 + b.1)
}

fn smaller(a: Product, b: Product) -> Product {
    if a.0 == 0.0 {
        return a;
    }
    if b.0 == 0.0 {
        return b;
    }
    if (a.1, a.0) <= (b.1, b.0) { a } else { b }
}

/// `|z|²` as a product, without underflowing for a small `z`.
fn norm_sq(z: [f64; 2]) -> Product {
    let big = z[0].abs().max(z[1].abs());
    if big == 0.0 {
        return (0.0, 0);
    }
    let e = exp64(big);
    let a = scale64(z[0], -e);
    let b = scale64(z[1], -e);
    norm(a * a + b * b, 2 * e)
}

/// One run while the table is built.
#[derive(Clone, Copy)]
struct Build {
    a: [f64; 2],
    b: [f64; 2],
    r: f64,
    /// Over the inner points, what is stored.
    deriv: Product,
    dmin: Product,
    /// Over every landing index, the landing included: build-time only, so that a merge
    /// can make `x`'s landing point an inner point of the merged run.
    full: Product,
    dfull: Product,
}

/// "No prefix": larger than any product, and far from overflowing an `i32` exponent.
const NO_PREFIX: Product = (1.0, 1 << 28);

const DEAD: Build = Build {
    a: [0.0, 0.0],
    b: [0.0, 0.0],
    r: 0.0,
    deriv: (0.0, 0),
    dmin: (0.0, 0),
    full: (0.0, 0),
    dfull: (0.0, 0),
};

fn cmul64(a: [f64; 2], b: [f64; 2]) -> [f64; 2] {
    [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]]
}

/// `y` after `x`: the removed table's merge for `A`, `B` and the radius. The interior
/// products are over inner points, so `x`'s landing factor joins the merged run's inner
/// product and `y`'s does not.
fn merge(x: &Build, y: &Build, dcmax: f64) -> Build {
    let a = cmul64(y.a, x.a);
    let ab = cmul64(y.a, x.b);
    let b = [ab[0] + y.b[0], ab[1] + y.b[1]];
    let a_x = x.a[0].hypot(x.a[1]);
    let b_x = x.b[0].hypot(x.b[1]);
    let reach = y.r - b_x * dcmax;
    let second = if a_x > 0.0 {
        (reach / a_x).max(0.0)
    } else if reach >= 0.0 {
        f64::INFINITY
    } else {
        0.0
    };
    let mut r = x.r.min(second);
    if !(a[0].is_finite() && a[1].is_finite() && b[0].is_finite() && b[1].is_finite()) {
        r = 0.0;
    }
    Build {
        a,
        b,
        r,
        deriv: mul(x.full, y.deriv),
        dmin: smaller(x.dfull, mul(x.full, y.dmin)),
        full: mul(x.full, y.full),
        dfull: smaller(x.dfull, mul(x.full, y.dfull)),
    }
}

/// The leaf starting at `s`: one step from `Z[s]`, landing on `Z[next]`.
fn leaf(points: &[[f64; 2]], s: usize, next: usize, degree: u32, julia: bool, eps: f64) -> Build {
    let z = points[s];
    let zn = points[next];
    let d = degree as f64;
    // A = D·Z^(D−1).
    let mut pw = [1.0, 0.0];
    for _ in 1..degree {
        pw = cmul64(pw, z);
    }
    let a = [d * pw[0], d * pw[1]];
    let mut r = eps * z[0].hypot(z[1]) / (d - 1.0);
    let guard = (1.0 + eps) * (1.0 + eps);
    if guard * (zn[0] * zn[0] + zn[1] * zn[1]) > BAILOUT * BAILOUT {
        r = 0.0;
    }
    if !(a[0].is_finite() && a[1].is_finite()) || !r.is_finite() {
        r = 0.0;
    }
    // D²·|Zn|^(2(D−1)), the landing factor: a one-step run has no inner point.
    let zn2 = norm_sq(zn);
    let mut land = norm(d * d, 0);
    for _ in 1..degree {
        land = mul(land, zn2);
    }
    Build {
        a,
        b: if julia { [0.0, 0.0] } else { [1.0, 0.0] },
        r,
        deriv: (1.0, 0),
        dmin: NO_PREFIX,
        full: land,
        dfull: land,
    }
}

/// A complex `f64` as an `f32` mantissa pair (larger component in `[1, 2]`) and an
/// exponent. Zero is `([0, 0], 0)`.
fn split2(v: [f64; 2]) -> ([f32; 2], i32) {
    let big = v[0].abs().max(v[1].abs());
    if big == 0.0 || !big.is_finite() {
        return ([0.0, 0.0], 0);
    }
    let e = exp64(big);
    ([narrow(scale64(v[0], -e)), narrow(scale64(v[1], -e))], e)
}

/// A product's mantissa narrowed to `f32`, kept in `[1, 2)`.
fn split1(p: Product) -> (f32, i32) {
    if p.0 == 0.0 {
        return (0.0, 0);
    }
    let m = p.0 as f32;
    if m >= 2.0 { (1.0, p.1 + 1) } else { (m, p.1) }
}

/// The largest `f32` at most `x`, for `x` in `[1, 4)`.
fn f32_down(x: f64) -> f32 {
    let y = x as f32;
    if y as f64 > x {
        f32::from_bits(y.to_bits() - 1)
    } else {
        y
    }
}

fn store(b: &Build) -> (BlaEntry, BlaInterior, bool) {
    let (a, a_e) = split2(b.a);
    let (bm, b_e) = split2(b.b);
    let live = b.r > 0.0 && b.r.is_finite();
    let (r2_m, r2_e) = if live {
        let e = exp64(b.r);
        let m = scale64(b.r, -e);
        let sq = m * m;
        // Rounded down, so the stored radius is never larger than the built one.
        if sq >= 2.0 {
            (f32_down(sq / 2.0), 2 * e + 1)
        } else {
            (f32_down(sq), 2 * e)
        }
    } else {
        (0.0, 0)
    };
    let (deriv_m, deriv_e) = split1(b.deriv);
    let (dmin_m, dmin_e) = split1(b.dmin);
    (
        BlaEntry {
            a,
            b: bm,
            a_e,
            b_e,
            r2_m,
            r2_e,
        },
        BlaInterior {
            deriv_m,
            deriv_e,
            dmin_m,
            dmin_e,
        },
        live,
    )
}

/// The low halves of `b`'s `A` and `B` against the exponents `stored` was given: the
/// `f64` mantissa less its `f32` high half, which is exact in `f64` (the argument
/// [`crate::orbit`] makes), then narrowed.
fn store_lo(b: &Build, stored: &BlaEntry) -> BlaLo {
    let lo = |v: [f64; 2], hi: [f32; 2], e: i32| {
        if hi == [0.0, 0.0] {
            return [0.0, 0.0];
        }
        [
            narrow(scale64(v[0], -e) - hi[0] as f64),
            narrow(scale64(v[1], -e) - hi[1] as f64),
        ]
    };
    BlaLo {
        a_lo: lo(b.a, stored.a, stored.a_e),
        b_lo: lo(b.b, stored.b, stored.b_e),
    }
}

/// The table over `points`, at `degree`, merged against `dcmax`. An orbit too short to
/// hold a stored run, a tolerance outside `(0, ¼)` or a `min_level` above `max_level`
/// gives an empty table.
pub fn build_with(
    points: &[[f64; 2]],
    periodic: bool,
    degree: u32,
    julia: bool,
    dcmax: f64,
    opts: &BlaOptions,
) -> GpuTable {
    let mut table = GpuTable::empty(periodic);
    table.epsilon = opts.epsilon;
    table.dc_bound = dcmax;
    table.search = opts.search;
    let eps = opts.epsilon;
    if !(eps > 0.0 && eps < 0.25) || dcmax.is_nan() || dcmax < 0.0 || !(2..=6).contains(&degree) {
        return table;
    }
    let len = points.len();
    // Leaves start at 1. Non-periodic: the highest landing index is `len − 2`, one
    // below the index where the loop rebases, so starts run `1..=len − 3`. Periodic:
    // a run may land on `len`, which is index 0, so starts run `1..=len − 1`.
    let leaves = if periodic {
        len.saturating_sub(1)
    } else {
        len.saturating_sub(3)
    };
    if leaves == 0 {
        return table;
    }
    let mut k_max = 0u32;
    while k_max < opts.max_level.min(LEVEL_LIMIT - 1) && (2usize << k_max) <= leaves {
        k_max += 1;
    }
    let min_level = opts.min_level;
    if min_level > k_max {
        return table;
    }
    let stored = (k_max - min_level + 1) as usize;
    let mut out: Vec<Vec<Build>> = (0..stored)
        .map(|i| Vec::with_capacity(leaves >> (min_level as usize + i)))
        .collect();
    let mut stack: Vec<Option<Build>> = vec![None; k_max as usize + 1];
    for j in 0..leaves {
        let s = j + 1;
        let next = if periodic && s + 1 == len { 0 } else { s + 1 };
        let mut carry = if s < len {
            leaf(points, s, next, degree, julia, eps)
        } else {
            DEAD
        };
        let mut k = 0u32;
        loop {
            if k >= min_level {
                out[(k - min_level) as usize].push(carry);
            }
            if k == k_max {
                break;
            }
            match stack[k as usize].take() {
                None => {
                    stack[k as usize] = Some(carry);
                    break;
                }
                Some(left) => {
                    carry = merge(&left, &carry, dcmax);
                    k += 1;
                }
            }
        }
    }

    let total: usize = out.iter().map(Vec::len).sum();
    table.entries.reserve(total);
    table.interior.reserve(total);
    table.lo.reserve(total);
    table.header.min_level = min_level;
    table.header.levels = stored as u32;
    table.header.mask = (1u32 << min_level) - 1;
    for (i, level) in out.iter().enumerate() {
        let offset = table.entries.len() as u32;
        // The level's largest stored radius squared, for the gate: `(0, 0)` when every
        // entry is dead.
        let (mut top_m, mut top_e) = (0.0f32, 0i32);
        for b in level {
            let (e, x, live) = store(b);
            table.lo.push(store_lo(b, &e));
            if live && (top_m == 0.0 || (e.r2_e, e.r2_m) > (top_e, top_m)) {
                (top_m, top_e) = (e.r2_m, e.r2_e);
            }
            table.entries.push(e);
            table.interior.push(x);
            table.valid += live as usize;
        }
        table.header.level[i] = [offset, level.len() as u32, top_m.to_bits(), top_e as u32];
    }
    table.gate = opts.gate;
    table
}

/// What a lookup found: the entry's index in the flat array and the run's length.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Hit {
    pub index: u32,
    pub length: u32,
}

/// `|δ|² < r²` for `δ = d · 2^s` against an entry's stored `r2_m · 2^r2_e`. `f32` and
/// `i32` only: `|d|²` is normal or zero in the state form (its larger component is at
/// least `2^-62` unscaled and at least `2^-32` scaled), so it is split into a mantissa
/// in `[1, 2)` and an exponent, and the two are compared exponent first.
#[inline(always)]
pub fn inside(entry: &BlaEntry, d: [f32; 2], s: i32) -> bool {
    below(entry.r2_m, entry.r2_e, d, s)
}

/// `|δ|² < r2_m · 2^r2_e` for `δ = d · 2^s`, the comparison [`inside`] makes; `r2_m == 0`
/// admits nothing.
#[inline(always)]
pub fn below(r2_m: f32, r2_e: i32, d: [f32; 2], s: i32) -> bool {
    if r2_m == 0.0 {
        return false;
    }
    let dn = d[0] * d[0] + d[1] * d[1];
    let ed = exponent_of(dn);
    if ed == -127 {
        // A zero delta: the run's linearization is exact in it.
        return true;
    }
    let md = ldexp_exact(dn, -ed);
    let e = ed + 2 * s;
    e < r2_e || (e == r2_e && md < r2_m)
}

/// The longest run the table allows a pixel at orbit index `m` with delta `d · 2^s`,
/// `left = maxiter − n` iterations from its cap, and (with the interior switch on) its
/// `|dz|²` as `(mantissa, exponent)` against `floor`. Adds the entries it reads to
/// `reads`. `f32`, `i32` and `u32` only; WGSL's `countTrailingZeros` is the alignment.
#[inline(always)]
pub fn lookup(
    table: &GpuTable,
    m: u32,
    d: [f32; 2],
    s: i32,
    left: u32,
    interior: Option<(f32, i32, i32)>,
    reads: &mut u32,
) -> Option<Hit> {
    let mut hint = 0u32;
    lookup_hinted(table, m, d, s, left, interior, &mut hint, reads)
}

/// [`lookup`] in the table's [`Search`] order. `hint` is the pixel's last skip level
/// (relative to `min_level`), which only [`Search::Hint`] reads and writes; bottom-up
/// leaves it alone. Whatever the order, the run found is the same.
#[inline(always)]
#[allow(clippy::too_many_arguments)]
pub fn lookup_hinted(
    table: &GpuTable,
    m: u32,
    d: [f32; 2],
    s: i32,
    left: u32,
    interior: Option<(f32, i32, i32)>,
    hint: &mut u32,
    reads: &mut u32,
) -> Option<Hit> {
    let h = &table.header;
    if m == 0 || h.levels == 0 {
        return None;
    }
    let ix = m - 1;
    if ix & h.mask != 0 {
        return None;
    }
    // The candidates, `0..cands` relative to `min_level`, from integers and the header
    // alone: each condition is monotone in the level.
    let aligned = count_trailing_zeros(ix);
    // With the gate, a level whose largest radius does not admit the pixel is not a
    // candidate either: no entry on it can, and the largest radius only falls with the
    // level, so the test is monotone too.
    let mut cands = 0u32;
    while cands < h.levels {
        let k = h.min_level + cands;
        let [_, count, top_m, top_e] = h.level[cands as usize];
        if k > aligned || (1u32 << k) >= left || (ix >> k) >= count {
            break;
        }
        if table.gate && !below(f32::from_bits(top_m), top_e as i32, d, s) {
            break;
        }
        cands += 1;
    }
    if cands == 0 {
        return None;
    }
    // Reads level `i`'s entry and says whether it admits the pixel.
    let mut admits = |i: u32| -> bool {
        let k = h.min_level + i;
        let index = h.level[i as usize][0] + (ix >> k);
        *reads += 1;
        if !inside(&table.entries[index as usize], d, s) {
            return false;
        }
        if let Some((dzm, dze, floor)) = interior {
            let x = &table.interior[index as usize];
            if x.dmin_m == 0.0 {
                return false;
            }
            let p = dzm * x.dmin_m;
            let pe = dze + x.dmin_e + exponent_of(p);
            if pe < floor {
                return false;
            }
        }
        true
    };
    // The highest admitting candidate, or `NONE`.
    const NONE: u32 = u32::MAX;
    let best = match table.search {
        Search::BottomUp => {
            let mut best = NONE;
            let mut i = 0;
            while i < cands && admits(i) {
                best = i;
                i += 1;
            }
            best
        }
        Search::Hint => {
            let start = (*hint).min(cands - 1);
            let mut best = NONE;
            if admits(start) {
                best = start;
                let mut i = start + 1;
                while i < cands && admits(i) {
                    best = i;
                    i += 1;
                }
            } else {
                let mut i = start;
                while i > 0 {
                    i -= 1;
                    if admits(i) {
                        best = i;
                        break;
                    }
                }
            }
            *hint = if best == NONE { 0 } else { best };
            best
        }
    };
    if best == NONE {
        return None;
    }
    let k = h.min_level + best;
    Some(Hit {
        index: h.level[best as usize][0] + (ix >> k),
        length: 1u32 << k,
    })
}

/// `δ' = A·δ + B·dc` for `δ = d · 2^s` and `dc = dc_m · 2^sc`, as a mantissa and an
/// exponent, which the caller puts in the state's form (both terms zero is a zero
/// mantissa against an exponent no value has). The two products are formed as mantissas (each at most
/// about `2^35`), and added at the larger of their exponents the way the careful step
/// adds its product to `dc`. `f32` and `i32` only.
#[inline(always)]
pub fn apply<const JULIA: bool>(
    entry: &BlaEntry,
    d: [f32; 2],
    s: i32,
    dc_m: [f32; 2],
    sc: i32,
) -> ([f32; 2], i32) {
    const NONE: i32 = -100_000;
    let t1 = [
        entry.a[0] * d[0] - entry.a[1] * d[1],
        entry.a[0] * d[1] + entry.a[1] * d[0],
    ];
    let e1 = entry.a_e + s;
    let x1 = match exponent_of_max(t1[0], t1[1]) {
        -127 => NONE,
        x => e1 + x,
    };
    let (t2, e2, x2) = if JULIA {
        ([0.0f32, 0.0], 0, NONE)
    } else {
        let t2 = [
            entry.b[0] * dc_m[0] - entry.b[1] * dc_m[1],
            entry.b[0] * dc_m[1] + entry.b[1] * dc_m[0],
        ];
        let e2 = entry.b_e + sc;
        let x2 = match exponent_of_max(t2[0], t2[1]) {
            -127 => NONE,
            x => e2 + x,
        };
        (t2, e2, x2)
    };
    let at = if x1 > x2 { x1 } else { x2 };
    (
        [
            ldexp_exact(t1[0], e1 - at) + ldexp_exact(t2[0], e2 - at),
            ldexp_exact(t1[1], e1 - at) + ldexp_exact(t2[1], e2 - at),
        ],
        at,
    )
}

/// [`apply`] for the double-single kernel: `δ' = A·δ + B·dc` with `A`, `B`, `δ` and `dc`
/// all `hi + lo` pairs, `A` and `B` read from the entry and its [`BlaLo`]. The same
/// shape as [`apply`]: two mantissa products, each exponent read off its high parts, and
/// the sum at the larger exponent, which the caller settles into the state's form. `f32`
/// and `i32` only; 312 `f32` operations (two [`ds::c_mul`] and one [`ds::c_add`]) against
/// [`apply`]'s 14, paid once per skip.
///
/// **Why the entry needs its low halves.** An `A` rounded to 24 bits makes every skip an
/// error of `2^-24` relative in `A·δ`, the size of the `f32` kernel's own rounding and
/// `2^24` times the double-single kernel's; at `ε` below `2^-24` it would also be larger
/// than the truncation the radius was built to allow. So the mantissas are carried to
/// about 48 bits (the `f64` build holds them to 53, less a rounding per merge level), and
/// the low halves sit in a buffer of their own, 16 bytes an entry, which only this
/// kernel binds: [`BlaEntry`] is unchanged and the `f32` kernel's table costs what it did.
/// Measured on `random-dives#501` (64x36, `ε = 2^-48`, 37 skips a pixel): with the low
/// halves zeroed the share more than 0.1 off `perturb` goes from 1.09% to 7.2%
/// (`tests/ds.rs`).
///
/// **And why `ε` is tighter.** `ε` is the truncation each skip is allowed, relative to
/// `A·δ`; `2^-24` was chosen for the `f32` kernel as its own rounding unit, and the same
/// argument puts the double-single kernel's at `2^-48`
/// ([`EPSILON_DS_DEFAULT`]), a run-time parameter like the other. Measured on seven
/// frames that skip (64x36, `HiLo`; the share more than 0.1 off without the skip, then
/// with it): at `2^-24` every frame loses most of what double-single bought
/// (`random-dives#501` 1.3% to 7.6%, `#93` 4.9% to 33%, `#571` 36% to 89%,
/// `go:julia3-end` 29% to 97%); at `2^-32` they lose a sixth to a half of it; at `2^-40`
/// `#501` keeps its 1.3% at 3.6 times fewer delta steps while `#571` and `#808` still
/// lose 7 to 9 points; at `2^-48` no frame moves by more than 0.04 points and `#501`
/// improves to 1.1% at 2.7 times fewer steps, while the others skip little (at most
/// 2.4% fewer steps). These are long, chaotic orbits, where the skip's truncation is a
/// perturbation the dynamics amplify like any other.
#[inline(always)]
pub fn apply_ds<const JULIA: bool>(
    entry: &BlaEntry,
    lo: &BlaLo,
    d: ds::Cds,
    s: i32,
    dc: ds::Cds,
    sc: i32,
) -> (ds::Cds, i32) {
    const NONE: i32 = -100_000;
    let a = [
        ds::from_hi_lo(entry.a[0], lo.a_lo[0]),
        ds::from_hi_lo(entry.a[1], lo.a_lo[1]),
    ];
    let t1 = ds::c_mul(a, d);
    let e1 = entry.a_e + s;
    let x1 = match exponent_of_max(t1[0].hi, t1[1].hi) {
        -127 => NONE,
        x => e1 + x,
    };
    let zero = ds::from_f32(0.0);
    let (t2, e2, x2) = if JULIA {
        ([zero, zero], 0, NONE)
    } else {
        let b = [
            ds::from_hi_lo(entry.b[0], lo.b_lo[0]),
            ds::from_hi_lo(entry.b[1], lo.b_lo[1]),
        ];
        let t2 = ds::c_mul(b, dc);
        let e2 = entry.b_e + sc;
        let x2 = match exponent_of_max(t2[0].hi, t2[1].hi) {
            -127 => NONE,
            x => e2 + x,
        };
        (t2, e2, x2)
    };
    let at = if x1 > x2 { x1 } else { x2 };
    let scaled = |t: ds::Cds, e: i32| [ds::ldexp(t[0], e), ds::ldexp(t[1], e)];
    (ds::c_add(scaled(t1, e1 - at), scaled(t2, e2 - at)), at)
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::mem::{offset_of, size_of};

    /// The low halves carry `A` and `B` to double-single precision: on a built table,
    /// `hi + lo` is within `2^-46` of the `f64` value relative to its larger component.
    #[test]
    fn low_halves_carry_the_mantissas() {
        assert_eq!(size_of::<BlaLo>(), LO_BYTES);
        assert_eq!(offset_of!(BlaLo, b_lo), 8);
        let points: Vec<[f64; 2]> = {
            // A short orbit of c = -0.1 + 0.65i.
            let (mut z, c) = ([0.0f64, 0.0], [-0.1f64, 0.65]);
            (0..300)
                .map(|_| {
                    let out = z;
                    z = [z[0] * z[0] - z[1] * z[1] + c[0], 2.0 * z[0] * z[1] + c[1]];
                    out
                })
                .collect()
        };
        let opts = BlaOptions {
            epsilon: 1e-12,
            min_level: 0,
            ..BlaOptions::default()
        };
        let table = build_with(&points, false, 2, false, 1e-15, &opts);
        assert_eq!(table.lo.len(), table.entries.len());
        // Level 0 entry j is the leaf at j + 1: A = 2·Z[j + 1].
        let mut worst = 0f64;
        for j in 0..20 {
            let (e, l) = (&table.entries[j], &table.lo[j]);
            for k in 0..2 {
                let got = (e.a[k] as f64 + l.a_lo[k] as f64) * scale64(1.0, e.a_e);
                let want = 2.0 * points[j + 1][k];
                let size = 2.0 * points[j + 1][0].abs().max(points[j + 1][1].abs());
                worst = worst.max((got - want).abs() / size);
            }
        }
        assert!(worst < 2f64.powi(-46), "{worst:e}");
    }

    #[test]
    fn entry_layouts_are_wgsl_layouts() {
        assert_eq!(size_of::<BlaEntry>(), ENTRY_BYTES);
        assert_eq!(ENTRY_BYTES, 32);
        assert_eq!(offset_of!(BlaEntry, a), 0);
        assert_eq!(offset_of!(BlaEntry, b), 8);
        assert_eq!(offset_of!(BlaEntry, a_e), 16);
        assert_eq!(offset_of!(BlaEntry, b_e), 20);
        assert_eq!(offset_of!(BlaEntry, r2_m), 24);
        assert_eq!(offset_of!(BlaEntry, r2_e), 28);
        assert_eq!(size_of::<BlaInterior>(), INTERIOR_BYTES);
        assert_eq!(INTERIOR_BYTES, 16);
        assert_eq!(size_of::<TableHeader>(), HEADER_BYTES);
        assert_eq!(offset_of!(TableHeader, level), 16);
    }

    #[test]
    fn inside_compares_exactly_across_scales() {
        // r = 1.5 · 2^-100: r² = 2.25 · 2^-200 = 1.125 · 2^-199.
        let (e, _, _) = store(&Build {
            r: 1.5 * scale64(1.0, -100),
            ..DEAD
        });
        assert_eq!((e.r2_m, e.r2_e), (1.125, -199));
        // δ = 1.4 · 2^-100, scaled: inside; 1.6 · 2^-100: outside.
        assert!(inside(&e, [1.4, 0.0], -100));
        assert!(!inside(&e, [1.6, 0.0], -100));
        assert!(!inside(&e, [0.0, 1.6 * 1024.0], -110));
        assert!(inside(&e, [0.0, 0.0], 0));
        let dead = store(&DEAD).0;
        assert!(!inside(&dead, [0.0, 0.0], 0));
    }
}
