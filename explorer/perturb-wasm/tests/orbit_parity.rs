//! **Every byte of the reference orbit, pinned.**
//!
//! The reference orbit is the one thing this crate computes in fixed point, and
//! every picture downstream of it is drawn against its `f64` projection. A change
//! to `fx.rs` or `reference.rs` that is meant to be faster is a change that must
//! not move a single bit of that projection — and the pins that would otherwise
//! catch it are a smooth value, a picture or a link, all downstream and all
//! approximate. So this hashes the packed buffer [`perturb::pack_reference`]
//! writes, which is byte for byte what `reference_orbit` hands the page, over a
//! spread of specs: every degree, both Julia anchors, widths from 1e-10 to 1e-112
//! (three limbs to the sixteen-limb clamp), nucleus references with a period, and
//! a few long orbits. The table below was taken from the arithmetic as it stood
//! before `fx.rs` was rewritten for speed, and holds every later version to it.
//!
//! ```text
//! cargo test --release --test orbit_parity
//! cargo test --release --test orbit_parity -- --ignored --nocapture   # reprint the table
//! ```

use perturb::{Spec, pack_reference};

/// The view the page draws at, so that the limb count is the page's.
const RESOLUTION: [u32; 2] = [1076, 576];

/// Widths from three limbs up to eight at the view's own rule, and to the clamp at
/// the Julia origin anchor.
const WIDTHS: [&str; 8] = [
    "1e-10", "1e-20", "1e-30", "1e-45", "1e-60", "1e-80", "1e-100", "1e-112",
];

/// Points with something in their orbits: a nucleus, a chaotic real point, a
/// parabolic neck, a Misiurewicz-like tip, and the committed degree frames' own
/// centres. Short ones are lengthened by digits below, which moves them a little
/// and deterministically.
fn bases(degree: u32) -> &'static [(&'static str, &'static str)] {
    match degree {
        2 => &[
            (
                "-0.74501772828532335842941892835857434",
                "0.14993443275456819177805709088257971",
            ),
            ("-1.9", "0.0"),
            ("-0.75", "0.1"),
            ("-0.1011", "0.9563"),
            ("0.2", "0.0"),
        ],
        3 => &[
            (
                "-0.3406250238987602341718262542321568083579609375",
                "1.2712298518725010680403152454016209423447578125",
            ),
            ("0.1", "0.2"),
            ("-0.5", "0.3"),
            ("0.0", "0.7"),
        ],
        _ => &[
            ("0.1", "0.2"),
            ("-0.5", "0.3"),
            ("0.3", "0.4"),
            ("-0.6", "0.2"),
        ],
    }
}

/// A 64-bit LCG, written out rather than depended on.
struct Lcg(u64);

impl Lcg {
    fn next(&mut self) -> u64 {
        self.0 = self
            .0
            .wrapping_mul(6364136223846793005)
            .wrapping_add(1442695040888963407);
        self.0
    }

    /// `count` decimal digits.
    fn digits(&mut self, count: usize) -> String {
        (0..count)
            .map(|_| (b'0' + ((self.next() >> 33) % 10) as u8) as char)
            .collect()
    }
}

/// A base point with `digits` more decimal places appended to each half.
fn lengthen(base: &str, digits: &str) -> String {
    if base.contains('.') {
        format!("{base}{digits}")
    } else {
        format!("{base}.{digits}")
    }
}

/// Every spec the table pins, as `(label, json)`, in a fixed order.
fn specs() -> Vec<(String, String)> {
    let mut out = Vec::new();
    let mut lcg = Lcg(0x5eed_0f0b_17c0_ffee);
    let json = |re: &str, im: &str, width: &str, maxiter: u32, degree: u32, extra: &str| {
        format!(
            "{{\"schema\":1,\"center_re\":\"{re}\",\"center_im\":\"{im}\",\"width\":{width},\
             \"resolution\":[{},{}],\"maxiter\":{maxiter},\"degree\":{degree}{extra}}}",
            RESOLUTION[0], RESOLUTION[1]
        )
    };

    for degree in 2..=6u32 {
        for (b, &(base_re, base_im)) in bases(degree).iter().enumerate() {
            for width in WIDTHS {
                let re = lengthen(base_re, &lcg.digits(140));
                let im = lengthen(base_im, &lcg.digits(140));
                // Mandelbrot at the view's own limb count.
                out.push((
                    format!("m d{degree} b{b} w{width}"),
                    json(&re, &im, width, 3000, degree, ""),
                ));
                // Julia, both anchors: the parameter's critical orbit, at the
                // view's limbs and at `step^d`'s, and one step longer at `c`.
                for anchor in ["parameter", "origin"] {
                    let extra = format!(
                        ",\"julia_re\":\"{re}\",\"julia_im\":\"{im}\",\"anchor\":\"{anchor}\""
                    );
                    out.push((
                        format!("j-{anchor} d{degree} b{b} w{width}"),
                        json("0", "0", width, 1500, degree, &extra),
                    ));
                }
            }
            // A named period on every base: the stored orbit is one period long
            // and the residual is in the header.
            let re = lengthen(base_re, &lcg.digits(80));
            let im = lengthen(base_im, &lcg.digits(80));
            let extra =
                format!(",\"reference_re\":\"{re}\",\"reference_im\":\"{im}\",\"period\":777");
            out.push((
                format!("p777 d{degree} b{b}"),
                json(&re, &im, "1e-45", 5000, degree, &extra),
            ));
        }
    }

    // The audit's period-2838 nucleus, as a periodic reference at three depths.
    let (anchor_re, anchor_im) = bases(2)[0];
    for width in ["1e-12", "1e-30", "1e-60"] {
        let extra = format!(
            ",\"reference_re\":\"{anchor_re}\",\"reference_im\":\"{anchor_im}\",\"period\":2838"
        );
        out.push((
            format!("p2838 w{width}"),
            json(anchor_re, anchor_im, width, 100_000, 2, &extra),
        ));
    }

    // A few long orbits, which is where a carry that is wrong once in a million
    // products would show.
    for (degree, b, width, maxiter) in [
        (2, 0, "1e-40", 120_000),
        (2, 1, "1e-112", 60_000),
        (3, 0, "1e-54", 60_000),
        (5, 1, "1e-100", 40_000),
        (6, 3, "1e-30", 40_000),
    ] {
        let (base_re, base_im) = bases(degree)[b];
        let re = lengthen(base_re, &lcg.digits(130));
        let im = lengthen(base_im, &lcg.digits(130));
        out.push((
            format!("long d{degree} b{b} w{width}"),
            json(&re, &im, width, maxiter, degree, ""),
        ));
    }
    out
}

