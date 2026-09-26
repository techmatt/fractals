"""The Rendering fundamentals page's six figures.

Recovered into the repository on 2026-09-06 from a discarded scratch tree, under the rule
in `CLAUDE.md` that a figure's maker is tracked. Three things this rig does that the ones
beside it do not:

- **the first two figures are one figure** — the two named palettes as flat ramps, the
  same field under each as the integer count, and again as the smooth count;
- **the field figure has three columns** — no palette at all, and two authored maps;
- **every figure on the page is picked for a palette of its own.** The page used to draw
  six of its seven figures through one map.

    python -m builder fundamentals render-maxiter

Renders go through `renders.Cache`, which keys on the spec, so a changed constant is a new
picture rather than a stale file. Two of the six do not call the engine's coloring stage at
all: `render-field-anatomy` and `render-percentile-stretch` paint a dumped field through
`fields.py`, because the engine always stretches against a frame's own percentiles and so
cannot be asked for the unstretched half of a comparison about stretching.

Every location here is addressed by its own record — a candidate ledger key, a label-store
row, a frame Matt picked off a contact sheet — and frozen into the constants below, never
re-derived at draw time.
"""

from __future__ import annotations

from pathlib import Path

from . import images, renders, sheets
from . import palettes as palette_module
from .locations import Drawn, Made, Split, panel_path, sheet_path
from .theme import WELL, WELL_INK_DIM

PANEL = (640, 360)
STRIP = (640, 48)
SS = 3

ICE = "Ice Walk"
EMBER = "Ember Gradient"

#: The discrete-field coloring, written out in full: the integer escape count, read
#: straight through the palette with no smoothing and no curve.
DISCRETE = {"kind": "field", "field": {"kind": "discrete"}, "transform": "linear"}
BANDING = ("-1.02", "0.28", "1.0")

#: Set low on purpose, so the terraces the figure is about are wider than a pixel.
BANDING_CAP = 50

#: `released_top_end` unit u0065 of the wallpaper project.
ANATOMY = {
    "family": {"kind": "multibrot", "degree": 4},
    "viewport": {
        "center_re": "0.31215622070747834",
        "center_im": "0.7310275499716895",
        "width": "0.000009171415720687774",
    },
}

#: The two maps the field figure's second and third columns are read through *(Matt,
#: 2026-09-02)*. Both authored, and both this figure's own choice: the second column used
#: to be the map its wallpaper shipped in — hence the name this pair used to carry — and is
#: not any more, so neither name claims a provenance it does not have.
WARM = "Deep Rose Vault"
COOL = "Foam & Olive"

DEEP = {
    "family": {"kind": "mandelbrot"},
    "viewport": {
        "center_re": "0.2869760101232717",
        "center_im": "0.4680510345013121",
        "width": "2.1585146387249553e-07",
    },
}
LOW_CAP = 300
DEEP_MAP = "Indigo Nocturne"

#: The cyclic-repeats location *(SITE_review_fixes_2, Matt's pick)*: candidate ledger key
#: 0daf678f61143941, partition julia:mandelbrot, drawn at its own recorded frame. Addressed
#: by that key and never by a position in anything.
JULIA = {
    "family": {"kind": "julia", "c": ["-1.2517612129804818", "0.038979112285470574"]},
    "viewport": {
        "center_re": "-0.2739474295196568",
        "center_im": "0.09521327512869174",
        "width": "0.6313752221683463",
    },
}

#: The supersample pair's location: Matt's pick A11 off the pass-1 re-pick sheet, drawn
#: from `smooth_render/p_ge4_calibration_smooth.jsonl:95`. The frame is the pick's own,
#: whole and uncropped — the sheet drew its tile at 320x180 over the row's whole viewport,
#: which is this figure's panel exactly, so the picture Matt picked and the picture this
#: figure shows are the same frame. A session that crops into it has chosen a picture,
#: which is not a session's to choose.
FILAMENTS = {
    "family": {"kind": "multibrot", "degree": 3},
    "viewport": {
        "center_re": "-0.0693668444165554",
        "center_im": "0.7786163029308374",
        "width": "5.6412438043129286e-08",
    },
}
PRODUCTION_SS = 4

