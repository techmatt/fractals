# The visitor explorer

One page that runs the wallpaper project's own renderer in the browser: pan and zoom
every family the wallpapers are drawn from, in every mode the pipeline ships, under any
of the library's 1,021 palettes, and copy a link to whatever is on screen. Every figure
of the article that this page can draw again carries a link straight into it.

**It is a studio, since `explorer_studio` (2026-09-15).** The page is the window: a left
panel of pictures somebody can open — a thousand seated wallpapers, or the atlas of every
place the search kept — and on the right the viewer that draws whichever one is picked.
Same URL, same keys, and every link written before it still opens the same picture.

**Eleven families, seventeen modes, `f64`.** The parameter planes `mandelbrot` and
`multibrot3`–`multibrot6`, the dynamical planes `julia`–`julia6` and `phoenix`, the
modes `modes.jsonl` offers with the parameters the engine's catalog settles for each,
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
catalog ever retunes that mode. The two exceptions since permalink v3 are an angle mode's
`weight` and a trap's `opacity`: absent, those are taken from the view. See *A mode's
parameters, from the view*. `permalink.js` states both sides of that, and
`builder/links.py`'s `REASONS` is where a refusal gets its name.

Draft 1 was built to a design document that has since been retired; this README and the
tree are now the only record of what the explorer does. Where the build departed from
what was originally planned the departure was deliberate, and those decisions are
recorded here so the reasoning behind them is not lost:

- **The picker's set and the link's set were not the same set, and now they are.** One
  set was to serve both — the curated maps, and nothing else — and for two drafts the
  picker offered **77** of them while a link could name any map one of this site's own
  pictures had been drawn in. What made the curation necessary was the control: a single
  `<select>` of a thousand names is a list rather than a menu. The studio's picker is a
  tab strip — the maps this pool seats most, a tab per hue family, all of them behind a
  filter box — so the page now offers every map it carries and reads no `offered` flag.
  The flag stays on the record as what that menu listed; `explorer/palettes.jsonl` is
  where the whole set is counted, and it has no fixed size, because it grows every time a
  figure lands in a map the roster did not carry.
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
- **The scope is the whole offered roster.** Draft 1 was scoped to one family in one
  mode — mandelbrot in `smooth` — and that is long since passed: nine families, seventeen
  modes, every mode parameter the engine's catalog writes down. What the widening cost is
  *no loop of its own* below: the collapse draft 1 got for free by rendering one family
  in one mode had to be bought back, first by hand and now from the engine's own table.

## What is here

```
index.html            the page
explorer.css          its own stylesheet, on top of the site's
explorer.js           what a reader touches: drag, wheel, keys, pickers, copy link
gallery.js            the left panel's grid: a staged gallery's record, filtered
picker.js             the palette tab strip, and a gradient drawn per row
shade.js              the recipe's controls, apart from the boxes they are drawn in
download.js           the same render at a wallpaper's size, and what caps it
render.js             the worker pool, the plan, the field passes, the shade
worker.js             one worker: one wasm instance, one band of rows (or one screen)
walk.js               the Walk tab: a simplified mining pipeline, run here and watched
judges.js             the two judges in onnxruntime-web, loaded on the first Start
resize.mjs            PIL's bicubic resize, ported byte for byte: what a judge reads
judges/               UNTRACKED: the two ONNX judges and the runtime, `builder walk`
permalink.js          the link contract — parse, validate, canonicalize
params.js             a mode parameter's control: its word, its slider's travel, the mapping
permalink.test.mjs    51 tests, `node --test explorer/permalink.test.mjs`
bands.test.mjs        3 tests: the pool cuts the frame, never what is in it
level.test.mjs        7 tests: the module's tone measurement, and a derived curve replays
derive.test.mjs       6 tests: a derived weight replays, a derived opacity lands where it says
palettes.jsonl        the roster palettes.js is baked from; 1,021 maps, 77 offered,
                      232 a random pick may draw
modes.jsonl           the roster catalog.js is baked from: the 17 modes the picker offers
palette-names.json    every map's display name and whether a person wrote it, by underlying name
popular.json          the picker's Popular 24, and why each map passed over was passed over
stops.js              the blob's reader: a map's control points, by name
palettes.js           generated: the index — name to kind, offer, random, offset, count
palettes.bin          generated and UNTRACKED: every map's control points, sRGB8
palettes-swatch.png   generated and UNTRACKED: a row of gradient per map, to look at
catalog.js            generated: the offered modes, their curves, the anchors' constants
links.jsonl           generated: every figure and tile, as a link here or a reason not
engine.wasm           generated: the engine, compiled
engine.manifest.json  generated: what engine.wasm was built from
engine-wasm/          the crate that produces engine.wasm
```

## The studio

Two panels, and the document itself does not scroll.

**Left, one of three things.** The third, *Walk*, is its own section below. *Gallery* is the staged gallery `python -m builder seats`
lands, one **collection** at a time — the general gallery, a collection per hue family,
a collection per mode, chosen from a dropdown *(explorer_gallery_collections_ckpt129)* — as
pictures and nothing else: no caption, no id, no score, two rows of filter chips over them,
mode and hue family, each with its count in the collection chosen. The record is the union
of the collections, so choosing one fetches nothing, and a tile asks for its 316 px WebP
only when it comes within half a panel of view. A dropdown and not a chip row, because the
chips filter and this chooses what is being filtered.

**The dropdown is the panel's header and its own label** *(explorer_side_panel_ckpt129)*.
It sits in the tab row, right-aligned beside Gallery and Atlas, and it is hidden while the
atlas is showing. It had a section of its own with a `COLLECTION` header over it and a
footer under the tiles reading *1000 wallpapers in the general gallery*, which was the
option's own text — *General gallery · 1000* — said three times over two rows of a panel
that is meant to be pictures. The footer now says `k of N` and only while a chip is
narrowing the grid, which is the one thing the dropdown cannot say; unfiltered, there is no
footer at all. The Mode select's roster and the
trap-mode defaults stay the general gallery's. Mode chips add up; a hue family chip is one at a time, and pressing
it again clears it. Choosing a collection clears both rows: a filter is a question asked of
the collection, and the hue row is not even asking the same question either side of a color
collection, so a chip carried across the switch narrows a shelf by a choice made somewhere
else. A tile sets the viewer to that seat's whole recipe. *Atlas* is the
same frame `atlas/index.html` shows, mounted in the panel through `atlas/frame.js`, with
the marks clicking into the viewer rather than navigating.

**Right, the viewer**, and under it three sections — Download, Mode, Palette — then
the folded Details: the render stat line, family, constants, `x`, `y`, `w`, all editable. Copy link is in the bar,
because it is about the page rather than about a group.

**Five view buttons close the Download row** *(explorer_view_buttons_ckpt130, 2026-09-17)*,
at its right end, each with a key its tooltip names, and **the labels carry the state** so
that the row says where the reader is standing — which is why this page has no status strip
and no breadcrumb:

