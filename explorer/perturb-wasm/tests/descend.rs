//! Deep frames that have something in them.
//!
//! Every rung of the anchor's own ladder below the minibrot's 6.5e-12 atom is
//! **100% interior**, so a sweep run down it says nothing about what a deep
//! frame with a picture in it costs or looks like. This is the program that
//! closes that gap: a descent down the boundary of that minibrot, and a second
//! one down the filaments that lead away from it, keeping the rungs that are
//! mixed and busy. What it settled on is committed in `tests/frames.rs`.
//!
//! ```text
//! cargo test --release --test descend -- --ignored --nocapture
//! ```
//!
//! **The centre is an exact decimal the whole way down.** A rung's tile is
//! square and 64 across, so one sample step is `width/64` and a recentre is
//! `(2·col − 63) · 78125 · 10^−(7+p)` at a width of `10^−p` — an exact decimal,
//! which is the only reason the walk can be done in integers rather than in a
//! double that ran out of bits twenty rungs ago. [`Dec`] is that arithmetic, and
//! it is here rather than in `src/` because nothing the wasm module does needs
//! it and a `src/` edit is a rebake.

use perturb::kernel::Kernel;
use perturb::{Anchor, Spec};
use std::cmp::Ordering;

/// The audit's anchor: a period-2838 minibrot nucleus in the seahorse valley.
const ANCHOR_RE: &str = "-0.74501772828532335842941892835857434";
const ANCHOR_IM: &str = "0.14993443275456819177805709088257971";

/// The tile a rung is searched on. **Square on purpose**: `dc` runs over
/// `±width/2` horizontally and `±plane_height/2` vertically, and a square frame
/// makes both steps `width/64` — an exact decimal. A 64×36 tile would put a
/// factor of 1/36 in the vertical recentre and there is no such decimal.
const TILE: u32 = 64;

/// Digits carried after the point through the whole descent.
const SCALE: usize = 80;
/// Digits carried before it. A centre of this set has `|c| < 2`.
const INT: usize = 2;

/// The deepest rung this arithmetic reaches: a recentre at `10^−p` spends
/// `p + 7` digits.
const MAX_P: usize = SCALE - 7;

// ------------------------------------------------------------------ the decimal

/// A signed decimal with [`SCALE`] digits after the point, held as digits.
///
/// Addition and comparison only — the descent never multiplies, because every
/// offset it adds is built from a small integer and a power of ten.
#[derive(Clone)]
struct Dec {
    neg: bool,
    /// Little-endian: index 0 is the `10^−SCALE` place, index `SCALE` is units.
    digits: Vec<u8>,
}

impl Dec {
    fn zero() -> Dec {
        Dec {
            neg: false,
            digits: vec![0u8; SCALE + INT],
        }
    }

    /// A plain decimal, with no exponent — which is how every centre in this
    /// crate is spelled.
    fn parse(text: &str) -> Option<Dec> {
        let (neg, body) = match text.strip_prefix('-') {
            Some(rest) => (true, rest),
            None => (false, text.strip_prefix('+').unwrap_or(text)),
        };
        let (int_part, frac_part) = match body.split_once('.') {
            Some((a, b)) => (a, b),
            None => (body, ""),
        };
        if int_part.is_empty() && frac_part.is_empty() {
            return None;
        }
        if !int_part.bytes().all(|b| b.is_ascii_digit()) {
            return None;
        }
        if !frac_part.bytes().all(|b| b.is_ascii_digit()) {
            return None;
        }
        if frac_part.len() > SCALE || int_part.len() > INT {
            return None;
        }
        let mut out = Dec::zero();
        for (i, b) in frac_part.bytes().enumerate() {
            out.digits[SCALE - 1 - i] = b - b'0';
        }
        for (i, b) in int_part.bytes().rev().enumerate() {
            out.digits[SCALE + i] = b - b'0';
        }
        out.neg = neg;
        out.normalize();
        Some(out)
    }

    /// `units · 10^−shift`.
    fn scaled(units: i64, shift: usize) -> Dec {
        assert!(shift <= SCALE, "a shift of {shift} is past the carried scale");
        let mut out = Dec::zero();
        out.neg = units < 0;
        let mut magnitude = units.unsigned_abs();
        let mut at = SCALE - shift;
        while magnitude > 0 {
            assert!(at < out.digits.len(), "the offset overflowed the integer digits");
            out.digits[at] = (magnitude % 10) as u8;
            magnitude /= 10;
            at += 1;
        }
        out.normalize();
        out
    }

