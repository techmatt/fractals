//! The interior proof inside a deep minibrot, where the reference orbit's own returns are
//! too small for `f32` (README, *Deep interior*).
//!
//! The D frames are a degree-3 nucleus of period 311 framed at `1e-60`, `1e-80` and
//! `1e-100`. The reference passes within `2^-268` (and `2^-322` deeper) of zero at every
//! return, narrowing stores those points as zero, and a frame-wide `2^-125` flush margin
//! closed no disc there: every sample ran to the cap where `perturb` proves it in 622
//! steps. The margin is now measured off the narrowing ([`GpuOrbit::flush`]), and a stored
//! zero is read in the delta's units so that the iterate the proof is handed keeps `δ`
//! ([`deep_gpu_model::model`]'s `reads_scaled`). These hold the closure, the bound the
//! measured margin claims, the anchor the proof is handed, and a frame at the minibrot's
//! edge where samples escape beside a flushed orbit.

use deep_gpu_model::bla::{BlaOptions, EPSILON_DS_DEFAULT, GpuTable};
use deep_gpu_model::compare::FrameSpec;
use deep_gpu_model::model::{self, ESCAPED, INTERIOR, RUNNING};
use deep_gpu_model::model_ds;
use deep_gpu_model::orbit::{FLUSH, flush_bound};
use deep_gpu_model::proof::{CARRYING, OFF};
use deep_gpu_model::{Encoding, Frame, FrameLo, GpuOrbit};
use perturb::kernel::Kernel;
use perturb::reference::Reference;

const NUCLEUS_RE: &str = "0.1910258774893687636653877341274335024092451852712527787373444953080999108165070735350743200670512192979234202411";
const NUCLEUS_IM: &str = "0.7697886011067241138026380754819675260484313308802967905631746244826988315742777985064207673891411360184969591657";

fn row(id: &str, w: &str, n: u32) -> String {
    format!(
        r#"{{"id": "{id}", "re": "{NUCLEUS_RE}", "im": "{NUCLEUS_IM}", "w": {w}, "n": {n}, "degree": 3}}"#
    )
}

/// The three D frames, each with the flush the narrowing measures on it: the largest
/// flushed component is `2^-268.1` at `1e-60` and `2^-321.7` deeper, so `2^-267` and
/// `2^-320` once the pair's `√2` is room.
const D: [(&str, &str, i32); 3] = [
    ("D-1e-60", "1e-60", 267),
    ("D-1e-80", "1e-80", 320),
    ("D-1e-100", "1e-100", 320),
];

struct Setup {
    orbit: Reference,
    pair: GpuOrbit,
    hilo: GpuOrbit,
    frame: Frame,
    lo: FrameLo,
    spec: perturb::Spec,
}

fn setup(row: &str, res: [u32; 2], cap: u32) -> Setup {
    let spec = FrameSpec::from_row(row).unwrap().spec(res, Some(cap), true);
    let orbit = spec.reference_orbit().unwrap();
    let pair = GpuOrbit::from_reference(&orbit, Encoding::F32Pair);
    let hilo = GpuOrbit::from_reference(&orbit, Encoding::HiLo);
    let frame = Frame::from_spec(&spec, hilo.len()).unwrap();
    let lo = FrameLo::from_spec(&spec, &frame).unwrap();
    Setup {
        orbit,
        pair,
        hilo,
        frame,
        lo,
        spec,
    }
}

/// `perturb`'s verdict on every sample, row-major: the status in the model's codes, and
/// the count.
fn reference_field(s: &Setup) -> Vec<(u32, u32)> {
    let spec = &s.spec;
    let kernel = Kernel::new(&s.orbit, spec.maxiter(), spec.interior).at_entry(spec.entry());
    let offset = spec.centre_offset().unwrap_or((0.0, 0.0));
    let julia = spec.julia.is_some();
    let mut out = Vec::new();
    for row in 0..spec.sample_height() {
        for col in 0..spec.sample_width() {
            let (a, b) = spec.dc(offset, col, row);
            let o = kernel.sample_at(spec.degree, julia, a, b);
            let status = if o.smooth.is_finite() {
                ESCAPED
            } else if o.detected_interior {
                INTERIOR
            } else {
                model::CAPPED
            };
            out.push((status, o.iterations));
        }
    }
    out
}

