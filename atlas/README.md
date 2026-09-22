# The atlas

Every place the fractal search has kept, marked on the plane it came out of. The plane is
a picture: rendered once, next door, and landed here. Every mark carries three more —
its neighborhood on the plane, the Julia set it stands for, and a wallpaper drawn at it —
and each of those opens in the [explorer](../explorer/README.md) at the view it is.

**This directory is a frame and a record, not a page** *(website_webp_and_atlas_deprecate,
2026-09-21)*. `atlas/index.html` was a page of its own — the same frame, full bleed under
the site bar, with the kicker and intro below the fold — and the explorer's Atlas tab
supersedes it: the tab mounts this frame beside a viewer that draws the place a mark stands
for, which is what the standalone page sent a reader away to do. What is left at that
address is a redirect into the tab, because a URL is the one permanent thing this site
emits. The frame's own rules are unchanged and are stated below of the frame rather than of
a page.

**It is one fixed frame, and there is no text in it.** The strip and the plate are sized
once, in pixels, from the box its host gives. Nothing in the frame changes height when a
mark is hovered, because a caption that grew by a line moved the plate under the pointer,
which moved the mark the pointer was on. What the captions said is a `title` on the slot: a
tooltip is drawn over the page rather than in it, so it can say as much as it likes and cost
the frame nothing. The three slot labels are the one piece of text the frame carries, and
they sit *on* the pictures for the same reason.

```
index.html        the redirect into the explorer's Atlas tab, for the old address
frame.js          the frame: the marks, the three slots, and the one size it is
frame.css         the frame's own stylesheet, loaded by the page that mounts one
links.js          a slot as a link — the one place a view is spelled, for two callers
record.js         the record, fetched and read
atlas.test.mjs    17 tests, `node --test atlas/atlas.test.mjs`
atlas.jsonl       the index: how the record was made, and one row per plane
mandelbrot.jsonl  that plane's dots, and one file like it per plane:
multibrot3.jsonl  multibrot4.jsonl  multibrot5.jsonl  multibrot6.jsonl  phoenix.jsonl
```

## The frame is a piece, and a page mounts it

`frame.js` builds the frame inside whatever element it is handed and hands back
`{ record, refit, destroy, plane }`; `frame.css` is the frame's own rules, including the four
colours, which sit on the frame itself so that a page which does not know about them gets
them. The explorer's studio mounts one in a panel with an `onPick`, which takes a click
instead of the link and leaves the slots as buttons so that they are still reachable from
the keyboard. It is the only caller. **`keep` is gone with the page that spent it**
*(leftovers_rebake_ckpt140, 2026-09-21)*: it stored a clicked mark, nothing has read it
since the standalone page retired, and an option one caller passes `false` by name is an
option. What the retired page still leaves behind is the bare host it handed a size it had
worked out itself, which the frame goes on accepting.

Everything the frame fetches — the record, the thumbnails, `explorer/engine.wasm` — is
resolved against `options.base`, which defaults to the module's own directory. A page in
`explorer/` finds all three without saying so, and the relative-link rule is kept by
derivation rather than by a path written down twice.

The size is the other half of that split. The frame fits itself to its **host's content
box**, watched with a `ResizeObserver`, and the host's size is its page's own arithmetic.
The one-way flow is deliberate — a host that shrank to its figure and a frame fitted to that
host would be each other's input, and a pixel of rounding would chase itself.

**It does not open from `file://`**, for the reasons `explorer/README.md` spells out.
`python -m builder serve` puts this tree on localhost.

## Six planes, and what differs between them is words

The record carries a partition per plane — **z² · z³ · z⁴ · z⁵ · z⁶ · Phoenix** — and the
frame puts a strip of them above the slots. A chip is the plane's power rather than its
degree, because the headers over the slots carry the same map and a chip spelled `d=3` was
a second language for the one thing; the plane's name is the chip's tooltip. Every one has
marks. z⁶ was the plate alone until `site_rebase_ckpt132`: degree 6 is a plane the
wallpaper project searches without a single labelled row, and its first marks came with the
pinned general record, the first record to seat it. A multibrot plane
is the Mandelbrot plane at another degree, with the Julia places of that degree drawn over
it. **Phoenix is the classic slice only**: its parameters are pinned, so every place on it
is a frame on the slice and is drawn red, and its first slot is a neighborhood of the slice
where a Julia place's is a neighborhood of its parameter plane. A plane the search has not
reached is a plate with an empty dot file, and nothing says so: the frame carried a line
under the plate for it and no longer does.

So the partition row carries the words: `slot_labels`, what the two location slots say
(*Multibrot 3* and *Julia*; on Phoenix, *Phoenix* and *Close-up*), `slot_maps`, the map each
of those two headers carries under its name (*z ↦ z³ + c*; on Phoenix its own recurrence),
and `julia_place`, what a red mark is announced as (*A Julia place*; *A Phoenix place*). The
gallery slot's label is the frame's own and it has no map.

