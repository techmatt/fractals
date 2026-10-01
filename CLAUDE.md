# Working in fractal-website

This repository is the public site for the fractal wallpapers project, served by GitHub
Pages at `https://techmatt.github.io/fractals/`. `README.md` says what the site is, what is
where, how to serve it, and how it relates to the companion repository. That companion is
`C:\Code\fractal-wallpapers` here; the article links into it per section, and nothing is
copied across without being rewritten to read as prose.

**It is read-only from here, with one carve-out** *(Matt, 2026-08-21; widened
2026-09-20)*. A website prompt may make **minimal engine changes that serve the wasm
consumer**, and only where every one of these holds:

- **zero behaviour, measured** — the pipeline's renders are byte-identical after the change
  and it is the prompt's job to have shown that, not to have argued it;
- **widening, or adding when the prompt says so** — visibility, inlining and `cfg` need no
  permission beyond this rule; a **new signature** — a function, a trait impl, a derive —
  needs the website prompt's own brief to have asked for the seam, and nothing else in the
  engine may move to make room for it. A prompt that finds it wants one it was not sent for
  says so and stops;
- **no new dependency and no new feature** in the default build;
- **the engine's tests and the native anchor unmoved**;
- **committed in `fractal-wallpapers` by explicit file path only** — never `git add -A`,
  never `git commit -a`, because another prompt may be running in that repository;
- **named in `engine.manifest.json`**, so that a committed wasm nobody can rebuild is
  never how this ends.

**A website prompt holds the lock on that repository only when it builds the wasm or
commits into it.** The carve-out commits by explicit file path precisely so that it does not
need the lock. Running `builder check` locks nothing but makes a prompt **pool-adjacent**:
never beside a wallpapers merge or a pool-holding leg, because `check` streams records that
work rewrites (`builder/README.md` has the transient red it produces). A prompt's header says
which of the two it is.

Everything else in that repository stays read-only to a website prompt: its code and its
records are read, and a change to either is somebody else's prompt. **Running its CLI is
reading** — `builder/renders.py` shells `fractal-engine` to draw a figure's panels, and
every byte of that lands in this repository's ignored `artifacts/`, never next door. The
render cache defaults to `artifacts/renders/` and `FRACTAL_WEBSITE_RENDER_CACHE` moves it,
which is the only knob involved.

⚠ **That binary is the release build in the checkout next door, and nothing rebuilds it for
you.** `renders.py` runs `engine/target/release/fractal-engine` as it finds it, so after any
edit to the engine crate — the carve-out's included — rebuild it with `cargo build --release`
before a maker draws. A stale binary does not look stale: it refuses a family it has never
heard of, `phoenix_m` for one, which reads as a bug in the maker asking for it.

**A record next door with a consumer here is a schema with two readers**, and the second is
invisible from the first. Read-only is not free of obligation: when that repository thins a
record and derives the dropped fields back at its own read, nothing here knows.
`carriers.jsonl` is the standing example, and `builder/palettes.py`'s `carriers` derives
`fields` and `mean` on this side and says where the seam is. A website prompt that finds a
check red on a missing column should suspect a thinned record before it suspects its own
page; a change to that shape lands here as a failing `library` check and nowhere earlier.

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

- **No italics for emphasis or to introduce a term** *(Matt, 2026-09-24)*. He finds both
  patronizing, the words-as-words kind most of all. Italics are kept only for math
  variables, titles of works and quoted material. That covers prose, captions, the
  explorer's text and the prose masters alike: a master spells none of it with `*`.
  Anything else keeps an italic only where its sentence genuinely misreads without one,
  and a prompt that keeps one names it.
- **The Oxford comma, always** *(Matt, 2026-09-25)*. In every list of three or more, a
  comma comes before the final "and" or "or": in prose, captions, alt text, and blurbs,
  and in the masters that hold them. It is prose's rule and never code's, so an
  identifier, a link's text and a record's own name stay as they are spelled. Nothing
  enforces it, which is why it is written down.

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

