"""The two charts Full pipeline reads off the pool study: what more mining buys, and color.

Every other data figure on this site is a picture, panels the engine drew and arranged on
the well. These two are charts with no render behind them: readings of one measurement,
`builder/pool_study.py`, which asks the solve next door its questions in memory and writes
its answers under this repository's ignored `artifacts/pool-study/<stamp>/`. The bake reads
those rows directly and derives every number on a sheet from them, so a re-run of the study
re-bakes the pictures rather than being transcribed into them.

## `pipeline-growth`: one box a rung

The general gallery at n = 1000, re-solved over random fractions of the pool's visits at
every doubling from 1/64 to the whole pool, three draws a rung below the whole. Each box is
the gallery judge's `p_fine` over **every seat of every draw at that rung**, pooled: the box
is the quartiles, the bar across it the median, and the whiskers run from the lowest seat to
the highest, so no seat is left off the chart as an outlier. The number above a box is how
many seats filled, as the mean of the rung's draws, and the provenance lists each draw.

This replaces a chart of three gallery sizes on a fitted ranking score, drawn while the
pool could not seat more than 200. The pool is closed now (mining closed 2026-09-21), so the
figure is no longer a draft: its numbers move only if the pool does.

## `pipeline-hue-shares`: the clear rate per main hue

A candidate's main hue is the first of its ledger `families`, which is its largest dominant
cell's hue family, the reading curation makes. The twelve families are the codebook's twelve
hues; the four neutrals are not a family, so a candidate dominant in nothing chromatic has no
main hue and no bar. A candidate passes the judges when its `p_fine` clears
`solve.DEFAULT_FINE_BAR`, and one the gallery judge never scored (it scores only what clears
the wallpaper judge) does not pass.
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

#: Where the study writes, one stamped folder a run.
STUDY_DIR = SITE_ROOT / "artifacts" / "pool-study"
STAMPED = re.compile(r"^\d{8}T\d{6}Z$")
SCHEMA = 1

SHEET_WIDTH = 1316
PLOT_LEFT = 84
PLOT_RIGHT = SHEET_WIDTH - sheets.PAD - 24

GROWTH_ID = "pipeline-growth"
HUES_ID = "pipeline-hue-shares"

#: The box's own ink: the site's section ink a step up, so the chart reads as one quantity
#: and nothing in it asks to be told apart by colour.
BOX_INK = (0x9E, 0xC5, 0xFF)
BOX_FILL = sheets.mix(WELL, BOX_INK, 0.24)

#: The codebook's twelve hues in wheel order, which is the order the bars stand in.
HUES = (
    "rose",
    "red",
    "orange",
    "yellow",
    "lime",
    "green",
    "teal",
    "cyan",
    "azure",
    "blue",
    "purple",
    "magenta",
)


class GrowthError(RuntimeError):
    """Something about the pool study's records, or the absence of them."""


@dataclass(frozen=True)
class Study:
    """One stamped run of the pool study: its manifest, and whatever files it wrote."""

    stamp: str
    path: Path
    manifest: dict

    def read(self, name: str):
        path = self.path / name
        if not path.is_file():
            raise GrowthError(f"pool study {self.stamp} carries no {name}")
        if name.endswith(".jsonl"):
            with path.open(encoding="utf-8") as handle:
                return [json.loads(line) for line in handle if line.strip()]
        return json.loads(path.read_text(encoding="utf-8"))


@dataclass(frozen=True)
class Drawn:
    """A composed sheet, and the lines that say how it was made."""

    path: Path
    provenance: list[str]


