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

from . import images, picks, renders, sheets
from .paths import FIGURE_IMAGES_DIR
from .sheets import MIDDOT, MINUS, PAD, canvas, caption_band, complex_text, tile_label
from .theme import MARK_INK, WELL_INK_DIM


class FamilyError(RuntimeError):
    """A sheet on this page cannot be drawn as its record describes it."""


#: The neutral map every panel on this page is drawn in.
COLORMAP = renders.COLORMAP
SUPERSAMPLE = 3


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


def _land(sheet, destination: Path, *, max_width: int | None = None) -> tuple[int, int]:
    """The composed sheet onto disk, exactly as `python -m builder import` would land it.

    `images.land` and not a second set of options typed here: a sheet composed from PNG
    panels is downscaled once if it is composed wider than it ships, and encoded once, by
    the code `import` uses. That is what lets a maker move into this package without
    rewriting the bytes of a picture that did not change — and it is the test that the
    move was faithful.
    """
    return images.land(sheet, destination, max_width=max_width)


# --------------------------------------------------------------------------- zoom strip

ZOOM_CENTRE = ("-0.8038460387836429", "0.18284000541838608")
ZOOM_HOME = 4.4
ZOOM_STEP = 4
ZOOM_FRAMES = 9
ZOOM_PANEL = (432, 243)


def zoom_strip(destination: Path) -> tuple[int, int]:
    """Nine frames into one location, each four times narrower than the last."""
    panels = []
    for index in range(ZOOM_FRAMES):
        width = ZOOM_HOME / ZOOM_STEP**index
        panels.append(
            (
                _panel(
                    f"zoom4_{index}",
                    {
                        "family": {"kind": "mandelbrot"},
                        "viewport": {
                            "center_re": ZOOM_CENTRE[0],
                            "center_im": ZOOM_CENTRE[1],
                            "width": repr(width),
                        },
                        "mode": "smooth",
                    },
                    ZOOM_PANEL,
                ),
                ZOOM_STEP**index,
                width,
            )
        )

    columns, rows = 3, 3
    panel_width, panel_height = ZOOM_PANEL
    width = PAD + columns * (panel_width + PAD)
    caption = caption_band(panel_height, width, 2)
    sheet, draw = canvas(width, PAD + rows * (panel_height + caption + PAD))
    for index, (path, magnification, step_width) in enumerate(panels):
        row, column = divmod(index, columns)
        x = PAD + column * (panel_width + PAD)
        y = PAD + row * (panel_height + caption + PAD)
        _paste(sheet, path, (x, y))
        if index + 1 < len(panels):
            sheets.marked_box(draw, x, y, panel_width, panel_height, ZOOM_STEP)
        tile_label(
            draw,
            (x, y),
            ZOOM_PANEL,
            [f"×{magnification:,}", f"frame width {sheets.width_text(step_width)}"],
            width,
        )
    return _land(sheet, destination)


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


def julia_map(destination: Path) -> tuple[int, int]:
    """The Mandelbrot plane as an atlas of Julia planes, four marked and drawn below."""
    plane = _panel(
        "jmap_plane", {"family": {"kind": "mandelbrot"}, "mode": "smooth"}, JULIA_MAP_PANEL
    )
    juliae = [
        _panel(
            f"jmap_julia_{index}",
            {"family": {"kind": "julia", "degree": 2, "c": list(pair)}, "mode": "smooth"},
            JULIA_PANEL,
        )
        for index, (pair, _) in enumerate(JULIA_MARKS)
    ]

    panel_width, panel_height = JULIA_PANEL
    width = PAD + 4 * (panel_width + PAD)
    plane_x = (width - JULIA_MAP_PANEL[0]) // 2
    plane_caption = caption_band(JULIA_MAP_PANEL[1], width, 1)
    julia_caption = caption_band(panel_height, width, 1)
    height = PAD + JULIA_MAP_PANEL[1] + plane_caption + PAD + panel_height + julia_caption + PAD
    sheet, draw = canvas(width, height)
    _paste(sheet, plane, (plane_x, PAD))

    box = (plane_x, PAD, plane_x + JULIA_MAP_PANEL[0], PAD + JULIA_MAP_PANEL[1])
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

    tile_label(draw, (plane_x, PAD), JULIA_MAP_PANEL, [JULIA_MAP_LABEL], width)

    top = PAD + JULIA_MAP_PANEL[1] + plane_caption + PAD
    for index, (path, (_, note)) in enumerate(zip(juliae, JULIA_MARKS, strict=True)):
        x = PAD + index * (panel_width + PAD)
        _paste(sheet, path, (x, top))
        sheets.framed(draw, (x, top), JULIA_PANEL, MARK_INK[index])
        tile_label(draw, (x, top), JULIA_PANEL, [note], width, lead=MARK_INK[index])
    return _land(sheet, destination)


