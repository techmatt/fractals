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

* one **`method`** row — the published record the seats were read out of, the judge that
  scored it, the fine bar the population was cut at, the absorption radius the thinning
  ran at, the map the neighborhood plates are drawn through, and the tally the page
  reports;
* one **`partition`** row per plane — the plate its dots are drawn over, that plate's own
  view, the word the frame's strip of planes puts on it, and the file its dots are in.
  There are five: the Mandelbrot parameter plane, with the Julia places drawn over the
  same plate because a Julia place *is* a `c` and a `c` is a point of that plane; the
  three higher-degree parameter planes; and the classic Phoenix slice. **Only the first
  has marks today**, and the other four carry an empty dot file rather than none, so the
  marks land later as rows and no page changes. `python -m builder atlas --plates` draws
  all five plates, each cropped to its set's own measured extent at one shared aspect,
  and re-projects the dots from the plane coordinates they already carry.

The method row keeps the absorption radius twice: `radius_plane`, the distance on the
plane the thinning ran at, and `radius_px`, that distance spelled in the pixels of the plate
the dots are drawn on now. The second is restated from the first whenever the plates are,
because a plate cropped tighter spells one distance with a bigger number.

`atlas/<partition>.jsonl` carries one **`dot`** row per place:

* `px`/`py` — where it is drawn **on the plate, in the plate's own pixels**, so the page
  scales one number and the dot stays put at every width;
* `plane` — `mandelbrot` where the place is a frame on the parameter plane, `julia` where
  it is a frame on the dynamical plane of some `c`. **A dot is one place of one kind**:
  there is no merging across the two, so the color the page draws is a fact about the
  place rather than about what happened to land near it;
* `place` — where it is, what the two judges read there, how many of its rows clear the
  bar, and the seat if it holds one;
* `slots` — the three pictures the page shows, in the order it shows them: `mandelbrot`,
  `julia`, `gallery`. Each carries the permalink keys of its own view, the mode and map it
  was drawn through, the file it was landed as, and `refused` — what the recipe holds that
  a link has no key for, so the page can say the explorer is opening *near* the picture
  rather than at it.

The gallery slot carries two more, because the page's border color says both: `seated`,
whether this is the picture the published record seats at the place, and `plane`, which
kind of place the row came from. The second is read off the recipe's own family rather
than copied from the dot, and `check` holds the two together.

**A slot's `colormap` is what the picture was drawn through, not what its link will
say.** Where the explorer does not bake that map the link falls back to the default, and
the `refused` line is what the tooltip is written from. `atlas/atlas.test.mjs` holds the
two together: a refusal the roster does not make, or a map the roster lacks with no
refusal beside it, fails there.

## The population is one bar

A place is on the plate if it holds at least one row the fine head reads at or above the
solve's own `DEFAULT_FINE_BAR`. Nothing else qualifies — not a human verdict, not a
top-quarter reading of the candidate judge — and that is what makes the third slot
honest: the best row at a qualifying place clears the bar by construction, so the gallery
picture is always a wallpaper somebody could seat rather than a location view standing in
for one.
"""

from __future__ import annotations

import json
import math
import shutil
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

#: The three pictures a dot carries, in the order the page shows them, left to right.
SLOTS = ("mandelbrot", "julia", "gallery")

#: The two kinds of place, and the word each is spelled with. A dot is one of them and
#: never both.
PLANES = ("mandelbrot", "julia")

#: Which plane a slot's family belongs to. This is how the gallery slot's own `plane` is
#: checked rather than trusted: the row says which kind of place it came from, and its
#: family has to agree.
PLANE_OF_FAMILY = {
    "mandelbrot": "mandelbrot",
    "multibrot3": "mandelbrot",
    "multibrot4": "mandelbrot",
    "multibrot5": "mandelbrot",
    "julia": "julia",
    "julia3": "julia",
    "julia4": "julia",
    "julia5": "julia",
    "phoenix": "julia",
}

#: The permalink contract's own cap on a coordinate string, restated as a bound rather
#: than as a rule: a record that wrote a longer one would produce a link that is refused.
COORDINATE_LIMIT = 64


class AtlasError(Exception):
    """The atlas record said something the page could not read."""


@dataclass(frozen=True)
class Seat:
    """A place's seat in the published record, where it holds one.

    `key` and `mode` are what the seat *is*; the rest is what the record happened to carry
    beside it, and a release that stops carrying one of them is a thinner record rather
    than a broken one — `carriers.jsonl` is this repository's standing lesson about
    requiring a column a second reader never asked for.
    """

    key: str
    mode: str
    seat: int
    alias: str | None
    p_ge4: float | None
    cell: str | None


@dataclass(frozen=True)
class Place:
    """The one place a dot stands for, and what the judges made of it."""

    plane: str
    at: tuple[float, float]
    rows_at_bar: int
    judged_rows: int
    p_ge4: float | None
    p_fine: float | None
    seat: Seat | None


@dataclass(frozen=True)
class Slot:
    """One of a dot's three pictures: its view, how it was drawn, and what it landed as."""

    name: str
    what: str | None
    source: str | None
    seated: bool | None
    plane: str | None
    key: str | None
    family: str
    view: dict[str, str]
    mode: str
    mode_params: dict
    colormap: str
    shade: dict
    maxiter: int
    p_fine: float | None
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
    plane: str
    dropped: int
    place: Place
    slots: dict[str, Slot]

    @property
    def seated(self) -> bool:
        return self.place.seat is not None


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
    label: str
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
    fine_bar: float
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


