//! Inflection: a pre-map on the starting point, and nothing else.
//!
//! The technique deep-zoom people call *inflection* or *Julia morphing*. An ordinary
//! Julia render takes a pixel's coordinate `z` and iterates `z ← z² + c`. An inflection
//! at a point `p` replaces `z` by `(z − p)² + p` **before** the first iteration. With a
//! list `p₁ … pₙ` in click order a pixel is mapped through `pₙ` first, then `pₙ₋₁`, and
//! last through `p₁` — so the earliest click is the outermost map, which is what makes
//! the construction grow outward from the first point as later ones are added.
//!
//! **Only the orbit's starting point moves.** The recurrence, the cap, the escape test,
//! every channel the modes read and every reduction over them are the engine's, untouched
//! and un-re-spelled: this file hands [`fractal_engine::iterate::run`] a different `z₀`
//! and steps out of the way. So every mode, palette, shade recipe and tone curve works
//! here because none of them is told anything.
//!
//! Each map fixes `p` and is two-to-one around it, so the picture that was at `p`
//! reappears wrapped twice about it — exact two-fold symmetry there. Content that sat
//! within `r` of `p` comes back within about `√r`, which is where the caller's width
//! rule comes from.
//!
//! **Why this is in the wasm crate and not in the engine.** The seam it needs is one
//! substitution at one expression — `view.sample_point(col, row)`, which this crate
//! already passes to `iterate::run` at both of its call sites. The engine has nothing to
//! say about it and nothing next door is changed for it, so `engine.wasm` grows a
//! feature and `fractal-engine` does not move at all.
//!
//! **The cost of the table below.** [`fractal_engine::field::sweep_row`] specializes the
//! generic loop over eleven families and twelve channel sets, and a caller that cannot
//! reach that table pays about 3.3x on `julia` (`explorer/README.md`, *Measured*). This
//! tab is degree-2 Julia and nothing else, so the table it needs is one family wide, and
//! it is written out here for the same reason the engine writes its own out: so that the
//! only thing an inflected frame costs over a plain one is the pre-map.
//!
//! **Measured, and it took two goes.** `bench/inflect.mjs` holds the work still — a frame
//! entirely inside the set at a pinned cap, so every sample of both runs the cap to the
//! end — and reads this loop against the engine's on identical arithmetic. It came in at
//! **1.29x on `smooth`** until the family was rebuilt as a literal inside `sweep_row`; see
//! the note there. It is **0.97x to 0.99x** now, which is parity, and six points cost what
//! one does.

use fractal_engine::family::Family;
use fractal_engine::field::{Channels, FieldSpec};
use fractal_engine::iterate::{self, Wants};
use fractal_engine::viewport::Viewport;
use num_complex::Complex;

/// The most inflections one picture may carry.
///
/// A ceiling rather than a judgement: each one is a complex multiply per sample, so cost
/// is not what bounds this — `(z − p)² + p` doubles the winding at every step, and past a
/// couple of dozen the structure a click is placed on is finer than the sample grid, so
/// what the reader would be steering is aliasing. The link contract carries the same
/// number so that a refusal happens before a frame is started.
pub const MAX_INFLECTIONS: usize = 32;

/// `z` through the whole list: the last click first, the first click last.
///
/// Written iteratively over the reversed slice rather than recursively, because it runs
/// once per sample and the list is short and hot.
#[inline(always)]
pub fn premap(points: &[Complex<f64>], z: Complex<f64>) -> Complex<f64> {
    let mut z = z;
    for p in points.iter().rev() {
        let d = z - p;
        z = d * d + p;
    }
    z
}

/// The families an inflection is defined for here: `z² + c`, and nothing else.
///
/// Not a limit of the arithmetic — the pre-map is a statement about the plane and not
/// about the recurrence — but of this trial. A degree-3 Julia inflected at a point is a
/// picture nobody has asked for yet, and offering it would put eleven families behind a
/// tab whose whole point is that Matt can look at one kind of picture and say yes or no.
pub fn refuse_family(family: &Family) -> Option<String> {
    match family {
        Family::Julia { degree: 2, .. } => None,
        _ => Some(
            "an inflection is only drawn on the degree-2 Julia set here: the pre-map is the \
             same z ↦ (z − p)² + p whatever is iterated after it, but this tab is a trial of \
             one kind of picture and offers one family"
                .to_string(),
        ),
    }
}

