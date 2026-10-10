# deep-gpu-model

A native Rust model of the WebGPU kernel the Deep tab would use as a fast preview, and,
once that shader exists, its oracle. It restates `perturb`'s perturbation kernel
(`explorer/perturb-wasm`) in the only types WGSL has, runs it natively, and measures it
against `perturb`'s own `f64` kernel sample for sample. Nothing here is on the page: the
shipped Deep path, its wasm, its links, and its pictures are untouched by this crate, which
uses `perturb` as a library for the reference orbit and for the kernel it is compared with.

This README is provisional. The measured precision frontier, what the iteration-skipping
switch buys across the corpus, and what a GPU would hold per frame come with the
measurements.

## What is where

```
Cargo.toml          one dependency, perturb, by path; no others
src/wgsl.rs         the WGSL builtins and bit idioms the loop uses, one function each
src/orbit.rs        the reference orbit as a GPU buffer: F32Pair or HiLo
src/frame.rs        per-frame constants, and dc formed per pixel from its column and row
src/model.rs        the per-pixel state struct and the bounded-step loop
src/bla.rs          the skip table: built in f64, stored as the GPU holds it, looked up in f32
src/compare.rs      the harness: both kernels on one frame, and how they agree
src/json.rs         just enough JSON to read a corpus row
src/bin/compare.rs  the harness as a command, one JSON line per frame
tests/agreement.rs  the model against perturb on frames the site draws
tests/bla.rs        the skip: switch-off identity, passes, its runs, its guards, its price
```

## The arithmetic rules

The per-pixel path (`model::init`, `model::pass`, and `Frame::dc_mantissa`) keeps to what
WGSL can express:

- **`f32`, `i32`, and `u32` only.** No `f64` anywhere in the per-pixel loop. `f64` appears
  in CPU-side setup alone: narrowing the reference orbit, reducing the frame to its
  constants, and the comparison harness.
- **No fused multiply-add**, and every multiply and add in the order `perturb` writes it.
  WGSL cannot forbid a backend from contracting `a * b + c` into one rounding, so a
  shader is held to this model with a tolerance, never bit for bit (`src/model.rs`
  says where the contractible sites are). Bit identity is a claim the model makes only
  about itself: passes of any budget leave the same state.
- **No infinity or NaN is ever read.** WGSL lets an implementation assume they do not
  occur, so every test that could meet one (the escape at degree four and up, the
  scaling thresholds) is decided on an integer exponent or a finite compare first.
- **No reliance on the compiler keeping an order it could reassociate**, with one flagged
  exception: the high/low reference sums, written `hi + (lo + δ)` and marked
  `REASSOCIATION HAZARD`. A shader compiler that rewrites them as `(hi + lo) + δ` silently
  turns the HiLo kernel into the F32Pair one.
- **Powers of two are applied by integer arithmetic on the exponent field**
  (`wgsl::ldexp_exact`), never through WGSL's `ldexp` outside `[-126, 128]`. A result
  that would be subnormal is a signed zero, the same on any GPU whether or not it flushes,
  and the reference orbit and frame constants are stored without subnormals for the same
  reason.

## The model in brief

- **The delta is `d · 2^s`**: an `f32` complex mantissa and one `i32` exponent per pixel.
  At `s == 0` the delta is unscaled. Below `2^-62` it is scaled, its mantissa kept within
  `2^±32`. Deep frames spend a large share of their steps scaled (27% at 1e-22, 74% at
  1e-54).
- **The step has a quick path and a careful one.** The quick path is `perturb`'s step in
  the delta's units, and runs wherever its operands keep every leading term in `f32`'s
  normal range. On the corpus frames measured that is every step but a Mandelbrot
  pixel's first (where `δ = 0` and `Z = 0`) and a few dozen others a frame, and their
  fields are the model's before the careful path existed, sample for sample, except a
  last-bit change in the smooth fraction of a handful of samples that escape with `|z|`
  past `2^62`, which now take the rescaled logarithm.
  The careful path takes the rest: a reference point near zero (a minibrot's nucleus,
  `Z[0]` after a rebase or a periodic wrap, the first step of a Julia frame anchored at
  `z = 0`), where `δ' = δ^D (+ dc)` can be far below `2^-126`. It rescales `Z` and `δ`
  to about 1, forms the step there, and adds `dc` at the larger exponent, so the result
  keeps its size whatever it is. `src/model.rs` has the gate, the reasons, and the
  measurements.