A master lives at the **root** of `prose\` on the synced drive. A superseded master is
**trashed in Drive** when its replacement is placed, so a registry row naming a master that
is not at the root is a stale row, and worth saying. A draft may arrive with a
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
that a wrong number cannot hide inside a right one. A **display formula** is the other:
`$$ TeX $$` on its own line in the master, a `<div class="formula" data-tex="…">` on the
page that `python -m builder formulas` typesets into inline SVG, and the TeX is what is
compared. Inline math stays HTML.

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
  bundler, no npm.** Article pages stay script-free and open correctly from the
  filesystem; a page that is a tool may run code, and pays for it by having to be served.
  What is committed is what is served, either way. **The one script an article page may
  carry is a live figure's**: a registry row with `live` derives a well plus one module
  script that mounts a piece of the site over it (the Atlas panel, on Fractal atlases).
  Opened from disk or with scripting off, the module never runs and the well says what
  would be there and links to it, so the page still opens correctly from the filesystem.
  The script comes from the registry, never from hand-written markup.
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
  a record, no standing item in `docs/page-review.md`. A `TODO` the tree may carry is the
  other kind — a number to re-verify against a run that does not exist yet, which is a fact
  somebody can check rather than a taste somebody has to have. What the repo tracks instead
  is what a machine can decide — a `stale_when` that names an event, a `held_reason` that
  names what is blocked, a `draft` note that says what re-bakes it, a `reuse_reason` a
  collision made necessary — each of which fails or fires on its own. Where a figure pass
  leaves something genuinely undecided, the row carries the collision and says it is not
  yet judged, which is a state a check reads rather than a task somebody has to remember.
- **A figure is split into panels unless the composite is the point** *(Matt,
  2026-09-22)*. One `<img>` per panel, each a link at its own view, every drawn label HTML
  text. What stays composited is the figure whose meaning is the **juxtaposition itself**
  (a before-and-after pair, a grid whose two axes are the claim) or whose panel count makes
  individual links silly (a sixty-four-tile contact sheet). A split row carries `panels`
  and `columns` and no file of its own; `builder/README.md` has the mechanics, including a
  **blank** panel (`"blank": true`, a cell no frame fills yet) and a **link** panel
  (`"link": "link|<figure>#<n>"`, naming a `kind: "link"` row in
  `article/figure-recipes.jsonl` that holds a shallow explorer link verbatim, read off that
  row and never derived). **The arrangement and the pixels do not change**: a panel is
  exactly the tile the sheet pasted, which is a thing to measure against the lossless
  composite in `artifacts/` rather than to assert. The one exception is `escape-families`,
  whose panels land at the 640 they were composed at (`builder/families.py` says why).
  What a maker still draws into the pixels is what the page cannot know where to put — a
  mark at a point of the plane, a box round the region the next frame shows, a gradient
  strip that is the map a panel spends. Everything else is elements: a label, a band's
  heading and its chips, the arrow between two bands, and the coloured frame that ties a
  panel to a mark on another one.
- **A split figure's panels are linked from their record, never from the prose.** The
  `colormap` rule below is what pays for a sheet being one link at its representative
  panel, and it means every other panel's map is written in a way the link scanner does not
  read — run panel by panel it silently carries the representative's map onto all of them,
  which is a link that opens the right place in the wrong colour. So a panel is linkable
  only where the row *claims* the seat's own recipe drew it, and the link comes from that
  recipe whole. A maker that changed the recipe to make its point, or that draws at a map
  of its own, needs its own per-panel view before its figure can be split.
- **A figure's id opens with its page's prefix** — `overview-`, `escape-`, `render-`,
  `modes-`, `locations-`, `judges-`, `palette-`, `wallpapers-`, `gallery-`, `pipeline-`,
  `atlas-`, `deep-`, `art-`, `math-`, `start-`, `packs-`, `tools-` — so a slug says where it
  lives before anything looks it up. One prefix to a page and one page to a prefix, with
  the single carve-out that a page hanging off a section shares that section's prefix:
  `palette-generator-batch` sits on `palettes/make-your-own.html`. The front page's one
  picture is `index-hero`, on a row whose page is spelled `./index.html` — the slash a
  bare name at the root lacks — and it has no caption. The Wallpaper packs page's one
  picture is `packs-hero`, on `wallpaper-packs/index.html`, the other figure with no
  caption, and the one registry figure on a page the builder generates rather than one a
  person writes. The prose never uses a figure's slug: a reference from the text is
  **positional** (*the figure below*), because this site numbers no figures and anchors
  none.
- **Exactly one line of a figure's `provenance` puts the word `colormap` in front of a
  map's name.** That word is what `builder/explorer.py`'s `drawn_in` reads to say which
  maps the explorer owes a gradient to — `builder check`'s `bake` fails on a picture drawn
  in a map the explorer's roster does not carry — and `builder/links.py` reads the same
  word to derive the link itself. Every other line of the row says `palette <name>`
  instead. A sheet of eighty strips is one link at its representative panel; a row that
  writes `colormap` on every line asks the explorer to carry hundreds of gradients so that
  one figure could be opened at a picture it does not even show.
- **Which maps the explorer carries is a committed record, never a derivation.**
  `explorer/palettes.jsonl` names every map `palettes.js` is baked from; `python -m builder
  explorer` reads the names from it and the gradients from the library next door, and
  `check`'s `bake` holds the committed module and blob to being byte for byte what that
  produces. Widening it is an edit to the record. The studio's picker lists every map it
  carries, as tabs (the maps this pool seats, then a tab per hue family, then all of them
  behind a filter box) *(Matt, 2026-09-15)*. Two fields on the record are frozen too:
  `offered`, the **77** the old single menu listed, which the studio's tabbed picker no
  longer reads but which stays baked, because a name that was offered is a name that keeps
  resolving; and `random`, the **232** maps Random palette may land on, imported from next
  door's `data/palettes/palettes_for_random_choice.csv` by `python -m builder explorer
  --random` and never derived, since that project owns the threshold and a moved list
  arrives here as a failing `bake`. `random` narrows one button and nothing else.
  `explorer/README.md`'s *Rebuilding* has how the record came to be one.
- **And so is which modes it carries.** `explorer/modes.jsonl` names the modes `catalog.js`
  is baked from, in the order the picker shows them. **17, and that number is frozen**:
  the bake reads each mode's identity line and curve from the engine catalog next door and
  offers nothing the record does not name, so an engine promotion never reaches a reader
  without an edit here. The list is written three times — the record, the baked module,
  and `permalink.js`'s typed `MODES` — and both ties are checked, `bake` holding the record
  to the module and `permalink.test.mjs` the module to the contract. **The Render mode
  select lists fewer**: the modes the **published** gallery record seats, read off the same
  committed record. The 17 are still baked, parsed, and drawn when a link names one, which
  puts that mode in the select for as long as its view is up; the gallery panel's mode chips
  tally whichever collection is chosen, and another collection seating a mode the
  published record does not is a chip and never a select entry.
- **The gallery panel shows one collection, and the record is their union.**
  `seated-candidates` is the published record, the same general solve at n=2000, and the
  nineteen collections next door (twelve hue families and seven modes, sized by that
  project's `curation/targets.py`), one row per seat, with `collections` naming each
  collection that seats it and its place in that collection's order. A **Collection**
  dropdown chooses one and the chips filter what it chose. ⚠ **All twenty-one
  records are published next door (ckpt156), and Matt's word is that their sizes are
  essentially final**, so `builder/seats.py`'s
  `COLLECTIONS` names a stamp per collection and refuses one whose solve was another
  collection's; a re-solve is a re-pointing of that table, and `seats` removes the tiles a
  repoint leaves unnamed. The record is split by collection: `gallery.jsonl` is the header
  alone, and each collection's rows are in the file its header entry names. A staged
  gallery ships one size and it is the tile, 316 px WebP; `builder/README.md` has the rest.
- **A palette is shown by its display name and addressed by its own.**
  `explorer/palette-names.json` is `{underlying: {name, source}}` and the only place a
  display name lives; the underlying name is what links, Copy link, download filenames,
  records and the bake spell. `source` is `authored` or `generated`, and
  `python -m builder explorer --names` fills missing entries and never rewrites an authored
  one, so a hand-authored name is safe from it — a hand edit says `authored` beside it. The
  picker's Popular list is `explorer/popular.json`. Its `pinned` and `dropped` are Matt's
  and edited by hand (the same rule as a figure's tile); `--popular` fills the other places
  around them under the rule `builder/picker.py` states, and never moves a pin.
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
- **A figure's maker is tracked, and lives in `builder/`** *(Matt, 2026-09-06)*.
  `provenance` is a record and not a program, and a redraw off one is archaeology. So a
  maker is a module in `builder/` with an entry in its own `SHEETS`, `MAKERS` or
  `DIAGRAMS` table and a subcommand that draws it by figure id — `families`,
  `fundamentals`, `overview`, `diagram`, `locations`, `judges`, `palettes`, `pool`,
  `picks`, `curation`, `growth`, `pipeline`, `atlas`, `front`, `deep`, `start`, `tools`,
  `screenshot`. `scratch/` stays what it is for: the probes, sweeps and contact sheets
  that *found* a choice. Once a choice is made, the program that acts on it is committed,
  and a row naming a path under `scratch/` is a bug. Three rules come with it. **A maker
  addresses a location by its record** (its own bullet below) — the constants a search
  settled on are frozen into the maker or read from a committed file, never re-derived at
  draw time; where the answer is too big to write into the maker, it is a committed record
  beside it, as `builder/data/locations-walk-descent.json` is. **One encoder**: a composed
  sheet goes through `images.land`, which downscales to `WEB_RES_MAX_WIDTH` and encodes
  exactly the way `python -m builder import` does, so moving a maker into the repository
  never rewrites the bytes of a picture that did not change — which is also the test that
  a port is faithful. And **these commands are no part of `build` or `check`**, for
  `diagram`'s reason: text rasterizes through whatever font the machine has, so two
  machines agree about the picture and not about its bytes.
- **The figure registry is `article/figures.jsonl`**, beside `sections.jsonl` and
  `prose.jsonl`. Every row says where it stands in `status` — `placed`, `pending`, `held`
  (registered and deliberately not on a page, with a `held_reason`) or `stale` (overtaken
  by the event its `stale_when` names; a placed row may carry a `stale_when` as a standing
  warning) or `draft` (made and on its page, and its **numbers** are a reading of a
  measurement that will be taken again; a `note` says what re-bakes it, and the caption
  carries a small `Draft` mark — every page here is a draft and says so nowhere, and this
  is the narrower claim, that a reader who copied a number off the picture would be
  copying something with a shelf life). Every row also carries `sources`: a list of
  `{kind, keys}` naming the records its pictures came out of, where **a key is a string
  that addresses a record by its own name and an integer is refused at load**.
  `builder check` resolves every key against the store its kind names (`builder/README.md`
  lists them) and says so and moves on where the wallpapers checkout is not configured.
  `docs/page-review.md` carries the page-by-page table of what is written, mastered,
  reviewed and held; nothing else keeps a copy of it.
- **A figure may name its panels by tentative-gallery ID.** Matt picks wallpapers off the
  curation browser by the alias under a tile; `builder/picks.py` turns
  `<stamp>|<recipe key>` into a picture, so a re-pick is an edit to the `picks` list on the
  figure's own registry row followed by `python -m builder picks <id> --replace`, and
  nothing about the recipe is retyped. **The row is where the picks live** — the maker
  reads them back off it rather than holding a list of its own, because a second list is a
  second thing to keep in step. Two reads resolve one pick: the seat out of that stamp's
  `gallery.jsonl`, which carries no palette at all, and the recipe out of the candidate
  ledger **by a streamed lookup that stops as soon as it has its keys**. Never the pool —
  a solve may be running next door, and a figure prompt has no business loading what it
  is solving over.
- **A maker addresses a location by its record, never by its position** *(Matt,
  2026-08-22)*. A rig that resolves a stored pick through an index into a pool derived from
  the wallpaper project's live data is drawing at a moving target: that pool grows, the
  index comes to land somewhere else, and a rerun rewrites provenance under pictures that
  never changed — the worst shape this can take, because nothing on the page looks wrong.
  A choice freezes the family, the frame and the cap it chose; the pool's own name for it
  survives as the note of where it was found, and a rerun says out loud when that name has
  gone stale.
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
  (`/fractals/`), so a root-absolute `/assets/...` href is broken in
  production and fine locally — the worst kind of bug. Every internal href and src is
  relative to the page that carries it. Two absolute URLs are deliberate, both under
  `pages.SITE_URL`: the derived head block's `og:image` and `og:url`, which a link preview
  resolves from no page (`builder/heads.py`), and `404.html`'s `<base>`, because Pages
  serves that page at any depth (`pages.not_found_page`).
- **`.gitignore` keeps its shape**: `scratch/` and `artifacts/` (runtime output),
  toolchain noise, OS junk. A tracked file inside an ignored tree is how these rules
  rot.
- **Formatting is not negotiable**: `ruff` lints and formats the builder's Python at
  line length 100; `.gitattributes` normalizes line endings to LF and marks image
  types binary. A repo-wide reformat should never become possible.
- **Cross-platform by construction**: `pathlib` only, no absolute paths in tracked
  code, lowercase-with-hyphens filenames throughout.

## Layout

`README.md`'s *What is where* is the map. What it leaves out:

- `article/` holds exactly the fourteen ratified sections, in reading order; a page that
  hangs off one lives in its own directory (below).
- `go/` pages are in neither the rail nor the contents: one row of `redirects.jsonl` each,
  and a page `build` writes from it.
- `atlas/` also holds a redirect at the address the standalone atlas page had.
- `docs/` is how this repository's workflows are run — the page-review loop.
- `scratch/` is the probes and contact sheets a choice was found with, reports, and
  anything untracked (gitignored). Not the makers — those are in `builder/`.

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
  but a live figure's, and open from the filesystem; the explorer, and the atlas frame its
  Atlas tab mounts, are the exceptions, and each brings its own stylesheet as well as its
  own script. That same frame is Fractal atlases' live figure, mounted by
  `atlas/embed.js`: one implementation with two callers, never a copy.

**A page may hang off a section without being one.** The fourteen sections are ratified
and `article/` holds exactly those fourteen; a page that belongs to a section but is not
part of the reading order lives in its own directory and says so in the registries by
naming itself with a slash — `palettes/make-your-own.html`. It carries the rail like any
other page and the rail has no current entry on it, which is what the gallery pages
already do.

**The rail is derived, never typed.** `article/sections.jsonl` gives the reading order and
which sections are `"status": "written"`; a rail entry's name is the page's own `<h1>`,
and the entries that open under the current page are that page's prose `<h2>`s. Its title
is the way back to the front page, and under the fourteen sections it carries the links
that leave the article — the explorer and the code, and this site's own code under it. No
entry marks a section written; the flag stays in `sections.jsonl`. Above the title sit
four headings that are not sections — **Start here**, **Wallpaper packs**, **Tools and
data**, and **Deep zoom videos** — each spelled by a `sections.*_NAME`, in two
`rail-group`s: Start here alone, then the other three with no rule between them;
`builder/README.md`'s *The contents rail is derived, never kept* has each. A prose
`<h2>` also gets the id its rail entry links to, spelled from its own words by rule —
a fragment is a permanent URL. `python -m builder build` writes the rail between two
marker comments; `check`'s `contents` check re-derives the rail and the heading ids,
holds the front page's typed contents list to having an entry per section, and fails on
any drift.

**The site bar is derived the same way, and never typed.** `pages.topbar(page)` is the one
spelling of its links; `build` writes it on every page that carries it, generated or
hand-written, and `check`'s `bar` holds each to it. A bar link is an edit to `pages.topbar`
and a `build`, never to a page.

**Two repositories are linked from every page, and each link says which.** The site bar's
*GitHub* is this repository (`pages.SITE_REPO`), because a bar link named after the site is
the site. The rail's code link, the footer and every mention of the code that drew a
picture go to `techmatt/fractal-wallpapers` (`pages.CODE_REPO`).

## Figures and their assets

The registry rule and the per-panel `provenance` requirement are locked conventions above.
What a figure is made of:

- **A render sheet is WebP at quality 88** *(2026-09-21)*. `images.py`'s `FIGURE_SUFFIX`
  is where the format is named, no maker spells it, and the comment above it records why
  4:2:0 WebP was accepted where 4:2:0 JPEG had been refused. ⚠ **The committed WebP are
  transcodes of the JPEGs they replaced**, so a maker rerun does *not* reproduce them byte
  for byte the way the one-encoder rule promises; it lands one lossy step better, and the
  promise holds from that redraw on.
- **Another artist's picture is shown only under its own licence** *(art_section_ckpt157)*:
  any CC licence that allows non-commercial sharing (BY, BY-SA, BY-NC, BY-NC-SA,
  BY-NC-ND), confirmed on the work's page. The file is the artist's published image,
  whole — scaled and re-encoded, nothing else — and the panel carries a `credit` and an
  `external` source; a page stating no licence or all rights reserved gets a blank,
  credited cell. `builder/README.md` has the mechanics.
- **A diagram is PNG**, and **an animation is an APNG** — which also carries a `.png`
  extension and sits in the **same plain `<img>` block** as everything else. No video
  element, no script, no second markup path. **A video is not the site's to host**: a
  registry row that says `video` names a YouTube id and derives one `youtube-nocookie.com`
  `<iframe>`, lazy and 16:9, carrying no script of the site's own, and titled by the row's
  `alt`. Six rows carry one: `start-video` on Start here, `deep-zoom-video` on Deep zoom,
  and four on Deep zoom videos. Under its player each carries two linked pictures: panels
  that each name a short link in `go` and link through `go/`, so `go/redirects.jsonl` stays
  the one source of a target, and `check`'s `go` fails when the register moves on from the
  target a picture was drawn at. A row with those panels and no `video` yet holds a 16:9
  *Video pending* well where the player will go; none is waiting today.
- **A figure's caption is the caption and nothing else** *(Matt, 2026-08-21)*: no credit
  saying the engine drew it, and no way into the explorer written out as prose. A gallery
  tile still carries its credit, which is where a reader meets a wallpaper without the
  article around it.
- **A caption is ranged left; a label under a picture is centred** *(Matt, 2026-08-22)*. A
  figure's caption is prose and is set flush left whatever its length, held to the reading
  measure however wide the figure runs. The short name under a gradient strip is a label
  rather than a caption, and centres. Both live in `assets/css/site.css` and there is no
  per-figure knob.
- **A label drawn into a sheet is centred under its tile, and one rule sizes it**
  *(Matt, 2026-08-22)*. The rule is `builder/sheets.py`'s `label_size`: the larger of a
  share of the tile's height and a share of the composed sheet's width, so that the size
  means the same thing on sheets composed at different widths. It steps down where a line
  would run past its tile, and there is no per-figure size to pass.
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
  provenance, or an explicit `no_link` with which of five reasons it is — the fifth,
  `external`, is another artist's work, which links to its own page instead. The words are
  *open in fractal explorer* wherever it appears — on a figure they are the accessible
  name of a small mark in the picture's corner, and the picture itself is the link; on a
  gallery tile they are still a line of text. The link is derived and never
  typed — `python -m builder links --write`, and `check` holds the registry to the site's
  own roster. **A link that is nearly the figure is worse than none**, so anything the
  contract cannot say exactly — a fractional degree, a fold on a cyclic map — is a refusal
  rather than an approximation. A cap (`n`, permalink v4) and a curve a mode's catalog does
  not give it (`curve`, tools_figures_ckpt156) used to be on that list and are keys now.
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
node --test explorer/permalink.test.mjs explorer/bands.test.mjs explorer/level.test.mjs explorer/derive.test.mjs explorer/stops.test.mjs explorer/saved.test.mjs explorer/undo.test.mjs explorer/zip.test.mjs explorer/stamp.test.mjs explorer/deep-fx.test.mjs explorer/deep-link.test.mjs explorer/deep.test.mjs explorer/screensaver.test.mjs explorer/hold.test.mjs explorer/fit.test.mjs explorer/dives.test.mjs explorer/aliasing.test.mjs explorer/period-range.test.mjs explorer/pointers.test.mjs atlas/atlas.test.mjs
(cd explorer/perturb-wasm && cargo fmt --check) && (cd explorer/engine-wasm && cargo fmt --check) && (cd builder/deep-gallery-native && cargo fmt --check)
```

