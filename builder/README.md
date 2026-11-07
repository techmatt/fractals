# builder

The page generator: generated pages, web-res images, thumbnails, and the checks. Its output
is committed HTML; Pages never runs Python. Each module's docstring is its reference.

## Commands

```
build                generated pages, thumbnails, every page's rail, site bar, icon links,
                     head block, and go/ redirects (go/redirects.jsonl)
check                the named checks (below); writes nothing, exits 1 on a problem
serve [--port N]     the committed tree at localhost:8000
figure ID [--heal]   print a figure's block, or swap the page's for what the row derives
figures [--all]      what is still to make, by page
figures --place ID SRC [--crop l,t,r,b] [--max-width N] [--lossless] [--provenance FILE]
recipes [--fill]     what article/figure-recipes.jsonl holds; land missing seat rows
links [--write]      derive explorer/links.jsonl from every picture's provenance
locations|judges|palettes|pool|picks|curation|start|front|tools|families|fundamentals|
overview|deep [ID ...] [--place] [--replace]   draw a page's figures
palettes --library   refresh palettes/library.jsonl, land missing strips
picks --narrow [ID]  cut and land a sheet's narrow rendition
growth|pipeline [--stamp S]   charts off the pool study (builder/pool_study.py)
diagram ID           a figure that is not a render (diagrams.DIAGRAMS)
screenshot ID        a piece of the explorer, over CDP (screenshots.MAKERS)
icons                record the icon recipe, draw the icon set
atlas [--ingest]     the atlas record, its figure, or its slot pictures
seats [--records-only]   land the gallery and its collections as one staged gallery
phoenix-points       the Phoenix tab's starting points, tiles, and plane frames
explorer [--palettes-only|--perturb|--style|--random]   bake the explorer's modules
walk                 place the Walk tab's render judge and ORT runtime
packs [--import|stage]   the Wallpaper packs record
votes ingest|status|browse|export-order   friends' picks
tools-and-data       the Tools and data page's two data files
deep-gallery STAGE   thumbs, or a stage of the first search
deep-pack STAGE      the deep gallery pack: members ... verify, zip
dive-candidates|random-dives   deep dives by the Dive block's rules
descent LINK ...     a minibrot descent's keyframe record
prose [PAGE ...]     hold a placed page to its master
formulas [--fetch]   typeset display formulas from TeX as inline SVG
review PAGE [--read [--full]] [--consume] [--force] [--list]
import SRC DEST [--crop l,t,r,b] [--max-width N]   an image in as web-res
```

Each is `python -m builder <line>`; `--help` has the flags. Install with `python -m pip
install -r builder/requirements.txt`. The wallpapers checkout comes from
`FRACTAL_WALLPAPERS_ROOT` or an untracked `local.toml`; `renders.py` alone shells its
engine. Makers and the video tools are no part of `build` or `check`, since text
rasterizes through the machine's fonts.

## What `check` checks

`builder/checks.py`'s module docstring lists every check. It runs on a bare clone: what a
check cannot do without the wallpapers checkout, Pillow, node, or fetched MathJax is a
**named skip**, counted in the exit summary, never a failure or a silent pass. The checkout
is asked by `library`, `bake`, `seats`, `coloring`, half of `figures`, and half of
`stamps`. **A green CI is not a green tree**: run `check` here and read the skip count.

A missing `candidate` key while a merge, leg, or solve runs next door is usually a streamed
read of a ledger being rewritten; rerun once it finishes. Tolerances live in code
(`checks.SEAT_TOLERANCE`, `agreement.TOLERANCE`).

## A gallery is a directory

`assets/images/galleries/<slug>/` holds `gallery.jsonl` (a header, then a record per image,
pixel sizes included, so a page is a pure function of text) and the pictures; `build` makes
`thumbs/` and `wallpaper-packs/<slug>.html`. The slug is a permanent URL. Every JSONL line
has an integer `schema`, and an unknown one is an error.

A header with `"staged": true` gets no page, tile, or link row: `galleries.load_all()` is
the publishable ones, `galleries.staged()` the rest. Staged rows may omit `title` and
`caption`; `alt` is derived. `seated-candidates` is the one, filled by `seats.py`, whose
`COLLECTIONS` pins each collection to a stamp (a re-solve re-points it).

## What was staged, and is tracked since the deploy

Gallery and library assets are tracked (Matt); a rewrite is a diff under the 20 MB gate:
`assets/images/galleries/seated-candidates/*.webp` (`seats`), `explorer/palettes.bin`
(`explorer --palettes-only`; the explorer is blank without it),
`assets/images/atlas/<plane>-*.webp` (`atlas --ingest`), `explorer/deep-gallery/` and
`explorer/random-dives/` tiles, `explorer/phoenix-points/` (`phoenix-points`; its rule,
`OVERRIDES`, and `STYLE` are in `phoenix_points.py`), and `explorer/judges/` (`walk`). The
palette swatch goes to ignored `artifacts/explorer/`.

