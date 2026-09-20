# perturb — `z² + c` below the `f64` floor

A Rust crate that renders the smooth field of the degree-2 Mandelbrot set — and,
since `deep_julia_at_c_ckpt136`, of the Julia set of any `c` — by **perturbation
with rebasing**, and builds to a wasm module of its own. It has no UI, no page and
no link contract: those are `explorer/README.md`'s, written against what this
exports.

**The two sets are one kernel and one reference orbit**, which is the shape the
whole Julia case takes and is worth reading before anything below. The stored
orbit is `Z₀ = 0, Z₁ = c, Z₂ = c² + c, …` — the critical orbit of `c` — and it is
*simultaneously* the Julia orbit of `z = 0` and, shifted by one index, the Julia
orbit of `z = c`. So a Julia frame is drawn from the orbit a Mandelbrot frame
centred at that `c` already computed, and the only differences in the loop are
where it enters and whether `dc` is spent every step or once.

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
src/bla.rs         the skip table, built off the orbit — off unless a spec asks
src/json.rs        a reader for one flat JSON object
src/lib.rs         the spec, the cap policy, and the exports
smooth-cases.json  400 of the engine's own samples, as the pin
tests/oracle.rs    the kernel against a brute-force oracle (ignored by default)
tests/probe.rs     three-way probes; not proofs, and they say so
tests/bla.rs       the skip against the plain loop (ignored by default)
tests/descend.rs   the frame finder: deep frames with structure, and the exact
                   decimal walk that gets to them (ignored by default)
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
- **The Julia case is that recurrence with `dc` spent once instead of every
  step.** Holding `c` and varying `z₀`, the delta obeys `δ' = (2·Z[m] + δ)·δ` with
  no `dc` term at all: the offset that was added every iteration becomes the delta
  the loop opens with, and the entry index moves from `Z₀` to the point the view is
  anchored at. `JULIA` is a const generic and not a field, because `x + 0.0` is not
  `x` when `x` is `-0.0` — a zero `dc` carried as data would cost the Julia loop two
  additions an iteration that no optimizer is permitted to remove.
- **And rebasing is untouched, which is the reason there is no second reference
  here.** `δ := z` is only a rebase because `Z₀ = 0`: the delta becomes the iterate
  itself, with no subtraction and so no cancellation. Under `z ↦ z² + c` the stored
  orbit from index 0 is the orbit of the critical point, a valid reference for any
  `z`, so the same two lines say the same true thing. Rebasing onto an orbit that
  started anywhere else would need `δ := z − Z₀` in `f64`, and that subtraction is
  exactly the precision a deep frame has none of to spare.
- **Two anchors, and both are points of the orbit**: `z = c` at index 1, where the
  filigree is, and `z = 0` at index 0, the critical point, where the picture has
  exact two-fold symmetry. Both offsets are exact fixed-point subtractions, so
  which one a frame uses changes nothing about the mathematics — only how much of
  the pixel step survives into the `f64` delta.
- **`delta_ulps` is the engine's `resolution_ulps` asked of the delta**, and it is
  what refuses a frame too far from its anchor. There the question is whether two
  neighbouring sample *centres* are the same `f64`; here the centres are exact
  decimals and it is the delta that is a double, so a view a long way from its
  anchor at a width far below it starts every pixel from the same number and would
  draw one flat colour with total confidence. The floor is `DELTA_ULPS = 4.0`, the
  engine's own, restated the way `cap::for_width` is. The wall is further out than
  it sounds: an offset of 0.76 at 480 samples across still leaves 375 numbers to a
  pixel at 2e-11, and only bites below about 3e-13 — which is why the second anchor
  matters at depth and nowhere else.
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
- **BLA is built, it is off, and §7 recommends taking it out.** `src/bla.rs` is
  the skip table; `Spec::bla` is its tolerance and absent is the default, so every
  picture the page draws is still the plain loop's. It is a pure function of
  `(orbit, ε, one frame-wide |dc| bound)` and of nothing else, which is what lets a
  band stay bit for bit the rows a whole-frame pass would produce. §6 priced it and
  found it a loss at both widths the tab's links use and a 59× below 1e-20; §7 went
  and got seven deep frames with structure in them, and on those it is **between a
  21% loss and 2.6×, and moves the picture at every tolerance including the
  tightest one that means anything**. The 59× was a property of a frame with no
  exterior in it.

