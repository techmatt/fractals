"""The figures of *Full pipeline* that are pictures, and one chart it no longer carries.

Two figures are drawn here, both split into panels and both read off the pool study
(`builder/pool_study.py`, whose charts are `growth.py`'s): `pipeline-overview`, the three
parts left to right with the two pools between them, and `pipeline-hue-extremes`, the
shades that pass the judges most and least often. They are described where they are
drawn, below.

`pipeline-yield-decay` is the older chart this module was written for. It left the page
at v4 and its maker stays, as `gallery-pool`'s did, with no row to land on.

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


# ------------------------------------------------------- panels off the pool study

OVERVIEW_ID = "pipeline-overview"
EXTREMES_ID = "pipeline-hue-extremes"

#: The fewest pool candidates a shade leads before its clear rate is ranked. A rate over a
#: handful of pictures is a coin toss dressed as a finding, and a shade the palettes
#: rarely reach is exactly where the handful sits.
MIN_CELL_CANDIDATES = 1000

#: How many shades a row of the extremes figure shows.
EXTREMES_PER_ROW = 5

#: The general gallery the overview's seats come off: `final139_general`, the n = 1000
#: record over the closed pool.
GENERAL_STAMP = "20260922T012627Z"

#: How the overview's four places were chosen, which the records cannot say for
#: themselves. Matt's word (2026-09-25) was that the session picks and he swaps later.
OVERVIEW_SEED = 20260925
OVERVIEW_PLACES = 4
OVERVIEW_COLUMNS = 2
OVERVIEW_RULE = (
    "Which four places is a seeded shuffle of the general gallery's seats (seed "
    f"{OVERVIEW_SEED}), taking the first that clear one spread rule and three refusals. The "
    "spread: no two share a partition, a rendering mode or a main hue. The refusals: a seat "
    "at a location another figure already stands on, a seat or candidate whose run recorded "
    "that the autolevel operator acted without recording the curve, and a place where no "
    "other candidate in another mode was scored by the gallery judge. The middle stage's "
    "picture at a place is the best-scoring such candidate. Chosen by the session on Matt's "
    "instruction, for him to swap later; nothing here was chosen for how it looks."
)

#: What the stages and pools are called, in the words the article already teaches.
STAGES = ("Finding locations", "Finding wallpapers", "Gallery curation")
POOLS = ("Location pool", "Candidate pool")

POOL_SCORES = ("gallery_grade_head", "pool_scores.jsonl")
LEDGER_ROWS = ("curation", "candidate_ledger", "rows.jsonl")


def _about(value: float) -> str:
    """A count rounded to two significant figures, the way the overview states them."""
    value = float(value)
    if value < 100:
        return f"{value:,.0f}"
    digits = int(math.floor(math.log10(value))) - 1
    return f"{round(value, -digits):,.0f}"


def _fine_scores() -> dict[str, float]:
    """The gallery judge's `p_fine` for every candidate it scored, by key."""
    path = renders.artifact(*POOL_SCORES)
    found: dict[str, float] = {}
    with path.open(encoding="utf-8") as handle:
        for line in handle:
            if line.strip():
                row = json.loads(line)
                found[str(row["key"])] = float(row["p_ge4"])
    return found


def _used_elsewhere(identifier: str) -> set[str]:
    """Every frame and record key a figure other than this one stands on."""
    from . import figures as figures_module

    used: set[str] = set()
    for other, figure in figures_module.load_all().items():
        if other != identifier:
            used.update(figure.frames)
    return used


def _frame_of(line: str) -> frozenset[str]:
    """The frames `check`'s `locations` reads out of one provenance line, read the same way."""
    from types import SimpleNamespace

    from . import figures as figures_module

    return figures_module.Figure.frames.fget(SimpleNamespace(provenance=(line,), sources=()))


def _recoverable(pick) -> bool:
    """Whether a render of this pick's recipe is the picture its run made."""
    from . import picks as picks_module

    return picks_module.run_stamp(pick).way != picks_module.UNRECOVERABLE


def _candidate_line(pick) -> str:
    from . import pool as pool_module

    return pool_module._bands_candidate_line(pick)


