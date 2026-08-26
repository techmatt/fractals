"""The atlas record: what a dot on the atlas page is made of, and what holds it to shape.

The atlas page draws one dot per place the search kept, over the plane that place sits
in, and every dot opens in the explorer at the view it stands for. The record below is
the **contract between the wallpaper project's maker and this page**: the maker writes
it, the page reads it, and neither composes a key the other did not put there.

That last rule is the whole point of the file. A page that worked out a location's
viewport from a position in a list — or an index into a pool derived from live data —
would draw at a moving target, and a rerun next door would silently repoint every dot.
So a dot carries **its own** viewport keys, spelled the way the permalink contract
spells them, and the page hands them to `permalink.js` without arithmetic.

## The shape

`atlas/atlas.jsonl` is the index and carries no dots:

* one **`method`** row — how the record was made, whether it is a fixture, and the node
  view every unjudged dot is drawn at;
* one **`partition`** row per partition — the plane its dots are drawn over, the family
  that plane is a picture of, the separation radius its dots were thinned at, and the
  file its dots are in.

`atlas/<partition>.jsonl` carries the partition's own rows:

* one **`dot`** row per place — `location_key` as its identity, `x`/`y`/`w` (and
  `cx`/`cy` on a dynamical family) as the view, `at` as the point on the atlas plane it
  is drawn at, and a `judged` block where a render judge has already scored a colored
  render of it;
* one **`density`** row — the whole keeper population binned over the same plane, which
  is what the heatmap draws. Sparse: 106 of 40,000 bins are lit, and a dense grid would
  be forty thousand zeroes.

**`at` is a place on a picture, not an identity**, which is why it is a JSON number and
the viewport keys are decimal strings. On a parameter plane it is the frame's own centre;
on a dynamical one it is `c`, because the plane a Julia atlas is drawn over is the
parameter plane its `c` came out of. The page never works out which — it reads `at`.

## The fixture

Everything under *the fixture* below writes a **synthetic** record so that the page can
be built and looked at before the maker exists. It is deliberately obvious: every
`location_key` opens with `fixture:`, the method row says `"fixture": true`, and the page
says so above the plot. It goes when the real record lands, and so does this half of this
file.
"""

from __future__ import annotations

import json
import math
import random
import subprocess
from dataclasses import dataclass
from pathlib import Path

from . import images, records
from .paths import IMAGES_DIR, SITE_ROOT

ATLAS_DIR = SITE_ROOT / "atlas"
ATLAS_INDEX = ATLAS_DIR / "atlas.jsonl"
THUMBS_DIR = IMAGES_DIR / "atlas"

#: The families a plane may be a picture of. The permalink contract is the authority on
#: what a link may *say* — it is written in JavaScript, and a second reading of it in
#: Python is exactly what a URL contract cannot survive — so this is the shorter
#: question: which families this record is allowed to name at all.
FAMILIES = (
    "mandelbrot",
    "multibrot3",
    "multibrot4",
    "multibrot5",
    "julia",
    "julia3",
    "julia4",
    "julia5",
    "phoenix",
)

#: The constants a family's view needs beside `x`, `y` and `w`, keyed as the permalink
#: keys them. A dot on a family not listed here carries none.
CONSTANTS = {
    "julia": ("cx", "cy"),
    "julia3": ("cx", "cy"),
    "julia4": ("cx", "cy"),
    "julia5": ("cx", "cy"),
    "phoenix": ("cx", "cy", "px", "py", "zx", "zy"),
}

#: The permalink contract's own cap on a coordinate string, restated as a bound rather
#: than as a rule: a record that wrote a longer one would produce a link that is refused.
COORDINATE_LIMIT = 64


class AtlasError(Exception):
    """The atlas record said something the page could not read."""


@dataclass(frozen=True)
class Thumb:
    """A colored render the maker has already drawn, as a file under `assets/images/`."""

    file: str
    width: int
    height: int

    @property
    def path(self) -> Path:
        return THUMBS_DIR / self.file


@dataclass(frozen=True)
class Judged:
    """What a render judge made of one colored render of a dot."""

    palette: str
    mode: str
    score: float
    thumb: Thumb | None


@dataclass(frozen=True)
class Dot:
    """One place on the atlas: its identity, its view, and where it is drawn."""

    key: str
    family: str
    view: dict[str, str]
    at: tuple[float, float]
    keepers: int
    score: float
    judged: Judged | None


@dataclass(frozen=True)
class Density:
    """The whole keeper population binned over the partition's plane, sparsely."""

    bins: tuple[int, int]
    total: int
    cells: tuple[tuple[int, int, int], ...]

    @property
    def peak(self) -> int:
        return max((count for _, _, count in self.cells), default=0)


@dataclass(frozen=True)
class Plane:
    """The frame an atlas is drawn over, and the family that frame is a picture of."""

    family: str
    x: str
    y: str
    w: str
    aspect: tuple[int, int]

    @property
    def height(self) -> float:
        return float(self.w) * self.aspect[1] / self.aspect[0]


