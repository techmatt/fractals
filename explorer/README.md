# The Mandelnaut Explorer

One page that runs the wallpaper project's renderer in the browser: pan and zoom every
family in every shipped mode under any map in the library, and copy a link to the view.
Every article figure the page can redraw links into it. Pictures to open on the left, the
viewer on the right; one URL, and old links still open the same picture.

- **It targets the desktop** (Matt); a phone gets its own layout and working touch.
- **A feature joins only if it is a clear win**, a string stays only if an artist would act
  on it, and a button with a key shows the key (Matt). The page says "Render mode".
- **Scope**: eleven `f64` families (`mandelbrot`, `multibrot3`–`6`, `julia`–`julia6`,
  `phoenix`), the modes of `modes.jsonl`. Not here: fractional degrees and `de`. Deep zoom
  is a tab with its own module (`perturb.wasm`).
- **A download always re-iterates**; only the screen caches fields.
- **Nothing is shared between threads**: no `SharedArrayBuffer`, COOP/COEP, or service
  worker, so the page is plain files on Pages.
- **The port is byte-exact** against `fractal-engine render`.

## What is here

- Page: `index.html` (with its inline boot script), `explorer.css`, `explorer.js`.
- Panels: `gallery.js`, `browse.js`, `screensaver.js`, `walk.js` (+ `judges.js`,
  `resize.mjs`, `judges/`), `phoenix.js` (+ `phoenix-points.json`, `phoenix-points/`),
  `saved.js`, `saved-panel.js`, `zip.js`, `paged-inflection/` (paged out).
- Viewer: `render.js` (pool, plan, passes, shade), `worker.js`, `download.js`, `stamp.js`,
  `julia-preview.js`, `outermost.js`, `pointers.js`, `undo.js`, `demo.js`.
- Color: `picker.js`, `hues.js`, `shade.js`, `hold.js`, `fit.js`, `aliasing.js`,
  `period-range.js`, `params.js`, `stops.js`. Contracts: `permalink.js`, `deep-link.js`.
- Deep: `deep.js`, `deep-render.js`, `deep-worker.js`, `deep-fx.js`, `deep-gpu.js`,
  `deep-gpu-wgsl.js`, `deep-gpu-bla.js`, `deep-gpu-selftest/`, `deep-gallery.js`,
  `random-dives.js`, `dives.js`, `dive-results.js`, and their registers and tile folders.
- Custom modes: `custom.js`, `style.js`, `style-worker.js`.
- Records, edited on purpose: `palettes.jsonl`, `modes.jsonl`, `palette-names.json`,
  `popular.json`.
- Generated, never hand-edited: `palettes.js`, `palettes.bin`, `catalog.js`, `links.jsonl`,
  `engine.wasm`, `perturb.wasm`, `perturb-scalar.wasm`, `style.wasm`, `custom-modes.json`,
  and each module's `*.manifest.json`.