def load_study(stamp: str | None = None) -> Study:
    """The named study, or the latest whole one — held to carrying a manifest.

    The manifest is written last, so a folder without one is a run that died partway, and
    it is refused rather than skipped: a silent skip would draw an older run under a
    caption claiming this one. A smoke run is never the latest.
    """
    if not STUDY_DIR.is_dir():
        raise GrowthError(f"no pool study at {STUDY_DIR} — run builder/pool_study.py")
    if stamp is None:
        whole = [
            path.name
            for path in sorted(STUDY_DIR.iterdir())
            if path.is_dir()
            and STAMPED.match(path.name)
            and (path / "manifest.json").is_file()
            and not json.loads((path / "manifest.json").read_text(encoding="utf-8"))["smoke"]
        ]
        if not whole:
            raise GrowthError(f"no whole pool study under {STUDY_DIR}")
        stamp = whole[-1]
    path = STUDY_DIR / stamp
    if not (path / "manifest.json").is_file():
        return _first_phase(stamp, path)
    manifest = json.loads((path / "manifest.json").read_text(encoding="utf-8"))
    if manifest.get("schema") != SCHEMA:
        raise GrowthError(f"pool study {stamp} is schema {manifest.get('schema')!r}")
    return Study(stamp=stamp, path=path, manifest=manifest)


def _first_phase(stamp: str, path: Path) -> Study:
    """A study named by hand whose first phase is written and whose solves are not.

    The study writes `counts.json` and `hues.json` before its first solve and the manifest
    after its last, so a figure that reads only the first phase can be drawn while the
    ladder is still running. Only by name: the latest-run default never lands here. The
    header is the first phase's own pool block, the commit is asked of the checkout the
    study imports, and the bar is `explorer.FINE_BAR`, the site's transcription of
    `solve.DEFAULT_FINE_BAR`, which a study that has not finished has not yet stamped.
    """
    import subprocess

    from . import explorer

    counts_path = path / "counts.json"
    if not counts_path.is_file():
        raise GrowthError(f"pool study {stamp} has neither a manifest nor its first phase")
    counts = json.loads(counts_path.read_text(encoding="utf-8"))
    commit = subprocess.run(
        ["git", "-C", str(renders.wallpapers_root()), "rev-parse", "HEAD"],
        capture_output=True,
        text=True,
        check=True,
    ).stdout.strip()
    taken = f"{stamp[0:4]}-{stamp[4:6]}-{stamp[6:8]}T{stamp[9:11]}:{stamp[11:13]}:{stamp[13:15]}Z"
    manifest = {
        "schema": SCHEMA,
        "stamp": stamp,
        "taken_at": taken,
        "wallpapers_commit": commit,
        "fine_bar": explorer.FINE_BAR,
        "pool": counts["pool"],
        "smoke": False,
    }
    return Study(stamp=stamp, path=path, manifest=manifest)


def study_line(study: Study) -> str:
    """The sentence every chart off the study carries: which run, over which pool."""
    pool = study.manifest["pool"]
    return (
        f"The pool study: builder/pool_study.py run {study.stamp}, taken at "
        f"{study.manifest['taken_at']} against wallpapers commit "
        f"{(study.manifest['wallpapers_commit'] or 'unknown')[:12]}, under "
        f"solve.DEFAULT_FINE_BAR {study.manifest['fine_bar']}. The pool solve.pool() offers: "
        f"{pool['candidates']:,} candidates over {pool['locations']:,} locations, "
        f"{pool['cleared']:,} of them clearing the bar, pool stamp {pool['stamp'][:16]}."
    )


# ------------------------------------------------------------------------ the growth box


@dataclass(frozen=True)
class Rung:
    denominator: int
    draws: list[dict]
    values: list[float]

    @property
    def name(self) -> str:
        return "whole pool" if self.denominator == 1 else f"1/{self.denominator}"

    @property
    def filled(self) -> float:
        return sum(draw["filled"] for draw in self.draws) / len(self.draws)

    @property
    def candidates(self) -> float:
        return sum(draw["candidates"] for draw in self.draws) / len(self.draws)

    def quantile(self, share: float) -> float:
        """Nearest-rank, so every number drawn is a seat's own score."""
        held = sorted(self.values)
        index = min(len(held) - 1, max(0, math.ceil(share * len(held)) - 1))
        return held[index]


