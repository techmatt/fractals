//! Two samples a vector: the band fill in wasm, on `f64x2` *(deep_wait_ckpt163)*.
//!
//! **Why.** The scalar step is one chain of dependent `f64` operations, add → multiply →
//! subtract → add, so one sample keeps a core's floating-point ports about a third
//! busy; the page's pool runs two workers a core to fill them, and is then bound by the
//! ports. Two samples in one vector are the same operations at half the instructions.
//!
//! **What stays exactly as it was.** Each lane is one sample, and every operation a lane
//! sees is the scalar loop's ([`Kernel::run`]), in the scalar loop's order: `f64x2` add,
//! subtract and multiply are IEEE per lane, wasm's SIMD has no fused multiply-add, and
//! nothing here reassociates. Lanes never read each other, so which two samples share a
//! vector — which depends on how a band was cut — cannot reach a bit; the parity harness
//! (`explorer/bench/perturb-parity.mjs`) holds that across whole bands, half bands and a
//! shuffled list.
//!
//! **Where the vector stops.** The run between events is vector: the step, the escape
//! test, the rebase test and, under the switch, the mantissa's slope and its upward
//! renormalisation, which is all a step does on almost every step. Anything else — an
//! escape, a rebase, a downward renormalisation, the gate, the cap, the wrap or end of
//! the reference — sends both lanes through [`settle`], which is the scalar loop's own
//! tail, test for test. The proof is the scalar [`Kernel::prove`], unchanged.
//!
//! **Only a SIMD build comes here** (`cfg(all(target_arch = "wasm32", target_feature =
//! "simd128"))`): `explorer/perturb.wasm` is built with `-C target-feature=+simd128` and
//! `explorer/perturb-scalar.wasm`, its fallback for an engine without wasm SIMD, without
//! it (`builder/explorer.py`, `build_perturb`). Native never does: the gallery and the GPU
//! model link this crate and draw with the scalar loop, as they always have.

use crate::kernel::{
    Handoff, Kernel, Outcome, TWO64, TWO64_INV, binomial, factor, gate_floor, interior_outcome,
    renormalise, smooth_count_at,
};
use crate::reference::BAILOUT;
use core::arch::wasm32::*;

/// One sample's state at a step boundary: everything the scalar loop carries.
#[derive(Clone, Copy)]
struct Lane {
    /// Where its outcome goes, in the caller's list.
    slot: usize,
    /// A copy of the other lane, stepped for company and never settled: what the
    /// last sample of a list runs beside.
    ghost: bool,
    dc: [f64; 2],
    offset_is_zero: bool,
    delta: [f64; 2],
    /// `Z[m]`.
    point: [f64; 2],
    m: usize,
    n: u32,
    rebases: u32,
    degenerate: bool,
    derivative: f64,
    exponent: i32,
    /// [`gate_floor`] at `exponent`.
    lo: f64,
}

/// `|f'(z)|²` at degree `D` on two lanes, spelled as the multiplies the scalar
/// `slope_sq`'s `powi` lowers to in the wasm build (read off its assembly): `x²`,
/// `x·x²`, `x²·x²`, `x·(x²·x²)`, then times `D²`. Multiplication commutes exactly, so
/// only the grouping is load-bearing, and the parity harness's gated d3–d6 frames hold
/// it.
#[inline(always)]
fn slope_v<const D: usize>(x: v128) -> v128 {
    let c = f64x2_splat((D * D) as f64);
    match D {
        2 => f64x2_mul(x, c),
        3 => f64x2_mul(f64x2_mul(x, x), c),
        4 => f64x2_mul(f64x2_mul(x, f64x2_mul(x, x)), c),
        5 => {
            let x2 = f64x2_mul(x, x);
            f64x2_mul(f64x2_mul(x2, x2), c)
        }
        _ => {
            let x2 = f64x2_mul(x, x);
            f64x2_mul(f64x2_mul(x, f64x2_mul(x2, x2)), c)
        }
    }
}

