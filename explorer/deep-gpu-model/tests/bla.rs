//! The skip table (`src/bla.rs`): that switching it off leaves the model as it was, that
//! passes stay bit-identical with it on, that its runs are the runs they claim at every
//! degree and plane, that its guards hold, and what it buys against what it costs in
//! agreement with `perturb`'s `f64` kernel.
//!
//! The agreement rulings compare the model with the switch on against the model with it
//! off, both against the `f64` kernel without a table: the bar is "no worse than `f32`
//! already is", not "nothing moves"; on frames ill-conditioned enough that this margin is
//! smaller than the frame's own noise, the skip is held instead to the ruling at the floor
//! that `tests/agreement.rs` holds the model to. The margins are stated at each test with the
//! measured numbers (64x36 unless said otherwise).

use deep_gpu_model::bla::{self, BlaOptions, GpuTable};
use deep_gpu_model::compare::{
    Agreement, FrameSpec, ModelField, agree, narrowed_reference, run_f64, run_model_bla,
};
use deep_gpu_model::model::{self, BlaStats, INTERIOR, RUNNING};
use deep_gpu_model::{Encoding, Frame, GpuOrbit};

const THREADS: usize = 8;

// ---- the switch off is the model as it was.

/// Frames covering both planes, both anchors, degrees two, five and six, a periodic
/// reference, a long scaled dive that escapes and rebases with the interior switch off,
/// and every row telling the two encodings apart; each
/// with the FNV-1a hash of every pixel's final [`model::PixelState::bits`] under each
/// encoding, taken from the model as committed in phase 1 (`48b29b60`) before the skip
/// existed.
const IDENTITY: [(&str, [u32; 2], bool, u64, u64); 7] = [
    (
        r#"{"id": "random-dives#501", "re": "0.64774731161734500930901700212431872380828355273804", "im": "0.51776563981107259688773400463987628082965300802274", "w": 8.662732633712781e-42, "n": 20000, "degree": 5}"#,
        [16, 9],
        true,
        0xd7776b72808d876a,
        0x1adcd1003f8e7cdd,
    ),
    (
        r#"{"id": "random-dives#5", "re": "-0.75765813056425443555", "im": "0.07282660995819819077", "w": 7.255822008177002e-09, "n": 38347, "degree": 2}"#,
        [24, 14],
        true,
        0xe43e1851bb8c5745,
        0xf682fb9a80e7b893,
    ),
    (
        r#"{"id": "deep-gallery#33", "re": "0", "im": "0", "w": 7.787286674045785e-08, "n": 34239, "degree": 2, "julia_re": "-0.74937053247003823168823992075369", "julia_im": "0.041472667068168900034718746387049", "anchor": "origin"}"#,
        [16, 9],
        true,
        0x8f730c9e0127bb31,
        0xa7d06a056fc6c1dd,
    ),
    (
        r#"{"id": "figure:math-misiurewicz-pairs#2", "re": "-0.1010963638456221610257854", "im": "0.9562865108091415007710961", "w": 0.0024101, "n": 16337, "degree": 2, "julia_re": "-0.1010963638456221610257854", "julia_im": "0.9562865108091415007710961", "anchor": "parameter"}"#,
        [16, 9],
        true,
        0x971f00f8ed392c7b,
        0x75bb52bfb572c421,
    ),
    (
        r#"{"id": "nucleus-3116-periodic", "re": "0.64774731161734500930901700212431871126941013022100244438793490777767414164458935", "im": "0.51776563981107259688773400463987632330403073150911819396055504521478466034303479", "w": 1.474220271796546e-40, "n": 20000, "degree": 5, "period": 3116}"#,
        [16, 9],
        true,
        0x1e798ba66d969dec,
        0xcd0ac69f4538da1c,
    ),
    // Interior off, escaping, rebasing (1,401 / 1,469 times over the frame) and scaled
    // through most of its steps. (`tangle-1e-28` at a cap of 40,000 stood here first and
    // hashed the same under both encodings: every pixel capped, never rebased, and ran
    // scaled from step 2, where HiLo's `lo` is below half an ulp of `hi`.)
    (
        r#"{"id": "random-dives#883", "re": "-0.855203701175822929932607772197457", "im": "-0.216193311420101972051552441179384", "w": 2.704353590502409e-24, "n": 631176, "degree": 2}"#,
        [16, 9],
        false,
        0xd91c0daaa9751e7f,
        0x19de3e69389df9d8,
    ),
    (
        r#"{"id": "dive-sheet:u0496", "re": "0.84705383614488507118", "im": "0.45497047478211847321", "w": 7.284373984668588e-07, "n": 30368, "degree": 6}"#,
        [16, 9],
        true,
        0x2116d7dc5a360b00,
        0x06475956eaf8afff,
    ),
];

