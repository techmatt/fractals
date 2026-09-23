# Reviewing a page

Matt reviews the article by marking up a copy of a page in Google Docs, and a Claude Code
session applies his marks back to the site. The loop is two commands he types in a
session, and everything below is what those two commands mean.

> **"create the review doc for `<page>`"** → build the doc and say where it landed.
>
> **"apply the review doc for `<page>`"** → read the marked-up doc back and apply all of it.

A page is named either way — `overview` or `overview.html`.

## Where the docs live

```
C:\Code\fractal-drive-sync\review\
    <page>.docx                     waiting: built, and possibly marked up
    applied\<page>-<date>.docx      consumed: already applied, never applied again
```

The folder is Drive-synced, so a `.docx` there opens in Google Docs, is marked up there,
and syncs back to the same file. The path is not committed anywhere: it comes from
`drive_sync_root` in the untracked `local.toml`, or from `FRACTAL_DRIVE_SYNC_ROOT`.

`python -m builder review --list` says what is waiting and what has been applied.

## Create

```
python -m builder review <page>
```

The command holds the page to its approved prose master **first**, and refuses to write a
doc if they have drifted apart. That refusal is the point: a review doc built from a
drifted page reviews words that are not the approved words, and every later round
inherits the confusion.

**On drift, stop and report it.** Do not build the doc, and do not reconcile the two
texts by copying one over the other — find out which side is wrong. The master is what
Matt approved; the page is what the world reads; a difference between them is a bug in
whichever one moved without the other.

What the doc contains, in order:

- the page's title, and a line naming the page, the master, and the build date;
- the annotation convention, spelled out;
- the prose **as served** — headings, paragraphs, bullets, code lines, table rows as
  `| cell | cell |`, and a `[figure: slug]` marker standing where each picture sits;
- every figure caption on the page, one line per slug, read off the figure registry.
  A figure still pending also shows the text its well displays in the meantime.

Nothing else: no HTML, no editorial header, no rail, no scaffolding.

Links, italics and code spans are flattened. They are still on the page, and they survive
an edit that does not delete the words carrying them.

If a doc is already waiting, the command refuses rather than overwriting it — it may
carry marks nobody has applied yet. `--force` overwrites, and is for the case where Matt
says the waiting doc is stale.

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

`--read` rebuilds the doc from today's page, diffs the marked-up copy against it, and
prints only what differs — each changed paragraph with `[-dropped-]` and `{+added+}`
marked inline — followed by every `[M: ...]` in order. That list is the work.

Because the comparison is against the page *as it is now*, re-running `--read` after
landing some of the edits shows only what is left. The list is a work queue, not a
snapshot — and an empty one at the end is the loop's own confirmation that every edit
reached the page.

### Placed prose has more than one edit site

An apply touches **all** of them, or the next `prose` check fails and the next review
round starts from a page that no longer matches its master.

| What changed | Where it lands |
| --- | --- |
| A sentence of prose | `article/<page>.html`, **and** the placement script's literal under `scratch/` if one exists for that page, **and** the prose master in `prose\` |
| A figure caption | the figure's row in `article/figures.jsonl` — never the page. `python -m builder check` re-derives the block and will say so if the page was edited instead |
| A page's opening | the page's lead paragraph. There is no standfirst to edit — the ruling in `writing-guidance.md` cut the device site-wide — so an edit about how a page opens lands on the lead. The front page's blurb for that section is separate prose that often says the same thing; read it, and change it if the edit applies there too |
| A heading | the page. `python -m builder build` regenerates its id and every rail that lists it |

The placement scripts live in ignored `scratch/`, so one may simply not be there on this
machine. That is not a blocker — say so in the report, and edit the page and the master.

### A new claim is verified, never composed

