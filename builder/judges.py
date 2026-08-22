"""The figures of the Training judges page.

Section 5's figures are about a *search*, so `locations.py` reads walk ledgers. This
page's figures are about *verdicts*, so this module reads three things and nothing else:

* the **held-out score files** the wallpaper project commits — one row per evaluation
  picture, carrying the human rating, the whole recipe that made the picture, and the
  head's own `P(≥2)`, `P(≥3)`, `P(≥4)`;
* the **label stores**, joined to those rows, because a score row does not carry the
  iteration cap and a finished-render panel has to be drawn from the row that was rated;
* the judge itself, once, for the one row that has no committed scores — see
  [`SMOOTH_ONES`].

**What a panel prints is an estimate, never a rating.** An ordinal head answers three
yes-or-no questions, and the sum of those three probabilities plus one is its expected
class on the same 1–4 scale a person used. That is what a chip carries: one number, in
the colour of the class it rounds to, so a chip matching its row's colour *is* agreement
and a reader sees the figure's whole claim before reading a word.

**Which four panels a row shows is a rule, not a choice.** Every held-out picture of a
class is sorted by that estimate and the panels are drawn at even quantiles of the
result — so a row shows the class as it actually is, including the disagreements. Four
hand-picked agreements would be a figure about the person who picked them. Where a class
has fewer held-out pictures than the row has cells, the row is short and stays short.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

from . import records, renders, sheets
from .locations import SHEET_WIDTH, Drawn, cache, chip, label_row, location, panels, sheet_path
from .theme import (
    RATING_INK,
    SECTION_INK,
    SEMIBOLD,
    WELL_INK,
    WELL_INK_DIM,
    WELL_RULE,
    font,
    text_width,
)

#: The three judges, and the committed score file each figure reads. A run is named
#: where the head has more than one: the location head ships the all-regimes run, and
#: the mode head ships the four-class one, which are the heads the article describes.
HELD_OUT = {
    "location": ("models", "location", "seed0_all_regimes", "scores.jsonl"),
    "smooth_render": ("models", "smooth_render", "scores.jsonl"),
    "strange_render": ("models", "strange_render", "four_class_seed0", "scores.jsonl"),
}

#: The two heads whose rows are *pictures* rather than places, and so are re-rendered
#: from their own recipe rather than in the neutral map.
FINISHED = frozenset({"smooth_render", "strange_render"})

#: What a grid panel is rendered at before it is fitted into its cell. Twice the cell's
#: width, so the fine texture that decides whether a frame reads as busy survives the
#: shrink. Nothing here needs the geometry the corpus was judged at: the cap is a policy
#: on the frame's width, so the same row at half the pixels is the same picture.
GRID_RENDER = (640, 360)
GRID_SUPERSAMPLE = 2

#: How many cells a class row has when it has the material for them.
GRID_COLUMNS = 4

#: No gloss on the rungs, deliberately. What each class *means* is the previous page's
#: figure and this page's own opening paragraph, in the words a person rated by; a
#: compressed restatement here would be a second definition, and a render rated 1 is
#: rarely the empty black frame that "junk" calls to mind — a flat wash or a garish map
#: is a 1 too. The numeral and its colour name the bucket, and nothing else is claimed.
BAND_LEAD = "rated {score} by hand"

#: Where the wallpaper project leaves the four decision frames, and the record beside
#: them. Under its own ignored `artifacts/` tree, which is where its figure commands are
#: told to write: nothing tracked over there is touched to draw a figure here.
DECISION_FIGURE = ("figures", "judges_score_to_decision")
DECISION_SIDECAR = "frames.jsonl"

#: How each outcome is named on the sheet. The prose names the thresholds; these name
#: what a frame on either side of one becomes, in the page's own words.
DECISION_WORDS = {
    "refused": "refused",
    "expandable": "expandable",
    "find": "a find",
    "exceptional": "exceptional",
}

#: Room under a decision panel: the outcome, then two lines of the numbers behind it.
DECISION_CAPTION = 74


def _decision_frames() -> Path:
    """Where that command's output is, resolved through both storage tiers."""
    return renders.artifact(*DECISION_FIGURE)


