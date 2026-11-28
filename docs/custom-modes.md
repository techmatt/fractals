# A custom mode, from a reference image to live in Mandelnaut

A **custom mode** is one of the wallpaper project's published styles: a stack of layers over
one orbit, drawn by that project's own compositor. Mandelnaut offers them in two tiers, the
catalog row's `tier`, each its own render mode entry: **Custom** (`curated`) and **Custom
(lab)** (`lab`). It draws them with the same compositor compiled to WebAssembly
(`explorer/style.wasm`), so a picture in the explorer is the pipeline's picture byte for
byte. This is the whole path for the next one, and the problems a mode meets on the way.
**wallpapers** is `C:\Code\fractal-wallpapers` (the style, its keeps, the catalog, the
module's source); **website** is this one (the module as built, the bundle, the page); each
half below is its own item.

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
   with a caption; these become the Example buttons and the caption their hover text, so it
   is written for a reader: no `d5`, `m2`, `seed4` or `variant:`), and `what` (the select's
   tooltip).
3. **Write the `public` knobs** in the style file: `public.knobs`, each `{name, label, what,
   default, range, set}`, where `set` lists the stack members the knob writes (a pointer, or
   `{path, scale, offset}`), shown in order as sliders over `range`, reset to `default`. A
   published mode has **3 to 5** (`style_catalog.check` refuses any other count), each
   range short of a picture that stops reading as a fractal. A member the module must treat
   as a whole number is one of `INTEGER_MEMBERS` in `style-wasm/src/lib.rs`; a new one is
   an edit there, with its test, **and the same edit to `explorer/style.js`'s
   `INTEGER_MEMBERS`** in the website item (`style.test.mjs` holds the two equal where the
   checkout is configured). **Spell every whole-number member as a JSON integer and every
   other member a knob writes as a float** (`1.0`, not `1`): the native `styles.with_knobs`
   rounds by the value's JSON type and the module by the member's name, so a mismatch reads
   as a `__knobs` miss in step 5. A knob writing only `/tone/…` is greyed with Auto tone off.
4. **Re-keep or re-draw any shown keep whose stack is not the published one**, if it should
   match its Example button exactly (*Problems*, 2). `bundle()` carries each keep's own
   stack, so the parity below holds either way; the button opens the published stack.
5. **Hold the module to the engine:** build it, then `fractal-wallpapers style wasm-parity`
   draws every shown keep both ways and must read every frame identical, leaving its native
   pictures in `artifacts/style-wasm/wasm-parity/`.

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

   The bare command moves the pin whenever a source of any module moved (*Problems*, 1) and
   rebuilds `engine.wasm` (a report names its bytes moving); `--style` writes the bundle
   with the sibling's `style bundle`. Re-read the sibling's `HEAD` before committing: a
   `data/styles/` commit mid-item moves the target, so re-pin and diff `custom-modes.json`.
8. **The page picks the mode up by itself.** The select, the knobs, the matched map and the
   Example buttons are all read from `custom-modes.json`; nothing in `custom.js` names a
   mode. `node explorer/bench/custom-counts.mjs` prints every number
   `explorer/style.test.mjs` pins that a new mode **or a re-keep** moves: modes in all and
   by tier, keeps and buttons offered (in a test title too), the keeps not offered,
   `UNREACHED` (the keeps no setting reaches), and brass-foam's palette set. Edit those,
   then run the test. `explorer/README.md`'s *Custom modes* names the counts once.