def rungs(study: Study) -> list[Rung]:
    grouped: dict[int, list[dict]] = {}
    for row in study.read("growth.jsonl"):
        grouped.setdefault(int(row["denominator"]), []).append(row)
    out = []
    for denominator in sorted(grouped, reverse=True):
        draws = grouped[denominator]
        values = [
            float(seat["p_fine"])
            for draw in draws
            for seat in draw["seated"]
            if seat["p_fine"] is not None
        ]
        if not values:
            raise GrowthError(f"rung 1/{denominator} seated nothing with a score")
        out.append(Rung(denominator, draws, values))
    return out


PLOT_TOP = sheets.PAD + 128
PLOT_HEIGHT = 420


def _y(value: float) -> float:
    return PLOT_TOP + PLOT_HEIGHT - value * PLOT_HEIGHT


def what_more_mining_buys(stamp: str | None = None) -> Drawn:
    """`pipeline-growth` — the seated `p_fine` at each fraction of the pool, as boxes."""
    study = load_study(stamp)
    ladder = rungs(study)
    sheet, draw = sheets.canvas(SHEET_WIDTH, PLOT_TOP + PLOT_HEIGHT + 96 + sheets.PAD)
    draw.text(
        (sheets.PAD, sheets.PAD),
        "The gallery judge's scores over a gallery of 1,000, as the pool grows",
        fill=WELL_INK,
        font=font(19),
    )
    draw.text(
        (sheets.PAD, sheets.PAD + 28),
        "the pool re-solved over a random fraction of the visits that made it, three draws "
        "a fraction, every seat of every draw in one box",
        fill=WELL_INK_DIM,
        font=font(15),
    )

    face = font(14)
    for step in range(11):
        value = step / 10
        y = _y(value)
        draw.line([PLOT_LEFT, y, PLOT_RIGHT, y], fill=WELL_RULE, width=1)
        label = f"{value:.1f}"
        draw.text(
            (PLOT_LEFT - 10 - text_width(draw, label, face), y - 8),
            label,
            fill=SECTION_INK,
            font=face,
        )
    draw.text(
        (PLOT_LEFT, PLOT_TOP - 60),
        "gallery judge score of a seat",
        fill=WELL_INK_DIM,
        font=font(15),
    )

    step = (PLOT_RIGHT - PLOT_LEFT) / len(ladder)
    half = min(46, step * 0.28)
    count_face = font(15)
    baseline = PLOT_TOP + PLOT_HEIGHT
    for index, rung in enumerate(ladder):
        x = PLOT_LEFT + step * (index + 0.5)
        low, q1, median, q3, high = (
            min(rung.values),
            rung.quantile(0.25),
            rung.quantile(0.5),
            rung.quantile(0.75),
            max(rung.values),
        )
        draw.line([x, _y(high), x, _y(q3)], fill=BOX_INK, width=2)
        draw.line([x, _y(q1), x, _y(low)], fill=BOX_INK, width=2)
        for end in (low, high):
            draw.line([x - half / 2, _y(end), x + half / 2, _y(end)], fill=BOX_INK, width=2)
        draw.rectangle(
            [x - half, _y(q3), x + half, _y(q1)], fill=BOX_FILL, outline=BOX_INK, width=2
        )
        draw.line([x - half, _y(median), x + half, _y(median)], fill=WELL_INK, width=3)
        seats = f"{round(rung.filled):,}"
        draw.text(
            (x - text_width(draw, seats, count_face) / 2, PLOT_TOP - 30),
            seats,
            fill=WELL_INK_DIM,
            font=count_face,
        )
        for offset, label, ink in (
            (10, rung.name, WELL_INK_DIM),
            (30, f"{_thousands(rung.candidates)} candidates", SECTION_INK),
        ):
            draw.text(
                (x - text_width(draw, label, face) / 2, baseline + offset),
                label,
                fill=ink,
                font=face,
            )
    draw.text(
        (PLOT_LEFT, baseline + 60),
        "fraction of the pool drawn · the number above a box is how many of the 1,000 seats filled",
        fill=SECTION_INK,
        font=font(15),
    )
    return Drawn(sheets.save(sheet, sheet_path(GROWTH_ID)), growth_provenance(study, ladder))