An annotation that introduces a **new factual or technical claim** — a number, a
mechanism, a name, a rate — is checked against the source it comes from before it lands:
the code and the records in `C:\Code\fractal-wallpapers` (read-only from here), the run
ledgers, the audit reports in `C:\Code\fractal-drive-sync\reports\`. Plausibility is not
verification. **A claim that cannot be verified is flagged in the report and left out of
the page** — never guessed at, never softened into something vague enough to be safe.

### Finishing

```
python -m builder prose <page>                     # page and master agree again
python -m builder build                            # if a heading moved
python -m ruff check . && python -m ruff format --check . && python -m builder check
python -m builder review <page> --consume          # into review\applied\
```

Both checks green, then the doc is consumed — a doc left in `review\` is a doc that can
be applied a second time onto a page that already has it.

Then the report, per the standing prompt contract in `CLAUDE.md`: what changed, an answer
to every `[M: ...]` question, and anything flagged rather than applied. Commit the work.

### Every round ends by distilling its guidance

The last step of an apply, before the report is written, is to read that round's `[M: ...]`
notes again and ask of each one: **is this a rule, or is it this sentence?**

A rule goes into `writing-guidance.md` — attributed to Matt and dated, phrased so it
governs a page nobody has written yet, and consolidated with anything already there that
says the same thing. A note about this sentence goes into the page and the report and
nowhere else.

This is what stops the loop from re-litigating the same ruling every round. A principle
Matt states once is a principle every later session already knows, and a round that
applies its edits without distilling them has thrown that away. Nothing is deleted or
weakened there without Matt's explicit word; adding and consolidating need nobody's
permission.

## The editorial rules

They are **not in this repository**. The single editorial authority for the website is

```
C:\Code\fractal-drive-sync\prose\writing-guidance.md
```

read through `drive_sync_root` in the untracked `local.toml`, the same way the review
docs and the prose masters are. It is a curated living document — audience, register,
structure, links, claims, figures, blurbs, contrast, and which locations a figure may
use — and it governs every edit an apply session makes, whether or not the annotation
mentions it. **An edit that satisfies Matt's note and breaks one of those rules is not
done.**

It lives on the synced drive rather than here because both halves of this project write
to it: the claude.ai design sessions that draft a page, the Claude Code sessions that
apply a review round, and Matt at any time. A copy in the repo would be a second answer
to what the house style is, free to drift from the one the drafting sessions read.

Read it before applying anything.

## When the doc comes back as a Google-native document

If Matt converts the `.docx` to a Google Doc, what lands in the synced folder is a
`.gdoc` — a pointer holding a document id, with the words on Drive. The commands say so
and print the id. Read it with the Drive tools, or ask Matt to use **File → Download →
Microsoft Word (.docx)** back into the same folder.

## Where every page stands

The one place this is written down. The handoff documents point here rather than carrying
a copy, because a status copied into prose is a status that goes stale without anybody
noticing. Everything in the table is read off `article/sections.jsonl`,
`article/prose.jsonl`, `article/figures.jsonl` and the review folder — regenerate it with
`python -m builder review --list` and `python -m builder figures --all` rather than
editing a cell by hand. The one column with a half nothing derives is **last review
round**, defined under the table: a round that arrived as Matt's notes has no artifact
for `--list` to report, so that cell is written by the round that applied it.

**Every page of the site is here or excluded by name.** The last two rows are the two
reader-facing pages no registry reaches — the front page and the gallery index — and they
are in the table for the reason `dashes` gave them a row in the register below: a page
nothing reaches is a page nothing reviews, and both were outside every register by
accident rather than by ruling. The explorer is excluded by ruling, at the foot of this
section, and the atlas went into it when the atlas stopped being a page. Nothing else on
the site is a page.

**The whole-site prose refresh is complete, 2026-09-02.** Eight sections are placed and
mastered — Overview v2, Rendering modes v1, Finding good wallpapers v2, Gallery curation
v1, Training judges v5, Finding good locations v5, Color palettes v5, Full pipeline v3 —
with every current master at the root of `prose\` and everything they superseded moved to
`prose\old\`. `Running at scale` is dead: Matt trashed both its masters and no page
answers to it. Rendering fundamentals still holds its own HTML as its master; **Escape-time fractals
got its first master on 2026-09-06** and no longer does. Fractal atlases and Deep zoom are stubs, and the gallery page waits for Matt.
His first pass over the site was applied on 2026-09-01, and he is reviewing every figure
himself now — which is why two rows of the figure registry carry a repetition marked *not
yet judged* rather than a decision.

**One rendering mode was retired from the site on 2026-09-04**, by a ruling in the
wallpaper project's `mode_policy` that took it to weight 0. Its Rendering modes
paragraph, its figure and asset, its scoreboard row, its `explorer/modes.jsonl` entry
and its line in `permalink.js`'s typed `MODES` are all gone, and the picker's frozen
roster went 18 → 17. This is the one line on the site that records the removal; the
mode is named nowhere, which is the ruling. **Four figures on three other pages still
carry it** and are the reason the name is not yet in `builder/vocabulary.py`'s banned
list: `gallery-floors` and `wallpapers-mine` draw its name into the picture, and
`overview-pipeline` and `gallery-output` each stand on panels rendered in it. All four
are records of passes made while the mode was live, so clearing them is re-picking
panels — Matt's call — and, for `gallery-floors`, a curation pass solved under the
current roster, which no record next door yet holds. **`overview-pipeline` now has a
tracked maker and still refuses** *(2026-09-06)*: `python -m builder overview
overview-pipeline` composes the sheet byte for byte identical and then stops at
`builder.picks.frame_line`, which will not spell the retired mode pick `8b27fa88` is
drawn in. The guard is about the record line rather than the picture, and it is the
re-pick above that clears it — not a wording added back to `MODE_WORDS`.

**The Rendering modes table is the site's one machine-scored number, 2026-09-04.** Every
other figure the article quotes counts something a person decided; the quality
distribution on `rendering-modes.html` is the shipped render judge's own reading of
102,562 candidates out of `curation/candidate_ledger`'s score sidecar, at the live
artifact `481fe058`, conditioned on the location's own smooth candidate clearing that
head's measured `SMOOTH_RELEASE_FLOOR`. Matt chose that population over his labelled
renders for the n. **Two properties of it are why this note exists.** The judge's raw
probabilities read high — its labels-derived crossover for *the human said three or
better* sits at 0.780 rather than at a half — so the shares are the judge's opinion and
not a calibrated estimate of Matt's, which is what the paragraph above the table says in
one clause. And every score in that sidecar is keyed to one judge artifact, so a **judge
adoption invalidates the whole table** at once and leaves it a reading nothing emits any
more. It carries no `stale_when` because it is prose rather than a figure row, which is
why that is written here.

**And its `wallpaper render` column is a placeholder, 2026-09-04.** `candidate render` is
real: the **mean** `hunt.seconds` the mining legs stamped on the very rows the table
counts — 95,449 of the 102,562 carry one, the rest predating the stamp — read off the
record rather than measured here. `wallpaper render` is that mean times **64**, which is
the ratio of the two geometries' sample counts (2560×1440 at 4× against 640×360 at 2×),
because Matt called the measuring leg off mid-round and asked for a proxy until it is
taken. The footnote under the table says so in the page's own words. **Replacing it is a
measurement, not a recomputation**: `scratch/_modes_render_times.py` renders a sample of
seats a mode out of a recorded tentative gallery at `run.RELEASE_RESOLUTION`, and the
four smooth seats it got through before it was stopped came back at a mean of 43.4s
against the column's 43.5 — encouraging at n=4 and no more than that, because the scaling
holds only while a mode's cost is linear in samples. Both columns are seconds on **one
desktop CPU**, which is all the footnote claims and all either number can support: a
faster machine, a rebuilt engine or a different worker count moves every cell.

| page | written | prose master | last review round | figures | what is held, and why |
| --- | --- | --- | --- | --- | --- |
| `overview.html` | yes | `Overview v2.md` | none | 2 placed | **v2 placed 2026-09-06** (PLACE_overview_v2_0906), out of a second reviewer pass whose eighteen corrections were adjudicated into the master before it arrived. The logistics paragraph — repository, browser renderer, galleries — moves to the foot, with one sentence about explorer permalinks kept early because the first figure sits above the first paragraph; the three rhetorical questions become three named decisions; *location* is redefined as family, constants and frame, which is what [finding good locations] already teaches; the curation summary drops *quality first and then under constraints* and *every rendering mode represented*; and the cumulative-state claim is narrowed, because candidate renders are pruned and only each location's strongest survive. The body carried eighteen em-dashes and now carries none. **Both captions were rewritten with it**, in the registry, and are em-dash free. Three of the reviewer's corrections were deliberately not taken as written: its own unspaced em-dashes, its reasoning that mode floors precede quality optimization in the solve (they do not — a floor is a soft `Demand` in tier 2 of `curation.solve`'s lexicographic objective, and nothing is ever seated by relaxing a rule it failed), and *strange* as vocabulary. **The pipeline figure's drawn-in text now runs behind its caption**: the sheet still letters *quality first, then range* and *color balance · every mode*, which is the reading the new prose corrects, and clearing it is a redraw rather than an edit. **`overview-gallery-hook` was redrawn in the same round** *(Matt, 2026-09-06)*: its tile labels carried the family and then the rendering, and the mode line is gone — `builder/picks.py`'s `HOOK_LABEL_LINES` is 1 and the sheet is 1314×576 where it was 1314×628. The caption already says which row is smooth and which is not. The one line left now carries **the family and the iteration it runs**, the way `escape-families` carries one under each of its plane tiles: `family_with_formula` and the `FAMILY_FORMULA` table beside it, with the step subscripts dropped and Phoenix keeping the one subscript that is the whole of what its formula says. A Julia is spelled with its plane's own iteration, since what differs is which of `z` and `c` the pixel moves. No pick changed and no panel was re-rendered from a different recipe. **Four follow-up edits landed 2026-09-06** in the same round as the Escape-time fractals placement (PLACE_escape_time_fractals_v1_0906): the repository is now linked at its first mention in the opening paragraph as well as in the closing logistics paragraph, which is intended; *escape-time fractals* gains "the most popular of which is the famous [Mandelbrot set]"; and the `overview-pipeline` caption drops its closing sentence tracing the first location down through the bands, which the figure still draws and the caption no longer narrates |
| `escape-time-fractals.html` | yes | `Escape-time fractals v1.md` | none | 7 placed | **v1 placed 2026-09-06** (PLACE_escape_time_fractals_v1_0906), and this page's **first** master — its HTML had been its own until now. Out of a reviewer pass of nineteen corrections plus two questions, adjudicated into the master before it arrived. The taxonomy in the lead is corrected (Mandelbrot is the degree-2 multibrot, and Julia is the same recurrence read on the dynamical plane, so they are not four independent recurrences); the polar form replaces the false contrast with real-valued sequences; the iteration cap is named where the definition becomes an algorithm; the *filled Julia set* is distinguished from the Julia set, which the connectedness theorem needs two paragraphs later; the universal boundary claims are hedged; the branch seam stops being called an artifact, because the branch is part of the definition of the single-valued rule; the (c, p) "plane" framing is dropped; the family paragraph stops claiming the released gallery is family-balanced; and *location* is redefined to match [finding good locations]. Two places correct the reviewer instead: fractional degrees do not only interpolate between integer shapes, since the renderer's floor is degree 1.8 and reaches below the quadratic degree; and the multibrot symmetry paragraph gains the dynamical-plane half, which is d-fold rather than one fold fewer and holds for a different reason. The body carried **22** em-dashes and now carries none — the master's own editorial header said seventeen, which is its miscount. **All seven captions were rewritten with it**, in the registry, and are em-dash free; four of the seven alt strings were rewritten too, three for em-dashes and `escape-phoenix` for the (c, p) framing. *location* is placed **plain** rather than italic as the master marks it, because Overview reaches the term first and the italic rule counts once for the whole article in reading order. **`escape-families`'s drawn-in text still runs behind its caption**: the sheet letters *elsewhere in the (c, p) plane* under two Phoenix tiles, which is the framing this round took out of the prose and the captions. That is past CSS's reach, so clearing it is a redraw rather than an edit. `escape-phoenix` needed nothing: its own labels already spell c, p and z₋₁ out. **Two edits landed 2026-09-06** with the Rendering modes v4 placement (PLACE_rendering_modes_v4_0906), applied to the page and to v1 in place rather than as a v2: the lead paragraph drops *, and a render-only extension to fractional degrees* and ends at the Phoenix recurrence *(Matt's call: not important enough for the opening paragraph, and the page still has its own Fractional degrees section)*; and **`escape-julia-map`'s drawn-in caption line was redrawn** so it spells *color* rather than *colour* — the site is American spelling in everything a reader sees, and text drawn into a sheet is the one surface a text sweep never reaches. The sheet's own maker is gone from ignored `scratch/`, so the strip's parameters were recovered by fitting `builder.sheets` and `builder.theme` against the committed picture — centred over the full sheet width at y = 758 in `font(20)` and `WELL_INK` on `WELL`, reproducing the committed band to a mean absolute difference of 1.19 of 255 — and only that band was refilled and redrawn; every panel is the picture that was already there. The redraw is recorded on the figure's own `provenance`. **That patch was superseded later the same day**, when the sheet's own maker was recovered into `builder.families:julia_map` and redrew the line from source; the row's `recipe` and its `provenance` both name the tracked maker now. A sweep of every other drawn-in string found no second instance: `builder/`'s drawn literals are all American, and the twelve other sheets composed under ignored `scratch/` were read one by one. **`escape-fractional-degrees` was redrawn the same day** *(Matt)*: each tile carried two label lines and now carries one, and that line is the family's own iteration typeset the way `escape-families` typesets its own — *z²·¹ + c* rather than *d = 2.1* — so the second lines (*the classic body and its second lobe, still on the axis* and its four siblings) are gone. The seam close-up keeps *, ×8 into the cut*, being the same degree as the tile above it. One line of label is a narrower band than two, so the sheet is 1344×588 where it was 1344×640; no panel changed. **Its maker is now `builder.families:fractional_degrees` and tracked** — the `scratch/figures/make_fractional.py` the row used to name was one of fourteen makers under the ignored tree, thirteen of which are lost, and it is rebuilt from the row's own six render lines and held to the committed picture by a fresh render of the d = 2.1 panel reproducing the committed tile at 1.09 of 255 |
| `rendering-fundamentals.html` | yes | `Rendering fundamentals v1.md` | none | 6 placed | **v1 placed 2026-09-06** (PLACE_rendering_fundamentals_v1_0906), and this page's **first** master — its HTML had been its own until now. Out of a reviewer pass of seventeen corrections plus a cross-section note and two questions, adjudicated into the master before it arrived. Four of the findings were real errors rather than looseness, and all four are corrected: the printed smooth-count formula is now the one `iterate.rs` computes, with the bailout named as 2<sup>16</sup> and the mathematical minimum corrected from 2 to 2 raised to the power 1/(d − 1); reaching the cap no longer *declares* an orbit interior, because it decides nothing about the orbit; supersampling is no longer per-pixel averaging but the Lanczos-3 reduction `resample.rs` actually runs, in linear light, at a radius of three *output* pixels; and the dynamic-range paragraph no longer spreads the palette to the iteration cap, which is not what the figure under it compares. Two places correct the reviewer instead: the log-log clock intuition is kept and only its equation changes, and the *mathematical minimum of 2* line is corrected rather than deleted. **Terminology: the field operator is the *percentile stretch* throughout**, matching the engine's own `Stretch`, and *autolevel* is left to mean only the finished-image adjustment that Color palettes covers — Rendering modes' three uses of the old sense were corrected in the same round. The body carried **25** em-dashes and now carries none, and the two the captions carried are gone as well. **All six captions were rewritten with it**, in the registry, and one alt string. **`render-autolevel` is renamed `render-percentile-stretch`** — registry row, link row, page block and the asset file, since a filename is vocabulary a reader meets; the pictures are unchanged and the `recipe` still names the `autolevel` function under ignored `scratch/` that drew them, which is what was actually run. Two caption claims are dropped rather than reworded and should not come back: `render-supersample` no longer says nothing later in the pipeline can put back what the sampling missed, which framed supersampling as detail recovery rather than as reconstruction, and `render-maxiter` no longer *declares* orbits interior. The master's eight-item verification list was worked against the engine source and **nothing in it needed correcting**: `maxiter.rs` still reads `BASE` 4000, `PER_OCTAVE` 0.30, `FLOOR` 200, `CEILING` 67,000 and `HOME_WIDTH` 3.0; `iterate.rs` still has `BAILOUT` 2<sup>16</sup> and pins the floor of the smooth count to the integer count in a test of its own; `resample.rs` still filters Lanczos-3 in linear light at a radius of three output pixels with one encode at the end; `coloring.rs`'s `CLIP_LOW` and `CLIP_HIGH` are still 0.5 and 99.5 over finite samples only, and a crop still stretches against its own; and `curation.run_layout.RELEASE_SUPERSAMPLE` is still 4. The `#multibrot-sets` link is gone from this page — the smooth-count paragraph names the degree instead — and the anchor stays where it is, because Escape-time fractals' own rail links to it. **Two sentences deleted 2026-09-06** *(Matt)*, page and master together: the iteration-cap paragraph no longer ends *The shape was right the first time; the base was eight times too low*, and the `render-percentile-stretch` caption no longer ends *, and the picture was there the whole time* |
| `rendering-modes.html` | yes | `Rendering modes v4.md` | applied 2026-09-08, Matt's notes | 13 placed | **Three `modes-gallery` panels are Matt's own, 2026-09-08** (WEB_ckpt117_prose_cuts_and_mode_picks_0908): stripe `970048b8` → `9dac1cc7`, curvature `01a60369` → `0cb93bec`, closest trap angle over smooth `e35ccc96` → `bbec529a`, each named by the alias under its tile and each seated on a later stamp than the seeded draw's, so the row now names three stamps rather than one. The mode roster and its order are unchanged, the autolevel operator acted on none of the three, and the figure's explorer link is derived from panel 1, which did not move. `MODES_DRAW` was rewritten with them: it claimed nothing on the sheet was chosen for how it looks and that a hand-picked panel per mode would be a claim about the picker, and that is now true of three of the thirteen and says so on the row. **Matt round applied 2026-09-08** (EDIT_ckpt115_rendering_modes_matt_round_0908), in place on v4 rather than as a v5. **`modes-gallery` moved from summary to motivation**: it stood at the foot of *The modes the pipeline draws*, after the table note, where it read as a recap of thirteen modes the reader had just been walked through; it now sits directly under the opening pair, before *Fields from the orbit's path*, and is what the page is arguing toward rather than what it closes on. Nothing in `figures.jsonl` and no check carries a figure ordering for a page, so the block and its `[FIGURE:]` marker in the master were the whole move. **The standings paragraph came out at Matt's instruction** — *Not every recipe I tried earns a place in the pipeline*, and with it the only place on the site that taught a mode's standing, the machinery-wider-than-catalog-wider-than-roster ladder, and that a zero-standing mode stays renderable by name. That fact now lives in `curation/mode_policy.py` next door and nowhere a reader can reach; it was not replaced, and a later round that wants it back is writing it new. Its replacement says the roster is a set of favorites picked out of a wide try, and points at the figure above. The two-panel sentence **moved up into it** from under *Fields from the orbit's path*, and *Every figure* became *Most figures* deliberately, because the gallery figure the sentence now stands beside is not a two-panel figure. *What this page describes is one project's roster* is deleted from *Beyond this catalog*, which now opens on its own subject. **Units moved into all twenty-six render-time cells** — under 60 seconds one decimal and `s`, 60 seconds and over minutes-and-seconds rounded to the nearest second with the seconds zero-padded (`460.5` → `7m41s`, `126.1` → `2m06s`) — formatting only, **no value changed**, and the rewritten table note no longer carries the unit. Also verified, with no edit needed: both sentences Matt asked deleted from `rendering-fundamentals.html` on 2026-09-06 — *The shape was right the first time; the base was eight times too low*, and the `render-percentile-stretch` caption's closing *, and the picture was there the whole time* — are absent from that page, from its registry row and from `Rendering fundamentals v1.md`. **v4 placed 2026-09-06** (PLACE_rendering_modes_v4_0906), a wholesale replacement of v3, which is trashed in Drive. Out of a reviewer pass of thirty corrections plus three questions, **whose central structural claim is rejected and must not come back**: the reviewer read the engine's `Tier::Production` as the pipeline's roster and concluded the page was stale by six modes. It is not. `curation/mode_policy.py` puts `trap_circle`, `gaussian_int`, `smooth_trap_circle`, `direct_trap_ring`, `tail_itinerary` and `exp_smoothing` at weight zero — out of the draws and out of the gallery — and the thirteen this page describes are exactly the ones above zero, so every count on it was already right: five composites, four screened, three direct traps, one itinerary mode, thirteen table rows. Ten of the thirty corrections and the counts inside two more are dropped on that basis. What is taken, all checked against the engine source: `smooth_mean_angle` is the **lopsidedness** of the orbit's nearest, mean and farthest Gaussian-integer distances read as an angle — `field.rs`'s `Reduction::MeanAngle` is the angle of `(mean − nearest) + i(farthest − mean)` — and not the averaged approach direction the page and its caption both claimed; the orbit-trap paragraph no longer says every trap is centered on the origin and then contradicts itself three sentences later; `threads` no longer claims the loop has no early exit, which it has, and its kernel is named as the narrow bell `exp(−D²/σ²)`, σ = 0.15, additive at half strength; the debanding by the smooth count's fractional part is stated under stripe, which `field.rs` applies to `stripe`, `tia`, `curvature` and `threads` alike; curvature's motion categories are dropped; `de` is named as a mode the renderer will draw on request; normal-map lighting is named as a **deliberate** omission, in `mode.rs`'s own terms; and the histogram bullet carries the percentile-stretch name. **The thirteen-row quality and cost table and its placeholder footnote are carried through untouched and deliberately** — numbers on this site are checked and refreshed together when Matt says it is ready for publishing. The body carried **31** em-dashes and now carries none; **nine of the thirteen captions were rewritten**, eight of them em-dash recasts and `modes-smooth-mean-angle` a corrected definition, and the four left alone (`modes-stripe`, `modes-smooth-stripe`, `modes-direct-trap-multiply`, `modes-gallery`) were already clean. All thirteen alt strings are untouched and clean. One word of a supplied caption was authored here: `modes-smooth-mean-angle` reads *rather than standing at the origin* where the prompt wrote the banned word `builder/vocabulary.py` spells `sittin[g]`, and is written that way here for the same reason that module writes it that way. **Watch `curation.mode_policy.UNMINED`** *(Matt, 2026-09-06)*: `curvature` is now accepted in every respect but the draw, so the page's *two in other modes, drawn without replacement from the rest of the roster* is a roster of twelve for a gallery and eleven for a mine. The roster of thirteen this page teaches is unchanged and the sentence was left as the master wrote it |
| `finding-good-locations.html` | yes | `Finding good locations v7.md` | applied 2026-08-21, review doc | 10 placed | placed 2026-09-01 with the reframing channel; **pass 2 on 2026-09-04 closed the figure divergence** — `locations-walk-root` is deleted (block, asset, registry row, link row and master marker) and `locations-minibrot-examples` replaces it, so the master's twelve `[FIGURE]` markers and the page's twelve blocks now agree one for one and in order. The same pass swept the no-identifiers rule over every figure on the page, keeping frame widths, which are the subject on the framing ladder and the descent chain. **`locations-walk-step` retired 2026-09-05 and `locations-walk-descent` took its slot** — the animated one-expansion diagram is gone entirely (block, asset, registry row, link row, master marker, and its maker in `builder/locations.py`), and the new figure is five rows of one descent: the whole set beside four seed starts, three rungs of four proposals apiece with the location judge's estimate printed under each, then the location it kept beside four wallpapers of it. **It is Matt's to review**, and two things on it are decisions rather than readings — the descent is composed rather than replayed, because a real walk seeded on the home view dies at depth 3 with every proposal refused on interior or occupancy; and the first row's four estimates are all 0.00, which is the plane-root waiver the page's own Score paragraph describes. **A figure pass on 2026-09-05 took the page from twelve blocks to eleven**: `locations-walk-examples` and `locations-found-and-finished` are deleted outright, `locations-highly-rated` takes the second one's slot — a plain 4×4 grid of sixteen class-4 locations, no labels and no numbers on it — and `locations-reframe-examples` keeps its structure with its bottom strip re-picked onto node 5810, where every operator's best proposal clears 0.82 against the 0.00 the neighborhood operator scored at node 5700. **v6 placed 2026-09-05** (PLACE_locations_v6_0905): Matt's em-dash pass over the body — the page carried 39 in its prose and now carries none, every one recast as a parenthesis, a colon or a sentence break — plus the *Examining walk quality* opener losing its third clause, and the framing-ladder passage condensed to the direction the ladder aims. **`locations-framing-ladder` is deleted** (block, asset, registry row, link row, and its maker and `LADDER_NODE` in `builder/locations.py`; `FRAMINGS` stays, the descent chain reads it), which is what took the page from eleven blocks to ten. One sentence went with the pass that the master's own changelog does not name: *A snap is a correction, not a teleport* is off the `snap_to_nucleus` paragraph, placed as the master reads. Two captions moved: `locations-walk-descent` lost the clause excusing its top row's zeroes. **The caption half was swept on 2026-09-05**: the four em-dashes the ten remaining captions carried are recast, and `locations-reframe-examples` is rewritten outright — it told a reader two of three answers score lower than the frame that triggered them, which is true of its top three rows and the opposite of what the re-picked strip below them shows. **v7 placed 2026-09-06** (PLACE_finding_good_locations_v7_0906), out of a 2026-09-06 critic pass adjudicated into the master before it arrived. Ratings are first person throughout; the lead's stale pointer moves to [finding good wallpapers], which is where mode and palette are actually chosen; the root-supply paragraph is rewritten outright, the old fixed-file-per-family model having been the largest stale passage on the page; the Render cheaply stage is corrected to the node regime, one render serving the gates and the judge alike; the two score cuts are stated as named bars with **no numeric heights**, under the rule that a constant a retrain invalidates may not be printed; plane grace becomes a configurable number of rungs; the pinned-plane expansion budget is added; in-walk operator frames are corrected to frontier nodes that are never themselves scored; `snap_to_nucleus`'s guard is corrected from *a nucleus inside the frame* to a bounded distance measured against the frame's own width; the twin channel is narrowed to the higher-degree Julia families; the no-knee claim becomes a measurement; the standalone reframe channel is rewritten as generational; and the seeded-versus-fresh result is scoped to its run and given its numbers. **The master's sixteen-line verification list was worked against `fractal-wallpapers` at d256339 and one line needed correcting**: line 3, the nucleus solver, which converges at `discovery.nucleus.NUCLEUS_DPS` = 60 decimal digits and not at the search's own double precision. Everything else held. **The heading *Seeds from labels* is now *Reusing previous finds***; its `<h2>` carries `#reusing-previous-finds`, because this site derives a heading's id from its own words and nothing may pin one, and `#seeds-from-labels` survives as a legacy anchor immediately above it so no existing fragment breaks. **Two captions were edited with the round**, in the registry: `locations-rating-examples`, which had been repeating its own preceding paragraph, and `locations-highly-rated`, whose *thousands of highly rated locations* was ambiguous between Matt's hand ratings and machine scores when most of the pool has never been rated by a person. **The caption round for this page was open and unstarted** until 2026-09-07 — those two are corrections, not the sweep. **`locations-highly-rated`'s caption was replaced again 2026-09-07** (PLACE_ckpt113_gallery_curation_autolevel_and_caption_0907): *The accumulated location pool holds thousands of admitted frames across the supported families, ready for mode and palette exploration* becomes *A sample of the admitted pool the mode and palette work draws from*, which is a third correction rather than the sweep. Neither the count nor the across-the-families claim is carried forward and **neither is replaced with a fresh count** — counts are not refreshed until Matt says ready for publishing. The alt string still named sixteen panels spread across the families and was deliberately left alone that day; it lost the claim with the caption round below. **Both body wording nits are closed 2026-09-06** (FIX_ckpt112), page and master together: *the scales below that floor* is now *below that minimum*, the last place on the page where *floor* survived in the width sense v5's bar/floor ruling respelled everywhere else; and *I rated all six at the top of the scale* is now *at the top of the wallpaper scale*, because the ratings that sentence names come from the finished-render stores and the section around it is otherwise about location quality. **The caption round was worked 2026-09-07** (FIX_ckpt113_website_caption_round_and_consistency_0907) over all ten rows: six captions changed, four read and kept. What came out of three of them is argument rather than description, each of which the prose already makes within a paragraph of its figure — `locations-random-samples`'s *That filter is the only thing standing between them and worse*, `locations-minibrot-examples`'s *which is what the search is after*, and `locations-reframe-examples`'s *which is where the payoff sits rather than in the operator's own view*, which also stopped calling its bottom strip's trigger *weak*, a reading the picture does not carry. `locations-rating-examples` stops accounting for what the rating was made from and says what the picture is instead: three examples a class, one neutral palette throughout. `locations-walk-lengths` was the weakest on the page, its whole caption being the run's setup, which the sheet already letters, and never saying what the bars measure. `locations-foci-proposals` reads *each child drawn on its own* where it read *at its own size*, the four tiles being one size on the sheet. Kept as written: `locations-style-spectrum`, `locations-descent-chain`, `locations-walk-descent` — its length is legend for marks drawn into the picture — and `locations-highly-rated`, replaced the day before. **Two drawn-in strings are past the round's reach**: `locations-walk-lengths` letters the run identifier `harvest_run2` in front of a reader, and letters the two arms the old caption repeated. Clearing either is a redraw, and a redraw re-reads the walk ledgers next door. **Closed 2026-09-08** (WEB_ckpt116_site_corrections_0908): the identifier was already gone from the maker — `2e80e93` renamed the third arm *All roots of harvest_run2* to *Another run entirely* and never redrew the PNG, so the committed picture had been a stale reading of tracked code for four days, which is a drift no check on this site can see. `python -m builder locations locations-walk-lengths --replace` landed it, and the re-read of `demo_neighborhood/walk.jsonl` and `harvest_run2/walk.jsonl` returned every number the row already carried — 132, 65 and 455 roots, the same three medians, the same three depth histograms — so the only registry change is the third `provenance` line taking the arm's new name. The run is still identified where a record identifies it: `sources` names both ledgers, and the row's last `provenance` line still says arm 3 is `harvest_run2/walk.jsonl` entire. **`locations-highly-rated`'s alt string lost *color map* 2026-09-07** (FIX_ckpt113_website_leftovers_0907): *all drawn in one neutral color map* is now *one neutral palette*. The banned reader-facing spelling is `colormap`, so this never tripped the vocabulary check, but the article's word for the thing is *palette*, and an alt string teaching a reader a second name for one idea is what that ban exists to prevent |
| `training-judges.html` | yes | `Training judges v6.md` | applied 2026-08-21, review doc | 3 placed | **v6 placed 2026-09-07** (PLACE_ckpt113_training_judges_v6_0907), a wholesale replacement of v5, which is trashed in Drive. Out of a technical reviewer pass of thirty corrections plus five questions, adjudicated into the master before it arrived. The lead no longer claims the two judges share one network design and one training recipe, which was false in both halves; the top class is no longer described as carrying no consequence, because both judges' P(≥4) is read downstream; the location judge is no longer described as seeing only one palette, which is false of training; the self-contradiction between *trained on all three sizes* and *only ever seen the thumbnail* is gone; the two backbones are described separately, with capacity settled by measurement in opposite directions for the two questions; the ordinal outputs are described as conditional and then multiplied; the render recipe's forty epochs becomes its early-stopped twenty-epoch ceiling; the restatement is distinguished from a recalibration; the ranking sentence is replaced by the **seating head**, which is new material, as is the held-out palette set; the unsupported *and correctly* comes out of the generalization claim; and the iterative-gathering paragraph is rewritten around selection. **Eight of the reviewer's items are rejected in the master's own header and should not come back**, the corpus-count regeneration and the printed cut heights among them. The body carried **25** em-dashes and now carries none. **All three captions were rewritten with it**, in the registry, and two of the three alt strings: `judges-rating-views` dropped *the neutral palette the judge is shown*, which is the claim this round exists to remove, and `judges-what-the-judge-sees` had *four times wider than the thumbnail* for a ratio that is 3.33. **`great cut` is retired site-wide in favour of `exceptional bar`** and `finding-good-locations.html` moved from *upper bar* / *lower bar* onto *admission bar* / *expansion bar* in the same round, page and master v7 together, which moves those two italic first mentions to that page and leaves this one's plain; *exceptional bar* is still first met here and keeps its italic. The one surviving `great cut` on the site is inside `locations-highly-rated`'s `provenance`, where it names `supply.currency.GREAT_CUT` beside that constant's value and is written there by `builder/locations.py`. **The master's eleven-line verification list was worked against `fractal-wallpapers` at 6787253 and three lines needed the prose corrected**: only ONE render bar acts, not both, because the gallery pass `floors.gallery_floor` was written for was deleted next door on 2026-08-28 (64c9612) and the solve that replaced it reads `solve.Q4_BAR`; the restatement moves 13.5% / 14.6% / 9.9% of the reference pool rather than *roughly a tenth* at each cut, so the prose now says between a tenth and a seventh; and the three cached regimes are two frame sizes at three samplings rather than three sizes, with 1280x720 the label geometry rather than one of them. **numbers refreshed at publishing** *(Matt, 2026-09-05)*, and this hold carries forward unchanged because v6 reproduces the sentence verbatim: *The corpus holds ratings for more than twelve thousand locations, about six thousand smooth renders, and about five thousand renders in the other modes.* The counts stand as written and no round re-reads them until publishing is near — no thrash on counts before then. **The cross-page sweep for v6's four corrections ran 2026-09-07** (FIX_ckpt113_website_caption_round_and_consistency_0907), over every article page, the front page and the section blurbs. **One hit, corrected**: the front page's blurb for this section said the page covers *the network design and training recipe*, singular, which is the claim v6 removed, and says *the network designs and training recipes* now. **One record corrected**: `judges-what-the-judge-sees`'s first `provenance` line called its three panels the geometries the location judge is trained over, which `models/tiles.BUILT_REGIMES` refuses — 640x360ss2, 640x360ss1 and 384x216ss1, two frame sizes at three samplings, with 1280x720 the label geometry rather than one of them — and the line now says so. **Two flagged for their own round**, both needing prose beyond a phrase: this page's own lead still says the two judges *are trained the same way*, which the *Network design and training* section contradicts twice, and the lead is v6's approved master rather than drift; and `gallery-curation.html` calls its eligibility bar *even odds or better of being rated good* one sentence before saying it is read at the judge's top threshold, which is the chance of an exceptional rather than of a good. Nothing else on the site repeats any of the four: no page outside this one says three rendering sizes, no page has both render bars acting or the smooth bar acting anywhere, no page treats the top class as consequence-free, and the only pages saying the location judge sees one palette say it of scoring, which is true. **Both flagged items are closed 2026-09-07** (FIX_ckpt113_website_leftovers_0907), page and master v6 together. The lead's *are trained the same way* is now *are trained by the same general method*, which is what the two judges actually share — the four-point ordered target and the transfer-learning recipe — where the backbone variant, the schedule and the augmentation all differ; this was an error in the approved master rather than drift at placement. And the seating-order sentence in *From a score to a decision* loses its middle clause, *leaves everything below it alone*. **Matt's ruling, 2026-09-07: the site describes the seating order as the fine-tier head and says nothing about the ordering used below the bar** — that the cascade falls back to another key is an implementation technicality, it is a retirement question the project has not settled, and a reader gains nothing from it. What is kept is that it orders what is above the bar and is deliberately kept out of the decision to delete a candidate, because a bad ordering at a seat costs a slot while a bad ordering at a deletion costs the picture, which is the design contrast worth teaching. **The page was swept for any other sentence implying the seating order is a composite of two things and carries none**: the only other uses of *ordering* are the ordinal-target paragraph, which is about the four-point scale, and *separating the good from the bad and ordering the very best are also different questions* in the generalization section, and none of the three captions or alt strings mentions ordering at all. **The sentence that stood here saying the page was unswept for em-dashes is struck, 2026-09-07**: v6 cleared all 25 of them and the table below has recorded the page at zero since it was placed, so the sentence was left behind by the v5 → v6 replacement rather than describing anything |
| `color-palettes.html` | yes | `Color palettes v6.md` | applied 2026-09-02, Matt's notes | 7 placed | **Two deletions at Matt's instruction, 2026-09-08** (WEB_ckpt117_prose_cuts_and_mode_picks_0908), page and master v6 together. The sentence qualifying the fifty-two-cell coverage claim is gone — *That says what the palettes can do, not what a render will be*, the four green carriers that hold across all three fields, and green's collapse on the strange one — so the paragraph now ends on the claim itself and the figure. And the whole back half of the palette-judge paragraph is gone, from *It is also the one judge trained on another model* through *the luckiest of three*: the teacher-student setup, the 2,000 held-out locations, the 53% top-pick agreement and 0.91 median rank correlation with their `models/palette/acceptance.json` citation, the FAIL record shipped rather than moving the bar, the 59% teacher-against-itself ceiling, and the median-of-three-seeds choice. That paragraph ends at *(models/palette/)*. **Nothing here was replaced** — the acceptance numbers survive nowhere else on the site, and a later round that wants them is writing them new. No claim elsewhere leaned on either passage; `prose color-palettes.html` is verbatim again at 1,479 words. **the *Leveling* section is now *Autolevel*** *(2026-09-07, PLACE_ckpt113_color_palettes_autolevel_0906, closing the note recorded 2026-09-06 with the Rendering fundamentals placement)*. Rendering fundamentals spends *percentile stretch* on the pre-color field operator and leaves *autolevel* to mean only the finished-image adjustment this section covers. **The fragment moved with it, `#leveling` to `#autolevel`**, and the only link that targeted it anywhere in the repository was this page's own contents rail, which is derived; `check`'s link check is the guard. One clause was deleted from the section's first sentence — *because the field decides how much of the ramp is used* explained autolevel in the percentile stretch's terms, and *Applying a palette* had already made the point three paragraphs earlier — and the `palette-autolevel` alt string's *the leveling operator* became *the autolevel operator*, in the registry. The figure's `provenance` still says *levelled stops* and `builder.palettes:autolevel_pairs` is unchanged: a recipe names the function that ran. The asset is already `palette-autolevel.jpg` and no filename moved. **`gallery-curation.html`'s two remaining uses were renamed 2026-09-07** (PLACE_ckpt113_gallery_curation_autolevel_and_caption_0907), so *leveling* survives nowhere on the site outside correct usage; `index.html`'s *the picture's tone is leveled against wallpapers that already work* is legitimate and stays. `builder/vocabulary.py` does not guard *leveling* and deliberately gains no rule for it — *levelled* is the right word for what the operator does to a palette's stops, so a naive sweep would fire on correct usage. **The rename is verified closed, 2026-09-07** (FIX_ckpt113_website_caption_round_and_consistency_0907): across every tracked HTML, JSONL, JS and CSS file, no *leveling* or *levelling* survives at all, the only `level` word a reader meets is `index.html`'s *leveled*, which is the legitimate usage above, and `#autolevel` is the only fragment anything links. Nothing here is outstanding; what is left is history. **The page was swept for em-dashes 2026-09-07** (FIX_ckpt114_website_leftovers_0907), page and master v5 together: nineteen in the body, recast as a parenthesis, a colon or a sentence break, and no number, claim or term moved with any of them. Its captions and alt strings were already at zero. **The 2026-09-02 round came from Matt's notes and not from a doc** — commit `9e96c16`, which landed his pass over the section alongside the hue-grouped library page: the palette-choice paragraph corrected to the mechanism the production loop uses, the repository file list replaced by a link, six deletions, the gamut paragraph in his own words, and `render-cyclic-repeats` redrawn. The same pass carried `palettes/make-your-own.html`. Nothing was built in the review folder for it, which is why `review --list` has never heard of it |
| `finding-good-wallpapers.html` | yes | `Finding good wallpapers v3.md` | none | 3 placed | renamed from `from-locations-to-wallpapers.html` at the twelve-section split, and the figures' `wallpapers-` prefix still carries the old name. `wallpapers-attempt` is placed off Matt's tile pick and `wallpapers-mine` landed 2026-09-02 off one mine's own visit records. **`wallpapers-stages` is deleted and `wallpapers-three-bands` stands in its slot** *(2026-09-05)*: the diagram of boxes and lettering is gone entirely — block, asset, registry row, link row, master marker, and its maker and constants in `builder/diagrams.py` — and the new figure makes the same claim out of real pictures. Three titled bands — *Finding good locations*, *Mining for wallpapers*, *Gallery curation*, the sections either side of this one and this page's own word for what it does. Sixteen admitted locations across the top, in the same neutral map and the same order as `locations-highly-rated` so the two pages visibly hand off; five larger tiles of the ninth of them in the middle, its own neutral frame, then the two best results that differ in mode and the two that differ in color, those last two labelled by the hue each is dominant in rather than twice by the same word; eight gallery seats along the bottom, no two sharing a partition, a mode or a hue. **The reuse of the sixteen is claimed on the row** and is the only `reuse_reason` on the site. `builder/pool.py` draws it and the picks live on its registry row. **`wallpapers-three-bands`'s alt string lost *color map* 2026-09-07** (FIX_ckpt113_website_leftovers_0907), the same correction as `locations-highly-rated`'s and for the same reason: its top band is now *sixteen small fractal locations in one neutral palette*. The row's caption and `provenance` are unchanged — a `provenance` line naming a `colormap` is the word the explorer's link derivation reads. **The page was swept for em-dashes 2026-09-07** (FIX_ckpt114_website_leftovers_0907), page and master v2 together: nine in the body, and the one in `wallpapers-mine`'s alt, where *of the same location — one row a mode* takes a colon. **v3 placed 2026-09-08** (PLACE_ckpt117_finding_good_wallpapers_v3_0908), a wholesale replacement of v2, which is trashed in Drive; v2 was corrected against `fractal-wallpapers` at 3c7754a and shortened. The lead's drawable stock is the junk-floor population rather than the search's admitted finds, and the location judge is named as a prior on where to look rather than a verdict on the picture. The attempt is described with the palette head's smooth proxy explicit, and the false claim that a rendering mode turns the smooth field into a picture is gone, along with *an attempt takes a few seconds*. **The pool section is corrected**: the pool is merged and pruned rather than an undiscarded record of every attempt, and *pictures are cumulative too* is struck, having contradicted this page's own retention section. **The heading *Deepening a location* is now *Breadth and depth*, and its fragment moved from `#deepening-a-location` to `#breadth-and-depth`** — nothing on the site linked the old one, and the ids derive from the heading. Retention is five per location and mode-with-settings, with the fifth protection added (a seat in a gallery recorded under a name), and deletion is named as real loss with the repeat measured. The rank key is cut to its current four columns, with the current finding that **refitted today it buys nothing over the top-threshold score**, because the judge improved underneath it; it stays as the prune's order, and retention's order is separated from the gallery's. Not taken from the review and not to come back: its rewrite of *Where the budget goes* and the deletion of the two paragraphs under it, and the claim that bounded aggregates remember how deeply a pair was sampled. **All three captions changed with it**, in the registry: `wallpapers-three-bands`'s bottom band is *chosen out of the pool as it stands* rather than selected out of every picture every mine has made; `wallpapers-attempt` is rewritten around the palette judge comparing thirty-two colorings of the smooth field; and `wallpapers-mine` no longer states a retention rule the picture does not show. **The picture is deliberately not regenerated** — it outlines three per mode where the standing keep is five, and it is a demonstration rather than the rule (Matt), which is why the caption stopped stating one. **`<i>mine</i>` is kept at its first noun use** in *The pool*, which the master leaves unmarked: the master italicizes `*pool*` in the same sentence, this page is where the term is introduced, and an italic is outside what `builder prose` compares. **Four cuts, a heading and a redrawn figure 2026-09-09** (WEB_ckpt117_wallpapers_prose_cuts_and_mine_redraw_0909): *What one attempt is* is now *How one picture is made* and the fragment moved from `#what-one-attempt-is` to `#how-one-picture-is-made`; `<i>attempt</i>` went with it, so *attempt* is an ordinary English word on this site rather than a term the article defines, which is how `overview.html` and `rendering-modes.html` were already using it. Deleted: the closing sentence of the economy paragraph (*a fact to price rather than a reason to prefer one kind of picture*), the fixed-plan paragraph under *Breadth and depth*, the two-reasons paragraph under *Where the budget goes*, and the five-protections paragraph under *Keeping only what earns its place*. *The pool* is rewritten in plainer words and keeps both italics. Page and master v3 together, verbatim at 999 words. **`wallpapers-mine` is redrawn on a different visit**, and the old one could not have been redrawn at all: its run `teal_pilot` is no longer under the artifacts tree, `surviving` called a `picks` function that no longer exists, and one of its four modes was `exp_smoothing`, struck from `explorer/modes.jsonl` 2026-09-04 and out of `MODE_WORDS` with it. The new visit is `night_d` at a multibrot degree 3, five modes by four palettes with `threads` among them; the visit dumps no field at all, so the figure now shows the expensive half of the economy the prose above it describes rather than the cheap one. Fifteen tiles are the judged files copied and five are redraws of what retention deleted, priced on the row at a mean absolute 3.13 of 255 against the fifteen that survive. `sources` is now fifteen `candidate` keys where it was one `gallery_seat` |
| `gallery-curation.html` | yes | `Gallery curation v1.md` | none | 6 placed | placed 2026-09-01 with the (b)/(c) seam; `gallery-release` came across from `wallpapers-release` with the full-size render it illustrates. The other five landed 2026-09-03 off the recorded tentative gallery `20260902T164622Z` and its solve record, which `builder/curation.py` reads — the page's figures stand on a **later pass** than `overview-gallery-hook` and `modes-gallery` do, over the same pool, because the earlier pass's solve record has been overwritten. `gallery-floors` is drawn at one gallery size and not two: see the seam note below. **The page's two *leveling* uses became *autolevel* 2026-09-07** (PLACE_ckpt113_gallery_curation_autolevel_and_caption_0907, closing the note left on [color palettes] the day before): *the leveling operator from color palettes* and *its leveling stamp*, both around the `gallery-release` figure, and both the finished-image operator under its retired name rather than the pre-color percentile stretch — a rename and not a rewrite, page and master together. The link into that section carries no fragment and so did not move with `#leveling` to `#autolevel`. Nothing else on the page carried the old name in prose, caption or alt. **The eligibility cutpoint is corrected 2026-09-07** (FIX_ckpt113_website_leftovers_0907), page and master together: *even odds or better of being rated good* is now *of being rated exceptional*, because the bar is a flat one half on P(≥4) and the very next sentence already says it is measured at the judge's top threshold — the two could not both be true. The two-tier fallback that follows is correct and current, `curation.headroom.bars` reading P(≥4) where a mode has the places and P(≥3) where it does not, and was not touched. **The page was swept for em-dashes 2026-09-07** (FIX_ckpt114_website_leftovers_0907), page and master together: seventeen in the body, and one of them took more than a punctuation mark — the DINOv2 gloss, *— a vision network trained without labels, which turns*, reads *, a vision network trained without labels that turns*, because an appositive comma in front of a *which* clause reads as two asides where the dash read as one. ⚠ **`20260902T164622Z` no longer exists** (atlas_refresh_ckpt139, 2026-09-22): closing mining next door removed every saved solve but the twenty `final139_*`, so `builder/curation.py` now points at `final139_general` and a redraw of the five charts would answer that pass's numbers rather than the ones the prose quotes. The two figures with seat panels redraw unchanged — `article/figure-recipes.jsonl` holds their recipes here — and moving the prose onto a current pass is a publishing-time act. **What that redraw costs was measured 2026-09-21** (`leftovers_rebake_ckpt140`) and it is three things rather than one: `gallery-pool` does not draw at all, because `final139_general` folds its near-duplicates rather than deleting them and the maker reads a `places_refused` the record no longer writes — and under `fold: pool` its three bars are one number, 19,197 over 8,940 places, so the funnel it is has to be re-derived from `fine_bar.offered`/`kept` and `clusters_after_the_preselection` before it means anything; `gallery-twins` and `gallery-output` name their panels by keys of the dead stamp, and re-picking those is Matt's; and the two charts that do draw move the page's argument rather than its numbers — the pass fills 1,000 of 1,000 with nothing short, so *What comes up short* is describing a shortfall that is not there, 34 of 48 colors at their allowance becomes 14, and *all fourteen* floors becomes thirteen modes, twelve of them floored |
| `full-pipeline.html` | yes | `Full pipeline v3.md` | none | 2 placed, 1 draft, 1 held | `pipeline-overview` and `pipeline-yield-decay` landed 2026-09-02; `pipeline-growth` is a **draft** because its ladder stops at the gallery sizes this pool can seat; `pipeline-themed-galleries` is **held** on one pool solved twice, plain and under a color theme, which the solve leg writes only into the wallpaper project's ignored `artifacts/`. **The page was swept for em-dashes 2026-09-07** (FIX_ckpt114_website_leftovers_0907), page and master v3 together: twenty-six in the body, more than any other page carried, plus the two in `pipeline-growth`'s alt. Six recasts joined a line that then had to be re-wrapped, which is the only reason this page's diff is wider than its edits |
| `fractal-atlases.html` | no | none | none | 1 draft | the section's prose is not drafted; the tool it will hang off is shipped, as the explorer's Atlas tab, and `atlas-places` is a still of its plate — see below. **The stub's own intro was swept for em-dashes 2026-09-07**: a stub is prose a reader can read, and the one it carried is the reason the `dashes` check reads `<main>` where a page has no prose section |
| `deep-zoom.html` | no | none | none | none | the section is not written |
| `palettes/make-your-own.html` | hangs off Color palettes | `Make your own palettes v4.md` | applied 2026-09-02, Matt's notes | 1 placed | **Swept for em-dashes 2026-09-07** (FIX_ckpt114_website_leftovers_0907), page and master v4 together: three in the body, one pair becoming a parenthesis and one dash a colon. **The 2026-09-02 round came from Matt's notes and not from a doc** — commit `9e96c16`, the same pass that went over `color-palettes.html`: the validator paragraph loses the sentence about what it deliberately does not check, and the `palette-generator-batch` caption loses its closing clause. Nothing was built in the review folder for it, which is why `review --list` has never heard of it. Nothing else is held |
| `palettes/all-palettes.html` | hangs off Color palettes | generated | n/a | 1,021 palette strips, none a registry figure | the strips are generated from the wallpaper project's library and are not figures; the page groups them by the hue each map is dominant in, twelve sections, every map shown in its own right . **The generator no longer emits an em-dash 2026-09-08** (WEB_ckpt116_site_corrections_0908). The page is out of `dashes`' reach because it is generated, so the rule is held at the two places that write its words: `palettes.LIBRARY_LEAD` carried two pairs, the first now a parenthesis because the derived count has to stay inside the sentence that formats it and the second a sentence break; `pages.library_page`'s hue heading carried one each, now `Rose (62 palettes)`. Thirteen lines, sixteen marks, and **none of them came from data** — no palette name, display name or hue name in `palettes/library.jsonl` carries the character, so a regenerate is enough and no record moved. Three marks survive on the page and are the same three every generated page here carries: two HTML comments a reader never sees, and the `<title>` separator, which is site-wide furniture spelled `All palettes — Making Fractal Wallpapers` on every page and is out of the check's reach by the same ruling |
| `index.html` | n/a, the front page | none, the page is its own | none | 1 placed | reader-facing prose with no master and no round: a lead, twelve section blurbs and two closing pointers, hand-written and hand-edited. The one thing on it a check decides is its **done markers**, which `check`'s `contents` re-derives from `article/sections.jsonl`, so the written flag lives in one place and not thirteen. One registry figure names this page: `index-hero`, the captionless picture between the masthead and the intro, drawn by `python -m builder front`. **Swept for em-dashes 2026-09-07** (FIX_ckpt114_website_emdash_check_0907): ten marks in eight places. **The Gallery curation blurb was replaced 2026-09-08** (WEB_ckpt116_site_corrections_0908): it claimed quality is decided first and constraints applied afterwards, and that every rendering mode is represented. The second was false — `curation/mode_policy.py` next door weights six of its nineteen modes zero, so those are refused at pool construction and reach no gallery at all — and the first inverts the order the leg actually runs in. The blurb now says the bar decides only eligibility, per rendering mode, and that the set is chosen whole; it is the longest blurb on the page by some way and that is deliberate, because the shape of the claim is the correction. One word of the supplied text was changed at placement, *colour* to *color*, under the American-spelling rule. It carried no row in this table until 2026-09-08, for the same reason it carried none in the register below until the day before — it is not a section, so nothing that reads `sections.jsonl` reaches it, and a page nothing reaches is a page nothing reviews |
| `galleries/index.html` | n/a, generated | generated | n/a | none | the builder writes it from the gallery metadata and `check`'s `pages` holds the committed bytes to what the builder produces now, so there is nothing on it to review as prose and an edit by hand is a failing check. **No gallery exists yet** — `assets/images/galleries/` is not there, so `builder build` writes an index with no cover tiles on it and the page is its intro sentence and a link back. It waits on Matt exactly as the galleries do |

