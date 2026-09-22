"""The figures of *Gallery curation*.

The ninth section's subject is one pass over the whole pool that chooses the whole set at
once, so its figures are readings of **that pass's own record** rather than pictures of a
place. Three of them are charts and one is a pair of pictures with a number between them;
the fifth, the grid of what a pass ships, is a sheet of seats and lives in `picks.py` with
the other figures whose panels are named by tentative-gallery ID.

## The two records, and why both are named

A curation solve writes itself down twice, and the halves are not interchangeable.

- **The tentative gallery** — `artifacts/curation/tentative/<stamp>/`, a `gallery.jsonl`
  of seats and a `manifest.json` beside it. It is **stamped and immutable**: a second
  solve writes a second stamp and never touches the first. It carries the seating and its
  tallies, and it is what a figure of `picks.py` addresses a panel through.
- **The solve record** — `artifacts/curation/solve/<name>/solve.json`. It carries what
  the tallies cannot: the pool's own narrowing, the preselection, the diversity rule's
  refusals with their distances. It is **rolling**: the name is a leg's name and a rerun
  overwrites it, which is exactly what happened to the pass before this one.

So every reader here opens the manifest first and the solve record second, and
`_agreeing` **refuses where the two do not name the same solve** — the manifest says when
its solve was taken and the record says when it was taken, and a record that answers for
a different pass is a chart captioned as this gallery and drawn from another one. That is
the same rule the rest of this repository keeps under a different name: a figure
addresses a record by its own identity and never by where it happens to sit.

## Which pass, and why not the one the roster draws from

Two tentative galleries were recorded on 2026-09-02, over a pool with the same stamp —
the same 153,039 candidates, chosen twice. `overview-gallery-hook` and `modes-gallery`
stand on the earlier of them; **this page stands on the later, `20260902T164622Z`**, for
two reasons that pull the same way. The earlier pass's solve record has been overwritten
by the later one, so the pool's narrowing and the twin refusals are not recoverable for
it at all; and the later pass fills 912 of its 1,000 seats against 746 and meets every
mode floor, which is what the page's own sentences are about. Nothing the earlier figures
claim moves: the pool is the same pool, and a seat of one pass is a seat.

## What is drawn and what is read

Nothing here reaches the engine except `gallery-twins`, which draws four pictures the way
`picks.py` draws a panel — at the seat's own recipe, through the autolevel curve the run
stamped. The charts are composed from numbers and reach no renderer at all.
"""

from __future__ import annotations

import json
import math
from dataclasses import dataclass
from pathlib import Path

from . import figures as figures_module
from . import picks, records, renders, sheets
from .locations import SHEET_WIDTH, Drawn, sheet_path
from .theme import (
    SECTION_INK,
    WELL,
    WELL_INK,
    WELL_INK_DIM,
    WELL_PANEL,
    WELL_RULE,
    font,
    text_width,
)

#: The recorded tentative gallery every figure of this page reads. Pinned, the way
#: `builder.pipeline`'s run is pinned: a page captioned *one pass* that quietly redrew
#: itself off whichever pass was newest would be a different measurement under the same
#: words.
#:
#: ⚠ **The five charts on the page were drawn off `20260902T164622Z`, and that record is
#: gone** *(atlas_refresh_ckpt139, 2026-09-22)*. Closing mining next door removed every
#: saved solve but the twenty `final139_*`, so this points at `final139_general`, which is
#: the semi-final general gallery and a different pass over a pool that has grown since.
#: The pictures on `gallery-curation.html` and the prose around them still describe the
#: 2026-09-02 pass — a redraw from here answers different numbers, and the page's sentences
#: are what has to move with it. That is a publishing-time act and was deliberately not
#: taken here: the prompt re-based the data and left the prose alone. The figures' own
#: registry rows still cite the old stamp, which is the provenance and is correct.
STAMP = "20260922T012627Z"

#: The solve leg whose record answers for that stamp. Held to it by `_agreeing` rather
#: than trusted, because this file is rolling and the stamp's directory is not.
SOLVE = "final139_general"

#: Where the solve record's own numbers are addressed from, under the artifacts tree.
SOLVE_RECORD = ("curation", "solve")

LF = "\n"


class CurationError(RuntimeError):
    """A figure of this page that cannot be drawn from the records it names."""


# ------------------------------------------------------------------------- the records


