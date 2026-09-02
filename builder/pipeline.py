"""The charts of *Full pipeline*.

The tenth section carries two figures that are readings of a measurement rather than
pictures of a place: `pipeline-growth`, which is `growth.py` next door because it bakes
from the curation growth instrument's own record, and the one this module draws.

## What a run's yield is, and where it is read

A **run** of the search expands its frontier batch by batch; every batch proposes
candidate frames, the location judge scores each, and the ones it rates likely to be at
least good are **admitted**. The run writes every one of those events into its own walk
ledger — one `candidate` row a frame, carrying the batch it was proposed in, the family
it belongs to and the fate the gates and the judge gave it — so *admissions per batch*
is a count over that ledger and nothing else. A row whose `fate` is `survived` is an
admission; every other fate is a frame the run looked at and did not keep.

The ledger is read **streamed**, one row at a time. It is eighty megabytes and only four
of its fields are wanted, and a figure that loads a run whole in order to count nine
numbers a batch is a figure nobody can draw on a laptop.

## What holds the count honest

A run also writes a `summary` row, and that row carries its own tally of admissions per
partition. The bake derives the same nine numbers off the `candidate` rows and **refuses
where the two disagree**: the picture is a reading of the ledger, and a reading that does
not reproduce the run's own arithmetic is a reading of something else.

## The smoothing, and why the picture needs it

Admissions per batch is a small integer — this run averages about three — and the raw
series is a hedge of spikes with no shape in it at all. So the drawn series is a centred
moving average, and the window is named on the sheet: what a reader is being shown is a
trend and the sheet says so, rather than implying a smooth quantity that was never
measured.
"""

from __future__ import annotations

import json
import math
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

FIGURE_ID = "pipeline-yield-decay"

#: The run the figure draws. Pinned, the way `builder.pool`'s rows are pinned: a chart
#: captioned *one run* that quietly redrew itself off whichever run was newest would be
#: a different measurement under the same words. Which run it is goes on the sheet.
RUN = "harvest_run10"

#: What a `candidate` row's `fate` says when the judge admitted the frame. Every other
#: fate is a frame the run drew and did not keep.
ADMITTED = "survived"

#: The nine partitions, bottom of the stack first: the Julia partitions, which are most
#: of this run's admissions, then the planes they are cut from, then Phoenix. A reader
#: reads the legend top down against the stack top down, so the legend is this reversed.
PARTITIONS = (
    "julia:mandelbrot",
    "julia:multibrot3",
    "julia:multibrot4",
    "julia:multibrot5",
    "mandelbrot",
    "multibrot3",
    "multibrot4",
    "multibrot5",
    "phoenix",
)

#: One ink a partition, cool for the Julia sets and warm for the planes, so the two
#: groups separate before a single word of the legend is read. Deliberately neither
#: `theme.RATING_INK` nor `theme.MARK_INK`: those two mean the rating scale and a marked
#: point on a map, and they mean it wherever they appear.
PARTITION_INK = {
    "julia:mandelbrot": (0x6F, 0xB3, 0xFF),
    "julia:multibrot3": (0x5B, 0xC8, 0xFF),
    "julia:multibrot4": (0x5F, 0xDD, 0x8F),
    "julia:multibrot5": (0x3F, 0xB0, 0xA8),
    "mandelbrot": (0xE8, 0x73, 0x4A),
    "multibrot3": (0xFF, 0xA5, 0x3D),
    "multibrot4": (0xE3, 0xC6, 0x5A),
    "multibrot5": (0xB8, 0x8E, 0x4C),
    "phoenix": (0xB0, 0x6E, 0xC8),
}

#: What a reader calls each partition. The same vocabulary `builder.picks` labels a tile
#: with, because a partition is a family and the article names families once.
PARTITION_WORDS = {
    "julia:mandelbrot": "Julia",
    "julia:multibrot3": "Julia d = 3",
    "julia:multibrot4": "Julia d = 4",
    "julia:multibrot5": "Julia d = 5",
    "mandelbrot": "Mandelbrot",
    "multibrot3": "Multibrot d = 3",
    "multibrot4": "Multibrot d = 4",
    "multibrot5": "Multibrot d = 5",
    "phoenix": "Phoenix",
}