- **Reset to seat** (S) — the picture the viewer was opened at, put back exactly as opening
  it did: frame, mode, palette and recipe, the tile marked again, and the sentence about
  what its link could not carry back under the canvas. It says **Reset to link** where what
  was opened was an atlas mark or a pasted address rather than a gallery tile — the split
  the tuned-parameter note already makes — and a bare page opened at nothing, so its button
  is greyed and its tooltip says so. The anchor is the last thing that *arrived* and not the
  last thing on screen, so it survives every move, Julia here included.
- **Whole ⟨plane⟩** (R) — `Whole Mandelbrot`, `Whole Multibrot 6`, `Whole Julia` — the
  plane's home viewport with everything else kept. The name is `planeName`'s, a rule over
  the one shape a family name has rather than a table: the spelling is the atlas record's
  `slot_labels`, derived rather than read from it because the atlas mounts only when its
  panel is first opened and a button is named at load.
- **Julia here** (J) — the view's centre taken as `c`, its own decimal strings so nothing is
  lost, and that degree's Julia set opened at its home view with the mode, palette and
  recipe carried. While the button is under the pointer or holding the focus, a crosshair is
  drawn at the view's centre, so *here* is a point on the picture rather than a word on a
  button.
- **Random palette** (P) — one of the **232** maps that seated more than one wallpaper in
  the published record, never the one on screen. The list is the wallpaper project's own
  and rides in the baked index as a flag per map; every other map is still a hand pick.
- **Random phase** (Shift+P) — to three decimals.

Inside a Julia set the third button is **Back to ⟨parent plane⟩** — `Back to Mandelbrot` —
on every Julia set and not only one this tab opened: where this tab did, the parent view is
held in `sessionStorage` and Back returns to it, and anywhere else — a copied link, a seat —
it lands on the parent plane at `c` at its home width. Either way `c` is **marked on
landing** for a moment and then fades. The link carries only the Julia view. On Phoenix,
which has no parameter plane here, the button is absent rather than present and saying so.

**A button that would change nothing is greyed, never taken away**, because a row that
loses a button moves the rest of them under the pointer: Reset at the picture that was
opened, Whole at the home frame. What either compares is `pictureKey` — the canonical query
with `level` and the derived parameters dropped, since both are measurements of the picture
that land partway through the pass that draws it, and a button must not come back to life
when a pass finishes measuring. The keys work with focus on a button, and never with Ctrl,
Alt or Meta. That is the whole row: anything more is a shortcut, not chrome.

**The mark is painted onto the screen and never into `frame`** — the crosshair and the
landing mark are one glyph, four arms stroked dark-under-light so that neither disappears
into a picture — so a drag's preview slides the picture without the mark going with it, and
every stage of a pass puts the mark back over what it just drew. It carries the family it
belongs to and is not painted on another, because a plane coordinate means nothing off its
own plane.

**A mode's parameters are sliders** *(explorer_controls_ckpt129)*, the same slider and box as
Gamma, Cycles and Phase; `params.js` holds each one's travel and says why. The slider bounds
the control and never the value: a seat or link carrying a density of 14 opens at 14, the
box says 14 and the slider parks at 10. Only Texture follows the hand, because a weight is a
recolour; every other parameter re-iterates, so its slider draws on release.

**The atlas chips follow the view.** A chip clicked opens its plane's home view with the mode
and palette kept, and a view arriving on another plane by any route moves the chip — a Julia
set to the parameter plane of its degree — so the two never drift.

**Shade is part of Palette** *(explorer_palette_layout, 2026-09-16)*. The group's header
names the map — `PALETTE: GILDED LAGOON`, display name only; the underlying name is in
Details and Copy view — and under it come the strip, then the shade row (gamma, cycles,
phase, transfer, Reverse, Mirror, Autolevel), then the family tabs and the swatch grid.
The controls a reader turns sit nearer the picture than the list they scroll through;
the grid keeps its bounded height and scrolls inside it. Under a direct trap, the "this
mode paints as it draws" sentence takes Autolevel's note on the shade row rather than a
line of its own.

**Mode offers the gallery's modes** *(explorer_palettes, 2026-09-16)*: the set the gallery
panel's mode chips show, read off the same record — thirteen of the seventeen today — in
the contract's order. Nothing about what a link may say moved. A link naming one of the
other four still parses and draws, and its mode is an extra entry in the select while that
view is up; the four stay in `modes.jsonl`, in `catalog.js` and in `permalink.js`. Where the
gallery record cannot be read the select lists all seventeen, because a page offering no
mode at all is worse than one offering too many.