# ------------------------------------------------------------------------- the records


def held_out(head: str) -> list[dict]:
    """Every evaluation row of one judge's committed score file, in file order."""
    if head not in HELD_OUT:
        raise records.RecordError(f"{head!r} is not one of {', '.join(sorted(HELD_OUT))}")
    rows = renders.jsonl(renders.data_file(*HELD_OUT[head]))
    return [row for row in rows if row.get("side") == "eval"]


def _identity(row: dict) -> str:
    """What makes two rows verdicts on the same picture, as the store's own join spells it."""
    return json.dumps([row.get(name) for name in renders.FINISHED_IDENTITY], sort_keys=True)


def resolved_store(head: str) -> dict[str, dict]:
    """One finished-render label store, resolved latest-wins and keyed by picture.

    The stores are append-only: a rating that changes is a new row, and the canonical
    reader takes the latest per picture over `recorded_at`, then file, then line. Doing
    the same here is what stops a figure captioning a picture with a superseded verdict —
    the mode store holds both an imported verdict and a later one on all four of its
    held-out class 4s, and reading it by first hit would print the wrong one half the time.
    """
    latest: dict[str, tuple[tuple, dict]] = {}
    for path in sorted(renders.data_file("data", head, "rows").glob("*.jsonl")):
        for line, text in enumerate(path.open(encoding="utf-8"), start=1):
            if not text.strip():
                continue
            row = json.loads(text)
            row["_head"], row["_batch"], row["_line"] = head, path.stem, line
            here = (str(row.get("recorded_at")), path.stem, line)
            key = _identity(row)
            if key not in latest or here > latest[key][0]:
                latest[key] = (here, row)
    return {key: row for key, (_, row) in latest.items()}


def joined(head: str, rows: list[dict]) -> list[dict]:
    """Each score row with the store row it is a verdict on, refusing on any drift.

    Two things come off the store and off nothing else: the cap the picture was drawn to,
    which a score row does not carry, and the *current* rating, which is the one a figure
    is allowed to print.
    """
    store = resolved_store(head)
    found = []
    for row in rows:
        record = store.get(_identity(row))
        if record is None:
            raise renders.EngineError(
                f"{head}: a scored picture is in no row of the label store — the score file "
                "and the store have come apart, and a panel drawn from either would be a "
                "claim the other does not make"
            )
        if record["score"] != row["score"]:
            raise renders.EngineError(
                f"{head}/{record['_batch']}.jsonl line {record['_line']} now scores "
                f"{record['score']}, and the committed score file read it as {row['score']}. "
                "The store resolves latest-wins, so this picture has been re-rated since it "
                "was scored; re-score the head before drawing a figure off it."
            )
        found.append({**row, "_record": record})
    return found


def verdict(row: dict) -> int:
    """The judge's own class for one picture, decoded the way an ordinal head is decoded.

    The head answers three yes-or-no questions — "at least a 2?", "at least a 3?", "at
    least a 4?" — each conditioned on the one before, so the answers cannot contradict
    each other and the class is however many of them came back yes. This is a verdict and
    not a threshold: the pipeline's floors are supply decisions taken elsewhere, and
    printing one under a panel would answer a question this figure is not asking.
    """
    return 1 + sum(1 for step in (2, 3, 4) if float(row[f"p_ge{step}"]) >= 0.5)


def estimate(row: dict) -> float:
    """The head's expected class, which is what a class is *sorted* by here.

    The same three probabilities, summed rather than counted. It is a finer ordering than
    the verdict — two pictures the head calls 3 are not equally 3 — and that is all it is
    used for: which four of a class the figure draws. Nothing is printed from it.
    """
    return 1.0 + sum(float(row[f"p_ge{step}"]) for step in (2, 3, 4))