fn fnv(hash: &mut u64, word: u32) {
    for byte in word.to_le_bytes() {
        *hash ^= byte as u64;
        *hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
}

/// With the switch off, every pixel ends in exactly the state the phase-1 model left it
/// in, every field of it; and the switch on with a table that offers no run (no level
/// stored) leaves exactly that state too, so the seam itself changes nothing.
#[test]
fn switched_off_the_model_is_the_phase_one_model_bit_for_bit() {
    for (row, res, interior, want_pair, want_hilo) in IDENTITY {
        let fs = FrameSpec::from_row(row).unwrap();
        let spec = fs.spec(res, None, interior);
        let orbit = spec.reference_orbit().unwrap();
        for (enc, want) in [(Encoding::F32Pair, want_pair), (Encoding::HiLo, want_hilo)] {
            let gpu = GpuOrbit::from_reference(&orbit, enc);
            let frame = Frame::from_spec(&spec, gpu.len()).unwrap();
            let empty = GpuTable::empty(orbit.periodic);
            let (mut off, mut seam) = (0xcbf2_9ce4_8422_2325u64, 0xcbf2_9ce4_8422_2325u64);
            for r in 0..res[1] {
                for c in 0..res[0] {
                    for w in model::run_pixel(&frame, &gpu, c, r, u32::MAX).bits() {
                        fnv(&mut off, w);
                    }
                    let (st, stats) = model::run_pixel_bla(&frame, &gpu, &empty, c, r, u32::MAX);
                    assert_eq!(stats, BlaStats::default());
                    for w in st.bits() {
                        fnv(&mut seam, w);
                    }
                }
            }
            assert_eq!(off, want, "{} {enc:?}: switch off", fs.id);
            assert_eq!(seam, want, "{} {enc:?}: empty table", fs.id);
        }
    }
}

// ---- passes.

/// Passes of 1, 3 or 1000 delta steps leave exactly the state and the counters one
/// unbounded pass does, with the skip on: a skip is one step and is never split. On
/// frames that skip, rebase, scale, prove interior through a run's product, wrap a
/// periodic reference, and run Julia planes at both anchors and degrees two to five.
#[test]
fn passes_with_the_skip_are_bit_identical_whatever_the_budget() {
    for (row, interior) in [
        (
            r#"{"id": "tangle-1e-28", "re": "-0.74501772829019861929877929889763684", "im": "0.14993443275689704583350282968726721", "w": 1e-28, "n": 40000, "degree": 2}"#,
            true,
        ),
        (
            r#"{"id": "random-dives#501", "re": "0.64774731161734500930901700212431872380828355273804", "im": "0.51776563981107259688773400463987628082965300802274", "w": 8.662732633712781e-42, "n": 20000, "degree": 5}"#,
            true,
        ),
        (
            r#"{"id": "nucleus-3116-periodic", "re": "0.64774731161734500930901700212431871126941013022100244438793490777767414164458935", "im": "0.51776563981107259688773400463987632330403073150911819396055504521478466034303479", "w": 1.474220271796546e-40, "n": 20000, "degree": 5, "period": 3116}"#,
            true,
        ),
        (
            r#"{"id": "deep-gallery#33", "re": "0", "im": "0", "w": 7.787286674045785e-08, "n": 34239, "degree": 2, "julia_re": "-0.74937053247003823168823992075369", "julia_im": "0.041472667068168900034718746387049", "anchor": "origin"}"#,
            true,
        ),
        (
            r#"{"id": "julia-deg3-origin-1e-30", "re": "0", "im": "0", "w": 1e-30, "n": 20000, "degree": 3, "julia_re": "-0.6352281642333808681320495886221720723227", "julia_im": "0.6451971639494320595845265674548798440034", "anchor": "origin"}"#,
            true,
        ),
        (
            r#"{"id": "cusp-1e5", "re": "0.2500000009869604401089358", "im": "0", "w": 4e-13, "n": 200000, "degree": 2}"#,
            false,
        ),
        (
            r#"{"id": "deep-gallery#20", "re": "0.731317921888244089723034008353", "im": "0.387113729318409700563659204364", "w": 6.67e-21, "n": 30000, "degree": 6, "julia_re": "0.731317921888244089723623346751", "julia_im": "0.387113729318409700562713089968", "anchor": "parameter"}"#,
            true,
        ),
    ] {
        let fs = FrameSpec::from_row(row).unwrap();
        let spec = fs.spec([16, 9], None, interior);
        let orbit = spec.reference_orbit().unwrap();
        let table_frame = Frame::from_spec(&spec, orbit.len()).unwrap();
        let table = GpuTable::build(&orbit, &table_frame, &BlaOptions::default());
        let mut skips = 0u64;
        for enc in [Encoding::F32Pair, Encoding::HiLo] {
            let gpu = GpuOrbit::from_reference(&orbit, enc);
            let frame = Frame::from_spec(&spec, gpu.len()).unwrap();
            for r in 0..9 {
                for c in 0..16 {
                    let (whole, whole_stats) =
                        model::run_pixel_bla(&frame, &gpu, &table, c, r, u32::MAX);
                    skips += whole_stats.bla_steps as u64;
                    for budget in [1u32, 3, 1000] {
                        let mut st = model::init(&frame, c, r);
                        let mut stats = BlaStats::default();
                        while st.status == RUNNING {
                            let took = model::pass_bla(
                                &mut st, &mut stats, &frame, &gpu, &table, c, r, budget,
                            );
                            assert!(took <= budget);
                        }
                        assert_eq!(
                            st.bits(),
                            whole.bits(),
                            "{} {enc:?} {c},{r} {budget}",
                            fs.id
                        );
                        assert_eq!(stats, whole_stats, "{} {enc:?} {c},{r} {budget}", fs.id);
                    }
                }
            }
        }
        assert!(
            skips > 0,
            "{}: nothing skipped, so this proves less than it says",
            fs.id
        );
    }
}

// ---- the table's own claims, in f64.

/// `δ' = (Z + δ)^D − Z^D + dc`, exactly as `perturb` expands it.
fn exact_step(z: [f64; 2], d: [f64; 2], dc: [f64; 2], degree: u32) -> [f64; 2] {
    let mul = |a: [f64; 2], b: [f64; 2]| [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]];
    // Σ_{k=1}^{D} C(D,k) Z^(D−k) δ^k, by Horner in δ.
    let deg = degree as usize;
    let mut binom = [1.0f64; 7];
    for k in 1..=deg {
        binom[k] = binom[k - 1] * (deg + 1 - k) as f64 / k as f64;
    }
    let mut zp = [[1.0, 0.0]; 7];
    for k in 1..=deg {
        zp[k] = mul(zp[k - 1], z);
    }
    let mut acc = [binom[deg], 0.0];
    for k in (1..deg).rev() {
        let t = mul(acc, d);
        acc = [
            t[0] + binom[k] * zp[deg - k][0],
            t[1] + binom[k] * zp[deg - k][1],
        ];
    }
    let t = mul(acc, d);
    [t[0] + dc[0], t[1] + dc[1]]
}

