# The atlas

Every place the fractal search has kept, marked on the plane it came out of. The plane is
a picture: rendered once, next door, and landed here. Every mark carries three more —
its neighborhood on the plane, the Julia set it stands for, and a wallpaper drawn at it —
and each of those opens in the [explorer](../explorer/README.md) at the view it is.

**It does not open from `file://`**, for the reasons `explorer/README.md` spells out.
`python -m builder serve` puts this tree on localhost.

**It is full bleed, it is one fixed frame, and there is no text in it.** Under the site bar
the stage takes the whole window; the strip and the plate are sized once, in pixels, from
the box that leaves, and the kicker, title and intro sit below the fold so that the first
screen is the figure. Nothing in the frame changes height when a mark is hovered, because a
caption that grew by a line moved the plate under the pointer, which moved the mark the
pointer was on. What the captions said is a `title` on the slot: a tooltip is drawn over
the page rather than in it, so it can say as much as it likes and cost the frame nothing.
The three slot labels are the one piece of text the frame carries, and they sit *on* the
pictures for the same reason.

```
index.html        the page
atlas.css         the page's own stylesheet, on top of the site's
atlas.js          the page: the notice, the error path, and the height the stage takes
frame.js          the frame: the marks, the three slots, and the one size it is
frame.css         the frame's own stylesheet, loaded by both pages that mount one
links.js          a slot as a link — the one place a view is spelled, for two callers
record.js         the record, fetched and read
atlas.test.mjs    12 tests, `node --test atlas/atlas.test.mjs`
atlas.jsonl       the index: how the record was made, and one row per plane
mandelbrot.jsonl  that plane's dots
```

## The frame is a piece, and two pages mount it

`frame.js` builds the frame inside whatever element it is handed and hands back
`{ record, refit, destroy, plane }`; `frame.css` is the frame's own rules, including the four
colours, which sit on the frame itself so that a page which is not this one gets them.
This page mounts one full bleed under the site bar with `{ keep: true }` — click a mark and
the frame goes on showing that place — and the explorer's studio mounts the same frame in a
panel with an `onPick`, which takes a click instead of the link and leaves the slots as
buttons so that they are still reachable from the keyboard.

Everything the frame fetches — the record, the thumbnails, `explorer/engine.wasm` — is
resolved against `options.base`, which defaults to the module's own directory. A page in
`explorer/` and a page here both find them without either saying so, and the relative-link
rule is kept by derivation rather than by a path written down twice.

The size is the other half of that split. The frame fits itself to its **host's content
box**, watched with a `ResizeObserver`, and `atlas.js` keeps the page's own arithmetic: the
stage takes the window's height, or the figure's, whichever is less, and the host inside it
keeps the whole box the stage's padding leaves. The one-way flow is deliberate — a stage
that shrank to its figure and a frame fitted to that stage would be each other's input, and
a pixel of rounding would chase itself.

## Five planes, and four of them waiting

The record carries a partition per plane — **Mandelbrot · d=3 · d=4 · d=5 · Phoenix** —
and the frame puts a strip of them above the slots. Only Mandelbrot has marks. The other
four are plates a reader can look at before the search has reached them: the slots stay
blank, and a line under the plate says the marks are still to come. Their dot files are
empty rather than absent, so the marks land later as rows and neither page changes.

The strip and that line sit **outside** the fitted rectangle, and both change only when a
reader moves to another plane — never under the pointer — so the frame is still the one
fixed thing it has to be. `refit` takes their height off the box before it divides, and
hands back `total` beside `height` so a page sizing a band leaves room for them; this page
clipped its own plate for as long as that was one number.

Which plane is open is the page's to keep. `options.plane` opens one by the partition's own
name and `options.onPlane` says when the reader moves; the studio puts it in its `panel`
UI key as `atlas:phoenix`, leaves the record's first plane unsaid, and never emits either
in a copied link. This page keeps no address for it.

**Every plate is cropped to its own set, at one aspect.** The engine's `home-view` reports
the extent it measured for each family; a plate is that rectangle widened to 9:8 with a
tenth of air around it, drawn at 4104x3648 through the plate's own grey ramp. 9:8 is the
panel's shape rather than any set's — the studio's atlas panel is about four wide to five
tall, and the frame's own ratio is the plate's plus a fifth — and it is also the nearest
simple ratio that holds the Mandelbrot set with a margin, where 4:3 and 5:4 cut the
antennae off the top and bottom bulbs. The first plate was 16:9 at the whole home view and
filled a little over half the panel; this one fills four fifths of it.

## The record is the deliverable

The atlas record is the **contract between the wallpaper project's maker and this page**.
The maker writes it; `python -m builder atlas --ingest` turns it into what is committed;
`builder/atlas.py` holds it to shape and is the authority on what it may say. What
follows is why it says it that way.

- **A slot carries its own viewport keys**, as decimal strings, spelled the way
  `explorer/permalink.js` spells them: `x`, `y`, `w`, and the constants the family needs.
  The page hands them to the contract untouched. It never resolves a location through a
  position in a list, or through an index into anything derived from live data next door
  — that shape draws at a moving target, and the day the pool grows the pictures stay put
  while the links under them quietly point somewhere else.
