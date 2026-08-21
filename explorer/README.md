# The visitor explorer

One page that runs the wallpaper project's own renderer in the browser: pan and zoom the
Mandelbrot set in the `smooth` mode, pick from the curated palettes, and copy a link to
whatever is on screen.

**Draft 1 is one family, one mode, `f64`.** `mandelbrot`, `smooth`, the 77 curated
colormaps, and double-precision arithmetic that stops zooming where the engine says two
neighbouring samples have become the same number. The article's deep-zoom figures stay
baked rasters and are not this page's job — a picture that needs perturbation needs a
renderer this page does not carry.

The design this was built to is `preserve\visitor_explorer_design.md` on the synced
drive. It is not restated here; where the two disagree, the tree is what is true and the
design doc is what was intended.

## What is here

```
index.html            the page
explorer.css          its own stylesheet, on top of the site's
explorer.js           what a reader touches: drag, wheel, keys, picker, copy link
render.js             the worker pool, the field passes, the shade
worker.js             one worker: one wasm instance, one band of rows
permalink.js          the link contract — parse, validate, canonicalize
permalink.test.mjs    22 tests, `node --test explorer/permalink.test.mjs`
palettes.js           generated: the curated colormaps, by name
engine.wasm           generated: the engine, compiled
engine.manifest.json  generated: what engine.wasm was built from
engine-wasm/          the crate that produces engine.wasm
```

The three generated files are **committed artifacts**. The site never builds; a clone
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
| `raw_bytes` / `gzip_bytes` | 190,240 raw, **70,639 gzipped** |

`python -m builder check` reads the manifest back and prints a **note** when
`wallpapers_commit` is no longer an ancestor of the sibling checkout's `HEAD`. A note and
never a failure: the module is committed and the site serves it whichever commit it came
from, and a clone with no wallpaper project beside it — CI, every time — says nothing at
all.

### What the engine needed, and did not

Nothing. The engine library compiles for `wasm32-unknown-unknown` unchanged, on two
points worth knowing:

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

## The seam, and the two exports

The engine keeps a seam between a *field* — one scalar per sample, the expensive part —
and the *color* it is read into. This page holds that seam open one level further out, so
that JavaScript sits in it:

```
compute_field(spec, row_start, row_end) -> f32 bytes    in a worker, a band at a time
shade(field, palette, recipe)           -> RGBA bytes   on the main thread, milliseconds
```

**Bands.** `Math.min(8, navigator.hardwareConcurrency || 1)` workers, each with its own
instance of one compiled module — the module is compiled once on the main thread and
structured-cloned in, so eight workers cost one compile between them. The frame is cut
into four bands per worker, never shorter than eight rows, dispatched from a queue: more
bands than workers is what makes an interior-heavy band cost somebody else's idle time
rather than the whole frame's, and it is what bounds how long a cancel takes.

A band's coordinates are formed from the **whole** viewport, with the global row index —
so the assembled field is bit for bit what a whole-frame pass through the same module
produces, and there are no seams between bands. What is measured and what is argued are
two different links of one chain, and it is worth keeping them apart. **Measured:** a
whole frame out of wasm is a whole frame out of the native engine. The spike that
established the port — `C:\Code\fractal-drive-sync\reports\wasm_spike_report.md`,
2026-08-21 — drew the 1280×720 anchor frame through its single `render_smooth` export
and through `fractal-engine render` of the same spec, and **0 of 921,600 pixels
differ**; it is the same f64 code over the same inputs, and wasm's f64 is IEEE-754
with no x87 excess precision to diverge through.
**Argued:** the banded assembly equals that whole-frame pass, from the global row indices
above — not measured, and the spike's module was the one-export one rather than this
page's. **Not compared at all:** the explorer end to end against a native render of the
same view.

