"""The figures of *Full pipeline* that are pictures.

Two figures are drawn here, both split into panels and both read off the pool study
(`builder/pool_study.py`, whose charts are `growth.py`'s): `pipeline-overview`, the three
parts left to right with the two pools between them, and `pipeline-hue-extremes`, the
shades that pass the judges most and least often. They are described where they are
drawn, below.

The chart this module was first written for, one run's admissions a batch, left the page
at v4 and went on 2026-09-30 with its maker.
"""

from __future__ import annotations

import json
import math

from . import records, renders, sheets

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
    OVERVIEW_ID: overview,
    EXTREMES_ID: hue_extremes,
}


def recipe(identifier: str) -> dict:
    """The registry recipe: the maker. Neither figure takes an argument."""
    if identifier not in MAKERS:
        raise records.RecordError(f"{identifier} is not drawn by builder.pipeline")
    return {"maker": f"{__name__}:{MAKERS[identifier].__name__}", "args": {}}


def draw(identifier: str, stamp: str | None = None):
    if identifier not in MAKERS:
        raise records.RecordError(f"{identifier} is not drawn by builder.pipeline")
    return MAKERS[identifier](stamp)
