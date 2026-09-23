# perturb — `z^d + c` below the `f64` floor

A Rust crate that renders the smooth field of the degree-2 Mandelbrot set — and,
since `deep_julia_at_c_ckpt136`, of the Julia set of any `c`, and since
`deep_degrees_ckpt140` of both at every integer degree to six — by **perturbation
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
checkout. `src/json.rs` reads the fourteen-member spec and `smooth-cases.json`
pins the one formula that had to come from next door.

```text
src/fx.rs          fixed-point reals, n × u64 limbs, written for wasm32
src/reference.rs   one high-precision orbit per frame, projected to f64
src/kernel.rs      the per-sample f64 delta loop, with rebasing
src/policy.rs      the cap a frame asks for: what died at a cap, and whether
                   raising it would change the picture
src/nuclei.rs      the minibrots in and around a view: atom domains, then a
                   high-precision Newton solve, then a size and a frame
src/json.rs        a reader for one flat JSON object
src/progress.rs    the module's one import, env.progress: how far a long
                   call has got, told while it runs
src/lib.rs         the spec, the width's cap, and the exports
smooth-cases.json  400 of the engine's own samples, as the pin
tests/oracle.rs    the kernel against a brute-force oracle (ignored by default)
tests/probe.rs     three-way probes; not proofs, and they say so
tests/descend.rs   the frame finder: deep frames with structure, and the exact
                   decimal walk that gets to them (ignored by default)
tests/common/      the seven it settled on, as cases, with their links — and
                   the six controls a cap policy has to leave alone; plus the
                   one walk of a sample grid the harnesses share, written to
                   match policy::probe_rows
tests/frames.rs    the two cheap pins on that record: still spellable, still at
                   the cap it claims
tests/measure.rs   what the frames cost and where the rules settle — every
                   table §8 and §9 carry (ignored by default)
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
- **The cap a frame draws at is the frame's own, and §8 is the rule.** The
  width's answer is where the walk *starts*: below about 1e-22 it lands inside the
  frame's own escape-count distribution and a sixth to a third of a busy frame is
  painted as set when it was exterior the count never reached. So a frame is
  probed at that cap, and the cap doubles while samples are still dying with
  `|dz|` past the escape radius. It moves five of the seven deep frames by one
  doubling and repaints a sixth to a third of each; it moves none of the six
  controls at all.
- **The width's own cap is the engine's shape without the engine's ceiling.**
  `maxiter::for_width` saturates at 67,000 by a width of about 4.7e-16, which
  would flatten every perturbation-depth view to one cap. The shape is restated
  here and only `CEILING` moves, to 1,000,000. Touching
  `maxiter::for_width` itself was never an option: six callers read it and a
  wider ceiling there moves the cap of every shallow picture the project has.
- **There is no skip table, and §6 is why.** Bivariate linear approximation was
  built, priced over two rounds and taken back out: on the anchor's own ladder it
  looked like a 59×, but every frame it was measured deep enough to pay on was
  100% interior, and on seven deep frames that have something in them it is
  between a 21% loss and 2.6× **and moves the picture at every tolerance,
  including the tightest one the approximation admits**. Every picture the page
  draws is the plain loop's, which is the whole of what §1 through §3 argue.

### What it does not do

`z^d + c` at integer degrees two to six, `smooth`, and nothing else *(degrees three to six
since `deep_degrees_ckpt140`; §10)*. It draws the two sets each degree has — the parameter
plane and the dynamical one — because they are one recurrence read two ways and one
reference orbit to draw either from, and **not** because it is growing into a wider engine.
No fractional degree, no other family, no other mode. It is one kernel with the degree as a
const parameter, which is the shape `explorer/README.md` always said a deep renderer would
have to take. Two families are closed rather than pending: a fractional degree, because
`(Z+δ)^α − Z^α` fails exactly on the branch-cut seam that is that family's subject, and
Phoenix, because its recurrence needs a second delta lane and a two-point reference.

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
view (`smooth-cases.json`: the seahorse-valley point −0.7436438870371587 +
0.1318259042053120i at width 0.02, cap 12,674, 20×20 — not the 2e-11 anchor, where no
oracle is run), run three ways — this kernel, the plain `f64` loop, and a 384-bit
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

⚠ **And the kernel's own orbit was short of the same bits, which the ladder could not
see** *(found by `audit_deep_families_ckpt140`, fixed in `deep_degrees_ckpt140`,
2026-09-22)*. The delta rides in `f64` and is fine; the *reference* is fixed point, and
it held `c` to the view's bits when the pixels at `z₁` are `step²` apart. The `c = i`
ladder is blind to it because `i` is dyadic — its orbit is exact at any limb count. So
the origin anchor now computes its orbit at `reference::limbs_pow`'s count — twice the
view's sample bits plus the 64 guard bits — and `tests/oracle.rs`'s
`the_origin_anchor_holds_a_non_dyadic_c_to_the_squared_step` is the ladder that can see
it: `M(3,1)` to 130 digits, a real boundary `c` whose orbit uses all of them, 16×9 at a
cap of 20,000.

| width | limbs before → after | median Δ before | median Δ after | interior disagreements |
|---|--:|--:|--:|--:|
| 1e-20 | 4 → 5 | 2.8e-14 | 2.8e-14 | 0 |
| 1e-30 | 4 → 6 | **6.6** | 5.7e-14 | 0 |
| 1e-36 | 4 → 6 | **34** | 5.7e-14 | 0 |
| 1e-40 | 5 → 7 | **11** | 5.7e-14 | 0 |

The "before" column is the audit's run of the committed kernel on the same tile. On the
page's own grid of about 2,272 samples across, the limb rule puts the threshold near
3e-26 — derived, not measured on the page. It costs a longer reference orbit and nothing
per sample. The page's orbit key reads the count off `plan` rather than off
`limbs_for_width`, since a held orbit at the width's count would otherwise pass the key
test for a frame it is too shallow for; and where even sixteen limbs cannot hold the
square — below about 3e-132 at `z = 0` on that grid — `plan` refuses the frame in a sentence.

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

**The reference orbit**: 48,552 points at three limbs in **6.3 ms** native and
**11.2 ms** in wasm, once per frame. Against a frame of 20 s that is
0.03%, and it is the number that would have been paid fifty times over had it
been computed inside a band's `resolve` instead of handed across as a buffer.

⚠ **It was 14.7 ms and 25.4 ms** until `deep_refactor_ckpt138`, and what moved is
`Fx::mul`: the limb count is a compile-time constant inside it now, through a
dispatch to a specialization per `n`, where it used to be a field read off the
operand. The scratch array is the frame's own width rather than the widest this
module carries — twelve `u32`s zeroed at three limbs instead of sixty-four — and,
which is most of the win, every trip count in the loop is known.

| | before | after | |
|---|--:|--:|--:|
| `Fx::mul`, 3 limbs | 97.5 ns | **37.6 ns** | 2.6× |
| `Fx::mul`, 4 limbs | 131.5 ns | **57.8 ns** | 2.3× |
| `Fx::mul`, 6 limbs | 231.8 ns | **99.9 ns** | 2.3× |
| `Fx::mul`, 16 limbs | 1,373 ns | 1,372 ns | 1.0× |
| reference orbit, native | 13.9 ms | **6.3 ms** | 2.2× |
| reference orbit, wasm | 21.6 ms | **11.2 ms** | 1.9× |
| `newton_step`, period 2,838 | 0.82 ms | **0.38 ms** | 2.2× |
| `newton_step`, period 94,776 | 28.1 ms | **12.8 ms** | 2.2× |

Native figures are `scratch/fx_bench`, best of five, the two versions run
alternately because the box drifts about 30%; the wasm pair is the same orbit
through both committed modules. **`ns / sample-iteration` is not in that table
because there is no mechanism for it to move**: nothing per-sample is fixed
point. It was measured anyway — 4.73 against the 4.80 above, interior off, and
5.42 against 5.24 with the switch on — and those are the box on the day, not the
multiply.

**Sixteen limbs buys nothing** and is the fallback arm, still the unspecialized
loop: 256 half-limb products, where the zeroing was never what it was spending.
**The cost is 19.8 KB of module**, 4.0 KB gzipped — fifteen specializations of
one function, and the only reason the gzip figure is the smaller half is
`#[inline(never)]` on it, which is worth 1.1 KB compressed and nothing
measurable in time. The whole of it is paid by a reader who opens the Deep tab,
and what it buys them is a nucleus search at twice the speed: a solve at 1e-54
was 1.96 s.

