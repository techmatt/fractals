//! The cap a frame settles on, decided by the frame.
//!
//! **The problem this exists for is in the crate README's §6**, and it is the
//! worst kind: below about 1e-22 the width policy's cap lands *inside* the
//! frame's own escape-count distribution, so a sixth to a third of a busy frame
//! runs out of iterations and is painted `NaN` — interior — when it was exterior
//! all along. Nothing on the page looks wrong. The seven frames of
//! `tests/frames.rs` are the cases, and on five of them twice the cap resolves
//! the whole picture for about 3% more mean iterations.
//!
//! **A width rule was not available.** `anchor 1e-22` is 100% proven interior at
//! the policy cap and `tangle 1e-22` is 29% cap-starved at the same width and
//! the same cap: what a frame needs depends on what it contains, which is the
//! same ruling §7 reached about the interior switch and for the same reason. So
//! the policy is **self-escalation**: start at the width's cap, look at what
//! died there, and double until the frame stops dying for want of iterations.
//!
//! ## Telling the two kinds of cap-death apart
//!
//! A sample that ends `NaN` did so in one of three ways, and only the third is a
//! fault:
//!
//! - **proven interior** — [`Kernel::interior`](crate::kernel::Kernel::interior)
//!   fired, `|dz|²` fell under `2^-64`, and the sample is in an attractor's
//!   basin. A deeper cap would confirm it and change nothing.
//! - **on its way there** — the cap stopped it with no proof, but `|dz|` is
//!   small: the derivative is contracting, the sample is inside a component
//!   whose period is of the order of the cap, and black is already the right
//!   colour. This is most of what the audit's anchor at 2e-11 is made of, where
//!   the minibrot's period is 2,838 and only seventeen of them fit inside the
//!   cap, so the switch has no room to fire.
//! - **the cap's fault** — the cap stopped it with `|dz|` **grown past the
//!   escape radius**. The map is expanding hard here, nothing about this sample
//!   is settling into anything, and the only reason it is black is that the loop
//!   ran out. [`FAULT_EXPONENT`] is that bar.
//!
//! **The second kind is why "the unresolved share stopped falling" is not a stop
//! and why the derivative had to be handed out.** The share of a frame that dies
//! unproven says nothing on its own: it is 100% on `body 1e-22` at both the
//! policy cap and twice it, where the frame is exterior the cap has not reached,
//! and it is 38% on the anchor at 2e-11, where the frame is interior the switch
//! cannot prove. One number, opposite pictures.
//! [`crate::kernel::Outcome::dz_log2`] is what tells them apart, and it
//! separates them by two orders of magnitude: over the nine frames of
//! `tests/frames.rs` the deep frames' starved samples sit at `log₂|dz|²` between
//! +25 and +404 and the anchor's at a median of −3.
//!
//! ## What it costs
//!
//! The decision runs on a **sparse sample of the frame's own grid** —
//! [`PROBE_COLS`] × [`PROBE_ROWS`] of the sample cells a full pass would draw,
//! at the frame's own limb count, through the frame's own geometry — so the
//! supersampled fine pass runs **once**, at the settled cap. The probe's cells
//! are a literal subset of the frame's: nothing about the arithmetic is
//! approximated to make it cheap, only the number of samples.
//!
//! ## Where it runs
//!
//! **The probe is cut into row ranges and spread over the pool**, exactly as a
//! band is, which is why [`probe_rows`] takes a reference orbit rather than
//! computing one: the page already has the machinery for putting an orbit in
//! every worker and it is the same orbit the frame will be drawn from. One
//! worker walking the whole probe of `body 1e-28` at eight times the policy cap
//! is about seven seconds nobody can cancel; over eight it is under a second.
//! [`settle`] is the same walk in one call, for the native harness and for
//! anything that has a whole machine.

use crate::kernel::Kernel;
use crate::reference::Reference;
use crate::{Spec, cap, progress};

/// How far `log₂|dz|²` has to have grown for a cap-starved sample to be the
/// cap's fault rather than a picture that is already right.
///
/// **Sixteen, which is `|dz|² > 65,536` — the escape radius.** A sample whose
/// squared derivative has outgrown the disc the iterate itself has to stay
/// inside is a sample the map is expanding, and expansion is what exterior is.
///
/// **Swept, not guessed, and on a wide plateau.** Over the thirteen frames of
/// `tests/frames.rs` the settled cap is the same at every bar from 8 to 24 and
/// every share from 8% to 15%. The crate README carries the sweep.
pub const FAULT_EXPONENT: f64 = 16.0;

/// The share of the frame that may still be the cap's fault when a cap is
/// settled on.
///
/// **A tenth.** The smallest share that has to make a frame escalate is
/// `pinch 1e-28` at 17%, and the largest that must not is the anchor at 2e-11
/// at 5%; a tenth is between them and the sweep either side of it moves nothing.
pub const FAULT_SHARE: f64 = 0.10;

