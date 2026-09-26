"""The pictures a reader meets at the site's two front doors: one explorer view each.

    python -m builder front [index-hero | packs-hero] --place

`index-hero` is the front page's. The view is a link Matt chose in the explorer
*(index_top_picture_ckpt141)*, transcribed here as the engine render spec it names and
never re-derived — the maker rule every other module in this package keeps. It is one
panel with a `spec`, so the link on the page comes off that spec through `links._view`
exactly as any split panel's does, and the picture a reader clicks is the one the explorer
opens.

`packs-hero` is the Wallpaper packs page's *(packs_image_and_mid_ckpt152)*: a link Matt
gave, frozen here as the string he sent and drawn from it by `fractal-engine render-link`,
which reads the contract's own keys, so nothing about it is transcribed at all. The link
spells one gallery seat's recipe exactly, and the panel says which, so the link on the page
comes off that seat and `check`'s `seats` holds the picture to the one the gallery ships.

No label, no caption on either. Each is what its page opens on, before anything is
explained, so the row carries no caption and the block carries no `<figcaption>`.
"""

from __future__ import annotations

from pathlib import Path

from . import figures as figures_module
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


PACKS_FIGURE = "packs-hero"

#: The Wallpaper packs page's view, as Matt sent it, less the address in front of the `?`.
PACKS_LINK = (
    "v=4&f=julia3&cx=0.4169190761394084&cy=0.006933824661843332&m=threads"
    "&x=-0.054828545370623066&y=0.017335365897850258&w=0.251946210734878"
    "&p=Cobalt%20Furnace%20Ultra&phase=0.95781"
)

#: The seat that link spells, recipe key and all: `builder.links` emits exactly PACKS_LINK
#: for it, which `links --write` confirms by landing the same string on the page.
PACKS_SEAT = "20260922T012627Z|5ff0ad6b8898db4b"

#: The size and sampling the page's previous picture was landed at.
PACKS_SIZE = (1292, 727)

PACKS_ALT = (
    "A degree-three Julia set in burnt orange and cobalt blue: a branching band of dark "
    "rust filigree, fanned with pale orange and curling into spirals at its edges, across "
    "a deep blue ground streaked with fine light threads."
)


def packs_hero() -> Split:
    """The Wallpaper packs page's picture, drawn from its link by the engine alone."""
    lossless = panel_path(PACKS_FIGURE, 1)
    report = renders.render_link(PACKS_LINK, lossless, PACKS_SIZE, SUPERSAMPLE)
    provenance = [
        "builder.front:packs_hero — one explorer link Matt gave (packs_image_and_mid_ckpt152), "
        f"drawn from the link by `fractal-engine render-link` at {PACKS_SIZE[0]}x"
        f"{PACKS_SIZE[1]}, supersample {SUPERSAMPLE}, and landed through "
        "images.import_web_res. The link is its whole recipe: no cap, so the depth policy's; "
        "no weight or sigma, so the contract's derived ones; no tone curve.",
        "Julia d = 3, threads: the link spells gallery seat "
        f"{PACKS_SEAT}, alias 5ff0ad6b, seat 203 of the general gallery — family julia, "
        "degree 3, c = 0.4169190761394084 + 0.006933824661843332i, centre "
        "-0.054828545370623066 + 0.017335365897850258i, width 0.251946210734878, mode "
        f"threads, colormap Cobalt Furnace Ultra, cap {report['maxiter']}; palette gamma 1, "
        "cycles 1, phase 0.95781, reverse false, transfer value, rolloff none.",
    ]
    return Split([Made(lossless, PACKS_ALT, seat=PACKS_SEAT)], provenance, 1)


SHEETS = {FIGURE: hero, PACKS_FIGURE: packs_hero}


def recipe(identifier: str) -> dict:
    if identifier not in SHEETS:
        raise FrontError(f"{identifier} is not drawn by builder.front")
    args = {"link": PACKS_LINK} if identifier == PACKS_FIGURE else {}
    return {"maker": f"{__name__}:{SHEETS[identifier].__name__}", "args": args}


def sources(identifier: str) -> list[dict]:
    if identifier == PACKS_FIGURE:
        return [{"kind": figures_module.GALLERY_SEAT, "keys": [PACKS_SEAT]}]
    return [{"kind": figures_module.SYNTHETIC, "keys": []}]


def draw(identifier: str) -> Split:
    return SHEETS[identifier]()
