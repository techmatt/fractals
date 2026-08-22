# The visitor explorer

One page that runs the wallpaper project's own renderer in the browser: pan and zoom
every family the wallpapers are drawn from, in every mode the pipeline ships, under any
of the 77 curated palettes, and copy a link to whatever is on screen. Every figure of the
article that this page can draw again carries a link straight into it.

**Nine families, eighteen modes, `f64`.** The parameter planes `mandelbrot` and
`multibrot3`–`multibrot5`, the dynamical planes `julia`–`julia5` and `phoenix`, the
engine's whole production mode roster with the parameters its catalog settles for each,
and double-precision arithmetic that stops zooming where the engine says two neighbouring
samples have become the same number. What is **not** here: fractional degrees, which are
render-only and have no home view to open at; the niche `de` mode, which the engine
renders by name and no production draw picks; and deep zoom, because a picture that needs
perturbation needs a renderer this page does not carry. The article's deep-zoom figures
stay baked rasters.

The design draft 1 was built to is `preserve\visitor_explorer_design.md` on the synced
drive. It is not restated here; where the two disagree, the tree is what is true and the
design doc is what was intended.

## What is here

```
index.html            the page
explorer.css          its own stylesheet, on top of the site's
explorer.js           what a reader touches: drag, wheel, keys, pickers, copy link
render.js             the worker pool, the plan, the field passes, the shade
worker.js             one worker: one wasm instance, one band of rows
permalink.js          the link contract — parse, validate, canonicalize
permalink.test.mjs    29 tests, `node --test explorer/permalink.test.mjs`
palettes.js           generated: the colormaps, by name, curated or drawn-in
catalog.js            generated: the mode roster, its curves, the anchors' constants
links.jsonl           generated: every figure and tile, as a link here or a reason not
engine.wasm           generated: the engine, compiled
engine.manifest.json  generated: what engine.wasm was built from
engine-wasm/          the crate that produces engine.wasm
```

The five generated files are **committed artifacts**. The site never builds; a clone
with no wallpaper project beside it serves this page exactly as this checkout does. Only
*regenerating* them needs the sibling checkout and a Rust toolchain.

## It does not open from `file://`

A browser will not load a page's ES modules, its workers or its wasm over `file://` — all
three are blocked before any of this runs. So this one page has to be served:

```
python -m builder serve          # http://localhost:8000/explorer/index.html
```

The page says so itself where the picture would be, rather than failing silently. Every
other page on the site still opens from disk, and stays script-free.

## The engine, compiled

`engine-wasm/` is a `cdylib` crate that depends on the engine **by path**, at
`../../../fractal-wallpapers/engine` — the sibling checkout. Deliberately not a git
dependency: the engine crate is versioned `0.1.0` and never bumped, so a git dependency
could not tell two revisions apart, and it would drag the whole wallpaper project into a
build that wants one Rust library. `build.rs` exists for one reason — to fail with a
message that names the missing *repository* instead of cargo's message about a
`Cargo.toml` that does not exist.

**No wasm-bindgen.** The module is the engine plus `src/lib.rs`, exported `extern "C"`
with `#[unsafe(no_mangle)]`. JavaScript owns every buffer through `alloc` and `dealloc`,
and nothing is generated on either side. `panic = "abort"`, `lto = true`,
`codegen-units = 1` — the LTO is also what dead-strips `png`, `jpeg-encoder` and `flate2`
out of a module that never writes a file.

Committed beside the module, `engine.manifest.json` records what it was built from:

| field | what it holds |
| --- | --- |
| `schema` | the record's own version, `1` |
| `built` | the date of the bake |
| `crate` | `explorer/engine-wasm` |
| `engine_version` | the engine crate's own version, read from its `Cargo.toml` |
| `rustc` | the compiler, with its commit and date |
| `wallpapers_commit` | the sibling checkout's `HEAD` at bake time |
| `engine_changes` | every change this consumer has needed in the engine, one line each |
| `raw_bytes` / `gzip_bytes` | 470,300 raw, **161,358 gzipped** |

`engine_changes` is typed, in `builder/explorer.py`, and is the condition CLAUDE.md puts
on a website prompt touching the sibling engine at all: a zero-behaviour change is allowed
there only if it is named here. Nothing in the sibling repository marks a commit as one of
these, so a derived list would be a guessed one.

