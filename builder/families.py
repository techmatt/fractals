"""The Escape-time fractals page's sheets of engine renders.

**A figure's maker belongs in the repository.** The registry's `provenance` records how a
picture was made and is the answer to *where did this come from*; it is not a program, and
a redraw off it is archaeology. Most of the article's figures already had their maker in
this package, and the fourteen that named a script under ignored `scratch/` were the
exception — thirteen of those scripts had been lost, which is how `escape-julia-map` came
to be patchable and not recomposable *(Matt, 2026-09-06)*. They are recovered and brought
in here and in the modules beside this one.

    python -m builder families escape-julia-map

writes the asset into `assets/images/figures/` and prints the size to record in
`figures.jsonl`. Like `diagrams`, it is a **separate command from `build` and no part of
`check`**: the tile labels are rasterized through whatever font the machine has, so two
machines agree about the picture and not about its bytes. Unlike `diagrams`, it reaches
the engine next door, which is reading, and every byte of it lands in this repository's
own ignored `artifacts/`.

A frame here is transcribed from the figure's own registry row and never recomputed. The
fractional-degree frames, for instance, were originally chosen by re-deriving the engine's
framing rule per degree; that derivation is the record's to describe, and a maker free to
re-derive it is a maker free to answer differently and quietly move a picture nobody asked
to move.
"""

from __future__ import annotations

import json
from pathlib import Path

from . import figures as figures_module
from . import picks, renders, sheets
from .locations import Made, Split, panel_path
from .sheets import MIDDOT, MINUS, PAD, canvas, complex_text
from .theme import MARK_INK


class FamilyError(RuntimeError):
    """A sheet on this page cannot be drawn as its record describes it."""


#: The neutral map every panel on this page is drawn in.
COLORMAP = renders.COLORMAP
SUPERSAMPLE = 3

#: `.gitattributes` normalizes this repository to LF, so anything that writes a file
#: spells the line ending rather than taking the platform's.
LF = "\n"

#: What a family row's name puts between the family and the formula it runs. Drawn into
#: the sheet it was invisible to the em-dash sweep; as page text the two halves are a
#: label and its note, and the separator is the stylesheet's.
NAME_SPLIT = " — "


def _panel(name: str, spec: dict, size: tuple[int, int], *, supersample: int = SUPERSAMPLE) -> Path:
    """One render, keyed on the name the caller chose, under the ignored render cache.

    Name-keyed rather than spec-keyed, which is what `renders.Cache` does: these panels
    are the ones the committed sheets were composed from, and a name is what lets a rerun
    find the picture already on disk rather than pay for it again.
    """
    full = dict(spec, resolution=list(size), supersample=supersample)
    full.setdefault("colormap", COLORMAP)
    out = renders.default_cache_root() / "families" / f"{name}_{size[0]}x{size[1]}.png"
    return renders.render(full, out)


def _paste(sheet, path: Path, origin: tuple[int, int]) -> None:
    from PIL import Image

    with Image.open(path) as picture:
        sheet.paste(picture.convert("RGB"), origin)


def ink_text(colour: tuple[int, int, int]) -> str:
    """One of the mark inks as the page spells a colour. See `figures.Panel.ink`."""
    return "#{:02X}{:02X}{:02X}".format(*colour)


#: The constants the engine draws a bare `phoenix` at, read off its own render echo
#: rather than assumed: `c = 0.5667 + 0.0i`, `p = -0.5 + 0.0i`, `z_prev = 0`. A maker may
#: leave them out and get this picture; a **link** may not, because the contract has no
#: default to fall back on and an absent constant is zero to it — which is a different
#: Phoenix set and a plausible-looking one. So a record spells them.
PHOENIX_DEFAULT = {
    "kind": "phoenix",
    "c": ["0.5667", "0.0"],
    "p": ["-0.5", "0.0"],
    "z_prev": ["0.0", "0.0"],
}

#: The families whose identity is a set of complex constants, so that a record of one
#: which names none is a record of the origin and not of the picture.
CONSTANT_FAMILIES = ("julia", "phoenix")