- Crates: `engine-wasm/`, `perturb-wasm/`, `style-wasm/`, and `deep-gpu-model/` (the GPU
  kernel's native model, with its own README). Harnesses: `bench/`.

## The studio

- Left tabs: Gallery (a staged collection from `python -m builder seats`, with mode and hue
  chips), Atlas (`atlas/frame.js`'s frame), Walk, Deep, Phoenix, Saved. Right: the viewer,
  the Render, Navigation, Render mode, and Download cells, Palette, and the folded Details.
  `screensaver.js` and `browse.js` are layers over the studio, each with its own pool.
- **Keys** are `explorer.js`'s `TOGGLE_KEYS` (bare lowercase letters), the arrows, `+`/`-`,
  and Ctrl+Z/Y; a new key means a new label on its button. ⚠ `j` over the picture opens
  the `c` under the pointer; `hoverAt` is canvas pixels, never a plane coordinate.
- **A button that would change nothing is greyed, never removed** (`pictureKey`).
- **A picture enters the viewer only as a link**: a control rewrites one key and re-parses
  (`retype`), so a typed value is refused as a link's would be.
- **UI keys** (`panel`, `collection`, the screensaver's) never refuse a link, never decide
  what is drawn, and are never emitted (`permalink.js` `UI_KEYS`).

## On a phone

Below `--studio-stack` the "stacked" section at the end of `explorer.css` is the whole
layout. `pointers.js` keeps the pinch bookkeeping. ⚠ Test with CDP device emulation, never
a narrow window, and use a fresh browser after a multi-touch sequence.

## Demo mode

`?demo=1` is stripped before either contract reads the address and imports `demo.js`;
`globalThis.__demo`'s hooks (`moveTo`, `scroll`, `pulse`, `where`, `now`, `step`,
`advance`, `deepReady`, `landing`, `open`, `caption`, `cursor`) drive a recording.
`node explorer/bench/showcase.mjs` (a server on 8000) captures the tour.

## The viewer's tools

- **Box (b)**: click a centre, move for the width, click to zoom. ⚠ The context menu is
  refused on the canvas only (`boxedMenu`: Windows fires `contextmenu` on mouse-up).
- **The zoom-out stop** (`outermost.js`) is the family's home from `engine.wasm`, widened
  by `LOOSE_STOP` on a dynamical plane. It limits gestures, never links.
- ⚠ **`#render-state` keeps `data-state`** with the fill as a child: `bench/page.mjs` and
  `bench/hunt/lib.mjs` observe it.

## The walk

`walk.js`: a simplified mining pipeline, watched; it never self-starts. A root found by a
quad-tree descent and the engine's `screen` export, judged quarters down to a peak, the best
frame mined into colorings, ranked by the render judge (`fp16w` ONNX in `onnxruntime-web`,
tracked in `judges/`, placed by `python -m builder walk`). Constants are frozen at the top
of `walk.js`. ⚠ `fetchBytes` must not size its buffer from a gzipped `content-length`.

## Deep

`z^d + c`, d = 2–6, `smooth`, on the Mandelbrot/Multibrot and Julia planes, through
`perturb.wasm`; its modules load on first use. The field is in `compute_band`'s layout, so
palette, shade keys, and Autolevel work unchanged.

- **The centre is exact** (`deep-fx.js`, BigInt decimal); only a step may be a double.
- **Auto-render**: a quarter pass, then a full pass at one sample a pixel, once the frame
  settles (`SETTLE_MS`). Only Render or a Download probes the cap. A color change recolors
  the picture up from its kept field, whatever is running (`deep.js` rule 5).
- **The reference orbit** is kept only where a fresh load would compute the same one
  (`sameOrbit`), so a picture never depends on the path to it.
- **Two cap ceilings**: automatic (`cap::AUTOMATIC_CEILING`) for what the page picks,
  explicit (`cap::EXPLICIT_CEILING` = `permalink.js` `CAP_LIMIT`) for what someone asks.
  ⚠ Memory bounds the explicit one: every worker holds its own orbit.
- **Find minibrots** searches the view, then widens (`nucleiNear`); results never persist.

### The Dive block

Rules in `dives.js` (held by `dives.test.mjs`), the page side in `deep.js`; landings go
to Dive results. The gallery and Random dives tile `deep-gallery.jsonl` and
`random-dives.jsonl`; `panel=deep:gallery` and `panel=deep:random` are permanent URLs.

### Deep links are their own contract, version 3

`deep-link.js`: `dv · f · cx · cy · x · y · w · n · a · p · shade keys · level`. `dv`
dispatches between the contracts and each refuses the other's links. `x`/`y` are exact and
normalized; `n` is written once settled; `f` only when the degree is not 2.

### The GPU draws the full pass where it has earned it

Off unless ticked (`?kernel=cpu|gpu` overrides). `deep-gpu-wgsl.js` ports `deep-gpu-model`
line for line; `deep-gpu.js` self-tests it, gates each frame (its header has the order),
and recovers a lost device. The skip table is GPU-only, by ruling. `perturb.wasm` is SIMD
and falls back to `perturb-scalar.wasm`, bit for bit equal.

## Phoenix

`phoenix.js` draws the Phoenix plane (`phoenix_plane`, engine `phoenix_m`) live on its own
pool; a click opens that `c` at the current `p`. Its style and starting points are
`python -m builder phoenix-points`'s.

## Inflection — paged

`paged-inflection/README.md` has what it was and how to restore it. Kept because URLs
outlive trials: `permalink.js`'s `INFLECT_MARKER` (`iv`) and `explorer.js`'s
`INFLECTION_PAGED`.

## Saved

`saved.js` stores canonical links in `localStorage` `fractal-website.explorer.saved` (the
site name in the key: github.io project pages share one origin). Unreadable storage is an
empty list; at `MAX` a save is refused, nothing evicted.

## The way back

`undo.js`, session-only: an entry is a canonical link, restored through the door a link
opens by. Not `history.pushState`. The address-bar write is rate-limited (`ADDRESS_MS`):
WebKit throws past 100 `replaceState` calls in 30 s.

## Every colormap, and where they live

`palettes.jsonl` is the record; every field is frozen, never derived at bake time, and the
picker offers every map. `palettes.bin` is sRGB8 stops, planar byte-delta, evenly spaced;
`stops.js` checks its length and SHA-256 against the index. `random` is imported with
`python -m builder explorer --random`. Display names are `palette-names.json` (`--names`
never rewrites an `authored` one); `popular.json`'s `pinned` and `dropped` are Matt's.

## It does not open from `file://`

Modules, workers, and wasm are blocked there: `python -m builder serve`, then
`http://localhost:8000/explorer/index.html`. ⚠ Chrome `--screenshot` sees only the boot
notice; drive the page over CDP (`bench/cdp.mjs`).

## The engine, compiled

`engine-wasm/` is a `cdylib` taking the engine by path: `extern "C"`, no wasm-bindgen,
`panic="abort"`, `lto`. `build.rs` must stay a file (its presence enters cargo's metadata
hash); `generic_loop` is a bare `--cfg`, never a feature. ⚠ The module is reproducible only
at the same absolute checkout path. CI checks the sibling out at `engine.manifest.json`'s
`wallpapers_commit`, so a history rewrite next door owes a re-stamp. What the engine needed
is the manifest's `engine_changes`. `perturb-wasm/` is never linked into `engine.wasm`.

## One spec, and the exports

Every export takes one spec; `plan` is asked first, and JS keeps no table of lanes or
defaults. `engine-wasm/src/lib.rs`'s header lists the exports. `compute_band` calls the
engine's `sweep_row`, and no recurrence may be written here. The pool decides cuts, never
content (`bands.test.mjs`). ⚠ `Renderer.field` cancels whatever is in flight.

## The download

The same render at another size; limits are `download.js`'s `MAX_SAMPLES`, `MAX_SIDE`, and
`MAX_PIXELS`. Files are named by the underlying palette name.

### Every downloaded picture carries its own link

`stamp.js` writes `fractal-explorer <query>` into a PNG `iTXt` or JPEG `COM`, pixels
untouched; a picture dropped on the canvas opens its link.

### And the same link, absolute, where ordinary tools look

`EXPLORER_URL` also goes into XMP `dc:source` and a JPG's EXIF `ImageDescription`, as the
sibling's `curation/explorer_link.py` writes; `check`'s `stamps` holds both.

## Measured

`bench/`'s harnesses run in neither `check` nor CI and write to ignored `artifacts/`.
⚠ This machine drifts by up to 30%: alternate before/after runs; re-measure, never quote.

## The permalink contract, version 4

`permalink.js` alone decides what a link means; its header has the keys, emit order,
version history, and refusals. v1–v4 parse and v4 is emitted; a key with a default is a
widening, a changed meaning bumps `v`. Every refusal is visible and draws nothing.

- **`level=band_autolevel/v1:…`** is not a shade key and must never become one.
- **The controls for the recipe** take the link's spelling; `shade.js`'s `under` decides
  which show under Leveled and Absolute. Hold look is UI state only.
- **The Period slider** (`period-range.js`): only the slider is clamped, never the box.

### Straighten iter

`knee` is the engine's (`Palette::absolute_value`); `shade.STRAIGHTEN` is set wherever the
explorer itself puts a view on Absolute, never given to a link.

## The link registry

`links.jsonl`: every figure and tile as a link or a reason, by `python -m builder links
--write` (`builder/links.py`, refusals in `REASONS`).

## Every pool is given back

`pagehide` (never `unload`, which disqualifies bfcache) stops every pool via `giveBack`.

## What the last bug hunt covered

`bench/hunt/` (u1–u11, probes, `lib.mjs` with its known false alarms); run units serially.
The custom modes' unit is `u11-custom.mjs`; findings live in `docs/qa-findings.md`.

## The operator is the engine's

The crate imports `fractal_engine::autolevel`, `derive`, and `mode::tune`; the level
fixtures live only in `engine-wasm/`. ⚠ It is baked with `builder/explorer.py`'s
`TOOLCHAIN`: newer stable is far slower on the heavy modes and moves `tia` lanes.

## Custom modes

The mode select's two custom entries, Custom and Custom (lab), one a tier, draw the
sibling's modes with `style.wasm`, byte for byte; `custom-modes.json` is the record, 37
modes with 77 Example buttons, fetched after the first frame unless a link names one.
`docs/custom-modes.md` is the whole path. Keys: `permalink.js` `CUSTOM_KEY`.

## The test suites

The list is `CLAUDE.md`'s and `checks.yml`'s. `level.test.mjs` and `stops.test.mjs` skip a
case by name without `artifacts/level-derive/` or a baked `palettes.bin`.

## Rebuilding

```
python -m builder explorer                   # palettes, blob, swatch, catalog, wasm
python -m builder explorer --palettes-only   # when only the colormaps moved
python -m builder explorer --roster <stamp>  # re-read map families and seat counts
python -m builder explorer --perturb         # perturb.wasm, perturb-scalar.wasm
python -m builder explorer --style           # style.wasm, custom-modes.json
python -m builder links --write              # the link registry
```

Needs the sibling checkout, `cargo`, and `rustup toolchain install 1.96.0 --target
wasm32-unknown-unknown`; the bake sets `RUSTUP_TOOLCHAIN` from `TOOLCHAIN`.

- **The pin follows the bytes**: `wallpapers_commit` moves only if `engine.wasm` or the
  `perturbation/` tree moved. ⚠ A prompt that does not own the engine reverts
  `engine.wasm` and `engine.manifest.json` and uses `--palettes-only`.
- ⚠ **Rebake from a real path, never a junction**: cargo embeds the unresolved path.
- **The mode list has three copies** (`modes.jsonl`, `catalog.js`, `permalink.js`
  `MODES`), tied by `check`'s `bake` and `permalink.test.mjs`.
- ⚠ **Any source edit in `perturb-wasm` or the sibling's `perturbation/src/` owes
  `--perturb`** (`#[track_caller]` line numbers are embedded). An `engine-wasm` edit:
  rebuild and compare.