`python -m builder check` reads the manifest back and prints a **note** when
`wallpapers_commit` is no longer an ancestor of the sibling checkout's `HEAD`. A note and
never a failure: the module is committed and the site serves it whichever commit it came
from, and a clone with no wallpaper project beside it — CI, every time — says nothing at
all.

### What the engine needed

Draft 1 needed nothing: the engine library compiled for `wasm32-unknown-unknown`
unchanged. Generalizing it needed **four changes in `fractal-wallpapers`**, listed here
because a committed artifact nobody can rebuild from the sibling checkout is a dead end.
`engine.manifest.json` names the commit that carries them.

- **`coloring::composite`, `coloring::modulate` and `direct_trap::Painter::trace` are
  public.** All three were private, so the only public way to a composite, the modulate
  or a direct trap was `coloring::paint`, which iterates a whole viewport before it
  colours anything — and this page holds the field/colour seam open across a worker
  boundary, so eleven of the eighteen modes had no door at all. A band of a direct trap
  cannot be had by shrinking the viewport either: sample coordinates are formed from the
  frame's own height, so a band viewport lands on almost the same numbers and draws a
  seam between the bands. Visibility only — no signature moved and no test did.
- **`iterate::run` is `#[inline(always)]`**, and it is worth about four times the field
  time. See *the one call site* below.

Two things about the port are unchanged and still worth knowing:

- **Rayon.** The engine's `coloring` and `resample` paths are `par_iter` throughout.
  `rayon-core` detects that a target's threading is unsupported and configures a global
  fallback rather than panicking — a single-threaded pool, as if `RAYON_NUM_THREADS=1`.
  So the parallelism on this page is the worker pool, not rayon, and the engine did not
  have to know that.
- **The filesystem.** The one fs touch reachable from the coloring path is
  `Colormap::load`, which reads a map's JSON off disk. This module never calls it:
  `Colormap::from_stops_baked` takes the control points directly, and the page has them
  already because `palettes.js` baked them in. That is the whole reason the colormap
  crosses the boundary as stops and not as a name.

## One spec, and the three exports

The engine keeps a seam between a *field* — one scalar per sample, the expensive part —
and the *colour* it is read into. This page holds that seam open one level further out,
so that JavaScript sits in it:

```
plan(spec)                -> JSON        what this spec implies, or why not
compute_band(spec, rows)  -> f64 lanes   in a worker, a band at a time
shade(spec, lanes)        -> RGBA bytes  on the main thread, milliseconds
```

**All three take the same object**: the engine's own render spec, minus the two keys that
name files, plus the colormap by value and the mode's parameters by themselves. So a
family, a degree, a constant, a mode, a mode parameter and a palette recipe have exactly
one spelling on this boundary, and adding a family to the engine is not adding an export.
`FamilySpec`, `Palette` and `Colormap`'s kind are deserialized as the engine's own types,
which is why a constant crosses as the decimal string it was written as, and why the
permalink's seven shade keys are handed over as they stand — they *are* the engine's
palette recipe, and translating between two spellings of one thing is how they drift.

**`plan` is asked first, and the page holds no second opinion.** It answers how many lanes
the mode's coloring reads, which of them may not be narrowed to `f32`, whether the mode
paints during the iteration instead of making a field, what the iteration cap is, where
the family comes home to, and what the mode's parameters are currently set to. So
`render.js` carries no table of which mode reads how many fields and `explorer.js` carries
no table of what a parameter defaults to — a retuned catalog arrives by rebuilding.

**Lanes.** A coloring reads one field, two, or none. A band comes back **lane-major** —
lane 0's rows, then lane 1's — as little-endian `f64`, and `NaN` marks a sample with no
value, which is the engine's own spelling for the interior. A narrow lane is reduced at
`f64` and rounded through `f32` inside the module, because that is what the engine stores
a field as and the picture wanted is the one it draws. The **modulate's texture is the one
lane that is not narrowed**: its value is a base-4 expansion whose deep digits are the
picture, and `f32` does not blur that, it bands it — whole subtrees of the lamination
collapse onto one value.

**A direct trap has no lanes.** Those four modes composite gradient samples *during* the
iteration and never make a field, so their band comes back as finished RGBA and `shade`
has nothing to do. It is also why a palette change re-iterates under those four modes and
under no others, and why the field cache keys them on their colour too.