9. **Hold every Example to its button's native picture**, at 640x400 2×2.
   `custom-natives.mjs` draws each offered button with the sibling's `style render` at its
   place, palette and knobs (the published look, *Problems*, 2), a few seconds each: run it
   once, in one process, since `style render` rewrites its out directory's `renders.jsonl`
   and two at once corrupt it (every later render fails `JSONDecodeError`). Use fresh out
   directories (a stale id reads `NO NATIVE`). **Draw both sides at one pin**: the natives
   come from the sibling's `HEAD` as they run, the Node and page sides from the committed
   bundle, so a sibling commit mid-run is a miss; re-pin, then redraw that mode on
   both sides, its `<style>__*` files deleted first (`custom-natives.mjs` and
   `custom-browser.mjs` skip an id already drawn). Runs side by side are safe: each Chrome
   picks its own debugging port (`cdp.mjs`'s `open`).

   ```
   node explorer/bench/custom-natives.mjs out/natives                     # the references
   node explorer/bench/custom-parity.mjs out/parity --stack mode          # Node, the request path
   python -m builder serve --port 8000                                     # then, the page:
   node explorer/bench/custom-browser.mjs http://localhost:8000 out/browser --workers 3
   python explorer/bench/custom-compare.py out/parity  out/natives
   python explorer/bench/custom-compare.py out/browser out/natives --png
   ```

   The tolerance is identical, on Windows; a miss is a finding, except on a button opening
   with Auto tone off, which `custom-natives.mjs` names and skips: hold it to
   `wasm-parity`'s picture (`--stack keep` draws each keep's own stack against those). A
   miss only the browser run has (it presses each Example and saves through the Download
   row) is the page's. Look at its PNGs beside the keep JPEGs
   (`fractal-drive-sync/style-keeps/<style>/`) too. Every bench takes `--only`; the browser
   bench alone `--workers` and `--tier`; `custom-parity.mjs` splits with `--shard i/n`, `i` from 0 to n−1 (`n/n` is refused). A
   palette entry no Example opens on is held with `--palette <entry>` on the first two,
   drawn as `<id>@<entry>`. The browser bench waits on `#render-state`'s `data-busy`, held
   while a download has the controls, so a slow Example needs no timeout of its own.
10. **Release:** the site's usual checks (`CLAUDE.md`'s *Checks to run before committing*,
    and `builder check` with the checkout, reading its skips), then commit `style.wasm`,
    `custom-modes.json`, both manifests and whatever else moved; Pages serves the commit.

## What the explorer does with one

- **The record** is `custom-modes.json`, fetched once the first frame is asked for, or
  before it where the link names a mode (the link is read against it; so is a Saved entry,
  and the Saved tab waits for it); `style.wasm` is fetched the first time a custom mode
  draws. The select gains the tier entries when it lands; each lists its own tier.