def home_spec(family: dict, colormap: str = COLORMAP, **extra) -> dict:
    """A whole-set panel's record: the family, the frame the engine puts it in, the map.

    The frame is asked for rather than left out. A link carries a place, and *home* is a
    place the contract can leave unsaid only once it knows what home is — so the record a
    panel lands with says where the picture actually was, and the contract drops the
    coordinates again if they turn out to be the family's own.

    A family whose identity is its constants has to spell them. The engine fills a bare
    `phoenix` in with the classic constants and the link derivation cannot: an absent
    constant is the origin to it, and the origin is a different Phoenix set that draws a
    perfectly plausible picture. Caught here rather than looked at later, because the
    symptom is a link that works.
    """
    if family.get("kind") in CONSTANT_FAMILIES and not family.get("c"):
        raise FamilyError(
            f"a {family['kind']} panel's record has to name its constants — the engine "
            "fills them in and a link cannot. See PHOENIX_DEFAULT."
        )
    return {
        "family": family,
        "viewport": renders.home_view(family)["viewport"],
        "mode": "smooth",
        "colormap": colormap,
        **extra,
    }


# --------------------------------------------------------------------------- zoom strip

ZOOM_CENTRE = ("-0.8038460387836429", "0.18284000541838608")
ZOOM_HOME = 4.4
ZOOM_STEP = 4
ZOOM_FRAMES = 9
ZOOM_PANEL = (432, 243)


ZOOM_COLUMNS = 3


def zoom_strip() -> Split:
    """Nine frames into one location, each four times narrower than the last.

    **Nine pictures rather than one** *(figure_split_all_ckpt140, 2026-09-22)*. Each
    frame is a place, and the whole point of the strip is that a reader could keep going
    — so every panel is a way in at exactly the frame it shows. The box stays drawn into
    the picture, because it marks a region of the plane and nothing in HTML knows where
    that is; the link opens the frame without it, which is the settled rule for a panel
    with an annotation on top of it.
    """
    identifier = "escape-zoom-strip"
    specs = []
    for index in range(ZOOM_FRAMES):
        width = ZOOM_HOME / ZOOM_STEP**index
        specs.append(
            (
                {
                    "family": {"kind": "mandelbrot"},
                    "viewport": {
                        "center_re": ZOOM_CENTRE[0],
                        "center_im": ZOOM_CENTRE[1],
                        "width": repr(width),
                    },
                    "mode": "smooth",
                },
                ZOOM_STEP**index,
                width,
            )
        )

    panel_width, panel_height = ZOOM_PANEL
    sheet, draw = canvas(PAD + ZOOM_COLUMNS * (panel_width + PAD), PAD + panel_height + PAD)
    made = []
    for index, (spec, magnification, step_width) in enumerate(specs, start=1):
        # The box is drawn onto a canvas of one tile, at the origin the strip used, so
        # the pixels are the strip's exactly and nothing has to be cut back out of a grid.
        _paste(sheet, _panel(f"zoom4_{index - 1}", spec, ZOOM_PANEL), (PAD, PAD))
        if index < len(specs):
            sheets.marked_box(draw, PAD, PAD, panel_width, panel_height, ZOOM_STEP)
        made.append(
            Made(
                sheets.save(
                    sheet.crop((PAD, PAD, PAD + panel_width, PAD + panel_height)),
                    panel_path(identifier, index),
                ),
                alt=(f"The Mandelbrot set at one location, {magnification:,} times magnified."),
                label=f"×{magnification:,}",
                note=f"frame width {sheets.width_text(step_width)}",
                spec=dict(spec, colormap=COLORMAP),
            )
        )
    return Split(made, [], ZOOM_COLUMNS)


# ---------------------------------------------------------------------------- julia map

JULIA_MAP_PANEL = (1312, 738)
JULIA_PANEL = (320, 180)

#: Each marked value of c and what the Julia set it draws is. The ring's ink and the frame
#: under it are the same, which is the whole of what ties a mark to its panel.
JULIA_MARKS = (
    (("-0.35", "0.12"), "deep inside the set"),
    (("-0.74543", "0.11301"), "on the boundary"),
    (("-0.07810228973371881", "-0.6514609012382414"), "on the boundary"),
    (("0.45", "0.6"), "outside the set"),
)
MANDELBROT_HOME = (-0.77, 0.0, 4.4)

#: Which whole units the map names. Enough to take the scale off the picture and no more:
#: the frame runs from about −2.97 to 1.43 across and ±1.24 up.
MAP_REAL_UNITS = (-2.0, -1.0, 1.0)
MAP_IMAGINARY_UNITS = (-1.0, 1.0)

