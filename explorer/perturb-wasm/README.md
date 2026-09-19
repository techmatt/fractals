# perturb — the Mandelbrot set below the `f64` floor

A Rust crate that renders the smooth field of the degree-2 Mandelbrot set by
**perturbation with rebasing**, and builds to a wasm module of its own. It has no
UI, no page and no link contract: those are the next prompt's, written against
what this one exports.

**Why a second crate and a second module.** `engine.wasm` is the renderer the
explorer runs today, and nothing in here is linked into it. The shallow path —
every shallow picture, every shallow key, every byte of that module — cannot be
slowed, re-ordered or moved by anything written here, because the compiler never
sees the two together. The two meet on the page, at a buffer of `f64` lanes:
this module's output is what `engine.wasm`'s `compute_band` produces for
`smooth`, in the same layout, so the existing `shade_level` colours it without
being told which kernel drew it.

It also has **no dependencies at all** — not `serde`, not the engine, not even as
a dev-dependency, because cargo resolves a path dev-dependency for every command
and `perturb.wasm` would then stop building on a machine with no sibling
checkout. `src/json.rs` reads the eleven-member spec and `smooth-cases.json`
pins the one formula that had to come from next door.

```text
src/fx.rs          fixed-point reals, n × u64 limbs, written for wasm32
src/reference.rs   one high-precision orbit per frame, projected to f64
src/kernel.rs      the per-sample f64 delta loop, with rebasing
src/json.rs        a reader for one flat JSON object
src/lib.rs         the spec, the cap policy, and the exports
smooth-cases.json  400 of the engine's own samples, as the pin
tests/oracle.rs    the kernel against a brute-force oracle (ignored by default)
tests/probe.rs     three-way probes; not proofs, and they say so
```

## The design, in one page

- **The reference orbit is fixed point; everything per-sample is `f64`.** The
  orbit runs once per frame and costs about 15 ms; the frame costs seconds.
- **The limb count comes from the view and nothing else** — `ceil(log2(samples
  across / width)) + 64` guard bits, the archive's rule, with no term for the
  orbit length, the supersample or the period. Three limbs at 2e-11, four at
  1e-28.
- **The bailout check comes before the precision.** Fixed point overflows its
  integer limb silently, so a reference that escapes has to be stopped rather
  than wrapped. (The audit priced the alternatives: astro-float degrades to
  inf/NaN on an escaping orbit and dashu-float panics outright.)
- **`δ' = (2·Z[m] + δ)·δ + dc`, and rebasing is Zhuoran's**: when `|z| < |δ|`, or
  the reference runs out, `δ := z` and `m := 0`. That is the whole of the glitch
  handling — no Pauldelbrot test, no secondary reference, no correction pass.
- **`dc` is geometry plus a fixed-point centre difference**, never `f64(centre) −
  f64(reference)`. At 1e-28 those two are the same `f64` and the difference is
  exactly zero, which would draw the reference's neighbourhood wherever the view
  actually is and look entirely plausible.
- **A named period makes the reference periodic.** The orbit is stored for one
  period and the index wraps instead of rebasing: 45 KB instead of 777 KB at the
  anchor, and — measured below — no rebasing at all.
- **The cap policy is the engine's shape without the engine's ceiling.**
  `maxiter::for_width` saturates at 67,000 by a width of about 4.7e-16, which
  would flatten every perturbation-depth view to one cap. The shape is restated
  here and only `CEILING` moves, to a provisional 1,000,000. Touching
  `maxiter::for_width` itself was never an option: six callers read it and a
  wider ceiling there moves the cap of every shallow picture the project has.
- **BLA is not built here.** The seam is marked at the top of `Kernel::sample`'s
  loop. It changes how long a picture takes and not what it is, and it wants the
  plain loop's correctness settled first.

### What it does not do

Degree-2 Mandelbrot, `smooth`, and nothing else. It is not a wider engine; it is
one kernel — which is the shape `explorer/README.md` already said a deep renderer
would have to take.

## What the engine needed

