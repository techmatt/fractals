# The atlas

Every place the fractal search has kept, marked on the plane it came out of. The plane is
a picture: rendered once, next door, and landed here. Every mark carries three more —
the Julia set it stands for, its neighborhood on the plane, and the colored render a judge
scored — and each of those opens in the [explorer](../explorer/README.md) at the view it
is.

**It does not open from `file://`**, for the reasons `explorer/README.md` spells out.
`python -m builder serve` puts this tree on localhost.

```
index.html        the page
atlas.css         its own stylesheet, on top of the site's
atlas.js          the marks, the three frames, the caption
links.js          a slot as a link — the one place a view is spelled, for two callers
record.js         the record, fetched and read
atlas.test.mjs    10 tests, `node --test atlas/atlas.test.mjs`
atlas.jsonl       the index: how the record was made, and one row per plane
mandelbrot.jsonl  that plane's dots
```

## The record is the deliverable

The atlas record is the **contract between the wallpaper project's maker and this page**.
The maker writes it; the page reads it. `builder/atlas.py` holds it to shape and is the
authority on what it may say; what follows is why it says it that way.

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
  costing the link, and the caption says which ones did. `refused` is the record's list of
  everything the recipe holds that a link has no key for: that map, an `band_autolevel/v1`
  pass, a curve a mode's catalog does not give it, a fold a cyclic map refuses.
- **Both halves of the search are on one plane.** A Julia location is a value of `c`, and
  `c` is a point of the Mandelbrot parameter plane, so a `julia:mandelbrot` place is drawn
  at its own `c` and shares the plate with the parameter places. A place found on both is
  one mark with two `sides`.

## The two things that would break silently

**The map.** A picture whose colormap the explorer does not bake opens at
`DEFAULT_PALETTE`, and the two neighborhood plates every mark carries are drawn through
the record's `canonical_map`. Those are the same map today, which is what lets the caption
name it and have that mean something a reader has already seen. Neither fact is written
down anywhere the other can see, so it is pinned by name, with the reason attached, in
`atlas.test.mjs`.

**The refusals.** The record says which links cannot carry everything, and the explorer's
roster is what makes that true. A rebake that added a map the record calls unbakeable
would leave a caption warning about a link that works; a rebake that dropped one would
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

## Where the record came from

`atlas.jsonl`'s method row names it: the published record `20260914T171846Z`, the live
judge it was scored by, the top-quarter bar and the fine bar it was cut at. The maker is
`scratch/atlas_explore2/` in `fractal-wallpapers` — it streams the candidate ledger, the
score sidecar and the label stores, queues every seated place and then everything in the
top quarter by score, and places them in one greedy pass: a newcomer within the absorption
radius of a mark from the other plane merges into it, and one within the radius of a mark
of its own plane is dropped. 2,454 places queued, 57 absorbed, 2,245 dropped, 152 drawn.

```
python -m builder atlas                          # what the record holds
python -m builder atlas --figure atlas-places    # the plate and its marks, for section 11
```

The figure is the only thing this module draws. It is the plate with the marks on it and
nothing else — no frames, no captions, no interface — because a still of a tool should be
the thing the tool is about rather than a photograph of its buttons.