- **`px`/`py` are a place on a picture, not an identity**, which is why they are JSON
  numbers while the viewport keys are strings. They are the plate's own pixels, so the
  page divides by one number and a mark stays where it is at every width the page is read
  at.
- **A slot's `colormap` is what the picture was drawn through, not what its link will
  say.** The renderer next door knows a thousand maps and the explorer bakes a fraction of
  them, so a link whose map is not baked falls back to `DEFAULT_PALETTE` rather than
  costing the link, and the slot's tooltip says which ones did. `refused` is the record's
  list of everything the recipe holds that a link has no key for: that map, a
  `band_autolevel/v1` pass, a curve a mode's catalog does not give it, a fold a cyclic map
  refuses.
- **Both halves of the search are on one plane.** A Julia location is a value of `c`, and
  `c` is a point of the Mandelbrot parameter plane, so a `julia:mandelbrot` place is drawn
  at its own `c` and shares the plate with the parameter places.

## One bar, and one kind to a dot

**The population is the fine bar and nothing else.** A place is on the plate because at
least one of its rows reads at or above the solve's own `DEFAULT_FINE_BAR` — the bar a
gallery solve narrows its pool with. No union with the human verdicts, no top-quarter cut
by the candidate judge. That is what makes the third slot honest: the best row at a
qualifying place clears the bar by construction, so the Gallery picture is always a
wallpaper somebody could seat rather than a location view standing in for one.

**A dot is one place of one kind.** `plane` is `mandelbrot` or `julia`, and the page's
whole color language is that word: blue for a place on the parameter plane, red for a
place on a dynamical one. There is no merging across the two — a place landing inside the
absorption radius of a dot already drawn is dropped, whichever kind either of them is — so
the color a reader sees is a fact about the place rather than about what happened to land
near it. The two fixed slots wear a soft border of their own color always; the Gallery
slot's is deeper and says which kind of place *its* picture came from, which is the dot's
own kind and is checked rather than copied.

## The two things that would break silently

**The map.** A picture whose colormap the explorer does not bake opens at
`DEFAULT_PALETTE`, and the two neighborhood plates every mark carries are drawn through
the record's `canonical_map`. Those are the same map today, which is what lets the tooltip
name it and have that mean something a reader has already seen. Neither fact is written
down anywhere the other can see, so it is pinned by name, with the reason attached, in
`atlas.test.mjs`.

**The refusals.** The record says which links cannot carry everything, and the explorer's
roster is what makes that true. A rebake that added a map the record calls unbakeable
would leave a tooltip warning about a link that works; a rebake that dropped one would
leave a link falling back in silence. `atlas.test.mjs` derives the refusals from the
roster and holds the record to them in both directions.

The second half of the same guard is that **one function builds every link**. `links.js`'s
`opened` is called by the page and by the test, and by nothing else. There is no second
spelling to drift.

## Why the engine is here, and what it is not doing

The page draws no fractal. The plate is a picture and so is every thumbnail; there is no
worker pool, no render loop, nothing baked into a canvas.

What it does need is `plan`. `permalink.js` decides whether a canonical link spells `x`,
`y` and `w` at all by comparing them against the family's home view, and home is the
engine's answer rather than a table anybody may type — a table of home views written into
this page would be a second author of the contract. So `explorer/engine.wasm` is
instantiated for that one export, which is exactly what `builder/emit.mjs` and
`atlas.test.mjs` do on the other side of the boundary.

## Where the record came from, and how to rebuild it

`atlas.jsonl`'s method row names it: the published record the seats were read out of, the
live judge, and the fine bar the population was cut at. The maker is
`scratch/atlas_explore2/` in `fractal-wallpapers` — it streams the candidate ledger and
the fine head's pool scores, queues every seated place and then everything else by best
fine score, and places them in one greedy pass. Its own README has the build order.

```
python -m builder atlas                                  # what the record holds
python -m builder atlas --ingest <maker>/dots.json       # rewrite it and its pictures
python -m builder atlas --plates                         # all five plates, dots re-projected
python -m builder atlas --figure atlas-places            # the plate and its marks, for §11
```

`--plates` is idempotent by construction: every number it writes comes from the engine's
measurement of a family and from each dot's own `place.at`, and the absorption radius is
kept on the plane as `radius_plane` and restated in pixels against the plate the dots are
drawn on. The grey ramp is `builder/data/atlas-grey.json`, committed here so the maker has
no input in anybody's scratch.

`--ingest` is the second half of the maker and is committed for the reason the figure
makers are: a record nobody can rebuild is a record nobody can correct. It re-encodes
every thumbnail at the page's own quality and no chroma subsampling, sweeps
`assets/images/atlas/` of anything the new record does not name, and writes both JSONL
files.

The figure is the only thing this module draws. It is the plate with the marks on it and
nothing else — no frames, no captions, no interface — because a still of a tool should be
the thing the tool is about rather than a photograph of its buttons.
