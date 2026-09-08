# builder

The page generator. It writes the gallery pages and the gallery index, derives web-res
images and thumbnails, and checks the committed tree. Everything it writes is committed
HTML: the site never depends on the builder having run, and GitHub Pages never runs
Python. A build is done here and reviewed in a diff.

```
python -m builder build     regenerate gallery pages, the gallery index, thumbnails,
                            and the contents rail every page carries
python -m builder check     eighteen named checks: links, page sync, contents, figure
                            blocks, seat panels, landings, one location to one figure,
                            explorer links, the atlas record, the explorer's bake, assets,
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
python -m builder pipeline [ID ...] [--run R] [--place] [--replace]
                            bake the Full pipeline charts read off a run's own
                            walk ledger next door
python -m builder diagram ID draw one of the three figures that are diagrams, not renders
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
check, the `bake` check, the `seats` check and the source-key half of `figures` want; and Pillow, which is
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
shelf life. `pipeline-growth` is the only draft on the site, and `python -m builder growth`
re-bakes it from the curation growth instrument's own stamped record next door. Every page on this site is a draft and none of them says so; this status is
the narrower claim, that a reader who copied a number off this picture would be copying
something with a shelf life. Prose gets written before pictures get made, and a
page that says what is coming beats a broken image or a silent gap; `figures` lists what
is still owed, grouped by the page it is owed on.

When the asset lands, `figures --place` does the whole of what used to be four steps with
two numbers retyped: it imports the picture as a web-res asset, writes the file and the
measured size back into the row, and replaces the pending well on the page with the block
the filled row derives. Nothing about the size is typed, so nothing about it can be typed
wrong.

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
- **`images.py` raises `ImageFile.MAXBLOCK`** before it writes. Pillow's default block is
  too small for a scanline of a wide 4:4:4 JPEG, and the encoder fails at the sheet sizes
  this site ships rather than at anything smaller anybody would have tried first.

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