#: The line drawn under the map. American spelling, in everything a reader sees — the
#: sheet spelled this *colour* until 2026-09-06, and text drawn into a picture is the one
#: surface a sweep over tracked files never reaches.
JULIA_MAP_LABEL = (
    "The Mandelbrot set. Each ring is one value of c; "
    "the Julia set it draws wears the same color below."
)


JULIA_COLUMNS = 4


def julia_map() -> Split:
    """The Mandelbrot plane as an atlas of Julia planes, four marked and drawn below.

    **Five pictures rather than one** *(figure_split_all_ckpt140, 2026-09-22)*. The plane
    runs the whole width of the grid and the four Julia sets sit under it, which is the
    arrangement the sheet had. What moves off the pixels is the lettering and the coloured
    frame round each Julia tile: the frame is the page's own outline now, in the same ink
    as the ring on the plane above, and the label under it is words. The rings stay drawn,
    because a ring marks a point of the plane and the page has no idea where that is.
    """
    identifier = "escape-julia-map"
    panel_width, panel_height = JULIA_PANEL
    made = []

    plane = _panel(
        "jmap_plane", {"family": {"kind": "mandelbrot"}, "mode": "smooth"}, JULIA_MAP_PANEL
    )
    tile, draw = canvas(*JULIA_MAP_PANEL)
    _paste(tile, plane, (0, 0))
    box = (0, 0, JULIA_MAP_PANEL[0], JULIA_MAP_PANEL[1])
    centre_re, centre_im, plane_width = MANDELBROT_HOME
    sheets.plane_axes(
        draw,
        box,
        (centre_re, centre_im),
        plane_width,
        real=MAP_REAL_UNITS,
        imaginary=MAP_IMAGINARY_UNITS,
    )
    for index, (pair, _) in enumerate(JULIA_MARKS):
        x, y = sheets.plane_point(
            tuple(float(part) for part in pair), box, (centre_re, centre_im), plane_width
        )
        sheets.ring(draw, x, y, MARK_INK[index])
    made.append(
        Made(
            sheets.save(tile, panel_path(identifier, 1)),
            alt=(
                "The whole Mandelbrot set, with the real and imaginary axes marked and "
                "four values of c ringed in four colors."
            ),
            label=JULIA_MAP_LABEL,
            spec=home_spec({"kind": "mandelbrot"}),
            wide=True,
        )
    )

    for index, (pair, note) in enumerate(JULIA_MARKS):
        family = {"kind": "julia", "degree": 2, "c": list(pair)}
        path = _panel(f"jmap_julia_{index}", {"family": family, "mode": "smooth"}, JULIA_PANEL)
        cell, _ = canvas(panel_width, panel_height)
        _paste(cell, path, (0, 0))
        made.append(
            Made(
                sheets.save(cell, panel_path(identifier, index + 2)),
                alt=f"The Julia set for c = {pair[0]} + {pair[1]}i, a value {note}.",
                label=note,
                spec=home_spec(family),
                ink=ink_text(MARK_INK[index]),
            )
        )
    return Split(made, [], JULIA_COLUMNS)


# --------------------------------------------------------------------- multibrot degrees

MULTIBROT_PANEL = (320, 180)
DEGREES = (
    (2, {"kind": "mandelbrot"}, "the classic set"),
    (3, {"kind": "multibrot", "degree": 3}, "two-fold symmetry"),
    (4, {"kind": "multibrot", "degree": 4}, "three-fold symmetry"),
    (5, {"kind": "multibrot", "degree": 5}, "four-fold symmetry"),
    (6, {"kind": "multibrot", "degree": 6}, "five-fold symmetry"),
)


#: One row: the ladder reads as a ladder, and five 320-wide panels fit the figure's width.
MULTIBROT_COLUMNS = 5


def multibrot_degrees() -> Split:
    """The integer degrees 2 through 6, each whole in its own frame.

    **Separate pictures rather than one** *(figure_split_all_ckpt140, 2026-09-22)*. A degree
    row *is* the explorer's family picker, said in pictures, so each panel is a link at
    that family's own home view: the reader can go and do the same thing with the control.
    """
    identifier = "escape-multibrot-degrees"
    made = []
    for index, (degree, family, note) in enumerate(DEGREES, start=1):
        path = _panel(f"deg_{degree}_whole", {"family": family, "mode": "smooth"}, MULTIBROT_PANEL)
        cell, _ = canvas(*MULTIBROT_PANEL)
        _paste(cell, path, (0, 0))
        made.append(
            Made(
                sheets.save(cell, panel_path(identifier, index)),
                alt=f"The whole set of z to the power {degree} plus c, drawn in one palette.",
                label=f"d = {degree}",
                note=note,
                spec=home_spec(family),
            )
        )
    return Split(made, [], MULTIBROT_COLUMNS)