/// [`factor`] on two lanes: the same Horner form, the same order.
#[inline(always)]
fn factor_v<const D: usize>(zr: v128, zi: v128, dr: v128, di: v128) -> (v128, v128) {
    if D == 2 {
        return (
            f64x2_add(f64x2_add(zr, zr), dr),
            f64x2_add(f64x2_add(zi, zi), di),
        );
    }
    let b = const { binomial(D) };
    let mut pw = [[f64x2_splat(0.0); 2]; 6];
    pw[1] = [zr, zi];
    let mut j = 2;
    while j < D {
        let [a, c] = pw[j - 1];
        pw[j] = [
            f64x2_sub(f64x2_mul(a, zr), f64x2_mul(c, zi)),
            f64x2_add(f64x2_mul(a, zi), f64x2_mul(c, zr)),
        ];
        j += 1;
    }
    let mut pr = f64x2_add(dr, f64x2_mul(f64x2_splat(b[D - 1]), zr));
    let mut pi = f64x2_add(di, f64x2_mul(f64x2_splat(b[D - 1]), zi));
    let mut k = D - 2;
    while k >= 1 {
        let tr = f64x2_sub(f64x2_mul(pr, dr), f64x2_mul(pi, di));
        let ti = f64x2_add(f64x2_mul(pr, di), f64x2_mul(pi, dr));
        pr = f64x2_add(tr, f64x2_mul(f64x2_splat(b[k]), pw[D - k][0]));
        pi = f64x2_add(ti, f64x2_mul(f64x2_splat(b[k]), pw[D - k][1]));
        k -= 1;
    }
    (pr, pi)
}

/// What a lane's step came to after its post-step values: the scalar loop's tail.
///
/// `z`, `z_norm_sq` and `delta_norm_sq` are the step's, `slope_taken` the mantissa
/// times this step's slope (read only under the switch). The lane's `delta`, `point`,
/// `m` and `n` are already the step's. **Test for test [`Kernel::run`]'s body below its
/// load**: escape, the switch and its gate, the cap, the degenerate flag, the rebase.
#[allow(clippy::too_many_arguments)]
#[inline(never)]
fn settle<const D: usize, const JULIA: bool, const INTERIOR: bool>(
    kernel: &Kernel,
    lane: &mut Lane,
    z: [f64; 2],
    z_norm_sq: f64,
    delta_norm_sq: f64,
    slope_taken: f64,
) -> Option<Outcome> {
    let points = &kernel.reference.points[..];
    let periodic = kernel.reference.periodic;
    let last = points.len() - 1;
    if z_norm_sq > BAILOUT * BAILOUT {
        return Some(Outcome {
            smooth: smooth_count_at(lane.n, z_norm_sq, D as u32),
            iterations: lane.n,
            rebases: lane.rebases,
            detected_interior: false,
            degenerate: lane.degenerate,
            dz_mantissa: lane.derivative,
            dz_exponent: lane.exponent,
        });
    }
    if INTERIOR {
        let gated;
        (lane.derivative, lane.exponent, gated) =
            renormalise(slope_taken, lane.exponent, kernel.floor);
        if gated {
            return Some(kernel.prove::<D, JULIA>(Handoff {
                delta: lane.delta,
                z,
                z_norm_sq,
                m: lane.m,
                n: lane.n,
                rebases: lane.rebases,
                degenerate: lane.degenerate,
                derivative: lane.derivative,
                exponent: lane.exponent,
                dc: if JULIA { [0.0, 0.0] } else { lane.dc },
                offset_is_zero: lane.offset_is_zero,
            }));
        }
        lane.lo = gate_floor(lane.exponent, kernel.floor);
    }
    if lane.n >= kernel.maxiter {
        return Some(interior_outcome(
            lane.n,
            lane.rebases,
            false,
            lane.degenerate,
            lane.derivative,
            lane.exponent,
        ));
    }
    if delta_norm_sq == 0.0 && !lane.offset_is_zero {
        lane.degenerate = true;
    }
    if z_norm_sq < delta_norm_sq || (!periodic && lane.m >= last) {
        lane.delta = z;
        lane.point = points[0];
        lane.m = 0;
        lane.rebases += 1;
    }
    None
}

/// One whole step of one lane in scalar, wrap and all: [`Kernel::run`]'s body, for a
/// step the vector run cannot take because a lane is at its wrap, its cap or the
/// reference's end.
#[inline(never)]
fn step_exact<const D: usize, const JULIA: bool, const INTERIOR: bool>(
    kernel: &Kernel,
    lane: &mut Lane,
) -> Option<Outcome> {
    let points = &kernel.reference.points[..];
    let (ar, ai) = factor::<D>(lane.point[0], lane.point[1], lane.delta[0], lane.delta[1]);
    let mut next_re = ar * lane.delta[0] - ai * lane.delta[1];
    let mut next_im = ar * lane.delta[1] + ai * lane.delta[0];
    if !JULIA {
        next_re += lane.dc[0];
        next_im += lane.dc[1];
    }
    lane.delta = [next_re, next_im];
    lane.m += 1;
    lane.n += 1;
    if kernel.reference.periodic && lane.m >= points.len() {
        lane.m = 0;
    }
    lane.point = points[lane.m];
    let z_re = lane.point[0] + next_re;
    let z_im = lane.point[1] + next_im;
    let z_norm_sq = z_re * z_re + z_im * z_im;
    let delta_norm_sq = next_re * next_re + next_im * next_im;
    let slope_taken = if INTERIOR {
        f64x2_extract_lane::<0>(f64x2_mul(
            f64x2_splat(lane.derivative),
            slope_v::<D>(f64x2_splat(z_norm_sq)),
        ))
    } else {
        0.0
    };
    settle::<D, JULIA, INTERIOR>(
        kernel,
        lane,
        [z_re, z_im],
        z_norm_sq,
        delta_norm_sq,
        slope_taken,
    )
}

