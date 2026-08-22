# Working in fractal-website

This repository is the public site for the fractal wallpapers project: the article —
a tutorial on rendering escape-time fractals, finding views worth keeping, and
training judges to pick between them — plus the galleries of finished work that make
the case the article is arguing. It is served by GitHub Pages at
`https://techmatt.github.io/fractal-website/`.

The companion code repository is `C:\Code\fractal-wallpapers`. The article links into it
per section; nothing is copied across without being rewritten to read as prose.

**It is read-only from here, with one carve-out** *(Matt, 2026-08-21, after
`explorer_generalize` landed engine changes under the old rule)*. A website prompt may
make **minimal engine changes that serve the wasm consumer**, and only where every one of
these holds:

- **zero behaviour** — visibility, inlining, `cfg`, and nothing else;
- **no new dependency and no new feature** in the default build;
- **the engine's tests and the native anchor unmoved**;
- **committed in `fractal-wallpapers` by explicit file path only** — never `git add -A`,
  never `git commit -a`, because another prompt may be running in that repository;
- **named in `engine.manifest.json`**, so that a committed wasm nobody can rebuild is
  never how this ends.

Everything else in that repository stays read-only to a website prompt: its code and its
records are read, and a change to either is somebody else's prompt.

## The naming rule

**Nothing ships under a name the article wouldn't teach.** This repo is public and it
is the front door, so the rule is stricter here than in the code repo: page names,
section slugs, gallery names, image filenames and URL fragments are all vocabulary a
reader meets before any explanation. `discovery`, `coloring`, `curation`, `labeling` —
words that say what the thing does. Internal shorthand and vocabulary from earlier
private versions of this project do not transfer; rename on the way in. A URL is
permanent in a way a variable name is not, so a slug is worth the extra minute.

## Editorial conventions

The naming rule above and the italic rule below are the two that touch markup and
filenames, so they are stated here where a session meets them. `writing-guidance.md` on
the synced drive is the authority for everything else the prose is held to.

- **A term's first mention is italic.** Where the article introduces a piece of its own
  vocabulary — defines it, or first puts it to work — that mention is wrapped in `<i>`:
  *pipeline*, *location*, *escape time*, *palette*, a mode name. This is Wikipedia's
  words-as-words style; never bold, never a class. Once for the whole article in reading
  order, not once per page — a term italicized in Overview is plain everywhere after.
  `<em>` keeps its own job, real emphasis, which is why the two are spelled differently.
  Sparingly: a page speckled with italics has stopped marking anything. Figure captions
  sit outside the count — a caption may use a term the prose has not reached yet, and the
  prose still gets the italic when it does.

## Where prose comes from

Two paths, and a page arrives by one of them.

- **A new section is drafted out of this repository** — a claude.ai design session writes
  it against `writing-guidance.md` — and is then **placed verbatim** as hand-written HTML.
  The approved markdown master goes on the synced drive and is registered in
  `article/prose.jsonl`. A page with no row is a page whose HTML is its own master, which
  is legitimate and is said out loud rather than assumed.
- **A written page is revised by review round**, below.

Either way, **placed prose has more than one edit site**: the page, the prose master, and
any placement script's string literal under ignored `scratch/`. An edit that touches one
and not the others is drift that the next review round refuses to work through.
`python -m builder prose <page>` is the verifier — it reduces both sides the same way,
tags and markdown markers out and whitespace collapsed, and names the first word they
disagree on. **A verbatim comparison in this repository always strips tags and collapses
whitespace**; comparing raw bytes across the HTML/markdown boundary means nothing.

## Reviewing a page

Matt reviews the article by marking up a Google-Docs copy of a page; a session applies his
marks back to the site. Two commands from him drive it, and **`docs/page-review.md` is the
workflow — read it before running either.**

- **"create the review doc for `<page>`"** — `python -m builder review <page>` writes
  `review\<page>.docx` in the Drive-synced folder: the page's prose as served, then its
  figure captions by slug. It holds the page to its approved prose master first and
  refuses on drift. **Drift stops the round and is reported** — it is a bug in whichever
  side moved, not something to reconcile by copying one over the other.