# --------------------------------------------------------------------- multibrot degrees

MULTIBROT_PANEL = (320, 180)
DEGREES = (
    (2, {"kind": "mandelbrot"}, "the classic set"),
    (3, {"kind": "multibrot", "degree": 3}, "two-fold symmetry"),
    (4, {"kind": "multibrot", "degree": 4}, "three-fold symmetry"),
    (5, {"kind": "multibrot", "degree": 5}, "four-fold symmetry"),
)


def multibrot_degrees(destination: Path) -> tuple[int, int]:
    """The first four integer degrees, each whole in its own frame."""
    panel_width, panel_height = MULTIBROT_PANEL
    width = PAD + 4 * (panel_width + PAD)
    caption = caption_band(panel_height, width, 2)
    sheet, draw = canvas(width, PAD + panel_height + caption + PAD)
    for column, (degree, family, note) in enumerate(DEGREES):
        whole = _panel(f"deg_{degree}_whole", {"family": family, "mode": "smooth"}, MULTIBROT_PANEL)
        x = PAD + column * (panel_width + PAD)
        _paste(sheet, whole, (x, PAD))
        tile_label(draw, (x, PAD), MULTIBROT_PANEL, [f"d = {degree}", note], width)
    return _land(sheet, destination)


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


def phoenix(destination: Path) -> tuple[int, int]:
    """The Ushiki constants and five other parameter choices, two across."""
    entries = [
        (
            _panel(
                "ph_classic_big", {"family": {"kind": "phoenix"}, "mode": "smooth"}, PHOENIX_PANEL
            ),
            [
                "the classic Ushiki constants",
                f"c = 0.5667 + 0.0000i{MIDDOT}p = {MINUS}0.5000 + 0.0000i",
            ],
        )
    ]
    for index, family in zip(PHOENIX_INDICES, PHOENIX_PICKS, strict=True):
        path = _panel(
            f"ph_pick_{index}",
            {
                "family": family,
                "viewport": {"center_re": "0.0", "center_im": "0.0", "width": PHOENIX_FRAME},
                "mode": "smooth",
            },
            PHOENIX_PANEL,
        )
        lines = [f"c = {complex_text(family['c'])}{MIDDOT}p = {complex_text(family['p'])}"]
        if any(float(part) for part in family["z_prev"]):
            lines.append(f"z₋₁ = {complex_text(family['z_prev'])}")
        entries.append((path, lines))

    panel_width, panel_height = PHOENIX_PANEL
    width = PAD + 2 * (panel_width + PAD)
    caption = caption_band(panel_height, width, 2)
    sheet, draw = canvas(width, PAD + 3 * (panel_height + caption + PAD))
    for index, (path, lines) in enumerate(entries):
        row, column = divmod(index, 2)
        x = PAD + column * (panel_width + PAD)
        y = PAD + row * (panel_height + caption + PAD)
        _paste(sheet, path, (x, y))
        tile_label(draw, (x, y), PHOENIX_PANEL, lines, width)
    return _land(sheet, destination)


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