**A palette is shown by its display name** *(explorer_palettes, 2026-09-16)*.
`palette-names.json` is `{underlying: {name, source}}` for every map carried, `source`
being `authored` (the map's own name, or one set by hand) or `generated`: the library's
names that already read as names are their own, a single word included where the library
says a person wrote it (`Inkfall`, not `Blues`), and the codes — `wallhaven_*`, `cmr.*`,
`cet_*`, `commons_*`, matplotlib's `RdPu`, a trailing `-25` — get two words, a colour and a
material, from the map's dominant and secondary codebook cells. The display name is what
the picker's rows, its tabs and its filter use, what the Palette note and Details say, and
what the tooltip says beside the underlying name. The underlying name is what a link, Copy
link, the download filename and every record carry, so no permalink moved. A map with no
entry shows its own name, and `builder check` prints how many have none.
`python -m builder explorer --names` fills missing entries and never rewrites an authored
one, which is what lets a name be authored by hand; a generated entry whose map's own name
has come to read as one gets it back. **Popular** is `popular.json`: 24 maps. Its
`pinned` maps are Matt's picks and open the list in his order, and `dropped` holds the ones he
ruled out. The rest are filled by `python -m builder explorer --popular` for range
across hue families (every family gets one place before any gets a second), by the rule
`builder/picker.py` states.

**A section is a header, and a header is one class.** `.section-head` is the label in
the accent and a hairline running from it to the section's right edge; the rule is the
divider, so the sections carry no border of their own. The gallery panel's Mode and Color
family use the same class. A section's one action sits on its rule: **Reset palette**
on Palette's, which resets the shade keys (never the map itself) and is
disabled with nothing to reset and carries the count of keys set in its label — the
separate "N of 7 set" line is gone, and the button's title names the keys, including any
that have no control.

**A picture gets into the viewer exactly one way, by being a link.** A gallery tile
parses the permalink its record carries, an atlas mark parses the one its slot derived,
and a control writes one key of the current view and re-parses the whole string — that is
what `retype` is for, and it is why a typed coordinate is refused with the same sentence
a link's would be. There is no second path, which is what keeps the address bar honest.

**What a link cannot carry is said under the canvas.** Every wallpaper the pool makes
goes through `band_autolevel/v1`, and the curve lives on the run's record rather than in
the recipe: 291 of the thousand seats of `20260914T171846Z` carry one into their link, and
the other 709 are pictures the operator left alone, so none opens with a curve missing. A
seat whose run had written nothing down would open at the recipe with a sentence saying
so. A view
that **arrived** replays exactly what its link carries, curve or no curve; the first view
a reader **makes** — a pan, a zoom, any control — is measured on its own finished picture
by the same operator, ported whole. See *`level`, and a gallery seat's own colour* below.

**`panel` is a UI key.** Which side is open travels in the URL and is not part of the
picture: `permalink.js` tolerates the key, reads nothing from it and never emits it, so
the canonical string of a view — what Copy link copies — is the picture alone. Two rules
keep that from becoming a contract by the back door: a UI key never refuses a link, and a
UI key never decides what is drawn.

## The walk *(walk_tab_ckpt131, 2026-09-18)*

The third tab runs a simplified version of the mining pipeline, and the viewer shows it
choosing. **It never starts on its own**: `panel=walk` in an address opens the tab, and only
Start starts a walk. Hiding the tab pauses it, and so does anything the reader does to the
viewer: a pan, a zoom, a control, or a picture opened from any panel.

**One walk.**

1. It picks one of the ticked planes at random: the sampler's `SERVED` set, meaning
   Mandelbrot, Multibrot 3–6 and the pinned Phoenix slice.
2. It draws a target width log-uniformly in the band, 0.1 to 1e-3 by default (the sampler's
   `WIDEST`/`NARROWEST`).
3. It descends the sampler's quad-tree over the plane's home box × 0.9, one rung at a time.
   Each cell gets a 64×36 smooth probe at maxiter 256, and a quarter *straddles* where its
   interior share is strictly between 0 and 1.
4. Each straddling quarter is drawn at its own width, its centre jittered up to a quarter
   cell. From the band's first rung down, each goes through the engine's screen.
5. Each survivor's smooth picture (640×360, one sample, `twilight_shifted`) is scored by the
   render judge. The walk goes into the best one's cell.
6. A rung with no survivors backs up one rung and tries the next-best cell. A plane that
   gives out before the band restarts somewhere else.
7. At the target rung the place is judged once more against the bar. When the Julia box is
   ticked, the place's centre is also taken as `c` for its Julia twin, which is judged at
   the twin's home frame. Phoenix has no twin.
8. A place over the bar is mined:
   - Recipes are drawn over the ticked modes without replacement, a palette from the roster,
     the identity shade with `mirror` read off the map's cyclicity, and a uniform phase
     (0 under a direct trap).
   - Each is drawn at 640×360×2, the pipeline's candidate geometry. A texture weight or trap
     opacity is derived exactly as the viewer derives one.
   - Each is scored by the gate's P≥4 and by the fine head. The best are kept as tiles.

The config's defaults are the pipeline's draw where the page can make one. There are three
recipes a place (hunt and mine's `PER_LOCATION`), and the twelve modes that are mined start
ticked, with `curvature` listed and unticked (`mode_policy.UNMINED`).

**Where it is not the pipeline, said once.**

- The descent is greedy on the render judge's P≥3. The sampler is exhaustive, and the
  pipeline's walk scores with the location head, which is not shipped to a browser.
- The judges read the canvas, where the pipeline reads a JPEG-decoded picture.
- The palette is drawn from a roster, where the pipeline uses a palette head or a codebook
  stratifier.
- The bar is P≥3 at 0.50 on the smooth picture. The pipeline's release gate is P≥4 at 0.50
  on a colored one, and P≥3 at 0.50 is only its fallback for a thin mode. The config's
  tooltip says so.
- The pipeline keeps every recipe it draws and lets the solve choose. The tab keeps the
  best.

**Two renderers.** The walk draws through a second `Renderer` over the same compiled module
(`Renderer.over`), with a pool of `min(3, cores/4)` workers. The viewer's renderer runs one
job at a time and cancels the last, so sharing it would mean the walk cancelling the
reader's picture, and every pan cancelling the walk. The screen runs on two workers of its
own, because the battery iterates on whichever thread calls it.

**The screen is the engine's.** `engine-wasm`'s `screen` export is
`screen::Battery::screen` at its defaults, run on the 384×216 node frame at the policy cap
and coloured through `twilight_shifted` for the occupancy floor. It is the pipeline's
battery, all five gates, with no JavaScript re-statement of any of them. The probe's
maxiter of 256 is the spec's optional `maxiter`. That is a probe-only knob: the link
contract has no key for it and nothing a link opens sets it.

**The judges.**

- Both are the judges lab's `fp16w` exports: fp16 weights and fp32 compute. The render
  judge (gate) reads `[P≥2, P≥3, P≥4]`. The fine head is the fused three-seed graph, and
  its P≥4 is `p_fine`.
- They run in `onnxruntime-web` 1.30's default bundle. Its WebGPU backend is JSEP, the
  runtime the lab's fidelity table was taken on. It uses WebGPU where `navigator.gpu` hands
  back an adapter, and single-threaded WASM otherwise.
- Every picture goes through `resize.mjs` to 384×224 and in as [0, 1]. Normalization is
  inside the graph.
- The runtime and the gate download on the first Start. The fine head downloads the first
  time a place clears the bar.
- Where the runtime cannot load, the walk runs on the screen alone, picks among survivors
  at random, and says so in its console.

**The assets are untracked.** `explorer/judges/` is named in `.git/info/exclude` and filled
by

```
python -m builder walk                      # from ../fractal-judges-lab
python -m builder walk --from <lab checkout>
```

That copies about 49 MB:

- `render.fp16w.onnx` (5.1 MB) and `fine.fused.fp16w.onnx` (15.3 MB), from the lab's
  `models/`.
- `ort.min.mjs` and the JSEP glue and binary (28.3 MB), from its `node_modules`.

Until Matt says deploy, Pages serves a Walk tab that runs on the screen alone.

**Nothing persists.** A found tile is a blob URL and a permalink that writes the weight or
opacity in force. Clicking one opens it through `openLink` and pauses the walk. A reload
forgets them all.

## Every colormap, and where they live

The page carries **1,021** maps, which is the whole tracked library, and it used to carry
126. The reason is a gallery seat: a link built from a seat's recipe has to be able to
name the map that seat was drawn in, and the published record alone seats **451 distinct
maps**. The 126 were the curated set plus whatever this site's own figures happened to
land in, which is a set that answers "can this figure be opened" and not "can any seat
be".

**What is offered did not move.** The picker still lists the same **77**, frozen where
they were on 2026-08-23. `offered` is a field of `palettes.jsonl` and widening the picker
is still an edit somebody makes on purpose.

**The gradients are beside the module rather than in it.** `palettes.js` is an index —
for each map, whether it closes, whether the picker lists it, where its colours start in
`palettes.bin` and how many stops it has, plus two readings described below.
`palettes.bin` is those colours: sRGB8, three bytes a stop, 345,650 stops, **1,036,950
bytes**, in the index's own order. Inline as JavaScript source that is about twelve
megabytes a browser parses before it draws anything; as a blob it is one `fetch` that
goes out beside the wasm's, on a boot the page already waits through. `stops.js` is the
reader, and it checks the blob's length against the index's own stamp before trusting a
byte of it — an index and a blob that disagree do not fail, they draw map `n`'s bytes at
map `n+1`'s offset, which is a real gradient belonging to somebody else.

**No positions are stored, and the bake refuses a map that would need them.** Stop `i` of
every map in this library sits at exactly `i/(n-1)` — checked as an `f64` on all 1,021 —
so the index's stop count is the whole of the addressing. `builder/explorer.py`'s `blob`
compares each position with `i/(n-1)` and **stops the bake by name** where one differs,
rather than rounding a gradient into the format: the engine does not require even
spacing, this library merely has it, and the day it does not is a decision somebody makes
rather than a bend nobody sees.

**Two readings ride in the index that the library does not hold.** `family` is the hue
family a map most often *produces* — the modal leading entry of `colour.families` over
the candidate-ledger rows drawn in it whose fine-head `p_ge4` clears
`solve.DEFAULT_FINE_BAR`, absent where it has no such row, **929 of 1,021 have one** —
and `seats` is how many seats of the published record were drawn in it. Neither is a fact
about the gradient and both are frozen in `palettes.jsonl` rather than derived at bake
time, because the ledger is written to while a bake runs and a picker's metadata that
moved on its own is the failure that record exists for. `python -m builder explorer
--roster <release>` is what reads them.

**And a third field says which maps Random palette may land on** *(Matt, 2026-09-17)*.
`random` is the list the wallpaper project states in
`data/palettes/palettes_for_random_choice.csv` — **232 maps**, every colormap that seated
more than one wallpaper in the published n=1,000 record, holding 781 of those seats
between them. The library is about a thousand maps and most of them arrived by mechanical
conversion, so a uniform draw over all of them mostly landed on a map nothing was ever
made in. The draw is uniform over the 232, never the map already on screen, and **nothing
else narrows**: every map the roster carries is still selectable by hand and still
resolves in a link.

It is **imported and frozen, not derived.** `python -m builder explorer --random` reads
the CSV out of the checkout and rewrites the flags — nothing else in the record moves —
and `builder check`'s `bake` holds the flags to that file, so a list re-derived next door
at a later publication arrives here as a failing check rather than as a button quietly
drawing from last month's answer. It happens to equal `seats >= 2` on this record today,
and that is a coincidence worth not building on: the CSV's own README says it is a reading
of one record rather than a standing rule, and the threshold it was filtered at is that
project's to move. A baked index that marks no map at all — an older module, or a bake on
a checkout with no such list — draws from everything, which is what the button did before
the list existed.

**The blob and the swatch are untracked.** They are the one library-sized thing here and
what is committed is the index that addresses them; both are in `.git/info/exclude` and
`python -m builder explorer --palettes-only` writes them. `builder check`'s `bake` holds
the blob on disk to a rebake of it byte for byte, and says so by name when it is missing.
The swatch is a row of gradient per map in index order, 1,024 wide, each column one of
the map's own stops taken whole — a picture of the file for a person, not the shading
table, which the engine bakes at 4,096 by interpolating in Oklab.

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
| `raw_bytes` / `gzip_bytes` | 634,824 raw, **184,458 gzipped** |

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

**A pass draws three times.** A quarter-resolution field first, then the full one at one
sample per pixel, then the same grid at **two samples per pixel each way**, which is the
picture the pass ends on and the one the stat line under the canvas describes. The preview
is a *separate* field of the same rectangle rather than a subsample of the full one, so it
carries its own percentile stretch and can be a shade off the picture that replaces it.
The canvas's pixel grid is rounded to a multiple of four on both axes so the preview is
exactly the same rectangle at exactly a quarter of the samples.

**The last stage is the engine's supersample**, the `supersample` key a download already
sends: iterated on a grid twice as fine and reduced by `resample::downsample` inside wasm,
so the screen now shows what a download at 4× of the same size would save — and the
download menu's first size, *As shown*, at 4× saves that picture without drawing it
again. One sample per pixel aliased visibly on every fractal edge. The stage's shade goes
to the page's kept shade worker (`ShadeWorker`, with a copy of the field so the cached one
stays whole), because four times the samples is up to half a second on the slower shades and a
recolour should not freeze the page; a recolour puts the one-sample picture up from the
cache first, on this thread. Where `f64` resolves the screen's grid and not one twice as
fine, the module's refusal is said beside the one-sample picture, which stays up.

**Cancel is by generation, not by termination.** A pan bumps the generation, no further
bands are dispatched, and the band still in flight is finished and thrown away — killing
a worker mid-band would cost a wasm instantiation to save at most one band. The abandoned
pass resolves with `null` rather than being left pending: a promise nobody settles holds
its whole `await` chain alive, and a reader who drags across the set makes one per drag.

**`Renderer.field` cancels whatever is in flight, so a caller queues rather than
races.** Every call bumps the generation, which is what makes a pan responsive and what
makes two overlapping calls wrong: the first resolves `null` and the second returns, so
code that asks for two fields at once silently gets one. Anything wanting several — a
contact sheet, a batch of thumbnails — awaits each in turn, or goes to `compute_band` and
`shade` directly. Nothing in this repository does the second any more: the atlas's offline
renderer was the one caller, and the atlas draws its pictures next door now.

**The field cache** is keyed on the canonical permalink *minus* the palette and the shade
recipe, plus the pixel grid it was sampled on — geometry alone, because nothing on the
colour side can change the field. The four direct traps are the exception and are keyed on
everything, because for them it can. Six fields are kept: the three stages of the current
view and the three of one view back; the supersampled stage keys as the one-sample key
with `&ss=2` after it. So a palette change re-shades what is already here and iterates
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
shows more or less height rather than cropping. The estimate's tooltip says so.

**One row, first, and always open.** Download is the studio's first section: two buttons,
leftmost — *Download PNG* and *Download JPG* — then a size (*As shown*, three wallpaper
presets, or a custom width and height), a 1× / 4× / 16× samples toggle that opens at 4×,
and an estimate of a few words. 16× is there to hold a download against the same picture
at 4×, and the sample ceiling below is what bounds it: 2560x1440 fits, 3840x2160 is
refused by name. The size, samples and estimate are the same for both; the pressed button is the
progress bar and the way to cancel, and the other is held still until it finishes. On a
phone the row wraps. The file is named for what is in it —
`multibrot3_smooth_mean_angle_dimensionality-25_3840x2160.png` — family, mode, palette and
size, and the palette is its **underlying** name, the one a link carries, never the
display name the picker shows. The format changes the extension and nothing else.

**The JPG is the browser's, and the browser subsamples it.** Both formats go through
`canvas.toBlob`, the JPG at quality 0.95. Measured by reading the frame header of what
it writes (2026-09-16, Chrome 152 and Edge 153): **4:2:0 at every quality below 1**, and
4:4:4 only at exactly 1, which is also a different, far larger quantization. The wallpaper
pipeline's own encoder is `jpeg-encoder`, which switches to 4:4:4 at quality 90 and up, so
a downloaded JPG is not the file the pipeline would have written — saturated edges are
where the difference shows, which is why the site's render sheets are 4:4:4. The way to a
4:4:4 JPG here is an `encode_jpeg` export on this crate calling `jpeg-encoder` directly: a
direct dependency on a crate already in the build's lock, no engine change, a module
larger by the encoder, and a rebuild and manifest update like any other export. The render stat line lives in Details, so the estimate is the only number above
Mode.

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

**The estimate is a few words, scaled from this view.** *ready* where As shown at 4× is
the picture already on the screen; otherwise `~5 s`, `~40 s`, `~3 min`, which is what the
screen's own finished pass of this view took — field and shade — scaled by the ratio of
sample counts. Only before that pass has finished is the per-mode table below the prior.
The button is the progress bar: it fills by band, its label is the percentage, and a
press while it draws cancels, by generation exactly as a pan does.

While a download is drawing, **the view is held still** — a wheel notch would cancel the
pass it is waiting on, and losing a two-minute render to a stray scroll is not a trade
anybody would make. The button is the way out.

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
moved thirteen of the eighteen modes it was measured over by 1.41x to 4.18x, so a pre-specialization reading —
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
them. **Seventeen rows for the eighteen modes measured**: one row came off when the
site retired that mode from the picker (2026-09-04). The module is unchanged and so
is every figure here — what left is a line about a mode this page no longer offers.

| mode | before | after | x | x smooth | shade |
| --- | --- | --- | --- | --- | --- |
| `smooth` | 1.54 s | 1.55 s | 0.99 | 1.00 | 44 ms |
| `smooth_trap_circle` | 7.15 s | 1.71 s | **4.18** | 1.10 | 180 ms |
| `trap_circle` | 7.09 s | 1.71 s | **4.14** | 1.10 | 188 ms |
| `itinerary` | 7.09 s | 1.86 s | **3.82** | 1.19 | 397 ms |
| `direct_trap_lines` | 4.20 s | 3.98 s | 1.06 | 2.56 | — |
| `direct_trap_screen` | 4.41 s | 4.51 s | 0.98 | 2.90 | — |
| `direct_trap_multiply` | 5.44 s | 5.65 s | 0.96 | 3.64 | — |
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

**Twelve of the modes listed got faster and the range is 1.41x to 4.18x**, which is not one number and
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

**The module** is 634,824 bytes raw and 184,458 gzipped, against draft 1's 190,240 and
70,639. The tone operator is 18,955 of that raw and 6,043 gzipped — two bisections and a
subdivision, and it buys a gallery seat's own colour. Most of that is the eighteen modes' worth of engine that is reachable at all —
every field reduction, both blends, the trap painter, all nine families — plus
`serde_json` and the derived readers for the spec.

**Reaching the engine's table cost 133,853 bytes raw and 14,063 gzipped**, 480,813 to
614,666: the whole table is twelve channel sets over nine families and it arrives whole,
where the nine call sites it replaced were 13.4 KB. That is a plain fact and not a gate —
no size outcome was going to block this, and the alternative, instantiating by hand only
the nine channel sets the explorer's own modes actually reach, is a hand-written copy
of the table again, which is the thing the change is for. **A tenth of the raw growth is
what a reader downloads**: the transfer is gzipped, and 14 KB on 164 is the honest figure
to compare against 8.4 seconds off `stripe`.

## A mode's parameters, from the view *(explorer_param_derive_ckpt128, 2026-09-16)*

Two settled constants fail on views they were not settled on, and the page now takes both
from the view in front of it. `permalink.js`'s `DERIVED` names them.

- **An angle mode's texture weight** (`smooth_mean_angle`, `smooth_angle_min`,
  `smooth_curvature`). The texture is stretched against its own frame, so its amplitude is
  already the view's. How busy it is from one pixel to the next is not, and at the
  catalog's 0.85 a texture that changes at every pixel buries the picture. `shade_level`
  measures the **roughness** first: the mean absolute difference of the stretched texture
  between neighbouring samples one output pixel apart, over pixels where the base has a
  value. Then it draws at `weight = 0.0197 / roughness`, held to `[0.05, 0.85]`
  (`engine-wasm/src/derive.rs`).
