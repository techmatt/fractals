# QA findings

The bug hunts' findings list: each finding fixed, deferred to Matt with a recommendation, or
won't-fix with a reason. A hunt reads it first and never re-reports an item already here.
The hunt before this file (`explorer_bug_hunt_ckpt138`, 2026-09-20) kept its findings in
`explorer/README.md`'s *What the last bug hunt covered* and the sections they belong to.

## 022_bug_hunt (2026-11-25): what changed since 004

The custom-modes rebakes (015, 021), the shared measure and recolour (020), `palettesOf`,
and the deploy split (017). The checker is `u11-custom.mjs`'s `recolour`, `aliases` and
`rests` scenarios: 84 palette switches, knobs and Auto tone over 40 modes drew exactly what
a fresh load of each link draws (59 recoloured); every old name opened its mode and palette.

### Fixed

1. **A knob a palette tunes showed its default, not the value drawn.** The module writes the
   entry's tuned values and then only the knobs that are set, so brass-foam on greenhorn
   drew Star rays at 0.5 with the slider at 0.3, and setting 0.3 was read as no setting and
   drew 0.5 (33 knob-palette pairs). The box, the slider, Reset and the link now read the
   knob at rest as the entry's value (`style.js` `knobRest`, the contract's `rests`).
2. **A download estimate after a palette switch was priced off the recolour**, which
   iterates nothing, while a download always measures: about half the real time. A
   recoloured pass keeps the cost of the pass it recoloured.
3. **A post-stage mode's download estimate was divided by the pool's workers** (tri-mosaic,
   paper-layers, gouache-cut, starburst-veils, light-shafts), though it draws whole on one
   worker: a quarter to an eighth of the real time.
4. **Two Saved custom views a palette apart were one tile twice**: the title now names a
   `tuned` palette.
5. The status line said `on 1 workers` for every post-stage mode, and `measure` for the
   time a recolour took.
6. `docs/custom-modes.md` listed five of the nine `INTEGER_MEMBERS`, and said every bench
   takes `--workers` and `--tier` (only the browser bench does; parity and natives ignored
   both without a word).

### Deferred to Matt

