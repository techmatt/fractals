"""The Escape-time fractals page's sheets of renders, drawn here rather than in `scratch/`.

**A figure's maker belongs in the repository.** The registry's `provenance` records how a
picture was made and is the answer to *where did this come from*; it is not a program, and
a redraw off it is archaeology. Forty-eight of the article's figures already have their
maker in this package, and the fourteen that named a script under ignored `scratch/` were
the exception — thirteen of those scripts are gone, which is how `escape-julia-map` came
to be patchable and not recomposable. This module is where that exception stops growing:
a sheet of engine renders for the Escape-time fractals page is composed here, tracked, and
runnable by anyone with the wallpapers checkout configured.

    python -m builder families escape-fractional-degrees

writes the asset into `assets/images/figures/` and prints the size to record in
`figures.jsonl`. Like `diagrams`, it is a **separate command from `build` and no part of
`check`**: the tile labels are rasterized through whatever font the machine has, so two
machines agree about the picture and not about its bytes. Unlike `diagrams`, it reaches
the engine next door, which is reading and lands in this repository's ignored `artifacts/`.

A frame here is transcribed from the figure's own registry row and never recomputed. The
frames were originally chosen by re-deriving the engine's framing rule per degree; that
derivation is the record's to describe, and a maker that re-derived it would be free to
answer differently and quietly move a picture nobody asked to move.
"""

from __future__ import annotations

from pathlib import Path

from . import renders, sheets
from .paths import FIGURE_IMAGES_DIR

#: The panel every sheet in this module is composed at, and the engine settings behind it.
PANEL = (432, 243)
SUPERSAMPLE = 3
COLORMAP = "twilight_shifted"

#: A degree's exponent, typeset. This page's own `escape-families` draws `z² + c` under the
#: Mandelbrot plane, so a fractional degree is written the same way rather than in
#: programmer notation *(Matt, 2026-09-06)*.
SUPERSCRIPT = {
    "0": "⁰",
    "1": "¹",
    "2": "²",
    "3": "³",
    "4": "⁴",
    "5": "⁵",
    "6": "⁶",
    "7": "⁷",
    "8": "⁸",
    "9": "⁹",
}

#: `escape-fractional-degrees`, one line per panel: degree, centre, width, and whatever the
#: label has to say past the formula. Transcribed off that figure's `provenance`.
#:
#: The last panel is the branch-cut close-up. It is the same degree as the panel above it,
#: so its label carries where it is looking as well as what it is looking at — the formula
#: alone would not say which of the two a reader is on.
FRACTIONAL = (
    ("2.1", "-0.65", "0.0", "4.3", ""),
    ("2.5", "-0.21", "0.0", "5.3", ""),
    ("2.9", "-0.03", "0.0", "5.3", ""),
    ("3.5", "0.09", "0.0", "4.9", ""),
    ("4.5", "-0.12", "0.0", "4.0", ""),
    ("3.5", "-0.60", "0.0", "0.6", ", ×8 into the cut"),
)


def formula(degree: str) -> str:
    """`z` raised to this degree, plus c — the label under a fractional-degree panel."""
    raised = "".join("·" if character == "." else SUPERSCRIPT[character] for character in degree)
    return f"z{raised} + c"


def _panel(index: int, degree: str, center_re: str, center_im: str, width: str) -> Path:
    """One fractional-degree plane, through the engine and into the ignored render cache."""
    spec = {
        "schema": 1,
        "family": {"kind": "fractional_multibrot", "degree": degree},
        "viewport": {"center_re": center_re, "center_im": center_im, "width": width},
        "resolution": list(PANEL),
        "supersample": SUPERSAMPLE,
        "mode": "smooth",
        "colormap": COLORMAP,
    }
    out = renders.default_cache_root() / "fractional" / f"{index}-d{degree}-w{width}.png"
    return renders.render(spec, out)


def fractional_degrees(destination: Path) -> tuple[int, int]:
    """Five fractional-degree planes and the seam close-up, three across."""
    panels = [
        (_panel(index, degree, center_re, center_im, width), formula(degree) + tail)
        for index, (degree, center_re, center_im, width, tail) in enumerate(FRACTIONAL)
    ]
    sheet, _ = sheets.panel_grid(panels, 3, panel=PANEL)
    sheet.save(destination, quality=88, subsampling=0)
    return sheet.size


#: Figure id to the file it writes and the maker that writes it.
SHEETS = {
    "escape-fractional-degrees": ("escape-fractional-degrees.jpg", fractional_degrees),
}


def draw(identifier: str) -> tuple[Path, int, int]:
    """Draw one sheet into the figures directory; return where it went and its size."""
    file, maker = SHEETS[identifier]
    destination = FIGURE_IMAGES_DIR / file
    width, height = maker(destination)
    return destination, width, height
