# builder

The page generator. It writes the gallery pages and the gallery index, derives web-res
images and thumbnails, and checks the committed tree. Everything it writes is committed
HTML: the site never depends on the builder having run, and GitHub Pages never runs
Python. A build is done here and reviewed in a diff.

```
python -m builder build     regenerate gallery pages, the gallery index, thumbnails,
                            and the contents rail every page carries
python -m builder check     twenty named checks: links, page sync, contents, figure
                            blocks, seat panels, landings, one location to one figure,
                            explorer links, the atlas record, each atlas link against
                            its picture, the explorer's bake, embedded links, assets,
                            the palette record, prose, the editorial pointer, theme,
                            banned vocabulary, em-dashes, line endings
python -m builder figure ID print a figure's markup block, to paste into an article page
python -m builder figures [--all]   what is still to make, grouped by page
python -m builder figures --place ID SRC [--crop l,t,r,b] [--max-width N] [--lossless]
                            [--provenance FILE]   land a finished figure in one step
python -m builder locations [ID ...] [--place] [--replace]
                            draw the figures of the Finding good locations page
python -m builder judges [ID ...] [--place] [--replace]
                            draw the figures of the Training judges page
python -m builder palettes [ID ...] [--place] [--replace]
                            draw the figures of the Color palettes page and the
                            pages that hang off it
python -m builder palettes --library   refresh palettes/library.jsonl and land any
                            strip the all-palettes page is missing
python -m builder growth [ID ...] [--stamp S] [--place] [--replace]
                            bake the growth figure from the curation growth
                            instrument's latest stamped run next door
python -m builder picks [ID ...] [--place] [--replace]
                            draw a figure whose panels are named by tentative-gallery ID
python -m builder deep [ID ...] [--place] [--replace]
                            draw the figures of the Deep zoom page through the Deep tab's
                            own contract, kernel and shading
python -m builder front [ID ...] [--place] [--replace]
                            draw the front page's picture, index-hero, one spec panel
python -m builder pipeline [ID ...] [--run R] [--place] [--replace]
                            bake the Full pipeline charts read off a run's own
                            walk ledger next door
python -m builder diagram ID draw one of the three figures that are diagrams, not renders
python -m builder seats [--records-only]
                            land the general gallery and the nineteen collections next
                            door as one staged gallery: the record and a tile per seat
python -m builder deep-gallery thumbs   draw a tile for each row of the Deep tab's
                            gallery register that has none (staged, untracked); the
                            other stages are the search that found the first set
python -m builder phoenix-points   choose the Phoenix tab's starting points from the
                            staged gallery's Phoenix seats; draw each whole set's tile and
                            its plane frame through the committed wasm; write the record
python -m builder explorer [--palettes-only]  bake the explorer's palettes, wasm, manifest
python -m builder links [--write]   derive every picture's explorer link from its
                            provenance, or the reason it has none
python -m builder serve [--port N]  preview the committed tree at http://localhost:8000/
python -m builder prose [PAGE ...]  hold a placed page to the document it was placed from
python -m builder review PAGE [--read [--full]] [--consume] [--force] [--list]
                            build the doc a page is reviewed in, or read one back
python -m builder import SRC DEST [--crop l,t,r,b] [--max-width N]
```

`serve` is the way to look at the site locally. The pages open from the filesystem too —
that is a rule and it stays true — but Chrome does not keep a zoom level for `file://`,
so a preview opened from disk resets to 100% at every click. Over localhost the whole
site is one origin and the zoom holds. It serves the committed bytes and builds nothing.

Install what it needs with `pip install -r builder/requirements.txt`.

**`check` runs on a bare clone.** Every check it makes runs against this repository and
nothing else — that is the whole contract, because CI clones this repository alone and
a check that cannot run there is a check nobody runs. Two things it will use if they are
here and does not need: the wallpaper project's checkout, which is what the `library`
check, the `bake` check, the `seats` check, the source-key half of `figures` and the
next-door half of `stamps` want; and Pillow, which is
what lets `figures` and `assets` verify pixel sizes. Missing either is a **named skip** —
the check line says `skipped` rather than `ok`, and the exit summary counts them — never a
failure and never a silent pass. `check` once built the palette library page straight off
that checkout, so on a machine without one it raised before the first check ran and every
check after it went unrun; the page is built from a committed record now, and this is why.

**So a green CI is not a green tree.** `library`, `bake` and `seats` ask nothing on a bare
clone and `figures` asks half, which means the two explorer rosters, its generated modules,
every seat panel's agreement with the picture its gallery ships, and every source key a
figure cites are certified **only on a machine that has the checkout**. Run `python -m builder check` here, with `FRACTAL_WALLPAPERS_ROOT` set or
`local.toml` in place, before a checkpoint — and read the exit summary's skip count, which
is what says whether the run that just passed was the whole question or part of it.

**And a red run on this machine can be the checkout moving under it.** A `candidate` source
key is resolved by streaming the candidate ledger next door, and a streamed read of a file
being rewritten under it reports a missing key rather than an error: `check` failed twice on
*not in the candidate ledger* on 2026-09-17 while a running leg rewrote `rows.jsonl`, and
the same keys resolved once it finished. So a missing key during a live merge, depth leg or
solve next door is transient before it is anything else; run `check` again when that work
is done before believing it.

## A gallery is a directory

```
assets/images/galleries/<slug>/
    gallery.jsonl     one header record, then one record per image, in page order
    <image>.jpg       the web-res image the page links to
    thumbs/<image>.jpg  generated
galleries/<slug>.html   generated
galleries/index.html    generated, one cover tile per gallery
```

The directory name is the slug and the slug is a permanent URL, so it answers to the
naming rule in `CLAUDE.md` first. `gallery.jsonl` records each image's pixel dimensions
rather than the builder reading them off disk — that is what makes page generation a
pure function of text, and it gives `check` something to hold the files to.

The header record's `blurb` is one sentence saying what the collection is, and it does
two jobs: it captions the gallery's cover tile on the index, and it is the first sentence
of the gallery page's own lead. One sentence rather than two fields, because a second
field saying nearly the same thing is a copy free to drift — and neither of them sits
above the title, since `writing-guidance.md` cut the standfirst site-wide.

Metadata is JSONL with an integer `schema` on every line. A line announcing a schema
this builder does not read is an error, not a guess.

## A gallery may be staged, and then nothing is generated from it

A header record saying `"staged": true` means **the record and its pictures exist, and no
page is made from them**. There is no `galleries/<slug>.html`, no cover tile on
`galleries/index.html`, and no row in `explorer/links.jsonl` — a staged gallery is not
somewhere a reader arrives, so there is nothing for a link to sit in the corner of. What
reads one is code that wants the *record*: the explorer's gallery panel, which is handed a
thousand seats and the permalink each of them opens at.

`galleries.load_all()` is the publishable galleries and `galleries.staged()` is the rest,
so the page generator, `check`'s **pages** and the link derivation are written as though
staged galleries did not exist. That is the whole safety of it: a staged record cannot
grow a page by somebody forgetting a flag in one of three places.

Two fields relax, in a staged gallery and only there. An image row's `title` and `caption`
become optional, because such a record is a machine's reading of records next door rather
than anybody's prose, and a thousand invented captions would be a thousand claims nobody
made. **`alt` does not relax.** A picture a reader can be shown owes them a description
whatever it is filed under, so a staged row derives one by rule — what drew the picture,
and the hue family its colour reading puts it in.

**Every seat has a family** *(2026-09-19)*. The record next door files a seat under a
family only where the picture is *dominant* in one, and ten of the 6,062 were dominant in
none; the panel's filter carried an *unfiled* chip for them, which is a threshold's name
offered to a reader looking for a colour. A seat the record leaves unfiled now takes the
family its own colour reading favours most — the first entry of `hues`, which is sorted by
share — and a seat whose picture reads no colour at all is a `SeatError` rather than a
quiet `null`. This is presentation: nothing next door moves, and the dominance rule the
record was written under is untouched.

The pictures are untracked, the record commits. So the **assets** check has a third
machine state to report beside the missing checkout and the missing Pillow: a staged
gallery whose directory holds none of the pictures its record names is a **named skip**,
not a pass and not a failure. One picture present means the command has run, and then the
whole gallery is held to its record exactly as a publishable one is — a half-landed
directory is a real problem and reads as one.

`seated-candidates` is the first, and `builder/seats.py` is what fills it: twenty-one
tentative records, the general n=1000 solve, the same solve at n=2000
*(pre_closeout_website_ckpt140)*, and the nineteen collections solved beside them (twelve hue
families and seven modes), as one union of 6,299 seats, each row saying which collections
seat it and where *(site_rebase_ckpt132, 2026-09-19)*. None of them is published. The
header's `published` is asked of the project next door's `tentative.PUBLISHED` rather than
assumed. `COLLECTIONS` hand-lists them as (name, stamp) pairs, `MODE_COLLECTIONS` says which
are modes and `GENERAL_COLLECTIONS` which are the general gallery at a size, so a re-solve is
an edit to that table. A stamp is refused unless its solve was that collection's:
`final139_<collection>` for all but `general_2000`, whose solve `SOLVE_NAMES` spells whole as
`final140_general2000`. The union is written **split by collection** *(explorer_slim_ckpt131)*:
`gallery.jsonl` holds the header alone, and each collection's rows go to the file its
header entry names (`general.jsonl`, `smooth-mean-angle.jsonl`, …), so a seat in three
collections is a row in three files. `galleries.load` reads the union back from them, and
`seats` removes any tile the record no longer names. **A staged gallery's picture is its tile**, a 316 px WebP, and there are no
thumbnails: the explorer draws the picture itself on a click, so **assets** holds the file to
its record and asks for nothing smaller. Every seat is read three times over, for the seat, the recipe and
the tone curve the run acted with, with the permalink for each emitted by the contract
itself through `builder/emit.mjs`. Where the link is not quite the picture the row says so
in a `gap` clause: a curve the run recorded as a fact and not as coefficients, a curve a
mode's identity fixes, an iteration cap the depth policy answers differently.