- **"apply the review doc for `<page>`"** — `python -m builder review <page> --read`
  prints Matt's edits, marked inline, and every `[M: ...]` note. A direct edit means
  *roughly this wording*, applied in spirit; an `[M:]` note is an instruction to carry
  out, and a question in one is answered in the report. An apply touches every edit site
  placed prose has; caption edits go to the figure registry. Any new factual
  claim is verified from code or records before it lands, or it is flagged and left out.
  Then `--consume`, so a stale doc can never be applied twice.

The **editorial rules that govern every edit** — audience, register, structure, links,
claims, figures, blurbs, contrast, and which locations a figure may use — are not in this
repository. They live in `C:\Code\fractal-drive-sync\prose\writing-guidance.md`, a
curated living document the claude.ai design sessions and Matt write to as well, and they
apply whether or not an annotation mentions them. `docs/page-review.md` points at it and
keeps the mechanics. **Every apply round ends by distilling that round's generalizable
`[M:]` guidance back into it.**

## Locked conventions

- **Plain static HTML and CSS, and JS where a page needs it. No framework, no
  bundler, no npm.** *(Matt, 2026-08-21: the "no JS on the site" rule is rewritten to
  "JS where needed" — the explorer is the first case.)* Article pages stay script-free
  and open correctly from the filesystem; a page that is a tool may run code, and pays
  for it by having to be served. What is committed is what is served, either way.
- **The builder generates; it never becomes the site.** `builder/` is a small Python
  program that writes gallery and figure pages from the wallpaper project's records.
  Its output is committed HTML — the site never depends on the builder having run,
  and Pages never runs Python.
- **Images here are web-res only.** Full-size wallpapers ship as **GitHub Releases
  assets** and never enter git history. `assets/images/` holds what a page displays;
  anything a reader would download at full size is a release link.
- **Every figure records how it was made.** A figure's registry row carries a
  `provenance` list — one line per panel — and a line holds everything needed to draw
  that panel again: the family and its constants, the frame's centre and width, the
  mode, the palette, the cap, the sample count, the crop. A one-off may record the
  command that was run instead. Nothing about it is published: it is what answers
  "where did this picture come from?" a year later, and the registry is the only place
  that answer survives, because the scripts that draw figures live in ignored
  `scratch/`. A made figure without one is a failing `builder check`. Where a value is
  genuinely lost, the line says so — the record never guesses.
- **Relative links, always.** The site lives under a project-Pages subpath
  (`/fractal-website/`), so a root-absolute `/assets/...` href is broken in
  production and fine locally — the worst kind of bug. Every internal href and src is
  relative to the page that carries it.
- **`.gitignore` keeps its shape**: `scratch/` and `artifacts/` (runtime output),
  toolchain noise, OS junk. A tracked file inside an ignored tree is how these rules
  rot.
- **Formatting is not negotiable**: `ruff` lints and formats the builder's Python at
  line length 100; `.gitattributes` normalizes line endings to LF and marks image
  types binary. A repo-wide reformat should never become possible.
- **Cross-platform by construction**: `pathlib` only, no absolute paths in tracked
  code, lowercase-with-hyphens filenames throughout.

## Layout

```
index.html      the article's front page and table of contents
article/        one page per section, in reading order
palettes/       the two pages that hang off Color palettes without being sections:
                the palette library, generated; and the generator brief, hand-written
galleries/      finished work, generated by the builder
explorer/       the one page that runs code — the engine in wasm, and its link contract
assets/         css/ and images/ — web-res only
builder/        the Python page generator
docs/           how this repository's workflows are run — the page-review loop
scratch/        working files, reports, anything untracked (gitignored)
```

## How a page is put together

Wikipedia's shape: a sticky contents rail on the left, the reading column beside it.

- **The rail appears above one breakpoint and is not shown at all below it** — not folded
  into a control. Every page carries the site bar back to the contents and its own
  previous/next line, so nothing is only reachable through the rail, and an article page
  keeps working with scripting off, which it does entirely.
- **The measure caps text and nothing else.** Prose, headings, captions, the section nav
  and the footer stop at the reading measure; figures and grids of pictures run to the
  full column, which is what the page is worth once the rail has taken its share.
