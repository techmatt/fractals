# builder

The page generator. It writes the gallery pages and the gallery index, derives web-res
images and thumbnails, and checks the committed tree. Everything it writes is committed
HTML: the site never depends on the builder having run, and GitHub Pages never runs
Python. A build is done here and reviewed in a diff.

```
python -m builder build     regenerate gallery pages, the gallery index, thumbnails,
                            and the contents rail every page carries
python -m builder check     links, page sync, contents, figure blocks, assets (read-only)
python -m builder figure ID print a figure's markup block, to paste into an article page
python -m builder diagram ID draw one of the two figures that are diagrams, not renders
python -m builder import SRC DEST [--crop l,t,r,b] [--max-width N]
```

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
page that says what is coming beats a broken image or a silent gap; `check` prints what is
still owed. When the asset lands, drop the status, add the file and its size, and re-paste.

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
- **figures** — every figure block matches its registry row; every registered file
  exists at the size it claims, a pending figure excepted until its asset lands.
- **assets** — every image the metadata names exists at its stated size, every
  thumbnail is current, and no orphan file is sitting in a gallery directory.

## Two rules that predate the code

- **Its output is committed HTML.** Pages never runs Python, so a broken builder can
  only fail to produce the next diff.
- **It only ever reads the code repository.** Nothing in `C:\Code\fractal-wallpapers`
  is written, moved, or regenerated from this side. `import` is the one command that
  reads outside this repository, and the path it reads is an argument — never recorded,
  because full-size material lives elsewhere and stays there.