# ------------------------------------------------------------------------------ phoenix

PHOENIX_PANEL = (640, 360)
PHOENIX_FRAME = "3.2"

#: The five parameter choices beside the classic ones, frozen off the search that found
#: them (`phoenix_finds.json`, picks 1, 4, 6, 7 and 8) rather than re-searched here. The
#: search is how they were found; these are what they are.
PHOENIX_PICKS = (
    {
        "kind": "phoenix",
        "c": ["0.23053583532499533", "0.14928369481268455"],
        "p": ["-0.2440666959533996", "-0.7108918620308173"],
        "z_prev": ["0.0", "0.0"],
    },
    {
        "kind": "phoenix",
        "c": ["-0.5266783574752247", "-0.652322729101436"],
        "p": ["-0.28353182998131243", "-0.02545285599096059"],
        "z_prev": ["-0.10324356398202189", "0.43684294503006016"],
    },
    {
        "kind": "phoenix",
        "c": ["-0.039767919739178564", "0.3155353775888413"],
        "p": ["0.2635781754369918", "-0.42104278607430273"],
        "z_prev": ["-0.3109585802821072", "-0.01696033162274675"],
    },
    {
        "kind": "phoenix",
        "c": ["0.3975587928508434", "-0.3558786988385038"],
        "p": ["0.44549535605112683", "0.16322411771974485"],
        "z_prev": ["-0.29777058565919606", "-0.34594304732800446"],
    },
    {
        "kind": "phoenix",
        "c": ["-0.27738015918203646", "-0.05834793381449761"],
        "p": ["0.3901718144336561", "-0.13182322668745225"],
        "z_prev": ["0.01686063935750582", "0.011320035842502742"],
    },
)

#: Which entry of the search each pick was, kept so the cached panels keep their names.
PHOENIX_INDICES = (1, 4, 6, 7, 8)


PHOENIX_COLUMNS = 2

#: The classic constants, spelled the way the sheet lettered them under its first tile.
PHOENIX_CLASSIC_NOTE = f"c = 0.5667 + 0.0000i{MIDDOT}p = {MINUS}0.5000 + 0.0000i"


def phoenix() -> Split:
    """The Ushiki constants and five other parameter choices, two across.

    **Six pictures rather than one** *(figure_split_all_ckpt140, 2026-09-22)*. Every one
    of these is a family in its own right — a Phoenix set is three complex constants, and
    the figure's claim is that changing them changes everything — so each panel opens the
    explorer with those constants already in its fields.
    """
    identifier = "escape-phoenix"
    # The render is asked for the way it always was — a bare family, which the engine
    # fills in — and the record says what that came to, which is what a link needs.
    entries = [
        (
            "ph_classic_big",
            {"kind": "phoenix"},
            None,
            "the classic Ushiki constants",
            PHOENIX_CLASSIC_NOTE,
        )
    ]
    frame = {"center_re": "0.0", "center_im": "0.0", "width": PHOENIX_FRAME}
    for index, family in zip(PHOENIX_INDICES, PHOENIX_PICKS, strict=True):
        note = (
            f"z₋₁ = {complex_text(family['z_prev'])}"
            if any(float(part) for part in family["z_prev"])
            else None
        )
        label = f"c = {complex_text(family['c'])}{MIDDOT}p = {complex_text(family['p'])}"
        entries.append((f"ph_pick_{index}", family, frame, label, note))

    made = []
    for index, (name, family, viewport, label, note) in enumerate(entries, start=1):
        spec = {"family": family, "mode": "smooth"}
        if viewport is not None:
            spec["viewport"] = viewport
        path = _panel(name, spec, PHOENIX_PANEL)
        cell, _ = canvas(*PHOENIX_PANEL)
        _paste(cell, path, (0, 0))
        made.append(
            Made(
                sheets.save(cell, panel_path(identifier, index)),
                alt=(
                    "The Phoenix set at the classic Ushiki constants."
                    if viewport is None
                    else "A Phoenix set at one choice of its three constants."
                ),
                label=label,
                note=note,
                spec=(
                    home_spec(PHOENIX_DEFAULT, COLORMAP)
                    if viewport is None
                    else dict(spec, colormap=COLORMAP)
                ),
            )
        )
    return Split(made, [], PHOENIX_COLUMNS)