## Pages outside the reading order

`article/` holds exactly the `sections.jsonl` sections. A page hanging off one has its own
directory and a slash in the registries (`sections.HANGING`, `paths.carrier_path`).
`start-here.html` (`sections.START`, figures in `start.py`) and `tools-and-data/`
(`sections.TOOLS`, data in `tools_and_data.py`, figures in `tools.py`) sit above the
contents. `tools-and-data/run-it-yourself/` is `python -m builder.run_it_yourself import`
then `page`; its hosted pages (`paths.HOSTED_DIRS`) are copied byte for byte and marked
`-text`. `deep-zoom/dives-and-julia-sets/` is `python -m builder.julia_dives page`.

## The contents rail is derived, never kept

`sections.jsonl` gives the order; the rest comes off the pages: a section's name is its
`<h1>`, its entries its prose `<h2>`s. `build` writes the rail between its markers and gives
each prose `<h2>` the id its words derive; `check`'s `contents` re-derives both. Start here
and the group of Wallpaper packs, Tools and data, and Deep zoom videos sit above the title,
named by `sections.py`'s `*_NAME` constants.

The site bar is `pages.topbar(page)`. `build` replaces the `<nav class="topbar">` of every
`sections.hand_written` page (a new page starts with an empty one); a bar link is an edit to
`pages.topbar`. The front page's contents list is hand-written, held to one `<h3>` a section.

## Figures are a registry, not a generator

`article/figures.jsonl` has a row a figure; `figure <id>` prints its block and `check` holds
each page to it verbatim. `status` is `placed`, `pending` (a well; `figures --place` lands
it), `held` (`held_reason`), `stale` (`stale_when`), or `draft` (a required `note`).
`figures.py` has every field. Shapes:

- **Panels**: `panels` and `columns`, a raster, `alt`, and link each (`figure:<id>#<n>`). A
  panel is a `seat`, a `spec`, a `deep` row, a `blank` cell, or a `credit`ed external work.
  `band`, `pool` (a flow figure), and `group` split the grid; `site.css` sets its floor from
  `--figure-across`.