### What it does not do

Degree 2, `smooth`, and nothing else. It draws the two sets `z² + c` has — the
parameter plane and the dynamical one — because they are one recurrence read two
ways and one reference orbit to draw either from, and **not** because it is
growing into a wider engine. No other degree, no other family, no other mode. It
is one kernel, which is the shape `explorer/README.md` always said a deep renderer
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

### 2b. The Julia case, against the same oracle

Measured 2026-09-20, same box. Three ladders, all in `tests/oracle.rs`, and the
oracle for a Julia sample is the same fixed-point loop with `z₀` the pixel and `c`
held.

**`c = i` is the ladder for the same reason it is the Mandelbrot one**: its Julia
set is a dendrite — no interior at all, structure at every scale, and the critical
point on the set, so both anchors sit on real structure — and `0 + 1i` is exactly
representable with no stored digits to be wrong about. Every rung, both anchors,
1e-4 down to 1e-28, 144 samples a tile:

| | escaping | interior disagreements | median Δ | worst Δ | within 1e-6 | rebases mean / max |
|---|--:|--:|--:|--:|--:|--:|
| anchored at `z = c` | 144 of 144, every rung | **0** | **0** at every rung | 1.8e-12 | 100% | 2.0–2.3 / 6–9 |
| anchored at `z = 0` | 144 of 144, every rung | **0** | **0** at every rung | 1.3e-12 | 100% | 2.1–2.7 / 5–7 |

At the bottom rung the sample spacing is 6e-30 and every `z₀` in the tile is the
same `f64`, so there is no reading of this in which the delta machinery is working
by accident.

**A finding the first run of that ladder produced, and it is about the oracle.**
At the origin anchor the ladder failed below 1e-16 — 20 interior disagreements at
1e-28 and a median Δ of 0.3 — and the kernel was not the one that was wrong. A
Julia sample anchored at `z = 0` has `z₁ = z₀² + c`, so what tells two neighbouring
pixels apart is the *square* of a spacing: 4e-59 at the bottom rung. Fixed point is
absolute precision, and at the frame's own four limbs 4e-59 is below the last bit —
every pixel of the oracle's tile became the same number and the oracle drew a flat
tile. The kernel carries that delta in `f64`, which is *relative* precision and
holds it to sixteen digits. The oracle runs at twice the limbs at that anchor now,
and the walk says so where it does it.

**The audit's own deep `c`, drawn as a Julia set at `z = c`** — the view the tab's
button opens — is held to its median and not its worst sample, which is the anchor
ladder's ruling and is here for the anchor ladder's reason:

| width | cap | escaping | interior disagreements | median Δ/ν | worst Δ | within 1e-6 |
|---|--:|--:|--:|--:|--:|--:|
| 2e-6 | 28,619 | 142 | 0 | 3.9e-14 | 1.5e-1 | 99.3% |
| 2e-8 | 36,592 | 141 | 0 | 7.0e-12 | 1.7e2 | 89.4% |
| 2e-9 | 40,578 | 136 | **2** | 5.5e-12 | 5.9e2 | 86.0% |
| 2e-10 | 44,565 | 15 | 0 | 1.2e-11 | 6.2e1 | 86.7% |
| 2e-11 | 48,551 | 0 | 0 | — | — | — |

The bottom rungs are entirely interior, and that is the picture rather than the
kernel: inside a superattracting basin every point converges to the cycle, so a
frame narrower than the structure around `z = c` is filled.

**The two interior disagreements at 2e-9 are chaos, and that is settled rather
than asserted.** The oracle escapes at 32,897 and 36,223 where the kernel runs to a
cap of 40,578 — not cap-straddling, a difference of thousands, which is the same
signature as the Mandelbrot anchor's worst Δ of 7.6e3 one section up. So
`tests/probe.rs` asks the third opinion at a width where `f64` is still honest
(2e-9 across sixteen samples is a million representable numbers to a pixel), and
the answer is unambiguous: **the kernel is nearer the oracle on 250 of 256 samples
and the plain `f64` loop on 1**, with the plain loop reading 20,283 where the
oracle reads 29,223. A kernel carrying the wrong recurrence could not produce that
table.