# -------------------------------------------------------------------- fractional degrees

FRACTIONAL_PANEL = (432, 243)

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

#: One line per panel: degree, centre, width, and whatever the label has to say past the
#: formula. The last is the branch-cut close-up, at the same degree as the panel above it,
#: so its label carries where it is looking as well as what it is looking at.
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


FRACTIONAL_COLUMNS = 3


def fractional_degrees() -> Split:
    """Five fractional-degree planes and the seam close-up, three across.

    **Six pictures rather than one, and none of them a link**
    *(figure_split_all_ckpt140, 2026-09-22)*. The engine gives a non-integer degree no
    home view, so the explorer has nowhere to open one at, and the contract refuses it by
    name. The panels are still worth splitting: the formula under each is a line of type
    rather than a raster of one, and the grid reflows. Nothing on the page says why these
    six carry no mark — an absence is not something a caption explains.
    """
    identifier = "escape-fractional-degrees"
    made = []
    for index, (degree, re, im, width, tail) in enumerate(FRACTIONAL, start=1):
        spec = {
            "family": {"kind": "fractional_multibrot", "degree": degree},
            "viewport": {"center_re": re, "center_im": im, "width": width},
            "mode": "smooth",
        }
        path = _panel(f"frac_{index - 1}_d{degree}", spec, FRACTIONAL_PANEL)
        cell, _ = canvas(*FRACTIONAL_PANEL)
        _paste(cell, path, (0, 0))
        made.append(
            Made(
                sheets.save(cell, panel_path(identifier, index)),
                alt=f"The plane of z to the power {degree} plus c.",
                label=formula(degree),
                note=tail.lstrip(", ") or None,
                spec=dict(spec, colormap=COLORMAP),
            )
        )
    return Split(made, [], FRACTIONAL_COLUMNS)


# ------------------------------------------------------------------------ family planes

FAMILIES_FIGURE = "escape-families"
FAMILIES_PANEL = (640, 360)
FAMILIES_COLUMNS = 3

#: What this sheet ships at. It is composed at 1968 across, three 640-wide panels
#: and their gutters, and lands at the width the other sheets of this page are
#: composed at, so the figures of one page are one size on the reader's screen.
#: kept as the record of what the composite did, and no longer used: split, each panel
#: lands at the 640 it was composed at.
#:
#: **A sheet composed wider than it ships has no tile a split can cut out.** This one put
#: three 640-wide tiles in a row, composed at 1968, and landed the whole thing at 1344, so
#: its tiles sat at 437 and 438 across and at fractional origins — a downscale of a sheet
#: puts no tile on a pixel boundary. Resampling one tile on its own to 437 and comparing
#: it with the composite's own crop reads mean absolute difference 0.7 to 7.5 of 255, which
#: is a visibly different picture and not an edge effect. So the panels land at the size
#: the sheet composed them at, which is byte for byte the tile that was pasted, and the
#: figure is one lossy compromise better than it was rather than different.
FAMILIES_WIDTH = 1344

#: The two marks, and the colours a row's two Julia panels are bordered and labelled in.
#: Named in the labels as well as drawn, so the coupling survives a reader who cannot tell
#: the two hues apart. Neither is one of `theme.RATING_INK`'s four: a rating colour means a
#: rating everywhere else on this site.
MARKS = (("cyan", (0x4F, 0xC3, 0xF7)), ("rose", (0xF0, 0x62, 0x92)))

#: Every family's parameter plane, in reading order, and the map its whole-set view is
#: drawn in. The two Julia panels beside each come off the registry row's picks, two at a
#: time in this same order.
FAMILY_ROWS = (
    {
        "family": {"kind": "mandelbrot"},
        "name": "Mandelbrot — z² + c",
        "colormap": "twilight_shifted",
    },
    {
        "family": {"kind": "multibrot", "degree": 3},
        "name": "Multibrot, degree 3 — z³ + c",
        "colormap": "cmr.ocean",
    },
    {
        "family": {"kind": "multibrot", "degree": 4},
        "name": "Multibrot, degree 4 — z⁴ + c",
        "colormap": "magma",
    },
    {
        "family": {"kind": "multibrot", "degree": 5},
        "name": "Multibrot, degree 5 — z⁵ + c",
        "colormap": "cmr.jungle",
    },
    {
        "family": {"kind": "multibrot", "degree": 6},
        "name": "Multibrot, degree 6 — z⁶ + c",
        "colormap": "cmr.sunburst",
    },
)

