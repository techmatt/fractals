# The visitor explorer

One page that runs the wallpaper project's own renderer in the browser: pan and zoom
every family the wallpapers are drawn from, in every mode the pipeline ships, under any
of the library's 1,022 palettes, and copy a link to whatever is on screen. Every figure
of the article that this page can draw again carries a link straight into it.

**It is a studio, since `explorer_studio` (2026-09-15).** The page is the window: a left
panel of pictures somebody can open — a thousand seated wallpapers, or the atlas of every
place the search kept — and on the right the viewer that draws whichever one is picked.
Same URL, same keys, and every link written before it still opens the same picture.

## What each section answers

This file is the design record for the whole page and it is long. One file on purpose —
the cross-references between these sections are dense, and splitting it would turn
*grep the README* into *grep eight of them and hope* — so what it wants is a way in.
Each line is a `##` below, and the question it is the answer to.

| section | the question it answers |
|---|---|
| **What is here** | which file does what, and what a reader downloads |
| **The studio** | how the left panel and the viewer share one page and one URL |
| **The box tool** | how a frame is named in two clicks, and why it commits like a wheel notch |
| **The render bar** | what the bar on the Download row is measuring, and where its stops fall |
| **The Julia preview under the pointer** | what the hover preview costs and why it never blocks |
| **The walk** | how a frame is walked to a gallery of its neighbours, and what a step is |
| **Deep** | the tab below the `f64` floor: the second module, the pool, the cap, the minibrots, what draws itself |
| **Inflection — paged** | what that trial was, and why the tab is out of the working set |
| **Saved** | what the Saved tab stores, and what it promises when storage refuses |
| **The way back** | what one entry of undo is, and what collapses into one |
| **Every colormap, and where they live** | how a thousand palettes are baked, blobbed and picked |
| **It does not open from `file://`** | why the page has to be served, and what breaks when it is not |
| **The engine, compiled** | how `engine.wasm` is built, what is in it, and what it costs |
| **One spec, and the three exports** | the boundary between the page and the engine module |
| **The download** | what Download and Download all write, and what a picture carries |
| **Measured** | every price this page has been held to: frames, bands, pools, tabs |
| **A mode's parameters, from the view** | which parameters are derived rather than asked for |
| **The permalink contract, version 3** | what a link may say, what it refuses, and why a URL is permanent |
| **The link registry** | how a figure's link is derived, and what a refusal is called |
| **Every pool is given back** | why a document's workers are terminated, and what it cost not to |
| **What the last bug hunt covered** | what was exercised and came back clean, so a next hunt need not |
| **Rebuilding** | the commands, and which of them need the sibling checkout |
| **Next** | what is deliberately not here yet |

**Eleven families, seventeen modes, `f64`.** The parameter planes `mandelbrot` and
`multibrot3`–`multibrot6`, the dynamical planes `julia`–`julia6` and `phoenix`, the
modes `modes.jsonl` offers with the parameters the engine's catalog settles for each,
and double-precision arithmetic that stops zooming where the engine says two neighbouring
samples have become the same number. What is **not** here: fractional degrees, which are
render-only and have no home view to open at; and the niche `de` mode, which the engine
renders by name and no production draw picks.

**Deep zoom is here, in a tab of its own** *(build_deep_tab_ckpt135, 2026-09-19)*. This
line used to rule it out — *a picture that needs perturbation needs a renderer this page
does not carry* — and the page carries one now: `perturb.wasm`, a second module from a
second crate, fetched only when somebody opens the **Deep** tab. What the old line got
right is that it is a different renderer and not a wider one, which is why it is a tab
rather than a widening: degree-2 Mandelbrot, `smooth`, an exact decimal centre, a link
contract of its own, and a Render button under the picture, because a deep frame costs a
minute and a supersampled one costs several. The
eleven families and seventeen modes above are still `f64` and still stop where they
stopped. The article's deep-zoom figures stay baked rasters.

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
index.html            the page, and the inline script that answers for a module
                      that never evaluated
explorer.css          its own stylesheet, on top of the site's
explorer.js           what a reader touches: drag, wheel, keys, pickers, copy link
gallery.js            the left panel's grid: a staged gallery's record, filtered
screensaver.js        the gallery's pictures one after another, full page, drawn live
picker.js             the palette tab strip, and a gradient drawn per row
shade.js              the recipe's controls, apart from the boxes they are drawn in
julia-preview.js      the Julia set of the point under the pointer, and the click into it
download.js           the same render at a wallpaper's size, and what caps it
render.js             the worker pool, the plan, the field passes, the shade
worker.js             one worker: one wasm instance, one band of rows (or one screen)
walk.js               the Walk tab: a simplified mining pipeline, run here and watched
deep.js               the Deep tab: the Mandelbrot set below the f64 floor — see below
deep-render.js        its pool, its one reference orbit a frame, and its shade spec
deep-worker.js        one worker: one perturb instance, one held orbit, one band
deep-fx.js            exact decimal coordinates, BigInt fixed point
deep-link.js          the deep link contract, its own beside the shallow one
phoenix.js            the Phoenix tab: the Phoenix plane drawn live, and a click into its sets
phoenix-points.json   the tab's starting points and its one style, `builder phoenix-points`; tiles in phoenix-points/
paged-inflection/     PAGED: the Inflection tab, out of the working set — see below
undo.js               the way back: the pictures shown, and the cursor into them
saved.js              the Saved list: one localStorage value of links, and the save mark
saved-panel.js        the Saved tab: tiles drawn from their links, import, export, Download all
zip.js                a stored (uncompressed) zip writer, for Download all
stamp.js              a picture's own link, written into the file and read back out
judges.js             the render judge in onnxruntime-web, loaded on the first Start
resize.mjs            PIL's bicubic resize, ported byte for byte: what a judge reads
judges/               UNTRACKED: the two ONNX judges and the runtime, `builder walk`
permalink.js          the link contract — parse, validate, canonicalize
params.js             a mode parameter's control: its word, its slider's travel, the mapping
permalink.test.mjs    55 tests, `node --test explorer/permalink.test.mjs`
screensaver.test.mjs  7 tests: the intervals, the fitting ladder, the correction, the bag
bands.test.mjs        3 tests: the pool cuts the frame, never what is in it
level.test.mjs        7 tests: the module's tone measurement, and a derived curve replays
derive.test.mjs       6 tests: a derived weight replays, a derived opacity lands where it says
saved.test.mjs        8 tests: a bad stored value is an empty list, one link is one entry, the cap
undo.test.mjs         8 tests: one action is one entry, a step back keeps what is ahead, the cap
zip.test.mjs          2 tests: CRC-32's check values, and an archive read back to its bytes
stamp.test.mjs        12 tests: the link goes in, and the picture does not move
deep-fx.test.mjs      12 tests: the Deep tab's arithmetic is exact where a double is not
deep-link.test.mjs    29 tests: the deep contract, and the shallow one held to not moving
deep.test.mjs         17 tests: where the two modules meet, against both committed ones
palettes.jsonl        the roster palettes.js is baked from; 1,022 maps, 77 offered,
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
perturb.wasm          generated: the perturbation kernel, compiled
perturb.manifest.json generated: what perturb.wasm was built from
engine-wasm/          the crate that produces engine.wasm
perturb-wasm/         the crate that produces perturb.wasm — see The Deep tab
bench/                the timing harnesses — see Measured
bench/hunt/           the bug hunt's own: lib.mjs, eight units, four probes
```

## The studio

Two panels, and the document itself does not scroll.

**The bar carries the page's `<h1>`** *(pre_closeout_ckpt138, 2026-09-20)*. Every other
page on the site opens with a masthead and this one has no room for one, so its outline
started at `<h2>` and had no top — the only page on the site without one
*(explorer_bug_hunt_ckpt138, finding 7)*. It reads *Explorer*, after the way back to the
front page and at the bar's own size: `site.css` sets an `h1` at 1.75rem serif, and
`.studio-title` takes all of that back, because a heading that broke the bar's single line
to satisfy an outline would be the wrong trade.

**Left, one of five things.** The third, fourth and fifth — *Walk*, *Deep* and
*Saved* — are sections of their own below. *Gallery* is the staged gallery `python -m builder seats`
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
footer at all. The Render mode select's roster and the
trap-mode defaults stay the general gallery's.

**Two general galleries** *(Matt, pre_closeout_website_ckpt140, 2026-09-22)*. *General
gallery · 2000* is the `final140_general2000` solve, stamp `20260922T220551Z`, listed
under *General gallery · 1000* and ungrouped with it; 1000 stays the default the panel
opens on, and the Render mode select's roster and the trap defaults stay the 1000's. Both
are `axis: "general"` in the header, which is what the label is read off, and the optgroups
below them read *Color family* and *Render mode*. Render mode chips add up; a hue family chip is one at a time, and pressing
it again clears it. **The hue row is the wheel's twelve and nothing else**
*(2026-09-19)*: it used to open on *unfiled 4*, the seats the dominance rule found
dominant in no family, and a chip named after a threshold is no answer to a reader
looking for a colour. `builder/seats.py` gives such a seat the family its own colour
reading favours most — ten of 6,062 — and the chip is gone. Choosing a collection clears both rows: a filter is a question asked of
the collection, and the hue row is not even asking the same question either side of a color
collection, so a chip carried across the switch narrows a shelf by a choice made somewhere
else. A tile sets the viewer to that seat's whole recipe. *Atlas* is the
frame `atlas/frame.js` builds, mounted in the panel, with the marks clicking into the
viewer rather than navigating. **It is the only page that shows one**
*(website_webp_and_atlas_deprecate, 2026-09-21)*: `atlas/index.html` was a page of its own
until this tab superseded it, and is a redirect here now, because a mark is worth more
beside a viewer that draws the place it stands for than beside a link that leaves.

**Right, the viewer**, and under it three sections — Download, Mode, Palette — then
the folded Details: the render stat line, family, constants, `x`, `y`, `w`, all editable. Copy link is in the bar,
because it is about the page rather than about a group.

**A tool and three view buttons close the Download row** *(explorer_view_buttons_ckpt130,
2026-09-17; five until explorer_controls_ckpt140, 2026-09-22; `Box (b)` added by
explorer_box_zoom_and_download_row_ckpt140, 2026-09-22)*, at its right end, **each with its key on
its own face** *(Matt, explorer_ui_text_ckpt139, 2026-09-21)* — `Julia here (j)`, spelled the
way it is pressed, because a tooltip is not something a reader on a touchscreen can open or a
reader on a mouse hovers long enough to find. `KEYS` in `explorer.js` spells the two the page
builds and `index.html` the one whose words never change; `TOGGLE_KEYS` is what binds them, so
a key added there is a label to add. No tooltip carries a key now — with the one exception
Julia here became when its key stopped doing what its button does, below — and the two of them that
only restated their button's own words are gone. **The labels carry the state** as well, so
that the row says where the reader is standing — which is why this page has no status strip
and no breadcrumb:

- **Box (b)** — the box tool, which is a section of its own below. It leads the group
  because it is a tool and the three after it are destinations: they say where the reader is
  standing, and this one is how they get somewhere. It is the only button in the row that is
  a state rather than an action, so it carries `aria-pressed` and glows green while it is
  armed — see the box tool below.
- **Reset to seat** — **no key** *(Matt, explorer_controls_ckpt140)*, where it had `s`: it is
  the one of these a reader presses deliberately rather than repeatedly, and a key on it is a
  picture lost to a stray keystroke. It is in neither `KEYS` nor `TOGGLE_KEYS`. The picture
  the viewer was opened at, put back exactly as opening it did: frame, mode, palette and
  recipe, the tile marked again, and the sentence about what its link could not carry back
  under the canvas. It says **Reset to link** where what
  was opened was an atlas mark or a pasted address rather than a gallery tile — the split
  the tuned-parameter note already makes — and a bare page opened at nothing, so its button
  is greyed and its tooltip says so. The anchor is the last thing that *arrived* and not the
  last thing on screen, so it survives every move, Julia here included.
- **Whole ⟨plane⟩ (r)** — `Whole Mandelbrot`, `Whole Multibrot 6`, `Whole Julia` — the
  plane's home viewport with everything else kept. The name is `planeName`'s, a rule over
  the one shape a family name has rather than a table: the spelling is the atlas record's
  `slot_labels`, derived rather than read from it because the atlas mounts only when its
  panel is first opened and a button is named at load.
- **Julia here (j)** — the view's centre taken as `c`, its own decimal strings so nothing is
  lost, and that degree's Julia set opened at its home view with the mode, palette and
  recipe carried. While the button is under the pointer or holding the focus, a crosshair is
  drawn at the view's centre, so *here* is a point on the picture rather than a word on a
  button. **A click on the picture does the same at the pointer's own `c`** — see *The
  Julia preview under the pointer*.

  ⚠ **The key and the button differ, and this is the only pair on the page that does**
  *(Matt, explorer_box_shortcuts_ckpt140, 2026-09-22)*. `j` **with the pointer on the
  picture** opens the `c` under the pointer; the button, and `j` with the pointer anywhere
  else, is the centre's as it always was. A reader with the mouse over a cusp has already
  chosen the `c` they mean, and panning it to the middle first is exactly the work the
  preview card exists to save — but that card is off by default, so the saving was reaching
  nobody who had not already gone looking for it. The key needs no card: `cursorC` reads
  `hoverAt`, which every `pointermove` on the canvas keeps whether the preview may show or
  not. Where the card *is* up it is the card's own `c` rather than a fresh projection, since
  the card settles 90 ms behind the pointer and the key opening a Julia set a pixel from the
  one on the screen is the drift the card was built to close. Because the label cannot hold
  the difference without saying two things at once, **this is the one tooltip on the row
  that carries a key** — the rule everywhere else being that a key lives on its label.

  ⚠ **`hoverAt` is canvas pixels and never a plane coordinate**, and the Deep tab is gated
  out of the cursor path by name. `planeAt` is the *shallow* viewer's projection and the
  Deep tab draws its own frame on the same canvas, so a stored plane coordinate, or an
  ungated read down there, would open a Julia set at a `c` computed from geometry that is
  not the one on the screen — a plausible picture rather than a refusal, which is the worst
  shape a mistake takes on this page. In the Deep tab `j` does what it always did.

And beside them, **the Julia preview checkbox** *(Matt, explorer_controls_ckpt140)*, which
was on the Autolevel row until this prompt. It sits with `Julia here (j)` because that is the
button it previews. Nothing about its behaviour moved — off by default, per-tab in
`sessionStorage`, never in a link — but two things about its surroundings did: it is greyed
during a download by being named in `setBusy` rather than by being swept with `#shade-bar`,
and it is hidden in the Deep tab with the buttons it now sits among, which is right rather
than incidental, because `previewable` is false while that tab owns the view.

**Random palette and Random phase are the Palette header's** *(Matt,
explorer_controls_ckpt140)*, beside `Reset palette`, where they had been at the end of this
row. What they change is the palette, so they sit with it:

- **Random palette (p)** — one of the **232** maps that seated more than one wallpaper in
  the published record, never the one on screen. The list is the wallpaper project's own
  and rides in the baked index as a flag per map; every other map is still a hand pick.
- **Random phase (h)** — to three decimals. It was `shift+p` until
  *explorer_controls_ckpt140*; this page had no other binding on `h`, so **nothing was
  rebound** to free it, and every key the page takes is now a bare lowercase letter.

Inside a Julia set the third button is **Back to ⟨parent plane⟩** — `Back to Mandelbrot` —
on every Julia set and not only one this tab opened: where this tab did, the parent view is
held in `sessionStorage` and Back returns to it, and anywhere else — a copied link, a seat —
it lands on the parent plane at `c`, **0.05 across** (`BACK_WIDTH`). Either way `c` is
**marked on landing** for a moment and then fades.

**Phoenix has the same pair since `phoenix_tab_ckpt140`.** On `phoenix_plane` the button is
`Phoenix here (j)` and opens the `phoenix` set at `c` and **the plane's own `p`**; inside that
set it is `Back to Phoenix plane (j)`, which lands on the plane at the set's `p`. The plane
opens every orbit at z₋₁ = 0, so a Phoenix set is a point of it only where its `zx`/`zy` are
the origin: a set drawn from another `z₋₁`, which is most of the Phoenix work next door, is a
point of no plane here and has no Back button. Where the Phoenix tab opened the set, the held
parent also names the tab, and Back opens it again with the plane as it was left. A hold is
now matched on every constant the set carries rather than on `cx` and `cy` alone, since the
same `c` at another `p` is another set; a hold written before that still matches the old way.

⚠ **That width used to be the plane's home width**, about three across
*(Matt, explorer_ui_text_ckpt139, 2026-09-21)*, so a Julia set copied out of the gallery
went back to a picture of the whole Mandelbrot set with a mark on it — which says where `c`
is and shows nothing about it, when what the reader is asking is what the neighbourhood
looks like, the neighbourhood being what the Julia set is a picture of. **0.05 is picked by
eye over thirteen gallery Julia `c` values spread across the plane** — the period-2 disc,
both big bulbs, the seahorse valley, the cluster the seating favours west of the cusp, and
four out on the filaments — each drawn at 0.005, 0.01, 0.02, 0.05, 0.1, 0.22 and 0.5.
Under 0.02 the frame empties out on a `c` that sits a little off the boundary: at 0.005
three of the thirteen were a bare gradient with nothing in them. Above 0.1 a flat black
bulb interior takes most of the frame on the three `c` values inside one. Every one of the
thirteen shows boundary and filigree at 0.02, and 0.05 is that with a margin. It is a hand
pick and not a derivation, which is why it is a constant, and it is one width for every
parameter plane — the Multibrots and the Phoenix slice as well — because what makes it the
right size is the scale the boundary has detail on, which those share. The sweep that drew
the sheet is `scratch/julia_back_width.py`, which is untracked as a sweep is — what it found
is this paragraph. Where it looks worst is the two seahorse-valley `c` values,
where half the frame is flat interior either side of the valley, and a `c` a reader typed
into Details that is nowhere near the boundary, where the frame is one colour — `Whole
Mandelbrot (r)` is one key away, which is the other reason the keys are on the labels now.
The Atlas panel's own neighbourhood plate is a committed thumbnail drawn at **0.22** and
recorded as such in `atlas/*.jsonl`; it is not this constant and moving it is a re-render
next door rather than a page change. The link carries only the Julia view. On Phoenix,
which has no parameter plane here, the button is absent rather than present and saying so.

**A button that would change nothing is greyed, never taken away**, because a row that
loses a button moves the rest of them under the pointer: Reset at the picture that was
opened, Whole at the home frame. What either compares is `pictureKey` — the canonical query
with `level` and the derived parameters dropped, since both are measurements of the picture
that land partway through the pass that draws it, and a button must not come back to life
when a pass finishes measuring. It is `keyOf` over the view's own query, and **the way back
keys its entries the same way** — see *The way back*, which needs the same identity over a
deep link as well, which is why the reduction reads a query rather than a view.

**`r`, `j`, `p`, `h` and `b`** — `TOGGLE_KEYS`, and the whole of what this page binds
besides the arrows, `+`/`-` and Ctrl+Z/Y. They are bare letters, never take Ctrl, Alt or
Meta, and work with focus
on a button — the button just pressed, most often. **Ctrl/Cmd is spelled on the row's own
tooltip**, by the two keys that have no button at all *(explorer_undo_redo_ckpt137)*, and
those are the one thing on this row that is a shortcut rather than chrome — which is also
why they are the one pair whose key is not on a label. That is deliberate: the row is
what a reader can see, and anything more on it would be clutter.

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

**A slider that follows the hand coalesces, and that is the whole of what it needed**
*(`explorer_shade_pool_ckpt136`, 2026-09-20)*. Gamma, Cycles, Phase and Texture already
drew on `input` rather than on release, so no control's event moved here — what was wrong
was behind them, a shade of two to four hundred milliseconds under a pointer that fires
sixty or a hundred and twenty times a second. Wired straight to a redraw that would either
stack passes up behind the hand or abandon each a few milliseconds in and never finish a
picture. So a move while a pass is running is **remembered rather than acted on**, and the
pass that follows draws whatever the control says by then: a machine that keeps up
recolours every frame, and a machine that does not degrades to the newest value rather
than the oldest queued one, with nothing thrown away half drawn. A pan or a mode change
landing in the middle takes the pending redraw with it rather than adding one after it.
Under a direct trap every value re-iterates and the sliders still wait for release, which
is unchanged and is not about the shade.

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
disabled with nothing to reset — the separate "N of 7 set" line is gone, and the button's
title names the keys, including any that have no control.

⚠ **It reads *Reset palette* and nothing else** *(Matt,
explorer_box_zoom_and_download_row_ckpt140, 2026-09-22)*. It carried the count of keys set
in parentheses — `Reset palette (2)` — and on this page a parenthesis is a hotkey, every
other one being one. Nothing was lost by dropping it: the title already names the keys
themselves, which says more than a count did, and a greyed button already says when there
are none.

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

### The screensaver *(gallery_screensaver_ckpt141, 2026-09-22)*

**One button in, Esc out.** *Screensaver* sits beside the Collection dropdown and shows
what the Gallery tab is showing: that collection, narrowed by whichever mode and color
family chips are pressed, taken once on the way in. Seats come at random without
replacement until the shelf is exhausted, then it is shuffled again, and a new round never
opens on the seat that closed the last one. Each seat is its tile's own link, parsed, so a
picture here is the picture the tile opens, drawn at the screen's size.

**The layer covers the studio rather than replacing it.** It is fixed over the whole page,
black, with the picture letterboxed at its own aspect. The studio and the bar go `inert`
underneath, and nothing there moves, so the viewer keeps its size and does not redraw for
the layer coming or going. Moving the pointer brings up a small bar for about two seconds:
the interval, *Pause*, *Full screen*, *Exit (Esc)*. Space pauses and resumes.