#: How many batches the moving average spans, centred. Wide enough that a run averaging
#: three admissions a batch has a curve rather than a hedge, and narrow enough that the
#: first quarter's fall is still the picture's own rather than something the window drew.
WINDOW = 81

#: How many parts the run is cut into under the axis. Four, because the sentence this
#: figure stands under is about the first quarter against the last.
QUARTERS = 4

SHEET_WIDTH = 1316
PLOT_LEFT = 74
LEGEND_ROOM = 178
PLOT_RIGHT = SHEET_WIDTH - sheets.PAD - LEGEND_ROOM
PLOT_TOP = sheets.PAD + 92
PLOT_HEIGHT = 366

#: The rank of ink the quartile band under the axis is set in — quieter than the axis
#: labels above it, because it is a reading of the picture rather than part of it.
BAND_INK = sheets.mix(WELL, SECTION_INK, 0.78)


class PipelineError(RuntimeError):
    """Something about a run's walk ledger, or the absence of one."""


@dataclass(frozen=True)
class Run:
    """One run's admissions, read off its ledger and checked against its own summary."""

    name: str
    rows: int
    batches: int
    admitted: dict[str, list[int]]
    identity: dict
    summary: dict

    @property
    def total(self) -> int:
        return sum(sum(series) for series in self.admitted.values())

    def totals(self) -> dict[str, int]:
        return {name: sum(series) for name, series in self.admitted.items()}

    def per_batch(self, first: int, last: int) -> float:
        """Admissions per batch over `[first, last)` — the raw count, never the smoothed."""
        counted = sum(sum(series[first:last]) for series in self.admitted.values())
        return counted / (last - first)


@dataclass(frozen=True)
class Drawn:
    """A composed sheet, and the lines that say how it was made."""

    path: Path
    provenance: list[str]


# -------------------------------------------------------------------------- the records


def partition_of(family: dict) -> str:
    """Which partition a family belongs to, spelled the way the run's summary spells it.

    A Julia set is named for the plane it is cut from, so degree two is `julia:mandelbrot`
    and nothing else in the record says so. This is the one derivation in this module that
    is a restatement of the wallpaper project's own naming, and it is why the bake checks
    its answer against the summary rather than trusting it.
    """
    kind = family.get("kind")
    if kind == "julia":
        degree = int(family.get("degree", 2))
        return "julia:mandelbrot" if degree == 2 else f"julia:multibrot{degree}"
    if kind == "multibrot":
        return f"multibrot{int(family['degree'])}"
    return str(kind)


def load_run(name: str = RUN) -> Run:
    """One run's admissions per batch per partition, streamed off its walk ledger."""
    path = renders.artifact(name, "walk.jsonl")
    if not path.is_file():
        raise PipelineError(f"no walk ledger at {path} — nothing says what run {name} admitted")
    identity: dict = {}
    summary: dict = {}
    counted: dict[str, dict[int, int]] = {one: {} for one in PARTITIONS}
    rows = 0
    with path.open(encoding="utf-8") as handle:
        for line in handle:
            if not line.strip():
                continue
            rows += 1
            row = json.loads(line)
            kind = row.get("kind")
            if kind == "candidate":
                if row.get("fate") != ADMITTED:
                    continue
                partition = partition_of(row["family"])
                if partition not in counted:
                    raise PipelineError(
                        f"{name} admitted a frame in partition {partition!r}, which this "
                        f"chart has no ink and no wording for"
                    )
                batch = int(row["batch"])
                counted[partition][batch] = counted[partition].get(batch, 0) + 1
            elif kind == "run":
                identity = row
            elif kind == "summary":
                summary = row
    if not summary:
        raise PipelineError(f"{name} wrote no summary row, so nothing vouches for the count")
    batches = int(summary["tally"]["batches"])
    admitted = {one: [counted[one].get(batch, 0) for batch in range(batches)] for one in PARTITIONS}
    run = Run(
        name=name,
        rows=rows,
        batches=batches,
        admitted=admitted,
        identity=identity,
        summary=summary,
    )
    _agrees(run)
    return run


