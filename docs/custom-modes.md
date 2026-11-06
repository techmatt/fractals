# A custom mode, from a reference image to live in Mandelnaut

A **custom mode** is one of the wallpaper project's published styles: a stack of layers over
one orbit, drawn by that project's own compositor. Mandelnaut offers them under the render
mode **custom (experimental)**, and draws them with the same compositor compiled to
WebAssembly (`explorer/style.wasm`), so a picture in the explorer is the pipeline's picture
byte for byte. This is the whole path for the next one, across both repositories, and every
problem the first nine hit on the way (*custom_modes_explorer*, 2026-11-05).

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
   fractal (item 018's rule). A member the module must treat as a whole number has to be
   one of `INTEGER_MEMBERS` in `style-wasm/src/lib.rs` (`iterations`, `hit`, `settle`,
   `sectors`, `turns`); a new one is an edit there, with its test, **and the same edit to
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
   any module moved since the pin (`STYLE_SOURCES` and `perturbation/`), and rebuilds
   `engine.wasm` there: compare its bytes, and name in the report if they moved. `--style`
   refuses a sibling whose style sources or records are not the pinned trees, and writes the
   bundle with the sibling's own `style bundle`.
8. **The page picks the mode up by itself.** The select, the knobs, the matched map and the
   Example buttons are all read from `custom-modes.json`; nothing in `custom.js` names a
   mode. Run `node --test explorer/style.test.mjs`: these lines move with a new mode **or a
   re-keep** next door, its count of modes (9), its `UNREACHED` list of keeps no setting
   reaches, and in *each mode offers one button a picture* the offered count (22, in the
   title too), the duplicate it names as not offered (`lit_petals__1`), and its own list of
   offered buttons no setting reaches. (A dry run of step 7 at wallpapers `27e2178`, whose
   re-keep of brass-foam and soft-petals reaches every keep, failed exactly these.) `explorer/README.md`'s *Custom modes* names
   the 22 of 23 once; that is the one line of it a new mode moves, and nothing in the path
   needs the rest of that file.
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
   compare reads **every button no setting reproduces as a `MISS`** (today
   `bronze_packing__0`–`2` and `lit_petals__2`), because the button draws the published
   look and `wasm-parity` drew the keep's own stack: draw those with the `style render`
   line above into a directory of their own, as `<id>.native.png`, and compare just them
   against it. A miss on any other id is a finding.

   The tolerance is item 026's: identical on Windows. The first proves the link, the parse
   and the request reach the keep's own picture; the second presses each Example button
   and saves through the Download row, so a miss there that the first does not have is the
   page's. Look at the browser run's PNGs beside the keep JPEGs
   (`fractal-drive-sync/style-keeps/<style>/`) too.
10. **Release:** the site's usual checks (`CLAUDE.md`'s *Checks to run before committing*,
    and `builder check` with the checkout, reading its skips), then commit `style.wasm`,
    `custom-modes.json`, both manifests and whatever else moved. GitHub Pages serves the
    committed tree as it is; there is no other build.

## What the explorer does with one

- **The record** is `custom-modes.json`, read at boot before any link (a link may name a
  mode); `style.wasm` is fetched the first time a custom mode draws.
- **The link** carries `custom=<public name>`, `knobs=name:value,…` (defaults left out, in
  the mode's knob order), `matched=0`, `autotone=0`, and `projection=name:value,…` (a
  place's own log-polar members). A widening of contract version 4, not a 5. Under `custom`
  the engine mode's keys are read, held to their rules, and dropped.
- **Matched palette** (on by default) draws with the mode's own map, shows it on the strip,
  and holds every palette control. Off, the view's palette and Reverse reach the picture;
  nothing else of the palette row does, because the stack's own palette layers set the rest.
- **Auto tone** (on by default) is the stack's `tone` pass; off drops it from the stack.
- **An Example button** opens the keep's place at 16:10, in the mode, at its defaults plus
  whatever knob or Auto tone setting reproduces the keep's own stack.
- **Drawing** is a quarter-size picture, then full-size tiles against its balance, then the
  exact tone measure and the tiles again, on a pool of half the machine's threads (one to
  eight). Downloads take the same pool, without the preview.
- **Memory** (004_bug_hunt): every worker measures the whole frame, at 90 to 250 bytes a
  sample over the nine modes (`node explorer/bench/custom-memory.mjs`: `measure` then one tile
  on a fresh instance), and a wasm memory never shrinks. So a pass runs on as many workers as fit
  `PASS_MEMORY` (6 GiB) between them, a download over `MAX_CUSTOM_SAMPLES` (one worker's
  3.75 GiB at 256 bytes a sample, about 15.7 million samples) is refused in a sentence,
  every worker is replaced after a download, and the pool is given back when the reader
  leaves the custom modes. A mode much heavier than 256 bytes a sample moves
  `BYTES_PER_SAMPLE` in `explorer/style.js`.
