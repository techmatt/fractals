//! The skip table: bivariate linear approximation over the reference orbit.
//!
//! One entry stands for a run of `2^k` steps of [`crate::kernel`]'s loop, as
//! `δ ← A·δ + B·dc`, with a radius saying how large `|δ|` may be for that to be
//! worth doing. The kernel consults it at the top of its loop and either advances
//! `m` and `n` by the run length or falls through to the single step below.
//!
//! **It is a pure function of `(reference orbit, ε, one frame-wide bound on
//! |dc|)`** and of nothing else — not the band, not the row, not the order the
//! samples are taken in. That is the property `crate::compute_rows` is pinned on:
//! a band is bit for bit the rows a whole-frame pass would have produced, and a
//! table that knew where a band started would break that in a way no picture
//! would show.
//!
//! ## What one entry means
//!
//! The exact step is `δ' = 2·Z[m]·δ + δ² + dc`. The approximation drops `δ²`, so
//! a single step is `A = 2·Z[m]`, `B = 1`, and the whole question is how large
//! `δ` may be before the dropped term matters. Asking the dropped term to be a
//! fraction `ε` of the term it sits beside,
//!
//! ```text
//! |δ|² ≤ ε·|2·Z[m]·δ|   ⟺   |δ| ≤ 2·ε·|Z[m]|
//! ```
//!
//! and this file uses `r = ε·|Z[m]|`, which is the literature's radius and a
//! factor of two inside that bound.
//!
//! Two runs compose. With `x` valid from `m` for `lx` steps and `y` from `m+lx`
//! for `ly`:
//!
//! ```text
//! A = A_y·A_x     B = A_y·B_x + B_y     l = lx + ly
//! r = min(r_x, max(0, (r_y − |B_x|·dcmax) / |A_x|))
//! ```
//!
//! and `dcmax` is where the frame-wide `|dc|` bound enters: the merged radius has
//! to hold for *every* sample of the frame, so it is taken against the largest
//! `|dc|` any of them carries.
//!
//! **The consequence that makes the skip safe is worth stating on its own.** That
//! merge rule says exactly that a `δ` inside the merged radius is inside `y`'s
//! radius when it arrives there; by induction down to the leaves, a `δ` inside a
//! level-`k` entry's radius satisfies `|δ_j| ≤ ε·|Z_j|` at **every** index the run
//! passes through, not only at its ends. So inside a valid run:
//!
//! - `|z_j| = |Z_j + δ_j| ≥ (1−ε)·|Z_j| > ε·|Z_j| ≥ |δ_j|` for `ε < ½`, so the
//!   rebase test `|z| < |δ|` cannot fire — there is no step where a rebase was
//!   due;
//! - `|z_j| ≤ (1+ε)·|Z_j|`, so a run whose reference stays clear of the bailout
//!   disc cannot escape inside it. That one is held at **build** time: an entry
//!   whose `(1+ε)²·max|Z_j|²` reaches the bailout is given a radius of zero and
//!   is never used.
//!
//! The two remaining ways a skip could decide something the plain loop would not
//! are held the same way — at build time where they are properties of the orbit,
//! and at lookup where they are properties of the sample:
//!
//! - **`last`**: the plain loop rebases when the reference runs out, so no entry
//!   is built whose run reaches index `len − 1`;
//! - **the cap**: `n + l < maxiter`, checked at lookup, so no run steps over the
//!   iteration the plain loop would have stopped at;
//! - **the interior switch**: each entry carries the *smallest* the running
//!   product `∏4|Z_j|²` gets anywhere inside the run, so a run that would have
//!   tripped the switch at any of its steps is refused rather than skipped.
//!
//! **A periodic reference is refused outright.** The kernel's wrap assigns
//! `m = 0` rather than `m % length`, which is right for a unit step and wrong for
//! any other, and a table indexed on an absolute orbit index has nothing to say
//! about an index that wraps. Nothing on the page names a period, so this costs
//! that page nothing.
//!
//! ## The derivative product, which is not `|A|`
//!
//! The interior switch carries `∏ 4·|z_k|²` and a skip has to advance it. The
//! obvious identity — that this is `|A|²` for the run — is **false in two ways
//! and unusable in a third**, which is why every entry carries the product
//! itself:
//!
//! - `A` for a run starting at `m` is `∏_{j=0}^{l−1} 2·Z_{m+j}`, while the loop's
//!   product over the same run is `∏_{j=1}^{l} 4·|z_{m+j}|²`. The index ranges
//!   differ by one at each end, so the two are related by a factor
//!   `|Z_{m+l}|²/|Z_m|²` and not by equality;
//! - it is `z` and not `Z`: the loop multiplies by the *sample's* iterate;
//! - and `A` is an `f64`. `∏2Z` over a few thousand steps overflows or
//!   underflows long before the product the switch needs would, which is the
//!   whole reason the kernel carries that product as a mantissa and an exponent.
//!
//! So an entry stores `∏_{j=1}^{l} 4·|Z_{m+j}|²` in the kernel's own form — a
//! mantissa in `[1, 2^64)` and an exponent that is a multiple of 64 — which
//! composes across a merge by multiplying mantissas and adding exponents. What is
//! left is the `z`-for-`Z` substitution, and inside a valid run that is bounded:
//! each factor is wrong by at most `(1+ε)²`, so the product is wrong by at most
//! `(1+ε)^{2l}` — 0.8% over four thousand steps at `ε = 1e-6`, against a
//! threshold on a quantity that decays geometrically.

