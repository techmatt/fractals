# perturb — the Deep tab's kernel, as wasm

The crate `perturb` wraps the deep picture kernel for the explorer's Deep tab and builds it
to the two modules the page loads: `perturb.wasm`, with wasm SIMD, and
`perturb-scalar.wasm`, the fallback for an engine without it. It has no UI, no page and no
link contract: those are `explorer/README.md`'s, written against what this exports.

**The kernel is not here** *(deep_seam_move_ckpt163)*. The fixed-point reals, the
reference orbit, the delta loop, the cap policy and the spec are the crate
`fractal-wallpapers/perturbation`, in the sibling checkout, which `fractal-engine
render-link` also builds natively to draw `dv=` links — one copy for the page and the CLI.
This crate depends on it by path (`../../../fractal-wallpapers/perturbation`), re-exports
it, so `perturb::kernel` and the rest still resolve, and keeps what only the explorer asks
for:

```text
src/lib.rs               the 25 extern "C" exports the page calls, over the kernel's
                         functions, and plan's JSON report
src/nuclei.rs            the minibrots in and around a view: atom domains, then a
                         high-precision Newton solve, then a size and a frame (§9)
src/dive.rs              the Dive block: a copy's scale, the twin's shooting, the rung
                         rule, the landings, the cap rule, and New coloring's rule (§11)
build.rs                 empty, and kept: a build script's presence is in cargo's
                         -C metadata hash, and deleting it moves both modules' bytes
tests/probe.rs           three-way probes; not proofs, and they say so
tests/descend.rs         the frame finder: deep frames with structure, and the exact
                         decimal walk that gets to them (ignored by default)
tests/measure.rs         what the frames cost and where the rules settle — every
                         table §8 and §9 carry (ignored by default)
tests/classify_speed.rs  §12's frame set and both root solves (ignored by default)
```

`descend.rs`, `measure.rs` and `classify_speed.rs` read the kernel's record of deep frames,
`fractal-wallpapers/perturbation/tests/common`, by `#[path]` across the two checkouts.

**Sections §1 to §8 moved with the kernel**, to `fractal-wallpapers/perturbation/README.md`,
and kept their numbers there, so a §2c or a §8 cited from this repository is that file's
section of the number:

| § | heading in `fractal-wallpapers/perturbation/README.md` |
| --- | --- |
| — | *The design, in one page*, and *What it does not do* |
| — | *What the engine needed* |
| 1 | *1. Against `f64`, where `f64` still draws* |
| 2 | *2. Against a brute-force oracle, below the wall* |
| 2b | *2b. The Julia case, against the same oracle* |
| 2c | *2c. A reference somewhere else in the frame* |
| 3 | *3. The interior switch* |
| 4 | *4. Price* |
| 5 | *5. Pictures* |
| 6 | *6. The skip table, and why it is not here* |
| 7 | *7. The interior switch's rule, and why it cannot be a width rule* |
| 8 | *8. The cap a frame asks for* |

What stayed here is §9 to §12, the explorer's own: the minibrot search, the degrees it
reaches, the Dive, and the root test. In them a `src/` or `tests/` path is this crate's
unless it starts `fractal-wallpapers/perturbation/`, and `Kernel`, `Fx`, `reference`,
`policy`, `cap` and `Spec` are the kernel's, reached through the re-export.

**Why a second crate and a second module.** `engine.wasm` is the explorer's
shallow renderer, and nothing in here, or in the kernel this
wraps, is linked into it: `engine-wasm` takes the engine with `default-features = false`,
which leaves out the engine's own native path to the kernel. So the shallow path — every
shallow picture, every shallow key, every byte of that module — cannot be slowed,
re-ordered or moved by anything written here, because the compiler never sees the two
together. The two meet on the page, at a buffer of `f64` lanes: this module's output is
what `engine.wasm`'s `compute_band` produces for `smooth`, in the same layout, so the
existing `shade_level` colours it without being told which kernel drew it.

## Proof, continued: what only the explorer asks for

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
minibrot in it at a millionth of the frame. `src/nuclei.rs`' own tests' anchor case is
the pin: solved from a quarter of an atom away, it must come back to the committed
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

