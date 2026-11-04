# Working in fractal-website

The public site for the fractal wallpapers project, served by GitHub Pages at
`https://techmatt.github.io/fractals/`. `README.md` says what the site is, what is where, and
how to serve and check it; `builder/README.md` has every command and what each check holds;
`explorer/README.md` has the explorer, its wasm modules, its link format, and its test suites.

## The companion repository

`C:\Code\fractal-wallpapers` (`techmatt/fractal-wallpapers`) is **read-only from here, and a
website item never commits into it** *(Matt, 2026-11-04)*. Running its CLI is reading:
`builder/renders.py` shells its `fractal-engine` and writes only to this repository's ignored
`artifacts/` (`FRACTAL_WEBSITE_RENDER_CACHE` moves the cache).

- **An engine seam is a separate item.** The report's `blocks:` line names the exact change
  wanted next door; once it lands, the website side names the new engine commit in
  `explorer/engine.manifest.json` when it rebuilds the wasm, so no committed wasm is one
  nobody can rebuild.
- ⚠ **Nothing rebuilds `engine/target/release/fractal-engine` for you.** After any engine
  edit, `cargo build --release` there before a maker draws; a stale binary refuses a family
  it has never heard of (`phoenix_m`), which reads as a bug in the maker.
- **A record next door with a consumer here has two readers.** A check red on a missing
  column suggests a record thinned next door before it suggests this page;
  `builder/palettes.py`'s `carriers` is the standing example.
- **`builder check` beside a wallpapers merge or a pool-holding run can read a transient
  red** (`builder/README.md` has it); that red is the neighbour's.

## The naming rule

**Nothing ships under a name the article wouldn't teach.** Page names, section slugs, gallery
names, image filenames, and URL fragments are vocabulary a reader meets before any
explanation: `discovery`, `coloring`, `curation`, `labeling`. Internal shorthand and
vocabulary from earlier private versions do not transfer; rename on the way in. A URL is
permanent, so a slug is worth the extra minute.

## Editorial conventions

`C:\Code\fractal-drive-sync\prose\writing-guidance.md` is the authority for the prose:
audience, register, structure, links, claims, figures, blurbs, contrast, and which locations
a figure may use. Matt and the claude.ai design sessions write to it too. It applies whether
or not an annotation mentions it. Three rules touch markup and filenames, so they are here:

- **No italics for emphasis or to introduce a term** *(Matt, 2026-09-24)*, words-as-words
  most of all. Italics only for math variables, titles of works, and quoted material — in
  prose, captions, the explorer's text, and the masters (which spell none of it with `*`).
  Anything else keeps an italic only where its sentence genuinely misreads without one, and
  the item that keeps one names it.
- **The Oxford comma, always** *(Matt, 2026-09-25)*, in prose, captions, alt text, blurbs,
  and the masters. Never applied to code, a link's text, or a record's own name.
- **American spelling in everything a reader sees** (color, gray, normalize). A name keeps
  its own spelling: a palette is written as the library next door spells it
  (`watercolours-in-the-rain-25`).

Nothing enforces the last two.

## Where prose comes from