#: The phoenix row: the celebrated constants at the family's home view, then two views from
#: elsewhere in the (c, p) plane, both hand-rated 4.
PHOENIX_ROW = {
    "name": "Phoenix — the Ushiki constants",
    "colormap": "cmr.fusion",
    "details": (
        (("phoenix_parameter_grid", 352), "cmr.fall"),
        (("phoenix_parameter_grid", 462), "cmr.waterlily"),
    ),
}

PHOENIX_CLASSIC = {
    "kind": "phoenix",
    "c": ["0.5666", "0.0"],
    "p": ["-0.5", "0.0"],
    "z_prev": ["0.0", "0.0"],
}

#: The well's own light ink, for the ring a mark is drawn with.
MARK_RING = (0xE8, 0xEA, 0xED)


def _label_row(batch: str, line: int) -> dict:
    """One row of the wallpaper project's label store, by the line it is written on."""
    path = renders.data_file("data", "labels", "rows", f"{batch}.jsonl")
    with path.open(encoding="utf-8") as handle:
        for index, text in enumerate(handle, start=1):
            if index == line:
                row = json.loads(text)
                row["_batch"], row["_line"] = batch, line
                return row
    raise FamilyError(f"{path.name} has no line {line}")


def _teaser_panel(cache, name: str, family: dict, viewport: dict | None, colormap: str):
    spec = {"family": family, "mode": "smooth", "colormap": colormap}
    if viewport is not None:
        spec["viewport"] = viewport
    return cache.render(name, spec, FAMILIES_PANEL, supersample=SUPERSAMPLE, colormap=None)


def _mark(draw, at, ink) -> None:
    """A mark on the plane: dark ring under a filled disc, so it survives any ground."""
    x, y = at
    draw.ellipse([x - 11, y - 11, x + 11, y + 11], outline=(0, 0, 0), width=3)
    draw.ellipse([x - 8, y - 8, x + 8, y + 8], fill=ink, outline=MARK_RING, width=2)


def _pair(pair) -> str:
    return f"{pair[0]} + {pair[1]}i"


def _render_line(family: dict, viewport: dict, colormap: str) -> str:
    """One panel's provenance, in the form every render figure on this site records."""
    kind = family["kind"]
    if kind == "multibrot":
        named = f"multibrot degree {family['degree']}"
    elif kind == "julia":
        named = f"julia degree {family.get('degree', 2)}, c = {_pair(family['c'])}"
    elif kind == "phoenix":
        named = (
            f"phoenix, c = {_pair(family.get('c', PHOENIX_CLASSIC['c']))}, "
            f"p = {_pair(family.get('p', PHOENIX_CLASSIC['p']))}, "
            f"z_prev = {_pair(family.get('z_prev', PHOENIX_CLASSIC['z_prev']))}"
        )
    else:
        named = "mandelbrot"
    return (
        f"fractal-engine render: {named}, "
        f"centre {_pair([viewport['center_re'], viewport['center_im']])}, "
        f"width {viewport['width']}, {FAMILIES_PANEL[0]}x{FAMILIES_PANEL[1]}, "
        f"supersample {SUPERSAMPLE}, mode smooth, colormap {colormap}, "
        "maxiter auto (the depth policy)"
    )


