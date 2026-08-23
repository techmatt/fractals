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

Two more things are outside the contract **by ruling**, and each is a refusal a figure can
run into. **The iteration cap is not a link key.** The depth a picture is drawn to is the
engine's own depth-aware policy at that width, and a key for it would let a link say "this
frame, but shallower" — a different picture wearing the same name. The article's
`render-maxiter` figure was drawn at a cap of 300 where the policy gives 32,474 at its
width, so it stays unlinked by design rather than opening at something near it. **A mode
parameter left alone is not emitted.** Its default lives in the engine's mode catalog,
which is the same place the mode's identity lives, so a link that omits `density` is asking
for "the stripe mode" rather than for "a stripe mode at 6" — and it should move if the
catalog ever retunes that mode. `permalink.js` states both sides of that, and
`builder/links.py`'s `REASONS` is where a refusal gets its name.

The design draft 1 was built to is `preserve\visitor_explorer_design.md` on the synced
drive. It is not restated here; where the two disagree, the tree is what is true and the
design doc is what was intended. Everything it rules is built or deliberately
superseded, and these are the places the two have come apart:

- **"the 76 curated q3 set ONLY"** — the picker offers **77**, and a link may name **108**.
  The wider set is every map the article's own figures were drawn in, most of them
  mechanical conversions rather than curated choices: a picture the article publishes has
  to be openable here, and it does not have to be on the menu.
- **"full-res computes in background, then ALL palette downloads are instant"** — a
  download re-iterates, every time. A wallpaper-sized field is not cached and cannot be:
  the lanes are eight bytes for every sample of every lane, the cache holds four fields,
  and the download path goes to the trouble of *terminating* its shade worker precisely
  so that memory comes back. Instant recolour is the screen's, and it is exactly as
  designed there.
- **"multithreaded wasm needs cross-origin-isolation headers; GitHub Pages needs a
  service-worker shim"** — superseded, and no shim exists. Each worker instantiates its
  own copy of one compiled module and its band is copied out and transferred; nothing is
  shared, so no COOP, no COEP, and this page is plain files on Pages.
- **"byte-accuracy NOT required"** — it turned out free, and the tree is held to more than
  the doc asked: 0 of 3,686,400 pixels differ between a 2560x1440 `ss=4` download and
  `fractal-engine render` of the same spec.
- **"Draft-1 scope (mandelbrot smooth only)"** — long since passed: nine families,
  eighteen modes, every mode parameter the engine's catalog writes down.

## What is here

```
index.html            the page
explorer.css          its own stylesheet, on top of the site's
explorer.js           what a reader touches: drag, wheel, keys, pickers, copy link
shade.js              the recipe's controls, apart from the boxes they are drawn in
download.js           the same render at a wallpaper's size, and what caps it
render.js             the worker pool, the plan, the field passes, the shade
worker.js             one worker: one wasm instance, one band of rows
permalink.js          the link contract — parse, validate, canonicalize
permalink.test.mjs    34 tests, `node --test explorer/permalink.test.mjs`
bands.test.mjs        3 tests: the pool cuts the frame, never what is in it
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
| `raw_bytes` / `gzip_bytes` | 473,427 raw, **162,338 gzipped** |

`engine_changes` is typed, in `builder/explorer.py`, and is the condition CLAUDE.md puts
on a website prompt touching the sibling engine at all: a zero-behaviour change is allowed
there only if it is named here. Nothing in the sibling repository marks a commit as one of
these, so a derived list would be a guessed one.

`python -m builder check` reads the manifest back and prints a **note** when
`wallpapers_commit` is no longer an ancestor of the sibling checkout's `HEAD`. A note and
never a failure: the module is committed and the site serves it whichever commit it came
from, and a clone with no wallpaper project beside it — CI, every time — says nothing at
all.

**The committed module rebuilds to its own bytes**, on this machine and this toolchain —
`cargo build --release --target wasm32-unknown-unknown` and `engine.wasm` agree byte for
byte, checked. It is not a check anything runs and it is not promised across machines,
but it is worth knowing it holds, because it is the cheapest possible answer to "is this
artifact the source beside it".

That is also why **`generic_loop` is a bare `--cfg` and not a cargo feature**. A feature
enters the crate's metadata hash and the module stops reproducing; a `--cfg` the default
build never sets leaves it exactly where it was. It exists for `bench/families.mjs`, it
sends `smooth` down the generic fallthrough with every other mode, and nothing ships with
it on. It is declared in `build.rs` so the compiler expects the name. Even the *shape* of
the switch is chosen for this: it reads `!cfg!(generic_loop)` inside the existing match
rather than an `#[cfg]` attribute above it, because an attribute is a line, a line moves
every panic location under it, and nineteen bytes of `Location` line numbers is the
difference between a module that reproduces and one that nearly does.

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
shade(spec, lanes)        -> RGBA bytes  a frame at a time, and it owns them
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
becomes one multiply, and the `Orbit` stops being built at all: 1.5 s against 12.1 s on
the same 1280x720 frame, measured per family under *Measured* below. Draft 1 got that collapse for free by rendering one family in one
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