@dataclass(frozen=True)
class Partition:
    """One partition's atlas: its plane, its dots, and its density grid."""

    name: str
    title: str
    family: str
    file: str
    radius: float
    keepers: int
    plane: Plane
    says: str
    dots: tuple[Dot, ...]
    density: Density

    @property
    def judged(self) -> tuple[Dot, ...]:
        return tuple(dot for dot in self.dots if dot.judged is not None)


@dataclass(frozen=True)
class Atlas:
    """The whole record: how it was made, and one entry per partition."""

    fixture: bool
    made: str
    node_view: dict
    partitions: tuple[Partition, ...]


# --------------------------------------------------------------------------- reading


def _decimal(row: records.Record, key: str) -> str:
    """A coordinate as the decimal string it is the identity of."""
    text = row.text(key)
    if len(text) > COORDINATE_LIMIT:
        raise AtlasError(f"{row.where}: {key} is longer than {COORDINATE_LIMIT} characters")
    try:
        float(text)
    except ValueError as error:
        raise AtlasError(f"{row.where}: {key}={text!r} is not a number") from error
    return text


def _number(row: records.Record, value: object, what: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise AtlasError(f"{row.where}: {what} must be a number")
    if not math.isfinite(value):
        raise AtlasError(f"{row.where}: {what} must be finite")
    return float(value)


def _thumb(row: records.Record, fields: dict | None) -> Thumb | None:
    if fields is None:
        return None
    if not isinstance(fields, dict):
        raise AtlasError(f"{row.where}: thumb must be an object")
    file = fields.get("file")
    width, height = fields.get("width"), fields.get("height")
    if not isinstance(file, str) or "/" in file or not file:
        raise AtlasError(f"{row.where}: thumb.file must be a bare file name")
    for name, value in (("width", width), ("height", height)):
        if not isinstance(value, int) or isinstance(value, bool) or value <= 0:
            raise AtlasError(f"{row.where}: thumb.{name} must be a positive integer")
    return Thumb(file=file, width=width, height=height)


def _judged(row: records.Record) -> Judged | None:
    fields = row.optional_mapping("judged")
    if fields is None:
        return None
    for key in ("palette", "mode"):
        if not isinstance(fields.get(key), str) or not fields[key]:
            raise AtlasError(f"{row.where}: judged.{key} must be a non-empty string")
    return Judged(
        palette=fields["palette"],
        mode=fields["mode"],
        score=_number(row, fields.get("score"), "judged.score"),
        thumb=_thumb(row, fields.get("thumb")),
    )


def _dot(row: records.Record, family: str) -> Dot:
    row.expect_kind("dot")
    key = row.text("location_key")
    named = row.text("family")
    if named != family:
        raise AtlasError(f"{row.where}: family {named!r}, and the partition is {family!r}")
    view = {name: _decimal(row, name) for name in ("x", "y", "w")}
    if float(view["w"]) <= 0:
        raise AtlasError(f"{row.where}: w is the width of the view, so it has to be positive")
    for name in CONSTANTS.get(family, ()):
        view[name] = _decimal(row, name)
    for name in ("cx", "cy", "px", "py", "zx", "zy"):
        if name in row.fields and name not in view:
            raise AtlasError(f"{row.where}: {family} has no {name} constant")
    at = row.fields.get("at")
    if not isinstance(at, list) or len(at) != 2:
        raise AtlasError(f"{row.where}: at must be two numbers — the point the dot is drawn at")
    place = (_number(row, at[0], "at[0]"), _number(row, at[1], "at[1]"))
    return Dot(
        key=key,
        family=family,
        view=view,
        at=place,
        keepers=row.count("keepers"),
        score=_number(row, row.fields.get("score"), "score"),
        judged=_judged(row),
    )


def _density(row: records.Record) -> Density:
    row.expect_kind("density")
    bins = row.fields.get("bins")
    if not isinstance(bins, list) or len(bins) != 2:
        raise AtlasError(f"{row.where}: bins must be two positive integers")
    across, down = bins
    for value in (across, down):
        if not isinstance(value, int) or isinstance(value, bool) or value <= 0:
            raise AtlasError(f"{row.where}: bins must be two positive integers")
    cells = row.fields.get("cells")
    if not isinstance(cells, list) or not cells:
        raise AtlasError(f"{row.where}: cells must be a non-empty list of [ix, iy, count]")
    held: list[tuple[int, int, int]] = []
    seen: set[tuple[int, int]] = set()
    for cell in cells:
        if not isinstance(cell, list) or len(cell) != 3:
            raise AtlasError(f"{row.where}: every cell is [ix, iy, count]")
        ix, iy, count = cell
        for value in (ix, iy, count):
            if not isinstance(value, int) or isinstance(value, bool):
                raise AtlasError(f"{row.where}: every cell is three integers")
        if not (0 <= ix < across and 0 <= iy < down):
            raise AtlasError(f"{row.where}: cell {ix},{iy} is outside a {across}x{down} grid")
        if count <= 0:
            raise AtlasError(f"{row.where}: cell {ix},{iy} is lit and holds {count}")
        if (ix, iy) in seen:
            raise AtlasError(f"{row.where}: cell {ix},{iy} is given twice")
        seen.add((ix, iy))
        held.append((ix, iy, count))
    total = row.count("total")
    counted = sum(count for _, _, count in held)
    if counted != total:
        raise AtlasError(f"{row.where}: the cells hold {counted} and total says {total}")
    return Density(bins=(across, down), total=total, cells=tuple(held))


def _plane(row: records.Record) -> Plane:
    fields = row.optional_mapping("plane")
    if fields is None:
        raise AtlasError(f"{row.where}: a partition names the plane its dots are drawn over")
    family = fields.get("family")
    if family not in FAMILIES:
        raise AtlasError(f"{row.where}: plane.family {family!r} is not a family this site draws")
    aspect = fields.get("aspect")
    if not isinstance(aspect, list) or len(aspect) != 2:
        raise AtlasError(f"{row.where}: plane.aspect is two positive integers")
    across, down = aspect
    for value in (across, down):
        if not isinstance(value, int) or isinstance(value, bool) or value <= 0:
            raise AtlasError(f"{row.where}: plane.aspect is two positive integers")
    held = {}
    for key in ("x", "y", "w"):
        text = fields.get(key)
        if not isinstance(text, str) or not text:
            raise AtlasError(f"{row.where}: plane.{key} must be a decimal string")
        held[key] = text
    if float(held["w"]) <= 0:
        raise AtlasError(f"{row.where}: plane.w has to be positive")
    return Plane(family=family, aspect=(across, down), **held)


def load_all() -> Atlas:
    """The whole atlas record, read and held to its shape."""
    rows = records.read(ATLAS_INDEX)
    head = rows[0]
    head.expect_kind("method")
    node_view = head.optional_mapping("node_view")
    if node_view is None:
        raise AtlasError(f"{head.where}: the method row says what an unjudged dot is drawn at")
    for key in ("mode", "palette"):
        if not isinstance(node_view.get(key), str) or not node_view[key]:
            raise AtlasError(f"{head.where}: node_view.{key} must be a non-empty string")

    partitions: list[Partition] = []
    seen: set[str] = set()
    for row in rows[1:]:
        row.expect_kind("partition")
        name = row.text("partition")
        if name in seen:
            raise AtlasError(f"{row.where}: {name} is listed twice")
        seen.add(name)
        family = row.text("family")
        if family not in FAMILIES:
            raise AtlasError(f"{row.where}: family {family!r} is not a family this site draws")
        file = row.text("file")
        path = ATLAS_DIR / file
        if "/" in file or not path.is_file():
            raise AtlasError(f"{row.where}: no atlas/{file}")
        partitions.append(
            Partition(
                name=name,
                title=row.text("title"),
                family=family,
                file=file,
                radius=_number(row, row.fields.get("radius"), "radius"),
                keepers=row.count("keepers"),
                plane=_plane(row),
                says=row.text("says"),
                **_partition_rows(path, family),
            )
        )
    if not partitions:
        raise AtlasError(f"{ATLAS_INDEX.name}: no partitions")
    return Atlas(
        fixture=head.flag("fixture"),
        made=head.text("made"),
        node_view=node_view,
        partitions=tuple(partitions),
    )


def _partition_rows(path: Path, family: str) -> dict:
    """One partition file's dots and its single density grid."""
    dots: list[Dot] = []
    density: Density | None = None
    keys: set[str] = set()
    for row in records.read(path):
        if row.kind == "density":
            if density is not None:
                raise AtlasError(f"{row.where}: a partition has one density grid")
            density = _density(row)
            continue
        dot = _dot(row, family)
        if dot.key in keys:
            raise AtlasError(f"{row.where}: {dot.key} is in this partition twice")
        keys.add(dot.key)
        dots.append(dot)
    if density is None:
        raise AtlasError(f"{path.name}: no density grid — the heatmap has nothing to draw")
    if not dots:
        raise AtlasError(f"{path.name}: no dots")
    return {"dots": tuple(dots), "density": density}


# --------------------------------------------------------------------------- checking


def problems() -> list[str]:
    """What is wrong with the record, as `check` reports it.

    Shape is held by `load_all`; what is added here is the part that needs the tree
    around it — a dot standing outside the plane it is drawn on, a separation radius the
    dots do not honour, and a thumbnail file that is missing or is not the size its row
    claims. The last of those is Pillow's, and its absence is a named skip rather than a
    pass, the way every other size check on this site treats it.
    """
    try:
        atlas = load_all()
    except (AtlasError, records.RecordError) as error:
        return [str(error)]

    found: list[str] = []
    for partition in atlas.partitions:
        found.extend(_placed(partition))
        found.extend(_separated(partition))
        found.extend(_thumbs(partition))
        if partition.density.total != partition.keepers:
            found.append(
                f"{partition.file}: the density grid holds {partition.density.total} keepers "
                f"and the partition says {partition.keepers} — the heatmap is the whole "
                f"population or it is nothing"
            )
    return found


def _placed(partition: Partition) -> list[str]:
    """Every dot sits inside the plane its partition draws."""
    plane = partition.plane
    half_w, half_h = float(plane.w) / 2, plane.height / 2
    x0, y0 = float(plane.x), float(plane.y)
    found = []
    for dot in partition.dots:
        if abs(dot.at[0] - x0) > half_w or abs(dot.at[1] - y0) > half_h:
            found.append(
                f"{partition.file}: {dot.key} is drawn at {dot.at[0]}, {dot.at[1]}, "
                f"which is outside the plane the partition names"
            )
    return found


def _separated(partition: Partition) -> list[str]:
    """No two dots are closer than the radius the partition says it thinned at.

    The atlas is a thinned population and the radius is the sentence that says so. A
    record whose dots sit closer than it claims is a record whose plot is denser than
    its own description, which is the kind of drift nothing on the page would show.
    """
    if partition.radius <= 0:
        return []
    places = [dot.at for dot in partition.dots]
    for index, (x, y) in enumerate(places):
        for other_x, other_y in places[index + 1 :]:
            if math.hypot(x - other_x, y - other_y) < partition.radius * 0.999:
                return [
                    f"{partition.file}: two dots are closer than the {partition.radius} "
                    f"separation the partition claims"
                ]
    return []


def _thumbs(partition: Partition) -> list[str]:
    """Every pre-rendered thumbnail is on disk at the size its row claims."""
    found = []
    for dot in partition.dots:
        thumb = dot.judged.thumb if dot.judged is not None else None
        if thumb is None:
            continue
        if not thumb.path.is_file():
            found.append(f"{partition.file}: {dot.key} names a thumbnail that is not there")
            continue
        if not images.available():
            continue
        size = images.dimensions(thumb.path)
        if size != (thumb.width, thumb.height):
            found.append(
                f"{partition.file}: {dot.key}'s thumbnail is {size[0]}x{size[1]} on disk "
                f"and {thumb.width}x{thumb.height} in the record"
            )
    return found


def summary() -> list[str]:
    """What the record holds, for `python -m builder atlas`."""
    atlas = load_all()
    lines = [
        f"atlas/atlas.jsonl — made {atlas.made}"
        + (", FIXTURE (synthetic, not the search's own record)" if atlas.fixture else ""),
        f"  node view: {atlas.node_view['mode']} through {atlas.node_view['palette']}",
    ]
    for partition in atlas.partitions:
        widths = sorted(float(dot.view["w"]) for dot in partition.dots)
        median = widths[len(widths) // 2]
        decades = math.log10(widths[-1] / widths[0])
        thumbs = sum(
            1 for dot in partition.judged if dot.judged is not None and dot.judged.thumb is not None
        )
        lines.append(
            f"  {partition.name}: {len(partition.dots)} dots at r={partition.radius:g} "
            f"from {partition.keepers} keepers, {len(partition.judged)} judged "
            f"({thumbs} pre-rendered)"
        )
        lines.append(
            f"    widths {widths[0]:.3g}–{widths[-1]:.3g} ({decades:.1f} decades), "
            f"median {median:.3g}"
        )
        lines.append(
            f"    density: {len(partition.density.cells)} lit of "
            f"{partition.density.bins[0] * partition.density.bins[1]} bins, "
            f"peak {partition.density.peak} "
            f"({partition.density.peak / partition.density.total:.0%} of the population)"
        )
    return lines


# --------------------------------------------------------------------------- the fixture
#
# Everything below writes a synthetic record, so that the page could be designed before
# the maker that fills it exists. It goes when the real record lands.

#: The synthetic population's scale, taken from the audit of the real one so that the
#: page is designed against the shape it will actually have to draw: 2,582 mandelbrot
#: keepers over 106 lit bins with 42% of them in one, thinned to about 92 dots; 67 julia
#: `c`s pre-thinned by the project's own `c` spacing floor.
FIXTURE_SEED = 20260826
MANDELBROT_KEEPERS = 2582
JULIA_KEEPERS = 3698
JULIA_DOTS = 67
THINNING_RADIUS = 0.01
C_SPACING_FLOOR = 0.032
BINS = 200
THUMB_SIZE = (320, 180)

#: Where the search actually spends its time on the parameter plane: the valleys either
#: side of the cusp, the antenna, the two big minibrots, and the north spike. Each is a
#: centre and a spread, and what is scattered around them is walk roots rather than
#: keepers — the keepers arrive tight around a root, which is the whole shape of this.
HOTSPOTS = (
    (-0.7453, 0.1127, 0.030),
    (0.2820, 0.0095, 0.024),
    (-1.2500, 0.0000, 0.036),
    (-0.1592, 1.0317, 0.030),
    (-1.7490, 0.0000, 0.022),
    (0.3600, 0.1000, 0.055),
    (-0.5600, 0.6400, 0.070),
)

#: How many walk roots the fixture plants. A root's keepers all land in one bin of the
#: density grid — they are a walk's returns to one neighbourhood — so thinning at a
#: radius ten times a bin collapses a root to a single dot and the count it stood for
#: leaves the plot entirely. That is the design problem the page has to answer.
ROOTS = 210

#: The keeper counts, in order, that make one bin hold two fifths of everything and two
#: bins hold half. The rest is a decaying tail over the remaining roots.
TOP_KEEPERS = (1084, 207)

#: The descent. A frame at a width of a millionth is only worth looking at if the set's
#: edge runs through it, and a point that is near the edge at plane scale is a long way
#: from it at a millionth — which is why the first fixture drew eighty-nine smooth
#: gradients. So a place is *descended* to: bisect between a point inside and a point
#: outside until the pair is a fraction of the width wanted, and take the midpoint. The
#: cap climbs as the pair closes, because telling inside from outside is what gets hard.
FRAME_SPAN = 8.0
DESCENT_CAP = 300
DESCENT_CAP_MAX = 6000
DESCENT_STEPS_MAX = 46


def _escape(x: float, y: float, cap: int = 400) -> int:
    """How long the orbit of `x + yi` takes to leave, for placing a point near the edge."""
    zx = zy = 0.0
    for step in range(cap):
        zx, zy = zx * zx - zy * zy + x, 2 * zx * zy + y
        if zx * zx + zy * zy > 4.0:
            return step
    return cap


def _held(x: float, y: float, cap: int) -> bool:
    """Whether the parameter `x + yi` is still in hand after `cap` steps."""
    zx = zy = 0.0
    for _ in range(cap):
        zx, zy = zx * zx - zy * zy + x, 2 * zx * zy + y
        if zx * zx + zy * zy > 4.0:
            return False
    return True


def _held_julia(zx: float, zy: float, cx: float, cy: float, cap: int) -> bool:
    """The same question on a dynamical plane: does this `z` stay, under this `c`?"""
    for _ in range(cap):
        zx, zy = zx * zx - zy * zy + cx, 2 * zx * zy + cy
        if zx * zx + zy * zy > 4.0:
            return False
    return True


def _near_boundary(rng: random.Random, cx: float, cy: float, spread: float) -> tuple[float, float]:
    """A point drawn around a hotspot and nudged until it is somewhere interesting.

    "Interesting" is the same thing the search's own gates mean by it: neither escaping
    at once nor buried deep in the interior. A few hundred tries is plenty, and a point
    that never finds one is returned as drawn — this is a fixture, not a search.
    """
    for _ in range(300):
        x = rng.gauss(cx, spread)
        y = rng.gauss(cy, spread)
        if 8 < _escape(x, y) < 400:
            return x, y
    return rng.gauss(cx, spread), rng.gauss(cy, spread)


def _cap_at(step: int) -> int:
    """The iteration cap the descent asks at this step. It climbs as the pair closes."""
    return min(DESCENT_CAP_MAX, round(DESCENT_CAP * 2 ** (step / 5)))


def _pair(rng: random.Random, x: float, y: float, held, radius: float):
    """A point in hand and a point that leaves, both near `x + yi`, or nothing.

    Widened twice before giving up: a filament has interior somewhere near it, and a
    disc that finds none is a disc that is too small rather than a place with none.
    """
    for scale in (radius, radius * 4, radius * 16):
        inside = outside = None
        for _ in range(200):
            px, py = x + rng.uniform(-scale, scale), y + rng.uniform(-scale, scale)
            if held(px, py, DESCENT_CAP):
                inside = inside or (px, py)
            else:
                outside = outside or (px, py)
            if inside is not None and outside is not None:
                return inside, outside
    return None


def _descend(rng: random.Random, x: float, y: float, held, wanted: float, radius: float):
    """A frame the set's own edge runs through, at about the width asked for.

    Returns the frame's centre and its width. The width is what the descent reached
    rather than what was asked, the same way a walk's is: it stops where it stops.
    """
    found = _pair(rng, x, y, held, radius)
    if found is None:
        return (x, y), wanted
    (ax, ay), (bx, by) = found
    apart = math.hypot(ax - bx, ay - by)
    steps = max(0, min(DESCENT_STEPS_MAX, math.ceil(math.log2(FRAME_SPAN * apart / wanted))))
    for step in range(steps):
        mx, my = (ax + bx) / 2, (ay + by) / 2
        if held(mx, my, _cap_at(step)):
            ax, ay = mx, my
        else:
            bx, by = mx, my
    apart = math.hypot(ax - bx, ay - by)
    return ((ax + bx) / 2, (ay + by) / 2), max(1e-12, FRAME_SPAN * apart)


def _widths(rng: random.Random, count: int, median: float, decades: float) -> list[float]:
    """Widths spanning about this many decades with about this median, log-normal.

    The real population's is eight decades wide with its median at 2.4e-6, which is the
    single fact that makes the atlas hard to draw: a dot's place only exists at its own
    scale, and the plane cannot show that.
    """
    sigma = decades / 5.0
    low, high = math.log10(median) - decades / 2, math.log10(median) + decades / 2
    return [10 ** min(high, max(low, rng.gauss(math.log10(median), sigma))) for _ in range(count)]


def _tail(total: int, count: int, head: tuple[int, ...]) -> list[int]:
    """A heavy-tailed share-out of a population over places, with the head written down.

    The head is the audited fact — one place holds two fifths of the keepers, two hold
    half — and the tail is what is left, decaying, so that the median place holds a
    couple of dozen and the last holds a handful.
    """
    held = list(head[:count])
    rest = total - sum(held)
    places = count - len(held)
    weights = [1.0 / (index + 1) ** 0.85 for index in range(places)]
    scale = rest / sum(weights)
    held.extend(max(1, round(weight * scale)) for weight in weights)
    # The rounding has to be given back somewhere, and giving it all to the last place
    # would make the smallest one the third largest. It goes back a unit at a time, from
    # the tail inwards, and never takes a place below one.
    drift = total - sum(held)
    index = len(held) - 1
    while drift != 0:
        step = 1 if drift > 0 else -1
        if held[index] + step >= 1:
            held[index] += step
            drift -= step
        index = len(head) if index <= len(head) else index - 1
    return held


def _thinned(places: list[tuple[float, float]], scores: list[float], radius: float) -> list[int]:
    """Greedy thinning: take the best-scoring place, drop everything within the radius.

    The same rule the real maker runs, and the reason the atlas is about a hundred places
    rather than two and a half thousand.
    """
    order = sorted(range(len(places)), key=lambda index: -scores[index])
    kept: list[int] = []
    for index in order:
        x, y = places[index]
        if all(math.hypot(x - places[other][0], y - places[other][1]) >= radius for other in kept):
            kept.append(index)
    return kept


def _binned(
    places: list[tuple[float, float]], weights: list[int], plane: Plane
) -> list[tuple[int, int, int]]:
    """The population over the partition's own grid, as the sparse cells the record holds.

    A place is binned whole. That is the audit's own finding rather than a convenience:
    a root's keepers are a walk's returns to one neighbourhood, all of them a thousandth
    of a plane apart, and a bin is fifty times that. Scattering them and then counting
    would put a tenth of the biggest place in the bin next door for no reason but the
    jitter, which is exactly how the fixture first lost the 42%.
    """
    width, height = float(plane.w), plane.height
    left, top = float(plane.x) - width / 2, float(plane.y) + height / 2
    counts: dict[tuple[int, int], int] = {}
    for (x, y), weight in zip(places, weights, strict=True):
        ix = min(BINS - 1, max(0, int((x - left) / width * BINS)))
        iy = min(BINS - 1, max(0, int((top - y) / height * BINS)))
        counts[(ix, iy)] = counts.get((ix, iy), 0) + weight
    return [(ix, iy, count) for (ix, iy), count in sorted(counts.items())]


def _digits(value: float) -> str:
    """A coordinate as the decimal string that is its identity, and no longer."""
    return repr(value)


def _offered_palettes() -> list[str]:
    """The maps the explorer's picker offers, read off the roster the bake is held to."""
    roster = SITE_ROOT / "explorer" / "palettes.jsonl"
    names = []
    with roster.open(encoding="utf-8") as handle:
        for raw in handle:
            row = json.loads(raw)
            if row.get("kind") == "palette" and row.get("offered"):
                names.append(row["name"])
    return names


def _write(path: Path, rows: list[dict]) -> None:
    """A JSONL file with LF endings, whatever platform wrote it."""
    body = "".join(json.dumps(row, ensure_ascii=False) + "\n" for row in rows)
    with path.open("w", encoding="utf-8", newline="\n") as handle:
        handle.write(body)


def _mandelbrot_fixture(rng: random.Random, plane: Plane) -> dict:
    """Walk roots around the hotspots, each descended to a frame, then thinned.

    The order matters. Scattering keepers over a hotspot and thinning them would give a
    hundred dots spread evenly across the whole hotspot, which is not what the audit
    found: it found about a hundred *places*, each of which the search returned to over
    and over, and a plot of the thinned set says nothing about how often.
    """
    wanted = _widths(rng, ROOTS, 2.4e-6, 8.0)
    centres: list[tuple[float, float]] = []
    widths: list[float] = []
    for index in range(ROOTS):
        cx, cy, spread = HOTSPOTS[index % len(HOTSPOTS)]
        root = _near_boundary(rng, cx, cy, spread)
        centre, width = _descend(rng, root[0], root[1], _held, wanted[index], spread / 3)
        centres.append(centre)
        widths.append(width)

    counts = _tail(MANDELBROT_KEEPERS, ROOTS, TOP_KEEPERS)

    # A place that stood for a thousand keepers wins its neighbourhood: the thinning is
    # by score next door, and a fertile place scores.
    scores = [
        min(0.99, 0.12 + 0.55 * math.log10(count) / 3 + rng.uniform(-0.05, 0.05))
        for count in counts
    ]
    kept = _thinned(centres, scores, THINNING_RADIUS)

    dots = []
    for rank, index in enumerate(kept):
        x, y = centres[index]
        dots.append(
            {
                "key": f"fixture:mandelbrot:{rank:04d}",
                "family": "mandelbrot",
                "view": {"x": _digits(x), "y": _digits(y), "w": f"{widths[index]:.6g}"},
                "at": [x, y],
                "keepers": counts[index],
                "score": round(scores[index], 4),
            }
        )
    return {"dots": dots, "cells": _binned(centres, counts, plane)}


def _c_pool(rng: random.Random) -> list[tuple[float, float]]:
    """The `c`s a Julia atlas is a picture of: inside the set, and close to its edge.

    Inside, because a `c` outside it has a Julia set with no interior to descend into and
    a page full of dust; close to the edge, because that is where the shapes are and
    where the search's own `c` proposals come from.
    """
    found: list[tuple[float, float]] = []
    guard = 0
    while len(found) < JULIA_DOTS and guard < 60000:
        guard += 1
        cx, cy, spread = HOTSPOTS[rng.randrange(len(HOTSPOTS))]
        x, y = rng.gauss(cx, spread * 6), rng.gauss(cy, spread * 6)
        if not _held(x, y, 600):
            continue
        edge = any(
            not _held(x + 0.012 * math.cos(angle), y + 0.012 * math.sin(angle), 600)
            for angle in (0.0, 1.05, 2.09, 3.14, 4.19, 5.24)
        )
        if not edge:
            continue
        if all(math.hypot(x - a, y - b) >= C_SPACING_FLOOR for a, b in found):
            found.append((x, y))
    return found


def _julia_fixture(rng: random.Random, plane: Plane) -> dict:
    """The `c`-pool: one dot per `c`, drawn over the parameter plane the `c` came out of.

    Nothing is thinned here — the pool is already spaced by the project's own `c` floor,
    and any radius below it is a no-op. What varies is how many keepers a `c` carries,
    which is as unequal as it is on the parameter plane.
    """
    places = _c_pool(rng)
    wanted = _widths(rng, len(places), 3.0e-3, 5.5)
    counts = _tail(JULIA_KEEPERS, len(places), (214, 158))
    rng.shuffle(counts)

    dots = []
    for rank, ((cx, cy), count) in enumerate(zip(places, counts, strict=True)):
        # A Julia keeper's frame is in the dynamical plane, descended there; its dot is
        # at `c`, on the parameter plane the atlas draws.
        held = lambda zx, zy, cap, cx=cx, cy=cy: _held_julia(zx, zy, cx, cy, cap)  # noqa: E731
        seed = (rng.uniform(-0.8, 0.8), rng.uniform(-0.6, 0.6))
        (zx, zy), width = _descend(rng, seed[0], seed[1], held, wanted[rank], 0.55)
        dots.append(
            {
                "key": f"fixture:julia-mandelbrot:{rank:04d}",
                "family": "julia",
                "view": {
                    "x": _digits(zx),
                    "y": _digits(zy),
                    "w": f"{width:.6g}",
                    "cx": _digits(cx),
                    "cy": _digits(cy),
                },
                "at": [cx, cy],
                "keepers": count,
                "score": round(rng.betavariate(2.0, 3.0), 4),
            }
        )
    return {"dots": dots, "cells": _binned(places, counts, plane)}


def write_fixture(judged_count: int = 64) -> list[str]:
    """Write the synthetic record, and say what it holds."""
    rng = random.Random(FIXTURE_SEED)
    palettes = _offered_palettes()
    plane = Plane(family="mandelbrot", x="-0.77", y="0", w="4.4", aspect=(16, 9))
    plane_row = {
        "family": plane.family,
        "x": plane.x,
        "y": plane.y,
        "w": plane.w,
        "aspect": [16, 9],
    }

    made = {
        "mandelbrot": _mandelbrot_fixture(rng, plane),
        "julia-mandelbrot": _julia_fixture(rng, plane),
    }

    # The judged renders are shared out between the partitions in proportion to their
    # dots, and picked at random rather than by score: the judge has not run, and a
    # fixture that pretended it had would be a fixture somebody believed.
    everything = [
        (name, index) for name, built in made.items() for index in range(len(built["dots"]))
    ]
    for name, index in rng.sample(everything, min(judged_count, len(everything))):
        made[name]["dots"][index]["judged"] = {
            "palette": rng.choice(palettes),
            "mode": "smooth",
            "score": round(rng.uniform(3.0, 4.6), 2),
        }

    index_rows = [
        {
            "schema": 1,
            "kind": "method",
            "fixture": True,
            "made": "2026-08-26",
            "generator": "python -m builder atlas --fixture",
            "node_view": {
                "mode": "smooth",
                "palette": "twilight_shifted",
                "width": 384,
                "height": 216,
                "supersample": 1,
            },
            "rule": (
                "SYNTHETIC. Not one dot here came out of the search: the places are drawn "
                "around the parameter plane's own valleys and shaken until they land "
                "somewhere near the boundary, the widths are log-normal, and the scores are "
                "made up. What is real is the SHAPE and the SCALE — the audited population's "
                "counts, its separation radii, its eight decades of width and its one bin "
                "holding two fifths of everything — because that is what the page had to be "
                "designed against. Every location_key opens with `fixture:`, and the page "
                "says so above the plot. It goes when the maker lands."
            ),
        },
        {
            "schema": 1,
            "kind": "partition",
            "partition": "mandelbrot",
            "title": "Mandelbrot",
            "family": "mandelbrot",
            "file": "mandelbrot.jsonl",
            "radius": THINNING_RADIUS,
            "keepers": MANDELBROT_KEEPERS,
            "plane": plane_row,
            "says": "the parameter plane, and every dot is a frame somewhere inside it",
        },
        {
            "schema": 1,
            "kind": "partition",
            "partition": "julia:mandelbrot",
            "title": "Julia",
            "family": "julia",
            "file": "julia-mandelbrot.jsonl",
            "radius": C_SPACING_FLOOR,
            "keepers": JULIA_KEEPERS,
            "plane": plane_row,
            "says": (
                "the c-plane: a dot is one c, and the set behind it is where the joined ones are"
            ),
        },
    ]
    _write(ATLAS_INDEX, index_rows)

    written = []
    for name, built in made.items():
        rows = []
        for dot in built["dots"]:
            row = {
                "schema": 1,
                "kind": "dot",
                "location_key": dot["key"],
                "family": dot["family"],
                **dot["view"],
                "at": dot["at"],
                "keepers": dot["keepers"],
                "score": dot["score"],
            }
            if "judged" in dot:
                row["judged"] = dot["judged"]
            rows.append(row)
        rows.append(
            {
                "schema": 1,
                "kind": "density",
                "bins": [BINS, BINS],
                "total": sum(count for _, _, count in built["cells"]),
                "cells": [list(cell) for cell in built["cells"]],
            }
        )
        _write(ATLAS_DIR / f"{name}.jsonl", rows)
        written.append(f"atlas/{name}.jsonl: {len(built['dots'])} dots, {len(built['cells'])} bins")
    return [f"atlas/{ATLAS_INDEX.name}: {len(index_rows) - 1} partitions", *written]


#: Where a rendered frame lands before Pillow turns it into the JPEG the page ships.
#: Under `artifacts/`, which `.gitignore` already keeps out.
RAW_DIR = SITE_ROOT / "artifacts" / "atlas"

#: The node helper that owns the render on the JavaScript side of the boundary — the
#: explorer's own contract, its own spec builder, and the committed wasm module.
RENDERER = Path(__file__).resolve().parent / "atlas_thumbs.mjs"


def _slug(key: str) -> str:
    """A dot's key as a bare file name. The record names the file; this is what it names."""
    return key.removeprefix("fixture:").replace(":", "-")


def land_thumbs() -> list[str]:
    """Draw every judged dot's picture, and write the file name back into its row.

    The picture is rendered **through the permalink** a dot's own keys spell — see
    `atlas_thumbs.mjs` — so the thumbnail on the page and the view the explorer opens are
    the same view by construction. That is the round trip the page's test pins, and this
    is where it is first spent.
    """
    atlas = load_all()
    jobs: dict[str, dict] = {}
    owners: dict[str, tuple[str, str]] = {}
    for partition in atlas.partitions:
        for dot in partition.judged:
            assert dot.judged is not None
            slug = _slug(dot.key)
            jobs[slug] = {
                "family": dot.family,
                "mode": dot.judged.mode,
                "palette": dot.judged.palette,
                "viewport": dot.view,
            }
            owners[slug] = (partition.file, dot.key)
    if not jobs:
        return ["no judged dots — nothing to draw"]

    RAW_DIR.mkdir(parents=True, exist_ok=True)
    finished = subprocess.run(
        ["node", str(RENDERER), RAW_DIR.as_posix()],
        input=json.dumps(jobs),
        capture_output=True,
        text=True,
        cwd=str(SITE_ROOT),
    )
    if finished.returncode != 0:
        raise AtlasError(f"atlas_thumbs.mjs failed:\n{finished.stderr.strip()}")
    drawn = json.loads(finished.stdout)

    landed: dict[str, Thumb] = {}
    refused: list[str] = []
    for slug, answer in drawn.items():
        if not answer.get("ok"):
            refused.append(f"{owners[slug][1]}: {answer.get('why')}")
            continue
        width, height = answer["width"], answer["height"]
        raw = (RAW_DIR / f"{slug}.rgba").read_bytes()
        images.write_rgba(raw, (width, height), THUMBS_DIR / f"{slug}.jpg")
        landed[slug] = Thumb(file=f"{slug}.jpg", width=width, height=height)

    for partition in atlas.partitions:
        _fill_thumbs(ATLAS_DIR / partition.file, landed)

    # A rewritten fixture judges a different set of dots, and a picture nothing points at
    # any more is an orphan in a tracked tree — the same thing `check` refuses in a
    # gallery directory.
    wanted = {thumb.file for thumb in landed.values()}
    orphans = [path for path in sorted(THUMBS_DIR.glob("*.jpg")) if path.name not in wanted]
    for path in orphans:
        path.unlink()

    elapsed = sum(answer.get("ms", 0) for answer in drawn.values() if answer.get("ok"))
    lines = [
        f"{len(landed)} thumbnails drawn into assets/images/atlas/, {len(orphans)} orphans removed "
        f"({elapsed / 1000:.0f}s of render across the pool)"
    ]
    lines.extend(f"  refused — {why}" for why in refused)
    return lines


def _fill_thumbs(path: Path, landed: dict[str, Thumb]) -> None:
    """Write each drawn file name into the row it belongs to, and leave the rest alone."""
    rows = []
    for raw in path.read_text(encoding="utf-8").splitlines():
        if not raw.strip():
            continue
        row = json.loads(raw)
        thumb = landed.get(_slug(row.get("location_key", ""))) if "judged" in row else None
        if thumb is not None:
            row["judged"]["thumb"] = {
                "file": thumb.file,
                "width": thumb.width,
                "height": thumb.height,
            }
        rows.append(row)
    _write(path, rows)