use crate::reference::{BAILOUT, Reference};

/// The longest run an entry may stand for, as a power of two. Nothing near it is
/// reachable at any cap this crate's policy produces; it is here so the level
/// count is bounded by something other than the orbit.
pub const MAX_LEVEL: u32 = 24;

/// The level below which runs are not stored — the shortest skip the table
/// offers is `2^MIN_LEVEL` steps.
///
/// Storing every level costs `2·len` entries and buys single-step skips, which
/// replace one iteration with a lookup and are a loss. Dropping the bottom
/// levels costs nothing but the handful of plain steps a sample takes to reach
/// an index the table is aligned on. See the crate README for the sweep.
pub const MIN_LEVEL: u32 = 4;

const TWO64: f64 = 18446744073709551616.0;
const TWO64_INV: f64 = 1.0 / TWO64;

/// One run of `2^level` steps, as the kernel reads it.
///
/// Sixty-four bytes, and the layout is the order the kernel touches them in: the
/// radius decides whether the entry is used at all, then `A` and `B` do the
/// arithmetic, then the two products are read only under the interior switch.
#[derive(Clone, Copy, Debug)]
pub struct Step {
    pub a_re: f64,
    pub a_im: f64,
    pub b_re: f64,
    pub b_im: f64,
    /// The validity radius, squared, so the kernel compares it against the
    /// `|δ|²` it already has. Zero means the entry is never valid.
    pub r_sq: f64,
    /// `∏_{j=1}^{l} 4·|Z_{m+j}|²`, as a mantissa in `[1, 2^64)`.
    pub deriv: f64,
    /// The smallest that product gets over any prefix of the run — what the
    /// interior switch would have seen at its lowest point inside it.
    pub dmin: f64,
    pub deriv_exp: i32,
    pub dmin_exp: i32,
}

/// The skip table for one reference orbit at one tolerance.
pub struct Table {
    /// `levels[k − min_level]`, each entry `j` standing for the run that starts
    /// at orbit index `j·2^k + 1`.
    levels: Vec<Vec<Step>>,
    min_level: u32,
    /// `2^min_level − 1`. An index the shortest run is not aligned on cannot
    /// carry any run, and that is most of them, so the lookup answers with one
    /// mask before it reads anything else.
    mask: usize,
    top_level: u32,
    epsilon: f64,
    dc_bound: f64,
}