**Bands.** `Math.min(16, navigator.hardwareConcurrency || 8)` workers, each with its own
instance of one compiled module — the module is compiled once on the main thread and
structured-cloned in, so a pool of any size costs one compile between them. The frame is
cut into four bands per worker, never shorter than eight rows, dispatched from a queue:
more bands than workers is what makes an interior-heavy band cost somebody else's idle
time rather than the whole frame's, and it is what bounds how long a cancel takes. A
worker knows nothing about families or modes: it is handed the spec as text and the
number of bytes its answer will be, both worked out on the main thread from the plan.

**The pool is the machine's, and the two numbers around it are not the same kind of
number.** Eight used to be the cap and one was the fallback, which had it exactly
backwards: the cap threw away a third of a twelve-core machine's frame, and the fallback
gave a whole pool's work to one worker on the browsers that decline to say how many cores
they have — which are not slow machines, they are machines told to look anonymous. So the
**fallback is eight**, a modern laptop's honest guess, and the **ceiling is sixteen**. The
ceiling is where the returns stop rather than where anything breaks: a frame is cut into
at most `height / 8` bands, so at a laptop-sized canvas somewhere past sixteen workers the
extra ones are queueing for a band that is not there, and the preview pass — a quarter of
the rows — runs out of bands sooner than that.

**What a bigger pool costs in memory is not what it sounds like.** A wasm heap never gives
memory back, so N workers is N heaps that each stay as large as the largest band they were
handed — but a band is `1/4N` of the frame, so the pool's total field memory is roughly a
frame's quarter however N falls, and a bigger pool means *more, smaller* heaps rather than
more memory. What does not divide is the **60-million-sample ceiling on a download**, and
it is worth being exact about why: that ceiling is the *shade*, it runs in one worker of
its own, and it holds the whole frame's linear-light colour in a single 32-bit address
space. One worker does that job at every pool size. Raising the pool neither raises nor
lowers it.

**A band is a range of output rows, never of samples.** At one sample per pixel the two
are the same range, which is what this page has always drawn; above it a band is the
`ss` sample rows behind those output rows. One rule rather than two, because a caller
that had to know which of the two a row index meant would get it wrong exactly once —
and it is the cut that lets a direct trap reduce its own band before sending it.

A band's coordinates are formed from the **whole** viewport, with the global row index —
so the assembled field is bit for bit what a whole-frame pass through the same module
produces, and there are no seams between bands. What is measured and what is not are
different links of one chain, and it is worth keeping them apart. **Measured:** a
whole frame out of wasm is a whole frame out of the native engine. The spike that
established the port — `fractal-drive-sync/reports/wasm_spike_report.md`, 2026-08-21 —
drew the 1280x720 anchor frame through its single `render_smooth` export and through
`fractal-engine render` of the same spec, and **0 of 921,600 pixels differ**; it is the
same f64 code over the same inputs, and wasm's f64 is IEEE-754 with no x87 excess
precision to diverge through. **Measured too, where it used to be argued:** the banded
assembly equals a whole-frame pass through *this* module. `bands.test.mjs` draws the
anchor at 320x180 three ways — whole, the eight bands a two-worker pool cuts, the
twenty-three a sixteen-worker pool cuts — and asserts the three are the same bytes; then
the two pools again at two samples per pixel, where a band's output rows and its sample
rows come apart. It cuts with `render.js`'s own `bandsOf`, so what is held is the cut the
page makes and not a second copy of it. That link matters more than it did: the pool is
sized from the machine now, so how many cuts a frame gets is the reader's. **Still not
compared at all:** the explorer end to end against a native render of the same view, at
any family or mode.

