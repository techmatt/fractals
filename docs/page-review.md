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
editing a cell by hand.

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
| `rendering-fundamentals.html` | yes | `Rendering fundamentals v1.md` | none | 6 placed | **v1 placed 2026-09-06** (PLACE_rendering_fundamentals_v1_0906), and this page's **first** master — its HTML had been its own until now. Out of a reviewer pass of seventeen corrections plus a cross-section note and two questions, adjudicated into the master before it arrived. Four of the findings were real errors rather than looseness, and all four are corrected: the printed smooth-count formula is now the one `iterate.rs` computes, with the bailout named as 2<sup>16</sup> and the mathematical minimum corrected from 2 to 2 raised to the power 1/(d − 1); reaching the cap no longer *declares* an orbit interior, because it decides nothing about the orbit; supersampling is no longer per-pixel averaging but the Lanczos-3 reduction `resample.rs` actually runs, in linear light, at a radius of three *output* pixels; and the dynamic-range paragraph no longer spreads the palette to the iteration cap, which is not what the figure under it compares. Two places correct the reviewer instead: the log-log clock intuition is kept and only its equation changes, and the *mathematical minimum of 2* line is corrected rather than deleted. **Terminology: the field operator is the *percentile stretch* throughout**, matching the engine's own `Stretch`, and *leveling* is left to mean only the finished-image autolevel that Color palettes covers — Rendering modes' three uses of the old sense were corrected in the same round. The body carried **25** em-dashes and now carries none, and the two the captions carried are gone as well. **All six captions were rewritten with it**, in the registry, and one alt string. **`render-autolevel` is renamed `render-percentile-stretch`** — registry row, link row, page block and the asset file, since a filename is vocabulary a reader meets; the pictures are unchanged and the `recipe` still names the `autolevel` function under ignored `scratch/` that drew them, which is what was actually run. Two caption claims are dropped rather than reworded and should not come back: `render-supersample` no longer says nothing later in the pipeline can put back what the sampling missed, which framed supersampling as detail recovery rather than as reconstruction, and `render-maxiter` no longer *declares* orbits interior. The master's eight-item verification list was worked against the engine source and **nothing in it needed correcting**: `maxiter.rs` still reads `BASE` 4000, `PER_OCTAVE` 0.30, `FLOOR` 200, `CEILING` 67,000 and `HOME_WIDTH` 3.0; `iterate.rs` still has `BAILOUT` 2<sup>16</sup> and pins the floor of the smooth count to the integer count in a test of its own; `resample.rs` still filters Lanczos-3 in linear light at a radius of three output pixels with one encode at the end; `coloring.rs`'s `CLIP_LOW` and `CLIP_HIGH` are still 0.5 and 99.5 over finite samples only, and a crop still stretches against its own; and `curation.run_layout.RELEASE_SUPERSAMPLE` is still 4. The `#multibrot-sets` link is gone from this page — the smooth-count paragraph names the degree instead — and the anchor stays where it is, because Escape-time fractals' own rail links to it. **Two sentences deleted 2026-09-06** *(Matt)*, page and master together: the iteration-cap paragraph no longer ends *The shape was right the first time; the base was eight times too low*, and the `render-percentile-stretch` caption no longer ends *, and the picture was there the whole time* |
| `rendering-modes.html` | yes | `Rendering modes v4.md` | none | 13 placed | **v4 placed 2026-09-06** (PLACE_rendering_modes_v4_0906), a wholesale replacement of v3, which is trashed in Drive. Out of a reviewer pass of thirty corrections plus three questions, **whose central structural claim is rejected and must not come back**: the reviewer read the engine's `Tier::Production` as the pipeline's roster and concluded the page was stale by six modes. It is not. `curation/mode_policy.py` puts `trap_circle`, `gaussian_int`, `smooth_trap_circle`, `direct_trap_ring`, `tail_itinerary` and `exp_smoothing` at weight zero — out of the draws and out of the gallery — and the thirteen this page describes are exactly the ones above zero, so every count on it was already right: five composites, four screened, three direct traps, one itinerary mode, thirteen table rows. Ten of the thirty corrections and the counts inside two more are dropped on that basis. What is taken, all checked against the engine source: `smooth_mean_angle` is the **lopsidedness** of the orbit's nearest, mean and farthest Gaussian-integer distances read as an angle — `field.rs`'s `Reduction::MeanAngle` is the angle of `(mean − nearest) + i(farthest − mean)` — and not the averaged approach direction the page and its caption both claimed; the orbit-trap paragraph no longer says every trap is centered on the origin and then contradicts itself three sentences later; `threads` no longer claims the loop has no early exit, which it has, and its kernel is named as the narrow bell `exp(−D²/σ²)`, σ = 0.15, additive at half strength; the debanding by the smooth count's fractional part is stated under stripe, which `field.rs` applies to `stripe`, `tia`, `curvature` and `threads` alike; curvature's motion categories are dropped; `de` is named as a mode the renderer will draw on request; normal-map lighting is named as a **deliberate** omission, in `mode.rs`'s own terms; and the histogram bullet carries the percentile-stretch name. **The thirteen-row quality and cost table and its placeholder footnote are carried through untouched and deliberately** — numbers on this site are checked and refreshed together when Matt says it is ready for publishing. The body carried **31** em-dashes and now carries none; **nine of the thirteen captions were rewritten**, eight of them em-dash recasts and `modes-smooth-mean-angle` a corrected definition, and the four left alone (`modes-stripe`, `modes-smooth-stripe`, `modes-direct-trap-multiply`, `modes-gallery`) were already clean. All thirteen alt strings are untouched and clean. One word of a supplied caption was authored here: `modes-smooth-mean-angle` reads *rather than standing at the origin* where the prompt wrote the banned word `builder/vocabulary.py` spells `sittin[g]`, and is written that way here for the same reason that module writes it that way. **Watch `curation.mode_policy.UNMINED`** *(Matt, 2026-09-06)*: `curvature` is now accepted in every respect but the draw, so the page's *two in other modes, drawn without replacement from the rest of the roster* is a roster of twelve for a gallery and eleven for a mine. The roster of thirteen this page teaches is unchanged and the sentence was left as the master wrote it |
| `finding-good-locations.html` | yes | `Finding good locations v7.md` | applied 2026-08-21 | 10 placed | placed 2026-09-01 with the reframing channel; **pass 2 on 2026-09-04 closed the figure divergence** — `locations-walk-root` is deleted (block, asset, registry row, link row and master marker) and `locations-minibrot-examples` replaces it, so the master's twelve `[FIGURE]` markers and the page's twelve blocks now agree one for one and in order. The same pass swept the no-identifiers rule over every figure on the page, keeping frame widths, which are the subject on the framing ladder and the descent chain. **`locations-walk-step` retired 2026-09-05 and `locations-walk-descent` took its slot** — the animated one-expansion diagram is gone entirely (block, asset, registry row, link row, master marker, and its maker in `builder/locations.py`), and the new figure is five rows of one descent: the whole set beside four seed starts, three rungs of four proposals apiece with the location judge's estimate printed under each, then the location it kept beside four wallpapers of it. **It is Matt's to review**, and two things on it are decisions rather than readings — the descent is composed rather than replayed, because a real walk seeded on the home view dies at depth 3 with every proposal refused on interior or occupancy; and the first row's four estimates are all 0.00, which is the plane-root waiver the page's own Score paragraph describes. **A figure pass on 2026-09-05 took the page from twelve blocks to eleven**: `locations-walk-examples` and `locations-found-and-finished` are deleted outright, `locations-highly-rated` takes the second one's slot — a plain 4×4 grid of sixteen class-4 locations, no labels and no numbers on it — and `locations-reframe-examples` keeps its structure with its bottom strip re-picked onto node 5810, where every operator's best proposal clears 0.82 against the 0.00 the neighborhood operator scored at node 5700. **v6 placed 2026-09-05** (PLACE_locations_v6_0905): Matt's em-dash pass over the body — the page carried 39 in its prose and now carries none, every one recast as a parenthesis, a colon or a sentence break — plus the *Examining walk quality* opener losing its third clause, and the framing-ladder passage condensed to the direction the ladder aims. **`locations-framing-ladder` is deleted** (block, asset, registry row, link row, and its maker and `LADDER_NODE` in `builder/locations.py`; `FRAMINGS` stays, the descent chain reads it), which is what took the page from eleven blocks to ten. One sentence went with the pass that the master's own changelog does not name: *A snap is a correction, not a teleport* is off the `snap_to_nucleus` paragraph, placed as the master reads. Two captions moved: `locations-walk-descent` lost the clause excusing its top row's zeroes. **The caption half was swept on 2026-09-05**: the four em-dashes the ten remaining captions carried are recast, and `locations-reframe-examples` is rewritten outright — it told a reader two of three answers score lower than the frame that triggered them, which is true of its top three rows and the opposite of what the re-picked strip below them shows. **v7 placed 2026-09-06** (PLACE_finding_good_locations_v7_0906), out of a 2026-09-06 critic pass adjudicated into the master before it arrived. Ratings are first person throughout; the lead's stale pointer moves to [finding good wallpapers], which is where mode and palette are actually chosen; the root-supply paragraph is rewritten outright, the old fixed-file-per-family model having been the largest stale passage on the page; the Render cheaply stage is corrected to the node regime, one render serving the gates and the judge alike; the two score cuts are stated as named bars with **no numeric heights**, under the rule that a constant a retrain invalidates may not be printed; plane grace becomes a configurable number of rungs; the pinned-plane expansion budget is added; in-walk operator frames are corrected to frontier nodes that are never themselves scored; `snap_to_nucleus`'s guard is corrected from *a nucleus inside the frame* to a bounded distance measured against the frame's own width; the twin channel is narrowed to the higher-degree Julia families; the no-knee claim becomes a measurement; the standalone reframe channel is rewritten as generational; and the seeded-versus-fresh result is scoped to its run and given its numbers. **The master's sixteen-line verification list was worked against `fractal-wallpapers` at d256339 and one line needed correcting**: line 3, the nucleus solver, which converges at `discovery.nucleus.NUCLEUS_DPS` = 60 decimal digits and not at the search's own double precision. Everything else held. **The heading *Seeds from labels* is now *Reusing previous finds***; its `<h2>` carries `#reusing-previous-finds`, because this site derives a heading's id from its own words and nothing may pin one, and `#seeds-from-labels` survives as a legacy anchor immediately above it so no existing fragment breaks. **Two captions were edited with the round**, in the registry: `locations-rating-examples`, which had been repeating its own preceding paragraph, and `locations-highly-rated`, whose *thousands of highly rated locations* was ambiguous between Matt's hand ratings and machine scores when most of the pool has never been rated by a person. **Captions on this page still want their own round** — these two are corrections, not the sweep. One wording nit is left standing for Matt rather than edited into approved prose: *Where the walk stops* says *the scales below that floor*, which is the width minimum the v5 bar/floor ruling respelled as *minimum width* everywhere else on the page |
| `training-judges.html` | yes | `Training judges v5.md` | applied 2026-08-21 | 3 placed | **numbers refreshed at publishing** *(Matt, 2026-09-05)*: *The corpus holds ratings for more than twelve thousand locations, about six thousand smooth renders, and about five thousand renders in the other modes.* The counts stand as written and no round re-reads them until publishing is near — no thrash on counts before then |
| `color-palettes.html` | yes | `Color palettes v5.md` | applied 2026-09-02 | 7 placed | **the *Leveling* section heading should become *Autolevel*** when this page is next reviewed *(recorded 2026-09-06 with the Rendering fundamentals placement, not done then)*. Rendering fundamentals now spends *percentile stretch* on the field operator and leaves *leveling* to mean only the finished-image operator this page covers, which is the one the heading is about — and the section's own prose and its `palette-autolevel` figure already call it autolevel. The heading carries the `#leveling` fragment, so the rename is a URL change and belongs in a round rather than in a stray edit |
| `finding-good-wallpapers.html` | yes | `Finding good wallpapers v2.md` | none | 3 placed | renamed from `from-locations-to-wallpapers.html` at the twelve-section split, and the figures' `wallpapers-` prefix still carries the old name. `wallpapers-attempt` is placed off Matt's tile pick and `wallpapers-mine` landed 2026-09-02 off one mine's own visit records. **`wallpapers-stages` is deleted and `wallpapers-three-bands` stands in its slot** *(2026-09-05)*: the diagram of boxes and lettering is gone entirely — block, asset, registry row, link row, master marker, and its maker and constants in `builder/diagrams.py` — and the new figure makes the same claim out of real pictures. Three titled bands — *Finding good locations*, *Mining for wallpapers*, *Gallery curation*, the sections either side of this one and this page's own word for what it does. Sixteen admitted locations across the top, in the same neutral map and the same order as `locations-highly-rated` so the two pages visibly hand off; five larger tiles of the ninth of them in the middle, its own neutral frame, then the two best results that differ in mode and the two that differ in color, those last two labelled by the hue each is dominant in rather than twice by the same word; eight gallery seats along the bottom, no two sharing a partition, a mode or a hue. **The reuse of the sixteen is claimed on the row** and is the only `reuse_reason` on the site. `builder/pool.py` draws it and the picks live on its registry row |
| `gallery-curation.html` | yes | `Gallery curation v1.md` | none | 6 placed | placed 2026-09-01 with the (b)/(c) seam; `gallery-release` came across from `wallpapers-release` with the full-size render it illustrates. The other five landed 2026-09-03 off the recorded tentative gallery `20260902T164622Z` and its solve record, which `builder/curation.py` reads — the page's figures stand on a **later pass** than `overview-gallery-hook` and `modes-gallery` do, over the same pool, because the earlier pass's solve record has been overwritten. `gallery-floors` is drawn at one gallery size and not two: see the seam note below |
| `full-pipeline.html` | yes | `Full pipeline v3.md` | none | 2 placed, 1 draft, 1 held | `pipeline-overview` and `pipeline-yield-decay` landed 2026-09-02; `pipeline-growth` is a **draft** because its ladder stops at the gallery sizes this pool can seat; `pipeline-themed-galleries` is **held** on one pool solved twice, plain and under a color theme, which the solve leg writes only into the wallpaper project's ignored `artifacts/` |
| `fractal-atlases.html` | no | none | none | none | the section's prose is not drafted; the tool page it will hang off is shipped — see below |
| `deep-zoom.html` | no | none | none | none | the section is not written |
| `palettes/make-your-own.html` | hangs off Color palettes | `Make your own palettes v4.md` | applied 2026-09-02 | 1 placed | — |
| `palettes/all-palettes.html` | hangs off Color palettes | generated | n/a | 1,021 palette strips, none a registry figure | the strips are generated from the wallpaper project's library and are not figures; the page groups them by the hue each map is dominant in, twelve sections, every map shown in its own right |

