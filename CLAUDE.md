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
records are read, and a change to either is somebody else's prompt. **Running its CLI is
reading** — `builder/renders.py` shells `fractal-engine` to draw a figure's panels, and
every byte of that lands in this repository's ignored `artifacts/`, never next door. The
render cache defaults to `artifacts/renders/` and `FRACTAL_WEBSITE_RENDER_CACHE` moves it,
which is the only knob involved.

**Read-only is not free of obligation, and `carriers.jsonl` is the standing example**
*(2026-09-06)*. That repository dropped `fields` and `mean` from every carrier row to buy
headroom under its 1 MiB history guard, and both are derived back at its own read — so
nothing above its `palettes/carriers.py` knew. Nothing there knew about this repository
either, and the library page's `dominant_hues` read `mean` straight off the file and broke
on a `KeyError`. `builder/palettes.py`'s `carriers` now derives both on this side and says
where the seam is. **A record next door with a consumer here is a schema with two readers**,
and the second one is invisible from the first: a website prompt that finds a check red on a
missing column should suspect a thinned record before it suspects its own page, and a change
to that shape lands here as a failing `library` check and nowhere earlier.

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
- **A written page is revised by review round**, below. Once a page is placed, a round
  reads **the site**: the doc is built from the page as served, and the master is what the
  page is held to rather than what is reviewed.