/// What an entry looks like while the table is being built: the radius unsquared,
/// because the merge rule is linear in it, and the bailout bound, which is folded
/// into the radius and then thrown away.
#[derive(Clone, Copy)]
struct Build {
    a_re: f64,
    a_im: f64,
    b_re: f64,
    b_im: f64,
    r: f64,
    z_max_sq: f64,
    deriv: f64,
    dmin: f64,
    deriv_exp: i32,
    dmin_exp: i32,
}

impl Build {
    /// An entry that is never valid — the run leaves the orbit, or reaches a
    /// point too near the bailout for the `(1+ε)` bound to clear it.
    const DEAD: Build = Build {
        a_re: 0.0,
        a_im: 0.0,
        b_re: 0.0,
        b_im: 0.0,
        r: 0.0,
        z_max_sq: f64::INFINITY,
        deriv: 0.0,
        dmin: 0.0,
        deriv_exp: 0,
        dmin_exp: 0,
    };

    fn store(&self) -> Step {
        Step {
            a_re: self.a_re,
            a_im: self.a_im,
            b_re: self.b_re,
            b_im: self.b_im,
            r_sq: self.r * self.r,
            deriv: self.deriv,
            dmin: self.dmin,
            deriv_exp: self.deriv_exp,
            dmin_exp: self.dmin_exp,
        }
    }
}

/// A mantissa and a power-of-two exponent, renormalized to the kernel's own
/// convention: mantissa in `[1, 2^64)`, exponent a multiple of 64.
///
/// Zero is carried as `(0, 0)` and stays zero, which is what a reference point at
/// the origin produces and is the one value the interior switch treats specially.
#[inline]
fn normalize(mut mantissa: f64, mut exponent: i32) -> (f64, i32) {
    if mantissa == 0.0 || !mantissa.is_finite() {
        return (0.0, 0);
    }
    while mantissa >= TWO64 {
        mantissa *= TWO64_INV;
        exponent += 64;
    }
    while mantissa < 1.0 {
        mantissa *= TWO64;
        exponent -= 64;
        if mantissa == 0.0 {
            return (0.0, 0);
        }
    }
    (mantissa, exponent)
}

/// The smaller of two normalized products. Exponents are multiples of 64 and
/// mantissas are in `[1, 2^64)`, so the ranges do not overlap and the exponent
/// decides unless they are equal.
#[inline]
fn smaller(a: (f64, i32), b: (f64, i32)) -> (f64, i32) {
    if a.0 == 0.0 {
        return a;
    }
    if b.0 == 0.0 {
        return b;
    }
    match a.1.cmp(&b.1) {
        core::cmp::Ordering::Less => a,
        core::cmp::Ordering::Greater => b,
        core::cmp::Ordering::Equal => {
            if a.0 <= b.0 {
                a
            } else {
                b
            }
        }
    }
}

/// `mantissa · 2^exponent < 2^floor`, exactly — the kernel's own interior test,
/// asked of a product the kernel has not taken yet.
#[inline(always)]
pub fn below_floor(mantissa: f64, exponent: i32, floor: i32) -> bool {
    if mantissa == 0.0 {
        return true;
    }
    exponent <= floor + 64 && mantissa < pow2_at_most(floor - exponent)
}

/// `2^k`, saturating at both ends — [`crate::kernel`]'s, restated here so the two
/// tests are the same test.
#[inline(always)]
fn pow2_at_most(k: i32) -> f64 {
    if k > 1023 {
        f64::INFINITY
    } else if k >= -1022 {
        f64::from_bits(((k + 1023) as u64) << 52)
    } else {
        0.0
    }
}