def _agrees(run: Run) -> None:
    """The derived tally against the run's own, partition by partition."""
    stated = {
        partition: sum(channel["admitted"] for channel in channels.values())
        for partition, channels in run.summary["tally"]["by_partition"].items()
    }
    derived = {name: count for name, count in run.totals().items() if count}
    if derived != stated:
        wrong = sorted(set(stated) | set(derived))
        detail = ", ".join(
            f"{one}: ledger {derived.get(one, 0)} vs summary {stated.get(one, 0)}"
            for one in wrong
            if derived.get(one, 0) != stated.get(one, 0)
        )
        raise PipelineError(
            f"{run.name}: the admissions read off the candidate rows do not reproduce the "
            f"run's own summary — {detail}"
        )
    if run.total != int(run.summary["tally"]["admitted"]):
        raise PipelineError(
            f"{run.name}: {run.total} admissions read and {run.summary['tally']['admitted']} "
            "in the summary"
        )


# ----------------------------------------------------------------------------- the maths


def smoothed(series: list[int], window: int = WINDOW) -> list[float]:
    """A centred moving average, the window shortened where it runs off either end.

    Shortened rather than padded: a zero-padded window would draw the run starting and
    finishing quieter than it did, and the first quarter against the last is the whole
    reading this figure carries.
    """
    half = window // 2
    running = [0]
    for value in series:
        running.append(running[-1] + value)
    out = []
    for index in range(len(series)):
        low, high = max(0, index - half), min(len(series), index + half + 1)
        out.append((running[high] - running[low]) / (high - low))
    return out


def stacked(run: Run) -> list[list[float]]:
    """The cumulative smoothed series, bottom of the stack first."""
    running = [0.0] * run.batches
    bands = []
    for partition in PARTITIONS:
        smooth = smoothed(run.admitted[partition])
        running = [carried + value for carried, value in zip(running, smooth, strict=True)]
        bands.append(list(running))
    return bands


def quarters(run: Run) -> list[tuple[int, int, float]]:
    """The run cut into four, each as `(first batch, last batch, admissions per batch)`."""
    cut = []
    for index in range(QUARTERS):
        first = index * run.batches // QUARTERS
        last = (index + 1) * run.batches // QUARTERS
        cut.append((first, last, run.per_batch(first, last)))
    return cut


def _ceiling(value: float) -> float:
    """The next whole two above the tallest the stack reaches, so the top line is round."""
    return max(2.0, math.ceil(value / 2) * 2)


# ----------------------------------------------------------------------------- the sheet


def _x(batch: float, batches: int) -> float:
    return PLOT_LEFT + batch / (batches - 1) * (PLOT_RIGHT - PLOT_LEFT)


def _y(value: float, ceiling: float) -> float:
    return PLOT_TOP + PLOT_HEIGHT - value / ceiling * PLOT_HEIGHT


def _grid(draw, ceiling: float, step: float) -> None:
    """Gridlines every `step` admissions, labelled, and the panel's own name above it."""
    face = font(14)
    value = 0.0
    while value <= ceiling + 1e-9:
        y = _y(value, ceiling)
        draw.line([PLOT_LEFT, y, PLOT_RIGHT, y], fill=WELL_RULE, width=1)
        text = f"{value:.0f}"
        draw.text(
            (PLOT_LEFT - 10 - text_width(draw, text, face), y - 8),
            text,
            fill=SECTION_INK,
            font=face,
        )
        value += step
    draw.text(
        (PLOT_LEFT, PLOT_TOP - 24),
        "admissions per batch, smoothed",
        fill=WELL_INK_DIM,
        font=font(15),
    )


def _bands(draw, run: Run, bands: list[list[float]], ceiling: float) -> None:
    """The stack, drawn from the top band down so a lower band is never painted over."""
    for index in range(len(bands) - 1, -1, -1):
        upper = bands[index]
        outline = PARTITION_INK[PARTITIONS[index]]
        fill = sheets.mix(WELL, outline, 0.62)
        points = [(_x(batch, run.batches), _y(value, ceiling)) for batch, value in enumerate(upper)]
        floor = _y(0.0, ceiling)
        draw.polygon([(points[0][0], floor), *points, (points[-1][0], floor)], fill=fill)
        # The band's own ink on its upper edge alone: outlining the polygon would draw a
        # line along the axis as well, and a partition that never admitted anything would
        # come out as a rule across the floor of the chart.
        draw.line([number for point in points for number in point], fill=outline, width=1)