**Full screen is a button** *(Matt, 2026-09-22)*: *Full screen (F11)* asks the browser's
Fullscreen API for the layer, which a click is allowed to, and so does `F` inside the
screensaver. The key in its label is the browser's own, **F11**, or **⌃⌘F** on a Mac
(`fullscreenKey`), which works as well. Where the API is missing (a phone's Safari) the
button is disabled and still says the key. In the API's full screen the browser takes the
first Esc to leave it and does not pass it on, so Esc twice exits. Leaving the screensaver
leaves the full screen it asked for, and never the reader's own F11. Esc hands the viewer back on
the Gallery tab at the last seat shown, opened the way its tile opens it, *not exact* line
included, so it can be saved or downloaded.

**The interval** is *Fastest · 10 s · 30 s · 1 min · 5 min · 10 min · 30 min*, 30 s by
default, *Fastest* being 4 s, and remembered in `explorer.screensaver-every`. It is a floor: the 500 ms
cross-fade (`SCREENSAVER_FADE_MS`) starts when the interval has passed **and** the next
picture is finished, whichever is later. The next seat renders while the current one is up,
and a partial pass is never shown.

**Fitting a seat to the interval.** A seat is priced with the Download row's `estimate`,
the `COST` table, at the screen's size in device pixels, multiplied by a correction. It is
then stepped down until the price fits the interval: four samples a pixel, then one, both
at the screen's size. **Never under one sample a pixel** *(Matt, 2026-09-22)*: a seat that
does not fit at one is skipped rather than drawn smaller. Until then the ladder went on to
half the size and a quarter, and *Fastest* was priced against 2 s with no floor, which is
what put most seats at half size in the measurements below. A render that runs past twice its price is cancelled and the
seat skipped, but never while it is inside twice the interval: at one minute, the first
measured run cut a seat priced at 6.5 s at 13 s, and under a 4 s *Fastest* the interval
alone cut seats priced at 1.4 s at exactly 4.

**The correction is learned** *(Matt, 2026-09-22)*. `COST` is one machine at the mandelbrot
home view, and a seat is usually deeper and iterates more per sample. So each picture drawn
adds its measured-over-priced ratio to a list of the last fifteen, and the median of that
list, clamped to 0.5–4, scales every price after it. It is kept across entries for as long
as the page is open. A whole shelf of skips in a row stops and asks for a longer interval,
rather than spinning.

**It renders on a pool of its own.** `Renderer.over` gives it a pool over the module the
page already compiled, the way the walk has one, and it is stopped on the way out. The page
cancels a pass by generation, and F11 is a resize, so a shared pool would have had the
screensaver's picture cancelled by the redraw of a viewer nobody could see. The viewer's
resize redraw is held while the layer is up, and the viewer redraws once, on the way out.

**The address bar tracks the picture on screen**: its own link, then
`panel=screensaver&every=…`, and `collection`, `modes` (comma-separated) and `hue` where
they are not the default. All five are UI keys (see above). A reload, or a bookmarked
link, opens the Gallery tab on that collection with those chips pressed, then starts the
screensaver on the named picture. A link naming only the panel starts on a random seat. A
chip the collection has no row for is let go.

**The log, off by default**, mirrors `explorer.deep-log`:
`localStorage.setItem("explorer.screensaver-log", "1")`, read on each entry. One line per
event, `[screensaver <time>] <event> {…}`: each `pick`, each `drawn` with its size, scale,
samples, `prior`, corrected `priced`, `took`, the correction `factor` and the budget, and
each `skip` with why.

**Measured** on a twelve-thread desktop, headless Chrome, a 1751×985 layer, the general gallery:

- At **1 min**, every seat fit at four samples a pixel, most in 1–4 s, and the correction
  settled near 0.5.
- At **10 s**, smooth fit at 4×, and stripe, smooth_mean_angle and tia fell to one sample.
  A stripe seat priced at 3.3 s took 5.9 s, and the correction rose to about 1.8.
- Under **Fastest**, when it was 2 s and the ladder went down to a quarter, most seats fell
  to half size, and about one in six was cancelled for
  overrunning twice its price, mostly deep seats costing three to four times their mode's
  typical price.
- A quarter was never needed at this size. On a 4K display, stripe's corrected price is
  about 28 s at one sample, so it fell to half at 10 s, and is skipped at 10 s now.

## The box tool *(Matt, explorer_box_zoom_and_download_row_ckpt140, 2026-09-22)*

`b`, or `Box (b)` at the left of the Download row's toggles. **Click the center, move away
to set the width, click again to zoom to it.** `Esc` or `b` again cancels, an armed or
half-drawn box either way, and the tool disarms after one zoom — a reader who wants another
asks for another.

**Armed is a state the button shows** *(walk_root_frame_and_box_armed_ckpt141)*. Pressing
`Box (b)` or `b` arms the tool: the next left click on the canvas is a box's centre. The
button glows green — `--state-final`, the Download arrow's green, as border, word and a soft
`box-shadow` halo — from the press until the box lands and the zoom is taken, or `b`, the
button again, or `Esc` disarms it, and the canvas takes a crosshair for as long. **Two
things made the press look like nothing, and both were real**: the button had no click
listener at all — only `b` reached `toggleBox`, so a press on the button really did nothing —
and the armed look was the link blue on border and word, which is exactly what `:hover`
paints, so even `b` left a pointer resting on the button looking at no change. The listener
is wired now, and the rule is spelled for `:hover` too so the glow holds under the pointer.
Checked in headless Chrome with real mouse events: press arms (`aria-pressed` true, glow up
under the pointer), a second press disarms, `Esc` and `b` each clear it, and a box drawn
after arming zooms and clears it. A right- or
shift-click centring press never needs arming and starts a box as it always did — the button
glows from that press as well, since the box then exists.

**Or start one without the key: a right-click, or a shift-click, on the picture** *(Matt,
explorer_box_shortcuts_ckpt140, 2026-09-22)*. `b` then a click is two presses to say one
thing, and neither button was doing anything on this canvas. That press is the **centring**
click and not a second way to arm the tool, so the box is half-drawn from where it lands and
the next press takes it — and that next press is an **ordinary click**, no modifier wanted,
because a gesture that needs a key held to finish is a gesture nobody finishes. Everything
after the start is the same code: the width follows the pointer, `Esc` or `b` cancels, the
`Box (b)` button lights the moment the box exists, and a finish inside `BOX_LEAST` cancels
as it always did. Measured in headless Chrome, both starts: 3 across → 1.5 for a box half
the canvas wide, and the button `aria-pressed` true at the start and false after.

⚠ **The context menu is refused on the canvas, and the latch is not decoration.** Windows
fires `contextmenu` on mouse-**up** — Chrome and Firefox both — so the right press that
*finishes* a box has already set `box` back to `null` by the time the menu arrives, and a
gate on `box !== null` alone would let the menu open over the picture the reader just asked
for. `boxedMenu` is set wherever the tool consumes a right press and cleared where the menu
is refused. The listener is on the canvas element and **never on the document**, so every
panel, tab, link and text box on this page keeps the browser's own menu; measured, two
refusals on the canvas across a start and a finish and one menu allowed through on the site
bar. What does go is *Save image as* on the canvas, which is the one thing this costs — the
Download row is the way a picture leaves this page, and it leaves at a wallpaper's size
rather than at the canvas's.

**Every other way into a view on this page is incremental**, and that is what this is for.
A wheel notch, an arrow key and a drag each move a little and each start a render; getting
to a piece of filigree the reader can already see took a dozen of them, and a dozen renders.
A box is the frame named in one gesture.

**Centred on the first click, not corner to corner.** The commoner idiom is a drag between
two corners, and it is the wrong one here: what a reader wants is *that*, in the middle, and
a corner-to-corner box makes them work out where the middle will end up. The box is drawn at
the **viewer's own aspect** throughout — half the width follows the pointer, and the height
is that width through the canvas's ratio — so the rectangle on the canvas is the frame that
will be drawn rather than an approximation of it. A second click within `BOX_LEAST` (8
canvas pixels) of the first is a reader changing their mind and cancels, because a box a few
pixels across would land past the `f64` wall from most places on this page.

**It commits by the route a wheel notch takes.** `zoomToBox` is `zoomAbout`'s own tail —
`moveTo`, `reproject`, `draw`, and the one `changed()` inside `moveTo` — so the way back, the
address bar, the seat note and the Julia preview all see an ordinary view change and know
nothing about the tool that made it. `zoomAbout` itself cannot stand in for it: that one
holds the anchor where it is on the canvas, and a box is centred on the point clicked. What
the two do share is `tooDeep`, pulled out of `zoomAbout` for this — the `f64` refusal and
the *Open this frame in Deep* offer are the whole of what this renderer has to say about
going deeper, and a box that overshoots the wall gets the same sentence a wheel does.

**A half-drawn box is cancelled by any other view change**, in `changed()`: the rectangle is
over a picture of somewhere else the moment the view moves under it. An *armed* one survives,
because nothing has been chosen yet. The tool's own zoom is not caught by that, since it
disarms before it commits.

**It paints like the mark and the walk's cells** — onto the screen after every stage, never
into `frame`, through `paintBox` at the head of `paintMark`. Two strokes, a wide dark one
under a narrow light one, for the mark's reason: either alone disappears against some picture
on this page. The centre stays marked with a small square while the width is being set.

**The Deep tab has it too, and pays about a dozen lines for it.** The painting is free —
`compose` is that tab's one seam onto the canvas and it ends in `paintMark` like everything
else — so what it cost is the commit. `deep.js`'s `zoom` became `reframe(px, py, pull,
widthOf)` and gained a `box` beside it: a wheel notch moves the centre `1 − scale` of the way
to the pointer, a box moves it all the way, and the exact-decimal arithmetic is the same in
both. One `moved()`, like every other gesture there — composing `pan` and `zoom` would have
written an intermediate frame to the address bar.

⚠ **And in that tab the box reads off the frame the canvas is SHOWING, both halves.** While
a deep frame is pending, the canvas holds the previous picture widened to `PENDING_FRAMING`
(0.65) — so a box drawn on it means that piece of *that* picture, and its width has to scale
from the shown frame's width and not from the view's. Taking the centre from one and the
width from the other was the first version of this and it **overshot by 1/0.65**, which
looks like a tool that zooms too far rather than like a bug. Measured: with the tab pending
at 4.4 across and a box a third of the canvas wide, the box landed at width 1.3228 where the
picture said 2.0350. A wheel notch keeps scaling off the view's own width, deliberately —
a notch is a notch, and notches held down while a frame is pending should compound on the
frame being asked for.

**It is a mouse gesture.** The sizing is `pointermove` between two clicks, and a touchscreen
sends no moves between taps — a second tap lands inside `BOX_LEAST` and cancels. That is the
same line the Julia preview draws, and for the same reason; nothing on this page is only
reachable through it.

## The render bar *(Matt, explorer_box_zoom_and_download_row_ckpt140, 2026-09-22)*

`#render-state`, on the Download row before the estimate. **It was a dot until this prompt**:
the colour said which of three stages a pass was in — red drawing the field, yellow with the
one-sample picture up, green finished — and nothing said how far through one it was, so a
slow frame and a stuck one looked identical for as long as anybody was willing to wait. The
reading keeps its colour and the bar fills.

**Full is the resting state, not the empty one.** Nothing rendering means the picture is
finished, so the bar sits full in the colour of the last reading; an empty bar would read as
a render that never started. `showState` fills it at both ends a pass can have — `final` and
`stopped` — and empties it on entering `rendering` from any other state, which also covers a
drag's slid preview, honestly at nothing.

**The stops are derived from the two constants, never typed.** A pass is three field stages:
the preview at `PREVIEW_DIVISOR` coarser each way, the full pass at the screen, and the
finish at `FINAL_SUPERSAMPLE` finer each way — 1/16, 1 and 4 of the screen's samples today,
so the bar's stops fall at **1.2%** and **20.7%**. `STAGE_SPAN` computes them, so a change to
either constant moves the bar with it. A stage served from the field cache **jumps** its
share rather than filling it, which is the truth: nothing was iterated. A recolour of a
cached final field sits at 20.7% and goes full at `final`.

**The shade is not counted.** It is milliseconds against a field pass at a screen's size.
`download.js` reserves a `shadeShare` at the end of its own bar because a *download's* shade
is seconds to minutes; a screen's is not, and a bar that crawled the last few percent for it
would be measuring the wrong thing.

**The Deep tab does not drive this bar** *(deep_tab_activity_and_layout_ckpt141)*. It has
its own, `#deep-bar`, on its Render line beside Cancel, and `#render-state` is hidden while
the tab owns the canvas — see §Deep, *The Render line says what the tab is doing*.

⚠ **`data-state` stays on that element**, and the fill is a child. `bench/page.mjs` puts a
`MutationObserver` on it and `bench/hunt/lib.mjs` reads it; the observer filters on
`data-state` by name, so the per-band `--done` writes are invisible to it.

## The Julia preview under the pointer *(explorer_julia_hover_preview_ckpt137, 2026-09-20)*

On a parameter plane — the Mandelbrot set and the four multibrots — the point under the
pointer is a `c`, and a small card draws that `c`'s Julia set while the pointer rests on
it. A click enters it. `julia-preview.js` owns the card, its pool and its switch; the page
owns the gate and the geometry.

**It exists because Julia here takes `c` from the centre.** That is the right thing for a
button — the crosshair says exactly where *here* is — but it means choosing a `c` is
panning it to the middle and pressing J, looking, and panning again. The gesture this adds
is the one the article's own argument wants: zoom the plane in on a cusp or a valley edge,
move the mouse, and watch the Julia set change. So `c` is taken at full `f64` from the
pointer's place, and the card tracks small movements at whatever zoom the plane is at.

**The card is the picture entering gives, at one sample a pixel.** `juliaViewOf` is the
one place that view is built and both callers use it, so the preview and the entry cannot
drift: same family, same home frame, same mode, palette, recipe and tone. The three
differences are all size — 320x180, one sample where the screen finishes at two, and the
preview's own pool — and the fourth is not, which is why the card says so:

**A mode too slow for the card falls back to `smooth`, and the card marks it.** The gate is
`download.js`'s per-mode prior, read at 320x180 on the preview's own worker count, against a
quarter-second budget. On this machine (12 cores, so three workers) it demotes **`stripe`
and `smooth_stripe`** and nothing else. A frame that then overruns **twice** the budget
demotes its mode for the rest of the visit — twice, and not merely over, because the place
costs as much as the mode: `smooth` measures 190-250 ms over a `c` inside the main cardioid,
whose Julia set is nearly all interior and runs every sample to the cap, against about 20 ms
a thumb's width outside it. Demoting on that would take a mode away over a region and keep
it away everywhere. Measured over all thirteen modes the select offers, a frame lands at
78-193 ms end to end, the 90 ms settle included; none was demoted by measurement.

**It yields to the main picture and never competes with it.** Its own small pool, a third
of the cores and never more than three — the walk's and the Saved tab's are a third capped
at four, because those run while a reader is watching them and this one runs while a reader
is watching something else. This said the other two were *half* the cores
*(walk_faster_ckpt138)*, which the code has never said; it is the reading that was wrong
rather than the rule. **All three start at their first use and all three are given back on
`pagehide`** — see *Every pool is given back* below; the preview's is the last of the four
to exist and often never does. Pointer moves coalesce to the latest and draw once the
pointer has been still for 90 ms, and nothing is started at all while the viewer's own pass
is in flight: the settle re-arms instead. Measured, a `tia` pass is 104, 114, 113 ms with the pointer
sweeping the canvas for the whole of it against 105, 104 ms with the pointer still.

**The gesture is a plain click, and only while the card is up.** That is what keeps it from
surprising anybody: the reader is clicking a picture the page already has in front of them,
and a click anywhere the card is not — every Julia set, Phoenix, the Deep tab, a running
walk, the preview switched off — still does what it always did, which is take the focus.
**`j` needs no card** *(Matt, explorer_box_shortcuts_ckpt140, 2026-09-22)* and is the same
`c`: a key is a deliberate press in a way a click on a picture is not, so it does not owe
the reader a picture first — see *Julia here (j)* above. It
enters at the `c` the card drew rather than at the pointer's own place, because the picture
is what was chosen. It goes through the same `juliaTo` the button does, so Back to
Mandelbrot returns to the frame that was left and Ctrl+Z steps back out of it, both for
free. A release counts as a click under **4 canvas pixels** of travel; exact-zero was only
ever safe because nothing was bound to it, and a hand on a mouse is never quite still.

⚠ **A button going down fires a `pointermove` of its own, before `pointerdown`.** The first
version tore the card down on it — the gate includes "no drag in progress" — and the release
then had nothing left to enter at, so the click was eaten by the very gesture meant to make
it. `hoverPreview` returns without touching the card while a press or a pinch is live; a
drag that actually moves the view takes the card away through `changed`, which every move
already goes through.

**Nothing else is added.** No link key, no panel, no second setting. One flag,
`explorer.julia-preview`, behind try/catch like everything else this page stores. Two
places touch it and they are one switch: a checkbox beside Autolevel in the palette row,
and the card's own `×`. The Download row's five buttons are untouched; that row is closed
on purpose.

**It is off unless the box is ticked, and the tick lasts the session**
*(Matt, explorer_ui_text_ckpt139, 2026-09-21)*. It was on by default and remembered in
`localStorage`. It is an option now — one a reader turns on when they want to aim a `c` by
eye, rather than one that follows their pointer around whether or not they asked — so the
default is off and the memory is `sessionStorage`: a visit that wanted it keeps it across a
reload and a link, and a visit that did not is never handed it. The checkbox moved out of
the Details fold and onto the shade row with it, because a setting nobody has switched on
has to be somewhere a reader can see.

**Desktop pointer only.** `(hover: hover) and (pointer: fine)`, and a `pointerType` of
`mouse` on the event itself. A finger has no hover, and the tap that would stand in for one
is the pan.

## The walk *(walk_tab_ckpt131, 2026-09-18)*

**The tab says what it is, at the top** *(Matt, explorer_controls_ckpt140, 2026-09-22)* —
one sentence above Walk config, and the first thing in the panel:

> This visualizes a guided walk through escape-time fractals. It is mostly a demonstration
> of how the process works: the shipped galleries are the best results after running it
> continuously for many weeks. For more, read [Finding good locations].

Matt's wording, placed verbatim but for one word: he wrote *orbital fractals*, and the site
teaches **escape-time fractals** — §Escape-time fractals is a ratified section and *orbital*
appears nowhere on the site, so the naming rule takes the article's own term. *guided walk*
and *galleries* are the site's words already.

**The last sentence is the way back into the article** *(Matt, walk_tab_ckpt140,
2026-09-22)*, and it goes to `article/finding-good-locations.html` because that section is
where the walk is: its §Guided search names the thing this tab is a demonstration of — *its
search is a guided walk* — and §The walk and §Where the walk stops are the pipeline's own
version of what the strip shows. It is a relative href like every other, and the Deep tab
carries the same shape (§Deep). These two are the only links out of the explorer into the
article; the site bar's *Making Fractal Wallpapers* is the way to the front page and always
was.

The third tab runs a simplified version of the mining pipeline, and the viewer shows it
choosing. **It never starts on its own**: `panel=walk` in an address opens the tab, and only
Start starts a walk. Hiding the tab pauses it, and so does Pause; nothing else does
*(walk_detach_ckpt131)*. Anything the reader does to the viewer (a pan, a zoom, a control,
or a picture opened from any panel) **detaches** the viewer instead: it becomes the reader's
editor again and the walk carries on, on its own renderer, recording what it would have
painted. Start, Back to the walk, or showing the tab again hands the viewer back. Whether a
walk runs and whether the viewer follows it are two states, `state` and `attached` in
`walk.js`, and Saved is the one tab whose showing touches neither.

**One walk.**

1. It picks one of the ticked planes at random: the sampler's `SERVED` set, meaning
   Mandelbrot, Multibrot 3–6 and the pinned Phoenix slice.
2. It draws a root width log-uniformly in the band, 1e-3 to 1e-4 by default
   *(walk_view_ckpt131)*. The sampler's own band is 0.1 to 1e-3 (`WIDEST`/`NARROWEST`), and
   typing it back into the config still works; the default sits deeper because the render
   judge has nothing to say above about 1e-2, and a walk that showed every halving from
   the home box spent its first eleven rungs on pictures nobody was weighing.
3. **Stage one** is quick and the viewer does not follow it: the strip's first card says
   which plane it is searching. It descends the sampler's quad-tree over the plane's
   home box × 0.9. Each cell gets a 64×36 smooth probe, at maxiter 256 while the cell is at
   least 1e-3 wide and at the width's own `maxiter_for_width` below that, where 256 would
   read escaping points as interior. A quarter *straddles* where its interior share is
   strictly between 0 and 1, and the walk goes into a straddling quarter at random; nothing
   is judged. A cell with none straddling backs up and tries the next.
4. At the drawn width, the cell's centre is jittered up to a quarter cell and that frame
   goes through the engine's screen, which is the only screen stage one runs. A refused
   frame is dropped for the next straddling cell without a word; a plane that gives out
   (64 back-ups, or 16 refused roots) restarts somewhere else.
5. The frame that passes is the *root*. **The viewer first shows where it is**
   *(walk_root_frame_and_box_armed_ckpt141)*: the plane's home frame, drawn as a rung is — the
   384×216 smooth `twilight_shifted` picture, upscaled, never refined — with one box centred on
   the root and labelled *root*, held 500 ms (`HOME_HOLD_MS`), and then the viewer jumps to
   the root. The root is a thousandth of the plane or less, a sub-pixel dot on a frame about 3
   wide, so its box is drawn at the larger of its true width and **6% of the home frame's
   width** (`HOME_BOX_FLOOR`) — enough to find at a glance and to hold its label inside it at
   the overlay's type size. It is a shown frame only: not judged, not a rung, and not a card;
   the search's card says *root found* while it is up. The hold is a queued dwell, so the
   root's own picture is computed through it. A Julia twin's leg already opens on its home
   frame and is unchanged.
6. During stage two the viewer is framed wider than the frame the walk stands in, so the
   frame takes 65% of the viewport's width and its quarters and their labels sit inside the
   picture; the frame's own outline is drawn faintly. Only the viewer is widened: every
   probe, screen and judged picture is of the frame itself. Pausing puts the viewer back on
   the frame at its own framing, and so does hiding the tab; Start widens it again. Opening a found tile shows the tile.
   **While the walk runs, the viewer draws nothing of its own** *(walk_console_ckpt131)*:
   it shows the 384×216 picture the walk judged of the frame it stands in, upscaled, with the picture
   before it dimmed around it and black beyond, and never refines it (`showWalk`; the
   render-state bar reads Stopped). A rung's finished state, with its last label and the
   chosen box, is held 400 ms (`DWELL_MS`) while the walk carries on computing. Each
   colouring of a mined place is shown as it was drawn and held 150 ms (`BURST_DWELL_MS`),
   because sixteen of them at the rung's hold would leave the viewer six seconds behind the
   strip; the picture the place keeps is held the full 400. A pause, a reader's move or an
   opened tile hands the viewer back to its own renderer at full quality.
7. Every judged picture is the smooth mode at **384×216**, one sample, `twilight_shifted`,
   scored by the render judge's P≥3. It was 640×360 until *(pre_closeout_ckpt138,
   2026-09-20)* — the gate reads 384×224, so 2.7x the samples were being drawn for the
   viewer alone in the largest part of a rung, and the viewer gets the same picture
   upscaled. **384×216 and not the gate's own 384×224**: the walk's geometry is 16:9 from
   `boxOf` down, and 12:7 would judge a taller slice of the plane than the frame the screen
   passed. What the width buys is the most of it anyway — the gate stretches to 384 wide, so
   the horizontal resample is now the identity and only the vertical is a stretch. The root is judged once before stage two starts.
8. **Stage two** carries on from the root by the sampler's rung rule *(walk_descend_ckpt131)*
   and is the part the viewer follows: the current frame is split into quarters, the
   straddling ones are jittered, screened and judged, and the walk goes into the best. The
   probe runs at the width's own `maxiter_for_width`. It stops at the first of:
   - a **peak**, counted only once the best rung seen, root included, has cleared the
     patience floor (P≥3, frozen at 0.20 — `PATIENCE`). After that it is a peak when the
     score has stayed under that best for two rungs running while the best is under 0.5,
     and for three once it is over. Below the floor there is no
     peak, and the descent goes on to one of the three below *(walk_tune_ckpt131)*;
   - the **floor**: `f64` would no longer resolve the mining grid (`resolution_ulps`);
   - the **step cap** *(walk_faster_ckpt138)*: the walk's budget is down to what the place
     it has found needs to be painted. **A step is a card in the strip** — the frame the
     walk stands in, each rung under it, the twin's home frame, and the place being painted,
     however many colourings that place is tried in — and **a walk gets fourteen of them,
     both legs together** (`STEPS`). It was 20 rungs **per leg**, and a walk could
     therefore show forty: measured, one did — 40 rungs, 42 steps, 166 s, and
     it painted nothing at either end of it. Over a dozen walks the old rule ran to a median
     of 14 steps and a p90 of 21. The budget holds back one step for the mining, because a
     walk that descended until it ran out and then drew nothing would be shorter and worse,
     and a Julia twin is not started at all below four (`TWIN_STEPS`). **The twin has five
     steps of its own on top of the fourteen** (`TWIN_RESERVE`, *pre_closeout_ckpt138*),
     added when its leg starts so that a plane leg which ran to the end of the budget
     cannot have spent them;
   - a **dead end**: no quarter straddles or survives the screen.

   The old rule stopped at two rungs under the best whatever the best was. At low scores
   that is two noisy readings, so descents ended three decades short of seat depth, and a
   root scoring near zero ended its descent at rung two. Measured on 31 descents under the
   patience rule (walk_tune_ckpt131, 2026-09-18), the best frame's width has a **median of
   2.5e-5**, against 1.6e-3 under the old rule, and the deepest reached 1.7e-8, which is
   seat depth.
9. The best frame seen, root included, is judged against the bar, which is where the place
   is mined, not the last frame. When the Julia box is ticked, the walk goes on to the Julia
   twin once the plane's place is finished. The twin's `c` is the centre of that **best
   frame**, not the root *(walk_tune_ckpt131)*: a root-band `c` is almost always outside
   the set, so its Julia set is dust, and all fifteen twins taken there dead-ended at rung
   one. The twin gets a stage two of its own from its home frame. If that frame still has
   no straddling quarter, the twin is descended **on the judge alone**: all four quarters
   are weighed, and only the screen refuses one. Phoenix has no
   twin, and a twin with fewer than four steps left in the walk's budget is not started at
   all *(walk_faster_ckpt138)*.