def hue_extremes(stamp: str | None = None):
    """`pipeline-hue-extremes` — the five shades that clear most and least often.

    A shade is a codebook cell, and a candidate's shade is the first of its ledger
    `cells`, the dominant cell curation reads. Only the forty-eight chromatic cells can
    lead that list, because dominance drops the neutrals. A shade is ranked when it leads
    at least `MIN_CELL_CANDIDATES` pool candidates, and each is shown by its best-scoring
    candidate on the gallery judge, the next best standing in where the best is at a
    location another figure already shows, or one this figure has already used.
    """
    from . import growth as growth_module
    from . import locations as locations_module
    from . import picks as picks_module
    from . import pool as pool_module

    study = growth_module.load_study(stamp)
    cells = study.read("hues.json")["cells"]
    ranked = sorted(
        (
            (tally["cleared"] / tally["candidates"], name)
            for name, tally in cells.items()
            if tally["candidates"] >= MIN_CELL_CANDIDATES
        ),
        key=lambda pair: (-pair[0], pair[1]),
    )
    bands = (ranked[:EXTREMES_PER_ROW], ranked[-EXTREMES_PER_ROW:][::-1])
    used = _used_elsewhere(EXTREMES_ID)
    catalog = renders.mode_catalog()
    size = locations_module.panels(EXTREMES_PER_ROW)
    made = []
    chosen = []
    skipped: list[str] = []
    for title, band in zip(("Most often", "Least often"), bands, strict=True):
        for index, (rate, cell) in enumerate(band):
            best = cells[cell]["best"]
            found = None
            for one, pick in zip(
                best, picks_module.candidates([b["key"] for b in best]), strict=True
            ):
                line = _candidate_line(pick)
                frames = _frame_of(line) | {pick.key}
                if frames & used:
                    skipped.append(f"{cell}: {pick.key} (a location already shown)")
                    continue
                if not _recoverable(pick):
                    skipped.append(f"{cell}: {pick.key} (tone curve not recorded)")
                    continue
                used.update(frames)
                found = (one, pick, line)
                break
            if found is None:
                raise records.RecordError(f"no usable candidate among {cell}'s best {len(best)}")
            one, pick, line = found
            chosen.append((cell, rate, one, pick, line))
            picture = picks_module.panel(pick, f"hue-extremes-{cell}", catalog)
            made.append(
                locations_module.Made(
                    sheets.save(
                        sheets.fitted(picture, size),
                        locations_module.panel_path(EXTREMES_ID, len(made) + 1),
                    ),
                    alt=(
                        f"The best-scoring candidate whose dominant shade is "
                        f"{cell.replace('_', ' ')}: {picks_module.mode_words(pick.mode)}, in "
                        f"the {picks_module.family_name(pick.family)} family."
                    ),
                    label=cell.replace("_", " "),
                    note=f"{rate:.1%} pass",
                    spec=pool_module.mine_link_spec({"recipe": pick.recipe}),
                    band={"title": title, "columns": EXTREMES_PER_ROW} if index == 0 else None,
                )
            )
    provenance = _extremes_provenance(study, cells, ranked, chosen, skipped, size)
    return locations_module.Split(made, provenance, EXTREMES_PER_ROW)


def _extremes_provenance(study, cells, ranked, chosen, skipped, size) -> list[str]:
    from . import growth as growth_module
    from . import picks as picks_module

    thin = sorted(
        (tally["candidates"], name)
        for name, tally in cells.items()
        if tally["candidates"] < MIN_CELL_CANDIDATES
    )
    lines = [
        f"builder.pipeline:hue_extremes — two bands of {EXTREMES_PER_ROW} panels at "
        f"{size[0]}x{size[1]}, read off hues.json of the pool study {study.stamp}.",
        growth_module.study_line(study),
        "A shade is a codebook cell and a candidate's is the first of its ledger colour.cells "
        "(next door's palettes/dominance.py; the neutrals never lead). Its clear rate is the "
        "share of the pool candidates it leads whose gallery-judge p_fine clears the fine "
        f"bar. Ranked: the {len(ranked)} cells leading at least {MIN_CELL_CANDIDATES:,} "
        "candidates; left out as too thin to rank: "
        + (", ".join(f"{name} {count:,}" for count, name in thin) or "none")
        + ". Ranking, highest first: "
        + ", ".join(f"{name} {rate:.2%}" for rate, name in ranked)
        + ".",
        "Each panel is that cell's best candidate by p_fine, drawn from its ledger recipe "
        f"through the engine at {picks_module.PANEL_RENDER[0]}x{picks_module.PANEL_RENDER[1]}, "
        f"supersample {picks_module.PANEL_SUPERSAMPLE}, then fitted to the tile. Passed over "
        "on the way: " + ("; ".join(skipped) or "none") + ".",
        picks_module.autolevel_line([pick for _cell, _rate, _one, pick, _line in chosen]),
    ]
    for cell, rate, one, _pick, line in chosen:
        tally = cells[cell]
        lines.append(
            f"{cell}: {tally['cleared']:,} of {tally['candidates']:,} clear ({rate:.2%}); "
            f"p_fine {one['p_fine']}. {line}"
        )
    return lines