- **A trap's opacity** (`direct_trap_screen`, `_multiply`, `_lines`). A trap has no field,
  so before anything is painted the pool runs `probe_band` over a 160-wide grid. It counts
  each pixel's near misses and their **load**, `Σ (1 − key) · S` (screen) or
  `Σ (1 − key) · (1 − S)` (multiply), with `S` the sample's luminance. Each hit multiplies
  the pixel's distance from its ground by `1 − opacity · f · S`, so to first order the pixel
  lands at `1 − exp(−opacity · load)`, or `exp(−opacity · load)` for multiply.
  `derive_opacity` solves that for the **median** hit pixel landing at **Oklab L 0.5**, held
  to the painter's own cap (0.15 for the screened cross). The threshold is never derived: it
  is the expensive axis, and the mask's shape belongs to the place.

**Both are rounded to three significant figures before anything is drawn**, so a link
spells the number the picture was drawn at, and spells it short.

### Where the value in force comes from

| `tuning` | when | what the draw does |
| --- | --- | --- |
| `stored` | a link, seat or atlas mark carries the value; a mode switch back into the mode a seat sits in at this place | replays it |
| `derived` | a v3 link without the key; a switch into a trap mode no seat here sits in; the first change a reader makes to a stored view | measures it every pass |
| `default` | a switch into an angle mode no seat here sits in | keeps 0.5 through pans and zooms, until the mode changes |
| `pinned` | the reader typed in the box | keeps it through pans and zooms, until the mode changes |