And the shallow end, where a completely different program can be asked:
`explorer/deep.test.mjs` draws the Douady rabbit's Julia set through this module
and through **`engine.wasm`'s own `f=julia` render** of the same `c` — no reference
orbit, no delta, no rebasing — and holds the two to agreeing about the interior
mask sample for sample and about the smooth count to a median relative 1e-6. Two
kernels sharing no code and agreeing about a picture is the strongest statement
available about the recurrence, the entry index and the geometry at once.

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

**What a Julia frame costs against the Mandelbrot frame at the same `c`, width and
cap** — `explorer/bench/julia.mjs`, 221×124 on one thread, 2026-09-20:

| width | cap | mandelbrot | julia | ratio |
|---|--:|--:|--:|--:|
| 2e-9 | 40,578 | 2,025 ms · 14% interior | 2,038 ms · 4% interior | **1.01×** |
| 2e-10 | 44,565 | 1,957 ms · 1% interior | 3,275 ms · 89% interior | **1.67×** |
| 2e-11 | 48,551 | 5,751 ms · 39% interior | 1,858 ms · 100% interior | **0.32×** |

**A frame time cannot answer whether the Julia loop is the same price**, and that
table is why: the two frames do different amounts of work because their interior
shares are different, and an interior sample either stops early under the switch or
pays the whole cap. The ratio swings from 0.32 to 1.67 with the picture and says
nothing about the recurrence.

So the loop is priced with the work held equal — a cap of 1,200, low enough that
**no sample of either frame escapes**, and the interior switch off, so every sample
of both runs exactly `cap` iterations:

| | ms | ns / sample-iteration |
|---|--:|--:|
| mandelbrot | 167 | **5.08** |
| julia | 134 | **4.07** |

**The Julia loop is 20% cheaper per sample-iteration**, which is the two additions
it does not do and, on frames that rebase differently, some part of that too — the
two are not separated here. It is the first thing in this crate that is *faster*
than the Mandelbrot path, and it wants no explanation beyond the recurrence being
shorter.

**The orbit the jump needs is 18 to 25 ms**, and every point of it is a point the
Mandelbrot frame's orbit already had: the Julia orbit is asked for one step longer,
because a view entered at `Z₁` has one step less of reference in front of it, so it
is recomputed rather than reused. Against a frame of seconds that is 1%, and it is
the whole price of pressing the button.

**`perturb.wasm` is 122,098 bytes raw and 56,147 gzipped** at level 9. Beside
`engine.wasm`'s 763,343 / 228,670 that is 16% more to download, and it buys a
renderer for everything below 1e-10, on both of the sets `z² + c` has. It is large for a dependency-free crate of
1,500 lines, and the reason is `core::fmt`: `plan` formats a JSON report and every
refusal is a sentence. That is an attribution from what the module contains rather
than a measurement by subtraction, and if the tab wants the bytes back that is
where to look. There is no `serde`, no `serde_json` and no engine in it.

⚠ **9,423 of those bytes are the skip table, and nothing on the page can reach
it.** The module grew 8.4% raw and 6.4% gzipped for a code path that is off by
default and that no page sets, which is a real cost paid by every reader who opens
the Deep tab. It is here rather than behind a cargo feature because a committed
module that cannot be rebuilt from the committed source is the failure this
manifest exists to prevent, and nothing in `builder check` would have caught the
drift. Stage 2 either turns the table on or takes those bytes back.

### 5. Pictures

`scratch/perturb-ladder.png` — the anchor, then a `c = i` ladder from 1e-2 to
1e-28, coloured by a percentile stretch and a plain gradient. Not committed;
`scratch/` is ignored, and the sheet is for Matt's eye rather than for a page.

### 6. The skip table, and why it is off

`src/bla.rs`, `tests/bla.rs`, measured 2026-09-20 on the same box. One entry stands
for a run of `2^k` steps as `δ ← A·δ + B·dc`; the derivation, the merge rule and
every guard are in that file's header. Tiles are 64×36, the plain loop and the
skipping loop are the same spec and the same orbit, and the runs alternate.

**Four guards, and each is held where it is a property of something.** No run may
reach the index the plain loop rebases at, or pass a reference point near enough to
the bailout that `(1+ε)·|Z|` could clear it — both at build, where they are
properties of the orbit. No run may step over the cap, and none may cross a step at
which the interior switch would have fired — both at lookup, where they are the
sample's. **Rebasing needs no guard**: the merge rule's own induction puts
`|δ_j| ≤ ε·|Z_j|` at every index a valid run passes through, and `(1−ε)·|Z|` is
above `ε·|Z|`, so `|z| < |δ|` cannot happen inside one. What a run *lands* on is
bounded by nothing, so the landed delta falls into the loop's own escape, interior,
cap and rebase tests rather than resuming past them.