**Shade takes the whole field, never a band.** The engine normalizes a frame against its
own distribution, and at the shipped default (`Transfer::Value`) that is a percentile
stretch — the 0.5th and 99.5th percentiles of the frame's valid samples. A band shaded
alone would be stretched against the wrong histogram and would not match its neighbours.
The other two transfers the recipe can ask for bring one frame-wide statistic each:
`Transfer::Edge` a 200-bin gradient-magnitude profile, `Transfer::Rank` a sort of every
valid sample.

**A pass draws twice.** A quarter-resolution field first, then the full one. The preview
is a *separate* field of the same rectangle rather than a subsample of the full one, so
it carries its own percentile stretch and can be a shade off the picture that replaces
it. The canvas's pixel grid is rounded to a multiple of four on both axes so the preview
is exactly the same rectangle at exactly a quarter of the samples.

**Cancel is by generation, not by termination.** A pan bumps the generation, no further
bands are dispatched, and the band still in flight is finished and thrown away — killing
a worker mid-band would cost a wasm instantiation to save at most one band. The abandoned
pass resolves with `null` rather than being left pending: a promise nobody settles holds
its whole `await` chain alive, and a reader who drags across the set makes one per drag.

**The field cache** is keyed on the canonical permalink *minus* the palette and the shade
recipe, plus the pixel grid it was sampled on — geometry alone, because nothing on the
color side can change the field. Four fields are kept: two passes of the current view and
one view back. So a palette change re-shades what is already here and iterates nothing,
which is the whole point of computing the two apart.

**`resample::downsample` at one sample per pixel is the identity** — the Lanczos taps
collapse to 1 at integer offsets — and it still runs both tap passes over a
24-byte-per-pixel linear buffer. It is most of the shade cost. Kept, because the last
step of a picture is the engine's and not this page's.

**Nothing shared.** No `SharedArrayBuffer`, no cross-origin-isolation headers, no COOP,
no COEP, no service worker to install them. A worker's band is copied off the wasm heap
and transferred once, when it is done. That is what lets this page be plain files on
GitHub Pages.

## Measured

From the `explorer_draft1` record — Chrome 151 headless, 12 logical cores, one sample per
pixel, mode `smooth`. **Not re-measured since.** `home` is the family's home view;
`anchor` is a hard location deep in the spike.

| view | pass | maxiter | 1 worker | 4 workers | 8 workers |
| --- | --- | --- | --- | --- | --- |
| home | preview 320×180 | 3336 | 286 ms | 31 ms | 22 ms |
| home | full 1280×720 | 3336 | 1 853 ms | 506 ms | 355 ms |
| anchor | preview 320×180 | 6898 | 748 ms | 201 ms | 132 ms |
| anchor | full 1280×720 | 6898 | 10.7 s | 3.13 s | 2.17 s |

1→8 workers is 5.2× on home and 4.9× on the anchor. Shade is main-thread and
pool-independent: 266–276 ms on home, 165–168 ms on the anchor, at 1280×720. Recoloring a
cached field is 66–272 ms and iterates nothing.

## The permalink contract, version 1

`permalink.js` is the only thing that decides what a link means, and nothing else in the
explorer is allowed a second opinion. A URL is the only permanent thing this page emits.

### The keys, in emit order

```
v · f · m · x · y · w · a · p · gamma · cycles · phase · reverse · mirror · transfer · rolloff
```

- **`v`** — required, and `v=1` is the only value this page speaks. Anything else is
  refused: it was written for a version of this page that no longer exists, or for one
  that does not exist yet. **Adding a key that has a default never bumps `v`** — an old
  link is still a complete statement. **Changing what a key means does bump it**, because
  then an old link is a wrong statement.
- **`f`** — the family. `mandelbrot` is accepted. `julia`, `multibrot3`, `multibrot4`,
  `multibrot5` and `phoenix` are **reserved**: they parse, and they are refused with "not
  yet" rather than "no such thing".
- **`m`** — the mode. `smooth` is accepted; the engine's other seventeen production modes
  are reserved on the same terms.