/// Every sample of the frame in the three kernels the GPU runs: `f32` on `F32Pair`,
/// double-single on `HiLo`, and double-single with the skip table. Row-major
/// `(status, n)`, one vector per kernel.
fn model_fields(s: &Setup) -> [Vec<(u32, u32)>; 3] {
    let table = GpuTable::build(
        &s.orbit,
        &s.frame,
        &BlaOptions {
            epsilon: EPSILON_DS_DEFAULT,
            ..Default::default()
        },
    );
    let mut out: [Vec<(u32, u32)>; 3] = Default::default();
    for row in 0..s.frame.height_px {
        for col in 0..s.frame.width_px {
            let a = model::run_pixel(&s.frame, &s.pair, col, row, u32::MAX);
            let b = model_ds::run_pixel_ds(&s.frame, &s.lo, &s.hilo, col, row, u32::MAX);
            let (c, _) =
                model_ds::run_pixel_ds_bla(&s.frame, &s.lo, &s.hilo, &table, col, row, u32::MAX);
            out[0].push((a.status, a.n));
            out[1].push((b.status, b.n));
            out[2].push((c.status, c.n));
        }
    }
    out
}

const KERNELS: [&str; 3] = ["f32", "ds", "ds+bla"];

/// The flush the narrowing reports is the one the D frames measure, never below the bound
/// any flush satisfies, and absent where nothing flushed.
#[test]
fn the_flush_bound_is_measured() {
    assert_eq!(flush_bound(-127), FLUSH, "a component just under 2^-126");
    assert_eq!(flush_bound(-100), FLUSH, "never looser than any flush");
    assert_eq!(flush_bound(-269), 267);
    assert_eq!(flush_bound(-322), 320);
    assert_eq!(flush_bound(-1023), 1021, "an f64 subnormal");
    for (id, w, flush) in D {
        let s = setup(&row(id, w, 5000), [2, 1], 5000);
        assert_eq!(s.pair.flush, flush, "{id} f32pair");
        assert_eq!(s.hilo.flush, flush, "{id} hilo");
    }
    // `dive-sheet:u0772`, the same minibrot at `4.1e-22` from a centre off the nucleus:
    // its reference never comes within `9.4e-15` of zero, and nothing flushes.
    let u0772 = r#"{"id": "dive-sheet:u0772", "re": "0.19102587748936876366538773412", "im": "0.76978860110672411380263807548", "w": 4.079101949823663e-22, "n": 91166, "degree": 3}"#;
    let s = setup(u0772, [2, 1], 5000);
    assert_eq!(s.pair.flush, OFF);
    assert_eq!(s.hilo.flush, OFF);
}

/// The two encodings narrow differently, so each measures its own flush, and a bundle
/// carries both (`src/bin/export.rs`'s `flush` and `flush_hilo`). The nucleus to 48
/// places at `1e-44` comes within `1.3e-31` of zero: the pair keeps that point, normal,
/// and `HiLo`'s `lo` under it is below `2^-126`. Read with the pair's `OFF`, the
/// double-single proof would carry no flush term where its orbit flushed.
#[test]
fn each_encoding_measures_its_own_flush() {
    let r = format!(
        r#"{{"id": "t48", "re": "{}", "im": "{}", "w": 1e-44, "n": 5000, "degree": 3}}"#,
        &NUCLEUS_RE[..48],
        &NUCLEUS_IM[..48]
    );
    let s = setup(&r, [2, 1], 5000);
    assert_eq!(s.pair.flush, OFF, "f32pair keeps every point");
    assert_eq!(s.hilo.flush, 127, "hilo flushes a lo");
}

