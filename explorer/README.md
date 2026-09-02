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

Draft 1 was built to a design document that has since been retired; this README and the
tree are now the only record of what the explorer does. Where the build departed from
what was originally planned the departure was deliberate, and those decisions are
recorded here so the reasoning behind them is not lost:

- **The picker's set and the link's set are not the same set.** One set was to serve
  both — the curated maps, and nothing else. The picker offers **77** of those; a link
  may name **110**, because baked alongside them are the 33 maps this site's own
  published pictures were drawn in, most of them mechanical conversions rather than
  curated choices. A picture the article publishes has to be openable here, and it does
  not have to be on the menu.
- **A download re-iterates, every time.** The full-resolution field was to be computed
  once in the background, after which every palette download came back off it instantly.
  A wallpaper-sized field is not cached and cannot be: the lanes are eight bytes for
  every sample of every lane, the cache holds four fields, and the download path goes to
  the trouble of *terminating* its shade worker precisely so that memory comes back.
  Instant recolour is the screen's, where a field is a canvas's worth and the cache is
  the whole point of computing field and colour apart.
- **Nothing is shared, so no shim was ever needed.** Multithreaded wasm was taken to mean
  a `SharedArrayBuffer`, which needs cross-origin-isolation headers, which GitHub Pages
  will not send — so a service-worker shim to install them was planned for. No shim
  exists. Each worker instantiates its own copy of one compiled module, and its band is
  copied off that worker's heap and transferred once; nothing crosses a thread boundary
  that has to be shared, so no COOP, no COEP, and this page is plain files on Pages.
- **The port is byte-accurate, and was never required to be.** The browser's picture was
  allowed to differ from the engine's. It does not differ at all, and accuracy came free
  rather than being bought: it is the same `f64` code over the same inputs, and wasm's
  `f64` is IEEE-754 with no x87 excess precision to diverge through. **0 of 3,686,400
  pixels** differ between a 2560x1440 `ss=4` download and `fractal-engine render` of the
  same spec, and the tree is held to that.
- **The scope is the whole production roster.** Draft 1 was scoped to one family in one
  mode — mandelbrot in `smooth` — and that is long since passed: nine families, eighteen
  modes, every mode parameter the engine's catalog writes down. What the widening cost is
  *no loop of its own* below: the collapse draft 1 got for free by rendering one family
  in one mode had to be bought back, first by hand and now from the engine's own table.

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
palettes.jsonl        the roster palettes.js is baked from: 110 maps, 77 offered
modes.jsonl           the roster catalog.js is baked from: the 18 modes the picker offers
palettes.js           generated: the colormaps, by name, curated or drawn-in
catalog.js            generated: the offered modes, their curves, the anchors' constants
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
| `raw_bytes` / `gzip_bytes` | 614,666 raw, **177,908 gzipped** |

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
build never sets leaves it exactly where it was. It exists for `bench/families.mjs`,
it hands the engine's table `Channels::Many` so that every mode takes the generic loop,
and nothing ships with it on. It is declared in `build.rs` so the compiler expects the
name. Even the *shape* of the switch is chosen for this: it reads `cfg!(generic_loop)` as
an expression choosing the channel set rather than an `#[cfg]` attribute above it, because
an attribute is a line, a line moves every panic location under it, and nineteen bytes of
`Location` line numbers is the difference between a module that reproduces and one that
nearly does.

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
  time. See *no loop of its own* below.
- **`field::sweep_row` and `field::Channels` are public.** Both were private, so the
  engine's own table of specialized call sites — twelve channel sets over nine families,
  held bit-for-bit against its generic loop by its own tests — was unreachable from here,
  and this crate carried a hand-written stand-in: nine call sites covering the one mode
  whose channel set is empty, and every other mode down the generic fallthrough. Nothing
  held that copy to the engine's recurrence, which is the real defect: a change to the
  engine would have left this page rendering the old one with no test going red.
  Visibility only — no signature moved and no test did.