**An opened copy is drawn at 32 periods, not 8** *(find_minibrots_cap2_ckpt145)*.
The table above is a 316-pixel tile's escaped share, and at that size eight reads.
The frame a reader opens from the list is the viewer's own, several times the
pixels, and there a copy at about thirteen of its periods was an all-black blob.
`OPEN_PERIODS` is 32 and `open_cap` (exported beside `tile_cap`) is that or the
width policy, under the **explicit** ceiling — which binds from period 62,500 (31,250
under the single million-iteration ceiling, before cap_split_ckpt145). The tile keeps
its eight because it is drawn unasked. **And both are framed at `TILE_BODIES` =
12**, not 6: the size estimate is a copy's scale rather than its extent, and a copy
is about two of its own sizes tall, so at six its body filled 0.59–0.61 of a 16:9
frame's height and at twelve 0.25–0.27. *(find_minibrots_bulbs_ckpt145: an opened copy
is now framed by the body its preview measures, and twelve sizes times a per-degree
`FALLBACK_BODIES` factor is the fallback. See `copy_width`.)*

**Thirty-two periods is not a settled frame once the count is held to 1e-5**
*(minibrot_size_pilot_ckpt160)*. The pilot drew 20 copies (degrees 2 to 6) at four screen sizes, with the
body's extent at 10%, 3%, 1% and 0.1% of a 640×360 frame's width at 2×2 samples. Each was
drawn once at up to 1,024 periods, and the unescaped share outside the copy's own body was
read off each sample's ν at every count. Near a copy's rim that share falls only as about
1/count. So the pooled median count that brings it within 1e-5 of where it settles is
**512 periods at 10%, 128 at 3%, 64 at 1% and 256 at 0.1%**. At 0.1% the residue is other
copies' rims in the wide frame. At 32 periods the median residue is 2.5e-4 at 10% and
2–7e-5 at the other sizes. Under the explicit ceiling those counts hold the drawable period to
about 3,900, 15,600, 31,000 and 7,800 respectively. Most copies a carried view leads to are
past that at 10%: copy periods there run 700 to 54,000, median 9,300.

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

**Two walls, and they land in the same place.** A `dv` centre was capped at 64
characters when this was measured, so a tile below about 1e-54 could not be spelled (the
deep cap is 128 since gpu_deep_ship_ckpt162, which moves that wall to a tile of about
1e-112 and leaves the second one where it is); and 8 periods of a
nucleus past 125,000 is over the automatic million-iteration ceiling, so its tile cannot be
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
answer. `fractal-wallpapers/perturbation/tests/oracle.rs`'s
`degree_two_draws_the_bytes_it_drew_before_the_degree_was_a_parameter` pins it: `tangle 1e-28` at its settled 235,036, 32×18, hashed before and after, equal.

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
pinch and body routes; `fractal-wallpapers/perturbation/tests/common`'s `DEGREE_FRAMES` keeps the same seven
kinds of frame `DEEP_FRAMES` keeps, and `tests/frames.rs` there holds all 35 to being spellable and at their
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
is kept and the tab says where it binds, rather than being raised. The doc comment on
`cap::AUTOMATIC_CEILING` in `fractal-wallpapers/perturbation/src/lib.rs` says the same
*(deep_small_fixes_ckpt142; the constant was `cap::CEILING` until cap_split_ckpt145)*. A
reader can still take such a frame to two million with Double, which is the explicit ceiling (§8).

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
`measure.rs`'s sweep now asserts at the shipped floor and reports the others. Since §3's proof
(interior_switch_fix_ckpt162) that sample is let escape, and the sweep is 0 wrongly painted at
every floor and degree; −4 now costs time and never a pixel.

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
nothing about a bulb. The search could not tell the two apart at any degree until
find_minibrots_bulbs_ckpt145, which added `nuclei::classify`; since
dive_primitive_only_ckpt154 that reading is the root test of §12.
The list offers copies first and bulbs only where a view holds no copy;
`explorer/README.md`'s *Find minibrots* has the numbers.

### 11. The dive *(deep_dive_block_ckpt154, 2026-09-27)*

`src/dive.rs` is the arithmetic of the Deep tab's Dive block and of New coloring, and
`builder/deep-gallery-native` runs the same functions natively (`pick`, `land`,
`coloring`), so a frame found either way is a link that opens identically.
`explorer/README.md`'s *The Dive block* is what the page does with it. Four exports:

| export | answers |
| --- | --- |
| `dive_pick(request)` | the rung rule over a search's copies, as parallel arrays |
| `dive_land(request)` | a landing: centre as text, width, cap, turn, and the twin that placed it |
| `landing_periods(kind)` | 32 for the centre, 8 for halfway, so the page asks rather than restates |
| `coloring_rule(field, …)` | New coloring's cycles, λ and period over a field |

**Moved, not rewritten.** `orient` (a copy's complex scale, `σ = d·l^{1/(D−1)}`), `segment`,
`twin` and `body_share` came from the native tool, where the double descent and the
gallery's copy-mapped frames were built on them; the tool now imports them. Two changes to
`twin`, both measured:

- **The shooting is eliminated backward.** It solved the bidiagonal system forward from
  `δw₀ = 0`, and forward the chain grows like the product of the returns' multipliers: for
  the period-998 nucleus nearest a 1e-10 seahorse-valley view, carried into the airship,
  the chain was 1.5e16 and 2.4e19 by the first step, every `δw_k` was a difference of
  numbers that size, and the second step carried a return out of the plane (*step does not
  fit*). Backward from `δw_p = 0` the recursion divides by the multipliers, so it contracts:
  the same twin, period 2,994, converged in six steps, 6.3e-4 down to 1.3e-38. The two
  airship tests that moved with it pass unchanged.
- **Nothing else**: the first-order guess, the seeds and the stopping rule are as they were.

**A mapped landing is anchored, and scaled locally.** A whole-set view `(C, w)` lands at
`twin + s·(C − c_B)`, `w·|s|` wide, where `c_B` is the nucleus nearest `C` (the page's own
search round the view) and `twin` its copy inside `A`. Two measurements say why neither
shortcut is enough. They were retaken on named nuclei at classify_speed_ckpt155
(`scratch/classify_speed/twin_measure.py` and `twin_probe.py`). The view is the seahorse-valley
point −0.7436438870371587 + 0.1318259042053119i, 1e-5 wide, and `B` is the period-78 nucleus
the search finds nearest it. There are two copies: the airship, and the period-15 copy at
0.40034805463804191822 + 0.14068263611691251718i, which the root test reads as a copy.

- **The first-order place `c_A + s_A·C` misses.** Inside the airship it lands 3,391 frames
  across and 1,980 down from the anchored place, and inside the period-15 copy 3,694 across
  and 3,890 down, at 480×270.
- **The copy's own scale is not the scale at the anchor.** `s = 1/σ_A` is the tuning map's
  derivative at `A`'s nucleus, and between there and the anchor the map bends. So `s` is
  `σ_B / σ_twin`, the two nuclei's own scales, which is the local derivative to first order.
  Of the `D − 1` branches, the one nearest `s_A` is taken, being the one continuous with the
  copy. Over four seahorse-valley views `s_A` is 1.2–7.5% off the local scale in size on both
  copies. In turn it is 0.6–2.8° off on the airship and 1.8–5.1° off on the period-15 copy:
  at this view it turns −65.4°, where the local scale turns −70.3°. The interior share at
  480×270 is 0.1458 for the source view, and 0.1280 and 0.1324 for the two landings. Each
  landing is drawn at its landing's cap, the source at its own 1,000.
- ⚠ **What this section used to say was measured on something that is not a copy.** Until
  this retake it said "about 1.1e5 by 1.6e5 frames", "28% too large and turned 83° where it
  should turn 21°", and shares of 0.1273 and 0.1274, all "inside a period-15 copy". No record
  names that point, and the one period-15 "copy" of that week's records is the home view's
  unconverged solve at −0.17771144 + 0.632926556i (§12), which is no nucleus. Its twin does
  not converge today: all four views above fall back to first order. And a true period-15
  copy's error is a tenth of the recorded one. The recorded interior shares belonged to a view
  that is not recorded either, so they were not carried over.

The frame is turned by `arg s` and the explorer draws no rotation, so the page says the turn
rather than undoing it.

**The rung rule** (`pick`) takes, of a search's copies largest first, the first that is a
step down and whose landing fits. With earlier rungs, a step down is the gallery's: a body
under an eighth of the last rung's (`RUNG_SHRINK`) and more than one and a half of each
earlier rung's bodies away from it (`RUNG_APART`). With none, it is a copy whose
`copy_width` is under half the view (`FRESH_SHARE`), so a view already framed on its copy
steps into it. The gallery's period cap of 120,000 is gone: the budget is the cap now.
Refusals name themselves: `no_copy`, `none_smaller`, and `over_budget` with the lowest
period that was a step down and what its landing asked for.

**The cap rule** (`cap_for`) is the width's own cap or `period × count`, whichever is more,
and `fits` refuses a landing whose product passes `cap::EXPLICIT_CEILING` rather than
drawing it short. The count is 32 for the centre (`nuclei::OPEN_PERIODS`), 8 halfway
(`HALFWAY_PERIODS`, the tile's `TILE_PERIODS`), and a carried view's own cap, since that view
carried into a period-`p` copy escapes after about `p` times its own counts. No probe runs:
the product is the depth the landing asks for.

**What the cap rule does to a chain** *(dive_chain_audit_pilot_ckpt160)*. A chain of mapped
landings (a view carried into a copy, then a view carried into a copy inside that one) carries
each view at its own cap, so the whole chain's period, the last copy's, is held to
`2,000,000 / n`. A gallery seat names no `n` and is carried at `cap::for_width`, which is
3,700 to 44,000 over the 300 seat and Dive views the pilot drew (median about 25,000), so a
chain's period product is held to roughly 45 to 540, and about 80 typically. Under that
budget every stage is a low-period copy, and a stage adds a median of only 2.5 to 3.5
decades of zoom at every degree: depth in such a chain comes from the first view, not the
chain. Two things follow for anything that chains landings.

- **Dive's own search does not reach the copies the budget admits.** Below the first stage the
  low-period copies inside the parent are thousands of view-widths from the landed frame, past
  `WIDEN`'s 256×. Widening further does not cure it: `find` seeds from a 64×36 atom-domain grid
  with 24 solves, and over a whole-set frame that grid misses most low-period copies (at
  degree 2 it returns periods 4, 16, 30, 31, 36 and 77, and not the period-3 airship). Over
  20 rows a degree, Dive's own rule landed a depth-3 chain 3 times in 200.
- **A catalogue does.** Copies of period 2 to 64 found by `find` over a 16×9 tiling of the
  home view (486 at degree 2, which has the one period-3 copy, the three of period 4 and 8 of
  the 11 of period 5), the stage's copy taken as the nearest one under a limit on its period,
  and placed inside the parent by `twin`: with the limit at 10, every depth-3 chain landed,
  200 of 200 over degrees 2 to 6.

**The colouring rule** is `deep_gallery.py`'s `choose`, ported: for each λ in `LAMBDAS`
(0, 0.15, 0.3, 0.5, 0.75, 1) the period is the 3rd-to-97th-percentile range of the Box–Cox
`g` over the cycles, to three figures (numpy's linear interpolation, by selection rather
than a sort), and a λ passes where under `ROUGH` (4%) of neighbouring sample pairs are more
than a quarter turn apart. Two things differ, both New coloring's: the cycles are drawn
uniformly from 1 to 4 (the span of the gallery's `CYCLES`, 1.5 to 6, until Matt narrowed it
at dive_mixture_ckpt154; the page's aliasing guard, `explorer/aliasing.js`, then lengthens a
period that reads as static), and the λ is one of those that
pass at random rather than the one nearest a preferred λ, the gallery's preferred λ having
been a rotation for variety itself. Both draws are uniform numbers the caller passes in, so
a caller's randomness is two numbers it can record and the whole rule is here. `ν` is
floored at the engine's `COMPRESSION_FLOOR` first, as the absolute scale floors it. It
reads every neighbouring pair, which is 0.44 to 0.52 s at 1136×639 in node, so the page runs
it on a worker.

**What it cost.** The module is 313,157 bytes raw and 117,312 gzipped, from 237,983 and
90,049 on the same rustc 1.96.0: 75,174 and 27,263 more, nearly all of it the fixed-point
loops of `orient`, `segment` and `twin`, which were never in the module before, and the
float functions they and the rule call (`powf`, `atan2`, `sin`, `cos`) that it did not carry.
Selecting the two percentile ranks instead of sorting moved it by 309 bytes. The machine's
default rustc is 1.98.1 now and builds this crate to 320,887 bytes; the committed module is
built on 1.96.0, which is the toolchain CI pins from the engine's manifest, so a rebuild here
is `python -m builder explorer --perturb`, which sets `RUSTUP_TOOLCHAIN=1.96.0` itself and
refuses any other (cleanup_ckpt163).

### 12. Copy or bulb, by the root *(dive_primitive_only_ckpt154, 2026-09-28)*

**The test.** A component of period `p` is a satellite if and only if, at its root, the
cycle point has a lower period `q | p`; a copy's root cycle point keeps period `p`. At degree
`d` a component has `d − 1` points of multiplier one, and every one is solved.
`nuclei::classify`:

1. **Nucleus.** Polished by Newton where its next step is over 1e-12 of its size (the page's
   solve stops at a view-sized tolerance, half a percent of the period-2,508 bulb at the home
   view). Refused as *not a nucleus* where `|z_p|` is over 1e-3 of the copy's `z` scale
   `|s_z| = |A|^{−1/(d−1)}`, or where the polish moved it more than a size.
2. **Roots.** Newton on `f^p(z) = z`, `(f^p)′(z) = 1`, with `∂/∂z`, `∂/∂c`, `∂²/∂z²` and
   `∂²/∂z∂c` carried as mantissa and exponent. It starts at the cusp the renormalization gives,
   `w = d^{−1/(d−1)}ζ` and `C = w(1 − 1/d)`, so a deep copy's first step is already under 1e-10
   of its size. Since classify_speed_ckpt155 the passes run **as perturbation around the
   polished nucleus's own orbit** (*Perturbed roots*, below), and they fall back to the
   nucleus's fixed point wherever that cannot be trusted.
3. **Literal test at a regular root.** A copy's root is regular and converges quadratically
   (`QUADRATIC`); there `|f^q(z) − z|` under 1e-3 `|s_z|` for a proper divisor `q` is a
   collapse. On every copy measured the smallest is 1.5 `|s_z|` or more.
4. **Collapse test at a singular root.** A satellite's root is singular; `c` converges at
   about 0.35 a step and `z` only as `|Δc|^{1/m}`. So at `ROOT_CONVERGED` (1e-10 of the size)
   the centroid of the cycle point's `f^q`-orbit is taken: it is `q`-periodic and its
   multiplier's `m`-th power is one (both under 1e-6) exactly where the cycle collapses.
   Satellites read 1e-12 or less; the nearest copy, 0.66.
5. **Anything else is unresolved** — escaped, singular, wandered more than eight sizes, or
   unconverged in 48 steps — and the page treats it as not a copy, counts it, and logs why.

**Fixtures** (`nuclei.rs` tests): bulbs — the period-2 disc, both period-3 bulbs, the
period-4 and airship doublings, a 7-bulb on a deep period-179 copy, and at degrees three to
six a 3-bulb, a doubling and a 7-bulb on the island, a 5-bulb, and a 5- and a 7-bulb; copies —
the airship, two antenna copies, the anchor, the home view's periods 28 and 48, each degree's
island and one more copy at degrees four to six. Home-view cases as the page sends them:
period 2,508 is a 57-bulb on period 44; "period 15" is not a nucleus (`|z₁₅|` = 0.375 there;
Newton lands on the period-3 nucleus 0.125 away). The old chain reading had also called the
period-10 and period-28 doublings at the home view, and a degree-six 5-bulb, copies.

**Cost when this landed**, native, per nucleus, this box under another prompt's load (solve =
one Newton step at the period). *Perturbed roots*, below, has what it costs now:

| frame | period | one solve step | old reading | root test |
|---|--:|--:|--:|--:|
| tangle 1e-22, degree 2 | 89,265–99,396 | 0.04 s | 0.05 s | 0.14–0.16 s (3 passes) |
| tangle 1e-54, degree 2 | 205,425–219,615 | 0.17–0.18 s | 0.20 s | 0.58–0.62 s (3 passes) |
| tangle 1e-22, degree 6 | 62,608–93,912 | 0.15–0.23 s | — | 2.6–5.0 s (16–21 passes) |
| home view | ≤ 2,508 | — | ms | ms; 0.03 s for the 2,508 bulb |

⚠ **Degree six was where it became slow**: five roots at three passes each. What was done:
the literal test rides the Newton passes (a cursor over the divisors, one compare a step),
the collapse test runs only where the root is not regular, the polish only where the nucleus
needs it, and a dive reads in rounds of the pool and stops once the rung rule is settled. On
the served page at tangle 1e-54 the classify phase of a Go went from 0.9 s to 5.9 s for 23
nuclei, a refusal that must read them all. No pre-filter is used: one may only reject, which
saves nothing on the copies the cost is spent on, and none was measured to be safe.

**Module**: 346,064 bytes raw and 128,978 gzipped, from 313,157 and 117,312. `Wide`'s
operations are `#[inline(never)]` (9.5 KB for 2–5% of speed) and `pass` takes a `dyn`
callback rather than a generic one (11.5 KB).

#### Perturbed roots *(classify_speed_ckpt155, 2026-09-28)*

**Where the time went.** It went to the fixed point. One pass step at degree six and five
limbs cost 2,520 ns: 2,265 ns of it was `z ↦ z^d + c` in fixed point (`cpow_fx`, twenty
limb products a step), and 135 ns was the `Wide` derivative chain. At degree two and eight
limbs the split is 779 of 894 ns. An `f64` binomial step, the perturbation's own arithmetic,
is 30 ns and 12 ns. So the passes were worth moving off the fixed point, and nothing else
was: the polish is one pass on every nucleus the dive reads, and the collapse test runs only
on satellites.

**The perturbed solve** (`newton_perturbed`). The nucleus's pass already takes its orbit
`Z_0..Z_p`, and now it keeps it, as `f64`. A root's orbit is `Z_k + δ_k`, with
`δ_{k+1} = (Z_k + δ_k)^d − Z_k^d + Δc` written as the binomial. That has no cancellation, and
every term is an `f64`: `δ_0` is at the copy's scale and `Δc = c − c_0` at its size. The
residual, the four derivatives, the Newton system, the stopping rule, and every test after
the root are the fixed-point solve's, and so are the numbers, to the offsets' rounding. It
hands a root to the fixed-point solve, from its cusp, in two cases:

- **A glitch**: `|Z_k + δ_k|` under a thousandth of `|Z_k|`, which is Pauldelbrot's criterion.
  No root in the frame set tripped it.
- **A deep cusp**: a first step already under `ROOT_CONVERGED`. What shows such a root
  regular is its next step falling quadratically, and a perturbed pass cannot see that step.
  The offsets carry about `√p` of the orbit's own rounding, 2⁻⁴⁵ of the size at period
  83,424, and that is the step the next one would have to fall from. Read as not regular,
  the root would pay the collapse test instead. At these composite periods that test's
  divisor cycles add up to about 1.9 periods, which made the degree-two tangles no faster
  until the hand-off was there. Each of their 17 cusps goes to the fixed point now.

A literal-test distance read off a perturbed pass comes with a rounding bound, `1e-8` of the
magnitudes summed into it. A root whose distances do not clear the line by it is read again
in fixed point, and none needed to be. The copies must sit inside a double's exponent
(`2^-900`); a deeper one is solved in fixed point throughout. `classify_by` runs either solve,
and `tests/classify_speed.rs` is the harness.

**Measured, interleaved** (`tests/classify_speed.rs`, three rounds A B / B A, medians, native,
while the fulls render held the box). There are 189 nuclei: the dive's own search, twelve
solves and every distinct nucleus, over the three §12 tangle frames and 16 frames from
`artifacts/dive-reference/` (six at degree six, five at large periods at degrees two to five,
and five ordinary degree-two frames). **All 189 verdicts are the same** in both solves:
copies, bulbs with their parent and `m`, and the unresolved with their reason.

| frames | nuclei | fixed point | perturbed | speed-up |
|---|--:|--:|--:|--:|
| tangle 1e-22, degree 6 | 11 | 20.85 s | 2.94 s | 7.1× |
| dive frames, degree 6, periods 730–20,904 | 67 | 9.80 s | 1.72 s | 5.2–6.1× |
| dive frames, large periods, degrees 2–5 | 50 | 6.99 s | 2.47 s | 2.0–4.4× |
| dive frames, degree 2, periods 48–28,296 | 44 | 0.47 s | 0.22 s | 1.5–2.4× |
| tangle 1e-22 and 1e-54, degree 2 (deep cusps) | 17 | 4.68 s | 4.92 s | 0.9–1.0× |
| **all** | 189 | 42.79 s | 12.29 s | **3.5×** |

**In the module**, the page's own call (`classify_nucleus`, node, the module before and after,
four nuclei a frame, interleaved), the result is 25.4 s against 7.4 s, or 3.4×. That is 8.3×
on the degree-six tangle and 5.0–7.7× on the degree-six dive frames, 2.3–3.7× at the large
periods, and 0.9× on the degree-two tangles. All 76 verdicts are the same.
`scratch/classify_speed/` has the frame set's maker and the probes.