**A hand switch opens a screened composite at 0.5** *(Matt,
explorer_three_collections_texture_ckpt130, 2026-09-18)*: all five, the three angle modes
and `smooth_trap_circle` and `smooth_stripe` beside them, where no seat sits at that place
in that mode. `TEXTURE_DEFAULT` in `explorer.js` writes it into `view.params`, so Copy link
carries `weight=0.5` and the contract is unmoved: a v3 link that leaves `weight` out still
derives, and a seat still opens at the weight it was drawn at. That is its recorded
`texture_weight` for a seat mined after the weight was drawn per candidate (next door's
`9c615d6`), carried as `weight` by `links.ledger_view`, and the catalog's 0.85 for every
seat mined before it, because that is the picture its tile shows. `threads` settles at 0.5
already and is left alone.

A switch into a trap mode first seeds the value its seats were most often drawn at: 0.6 for
multiply, read off the gallery record at load. The probe then replaces it, and the seed only
survives where the probe found nothing. The line beside the boxes says which of the three
is in force. A derived value lands in `view.params`, so the box shows it, Copy link writes
it, and a download draws at it instead of measuring again. **A probe with no hits changes
nothing**, and the status line says so: "Nothing in this view comes near enough to the trap
to paint" where the finished frame is one colour, and "Too little of this view comes near
the trap to measure" where a thin line the probe grid missed is still there.

A composite's `weight` is no longer part of its field's cache key (`fieldKey`), because it
mixes two fields that are already computed. A probe is cached under `probeKey`, which is
everything but the opacity.

### What the pilot found

The weight target was set on one view Matt judged by eye:
`smooth_mean_angle` at `x=-1.251494740103066 y=0.04110849726974509 w=7.98e-8` on
`cmr.jungle`, mirrored. There 0.85 is far too strong and about 0.1 is right. Its roughness
is 0.197 on the default 884×496 canvas, so it derives **0.1**. Across 15 angle seats at
480×270, roughness runs 0.047–0.181, so their derived weights run 0.12–0.45. Those seats
still open at the 0.85 they were judged at.