**That second one is no longer this consumer's alone**, and the third is why. The engine
wrote its own escape loop out per family and per channel set, and the `inline(always)` is
what that table is buying, so the engine depends on the attribute for its own reasons and
this crate now reaches the specialization through the engine rather than beside it.

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

Five more are exported and none of them is a fourth render path: `alloc` and `dealloc`,
through which JavaScript owns every buffer that crosses, and `maxiter_for_width`,
`resolution_ulps` and `resolution_ulps_floor`, which are the engine's own depth policy and
its own `f64` wall asked as questions. Those three are what let the page say *this zoom is
as far as double precision goes* in the engine's numbers rather than in a constant typed
here.

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

**No loop of its own, and what that took.** Draft 1 carried a rule: keep exactly one
call site into `iterate::run`, because a second one measured about three times the field
time. The rule was right and the reason was not. What that loop needs is not to be alone —
it is to be **inlined with its family and its channel set visible as constants**. Then the
eleven per-iteration channel checks fold away, the match over the families becomes one
multiply, and the `Orbit` stops being built at all. Draft 1 got that collapse for free by
rendering one family in one mode. A spec-struct boundary hands both in at runtime and
loses it, and neither half alone buys back more than a tenth of it.

For a long time this crate bought the collapse back by hand, for one mode: `smooth`, the
spine every composite is built on and the only catalogued mode that asks the loop for
nothing but the escape, got a call site per family, nine in all. Every other mode took the
generic fallthrough. **That copy is gone.** `compute_band` calls
`fractal_engine::field::sweep_row` a row at a time — the engine's own table, twelve
channel sets over nine families, which the engine holds bit-for-bit against its generic
loop in its own tests and which forms coordinates from the whole viewport with a global
row index, the one thing a band needs. So all eighteen modes are specialized, and there is
no second spelling of the recurrence on this side of the boundary to drift out of step
with the engine's. What that is worth per mode is the before/after table under *Measured*;
what it costs is 133,853 bytes of module, and neither is a gate the other decided.

The engine reduces at `f64` and leaves the narrowing to whoever called it, so that step is
the only arithmetic still written here: every lane crosses at the `f32` a dumped field
would have been stored as, except the modulate's texture, which the engine does not narrow
either.

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
whole frame out of wasm is a whole frame out of the native engine, **in every mode**.
The spike that established the port, on 2026-08-21, drew the 1280x720 anchor frame
through its single `render_smooth` export and through `fractal-engine render` of the same
spec, and **0 of 921,600 pixels differ**; it is the same f64 code over the same inputs,
and wasm's f64 is IEEE-754 with no x87 excess precision to diverge through. That leg was
`smooth` alone until the table landed, and it is now the whole catalog: each of the
eighteen modes drawn on the parameter plane and on a dynamical one, at one and at two
samples per pixel, against `fractal-engine render` of the same spec — **72 of 72 frames
byte-identical**, measured both before the rewire and after it, so a divergence would have
been attributable. Run a third time on 2026-09-01, when `coloring::modulate` next door
grew a second return value and this crate was rebuilt against it: **72 of 72 again**, at
384x216 rather than the full frame, which is the same arithmetic over fewer samples and
is what makes a re-run cheap enough to be worth doing after every engine move. **Measured too, where it used to be argued:** the banded
assembly equals a whole-frame pass through *this* module. `bands.test.mjs` draws the
anchor at 320x180 three ways — whole, the eight bands a two-worker pool cuts, the
twenty-three a sixteen-worker pool cuts — and asserts the three are the same bytes; then
the two pools again at two samples per pixel, where a band's output rows and its sample
rows come apart. It cuts with `render.js`'s own `bandsOf`, so what is held is the cut the
page makes and not a second copy of it. That link matters more than it did: the pool is
sized from the machine now, so how many cuts a frame gets is the reader's. **What the
chain still does not reach:** a frame at a download's size, at more than two samples per
pixel, and the families between mandelbrot and phoenix — the native leg is two families
because a run of it costs a native render per frame, and the case it is proving is the
dispatch rather than the plane.

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