- **`dc` is formed the way a GPU would form it**: the frame's offset and sample spacing as
  `f32` mantissas against one shared exponent, and each pixel's offset from its integer
  column and row, rather than `perturb`'s `f64` offset narrowed.
- **The reference orbit comes in two encodings**: F32Pair, eight bytes a point, and HiLo,
  a high and a low `f32` per component, sixteen bytes a point.
- **Rebasing is `perturb`'s rule.** In the scaled regime it compares scaled values,
  because `|δ|²` underflows `f32` there.
- **The count is a `u32` and the smooth fraction a separate `f32`**, computed at the
  escape from a rescaled `|z|` when `|z|²` overflows (degree four and up).
- **Bounded steps per pass.** All per-pixel state is one 48-byte `#[repr(C)]` struct
  (`PixelState`, laid out as WGSL would lay it out: a `vec2<f32>` and ten 4-byte scalars).
  `pass` advances it by at most a given number of steps, and the result is bit-identical
  whatever that number is. Three of its fields are measurement counters (rebases, steps,
  and steps taken scaled); the kernel needs 36 bytes.
- **The interior switch** is `perturb`'s, with `|dz|²` as a mantissa in `[1, 2)` and an
  `i32` exponent, and `|z|²` formed from a rescaled `z` wherever it would underflow. It is
  a frame flag, because long-orbit frames must run with it off.
- **Degrees two to six, and both Julia anchors**, all of what `perturb` draws.

## Iteration skipping (provisional)

A switch, off by default: `model::pass` is the model without it, and `model::pass_bla`
takes a `bla::GpuTable`. **The shipped kernel has no skip table**, and nothing here
changes that; `perturb` removed its own (`5fa1515a`, `b84e7e5d`, `394056b2`) because it
moved the picture at every tolerance it paid at, which an `f64` kernel holding itself to
"draws what the engine draws" could not accept. On this path `f32` already moves the
picture by its own rounding, so the bar is the model with the switch on agreeing with
`perturb` no worse than with it off.

- **Switched off, nothing moved.** `tests/bla.rs` holds every field of every pixel's
  final state, on seven frames and both encodings, to hashes taken from the phase-1
  model before the switch existed, and holds the switch on with an empty table to the
  same hashes.
- **The table is the removed one's design**: its merge rule, its guards (no run reaches
  `len − 1`; a leaf whose landing point could clear the bailout is dead; `n + l < maxiter`
  at lookup; the interior switch cannot fire inside a run, through each entry's smallest
  prefix product), its level layout (level-`k` entry `j` is the run of `2^k` from
  `j·2^k + 1`, levels below `min_level` merged and not stored) and its aligned,
  bottom-up lookup. It is built on the CPU in `f64` from `perturb`'s `f64` orbit,
  streamed up a stack of one pending entry per level, so the build's memory is the
  output.
- **The interior product covers a run's inner points, not its landing.** The radius
  bounds `δ` where a run starts and where it passes, never where it lands, and the
  landing is where the loop may rebase, so there `|Z|` says nothing about `|z|`. A skip
  multiplies `|dz|²` by the stored product over the inner points and then takes the
  ordinary derivative step on the `z` it landed on. (A first version took the landing
  factor from `Z` and proved escaping pixels interior: 23 samples on
  `pick:random:u0477`, which `tests/bla.rs` now holds at none.)
- **Degrees two to six**: one step is `A = D·Z^(D−1)`, `B = 1`, and the single-step
  radius is `ε·|Z|/(D−1)`, a factor of two inside where the first dropped term,
  `C(D,2)·Z^(D−2)·δ²`, reaches `ε` of the kept one; the factor covers the higher terms
  up to `D = 6`. At `D = 2` it is the removed table's `ε·|Z|`. `src/bla.rs` has the
  derivation and `tests/bla.rs` walks the exact recurrence through stored runs at every
  degree from a delta on the radius: `|δ|` reaches at most 1.0002 of the leaf radius and
  the landing error is 0.8ε to 2.8ε.
- **Julia planes**: `B = 0` and `dcmax = 0`, so the radii merge without a frame term.
- **Periodic references are built over the cycle, and no run crosses the wrap**: a run
  may land on index `len`, which is index 0, and none passes through it. (Index 0 is
  `Z = 0`, where the step is not linear anyway.) The removed table refused them.