def _ledger_by_location(locations: set[str]) -> dict[str, list[dict]]:
    """Every ledger row at the named locations, in one streamed pass."""
    found: dict[str, list[dict]] = {}
    path = renders.artifact(*LEDGER_ROWS)
    # A location key is itself a JSON string, so on the raw line its quotes are escaped:
    # the cheap filter looks for it as the line spells it, and the parse below decides.
    spelled = [json.dumps(location)[1:-1] for location in locations]
    with path.open(encoding="utf-8") as handle:
        for line in handle:
            if not any(location in line for location in spelled):
                continue
            try:
                row = json.loads(line)
            except json.JSONDecodeError:
                continue
            where = str((row.get("location") or {}).get("key"))
            if where in locations:
                found.setdefault(where, []).append(row)
    return found


def _pick_of(row: dict, picks_module, *, stamp: str | None = None, seat: dict | None = None):
    """A ledger row already in hand, as the `Pick` `picks.resolve` or `candidates` builds."""
    stamp = stamp or picks_module.CANDIDATE_STAMP
    key = str(row["key"])
    return picks_module.Pick(
        identifier=f"{stamp}{picks_module.PICK_SEPARATOR}{key}",
        stamp=stamp,
        key=key,
        seat=dict(seat or {}),
        recipe=row["recipe"],
        source={
            "picture": row.get("picture"),
            "colour": row.get("colour") or {},
            **(row.get("provenance") or {}),
        },
    )


def _general_seats() -> list[dict]:
    path = renders.artifact("curation", "tentative", GENERAL_STAMP, "gallery.jsonl")
    with path.open(encoding="utf-8") as handle:
        return [json.loads(line) for line in handle if line.strip()]


def _spread(seat: dict) -> dict:
    return {
        "partition": seat.get("partition"),
        "mode": seat.get("mode"),
        "hue": seat.get("hue_family"),
    }


