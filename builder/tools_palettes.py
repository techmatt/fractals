"""`tools-palettes`: every hand-made palette as one thin strip, sorted by hue.

    python -m builder tools tools-palettes

*(tools_figures_ckpt156.)* The Tools and data page offers the hand-made palettes as a file,
and this is the picture of that file: all of them at once, no names, in the library's hue
order. It is a composite and deliberately so — the juxtaposition is the point, and 495
separate links would be silly — so the maker hands back one `Made` whose path is the
composed sheet.

**Drawn from committed records only**, so a clone redraws it without the checkout next
door: the roster and each palette's hue are `palettes/library.jsonl`'s `authored` rows, and
the stops are `tools-and-data/hand-made-palettes.json`. That is a departure from
`builder/palettes.py`'s rule that a strip is drawn by the engine's `palettes strip`, and it
is taken on purpose: the file is what the page offers, so the picture of it is drawn from
it. The ramp is sampled the way the engine bakes a map — linear interpolation in Oklab
between neighbouring stops, through the engine's own copy of Ottosson's matrices
(`engine/src/colormap.rs`), transcribed below — at each pixel's centre. There is no
percentile stretch, because no field is being colored: a strip here runs from position 0
to position 1 exactly.

**The order is a rule, never a pick**: the library's hue family in wheel order
(`palettes.HUES`), then mean Oklab L over the palette's stored stops, dark to light, then
the library name. The strips run down each column and then on to the next, so a column
reads as a stretch of the wheel.
"""

from __future__ import annotations

import json

from . import palettes, sheets
from .figures import SYNTHETIC
from .locations import SHEET_WIDTH, Made, Split, sheet_path
from .paths import SITE_ROOT

ID = "tools-palettes"

#: One composed sheet, landed as a composited figure (`builder/tools.py`'s `composite`).
COMPOSITE = True

#: The stops the page offers, one palette a line.
STOPS = SITE_ROOT / "tools-and-data" / "hand-made-palettes.json"

#: The grid: eight columns of thin strips. Every length is even, so a 4:2:0 encode never
#: averages a strip's chroma into the well around it.
COLUMNS = 8
STRIP = (150, 8)
ROW_GAP = 4
COLUMN_GAP = 12


class ToolsPalettesError(RuntimeError):
    """The two records do not agree about which palettes are hand-made."""


# ------------------------------------------------------------------------------ Oklab

#: `engine/src/colormap.rs`, `linear_srgb_to_oklab` and `oklab_to_linear_srgb`.
TO_LMS = (
    (0.4122214708, 0.5363325363, 0.0514459929),
    (0.2119034982, 0.6806995451, 0.1073969566),
    (0.0883024619, 0.2817188376, 0.6299787005),
)
LMS_TO_LAB = (
    (0.2104542553, 0.7936177850, -0.0040720468),
    (1.9779984951, -2.4285922050, 0.4505937099),
    (0.0259040371, 0.7827717662, -0.8086757660),
)
LAB_TO_LMS = (
    (1.0, 0.3963377774, 0.2158037573),
    (1.0, -0.1055613458, -0.0638541728),
    (1.0, -0.0894841775, -1.2914855480),
)
LMS_TO_RGB = (
    (4.0767416621, -3.3077115913, 0.2309699292),
    (-1.2684380046, 2.6097574011, -0.3413193965),
    (-0.0041960863, -0.7034186147, 1.7076147010),
)


def _to_oklab(srgb8):
    """sRGB8 rows, `(n, 3)`, to Oklab rows."""
    import numpy as np

    c = np.asarray(srgb8, dtype=np.float64) / 255.0
    linear = np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
    lms = np.cbrt(linear @ np.asarray(TO_LMS).T)
    return lms @ np.asarray(LMS_TO_LAB).T


def _to_srgb8(lab):
    """Oklab rows to sRGB8 rows, clamped the way the engine's `linear_to_srgb` clamps."""
    import numpy as np

    lms = (lab @ np.asarray(LAB_TO_LMS).T) ** 3
    linear = np.clip(lms @ np.asarray(LMS_TO_RGB).T, 0.0, 1.0)
    c = np.where(linear <= 0.0031308, linear * 12.92, 1.055 * linear ** (1 / 2.4) - 0.055)
    return np.clip(np.rint(c * 255.0), 0, 255).astype(np.uint8)


def _rgb(stop: str) -> tuple[int, int, int]:
    return int(stop[1:3], 16), int(stop[3:5], 16), int(stop[5:7], 16)


# ------------------------------------------------------------------------ the roster


