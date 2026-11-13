# A custom mode, from a reference image to live in Mandelnaut

A **custom mode** is one of the wallpaper project's published styles: a stack of layers over
one orbit, drawn by that project's own compositor. Mandelnaut offers them in two tiers, the
catalog row's `tier`, each its own render mode entry: **Custom** (`curated`) and **Custom
(lab)** (`lab`). It draws them with the same compositor compiled to
WebAssembly (`explorer/style.wasm`), so a picture in the explorer is the pipeline's picture
byte for byte. This is the whole path for the next one, across both repositories, and the
problems a mode meets on the way.

The two repositories: **wallpapers** is `C:\Code\fractal-wallpapers` (the style, its keeps,
the catalog, the module's source); **website** is this one (the module as built, the bundle,
the page). A website item never commits next door; each half below is its own item.

## The checklist

**Next door, in a wallpapers item:**

1. **Make the style.** `data/styles/README.md`'s *A new style from a reference image*, steps
   1 to 9: the stack, any new primitive, the matched map, the scouted locations, the tone
   targets, two picker rounds, and Matt's keeps saved with `style keep`.
2. **Write the catalog row** in `data/styles/catalog.json` (step 10 there): `status:
   "publish"`, `public: {name, palette, knobs}` (`name` is what a reader sees in the
   explorer's select, lowercase-with-hyphens, never the style's internal name; `knobs` is
   the style file's public knob names in its order, step 3, which `style_catalog.check`
   holds it to), `variant` (the stack the row publishes), `show` (the keeps to show, each
   with a caption; these become the explorer's Example buttons, and the caption is their
   hover text, so it is written for a reader: no `d5`, `m2`, `seed4` or `variant:`), and
   `what` (the select's tooltip).
3. **Write the `public` knobs** in the style file: `public.knobs`, each `{name, label, what,
   default, range, set}`, where `set` lists the stack members the knob writes (a pointer, or
   `{path, scale, offset}`). The explorer shows them in this order, as sliders over `range`
   with a reset to `default`. A published mode has **3 to 5** of them (`style_catalog.check`
   refuses any other count). Keep each range short of a picture that stops reading as a
   fractal. A member the module must treat as a whole number has to be one of
   `INTEGER_MEMBERS` in `style-wasm/src/lib.rs` (`iterations`, `hit`, `settle`, `sectors`,
   `turns`); a new one is an edit there, with its test, **and the same edit to
   `INTEGER_MEMBERS` in this repository's `explorer/style.js`** in the website item (step 8;
   `style.test.mjs` holds the two lists equal where the checkout is configured). **Spell
   every whole-number member as a JSON integer and every other member a knob writes as a
   float** (`1.0`, not `1`): the native `styles.with_knobs` rounds by the value's JSON type
   and the module by the member's name, so a mismatch reads as a `__knobs` miss in step 5.
   A knob that writes only `/tone/…` does nothing with Auto tone off; the explorer greys it
   then.
4. **Re-keep or re-draw any shown keep whose stack is not the published one**, if it should
   match its Example button exactly (see *Problems*, 2). `bundle()` carries each keep's own
   stack, so the parity below holds either way; the button opens the published stack.
5. **Hold the module to the engine:** build it, then `fractal-wallpapers style wasm-parity`
   draws every shown keep both ways and must read every frame identical. It leaves the
   native pictures in `artifacts/style-wasm/wasm-parity/`, which step 9 compares against.

   ```
   cargo build --release --target wasm32-unknown-unknown --manifest-path style-wasm/Cargo.toml
   fractal-wallpapers style wasm-parity
   fractal-wallpapers style wasm-speed        # one 1280x800 frame per mode, one thread
   ```
6. **Commit.** The website side can only build what the sibling's `HEAD` holds, with its
   `style-wasm/`, `engine/`, `data/styles/` and `data/palettes/` clean.

**Here, in a website item:**

7. **Move the pin and rebuild all four modules from it**, in this order:

   ```
   python -m builder explorer            # engine.wasm; the pin moves to the sibling's HEAD
   python -m builder explorer --perturb  # perturb.wasm's kernel_tree, at the new pin
   python -m builder explorer --style    # style.wasm, custom-modes.json, style.manifest.json
   ```

   The bare command moves `engine.manifest.json`'s `wallpapers_commit` whenever a source of
   any module moved since the pin (`builder/explorer.py`'s `STYLE_SOURCES` and
   `perturbation/`), and rebuilds `engine.wasm` there: compare its bytes, and name in the
   report if they moved. `--style` refuses a sibling whose style sources or records
   (`STYLE_RECORDS`) are not the pinned trees, and writes the bundle with the sibling's own
   `style bundle`.