**Module**: 356,608 bytes raw and 132,883 gzipped, on rustc 1.96.0, which is the pin CI
reads. The module before this was 356,233 and 128,875, but it had been built on 1.98.1 by
dive_mixture_ckpt154, against §11's rule. On 1.98.1 the change is 11,166 bytes raw and 4,101
gzipped, nearly all of it the perturbed pass and the root solve that now exists twice.


## Running it

Every command here needs the sibling checkout, `fractal-wallpapers`, beside this one:
the kernel is a path dependency, and without it cargo stops before building anything,
failing to read `…/fractal-wallpapers/perturbation/Cargo.toml` — a path that names the
missing checkout. `cargo fmt --check` needs it as well, by another route: the three tests'
`#[path]` `mod common` is the kernel's own `tests/common/mod.rs`, and rustfmt fails to
resolve it, where `engine-wasm`'s fmt check passes on a bare clone.

```text
cargo fmt   --check                                    # the formatting, held: the
                                                       #   crate is rustfmt-clean and
                                                       #   stays that way
cargo test  --release                                  # this crate's unit tests: the
                                                       #   nucleus search, the Dive, and
                                                       #   plan's report
cargo test  --release --test probe  -- --ignored --nocapture   # the three-way probes
cargo test  --release --test measure -- --ignored --nocapture  # the cap sweep, the
                                                       #   policy, and the nucleus
                                                       #   search, ~12 min
cargo test  --release --test descend -- --ignored --nocapture  # the frame finder, ~12 min
cargo test  --release --test classify_speed -- --ignored --nocapture collect  # §12's frame set
cargo test  --release --test classify_speed -- --ignored --nocapture bench    # both root solves, ~3 min
# §10: every harness of measure.rs at another degree, and the finder there
MEASURE_DEGREE=3 cargo test --release --test measure -- --ignored --nocapture
DESCEND_DEGREE=3 cargo test --release --test descend -- --ignored --nocapture at_a_degree
python -m builder explorer --perturb                           # both modules, from the
                                                               #   site's root
node explorer/bench/perturb-parity.mjs <old.wasm> <new.wasm>   # a rebuild against the
                                                               #   modules it replaces
```