fn decode(m: [f32; 2], e: i32) -> [f64; 2] {
    let s = 2f64.powi(e);
    [m[0] as f64 * s, m[1] as f64 * s]
}

/// Every stored run, walked with the exact recurrence from a delta on its radius (a
/// millionth inside) and a `dc` at the frame's bound: at every index the run passes
/// through, `|δ|` stays within the single-step radius `ε|Z|/(D−1)` (to 1%), and the run's
/// `A·δ + B·dc` (decoded from the stored `f32` entry) lands within `4ε` of the exact delta,
/// relative. This is the check on the degree derivation in `src/bla.rs`, at runs of 1 to
/// 4096 steps on degrees two to six, both planes and a periodic reference, at
/// `ε = 2^-24` and `1e-4`. Measured: `|δ|` at most 1.0002 of the leaf radius (the
/// interior is the merge's first-order bound, so a delta on the radius may touch it), and
/// a landing error under 3ε.
#[test]
fn every_run_is_the_run_it_claims_at_every_degree() {
    for (row, res) in [
        (
            r#"{"id": "tangle-1e-28", "re": "-0.74501772829019861929877929889763684", "im": "0.14993443275689704583350282968726721", "w": 1e-28, "n": 40000, "degree": 2}"#,
            [64, 36],
        ),
        (
            r#"{"id": "misiurewicz#6", "re": "-0.6352281642333808681320495886221720723227", "im": "0.6451971639494320595845265674548798440034", "w": 5.2e-16, "n": 30000, "degree": 3}"#,
            [64, 36],
        ),
        (
            r#"{"id": "julia-deg4-origin-1e-40", "re": "0", "im": "0", "w": 1e-40, "n": 20000, "degree": 4, "julia_re": "0.3261226732769710318848390308533958858192", "julia_im": "1.1187243018613215064422951991895119177729", "anchor": "origin"}"#,
            [64, 36],
        ),
        (
            r#"{"id": "nucleus-3116-periodic", "re": "0.64774731161734500930901700212431871126941013022100244438793490777767414164458935", "im": "0.51776563981107259688773400463987632330403073150911819396055504521478466034303479", "w": 1.474220271796546e-40, "n": 20000, "degree": 5, "period": 3116}"#,
            [64, 36],
        ),
        (
            r#"{"id": "deep-gallery#30", "re": "0.6987676527736156598123592538", "im": "0.4167238248186412616333658473", "w": 1.92e-21, "n": 30000, "degree": 6}"#,
            [64, 36],
        ),
    ] {
        let fs = FrameSpec::from_row(row).unwrap();
        let spec = fs.spec(res, None, true);
        let orbit = spec.reference_orbit().unwrap();
        let frame = Frame::from_spec(&spec, orbit.len()).unwrap();
        let points = &orbit.points;
        let len = points.len();
        let degree = frame.degree;
        let julia = frame.julia != 0;
        for eps in [bla::EPSILON_DEFAULT, 1e-4] {
            let opts = BlaOptions {
                epsilon: eps,
                min_level: 0,
                max_level: 12,
            };
            let dcmax = if julia { 0.0 } else { bla::dc_bound(&frame) };
            let table = bla::build_with(points, orbit.periodic, degree, julia, dcmax, &opts);
            let dc = [dcmax * 0.6, -dcmax * 0.8 * 0.999];
            let mut walked = 0usize;
            let mut worst_radius = 0.0f64;
            let mut worst_landing = 0.0f64;
            for i in 0..table.header.levels as usize {
                let k = table.header.min_level as usize + i;
                let [offset, count, _, _] = table.header.level[i];
                // A spread of slots per level, not every one.
                let stride = (count as usize / 40).max(1);
                for slot in (0..count as usize).step_by(stride) {
                    let e = &table.entries[offset as usize + slot];
                    if e.r2_m == 0.0 {
                        continue;
                    }
                    let r = (e.r2_m as f64 * 2f64.powi(e.r2_e)).sqrt();
                    let s0 = (slot << k) + 1;
                    let l = 1usize << k;
                    assert!(s0 + l <= if orbit.periodic { len } else { len - 2 });
                    let on = r * (1.0 - 1e-6);
                    let mut d = [on * 0.6, on * 0.8];
                    let d0 = d;
                    for j in 0..l {
                        let idx = s0 + j;
                        if j > 0 {
                            let z = points[idx];
                            let leaf = eps * z[0].hypot(z[1]) / (degree as f64 - 1.0);
                            worst_radius = worst_radius.max(d[0].hypot(d[1]) / leaf);
                        }
                        d = exact_step(points[idx], d, if julia { [0.0, 0.0] } else { dc }, degree);
                    }
                    let a = decode(e.a, e.a_e);
                    let b = decode(e.b, e.b_e);
                    let ad = [a[0] * d0[0] - a[1] * d0[1], a[0] * d0[1] + a[1] * d0[0]];
                    let bdc = if julia {
                        [0.0, 0.0]
                    } else {
                        [b[0] * dc[0] - b[1] * dc[1], b[0] * dc[1] + b[1] * dc[0]]
                    };
                    let lin = [ad[0] + bdc[0], ad[1] + bdc[1]];
                    let err = (lin[0] - d[0]).hypot(lin[1] - d[1]) / d[0].hypot(d[1]);
                    worst_landing = worst_landing.max(err);
                    walked += 1;
                }
            }
            eprintln!(
                "{} eps {eps:e}: {walked} runs, |δ| up to {worst_radius:.5} of the leaf radius, landing error {worst_landing:e} ({:.2} ε)",
                fs.id,
                worst_landing / eps
            );
            assert!(
                walked > 50,
                "{} eps {eps}: only {walked} runs walked",
                fs.id
            );
            assert!(
                worst_radius <= 1.01,
                "{} eps {eps}: |δ| reached {worst_radius} of the leaf radius",
                fs.id
            );
            assert!(
                worst_landing <= 4.0 * eps,
                "{} eps {eps}: landing error {worst_landing:e}",
                fs.id
            );
        }
    }
}