def _seat(row: records.Record, held: object) -> Seat | None:
    if held is None:
        return None
    if not isinstance(held, dict):
        raise AtlasError(f"{row.where}: place.seat must be an object")
    for key in ("key", "mode"):
        if not isinstance(held.get(key), str) or not held[key]:
            raise AtlasError(f"{row.where}: place.seat.{key} must be a non-empty string")
    for key in ("alias", "cell"):
        if held.get(key) is not None and not isinstance(held[key], str):
            raise AtlasError(f"{row.where}: place.seat.{key} is a string where the record has one")
    return Seat(
        key=held["key"],
        mode=held["mode"],
        seat=_whole(row, held.get("seat"), "place.seat.seat"),
        alias=held.get("alias") or None,
        p_ge4=_maybe(row, held, "p_ge4", "place.seat.p_ge4"),
        cell=held.get("cell") or None,
    )


def _place(row: records.Record, plane: str, held: object) -> Place:
    if not isinstance(held, dict):
        raise AtlasError(f"{row.where}: place must be an object")
    at = held.get("at")
    if not isinstance(at, list) or len(at) != 2:
        raise AtlasError(f"{row.where}: place.at is the two coordinates of the place")
    rows = _whole(row, held.get("rows_at_bar"), "place.rows_at_bar")
    if rows < 1:
        raise AtlasError(
            f"{row.where}: place.rows_at_bar is {rows} — a place is on the plate because at "
            "least one of its rows clears the fine bar"
        )
    return Place(
        plane=plane,
        at=(_number(row, at[0], "place.at[0]"), _number(row, at[1], "place.at[1]")),
        rows_at_bar=rows,
        judged_rows=_whole(row, held.get("judged_rows"), "place.judged_rows"),
        p_ge4=_maybe(row, held, "p_ge4", "place.p_ge4"),
        p_fine=_maybe(row, held, "p_fine", "place.p_fine"),
        seat=_seat(row, held.get("seat")),
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
    plane = held.get("plane")
    seated = held.get("seated")
    if name == "gallery":
        if plane not in PLANES:
            raise AtlasError(
                f"{row.where}: {where}.plane says which kind of place this picture came from"
            )
        if not isinstance(seated, bool):
            raise AtlasError(f"{row.where}: {where}.seated must be true or false")
    elif plane is not None or seated is not None:
        raise AtlasError(f"{row.where}: only the gallery slot carries plane and seated")
    return Slot(
        name=name,
        what=held.get("what"),
        source=held.get("source"),
        seated=seated,
        plane=plane,
        key=held.get("key"),
        family=family,
        view=view,
        mode=held["mode"],
        mode_params=held.get("mode_params") or {},
        colormap=held["colormap"],
        shade=held.get("shade") or {},
        maxiter=_whole(row, held.get("maxiter"), f"{where}.maxiter"),
        p_fine=_maybe(row, held, "p_fine", f"{where}.p_fine"),
        refused=tuple(refused),
        file=held["file"],
    )


def _dot(row: records.Record, at: int) -> Dot:
    row.expect_kind("dot")
    identifier = _whole(row, row.fields.get("id"), "id")
    if identifier != at:
        raise AtlasError(f"{row.where}: the {at}th dot calls itself {identifier}")
    plane = row.text("plane")
    if plane not in PLANES:
        raise AtlasError(f"{row.where}: plane {plane!r} — a dot is {' or '.join(PLANES)}")
    slots = row.fields.get("slots")
    if not isinstance(slots, dict) or not slots:
        raise AtlasError(f"{row.where}: slots carries the pictures this dot shows")
    for name in slots:
        if name not in SLOTS:
            raise AtlasError(f"{row.where}: {name!r} is not one of {', '.join(SLOTS)}")
    for name in SLOTS:
        if name not in slots:
            raise AtlasError(f"{row.where}: every dot carries all three of {', '.join(SLOTS)}")
    return Dot(
        id=identifier,
        px=_number(row, row.fields.get("px"), "px"),
        py=_number(row, row.fields.get("py"), "py"),
        plane=plane,
        dropped=_whole(row, row.fields.get("dropped"), "dropped"),
        place=_place(row, plane, row.fields.get("place")),
        slots={name: _slot(row, name, slots[name]) for name in SLOTS},
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
    # A plane with constants is a different set for every value of them, so a Phoenix
    # plate that did not say which slice it was drawn at would be a picture of nothing in
    # particular — and a link from it would open at the contract's default slice instead.
    wanted = CONSTANTS.get(family, ())
    constants = held.get("constants") or {}
    missing = [key for key in wanted if not isinstance(constants.get(key), str)]
    if missing:
        raise AtlasError(
            f"{row.where}: a {family} plate records the constants it was drawn at, "
            f"and this one gives no {', '.join(missing)}"
        )
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
        # **An empty file is a plane with nothing kept on it yet, and that is a state the
        # record is allowed to be in.** Four of the five planes are plates a reader can
        # look at before the search has reached them, and they carry a dot file like every
        # other partition so that nothing downstream — the ingest, the page, this loader —
        # has a second shape to handle. `records.read` refuses an empty file by design,
        # which is right for every other record here and is why the emptiness is decided
        # before it is called rather than inside it.
        dots = (
            ()
            if path.stat().st_size == 0
            else tuple(_dot(entry, at) for at, entry in enumerate(records.read(path)))
        )
        # `count` refuses zero and is right to nearly everywhere; a plane with no marks
        # yet is the one record here that says nought and means it.
        said = row.fields.get("dots")
        if not isinstance(said, int) or isinstance(said, bool) or said < 0:
            raise AtlasError(f"{row.where}: dots is how many the file holds, zero included")
        if said != len(dots):
            raise AtlasError(f"{row.where}: says {said} dots and {file} holds {len(dots)}")
        partitions.append(
            Partition(
                name=name,
                title=row.text("title"),
                label=row.text("label"),
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
        fine_bar=_number(head, head.fields.get("fine_bar"), "fine_bar"),
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
    absorption radius the thinning claims, a gallery slot that disagrees with the seat and
    the plane the dot itself carries, a tally that disagrees with the dots it counts, and a
    picture that is missing or is not the size the method row gives. The last of those is
    Pillow's, and its absence is a named skip rather than a pass, the way every other size
    check on this site treats it.
    """
    try:
        atlas = load_all()
    except (AtlasError, records.RecordError) as error:
        return [str(error)]

    found: list[str] = []
    for partition in atlas.partitions:
        found.extend(_placed(partition))
        found.extend(_separated(partition, atlas.radius_px))
        found.extend(_galleried(partition))
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


def _galleried(partition: Partition) -> list[str]:
    """The gallery slot agrees with the dot it hangs off, in both of the things it says.

    The page colors the gallery's border by `plane` and rings a seated dot, so those two
    fields are what a reader is actually told. `plane` is read off the recipe's own family
    at ingest rather than copied from the dot, which is what makes this comparison worth
    making; `seated` is true exactly where the gallery picture is the key the published
    record seats at this place.
    """
    found: list[str] = []
    for dot in partition.dots:
        slot = dot.slots["gallery"]
        if slot.plane != dot.plane:
            found.append(
                f"{partition.file}: dot {dot.id} is a {dot.plane} place and its gallery "
                f"picture says it came from a {slot.plane} one"
            )
        if slot.plane != PLANE_OF_FAMILY[slot.family]:
            found.append(
                f"{partition.file}: dot {dot.id}'s gallery says {slot.plane} and is drawn on "
                f"the {slot.family} family"
            )
        seat = dot.place.seat
        expected = seat is not None and slot.key == seat.key
        if slot.seated != expected:
            found.append(
                f"{partition.file}: dot {dot.id}'s gallery says seated={slot.seated} and "
                + ("the place holds no seat" if seat is None else f"its seat is {seat.key}")
            )
    return found


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
        "mandelbrot": sum(1 for dot in dots if dot.plane == "mandelbrot"),
        "julia": sum(1 for dot in dots if dot.plane == "julia"),
        "seated": sum(1 for dot in dots if dot.seated),
        "gallery_seated": sum(1 for dot in dots if dot.slots["gallery"].seated),
        "dropped": sum(dot.dropped for dot in dots),
    }
    found = [
        f"{ATLAS_INDEX.name}: the tally says {key} {atlas.tally[key]} and the dots hold {value}"
        for key, value in counted.items()
        if key in atlas.tally and atlas.tally[key] != value
    ]
    queued = atlas.tally.get("queued")
    if queued is not None and queued != counted["dots"] + counted["dropped"]:
        found.append(
            f"{ATLAS_INDEX.name}: {queued} places were queued and the dots account for "
            f"{counted['dots'] + counted['dropped']}"
        )
    return found


def summary() -> list[str]:
    """What the record holds, for `python -m builder atlas`."""
    atlas = load_all()
    lines = [
        f"atlas/atlas.jsonl — made {atlas.made} from the published record {atlas.record}",
        f"  judge {atlas.judge[:12]}… · fine bar {atlas.fine_bar:g} · absorption radius "
        f"{atlas.radius_px:g} px · neighborhood plates through {atlas.canonical_map}",
    ]
    for partition in atlas.partitions:
        plate = partition.plate
        lines.append(
            f"  {partition.name}: {len(partition.dots)} dots over {plate.file} "
            f"({plate.width}x{plate.height}, {plate.mode} through {plate.colormap})"
        )
        counted = {name: sum(1 for dot in partition.dots if dot.plane == name) for name in PLANES}
        seated = sum(1 for dot in partition.dots if dot.seated)
        lines.append(
            f"    {counted['mandelbrot']} on the parameter plane, {counted['julia']} on a "
            f"dynamical one · {seated} hold a seat"
        )
        widths = sorted(
            float(dot.slots["gallery"].view["w"])
            for dot in partition.dots
            if "gallery" in dot.slots
        )
        if widths:
            lines.append(
                f"    gallery widths {widths[0]:.3g}–{widths[-1]:.3g} "
                f"({math.log10(widths[-1] / widths[0]):.1f} decades), "
                f"median {widths[len(widths) // 2]:.3g}"
            )
        refused = sum(1 for dot in partition.dots for slot in dot.slots.values() if slot.refused)
        pictures = sum(len(dot.slots) for dot in partition.dots)
        lines.append(f"    {pictures} pictures, {refused} whose link cannot carry everything")
    return lines


# ---------------------------------------------------------------------------- the ingest

#: The shade recipe's defaults, as `explorer/permalink.js`'s `SHADE_KEYS` declares them.
#: A slot's `shade` carries only what differs from these, because the page merges it over
#: `defaultShade()` and a key spelled at its default would be noise in the record.
SHADE_DEFAULTS = {
    "gamma": 1.0,
    "cycles": 1.0,
    "phase": 0.0,
    "reverse": False,
    "mirror": False,
    "transfer": {"kind": "value"},
    "rolloff": {"kind": "none"},
}

#: What the maker's refusal lines are rewritten to on the way in. The maker spells the
#: roster's size into its own message — *not among the 126 the explorer bakes* — and that
#: is a number which grows every time a figure lands in a map the roster did not carry.
#: The record names the thing it could not carry; the page writes the sentence. The two
#: short forms `links.js`'s `refusals` derives have to match exactly, because
#: `atlas.test.mjs` holds the record to them in both directions.
REFUSAL_PREFIX = ("colormap ", "mode ")

#: The quality a slot picture is re-encoded at. The maker lands them at the engine's own
#: quality and they are nearly twice as large as this page can afford to ship; 4:4:4 is not
#: negotiable, because a fractal thumbnail is all saturated edge and chroma subsampling is
#: visible on every one of them. 78 is what the whole set fits the page's budget at — a
#: little under ten megabytes — and it is a number to re-derive rather than to keep, the
#: day a release puts twice as many dots on the plate.
THUMB_QUALITY = 78


def _shade_of(palette: object) -> dict:
    """A recipe's shade as the record carries it: only what differs from the default."""
    if not isinstance(palette, dict):
        return {}
    return {
        key: palette[key]
        for key, fallback in SHADE_DEFAULTS.items()
        if key in palette and palette[key] != fallback
    }


def _refusal(text: str) -> str:
    """One of the maker's refusal lines, as the record carries it.

    The name is everything up to the maker's own parenthetical, not up to the first space:
    a colormap is called `Smoke & Madder` as readily as `twilight_shifted`, and splitting
    on whitespace turned that one into a refusal nothing on the site could match.
    """
    if text.startswith("mirror "):
        return "mirror on a cyclic map"
    for prefix in REFUSAL_PREFIX:
        if text.startswith(prefix):
            name = text[len(prefix) :]
            cut = name.find(" (")
            return prefix + (name if cut < 0 else name[:cut])
    return text


def _slot_row(name: str, held: dict, file: str) -> dict:
    """One slot of the maker's `dots.json`, as the record spells it."""
    viewport = held["viewport"]
    row = {
        "what": held.get("what"),
        "source": held.get("source"),
        "key": held.get("key"),
        "family": _family_name(held["family"]),
        "x": str(viewport["center_re"]),
        "y": str(viewport["center_im"]),
        "w": str(viewport["width"]),
    }
    constants = list(held["family"].get("c") or [])
    if CONSTANTS.get(row["family"], ())[:2] == ("cx", "cy"):
        row["cx"], row["cy"] = str(constants[0]), str(constants[1])
    row["mode"] = str(held["mode"])
    if held.get("mode_params"):
        row["mode_params"] = dict(held["mode_params"])
    row["colormap"] = str(held["colormap"])
    shade = _shade_of(held.get("palette"))
    if shade:
        row["shade"] = shade
    row["maxiter"] = int(held["maxiter"])
    if held.get("p_fine") is not None:
        row["p_fine"] = held["p_fine"]
    if name == "gallery":
        row["seated"] = bool(held.get("seated"))
        row["plane"] = PLANE_OF_FAMILY[row["family"]]
    row["refused"] = [_refusal(line) for line in held.get("refused") or []]
    row["file"] = file
    return row


def _family_name(family: dict) -> str:
    """The permalink contract's name for an engine family spec."""
    kind = str(family.get("kind"))
    degree = int(family.get("degree") or 2)
    # The engine spells the higher degrees `multibrot` and the rest of this builder asks
    # for them that way; `mandelbrot` with a degree is the same family and arrives from
    # the records the ingest reads. Both spellings mean one picture, and one name.
    if kind in ("mandelbrot", "multibrot"):
        return "mandelbrot" if degree == 2 else f"multibrot{degree}"
    if kind == "julia":
        return "julia" if degree == 2 else f"julia{degree}"
    if kind == "phoenix":
        return "phoenix"
    raise AtlasError(f"{kind}: not a family this site draws")


def ingest(source: Path, *, quality: int = THUMB_QUALITY, made: str | None = None) -> list[str]:
    """Turn the maker's `dots.json` and `thumbs/` into the committed record and pictures.

    The maker next door writes a working file; this is the one program that turns it into
    what the site ships, and it is committed rather than left in `scratch/` for the reason
    the figure makers are: a record nobody can rebuild is a record nobody can correct. It
    re-encodes every thumbnail — the maker's are three times the size this page can afford
    — sweeps `assets/images/atlas/` of anything the new record does not name, and writes
    both JSONL files.
    """
    from datetime import date

    payload = json.loads(source.read_text(encoding="utf-8"))
    here = source.parent
    base = payload["base"]
    # The plate was rendered once, by the first pass, and `base.json` is the report it
    # left. Its supersample and cap are read off that rather than typed here: they are
    # facts about a picture this repository did not draw.
    plate = json.loads((here / "base.json").read_text(encoding="utf-8"))
    plate_file = str(base["image"])
    thumb_across, thumb_down = (int(value) for value in payload["thumb"]["resolution"])

    IMAGE_DIR.mkdir(parents=True, exist_ok=True)
    landed = {plate_file}
    shutil.copyfile(here / plate_file, IMAGE_DIR / plate_file)

    rows: list[dict] = []
    for dot in payload["dots"]:
        slots = {}
        for name in SLOTS:
            held = dot["slots"].get(name)
            if held is None:
                raise AtlasError(f"dot {dot['id']} has no {name} picture")
            file = f"{dot['id']:04d}-{name}.jpg"
            _encode(here / held["picture"], IMAGE_DIR / file, quality)
            landed.add(file)
            slots[name] = _slot_row(name, held, file)
        place = dot["place"]
        rows.append(
            {
                "schema": records.SCHEMA,
                "kind": "dot",
                "id": int(dot["id"]),
                "px": dot["px"],
                "py": dot["py"],
                "plane": str(dot["kind"]),
                "dropped": int(dot["dropped"]),
                "place": {
                    "at": [place["x"], place["y"]],
                    "p_fine": place["p_fine"],
                    "rows_at_bar": int(place["rows_at_bar"]),
                    "p_ge4": place["p_ge4"],
                    "judged_rows": int(place["judged_rows"]),
                    "seat": place["seat"],
                },
                "slots": slots,
            }
        )

    tally = dict(payload["tally"])
    tally.pop("radius_px", None)
    tally["gallery_seated"] = sum(1 for row in rows if row["slots"]["gallery"]["seated"])
    method = {
        "schema": records.SCHEMA,
        "kind": "method",
        "made": made or date.today().isoformat(),
        "record": payload["record"],
        "judge": payload["judge_artifact"],
        "generator": "fractal-wallpapers scratch/atlas_explore2/build_dots.py",
        "radius_px": payload["radius_px"],
        "canonical_map": payload["canonical_map"],
        "fine_bar": payload["fine_bar"],
        "thumb": {"width": thumb_across, "height": thumb_down},
        "tally": tally,
        "says": (
            "Every place the search kept on the two planes it has searched, thinned to one dot "
            "per neighborhood. A place is here because at least one of its rows reads at or "
            "above the solve's own fine bar, and nothing else puts one here. The seats of the "
            "published record are placed first and everything else follows by its best fine "
            "score; a place landing inside the absorption radius of a dot already drawn is "
            "dropped, whichever kind either of them is, so a dot is one place of one kind."
        ),
    }
    partition = {
        "schema": records.SCHEMA,
        "kind": "partition",
        "partition": "mandelbrot",
        "title": "Mandelbrot",
        "family": "mandelbrot",
        "file": "mandelbrot.jsonl",
        "plate": {
            "file": plate_file,
            "width": int(base["resolution"][0]),
            "height": int(base["resolution"][1]),
            "family": "mandelbrot",
            "x": str(base["viewport"]["center_re"]),
            "y": str(base["viewport"]["center_im"]),
            "w": str(base["viewport"]["width"]),
            "aspect": [16, 9],
            "mode": str(plate["mode"]),
            "colormap": str(plate["colormap"]),
            "supersample": int(plate["supersample"]),
            "maxiter": int(plate["maxiter"]),
        },
        "plate_width": str(payload["plate_width"]),
        "dots": len(rows),
        "says": (
            "the parameter plane, with the Julia places drawn over the same plane: a Julia "
            "place is a c, and c is a point of this plane"
        ),
    }

    _write_rows(ATLAS_INDEX, [method, partition])
    _write_rows(ATLAS_DIR / "mandelbrot.jsonl", rows)

    swept = [path for path in sorted(IMAGE_DIR.glob("*.jpg")) if path.name not in landed]
    for path in swept:
        path.unlink()
    total = sum(path.stat().st_size for path in IMAGE_DIR.glob("*.jpg"))
    return [
        f"atlas/atlas.jsonl: 2 rows · atlas/mandelbrot.jsonl: {len(rows)} dots",
        f"assets/images/atlas/: {len(landed)} files, {total / 1e6:.2f} MB "
        f"({len(rows) * len(SLOTS)} slot pictures at {thumb_across}x{thumb_down} quality "
        f"{quality}, {len(swept)} swept)",
    ]


def _encode(source: Path, destination: Path, quality: int) -> None:
    """One thumbnail, re-encoded at the page's own quality and no chroma subsampling."""
    from PIL import Image, ImageFile

    ImageFile.MAXBLOCK = max(ImageFile.MAXBLOCK, 4 * 1024 * 1024)
    with Image.open(source) as picture:
        picture.convert("RGB").save(
            destination,
            format="JPEG",
            quality=quality,
            subsampling=0,
            optimize=True,
            progressive=False,
        )


def _write_rows(path: Path, rows: list[dict]) -> None:
    body = "".join(json.dumps(row, ensure_ascii=False) + "\n" for row in rows)
    path.write_text(body, encoding="utf-8", newline="\n")


# ---------------------------------------------------------------------------- the plates

#: The five planes the atlas carries, in the order the frame's strip shows them: the
#: partition's own name, the word the strip puts on it, what it is, and the family spec
#: the engine is asked for. Only the first has marks; the other four are plates a reader
#: can see before the search has kept anything on them, and their dot files are empty by
#: design rather than by accident.
#:
#: **A plane's constants come from this table and nowhere else.** The Phoenix slice is the
#: one that has any, and the record's `cx`/`cy`/`px`/`py`/`zx`/`zy` are spelled from the
#: same spec the render was drawn at, so the plate and the row recording it cannot
#: disagree about which Phoenix this is.
PLANES_DRAWN = (
    ("mandelbrot", "Mandelbrot", "Mandelbrot", {"kind": "mandelbrot", "degree": 2}),
    ("multibrot3", "d=3", "Multibrot, degree 3", {"kind": "multibrot", "degree": 3}),
    ("multibrot4", "d=4", "Multibrot, degree 4", {"kind": "multibrot", "degree": 4}),
    ("multibrot5", "d=5", "Multibrot, degree 5", {"kind": "multibrot", "degree": 5}),
    (
        "phoenix",
        "Phoenix",
        "Phoenix, the classic slice",
        {"kind": "phoenix", "c": ["0.5667", "0.0"], "p": ["-0.5", "0.0"], "z_prev": ["0", "0"]},
    ),
)

#: How the engine's family spec spells a constant, and how a permalink does. The record
#: carries the permalink's spelling, because that is what the page hands to the contract.
PLATE_CONSTANTS = {"c": ("cx", "cy"), "p": ("px", "py"), "z_prev": ("zx", "zy")}

#: The one aspect every plate is drawn at, and the pixels its long side is drawn at.
#:
#: **It is the panel's shape rather than the picture's.** The frame is a strip of three
#: slots over a plate, so its own height is the plate's plus about a fifth; in the studio
#: it sits in a panel four units wide to five tall, where the 16:9 plate the first pass
#: shipped is letterboxed twice over and fills a little over half the box. At 9:8 the
#: frame fills about four fifths of it. That ratio is also the nearest simple one that
#: holds the Mandelbrot set — 2.45 by 2.20, as the engine measures it — with air around
#: it, where 4:3 and 5:4 both cut the antennae off the top and bottom bulbs.
PLATE_ASPECT = (9, 8)
PLATE_LONG = 4104

#: How much wider than the set a plate is drawn: the engine measures the extent and this
#: is the air around it.
PLATE_MARGIN = 1.10

#: Samples a pixel, each axis, as the first plate was drawn at. A plate is a picture a
#: reader looks at for a while.
PLATE_SUPERSAMPLE = 2

#: What a partition says while its plane has no marks on it yet.
NO_MARKS_YET = "the plane itself, with no places kept on it yet: the search has not run here"

#: The width a neighborhood plate is drawn at, for a plane that has no dots to draw one
#: for yet. The Mandelbrot partition's own value is kept where it already has one.
DEFAULT_PLATE_WIDTH = "0.22"

#: The grey ramp a plate is drawn through, committed beside this module. It is not a
#: shipped colormap and never was — the library next door has no such map — so it is the
#: maker's own input, the way `builder/data/locations-walk-descent.json` is.
GREY_RAMP = Path(__file__).resolve().parent / "data" / "atlas-grey.json"


def plate_size() -> tuple[int, int]:
    """The plate's pixels: the long side, and the short side its aspect gives."""
    across, down = PLATE_ASPECT
    return PLATE_LONG, PLATE_LONG * down // across


def _spelled(value: float) -> str:
    """A plate coordinate as the record carries it.

    Six significant figures, because the extent behind it was measured on the engine's
    own 4001-point grid and a float's full tail — `-0.7737499999999999` for a number that
    is `-0.77375` — is noise in a record a person reads. The projection reads these
    strings back, so the plate and its dots agree whatever is written here.
    """
    return f"{float(f'{value:.6g}'):g}"


def plate_view(extent: dict) -> tuple[float, float, float]:
    """The frame a set is drawn in: its own measured extent, fitted to the plate's aspect.

    **Derived, never typed.** `home-view` reports the extent the engine measured for that
    family, so a crop is that rectangle widened to the plate's ratio and given its margin.
    A typed rectangle would be a number somebody has to re-measure the day a family's own
    answer moves, and four of these five sets have never been framed by anybody.
    """
    across, down = PLATE_ASPECT
    (re_low, re_high), (im_low, im_high) = extent["re"], extent["im"]
    wide, tall = re_high - re_low, im_high - im_low
    width = max(wide, tall * across / down) * PLATE_MARGIN
    return (re_low + re_high) / 2, (im_low + im_high) / 2, width


def project(at: tuple[float, float], plate: Plate) -> tuple[float, float]:
    """Where a place on the plane falls on a plate, in that plate's own pixels.

    The one piece of arithmetic that turns a coordinate into a dot. It lives here because
    the record is written from it and `check` reads the record back: a dot's `px`/`py` are
    this function's answer for its own `place.at`, which is what makes re-rendering a
    plate a change to one row of a table rather than a re-thinning of a population.
    """
    scale = plate.width / float(plate.w)
    return (
        plate.width / 2 + (at[0] - float(plate.x)) * scale,
        plate.height / 2 - (at[1] - float(plate.y)) * scale,
    )


def _plate_row(name: str, family: dict, view: tuple[float, float, float], maxiter) -> dict:
    """One partition's `plate`, as the record spells it."""
    across, down = PLATE_ASPECT
    width, height = plate_size()
    x, y, w = view
    row = {
        "file": f"plate-{name}.jpg",
        "width": width,
        "height": height,
        "family": _family_name(family),
        "x": _spelled(x),
        "y": _spelled(y),
        "w": _spelled(w),
        "aspect": [across, down],
        "mode": "smooth",
        "colormap": json.loads(GREY_RAMP.read_text(encoding="utf-8"))["name"],
        "supersample": PLATE_SUPERSAMPLE,
        "maxiter": maxiter,
    }
    constants = {
        key: str(value)
        for field, keys in PLATE_CONSTANTS.items()
        if field in family
        for key, value in zip(keys, family[field], strict=True)
    }
    if constants:
        row["constants"] = constants
    return row


def plates() -> list[str]:
    """Draw all five plates, re-project the dots onto them, and rewrite the record.

    **Idempotent by construction.** Every number it writes comes from the engine's own
    measurement of a family and from each dot's `place.at`, so running it twice writes the
    same record twice. That is the whole reason a dot carries the coordinate it stands at
    as well as the pixel it is drawn on: a plate can be re-cropped without anybody
    re-thinning a population, and the dots follow the picture instead of the other way
    around.
    """
    from . import renders

    ramp = json.loads(GREY_RAMP.read_text(encoding="utf-8"))
    directory = renders.colormap_directory(ramp["name"], ramp["kind"], ramp["stops"], "atlas-grey")
    width, height = plate_size()
    rows = records.read(ATLAS_INDEX)
    method = dict(rows[0].fields)
    held = {row.text("partition"): dict(row.fields) for row in rows[1:]}

    IMAGE_DIR.mkdir(parents=True, exist_ok=True)
    lines: list[str] = []
    partitions: list[dict] = []
    for name, label, title, family in PLANES_DRAWN:
        home = renders.home_view(family)
        view = plate_view(home["extent"])
        x, y, w = view
        out = renders.default_cache_root() / "atlas" / f"plate-{name}-{width}x{height}.jpg"
        out.parent.mkdir(parents=True, exist_ok=True)
        was = held.get(name, {})
        # **The cap is asked for, not remembered.** It is the engine's depth policy at this
        # width, so a warm render cache must not be the reason the record carries one value
        # or another — the first pass of this maker wrote a null for the one plate that was
        # already on disk, which is exactly that bug.
        maxiter = renders.run("maxiter", {"schema": 1, "widths": [_spelled(w)]})["caps"][0]
        if not out.is_file():
            echo = renders.run(
                "render",
                {
                    "schema": 1,
                    "family": family,
                    "viewport": {
                        "center_re": _spelled(x),
                        "center_im": _spelled(y),
                        "width": _spelled(w),
                    },
                    "resolution": [width, height],
                    "supersample": PLATE_SUPERSAMPLE,
                    "colormap": ramp["name"],
                    "colormap_dir": str(directory),
                    "mode": "smooth",
                    "output": str(out),
                },
            )
            maxiter = echo.get("maxiter")
            lines.append(f"  {name}: {echo.get('seconds')}s at cap {maxiter}")
        plate = _plate_row(name, family, view, maxiter)
        shutil.copyfile(out, IMAGE_DIR / plate["file"])
        partitions.append(
            {
                "schema": records.SCHEMA,
                "kind": "partition",
                "partition": name,
                "title": title,
                "label": label,
                "family": plate["family"],
                "file": f"{name}.jsonl",
                "plate": plate,
                "plate_width": was.get("plate_width", DEFAULT_PLATE_WIDTH),
                "dots": 0,
                "says": was.get("says", NO_MARKS_YET),
            }
        )
        lines.append(
            f"  plate-{name}.jpg  {width}x{height}  x {x:.4f} y {y:.4f} w {w:.4f}  "
            f"{(IMAGE_DIR / plate['file']).stat().st_size / 1e3:.0f} kB"
        )

    for partition in partitions:
        path = ATLAS_DIR / partition["file"]
        # A plane with no marks keeps an empty file rather than none, so that every
        # partition looks the same on disk; there is nothing in it to re-project.
        if not path.is_file() or path.stat().st_size == 0:
            path.write_text("", encoding="utf-8", newline="\n")
            continue
        spelled = _plate(records.Record(ATLAS_INDEX, 0, partition))
        moved = []
        for row in records.read(path):
            dot = dict(row.fields)
            at = dot["place"]["at"]
            px, py = project((float(at[0]), float(at[1])), spelled)
            dot["px"], dot["py"] = round(px, 2), round(py, 2)
            moved.append(dot)
        _write_rows(path, moved)
        partition["dots"] = len(moved)
        if moved:
            lines.append(f"  {partition['file']}: {len(moved)} dots re-projected")

    # **The absorption radius is a distance on the plane, and pixels are only how a plate
    # spells it.** The thinning ran at twelve pixels on the first plate — 4096 across a
    # width of 4.4 — and a plate drawn at another crop spells the same distance with
    # another number. So the record keeps the plane distance, `radius_plane`, and
    # `radius_px` is restated from it against whichever plate the dots are drawn on now:
    # `check`'s `_separated` reads the pixels, and the pixels have to describe this plate.
    radius_plane = method.get("radius_plane")
    if radius_plane is not None:
        drawn = next(one for one in partitions if one["dots"] > 0)["plate"]
        method["radius_px"] = round(radius_plane * drawn["width"] / float(drawn["w"]), 2)
        lines.append(f"  absorption radius {radius_plane} on the plane: {method['radius_px']} px")

    _write_rows(ATLAS_INDEX, [method] + partitions)
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

#: What each kind of place is drawn in. The page's two tokens, transcribed the way
#: `builder/theme.py` transcribes the well colors and for the same reason: Pillow cannot
#: read CSS. `check`'s `theme` holds those five; these two are the atlas's own and are
#: held by nothing but this comment, because a figure drawn a shade off its page is not a
#: failure a reader could be misled by.
MARK_COLOR = {"mandelbrot": (77, 141, 240), "julia": (242, 88, 76)}


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
        canvas.ellipse((x - radius, y - radius, x + radius, y + radius), fill=MARK_COLOR[dot.plane])

    width, height = images.land(sheet, figure.path)
    return [
        f"{figure.file}: {width}x{height}, {len(partition.dots)} marks "
        f"({figure.path.stat().st_size / 1e3:.0f} kB)"
    ]