**The kernel's own tests moved with it** and run in the sibling checkout, from
`fractal-wallpapers/perturbation`: the unit tests of the reals, the orbit, the loop, the
policy and the spec; `parity.rs` and `orbit_parity.rs`, which pin every bit the kernel
hands out natively; `interior.rs`; `frames.rs`; and the oracle ladders, `oracle.rs`. That
crate's README, *Running it*, has the commands, and what an edit there owes this
repository: a rebuild of both modules here under the moved pin.

`perturb-parity.mjs` is how a rebuild is held, since the native pins cannot hold a module:
wasm takes `ln` from another library. Over every spec in the kernel's
`tests/parity-specs.jsonl` it compares the reference orbit, `compute_band` over the whole
tile and over the tile cut in two, `compute_samples` over a scattered list, and
`band_ran` / `band_saved` after each, between two builds, byte for byte.

## Committed: `perturb.wasm`

Both modules **are** in the tree — `perturb.wasm` and `perturb-scalar.wasm` — and
`perturb.manifest.json` is beside them, since `build_deep_tab_ckpt135` (2026-09-19) gave
the crate the consumer that settled its exports; the scalar module since
`deep_wait_ckpt163`. The page fetches `perturb.wasm` where the browser's wasm has SIMD and
`perturb-scalar.wasm` where it does not (`deep-render.js`); the two draw the same lanes.