**The third line is there so that a reformat can never arrive as a side effect**; each
crate's reformat was taken deliberately, in a commit of its own, and this line is what
holds it. ⚠ **A formatting commit or any source edit in `perturb-wasm` moves
`perturb.wasm`'s bytes** — a comment that moves a line included — and owes a rebake:
`python -m builder explorer --perturb`, with the new bytes named in
`perturb.manifest.json`. `builder check`'s `bake` will not say so: it holds `palettes.js`
and `catalog.js` and never rebuilds either module, so a `perturb.wasm` that no longer
matches its crate is a green check. **A formatting commit in `engine-wasm` rebuilds its
module and compares too**, and reports whichever it got. `explorer/README.md`'s
*Rebuilding* has the measurements behind both.

The second line is the twenty JavaScript suites, on Node's own runner with nothing
installed; `explorer/README.md`'s *The test suites* says what each holds, and
`atlas/README.md` the atlas's.

After touching placed prose, `python -m builder prose <page>` as well — see **Where prose
comes from** above for what it holds together and why one edit has several sites.

`builder check` is read-only, and it runs thirty-one named checks. `builder/checks.py`'s
module docstring names every one and what it holds; `builder/README.md`'s *What `check`
checks* has most of them at more length. It also prints one note — never a failure — about
the committed wasm module, described in `explorer/README.md`. The same commands run in CI
(`.github/workflows/checks.yml`), which is a check and not a deploy dependency, on Linux,
macOS and Windows, with a `crates` job that builds the three Rust crates on the manifests'
toolchain and reports each built wasm's hash beside the committed one without asserting it.