/// What an unresolved cap is multiplied by. **Doubling**, which is what §6's own
/// sweep of the seven frames was taken at, so a settled cap is a rung of the
/// table that argued for this.
pub const ESCALATION: u32 = 2;

/// The probe grid: how many of the frame's own sample cells the decision looks
/// at.
///
/// **Sparse on purpose, and the whole reason the fine pass runs once.** A deep
/// Render is three passes over roughly 1.9 million lanes; this is 2,304 samples,
/// about a thousandth of one of them, and measured over the thirteen frames the
/// whole escalation costs 0.08% to 0.22% of the fine pass it decides for. The
/// cells are spread evenly across the supersampled grid and are the grid's own
/// cells, so the probe is a subset of the frame rather than a smaller picture of
/// it.
///
/// **The page passes its own**, because how finely to probe is a cost decision
/// and the pool is what pays it; these are the defaults and what the harness
/// measures at.
pub const PROBE_COLS: u32 = 64;
/// See [`PROBE_COLS`].
pub const PROBE_ROWS: u32 = 36;

/// What a walk of some of the probe's cells came to, at one cap.
///
/// Summable, because the page walks it in bands: `escaped + proven + starved`
/// is `samples`, and `fault` is the part of `starved` that is the cap's.
#[derive(Clone, Copy, Debug, Default)]
pub struct Counts {
    /// The cap these were taken at. Zero on an empty accumulator.
    pub maxiter: u32,
    pub samples: u32,
    pub escaped: u32,
    /// Unresolved and **proven** interior: the switch fired.
    pub proven: u32,
    /// Unresolved at the cap with no proof, of either kind.
    pub starved: u32,
    /// Starved **and** expanding: the cap's fault, and the only number the
    /// stopping rule reads.
    pub fault: u32,
    pub iterations: u64,
}

impl Counts {
    /// Add a band's counts to a frame's.
    pub fn add(&mut self, band: &Counts) {
        self.maxiter = band.maxiter.max(self.maxiter);
        self.samples += band.samples;
        self.escaped += band.escaped;
        self.proven += band.proven;
        self.starved += band.starved;
        self.fault += band.fault;
        self.iterations += band.iterations;
    }

    /// The share of the whole probe that is the cap's fault.
    pub fn fault_share(&self) -> f64 {
        if self.samples == 0 {
            0.0
        } else {
            self.fault as f64 / self.samples as f64
        }
    }

    /// Whether this cap draws the frame. **The rule, in one place.**
    pub fn resolved(&self) -> bool {
        self.fault_share() <= FAULT_SHARE
    }
}

/// The next cap to try, saturating at [`cap::CEILING`].
pub fn next_cap(maxiter: u32) -> u32 {
    maxiter
        .saturating_mul(ESCALATION)
        .min(cap::CEILING as u32)
        .max(maxiter)
}

/// Walk probe rows `[row_start, row_end)` of a `cols × rows` probe of this
/// frame, at the spec's own cap and against an orbit computed for it.
///
/// The orbit is **borrowed**: it is the frame's own, one per rung, and the
/// caller keeps it for the next band the way [`crate::compute_band`]'s caller
/// does.
pub fn probe_rows(
    spec: &Spec,
    orbit: &Reference,
    cols: u32,
    rows: u32,
    row_start: u32,
    row_end: u32,
) -> Counts {
    let maxiter = spec.maxiter();
    let kernel = Kernel::new(orbit, maxiter, spec.interior).at_entry(spec.entry());
    let offset = spec.centre_offset().unwrap_or((0.0, 0.0));
    let julia = spec.julia.is_some();
    let sample_width = spec.sample_width().max(1);
    let sample_height = spec.sample_height().max(1);
    let cols = cols.clamp(1, sample_width);
    let rows = rows.clamp(1, sample_height);

    let mut counts = Counts {
        maxiter,
        ..Counts::default()
    };
    let last = row_end.min(rows);
    let cells = last.saturating_sub(row_start) * cols;
    for j in row_start..last {
        let row = spread(j, rows, sample_height);
        for i in 0..cols {
            progress::report((j - row_start) * cols + i, cells);
            let col = spread(i, cols, sample_width);
            let (re, im) = spec.dc(offset, col, row);
            let outcome = kernel.sample_at(spec.degree, julia, re, im);
            counts.samples += 1;
            counts.iterations += outcome.iterations as u64;
            if !outcome.smooth.is_nan() {
                counts.escaped += 1;
            } else if outcome.detected_interior {
                counts.proven += 1;
            } else {
                counts.starved += 1;
                if outcome.dz_log2() > FAULT_EXPONENT {
                    counts.fault += 1;
                }
            }
        }
    }
    counts
}

/// The cap a frame settled on, and what it was settled on.
#[derive(Clone, Debug)]
pub struct Settled {
    /// The cap to draw at.
    pub maxiter: u32,
    /// The cap it started from — the width policy's, or whatever the spec named.
    pub from: u32,
    /// Doublings taken.
    pub steps: u32,
    /// **The frame is still the cap's fault at the ceiling.** A page says so
    /// plainly rather than pretending the picture is finished.
    pub at_ceiling: bool,
    /// What deciding cost, in sample-iterations over every rung.
    pub iterations: u64,
    /// Every rung walked, opening at `from`.
    pub rungs: Vec<Counts>,
}

