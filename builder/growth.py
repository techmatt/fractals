"""The figure of *what more mining buys*, drawn from the curation growth instrument.

Every other data figure on this site is a picture — panels the engine drew, arranged on
the well. This one is a chart, and it has no render behind it at all: it is the reading
of a measurement the wallpaper project takes next door, `curate growth`, which asks the
one question a mining leg is bought to move. Does another doubling of mining buy a
better gallery, and at which sizes?

## What it reads, and why that file rather than a summary

`artifacts/curation/growth/<stamp>/growth.jsonl`, one row per `(rung, seed, n)`, and its
`manifest.json` beside it. The schema is documented at the top of that module and is
called a contract there **because this figure bakes from it** — so the bake reads the
rows directly and derives every number on the sheet, and a re-run of the instrument
re-bakes the picture rather than being transcribed into it.

A stamped folder carrying rows and no manifest is a run that died partway, and it is
refused by name: without the manifest there is no pool stamp, so nothing says whether
its rungs are comparable with any other run's.

## Which sizes are drawn, and what a hollow marker means

`SIZES` is 50, 100 and 200. The instrument also solves 400, and 400 fills at no rung
this pool reaches — its median is a median over the seats that were filled rather than
the seats that were asked for, which is a different measurement wearing the same axis.
What the drawn lines are about is quality *with the seats held full*.

Even inside those three, the bottom rungs do not always fill: n = 200 seats fully only
from 1/4 upward, and n = 100 only from 1/32. A point whose draws did not fill on average
is **drawn hollow**, and the sheet says so under the panels. That is the general form of
*the 1/64 point is drawn hollow*: the rule is filled-or-not rather than a named rung,
because at n = 50 the 1/64 gallery does fill and a hollow marker there would be saying
something untrue about it.

## The x axis is approximate, and says so

`attempts` is surviving ledger rows in the drawn visits, and retention keeps three rows
per `(location, mode)` — so it is a floor on what was really attempted, not a count. The
axis carries that word rather than leaving a reader to assume a census.

## Why the two panels do not share a y scale

The tenth percentile lives in the bottom half of the median's range, and on the median's
axis it would be a flat line along the floor saying nothing. Each panel names its own
ceiling in its own gridline labels, which is the only reason two scales are honest here:
neither number is ever read off the other panel's axis.
"""

from __future__ import annotations

import json
import math
import re
from dataclasses import dataclass
from pathlib import Path

from . import records, renders, sheets
from .paths import SITE_ROOT
from .theme import (
    SECTION_INK,
    WELL,
    WELL_INK,
    WELL_INK_DIM,
    WELL_RULE,
    font,
    text_width,
)

#: Where a composed sheet lands before `--place` imports it — the same ignored tree the
#: other makers compose into.
SHEETS_DIR = SITE_ROOT / "artifacts" / "figures"

#: The subtree the instrument's stamped runs land in, under the wallpaper project's
#: regenerable tree.
UNIT = ("curation", "growth")

ROWS_NAME = "growth.jsonl"
MANIFEST_NAME = "manifest.json"

#: What a stamped run is named: UTC, basic form, the way the instrument writes it. The
#: tree next door also carries hand-named probe folders — `probe8`, `determinism_8_11` —
#: which are somebody's half-ladder and not a run of the instrument, and picking "the
#: last name" out of that folder finds `probe8` because `p` sorts after `2`. So the
#: latest run is the latest *stamp*, and a folder that is not one is not a candidate.
STAMPED = re.compile(r"^\d{8}T\d{6}Z$")

#: The schema this bake was written against. The instrument stamps it on every row and
#: on its manifest; a bump next door stops the bake rather than quietly changing what
#: the picture means.
SCHEMA = 1

#: The gallery sizes the figure draws. See the module docstring: 400 is measured and not
#: drawn, because no rung of this pool fills it.
SIZES = (50, 100, 200)

#: One ink per size, cool to warm, so an unlabelled line can still be put in its order.
#: Deliberately not `theme.RATING_INK`, whose steps are the four-point rating scale and
#: mean that wherever they appear.
SIZE_INK = {
    50: (0x6F, 0xB3, 0xFF),
    100: (0x5F, 0xDD, 0x8F),
    200: (0xFF, 0xA5, 0x3D),
}

#: The fraction under each tick, a rank quieter than the count above it. Quieter and not
#: silent: a rung's name is how a reader ties a point back to the record, and the rule
#: ink it was first drawn in disappeared at the width the figure is actually read at.
RUNG_INK = sheets.mix(WELL, SECTION_INK, 0.72)