def _axis(draw, run: Run, cut: list[tuple[int, int, float]]) -> None:
    """The batch axis, ticked at the quarter boundaries the band underneath reads off."""
    face = font(14)
    baseline = PLOT_TOP + PLOT_HEIGHT
    marks = [first for first, _, _ in cut] + [run.batches - 1]
    for batch in marks:
        x = _x(batch, run.batches)
        draw.line([x, baseline, x, baseline + 5], fill=WELL_RULE, width=1)
        text = f"{batch:,}"
        draw.text(
            (x - text_width(draw, text, face) / 2, baseline + 10), text, fill=SECTION_INK, font=face
        )
    name = "batch of the run"
    draw.text(
        ((PLOT_LEFT + PLOT_RIGHT) / 2 - text_width(draw, name, face) / 2, baseline + 30),
        name,
        fill=WELL_INK_DIM,
        font=face,
    )


def _quarter_band(draw, run: Run, cut: list[tuple[int, int, float]], top: int) -> None:
    """What each quarter of the run actually admitted, as a rule under its own stretch.

    The raw count and never the smoothed series: the sentence this figure stands under is
    about what the run admitted, and a mean of a moving average is a mean of the window as
    much as of the run.
    """
    face = font(15)
    for first, last, rate in cut:
        left, right = _x(first, run.batches), _x(last - 1, run.batches)
        draw.line([left + 2, top, right - 2, top], fill=BAND_INK, width=1)
        for x in (left + 2, right - 2):
            draw.line([x, top - 4, x, top + 4], fill=BAND_INK, width=1)
        text = f"{rate:.2f} per batch"
        draw.text(
            ((left + right) / 2 - text_width(draw, text, face) / 2, top + 10),
            text,
            fill=SECTION_INK,
            font=face,
        )


def _legend(draw, run: Run) -> None:
    """One row a partition, top of the stack first, each in the ink its band is drawn in."""
    face, small = font(15), font(13)
    totals = run.totals()
    x = PLOT_RIGHT + 16
    for index, partition in enumerate(reversed(PARTITIONS)):
        y = PLOT_TOP + 4 + index * 34
        ink = PARTITION_INK[partition]
        draw.rectangle([x, y + 3, x + 11, y + 14], fill=sheets.mix(WELL, ink, 0.62), outline=ink)
        draw.text((x + 19, y), PARTITION_WORDS[partition], fill=WELL_INK_DIM, font=face)
        draw.text((x + 19, y + 17), f"{totals[partition]:,}", fill=SECTION_INK, font=small)


def yield_decay(name: str = RUN) -> Drawn:
    """`pipeline-yield-decay` — one run's admissions a batch, stacked by partition."""
    run = load_run(name)
    bands = stacked(run)
    cut = quarters(run)
    ceiling = _ceiling(max(bands[-1]))
    step = 2.0 if ceiling <= 16 else 4.0

    baseline = PLOT_TOP + PLOT_HEIGHT
    band_top = baseline + 62
    foot = band_top + 42
    sheet, draw = sheets.canvas(SHEET_WIDTH, foot + 44 + sheets.PAD)

    draw.text(
        (sheets.PAD, sheets.PAD),
        "How much one run of the search admitted, batch by batch",
        fill=WELL_INK,
        font=font(19),
    )
    draw.text(
        (sheets.PAD, sheets.PAD + 28),
        f"every frame the location judge admitted in {run.name}, stacked by the partition "
        f"it was found in",
        fill=WELL_INK_DIM,
        font=font(15),
    )

    _grid(draw, ceiling, step)
    _bands(draw, run, bands, ceiling)
    _axis(draw, run, cut)
    _quarter_band(draw, run, cut, band_top)
    _legend(draw, run)
    _foot(draw, run, cut, foot)

    return Drawn(sheets.save(sheet, sheet_path(FIGURE_ID)), provenance(run, cut))


