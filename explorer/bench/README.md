# explorer/bench

Harnesses run in neither `builder check` nor CI; each is started by hand, and most say how atop.
A browser harness's Chrome picks its own debugging port by default (port 0, in `cdp.mjs`'s
`open` and `hunt/lib.mjs`'s `Page`), except the hunt units, `showcase.mjs`, and the
deep-gpu-agree/time/lose/same harnesses, which name ports.

"Serve" means `python -m builder serve` must be up (port 8000 unless the harness takes another);
"sibling" means the wallpapers checkout at `C:\Code\fractal-wallpapers`; "records" means
`record()` in `output.mjs`, which writes `artifacts/explorer-bench/<name>.json`.

## Shared modules

- `engine.mjs` — Node wrapper over `engine.wasm` (the calls `render.js` makes). Imported by
  kernel, cut, families, level, modes, sweep, curves; tests bands, deep, derive, level; builder
  agree, deep_gallery_shade, dive_candidates_shade, julia_dives_shade, phoenix_points,
  zoom_palette, zoom_shade.
- `perturb.mjs` — Node wrapper over `perturb.wasm` (the calls `deep-render.js` makes). Imported
  by julia, orbit-parity, perturb-parity/pool/speed, gpu-probe-cpu; tests deep, deep-gpu;
  builder deep_figures, zoom_fields.
- `cdp.mjs` — headless Chrome over CDP, no `node_modules`: launch, send, evaluate, screenshot.
  Imported by the browser harnesses here and by `builder/screenshot.mjs`; no test.
- `output.mjs` — `record()`, writing `artifacts/explorer-bench/`. Imported by harnesses here
  only.
- `visible.mjs` — stage 2's visible-pixel rule (1% matches, 5% acceptable) on two RGBA rasters.
  Imported by deep-gpu-agree, deep-gpu-downloads, deep-gpu-time.

## Custom modes

- `custom-counts.mjs` — every number `style.test.mjs` pins about `custom-modes.json`; node;
  prints, writes nothing.
- `custom-memory.mjs` — wasm memory a worker grows to per custom mode; node; prints.
- `custom-parity.mjs` — each mode's examples drawn through the page's request path; node;
  writes `<id>.rgba` and `results.jsonl` to an out dir.
- `custom-natives.mjs` — the native picture of each offered Example via the sibling's
  `style render`; node; needs the sibling and its `.venv`; writes `<id>.native.png` to an out
  dir.
- `custom-browser.mjs` — each mode's examples downloaded through the served page's Download row;
  Chrome over `cdp.mjs`; takes a base URL (serve); writes PNGs, `page.png`, and `browser.jsonl`
  to an out dir.
- `custom-speed.mjs` — a custom pass stage by stage, a palette switch, and a download, per
  mode; Chrome over `cdp.mjs`; serve (base URL); appends to an out `.jsonl`.
- `custom-compare.py` — holds parity's or browser's pictures to the natives byte for byte;
  Python with Pillow; prints, exits 1 on a miss.

## Deep tab and GPU

- `deep-gpu-frames.mjs` — data only: the frames, ladder, and seeded sample the deep-gpu
  harnesses draw.
- `deep-gpu-agree.mjs` — GPU kernel's picture against the CPU kernel's per frame; Chrome over
  `cdp.mjs`; serve; GPU (skips by name without one); records.
- `deep-gpu-time.mjs` — what a reader waits for, GPU against CPU, frame by frame; Chrome over
  `cdp.mjs`; serve; GPU; records after every frame.
- `deep-gpu-lose.mjs` — a forced lost device and what is on screen and held after; Chrome over
  `cdp.mjs`; serve; GPU; records.
- `deep-gpu-downloads.mjs` — Deep downloads on GPU against CPU through the Download row; Chrome
  over `cdp.mjs`; serve; GPU; records to `--out`.
- `deep-gpu-compile.mjs` — GPU kernel compile cost per entry point, cold and warm; Chrome over
  `cdp.mjs`; serve; GPU; records.