impl Settled {
    /// The rung the cap settled on.
    pub fn settled(&self) -> Counts {
        *self.rungs.last().expect("a settle walks at least one rung")
    }
}

/// Walk the whole escalation in one call and return the cap this frame resolves
/// at.
///
/// Opens at `spec.maxiter()` — the width policy's answer unless the spec named
/// one — and doubles while more than [`FAULT_SHARE`] of the probe is the cap's
/// fault, stopping at [`cap::CEILING`]. A spec that will not produce a reference
/// orbit gives back the kernel's own sentence.
///
/// **The page does not call this**; it drives the same walk a rung at a time so
/// that a reader can cancel between rungs and the probe can be spread over the
/// pool. This is the same rule in one piece, for the native harness.
pub fn settle(spec: &Spec, cols: u32, rows: u32) -> Result<Settled, String> {
    let ceiling = cap::CEILING as u32;
    let from = spec.maxiter();
    let mut maxiter = from.min(ceiling);
    let mut rungs: Vec<Counts> = Vec::new();
    let mut iterations = 0u64;
    let mut steps = 0u32;

    loop {
        let rung_spec = Spec {
            maxiter: Some(maxiter),
            ..spec.clone()
        };
        let orbit = rung_spec.reference_orbit()?;
        let rung = probe_rows(&rung_spec, &orbit, cols, rows, 0, rows);
        iterations += rung.iterations;
        rungs.push(rung);

        if rung.resolved() || maxiter >= ceiling {
            return Ok(Settled {
                maxiter,
                from,
                steps,
                at_ceiling: maxiter >= ceiling && !rung.resolved(),
                iterations,
                rungs,
            });
        }
        maxiter = next_cap(maxiter);
        steps += 1;
    }
}

/// The `index`-th of `count` cells spread evenly across `span`, taken at the
/// middle of its share — so a probe of one column is the middle of the frame
/// rather than its left edge.
///
/// Public so that a harness walking the same cells reads this rule rather than
/// keeping a second copy of it *(deep_refactor_ckpt138)*: `tests/common`'s
/// `walk_cells` is written to match [`probe_rows`], and a spread that agreed
/// with it today and drifted tomorrow is exactly the failure that would make a
/// measurement and the shipped probe quietly different pictures.
pub fn spread(index: u32, count: u32, span: u32) -> u32 {
    let numerator = index as u64 * 2 + 1;
    ((numerator * span as u64) / (count as u64 * 2)).min(span as u64 - 1) as u32
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_probe_cell_sits_in_the_middle_of_its_share() {
        assert_eq!(spread(0, 1, 1136), 568);
        assert_eq!(spread(0, 2, 1136), 284);
        assert_eq!(spread(1, 2, 1136), 852);
    }

    #[test]
    fn a_probe_wider_than_the_frame_is_the_frame() {
        assert_eq!(spread(0, 10, 4), 0);
        assert_eq!(spread(9, 10, 4), 3);
    }

    /// The bar is the escape radius, said in the units `|dz|²` is carried in.
    #[test]
    fn the_fault_bar_is_the_escape_radius() {
        assert_eq!(2f64.powf(FAULT_EXPONENT), crate::reference::BAILOUT);
    }

    /// A cap that has reached the ceiling does not move, and one under it
    /// doubles into it rather than past it.
    #[test]
    fn the_escalation_stops_at_the_ceiling() {
        assert_eq!(next_cap(93_600), 187_200);
        assert_eq!(next_cap(600_000), 1_000_000);
        assert_eq!(next_cap(1_000_000), 1_000_000);
        assert_eq!(next_cap(u32::MAX), u32::MAX);
    }

    /// Bands sum to the frame, which is what lets the page cut the probe up.
    #[test]
    fn counts_add() {
        let mut whole = Counts::default();
        whole.add(&Counts {
            maxiter: 100,
            samples: 10,
            escaped: 6,
            proven: 1,
            starved: 3,
            fault: 2,
            iterations: 500,
        });
        whole.add(&Counts {
            maxiter: 100,
            samples: 10,
            escaped: 10,
            ..Counts::default()
        });
        assert_eq!(whole.samples, 20);
        assert_eq!(whole.escaped, 16);
        assert_eq!(whole.fault, 2);
        assert_eq!(whole.iterations, 500);
        assert_eq!(whole.maxiter, 100);
        assert!(whole.resolved());
        assert!((whole.fault_share() - 0.1).abs() < 1e-12);
    }

    /// An empty probe is resolved rather than a division by zero.
    #[test]
    fn an_empty_probe_says_nothing_is_wrong() {
        assert_eq!(Counts::default().fault_share(), 0.0);
        assert!(Counts::default().resolved());
    }
}