    fn is_zero(&self) -> bool {
        self.digits.iter().all(|&d| d == 0)
    }

    fn normalize(&mut self) {
        if self.is_zero() {
            self.neg = false;
        }
    }

    fn cmp_magnitude(&self, other: &Dec) -> Ordering {
        for i in (0..self.digits.len()).rev() {
            match self.digits[i].cmp(&other.digits[i]) {
                Ordering::Equal => {}
                other => return other,
            }
        }
        Ordering::Equal
    }

    fn add(&self, other: &Dec) -> Dec {
        let mut out = Dec::zero();
        if self.neg == other.neg {
            let mut carry = 0u8;
            for i in 0..out.digits.len() {
                let sum = self.digits[i] + other.digits[i] + carry;
                out.digits[i] = sum % 10;
                carry = sum / 10;
            }
            assert_eq!(carry, 0, "the centre overflowed the integer digits");
            out.neg = self.neg;
        } else {
            let (big, small) = match self.cmp_magnitude(other) {
                Ordering::Less => (other, self),
                _ => (self, other),
            };
            let mut borrow = 0i16;
            for i in 0..out.digits.len() {
                let mut digit = big.digits[i] as i16 - small.digits[i] as i16 - borrow;
                if digit < 0 {
                    digit += 10;
                    borrow = 1;
                } else {
                    borrow = 0;
                }
                out.digits[i] = digit as u8;
            }
            assert_eq!(borrow, 0, "the subtraction borrowed past the top digit");
            out.neg = big.neg;
        }
        out.normalize();
        out
    }

    /// The decimal, **truncated** to `keep` digits after the point.
    ///
    /// Truncation moves the point by less than `10^−keep`, which is why a frame
    /// is re-rendered at its trimmed centre before it is kept: the committed
    /// frame is the one a link can spell, not the one the walk happened to hold.
    fn text(&self, keep: usize) -> String {
        let keep = keep.min(SCALE);
        let mut out = String::new();
        let mut integer = String::new();
        for i in (SCALE..SCALE + INT).rev() {
            integer.push((b'0' + self.digits[i]) as char);
        }
        let integer = integer.trim_start_matches('0');
        let mut fraction: String = (0..keep)
            .map(|i| (b'0' + self.digits[SCALE - 1 - i]) as char)
            .collect();
        while fraction.ends_with('0') {
            fraction.pop();
        }
        if self.neg && !(integer.is_empty() && fraction.is_empty()) {
            out.push('-');
        }
        out.push_str(if integer.is_empty() { "0" } else { integer });
        if !fraction.is_empty() {
            out.push('.');
            out.push_str(&fraction);
        }
        out
    }
}

// --------------------------------------------------------------------- the tile

/// What one sample of a rung came to.
///
/// **Three classes and not two.** `smooth` is `NaN` for anything that did not
/// escape, which is the picture's own question; a cost study's question is
/// different, and the interior switch is what splits it: a sample the switch
/// stopped is *proven* bounded, and a sample that reached the cap without it is
/// unknown — the frame is cap-starved there and a deeper cap would move it.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Class {
    Escaped,
    Interior,
    Capped,
}

struct Tile {
    class: Vec<Class>,
    iterations: Vec<u32>,
    cap: u32,
    seconds: f64,
}

fn spec_at(re: &str, im: &str, width: f64, maxiter: Option<u32>, switch: bool) -> Spec {
    Spec {
        center_re: re.to_string(),
        center_im: im.to_string(),
        width,
        resolution: [TILE, TILE],
        supersample: 1,
        maxiter,
        reference: None,
        period: None,
        julia: None,
        anchor: Anchor::Parameter,
        interior: switch,
    }
}