def by_rating(rows: list[dict]) -> dict[int, list[dict]]:
    """Held-out rows in rating order within each class, sorted by the judge's estimate."""
    grouped: dict[int, list[dict]] = {}
    for row in rows:
        grouped.setdefault(int(row["score"]), []).append(row)
    for found in grouped.values():
        found.sort(key=estimate)
    return grouped


def quantiles(rows: list[dict], count: int) -> list[dict]:
    """`count` rows spread evenly through a sorted class, or all of them if there are fewer.

    Even quantiles rather than the extremes: the ends of a class are its two worst
    disagreements, and a row made of them would say the judge is wrong far more often
    than it is. A row of the middle would say the opposite. This says what the class is.
    """
    if len(rows) <= count:
        return list(rows)
    return [
        rows[min(len(rows) - 1, int((index + 0.5) / count * len(rows)))] for index in range(count)
    ]


# -------------------------------------------------------------------------- the panels


def _grid_panel(head: str, name: str, row: dict, size: tuple[int, int], catalog=None) -> Path:
    """One held-out picture, drawn again from its own record."""
    if head in FINISHED:
        spec = renders.wallpaper_spec(
            row["_record"],
            resolution=GRID_RENDER,
            supersample=GRID_SUPERSAMPLE,
            catalog=catalog,
        )
        return cache().produce(name, "render", spec).path
    return cache().render(name, location(row), GRID_RENDER, supersample=GRID_SUPERSAMPLE).path


# ------------------------------------------------------------------------- the lettering

#: How tall the numeral naming a class row is, and how much room its band needs.
CLASS_NUMERAL = 30
CLASS_BAND = 40

#: The footer that says how to read a chip. One sentence, under every results grid,
#: because a reader meeting the first of the three should not have to find the caption.
LEGEND = (
    "Each panel carries the judge's own class — how many of its three questions came back "
    "yes — in that class's colour, so a chip in the row's colour is the judge agreeing."
)
LEGEND_BAND = 30


def _class_band(draw, y: int, score: int, note: str) -> None:
    """The numeral that names a class row, and the line that says what it holds."""
    face = font(CLASS_NUMERAL, SEMIBOLD)
    draw.text((sheets.PAD, y), str(score), fill=RATING_INK[score], font=face)
    x = sheets.PAD + round(text_width(draw, str(score), face)) + 14
    draw.line([x - 7, y + 4, x - 7, y + CLASS_NUMERAL], fill=RATING_INK[score], width=2)
    draw.text((x, y + 3), BAND_LEAD.format(score=score), fill=WELL_INK, font=font(16))
    draw.text((x, y + 22), note, fill=SECTION_INK, font=font(14))


def _verdict_chip(draw, x: int, y: int, called: int) -> None:
    """The judge's class on a panel: one numeral, in that class's own colour."""
    chip(draw, x, y, f"judge {called}", ink=RATING_INK[called])


def _legend(draw, y: int) -> None:
    draw.text((sheets.PAD, y), LEGEND, fill=WELL_INK_DIM, font=font(14))


# --------------------------------------------------------------------------- the grids


@dataclass(frozen=True)
class Grid:
    """One results figure: which judge, and what its held-out set is called in prose."""

    identifier: str
    head: str
    subject: str


GRIDS = (
    Grid("judges-results-location", "location", "locations"),
    Grid("judges-results-smooth", "smooth_render", "smooth renders"),
    Grid("judges-results-modes", "strange_render", "renders in the other modes"),
)