**"Last review round" is the last round applied to the page from either source, and the
cell names which** *(Matt, 2026-09-08)*. A round of Matt's marks reaches a page two ways:
as a **review doc**, built by `python -m builder review <page>`, marked up in Google Docs,
applied and consumed; or as **Matt's notes** direct, the same marks arriving in a prompt
with no document to carry them. The column used to be defined as what `review --list`
reports as applied, which admitted only the first kind and left a notes round with nowhere
to go — it went into the cells anyway, and the column then held both kinds without saying
which. Naming the source is what makes it honest.

**The review-doc half stays checkable, and only that half.** A cell reading *review doc*
has to agree with `python -m builder review --list`, which is the record of what was
applied and consumed; a disagreement there is a bug. A cell reading *Matt's notes* is
checkable against nothing — there is no artifact for it — so it stands on the round note
in the last column, which names the commit or the prompt the round arrived in. A doc
**waiting** in the review folder is a round somebody started and did not finish, and
`--list` is the only place that says so.

**The twelve slugs are ratified, and the kicker is hand-typed** *(Matt, ckpt 97)*. The
reading order in the table is that ratification. The *Section N of 12* line each page opens
with is typed into the page rather than derived — the rail and the front page's done markers
are what `build` writes and `check`'s `contents` re-derives, and the kicker is neither, so a
thirteenth section would be twelve hand edits. `finding-good-wallpapers.html` was renamed
from `from-locations-to-wallpapers.html` at that split, and **the old URL is dead with no
stub at it**, which is the one permanent URL this site has spent.

