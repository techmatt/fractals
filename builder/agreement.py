"""Whether an atlas picture and the explorer link under it are the same picture.

The atlas lays a thumbnail the pipeline drew beside a link built from the record's recipe,
and a reader takes the two as one promise. Every other check of the atlas asks whether the
link is a well-formed link; *ckpt141* is what that costs. The ingest copied the engine's
`texture_weight` into the record, the link writer read the contract's `weight`, and 28
thumbnails opened in the explorer at the catalog's 0.85 over pictures drawn at their own
weights — a busier field where the card showed one clean spiral, with every structural
test green.

So this asks the question itself, in two halves:

* **members**, on every slot of every plane: the view the link parses back to, held member
  for member to the recipe the thumbnail was drawn from — `builder/agree.mjs` says which
  members and how a refusal the record owns is read. JavaScript, because the contract is.
* **pixels**, on a fixed sample: the explorer's own render of the link, through the
  committed wasm at the thumbnail's size and sampling, set beside the stored thumbnail.
  The sample is one slot per plane and spans the kinds of coloring the atlas carries. It
  runs with a **control**: the first sample slot with its mode parameters stripped, which
  is the ckpt141 defect on purpose, and which has to land outside the tolerance — a pixel
  half that cannot tell that link from the right one has stopped checking anything.

The pixel half needs three things a bare clone lacks, and says which by name: the staged
thumbnails, the untracked `explorer/palettes.bin`, and Pillow. The members half needs none.
"""

from __future__ import annotations

import json
import subprocess
from pathlib import Path

from . import atlas, explorer, images
from .paths import IMAGES_DIR, SITE_ROOT

AGREE = SITE_ROOT / "builder" / "agree.mjs"

#: Where the pixel half's renders land: this repository's ignored runtime tree.
OUT = SITE_ROOT / "artifacts" / "agreement"

#: The slots the pixel half draws, `plane/dot/slot` — the record's own names. One a plane;
#: every gallery slot here carries a mode parameter of its own, because a parameter is what
#: went missing once; and between them the colorings that carry one — the two angle
#: composites, clean and through a recorded tone curve, a curvature composite, a direct
#: trap's opacity and threshold — plus the escape-time field a location slot is drawn in.
#: Phoenix gives its location slot rather than its gallery one because every Phoenix
#: gallery slot costs 16-28 s in wasm and this whole sample costs about 9. A re-ingest that
#: renames one is a failure naming it, and the answer is a re-pick here, not a skip.
SAMPLE = (
    "mandelbrot/91/gallery",  # smooth_mean_angle, weight 0.332, clean: the ckpt141 slot
    "multibrot3/50/gallery",  # smooth_angle_min, weight 0.274, curved
    "multibrot4/30/gallery",  # direct_trap_multiply, opacity 0.6, threshold 0.2
    "multibrot5/74/gallery",  # smooth_mean_angle, weight 0.822, curved
    "multibrot6/9/gallery",  # smooth_curvature, weight 0.444, curved
    "phoenix/21/julia",  # smooth, a Phoenix location slot
)

#: The ckpt141 defect on the first sample slot, drawn on purpose.
CONTROL = f"{SAMPLE[0]}~bare"

#: The largest mean absolute difference, of 255 per channel, a right link may land at.
TOLERANCE = 20.0


def _agree(*arguments: str) -> object:
    completed = subprocess.run(
        ["node", str(AGREE), *arguments],
        capture_output=True,
        text=True,
        encoding="utf-8",
        cwd=str(SITE_ROOT),
    )
    if completed.returncode != 0:
        raise RuntimeError(completed.stderr.strip() or f"agree.mjs exited {completed.returncode}")
    return json.loads(completed.stdout)


def pixels_unaskable() -> str | None:
    """Why the pixel half cannot run on this machine, or `None` where it can."""
    if not images.available():
        return "Pillow is not installed here"
    if not explorer.PALETTES_BLOB.is_file():
        return "explorer/palettes.bin is untracked and has not been baked here"
    planes = {where.split("/")[0] for where in SAMPLE}
    if any(partition.name in planes for partition in atlas.staged_without_pictures()):
        return "the sample's thumbnails are staged and have not been landed on this machine"
    return None


def _files() -> dict[str, Path]:
    """Every slot's stored thumbnail, by address."""
    return {
        f"{partition.name}/{dot.id}/{name}": IMAGES_DIR / "atlas" / slot.file
        for partition in atlas.load_all().partitions
        for dot in partition.dots
        for name, slot in dot.slots.items()
    }


def _difference(rgba: Path, stored: Path, size: tuple[int, int]) -> float:
    """Mean absolute difference over the three colour channels, of 255."""
    from PIL import Image, ImageChops, ImageStat

    drawn = Image.frombytes("RGBA", size, rgba.read_bytes()).convert("RGB")
    with Image.open(stored) as held:
        shown = held.convert("RGB")
    if shown.size != drawn.size:
        raise RuntimeError(f"{stored.name} is {shown.size}, and the thumbnail size is {size}")
    return sum(ImageStat.Stat(ImageChops.difference(drawn, shown)).mean) / 3


def problems() -> list[str]:
    """Every slot whose link is not its picture, and every sampled one that draws otherwise."""
    try:
        members = _agree("members")
    except (RuntimeError, OSError, json.JSONDecodeError) as error:
        return [f"agree.mjs members: {error}"]
    found = list(members["problems"])
    if members["checked"] == 0:
        found.append("agree.mjs members read no slots, and a check of nothing passes everything")
    if pixels_unaskable() is not None:
        return found

    files = _files()
    missing = [where for where in SAMPLE if where not in files]
    if missing:
        return found + [
            f"the pixel sample names {where}, which the record does not" for where in missing
        ]
    try:
        drawn = _agree("draw", str(OUT), *SAMPLE, CONTROL)
    except (RuntimeError, OSError, json.JSONDecodeError) as error:
        return found + [f"agree.mjs draw: {error}"]
    for entry in drawn:
        where = entry["where"]
        stored = files[where.split("~")[0]]
        difference = _difference(Path(entry["rgba"]), stored, (entry["width"], entry["height"]))
        if where == CONTROL:
            if difference <= TOLERANCE:
                found.append(
                    f"{where}: the ckpt141 defect draws within {TOLERANCE} of the stored "
                    f"picture ({difference:.2f}), so the pixel half can no longer tell a "
                    "wrong link from a right one"
                )
        elif difference > TOLERANCE:
            found.append(
                f"{where}: the explorer draws this slot's link {difference:.2f} away from its "
                f"thumbnail (tolerance {TOLERANCE}) — {entry['query']}"
            )
    return found