def _foot(draw, run: Run, cut: list[tuple[int, int, float]], y: int) -> None:
    """What the smoothing was, what the brackets are, and which run this is."""
    face = font(15)
    fall = cut[0][2] / cut[-1][2]
    for offset, note in (
        (
            0,
            f"the curve is a centred moving average over {WINDOW} batches; the brackets under "
            "the axis are the raw count over each quarter of the run",
        ),
        (
            22,
            f"end to end the run admitted {fall:.1f} times as much per batch in its first "
            f"quarter as in its last, over {run.total:,} admissions in {run.batches:,} batches",
        ),
    ):
        draw.text((PLOT_LEFT, y + offset), note, fill=SECTION_INK, font=face)
    stamped = f"{run.name} · seed {run.identity.get('seed')} · {run.summary['stopped']}"
    small = font(13)
    draw.text(
        (PLOT_RIGHT + LEGEND_ROOM - text_width(draw, stamped, small), y + 24),
        stamped,
        fill=sheets.mix(WELL, SECTION_INK, 0.62),
        font=small,
    )


def sheet_path(identifier: str) -> Path:
    SHEETS_DIR.mkdir(parents=True, exist_ok=True)
    return SHEETS_DIR / f"{identifier}.png"


def provenance(run: Run, cut: list[tuple[int, int, float]]) -> list[str]:
    """One line for the chart, one for the run, one for the reading, one for the stack."""
    scoring = run.identity.get("scoring") or {}
    limits = run.identity.get("limits") or {}
    channels = ", ".join(sorted(run.summary["tally"].get("by_channel") or {}))
    totals = run.totals()
    return [
        "Drawn, not rendered: a chart composed by builder.pipeline:yield_decay from "
        f"artifacts/{run.name}/walk.jsonl — {run.rows:,} ledger rows read streamed, of which "
        f"{run.total:,} are admissions. Nothing is rendered and no engine is reached.",
        f"The run: {run.name}, seed {run.identity.get('seed')}, location head "
        f"{run.identity.get('scorer')} at regime {scoring.get('regime')}, batch size "
        f"{limits.get('batch')}, frontier cap {limits.get('frontier_cap')}, breadth floor "
        f"{limits.get('breadth_floor')}. It stopped on {run.summary['stopped']} after "
        f"{run.summary['batches']:,} batches and {run.summary['active_minutes']:.0f} active "
        f"minutes. Its channels were {channels} — the proven channel was off, which is what "
        "the HTML comment beside this figure's block is about.",
        "An admission is a `candidate` row whose fate is `survived`; a row's partition is "
        "derived from its family by builder.pipeline:partition_of, and the nine derived "
        "totals are held to the run's own summary tally before anything is drawn.",
        f"The curve is a centred moving average of admissions per batch over {WINDOW} batches, the "
        "window shortened rather than zero-padded at either end. The brackets under the axis "
        "are the raw count over each quarter, which is what the caption's ratio is taken on.",
        "By quarter, admissions per batch: "
        + " · ".join(f"batches {first:,}–{last - 1:,} {rate:.4f}" for first, last, rate in cut)
        + f" — first quarter over last, {cut[0][2] / cut[-1][2]:.4f}.",
        "By partition, admissions over the whole run: "
        + ", ".join(f"{PARTITION_WORDS[one]} ({one}) {totals[one]:,}" for one in PARTITIONS)
        + ". The stack is drawn in that order from the bottom up and the legend reads it "
        "top down.",
    ]


MAKERS = {FIGURE_ID: yield_decay}


def recipe(identifier: str) -> dict:
    """The registry recipe: the maker, and the run it is pinned to."""
    if identifier not in MAKERS:
        raise records.RecordError(f"{identifier} is not drawn by builder.pipeline")
    return {"maker": f"{__name__}:{MAKERS[identifier].__name__}", "args": {"run": RUN}}


def draw(identifier: str, run: str | None = None) -> Drawn:
    if identifier not in MAKERS:
        raise records.RecordError(f"{identifier} is not drawn by builder.pipeline")
    return MAKERS[identifier](run or RUN)