**What a table costs.** Levels below a minimum are built and not stored, and the
total is `len · 2^(1−min)` entries of 64 bytes:

| cap | orbit | min level | entries | bytes | vs the orbit | build |
|--:|--:|--:|--:|--:|--:|--:|
| 48,551 | 48,552 pts | 0 | 131,070 | 8,388,480 | 10.8× | 3.2 ms |
| 48,551 | 48,552 pts | **4** | **8,190** | **524,160** | **0.67×** | 1.9 ms |
| 48,551 | 48,552 pts | 8 | 510 | 32,640 | 0.04× | 1.6 ms |
| 1,000,000 | 1,000,001 pts | 0 | 2,097,150 | 134,217,600 | 8.4× | 56.0 ms |
| 1,000,000 | 1,000,001 pts | **4** | **131,070** | **8,388,480** | **0.52×** | 33.4 ms |
| 1,000,000 | 1,000,001 pts | 8 | 8,190 | 524,160 | 0.03× | 30.0 ms |

At `MIN_LEVEL = 4` a table is **two thirds of its orbit** rather than the five times
the audit budgeted for, and two milliseconds against the orbit's fifteen. The build
is **blocked** — the whole tree over one aligned run of `2^kmax` starts, then
dropped — so the peak is a block and not `1.5 ×` the orbit, which at a cap of a
million would have been 108 MB of working entries in a wasm heap that also holds the
orbit.

**The one law the whole sweep is.** A merged radius has to clear `|B|·dcmax`, and
`|B|` grows like the run's own derivative, so a run is long enough to be worth taking
only when `ε` is something like `2e10 ×` the frame's half-diagonal. **The skip is
therefore a function of the width and not of the cap**, and the speedup does not ramp
— it steps, in one decade of `ε`, from about 1× to about 50×:

| frame | cap | interior | ε = 2⁻⁵³ | 1e-12 | 1e-9 | 1e-6 | 1e-4 |
|---|--:|--:|--:|--:|--:|--:|--:|
| mandelbrot 2e-11 | 48,551 | 38.9% | 0.59× | 0.59× | 0.60× | 0.88× | 1.13× |
| julia 2e-9 | 40,578 | 3.7% | 0.89× | 0.89× | 0.87× | 1.04× | 1.47× |
| julia 2e-10 | 44,565 | 89.3% | 2.32× | **2.52×** | 2.93× | 4.69× | 6.79× |
| mandelbrot 1e-16 | 69,682 | 100% | 0.59× | 0.79× | 1.22× | **43.68×** | 43.95× |
| mandelbrot 1e-19 | 81,641 | 100% | 0.66× | 1.22× | **57.93×** | 57.94× | 58.21× |
| mandelbrot 1e-22 | 93,600 | 100% | 1.08× | **59.08×** | 59.11× | 59.51× | 59.36× |
| mandelbrot 1e-28 | 117,518 | 100% | **59.19×** | 58.93× | 58.78× | 60.08× | 59.32× |

Single thread, interior switch off, and the step moves one decade of `ε` left for
every three decades of depth — which is the law above, read off the table.

**And what it costs the picture.** Nothing at all at the two tightest tolerances, on
every frame that has exterior in it: zero samples flipped between interior and
escaping, zero escape counts moved, zero error on the smooth value, while 3.6% to
58.6% of the iterations were skipped. The damage starts at `1e-9` and is severe by
`1e-6`:

| frame | ε | skipped | → interior | → escaping | counts moved | median Δ | p99 Δ | median Δ/ν |
|---|--:|--:|--:|--:|--:|--:|--:|--:|
| mandelbrot 2e-11 | 1e-12 | 0.0% | 0 | 0 | 0 | 0 | 0 | 0 |
| mandelbrot 2e-11 | 1e-9 | 1.3% | 17 | 20 | 437 | 4.2e-3 | 9.7e3 | 2.0e-7 |
| mandelbrot 2e-11 | 1e-6 | 37.8% | 27 | 35 | 1,062 | 3.5e1 | 2.0e4 | 1.8e-3 |
| julia 2e-9 | 1e-12 | 4.0% | 0 | 0 | 0 | 0 | 0 | 0 |
| julia 2e-9 | 1e-6 | 21.8% | 27 | 27 | 1,453 | 1.2e1 | 1.9e4 | 1.2e-3 |
| julia 2e-10 | 1e-12 | 58.6% | 0 | 0 | 0 | 0 | 0 | 0 |
| julia 2e-10 | 1e-6 | 80.2% | 14 | 15 | 194 | 6.5e1 | 1.6e4 | 2.7e-3 |

