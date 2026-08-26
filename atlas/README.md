# The atlas

One page per partition of the fractal search, showing every place it has kept: a mark on
the plane that place came out of, the plane itself rendered in the browser, and a link
from every mark into the [explorer](../explorer/README.md) at the view the mark stands
for. It is the second page on this site that runs code, and it runs the same code the
first one does — the permalink contract, the worker pool, the committed wasm module. It
adds no engine export and asks the engine nothing it was not already answering.

**It does not open from `file://`**, for the reasons `explorer/README.md` spells out.
`python -m builder serve` puts this tree on localhost.

```
index.html        the page
atlas.css         its own stylesheet, on top of the site's
atlas.js          what a reader touches: the pickers, the plates, the panel
links.js          a row as a link — the one place a view is spelled, for three callers
plot.js           the three layouts, the clustering, the heat ramp
record.js         the record, fetched and read
atlas.test.mjs    9 tests, `node --test atlas/atlas.test.mjs`
atlas.jsonl       the index: how the record was made, and one row per partition
*.jsonl           one file per partition: its dots, and its density grid
```

## The record is the deliverable

The atlas record is the **contract between the wallpaper project's maker and this page**.
The maker writes it; the page reads it. `builder/atlas.py` holds it to shape and is the
authority on what it may say; what follows is why it says it that way.

- **A dot carries its own viewport keys**, as decimal strings, spelled the way
  `explorer/permalink.js` spells them: `x`, `y`, `w`, and the constants the family needs.
  The page hands them to the contract untouched. It never resolves a location through a
  position in a list, or through an index into anything derived from live data next door
  — that shape draws at a moving target, and the day the pool grows the pictures stay put
  while the links under them quietly point somewhere else.
- **`at` is a place on a picture, not an identity**, which is why it is a JSON number
  while the viewport keys are strings. On a parameter plane it is the frame's own centre;
  on a dynamical one it is `c`, because the plane a Julia atlas is drawn over is the
  parameter plane its `c` came out of. The page reads `at` and never works out which.
- **The density grid is sparse.** 97 of 40,000 bins are lit in the fixture and 106 in the
  audited population, so the grid is a list of `[ix, iy, count]` and a bin holds a whole
  place: a walk's returns to one neighbourhood are a thousandth of a plane apart and a bin
  is fifty times that.
- **A judged dot carries what the judge saw** — the mode, the map, the score, and the file
  if one was pre-rendered — and the page never relabels it. That render exists; the
  palette control governs the places nobody has drawn yet.

## The one thing that would break silently

An unjudged place is drawn here, on demand, and the link beside it opens the explorer at
the same view. They agree because the search's node views are drawn palette-free through
`twilight_shifted`, and because that is the map `explorer/palettes.js` names as
`DEFAULT_PALETTE`. Neither of those facts is written down anywhere the other can see.

A rebake that moved the default, or a maker that changed what a node view is drawn at,
would leave every dot opening at a picture a shade off the one beside it — and nothing
would go red, because both halves would still be internally consistent. So it is pinned,
by name and with the reason attached, in `atlas.test.mjs`. Tamper-tested: pointing the
record's node view at another map fails two of the nine tests.

The second half of the same guard is that **one function builds every link**. `links.js`'s
`opened` is called by the page, by `builder/atlas_thumbs.mjs` — which draws the
pre-rendered thumbnails *through the link that opens them* rather than through a spec of
its own — and by the test. There is no second spelling to drift.

## The layout, and why it is three

The population is savagely clumped, and the clumping is not in the dots. One bin holds
two fifths of every keeper the search has admitted, and the thinning that makes the atlas
readable is exactly what throws that away: a place the search returned to a thousand times
and a place it found once become the same dot. A dot's frame is a millionth of a plane
wide at the median, so *where* it is is nearly as invisible as *how deep* it is at plane
scale.

There is no one right picture of that, so the page offers three and the density heatmap
draws over whichever is showing.

- **Plane** — the family whole, dots where they are. Complete and honest, and it spends
  most of its area on ground nothing was ever found in.
- **Plates** *(the default)* — the plane, and under it one plate per neighbourhood the
  dots gather in, each a render of that ground with a numbered rectangle on the plane
  saying where it came from. Position survives at every scale, and the empty ground stops
  being most of what is on screen. It is what an atlas has always meant.
- **Spread** — the plane, with dots pushed apart to a fixed pixel gap and a hairline from
  each to where it really is. It breaks position on purpose and draws the leader that says
  so; what it buys is a pointer target for every dot in a clump.

Plates and clusters are **derived from the record**, not typed: single-link clustering at
a fraction of the plane's width, ordered by how many keepers a group stands for, capped at
six. A record with different ground gives different plates.

## The fixture

`atlas.jsonl` says `"fixture": true` and the page says so above the plot, in the loudest
block on it. Every `location_key` opens with `fixture:`. Nothing here came out of the
search: the places are drawn around the parameter plane's own valleys and then **descended
to** — bisected between a point inside the set and a point outside until the pair is a
fraction of the width wanted — so that the set's edge actually runs through each frame.
The first fixture skipped that step and produced eighty-nine smooth gradients, which is
what a frame at a millionth of a plane looks like when its centre was chosen at plane
scale.

What is real is the **shape and the scale**, because that is what the page had to be
designed against: the audited counts, the separation radii, seven decades of width with
its median near a millionth, and one bin holding two fifths of everything.

```
python -m builder atlas                      # what the record holds
python -m builder atlas --fixture            # rewrite it
python -m builder atlas --fixture --thumbs   # and redraw the 64 judged renders (~2 min)
```

The fixture half of `builder/atlas.py`, `builder/atlas_thumbs.mjs`, and the JPEGs under
`assets/images/atlas/` all go when the maker lands. The rest — the loader, the checks, the
page, the test — is what the real record arrives into.