- **A new section** is drafted by a claude.ai design session and **placed verbatim** as
  hand-written HTML; its master goes at the **root** of `prose\` on the synced drive and is
  registered in `article/prose.jsonl`. A page with no row is its own master, said out loud.
  A superseded master is trashed in Drive, so a row naming one not at the root is stale.
- **A draft's VERIFY AT PLACEMENT list** is worked at placement: each number, constant, and
  file name checked against its source, the prose corrected where they disagree, every
  correction named in the report. The list is not placed.
- **Placed prose has several edit sites**: the page, the master, and any placement script
  under `scratch/`. Editing one and not the others is drift the next round refuses.
  `python -m builder prose <page>` verifies; `builder/README.md`'s *Prose has a master, and a
  page is held to it* has how it compares, tables and formulas included.
- **A written page is revised by review round**, which reads the site as served.

## Reviewing a page

Matt marks up a Google-Docs copy of a page and an item applies the marks. **Read
`docs/page-review.md` before either command.**

- **"create the review doc for `<page>`"** — `python -m builder review <page>`. It holds the
  page to its master first; **drift stops the round and is reported**, never reconciled by
  copying one side over the other.
- **"apply the review doc for `<page>`"** — `python -m builder review <page> --read`. A direct
  edit means roughly this wording; an `[M: ...]` note is an instruction, and a question in
  one is answered in the report. An apply touches every edit site; caption edits go to the
  figure registry. A new factual claim is verified from code or records, or flagged and left
  out. Then `--consume`. **Every apply round ends by distilling its generalizable `[M:]`
  guidance into `writing-guidance.md`.**

## Locked conventions

**The site**

- **Plain static HTML and CSS, JS where a page needs it. No framework, no bundler, no npm.**
  Article pages are script-free and open from the filesystem, bar a **live figure's** one
  module script, derived from its registry row, whose well still says what would be there
  with scripting off. A tool page (the explorer, the atlas frame) runs code and is served.
- **The builder generates; it never becomes the site.** Its output is committed HTML.
- **Images here are web-res only.** Full-size wallpapers ship as GitHub Releases assets and
  never enter git history.
- **The gallery and library assets are tracked** *(Matt, 2026-09-26)*: the Gallery, Deep, and
  Walk tabs' assets, the atlas slot pictures, and `explorer/palettes.bin`. A re-solve,
  re-ingest, or rebake is a tracked diff, committed under the 20 MB gate, and a tile the
  record stops naming is a deletion to commit. `builder/README.md`'s *What was staged, and is
  tracked since the deploy* has the set.
- **Relative links, always** — the site lives under `/fractals/`, so a root-absolute href
  works locally and breaks in production. The only absolute URLs are the head block's
  `og:image`/`og:url` (`builder/heads.py`) and `404.html`'s `<base>`.
- **A white reading surface, and dark image wells** local to the picture containers; no
  dark mode. `builder/theme.py` transcribes the well tokens, held by `check`'s `theme`.
- **Every metric value lives once, as a custom property atop `assets/css/site.css`.** Fonts:
  `--sans` for body and furniture, `--serif` only for the page title and prose subheads,
  `--mono` for code and formulas. No webfont.
- **The rail, the heading ids, and the site bar are derived, never typed.** `python -m builder
  build` writes them; `check`'s `contents` and `bar` fail on drift. A bar link is an edit to
  `pages.topbar`. `builder/README.md`'s *The contents rail is derived, never kept* has the
  rest. The site bar's *GitHub* is this repository (`pages.SITE_REPO`); every mention of the
  code that drew a picture links `pages.CODE_REPO`.
- **The page is Wikipedia's shape.** The rail shows above one breakpoint and not at all below
  it (never folded into a control), since every page's site bar and previous/next line reach
  everything. The measure caps text only; figures run the full column.
- **A page may hang off a section without being one.** `article/` holds exactly the fourteen
  ratified sections; a page belonging to one lives in its own directory and names itself with
  a slash in the registries (`palettes/make-your-own.html`).
- **`.gitignore` keeps its shape**: `scratch/` and `artifacts/`, toolchain noise, OS junk. A
  tracked file inside an ignored tree is how these rules rot.
- **Formatting**: `ruff` at line length 100; `.gitattributes` normalizes to LF and marks
  images binary. **Cross-platform**: `pathlib` only, no absolute paths in tracked code,
  lowercase-with-hyphens filenames.

**Figures** (`builder/README.md`'s *Figures are a registry, not a generator* has the
mechanics)

- **The registry is `article/figures.jsonl`**, and a page's figure block is regenerated
  from it and diffed, so a caption or size edit goes to the row, never the page. A row's
  `status` is `placed`, `pending` (registered before its asset; `figures --place` lands
  it), `held` (`held_reason`), `stale` (`stale_when`), or `draft` (numbers to be re-measured;
  a `note` says what re-bakes it). `sources` keys are strings naming a record, never
  integers. `docs/page-review.md` keeps the only page-by-page status table.
- **A figure's id opens with its page's prefix**, one prefix to a page (a page hanging off a
  section shares its prefix). The prose never names a slug: a reference is positional
  (the figure below).
- **Every figure records how it was made**: a `provenance` line per panel holding everything
  needed to redraw it; a lost value is said to be lost, never guessed.
- **Exactly one provenance line names a map with the word `colormap`**; every other says
  `palette <name>`. `builder/explorer.py` and `builder/links.py` read that word.
- **A figure's maker is tracked, in `builder/`** *(Matt, 2026-09-06)*: a module with a
  `SHEETS`, `MAKERS`, or `DIAGRAMS` entry and a subcommand that draws by figure id. `scratch/`
  holds only the probes that found a choice; a row naming a path under it is a bug. A
  composed sheet goes through `images.land`, the one encoder. Makers are no part of `build`
  or `check`, since text rasterizes through the machine's fonts.
- **A maker addresses a location by its record, never by its position** *(Matt,
  2026-08-22)*: family, frame, and cap frozen into the maker or a committed record beside
  it, never an index into a pool that grows next door.
- **A figure may name its panels by tentative-gallery ID**; the picks live on the row, and
  `python -m builder picks <id> --replace` redraws. Resolve through `gallery.jsonl` and a
  streamed ledger lookup, never the pool.
- **No location is reused unless the repetition is intentional** *(Matt, 2026-09-01)*: a
  `reuse_reason` says why and names the figure it repeats. `check`'s `locations` enforces it.
- **A figure is split into panels unless the composite is the point** *(Matt, 2026-09-22)*:
  one `<img>` per panel at its own link, labels as HTML text, pixels unchanged from the
  composite. A panel links only where the row claims its seat's own recipe drew it, and the
  link comes from that recipe; panels are linked from the record, never from the prose.
- **A picture the explorer can draw again carries a link into it**, derived by `python -m
  builder links --write` into `explorer/links.jsonl`, or a `no_link` with its reason. A link
  that is nearly the figure is worse than none.
- **A caption is the caption only** *(Matt, 2026-08-21)*: no engine credit, no explorer
  directions, ranged left. A label under a picture centres; one drawn into a sheet is sized
  by `builder/sheets.py`'s `label_size`, never per figure.
- **Formats**: render sheets WebP q88 (`images.py`'s `FIGURE_SUFFIX`), diagrams PNG,
  animations APNG in the same `<img>` block. A video is a YouTube id on the row, never hosted.
- **Another artist's picture** only under a CC licence allowing non-commercial sharing,
  confirmed on its page, whole and credited; otherwise a blank, credited cell.

**Matt's judgement, not the repo's**

- **Matt picks the tile.** Where a figure needs one frame of many, the maker builds a
  numbered contact sheet under `scratch/` and Matt names it; the item records which. A
  session never picks for him, however clear the choice looks.
- **Which figures look wrong is his to say.** No `TODO` about how a picture looks and no list
  of suspect figures. What the repo tracks is what a machine decides: `stale_when`,
  `held_reason`, a `draft` note, a `reuse_reason`.

**The explorer's records** (`explorer/README.md`'s *Rebuilding* has each)

- **Which maps and modes it carries are committed records, never derivations**:
  `explorer/palettes.jsonl` (its `offered` and `random` frozen; `random` imported with
  `python -m builder explorer --random`) and `explorer/modes.jsonl` (17, frozen). Widening
  either is an edit to the record; `bake` holds the baked modules to them.
- **The gallery's collections are pinned** by `builder/seats.py`'s `COLLECTIONS`, a stamp
  each; a re-solve is a re-pointing of that table.
- **Display names live in `explorer/palette-names.json`**; a palette is addressed everywhere
  by its own name, and a hand-edited display name says `authored`. `explorer/popular.json`'s
  `pinned` and `dropped` are Matt's, edited by hand.

## Checks to run before committing

```
python -m ruff check . && python -m ruff format --check . && python -m builder check
node --test explorer/permalink.test.mjs explorer/bands.test.mjs explorer/level.test.mjs explorer/derive.test.mjs explorer/stops.test.mjs explorer/saved.test.mjs explorer/undo.test.mjs explorer/zip.test.mjs explorer/stamp.test.mjs explorer/deep-fx.test.mjs explorer/deep-link.test.mjs explorer/deep.test.mjs explorer/deep-gpu.test.mjs explorer/screensaver.test.mjs explorer/hold.test.mjs explorer/fit.test.mjs explorer/dives.test.mjs explorer/aliasing.test.mjs explorer/period-range.test.mjs explorer/pointers.test.mjs atlas/atlas.test.mjs
(cd ../fractal-wallpapers/perturbation && cargo fmt --check) && (cd explorer/perturb-wasm && cargo fmt --check) && (cd explorer/engine-wasm && cargo fmt --check) && (cd builder/deep-gallery-native && cargo fmt --check) && (cd explorer/deep-gpu-model && cargo fmt --check)
(cd explorer/deep-gpu-model && cargo test --release)
```

CI (`.github/workflows/checks.yml`) runs the same lines. The third holds each crate's
deliberate reformat, so a reformat never arrives as a side effect. After touching placed
prose, also `python -m builder prose <page>`.

- ⚠ **Any source edit in `perturb-wasm`, a formatting commit included, owes a rebake**:
  `python -m builder explorer --perturb`. `check`'s `bake` does not catch a stale
  `perturb.wasm`. The picture kernel is the sibling's (`fractal-wallpapers/perturbation`); a
  kernel change is a wallpapers item and owes both perturb modules, rebuilt and compared in
  the order `explorer/README.md`'s *Rebuilding* gives.
- **Run `builder check` on this machine, with the checkout configured, before an item is
  called done, and read the skip count in the exit summary.** CI clones this repository
  alone, so the checks that want the wallpapers checkout report named skips there; a run
  with skips answered part of the question. `builder/README.md`'s *What `check` checks* has
  which checks skip and why.

## Working on this machine

`python -m builder serve [--port N]` serves the committed tree (default `localhost:8000`)
and writes nothing. Prefer it to `file://`: the explorer does not start there, and Chrome
does not persist page zoom for it.