**The one call site, and what it is really about.** Draft 1 carried a rule: keep exactly
one call site into `iterate::run`, because a second one measured about three times the
field time. The rule was right and the reason was not. What that loop needs is not to be
alone — it is to be **inlined with its family and its channel set visible as constants**.
Then the eleven per-iteration channel checks fold away, the match over the families
becomes one multiply, and the `Orbit` stops being built at all: 1.5 s against 6.3 s on the
same 1280x720 frame. Draft 1 got that collapse for free by rendering one family in one
mode. A spec-struct boundary hands both in at runtime and loses it, and neither half alone
buys back more than a tenth of it.

So `compute_band` writes its loop twice. The one mode whose channel set is **empty** —
`smooth`, the spine every composite is built on and the only catalogued mode that asks the
loop for nothing but the escape — gets a call site per family, nine in all, where the loop
really is the recurrence and a magnitude test. Every other mode is already doing
per-iteration work of its own that the checks are a small share of, and takes the generic
loop. The nine cost **12.6 KB of module** and hold the anchor frame to draft 1's time;
specializing the whole catalog would be a copy of the loop per family and per mode, which
is the module's size spent on the cases that need it least.

**Bands.** `Math.min(8, navigator.hardwareConcurrency || 1)` workers, each with its own
instance of one compiled module — the module is compiled once on the main thread and
structured-cloned in, so eight workers cost one compile between them. The frame is cut
into four bands per worker, never shorter than eight rows, dispatched from a queue: more
bands than workers is what makes an interior-heavy band cost somebody else's idle time
rather than the whole frame's, and it is what bounds how long a cancel takes. A worker
knows nothing about families or modes: it is handed the spec as text and the number of
bytes its answer will be, both worked out on the main thread from the plan.

A band's coordinates are formed from the **whole** viewport, with the global row index —
so the assembled field is bit for bit what a whole-frame pass through the same module
produces, and there are no seams between bands. What is measured and what is argued are
two different links of one chain, and it is worth keeping them apart. **Measured:** a
whole frame out of wasm is a whole frame out of the native engine. The spike that
established the port — `fractal-drive-sync/reports/wasm_spike_report.md`, 2026-08-21 —
drew the 1280x720 anchor frame through its single `render_smooth` export and through
`fractal-engine render` of the same spec, and **0 of 921,600 pixels differ**; it is the
same f64 code over the same inputs, and wasm's f64 is IEEE-754 with no x87 excess
precision to diverge through. **Argued:** the banded assembly equals that whole-frame
pass, from the global row indices above — not measured, and the spike's module was the
one-export one rather than this page's. **Not compared at all:** the explorer end to end
against a native render of the same view, at any family or mode.

**Shade takes the whole frame, never a band.** The engine normalizes a frame against its
own distribution, and at the shipped default (`Transfer::Value`) that is a percentile
stretch — the 0.5th and 99.5th percentiles of the frame's valid samples. A band shaded
alone would be stretched against the wrong histogram and would not match its neighbours.
The other two transfers the recipe can ask for bring one frame-wide statistic each:
`Transfer::Edge` a 200-bin gradient-magnitude profile, `Transfer::Rank` a sort of every
valid sample. A composite normalizes each of its two fields that way. The modulate spends
its base by rank as part of what it is, which is why the engine refuses a recipe that asks
for another transfer alongside it — `?m=itinerary&transfer=rank` is a visible refusal on
this page, in the engine's own words, rather than half a request quietly dropped.

**A pass draws twice.** A quarter-resolution field first, then the full one. The preview
is a *separate* field of the same rectangle rather than a subsample of the full one, so it
carries its own percentile stretch and can be a shade off the picture that replaces it.
The canvas's pixel grid is rounded to a multiple of four on both axes so the preview is
exactly the same rectangle at exactly a quarter of the samples.

**Cancel is by generation, not by termination.** A pan bumps the generation, no further
bands are dispatched, and the band still in flight is finished and thrown away — killing
a worker mid-band would cost a wasm instantiation to save at most one band. The abandoned
pass resolves with `null` rather than being left pending: a promise nobody settles holds
its whole `await` chain alive, and a reader who drags across the set makes one per drag.

**The field cache** is keyed on the canonical permalink *minus* the palette and the shade
recipe, plus the pixel grid it was sampled on — geometry alone, because nothing on the
colour side can change the field. The four direct traps are the exception and are keyed on
everything, because for them it can. Four fields are kept: two passes of the current view
and one view back. So a palette change re-shades what is already here and iterates
nothing, which is the whole point of computing the two apart.

