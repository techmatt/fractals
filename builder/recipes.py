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
* `tone` — on one kind of row only: a seat the autolevel operator acted on whose run kept
  the fact and not the curve. Where Matt wants such a panel drawn and linked anyway
  *(escape_families_ckpt148, 2026-09-25)*, the curve is measured again on this side, off
  the recipe drawn at the seat's own regime through the unlevelled map, and written here
  with the day it was measured. It is a second reading of the operator rather than the
  run's, and `picks.run_stamp` answers from it only where the run's own record cannot.

## Filling it

`python -m builder recipes --fill` lands a row for every `(stamp, key)` the figure registry
cites that this store does not already hold, reading the stores next door. **It never
rewrites a row that is here**, the same rule `explorer --names` keeps for a hand-authored
display name: the rows recovered from a deleted record are the only copy there is, and a
fill run that re-derived them would answer *not found* and take them out.

Three of the 96 came out of a stamp that was never tracked next door, so their seat row is
gone for good; they carry the recipe, the run that drew them, and a `read` saying so.

## Deep panels

A third kind, `deep` *(deep_figures_ckpt145)*: one row per panel of a *Deep zoom* figure,
keyed `<figure id>#<panel>` under the stamp `deep`, whose recipe is the canonical Deep-tab
link the panel was drawn from, the grid and the supersample. Nothing next door stands behind
one — the link is the whole of it — so these rows are written by `builder.deep_figures`
when it lands a figure, rewritten when it redraws one, and never touched by `--fill`.

## The site's icon

A fourth, `icon` *(favicon_wire_ckpt145)*: one row, stamp `icon`, key `site`, holding the
seat the icon is cropped from, the crop link and the crop's width, and the master it is
drawn at. It is not a figure and no figure cites it, so `--fill` never touches it either;
`builder.icons` writes it and draws the icon set from it.

## Recolored panels

A fifth, `recolor` *(gallery_curation_edits_ckpt149)*: one row per panel of a picks figure
that keeps a seat's place, view and mode and swaps its map, keyed `<figure id>#<panel>`
under the stamp `recolor`. The recipe is the seat's ledger recipe whole with the map
replaced and the autolevel stamp dropped — the operator never ran on the new map — and
`source` names the seat it was taken from, the map it replaced, and how the new one was
drawn. It is the only copy of that choice, so the maker reads it and `--fill` never touches
it; the row is written once, by hand, when the choice is made.
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
SEAT, CANDIDATE, DEEP, ICON, RECOLOR = "seat", "candidate", "deep", "icon", "recolor"

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
    #: A tone curve this site measured, for a seat whose run kept none. See the module
    #: docstring's `tone`; `None` on every row the run's own record answers for.
    tone: dict | None = None

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
        if kind not in (SEAT, CANDIDATE, DEEP, ICON, RECOLOR):
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
            tone=row.fields.get("tone"),
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
    if one.tone:
        row["tone"] = one.tone
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
        for panel in figure.panels:
            if panel.deep and panel.deep not in wanted:
                wanted.append(panel.deep)
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
    # A deep panel's row is its maker's to write; nothing next door can answer for one.
    missing = [
        identifier
        for identifier in wanted
        if identifier not in held and not identifier.startswith(f"{DEEP}{SEPARATOR}")
    ]
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
        + (
            "`python -m builder deep <figure> --replace`"
            if identifier.startswith(f"{DEEP}{SEPARATOR}")
            else "`python -m builder recipes --fill`"
        )
        for identifier in cited()
        if identifier not in held
    ]


def summary() -> list[str]:
    """What the store holds, for the bare command."""
    held = load_all()
    seated = sum(1 for one in held.values() if one.kind == SEAT)
    deep = sum(1 for one in held.values() if one.kind == DEEP)
    icons = sum(1 for one in held.values() if one.kind == ICON)
    recolored = sum(1 for one in held.values() if one.kind == RECOLOR)
    unseated = sum(1 for one in held.values() if one.kind == SEAT and not one.seat)
    stamps = sorted({one.stamp for one in held.values() if one.kind == SEAT})
    bare = len(held) - seated - deep - icons - recolored
    lines = [
        f"{RECIPES.name}: {len(held)} rows — {seated} seats over {len(stamps)} recorded "
        f"galleries, {bare} bare candidates, {deep} deep panels, {recolored} recolored "
        f"panels, {icons} icon",
    ]
    if unseated:
        lines.append(f"  {unseated} carry a recipe and no seat row: the record was never tracked")
    for stamp in stamps:
        count = sum(1 for one in held.values() if one.stamp == stamp)
        lines.append(f"  {stamp}: {count}")
    return lines


def keep_deep(rows: dict[str, dict]) -> None:
    """Land or rewrite the deep rows one figure's panels stand on, keyed as the panels are.

    Every other row keeps its place; a figure's deep rows are replaced whole, so a redraw
    with fewer panels leaves none behind.
    """
    held = load_all()
    figures_touched = {key.partition(SEPARATOR)[2].partition("#")[0] for key in rows}
    kept = {
        identifier: one
        for identifier, one in held.items()
        if not (one.kind == DEEP and one.key.partition("#")[0] in figures_touched)
    }
    for identifier, recipe in rows.items():
        stamp, _, key = identifier.partition(SEPARATOR)
        kept[identifier] = Held(
            stamp=stamp,
            key=key,
            kind=DEEP,
            recipe=recipe,
            source={},
            seat={},
            read="drawn here by builder.deep_figures: the link is the whole recipe",
        )
    write_all(kept)


def recolors(figure_id: str) -> dict[int, Held]:
    """One figure's recolored panels, by the 1-based panel each row is keyed to."""
    found = {}
    for one in load_all().values():
        if one.kind != RECOLOR:
            continue
        figure, _, panel = one.key.partition("#")
        if figure == figure_id:
            if not panel.isdigit():
                raise RecipeError(f"{one.identifier}: a recolor row is keyed <figure id>#<panel>")
            found[int(panel)] = one
    return found


def keep_icon(row: dict) -> None:
    """Land or rewrite the icon's row, which is the whole of its recipe; every other row
    keeps its place."""
    held = load_all()
    one = Held(
        stamp=row["stamp"],
        key=row["key"],
        kind=ICON,
        recipe=row["recipe"],
        source=row.get("source") or {},
        seat={},
        read=row["read"],
    )
    held[one.identifier] = one
    write_all(held)