**Shade takes the whole frame, and takes the buffer with it.** It is the one place on
this boundary where JavaScript hands a buffer over rather than lending it, and a
download is the reason: the lanes are eight bytes for every sample of every lane, the
linear-light colour made from them is twenty-four bytes for every sample, and holding
both at once is what puts a two-lane mode at a wallpaper's size past what a 32-bit
address space has. `shade` frees the lanes the moment their numbers have been read into
fields — before a byte of colour is allocated — and frees them on every path including
a refusal, because a caller cannot be told sometimes.

**And never a band.** The engine normalizes a frame against its
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
step of a picture is the engine's and not this page's — and above one sample per pixel
it stops being the identity and becomes the whole reason a download is worth taking.

**A direct trap's band is padded, and every other band is not.** A field is shaded whole,
so a band of it is just rows; a direct trap arrives *encoded*, and Lanczos-3 reaches
three output pixels either side, which is `3 * ss` sample rows past the band's own. So
above one sample per pixel such a band iterates that many rows past itself on each side,
reduces through `resample::build_taps_at` at an origin saying where its first output row
sits in what it computed, and keeps only its own. Without it every pair of bands would
show a darker line where two clipped kernels were renormalized. At one sample per pixel
the pad is zero, because the taps read nothing but their own row.

**Nothing shared.** No `SharedArrayBuffer`, no cross-origin-isolation headers, no COOP,
no COEP, no service worker to install them. A worker's band is copied off the wasm heap
and transferred once, when it is done. That is what lets this page be plain files on
GitHub Pages.

## The download

The view on the screen, drawn again at a wallpaper's size, and it is **the same render**:
`Renderer.field` over the same pool, the same spec, the same iteration cap, with two
numbers changed. There is no second render path, deliberately — a download that drew the
picture its own way would eventually draw a different picture, and nobody would know
which of the two was the renderer's.

**Supersampling is the engine's.** At `ss` the frame is iterated on a grid `ss` times
finer on each axis and reduced by `resample::downsample` inside wasm: Lanczos-3 in linear
light, the filter a finished wallpaper is written through. Scaling a canvas would be a box
average over gamma-encoded bytes, which is a different picture and a worse one. Held to
the strongest check there is — a 2560x1440 at `ss=4` downloaded from this page and the
same spec through `fractal-engine render` differ in **0 of 3,686,400 pixels**. That is
the comparison the port never had: the spike measured one export against the CLI, and
this is the page's own pool, its own banding and its own shade against it.

**Shape is not resolution.** A link carries an aspect and never a pixel count, and the
plane *width* is what a view is, so downloading at a different shape keeps that width and
shows more or less height rather than cropping. The control says so in one line.

**Off the main thread, both halves.** The field is the pool as always. The shade is
milliseconds at a canvas's size and *seconds* at a wallpaper's — a 2560x1440 at `ss=4` is
sixty-four times a screen's samples — so it goes to a worker of its own, which is then
**terminated**. A wasm heap never gives memory back, and the instance that colours a
fifty-nine-million-sample frame grows to a couple of gigabytes and would hold them for
the rest of the session. One instantiation of an already-compiled module is what that
costs.