- **Every metric value lives in `assets/css/site.css`**, as a custom property at the top —
  rail width, rail gap, measure, wide, gutter, and the breakpoint itself. Never restate
  one anywhere else, in this file included: a number written down twice is a restyle
  waiting to break.
- **Three font tokens, and each has exactly one job.** `--sans` is the body and every
  piece of furniture — rail, utility labels, site bar, nav. `--serif` is spent only where
  a heading opens something: the page title, and a subhead inside prose. `--mono` is code,
  and the formula block. No webfont is loaded.
- **JS where a page needs it**, per the locked convention above: article pages carry none
  and open from the filesystem; the explorer is the first and so far only exception, and
  brings its own stylesheet as well as its own script.

**A page may hang off a section without being one.** The ten sections are ratified and
`article/` holds exactly those ten; a page that belongs to a section but is not part of
the reading order lives in its own directory and says so in the registries by naming
itself with a slash — `palettes/make-your-own.html`. It carries the rail like any other
page and the rail has no current entry on it, which is what the gallery pages already do.

**The rail is derived, never typed.** `article/sections.jsonl` gives the reading order and
which sections are `"status": "written"`; a rail entry's name is the page's own `<h1>`,
and the entries that open under the current page are that page's prose `<h2>`s. Its title
is the way back to the front page, and under the ten sections it carries the two links
that leave the article — the explorer and the code *(Matt, 2026-08-21)*. A prose
`<h2>` also gets the id its rail entry links to, spelled from its own words by rule —
a fragment is a permanent URL. `python -m builder build` writes the rail between two
marker comments; `check`'s `contents` check re-derives the rail, the heading ids and the
front page's typed done-markers, and fails on any drift. That check is tamper-tested: a
renamed rail entry, a hand-edited heading id and a deleted done marker each produced
exactly one problem and exit 1.

## Figures and their assets

The registry rule and the per-panel `provenance` requirement are locked conventions above.
What a figure is made of:

- **A render sheet is JPEG at quality 88 with no chroma subsampling** (4:4:4). Fractal
  renders are full of saturated edges, and 4:2:0 is visible on them.
- **A diagram is PNG**, and **an animation is an APNG** — which also carries a `.png`
  extension and sits in the **same plain `<img>` block** as everything else. No video
  element, no script, no second markup path.
- **A figure's caption is the caption and nothing else** *(Matt, 2026-08-21, replacing
  the credit rule)*. It used to end with two sentences that were not about the picture: a
  credit saying the engine drew it, identical under every render on the site, and the way
  into the explorer written out as prose. Both are gone from `.figure`. A gallery tile
  still carries its credit, which is where a reader meets a wallpaper without the article
  around it.
- **A caption is centred under the picture, and ranged left once it is long.** Centred is
  the default and suits the one- to four-line caption most figures carry; a caption past
  about three hundred characters is set flush left, which the row asks for with
  `"align": "left"`. The caption is held to the reading measure however wide the figure
  runs.
- **A figure may be registered before its asset exists**, with `"status": "pending"` and
  no file or size. The block it derives is a well saying what the picture will show, which
  is honest in a way an empty space or a broken image is not. `python -m builder figures`
  lists what is still pending; `figures --place` turns a pending row into a made one and
  heals the well its page is still showing.
- **The block is regenerated and diffed, never trusted.** `check` re-derives every figure
  block from its registry row and asserts the page carries it verbatim, so a caption or a
  size lives in exactly one place. A caption edit goes to the registry row and never to
  the page.
- **A picture the explorer can draw again carries a link into it.** `explorer/links.jsonl`
  has one row per figure and per gallery tile: a permalink derived from that picture's own
  provenance, or an explicit `no_link` with which of four reasons it is. The words are
  *open in fractal explorer* wherever it appears — on a figure they are the accessible
  name of a small mark in the picture's corner, and the picture itself is the link; on a
  gallery tile they are still a line of text. The link is derived and never
  typed — `python -m builder links --write`, and `check` holds the registry to the site's
  own roster. **A link that is nearly the figure is worse than none**, so anything the
  contract cannot say exactly — a chosen iteration cap, a curve a mode's catalog does not
  give it, a fractional degree — is a refusal rather than an approximation.
