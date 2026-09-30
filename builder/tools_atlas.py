"""The atlas figure of the Tools and data page: every plane's plate, small, with its dots.

    tools-atlas — one panel per plane of the atlas record, in the record's order, each the
    plate a reader meets on the explorer's Atlas tab with every kept place marked on it,
    and each linking to the Atlas tab open at that plane.

**Nothing here is chosen.** The planes are the partitions `atlas/atlas.jsonl` lists, in its
order; the picture of each is the plate the record names, `assets/images/atlas/plate-*.jpg`,
exactly as the atlas frame shows it; the dots are the plane's dot file, each at its own
`px`/`py` on that plate, in the file's order. A rerun after an atlas re-ingest redraws
whatever the record then says and nothing else.

**The marks are the frame's own**, transcribed because Pillow cannot read CSS: the two
place colours `builder.atlas.MARK_COLOR` already carries from `atlas/frame.css`, and the
geometry of `.mark::before` — a 9 px dot, a 1 px light ring at 72 % white, and a soft dark
halo 2 px out at 55 % black. They are drawn at the size they have on a plate the width of
`frame.js`'s `LEAST`, the narrowest plate the studio draws, because a panel here is shown
at about that width; so a panel reads as the tab does at its narrowest, dots overlapping
where the tab's do. `builder.atlas.draw`, the retired `atlas-places` still, drew a darker
ring at a fraction of the plate's own width; the frame has moved on since, and this follows
the frame.

**The link is to the Atlas tab, not to the plate**, because a plate is drawn in
`atlas_grey`, a ramp the explorer does not carry, and a view of the plane in the explorer's
default map is not this picture. So each panel is a `link` panel: its link is the plane's
home view in the explorer's canonical spelling, asked of `permalink.js` through
`builder.go.read`, with `panel=atlas` put on top the way `withKeys` puts it, which is how
the frame's own links land a reader on the tab. The explorer opens the tab at the plane the
view belongs to (`explorer.js`'s `planeOf`), and a home view is that plane's.
"""

from __future__ import annotations

import re

from . import atlas as atlas_module
from . import figures as figures_module
from . import go, records
from . import recipes as recipes_module
from .locations import Made, Split, panel_path, panels
from .paths import SITE_ROOT

ID = "tools-atlas"

#: Three across: the record holds six planes, and six in rows of four and three is not a
#: layout six can take. Two rows of three is the most balanced two rows six makes.
COLUMNS = 3

#: A plate is 9:8, and a panel keeps its shape rather than cropping it to the article's
#: 16:9, because a plate is cropped to its set at that aspect and 16:9 would cut the set.
PLATE_ASPECT = 9 / 8

#: The frame's mark, in CSS pixels, from `atlas/frame.css`'s `.mark::before`: the dot's
#: diameter, its light ring, and the dark halo's blur and spread.
DOT = 9
RING = 1
RING_WHITE = 0.72
HALO_BLUR = 2
HALO_SPREAD = 1
HALO_BLACK = 0.55

#: The plate width, in CSS pixels, the marks are drawn to scale against: `frame.js`'s
#: `LEAST`, the narrowest plate the studio's frame draws.
FRAME_LEAST = 320

#: What a link to the tab carries on top of the picture's own keys, as `withKeys` spells
#: it. `panel` is `permalink.js`'s own UI key, and `atlas` the tab's `data-panel`.
ATLAS_PANEL = ("panel", "atlas")

PERMALINK = SITE_ROOT / "explorer" / "permalink.js"
_VERSION = re.compile(r"export const VERSION = (\d+);")


class ToolsAtlasError(RuntimeError):
    """The atlas figure cannot be drawn as the record describes it."""


def _version() -> str:
    found = _VERSION.search(PERMALINK.read_text(encoding="utf-8"))
    if found is None:
        raise ToolsAtlasError(f"{PERMALINK.name} states no VERSION")
    return found.group(1)


def tab_links(partitions) -> dict[str, str]:
    """Each plane's Atlas-tab link: its home view as the explorer spells it, plus the tab.

    The home view is asked for by naming the family and nothing else, and the explorer's
    own reader answers with the canonical string; a link that did not survive being read
    back as itself would be refused here rather than written down.
    """
    version = _version()
    asked = {one.name: f"v={version}&f={one.family}" for one in partitions}
    answers = go.read(asked)
    found = {}
    for name, answer in answers.items():
        if not answer.get("ok"):
            raise ToolsAtlasError(f"{name}: the explorer refuses its home view: {answer}")
        found[name] = f"{answer['canonical']}&{ATLAS_PANEL[0]}={ATLAS_PANEL[1]}"
    again = go.read(found)
    for name, answer in again.items():
        if not answer.get("ok") or f"{answer['canonical']}&panel=atlas" != found[name]:
            raise ToolsAtlasError(f"{name}: {found[name]} does not read back as itself")
    return found