10. A place over the bar is mined, and **it is one field tried in sixteen colourings**
   *(walk_faster_ckpt138)*:
   - **The field once**, in one of the roster's cheap modes drawn at random, at 384×216×2 —
     candidate geometry at the mining supersample. (It was 640×360×2, the pipeline's own,
     until *pre_closeout_ckpt138* took the judged picture down to the gate's width; this
     line said 640 until *walk_tab_ckpt140* noticed.) A texture weight or trap opacity is
     derived exactly as the viewer derives one.
   - **Then fifteen recolours of that same field** (`RECOLOURS` is sixteen counting the
     first), each through a map drawn uniformly from the chosen palette roster
     *(walk_palette_families_ckpt135)*, with the identity shade, `mirror` read off the map's
     cyclicity and a uniform phase. A recolour is `Renderer.shade` over a field the engine
     has already computed — a tenth of a second against seconds for the field — so the
     fifteen together cost less than any one of the modes that left the roster.
   - **And one dearer picture at some places**: a mode out of `DEAR_MODES` (`threads`),
     drawn in full, where the place before this one did not take one, so two never run
     together.
   - **And a finish** *(Matt, walk_tab_ckpt140)*: `FINISH_MODES` — three — further pictures,
     each in a mode of its own and so each its own field, drawn at random out of everything
     the Render modes group offers and never a mode this place has already been drawn in. See
     *A slower finish* below.
   - Each candidate is scored by the gate's P≥4 and they are ranked together, and the best
     are kept as tiles (one, frozen — `KEEP`). **The walk scores with the render judge
     alone, which is what the pipeline's own walk does**; the fine head is gone from the
     tab and its weights from the site *(pre_closeout_website_ckpt140)*. **The badge reads `Quality 0.15`** *(Matt, walk_tab_ckpt140)*:
     Quality is `P(≥4)`, the render judge's probability that a person rates the picture 4 or
     5, unchanged in value and in meaning. `P≥4` is the pipeline's notation and this tab is
     read by somebody who has met neither the judge nor its scale, so the badge on a found
     tile and on every candidate tile says the word instead. The strip's cards still say
     `P≥3`, which is a different question — how good the *place* is rather than this picture
     of it — and the peak rule's own number.

   It used to be **one recipe per ticked mode** *(walk_view_ckpt132)*, eight at the default
   ticks, each its own field — and before that three draws over modes × palettes (hunt and
   mine's `PER_LOCATION`). The trade is deliberate and it is the tab's own: this is a
   demonstration of how the galleries were made rather than the way anybody gets a good
   picture, so it buys its variety where variety is nearly free. What a place costs either
   way is under *What a walk costs* in §Measured.

**The config is four choices, and the tuning is frozen** *(Matt, explorer_controls_ckpt140,
2026-09-22)*. It was six groups; *Depth* and *At a place* are gone, and the numbers
behind them are constants at the top of `walk.js` — `WIDEST` 1e-3, `NARROWEST` 1e-4, `STEPS`
14, `PATIENCE` 0.20, `KEEP` 1, `BAR` 0.50. Every one of them fed what the walk
*does* rather than what it shows, so each is fixed at what its control opened at and the walk
behaves exactly as it did with nobody touching them — which is how it was nearly always run.
This tab demonstrates how the galleries were made; a demonstration does not ship seven spin
boxes of tuning. What is left to choose is Planes, the Julia twin, Render modes and Palettes.

**The fine head is cut, not frozen** *(Matt, pre_closeout_website_ckpt140, 2026-09-22)*. The
seventh control was the fine-head tick, and freezing it at unticked left `mine`'s fine-head
download and `judges.js`'s `loadFine`, `fineSession` and `fine` reachable by nothing. They
are removed, and so are the weights: `python -m builder walk` places the runtime and the
render judge only, `--fused` is gone, and a placement removes a `fine.onnx` an older one
left behind. Nothing else on the page fetched it — `judges.js` was its only reader.

The config's defaults are the pipeline's draw where the page can make one. **Render modes is
the walk's own roster and not the pipeline's** *(walk_faster_ckpt138)* — `smooth`, `tia` and
`threads`, in the Render mode select's own order, handed over by the viewer so the two cannot
drift. It was the thirteen the pipeline accepts with the last five unticked, and what it is
now is the measured answer to "which of those is cheap enough to draw while somebody
watches": see *What a walk costs* under §Measured.

**The group offers the viewer's own list: the thirteen in the Render mode select**
*(Matt, pre_closeout_website_ckpt140, 2026-09-22)*. The three above are still the burst's
roster and Default is still the default; the finish's three are drawn from the thirteen.

- The list is `explorer.js`'s `listedModes()` with no extra — the modes the published
  gallery header names, in the select's order — so the tab and the select cannot drift.
  From `walk_tab_ckpt140` until this ruling it was all seventeen of `explorer/modes.jsonl`,
  on the premise that the head scores a picture whatever mode drew it; `gaussian_int`,
  `trap_circle`, `smooth_trap_circle` and `direct_trap_ring` then came off, because a walk
  finding wallpapers in a mode the viewer does not offer is a walk into a mode no gallery
  holds. `WALK_REFUSES` and `everyMode()` went with them.
- **All seventeen do draw here, and that stays measured.** Every one was put through this
  tab's own `picture()` — the derive pass, a field at 384×216×2, the shade — at a mined
  Mandelbrot frame (6.5e-5) and on the pinned Phoenix slice, and each rendered a picture
  with real structure and emitted a link that parses back. The four are out by ruling, not
  because they fail.
- Two things are true of a **direct trap** here and neither is a refusal. It has no burst,
  which was true before: it composites from the gradient as it iterates, so a recolour of
  one is a re-render and `mine` draws it once instead of sixteen times — a reader who picks
  `direct_trap_lines` gets one picture at a place rather than sixteen, which costs colourings
  and not the mode. And it **paints flat where the orbits never come near the trap**, the
  case `DERIVED` exists for and one the derive pass does not always rescue: over four Phoenix
  frames the four traps gave 428 distinct colours at the home view, 777 at 5e-3, and 4 at
  3.2e-4, where `smooth` gave 915 at that same frame. That is a bad picture at a place — the
  judge scores it near zero and the ranking drops it — and it is exactly what the viewer
  already draws for a reader who picks the mode there.

**Modes and palettes are one radio choice each** *(Matt, explorer_ui_text_ckpt139
addendum 2, 2026-09-21)*. This tab demonstrates how the galleries were made, and a
demonstration is a few radio buttons rather than two checklists of fifteen boxes between
them.

- **Render modes** — *Default*, the roster plus the finish; *Fast render modes only*, `FAST_MODES`, which
  is `smooth` and `tia` and takes no finish; then each of the thirteen on its own, which
  paints every place in that mode and takes no finish either. Fast is
  taken from the mined-width table under §Measured and not from the per-mode one, because
  the two do not order the modes the same way and only one of them was measured where this
  tab draws: a picture is `smooth` 1 046 ms, `tia` 1.10x and `threads` 1.44x at the widths a
  descent reaches, against 1.00, 4.36 and 4.52 at a home view. The line is under 1.25x,
  which is the gap between `tia` and `threads` — and `threads` is the mode `DEAR_MODES`
  already spends sparingly, so Fast is the roster with the dear one taken out.
- **Palettes** — *All palettes*, then each of the twelve colour families
  *(walk_palette_families_ckpt135)*. **All means the 232 maps Random palette draws from,
  never the 1,022** *(Matt)*: most of the library arrived by mechanical conversion, so a
  uniform draw over all of it mostly paints in a map nothing was ever made in. A family
  narrows that set rather than the library, which runs 26 maps (lime) to 78 (orange) and is
  plenty for sixteen recolours drawn with repetition — and it makes All the superset of
  every other choice, which it was not when a family was read off the whole library. The
  per-family map counts are gone from the labels; nobody chose a family by them.

Neither was ever carried in a link or kept in storage, so nothing had to be migrated: the
checkboxes were the whole of the old shape, and `config.modes` and `config.palettes` are
strings now.

**The walk view** *(walk_view_ckpt132)* replaces the viewer's controls while a walk is running
or paused and the viewer is the walk's. Download, Mode, Palette and Details are not on the
page then. They come back when the reader takes the viewer (a pan, a control's key, an opened
Found or Saved picture) or leaves the Walk tab for Gallery or Atlas. Back to the walk, Start
or coming back to the tab puts the walk view back. It is two horizontal strips, *The walk*
above *Current candidates* *(walk_strip_ckpt132; the rule's two words, walk_tab_ckpt140)*,
each scrolling right when it overflows and kept on its newest item. Where the window is short the picture gives up height so both strips are in
sight (`--walk-room` in `explorer.css`); stacked on a phone the page scrolls instead.

**The quarters have fixed colors**, bound to position. They are the same on the picture and
on the strip's cards:

| quarter | name | ink |
|---|---|---|
| upper-left | red | `#d55e00` (Okabe–Ito vermillion) |
| upper-right | blue | `#3d8bff` |
| lower-left | yellow | `#f0e442` (Okabe–Ito yellow) |
| lower-right | pink | `#cc79a7` (Okabe–Ito reddish purple) |

They were chosen by simulating protanopia, deuteranopia and tritanopia (Machado 2009, full
severity) and taking the set whose closest pair is farthest apart in CIE Lab. That pair is
34 apart, and deuteranopia is the tightest case. The obvious red, sky blue, yellow and pink
come to 21. Every box is stroked over a dark under-stroke, so the colors read on light
palettes as well. Only the current rung's four boxes are drawn. A quarter the walk skipped,
because it does not straddle the edge or the screen refused it, is still drawn, dashed and
faded in its color.

**The walk strip** is one card per frame the descent stood in, cleared by a new walk. There is
no text log. A card has, top to bottom:

- the frame's own P≥3, the number the peak rule tracks, to two decimals;
- a thumbnail of the picture the walk judged of that frame, framed as the viewer frames it
  (the frame at 65% of the width, the picture before it dimmed around it) with its four
  quarters boxed in their inks, a skipped one dashed and faded, the chosen one thicker;
- the four quarters' P≥3 as a 2×2 of chips in their positions and inks, *empty* for a skipped
  quarter with the reason in its tooltip, filling in as each is judged, the chosen chip
  outlined;
- one sentence: *root*, *zoom into red*, *past the peak*, *rung cap*, *as deep as it can
  draw*, *dead end*, *dead end · restart*.

The card being worked on is lit, and the leg's best so far carries a *best* mark on the card.
The root search is a words-only card, *Phoenix · searching for a root*, which says *Phoenix ·
root found* while the home frame is up with the root's box on it, becomes the root's card
when the viewer jumps to the root, or says *no root got past the screen* when the plane gives
out. A descent that ends on the rung cap or the arithmetic floor stands in a frame no card has
shown, and that frame gets a card with no quarters. At the descent's end the best card is
outlined, in the found ink when it cleared the bar and dashed when it did not, and its
sentence is the verdict: *peak 0.61 · over the bar*. A Julia twin continues in the same strip
after a slim *Julia twin* divider. A strip that ends without mining **lingers** four seconds
before the next walk clears it; that walk's root search runs meanwhile, out of sight as ever.

The strip replaced one-line rows (`walk_view_ckpt132`), which replaced both the panel's
console (`walk_console_ckpt131`) and a corner widget over the controls (`walk_tune_ckpt131`).
The few things that are not steps of a walk, such as a stopped download, a judge that would
not load, or no plane ticked, go on the status line beside Start.

**The candidates** are the lower strip: one small tile per picture drawn at a place, with
**the map's display name** and Quality, filling in as they are drawn, and the place they are of
(plane and width) on the row's rule, so the row still says whose it is once the strip above
has moved on. The name under a tile is the map rather than the mode *(walk_faster_ckpt138)*
because the burst is one field tried in sixteen colourings, so the mode is the same word
under all sixteen and the map is what tells two of them apart. **A tile that is not the
burst's says its mode as well** — the dear picture, and the finish's three
*(walk_tab_ckpt140)*. It was a `DEAR_MODES` test until the finish arrived and made three more
tiles a reader could not name; it is now simply whether the tile's mode is the one the burst
was drawn in, which is the thing the reader is being shown either way. The kept
ones are outlined in the found ink. They stay in drawing order.
**They outlast the decision.** A place's candidates stay up past the kept tile and through
the start of the next walk, and clear when that walk's first descent ends, so they can still
be compared while the next root is being found. A Julia twin's mining replaces its parent's.

**Which is why the rule over them says whose they are** *(Matt, walk_tab_ckpt140,
2026-09-22)*. The heading reads **Current candidates** while the strip holds the walk in
progress and **Previous candidates** once a new walk has begun and it still holds the
finished one's. The flip is the moment a new walk begins — at the top of `forever`, before
the root search rather than after it, because the search is out of sight and a rule that
waited for it would call a finished walk's candidates current for however long the plane
took to give a root up. It flips back the moment the new walk lands its first candidate,
which is the first moment there is anything current to look at; between the two the strip is
either the old walk's tiles or, once that walk's first descent has ended, the waiting row.

### A slower finish *(Matt, walk_tab_ckpt140, 2026-09-22)*

The label above made the complaint measurable: the strip was flipping to *Previous* while
the reader was still looking at the candidates. There is nothing between a walk's last
candidate and the next walk beginning — the kept picture is held 400 ms and the loop goes
round — so the whole of the Current window is however long the place took to paint, and at
16 colourings of one field that is a couple of seconds.

**The fix is work and not a wait**, on the ruling's own terms: a dwell that held a finished
strip up is the reader waiting on nothing, and what is wanted is more to look at while they
look. So painting a place — the last step of its leg, and of the walk where that leg is the
last — is made the dear one, and it is dear in the way that buys the most, which is Matt's
own second ruling on it: *render modes that can't be done with simple
recoloring*. A colouring re-reads a field the engine already has, which is why fifteen cost
less than one more field and why they are all the same picture underneath; a mode is a
different field, a different quantity read off the same orbit, so three of them are three
pictures of the place rather than three dresses on one.

- **Three modes** (`FINISH_MODES`), each its own field, drawn at random out of everything
  the Render modes group offers and never a mode this place has already been drawn in. They are
  settled before the burst starts, so the row of waiting tiles is the whole of what the
  place will be tried in rather than growing under the reader.
- **At every place, and it was written for the last one only.** The leg loop knows which leg
  is last, so the first cut fired the finish there — and drew none at all over three walks.
  A walk paints one place or two and cannot know which will be its last: the plane leg's
  place is not it when a twin follows, and the twin's leg mines only if its own descent
  clears the bar, which is the minority of them. So every place takes one. It costs a second
  finish on the walks where both legs mine, which is about one in ten over the default set,
  and it never leaves the strip a reader is looking at without one.
- **Each is held `DWELL_MS`**, the rung's own hold, rather than the burst's 150 ms: these
  are seconds apart rather than tenths and they are what the reader is meant to look at.
- **A narrowing narrows this too.** *Fast render modes only* is what a reader picks to see
  more places in the same minute, so it takes no finish; a single named mode is a reader
  asking for that mode, and a finish drawing two others would be the control not meaning
  what it says. Under *Default* the finish is where the other ten modes live, which is what
  makes offering all thirteen worth anything — a reader who never touches the config still
  meets them.
- A finish picture is a candidate like any other: gated, ranked with the rest on Quality,
  and eligible to be the one kept. Its recipe row is `kind: "finish"`, beside `field`,
  `recolour` and `dear`.

What it cost, and what the Current window became, is under *The finish, measured* in
§Measured.

### The walk's activity and its progress *(Matt, walk_tab_ckpt140 addendum 1, 2026-09-22)*

Two indicators, both in the walk panel's head where Start is, and both about the same thing:
the walk is a process and the page said very little about whether it was still going.

- **A spinner beside Back to the walk.** `Back to the walk` is on the page exactly when the
  reader has taken the viewer — a Found or candidate tile is open, or they panned — and the
  walk is carrying on behind the picture they are looking at. Nothing else on the page moves
  then, so a reader could not tell a running walk from a stopped one. The spinner rides with
  that button, so it is on screen in exactly that case. It is one element and one keyframe,
  an arc of a ring turning, `.walk-spinner` in `explorer.css`: no library, on a page that has
  none. Paused, it stays put and stops, dimmed — a stopped indicator beside a Start button is
  a state, and an absent one is no information.
- **A step bar under the buttons**, on the page whether or not the viewer is the walk's.
  **It is a count and not an estimate**: a step is a card in the strip, the walk already
  spends steps out of a budget, and the bar is `spent` over that budget with the reading
  beside it (*7 of 14 steps*). The budget is `STEPS`, frozen at 14, plus `TWIN_RESERVE` from
  the moment a twin leg starts — the one place the total moves, and it moves up, so the bar
  never runs backwards. A new walk resets it. **A walk that ends early completes it**: most
  descents stop on a peak with steps still in hand, and a bar abandoned at two-thirds would
  read as a walk that failed, where what the bar measures is the walk and not the budget. It
  stays up while the walk is paused, dimmed, so a reader can see where it stopped.
- **Neither honours a reduced-motion setting, because the site has none.** The ruling says
  to respect one if the site already does; `prefers-reduced-motion` appears nowhere in this
  repository, and adding the site's first one for a 0.85 rem spinner would be deciding a
  site-wide convention inside a tab. It is written down here so that whoever adds the
  convention knows this is one of the places that wants it.

**Where it is not the pipeline, said once.**

- The descent is greedy on the render judge's P≥3. The sampler is exhaustive, and the
  pipeline's walk scores with the location head, which is not shipped to a browser.
- The judges read the canvas, where the pipeline reads a JPEG-decoded picture.
- The palette is drawn uniformly from the maps the checked colour families hold, where the
  pipeline uses a palette head or a codebook stratifier. A family's maps are the ones that
  have made that colour often — see *Every colormap* below — so the config conditions what
  a place is painted in and never what the walk is willing to keep.
- The bar is P≥3 at 0.50 on the smooth picture. The pipeline's release gate is P≥4 at 0.50
  on a colored one, and P≥3 at 0.50 is only its fallback for a thin mode. The config's
  tooltip says so.
- The pipeline keeps every recipe it draws and lets the solve choose. The tab keeps the
  best.

**The walk's two pools are the tab's for as long as the document is**, started at Start
and terminated on `pagehide` (*Every pool is given back*, below). A walk that is merely
paused keeps them: the reader is expected back.

**Two renderers.** The walk draws through a second `Renderer` over the same compiled module
(`Renderer.over`), with a pool of `min(4, cores/3)` workers. The viewer's renderer runs one
job at a time and cancels the last, so sharing it would mean the walk cancelling the
reader's picture, and every pan cancelling the walk. The screen runs on two workers of its
own, because the battery iterates on whichever thread calls it.

**Both pools were widened and both were put back** *(walk_faster_ckpt138)*. On twelve cores
six sit idle through a rung, so a pool of `min(6, cores/2)` and four screeners looked free —
and measured over eight walks a side on one plane they bought **1.08x on a judged picture
and 1.16x on a screen**, inside this machine's drift, with the p10 and p90 of both unmoved.
A 640×360 frame is not waiting on a worker: it is 230,400 samples cut into bands with a
floor of eight rows, and the per-band message is already a large share of it. What a rung
costs is the arithmetic. So the pools are what they were, and the cost of the other way — a
detached walk competing harder with the reader's own renderer — is not paid for nothing.

**The screen is the engine's.** `engine-wasm`'s `screen` export is
`screen::Battery::screen` at its defaults, run on the 384×216 node frame at the policy cap
and coloured through `twilight_shifted` for the occupancy floor. It is the pipeline's
battery, all five gates, with no JavaScript re-statement of any of them. The probe's
maxiter of 256 is the spec's optional `maxiter`. That is a probe-only knob: the link
contract has no key for it and nothing a link opens sets it.

**The judges.**

- Both are the judges lab's `fp16w` exports: fp16 weights and fp32 compute. The render
  judge (gate) reads `[P≥2, P≥3, P≥4]`.
- **Recipes are ranked on the number they are shown with** *(saved_tab_ckpt131_addendum1)*.
  That is the render judge's P≥4, which is what the found tile's badge and the
  candidate tiles show — **as `Quality 0.15`** since *walk_tab_ckpt140*, the number and its
  meaning unchanged and the pipeline's notation gone. The badge's
  tooltip reads *how likely a person is to rate this 4 or 5*. It is the default because a
  displayed number and a ranking number that disagree make a kept tile read as a mistake:
  under the old default the walk could keep a picture badged lower than one it had just
  passed over.
- **The walk scores with the render judge, which is what the pipeline's walk does**
  *(pre_closeout_website_ckpt140)*. The fine head — seed 0 of the solve's three, an opt-in
  tick until `explorer_controls_ckpt140` froze it off — is cut from the code and no longer
  shipped.
- It runs in `onnxruntime-web` 1.30's default bundle. Its WebGPU backend is JSEP, the
  runtime the lab's fidelity table was taken on. It uses WebGPU where `navigator.gpu` hands
  back an adapter, and single-threaded WASM otherwise.
- Every picture goes through `resize.mjs` to 384×224 and in as [0, 1]. Normalization is
  inside the graph.
- The runtime and the gate download on the first Start. Opening the tab loads only its three modules, about 19 KB.
- **On the wire the runtime is 6.7 MB, not 28 MB.** Pages gzips everything but images, and
  the runtime's wasm compresses about fourfold. The model barely does (5.1 MB to 4.7 MB).
- **A download says what it is and stops when the walk does** *(explorer_slim_ckpt131)*.
  The status line under the button names the file and counts megabytes, and gives a total
  only where the response is not gzipped: a gzipped response's length is the compressed
  length. The button reads Pause while a download runs. Pressing it, hiding the tab, or
  switching to Gallery or Atlas aborts the fetch and releases any session still being
  made, and the status line says so. A file that had fully arrived and a session
  that was made are kept, so the next Start does not download them again.
- **A gzipped response broke the download until this change.** `fetchBytes` sized its
  buffer from `content-length`, which under Pages is the gzipped length, so the runtime
  overflowed a buffer a quarter of its size and the judges never loaded. The walk then ran
  on coin flips and said only that no judge could load. This was never seen locally,
  because `python -m builder serve` did not gzip. It does now *(preclose_site_ckpt131)*:
  every text type, the wasm and `application/octet-stream` at level 6 with the compressed
  `content-length`, as Pages does, so a local walk takes the deployed load path.
- Where the runtime cannot load, the walk runs on the screen alone, picks among survivors
  at random, and says so on its status line.

**The assets are untracked.** `explorer/judges/` is named in `.git/info/exclude` and filled
by

```
python -m builder walk                      # from tools/judges-lab
```

**The lab is `tools/judges-lab/`** *(walk_tune_ckpt131)*. Its export script, the frozen
model definitions and preprocessing spec in `lab/judges.py`, the fidelity and retime
scripts, its measurements and `REPORT.md` are tracked there. Its torch venv, npm packages,
weights, exports and samples sit beside them, untracked. Its README says how to set it up
from nothing. It used to be a checkout of its own beside this one, `fractal-judges-lab`,
which is gone.

That copies about 34 MB:

- `render.fp16w.onnx` (5.1 MB), from the lab's `models/`. A `fine.onnx` an older placement
  left is removed.
- `ort.min.mjs` and the JSEP glue and binary (28.3 MB), from its `node_modules`.

Until Matt says deploy, Pages serves a Walk tab that runs on the screen alone.

**Nothing persists unless it is saved.** A found tile is a blob URL and a permalink that
writes the weight or opacity in force. Clicking one opens it through `openLink` and detaches
the viewer, and the walk carries on. A reload forgets them all, except the ones saved by
their mark, which go to the Saved tab below. **One tile at a time is the whole of it**
*(Matt, explorer_controls_ckpt140)*: *Save all found* at the head of the list is gone, and so
is the tally that stood under it — the tiles are the count, and they are in front of the
reader. `#walk-note` survives as the slot `explorer.js` writes *The walk could not be loaded.*
into, and is empty otherwise.

## Deep *(build_deep_tab_ckpt135, 2026-09-19; the Julia case deep_julia_at_c_ckpt136, 2026-09-20)*

The fourth tab draws `z² + c` **below the `f64` floor**, through `perturb.wasm` rather than
`engine.wasm`. It is a deliberate, rare, slower mode and everything about its shape follows
from that.

**What it draws:** `z^d + c` for integer degrees two to six in `smooth`, on both of the
planes each degree has — the Mandelbrot or Multibrot set, and the Julia set of any `c`
*(degrees three to six since deep_degrees_ckpt140, 2026-09-22)*. No mode picker and no
family picker: there is one mode down here, the degree comes in with the view a reader
carries over or the link they open, and the two sets of a degree are one recurrence read two
ways rather than two families, which is what *Julia at this c* below is about. Fractional
degrees and Phoenix are not drawn: `audit_deep_families_ckpt140` found perturbation fails on
exactly the branch-cut seam the fractional family exists to show, and Phoenix needs a second
delta lane. The tab's side note says which families it draws. Palette, the seven shade keys and
Autolevel work exactly as they do everywhere else, because a deep field **is** a smooth
field: one `f64` a sample with `NaN` for the interior, in the layout `compute_band`
produces, so `shade_level` colours it without being told which kernel drew it.

**The ordinary explorer is not slower, heavier or different for it.** `perturb.wasm` and the
tab's four modules are fetched on the tab's first open and never before, the Walk tab's
pattern. `engine.wasm` is byte-identical — the Shading branch the prompt allowed was not
needed, and `engine.manifest.json` is unmoved. The shallow permalink did not move: `VERSION`
is 3, `READS` is `[1, 2, 3]`, the unknown-key sweep is unchanged and the cap is still not a
key. Two functions of `permalink.js` are newly **exported** — `encode` and `encodeCurve` —
and nothing about what a link means changed with them.

### The centre is exact, and that is the whole of the arithmetic

`deep-fx.js` holds a coordinate as `{ units: BigInt, scale }`, meaning `units × 10⁻ˢᶜᵃˡᵉ`.
Decimal rather than binary because the thing being held is a decimal *string*: what a link
carries, what a reader pastes, and what the kernel's `Fx::parse` reads on the other side of
the boundary. Every pan and zoom is an exact addition; nothing routes a deep coordinate
through `coordinateOf`, `shortest` or any other `f64` re-spelling.

**The one place a double is allowed in is the size of a step.** A gesture is measured off
the canvas as a fraction of the view's width, and the width is an `f64`, so the increment
arrives as a double and `fromNumber` turns it into the shortest decimal that reads back as
that double. That decimal is then added exactly. So a step is a double and a *place* is a
decimal, and the seam is named rather than hidden. Measured: a thousand additions of 1e-30
land on exactly the same digits as one addition of 1e-27, and the scale does not ratchet,
because `make` trims trailing zeros.

`MAX_SCALE` is 120 fraction digits — a guard against a number that can be made to cost
`BigInt` time by scrolling, not a precision limit; the digit count is bounded by how deep
the reader has gone and grows by decades rather than by gestures. The link's own limit
binds first: a plain decimal at about 1e-45 reaches the shallow contract's 64-character
`COORDINATE_LIMIT`, and past that the link says so rather than truncating.

### The render controls are under the picture *(deep_ui_ckpt140, 2026-09-21)*

Render, Cancel, the render bar, the activity line and **Auto-render** are a control group of
their own in the right pane, first under the canvas and above Download, shown only while
this tab owns the viewer. They were in the left panel until Matt used the tab and said
otherwise, and the reason is what a reader is looking at: pressing Render is watching the
picture, and the wait and the way to stop it belong where the eye already is.

**Where the frame is lives in a Details fold under the picture** *(Matt,
deep_tab_activity_and_layout_ckpt141)*, the shallow Details' shape, shown only while this
tab owns the viewer (the shallow one is hidden then): the render stat line — the last pass,
its time, the cap it drew at, the orbit, and *at the ceiling: x% undecided* where the probe
ran out of ceiling on this frame — then the set and its degree, `c` for a Julia view, `x`,
`y` and `width` in boxes a reader can retype, and the cap with where it came from (*from the
width*, *settled by the probe*, *yours*, *the minibrot's own*). A retyped box goes the
shallow `retype`'s long way round: the view is emitted, one key replaced, and the string
parsed back by the deep contract, so a typed coordinate is read and refused exactly as a
link's would be. The **FRAME block that sat at the top of the left panel is gone**, and so
is the stat line's old home: the tab used to write it into the shallow `#stats`, which is
hidden on this tab, so nobody had ever seen it.

**And every other control followed them** *(Matt, deep_caption_and_controls_right_ckpt141,
2026-09-22)*. The rule is the studio's: the left side changes which view is up, and the
right side works on the one that is. So Iterations (Halve, the cap, Double, From the width),
Julia at this c, Nearby minibrots, Save and Back to the explorer are under the picture too,
in the Render group, in the order the shallow view keeps its rows: the Render line, then one
row of view buttons, then Iterations, then Download. The minibrots list opens straight under
the row that holds its button, where the column is wide enough for four across rather than
two. Keys did not move. The left panel keeps the tab's one sentence and nothing else.

**And a sentence pointing back into the article** *(Matt, walk_tab_ckpt140 addendum 1,
2026-09-22)*, on the end of that same line: *The writeup explains how deep frames are
rendered: [Escape-time fractals].*

⚠ **It is a stand-in, and it says so here so it gets retargeted.** The section that owns
this material is §Deep zoom, which is one of the two unwritten sections —
`article/deep-zoom.html` exists and holds the slug, but its body reads *Not written yet*, so
pointing a sentence that promises an explanation at it would be a promise the page does not
keep. The anchor in force is **`../article/escape-time-fractals.html#locations`**, which is
the nearest written prose that owns any of it: §Locations is where the article states that
ordinary double precision gives out at magnifications around ten trillion to one, and where
it hands the rest to deep zoom. **When §Deep zoom is written, this href moves to
`../article/deep-zoom.html`** and the sentence is left alone.

### Rendering, and what starts on its own

**A gesture never draws the frame it lands on by itself.** It slides and scales the last
picture as a stale bitmap — `preview(dx, dy, scale)`'s job, done through a `compose`
callback so the tab can put a box over it — and draws the **pending frame** as an outline.
While something is pending the canvas shows the pending frame widened to 65%, which is the
walk's framing and the walk's reason: at that framing a box drawn inside the picture reads
as a box rather than as the edge of the canvas. The stale picture is dimmed to 0.55, the
walk's backdrop, because dim says *old* without hiding it.

**Then `autoRender` decides what follows.** Ticked, which is what entering the tab gives,
a frame change that has settled for 350 ms **cancels whatever is in flight** and draws the
new frame: the quarter-resolution field, then the full one at one sample a pixel, and no
further. Every route into a new frame goes through it — a drag, a wheel notch, a cap
change, *Julia at this c* and its way back, a *Nearby minibrots* pick, and a deep link
opened from Saved or the address bar. Unticked, the tab is press-to-render, and the only
thing that starts by itself is the quarter pass, and only **if the previous quarter pass
came back under `AUTO_PREVIEW_MS`** — provisional at 1.5 s.

**An auto pass never runs the cap probe** *(deep_tab_activity_and_layout_ckpt141)*. It
draws at the width's own cap with no escalation; only an explicit Render (and a download)
probes. The reason is that the probe is not covered by the `AUTO_PREVIEW_MS` guard, which
times the quarter *field* and nothing before it: the probe is a reference orbit and 2,304
cells per rung, doubling to the 1,000,000 ceiling, and on a frame beside a parabolic point
— where the escape count grows like one over the square root of the distance — every rung
is short of enough and the walk runs to the ceiling. A drag was enough to start that. A
link opened is drawn the same way, at the cap it names (pinned) or at the width's; Render is
what asks whether the frame wants more.

The flag is the tab's own `sessionStorage`, the Julia preview's pattern and its reason: it
is a way of working rather than part of a picture, so no link carries it and the browser
does not keep it past the tab. The box is beside Render.

**A progress line names the stage and the percentage, and the time left comes from the
bands this pass has already finished** and from nothing else — a deep frame's cost swings
over orders of magnitude with how much of it is interior, so the only honest predictor of
the rest of this frame is the part already drawn.

**A pass that started on its own does not take the Render button.** It is a pass the reader
did not ask for, so turning Render into Cancel while it runs would put the tab's one
control out of reach at exactly the moment it is wanted. Cancel appears for a pass somebody
commanded; pressing Render through one that started on its own upgrades it, and picks the
quarter field straight back out of the cache if it had finished.

**A download is the one thing a frame change does not cancel.** It is a file the reader
asked for, of a frame captured when they asked. Nothing reaches that guard today — a
download holds the viewer through `setBusy`, so a wheel is refused before it gets to the
tab and every control that moves the frame is disabled while one runs — and it is there so
that a control which opens that route later does not quietly become a way to lose one.

### Why the fast preview looked as though it never came

The staging was never the bug, and it was worth measuring before changing anything: a 1×
pass **is** run first and **is** put on the canvas the moment it lands, each finer pass
replacing it in place. Photographed on the committed `tangle 1e-22` frame, one wheel notch
in, Render pressed — quarter pass up at **3.2 s**, full at **47.6 s**, four samples a pixel
at **236.1 s**.

What was wrong is that a gesture during a committed render moved `view` and cancelled
nothing, and then `moved()` bailed out of starting anything on `running !== null`. So the
pass ran on for minutes on the frame the reader had left, drawing itself dimmed inside the
pending box, no pass of the new frame was started, and the tab said nothing about any of
it. Reproduced: Render at 1e-22, a notch at 20.4 s, and the canvas held the abandoned
frame for the remaining **~3.5 minutes** of `four samples a pixel`. After the fix, the same
notch cancels the pass and the new frame's quarter picture is up **6.2 s** later.

Two things came out of it besides the cancel. The tab now says, where auto-render is off
and a committed pass is drawing a frame the reader has moved off, *This is still drawing
the frame you left* — it named Cancel and not Render because through a committed pass
Render **is** Cancel. And the `full resolution 100%` line no longer arrives followed by
minutes of silence at the entry setting, because at one sample a pixel that is the end.

### The screen is one sample a pixel, and samples are the Download row's *(Matt, deep_tab_activity_and_layout_ckpt141)*

The tab used to end every committed pass at `FINAL_SUPERSAMPLE` — four samples a pixel,
copied from `explorer.js` — and then, from `deep_ui_ckpt140`, at one sample a pixel with a
`1× / 4× / 16×` picker beside Render. **The picker is gone and the screen is one sample a
pixel, always**: the quarter pass, then the full pass, and no third stage. A finer picture
of a deep frame is minutes, and minutes spent on the screen are minutes nobody can keep; a
file is where more samples are worth having, so the Download row's own `1× / 4× / 16×` is
the only place they are chosen, 16× still refused by its ceiling. Render over an auto pass
now buys one thing, the cap probe. No `explorer.deep-*` setting ever held the samples — the
choice was a per-visit variable reset by `enter` — so there was no stored key to delete, and
nothing in a `dv` link ever carried it.

The Download row still asks the tab how many samples the picture on the canvas holds rather
than assuming, so *As shown* at 1× is `ready` and at 4× draws.

### The Render line says what the tab is doing *(deep_tab_activity_and_layout_ckpt141)*

**The frame that motivated it**, `?dv=3&x=-0.7496032252489404457405605910029&y=0.0944858831962337079727787133191&w=2.82515203644319e-13&n=55926&p=cmr.redshift&mirror=1&panel=deep`
— `c ≈ −0.75 + 0.09i`, beside the parabolic point — sat on *choosing an iteration cap ·
55,926* for minutes. **It was a stranded pool, not a slow probe.** Measured in node on the
committed module: the reference orbit there escapes at 9,538 points in 7 ms, and the first
rung of the probe resolves the frame — 2,304 of 2,304 cells escaped, no fault — in 0.1 s on
one thread. The line is what `onRung` wrote after that rung, and it stays until the first
band reports, so the full pass never started. The mechanism was the pool's: `cancel()` bumped
the generation and left every in-flight worker off the `idle` list, and the probe and orbit
round trips swapped each worker's `onmessage` for their own — so a band finishing after a
cancel landed in the probe's handler, was ignored for being the wrong kind, and its worker
was never idle again. Three wheel notches during full passes stranded all of them, `field()`
dispatched to an empty list, and its promise never settled. Reproduced over CDP on the old
code exactly that way — *choosing an iteration cap · 57,377*, forever, with Render reading
*Render* because the pass had started on its own — and the same script finishes every pass
on the new one.

**The pool** (`deep-render.js`) now keeps one request per worker, matched by id: a worker
is idle exactly when it has none outstanding, the one handler it ever has is installed when
it is born, and a reply to a request nobody is waiting for any more frees the worker and is
dropped. A stale probe reply can no longer be read as a new rung, which the old kind-only
match allowed. **The reference orbit is computed in a worker**, never on the page's thread,
where a cap of a million froze the page for as long as it took: the first worker computes it
and keeps it, and the bytes it hands back feed the others lazily.

**Every stage reports, at most every 100 ms.** `perturb.wasm` has one import now,
`env.progress(done, total)`, called every 4,096 iterations of a reference orbit and once a
cell of a probe or domain-walk share (`perturb-wasm/src/progress.rs`); the worker throttles
it to a message every 100 ms, and the page's own planner instance supplies a function that
does nothing. The line says which: *choosing an iteration cap · trying 111,852 (rung 2) ·
1,152 of 2,304 cells*, *full resolution · reference orbit 40,960 of 330,708*, *full
resolution 40% · about 3 s left* from the bands as before. A spinner is up whenever a worker
stage is live, and the bar beside Cancel fills with it — the Download row keeps a price in
plain text (*~4 s*, *not priced yet*) and no bar, and a file render fills this bar under the
label *file*. **What the hook costs**: every deep field, probe count and orbit at four frames
(the test frame, a 1e-22 seahorse, a degree-3 and a Julia frame) came back byte for byte
what the module before it produced, and the four took 10.82 s against 10.83 s.

**The watchdog.** Once a second while a worker stage runs, the tab reads how long since the
pool last said anything — any reply, any progress message — against the stage's own start.
Past **10 s** the line reads *… · no progress for N s*, counting, in the warning ink, and
Render becomes Cancel even for a pass that started on its own. A live frame reports ten
times a second, so a pool that is silent for a hundred times that is not a slow frame.

**Cancel cancels everything.** A wasm call cannot be interrupted, and the orbit and the
probe are the long ones, so `cancel()` terminates every worker with a request in flight and
starts a fresh one from the module already compiled; it is fed the held orbit again the next
time it needs it. The page is idle when Cancel returns, whatever was running.

**A log, off by default.** `localStorage.setItem("explorer.deep-log", "1")` in the console
turns it on from the next pass (`removeItem` to stop): every stage the tab enters, every
worker message, every rung, the watchdog's ticks, each with an ISO timestamp and the frame's
`dv` link. Off, it costs one `localStorage` read a pass and nothing else — the pool's message
hook is left `null`.

### Julia at this c *(deep_julia_at_c_ckpt136, 2026-09-20)*

A button in the Deep tab takes the current view's centre as `c` and opens **the Julia set
of `z² + c`**, centred at `z = c`, at the same width and the same cap. *Back to the
Mandelbrot set* returns to the frame it was pressed on. From there the Julia view pans,
zooms and renders exactly as the tab already did.

**`j` presses it, and it wears `(j)`** *(Matt, pre_closeout_website_ckpt140)*, in both of its
states. While Deep owns the viewer the key goes to `deep.pressJulia()`, which clicks this
button and does nothing where it is disabled; it used to fall through to the shallow
viewer's Julia here, which flipped a view nobody could see.

**Why this view is only possible here.** Near `z = c` the Julia set of a deep `c` looks
like the Mandelbrot set near `c` at the same scale — so the filigree around a deep minibrot
reappears, but filling the frame homogeneously with no minibrot in the middle. A shallow
Julia view cannot show it: an `f64` `c` does not carry the digits, and a view wide enough
for `f64` could not see them.

**The kernel change is small, and that is the finding rather than a boast.** The stored
reference orbit is `Z₀ = 0, Z₁ = c, Z₂ = c² + c, …`, the critical orbit of `c` — which is
*simultaneously* the Julia orbit of `z = 0` and, shifted by one index, the Julia orbit of
`z = c`. So a Julia frame is drawn from the orbit a Mandelbrot frame at that `c` already
computes, the recurrence loses its `dc` term and gains a starting delta, and rebasing is
untouched and still exact — `δ := z` works because `Z₀ = 0`, with no subtraction and so no
cancellation. `perturb-wasm/README.md` has the arithmetic and the proof.

**Two anchors, and the link carries neither.** A frame measures its offset from `z = c` or
from `z = 0`, whichever is nearer; both are points of the stored orbit, both offsets are
exact, and the choice changes only how much of the pixel step survives into the `f64`
delta. It is derived from the view because it is a precision fact rather than a picture
fact — a link that carried it would carry a decision nobody made, and one that went stale
the moment the reader panned. Where neither anchor can resolve the frame, the tab says so
before the reader presses anything, in the module's own words: the offset's last bit is
coarser than a pixel, so every sample would start from the same delta and the picture would
be flat. That wall is far out — an offset of 0.76 still leaves 375 numbers to a pixel at
2e-11 — and only bites below about 3e-13, which is exactly where the second anchor earns
its keep.

**Same view at z = 0** is the other button, and **it widens the frame to the square root of
its width** — the `d`-th root of its half-width at degree `d`, `2·(w/2)^{1/d}`, because
`z^d` maps the disc of radius `r` onto radius `r^d`, `d` to one. `z ↦ z² + c` maps the disc of radius `r` about 0 onto the disc of radius `r²`
about `c`, two to one, so the structure at `z = c` at 2e-9 is the structure at `z = 0` at
6e-5 — the same picture, with exact two-fold symmetry, in a frame four decades wider. The
first version of this button kept the width and drew a black rectangle, which is what sent
it through the arithmetic: a frame 2e-9 across at the critical point of a nucleus `c` is
deep inside the basin of the attracting cycle and every sample of it is interior. The cap
is deliberately not re-derived from the new width, because the two frames' escape counts
differ by exactly one step and the cap that drew one draws the other.

**Getting back out is refused for a second reason now**, and it is the more surprising one.
*Back to the explorer* already refused a frame below what `f64` resolves; a deep Julia view
can also have a `c` with more digits than a double carries, and that frame would draw
perfectly well next door — as **a different set, under this one's name**. So the parameter
is checked against a double by value, and the refusal says which of the two is in force.

**What it cost to press the button**, measured on 221×124 at one thread, 2026-09-20: the
orbit is recomputed, at 18 to 25 ms, because a view entered at `Z₁` asks for one point more
than a Mandelbrot frame's; every other point of it is one that frame already had. A Julia
frame against the Mandelbrot frame at the same `c`, width and cap ran 1.01×, 1.67× and
0.32× at 2e-9, 2e-10 and 2e-11 — a ratio that swings with how much of each frame is
interior and says nothing about the loop. With the work held equal instead — a cap no
sample escapes, the interior switch off — **the Julia loop is 4.07 ns a sample-iteration
against the Mandelbrot loop's 5.08**, which is the two additions it does not do.

### The reference orbit, and the pool

**One high-precision orbit per frame, computed in one worker and held in each of them**
*(computed on the main thread until deep_tab_activity_and_layout_ckpt141)*. It is a couple
of megabytes of `f64` pairs and every sample of every band reads it, so a band call that
computed its own would compute it some fifty times a frame. `deep-worker.js` computes it on a
`reference` request and keeps it, takes an `orbit` message on the others and keeps the
buffer in its own heap, and every `band` after it uses the one that is there; a frame whose
orbit is still good sends none, and a worker restarted by a cancel is fed it again.

**It is kept while the new view is still within its reach**, and the test is conservative
on purpose: the same limb count, a cap no larger, and the reference still inside the frame
being drawn. The limb count is the one `plan` names for the frame, not the width's *(deep_degrees_ckpt140)*:
a Julia frame at `z = 0` is computed at twice the view's bits, and an orbit keyed on the width's count
would pass this test for a frame it is too shallow for. Recomputing costs fifteen to twenty-five milliseconds against a frame of
seconds, so there is nothing to buy by being clever — and the gesture it does keep it for is
the one that matters, a zoom in about a point near the middle, so a descent pays for one
orbit rather than one a rung. At the anchor the orbit is **48,552 points at three limbs**,
**776,848 bytes** on the boundary — `16 + 16·count`, `pack_reference`'s own layout, sixteen
a point rather than the twelve the pairs need so that they land `f64` aligned.

**Bands are cut to the explorer's own `BAND_TARGET_MS`, and the opening cut is two rows.**
A cancel costs one band, so a band is how long the tab can ignore the reader; the viewer's
four-bands-to-a-worker is right when a frame is a second and wrong when it is a minute. Two
rows is certainly too fine and costs a few messages to find that out — the first band to
report replaces the guess with a measurement and everything still queued is re-cut. Erring
fine is the cheap direction.

### Shading, through `engine.wasm`, on a placeholder viewport — and a placeholder family

The shade spec names the Mandelbrot **home** view, because `engine.wasm` refuses any spec
whose viewport `f64` cannot resolve and a deep viewport is exactly one of those. What makes
that sound rather than a shortcut is that the colouring never reads it: `colour` takes
`sample_width`, `sample_height`, `out_width`, `out_height` and `supersample` off the
viewport and nothing else, because a percentile stretch is a statement about the numbers in
the buffer and not about where they were taken.

**That is measured rather than argued.** `deep.test.mjs` shades one deep lane buffer under
two different f64-resolvable viewports — the placeholder, and a frame somewhere else
entirely — and asserts the two pictures are **byte for byte the same**. There is no "shade
it the real way" to compare against, so two viewports over one buffer is the comparison
available, and a colouring that read either of them would fail it. So no viewport-free
shade entry was added to `engine-wasm` and the module was not rebuilt.

**The family is a placeholder in the same way** *(deep_degrees_ckpt140)*: the shade spec says
`mandelbrot` whatever degree drew the lanes, and `deep.test.mjs` shades one degree-5 buffer
under that, under `multibrot` at degree 5 and under a degree-3 Julia family, and holds the
three pictures to being byte for byte the same, through `shade` and through `shade_level`.

**A deep lane is not narrowed through `f32`**, where the engine narrows every inexact lane
on the way out. At this depth that rounding is visible — the `f32` step at a smooth count of
65,000 is about 0.008 — and the stretch downstream would band on it.

### The field is kept, so a recolour never re-iterates

Three fields: the current view's two stages and one field back, keyed on the centre, the
width, the cap and the grid — never on the palette or the seven, because nothing on the
colour side can move a sample. **The arithmetic of that:** at a 1136×636 canvas the quarter
pass is 0.4 MB and the full pass 5.8 MB, so a view is 6.2 MB held. The viewer keeps six
because its fields are cheap to recompute; here a field is the most expensive thing on the
page. A recolour walks back from the full pass to the cheapest stage that is here.

### Iterations, and the cap a frame asks for *(deep_cap_policy_ckpt138, 2026-09-20)*

The cap opens at the kernel's own answer for the width — the engine's shape with the
engine's ceiling lifted to a million, so 48,551 at 2e-11 and 117,518 at 1e-28 where
`maxiter::for_width` would flatten both to 67,000. **Halve** and **Double** move it, and a
reader who has moved it has pinned it: a zoom then leaves it alone until *From the width*
gives it back. **The cap in force is part of the view once it is settled**, which is why
the deep link carries it then and only then — see the next list and §Deep links.

**But the width's answer is where a Render starts rather than what it draws at.** Below
about 1e-22 that cap lands *inside* the frame's own escape-count distribution: a sixth to a
third of a busy frame runs out of iterations and is painted as interior when it was exterior
all along, and nothing on the page looks wrong. So a Render **probes the frame first** —
2,304 of its own sample cells, cut across the pool like a band — and doubles the cap while
samples are still dying at it with `|dz|` grown past the escape radius, under the same
1,000,000 ceiling.

The rule, its threshold and the thirteen frames it was measured on are
`perturb-wasm/README.md` §8; what is here is what the tab does with it.

- **Deciding costs 0.08% to 0.22% of the fine pass**, so the full pass runs once, at the
  settled cap. The probe is a subset of the frame — its cells, its limbs, its geometry, its
  orbit — and not a smaller picture of it.
- **Only an explicit Render or a download probes** *(ckpt141)*; an auto pass and an opened
  link draw at the cap they have. See *Rendering, and what starts on its own*.
- **The activity line says so** while it runs, naming the cap it is trying, the rung, and
  the orbit's iterations or the probe's cells, and **the cap box and the address bar move
  once, when the probe has settled** *(ckpt141)*. Before that the view's `capFrom` is
  `"width"` and the address carries no `n` at all. It used to carry the width's cap from the
  moment a gesture landed, and a link-carried cap opens pinned — so a link copied mid-probe
  drew the frame at the un-escalated cap forever after, with no notice. Verified over CDP on
  the committed `tangle 1e-40` opened with no `n`: throughout the probe the address had no
  `n` and the box read 165,354; the settled 330,708 reached both at once, with *Raised the
  cap to 330,708: at 165,354, 25% of this frame was still escaping*.
- **A pinned cap is drawn as pinned.** Escalation is the *policy*, so it runs where the
  width's answer is in force and nowhere else: a cap a reader typed, and a cap a link
  carries, are drawn exactly as asked. That distinction already existed as the zoom's, and
  no control was added for it.
- **Where the cap moved, the page says why** — *Raised the cap to 187,200: at 93,600, the
  width's own answer, 30% of this frame was still escaping when the count ran out and would
  have been painted as set.* Where the width's answer already drew the frame it says
  nothing, which is the honest thing and is what every shallow view and six of the thirteen
  measured frames get.
- **And a frame can run out of ceiling.** At `cap::CEILING` — 1,000,000 — with more than
  `FAULT_SHARE` of the probe still undecided, Details' stat line ends *at the ceiling: 14%
  undecided* *(ckpt141; it was a sentence under the canvas, in the raise's shape, from Matt,
  pre_closeout_website_ckpt140)*, beside the pass it is a fact about and only while the
  frame is that frame. The limit itself is unchanged, there is no control for it and no
  retry: the clause is the answer.

### Nearby minibrots *(deep_nearby_minibrots_ckpt138, 2026-09-20)*

One button, on the parameter plane only, at every degree the tab draws *(degrees three to six since
deep_degrees_ckpt140, each against a measured pin — `perturb-wasm/README.md` §10)*. It searches the current view for the minibrots in and around
it and fills an **ephemeral list** under the Frame block: nothing is stored, nothing
reaches Saved, and no entry has a link contract of its own — an entry's target is an
ordinary `dv` frame, which is why clicking one is a navigation like any other and the way
back returns from it. The next search clears the list, and so does any gesture.

**Three phases, and only the last one streams.** The atom-domain walk goes over the pool in
bands the way the cap policy's probe does; the Newton solves go over the pool too, one seed
to a worker, because a Newton step reads no reference orbit and so any worker can take any
step of any seed. Only once every solve is in can the list be *ranked* — largest first is
what the reader is promised — so the tiles are drawn after that, one at a time. Drawing is
serial and has to be: the pool holds one reference orbit between all its workers and every
tile wants a different one. That is also why the view's own orbit is gone afterwards and
the next Render recomputes it, which is twenty milliseconds.

`perturb-wasm/README.md` §9 is the arithmetic and the measurements. Three things about it
shape what this tab can offer, and the third is the reason the list looks the way it does.

- **The size that ranks and frames is the minibrot's body**, which is the *square* of the
  atom domain `1/|A|` over an `O(1)` correction — on the audit's anchor, 9.75e-6 against a
  body of 6.478e-12. A tile framed on the domain would put its minibrot in it at a
  millionth of the frame.
- **A `dv` centre is 64 characters**, and a minibrot found in a view at 1e-n sits near
  1e-2n — near 1e-(d/(d−1))n at degree `d`, so 1e-1.5n at three and 1e-1.2n at six, which
  puts the link wall deeper there — so below about a 1e-30 view the entries are places this site can find and cannot
  spell a link to. They are **listed anyway, greyed, and the footer counts them** — the
  link contract does not move for this, and the honest thing is to say what is there.
- ⚠ **A tile's cap is eight periods of its own nucleus, and that is expensive.** At the
  *width's* cap a deep minibrot's tile is 100% unresolved — a flat black rectangle — because
  the width policy at a tile's width gives about one and a half periods of it. Eight
  resolves it, and the periods at these depths run to six figures, so a tile at 1e-22 is
  about **fifty seconds** where the anchor's at 2e-11 is **one**.

So a tile is drawn on its own only while it is estimated under five seconds, which is
`AUTO_PREVIEW_MS`'s ruling applied to a second place: nothing expensive starts unasked. An
entry over the budget is still a full entry — it names its minibrot's period and body, says
what a preview would cost, and **goes to the frame when clicked**, which is what the list is
for. The picture is the preview, not the point. In practice tiles draw from about 2e-11
down to the low 1e-14s and the deeper frames give a list without pictures.

| view | nuclei found | link-reachable | biggest tile |
|---|--:|--:|--:|
| anchor 2e-11 | 36 domains, 6 kept | 6 of 6 | period 2,838 · **1 s** |
| tangle 1e-22 | 17 domains, 6 kept | 6 of 6 | period 94,776 · 50 s |
| tangle 1e-28 | 37 domains, 6 kept | 6 of 6 | period 100,617 · 56 s |
| pinch 1e-28 | 16 domains, 6 kept | 2 of 6 | period 107,349 · 61 s |
| tangle 1e-40 | 18 domains, 6 kept | **0 of 6** | past the ceiling: 100% interior |
| tangle 1e-54 | 29 domains, 6 kept | **0 of 6** | past the ceiling: 100% interior |

⚠ **That table was measured at each view's settled cap, and the tab was searching at the
view's own** *(pre_closeout_ckpt138, 2026-09-20)*. Opening the committed `tangle 1e-22`
link and pressing the button listed **3** of those 6. It is not a detection resolution, a
dedupe or a ranking problem and it is not the "body already fills the view" exclusion —
those bodies are fourteen decades under the frame. A nucleus is detected by the **index of
the smallest `|z|` the orbit reaches**, and an index can never exceed the cap the walk was
given: past the cap a nucleus is not missed, it is undetectable, and the cells that would
have reported it report some lower argmin instead, which is a spurious seed. The link
carries `n=93600`, a `dv` link pins the cap so nothing settles it, and the largest nucleus
in that frame is **period 94,776** — 1,176 over the wall. The row above was taken at the
settled 187,200.

So the search settles a cap of its own and uses it for the **search spec alone**, leaving
`view` and the address bar where the reader left them: a cap is a picture choice everywhere
else on this tab, and that is what `pinnedCap` defends, but here it is a floor under
correctness. Where the cap is already settled — which it is after any ordinary Render — it
costs one rung, because `settle` starts where it is and stops as soon as the fault share is
met. Measured through the page after the change: the committed `tangle 1e-22` link lists
**6**, and the anchor at 2e-11 still lists its 6
(`PORT=8014 node explorer/bench/hunt/probe-minibrots.mjs`).

**Both walls land in the same place.** Eight periods of a nucleus past 125,000 is over the
million-iteration ceiling, so those tiles cannot resolve either — and that is the same view
depth, about 1e-30, at which a centre stops fitting in a link. Below it this feature finds
minibrots it can neither draw nor address, and says so rather than pretending.

### Getting in and out

- **Clicking the tab** carries the viewer's frame over when it is on one of the ten
  families the kernel draws — `mandelbrot`, `multibrot3` to `multibrot6`, `julia`, `julia3`
  to `julia6` — with its degree; its coordinates are already exact decimal text, so nothing
  is lost crossing the floor, and a shallow Julia view brings its parameter with it.
  Anywhere else the tab opens at the last deep view it had, or at the Mandelbrot home, and
  says which families deep draws. *Back to the explorer* goes the other way under the
  family's shallow name, so a degree-5 Julia view comes back as `f=julia5`.
- **At the ordinary explorer's zoom stop**, unchanged, on either of the two sets this
  kernel draws, the refusal now ends with an offer: *Open this frame in Deep*, the view
  carried. It is the one place on this
  page that offers rather than states, and it is there because telling a reader who has
  zoomed until the arithmetic gave out that the thing is impossible would be a sentence that
  is no longer true. **The offer is the shallow view's and goes when it does**
  *(deep_caption_and_controls_right_ckpt141)*: it used to stay under the picture after its
  own button had opened the tab. Entering Deep by any route (the button, the tab, a `dv=`
  link, a saved picture) clears it, and leaving puts it back only when the shallow view is
  still the frame it was offered at, which the tab leaves it on and *Back to the explorer*
  does not. Coming out also clears whatever the Deep tab last said, because the two share
  `#status`. The other shallow line under the picture, `#opened`, is hidden while Deep owns
  the viewer and returns on its own.
- **A cost warning shows once per session**, on the first entry, in `sessionStorage`. It
  says what the tab costs and what Auto-render spends without being asked; it used to end
  *Nothing here draws until you press Render*, and that sentence went with the checkbox.
- **Entering resets the samples to one a pixel**, every time, and does **not** start a
  render: coming into the tab is not a frame change, and a reader who has arrived should
  see where they are before minutes are spent.
- **Zooming back out is fine at any depth.** *Back to the explorer* carries the view where
  `f64` can still resolve it and says why not where it cannot — the module's own question,
  not a width written down here. A Julia view has a second way to fail it, and the refusal
  names which one is in force: a `c` with more digits than a double carries cannot go, not
  because the frame is too deep but because the picture next door would be a different set
  wearing this one's name.

### Deep links are their own contract, version 3

```
dv · f · cx · cy · x · y · w · n · a · p · the shade keys · level
```

**`dv` is the marker and it is what dispatches.** A query carrying it is read by
`deep-link.js`; a query without it by `permalink.js`. Each refuses the other's by its own
rules — a deep link reaches the shallow reader with no `v` and is refused before a key of it
is looked at — so a deep link pasted into a page that did not understand it is a visible
refusal rather than a shallow picture at a rounded coordinate.

Why a second contract and not a wider first one: a deep view is not a shallow view with more
digits. Widening `permalink.js` would have moved three of its own rulings at once — that `x`
is echoed as written and read as a double, that the cap is emphatically **not** a key, and
that `f` and `m` say what is being drawn. Every shallow link ever written is held by those.

What is shared is shared rather than copied: the seven shade keys, the `level` operator and
the two encoders come from `permalink.js` by import. They are the engine's palette recipe
and a URL's escaping rule, neither of which has anything to do with how deep the view is.

- **`x` and `y`** are the exact decimal centre, up to the shallow contract's 64 characters.
  **Normalized to one spelling rather than echoed** — the one place this contract
  deliberately differs. The shallow one echoes a coordinate exactly as it arrived because
  reading it means reading it into a double, which cannot give it back; here it is read into
  an exact decimal, so writing it back as a plain decimal loses nothing at all, and one
  spelling per place is what lets the Saved tab tell two links apart by comparing them.
- **`w`** is the width, as a double and the shortest string that reads back as it. A width
  is a *spacing* and not a place, which is why it is the one number down here a double still
  holds honestly.
- **`n`** is the iteration cap, **written once it is settled** *(deep_tab_activity_and_
  layout_ckpt141; it was always written until then)*. A view carries `capFrom`: `"probe"`
  (the probe settled it), `"reader"` (typed, halved, doubled, or named by the link it came
  from), `"tile"` (a minibrot's own) are written; `"width"`, the policy's unsettled answer,
  is not, because an absent key already means exactly that — `parse` asks the policy for the
  width. Writing the width's cap was the bug: a link-carried cap opens pinned, so a link
  copied while the probe was deciding pinned the un-escalated cap. A view built without a
  `capFrom` is written, which is the old rule and safe. **A link that names `n` opens
  pinned**, as before; one that names none opens at the width's cap, which is the kernel's
  once the module is up (`unsettle` re-asks it, because before that only the engine's
  policy is on the page and it stops at 67,000). `deep-link.test.mjs` holds both halves.
- **`cx` and `cy`** are the Julia parameter, exact decimals, **both or neither**, and they
  are the shallow contract's own spelling of the same quantity — the `c` of `z² + c`, half
  of a dynamical location's identity. A second name for one number is how two readers of
  one thing drift apart. **The shallow contract holds both or neither too now**
  *(pre_closeout_ckpt138)*, so this is no longer the rule one of the two has; what is still
  its own down here is the arithmetic. What differs is the arithmetic behind them: read into exact
  decimals here, because a deep `c` is one no double holds. **Absent is the Mandelbrot
  set**, which is what every v1 link is. They come before the frame, the way `f` does in
  the shallow contract, because they say which set the centre and width are talking about.
  A Julia link that names no frame opens at `z = c` rather than at the Mandelbrot home,
  which is a place that means nothing on the dynamical plane.
- **Why v2 was a version and not a widening.** `cx` and `cy` have a default, so every v1
  link still parses and still means exactly what it meant — the test a widening passes, and
  `deep-link.test.mjs` holds a v1 link to canonicalizing with every digit of the place, the
  width, the cap and the palette unmoved. What bumped it is that the answer to *what does
  this tab draw* was no longer one recurrence.
- **`f` is v3, and it is the degree** *(deep_degrees_ckpt140)*. It names the family by the
  shallow contract's own spelling — `multibrot3` to `multibrot6`, `julia3` to `julia6` —
  because one name for one thing is what lets a view cross between the tabs without a
  table of translations. **Absent is `mandelbrot`, or `julia` where `cx` is present**, so
  every v1 and v2 link parses to exactly the picture it always named, and `f` is **written
  only where the degree is not two**: a degree-2 link moves by its version number and
  nothing else, and a link that spells the default is accepted and settles without it. A
  link that contradicts itself is refused rather than read one way — a `julia3` with no
  `c`, a `multibrot4` with one — and so is a family the kernel does not draw. A v1 or v2
  link carrying `f` is refused as a key those versions never had. Every string this page
  writes says `dv=3`. ⚠ The prompt that asked for this called it v4 with v1–v3 reading; the
  contract was at v2, so the number it took is 3.
- **No `m`.** There is one mode down here.
- The place, the width and the palette are emitted unconditionally, the cap once it is
  settled; the shade keys are omitted at the engine's defaults. `panel` rides as a UI key
  and is never emitted.
- **Loading a deep link** opens the tab on that view and draws it the way any other frame
  change is drawn *(deep_ui_ckpt140)*: the quarter pass and then one sample a pixel where
  auto-render is on, the quarter pass alone where it is off, and **no cap probe**
  *(ckpt141)*. The pass is committed rather than automatic — a link is a press — so Cancel
  is there for it.

`deep-link.test.mjs` is 35 tests and `deep-fx.test.mjs` is 12, on Node's own runner with
nothing installed; three of them hold the shallow contract to not having moved, including
that a deep Julia link is refused by it at both doors — `cx` and `cy` are keys that reader
knows, which is exactly why the marker has to be what dispatches.

### Saved takes deep entries

A deep Julia entry is labelled *Julia at c = …* rather than by its width alone, because two
Julia views of different sets at one frame are otherwise the same line of text — and an entry
above degree two leads with *degree d*, for the same reason. The tile's title names the plane
by the page's own `planeName`; it said *The Mandelbrot set* for every deep entry, Julia ones
included, until deep_degrees_ckpt140.

`Saved.canonical` dispatches on the marker, so a deep link is canonicalized by the deep
contract and **its centre and its parameter are never truncated** — putting it through the shallow reader,
which holds a coordinate as a double, would store a link to a place nobody asked for. A
deep entry is **described rather than parsed** for its tile: there is no drawing one at a
tile's size without the perturbation kernel and a wait, so the panel labels it and a click
opens the Deep tab on it.

### What it cost, measured

On this machine, 2026-09-19, a 1600×1000 window and a 908×512 canvas, driven over CDP:

**Every row is one stage and not a Render.** `said` emits the stage's own `field.elapsed`,
so the figure a reader sees when a frame settles is the *last* stage's — the fine pass at
four samples a pixel, which is the one that dominates. A whole Render at the anchor was the
three of them: 1.2 s for the quarter pass, something near 13 s for the full one — read off
its own `about 12 s left` progress line rather than timed — and then the 62.7 s below, so
**about 77 s**, of which the fine pass is four fifths.

⚠ **Since `deep_ui_ckpt140` that is the 4× row and not the default one, and since
`deep_tab_activity_and_layout_ckpt141` the screen cannot draw it at all** — the Render a
reader gets is the first two stages, about 14 s at the anchor rather than 77, and four
samples a pixel is a Download.

| | |
|---|---|
| the Mandelbrot home, its fine pass | field 0.15 s, shade 246 ms |
| the audit's anchor at 2e-11, cap 48,551, its fine pass at 4× | **field 62.7 s**, shade 180 ms |
| the same, its quarter pass alone | field 1.22 s |
| a palette change on the anchor's kept field | **recolored in 126 ms** |
| `perturb.wasm` | **167,361 bytes raw, 69,376 gzipped** (2026-09-20) |
| choosing the cap, at the anchor and at `tangle 1e-22` | **0.08% and 0.16%** of the fine pass |
| a deep download, 640×360 at 4×, the anchor | **31.2 s**, against the row's own estimate of 35 s |
| the same at 3840×2160 at 4× | **~24 min**, the row's estimate; 16× is refused on memory |

So the tab is about four hundred times the wait of a shallow frame and a recolour of it is
a shade, which is the whole reason the field is kept. The anchor's quarter pass at 1.22 s is
just under `AUTO_PREVIEW_MS`, which is worth knowing: at the anchor a gesture does settle
into a preview, and one decade deeper it stops doing so.

**Two deep links to paste.** The audit's anchor — a period-2838 minibrot nucleus in the
seahorse valley, at a width four decades below where `f64` gives out:

```
explorer/?dv=2&x=-0.74501772828532335842941892835857434&y=0.14993443275456819177805709088257971&w=2e-11&n=48551&p=twilight_shifted&panel=deep
```

And the Julia set of that same `c`, at `z = c`, two decades up where the filigree fills the
frame — the picture the ordinary explorer cannot draw at all, because this `c` is not a
double:

```
explorer/?dv=2&cx=-0.74501772828532335842941892835857434&cy=0.14993443275456819177805709088257971&x=-0.74501772828532335842941892835857434&y=0.14993443275456819177805709088257971&w=2e-9&n=8000&p=twilight_shifted&panel=deep
```

### What is not here

**Nucleus references in the main Render** — the tab still draws every frame against its
own centre. *Nearby minibrots* below solves nuclei and draws its tiles against them, and
measured the difference: on a tile the two are the same picture in the same time, because
a tile is already centred on its nucleus and so the view centre *is* the reference. What
naming the period buys there is the orbit's size and not its speed. Whether it pays on an
ordinary frame, where the centre is not a nucleus, is a separate question this has not
answered.

Stopping a search early at the 2-fold and 4-fold symmetry stages, and anything about
*Nearby minibrots* that persists: no entry reaches Saved, none has a link contract of its
own, and the list is gone on the next search or the next gesture.

**BLA was built, priced and taken back out, and §6 of the crate README is why.** The skip
table bought 50× or more on the ladder it was first measured on — but every frame there
deep enough for it to pay on was 100% interior, and on seven deep frames that have
something in them it is **between a 21% loss and 2.6×** and **moves the picture at every
tolerance, including the tightest one the approximation admits**. It cost 9,423 bytes of
`perturb.wasm` for a path no page could reach, and those bytes are back. The seven frames
stay, in `perturb-wasm/tests/common` with their `dv` links, because they are the only
deep frames this project has that are not one flat colour.

And those frames found something about this tab that is not about the skip at all: at
these depths the width's cap painted exterior as interior. **That is fixed** — *Iterations,
and the cap a frame asks for* above, and `perturb-wasm/README.md` §8 — and the frames are
what it was argued on. A sixth to a third of each of the five tangle and pinch frames is
repainted by the settled cap, and effectively the whole of each `body` frame, which were
flat interior fills over escape counts running to 400,000.

And on the Julia side: **no Julia view anchored anywhere but `z = 0` and `z = c`.** A frame
far from both at depth is refused rather than drawn, which is the honest answer and not a
limitation anybody has to route around — the structure this view exists for is at the
anchors. Lifting it means a reference orbit started at the view's own centre in fixed point
and a second one to rebase onto, which is a real design with a real cost, and nothing above
depends on it.

### What it is made of

```
deep.js            the tab: state, the staged passes, the gestures, the pending frame
deep-render.js     the pool, the orbit per frame, and the shade spec's placeholder viewport
deep-worker.js     one worker: one perturb instance, one held orbit, one band
deep-fx.js         exact decimal coordinates, BigInt fixed point
deep-link.js       the deep link contract — parse, emit, canonicalize, describe
deep-fx.test.mjs   12 tests: the arithmetic is exact where a double is not
deep-link.test.mjs 29 tests: the contract, and the shallow one held to not moving
deep.test.mjs      17 tests: where the two modules meet, against both committed ones —
                   and the cap policy's seam, which fails the same way the rest of
                   this file does, by drawing a plausible picture
bench/julia.mjs    what a Julia frame costs against the Mandelbrot frame at the same c
perturb.wasm       generated: the perturbation kernel, compiled
perturb.manifest.json  generated: what perturb.wasm was built from
perturb-wasm/      the crate that produces it
```

`python -m builder explorer --perturb` rebuilds the module and its manifest and nothing
else. It needs `cargo` and the `wasm32-unknown-unknown` target and **no sibling checkout** —
the crate has no dependencies at all, which is what makes that true and is why it is its own
branch rather than a stage of the bake. The manifest has no `engine_version` and no
`engine_changes`, with the fields absent rather than empty: this crate does not link the
engine and has never needed a change in it, and an empty `engine_changes` would read as a
list somebody forgot to fill in.

## Phoenix *(phoenix_tab_ckpt140, 2026-09-22)*

Matt's ruling: the Mandelbrot-type Phoenix, `p` fixed and `c` over the plane, is the
parameter plane of the Julia-type Phoenix sets, and the classic Ushiki set is one point of
it. The tab after Deep is the guided way in; `phoenix_plane` is also a family in Details'
list, where `j` and Back work on it exactly as on Mandelbrot (see the view toggles above).

- **The left pane is the plane, drawn live.** `phoenix.js` draws `phoenix_plane` on a small
  pool of its own (`Renderer.over`), so it never cancels the picture on the right. The
  atlas's plate could not be reused: it is a picture rendered once next door, and this one
  has to redraw whenever `p` moves. Wheel zooms about the pointer and a drag pans, sliding
  the last picture under the hand until the new one lands; **Whole plane** goes back to the
  measured home and keeps `p`. It draws nothing while the tab is hidden. The frame and `p`
  are this browser tab's session (`explorer.phoenix-plane`), and the preview's flag has its
  own key beside the viewer's.
- **One style for the whole left panel** *(phoenix_keypoints_and_plane_ckpt141)*. The plane,
  the preview card over it and every tile are drawn in `smooth`, Violet Rosewood
  (`twilight_shifted`), gamma 0.38, the other shade keys at their defaults, no curve. It
  used to be the viewer's palette and recipe, which a click into a set replaces with the
  set's own, so the map changed colour under the reader for a reason that had nothing to
  do with the map. `builder/phoenix_points.py`'s `STYLE` is the one place the style is
  written. The record carries it, the plane waits on the record, and the host's `lookOf`
  turns it into a view's look. A click still opens the set in the viewer's mode and palette.
- **The Atlas opens its Phoenix partition for both Phoenix families.** That partition is the
  Phoenix *set* the search walked; the atlas has none for the plane.
- **`p` is a slider and a number box under it**: real, −1 to 1, step 0.001, opening at the
  classic −0.5 out of the anchor. Moving it redraws the plane. It stays real; a starting
  point's imaginary part is shown beside it, see below.
- **A click opens that point's Phoenix set on the viewer**, at `c` under the click and the
  current `p`, in whatever mode, palette and recipe the viewer has. The address bar follows,
  the button row reads `Back to Phoenix plane (j)`, and Back lands the viewer on the plane at
  the tab's frame and opens the tab again with the plane where it was.
- **Preview**, off by default and remembered for the tab's session, shows the hovered point's
  set in the hover card. It is `julia-preview.js` mounted a second time over this canvas,
  so it is the picture a click would give at one sample a pixel. Where the card is up a
  click opens the `c` it is showing rather than a fresh projection, the viewer card's rule.
- **The classic is marked** while `p` is −0.5, at c = 0.5667 + 0i. That pair (0.5667, −0.5)
  is `(c, p)` and not a point of the plane, which is why the mark is at (0.5667, 0) and
  goes away when `p` moves.
- **`p` may be complex; the control is not** *(phoenix_named_points_ckpt141, reshaped by
  phoenix_plane_restore_ckpt141)*. The engine's `phoenix_m` takes a complex `p` and the plane
  is drawn at the whole of it, `px` and `py`. Nine of the eleven places the gallery seats on
  this plane have one. Only a starting point sets `Im p`. The slider and the box are `Re p`,
  and `Im p` is shown beside the box, read-only, while it is not zero. Moving the slider or
  the box sets it back to zero and clears the mark, as any move of `p` does. The first cut
  gave `Im p` a box of its own; the restore took that back to the bar as it was.
- **Starting points** *(phoenix_named_points_ckpt141)*: a grid of tiles under the plane and
  its `p` bar, three to a row, read from `phoenix-points.json`. The plane stays at the top
  and the panel does not scroll; the grid takes the height left and scrolls inside it
  *(phoenix_plane_restore_ckpt141; the first cut put them above the plane, and the plane
  was lost from the panel)*. Each tile shows its `p` under it. It holds the classic first,
  then seven `(p, c)` the staged gallery seats. `python -m builder phoenix-points` wrote it,
  and `builder/README.md` has the rule. **A tile is a keypoint, not a seat**
  *(phoenix_keypoints_and_plane_ckpt141)*. It shows the whole Phoenix set at its `(p, c)`
  at the family's home view, drawn by the builder through the committed wasm in the
  panel's style. A click is a click on the plane there. It moves `p` to the point's full
  complex `p`, opens the plane at the frame the record's `plane` boxes that `p`'s filled
  set in, marks `c`, and opens the whole set on the viewer in the viewer's mode and palette,
  held for Back. The seat's own zoomed frame, and `Reset to seat`, are gone from this path.
  The classic's mark is the classic mark; any other point gets the same crosshair in a
  ring. The mark clears when `p` moves by hand or the plane is clicked. A pan or zoom
  keeps it.
- **The plane at a complex `p` was not mis-drawn** *(phoenix_keypoints_and_plane_ckpt141)*.
  At p = −0.244 − 0.711i the plane was reported as a featureless gradient at the home
  frame. The spec the tab sent carries both parts of `p`, captured off the pool's messages.
  The set is inside the home frame: 12.3% of it interior in the committed wasm, 12.5% by an
  independent sweep. A headless click on that tile drew the set with its boundary, so the
  report did not reproduce. What could produce it was the frame. A tile click used to keep
  the reader's last zoom and only recentre on `c`. At this point `c` sits on the edge of the
  plane's set, so a narrow kept frame recentred there can hold little but exterior. The
  seat's palette the plane was then redrawn in, a near-flat cyan on the outside, did the
  rest. A tile now sets
  the frame, and the style no longer follows the viewer. After each of the eight clicks the
  plane is 3.7% to 28.7% interior.
- **Only a set that starts at z₋₁ = 0 can be a starting point.** Of the 404 Phoenix seats
  in the staged gallery, 140 start there; the rest are points of no plane here, for the
  reason given above.

**The plane's home row is measured** like every other: at p = −0.5 its filled set spans
re [−1.93, 0.5425], im ±0.66625, framed at (−0.69, 0) w 2.8. It is the one set in the
engine's table that is wide rather than tall. And it stops at 0.5425, short of 0.5667: **the
classic Ushiki instance is a point just outside the plane's filled set**, its z₀ = 0 orbit
escaping, so the tab's sentence says where it sits and does not say it is inside.

## Inflection — **paged** *(inflection_tab_ckpt136, 2026-09-20; paged out by Matt's ruling, inflection_page_out_ckpt136, 2026-09-20)*

A fifth tab sculpted a degree-2 Julia set by **inflection** — Julia morphing — under its
own contract, `iv=1`. Matt looked at both contact sheets: the feature is okay and he does
not actively like it, so it is **paged out**. The code is kept and made unreachable: no
tab, no panel, no stylesheet block, nothing the page loads imports it, and nothing here
runs in a suite or in a `builder check` step.

**`explorer/paged-inflection/README.md` is the file to read.** It carries what the tab was,
what the work taught — interior-free seeds by the critical orbit's multiplier, snap as a
requirement rather than an option, three to five clicks before the ornament closes into a
disc, the three click primitives differing only in 4–16× crops, and `tia` and `curvature`
as the modes that suit it — and the exact steps to put it back.

Three things stayed behind, each because a URL outlives a trial: `permalink.js` keeps
`INFLECT_MARKER` and `isInflected`; `explorer.js` keeps one sentence, `INFLECTION_PAGED`,
which is what an `iv` link, an `iv` Saved tile and an `iv` Saved open are answered with;
and `deep-link.test.mjs` keeps the two guards the paged suite owned — that `iv` is sorted
by its own marker and by neither live contract, and that both live contracts refuse `iv`
and `q` by name.

`engine-wasm/src/inflect.rs` stays in the crate behind the `inflection` cargo feature,
**off in the shipped build**, so the module is 763,343 bytes rather than 793,590 and a spec
carrying `inflections` is refused by name. Renders were measured identical across the bench
ladder with it off — 153 frames, 72.9 MB, zero bytes different — and the shipped module
differs from the one that stood before the tab landed in 32 bytes, every one of them a
panic `Location` line number.

## Saved *(saved_tab_ckpt131, 2026-09-18)*

The last tab is the visitor's own list of pictures, kept in this browser. Nothing leaves
it and nothing needs a server.

**What is stored is links.** One `localStorage` key, `fractal-website.explorer.saved`,
holds `{ v: 1, items: [{ link, added }] }`, newest first, and it is written on every
change. The key carries the site's name because every project page under `github.io`
shares one origin. A missing, malformed or other-version value reads as an empty list, and
storage that throws reads as empty too. A failed write keeps the list in memory and says so
in the tab. `navigator.storage.persist()` is asked once, on the first save. The tab's footer
says the one thing a visitor needs to know about all this: the list lives in this browser,
and Safari may drop it after a week away.

**One picture is one entry.** Every link is put through the contract and back
(`link.emit(link.parse(…))`) before it is compared or stored. A gallery row's link, an atlas
slot's and the viewer's are then one string when they are one picture, and saving is
idempotent on it. The list stops at 5,000 links, about 1.75 million characters against a
quota of five million. At the cap a save is refused with a sentence, and nothing is
evicted.

**Saving, from anywhere.** *Save*, beside the download buttons, saves the view on the screen,
whatever that is, a walk's own frame included. It is held while a pass is still deriving
something the link carries, as Copy link is. Every gallery tile, Found tile and atlas slot
carries a bookmark mark in its corner: hollow, shown on hover or focus, and filled and
always shown once saved. Pressing it again removes the picture. A mark is a button of its
own, so a tile that carries one is wrapped in a `.tile-cell` beside it, since a button
cannot hold a button. The atlas frame takes the mark through a `slotMark` option it knows
nothing else about, and the atlas page passes none. Every mark carries its canonical link in
`data-key`, so one query of the document re-dresses all of them when the list changes. A
`storage` event from another tab of this page reads the list again.

**The tab.**
- Tiles come newest first, each labelled with its mode and plane. A click opens the picture
  as a gallery tile does, and × removes it.
- Each tile is drawn from its link by the engine at the gallery's tile size, 316×178 at four
  samples a pixel. It uses a renderer pool of the tab's own, for the walk's reason: the
  viewer's renderer cancels whatever it was doing on every pan.
- Only tiles near the panel's window are drawn, one at a time, and nothing is drawn while
  the tab is hidden. A drawn tile is a WebP blob kept in memory for the visit. On this
  machine the first five tiles, pool start included, drew in 2.9 s.
- *Export* downloads the list as the same JSON it is stored as, and *Copy links* copies full
  explorer URLs, one to a line.
- *Import* takes a pasted text or a chosen file: an export, a JSON list, or lines of URLs or
  bare queries. It merges and dedupes, and says how many were added, already saved, or not
  links.
- *Clear all* asks first.

**Download all** draws every saved picture at the download row's current size and samples,
in the format chosen beside it. JPG is the default, because forty 3840×2160 PNGs come to about
half a gigabyte, all held until the zip is handed over. It goes through `pictureOf` in `download.js` on the viewer's renderer, holding
the row and the view still exactly as one download does, and its button becomes Cancel. A
link that leaves out its derived opacity or weight gets one taken from the view, as the
viewer does on arrival. A trap's opacity comes from a probe at `PROBE_WIDTH`, a texture
weight from a one-sample field up to 640 wide, and a carried tone curve is replayed. The
pictures go one at a time into a stored zip, `zip.js`: PNG and JPG are compressed already,
so each entry is written as it is, and the archive is a `Blob` of the encoded pictures
rather than a copy of them. Before a run of more than a minute, or more than 25 pictures, it
says the estimate, from the prior cost table, and a rough zip size, and asks. Six pictures at
640×360 took about 5 s. A picture the renderer refuses at that size is left out and named.
The zip stops at 65,535 files and 4 GB, since there is no zip64.

**It does nothing to a running walk.** Showing Saved neither pauses nor resumes one, so
going from Saved back to Walk has nothing to take up. Opening a saved picture detaches the
viewer as opening any picture does, and the walk carries on. Gallery and Atlas still pause
it when shown.

## The way back *(explorer_undo_redo_ckpt137, 2026-09-20)*

**Ctrl/Cmd+Z steps back through the pictures this session has shown; Ctrl+Shift+Z and
Ctrl+Y step forward.** There is no button and no panel — the two keys are named once, in
the `title` on the row of view toggles, which is where this page already says what its keys
are. `undo.js` holds the list and the cursor and has **8 tests** of its own
(`node --test explorer/undo.test.mjs`); the two ends of it are in `explorer.js` under *the
way back*.

The problem it solves is that one press could destroy a picture that took a minute to find.
Random palette, Random phase, a mode change, Julia here, a gallery or Saved tile, a Walk
pick — every one of them replaces the view, and before this the only way back was to have
copied the link first.

**An entry is the picture's canonical link and nothing else.** That link is already the
complete state — it is what the address bar carries and what Copy link hands out — so a
step back goes through the same door as opening a link, and nothing here can drift away
from either contract. There is no second serialization to keep in step, and no state a
step back can reach that a link cannot spell.

**It rides on `settle`, and that is the whole design.** A picture settled enough to be
written into the address bar is a picture settled enough to step back to, and `settle` is
already the one place both contracts agree about that — the shallow viewer calls it when a
pass finishes and the Deep tab is handed it as a host callback. So there is no hook on the
mode select, none on Random palette, none on Julia here and none on a gallery tile. Three
of the four things that would otherwise have to be arranged fall out of that:

- **A wheel burst is one entry** on the shallow side without anything being arranged, because
  `drawPass` cancels every superseded pass before it reaches `settle`.
- **A panel change is no entry at all**, because the panel is furniture appended after
  `currentQuery()` and is not part of the picture.
- **A deep entry is restored by the Deep tab's own rule**: `deep.open` draws the quarter
  pass and waits for Render, which is what a deep link does, and an entry is a link.

**The key is `keyOf` — the query with `level` and the derived parameters dropped**, the same
reduction the greyed buttons use, which is why `pictureKey` is now a thin call over it and
why the reduction reads a query rather than a view: it has to say the same thing about a
deep link, and it does, because both contracts spell the curve with `LEVEL_KEY.key` and the
deep one has no derived parameters. A commit whose key matches the entry under the cursor
**refreshes** it instead of pushing. That is what makes one action one entry when a pass
settles twice — once with the picture, once again when it has measured the tone — and the
entry keeps the second, measured link, so a step back replays the curve that was on screen
rather than measuring a new one.

**Two things had to be arranged, and both are named where they live.**

- **A debounce of `REMEMBER_MS`, 350 ms**, which is the Deep tab's own `SETTLE_MS` for the
  same reason it chose that number. The cancellation above is the shallow viewer's alone:
  the Deep tab's `moved` calls back once per gesture with nothing coalescing, so a wheel
  burst down there would otherwise be an entry a notch, and a slowly dragged slider can
  complete more than one shallow pass.
- **The running walk is the one picture not remembered.** `showWalk` is the walk's own
  frame-at-a-time display, and a minute of it would fill the trail with pictures nobody
  chose and bury the ones somebody did, so it alone passes `settle({ remember: false })`.
  What a reader *did* still commits: pausing lands on `followWalk`, and opening a found
  picture goes through `openLink`.

**The anchor does not move on a step back.** Reset to seat goes back to what *arrived*, and
an undo is not an arrival — it is the reader taking back a move they made since. That is the
only thing `openLink`'s `restoring` option changes, besides the sentence it hands the walk.
Everything else it does is wanted, which is how stepping back onto a gallery tile puts the
tile's mark and its *not exact* line back with the picture: the options a picture was opened
with come off the anchor at commit time, where the settled picture **is** the anchor's, so a
tile's `key` and `gap` survive into the entry with no second list to keep in step.

**A restore must not commit**, and it is several tasks long, so `restoring` holds the key of
the entry being put back. It is cleared by the settle that lands on that key and **by nothing
else** — a settle with any other key on the way there is ignored and leaves the flag up,
which is what covers the one real case: stepping out of the Deep tab calls `showPanel`, and
that redraws and settles the old shallow view before `openLink` has replaced it. A restore
that cannot go ahead returns false and the cursor goes back where it was standing.

**Not `history.pushState`.** The stack is this page's own array, so the browser's Back button
still means *leave this page* and nothing collides with the `replaceState` that `settle`
writes the address bar with. It is session-only and never stored: **300** entries, which is
three hundred short strings and far more steps back than a reader will ever take at once,
and the cap evicts from the front, the end nobody is standing on.

Two things it deliberately does not do. It **never** triggers a download, a save or a change
to the Saved list — it restores pictures, and `syncSave` only reads. And it says nothing at
either end of the trail: a key that does nothing where there is nothing to do is what every
program does, and a message there would take the line under the canvas away from something
the page had a better reason to say.

## Every colormap, and where they live

The page carries **1,022** maps, which is the whole tracked library, and it used to carry
126. The reason is a gallery seat: a link built from a seat's recipe has to be able to
name the map that seat was drawn in, and the general record alone seats **444 distinct
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
reader, and it checks the blob's length and SHA-256 against the index's own stamp before
trusting a byte of it — an index and a blob that disagree do not fail, they draw map
`n`'s bytes at map `n+1`'s offset, which is a real gradient belonging to somebody else.

**Stored planar and byte-delta, for the wire** *(explorer_slim_ckpt131)*. Within its own
span, a map is its reds, then its greens, then its blues, each byte the difference from
the one before it in that channel, mod 256. Neighboring stops of a gradient are close,
so the differences are small and repeat, and gzip takes the file from **897 KB to 185 KB**
on the wire. It is the same length and each map keeps its span, so the index addresses it
unchanged. The index names it — `"layout": "planar-delta"` — and `stops.js` undoes it once
on arrival. At the change, every stop of all 1,021 maps decoded to the same bytes as the
interleaved blob before it, and `stops.test.mjs` holds the reader to the bake's encoder.
Because the two layouts are the same length, the length check alone could not catch a blob
in the other one; the hash is what does.

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
`solve.DEFAULT_FINE_BAR`, absent where it has no such row, **947 of 1,022 have one** —
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

**And a fourth says which colours each map has actually made** *(2026-09-19)*.
`families` is every hue family the Walk tab offers a map under: the families it gives at
least **5%** of its candidate-ledger pictures to. It comes from a table the wallpaper
project now ships beside the random list — `data/palettes/palette_family_shares.csv`,
one row per library map with its picture count and how many of those pictures the
dominance rule calls dominant in each of the twelve families — imported by `python -m
builder explorer --families` and frozen here like everything else. At that bar the
families hold **199 to 388 maps** each (lime fewest, orange most), a map stands under
**3.15** of them on average, and the one map with no family at all is `blue_orange`,
which the library holds and the candidate pool does not, so it has made nothing to read.

**The bar is this repository's, and that is the difference from `random`.** The table
next door states counts and no threshold, because it is the measurement; how wide one of
this page's controls reaches is a decision about the control. A re-measured table
therefore arrives here as a rebake rather than as an argument about where the line is.

**`family` and `families` answer different questions, and their counts differ a lot.**
The picker's hue tabs file a map under the one family it *most often* produces, over the
thin above-the-bar slice of the ledger — rose 80 maps. The walk's rose box holds 235,
because a map that mostly makes amber and makes rose a fifth of the time is worth
drawing when a reader asks for rose. It conditions the **draw** and filters nothing: a
walk narrowed to teal paints in maps that make teal often, and the picture it finds does
not have to be teal.

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

**And it says it only where it is true** *(pre_closeout_ckpt138, 2026-09-20)*. The boot
notice's second paragraph is the filesystem sentence above, and it used to be shown to
everyone while the module loaded — so the one case it was written for, a page that never
comes up, told a *served* reader the opposite of their problem
*(explorer_bug_hunt_ckpt138, finding 4)*. A small inline script in `index.html` removes that
paragraph at once anywhere but `file://`.

**The same script is the one thing a module cannot say about itself.** `explorer.js`
statically imports a dozen files, and a static import that fails takes the whole graph down
before a line of it evaluates: `main()`, its `catch` and `refuse()` never run, so nothing
replaces the notice and the page reads *Starting the renderer…* for good. Failing each
resource at the door, `engine.wasm` and `palettes.bin` refuse with a sentence and
`perturb.wasm`, `palette-names.json`, `popular.json` and `gallery.jsonl` are non-fatal —
but `palettes.js`, `catalog.js` and `worker.js` left the notice up forever. Nothing inside
the graph can catch that. The script is outside it, and classic rather than a module so
that it runs before one.

**Forty-five seconds, and the number is measured.** With the HTTP cache disabled the studio
came up in 222-456 ms locally, ~4.9 s on fast 3G, ~17 s on slow 3G and ~42 s on a 2G-ish
profile (`node explorer/bench/hunt/probe-boot.mjs`). A false *this failed* is the expensive
error in both directions — the notice is honest while it is up, and a reader told to reload
on a slow connection restarts the whole download — so the delay sits past the slowest boot
that still arrived rather than near the common one. It fires only while the boot markup is
still the boot markup, because `refuse()` replaces the notice's children with its own
sentence and a page that refused for a reason it knows keeps that reason.

**Chrome's `--screenshot` cannot photograph it.** It shoots at load and never waits for the
wasm module or the workers, so every shot is *Starting the renderer…*. Drive the served page
over CDP instead, with Node's own `WebSocket` against `--remote-debugging-port`, and wait on
the page's state before taking the picture.

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
| `raw_bytes` / `gzip_bytes` | 785,424 raw, **231,149 gzipped** |

`engine_changes` is typed, in `builder/explorer.py`, and is the condition CLAUDE.md puts
on a website prompt touching the sibling engine at all: a zero-behaviour change is allowed
there only if it is named here. Nothing in the sibling repository marks a commit as one of
these, so a derived list would be a guessed one.

**And one of the seven lines is further than that carve-out reaches, and says so.**
`coloring::shade_samples` and its two siblings are signatures *added* to the engine rather
than visibility widened — the shade over the pool needs the frame's normalization apart from
the colouring it feeds, and no amount of `pub` on what was there gives a caller that.
`explorer_shade_pool_ckpt136` was told to make that seam. It is still zero behaviour: each
of the three public colorings is its own measure followed by its own `_samples` over one
band that is the whole field, the pipeline's renders are the renders, and the engine's 217
tests are unmoved.

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

### The other kernel, and why it is not this one

`perturb-wasm/` is a second crate and will be a second module. It renders the
degree-2 Mandelbrot set **below the `f64` floor** — by perturbation against one
high-precision reference orbit, with rebasing — and it is deliberately not part
of `engine.wasm`. Nothing in it is linked into that module, so the shallow path
cannot be slowed, re-ordered or moved by it, and a shallow permalink draws the
same pixels it drew before. The two would meet on the page, at a buffer of `f64`
lanes: its output is what `compute_band` produces for `smooth`, in the same
layout, so `shade_level` colours it unchanged.

**The Deep tab, the link contract and the committed `perturb.wasm` all landed
together** *(build_deep_tab_ckpt135, 2026-09-19)*, which is what settled the
exports the module was waiting for a consumer to settle. See *Deep* above for the
tab; `perturb-wasm/README.md` owns the design and the numbers: the limb rule, the
rebasing, the cap policy, and the proof that where the two kernels disagree at
depth it is this page's kernel that is wrong.

That disagreement is worth reading before assuming the intro's scope line still
holds. At width 2e-11 the two fields agree on **no sample at all** — median 61
iterations apart, worst 34,250 — and against a 384-bit oracle the perturbation
kernel is nearer the truth on 307 of 311 escaping samples and the plain `f64`
loop on 4.

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

- **`Family::PhoenixM`, `PHOENIX_PLANE` and `FamilySpec::PhoenixM` are new**
  *(phoenix_tab_ckpt140, 2026-09-22; wallpapers `756c241`)*: the Phoenix recurrence over
  its parameter plane, spec kind `phoenix_m`, `p` defaulting to the classic −0.5. A new
  signature, which the carve-out allows because the prompt was sent for the seam. Its home
  row is measured by the ignored test that reproduces the five multibrot rows to the bit:
  re [−1.93, 0.5425], im ±0.66625, framed at (−0.69, 0) w 2.8. It is not render-only,
  because this page opens only a family with a home view, so the engine's own doors take it
  too; nothing in the pipeline's Python names it. Zero behaviour, measured: **54 pipeline
  renders byte-identical** before and after (the three anchors in five modes, every integer
  family, the classic Phoenix in five modes, a fractional degree, 24 seats of a final139
  recipe file), **30 fields of this module identical** before and after over five families
  and six modes, and `phoenix_m` at p = 0 **is the Mandelbrot field** on six modes. Engine
  tests 217 unmoved, four added.
- **`Family::step` and `derivative_step` are `#[inline(always)]`**, and the reason is a
  measurement rather than a precaution. The Phoenix plane's arm made `step`'s `match` one arm
  bigger and the inliner stopped inlining it into the specialized loops, so each iteration
  became a call and a runtime match: **the Mandelbrot anchor at 1600×900 × 4 went from 6.5 s
  to 13.4 s with every pixel byte-identical**, which is the shape of regression a byte check
  cannot see. Forced, it is 6.4 s, and the classic Phoenix went from 0.67 s to 0.49 s, so it
  was paying the same call before. Inlining is inside the carve-out.

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

**And the shade is banded now too, which is three exports rather than one**
*(`explorer_shade_pool_ckpt136`, 2026-09-20)*. The `shade` above is still there and still
what a download takes; what the screen takes is the same colouring cut the way the field
is cut:

```
shade_stats(spec, lanes)               -> JSON   the frame-wide statistics, once
shade_band(spec, stats, lanes, rows)   -> RGBA   one band, through those statistics
curve_stops(spec, picture)             -> JSON   the map with the tone curve on it, once
```

**A field band is a pure function of its own rows and a shade band is not**, which is why
this is a seam and not a row range. The engine normalizes a frame against its own
distribution — the 0.5th and 99.5th percentiles of its valid samples — so a band coloured
alone would be stretched against its own histogram and would draw a step between itself
and its neighbours. `shade_stats` answers those numbers over the whole field and every
`shade_band` is handed the same ones, so **the cut cannot reach the bytes**, which
`bands.test.mjs` holds to the whole-frame `shade` at one and at two samples a pixel and on
a two-lane composite. The statistics are the engine's own `coloring::Spend`, measured by
the engine's own code; this module keeps no second opinion about what a frame's
normalization is, and the engine's README says what it took to hand one back.

**Two colorings decline, and say so rather than being wrong.** The modulate and a rank
transfer normalize by `coloring::Ranks`, which is the frame's valid samples sorted — eight
bytes a sample, the field over again. Sending that to twelve workers costs more than the
colouring it splits, so `shade_stats` answers `pooled: false` and the page keeps the
one-worker `shade_level` for those two. It is a size, not a taste: the other statistics are
three numbers or two hundred.

**`curve_stops` is why the tone curve is spent once.** The operator acts on the *map* and
not on the picture, and what it costs is per stop — a bisection inside a bisection over
every densified stop, which is hundreds of milliseconds on a map with hundreds of them. A
banded shade would otherwise have had every band replay it. So the curve is spent here, the
curved stops go into the band specs, and **the palette strip is drawn through the very
stops the picture was** rather than through the curve again. The curve comes off the
finished picture where the view is one the reader made, and off the spec where it is a seat
or a link replaying a run's own.

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
again. One sample per pixel aliased visibly on every fractal edge. **That stage's shade
goes over the pool**, the way its field does — measured once over the whole frame in the
page's kept worker, then coloured a band a worker — because four times the samples was up
to half a second on one thread while eleven workers sat idle, and a recolour should not
freeze the page. A recolour puts the one-sample picture up first, and that one is pooled
too: it is a quarter of the samples and it is the stage a dragged control pays on every
frame. Where `f64` resolves the screen's grid and not one twice as fine, the module's
refusal is said beside the one-sample picture, which stays up.

**Cancel is by generation, not by termination.** A pan bumps the generation, no further
bands are dispatched, and the band still in flight is finished and thrown away — killing
a worker mid-band would cost a wasm instantiation to save at most one band. The abandoned
pass resolves with `null` rather than being left pending: a promise nobody settles holds
its whole `await` chain alive, and a reader who drags across the set makes one per drag.
So a cancel waits out the band in flight, because the engine has no flag to stop one early
(*Cooperative cancellation*, under *Next*).

**Measuring cancel latency takes a set-up, or it measures something else.** Draw the cheap
view first so it is cached, switch into an expensive mode once, wait for the supersampled
stage to start, then switch to a mode nothing has drawn yet and time to the first changed
pixel. Re-picking a mode already drawn is a cache hit; re-drawing the same view, or timing
to the finished picture, times a render rather than the wait for the old one to stop.

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

**And the row draws whichever view owns the canvas** *(deep_cap_policy_ckpt138)*. Until this
landed the Deep tab hid the row, and the code behind it drew and stamped the *shallow*
`currentView()` whatever was on the screen — a correctly-labelled picture of somewhere else.
The row is on the page in the Deep tab now, and while that tab owns the canvas five things
come from it rather than from here: the view, the link, the plan, what a pass of the frame
measured, and who draws it. Save and the view buttons go, because the Deep panel carries its
own Save and every one of the view buttons names a frame this kernel does not have.

Three things are different about a deep download, and each of them is the depth rather than
the row:

- **The cap is the frame's**, settled by the probe above before the picture is drawn, so the
  `dv` query stamped into the file is read *after* the render rather than at the press — a
  deep link carries its cap, and the cap is not known until the frame has been asked.
- **There is no prior to fall back on.** The `COST` table is one machine on one day at one
  shallow view, and a deep frame's cost swings over four orders of magnitude with the width,
  the cap and how much of it is interior. So the row says *not priced* until a pass of this
  frame has been drawn — the quarter pass a link opens with is enough — rather than offering
  a number that would be wrong by a factor of a thousand. Measured: at 640×360 at 4× on the
  anchor the row said ~35 s and the file took 31.2 s.
- **Full size is a wait, and it is offered rather than hidden.** 3840×2160 at 4× on the
  anchor is about 24 minutes by the row's own estimate, with the tab's progress line and
  Cancel running the whole way and the download button's own bar beside it; 16× is refused
  by the sample ceiling, as it is on the shallow side. Nothing is downscaled to make it
  quicker, and the shallow view is never substituted.

**One row, first, and always open.** Download is the studio's first section: two buttons,
leftmost — `↓ PNG` and `↓ JPG` — then a size (*Screen*, *As shown*, three wallpaper
presets, or a custom width and height), a 1× / 4× / 16× samples toggle that opens at 4×,
and an estimate of a few words.

⚠ **The word *Download* is a green arrow** *(Matt,
explorer_box_zoom_and_download_row_ckpt140, 2026-09-22)*, and the size option that read
*This screen (2560×1440)* reads *Screen (2560×1440)*. Both were the widest things in a row
that wraps on a phone, and both said a word the heading over them already says. The buttons
keep `Download PNG` and `Download JPG` as their `aria-label`, so the accessible name did not
shrink with the face; the arrow is a span of its own, which is what lets the percentage
during a render replace the format's name without touching it — a render reads `↓ 45%`.
The button's `min-width` came down from 6.5rem to 4.25rem with it.

⚠ **And the glyph is drawn rather than typed** *(Matt, explorer_box_shortcuts_ckpt140,
2026-09-22)*. It was the character `↓`, which every font on this page renders as a hairline
a pixel wide at 0.8rem — a stroke beside a solid word, reading as a stray mark rather than
as the button's verb. It is one filled path on a 24 box now, `currentColor` so the green
stays the span's, in the same markup the Save bookmark already uses. Sized in `em` off the
button's own font, so the glyph stands at about the text's **cap height** whatever the row's
size does: 12.2 px of box at today's 0.8rem, 9 px of arrow inside it. The percentage
replacement is untouched by any of it, because it only ever rewrote `.download-said` —
measured mid-download, `↓ 25%` with the fill bar behind it and the arrow where it was. 16× is there to hold a download against the same picture
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

### Every downloaded picture carries its own link *(explorer_download_carries_link_ckpt137, 2026-09-20)*

A file saved from this page holds the permalink of the view it is, in the file's metadata,
and dropping that file back on the canvas reopens the view. Nothing about it is visible:
there is no drop zone, no badge on a saved file and no line of instructions, the same way
the way back is two keys and no buttons.

**The seam is the encoder, and there is only one.** `download.js`'s `encode` is what the
single PNG or JPG goes through and what each picture in Download all's archive goes
through, so the stamp is in one place and no path can be added that quietly skips it.
`stamp.js` does the bytes: a PNG gets an `iTXt` chunk between `IHDR` and the image data, a
JPEG a `COM` segment after the `APPn` run at the front, and a WebP — the thumbnails, which
are not downloads — comes back untouched, so a call site may hand over whatever it encoded.

**The pixels do not move, measured.** In `stamp.test.mjs` a PNG built there is stamped and
both are inflated: the same raster, and taking the chunk back out gives the original file
byte for byte. The browsers' own encoders were held to the same thing out of band — a
640×360 frame of saturated bands encoded by Chrome, stamped, and both decoded back through
`createImageBitmap`: **0 of 230,400 pixels differ** as PNG and **0 of 230,400** as JPG at
quality 95. The file grows by the payload and its header — 194 bytes and 165 bytes for a
144-character link.

**The payload is the query and a tag in front of it, and no host.** Nothing here is live,
the site is served from a project-Pages subpath that could move, and a picture saved today
should open on whatever origin the reader has — so the file carries
`fractal-explorer v=3&f=…` and the page it is dropped on supplies the rest. *Which*
contract it belongs to is already in the query, because a deep link leads with `dv` in a
file exactly as it does in a URL. There is **no version of its own** either: the query
carries `v=3` or `dv=3`, so a payload this page cannot read is refused by the contract in
the contract's own words, which is a better sentence than a second version number could
produce. The tag is what the JPEG side needs — a comment segment is free text with no
keyword — and is how a reader tells our comment from somebody else's.

**Reading is metadata and never pixels.** A dropped file is parsed for the chunk or the
segment, and what comes out goes through `openAny` — the same door the Saved tab's tiles
use, with the same three branches and the same refusals, so a dropped deep link opens the
Deep tab and a dropped Inflection link is refused by name. There is no inferring a view
from a picture: a file with nothing in it says *That picture carries no explorer link* and
changes nothing. The Saved tab takes a drop too, and **keeps** it rather than opening it —
eight bytes decide whether what landed is a picture or the JSON its Import box already
takes, and a picture's link then goes through the same import and gets the same tally.

**What still reaches a reader without one.** Every picture the builder writes — the article's
figure sheets, the atlas plates, `palettes-swatch.png`, and gallery tiles when there are
any — is saved by a right-click and carries nothing, although `links.jsonl` already holds a
permalink for most of them and `images.land` is where a stamp would go. So does the canvas
itself, saved by a right-click rather than by the button. So do the Saved and Walk tabs'
WebP thumbnails, and so will the full-size wallpapers when they ship, which are release
assets built next door and never touch this page. None of that is fixed here.

## Measured

Two kinds of harness, and they answer two different questions. The first asks what the
arithmetic costs and the second asks why a page feels the way it does, and **each of them
is blind to something the other sees** — which is not a figure of speech here: the row
floor below was very nearly retired on a measurement that could not see the thing the floor
was for.

**The kernel, one thread, no browser.** `explorer/bench/kernel.mjs` instantiates the
committed module under Node and asks for one whole frame, so the number is the arithmetic
and not the pool. `home` is the mandelbrot home view; `anchor` is a hard location deep in
the spike. Both in mode `smooth` at 1280x720.

```
node explorer/bench/kernel.mjs kernel.json          # both views, 3 runs each
node explorer/bench/hunt/smoke.mjs                  # the hunt harness's own self-test
PORT=8014 node explorer/bench/hunt/u1-links.mjs     # one unit; u1..u8 are the hunt
PORT=8014 node explorer/bench/hunt/probe-oom.mjs    # 30 loads in one tab, workers per load
node explorer/bench/modes.mjs [other.wasm]          # every mode, mandelbrot home
node explorer/bench/sweep.mjs                       # every family x mode pair
node explorer/bench/families.mjs [generic.wasm]     # every family, smooth, at its home
node explorer/bench/cut.mjs                         # one frame, cut into 1 to 410 bands
node explorer/bench/level.mjs                       # the tone operator, by a map's stops
node explorer/bench/curves.mjs [other.wasm]         # every map x four curves, one hash
```

**The page, in a real browser with a real pool.** `explorer/bench/page.mjs` drives the
committed page in headless Chrome over CDP and splits the wall time from an input to a
finished picture into its stages. It needs nothing installed: Node has `WebSocket` in the
global scope and Chrome speaks CDP over one, which is the only reason a browser-driven
harness is tracked here rather than being a session's worth of scratch scripts.

```
python -m builder serve                             # in another terminal
node explorer/bench/page.mjs ladder                 # nine views, stage by stage
node explorer/bench/page.mjs edits                  # palette, phase, level, mode, pan, zoom
node explorer/bench/page.mjs cancel                 # what a new view waits for the old one
node explorer/bench/page.mjs load                   # cold open: bytes, compile, first picture
LADDER=interior,trap REPEAT=2 node explorer/bench/page.mjs ladder   # narrowed, repeated
WALKS=30 node explorer/bench/walk.mjs walks         # a Walk tab run, step by step
WALKS=6 node explorer/bench/walk.mjs shots          # the same, photographing each end frame
```

**`walk.mjs` is the third kind, and it is the only one that measures a program rather than a
picture** *(walk_faster_ckpt138)*. A walk is a root search, a descent and a place painted
several ways, and `Math.random` is everywhere in it with no seed — so a walk is not
repeatable, a pair of them says nothing, and the question "is this too long, and which part
of it is" only exists over dozens. It presses Start, waits for a given number of walks to
finish, and reads `__walk` whole: steps per walk, milliseconds per rung and per painted
candidate, and every step's time bucketed by kind and by stage. **A judgeless run is not a
reading of this tab** — without the untracked judges the walk picks at random among what the
screen passes, which is a different program — so it checks that gate timings were taken and
says so when they were not. A run that gives up on a wedged walk still records the ones
before it.

Two seams into the page and both are read-only. `#render-state`'s `data-state` and
`#stats`'s text are what a reader sees, so a `MutationObserver` on the pair is a timeline of
the stages with no instrumentation at all. That element carries a `--done` as well now, and
the seam is unmoved because the observer filters on `data-state` by name — see *the render
bar*. What that cannot see is inside a worker, and
`render.js` exports a `passes` ring buffer on `globalThis.__render` — every band's rows and
milliseconds — which is the only way to tell a frame that is slow because the recurrence is
expensive from one that is slow because eleven workers spent the tail waiting on the
twelfth. Nothing on the page reads it. `walk.js`'s `__walk` is the same seam.

**`LADDER` and `REPEAT` are there because this machine drifts, and the drift is larger than
most of what is being measured.** A full ladder takes ten minutes, and a reading taken ten
minutes after another is not a reading of the same machine: two runs of identical code came
in 1.34x apart on the same view, and an early before/after read a change that cannot touch
a field pass as having slowed one by 1.7x. Every before/after figure below was taken
**alternated** — before, after, before, after, on two views — and anything under about 30%
on a single pair of full-ladder runs here is noise rather than a result.

**Every figure below is the specialized build, and a figure from before it is not a
number about this tree.** The rewrite that put `field::sweep_row` under `compute_band`
moved thirteen of the eighteen modes it was measured over by 1.41x to 4.18x, so a pre-specialization reading —
draft 1's, the `x generic` column that has been retired, anything in a report written
before the manifest's third `engine_changes` line — describes a module this repository no
longer serves. Re-measure rather than quote: the harnesses above are here so that there is
always something to re-measure with.

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
`families.mjs` was written here the next day. `cut.mjs` and `level.mjs` joined them with
`explorer_perf_audit_ckpt136`. **`bench/hunt/` is the next entry and the largest**
*(pre_closeout_ckpt138, 2026-09-20)*: the bug hunt's own harness — `lib.mjs`, eight units and
four probes, ~2,400 lines — moved whole for the same reason, pruned of the one-shot probes
that confirmed a finding now fixed. `engine.mjs` is the wasm loader every one of them calls,
and `output.mjs` sends every run's numbers to `artifacts/`, which is ignored. Code is
committed, measurements are not.

**The hunt is a fourth kind of harness, and the only one that asserts.** The two above ask
what the arithmetic costs and why a page feels the way it does; `walk.mjs` is the third and
measures a program rather than a picture. A hunt unit measures neither — it drives the page
the way an impatient reader would and records a `findings` list beside its rows. It still
exits zero and `builder check` still runs none of it. It is also a **second CDP client**,
deliberately: `cdp.mjs`'s `send` has no timeout because a bench run sets patiences of three
and four hundred seconds on purpose, and a hunt needs the opposite — a call that does not
answer is itself the finding. `bench/hunt/lib.mjs` opens by saying so, and carries the eight
false alarms that each cost a verification.

**One of them asserts after all, and it is the exception that says what the rule is.**
`curves.mjs` is a *comparison* rather than a reading: it shades a ramp through every map in
the library and four tone curves and prints one hash, so a change to the operator's
arithmetic can be held to having drawn what it drew. It carries no threshold, because a
hash is not a number about this machine — it is the same answer everywhere, which is
exactly what the rest of these cannot be.

**And the browser-driven rig is tracked now too**, which this said it was not. It stayed
under `scratch/` while it was a session's worth of driver scripts and probe pages; what
finally moved it is that the figures it produces are the ones under *Where a page's time
goes*, and the rule is the plain one — a harness whose numbers are promoted to a README is
a harness a later reader has to be able to run. `page.mjs` is the four runs and `cdp.mjs`
is the fifty lines of websocket underneath them, and neither asserts anything either.

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
0.25, 7.77 s. A preview lands at a sixteenth of the samples before any of it. The shade
was main-thread and pool-independent at 150–500 ms when that was read, and is neither now:
see *The shade over the pool* below.

### Where a page's time goes *(explorer_perf_audit_ckpt136, 2026-09-19)*

884x496, which is what a 1600x1000 window gives the canvas; 12 logical cores over 6
physical; nine views spanning the cost range, driven by permalink through `page.mjs ladder`.

**The pool is finished, and that is the headline.** Utilisation on the full and the
supersampled pass is **0.92 to 1.00** on every view of the ladder, and the tail — what the
frame waits on after the second-slowest worker is done — is 0 to 65 ms of passes that run
for seconds. Against one thread, `smooth` at the spike anchor is 4 470 ms and the pool draws
it in 618 ms (**7.2x**); at the finishing supersample, 17 816 ms against 1 901 ms
(**9.4x**). On six physical cores that is the machine, not a scheduling problem, and it
means **worker count, tile size, transfer instead of copy and centre-out order have nothing
left to give here**. What is left is the main thread, the cut, and the arithmetic.

**A field band has no fixed cost, and a direct trap's band has a large one.**
`bench/cut.mjs` draws one frame as 1, 12, 46, 91, 181 and 410 bands: under `smooth` the six
readings are within a percent of each other at both supersamples, so the duration target may
cut as fine as it likes. Under a direct trap above one sample a pixel it may not. Those four
modes are reduced in the band that painted them and Lanczos-3 reaches three output pixels
either side, so `paint_band` iterates six output rows it will throw away — `(rows + 6) /
rows` of its own work, measured at **1.52x, 2.50x and 4.02x at 11, 4 and 2 rows a band**
against a predicted 1.55, 2.50 and 4.00. Aimed at `BAND_TARGET_MS` the finishing pass
reached two rows a band, so **most of what a direct trap cost was padding**. `TRAP_PAD_SHARE`
holds it to a quarter and the kill path in `#abandon` carries the cancel latency that the
fine cut was buying.

**The row floor was nearly retired on that measurement, and the measurement was blind.**
`MIN_BAND_ROWS` existed as a guess at per-band overhead; `cut.mjs` measured that overhead at
zero, so the floor went to one row, which let the quarter-resolution preview reach the pool's
own four-bands-to-a-worker target — 42 bands over 124 rows instead of sixteen — and its
utilisation went from 0.54–0.67 to 0.77–0.99. **And the preview got slower**, 14 ms to 61 ms
at the home view and worse on seven of the nine. A band is a `postMessage`, a transfer and a
`#place` on the main thread, about **1.8 ms** of it, and a harness that calls the module
directly cannot see a millisecond of that. Eight rows is the reading that won.

**The tone curve's cost is per stop and not per pixel.** `bench/level.mjs` shades one
1.75M-sample frame through maps of 2, 16, 64, 256 and 1 024 control points, with and without
a derived curve: the colouring holds at 117 ms and the curve costs **82, 175, 234, 452 and
1 353 ms**. `level::curved_stops` densifies the stops and pulls each one's chroma back into
sRGB by a 28-step bisection with an 18-step cap bisection inside it, and both already
early-out where the colour is in gamut — the cost is the stops. The library's median map has
**257** and its 95th percentile **512**, so a view a reader made pays 450–800 ms of it, twice:
once in the shade worker for the picture, and once on the main thread for the 512-pixel
palette strip. *(Both halves of that are fixed below — it is spent once now, and what it
costs is a third of this.)*

**A screen shade is mostly memory.** The finishing stage's shade measures 194–430 ms in the
kept worker where the module's own colouring of the same frame is 68–117 ms under Node. The
difference is the copies: the field is sliced on the main thread so the cache keeps it whole,
copied again into the worker's heap, and the picture is copied out and once more into an
`ImageData`.

**Cancel latency is 64 to 353 ms** to the first pixels of the view the reader asked for, at
80, 400 and 1 200 ms into a pass being abandoned, across the spike, a direct trap and a view
two ulps off the `f64` wall. A band in flight is waited out unless it is over `KILL_OVER`
targets, and that gate is what keeps a 3.9-second trap band from being the number.

**Before and after, alternated.** Cold open, medians of three, `page.mjs load`:

| cold open | before | after |
| --- | --- | --- |
| the first pass begins | 252 ms | **194 ms** |
| the first picture is up | 575 ms | **361 ms** |
| the finished picture is up | 1 471 ms | **1 221 ms** |
| longest main-thread task | 206 ms | **109 ms** |

And two views, four alternated readings each, `LADDER=interior,trap REPEAT=2`:

| | before | after | x |
| --- | --- | --- | --- |
| `interior`, first pixels | 238 ms | 148 ms | 1.6 |
| `interior`, finished | 6 595 ms | 6 650 ms | 1.0 |
| `direct_trap_ring`, first pixels | 199 ms | 78 ms | 2.6 |
| `direct_trap_ring`, one sample a pixel | 937 ms | 758 ms | 1.2 |
| `direct_trap_ring`, finished | 17 073 ms | **4 253 ms** | **4.0** |

`interior` is the control and says what it should: a field pass did not move, because
nothing in the change touches one. What moved is the padded band, the main thread, and the
pool's startup. A derived picture also reaches the screen at 845 ms instead of 1 191, which
is the palette strip's curve deferred to a task of its own rather than made faster.

**`simd128` is worth nothing here, measured.** A module built with
`-C target-feature=+simd128` was timed against the committed one per mode, alternated within
a run: **1.00x on all seventeen fields**, and 0.89–1.04 on the shades, which is this
harness's spread. That is the shape of the arithmetic rather than a compiler failing — an
escape-time recurrence is a serial dependency per sample, and vectorizing it means iterating
several samples at once, which is a different loop in the engine. The build flag is not
taken; `node explorer/bench/modes.mjs <other.wasm>` is how it was read and how it can be
read again.

**The module** is 785,424 bytes raw and 231,149 gzipped (2026-09-22; it was 763,343 and
228,670 on 2026-09-20, and the Phoenix plane's twelve specialized loops are the difference),
against draft 1's
190,240 and 70,639. **The pooled shade cost 45,366 of that raw and 14,842 gzipped** —
`shade_stats`, `shade_band` and `curve_stops`, and a colouring path that takes a row range
rather than a frame — which is what a reader pays for a finishing shade that is three or
four times faster and a main thread that does no colouring at all. It was 766,191 raw once the Walk tab's `screen` export was in, and
`strip = "symbols"` in `Cargo.toml` took the 48 KB `name` section back off; only a debugger
reads it. Pages' own gzip sends it as 217,606 bytes, measured on the live site 2026-09-19. The tone operator is 18,955 of that raw and 6,043 gzipped — two bisections and a
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

### What a walk costs *(walk_faster_ckpt138, 2026-09-20)*

`bench/walk.mjs`, the judges loaded, the machine otherwise idle, the tab's own defaults
except where a run says it pinned the plane. **Every figure here is a median over whole
walks**, because a walk is not repeatable: it picks its plane, its root and its quarters
with `Math.random` and no seed.

**Where a walk's time went, before.** Twelve walks, 983 s of wall time, summed by stage and
divided by what runs concurrently: **the descent is 72% of a walk**, the painting 23%, the
root search 5%. The prompt this was done for supposed the painting was the problem; it was
a quarter of it.

**One field tried in sixteen colourings.** Twelve walks a side over the default plane set:

| | before | after |
| --- | --- | --- |
| seconds per walk | 85.8 s | **26.1 s** |
| steps per walk, median / p90 | 14 / 21 | **12 / 13** |
| a rung | 4 199 ms | 1 424 ms |
| a place painted | 17 963 ms | **2 714 ms** |
| one candidate | 1 339 ms | **96 ms** |

⚠ **That threefold is not all the change, and the run says so.** A walk draws its plane
uniformly and the families cost up to 47x apart, so twelve draws do not level them: the
before run came up four phoenix, four multibrot6 and three multibrot5, and the after run
seven multibrot3 and multibrot4. **Pinned to one plane and alternated** — after, before,
after, eight walks each on multibrot6, the dearest of the six — it reads:

| multibrot6 | after | before | after (shipped) |
| --- | --- | --- | --- |
| seconds per walk | 67.5 s | 86.1 s | 74.9 s |
| mean | 60.0 s | 91.1 s | 70.5 s |
| p90 | 84.9 s | 166.3 s | 138.1 s |
| steps, p90 | 14 | **42** | 13 |

The two after runs are 1.11x apart on identical mining code, which is this machine's drift
and is the floor any claim here sits on. So **the honest figure on the dearest plane is
about 1.2x on the median and 1.2x on the worst**, and the threefold above is the default
set's plane mix as much as it is the code. What the cap does unambiguously is the **p90 of
42 steps**: one before walk ran 40 rungs over its two legs, took 166 s and painted nothing
at either end.

### The three levers, measured *(pre_closeout_ckpt138, 2026-09-20)*

The two the section above left for somebody else, and the twin's reserve, alternated the same
way and on the same machine. **A rung is the subject** — a walk's own length moved for a
second reason at the same time, which is the twin now always running.

**One recolour, which is the cleanest reading on the page.** Two independent pairs, pinned
and default, gave the identical pair of numbers:

| | before | after |
| --- | --- | --- |
| one candidate, median | 96 ms | **35 ms** |

**2.7x**, and 640x360 over 384x216 is 2.78 — so what this bought is exactly the samples it
stopped drawing, with nothing else in it. A rung follows it down: 3 761 -> 1 803/1 926 ms
pinned to multibrot6, 2 563 -> 601 ms over the default set, and a place painted 3 821 ->
1 375 ms.

**A whole walk is confounded and the record says so rather than picking the flattering
number.** Twelve walks a side over the default set:

| default set, 12 a side | before | after |
| --- | --- | --- |
| seconds per walk | 23.9 s | **20.6 s** |
| mean | 38.4 s | **24.5 s** |
| p90 | 84.4 s | **53.9 s** |
| a rung | 2 563 ms | **601 ms** |
| places actually painted | 4 | **12** |

and pinned to multibrot6, alternated after / before / after, eight walks each, with a
fourth run of the code as it is committed:

| multibrot6 | after | before | after | after (shipped) |
| --- | --- | --- | --- | --- |
| seconds per walk | 37.6 s | 47.4 s | 27.0 s | 21.2 s |
| mean | 53.2 s | 52.9 s | 31.8 s | 23.0 s |
| p90 | 149.0 s | 88.8 s | 75.6 s | 49.1 s |
| a rung | 1 926 ms | 3 761 ms | 1 803 ms | 1 286 ms |
| steps, median | 18 | 13 | 14 | 9 |

⚠ **The three after runs span 1.77x, and they fall in the order they were run.** 37.6, then
27.0, then 21.2, on code that differs only in how one batch of screens is awaited — a
machine getting quieter over an evening, not a program getting faster. The round before this
one put its drift floor at 1.11x and treated that as the bar any claim had to clear; this is
half again as bad. So **there is no whole-walk claim to make on the pinned plane at all**,
and `before` landing between the afters is the honest summary of it. The per-unit numbers
are where the reading is, because a recolour is the same arithmetic every time it is drawn
and came back **96 ms against 35 ms in two independent pairs**. The default set's mean and
p90 move further than its median for the older reason: the plane mixes differ again, three
phoenix against two and one multibrot6 against two.

**The twin comes back, and by construction rather than by luck.** 6 of 8 pinned and 8 of 12
over the default set before; **8 of 8 and 10 of 12 after** — and the two misses are the two
phoenix walks, which have no Julia twin at all. So it is every walk whose plane has one. It
is paid for in steps: 13 -> 18 at the median on the pinned pair, which is a walk doing
about forty per cent more work, and is why the median improves while the tail does not.

**The roster, measured where the walk paints rather than at a home view.** One recipe is a
field, its colouring and its gate, median over 13 draws each, at the widths the descent
actually reached:

| mode | a picture | x `smooth` | and at the home view |
| --- | --- | --- | --- |
| `smooth` | 1 046 ms | 1.00 | 1.00 |
| `tia` | 1 148 ms | 1.10 | 4.36 |
| `threads` | 1 502 ms | 1.44 | 4.52 |
| `smooth_angle_min` | 2 214 ms | 2.12 | 6.78 |
| `smooth_mean_angle` | 2 233 ms | 2.13 | 6.85 |
| `itinerary` | 2 820 ms | 2.70 | 1.19 |
| `smooth_stripe` | 2 912 ms | 2.78 | 12.26 |
| `stripe` | 4 076 ms | 3.90 | 11.94 |

**The last column is why this was measured and not looked up.** The per-mode table above is
mandelbrot at its home view and it does not order these the same way: `itinerary` is the
fourth cheapest thing on the page there and is 2.70x here, dearer than `threads`, which the
home view reads as four times `smooth`. A mined frame runs most of its samples to a much
higher cap, which compresses what a per-iteration difference is worth and leaves the
mode's fixed work standing. There is a clean gap between 1.44x and 2.12x, and the roster is
that gap.

**What a candidate costs now**, after: a field **643 ms** on the default set and 3 905 ms on
multibrot6, a recolour **94–96 ms** wherever it is taken, and the dear `threads` render
2 476 ms. Fifteen recolours of one field cost less than one extra field, which is the whole
of the change at a place.

**And the pictures are not worse, by the only reading this page has.** Over the two
default-set runs the kept picture's gate `P≥4` has a median of **0.184 before and 0.194
after**, best 0.833 against 0.917 — sixteen colourings of one field find as good a picture
as eight separate modes did. Thirteen kept places against seven is a thin sample and this
is not a claim that it never costs anything.

**The cap costs no depth.** The plane leg's best frame has a median width of 1.85e-5 before
and 1.48e-5 after, and 7 of 10 descents still end on a peak rather than on the cap — the
budget binds on the tail, which is what it is for. What it does change is the **Julia
twin**: both legs spend one budget and the plane leg spends it first, so a twin was walked
on 8 of 8 walks before and on 2 and 3 of 8 after. Splitting the budget in half would keep
every twin and halve the plane descent, which is the thing the patience rule was added to
fix, so it is not split. **A reserve is, instead** *(pre_closeout_ckpt138, 2026-09-20)*:
five steps that are the twin's and are added when its leg starts, so the plane leg is
exactly as long as it was and a walk with a twin runs a little longer. Five is over
`TWIN_STEPS`, so the twin is reached on every walk whose plane has one.

**What was left was the descent, and both of its levers were taken**
*(pre_closeout_ckpt138, 2026-09-20)*. A rung is one probe, four 384×216 screens and up to
four judged pictures, and on multibrot6 a single rung reached 11.8 s at p90. The two things
`walk_faster_ckpt138` could see and did not take:

- **the judged picture was drawn at 640×360 while the gate reads 384×224**, so 2.7x the
  samples the gate uses were drawn for the viewer's sake alone. It is drawn at 384×216 now
  and upscaled for the viewer — lower on-screen quality, taken deliberately for the speed;
- **the root search screened one candidate root at a time** while both screeners idled. A
  cell's straddling quarters are all at one rung, so at the bottom they are all candidates
  and go through the screen together, up to `ROOT_BATCH` — dispatched together and then
  **resolved in order**, returning the moment the first one passes. **It is the same
  search**: the batch is the level's own list in the order it was already going to be read,
  each is jittered in that order, and the verdicts are walked in that order, so the frame
  returned is the one the serial loop would have returned and the refusals counted before
  it are the ones it would have counted. What changes is only that some frames behind the
  winner are screened too, and a screen decides nothing but its own frame.

  ⚠ **And what it is worth cannot be read off `root_ms`, because most of that search is
  already free.** `row.root_ms` is measured through `await strip.ready()`, and a walk whose
  predecessor lingered waits `LINGER_MS` — **4,000 ms** of deliberate reading time — with
  the search running behind it. So `root_ms` is `max(search, linger remaining)`, with a
  four-second floor that four of one eight-walk run's values landed within 12 ms of. Over
  three alternated eight-walk runs the medians were 4,012 · 4,015 · 4,018 ms and the spread
  was 608 to 21,466: indistinguishable, which is what a change hidden behind a fixed wait
  looks like. The search is only on anybody's critical path in the half of walks that run
  past the linger, and n=8 cannot resolve a tail. The first cut of this was worse than
  serial and the measurement is what said so — it used `Promise.all`, so a descent that
  passed on its first candidate paid for four screens where the old loop paid one.

### The finish, measured *(walk_tab_ckpt140, 2026-09-22)*

`bench/walk.mjs`, the judges loaded, the tab's own defaults over the default plane set,
alternated after / before / after at twelve walks each. **Before is this tree with
`FINISH_MODES` at 0**, which is the previous commit's behaviour exactly — widening the Modes
roster changes nothing about what *Default* paints — so the A/B isolates the finish and
nothing else. The two after runs are pooled below, because they are the same code. The label
change carries the instrumentation: `candidates.stale()` answers with how long the strip said
*Current* and the walk's own row keeps it, which is the reading the whole ruling exists to
move; nothing on the page could report it before.

**How long the candidates strip says *Current***, from a walk's first candidate landing to
the next walk beginning:

| | before (12 walks) | after (24 walks) |
| --- | --- | --- |
| median | 2 857 ms | **12 099 ms** |
| every reading | 1 149 · 1 241 · 1 263 · 2 857 · 4 219 · 5 519 | 4 769 · 8 270 · 10 898 · **12 099** · 13 688 · 34 858 |

**4.2x on the median, and five of the six after readings are above every before reading.**
The sixth, 4 769, falls inside the before range, which is the honest shape of it rather than
a clean separation. The n is small on both sides because it is one reading per walk that
painted anything, and eight of twelve before and nine of twenty-four after cleared the bar.

**What it costs where it is spent.** A finish picture is a full field in a mode of its own:

| | before | after |
| --- | --- | --- |
| a place painted, median | 2 711 ms (n=8) | **6 232 ms** (n=9) |
| one finish picture, median | — | **1 681 ms** (n=27) |
| the finish's whole cost | — | **60.8 s** over 24 walks |
| one recolour, median | 36 ms | 35 ms |

So the finish is about **5 s at a place** and the burst is untouched. ⚠ Both mining
distributions are long-tailed and the after one more so — 1 320 to 36 523 ms against 1 009 to
5 187 — because a finish mode is drawn uniformly and `stripe` at a mined width is 3.9x
`smooth`. A place that draws three dear modes at a dear frame is the tail, and 36 s is what
that looks like.

**Sixteen of the seventeen modes were drawn** across 27 finish pictures in 24 walks, which is
the widening doing the thing it was widened for: a reader who never opens the config still
meets nearly the whole roster.

⚠ **There is no whole-walk claim here and the runs say so themselves.** Before came in at a
36.1 s median and a 41.7 s mean; the two after runs, on identical code, came in at **26.1 s
and 19.4 s** — faster than before, and **1.35x apart from each other**. A walk draws its plane
uniformly and the families cost up to 47x apart, so twelve draws do not level them, and the
runs differed in mix and in how many places cleared the bar. Against that, 60.8 s spread over
24 walks is not resolvable. The per-unit numbers are the reading, and the Current window is
where the ruling is.

### The shade over the pool *(explorer_shade_pool_ckpt136, 2026-09-20)*

The audit above left the field pass finished and the shade running on one thread. This is
what moving it took and what it was worth, and **both halves are bound at zero**: the
picture a reader sees is the picture they saw, and the pipeline's renders are the renders.

**What holds that, and it is not an argument.** `bands.test.mjs` assembles a pooled shade
and compares it with the whole-frame `shade` byte for byte — at one sample a pixel, at two
where the reduction pads, and on a two-lane composite. The page is held the same way from
outside: every view of the ladder plus a recipe, a flip, the edge transfer and two stored
tone curves, opened on the committed tree and on this one and hashed off the canvas and off
the palette strip. And the curve's own change is held to the whole colormap library —
**1,022 maps through four curves, 4,088 levelled ramps, one hash, unchanged.**

**What an edit costs, alternated.** `page.mjs edits` at the spike anchor, 884x496, twelve
workers: the page driven through its own controls, wall time from the click to the settled
picture, and `final` the same thing measured from the pass's own first stat line. Two after
runs and one before (a third was lost to a harness crash), and the three rows that touch no
shade — a pan, a zoom in, and the switch to `itinerary`, whose field is 29 seconds — come in
unchanged across all of them, which is what says the machine did not move under the reading.

| edit | before | after | x | before `final` | after `final` |
| --- | --- | --- | --- | --- | --- |
| palette | 246 ms | **98 ms** | 2.4 | 130 ms | **40 ms** |
| phase | 257 ms | **82 ms** | 3.1 | 155 ms | **41 ms** |
| cycles | 209 ms | **80 ms** | 2.6 | 122 ms | **36 ms** |
| gamma | 318 ms | **120 ms** | 2.7 | 211 ms | **47 ms** |
| Autolevel on (derives a curve) | 1 327 ms | **343 ms** | 3.9 | 837 ms | **277 ms** |
| Autolevel off | 346 ms | **86 ms** | 4.0 | 211 ms | **49 ms** |
| pan | 3 697 ms | 3 431 ms | — | 3 655 ms | 3 398 ms |
| mode → `itinerary` | 29 484 ms | 29 615 ms | — | 29 434 ms | 29 594 ms |

**And the longest main-thread task during an edit is zero.** Not "shorter": the observer
sees no long task at all on any of the thirteen interactions, against 68 to 363 ms before,
with the worst of those on the derived pass — the 512-pixel palette strip, redrawn through
`curved_stops`. The main thread now dispatches bands, places them and paints; the colouring
is in the pool and the curve is in the kept worker.

**The pool's own share of a shade is 0.57 to 0.97**, read off `__render.passes` the same way
the field passes are. It alternates by stage: the finishing pass at two samples a pixel sits
at 0.90–0.97 and the one-sample pass before it at 0.57–0.7, which is the right shape —
a quarter of the samples over the same twelve workers is where a band's `postMessage`, its
copy into the wasm heap and its `#place` stop being noise. **One band a worker** is the cut,
and not the four a field pass takes: a colouring costs the same per row wherever the band
lands, so there is nothing to balance and every extra band is another message.

**Cold open, medians of three alternated pairs.** `page.mjs load`:

| cold open | before | after |
| --- | --- | --- |
| the first pass begins | 185 ms | 186 ms |
| the first picture is up | 351 ms | 350 ms |
| the finished picture is up | 1 182 ms | **1 034 ms** |
| longest main-thread task | 107 ms | **67 ms** |
| long tasks in the open | 3, 230 ms | **2, 125 ms** |

A cold open is mostly the module and the pool, so the first two rows are the same reading
twice and should be; what moved is the finishing shade at the end of it, and one of the
three long tasks — the shade's — is gone.

**Where the time went instead.** A shade is three things now and only one of them is the
colouring. The frame-wide statistics are measured once in the kept worker and
**remembered**, because they read the field and the recipe's `transfer` and nothing else —
so a palette, gamma, cycles, phase or level edit over a field already measured pays no
reduction at all, which is most of what a recolour was. The tone curve is spent once on the
map rather than once for the picture and again for the strip. What is left is the colouring,
and that is the part the pool takes.

**The modulate and a rank transfer keep the one-worker shade, and that is a size rather
than a taste.** Both normalize by `coloring::Ranks`, which is the frame's valid samples
sorted: eight bytes a sample, 14 MB at the finishing supersample, against three numbers for
the percentile stretch and two hundred for the edge transfer's profile. Twelve copies of
the field is more than the colouring it would split. `itinerary` at the home view measures
**766 ms before and 733 ms after**, which is the old path unchanged and is the honest cost
of the carve-out: the modulate is now by a long way the slowest recolour on
this page, where the same edit under `smooth` is forty milliseconds.

**The tone curve's cost was an algorithm, not a price.** The audit measured it per stop —
82 ms at 2 stops to 1 353 ms at 1 024 — and read that as inherent to the bisections. It is
not. `level::gamut_fit` asks whether an Oklab colour survives the trip to sRGB by *making
the trip*: encode, decode, and see whether the colour came back. That is six `powf` and
three `cbrt` a probe, twenty-eight probes a bisection, and the cap's own bisection asks for
that whole bisection eighteen times. But the only lossy step in the trip is
`linear_to_srgb`'s clamp — so a colour whose linear channels are already inside the unit
interval **is** in gamut, by a range check and no transcendentals at all; and where the
clamp does bite, the decode is the clamp, because the transfer function and its inverse are
each other on every value that is not on the one seam where sRGB's two pieces fail to meet.
That seam is 7.3e-9 wide in linear light, it is named in the code, and a colour on it takes
the long way round. Everywhere else the substitution lands within **8.9e-16** in Oklab
against a threshold of 1e-6, measured over eight hundred thousand adversarial triples.

| map | the curve costs, before | after | x |
| --- | --- | --- | --- |
| 2 stops | 83 ms | 83 ms | 1.0 |
| 16 stops | 181 ms | 161 ms | 1.1 |
| 64 stops | 234 ms | 186 ms | 1.3 |
| 256 stops | 455 ms | 232 ms | 2.0 |
| 1 024 stops | 1 352 ms | 513 ms | 2.6 |

Those figures are `bench/level.mjs`, and each one is the whole derive — the tone measured
over the picture, the stops curved, and the picture coloured a second time. **`curved_stops`
alone is 3.3x**: 324 ms to 97 ms on a 256-stop map, 1 221 ms to 378 ms on a 1 024-stop one,
taking the colouring and the measurement off both sides. The library's median map has 257
stops, so that is what a view a reader made pays — and it pays it once now rather than
twice.

**What the pooled shade made worse.** Two things, and the second is the one worth watching.

**The module is 45,366 bytes larger raw**, 717,977 to 763,343, and **14,842 of that** after
gzip — `page.mjs load` reads the cold open at 981 KB on the wire against 961 KB. Three
exports and a colouring path that takes a row range rather than a frame is what it buys,
and the finishing shade is where it is spent.

**A fresh field's shade now crosses the lanes twice rather than once.** The statistics pass
copies the whole field into the kept worker, and then every band copies its own rows into
its own; a recolour skips the first of those because the statistics are remembered, and a
*first* shade of a new field does not. It is paid for and then some — the cold open's
finished picture is up at 1 034 ms against 1 182, and a pan is unchanged inside the noise —
but it is the shape of the trade and a machine with slower memory than this one would see
less of the win.

**And a third that is not this change's but is now the visible one**: `mode → smooth` and
`zoom out` moved by more than they should have between the two after runs — 280 against 114,
338 against 124 — which is a second pass landing on a cached field or not, rather than
anything about the colouring. Both are the cache's, both are unchanged here, and they are
named so that a later reading does not mistake that spread for this change's.

### What a visitor downloads *(explorer_slim_ckpt131, 2026-09-18)*

Audited against the live site's own headers: Pages sends gzip, at about level 6, and no
brotli. It gzips every text type and `application/octet-stream`, so `.jsonl`, `.bin` and
`.onnx` are compressed too; `image/*` is not. Headless Chrome over CDP, a fresh profile, a
1600×1000 window, sizes from `encodedDataLength`, with the staged files served:

| what | on the wire |
| --- | --- |
| cold open, to the first frame | **556 KB** (was 1,968) |
| … of which `engine.wasm` | 217 KB |
| … of which the 12 static JS modules | 115 KB |
| … of which `palettes.bin` | 182 KB (was 953) |
| … of which `gallery.jsonl`, the header | 1.6 KB |
| one gallery screen scrolled | about 150 KB |
| opening the atlas: records and one plate | 283 KB |
| the heaviest article page, `rendering-modes.html`, first load | 936 KB |

What moved it: `palettes.bin` went planar and byte-delta (`stops.js`), the gallery record
split by collection so only the header is in the first frame's wait, the plates were
rebaked at 2052 wide, the atlas stopped fetching plates while hidden, and every article
figure after a page's first carries `loading="lazy"`. The eager JS is about 126 KB on
2026-09-19, with the Saved tab's module in it. The Walk tab's own cost is under *The walk*.

**Declined** (Matt, 2026-09-18), each with the audit's estimate: AVIF tiles, about a third
off a screen of them; ORT's JSPI bundle, 2.6 MB off a Start but Chromium-only and not the
runtime the lab's fidelity table was taken on; ORT's CPU-only bundle, 3.0 MB off a Start at
the cost of the GPU; and a runtime of this page's own in WGSL for the two judges, about
6.6 MB off a Start and a week or two with its fidelity re-checked.

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
| `derived` | a v3 link without the key; a switch into a trap mode no seat here sits in; a trap's opacity after the first change a reader makes to a stored view | measures it every pass |
| `default` | a switch into an angle mode with no seat here and no texture held | keeps 0.5 |
| `pinned` | the reader moved the slider or typed in the box; a mode switch into an angle mode carrying a held texture | keeps it |

**A texture never becomes `derived` under the artist** *(Matt, explorer_ui_text_ckpt139,
2026-09-21)*. A trap's opacity decides every pixel it paints and is measured per frame by
design, so a stored opacity starts moving with the view at the first change, as it always
has. A texture does not: loading a `smooth_mean_angle` wallpaper and zooming used to
re-measure the weight off the new frame, which is the page picking a different texture than
the one the artist is looking at. So a value that came from anywhere explicit — a seat, a
link, the slider, the default a mode switch opens at — holds across every zoom, pan and
mode change until the slider moves or a reset puts another one there. `explorer.js` keeps
it in `heldWeight` as well as in `view.params`, because a mode change drops the parameters
of the mode being left and this is the one that has to survive it; a seat at this very
place in the mode being entered is more specific and still wins, and so does a link, which
by leaving `weight` out can still ask for one to be taken from the view. Only a view that
has never had a texture set derives one.

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
survives where the probe found nothing. A derived value lands in `view.params`, so the box
shows it, Copy link writes it, and a download draws at it instead of measuring again.
**A probe with no hits changes nothing**, and the status line says so: "Nothing in this view
comes near enough to the trap to paint" where the finished frame is one colour, and "Too
little of this view comes near the trap to measure" where a thin line the probe grid missed
is still there.

**There is no line beside the boxes any more** *(explorer_ui_text_ckpt139, 2026-09-21)*. Six
sentences lived there, one per state — `Texture taken from this view.`, `Opacity as this
wallpaper was made.` and the rest — and every one of them said where a number had come from
rather than anything to do about it. The number is in the box, and `Copy view` still carries
`params.source` for whoever is debugging a picture.

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

**`settledParams` refuses a key the mode does not spell, and never drops one**
*(ckpt141)*. `emit` writes only what `MODE_PARAMETERS` names, so a record that spelled
the texture weight in the engine's word lost it without a sound, and this function then
wrote the catalog's 0.85 where it had been. The atlas ingest had copied the ledger's
`texture_weight` verbatim, and 28 atlas slots opened at 0.85 over thumbnails drawn at
0.22 to 0.82. That was the atlas's fault and not this page's: native and wasm drew the
reported slot byte for byte alike at each weight. Every record writer passes through this
function, so a misspelled key now stops the writer instead of reaching a link.
`builder/links.py`'s `contract_params` is the one place a ledger recipe is renamed into a
link's parameters, and `builder check`'s **agreement** holds each atlas link to its
thumbnail.

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

### The Phoenix plane, and why it is not a 4 *(phoenix_tab_ckpt140, 2026-09-22)*

`f=phoenix_plane` carries **`px` and `py` and nothing else**: `c` is the pixel and z₋₁ is the
origin by the plane's definition, so `p` is the one constant left, a pair like every other
and always emitted. Its default is the classic Phoenix's own `p`, −0.5, baked out of the same
anchor row (`CONSTANT_SUBSET` in `builder/explorer.py`), so no number is typed for it here.

That is a new family and a key with a default, which the v2 note above calls a widening: a
link written before the plane existed parses exactly as it did and draws exactly what it drew,
a bare `f=phoenix` included, so **`v` stays 3**. `pa`/`pb`/`pp` were asked for and are not
keys: the Phoenix set already spelled `c` and `p` as `cx cy px py`, and a second spelling of
one number is how two contracts drift.

**The link says `phoenix_plane` and the engine says `phoenix_m`.** The naming rule refuses
shorthand in anything a reader meets, and `_m` (the Mandelbrot-type Phoenix) is shorthand in
a URL that is permanent. `render.js` renames it on the way to the module, the way it already
turns `multibrot3` into `{kind: "multibrot", degree: 3}`.

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
  one, and `phoenix_plane`, the Phoenix recurrence's own parameter plane. That is the
  engine's own view of it — a `Family::Multibrot` at degree 2 *is* the Mandelbrot set —
  spelled the way a reader would say it. `fractional_multibrot` is named
  and refused: it is a real family the article draws, but a non-integer degree needs a
  branch cut and the engine gives it no home view, so there is nowhere to open it at.
- **`cx`, `cy`, `px`, `py`, `zx`, `zy`** — the family's own constants, as decimal
  strings. `c` is half of a dynamical location's identity, the same `c` the wallpaper
  project's walk requires and refuses to guess; `p` is Ushiki's Phoenix memory
  coefficient; `z₋₁` is the previous iterate its recurrence starts with. A constant key
  on a family that has no such constant is refused, and says which constants that family
  does have. **And each of the three is two halves of one number, so a link carries both
  or neither** *(pre_closeout_ckpt138, 2026-09-20)* — the deep contract's rule, arriving
  here, and the refusal names the half that is missing. Half of a pair used to be filled
  from the shipped anchor: `?v=3&f=julia&cx=-0.4` drew
  c = −0.4 − 0.6514609012382414i, which is neither the set the link half-named nor the
  anchor, and the address bar then canonicalized to that hybrid — a saved link naming a
  set nobody chose, which is the one wrong this page cannot tell a reader about. **It can
  refuse no link this repository has ever written**: `emit` writes a family's whole
  constant list unconditionally, and all 40 linked rows of `links.jsonl` carry both halves
  of each pair. A truncated or hand-typed link is the only thing it catches, which is the
  point. **`x` without `y` is not the same thing and stays fine** — a frame coordinate has
  a stated default, the home view, so half a frame still names a place somebody could have
  meant; half an identity names a different object. The pairs are a declared table in
  `permalink.js` rather than the key list chunked in twos, which gives the same three
  today and is an accident of the emit order. **`z₋₁` was left out of v2's first draft, and the reason was wrong.** It is
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
  double would quietly rewrite a link that was more precise than today's renderer. Deep
  zoom has since arrived, and it did **not** arrive through this key: reading a coordinate
  here still means reading it into a double, so a deep view is a contract of its own with
  an exact decimal centre. See *Deep* above. `w`
  must be positive. Omitted means the **family's own home view**, which is
  `Family::home_view()` and not a number this file holds.
- **`a`** — the aspect, written `across:down`, defaulting to `16:9`, each side between 1
  and 10000. An aspect is a shape. **Pixel dimensions are not a field of the contract**:
  the canvas is drawn at whatever size the reader's window gives it, and a link does not
  carry a resolution.
- **`p`** — a palette **name**, which must be one the page carries. Names and never
  indices: a colormap added next year must not repaint a link saved this year. **The set
  a link may name is wider than the set the picker offers**: a link may name any of the
  library's **1,022** maps and the picker lists **77** of them. It used to be the curated
  set plus whatever this site's own figures landed in, which answered "can this figure be
  opened" and not "can any gallery seat be" — and 444 distinct maps are seated in the
  general record alone. A link arriving on an unoffered map draws it, and the picker
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

**And then the shade left that worker** *(`explorer_shade_pool_ckpt136`, 2026-09-20)*. The
two tables above are readings of a colouring that ran on one thread; what the kept worker
does now is measure the frame's statistics once and curve the map's stops once, and the
colouring itself goes over the pool a band a worker. The numbers that replace them are
under *The shade over the pool*. What survives unchanged is the paragraph above this one:
the kept worker is still where the serial half lives, it is still never interrupted, and a
recolour asked mid-measurement still waits for that measurement.

**Copy link and Copy view wait for a derived pass.** A pass that derives anything a link
carries — the tone curve, a texture weight, a trap's opacity — disables both buttons from
its start until it ends, because until the value lands the view still holds the last
pass's, and a link copied then would name a picture that is never on the screen. A pass
that derives nothing leaves them alone.

**The measurement is on the final stage and nowhere else.** The two-sample field is
coloured, what it drew is measured, and where the operator acts the stops are curved and
**the same field** is coloured a second time. That was one export — `shade_level`, in the
kept worker — because `shade` frees the lanes before it colours and a second call would
copy the whole field back in; since the shade went over the pool it is three calls whose
seam is the same one, `shade_band` over the pool, then `curve_stops` on the assembled
picture, then `shade_band` again through the stops it returned. Nothing measures the same
thing twice and nothing copies the field twice: the bands hold the lanes and the
measurement reads a finished picture. The render dot turns final only when the levelled
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
- **Half of an identity is refused** *(pre_closeout_ckpt138)*. `cx`/`cy`, `px`/`py` and
  `zx`/`zy` are each two halves of one number, and a link carries both or neither; the
  sentence names the half that is missing. Filling the other from the anchor drew a set
  nobody named and then canonicalized to it. `x` without `y` is not this — a frame
  coordinate has a stated default and half a frame still names a place.
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

`permalink.test.mjs` holds all of that: **53 tests**, Node's own runner, nothing
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

## Every pool is given back *(pre_closeout_ckpt138, 2026-09-20)*

**A document that navigates away does not take its threads with it.** Chrome keeps the old
document alive for the back/forward cache, and its workers are part of what it keeps. So a
reader moving about this site in one tab accumulated pools: alternating a deep link, the home
view and a gallery link, live worker count climbed 26 · 39 · 53 · 66 · 91 · 104 · 117 and
plateaued there, and past the plateau `WebAssembly.Instance(): Out of memory` came back from
`render.js` and `deep-worker.js`. The page answered with the studio up, the dot on
`rendering`, and no picture — **five of thirty loads**, and it recovered on a later one,
which is worse than failing cleanly: the explorer *sometimes* did not come up
*(explorer_bug_hunt_ckpt138, finding 1)*.

**Nothing leaks inside a document, and that is what made it hard to see.** 250 in-page
actions and 20 started and cancelled walks moved the heap 3.5 → 10 MB and the pools by
twelve workers, flat once the tabs' own pools had started. It is only the transition between
documents that accumulates, and no amount of looking at one document shows it.

So `explorer.js` listens for `pagehide` and asks every pool's owner for its workers back, in
the order they cost: the deep pool, which holds an instance and a reference orbit per worker;
the walk's renderer and its two screeners; the Saved tab's; the preview's; and the viewer's,
which is the largest. `Renderer.stop`, `ShadeWorker.stop`, `Screeners.stop` and the three
tabs' own are new; `DeepRenderer.stop` already existed and had no caller. One owner throwing
does not keep the rest alive — there is no reader left to tell, so the console is the whole
of the report.

**`pagehide` and not `unload`**, because a page carrying an `unload` listener is not eligible
for the back/forward cache at all, and that would trade this bug for a slower Back on every
navigation in the site. `pagehide` fires for both and `event.persisted` tells them apart. A
document that *is* restored from that cache has no workers any more, so it is a picture of a
page rather than a page: `pageshow` with `persisted` reloads it, which costs a render and is
the only honest answer.

**Measured, thirty alternating loads in one tab, deep link / home / gallery link:**

| | before | after |
| --- | --- | --- |
| loads that did not come up | **5 of 30** | **0 of 30** |
| live workers, peak | 117 | 27 |
| live workers, settled | 103-117 | 13 |
| boot ms, median / p90 / max | 1466 / 1562 / 2402 | 1465 / 1503 / 1514 |

`PORT=8014 node explorer/bench/hunt/probe-oom.mjs`. The worker count after is exactly one
document's worth — 13 for a shallow document, 25-27 for a deep one — which is the shape a fix
rather than a mitigation leaves. Boot did not pay for it: the median is the same to a
millisecond and the spread is tighter, because a load no longer starts against a hundred
live workers.

**The lazy starts the finding asked for were already there**, which is worth saying because
the finding's own fix line names them: the walk's pools start at Start, the Saved tab's at
the first tile it has to draw, and the preview's at the first hover that would draw one. What
started at boot was the viewer's pool and its shade worker, and the deep pool on a deep link
— and those are the page's subject rather than a tab's, so they stay. Nothing about a first
Walk, a first Save or a first preview moved: each costs a thread, one `WebAssembly.Instance`
of the already-compiled module and a message round trip, per worker, started together — no
fetch and no compile, because the module crosses to a worker as a compiled `WebAssembly.Module`.

## What the last bug hunt covered *(explorer_bug_hunt_ckpt138, 2026-09-20)*

So that the next hunt starts where this one stopped. Eight units over CDP, ~700 navigations,
215 link cases, 25 impatience bursts, 250 in-page actions, 20 walks. The harness is
`bench/hunt/` and is tracked; what it found is in this file, under the sections the findings
belong to.

- **Links**, 215 cases — every registry link, eleven families × four coloring shapes, and
  ~130 malformed across both contracts: bad, missing and duplicated version, family, mode and
  mode parameters; coordinates past 64 characters; `w` at zero, negative and overflowing;
  every aspect malformation; unknown and duplicated palettes; all seven shade keys at and past
  their bounds; both tagged kinds with and without their parameter; constants on families that
  have none; `iv` and `q` at both doors; each contract's keys at the other's; invalid escapes,
  a null byte, 200 unknown keys, and a 60 KB query. Every one either refused with the notice
  up and the dot stopped, or drew a picture whose address bar is a fixed point.
- **Impatience**, 23 of 25 bursts settled with the canvas matching its own link, verified by
  reopening in a second browser and comparing rasters. The two that did not were the drag
  bug (`f83b199`) and a burst that inherited its state.
- **The way back** across zoom, pan, mode, palette, phase and a minibrot returns both the link
  and the raster; forty steps past each end move nothing.
- **Files** — stamped PNG and JPEG reopen; plain PNG, text, JSON, empty, 50 MB and a corrupted
  stamp are each refused with a sentence; every download at every size round-trips its stamp,
  the deep one included at 88.3 s.
- **Storage** — a brace, `null`, an empty string, an array, a bumped version, non-link items
  and a 6 MB value each give an empty Saved list and never a throw.
- **Math** — every family's home view, all 17 modes × a cyclic and a non-cyclic map, all three
  `f64`-floor refusals, extreme aspects, all-interior and all-exterior frames.
- **The site** — 18 pages, clean consoles, no broken image, no root-absolute href, 19 gallery
  collections all non-empty, the atlas's 112 marks and its link into the explorer.

⚠ **The dev server has a capacity limit, and it looks exactly like a wrong-picture bug.** Four
browsers against one `python -m builder serve` produced `ERR_CONNECTION_REFUSED` on the
gallery's tile flood, which drew the home view under someone else's link. Three such refusals
survive even in a clean single-browser re-run. Run the units serially; `bench/hunt/lib.mjs`
carries this and the eight other false alarms that each cost a verification.

## Rebuilding

```
python -m builder explorer                 # palettes, blob, swatch, catalog, wasm, manifest
python -m builder explorer --palettes-only # when only the colormaps moved
python -m builder explorer --roster <stamp>  # and re-read each map's family and seat count
python -m builder links --write            # the link registry, from figure provenance
```

Needs the sibling checkout, `cargo`, and the `wasm32-unknown-unknown` target
(`rustup target add wasm32-unknown-unknown`). `engine-wasm/target/` is gitignored — it is
the several hundred megabytes cargo needs to produce a 718 KB file.

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

Nothing here is the Inflection tab's. Its two entries — a smarter snap, and marking the
three named places for a reader to take — were about a tab that is now paged out, and they
went into `paged-inflection/README.md` with it.

Listed, not designed. The first three are `explorer_perf_audit_ckpt136`'s, and each says what
it would buy and **how large the difference from the pipeline render would be** — an
explorer-only fast path is allowed here in principle and only where that difference can be
bounded, so a candidate that cannot state its bound is not a candidate.

**Two of that audit's five are built and are gone from this list**
*(`explorer_shade_pool_ckpt136`, 2026-09-20)*: the shade in bands over the pool, and the
tone curve applied once instead of twice. Both were bounded at zero and both landed at
zero — see *The shade over the pool* under *Measured*. What that prompt also found and did
**not** put in `§Next` is worth saying here, because it is the shape the remaining three
have: the tone curve's per-stop cost turned out to be an algorithm rather than a price, and
the fix held the bytes, so it was taken rather than listed.

- **`stripe` and the angle modes without the per-iteration `atan2` and `sin`.** `stripe` is
  18.0 s a frame at 1280x720 against `smooth`'s 1.62 s, and the per-mode table above says why
  the specialization bought it only 1.45x: the transcendentals are real arithmetic that the
  channel checks were a fraction of. **The bound is stateable and is not zero.** The stripe
  average is a sum of `sin(k·θ)` over the orbit, so a minimax approximation with relative
  error ε per term lands the field within about ε of the exact one and the colour within ε of
  a palette step — at 1e-7 that is orders under one sRGB8 code and invisible by construction;
  at 1e-4 it is not, and the bound is what says which. Engine change. Estimated 1.5–2x on the
  four most expensive modes on the page.
- **Interior and periodicity detection on the shallow path.** The ladder's `interior` view,
  a frame inside the main cardioid, is 6.6 s where the home view is 0.85 s, and it is
  expensive for one reason: every sample runs to the cap. The cardioid and period-2 bulb
  tests are two comparisons and **exactly zero difference** — a point inside them provably
  never escapes, so the field value is the value the loop would have reached. Cycle detection
  is the other half and its bound is *not* zero: it declares a point interior on a tolerance,
  and can mis-declare one whose orbit escapes slowly. What bounds it is that a point declared
  periodic at tolerance τ differs from the exact answer only where the true escape falls after
  the cap — that is, nowhere the picture distinguishes — and a mis-declaration inside that is
  a pixel that was going to be interior anyway. Engine change. Worth 2–5x on interior-heavy
  views and nothing at all on the rest, which is most of them.
- **`wasm-opt`, and why it is not measured.** Binaryen is not on this machine, and the
  locked conventions say no npm, so taking it would put a new build dependency in front of
  `python -m builder explorer`, which today needs cargo and nothing else. The honest estimate
  is **nothing on speed** — `simd128` measured 1.00x, and the module is already `lto = true`,
  `codegen-units = 1`, `opt-level = 3`, so LLVM has had its say — and 10–20% off the 210 KB
  gzipped transfer, which is a load figure rather than a render one. If it is ever worth the
  dependency, that is the number it has to beat.
- **A cheaper preview kernel, declined.** The quarter-resolution preview costs 14–185 ms
  across the ladder, which is 2% to 8% of the view it previews. There is nothing there.
- **Cooperative cancellation**: a flag the engine checks inside the iterate loop, so that a
  cancel stops the band in flight instead of waiting it out. It is the right final shape for
  cancel latency (see *Cancel is by generation* above), it is an engine change rather than a
  visibility one, and it is not scheduled.
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
