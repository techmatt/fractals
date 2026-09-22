"""The atlas record: what a dot in the atlas frame is made of, and what holds it to shape.

The atlas draws one dot per place the search kept, over a pre-rendered plate of the plane
those places sit in, and every picture a dot carries opens in the explorer at the view it
stands for. `atlas/frame.js` is the frame, and the explorer's Atlas tab is the one page
that mounts it — it was a page of its own at `atlas/index.html` until
`website_webp_and_atlas_deprecate` (2026-09-21) retired that for the tab. The record below
is the **contract between the wallpaper project's maker and that frame**: the maker writes
it, the frame reads it, and neither composes a key the other did not put there.

That last rule is the whole point of the file. A frame that worked out a location's
viewport from a position in a list — or an index into a pool derived from live data —
would draw at a moving target, and a rerun next door would silently repoint every dot.
So a slot carries **its own** viewport keys, spelled the way the permalink contract
spells them, and the frame hands them to `permalink.js` without arithmetic.

## The shape

`atlas/atlas.jsonl` is the index and carries no dots:

* one **`method`** row — what every plane shares: the record the seats were
  read out of, the judge that scored it, the fine bar the population was cut at, the map
  the neighborhood plates are drawn through, the size of a slot picture, and the tally of
  the whole atlas;
* one **`partition`** row per plane — the plate its dots are drawn over, that plate's own
  view, the word the frame's strip of planes puts on it, the file its dots are in, and
  everything that is the plane's own rather than the atlas's: the absorption radius, the
  neighborhood width, the tally, the two labels its location slots wear, and whether its
  slot pictures are committed. There are six: the Mandelbrot parameter plane and the
  four higher-degree ones, each with the Julia places of its degree drawn over the same
  plate because a Julia place *is* a `c` and a `c` is a point of that plane; and the
  classic Phoenix slice, whose places are frames on the slice itself. A plane the search
  has not reached carries an empty dot file rather than none, so marks land later as rows
  and nothing that reads the record changes. `python -m builder atlas --plates` draws all
  six plates, each cropped to its set's own measured extent at one shared aspect, and
  re-projects the dots from the plane coordinates they already carry.

A partition keeps its absorption radius twice: `radius_plane`, the distance on the plane
the thinning ran at, and `radius_px`, that distance spelled in the pixels of the plate the
dots are drawn on now. The second is restated from the first whenever the plates are,
because a plate cropped tighter spells one distance with a bigger number — and it is a
partition's rather than the atlas's because the maker thins every plane at twelve pixels of
*its own* base, so the distance on the plane differs from one plane to the next.

`pictures` is `tracked` or `staged`. A staged plane's slot pictures are untracked and
listed in `.git/info/exclude`, the way the staged gallery's are: the record commits and the
pictures wait for a deploy. A clone has the record and none of the files, which `check`
reports as a named skip rather than as a broken page or a pass.

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

It also carries what became of the picture's tone, because a gallery picture went through
`band_autolevel/v1` and a link that forgot the curve would draw the right geometry in the
wrong color:

* `tone` — `clean` where the operator did not act, `curved` where it did and the run
  recorded the curve, `lost` where it did and the run did not;
* `level` — the curve as the permalink's own `level` value, where `tone` is `curved`, and
  `null` everywhere else. The page hands it to the link, so a curved seat opens levelled;
* `gap` — what the run did not record, where `tone` is `lost`, which the tooltip says;
* `from` — the run the row came out of, and `curve` — the mode's transform it was drawn
  at. Both are notes; nothing reads them to build a link.

A `lost` slot is the one that carries an `autolevel` refusal, and a slot that carries one
is `lost`: the two are one fact spelled twice, and the loader holds them together.

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
    "multibrot6",
    "julia",
    "julia3",
    "julia4",
    "julia5",
    "julia6",
    "phoenix",
)

#: The constants a family's view needs beside `x`, `y` and `w`, keyed as the permalink
#: keys them. A view on a family not listed here carries none.
CONSTANTS = {
    "julia": ("cx", "cy"),
    "julia3": ("cx", "cy"),
    "julia4": ("cx", "cy"),
    "julia5": ("cx", "cy"),
    "julia6": ("cx", "cy"),
    "phoenix": ("cx", "cy", "px", "py", "zx", "zy"),
}

#: The three pictures a dot carries, in the order the page shows them, left to right.
SLOTS = ("mandelbrot", "julia", "gallery")

#: The two kinds of place, and the word each is spelled with. A dot is one of them and
#: never both.
PLANES = ("mandelbrot", "julia")

#: Whether a plane's slot pictures are committed, or untracked and waiting for a deploy.
PICTURES = ("tracked", "staged")

#: What became of a gallery picture's tone curve: untouched, recorded, or not recorded.
TONES = ("clean", "curved", "lost")

#: The one tone operator a gallery picture went through, as the record's `level` names it
#: and as `refused` names it where the curve was lost.
LEVEL_OPERATOR = "band_autolevel/v1"
LOST_LEVEL = f"autolevel {LEVEL_OPERATOR}"

#: Which plane a slot's family belongs to. This is how the gallery slot's own `plane` is
#: checked rather than trusted: the row says which kind of place it came from, and its
#: family has to agree.
PLANE_OF_FAMILY = {
    "mandelbrot": "mandelbrot",
    "multibrot3": "mandelbrot",
    "multibrot4": "mandelbrot",
    "multibrot5": "mandelbrot",
    "multibrot6": "mandelbrot",
    "julia": "julia",
    "julia3": "julia",
    "julia4": "julia",
    "julia5": "julia",
    "julia6": "julia",
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
    tone: str | None = None
    level: str | None = None
    gap: str | None = None
    came_from: str | None = None
    curve: str | None = None

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
    constants: dict[str, str] = field(default_factory=dict)

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
    pictures: str
    slot_labels: dict[str, str]
    slot_maps: dict[str, str]
    julia_place: str
    radius_plane: float | None = None
    radius_px: float | None = None
    tally: dict = field(default_factory=dict)
    dots: tuple[Dot, ...] = field(default=())

    @property
    def staged_without_pictures(self) -> bool:
        """A staged plane whose slot pictures are not on this machine, which is a clone."""
        return self.pictures == "staged" and not any(
            slot.path.is_file() for dot in self.dots for slot in dot.slots.values()
        )


@dataclass(frozen=True)
class Atlas:
    """The whole record: where it came from, and one entry per partition."""

    made: str
    record: str
    judge: str
    fine_bar: float
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
    tone = held.get("tone")
    level = held.get("level")
    notes = {key: held.get(key) for key in ("gap", "from", "curve")}
    if name == "gallery":
        if plane not in PLANES:
            raise AtlasError(
                f"{row.where}: {where}.plane says which kind of place this picture came from"
            )
        if not isinstance(seated, bool):
            raise AtlasError(f"{row.where}: {where}.seated must be true or false")
        if tone not in TONES:
            raise AtlasError(f"{row.where}: {where}.tone is one of {', '.join(TONES)}")
        if level is not None and (
            not isinstance(level, str) or not level.startswith(LEVEL_OPERATOR + ":")
        ):
            raise AtlasError(
                f"{row.where}: {where}.level is a {LEVEL_OPERATOR} curve as a link spells it, "
                "or null"
            )
        if (level is not None) != (tone == "curved"):
            raise AtlasError(
                f"{row.where}: {where} says tone {tone} and "
                + ("carries a level" if level is not None else "carries no level")
            )
        if (LOST_LEVEL in refused) != (tone == "lost"):
            raise AtlasError(
                f"{row.where}: {where} says tone {tone} and "
                + ("refuses" if LOST_LEVEL in refused else "does not refuse")
                + f" {LOST_LEVEL}"
            )
        for key, value in notes.items():
            if value is not None and (not isinstance(value, str) or not value):
                raise AtlasError(f"{row.where}: {where}.{key} is a non-empty string, or null")
    elif plane is not None or seated is not None or tone is not None or level is not None:
        raise AtlasError(
            f"{row.where}: only the gallery slot carries plane, seated, tone and level"
        )
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
        tone=tone,
        level=level,
        gap=notes["gap"],
        came_from=notes["from"],
        curve=notes["curve"],
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
        constants={key: constants[key] for key in wanted},
        **view,
    )


def _labels(row: records.Record) -> dict[str, str]:
    """The words a plane's two location slots wear. The gallery slot's is the page's own."""
    held = row.optional_mapping("slot_labels")
    names = SLOTS[:2]
    if (
        held is None
        or set(held) != set(names)
        or any(not isinstance(held[name], str) or not held[name] for name in names)
    ):
        raise AtlasError(
            f"{row.where}: slot_labels names the words on the {' and '.join(names)} slots"
        )
    return {name: held[name] for name in names}