def results_grid(grid: Grid) -> Drawn:
    """One row per human rating, each panel carrying the judge's own estimate."""
    rows = joined(grid.head, held_out(grid.head)) if grid.head in FINISHED else held_out(grid.head)
    available = by_rating(rows)
    extra = _train_side_ones(grid.head)
    if extra is not None:
        available[1] = extra
    catalog = renders.mode_catalog() if grid.head in FINISHED else None

    size = panels(GRID_COLUMNS)
    order = sorted(available)
    cell = CLASS_BAND + size[1]
    height = sheets.PAD + len(order) * (cell + sheets.PAD) + LEGEND_BAND
    sheet, draw = sheets.canvas(SHEET_WIDTH, height)
    picked: dict[int, list[dict]] = {}
    for index, score in enumerate(order):
        chosen = quantiles(available[score], GRID_COLUMNS)
        picked[score] = chosen
        y = sheets.PAD + index * (cell + sheets.PAD)
        _class_band(draw, y, score, _band_note(grid, score, available[score], chosen))
        for column, row in enumerate(chosen):
            x = sheets.PAD + column * (size[0] + sheets.PAD)
            top = y + CLASS_BAND
            picture = _grid_panel(
                grid.head, f"{grid.identifier}-{score}-{column}", row, size, catalog
            )
            sheet.paste(sheets.fitted(picture, size), (x, top))
            draw.rectangle(
                [x, top, x + size[0] - 1, top + size[1] - 1], outline=RATING_INK[score], width=2
            )
            _verdict_chip(draw, x + 8, top + 8, verdict(row))
    _legend(draw, height - LEGEND_BAND + 6)
    destination = sheets.save(sheet, sheet_path(grid.identifier))
    return Drawn(destination, _grid_provenance(grid, order, available, picked))


def _band_note(grid: Grid, score: int, available: list[dict], chosen: list[dict]) -> str:
    """The quiet line under a class row's numeral: how many, how often, and which four.

    The middle clause is the figure's evidence and the reason a reader can trust the four
    panels: they are a spread of a population, and the population's own agreement rate is
    printed beside them. Four panels alone would be four anecdotes.
    """
    agreed = sum(1 for row in available if verdict(row) == score)
    near = sum(1 for row in available if abs(verdict(row) - score) <= 1)
    read = f"the judge calls {agreed} of them a {score}, and is within one class on {near}"
    if grid.head == SMOOTH_ONES and score == 1:
        where = (
            f"no held-out frame is rated 1, so these are {len(available)} from the "
            f"training side{sheets.MIDDOT}{read}"
        )
    else:
        where = f"{len(available)} held out{sheets.MIDDOT}{read}"
    if len(chosen) < GRID_COLUMNS:
        return f"{where}{sheets.MIDDOT}all of them, with nothing to choose from"
    return f"{where}{sheets.MIDDOT}these four spread evenly across the class"


# --------------------------------------------------------- the one row with no scores

#: The smooth judge's held-out set contains no picture anybody rated 1 — its held-out
#: sheet is a minibrot draw, and a minibrot frame is rarely empty. So the class-1 row is
#: drawn from the training side instead, and it is the one row on this page whose
#: verdicts are not in a committed score file: the judge is read here, through that
#: project's own loader, checkpoint and deploy transform, over the pictures it was
#: trained on. Nothing quantitative is read off the row and the figure says so — what it
#: shows is what a 1 looks like and roughly where this judge puts one.
SMOOTH_ONES = "smooth_render"


def _train_side_ones(head: str) -> list[dict] | None:
    """Every training-side picture rated 1, with this judge's estimate on each."""
    if head != SMOOTH_ONES:
        return None
    held = {_identity(row) for row in held_out(head)}
    wanted = [
        row
        for key, row in sorted(resolved_store(head).items())
        if row["score"] == 1 and key not in held
    ]
    if not wanted:
        raise renders.EngineError(
            f"{head}: no training-side picture is rated 1, and the class-1 row is drawn from them"
        )
    pictures = renders.corpus_crops(head, wanted)
    read = renders.judge_probabilities(head, pictures)
    scored = []
    for row, probabilities in zip(wanted, read, strict=True):
        scored.append({**row, "_record": row, **{key: probabilities[key] for key in PROBABILITIES}})
    scored.sort(key=estimate)
    return scored


#: The three cutpoints a four-class ordinal head answers with.
PROBABILITIES = ("p_ge2", "p_ge3", "p_ge4")