- **`x`, `y`, `w`** — the frame's centre and its width in the plane, as **decimal
  strings**, exponent form allowed, capped at 64 characters, and **echoed back
  verbatim**. The decimal string is the identity of a location: `f64` is a lossy view of
  it that stops being enough the moment deep zoom arrives, and a round trip through a
  double would quietly rewrite a link that was more precise than today's renderer. `w`
  must be positive.
- **`a`** — the aspect, written `across:down`, defaulting to `16:9`, each side between 1
  and 10000. An aspect is a shape. **Pixel dimensions are not a field of the contract**:
  the canvas is drawn at whatever size the reader's window gives it, and a link does not
  carry a resolution.
- **`p`** — a palette **name**, which must be in the curated set. Names and never
  indices: a colormap added next year must not repaint a link saved this year. The
  default is derived from the article's own figure provenance — whichever map its
  mandelbrot `smooth` panels are colored through, today `twilight_shifted` — and that is
  computed by the builder, not typed anywhere.
- **The seven shade keys** are the engine's own `Palette` recipe, one key per real engine
  parameter, at the engine's defaults. They are **link-only**: draft 1 gives them no
  control on the page.

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
that needs one is refused without it. **`mirror=1` on a cyclic map is refused** with the
engine's own reason — folding it would halve the cycle it was drawn to have, and folding
is the seam fix for a map that has a seam.

There is **no free smooth-coloring parameter**. `mode::resolve("smooth", …)` is a fixed
field and a fixed curve, so the sweep key `s` was dropped rather than shipped, and the
engine has no exposure parameter anywhere, so `e` was dropped too. **Neither is
reserved** — reserving a key for a parameter that does not exist is a promise nobody can
keep.

### The rules the keys are read under

- **An unknown key is refused.** A typo that silently rendered the default view would
  look exactly like the link working.
- **A key given twice is refused**, because there is no rule for which wins.
- **`cx`, `cy` and `pp` are reserved keys**: the dynamical-plane constant a Julia set
  needs, and the Phoenix memory constant. Named so that adding them later is filling in a
  hole rather than widening the contract, and so a hopeful link is told which half of the
  problem it has.
- **Every refusal is visible.** The page says what is wrong and draws nothing — guessing
  what was meant would be worse than saying so.
- **Defaults are omitted on emit**, so the canonical string carries what somebody
  actually chose. **`p` is the one exception and is always emitted**: the palette is the
  only default whose meaning lives outside `permalink.js`, in the baked set, and a bare
  link that inherited it would change colour the day that set is rebuilt. Reading a link
  with no `p` is unchanged and still means the default, so this added no key and changed
  no meaning, and `v` stays 1.
- **The canonical string is the identity of a view**: parse then emit is a fixed point,
  and it is what the address bar carries after every settled view and what "copy link"
  copies.
- A colon is left unencoded — `a=21:9` beats `a=21%3A9` for the one thing a URL is for.
  The `+` of an exponent is **not** left alone and must not be: a raw `+` in a query
  string means a space.

`permalink.test.mjs` holds all of that: **22 tests**, Node's own runner, nothing
installed.

```
node --test explorer/permalink.test.mjs
```

## Rebuilding

```
python -m builder explorer                 # palettes, wasm, manifest
python -m builder explorer --palettes-only # when only the colormaps moved
```

Needs the sibling checkout, `cargo`, and the `wasm32-unknown-unknown` target
(`rustup target add wasm32-unknown-unknown`). `engine-wasm/target/` is gitignored — it is
the several hundred megabytes cargo needs to produce a 190 KB file.

Which colormaps count as curated is the wallpaper project's own distinction: a map that
arrived by mechanical conversion says so in its `source` line, and the rest were chosen.

## Next

Listed, not designed:

- **Tutorial deep links.** Article pages linking into the explorer at a named view, with
  a tracked registry of those links and a `builder check` that every registered link
  parses — so a contract change cannot quietly break a link the article itself carries.
- **The reserved families and modes**, one at a time, each unreserving its own keys.
- **Download at chosen dimensions**, which needs a render path that is not the canvas.
