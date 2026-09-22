//! Deep frames that have something in them, as cases — and the cheap pins that
//! hold the record honest.
//!
//! The anchor ladder this crate is priced on has one blind spot: every rung
//! below the minibrot's own 6.5e-12 atom is inside its body and **100%
//! interior**, so anything measured down there is measured on a picture with no
//! exterior in it. `tests/descend.rs` is the program that went and found frames
//! without that defect, and the seven in `tests/common` are what it settled on
//! — committed there so that any later deep work (the cap policy, a nucleus
//! reference, a second reference orbit) has the same frames to run against
//! rather than finding its own and reporting numbers nothing can be compared
//! with.
//!
//! **The record is `tests/common` and the harnesses are `tests/measure.rs`**
//! *(deep_refactor_ckpt138)*. This file was both and was 800 lines of it; what
//! is left is the part that costs nothing and catches the two ways a committed
//! frame goes quietly wrong. Every file under `tests/` is its own crate, which
//! is why the frames themselves sit in a directory module both binaries declare
//! rather than in this one.
//!
//! ```text
//! cargo test --release                 # these two, in well under a second
//! cargo test --release --test measure -- --ignored --nocapture   # the tables
//! ```
//!
//! They were found for a skip table that has since been taken back out; **§6 of
//! the crate README is the measurement and the ruling**, and §6's open problem —
//! that at these depths the policy cap paints exterior as interior — is what
//! `measure.rs`'s `what_a_deeper_cap_resolves` is the evidence for.

mod common;

use common::{DEEP_FRAMES, DEGREE_FRAMES, Frame, decade, link};
use perturb::cap;

/// **The frames are still frames a link can spell**, and still at the cap their
/// own row claims.
///
/// Cheap on purpose — it renders nothing. What it guards is the two ways a
/// committed frame goes quietly wrong: a centre that grew past the 64
/// characters `explorer/deep-link.js` caps a coordinate at, so the `dv` link
/// beside it in `README.md` would be refused by the page rather than by
/// anything here; and a cap that stopped being the policy's, which would make
/// every number ever taken on it a number of a frame the tab does not draw.
#[test]
fn the_deep_frames_are_spellable_and_at_the_cap_they_claim() {
    /// `explorer/permalink.js`'s `COORDINATE_LIMIT`, which the deep contract
    /// shares rather than restating — a URL is one thing however deep it is.
    const COORDINATE_LIMIT: usize = 64;
    assert_eq!(DEEP_FRAMES.len(), 7, "the descent settled on seven");
    // And seven at each higher degree, the same seven kinds.
    for degree in 3..=6 {
        let at = DEGREE_FRAMES
            .iter()
            .filter(|frame| frame.degree == degree)
            .count();
        assert_eq!(at, 7, "degree {degree} has {at} frames");
    }
    for frame in DEEP_FRAMES.iter().chain(DEGREE_FRAMES) {
        let Frame {
            label,
            re,
            im,
            width,
            maxiter,
            multiple,
            degree,
        } = frame;
        assert_eq!(
            multiple * cap::for_width(*width),
            *maxiter,
            "{label} is off the policy"
        );
        for text in [re, im] {
            assert!(
                text.len() <= COORDINATE_LIMIT,
                "{label}: a centre of {} characters is past what a link carries",
                text.len()
            );
            assert!(
                perturb::fx::Fx::parse(text, 16).is_some(),
                "{label}: `{text}` is not a decimal"
            );
        }
        // The digits are there to be spent: a centre trimmed so hard that the
        // frame's own pixels fall inside one of its ulps is a frame nobody can
        // return to, and it would look exactly like this one.
        let digits = re.split_once('.').map_or(0, |(_, frac)| frac.len());
        let decade = decade(*width) as f64;
        assert!(
            digits as f64 > decade + 3.0,
            "{label}: {digits} digits is not enough to place a pixel of a {width:e} frame"
        );
        // And the link is the frame, since it is what a reader opens rather
        // than the row.
        let query = link(frame);
        assert!(
            query.contains(&format!("&w=1e-{}&n={maxiter}", decade as i32)),
            "{query}"
        );
        // A higher degree's link names its family, or the page would draw the
        // Mandelbrot set there.
        assert_eq!(
            query.contains(&format!("f=multibrot{degree}")),
            *degree != 2,
            "{query}"
        );
        assert!(query.contains(*re) && query.contains(*im), "{query}");
    }
}

/// The policy caps these rows quote, so a reader of a table can check them.
#[test]
fn the_policy_cap_at_the_widths_these_frames_sit_at() {
    assert_eq!(cap::for_width(1e-22), 93_600);
    assert_eq!(cap::for_width(1e-28), 117_518);
    assert_eq!(cap::for_width(1e-40), 165_354);
    assert_eq!(cap::for_width(1e-54), 221_162);
}