- **Not offered** in the Deep tab, the Walk, or the gallery's facets; Saved labels a custom
  entry and does not draw its tile.

## Problems the first nine hit, and their fixes

1. **The pin did not hold the module.** `engine.manifest.json` pinned a wallpapers commit
   from before `style-wasm/` existed, and the bake's pin rule moved only on `engine.wasm`'s
   bytes or the perturbation kernel. *Fix:* the pin also moves on `STYLE_SOURCES`
   (`style-wasm/`, `engine/`); `--style` refuses unpinned or dirty sources and records
   (`style_pin_problem`). Moving it rebuilt `engine.wasm` 4 bytes longer (927,357 to
   927,361; the engine's sources had moved, and `panic = "abort"` keeps line numbers), the
   perturbation modules byte-identical, and `perturb.manifest.json`'s `kernel_tree` moved
   on a README edit alone.
2. **Twelve of the 23 shown keeps were drawn with a stack other than the published one.**
   Seven differ only in a name or in what a setting reaches (arch-tunnel's first keep is
   `turns` 3; silk-waves' three have no tone pass, which is Auto tone off; gilt-orbs' second
   is `orb_size` 0.3). Five no setting reaches: brass-foam's three (`tone.p10` 0.05, the
   published 0.099) and soft-petals' second and third (an older formulation; the second is
   the first's place, so the published settings draw the first's picture there). *Fix
   (Matt, item 003: ruling C, then MESSAGE #844):* a button shows the mode at a good place
   and draws the **published** look, plus the setting that reproduces its keep where one
   does; a button that would draw another button's picture is not offered (soft-petals'
   second; 22 buttons for 23 keeps); a button no setting reproduces says so on hover, and is
   held to a native render of the published settings at its place, not to the old keep.
   The four (`bronze_packing__0`–`2`, `lit_petals__2`) and the dropped `lit_petals__1` are
   parked for a wallpapers item to re-draw under the published stacks and save as new
   keeps (step 4).
3. **A place can carry projection members** (the tunnel's `twist`, `ring`, even `turns`),
   which no explorer view has a field for. *Fix:* the `projection` link key, set by an
   Example and kept through pans; a family change drops it. A location's `turns` overrides
   the knob, as `styles.projected` lays it after the knobs, so on arch-tunnel's third keep
   the Turns slider does nothing; it is disabled there and says why. Members are written in
   name order and must start with a letter (`__proto__` would set no member at all).
4. **`custom` cannot be a render mode in the contract's sense.** `permalink.js`'s `MODES` is
   held equal to the baked catalog and the engine's roster, and the Walk tab's roster is
   `listedModes()`. *Fix:* its own keys, and the select's entry appended in `syncModes` only.
5. **A measure cannot cross workers.** It lives in the module's session, so every worker
   measures the whole frame: the exact pass costs one frame's time on each worker at once.
   *Fix:* the preview-balanced tiles go up first, at a pool's share of one frame, so the
   full-detail picture is on the screen before the exact measure starts.
6. **A wasm call cannot be interrupted**, and the slowest modes take tens of seconds a
   frame. *Fix:* a cancel terminates every worker inside a call and starts a fresh one; the
   module is compiled once and cloned in, so the restart is milliseconds.
7. **Seventeen style maps are not in the explorer's `palettes.bin`**, the matched maps among
   them. *Fix:* the bundle carries every map it names, and the strip and the request read
   them from there.
8. **The iteration cap.** An example's `n` is dropped from its link where the width's own
   policy gives the same number, and the module would pick its own default for a location
   without one. *Fix:* the request always names a cap: the view's, else the explorer's
   width policy.
9. **The Download row priced every view off the engine's plan**, which a custom view has
   none of, and refused it. *Fix:* priced off the last screen pass of this very view (another
   mode's or knob's time is not this one's), and "time unknown" (still enabled) before one
   has finished. A download takes the pool from the screen's pass, which is drawn again
   when the download ends, however it ends.
10. **Saved would have drawn a custom link through the engine as plain smooth.** *Fix:* the
    tile is labelled and not drawn, like a deep one, and Download all leaves it out.
11. **The slow modes and a shared machine** (MESSAGE #840): a check run with six workers
    beside other work starved the box. *Fix:* the benches take `--workers`; the page's own
    pool is half the machine's threads.
12. **An adversarial review of the first draft** (four finders, four verifiers) confirmed
    fourteen defects, all fixed: the pin not moving on a catalog-only commit, `check` blind
    to a stale module after an engine-only move (the manifest now fingerprints every source
    and record tree), a half-drawn screen after a cancelled download, two filenames for one
    picture, a stale price, the screensaver and the Walk leaving the pool running, the Deep
    tab's palette buttons left grey, a failed tile not stopping the other workers, a failed
    respawn breaking the pool for good, a failed start leaking workers, a failed preview
    leaking a session, `__proto__` in a projection, and a refusal reading "a Auto tone".
