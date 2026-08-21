# builder

The page generator. It writes the gallery pages and the gallery index, derives web-res
images and thumbnails, and checks the committed tree. Everything it writes is committed
HTML: the site never depends on the builder having run, and GitHub Pages never runs
Python. A build is done here and reviewed in a diff.

```
python -m builder build     regenerate gallery pages, the gallery index, thumbnails,
                            and the contents rail every page carries
python -m builder check     links, page sync, contents, figure blocks, assets, prose,
                            theme, banned vocabulary
python -m builder figure ID print a figure's markup block, to paste into an article page
python -m builder figures [--all]   what is still to make, grouped by page
python -m builder figures --place ID SRC [--crop l,t,r,b] [--max-width N] [--lossless]
                            [--provenance FILE]   land a finished figure in one step
python -m builder locations [ID ...] [--place] [--replace]
                            draw the figures of the Finding good locations page
python -m builder judges [ID ...] [--place] [--replace]
                            draw the figures of the Training judges page
python -m builder diagram ID draw one of the two figures that are diagrams, not renders
python -m builder explorer [--palettes-only]  bake the explorer's palettes, wasm, manifest
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

Install what it needs with `pip install -r builder/requirements.txt`. `check` needs no
image library for the parts that read HTML; Pillow only lets it verify pixel sizes too.

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

## The contents rail is derived, never kept

`article/sections.jsonl` gives the ten sections their reading order and says which are
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
figure *block*: `assets/images/figures/figures.jsonl` holds one row per figure, and
`python -m builder figure <id>` prints the markup to paste. `check` re-derives that
markup and asserts the page carries it verbatim, so a caption lives in one place and a
page that has drifted is a failing check rather than something noticed later.

A figure can be registered before its picture exists. Such a row carries `"status":
"pending"` and names no file, width or height, and the block it derives is a well holding
the description of the picture to come. Prose gets written before pictures get made, and a
page that says what is coming beats a broken image or a silent gap; `figures` lists what
is still owed, grouped by the page it is owed on.

When the asset lands, `figures --place` does the whole of what used to be four steps with
two numbers retyped: it imports the picture as a web-res asset, writes the file and the
measured size back into the row, and replaces the pending well on the page with the block
the filled row derives. Nothing about the size is typed, so nothing about it can be typed
wrong.

Three fields travel with every row beyond its words. `page` names the article page that
carries it — a row on no page is a failing check, where before it was silence. `provenance`
is one line per panel in prose, saying what would have to be re-rendered to draw that panel
again; a made row without one is a failing check too. `recipe` names the maker and its
arguments — `module:function` — which is what actually redraws the figure today; where that
module is inside `builder`, `check` holds the name to still existing. Prose outlives code
and code is what runs, which is why both are kept.

Two figures are an exception, and they are diagrams rather than pictures of a location:
the orbit race and the pipeline explain a mechanism, so there is nothing to render and
nothing outside this repository to read. `diagram` draws those two from `diagrams.py`, in
the stylesheet's own colours, straight into `assets/images/figures/`. It is deliberately a
separate command from `build` and is not part of `check`: type is rasterized through
whatever font the machine has, so two machines agree about the picture and not about its
bytes. Every other figure asset arrived through `import`.

## What `check` checks

- **links** — every internal `href` and `src` on every page resolves, and none is
  root-absolute. The site is served from `/fractal-website/`, so a rooted href works
  locally and breaks only in production. A link to a bare directory fails too: a page
  here has to open from the filesystem, where `galleries/` is a directory listing.
- **pages** — the committed HTML under `galleries/` is byte-identical to what the
  builder produces now, and no page there is unaccounted for.
- **contents** — every hand-written page carries today's rail, every prose heading carries
  the id its words give it, every article page is listed in `sections.jsonl`, and the
  front page marks the same sections done that the registry calls written.
- **figures** — every figure block matches its registry row; every row names the page
  that actually carries it; every registered file exists at the size it claims, a pending
  figure excepted until its asset lands; and a recipe naming a maker inside `builder`
  names one that is still there.
- **assets** — every image the metadata names exists at its stated size, every
  thumbnail is current, and no orphan file is left in a gallery directory.
- **prose** — every row of `article/prose.jsonl` names a page that is in this article and
  is written. The masters themselves are on a synced drive that a clone need not have, so
  `check` holds the registry and `prose` holds the documents.
- **theme** — the well colours a drawn figure is made of are the ones `site.css`
  declares. Pillow cannot read CSS, so they are transcribed into `theme.py`; this is what
  keeps a restyle from moving the well and leaving every diagram on the old one.

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