1. **Nine palette entries tune a knob outside its own range** (veil-drift's Brightness at
   seven of its maps, brass-foam's greenhorn Bubble size 0.6 on 0.06 to 0.16,
   soft-petals' golden_egg_petals, molten-folds' interstellar_webs). The box says the
   value; the slider sits at its end, and a touch jumps the picture into range. Recommend a
   wallpapers item widening those ranges, or dropping the knob's member from the entry's
   values; the alternative, clamping here, would draw something no keep did. (Matt's call)
2. **Stepping `]` faster than a recolour lands measures afresh**: the cancel terminates the
   keeper mid-recolour, so its kept frame goes (14 of 14 second presses measured afresh).
   Recommend letting a keeper whose only call is a recolour finish rather than
   terminating it, keeping `kept` through the cancelled pass: about 2× on fast stepping.
3. **A large HiDPI screen draws a custom mode on one worker** (older than 020): a
   2560x1440 window at device pixel ratio 2 is a 2972x1668 canvas, 19.8 million samples
   at 4×, past `PASS_MEMORY`'s share for two workers and past `MAX_CUSTOM_SAMPLES`, which
   only a download is held to. veil-drift's home view had no picture after 25 minutes
   (15 of them sharpening, then the measure), and no trap. Recommend pricing helpers at
   what they hold since 020 (the shared measure and their tiles; 004's deferred 2), and
   drawing a screen past one worker's memory at one sample a pixel, said in the status line.
   (Matt's call: the second trades the keeps' supersample for a picture at all.)
4. **checks.yml still pins Node-20 actions** (`checkout@v4`, `setup-node@v4`,
   `setup-python@v5`, `upload-artifact@v4`, `download-artifact@v4`): every run carries the
   deprecation annotation that 017 cleared from pages.yml. Nothing fails yet. Recommend
   the same move to the Node-24 majors, each tag checked on a run.

### Won't fix

- **At a 540 px window the knob boxes run 10 px past the controls column.** The explorer
  targets desktop only (`docs/rulings.md`); every control stays visible and usable.

## 004_bug_hunt (2026-11-06): the custom (experimental) render mode

The checker is `explorer/bench/hunt/u11-custom.mjs` (`explorer/README.md`'s *What the last
bug hunt covered* has how to run it). `docs/custom-modes.md`'s *Problems the first nine hit*
are 003's and are not repeated here.

### Fixed

1. **Every worker kept its last frame's memory for the page's life, in or out of the
   custom modes.** A pass grows each worker by 90 to 250 bytes a sample (every worker
   measures the whole frame) and a wasm memory never shrinks: about 6 GB held by eight
   workers after one 1280x800 picture, until reload. The pool is now given back whenever
   an engine pass draws, every worker is replaced after a download, and a start the reader
   leaves before it lands no longer installs itself (`custom.js` `release`, `style.js`
   `recycle`).
2. **A custom download could ask for more memory than a worker has.** The engine's 60
   million sample ceiling let 3840x2160 at 4× through (33 million samples, 7 to 8 GB a
   worker against wasm32's 4), and a 2560x1440 at 4× ran a pool's worth of 3 GB copies. A
   custom picture past one worker's memory is refused in a sentence, and a pass runs on as
   many workers as fit 6 GiB between them (`MAX_CUSTOM_SAMPLES`, `workersFor`).
3. **A trapped worker was kept.** After a real failure only workers with calls pending
   were replaced; every worker is now.
4. **A burst of input queued stale previews.** A cancel while a worker was respawning was
   ignored, so each superseded view's quarter-size frame ran before the current one's.
   Calls now carry the slot's epoch and are dropped when it moves.
5. **A worker could be orphaned.** A reset or stop while a worker was still starting left
   that thread running unanswered (`style.js` `abandon`).
6. **Undo stepped past the picture just left** while a custom pass ran (up to a minute):
   the pass remembered its view only when the exact picture landed. It is remembered at the
   preview, as an engine pass is at its first full field.
7. **A tone-only knob (Brightness) stayed live with Auto tone off**, redrawing the same
   picture for a minute and writing a setting into the link. It is greyed and says why.
8. **Emptying a knob's box set it to its minimum** (`Number("")` is 0) and redrew.
9. **A whole-number knob took fractions**: `turns:4.5` drew 4 while the box and slider said
   5. The knob and the link both round half to even, as the module does.
10. **A fractional knob's box rounded what it showed**: Light direction typed as 45.5 showed
    46 and drew and linked 45.5. The box shows, and a typed value is rounded to, the
    slider's step.
11. **A Saved custom entry's hover text and alt text said "smooth in <palette>"**, the
    engine mode a custom link parses with and a palette Matched palette does not draw.
12. **The knobs were a ragged row**: each slider began where its label ended. They are a
    label, slider, box grid.
13. **`docs/custom-modes.md` would have failed an executor five times**: step 2's catalog
    `public` block lacked `knobs` (and the 3-to-5 rule), step 3 missed the second
    `INTEGER_MEMBERS` copy in `explorer/style.js` and the JSON integer/float rule
    `styles.with_knobs` rounds by, step 8 named two of the four test lines a new mode moves,
    step 9's compares read four buttons as misses by design and need Pillow, which this
    machine's `python` lacks. `style.test.mjs` now holds the two `INTEGER_MEMBERS` lists
    equal where the checkout is configured.
14. **`experiments/results/003_custom_modes_explorer/` (3.3 MB of JPEGs) was tracked and
    served by Pages.** Untracked, and `/experiments/` is ignored in the tracked `.gitignore`
    (Matt, MESSAGE #1025), so no clone serves a results folder again.

### Deferred to Matt

1. **The reader-facing text the bundle carries is internal shorthand**, in 18 of 22
   Example tooltips (`d5 julia, ten spokes`, `m2 seahorse tail spiral`, `mandelbrot seed4`,
   `variant: lune blades`, `julia multibrot6 · matched map`), ribbon-foam's two buttons say
   the same thing, and the mode tooltips read as build notes (`bronze_packing plus …`, `the
   first style`, `built from existing pieces`, `from the strip trap`) with British spelling
   (`colour`, `bevelled`, `jewelled`). All of it is the sibling's catalog and style files,
   written here whole by `style bundle`. Recommend a wallpapers item rewriting `show`
   captions, `what` and knob `what` for a reader, then `--style` here; the alternative, a
   display-text override beside `custom-modes.json` like `palette-names.json`, is drift
   from the bundle. (Matt's call)
2. **A pass's memory budget counts every worker at the measurer's cost.** Every worker
   measured the whole frame, costing the pool N times one frame's memory and measure time
   (`docs/custom-modes.md`, Problems 5). The measure time is fixed: wallpapers 083's
   `export_measure`/`import_measure` let one worker measure and the rest tile (website
   020's pool). Left: `workersFor` still prices each helper as a measurer, so a large
   download runs on fewer workers than its memory needs. The download ceiling
   (`MAX_CUSTOM_SAMPLES`, one worker's memory) stays, since the measuring worker still
   holds the whole frame and keeps it for a recolour.
3. **Choosing custom (experimental) at the home view draws the first mode at the home
   view**, which for most modes is not where they read well (lacquer-lobes is two pink
   bars across bubbles). Options: open the mode's first Example when the view is a family's
   home, or leave it. Recommend the first. (Matt's call)
4. **The preview is a quarter-size picture with no supersampling**, visibly blocky for
   about a second on the slow modes. It is 003's deliberate step and reads as progress.
   Won't-fix unless Matt wants a softer upscale.

### Won't fix

- **A hand-made link with a projection member the engine refuses** (`projection=foo:1`)
  opens and then says the module's own sentence. That is how every engine refusal arrives
  (`permalink.js`'s note on engine-refused combinations); only a hand-made link reaches it.