### The em-dash sweep, and the check it became

**Measured 2026-09-06, finished 2026-09-07, and mechanical the same day**
(FIX_ckpt114_website_leftovers_0907, then FIX_ckpt114_website_emdash_check_0907). The last
five article pages were swept in the first of those rounds; the front page and the Fractal
atlases stub in the second, which is where the rule stopped being something a person held.

**It is `builder check`'s `dashes` check now** *(Matt, 2026-09-07)*. The paragraph that
stood here explained why it was not one: every unswept page would have gone red at once,
and the pages were swept at Matt's pace. That reason is spent — the site is at zero, so the
rule adopts green — and the ruling is to adopt it. The regression it exists to catch was
never a page drifting on its own: it is a page **arriving** from a design session with
em-dashes in it, which is what every placed page did. Caught at placement that is a short
recast; caught a round later it is another sweep of a whole page, which is what both rounds
above were. A failure names the page and quotes the words around each em-dash, because the
work is to fix them rather than to know how many there are.

`builder/dashes.py` says what it reads and what it does not. Body, captions and alt, across
every section of the article — written or not — plus `palettes/make-your-own.html`,
`index.html` and the gallery index. Out of its reach, on purpose: a page's `<title>`, which
spells its separator `Overview — Making Fractal Wallpapers` site-wide; the contents rail,
which `build` derives from other pages' titles; `palettes/all-palettes.html`, whose lead and
twelve hue headings were the generator's and **were ruled on 2026-09-08**, below; the
explorer, which is a tool page rather than a section and carries one recast in its
served-not-from-the-filesystem note; and text drawn into a figure, below. **There
is no allowlist**: the guidance keeps one carve-out, an em-dash where no recast preserves
the meaning, and with the rule mechanical that carve-out costs an edit to that module, which
is the right price for it.