**`resample::downsample` at one sample per pixel is the identity** — the Lanczos taps
collapse to 1 at integer offsets — and it still runs both tap passes over a
24-byte-per-pixel linear buffer. It is most of the shade cost. Kept, because the last
step of a picture is the engine's and not this page's.

**Nothing shared.** No `SharedArrayBuffer`, no cross-origin-isolation headers, no COOP,
no COEP, no service worker to install them. A worker's band is copied off the wasm heap
and transferred once, when it is done. That is what lets this page be plain files on
GitHub Pages.

## Measured

Two harnesses, and they answer two different questions.

**The kernel, one thread, no browser.** `explorer/bench/kernel.mjs` instantiates the
committed module under Node and asks for one whole frame, so the number is the arithmetic
and not the pool. `home` is the mandelbrot home view; `anchor` is a hard location deep in
the spike. Both in mode `smooth` at 1280x720.

```
node explorer/bench/kernel.mjs kernel.json          # both views, 3 runs each
node explorer/bench/modes.mjs                       # every mode, mandelbrot home
node explorer/bench/sweep.mjs                       # every family x mode pair
```

**This harness is tracked, and it is the regression guard for the specialization
cascade** — `iterate::run` inlined into nine specialized call sites is worth 4x on the
field, and nothing else in this repository would notice if a rebuild lost it. It started
under `scratch/`, which is wiped, and a guard that a wipe can delete is not one; the four
modules moved here and `output.mjs` sends every run's numbers to `artifacts/`, which is
ignored. Code is committed, measurements are not — a number here is this machine on this
day. The browser-driven rig that produced the pool figures below stays under `scratch/`:
it is a session's worth of driver scripts and probe pages, not a guard.

| frame | cap | draft 1 | now |
| --- | --- | --- | --- |
| home | 3 336 | 1 567 ms | 1 544 ms |
| anchor | 6 898 | 9 724 ms | 9 440 ms |

That is the whole point of the nine specialized call sites: the generic loop draws the
same home frame in **6 330 ms**, four times slower, and draft 1's numbers were a
single-family single-mode build's.

**Per mode**, same harness, mandelbrot home at 1280x720, one thread. The `field` column
is `compute_band` over the whole frame; `shade` is the colouring pass, which a palette
change pays again and nothing else does. A direct trap has no shade because its band
arrives painted.

| mode | field | shade | x smooth | x generic | native |
| --- | --- | --- | --- | --- | --- |
| smooth | 2.27 s | 157 ms | 1.00 | 0.36 | 1.00 |
| direct_trap_lines | 6.12 s | — | 2.70 | 0.97 | 0.93 |
| direct_trap_multiply | 7.85 s | — | 3.46 | 1.24 | 1.24 |
| direct_trap_screen | 8.20 s | — | 3.61 | 1.30 | 0.91 |
| direct_trap_ring | 10.35 s | — | 4.56 | 1.63 | 1.08 |
| itinerary | 12.12 s | 694 ms | 5.34 | 1.92 | 1.26 |
| trap_circle | 13.08 s | 309 ms | 5.76 | 2.07 | 1.01 |
| smooth_trap_circle | 13.32 s | 372 ms | 5.87 | 2.10 | 1.06 |
| curvature | 19.86 s | 485 ms | 8.75 | 3.14 | 2.45 |
| smooth_curvature | 20.75 s | 357 ms | 9.14 | 3.28 | 2.60 |
| smooth_mean_angle | 23.38 s | 492 ms | 10.30 | 3.69 | 2.81 |
| smooth_angle_min | 24.10 s | 530 ms | 10.62 | 3.81 | 2.73 |
| threads | 25.35 s | 227 ms | 11.17 | 4.00 | 2.06 |
| tia | 26.67 s | 351 ms | 11.75 | 4.21 | 1.79 |
| exp_smoothing | 27.65 s | 171 ms | 12.18 | 4.37 | 1.58 |
| gaussian_int | 28.30 s | 467 ms | 12.47 | 4.47 | 2.66 |
| smooth_stripe | 43.35 s | 473 ms | 19.10 | 6.85 | 3.88 |
| stripe | 46.06 s | 454 ms | 20.29 | 7.28 | 3.92 |