- **Stored as the GPU holds it.** An entry is 32 bytes: `A` and `B` as `vec2<f32>`
  mantissas against `i32` exponents, and the radius squared as an `f32` mantissa in
  `[1, 2)` against an `i32` exponent, rounded down; the range demands it (`|B|` passes
  `f32` below about `1e-45`, `r²` underflows `f32` from about `1e-19`). The interior
  products are a second 16-byte entry in a buffer of their own that only a frame with the
  switch on binds. A 528-byte uniform header holds the levels' offsets and counts. At
  the default `min_level` 4 a table is about `len/8` entries: **4.0 bytes per reference
  iteration, 6.0 with the interior buffer**, against 8 (`F32Pair`) or 16 (`HiLo`) for the
  orbit itself. Each level lower doubles it. **Under WebGPU's default 128 MiB per storage
  binding the orbit, not the table, is the ceiling**: 16.7M points as `F32Pair`, 8.4M as
  `HiLo`, where the default table runs to 33.5M (16.7M at `min_level` 3, 8.4M at 2). So
  the `HiLo` long-orbit frames at 1e7 and the 2e7 Feigenbaum frame in either encoding
  would need the orbit split across bindings or a raised limit.
- **The lookup and the skip are `f32`, `i32` and `u32`.** The lookup runs only where
  `(m − 1) mod 2^min_level == 0`, an integer test with no read; there it compares `|d|²`
  split into a mantissa and an exponent against the stored radius exponent first, so it
  works in the scaled regime without forming `|δ|²`. The skip forms `A·d` and `B·dc_m` as
  mantissa products, adds them at the larger exponent the way the careful step adds its
  product to `dc`, and settles the sum into the state's form.
- **A skip is one delta step, and is never split**: the budget counts delta steps, and
  passes of any budget leave the state and the counters one unbounded pass does
  (`tests/bla.rs`, on seven frames that skip). The skip's counters (`BlaStats`: skips,
  iterations skipped, entries read) are a 12-byte measurement buffer of their own, so
  `PixelState` is the same 48 bytes with the switch on.
- **Tolerance and levels are run-time parameters** (`BlaOptions`, `--eps`,
  `--min-level`, `--max-level`), defaulting to `2^-24`, 4 and 24.

What it buys, first numbers (64x36, `F32Pair`, `ε = 2^-24`; delta steps per pixel off
-> on, and agreement with `perturb` off -> on as the share of samples more than 0.1
apart):

| frame | width, degree | cap | steps off -> on | reads on | over 0.1 off -> on | class changes |
|---|---|--:|---|--:|---|---|
| main cusp, interior off | 4e-19, 2 | 2e7 | 15,703,126 -> 29,581 | 2,089 | 60.9% -> 1.5% | 98 -> 0 |
| copy cusp p2209, interior off | 8.8e-23, 4 | 1e7 | 7,794,155 -> 149,630 | 128,482 | 99.8% -> 92.0% | 25 -> 4 |
| Feigenbaum point, interior off | 1e-12, 2 | 1.2e7 | 5,941,671 -> 1,419,326 | 511,184 | 100% -> 100% | 18 -> 12 |
| `random-dives#501` | 8.7e-42, 5 | 1,471,930 | 6,211 -> 903 | 159 | 20.6% -> 14.2% | 0 -> 0 |
| `deep-gallery#30` | 1.9e-21, 6 | 88,485 | 3,076 -> 1,617 | 209 | 35.1% -> 31.3% | 0 -> 0 |
| `tangle-1e-54` | 1e-54, 2 | 221,162 | 215,646 -> 22,681 | 2,498 | 89.5% -> 74.9% | 328 -> 179 |

The long-orbit frames are `longorbit.jsonl`'s from the stage-1 briefs. On the main cusp
the model without the skip drifts over 1.6e7 roundings (70 samples escape a whole pass
early), and with it 22 skips carry the pixel through the channel and it agrees with
`perturb` to a p99 of 0.22. On the Feigenbaum frame neither column is a verdict on `f32`:
`perturb` itself moves most of its escaped samples there when given a second reference.
On the sixteen hand-picked frames of the first measurements the share over 0.1 with the
skip is within half a point of the share without it or better; the worst rise is the
degree-three Misiurewicz panel at 5.2e-16 under HiLo (17.2% -> 17.7%), then the same
panel's Julia twin (+0.2) and `dive-sheet:u0022` (0.17% -> 0.26%).