def overview(stamp: str | None = None):
    """`pipeline-overview` — the three parts left to right, the two pools between them.

    Four places followed through all three stages: the location as the walk found it, in
    the neutral map; a different candidate the mine drew there; and the wallpaper the
    general gallery seated there. The counts are the bands' words rather than pixels, read
    off the pool study's `counts.json` and rounded to two significant figures.
    """
    import random

    from . import growth as growth_module
    from . import locations as locations_module
    from . import picks as picks_module
    from . import pool as pool_module

    study = growth_module.load_study(stamp)
    counts = study.read("counts.json")
    fine = _fine_scores()
    used = _used_elsewhere(OVERVIEW_ID)
    seats = _general_seats()
    random.Random(OVERVIEW_SEED).shuffle(seats)
    shortlist = [seat for seat in seats if all(_spread(seat).values())][:80]
    rows = _ledger_by_location({str(seat["location"]) for seat in shortlist})
    # Every row at a shortlisted place is in hand after that one pass, the seat's own
    # included, so a pick is built from it rather than streamed for again one at a time.
    by_key = {str(row["key"]): row for held in rows.values() for row in held}

    taken: dict[str, set] = {"partition": set(), "mode": set(), "hue": set()}
    chosen = []
    for seat in shortlist:
        spread = _spread(seat)
        if any(value in taken[name] for name, value in spread.items()):
            continue
        identifier = f"{GENERAL_STAMP}{picks_module.PICK_SEPARATOR}{seat['key']}"
        held = by_key.get(str(seat["key"]))
        if held is None:
            continue
        seated = _pick_of(held, picks_module, stamp=GENERAL_STAMP, seat=seat)
        frames = _frame_of(_candidate_line(seated)) | {seat["key"], identifier}
        if frames & used or not _recoverable(seated):
            continue
        others = sorted(
            (
                (fine[row["key"]], row["key"])
                for row in rows.get(str(seat["location"]), [])
                if row["key"] != seat["key"]
                and row["recipe"]["mode"] != seated.mode
                and row["key"] in fine
            ),
            reverse=True,
        )
        mined = None
        for score, key in others:
            pick = _pick_of(by_key[key], picks_module)
            if key not in used and _recoverable(pick):
                mined = (pick, score)
                break
        if mined is None:
            continue
        chosen.append((seated, *mined))
        used.update(frames | {mined[0].key})
        for name, value in spread.items():
            taken[name].add(value)
        if len(chosen) == OVERVIEW_PLACES:
            break
    if len(chosen) < OVERVIEW_PLACES:
        raise records.RecordError(f"only {len(chosen)} places cleared the overview's rules")

    notes = _overview_notes(counts)
    catalog = renders.mode_catalog()
    size = locations_module.panels(OVERVIEW_COLUMNS * 3)
    made = []
    for stage in range(3):
        for index, (seated, mined, _score) in enumerate(chosen):
            band = None
            if index == 0:
                band = {"title": STAGES[stage], "note": notes[stage * 2], "columns": 2}
                if stage:
                    band["pool"] = {"title": POOLS[stage - 1], "note": notes[stage * 2 - 1]}
            destination = locations_module.panel_path(OVERVIEW_ID, len(made) + 1)
            if stage == 0:
                row = {"family": seated.recipe["family"], "viewport": seated.recipe["viewport"]}
                picture = locations_module.panel(f"overview-place-{index + 1}", row, size)
                made.append(
                    locations_module.Made(
                        sheets.save(sheets.fitted(picture, size), destination),
                        alt="A location the walk found, drawn in one neutral palette.",
                        spec=locations_module.neutral_spec(row),
                        band=band,
                    )
                )
            elif stage == 1:
                picture = picks_module.panel(mined, f"overview-mined-{index + 1}", catalog)
                made.append(
                    locations_module.Made(
                        sheets.save(sheets.fitted(picture, size), destination),
                        alt=(
                            "A candidate mined at the same location, in "
                            f"{picks_module.mode_words(mined.mode)}."
                        ),
                        spec=pool_module.mine_link_spec({"recipe": mined.recipe}),
                        band=band,
                    )
                )
            else:
                picture = picks_module.panel(seated, f"overview-seated-{index + 1}", catalog)
                made.append(
                    locations_module.Made(
                        sheets.save(sheets.fitted(picture, size), destination),
                        alt=(
                            "The wallpaper the general gallery seated at the same location, "
                            f"in {picks_module.mode_words(seated.mode)}."
                        ),
                        seat=seated.identifier,
                        band=band,
                    )
                )
    provenance = _overview_provenance(study, counts, chosen, notes, size)
    return locations_module.Split(made, provenance, OVERVIEW_COLUMNS)


def _overview_notes(counts: dict) -> tuple[str, ...]:
    """Stage, pool, stage, pool, stage: the five lines of words the overview carries."""
    walks, seats, pool = counts["walks"], counts["seats"], counts["pool"]
    mined = (counts.get("ledger_rows_manifest") or {}).get("rows", pool["candidates"])
    return (
        f"about {_about(walks['frames'])} places walked",
        f"about {_about(walks['admitted'])} locations",
        f"about {_about(mined)} candidates mined",
        f"about {_about(pool['candidates'])} candidates, {_about(pool['cleared'])} passing "
        "the judges",
        f"{seats['general']['seats']:,} seats in the general gallery, "
        f"{seats['collection_seats']:,} across the {seats['collections']} collections",
    )