**Nothing.** No change was made or is needed in `fractal-wallpapers`, and
`engine.manifest.json` is unmoved. The one thing that had to come from next door
is `iterate::smooth_count`, which is private — and the audit's ruling was to
restate it here with a test pinning it to the engine's output rather than open a
function over there. `smooth-cases.json` is that test's data: 400 samples of the
engine's own field, plus the 311 `(escape step, |z|² at it, smooth)` triples read
straight off `Orbit`, written by `scratch/perturb_validate cases`.

The triples are the real pin, and they hold **exactly** — the closed form is
compared with no iteration in front of it, so there is nowhere for a difference
in arithmetic to hide.

## Proof

Measured on 2026-09-19, one idle box, `rustc 1.96.0`, Node v24.19.0. The anchor
throughout is the audit's: a **period-2838 minibrot nucleus in the seahorse
valley**, atom size 6.478e-12, centre
`-0.74501772828532335842941892835857434 + 0.14993443275456819177805709088257971i`,
framed at width **2e-11** — cap 48,551, **38.9% interior**.

### 1. Against `f64`, where `f64` still draws

The anchor frame at 480×270 ss1, this kernel against `iterate::run`:

| | |
|---|---|
| interior, both | 48,161 (37.2%) |
| interior, only perturbation | 2,241 |
| interior, only the engine | 2,324 |
| smooth on the 76,874 both escape | median **61.4**, p90 7,790, p99 20,160, worst 34,250 |
| bit-equal | **0** |

**They do not agree, and the disagreement is not small.** A median difference of
61 iterations on escape counts whose median is 20,236 is 0.3%, and the tail runs
to 34,250 — half the cap. This is the audit's own surprise 3 seen from the other
side: fidelity fails far above the coordinate wall, and 2e-11 is four decades
below where it starts failing.

**Which of the two is wrong is settled separately**, by the brute-force oracle,
and the answer is unambiguous. On the 311 escaping samples of the pinned cases'
view, run three ways — this kernel, the plain `f64` loop, and a 384-bit
fixed-point oracle — **the kernel is nearer the truth on 307 and the plain loop
on 4**. On a shallow grid at `c = -0.5` where `f64` is still honest, 1,874 of
2,776 escaping samples are bit-equal to the oracle and 2,770 are within 1e-6; the
worst sample there is one within an ulp of the boundary, where the kernel reads
3,832, the plain loop 1,730, and the truth is 3,025.

### 2. Against a brute-force oracle, below the wall

`tests/oracle.rs`. Every sample iterated directly in the same fixed-point
arithmetic, no reference and no delta, so the comparison measures the
perturbation and nothing else. Tiles are 16×9 because the oracle is the expensive
half.

**A finding first: the anchor cannot supply a ladder.** The atom is 6.478e-12
across, so every frame narrower than that is inside the minibrot's body and
100% interior — a nucleus is the wrong place to look for structure below its own
atom size. Those rungs still say something (the two agree about *which* samples
are interior, at every depth) but the escaping half of the question needs a view
with structure at every scale. That is `c = i`: a Misiurewicz point, exactly
representable as `0 + 1i` with no solve and no stored digits, on the boundary,
and asymptotically self-similar about itself.

**The Misiurewicz ladder** — and this is the one that proves the arithmetic:

| width | cap | limbs | escaping | interior disagreements | median Δ | worst Δ | rebases mean / max |
|---|--:|--:|--:|--:|--:|--:|--:|
| 1e-4 | 21,847 | 3 | 144 | 0 | **0** | 1.7e-13 | 2.0 / 7 |
| 1e-8 | 37,792 | 3 | 144 | 0 | **0** | 1.5e-12 | 2.5 / 8 |
| 1e-13 | 57,724 | 3 | 144 | 0 | **0** | 2.9e-13 | 2.1 / 9 |
| 1e-16 | 69,682 | 3 | 144 | 0 | **0** | 8.5e-14 | 2.1 / 7 |
| 1e-19 | 81,641 | 4 | 144 | 0 | **0** | 8.4e-13 | 2.1 / 7 |
| 1e-22 | 93,600 | 4 | 144 | 0 | **0** | 2.4e-12 | 2.1 / 8 |
| 1e-25 | 105,559 | 4 | 144 | 0 | **0** | 2.5e-12 | 2.1 / 9 |
| 1e-28 | 117,518 | 4 | 144 | 0 | **0** | 5.5e-13 | 2.2 / 9 |

