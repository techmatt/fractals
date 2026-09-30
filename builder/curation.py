"""The figures of *Gallery curation*.

The ninth section's subject is one pass over the whole pool that chooses the whole set at
once, so its figures are readings of **that pass's own record** rather than pictures of a
place. The one drawn here is pairs of pictures with a number between them; the grid of
what a pass ships is a sheet of seats and lives in `picks.py` with the other figures whose
panels are named by tentative-gallery ID.

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

`gallery-twins` is the one figure drawn here, and it draws four pictures the way
`picks.py` draws a panel — at the seat's own recipe, through the autolevel curve the run
stamped. The two charts this module also drew, the pool's narrowing and the seats by
color, left the page and went on 2026-09-30 with their makers.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

from . import figures as figures_module
from . import picks, records, renders, sheets
from .locations import Drawn, sheet_path
from .theme import (
    SECTION_INK,
    WELL_INK,
    WELL_INK_DIM,
    font,
)

#: The recorded tentative gallery every figure of this page reads. Pinned: a page
#: captioned *one pass* that quietly redrew itself off whichever pass was newest would be
#: a different measurement under the same words.
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
    def taken_at(self) -> str:
        return str(self.manifest["taken_at"])

    @property
    def commit(self) -> str:
        return str(self.manifest.get("source_commit") or "")[:12]


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


# --------------------------------------------------------------------- which pass it is


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

MAKERS = {
    "gallery-twins": gallery_twins,
}


def sources(identifier: str) -> list[dict]:
    """Where a figure of this page got its pictures — seats and candidates.

    The twins figure shows six pictures of two kinds: five are seats of the pass, and one
    is a candidate the pass refused. A refused candidate is not a seat and is not written
    down as one, which is what the `candidate` kind is for.
    """
    if identifier not in MAKERS:
        raise records.RecordError(f"{identifier} is not drawn by {__name__}")
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
    args: dict = {"stamp": STAMP, "solve": SOLVE, "pairs": twin_pairs()}
    return {"maker": f"{__name__}:{MAKERS[identifier].__name__}", "args": args}


def draw(identifier: str) -> Drawn:
    if identifier not in MAKERS:
        raise records.RecordError(f"{identifier} is not drawn by {__name__}")
    return MAKERS[identifier]()