def _marked(partition, size: tuple[int, int]):
    """The plate with every dot drawn over it the way the frame draws a mark."""
    from PIL import Image, ImageDraw, ImageFilter

    with Image.open(partition.plate.path) as plate:
        sheet = plate.convert("RGB")
    if sheet.size != (partition.plate.width, partition.plate.height):
        raise ToolsAtlasError(f"{partition.plate.file} is not the size its record says")
    # One CSS pixel of a `FRAME_LEAST` plate, in this plate's pixels; the marks are drawn
    # at full size and the whole panel downscaled once, which antialiases them.
    unit = sheet.width / FRAME_LEAST
    dot = DOT / 2 * unit
    ring = dot + RING * unit
    # Both of the frame's shadows are spread from the dot's own edge, so the halo's shape is
    # the ring's and its blur is what carries it past the ring. The halos go down first,
    # under every mark, where the frame lays each one under its own mark only: a halo is 55 %
    # black at its densest and a panel is a third of a column, so the two are the same
    # picture at any size a reader sees one at.
    halo = dot + HALO_SPREAD * unit

    shadow = Image.new("L", sheet.size, 0)
    shading = ImageDraw.Draw(shadow)
    for one in partition.dots:
        x, y = one.px, one.py
        shading.ellipse((x - halo, y - halo, x + halo, y + halo), fill=255)
    shadow = shadow.filter(ImageFilter.GaussianBlur(HALO_BLUR * unit / 2))
    sheet.paste((0, 0, 0), mask=shadow.point(lambda value: round(value * HALO_BLACK)))

    # Ring then dot, one mark at a time in the file's order, so a later mark sits over an
    # earlier one exactly as a later element does in the frame.
    white = round(255 * RING_WHITE)
    layer = sheet.convert("RGBA")
    solid = ImageDraw.Draw(layer)
    for one in partition.dots:
        x, y = one.px, one.py
        # The ring is translucent, so it is drawn on a tile of its own and composited; a
        # tile the plate's size per mark would be a hundred full-size layers.
        left, top = int(x - ring) - 1, int(y - ring) - 1
        side = int(2 * ring) + 3
        tile = Image.new("RGBA", (side, side), (0, 0, 0, 0))
        ImageDraw.Draw(tile).ellipse(
            (x - ring - left, y - ring - top, x + ring - left, y + ring - top),
            fill=(255, 255, 255, white),
        )
        # Pillow refuses a negative destination, so a mark at the plate's edge loses the
        # part of its tile that lies off the plate rather than the whole mark.
        layer.alpha_composite(
            tile, dest=(max(left, 0), max(top, 0)), source=(max(-left, 0), max(-top, 0))
        )
        solid.ellipse((x - dot, y - dot, x + dot, y + dot), fill=atlas_module.MARK_COLOR[one.plane])
    return layer.convert("RGB").resize(size, Image.Resampling.LANCZOS)


def _counts(partition) -> dict[str, int]:
    counted = {"mandelbrot": 0, "julia": 0}
    for one in partition.dots:
        counted[one.plane] += 1
    return counted


def _alt(partition) -> str:
    counted = _counts(partition)
    total = len(partition.dots)
    if partition.name == "phoenix":
        return (
            f"The Phoenix atlas: the classic Phoenix slice in gray, marked with {total} red "
            "dots, each a place on the slice good enough for the gallery."
        )
    return (
        f"The atlas for {partition.title}: the parameter plane in gray, marked with {total} "
        f"dots, {counted['mandelbrot']} blue for places on the plane and {counted['julia']} "
        "red for the values of c whose Julia sets hold one, each a place good enough for the "
        "gallery."
    )


def _family_words(partition, raw: dict) -> str:
    """The plate's family as provenance spells a frame, so `Figure.frames` reads it."""
    family = partition.family
    if family.startswith("multibrot"):
        return f"multibrot degree {family.removeprefix('multibrot')}"
    if family == "phoenix":
        constants = raw["plate"].get("constants") or {}
        return (
            f"phoenix, c = {constants['cx']} + {constants['cy']}i, p = {constants['px']} + "
            f"{constants['py']}i, z_prev = {constants['zx']} + {constants['zy']}i"
        )
    return family