#: The sheet's own line, the part of its provenance that is about the composition rather
#: than about any one panel.
FAMILIES_PROVENANCE = (
    "builder.families:family_planes — eighteen panels at 640x360, three to a row and "
    "landed one file a panel, this figure being split rather than composited: a "
    "family's whole-set view with two marked points on it, then a finished wallpaper of "
    "the Julia set each mark produces. The five whole-set views are the engine's own "
    "derived home views, rendered at supersample 3, mode smooth, in the map named on each "
    "line. The ten Julia panels are seats of recorded tentative galleries, named on "
    "this row as <stamp>|<recipe key> and resolved from "
    "artifacts/curation/tentative/<stamp>/gallery.jsonl for the seat and the candidate "
    "ledger for the recipe (article/figure-recipes.jsonl holds both since those records "
    "went); each is rendered fresh through the engine at 1280x720, "
    "supersample 3, and fitted to the panel. Nothing about their coloring is this figure's "
    "choice — mode, curve, map, palette pass and cap all come off the ledger's "
    "recipe; what this figure chooses is which seats are eligible, and it admits only "
    "seats drawn in smooth that the render judge scored P(>=4) 0.5 or better, so that the "
    "one thing varying down the sheet is the family. The two panels of a row are drawn "
    "from hue families the gallery record itself keeps apart, and the plane's own map is a "
    "third. The degree-6 row's two seats are off the cyan collection's record "
    "(20260922T013657Z), and they are the only degree-6 Julia seats in any of the "
    "twenty-one recorded galleries whose ledger recipe is smooth and scores 0.5: a third, "
    "d70c928f5417e54a, is seated as smooth in its gallery rows and its recipe draws it in "
    "itinerary, so it is not one. Those two stand in the cyan and azure hue families, "
    "which the record keeps apart. The Phoenix row is unchanged: two label-store rows "
    "scored 4 by hand, drawn the "
    "way a Julia set is, because that family has no parameter plane to mark."
)


def family_planes() -> Split:
    """The parameter and dynamical planes the project draws, and the provenance it earns.

    The one maker here that returns its own provenance, because its eight Julia panels are
    gallery seats: what drew them is the ledger's recipe rather than anything written in
    this file, so those lines have to be read off the picks at draw time.

    **Fifteen pictures rather than one** *(figure_split_all_ckpt140, 2026-09-22)*, and
    the mixed sheet the panel-level record was built for: four parameter planes and a
    Phoenix plane this repository rendered, eight gallery seats, and two label-store rows,
    each linked from whatever kind of record it actually is. The marks on a plane stay
    drawn — a mark is a point of the plane and the page cannot know where that is — and
    the coloured frame round a Julia panel does not, because a frame is the page's own
    outline and the ink is one custom property. Its label was `Mandelbrot — z² + c`, an
    em-dash the site's sweep never saw because it was pixels; as text it is the name and
    the formula, with the separator CSS's.
    """
    identifier = FAMILIES_FIGURE
    cache = renders.Cache()
    wanted = picks.picks_of(identifier)
    if len(wanted) != 2 * len(FAMILY_ROWS):
        raise FamilyError(
            f"{identifier} wants {2 * len(FAMILY_ROWS)} picks and its row names {len(wanted)}"
        )
    resolved = picks.resolve(wanted)
    catalog = renders.mode_catalog()

    made: list[Made] = []
    provenance = [FAMILIES_PROVENANCE, picks.autolevel_line(resolved)]
    panel_width, panel_height = FAMILIES_PANEL

    def plane(name: str, family: dict, home: dict, colormap: str, marks, label, note, alt):
        """One whole-set panel, with its marks drawn on it, as its own picture."""
        drawn = _teaser_panel(cache, name, family, home, colormap)
        tile, draw = canvas(panel_width, panel_height)
        _paste(tile, drawn.path, (0, 0))
        for constant, ink in marks:
            _mark(
                draw,
                sheets.plane_point(
                    constant,
                    (0, 0, panel_width, panel_height),
                    (float(home["center_re"]), float(home["center_im"])),
                    float(home["width"]),
                ),
                ink,
            )
        made.append(
            Made(
                sheets.save(tile, panel_path(identifier, len(made) + 1)),
                alt=alt,
                label=label,
                note=note,
                spec={
                    "family": family,
                    "viewport": home,
                    "mode": "smooth",
                    "colormap": colormap,
                },
            )
        )

    for index, row in enumerate(FAMILY_ROWS):
        home = renders.home_view(row["family"])["viewport"]
        pair = resolved[2 * index : 2 * index + 2]
        marks = [
            ([float(part) for part in pick.recipe["family"]["c"]], ink)
            for (_mark_name, ink), pick in zip(MARKS, pair, strict=True)
        ]
        name, formula_text = row["name"].split(NAME_SPLIT)
        plane(
            "teaser-plane",
            row["family"],
            home,
            row["colormap"],
            marks,
            name,
            formula_text,
            f"The whole {name} set, with two values of c marked on it.",
        )
        provenance.append(_render_line(row["family"], home, row["colormap"]))
        for (mark, ink), pick in zip(MARKS, pair, strict=True):
            # 1280x720 is the panel's own aspect, so the grid's resize is a scale and never
            # a squash; nothing here has to crop.
            picture, levelling = picks.panel_or_seat(pick, f"teaser-seat-{pick.alias}", catalog)
            tile, _ = canvas(panel_width, panel_height)
            sheets.paste(tile, picture, (0, 0), FAMILIES_PANEL)
            made.append(
                Made(
                    sheets.save(tile, panel_path(identifier, len(made) + 1)),
                    alt=f"A finished wallpaper of the Julia set at the {mark} mark.",
                    label=f"a Julia set at the {mark} mark",
                    seat=pick.identifier,
                    ink=ink_text(ink),
                )
            )
            provenance.append(picks.frame_line(pick, representative=False))
            if levelling.way == picks.UNRECOVERABLE:
                provenance.append(picks.unrecoverable_line(pick, levelling))

    home = renders.home_view(PHOENIX_CLASSIC)["viewport"]
    name, constants = PHOENIX_ROW["name"].split(NAME_SPLIT)
    plane(
        "teaser-plane",
        PHOENIX_CLASSIC,
        home,
        PHOENIX_ROW["colormap"],
        [],
        name,
        constants,
        "The whole Phoenix set at the classic Ushiki constants.",
    )
    provenance.append(_render_line(PHOENIX_CLASSIC, home, PHOENIX_ROW["colormap"]))
    names = ("elsewhere in the (c, p) plane", "and elsewhere again")
    for mark, (address, colormap) in zip(names, PHOENIX_ROW["details"], strict=True):
        rated = _label_row(*address)
        drawn = _teaser_panel(cache, "teaser-phoenix", rated["family"], rated["viewport"], colormap)
        tile, _ = canvas(panel_width, panel_height)
        _paste(tile, drawn.path, (0, 0))
        made.append(
            Made(
                sheets.save(tile, panel_path(identifier, len(made) + 1)),
                alt="A Phoenix set at another choice of its constants.",
                label=mark,
                spec={
                    "family": rated["family"],
                    "viewport": rated["viewport"],
                    "mode": "smooth",
                    "colormap": colormap,
                },
            )
        )
        provenance.append(
            _render_line(rated["family"], rated["viewport"], colormap)
            + f" — the location recorded at data/labels/rows/{address[0]}.jsonl line "
            f"{address[1]}, scored 4 by hand"
        )

    return Split(made, provenance, FAMILIES_COLUMNS)


