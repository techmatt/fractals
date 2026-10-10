//! The interior switch never paints an escaping sample black
//! *(interior_switch_fix_ckpt162)*.
//!
//! `gpu_model_stage1_ckpt162` found two long-orbit frames where the shipped switch
//! called escaping samples interior: the degree-2 main cusp and an imploded Julia set.
//! Both sit beside a parabolic point, where an orbit creeps up on a fixed point with
//! `|f'| = 1` and `|dz|²` decays like a power of `n` rather than geometrically, so the
//! old `|dz|² < 2^-64` rule fired a long way before the escape. These are those two
//! frames built the same way at a gate of a million steps rather than ten million
//! (`scratch/gpu-model/longorbit.jsonl` has the originals), and the cusp again at every
//! degree the kernel draws.
//!
//! Each holds three things on a row of samples down the frame's middle: that the
//! switch-off loop escapes every one of them, that `|dz|²` is under the gate half way
//! through the gate's passage — so the old rule would have stopped them there — and that
//! the switch on lands on exactly the count the switch off does.

use perturb::Spec;
use perturb::kernel::{INTERIOR_EXPONENT, Kernel};

/// Every sample of a row across the middle of a frame, at a cap, three ways: switch
/// off, switch on, and switch on with the cap half way through the gate.
///
/// `passage` is `T`, how many steps the gate takes to pass: `π/√x` at `x` past the
/// cusp. It is the last `T` steps of a sample's orbit, or all of it where the escape
/// comes sooner.
fn holds(name: &str, frame: &str, passage: u32, cap: u32) {
    let spec = Spec::parse(&format!(
        r#"{{"schema":1,{frame},"resolution":[5,1],"maxiter":{cap}}}"#
    ))
    .unwrap();
    let orbit = spec.reference_orbit().unwrap();
    let offset = spec.centre_offset().unwrap();
    let julia = spec.julia.is_some();
    let kernel =
        |cap: u32, interior: bool| Kernel::new(&orbit, cap, interior).at_entry(spec.entry());
    let (on, off) = (kernel(cap, true), kernel(cap, false));
    for col in 0..5 {
        let (re, im) = spec.dc(offset, col, 0);
        let b = off.sample_at(spec.degree, julia, re, im);
        assert!(
            !b.smooth.is_nan(),
            "{name} sample {col}: the plain loop did not escape"
        );
        // Half way through the passage the product is at about its smallest, and
        // under the gate: the rule this replaced stopped every one of these samples
        // by there.
        let midway = b.iterations - (b.iterations / 2).min(passage / 2);
        let half = kernel(midway, true).sample_at(spec.degree, julia, re, im);
        assert!(
            half.dz_log2() < INTERIOR_EXPONENT as f64,
            "{name} sample {col}: log2|dz|^2 is {} half way, so the gate never fired",
            half.dz_log2()
        );
        let a = on.sample_at(spec.degree, julia, re, im);
        assert!(
            !a.smooth.is_nan(),
            "{name} sample {col}: painted interior at {}, and the plain loop escapes at {}",
            a.iterations,
            b.smooth
        );
        assert_eq!(
            a.smooth.to_bits(),
            b.smooth.to_bits(),
            "{name} sample {col}"
        );
        assert_eq!(a.iterations, b.iterations, "{name} sample {col}");
    }
}

/// The main cusp, `c = 1/4 + (π/T)²` with `T` a million: the exterior there is a
/// channel along the real axis, and every sample of the row is in it.
#[test]
fn the_main_cusp_is_not_interior() {
    holds(
        "cusp d2",
        r#""center_re":"0.25000000000986960440108935861883","center_im":"0","width":9.3e-17"#,
        1_000_000,
        2_000_000,
    );
}

/// The Julia set of that same `c`, at the origin: the cauliflower's basin has
/// imploded, and every point of it passes the gate once and escapes. Twice the
/// passage, because a Julia sample starts part of the way up the approach and its
/// `|dz|²` has that much less of it to fall over; the row is the middle of the basin,
/// where it falls furthest.
#[test]
fn the_imploded_julia_set_is_not_interior() {
    holds(
        "implosion d2",
        r#""center_re":"0","center_im":"0","width":0.5,"julia_re":"0.25000000000246740110027233965471","julia_im":"0","anchor":"origin""#,
        2_000_000,
        3_000_000,
    );
}

/// The main body's cusp at degrees three to six, `c* = z* − z*^d` with
/// `z* = d^{−1/(d−1)}`, the same distance past it.
#[test]
fn the_main_cusp_is_not_interior_at_any_degree() {
    for (degree, centre) in [
        (3, "0.38490017946962011407385521228681"),
        (4, "0.47247039372044704118879333634817"),
        (5, "0.53499224399100722360367581722575"),
        (6, "0.58235593231951897542857027759502"),
    ] {
        holds(
            &format!("cusp d{degree}"),
            &format!(r#""center_re":"{centre}","center_im":"0","width":9.3e-17,"degree":{degree}"#),
            1_000_000,
            2_000_000,
        );
    }
}
