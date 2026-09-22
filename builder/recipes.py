"""Every figure's render recipe, owned here rather than borrowed from next door.

## Why this file exists

A figure that stands on a wallpaper names it by `<stamp>|<recipe key>` — the recorded
tentative gallery it was picked off, and the row of the candidate ledger that says how the
picture was drawn. Both of those live in the wallpaper project's regenerable tree, and for
a year that was the whole address: `builder.picks` opened the gallery record for the seat
and streamed the ledger for the recipe, and a figure could be redrawn for as long as that
project kept them.

**On 2026-09-22 it stopped keeping them.** Closing mining removed every saved solve but the
twenty `final139_*` records, and 96 of this site's figure panels named a seat of one of six
records that no longer exist. Nothing on a page moved — the pictures are committed here —
but the *recipe* behind every one of them had gone, which is the exact failure the figure
registry was written to end: a picture nobody can redraw is a picture nobody can correct.

So the recipe is this repository's now. `article/figure-recipes.jsonl` holds one row per
`(stamp, key)` a figure cites, carrying the seat row, the ledger recipe and the ledger's
own account of which run drew the candidate. `builder.picks` reads it first and the stores
next door only for a key it does not hold, which is what lets a fresh pick off a live
record still work. **A stamp on a figure's registry row is provenance from here on** — it
says which gallery the pick was made off, and nothing has to still be there for the figure
to be drawn again.

## What is in a row, and where each half came from

* `seat` — the row of that stamp's `gallery.jsonl`: which seat, which partition, the alias
  Matt picked it by, the colour reading. Absent where no record of the stamp survives.
* `recipe` — the candidate ledger's own recipe block, whole: family, viewport, mode, map,
  palette, cap, regime.
* `source` — the ledger row's `picture` and its `provenance`, which is how the autolevel
  curve is reached. That third read is still next door and is not copied here: a run's
  record is not a solve and was not deleted.
* `read` — where the two halves were recovered from, in a clause, because two of these
  rows have a recipe and no seat at all and the record should say so rather than look
  complete.

## Filling it

`python -m builder recipes --fill` lands a row for every `(stamp, key)` the figure registry
cites that this store does not already hold, reading the stores next door. **It never
rewrites a row that is here**, the same rule `explorer --names` keeps for a hand-authored
display name: the rows recovered from a deleted record are the only copy there is, and a
fill run that re-derived them would answer *not found* and take them out.

Three of the 96 came out of a stamp that was never tracked next door, so their seat row is
gone for good; they carry the recipe, the run that drew them, and a `read` saying so.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

from . import records
from .paths import ARTICLE_DIR

RECIPES = ARTICLE_DIR / "figure-recipes.jsonl"

#: What a row's `kind` may say: a seat of a recorded tentative gallery, or a bare row of
#: the candidate ledger that was never seated.
SEAT, CANDIDATE = "seat", "candidate"

#: What a candidate row writes where a seat row writes its stamp. The same word
#: `picks.CANDIDATE_STAMP` spells, and spelled out rather than left empty so a provenance
#: line built off one cannot read as a seat whose stamp somebody forgot.
CANDIDATE_STAMP = "candidate"

#: What separates a stamp from a recipe key in a pick, and so in this store's own address.
SEPARATOR = "|"


class RecipeError(RuntimeError):
    """The recipe store said something this builder will not guess at."""


@dataclass(frozen=True)
class Held:
    """One `(stamp, key)`: everything a panel is drawn from, without the stores next door."""

    stamp: str
    key: str
    kind: str
    recipe: dict
    source: dict
    seat: dict
    read: str

    @property
    def identifier(self) -> str:
        return f"{self.stamp}{SEPARATOR}{self.key}"


def load_all(path: Path | None = None) -> dict[str, Held]:
    """Every row of the store, by the `<stamp>|<key>` a figure addresses it with."""
    path = path or RECIPES
    if not path.is_file():
        return {}
    held: dict[str, Held] = {}
    for row in records.read(path):
        kind = row.kind
        if kind not in (SEAT, CANDIDATE):
            raise RecipeError(f"{row.where}: {kind!r} is not a kind this store carries")
        recipe = row.optional_mapping("recipe")
        if recipe is None:
            raise RecipeError(f"{row.where}: a row with no recipe is not a recipe")
        one = Held(
            stamp=row.text("stamp"),
            key=row.text("key"),
            kind=kind,
            recipe=recipe,
            source=row.fields.get("source") or {},
            seat=row.fields.get("seat") or {},
            read=row.text("read"),
        )
        if one.identifier in held:
            raise RecipeError(f"{row.where}: {one.identifier} is in this store twice")
        held[one.identifier] = one
    return held


def write_all(held: dict[str, Held], path: Path | None = None) -> None:
    """The store, in the order a figure registry first asks for each row."""
    path = path or RECIPES
    body = "".join(json.dumps(_row(one), ensure_ascii=False) + "\n" for one in held.values())
    path.write_text(body, encoding="utf-8", newline="\n")


def _row(one: Held) -> dict:
    row = {
        "schema": records.SCHEMA,
        "kind": one.kind,
        "stamp": one.stamp,
        "key": one.key,
        "read": one.read,
        "recipe": one.recipe,
        "source": one.source,
    }
    if one.seat:
        row["seat"] = one.seat
    return row


def cited(registry: dict | None = None) -> list[str]:
    """Every `<stamp>|<key>` the figure registry names, in the order it names them.

    A `candidate` source is a bare ledger key and is addressed here under the word
    `candidate`, so that one store answers both kinds and a caller never has to know which
    of the two a figure used.
    """
    from . import figures

    registry = registry if registry is not None else figures.load_all()
    wanted: list[str] = []
    for figure in registry.values():
        for source in figure.sources:
            for key in source.keys:
                if source.kind == figures.GALLERY_SEAT:
                    identifier = str(key)
                elif source.kind == figures.CANDIDATE:
                    identifier = f"{CANDIDATE_STAMP}{SEPARATOR}{key}"
                else:
                    continue
                if identifier not in wanted:
                    wanted.append(identifier)
    return wanted


def fill() -> list[str]:
    """Land a row for every cited pick this store does not hold; never rewrite one.

    The stores next door answer for a pick whose record is still there. A pick whose
    record has been removed is already in this file or is gone, and this refuses to
    silently drop it — which is why the run reports what it could not reach rather than
    writing a shorter store.
    """
    from . import picks

    held = load_all()
    wanted = cited()
    missing = [identifier for identifier in wanted if identifier not in held]
    lines = [f"{RECIPES.name}: {len(held)} rows held, {len(wanted)} cited, {len(missing)} missing"]
    if not missing:
        return lines

    seats = [one for one in missing if not one.startswith(f"{CANDIDATE_STAMP}{SEPARATOR}")]
    bare = [one.partition(SEPARATOR)[2] for one in missing if one not in seats]
    landed = 0
    refused: list[str] = []
    for identifier in seats:
        try:
            (pick,) = picks.resolve([identifier])
        except picks.PickError as error:
            refused.append(f"{identifier}: {error}")
            continue
        held[identifier] = _from_pick(pick, SEAT, "the record and the candidate ledger next door")
        landed += 1
    if bare:
        try:
            for pick in picks.candidates(bare):
                held[pick.identifier] = _from_pick(
                    pick, CANDIDATE, "the candidate ledger next door"
                )
                landed += 1
        except picks.PickError as error:
            refused.append(f"{', '.join(bare)}: {error}")

    if landed:
        ordered = {one: held[one] for one in wanted if one in held}
        ordered.update({one: row for one, row in held.items() if one not in ordered})
        write_all(ordered)
    lines.append(f"  landed {landed}")
    lines.extend(f"  refused {one}" for one in refused)
    return lines


def _from_pick(pick, kind: str, read: str) -> Held:
    return Held(
        stamp=pick.stamp,
        key=pick.key,
        kind=kind,
        recipe=pick.recipe,
        source=pick.source,
        seat=dict(pick.seat or {}),
        read=read,
    )


def problems() -> list[str]:
    """Every cited pick this store does not hold, for `check`'s `figures`."""
    held = load_all()
    return [
        f"figure-recipes.jsonl: no row for {identifier}, which a figure cites — "
        "`python -m builder recipes --fill`"
        for identifier in cited()
        if identifier not in held
    ]


def summary() -> list[str]:
    """What the store holds, for the bare command."""
    held = load_all()
    seated = sum(1 for one in held.values() if one.kind == SEAT)
    unseated = sum(1 for one in held.values() if one.kind == SEAT and not one.seat)
    stamps = sorted({one.stamp for one in held.values() if one.kind == SEAT})
    lines = [
        f"{RECIPES.name}: {len(held)} rows — {seated} seats over {len(stamps)} recorded "
        f"galleries, {len(held) - seated} bare candidates",
    ]
    if unseated:
        lines.append(f"  {unseated} carry a recipe and no seat row: the record was never tracked")
    for stamp in stamps:
        count = sum(1 for one in held.values() if one.stamp == stamp)
        lines.append(f"  {stamp}: {count}")
    return lines