`python -m builder explorer --perturb` rebuilds both and the manifest, and nothing else. It
needs `cargo`, the `wasm32-unknown-unknown` target and **the sibling checkout**, as
`python -m builder explorer` does, and it refuses to build from a kernel that is not the
tree the engine manifest pins — in the sibling's worktree, uncommitted edits and stray
files included. So a kernel that has moved is rebuilt in two steps, the pin first: commit
it there, `python -m builder explorer` (which writes the new `wallpapers_commit`), then
`--perturb`. It is still its own flag rather than a stage of the explorer's bake.

**The module has one import, `env.progress(done, total)`** *(deep_tab_activity_and_
layout_ckpt141)*, and whoever instantiates it supplies it — `bench/perturb.mjs` and the
page's own planner with a function that does nothing, `deep-worker.js` with one that posts
at most every 100 ms. A wasm call cannot be looked into, and a reference orbit at a million
or a probe rung beside a parabolic point is seconds inside one export; the kernel's
`src/progress.rs` is called every 4,096 orbit steps and once a probe or domain-walk cell,
so the page can tell a slow frame from a stranded pool. Natively it compiles to nothing,
and every native test is unmoved. Measured on the rebuild: the orbits, fields and probe
counts of four frames came back byte for byte what the module before it produced, in
10.82 s against 10.83 s.