⚠ **The deep rungs are blank in those columns, and blank for a reason that is not
reassuring**: every Mandelbrot frame below the atom's 6.5e-12 is inside the
minibrot's body and **100% interior**, so there is no escaping sample there for a
skip to be wrong about. The three frames above are the only ones either ladder
carries with exterior in them, and the deepest is `julia 2e-10`. **So the depth at
which the skip pays and the depth at which its accuracy has been measured do not
overlap.** §7 is that gap measured, on seven frames found for the purpose, and it
is where this table's recommendation is withdrawn: at the depths the skip pays,
every frame with structure in it is one the skip is either slower on or wrong
about, and 1e-12 moves the picture on all seven.

**What the median and the p99 are saying** is worth separating. At `1e-9` on the
anchor the *median* escaping sample is right to seven digits while the p99 is off by
9,700 iterations — which is this frame's own chaos and not the table's: §1 already
measured this kernel and the plain `f64` loop disagreeing by a median of 61 and a
worst of 34,250 on the same view, with nothing bit-equal. On a frame whose escape
counts are chaotically sensitive to the last bit, **an error budget cannot be read
off `ε`**, and the only honest bar is the one the two tightest columns clear: that
nothing moved at all.

**The seam costs 70% on every iteration it does not skip.** The `2⁻⁵³` rows at
2e-11 and 1e-16 are 0% skipped and run at 0.59×, which is the lookup alone — an
alignment mask, a bounds-checked index into the table and a radius compare, against a
loop body of about ten flops. That is the number stage 2 has to beat or route around,
and it is why a frame that skips half its iterations is still slower than one that
skips none.

**The interior switch, beside the skip.** The audit's finding holds, the skip makes
it worse, and there is a second finding underneath it:

| frame | interior | plain: off → on | skip at 1e-6: off → on |
|---|--:|--:|--:|
| mandelbrot 2e-11 | 38.9% | 366 → 405 ms (**+11%**) | 418 → 530 ms (**+27%**) |
| julia 2e-9 | 3.7% | 113 → 145 ms (+28%) | 110 → 144 ms (+30%) |
| julia 2e-10 | 89.3% | 497 → 235 ms (**−53%**) | 108 → 140 ms (**+30%**) |
| mandelbrot 1e-16 | 100% | 793 → 70 ms (−91%) | 19 → 2 ms (−91%) |
| mandelbrot 1e-19 | 100% | 925 → 70 ms (−92%) | 18 → 1 ms (−93%) |
| mandelbrot 1e-22 | 100% | 1053 → 35 ms (−97%) | 18 → 1 ms (−97%) |
| mandelbrot 1e-28 | 100% | 1315 → 35 ms (−97%) | 22 → 1 ms (−98%) |

`julia 2e-10` is the row to read: the switch is worth **−53%** on the plain loop and
**+30%** beside the skip. **The two compete wherever the interior a frame has is
reachable by skipping**, and they compose only where the switch does something no run
of the recurrence can — below 1e-16 it stops an interior sample after about one
period of the reference, 2,838 iterations of a cap of 117,518, which is a 97% cut a
skip cannot reproduce because a skip still has to walk the orbit.

**The frame's own profile, re-measured**, since the program that produced §4's
figures no longer compiles: the anchor at 2e-11 runs a mean of **32,480 iterations a
sample** with the switch off and 32,358 with it on, 38.9% interior. At 480×270 that
is **4.21e9 sample-iterations** — so §4's 4.22e9 was right, and what was lost with
`scratch/perturb_validate` was the program and not the number. **58.2% of those
sample-iterations belong to interior samples**, which is the audit's own 58%.

### 7. The frames that have something in them, and why the skip comes back out