# ------------------------------------------------------- the two single-place figures

#: The location the rating-views figure is drawn at: a hand-rated 4 on the mandelbrot
#: plane, picked because one bold spiral survives both maps legibly — the figure is about
#: what changes between two renders of one place, so a frame whose subject is hard to
#: find in the first place makes the comparison about the frame instead.
RATING_VIEWS_LOCATION = ("guided_descent_rev4", 39)

#: The two maps a location unit is presented in. The names are the wallpaper project's
#: own, from its labeling rig.
CANONICAL_COLORMAP = renders.COLORMAP
VIVID_COLORMAP = "blue_orange"

#: What that rig renders a location unit at. Both panels are drawn at exactly this,
#: because the figure's subject is the pair a person is actually shown.
UNIT_RENDER = (1280, 720)
UNIT_SUPERSAMPLE = 2


def rating_views() -> Drawn:
    """One location as the labeling rig presents it: the judge's map beside a person's.

    Both panels are drawn the same way in everything but the map, which is the point —
    this is a figure about *geometry*, and about what a colormap does to the reading of
    it, rather than about a picture somebody rated.
    """
    row = label_row(*RATING_VIEWS_LOCATION)
    _refuse_unless_rated_four(row, RATING_VIEWS_LOCATION)
    size = panels(2)
    drawn = []
    for name, colormap, lines in (
        (
            "neutral",
            CANONICAL_COLORMAP,
            ["What the judge is shown", "one fixed neutral map, the same for every location"],
        ),
        (
            "vivid",
            VIVID_COLORMAP,
            ["What a person rates from", "a vivid map, for what the geometry could become"],
        ),
    ):
        picture = cache().render(
            f"judges-rating-views-{name}",
            location(row),
            UNIT_RENDER,
            supersample=UNIT_SUPERSAMPLE,
            colormap=colormap,
        )
        drawn.append((picture.path, lines))
    sheet, _ = sheets.panel_grid(drawn, 2, panel=size)
    destination = sheets.save(sheet, sheet_path("judges-rating-views"))
    return Drawn(destination, _views_provenance(row, size))


def _refuse_unless_rated_four(row: dict, where: tuple[str, int]) -> None:
    """A figure that wants a high-quality location uses a frame a person rated 4."""
    if row["score"] != 4:
        raise renders.EngineError(
            f"{where[0]}.jsonl line {where[1]} scores {row['score']}, and this figure wants a "
            "frame a person rated 4 — never a machine pick, however high it scored"
        )


def _views_provenance(row: dict, size: tuple[int, int]) -> list[str]:
    return [
        "One location unit as the wallpaper project's labeling rig presents it — the pair a "
        "person answers one rating from. Both panels are the same frame at "
        f"{UNIT_RENDER[0]}x{UNIT_RENDER[1]}, supersample {UNIT_SUPERSAMPLE}, mode smooth, cap "
        f"from that project's depth-aware policy, fitted to {size[0]}x{size[1]} in the sheet; "
        "nothing differs between them but the colormap.",
        f"Left panel: {_place(row)}, colormap {CANONICAL_COLORMAP} — the canonical map a "
        "location head reads and a location label is stored against.",
        f"Right panel: the same frame, colormap {VIVID_COLORMAP} — the map the rig shows a "
        "person beside it.",
        f"The frame is data/labels/rows/{row['_batch']}.jsonl line {row['_line']}, scored "
        f"{row['score']} by hand on {row['recorded_at']} by {row['labeler']}.",
    ]


#: The location the three-sizes figure is drawn at: another hand-rated 4, and a dense one
#: on purpose. The figure's claim is that composition survives the shrink while texture
#: does not, and a sparse frame makes that claim by having little to lose.
THREE_SIZES_LOCATION = ("correction_page", 215)