def _maps(row: records.Record) -> dict[str, str]:
    """The map each location slot's header carries under its name, where there is one.

    Derived next door by `maps_of` and carried here because the frame renders words rather
    than deriving them. **An absent line is a header with a name and no formula**, which is
    what a family whose recurrence is not one line gets, so the mapping is allowed to be
    empty or to name one slot and not the other — what it may not be is a line that is not
    a string, because that is a record somebody edited by hand into something the page
    would print as `[object Object]`.
    """
    held = row.optional_mapping("slot_maps")
    if held is None:
        return {}
    names = SLOTS[:2]
    if any(key not in names for key in held) or any(
        not isinstance(value, str) or not value for value in held.values()
    ):
        raise AtlasError(
            f"{row.where}: slot_maps is the map on the {' or '.join(names)} slot's header"
        )
    return dict(held)


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
        # record is allowed to be in.** A plane is a plate a reader can
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
        pictures = row.fields.get("pictures")
        if pictures not in PICTURES:
            raise AtlasError(f"{row.where}: pictures is one of {', '.join(PICTURES)}")
        # A plane with marks was thinned at some radius and counted, and says both; a plane
        # with none has nothing to have thinned.
        radius_plane = row.fields.get("radius_plane")
        radius_px = row.fields.get("radius_px")
        counted = row.optional_mapping("tally") or {}
        if dots and (radius_plane is None or radius_px is None or not counted):
            raise AtlasError(
                f"{row.where}: a plane with marks carries its radius_plane, radius_px and tally"
            )
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
                pictures=pictures,
                slot_labels=_labels(row),
                slot_maps=_maps(row),
                julia_place=row.text("julia_place"),
                radius_plane=None
                if radius_plane is None
                else _number(row, radius_plane, "radius_plane"),
                radius_px=None if radius_px is None else _number(row, radius_px, "radius_px"),
                tally=counted,
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
        found.extend(_separated(partition, partition.radius_px or 0))
        found.extend(_galleried(partition))
        found.extend(_sliced(partition))
        found.extend(_pictures(partition, atlas.thumb))
    found.extend(_named(atlas))
    found.extend(_tallied(atlas))
    return found