The table below is no longer the guard, and is kept as the record of when each page was
swept. Nothing regenerates its numbers, and nothing needs to now.

Three columns, because they are three different edit sites and an apply that clears one does
not touch the others. **Body** is the page's `section.prose` with figure blocks and comments
removed, which is the reduction `python -m builder prose` compares — and, on a page that has
no prose section, its `<main>`. That fallback is what the check added, and it is not a
technicality: the Fractal atlases stub carried one em-dash in the intro above its *not
written yet* line, and this column read zero for it because a stub has no `section.prose` to
read. **Captions** and **alt** are that page's rows in `article/figures.jsonl`. **Text drawn
into a figure is not counted here or anywhere** *(Matt, 2026-09-06)*: the rule reaches body,
captions and alt and stops, so an em-dash lettered into a sheet is not a defect and is not a
hold.

**The front page has a row now, and had none until 2026-09-07.** `index.html` is
reader-facing prose with no prose master, so the page is its own only edit site, and it sat
outside this register by accident rather than by ruling: its lead, its twelve section blurbs
and its two closing pointers carried **10** em-dashes between them, recast as a sentence
break, two parentheses, four colons and one phrase that wanted no punctuation at all — ten
marks in eight places, two of them a pair around an aside. The gallery
index has a row for the same reason and carries none in prose — its three are a comment, the
rail marker and the `<title>`, and the check reads none of those.

