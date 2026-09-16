"""The atlas record: what a dot on the atlas page is made of, and what holds it to shape.

The atlas page draws one dot per place the search kept, over a pre-rendered plate of the
plane those places sit in, and every picture a dot carries opens in the explorer at the
view it stands for. The record below is the **contract between the wallpaper project's
maker and this page**: the maker writes it, the page reads it, and neither composes a key
the other did not put there.

That last rule is the whole point of the file. A page that worked out a location's
viewport from a position in a list — or an index into a pool derived from live data —
would draw at a moving target, and a rerun next door would silently repoint every dot.
So a slot carries **its own** viewport keys, spelled the way the permalink contract
spells them, and the page hands them to `permalink.js` without arithmetic.

## The shape

`atlas/atlas.jsonl` is the index and carries no dots:

* one **`method`** row — the published record the population was read out of, the judge
  that scored it, the bars it was cut at, the absorption radius the thinning ran at, the
  map the neighborhood plates are drawn through, and the tally the page reports;
* one **`partition`** row per plane — the plate its dots are drawn over, that plate's own
  view, and the file its dots are in. There is one today: the Mandelbrot parameter plane,
  with the Julia side drawn over the same plate, because a Julia place *is* a `c` and a
  `c` is a point of that plane.

`atlas/<partition>.jsonl` carries one **`dot`** row per place:

* `px`/`py` — where it is drawn **on the plate, in the plate's own pixels**, so the page
  scales one number and the dot stays put at every width;
* `class` — `seated` where either side of the place holds a seat in the published record,
  `q4` otherwise. The page colors them; the record says which they are;
* `sides` — one entry per plane the place was found on, keyed by that plane's family:
  where it is, which populations hold it, what the judges said, and the seat if it has
  one. A place found on both is one dot and two sides;
* `slots` — the three pictures the page shows: `julia`, `mandelbrot`, `render`. Each
  carries the permalink keys of its own view, the mode and map it was drawn through, the
  file it was landed as, and `refused` — what the recipe holds that a link has no key
  for, so the page can say the explorer is opening *near* the picture rather than at it.

**A slot's `colormap` is what the picture was drawn through, not what its link will
say.** Where the explorer does not bake that map the link falls back to the default, and
the `refused` line is what the caption is written from. `atlas/atlas.test.mjs` holds the
two together: a refusal the roster does not make, or a map the roster lacks with no
refusal beside it, fails there.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from pathlib import Path

from . import images, records
from .paths import IMAGES_DIR, SITE_ROOT

ATLAS_DIR = SITE_ROOT / "atlas"
ATLAS_INDEX = ATLAS_DIR / "atlas.jsonl"
IMAGE_DIR = IMAGES_DIR / "atlas"

#: The families a view here may name. The permalink contract is the authority on what a
#: link may *say* — it is written in JavaScript, and a second reading of it in Python is
#: exactly what a URL contract cannot survive — so this is the shorter question: which
#: families this record is allowed to name at all.
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
#: keys them. A view on a family not listed here carries none.
CONSTANTS = {
    "julia": ("cx", "cy"),
    "julia3": ("cx", "cy"),
    "julia4": ("cx", "cy"),
    "julia5": ("cx", "cy"),
    "phoenix": ("cx", "cy", "px", "py", "zx", "zy"),
}

#: The three pictures a dot carries, in the order the page shows them.
SLOTS = ("julia", "mandelbrot", "render")

#: Which class a dot may be in. `seated` is the published record's own word for a place
#: that holds a seat; `q4` is the search's for the top quarter.
CLASSES = ("seated", "q4")

#: The permalink contract's own cap on a coordinate string, restated as a bound rather
#: than as a rule: a record that wrote a longer one would produce a link that is refused.
COORDINATE_LIMIT = 64


class AtlasError(Exception):
    """The atlas record said something the page could not read."""


@dataclass(frozen=True)
class Seat:
    """A place's seat in the published record, where it holds one."""

    key: str
    alias: str
    seat: int
    mode: str
    p_ge4: float
    cell: str


@dataclass(frozen=True)
class Side:
    """One plane a place was found on, and what the judges made of it there."""

    plane: str
    at: tuple[float, float]
    populations: tuple[str, ...]
    judged_rows: int
    p_ge4: float | None
    p_fine: float | None
    human: int | None
    seat: Seat | None