@dataclass(frozen=True)
class Pass:
    """One curation pass, read off both halves of its record."""

    stamp: str
    manifest: dict
    solve: dict

    @property
    def asked(self) -> int:
        return int(self.manifest["seats"]["asked"])

    @property
    def filled(self) -> int:
        return int(self.manifest["seats"]["filled"])

    @property
    def unfilled(self) -> int:
        return self.asked - self.filled

    @property
    def population(self) -> dict:
        return self.solve["population"]

    @property
    def preselection(self) -> dict:
        return self.solve["preselection"]

    @property
    def taken_at(self) -> str:
        return str(self.manifest["taken_at"])

    @property
    def commit(self) -> str:
        return str(self.manifest.get("source_commit") or "")[:12]

    @property
    def allowance(self) -> int:
        """`floor(k · t · n) + 1`, the rule's own arithmetic, re-derived here.

        The share is uniform over the forty-eight cells, so one number is every cell's
        ceiling and the chart draws one line rather than forty-eight.
        """
        rules = self.solve["rules"]
        return int(math.floor(rules["k"] * rules["cell_share"] * self.asked)) + 1


def manifest_path(stamp: str = STAMP) -> Path:
    return renders.artifact(*picks.TENTATIVE, stamp, "manifest.json")


def solve_path(name: str = SOLVE) -> Path:
    return renders.artifact(*SOLVE_RECORD, name, "solve.json")


def read(stamp: str = STAMP) -> Pass:
    """Both halves of one pass's record, held to being halves of the same pass."""
    manifest, solve = manifest_path(stamp), solve_path()
    if not manifest.is_file():
        raise CurationError(
            f"no tentative gallery recorded under {stamp} — {manifest} is not there. "
            f"Recorded here: {', '.join(picks.stamps()) or 'none'}"
        )
    if not solve.is_file():
        raise CurationError(f"no solve record at {solve}, so nothing says how {stamp} narrowed")
    read_manifest = json.loads(manifest.read_text(encoding="utf-8"))
    read_solve = json.loads(solve.read_text(encoding="utf-8"))
    _agreeing(stamp, read_manifest, read_solve)
    return Pass(stamp=stamp, manifest=read_manifest, solve=read_solve)


def _agreeing(stamp: str, manifest: dict, solve: dict) -> None:
    """The two halves name the same solve, or nothing is drawn.

    The solve record is written under its leg's name and a rerun overwrites it, so the
    file beside a stamp's manifest is only that stamp's record until the next pass runs.
    Both halves stamp themselves with when the solve was taken, and that is the tie.
    """
    wanted = str((manifest.get("solve") or {}).get("taken_at") or "")
    found = str(solve.get("taken_at") or "")
    if not wanted or not found:
        raise CurationError(
            f"{stamp}: one half of the record does not say when its solve was taken, so "
            "nothing holds the solve record to this gallery"
        )
    if wanted != found:
        raise CurationError(
            f"{stamp} was solved at {wanted} and {solve_path().name} was written at {found}. "
            "The solve record is rolling — a later pass under the same leg name has "
            "overwritten it — so the pool's narrowing and the twin refusals of this "
            "gallery are no longer on this machine. Re-pin the page to a stamp whose "
            "record survives, or run the leg again."
        )
    asked = int((manifest.get("seats") or {}).get("asked") or 0)
    if asked != int(solve.get("filled", 0)) + int(solve.get("unfilled", 0)):
        raise CurationError(
            f"{stamp}: the manifest asks for {asked} seats and the solve record accounts "
            f"for {solve.get('filled')} filled and {solve.get('unfilled')} unfilled"
        )


# ---------------------------------------------------------------------------- the sheet

PLOT_LEFT = 74
PLOT_RIGHT = SHEET_WIDTH - sheets.PAD - 14
BAR_INK = sheets.mix(WELL, SECTION_INK, 0.72)


def _title(draw, title: str, under: str) -> int:
    """The two lines every sheet of this page opens with, and where the plot may start."""
    draw.text((sheets.PAD, sheets.PAD), title, fill=WELL_INK, font=font(19))
    draw.text((sheets.PAD, sheets.PAD + 28), under, fill=WELL_INK_DIM, font=font(15))
    return sheets.PAD + 68


def _stamped(draw, pass_: Pass, y: int) -> None:
    """Which pass this is, in the quietest ink there is, at the foot of every sheet."""
    text = f"{pass_.stamp} · n = {pass_.asked:,} · wallpapers {pass_.commit}"
    face = font(13)
    draw.text(
        (PLOT_RIGHT - text_width(draw, text, face), y),
        text,
        fill=sheets.mix(WELL, SECTION_INK, 0.62),
        font=face,
    )