#: The three geometries, smallest first, with what each is for. A judge is trained over
#: all three, which is what this figure is about. The order is the prose's — the walk's
#: own render, then the view a score is taken at, then the picture a person rated — and
#: it puts the smallest panel where the eye lands first, which is the figure's subject.
THREE_SIZES = (
    ((384, 216), 1, "What the walk drew and scored", "one sample per pixel, nothing larger"),
    ((640, 360), 2, "What a deployed judge reads", "the canonical view a score is taken at"),
    ((1280, 720), 2, "What a person rated", "the labeling rig's own render"),
)

#: Room under the common baseline for two lines of label.
SIZES_CAPTION = 52


def what_the_judge_sees() -> Drawn:
    """One location at all three of the geometries its judge is trained over, to scale.

    The panels are pasted at their own pixel sizes and share a baseline, so the ratio
    between them *is* the figure — a reader sees that the picture a judge scores is a
    ninth of the picture a person rated before reading either label. Fitting all three
    into equal cells would have drawn the same three pictures and shown nothing.
    """
    row = label_row(*THREE_SIZES_LOCATION)
    _refuse_unless_rated_four(row, THREE_SIZES_LOCATION)
    tallest = max(size[1] for size, _, _, _ in THREE_SIZES)
    width = sheets.PAD + sum(size[0] + sheets.PAD for size, _, _, _ in THREE_SIZES)
    sheet, draw = sheets.canvas(width, sheets.PAD + tallest + SIZES_CAPTION)
    x = sheets.PAD
    for size, supersample, lead, note in THREE_SIZES:
        picture = cache().render(
            f"judges-sizes-{size[0]}-ss{supersample}",
            location(row),
            size,
            supersample=supersample,
        )
        top = sheets.PAD + tallest - size[1]
        sheets.paste(sheet, picture.path, (x, top))
        # A 384-wide panel on a dark well needs an edge, or it reads as a hole in the sheet.
        draw.rectangle([x, top, x + size[0] - 1, top + size[1] - 1], outline=WELL_RULE, width=1)
        sheets.label(
            draw,
            x,
            sheets.PAD + tallest + 8,
            [lead, f"{size[0]}×{size[1]}{sheets.MIDDOT}{note}"],
            size=17,
        )
        x += size[0] + sheets.PAD
    destination = sheets.save(sheet, sheet_path("judges-what-the-judge-sees"))
    return Drawn(destination, _sizes_provenance(row))


def _sizes_provenance(row: dict) -> list[str]:
    lines = [
        "One frame drawn three times, at the three geometries the location judge is trained "
        "over, and pasted at its own pixel size — so the sheet's proportions are the "
        f"geometries themselves. {_place(row)}; mode smooth, colormap {renders.COLORMAP}, cap "
        "from the wallpaper project's depth-aware policy, no crop. The sheet is downscaled "
        "once on import, which is the only resampling any panel sees.",
        f"The frame is data/labels/rows/{row['_batch']}.jsonl line {row['_line']}, scored "
        f"{row['score']} by hand on {row['recorded_at']} by {row['labeler']}.",
    ]
    for size, supersample, lead, _ in THREE_SIZES:
        lines.append(f"Panel: {size[0]}x{size[1]}, supersample {supersample} — {lead.lower()}.")
    return lines


# ---------------------------------------------------------------------- the provenance


def _family_text(family: dict) -> str:
    """A family and its constants, as a provenance line spells them."""
    parts = [family["kind"] + (f" degree {family['degree']}" if "degree" in family else "")]
    for name in ("c", "p", "z_prev"):
        if name in family:
            parts.append(f"{name} = {family[name][0]} + {family[name][1]}i")
    return ", ".join(parts)


def _place(row: dict) -> str:
    """The family and the frame: what it takes to draw a location again."""
    viewport = row["viewport"]
    centre = f"{viewport['center_re']} + {viewport['center_im']}i"
    return f"{_family_text(row['family'])}, centre {centre}, width {viewport['width']}"