On about 170 seat places painted at 160×90 under each trap, the failures were mostly
**saturation**, not emptiness:
- screen goes white on 7;
- lines goes white on 26;
- multiply goes black on 6 at the catalog's 0.2 and on **46 at the seated 0.6**.

Derived, every saturated case landed with its median painted pixel at L 0.49–0.51. Sparse
lines views, where 70% of the frame is never hit, derive to opacity 1 and stay mostly black:
no opacity paints a pixel that no orbit comes near.

**The interior shows the texture at full strength whatever the weight is.** The base has no
value inside the set, so `coloring::composite` shows the texture there alone. That is the
engine's behaviour and it is left alone.

### What it costs

- **Weight:** one extra pass over the one-sample field. On your view at 884×496 in Node,
  the shade takes 77 ms and 84 ms with the weight derived.
- **Opacity:** the probe, over the pool, before the preview. On the served page it took
  67–161 ms at 160×90 on the default canvas; the pilot measured a worst of 2.3 s,
  single-threaded, on a view that is almost all interior at 40,000 iterations. A probe that
  is cached costs nothing, and the stat line names the probe's time when it ran.

## The permalink contract, version 3

`permalink.js` is the only thing that decides what a link means, and nothing else in the
explorer is allowed a second opinion. A URL is the only permanent thing this page emits.

### What version 3 changed, and why it is a 3

Version 3 changed what an **absent** `weight` or `opacity` means under the six modes
`DERIVED` lists. Under v1 and v2 it meant the catalog's constant, and every picture drawn
before v3 was drawn at it. Under v3 it means "take it from this view". A change of meaning
is what the contract's own rules say bumps `v`: without the bump, every angle or trap link
anybody had saved would open as a different picture.

So an older link is read by its own rules. `parse` fills an absent derived parameter of a
v1 or v2 link with the catalog's constant, which comes from `catalog.js`'s baked `SETTLED`
through `context.settled`. The view re-emits as v3 with the number written down. The site's
own links went through the same door:
- `builder/emit.mjs` and `atlas/links.js` write a record's picture with `settledParams`;
- 130 seat links gained `weight=0.85` and 33 gained an opacity;
- five figure links gained theirs;
- every link on the site now says `v=3`.