#: A11's own map, not this figure's old one. The sheet drew the tile as the picture that
#: was rated — the row's mode, curve, palette recipe and colormap — so a pair redrawn in
#: some other gradient is not the tile anybody picked, whatever frame it is at.
FILAMENT_MAP = "Teal Against Coral"
CYCLIC_MAP = EMBER

SKEWED = {
    "family": {"kind": "mandelbrot"},
    "viewport": {"center_re": "-0.1592", "center_im": "1.0341", "width": "0.10"},
}
SKEWED_MAP = "Gold Field, Blood Spark"


def _work(*parts: str) -> Path:
    """A working file under the ignored render cache, never under the repository."""
    path = renders.default_cache_root().joinpath("fundamentals", *parts)
    path.parent.mkdir(parents=True, exist_ok=True)
    return path


def _panel(name: str, spec: dict, size=PANEL, supersample: int = SS) -> Path:
    return renders.Cache().render(name, spec, size, supersample=supersample, colormap=None).path


def _mandel(centre, width) -> dict:
    return {
        "family": {"kind": "mandelbrot"},
        "viewport": {"center_re": centre[0], "center_im": centre[1], "width": width},
    }


def _render_line(what: str, viewport: dict, colormap: str, *, size=PANEL, tail: str = "") -> str:
    return (
        f"fractal-engine render: {what}, centre {viewport['center_re']} + "
        f"{viewport['center_im']}i, width {viewport['width']}, {size[0]}x{size[1]}, "
        f"supersample {SS}, {tail or 'mode smooth'}, colormap {colormap}, "
        "maxiter auto (the depth policy)"
    )


def _strip_line(name: str) -> str:
    return (
        f"palette strip: `fractal-engine palettes strip` for colormap {name} at "
        f"{STRIP[0]}x{STRIP[1]} — a ramp, not a frame of the plane"
    )


def _two_up(panels, destination: Path) -> tuple[int, int]:
    composed, _ = sheets.panel_grid(panels, 2, lead=WELL_INK_DIM)
    return images.land(composed, destination)


# ------------------------------------------------------------- the merged opening figure


def discrete_and_smooth(destination: Path) -> tuple[tuple[int, int], list[str]]:
    """Two palettes as ramps, and the same field under each twice: banded, then smooth."""
    place = _mandel(BANDING[:2], BANDING[2])
    columns = []
    provenance = [
        "builder.fundamentals:discrete_and_smooth — one location in two palettes, three "
        "rows: the palettes themselves as flat ramps, the integer escape count under each, "
        "and the smooth count under each. One cap throughout, set low on purpose so the "
        "terraces are wider than a pixel.",
    ]
    for colormap in (ICE, EMBER):
        strip = palette_module.strip(colormap, STRIP[0], STRIP[1])
        discrete = _panel(
            "rf2-discrete", dict(place, coloring=DISCRETE, colormap=colormap, maxiter=BANDING_CAP)
        )
        smooth = _panel(
            "rf2-smooth", dict(place, mode="smooth", colormap=colormap, maxiter=BANDING_CAP)
        )
        columns.append((colormap, strip, discrete, smooth))
        provenance.append(_strip_line(colormap))

    for colormap, _strip, _discrete, _smooth in columns:
        provenance.append(
            _render_line(
                "mandelbrot",
                place["viewport"],
                colormap,
                tail=(
                    "coloring the discrete field written out in full "
                    '({"kind": "field", "field": {"kind": "discrete"}, "transform": "linear"})'
                ),
            ).replace("maxiter auto (the depth policy)", f"maxiter {BANDING_CAP}")
        )
    for colormap, _strip, _discrete, _smooth in columns:
        provenance.append(
            _render_line("mandelbrot", place["viewport"], colormap).replace(
                "maxiter auto (the depth policy)", f"maxiter {BANDING_CAP}"
            )
        )

    width = sheets.PAD + 2 * (PANEL[0] + sheets.PAD)
    strip_band = sheets.caption_band(STRIP[1], width)
    panel_band = sheets.caption_band(PANEL[1], width)
    height = (
        sheets.PAD + (STRIP[1] + strip_band + sheets.PAD) + 2 * (PANEL[1] + panel_band + sheets.PAD)
    )
    sheet, draw = sheets.canvas(width, height)
    for index, (colormap, strip, discrete, smooth) in enumerate(columns):
        x = sheets.PAD + index * (PANEL[0] + sheets.PAD)
        y = sheets.PAD
        sheets.paste(sheet, strip, (x, y), STRIP)
        sheets.tile_label(draw, (x, y), STRIP, colormap, width, lead=WELL_INK_DIM)
        y += STRIP[1] + strip_band + sheets.PAD
        sheets.paste(sheet, discrete, (x, y), PANEL)
        sheets.tile_label(draw, (x, y), PANEL, "the integer escape count", width, lead=WELL_INK_DIM)
        y += PANEL[1] + panel_band + sheets.PAD
        sheets.paste(sheet, smooth, (x, y), PANEL)
        sheets.tile_label(draw, (x, y), PANEL, "the smooth count", width, lead=WELL_INK_DIM)
    return images.land(sheet, destination), provenance