- **Headless Chrome clamps its window to roughly 480–500px wide.** Check narrower widths by
  loading served pages in fixed-width `<iframe>`s or with device emulation, never with a
  narrow window size.
- **A script that rewrites a tracked file spells `newline="\n"`.** `Path.write_text` on
  Windows writes CRLF, and `builder check` fails first and blames a rail nobody edited.
- **Text carrying Windows paths moves under a quoted heredoc (`<<'EOF'`).** bash `printf` and
  Python string literals eat `\f`, `\a`, `\t`, `\b`, and the result still looks plausible.

## Friends' votes

**"ingest NAME <links>"** means: save the pasted text to a file under `scratch/`, run
`python -m builder votes ingest NAME --from <that file>`, and reply with its summary. The
store is outside this repository; `builder/README.md`'s *Friends' votes live outside the
repository* has it.

## Standing item contract

Work arrives as a conductor item; conductor's preamble owns the report's path and header.

- **Write the report where the preamble says, with its header.** ~60 lines is a soft target:
  write it once, never iterate to squeeze under. Findings, decisions, and surprises only; no
  process narration, no restating the item. Tests are mentioned only for a red the item
  could not fix.
- **End the console reply with `Report written to <path>`**, the path spelled out.
- **Commit to the branch you are on.** Completed work is committed without being asked; the
  only exception is a very good reason, which goes in the report.
- **Times are local, on a 12-hour clock** (`5:40pm`).
- **A step over ~30 seconds runs in the background**, with a waiter on the real process (its
  pid, its log line, or the file it writes last), never on a launcher that returns first.
  Say what a long step will cost before starting it.
- **LF line endings** in every file written.
- **An operational fact learned while working goes into the README it belongs to**, never
  only into a report.
- **No commit ≥20 MB**, single blob or aggregate; check an image drop's total before staging.
  An oversize drop stays uncommitted, the rest is committed, and the report names its size.
- **An item's prompt never lands in the repo**; a working copy stays untracked.
- **If the working directory is not the repository the item names, stop and say so.**

## Rules

**Everything on this site is a draft**, owed no deference for having been written. A change
is argued from what the final article should be — never from rework cost, recency, or how
many rounds it has been through. Nor is that a licence to churn: a draft is still held to
every convention above.