**A random slice of the corpus says the same on average and shows a tail.** On 240
corpus frames (64x36, `F32Pair`, interior on) the skip cuts delta steps to 0.76 of
without it, the mean share over 0.1 goes from 44.2% to 42.5% (the `f64` kernel on an
`f32`-rounded reference sits at 41.5%), and class changes from 51 to 46. Seven frames
rise by more than two points (up to +6.1, `random-dives#93`), and every one of them is
ill-conditioned: its `f64` field moves 47% to 76% of its samples under an `f32` rounding
of its reference alone, and the skip leaves it within the ruling `tests/agreement.rs`
holds the model to at that floor. Tightening `ε` does not buy the tail back: at `2^-26`,
`2^-28`, `2^-30` and `1e-10` the mean share is 42.9%, 43.2%, 43.4% and 43.7%, steps are
0.82, 0.86, 0.90 and 0.94 of without, and 4, 3, 3 and 1 frames still rise by more than
two points, not always the same ones. So `2^-24` stays the default at every degree;
degree-six Mandelbrot frames (19 of them) average +0.3 points at it, +0.15 at `2^-28`.

On shallow frames it buys nothing at this tolerance: a merged radius has to clear
`|B|·dcmax`, so long runs begin only where `ε` is about `2e10` times the frame's
half-diagonal (the removed table's law, which these numbers keep). Frames at `3e-3`,
`4e-4`, `7e-7` and the home view keep every step, at one entry read per 7 to 16 steps,
and one at `7.3e-9` saves 2%. Phase 3 sweeps `ε` above `2^-24` and the levels across the
corpus.

## Running a comparison

```
cd explorer/deep-gpu-model
cargo build --release
target/release/compare --corpus frames.jsonl [--ids a,b] [--res 160x90] [--cap N]
    [--cap-max N] [--encoding f32pair|hilo|both] [--interior on|off] [--threads N]
    [--budget N] [--floor on] [--dump DIR] [--out FILE]
    [--bla off|on|both] [--eps E] [--min-level K] [--max-level K]
target/release/compare --re X --im Y --w W [--n CAP] [--deg D] [--jre A --jim B]
    [--anchor origin] [--period P] [--id NAME] ...
```

A corpus row is `{id, re, im, w, n, degree, julia_re, julia_im, anchor, period}`, with the
coordinates as decimal strings. Each frame prints one JSON line: the `f64` kernel's escape
count, mean iterations, rebases, and wall time, and per encoding the model's class counts,
how many samples change class, the distribution of `|Δ smooth|` over the samples both
kernels escape at (p50, p90, p99, max, and the shares above 0.01, 0.1, 1, and 10), mean
steps, the share of steps taken scaled, rebases, and wall time. `--floor on` adds the
`f64` kernel run on the reference rounded to `f32`, which is how far a frame moves under
an `f32` rounding of its reference alone. `--dump DIR` writes each field as little-endian
binaries: `<id>.f64.bin` for `perturb` and `<id>.<encoding>.bin` (`f64`) and
`<id>.<encoding>.f32.bin` for the model, `NaN` interior.

`--bla on` runs the model with the skip table, `both` without and then with it (keyed
`<encoding>+bla`); the `f64` kernel never has one. The line then carries the table
(`entries`, `valid`, `entry_bytes`, `interior_bytes`, `bytes_per_ref_iter`, `build_s`)
and, per model, `mean_steps` (delta steps per pixel, a skip counting one), `ptb_steps`
and `bla_steps` (its two kinds), `skipped` (iterations the skips covered) and `reads`
(table entries the lookups read). `--eps` is the tolerance (default `2^-24`),
`--min-level` and `--max-level` the stored levels (default 4 and 24).

`cargo test --release` runs the tests in seconds; they are what CI runs.

## What the first measurements say

On well-conditioned frames the model agrees with `perturb` to a median of `1e-6` or
better and at least 99% of samples within 0.1 of a smooth count, and that includes Julia
sets anchored at `z = 0` down to `1e-45`. Most of the Deep tab's dives are not well
conditioned: their fields move as soon as the `f64` kernel's reference is rounded to `f32`
with nothing else changed, and the model's disagreement is of that size
(`tests/agreement.rs` has each frame's numbers). Where that floor changes no sample's
class, the model changes none either, opened minibrots at `1e-40` included. Whether the
differences are visible is a separate question from their size; the measurements take
it up.

On this machine the model costs about 1.4 to 2.2 times `perturb`'s `f64` kernel per
step on the CPU (10.5 ns against 4.9 on an unscaled degree-two dive, 26 against 18 on
the corpus's deepest frame, one thread). That is the price of the quick path's gate and
says nothing about a GPU.
