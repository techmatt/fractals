# Working in fractal-website

This repository is the public site for the fractal wallpapers project: the article —
a tutorial on rendering escape-time fractals, finding views worth keeping, and
training judges to pick between them — plus the galleries of finished work that make
the case the article is arguing. It is served by GitHub Pages at
`https://techmatt.github.io/fractal-website/`.

The companion code repository is `C:\Code\fractal-wallpapers` (**read-only** from
here). The article links into it per section; nothing is copied across without being
rewritten to read as prose.

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
  out, and a question in one is answered in the report. Placed prose has several edit
  sites — the page, the placement script under `scratch/`, the prose master — and an
  apply touches all of them; caption edits go to the figure registry. Any new factual
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

- **Plain static HTML and CSS. No framework, no bundler, no npm.** A page in this
  repo opens correctly from the filesystem, and what is committed is what is served.
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
galleries/      finished work, generated by the builder
assets/         css/ and images/ — web-res only
builder/        the Python page generator
docs/           how this repository's workflows are run — the page-review loop
scratch/        working files, reports, anything untracked (gitignored)
```

## Checks to run before committing

```
python -m ruff check . && python -m ruff format --check . && python -m builder check
```

After touching placed prose, `python -m builder prose <page>` as well: it reduces the page
and the approved master the same way — tags out, whitespace collapsed — and names the first
word they disagree on.

`builder check` is read-only. It resolves every internal link, refuses root-absolute
and bare-directory hrefs, regenerates the gallery HTML and compares it byte for byte
with what is committed, holds every figure block to its registry row, and holds every
page's contents rail and prose heading ids to what the builder derives. The same
three commands run in CI (`.github/workflows/checks.yml`), which is a check and not a
deploy dependency.

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