8. **The page picks the mode up by itself.** The select, the knobs, the matched map and the
   Example buttons are all read from `custom-modes.json`; nothing in `custom.js` names a
   mode. Run `node --test explorer/style.test.mjs`: these lines move with a new mode **or a
   re-keep** next door: its counts of modes, in all and by tier, its `UNREACHED` list of
   keeps no setting reaches, and in *each mode offers one button a picture* the offered
   counts (in the title too) and the keeps it does not offer; *each
   mode carries its palette set* names brass-foam's set, which moves with a keep in a new
   map. `explorer/README.md`'s *Custom modes* names the button count once; that is the one
   line of it a new mode moves, and nothing in the path needs the rest of that file.
9. **Hold every Example to its keep**, at 640x400 2×2, against step 5's native pictures
   (for a button no setting reproduces, against `style render <style> --location <its
   place> --colormap <its map> --resolution 640 400 --supersample 2`, the published look):

   ```
   node explorer/bench/custom-parity.mjs out/parity --stack keep          # Node, the request path
   python -m builder serve --port 8000                                     # then, the page:
   node explorer/bench/custom-browser.mjs http://localhost:8000 out/browser --workers 3
   python explorer/bench/custom-compare.py out/parity  <wallpapers>/artifacts/style-wasm/wasm-parity
   python explorer/bench/custom-compare.py out/browser <wallpapers>/artifacts/style-wasm/wasm-parity --png
   ```

   `custom-compare.py` needs Pillow, which this machine's `python` does not have: run it
   with the sibling's environment, `../fractal-wallpapers/.venv/Scripts/python`. The second
   compare reads **every button no setting reproduces as a `MISS`**, because the button
   draws the published look and `wasm-parity` drew the keep's own stack: draw those with the
   `style render` line above into a directory of their own, as `<id>.native.png`, and
   compare just them against it. A miss on any other id is a finding.

   The tolerance is identical, on Windows. The first proves the link, the parse and the
   request reach the keep's own picture; the second presses each Example button and saves
   through the Download row, so a miss there that the first does not have is the page's.
   Look at the browser run's PNGs beside the keep JPEGs
   (`fractal-drive-sync/style-keeps/<style>/`) too. The benches take `--workers`: on a
   shared machine keep it low.
10. **Release:** the site's usual checks (`CLAUDE.md`'s *Checks to run before committing*,
    and `builder check` with the checkout, reading its skips), then commit `style.wasm`,
    `custom-modes.json`, both manifests and whatever else moved. GitHub Pages serves the
    committed tree as it is; there is no other build.

## What the explorer does with one

- **The record** is `custom-modes.json`, fetched once the first frame is asked for, or
  before it where the link names a mode (the link is read against it; so is a Saved entry,
  and the Saved tab waits for it); `style.wasm` is fetched the first time a custom mode
  draws. The select gains the tier entries when it lands; its own select lists one tier.
