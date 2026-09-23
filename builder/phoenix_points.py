"""The Phoenix tab's named points: a row of places on the plane, chosen from the seats.

## What this is for

The Phoenix tab draws the plane of Phoenix sets, `p` fixed and `c` over the plane, and a
click opens the set at a point. A reader landing there has no idea where the good sets
are. The curation passes next door do know: they seated a few hundred Phoenix pictures.
So under the tab's sentence sits a row of tiles, each one a place on the plane some seat
stands on, and a click moves the plane to that `p`, marks the point and opens the seat
exactly as it was recorded.

## Which seats are points of a plane at all

The plane opens every orbit at z₀ = z₋₁ = 0, so a Phoenix set is a point of it only where
its `zx`/`zy` are the origin. Most of the Phoenix work next door starts elsewhere, and of
the 404 Phoenix seats in the staged gallery on 2026-09-22 only 140 start at the origin.
Those 140 stand on eleven distinct `(p, c)`, and nine of the eleven have a complex `p`,
which is why the tab reads `p` as two numbers rather than one slider.

## The rule, as built

1. Every Phoenix row of every collection in the staged gallery (`builder/seats.py`'s
   record), one per recipe key, whose link starts at z₋₁ = 0.
2. Grouped by the exact `(p, c)` its link carries; each group is one point. The seat that
   stands for it is the one whose link is exactly its picture (`gap` null) before one that
   is not, then the highest `p_ge4` any of its collections recorded for it.
3. Points closer than `RADIUS` in `(Re p, Im p, Re c, Im c)` are one neighbourhood, by
   single linkage, and the neighbourhood is stood for by its best seat under the same
   ordering. So no two tiles are within `RADIUS` of each other.
4. The classic, c = 0.5667 at p = −0.5, is always the first tile and is not a seat: it
   opens the way a click on the plane there does.
5. The other `COUNT` are taken farthest-first in `p`: each is the neighbourhood whose `p`
   is furthest from every `p` already taken, the classic's included, with the better seat
   breaking a tie. That spreads the row over the `p` the gallery covers before it spends a
   second tile near one it already has.

The row shows them in reading order: the classic, then the rest by the real part of `p`.

## What lands

`explorer/phoenix-points.json`, tracked, and one thumbnail per seat in
`explorer/phoenix-points/`, copied byte for byte from the staged gallery. The staged
gallery is untracked until deploy and this row is standing UI, so its seven pictures are
committed rather than borrowed. The classic has no picture file; the tab draws its tile.

`p_ge4` is read from each collection's tentative record next door, so the command needs
the wallpapers checkout. It is no part of `build` or `check`.
"""

import json
import shutil
from dataclasses import dataclass
from urllib.parse import parse_qsl

from . import picks, seats
from .paths import GALLERY_IMAGES_DIR, SITE_ROOT

#: Two points closer than this in `(Re p, Im p, Re c, Im c)` are one neighbourhood. The
#: plane spans about 2.5 across; the eleven points on it have two pairs closer than this,
#: at 0.25 and 0.33, and the next nearest pair is 0.60 apart.
RADIUS = 0.35

#: How many tiles follow the classic.
COUNT = 7

#: The classic Ushiki instance, as `phoenix.js` marks it.
CLASSIC = {"p": [-0.5, 0.0], "c": [0.5667, 0.0]}

RECORD = SITE_ROOT / "explorer" / "phoenix-points.json"
PICTURES = SITE_ROOT / "explorer" / "phoenix-points"
STAGED = GALLERY_IMAGES_DIR / seats.SLUG

LF = "\n"


class PhoenixPointsError(Exception):
    """The staged gallery or the records next door cannot answer the question."""


@dataclass
class Seat:
    row: dict
    point: tuple[float, float, float, float]
    p_ge4: float

    def better(self) -> tuple:
        """Sort key, best first: a link that is its picture, then the judge's score."""
        return (self.row["gap"] is not None, -self.p_ge4, self.row["key"])


def _staged_rows() -> dict[str, dict]:
    header_path = STAGED / "gallery.jsonl"
    if not header_path.is_file():
        raise PhoenixPointsError(f"{header_path} is not there; run `python -m builder seats`")
    with header_path.open(encoding="utf-8") as handle:
        header = json.loads(handle.readline())
    rows: dict[str, dict] = {}
    for entry in header["collections"]:
        with (STAGED / entry["file"]).open(encoding="utf-8") as handle:
            for line in handle:
                if line.strip():
                    row = json.loads(line)
                    rows.setdefault(row["key"], row)
    return rows


def _query(row: dict) -> dict[str, str]:
    return dict(parse_qsl(row["link"]))


def _on_the_plane(query: dict[str, str]) -> bool:
    return query.get("f") == "phoenix" and float(query["zx"]) == 0 and float(query["zy"]) == 0


def _scores(candidates: dict[str, dict]) -> dict[str, float]:
    """Each key's highest `p_ge4` across the tentative records of its collections."""
    stamps = dict(seats.COLLECTIONS)
    wanted: dict[str, set[str]] = {}
    for key, row in candidates.items():
        for name in row["collections"]:
            wanted.setdefault(name, set()).add(key)
    best: dict[str, float] = {}
    for name, keys in wanted.items():
        try:
            recorded = picks.seats(stamps[name])
        except picks.PickError as error:
            raise PhoenixPointsError(str(error)) from error
        for key in keys:
            score = recorded.get(key, {}).get("p_ge4")
            if score is None:
                raise PhoenixPointsError(f"{name} ({stamps[name]}) records no p_ge4 for {key}")
            best[key] = max(best.get(key, 0.0), float(score))
    return best