def _thousands(value: float) -> str:
    """A pool size rounded to what a reader holds in their head."""
    if value >= 100_000:
        return f"{round(value / 1000, -1):,.0f}k"
    if value >= 10_000:
        return f"{value / 1000:.0f}k"
    return f"{value / 1000:.1f}k"


def growth_provenance(study: Study, ladder: list[Rung]) -> list[str]:
    """A chart is drawn, not rendered, and the first line says so in those words."""
    lines = [
        "Drawn, not rendered: a chart composed by builder.growth:what_more_mining_buys from "
        f"growth.jsonl of the pool study {study.stamp} — artifacts/pool-study/{study.stamp}/.",
        study_line(study),
        "The ladder: the general gallery at n = 1000, every solve default (the shipped pins, "
        "the cascade key, the fine bar), solved by solve.solve(candidates=...) over the pool "
        "cut to a fraction of its visits — a visit is (location, leg), drawn by next door's "
        "curation.growth.draw and restrict, seeds 11, 22, 33 at every fraction below the "
        "whole pool and the whole pool once. Nothing was written next door.",
        "Each box pools the gallery judge's p_fine (the gallery_grade_head pool score's p_ge4 "
        "column) over every seat of every draw at its fraction: box at the quartiles, bar at "
        "the median, whiskers to the lowest and highest seat, all nearest-rank. The number "
        "above a box is the mean seats filled over its draws.",
    ]
    for rung in ladder:
        draws = "; ".join(
            f"seed {draw['seed']}: {draw['visits']:,} visits, {draw['candidates']:,} "
            f"candidates, {draw['cleared']:,} clear, {draw['filled']:,} seated"
            for draw in rung.draws
        )
        lines.append(
            f"{rung.name}: min {min(rung.values):.4f}, p25 {rung.quantile(0.25):.4f}, median "
            f"{rung.quantile(0.5):.4f}, p75 {rung.quantile(0.75):.4f}, max "
            f"{max(rung.values):.4f} over {len(rung.values):,} seats — {draws}."
        )
    return lines


# ------------------------------------------------------------------------ the hue shares


def hue_rows(study: Study) -> list[tuple[str, int, int]]:
    """`[(hue, candidates, cleared)]` in wheel order, off the study's own tally."""
    families = study.read("hues.json")["families"]
    unknown = set(families) - set(HUES)
    if unknown:
        raise GrowthError(f"the study tallies hue families this chart does not know: {unknown}")
    return [
        (hue, int(families[hue]["candidates"]), int(families[hue]["cleared"]))
        for hue in HUES
        if hue in families
    ]


BAR_TOP = sheets.PAD + 104
BAR_HEIGHT = 360