Every sample of every rung escapes, every sample agrees with the oracle about
whether it escaped, the **median difference is exactly zero at every depth**, and
the worst is a part in 1e13. At the bottom rung the sample spacing is 6e-30 and
every sample in the tile is the same `f64`, so there is no reading of this table
in which the coordinate machinery is working by accident.

**The anchor ladder**, both references:

| reference | width | cap | limbs | escaping | interior disagreements | median Δ | median Δ/ν | worst Δ | rebases mean / max |
|---|---|--:|--:|--:|--:|--:|--:|--:|--:|
| view centre | 2e-11 | 48,551 | 3 | 88 | **0** | 1.0e-6 | 3.5e-11 | 7.6e3 | 10.3 / 44 |
| view centre | 1e-13 | 57,724 | 3 | 0 | **0** | — | — | — | 0.0 / 0 |
| view centre | 1e-19 | 81,641 | 4 | 0 | **0** | — | — | — | 12.6 / 28 |
| view centre | 1e-28 | 117,518 | 4 | 0 | **0** | — | — | — | 20.5 / 41 |
| nucleus, period 2838 | 2e-11 | 48,551 | 3 | 100 | **0** | 9.7e-7 | 5.6e-11 | 7.5e3 | 12.0 / 44 |
| nucleus, period 2838 | 1e-13 | 57,724 | 3 | 0 | **0** | — | — | — | 0.0 / 0 |
| nucleus, period 2838 | 1e-19 | 81,641 | 4 | 0 | **0** | — | — | — | **0.0 / 0** |
| nucleus, period 2838 | 1e-28 | 117,518 | 4 | 0 | **0** | — | — | — | **0.0 / 0** |

(1e-16, 1e-22 and 1e-25 are in the suite too and say the same thing.) The
periodic run has the view nudged a quarter of a frame off the nucleus, so its
centre offset is not zero and has to be taken in fixed point.

Three things worth reading off it. **The interior masks never disagree**, at any
depth or either reference. **On the one rung with exterior in it the median
relative error is 3.5e-11** — ten digits — while the worst is 7,600, which is the
chaos the three-way probe pins on the boundary rather than on the kernel; the
suite is held to the median for that reason, and the share within a relative
1e-6 is 84%. And **naming the period removes rebasing entirely**: 20.5 rebases a
sample at 1e-28 against the view centre, and none at all against the wrapped
nucleus, because the wrap is what the rebase was standing in for.

### 3. The interior switch

`dz_n = ∏ 2·z_k` is the derivative of the `n`-fold map along the orbit: it decays
geometrically inside a hyperbolic component and grows outside one. (The usual
derivative, with respect to `z₀`, is useless here — Mandelbrot fixes `z₀ = 0` and
the product is identically zero from its first factor.) It is carried as a
mantissa in `[1, 2^64)` and a power-of-two exponent, and the test `|dz|² < 2^floor`
is exact, gated by an integer compare that is false on all but the last handful
of iterations.

**Swept on the anchor at 96×54** — 2,019 of 5,184 samples interior:

| floor | `\|dz\|²` below | caught of 2,019 | wrongly painted | iterations saved |
|--:|--:|--:|--:|--:|
| −300 | 2^-300 | 0 | 0 | 0.0% |
| −160 | 2^-160 | 0 | 0 | 0.0% |
| −120 | 2^-120 | 4 | 0 | 0.0% |
| −100 | 2^-100 | 14 | 0 | 0.1% |
| −80 | 2^-80 | 30 | 0 | 0.2% |
| **−64** | 2^-64 | 66 | **0** | 0.4% |
| −48 | 2^-48 | 129 | 0 | 0.9% |
| −32 | 2^-32 | 272 | 0 | 2.5% |
| −16 | 2^-16 | 616 | 0 | 7.7% |
| −8 | 2^-8 | 988 | 0 | 16.0% |
| −4 | 2^-4 | 1,293 | 0 | 26.4% |

