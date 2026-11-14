# Reviewing a page

Matt marks up a copy of a page in Google Docs, and a Claude Code session applies his marks
back to the site. The loop is two commands he types:

> **"create the review doc for `<page>`"** → build the doc and say where it landed.
>
> **"apply the review doc for `<page>`"** → read the marked-up doc back and apply all of it.

A page is named either way (`overview` or `overview.html`). `builder/review.py` is the
mechanics.

## Where the docs live

```
C:\Code\fractal-drive-sync\review\
    <page>.docx                     waiting: built, and possibly marked up
    applied\<page>-<date>.docx      consumed: already applied, never applied again
```

The folder is Drive-synced, so a `.docx` there is marked up in Google Docs and syncs back.
Its root comes from `drive_sync_root` in the untracked `local.toml`, or from
`FRACTAL_DRIVE_SYNC_ROOT` (`builder/prose.py`).

`python -m builder review --list` (or `review` with no page) says what is waiting and what
has been applied, for the fourteen pages in `article/sections.jsonl` only; a page off that
list is listed by nothing.

## Create

```
python -m builder review <page>
```

The command holds the page to its approved prose master **first**, and refuses to write a
doc if they have drifted apart. **On drift, stop and report it.** Do not build the doc,
and do not reconcile the two texts by copying one over the other — find out which side
moved without the other.