/// FNV-1a, 64 bits.
fn fnv(bytes: &[u8]) -> u64 {
    let mut hash = 0xcbf2_9ce4_8422_2325u64;
    for &byte in bytes {
        hash ^= byte as u64;
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    hash
}

/// `(limbs, points, hash)` for one spec.
fn measure(json: &str) -> (usize, usize, u64) {
    let spec = Spec::parse(json).unwrap_or_else(|error| panic!("{json}: {error}"));
    let orbit = spec.reference_orbit().unwrap();
    (orbit.limbs, orbit.len(), fnv(&pack_reference(&orbit)))
}

#[test]
fn every_reference_orbit_is_byte_for_byte_the_pinned_one() {
    let specs = specs();
    assert_eq!(
        specs.len(),
        PINNED.len(),
        "the spec list and the table disagree"
    );
    let mut wrong = Vec::new();
    let mut limb_counts = std::collections::BTreeSet::new();
    for ((label, json), &(pinned_label, pinned)) in specs.iter().zip(PINNED) {
        assert_eq!(label, pinned_label);
        let (limbs, _, hash) = measure(json);
        limb_counts.insert(limbs);
        if hash != pinned {
            wrong.push(format!("{label}: {hash:016x}, pinned {pinned:016x}"));
        }
    }
    assert!(
        wrong.is_empty(),
        "{} orbits moved:\n{}",
        wrong.len(),
        wrong.join("\n")
    );
    // The spread is the point of the table: three limbs to the clamp.
    assert_eq!(limb_counts.first(), Some(&3));
    assert_eq!(limb_counts.last(), Some(&16));
}

/// Reprints the table. Run it only against arithmetic already known to be right.
#[test]
#[ignore]
fn print_the_table() {
    for (label, json) in specs() {
        let (limbs, points, hash) = measure(&json);
        println!("    // {limbs} limbs, {points} points");
        println!("    (\"{label}\", 0x{hash:016x}),");
    }
}

/// The four shapes the Deep tab spends its orbit time on, natively, one thread:
/// interior views, so that the orbit runs the whole cap.
/// `explorer/bench/orbit-parity.mjs --time` is the same four in wasm.
#[test]
#[ignore]
fn time_the_reference_orbit() {
    let (re, im) = bases(2)[0];
    let mut lcg = Lcg(7);
    let (inner_re, inner_im) = (
        lengthen("0.1", &lcg.digits(120)),
        lengthen("0.2", &lcg.digits(120)),
    );
    let view = |re: &str, im: &str, width: &str, maxiter: u32, degree: u32| {
        format!(
            "{{\"schema\":1,\"center_re\":\"{re}\",\"center_im\":\"{im}\",\"width\":{width},\
             \"resolution\":[1076,576],\"maxiter\":{maxiter},\"degree\":{degree}}}"
        )
    };
    for (label, json) in [
        ("d2 8 limbs cap 900k", view(re, im, "1e-100", 900_000, 2)),
        (
            "d3 8 limbs cap 444k",
            view(&inner_re, &inner_im, "1e-100", 444_000, 3),
        ),
        (
            "d5 8 limbs cap 450k",
            view(&inner_re, &inner_im, "1e-100", 450_000, 5),
        ),
        ("d2 6 limbs cap 245k", view(re, im, "1e-60", 245_000, 2)),
    ] {
        let spec = Spec::parse(&json).unwrap();
        let mut best = f64::INFINITY;
        let mut shape = (0, 0, 0);
        for _ in 0..3 {
            let start = std::time::Instant::now();
            let orbit = spec.reference_orbit().unwrap();
            best = best.min(start.elapsed().as_secs_f64() * 1e3);
            shape = (orbit.limbs, orbit.len(), fnv(&pack_reference(&orbit)));
        }
        println!(
            "{label:22} {} limbs {:7} points {best:7.1} ms  {:016x}",
            shape.0, shape.1, shape.2
        );
    }
}

#[rustfmt::skip]
const PINNED: &[(&str, u64)] = &[
    // 3 limbs, 3001 points
    ("m d2 b0 w1e-10", 0x2de744d904e5d0fc),
    // 3 limbs, 1502 points
    ("j-parameter d2 b0 w1e-10", 0xdfcc4ecd4f305095),
    // 4 limbs, 1501 points
    ("j-origin d2 b0 w1e-10", 0x4b68c5ec28bef13b),
    // 4 limbs, 3001 points
    ("m d2 b0 w1e-20", 0x0fb67cc93bbe6762),
    // 4 limbs, 1502 points
    ("j-parameter d2 b0 w1e-20", 0xdfcc4ecd4f305095),
    // 5 limbs, 1501 points
    ("j-origin d2 b0 w1e-20", 0x4b68c5ec28bef13b),
    // 4 limbs, 3001 points
    ("m d2 b0 w1e-30", 0xfbef2c406f817c4c),
    // 4 limbs, 1502 points
    ("j-parameter d2 b0 w1e-30", 0xdfcc4ecd4f305095),
    // 6 limbs, 1501 points
    ("j-origin d2 b0 w1e-30", 0x4b68c5ec28bef13b),
    // 5 limbs, 3001 points
    ("m d2 b0 w1e-45", 0x3bcb3b2a386d3773),
    // 5 limbs, 1502 points
    ("j-parameter d2 b0 w1e-45", 0xdfcc4ecd4f305095),
    // 7 limbs, 1501 points
    ("j-origin d2 b0 w1e-45", 0x4b68c5ec28bef13b),
    // 6 limbs, 3001 points
    ("m d2 b0 w1e-60", 0x13ecf4f71acd3367),
    // 6 limbs, 1502 points
    ("j-parameter d2 b0 w1e-60", 0xdfcc4ecd4f305095),
    // 9 limbs, 1501 points
    ("j-origin d2 b0 w1e-60", 0x4b68c5ec28bef13b),
    // 7 limbs, 3001 points
    ("m d2 b0 w1e-80", 0x5b7d5acc2320322c),
    // 7 limbs, 1502 points
    ("j-parameter d2 b0 w1e-80", 0xdfcc4ecd4f305095),
    // 11 limbs, 1501 points
    ("j-origin d2 b0 w1e-80", 0x4b68c5ec28bef13b),
    // 8 limbs, 3001 points
    ("m d2 b0 w1e-100", 0x4c7c3c7e09efcabb),
    // 8 limbs, 1502 points
    ("j-parameter d2 b0 w1e-100", 0xdfcc4ecd4f305095),
    // 13 limbs, 1501 points
    ("j-origin d2 b0 w1e-100", 0x4b68c5ec28bef13b),
    // 8 limbs, 3001 points
    ("m d2 b0 w1e-112", 0x5352efc1b4470cd6),
    // 8 limbs, 1502 points
    ("j-parameter d2 b0 w1e-112", 0xdfcc4ecd4f305095),
    // 14 limbs, 1501 points
    ("j-origin d2 b0 w1e-112", 0x4b68c5ec28bef13b),
    // 5 limbs, 777 points
    ("p777 d2 b0", 0xeb0a93f79bfae143),
    // 3 limbs, 9 points
    ("m d2 b1 w1e-10", 0xd2a8d1b6d8bfb030),
    // 3 limbs, 9 points
    ("j-parameter d2 b1 w1e-10", 0xd2a8d1b6d8bfb030),
    // 4 limbs, 9 points
    ("j-origin d2 b1 w1e-10", 0xd2a8d1b6d8bfb030),
    // 4 limbs, 12 points
    ("m d2 b1 w1e-20", 0xb8c3817e1d6dba73),
    // 4 limbs, 12 points
    ("j-parameter d2 b1 w1e-20", 0xb8c3817e1d6dba73),
    // 5 limbs, 12 points
    ("j-origin d2 b1 w1e-20", 0xb8c3817e1d6dba73),
    // 4 limbs, 9 points
    ("m d2 b1 w1e-30", 0x0907c4ac5f327a15),
    // 4 limbs, 9 points
    ("j-parameter d2 b1 w1e-30", 0x0907c4ac5f327a15),
    // 6 limbs, 9 points
    ("j-origin d2 b1 w1e-30", 0x0907c4ac5f327a15),
    // 5 limbs, 9 points
    ("m d2 b1 w1e-45", 0x8b23a48c770012ee),
    // 5 limbs, 9 points
    ("j-parameter d2 b1 w1e-45", 0x8b23a48c770012ee),
    // 7 limbs, 9 points
    ("j-origin d2 b1 w1e-45", 0x8b23a48c770012ee),
    // 6 limbs, 10 points
    ("m d2 b1 w1e-60", 0x29a7279641fd1287),
    // 6 limbs, 10 points
    ("j-parameter d2 b1 w1e-60", 0x29a7279641fd1287),
    // 9 limbs, 10 points
    ("j-origin d2 b1 w1e-60", 0x29a7279641fd1287),
    // 7 limbs, 12 points
    ("m d2 b1 w1e-80", 0x6fcbcf8092687e03),
    // 7 limbs, 12 points
    ("j-parameter d2 b1 w1e-80", 0x6fcbcf8092687e03),
    // 11 limbs, 12 points
    ("j-origin d2 b1 w1e-80", 0x6fcbcf8092687e03),
    // 8 limbs, 11 points
    ("m d2 b1 w1e-100", 0x043917c011507828),
    // 8 limbs, 11 points
    ("j-parameter d2 b1 w1e-100", 0x043917c011507828),
    // 13 limbs, 11 points
    ("j-origin d2 b1 w1e-100", 0x043917c011507828),
    // 8 limbs, 9 points
    ("m d2 b1 w1e-112", 0x5ca0b2004688afc8),
    // 8 limbs, 9 points
    ("j-parameter d2 b1 w1e-112", 0x5ca0b2004688afc8),
    // 14 limbs, 9 points
    ("j-origin d2 b1 w1e-112", 0x5ca0b2004688afc8),
    // 5 limbs, 9 points
    ("p777 d2 b1", 0xa23c46850a7a795d),
    // 3 limbs, 21 points
    ("m d2 b2 w1e-10", 0x8ce03d3304b08bc1),
    // 3 limbs, 21 points
    ("j-parameter d2 b2 w1e-10", 0x8ce03d3304b08bc1),
    // 4 limbs, 21 points
    ("j-origin d2 b2 w1e-10", 0x8ce03d3304b08bc1),
    // 4 limbs, 33 points
    ("m d2 b2 w1e-20", 0x573f72d674be6f8b),
    // 4 limbs, 33 points
    ("j-parameter d2 b2 w1e-20", 0x573f72d674be6f8b),
    // 5 limbs, 33 points
    ("j-origin d2 b2 w1e-20", 0x573f72d674be6f8b),
    // 4 limbs, 28 points
    ("m d2 b2 w1e-30", 0xbf88bf49bd162f92),
    // 4 limbs, 28 points
    ("j-parameter d2 b2 w1e-30", 0xbf88bf49bd162f92),
    // 6 limbs, 28 points
    ("j-origin d2 b2 w1e-30", 0xbf88bf49bd162f92),
    // 5 limbs, 23 points
    ("m d2 b2 w1e-45", 0xeac59645cd575415),
    // 5 limbs, 23 points
    ("j-parameter d2 b2 w1e-45", 0xeac59645cd575415),
    // 7 limbs, 23 points
    ("j-origin d2 b2 w1e-45", 0xeac59645cd575415),
    // 6 limbs, 30 points
    ("m d2 b2 w1e-60", 0x2a6a51a9e3a094f8),
    // 6 limbs, 30 points
    ("j-parameter d2 b2 w1e-60", 0x2a6a51a9e3a094f8),
    // 9 limbs, 30 points
    ("j-origin d2 b2 w1e-60", 0x2a6a51a9e3a094f8),
    // 7 limbs, 22 points
    ("m d2 b2 w1e-80", 0x427d006bca251f41),
    // 7 limbs, 22 points
    ("j-parameter d2 b2 w1e-80", 0x427d006bca251f41),
    // 11 limbs, 22 points
    ("j-origin d2 b2 w1e-80", 0x427d006bca251f41),
    // 8 limbs, 22 points
    ("m d2 b2 w1e-100", 0x6f3f9b124c3debef),
    // 8 limbs, 22 points
    ("j-parameter d2 b2 w1e-100", 0x6f3f9b124c3debef),
    // 13 limbs, 22 points
    ("j-origin d2 b2 w1e-100", 0x6f3f9b124c3debef),
    // 8 limbs, 29 points
    ("m d2 b2 w1e-112", 0xfeb3851ba76d5c96),
    // 8 limbs, 29 points
    ("j-parameter d2 b2 w1e-112", 0xfeb3851ba76d5c96),
    // 14 limbs, 29 points
    ("j-origin d2 b2 w1e-112", 0xfeb3851ba76d5c96),
    // 5 limbs, 22 points
    ("p777 d2 b2", 0x21c0372be82c467e),
    // 3 limbs, 40 points
    ("m d2 b3 w1e-10", 0x2ba124b5020fb12b),
    // 3 limbs, 40 points
    ("j-parameter d2 b3 w1e-10", 0x2ba124b5020fb12b),
    // 4 limbs, 40 points
    ("j-origin d2 b3 w1e-10", 0x2ba124b5020fb12b),
    // 4 limbs, 42 points
    ("m d2 b3 w1e-20", 0xbb99d48cbac53bc9),
    // 4 limbs, 42 points
    ("j-parameter d2 b3 w1e-20", 0xbb99d48cbac53bc9),
    // 5 limbs, 42 points
    ("j-origin d2 b3 w1e-20", 0xbb99d48cbac53bc9),
    // 4 limbs, 43 points
    ("m d2 b3 w1e-30", 0x4b3c6313b2112390),
    // 4 limbs, 43 points
    ("j-parameter d2 b3 w1e-30", 0x4b3c6313b2112390),
    // 6 limbs, 43 points
    ("j-origin d2 b3 w1e-30", 0x4b3c6313b2112390),
    // 5 limbs, 40 points
    ("m d2 b3 w1e-45", 0x1411c4cbc12b053b),
    // 5 limbs, 40 points
    ("j-parameter d2 b3 w1e-45", 0x1411c4cbc12b053b),
    // 7 limbs, 40 points
    ("j-origin d2 b3 w1e-45", 0x1411c4cbc12b053b),
    // 6 limbs, 48 points
    ("m d2 b3 w1e-60", 0xb313e5c68c63bf1d),
    // 6 limbs, 48 points
    ("j-parameter d2 b3 w1e-60", 0xb313e5c68c63bf1d),
    // 9 limbs, 48 points
    ("j-origin d2 b3 w1e-60", 0xb313e5c68c63bf1d),
    // 7 limbs, 38 points
    ("m d2 b3 w1e-80", 0xe52055a3885f0ff2),
    // 7 limbs, 38 points
    ("j-parameter d2 b3 w1e-80", 0xe52055a3885f0ff2),
    // 11 limbs, 38 points
    ("j-origin d2 b3 w1e-80", 0xe52055a3885f0ff2),
    // 8 limbs, 36 points
    ("m d2 b3 w1e-100", 0x30a2f9228269d93e),
    // 8 limbs, 36 points
    ("j-parameter d2 b3 w1e-100", 0x30a2f9228269d93e),
    // 13 limbs, 36 points
    ("j-origin d2 b3 w1e-100", 0x30a2f9228269d93e),
    // 8 limbs, 48 points
    ("m d2 b3 w1e-112", 0x28fc9ba0567098b4),
    // 8 limbs, 48 points
    ("j-parameter d2 b3 w1e-112", 0x28fc9ba0567098b4),
    // 14 limbs, 48 points
    ("j-origin d2 b3 w1e-112", 0x28fc9ba0567098b4),
    // 5 limbs, 37 points
    ("p777 d2 b3", 0x96c6b3e3833a3fd9),
    // 3 limbs, 3001 points
    ("m d2 b4 w1e-10", 0x9e9280d632129c8a),
    // 3 limbs, 1502 points
    ("j-parameter d2 b4 w1e-10", 0x4c466cf8a27ece7b),
    // 4 limbs, 1501 points
    ("j-origin d2 b4 w1e-10", 0xf70f7184c2013a34),
    // 4 limbs, 3001 points
    ("m d2 b4 w1e-20", 0x6f1fe5d2b6804c88),
    // 4 limbs, 1502 points
    ("j-parameter d2 b4 w1e-20", 0x1e563e16ec14feaa),
    // 5 limbs, 1501 points
    ("j-origin d2 b4 w1e-20", 0x8bdb80748f061a8a),
    // 4 limbs, 3001 points
    ("m d2 b4 w1e-30", 0x3978be94be4de6d9),
    // 4 limbs, 1502 points
    ("j-parameter d2 b4 w1e-30", 0x162c6bb7aef92cc4),
    // 6 limbs, 1501 points
    ("j-origin d2 b4 w1e-30", 0x678beb47a85052ef),
    // 5 limbs, 3001 points
    ("m d2 b4 w1e-45", 0xf1fa4090452c6c9c),
    // 5 limbs, 1502 points
    ("j-parameter d2 b4 w1e-45", 0xaa95078e22601543),
    // 7 limbs, 1501 points
    ("j-origin d2 b4 w1e-45", 0x8ce2639319d96f86),
    // 6 limbs, 19 points
    ("m d2 b4 w1e-60", 0xb54b7cc44bd839e7),
    // 6 limbs, 19 points
    ("j-parameter d2 b4 w1e-60", 0xb54b7cc44bd839e7),
    // 9 limbs, 19 points
    ("j-origin d2 b4 w1e-60", 0xb54b7cc44bd839e7),
    // 7 limbs, 3001 points
    ("m d2 b4 w1e-80", 0x9c374cfb7e88832e),
    // 7 limbs, 1502 points
    ("j-parameter d2 b4 w1e-80", 0x54b24eba3b372f66),
    // 11 limbs, 1501 points
    ("j-origin d2 b4 w1e-80", 0x9aff9c3ef9436f18),
    // 8 limbs, 3001 points
    ("m d2 b4 w1e-100", 0x847b5922fc10b42f),
    // 8 limbs, 1502 points
    ("j-parameter d2 b4 w1e-100", 0x827984eea47d4e85),
    // 13 limbs, 1501 points
    ("j-origin d2 b4 w1e-100", 0x042c31d8c8833a51),
    // 8 limbs, 3001 points
    ("m d2 b4 w1e-112", 0x6b4d8c6fd1919224),
    // 8 limbs, 1502 points
    ("j-parameter d2 b4 w1e-112", 0xba8f804fe5b2724c),
    // 14 limbs, 1501 points
    ("j-origin d2 b4 w1e-112", 0x2571c4dd746a6c8e),
    // 5 limbs, 777 points
    ("p777 d2 b4", 0xcbfd74f5b6fd8fa4),
    // 3 limbs, 3001 points
    ("m d3 b0 w1e-10", 0x80d8bb036fb2184c),
    // 3 limbs, 1502 points
    ("j-parameter d3 b0 w1e-10", 0xf21efe91847f00d0),
    // 5 limbs, 1501 points
    ("j-origin d3 b0 w1e-10", 0x5ed4304264140b37),
    // 4 limbs, 3001 points
    ("m d3 b0 w1e-20", 0x80d8bb036fb2184c),
    // 4 limbs, 1502 points
    ("j-parameter d3 b0 w1e-20", 0xf21efe91847f00d0),
    // 6 limbs, 1501 points
    ("j-origin d3 b0 w1e-20", 0x5ed4304264140b37),
    // 4 limbs, 3001 points
    ("m d3 b0 w1e-30", 0x80d8bb036fb2184c),
    // 4 limbs, 1502 points
    ("j-parameter d3 b0 w1e-30", 0xf21efe91847f00d0),
    // 8 limbs, 1501 points
    ("j-origin d3 b0 w1e-30", 0x5ed4304264140b37),
    // 5 limbs, 3001 points
    ("m d3 b0 w1e-45", 0x80d8bb036fb2184c),
    // 5 limbs, 1502 points
    ("j-parameter d3 b0 w1e-45", 0xf21efe91847f00d0),
    // 10 limbs, 1501 points
    ("j-origin d3 b0 w1e-45", 0x5ed4304264140b37),
    // 6 limbs, 3001 points
    ("m d3 b0 w1e-60", 0x80d8bb036fb2184c),
    // 6 limbs, 1502 points
    ("j-parameter d3 b0 w1e-60", 0xf21efe91847f00d0),
    // 12 limbs, 1501 points
    ("j-origin d3 b0 w1e-60", 0x5ed4304264140b37),
    // 7 limbs, 3001 points
    ("m d3 b0 w1e-80", 0x80d8bb036fb2184c),
    // 7 limbs, 1502 points
    ("j-parameter d3 b0 w1e-80", 0xf21efe91847f00d0),
    // 15 limbs, 1501 points
    ("j-origin d3 b0 w1e-80", 0x5ed4304264140b37),
    // 8 limbs, 3001 points
    ("m d3 b0 w1e-100", 0x80d8bb036fb2184c),
    // 8 limbs, 1502 points
    ("j-parameter d3 b0 w1e-100", 0xf21efe91847f00d0),
    // 16 limbs, 1501 points
    ("j-origin d3 b0 w1e-100", 0x5ed4304264140b37),
    // 8 limbs, 3001 points
    ("m d3 b0 w1e-112", 0x80d8bb036fb2184c),
    // 8 limbs, 1502 points
    ("j-parameter d3 b0 w1e-112", 0xf21efe91847f00d0),
    // 16 limbs, 1501 points
    ("j-origin d3 b0 w1e-112", 0x5ed4304264140b37),
    // 5 limbs, 777 points
    ("p777 d3 b0", 0x0585fc080f00ebcd),
    // 3 limbs, 3001 points
    ("m d3 b1 w1e-10", 0x4879a5207d823ca5),
    // 3 limbs, 1502 points
    ("j-parameter d3 b1 w1e-10", 0x72cd3a632f1ff2da),
    // 5 limbs, 1501 points
    ("j-origin d3 b1 w1e-10", 0xef5d1a1d80c2cec3),
    // 4 limbs, 3001 points
    ("m d3 b1 w1e-20", 0xf57ce1794ab070f1),
    // 4 limbs, 1502 points
    ("j-parameter d3 b1 w1e-20", 0xc5023525f8fa341e),
    // 6 limbs, 1501 points
    ("j-origin d3 b1 w1e-20", 0xc090e883aedbaedb),
    // 4 limbs, 3001 points
    ("m d3 b1 w1e-30", 0xc5c7d216602a11a1),
    // 4 limbs, 1502 points
    ("j-parameter d3 b1 w1e-30", 0x48b38496b395304b),
    // 8 limbs, 1501 points
    ("j-origin d3 b1 w1e-30", 0x6628a31879d53a6b),
    // 5 limbs, 3001 points
    ("m d3 b1 w1e-45", 0x71d3dd6de20ea579),
    // 5 limbs, 1502 points
    ("j-parameter d3 b1 w1e-45", 0x7fd6bec97d79a9c2),
    // 10 limbs, 1501 points
    ("j-origin d3 b1 w1e-45", 0x592d18f5269b1f7b),
    // 6 limbs, 3001 points
    ("m d3 b1 w1e-60", 0xe7679ef7080db78a),
    // 6 limbs, 1502 points
    ("j-parameter d3 b1 w1e-60", 0x42e6de86aa095966),
    // 12 limbs, 1501 points
    ("j-origin d3 b1 w1e-60", 0x1c054bc1f16bfad4),
    // 7 limbs, 3001 points
    ("m d3 b1 w1e-80", 0x8c28c7aa27e63a0a),
    // 7 limbs, 1502 points
    ("j-parameter d3 b1 w1e-80", 0xc5e57abf671270f3),
    // 15 limbs, 1501 points
    ("j-origin d3 b1 w1e-80", 0xbf3fd8f2c9816780),
    // 8 limbs, 3001 points
    ("m d3 b1 w1e-100", 0x6e5fc10bdc5c5ef2),
    // 8 limbs, 1502 points
    ("j-parameter d3 b1 w1e-100", 0xc7c066a651399db1),
    // 16 limbs, 1501 points
    ("j-origin d3 b1 w1e-100", 0xbbd3c189802c7cc8),
    // 8 limbs, 3001 points
    ("m d3 b1 w1e-112", 0x3c8eed4e12309b8b),
    // 8 limbs, 1502 points
    ("j-parameter d3 b1 w1e-112", 0x13def636cac1e8f2),
    // 16 limbs, 1501 points
    ("j-origin d3 b1 w1e-112", 0x86fa2929b4c8e891),
    // 5 limbs, 777 points
    ("p777 d3 b1", 0x47f0a533c58ae26e),
    // 3 limbs, 3001 points
    ("m d3 b2 w1e-10", 0x760eb1dcc1053027),
    // 3 limbs, 1502 points
    ("j-parameter d3 b2 w1e-10", 0xdc092bd0b97f8bf8),
    // 5 limbs, 1501 points
    ("j-origin d3 b2 w1e-10", 0x96d79d99052b8af9),
    // 4 limbs, 31 points
    ("m d3 b2 w1e-20", 0xd650f28d0687818d),
    // 4 limbs, 31 points
    ("j-parameter d3 b2 w1e-20", 0xd650f28d0687818d),
    // 6 limbs, 31 points
    ("j-origin d3 b2 w1e-20", 0xd650f28d0687818d),
    // 4 limbs, 15 points
    ("m d3 b2 w1e-30", 0x5a46b364404bcd92),
    // 4 limbs, 15 points
    ("j-parameter d3 b2 w1e-30", 0x5a46b364404bcd92),
    // 8 limbs, 15 points
    ("j-origin d3 b2 w1e-30", 0x5a46b364404bcd92),
    // 5 limbs, 10 points
    ("m d3 b2 w1e-45", 0xa6d18470db586856),
    // 5 limbs, 10 points
    ("j-parameter d3 b2 w1e-45", 0xa6d18470db586856),
    // 10 limbs, 10 points
    ("j-origin d3 b2 w1e-45", 0xa6d18470db586856),
    // 6 limbs, 3001 points
    ("m d3 b2 w1e-60", 0xec9cf1607db97e5a),
    // 6 limbs, 1502 points
    ("j-parameter d3 b2 w1e-60", 0xded6e2d22995cedf),
    // 12 limbs, 1501 points
    ("j-origin d3 b2 w1e-60", 0xb428323c78889f4c),
    // 7 limbs, 3001 points
    ("m d3 b2 w1e-80", 0x1c6562846b8706dd),
    // 7 limbs, 1502 points
    ("j-parameter d3 b2 w1e-80", 0x3ab8b34af6d79886),
    // 15 limbs, 1501 points
    ("j-origin d3 b2 w1e-80", 0xaad234fe1bcd63f2),
    // 8 limbs, 3001 points
    ("m d3 b2 w1e-100", 0xb568bbe47fe4a71b),
    // 8 limbs, 1502 points
    ("j-parameter d3 b2 w1e-100", 0x50eac28a6a23cb89),
    // 16 limbs, 1501 points
    ("j-origin d3 b2 w1e-100", 0xf68e0d5b5b26a079),
    // 8 limbs, 66 points
    ("m d3 b2 w1e-112", 0x75c79056871e1ca9),
    // 8 limbs, 66 points
    ("j-parameter d3 b2 w1e-112", 0x75c79056871e1ca9),
    // 16 limbs, 66 points
    ("j-origin d3 b2 w1e-112", 0x75c79056871e1ca9),
    // 5 limbs, 777 points
    ("p777 d3 b2", 0xf0d06581bd94a8cd),
    // 3 limbs, 3001 points
    ("m d3 b3 w1e-10", 0xe3ada5089759779b),
    // 3 limbs, 1502 points
    ("j-parameter d3 b3 w1e-10", 0xcb8dbbcbcfcb6039),
    // 5 limbs, 1501 points
    ("j-origin d3 b3 w1e-10", 0x8ce83e9a11a48e8d),
    // 4 limbs, 3001 points
    ("m d3 b3 w1e-20", 0xa6f0723cb03b4f7c),
    // 4 limbs, 1502 points
    ("j-parameter d3 b3 w1e-20", 0xbba2fce4f7e8d2bf),
    // 6 limbs, 1501 points
    ("j-origin d3 b3 w1e-20", 0x0ae8d80c439d5f2f),
    // 4 limbs, 3001 points
    ("m d3 b3 w1e-30", 0x736f1239d2bbbc7d),
    // 4 limbs, 1502 points
    ("j-parameter d3 b3 w1e-30", 0x43828394522ffcdf),
    // 8 limbs, 1501 points
    ("j-origin d3 b3 w1e-30", 0x25a21db59e700d13),
    // 5 limbs, 3001 points
    ("m d3 b3 w1e-45", 0xd89d36d5de71f7b7),
    // 5 limbs, 1502 points
    ("j-parameter d3 b3 w1e-45", 0x3534a9565e72bd65),
    // 10 limbs, 1501 points
    ("j-origin d3 b3 w1e-45", 0xeaf1a27599d408fd),
    // 6 limbs, 3001 points
    ("m d3 b3 w1e-60", 0x3aaa843593b44424),
    // 6 limbs, 1502 points
    ("j-parameter d3 b3 w1e-60", 0xdeeb09e6b999a205),
    // 12 limbs, 1501 points
    ("j-origin d3 b3 w1e-60", 0xd0cbb0cd4787187e),
    // 7 limbs, 3001 points
    ("m d3 b3 w1e-80", 0x50b986e3085dd41d),
    // 7 limbs, 1502 points
    ("j-parameter d3 b3 w1e-80", 0x041f488d03396351),
    // 15 limbs, 1501 points
    ("j-origin d3 b3 w1e-80", 0x7641be16d0f2a40f),
    // 8 limbs, 3001 points
    ("m d3 b3 w1e-100", 0x1fa5e3b3e8bc1bef),
    // 8 limbs, 1502 points
    ("j-parameter d3 b3 w1e-100", 0xa095f78eb0d72e31),
    // 16 limbs, 1501 points
    ("j-origin d3 b3 w1e-100", 0x2beabeff72b1379d),
    // 8 limbs, 3001 points
    ("m d3 b3 w1e-112", 0x142a9259bd8957b9),
    // 8 limbs, 1502 points
    ("j-parameter d3 b3 w1e-112", 0x7f4c8e6f45296c2e),
    // 16 limbs, 1501 points
    ("j-origin d3 b3 w1e-112", 0xd57055387d4eab13),
    // 5 limbs, 777 points
    ("p777 d3 b3", 0x43a61c36c93e4409),
    // 3 limbs, 3001 points
    ("m d4 b0 w1e-10", 0x64a052c6c09774c9),
    // 3 limbs, 1502 points
    ("j-parameter d4 b0 w1e-10", 0xa30b7fd6e89f6906),
    // 5 limbs, 1501 points
    ("j-origin d4 b0 w1e-10", 0x8e6ef78f8dc0c257),
    // 4 limbs, 3001 points
    ("m d4 b0 w1e-20", 0x24da46d1423e6343),
    // 4 limbs, 1502 points
    ("j-parameter d4 b0 w1e-20", 0x39e46a66abf35043),
    // 7 limbs, 1501 points
    ("j-origin d4 b0 w1e-20", 0x3f44e72868f79d45),
    // 4 limbs, 3001 points
    ("m d4 b0 w1e-30", 0x0f6192276470a02c),
    // 4 limbs, 1502 points
    ("j-parameter d4 b0 w1e-30", 0x6399e24f5449b28c),
    // 9 limbs, 1501 points
    ("j-origin d4 b0 w1e-30", 0x3b9c0b52e4562422),
    // 5 limbs, 3001 points
    ("m d4 b0 w1e-45", 0x1949a4c3d2938b10),
    // 5 limbs, 1502 points
    ("j-parameter d4 b0 w1e-45", 0xc5a9e89c34afc5c9),
    // 12 limbs, 1501 points
    ("j-origin d4 b0 w1e-45", 0x7c7b9ea98c4a3dea),
    // 6 limbs, 3001 points
    ("m d4 b0 w1e-60", 0x0ae33efd3e9d5d53),
    // 6 limbs, 1502 points
    ("j-parameter d4 b0 w1e-60", 0x8d3b69955ff0d292),
    // 16 limbs, 1501 points
    ("j-origin d4 b0 w1e-60", 0xd6cddbc96b4e6d81),
    // 7 limbs, 3001 points
    ("m d4 b0 w1e-80", 0xc4e94b7fc82bbe94),
    // 7 limbs, 1502 points
    ("j-parameter d4 b0 w1e-80", 0xbb983466711dee4f),
    // 16 limbs, 1501 points
    ("j-origin d4 b0 w1e-80", 0x2e5191284e0bd056),
    // 8 limbs, 3001 points
    ("m d4 b0 w1e-100", 0xe43a2c3227fcb102),
    // 8 limbs, 1502 points
    ("j-parameter d4 b0 w1e-100", 0x05dd72cee5988e90),
    // 16 limbs, 1501 points
    ("j-origin d4 b0 w1e-100", 0x4edfedd12ec04f7c),
    // 8 limbs, 3001 points
    ("m d4 b0 w1e-112", 0x7c0c215e817b769a),
    // 8 limbs, 1502 points
    ("j-parameter d4 b0 w1e-112", 0x6380217b636e779b),
    // 16 limbs, 1501 points
    ("j-origin d4 b0 w1e-112", 0x10beec3f3a93e9d8),
    // 5 limbs, 777 points
    ("p777 d4 b0", 0x94df887a43bd039e),
    // 3 limbs, 3001 points
    ("m d4 b1 w1e-10", 0x8a339b6823b2eb51),
    // 3 limbs, 1502 points
    ("j-parameter d4 b1 w1e-10", 0x74f2e080fb3fb07e),
    // 5 limbs, 1501 points
    ("j-origin d4 b1 w1e-10", 0x849822695e025fcf),
    // 4 limbs, 3001 points
    ("m d4 b1 w1e-20", 0x1bcd5cd3e392c2a5),
    // 4 limbs, 1502 points
    ("j-parameter d4 b1 w1e-20", 0xc75fc5358cd931fa),
    // 7 limbs, 1501 points
    ("j-origin d4 b1 w1e-20", 0x3a6d568bbb8bc6af),
    // 4 limbs, 3001 points
    ("m d4 b1 w1e-30", 0x776e33e4ca9e9bac),
    // 4 limbs, 1502 points
    ("j-parameter d4 b1 w1e-30", 0x6fd44fb07a7bf21f),
    // 9 limbs, 1501 points
    ("j-origin d4 b1 w1e-30", 0xcec907132aedb692),
    // 5 limbs, 3001 points
    ("m d4 b1 w1e-45", 0x08abcab638a336c3),
    // 5 limbs, 1502 points
    ("j-parameter d4 b1 w1e-45", 0xeb20fee5faa70de0),
    // 12 limbs, 1501 points
    ("j-origin d4 b1 w1e-45", 0x8761350a09ecd101),
    // 6 limbs, 3001 points
    ("m d4 b1 w1e-60", 0x8ad1de0219d6966b),
    // 6 limbs, 1502 points
    ("j-parameter d4 b1 w1e-60", 0x327caceb99f6dfba),
    // 16 limbs, 1501 points
    ("j-origin d4 b1 w1e-60", 0xf4e4d2fbb111c009),
    // 7 limbs, 3001 points
    ("m d4 b1 w1e-80", 0x7490809171b49a1b),
    // 7 limbs, 1502 points
    ("j-parameter d4 b1 w1e-80", 0x142091f3cd09f690),
    // 16 limbs, 1501 points
    ("j-origin d4 b1 w1e-80", 0x677f3282dd267109),
    // 8 limbs, 3001 points
    ("m d4 b1 w1e-100", 0xb3b96939638c0c52),
    // 8 limbs, 1502 points
    ("j-parameter d4 b1 w1e-100", 0x6dc1662448c80464),
    // 16 limbs, 1501 points
    ("j-origin d4 b1 w1e-100", 0xcc7f5cebde4a33dc),
    // 8 limbs, 3001 points
    ("m d4 b1 w1e-112", 0x2b8e073ad9fd3626),
    // 8 limbs, 1502 points
    ("j-parameter d4 b1 w1e-112", 0x5240afddd79850da),
    // 16 limbs, 1501 points
    ("j-origin d4 b1 w1e-112", 0xf8771a5ae4077f48),
    // 5 limbs, 777 points
    ("p777 d4 b1", 0x70c4b83b8a6a4818),
    // 3 limbs, 3001 points
    ("m d4 b2 w1e-10", 0xb183dd873108bbd1),
    // 3 limbs, 1502 points
    ("j-parameter d4 b2 w1e-10", 0x031bddfda1ab1b2c),
    // 5 limbs, 1501 points
    ("j-origin d4 b2 w1e-10", 0x9d09de8e05a5a453),
    // 4 limbs, 3001 points
    ("m d4 b2 w1e-20", 0xf44f389e8a50e70d),
    // 4 limbs, 1502 points
    ("j-parameter d4 b2 w1e-20", 0x5c9e71d09060d9b8),
    // 7 limbs, 1501 points
    ("j-origin d4 b2 w1e-20", 0xba7ab8ac8994e4bf),
    // 4 limbs, 3001 points
    ("m d4 b2 w1e-30", 0x1664d3eb7c84acdc),
    // 4 limbs, 1502 points
    ("j-parameter d4 b2 w1e-30", 0x4be79ea43982cefb),
    // 9 limbs, 1501 points
    ("j-origin d4 b2 w1e-30", 0xd30f97579344b49e),
    // 5 limbs, 3001 points
    ("m d4 b2 w1e-45", 0x62bfbf4b84344d37),
    // 5 limbs, 1502 points
    ("j-parameter d4 b2 w1e-45", 0xb53969b2768d5b28),
    // 12 limbs, 1501 points
    ("j-origin d4 b2 w1e-45", 0x58eb50bb3f9084f5),
    // 6 limbs, 3001 points
    ("m d4 b2 w1e-60", 0x58d48f0cea56e298),
    // 6 limbs, 1502 points
    ("j-parameter d4 b2 w1e-60", 0x748672b3a6ba49c3),
    // 16 limbs, 1501 points
    ("j-origin d4 b2 w1e-60", 0x6f8b3bf63590b33e),
    // 7 limbs, 3001 points
    ("m d4 b2 w1e-80", 0xba283bafbfdb4c19),
    // 7 limbs, 1502 points
    ("j-parameter d4 b2 w1e-80", 0x26d1daa8f5a77976),
    // 16 limbs, 1501 points
    ("j-origin d4 b2 w1e-80", 0x3492da8e4f07459b),
    // 8 limbs, 3001 points
    ("m d4 b2 w1e-100", 0x49c46f5227a52fa8),
    // 8 limbs, 1502 points
    ("j-parameter d4 b2 w1e-100", 0x82e34a30abef0e96),
    // 16 limbs, 1501 points
    ("j-origin d4 b2 w1e-100", 0x47282fb3b27315ea),
    // 8 limbs, 3001 points
    ("m d4 b2 w1e-112", 0x28101546c8b35027),
    // 8 limbs, 1502 points
    ("j-parameter d4 b2 w1e-112", 0x6b3b23a2f2d8eb31),
    // 16 limbs, 1501 points
    ("j-origin d4 b2 w1e-112", 0xda058f3d0c4464f5),
    // 5 limbs, 777 points
    ("p777 d4 b2", 0xeb3fc0f5bf648805),
    // 3 limbs, 3001 points
    ("m d4 b3 w1e-10", 0x8a284bb561e1d57a),
    // 3 limbs, 1502 points
    ("j-parameter d4 b3 w1e-10", 0xbe85b076f838ac95),
    // 5 limbs, 1501 points
    ("j-origin d4 b3 w1e-10", 0xdd1aa4267bf39bf8),
    // 4 limbs, 3001 points
    ("m d4 b3 w1e-20", 0x91c90a778f7852eb),
    // 4 limbs, 1502 points
    ("j-parameter d4 b3 w1e-20", 0xf5058303ea9191f8),
    // 7 limbs, 1501 points
    ("j-origin d4 b3 w1e-20", 0x54d9e1ddebdee109),
    // 4 limbs, 3001 points
    ("m d4 b3 w1e-30", 0xc3a39e9f335fe17a),
    // 4 limbs, 1502 points
    ("j-parameter d4 b3 w1e-30", 0xfa68fb6374b48983),
    // 9 limbs, 1501 points
    ("j-origin d4 b3 w1e-30", 0x1a856d5adb20b65c),
    // 5 limbs, 3001 points
    ("m d4 b3 w1e-45", 0x6c6f081cab37a5c0),
    // 5 limbs, 1502 points
    ("j-parameter d4 b3 w1e-45", 0x653b05a069bd8e66),
    // 12 limbs, 1501 points
    ("j-origin d4 b3 w1e-45", 0xb2e65230d7c289b6),
    // 6 limbs, 3001 points
    ("m d4 b3 w1e-60", 0x4f6e1a6bcde707c8),
    // 6 limbs, 1502 points
    ("j-parameter d4 b3 w1e-60", 0xca0b7894c369c4f6),
    // 16 limbs, 1501 points
    ("j-origin d4 b3 w1e-60", 0xec3e9113854cfd6a),
    // 7 limbs, 3001 points
    ("m d4 b3 w1e-80", 0xc178d118d4b02a77),
    // 7 limbs, 1502 points
    ("j-parameter d4 b3 w1e-80", 0xcf86fc0fc2fdb010),
    // 16 limbs, 1501 points
    ("j-origin d4 b3 w1e-80", 0xc4223716521d7851),
    // 8 limbs, 3001 points
    ("m d4 b3 w1e-100", 0x381571a824fe9c11),
    // 8 limbs, 1502 points
    ("j-parameter d4 b3 w1e-100", 0x8f72a449972f9701),
    // 16 limbs, 1501 points
    ("j-origin d4 b3 w1e-100", 0xeb803a1e98101297),
    // 8 limbs, 3001 points
    ("m d4 b3 w1e-112", 0x2a2053d4e22aeddb),
    // 8 limbs, 1502 points
    ("j-parameter d4 b3 w1e-112", 0xe5386cc5cc0b9e3d),
    // 16 limbs, 1501 points
    ("j-origin d4 b3 w1e-112", 0x2db1ace82ca12f11),
    // 5 limbs, 777 points
    ("p777 d4 b3", 0xf3d3b1a1a285e76b),
    // 3 limbs, 3001 points
    ("m d5 b0 w1e-10", 0xc3fa80e2e748e165),
    // 3 limbs, 1502 points
    ("j-parameter d5 b0 w1e-10", 0x00a030a1495223a7),
    // 6 limbs, 1501 points
    ("j-origin d5 b0 w1e-10", 0x738662217a0b71ab),
    // 4 limbs, 3001 points
    ("m d5 b0 w1e-20", 0xad6aaeee5b0d1d63),
    // 4 limbs, 1502 points
    ("j-parameter d5 b0 w1e-20", 0x393d6e1298ae0372),
    // 9 limbs, 1501 points
    ("j-origin d5 b0 w1e-20", 0xb41d64fc62fb92b9),
    // 4 limbs, 3001 points
    ("m d5 b0 w1e-30", 0xa7ace29582de2c50),
    // 4 limbs, 1502 points
    ("j-parameter d5 b0 w1e-30", 0x618d64dc7f7cb971),
    // 11 limbs, 1501 points
    ("j-origin d5 b0 w1e-30", 0xa274c1abe9bc4a72),
    // 5 limbs, 3001 points
    ("m d5 b0 w1e-45", 0x8bf809acf35ec84b),
    // 5 limbs, 1502 points
    ("j-parameter d5 b0 w1e-45", 0x03cb188fd793ac5c),
    // 15 limbs, 1501 points
    ("j-origin d5 b0 w1e-45", 0xba3b4d19425f50f5),
    // 6 limbs, 3001 points
    ("m d5 b0 w1e-60", 0xdc0d406772ad618b),
    // 6 limbs, 1502 points
    ("j-parameter d5 b0 w1e-60", 0x87e0d950ed63be8b),
    // 16 limbs, 1501 points
    ("j-origin d5 b0 w1e-60", 0x45802e987fd49a59),
    // 7 limbs, 3001 points
    ("m d5 b0 w1e-80", 0x75ec1babe5761e46),
    // 7 limbs, 1502 points
    ("j-parameter d5 b0 w1e-80", 0xdee356d9558a6ec6),
    // 16 limbs, 1501 points
    ("j-origin d5 b0 w1e-80", 0x2a45d4d9ee3c9df4),
    // 8 limbs, 3001 points
    ("m d5 b0 w1e-100", 0x5577719393439fef),
    // 8 limbs, 1502 points
    ("j-parameter d5 b0 w1e-100", 0x7f5389b73e23667c),
    // 16 limbs, 1501 points
    ("j-origin d5 b0 w1e-100", 0x7e02f98a5b41b07d),
    // 8 limbs, 3001 points
    ("m d5 b0 w1e-112", 0xb55809a9f8cd56fe),
    // 8 limbs, 1502 points
    ("j-parameter d5 b0 w1e-112", 0x4a3ba279058a9d4d),
    // 16 limbs, 1501 points
    ("j-origin d5 b0 w1e-112", 0x0cb3d7f0ff9c3594),
    // 5 limbs, 777 points
    ("p777 d5 b0", 0x88f116afd1f0a7f9),
    // 3 limbs, 3001 points
    ("m d5 b1 w1e-10", 0xef0c89abbce6c2d6),
    // 3 limbs, 1502 points
    ("j-parameter d5 b1 w1e-10", 0x2572fdc1fbd0c02c),
    // 6 limbs, 1501 points
    ("j-origin d5 b1 w1e-10", 0xb7b41e1223a40dd8),
    // 4 limbs, 3001 points
    ("m d5 b1 w1e-20", 0x51e0943d49df7f4f),
    // 4 limbs, 1502 points
    ("j-parameter d5 b1 w1e-20", 0x273493ba08e1dfeb),
    // 9 limbs, 1501 points
    ("j-origin d5 b1 w1e-20", 0x7e386a7393b92189),
    // 4 limbs, 3001 points
    ("m d5 b1 w1e-30", 0x89a96b6339ace1cb),
    // 4 limbs, 1502 points
    ("j-parameter d5 b1 w1e-30", 0x254a43b4b7c3c4f7),
    // 11 limbs, 1501 points
    ("j-origin d5 b1 w1e-30", 0xfb1d0b5855767915),
    // 5 limbs, 3001 points
    ("m d5 b1 w1e-45", 0x0a006f49c8347464),
    // 5 limbs, 1502 points
    ("j-parameter d5 b1 w1e-45", 0x017ef40b7ec59b44),
    // 15 limbs, 1501 points
    ("j-origin d5 b1 w1e-45", 0x9fea8ef3d896de32),
    // 6 limbs, 3001 points
    ("m d5 b1 w1e-60", 0x47b3a1770ad628dd),
    // 6 limbs, 1502 points
    ("j-parameter d5 b1 w1e-60", 0xa1d7ae43ca16b567),
    // 16 limbs, 1501 points
    ("j-origin d5 b1 w1e-60", 0x665cbbd824f8844b),
    // 7 limbs, 3001 points
    ("m d5 b1 w1e-80", 0x06646f811725b6f0),
    // 7 limbs, 1502 points
    ("j-parameter d5 b1 w1e-80", 0x522db864bb2d8945),
    // 16 limbs, 1501 points
    ("j-origin d5 b1 w1e-80", 0xd4bc2254338053f2),
    // 8 limbs, 3001 points
    ("m d5 b1 w1e-100", 0xfe0f3f5064507372),
    // 8 limbs, 1502 points
    ("j-parameter d5 b1 w1e-100", 0x3be1d0d089ebea86),
    // 16 limbs, 1501 points
    ("j-origin d5 b1 w1e-100", 0xb50560f3bde577f8),
    // 8 limbs, 3001 points
    ("m d5 b1 w1e-112", 0x8c66f5d9f81bb8c9),
    // 8 limbs, 1502 points
    ("j-parameter d5 b1 w1e-112", 0xd4b55aa9357bd6d5),
    // 16 limbs, 1501 points
    ("j-origin d5 b1 w1e-112", 0xb032f53f0200fa57),
    // 5 limbs, 777 points
    ("p777 d5 b1", 0x22d2e1d61383d7d0),
    // 3 limbs, 3001 points
    ("m d5 b2 w1e-10", 0x397ca692aa809e62),
    // 3 limbs, 1502 points
    ("j-parameter d5 b2 w1e-10", 0x4243b5ce8a4372e6),
    // 6 limbs, 1501 points
    ("j-origin d5 b2 w1e-10", 0xc245d91dc0b5760c),
    // 4 limbs, 3001 points
    ("m d5 b2 w1e-20", 0xb4f6423237b503db),
    // 4 limbs, 1502 points
    ("j-parameter d5 b2 w1e-20", 0x88fcd9740d05ab72),
    // 9 limbs, 1501 points
    ("j-origin d5 b2 w1e-20", 0xa4dcf3c7f210e265),
    // 4 limbs, 3001 points
    ("m d5 b2 w1e-30", 0x205c2242a7ca5ce5),
    // 4 limbs, 1502 points
    ("j-parameter d5 b2 w1e-30", 0x8e6b928f66901ded),
    // 11 limbs, 1501 points
    ("j-origin d5 b2 w1e-30", 0x484d553c2a39b28f),
    // 5 limbs, 3001 points
    ("m d5 b2 w1e-45", 0x7031b8056a858086),
    // 5 limbs, 1502 points
    ("j-parameter d5 b2 w1e-45", 0x725ac86ce92ed564),
    // 15 limbs, 1501 points
    ("j-origin d5 b2 w1e-45", 0xa4a8dceb635e1980),
    // 6 limbs, 3001 points
    ("m d5 b2 w1e-60", 0xd93c1acbd7ae469d),
    // 6 limbs, 1502 points
    ("j-parameter d5 b2 w1e-60", 0x00ecbeaa17a6d8c0),
    // 16 limbs, 1501 points
    ("j-origin d5 b2 w1e-60", 0xdf8e9e211e59a833),
    // 7 limbs, 3001 points
    ("m d5 b2 w1e-80", 0x855291057a71fcde),
    // 7 limbs, 1502 points
    ("j-parameter d5 b2 w1e-80", 0x6c4884e0c588c7db),
    // 16 limbs, 1501 points
    ("j-origin d5 b2 w1e-80", 0x88b054eeac555e10),
    // 8 limbs, 3001 points
    ("m d5 b2 w1e-100", 0x9ab2419babbf58ce),
    // 8 limbs, 1502 points
    ("j-parameter d5 b2 w1e-100", 0x8f3630005a6aab1d),
    // 16 limbs, 1501 points
    ("j-origin d5 b2 w1e-100", 0xf46f9f34d14b0884),
    // 8 limbs, 3001 points
    ("m d5 b2 w1e-112", 0x4603343f55bd6007),
    // 8 limbs, 1502 points
    ("j-parameter d5 b2 w1e-112", 0x44ec3d32c7ff6663),
    // 16 limbs, 1501 points
    ("j-origin d5 b2 w1e-112", 0x0b642d950ca2068d),
    // 5 limbs, 777 points
    ("p777 d5 b2", 0x1454ef9b380dc98c),
    // 3 limbs, 3001 points
    ("m d5 b3 w1e-10", 0x973b43d9f7870151),
    // 3 limbs, 1502 points
    ("j-parameter d5 b3 w1e-10", 0x0f8fd25a35cb6ede),
    // 6 limbs, 1501 points
    ("j-origin d5 b3 w1e-10", 0x2a13ff08ee0ea3bb),
    // 4 limbs, 3001 points
    ("m d5 b3 w1e-20", 0x49a96a084f285571),
    // 4 limbs, 1502 points
    ("j-parameter d5 b3 w1e-20", 0xf1b750c182e6a0d0),
    // 9 limbs, 1501 points
    ("j-origin d5 b3 w1e-20", 0x79cd8fb35fa56327),
    // 4 limbs, 3001 points
    ("m d5 b3 w1e-30", 0xf6ea53a375721324),
    // 4 limbs, 1502 points
    ("j-parameter d5 b3 w1e-30", 0xf7511ae2fdf80120),
    // 11 limbs, 1501 points
    ("j-origin d5 b3 w1e-30", 0x61aace31f2ef1992),
    // 5 limbs, 3001 points
    ("m d5 b3 w1e-45", 0x10bf289d0d04a163),
    // 5 limbs, 1502 points
    ("j-parameter d5 b3 w1e-45", 0xd6d3eb30cadddcc1),
    // 15 limbs, 1501 points
    ("j-origin d5 b3 w1e-45", 0x22150882e36761d5),
    // 6 limbs, 3001 points
    ("m d5 b3 w1e-60", 0x34882439e0278d6f),
    // 6 limbs, 1502 points
    ("j-parameter d5 b3 w1e-60", 0x984d3a478b7a4b77),
    // 16 limbs, 1501 points
    ("j-origin d5 b3 w1e-60", 0x4880089bb199a07a),
    // 7 limbs, 3001 points
    ("m d5 b3 w1e-80", 0x8c6d52211ed46eaa),
    // 7 limbs, 1502 points
    ("j-parameter d5 b3 w1e-80", 0x9562a88e20463c0b),
    // 16 limbs, 1501 points
    ("j-origin d5 b3 w1e-80", 0x0c296f0fbd7a26e0),
    // 8 limbs, 3001 points
    ("m d5 b3 w1e-100", 0x39c7859c9cb48174),
    // 8 limbs, 1502 points
    ("j-parameter d5 b3 w1e-100", 0xcd002ed6387abd2d),
    // 16 limbs, 1501 points
    ("j-origin d5 b3 w1e-100", 0x7aa02d630d03cbaa),
    // 8 limbs, 3001 points
    ("m d5 b3 w1e-112", 0x2fd5027e5072c809),
    // 8 limbs, 1502 points
    ("j-parameter d5 b3 w1e-112", 0x1e6cad10ea9688d1),
    // 16 limbs, 1501 points
    ("j-origin d5 b3 w1e-112", 0xcf0ce60830e21783),
    // 5 limbs, 777 points
    ("p777 d5 b3", 0xa99e3e1e1c59c6d3),
    // 3 limbs, 3001 points
    ("m d6 b0 w1e-10", 0x4fd34f67d51b7e3a),
    // 3 limbs, 1502 points
    ("j-parameter d6 b0 w1e-10", 0x82b84a9de6614cd4),
    // 7 limbs, 1501 points
    ("j-origin d6 b0 w1e-10", 0x7a9289d9739a8c2c),
    // 4 limbs, 3001 points
    ("m d6 b0 w1e-20", 0xc5d96cbad3c50dfd),
    // 4 limbs, 1502 points
    ("j-parameter d6 b0 w1e-20", 0x7cffd77af2078a91),
    // 10 limbs, 1501 points
    ("j-origin d6 b0 w1e-20", 0xf6ad44d3f45b717b),
    // 4 limbs, 3001 points
    ("m d6 b0 w1e-30", 0xa95420b5e23e8749),
    // 4 limbs, 1502 points
    ("j-parameter d6 b0 w1e-30", 0xb85dd2b906ea33eb),
    // 13 limbs, 1501 points
    ("j-origin d6 b0 w1e-30", 0x6b1b2ddab7f18493),
    // 5 limbs, 3001 points
    ("m d6 b0 w1e-45", 0xfe9b88286ff7a9a6),
    // 5 limbs, 1502 points
    ("j-parameter d6 b0 w1e-45", 0x5c62fedab265c6db),
    // 16 limbs, 1501 points
    ("j-origin d6 b0 w1e-45", 0xe02e4f695e10ea10),
    // 6 limbs, 3001 points
    ("m d6 b0 w1e-60", 0xd3cd4554ea0a6f0a),
    // 6 limbs, 1502 points
    ("j-parameter d6 b0 w1e-60", 0x53c2f30a3a8b590d),
    // 16 limbs, 1501 points
    ("j-origin d6 b0 w1e-60", 0x7c3a754b34ac63ac),
    // 7 limbs, 3001 points
    ("m d6 b0 w1e-80", 0x970bb70d3172f398),
    // 7 limbs, 1502 points
    ("j-parameter d6 b0 w1e-80", 0x22a5949d9be406d7),
    // 16 limbs, 1501 points
    ("j-origin d6 b0 w1e-80", 0xd567bf1a8664d52a),
    // 8 limbs, 3001 points
    ("m d6 b0 w1e-100", 0xb0433cc80510036e),
    // 8 limbs, 1502 points
    ("j-parameter d6 b0 w1e-100", 0x2dbc2fa4a4e8f035),
    // 16 limbs, 1501 points
    ("j-origin d6 b0 w1e-100", 0x30fee79044e00bb4),
    // 8 limbs, 3001 points
    ("m d6 b0 w1e-112", 0xb7ba19323a0a4199),
    // 8 limbs, 1502 points
    ("j-parameter d6 b0 w1e-112", 0x36bff6b2d8b0a104),
    // 16 limbs, 1501 points
    ("j-origin d6 b0 w1e-112", 0x472b6fec6aefdc13),
    // 5 limbs, 777 points
    ("p777 d6 b0", 0x99ef5950edeffe87),
    // 3 limbs, 3001 points
    ("m d6 b1 w1e-10", 0x7479348143fe8aee),
    // 3 limbs, 1502 points
    ("j-parameter d6 b1 w1e-10", 0x83e60461d67257bb),
    // 7 limbs, 1501 points
    ("j-origin d6 b1 w1e-10", 0x1e1d740c31d04048),
    // 4 limbs, 3001 points
    ("m d6 b1 w1e-20", 0xeee7e072fbf03a6c),
    // 4 limbs, 1502 points
    ("j-parameter d6 b1 w1e-20", 0xc6240a37fd33ea65),
    // 10 limbs, 1501 points
    ("j-origin d6 b1 w1e-20", 0x8422ccbd6f4683ee),
    // 4 limbs, 8 points
    ("m d6 b1 w1e-30", 0xb63ee82594418724),
    // 4 limbs, 8 points
    ("j-parameter d6 b1 w1e-30", 0xb63ee82594418724),
    // 13 limbs, 8 points
    ("j-origin d6 b1 w1e-30", 0xb63ee82594418724),
    // 5 limbs, 3001 points
    ("m d6 b1 w1e-45", 0xac316a4890c1fabf),
    // 5 limbs, 1502 points
    ("j-parameter d6 b1 w1e-45", 0x6ae3fbb0fcaff726),
    // 16 limbs, 1501 points
    ("j-origin d6 b1 w1e-45", 0x22b51d9316b728bd),
    // 6 limbs, 3001 points
    ("m d6 b1 w1e-60", 0xf9b01b014edc9fa9),
    // 6 limbs, 1502 points
    ("j-parameter d6 b1 w1e-60", 0x1db2be95b345b880),
    // 16 limbs, 1501 points
    ("j-origin d6 b1 w1e-60", 0x7550e129bdce5867),
    // 7 limbs, 14 points
    ("m d6 b1 w1e-80", 0xa12b21af6f93e4e3),
    // 7 limbs, 14 points
    ("j-parameter d6 b1 w1e-80", 0xa12b21af6f93e4e3),
    // 16 limbs, 14 points
    ("j-origin d6 b1 w1e-80", 0xa12b21af6f93e4e3),
    // 8 limbs, 8 points
    ("m d6 b1 w1e-100", 0xb430e5041a9c209c),
    // 8 limbs, 8 points
    ("j-parameter d6 b1 w1e-100", 0xb430e5041a9c209c),
    // 16 limbs, 8 points
    ("j-origin d6 b1 w1e-100", 0xb430e5041a9c209c),
    // 8 limbs, 3001 points
    ("m d6 b1 w1e-112", 0xc5fe3ff09c08bce0),
    // 8 limbs, 1502 points
    ("j-parameter d6 b1 w1e-112", 0x93724db7c19057ac),
    // 16 limbs, 1501 points
    ("j-origin d6 b1 w1e-112", 0x75c50d2f14125f42),
    // 5 limbs, 777 points
    ("p777 d6 b1", 0x441e6cbcc74879b2),
    // 3 limbs, 3001 points
    ("m d6 b2 w1e-10", 0xf06f31d8f458d1fe),
    // 3 limbs, 1502 points
    ("j-parameter d6 b2 w1e-10", 0xc6c332b1513b7705),
    // 7 limbs, 1501 points
    ("j-origin d6 b2 w1e-10", 0x6048ecbea14ff268),
    // 4 limbs, 3001 points
    ("m d6 b2 w1e-20", 0x056e303790d3b427),
    // 4 limbs, 1502 points
    ("j-parameter d6 b2 w1e-20", 0xf75f0f2daafcd58a),
    // 10 limbs, 1501 points
    ("j-origin d6 b2 w1e-20", 0x85d6c1d7e6d12559),
    // 4 limbs, 3001 points
    ("m d6 b2 w1e-30", 0x18ea920e5f0458b7),
    // 4 limbs, 1502 points
    ("j-parameter d6 b2 w1e-30", 0x638d3a3e2d917281),
    // 13 limbs, 1501 points
    ("j-origin d6 b2 w1e-30", 0x38e24015a8dca561),
    // 5 limbs, 3001 points
    ("m d6 b2 w1e-45", 0x82f1f7835d04c4d1),
    // 5 limbs, 1502 points
    ("j-parameter d6 b2 w1e-45", 0xf64a9e6778ea973e),
    // 16 limbs, 1501 points
    ("j-origin d6 b2 w1e-45", 0x15b6affee95713ef),
    // 6 limbs, 3001 points
    ("m d6 b2 w1e-60", 0x9f7e9e961b5f91a0),
    // 6 limbs, 1502 points
    ("j-parameter d6 b2 w1e-60", 0xc417cbd69d87e21b),
    // 16 limbs, 1501 points
    ("j-origin d6 b2 w1e-60", 0xcccd79c0e75ce8ae),
    // 7 limbs, 3001 points
    ("m d6 b2 w1e-80", 0xea352ef0c6622725),
    // 7 limbs, 1502 points
    ("j-parameter d6 b2 w1e-80", 0x9b5555834a2b5655),
    // 16 limbs, 1501 points
    ("j-origin d6 b2 w1e-80", 0x87399f597b2b645f),
    // 8 limbs, 3001 points
    ("m d6 b2 w1e-100", 0xf31d70be62c8d66a),
    // 8 limbs, 1502 points
    ("j-parameter d6 b2 w1e-100", 0x11be371170e9944a),
    // 16 limbs, 1501 points
    ("j-origin d6 b2 w1e-100", 0x8c560117bcfd84f0),
    // 8 limbs, 3001 points
    ("m d6 b2 w1e-112", 0xdf5baac6f9e382d9),
    // 8 limbs, 1502 points
    ("j-parameter d6 b2 w1e-112", 0x20fa279e982a124e),
    // 16 limbs, 1501 points
    ("j-origin d6 b2 w1e-112", 0x1783d89eb4cb69b3),
    // 5 limbs, 777 points
    ("p777 d6 b2", 0x6b218436c010148c),
    // 3 limbs, 3001 points
    ("m d6 b3 w1e-10", 0x3e1431231a779e4c),
    // 3 limbs, 1502 points
    ("j-parameter d6 b3 w1e-10", 0x7c2a3850a84a969b),
    // 7 limbs, 1501 points
    ("j-origin d6 b3 w1e-10", 0xff460ea09b54bfba),
    // 4 limbs, 3001 points
    ("m d6 b3 w1e-20", 0xcd2bc36f3d252d90),
    // 4 limbs, 1502 points
    ("j-parameter d6 b3 w1e-20", 0x8eef52835f92164f),
    // 10 limbs, 1501 points
    ("j-origin d6 b3 w1e-20", 0xf737235d8532e592),
    // 4 limbs, 3001 points
    ("m d6 b3 w1e-30", 0x86fd9764bfa1f5da),
    // 4 limbs, 1502 points
    ("j-parameter d6 b3 w1e-30", 0x9a082a085cebc880),
    // 13 limbs, 1501 points
    ("j-origin d6 b3 w1e-30", 0x7806e032c4bc7000),
    // 5 limbs, 3001 points
    ("m d6 b3 w1e-45", 0x990d01d9ddb1372a),
    // 5 limbs, 1502 points
    ("j-parameter d6 b3 w1e-45", 0x2c63a74f5e4b7e43),
    // 16 limbs, 1501 points
    ("j-origin d6 b3 w1e-45", 0x9b098c0111c25974),
    // 6 limbs, 3001 points
    ("m d6 b3 w1e-60", 0xebe151daa2a0cfa0),
    // 6 limbs, 1502 points
    ("j-parameter d6 b3 w1e-60", 0x5c91ed5c0bcf70f2),
    // 16 limbs, 1501 points
    ("j-origin d6 b3 w1e-60", 0xfbe51127dff967ae),
    // 7 limbs, 3001 points
    ("m d6 b3 w1e-80", 0xeb9cfe6713e03730),
    // 7 limbs, 1502 points
    ("j-parameter d6 b3 w1e-80", 0xe840bab6ef918ac0),
    // 16 limbs, 1501 points
    ("j-origin d6 b3 w1e-80", 0x1dd1c6b5c92a394e),
    // 8 limbs, 3001 points
    ("m d6 b3 w1e-100", 0xd9fbb8685f841a8b),
    // 8 limbs, 1502 points
    ("j-parameter d6 b3 w1e-100", 0x78efefc6fbddb295),
    // 16 limbs, 1501 points
    ("j-origin d6 b3 w1e-100", 0x188723d9b3fa4a85),
    // 8 limbs, 3001 points
    ("m d6 b3 w1e-112", 0xe244148628748f42),
    // 8 limbs, 1502 points
    ("j-parameter d6 b3 w1e-112", 0x435705d2d5b8eb12),
    // 16 limbs, 1501 points
    ("j-origin d6 b3 w1e-112", 0x5fa853a98af4f280),
    // 5 limbs, 777 points
    ("p777 d6 b3", 0x376678c01e935090),
    // 3 limbs, 2838 points
    ("p2838 w1e-12", 0x53690f86a23911f7),
    // 4 limbs, 2838 points
    ("p2838 w1e-30", 0x8789d1f2ed0ca58e),
    // 6 limbs, 2838 points
    ("p2838 w1e-60", 0x8789d1f2ed0ca58e),
    // 5 limbs, 120001 points
    ("long d2 b0 w1e-40", 0x97a6ae228eb30786),
    // 8 limbs, 11 points
    ("long d2 b1 w1e-112", 0x1fb76914d197433f),
    // 5 limbs, 60001 points
    ("long d3 b0 w1e-54", 0x7f54d50acc7557d8),
    // 8 limbs, 40001 points
    ("long d5 b1 w1e-100", 0x64fefcdaa61a712c),
    // 4 limbs, 40001 points
    ("long d6 b3 w1e-30", 0x9b1eb12d9d119362),
];