def _foot(draw, lines: list[str], x: int, y: int, size: int = 15) -> int:
    face = font(size)
    for index, line in enumerate(lines):
        draw.text((x, y + index * 22), line, fill=SECTION_INK, font=face)
    return y + len(lines) * 22


# ------------------------------------------------------------------ what is chosen from

#: The funnel's three steps: the label a reader reads, and where the count comes from.
POOL_STEPS = (
    ("every candidate a mine has made", "candidates", "locations"),
    ("above its own mode's bar", "clearing", "clearing_locations"),
    (
        "after near-identical places collapse",
        "after_the_preselection",
        "locations_after_the_preselection",
    ),
)

POOL_BAR = 40
POOL_PITCH = 88
POOL_LABEL = 330


def gallery_pool() -> Drawn:
    """`gallery-pool` — the three counts curation narrows through, as a funnel."""
    pass_ = read()
    counts = pass_.population
    widest = max(counts[key] for _, key, _ in POOL_STEPS)
    left = sheets.PAD + POOL_LABEL
    room = PLOT_RIGHT - left - 156

    height = sheets.PAD * 2 + 68 + len(POOL_STEPS) * POOL_PITCH + 92
    sheet, draw = sheets.canvas(SHEET_WIDTH, height)
    top = _title(
        draw,
        "What curation is choosing from",
        "the pool narrows twice before a seat is filled, and only the last of the three "
        "is what a gallery is seated out of",
    )

    face, small = font(16), font(14)
    for index, (words, key, places) in enumerate(POOL_STEPS):
        y = top + index * POOL_PITCH
        draw.text((sheets.PAD, y + 12), words, fill=WELL_INK, font=face)
        width = max(3.0, counts[key] / widest * room)
        draw.rectangle([left, y, left + width, y + POOL_BAR], fill=BAR_INK, outline=SECTION_INK)
        draw.text((left + width + 14, y + 2), f"{counts[key]:,}", fill=WELL_INK, font=font(20))
        draw.text(
            (left + width + 14, y + 26),
            f"{counts[places]:,} places",
            fill=SECTION_INK,
            font=small,
        )

    refused = pass_.preselection
    y = _foot(
        draw,
        [
            "the first cut is the render judge's: a candidate is eligible at even odds or "
            "better of being rated good, measured at its own mode's threshold",
            f"the second collapses places a vision network reads as one place — "
            f"{refused['places_refused']:,} of {refused['places_asked']:,}, one place in "
            f"{round(1 / refused['share_of_places_refused'])}, inside a cosine distance "
            f"of {refused['radius']}",
        ],
        sheets.PAD,
        top + len(POOL_STEPS) * POOL_PITCH + 4,
    )
    _stamped(draw, pass_, y + 6)
    return Drawn(sheets.save(sheet, sheet_path("gallery-pool")), pool_provenance(pass_))


def pool_provenance(pass_: Pass) -> list[str]:
    counts = pass_.population
    refused = pass_.preselection
    return [
        "Drawn, not rendered: a chart composed by builder.curation:gallery_pool from the "
        f"records of one curation pass — artifacts/curation/tentative/{pass_.stamp}/"
        "manifest.json for the pass, and artifacts/curation/solve/"
        f"{SOLVE}/solve.json for the narrowing. Nothing is rendered and no engine is "
        "reached.",
        _pass_line(pass_),
        "The three bars, in order: "
        + ", ".join(
            f"{words} {counts[key]:,} candidates over {counts[places]:,} places"
            for words, key, places in POOL_STEPS
        )
        + ". The bars are linear in the candidate count and the places are printed beside "
        "them rather than drawn.",
        "The first bar is every candidate of an accepted mode that any mine has written "
        f"into the candidate ledger; the ledger held {pass_.manifest['pool']['ledger_rows']:,} "
        "rows at this pass and "
        f"{pass_.manifest['pool']['refused']['niche_mode']:,} of them were candidates of "
        "modes no gallery ships, which are refused before anything else is asked. The "
        "second is the render judge's bar, per mode. The third is the geometric "
        "preselection: "
        f"{refused['places_refused']:,} of {refused['places_asked']:,} places refused "
        f"inside a cosine distance of {refused['radius']} in the frozen DINOv2 descriptor "
        f"of each place's neutral render, taking {refused['candidates_refused']:,} "
        "candidates with them.",
        f"The solve then drew a stratified view of {counts['in_the_view']:,} of those "
        "candidates to choose over, which is a sampling of the third bar and not a fourth "
        "narrowing; it is not drawn here.",
    ]