| page | prose master | body | captions | alt | swept |
| --- | --- | ---: | ---: | ---: | --- |
| `overview.html` | Overview v2 | 0 | 0 | 0 | yes, with v2 |
| `escape-time-fractals.html` | Escape-time fractals v1 | 0 | 0 | 0 | yes, with v1 |
| `rendering-fundamentals.html` | Rendering fundamentals v1 | 0 | 0 | 0 | yes, with v1 |
| `rendering-modes.html` | Rendering modes v4 | 0 | 0 | 0 | yes, with v4 |
| `finding-good-locations.html` | Finding good locations v7 | 0 | 0 | 0 | yes, with v7 |
| `training-judges.html` | Training judges v6 | 0 | 0 | 0 | yes, with v6 |
| `color-palettes.html` | Color palettes v6 | 0 | 0 | 0 | yes, 2026-09-07 |
| `finding-good-wallpapers.html` | Finding good wallpapers v3 | 0 | 0 | 0 | yes, with v3 |
| `gallery-curation.html` | Gallery curation v1 | 0 | 0 | 0 | yes, 2026-09-07 |
| `full-pipeline.html` | Full pipeline v3 | 0 | 0 | 0 | yes, 2026-09-07 |
| `fractal-atlases.html` | none yet | 0 | 0 | 0 | yes, 2026-09-07, its stub intro read as `<main>` |
| `deep-zoom.html` | none yet | 0 | 0 | 0 | n/a, stub carries none |
| `palettes/make-your-own.html` | Make your own palettes v4 | 0 | 0 | 0 | yes, 2026-09-07 |
| `index.html` | none, the page is its own | 0 | 0 | 0 | yes, 2026-09-07 |
| `galleries/index.html` | generated | 0 | 0 | 0 | n/a, carries none |
| **total** | | **0** | **0** | **0** | |