def fractional_degrees(destination: Path) -> tuple[int, int]:
    """Five fractional-degree planes and the seam close-up, three across."""
    panels = [
        (
            _panel(
                f"frac_{index}_d{degree}",
                {
                    "family": {"kind": "fractional_multibrot", "degree": degree},
                    "viewport": {"center_re": re, "center_im": im, "width": width},
                    "mode": "smooth",
                },
                FRACTIONAL_PANEL,
            ),
            formula(degree) + tail,
        )
        for index, (degree, re, im, width, tail) in enumerate(FRACTIONAL)
    ]
    sheet, _ = sheets.panel_grid(panels, 3, panel=FRACTIONAL_PANEL)
    return _land(sheet, destination)


# ------------------------------------------------------------------------ family planes

FAMILIES_FIGURE = "escape-families"
FAMILIES_PANEL = (640, 360)
FAMILIES_COLUMNS = 3

#: What this sheet ships at. It is composed at 1968 across, three 640-wide panels
#: and their gutters, and lands at the width the other sheets of this page are
#: composed at, so the figures of one page are one size on the reader's screen.
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
    "builder.families:family_planes — fifteen panels at 640x360, three to a row: a "
    "family's whole-set view with two marked points on it, then a finished wallpaper of "
    "the Julia set each mark produces. The four whole-set views are the engine's own "
    "derived home views, rendered at supersample 3, mode smooth, in the map named on each "
    "line. The eight Julia panels are seats of the recorded tentative gallery, named on "
    "this row as <stamp>|<recipe key> and resolved from "
    "artifacts/curation/tentative/<stamp>/gallery.jsonl for the seat and the candidate "
    "ledger for the recipe; each is rendered fresh through the engine at 1280x720, "
    "supersample 3, and fitted to the panel. Nothing about their coloring is this figure's "
    "choice — mode, curve, map, palette pass and cap all come off the ledger's "
    "recipe; what this figure chooses is which seats are eligible, and it admits only "
    "seats drawn in smooth that the render judge scored P(>=4) 0.5 or better, so that the "
    "one thing varying down the sheet is the family. The two panels of a row are drawn "
    "from hue families the gallery record itself keeps apart, and the plane's own map is a "
    "third. The Phoenix row is unchanged: two label-store rows scored 4 by hand, drawn the "
    "way a Julia set is, because that family has no parameter plane to mark."
)