def _pass_line(pass_: Pass) -> str:
    """Which pass a figure of this page stands on — the same sentence on every row."""
    seats = pass_.manifest["seats"]
    return (
        f"The pass: tentative gallery {pass_.stamp}, solve leg {SOLVE}, taken at "
        f"{pass_.taken_at} against wallpapers commit {pass_.commit}. It asked for "
        f"{seats['asked']:,} seats and filled {seats['filled']:,}. The pool it chose over "
        f"carries stamp {pass_.manifest['pool']['stamp'][:16]}, which is the same pool the "
        "earlier pass of that day was chosen over."
    )


# ---------------------------------------------------------- how much one color may take

#: How many cells a hue family carries — dark and light against muted and vivid. The
#: codebook's order is family-major, so a family is this many consecutive columns and
#: nothing here has to know their names.
FAMILY_CELLS = 4

ALLOWANCE_TOP = 300
ALLOWANCE_BASE = 56


def family_of(cell: str) -> str:
    """A cell's hue family, which is the last word of its own name."""
    return cell.rsplit("_", 1)[-1]


def gallery_allowance() -> Drawn:
    """`gallery-allowance` — the gallery's seats by color, against the ceiling each has."""
    pass_ = read()
    counts = pass_.manifest["shortfalls"]["cells"]["counts"]
    ink = renders.swatch_colours()
    order = list(ink)
    allowance = pass_.allowance
    ceiling = allowance + 8

    sheet, draw = sheets.canvas(SHEET_WIDTH, 536)
    top = _title(
        draw,
        "How much of one gallery a single color took",
        "one column a color, against the ceiling every color is given — an allowance is "
        "never a quota, and nothing is obliged to reach it",
    )
    base = top + ALLOWANCE_TOP
    step = (PLOT_RIGHT - PLOT_LEFT) / len(order)
    width = step - 7

    for value in range(0, ceiling + 1, 10):
        y = base - value / ceiling * ALLOWANCE_TOP
        draw.line([PLOT_LEFT, y, PLOT_RIGHT, y], fill=WELL_RULE, width=1)
        text = f"{value:d}"
        draw.text(
            (PLOT_LEFT - 10 - text_width(draw, text, font(14)), y - 8),
            text,
            fill=SECTION_INK,
            font=font(14),
        )

    for index, cell in enumerate(order):
        held = int(counts.get(cell, 0))
        x = PLOT_LEFT + index * step
        colour = ink.get(cell, WELL_INK_DIM)
        height = held / ceiling * ALLOWANCE_TOP
        draw.rectangle(
            [x, base - height, x + width, base],
            fill=sheets.mix(WELL, colour, 0.86),
            outline=colour,
        )

    line = base - allowance / ceiling * ALLOWANCE_TOP
    draw.line([PLOT_LEFT - 6, line, PLOT_RIGHT + 6, line], fill=WELL_INK, width=2)
    draw.text((PLOT_LEFT, line - 24), f"allowance {allowance}", fill=WELL_INK, font=font(15))

    face = font(15)
    for index in range(0, len(order), FAMILY_CELLS):
        x = PLOT_LEFT + index * step
        room = step * FAMILY_CELLS
        sheets.centred(draw, x, base + 10, room, family_of(order[index]), face, WELL_INK_DIM)
        if index:
            draw.line([x - 3, base + 4, x - 3, base + 34], fill=WELL_RULE, width=1)
    draw.text(
        (PLOT_LEFT, base + 38),
        "four cells to a family, dark and light, muted and vivid",
        fill=sheets.mix(WELL, SECTION_INK, 0.7),
        font=font(13),
    )

    at = sum(1 for cell in order if int(counts.get(cell, 0)) >= allowance)
    y = _foot(
        draw,
        [
            f"{at} of the {len(order)} colors reached their allowance and none passed it; a "
            f"picture may be dominant in more than one color, so the columns sum past the "
            f"{pass_.filled:,} seats",
            "a color well short of the line is one the pool cannot supply, not one the "
            "rules held back",
        ],
        sheets.PAD,
        base + ALLOWANCE_BASE + 6,
    )
    _stamped(draw, pass_, y + 6)
    return Drawn(sheets.save(sheet, sheet_path("gallery-allowance")), allowance_provenance(pass_))


