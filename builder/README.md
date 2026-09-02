# builder

The page generator. It writes the gallery pages and the gallery index, derives web-res
images and thumbnails, and checks the committed tree. Everything it writes is committed
HTML: the site never depends on the builder having run, and GitHub Pages never runs
Python. A build is done here and reviewed in a diff.

```
python -m builder build     regenerate gallery pages, the gallery index, thumbnails,
                            and the contents rail every page carries
python -m builder check     links, page sync, contents, figure blocks, landings,
                            explorer links, the explorer's bake, assets, the palette
                            record, prose, the editorial pointer, theme, banned
                            vocabulary
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
python -m builder diagram ID draw one of the two figures that are diagrams, not renders
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
check, the `bake` check and the source-key half of `figures` want; and Pillow, which is
what lets `figures` and `assets` verify pixel sizes. Missing either is a **named skip** —
the check line says `skipped` rather than `ok`, and the exit summary counts them — never a
failure and never a silent pass. `check` once built the palette library page straight off
that checkout, so on a machine without one it raised before the first check ran and every
check after it went unrun; the page is built from a committed record now, and this is why.

**So a green CI is not a green tree.** `library` and `bake` ask nothing on a bare clone
and `figures` asks half, which means the two explorer rosters, its generated modules
and every source key a figure cites are certified **only on a machine that has the
checkout**. Run `python -m builder check` here, with `FRACTAL_WALLPAPERS_ROOT` set or
`local.toml` in place, before a checkpoint — and read the exit summary's skip count, which
is what says whether the run that just passed was the whole question or two thirds of it.

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
point at which somebody can still act on it. Prose gets written before pictures get made, and a
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

`sources` is the fourth, and it is the one the prose cannot do. It is a list of
`{"kind", "keys"}`, where a **key is a string that addresses a record by its own name**:

```
run_row     <run>|release|<candidate>          data/curation/release/**/*.jsonl
            <head>/<batch>.jsonl:<line>        data/<head>/rows/<batch>.jsonl
location    labels/<batch>.jsonl:<line>        data/labels/rows/<batch>.jsonl
            <ledger>/walk.jsonl[#<node_id>]    the artifacts tree, through renders.artifact
synthetic   no keys — drawn here, or rendered for this article alone
none        no keys — the picture cannot be reconstructed, and held_reason says why
```

**An integer is refused at load.** That is the whole reason the field exists: a pool index
retargeted four figures' provenance in one afternoon, because the pool grew underneath it
and a rerun rewrote the record under pictures nobody had touched. `check` resolves every
key against the store its kind names, where the wallpapers checkout is configured, and
says so and moves on where it is not.

`facts` is optional and holds the load-bearing claims a figure's caption or its prose
makes — each one a `claim` and the `source` it was checked against. It is the answer to
"who checked this, against what?" asked of a number the article states as settled.

Two figures are an exception, and they are diagrams rather than pictures of a location:
`escape-orbit-race` and `wallpapers-stages` explain a mechanism, so there is nothing to render
and nothing outside this repository to read. Those two are `diagrams.DIAGRAMS`, and
`diagram` draws them from `diagrams.py`, in the stylesheet's own colours, straight into
`assets/images/figures/`. It is deliberately a separate command from `build` and is not
part of `check`: type is rasterized through whatever font the machine has, so two machines
agree about the picture and not about its bytes. `overview-pipeline` looks like a third
and is not one — it is a composed sheet with four real renders in it, made by a rig under
ignored `scratch/`, which is what its `recipe` and its `sources` say. Every other figure
asset arrived through `import`.

## The palette library has a record, the way a gallery does

`palettes/all-palettes.html` is nine hundred rows of the same shape, so it is generated
rather than written. What it is generated *from* is `palettes/library.jsonl` — **901 rows,
one per palette**, carrying the four facts the page is made of and nothing else: the name,
the figcaption and the strip's file name both; whether the map closes on the colour it
opened with, which is the alt text and, in a render, the fold; which of the sixteen groups
it is in, counted along the wallpaper project's clustering in the order the page lays them
out; and `variant`, the name of the palette this one is a variant of — its own name where
it leads.

**`variant` is a name, never a group number**, for the reason a source key is a name: the
wallpaper project numbers its variant sets, and a number is a position in something that
grows. So a set is addressed by the member that heads it, and the page folds on that: the
901 rows become **823 entries**, because **65 sets** of near-duplicates are gathered under
one entry each and the rest lead alone. **A set is kept whole, in the group its first
member is in** — the two readings of the library disagree, the clustering measures a
gradient at 32 positions and the variant cut measures the cloud of colour a map holds, and
**37 of the 65 sets straddle two clusters**. Splitting them would show a reader a strip
called a variant of a palette four screens away, which teaches nobody anything.

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
- **landing** — every made figure is a block a redraw could land on. `--replace` finds
  the block it is about to swap by deriving it and refuses when the page is not carrying
  exactly that, so the derivation is load-bearing in a way the figure check does not
  reach: it once left the explorer link out, which refused a redraw of every picture that
  carries one while everything else stayed green. A linked figure's landing block is held
  to carrying the link as well.
- **assets** — every image the metadata names exists at its stated size, every
  thumbnail is current, and no orphan file is left in a gallery directory.
- **library** — `palettes/library.jsonl` still says what the wallpaper project's own
  palette library says: the same maps, in the same groups, in the same order, and no map
  in the library that the clustering leaves out of every group. This is the one check
  that needs the checkout, and the one that is skipped by name without it. The page
  itself is held to the record by **pages**, on every machine.
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

## Prose has a master, and a page is held to it

A written section is drafted and reviewed as a document — a markdown master in the
Drive-synced working folder — and then placed as hand-written HTML. Two copies of the
same words drift, so `prose.py` reduces both sides the same way (tags out, markdown
markers out, whitespace collapsed) and `python -m builder prose` names the first word
they disagree on. `article/prose.jsonl` says which master belongs to which page, and may
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

`renders.Cache` keys a render on its spec and records it in a manifest beside the files.
Renders are the expensive half and compositions are the half that gets adjusted, so
adjusting a label never re-renders a panel; a changed constant is a new key rather than a
stale file; and the manifest holds every spec, which is what makes the tree re-derivable
rather than merely disposable. It defaults to `artifacts/renders/`, which is ignored.

The rigs that compose the article's figures live in `scratch/` and are untracked — that
is what `scratch/` is for — but everything they used to re-implement is here now, and a
figure made a year ago can be redrawn without reconstructing the session that made it.

## Two rules that predate the code

- **Its output is committed HTML.** Pages never runs Python, so a broken builder can
  only fail to produce the next diff.
- **It only ever reads the code repository.** Nothing in `C:\Code\fractal-wallpapers`
  is written, moved, or regenerated from this side. `import` is the one command that
  reads outside this repository, and the path it reads is an argument — never recorded,
  because full-size material lives elsewhere and stays there.