A master lives at the **root** of `prose\` on the synced drive, and `prose\old\` is what
has been superseded — a registry row naming a master under `old\` is either a stale row or
a file in the wrong folder, and which one it is worth saying. A draft may arrive with a
**verification list at its foot**, headed *VERIFY AT PLACEMENT*: every number, ratio,
constant and file name the prose leans on. Placement is where that list is worked — each
line checked against the source it names, the prose corrected where the source disagrees,
and every correction named in the report. The list is not itself placed.

Either way, **placed prose has more than one edit site**: the page, the prose master, and
any placement script's string literal under ignored `scratch/`. An edit that touches one
and not the others is drift that the next review round refuses to work through.
`python -m builder prose <page>` is the verifier — it reduces both sides the same way,
tags and markdown markers out and whitespace collapsed, and names the first word they
disagree on. **A verbatim comparison in this repository always strips tags and collapses
whitespace**; comparing raw bytes across the HTML/markdown boundary means nothing. A
table is the one structure with a rule of its own: a master spells it
`[TABLE: a | b | c]` / rows / `[/TABLE]`, the head comes out on both sides because a
`<th>`'s words are the page's own, and the cells compare with a space between them so
that a wrong number cannot hide inside a right one.

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
- **Matt picks the tile; a session lays the choices out.** Where a figure needs one
  frame out of many, the maker builds a numbered contact sheet under ignored `scratch/`
  and Matt names the tile he wants; the prompt's addendum records which one it was. A
  session never picks for him, however clearly one panel looks best — the article's claim
  is that a person chose these pictures, and a machine pick standing in for one makes that
  claim quietly false.
- **And which figures look wrong is his to say, not something the repo tracks.** Whether a
  picture reads badly is the same judgement as picking the tile, so a session does not
  open a backlog of it: no `TODO` about how a picture looks, no list of suspect figures in
  a record, no standing item in `docs/page-review.md`. The one `TODO` the tree does carry,
  on `full-pipeline.html`, is the other kind — a number to re-verify against a run that
  does not exist yet, which is a fact somebody can check rather than a taste somebody has
  to have. What the repo tracks instead is what a machine
  can decide — a `stale_when` that names an event, a `held_reason` that names what is
  blocked, a `draft` note that says what re-bakes it, a `reuse_reason` a collision made
  necessary — each of which fails or fires on its own. Where a figure pass leaves
  something genuinely undecided, the row carries the collision and says it is not yet
  judged, which is a state a check reads rather than a task somebody has to remember.
- **A figure's id opens with its page's prefix** — `overview-`, `escape-`, `render-`,
  `modes-`, `locations-`, `judges-`, `palette-`, `wallpapers-` — so a slug says where it
  lives before anything looks it up. One prefix to a page and one page to a prefix, with
  the single carve-out that a page hanging off a section shares that section's prefix:
  `palette-generator-batch` sits on `palettes/make-your-own.html`. The three unwritten
  sections have no figures and so no prefix yet. The prose never uses that slug: a
  reference from the text is **positional** (*the figure below*), because this site
  numbers no figures and anchors none.
- **Exactly one line of a figure's `provenance` puts the word `colormap` in front of a
  map's name.** That word is what `builder/explorer.py`'s `drawn_in` reads to say which
  maps the explorer owes a gradient to — `builder check`'s `bake` fails on a picture drawn
  in a map the explorer's roster does not carry — and `builder/links.py` reads the same
  word to derive the link itself. Every other line of the row says `palette <name>`
  instead. A sheet of eighty strips is one link at its representative panel; a row that
  writes `colormap` on every line asks the explorer to carry hundreds of gradients so that
  one figure could be opened at a picture it does not even show.
- **What the explorer's picker offers is a committed record, never a derivation**
  *(2026-08-25)*. `explorer/palettes.jsonl` names every map `palettes.js` is baked from and
  which of them the picker lists. **77 are offered, and that number is frozen**; the total
  is the record's to say and is not written down here, because it grows every time a
  figure lands in a map the roster did not carry. `python -m builder explorer` reads the
  names from it and the gradients from the library next door, and `check`'s `bake` holds
  the committed module to being byte for byte what that produces. The bake used to ask the
  library "which of you are curated", and a two-hundred-map drop next door answered
  differently — a rebake nobody ran on purpose would have taken the picker from 77 entries
  to 277. Widening it is an edit to the record.

  **The studio's picker lists the whole library, and the guard is now about the library**
  *(Matt, 2026-09-15, with `explorer_studio`)*. A single menu of names was the reason the
  offered set had to be curated at all; the picker is a tab strip now — the maps this
  pool actually seats, then a tab per hue family, then all of them behind a filter box —
  and a thousand names laid out three ways is a picker rather than a list. So the page
  reads no `offered` flag. The field stays on the record and stays baked: it is what the
  old menu listed, the bake still holds the module to it, and a name that was offered is a
  name that keeps resolving. What the guard protects is unchanged and is now stated of the
  right thing — **which maps the page carries is the record's to say, never a derivation**,
  and the 277-entry rebake would still be caught, because the blob and the index are held
  to `palettes.jsonl` and not to a question asked of the library.
- **And so is which modes it offers** *(2026-09-01)*. `explorer/modes.jsonl` names the
  modes `catalog.js` is baked from, in the order the picker shows them. **17 are offered,
  and that number is frozen.** The bake reads the names from it and each mode's identity
  line and curve from the engine catalog next door, so `catalog.js` reproduces byte for
  byte the way `palettes.js` does and has no clock carve-out. This one broke the same way
  the palettes did, from the other side: the bake asked the engine "which of you are
  production", the engine promoted `tail_itinerary`, and the next rebake would have put a
  nineteenth mode in front of a reader. It was 18 until 2026-09-04, when a mode this site
  retired was struck from the record — the same edit in the other direction, and the
  reason the number is stated here as a frozen count rather than as the engine's roster.
  The list is written three times — the record, the
  baked module, and `permalink.js`'s typed `MODES` — and both ties are checked, `bake`
  holding the record to the module and `permalink.test.mjs` the module to the contract.

  **The Mode select lists fewer than that** *(explorer_palettes, 2026-09-16)*: the modes
  the published gallery record seats, the same set as the gallery panel's mode chips and
  read off the same committed record. That is a narrowing of what a control *lists* and
  not of what the page carries: the 17 are still baked, still parsed, and still drawn when
  a link names one, which puts that mode in the select for as long as its view is up.
- **A palette is shown by its display name and addressed by its own** *(explorer_palettes,
  2026-09-16)*. `explorer/palette-names.json` is `{underlying: {name, source}}` and the only
  place a display name lives; the underlying name is what links, Copy link, download
  filenames, records and the bake spell. `source` is `authored` or `generated`, and
  `python -m builder explorer --names` fills missing entries and never rewrites an authored
  one, so a hand-authored name is safe from it — a hand edit says `authored` beside it. The picker's
  Popular list is `explorer/popular.json`. Its `pinned` and `dropped` are Matt's and edited
  by hand (the same rule as a figure's tile); `--popular` fills the other places around
  them under the rule `builder/picker.py` states, and never moves a pin.
- **No location is reused across the site unless the repetition is intentional**
  *(Matt, 2026-09-01)*. A location gets one figure. Where the repetition is the point —
  a family's home view, which is its identity rather than anything the search found; a
  set the reader has just met, drawn again so the palette is the only thing changing —
  the registry row carries a `reuse_reason` that says why **and names the figure it
  repeats**, which is what stops one excused frame from excusing every other frame that
  row stands on. `check`'s `locations` check reads each panel's frame out of
  `provenance` — family, degree, constants, centre, width — and fails on a frame under
  two slugs with nothing claiming it; a reason that excuses no collision fails the same
  way, so a re-pick takes its excuse with it. Two figures at one centre and two widths
  are two locations to the check and one place to a reader, and that gap is a judgement
  call the record cannot make.

- **Every figure records how it was made.** A figure's registry row carries a
  `provenance` list — one line per panel — and a line holds everything needed to draw
  that panel again: the family and its constants, the frame's centre and width, the
  mode, the palette, the cap, the sample count, the crop. A one-off may record the
  command that was run instead. Nothing about it is published: it is what answers
  "where did this picture come from?" a year later. A made figure without one is a
  failing `builder check`. Where a value is genuinely lost, the line says so — the
  record never guesses.
- **A figure's maker is tracked, and lives in `builder/`** *(Matt, 2026-09-06)*. This
  used to say the opposite — that the registry was the *only* place a picture's origin
  survived, because the scripts that draw figures lived in ignored `scratch/`. That was
  already untrue of most of them, and where it was true it cost: of fourteen figures
  whose row named a script under `scratch/`, **thirteen of those scripts were gone**, and
  `escape-julia-map` had to be patched pixel-wise rather than recomposed because the
  program that drew it no longer existed. `provenance` is a record and not a program, and
  a redraw off one is archaeology.

  So a maker is a module in `builder/` with an entry in its own `SHEETS`, `MAKERS` or
  `DIAGRAMS` table and a subcommand that draws it by figure id — `families`,
  `fundamentals`, `overview`, `diagram`, `locations`, `judges`, `palettes`, `pool`,
  `picks`, `curation`. `scratch/` stays what it is for: the probes, sweeps and contact
  sheets that *found* a choice. Once a choice is made, the program that acts on it is
  committed. **All 61 of them are, as of 2026-09-06**, and a row naming a path under
  `scratch/` is now a bug rather than a legacy.

  Three rules come with it. **A maker addresses a location by its record** — the
  constants a search settled on are frozen into the maker or read from a committed file,
  never re-derived at draw time, because a maker free to re-derive is free to answer
  differently and move a picture nobody asked to move. Where the answer to a search is
  too big to write into the maker, it is a committed record beside it —
  `builder/data/locations-walk-descent.json` is the one of those. **One encoder**: a
  composed sheet goes through `images.land`, which downscales to `WEB_RES_MAX_WIDTH` and
  encodes exactly the way `python -m builder import` does, so moving a maker into the
  repository never rewrites the bytes of a picture that did not change — which is also
  the test that a port is faithful, and **all fourteen recovered on 2026-09-06 came back
  byte for byte identical**. And **these commands are no part of
  `build` or `check`**, for `diagram`'s reason: text rasterizes through whatever font the
  machine has, so two machines agree about the picture and not about its bytes.
- **The figure registry is `article/figures.jsonl`**, beside `sections.jsonl` and
  `prose.jsonl`. Every row says where it stands in `status` — `placed`, `pending`, `held`
  (registered and deliberately not on a page, with a `held_reason`) or `stale` (overtaken
  by the event its `stale_when` names; a placed row may carry a `stale_when` as a standing
  warning) or `draft` (made and on its page, and its **numbers** are a reading of a
  measurement that will be taken again; a `note` says what re-bakes it, and the caption
  carries a small `Draft` mark — every page here is a draft and says so nowhere, and this
  is the narrower claim, that a reader who copied a number off the picture would be
  copying something with a shelf life). Every row also carries `sources`: a list of `{kind, keys}` naming the records
  its pictures came out of, where **a key is a string that addresses a record by its own
  name and an integer is refused at load**. `builder check` resolves every key against the
  store its kind names — `run_row` against the curation release records and the
  finished-render stores, `location` against the location label store and the walk
  ledgers, `gallery_seat` against the recorded tentative gallery its stamp names,
  `candidate` against the candidate ledger — and
  says so and moves on where the wallpapers checkout is not configured.
  `docs/page-review.md` carries the page-by-page table of what is written, mastered,
  reviewed and held; nothing else keeps a copy of it.
- **A figure may name its panels by tentative-gallery ID** *(2026-09-02)*. Matt picks
  wallpapers off the curation browser by the alias under a tile; `builder/picks.py` turns
  `<stamp>|<recipe key>` into a picture, so a re-pick is an edit to the `picks` list on the
  figure's own registry row followed by `python -m builder picks <id> --replace`, and
  nothing about the recipe is retyped. **The row is where the picks live** — the maker
  reads them back off it rather than holding a list of its own, because a second list is a
  second thing to keep in step. Two reads resolve one pick: the seat out of that stamp's
  `gallery.jsonl`, which carries no palette at all, and the recipe out of the candidate
  ledger **by a streamed lookup that stops as soon as it has its keys**. Never the pool —
  a solve may be running next door, and a figure prompt has no business loading what it
  is solving over.
- **A maker addresses a location by its record, never by its position.** A rig that
  resolves a stored pick through an index into a pool derived from the wallpaper
  project's live data is drawing at a moving target: that pool grows, the index comes to
  land somewhere else, and a rerun rewrites provenance under pictures that never changed
  — the worst shape this can take, because nothing on the page looks wrong.
  *(Matt, 2026-08-22, after eleven render lines across the four Rendering modes figures
  were found rewritten that way.)* A choice freezes the family, the frame and the cap it
  chose; the pool's own name for it survives as the note of where it was found, and a
  rerun says out loud when that name has gone stale.
- **A white reading surface, and dark image wells.** Prose wants a page a reader can sit
  with; the wallpapers, most of them dark, want a mat rather than a white void to float
  in. So the dark treatment stays **local to the containers that hold pictures** and
  nothing else on the page goes with it, and there is no dark mode to write a second
  palette for. `site.css`'s `:root` defines six well tokens, and five of them are
  transcribed into `builder/theme.py` because Pillow cannot read CSS. The sixth is
  `--well-link`, which stays CSS's alone: it colours the links a well carries and a drawn
  sheet has none to colour. `check`'s `theme` check holds the five to the original — a
  drawn figure is furniture for the well it sits in, and a restyle that moves `--well` and
  forgets the figures is a failing check rather than a seam somebody notices in a picture
  months later.
- **American spelling, in everything a reader sees.** Page prose, headings, figure
  captions, alt text, gallery blurbs: *color*, *coloring*, *gray*, *normalize*. The one
  place a British spelling survives is **inside a name** — a palette is recorded exactly
  as the library next door spells it, so `watercolours-in-the-rain-25` is written that
  way wherever it appears, the same carve-out the naming rule and the clock ban both
  make for a name. Nothing enforces this, which is why it is written down.
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
                the palette library, generated from library.jsonl beside it; and the
                palette prompt, hand-written
galleries/      finished work, generated by the builder
explorer/       the first page that runs code — the engine in wasm, and its link contract
atlas/          the second: every place the search kept, on the plane it came out of,
                over a per-partition record `builder/atlas.py` holds to shape
assets/         css/ and images/ — web-res only
builder/        the Python page generator
docs/           how this repository's workflows are run — the page-review loop
scratch/        the probes and contact sheets a choice was found with, reports,
                anything untracked (gitignored). Not the makers — those are in
                builder/, per the locked convention below
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

**A page may hang off a section without being one.** The twelve sections are ratified
and `article/` holds exactly those twelve; a page that belongs to a section but is not part of
the reading order lives in its own directory and says so in the registries by naming
itself with a slash — `palettes/make-your-own.html`. It carries the rail like any other
page and the rail has no current entry on it, which is what the gallery pages already do.

**The rail is derived, never typed.** `article/sections.jsonl` gives the reading order and
which sections are `"status": "written"`; a rail entry's name is the page's own `<h1>`,
and the entries that open under the current page are that page's prose `<h2>`s. Its title
is the way back to the front page, and under the twelve sections it carries the two links
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
- **A caption is ranged left; a label under a picture is centred** *(Matt, 2026-08-22,
  replacing the rule that centred a caption until it passed about three hundred
  characters)*. A figure's caption is prose and is set flush left whatever its length,
  held to the reading measure however wide the figure runs. The short name under a
  gradient strip is a label rather than a caption, and centres. Both live in
  `assets/css/site.css` and there is no per-figure knob: the `align` field a row used to
  ask with is gone.
- **A label drawn into a sheet is centred under its tile, and one rule sizes it**
  *(Matt, 2026-08-22)*. The labels a maker draws into the picture are past CSS's reach,
  and every sheet used to name its own size — 13 here, 17 there, each chosen against the
  sheet at the size it was composed at, which is not the size anybody reads it at. The
  rule is `builder/sheets.py`'s `label_size`: the larger of a share of the tile's height
  and a share of the composed sheet's width, the second being the floor that makes the
  size mean the same thing on a sheet composed at 1316 and one at 2688. It steps down
  where a line would run past its tile, and there is no per-figure size to pass.
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

Three Windows cautions that have each cost a session already:

- **Headless Chrome clamps its window to roughly 480–500px wide.** A `--window-size=320`
  screenshot is a clamped layout cropped, and reads as overflow that is not there. Check
  sub-clamp widths by loading the *served* pages in fixed-width `<iframe>`s, or with real
  device emulation — never with a narrow window size.
- **Any script that rewrites a tracked file spells `newline="\n"`.** `Path.write_text` on
  Windows translates `\n` back to `\r\n`, which silently converts a whole file to CRLF;
  `.gitattributes` normalization only bites at commit time, so `builder check` fails first
  and blames a rail nobody edited.
- **A block of text carrying Windows paths moves under a quoted heredoc.** bash `printf`
  reads `\f`, `\a`, `\t`, `\b` and friends as escapes even where the backslashes are
  doubled, so `E:\FractalStorage\fractal-wallpapers\artifacts\location_views` lands as
  `E:\FractalStorageractal-wallpapersrtifacts\location_views`, which is still plausible at
  a glance; Python string literals eat the same escapes on the way in. `<<'EOF'` does no
  escape processing at all, which is the only reason to reach for anything else.

## Checks to run before committing

```
python -m ruff check . && python -m ruff format --check . && python -m builder check
node --test explorer/permalink.test.mjs explorer/bands.test.mjs explorer/level.test.mjs atlas/atlas.test.mjs
```

The second line is the four JavaScript suites, on Node's own runner with nothing
installed. `permalink.test.mjs` is the contract held to itself — a URL is the one
permanent thing this site emits, and it is worth a test suite even though nothing else
here has one. `bands.test.mjs` is the pool held to the committed wasm: a band is a range
of output rows, so the pool decides where the frame is cut and never what is in it, and
the sizes it cuts at are the reader's machine's. It draws the anchor a few times over and
takes a few seconds. `atlas.test.mjs` holds the atlas record to the same contract, and
pins the one thing on that page that could break in silence: the map the search's node
views are drawn through and the explorer's own `DEFAULT_PALETTE` are the same map, which
is the only reason a dot's picture and a dot's link agree. `level.test.mjs` holds the
module's own measurement of a picture's tone to the autolevel operator's, and holds a
curve the page derived to replaying to the bytes it drew, which is what lets Copy link
write five numbers; its pixel case skips by name on a machine without the decoded bases
in `artifacts/level-derive/`.

After touching placed prose, `python -m builder prose <page>` as well — see **Where prose
comes from** above for what it holds together and why one edit has several sites.

`builder check` is read-only, and it runs eighteen named checks. It resolves every
internal link, refuses root-absolute and bare-directory hrefs, regenerates the gallery
HTML and compares it byte for byte with what is committed, holds every figure block to
its registry row, holds every made figure to being a block a redraw could land on —
that is `landing`, whose subject is the derivation rather than the page, and the reason
it is named here is that a redraw is refused by exactly this going wrong — rebakes the
explorer's two generated modules and compares them with what is committed, holds every
page's contents rail and prose heading ids to what the builder derives, sweeps the words
a reader meets for em-dashes — that is `dashes`, mechanical since 2026-09-07, and it is
named here because the rule it holds is `writing-guidance.md`'s rather than this file's —
and sweeps
`git ls-files --eol` for a tracked file that has drifted to CRLF on disk — that is
`endings`, and it is named here because it is the one drift `git status` and `git diff`
both report as nothing. It also
prints one note — never a failure — about the committed wasm module, described in
`explorer/README.md`. The same commands run in CI
(`.github/workflows/checks.yml`), which is a check and not a deploy dependency.

**Every check runs on a bare clone, and what cannot run says so by name.** CI clones this
repository alone, so a check that needs the wallpapers checkout is a check CI never makes.
Four of them want it — `library`, which holds `palettes/library.jsonl` to the palette
library next door; `bake`, which rebakes the explorer's modules; `seats`, which holds a
panel to the picture its gallery ships; and the source-key half of `figures` — and
without it each reports a **named skip**: `skipped` rather than `ok`
on its own line, and counted in the exit summary. Pillow's absence is the same shape, for pixel sizes. Never a crash before the
other checks, and never a silent pass. *(This is a rule because it was broken: `check`
built the palette library page straight off the checkout, so on a machine without one it
raised before the first check, and CI's check step spent that whole time red for a reason
that had nothing to do with the site.)* The one command that needs the checkout on that
page's behalf is `python -m builder palettes --library`, which rewrites the record and
lands any missing strip.

**Which is why a checkpoint runs `check` here, not in CI.** A green CI says every check
that a bare clone can ask came back clean; it says nothing about the palette record, the
explorer's generated modules, whether a seat panel is still the picture its gallery
ships, or a single one of the source keys a figure cites, because
those four questions were skipped by name. Before a prompt is called done, run
`python -m builder check` on this machine with the checkout configured and read the skip
count in the exit summary — a run that reports skips is a run that answered part of the
question.

## Staging a prompt

**"stage `<prompt>.md`" means prepare it, not run it** *(Matt, 2026-09-02)*. It exists so
a second prompt can be thought through while a first one still holds this repository, and
that is the whole of the rule: a staging run costs the live prompt nothing.

- **Read the named prompt and everything it points at**, and run read-only commands
  freely — `git log`, `builder check`, a served page, whatever answers the question.
- **Produce a concrete plan**: what changes, in which files, in what order, what gets
  measured, which steps get backgrounded.
- **Dirty nothing.** No edit to a tracked file, no new file anywhere in the checkout,
  nothing staged and nothing committed. Notes and scratch scripts go to the session's
  scratchpad directory outside the repository — not to `scratch/`, which is inside it.
- **Touch no running work**: no render leg, no training run, no pool-holding process, no
  slow lane. The live prompt owns those, and a staging run that starts one has already
  broken the only promise it makes.
- **Expect `git status` to come back dirty, and leave every file in it alone.** Those
  changes belong to the prompt that is still running.
- **Stop at the plan.** Say it is ready and that the tree is not yours. The lock is handed
  over explicitly; `git status` going clean on its own is not the handover, and neither is
  the other prompt looking finished.

A staged plan is not completed prompt work, so the commit rule under **Rules** does not
reach it — there is nothing to commit until the prompt is actually run.

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

- **Everything on this site is a draft.** No page, figure, name or record here is
  finished, and none of it is owed deference for having been written already. An argument
  for a change is made from what the final article should be — never from how much rework
  it would cost, how recently something landed, or how many rounds it has already been
  through. "We just changed that" is not a reason to keep it, and neither is "that would
  undo last week's work". The converse is not a licence to churn: a draft is still held to
  every convention above, and a change still has to be argued for on the article's terms.
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