/// Walks a whole tile. **The interior switch is on**, because the classification
/// above is the whole point of the walk and the switch is what makes it.
fn render(spec: &Spec) -> Tile {
    let orbit = spec.reference_orbit().unwrap();
    let kernel = Kernel::new(&orbit, spec.maxiter(), spec.interior).at_entry(spec.entry());
    let offset = spec.centre_offset().unwrap();
    let count = (spec.resolution[0] * spec.resolution[1]) as usize;
    let mut class = Vec::with_capacity(count);
    let mut iterations = Vec::with_capacity(count);
    let at = std::time::Instant::now();
    for row in 0..spec.resolution[1] {
        for col in 0..spec.resolution[0] {
            let (re, im) = spec.dc(offset, col, row);
            let outcome = kernel.sample_with::<false>(re, im);
            class.push(if !outcome.smooth.is_nan() {
                Class::Escaped
            } else if outcome.detected_interior {
                Class::Interior
            } else {
                Class::Capped
            });
            iterations.push(outcome.iterations);
        }
    }
    Tile {
        class,
        iterations,
        cap: spec.maxiter(),
        seconds: at.elapsed().as_secs_f64(),
    }
}

/// What a rung looks like, in the numbers that decide whether to go on from it.
struct Shape {
    escaped: f64,
    interior: f64,
    capped: f64,
    /// Adjacent sample pairs, of the tile's own grid, with one escaped and one
    /// not — as a share of all of them. **This is what "busy" is measured as.**
    /// A smooth boundary laid across a 64×64 tile crosses about 64 of some
    /// 8,000 adjacencies; a filament region crosses hundreds.
    edges: f64,
    /// The spread of escape counts, p95 − p5 over what escaped.
    spread: u32,
    mean_iterations: f64,
}

fn shape(tile: &Tile) -> Shape {
    let count = tile.class.len() as f64;
    let share = |want: Class| {
        tile.class.iter().filter(|&&c| c == want).count() as f64 / count
    };
    let side = TILE as usize;
    let (mut crossings, mut pairs) = (0usize, 0usize);
    let mut cross = |a: Class, b: Class| {
        pairs += 1;
        if (a == Class::Escaped) != (b == Class::Escaped) {
            crossings += 1;
        }
    };
    for row in 0..side {
        for col in 0..side {
            let here = tile.class[row * side + col];
            if col + 1 < side {
                cross(here, tile.class[row * side + col + 1]);
            }
            if row + 1 < side {
                cross(here, tile.class[(row + 1) * side + col]);
            }
        }
    }
    let mut escaped: Vec<u32> = (0..tile.class.len())
        .filter(|&i| tile.class[i] == Class::Escaped)
        .map(|i| tile.iterations[i])
        .collect();
    escaped.sort_unstable();
    let at = |share: f64| -> u32 {
        if escaped.is_empty() {
            return 0;
        }
        escaped[(((escaped.len() - 1) as f64) * share).round() as usize]
    };
    Shape {
        escaped: share(Class::Escaped),
        interior: share(Class::Interior),
        capped: share(Class::Capped),
        edges: crossings as f64 / pairs.max(1) as f64,
        spread: at(0.95).saturating_sub(at(0.05)),
        mean_iterations: tile.iterations.iter().map(|&n| n as f64).sum::<f64>() / count,
    }
}

/// A rung worth descending from: it has both kinds of sample in it, and the
/// boundary between them is not one smooth line.
fn is_busy(shape: &Shape) -> bool {
    shape.escaped >= 0.05 && (shape.interior + shape.capped) >= 0.05 && shape.edges >= 0.01
}

// --------------------------------------------------------------- the candidates

/// Where to aim the next rung.
#[derive(Clone, Copy, PartialEq)]
enum Route {
    /// The busiest neighbourhood: the most boundary crossings in a 5×5.
    /// Follows the tangle rather than any one feature.
    Tangle,
    /// The deepest escaping sample next to something that did not escape — the
    /// pinch points, which is where an embedded Julia set is.
    Pinch,
    /// A boundary between escaping samples and samples that are **still**
    /// unresolved at [`PROBE`] times the policy cap, which is the only kind of
    /// frame at this depth that has genuine interior in it rather than exterior
    /// the cap gave up on. Every rung of this route is walked at the probe cap,
    /// so it costs several times what the other two do.
    Body,
}

/// How far past the policy cap a rung is walked before a sample that has not
/// escaped is believed. **Four**, because the cap ladder in `tests/frames.rs`
/// found every structured frame fully resolved by two.
const PROBE: u32 = 4;