**`resample::downsample` at one sample per pixel is the identity, and now skips itself**
— the Lanczos taps collapse to 1 at integer offsets and 0 at every other one, so both
passes over the 24-byte-per-pixel linear buffer are a long way to copy it. The engine
skips them, byte-identically, and it lands on the screen path, where a palette change pays
the shade again and nothing else. Measured against the module built before the skip:
**1.60x** on `smooth`'s shade at 1280x720 — 71 ms to 44 — 1.30x on `threads`, and 1.08x on
the modulate, whose own arithmetic is most of its shade. Above one sample per pixel the
filter stops being the identity and becomes the whole reason a download is worth taking.

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
this is the page's own pool, its own banding and its own shade against it. It is also
two *different* code paths agreeing rather than one: since `field::sweep_row` landed, the
native side takes a table of specialized call sites the wasm crate does not compile, and
the wasm side takes the nine of its own that the native side has no use for. Re-checked at
0 of 3,686,400 after the rebuild that put that table on the other side of the comparison.

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

**Every figure below is the specialized build, and a figure from before it is not a
number about this tree.** The rewrite that put `field::sweep_row` under `compute_band`
moved thirteen of the eighteen modes by 1.41x to 4.18x, so a pre-specialization reading —
draft 1's, the `x generic` column that has been retired, anything in a report written
before the manifest's third `engine_changes` line — describes a module this repository no
longer serves. Re-measure rather than quote: the four harnesses below are here so that
there is always something to re-measure with.

**This harness is tracked, and it is a re-measure harness rather than a guard.** Nothing
in it asserts anything: no script carries a threshold, no script exits non-zero, and
nothing runs them — `bench/` is named in no check and in no CI step. What it is, is the
measured record below plus the only way in this repository to take that reading again.
So the specialization cascade — `iterate::run` inlined into a call site that can see its
family and its channel set, worth 4x on the field — is not *guarded* here. It is
**recorded** here, and a rebuild that lost it would go unnoticed until somebody chose to
re-measure. Wiring an assertion to these numbers is the obvious next move and has
deliberately not been made: the readings are this machine on this day, and a threshold
over them would be red on somebody else's.

It is tracked for the half of the job it does do. It started under `scratch/`, which is
wiped, and a record a wipe can delete is not a record; three harnesses moved here —
`kernel.mjs`, `modes.mjs`, `sweep.mjs` — with the two helpers they lean on, and
`families.mjs` was written here the next day. `engine.mjs` is the wasm loader all four
call, and `output.mjs` sends every run's numbers to `artifacts/`, which is ignored. Code
is committed, measurements are not. The browser-driven rig that produced the pool figures
below stays under `scratch/`: it is a session's worth of driver scripts and probe pages,
and not even this much.

| frame | cap | draft 1 | now |
| --- | --- | --- | --- |
| home | 3 336 | 1 567 ms | 1 537 ms |
| anchor | 6 898 | 9 724 ms | 9 365 ms |

That is the whole point of the specialization, and draft 1's numbers were a single-family
single-mode build's. Both rows are `smooth`, the one mode that was specialized before the
engine's table was reached, so they moved by the 1.2% the per-mode table below records and
are not re-measured here.

**Per family**, `smooth` at 1280x720, each family at **its own home view** — a family's
home is the frame it comes back with when nobody names one, and holding nine families
over one rectangle would mostly measure how much of each is off screen. One thread,
median of three, `explorer/bench/families.mjs`. **These are this machine on this day**,
and this reading was taken on a quiet one; the ratios are the arithmetic and the
milliseconds are not a spec.

The reading before this one was not taken on a quiet machine, and what that cost is worth
knowing, because it is not what a loaded machine usually costs. The specialized column
reproduced to the millisecond across the two — mandelbrot 1 538 ms then, 1 533 now — while
every generic figure of that session came in **about 2.3x high**, mandelbrot's at 12 088 ms
against 6 355. The two loops are not equally exposed: the specialized one is the bare
recurrence and lives in registers, and the generic one builds a whole `Orbit` per iteration
and reads eleven channel flags, so contention for memory reaches one and barely touches the
other. That is consistent with the shape of it and is not established by it. What is
established is that **a ratio between these two columns is only as good as the noisier of
the two readings**, which is why both are measured in one run.