def _overview_provenance(study, counts, chosen, notes, size) -> list[str]:
    from . import growth as growth_module
    from . import picks as picks_module

    walks, seats = counts["walks"], counts["seats"]
    ledger = counts.get("ledger_rows_manifest") or {}
    lines = [
        f"builder.pipeline:overview — three stages left to right, {OVERVIEW_PLACES} panels "
        f"each at {size[0]}x{size[1]}, {OVERVIEW_COLUMNS} across, with the two pools "
        "between them as the page's own text. The same four places run through all three "
        "stages, in the same order.",
        growth_module.study_line(study),
        f"The counts, as drawn: {'; '.join(notes)}. Unrounded: {walks['frames']:,} frames "
        f"evaluated over {walks['ledgers']} walk ledgers, {walks['admitted']:,} locations "
        "in their admitted union (next door's supply.ledgers.admitted_union); "
        f"{ledger.get('rows')} candidate-ledger rows "
        "(data/curation/candidate_ledger/rows.manifest.json); "
        f"{counts['pool']['candidates']:,} in the pool solve.pool() offers and "
        f"{counts['pool']['cleared']:,} of them clearing the fine bar; "
        f"{seats['general']['seats']:,} seats in the general record "
        f"{seats['general']['stamp']}, {seats['collection_seats']:,} across "
        f"{seats['collections']} kept collection records "
        f"({seats['collection_distinct']:,} distinct candidates).",
        OVERVIEW_RULE,
        "Stage 1 draws each place from its seat's own ledger frame at "
        f"{size[0]}x{size[1]}, supersample 3, mode smooth, colormap {renders.COLORMAP}, cap "
        "from the depth-aware policy. Stages 2 and 3 are drawn from ledger recipes through "
        f"the engine at {picks_module.PANEL_RENDER[0]}x{picks_module.PANEL_RENDER[1]}, "
        f"supersample {picks_module.PANEL_SUPERSAMPLE}, then fitted to the tile.",
        picks_module.autolevel_line(
            [pick for seated, mined, _ in chosen for pick in (seated, mined)]
        ),
    ]
    for seated, mined, score in chosen:
        lines.append(f"Seated: {picks_module.frame_line(seated, representative=False)}")
        lines.append(f"Mined there, p_fine {score:.4f}: {_candidate_line(mined)}")
    return lines


def sources(identifier: str) -> list[dict]:
    """The records a split figure's panels are: its seats, and its bare candidates.

    Read back off the maker's own landing rather than kept in a list here, so a redraw
    that chooses differently cites what it drew.
    """
    from . import figures as figures_module

    figure = figures_module.load_all()[identifier]
    seats = [panel.seat for panel in figure.panels if panel.seat]
    seated_keys = {seat.split("|", 1)[1] for seat in seats}
    bare = []
    for line in figure.provenance:
        for marker in ("candidate ledger key ",):
            at = line.find(marker)
            if at != -1:
                key = line[at + len(marker) :].split(",", 1)[0].strip()
                if key not in seated_keys and key not in bare:
                    bare.append(key)
    found = []
    if seats:
        found.append(
            {
                "kind": figures_module.GALLERY_SEAT,
                "keys": seats,
                "drawn": figures_module.OWN_RECIPE,
            }
        )
    if bare:
        found.append({"kind": figures_module.CANDIDATE, "keys": bare})
    return found


MAKERS = {
    FIGURE_ID: yield_decay,
    OVERVIEW_ID: overview,
    EXTREMES_ID: hue_extremes,
}

#: What the bare command draws: the figures a page carries, and not the retired chart.
LANDED = (OVERVIEW_ID, EXTREMES_ID)


def recipe(identifier: str) -> dict:
    """The registry recipe: the maker, and for the yield chart the run it is pinned to."""
    if identifier not in MAKERS:
        raise records.RecordError(f"{identifier} is not drawn by builder.pipeline")
    args = {"run": RUN} if identifier == FIGURE_ID else {}
    return {"maker": f"{__name__}:{MAKERS[identifier].__name__}", "args": args}


def draw(identifier: str, run: str | None = None, stamp: str | None = None):
    if identifier not in MAKERS:
        raise records.RecordError(f"{identifier} is not drawn by builder.pipeline")
    if identifier == FIGURE_ID:
        return MAKERS[identifier](run or RUN)
    return MAKERS[identifier](stamp)