/// Candidates for the next centre, best first, as `(col, row)`.
///
/// Only samples with both an escaped and a non-escaped neighbour in their own
/// 3×3 are offered at all: a centre in open exterior or deep inside the body is
/// a rung that comes back one colour whatever else is true of it.
fn candidates(tile: &Tile, route: Route) -> Vec<(u32, u32)> {
    let side = TILE as usize;
    let margin = 3usize;
    let mut scored: Vec<(i64, u32, u32)> = Vec::new();
    for row in margin..side - margin {
        for col in margin..side - margin {
            let mut near_escaped = false;
            let mut near_other = false;
            for dy in -1i32..=1 {
                for dx in -1i32..=1 {
                    let c = tile.class[(row as i32 + dy) as usize * side + (col as i32 + dx) as usize];
                    if c == Class::Escaped {
                        near_escaped = true;
                    } else {
                        near_other = true;
                    }
                }
            }
            if !(near_escaped && near_other) {
                continue;
            }
            let mut crossings = 0i64;
            let mut deepest = 0i64;
            for dy in -2i32..=2 {
                for dx in -2i32..=2 {
                    let at = (row as i32 + dy) as usize * side + (col as i32 + dx) as usize;
                    if tile.class[at] == Class::Escaped {
                        deepest = deepest.max(tile.iterations[at] as i64);
                        if dx < 2 {
                            let right = at + 1;
                            if tile.class[right] != Class::Escaped {
                                crossings += 1;
                            }
                        }
                        if dy < 2 {
                            let below = at + side;
                            if tile.class[below] != Class::Escaped {
                                crossings += 1;
                            }
                        }
                    }
                }
            }
            let score = match route {
                Route::Tangle | Route::Body => crossings * 1_000_000 + deepest.min(999_999),
                Route::Pinch => deepest * 1_000 + crossings,
            };
            scored.push((score, col as u32, row as u32));
        }
    }
    scored.sort_by(|a, b| b.0.cmp(&a.0));
    // One candidate to a neighbourhood: the top of a ridge and its own shoulder
    // are the same place, and trying both is two renders of one frame.
    let mut out: Vec<(u32, u32)> = Vec::new();
    for (_, col, row) in scored {
        if out
            .iter()
            .any(|&(c, r)| c.abs_diff(col) <= 2 && r.abs_diff(row) <= 2)
        {
            continue;
        }
        out.push((col, row));
        if out.len() == 8 {
            break;
        }
    }
    out
}

/// The exact decimal offset from the rung's centre to sample `(col, row)`, at a
/// width of `10^−p`.
///
/// `(col + 0.5)/64 − 0.5` is `(2·col − 63)/128`, and `1/128` is `78125·10^−7`.
fn offset_of(col: u32, row: u32, p: usize) -> (Dec, Dec) {
    assert!(p <= MAX_P, "a rung at 1e-{p} is past what {SCALE} digits carry");
    let across = (2 * col as i64 - (TILE as i64 - 1)) * 78_125;
    let down = ((TILE as i64 - 1) - 2 * row as i64) * 78_125;
    (Dec::scaled(across, p + 7), Dec::scaled(down, p + 7))
}

/// Ten to the minus `p`, as the `f64` width a spec carries.
fn width_of(p: usize) -> f64 {
    format!("1e-{p}").parse().unwrap()
}

/// Digits after the point a frame's link needs: the width, and five more so that
/// truncation is well under a pixel of the finest pass the tab draws.
fn keep_for(p: usize) -> usize {
    p + 8
}

// --------------------------------------------------------------------- the walk

struct Rung {
    p: usize,
    re: Dec,
    im: Dec,
    shape: Shape,
    cap: u32,
    seconds: f64,
}