/// The careful step's unit at a stored zero is `δ`'s, never `2^-127`. On the Julia plane
/// of the D nucleus at `1e-80` the reference starts at a stored zero (and returns to
/// `2^-322` every period); read as `2^-127`, `t^2` underflowed and a step from `2^-267`
/// returned exactly `0` for a true `≈ 2^-802`, a defect no Julia term covers once the
/// flush is measured. Every step at a stored zero from a nonzero `δ` leaves it nonzero
/// (and cubed, to within a bit), in both kernels, and the sample is still interior, down
/// to where the cube leaves the state's exponent range: a step whose result is below
/// `2^-100000` (`model.rs`'s `NO_EXPONENT`) is zero by design, an absolute defect far
/// under the `2^-flush` the proof adds at every containment test.
#[test]
fn a_stored_zero_is_no_size_in_the_careful_step() {
    const CUBE_FLOOR: f32 = -33_000.0;
    let r = format!(
        r#"{{"id": "Jorig-1e-80", "re": "0", "im": "0", "w": 1e-80, "n": 5000, "degree": 3, "julia_re": "{NUCLEUS_RE}", "julia_im": "{NUCLEUS_IM}", "anchor": "origin"}}"#
    );
    let s = setup(&r, [8, 5], 5000);
    assert_eq!(s.pair.flush, 320);
    let size = |m: f32, e: i32| {
        if m == 0.0 {
            None
        } else {
            Some(m.log2() + e as f32)
        }
    };
    let (col, row) = (1, 1);
    let mut checked = 0;
    let mut st = model::init(&s.frame, col, row);
    while st.status == RUNNING {
        let p = s.pair.points[st.m as usize];
        let before = size(st.d[0].abs().max(st.d[1].abs()), st.s);
        model::pass(&mut st, &s.frame, &s.pair, col, row, 1);
        if let (true, Some(b)) = (
            p[0] == 0.0 && p[1] == 0.0,
            before.filter(|b| *b > CUBE_FLOOR),
        ) {
            let a = size(st.d[0].abs().max(st.d[1].abs()), st.s);
            let a = a.unwrap_or_else(|| panic!("f32: 2^{b} -> 0 at a stored zero, n {}", st.n));
            assert!((a - 3.0 * b).abs() < 2.0, "f32: 2^{b} -> 2^{a}");
            checked += 1;
        }
    }
    assert_eq!(st.status, INTERIOR, "f32");
    assert!(checked >= 2, "f32 met {checked} stored zeros");
    let mut checked = 0;
    let mut sd = model_ds::init_ds(&s.frame, &s.lo, col, row);
    while sd.status == RUNNING {
        let p = s.hilo.points[sd.m as usize];
        let before = size(sd.d_hi[0].abs().max(sd.d_hi[1].abs()), sd.s);
        model_ds::pass_ds(&mut sd, &s.frame, &s.lo, &s.hilo, col, row, 1);
        if let (true, Some(b)) = (
            p[0] == 0.0 && p[1] == 0.0,
            before.filter(|b| *b > CUBE_FLOOR),
        ) {
            let a = size(sd.d_hi[0].abs().max(sd.d_hi[1].abs()), sd.s);
            let a = a.unwrap_or_else(|| panic!("ds: 2^{b} -> 0 at a stored zero, n {}", sd.n));
            assert!((a - 3.0 * b).abs() < 2.0, "ds: 2^{b} -> 2^{a}");
            checked += 1;
        }
    }
    assert_eq!(sd.status, INTERIOR, "ds");
    assert!(checked >= 2, "ds met {checked} stored zeros");
}

/// What the measured flush claims, point by point: every stored point is within
/// `u_Z·|Z| + 2^-flush` of `perturb`'s, with `u_Z` the proof's (`2^-23` for the `f32`
/// pair, whose `hi` may be an ulp off; `2^-47` for `hi + lo`). The relative part is the
/// rounding; the absolute part is what a flush left, which the proof's point margin, step
/// defect and rebase jump carry.
#[test]
fn every_stored_point_is_within_the_flush_bound() {
    for (id, w, _) in D {
        let s = setup(&row(id, w, 5000), [2, 1], 5000);
        let mut flushed = 0;
        for (orbit, uz) in [(&s.pair, 2f64.powi(-23)), (&s.hilo, 2f64.powi(-47))] {
            let term = 2f64.powi(-orbit.flush);
            for (m, (z, p)) in s.orbit.points.iter().zip(&orbit.points).enumerate() {
                let stored = match orbit.encoding {
                    Encoding::F32Pair => [p[0] as f64, p[1] as f64],
                    Encoding::HiLo => [p[0] as f64 + p[2] as f64, p[1] as f64 + p[3] as f64],
                };
                let err = (z[0] - stored[0]).hypot(z[1] - stored[1]);
                let size = z[0].hypot(z[1]);
                assert!(
                    err <= uz * size + term,
                    "{id} {:?} Z[{m}]: off by {err:e}, |Z| {size:e}, flush 2^-{}",
                    orbit.encoding,
                    orbit.flush
                );
                if size != 0.0 && stored == [0.0, 0.0] {
                    flushed += 1;
                }
            }
        }
        assert!(flushed > 0, "{id}: nothing flushed, so this tested nothing");
    }
}

/// The closure: every sample of each D frame is proved interior, in every kernel, at
/// `perturb`'s own count (622: anchored at the first return, 311, and closed at the
/// second). Before the flush was measured every one ran to the cap.
#[test]
fn a_deep_minibrot_interior_closes() {
    for (id, w, _) in D {
        let s = setup(&row(id, w, 5000), [8, 5], 5000);
        let reference = reference_field(&s);
        let fields = model_fields(&s);
        for (k, field) in fields.iter().enumerate() {
            for (i, (&(status, n), &(rs, rn))) in field.iter().zip(&reference).enumerate() {
                assert_eq!(rs, INTERIOR, "{id} sample {i}: perturb says {rs}");
                assert_eq!(
                    status, INTERIOR,
                    "{id} {} sample {i}: {status} at {n}",
                    KERNELS[k]
                );
                assert_eq!(n, rn, "{id} {} sample {i}", KERNELS[k]);
            }
        }
    }
}