"Last review round" is what `python -m builder review --list` reports as **applied**; a
doc **waiting** in the review folder is a round somebody started and did not finish, and
`--list` is the only place that says so.

**The twelve slugs are ratified, and the kicker is hand-typed** *(Matt, ckpt 97)*. The
reading order in the table is that ratification. The *Section N of 12* line each page opens
with is typed into the page rather than derived — the rail and the front page's done markers
are what `build` writes and `check`'s `contents` re-derives, and the kicker is neither, so a
thirteenth section would be twelve hand edits. `finding-good-wallpapers.html` was renamed
from `from-locations-to-wallpapers.html` at that split, and **the old URL is dead with no
stub at it**, which is the one permanent URL this site has spent.

### The em-dash sweep

**Measured 2026-09-06.** Nothing regenerates these numbers. The em-dash rule is standing in
`writing-guidance.md`, and it is deliberately **not** a `check` — every unswept page would go
red at once, and the pages are swept at Matt's pace. So the table is measured by hand, and it
is dated, because a page edited after that date has not been re-counted.

Three columns, because they are three different edit sites and an apply that clears one does
not touch the others. **Body** is the page's `section.prose` with figure blocks and comments
removed, which is the reduction `python -m builder prose` compares. **Captions** and **alt**
are that page's rows in `article/figures.jsonl`. **Text drawn into a figure is not counted
here or anywhere** *(Matt, 2026-09-06)*: the rule reaches body, captions and alt and stops,
so an em-dash lettered into a sheet is not a defect and is not a hold.