- **The link** carries `custom=<public name>`, never the tier, `tuned=<map>` (one of the mode's palette
  set; the set's first, the mode's own map, is never written), `knobs=name:value,…`
  (defaults left out, in the mode's knob order), `matched=0`, `autotone=0`, and
  `projection=name:value,…` (a place's own log-polar members). A widening of contract
  version 4, not a 5. Under `custom` the engine mode's keys are read, held to their rules,
  and dropped.
- **The palette set**: each mode's `palettes` in the bundle (the catalog row's kept maps,
  each with the `values` tuned for it, written whole at their pointers over the stack
  before the knobs, as `styles.at_palette` does) is a row of swatches beside Matched
  palette, hidden for a set of one; a swatch or the `[` and `]` keys switch palette and turn
  Matched palette on. **A switch measures afresh**: `style.wasm` bakes the map into a
  session and keeps no frame between sessions, and Auto tone's curve is each composite's
  own. A palette already finished at this view and size comes back at once from the page's
  picture cache (`explorer.js`'s `customDrawn`, bounded by `CUSTOM_DRAWN_BYTES`).
- **Old names**: a style merged into a published mode (the catalog row's `aliases`) still
  opens, as `custom=<old name>` read as the mode at the palette entry whose `was` it is
  (`style.js`'s `aliasesOf`), written back under the mode's name. The bundle carries a
  mode's `aliases` and each entry's `was` only once the sibling's `style bundle` writes
  them.
- **Matched palette** (on by default) draws with the chosen palette of the set, shows it on
  the strip, and holds every palette control. Off, the view's palette and Reverse reach the
  picture, the chosen palette's tuned values still holding; nothing else of the palette row
  does, because the stack's own palette layers set the rest.
- **Auto tone** (on by default) is the stack's `tone` pass; off drops it from the stack.
- **An Example button** opens the keep's place at 16:10, in the mode, at its defaults plus
  whatever knob or Auto tone setting reproduces the keep's own stack, on the keep's own
  palette of the set.
- **Drawing** is a quarter-size picture, then full-size tiles against its balance, then the
  exact tone measure and the tiles again, on a pool of half the machine's threads, one to
  `MAX_STYLE_WORKERS` (`style.js`'s `poolSize`). Downloads take the same pool, without the
  preview.
- **Memory**: every worker measures the whole frame, and a wasm memory never shrinks. So a
  pass runs on as many workers as fit `PASS_MEMORY` between them, a download over
  `MAX_CUSTOM_SAMPLES` (one worker's `WORKER_MEMORY` at `BYTES_PER_SAMPLE`) is refused in a
  sentence, every worker is replaced after a download, and the pool is given back when the
  reader leaves the custom modes; all four constants are in `explorer/style.js`. A new mode
  is measured with `node explorer/bench/custom-memory.mjs` (`measure` then one tile on a
  fresh instance); one that reads above `BYTES_PER_SAMPLE` moves that constant.
- **Not offered** in the Deep tab, the Walk, or the gallery's facets; Saved labels a custom
  entry and does not draw its tile.

## Problems the first nine hit, and their fixes

Each is a rule the code holds; code comments cite them by number.

1. **The pin must hold the module.** The pin moves on `STYLE_SOURCES` (`style-wasm/`,
   `engine/`) as well as on `engine.wasm`'s bytes and the perturbation kernel; `--style`
   refuses unpinned or dirty sources and records (`style_pin_problem`), and the manifest
   fingerprints every source and record tree so `check` sees a stale module. A pin move can
   change `engine.wasm`'s bytes and `perturb.manifest.json`'s `kernel_tree` on a README edit.
2. **A shown keep drawn with a stack other than the published one**, reachable by a
   setting (a knob, or Auto tone off) or not. Ruling (Matt): a button draws the
   **published** look, plus the setting that reproduces its keep where one does; a button
   that would draw another button's picture is not offered; a button no setting reproduces
   says so on hover, and is held to a native render of the published settings at its
   place, not to the old keep. The cure is a wallpapers re-keep under the published stack
   (step 4).
3. **A place can carry projection members** (the tunnel's `twist`, `ring`, even `turns`),
   which no explorer view has a field for. The `projection` link key is set by an Example
   and kept through pans; a family change drops it. A location's `turns` overrides the
   knob, as `styles.projected` lays it after the knobs, so the Turns slider is disabled
   there and says why. Members are written in name order and must start with a letter
   (`__proto__` would set no member at all).
4. **`custom` is not a render mode in the contract's sense.** `permalink.js`'s `MODES` is
   held to the baked catalog and the engine's roster; so `custom` has its own keys, and the
   select's entry is appended in `syncModes` only.
5. **A measure cannot cross workers.** It lives in the module's session, so every worker
   measures the whole frame. The preview-balanced tiles go up first, so the full-detail
   picture is on the screen before the exact measure starts.
6. **A wasm call cannot be interrupted.** A cancel terminates every worker inside a call
   and starts a fresh one; the module is compiled once and cloned in.
7. **Style maps missing from `palettes.bin`**: the bundle carries every map it names, and
   the strip and the request read them from there.
8. **The iteration cap.** The request always names a cap, the view's, else the explorer's
   width policy, since a link may drop `n` and the module would pick its own default.
9. **The Download row's price** is the last screen pass of this very view, and "time
   unknown" (still enabled) before one has finished. A download takes the pool from the
   screen's pass, which is drawn again when the download ends, however it ends.
10. **Saved** labels a custom tile and does not draw it; Download all leaves it out.
11. **A shared machine**: the benches take `--workers`.