`tests/descend.rs` and `tests/bla.rs`'s deep half, measured 2026-09-20 on the same box —
the plain loop at **4.76 ns** against §4's 4.80, so the machine is the machine. §6 closes on
a warning: the depth at which the skip pays and the depth at which its accuracy has been
measured do not overlap, and closing that is stage 2's first job. This is that job. The gap
turns out not to be a gap in the evidence but in the claim — **the skip does not pay where
there is anything for it to be wrong about.**

**How the frames were got.** From the anchor's minibrot at 1e-11: render a 64×64 tile at
the policy cap, recentre on the busiest boundary neighbourhood it offers, shrink the width
tenfold, repeat. **The centre is an exact decimal the whole way**, which the square tile is
what makes possible — the sample step is `width/64` on both axes, so a recentre is
`(2·col − 63)·78125·10^−(7+p)`, and the walk is integer addition rather than a double that
ran out of bits twenty rungs up. `Dec` in that file is the arithmetic, held to the kernel's
own `dc` to the last bit the double carries.

Three routes, because the first two agreed too well. `tangle` takes the most boundary
crossings in a 5×5; `pinch` takes the deepest escaping sample beside a bounded one; `body`
walks **every rung at four times the policy cap**, which is what it takes to see a frame
that has genuine interior in it. Neither of the first two backtracked once — every rung
from 1e-12 to 1e-54 came back mixed and busy, 12% to 35% of adjacencies crossing the
boundary, escape counts spread over 8,000 to 27,000.

| frame | cap | escaped | centre | `dv` link, after `explorer/?` |
|---|--:|--:|--:|:--|
| tangle 1e-22 | 93,600 | 69.5% | 33 ch | `dv=2&x=-0.745017728290198619298817365858&y=0.149934432756897045833502403382&w=1e-22&n=93600` |
| tangle 1e-28 | 117,518 | 80.9% | 38 ch | `dv=2&x=-0.74501772829019861929877929889763684&y=0.14993443275689704583350282968726721&w=1e-28&n=117518` |
| pinch 1e-28 | 117,518 | 82.5% | 38 ch | `dv=2&x=-0.74501772828897655304632685480388684&y=0.14993443275858764694789167606226721&w=1e-28&n=117518` |
| tangle 1e-40 | 165,354 | 74.9% | 49 ch | `dv=2&x=-0.7450177282901986192987792989188510315333046875&y=0.1499344327568970458335028296517884911675546875&w=1e-40&n=165354` |
| tangle 1e-54 | 221,162 | 71.3% | **63 ch** | `dv=2&x=-0.745017728290198619298779298918851031533262270733325571484375&y=0.149934432756897045833502829651788491167588360989048041953125&w=1e-54&n=221162` |
| body 1e-22 | **374,400** | 55.7% | 33 ch | `dv=2&x=-0.745017728288852579046129865858&y=0.149934432757626550615361778382&w=1e-22&n=374400` |
| body 1e-28 | **470,072** | 78.9% | 38 ch | `dv=2&x=-0.74501772828885257904614927236638684&y=0.14993443275762655061538134007789221&w=1e-28&n=470072` |

All seven parse and round-trip byte for byte through `explorer/deep-link.js`. Each is
committed in `DEEP_FRAMES` with its cap, and a **cheap** test holds every centre to the 64
characters a coordinate is capped at and every cap to the policy's or a stated multiple —
the two ways a committed frame goes quietly wrong without rendering anything.

**The deepest is 1e-54 because of the link and not the renderer.** A rung costs about five
seconds a tile there and the descent was still going down; a centre is 63 characters at that
width and `COORDINATE_LIMIT` is 64.

⚠ **The policy cap paints exterior as interior on every one of these frames**, and this is
the most consequential thing in the section. It has nothing to do with the skip.

| frame | at the policy cap | 2× | 4× | 8× |
|---|--:|--:|--:|--:|
| tangle 1e-22 | 29.3% unresolved | 0.2% | 0.0% | 0.0% |
| tangle 1e-28 | 21.0% | 0.0% | 0.0% | 0.0% |
| pinch 1e-28 | 16.5% | 0.0% | 0.0% | 0.0% |
| tangle 1e-40 | 22.7% | 0.0% | 0.0% | 0.0% |
| tangle 1e-54 | 27.4% | 0.0% | 0.0% | 0.0% |
| body 1e-22 | **100%** | — | 43.6% | 1.7% |
| body 1e-28 | **100%** | — | 21.5% | 0.2% |