def staged_without_pictures() -> list[Partition]:
    """The staged planes whose slot pictures this machine does not have, for `check`'s skips.

    Never a failure: the pictures are untracked by design, so a clone holds the record and
    none of the files. One picture present means the ingest has run here, and then the whole
    plane is held to its record exactly as a tracked one is — a half-landed plane is a real
    problem and says so.
    """
    try:
        atlas = load_all()
    except (AtlasError, records.RecordError):
        return []
    return [partition for partition in atlas.partitions if partition.staged_without_pictures]


def _sliced(partition: Partition) -> list[str]:
    """Every view on a pinned plane is drawn at that plane's own constants.

    The Phoenix plate is one slice of a six-dimensional family, and a mark on it only means
    something if the pictures it carries were drawn at that slice. The ingest spells a
    recipe that named no constants at the plate's — which is the engine's own reading of a
    bare `phoenix` spec — so this is what holds that choice to being true rather than
    convenient.
    """
    wanted = partition.plate.constants
    if not wanted:
        return []
    found = []
    for dot in partition.dots:
        for slot in dot.slots.values():
            if slot.family != partition.plate.family:
                continue
            off = [key for key in wanted if float(slot.view[key]) != float(wanted[key])]
            if off:
                found.append(
                    f"{partition.file}: dot {dot.id}'s {slot.name} is drawn off the plate's "
                    f"slice, at another {', '.join(off)}"
                )
    return found


def _named(atlas: Atlas) -> list[str]:
    """No two partitions name one picture, because one directory holds them all."""
    seen: dict[str, str] = {}
    found = []
    for partition in atlas.partitions:
        names = [partition.plate.file] + [
            slot.file for dot in partition.dots for slot in dot.slots.values()
        ]
        for name in names:
            if name in seen and seen[name] != partition.name:
                found.append(f"{name} is named by both {seen[name]} and {partition.name}")
            seen.setdefault(name, partition.name)
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
    # The plate is committed on every plane; a staged plane's slot pictures are not, and
    # where none of them is here that is `check`'s named skip rather than a problem.
    dots = () if partition.staged_without_pictures else partition.dots
    for dot in dots:
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
    for dot in dots:
        for slot in dot.slots.values():
            if images.dimensions(slot.path) != size:
                width, height = images.dimensions(slot.path)
                found.append(
                    f"{partition.file}: {slot.file} is {width}x{height} on disk and the "
                    f"method row says every slot picture is {size[0]}x{size[1]}"
                )
    return found


def _counted(dots) -> dict[str, int]:
    """What a tally counts, counted off the dots themselves."""
    return {
        "dots": len(dots),
        "mandelbrot": sum(1 for dot in dots if dot.plane == "mandelbrot"),
        "julia": sum(1 for dot in dots if dot.plane == "julia"),
        "seated": sum(1 for dot in dots if dot.seated),
        "gallery_seated": sum(1 for dot in dots if dot.slots["gallery"].seated),
        "dropped": sum(dot.dropped for dot in dots),
    }


def _tallied(atlas: Atlas) -> list[str]:
    """Every tally the record carries is a count of the dots it actually holds.

    Each plane's tally is held to that plane's dots, and the method row's to all of them,
    so the atlas's own figure cannot drift from the sum of its planes.
    """
    found: list[str] = []
    everything = [dot for partition in atlas.partitions for dot in partition.dots]
    for where, tally, dots in [
        (f"{ATLAS_INDEX.name} {partition.name}", partition.tally, partition.dots)
        for partition in atlas.partitions
    ] + [(ATLAS_INDEX.name, atlas.tally, everything)]:
        counted = _counted(dots)
        found.extend(
            f"{where}: the tally says {key} {tally[key]} and the dots hold {value}"
            for key, value in counted.items()
            if key in tally and tally[key] != value
        )
        queued = tally.get("queued")
        if queued is not None and queued != counted["dots"] + counted["dropped"]:
            found.append(
                f"{where}: {queued} places were queued and the dots account for "
                f"{counted['dots'] + counted['dropped']}"
            )
    return found