/// No run reaches `len − 1` on a non-periodic reference, where the loop rebases, and none
/// passes the wrap on a periodic one. The cap is held at lookup: no run is offered whose
/// length reaches the iterations left.
#[test]
fn no_run_reaches_the_rebase_index_crosses_the_wrap_or_steps_over_the_cap() {
    for (row, periodic) in [
        (
            r#"{"id": "tangle-1e-28", "re": "-0.74501772829019861929877929889763684", "im": "0.14993443275689704583350282968726721", "w": 1e-28, "n": 40000, "degree": 2}"#,
            false,
        ),
        (
            r#"{"id": "nucleus-3116-periodic", "re": "0.64774731161734500930901700212431871126941013022100244438793490777767414164458935", "im": "0.51776563981107259688773400463987632330403073150911819396055504521478466034303479", "w": 1.474220271796546e-40, "n": 20000, "degree": 5, "period": 3116}"#,
            true,
        ),
    ] {
        let fs = FrameSpec::from_row(row).unwrap();
        let spec = fs.spec([64, 36], None, true);
        let orbit = spec.reference_orbit().unwrap();
        assert_eq!(orbit.periodic, periodic);
        let frame = Frame::from_spec(&spec, orbit.len()).unwrap();
        let opts = BlaOptions {
            min_level: 0,
            ..BlaOptions::default()
        };
        let table = GpuTable::build(&orbit, &frame, &opts);
        let len = orbit.len() as u32;
        let limit = if periodic { len } else { len - 2 };
        let mut offered = 0;
        for m in 1..len {
            let mut reads = 0;
            // A zero delta is inside every live radius: the longest run the table has.
            if let Some(hit) = bla::lookup(&table, m, [0.0, 0.0], 0, u32::MAX, None, &mut reads) {
                assert!(m + hit.length <= limit, "{}: {m} + {}", fs.id, hit.length);
                offered += 1;
                for left in [1u32, 2, 16, hit.length, hit.length + 1] {
                    let mut r = 0;
                    if let Some(h) = bla::lookup(&table, m, [0.0, 0.0], 0, left, None, &mut r) {
                        assert!(h.length < left, "{}: left {left} ran {}", fs.id, h.length);
                    }
                }
            }
        }
        assert!(offered > 100, "{}: {offered} runs offered", fs.id);
    }
}