On the five tangle and pinch frames a sixth to a third of the picture is unresolved at the
cap the tab would use, and **at twice that cap every one of them is 100% escaping** for
about 2% more mean iterations: those samples were never interior, they were exterior the cap
stopped a few thousand short. The body pair is the same fault four times over — at the
policy cap they are a **flat interior fill**, over escape counts that run from about 100,000
to 400,000. The policy's cap lands inside the frame's own escape-count distribution, and
what a reader sees is the shortfall painted as set.

**And not one sample of any of the seven is *proven* interior.** The switch needs `|dz|²`
under `2⁻⁶⁴`, which takes many periods of whatever component a sample is in, and at this
depth the nearby periods are of the order of the cap itself.

**What the skip is worth on them**, at each frame's own cap, the interior switch **on**
because that is what ships:

| frame | plain wait | ε = 2⁻⁵³ | 1e-12 | 1e-9 | Δ counts @1e-12 | @2⁻⁵³ | mask moved @2⁻⁵³ |
|---|--:|--:|--:|--:|--:|--:|--:|
| tangle 1e-22 | 197 s | 0.64× | **1.00×** | 1.38× | 76 | 24 | 0 |
| tangle 1e-28 | 244 s | 0.98× | **1.38×** | 2.19× | 161 | 56 | 0 |
| pinch 1e-28 | 241 s | 0.96× | **1.21×** | 1.49× | 213 | 78 | 1 |
| tangle 1e-40 | 363 s | 1.38× | **1.72×** | 2.45× | 127 | 45 | 0 |
| tangle 1e-54 | 480 s | 1.92× | **2.58×** | 3.49× | 113 | 39 | 0 |
| body 1e-22 | 786 s | 0.58× | **0.79×** | 1.22× | 372 | 190 | **15** |
| body 1e-28 | 1,049 s | 0.87× | **1.15×** | 1.84× | 371 | 174 | **20** |

64×36, one thread, alternated, best of two. The wait is the tab's own fine pass, derived as
`1,859,584 lanes × mean iterations × ns × 1.05 / 4.7` — the canvas `explorer/README.md`
measures on, wasm's 5% over native from §4, and the pool's effective parallelism from the
audit.

**§6's 59× was a property of having no exterior in the frame.** An interior sample sits by
the reference and never rebases, so a run of 2,048 is available to it at every index; an
escaping sample wanders off and rebases, and the runs the table can offer it are short. Put
structure in the frame and the speedup falls by a factor of twenty to sixty, to between a
21% **loss** and 2.6×.

**The body pair was expected to be the skip's best case and is its worst.** Forty-four
percent of `body 1e-22` runs 374,400 iterations without escaping, which is exactly the
shape a skip table wants — and the table can only skip 12.7% of the frame's iterations at
`2⁻⁵³` and 37.4% at `1e-12`, against 22% to 73% on the tangle frames. Those long samples do
not stay by the reference; they rebase.

**And there is no tolerance at which nothing moves.** Walked from 1e-12 down through nine
tolerances to `2⁻⁵³`, every frame moved escape counts at every one of them — 24 to 190 at
the floor, while still skipping 13% to 73% of the iterations. Worse, on the body pair the
**interior mask itself moves at the floor**: 8 escaping samples painted interior and 7 let
escape on `body 1e-22`, 8 and 12 on `body 1e-28`, with a worst error of 35,000 and 11,700
smooth counts. That is the one thing this crate has never let an approximation touch, and
`2⁻⁵³` is the tightest tolerance the approximation admits — there is nothing below it to
try. **The knob cannot be set to a value at which the skip both fires and agrees.**

These differentials are the same kernel against itself on the same orbit, differing only by
the skip, so a moved count here is the skip's and not the frame's own chaos — which is what
§6 could fairly say about its `1e-9` column and cannot be said about these.

**Where the skip is still enormous is where the picture is one colour.** On the
100%-interior `anchor 1e-22` the switch alone takes the frame from 1,034 ms to 34 ms and the
skip beside it to **1 ms** — a further 34×, on a rectangle of uniform interior.