#: The house sheet width, the width every figure composed at this size shares.
SHEET_WIDTH = 1316

#: The plot's own box inside the sheet. The right margin is the room the line labels sit
#: in: a legend a reader has to look away to read is a legend they read twice.
PLOT_LEFT = 68
LABEL_ROOM = 104
PLOT_RIGHT = SHEET_WIDTH - sheets.PAD - LABEL_ROOM

#: The two panels' heights. The median is the reading; the tenth percentile is the check
#: on it, and is drawn smaller because that is what it is.
MEDIAN_HEIGHT = 306
TENTH_HEIGHT = 176

#: The figure this module draws. It is a **draft**: the ladder it bakes from stops at
#: n = 200 because the pool cannot yet seat 700, 1000 or 2000, and the whole picture is
#: re-baked when it can.
FIGURE_ID = "pipeline-growth"


class GrowthError(RuntimeError):
    """Something about the growth instrument's records, or the absence of them."""


@dataclass(frozen=True)
class Run:
    """One stamped run of the instrument: its rows, and the manifest that vouches them."""

    stamp: str
    path: Path
    manifest: dict
    rows: list[dict]

    @property
    def pool_stamp(self) -> str:
        return self.manifest["pool"]["stamp"]


@dataclass(frozen=True)
class Point:
    """One rung of one line: the seeds averaged, and the spread they came in at."""

    rung: str
    attempts: float
    seeds: int
    fill: float
    median: float
    median_low: float
    median_high: float
    tenth: float
    tenth_low: float
    tenth_high: float

    @property
    def filled(self) -> bool:
        """Whether the galleries behind this point were full ones."""
        return self.fill >= 1.0


@dataclass(frozen=True)
class Line:
    """One gallery size's curve across the rungs, coarsest rung first."""

    size: int
    points: list[Point]

    @property
    def ink(self):
        return SIZE_INK[self.size]

    @property
    def rise(self) -> float:
        """End to end, what the whole measured ladder bought this size's median."""
        return self.points[-1].median - self.points[0].median


@dataclass(frozen=True)
class Drawn:
    """A composed sheet, and the lines that say how it was made."""

    path: Path
    provenance: list[str]


# -------------------------------------------------------------------------- the records


def runs_dir() -> Path:
    return renders.artifact(*UNIT)