**The cap is memory, not patience.** Colouring holds the whole frame in one heap at once,
and the linear-light buffer is twenty-four bytes for every *sample*. That is the engine's
own shape and a native render carries it too; what is different is that `wasm32` has a
four-gigabyte address space and nowhere to spill, and `panic = "abort"` turns an
allocation failure into a trap. Measured: 2560x1440 at `ss=4` — **59.0 M samples** —
completes for every coloring shape, including the modulate, whose texture lane is the one
the engine never narrows. 3840x2160 at `ss=4` is 132.7 M and traps. So the ceiling is
**60 million samples**, and it is on samples rather than pixels because a supersample
costs its square. Output is capped separately at 8192 a side and 33.5 M pixels, which is
the canvas a PNG is encoded on and is far under the lowest browser cap in circulation.
A view that `f64` still resolves on the screen can be one it does not resolve on a grid
four times finer, and that refusal is the engine's own sentence, shown as it stands.

**The estimate is a table until it is a measurement.** Before a render the wait is the
per-mode field cost below, scaled by sample count and divided by the pool; from the first
band that lands it is the measured rate, and the table is not consulted again. The bar
advances by band, and cancel is by generation exactly as a pan is.

While a download is drawing, **the view is held still** — a wheel notch would cancel the
pass it is waiting on, and losing a two-minute render to a stray scroll is not a trade
anybody would make. The cancel button is the way out and is the only live control.

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
node explorer/bench/families.mjs [generic.wasm]     # every family, smooth, at its home
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

That is the whole point of the nine specialized call sites, and draft 1's numbers were a
single-family single-mode build's.

**Per family**, `smooth` at 1280x720, each family at **its own home view** — a family's
home is the frame it comes back with when nobody names one, and holding nine families
over one rectangle would mostly measure how much of each is off screen. One thread,
median of three, `explorer/bench/families.mjs`. **These are this machine on this day**,
and it was a machine with other work on it; the ratios are the arithmetic and the
milliseconds are not a spec.

The `generic` column is the same frame through a module built with `--cfg generic_loop`,
which sends `smooth` down the fallthrough with every other mode. That column is what the
nine call sites are worth, per family, measured rather than remembered.

| family | cap | field | x cheapest | generic | x |
| --- | --- | --- | --- | --- | --- |
| julia | 4 000 | 288 ms | 1.00 | 992 ms | 3.45 |
| phoenix | 3 115 | 703 ms | 2.44 | 1 978 ms | 2.81 |
| mandelbrot | 3 336 | 1 538 ms | 5.35 | 12 088 ms | 7.86 |
| multibrot3 | 3 047 | 1 988 ms | 6.91 | 10 900 ms | 5.48 |
| multibrot4 | 3 336 | 4 521 ms | 15.72 | 9 583 ms | 2.12 |
| julia3 | 4 000 | 9 914 ms | 34.48 | 28 402 ms | 2.86 |
| multibrot5 | 3 684 | 10 949 ms | 38.08 | 17 942 ms | 1.64 |
| julia5 | 4 000 | 13 098 ms | 45.55 | 32 946 ms | 2.52 |
| julia4 | 4 000 | 13 235 ms | 46.02 | 48 568 ms | 3.67 |

**The family costs more than the mode does.** Across the eighteen modes on one family the
spread is 20x; across the nine families in one mode it is **46x**, `julia` at its home to
`julia4` at its. Part of that is the cap, which is the engine's `maxiter::for_width` and
comes from the plane width a home view has: every dynamical plane opens at 4 000 and the
parameter planes at 3 047 to 3 684. The rest is how much of a home frame runs to the cap
instead of escaping, and that is a property of the family rather than of anything this
page chose.

**What the specialization buys is not one number.** It runs 1.6x to 7.9x, and the two
columns do not even order the families the same way: specialized, cost rises with degree,
which is the arithmetic; generic, `multibrot4` and `multibrot5` come in under `julia3`,
which it does not. The shape is consistent with a fixed per-iteration overhead — eleven
channel checks, the family match, the `Orbit` built — that is a large share of a cheap
recurrence and a small share of an expensive one, and mandelbrot's 7.9x is the cheapest
recurrence there is here. It is consistent with it and it is not established by it, and
nothing below rests on the explanation.