A link this page writes always carries the value in force, so an absent one only arrives
from a person who left it out.

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
v · f · cx · cy · px · py · zx · zy · m · the mode's parameters · x · y · w · a · p · the shade keys · level
```

- **`v`** — required. `1`, `2` and `3` parse; every string this page writes says `v=3`.
  Anything else is refused: it was written for a version of this page that no longer
  exists, or for one that does not exist yet.
- **`f`** — the family. A name is the whole recurrence **including its exponent**, because
  one picture gets one name: `mandelbrot`, `multibrot3` through `multibrot6` on the
  parameter plane, `julia`, `julia3` through `julia6` and `phoenix` on the dynamical
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
- **`m`** — the mode, one of the seventeen `modes.jsonl` names. `de` is named and
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
  a link may name is wider than the set the picker offers**: a link may name any of the
  library's **1,021** maps and the picker lists **77** of them. It used to be the curated
  set plus whatever this site's own figures landed in, which answered "can this figure be
  opened" and not "can any gallery seat be" — and 451 distinct maps are seated in the
  published record alone. A link arriving on an unoffered map draws it, and the picker
  shows that map for as long as it is the one on the screen.
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

### `level`, and a gallery seat's own colour

**A seat is not drawn through the map its recipe names.** Every candidate the wallpaper
project makes goes through `band_autolevel/v1`: it measures the finished picture's Oklab
tone, and where that tone sits outside the band of finished wallpapers it pushes a curve
through the **map's own stops** and renders again. The operator lives in that project's
Python and never touches a pixel — it reads an image and writes a colour ramp — so a link
built from a seat's recipe alone draws the right geometry in the wrong colour. The
wallpaper project's own records put that at **29.51 of 255** on the seat this was first
caught on, where re-encoding the same JPEG costs about **2.4**.

| key | default | value |
| --- | --- | --- |
| `level` | absent | `band_autolevel/v1:<black_pt>,<white_pt>,<exponent>,<out_ends[0]>,<out_ends[1]>` |

**Five numbers, in the operator's own order and under its own field names.** They are
what the operator's `apply_curve` reads and nothing else. A run's stamp carries nine more
— the band it was projected onto, which side of that band each statistic fell, whether
the exponent was clamped — and every one of those is how the curve was *arrived at*,
which a replay does not need and a link should not carry.

**The version is part of the name.** A `band_autolevel/v2` that measured differently is a
value this contract refuses by name rather than a curve it misreads.

**Absent is off**, so every link written before this key existed draws exactly what it
drew. A key with a default is a widening, which is why this is not a version 3. Absent
stays off even now that the page can measure a curve of its own: 612 of the thousand
seats are field or composite pictures whose link carries no curve (291 carry one, and 97
are direct traps or the modulate, which the operator never acts on), and
all 62 rows of `links.jsonl` are figures drawn without a curve, so reading absent as
*measure this* would open every one of them in a tone nobody chose. Measuring starts when
the reader changes the view, never when a link is opened.

**The operator's own `applies_to` is enforced, and by the module rather than here.** It
acts on a field coloring and on a composite and on nothing else, so `level` under a
direct trap or under the modulate is a refusal in the engine's voice — a link asking for
it would be replaying a decision no run ever took. That test reads a coloring kind, which
lives in the engine's mode catalog, and a fourth copy of that catalog in `permalink.js`
is a fourth thing to keep in step.

**It is not one of the seven shade keys and must not become one.** Those seven *are* the
engine's `Palette` recipe and are handed to the module as a unit; `level` is a separate
operator and crosses beside them, and the module curves the stops before it bakes them.
It is on the **colour** side of the field cache for the same reason every shade key is:
the operator moves a ramp and cannot move a sample.

**The curve is replayed by the wasm, not by the page.** `explorer/engine-wasm/src/level.rs`
is the second half of the operator — densify, the piecewise curve, the chroma cap's
walk-back, the gamut pull-back — and every colour conversion in it goes through
`fractal_engine::colormap`'s own public `srgb_to_linear`, `linear_to_srgb`,
`linear_srgb_to_oklab` and `oklab_to_linear_srgb`. The Python side keeps one copy of
Ottosson's matrices for the stated reason that two halves of one project should not
disagree about what a colour is, and a third written out here would be exactly that.
**Nothing in the engine changed for it**; all four were already public.

**The port is held to the operator, and was measured wider than it is held.**
`level-cases.json` beside the crate holds four `(map, curve)` pairs and the stop list
`autolevel.curved_stops` returns for each — one map of each stop count the library has,
one cyclic, exponents on both sides of 1 and one clamped, the chroma cap firing on 22
stops in the mildest case and 1,524 in the hardest — and `cargo test` compares. Behind
that fixture: **261 maps over 261 distinct recorded curves, 1,467,495 stop bytes, 0
different** (2026-09-15).

**Measured end to end**, on ten seats of the published record `20260914T171846Z` whose
run recorded a curve that actually acted — seven modes over five families, each opened as
a link and drawn by the page's own modules at the seat's own regime, 1280x720 at two
samples per pixel, against the picture the record ships. Mean absolute difference per
channel out of 255, which is `builder check`'s `seats` own distance:

| seat | mode | family | as a link | curve dropped | codec floor |
| --- | --- | --- | --- | --- | --- |
| `752e3977` | `smooth_mean_angle` | phoenix | 4.89 | 5.39 | 2.26 |
| `7d6e5b01` | `smooth` | julia3 | 3.63 | **28.34** | 1.70 |
| `527a2b1d` | `curvature` | julia3 | 4.53 | 4.40 | 2.31 |
| `951253cd` | `threads` | multibrot3 | 2.95 | 3.10 | 1.31 |
| `27aed4c3` | `stripe` | julia | 4.42 | **9.73** | 2.48 |
| `fc627779` | `tia` | mandelbrot | 3.33 | **6.70** | 1.76 |
| `22ef264a` | `threads` | multibrot4 | 3.41 | 3.88 | 1.89 |
| `53f334f7` | `tia` | multibrot4 | 3.02 | **7.37** | 1.45 |
| `b6c86c4d` | `smooth` | multibrot3 | 2.69 | **23.93** | 1.30 |
| `03f826d1` | `smooth_stripe` | mandelbrot | 4.65 | **27.81** | 2.12 |

All ten land **2.69 to 4.89**, inside `checks.SEAT_TOLERANCE`'s 6.0 and in the same band
`picks.RECIPE_AGREEMENT` records for a correctly drawn panel, over a codec floor of 1.30
to 2.48. With the curve dropped the same ten run 3.10 to 28.34 and five of them break the
tolerance. **Every one of the ten is the canonical spelling of its own view**, and the
engine's depth policy answers each with exactly the cap the recipe pinned, so the one
thing the contract deliberately cannot carry did not have to be carried.

**Two of the ten barely move**, `527a2b1d` by −0.13 and `951253cd` by 0.15, and one of
those is fractionally *worse* with the curve. Both are curves whose effect on their own
map is near nothing, and both readings sit at about twice the floor either way, which is
where a correctly drawn panel sits. What the table shows is that the key is never a cost
and is sometimes the whole picture.

### A view the reader made measures its own curve *(autolevel_port_ckpt127, 2026-09-16)*

**Both halves of the operator are in the module now.** `level.rs` carries `tone_stats` —
sRGB8 to Oklab lightness and chroma per pixel, P0.5 and P99.5 by **numpy's own linear
interpolation** (not the engine's nearest-rank `coloring::percentile`, which answers a
different number), the masked median, the neutral-black guard — and `derive_curve`
verbatim, over the band's six numbers transcribed from `levels_band.json` with its sha.

**Two states, and which one a view is in is the page's.**

| state | entered by | the picture | the note beside Autolevel |
| --- | --- | --- | --- |
| stored | a seat, an atlas mark, a pasted link | replays `level=` exactly, or no curve where there is none | *Leveled to this wallpaper's stored tone curve*, or *…the tone curve this link carries* |
| derived | the first pan, zoom or control change; a bare page; ticking the box on a view that arrived with no curve | measured on its own finished picture, every pass the box is ticked | *Leveled to this view* |

**15 of the 1,000 published seats carry a recipe maxiter other than `maxiter::for_width`**, which the page always draws at, so a seat opened here may differ slightly from its gallery picture; Details names the difference.

The Autolevel box is enabled wherever the operator acts — a field coloring or a composite,
which the plan now answers as `levels` — and disabled with *Not used by this mode* under a
direct trap or the modulate. Unticked, the palette is drawn as it is; ticked again, a
stored view gets its curve back and a derived view is measured again.

**The box is off unless the view arrived with a curve** *(explorer_autolevel_default,
2026-09-16)*. A curved seat or a link carrying `level=` opens ticked and replays it; a
clean seat, a link with no `level`, an atlas mark with none and a bare page open unticked,
with *Off: the palette as it is*. A change of mode, palette or place leaves the box where
it was, so an unlevelled view stays unlevelled and a levelled one goes on being measured.
Ticking it on a view with no curve to give back is what makes that view `derived`.

**No permalink version bump, because no link changed meaning.** An arriving link with no
`level` was already drawn unlevelled — the *stored* row above — and only a bare page, which
names no picture, and the views a reader made after moving were ever measured without being
asked. A link written with the box ticked carries the curve it drew, and one whose measured
tone was already in band carries none and reopens unticked on the same picture. So every
saved link and every seat opens exactly as it did.

**What ticking it costs**, measured on the served page in headless Chrome with a 1920×1080
window (a 1088×612 canvas), median of seven alternating runs of `shadeApart` with and
without `derive` on one cached field, while a degree-6 harvest was running next door:

| view | samples | field | colour, off | colour, on | added |
| --- | --- | --- | --- | --- | --- |
| home, `smooth`, `twilight_shifted` (curve acts) | 1× | 132 ms | 235 ms | 851 ms | +616 ms |
| home, `smooth`, `twilight_shifted` (curve acts) | 4× | 502 ms | 292 ms | 1,045 ms | +752 ms |
| julia `stripe` seat, curve stripped (acts) | 1× | 462 ms | 159 ms | 766 ms | +607 ms |
| julia `stripe` seat, curve stripped (acts) | 4× | 1,637 ms | 331 ms | 1,071 ms | +740 ms |
| clean `smooth` seat (in band, no second colour) | 1× | 86 ms | 250 ms | 767 ms | +518 ms |
| clean `smooth` seat (in band, no second colour) | 4× | 351 ms | 443 ms | 896 ms | +453 ms |

The measurement is taken on the output picture, which is the same 666,000 pixels at either
sample count, so most of the added half second does not grow with supersampling; only the
second colouring does. On a view that is cheap to iterate it roughly doubles the final stage.

**Most of that half second was the worker, not the measurement** *(explorer_leftovers,
2026-09-17)*. The table above timed `shadeApart`, which started a worker per shade, and so
did the page. The screen now keeps one shade worker for the session (`ShadeWorker` in
`render.js`), started beside the pool; a download still takes a worker of its own and
terminates it, for the memory. Measured through the page's own control — the phase box,
nine alternating recolours of the home view in `twilight_shifted` at 1088×612, 4×, median,
back to back on one machine:

| final-pass recolour | fresh worker | kept worker |
| --- | --- | --- |
| Autolevel off | 608 ms | 258 ms |
| Autolevel on, curve acts | 979 ms | 612 ms |
| Autolevel on, already in band | ~710 ms | ~375 ms |

So a fresh worker cost about 350 ms of every final pass, ticked or not, and what ticking
adds on a warm worker is about 110 ms of measurement plus the second colouring where the
curve acts, 350 ms in all. The first derive on a warm worker is still slower than the
rest (1.2 s, once, in the second timing run), which is not explained here; the likeliest
reading, unverified, is the measure path running for the first time in that instance. **A kept worker is never interrupted**: a stopped
job that is still waiting is dropped unposted, and one already in flight finishes and is
thrown away, so a recolour asked mid-shade waits for that shade.

**Copy link and Copy view wait for a derived pass.** A pass that derives anything a link
carries — the tone curve, a texture weight, a trap's opacity — disables both buttons from
its start until it ends, because until the value lands the view still holds the last
pass's, and a link copied then would name a picture that is never on the screen. A pass
that derives nothing leaves them alone.

**The measurement is on the final stage and nowhere else.** `shade_level` colours the
two-sample field, measures what it drew, and where the operator acts curves the stops,
bakes again and colours **the same field** a second time — one export, because `shade`
frees the lanes before it colours and a second call would copy the whole field back in.
It runs in the kept shade worker, so the render dot turns final only when the levelled
picture is up. The preview and one-sample stages draw in the last derived curve, so a pan
does not flash to the unlevelled tone and back.

**Copy link writes five numbers, never a flag.** A derived curve goes into `view.level`,
so the address bar and Copy link carry `level=band_autolevel/v1:…` and a link reopens as
the picture that was seen — as a *stored* view, because a measurement taken on another
reader's window would not be. A derived pass whose tone was already in band writes no key,
which reopens as the same unlevelled picture. **Download** replays a stored curve at any
size and measures a derived view again on the frame it draws, because the curve is a
measurement of a frame by design; *As shown* at two samples saves the screen's picture,
curve and all.

**Pinned, three ways.** `cargo test` in the crate:

- `the_derivation_is_the_operator` — `level-derive-cases.json`: ten backfill rows chosen
  to reach every branch of `derive_curve` (a guarded black, the exponent clamped at each
  end, each statistic below and above its band, the identity, both ends moved) and three
  synthetic statistics for branches no row reaches, answered by the operator itself.
  Stored measured statistics in, **stored curve out, bit for bit**.
- `…_on_every_backfill_row` — the same over the whole sidecar next door where this
  machine has it: **4,411 of 4,411 exact** (2026-09-16).
- `the_measurement_is_the_operator` — four bases re-rendered at `640x360ss2` by
  `make-derive-cases.py`, JPEG-decoded by PIL, refused unless Python's `tone_stats` gives
  the row's stored statistics; the port reads the same pixels and lands **0 away** on all
  four. The pixels are in ignored `artifacts/level-derive/` and the test skips by name
  without them.

**It took one fix to get there, and it was not arithmetic.** The first run matched 3,987
of 4,411. The misses were a unit of last place in the exponent, and the cause was
`serde_json`'s default float parser, which is fast rather than exact and reads about one
17-digit decimal in ten a unit off. `float_roundtrip` is on in `Cargo.toml` now. It
matters beyond the test: a replayed `level=` crosses into the module the same way.

`explorer/level.test.mjs` holds the **module** — not the native build — to the same
pixels: wasm's `cbrt` is its own libm, and lands within **2.2e-16** of the operator (two
of the four exact), which the suite allows to 1e-12. It also holds `shade_level` without a
derivation to `shade` byte for byte, a derived curve to **replaying to the same bytes it
drew** under `smooth` and `smooth_stripe` (which is what makes Copy link honest), the
modulate to never levelling, and a spec that already replays a curve to being refused a
derivation.

**A link should not carry an identity curve.** Every stamp has a `curve` block and an
identity one means the render *is* the base map's — the operator writes no levelled map
at all. Replaying one is not quite a no-op here, because the stops make a round trip
through Oklab and back to `u8`: measured at 0.01 to 0.02 of 255 over the ten identity
seats first drawn for this table, which is nothing, and is still a picture nobody asked
for. Whatever builds a link off a record reads `applies && !identity`, not "a curve is
recorded".

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
  Reverse, Mirror, Transfer — every other control on the page is named for its job, and
  these are named so that a reader who has just read `gamma=0.75` in the address bar
  finds Gamma on the page. Reverse and Mirror are toggle chips in the gallery filters'
  style; Phase is a slider over `[0, 1)`, which is its whole range because the engine
  wraps it, with the number box beside it for the exact value.
- **Rolloff has no control, and is still a key.** Counted off the published gallery
  record the left panel is built from, all 1,000 seated recipes leave `rolloff` at
  `none`, so the knob turned nothing any picture there was made with; `transfer` has four
  distinct values across the same thousand (`value`, and `edge` at 0.25, 1 and 2) and
  keeps its menu. A link that names a rolloff is still read, drawn and written back by
  Copy link, and Engine defaults names it among the keys it would reset. `shade.js`
  carries it as `offered: false`, so `CONTROLS` stays one row per key.
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
- **The count of what is set is the reset button's state.** Engine defaults is disabled
  at zero and reads *Engine defaults (3)* otherwise; there is no separate counter.
- **Autolevel is disabled only where the operator has nothing to say** — a direct trap or
  the modulate — with *Not used by this mode* beside it. Everywhere else it is enabled,
  off unless the view arrived with a curve, with one line saying whether it is off or
  whether the curve in force is a stored one or this view's own; the longer reason is
  behind the `?`, as a title and as a click-to-reveal paragraph: what Autolevel does,
  that gallery wallpapers made with it open with it on, and that anywhere else it starts
  off and levels the view from its own picture when turned on.

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

`permalink.test.mjs` holds all of that: **51 tests**, Node's own runner, nothing
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
python -m builder explorer                 # palettes, blob, swatch, catalog, wasm, manifest
python -m builder explorer --palettes-only # when only the colormaps moved
python -m builder explorer --roster <stamp>  # and re-read each map's family and seat count
python -m builder links --write            # the link registry, from figure provenance
```