/// Why this coloring cannot be inflected, or `None`.
///
/// **The derivative is the one channel the pre-map is not transparent to.** Every other
/// channel is a statement about the orbit, and the orbit is the engine's from an altered
/// starting point; `derivative` is a statement about how the orbit moves when the *pixel*
/// moves, and a pre-map puts a factor `g'(z) = ∏ 2(zₖ − pₖ)` between the two. Carrying it
/// means multiplying that factor into the orbit's derivative before the field reduces it,
/// which is inside [`fractal_engine::iterate::Orbit`] and so is a change next door rather
/// than a seam here.
///
/// It costs nothing to refuse: `de` is the only field that sets the flag, and `de` is not
/// one of the seventeen modes this page offers — the explorer has never drawn it. So this
/// is a guard against a spec written by hand, and the reason it is a guard rather than an
/// approximation is that the wrong answer here is a plausible picture: a distance estimate
/// off by a smooth factor still looks like a distance estimate.
pub fn refuse_wants(wants: &Wants) -> Option<String> {
    wants.derivative.then(|| {
        "a distance-estimate mode cannot be inflected here: the estimate divides by the \
         derivative of the orbit with respect to the pixel, and a pre-map puts a factor \
         between the two that this module does not carry"
            .to_string()
    })
}

/// One row of an inflected frame, into `lanes`, one `Vec` per field.
///
/// [`fractal_engine::field::sweep_row`]'s shape, over one family: the channel set is
/// rebuilt inside each arm so that the inliner can see it as a constant, which is the
/// correctness condition the engine's own [`fractal_engine::field::Channels::of`]
/// documents — a set whose rebuild is not the set the fields asked for takes the generic
/// arm instead of being drawn wrong.
///
/// `family` is passed whole rather than destructured so that the `c` the caller resolved
/// is the `c` iterated; [`refuse_family`] has already held it to being a degree-2 Julia.
pub fn sweep_row(
    view: &Viewport,
    family: &Family,
    points: &[Complex<f64>],
    maxiter: u32,
    fields: &[FieldSpec],
    wants: Wants,
    row: u32,
    lanes: &mut [Vec<f64>],
) {
    let width = view.sample_width();

    // **The family is rebuilt as a literal, and that is worth measuring.**
    // `iterate::run` collapses to the bare recurrence only where the inliner can see the
    // variant at the call site, which is why the engine's own table expands
    // `over_written_out!` into one arm per family rather than passing a `&Family` through.
    // Handing it the caller's reference leaves the match over eleven families live in the
    // innermost loop: measured at **1.29x on `smooth`** — the cheapest recurrence, where a
    // fixed per-iteration overhead is the largest share — against 1.02x on `curvature`.
    // Reconstructed here from the one variant this file draws, the match folds away.
    // `refuse_family` has already held the caller to that variant.
    //
    // The `else` is unreachable through `resolve`, which takes `refuse_family` first, and
    // it fills the row rather than returning from it: a caller that got here anyway would
    // otherwise be handed lanes shorter than the band it asked for, and a short band is
    // read as bytes past the end of it. `NaN` is what this module already means by *no
    // value here*, so an impossible row comes back as a hole rather than as an overrun.
    let Family::Julia { c, .. } = *family else {
        for lane in lanes.iter_mut() {
            lane.extend(std::iter::repeat_n(f64::NAN, width as usize));
        }
        return;
    };
    let family = Family::Julia { degree: 2, c };

    macro_rules! sweep {
        ($wants:expr) => {{
            let wants = $wants;
            for col in 0..width {
                let z = premap(points, view.sample_point(col, row));
                let orbit = iterate::run(&family, z, maxiter, &wants);
                for (lane, field) in lanes.iter_mut().zip(fields) {
                    lane.push(field.reduce(&orbit).unwrap_or(f64::NAN));
                }
            }
        }};
    }

    // Classified by the engine rather than here. `Channels::of` is the twelve-way
    // question *and* the rebuild check that makes it safe — a set whose single-channel
    // rebuild is not equal to it comes back `Many` and takes the generic arm rather than
    // being drawn with the other channels quietly dropped. A copy of that reasoning on
    // this side is a second thing to keep in step, so there is not one.
    let none = Wants::default();
    match Channels::of(wants) {
        Channels::None => sweep!(none),
        Channels::Stripe(density) => sweep!(Wants {
            stripe: Some(density),
            ..none
        }),
        Channels::Tia => sweep!(Wants { tia: true, ..none }),
        Channels::Curvature => sweep!(Wants {
            curvature: true,
            ..none
        }),
        Channels::TrapCircle(radius) => sweep!(Wants {
            trap_circle: Some(radius),
            ..none
        }),
        Channels::TrapCross => sweep!(Wants {
            trap_cross: true,
            ..none
        }),
        Channels::Threads(sigma) => sweep!(Wants {
            threads: Some(sigma),
            ..none
        }),
        Channels::GaussianInt => sweep!(Wants {
            gaussian_int: true,
            ..none
        }),
        Channels::ExpSmoothing => sweep!(Wants {
            exp_smoothing: true,
            ..none
        }),
        Channels::Velocity => sweep!(Wants {
            velocity: true,
            ..none
        }),
        Channels::Itinerary(symbols) => sweep!(Wants {
            itinerary: Some(symbols),
            ..none
        }),
        // Unreachable through `resolve`, which takes `refuse_wants` first. Written out
        // rather than left to the generic arm so that the match is the engine's table and
        // a reader comparing the two finds no silent gap in this one.
        Channels::Derivative => sweep!(Wants {
            derivative: true,
            ..none
        }),
        Channels::Many(wants) => sweep!(wants),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn at(re: f64, im: f64) -> Complex<f64> {
        Complex::new(re, im)
    }

    /// An empty list is the identity, which is the acceptance line stated as arithmetic:
    /// with nothing clicked, the point handed to the engine is the point it always got.
    #[test]
    fn empty_is_the_identity() {
        for z in [at(0.0, 0.0), at(-0.75, 0.13), at(1e-9, -4.0)] {
            assert_eq!(premap(&[], z), z);
        }
    }

    /// The map fixes `p`: it is the one point an inflection does not move. So the last
    /// click — the one applied first — contributes nothing at its own centre, which is
    /// why clicking twice in the same place is a rosette rather than a no-op only from
    /// the second click outward.
    #[test]
    fn the_point_is_fixed() {
        let p = at(0.31, -0.42);
        let q = at(0.1, 0.1);
        assert_eq!(premap(&[p], p), p);
        assert_eq!(premap(&[q, p], p), premap(&[q], p));
    }

    /// Two-to-one about `p`: `p + d` and `p − d` land on the same point, which is the
    /// two-fold symmetry the picture shows.
    #[test]
    fn two_to_one_about_the_point() {
        let p = at(-0.2, 0.55);
        let d = at(0.03, -0.017);
        assert_eq!(premap(&[p], p + d), premap(&[p], p - d));
    }

    /// Content at `r` from `p` comes back at about `√r` from it — the rule the caller's
    /// width derivation rests on, checked rather than asserted in prose alone.
    #[test]
    fn a_radius_comes_back_as_its_square_root() {
        let p = at(0.0, 0.0);
        for r in [1e-2_f64, 1e-4, 1e-8] {
            let z = premap(&[p], at(r.sqrt(), 0.0));
            assert!(((z - p).norm() - r).abs() < r * 1e-12);
        }
    }

    /// The list is applied last-first, so the order of two clicks is not the order of
    /// the other two — an ordering bug that composed them the other way would still fix
    /// both points and still be two-to-one, and would draw a different picture.
    #[test]
    fn the_order_is_last_click_first() {
        let a = at(0.3, 0.1);
        let b = at(-0.4, 0.2);
        let z = at(0.11, -0.07);
        let by_hand = {
            let after_b = (z - b) * (z - b) + b;
            (after_b - a) * (after_b - a) + a
        };
        assert_eq!(premap(&[a, b], z), by_hand);
        assert_ne!(premap(&[a, b], z), premap(&[b, a], z));
    }
}