impl Table {
    /// Build the table for one orbit, in the crate, from the `f64` points.
    ///
    /// **Blocked, so the peak is a block and not the orbit.** A level-`k` entry
    /// lies wholly inside one aligned run of `2^k` indices, so the whole tree
    /// over a block of `2^kmax` starts can be built, stored and dropped before
    /// the next block is touched. Building level by level across the whole orbit
    /// instead would hold `1.5 ×` the orbit's own length in 72-byte working
    /// entries — 5 MB at the anchor and 108 MB at a cap of a million, in a wasm
    /// heap that also holds the orbit.
    ///
    /// `None` where there is nothing to build: a periodic reference, whose wrap
    /// this table cannot address; an orbit too short to hold one run; a
    /// non-positive tolerance.
    pub fn build(orbit: &Reference, epsilon: f64, dc_bound: f64, min_level: u32) -> Option<Table> {
        // The rebase argument in this file's header needs `ε < ½` to say that
        // `(1−ε)·|Z|` is above `ε·|Z|`, and an approximation that close to its
        // own reference is not one. A quarter is a long way past anything the
        // sweep found useful and is here so the bound is stated rather than
        // assumed.
        if orbit.periodic || !(epsilon > 0.0) || epsilon >= 0.25 || !(dc_bound >= 0.0) {
            return None;
        }
        let points = &orbit.points[..];
        // The highest index a run may land on: one below `last`, because the
        // plain loop rebases the moment `m` reaches `last`.
        let top = points.len().checked_sub(2)?;
        // Level-0 entry `j` starts at `s = j + 1` and lands at `s + 1`.
        let starts = top.checked_sub(1)?;
        if starts == 0 {
            return None;
        }

        let mut k_max = 0u32;
        while k_max < MAX_LEVEL && (1usize << (k_max + 1)) <= starts {
            k_max += 1;
        }
        let block = 1usize << k_max;
        let blocks = starts.div_ceil(block);

        let stored = if min_level > k_max {
            0
        } else {
            (k_max - min_level + 1) as usize
        };
        let mut levels: Vec<Vec<Step>> = (0..stored)
            .map(|index| {
                let k = min_level + index as u32;
                Vec::with_capacity(blocks * (block >> k))
            })
            .collect();

        let guard = (1.0 + epsilon) * (1.0 + epsilon);
        let bailout_sq = BAILOUT * BAILOUT;
        let mut work: Vec<Build> = Vec::with_capacity(block);

        for b in 0..blocks {
            work.clear();
            for offset in 0..block {
                let j = b * block + offset;
                let s = j + 1;
                work.push(if s + 1 <= top {
                    let [zr, zi] = points[s];
                    let [nr, ni] = points[s + 1];
                    let z_max_sq = nr * nr + ni * ni;
                    let (deriv, deriv_exp) = normalize(4.0 * z_max_sq, 0);
                    let mut r = epsilon * (zr * zr + zi * zi).sqrt();
                    if guard * z_max_sq > bailout_sq {
                        r = 0.0;
                    }
                    Build {
                        a_re: zr + zr,
                        a_im: zi + zi,
                        b_re: 1.0,
                        b_im: 0.0,
                        r,
                        z_max_sq,
                        deriv,
                        dmin: deriv,
                        deriv_exp,
                        dmin_exp: deriv_exp,
                    }
                } else {
                    Build::DEAD
                });
            }
            if min_level == 0 {
                for entry in &work {
                    levels[0].push(entry.store());
                }
            }
            let mut count = block;
            for k in 1..=k_max {
                count /= 2;
                for index in 0..count {
                    work[index] = merge(&work[2 * index], &work[2 * index + 1], dc_bound);
                }
                if k >= min_level {
                    let into = &mut levels[(k - min_level) as usize];
                    for entry in &work[..count] {
                        into.push(entry.store());
                    }
                }
            }
        }

        let top_level = min_level + levels.len().saturating_sub(1) as u32;
        Some(Table {
            mask: (1usize << min_level) - 1,
            top_level: if levels.is_empty() { 0 } else { top_level },
            levels,
            min_level,
            epsilon,
            dc_bound,
        })
    }

    pub fn min_level(&self) -> u32 {
        self.min_level
    }

    pub fn max_level(&self) -> u32 {
        self.top_level
    }

    pub fn epsilon(&self) -> f64 {
        self.epsilon
    }

    pub fn dc_bound(&self) -> f64 {
        self.dc_bound
    }