Needs the sibling checkout, `cargo`, and the `wasm32-unknown-unknown` target
(`rustup target add wasm32-unknown-unknown`). `engine-wasm/target/` is gitignored — it is
the several hundred megabytes cargo needs to produce a 480 KB file.

**The bare command rebuilds the wasm every time, and that is why `--palettes-only`
exists.** `explorer.bake` compiles the crate and rewrites `engine.manifest.json` unless
that flag is passed, and the manifest is rewritten unconditionally: `built` is today's
date and `wallpapers_commit` is whatever the sibling checkout's `HEAD` is at that moment.
So a prompt that came to move a colormap and ran the bare command lands two files it did
not come for — the manifest always, and `engine.wasm` too whenever the engine next door
has moved since the last bake, which folds somebody else's engine change into a website
commit under a message about palettes. **A prompt that does not own the engine reverts
both**, `git checkout` on `engine.wasm` and `engine.manifest.json`, and reaches for
`--palettes-only` first. Owning the engine here means the carve-out in `CLAUDE.md`: a
zero-behaviour change to the sibling engine, made deliberately and named in
`ENGINE_CHANGES`. Rebaking is not one of those and never was.

Which colormaps count as curated is the wallpaper project's own distinction: a map that
arrived by mechanical conversion says so in its `source` line, and the rest were chosen.

**What the bake reads is `palettes.jsonl`, not that distinction.** The roster used to be
derived — every curated map, plus every map a figure of this article names — and it grew
by two hundred the day the wallpaper project admitted an authored drop into its library.
A rebake nobody ran on purpose would have taken the picker from 77 entries to 277, which
is a change to what a reader is offered arriving as a build artifact. So the names and
their `offered` flags are a committed record here; the bake reads the gradients next
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
arriving from the other repository. So `modes.jsonl` names the seventeen the picker offers,
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