def allowance_provenance(pass_: Pass) -> list[str]:
    counts = pass_.manifest["shortfalls"]["cells"]["counts"]
    order = list(renders.swatch_colours())
    rules = pass_.solve["rules"]
    at = [cell for cell in order if int(counts.get(cell, 0)) >= pass_.allowance]
    return [
        "Drawn, not rendered: a chart composed by builder.curation:gallery_allowance from "
        f"artifacts/curation/tentative/{pass_.stamp}/manifest.json — its "
        "`shortfalls.cells.counts`, which is the seated gallery tallied over every color "
        "each picture is dominant in. Nothing is rendered and no engine is reached.",
        _pass_line(pass_),
        f"The allowance is the rule's own arithmetic re-derived here: {rules['allowance']} "
        f"with k = {rules['k']} and t = 1/{round(1 / rules['cell_share'])}, which is "
        f"{pass_.allowance} out of {pass_.asked:,} seats and the same for every cell "
        "because the share is uniform. The record's own `over_allowance` is empty, so "
        "nothing passed it.",
        "Columns in the codebook's own order — twelve hue families, four cells each, dark "
        "and light against muted and vivid — and each drawn in that cell's own sRGB off "
        "fractal_wallpapers.palettes.codebook.swatches(). The four neutrals carry no "
        "allowance and are not columns here.",
        f"At the allowance: {', '.join(at)} — {len(at)} of {len(order)}. The counts, "
        "highest first: "
        + ", ".join(
            f"{cell} {counts[cell]}"
            for cell in sorted(counts, key=lambda name: (-counts[name], name))
        )
        + ".",
    ]


# ------------------------------------------------------------- what a mode was asked for

FLOOR_TOP = 300
FLOOR_PITCH_ROOM = 82


def gallery_floors() -> Drawn:
    """`gallery-floors` — every mode's floor against the seats it actually took."""
    pass_ = read()
    floors = pass_.manifest["shortfalls"]["modes"]["floors"]
    seated = pass_.manifest["counts"]["mode"]
    order = sorted(seated, key=lambda name: (-int(seated[name]), name))
    ceiling = _round_up(max(int(value) for value in seated.values()))

    sheet, draw = sheets.canvas(SHEET_WIDTH, 536)
    top = _title(
        draw,
        "What each mode was asked for, and what it took",
        "a floor is a presence a mode is guaranteed if the pool can supply it — never a "
        "ceiling, and never a share",
    )
    base = top + FLOOR_TOP
    step = (PLOT_RIGHT - PLOT_LEFT) / len(order)
    width = step - 26

    for value in range(0, ceiling + 1, 50):
        y = base - value / ceiling * FLOOR_TOP
        draw.line([PLOT_LEFT, y, PLOT_RIGHT, y], fill=WELL_RULE, width=1)
        text = f"{value:d}"
        draw.text(
            (PLOT_LEFT - 10 - text_width(draw, text, font(14)), y - 8),
            text,
            fill=SECTION_INK,
            font=font(14),
        )
    draw.text((PLOT_LEFT, top - 24), "seats", fill=WELL_INK_DIM, font=font(15))

    small = font(13)
    for index, mode in enumerate(order):
        took, floor = int(seated[mode]), int(floors.get(mode, 0))
        x = PLOT_LEFT + index * step + 13
        height = took / ceiling * FLOOR_TOP
        draw.rectangle([x, base - height, x + width, base], fill=WELL_PANEL, outline=SECTION_INK)
        if floor:
            y = base - floor / ceiling * FLOOR_TOP
            draw.rectangle([x, y, x + width, base], fill=BAR_INK, outline=SECTION_INK)
            draw.line([x - 5, y, x + width + 5, y], fill=WELL_INK, width=2)
        draw.text(
            (x + width / 2 - text_width(draw, f"{took}", small) / 2, base - height - 19),
            f"{took}",
            fill=WELL_INK,
            font=small,
        )
        lines = _wrapped(draw, mode.replace("_", " "), small, step - 6)
        for line, words in enumerate(lines):
            sheets.centred(draw, x - 13, base + 10 + line * 17, step, words, small, WELL_INK_DIM)
        sheets.centred(
            draw,
            x - 13,
            base + 10 + len(lines) * 17,
            step,
            f"floor {floor}" if floor else "no floor",
            small,
            SECTION_INK,
        )

    refusals = pass_.manifest["shortfalls"]["refusals_while_choosing"]
    ranked = sorted(refusals.items(), key=lambda item: -item[1])
    y = _foot(
        draw,
        [
            f"every floor was met: {pass_.manifest['shortfalls']['demands']['short_total']} "
            f"seats short across all {len(order)} modes, and the shaded part of a bar is "
            "the floor inside what the mode took",
            f"what went unfilled was seats — {pass_.unfilled} of {pass_.asked:,} — and what "
            "refused the candidates offered for them was "
            + ", ".join(f"{name.replace('_', ' ')} {count:,}" for name, count in ranked if count),
        ],
        sheets.PAD,
        base + FLOOR_PITCH_ROOM,
    )
    _stamped(draw, pass_, y + 6)
    return Drawn(sheets.save(sheet, sheet_path("gallery-floors")), floors_provenance(pass_))


