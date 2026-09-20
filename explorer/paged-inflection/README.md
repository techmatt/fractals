# The Inflection tab, paged out

**PAGED by Matt's ruling, 2026-09-20.** He looked at both contact sheets and the tab: the
feature is okay and he does not actively like it. So the code is kept and made
**unreachable** — not a tab, not a link a reader can arrive on, not something the page or
the checks pay for. **Do not wire any of this back into the explorer unless Matt asks for
it.** The restore is written down at the foot of this file so that one person can do it
end to end without reconstructing anything; it is not an invitation.

Nothing on the page imports a file in this folder, nothing here runs in a suite or in a
`builder check` step, and nothing fails because it is absent.

## What it was

A fifth tab of the explorer that sculpted a degree-2 Julia set by **inflection**, which
deep-zoom people also call **Julia morphing**. An ordinary Julia render takes a pixel's
coordinate `z` and iterates `z ← z² + c`. An inflection at a point `p` replaces `z` by
`(z − p)² + p` **before** the first iteration; with a list `p₁ … pₙ` in click order a pixel
is mapped through `pₙ` first and last through `p₁`, and only then iterates. The map fixes
`p` and is two-to-one around it, so the picture that was at `p` comes back wrapped twice
about it — exact two-fold symmetry there.

**Only the orbit's starting point moves**, which is why the whole thing was cheap and why
`fractal-engine` never changed for it. The recurrence, the cap, the escape test and every
channel the modes read were the engine's, untouched, so every mode, palette, shade recipe,
tone curve, drag and download worked on the tab without being told anything. The tab owned
three things: which `c` the set was of, the ordered list of points, and what a click on the
canvas meant.

Where to click was published practice rather than guesswork — Heiland-Allen's ALPACA 2025
paper on patterns in deep Mandelbrot zooms, and the other sources in
`fractal-drive-sync/preserve/art_techniques_links.md`. Work within the **shortest arm** of
the structure around the last click: a click at its **central node** makes a disk, one
**beside** that node a tree, one **beyond** it a line.

## What was learned, which is the reason any of this is kept

- **The seed rule was backwards, and interior is decidable.** Solid nodes joined by
  filaments sculpt well in real deep-zoom morphing and are exactly wrong here: the pre-map
  sends a disc of interior two-to-one onto a disc of interior, so a filled node inflects to
  a black disc with a rim, and the first contact sheet was half black because of it. What
  sculpts is a `c` whose Julia set has **no interior at all**, and that is decidable —
  iterate from the critical point `z₀ = 0`, find the cycle the orbit settles on, and take
  the multiplier `|λ| = |∏ 2z|` around it: under one the cycle attracts and its basin *is*
  the interior; over one it repels and there is none. **Closing a cycle is not the test**,
  and getting that wrong reads `c = i`, the classic dendrite, as filled at period 2 — it
  does land on a 2-cycle, and that cycle repels at λ = 5.66. `seeds.mjs` is that test.
  Forty-seven candidates were generated and rendered that way; the eight that look unlike
  each other are `inflect.js`'s `SEEDS` — seven Misiurewicz points and one `c` just outside
  the set beside elephant valley.
- **Snap to node is mandatory, not optional.** It was optional in the prompt and is not
  optional in practice: a click a few pixels inside a node inflects interior, a disc onto a
  disc, and the picture is a black disc with a rim. One 64×64 field per click fixes it.
- **Three to five clicks, and then it closes.** One construction was drawn at every click
  count from one to nine. At three to five the ornament is open and reads as a tree or a
  rosette with arms; **from six on it closes into a disc with a bright fringe** and all the
  structure is in the rim. Moving to a new feature every click buys more depth than
  repeating one point, but not unlimited depth — the flattening arrives anyway.
- **The three primitives only differ in the crops.** At the whole-ornament framing `disk`,
  `tree` and `line` are not visibly different from each other. They diverge at **4–16×
  crops** and not before: the primitives are a statement about fine structure, and the frame
  that shows the whole ornament is the wrong one to judge them in. The best pictures of the
  second sheet were all crops.
- **`tia` and `curvature` are the modes that suit it.** Both read the orbit's *shape*, so
  they lay texture along a filament rather than across it. `smooth_mean_angle` speckles;
  `stripe` and `smooth_stripe` wash the fine work out; `gaussian_int` makes odd blue discs;
  `direct_trap_ring` is muddy on a dust, which paints too rarely to fill. Of the palettes,
  `twilight_shifted` had the best value range for one-pixel lines, `cmr.ember` the most
  drama.
- **An inflection costs nothing over a plain frame** — 0.97× to 0.99× on the held-still
  bench, and six points cost what one does — *once* the engine's channel table is written
  out for the one family. Through the generic loop it was 1.29× on `smooth`. `bench.mjs`
  holds the work still to ask that question, because the obvious version of it compares two
  different pictures: the pre-map throws most of the plane far from the origin, those
  samples escape at once, and an inflected frame at the same view comes back several times
  *faster* than the plain one.
- **`de` was refused rather than approximated.** A pre-map puts `∏ 2(zₖ − pₖ)` between the
  orbit's derivative and the pixel's, which is inside `iterate::Orbit`. No offered mode sets
  the flag, so nothing was lost; a wrong answer there would have been a *plausible* picture.

## What is in this folder

