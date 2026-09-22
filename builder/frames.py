"""Which places the site already uses, resolved to a key a gallery seat can be tested against.

A figure prompt that picks new wallpapers has one question to ask before it picks: *is this
location already on the site?* — because no location is reused unless the repetition is
intentional, and `check`'s `locations` is what refuses a collision after the fact. This
answers the question before the pick, over the registry as it stands.

`figures.Figure.frames` answers in two spellings at once: a prose-derived geometry key for
a panel whose provenance writes the numbers out, and a bare source key (`<stamp>|<recipe
key>`, `labels/<batch>.jsonl:<line>`, ...) for one addressed by the record instead. Both
name a place; neither is comparable to the other, and the prose half is not even
self-consistent across the registry.

So everything is reduced to `(centre, width)` at `%.12g`, which is the precision the prose
was already written at. Family and degree are carried for reporting and are deliberately
**not** part of the match: prose spells `multibrot` with no degree and `mandelbrot` with
`d2`, so requiring them to agree would drop real matches, while two different places
agreeing on centre and width to twelve significant figures is not a thing that happens.

**Two resolutions, and they answer differently.** `resolve(fuller=True)` resolves every
figure's keyed sources as well as its geometry; `resolve(fuller=False)` resolves a figure's
keys only where its provenance wrote no geometry at all, which is what the first carry
sheet did. The counts each produces are in `builder/README.md`, and the modes-page
exclusion uses the **fuller** one: a place the record names is a place a reader can land on
twice whether or not the prose repeated it.

Nothing here is wired into `check` — `locations` reads `Figure.frames` directly and is the
check that refuses a collision. This is the maker's side of the same question.
"""

from __future__ import annotations

import json
from pathlib import Path

from . import figures, renders

#: The page whose figures are being re-picked, and so the one page whose own places are not
#: an exclusion: a figure that is about to be replaced does not reserve its location.
MODES_PAGE = "rendering-modes.html"


def point(real, imaginary) -> str:
    """One complex number spelled the way `figures._point` spells it."""
    return f"{float(real) + 0.0:.12g}{float(imaginary) + 0.0:+.12g}i"


def place(centre_re, centre_im, width) -> tuple[str, str]:
    """THE match key: where the camera was, at the precision the prose was written at."""
    return (point(centre_re, centre_im), f"{float(width):.12g}")


def place_of_frame(frame: str) -> tuple[str, str] | None:
    """A geometry frame key from `Figure.frames`, reduced to its place.

    `None` for a key that is not geometry — a bare source key, which the callers below
    resolve through its own store instead.
    """
    _, mark, tail = frame.partition(" @ ")
    if not mark or " w " not in tail:
        return None
    centre, _, width = tail.partition(" w ")
    return (centre.strip(), width.strip())


def place_of_location_key(key: str) -> tuple[str, str]:
    """A serialized `supply.location.location_key` — what a record calls a place."""
    partition, degree, constants, centre_re, centre_im, width = json.loads(key)
    del partition, degree, constants
    return place(centre_re, centre_im, width)


def place_of_viewport(viewport: dict) -> tuple[str, str]:
    return place(viewport["center_re"], viewport["center_im"], viewport["width"])


def family_word(family: dict) -> str:
    """What the prose would call this family, for the report rather than the match."""
    kind = str(family.get("kind") or "?")
    degree = family.get("degree")
    if kind in ("julia", "multibrot") and degree:
        return f"{kind} d{degree}"
    return kind


# --------------------------------------------------------------------------- the stores


class Stores:
    """Every store a source key is addressed into, each read once and held."""

    def __init__(self):
        self._gallery: dict[str, dict] = {}
        self._release: dict[str, dict] | None = None
        self._lines: dict[Path, list[dict]] = {}
        self._walks: dict[str, dict] = {}
        self._candidates: dict[str, tuple[str, str] | None] = {}

    def gallery(self, stamp: str) -> dict:
        """One recorded gallery's seats, this site's own copy of them read in first.

        `article/figure-recipes.jsonl` carries the seat row of every pick a figure cites,
        which is what keeps this answerable now that six of the records those picks were
        made off have been removed next door. The record itself is still read for a stamp
        the store does not hold — a pick nobody has landed here yet.
        """
        if stamp not in self._gallery:
            from . import recipes

            held: dict[str, dict] = {
                one.key: one.seat
                for one in recipes.load_all().values()
                if one.stamp == stamp and one.seat
            }
            path = renders.artifact("curation", "tentative", stamp, "gallery.jsonl")
            if path.is_file():
                with path.open(encoding="utf-8") as handle:
                    for raw in handle:
                        if raw.strip():
                            row = json.loads(raw)
                            held.setdefault(str(row["key"]), row)
            self._gallery[stamp] = held
        return self._gallery[stamp]

    def release(self) -> dict:
        if self._release is None:
            held: dict[str, dict] = {}
            root = renders.data_file("data", "curation", "release")
            if root.is_dir():
                for path in sorted(root.glob("*/*.jsonl")):
                    with path.open(encoding="utf-8") as handle:
                        for raw in handle:
                            if raw.strip():
                                row = json.loads(raw)
                                held[str(row["key"])] = row
            self._release = held
        return self._release

    def lines(self, path: Path) -> list[dict]:
        if path not in self._lines:
            rows = []
            if path.is_file():
                with path.open(encoding="utf-8") as handle:
                    rows = [json.loads(raw) for raw in handle if raw.strip()]
            self._lines[path] = rows
        return self._lines[path]

    def walk(self, name: str) -> dict:
        """One walk ledger's nodes by id — the rows that carry a viewport."""
        if name not in self._walks:
            path = renders.artifact(name, "walk.jsonl")
            held: dict[int, dict] = {}
            if path.is_file():
                with path.open(encoding="utf-8") as handle:
                    for raw in handle:
                        if not raw.strip():
                            continue
                        row = json.loads(raw)
                        if row.get("viewport") and row.get("node_id") is not None:
                            held.setdefault(int(row["node_id"]), row)
            self._walks[name] = held
        return self._walks[name]

    def candidate(self, key: str) -> tuple[str, str] | None:
        """One recipe key against the ledger, streamed — never the pool held whole."""
        if key not in self._candidates:
            found = None
            path = renders.artifact("curation", "candidate_ledger", "rows.jsonl")
            if path.is_file():
                with path.open(encoding="utf-8") as handle:
                    for raw in handle:
                        if key not in raw:
                            continue
                        row = json.loads(raw)
                        if str(row.get("key")) == key:
                            found = place_of_location_key(row["location"]["key"])
                            break
            self._candidates[key] = found
        return self._candidates[key]