**The wallpaper project's relative-cost column does not transfer, and the answer is no in
two different ways.** Against the smooth this page actually draws, every other mode is
2.7x to 20x rather than the native column's 0.9x to 3.9x — but most of that is smooth's
own specialization, so the honest comparison is the `x generic` column, both loops
generic. Even there every mode costs **1.4x to 2.8x more of its smooth than it does
natively**: stripe 7.3 against 3.9, tia 4.2 against 1.8, trap_circle 2.1 against 1.0.
Two candidates and no measurement to separate them — wasm has no transcendental
instructions, so the `atan2`, `sin` and `exp` the averaging channels run per iteration go
through a compiled libm rather than the platform's; and the native column is wall-clock on
twelve threads, where a mode that adds arithmetic but not memory traffic scales better and
its ratio compresses. The prompt's remembered figures were `threads` 2.2x and `stripe` 4x;
the recorded native slopes are 2.06 and 3.92.

**On a real machine with a real pool** the wait is much shorter than that table reads,
because a canvas is smaller than 1280x720 and eight workers are not one. Chrome 151
headless, 12 logical cores, the page driven at 1136x636 through its own controls:
mandelbrot `smooth` at home 0.23 s, the spike anchor 1.52 s, julia `smooth_stripe` at
density 9 0.71 s, phoenix `itinerary` 0.39 s, multibrot3 `direct_trap_ring` 1.53 s,
mandelbrot `smooth_trap_circle` 1.47 s, and the worst seen, julia5 `threads` at sigma
0.25, 7.77 s. Shade is main-thread and pool-independent at 150–500 ms, and a preview
lands at a sixteenth of the samples before any of it.

**The module** is 470,300 bytes raw and 161,358 gzipped, against draft 1's 190,240 and
70,639. The extra is the eighteen modes' worth of engine that is now reachable — every
field reduction, both blends, the trap painter, all nine families — plus `serde_json` and
the derived readers for the spec. 12.6 KB of it is the nine specialized loops.

## The permalink contract, version 2

`permalink.js` is the only thing that decides what a link means, and nothing else in the
explorer is allowed a second opinion. A URL is the only permanent thing this page emits.

### What version 2 added, and why it is a 2

Draft 1 drew one family in one mode. Version 2 draws every production family and every
production mode, so `f` and `m` accept values v1 refused, the family constants a
dynamical plane needs became real keys, and a mode's own parameters became keys of their
own. **None of that would bump the version on its own** — a key with a default is a
widening, and an old link is still a complete statement.

What bumps it is that **v1 and v2 links are now read by the same rules**. A v1 link still
parses and every v1-legal value still means exactly what it meant, so nothing anybody
could have saved has changed picture. But the answer a v1 link gets for `f=julia` is no
longer "not yet" — it is a picture — and this module re-emits it as `v=2`. Saying that in
the version is cheaper than leaving a reader to find it out.

### The keys, in emit order

```
v · f · cx · cy · px · py · m · the mode's parameters · x · y · w · a · p · the shade keys
```

- **`v`** — required. `1` and `2` both parse; every string this page writes says `v=2`.
  Anything else is refused: it was written for a version of this page that no longer
  exists, or for one that does not exist yet.
- **`f`** — the family. A name is the whole recurrence **including its exponent**, because
  one picture gets one name: `mandelbrot`, `multibrot3`, `multibrot4`, `multibrot5` on the
  parameter plane, `julia`, `julia3`, `julia4`, `julia5` and `phoenix` on the dynamical
  one. That is the engine's own view of it — a `Family::Multibrot` at degree 2 *is* the
  Mandelbrot set — spelled the way a reader would say it. `fractional_multibrot` is named
  and refused: it is a real family the article draws, but a non-integer degree needs a
  branch cut and the engine gives it no home view, so there is nowhere to open it at.
- **`cx`, `cy`, `px`, `py`, `zx`, `zy`** — the family's own constants, as decimal
  strings. `c` is half of a dynamical location's identity, the same `c` the wallpaper
  project's walk requires and refuses to guess; `p` is Ushiki's Phoenix memory
  coefficient; `z₋₁` is the previous iterate its recurrence starts with. A constant key
  on a family that has no such constant is refused, and says which constants that family
  does have. **`z₋₁` was left out of v2's first draft, and the reason was wrong.** It is
  true that a non-zero `z₋₁` is a different set rather than a different view of one —
  and that is the argument for spelling it, not against. Of the 48 distinct `(c, p, z₋₁)`
  triples the wallpaper project's walk ledgers hold, **39 carry a non-zero one**; a
  contract that could not say it would have drawn the classic slice under a name that
  meant something else, silently, for four fifths of the Phoenix work there is. Absent
  still means the origin, so every link written before the key existed draws exactly what
  it drew — which is why this is a widening and not a version 3.