**Bit-identical, and checked rather than argued.** `Fx::mul` has a test of its
own against the unspecialized version — 3,000 products at every limb count from
2 to 16, both signs, zero limbs among them — and across the two committed
modules the reference orbits at 3, 4, 5 and 6 limbs and the fields drawn from
them are byte for byte the same (`scratch/orbit-parity.mjs`).

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

**`perturb.wasm` is 199,293 bytes raw and 78,382 gzipped** at level 9
(`perturb.manifest.json` carries both) — 112,675 / 52,784 when this paragraph was first
written, grown by the cap policy (§8), the nucleus search (§9), whose Newton solve, decimal
writer and second walk of the loop are most of it, the multiply's fifteen specializations
above, and the degrees of §10, whose monomorphizations are about thirty kilobytes of it.
Beside `engine.wasm`'s 785,424 / 231,149 that is 25% more raw and 34% more gzipped, and it
buys a renderer for everything below 1e-10, on both of the sets `z^d + c` has at each degree
from two to six. It is large for a dependency-free crate of
1,500 lines, and the reason is `core::fmt`: `plan` formats a JSON report and every
refusal is a sentence. That is an attribution from what the module contains rather
than a measurement by subtraction, and if the tab wants the bytes back that is
where to look. There is no `serde`, no `serde_json` and no engine in it.

**9,423 of those bytes were the skip table**, and they came back when it did —
the module was 122,098 raw and 56,147 gzipped while the table was in it, for a
code path that was off by default and that no page could set. §6 is the ruling.

### 5. Pictures

`scratch/perturb-ladder.png` — the anchor, then a `c = i` ladder from 1e-2 to
1e-28, coloured by a percentile stretch and a plain gradient. Not committed;
`scratch/` is ignored, and the sheet is for Matt's eye rather than for a page.

### 6. The skip table, and why it is not here

Bivariate linear approximation — one entry standing for a run of `2^k` steps as
`δ ← A·δ + B·dc`, read out of a table built off the reference orbit — was built,
priced twice, and taken back out. What follows is what it cost to find out, kept
because the seam comment in `kernel.rs` will give somebody the same idea and this
is the only thing that should talk them out of it.

**Measured 2026-09-20**, tiles of 64×36, the plain loop and the skipping loop the
same spec and the same orbit, alternated. `ε` is the share of a linear step the
dropped quadratic term is allowed to be; `2⁻⁵³` is the tightest tolerance the
approximation admits, since below it the dropped term is asked to be under the
last bit of the term beside it.

**On the anchor's own ladder it looked like an order of magnitude and more.** The
headline rows, single thread, interior switch off:

| frame | cap | interior | ε = 2⁻⁵³ | 1e-12 | 1e-9 | 1e-6 |
|---|--:|--:|--:|--:|--:|--:|
| mandelbrot 2e-11 | 48,551 | 38.9% | 0.59× | 0.59× | 0.60× | 0.88× |
| julia 2e-10 | 44,565 | 89.3% | 2.32× | 2.52× | 2.93× | 4.69× |
| mandelbrot 1e-22 | 93,600 | 100% | 1.08× | **59.08×** | 59.11× | 59.51× |
| mandelbrot 1e-28 | 117,518 | 100% | **59.19×** | 58.93× | 58.78× | 60.08× |

⚠ **And every Mandelbrot rung of that ladder below the minibrot's own 6.5e-12
atom is inside its body and 100% interior** — the deepest frame either ladder
carries with exterior in it is `julia 2e-10` — so the depth at which the skip paid
and the depth at which its accuracy had been checked did not overlap. The second round closed that
gap the only way it could be closed — by going and finding deep frames that have
something in them. They are the seven in `tests/common`, and on them the 59× is
**between a 21% loss and 2.6×**:

| frame | plain wait | ε = 2⁻⁵³ | 1e-12 | 1e-9 | counts moved @1e-12 | @2⁻⁵³ | mask moved @2⁻⁵³ |
|---|--:|--:|--:|--:|--:|--:|--:|
| tangle 1e-22 | 197 s | 0.64× | **1.00×** | 1.38× | 76 | 24 | 0 |
| tangle 1e-28 | 244 s | 0.98× | **1.38×** | 2.19× | 161 | 56 | 0 |
| pinch 1e-28 | 241 s | 0.96× | **1.21×** | 1.49× | 213 | 78 | 1 |
| tangle 1e-40 | 363 s | 1.38× | **1.72×** | 2.45× | 127 | 45 | 0 |
| tangle 1e-54 | 480 s | 1.92× | **2.58×** | 3.49× | 113 | 39 | 0 |
| body 1e-22 | 786 s | 0.58× | **0.79×** | 1.22× | 372 | 190 | **15** |
| body 1e-28 | 1,049 s | 0.87× | **1.15×** | 1.84× | 371 | 174 | **20** |