def place_of_key(stores: Stores, kind: str, key: str) -> tuple[str, str] | None:
    """One keyed source resolved to a place, or `None` where it does not name one."""
    if kind == figures.GALLERY_SEAT:
        stamp, _, recipe = key.partition("|")
        row = stores.gallery(stamp.strip()).get(recipe.strip())
        return place_of_location_key(row["location"]) if row else None
    if kind == figures.CANDIDATE:
        return stores.candidate(key.strip())
    if kind == figures.RUN_ROW:
        if "|release|" in key:
            row = stores.release().get(key)
            return place_of_location_key(row["location"]["key"]) if row else None
        head, _, address = key.partition("/")
        batch, _, line = address.rpartition(":")
        rows = stores.lines(renders.data_file("data", head, "rows", batch))
        if not line.isdigit() or not 1 <= int(line) <= len(rows):
            return None
        return place_of_viewport(rows[int(line) - 1]["viewport"])
    if kind == figures.LOCATION:
        if key.startswith("labels/"):
            batch, _, line = key[len("labels/") :].rpartition(":")
            rows = stores.lines(renders.data_file("data", "labels", "rows", batch))
            if not line.isdigit() or not 1 <= int(line) <= len(rows):
                return None
            return place_of_viewport(rows[int(line) - 1]["viewport"])
        ledger, _, node = key.partition("#")
        if not ledger.endswith("/walk.jsonl") or not node:
            # A whole walk ledger is a figure's *population*, not one place.
            return None
        row = stores.walk(ledger[: -len("/walk.jsonl")]).get(int(node))
        return place_of_viewport(row["viewport"]) if row else None
    return None


def keyed_sources(figure) -> set[tuple[str, str]]:
    """Every `(kind, key)` a figure addresses a record by."""
    return {
        (source.kind, key)
        for source in figure.sources
        if source.kind in figures.KEYED_KINDS
        for key in source.keys
    }


def places_of(figure, stores: Stores, *, fuller: bool) -> tuple[set, list[str]]:
    """One figure's places, and the keys that named none."""
    keyed = keyed_sources(figure)
    text = {key for _, key in keyed}
    unresolved: list[str] = []
    found: set = set()
    for frame in figure.frames:
        if frame in text:
            continue
        spot = place_of_frame(frame)
        if spot is None:
            unresolved.append(f"{figure.id}: geometry frame {frame!r} has no centre/width")
        else:
            found.add(spot)
    if keyed and (fuller or not found):
        for kind, key in sorted(keyed):
            spot = place_of_key(stores, kind, key)
            if spot is None:
                unresolved.append(f"{figure.id}: {kind} {key!r} names no single place")
            else:
                found.add(spot)
    return found, unresolved


def resolve(registry=None, *, fuller: bool = True) -> dict:
    """Every figure's places, split by whether the figure is on the modes page."""
    registry = registry if registry is not None else figures.load_all()
    stores = Stores()
    raw = 0
    unresolved: list[str] = []
    per_page: dict[str, set] = {}
    per_figure: dict[str, set] = {}
    for identifier, figure in sorted(registry.items()):
        raw += len(figure.frames)
        found, missed = places_of(figure, stores, fuller=fuller)
        unresolved += missed
        per_figure[identifier] = found
        per_page.setdefault(figure.page, set()).update(found)

    off: set = set()
    on: set = set()
    for page, spots in per_page.items():
        (on if page == MODES_PAGE else off).update(spots)
    return {
        "raw_frames": raw,
        "places": off | on,
        "off_modes_page": off,
        "modes_page_only": on - off,
        "unresolved": unresolved,
        "per_page": per_page,
        "per_figure": per_figure,
    }


def collisions(registry=None, *, fuller: bool = True) -> dict[tuple[str, str], list[str]]:
    """Every place two or more figures stand on, and which figures those are."""
    out = resolve(registry, fuller=fuller)
    held: dict[tuple[str, str], list[str]] = {}
    for identifier, spots in out["per_figure"].items():
        for spot in spots:
            held.setdefault(spot, []).append(identifier)
    return {spot: sorted(who) for spot, who in held.items() if len(who) > 1}


def main() -> int:
    """Both readings, and any place two figures already stand on."""
    for fuller in (True, False):
        out = resolve(fuller=fuller)
        print(
            f"{'fuller' if fuller else 'carry':7s} raw {out['raw_frames']:4d}  "
            f"places {len(out['places']):4d}  "
            f"off the modes page {len(out['off_modes_page']):4d}  "
            f"modes only {len(out['modes_page_only']):3d}  "
            f"unresolved {len(out['unresolved']):3d}"
        )
    for spot, who in sorted(collisions().items()):
        print(f"  collision {spot}: {', '.join(who)}")
    return 0