def _coloring_text(record: dict) -> str:
    """The whole recipe a finished-render panel was drawn from, off its own row."""
    settings = json.dumps(record["mode_params"]) if record.get("mode_params") else ""
    return (
        f", mode {record['mode']}{(' ' + settings) if settings else ''}, curve "
        f"{record['curve']}, colormap {record['colormap']}, palette "
        f"{json.dumps(record['recipe'])}, cap {record['render']['maxiter']}"
    )


def _grid_provenance(grid: Grid, order, available, picked) -> list[str]:
    """One line per panel, and the preamble saying what all of them share."""
    source = "/".join(HELD_OUT[grid.head])
    counts = sheets.MIDDOT.join(f"{score}: {len(available[score])}" for score in order)
    if grid.head in FINISHED:
        how = (
            "Every panel is re-rendered from its own label-store row — family, frame, mode, "
            "mode settings, curve, colormap, the whole palette recipe and the cap all off the "
            f"row — at {GRID_RENDER[0]}x{GRID_RENDER[1]}, supersample {GRID_SUPERSAMPLE}, then "
            "fitted to the cell. The cap is a policy on the frame's width, so this is the "
            "picture that was judged drawn into fewer pixels, not a different picture."
        )
    else:
        how = (
            f"Every panel is rendered fresh at {GRID_RENDER[0]}x{GRID_RENDER[1]}, supersample "
            f"{GRID_SUPERSAMPLE}, mode smooth, colormap {renders.COLORMAP}, cap from the "
            "wallpaper project's depth-aware policy, no crop beyond the cell's, then fitted "
            "to the cell."
        )
    lines = [
        f"Held-out rows and their verdicts: {source} in the fractal-wallpapers checkout, read "
        f"side=eval. Class counts on the side each row is drawn from: {counts}. Each class is "
        "sorted by the head's expected class, 1 + P(>=2) + P(>=3) + P(>=4), and the panels are "
        f"the rows at even quantiles of that sort: index floor((i + 0.5) / {GRID_COLUMNS} * n) "
        f"for i = 0..{GRID_COLUMNS - 1}. A class with {GRID_COLUMNS} rows or fewer contributes "
        "all of them, and the row stays short. The chip a panel carries is the head's decoded "
        "class — the count of its three cutpoints at or above 0.5 — and not that expectation.",
        how,
    ]
    for score in order:
        for column, row in enumerate(picked[score]):
            record = row.get("_record")
            if record is not None:
                where = f"data/{grid.head}/rows/{record['_batch']}.jsonl line {record['_line']}"
                recipe_text = _coloring_text(record) if grid.head in FINISHED else ""
            else:
                where = f"location_id {row.get('location_id')}, batch {row.get('batch')}"
                recipe_text = ""
            read = sheets.MIDDOT.join(f"{key} {float(row[key]):.4f}" for key in PROBABILITIES)
            lines.append(
                f"Row {score}, panel {column + 1}: {_place(row)}{recipe_text}; {where}; rated "
                f"{row['score']} by hand, judge calls it {verdict(row)} (expected class "
                f"{estimate(row):.3f}) from {read}."
            )
    return lines


# -------------------------------------------------------------------------- the makers


# One named function per results grid rather than a factory: a recipe names its maker as
# `module:function` and `check` resolves it with `getattr`, so a closure with the right
# `__name__` and no name in this module is a recipe that cannot be resolved.


def judges_results_location() -> Drawn:
    """The location judge against its held-out locations."""
    return results_grid(GRIDS[0])


def judges_results_smooth() -> Drawn:
    """The smooth judge against its held-out renders."""
    return results_grid(GRIDS[1])


def judges_results_modes() -> Drawn:
    """The mode judge against its held-out renders."""
    return results_grid(GRIDS[2])