| field | what it holds |
| --- | --- |
| `schema` | the record's own version, `3`: 2 when it came to record two modules, 3 when the kernel became a dependency pinned by the engine manifest |
| `built` | the date of the build |
| `crate` | `explorer/perturb-wasm` |
| `dependencies` | `["fractal-wallpapers/perturbation"]`, the kernel |
| `kernel_tree` | git's id for the sibling's `perturbation/` tree the modules were built from: a fingerprint, not a second pin |
| `modules` | one entry a module, each with its `raw_bytes`, `gzip_bytes` and `rustflags` |
| `pinned_by` | `"engine.manifest.json wallpapers_commit"`: where the commit the kernel was built from is written |
| `rustc` | the compiler, with its commit and date |

**One pin, written once.** There is no `wallpapers_commit` in this manifest: the commit
the kernel came from is the engine manifest's own, which `build_perturb` checks before it
builds, so a single spelling is true of `engine.wasm` and both perturbation modules and
cannot disagree with itself. `pinned_by` says where that spelling is. `builder check`'s
staleness notes read the same pin: a kernel whose tree at the sibling's `HEAD` is not the
pinned one is reported there, and so are modules whose `kernel_tree` is not the pin's — a
pin moved by `python -m builder explorer` with no `--perturb` after it.