- **`m`** — the mode, one of the engine's eighteen production names. `de` is named and
  refused with its own reason: it is niche rather than broken, the engine renders it by
  name, and no production draw picks it.
- **The mode's parameters** — a number the engine's mode catalog writes down for that
  mode, and nothing else. `density` (stripe, smooth_stripe), `radius` (trap_circle,
  smooth_trap_circle, direct_trap_ring), `sigma` (threads), `weight` — the texture weight —
  (the six composites), `shift` (itinerary), `threshold` and `opacity` (the four direct
  traps). The **shape** of a coloring is the mode's identity — which field, which blend,
  which trap shape, which start colour — so none of that is reachable: moving it would put
  a different picture on the screen under the first one's name. A parameter key the named
  mode has no room for is refused rather than ignored, because a knob that silently did
  nothing would look exactly like a knob that worked. **One clamp is invisible**, and it
  is the engine's: a screened cross saturates toward white, so `direct_trap_screen` is
  held below an opacity of 0.15 and a threshold of 0.08 whatever a link asks for. The
  link keeps what was asked and the picture shows the cap.
- **`x`, `y`, `w`** — the frame's centre and its width in the plane, as **decimal
  strings**, exponent form allowed, capped at 64 characters, and **echoed back
  verbatim**. The decimal string is the identity of a location: `f64` is a lossy view of
  it that stops being enough the moment deep zoom arrives, and a round trip through a
  double would quietly rewrite a link that was more precise than today's renderer. `w`
  must be positive. Omitted means the **family's own home view**, which is
  `Family::home_view()` and not a number this file holds.
- **`a`** — the aspect, written `across:down`, defaulting to `16:9`, each side between 1
  and 10000. An aspect is a shape. **Pixel dimensions are not a field of the contract**:
  the canvas is drawn at whatever size the reader's window gives it, and a link does not
  carry a resolution.
- **`p`** — a palette **name**, which must be one the page carries. Names and never
  indices: a colormap added next year must not repaint a link saved this year. **The set
  a link may name is wider than the set the picker offers**: every curated map is
  offered, and baked alongside them are the maps this site's own figures were drawn in,
  most of which arrived in the wallpaper project by mechanical conversion and are not
  curated. A map the article publishes a picture in has to be nameable or that picture
  cannot be opened here at all; it does not have to be on the menu, and putting it there
  would widen a distinction this repository does not own. A link arriving on an unoffered
  map draws it, and the picker shows that map for as long as it is the one on the screen.
- **The seven shade keys** are the engine's own `Palette` recipe, one key per real engine
  parameter, at the engine's defaults. They are **link-only**: the page gives them no
  control, and they are handed to the module exactly as they are read here.

| key | default | values |
| --- | --- | --- |
| `gamma` | `1` | positive number |
| `cycles` | `1` | positive number |
| `phase` | `0` | number |
| `reverse` | `0` | `0` or `1` |
| `mirror` | `0` | `0` or `1` |
| `transfer` | `value` | `value` · `edge:<weight ≥ 0>` · `rank` |
| `rolloff` | `none` | `none` · `soft_knee:<knee in [0, 1)>` · `reinhard` · `aces` |

`transfer` and `rolloff` are **tagged**: a kind, and its one parameter after a colon
where it takes one. A kind that takes no parameter is refused if given one, and a kind
that needs one is refused without it.

**Folding is off by default and is never applied on a map's behalf**, which is what
`tiles` and `expand` do in the wallpaper project. `location_view` is the one view over
there that folds, and it folds every non-cyclic map because a repeated sequential map
slams its last colour against its first; this page repeats nothing unless somebody asks
for `cycles`, so it leaves the map as drawn. **`mirror=1` on a cyclic map is refused**
with the engine's own reason — folding it would halve the cycle it was drawn to have.

### The rules the keys are read under

- **An unknown key is refused.** A typo that silently rendered the default view would look
  exactly like the link working.