// ---- what it buys, and what it costs in agreement.

struct Pair {
    off: Agreement,
    on: Agreement,
    /// The `f64` kernel on the reference rounded to `f32`, against itself unrounded.
    floor: Agreement,
    off_field: ModelField,
    on_field: ModelField,
}

fn mean(v: &[u32]) -> f64 {
    v.iter().map(|&x| x as f64).sum::<f64>() / v.len().max(1) as f64
}

fn both(row: &str, res: [u32; 2], cap: Option<u32>, interior: bool, enc: Encoding) -> Pair {
    let fs = FrameSpec::from_row(row).unwrap();
    let spec = fs.spec(res, cap, interior);
    let orbit = spec.reference_orbit().unwrap();
    let f64_field = run_f64(&spec, &orbit, THREADS);
    let gpu = GpuOrbit::from_reference(&orbit, enc);
    let frame = Frame::from_spec(&spec, gpu.len()).unwrap();
    let table = GpuTable::build(&orbit, &frame, &BlaOptions::default());
    let off_field = run_model_bla(&frame, &gpu, None, THREADS, u32::MAX);
    let on_field = run_model_bla(&frame, &gpu, Some(&table), THREADS, u32::MAX);
    let floor_field = run_f64(&spec, &narrowed_reference(&orbit), THREADS);
    Pair {
        off: agree(&f64_field.smooth, &off_field.smooth),
        on: agree(&f64_field.smooth, &on_field.smooth),
        floor: agree(&f64_field.smooth, &floor_field.smooth),
        off_field,
        on_field,
    }
}