/// Descends from `(re, im)` at `10^−p` to `10^−deepest`, backtracking where a
/// rung comes back one colour, and returns every rung it settled on.
fn descend(route: Route, re: Dec, im: Dec, from: usize, deepest: usize) -> Vec<Rung> {
    // One frame of the search: the rung, its candidates, and how many of them
    // have been tried.
    struct Level {
        rung: Rung,
        tile: Tile,
        tried: usize,
    }
    let mut budget = 240usize;
    let open = |p: usize, re: Dec, im: Dec| -> (Rung, Tile) {
        // The body route walks every rung past the policy cap, because what it
        // is looking for — a sample that is bounded rather than slow — is a
        // question the policy cap cannot answer at this depth.
        let cap = (route == Route::Body).then(|| PROBE * perturb::cap::for_width(width_of(p)));
        let spec = spec_at(&re.text(SCALE), &im.text(SCALE), width_of(p), cap, true);
        let tile = render(&spec);
        let shape = shape(&tile);
        let rung = Rung {
            p,
            re,
            im,
            cap: tile.cap,
            seconds: tile.seconds,
            shape,
        };
        (rung, tile)
    };

    let (rung, tile) = open(from, re, im);
    budget -= 1;
    let mut stack: Vec<Level> = vec![Level { rung, tile, tried: 0 }];
    let mut kept: Vec<Rung> = Vec::new();

    while let Some(top) = stack.len().checked_sub(1) {
        let p = stack[top].rung.p;
        if p >= deepest {
            break;
        }
        if budget == 0 {
            println!("  ⚠ the render budget ran out at 1e-{p}");
            break;
        }
        let picks = candidates(&stack[top].tile, route);
        if stack[top].tried >= picks.len().min(4) {
            let dead = stack.pop().unwrap();
            println!(
                "  ↑ 1e-{} offered nothing that held; backing up",
                dead.rung.p
            );
            if stack.is_empty() {
                break;
            }
            continue;
        }
        let (col, row) = picks[stack[top].tried];
        stack[top].tried += 1;
        let (dre, dim) = offset_of(col, row, p);
        let (re, im) = (stack[top].rung.re.add(&dre), stack[top].rung.im.add(&dim));
        let (rung, tile) = open(p + 1, re, im);
        budget -= 1;
        let shape = &rung.shape;
        let held = is_busy(shape);
        println!(
            "  1e-{:<3} at ({col:>2},{row:>2}) → esc {:>5.1}%  int {:>5.1}%  cap {:>5.1}%  \
             edges {:>5.2}%  spread {:>7}  mean {:>8.0}  {:>5.2}s  {}",
            p + 1,
            100.0 * shape.escaped,
            100.0 * shape.interior,
            100.0 * shape.capped,
            100.0 * shape.edges,
            shape.spread,
            shape.mean_iterations,
            rung.seconds,
            if held { "kept" } else { "thin" },
        );
        if held {
            stack.push(Level { rung, tile, tried: 0 });
        }
    }
    for level in stack {
        kept.push(level.rung);
    }
    kept
}

/// The frame as the Deep tab would be asked for it.
fn link(re: &Dec, im: &Dec, p: usize, cap: u32) -> String {
    let keep = keep_for(p);
    format!(
        "explorer/?dv=2&x={}&y={}&w=1e-{p}&n={cap}&p=twilight_shifted&panel=deep",
        re.text(keep),
        im.text(keep)
    )
}

// --------------------------------------------------------------------- the test