Two things the table says that a copied count would not. **Every row verifies at zero**, on
all three columns, so no page here is claimed on trust: the counts are read off the same
reduction `python -m builder prose` compares and off the registry's own rows, and they were
read again after the sweep. And **the caption column reached zero before the body did** —
the nineteen that had stood in it were all on the pages swept with a new master, so the
2026-09-07 round had only body and alt left to clear: 74 in the body of four article pages
and the one page hanging off Color palettes, and 3 in alt, `full-pipeline` 2 and
`finding-good-wallpapers` 1. **The round that made it a check found 11 more in the body**,
on the page the table had no row for and on the one whose row was reading the wrong half of
its page: 10 on the front page and 1 in the Fractal atlases stub.

**The paragraph that stood here said 99 in the body of five article pages, and both halves
were wrong** — the column it sat under summed to 74 across four article pages plus
`palettes/make-your-own.html`. It is corrected rather than carried forward, and it is the
reason the sweep was worked off the table rather than off the prose above it.

### What a slug still carries, and what retired

Placing the (b)/(c) seam retired four figures with the mechanism they drew —
`wallpapers-slots`, `wallpapers-embedding`, `wallpapers-cluster-attempts` and
`wallpapers-floors` — and nothing on the site refers to any of them now.
`wallpapers-release` moved across to Gallery curation as `gallery-release`, and **its asset
file and its `explorer/links.jsonl` row were renamed with it**, so the old slug survives
nowhere. `wallpapers-stages` kept its slug through the same move and lost it on 2026-09-05,
when the figure it named was replaced rather than redrawn: a picture made of pictures is not
the diagram under another caption, so it took a new slug, `wallpapers-three-bands`.