At each frame's own cap, the interior switch **on** because that is what ships.
The wait is the tab's own fine pass, derived as `1,859,584 lanes × mean iterations
× ns × 1.05 / 4.7` — the canvas `explorer/README.md` measures on, wasm's 5% over
native from §4, and the pool's effective parallelism.

Three findings, and together they are the ruling.

**The 59× was a property of having no exterior in the frame.** An interior sample
sits by the reference and never rebases, so a run of 2,048 is available to it at
every index; an escaping sample wanders off and rebases, and the runs the table
can offer it are short. The plain loop's own rebase is also the hard ceiling on a
run — no entry may be built whose run reaches the index the loop rebases at — and
a **periodic reference is refused a table outright**, because the kernel's wrap
assigns `m = 0` rather than `m % length` and a table indexed on an absolute orbit
index has nothing to say about an index that wraps. Put structure in a frame and
the speedup falls by a factor of twenty to sixty. The `body` pair was expected to
be the skip's best case and is its worst: 44% of `body 1e-22` runs 374,400
iterations without escaping, which is exactly the shape a skip table wants, and
the table can still only skip 12.7% of the frame's iterations at `2⁻⁵³` against
22% to 73% on the tangle frames. Those long samples do not stay by the reference;
they rebase.

**And there is no tolerance at which nothing moves.** Walked from 1e-12 down
through nine tolerances to `2⁻⁵³`, every frame moved escape counts at every one of
them — 24 to 190 at the floor, while still skipping 13% to 73% of the iterations.
On the `body` pair the **interior mask itself moves at the floor**: 8 escaping
samples painted interior and 7 let escape on `body 1e-22`, 8 and 12 on `body
1e-28`, with a worst error of 35,000 and 11,700 smooth counts. That is the one
thing this crate has never let an approximation touch, and there is nothing below
`2⁻⁵³` to try. The differentials are the same kernel against itself on the same
orbit, differing only by the skip, so a moved count is the skip's and not the
frame's own chaos.

**The seam costs 70% on every iteration it does not skip.** The `2⁻⁵³` rows at
2e-11 and 1e-16 are 0% skipped and run at 0.59×, which is the lookup alone — an
alignment mask, a bounds-checked index into the table and a radius compare,
against a loop body of about ten flops.

So the skip buys 1.0× to 2.6× on the frames a reader opens, rising with depth, in
exchange for a picture that is no longer the one the plain loop draws — and this
crate's whole argument, from §1 through §3, is that it draws what the engine
draws. What would have to change for it to come back is not code but the bar.
Taking it out returned **9,423 bytes raw and 3,363 gzipped** — 8.4% and 6.4% of
what the module weighs without it, paid until then by every reader who opened the
Deep tab, for a path nothing on the page could reach.

**The frames stay**, because they are the only deep frames this project has that
are not one flat colour. `tests/descend.rs` is how they were got: from the
anchor's minibrot at 1e-11, render a 64×64 tile at the policy cap, recentre on the
busiest boundary neighbourhood it offers, shrink the width tenfold, repeat. **The
centre is an exact decimal the whole way**, which the square tile is what makes
possible — the sample step is `width/64` on both axes, so a recentre is
`(2·col − 63)·78125·10^−(7+p)`, integer addition rather than a double that ran out
of bits twenty rungs up. Three routes, because the first two agreed too well:
`tangle` takes the most boundary crossings in a 5×5, `pinch` the deepest escaping
sample beside a bounded one, and `body` walks every rung at four times the policy
cap, which is what it takes to see a frame with genuine interior in it. Neither of
the first two backtracked once.

| frame | cap | escaped | `dv` link, after `explorer/?` |
|---|--:|--:|:--|
| tangle 1e-22 | 93,600 | 69.5% | `dv=2&x=-0.745017728290198619298817365858&y=0.149934432756897045833502403382&w=1e-22&n=93600` |
| tangle 1e-28 | 117,518 | 80.9% | `dv=2&x=-0.74501772829019861929877929889763684&y=0.14993443275689704583350282968726721&w=1e-28&n=117518` |
| pinch 1e-28 | 117,518 | 82.5% | `dv=2&x=-0.74501772828897655304632685480388684&y=0.14993443275858764694789167606226721&w=1e-28&n=117518` |
| tangle 1e-40 | 165,354 | 74.9% | `dv=2&x=-0.7450177282901986192987792989188510315333046875&y=0.1499344327568970458335028296517884911675546875&w=1e-40&n=165354` |
| tangle 1e-54 | 221,162 | 71.3% | `dv=2&x=-0.745017728290198619298779298918851031533262270733325571484375&y=0.149934432756897045833502829651788491167588360989048041953125&w=1e-54&n=221162` |
| body 1e-22 | **374,400** | 55.7% | `dv=2&x=-0.745017728288852579046129865858&y=0.149934432757626550615361778382&w=1e-22&n=374400` |
| body 1e-28 | **470,072** | 78.9% | `dv=2&x=-0.74501772828885257904614927236638684&y=0.14993443275762655061538134007789221&w=1e-28&n=470072` |

All seven parse and round-trip byte for byte through `explorer/deep-link.js`, and
a cheap test in `tests/frames.rs` holds every centre to the 64 characters a
coordinate is capped at and every cap to the policy's or the stated multiple of it
— the two ways a committed frame goes quietly wrong without rendering anything.
**The deepest is 1e-54 because of the link and not the renderer**: a rung costs
about five seconds a tile there and the descent was still going down, but a centre
is 63 characters at that width and `COORDINATE_LIMIT` is 64.

⚠ **And they found something that is not about the skip at all: at these depths
the policy cap paints exterior as interior.** This is the open problem the section
leaves behind, and it is the most consequential thing in it.
`tests/measure.rs`'s `what_a_deeper_cap_resolves` is the evidence, at 32×18, each
rung a multiple of the width's own **policy** cap:

| frame | at the policy cap | 2× | 4× | 8× |
|---|--:|--:|--:|--:|
| tangle 1e-22 | 29.3% unresolved | 0.2% | 0.0% | 0.0% |
| tangle 1e-28 | 21.0% | 0.0% | 0.0% | 0.0% |
| pinch 1e-28 | 16.5% | 0.0% | 0.0% | 0.0% |
| tangle 1e-40 | 22.7% | 0.0% | 0.0% | 0.0% |
| tangle 1e-54 | 27.4% | 0.0% | 0.0% | 0.0% |
| body 1e-22 | **100%** | 100% | 43.6% | 1.7% |
| body 1e-28 | **100%** | 100% | 21.5% | 0.2% |

On the five tangle and pinch frames a sixth to a third of the picture is
unresolved at the cap the tab would use, and **at twice that cap every one of them
is 100% escaping** for about 2% more mean iterations: those samples were never
interior, they were exterior the cap stopped a few thousand short. The `body` pair
is the same fault four times over — at the policy cap they are a **flat interior
fill**, over escape counts that run from about 100,000 to 400,000. The policy's cap
lands inside the frame's own escape-count distribution, and what a reader sees is
the shortfall painted as set. **The policy moved, and §8 is where** — these seven
frames and six controls beside them are what it was argued on.

**Not one sample of any of the seven is *proven* interior.** The switch needs
`|dz|²` under `2⁻⁶⁴`, which takes many periods of whatever component a sample is
in, and at this depth the nearby periods are of the order of the cap itself.

### 7. The interior switch's rule, and why it cannot be a width rule

| frame | proven interior | plain: off → on |
|---|--:|--:|
| anchor 2e-11 | 1.3% | +11% |
| anchor 1e-11 | 4.8% | +13% |
| anchor 8e-12 | 7.4% | +14% |
| anchor 6.5e-12 | 11.5% | +13% |
| anchor 5e-12 | 19.1% | +9% |
| **anchor 3e-12** | 56.7% | **−3%** |
| anchor 2e-12 | 89.8% | **−17%** |
| anchor 1e-12 | 100% | −43% |
| anchor 1e-13 | 100% | −72% |
| anchor 1e-16 | 100% | −91% |
| anchor 1e-22 | 100% | −97% |
| anchor 1e-28 | 100% | −97% |
| the seven deep frames | 0% | +9% to +12% |

**The crossing is at 3e-12**, where two runs of this table gave +4% and −3% — so
that rung is the crossing to within what the measurement can say, at about **half
to two thirds proven interior**. The minibrot's own atom, 6.5e-12, is *not* the
crossing: a frame is still 13% slower there. Below it the return deepens with the
frame, because what the switch waits for is `|dz|` to fall and a sample further
inside the body falls faster.

⚠ **But `anchor 1e-22` is −97% and `tangle 1e-22` is +12%.** Same width, opposite
verdicts, and the same again at 1e-28. **There is no width at which to turn the
switch on or off**: what it pays on is what the frame contains, which is not
something a link, a policy or a worker knows before the frame has been drawn. It
ships on, at −64, and on the frames a reader actually opens it costs 9% to 12%. A
width rule was the thing this section set out to write, and the table is the
reason there is not one.

### 8. The cap a frame asks for *(deep_cap_policy_ckpt138, 2026-09-20)*

§6's open problem, closed. **The cap is no longer the width's answer alone: a frame
is asked what it needs, and the answer is the frame's.** `src/policy.rs` is the
rule, `tests/measure.rs` is the evidence, and the page drives it a rung at a time
through `probe_band`.

**A width rule was never available**, and §7 had already said why about the
interior switch: `anchor 1e-22` is 100% *proven* interior at the policy cap and
`tangle 1e-22` is 29% cap-starved at the same width and the same cap. What a frame
needs depends on what it contains. So the policy is **self-escalation** — start at
the width's cap, look at what died there, double while the frame is still dying for
want of iterations, stop at the ceiling.

#### The three ways a sample ends `NaN`, and the one that is a fault

The hard half is not the escalation, it is knowing when to stop. **The share of a
frame that dies unproven says nothing on its own.** It is 100% on `body 1e-22` at
both the policy cap and twice it, where the frame is exterior the cap has not
reached; and it is 38% on `anchor 2e-11`, where the frame is the minibrot's own
body — interior the switch cannot prove, because the period is 2,838 and only
seventeen of them fit inside the cap. One number, opposite pictures, and a rule
that read it would multiply the anchor's wait by twenty for nothing.

What separates them is **`|dz|` where the sample stopped**. `Outcome` now hands out
the switch's own mantissa and exponent rather than only comparing them — two field
stores at a sample's exit, nothing added to the loop — and
`Outcome::dz_log2` is what the policy reads. So a `NaN` sample is one of:

- **proven interior** — the switch fired, `|dz|²` fell under `2^-64`. A deeper cap
  confirms it and changes nothing.
- **on its way there** — no proof, but `|dz|` is small and collapsing. Black is
  already the right colour.
- **the cap's fault** — `|dz|` has grown past the escape radius. The map is
  expanding hard here, nothing is settling into anything, and the only reason the
  sample is black is that the loop ran out.

`FAULT_EXPONENT` is that bar: **`log₂|dz|² > 16`, which is `|dz|² > 65,536`, the
escape radius.** Measured at the policy cap, 32×18, over the frames that have to be
told apart — and it is two orders of magnitude of daylight:

| frame | unproven at the policy cap | `log₂\|dz\|²` of those: min / median / max |
|---|--:|--:|
| tangle 1e-22 | 29.3% | 87 / 123 / 157 |
| tangle 1e-28 | 21.0% | 128 / 175 / 211 |
| tangle 1e-40 | 22.7% | 225 / 261 / 364 |
| pinch 1e-28 | 16.5% | 141 / 179 / 233 |
| tangle 1e-54 | 27.4% | 317 / 356 / 404 |
| body 1e-22 | 100% | 27 / 27 / 27 |
| body 1e-28 | 100% | 25 / 25 / 25 |
| **anchor 2e-11** | **37.8%** | **−59 / −3 / 162** |

The `body` pair is the reason the bar is 16 and not 32: at the policy cap their
whole frame sits at 27, which is above the escape radius and below `2^32`. The
anchor is the reason it is not 0.

#### Where it settles, and what it costs

`FAULT_SHARE` is **a tenth**: the smallest share that has to escalate is
`pinch 1e-28` at 17% and the largest that must not is the anchor at 5%.
`where_the_policy_settles`, on the 1136×636 canvas at the fine pass's supersample,
probing 64×36 of that grid — so these are the numbers the page takes:

| frame | policy cap | settled | × | the cap's fault, rung by rung | mean iterations | repainted | deciding |
|---|--:|--:|--:|:--|--:|--:|--:|
| tangle 1e-22 | 93,600 | **187,200** | 2× | 29.4% → 0.2% | 89,230 → 92,524 | **29.2%** | 0.16% |
| tangle 1e-28 | 117,518 | **235,036** | 2× | 19.7% → 0.3% | 109,808 → 112,855 | **19.5%** | 0.16% |
| tangle 1e-40 | 165,354 | **330,708** | 2× | 24.8% → 0.0% | 159,892 → 162,529 | **24.8%** | 0.16% |
| pinch 1e-28 | 117,518 | **235,036** | 2× | 17.2% → 0.1% | 108,488 → 110,471 | **17.1%** | 0.16% |
| tangle 1e-54 | 221,162 | **442,324** | 2× | 28.1% → 0.0% | 215,594 → 219,587 | **28.0%** | 0.16% |
| body 1e-22 | 93,600 | **748,800** | 8× | 100% → 100% → 44.1% → 2.2% | 93,600 → 398,834 | **97.8%** | 0.21% |
| body 1e-28 | 117,518 | **940,144** | 8× | 100% → 100% → 20.9% → 0.1% | 117,518 → 470,687 | **99.9%** | 0.22% |
| anchor 2e-11 | 48,551 | 48,551 | 1× | 5.3% | 32,383 | 0.0% | 0.08% |
| anchor 1e-22 | 93,600 | 93,600 | 1× | 0.0% | 2,838 | 0.0% | 0.08% |
| misiurewicz 1e-22 | 93,600 | 93,600 | 1× | 0.0% | 68 | 0.0% | 0.08% |
| home 3 | 4,000 | 4,000 | 1× | 0.0% | 107 | 0.0% | 0.08% |
| seahorse 1e-6 | 29,819 | 29,819 | 1× | 0.0% | 169 | 0.0% | 0.08% |
| julia anchor 2e-9 | 40,578 | 40,578 | 1× | 1.9% | 12,677 | 0.0% | 0.08% |

**`repainted` is the whole point**: the share of the frame that was painted as set
at the width's cap and escapes at the settled one. A sixth to a third of each
tangle, effectively the whole of each `body` — they were flat black fills over
escape counts running to 400,000 — and **nothing at all on any of the six
controls**, which is the other half of the requirement and was the harder half to
meet.

**Five of the seven settle at twice the cap for 2% to 3.7% more mean iterations**,
which is §6's own finding turned into a policy. The `body` pair costs four times
the work, and that is what it costs to draw a frame the old cap could not see into
at all.

**Deciding costs 0.08% to 0.22% of the fine pass it decides for**, because the
probe is 2,304 of the frame's own sample cells — about a thousandth of one pass —
at the frame's own limb count, through the frame's own geometry. So the
supersampled pass runs **once**, at the settled cap. Nothing about the decision is
an approximation of the thing decided; only the number of samples is smaller.

#### The bar and the share are on a plateau

`the_bar_and_the_share_sit_on_a_plateau` walks every rung of all thirteen frames
and reads it twenty-five ways: five bars from 8 to 24, five shares from 5% to 15%.
**Twenty-two of the twenty-five give the same thirteen answers.** The three that
differ are all share = 5%, at bars 8, 12 and 16, and all move one frame —
`anchor 2e-11` — by one doubling. Neither number is quoted to a second digit
because neither deserves one.

#### What is not decided here

**A pinned cap is drawn as pinned.** Escalation is the *policy*, so it runs where
the width's answer is in force and nowhere else: a cap a reader typed, and a cap a
link carries, are drawn exactly as asked. That distinction already existed on the
page as `pinnedCap` and needed no new control.

**And a frame can run out of ceiling.** The walk stops at `cap::CEILING`, a
million, and `Settled::at_ceiling` says the frame is still the cap's fault there.
None of the thirteen reaches it. What a page does with that is a sentence, not a
retry.

### 9. The minibrots in and around a view *(deep_nearby_minibrots_ckpt138, 2026-09-20)*

`src/nuclei.rs`. Find the nuclei a frame holds, rank them by size, and frame each
one. Two halves, cheap then expensive: **atom domains** say where and roughly
what, **Newton** says exactly where.

The index at which a sample's `|z|` is smallest is the period of the component
whose atom domain it sits in, so a coarse grid partitions a view into one region
per nucleus for one walk of a few thousand cells
(`Kernel::domain_with`). Then `z_p(c) = 0` is solved from the best cell of each
region. The grid is `policy`'s own probe grid, for `policy`'s reason.

#### The derivative does not go in fixed point, and that is what makes it affordable

`d = dz_p/dc` at a nucleus of atom size 1e-44 is of order **1e44**, and `Fx`'s
integer limb holds about 4.6e18 — so carried there it would overflow, silently,
which is the failure `reference::orbit`'s bailout check exists to avoid. It does
not need to be there: a Newton correction and a size estimate want **relative**
precision, so `d` and the size product ride as an `f64` mantissa with a
power-of-two exponent, which is the interior switch's own representation.

Two things follow. A step costs **three `Fx` multiplies per orbit step** instead
of seven, because only `z` is still fixed point. And the correction is formed in
`f64`, so one step is worth sixteen digits past the size of the step before it:
from a seed a grid cell away at 1e-22 the errors run 1e-22 → 1e-38 → 1e-54 →
1e-70. **Four to eight steps**, measured, with residuals of 1e-53 to 1e-125.

`Fx::to_decimal` was written for this and is the crate's first way *out* of a
fixed-point number: until now `parse` read a centre in and `to_f64` — two limbs —
was the only way back, and a nucleus solved at 1e-44 that could only leave as a
double would be a place nobody could open.

#### Harmonics, and the two rules that make a list

**`z_p(c) = 0` implies `z_kp(c) = 0`**, so the domain walk reports multiples of a
period as readily as the period, and Newton takes every one of them to the *same
point*. Their size is then degenerate, because the product `l = ∏ 2·z_k` runs
through `z_p = 0` and collapses. On the audit's anchor the first run returned
periods 5,676, 8,514, 17,028, 22,704 and 39,732 — 2×, 3×, 6×, 8× and 14× of 2,838
— all at the anchor's own centre, reporting bodies of 1e11 to 1e44. So: **lowest
period first, then one nucleus per place**, where a place is one sample of the
frame. Deduplicating by *where Newton lands* and never by what it was asked for
is the whole fix.

**And a minibrot larger than the view is not in the view, it contains it.** All
four tangle frames sit inside one period-14,190 body of 5.2e-13, which the walk
duly finds from 1e-22 and from 1e-54 alike.

#### The size is the body, and it is the *square* of what `1/|A|` gives

`1/|l|` is the atom **domain** — the neighbourhood the nucleus dominates — and not
the minibrot. The body is Vepstas' `1/|b·l²|`, `b = 1 + Σ 1/l_k`. On the anchor
`1/|l|` is **9.75e-6** and the body is **6.478e-12**: the bare square over a `|b|`
of 14.7, and 6.478e-12 is the number this README has recorded since the kernel
landed. That relation is also the prompt's own arithmetic — a minibrot found in a
view at 1e-n sits near 1e-2n — and a tile framed on the domain would put the
minibrot in it at a millionth of the frame. `tests/nuclei.rs`' anchor case is the
pin: solved from a quarter of an atom away, it must come back to the committed
centre and to 6.478e-12, neither of which this code produced.

#### ⚠ A tile's cap is not the width's to give, and this is what makes it expensive

**The most consequential measurement here.** At a tile of a period-94,776
minibrot the width policy gives about 150,000 iterations, which is **one and a
half periods**, and the tile is **100% unresolved — a flat black rectangle, drawn
slowly**. `what_a_preview_tile_needs`:

| periods | cap | escaped | starved |
|--:|--:|--:|--:|
| 1.5 (the width policy) | 150,478 | 0.0% | 100% |
| 2× policy | 300,956 | 0.0% | 100% |
| 4 | 379,104 | 0.0% | 100% |
| **8** | **758,208** | **74.4%** | 25.6% |
| 16 | 1,000,000 | 85.4% | 14.5% |
| 32 | 1,000,000 | 85.4% | 14.5% |

A point near a period-`p` minibrot needs many periods before anything about it
resolves. A tile is the one frame on this site that *knows* its own period — it is
centred on a nucleus just solved — so `TILE_PERIODS` is 8 and `tile_cap` is that
or the width policy, whichever is larger. Everywhere else the cap is the frame's
to ask for (§8) precisely because nothing knows what the frame contains.

**The cost is then `samples × 8p`, and `p` at these depths is of the order of the
cap itself.** That is a finding and not a tuning, and it is what the tab's list
had to be shaped around.

#### What a search costs, on the eight frames

`what_the_nucleus_search_finds_and_what_it_costs`, native, one idle box. Detection
and solves are single-threaded here and go over the pool on the page; tiles are
timed at 80×45 and scaled to 316×178, wasm's 1.05× and the pool's 4.7×.

| frame | settled cap | detect | domains | s/solve | kept | link-reachable |
|---|--:|--:|--:|--:|--:|--:|
| tangle 1e-22 | 187,200 | 1.77 s | 17 | 0.33 s | 6 | **6 of 6** |
| tangle 1e-28 | 235,036 | 2.16 s | 37 | 0.53 s | 6 | **6 of 6** |
| tangle 1e-40 | 330,708 | 3.13 s | 18 | 1.09 s | 6 | 0 of 6 |
| pinch 1e-28 | 235,036 | 2.12 s | 16 | 0.52 s | 6 | 2 of 6 |
| tangle 1e-54 | 442,324 | 4.24 s | 29 | 1.96 s | 6 | 0 of 6 |
| body 1e-22 | 748,800 | 7.75 s | 135 | 0.91 s | 6 | **6 of 6** |
| body 1e-28 | 940,144 | 9.23 s | 47 | 2.28 s | 6 | **6 of 6** |
| anchor 2e-11 | 48,551 | 0.62 s | 36 | 0.05 s | 6 | **6 of 6** |

**Two walls, and they land in the same place.** A `dv` centre is capped at 64
characters, so a tile below about 1e-54 cannot be spelled; and 8 periods of a
nucleus past 125,000 is over the million-iteration ceiling, so its tile cannot be
resolved either. The `tangle 1e-40` and `tangle 1e-54` tiles come back **100%
interior at the ceiling** — black, and not fixable under it. Both walls sit at a
view of roughly 1e-30, which is where this feature stops having anything to offer.

#### The nucleus reference buys nothing on a tile

The question §2 left for a later prompt — 20.5 rebases a sample at 1e-28 against
the view centre, none at all against the wrapped nucleus — is answered here, and
the answer is **no gain**:

| frame | period | view-centre reference | nucleus reference | gain | rebases |
|---|--:|--:|--:|--:|--:|
| tangle 1e-22 | 94,776 | 14.03 s | 14.39 s | 0.97× | 15.1 / 12.2 |
| tangle 1e-28 | 100,617 | 16.74 s | 16.09 s | 1.04× | 13.9 / 10.9 |
| pinch 1e-28 | 107,349 | 18.03 s | 17.40 s | 1.04× | 13.2 / 10.6 |
| tangle 1e-40 | 238,557 | 22.98 s | 21.92 s | 1.05× | 2.1 / 0.0 |
| tangle 1e-54 | 205,425 | 23.68 s | 21.93 s | 1.08× | 2.0 / 0.0 |
| body 1e-22 | 244,068 | 21.86 s | 20.81 s | 1.05× | 1.7 / 0.0 |
| body 1e-28 | 354,750 | 22.57 s | 22.20 s | 1.02× | 1.0 / 0.0 |
| **anchor 2e-11** | **2,838** | **0.45 s** | **0.42 s** | **1.05×** | 15.2 / 13.1 |

**Because a tile is already centred on its nucleus, the view centre *is* the
reference.** §2's 20.5 rebases were measured on a frame nudged a quarter-frame off
the nucleus; there is no such offset here, and naming the period only changes
whether the orbit *wraps* or is walked to the cap. What that buys is the orbit's
size — one period instead of the whole cap, 45 KB against 777 KB at the anchor —
and not its speed. **Whether it pays on an ordinary frame, whose centre is not a
nucleus, is a different question and is still open.**

### 10. Degrees three to six *(deep_degrees_ckpt140, 2026-09-22)*

`audit_deep_families_ckpt140` sized this and found nothing in the method that depends on
the degree: the stored orbit from `Z₀ = 0` is the critical orbit of `z^d + c`, so
Zhuoran's rebase, both Julia anchors and the Julia case as "the same loop with `dc` spent
once" carry over unchanged. What changes is four lines, and `D` is a const generic on
`Kernel::run` beside `JULIA`:

- **the step** is `(Z + δ)^d − Z^d (+ dc)`, as the binomial in Horner form in `δ` — `2d − 3`
  complex multiplies, the powers of `Z` formed per step from the point the loop holds.
  Precomputing `C(d,k)·Z^{d−k}` per orbit point was slower at every degree the audit tried
  (the orbit's memory traffic is §4's finding), so it is not done;
- **the interior switch's slope** is `d²|z|^{2(d−1)}`;
- **the smooth count's base** is `ln d`, the engine's own `degree.ln()`;
- **the reference orbit** is `z^d` in fixed point, and continues in `f64` once `|Z| ≥ 8`.
  The bailout is checked after the step, and at degree four an iterate under `2^16`
  raised to the fourth power wraps the signed integer limb with no error — the silent
  failure the bailout-first rule above exists for. `newton_step` has the same shape and
  the same guard.

At `d = 2` each of the four is the line that was there, chosen by a compare the
compiler folds, so the degree-2 picture is the same arithmetic and not merely the same
answer. `tests/oracle.rs`'s `degree_two_draws_the_bytes_it_drew_before_the_degree_was_a_parameter`
pins it: `tangle 1e-28` at its settled 235,036, 32×18, hashed before and after, equal.

**Measured** (all in `cargo test`, the ladders `--ignored`):

| check | result |
|---|---|
| shallow, the whole set, 41×41 at width 3, `d = 3..6`, against the plain `f64` loop | ≤1 mask disagreement of 1,681, median relative error 0 |
| the same for the Julia sets at `z = c` | ≤1 mask disagreement, median relative error 0 |
| each degree's `M(2,1)` at 1e-16, 1e-28 and 1e-40, 16×9, against a fixed-point oracle at that degree | 144 of 144 escaping, 0 mask disagreements, median Δ ≤ 7.1e-15, worst ≤ 5.6e-8 |
| the Julia set of that `c` at `z = c`, 1e-28 | 144 of 144, 0 disagreements, median Δ 7.1e-15 |
| the origin anchor at `16·10^(−40/d)`, at `d×` the view's bits | 0 disagreements, median Δ ≤ 7.1e-15 |

**What it costs**, native, a near-parabolic interior `c` so that every sample runs the
whole cap of 117,518 (equal work across degrees), best of three, ns a sample-iteration:

| d | reference orbit | Mandelbrot | Julia | × d = 2 |
|--:|--:|--:|--:|--:|
| 2 | 25 ms | 4.9 | 4.0 | 1.00 |
| 3 | 53 ms | 9.6 | 8.7 | 1.96 |
| 4 | 78 ms | 13.3 | 12.4 | 2.72 |
| 5 | 110 ms | 18.3 | 17.1 | 3.73 |
| 6 | 123 ms | 23.0 | 22.1 | 4.68 |

The cap a frame draws at has no term for the degree — `cap::for_width` reads the width and
§8's probe reads the frame — so what a higher degree costs a reader is the per-iteration
price above and nothing more; how many iterations a frame takes is the picture's.

⚠ **About 15% slower at `d ≥ 3` than the audit's own harness loop**, measured in one
binary against one orbit (8.2 against 9.6 ns at `d = 3`). The arithmetic is the same;
dropping the degenerate-sample diagnostic did not move it, and a runtime binomial did
not either. Degree two did not slow down — 4.9 against the committed kernel's 4.94 — so
it is the shipped path's codegen at the larger step and not a regression, and it is left
as a number rather than chased.

**The module grew by 30,597 bytes raw, 8,525 gzipped** (168,553 → 199,150 raw, 69,755 →
78,280 gzipped): ten monomorphizations of the sample loop and ten of the domain walk,
where there were two of each. The audit estimated 15–25 KB raw.

#### The constants, re-swept at each degree

§3's interior floor and §8's cap policy were calibrated on degree-2 frames only, so each
higher degree got frames of its own and the sweeps were run again on them.

**The frames.** `tests/descend.rs`'s `descend_to_deep_frames_at_a_degree`, once a degree,
from that degree's island pin at 1e-11 — the anchor's kind of start — down the tangle,
pinch and body routes; `tests/common`'s `DEGREE_FRAMES` keeps the same seven kinds of
frame `DEEP_FRAMES` keeps, and `frames.rs` holds all 35 to being spellable and at their
claimed cap. The controls are the degree-2 set's counterparts: the island at about three
bodies (the anchor at 2e-11), the island at 1e-22 (inside its body), the degree's `M(2,1)`
at 1e-22, the whole set, and the Julia set of the island's `c` at 2e-9. The runs take
`MEASURE_DEGREE` and `DESCEND_DEGREE`; the descents were 16 to 33 minutes a degree, run side by side.

⚠ **The first descents started somewhere else and were thrown away.** From period-1,597
nuclei at the main component's golden-mean boundary point, degree three's `tangle 1e-22`
settled at eight times the width's cap and most rules ran it to the ceiling. That is a
near-neutral, Siegel-like neighbourhood where orbits linger, and it said nothing about
the degree — so the frames were found again from islands, where the tables below read
against §8's row for row.

**Where the cap policy settles**, as multiples of the width's cap:

| frame | d = 2 (§8) | d = 3 | d = 4 | d = 5 | d = 6 |
|---|--:|--:|--:|--:|--:|
| tangle 1e-22 | 2× | 8× | 2× | 4× | 4× |
| tangle 1e-28 | 2× | 4× | 2× | 4× | 4× |
| tangle 1e-40 | 2× | 4× | 2× | 4× | 2× |
| pinch 1e-28 | 2× | 2× | 4× | 4× | 2× |
| tangle 1e-54 | 2× | 4× | 2× | 4× | 2× |
| body 1e-22 | 8× | 10× (the ceiling, 4.5% left) | 8× | 10× (the ceiling, 6.2% left) | **the ceiling, 22.7% left** |
| body 1e-28 | 8× | 8× | 8× | 8× | **the ceiling, 21.9% left** |
| the five controls | 1× | 1× | 1× | 1× | 1× |

Deciding costs 0.08% to 0.27% of the fine pass at every degree, as at two. The deep frames
at degrees three and five want one more doubling than degree two's; that is what the probe
is for, and nothing about it asks for a different rule.

⚠ **At degree six both body frames run out of ceiling** — still 22.7% and 21.9% the cap's
fault at a million — and the page says so: Details' stat line ends *at the ceiling: x%
undecided* on such a frame (`explorer/README.md`). At three and five `body 1e-22` reaches
the ceiling and resolves there, at 4.5% and 6.2%. These are the first frames a reader can
reach that the ceiling binds on, and **it stays at a million by Matt's ruling**: the limit
is kept and the tab says where it binds, rather than being raised. (The doc comment on
`cap::CEILING` in `src/lib.rs` still calls it provisional and says it binds on nothing; it
is left, because any source edit here moves `perturb.wasm`'s bytes.)

**The bar and the share** (`FAULT_EXPONENT` from 8 to 24, `FAULT_SHARE` from 5% to 15%),
twenty-five rules a frame:

- **d = 3**: the bar moves nothing on any frame. The share does, by one doubling, on four
  of the seven deep frames — each crosses 10% somewhere between its last two rungs (9.0%,
  9.3%, 5.5% …), so ≤8% and ≥10% settle a rung apart. Narrower than degree two's, and
  still stepwise rather than drifting.
- **d = 4**: flat, but for `pinch 1e-28` (4× below 12%, 2× from it) and `body 1e-28` (8×,
  4× at 15%).
- **d = 5**: flat, but for `tangle 1e-54` (4×, 2× from 12%) and `body 1e-22` (10×, 8× at 15%).
- **d = 6**: flat in the share, and **the bar's plateau ends between 16 and 20**: at bars of
  20 and 24 `body 1e-22` is not escalated at all (1×) where 8 to 16 take it to the ceiling.
  Its starved exterior sits at `log₂|dz|²` just under 20 at this degree. `FAULT_EXPONENT = 16`
  is inside the plateau, at its upper edge.

The controls are 1× under every one of the twenty-five rules at every degree. **So the
constants stay shared** — 16 and a tenth — and no degree reads the plateau differently
enough to earn its own.

**The interior floor** (§3's sweep, on the policy's 64×36 of the island at three bodies and
the two body frames, OFF against ON at every floor from −300 to −4):

| d | island: interior, caught at −64 | iterations saved at −64 | wrongly painted at −64 | anywhere in the sweep |
|--:|--:|--:|--:|--:|
| 2 (the anchor) | 896, 29 | 0.4% | 0 | 0 |
| 3 | 724, 710 | 93.6% | 0 | 0 |
| 4 | 865, 854 | 95.1% | 0 | 0 |
| 5 | 892, 885 | 95.8% | 0 | 0 |
| 6 | 975, 967 | 96.4% | 0 | **1, at −4** |

On the body frames the switch never fires at any floor or degree: their interior is of
periods the cap barely holds. The islands above two are low-period (12 and 13) minibrots,
which is why the switch catches nearly all of them; the anchor's period is 2,838. **−64
stays**, and ⚠ §3's closing remark that −4 "on this evidence is safe" does not survive
degree six: one escaping sample of the island frame is painted interior there, and
`measure.rs`'s sweep now asserts at the shipped floor and reports the others.

**`TILE_PERIODS`**, re-measured on the three largest nuclei in each degree's `tangle 1e-22`
(80×45, share escaped):

| d | 4 periods | **8 periods** | 16 periods | 32 periods |
|--:|--:|--:|--:|--:|
| 2 (§9) | 0.0% | **74.4%** | 85.4% | 85.4% |
| 3 | 29–32% | **73–74%** | 88% | 88% |
| 4 | 73–79% | **88–94%** | 89–96% | 89–96% |
| 5 | 50–51% | **77–80%** | 88% | 89% |
| 6 | 69–76% | **87%** | 88–89% | 88–89% |

Eight is at or past the knee at every degree, so it stays shared.

#### Minibrots at degree `d`, and the pins that measure them

**Newton is `d·z^{d−1}` and the body is `1/|b·l^{d/(d−1)}|`.** Near a period-`p` nucleus
the `p`-th iterate is `z ↦ λ·z^d + β·Δc` to first order, and rescaling `z` so that `λ`
goes makes it the whole Multibrot set again, scaled by `1/|β·λ^{1/(d−1)}|` — which is
Vepstas' `1/|b·l²|` at degree two. What that moves on the page: a view at 1e-n finds its
minibrots near 1e-(d/(d−1))n, so 1e-1.5n at degree three and 1e-1.2n at six, where it was
1e-2n. `nuclei::body_power` and `body_scale` carry it; the solve's limbs and tolerance
follow the body rather than the square of the view.

**The size was pinned against a measurement that does not use it.** A minibrot is the
whole set scaled by its size, so the interior share of a tile around one, over the whole
set's interior share on the same grid, is the size squared — at matched caps, `K` for the
set and `K·p` for the tile, because an escape count near a period-`p` copy is `p` times
the count at the matching point of the set. 300×300 samples, 6 bodies across:

| nucleus | period | formula | measured, K = 1,024 | ratio |
|---|--:|--:|--:|--:|
| degree 2, the anchor | 2,838 | 6.4775e-12 | 6.6706e-12 (K = 256) | 1.030 |
| degree 2, off `−2` | 13 | 2.2229e-12 | 2.2185e-12 | 0.998 |
| degree 3, off its `M(2,1)` | 12 | 3.4925e-12 | 3.4792e-12 | 0.996 |
| degree 4 | 13 | 1.4074e-12 | 1.4068e-12 | 1.000 |
| degree 5 | 13 | 3.4035e-12 | 3.4052e-12 | 1.001 |
| degree 6 | 13 | 5.9077e-12 | 5.9105e-12 | 1.000 |

Lower-period islands of each degree, at 1e-7 to 1e-10, landed the same way (0.997 to
1.005). **Every degree's pin lands**, and `nuclei.rs`'s
`each_degrees_island_is_found_and_sized_against_a_measured_body` holds the formula to the
measured body at 1% and the solve to landing within 1e-29 from a quarter of a body away.

⚠ **An island, and not a satellite.** The same measurement on period-1,597 nuclei at the
main component's golden-mean boundary came out at 3.1 to 4 times the formula and did not
converge with `K`. Those are almost certainly bulbs attached to the main component rather
than copies of the set — their periods are Fibonacci numbers (610, 987, 1,597, …), which is
what the bulbs nearest a golden-mean boundary point have — and the renormalisation says
nothing about a bulb. The search cannot tell the two apart and
neither could it at degree two; what the list offers there is framed on a size that is an
island's, and a satellite's tile is framed too tight.

## Running it

```text
cargo fmt   --check                                    # the formatting, held: the
                                                       #   crate is rustfmt-clean and
                                                       #   stays that way