```
inflect.js               the tab: the stack, the start, the snap, what a click means
inflect-link.js          its contract — parse, emit, canonicalize, fresh; marker `iv=1`
inflect-link.test.mjs    26 tests: the contract, and the other two held to not moving
features.js              the feature finder: filaments, arms, nodes, the three choices
features.test.mjs        13 tests, against drawn shapes whose answers are known
bench.mjs                what a list costs, against the same frame with none
seeds.mjs                which c has no interior, by the critical orbit's multiplier
```

Both suites still pass when run by hand from here, which is the cheapest evidence that a
restore would land:

```
node --test explorer/paged-inflection/features.test.mjs
node --test explorer/paged-inflection/inflect-link.test.mjs
```

`bench.mjs` is the exception: it needs a module built with the `inflection` feature on, so
it only runs part-way through a restore.

## What stayed behind on the page

Three things, and each is there because a **URL outlives a trial**. Somebody may still hold
a link, or have one in Saved, and the plain Julia set underneath an inflected link is a
different picture wearing that picture's name.

- `permalink.js` keeps `INFLECT_MARKER` and `isInflected`, so a query can be sorted onto
  `iv` and answered rather than refused as an unknown key.
- `explorer.js` keeps `INFLECTION_PAGED` — one sentence, used at the door, on a Saved
  tile's title and when a Saved entry is opened.
- `deep-link.test.mjs` keeps the two guards this folder's suite used to own: that `iv` is
  sorted by its own marker and by neither live contract, and that the shallow and deep
  contracts both refuse `iv` and `q` by name.

`permalink.js` also still exports `PARAMETERS`, which nothing on the page reads. It is
exported for `inflect-link.js` here, and keeping it is what lets this folder's suite go on
running.

## The wasm

`engine-wasm/src/inflect.rs` stays in the crate and is compiled **only** under the
`inflection` cargo feature, which is off by default. With it off:

- `inflect.rs` is not compiled and `Spec` has no `inflections` key, so `deny_unknown_fields`
  refuses a spec carrying one by name rather than quietly drawing the picture underneath it;
- `crate::Inflections` is `()` and `crate::start_at` is the identity, which is the whole of
  how the two call sites — `paint_band` and `derive::probe_row` — are written once for both
  builds;
- the shipped module is **763,343 bytes**, the size it was before the tab, against 793,590
  with the feature compiled in.

**Measured, not argued.** The gated module and the committed one with the tab in it were
compared over 153 frames — six families × seventeen modes × two supersamples, palettes
cycled, plus the direct traps' probe path — RGBA *and* raw lanes: **72.9 MB, zero bytes
different**. And the gated module against the module as it stood the commit *before* the
tab landed: same length, **32 bytes different**, every one of them a `core::panic::Location`
line number in `src/lib.rs` shifted by the 99 lines the gating added. The filename, the
column and every other byte of the module are identical.

## Putting it back

1. `git mv` the five page files out of here and back beside `explorer/index.html`:
   `inflect.js`, `inflect-link.js`, `inflect-link.test.mjs`, `features.js`,
   `features.test.mjs`. Change `../permalink.js` back to `./permalink.js` in
   `inflect-link.js` and `inflect-link.test.mjs`, `../deep-link.js` to `./deep-link.js`,
   and `../engine-wasm/src/inflect.rs` to `./engine-wasm/src/inflect.rs`. `bench.mjs` goes
   back to `explorer/bench/inflect.mjs` with `../bench/` dropped from its two imports.
   `seeds.mjs` has no page role and can stay here. Drop the **PAGED** banner from the top
   of each file.
2. Turn the feature on in the shipped build: add `inflection` to a `default` feature in
   `explorer/engine-wasm/Cargo.toml`, or pass `--features inflection` from
   `builder/explorer.py`'s `build_wasm`. Then `python -m builder explorer` and expect
   `engine.wasm` back at about 793,590 bytes.
3. `explorer/index.html`: the tab button and the `panel-inflect` panel. Both are in the
   commit that paged this out, whole, and are the cleanest place to take them from.
4. `explorer/explorer.css`: the 123-line block at the foot of the file, likewise.
5. `explorer/explorer.js`: the tab's own section — `startInflect`, `enterInflect`,
   `leaveInflect`, `inflectOwns`, `inflections`, `syncFamilyLock` and the `draft` flag —
   plus the branches that name them: one line in `paintMark`, one in `currentQuery`, one
   in `retype`, the block in `showPanel`, one in `canonicalOf`, the Saved tab's `parse` and
   `open`, the four gesture branches and the cursor listener, and the door and boot
   branches in `main`. Delete `INFLECTION_PAGED` and its three uses, which the tab replaces.
6. `explorer/render.js`: `specOf` writes `spec.inflections` when the view carries points.
7. `explorer/permalink.js`: `inflectionKey`, and its two call sites in `fieldKey` and
   `probeKey`. **This one is not optional** — two pictures that differ only in where they
   were clicked are different fields, and without it the second is served the first one's
   lanes, which is the worst shape a cache bug takes.
8. The suite goes back on: `explorer/inflect-link.test.mjs` in `CLAUDE.md`'s command line
   and a step in `.github/workflows/checks.yml`. The two guards added to
   `deep-link.test.mjs` under *the paged Inflection tab's marker* are then duplicated and
   can come out of it.
9. `explorer/README.md`: the *Paged* stub under *Inflection* goes back to the full section,
   and the feature finder's entry returns to `§Next`.

Every one of these is in the commit that paged the tab out, which is the diff to read.