## No full-size wallpaper is written here, and the ones that are carry their link

*(embedded_links_ckpt145, 2026-09-23.)* Every full-size wallpaper this project writes
carries, in its metadata, the explorer link that draws it again — `explorer/README.md`'s
*And the same link, absolute, where ordinary tools look* has the fields and why. Two writers
exist, and **the builder is neither**: everything it writes is web resolution, landed
through `images.land` at `WEB_RES_MAX_WIDTH` or smaller (figures, gallery and atlas tiles,
the Deep gallery's thumbnails), and the deep gallery's `render` stage draws 640×360 work
files under `artifacts/`. If a builder step ever writes a wallpaper a reader downloads,
`images.land` is where the stamp goes, and `explorer/stamp.js`'s layout is what it writes.

The two writers are the explorer's downloads and the release writer next door
(`curation/release.py`'s `render_task`, which every leg rendering at release geometry
comes through, the phase-3 2560×1440 ss4 pass included). The second spells the permalink
in Python, which `emit.mjs` says should not happen, so `check`'s **stamps** holds it to the
contract: every seat of the general collection spelled both ways to the same string, and
one PNG and one JPG embedded both ways to the same bytes. The base both use is `SITE_URL`
with `explorer/` after it, and the hosting choice is not made: moving it is one line in
`pages.py`, one in `explorer/stamp.js` and one in `curation/explorer_link.py`, and `stamps`
fails until all three agree.

## What is staged, and goes in at deploy

`CLAUDE.md`'s staging rule keeps gallery- and library-sized files out of history until Matt
says deploy. They sit in the working tree untracked, named in `.git/info/exclude`. That file
is local and no clone has it, so this list is the tracked record of the set:

| what | size (2026-09-21) | written by |
| --- | --- | --- |
| `assets/images/galleries/seated-candidates/*.webp`, one tile a seat | 6,299 files, 62.8 MB (2026-09-22) | `python -m builder seats` |
| `explorer/palettes.bin`, every map's control points | 1.04 MB | `python -m builder explorer --palettes-only` |
| `explorer/palettes-swatch.png`, to look at | 0.3 MB | the same |
| every plane's atlas slot pictures, `assets/images/atlas/<plane>-*.webp` | 1,464 files, 27.5 MB | `python -m builder atlas --ingest` |
| `explorer/deep-gallery/*.webp`, the Deep tab's gallery tiles, one a register row | 31 files, 0.39 MB (2026-09-23) | `python -m builder deep-gallery thumbs` |
| `explorer/judges/`, the ORT runtime and the render judge (the fine head is no longer placed, pre_closeout_website_ckpt140) | 33.8 MB | `python -m builder walk` |

**`palettes.bin` is not optional.** The tracked tree alone never draws a first frame: served
without the blob, the explorer's first fetch is a 404 and the canvas stays empty. Until a
deploy, a push to Pages shows the atlas marks over empty slots, a gallery panel without
tiles and a Walk tab running on the screen alone.

The slot pictures were JPEG at 78 with no chroma subsampling until
`website_webp_and_atlas_deprecate` (2026-09-21) re-encoded all 1,464 as WebP at 70, from the
maker's own thumbnails rather than from the shipped JPEGs. The `.jpg` patterns stay in
`.git/info/exclude` so a tree still holding the old copies cannot stage them by accident.

**The Phoenix tab's starting points are chosen from this gallery and drawn here**
*(phoenix_named_points_ckpt141; drawn rather than copied since
phoenix_keypoints_and_plane_ckpt141)*. `python -m builder phoenix-points` reads the Phoenix
rows of this gallery and `p_ge4` from each collection's tentative record next door, so it
needs the checkout. It is not part of `build` or `check`. The rule is in
`builder/phoenix_points.py`'s docstring and on the record: seats that start at z₋₁ = 0,
one per exact `(p, c)`, single-linkage neighbourhoods at 0.35 in `(Re p, Im p, Re c, Im c)`,
the best seat standing for each, meaning a link that is its picture first and then the
highest `p_ge4`, and seven taken farthest-first in `p` from the classic. A point's `c` may be
Matt's rather than its seat's: `OVERRIDES`, keyed by exact `p`, sets it after the choice and
before the draw, and the row says `override` *(phoenix_points_fix2_ckpt141: at `p = 0` the
seat's `c = 0` is a plain disc, and `c ≈ 0.25` replaces it)*.

A seat is where a point was found and not what its tile shows. `builder/phoenix_points.mjs`
draws each point through the committed `engine.wasm`: the **whole Phoenix set** at its
`(p, c)`, at the family's home view and 316×178, 2 samples a pixel, WebP at
`TILE_WEBP_QUALITY`. It also records `plane`, the frame the tab's plane opens at on that
tile's click: the filled set of `phoenix_m` at that `p`, found in a width-8 look and then a
close one, boxed with `c`, padded 1.3 and set to 16:9. Both are drawn in `STYLE` in
`phoenix_points.py` (`smooth`, `twilight_shifted` (shown as Violet Rosewood), gamma 0.38). It is the one place
the tab's style is written, and the record carries it to `phoenix.js`. The frames are
measured through the committed wasm, the module that will draw them, rather than through
the native `fractal-engine`, which knows `phoenix_m` only once it has been rebuilt after the
engine edit that added it (`CLAUDE.md` has the caution). Eight tiles, the classic's included, 16.6 KB. Rerun it when a
re-solve moves the seats or when the style changes; either lands as a diff in the record
and in `explorer/phoenix-points/`.

What stays tracked: every record (`gallery.jsonl` and the per-collection files, the atlas
record), `palettes.js`, and the six atlas plates, because a plate is drawn from the
engine's home view rather than from a record. How each item reaches Pages is deploy
preparation, and `docs/page-review.md`'s *Leftovers* carries it.

## A page may hang off a section without being one

`article/` holds exactly the twelve ratified sections, and `check` refuses an HTML file
there that `sections.jsonl` does not list. A page that belongs to a section without being
part of the reading order — the palette library, the palette prompt — lives in its own
directory and is named with a slash wherever a registry names a page:
`palettes/make-your-own.html`. `paths.carrier_path` is the one place that resolves the
two spellings, and a bare file name still means an article section, which is what every
row said before these pages existed.

Such a page carries the rail like a gallery does, with no current entry, and `check`
holds it to today's rail. `sections.HANGING` is what makes it hold: there is nothing to
derive the list from, because a page cannot ask to be checked and be believed.

## The contents rail is derived, never kept

`article/sections.jsonl` gives the twelve sections their reading order and says which are
written; everything else the rail shows comes off the pages themselves. A section's name
is its `<h1>`, and the entries that open under the current page are the `<h2>`s of its
prose — a stub's *Figures* block is scaffolding, not reading, so it is not listed.

Every page carries the rail between two marker comments. `build` writes what sits
between them and gives each prose `<h2>` the id its rail entry links to, derived from the
heading's own words; `check` re-derives both and compares. A fragment is a permanent URL,
so it is spelled by rule rather than by hand.

The front page's contents list is prose and stays hand-written, so its done markers are
typed rather than generated — and held to `sections.jsonl` by `check`, which is what
keeps the flag living in one place.

## Figures are a registry, not a generator

Article prose is hand-written HTML and stays that way. What the builder owns is the
figure *block*: `article/figures.jsonl` holds one row per figure, and
`python -m builder figure <id>` prints the markup to paste. `check` re-derives that
markup and asserts the page carries it verbatim, so a caption lives in one place and a
page that has drifted is a failing check rather than something noticed later.

`caption` is optional. A row without one derives a block with no `<figcaption>` at all —
absent rather than empty — and the front page's `index-hero` is the one row like that. A
`draft` row cannot be one, because its Draft mark sits in the caption.

Every row says where it stands, in `status`. **`placed`** is made and on its page.
**`pending`** is planned: the row names no file, width or height, and the block it derives
is a well holding the description of the picture to come. **`held`** is the one status
that is registered and deliberately *not* on a page — it is blocked on something outside
this repository, and it says what in `held_reason`. **`stale`** is made, on its page, and
overtaken by the event its `stale_when` names; a `placed` row may carry a `stale_when`
too, which is the standing warning about an event that has not happened yet and is the
point at which somebody can still act on it. **`draft`** is made and on its page with its
*numbers* unsettled — a reading of a measurement that is going to be taken again — and
it says what re-bakes it in `note`, which is also what its caption's small `Draft` mark
points at — and the note is required rather than encouraged: a draft row without one is a
failing check, and `--place` refuses to land a draft that has nothing to say about its own
shelf life. Two rows are drafts today: `pipeline-growth`, which `python -m builder growth`
re-bakes from the curation growth instrument's own stamped record next door, and
`atlas-places`, which `python -m builder atlas --figure atlas-places` redraws when the
unpublished records its counts are read off are solved again. `check` prints one note per
draft, which is the list rather than this sentence. Every page on this site is a draft and none of them says so; this status is
the narrower claim, that a reader who copied a number off this picture would be copying
something with a shelf life. Prose gets written before pictures get made, and a
page that says what is coming beats a broken image or a silent gap; `figures` lists what
is still owed, grouped by the page it is owed on.

When the asset lands, `figures --place` does the whole of what used to be four steps with
two numbers retyped: it imports the picture as a web-res asset, writes the file and the
measured size back into the row, and replaces the pending well on the page with the block
the filled row derives. Nothing about the size is typed, so nothing about it can be typed
wrong.

**A figure may be panels rather than one picture** *(figure_split_overview_ckpt140,
2026-09-22)*. A row that carries `panels` and `columns` names no `file`, `width` or
`height` of its own: each panel is its own raster with its own `alt`, and its own `label`
and `note` where the composite used to letter the tile. The block such a row derives is a
grid — `columns` across at the article's width, reflowing on its own as the column narrows
— and each panel is a link into the explorer at *its* view, registered as
`figure:<id>#<n>`. `builder/links.py` derives those from the ledger recipe each panel's
seat stands on rather than from the row's prose, because a sheet's provenance names one
map with the word `colormap` and the rest with `palette`, and a scanner run panel by panel
carries the first map onto all of them. A maker returns `locations.Split` instead of
`locations.Drawn` and the landing encodes each panel through the same
`images.import_web_res` a composited figure goes through, so a picture that did not change
comes out the same bytes. `overview-gallery-hook` is the first of these.

**A panel says which record it is, and there are two kinds**
*(figure_split_all_ckpt140, 2026-09-22)*. `seat` is a tentative-gallery seat,
`<stamp>|<recipe key>`, linked from that seat's ledger recipe whole and carrying the tone
curve the run that drew it recorded. `spec` is the engine render spec the maker drew with,
for the far commoner panel that is no seat at all: the frames on the Escape-time fractals
page are frozen into the maker, drawn in a neutral map, at a mode the figure is *about*,
and nothing next door is a record of them. A spec names its mode rather than writing a
coloring out in full, because a link names a mode, and the view comes off it through the
same `links._view` a citation of the wallpapers side goes through — so a fractional
degree, a mode the explorer does not offer, a curve that is not the catalog's, a map the
picker does not carry, a fold on a cyclic map, a frame past `f64` and a cap the depth
policy would not choose are each a labelled panel with no link.

**Per panel and not per row**, because the sheets that need this most are mixed:
`escape-families` is four parameter planes and a Phoenix plane this repository rendered,
eight gallery seats and two label-store rows, and a rule making the row pick one kind
would leave one of them unlinkable. Fourteen of its fifteen link; the fifteenth is a seat
whose run recorded that the tone operator acted and not the curve it acted with.

Either way the record describes the **un-annotated** picture wherever the maker letters or
marks the tile, because a way into the explorer is a way into the place and not into the
drawing over it. What a maker still draws into the pixels is what the page cannot know
where to put: a mark at a point of the plane, a box round the region the next frame shows.
What moves out is everything else — `wide` for a panel that runs the whole row, and `ink`
for the colour that ties a panel to a mark on another one, which was a four-pixel frame
drawn into the tile and is an outline and a label colour now.

**A family whose identity is its constants must spell them.** The engine fills a bare
`phoenix` in with the classic Ushiki constants; the link derivation cannot, because an
absent constant is the origin to it — a different Phoenix set that draws a perfectly
plausible picture. `families.home_spec` refuses one rather than leaving it to be noticed.

**A split figure lands in two passes, and `figure <id> --heal` is the second.**
`figures.place` heals the page with the link as it stood *before* the redraw, so a figure
that became panels lands carrying the composite's single href. The order is
`<maker> --replace`, then `links --write`, then `figure <id> --heal`, which finds the
block by its `data-figure` and swaps in what the row derives. It writes nothing else — it
cannot land a figure or change a row — and it is what `check` used to tell a person to do
by hand.

**A figure in bands is sections of that grid** *(figure_split_all_ckpt140)*. The staged
sheets — the pipeline overview, the three bands, the rating scale, a mine's five modes —
are several grids down one sheet with a heading over each and a hand-off drawn between
them. A panel carries a `band` and opens one: `title`, the `note` that says what the stage
does, the `blocks` a sheet drew as boxes down its right-hand side (a `judge` block is
marked in the site's own mark ink), `columns` for how many panels that band runs across,
and `arrow` for the hand-off from the band before. Each band is its own grid, which is the
only way a stage three across can sit above one four across — a grid has one column count
and a sheet had none. The element is a `div` and not a `section`: `check`'s `contents`
reads a page's prose as everything up to the first `</section>`, and a band that closed one
took seven of a page's eight rail entries with it for exactly one commit.

**The grid's arrangement is the composite's, and that is a stylesheet rule.** The markup
passes one thing in, `--figure-across`, which is a count; `site.css` works the floor out
from `--wide`, `--figure-gap` and `--figure-panel-fit`, so at the article's width the
grid lands on exactly the arrangement the sheet had and drops a column as the column
narrows. A single floor for every figure cannot do that: a four-across roster showed its
tiles at about 200 px and a six-across sampler at about 130, and the one 13rem floor the
first split shipped with quietly rendered the thirteen-mode roster three across.

Four fields travel with every row beyond its words. `page` names the article page that
carries it — a row on no page is a failing check, where before it was silence. `provenance`
is one line per panel in prose, saying what would have to be re-rendered to draw that panel
again; a made row without one is a failing check too. `recipe` names the maker and its
arguments — `module:function` — which is what actually redraws the figure today; where that
module is inside `builder`, `check` holds the name to still existing. Prose outlives code
and code is what runs, which is why both are kept.

**Renaming a figure moves three things, and the `recipe` is not one of them.** The slug,
the asset file, and the figure's row in `explorer/links.jsonl` all carry it: every made
row's `file` is its id plus a suffix — all 61 of them, with no exception — and an image
filename is a URL a reader can land on, so the naming rule in `CLAUDE.md` reaches it
exactly as it reaches a page slug. `gallery-release` is the worked example: it came across
from `wallpapers-release` with its asset and its link row renamed alongside it, and the
old slug survives nowhere. What does **not** move is `recipe`, which names the function
that actually ran — `palette-autolevel`'s is still `builder.palettes:autolevel_pairs`
after the section above it stopped being called *Leveling* — because a maker is code and a
slug is vocabulary, and holding them to the same word would rename a function every time
the article changed its mind about a word.

`sources` is the fourth, and it is the one the prose cannot do. It is a list of
`{"kind", "keys"}`, where a **key is a string that addresses a record by its own name**:

```
run_row     <run>|release|<candidate>          data/curation/release/**/*.jsonl
            <head>/<batch>.jsonl:<line>        data/<head>/rows/<batch>.jsonl
location    labels/<batch>.jsonl:<line>        data/labels/rows/<batch>.jsonl
            <ledger>/walk.jsonl[#<node_id>]    the artifacts tree, through renders.artifact
gallery_seat <stamp>|<recipe key>              a seat of a recorded tentative gallery
candidate   <recipe key>                       a row of the candidate ledger
synthetic   no keys — drawn here, or rendered for this article alone
none        no keys — the picture cannot be reconstructed, and held_reason says why
```

**An integer is refused at load.** That is the whole reason the field exists: a pool index
retargeted four figures' provenance in one afternoon, because the pool grew underneath it
and a rerun rewrote the record under pictures nobody had touched. `check` resolves every
key against the store its kind names, where the wallpapers checkout is configured, and
says so and moves on where it is not.

## A figure may name its panels by tentative-gallery ID

Matt picks wallpapers off the curation browser by the short alias printed under a tile, so
`picks.py` takes those aliases and gives back pictures: a figure's registry row lists its
`picks` as `<stamp>|<recipe key>`, and re-picking is **one edit to that list** followed by
`python -m builder picks <id> --replace`. Nothing about the recipe is retyped, and the row
is the source of truth — a list of IDs in a Python constant would be a second place the
picks live, and a second list is a second thing to keep in step.

Two reads resolve one pick, and the split matters because a solve may be running next door.
The **seat** comes out of that stamp's own `gallery.jsonl`, a few hundred short lines
carrying no palette at all; the **recipe** comes out of the candidate ledger, by a streamed
lookup that stops as soon as it has the keys asked for. Never `headroom.population()`: a
figure prompt has no business loading the pool a solve is solving over. `gallery_seat` is
the source kind that addresses the result, and `fractal-wallpapers`' own
`curate solve resolve` does exactly these two reads.

**Both of those reads are now a fallback, and the site owns the answer**
*(atlas_refresh_ckpt139, 2026-09-22)*. Closing mining next door deleted every saved solve
but the twenty `final139_*`, and 96 of this site's figure panels named a seat of one of six
recorded galleries that no longer exist. So `article/figure-recipes.jsonl` holds the seat
row, the ledger recipe and the run that drew it for every pick a figure cites — 120 rows,
180 kB — and `picks.resolve` reads it first, going next door only for a pick nobody has
landed there yet. `python -m builder recipes` says what it holds and `--fill` lands what is
missing; **it never rewrites a row that is there**, because for those 96 it is the only copy
left. Three of them came out of a stamp that was never tracked next door and carry a recipe
with no seat row, which the row's own `read` clause says. `check`'s `figures` holds every
cited pick to being in the store, and a `gallery_seat` key the store answers for needs no
record next door at all. **The stamp on a figure's registry row is provenance from here
on.** The store carries seats and candidates and nothing else, and `recipes.load_all`
refuses any other kind: a `spec` panel's recipe is the spec on its own row in
`article/figures.jsonl`, and needs no second copy.

**A pool candidate was never seated, and `picks.candidates` is the same path without the
first read.** The pool is not only what a gallery kept: `wallpapers-three-bands`' middle
band is the best of what one mine made at one place, which is a question about candidates.
Those resolve by recipe key alone, they carry the `candidate` source kind rather than
`gallery_seat`, and everything downstream of a `Pick` — the panel, the autolevel curve,
the refusals — is unchanged.

**Two modules take their panels off a row this way now.** `builder.pool` draws
`wallpapers-three-bands` from three lists on its own row: the location it marks, the four
wallpapers of the middle band and the eight seats of the bottom one. That is why
`pool.recipe` reads its arguments back off the registry instead of returning an empty
`args` the way it does for the other two figures of that page — a landing that rebuilt
them would land a figure whose recipe no longer says what it shows.

**A pick draws the recipe's frame, and that is not always the seat's location.** Picks are
re-framed after seating, so the seat's `location` and the recipe's viewport can disagree —
two of the six panels of `overview-gallery-hook` do. The recipe's frame is what the pixels
are of, and it is what provenance records.

**Which places the site already uses is `frames.py`.** A prompt that is about to pick
wallpapers asks it *before* picking, because no location is reused unless the repetition
is intentional and `check`'s `locations` only refuses a collision after the fact. It
reduces every figure's places to `(centre, width)` at `%.12g` and answers in two
resolutions: resolving a figure's keyed sources **only where its provenance wrote no
geometry** finds 182 distinct places, 163 of them off the Rendering Modes page; resolving
them **everywhere** finds 220 and 193. The Rendering Modes exclusion uses the second,
because a place the record names is a place a reader can land on twice whether or not the
prose repeated it. Nothing in `check` reads this module — `locations` reads
`Figure.frames` directly, and this is the maker's side of the same question.

`facts` is optional and holds the load-bearing claims a figure's caption or its prose
makes — each one a `claim` and the `source` it was checked against. It is the answer to
"who checked this, against what?" asked of a number the article states as settled.

Two figures are an exception, and they are diagrams rather than pictures of a location:
`escape-orbit-race` and `pipeline-overview` explain a mechanism, so there
is nothing to render and nothing outside this repository to read. Those two are
`diagrams.DIAGRAMS`, and `diagram` draws them from `diagrams.py`, in the stylesheet's own
colours, straight into
`assets/images/figures/`. It is deliberately a separate command from `build` and is not
part of `check`: type is rasterized through whatever font the machine has, so two machines
agree about the picture and not about its bytes. `overview-pipeline` looks like a third
and is not one — it is a composed sheet with four real renders in it, made by a rig under
ignored `scratch/`, which is what its `recipe` and its `sources` say. Every other figure
asset arrived through `import`.

## A curation pass writes itself down twice, and one half is rolling

`curation.py` draws the figures of *Gallery curation*, which are readings of one solve
rather than pictures of a place, and it opens two records to draw any of them.

- **The tentative gallery**, `artifacts/curation/tentative/<stamp>/` — the seating and its
  tallies, **stamped and immutable**. A second solve writes a second stamp.
- **The solve record**, `artifacts/curation/solve/<name>/solve.json` — the pool's own
  narrowing, the geometric preselection, the twin refusals with their distances. It is
  written under the *leg's* name, and a rerun **overwrites it**.

So the module holds the two together before it draws: both halves say when their solve was
taken, and a record that answers for a different pass is refused rather than drawn from.
That refusal is not hypothetical — the pass this page originally stood on has no solve
record left on this machine, because a second pass under the same leg name replaced it two
minutes later. The stamped half survived; the rolling half did not.

Where a figure needs one number that only the rolling half carries, the answer is to pin
the page to a stamp whose record survives, and to say in provenance which pass that is.
Both passes of 2026-09-02 chose over a pool with the same stamp, which is why moving this
page to the later one moved no claim any earlier figure makes.

## The palette library has a record, the way a gallery does

`palettes/all-palettes.html` is a thousand rows of the same shape, so it is generated
rather than written. What it is generated *from* is `palettes/library.jsonl` — **1,021 rows,
one per palette**, carrying the four facts the page is made of and nothing else: the name,
which is the strip's file name and the key everything else addresses it by; whether the
map closes on the colour it opened with, which is the alt text and, in a render, the fold;
the **hue** it is dominant in, which is the section it sits in; and its **source**, which
is the whole of what decides what the page calls it.

**The page groups by colour, and the hue is a word rather than a number** *(2026-09-02,
replacing sixteen clusters and the variant fold)*. `data/palettes/carriers.jsonl` next door
reads every map onto three pinned reference fields and writes a row for each codebook cell
the map comes out *dominant* in, with that cell's mean share and the hue family it rolls up
to. A map's hue is the family of its largest such row — the colour it actually puts most of
a picture in — and the sections are the codebook's twelve hues in the wheel's own order:
rose, red, orange, yellow, lime, green, teal, cyan, azure, blue, purple, magenta. All 1,021
maps carry at least one cell and no map ties for its largest, so every map lands in exactly
one section and none needs a bucket for the colourless; `_uncarried` is the check that says
so if that ever stops being true. Inside a section the maps are in name order, case folded.

What this replaced was a sixteen-way hierarchical clustering of a 96-number descriptor,
which grouped maps by a distance nothing on the page could show, and a `<details>` fold
that hid 78 near-duplicate maps under the 823 that led them, of the 901 the library held
that day. **The page shows all 1,021 of today's in
their own right now** — the near-duplicate reading is the pipeline's business, where it
narrows the pool a run draws from, and it was never a thing a reader of a library page
wanted done to it.

**A name a reader can use, and the name the library spells** — `display_name` in
`builder/palettes.py`, and the rule is worth stating because it only fires for one of the
three sources. An *authored* map was named as prose and an upstream *converted* ramp's name
(`cet_cyclic_mrybm_35_75_c68`) is the identifier somebody would look up, so both are shown
exactly as the library spells them. An *extracted* map's name is the filename of the
wallpaper it was distilled out of, and a filename is not a name: resolution tokens and the
site a picture came off are dropped, so is `fractal`, a repeated leading token is collapsed
(`wallhaven_wallhaven-…`), a leading id number and a trailing number go, and the rest is
titled — `along-the-starry-way-25` reads as *Along the Starry Way*. **Where what survives is
more identifier than words, the name stands as it is**: 71 of the 334 extracted maps were
only ever a hash or a percent-encoded Wikimedia title, and a made-up reading of one would be
worse than the id. The id is never renamed anywhere it matters — a permalink, the explorer,
a figure's `provenance` — and where it differs from the display name the page carries it
under the strip, in text rather than in a `title` attribute, so a reader can search for it.
208 of the 1,021 carry that second line.

That record is this repository's, exactly as `gallery.jsonl` is, and for the same reason:
page generation is a pure function of committed text, so `check` can hold the largest
page on the site to its record on a machine that has nothing beside it. `python -m builder
palettes --library` is the one command that reads the library next door — it lands any
strip the page is missing under `assets/images/palettes/` and rewrites the record — and
the `library` check is what holds the record to that library where a checkout is
configured. A palette entering the library next door costs one `--library` and one
`build` on this side.

## What `check` checks

- **links** — every internal `href` and `src` on every page resolves, and none is
  root-absolute. The site is served from `/fractal-website/`, so a rooted href works
  locally and breaks only in production. A link to a bare directory fails too: a page
  here has to open from the filesystem, where `galleries/` is a directory listing.
- **pages** — the committed HTML the builder owns — `galleries/`, and the palette
  library page — is byte-identical to what the builder produces now, and no page under
  `galleries/` is unaccounted for.
- **contents** — every hand-written page carries today's rail, every prose heading carries
  the id its words give it, every article page is listed in `sections.jsonl`, and the
  front page marks the same sections done that the registry calls written.
- **figures** — every figure block matches its registry row; every row names the page
  that actually carries it; every registered file exists at the size it claims, a pending
  figure excepted until its asset lands; and a recipe naming a maker inside `builder`
  names one that is still there.
- **seats** — every panel that is a gallery seat *at its own recipe* is that seat's own
  picture, to a stated tolerance. Redrawing the recipe is not the whole story — the
  autolevel operator may have pushed a tone curve through the map before the run wrote the
  picture the gallery ships — and where it did and the site did not, the page publishes
  the right geometry in the wrong colour with every other check green. Exemptions are on
  the record, in a `gallery_seat` source. The stated tolerance is `checks.SEAT_TOLERANCE`,
  **6.0 mean absolute difference of 255**, on a redraw at the shipped picture's own size —
  640x360, the candidate's own regime — at supersample 2. Re-encoding the same JPEG costs
  about 2 of that and a tone curve nobody applied cost 29.51, which is the gap the number
  sits in. **Two halves, and only the second needs pixels.** The reachability half asks
  `picks.run_stamp` for **every** cited seat, exempt or not, and fails where no run record
  answers for it; `picks.RUN_RECORDS` is what it asks through — one tuple per run kind, of
  the record files that kind writes and the field a picture is matched on, typed rather
  than searched for, so a run that writes a record nobody named there is a seat with no
  reachable stamp. The pixel half compares only the panels drawn at their own recipe.
  Needs the wallpapers checkout, and Pillow for the second half, and
  says so by name where either is missing.
- **landing** — every made figure is a block a redraw could land on. `--replace` finds
  the block it is about to swap by deriving it and refuses when the page is not carrying
  exactly that, so the derivation is load-bearing in a way the figure check does not
  reach: it once left the explorer link out, which refused a redraw of every picture that
  carries one while everything else stayed green. A linked figure's landing block is held
  to carrying the link as well.
- **locations** — no location stands under two figure slugs. The site's argument is
  that the search keeps finding places worth looking at, and a place that turns up on
  three pages quietly says the opposite. A row claims its repetition with `reuse_reason`,
  and **the reason names the other figure by slug**, which is what scopes it: a row excused
  for one frame stays under the guard for every other frame it stands on. The excuse is
  held the other way too — one that excuses no collision, because the figure it names is no
  longer on a shared frame, is stale and fails. A couple of rows say the repetition is
  *not yet judged* and carry the collision so the guard is not blocked on it; those are
  **Matt's own tracking list** for his figure pass, not verdicts, and each one comes out
  when he decides which of the two figures re-picks.
- **atlas** — the per-partition atlas record still has the shape `builder/atlas.py` holds
  it to. `atlas/atlas.test.mjs` is the other half, and pins the one thing on that page that
  could break in silence: the map its node views are drawn through is the explorer's own
  `DEFAULT_PALETTE`.
- **agreement** — every atlas slot's link opens the picture on its card. `agree.mjs
  members` parses each slot's link back through the contract and holds the view to the
  recipe member for member: family, constants, frame, mode, every mode parameter (the
  catalog's constant where the recipe names none), map, every shade key and the curve —
  and the cap. A link carries no cap, so a slot drawn at another cap than the depth
  policy gives must say `cap <n>` in `refused`; the ingest writes that line from
  `agree.mjs caps`. A member the link cannot carry is excused only by the record's own
  `refused`. `agree.mjs
  draw` renders `agreement.SAMPLE`, one slot a plane at 400x225 and two samples a side,
  through the committed wasm. `agreement.py` sets each render beside its WebP thumbnail
  at a tolerance of 20 of 255 mean absolute difference, and adds a control, the first
  sample with its mode parameters stripped, which has to land outside it. About 8 s. The
  full sweep that set the tolerance is in `atlas/README.md`. The pixel half is a named skip
  without the staged thumbnails, `explorer/palettes.bin` or Pillow; the members half runs
  on a clone.
- **assets** — every image the metadata names exists at its stated size, every
  thumbnail is current, and no orphan file is left in a gallery directory.
- **library** — `palettes/library.jsonl` still says what the wallpaper project's own
  palette library says: the same maps, each in the hue the carrier table reads it as
  dominant in, in the same order, and no map in the library that the carrier table leaves
  dominant in nothing. This is the one check that needs the checkout, and the one that is
  skipped by name without it. The page itself is held to the record by **pages**, on every
  machine.
- **prose** — every row of `article/prose.jsonl` names a page that is in this article and
  is written. The masters themselves are on a synced drive that a clone need not have, so
  `check` holds the registry and `prose` holds the documents.
- **theme** — the well colours a drawn figure is made of are the ones `site.css`
  declares. Pillow cannot read CSS, so they are transcribed into `theme.py`; this is what
  keeps a restyle from moving the well and leaving every diagram on the old one.
- **explorer** — every figure and every gallery tile has a row in `explorer/links.jsonl`,
  and every row is a picture the site actually carries. Whether a link *parses* is not
  asked here: the permalink contract is written in JavaScript, `permalink.test.mjs` holds
  the registry to it, and a second reading of a URL contract in Python is the one thing a
  URL contract cannot survive.
- **bake** — the explorer's two generated modules are byte for byte what a rebake here
  produces, both of them and with nothing excepted: `palettes.js` off
  `explorer/palettes.jsonl`, `catalog.js` off `explorer/modes.jsonl`, and the gradients,
  identity lines and anchor constants off the wallpaper project next door. Each module's
  stamp is read from its record's method row rather than from the clock, which is what
  makes a whole-file comparison possible. With `library`, it is one of the two checks that
  ask nothing at all on a bare clone and say so by name, and it is what stands between the
  picker and a rebake nobody ran deliberately — once from a two-hundred-map drop in the
  library, once from a mode the engine promoted.
- **guidance** — `CLAUDE.md` names `writing-guidance.md`. The editorial authority is on
  the synced drive and a clone need not have it, so what is checkable here is the pointer:
  a prompt that is never sent there writes against nothing.
- **vocabulary** — no tracked file spells a banned term. Two lists, in
  `builder/vocabulary.py`: the reader-facing terms this site does not ship, and the words
  that frame a run by the clock. It walks the **git index** rather than the tree, so
  `scratch/` and `artifacts/` are exempt by construction and a new file is first checked
  by the run that first stages it.
- **endings** — no tracked file has drifted to CRLF on disk. `.gitattributes` says
  `* text=auto eol=lf`, so a CRLF working-tree file still *commits* as LF and every
  ordinary signal reports nothing: `git status` clean, `git diff` empty, the drift waiting
  until something rewrites the file line by line and produces a whole-file diff for no
  visible reason. `git ls-files --eol` is the only detector — `grep` cannot do it in Git
  Bash here, where a CR-at-end-of-line pattern matches every line of a pure-LF file — and
  the check asserts the sweep returned rows before believing that it found none.
- **icons** — every page the site serves declares the site's icon, with exactly the lines
  `icons.head` spells from that page, and `assets/icons/` is the set those lines name: the
  `.ico` holds 16, 32 and 48, each PNG is its own size, the manifest is what the builder
  writes, and the recipe store holds the `icon` row. Runs on a bare clone; the PNG sizes
  are the one half that wants Pillow.

## The site's icon

*(favicon_wire_ckpt145.)* `python -m builder icons` records the icon's recipe and draws the
icon set from it; `builder/icons.py` is the module. Matt picked the icon off a contact sheet
of forty square crops (favicon_sheet_ckpt145, **F08**, the sheet itself under ignored
`scratch/favicon/`): gallery seat `20260922T014052Z|dff7e280effc3aa3`, a Multibrot d = 3
frame in tia and `along-the-starry-way-25`, cropped to the centred square as tall as the
seat's frame.

**The recipe is one row of `article/figure-recipes.jsonl`**, kind `icon`, stamp `icon`, key
`site`: the seat, the **crop link** (the shallow link that draws exactly the square, with
`n` pinned because the seat's cap is not what the depth policy gives the narrower frame),
the seat's own link, the crop's width, and the master's size and sampling. `icons` writes
that row, then draws from it: the seat's ledger recipe through `picks.panel_spec`, coloured
exactly as a seat panel is, with the width replaced by the row's and the resolution made
1024 square at supersample 3. Every size is a Lanczos reduction of that one master:
`favicon.ico` (16, 32, 48 as PNG payloads), `apple-touch-icon.png` (180), `icon-192.png`,
`icon-512.png`, and `site.webmanifest` naming the last two. About 25 s, most of it
resolving the seat. The files are tracked; the master is in the render cache.

**Every served page declares it, and the lines are the builder's.** `icons.head(page)` is
three `<link>`s spelled relative to the page. A generated page gets them from
`pages._shell`; every other page `paths.site_pages` finds, the explorer, the atlas frame
and the judges bench included, gets them from `build`, which replaces the run of icon
links in its `<head>` the way it replaces the rail between its markers. A new page starts
with `<link rel="icon" href="data:,">` on a line of its own and the next `build` fills it
in. There is no `/favicon.ico` at the origin root and cannot be one: the site is a
project-Pages subpath, and a page that declared nothing would send every browser there
for a 404.

**The Galleries page opens on the picture the icon came from.** `galleries-icon-source` is
a one-panel seat figure registered on `galleries/index.html`, drawn by
`picks.galleries_icon_source`, which refuses a row whose pick is not `icons.SEAT`, so the
page and the icon cannot come to name different wallpapers. It is the first registry
figure on a **generated** page: `pages.gallery_index` derives the block from the registry
the same way `check` does, so a caption edit is a registry edit and a `build`, and the
landing is `picks <id> --place`, then `links --write`, then `build`. Its prefix is
`galleries-`, because `gallery-` is Gallery curation's.

**Re-picking** is an edit to `icons.SEAT` (and to `CROP`, the side as a share of the frame
height), the same edit to the figure row's `picks`, then `icons`, `picks
galleries-icon-source --replace`, `links --write` and `build`.

## Prose has a master, and a page is held to it

A written section is drafted and reviewed as a document — a markdown master in the
Drive-synced working folder — and then placed as hand-written HTML. Two copies of the
same words drift, so `prose.py` reduces both sides the same way (tags out, markdown
markers out, whitespace collapsed) and `python -m builder prose` names the first word
they disagree on. A markdown link is reduced by taking everything up to the **first** `)`, so a master
whose URL carries a parenthesis leaves half of it in the text and `prose` reports a
disagreement about a page that is fine. Percent-encode the parenthesis in the master.
`article/prose.jsonl` says which master belongs to which page, and may
record *sanctioned divergences*: the master's words, the page's words, and why the page
is deliberately different. A page with no row is one whose HTML is its own master.

`review.py` is the other half: `python -m builder review <page>` writes a `.docx` of the
page's prose as served, plus its figure captions by slug, into the synced `review/`
folder, where Matt marks it up in Google Docs. `--read` diffs the marked-up copy against
the page and prints his edits inline with every `[M: ...]` note; `--consume` files an
applied doc away so it cannot be applied twice. The format is written by hand — a `.docx`
is a zip of XML, and the parts a document like this needs are small enough to spell out,
so there is nothing to install. The whole workflow is `docs/page-review.md`.

## Drawing a figure: three modules, one seam

A figure that shows a location is made in two halves, and the split is deliberate.

- **`theme.py`** — the well's colours and the font fallback chain, in one place. Four
  copies of these five hex triples used to sit in four files.
- **`sheets.py`** — the composition half, Pillow only, no engine anywhere in it: the
  panel grid, the label ranks, the box marking what the next panel zooms into, the
  numbered ring marker, the number formatters that typeset a real minus sign, and APNG
  assembly on a built palette. It takes paths and gives back a picture, so it neither
  knows nor cares whether a panel came out of the engine, off a curation run, or out of
  `diagrams.py` — and adjusting a composition, which is the thing done most, needs
  nothing outside this repository.
- **`renders.py`** — the one seam to the fractal engine next door, and the only module
  here that shells anything. Where that checkout is comes from the `FRACTAL_WALLPAPERS_ROOT`
  environment variable or an untracked `local.toml` at this repository's root, never from
  a literal: no absolute path is committed here, and the project is not in the same place
  on two machines. Names under the wallpaper project's regenerable tree resolve through
  **both storage tiers**, hot and archive, by that project's own settings — several of its
  subtrees now live on an external disk, and a path built from the checkout root and a
  string finds only the hot one.

  **A path handed to the engine is handed absolute.** Both `run` and `cli` shell with
  `cwd` set to the *wallpapers* checkout, because the engine finds `data/palettes`
  relative to it — so an `output`, an `--out`, a `--manifest` or an `--out-dir` that is
  relative resolves against the other repository, which is the one place this side may
  not write. Everything here builds those from `default_cache_root()`, which is absolute
  when it falls back to `artifacts/renders/`; a relative `FRACTAL_WEBSITE_RENDER_CACHE`
  or a relative `root=` passed to `Cache` is the one way to make it not so.

`renders.Cache` keys a render on its spec and records it in a manifest beside the files.
Renders are the expensive half and compositions are the half that gets adjusted, so
adjusting a label never re-renders a panel; a changed constant is a new key rather than a
stale file; and the manifest holds every spec, which is what makes the tree re-derivable
rather than merely disposable. It defaults to `artifacts/renders/`, which is ignored.

**Anything derived on top of a cached render carries that render's key in its own name.**
A rig that enlarges, crops or composites a panel and then skips the write because the
output file is already there is caching on a name that says nothing about its input: the
engine render underneath is spec-keyed and correct, and the file on top of it is the
previous location's picture. `render-supersample` shipped that way once — the enlargement
was the stale half, so the page carried the right provenance over the wrong pixels, which
is the failure shape nothing on the page reveals.

The rigs that compose the article's figures live in `scratch/` and are untracked — that
is what `scratch/` is for — but everything they used to re-implement is here now, and a
figure made a year ago can be redrawn without reconstructing the session that made it.

## The deep zoom video is a tool, not a figure

*(deepzoom_video_ckpt143.)* A descent from the whole set to the frame of the deep-zoom
section, drawn in three standalone steps. None of them is a maker, none is part of `build`
or `check`, and no page carries what they make. **The recipe is
`data/deep-zoom-descent.keyframes.json`**: the exact-decimal centre, the keyframe widths
`w_k = target · 2^k` down from the first width that holds the whole set, each keyframe's cap
as the Deep tab's probe settles it, the video's timing, and the default for each mapping.
Everything big lands under ignored `artifacts/deep-zoom/`, and `FRACTAL_WEBSITE_ZOOM_DIR`
moves it.

```
node builder/zoom_fields.mjs --caps     # widths and caps into the record (seconds)
node builder/zoom_fields.mjs            # the fields (about an hour; resumes per keyframe)
node builder/zoom_fields.mjs --agree    # neighbouring keyframes compared where they overlap
python builder/zoom.py stats            # nu and band width per keyframe, for choosing L
```

**The fields are rendered once.** Each keyframe is 3840×2160 `f64` smooth counts, `NaN`
for the interior, drawn by the committed `perturb.wasm` alone from the home view to the
target. One kernel for the whole zoom means that `nu` means the same thing at every depth.
They are 66 MB each, `fields/k<NN>.f64` with a `.json` beside it.

**Colouring is the cheap step, and the one to rerun.** The mapping is one function of `nu`
for every keyframe, with no per-frame stretch and no levelling, so two keyframes that
overlap agree on colour: `index = frac(g(nu) / L + phase)`, with `g` = `nu` (`linear`),
`ln nu` (`log`) or `nu^alpha` (`power`). The palette is the engine's own bake, taken by
shading a linear ramp once through `engine.wasm` (`zoom_palette.mjs`), and the interior is
black.

```
python builder/zoom.py sheet  --mapping log --L 0.35          # nine keyframes, one PNG
python builder/zoom.py video  --mapping log                   # colour, composite, encode
python builder/zoom.py video  --mapping power --alpha 0.4 --L 6 --phase 0.3 --palette <name>
python builder/zoom.py encode --mapping log --crf 18          # re-encode what is coloured
```

A flag overrides the record for one run. Every coloured set is a directory named for all of
its parameters, under `colour/`, and its MP4 is `video/deep-zoom-descent_<same name>.mp4`.
The video is 1920×1080 at 60 fps. A frame crops the smallest keyframe that covers it and
area-filters it down, then blends the next keyframe in over the centre with a feathered
edge, so nothing is ever enlarged. The encoder is `imageio-ffmpeg`'s bundled `ffmpeg`
(`pip install imageio-ffmpeg`), writing H.264 in yuv420p.

## Automatic minibrot descents

*(double_descent_ckpt145 and its addendum.)* `python -m builder descent <link> [<link> …]`
turns a chain of explorer frames, each centred on a copy, into a keyframe record the two
tools above render. The neighbourhood of a copy `M_A` is close to `c_A + s_A·M`, so every
place has a **twin** inside it: location `B`'s twin sits at `c_A + s_A·c_B`, `w_B·|s_A|`
wide and turned by `arg(s_A)`, with `M_AB`, of period `p_A·p_B`, at its heart. The chain
descends home → `L₁` → `M₁` framed → the twin of `L₂` → `M₁₂` framed → … One link means
`[A, A]`, the copy of `M_A` inside itself. Every family must be the same, degree 2 to 6.

```
python -m builder descent "<link>" --dry-run          # solve the chain, print it (seconds)
python -m builder descent "<link>" ["<link>" …]       # and write data/double-descent.keyframes.json
node builder/zoom_fields.mjs --record builder/data/double-descent.keyframes.json
python -m builder descent --colour double-descent     # the log mapping by Hold look, at the twin
python -m builder descent --stills double-descent     # stage frames + the twin turned back
python builder/zoom.py --record builder/data/double-descent.keyframes.json video --mapping log
```

`--name` names the record and its directory, `artifacts/<name>/`; `--branch` picks the twin
at degree 3 and up, where the scale is defined up to a `(D−1)`-th root of unity and there
are `D−1` of them. The numbers are `builder/deep-gallery-native`'s, and so `perturb-wasm`'s:

- **A location's copy** is `search`'s nucleus nearest the centre, **refused** unless it is
  within an eighth of the frame and `classify` (Find minibrots' test) calls it a copy.
- **`s_A` with its rotation** is `orient`: `1/(d·l^{1/(D−1)})` off the nucleus's own
  derivatives. It is good: on the favicon seat the images of the set's period-2 nuclei,
  solved at period 362, put it within 0.12%.
- **The twin's copy is `twin`, multiple shooting on the renormalised orbit**, then Newton at
  `p_A·p_B` to polish. ⚠ **The first-order place is not enough, and no cheap correction
  fixes it.** `c_A + s_A·c_B` misses by the tuning's nonlinearity, 0.04% to 0.34% of the
  offset on every case measured, and on the favicon seat that is 4.2e-14 against a twin
  frame 2.3e-19 wide. Newton at period 32,761 escapes from there on both branches; a grid of
  starts found a period-32,761 nucleus that is **the wrong one** (size 1e-19, not 1.8e-21);
  a quadratic correction fitted off the period-2 images escapes too. Shooting holds each of
  the `p_B` returns `z_{k·p_A}` as its own unknown, seeded from `c_B`'s orbit over the
  dynamic scale, and converges quadratically in four steps on every case. The record keeps
  the steps, the first-order miss, and the found size over `|s_A|·|s_B|` (0.995 to 1.0002).
- **A copy is framed by `frame`**, Find minibrots' rule natively: the preview tile at
  `copy_width`, eight periods deep, its body measured and set at a quarter of the height.
- **The ceiling.** Where `32·p_A·p_B` passes `cap::CEILING`, the descent ends on the
  lowest-period copy `find` offers in the twin frame that fits, and where none does it ends
  on the twin's copy at the ceiling and the record's `notes` say so. Inside `M_A` every copy
  is a multiple of `p_A`, so for `[A, A]` none fits once `p_A` passes 176.

**The record is `deep-zoom-descent`'s shape** with a few fields more: `chain`, `stages`
(each stage's exact width, its nearest keyframe `k`, its copy, and for a twin the turn and
the solve's numbers), `notes`, `mode` (always `smooth`: the Deep tab's), `family` and
`branch`. Every keyframe is centred on the last copy, as `zoom.py` composites, so the stages
above it are off centre by `|c_last − c_stage|`, which is 5% of the width at the favicon
seat's `copy 1`. Caps are `policy::settle` at the field grid, raised at each stage frame
**and every keyframe deeper** to 32 periods of that stage's copy, so a cap never falls with
depth at a stage. `zoom_fields.mjs` and `zoom.py` take `--record`; without it they are the
deep zoom video's, byte for byte, in `artifacts/deep-zoom/`.

**Colour, by Hold look.** `--colour` sets the log mapping's `L` and phase so that the band
density and the colour at the twin frame's median `nu` are what `deep-zoom-descent`'s log
look (`L = 0.25`) gives at its own target's median. It is a first cut for Matt to tune.
`deep-descent-pairs` colours a twin the other way round: its counts are about `p_A` times
its source's, so under `lambda=0` it is its source shifted by `ln p_A`, and taking that off
the phase puts the twin in its source's colours.

## The deep figures

*(deep_figures_ckpt145.)* `python -m builder deep [ID ...] [--place] [--replace]` draws the
figures of *Deep zoom*, and `builder/deep_figures.py`'s `FIGURES` is where each one's
frames, colouring and grid are frozen. **A deep panel is a Deep-tab link and a grid, and
nothing else.** Three steps, none of them new code:

1. `deep_figures.mjs` reads the link through `explorer/deep-link.js`, settles the cap with
   the tab's own probe (`zoom_fields.mjs`'s `settleSpec`) where the link names none, and
   draws the field with `zoom_fields.mjs`'s `renderSpec` on the committed `perturb.wasm`.
   That is the video's keyframe renderer, made importable: its command line only runs when
   node is started on it.
2. `deep_gallery_shade.mjs` colours the field exactly as the tab colours the link.
3. The lossless panel lands in `artifacts/deep-figures/`, keyed on the link and grid it was
   asked for, and `--place` encodes it through `images.import_web_res` like any split panel.

**The link is the recipe, and it lives in `article/figure-recipes.jsonl`** as a `deep` row,
stamp `deep`, key `<figure id>#<panel>`: the canonical `dv=3` link with its settled `n`,
the resolution and the supersample. The panel's registry row names that key in `deep`, the
way a seat panel names its seat, and `links.py` copies the link off the store rather than
deriving one. The maker writes those rows when it lands a figure and replaces a figure's
rows whole on a redraw. **A figure that leaves the page takes its deep rows with it**: its
`FIGURES` entry, its registry row, its panels, its `explorer/links.jsonl` rows and its
`deep|<id>#…` rows in the store all go in one commit. Unlike a seat row, a deep row is not
the only copy of anything, because the link it holds is the maker's own frame and the maker
is in git history. `deep-julia-stages` left that way *(deep_zoom_edits_ckpt145)*.
`recipes --fill` never touches deep rows, because nothing next door can answer for one. `deep-link.test.mjs` holds every `dv` row of `explorer/links.jsonl` to the
Deep contract and to pinning its cap, and `permalink.test.mjs` passes those rows over.

**One panel is not a deep panel.** The left half of `deep-f64-and-perturbation` is the frame
in plain doubles on purpose: an engine spec with `allow_unresolvable_in_f64` (the opt-in
`fractal-engine` grew for this picture), drawn at its perturbation twin's settled cap and
colouring so the two differ in arithmetic alone. It is a `spec` panel, and `links.py`
refuses it as `deep`, which is true: the explorer refuses that frame.

**Colouring is `scale=absolute` throughout but one panel**, the percentile stretch being
what flattens a deep frame. The page's own Deep-tab link colours at `lambda=0&period=0.25`, and the figures
whose counts run to tens rather than thousands use `period=0.5`, which bands less.
`deep-shallow-and-deep` is drawn in Coalglow, and the map is read off each figure's frames,
so a figure in another map writes that map's name after `colormap`. One figure uses one
colouring, so a colour is one escape count across a strip, **with one exception**: both of
`deep-shallow-and-deep`'s links are Matt's as he gave them, and its shallow half carries a
colouring of its own on the leveled scale *(PLACE_deep_zoom_v3_ckpt145)*, so across that
pair a colour is not one escape count. Measured on the
f64 figure at the widths f64 still resolves: the engine's colouring and the tab's shade of
the perturbation field agree pixel for pixel by eye, so the pair is a fair comparison.

Landing is the standard split landing plus one step. A new figure needs a `pending` row
whose block is on the page, then `deep <id> --place`, then `links --write`, then
`figure <id> --heal`, the order *Still hand-done* names. Five figures, 22 panels, 3.94 MB
at 2×2 samples, since `deep-descent-pairs` joined *(double_descent_ckpt145)*; the three drawn in deep_zoom_edits_ckpt145 took 177 s together on this
machine, and `deep-descent-pairs`' six took 53 s.

**`deep-misiurewicz-pairs` is aligned by derivation, not by fit.** At a Misiurewicz point
the M plane at c + e looks like J_c at c + λe, λ = lim b_n/a_n, with a_n and b_n the
orbit's derivatives in z and in c. J_c is also self-similar about c by the cycle's
multiplier ρ, so λρ^m aligns the pair for every integer m. The explorer draws no rotation,
so each point was chosen, and each m, for arg(λρ^m) under a degree at a scale between 0.05
and 20. `MISIUREWICZ` in `deep_figures.py` freezes the three points and their constants,
and its comment has the derivation and the numerical check that confirmed it.

## The Deep tab's gallery

*(deep_gallery_sheet_ckpt144 found the first set; deep_gallery_build_ckpt144 placed it and
promoted the code out of `scratch/`.)* The Deep tab carries a gallery of deep frames that a
click opens. **The register is `explorer/deep-gallery.jsonl`**: one row a frame,
`{"subject": …, "link": …}`, in subject order, and nothing that can be read off the link.
The link is a canonical `dv=3` link that pins its cap with `n`. `deep-link.test.mjs` holds
every row to both, so a row that breaks either one fails a suite.

**To add a frame**, copy its link from the Deep tab (Copy link, not the address bar, which
adds `panel=deep`), drop the leading `?`, and append a row:

```
{"subject": "Filigree", "link": "dv=3&x=…&y=…&w=…&n=…&p=…"}
python -m builder deep-gallery thumbs
```

A row with an existing subject joins that subject's group in the tab, wherever it sits in
the file. A new subject becomes a new group after the others. A link without `n` is
refused: the Deep tab's link with no cap opens at the width's cap, and a gallery frame
should open at the cap its tile was drawn at. `thumbs` refuses a link that is not in its
canonical spelling and prints the spelling to use. Then it draws a tile for every row that
has none and removes any tile no row names. Each tile is 316×178, drawn at 2×2 samples a
pixel at the link's own cap, and saved as WebP at `TILE_WEBP_QUALITY`. It lands in
`explorer/deep-gallery/`, named by the 64-bit FNV-1a hash of the row's link, which
`deep-gallery.js` computes the same way. The tiles are staged rather than committed (see
*What is staged*). The first 31 took 2 min 54 s and total 394 KB.

A tile's field comes from `builder/deep-gallery-native/`, a small crate that uses
`explorer/perturb-wasm` as an rlib, so it runs the arithmetic `perturb.wasm` runs, on every
core. It is built on first use and its `target/` is ignored. A Julia tile is anchored the
way the tab anchors one: at whichever of `z = c` and `z = 0` is nearer. Colour comes from
the tab itself. `deep_gallery_shade.mjs` reads the link with `deep-link.js`, builds the spec
with `deep-render.js`'s `shadeSpecOf` and shades it through the committed `engine.wasm`, so
a tile is coloured exactly as its link colours it.

### How the first set was found

`builder/deep_gallery.py` holds the code, one stage a subcommand: `descend`, `frames`,
`preview`, `zooms`, `render`, `sheet`. Each writes under ignored `artifacts/deep-gallery/`.
The choices a person or a session made by eye are frozen in
`builder/data/deep-gallery-sheet.json`, and the descents are frozen in
`builder/data/deep-gallery-descents.jsonl`. Every place in them is addressed by its
coordinates, never by a position in a list. Rerun against those records, `frames` writes
the sheet session's 98 frames, `zooms` its 42 zoom frames, and `sheet` its 65 links, all
identical to the scratch originals, with pixel-identical tiles on the three checked. What
`descend` and `preview` produce depends on the checkout next door and on the kernel's
search. They were ported line for line but not rerun.

**The sources.** Every frame is below the `f64` floor for its own centre: its width is
under `RESOLUTION_ULPS` = 4 ulps of the centre times 1,280 samples. That is about 5.7e-13
near |re| ≈ 0.75. Frames came from three places.

- **The deep zoom video.** Its centre, from `data/deep-zoom-descent.keyframes.json`, at
  three of its keyframe widths: k0, the final frame, at 3.5e-15; k2 at 1.4e-14; and k4 at
  5.6e-14.
- **Two nuclei at the video's centre.** Period 6263 was found by deepzoom_audit_ckpt143's
  domain walk 1.8e-15 from the target, and its body is 5.2e-21. Period 12451 was found by
  `nuclei::search` at the video's centre at width 1e-16, and its body is 1.5e-22. Each is
  recentred on its nucleus at a ladder of widths: 1e-16 down to 3e-20 for 6263, and 1e-17
  down to 9e-22 for 12451. The narrowest width in each ladder frames the minibrot itself.
- **Descents from enclosed places.** These start in the wallpaper project's
  `artifacts/discovery/minibrot_examples.jsonl`: the rows that carry both a `place` and a
  `picture`, which are places the discovery survey kept with a minibrot enclosed in the
  frame. For each degree, the rows are shuffled with a seed, and one row is kept per
  region (the same `q` and the same centre to three decimals). The record holds 43
  descents: 11 at degree 2 and 8 at each of degrees 3 to 6.

**The rung rule.** A descent is a chain of nuclei, each a smaller copy inside the view of
the one before it. At each rung, `nuclei::search` runs over the current view with a seed
budget of 60, asking for 40 nuclei, at the view's settled cap. It returns them largest
first. The rung takes the first one that meets three conditions:

- its period is at most 120,000;
- its body is under an eighth of the last rung's body;
- it lies farther than 1.5 bodies (in the larger of the two coordinates) from every
  earlier rung's nucleus.

The next view is 20 of the new body wide, centred on it.

Why each condition:

- **Largest first.** The largest copy in the view is the one a reader zooming in would
  see.
- **The eighth.** It makes each rung a real step down rather than a step sideways to a
  sibling of about the same size.
- **The distance.** Each view is centred on the last nucleus, so the search finds that
  minibrot again, and this condition stops the chain taking it twice.
- **The period cap.** It keeps eight periods of any rung (the tab's own tile rule) under
  the million-iteration ceiling.

A chain stops at twelve rungs, or when no nucleus qualifies. It also stops `extra` rungs
after the first rung whose framed tile (6 bodies wide) is below the floor. The runs used
`extra` of 1 and 2, and 5 for degrees 3 to 6. The smallest bodies the recorded chains
reach are 1.5e-18 at degree 2 and 3e-22 to 1.3e-21 at degrees 3 to 6. The deeper degree-2
frames come from the two video nuclei instead.

**Frames from a rung.** Which rungs of which descents became frames, and of which kinds, is
the record's `plan`: 25 entries, 5 at each degree, chosen by the sheet session from the
descents. Each chosen nucleus is re-solved by Newton to 60 places, and then cut into these
kinds:

- **A framed minibrot:** 6 bodies wide, centred on the nucleus.
- **Two symmetry stages:** centred on the nucleus, at the geometric half and quarter of the
  way from the framed width up to the view the nucleus was found in.
- **Copy-mapped points:** a whole-set point is mapped into the copy. That point is a
  seahorse-valley point, a spiral point (both near the period-2 root, found on a 401-square
  escape grid) or a filigree point at 2.2·e^{0.6i}.
- **Julia frames.**

Any frame not below the floor is dropped.

**The Julia-plane `c` mapping.** A copy of period `p` at degree `D` has its own complex
scale, `σ = d·l^{1/(D−1)}`. Here `d = dz_p/dc` at the nucleus and
`l = ∏_{k=1}^{p−1} D·z_k^{D−1}`, both computed natively in fixed point and kept as mantissa
and exponent, taking the principal root. A whole-set coordinate `C` becomes the copy's
point `c = nucleus + C/σ`. The Julia set at that `c`, near `c`, is the whole set's Julia
set at `C`, scaled: `s^D·(J_C − C)` about `c`, with `s = l^{−1/(D−1)}`. So the frame is
centred at `c − s^D·C`, the image of `J_C`'s origin, and is `4.5·|s^D|` wide.

The `C`s used are:

- the main body's point whose multiplier is `0.95·e^{2πi/3}`, which is inside the copy's
  body next to its period-3 bulb;
- the valley point above, which is just outside the copy;
- for the 6263 copy and one degree-2 descent only, the rabbit's `−0.1226 + 0.7449i` and a
  seahorse-valley `−0.7453 + 0.1127i`.

The sheet session checked the mapping by landing the 6263 copy's period-2 and period-3
bulbs. Newton went to nuclei of period 12,526 and 18,789, to 0.4% of a body.

**Off-centre zooms.** Some previews were zoomed into off-centre; the record names which.
The preview is cut into an 8×6 grid of cells, skipping the corners and any cell that is
more than 1% interior. Each cell is scored by the median of its log-count gradient,
`m` where `m < 0.08` and `0.16 − m` otherwise, so that detail beats both flat colour and
noise. The two best cells more than two cells apart each become a frame a sixth as wide.
This is where most of the spirals and seahorses came from: a whole-set valley or spiral
mapped into a deep copy escapes after about `p` times its shallow count. At these periods
that is past the million-iteration ceiling, and 13 such frames came back as unresolved
exterior.

**The cap rule.** A frame's cap is `max(settled, min(1,000,000, period × periods))`. Here
`settled` is the kernel's own cap policy, `policy::settle`, run on the frame at 256×144.
A framed minibrot and every width of the two nucleus ladders ask for 32 periods of their
nucleus. A descent's symmetry stage asks for 8, the tab's own tile rule. Every other frame
takes the settled cap as it is. The reason for 32: at the settled cap a framed deep
minibrot is a black blob. For the 6263 frame that cap was 83,726, about 13 periods, and the
body only resolves at about 32. The cap is settled at the preview, kept for the final
render, and written into the link as `n`, so the link opens pinned at it.

**The colouring rule.** Every link is `scale=absolute` with its own `lambda`, `period`
and `phase`, which the Deep tab reads as `frac(g/period + phase)` of the Box–Cox
`g = (ν^λ − 1)/λ` of the smooth count (`ln ν` at λ = 0). For each λ in
{0, 0.15, 0.3, 0.5, 0.75, 1}, the period is the field's 3rd-to-97th-percentile range of
`g` divided by a number of cycles, to three figures. A λ is acceptable when under 4% of
neighbouring sample pairs are more than a quarter turn apart. The acceptable λ nearest a
preferred one wins, and failing any, the smoothest.

The sheet numbers its 65 tiles in five groups, shallowest first within each. Tile `n` in
group `g` (counting from 0) takes:

- palette `PALETTES[7n mod 24]`, from 24 cyclic maps with the Popular list's cyclic
  entries among them;
- cycles `CYCLES[k mod 6]` from (2, 3, 1.5, 4, 2.5, 6), where `k = n + 3g`;
- a preferred λ of `LAMBDAS[k mod 6]` from (0, 0.3, 0.6, 1, 0.15, 0.45), except that a
  framed minibrot at odd `k` prefers 0;
- phase `0.137·n mod 1`.

No tile was coloured by hand. The previews used the same rule, with 3 cycles, a preferred
λ of 0.3, six palettes in turn and phase 0.1.

**From 140 previews to 65 tiles, and to 31.**

1. 140 distinct frames were rendered at 256×144 and one sample a pixel, coloured by the
   rule above and laid out on labelled contact sheets: the 98 from `frames` and the 42
   from `zooms`.
2. **The sheet session chose by eye** which 65 of them made the numbered sheet, and filed
   each under one of four subjects. That session was deep_gallery_sheet_ckpt144, a Claude
   session, and its choice is the record's `selection`.
3. The 65 were rendered at 640×360 with 2×2 samples (43.3 minutes on 12 threads) and
   numbered.
4. **Matt chose the 31** in the register from that sheet.

The sheet's five group titles are shortened to the register's subjects: *Framed
minibrots*, *Symmetry stages*, *Embedded Julia sets*, *Spirals and seahorses*,
*Filigree*.

## What refuses, on purpose

Three of the makers would rather stop than hand back a picture nobody would look at twice.

- **`pipeline` will not bake a yield decay it cannot vouch for.** A run writes a `summary`
  row carrying its own tally of admissions per partition; the bake derives the same numbers
  off the `candidate` rows and refuses where the two disagree. A chart that does not
  reproduce the run's own arithmetic is a reading of something else.
- **`diagrams.py`'s flow boxes refuse a line that outgrows its box.** The wording is a
  constant at the top of the module and the boxes are sized from the sheet, so an overrun
  is an edit somebody made to the words — and lettering running out over the well is
  invisible in a diff and obvious in the picture, which is the wrong way round.
- **`images.py` raises `ImageFile.MAXBLOCK`** before it writes a JPEG. Pillow's default
  block is too small for a scanline of a wide 4:4:4 JPEG, and the encoder fails at the sheet
  sizes this site ships rather than at anything smaller anybody would have tried first. A
  figure is WebP since `website_webp_and_atlas_deprecate` and that encoder has no such
  block; the guard stays because a gallery's own pictures and their thumbnails are JPEG.

## Still hand-done, and shouldn't be

Each of these is a step a person has to remember, and each has been forgotten once.

- **A figure drawn in a map the explorer's roster does not carry needs that map added to
  `explorer/palettes.jsonl` by hand**, unoffered, and a rebake. The link derivation answers
  *no colormap is written down* rather than naming the map it could not carry, so the
  symptom is a missing link rather than an error. The builder writes the provenance that
  names the map; it could offer the missing name on the spot.
- **After a re-pick the order is `picks --replace`, then `links --write`, then re-heal.**
  `figures.place` heals the block using the link as it stood *before* the redraw, so a
  figure whose representative panel changed lands with the old href and needs a second pass.
  The second pass is `python -m builder figure <id>… --heal` since
  `figure_split_all_ckpt140` — it used to be a copy and paste out of `figure <id>`, which
  is the step `check` names and somebody forgets.
- **Provenance spells the palette pass in words, not JSON.** `links.py` scans the prose for
  `mirror true` and a `palette gamma …` clause, and the JSON form reads to it as *no fold
  and every default* — which derives a link to the unmirrored picture, silently.
  `picks.shade_words` writes the words. The fix is one rank up: `links._cited` learning the
  `gallery seat <stamp>|<key>` form and reading the ledger recipe whole, the way it already
  reads a release key, would stop the prose being load-bearing at all.

## Two rules that predate the code

- **Its output is committed HTML.** Pages never runs Python, so a broken builder can
  only fail to produce the next diff.
- **It only ever reads the code repository.** Nothing in `C:\Code\fractal-wallpapers`
  is written, moved, or regenerated from this side. `import` is the one command that
  reads outside this repository, and the path it reads is an argument — never recorded,
  because full-size material lives elsewhere and stays there.