def make() -> Split:
    """Every plane's plate with its dots, one panel each, in the record's order."""
    atlas = atlas_module.load_all()
    raw = {
        row.fields["partition"]: row.fields
        for row in records.read(atlas_module.ATLAS_INDEX)
        if row.kind == "partition"
    }
    size = panels(COLUMNS, aspect=PLATE_ASPECT)
    linked = tab_links(atlas.partitions)
    kept: dict[str, dict] = {}
    made: list[Made] = []
    lines = [
        f"builder.tools_atlas:make — {len(atlas.partitions)} panels at {size[0]}x{size[1]}, "
        f"{COLUMNS} across, landed one file a panel: every partition of atlas/atlas.jsonl in "
        "the record's order, each its plate as the record names it (drawn once by `python -m "
        "builder atlas --plates` at the engine's measured extent widened to 9:8 with a tenth "
        "of air, 2052x1824, through builder/data/atlas-grey.json) downscaled once with "
        "Lanczos, with every dot of the plane's dot file drawn at its own px/py in the file's "
        "order. The marks are atlas/frame.css's .mark::before (9 px dot in #4d8df0 for a "
        "place on the parameter plane or #f2584c for a Julia or Phoenix place, 1 px ring at "
        "72% white, 2 px dark halo at 55%) at the scale of frame.js's LEAST, a 320 px plate. "
        f"Atlas record {atlas.record}, made {atlas.made}, fine bar {atlas.fine_bar}: a dot is "
        "a place with at least one row at or above the solve's own fine bar. Nothing was "
        "chosen; the panels are every plane the record holds. Each panel links to the "
        "explorer's Atlas tab at its plane: the plane's home view as permalink.js spells it, "
        "with panel=atlas, kept in article/figure-recipes.jsonl under link|tools-atlas#<n>.",
    ]
    for index, partition in enumerate(atlas.partitions, start=1):
        row = raw[partition.name]
        plate = row["plate"]
        counted = _counts(partition)
        picture = _marked(partition, size)
        path = panel_path(ID, index)
        picture.save(path, format="PNG")
        key = f"{recipes_module.LINK}{recipes_module.SEPARATOR}{ID}#{index}"
        kept[key] = {
            "link": linked[partition.name],
            "plane": partition.name,
            "maker": f"{__name__}:make",
        }
        made.append(Made(path, alt=_alt(partition), label=partition.title, link=key))
        lines.append(
            f"panel {index}, {partition.title}: {_family_words(partition, row)}, centre "
            f"{plate['x']} + {plate['y']}i, width {plate['w']}, mode {plate['mode']}, "
            + ("colormap" if index == 1 else "palette")
            + f" {plate['colormap']}, supersample {plate['supersample']}, cap "
            f"{plate['maxiter']} — assets/images/atlas/{plate['file']}; "
            f"{len(partition.dots)} dots from atlas/{partition.file} ({counted['mandelbrot']} "
            f"blue, {counted['julia']} red); link {linked[partition.name]}."
        )
    _KEPT[ID] = kept
    return Split(made, lines, COLUMNS)


#: The link rows the last `make` derived, for `keep` to write as the figure lands.
_KEPT: dict[str, dict[str, dict]] = {}

#: What each link row says it is, in its `read`.
LINK_READ = (
    "a link into the explorer's Atlas tab at this plane's home view, spelled by "
    "permalink.js with panel=atlas on top the way withKeys puts it; the picture is the "
    "atlas plate with its dots, drawn by builder.tools_atlas, not a render of the link"
)


def keep(identifier: str = ID) -> None:
    """Write the panels' link rows into `article/figure-recipes.jsonl`, as the figure lands."""
    if identifier != ID:
        return
    recipes_module.keep_drawn(recipes_module.LINK, _KEPT[ID], LINK_READ, figure=ID)


def sources(identifier: str = ID) -> list[dict]:
    """Nothing next door stands behind a plate: the atlas record here is the record."""
    return [{"kind": figures_module.SYNTHETIC, "keys": []}]


def recipe(identifier: str = ID) -> dict:
    return {
        "maker": f"{__name__}:make",
        "args": {"record": "atlas/atlas.jsonl", "columns": COLUMNS},
    }