def load_run(stamp: str | None = None) -> Run:
    """The named run, or the latest one — held to carrying a manifest at all.

    Stamps are UTC in basic form, so lexicographic order is chronological and the latest
    run is the last stamp — the last *name* is something else, because the tree also
    carries hand-named probes. A folder with rows and no manifest is a run that died
    partway through the ladder; it is refused by name rather than skipped, because a
    silent skip would draw an older run under a caption claiming this one. A stamp given
    by hand is taken as given: naming a probe is a thing somebody may want to do once.
    """
    root = runs_dir()
    if not root.is_dir():
        raise GrowthError(f"no growth runs at {root} — run `curate growth` next door")
    if stamp is None:
        stamped = sorted(
            path.name for path in root.iterdir() if path.is_dir() and STAMPED.match(path.name)
        )
        if not stamped:
            raise GrowthError(f"no stamped growth run under {root}")
        stamp = stamped[-1]
    path = root / stamp
    rows_path, manifest_path = path / ROWS_NAME, path / MANIFEST_NAME
    if not rows_path.is_file():
        raise GrowthError(f"growth run {stamp} carries no {ROWS_NAME}")
    if not manifest_path.is_file():
        raise GrowthError(
            f"growth run {stamp} carries {ROWS_NAME} and no {MANIFEST_NAME} — a run that "
            "died partway. Nothing says which pool its rungs were taken over, so it is "
            "refused rather than drawn"
        )
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    rows = [
        json.loads(line)
        for line in rows_path.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    for record in (manifest, *rows):
        if record.get("schema") != SCHEMA:
            raise GrowthError(
                f"growth run {stamp} is schema {record.get('schema')!r}, and this bake "
                f"reads schema {SCHEMA}"
            )
    return Run(stamp=stamp, path=path, manifest=manifest, rows=rows)


def lines(run: Run) -> list[Line]:
    """The curves, one per size, each rung's seeds averaged and their spread kept.

    The rungs come out in the order the instrument planned them — coarsest first — and
    every size is held to standing on the same rungs, so two lines on one axis are two
    readings of one ladder rather than two ladders drawn together.
    """
    rungs = [f"1/{denominator}" for denominator in run.manifest["plan"]["denominators"]]
    found = []
    for size in SIZES:
        points = []
        for rung in rungs:
            cell = [row for row in run.rows if row["rung"] == rung and row["n"] == size]
            if not cell:
                raise GrowthError(f"growth run {run.stamp} has no rung {rung} at n = {size}")
            points.append(_point(rung, cell))
        found.append(Line(size=size, points=points))
    return found


def _point(rung: str, cell: list[dict]) -> Point:
    """One cell's seeds reduced: the mean of each reading, and the band it spanned."""
    medians = [row["seated_rank"]["p50"] for row in cell]
    tenths = [row["seated_rank"]["p10"] for row in cell]
    return Point(
        rung=rung,
        attempts=sum(row["attempts"] for row in cell) / len(cell),
        seeds=len(cell),
        fill=sum(row["fill"] for row in cell) / len(cell),
        median=sum(medians) / len(medians),
        median_low=min(medians),
        median_high=max(medians),
        tenth=sum(tenths) / len(tenths),
        tenth_low=min(tenths),
        tenth_high=max(tenths),
    )


# ---------------------------------------------------------------------------- the panel
#
# One panel is a box, a set of curves and an axis, and the two on this sheet differ only
# in which reading of a point they take. So the reading is a pair of accessors passed in
# — the value, and the band around it — and there is one drawing path rather than two
# that have to be kept agreeing.


@dataclass(frozen=True)
class Panel:
    """Where a panel sits, what it is read against, and which reading it draws."""

    top: int
    height: int
    ceiling: float
    name: str
    value: str
    band: tuple[str, str]

    def of(self, point: Point) -> float:
        return getattr(point, self.value)

    def spread(self, point: Point) -> tuple[float, float]:
        return getattr(point, self.band[0]), getattr(point, self.band[1])

    def y(self, value: float) -> float:
        return self.top + self.height - value / self.ceiling * self.height


def _ceiling(value: float) -> float:
    """The next tenth above a reading, so the top gridline is a round number."""
    return math.ceil(value * 10) / 10


def _span(drawn: list[Line]) -> tuple[float, float]:
    """The x axis, in log attempts: the coarsest rung to the whole pool."""
    attempts = [point.attempts for line in drawn for point in line.points]
    return math.log10(min(attempts)), math.log10(max(attempts))


def _x(attempts: float, span: tuple[float, float]) -> float:
    low, high = span
    return PLOT_LEFT + (math.log10(attempts) - low) / (high - low) * (PLOT_RIGHT - PLOT_LEFT)


def _grid(draw, panel: Panel) -> None:
    """The panel's box: gridlines every tenth, labelled, and its own name above it."""
    face = font(14)
    for step in range(round(panel.ceiling * 10) + 1):
        value = step / 10
        y = panel.y(value)
        draw.line([PLOT_LEFT, y, PLOT_RIGHT, y], fill=WELL_RULE, width=1)
        text = f"{value:.1f}"
        draw.text(
            (PLOT_LEFT - 10 - text_width(draw, text, face), y - 8),
            text,
            fill=SECTION_INK,
            font=face,
        )
    draw.text((PLOT_LEFT, panel.top - 24), panel.name, fill=WELL_INK_DIM, font=font(15))


def _band(draw, line: Line, panel: Panel, span: tuple[float, float]) -> None:
    """The seed spread, as a ribbon in a muted cut of the line's own ink.

    Pillow has no alpha on an RGB canvas, so the fill is mixed against the well rather
    than laid over it. Where a rung was not drawn at all — the full pool, which *is* the
    pool — there is no spread and the ribbon closes onto the line.
    """
    tone = sheets.mix(WELL, line.ink, 0.26)
    upper, lower = [], []
    for point in line.points:
        x = _x(point.attempts, span)
        low, high = panel.spread(point)
        upper.append((x, panel.y(high)))
        lower.append((x, panel.y(low)))
    draw.polygon(upper + lower[::-1], fill=tone)


def _curve(draw, line: Line, panel: Panel, span: tuple[float, float]) -> None:
    """The line, and one marker a rung — filled where the seats were filled."""
    points = [(_x(point.attempts, span), panel.y(panel.of(point))) for point in line.points]
    draw.line([number for point in points for number in point], fill=line.ink, width=3)
    for (x, y), point in zip(points, line.points, strict=True):
        box = [x - 5, y - 5, x + 5, y + 5]
        if point.filled:
            draw.ellipse(box, fill=line.ink)
        else:
            draw.ellipse(box, fill=WELL, outline=line.ink, width=2)


#: How far apart two line labels have to sit before one is reading over the other.
LABEL_LEAD = 23


def _line_labels(draw, drawn: list[Line], panel: Panel) -> None:
    """Each size named at the end of its own line, in its own ink — never a keyed box.

    Pushed apart where two lines finish close together, which the tenth-percentile panel
    does: n = 50 and n = 100 end a third of a gridline apart there, and two labels on one
    baseline are two labels nobody can attach to a line. The push is downward from the
    top, so the order of the labels still matches the order of the lines.
    """
    face = font(17)
    placed: list[float] = []
    for line in sorted(drawn, key=lambda one: -panel.of(one.points[-1])):
        y = panel.y(panel.of(line.points[-1])) - 9
        if placed and y - placed[-1] < LABEL_LEAD:
            y = placed[-1] + LABEL_LEAD
        placed.append(y)
        draw.text((PLOT_RIGHT + 14, y), f"n = {line.size}", fill=line.ink, font=face)


def _x_axis(draw, drawn: list[Line], panel: Panel, span: tuple[float, float]) -> None:
    """The rungs, labelled in attempts — the effort behind each point, approximately."""
    face = font(14)
    baseline = panel.top + panel.height
    for point in drawn[0].points:
        x = _x(point.attempts, span)
        draw.line([x, baseline, x, baseline + 5], fill=WELL_RULE, width=1)
        for offset, text, ink in (
            (10, _count(point.attempts), SECTION_INK),
            (28, point.rung, RUNG_INK),
        ):
            draw.text(
                (x - text_width(draw, text, face) / 2, baseline + offset), text, fill=ink, font=face
            )


def _count(value: float) -> str:
    """A rung's effort, rounded to something a reader holds in their head."""
    if value >= 10_000:
        return f"{value / 1000:.0f}k"
    return f"{value / 1000:.1f}k"


# ---------------------------------------------------------------------------- the sheet


def what_more_mining_buys(stamp: str | None = None) -> Drawn:
    """The two panels: the seated median, and the tenth percentile of the same seats."""
    run = load_run(stamp)
    drawn = lines(run)
    span = _span(drawn)

    median = Panel(
        top=sheets.PAD + 96,
        height=MEDIAN_HEIGHT,
        ceiling=_ceiling(max(point.median_high for line in drawn for point in line.points)),
        name="median seated ranking score",
        value="median",
        band=("median_low", "median_high"),
    )
    tenth = Panel(
        top=median.top + MEDIAN_HEIGHT + 100,
        height=TENTH_HEIGHT,
        ceiling=_ceiling(max(point.tenth_high for line in drawn for point in line.points)),
        name="10th percentile of the same seats",
        value="tenth",
        band=("tenth_low", "tenth_high"),
    )
    foot = tenth.top + TENTH_HEIGHT + 66
    sheet, draw = sheets.canvas(SHEET_WIDTH, foot + 22 + 20 + sheets.PAD)

    draw.text(
        (sheets.PAD, sheets.PAD),
        "What another doubling of mining buys, at three gallery sizes",
        fill=WELL_INK,
        font=font(19),
    )
    draw.text(
        (sheets.PAD, sheets.PAD + 28),
        "the pool re-solved over a fraction of the visits that made it, three draws a rung",
        fill=WELL_INK_DIM,
        font=font(15),
    )

    for panel in (median, tenth):
        _grid(draw, panel)
        for line in drawn:
            _band(draw, line, panel, span)
        for line in drawn:
            _curve(draw, line, panel, span)
        _line_labels(draw, drawn, panel)
        _x_axis(draw, drawn, panel, span)

    _foot(draw, run, foot)
    return Drawn(sheets.save(sheet, sheet_path(FIGURE_ID)), provenance(run, drawn))


def _foot(draw, run: Run, y: int) -> None:
    """What the axis is, what a hollow marker means, and which run this is."""
    face = font(15)
    for offset, note in (
        (
            0,
            "mining behind the pool, in attempts — approximate, and a floor: retention "
            "keeps three rows per location and mode",
        ),
        (
            22,
            "a hollow marker is a rung whose draws could not fill the gallery, so its "
            "score is over fewer seats than were asked for",
        ),
    ):
        draw.text((PLOT_LEFT, y + offset), note, fill=SECTION_INK, font=face)
    stamped = f"{run.manifest['pool']['candidates']:,} candidates · pool {run.pool_stamp[:12]}"
    small = font(13)
    draw.text(
        (PLOT_RIGHT + LABEL_ROOM - text_width(draw, stamped, small), y + 24),
        stamped,
        fill=sheets.mix(WELL, SECTION_INK, 0.62),
        font=small,
    )


def sheet_path(identifier: str) -> Path:
    SHEETS_DIR.mkdir(parents=True, exist_ok=True)
    return SHEETS_DIR / f"{identifier}.png"


def provenance(run: Run, drawn: list[Line]) -> list[str]:
    """One line for the chart, one for the pool, one for the ladder, one per curve.

    A chart is drawn, not rendered, and the first line says so in those words: that is
    the phrase `builder/links.py` reads to refuse an explorer link rather than guess at
    one for a picture with no frame behind it.
    """
    plan = run.manifest["plan"]
    pool = run.manifest["pool"]
    written = [
        "Drawn, not rendered: a chart composed by builder.growth:what_more_mining_buys "
        f"from {ROWS_NAME} of the curation growth run {run.stamp} — "
        f"artifacts/curation/growth/{run.stamp}/, {len(run.rows)} rows, taken at "
        f"{run.manifest['taken_at']} against wallpapers commit {run.manifest['commit'][:12]}.",
        f"The pool it re-solves: stamp {run.pool_stamp}, {pool['candidates']} candidates "
        f"over {pool['locations']} locations, {pool['visits_reachable']} reachable visits "
        f"in {pool['legs']} legs, {pool['ledger_rows']} ledger rows.",
        f"The ladder: denominators {', '.join(str(one) for one in plan['denominators'])}, "
        f"seeds {', '.join(str(one) for one in plan['seeds'])} at every rung below the "
        f"full pool, sizes {', '.join(str(one) for one in plan['sizes'])} solved. Drawn "
        f"here: n = {', '.join(str(one) for one in SIZES)} — n = 400 is measured and not "
        "drawn, because no rung of this pool fills it.",
        "Both panels are seated ranking score on the fitted rank key: the top panel is "
        "the median of the seated set, the bottom the 10th percentile of the same seats. "
        "The ribbon is the min-to-max spread of the rung's seed draws, and the full pool "
        "is not drawn and so carries none. A hollow marker is a mean fill below 1.",
        "x is the rung's mean attempts on a log axis — surviving ledger rows in the drawn "
        "visits, which retention caps at three per (location, mode), so it is a floor on "
        "what was attempted rather than a count of it.",
    ]
    for line in drawn:
        rungs = " · ".join(_rung_line(point) for point in line.points)
        written.append(
            f"n = {line.size}: median/p10 by rung, {rungs}. End to end the median rises "
            f"{line.points[0].median:.4f} → {line.points[-1].median:.4f}."
        )
    return written


def _rung_line(point: Point) -> str:
    """One rung of one curve, as the record spells it: the two readings, and the fill."""
    short = f"{point.rung} {point.median:.4f}/{point.tenth:.4f}"
    return short if point.filled else f"{short} (fill {point.fill:.3f})"


MAKERS = {FIGURE_ID: what_more_mining_buys}

#: Every figure this module draws lands as a **draft**, mark and all: the numbers change
#: the next time the instrument is run, which is the one thing a reader of a placed
#: figure would otherwise have no way to know.
DRAFTS = frozenset({FIGURE_ID})


def recipe(identifier: str) -> dict:
    """The registry recipe: the maker, and no arguments.

    No stamp is pinned. The whole point of this figure is that it re-bakes when the
    instrument is re-run, and a pinned stamp would make the next run invisible to it —
    the opposite of what a growth curve is for. Which run was drawn goes into the
    provenance instead, pool stamp and all, so the picture still says what it came from.
    """
    if identifier not in MAKERS:
        raise records.RecordError(f"{identifier} is not drawn by builder.growth")
    return {"maker": f"{__name__}:{MAKERS[identifier].__name__}", "args": {}}


def draw(identifier: str) -> Drawn:
    if identifier not in MAKERS:
        raise records.RecordError(f"{identifier} is not drawn by builder.growth")
    return MAKERS[identifier]()