def _wrapped(draw, words: str, face, room: float) -> list[str]:
    """One mode's name over as few lines as fit under its own bar.

    The engine's own name for a mode, which is the name this article teaches and the one
    its scoreboard lists — never an abbreviation invented for a chart, which would be a
    second name for a thing the page has already named once.
    """
    lines: list[str] = []
    for word in words.split():
        if lines and text_width(draw, f"{lines[-1]} {word}", face) <= room:
            lines[-1] = f"{lines[-1]} {word}"
        else:
            lines.append(word)
    return lines


def _round_up(value: int, step: int = 50) -> int:
    return max(step, math.ceil(value / step) * step)


def floors_provenance(pass_: Pass) -> list[str]:
    floors = pass_.manifest["shortfalls"]["modes"]["floors"]
    seated = pass_.manifest["counts"]["mode"]
    demands = pass_.manifest["shortfalls"]["demands"]
    refusals = pass_.manifest["shortfalls"]["refusals_while_choosing"]
    return [
        "Drawn, not rendered: a chart composed by builder.curation:gallery_floors from "
        f"artifacts/curation/tentative/{pass_.stamp}/manifest.json — `counts.mode` for "
        "what each mode took, `shortfalls.modes.floors` for what it was asked for, and "
        "`shortfalls.refusals_while_choosing` for the foot. Nothing is rendered and no "
        "engine is reached.",
        _pass_line(pass_),
        "One bar a mode, ordered by the seats it took: the whole bar is the seats, the "
        "shaded part is the floor inside them, and the rule across the shading is the "
        "floor itself. A mode's seats are counted by the mode its ledger recipe names, "
        "which is what the engine was handed.",
        "Floor against seated, in the order drawn: "
        + ", ".join(
            f"{mode} {int(floors.get(mode, 0))}/{int(seated[mode])}"
            for mode in sorted(seated, key=lambda name: (-int(seated[name]), name))
        )
        + f". The floors sum to {pass_.manifest['shortfalls']['modes']['asked']} against "
        f"{pass_.asked:,} seats, and the pass's own demand table records "
        f"{demands['short_total']} seats short over {len(demands['rows'])} demands.",
        f"The {pass_.unfilled} unfilled seats are not floors. What refused the candidates "
        "offered while the set was being built, by rule: "
        + ", ".join(f"{name} {count:,}" for name, count in sorted(refusals.items()) if count)
        + ". A refusal is one offer refused and not one candidate lost — the same picture "
        "is offered again as the set changes around it.",
        "This figure was specified as two gallery sizes side by side, and it is one. The "
        "only sizes recorded against this pool are n = 1,000; every n = 150 record on this "
        "machine was solved over an earlier and smaller pool, and two sizes over two pools "
        "is not the comparison the figure claims. The page's sentence about a gallery of a "
        "hundred and fifty is the claim that still wants a record.",
    ]


# ------------------------------------------------------- two pictures that read as one

#: The three pairs, and what each is doing on the sheet. The keys live on the registry
#: row the way `picks.py`'s do — a pair is an edit there and a redraw, never a constant
#: here.
TWIN_ROWS = (
    ("refused as near-duplicates", "under the threshold"),
    ("seated, and only just", "the far side of it"),
    ("two ordinary wallpapers", "the middle of the distribution"),
)

TWIN_COLUMNS = 2

#: The panels are the pass's **own pictures, copied**, and not a redraw at the geometry
#: `picks.py` draws a panel at. The twin measure is taken on the finished 640x360 render
#: a run wrote, so a sharper panel would be a picture the number under it was never
#: measured on — and the number is the whole figure. `picks.panel_or_seat`'s copy route
#: exists for a seat whose curve is lost; this is the same copy for a different reason.
TWIN_PANEL = (640, 360)