def summary() -> list[str]:
    """What the record holds, for `python -m builder atlas`."""
    atlas = load_all()
    lines = [
        f"atlas/atlas.jsonl — made {atlas.made} from the record {atlas.record}",
        f"  judge {atlas.judge[:12]}… · fine bar {atlas.fine_bar:g} · "
        f"neighborhood plates through {atlas.canonical_map}",
    ]
    for partition in atlas.partitions:
        plate = partition.plate
        lines.append(
            f"  {partition.name}: {len(partition.dots)} dots over {plate.file} "
            f"({plate.width}x{plate.height}, {plate.mode} through {plate.colormap}) · "
            f"pictures {partition.pictures}"
        )
        if partition.radius_px is not None:
            lines.append(
                f"    absorption radius {partition.radius_plane:g} on the plane, "
                f"{partition.radius_px:g} px · neighborhood plates {partition.plate_width} wide"
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
        tones = {
            tone: sum(1 for dot in partition.dots if dot.slots["gallery"].tone == tone)
            for tone in TONES
        }
        if partition.dots:
            lines.append(
                f"    gallery tone: {tones['clean']} clean, {tones['curved']} curved and opening "
                f"levelled, {tones['lost']} lost"
            )
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

#: Where `curate atlas --plane <partition>` writes, inside the wallpapers checkout: one
#: directory per plane, named as this record names its partitions. The maker writes its
#: refusal lines in the site's short forms — `colormap <name>`, `mirror on a cyclic map`,
#: `autolevel band_autolevel/v1`, `curve <name>` — so they pass through untouched, and
#: `atlas.test.mjs` holds the first two to the roster in both directions.
MAKER_OUTPUT = ("artifacts", "atlas")
MAKER_FILE = "dots.json"
MAKER = "fractal-wallpapers curate atlas"

#: The width a **Julia** dot's neighborhood plate is drawn at, on every parameter plane.
#:
#: **It is the explorer's `BACK_WIDTH`, and it is this repository's constant rather than
#: the maker's** *(atlas_refresh_ckpt139, 2026-09-21)*. A Julia dot's first slot is a
#: neighborhood of the `c` its set is drawn at, and the page a reader lands on from a Julia
#: view is *Back to Mandelbrot*, which frames the parent plane 0.05 across — picked by eye
#: over thirteen gallery `c` values and written down in `explorer/explorer.js`. The maker
#: next door drew that plate at a twentieth of the plane's own home width instead, which is
#: 0.22 on the Mandelbrot plane and a different number on each of the other four, so the
#: atlas showed one frame and the link under it opened another.
#:
#: Transcribed here because Python cannot read JavaScript, the way `builder/theme.py`
#: transcribes the well colors. A pinned plane keeps the maker's own width: Phoenix's first
#: slot is a neighborhood of the slice a place is a frame on, and no *back* lands there.
JULIA_PLATE_WIDTH = "0.05"

#: The maker, driven from here so that the width above is applied where it belongs.
#:
#: `curate atlas` passes one neighborhood width to every place of a plane, and which places
#: get a neighborhood plate at all is a fact about the *kind* of place — a parameter-plane
#: place shows its own frame and a dynamical one shows its `c` — so the two are separable
#: without the maker knowing anything about this page. The wrapper below narrows the width
#: for a dynamical place and leaves everything else the maker's, then restates
#: `plate_width` on the payload from the plates that were actually drawn and refuses a
#: plane that came out with two of them.
#:
#: Read-only next door, per that repository's rule here: this runs its library, writes
#: nothing but its own `artifacts/atlas/<plane>/`, and changes not one line of its code.
MAKER_PROGRAM = """
import json, sys

from fractal_wallpapers.curation import atlas
from fractal_wallpapers.curation.atlas import pictures as drawing
from fractal_wallpapers.curation.atlas import slots
from fractal_wallpapers.supply import partitions

ask = json.load(sys.stdin)
width = str(ask["julia_plate_width"])
maker = slots.views_of


def views_of(place, plane_family, julia_home, plate_width, canonical):
    narrowed = width if partitions.is_dynamical(place.partition) else plate_width
    return maker(place, plane_family, julia_home, narrowed, canonical)


slots.views_of = views_of

said = {}
for plane in ask["planes"]:
    summary = atlas.make(plane=plane, record=ask["record"])
    out = atlas.default_out(plane) / atlas.DOTS_NAME
    payload = json.loads(out.read_text(encoding="utf-8"))
    plates = sorted(
        {
            str(dot["slots"]["mandelbrot"]["viewport"]["width"])
            for dot in payload["dots"]
            if str((dot["slots"].get("mandelbrot") or {}).get("what") or "").startswith(
                "a neighborhood plate"
            )
        }
    )
    if len(plates) > 1:
        raise SystemExit(f"{plane}: neighborhood plates at {plates}, and a plane records one")
    if plates and payload["plate_width"] != plates[0]:
        payload["plate_width"] = plates[0]
        drawing.write_json(out, payload)
    said[plane] = {
        "dots": summary.get("dots"),
        "thumbs": (summary.get("thumbs") or {}).get("made"),
        "failed": (summary.get("thumbs") or {}).get("failed"),
        "seconds": summary.get("seconds"),
        "plate_width": payload["plate_width"],
    }
print("ATLAS-MADE " + json.dumps(said))
"""


def make(record: str, planes=None) -> list[str]:
    """Run the maker next door for each plane, at this page's own Julia plate width.

    The maker holds the candidate pool while it reads, so this never runs beside a solve,
    a growth pass or the slow lane — the same rule that repository states for it.
    """
    import subprocess

    from . import renders

    wanted = list(planes or [name for name, *_ in PLANES_DRAWN])
    unknown = [name for name in wanted if name not in {one for one, *_ in PLANES_DRAWN}]
    if unknown:
        raise AtlasError(f"{', '.join(unknown)}: not a plane this record carries")
    # Streamed rather than captured: the maker prints a stamped line per stage and one per
    # sixty thumbnails, and this leg is twenty minutes. A run whose progress only arrives
    # at the end is a run nobody can tell from a hang.
    ask = {"record": record, "planes": wanted, "julia_plate_width": JULIA_PLATE_WIDTH}
    said, tail = [], []
    with subprocess.Popen(
        [str(renders.venv_python()), "-c", MAKER_PROGRAM],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        # The maker writes its own prose to the console, and a console that is not UTF-8
        # hands back a byte no decoder here should die on.
        errors="replace",
        cwd=str(renders.wallpapers_root()),
    ) as running:
        running.stdin.write(json.dumps(ask))
        running.stdin.close()
        for line in running.stdout:
            line = line.rstrip()
            if line.startswith("ATLAS-MADE "):
                said.append(line)
                continue
            tail = (tail + [line])[-40:]
            print(f"  | {line}", flush=True)
    if running.returncode != 0 or not said:
        raise AtlasError(f"{MAKER} failed at {record}:\n" + "\n".join(tail))
    answer = json.loads(said[-1][len("ATLAS-MADE ") :])
    lines = [f"{MAKER} --record {record}, Julia plates {JULIA_PLATE_WIDTH} wide"]
    for name in wanted:
        held = answer[name]
        lines.append(
            f"  {name}: {held['dots']} dots · {held['thumbs']} thumbnails "
            f"({held['failed']} failed) · plates {held['plate_width']} wide · {held['seconds']}s"
        )
    return lines


#: What every plane of one atlas has to agree on, because the method row says it once.
SHARED = (
    ("record", "record"),
    ("judge_artifact", "judge"),
    ("fine_bar", "fine_bar"),
    ("canonical_map", "canonical_map"),
)

#: The atlas's own sentence about itself, on the method row.
METHOD_SAYS = (
    "Every place the search kept on the planes it has searched, thinned to one dot per "
    "neighborhood. A place is here because at least one of its rows reads at or above the "
    "solve's own fine bar, and nothing else puts one here. The seats of the general gallery "
    "are placed first and everything else follows by its best fine score; a place landing "
    "inside the absorption radius of a dot already drawn is dropped, whichever kind either "
    "of them is, so a dot is one place of one kind."
)

#: The quality a slot picture is re-encoded at, and **the format is WebP**
#: *(website_webp_and_atlas_deprecate, 2026-09-21)*. The maker lands these at the engine's
#: own quality and they are three times the size this page can afford to ship. They used to
#: be JPEG at 78 with no chroma subsampling, because a fractal thumbnail is all saturated
#: edge; at 400x225 across 1,464 of them that came to 42.7 MB, which is the largest thing
#: this repository would ever have deployed after the seat tiles. Lossy WebP is 4:2:0
#: always, so this trades the subsampling rule for a third of the bytes — 27.5 MB, measured
#: on these pictures rather than argued, and the ingest prints it a plane at a time. A slot
#: picture is a 400x225 thumbnail in a strip of three, and the plate under it is what a
#: reader is reading; a plate is the picture somebody studies and it stays JPEG 4:4:4 at 88.
#: It is a number to re-derive rather than to keep, the day a release puts twice as many
#: dots on the plate.
THUMB_QUALITY = 70


def _shade_of(palette: object) -> dict:
    """A recipe's shade as the record carries it: only what differs from the default."""
    if not isinstance(palette, dict):
        return {}
    return {
        key: palette[key]
        for key, fallback in SHADE_DEFAULTS.items()
        if key in palette and palette[key] != fallback
    }


def maker_output(plane: str = "mandelbrot") -> Path:
    """The maker's `dots.json` for one plane, in the configured wallpapers checkout."""
    from . import renders

    return renders.wallpapers_root().joinpath(*MAKER_OUTPUT, plane, MAKER_FILE)


def _slot_row(name: str, held: dict, file: str, plate: Plate) -> dict:
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
    wanted = CONSTANTS.get(row["family"], ())
    for spelled, keys in PLATE_CONSTANTS.items():
        for key, value in zip(keys, held["family"].get(spelled) or (), strict=False):
            if key in wanted:
                row[key] = str(value)
    missing = [key for key in wanted if key not in row]
    # **A recipe on a pinned plane may leave the pin unsaid.** Some Phoenix rows next door
    # spell their family as a bare `{"kind": "phoenix"}`, which the engine writes out as the
    # classic slice — its own spec test says so — and which the maker only placed on this
    # plate because its partition is that slice. So the plate's constants are the ones it
    # was drawn at, and `_sliced` holds every slot on the plane to them. Anywhere else a
    # missing constant is a recipe this page cannot link, and it is refused.
    if missing and row["family"] == plate.family and set(missing) <= set(plate.constants):
        row.update({key: plate.constants[key] for key in missing})
    elif missing:
        raise AtlasError(f"a {row['family']} {name} picture gives no {', '.join(missing)}")
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
        row["tone"] = held.get("tone")
        row["level"] = held.get("level")
        for key in ("gap", "from", "curve"):
            if held.get(key) is not None:
                row[key] = held[key]
    row["refused"] = list(held.get("refused") or [])
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


def ingest(
    source: Path | None = None,
    *,
    quality: int = THUMB_QUALITY,
    made: str | None = None,
    rewriting: frozenset[str] = frozenset(),
) -> list[str]:
    """Turn the maker's `dots.json` and `thumbs/` into the committed record and pictures.

    The maker next door writes a working file; this is the one program that turns it into
    what the site ships, and it is committed rather than left in `scratch/` for the reason
    the figure makers are: a record nobody can rebuild is a record nobody can correct. It
    re-encodes every thumbnail — the maker's are three times the size this page can afford
    — sweeps `assets/images/atlas/` of anything the new record does not name, and writes
    both JSONL files.

    **One plane at a time, and the plane is the record's to say.** The maker writes one
    directory per plane and names the plane in the payload; that name picks the partition
    row the dots land on and the plate they are projected onto. Every other plane's rows and
    pictures are left as they stand, which is why the sweep reads every partition's dot file
    rather than this ingest's alone, and why a slot picture's name opens with its plane: ids
    restart at nought on every plane, and one directory holds all of them.

    **The plates are this repository's, not the maker's.** The maker still lands a 16:9
    `base.jpg` and projects its dots onto that; the site draws its own six plates with
    `--plates`, so the ingest keeps every committed plate as it stands and projects each dot
    from its own place onto its plane's committed plate. The absorption radius comes in as
    pixels of the maker's base and is kept on the plane, then restated against the plate the
    dots are drawn on.
    """
    from datetime import date

    source = source or maker_output()
    payload = json.loads(source.read_text(encoding="utf-8"))
    here = source.parent
    base = payload["base"]
    thumb_across, thumb_down = (int(value) for value in payload["thumb"]["resolution"])
    plane = str(payload["plane"])

    index = records.read(ATLAS_INDEX)
    method = dict(index[0].fields)
    partitions = [dict(row.fields) for row in index[1:]]
    target = next((one for one in partitions if one["partition"] == plane), None)
    if target is None:
        raise AtlasError(f"{ATLAS_INDEX.name}: no {plane} partition to ingest dots onto")
    # The method row says once what every plane shares, so a plane made against another
    # release, judge, bar, map or thumbnail size is two atlases in one record and refused.
    # **A plane the same pass is rewriting is not a plane already in the record**
    # *(site_rebase_ckpt132)*: moving every plane to a new record at once would otherwise
    # refuse its first plane against five that are about to change with it. A plane left
    # standing is still held to it.
    others = [
        one
        for one in partitions
        if one is not target and one["dots"] > 0 and one["partition"] not in rewriting
    ]
    if others:
        disagree = [ours for theirs, ours in SHARED if method.get(ours) != payload[theirs]]
        if method.get("thumb") != {"width": thumb_across, "height": thumb_down}:
            disagree.append("thumb")
        if disagree:
            raise AtlasError(
                f"{source}: {plane} disagrees with the planes already in the record about "
                f"{', '.join(disagree)}"
            )
    drawn = _plate(records.Record(ATLAS_INDEX, 1, target))
    radius_plane = round(
        float(payload["radius_px"]) * float(base["viewport"]["width"]) / int(base["resolution"][0]),
        6,
    )

    IMAGE_DIR.mkdir(parents=True, exist_ok=True)
    landed = {one["plate"]["file"] for one in partitions}
    for one in partitions:
        path = ATLAS_DIR / one["file"]
        if one is target or not path.is_file() or path.stat().st_size == 0:
            continue
        landed.update(
            slot["file"] for row in records.read(path) for slot in row.fields["slots"].values()
        )

    rows: list[dict] = []
    for dot in payload["dots"]:
        slots = {}
        for name in SLOTS:
            held = dot["slots"].get(name)
            if held is None:
                raise AtlasError(f"dot {dot['id']} has no {name} picture")
            file = f"{plane}-{dot['id']:04d}-{name}.webp"
            _encode(here / held["picture"], IMAGE_DIR / file, quality)
            landed.add(file)
            slots[name] = _slot_row(name, held, file, drawn)
        place = dot["place"]
        px, py = project((float(place["x"]), float(place["y"])), drawn)
        rows.append(
            {
                "schema": records.SCHEMA,
                "kind": "dot",
                "id": int(dot["id"]),
                "px": round(px, 2),
                "py": round(py, 2),
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
    was = dict(target)
    partitions[partitions.index(target)] = target = _partition_row(
        plane,
        was["plate"],
        was,
        dots=len(rows),
        plate_width=str(payload["plate_width"]),
        radius_plane=radius_plane,
        radius_px=round(radius_plane * drawn.width / float(drawn.w), 2),
        tally=tally,
        # A maker run on a plane with nothing kept on it lands no dots, and that plane says
        # so rather than claiming the marks it does not have: degree 6 is searched and
        # never labelled, so an empty directory for it is a real answer, not a failed one.
        marked=bool(rows),
    )
    method = _method_row(
        partitions,
        made=made or date.today().isoformat(),
        shared={ours: payload[theirs] for theirs, ours in SHARED},
        thumb={"width": thumb_across, "height": thumb_down},
    )

    _write_rows(ATLAS_INDEX, [method] + partitions)
    _write_rows(ATLAS_DIR / target["file"], rows)

    # Both suffixes, because the sweep is what takes the old format out. A slot picture is
    # WebP since `website_webp_and_atlas_deprecate` and every plate is still JPEG; the
    # plates are in `landed`, so sweeping `.jpg` as well removes a slot picture the previous
    # format left behind and touches nothing else.
    swept = [
        path
        for suffix in (".jpg", ".webp")
        for path in sorted(IMAGE_DIR.glob(f"*{suffix}"))
        if path.name not in landed
    ]
    for path in swept:
        path.unlink()
    ours = sum(
        (IMAGE_DIR / slot["file"]).stat().st_size for row in rows for slot in row["slots"].values()
    )
    return [
        f"{plane}: atlas/{target['file']} {len(rows)} dots · {len(rows) * len(SLOTS)} slot "
        f"pictures at {thumb_across}x{thumb_down} WebP quality {quality}, {ours / 1e6:.2f} MB · "
        f"{len(swept)} swept",
    ]


def ingest_every(*, quality: int = THUMB_QUALITY, made: str | None = None) -> list[str]:
    """Ingest every plane the maker has written, in the order the strip shows them.

    The planes landing together are named to each ingest as `rewriting`, so a pass that
    moves the whole atlas to another record is one pass and not a refusal.
    """
    lines: list[str] = []
    landing = frozenset(name for name, *_ in PLANES_DRAWN if maker_output(name).is_file())
    for name, *_ in PLANES_DRAWN:
        source = maker_output(name)
        if source.is_file():
            lines.extend(ingest(source, quality=quality, made=made, rewriting=landing))
        else:
            lines.append(f"{name}: no {source}, left as it stands")
    return lines


def _partition_row(
    name: str,
    plate: dict,
    was: dict,
    *,
    dots: int,
    plate_width: str | None = None,
    radius_plane: float | None = None,
    radius_px: float | None = None,
    tally: dict | None = None,
    marked: bool | None = None,
) -> dict:
    """One partition row, spelled one way by both of the programs that write it.

    `--plates` and `--ingest` each rewrite the index, and a row that came out with its keys
    in another order depending on which ran last would be a diff with nothing in it. So the
    row is built here, from `PLANES_DRAWN` for everything that is the table's to say and
    from the row as it stood for everything that is a plane's own history.
    """
    _, label, title, family, labels, julia_place, says = next(
        entry for entry in PLANES_DRAWN if entry[0] == name
    )
    radius_plane = was.get("radius_plane") if radius_plane is None else radius_plane
    radius_px = was.get("radius_px") if radius_px is None else radius_px
    tally = was.get("tally") if tally is None else tally
    marked = dots > 0 if marked is None else marked
    row = {
        "schema": records.SCHEMA,
        "kind": "partition",
        "partition": name,
        "title": title,
        "label": label,
        "family": plate["family"],
        "file": f"{name}.jsonl",
        "plate": plate,
        "plate_width": plate_width or was.get("plate_width", DEFAULT_PLATE_WIDTH),
        "dots": dots,
        "says": says if marked else NO_MARKS_YET,
        "pictures": was.get("pictures", "tracked"),
        "slot_labels": labels,
        "slot_maps": maps_of(family),
        "julia_place": julia_place,
    }
    if radius_plane is not None:
        row["radius_plane"] = radius_plane
        row["radius_px"] = radius_px
    if tally:
        row["tally"] = tally
    return row


def _method_row(partitions: list[dict], *, made: str, shared: dict, thumb: dict) -> dict:
    """The method row: what every plane shares, and the tally of all of them."""
    tally: dict[str, int] = {}
    for partition in partitions:
        for key, value in (partition.get("tally") or {}).items():
            if isinstance(value, int) and not isinstance(value, bool):
                tally[key] = tally.get(key, 0) + value
    return {
        "schema": records.SCHEMA,
        "kind": "method",
        "made": made,
        **{key: shared[key] for key in ("record", "judge")},
        "generator": MAKER,
        "canonical_map": shared["canonical_map"],
        "fine_bar": shared["fine_bar"],
        "thumb": thumb,
        "tally": tally,
        "says": METHOD_SAYS,
    }


def _encode(source: Path, destination: Path, quality: int) -> None:
    """One thumbnail, re-encoded at the page's own quality.

    The source is the maker's own thumbnail next door, at the engine's quality, so this is
    the one lossy step a slot picture takes however many times the format here changes.
    `method=6` is the encoder's slowest search, which is affordable on a 400x225 picture
    and is what makes the bytes a function of the input rather than of the hardware.
    """
    from PIL import Image

    with Image.open(source) as picture:
        picture.convert("RGB").save(destination, format="WEBP", quality=quality, method=6)


def _write_rows(path: Path, rows: list[dict]) -> None:
    body = "".join(json.dumps(row, ensure_ascii=False) + "\n" for row in rows)
    path.write_text(body, encoding="utf-8", newline="\n")


# ---------------------------------------------------------------------------- the plates


def _multibrot_says(degree: int) -> str:
    """What a multibrot plane's partition says once it has marks."""
    return (
        f"the degree-{degree} parameter plane, with the Julia places of that degree drawn over "
        "the same plane: a Julia place is a c, and c is a point of this plane"
    )


#: Superscript digits, so a degree is written once and the same way everywhere it appears.
SUPERSCRIPTS = str.maketrans("0123456789", "⁰¹²³⁴⁵⁶⁷⁸⁹")


def _power(degree: int) -> str:
    """`z³`, from a degree: what a plane's chip is called and what its map raises."""
    return f"z{str(degree).translate(SUPERSCRIPTS)}"


def maps_of(spec: dict) -> dict[str, str]:
    """The two location slots' maps, transcribed from the engine's family definitions.

    **A formula is read from the engine's source, never typed from memory.** The
    recurrences are written down in `engine/src/family.rs` — the doc comment over each
    `Family` variant, and the arm `Family::step` gives it — and repeated over the
    `FamilySpec` this site hands the engine in `engine/src/spec.rs`. Three of them reach
    this table:

    * `Multibrot { degree }` — `z ← z^d + c`, the pixel read as `c`, `z₀ = 0`;
    * `Julia { degree, c }` — the same `z ← z^d + c` at a fixed `c`, the pixel read as `z₀`;
    * `Phoenix { c, p, z_prev }` — `z_{n+1} = z_n² + c + p·z_{n-1}`, one step of memory.

    So a map is rendered from the spec rather than written out per plane: the degree lands
    in one place, and a plane added to the table later gets its formula without anybody
    spelling a formula. The Julia slot carries its plane's own degree and no numeric `c`,
    because the recurrence is what the header is for and the constant is in the details.

    Phoenix is the one that is not a map of `z` alone — its next term reads the term before
    it — so it is written as the engine writes it, indexed, rather than forced into the
    `z ↦` shape the memoryless families take. **A family whose definition yields no clean
    one-line map gets no line**: the header is its name alone, which is the truth, where a
    guessed formula would not be.
    """
    kind = spec.get("kind")
    if kind == "phoenix":
        # `z_{n+1} = z_n² + c + p·z_{n-1}` (family.rs: `Family::Phoenix`, and its `step`
        # arm `z * z + c + p * z_prev`). Every place on this plane is a frame on the same
        # slice, so both slots wear the same recurrence.
        both = "zₙ₊₁ = zₙ² + c + p·zₙ₋₁"
        return {"mandelbrot": both, "julia": both}
    degree = spec.get("degree")
    if kind in ("mandelbrot", "multibrot") and isinstance(degree, int):
        # `z ← z^d + c` for both planes: `Family::Multibrot` reads the pixel as `c`, and
        # `Family::Julia` at the same degree fixes `c` and reads the pixel as `z₀`. One
        # recurrence, which is why the engine's `step` gives them one arm.
        map_ = f"z ↦ {_power(degree)} + c"
        return {"mandelbrot": map_, "julia": map_}
    return {}


#: The six planes the atlas carries, in the order the frame's strip shows them: the
#: partition's own name, the word the strip puts on it, what it is, the family spec the
#: engine is asked for, the words its two location slots wear, what a mark of a Julia-kind
#: place is announced as, and what the partition says once it has marks. A plane the search
#: has not reached says `NO_MARKS_YET` instead, and its dot file is empty by design.
#:
#: **A chip is the plane's power and not its degree.** `z³` rather than `d=3`, because the
#: chips sit under a strip of headers that carry the same map — the chip and the header a
#: click on it opens are one sentence, and `d=3` was a second language for one plane.
#:
#: **A plane's constants come from this table and nowhere else.** The Phoenix slice is the
#: one that has any, and the record's `cx`/`cy`/`px`/`py`/`zx`/`zy` are spelled from the
#: same spec the render was drawn at, so the plate and the row recording it cannot
#: disagree about which Phoenix this is.
#:
#: **The slot words are the plane's own.** The first slot of a Mandelbrot-kind place is a
#: frame on that plane and the first slot of a Julia place is a neighborhood of it, so both
#: wear the plane's name; on Phoenix every place is a frame on the slice, so its second slot
#: is the place close up rather than a Julia set, and its marks are Phoenix places.
PLANES_DRAWN = (
    (
        "mandelbrot",
        _power(2),
        "Mandelbrot",
        {"kind": "mandelbrot", "degree": 2},
        {"mandelbrot": "Mandelbrot", "julia": "Julia"},
        "A Julia place",
        "the parameter plane, with the Julia places drawn over the same plane: a Julia place "
        "is a c, and c is a point of this plane",
    ),
    *(
        (
            f"multibrot{degree}",
            _power(degree),
            f"Multibrot, degree {degree}",
            {"kind": "multibrot", "degree": degree},
            {"mandelbrot": f"Multibrot {degree}", "julia": "Julia"},
            "A Julia place",
            _multibrot_says(degree),
        )
        for degree in (3, 4, 5, 6)
    ),
    (
        "phoenix",
        "Phoenix",
        "Phoenix, the classic slice",
        {"kind": "phoenix", "c": ["0.5667", "0.0"], "p": ["-0.5", "0.0"], "z_prev": ["0", "0"]},
        {"mandelbrot": "Phoenix", "julia": "Close-up"},
        "A Phoenix place",
        "the classic Phoenix slice, and every place kept on it is a frame on the slice itself",
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
#: **2052, half the first pass's 4104** *(explorer_slim_ckpt131)*. The panel shows a plate
#: at well under a thousand CSS pixels across, and the first plates were 0.76 to 1.23 MB
#: each, fetched every time the view changed plane. At this width the six are about a
#: quarter of what they were. A mark is placed from its coordinate, so it stays on the same
#: place however many pixels the plate has.
PLATE_LONG = 2052

#: How a plate is encoded. The engine writes the render losslessly and this is the one
#: lossy step, at the site's render-sheet quality, with no chroma subsampling for the same
#: reason as a slot picture's.
PLATE_QUALITY = 88

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
    answer moves, and five of these six sets have never been framed by anybody.
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
    """Draw all six plates, re-project the dots onto them, and rewrite the record.

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
    for name, _, _, family, *_ in PLANES_DRAWN:
        home = renders.home_view(family)
        view = plate_view(home["extent"])
        x, y, w = view
        # A PNG in the cache: the engine writes one for any extension but `.jpg`, so the
        # plate below goes through exactly one lossy encode.
        out = renders.default_cache_root() / "atlas" / f"plate-{name}-{width}x{height}.png"
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
        _encode(out, IMAGE_DIR / plate["file"], PLATE_QUALITY)
        partitions.append(_partition_row(name, plate, was, dots=was.get("dots", 0)))
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
    # Each plane was thinned at twelve pixels of its own base, so each is restated alone.
    for partition in partitions:
        radius_plane = partition.get("radius_plane")
        if radius_plane is None:
            continue
        drawn = partition["plate"]
        partition["radius_px"] = round(radius_plane * drawn["width"] / float(drawn["w"]), 2)
        lines.append(
            f"  {partition['partition']}: absorption radius {radius_plane} on the plane, "
            f"{partition['radius_px']} px"
        )

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
