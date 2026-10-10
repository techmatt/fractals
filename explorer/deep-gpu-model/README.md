# deep-gpu-model

A native Rust model of the WebGPU kernel the Deep tab would use as a fast preview, and,
once that shader exists, its oracle. It restates `perturb`'s perturbation kernel
(`explorer/perturb-wasm`) in the only types WGSL has, runs it natively, and measures it
against `perturb`'s own `f64` kernel sample for sample. Nothing here is on the page: the
shipped Deep path, its wasm, its links, and its pictures are untouched by this crate, which
uses `perturb` as a library for the reference orbit and for the kernel it is compared with.

**The frontier, as measured** (the runs and the numbers are under "The frontier as
measured", below): on the site's Deep frames `f32` shows no depth limit, though the deep
end is thin (17 frames past 1e-20, one past 1e-30, at 8.7e-42); what tracks its failures
is the escape count. It matches `f64` (at most 1% of pixels visibly different, at 64x36)
on most frames whose mean count is under about 3,000, and it is a usable preview (at most
5%) on 99.7% of the corpus. Past a mean count of 1e5 there are five frames, too few to
read. Most of the disagreement is the cost of storing the reference in `f32` on an
ill-conditioned frame, not noise `f64` shares: `f64` on a second reference of its own
matches on 99.8% of Mandelbrot frames, `f64` on the reference rounded to `f32` on 62%, and
the model on 55%.

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
- **The interior switch** is `perturb`'s as it was before interior_switch_fix_ckpt162,
  with `|dz|²` as a mantissa in `[1, 2)` and an `i32` exponent, and `|z|²` formed from a
  rescaled `z` wherever it would underflow. It is a frame flag, because long-orbit frames
  must run with it off. ⚠ **That rule is unsound beside a parabolic point**, and `perturb`
  now uses it only as a gate in front of a proof (its README's §3): here it is still the
  verdict, so a WGSL kernel written against this model owes the same proof.
- **Degrees two to six, and both Julia anchors**, all of what `perturb` draws.

## Iteration skipping

A switch, off by default: `model::pass` is the model without it, and `model::pass_bla`
takes a `bla::GpuTable`. **The shipped kernel has no skip table**, and nothing here
changes that; `perturb` removed its own (`5fa1515a`, `b84e7e5d`, `394056b2`) because it
moved the picture at every tolerance it paid at, which an `f64` kernel holding itself to
"draws what the engine draws" could not accept. On this path `f32` already moves the
picture by its own rounding, so the bar is the model with the switch on agreeing with
`perturb` no worse than with it off.

- **Switched off, nothing moved.** `tests/bla.rs` holds every field of every pixel's
  final state, on seven frames and both encodings, to hashes taken from the
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
  binding the orbit, not the table, is the ceiling**: 16.8M points as `F32Pair`, 8.4M as
  `HiLo`, where the default table runs to 33.6M (16.8M at `min_level` 3, 8.4M at 2). So
  the `HiLo` long-orbit frames at 1e7 and the 2e7 Feigenbaum frame in either encoding
  would need the orbit split across bindings or a raised limit.
- **The lookup and the skip are `f32`, `i32`, and `u32`.** The lookup runs only where
  `(m − 1) mod 2^min_level == 0`, an integer test with no read; there it compares `|d|²`
  split into a mantissa and an exponent against the stored radius exponent first, so it
  works in the scaled regime without forming `|δ|²`. The skip forms `A·d` and `B·dc_m` as
  mantissa products, adds them at the larger exponent the way the careful step adds its
  product to `dc`, and settles the sum into the state's form.
- **A skip is one delta step, and is never split**: the budget counts delta steps, and
  passes of any budget leave the state and the counters one unbounded pass does
  (`tests/bla.rs`, on seven frames that skip). `BlaStats` is a 20-byte buffer of its
  own: four measurement counters (skips, iterations skipped, entries read, and lookups
  that read any) and `hint`, the last skip's level, which is lookup state that
  `--search hint` starts from. So `PixelState` is the same 48 bytes with the switch on.
- **The table is built on the CPU before the GPU runs**, serially, at about 49 ns a
  reference point, and no step count in this file includes it. On the corpus it took
  201 s in all (0.086 s a frame, 0.57 s at most) against 1,421 s of `F32Pair` model time
  with the skip and 1,654 s without, so on the CPU the skip and its build together are
  only 2% faster than no skip. On the long orbits the build is as large as the skipped
  run or larger (the degree-2 main cusp at 2e7: 0.82 s against 0.40 s; degree 3 at 8e6:
  0.38 s against 0.24 s).
- **Tolerance and levels are run-time parameters** (`BlaOptions`, `--eps`,
  `--min-level`, `--max-level`), defaulting to `2^-24`, 4, and 24.

What it buys, first numbers (64x36, `F32Pair`, `ε = 2^-24`; delta steps per pixel off
-> on, the table's build not counted, and agreement with `perturb` off -> on as the share
of samples more than 0.1 apart):

| frame | width, degree | cap | steps off -> on | reads on | over 0.1 off -> on | class changes |
|---|---|--:|---|--:|---|---|
| main cusp, interior off | 4e-19, 2 | 2e7 | 15,703,126 -> 29,581 | 2,089 | 60.9% -> 1.5% | 98 -> 0 |
| copy cusp p2209, interior off | 8.8e-23, 4 | 1e7 | 7,794,155 -> 149,630 | 128,482 | 99.8% -> 92.0% | 25 -> 4 |
| Feigenbaum point, interior off | 1e-12, 2 | 1.2e7 | 5,941,671 -> 1,419,326 | 511,184 | 100% -> 100% | 18 -> 12 |
| `random-dives#501` | 8.7e-42, 5 | 1,471,930 | 6,211 -> 903 | 159 | 20.6% -> 14.2% | 0 -> 0 |
| `deep-gallery#30` | 1.9e-21, 6 | 88,485 | 3,076 -> 1,617 | 209 | 35.1% -> 31.3% | 0 -> 0 |
| `tangle-1e-54` | 1e-54, 2 | 221,162 | 215,646 -> 22,681 | 2,498 | 89.5% -> 74.9% | 328 -> 179 |

The long-orbit frames are a hand-built set that need millions of iterations (cusps, copy
cusps, the seahorse gate, the Feigenbaum point, and the imploded Julia set), kept with
the corpus under the ignored `scratch/gpu-model/` (`longorbit.jsonl`). On the main cusp
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
`2^-28`, `2^-30`, and `1e-10` the mean share is 42.9%, 43.2%, 43.4%, and 43.7%, steps are
0.82, 0.86, 0.90, and 0.94 of without, and 4, 3, 3, and 1 frames still rise by more than
two points, not always the same ones. So `2^-24` stays the default at every degree;
degree-six Mandelbrot frames (19 of them) average +0.3 points at it, +0.15 at `2^-28`.

On shallow frames it buys nothing at this tolerance: a merged radius has to clear
`|B|·dcmax`, so long runs begin only where `ε` is about `2e10` times the frame's
half-diagonal (the removed table's law, which these numbers keep). Frames at `3e-3`,
`4e-4`, `7e-7`, and the home view keep every step, at one entry read per 7 to 16 steps,
and one at `7.3e-9` saves 2%. `ε` above `2^-24` and other levels were not swept across the
corpus; every number below is at the defaults.

## Running a comparison

```
cd explorer/deep-gpu-model
cargo build --release
target/release/compare --corpus frames.jsonl [--ids a,b] [--skip N] [--take N]
    [--res 160x90] [--cap N | --caps N,N,..] [--cap-max N]
    [--encoding f32pair|hilo|both] [--interior on|off] [--threads N] [--budget N]
    [--floor off|on|rounded|moved|both] [--move DX,DY] [--dump DIR] [--out FILE]
    [--bla off|on|both] [--eps E] [--min-level K] [--max-level K]
    [--search bottom-up|hint[,hint]] [--gate off|on|both]
target/release/compare --re X --im Y --w W [--n CAP] [--deg D] [--jre A --jim B]
    [--anchor origin] [--period P] [--id NAME] ...
target/release/compare --help
```

`--help` is the full contract. A corpus row is `{id, re, im, w, n, degree, julia_re,
julia_im, anchor, period, link}`, with the coordinates as decimal strings. Each frame prints
one JSON line: the `f64` kernel's escape count, mean iterations, rebases, and wall time, and
per encoding the model's class counts, how many samples change class, the distribution of
`|Δ smooth|` over the samples both kernels escape at (p50, p90, p99, max, the shares above
0.01, 0.1, 1, and 10, and a finer `ladder` of shares from 0.001 to 1000), the same split by
the decade of `perturb`'s count (`by_iter`), delta steps per pixel (mean, p50, p99, max),
the share of steps taken scaled, rebases, and wall time. `--caps` runs each frame once per
cap, one line each.

Two floors measure how far `perturb` moves against itself, so that a disagreement is not
blamed on `f32` when `f64` moves that much too. `--floor rounded` (or `on`) is the `f64`
kernel on the reference rounded to `f32`: what storing the reference in `f32` costs on its
own. `--floor moved` is the `f64` kernel on a second reference, the view center moved by
`--move` samples (default 1.5 across, 1 up) and formed in `perturb`'s fixed point, or on a
Julia plane, whose orbit `c` fixes, the other anchor: a real second opinion, and on
chaotic long orbits `f64` is not noise-free. `both` runs the two.

`--dump DIR` writes per-sample fields as little-endian binaries, `NaN` interior:
`<base>.f64.bin` for `perturb`, `.f64rounded.bin` and `.f64moved.bin` for the floors,
`<base>.<encoding>[_bla].bin` (`f64` `n + frac`) and `.f32.bin` for the model,
`<base>.iter.bin` with `perturb`'s counts as `u32`, and `<base>.meta.json` naming the
frame, its link, its grid, its cap, and the fields written. `<base>` is the id, with the
cap appended under `--caps`.

`--bla on` runs the model with the skip table, `both` without and then with it (keyed
`<encoding>+bla`); the `f64` kernel never has one. The line then carries the table
(`entries`, `valid`, `entry_bytes`, `interior_bytes`, `bytes_per_ref_iter`, `build_s`)
and, per model, `mean_steps` (delta steps per pixel, a skip counting one), `ptb_steps`
and `bla_steps` (its two kinds), `skipped` (iterations the skips covered) and `reads`
(table entries the lookups read: mean, `p99_reads`, `max_reads`), `probes` (lookups that
read any), and `field_hash` (FNV-1a over every sample's count, status, steps, and skipped
iterations). `--eps` is the tolerance (default `2^-24`), `--min-level` and `--max-level`
the stored levels (default 4 and 24).

Two lookup switches change the entries read and never the run found, so the field is the
same bit for bit (`field_hash`, and `tests/bla.rs`). `--search hint` starts each lookup at
the level of the pixel's last skip rather than the lowest; `--gate on` first compares `|δ|`
with each level's largest radius, which the table header carries, and reads nothing on a
level that refuses the pixel. A list of orders, or `--gate both`, runs each variant on one
`f64` pass, keyed `<encoding>+bla:hint`, `<encoding>+bla+gate`, and so on. Both default off;
`src/bla.rs` has what they were measured to save.

`cargo test --release` runs the tests in seconds; they are what CI runs.

### The runs behind the frontier

Long runs saturate the CPU; on this machine they ran at BelowNormal priority. The corpus
is one JSON row per frame in the shape above; the measurements used 2,333 unique Deep
frames gathered from the site's dives, pack, figures, and picks, deduplicated on center,
width, degree, Julia constant, anchor, and period, and kept under the ignored
`scratch/gpu-model/` with everything else below.

```
# one frame: a long-orbit Multibrot (random-dives#71) at its own cap
target/release/compare --re 0.634481652454404109426 --im 0.397772080270897977848 \
    --w 4.211064439505697e-13 --n 1461841 --deg 4 --res 64x36 --bla both --floor both

# run A, the corpus: own caps, interior on, everything, dumped
target/release/compare --corpus shard.jsonl --res 64x36 --encoding both --bla both \
    --floor both --threads 1 --dump runA/dump --out runA/shard.out.jsonl

# run C, a cap ladder on a long orbit: interior off on both kernels
target/release/compare --corpus longorbit.jsonl --ids longorbit-cusp-main-d2 --res 64x36 \
    --caps 1e4,3e4,1e5,3e5,1e6,3e6,1e7,2e7 --encoding f32pair --interior off \
    --bla both --floor moved --out ladder.jsonl
```

Run A was the corpus in seven round-robin shards of one thread each, 26.5 minutes in all.
Long orbits run with the interior switch off on both kernels: the switch as it shipped
then falsely proved the degree-2 main cusp and the imploded Julia set interior, and with it
on a comparison measures the switch rather than `f32`. `perturb`'s is sound since
interior_switch_fix_ckpt162; this model's is not.

### The visible metric

The numbers above say how far a field moves; whether a reader sees it is the coloring's
question, and that step lives outside the crate. `scratch/gpu-model/tools/colour.mjs` is
untracked scratch, run from the repository root:

```
node scratch/gpu-model/tools/colour.mjs --dir runA/dump --modes default,rule,link \
    --out runA/colour.jsonl [--png DIR --scale K --diff on]
```

To rebuild the equivalent: load the committed `engine.wasm` and `perturb.wasm` as the node
suites do (`explorer/bench/engine.mjs`), build each frame's spec with `deep-render.js`'s
`shadeSpecOf`, and choose the coloring on the `f64` field. Take that field's frame
statistics from `shade_stats` and color every other dumped field with `shade_band` under
the same spec and the same statistics, so a color difference is a field difference and
nothing else. Check the `f64` image against `shade_level`'s byte for byte; it matched on
every frame measured. Three colorings were run: default (`twilight_shifted`, default shade
keys, no level curve, as a link without color keys opens), rule (`coloring_rule` as New
coloring lands on a dive, with the palette, picks, and phase fixed instead of drawn), and
link (the row's own keys).

A pixel is visible when its largest RGB channel moves by more than 8/255 and by more than
its own contrast with its four neighbors in the `f64` picture. The contrast term is there
because inside aliased speckle a change swaps one speckle value for another, and frames at
1.2% and 3.5% by this measure looked like the same picture side by side. A frame
**matches** at 1% visible or less, is **acceptable as a preview** at 5% or less, and is
**different** past that. Those two lines were set by eye on two or three frames. The
measure is not resolution-free: on the 30 frames drawn again at 640x360 it agreed with run
A's 64x36 within about a point on every frame but one, but rose on 26 of them, and all
seven frames between 0.7% and 1% at 64x36 crossed 1% at 640x360 (`dive-sheet:u0391`
1.00% -> 1.46%, `u0719` 0.83% -> 1.85%). Two of the three between 4% and 5% crossed 5%
as well (`u0604` 4.56% -> 5.82%, `random-dives#245` 4.99% -> 5.38%). So the shares below,
all taken at 64x36, overstate what matches at a real preview's resolution, by a margin
not measured across the corpus. (Three frames run at 320x180 gave the same shares as at
64x36.) Two further cautions: a stricter rule (over 1% of pixels past 24/255) collapses
the 1% to 5% band into different at 64x36 and calls 39% of frames different, and the contrast term hides a
class change that lands on a stripe's edge, so on a channel frame read the raw share past
24/255 instead.

## The frontier as measured

All from runs at 64x36, one sample a pixel, `ε = 2^-24`, min level 4, unless a line says
otherwise; the reports and raw lines are under `scratch/gpu-model/` (`q1.md`, `q2q3.md`,
`q4.md`, `runA/`, `q2/`, `sheets/`).

### Where f32 stops matching f64

Run A, 2,333 frames (1,808 Mandelbrot or Multibrot of degree two to six, 525 Julia), widths
0.8 to 8.7e-42, caps 1e3 to 2e6, default coloring. Share of frames that match, by mean
`f64` escape count:

| mean count | frames | F32Pair | F32Pair + skip | HiLo | `f64`, rounded ref. | `f64`, moved ref. |
|---|--:|--:|--:|--:|--:|--:|
| under 1e2 | 29 | 100% | 100% | 100% | 100% | 100% of 25 |
| 1e2 to 3e2 | 148 | 89% | 89% | 91% | 92% | 100% of 148 |
| 3e2 to 1e3 | 166 | 81% | 81% | 81% | 84% | 100% of 163 |
| 1e3 to 3e3 | 205 | 75% | 77% | 74% | 80% | 100% of 176 |
| 3e3 to 1e4 | 1,035 | 48% | 53% | 48% | 54% | 100% of 758 |
| 1e4 to 3e4 | 652 | 47% | 52% | 50% | 58% | 100% of 464 |
| 3e4 to 1e5 | 93 | 35% | 42% | 37% | 44% | 100% of 70 |
| 1e5 and over | 5 | 40% | 40% | 40% | 60% | 50% of 4 |

The moved-reference column counts the Mandelbrot frames alone (below). The last row is
five frames and says nothing either way: two of them (`random-dives#808` at 8.9% visible,
`#571` at 7.5%) are over 5% under F32Pair, and the `f64` kernel moves both on a second
reference of its own too (2.0% and 1.4%), so whether `f32` degrades past 1e5 or the frames
are simply sensitive there is not something these runs can say.

- **Depth is not the axis, and lower counts do not explain why the deep frames do well.**
  Frames deeper than 1e-17 match more often (63% from 1e-17 to 1e-20, 71% past it; 92
  frames together) than frames at 1e-10 to 1e-17 (50% of 1,752), at a median count only a
  little lower (6,574 against 7,803). Inside one count band the deepest frames still match
  most: at 3e3 to 1e4 the shares at 1e-8 to 1e-12, 1e-12 to 1e-15, 1e-15 to 1e-18, and
  past 1e-18 are 51%, 47%, 43%, and 62%; at 1e4 to 3e4 they are 49%, 48%, 32%, and 70%.
  Depth moves the share by 20 points or more within a band, falling to 1e-18 and rising
  past it, on 10 to 30 frames in the deepest cell. What makes the deepest frames easier
  was not measured. `random-dives#501` at 8.7e-42 is 1.08% visible.
- **Over 5% is rare**: 7 frames (0.3%), every one with a mean count of 3e3 or more.
- **The `f64` floor, and what the rounded reference is.** The `f64` kernel on a second
  reference (moved by 1.5 and 1 samples) is the floor: it matches on 99.8% of Mandelbrot
  frames at a median of 0.00% visible, and fails on 3, two of them the frames at 1e5 and
  over above. The `f64` kernel on the reference rounded to `f32` is not a floor: storing
  the reference in `f32` is one of the model's own error sources, measured there alone. It
  matches 62% at a median of 0.83% visible, against F32Pair's 55% and 0.95%, and per frame
  F32Pair is p50 +0.09 and p90 +0.44 points above it. In samples more than 0.1 off the
  three stand at 1.7% (moved, Mandelbrot), 42.0% (rounded), and 44.7% (F32Pair). So most
  of the disagreement is what the `f32` reference costs on an ill-conditioned frame, which
  the `f64` kernel does not share on a reference of its own. Of the 1,044 F32Pair frames
  that do not match, 787 also fail on the rounded reference (the 3 that fail on the moved
  one among them) and 257 fail on neither, at 1.2% median and 2.0% at most; 75 of those
  257 are Julia frames, which have no moved floor, so for them only the rounded reference
  passed.
- **There is no `f64` floor for Julia frames yet.** `--floor moved` swaps a Julia frame's
  anchor, and at the origin `f64` cannot resolve a deep frame's spacing (45% to 65% visible
  past 1e-15), so the floor above is Mandelbrot only. A real one would move the
  parameter-anchored reference by samples.
- **HiLo buys nothing that matters**: 55.9% match against F32Pair's 55.3%, within 3 points
  in every bin, and 9 frames over 5% against 7. The delta arithmetic perturbs at `2^-24`
  anyway.
- **Coloring matters as much as precision.** Matching under default, rule, and link
  coloring: 55.3%, 50.5%, and 23.2%; over 5%: 0.3%, 0.9%, and 2.1%. Under link coloring the
  rounded reference alone is at 30% matching too: those maps magnify the same error.
- **Degree four and up fail more**: Mandelbrot frames match 65%, 68%, 57%, 48%, and 23% at
  degrees two to six, Julia frames 70%, 74%, 37%, 31%, and 13%. Degree three is no worse
  than degree two.

### What the skip buys at millions of iterations

Run C, F32Pair, interior off on both kernels; delta steps per pixel at the top cap (the
table's build, serial CPU work before the GPU runs, is not counted; see "Iteration
skipping" above):

| frame | cap | without the skip | with it | cut |
|---|--:|--:|--:|--:|
| main cusp, degree 2 (4e-19) | 2e7 | 15,703,126 | 29,581 | 531x |
| main cusp, degree 3 (1.7e-18) | 8e6 | 5,791,668 | 17,262 | 336x |
| seahorse gate (4e-13) | 2e7 | 16,538,649 | 259,781 | 64x |
| imploded Julia set, degree 2 | 2e7 | 4,489,848 | 31,181 | 144x |
| copy cusp p2209, degree 4 (8.8e-23) | 1e7 | 7,794,155 | 149,630 | 52x |
| copy cusp p36100, degree 2 (7.3e-29) | 1.2e7 | 8,846,484 | 140,556 | 63x |
| Feigenbaum point (1e-13) | 2e7 | 11,445,852 | 1,357,582 | 8.4x |
| `random-dives#71` (4.2e-13, degree 4), interior on | 1,461,841 | 5,234 | 4,551 | 1.15x |

- **Below their escape counts** the main cusps and the seahorse gate reach any cap in 20
  to 27 steps. The imploded Julia set settles at 7,000 to 8,800 steps a pixel whatever the
  cap. The copy cusps stay near 1% of the cap, since the runs end once a period where
  `|Z|` nears zero. At the Feigenbaum point the cut falls as the cap rises, from 9x to 28x
  at 1e4 to 4x to 8x at the top.
- **The site's own million-cap frames do not need their caps**: their counts end near 1e4
  to 1e5 and the cut is 1.1x to 2.4x, with 13x on `random-dives#883` and 6.9x on `#501`.
- **The slowest pixel**: the seahorse gate's mean is 260k steps and its worst 9.67M, which
  is what bounded passes are for.
- **Agreement with it on.** On the main cusps the skip repairs `f32`: the degree-2 cusp's
  share more than 0.1 off goes from 60.9% to 1.5% and its class changes from 98 to 0. On
  the copy cusps it cuts the median `|Δ smooth|` 6x (p2209, 156 to 24) and 15x (p36100,
  14,700 to 985), and at the Feigenbaum point 1.9x and 3.4x (1e-12 and 1e-13), but what
  remains is 10^4 (Feigenbaum) to 10^8 (copy cusps) times the `f64` kernel's own median
  movement on a second reference, and the share more than 0.1 off barely moves: 92% and
  99.8% on the copy cusps and 100% at Feigenbaum, against 4%, 17%, 60%, and 78% for `f64`
  on a second reference. HiLo with the skip ties F32Pair with it except on the seahorse
  gate (2.6% to 0.4% over 0.1).
- **Table memory**: 4.0 bytes per reference iteration, 6.0 with the interior buffer. The
  largest, Feigenbaum at 2e7, is 76 MiB plus 38 MiB, and every table fits one 128 MiB
  binding.
- **Reads**: 1.3k to 16.5k entries per pixel on the channel frames, 128k to 170k on the
  copy cusps, and 0.5M to 0.73M at the Feigenbaum point. On a 300-frame corpus slice 81% of
  the lookups that read an entry find nothing: they read the lowest level's entry and are
  refused on its radius, which is the read `--gate on` removes. It cuts reads to 0.45 on
  that slice, and with `--search hint` to 0.64 on the long orbits and 0.005 to 0.05 on the
  channels, with identical fields. Both are recommended for a shader and stay off here so
  the numbers above reproduce.

### Whether the skip moves the frontier

A little, the right way, and in proportion to the steps it removes (run A).

- **Matching frames**, default coloring: F32Pair 55.3% to 59.2%, HiLo 55.9% to 60.3%; rule
  coloring 50.5% to 55.7%. 179 frames cross into matching and 87 out; over 5% stays at
  0.3%. At 1e-17 to 1e-20 matching goes 63% to 71%.
- **Share of samples more than 0.1 off**, mean over the corpus: 44.7% to 43.0%, where the
  rounded reference alone gives 42.0%. The gain by the frame's own step cut is −0.04,
  −1.5, −4.0, and −8.0 points at cuts under 1.05x, 1.05x to 1.5x, 1.5x to 3x, and 3x to
  10x. These are agreement gains; on the CPU the table's build takes back almost all of
  the time the cut saves (above).
- **On the deepest frames the skip beats the rounded reference**, on few frames: at 1e-20
  to 1e-30 (16 frames) 39.7% against 46.8% more than 0.1 off, and on the one frame past
  1e-30 (`random-dives#501`, 8.7e-42) 14.2% against 19.5%. The likely reason is that a
  skipped iteration never reads the rounded orbit, since the table is built from the
  `f64` one; seventeen frames are not enough to call it a law.
- **What it does not change**: the frames under 1% or 5% more than 0.1 off number 14 and 53
  either way. It creates no frame `f32` could not draw.
- **The hard long orbits in color** (rule coloring, raw share past 24/255): the main cusp
  goes from 4.4% to 0.0%, the p36100 copy cusp from 22.1% to 8.3%, and Feigenbaum 1e-13 from
  23.7% to 11.2%. The last two stay visibly different.

### What the GPU would hold

From the crate's layouts and measured counters (`q4.md`). **No GPU was run**: the memory
figures are layout arithmetic, and the timing figures below are estimates from assumed GPU
rates and per-step costs counted from instructions. WebGPU defaults: 128 MiB a storage
binding, 256 MiB a buffer, 8 storage buffers a stage.

- **Per pixel**: 48 bytes of `PixelState`, of which the kernel needs 36 (40 as a WGSL
  struct); packings to 32 (interior on) and 24 (interior off) are possible and untested. The
  /4 preview (129,600 pixels) is 6.2 MB, 1080p 99.5 MB, 1440p fits one binding only at 36
  bytes, and 4K is drawn as tiles. Pixel count is never a hard limit.
- **Per reference iteration**: orbit 8 bytes as F32Pair, 16 as HiLo; with the table 12 and
  20; with the interior buffer too, 14 and 22.
- **Largest reference**: 16.8M points as F32Pair and 8.4M as HiLo with one binding a buffer;
  split across bindings, 100.7M and 50.3M without the skip, 33.6M and 25.2M with it and
  interior on. Every corpus frame (caps at most 2e6) fits one binding a buffer with 4x to 8x
  headroom; Feigenbaum at 2e7 needs 2 orbit bindings as F32Pair, 3 as HiLo. The real ceiling
  is the CPU, which builds the `f64` orbit at 16 bytes a point first.
- **Steps a pass, estimated**: a budget of about 1.3e8 step-pixels a dispatch (64 steps a
  pixel at 1080p), sized from per-step costs counted from the code (a degree-2 quick step
  is 63 instructions) and assumed GPU rates. On an integrated GPU at an assumed 2.5e9 such
  steps a second, the worst-case step leaves a 4x margin under the 2 s timeout; a shader
  would adapt the budget from its measured pass time. A running-pixel list is needed for
  the tail: a capped pixel at 2M steps takes 31,000 passes at a fixed 64.
- **The skip on a GPU may not pay on the ordinary corpus**: lookups fall on every 16th
  reference index, and with unrelated phases a 32-lane warp has a lane looking up on 87% of
  steps. Costed per pixel the skip is 0.84 of without it on a 40-frame sample; costed per
  warp under random phases, an upper bound rather than a measurement, it is 1.66. On the
  cusps it is about 0.0001 either way. The build is paid first, on the CPU: 0.086 s a frame
  on average and up to 0.57 s on the corpus, beside an estimated 0.27 s for the /4
  preview's passes on an assumed mid-range GPU. A likely policy is the skip only for
  frames with long valid runs, settled by simulating lockstep tiles or measuring a shader
  both ways.

### The read

**At this precision a GPU preview would draw about 99% of today's Deep frames acceptably**:
99.7% under default coloring (all but 7 of 2,333), 99.1% under the rule coloring New
coloring uses, and 97.9% under the links' own maps, with half or more matching outright
under the first two (55% and 51%, 59% and 56% with the skip). All of those are 64x36
shares, and the 640x360 sheets read a little worse (see "The visible metric"). By eye on
those sheets, a frame at 1% to 8% is the same picture: spirals, filaments, minibrots, and
region outlines stay put, no band moves, and the difference is single pixels re-dealt
inside texture that is already speckled. Smooth gradients are untouched, and the deepest
frame (8.7e-42) shows only scattered pixels in its dendrites.

The worst failures:

- **`go:julia3-end`** (Julia, degree 3, 9.6e-19, mean count 14k) is where `f32` is furthest
  past the rounded reference: 38.7% visible at 64x36 and 55.8% at 640x360, about four times
  the rounded reference's 8.9%, which is itself different. It has no valid `f64` floor
  (the moved figure, 47.7%, is the anchor swap above). Its spiral filaments become a
  blotchy mottle over about half the frame, and the skip only trims it (51.0% at 640x360).
- **Degree-6 and 1e5-count spirals** (`random-dives#808`, `#571`, `#921`,
  `dive-sheet:u0098`, and `pick-twin:sheet:u0669`) sit at 5% to 9%, near what the rounded
  reference alone gives: noise re-dealt, structure intact. The first two move under a
  second `f64` reference too.
- **Long orbits past the site's caps**: without the skip the main cusp's band edge moves and
  its bumps merge into slabs (fixed with it), and the p36100 copy cusp and the Feigenbaum
  spine stay visibly different even with it.

The measure has limits worth stating: the 1% and 5% lines were set by eye on two or three
frames, the shares are 64x36 ones that a real preview's resolution raises, the stricter
24/255 rule would call over a third of the corpus different, and the Julia frames have no
`f64` floor to be held to.

## Per-frame agreement, from the tests

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