/// The anchor the proof is handed is the iterate: wherever a disc is anchored, its centre
/// (`hi · 2^e` of the reconstructed `z`) is within `2^-20·|w| + 2^-flush` of
/// `w = Z[m] + δ` read in `f64` off the state. At `1e-80` and deeper the anchors fall on a
/// stored zero with `s` below `-187`, where forming `z` unscaled underflowed `δ` and the
/// centre came out `0` against a `|w|` of `2^-219`: a disc about the wrong point, which
/// the measured flush term no longer covers.
#[test]
fn the_proof_anchors_on_the_iterate() {
    for (id, w, _) in D {
        let s = setup(&row(id, w, 5000), [3, 3], 5000);
        let term = 2f64.powi(-s.hilo.flush);
        let check =
            |kernel: &str, n: u32, m: u32, d: [f64; 2], p: &deep_gpu_model::proof::Proof| {
                let z = s.orbit.points[m as usize];
                let w = [z[0] + d[0], z[1] + d[1]];
                let c = [
                    p.center[0] as f64 * 2f64.powi(p.center_e),
                    p.center[1] as f64 * 2f64.powi(p.center_e),
                ];
                let size = w[0].hypot(w[1]);
                let off = (c[0] - w[0]).hypot(c[1] - w[1]);
                assert!(
                    off <= 2f64.powi(-20) * size + term,
                    "{id} {kernel} anchor at {n}: centre {c:?} against w {w:?}"
                );
            };
        let mut anchors = [0u32; 2];
        for col in 0..3 {
            for row_i in 0..3 {
                let mut st = model::init(&s.frame, col, row_i);
                let mut seen = u32::MAX;
                while st.status == RUNNING {
                    model::pass(&mut st, &s.frame, &s.pair, col, row_i, 1);
                    let p = st.proof;
                    if p.phase == CARRYING && p.anchored == st.n && p.anchored != seen {
                        seen = p.anchored;
                        let k = 2f64.powi(st.s);
                        let d = [st.d[0] as f64 * k, st.d[1] as f64 * k];
                        check("f32", st.n, st.m, d, &p);
                        anchors[0] += 1;
                    }
                }
                assert_eq!(st.status, INTERIOR, "{id} f32 {col},{row_i}");
                let mut st = model_ds::init_ds(&s.frame, &s.lo, col, row_i);
                let mut seen = u32::MAX;
                while st.status == RUNNING {
                    model_ds::pass_ds(&mut st, &s.frame, &s.lo, &s.hilo, col, row_i, 1);
                    let p = st.proof;
                    if p.phase == CARRYING && p.anchored == st.n && p.anchored != seen {
                        seen = p.anchored;
                        let k = 2f64.powi(st.s);
                        let d = [
                            (st.d_hi[0] as f64 + st.d_lo[0] as f64) * k,
                            (st.d_hi[1] as f64 + st.d_lo[1] as f64) * k,
                        ];
                        check("ds", st.n, st.m, d, &p);
                        anchors[1] += 1;
                    }
                }
                assert_eq!(st.status, INTERIOR, "{id} ds {col},{row_i}");
            }
        }
        assert!(
            anchors[0] >= 9 && anchors[1] >= 9,
            "{id}: anchors {anchors:?}"
        );
    }
}

/// Soundness at the edge: the same nucleus framed at `3e-23`, where the minibrot's
/// boundary crosses the frame and samples escape beside an orbit that flushes (`2^-139`).
/// No kernel calls a sample interior that `perturb` sees escape, and every status is
/// `perturb`'s.
#[test]
fn the_minibrot_edge_is_not_interior_where_it_escapes() {
    let s = setup(&row("D-edge-3e-23", "3e-23", 50_000), [48, 27], 50_000);
    assert_eq!(s.hilo.flush, 139);
    let reference = reference_field(&s);
    let escaped = reference.iter().filter(|r| r.0 == ESCAPED).count();
    assert!(
        escaped >= 10,
        "only {escaped} escapes: the frame tests nothing"
    );
    let fields = model_fields(&s);
    for (k, field) in fields.iter().enumerate() {
        for (i, (&(status, _), &(rs, _))) in field.iter().zip(&reference).enumerate() {
            assert!(
                !(status == INTERIOR && rs == ESCAPED),
                "{} sample {i}: interior where perturb escapes",
                KERNELS[k]
            );
            assert_eq!(status, rs, "{} sample {i}", KERNELS[k]);
        }
    }
}