The `generic` column is the same frame through a module built with `--cfg generic_loop`,
which sends every mode down the fallthrough. That column is what the specialization is
worth, per family, measured rather than remembered. It was read on the module that carried
this crate's own nine call sites; `smooth`'s dispatch reaches the same generic loop either
way, and the 1.2% the per-mode table records is the whole of what moved under it.

| family | cap | field | x cheapest | generic | x |
| --- | --- | --- | --- | --- | --- |
| julia | 4 000 | 283 ms | 1.00 | 940 ms | 3.33 |
| phoenix | 3 115 | 439 ms | 1.55 | 1 361 ms | 3.10 |
| mandelbrot | 3 336 | 1 533 ms | 5.43 | 6 355 ms | 4.15 |
| multibrot3 | 3 047 | 1 967 ms | 6.96 | 5 302 ms | 2.70 |
| multibrot4 | 3 336 | 4 509 ms | 15.96 | 9 549 ms | 2.12 |
| julia3 | 4 000 | 9 841 ms | 34.83 | 26 939 ms | 2.74 |
| multibrot5 | 3 684 | 10 029 ms | 35.50 | 17 513 ms | 1.75 |
| julia5 | 4 000 | 10 552 ms | 37.35 | 19 842 ms | 1.88 |
| julia4 | 4 000 | 13 189 ms | 46.68 | 28 089 ms | 2.13 |

**The family costs more than the mode does.** Across the eighteen modes on one family the
spread is 13x; across the nine families in one mode it is **47x**, `julia` at its home to
`julia4` at its. Part of that is the cap, which is the engine's `maxiter::for_width` and
comes from the plane width a home view has: every dynamical plane opens at 4 000 and the
parameter planes at 3 047 to 3 684. The rest is how much of a home frame runs to the cap
instead of escaping, and that is a property of the family rather than of anything this
page chose.

**What the specialization buys is not one number.** It runs 1.7x to 4.2x, and the two
columns do not even order the families the same way: specialized, cost rises with degree,
which is the arithmetic; generic, `multibrot4` and `multibrot5` come in under `julia3` and
`multibrot3` comes in under `mandelbrot`, neither of which it does. The shape is consistent
with a fixed per-iteration overhead — eleven channel checks, the family match, the `Orbit`
built — that is a large share of a cheap recurrence and a small share of an expensive one,
and mandelbrot's 4.2x is the cheapest recurrence there is here. It is consistent with it and it is not established by it, and
nothing below rests on the explanation.

**Two generic figures have been retired here, and the fourfold one was right.** A scratch
experiment that is gone read the specialization as fourfold; the loaded-machine reading
above read it as near-eightfold and this section argued the fourfold one away; a quiet
machine reads **4.15x**, and the retired figure was the honest one. **6 355 ms** is what
this tree does. The generic module is checked against the committed one on `tia`, a mode
that takes the generic loop in both — 2 576 ms against 2 621 ms at 640x360, 1.02x, the same
engine with one dispatch changed — so the two modules differ in the dispatch and not in the
arithmetic. The `x generic` column of the per-mode table below divides by the measured
figure, and the header says so.

**Per mode, before and after the table landed.** Mandelbrot home at 1280x720, one
thread, median of three, the two modules **alternated within a run and the order flipped
between runs** — a ratio between two columns is only as good as the noisier of the two
readings, and measuring one column now and the other later is how a loaded machine gets
read as a code change. `before` is the committed module with its own nine call sites;
`after` is the same source calling `field::sweep_row`. The `field` column is
`compute_band` over the whole frame; `shade` is the colouring pass, which a palette change
pays again and nothing else does, and which this change does not touch. A direct trap has
no shade because its band arrives painted. Rows are in the order the page now pays for
them.

