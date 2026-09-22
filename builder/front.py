"""The front page's picture: one explorer view, drawn at the site's figure size.

    python -m builder front index-hero --place

The view is a link Matt chose in the explorer *(index_top_picture_ckpt141)*, transcribed
here as the engine render spec it names and never re-derived — the maker rule every other
module in this package keeps. It is one panel with a `spec`, so the link on the page comes
off that spec through `links._view` exactly as any split panel's does, and the picture a
reader clicks is the one the explorer opens.

No label, no caption. The picture is what the front page opens on, before anything is
explained, so the row carries no caption and the block carries no `<figcaption>`.
"""

from __future__ import annotations

from pathlib import Path

from . import renders
from .images import WEB_RES_MAX_WIDTH
from .locations import Made, Split, panel_path

#: The link as it was chosen, kept for the record: `v=3&f=julia4&cx=…&cy=…&x=…&y=…&w=…`
#: `&p=glowdon&phase=0.053`. No `m`, so the mode is the contract's first, smooth; no
#: `level`, so no tone curve; no cap, so the depth policy's.
HERO_SPEC = {
    "family": {"kind": "julia", "degree": 4, "c": ["0.44637678855595264", "0.6581861161102234"]},
    "viewport": {
        "center_re": "-0.0006944498037232774",
        "center_im": "-0.007170259608518661",
        "width": "0.644829668143998",
    },
    "mode": "smooth",
    "colormap": "glowdon",
    "palette": {"phase": 0.053},
}

#: Drawn at the width the site lands a figure at, so the one encoder only re-encodes it.
SIZE = (WEB_RES_MAX_WIDTH, WEB_RES_MAX_WIDTH * 9 // 16)
SUPERSAMPLE = 3

FIGURE = "index-hero"

ALT = (
    "A degree-four Julia set in yellow, orange and pale green on deep blue: a four-armed "
    "cross of filigree around a small dark center, with spirals curling off its edges."
)


class FrontError(RuntimeError):
    """The front page's picture cannot be drawn as its record describes it."""


def hero() -> Split:
    """The one picture, rendered losslessly into `artifacts/`; `--place` encodes it."""
    full = dict(HERO_SPEC, resolution=list(SIZE), supersample=SUPERSAMPLE)
    out = renders.default_cache_root() / "front" / f"{FIGURE}_{SIZE[0]}x{SIZE[1]}.png"
    rendered = renders.render(full, out)
    lossless = panel_path(FIGURE, 1)
    lossless.write_bytes(Path(rendered).read_bytes())
    family, view = HERO_SPEC["family"], HERO_SPEC["viewport"]
    provenance = [
        "builder.front:hero — one explorer view Matt chose, drawn at the site's figure size "
        "and landed through images.import_web_res.",
        f"fractal-engine render: family julia, degree {family['degree']}, "
        f"c = {family['c'][0]} + {family['c'][1]}i, "
        f"centre {view['center_re']} + {view['center_im']}i, width {view['width']}, "
        f"{SIZE[0]}x{SIZE[1]}, supersample {SUPERSAMPLE}, mode smooth, colormap glowdon, "
        "palette phase 0.053, maxiter auto (the depth policy), no tone curve",
    ]
    return Split([Made(lossless, ALT, spec=dict(HERO_SPEC))], provenance, 1)


SHEETS = {FIGURE: hero}


def recipe(identifier: str) -> dict:
    if identifier not in SHEETS:
        raise FrontError(f"{identifier} is not drawn by builder.front")
    return {"maker": f"{__name__}:{SHEETS[identifier].__name__}", "args": {}}


def draw(identifier: str) -> Split:
    return SHEETS[identifier]()
