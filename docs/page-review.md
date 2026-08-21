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
- the standfirst, then the prose **as served** — headings, paragraphs, bullets, code
  lines, table rows as `| cell | cell |`, and a `[figure: slug]` marker standing where
  each picture sits;
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
  surrounding rhythm, and the markup the words are sitting in.
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
| A figure caption | the figure's row in `assets/images/figures/figures.jsonl` — never the page. `python -m builder check` re-derives the block and will say so if the page was edited instead |
| The standfirst | the page's masthead. The front page's blurb for that section is separate prose that often says the same thing — read it, and change it if the edit applies there too |
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

## The editorial rules

These govern every edit an apply session makes, whether or not the annotation mentions
them. An edit that satisfies Matt's note and breaks one of these is not done.

- **Audience**: an advanced high-school CS student who knows calculus, or a college CS
  student. Assume that much and no more.
- **Wikipedia's structure**: descriptive section titles that say what the section covers,
  so a reader can skip on the title alone.
- **Wikipedia links on first mention** of a genuinely new topic, and sparingly — a page
  of blue is a page nobody clicks.
- **Always "complex plane"**, spelled out, never "the plane" on its own.
- **Unpack dense sentences.** Two clear sentences beat one that has to be read twice.
- **Never artificial counts.** "Three things make this work" is a promise the prose then
  has to keep; write what is true instead.
- **Set a claim up before asserting it.** The reader meets the reason, then the claim.
- **No falsely-discrete conclusions.** Where the truth is a spectrum or a judgment call,
  the sentence says so.
- **Figures teach**, and they are a fixed 16:9. A figure that only decorates comes out.
- **First mention of the article's own vocabulary is `<i>`**, once for the whole article
  in reading order — the convention in `CLAUDE.md`. Captions sit outside that count.
- **Index and section blurbs are concrete and active**: what the section does or teaches,
  in words the reader already has. No pipeline jargon before the pipeline is taught.
- **No light-gray text.** The quiet voice is `--ink-dim`, one step off `--ink` and 10:1
  against the page; both values live in `assets/css/site.css` and nowhere else.
- **A figure that wants a high-quality location** uses only rows Matt explicitly rated 4.
  Never a machine pick, however high it scored.

## When the doc comes back as a Google-native document

If Matt converts the `.docx` to a Google Doc, what lands in the synced folder is a
`.gdoc` — a pointer holding a document id, with the words on Drive. The commands say so
and print the id. Read it with the Drive tools, or ask Matt to use **File → Download →
Microsoft Word (.docx)** back into the same folder.

## The prose registry

`article/prose.jsonl` is what says which master belongs to which page:

```json
{"schema": 1, "kind": "prose", "page": "finding-good-locations.html",
 "file": "Finding good locations v4.md",
 "divergences": [{"master": "...", "page": "...", "why": "..."}]}
```

A page with no row is a page whose HTML is its own master — legitimate for a section
written straight into the page, and the review doc is built from the page alone.

A **divergence** is a place where the page deliberately says something the master does
not, because the master was approved before a correction landed. Each one records the
master's words, the page's words, and why. Nothing else is allowed to differ, and a
divergence nobody wrote down is indistinguishable from a page somebody quietly edited.

`python -m builder check` holds the registry to naming written pages of this article. It
deliberately does not read the masters: they live on a synced drive that a clone need not
have and CI certainly does not. `python -m builder prose` is what reads them, and it runs
where the documents are.