cargo test  --release                                  # 70 unit tests and six
                                                       #   cheap pins, about a second
cargo test  --release --test oracle -- --ignored --nocapture   # the ladders, ~30 s
cargo test  --release --test probe  -- --ignored --nocapture   # the three-way probes
cargo test  --release --test measure -- --ignored --nocapture  # the cap sweep, the
                                                       #   policy, and the nucleus
                                                       #   search, ~12 min
cargo test  --release --test descend -- --ignored --nocapture  # the frame finder, ~12 min
# §10: every harness of measure.rs at another degree, and the finder there
MEASURE_DEGREE=3 cargo test --release --test measure -- --ignored --nocapture
DESCEND_DEGREE=3 cargo test --release --test descend -- --ignored --nocapture at_a_degree
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

**The module has one import, `env.progress(done, total)`** *(deep_tab_activity_and_
layout_ckpt141)*, and whoever instantiates it supplies it — `bench/perturb.mjs` and the
page's own planner with a function that does nothing, `deep-worker.js` with one that posts
at most every 100 ms. A wasm call cannot be looked into, and a reference orbit at a million
or a probe rung beside a parabolic point is seconds inside one export; `src/progress.rs` is
called every 4,096 orbit steps and once a probe or domain-walk cell, so the page can tell a
slow frame from a stranded pool. Natively it compiles to nothing, and every native test is
unmoved. Measured on the rebuild: the orbits, fields and probe counts of four frames came
back byte for byte what the module before it produced, in 10.82 s against 10.83 s.

| field | what it holds |
| --- | --- |
| `schema` | the record's own version, `1` |
| `built` | the date of the build |
| `crate` | `explorer/perturb-wasm` |
| `dependencies` | `[]`, and it is written down because it is the design |
| `rustc` | the compiler, with its commit and date |
| `raw_bytes` / `gzip_bytes` | **199,293 raw, 78,382 gzipped** |

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
before. Against `engine.wasm`'s 231,149 gzipped, the 78,382 here is 34% more —
paid only by a reader who asked for a renderer for everything below 1e-10.

`core::fmt` is still most of the size and is still not chased: `plan` formats a
JSON report and every refusal is a sentence, and the tab reads both. Trimming it
would mean giving up the sentences, which are what a refusal is.