def _distance(a: tuple, b: tuple) -> float:
    return sum((x - y) ** 2 for x, y in zip(a, b, strict=True)) ** 0.5


def _p_distance(a: tuple, b: tuple) -> float:
    return ((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2) ** 0.5


def _neighbourhoods(points: list[Seat]) -> list[list[Seat]]:
    """Single linkage at `RADIUS`: a point joins every group it is near, merging them."""
    groups: list[list[Seat]] = []
    for point in points:
        near = [g for g in groups if any(_distance(point.point, o.point) < RADIUS for o in g)]
        merged = [point]
        for group in near:
            merged.extend(group)
            groups.remove(group)
        groups.append(merged)
    return groups


def choose() -> tuple[list[Seat], dict]:
    """The chosen seats in row order, and a tally of how the pool narrowed."""
    rows = _staged_rows()
    phoenix = {k: r for k, r in rows.items() if _query(r).get("f") == "phoenix"}
    candidates = {k: r for k, r in phoenix.items() if _on_the_plane(_query(r))}
    scores = _scores(candidates)

    by_point: dict[tuple, list[Seat]] = {}
    for key, row in candidates.items():
        q = _query(row)
        point = tuple(float(q[name]) for name in ("px", "py", "cx", "cy"))
        by_point.setdefault(point, []).append(Seat(row, point, scores[key]))
    points = [min(group, key=Seat.better) for group in by_point.values()]
    classic = (*CLASSIC["p"], *CLASSIC["c"])
    groups = _neighbourhoods(points)
    stands = [min(g, key=Seat.better) for g in groups if all(s.point != classic for s in g)]

    taken_p = [classic[:2]]
    chosen: list[Seat] = []
    while stands and len(chosen) < COUNT:
        pick = min(
            stands,
            key=lambda s: (-min(_p_distance(s.point, t) for t in taken_p), s.better()),
        )
        chosen.append(pick)
        taken_p.append(pick.point[:2])
        stands.remove(pick)
    chosen.sort(key=lambda s: (s.point[0], s.point[1]))
    tally = {
        "phoenix": len(phoenix),
        "on_plane": len(candidates),
        "points": len(by_point),
        "neighbourhoods": len(groups),
    }
    return chosen, tally


def _entry(seat: Seat) -> dict:
    row = seat.row
    p_re, p_im, c_re, c_im = seat.point
    return {
        "source": "seat",
        "p": [p_re, p_im],
        "c": [c_re, c_im],
        "key": row["key"],
        "mode": row["mode"],
        "palette": row["palette"],
        "p_ge4": seat.p_ge4,
        "collections": sorted(row["collections"]),
        "file": f"phoenix-points/{row['file']}",
        "link": row["link"],
        "gap": row["gap"],
    }


def write() -> list[str]:
    """Choose the points, write the record and land the thumbnails. Returns what it did."""
    chosen, tally = choose()
    record = {
        "schema": 1,
        "kind": "phoenix-points",
        "written_by": "python -m builder phoenix-points",
        "rule": (
            "The classic first, then the Phoenix seats of the staged gallery whose link starts "
            "at z_-1 = 0, one per exact (p, c), grouped into neighbourhoods by single linkage "
            f"at {RADIUS} in (Re p, Im p, Re c, Im c), each stood for by its seat whose link is "
            "its picture and then by highest p_ge4, and the rest taken farthest-first in p from "
            f"every p already taken, {COUNT} of them, shown by Re p. builder/phoenix_points.py "
            "says why."
        ),
        "wallpapers_commit": _header_commit(),
        "points": [{"source": "classic", **CLASSIC, "link": None}] + [_entry(s) for s in chosen],
    }
    PICTURES.mkdir(exist_ok=True)
    wanted = {s.row["file"] for s in chosen}
    for stale in PICTURES.iterdir():
        if stale.name not in wanted:
            stale.unlink()
    for name in sorted(wanted):
        shutil.copyfile(STAGED / name, PICTURES / name)
    RECORD.write_text(json.dumps(record, indent=1, ensure_ascii=False) + LF, newline=LF)

    lines = [
        f"{tally['phoenix']} Phoenix seats, {tally['on_plane']} start at z_-1 = 0, "
        f"{tally['points']} distinct (p, c), {tally['neighbourhoods']} neighbourhoods "
        f"at {RADIUS}",
        "  classic  p = -0.5  c = 0.5667",
    ]
    for s in chosen:
        p_re, p_im, c_re, c_im = s.point
        lines.append(
            f"  {s.row['key']}  p = {p_re:+.4f}{p_im:+.4f}i  c = {c_re:+.4f}{c_im:+.4f}i  "
            f"p_ge4 {s.p_ge4:.4f}  {s.row['mode']}  gap {'no' if s.row['gap'] is None else 'yes'}"
        )
    size = sum((PICTURES / name).stat().st_size for name in wanted)
    lines.append(
        f"wrote {RECORD.relative_to(SITE_ROOT).as_posix()} and {len(wanted)} pictures, "
        f"{size:,} bytes"
    )
    return lines


def _header_commit() -> str | None:
    with (STAGED / "gallery.jsonl").open(encoding="utf-8") as handle:
        return json.loads(handle.readline()).get("wallpapers_commit")
