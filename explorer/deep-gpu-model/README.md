# deep-gpu-model

A native Rust model of the WebGPU kernel the Deep tab would use as a fast preview, and,
once that shader exists, its oracle. It restates `perturb`'s perturbation kernel
(`explorer/perturb-wasm`) in the only types WGSL has, runs it natively, and measures it
against `perturb`'s own `f64` kernel sample for sample. Nothing here is on the page: the
shipped Deep path, its wasm, its links, and its pictures are untouched by this crate, which
uses `perturb` as a library for the reference orbit and for the kernel it is compared with.

This README is provisional. The measured precision frontier, the iteration-skipping
switch, and what a GPU would hold per frame come with the measurements.

## What is where

```
Cargo.toml          one dependency, perturb, by path; no others
src/wgsl.rs         the WGSL builtins and bit idioms the loop uses, one function each
src/orbit.rs        the reference orbit as a GPU buffer: F32Pair or HiLo
src/frame.rs        per-frame constants, and dc formed per pixel from its column and row
src/model.rs        the per-pixel state struct and the bounded-step loop
src/compare.rs      the harness: both kernels on one frame, and how they agree
src/json.rs         just enough JSON to read a corpus row
src/bin/compare.rs  the harness as a command, one JSON line per frame
tests/agreement.rs  the model against perturb on frames the site draws
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

## Running a comparison

```
cd explorer/deep-gpu-model
cargo build --release
target/release/compare --corpus frames.jsonl [--ids a,b] [--res 160x90] [--cap N]
    [--cap-max N] [--encoding f32pair|hilo|both] [--interior on|off] [--threads N]
    [--budget N] [--floor on] [--dump DIR] [--out FILE]
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