**A map is read from the engine and never typed.** `builder/atlas.py`'s `maps_of` renders
one from the family spec the plate was drawn at, transcribing the recurrences from
`engine/src/family.rs` — `Family::step`'s arms and the doc comment over each variant. So a
degree is written in one place, and a family whose definition is not a clean one line gets
no entry at all and a header with its name alone, which is true where a guess would not be. It also carries what is a plane's own rather than the atlas's: the
absorption radius, the neighborhood width and the tally, because the maker thins every plane
at twelve pixels of its own base and so at a different distance on each plane.

**A Julia dot's neighborhood plate is `BACK_WIDTH`, and that is this repository's number**
*(atlas_refresh_ckpt139, 2026-09-22)*. The first slot of a Julia mark is a neighborhood of
the `c` its set is drawn at, and the place a reader lands on from a Julia view in the
explorer is *Back to Mandelbrot*, which frames the parent plane **0.05** across. The maker
drew that plate at a twentieth of the plane's own home width — 0.22 on the Mandelbrot plane,
0.26, 0.22, 0.18 and 0.215 on the four Multibrots — so the atlas showed one frame and the
link under it opened another. `builder/atlas.py`'s `JULIA_PLATE_WIDTH` is the explorer's
constant transcribed, the way `builder/theme.py` transcribes the well colors, and
`--make` narrows the width for a dynamical place on its way into the maker. **Phoenix keeps
the maker's own 0.25**: its places are frames on the pinned slice, its first slot is a
neighborhood of that slice, and there is no *back* that lands there.

**Every plane's slot pictures are staged, not deployed.** `pictures` on the partition row is
`staged` for all six since `site_rebase_ckpt132` (2026-09-19), which rebuilt every plane from
a pinned general record and untracked Mandelbrot's slot pictures rather
than re-committing them; the pictures are listed in `.git/info/exclude` and the record
commits. The six plates stay tracked: a plate is drawn from the engine's home view and not
from a record, so a rebuild leaves them as they are. Until the pictures are deployed, the
served frame shows the marks over empty slots. A clone has none of the files,
and `check` and `atlas.test.mjs` each report that as a named skip. One staged picture
present means the ingest has run, and then the whole plane is held to its record.

**A slot picture is WebP, and it is the one place on this site where 4:2:0 is accepted**
*(website_webp_and_atlas_deprecate, 2026-09-21)*. All 1,464 of them were JPEG at 78 with no
chroma subsampling, the figures rule's encoding, and came to 42.72 MB — the second largest
thing this repository would ever deploy. At WebP 70 they are 27.47 MB, re-encoded from the
maker's own thumbnails rather than from the shipped JPEGs, so no picture took a second lossy
step. Lossy WebP is 4:2:0 always and that is the trade: a slot picture is a 400x225
thumbnail in a strip of three, shown at no more than `MOST_UPSCALE` of its own pixels, and
the plate under it is what a reader is reading. A plate is the picture somebody studies and
stays JPEG 4:4:4 at 88.

The strip and that line sit **outside** the fitted rectangle, and both change only when a
reader moves to another plane — never under the pointer — so the frame is still the one
fixed thing it has to be. `refit` takes their height off the box before it divides, and
hands back `total` beside `height` so a page sizing a band leaves room for them; the
retired page clipped its own plate for as long as that was one number.

Which plane is open is its page's to keep. `options.plane` opens one by the partition's own
name, `options.onPlane` says when the reader clicks a chip — the one already open included —
and the handle's `open(name)` moves the frame without saying so. The studio uses all three
to hold the chips to its view *(explorer_controls_ckpt129)*: a chip clicked opens that
plane's home view, and a view that lands on another plane moves the chip, a Julia set's
being the parameter plane of its degree. So the plane is no longer a key of its own; an
older `panel=atlas:phoenix` still opens the tab, and the view says which plane.

**Every plate is cropped to its own set, at one aspect.** The engine's `home-view` reports
the extent it measured for each family; a plate is that rectangle widened to 9:8 with a
tenth of air around it, drawn at 2052x1824 through the plate's own grey ramp and encoded
once, at JPEG quality 88 with no chroma subsampling. That is half the 4104 of the first
pass, and the six plates went from 5.44 MB to 1.25 MB *(explorer_slim_ckpt131)*: the panel
shows a plate well under a thousand CSS pixels across, and a mark is placed from its
coordinate, so it stays on the same place at any plate size. 9:8 is the
panel's shape rather than any set's — the studio's atlas panel is about four wide to five
tall, and the frame's own ratio is the plate's plus a fifth — and it is also the nearest
simple ratio that holds the Mandelbrot set with a margin, where 4:3 and 5:4 cut the
antennae off the top and bottom bulbs. The first plate was 16:9 at the whole home view and
filled a little over half the panel; this one fills four fifths of it.

## The record is the deliverable