**So the recommendation is that the skip comes out**: `src/bla.rs`, the `BLA` arm in
`kernel.rs`, the `bla` field on `Spec`, and the 8.4% of `perturb.wasm` they cost for a path
nothing can reach. What would have to change for it to stay is not code but the bar. The
skip buys 1.0× to 2.6× on the frames a reader opens, rising with depth, in exchange for a
picture that is no longer the one the plain loop draws — and this crate's whole argument,
from §1 through §3, is that it draws what the engine draws. Trading that for 2.6× at 1e-54
is a decision about pictures, and this crate has never made one of those.

### 8. The interior switch's rule, and why it cannot be a width rule

| frame | proven interior | plain: off → on | skip at 1e-12: off → on |
|---|--:|--:|--:|
| anchor 2e-11 | 1.3% | +11% | +31% |
| anchor 1e-11 | 4.8% | +13% | +30% |
| anchor 8e-12 | 7.4% | +14% | +30% |
| anchor 6.5e-12 | 11.5% | +13% | +29% |
| anchor 5e-12 | 19.1% | +9% | +26% |
| **anchor 3e-12** | 56.7% | **−3%** | +14% |
| anchor 2e-12 | 89.8% | **−17%** | −5% |
| anchor 1e-12 | 100% | −43% | −35% |
| anchor 5e-13 | 100% | −56% | −50% |
| anchor 1e-13 | 100% | −72% | −68% |
| anchor 1e-16 | 100% | −91% | −90% |
| anchor 1e-19 | 100% | −92% | −91% |
| anchor 1e-22 | 100% | −97% | −97% |
| anchor 1e-28 | 100% | −97% | −98% |
| tangle 1e-22 · 1e-28 · 1e-40 · 1e-54 | 0% | +9% to +10% | +19% to +25% |
| pinch 1e-28, body 1e-22, body 1e-28 | 0% | +10% to +11% | +22% to +23% |

**The crossing is at 3e-12**, where two runs of this table gave +4% and −3% — so that rung
is the crossing to within what the measurement can say, at about **half to two thirds proven
interior**. The minibrot's own atom, 6.5e-12, is *not* the crossing: a frame is still 13%
slower there. Below it the return deepens with the frame, because what the switch waits for
is `|dz|` to fall and a sample further inside the body falls faster.

⚠ **But `anchor 1e-22` is −97% and `tangle 1e-22` is +12%.** Same width, opposite verdicts,
and the same again at 1e-28. **There is no width at which to turn the switch on or off**:
what it pays on is what the frame contains, which is not something a link, a policy or a
worker knows before the frame has been drawn. It ships on, at −64, and on the frames a
reader actually opens it costs 9% to 11%; beside the skip, 19% to 25%, the two competing the
way §6 found. A width rule was the thing this section set out to write, and the table is the
reason there is not one.

## Running it

```text
cargo test  --release                                  # 52 unit tests, under a second
cargo test  --release --test oracle -- --ignored --nocapture   # the ladders, ~30 s
cargo test  --release --test probe  -- --ignored --nocapture   # the three-way probes
cargo test  --release --test bla    -- --ignored --nocapture   # the skip sweep, ~70 s
                                                               #   + the deep half, ~11 min
cargo test  --release --test descend -- --ignored --nocapture  # the frame finder, ~12 min
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
| `raw_bytes` / `gzip_bytes` | **122,098 raw, 56,147 gzipped** |

Two fields of `engine.manifest.json` are **absent** rather than empty:
`engine_version`, because this crate does not link the engine, and
`engine_changes`, because it has never needed a change in it. An empty
`engine_changes` would read as a list somebody forgot to fill in. That the second
one is still true after the tab landed, and still true after the Julia case landed,
is worth saying plainly: the tab shades its field through `engine.wasm`'s existing
`shade_level` on a placeholder viewport, which `explorer/deep.test.mjs` holds to
being sound, so **this crate has never asked the engine for anything**. (The engine
module's own bytes have moved since, for a reason that has nothing to do with this
crate: `explorer_shade_pool_ckpt136` banded the shade.)

**What a visitor downloads for it: nothing, unless they open the Deep tab.** The
module and the tab's five modules are fetched on that tab's first open and never
before. Against `engine.wasm`'s 228,670 gzipped, the 56,147 here is 25% more —
paid only by a reader who asked for a renderer for everything below 1e-10.

`core::fmt` is still most of the size and is still not chased: `plan` formats a
JSON report and every refusal is a sentence, and the tab reads both. Trimming it
would mean giving up the sentences, which are what a refusal is.