# ---------------------------------------------------------------- the field, three ways


def field_anatomy(destination: Path) -> tuple[tuple[int, int], list[str]]:
    """The same field with no palette at all, and under two of them."""
    import numpy as np
    from PIL import Image

    # Imported here, as numpy is: `fields` needs numpy at import time, and the builder's
    # requirements are Pillow alone, so CI's `check` must not import it by importing this.
    from . import fields

    stem = _work("fields", "anatomy")
    renders.dump_field(
        dict(ANATOMY, resolution=list(PANEL), supersample=1, mode="smooth", colormap=WARM), stem
    )
    field, _ = fields.read_field(stem)
    low, span = fields.stretched_range(field)
    grey = _work("anatomy-grey.png")
    if not grey.is_file():
        fields.paint_grey(field, low=low, span=span).save(grey)
    grey_strip = _work("anatomy-grey-strip.png")
    if not grey_strip.is_file():
        ramp = np.tile(np.linspace(0.0, 1.0, STRIP[0]), (STRIP[1], 1))
        linear = fields.lookup(fields.grey_table(), ramp)
        encoded = (fields.linear_to_srgb(linear) * 255.0 + 0.5).astype(np.uint8)
        Image.fromarray(encoded, "RGB").save(grey_strip)

    # No label under a column *(Matt, 2026-08-22)*: the strip above each one already says
    # what it is drawn through, and the three lines under the pictures repeated the
    # figure's own caption a few lines below them.
    columns = [(None, grey_strip, grey)]
    for colormap in (WARM, COOL):
        columns.append(
            (
                colormap,
                palette_module.strip(colormap, STRIP[0], STRIP[1]),
                _panel("rf2-anatomy", dict(ANATOMY, mode="smooth", colormap=colormap)),
            )
        )

    provenance = [
        "builder.fundamentals:field_anatomy — one stored field in three columns, each "
        "under the ramp it is read through. The location is released_top_end unit u0065 of "
        "the wallpaper project.",
        "`fractal-engine dump-field` at multibrot degree 4, centre 0.31215622070747834 + "
        "0.7310275499716895i, width 0.000009171415720687774, 640x360, supersample 1, mode "
        "smooth; painted as plain lightness over the stretched range by builder/fields.py "
        "paint_grey(), which reimplements the engine's own 0.5th/99.5th percentile stretch "
        "(verified against the engine's render of the same field at max channel difference "
        "0). Its ramp is that same black-to-white table drawn across the strip — the "
        "lightness axis, not a palette.",
        _strip_line(WARM),
        _strip_line(COOL),
        _render_line("multibrot degree 4", ANATOMY["viewport"], WARM),
        _render_line("multibrot degree 4", ANATOMY["viewport"], COOL),
    ]

    width = sheets.PAD + 3 * (PANEL[0] + sheets.PAD)
    height = sheets.PAD + (STRIP[1] + sheets.PAD) + (PANEL[1] + sheets.PAD)
    sheet, _draw = sheets.canvas(width, height)
    for index, (_name, strip, picture) in enumerate(columns):
        x = sheets.PAD + index * (PANEL[0] + sheets.PAD)
        sheets.paste(sheet, strip, (x, sheets.PAD), STRIP)
        sheets.paste(sheet, picture, (x, sheets.PAD + STRIP[1] + sheets.PAD), PANEL)
    return images.land(sheet, destination), provenance


# ------------------------------------------------ the four figures that are re-picked