- **A key given twice is refused**, because there is no rule for which wins.
- **Every refusal is visible.** The page says what is wrong and draws nothing — guessing
  what was meant would be worse than saying so. That includes the refusals that come from
  the module rather than from this file: a modulate under a rank transfer, a view past the
  `f64` wall, a mode parameter the engine will not take.
- **Defaults are omitted on emit**, so the canonical string carries what somebody actually
  chose — with two deliberate exceptions, and one deliberate non-exception:
  - **`p` and the family constants are always emitted.** Their defaults live outside
    `permalink.js`, in the baked colormap set and the wallpaper project's shipped anchors,
    so a bare link that inherited either would change picture the day that set is rebaked.
    Naming them costs a few characters and buys a link that draws the same thing forever.
  - **A mode's parameters are not.** Their defaults live in the engine's mode catalog,
    which is the same place the mode's *identity* lives: a link that says `stripe` and
    nothing else is asking for the stripe mode, not for a stripe mode at density 6, and if
    the catalog retunes that mode the link should move with it. That is what naming a mode
    is for.
- **The canonical string is the identity of a view**: parse then emit is a fixed point,
  and it is what the address bar carries after every settled view and what "copy link"
  copies.
- A colon is left unencoded — `a=21:9` beats `a=21%3A9` for the one thing a URL is for.
  The `+` of an exponent is **not** left alone and must not be: a raw `+` in a query
  string means a space.

**The contract's own vocabulary is typed, not generated.** `catalog.js` is baked from
`fractal-engine modes` and carries what each mode is *for*; `permalink.js` keeps its own
list of what a link may *say*. Two lists on purpose — a contract that read its vocabulary
from a generated file could be widened by rebuilding it — and the test suite asserts they
are the same roster in the same order, which is where a promoted or retired mode shows up.

`permalink.test.mjs` holds all of that: **29 tests**, Node's own runner, nothing
installed. Among them, encode-then-decode is the identity for **every family crossed with
a mode of each of the engine's four coloring shapes**, parameters and constants included.

```
node --test explorer/permalink.test.mjs
```

## The link registry

Every figure of the article and every gallery tile is in `links.jsonl`, as a link into
this page or as a stated reason there is none. `python -m builder links --write` derives
it; `builder/links.py` is where the rules are, and the short version is:

- **A spec is never typed.** It comes off the figure's own `provenance` — the wallpapers
  records those lines cite, read whole, and the prose where they do not.
- **A sheet gets one link, at its first panel**, because a link is one picture and a
  sheet is many. The rest of the sheet is what this page's own controls do: a degree row
  is the family picker, a mode grid is the mode picker, a zoom strip is the wheel.
- **Nearly is refused.** Four reasons, and each is a thing the contract deliberately does
  not carry — a drawn diagram, a frame past the `f64` wall, a record that does not say
  enough, or a picture that needs something this page does not offer: a fractional
  degree, a curve the mode's own catalog does not give it, a fold on a cyclic map, **a
  cap somebody chose**. That last is the one that surprises: the depth policy owns the
  iteration cap and a link carries a place rather than a budget, so the figure drawn at
  300 iterations to show what banding looks like is a figure this page cannot reopen.

The links are held to the contract in `permalink.test.mjs`, where the contract lives —
every row parses, and every row is the canonical spelling of its own view. `builder
check`'s `explorer` check holds the other half: every picture on the site has a row, and
every row is a picture on the site.

## Rebuilding

```
python -m builder explorer                 # palettes, wasm, manifest
python -m builder explorer --palettes-only # when only the colormaps moved
python -m builder links --write            # the link registry, from figure provenance
```

Needs the sibling checkout, `cargo`, and the `wasm32-unknown-unknown` target
(`rustup target add wasm32-unknown-unknown`). `engine-wasm/target/` is gitignored — it is
the several hundred megabytes cargo needs to produce a 190 KB file.

Which colormaps count as curated is the wallpaper project's own distinction: a map that
arrived by mechanical conversion says so in its `source` line, and the rest were chosen.

## Next

Listed, not designed:

- **Download at chosen dimensions**, which needs a render path that is not the canvas.
- **Deep zoom**, which needs perturbation and is a different renderer, not a wider one.
- **The expensive modes' wait.** `stripe` over a whole 1280x720 frame is 46 s on one
  thread and about a sixth of that on a pool. Specializing the loop per family and mode
  would recover a third of it and cost a few hundred KB of module; nothing cheaper than
  that has turned up.