- **`python -m builder diagram <id>` is deliberately unwired** from `build` and from
  `check`. Text is rasterized through whatever font the machine has, so two machines agree
  about the picture and not about its bytes; a regenerate-and-diff check would fail
  everywhere but the machine that drew it.

## Working on this machine

`python -m builder serve [--port N]` puts the committed tree on `localhost:8000`. It
builds nothing and writes nothing. Prefer it to opening files from disk: the explorer does
not start over `file://` at all, and Chrome does not persist page zoom for `file://` URLs,
so a disk preview snaps back to 100% at every navigation.

Two Windows cautions that have each cost a session already:

- **Headless Chrome clamps its window to roughly 480–500px wide.** A `--window-size=320`
  screenshot is a clamped layout cropped, and reads as overflow that is not there. Check
  sub-clamp widths by loading the *served* pages in fixed-width `<iframe>`s, or with real
  device emulation — never with a narrow window size.
- **Any script that rewrites a tracked file spells `newline="\n"`.** `Path.write_text` on
  Windows translates `\n` back to `\r\n`, which silently converts a whole file to CRLF;
  `.gitattributes` normalization only bites at commit time, so `builder check` fails first
  and blames a rail nobody edited.

## Checks to run before committing

```
python -m ruff check . && python -m ruff format --check . && python -m builder check
node --test explorer/permalink.test.mjs explorer/bands.test.mjs
```

The second line is the explorer's two suites, on Node's own runner with nothing
installed. `permalink.test.mjs` is the contract held to itself — a URL is the one
permanent thing this site emits, and it is worth a test suite even though nothing else
here has one. `bands.test.mjs` is the pool held to the committed wasm: a band is a range
of output rows, so the pool decides where the frame is cut and never what is in it, and
the sizes it cuts at are the reader's machine's. It draws the anchor a few times over and
takes a few seconds.

After touching placed prose, `python -m builder prose <page>` as well — see **Where prose
comes from** above for what it holds together and why one edit has several sites.

`builder check` is read-only. It resolves every internal link, refuses root-absolute
and bare-directory hrefs, regenerates the gallery HTML and compares it byte for byte
with what is committed, holds every figure block to its registry row, and holds every
page's contents rail and prose heading ids to what the builder derives. It also prints one
note — never a failure — about the committed wasm module, described in
`explorer/README.md`. The same commands run in CI
(`.github/workflows/checks.yml`), which is a check and not a deploy dependency.

## Standing prompt contract

Each prompt in this project ends the same way:

- Write the final report to `scratch/<prompt_name>_report.md`. **~60 lines is a soft
  target** — write it once, allow at most one trim pass, and never iterate to squeeze
  under the line. Going over is fine; padding and re-editing are not.
- Report findings, numbers, decisions, and surprises only. No process narration, no
  restating the prompt back.
- Then copy the report to `C:\Code\fractal-drive-sync\reports\`.
- **Say where the report landed, in the last line of the console reply** — the copied
  path, spelled out: `Report written to fractal-drive-sync/reports/<name>_report.md`.
  The report is the deliverable, and a reply that summarizes it without naming it
  leaves the reader hunting for the file.

## Rules

- Commit to `main` only.
- **Completed prompt work is committed, without being asked.** Finishing a prompt means
  the work is on `main` — no branches, no PRs, no waiting for approval, in this repo as
  in every repo of this project. The only exception is a very good reason not to, and
  that reason belongs in the report.
- **No commit ≥20 MB** — single blob or aggregate — without Matt's explicit prior
  confirmation. This repo carries images, so the aggregate half of that gate is the
  one that will bite: check the total added size of an image drop before staging it,
  not after.
- **Prompts never land in the repo.** They live in
  `C:\Code\fractal-drive-sync\prompts\`; a working copy in this directory stays
  untracked.
- **Estimate before starting anything long.** If a step will take more than a couple
  of minutes — an image conversion pass, a full builder run — say what it will cost
  first and run it in the background rather than blocking on it.
- Every prompt names its target repository; if the working directory is not that
  repository, stop immediately and say so rather than guessing.
