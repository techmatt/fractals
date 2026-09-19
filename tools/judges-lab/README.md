# The judges lab

It asks whether the fractal wallpapers project's two shipped judges run in a browser. Those
are the render judge (`p_ge4`/`p_ge3`) and the gallery-grade fine head (`p_fine`). The
answer, and the fidelity table behind it, is in `REPORT.md`. It is also where the explorer's
Walk tab gets its judges: `lab/export.py` writes the ONNX graphs, and
`python -m builder walk` places them beside the page, with the runtime out of this lab's
`node_modules`.

The lab began as a checkout of its own, `fractal-judges-lab` (one commit, `3ae000d`), and
moved into this repository with `walk_tune_ckpt131`. It reads the wallpapers project and
never writes to it. Where that checkout is, and which disk each part of its artifacts tree
is on, comes from this repository's `local.toml` through `builder.renders.artifact`, so no
absolute path is written here.

```
lab/sample.py      ~120 real candidate pictures from the wallpapers ledger (read-only)
lab/judges.py      the two judges rebuilt from their fp16 artifacts; preprocessing spelled out
lab/reference.py   the PyTorch reading (+ artifacts/inputs.u8, the PIL-prepared inputs)
lab/export.py      ONNX export: fp32, fp16, fp16w (fp16 storage, fp32 compute)
lab/fidelity.py    every reading against PyTorch -> measured/table.md
lab/retime.py      one command to re-take every timing on an idle box
lab/serve.py       local server, optionally cross-origin isolated
web/resize.mjs     PIL's bicubic resize, ported to JS byte for byte
web/core.mjs       the benchmark, shared by Node and the browser
web/node-run.mjs   onnxruntime-node (CPU, DirectML)
web/bench.html     one configuration in onnxruntime-web
web/browser-run.mjs  Chrome over CDP through every configuration
```

**What is tracked and what is not.** Tracked, about 658 KB (2026-09-19): the scripts, `samples.jsonl`, the raw
readings in `results/`, the tables and reference readings in `measured/`, and `REPORT.md`.
Not tracked, and kept out by the root `.gitignore`: `.venv/`, `node_modules/`, `weights/`,
`models/`, `samples/`, and `artifacts/`, which holds the large inputs (`inputs.u8`,
`full.u8`). The lab's own measurements are in `measured/` rather than `artifacts/` for that
reason: this repository ignores every directory named `artifacts/`.

Setup, from this directory: `uv venv .venv --python 3.12`, then `torch` (CPU),
`timm==1.0.28`, `pillow==12.3.0`, `onnx`, `onnxruntime`, `onnxconverter-common`,
`onnxscript`, `scipy`; then `npm install`. Copy the weights into `weights/` from the
wallpapers checkout (tag `weights-2026-09-14`), and check their sha256 against that
checkout's `models/weights.json`. Order: sample, reference, export, then `retime.py`. Every script runs
from this directory with the venv's Python, e.g. `.venv\Scripts\python.exe lab\export.py`.