**Every check runs on a bare clone, and what cannot run says so by name.** CI clones this
repository alone, so a check that needs the wallpapers checkout is a check CI never makes.
Nine of them want it — the next-door halves of `stamps`, `readmes`, `repeats` and `packs`
(which needs the full set as well: `full_set_root` in `local.toml`, and there on disk),
`library`, `bake`, `seats`, `coloring`, and the source-key half of `figures` — and without
it each reports a **named skip**: `skipped` rather than `ok` on its own line, and counted
in the exit summary. `caps` joins them only for a seat panel whose recipe the ledger next
door alone holds, and there is none today: all 107 are in `article/figure-recipes.jsonl`.
Pillow's absence is the same shape, for pixel sizes, and node's for the whole of `caps`,
which asks the permalink contract through `emit.mjs`. Never a crash
before the other checks, and never a silent pass. The one command that needs the checkout
on the palette library page's behalf is `python -m builder palettes --library`, which
rewrites the record and lands any missing strip.

**Which is why a checkpoint runs `check` here, not in CI.** A green CI says every check
that a bare clone can ask came back clean, and nothing about the nine questions it
skipped by name. Before a prompt is called done, run `python -m builder check` on this
machine with the checkout configured and read the skip count in the exit summary — a run
that reports skips is a run that answered part of the question.