Freshly built on rustc 1.96.0 *(deep_seam_move_ckpt163)*:

| module | rustflags | raw | gzipped |
| --- | --- | --: | --: |
| `perturb.wasm` | `-C target-feature=+simd128` | 586,233 | 181,860 |
| `perturb-scalar.wasm` | none | 460,305 | 163,128 |

Their lanes are the modules' before the move, byte for byte, on all 142 specs of
`perturb-parity.mjs`, and a second bake from this checkout reproduced both to the byte.

**What the move cost in reproducibility.** These modules are now built as `engine.wasm`
is, under `--remap-path-prefix` remaps of both checkouts, so no source path is written
into them. What a remap cannot reach is the `-C metadata` hash cargo takes of a path
dependency's location, so **the bytes now move with the directory the two checkouts sit
in**, as `engine.wasm`'s always have (`explorer/README.md`, *The engine, compiled*). Before
the move the crate had no dependencies and a rebuild anywhere reproduced it; now a rebuild
reproduces it from checkouts at the same parent path.

Three fields of `engine.manifest.json` are **absent** rather than empty:
`engine_version` and `engine_changes`, because this crate does not link the engine, and
has never needed a change in it — an empty `engine_changes` would read as a list somebody
forgot to fill in — and `wallpapers_commit`, for the one-pin reason above. That the
second is still true after the tab landed, after the Julia case landed, and after the
kernel moved in beside the engine, is worth saying plainly: the tab shades its field
through `engine.wasm`'s existing `shade_level` on a placeholder viewport, which
`explorer/deep.test.mjs` holds to being sound, so **this crate has never asked the engine
for anything**. (The engine module's own bytes have moved since, for a reason that has
nothing to do with this crate: `explorer_shade_pool_ckpt136` banded the shade.)

**What a visitor downloads for it: nothing, unless they open the Deep tab.** One module and
the tab's eight JavaScript modules are fetched on that tab's first open and never before
(the two that read a deep link, `deep-link.js` and `deep-fx.js`, come earlier where a deep
link is already in front of the page). Against `engine.wasm`'s 253,697 gzipped, the
181,860 of `perturb.wasm` is 72% of it, and the 163,128 of the scalar module 64% — paid
only by a reader who asked for a renderer for everything below 1e-10, or who pressed Find
minibrots or New coloring in the shallow view, the two doors into it there.

`core::fmt` is still most of the size and is still not chased: `plan` formats a
JSON report and every refusal is a sentence, and the tab reads both. Trimming it
would mean giving up the sentences, which are what a refusal is.