def score_to_decision() -> Drawn:
    """One frame per outcome the location judge's score decides, in score order.

    The frames are the wallpaper project's own — `fractal-wallpapers figures
    judges-score-to-decision` picks one held-out row per outcome from the one partition
    healthy in all four buckets, and renders each as the canonical location view. Picked
    on the head's score, never on the human class, which is why the class a person gave
    is shown beside it rather than used: the find and the exceptional find were both
    rated 4, and the head separates them on P(≥4) alone.

    Nothing is re-rendered here. The pictures are that command's output under its own
    ignored `artifacts/` tree, and this side composes them.
    """
    frames = renders.jsonl(_decision_frames() / DECISION_SIDECAR)
    panel = panels(len(frames))
    sheet, draw = sheets.canvas(SHEET_WIDTH, sheets.PAD + panel[1] + DECISION_CAPTION + sheets.PAD)
    for index, frame in enumerate(frames):
        x = sheets.PAD + index * (panel[0] + sheets.PAD)
        picture = _decision_frames() / f"{index}_{frame['decision']}.jpg"
        sheet.paste(sheets.fitted(picture, panel), (x, sheets.PAD))
        top = sheets.PAD + panel[1] + 6
        draw.text(
            (x, top),
            DECISION_WORDS[frame["decision"]],
            fill=RATING_INK[index + 1],
            font=font(17, SEMIBOLD),
        )
        sheets.label(
            draw,
            x,
            top + 22,
            [
                f"P(≥3) {sheets.number(frame['p_ge3'], 3)}{sheets.MIDDOT}"
                f"P(≥4) {sheets.number(frame['p_ge4'], 3)}",
                f"a person rated it {frame['human_class']}",
            ],
            size=14,
            lead=WELL_INK_DIM,
        )
    provenance = [
        "The four frames the wallpaper project's own `fractal-wallpapers figures "
        "judges-score-to-decision` draws, composed here and not re-rendered. It takes the "
        "shipped location head's held-out rows for one partition and picks the median row "
        "of each outcome bucket by P(≥3), ties by row key; the partition is julia:multibrot3, "
        "the only one with rows in all four buckets. Every panel is the canonical location "
        "view — mode smooth, curve linear, colormap twilight_shifted, 640x360 supersample 2, "
        "maxiter from that project's depth-aware policy — which the command reports as its "
        "`view` record; the sidecar it writes beside the frames does not carry it.",
    ]
    for index, frame in enumerate(frames):
        family = frame["family"]
        view = frame["viewport"]
        provenance.append(
            f"Panel {index + 1} ({frame['decision']}): julia, degree {family['degree']}, "
            f"c = {family['c'][0]} + {family['c'][1]}i, centre {view['center_re']} + "
            f"{view['center_im']}i, width {view['width']}; location {frame['location_id']} of "
            f"batch {frame['batch']}, rated {frame['human_class']} by hand, scored P(≥2) "
            f"{frame['p_ge2']:.6f}, P(≥3) {frame['p_ge3']:.6f}, P(≥4) {frame['p_ge4']:.6f}."
        )
    return Drawn(sheets.save(sheet, sheet_path("judges-score-to-decision")), provenance)


MAKERS = {
    "judges-rating-views": rating_views,
    "judges-what-the-judge-sees": what_the_judge_sees,
    "judges-score-to-decision": score_to_decision,
    "judges-results-location": judges_results_location,
    "judges-results-smooth": judges_results_smooth,
    "judges-results-modes": judges_results_modes,
}


def recipe(identifier: str) -> dict:
    """The registry recipe for a figure of this module: the maker, and no arguments.

    Everything a maker needs — which held-out file, which location, which quantile rule —
    is a named constant beside it, so adjusting a figure is an edit to one line here.
    """
    if identifier not in MAKERS:
        raise records.RecordError(f"{identifier} is not drawn by builder.judges")
    return {"maker": f"{__name__}:{MAKERS[identifier].__name__}", "args": {}}


def draw(identifier: str) -> Drawn:
    """Draw one figure, and write its provenance beside the sheet."""
    drawn = MAKERS[identifier]()
    notes = drawn.path.with_suffix(".provenance.txt")
    with notes.open("w", encoding="utf-8", newline="\n") as handle:
        handle.write("\n".join(drawn.provenance) + "\n")
    return drawn