| mode | before | after | x | x smooth | shade |
| --- | --- | --- | --- | --- | --- |
| `smooth` | 1.54 s | 1.55 s | 0.99 | 1.00 | 44 ms |
| `smooth_trap_circle` | 7.15 s | 1.71 s | **4.18** | 1.10 | 180 ms |
| `trap_circle` | 7.09 s | 1.71 s | **4.14** | 1.10 | 188 ms |
| `itinerary` | 7.09 s | 1.86 s | **3.82** | 1.19 | 397 ms |
| `direct_trap_lines` | 4.20 s | 3.98 s | 1.06 | 2.56 | — |
| `direct_trap_screen` | 4.41 s | 4.51 s | 0.98 | 2.90 | — |
| `direct_trap_multiply` | 5.44 s | 5.65 s | 0.96 | 3.64 | — |
| `exp_smoothing` | 13.35 s | 6.45 s | 2.07 | 4.15 | 44 ms |
| `tia` | 10.93 s | 6.77 s | 1.61 | 4.36 | 208 ms |
| `threads` | 17.74 s | 7.03 s | 2.52 | 4.52 | 91 ms |
| `direct_trap_ring` | 7.13 s | 7.10 s | 1.00 | 4.57 | — |
| `smooth_curvature` | 13.29 s | 7.32 s | 1.81 | 4.71 | 227 ms |
| `curvature` | 13.41 s | 7.38 s | 1.82 | 4.75 | 206 ms |
| `gaussian_int` | 14.78 s | 10.51 s | 1.41 | 6.76 | 232 ms |
| `smooth_angle_min` | 14.94 s | 10.52 s | 1.42 | 6.78 | 236 ms |
| `smooth_mean_angle` | 15.05 s | 10.64 s | 1.41 | 6.85 | 263 ms |
| `stripe` | 26.93 s | 18.55 s | 1.45 | 11.94 | 203 ms |
| `smooth_stripe` | 27.49 s | 19.05 s | 1.44 | 12.26 | 221 ms |

**Thirteen modes got faster and the range is 1.41x to 4.18x**, which is not one number and
was never going to be: what the collapse is worth to a mode is what share of its
per-iteration work the eleven channel checks and the `Orbit` were. `trap_circle` and its
composite are the extreme — a trap test is a couple of comparisons, so the overhead was
most of the loop, and both land at **4.1x**. `itinerary` is 3.8x and is now the fourth
cheapest thing on the page. At the other end `stripe` reads 1.45x: an `atan2` and a `sin`
per iteration through a compiled libm are real arithmetic the checks were only ever a
fraction of. It is still the **8.4 seconds** that came off the mode this was run for.

**The four direct traps did not change and their column says so.** They paint during the
iteration and never reach `compute_lanes` at all, so 0.96x to 1.06x across them is this
harness's own spread at three runs and nothing else — a useful control, because it is
measured on code that provably did not move.

**`smooth` is 1.2% slower, and that one is real.** It is the mode that was already
specialized, so it had nothing to gain, and seven alternated runs put it at **1 538 ms
against 1 556 ms** — reproducible to the millisecond, with `direct_trap_ring` run beside
it as a control at 1.001x. The engine's `sweep_row` counts each row's interior samples for
its own caller's sake and this page throws that number away, which is a branch and an
increment per sample the hand-written loop did not run; the dispatch is also re-taken per
row rather than once per band, which is 720 matches against 921,600 samples and not where
18 ms comes from. Both are the price of calling the engine's function instead of keeping a
copy of it, and the carve-out this change lands under is visibility only — a signature
that let a caller decline the interior count is an engine prompt, not this one.

**The `x generic` column is retired rather than refreshed.** It existed because `smooth`
was specialized here and nothing else was, so a per-mode comparison against native needed
a baseline with both loops generic to divide by. Every mode is specialized now, on both
sides, which is what that column was a workaround for — but the native per-mode column it
was compared against was carried rather than re-derived, and this reading does not re-derive
it either. What would close it is a native per-mode pass on this machine, and it is
unmeasured here rather than estimated.

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

**The module** is 614,666 bytes raw and 177,908 gzipped, against draft 1's 190,240 and
70,639. Most of that is the eighteen modes' worth of engine that is reachable at all —
every field reduction, both blends, the trap painter, all nine families — plus
`serde_json` and the derived readers for the spec.

