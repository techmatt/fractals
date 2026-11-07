# deep-gpu-model

A native Rust model of the WebGPU kernel that draws the Deep tab's passes on the GPU, and
that kernel's oracle. It restates `perturb`'s perturbation kernel
(`fractal-wallpapers/perturbation`, taken by path and named `perturb` in `Cargo.toml`) in
the only types WGSL has, runs it natively, and measures it against `perturb`'s `f64` kernel
sample for sample. `perturb` is also its library for the reference orbit.

How it relates to the page:

- **The shader is `explorer/deep-gpu-wgsl.js`**: the model's double-single loop, interior
  proof, and skip lookup, ported line for line. `explorer/deep-gpu.js` runs it under the
  `handoff` policy, builds the orbit's exact points (`hiLoOrbit`) as the model does, and
  builds the skip table with `explorer/deep-gpu-bla.js`, held byte for byte to the tables
  `export --bla on` writes.
- **The page reaches this crate only through bytes it exported.** Nothing here is compiled
  into the page; the self-test the page runs before the GPU may draw
  (`explorer/deep-gpu-selftest/`) is this model's output, word for word.
- The page ships only the double-single kernel; the `f32` kernel is the baseline.

## What is where

```
src/lib.rs          the crate's contract: the arithmetic rules and a map of the modules
src/wgsl.rs         the WGSL builtins and bit idioms the loop uses, one function each
src/orbit.rs        the orbit as a GPU buffer (F32Pair or HiLo), its flush term, exact points
src/frame.rs        per-frame uniforms (Frame, FrameLo), dc per pixel, the gated policy
src/model.rs        the per-pixel state struct and the bounded-step f32 loop
src/ds.rs           double-single arithmetic: hi + lo f32, about 48 bits
src/model_ds.rs     model.rs's loop with the delta, the reference, and dc in double-single
src/survivors.rs    f32 first, double-single from the start past a step threshold
src/bla.rs          the skip table: built in f64, stored as the GPU holds it, read in f32
src/proof.rs        perturb's interior proof in f32, i32, and u32, behind both kernels' gate
src/compare.rs      the harness: both kernels on one frame, and how they agree
src/json.rs         just enough JSON to read a corpus row
src/bin/compare.rs  the harness as a command, one JSON line per frame
src/bin/export.rs   the page's inputs: self-test vectors and per-frame bundles
tests/              agreement, bla, ds, interior, deep_interior (see Testing)
```

The module docstrings hold the mechanics: `src/model.rs` the scaling scheme, the quick and
careful steps, and the contractible sites; `src/bla.rs` the table's derivation, guards, and
layout; `src/orbit.rs` the flush term; `src/proof.rs` the proof's margins.

## The arithmetic rules

The per-pixel path (`model::init`, `model::pass`, what they call, `Frame::dc_mantissa`)
keeps to what WGSL can express; `src/lib.rs` states the same.

- **`f32`, `i32`, and `u32` only.** `f64` is CPU-side setup alone: narrowing the orbit,
  the frame's constants, building the skip table, and the harness.
- **No fused multiply-add**, every operation in `perturb`'s order. WGSL cannot forbid a
  backend from contracting `a * b + c`, so bit identity is a claim the model makes about
  itself (passes of any budget leave the same state); the shipped shader is held to it
  word for word with `frac` excepted.
- **No infinity or NaN is ever read**: every test that could meet one is decided on an
  integer exponent or a finite compare first.
- **No reliance on an order the compiler could reassociate**, with one flagged exception:
  the reference sums `hi + (lo + δ)`, marked `REASSOCIATION HAZARD`. Rewritten as
  `(hi + lo) + δ` they silently turn HiLo into F32Pair.
- **Powers of two go through `wgsl::ldexp_exact`**, integer arithmetic on the exponent
  field. A subnormal result is a signed zero, the same on any GPU, and the orbit and frame
  constants are stored without subnormals.

## The model in brief

- **The delta is `d · 2^s`**: an `f32` complex mantissa and an `i32` exponent per pixel,
  scaled below `2^SCALE_BELOW` (`model.rs`). A quick step is `perturb`'s in the delta's
  units; a careful step takes a reference point near zero (a nucleus, `Z[0]` after a
  rebase or wrap, a Julia frame anchored at `z = 0`) by rescaling `Z` and `δ` to about 1.
- **`dc` is formed as a GPU would**: offset and spacing as `f32` mantissas against one
  exponent, and each pixel's offset from its integer column and row.