## Friends' votes

**"ingest NAME <links>" means: save the pasted text to a file under `scratch/`, run
`python -m builder votes ingest NAME --from <that file>`, and reply with its summary.**
The store is `votes/events.jsonl` under the Drive-synced folder
(`C:\Code\fractal-drive-sync\votes\` on this machine), outside this public repository
and append-only. `builder/README.md` has the rest.

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
- **Commit with a pathspec (`git commit -- <paths>`), never a bare `git commit` after
  staging**, because another prompt may have staged files in the same index.
- **No commit ≥20 MB** — single blob or aggregate — without Matt's explicit prior
  confirmation. This repo carries images, so the aggregate half of that gate is the
  one that will bite: check the total added size of an image drop before staging it,
  not after.
- **The gallery and library assets are tracked** *(Matt, 2026-09-26)*. The Gallery tab's
  tiles, the atlas slot pictures, the Deep tab's tiles, `explorer/palettes.bin` and the
  Walk tab's judges are committed beside the records that name them, so what Pages serves
  is what the local build serves. **A re-solve, a re-ingest or a rebake shows up as a
  tracked diff**, and it is committed like any other: it is subject to the 20 MB gate
  above, and a tile the record stops naming is a deletion to commit, not a file to forget.
  `builder/README.md`'s *What was staged* has the set and its sizes.
- **Prompts never land in the repo.** They live in
  `C:\Code\fractal-drive-sync\prompts\`; a working copy in this directory stays
  untracked.
- **Estimate before starting anything long.** If a step will take more than a couple
  of minutes — an image conversion pass, a full builder run — say what it will cost
  first and run it in the background rather than blocking on it.
- Every prompt names its target repository; if the working directory is not that
  repository, stop immediately and say so rather than guessing.