def maxiter(destination: Path) -> tuple[tuple[int, int], list[str]]:
    """One location at a hand-set cap and at the one the depth policy gives it."""
    low = _panel("rf2-cap-low", dict(DEEP, mode="smooth", colormap=DEEP_MAP, maxiter=LOW_CAP))
    auto = _panel("rf2-cap-auto", dict(DEEP, mode="smooth", colormap=DEEP_MAP))
    provenance = [
        "builder.fundamentals:maxiter — one location, one palette, two caps.",
        _render_line("mandelbrot", DEEP["viewport"], DEEP_MAP).replace(
            "maxiter auto (the depth policy)", f"maxiter {LOW_CAP}"
        ),
        _render_line("mandelbrot", DEEP["viewport"], DEEP_MAP) + " — 32,474 at this width",
    ]
    panels = [
        (low, f"cap {LOW_CAP:,}, set by hand"),
        (auto, "cap 32,474, set by the depth policy"),
    ]
    return _two_up(panels, destination), provenance


def supersample(destination: Path) -> tuple[tuple[int, int], list[str]]:
    """One frame at one sample a pixel and at the pipeline's sixteen."""
    from PIL import Image

    small = (PANEL[0] // 2, PANEL[1] // 2)
    panels = []
    provenance = [
        "builder.fundamentals:supersample — both panels rendered at 320x180 and enlarged "
        "x2 by nearest neighbour, so single pixels are visible.",
    ]
    for samples in (1, PRODUCTION_SS):
        drawn = renders.Cache().render(
            f"rf2-ss-{samples}",
            dict(FILAMENTS, mode="smooth", colormap=FILAMENT_MAP),
            small,
            supersample=samples,
            colormap=None,
        )
        # Keyed on the render, not on the sample count: the enlarged file is written once
        # and never overwritten, so a name that says only `ss-1` hands back the previous
        # location's picture the first time this figure is re-picked. It did.
        enlarged = _work(f"ss-{samples}-{drawn.key}.png")
        if not enlarged.is_file():
            with Image.open(drawn.path) as opened:
                opened.resize(PANEL, Image.NEAREST).save(enlarged)
        text = (
            "1 sample per pixel"
            if samples == 1
            else f"{samples} x {samples} = {samples * samples} samples per pixel "
            "(the pipeline's setting)"
        )
        panels.append((enlarged, text))
        view = FILAMENTS["viewport"]
        provenance.append(
            "fractal-engine render: multibrot degree "
            f"{FILAMENTS['family']['degree']}, centre {view['center_re']} + "
            f"{view['center_im']}i, width {view['width']}, {small[0]}x{small[1]}, "
            f"supersample {samples}"
            + (
                " (16 samples a pixel, curation.run.RELEASE_SUPERSAMPLE)"
                if samples == PRODUCTION_SS
                else ""
            )
            + f", mode smooth, colormap {FILAMENT_MAP}, maxiter auto (the depth policy)"
        )
    provenance.append(
        "Tile A11 of the pass-1 re-pick sheet, whole and uncropped and in its own map: the "
        "sheet draws a tile through the rated row's mode, curve, palette recipe and "
        "colormap over its own viewport at 320x180, which is this figure's panel exactly. "
        "The row is smooth_render/p_ge4_calibration_smooth.jsonl:95 — smooth, curve linear, "
        "recipe the engine's default, cap 34,797, which is also what the depth policy gives "
        "at this width. The 1-sample panel is byte-identical to the tile that was picked."
    )
    return _two_up(panels, destination), provenance


#: How tall the gradient strip under a cyclicity panel is, and how far it sits below it.
CYCLE_STRIP_HEIGHT = 26
CYCLE_STRIP_GAP = 6


def _cycled_strip(cycles: int, width: int, height: int):
    """The gradient as one panel spends it: the engine's own ramp, laid down k times.

    `fractal-wallpapers palettes strip` draws a map once and takes no cycle count, so the
    repeat is composed here — out of k engine-drawn ramps side by side rather than one ramp
    stretched, so that no pixel of this strip is a colour Python interpolated. The map is
    cyclic, so the strip is unfolded, and the renders above it carry mirror false: the two
    agree about the map before they are put together.
    """
    from PIL import Image

    each = -(-width // cycles)
    with Image.open(palette_module.strip(CYCLIC_MAP, each, height)) as opened:
        base = opened.convert("RGB")
    band = Image.new("RGB", (each * cycles, height))
    for index in range(cycles):
        band.paste(base, (index * each, 0))
    return band.crop((0, 0, width, height))


def _over_strip(picture: Path, cycles: int) -> Path:
    """One panel with its own spent gradient under it, as a single tile for the grid."""
    from PIL import Image

    with Image.open(picture) as opened:
        top = opened.convert("RGB")
    tall = PANEL[1] + CYCLE_STRIP_GAP + CYCLE_STRIP_HEIGHT
    composed = Image.new("RGB", (PANEL[0], tall), WELL)
    composed.paste(top, (0, 0))
    composed.paste(
        _cycled_strip(cycles, PANEL[0], CYCLE_STRIP_HEIGHT), (0, PANEL[1] + CYCLE_STRIP_GAP)
    )
    out = _work(f"cyclic-with-strip-{cycles}.png")
    composed.save(out)
    return out


CYCLIC_PROVENANCE = (
    "builder.fundamentals:cyclic_repeats — four panels at 640x360, supersample 3, one "
    "location and one cyclic palette swept k times. The frame is candidate ledger key "
    "0daf678f61143941, seat 336 of the tentative gallery 20260902T161757Z, a record "
    "fractal-wallpapers removed in 2af7886 (2026-09-21) and that no kept record re-seats; "
    "the seat and its recipe are held in article/figure-recipes.jsonl, read from 2af7886^. "
    "The location is addressed by its own key rather than by a position in anything. "
    "The **map is this figure's own** and not that seat's *(Matt, 2026-09-02)*: "
    f"{CYCLIC_MAP}, an authored map, replacing the extracted nova-25 the seat was drawn in. "
    "It is the same map the second column of `render-discrete-and-smooth` is drawn in, "
    "which is the one place this page repeats a palette and is Matt's own call: the two "
    "figures are four screens apart and the one a reader has already met is the one that "
    "teaches what a ramp is. nova-25 closes by *mirroring* — colour(t) equals colour(1-t) "
    "exactly, measured 0.000 — so one sweep of it is already two mirrored halves and k "
    "sweeps read as 2k bands, which is the one thing this figure must not do. An authored "
    "map closes by travelling a loop instead: 90% of the library's extracted maps are "
    "palindromes and not one of its 375 authored maps is, while every map the library calls "
    "cyclic closes exactly, so the seam a repeat could show is never the thing being traded "
    "away. Nothing replays the ledger's own cap of 6,698 — the panels are drawn at the "
    "engine's depth policy, which answers the same number at this frame. Under each panel, "
    "6px below it and 26px tall, the gradient as that panel spends it: `fractal-wallpapers "
    "palettes strip` for the map at width 640/k, laid down k times across the panel's "
    "width. The strip command takes no cycle count, so the repeat is composed from k "
    "engine-drawn ramps rather than one stretched — the map is cyclic and so drawn "
    "unfolded, which is the mirror false the renders above carry."
)


CYCLIC_SWEEPS = (1, 2, 3, 4)
CYCLIC_COLUMNS = 2


def cyclic_repeats() -> Split:
    """One location and one cyclic palette, swept once, twice, three and four times.

    **Four pictures rather than one** *(figure_split_all_ckpt140, 2026-09-22)*. `cycles`
    is a key the permalink contract carries, so each sweep is a link of its own and a
    reader can reach for the control the figure is about. The gradient strip under each
    picture stays in the pixels: it is the map as that panel spends it, drawn by the
    palette CLI next door, and it is part of the panel rather than a label on it.
    """
    identifier = "render-cyclic-repeats"
    provenance = [CYCLIC_PROVENANCE]
    made = []
    for index, k in enumerate(CYCLIC_SWEEPS, start=1):
        spec = dict(JULIA, mode="smooth", colormap=CYCLIC_MAP, palette={"cycles": float(k)})
        drawn = _panel(f"rf2-cyc-{k}", spec)
        made.append(
            Made(
                sheets.save(_open_rgb(_over_strip(drawn, k)), panel_path(identifier, index)),
                alt=(
                    f"One Julia set drawn through a cyclic palette swept {k} "
                    f"time{'s' if k > 1 else ''}, with that sweep's gradient under it."
                ),
                label=f"k = {k}",
                spec=spec,
            )
        )
        view = JULIA["viewport"]
        c = JULIA["family"]["c"]
        provenance.append(
            f"fractal-engine render: julia degree 2, c = {c[0]} + {c[1]}i, centre "
            f"{view['center_re']} + {view['center_im']}i, width {view['width']}, "
            f"640x360, supersample 3, mode smooth, colormap {CYCLIC_MAP}, palette cycles "
            f"{float(k)}, maxiter auto (the depth policy)"
        )
    return Split(made, provenance, CYCLIC_COLUMNS)


def _open_rgb(path: Path):
    from PIL import Image

    with Image.open(path) as picture:
        return picture.convert("RGB")


def percentile_stretch(destination: Path) -> tuple[tuple[int, int], list[str]]:
    """One field spread across its whole range, and stretched against its own distribution."""
    from . import fields  # needs numpy; see `field_anatomy`

    stem = _work("fields", "autolevel")
    renders.dump_field(
        dict(SKEWED, resolution=list(PANEL), supersample=1, mode="smooth", colormap=SKEWED_MAP),
        stem,
    )
    field, _ = fields.read_field(stem)
    linear_low, linear_span = fields.whole_range(field)
    stretched_low, stretched_span = fields.stretched_range(field)
    flat, done = _work("autolevel-linear.png"), _work("autolevel-leveled.png")
    fields.paint(field, SKEWED_MAP, low=linear_low, span=linear_span).save(flat)
    fields.paint(field, SKEWED_MAP, low=stretched_low, span=stretched_span).save(done)
    provenance = [
        "builder.fundamentals:percentile_stretch — neither panel is an engine render: the "
        "engine's coloring stage always stretches against the frame's own percentiles, so "
        "the whole-range panel cannot be asked for. Both are painted from one dumped field "
        "by builder/fields.py, which reproduces the engine's own render of that field at "
        "max channel difference 0 and differs only in the working range it is given.",
        "`fractal-engine dump-field`: mandelbrot, centre -0.1592 + 1.0341i, width 0.10, "
        f"640x360, supersample 1, mode smooth, colormap {SKEWED_MAP}, maxiter auto (the "
        "depth policy)",
        f"left: painted with colormap {SKEWED_MAP} over the frame's whole range, "
        f"{linear_low:,.0f} to {linear_low + linear_span:,.0f}",
        f"right: painted with colormap {SKEWED_MAP} over the leveled range, "
        f"{stretched_low:,.0f} to {stretched_low + stretched_span:,.0f} (the 0.5th and "
        "99.5th percentiles of the same field)",
    ]
    panels = [
        (flat, "the palette spread linearly over the frame's whole range"),
        (done, "the same field, leveled against its own distribution"),
    ]
    return _two_up(panels, destination), provenance


#: Figure id to the maker that draws it.
SHEETS = {
    "render-cyclic-repeats": cyclic_repeats,
    "render-discrete-and-smooth": discrete_and_smooth,
    "render-field-anatomy": field_anatomy,
    "render-maxiter": maxiter,
    "render-percentile-stretch": percentile_stretch,
    "render-supersample": supersample,
}

#: The figures of this page that are **split** — panels rather than one composited sheet.
#: The other five are before-and-after pairs and a three-across comparison of one field:
#: the juxtaposition is the claim in every one of them, which is the case the split rule
#: names as the one to leave composited.
SPLIT = frozenset({"render-cyclic-repeats"})


def recipe(identifier: str) -> dict:
    """The registry recipe for a figure here: the maker, and no arguments."""
    if identifier not in SHEETS:
        raise renders.EngineError(f"{identifier} is not drawn by builder.fundamentals")
    return {"maker": f"{__name__}:{SHEETS[identifier].__name__}", "args": {}}


def draw(identifier: str) -> Drawn | Split:
    """Draw one figure into `artifacts/figures/`; `--place` is what encodes and lands it.

    A composited figure here still writes one lossless sheet, which is what a split of it
    would later be measured against; a split one writes a file per panel. Nothing lands in
    the site's asset directory from a draw, the way `locations` and `picks` already work.
    """
    maker = SHEETS[identifier]
    if identifier in SPLIT:
        return maker()
    destination = sheet_path(identifier)
    answer = maker(destination)
    provenance = answer[1] if isinstance(answer[0], tuple) else []
    return Drawn(destination, list(provenance))