@dataclass(frozen=True)
class Slot:
    """One of a dot's three pictures: its view, how it was drawn, and what it landed as."""

    name: str
    what: str | None
    side: str
    source: str | None
    key: str | None
    family: str
    view: dict[str, str]
    mode: str
    mode_params: dict
    colormap: str
    shade: dict
    maxiter: int
    p_fine: float | None
    p_ge4: float | None
    refused: tuple[str, ...]
    file: str

    @property
    def path(self) -> Path:
        return IMAGE_DIR / self.file


@dataclass(frozen=True)
class Dot:
    """One place the search kept, as the page draws it."""

    id: int
    px: float
    py: float
    kind: str
    anchor: str
    absorbed: int
    dropped: int
    sides: dict[str, Side]
    slots: dict[str, Slot]

    @property
    def seated(self) -> bool:
        return any(side.seat is not None for side in self.sides.values())


@dataclass(frozen=True)
class Plate:
    """The pre-rendered picture a partition's dots are drawn over."""

    file: str
    width: int
    height: int
    family: str
    x: str
    y: str
    w: str
    aspect: tuple[int, int]
    mode: str
    colormap: str

    @property
    def path(self) -> Path:
        return IMAGE_DIR / self.file


@dataclass(frozen=True)
class Partition:
    """One plane's atlas: the plate, and every dot drawn on it."""

    name: str
    title: str
    family: str
    file: str
    plate: Plate
    plate_width: str
    says: str
    dots: tuple[Dot, ...] = field(default=())


@dataclass(frozen=True)
class Atlas:
    """The whole record: where it came from, and one entry per partition."""

    made: str
    record: str
    judge: str
    radius_px: float
    canonical_map: str
    tally: dict
    thumb: tuple[int, int]
    partitions: tuple[Partition, ...]


# --------------------------------------------------------------------------- reading


def _decimal(row: records.Record, held: dict, key: str, where: str) -> str:
    """A coordinate as the decimal string it is the identity of."""
    text = held.get(key)
    if not isinstance(text, str) or not text:
        raise AtlasError(f"{row.where}: {where}.{key} must be a decimal string")
    if len(text) > COORDINATE_LIMIT:
        raise AtlasError(f"{row.where}: {where}.{key} is longer than {COORDINATE_LIMIT} characters")
    try:
        float(text)
    except ValueError as error:
        raise AtlasError(f"{row.where}: {where}.{key}={text!r} is not a number") from error
    return text