- **The link** carries `custom=<public name>`, never the tier, `tuned=<map>` (one of the
  mode's palette set; the set's first, the mode's own map, is never written),
  `knobs=name:value,…` (defaults left out, in the mode's knob order), `matched=0`,
  `autotone=0`, and `projection=name:value,…` (a place's log-polar members), widening
  contract version 4. Under `custom` the engine mode's keys are read, checked, and dropped.
- **The palette set**: a mode's `palettes` (the row's kept maps, each with its tuned
  `values`, written over the stack before the knobs, as `styles.at_palette` does) is a row
  of swatches beside Matched palette, hidden for a set of one; a swatch or `[`/`]` switches
  and turns Matched palette on. The bundle writes the mode's own map first, kept or not,
  then each kept entry; that first entry is the default. An entry's `rests` are where an
  unset knob sits on it, which `knobRest` derives from the stack and `style.test.mjs` holds
  to the bundle.
  **A switch recolours**: the first worker keeps the frame its last pass measured, and the
  module's `recolour` re-measures it under the new entry without iterating; a knob or Auto
  tone switch at the same place, size and mode tries the same, and a stack reading channels
  the kept frame lacks is measured afresh (`StylePool.drawing`, `placeOf`). A palette
  already drawn at this view comes back from `explorer.js`'s `customDrawn`.
- **Old names**: a style merged into a published mode (the catalog row's `aliases`) still
  opens, as `custom=<old name>` read as the mode at the palette entry whose `was` it is
  (`style.js`'s `aliasesOf`), written back under the mode's name, once the sibling's `style
  bundle` writes `aliases` and `was`.
- **Matched palette** (on by default) draws with the chosen palette of the set, shows it on
  the strip, and holds every palette control. Off, the view's palette and Reverse reach the
  picture, the chosen entry's tuned values still holding; the stack's own palette layers
  set the rest.
- **Auto tone** (on by default) is the stack's `tone` pass; off drops it from the stack.
- **An Example button** opens the keep's place at 16:10, in the mode, at its defaults plus
  any setting that reproduces the keep's stack, on the keep's palette of the set.
- **Drawing** is a quarter-size picture (on the pool's last worker), then full-size tiles
  against its balance on every worker but the first, while the first takes the exact tone
  measure, shared (*Problems*, 5), and every worker draws the tiles again against it. The
  pool is half the machine's threads, one to `MAX_STYLE_WORKERS` (`style.js`'s `poolSize`);
  with one worker the steps run in turn. Downloads take the same pool, without the preview.
  **A mode with a post stage** (`post: true` in its `open` summary: tri-mosaic's lattice,
  the `rays` beams of starburst-veils and light-shafts) reads the whole frame, so the module
  refuses it a tile: the first worker draws it whole, beside the preview, landing after it
  (`StylePool.drawing`, the worker's `whole`). A new post kind needs only the rebuilt
  module. A lattice or a shaft's `center` is fixed to the frame, so a pan moves the
  fractal under it.
- **Memory**: the first worker keeps the whole measured frame, the rest the shared measure
  (eight bytes a sample per rank-spent layer) and their tiles; a wasm memory never shrinks.
  The budget counts every worker at the measurer's cost: a pass runs on as many as fit
  `PASS_MEMORY`, a download over `MAX_CUSTOM_SAMPLES` (`WORKER_MEMORY` at
  `BYTES_PER_SAMPLE`) is refused, workers are replaced after a download, and the pool is
  given back on leaving the custom modes (all in `explorer/style.js`). Measure a new mode
  with `node explorer/bench/custom-memory.mjs --only <mode>,…`; one above
  `BYTES_PER_SAMPLE` moves that constant.
- **Not offered** in the Deep tab, the Walk, or the gallery's facets; Saved labels a custom
  entry and does not draw its tile, and Download all leaves it out.

## Problems the first nine hit, and their fixes

Each is a rule the code holds; comments cite them by number.

1. **The pin must hold the module.** The pin moves on `STYLE_SOURCES` (`style-wasm/`,
   `engine/`) as well as on `engine.wasm`'s bytes and the perturbation kernel; `--style`
   refuses unpinned or dirty sources and records (`STYLE_RECORDS`, `style_pin_problem`),
   and the manifest fingerprints every source and record tree so `check` sees a stale
   module. A pin move can change `engine.wasm`'s bytes and `perturb.manifest.json`'s
   `kernel_tree` on a README edit.
2. **A shown keep drawn with a stack other than the published one**, reachable by a
   setting (a knob, or Auto tone off) or not. Ruling (Matt): a button draws the
   **published** look, plus the setting that reproduces its keep where one does; a button
   that would draw another button's picture is not offered; a button no setting reproduces
   says so on hover, and is held to a native render of the published settings at its
   place, not to the old keep. The cure is a wallpapers re-keep under the published stack
   (step 4).
3. **A place can carry projection members** (the tunnel's `twist`, `ring`, even `turns`),
   which no view has a field for. The `projection` key is set by an Example and kept
   through pans; a family change drops it. A place's `turns` overrides the knob
   (`styles.projected` lays it after the knobs), so the Turns slider is disabled there and
   says why. Members are written in name order and start with a letter (`__proto__` would
   set nothing).
4. **`custom` is not a render mode in the contract's sense.** `permalink.js`'s `MODES` is
   held to the baked catalog and the engine's roster; so `custom` has its own keys, and the
   select's entry is appended in `syncModes` only.
5. **A measure crosses workers only as its report.** One worker measures and posts
   `export_measure`'s bytes, the others `import_measure` them (wallpapers 083), so the pool
   pays one measure. A report names its picture (place, stack as drawn, map), so every
   worker opens the same request first. A small measure posted after an import would
   replace it, so the preview-balanced sweep posts none once the exact one is in.
6. **A wasm call cannot be interrupted.** A cancel replaces every worker inside a call; the
   module is compiled once and cloned in.
7. **Style maps missing from `palettes.bin`**: the bundle carries every map it names, and
   the strip and the request read them from there.
8. **The iteration cap.** The request always names a cap, the view's, else the explorer's
   width policy, since a link may drop `n` and the module would pick its own default.
9. **The Download row's price** is this view's last screen pass, "time unknown" (still
   enabled) before one has finished. A download takes the pool from the screen's pass,
   which is redrawn when the download ends, however it ends.
