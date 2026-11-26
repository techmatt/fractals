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
   `turns`, `levels`, `arms`, `steps`, `spokes`); a new one is an edit there, with its test, **and the same edit to
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
9. **Hold every Example to its button's native picture**, at 640x400 2×2. `custom-natives.mjs`
   draws each offered button with the sibling's `style render` at its place, palette and
   knobs (the published look, so a button no setting reproduces is held to that, not its
   keep), a few seconds each; `wasm-parity`'s natives come only after its whole wasm half.
   Use fresh out directories: `custom-parity.mjs` appends, and a stale id reads `NO NATIVE`.
   **Never split `custom-natives.mjs` across processes into one out directory**: `style
   render` rewrites the directory's `renders.jsonl`, and two at once corrupt it (every
   later render fails `JSONDecodeError`); it takes a few seconds an Example, so run it once.
   **Draw both sides at one pin**: the natives come from the sibling's `HEAD` at the moment
   they run, the Node and page sides from the committed bundle, so a sibling commit landing
   mid-run (a knob added) reads as a whole-picture miss; re-pin, then redraw that mode on
   both sides. **Two `custom-browser.mjs` runs at once need distinct `--port`s**; without
   one the second refuses to start (`cdp.mjs`'s `open`).

   ```
   node explorer/bench/custom-natives.mjs out/natives                     # the references
   node explorer/bench/custom-parity.mjs out/parity --stack mode          # Node, the request path
   python -m builder serve --port 8000                                     # then, the page:
   node explorer/bench/custom-browser.mjs http://localhost:8000 out/browser --workers 3
   python explorer/bench/custom-compare.py out/parity  out/natives
   python explorer/bench/custom-compare.py out/browser out/natives --png
   ```

   A miss is a finding, except the one a button opening with Auto tone off has, which
   `custom-natives.mjs` names and skips: hold those to `wasm-parity`'s picture. `--stack
   keep` draws each keep's own stack instead, against `wasm-parity`'s natives.
   The tolerance is identical, on Windows. The first proves the link, the parse and the
   request reach the button's picture; the second presses each Example button and saves
   through the Download row, so a miss there that the first does not have is the page's.
   Look at the browser run's PNGs beside the keep JPEGs
   (`fractal-drive-sync/style-keeps/<style>/`) too. Every bench takes `--only`; the
   browser bench alone takes `--workers` and `--tier`, and `custom-parity.mjs` splits with
   `--shard i/n`: on a shared machine keep the workers low, or split the run. A palette entry no
   Example opens on is held with `--palette <entry>` on `custom-natives.mjs` and
   `custom-parity.mjs` (`--stack mode`), which draw each of its mode's Examples on it as
   `<id>@<entry>`. The browser bench waits on `#render-state`'s `data-busy`, which the page
   holds while a download has the controls, so a slow Example needs no timeout of its own.
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
  Matched palette on. The bundle leaves out a map with no keeps, the default among them;
  `palettesOf` puts a keepless default back first where an Example opens on it
  (chrome-orbs), and otherwise the set's first entry is the default (neon-loops).
  **A switch recolours**: the pool's first worker keeps the frame its
  last finished pass measured, and the module's `recolour` re-takes the measures under the
  new entry from it without iterating, then the pool draws the tiles again; a switch of
  anything else that leaves the place, size and mode alone (a knob, Auto tone) tries the
  same, and the module refuses one whose stack reads channels the kept frame did not
  gather, which is then measured afresh (`StylePool.drawing`, `placeOf`). A palette already
  finished at this view and size comes back at once from the page's picture cache
  (`explorer.js`'s `customDrawn`, bounded by `CUSTOM_DRAWN_BYTES`).
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
- **Drawing** is a quarter-size picture (on the pool's last worker), then full-size tiles
  against its balance on every worker but the first, while the first takes the exact tone
  measure; that measure is shared (`export_measure`, `import_measure`), and every worker
  draws the tiles again against it. The pool is half the machine's threads, one to
  `MAX_STYLE_WORKERS` (`style.js`'s `poolSize`); with one worker the steps run in turn.
  Downloads take the same pool, without the preview. **A mode with a post stage** (its `open` summary says `post: true`, tri-mosaic's
  lattice, the `rays` beams of starburst-veils and light-shafts) reads the whole frame, so
  the module refuses it a tile: it is drawn whole in one pass on the first worker, beside
  the preview (after it, with one worker), and lands once the preview has
  (`StylePool.drawing`, the worker's `whole`). A new post kind next door needs
  nothing here beyond the rebuilt module. A lattice or a shaft's `center` is fixed to the
  frame, so a pan moves the fractal under it.
- **Memory**: the first worker measures the whole frame and keeps it for a recolour, the
  rest hold the shared measure (eight bytes a sample for each rank-spent layer) and their
  tiles, and a wasm memory never shrinks. The budget still counts every worker at the
  measurer's cost, from when each measured the frame: a pass runs on as many workers as fit
  `PASS_MEMORY` between them, a download over
  `MAX_CUSTOM_SAMPLES` (one worker's `WORKER_MEMORY` at `BYTES_PER_SAMPLE`) is refused in a
  sentence, every worker is replaced after a download, and the pool is given back when the
  reader leaves the custom modes; all four constants are in `explorer/style.js`. A new mode
  is measured with `node explorer/bench/custom-memory.mjs --only <mode>,…` (`measure` then one tile on a
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
5. **A measure crosses workers only as its report.** It lives in the module's session; one
   worker measures and posts `export_measure`'s bytes, and the others `import_measure` them
   (wallpapers 083), so the pool pays one measure, beside the preview-balanced tiles. A
   report names its picture (place, stack as drawn, map), so every worker opens the same
   request first. A small measure posted after an import would replace it, so the
   preview-balanced sweep posts none once the exact measure is in.
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