One row is not on a page: `pipeline-themed-galleries` is `held` on one pool solved twice,
plain and under a color theme, and no such pair of passes has been recorded.
`pipeline-growth` is the site's one `draft` row.

**The hold the other five were under is gone, 2026-09-03.** It read as a `builder/pool.py`
question — the live selection leg writes its galleries only into the wallpaper project's
ignored `artifacts/`, and nothing there is addressable from a clone — and the second half
of that was never the obstacle it looked like. A figure is drawn on this machine and its
picture is committed; what a clone cannot do is *redraw* it, which is the same thing every
other figure here asks of a clone and which `check` reports as a named skip rather than a
failure. What was actually missing was a recorded pass, and `builder/picks.py` resolving a
seat through the run's own record is what made one addressable. The residue is that CI can
neither redraw these panels nor resolve their source keys, which is the standing shape of
every figure on the site and not a hold on any one of them.

### The (b)/(c) seam

Finding good wallpapers is (b) and Gallery curation is (c), and the seam is where the pool
stops being built and starts being chosen from. As placed, (b) is mining — what one attempt
is, the pool, deepening a location, where the budget goes, keeping only what earns its
place, how candidates are ranked. (c) is the solve — what is eligible, two pictures of the
same place, how much of a collection one color may take, pictures that read as one
wallpaper, asking for what would otherwise not be there, what the pass is trying to do,
building the set, what the pass does not decide, what comes up short, rendering the gallery.

**What `gallery-floors` could not be drawn as.** Its specification, in the master and in
the registry, is two gallery sizes side by side — every mode's floor met at the smaller and
several short at the larger. No such pair of records exists over one pool: the only sizes
solved against this pool are n = 1,000, and every n = 150 record on this machine was solved
over an earlier and smaller one. Two sizes over two pools is not the comparison the figure
claims, so it was drawn at one size and re-captioned. The page's own sentence — *a gallery
of a hundred and fifty fills today; a gallery of a thousand does not* — is still true of
what was measured when it was written, and is the claim a round should ask for a current
record of. The same round should look at *the demands that go unfilled are all mode
floors*: on this pass every floor is met and the 88 unfilled seats were refused by the
color allowance, by one-wallpaper-per-location and by the twin rule.

*Where the budget goes* used to describe the allocator design that is now dead, and its
revision was slated for the Full pipeline round. **That round landed it**: the section
describes the simple loop — mine until the pool holds what a gallery needs, let the gallery
say when it does not — and nothing about the allocator is left on the page.

### Fractal atlases has a tool before it has prose

The atlas is the explorer's Atlas tab, built and shipped over the search's own record;
`atlas/README.md` is its contract. It was a page of its own at `atlas/index.html` until
`website_webp_and_atlas_deprecate` (2026-09-21) retired that page for the tab, which mounts
the same frame beside a viewer; the old address redirects, and the page's colour key now
sits in a line above the tab's frame, linking back to this section. Four facts from there are worth knowing before the section is drafted. The
record is **real as of 2026-09-21** — 113 marks on the Mandelbrot plane and 488 over the
six, seats read out of the semi-final general record `20260922T012627Z`, where it used to
be a fixture that told a maker the shape it owed. The
**population is one bar**: a place is on the plate because at least one of its rows clears
the solve's own fine bar, and nothing else puts one there, which is what lets the third
slot always be a wallpaper. A dot is **one place of one kind**, blue for the parameter
plane and red for a dynamical one, with no merging across the two. And
`atlas/links.js`'s `opened` is still **the only place a view is spelled**, which is the
whole reason a mark's picture and a mark's link agree.

The stub now carries one figure, `atlas-places`: the plate with its marks and nothing else,
registered `draft` because every count in its caption is a reading of that record. **Its
four counts were re-baked onto it 2026-09-21** (`leftovers_rebake_ckpt140`): 112 marks
thinned from 1,300, 60 blue and 52 red, became 113 from 1,369, 58 and 55. It stays a draft
because those twenty records are not published. Its
caption ends with a link to the tool page, which is what `caption_link` on a registry row
is for — a figure that is a still of something a reader can go and use, and not the way
into the explorer, which is a mark on the corner of the picture. The section's own prose is
not drafted.

The explorer is not in the table above, and the atlas page that was beside it is retired.
A tool page has no prose master, no review round, and nothing about it is reviewed as prose.

## Rulings a page is held to

`writing-guidance.md` is the editorial authority and `CLAUDE.md` holds this repository's
conventions. What is collected here is the handful of rulings that govern **what the article
says** rather than how it says it, and that neither of those two files carries.

- **The site names and shows only the modes a gallery will ship** — `mode_policy.accepted()`
  next door. A niche mode is never named and never drawn, with one carve-out: a trap shape
  may be named as a texture, where the shape rather than the mode is what the sentence is
  about.
- **No page states a count of modes.** The roster is whatever the scoreboard lists; three
  pages once carried three different counts, which is what a number typed into prose does.
- **A cut's two sides are `keeper` and `junk`**, wherever a page names them.
- **`partition` is defined once, on Training judges**, where it takes its italic; every
  later page uses the word plain. The family/partition distinction itself is
  `writing-guidance.md`'s.
- **Numbers go in at their current values, and nothing schedules a refresh.** A corpus count
  or a scoreboard reading is written as it stands. There is no number-upkeep prompt and
  there will not be one until publishing is near.
- **The eligibility bar is a flat one half, and the prose says it is a round number** rather
  than a calibrated one — and then says why its exact placement stops mattering: once enough
  locations have been mined, the collection is built out of pictures well clear of it in
  either direction. `writing-guidance.md` carries the bar/floor vocabulary; this is the claim
  the article makes about that one bar.
- **No bar is described as a measured crossover.** There is no measured crossing behind any
  of them, and prose implying one makes a claim the records do not support.

## The prose registry

`article/prose.jsonl` is what says which master belongs to which page:

```json
{"schema": 1, "kind": "prose", "page": "finding-good-locations.html",
 "file": "Finding good locations v5.md",
 "divergences": [{"master": "...", "page": "...", "why": "..."}]}
```

A page with no row is a page whose HTML is its own master — legitimate for a section
written straight into the page, and the review doc is built from the page alone.

The masters themselves live at the **root** of `prose\` in the synced folder. A superseded
master is trashed in Drive when its replacement is placed; `prose\old\` is a folder from
before that practice and has been empty since 2026-09-04. A row that names a master not at
the root is saying the page is held to a document the drafting side has already moved
past — report it rather than reading around it.

A **divergence** is a place where the page deliberately says something the master does
not, because the master was approved before a correction landed. Each one records the
master's words, the page's words, and why. Nothing else is allowed to differ, and a
divergence nobody wrote down is indistinguishable from a page somebody quietly edited.

`python -m builder check` holds the registry to naming written pages of this article. It
deliberately does not read the masters: they live on a synced drive that a clone need not
have and CI certainly does not. `python -m builder prose` is what reads them, and it runs
where the documents are.

## Leftovers

Known and not scheduled, one line each, so that nothing else has to carry them. Each is
Matt's to raise; a prompt that fixes one strikes its line.

- **The five charts of `gallery-curation.html` still read the 2026-09-02 pass**, whose record
  is gone; the page row above says what a redraw off `final139_general` costs, and it is a
  maker change, two re-picks of Matt's and a section of prose rather than a re-bake.
- **The phone layout clips the viewer above the tabs.**
- **The Galleries page and the explorer part company past tile 78**: the tentative gallery's
  own page shows an older presentation order until `curate solve browse` is rebuilt next
  door. Nothing is live, so it is left.
- **Reverse barely moves ten authored maps**, which run out and nearly back again.
- **`direct_trap_screen`'s sliders have dead travel**: the engine holds the screened cross
  under an opacity of 0.15 and a threshold of 0.08, and `params.js` gives both the full range.
- **A hue-family collection's label promises one hue**; the family pass splices a theme, and
  the chip a seat lands under is the color reading's own.
- **The seven mode collections show their raw names** in the Collection dropdown
  (`smooth_mean_angle · 300`); readable names are a separate decision.
- **The download bar parks during the shade**: `download.js` reserves up to half the bar for
  the coloring and nothing advances it until the picture lands.
- **The walk's candidates row scrolls each new tile into view**, so the kept tile can end
  up off to the left.
- **Deploy preparation** *(Matt: preparing, not deploying)*: the staged set in
  `builder/README.md`'s *What is staged* goes in at deploy. The judges reach Pages as release
  assets fetched at deploy time, the way the wallpaper project ships its weights, and never
  through git.
- **No picture a visitor takes off this site carries an embedded link** — to be decided at
  deploy preparation, not before. The explorer stamps every picture it hands over
  (`explorer/README.md`, *Every downloaded picture carries its own link*), and nothing else
  here does: the figures and gallery tiles the builder writes go through `images.land`, which
  is the one encoder a stamp would go in on this side, and `explorer/links.jsonl` already
  holds the permalink for 40 of its 62 rows, so most of what a stamp would say is derived
  already. The full-size wallpapers are the harder half — they are built in
  `fractal-wallpapers` and ship as Release assets, so they never pass through a page here at
  all, and stamping them is that repository's encoder rather than this one's.