- **Two orbit encodings**: F32Pair (8 bytes a point) and HiLo (16).
- **The count is a `u32` and the smooth fraction a separate `f32`.**
- **Bounded steps per pass.** Per-pixel state is one `#[repr(C)]` struct laid out as WGSL
  lays it: `model.rs`'s `STATE_BYTES` and `model_ds.rs`'s `DS_STATE_BYTES`, each including
  `proof.rs`'s `PROOF_BYTES`. A pass advances at most a given number of steps, and the
  result is bit-identical whatever that number is, a proof in flight included.
- **The interior switch is a gate, then a proof**, as `perturb`'s is; the proof also
  carries each step's rounding in the disc's radius. It is sound and incomplete, so a
  sample it never settles follows the frame's `GatedPolicy`: `cap` (paint it capped, as
  `perturb` does; the default), `flag` (run to the cap, hand it back `GATED`), or `handoff`
  (hand it back as soon as the proof gives up; the Deep tab's).
- **Degrees two to six, and both Julia anchors**, all of what `perturb` draws.

## Iteration skipping

A switch, off by default: `model::pass_bla` takes a `bla::GpuTable`. The shipped kernel
uses the double-single table (Matt reopened BLA for the GPU path alone); `perturb` has
none, because it moved the picture at every tolerance it paid at. Here `f32` already moves
the picture, so the bar is agreement with `perturb` no worse than without the switch.

- **Switched off, nothing moves**: `tests/bla.rs` holds every pixel's final state to hashes
  taken before the switch existed, with and without an empty table (whole on Windows;
  elsewhere all but `frac`, which comes from the C runtime's `logf`).
- **Built on the CPU in `f64`** from `perturb`'s orbit, with the removed CPU table's merge
  rule, guards, level layout, and aligned bottom-up lookup; `bla::hypot64` keeps a
  platform's `libm` and a browser's `Math.hypot` from rounding a radius apart. Periodic
  references are built over the cycle, and no run crosses the wrap.
- **Stored as the GPU holds it**: `bla.rs`'s `ENTRY_BYTES`, `INTERIOR_BYTES` (bound only
  with the interior switch on), `LO_BYTES` (double-single low halves), and `HEADER_BYTES`.
  Under WebGPU's default 128 MiB a binding the orbit, not the table, is the ceiling.
- **A skip is one delta step, never split**, so bounded passes stay bit-identical.
  `BlaStats` is a buffer of its own, so `PixelState` is unchanged with the skip on.
- **A gated sample does not skip while its proof carries discs.**
- **Defaults** are `bla.rs`'s `EPSILON_DEFAULT` (`2^-24`), `EPSILON_DS_DEFAULT` (`2^-48`),
  `MIN_LEVEL_DEFAULT`, and `MAX_LEVEL_DEFAULT`; `--eps`, `--ds-eps`, `--min-level`, and
  `--max-level` override them.
- **Long orbits stay on double-single**: no test read off the reference alone chooses `f32`
  with the skip safely. A later candidate is an a-posteriori check (probe pixels both ways).

## Double-single, and survivors

`model_ds` carries the delta as `hi + lo` pairs, reads the reference from `HiLo` (it
refuses `F32Pair`), and forms `dc` with a second uniform, `FrameLo`. Every decision is read
off the high parts (`src/model_ds.rs` says where); the proof reads the whole pair. Its skip
uses the low-half buffer at `--ds-eps` (`bla.rs`'s `apply_ds`). `survivors` runs `f32` until
a pixel stops or reaches a threshold and redoes what is still running in double-single.

## Running a comparison

```
cd explorer/deep-gpu-model && cargo build --release
target/release/compare --corpus frames.jsonl [--ids a,b] [--res 160x90] [--encoding ...]
target/release/compare --re X --im Y --w W [--n CAP] [--deg D] [--jre A --jim B] ...
```

`compare --help` (`src/bin/compare.rs`'s `USAGE`) is the full contract: the corpus row
schema, one JSON line per frame, the schemes (`f32pair`, `hilo`, `ds`, `survivors@N`, each
`+bla`), and `--dump`'s files. **Floors** measure how far `perturb` moves against itself,
so a disagreement is not blamed on `f32` when `f64` moves as much: `--floor rounded` is
`perturb` on the reference rounded to `f32`, `--floor moved` on a second reference
`--move` samples away (on a Julia plane, the other anchor, which is no real floor deep).
Long runs saturate the CPU: run them at below-normal priority, with corpora and outputs
under the ignored `scratch/` or `artifacts/`.

### Exporting for the GPU bench page

`export --help` has every flag. `--vectors FILE` writes `ds::self_test_vectors()`;
`--frames FILE --ids a,b --out DIR` writes per frame `<id>.manifest.json` and `<id>.bin`
(uniforms, both orbits, each kernel's per-pixel results and whole state, `perturb`'s
values) and an `index.json`. Frames are built by `compare::spec_for`, and every bundle is
re-run from its written bytes (`--verify`). `--interior on` and `--interior-policy` set the
proof; `--bla on` adds the double-single table as the page binds it; `--slim on` writes
only what a device test reads; `--ftz-check on` (x86-64 only) reruns with subnormals
flushed and records how many pixels move, since a flushing GPU (D3D12) matches that run.

Three readers:

- **The self-test**, tracked: `node explorer/deep-gpu-selftest/export.mjs` writes the
  vectors and one slim bundle per entry of its `FRAMES`, refuses a frame flushing moves,
  and rewrites nothing for an unchanged model. ⚠ A change to the model's per-pixel results
  owes this rerun and the matching port in `explorer/deep-gpu-wgsl.js`, or the page's
  self-test fails and the GPU stays off.
- **The kernel check**, `explorer/bench/gpu-probe/kernel-check.html` (headless:
  `explorer/bench/deep-gpu-check.mjs`): the shipped kernel against the self-test, then
  against bundles `export --interior on` wrote under the ignored `artifacts/deep-gpu-check/`.
- **The probe**, `explorer/bench/gpu-probe/index.html`: rates and agreement on bundles.

### The visible metric

A pixel is visible when its largest RGB channel moves by more than 8/255 and by more than
its own contrast with its four neighbors in the reference picture (inside aliased speckle a
change only swaps one speckle value for another). A frame **matches** at 1% visible or less
and is **acceptable as a preview** at 5% or less: `explorer/bench/visible.mjs`'s `MATCH` and
`ACCEPTABLE`, which applies it to canvases. The lines were set by eye, and the share is not
resolution-free: it rises with resolution, so a small-grid share overstates what matches.
The contrast term can hide a class change on a stripe's edge; there, read the share past
24/255. To color dumped fields, use `deep-render.js`'s `shadeSpecOf`, take the `f64`
field's `shade_stats`, and color every field with `shade_band` under the same spec and
statistics, so a color difference is a field difference.

## Double-single as measured

Double-single, not plain `f32`, is what ships. On the site's Deep frames `f32` matches
`f64` on only about half, mostly from storing the reference in `f32` on ill-conditioned
frames (the `f64` kernel on a rounded reference fails much the same ones); HiLo with an
`f32` delta buys nothing. Double-single matches nearly every frame, and those it misses sit
at `f64`'s own moved-reference floor. Survivors save less than their op count says, and a
frame-relative threshold can miss a frame whose counts are uniform.

### Deep interior

A deep minibrot's reference returns far below `2^-126`, so narrowing stores those points as
zero, and the proof must not read that zero as exact:

- **The flush term is measured** (`src/orbit.rs`): `flush = -(e + 2)`, at least 125, from
  the largest exponent narrowing stored as zero; one `i32` uniform per encoding (`flush`,
  `flush_hilo`), added as `2^-flush` to the proof's radii and margins.
- **A stored zero is read in the delta's units** (`model::reads_scaled`) and is **no size
  in the careful step** (`model::careful_unit`), in both kernels.
- **Exact points** (`GpuOrbit`'s `exact`, `HiLo` only, where anything flushed): each point
  narrowing flushed is kept at its own scale. The careful step and the scaled reconstruction
  and rebase read it, so a return reaches the proof at its true size, and the flush term is
  charged only to an iterate formed off a stored flushed point (`Iterate::read_from`,
  `Proof::rebased`).

**Where this stops.** The `f32` kernel has no exact points, so its flush term stays one
number for the frame, and a disc smaller than it waits for the cap (or goes back to the
CPU under `handoff`). The shipped double-single kernel on `HiLo` does not stop there.

The WGSL port's `sqrt_rn` corrects WGSL's not-correctly-rounded `sqrt` where the proof
takes a root, which bit identity needs; soundness rests on `UP_SQRT`.

## Testing

`cargo test --release` and `cargo fmt --check` here are among `CLAUDE.md`'s checks and CI's.
Each test file's header states its ruling, and each test its margins:

- `agreement.rs`: well-conditioned frames agree within 0.1 of a smooth count on 99% of
  samples with no class change; ill-conditioned ones are held to a bound on `perturb`'s own
  disagreement with an `f32`-rounded reference.
- `bla.rs`: the switch-off hashes, bit-identical passes, runs walked through the exact
  recurrence at every degree, guards, and agreement no worse than without the skip.
- `ds.rs`: double-single passes, agreement, survivors, and the skip in double-single.
- `interior.rs`: no escaping sample is painted interior, in either kernel.
- `deep_interior.rs`: the D frames (a degree-3, period-311 nucleus) close every sample at
  `perturb`'s step count down to the deepest link, and a boundary frame with a flushing
  orbit escapes exactly where `perturb` does.