/// Every sample of `inputs`, two at a time, each outcome at its own index of `out`.
///
/// `inputs` is what [`Kernel::sample_with`] takes per sample: `dc`, or a Julia frame's
/// starting delta.
pub(crate) fn fill<const D: usize, const JULIA: bool, const INTERIOR: bool>(
    kernel: &Kernel,
    inputs: &[(f64, f64)],
    out: &mut [Outcome],
) {
    let count = inputs.len();
    if count == 0 {
        return;
    }
    let points = &kernel.reference.points[..];
    let periodic = kernel.reference.periodic;
    let maxiter = kernel.maxiter;
    let floor = kernel.floor;
    let last = points.len() - 1;
    let edge = if periodic {
        last
    } else {
        last.saturating_sub(1)
    };
    let start = if JULIA { kernel.entry.min(last) } else { 0 };

    let fresh = |slot: usize| -> Lane {
        let (a_re, a_im) = inputs[slot];
        Lane {
            slot,
            ghost: false,
            dc: [a_re, a_im],
            offset_is_zero: a_re == 0.0 && a_im == 0.0,
            delta: if JULIA { [a_re, a_im] } else { [0.0, 0.0] },
            point: points[start],
            m: start,
            n: 0,
            rebases: 0,
            degenerate: false,
            derivative: 1.0,
            exponent: 0,
            lo: gate_floor(0, floor),
        }
    };
    let ghost_of = |lane: &Lane| Lane {
        ghost: true,
        ..*lane
    };

    let mut lanes = [fresh(0), fresh(0)];
    let mut next = 1;
    if count > 1 {
        lanes[1] = fresh(1);
        next = 2;
    } else {
        lanes[1] = ghost_of(&lanes[0]);
    }

    let b2 = f64x2_splat(BAILOUT * BAILOUT);
    let zero = f64x2_splat(0.0);
    let one = f64x2_splat(1.0);
    let two64 = f64x2_splat(TWO64);
    let inv = f64x2_splat(TWO64_INV);
    let sixty_four = i64x2_splat(64);

    loop {
        let [a, b] = lanes;
        // The pair, packed.
        let mut dr = f64x2(a.delta[0], b.delta[0]);
        let mut di = f64x2(a.delta[1], b.delta[1]);
        let mut zr = f64x2(a.point[0], b.point[0]);
        let mut zi = f64x2(a.point[1], b.point[1]);
        let dcr = f64x2(a.dc[0], b.dc[0]);
        let dci = f64x2(a.dc[1], b.dc[1]);
        let mut der = f64x2(a.derivative, b.derivative);
        let mut lo = f64x2(a.lo, b.lo);
        let mut exp = i64x2(a.exponent as i64, b.exponent as i64);
        let mut deg = zero;

        // Steps every lane can take with no wrap, no cap and no end of reference.
        let room = |l: &Lane| {
            edge.saturating_sub(l.m)
                .min(maxiter.saturating_sub(l.n + 1) as usize)
        };
        let run = room(&a).min(room(&b));
        let pa = &points[a.m + 1..a.m + 1 + run];
        let pb = &points[b.m + 1..b.m + 1 + run];
        let mut steps = 0usize;
        // The step that stopped the run, uncommitted: (delta, point, z, |z|², |δ|², slope).
        let mut event: Option<[v128; 9]> = None;
        for (p, q) in pa.iter().zip(pb) {
            let (ar, ai) = factor_v::<D>(zr, zi, dr, di);
            let mut nr = f64x2_sub(f64x2_mul(ar, dr), f64x2_mul(ai, di));
            let mut ni = f64x2_add(f64x2_mul(ar, di), f64x2_mul(ai, dr));
            if !JULIA {
                nr = f64x2_add(nr, dcr);
                ni = f64x2_add(ni, dci);
            }
            // SAFETY: `p` and `q` are `[f64; 2]`, sixteen readable bytes each.
            let pv = unsafe { v128_load(p.as_ptr() as *const v128) };
            let qv = unsafe { v128_load(q.as_ptr() as *const v128) };
            let pzr = i64x2_shuffle::<0, 2>(pv, qv);
            let pzi = i64x2_shuffle::<1, 3>(pv, qv);
            let z_re = f64x2_add(pzr, nr);
            let z_im = f64x2_add(pzi, ni);
            let zn = f64x2_add(f64x2_mul(z_re, z_re), f64x2_mul(z_im, z_im));
            let dn = f64x2_add(f64x2_mul(nr, nr), f64x2_mul(ni, ni));
            let mut ev = v128_or(f64x2_gt(zn, b2), f64x2_lt(zn, dn));
            let mut taken = zero;
            let mut der2 = der;
            let mut lo2 = lo;
            let mut up = zero;
            if INTERIOR {
                taken = f64x2_mul(der, slope_v::<D>(zn));
                up = f64x2_ge(taken, two64);
                der2 = v128_bitselect(f64x2_mul(taken, inv), taken, up);
                lo2 = v128_bitselect(f64x2_pmax(f64x2_mul(lo, inv), one), lo, up);
                // Below `lo` is a downward renormalisation or the gate, and `NaN` is
                // neither above nor below: all three are the exact path's.
                ev = v128_or(ev, v128_not(f64x2_ge(der2, lo2)));
            }
            if v128_any_true(ev) {
                event = Some([nr, ni, pzr, pzi, z_re, z_im, zn, dn, taken]);
                break;
            }
            dr = nr;
            di = ni;
            zr = pzr;
            zi = pzi;
            deg = v128_or(deg, f64x2_eq(dn, zero));
            if INTERIOR {
                der = der2;
                lo = lo2;
                exp = i64x2_add(exp, v128_and(up, sixty_four));
            }
            steps += 1;
        }

        // Unpack what the run committed.
        let deg_bits = u64x2_bitmask(deg);
        for (i, lane) in lanes.iter_mut().enumerate() {
            let pick = |v: v128| {
                if i == 0 {
                    f64x2_extract_lane::<0>(v)
                } else {
                    f64x2_extract_lane::<1>(v)
                }
            };
            lane.delta = [pick(dr), pick(di)];
            lane.point = [pick(zr), pick(zi)];
            lane.m += steps;
            lane.n += steps as u32;
            if (deg_bits >> i) & 1 != 0 && !lane.offset_is_zero {
                lane.degenerate = true;
            }
            if INTERIOR {
                lane.derivative = pick(der);
                lane.lo = pick(lo);
                lane.exponent = if i == 0 {
                    i64x2_extract_lane::<0>(exp) as i32
                } else {
                    i64x2_extract_lane::<1>(exp) as i32
                };
            }
        }

        // The step the run could not take: an event inside it, or the edge after it.
        let mut done = [None, None];
        match event {
            Some([nr, ni, pzr, pzi, z_re, z_im, zn, dn, taken]) => {
                for (i, lane) in lanes.iter_mut().enumerate() {
                    if lane.ghost {
                        continue;
                    }
                    let pick = |v: v128| {
                        if i == 0 {
                            f64x2_extract_lane::<0>(v)
                        } else {
                            f64x2_extract_lane::<1>(v)
                        }
                    };
                    lane.delta = [pick(nr), pick(ni)];
                    lane.point = [pick(pzr), pick(pzi)];
                    lane.m += 1;
                    lane.n += 1;
                    done[i] = settle::<D, JULIA, INTERIOR>(
                        kernel,
                        lane,
                        [pick(z_re), pick(z_im)],
                        pick(zn),
                        pick(dn),
                        pick(taken),
                    );
                }
            }
            None => {
                for (i, lane) in lanes.iter_mut().enumerate() {
                    if !lane.ghost {
                        done[i] = step_exact::<D, JULIA, INTERIOR>(kernel, lane);
                    }
                }
            }
        }

        // Hand finished lanes their outcome and the next sample; a ghost follows its twin.
        for i in 0..2 {
            if let Some(outcome) = done[i] {
                out[lanes[i].slot] = outcome;
                if next < count {
                    lanes[i] = fresh(next);
                    next += 1;
                } else if !lanes[1 - i].ghost && done[1 - i].is_none() {
                    lanes[i] = ghost_of(&lanes[1 - i]);
                } else {
                    lanes[i].ghost = true;
                }
            }
        }
        if lanes[0].ghost && lanes[1].ghost {
            // Both were ghosts or finished with nothing left to take: unless one of them
            // was refilled above, the list is done.
            break;
        }
        for i in 0..2 {
            if lanes[i].ghost && !lanes[1 - i].ghost {
                lanes[i] = ghost_of(&lanes[1 - i]);
            }
        }
    }
}