| page | prose master | body | captions | alt | swept |
| --- | --- | ---: | ---: | ---: | --- |
| `overview.html` | Overview v2 | 0 | 0 | 0 | yes, with v2 |
| `escape-time-fractals.html` | Escape-time fractals v1 | 0 | 0 | 0 | yes, with v1 |
| `rendering-fundamentals.html` | Rendering fundamentals v1 | 0 | 0 | 0 | yes, with v1 |
| `rendering-modes.html` | Rendering modes v4 | 0 | 0 | 0 | yes, with v4 |
| `finding-good-locations.html` | Finding good locations v7 | 0 | 0 | 0 | yes, with v7 |
| `training-judges.html` | Training judges v5 | 25 | 0 | 0 | no |
| `color-palettes.html` | Color palettes v5 | 19 | 0 | 0 | no |
| `finding-good-wallpapers.html` | Finding good wallpapers v2 | 9 | 0 | 1 | no |
| `gallery-curation.html` | Gallery curation v1 | 17 | 0 | 0 | no |
| `full-pipeline.html` | Full pipeline v3 | 26 | 0 | 2 | no |
| `fractal-atlases.html` | none yet | 0 | 0 | 0 | n/a, stub |
| `deep-zoom.html` | none yet | 0 | 0 | 0 | n/a, stub |
| `palettes/make-your-own.html` | Make your own palettes v4 | 3 | 0 | 0 | no |
| **total** | | **99** | **0** | **3** | |