The atlas record is the **contract between the wallpaper project's maker and this frame**.
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
  `band_autolevel/v1` pass whose curve was not recorded, a curve a mode's catalog does not
  give it, a fold a cyclic map refuses.
- **A gallery picture's tone curve travels with it where it was recorded.** The gallery
  slot's `tone` is `clean`, `curved` or `lost`; a `curved` slot's `level` is the curve as
  the permalink's own `level` value, and `links.js` passes it through, so the seat opens
  levelled. A `lost` slot carries `autolevel band_autolevel/v1` in `refused` and a `gap`
  saying what its run did not record, which the tooltip shows. `from` and `curve` are
  notes: the run the row came out of, and the mode transform it was drawn at.
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

**A dot is one place of one kind.** `plane` is `mandelbrot` or `julia`, and the frame's
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
`opened` is called by the frame and by the test, and by nothing else. There is no second
spelling to drift.

## Why the engine is here, and what it is not doing

The frame draws no fractal. The plate is a picture and so is every thumbnail; there is no
worker pool, no render loop, nothing baked into a canvas. The viewer beside it in the studio
is the explorer's, and knows nothing about the frame.

What it does need is `plan`. `permalink.js` decides whether a canonical link spells `x`,
`y` and `w` at all by comparing them against the family's home view, and home is the
engine's answer rather than a table anybody may type — a table of home views written into
this directory would be a second author of the contract. So `explorer/engine.wasm` is
instantiated for that one export, which is exactly what `builder/emit.mjs` and
`atlas.test.mjs` do on the other side of the boundary.

## Where the record came from, and how to rebuild it

`atlas.jsonl`'s method row names it: the record the seats were read out of, the live
judge, and the fine bar the population was cut at. The record is not a published one and
**nothing next door is published any more**: since `atlas_refresh_ckpt139` it is
`20260922T012627Z`, the `final139_general` solve — mining is closed and the twenty
`final139_*` records of 2026-09-22 are that project's only saved set — and it is the
general collection of the staged gallery too, which is why `--make` takes its stamp from
`builder/seats.py`'s `STAMP` when none is given. Its `tally`
is the census the maker took, from places queued to dots drawn and seated, and each
partition row's `dots` is that plane's share. The maker is
`fractal-wallpapers curate atlas`, writing `artifacts/atlas/mandelbrot/` in that checkout,
which is where `--ingest` reads with no path given. It streams the candidate ledger and
the fine head's pool scores, queues every seated place and then everything else by best
fine score, and places them in one greedy pass. It writes one directory per plane,
`artifacts/atlas/<partition>/`, and `--ingest` with no path takes every one that is there.

```
python -m builder atlas                                  # what the record holds
python -m builder atlas --make [--record STAMP]          # run the maker next door, all six planes
python -m builder atlas --ingest [<maker>/dots.json]     # rewrite a plane, or all of them
python -m builder atlas --plates                         # all six plates, dots re-projected
python -m builder atlas --figure atlas-places            # the plate and its marks, for §11
```

**`--make` is how the maker is run, and it exists so the Julia plate width has somewhere to
live.** It drives that project's `curation.atlas.make` in that project's own interpreter —
running its library, reading its stores, writing nothing but its own `artifacts/atlas/` —
and wraps `slots.views_of` so that a dynamical place's neighborhood plate is
`JULIA_PLATE_WIDTH` and everything else stays the maker's. Then it restates `plate_width` on
the payload from the plates that were actually drawn, and refuses a plane that came out with
two of them. It is twenty-odd minutes for six planes and it streams the maker's own progress
rather than holding it. Nothing next door changes: that repository is read-only from here,
and a width that is the explorer's own has no business being a constant over there.

`--plates` is idempotent by construction: every number it writes comes from the engine's
measurement of a family and from each dot's own `place.at`, and the absorption radius is
kept on the plane as `radius_plane` and restated in pixels against the plate the dots are
drawn on. The grey ramp is `builder/data/atlas-grey.json`, committed here so the maker has
no input in anybody's scratch.

`--ingest` is the second half of the maker and is committed for the reason the figure
makers are: a record nobody can rebuild is a record nobody can correct. It re-encodes
every thumbnail at the frame's own quality, sweeps `assets/images/atlas/` of anything no
plane's record names, and writes the index and that plane's dot file. A slot picture is
named `<partition>-<id>-<slot>.webp`, because ids restart at nought on every plane and one
directory holds them all. The sweep reads both suffixes, which is what took the JPEGs out. The maker still projects onto
its own 16:9 `base.jpg`; the ingest ignores that, keeps every committed plate, and projects
each dot from its `place` onto its own plane's plate, so an ingest never undoes `--plates`.
A plane made against another release, judge, bar, map or thumbnail size than the planes
already in the record is refused, because the method row says those once.

The figure is the only thing this module draws. It is the plate with the marks on it and
nothing else — no frames, no captions, no interface — because a still of a tool should be
the thing the tool is about rather than a photograph of its buttons.
