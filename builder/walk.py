"""Placing the explorer's Walk tab assets: the two judges and the runtime that runs them.

The Walk tab scores what it renders with the pipeline's own two judges, exported to ONNX
by the judges lab, `tools/judges-lab/` in this repository (its `lab/export.py`; its README
says how to set it up). What the page loads is the
**fp16w** export of each: fp16 weight storage, a cast to fp32 at load, and fp32 compute,
which the lab measured at 3.6e-6 from PyTorch with no bar crossings on any backend. The
fp16-compute export is not shipped because it is the one that moves decisions.

**The fine head is one member, seed 0, by default** *(walk_tab_ckpt131_addendum1)*. The
pipeline's `p_fine` is the mean of three seeds; the page ranks on a single member's `P≥4`,
at a third of the download (5.1 MB against 15.3 MB). The fused three-seed graph can still
be placed with `--fused`. Either lands as `fine.onnx`, which is the one name the page
fetches, and both graphs answer `probs[2]` — the member's own `P≥4`, or the fused graph's
in-graph mean — so the page reads the same slot whichever is there.

Nothing here is committed. The models are 5.1 MB each and barely compress, and the
runtime's 28 MB of wasm is 6.7 MB gzipped on the wire, so they stay out of history the
way the palette blob and the gallery tiles do:
`.git/info/exclude` names `explorer/judges/`, and this command is what fills it. A tree
without them still serves a Walk tab, which runs on the screen gates alone and says so in
its console.

    python -m builder walk                     # from tools/judges-lab, seed 0
    python -m builder walk --fused             # the three-seed graph instead

**The lab lives here** *(walk_tune_ckpt131)*. It began as a checkout of its own beside this
one, which meant the Walk tab's judges could be rebuilt only on a machine that happened to
have kept it. Its scripts, frozen model definitions, measurements and report are tracked
under `tools/judges-lab/`. What they need and make is not tracked: the torch venv, the npm
packages, the weights, the exports and the samples. That working state sits in the same
directory and is kept out by `.gitignore`.
"""

import shutil
from pathlib import Path

from .paths import SITE_ROOT

#: Where the assets land, beside the page that fetches them.
JUDGES_DIR = SITE_ROOT / "explorer" / "judges"

#: The judges lab, in this repository.
LAB = SITE_ROOT / "tools" / "judges-lab"

#: The name the page fetches the fine head by, whichever graph is placed there.
FINE_TARGET = "fine.onnx"

#: The fine head's two sources in the lab: one member, or the three fused.
FINE_MEMBER = "models/fine.seed0.fp16w.onnx"
FINE_FUSED = "models/fine.fused.fp16w.onnx"

#: Everything else that is copied, as (path in the lab, path under `JUDGES_DIR`). The
#: runtime is onnxruntime-web's default bundle, whose WebGPU backend is JSEP and which
#: carries the WASM backend too: the lab's fidelity table was taken on that JSEP binary.
#: The `ort.webgpu` bundle is not it — in 1.30 that one loads the `asyncify` binary
#: instead, a different runtime nobody measured. The version is the lab's.
ASSETS = (
    ("models/render.fp16w.onnx", "render.fp16w.onnx"),
    ("node_modules/onnxruntime-web/dist/ort.min.mjs", "ort/ort.min.mjs"),
    (
        "node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.jsep.mjs",
        "ort/ort-wasm-simd-threaded.jsep.mjs",
    ),
    (
        "node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.jsep.wasm",
        "ort/ort-wasm-simd-threaded.jsep.wasm",
    ),
)

#: Names an earlier placement used, removed so a tree never holds a head the page ignores.
RETIRED = ("fine.fused.fp16w.onnx",)


class WalkError(Exception):
    """The lab checkout is missing something the Walk tab loads."""


def place(lab: Path = LAB, fused: bool = False) -> list[tuple[Path, int]]:
    """Copy every asset out of the lab into `explorer/judges/`, and say what landed."""
    assets = (*ASSETS, (FINE_FUSED if fused else FINE_MEMBER, FINE_TARGET))
    missing = [source for source, _ in assets if not (lab / source).is_file()]
    if missing:
        raise WalkError(
            f"{lab.relative_to(SITE_ROOT).as_posix()} is missing {', '.join(missing)}: the "
            "lab's `lab/export.py` writes the models and its `npm install` the runtime (see "
            "its README)"
        )
    landed = []
    for source, target in assets:
        destination = JUDGES_DIR / target
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(lab / source, destination)
        landed.append((destination, destination.stat().st_size))
    for name in RETIRED:
        (JUDGES_DIR / name).unlink(missing_ok=True)
    return landed