And ON against OFF across both ladders at −64, with the same assertion on every
sample:

| view | width | interior | caught | wrongly painted | iterations saved |
|---|---|--:|--:|--:|--:|
| anchor | 2e-11 | 56 | 2 | 0 | 0.4% |
| anchor | 1e-13 | 144 | 144 | 0 | 75.1% |
| anchor | 1e-16 | 144 | 144 | 0 | 91.9% |
| anchor | 1e-22 | 144 | 144 | 0 | 97.0% |
| anchor | 1e-28 | 144 | 144 | 0 | 97.6% |
| c = i | any rung | 0 | 0 | 0 | 0.0% |

**Nothing was ever wrongly painted, at any threshold from 2^-300 to 2^-4**, on
either ladder. The condition for shipping it on was that it never paint interior
a sample the plain run escapes from, and it never did; it ships **on**, at
**−64**, the safe end of the sweep's useful range.

**It is worth saying plainly that at the anchor this is a small net loss.** The
switch costs 9% per iteration (4.80 ns to 5.24) and at −64 recovers 0.4% of the
frame, because only about seventeen periods of a period-2838 minibrot fit inside a cap
of 48,551 and `|dz|` has not had room to fall. It pays where the frames are
deeper and interior-dominated, which is most of what a perturbation renderer is
for. The sweep is here so that the tab prompt can move the number against its own
views rather than re-deriving it; −4 catches 64% of the interior and takes 26% off
the frame, and on this evidence is safe, but on one frame's evidence only.

### 4. Price

**Native**, one idle box, best of three, all three measured the same way in the
same binary on the same frame — the anchor at 480×270 ss1, 4.22e9
sample-iterations:

| | seconds | ns / sample-iteration |
|---|--:|--:|
| the engine's own `iterate::run` | 19.78 | **4.68** |
| perturbation, interior off | 20.27 | **4.80** |
| perturbation, interior on | 22.01 | 5.24 |

**Perturbation costs 2.6% more per sample-iteration than the plain `f64` loop**,
and the interior switch costs a further 9%. The audit's expectation was "the same
order", and it is nearer than that — which is not obvious, because the delta
recurrence is about 1.7× the arithmetic of the plain one and reads a 777 KB array
the plain one does not. Where that goes is not accounted for here.

Two caveats on the 4.68. It is *this harness's* figure for the engine, calling
`iterate::escape` per sample; the audit measured 3.83 ns for the same loop
through `field::sweep_row`'s specialized table and the engine's own report. The
ratio above is the fair comparison because both sides of it were taken the same
way; against the audit's own figure the kernel is 25% slower.

**The first version of this loop was about 2.5× slower**, and the fix was how the
reference orbit is laid out and read: two parallel `f64` arrays, four indexed
loads per iteration, and the loop's invariants re-read through `&Reference` every
pass. Interleaving the orbit into one array of `[re, im]` pairs, carrying `Z[m]`
across the step instead of loading it twice, and hoisting the invariants took it
to 4.80. A 48,552-point orbit is 777 KB and does not sit in L2, so how it is read
is most of what the loop is doing. ⚠ *The two changes were made together and are
not separated, and the before figure is an estimate: the harness that produced it
had the engine's loop inside its own timer, worth about 4.7 ns an iteration,
which is a measurement bug found and fixed afterwards. The 4.80 and the 4.68 above
are clean.*

**The reference orbit**: 48,552 points at three limbs in **14.7 ms** native and
**25.4 ms** in wasm, once per frame. Against a frame of 20 s that is
0.07%, and it is the number that would have been paid fifty times over had it
been computed inside a band's `resolve` instead of handed across as a buffer.