**The generic figure this section used to carry does not reproduce.** It was recorded by a
scratch experiment that is gone and cannot be re-run, it was about half the measurement
above, and it read as a fourfold specialization rather than the near-eightfold one the
table gives. **12 088 ms** is what this tree does: the generic module was checked against
the committed one on `tia`, a mode that takes the generic loop in both — 6 124 ms against
5 887 ms at 640x360, the same engine with one dispatch changed — so the two modules differ
in the dispatch and not in the arithmetic. The `x generic` column of the per-mode table
below divides by the measured figure, and the header says so.

**Per mode**, same harness, mandelbrot home at 1280x720, one thread. The `field` column
is `compute_band` over the whole frame; `shade` is the colouring pass, which a palette
change pays again and nothing else does. A direct trap has no shade because its band
arrives painted.

| mode | field | shade | x smooth | x generic, 12 088 ms | native |
| --- | --- | --- | --- | --- | --- |
| smooth | 2.27 s | 157 ms | 1.00 | 0.19 | 1.00 |
| direct_trap_lines | 6.12 s | — | 2.70 | 0.51 | 0.93 |
| direct_trap_multiply | 7.85 s | — | 3.46 | 0.65 | 1.24 |
| direct_trap_screen | 8.20 s | — | 3.61 | 0.68 | 0.91 |
| direct_trap_ring | 10.35 s | — | 4.56 | 0.86 | 1.08 |
| itinerary | 12.12 s | 694 ms | 5.34 | 1.00 | 1.26 |
| trap_circle | 13.08 s | 309 ms | 5.76 | 1.08 | 1.01 |
| smooth_trap_circle | 13.32 s | 372 ms | 5.87 | 1.10 | 1.06 |
| curvature | 19.86 s | 485 ms | 8.75 | 1.64 | 2.45 |
| smooth_curvature | 20.75 s | 357 ms | 9.14 | 1.72 | 2.60 |
| smooth_mean_angle | 23.38 s | 492 ms | 10.30 | 1.93 | 2.81 |
| smooth_angle_min | 24.10 s | 530 ms | 10.62 | 1.99 | 2.73 |
| threads | 25.35 s | 227 ms | 11.17 | 2.10 | 2.06 |
| tia | 26.67 s | 351 ms | 11.75 | 2.21 | 1.79 |
| exp_smoothing | 27.65 s | 171 ms | 12.18 | 2.29 | 1.58 |
| gaussian_int | 28.30 s | 467 ms | 12.47 | 2.34 | 2.66 |
| smooth_stripe | 43.35 s | 473 ms | 19.10 | 3.59 | 3.88 |
| stripe | 46.06 s | 454 ms | 20.29 | 3.81 | 3.92 |

**The wallpaper project's relative-cost column mostly does transfer, and reading it
against a dead baseline is what said otherwise.** Against the smooth this page actually
draws, every other mode is 2.7x to 20x rather than the native column's 0.9x to 3.9x — but
most of that is smooth's own specialization, so the honest comparison is the `x generic`
column, both loops generic. On the measured baseline every mode there lands between
**0.5x and 1.5x of its native slope**: stripe 3.81 against 3.92, threads 2.10 against
2.06, trap_circle 1.08 against 1.01, with `direct_trap_multiply` at 0.65 against 1.24 and
`exp_smoothing` at 2.29 against 1.58 at the two ends. That is a spread and not an offset.
This section used to read it as one — against the old divisor every ratio was about twice
what it is here, which looked like a systematic wasm tax and was an arithmetic error.
Two things remain true of the comparison and neither is measured, and neither is now
being asked to explain anything: wasm has no transcendental instructions, so the `atan2`,
`sin` and `exp` the averaging channels run per iteration go through a compiled libm rather
than the platform's; and the native column is wall-clock on twelve threads, where a mode
that adds arithmetic but not memory traffic scales better and its ratio compresses. The
prompt's remembered figures were `threads` 2.2x and `stripe` 4x; the recorded native
slopes are 2.06 and 3.92.