#: The room under a pair: the distance, and what that distance is an example of.
TWIN_BAND = 74


def _twin_pick(key: str, seats: dict, rows: dict) -> picks.Pick:
    """One panel of this figure, seated or not.

    A refused candidate has no seat, so its stand-in row is the ledger's own — which
    carries the picture the pass compared, and claims nothing else. The identifier says
    which store answered for it, so a reader of the provenance is never told a candidate
    was seated.
    """
    row = rows.get(key)
    if row is None:
        raise CurationError(f"{key} is not in the candidate ledger, so nothing draws it")
    seat = seats.get(key)
    return picks.Pick(
        identifier=f"{STAMP}{picks.PICK_SEPARATOR}{key}" if seat else f"candidate|{key}",
        stamp=STAMP,
        key=key,
        seat=seat or {"alias": key[:8], "picture": row.get("picture")},
        recipe=row["recipe"],
        source={"picture": row.get("picture"), **(row.get("provenance") or {})},
    )


def twin_pairs(identifier: str = "gallery-twins") -> list[list[str]]:
    """The three pairs a figure's own registry row names, held to being three pairs."""
    figure = figures_module.load_all().get(identifier)
    if figure is None or figure.recipe is None or "pairs" not in figure.recipe.args:
        raise CurationError(
            f"{identifier}'s registry row carries no `pairs` — this figure names its "
            "panels by recipe key, two to a row, in its own recipe args"
        )
    pairs = figure.recipe.args["pairs"]
    if len(pairs) != len(TWIN_ROWS) or any(len(pair) != TWIN_COLUMNS for pair in pairs):
        raise CurationError(
            f"{identifier} is {len(TWIN_ROWS)} pairs of {TWIN_COLUMNS}, and its row names "
            f"{len(pairs)}"
        )
    return [[str(key) for key in pair] for pair in pairs]


def gallery_twins() -> Drawn:
    """`gallery-twins` — three pairs, and the distance the pass measured between them."""
    pass_ = read()
    pairs = twin_pairs()
    threshold = float(pass_.solve["diversity"]["threshold"])
    seats = picks.seats(STAMP)
    rows = picks.ledger_rows({key for pair in pairs for key in pair})
    resolved = [[_twin_pick(key, seats, rows) for key in pair] for pair in pairs]
    pictures = [[picks.seat_picture(pick) for pick in pair] for pair in resolved]
    measured = renders.twin_distances([(one, other) for one, other in pictures])
    _measured_as_recorded(pass_, pairs, measured)

    width, height = TWIN_PANEL
    room = TWIN_COLUMNS * (width + sheets.PAD) - sheets.PAD
    sheet, draw = sheets.canvas(
        sheets.PAD + TWIN_COLUMNS * (width + sheets.PAD),
        sheets.PAD + len(pairs) * (height + TWIN_BAND + sheets.PAD),
    )
    for index, pair in enumerate(pictures):
        top = sheets.PAD + index * (height + TWIN_BAND + sheets.PAD)
        for column, picture in enumerate(pair):
            sheet.paste(
                sheets.fitted(picture, TWIN_PANEL),
                (sheets.PAD + column * (width + sheets.PAD), top),
            )
        words, reading = TWIN_ROWS[index]
        sheets.centred(
            draw,
            sheets.PAD,
            top + height + 12,
            room,
            f"{measured[index]:.4f} — {reading}",
            font(21),
            WELL_INK,
        )
        sheets.centred(draw, sheets.PAD, top + height + 44, room, words, font(16), WELL_INK_DIM)

    draw.text(
        (sheets.PAD, sheets.PAD + len(pairs) * (height + TWIN_BAND + sheets.PAD) - 24),
        f"the threshold is {threshold:.5f}",
        fill=SECTION_INK,
        font=font(15),
    )
    return Drawn(
        sheets.save(sheet, sheet_path("gallery-twins")),
        twins_provenance(pass_, resolved, measured),
    )


def _measured_as_recorded(pass_: Pass, pairs: list[list[str]], measured: list[float]) -> None:
    """A pair the pass itself measured comes back at the pass's own number, or nothing.

    The refused pair is on the solve record with its distance, and re-measuring it here
    is the one chance this figure has to show that the number under a picture is the
    number the gallery was chosen under rather than a second reading that resembles it.
    """
    refusals = pass_.solve["diversity_refusals"]
    for pair, found in zip(pairs, measured, strict=True):
        for index, key in enumerate(pair):
            recorded = refusals.get(key)
            if recorded is None or recorded["too_close_to"] != pair[1 - index]:
                continue
            if abs(float(recorded["distance"]) - found) > 1e-5:
                raise CurationError(
                    f"{key[:8]} and {pair[1 - index][:8]} were refused at "
                    f"{recorded['distance']} by the pass and measure {found:.6f} here"
                )