    /// Entries held, summed over levels.
    pub fn entries(&self) -> usize {
        self.levels.iter().map(Vec::len).sum()
    }

    /// What the table costs in memory, which is the number a hand-off is priced
    /// against.
    pub fn bytes(&self) -> usize {
        self.entries() * core::mem::size_of::<Step>()
    }

    /// Entries at one level, for the sweep the README reports.
    pub fn level_entries(&self, level: u32) -> usize {
        if level < self.min_level {
            return 0;
        }
        self.levels
            .get((level - self.min_level) as usize)
            .map_or(0, Vec::len)
    }

    /// The longest run this table will let a sample at orbit index `m` take.
    ///
    /// **Bottom-up, and it stops at the first level that does not hold** — which
    /// is right rather than merely quick, because every one of the three tests is
    /// monotone in the level. The radius is non-increasing with level by the
    /// merge rule, the product's floor is non-increasing by the same rule, and a
    /// longer run needs more budget. So the levels that hold are a prefix, and
    /// the last of them is the answer.
    ///
    /// `budget` is `maxiter − n`: a run of `l` is refused unless `l < budget`, so
    /// no skip steps over the iteration the cap would have stopped at.
    #[inline(always)]
    pub fn lookup(
        &self,
        m: usize,
        delta_norm_sq: f64,
        budget: u32,
        interior: Option<(f64, i32, i32)>,
    ) -> Option<(&Step, u32)> {
        let ix = m.wrapping_sub(1);
        if m == 0 || ix & self.mask != 0 || self.levels.is_empty() {
            return None;
        }
        let aligned = if ix == 0 {
            MAX_LEVEL
        } else {
            ix.trailing_zeros()
        };
        let mut found: Option<(&Step, u32)> = None;
        for k in self.min_level..=self.top_level {
            if k > aligned {
                break;
            }
            let length = 1u32 << k;
            if length >= budget {
                break;
            }
            let entry = &self.levels[(k - self.min_level) as usize][ix >> k];
            if !(delta_norm_sq < entry.r_sq) {
                break;
            }
            if let Some((mantissa, exponent, floor)) = interior {
                let (low, low_exp) = normalize(mantissa * entry.dmin, exponent + entry.dmin_exp);
                if below_floor(low, low_exp, floor) {
                    break;
                }
            }
            found = Some((entry, length));
        }
        found
    }
}