**In wasm**, Node v24.19.0, single instance, single thread, same frame:

| | seconds | ns / sample-iteration |
|---|--:|--:|
| perturbation, interior off | 21.28 | **5.04** |
| perturbation, interior on | 27.70 | 6.59 |

Wasm is **5% slower than native** here, and the interior switch costs 31% in wasm
against 9% native. Both are worth flagging rather than explaining: the audit
found the *engine's* loop 12% **faster** in wasm than native on this same frame
and excluded build flags, engine version and thread count as causes. Whatever V8
is doing for that loop it is not doing for this one, and a deep tab should price
its own frames rather than scale a native figure.

**`perturb.wasm` is 108,310 bytes raw and 50,943 gzipped** at level 9. Beside
`engine.wasm`'s 717,977 / 213,828 that is 15% more to download, and it buys a
renderer for everything below 1e-10. It is large for a dependency-free crate of
1,200 lines, and the reason is `core::fmt`: `plan` formats a JSON report and every
refusal is a sentence. That is an attribution from what the module contains rather
than a measurement by subtraction, and if the tab wants the bytes back that is
where to look. There is no `serde`, no `serde_json` and no engine in it.

### 5. Pictures

`scratch/perturb-ladder.png` — the anchor, then a `c = i` ladder from 1e-2 to
1e-28, coloured by a percentile stretch and a plain gradient. Not committed;
`scratch/` is ignored, and the sheet is for Matt's eye rather than for a page.

## Running it

```text
cargo test  --release                                  # 35 unit tests, under a second
cargo test  --release --test oracle -- --ignored --nocapture   # the ladders, ~2 min
cargo test  --release --test probe  -- --ignored --nocapture   # the three-way probes
cargo build --release --target wasm32-unknown-unknown          # perturb.wasm
node scratch/perturb_validate/bench.mjs                        # the wasm price
```

`scratch/perturb_validate` is the one place the engine and this crate are linked
into the same binary, which is exactly why it is not in either of them. It
writes `smooth-cases.json`, runs the engine comparison, prices the native side
and dumps the ladder's fields; `scratch/perturb_validate/sheet.py` composes them.

## Committed: `perturb.wasm`

The module **is** in the tree, and `perturb.manifest.json` is beside it, since
`build_deep_tab_ckpt135` (2026-09-19) gave it the consumer that settled its
exports. `python -m builder explorer --perturb` rebuilds both and nothing else:
it needs `cargo` and the `wasm32-unknown-unknown` target and **no sibling
checkout**, which is what this crate having no dependencies buys and is why it is
its own branch rather than a stage of the explorer's bake.

| field | what it holds |
| --- | --- |
| `schema` | the record's own version, `1` |
| `built` | the date of the build |
| `crate` | `explorer/perturb-wasm` |
| `dependencies` | `[]`, and it is written down because it is the design |
| `rustc` | the compiler, with its commit and date |
| `raw_bytes` / `gzip_bytes` | **108,310 raw, 50,942 gzipped** |

Two fields of `engine.manifest.json` are **absent** rather than empty:
`engine_version`, because this crate does not link the engine, and
`engine_changes`, because it has never needed a change in it. An empty
`engine_changes` would read as a list somebody forgot to fill in. That the second
one is still true after the tab landed is worth saying plainly: the tab shades its
field through `engine.wasm`'s existing `shade_level` on a placeholder viewport,
which `explorer/deep.test.mjs` holds to being sound, so **`engine.wasm` is
byte-identical and `engine.manifest.json` is unmoved**.

**What a visitor downloads for it: nothing, unless they open the Deep tab.** The
module and the tab's five modules are fetched on that tab's first open and never
before. Against `engine.wasm`'s 213,828 gzipped, the 50,942 here is 24% more —
paid only by a reader who asked for a renderer for everything below 1e-10.

`core::fmt` is still most of the size and is still not chased: `plan` formats a
JSON report and every refusal is a sentence, and the tab reads both. Trimming it
would mean giving up the sentences, which are what a refusal is.