- **`live`** names a piece in `figures.LIVE`, mounted by one module script; **`video`** is a
  YouTube id, optionally with `go` panels under it (`check`'s `go` holds their targets).
- **`narrow`** is a second sheet cut at `sheets.NARROW_WIDTH`, shown below 30rem.

Every made row has `page`, `provenance` (a line a panel, enough to redraw it), `recipe`
(`module:function`), and `sources`, `{kind, keys}` with string keys (**an integer is
refused**):

```
run_row      <run>|release|<candidate>, <head>/<batch>.jsonl:<line>
location     labels/<batch>.jsonl:<line>, <ledger>/walk.jsonl[#<node_id>]
gallery_seat <stamp>|<recipe key>        candidate  <recipe key>
synthetic, none (held_reason says why)   external   a credited panel's page
```

A rename moves the slug, asset files, and `explorer/links.jsonl` rows, never `recipe`.
`figures.place` writes links before healing the block; `figure <id> --heal` fixes a block
whose links moved otherwise. A row's `picks` name seats by tentative-gallery ID; re-pick by
editing them and `picks <id> --replace`. `picks.resolve` reads `figure-recipes.jsonl` first
and next door (a stamp's `gallery.jsonl`, a streamed ledger lookup, never the pool) only for
a new pick; `recipes --fill` never rewrites a row, which may be the only copy. Ask
`frames.py` which places figures already use before picking.

## Prose has a master, and a page is held to it

`prose.py` reduces page and master alike (tags, markdown markers, whitespace) and names the
first disagreeing word. `article/prose.jsonl` maps page to master and records sanctioned
divergences; no row means the page is its own master. Percent-encode a `)` in a master URL.
A table is `[TABLE: a | b]`, rows, `[/TABLE]`, head dropped both sides. A display formula is
`$$ TeX $$` in the master and `<div class="formula" data-tex>` on the page, typeset by
`formulas`. A fold is `[FOLD: summary]`, `[FIGURE: id]`, `[/FOLD]`, a closed
`<details class="fold">` holding no `<h2>`. `review.py` writes the review `.docx` by hand;
`docs/page-review.md` is the workflow.

## Drawing a figure

`theme.py` holds the well colors and fonts, `sheets.py` composition (Pillow only), and
`renders.py` the engine seam: it resolves next door's names through both storage tiers
(`builder.test_renders`), hands the engine absolute paths (it runs in the other checkout),
and `renders.Cache` keys renders on their spec under ignored `artifacts/renders/`. Anything
derived from a cached render carries its key in its name. `images.land` is the one encoder.

## The Wallpaper packs page has a record

`palettes/all-palettes.html` is generated from `palettes/library.jsonl`, which `palettes
--library` alone refreshes from next door. `wallpaper-packs/index.html` is generated from
`wallpaper-packs/packs.jsonl` (`packs --import`, needing `full_set_root` and `packs_root`)
with prose `packs.PROSE`, a placed master. `packs stage` ranks by votes (`ranking.py`) into
`artifacts/packs-stage/`, which `curate packs build` takes; hand-picked previews are
`wallpaper-packs/preview-picks.json`. `deep-pack` builds the deep gallery pack. ⚠ Upload
release assets one at a time and verify `state` and `digest`; force-update a tag only with
its branch, since deleting one drafts the release.

## Friends' votes live outside the repository, and make the packs' order

`votes.py` keeps them in `votes/events.jsonl` under `drive_sync_root`
(`FRACTAL_WEBSITE_VOTES_STORE` overrides), never in this public repository. The store is
append-only; an ingest is idempotent per friend and link. `votes.mjs` matches links to seats
ignoring `level`; `data/seat-link-aliases.jsonl` keeps old spellings. `browse` writes ignored
`artifacts/votes/`; `export-order` feeds `curate packs build --order`.

## Deep zoom videos and descents

`descent` writes a keyframe record to `builder/data/` (its docstring has twins, caps, and
variants); `--direct` takes one Multibrot link as is, as every Julia link is taken.

```
python -m builder descent "<link>" --name <name>
node builder/zoom_fields.mjs --record builder/data/<name>.keyframes.json --variant preview
python builder/zoom.py --record builder/data/<name>.keyframes.json --variant preview video
node builder/zoom_fields.mjs --record builder/data/<name>.keyframes.json
python builder/zoom.py --record builder/data/<name>.keyframes.json video
```

Fields come from the committed `perturb.wasm`. The mapping defaults to
`zoom.DEFAULT_MAPPING`, the knee, one fixed function of the count (Matt: a depth schedule
recolors what is on screen); `zoom.ENCODE`, `descent.GRID`, and `descent.VIDEO` set the rest.
⚠ The base render is large; point `artifacts/<name>` at a big disk first.

## The deep figures

`deep` draws `deep_figures.FIGURES`. A panel is a Deep-tab link and a grid, kept as a `deep`
row of `figure-recipes.jsonl`; a figure leaving the page takes those rows with it. A new
caption goes into `WORDS` and onto the row. `deep-judges-top15` reads
`builder/data/deep-judges-scores.jsonl`.

## The Deep tab's gallery

`explorer/deep-gallery.jsonl` is `{"subject", "link"}` a row, a canonical `dv=3` link
pinning `n`. To add a frame, use Copy link, drop the `?`, append a row, and run
`deep-gallery thumbs`, which draws missing tiles (named by the link's FNV-1a hash) and
removes orphans. Fields come from `builder/deep-gallery-native/`, built on `perturb-wasm`.
⚠ It is rebuilt only when missing: after a `perturb-wasm` or kernel edit, `cargo build
--release` there.

### Dive candidates

`dive_candidates.py` presses the native `pick`, `land`, and `coloring` as the Dive block
does, drawing from `PLANE_WEIGHT`, `LANDING_WEIGHT`, `FROM_WEIGHT`, and `PRE_RUNGS`, and lays
kept tiles out as a numbered sheet in ignored `artifacts/`. `artifacts/dive-reference/` is
the reference look, compared by eye.

### Random dives

`random-dives` is that run landing in `explorer/random-dives.jsonl`: New coloring, the
aliasing guard, gallery tiles, no place twice. Rerun to resume; it stops at `--until`,
`--budget-s`, five errors in a row, or `random_dives.DRY` empty units.

### How the first set was found

`deep_gallery.py`'s constants are the method. A descent takes, largest first, a nucleus of
period at most `MAX_PERIOD`, under 1/`RUNG_SHRINK` of the last body (a real step down), and
over `APART_BODIES` from earlier rungs (not the same copy). Frames are cut from chosen
rungs (framed, symmetry stages, points mapped in by the copy's scale
`σ = d·l^{1/(D−1)}`, Julia frames) and kept below the `f64` floor. A cap is
`max(settled, min(EXPLICIT_CEILING, period × periods))`; λ comes from `LAMBDA_GRID` by
`ROUGH`. Choices made by eye are in `builder/data/deep-gallery-sheet.json`.

## Rules

- **It only reads the wallpapers repository**, never writes there.
- A map the explorer's roster lacks must be added to `explorer/palettes.jsonl` and rebaked,
  or the figure's link silently goes missing.
- Provenance spells the palette pass in words (`picks.shade_words`), which `links.py` reads.