The doc holds the title and a line naming page, master, and build date; the annotation
convention (`review.CONVENTION`); the prose **as served**, with a `[figure: slug]` marker
where each picture sits; then every caption, one line per slug, read off the registry (a
pending figure also shows its well's text). A placeholder figure with no registry row
stands in the prose as `[figure placeholder: slug] Draft caption: …`, and an edit to it
goes to the page's `<figcaption>`. A stub with no prose gets no doc. Links are live
against the served site; italics and code spans are flattened, and survive on the page.

If a doc is already waiting, the command refuses rather than overwrite marks nobody has
applied. `--force` overwrites, for when Matt says the waiting doc is stale.

## The annotation convention

Stated at the top of every doc, and it is the whole contract:

- **A direct edit means "roughly this wording."** Apply it in spirit — it is a note about
  what the sentence should say, not text to paste in. Keep the page's voice, the
  surrounding rhythm, and the markup the words are wrapped in.
- **`[M: ...]` is an instruction, a question, or a comment.** Carry it out. If it is a
  question, answer it in the report — that is the only place the answer will be seen.

## Apply

```
python -m builder review <page> --read          # the edits and the notes
python -m builder review <page> --read --full   # and the whole doc, paragraph by paragraph
```

`--read` rebuilds the doc from today's page, diffs the marked-up copy against it from the
Prose heading on, and prints only what differs — each changed paragraph with `[-dropped-]`
and `{+added+}` marked inline — followed by every `[M: ...]` in order. That list is the
work.

Re-running `--read` after landing some edits shows only what is left; an empty list
confirms every edit reached the page.

Read `writing-guidance.md` (below) before applying anything.

### Placed prose has more than one edit site

An apply touches **all** of them, or the next `prose` check fails and the next review
round starts from a page that no longer matches its master.

| What changed | Where it lands |
| --- | --- |
| A sentence of prose | `article/<page>.html`, **and** the placement script's literal under `scratch/` if one exists for that page, **and** the prose master in `prose\` |
| A figure caption | the figure's row in `article/figures.jsonl` — never the page. `python -m builder check` re-derives the block and fails if the page was edited instead |
| A page's opening | the page's lead paragraph; no page has a standfirst (`writing-guidance.md` cut the device). The front page's blurb for that section often says the same thing; change it too if the edit applies there |
| A heading | the page. `python -m builder build` regenerates its id and every rail that lists it |

A placement script under ignored `scratch/` may be absent; say so and edit the other two.

### A new claim is verified, never composed

A **new factual or technical claim** in an annotation (a number, a mechanism, a name) is
checked against its source before it lands: the code and records in
`C:\Code\fractal-wallpapers` (read-only from here), the run ledgers, the audit reports in
`C:\Code\fractal-drive-sync\reports\`. **A claim that cannot be verified is flagged in the
report and left out of the page**, never guessed at or softened.

### Finishing

```
python -m builder prose <page>                     # page and master agree again
python -m builder build                            # if a heading moved
python -m ruff check . && python -m ruff format --check . && python -m builder check
python -m builder review <page> --consume          # into review\applied\
```

Both checks green, then the doc is consumed (a second consume the same day gets a `-2`
suffix) — a doc left in `review\` can be applied a second time onto a page that already
has it. Then the report, per the standing contract in `CLAUDE.md`: what changed, an answer
to every `[M: ...]` question, and anything flagged rather than applied. Commit the work.

### Every round ends by distilling its guidance

The last step of an apply, before the report is written, is to read that round's `[M: ...]`
notes again and ask of each one: **is this a rule, or is it this sentence?**

A rule goes into `writing-guidance.md`, attributed to Matt and dated, phrased to govern a
page nobody has written yet, and consolidated with anything there that says the same. A
note about this sentence goes into the page and the report only. Nothing there is
deleted or weakened without Matt's word; adding and consolidating need no permission.

## The editorial rules

The single editorial authority is `C:\Code\fractal-drive-sync\prose\writing-guidance.md`,
on the synced drive because the design sessions, the Claude Code sessions, and Matt all
write to it. It governs every edit an apply makes, whether or not the annotation mentions
it. **An edit that satisfies Matt's note and breaks one of those rules is not done.**

## When the doc comes back as a Google-native document

If Matt converts the `.docx` to a Google Doc, what lands in the synced folder is a
`.gdoc` — a pointer holding a document id, with the words on Drive. The commands say so
and print the id. Read it with the Drive tools, or ask Matt to use **File → Download →
Microsoft Word (.docx)** back into the same folder.

## Where every page stands

The one place this is written down; refresh it from `article/prose.jsonl`,
`article/figures.jsonl`, `review --list`, and `figures --all` rather than trusting a cell.
Every reader-facing page is here or excluded by name below.

**Last review round** names its source (Matt): a **review doc**, which must agree with
`review --list`, or **Matt's notes**, marks arriving in a prompt with no artifact.

| page | master | last review round | figures placed | what to know |
| --- | --- | --- | --- | --- |
| `start-here.html` | `Start here v2.md` | none | 6 | no `sections.jsonl` row; drawn by `builder start` |
| `overview.html` | `Overview v2.md` | none | 2 | `overview-pipeline`'s drawn-in text lags the prose (a redraw) |
| `escape-time-fractals.html` | `Escape-time fractals v1.md` | none | 7 | `escape-families` letters the dropped "(c, p) plane" framing (a redraw) |
| `rendering-fundamentals.html` | `Rendering fundamentals v1.md` | none | 6 | |
| `rendering-modes.html` | `Rendering modes v5.md` | 2026-09-08, Matt's notes | 13 | quality table, below |
| `finding-good-locations.html` | `Finding good locations v8.md` | 2026-08-21, review doc | 9 | `#seeds-from-labels` is a kept legacy anchor |
| `training-judges.html` | `Training judges v7.md` | 2026-08-21, review doc | 3 | pool gate omits `curation/headroom.py`'s P(≥3) fallback on purpose (Matt) |
| `color-palettes.html` | `Color palettes v7.md` | 2026-09-02, Matt's notes | 7 | |
| `finding-good-wallpapers.html` | `Finding good wallpapers v3.md` | none | 3 | ids keep the old `wallpapers-` prefix |
| `gallery-curation.html` | `Gallery curation v2.md` | 2026-09-25, review doc | 3 | `gallery-output` stays on its first pass (Matt), via `article/figure-recipes.jsonl` |
| `full-pipeline.html` | `Full pipeline v6.md` | none | 4 | figures read `builder/pool_study.py` |
| `fractal-atlases.html` | `Fractal atlases v2.md` | none | 1 live | `atlas-live` has no caption; a round reviews prose and `alt` |
| `deep-zoom.html` | `Deep zoom v5.md` | Matt's second round, in the master | 10 | |
| `other-artistic-techniques.html` | `Other artistic techniques v1.md` | none | 1 | |
| `fractal-math.html` | `Fractal math v2.md` | none | 1 | |
| `palettes/make-your-own.html` | `Make your own palettes v4.md` | 2026-09-02, Matt's notes | 1 | |
| `deep-zoom/videos.html` | `Deep zoom videos v1.md` | none | 4 | `[VIDEO name]` is a figure marker |
| `tools-and-data/index.html` | `Tools and data v1.md` | none | 4 | data files by `builder tools-and-data` |
| `palettes/all-palettes.html` | generated | n/a | none | words in `palettes.LIBRARY_LEAD`, `pages.library_page` |
| `index.html` | its own | none | 1 | contents list needs every `sections.jsonl` row |
| `wallpaper-packs/index.html` | `Wallpaper packs v1.md` | n/a | 1 | generated; prose in `builder/packs.py`'s `PROSE` |

The fourteen section slugs and their order are ratified (Matt). Each page's *Section N of
14* kicker is typed into the page, not derived, so a fifteenth section is fourteen hand
edits. `from-locations-to-wallpapers.html` is dead with no stub, the one permanent URL the
site has spent.

**Excluded:** the explorer and its Atlas tab are tool pages, with no master and no review
round (a ruling); `run-it-yourself/index.html` is written by `builder/run_it_yourself.py`.

**Em-dashes**: text drawn into a figure is outside the rule (Matt). No check holds the
rule; the prose passes are done (Matt).

**The Rendering modes quality table** is the shipped render judge's reading of the
candidate ledger's score sidecar: a judge adoption invalidates it at once, and as prose
it has no `stale_when` to say so.

**One rendering mode is retired from the site** (weight 0 in `mode_policy` next door) and
named nowhere a reader meets; two figures, `overview-pipeline` and `gallery-output`, are
still drawn in it, and read as smooth through `builder/picks.py`'s `MODE_WORDS` (Matt).

## Rulings a page is held to

`writing-guidance.md` is the editorial authority and `CLAUDE.md` holds this repository's
conventions. These are the rulings about **what the article says** that neither carries.

- **The site names and shows only the modes a gallery will ship** — `mode_policy.accepted()`
  next door. A niche mode is never named and never drawn, with one carve-out: a trap shape
  may be named as a texture, where the shape rather than the mode is the subject.
- **No page states a count of modes.** The roster is whatever the scoreboard lists.
- **A cut's two sides are `keeper` and `junk`**, wherever a page names them.
- **`partition` is defined once, on Training judges**, and later pages use it without
  defining it again.
- **Numbers go in at their current values, and nothing schedules a refresh** until
  publishing is near.
- **The eligibility bar is a flat one half, and the prose calls it a round number**, whose
  exact placement stops mattering once the collection is built from pictures well clear
  of it.
- **No bar is described as a measured crossover.** None has a measured crossing behind it.

## The prose registry

`article/prose.jsonl` says which master belongs to which page:

```json
{"schema": 1, "kind": "prose", "page": "finding-good-locations.html",
 "file": "Finding good locations v8.md",
 "divergences": [{"master": "...", "page": "...", "why": "..."}]}
```

A page with no row is its own master, and its review doc is built from the page alone.
The masters live at the **root** of `prose\` in the synced folder; a superseded master is
trashed in Drive, so a row naming one not at the root is stale — report it.

A **divergence** is a place where the page deliberately says something the master does
not, recording the master's words, the page's words, and why. Nothing else may differ.
No row carries one now.

`builder check` holds the registry to naming written pages but never reads the masters
(CI has no drive); `builder prose` does.

## Leftovers

Known and not scheduled, one line each. Each is Matt's to raise; a prompt that fixes one
strikes its line.

- **The phone layout clips the viewer above the tabs.**
- **Reverse barely moves ten authored maps**, which run out and nearly back again.
- **`direct_trap_screen`'s sliders have dead travel**: the engine caps the screened cross's
  opacity and threshold below the slider ranges (`explorer/params.js`'s header).
- **A hue-family collection's label promises one hue**; the family pass splices a theme, and
  the chip a seat lands under is the color reading's own.
- **The seven mode collections show their raw names** in the Collection dropdown
  (`smooth_mean_angle · 300`); readable names are a separate decision.
- **The download bar parks during the shade**: `download.js` reserves up to half the bar for
  the coloring and nothing advances it until the picture lands.
- **The walk's candidates row scrolls each new tile into view**, so the kept tile can end
  up off to the left.
- **Only the explorer's downloads carry an embedded link**; deploy preparation decides the
  rest (a stamp here would go in `images.land`; the full-size wallpapers are
  `fractal-wallpapers`' encoder), and how each tracked asset reaches Pages.