/// With the skip on, agreement with `f64` is no worse than without it, to a margin: the
/// share of samples more than 0.1 apart rises by at most two points and class changes by
/// at most half a percent of the frame. Returns the ratio of delta steps, on to off.
fn no_worse(p: &Pair, id: &str) -> f64 {
    let n = p.off.samples as f64;
    assert!(
        p.on.over[1] <= p.off.over[1] + 0.02,
        "{id}: over 0.1 {:.4} with the skip, {:.4} without",
        p.on.over[1],
        p.off.over[1]
    );
    let changes = |a: &Agreement| (a.f64_only_escaped + a.model_only_escaped) as f64;
    assert!(
        changes(&p.on) <= changes(&p.off) + 0.005 * n,
        "{id}: {} class changes with the skip, {} without",
        changes(&p.on),
        changes(&p.off)
    );
    assert_eq!(p.on_field.nonfinite, 0, "{id}: a delta left f32");
    mean(&p.on_field.steps) / mean(&p.off_field.steps)
}

/// Deep frames and long-orbit frames, where the skip pays. Measured (f32pair, steps on /
/// off; over 0.1 off -> on; class changes off -> on):
///
/// - `tangle-1e-28`, cap 117,518: 0.18; 85.5% -> 75.8%; 288 -> 227.
/// - `random-dives#501`, 8.7e-42 at degree 5, cap 1.2e5: 0.15; 20.6% -> 14.2%; 0 -> 0.
/// - `nucleus-3116-periodic`, degree 5, the periodic table: 0.20; 44.0% -> 28.6%; 0 -> 0.
/// - `cusp-1e5`, the main cusp dialled to escape at 1e5 (`longorbit.md`'s construction,
///   `x = (π/T)²`), interior off: 0.19; 1.3% -> 1.3%; 0 -> 0.
/// - `julia-deg3-origin-1e-30`: 0.002 (the interior switch proves through the runs'
///   products); 0 -> 0; 0 -> 0.
///
/// Agreement improves on the deep frames: a skip replaces thousands of `f32` roundings
/// with a few.
#[test]
fn the_skip_cuts_delta_steps_where_it_pays_and_agreement_holds() {
    for (row, cap, interior, at_most) in [
        (
            r#"{"id": "tangle-1e-28", "re": "-0.74501772829019861929877929889763684", "im": "0.14993443275689704583350282968726721", "w": 1e-28, "n": 117518, "degree": 2}"#,
            None,
            true,
            0.3,
        ),
        (
            r#"{"id": "random-dives#501", "re": "0.64774731161734500930901700212431872380828355273804", "im": "0.51776563981107259688773400463987628082965300802274", "w": 8.662732633712781e-42, "n": 1471930, "degree": 5}"#,
            Some(120_000),
            true,
            0.3,
        ),
        (
            r#"{"id": "nucleus-3116-periodic", "re": "0.64774731161734500930901700212431871126941013022100244438793490777767414164458935", "im": "0.51776563981107259688773400463987632330403073150911819396055504521478466034303479", "w": 1.474220271796546e-40, "n": 164682, "degree": 5, "period": 3116}"#,
            None,
            true,
            0.3,
        ),
        (
            r#"{"id": "cusp-1e5", "re": "0.2500000009869604401089358", "im": "0", "w": 4e-13, "n": 200000, "degree": 2}"#,
            None,
            false,
            0.3,
        ),
        (
            r#"{"id": "julia-deg3-origin-1e-30", "re": "0", "im": "0", "w": 1e-30, "n": 20000, "degree": 3, "julia_re": "-0.6352281642333808681320495886221720723227", "julia_im": "0.6451971639494320595845265674548798440034", "anchor": "origin"}"#,
            None,
            true,
            0.05,
        ),
    ] {
        let id = FrameSpec::from_row(row).unwrap().id;
        let p = both(row, [64, 36], cap, interior, Encoding::F32Pair);
        let ratio = no_worse(&p, &id);
        assert!(ratio <= at_most, "{id}: steps on/off {ratio:.3}");
        assert!(mean(&p.on_field.bla_steps) > 0.0);
    }
}