def hue_shares(stamp: str | None = None) -> Drawn:
    """`pipeline-hue-shares` — how often candidates in each main hue pass the judges."""
    study = load_study(stamp)
    rows = hue_rows(study)
    ink = renders.swatch_colours()
    rates = [cleared / candidates for _hue, candidates, cleared in rows]
    ceiling = math.ceil(max(rates) * 100 / 2) * 2 / 100
    sheet, draw = sheets.canvas(SHEET_WIDTH, BAR_TOP + BAR_HEIGHT + 64 + sheets.PAD)
    draw.text(
        (sheets.PAD, sheets.PAD),
        "How often a candidate passes the judges, by its main hue",
        fill=WELL_INK,
        font=font(19),
    )
    draw.text(
        (sheets.PAD, sheets.PAD + 28),
        "the share of the pool's candidates in each hue that clear the gallery judge's bar",
        fill=WELL_INK_DIM,
        font=font(15),
    )
    face = font(14)
    ticks = round(ceiling * 100)
    stride = 1 if ticks <= 10 else 2
    for percent in range(0, ticks + 1, stride):
        y = BAR_TOP + BAR_HEIGHT - percent / 100 / ceiling * BAR_HEIGHT
        draw.line([PLOT_LEFT, y, PLOT_RIGHT, y], fill=WELL_RULE, width=1)
        label = f"{percent}%"
        draw.text(
            (PLOT_LEFT - 10 - text_width(draw, label, face), y - 8),
            label,
            fill=SECTION_INK,
            font=face,
        )
    step = (PLOT_RIGHT - PLOT_LEFT) / len(rows)
    width = step * 0.66
    base = BAR_TOP + BAR_HEIGHT
    small = font(14)
    for index, ((hue, candidates, _cleared), rate) in enumerate(zip(rows, rates, strict=True)):
        x = PLOT_LEFT + step * index + (step - width) / 2
        top = base - rate / ceiling * BAR_HEIGHT
        colour = ink[f"light_vivid_{hue}"]
        draw.rectangle([x, top, x + width, base], fill=colour)
        count = _thousands(candidates) if candidates >= 1000 else f"{candidates:,}"
        draw.text(
            (x + width / 2 - text_width(draw, count, small) / 2, top - 22),
            count,
            fill=WELL_INK_DIM,
            font=small,
        )
        sheets.centred(draw, x - (step - width) / 2, base + 10, step, hue, font(15), WELL_INK)
    return Drawn(sheets.save(sheet, sheet_path(HUES_ID)), hue_provenance(study, rows))


def hue_provenance(study: Study, rows) -> list[str]:
    tally = study.read("hues.json")
    lines = [
        "Drawn, not rendered: a chart composed by builder.growth:hue_shares from hues.json "
        f"of the pool study {study.stamp} — artifacts/pool-study/{study.stamp}/.",
        study_line(study),
        "A candidate's main hue is the first of its ledger colour.families (its largest "
        "dominant cell's hue family, next door's palettes/dominance.py); it passes when its "
        "gallery-judge p_fine clears the fine bar, and an unscored candidate does not. The "
        "four neutrals are no hue family, so there is no neutral bar: "
        f"{tally['unplaced']['no_family']:,} candidates are dominant in no family and are in "
        "no bar. Each bar is drawn in its hue's light vivid codebook cell; the small number "
        "is its candidate count, rounded.",
        "By hue, cleared/candidates: "
        + ", ".join(
            f"{hue} {cleared:,}/{candidates:,} ({cleared / candidates:.2%})"
            for hue, candidates, cleared in rows
        )
        + ".",
    ]
    return lines


# ------------------------------------------------------------------------------ plumbing


def sheet_path(identifier: str) -> Path:
    SHEETS_DIR.mkdir(parents=True, exist_ok=True)
    return SHEETS_DIR / f"{identifier}.png"


MAKERS = {GROWTH_ID: what_more_mining_buys, HUES_ID: hue_shares}

#: None of these lands as a draft: the pool they read is closed.
DRAFTS: frozenset[str] = frozenset()


def recipe(identifier: str) -> dict:
    """The registry recipe: the maker, and no arguments.

    No stamp is pinned: a re-run of the study is what re-bakes these. Which run was drawn
    goes into the provenance instead, pool stamp and all.
    """
    if identifier not in MAKERS:
        raise records.RecordError(f"{identifier} is not drawn by builder.growth")
    return {"maker": f"{__name__}:{MAKERS[identifier].__name__}", "args": {}}


def draw(identifier: str) -> Drawn:
    if identifier not in MAKERS:
        raise records.RecordError(f"{identifier} is not drawn by builder.growth")
    return MAKERS[identifier]()