Three things the measurement says that a copied count would not. **Every page recorded as
swept verifies at zero**, on all three columns, so none of those five is claimed on trust.
**The caption column is zero site-wide** — the nineteen that stood in it were all on the four
pages swept this era, so the caption half of the job is finished rather than three pages
wide. And what is left is **99 in the body** of five article pages and the one page hanging
off Color palettes, plus **3 in alt**: `full-pipeline` 2, `finding-good-wallpapers` 1.

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

### Fractal atlases has a tool page before it has prose

`atlas/index.html` is built and shipped in the `plates` treatment, over a per-partition
record; `atlas/README.md` is its contract. Two facts from there are worth knowing before
the section is drafted: the page is built against a **fixture** record, which is what tells
a maker the shape the real record owes, and `atlas/links.js`'s `opened` is **the only place
a view is spelled**, which is the whole reason a dot's picture and a dot's link agree. The
section's own prose is not drafted.

Neither the atlas nor the explorer is in the table above. They are tool pages: no prose
master, no review round, and nothing about them is reviewed as prose.

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

The masters themselves live at the **root** of `prose\` in the synced folder;
`prose\old\` holds what has been superseded. A row that names a master under `old\` is
saying the page is held to a document the drafting side has already moved past — report
it rather than reading around it.

A **divergence** is a place where the page deliberately says something the master does
not, because the master was approved before a correction landed. Each one records the
master's words, the page's words, and why. Nothing else is allowed to differ, and a
divergence nobody wrote down is indistinguishable from a page somebody quietly edited.

`python -m builder check` holds the registry to naming written pages of this article. It
deliberately does not read the masters: they live on a synced drive that a clone need not
have and CI certainly does not. `python -m builder prose` is what reads them, and it runs
where the documents are.