/// `y` after `x`, as one entry.
fn merge(x: &Build, y: &Build, dc_bound: f64) -> Build {
    let a_re = y.a_re * x.a_re - y.a_im * x.a_im;
    let a_im = y.a_re * x.a_im + y.a_im * x.a_re;
    let b_re = y.a_re * x.b_re - y.a_im * x.b_im + y.b_re;
    let b_im = y.a_re * x.b_im + y.a_im * x.b_re + y.b_im;

    let a_x = (x.a_re * x.a_re + x.a_im * x.a_im).sqrt();
    let b_x = (x.b_re * x.b_re + x.b_im * x.b_im).sqrt();
    let reach = y.r - b_x * dc_bound;
    let second = if a_x > 0.0 {
        (reach / a_x).max(0.0)
    } else if reach >= 0.0 {
        f64::INFINITY
    } else {
        0.0
    };
    let mut r = x.r.min(second);
    if !a_re.is_finite() || !a_im.is_finite() || !b_re.is_finite() || !b_im.is_finite() {
        r = 0.0;
    }

    let (deriv, deriv_exp) = normalize(x.deriv * y.deriv, x.deriv_exp + y.deriv_exp);
    let dmin = smaller(
        (x.dmin, x.dmin_exp),
        normalize(x.deriv * y.dmin, x.deriv_exp + y.dmin_exp),
    );

    Build {
        a_re,
        a_im,
        b_re,
        b_im,
        r,
        z_max_sq: x.z_max_sq.max(y.z_max_sq),
        deriv,
        dmin: dmin.0,
        deriv_exp,
        dmin_exp: dmin.1,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::fx::Fx;
    use crate::reference;

    fn anchor_orbit(maxiter: u32) -> reference::Reference {
        let c_re = Fx::parse("-0.74501772828532335842941892835857434", 3).unwrap();
        let c_im = Fx::parse("0.14993443275456819177805709088257971", 3).unwrap();
        reference::orbit(&c_re, &c_im, maxiter, None)
    }

    #[test]
    fn the_entry_is_sixty_four_bytes() {
        assert_eq!(core::mem::size_of::<Step>(), 64);
    }

    #[test]
    fn a_periodic_reference_is_refused_rather_than_wrapped() {
        let c_re = Fx::parse("-1.7548776662466927600495", 4).unwrap();
        let wrapped = reference::orbit(&c_re, &Fx::zero(4), 20_000, Some(3));
        assert!(wrapped.periodic);
        assert!(Table::build(&wrapped, 1e-6, 0.0, MIN_LEVEL).is_none());
    }

    /// The level count and the entry count are the shape the sweep reports, and
    /// they follow from the minimum level alone.
    #[test]
    fn the_stored_levels_halve_and_the_minimum_level_sets_the_total() {
        let orbit = anchor_orbit(48_551);
        for min_level in [0u32, 2, 4, 6] {
            let table = Table::build(&orbit, 1e-6, 2e-11, min_level).unwrap();
            assert_eq!(table.min_level(), min_level);
            let top = table.max_level();
            for k in min_level..top {
                // Each level is half the one below it, up to the rounding a
                // partial block leaves.
                let here = table.level_entries(k);
                let above = table.level_entries(k + 1);
                assert_eq!(here / 2, above, "level {k}: {here} then {above}");
            }
        }
    }

    /// A skip's arithmetic against the loop it stands for: run the plain
    /// recurrence over the same indices and compare.
    #[test]
    fn an_entry_reproduces_the_run_it_stands_for() {
        let orbit = anchor_orbit(20_000);
        let table = Table::build(&orbit, 1e-9, 1e-13, 0).unwrap();
        let points = &orbit.points[..];
        let (dc_re, dc_im) = (1e-13, -4e-14);
        // Start at an index every level is aligned on.
        let m = 1usize;
        let delta = (3e-14, 1e-14);
        let mut seen = 0;
        for k in 0..=6u32 {
            let length = 1usize << k;
            // The entry at this level, taken directly rather than through the
            // lookup, which answers only with the longest run it will allow.
            let budget = length as u32 + 1;
            let Some((step, got)) =
                table.lookup(m, delta.0 * delta.0 + delta.1 * delta.1, budget, None)
            else {
                continue;
            };
            if got as usize != length {
                // A shorter run than this level: the level's own radius did not
                // hold for this delta, which is the table refusing rather than
                // failing.
                continue;
            }
            seen += 1;
            let (mut dr, mut di) = delta;
            let mut index = m;
            for _ in 0..length {
                let ar = points[index][0] * 2.0 + dr;
                let ai = points[index][1] * 2.0 + di;
                let nr = ar * dr - ai * di + dc_re;
                let ni = ar * di + ai * dr + dc_im;
                dr = nr;
                di = ni;
                index += 1;
            }
            let skipped_re =
                step.a_re * delta.0 - step.a_im * delta.1 + step.b_re * dc_re - step.b_im * dc_im;
            let skipped_im =
                step.a_re * delta.1 + step.a_im * delta.0 + step.b_re * dc_im + step.b_im * dc_re;
            let error = ((skipped_re - dr).powi(2) + (skipped_im - di).powi(2)).sqrt();
            let size = (dr * dr + di * di).sqrt().max(1e-300);
            assert!(
                error / size < 1e-6,
                "level {k}: relative {:e} over {length} steps",
                error / size
            );
        }
        assert!(seen >= 5, "only {seen} levels were valid at all");
    }

    /// **The claim the whole design rests on**, and the exact shape of it,
    /// because getting the shape wrong is what a first version of this file did.
    ///
    /// Inside a valid run the delta stays under `ε·|Z|` at every index the run
    /// *passes through* — `m` up to `m + l − 1` — because each of those is the
    /// start of some level-0 leaf of the decomposition and the merge rule
    /// carries the radius down to it. The index the run **lands** on is the
    /// start of no leaf inside the entry and is bounded by nothing here, which
    /// is exactly why `crate::kernel` runs its escape, interior, cap and rebase
    /// tests on the landed delta rather than resuming past them.
    #[test]
    fn a_valid_run_keeps_the_delta_under_epsilon_z_at_every_step_it_passes_through() {
        let epsilon = 1e-6;
        let orbit = anchor_orbit(20_000);
        let points = &orbit.points[..];
        // A deep frame's `dc` bound, because that is where the runs are long
        // enough to be worth walking: the run length a merge allows is set by
        // how far `|B|·dcmax` is from `ε·|Z|`, so a wide frame gives runs of a
        // few steps and a deep one gives runs of thousands.
        let mut checked = 0usize;
        for (dc_bound, dc_re, dc_im) in [
            (1.2e-11f64, 1.1e-11f64, -0.7e-12f64),
            (1.2e-25, 1.1e-25, -0.7e-26),
            (1.2e-30, 1.1e-30, -0.7e-31),
        ] {
        let table = Table::build(&orbit, epsilon, dc_bound, 0).unwrap();
        assert!((dc_re * dc_re + dc_im * dc_im).sqrt() <= dc_bound);

        for m in [1usize, 2, 4, 8, 16, 64, 256, 1024, 4096] {
            for scale in [0.0, 1e-3, 0.5, 0.99] {
                let z = (points[m][0].powi(2) + points[m][1].powi(2)).sqrt();
                let (mut dr, mut di) = (scale * epsilon * z, 0.0);
                let Some((_, length)) = table.lookup(m, dr * dr + di * di, 20_000, None) else {
                    continue;
                };
                let mut index = m;
                // One step short of the landing index, which the entry says
                // nothing about.
                for _ in 0..length - 1 {
                    let ar = points[index][0] * 2.0 + dr;
                    let ai = points[index][1] * 2.0 + di;
                    let nr = ar * dr - ai * di + dc_re;
                    let ni = ar * di + ai * dr + dc_im;
                    dr = nr;
                    di = ni;
                    index += 1;
                    let zr = points[index][0];
                    let zi = points[index][1];
                    let bound = epsilon * (zr * zr + zi * zi).sqrt();
                    assert!(
                        (dr * dr + di * di).sqrt() <= bound * 1.000_001,
                        "m={m} step {index}: |δ| {:e} over ε|Z| {bound:e}",
                        (dr * dr + di * di).sqrt()
                    );
                    checked += 1;
                }
            }
        }
        }
        assert!(checked > 1000, "only {checked} intermediate steps checked");
    }

    /// No entry reaches the last index of the orbit, which is the index the plain
    /// loop rebases at.
    #[test]
    fn no_run_reaches_the_index_the_plain_loop_rebases_at() {
        let orbit = anchor_orbit(4_000);
        let last = orbit.len() - 1;
        let table = Table::build(&orbit, 1e-3, 0.0, 0).unwrap();
        for m in 1..last {
            if let Some((_, length)) = table.lookup(m, 0.0, u32::MAX, None) {
                assert!(
                    m + (length as usize) < last,
                    "a run from {m} of {length} reaches {last}"
                );
            }
        }
    }

    /// The cap is the sample's and the table has to respect it, which is the one
    /// of the four guards that cannot be held at build time.
    #[test]
    fn a_run_never_steps_over_the_cap() {
        let orbit = anchor_orbit(4_000);
        let table = Table::build(&orbit, 1e-3, 0.0, 0).unwrap();
        for budget in [1u32, 2, 3, 17, 64, 65] {
            if let Some((_, length)) = table.lookup(1, 0.0, budget, None) {
                assert!(length < budget, "budget {budget} took a run of {length}");
            }
        }
    }
}