#: Figure id to the maker that draws it. Every sheet on this page is **split** since
#: `figure_split_all_ckpt140` — six figures, forty panels — so what a maker returns is a
#: list of pictures and the arrangement they stand in, and the file names are
#: `images.FIGURE_SUFFIX`'s to spell at landing rather than each table's.
SHEETS = {
    "escape-families": family_planes,
    "escape-fractional-degrees": fractional_degrees,
    "escape-julia-map": julia_map,
    "escape-multibrot-degrees": multibrot_degrees,
    "escape-phoenix": phoenix,
    "escape-zoom-strip": zoom_strip,
}


def recipe(identifier: str) -> dict:
    """The registry recipe for a sheet here: the maker, and whatever picks the row names.

    `escape-families` is the one sheet with arguments — the eight gallery seats its Julia
    panels are — and they stay the row's, the way every other picks-driven figure's do.
    A landing that rewrote them from here would be a second list of the same thing.
    """
    if identifier not in SHEETS:
        raise records_error(identifier)
    args = {}
    figure = figures_module.load_all().get(identifier)
    if figure is not None and figure.recipe is not None and "picks" in figure.recipe.args:
        args["picks"] = figure.recipe.args["picks"]
    return {"maker": f"{__name__}:{SHEETS[identifier].__name__}", "args": args}


def records_error(identifier: str) -> Exception:
    return FamilyError(f"{identifier} is not drawn by builder.families")


def draw(identifier: str) -> Split:
    """Draw one sheet's panels into `artifacts/figures/`, and write its provenance beside.

    Nothing lands in the site's asset directory here: a maker composes losslessly under
    the ignored artifacts tree and `--place` is what encodes, exactly as the `locations`
    and `picks` makers already worked. It is also what gives this page a lossless copy of
    every panel to measure a redraw against.
    """
    drawn = SHEETS[identifier]()
    if drawn.provenance:
        notes = panel_path(identifier, 1).with_name(f"{identifier}.provenance.txt")
        body = LF.join(drawn.provenance) + LF
        notes.write_text(body, encoding="utf-8", newline=LF)
    return drawn