def _number(row: records.Record, value: object, what: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise AtlasError(f"{row.where}: {what} must be a number")
    if not math.isfinite(value):
        raise AtlasError(f"{row.where}: {what} must be finite")
    return float(value)


def _whole(row: records.Record, value: object, what: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise AtlasError(f"{row.where}: {what} must be a whole number")
    return value


def _maybe(row: records.Record, held: dict, key: str, what: str) -> float | None:
    return None if held.get(key) is None else _number(row, held[key], what)


def _seat(row: records.Record, held: object, where: str) -> Seat | None:
    if held is None:
        return None
    if not isinstance(held, dict):
        raise AtlasError(f"{row.where}: {where}.seat must be an object")
    for key in ("key", "alias", "mode", "cell"):
        if not isinstance(held.get(key), str) or not held[key]:
            raise AtlasError(f"{row.where}: {where}.seat.{key} must be a non-empty string")
    return Seat(
        key=held["key"],
        alias=held["alias"],
        seat=_whole(row, held.get("seat"), f"{where}.seat.seat"),
        mode=held["mode"],
        p_ge4=_number(row, held.get("p_ge4"), f"{where}.seat.p_ge4"),
        cell=held["cell"],
    )


def _side(row: records.Record, plane: str, held: object) -> Side:
    where = f"sides.{plane}"
    if not isinstance(held, dict):
        raise AtlasError(f"{row.where}: {where} must be an object")
    at = held.get("at")
    if not isinstance(at, list) or len(at) != 2:
        raise AtlasError(f"{row.where}: {where}.at is the two coordinates of the place")
    populations = held.get("populations")
    if not isinstance(populations, list) or not populations:
        raise AtlasError(f"{row.where}: {where}.populations says which sets hold this place")
    for name in populations:
        if not isinstance(name, str) or not name:
            raise AtlasError(f"{row.where}: {where}.populations is a list of names")
    human = held.get("human")
    return Side(
        plane=plane,
        at=(_number(row, at[0], f"{where}.at[0]"), _number(row, at[1], f"{where}.at[1]")),
        populations=tuple(populations),
        judged_rows=_whole(row, held.get("judged_rows"), f"{where}.judged_rows"),
        p_ge4=_maybe(row, held, "p_ge4", f"{where}.p_ge4"),
        p_fine=_maybe(row, held, "p_fine", f"{where}.p_fine"),
        human=None if human is None else _whole(row, human, f"{where}.human"),
        seat=_seat(row, held.get("seat"), where),
    )


def _slot(row: records.Record, name: str, held: object) -> Slot:
    where = f"slots.{name}"
    if not isinstance(held, dict):
        raise AtlasError(f"{row.where}: {where} must be an object")
    family = held.get("family")
    if family not in FAMILIES:
        raise AtlasError(f"{row.where}: {where}.family {family!r} is not a family this site draws")
    view = {key: _decimal(row, held, key, where) for key in ("x", "y", "w")}
    if float(view["w"]) <= 0:
        raise AtlasError(f"{row.where}: {where}.w is the width of the view, so it is positive")
    for key in CONSTANTS.get(family, ()):
        view[key] = _decimal(row, held, key, where)
    for key in ("cx", "cy", "px", "py", "zx", "zy"):
        if key in held and key not in view:
            raise AtlasError(f"{row.where}: {where}: {family} has no {key} constant")
    for key in ("mode", "colormap", "file"):
        if not isinstance(held.get(key), str) or not held[key]:
            raise AtlasError(f"{row.where}: {where}.{key} must be a non-empty string")
    if "/" in held["file"]:
        raise AtlasError(f"{row.where}: {where}.file must be a bare file name")
    refused = held.get("refused")
    if not isinstance(refused, list) or any(
        not isinstance(line, str) or not line for line in refused
    ):
        raise AtlasError(f"{row.where}: {where}.refused is a list of what the link cannot carry")
    side = held.get("side")
    if side is None or not isinstance(side, str):
        raise AtlasError(f"{row.where}: {where}.side names the plane this picture came from")
    return Slot(
        name=name,
        what=held.get("what"),
        side=side,
        source=held.get("source"),
        key=held.get("key"),
        family=family,
        view=view,
        mode=held["mode"],
        mode_params=held.get("mode_params") or {},
        colormap=held["colormap"],
        shade=held.get("shade") or {},
        maxiter=_whole(row, held.get("maxiter"), f"{where}.maxiter"),
        p_fine=_maybe(row, held, "p_fine", f"{where}.p_fine"),
        p_ge4=_maybe(row, held, "p_ge4", f"{where}.p_ge4"),
        refused=tuple(refused),
        file=held["file"],
    )


def _dot(row: records.Record, at: int) -> Dot:
    row.expect_kind("dot")
    identifier = _whole(row, row.fields.get("id"), "id")
    if identifier != at:
        raise AtlasError(f"{row.where}: the {at}th dot calls itself {identifier}")
    kind = row.text("class")
    if kind not in CLASSES:
        raise AtlasError(f"{row.where}: class {kind!r} — a dot is {' or '.join(CLASSES)}")
    sides = row.fields.get("sides")
    if not isinstance(sides, dict) or not sides:
        raise AtlasError(f"{row.where}: sides names every plane this place was found on")
    held = {plane: _side(row, plane, fields) for plane, fields in sides.items()}
    anchor = row.text("anchor")
    if anchor not in held:
        raise AtlasError(
            f"{row.where}: the dot is anchored on {anchor!r}, which is not a side it has"
        )
    slots = row.fields.get("slots")
    if not isinstance(slots, dict) or not slots:
        raise AtlasError(f"{row.where}: slots carries the pictures this dot shows")
    for name in slots:
        if name not in SLOTS:
            raise AtlasError(f"{row.where}: {name!r} is not one of {', '.join(SLOTS)}")
    return Dot(
        id=identifier,
        px=_number(row, row.fields.get("px"), "px"),
        py=_number(row, row.fields.get("py"), "py"),
        kind=kind,
        anchor=anchor,
        absorbed=_whole(row, row.fields.get("absorbed"), "absorbed"),
        dropped=_whole(row, row.fields.get("dropped"), "dropped"),
        sides=held,
        slots={name: _slot(row, name, slots[name]) for name in SLOTS if name in slots},
    )


def _plate(row: records.Record) -> Plate:
    held = row.optional_mapping("plate")
    if held is None:
        raise AtlasError(f"{row.where}: a partition names the plate its dots are drawn over")
    family = held.get("family")
    if family not in FAMILIES:
        raise AtlasError(f"{row.where}: plate.family {family!r} is not a family this site draws")
    aspect = held.get("aspect")
    if not isinstance(aspect, list) or len(aspect) != 2:
        raise AtlasError(f"{row.where}: plate.aspect is two positive integers")
    across, down = aspect
    for value in (across, down):
        if not isinstance(value, int) or isinstance(value, bool) or value <= 0:
            raise AtlasError(f"{row.where}: plate.aspect is two positive integers")
    for key in ("file", "mode", "colormap"):
        if not isinstance(held.get(key), str) or not held[key]:
            raise AtlasError(f"{row.where}: plate.{key} must be a non-empty string")
    width = _whole(row, held.get("width"), "plate.width")
    height = _whole(row, held.get("height"), "plate.height")
    if width <= 0 or height <= 0:
        raise AtlasError(
            f"{row.where}: plate.width and plate.height are the pixels it was drawn at"
        )
    if abs(width * down - height * across) > max(across, down):
        raise AtlasError(
            f"{row.where}: the plate is {width}x{height} and its aspect says {across}:{down}"
        )
    view = {key: _decimal(row, held, key, "plate") for key in ("x", "y", "w")}
    if float(view["w"]) <= 0:
        raise AtlasError(f"{row.where}: plate.w has to be positive")
    return Plate(
        file=held["file"],
        width=width,
        height=height,
        family=family,
        aspect=(across, down),
        mode=held["mode"],
        colormap=held["colormap"],
        **view,
    )


def load_all() -> Atlas:
    """The whole atlas record, read and held to its shape."""
    rows = records.read(ATLAS_INDEX)
    head = rows[0]
    head.expect_kind("method")
    thumb = head.optional_mapping("thumb")
    if thumb is None:
        raise AtlasError(f"{head.where}: the method row says what size a slot picture is")
    size = (
        _whole(head, thumb.get("width"), "thumb.width"),
        _whole(head, thumb.get("height"), "thumb.height"),
    )
    tally = head.optional_mapping("tally")
    if tally is None:
        raise AtlasError(f"{head.where}: the method row carries the tally the page reports")

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
        dots = tuple(_dot(entry, at) for at, entry in enumerate(records.read(path)))
        if not dots:
            raise AtlasError(f"{file}: no dots")
        if row.count("dots") != len(dots):
            raise AtlasError(
                f"{row.where}: says {row.count('dots')} dots and {file} holds {len(dots)}"
            )
        partitions.append(
            Partition(
                name=name,
                title=row.text("title"),
                family=family,
                file=file,
                plate=_plate(row),
                plate_width=row.text("plate_width"),
                says=row.text("says"),
                dots=dots,
            )
        )
    if not partitions:
        raise AtlasError(f"{ATLAS_INDEX.name}: no partitions")
    return Atlas(
        made=head.text("made"),
        record=head.text("record"),
        judge=head.text("judge"),
        radius_px=_number(head, head.fields.get("radius_px"), "radius_px"),
        canonical_map=head.text("canonical_map"),
        tally=tally,
        thumb=size,
        partitions=tuple(partitions),
    )


# --------------------------------------------------------------------------- checking


def problems() -> list[str]:
    """What is wrong with the record, as `check` reports it.

    Shape is held by `load_all`; what is added here is the part that needs the tree
    around it — a dot standing off the plate it is drawn on, two dots closer than the
    absorption radius the thinning claims, a class that disagrees with the seats the
    record itself carries, a tally that disagrees with the dots it counts, and a picture
    that is missing or is not the size the method row gives. The last of those is
    Pillow's, and its absence is a named skip rather than a pass, the way every other
    size check on this site treats it.
    """
    try:
        atlas = load_all()
    except (AtlasError, records.RecordError) as error:
        return [str(error)]

    found: list[str] = []
    for partition in atlas.partitions:
        found.extend(_placed(partition))
        found.extend(_separated(partition, atlas.radius_px))
        found.extend(_classed(partition))
        found.extend(_pictures(partition, atlas.thumb))
    found.extend(_tallied(atlas))
    return found


def _placed(partition: Partition) -> list[str]:
    """Every dot stands on the plate its partition draws."""
    plate = partition.plate
    return [
        f"{partition.file}: dot {dot.id} is drawn at {dot.px}, {dot.py}, which is off a "
        f"{plate.width}x{plate.height} plate"
        for dot in partition.dots
        if not (0 <= dot.px <= plate.width and 0 <= dot.py <= plate.height)
    ]


def _separated(partition: Partition, radius: float) -> list[str]:
    """No two dots are closer than the radius the thinning says it absorbed at.

    The atlas is a thinned population and the radius is the sentence that says so. A
    record whose dots sit closer than it claims is a record whose plot is denser than its
    own description, which is the kind of drift nothing on the page would show.
    """
    if radius <= 0:
        return []
    places = [(dot.px, dot.py) for dot in partition.dots]
    for index, (x, y) in enumerate(places):
        for other_x, other_y in places[index + 1 :]:
            if math.hypot(x - other_x, y - other_y) < radius * 0.999:
                return [
                    f"{partition.file}: two dots are closer than the {radius} px absorption "
                    f"radius the record claims"
                ]
    return []


def _classed(partition: Partition) -> list[str]:
    """A dot is `seated` exactly where one of its own sides carries a seat.

    The class is what the page colors by, and the seats are what it means. They are two
    fields of one record, so a record that disagrees with itself is the one thing a
    reader could not see: a gold dot standing for nothing.
    """
    return [
        f"{partition.file}: dot {dot.id} is {dot.kind} and "
        + ("no side of it holds a seat" if dot.seated is False else "a side of it holds a seat")
        for dot in partition.dots
        if (dot.kind == "seated") != dot.seated
    ]


def _pictures(partition: Partition, size: tuple[int, int]) -> list[str]:
    """The plate and every slot picture are on disk, at the sizes the record gives."""
    found: list[str] = []
    plate = partition.plate
    if not plate.path.is_file():
        found.append(f"{partition.file}: the plate names {plate.file}, which is not there")
    for dot in partition.dots:
        for slot in dot.slots.values():
            if not slot.path.is_file():
                found.append(
                    f"{partition.file}: dot {dot.id}'s {slot.name} names {slot.file}, "
                    "which is not there"
                )
    if not images.available() or found:
        return found
    if images.dimensions(plate.path) != (plate.width, plate.height):
        width, height = images.dimensions(plate.path)
        found.append(
            f"{partition.file}: {plate.file} is {width}x{height} on disk and "
            f"{plate.width}x{plate.height} in the record"
        )
    for dot in partition.dots:
        for slot in dot.slots.values():
            if images.dimensions(slot.path) != size:
                width, height = images.dimensions(slot.path)
                found.append(
                    f"{partition.file}: {slot.file} is {width}x{height} on disk and the "
                    f"method row says every slot picture is {size[0]}x{size[1]}"
                )
    return found


def _tallied(atlas: Atlas) -> list[str]:
    """The tally the page prints is a count of the dots the record actually carries."""
    dots = [dot for partition in atlas.partitions for dot in partition.dots]
    counted = {
        "dots": len(dots),
        "seated": sum(1 for dot in dots if dot.kind == "seated"),
        "q4": sum(1 for dot in dots if dot.kind == "q4"),
        "both": sum(1 for dot in dots if len(dot.sides) == 2),
        "absorbed": sum(dot.absorbed for dot in dots),
        "dropped": sum(dot.dropped for dot in dots),
    }
    found = [
        f"{ATLAS_INDEX.name}: the tally says {key} {atlas.tally[key]} and the dots hold {value}"
        for key, value in counted.items()
        if key in atlas.tally and atlas.tally[key] != value
    ]
    queued = atlas.tally.get("queued")
    if queued is not None and queued != counted["dots"] + counted["absorbed"] + counted["dropped"]:
        found.append(
            f"{ATLAS_INDEX.name}: {queued} places were queued and the dots account for "
            f"{counted['dots'] + counted['absorbed'] + counted['dropped']}"
        )
    return found


def summary() -> list[str]:
    """What the record holds, for `python -m builder atlas`."""
    atlas = load_all()
    lines = [
        f"atlas/atlas.jsonl — made {atlas.made} from the published record {atlas.record}",
        f"  judge {atlas.judge[:12]}… · absorption radius {atlas.radius_px:g} px · "
        f"neighborhood plates through {atlas.canonical_map}",
    ]
    for partition in atlas.partitions:
        plate = partition.plate
        lines.append(
            f"  {partition.name}: {len(partition.dots)} dots over {plate.file} "
            f"({plate.width}x{plate.height}, {plate.mode} through {plate.colormap})"
        )
        seated = sum(1 for dot in partition.dots if dot.kind == "seated")
        both = sum(1 for dot in partition.dots if len(dot.sides) == 2)
        lines.append(
            f"    {seated} seated, {len(partition.dots) - seated} q4 · {both} on both planes"
        )
        widths = sorted(
            float(slot.view["w"])
            for dot in partition.dots
            for slot in dot.slots.values()
            if slot.name == "render"
        )
        if widths:
            lines.append(
                f"    render widths {widths[0]:.3g}–{widths[-1]:.3g} "
                f"({math.log10(widths[-1] / widths[0]):.1f} decades), "
                f"median {widths[len(widths) // 2]:.3g}"
            )
        refused = sum(1 for dot in partition.dots for slot in dot.slots.values() if slot.refused)
        pictures = sum(len(dot.slots) for dot in partition.dots)
        lines.append(f"    {pictures} pictures, {refused} whose link cannot carry everything")
    return lines


# ---------------------------------------------------------------------------- the maker

#: The figures this module draws, by figure id. A maker addresses a location by its
#: record: the plate is the picture the maker next door landed and the dots are the
#: record's own `px`/`py`, so nothing here is re-derived at draw time and a rerun cannot
#: move a dot that nobody asked to move.
MAKERS = {"atlas-places": "the plate with every kept place marked on it"}

#: The figure's marks, as a share of the plate's width. The page draws CSS dots at a
#: fixed pixel size over a plate that scales; a figure is one fixed size, so the same
#: mark is written as a fraction and comes out the same relative size it has on screen.
MARK_RADIUS = 0.0039
MARK_RING = 0.0012

#: What each class is drawn in. The page's two tokens, transcribed the way
#: `builder/theme.py` transcribes the well colors and for the same reason: Pillow cannot
#: read CSS. `check`'s `theme` holds those five; these two are the atlas's own and are
#: held by nothing but this comment, because a figure drawn a shade off its page is not a
#: failure a reader could be misled by.
MARK_COLOR = {"seated": (255, 176, 46), "q4": (87, 217, 138)}


def draw(identifier: str) -> list[str]:
    """Draw one of this module's figures and land it where its registry row says."""
    if identifier not in MAKERS:
        raise AtlasError(f"{identifier}: not a figure this module draws")
    from PIL import Image, ImageDraw

    from . import figures

    atlas = load_all()
    partition = atlas.partitions[0]
    figure = figures.load_all()[identifier]

    with Image.open(partition.plate.path) as plate:
        sheet = plate.convert("RGB")
    canvas = ImageDraw.Draw(sheet)
    radius = MARK_RADIUS * sheet.width
    ring = MARK_RING * sheet.width
    for dot in partition.dots:
        x = dot.px / partition.plate.width * sheet.width
        y = dot.py / partition.plate.height * sheet.height
        canvas.ellipse(
            (x - radius - ring, y - radius - ring, x + radius + ring, y + radius + ring),
            fill=(0, 0, 0),
        )
        canvas.ellipse((x - radius, y - radius, x + radius, y + radius), fill=MARK_COLOR[dot.kind])

    width, height = images.land(sheet, figure.path)
    return [
        f"{figure.file}: {width}x{height}, {len(partition.dots)} marks "
        f"({figure.path.stat().st_size / 1e3:.0f} kB)"
    ]