/// The interior switch through a skip: the run's stored product covers its inner points
/// only, and the landing point's factor comes from the `z` the skip landed on. The landing
/// index is where the loop rebases, so there `|z|` can be far from `|Z|`; a product taken
/// over `Z` at the landing sent `|dz|²` tens of binary orders low and proved escaping
/// pixels interior. Measured on `pick:random:u0477` (64x36, interior on): skip off, 0 class
/// changes and 3 pixels proven interior; with the landing factor taken from `Z`, 23 escaped
/// samples became interior and 26 were proven; as built, 0 and 3.
#[test]
fn a_skip_never_proves_interior_off_the_reference_at_its_landing() {
    for row in [
        r#"{"id": "pick:random:u0477", "re": "-0.760193581526858262314241", "im": "-0.082826894862451533864984", "w": 1.5640307323437596e-16, "n": 1828723, "degree": 2}"#,
        r#"{"id": "random-dives#408", "re": "-0.778757682619491511357651882963", "im": "-0.13716677352613820011222020129", "w": 1.5669348835860706e-22, "n": 254560, "degree": 2}"#,
    ] {
        let id = FrameSpec::from_row(row).unwrap().id;
        let p = both(row, [64, 36], None, true, Encoding::F32Pair);
        let changes = |a: &Agreement| a.f64_only_escaped + a.model_only_escaped;
        let proven = |f: &ModelField| f.status.iter().filter(|&&s| s == INTERIOR).count();
        eprintln!(
            "{id}: class changes {} -> {}, proven {} -> {}",
            changes(&p.off),
            changes(&p.on),
            proven(&p.off_field),
            proven(&p.on_field)
        );
        assert!(mean(&p.on_field.bla_steps) > 0.0, "{id}: nothing skipped");
        assert!(changes(&p.on) <= changes(&p.off), "{id}: class changes");
        assert!(
            proven(&p.on_field) <= proven(&p.off_field),
            "{id}: proven interior"
        );
    }
}