def roster() -> list[dict]:
    """Every hand-made palette in the figure's order, with its hue and mean lightness."""
    authored = {
        held.name: held.hue for held in palettes.held_library() if held.source == palettes.AUTHORED
    }
    stored = {
        str(entry["name"]): entry["stops"]
        for entry in json.loads(STOPS.read_text(encoding="utf-8"))["palettes"]
    }
    if set(authored) != set(stored):
        only_library = sorted(set(authored) - set(stored))[:5]
        only_file = sorted(set(stored) - set(authored))[:5]
        raise ToolsPalettesError(
            f"library authored and the palettes file disagree: {only_library} / {only_file}"
        )
    wheel = {hue: index for index, hue in enumerate(palettes.HUES)}
    unknown = sorted({hue for hue in authored.values() if hue not in wheel})
    if unknown:
        raise ToolsPalettesError(f"hues outside the wheel: {unknown}")
    rows = []
    for name, hue in authored.items():
        lab = _to_oklab([_rgb(stop) for stop in stored[name]])
        rows.append({"name": name, "hue": hue, "lab": lab, "mean_l": float(lab[:, 0].mean())})
    rows.sort(key=lambda row: (wheel[row["hue"]], row["mean_l"], row["name"]))
    return rows


def _ramp(lab, width: int):
    """One strip's pixels: the stops sampled at each pixel's centre, Oklab-linear."""
    import numpy as np

    last = len(lab) - 1
    at = (np.arange(width) + 0.5) / width * last
    low = np.floor(at).astype(int)
    high = np.minimum(low + 1, last)
    share = (at - low)[:, None]
    return _to_srgb8(lab[low] * (1 - share) + lab[high] * share)


# ------------------------------------------------------------------------ the figure


def layout(count: int) -> tuple[int, tuple[int, int], int]:
    """Rows per column, the sheet's size, and the left margin that centres the grid."""
    rows = -(-count // COLUMNS)
    grid = COLUMNS * STRIP[0] + (COLUMNS - 1) * COLUMN_GAP
    left = (SHEET_WIDTH - grid) // 2
    height = 2 * sheets.PAD + rows * STRIP[1] + (rows - 1) * ROW_GAP
    return rows, (SHEET_WIDTH, height), left


def make() -> Split:
    import numpy as np
    from PIL import Image

    ordered = roster()
    rows, size, left = layout(len(ordered))
    sheet, _ = sheets.canvas(*size)
    for index, row in enumerate(ordered):
        column, place = divmod(index, rows)
        x = left + column * (STRIP[0] + COLUMN_GAP)
        y = sheets.PAD + place * (STRIP[1] + ROW_GAP)
        line = _ramp(row["lab"], STRIP[0])
        block = np.repeat(line[None, :, :], STRIP[1], axis=0)
        sheet.paste(Image.fromarray(block, "RGB"), (x, y))
    path = sheets.save(sheet, sheet_path(ID))
    made = Made(path, alt=alt(len(ordered)))
    return Split([made], provenance(ordered, rows), 1)


def alt(count: int) -> str:
    return (
        f"{count} thin gradient strips in {COLUMNS} columns, one for each hand-made palette, "
        "read down each column and across, running round the color wheel from rose in the "
        "first column to magenta in the last."
    )


def provenance(ordered: list[dict], rows: int) -> list[str]:
    head = [
        "No render: every strip is drawn in Python from the committed stops in "
        "tools-and-data/hand-made-palettes.json (512 evenly spaced sRGB stops each, cyclic), "
        f"{STRIP[0]}x{STRIP[1]} px, each pixel the stops at its centre interpolated linearly "
        "in Oklab through the engine's own matrices (engine/src/colormap.rs, Ottosson's "
        "Oklab), with no percentile stretch. Made by builder/tools_palettes.py.",
        f"The roster is every row of palettes/library.jsonl whose source is authored: "
        f"{len(ordered)} palettes. Order: the row's hue in wheel order "
        f"({', '.join(palettes.HUES)}), then mean Oklab L over the palette's 512 stored stops, "
        "dark to light, then name. Strips run down each column, then on to the next: "
        f"{COLUMNS} columns of {rows}, the last one short.",
        f"The representative strip is the first, top of the first column: colormap "
        f"{ordered[0]['name']}.",
    ]
    lines = []
    for hue in palettes.HUES:
        members = [row for row in ordered if row["hue"] == hue]
        if not members:
            continue
        named = ", ".join(f"palette {row['name']}" for row in members)
        lines.append(f"{hue}, {len(members)}, in order: {named}.")
    return head + lines


def sources() -> list[dict]:
    return [{"kind": SYNTHETIC, "keys": []}]


def recipe() -> dict:
    return {"maker": f"{__name__}:make", "args": {}}