**On a real machine with a real pool** the wait is much shorter than that table reads,
because a canvas is smaller than 1280x720 and a pool is not one thread. Chrome 151
headless, 12 logical cores, the page driven at 1136x636 through its own controls — and
**taken while the pool was capped at eight**, so the same machine now runs these on
twelve and the numbers below are a ceiling rather than a reading:
mandelbrot `smooth` at home 0.23 s, the spike anchor 1.52 s, julia `smooth_stripe` at
density 9 0.71 s, phoenix `itinerary` 0.39 s, multibrot3 `direct_trap_ring` 1.53 s,
mandelbrot `smooth_trap_circle` 1.47 s, and the worst seen, julia5 `threads` at sigma
0.25, 7.77 s. Shade is main-thread and pool-independent at 150–500 ms, and a preview
lands at a sixteenth of the samples before any of it.

**The module** is 473,427 bytes raw and 162,338 gzipped, against draft 1's 190,240 and
70,639. The extra is the eighteen modes' worth of engine that is now reachable — every
field reduction, both blends, the trap painter, all nine families — plus `serde_json` and
the derived readers for the spec. 12.6 KB of it is the nine specialized loops, and 3.1 KB
is the download: a supersample in the spec, a padded direct-trap band, and a `shade` that
frees what it was handed.

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
  parameter, at the engine's defaults, handed to the module exactly as they are read
  here. They were **link-only** for two drafts and are not any more — see *The controls
  for the recipe* below.

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

### The controls for the recipe

The seven were link-only until the strip under the picture gained a folded **Shade
recipe** group, and the design doc had ruled them from the start. What is worth writing
down is the shape rather than the widgets:

- **A control's value and a link's spelling of it are the same string.** A number box
  holds `0.75` and the link says `gamma=0.75`; a menu holds `soft_knee` beside a box
  holding `0.35` and the link says `rolloff=soft_knee:0.35`. Every control hands its text
  to this module's own reader, so a value out of range is refused **in the contract's own
  sentence** and the box goes back to what is still in force. There is no second reader.
- **A control is named for the key, not for what it does.** Gamma, Cycles, Phase,
  Reverse, Mirror, Transfer, Rolloff — every other control on the page is named for its
  job, and these are named so that a reader who has just read `rolloff=aces` in the
  address bar finds Rolloff on the page rather than Highlights.
- **What a control opens at is the engine's default**, read out of the recipe above and
  never typed twice. The one number the engine has no default for is the parameter of a
  tagged kind — the contract refuses `transfer=edge` without its weight — so a menu that
  offers `edge` opens it at a value the wallpaper project itself renders: 0.5 for the
  edge weight, and 0.35 for the soft knee, which is the only knee its records hold.
- **Every change is a re-shade and not a re-iterate**, which is what `fieldKey`
  guarantees: none of the seven is on the field side of the cache, so a moved gamma is
  the 250 ms the palette picker costs and not the seconds a frame does. The four direct
  traps are the exception they always were — no field, so the cache keys on the colour
  too — and there they are also *inert*: the engine refuses to spend a gamma or a
  transfer on a trap distance that is already a fraction of a threshold, and only the
  bake and the rolloff reach one. The strip says so under itself when a direct trap is
  the mode.
- **A cyclic map's fold is refused before it is asked for.** `mirror` on a map that
  closes on the colour it opens with is a refusal in `parse`, so the control is disabled
  and says which map and why rather than letting a reader write a link that will not open.
- **A group that is closed says when it is not empty.** The recipe is folded away by a
  `<details>` — no script, on the one page that has some — and its summary carries how
  many of the seven are set. A link that set any of them opens the group.

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

`permalink.test.mjs` holds all of that: **34 tests**, Node's own runner, nothing
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

- **Deep zoom**, which needs perturbation and is a different renderer, not a wider one.
- **The expensive modes' wait.** `stripe` over a whole 1280x720 frame is 46 s on one
  thread and about a sixth of that on a pool. Specializing the loop per family and mode
  would recover a third of it and cost a few hundred KB of module; nothing cheaper than
  that has turned up.
- **Re-measuring the per-mode table.** Its field times are a median of two, which on a
  wasm frame is the *slower* of two. Its `x generic` column now divides by a measured
  baseline, so what is left is one bench run over the field times, and they are not wrong
  about which modes are expensive.