- `deep-gpu-check.mjs` — drives `gpu-probe/kernel-check.html` (shipped kernel against its
  model); Chrome over `cdp.mjs`; serve; GPU; reads `artifacts/deep-gpu-check/`; prints, or
  `--out`/`--json` files.
- `deep-same.mjs` — the final picture across two servers or two ways of arriving, exactly;
  Chrome over `cdp.mjs`; serve (two ports in `servers` mode); GPU under `--kernel=gpu|ticked`;
  records.
- `deep-stall.mjs` — a recolour lands after tints, Cancel, undo, and zoom (CPU kernel); Chrome
  over `cdp.mjs`; serve; prints.
- `deep-supersede.mjs` — Auto-render entry, and new input superseding a pass in flight; Chrome
  over `cdp.mjs`; serve; records.
- `gpu-probe.mjs` — drives `gpu-probe/index.html`: the adapter, double-single arithmetic, and
  the kernel timed; Chrome over `cdp.mjs`; serve; GPU; reads `artifacts/gpu-probe/`; prints,
  or `--out`/`--json` files.
- `gpu-probe-cpu.mjs` — the probe's CPU half: `perturb.wasm` timed on the same bundles; node
  with worker threads; reads `artifacts/gpu-probe/`; prints.
- `gpu-probe/` — the two bench pages and their WGSL (`index.html` with `probe.js`,
  `kernel-check.html` with `kernel-check.js`); browser, served; driven by the two above.

## Kernel and engine

- `kernel.mjs` — the field kernel on one thread at 1280x720; node; records.
- `modes.mjs` — each mode's field and shade cost, optionally against a second module; node;
  records.
- `families.mjs` — each family's `smooth` cost, optionally against a generic-loop build;
  node; records.
- `sweep.mjs` — every family and mode draws, and not a flat rectangle; node; records.
- `cut.mjs` — frame cost as a function of band count; node; records.
- `level.mjs` — the tone operator's cost split from the coloring's; node; records.
- `curves.mjs` — every colormap through four tone curves, hashed, to diff two modules; node;
  needs the sibling's `data/palettes`; prints.
- `julia.mjs` — a Julia frame's cost against its Mandelbrot frame; node; records.
- `orbit-parity.mjs` — two `perturb.wasm` builds compute one reference orbit byte for byte,
  `--time` to time them; node; `--new` defaults to the local `perturb-wasm` release build;
  prints.
- `perturb-parity.mjs` — two `perturb.wasm` builds held byte for byte over the sibling's
  `parity-specs.jsonl`; node; needs the sibling; prints.
- `perturb-speed.mjs` — single-thread ns per sample-iteration of one or more builds; node;
  prints.
- `perturb-pool.mjs` — pool throughput of the perturbation kernel; node with worker threads;
  prints.

## Page

- `page.mjs` — the page's wall time split into stages (ladder, edits, cancel, load); Chrome
  over `cdp.mjs`; serve (port as last argument); records.
- `walk.mjs` — what Walk tab walks cost over many walks; Chrome over `cdp.mjs`; serve; records,
  and `shots` writes `artifacts/explorer-bench/walk-shots/`.
- `showcase.mjs` — the showcase video captured from the real UI; Chrome over `cdp.mjs` on
  debugging port 9470 by default; serve on 8000; Python's `imageio_ffmpeg`; writes to an out
  dir, `scratch/showcase/` by default.
- `link-fidelity.mjs` — the link each action writes, opened fresh, draws the same canvas;
  `hunt/lib.mjs`'s `Page`; serve; records, exits non-zero on a mismatch.
- `recolour-race.mjs` — a page at rest shows the picture its own link opens, under color
  changes fired at page moments; `hunt/lib.mjs`'s `Page`; serve; records.
- `hunt/` — the bug hunt: `lib.mjs`'s `Page` (a second CDP client with a watchdog and a
  witness log), `smoke.mjs`, units `u1`–`u11`, and `probe-*` regression probes; serve (`PORT`
  moves it); units record findings, the rest see header.