def family_planes(destination: Path) -> tuple[tuple[int, int], list[str]]:
    """The parameter and dynamical planes the project draws, and the provenance it earns.

    The one maker here that returns its own provenance, because its eight Julia panels are
    gallery seats: what drew them is the ledger's recipe rather than anything written in
    this file, so those lines have to be read off the picks at draw time.
    """
    cache = renders.Cache()
    wanted = picks.picks_of(FAMILIES_FIGURE)
    if len(wanted) != 2 * len(FAMILY_ROWS):
        raise FamilyError(
            f"{FAMILIES_FIGURE} wants {2 * len(FAMILY_ROWS)} picks and its row names {len(wanted)}"
        )
    resolved = picks.resolve(wanted)
    catalog = renders.mode_catalog()

    panels: list[tuple[Path, list[str]]] = []
    marks: dict[int, list[tuple]] = {}
    provenance = [FAMILIES_PROVENANCE, picks.autolevel_line(resolved)]

    for index, row in enumerate(FAMILY_ROWS):
        home = renders.home_view(row["family"])["viewport"]
        at = len(panels)
        drawn = _teaser_panel(cache, "teaser-plane", row["family"], home, row["colormap"])
        panels.append((drawn.path, [row["name"]]))
        provenance.append(_render_line(row["family"], home, row["colormap"]))
        placed = []
        for (mark, ink), pick in zip(MARKS, resolved[2 * index : 2 * index + 2], strict=True):
            constant = [float(part) for part in pick.recipe["family"]["c"]]
            placed.append((constant, ink))
            # 1280x720 is the panel's own aspect, so the grid's resize is a scale and never
            # a squash; nothing here has to crop.
            picture, levelling = picks.panel_or_seat(pick, f"teaser-seat-{pick.alias}", catalog)
            panels.append((picture, [f"a Julia set at the {mark} mark"]))
            provenance.append(picks.frame_line(pick, representative=False))
            if levelling.way == picks.UNRECOVERABLE:
                provenance.append(picks.unrecoverable_line(pick, levelling))
        marks[at] = [
            (
                constant,
                ink,
                (float(home["center_re"]), float(home["center_im"])),
                float(home["width"]),
            )
            for constant, ink in placed
        ]

    home = renders.home_view(PHOENIX_CLASSIC)["viewport"]
    drawn = _teaser_panel(cache, "teaser-plane", PHOENIX_CLASSIC, home, PHOENIX_ROW["colormap"])
    panels.append((drawn.path, [PHOENIX_ROW["name"]]))
    provenance.append(_render_line(PHOENIX_CLASSIC, home, PHOENIX_ROW["colormap"]))
    names = ("elsewhere in the (c, p) plane", "and elsewhere again")
    for mark, (address, colormap) in zip(names, PHOENIX_ROW["details"], strict=True):
        rated = _label_row(*address)
        drawn = _teaser_panel(cache, "teaser-phoenix", rated["family"], rated["viewport"], colormap)
        panels.append((drawn.path, [mark]))
        provenance.append(
            _render_line(rated["family"], rated["viewport"], colormap)
            + f" — the location recorded at data/labels/rows/{address[0]}.jsonl line "
            f"{address[1]}, scored 4 by hand"
        )

    borders = {}
    for index, (_path, lines) in enumerate(panels):
        if lines[0].startswith("a Julia set at the "):
            borders[index] = dict(MARKS)[lines[0].rsplit(" ", 2)[-2]]

    def after(draw, index, x, y, panel_width, panel_height):
        for constant, ink, centre, width in marks.get(index, []):
            at = sheets.plane_point(
                constant, (x, y, x + panel_width, y + panel_height), centre, width
            )
            _mark(draw, at, ink)
        if index in borders:
            draw.rectangle(
                [x, y, x + panel_width - 1, y + panel_height - 1],
                outline=borders[index],
                width=4,
            )

    # A Julia panel's label is written in its own mark colour rather than the well's dim
    # ink, so a reader who cannot tell cyan from rose still has the words.
    composed, _ = sheets.panel_grid(
        panels,
        FAMILIES_COLUMNS,
        lead=WELL_INK_DIM,
        inks={index: (colour,) for index, colour in borders.items()},
        after=after,
    )
    return _land(composed, destination, max_width=FAMILIES_WIDTH), provenance


#: Figure id to the file it writes and the maker that writes it.
SHEETS = {
    "escape-families": ("escape-families.jpg", family_planes),
    "escape-fractional-degrees": ("escape-fractional-degrees.jpg", fractional_degrees),
    "escape-julia-map": ("escape-julia-map.jpg", julia_map),
    "escape-multibrot-degrees": ("escape-multibrot-degrees.jpg", multibrot_degrees),
    "escape-phoenix": ("escape-phoenix.jpg", phoenix),
    "escape-zoom-strip": ("escape-zoom-strip.jpg", zoom_strip),
}


def draw(identifier: str) -> tuple[Path, int, int, list[str]]:
    """Draw one sheet into the figures directory.

    Returns where it went, the size to record in `figures.jsonl`, and any provenance
    the maker had to read at draw time rather than carry in its own source.
    """
    file, maker = SHEETS[identifier]
    destination = FIGURE_IMAGES_DIR / file
    answer = maker(destination)
    # `family_planes` returns the provenance its picks earn as well as the size, because
    # what drew its Julia panels is a ledger recipe rather than anything written here.
    (width, height), provenance = answer if isinstance(answer[0], tuple) else (answer, [])
    return destination, width, height, provenance