/// Ill-conditioned frames, where "no worse than without the skip, plus two points" is a
/// margin smaller than the frame's own noise. On a 240-frame random slice of the corpus at
/// `ε = 2^-24`, seven frames rose by more than two points over 0.1 with the skip on, and
/// every one of them is a frame whose `f64` field moves 47% to 76% of its samples by more
/// than 0.1 when its reference is rounded to `f32` and nothing else changes. Tightening `ε`
/// does not remove them (at `2^-28` three still rise by more than two points, and a frame
/// can rise more at `2^-26` than at `2^-24`): any perturbation of an `f32` rounding's size
/// redraws such a frame. So here the skip is held to `tests/agreement.rs`'s ruling at the
/// floor, the same one the model without the skip is held to: over 0.1 at most twice the
/// floor's share plus two points, capped at the floor plus ten; class changes at most
/// twice the floor's plus half a percent of the frame, capped at the floor plus five.
///
/// Measured (F32Pair, over 0.1 off -> on, floor): `random-dives#93` (degree 4) 64.4% ->
/// 70.5%, 76.2%; `pick-twin:random:u0657` (degree 3 Julia) 49.2% -> 54.0%, 52.1%;
/// `random-dives#852` (degree 3) 67.4% -> 71.3%, 67.6%; `deep-gallery#54` (degree 4)
/// 45.1% -> 48.4%, 46.8%; `dive-sheet:u0204` (degree 5) 46.7% -> 49.6%, 51.6%;
/// `random-dives#245` (degree 6) 57.1% -> 59.2%, 56.4%; `random-dives#419` (degree 6)
/// 45.8% -> 47.8%, 48.8%. No class changes on any of them, skip on or off.
#[test]
fn on_ill_conditioned_frames_the_skip_is_held_to_the_floor() {
    for row in [
        r#"{"id": "random-dives#93", "re": "0.3401963374131201908032772", "im": "0.931428752131812504098056", "w": 4.53042517420129e-17, "n": 1925642, "degree": 4}"#,
        r#"{"id": "pick-twin:random:u0657", "re": "0.1578905328301647203724", "im": "0.813190790714036607497", "w": 1.5951640416918007e-13, "n": 1757160, "degree": 3, "julia_re": "0.1578905328301647203724", "julia_im": "0.813190790714036607497", "anchor": "parameter"}"#,
        r#"{"id": "random-dives#852", "re": "0.2094746123155323538335", "im": "0.9610561483244818948649", "w": 8.66856601146098e-14, "n": 1423643, "degree": 3}"#,
        r#"{"id": "deep-gallery#54", "re": "0.4463033950079647086497582", "im": "0.6588029179532988243798215", "w": 5.2944878815622146e-17, "n": 1984990, "degree": 4}"#,
        r#"{"id": "dive-sheet:u0204", "re": "0.6271489911360431878269774", "im": "0.5247181299818798315471091", "w": 4.5624620222915904e-17, "n": 1808511, "degree": 5}"#,
        r#"{"id": "random-dives#245", "re": "-0.06052054304226978802", "im": "0.8070159748603813782", "w": 6.147430293506785e-12, "n": 1495392, "degree": 6}"#,
        r#"{"id": "random-dives#419", "re": "0.806244025915146011507", "im": "0.240123876924361498148", "w": 1.1813653284456303e-13, "n": 1054260, "degree": 6}"#,
    ] {
        let id = FrameSpec::from_row(row).unwrap().id;
        for enc in [Encoding::F32Pair, Encoding::HiLo] {
            let p = both(row, [64, 36], None, true, enc);
            let (a, f) = (&p.on, &p.floor);
            eprintln!(
                "{id} {enc:?}: over 0.1 {:.4} -> {:.4}, floor {:.4}; steps {:.0} -> {:.0}",
                p.off.over[1],
                a.over[1],
                f.over[1],
                mean(&p.off_field.steps),
                mean(&p.on_field.steps)
            );
            assert!(mean(&p.on_field.bla_steps) > 0.0, "{id}: nothing skipped");
            assert!(
                a.over[1] <= (2.0 * f.over[1] + 0.02).min(f.over[1] + 0.10),
                "{id} {enc:?}: {:.4} over 0.1 against a floor of {:.4}",
                a.over[1],
                f.over[1]
            );
            let (changes, floor_changes) = (a.mismatch_share(), f.mismatch_share());
            assert!(
                changes <= (2.0 * floor_changes + 0.005).min(floor_changes + 0.05),
                "{id} {enc:?}: class changes {changes:.4} against a floor of {floor_changes:.4}"
            );
            assert_eq!(p.on_field.nonfinite, 0, "{id} {enc:?}: a delta left f32");
        }
    }
}

/// Shallow frames, where `ε = 2^-24` admits no run long enough to store (a merged radius
/// has to clear `|B|·dcmax`, and the frame term dwarfs `ε|Z|`): the skip buys little or
/// nothing and must cost nothing. Measured: steps on/off 1.00 at 3e-3, 4e-4 and the home
/// view, 0.98 at 7.3e-9; over 0.1 unchanged to within 0.3 points; no class changes.
#[test]
fn on_shallow_frames_the_skip_costs_nothing() {
    for row in [
        r#"{"id": "figure:math-misiurewicz-pairs#3", "re": "-0.1010963638456221610257854", "im": "0.9562865108091415007710961", "w": 0.003, "n": 15958, "degree": 2}"#,
        r#"{"id": "figure:deep-descent-rungs#1", "re": "-0.5", "im": "0", "w": 3.0, "n": 4000, "degree": 2}"#,
        r#"{"id": "random-dives#5", "re": "-0.75765813056425443555", "im": "0.07282660995819819077", "w": 7.255822008177002e-09, "n": 38347, "degree": 2}"#,
        r#"{"id": "dive-sheet:u0496", "re": "0.84705383614488507118", "im": "0.45497047478211847321", "w": 7.284373984668588e-07, "n": 30368, "degree": 6}"#,
    ] {
        let id = FrameSpec::from_row(row).unwrap().id;
        let p = both(row, [64, 36], None, true, Encoding::F32Pair);
        let ratio = no_worse(&p, &id);
        assert!(ratio <= 1.0, "{id}: the skip added steps ({ratio:.3})");
    }
}