**Reaching the engine's table cost 133,853 bytes raw and 14,063 gzipped**, 480,813 to
614,666: the whole table is twelve channel sets over nine families and it arrives whole,
where the nine call sites it replaced were 13.4 KB. That is a plain fact and not a gate —
no size outcome was going to block this, and the alternative, instantiating by hand only
the nine channel sets the explorer's eighteen modes actually reach, is a hand-written copy
of the table again, which is the thing the change is for. **A tenth of the raw growth is
what a reader downloads**: the transfer is gzipped, and 14 KB on 164 is the honest figure
to compare against 8.4 seconds off `stripe`.

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
v · f · cx · cy · px · py · zx · zy · m · the mode's parameters · x · y · w · a · p · the shade keys
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
recipe** group. What is worth writing down is the shape rather than the widgets:

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
the several hundred megabytes cargo needs to produce a 480 KB file.

Which colormaps count as curated is the wallpaper project's own distinction: a map that
arrived by mechanical conversion says so in its `source` line, and the rest were chosen.

**What the bake reads is `palettes.jsonl`, not that distinction.** The roster used to be
derived — every curated map, plus every map a figure of this article names — and it grew
by two hundred the day the wallpaper project admitted an authored drop into its library.
A rebake nobody ran on purpose would have taken the picker from 77 entries to 277, which
is a change to what a reader is offered arriving as a build artifact. So the 110 names
and their `offered` flags are a committed record here; the bake reads the gradients next
door and the roster from the record, and `builder check`'s **bake** check asserts that
the committed `palettes.js` is byte for byte what that produces. Widening the picker is
an edit to the record, made on purpose, in a commit that says so.

**`catalog.js` has the same shape of record now, and it did not always** *(2026-09-01)*.
Pinning the mode roster the way the picker's palettes are pinned was declined once, on the
argument that the modes are the engine's own identity rather than a choice this repository
makes; the module bakes from `fractal-engine modes` and the project's shipped anchors, and
`check` compared it below its two clock fields rather than byte for byte. Then the engine
promoted `tail_itinerary`, and the next bake would have put a nineteenth entry in the
picker and a nineteenth name in the contract — the palette drop's failure mode exactly,
arriving from the other repository. So `modes.jsonl` names the eighteen the picker offers,
in the order it shows them; the bake takes each mode's identity line and its curve from
the catalog next door and offers nothing the record does not name, and its stamp is read
off the record's method row, so `catalog.js` now reproduces **byte for byte** like
`palettes.js` and there is no clock carve-out left.

That is three copies of one list — the record, the baked module, `permalink.js`'s typed
`MODES` — and both ties are held: `check`'s `bake` holds the record to the module, and
`permalink.test.mjs` holds the module to the contract. Widening the picker is an edit to
the record and to that array, both made on purpose. What the bake still refuses rather
than absorbs is the other direction: a name the record holds that the catalog has renamed
away, or one the engine has demoted out of `production`, stops the bake by name. **A
retuned mode still arrives on this page by rebuilding** — its identity line and its curve
are the engine's — but now with a failing check to announce it rather than only a diff.

## Next

Listed, not designed:

- **Deep zoom**, which needs perturbation and is a different renderer, not a wider one.
- **A native per-mode column measured on this machine.** The one comparison the
  per-mode table above can no longer make: what each mode costs `fractal-engine render`
  at the same frame, so the wasm/native slope is read off two readings of the same day
  rather than one of them carried. Both sides take the specialized table now, which is
  what makes the comparison worth having and is why the `x generic` workaround is gone.
- **The expensive modes' wait, after the table.** `stripe` is 18.6 s over a whole
  1280x720 frame on one thread and about a sixth of that on a pool, down from 26.9 s —
  the largest absolute saving on the page and still the longest wait on it. What is left
  is arithmetic rather than dispatch: an `atan2` and a `sin` per iteration, through a
  compiled libm because wasm has no transcendental instructions. Nothing here shortens
  that; a coarser preview or a cheaper approximation of the channel would, and both are
  changes to the picture.