/// **The descent.** Two routes out of the anchor's own minibrot, and the rungs
/// they settle on.
#[test]
#[ignore = "minutes: a coarse tile a rung, all the way down"]
fn descend_to_deep_frames() {
    let anchor_re = Dec::parse(ANCHOR_RE).unwrap();
    let anchor_im = Dec::parse(ANCHOR_IM).unwrap();
    // 1e-11 rather than the anchor's own 2e-11: a power of ten is what the
    // recentring arithmetic is exact in, and the minibrot's 6.5e-12 atom still
    // sits well inside a frame this wide, so the boundary is on the tile.
    let start = 11usize;
    let deepest = 54usize;

    for route in [Route::Tangle, Route::Pinch, Route::Body] {
        let name = match route {
            Route::Tangle => "tangle",
            Route::Pinch => "pinch",
            Route::Body => "body",
        };
        // The body route walks every rung at four times the cap, so it stops
        // where a rung stops being seconds. The other two are bounded by what a
        // link can spell rather than by what the crate can draw.
        let floor = if route == Route::Body { 30 } else { deepest };
        println!("\n## the {name} route, from 1e-{start} to 1e-{floor}\n");
        if route == Route::Body {
            println!(
                "Every rung here is walked at {PROBE}× the policy cap, so its `cap-starved` \
                 column is what is still unresolved at *that* — which at this depth is the \
                 interior rather than anything the cap gave up on.\n"
            );
        }
        let rungs = descend(route, anchor_re.clone(), anchor_im.clone(), start, floor);
        println!("\n### what it settled on\n");
        println!("| rung | cap | escaped | interior | cap-starved | edges | spread | mean |");
        println!("|---|--:|--:|--:|--:|--:|--:|--:|");
        for rung in &rungs {
            println!(
                "| 1e-{} | {} | {:.1}% | {:.1}% | {:.1}% | {:.2}% | {} | {:.0} |",
                rung.p,
                rung.cap,
                100.0 * rung.shape.escaped,
                100.0 * rung.shape.interior,
                100.0 * rung.shape.capped,
                100.0 * rung.shape.edges,
                rung.shape.spread,
                rung.shape.mean_iterations,
            );
        }
        println!("\n### the frames, at the centre a link can spell\n");
        for rung in &rungs {
            if ![22usize, 28, 34, 40, 46, 52, 53, 54].contains(&rung.p) {
                continue;
            }
            let keep = keep_for(rung.p);
            let (re, im) = (rung.re.text(keep), rung.im.text(keep));
            // The trimmed centre is a different frame from the carried one, by
            // less than a thousandth of a pixel — and it is the one that gets
            // committed, so it is the one that gets measured.
            let spec = spec_at(&re, &im, width_of(rung.p), None, true);
            let trimmed = shape(&render(&spec));
            println!(
                "- **{name} 1e-{}**, cap {}, centre {} chars: escaped {:.1}% → {:.1}% trimmed, \
                 cap-starved {:.1}%, edges {:.2}%",
                rung.p,
                rung.cap,
                re.len(),
                100.0 * rung.shape.escaped,
                100.0 * trimmed.escaped,
                100.0 * trimmed.capped,
                100.0 * trimmed.edges,
            );
            println!("  `{}`", link(&rung.re, &rung.im, rung.p, rung.cap));
            println!(
                "  `(\"{name} 1e-{}\", \"{}\", \"{}\", 1e-{}, {})`,",
                rung.p, re, im, rung.p, rung.cap
            );
        }
    }
}

/// The decimal the descent walks in, against the cases it has to get right.
#[test]
fn the_carried_decimal_adds_the_way_a_recentre_needs() {
    let anchor = Dec::parse(ANCHOR_RE).unwrap();
    assert_eq!(anchor.text(SCALE), ANCHOR_RE);
    assert_eq!(anchor.text(10), "-0.7450177282");
    // Crossing zero, both ways, and the sign that comes out of it.
    let one = Dec::parse("1").unwrap();
    let minus_three = Dec::parse("-3").unwrap();
    assert_eq!(one.add(&minus_three).text(SCALE), "-2");
    assert_eq!(minus_three.add(&one).text(SCALE), "-2");
    assert_eq!(one.add(&Dec::parse("-1").unwrap()).text(SCALE), "0");
    // A borrow that runs the length of the number, which is the case a naive
    // subtraction gets wrong and a descent would then never notice.
    let a = Dec::parse("-0.1").unwrap();
    let b = Dec::scaled(1, SCALE);
    assert_eq!(
        a.add(&b).text(SCALE),
        format!("-0.0{}", "9".repeat(SCALE - 1))
    );
    // The offset a recentre actually adds: one sample step of a 64-wide tile at
    // 1e-22 is 1.5625e-24, and the far column is 31.5 of them.
    let (across, down) = offset_of(63, 0, 22);
    assert_eq!(across.text(SCALE), format!("0.{}4921875", "0".repeat(22)));
    assert_eq!(down.text(SCALE), across.text(SCALE));
    let (across, down) = offset_of(32, 32, 22);
    assert_eq!(across.text(SCALE), format!("0.{}78125", "0".repeat(24)));
    assert_eq!(down.text(SCALE), format!("-{}", across.text(SCALE)));
    // And it lands where the kernel puts that sample, to the last bit the
    // double carries.
    let spec = spec_at(ANCHOR_RE, ANCHOR_IM, width_of(22), None, true);
    let (dc_re, dc_im) = spec.dc((0.0, 0.0), 63, 0);
    let walked: f64 = offset_of(63, 0, 22).0.text(SCALE).parse().unwrap();
    assert!((walked - dc_re).abs() < 1e-38, "{walked:e} vs {dc_re:e}");
    let walked: f64 = offset_of(63, 0, 22).1.text(SCALE).parse().unwrap();
    assert!((walked - dc_im).abs() < 1e-38, "{walked:e} vs {dc_im:e}");
}