def twins_provenance(pass_: Pass, resolved, measured: list[float]) -> list[str]:
    diversity = pass_.solve["diversity"]
    lines = [
        "builder.curation:gallery_twins — six pictures and three numbers. Every panel is "
        "**the pass's own finished picture, copied**: the twin measure is taken on the "
        f"{TWIN_PANEL[0]}x{TWIN_PANEL[1]} render a run wrote, so a redraw at any other "
        "regime would be a picture the number under it was never measured on. Nothing "
        "here reaches the engine.",
        _pass_line(pass_),
        f"The measure: {diversity['metric']}, over {diversity['directions']} directions, "
        f"threshold {diversity['threshold']} out of ceiling.TAU, refusing a picture with "
        f"{diversity['neighbours']} seated neighbour inside it. Every distance below was "
        "measured here through fractal_wallpapers.palettes.pixel_clouds, which is the "
        "module the pass measures with, and the refused pair is held to the distance the "
        "solve record wrote for it.",
    ]
    lines.append(
        "No line of this row puts the word `colormap` in front of a map's name, so no "
        "link into the explorer is derived from it and that refusal is the record's own. "
        "Every panel here is a picture the autolevel operator has been over — the pass "
        "measured what the run wrote — and the explorer draws a map as the library holds "
        "it, with no way to carry a tone curve. A link would open six pictures in the "
        "colors these six are not."
    )
    for index, pair in enumerate(resolved):
        words, reading = TWIN_ROWS[index]
        lines.append(
            f"Pair {index + 1}, {words}, measured at {measured[index]:.6f} — {reading}. "
            + " The other: ".join(
                f"{'seat' if pick.identifier.startswith(STAMP) else 'candidate'} "
                f"{picks.frame_line(pick, representative=False)} Copied from "
                f"{pick.seat.get('picture')}."
                for pick in pair
            )
        )
    return lines


# ----------------------------------------------------------------------- the interface

#: Which of these are drawn art rather than photographs, and so ship lossless. A chart
#: is hairlines and flat ground, and JPEG rings every one of them.
CHARTS = ("gallery-pool", "gallery-allowance", "gallery-floors")

MAKERS = {
    "gallery-pool": gallery_pool,
    "gallery-allowance": gallery_allowance,
    "gallery-floors": gallery_floors,
    "gallery-twins": gallery_twins,
}


def sources(identifier: str) -> list[dict]:
    """Where a figure of this page got its pictures — a record, or seats and candidates.

    The twins figure is the one that shows pictures, and its six are of two kinds: five
    are seats of the pass, and one is a candidate the pass refused. A refused candidate
    is not a seat and is not written down as one, which is what the `candidate` kind is
    for.
    """
    if identifier not in MAKERS:
        raise records.RecordError(f"{identifier} is not drawn by {__name__}")
    if identifier != "gallery-twins":
        return [{"kind": figures_module.SYNTHETIC, "keys": []}]
    seated = picks.seats(STAMP)
    keys = [key for pair in twin_pairs() for key in pair]
    found = [
        {
            "kind": figures_module.GALLERY_SEAT,
            "keys": [f"{STAMP}{picks.PICK_SEPARATOR}{key}" for key in keys if key in seated],
            "drawn": figures_module.OWN_RECIPE,
        }
    ]
    loose = [key for key in keys if key not in seated]
    if loose:
        found.append({"kind": figures_module.CANDIDATE, "keys": loose})
    return found


def recipe(identifier: str) -> dict:
    if identifier not in MAKERS:
        raise records.RecordError(f"{identifier} is not drawn by {__name__}")
    args: dict = {"stamp": STAMP, "solve": SOLVE}
    if identifier == "gallery-twins":
        args["pairs"] = twin_pairs()
    return {"maker": f"{__name__}:{MAKERS[identifier].__name__}", "args": args}


def draw(identifier: str) -> Drawn:
    if identifier not in MAKERS:
        raise records.RecordError(f"{identifier} is not drawn by {__name__}")
    return MAKERS[identifier]()
