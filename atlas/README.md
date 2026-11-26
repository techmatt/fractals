# The atlas

Every place the fractal search has kept, marked on the plane it came out of. The plane is
a picture: rendered once, next door, and landed here. Every mark carries three more:
its neighborhood on the plane, the Julia set it stands for, and a wallpaper drawn at it,
and each of those opens in the [explorer](../explorer/README.md) at the view it is.

**This directory is a frame and a record, not a page.** The explorer's Atlas tab and the
article's Fractal atlases page mount the frame; `index.html` only redirects into the tab. The tab carries the color key (blue for a place
on the parameter plane, red for one on a dynamical plane) as a line above the frame
(`.place-key`), outside the fixed rectangle.

**It is one fixed frame, and there is no text in it.** It is sized once, in pixels, from
its host's box, and nothing changes height on hover, so the plate never moves under the
pointer. What a caption would say is a slot's `title`; the three slot labels sit on the
pictures.

```
index.html        the redirect into the explorer's Atlas tab, for the old address
frame.js          the frame: the marks, the three slots, and the one size it is
frame.css         the frame's own stylesheet, loaded by the page that mounts one
embed.js          the frame mounted live in an article page, over a live figure's well
links.js          a slot as a link: the one place a view is spelled, for two callers
record.js         the record, fetched and read
atlas.test.mjs    node --test atlas/atlas.test.mjs
atlas.jsonl       the index: how the record was made, and one row per plane
mandelbrot.jsonl  that plane's dots, and one file like it per plane:
multibrot3.jsonl  multibrot4.jsonl  multibrot5.jsonl  multibrot6.jsonl  phoenix.jsonl
```

## The frame is a piece, and a page mounts it

`frame.js` builds the frame inside whatever element it is handed and returns
`{ record, refit, destroy, open, plane }`; `frame.css` holds the frame's rules, including its four
colors, set on the frame itself so a host that knows nothing of them still gets them.
`frame.js`'s header and option comments are the reference.

- **The studio** mounts one with an `onPick`, which takes a click instead of the link and
  leaves the slots as keyboard-reachable buttons, and a `slotMark` (each slot's save mark).
  It uses
  `options.plane`, `options.onPlane`, and the handle's `open(name)` to hold the chips to
  its view: a chip opens that plane's home view, and a view on another plane moves the chip
  (a Julia set's is the parameter plane of its degree). An older `panel=atlas:phoenix`
  still opens the tab; the view says which plane.
- **`embed.js`** mounts the same frame into the well a live figure block leaves
  (`builder/figures.py`'s `LIVE`), once it nears the viewport. It passes no `onPick`, so a
  slot is a link and a click on a mark goes where its gallery slot goes; every link it
  builds carries `panel=atlas`, so a reader lands in the Atlas tab on that place's plane. It
  passes `fit: "width"`, `least: COLUMN_LEAST`, `linger: true` (as the studio does), and
  `miniatures` (each chip carries a grey
  miniature of its plate, `assets/images/atlas/miniature-<partition>.png`; the studio's
  chips stay words).
- **`fit` and `least` may be functions**, asked at every fit: the studio answers `"box"`
  beside the canvas and `"width"` stacked under it on a phone, with the floor 320 beside and
  `COLUMN_LEAST` stacked.
- **Everything the frame fetches** (the record, the thumbnails, `explorer/engine.wasm`) is
  resolved against `options.base`, which defaults to the module's own directory, so the
  relative-link rule is kept by derivation.
- **The size flows one way.** The frame fits the host's content box (a `ResizeObserver`);
  the host's size is its page's arithmetic, never the frame's. The plane strip sits outside
  the fitted rectangle; `refit` takes its height off the box and returns `total` beside
  `height`.
- **Touch.** A first tap on a mark fills the slots; a tap on the mark they show opens it
  (read at `pointerdown`). On overlapping marks each tap steps to the next, raised with
  `.mark-picked`. A mouse is unaffected.

**It does not open from `file://`**, for the reasons `explorer/README.md` gives. `python -m
builder serve` puts this tree on localhost.

## Six planes, and what differs between them is words

The record carries a partition per plane (**z² · z³ · z⁴ · z⁵ · z⁶ · Phoenix**), a strip
of chips above the slots, each the plane's power, its name the tooltip. A multibrot plane is the Mandelbrot plane at
another degree, with the Julia places of that degree drawn over it. **Phoenix is the
classic slice only**: its parameters are pinned, so every place on it is a frame on the
slice, drawn red, and its first slot is a neighborhood of the slice. A plane the search has
not reached is a plate with an empty dot file, and the frame says nothing about it.

So the partition row carries the words: `slot_labels` (what the two location slots say,
Multibrot 3 and Julia; on Phoenix, Phoenix and Close-up), `slot_maps` (the map under each
of those headers), and `julia_place` (what a red mark is announced as). The gallery slot's
label is the frame's own and has no map. A row also carries what is the plane's own: the
absorption radius, the neighborhood width, and the tally, since the maker thins every plane
at twelve pixels of its own base.

**A map is read from the engine and never typed.** `builder/atlas.py`'s `maps_of` renders
one from the family spec the plate was drawn at, transcribing `engine/src/family.rs`
(`Family::step`'s arms and each variant's doc comment). A family whose definition is not a
clean one line gets no map and a header with its name alone.

**A Julia dot's neighborhood plate is `JULIA_PLATE_WIDTH`** (`builder/atlas.py`, `"0.05"`),
the explorer's `BACK_WIDTH` transcribed, so the plate matches what Back to Mandelbrot
frames; `--make` applies it on the way into the maker. **Phoenix keeps the maker's own
0.25**: there is no back that lands on the slice.

**Every plane's slot pictures and plates are tracked.** A partition row's `pictures` is
`tracked` or `staged` (a staged plane with no files is a named skip in `check` and
`atlas.test.mjs`; none is staged now); the ingest keeps what the row says.

**A slot picture is WebP at `THUMB_QUALITY`, the one place on this site where 4:2:0 is
accepted.** It is a 400x225 thumbnail in a strip of three, shown at no more than
`frame.js`'s `MOST_UPSCALE` of its own pixels, and the slot pictures are the bulk of the
deploy. A plate is the picture a reader studies and stays JPEG 4:4:4 at `PLATE_QUALITY`.

**Every plate is cropped to its own set, at one aspect.** The engine's `home-view` reports
each family's extent; a plate is that rectangle widened to `PLATE_ASPECT` (9:8, the
studio panel's shape and the nearest simple ratio that holds the Mandelbrot set's antennae)
with `PLATE_MARGIN` of air, drawn `PLATE_LONG` across through the plate's grey ramp (all in
`builder/atlas.py`). A mark is placed from its coordinate, so it stays put at any plate size.

## The record is the deliverable

The atlas record is the **contract between the wallpaper project's maker and this frame**.
The maker writes it; `python -m builder atlas --ingest` turns it into what is committed;
`builder/atlas.py` holds it to shape and is the authority on what it may say.

- **A slot carries its own viewport keys**, as decimal strings, spelled as
  `explorer/permalink.js` spells them: `x`, `y`, `w`, and the constants the family needs.
  The page hands them to the contract untouched, never resolving a location by an index.
- **`px`/`py` are a place on a picture, not an identity**: JSON numbers, the plate's own
  pixels.
- **A slot's `colormap` is what the picture was drawn through, not what its link will
  say.** A link whose map the explorer does not bake falls back to `DEFAULT_PALETTE`; the
  tooltip does not mention it (Matt: the view is the view). `refused` lists everything the
  recipe holds that a link has no key for: that map, a `band_autolevel/v1` pass whose curve
  was not recorded, a curve a mode's catalog does not give it, a fold a cyclic map refuses.
- **A slot's `mode_params` are spelled in the contract's words, not the engine's.** The
  ingest renames ledger keys (`texture_weight` becomes `weight`) through
  `builder/links.py`'s `contract_params`, the one place a ledger recipe becomes link
  parameters. `links.js` passes them whole, and `settledParams` refuses a key the mode does
  not spell rather than dropping it, since a silent drop opens the slot at the catalog's
  default. `builder check`'s `agreement` holds every slot's parsed link to its recipe member
  for member (`builder/agree.mjs`) and draws a sample through the committed wasm beside its
  thumbnail, at `builder/agreement.py`'s `TOLERANCE`, with a control that must fail.
- **A slot whose cap its link cannot carry says `cap <n>` in `refused`.** A link carries no
  iteration cap; the page draws at the engine's depth policy. The ingest asks `agree.mjs
  caps` what each link will draw at and names the difference; the link stays.
- **A gallery picture's tone curve travels with it where it was recorded.** `tone` is
  `clean`, `curved`, or `lost`; a `curved` slot's `level` is the permalink's `level` value,
  passed through. A `lost` slot carries `autolevel band_autolevel/v1` in `refused` and a
  `gap`. `from` and `curve` are notes: the source run and its mode transform.
- **Both halves of the search are on one plane.** A `julia:mandelbrot` place is drawn at its
  own `c`, a point of the parameter plane, and shares the plate with the parameter places.

## One bar, and one kind to a dot

**The population is the fine bar and nothing else.** A place is on the plate because at
least one of its rows reads at or above the solve's own `DEFAULT_FINE_BAR`, so the third
slot is always a wallpaper somebody could seat.

**A dot is one place of one kind.** `plane` is `mandelbrot` (blue) or `julia` (red), the
frame's whole color language. A place inside the absorption radius of a dot already drawn
is dropped, whichever kind either is, so a dot's color is a fact about the place. The two
fixed slots wear a soft border of their own color; the Gallery slot's is deeper, the dot's
own kind, checked rather than copied.

## The two things that would break silently

**The map.** A picture whose colormap the explorer does not bake opens at
`DEFAULT_PALETTE`, and the two neighborhood plates are drawn through the record's
`canonical_map`. Those are the same map, which is what lets the tooltip name it. Neither
fact can see the other, so `atlas.test.mjs` pins it by name, with the reason.

**The refusals.** A rebake that adds or drops a baked map would leave the record's
refusals wrong; `atlas.test.mjs` derives them from the explorer's roster and holds the
record to them both ways. And **one function builds every link**: `links.js`'s `opened`,
called by the frame and the test and nothing else.

## Why the engine is here, and what it is not doing

The frame draws no fractal. It loads `explorer/engine.wasm` for one export, `plan`:
`permalink.js` decides whether a canonical link spells `x`, `y`, and `w` against the
family's home view, which is the engine's answer, never a typed table.

## Where the record came from, and how to rebuild it

`atlas.jsonl`'s method row names the record the seats were read out of (the gallery's
general collection, so `--make` defaults to `builder/seats.py`'s `STAMP`), the live judge,
the fine bar, and the maker's `tally`; each partition row's `dots` is that plane's share.
The maker is `fractal-wallpapers curate atlas`: it queues every seated place and then the
rest by best fine score, places them in one greedy pass, and writes
`artifacts/atlas/<partition>/` in that checkout, where `--ingest` reads by default.

```
python -m builder atlas                                  # what the record holds, and problems
python -m builder atlas --make [--record STAMP] [--plane NAME]  # run the maker next door
python -m builder atlas --ingest [<maker>/dots.json]     # rewrite a plane, or all of them
python -m builder atlas --plates                         # all plates, dots re-projected,
                                                         #   then miniatures and dive plates
python -m builder atlas --miniatures                     # the chips' miniatures, off the plates
python -m builder atlas --dive-plates                    # the Deep tab Dive block's slot pictures
```

**`--make`** runs that project's `curation.atlas.make` in its own interpreter, wrapping
`slots.views_of` so a dynamical place's plate is `JULIA_PLATE_WIDTH`, and refuses a plane
that came out with two plate widths. It takes tens of minutes; run it in the background.

**`--plates`** is idempotent: every number comes from the engine's measurement of a family
and each dot's own `place.at`, and the absorption radius is kept as `radius_plane` and
restated in pixels. The grey ramp is `builder/data/atlas-grey.json`. A miniature is its
plate cropped square to the set, shrunk, levels stretched so the boundary survives, written
as a lossless grey PNG; `check`'s `atlas` fails on a plane without one. `--dive-plates`
lands a small plate for each of `DIVE_PLANES`.

**`--ingest`** re-encodes every thumbnail at `--quality` (default `THUMB_QUALITY`), sweeps
`assets/images/atlas/` of anything no plane's record names, and writes the index and that
plane's dot file. A slot picture is `<partition>-<id>-<slot>.webp`, since ids restart at
nought on every plane. It ignores the maker's own 16:9 `base.jpg`, keeps every committed
plate, and projects each dot from its `place` onto its plane's plate, so an ingest never
undoes `--plates`. A plane made against another release, judge, bar, map, or thumbnail size
than the planes already in the record is refused, because the method row says those once.
