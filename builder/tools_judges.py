"""`tools-judges`: five examples across each judge's range of scores, lowest on the left.

    python -m builder tools tools-judges [--place] [--replace]

Four bands of five, one band per judge in the order the Tools and data page names them —
location, wallpaper, palette, and gallery — each band that judge's 5th, 25th, 50th, 75th
and 95th percentile over **its own population**, the score it gave printed under each
picture as page text. Each example is shown the way its judge sees it: a location in the
one neutral map the location judge reads, a candidate in its own finished colouring, a
palette as the gradient strip of its map, and a gallery candidate drawn exactly as a
gallery seat is drawn.

## Whose scores, and where they are written down

Nothing here runs a judge. Every number is a reading a judge already recorded next door,
read streamed and never through a pool a solve might be holding:

* **location** — `artifacts/curation/supply_scores.jsonl`, the serving location head's one
  reading of every location the walks have offered (the "supply sidecar", one row per
  location key), overlaid by `score_amendments.jsonl` exactly as that project's
  `intake.read_scores` overlays it: a location re-read under the recorded engine build
  takes the re-read. The quantity is `p_ge3`, P(>=3), which is what a walk writes as its
  `score` and what the admission and expansion bars are read on.
* **wallpaper** — `artifacts/curation/candidate_ledger/scores.jsonl`, the rows whose
  `judge_artifact` is the shipped render judge (`models/weights.json`'s `render` sha256) at
  the candidate regime 640x360ss2: one reading per candidate. The quantity is `p_ge4`,
  P(>=4), the column the pool's even-odds gate is on.
* **palette** — `models/palette/seed2_listwise/scores/**.jsonl`, the shipped run's reading
  of the 377 real candidate sets it was accepted on: one utility per candidate map, `score`
  aligned to `candidates`. A utility means something only against the other maps of its
  own set; the population here is every (set, map) reading, pooled, because the brief is
  the judge's whole range.
* **gallery** — `artifacts/gallery_grade_head/pool_scores.jsonl`, the shipped fine head's
  reading of the pool it orders, latest row per key as that project's `read_pool_scores`
  takes it. The quantity is `p_ge4`, which is what that project calls `p_fine(>=4)`.

## Which five, by rule

The percentile is **nearest-rank**: over a population of N sorted ascending, the p-th is
the value at rank ceil(p/100 * N). The example is the member whose score is nearest that
value, ties broken by the record's own name ascending; a member that cannot be drawn and
linked exactly, or whose place another figure on the site already stands on, is skipped for
the next-nearest, and the skips are counted in the record. `select()` is that search, run
once; its answer is frozen in `CHOSEN` below, because the populations grow and a figure
re-picked at draw time would rewrite itself under a caption that had not changed.
"""

from __future__ import annotations

import json
from dataclasses import dataclass

from . import figures as figures_module
from . import frames, links, palettes, renders, sheets
from . import picks as picks_module
from .locations import Made, Split, neutral_spec, node_rows, panel_path, panels

ID = "tools-judges"

#: The percentiles each band shows, lowest on the left.
PERCENTILES = (5, 25, 50, 75, 95)
COLUMNS = len(PERCENTILES)

#: The judges, in band order, as the Training judges page names them.
LOCATION, WALLPAPER, PALETTE, GALLERY = "location", "wallpaper", "palette", "gallery"
JUDGES = (LOCATION, WALLPAPER, PALETTE, GALLERY)
TITLES = {
    LOCATION: "Location judge",
    WALLPAPER: "Wallpaper judge",
    PALETTE: "Palette judge",
    GALLERY: "Gallery judge",
}

# ------------------------------------------------------------------------- the records

#: The location judge's recorded readings: the supply sidecar and its amendment.
SUPPLY = ("curation", "supply_scores.jsonl")
AMENDMENTS = ("curation", "score_amendments.jsonl")
#: The one engine build the amendment file carries readings under, frozen: that project's
#: overlay takes the rows of the build it is running on, and asking the engine its
#: fingerprint costs six renders next door. A file that grows a second build is refused.
AMENDMENT_ENGINE = "5d97e76bb16be71d"
#: The shipped heads, by the sha256 `models/weights.json` names each by.
LOCATION_HEAD = "f8f805119a0ff9612b2076f0edafdb4125f0330b3fd48ace71336f93664851ba"
RENDER_HEAD = "481fe0582328f0de8d64d8e0ddc9a0bde1f044419e2074af6a559239b5792d46"
RENDER_REGIME = "640x360ss2"
#: The wallpaper judge's readings of the candidate ledger.
LEDGER_SCORES = ("curation", "candidate_ledger", "scores.jsonl")
#: The gallery judge's readings of the pool, and the shipped ensemble that wrote them.
POOL_SCORES = ("gallery_grade_head", "pool_scores.jsonl")
GALLERY_RUN = "twelve_sheets_drop_high_asymmetric_auc_ge4_more_k3"
#: The palette judge's readings: the shipped run's own score tree (tracked next door).
PALETTE_SCORES = ("models", "palette", "seed2_listwise", "scores")

#: What each band prints, and the column it reads.
QUANTITY = {LOCATION: "P(≥3)", WALLPAPER: "P(≥4)", PALETTE: "score", GALLERY: "P(≥4)"}

# ------------------------------------------------------------------------ the geometry

#: A picture panel: the house cell at five across, drawn at a seat's own geometry.
PANEL = panels(COLUMNS)
RENDER = picks_module.PANEL_RENDER
#: A strip panel: the same width, at eight to one — the gradient, not a frame of a plane.
STRIP = (PANEL[0], round(PANEL[0] / 8))

# ---------------------------------------------------------------------- the frozen pick

#: `select()`'s answer, read on the day below. Per judge: the population's size, and per
#: percentile the nearest-rank value, the example, its own score and how many nearer
#: members were skipped. Re-run `select()` to re-pick; nothing here re-derives it.
READ_ON = "2026-09-29"
CHOSEN: dict = {
    LOCATION: {
        "population": 226791,
        "examples": [
            {
                "percentile": 5,
                "value": 4.882341435836827e-06,
                "ledger": "overnight_harvest_ckpt123",
                "node": 8862,
                "family": {"kind": "mandelbrot"},
                "viewport": {
                    "center_re": "0.41074053753299294",
                    "center_im": "-0.21449477093617542",
                    "width": "0.0033952646814376557",
                },
                "score": 4.882341435836827e-06,
                "skipped": [],
            },
            {
                "percentile": 25,
                "value": 0.0012706482435075404,
                "ledger": "harvest_run9",
                "node": 2452,
                "family": {"kind": "multibrot", "degree": 3},
                "viewport": {
                    "center_re": "0.14999897195696757",
                    "center_im": "0.7528351483092878",
                    "width": "0.0009689734138988266",
                },
                "score": 0.0012707632114308822,
                "skipped": [
                    "a row of overnight_harvest_ckpt123 with no node id",
                    "a row of harvest_d6s131 with no node id",
                ],
            },
            {
                "percentile": 50,
                "value": 0.05473660052161357,
                "ledger": "harvest_run10",
                "node": 39550,
                "family": {"kind": "multibrot", "degree": 5},
                "viewport": {
                    "center_re": "0.6679562993452354",
                    "center_im": "0.4606725595349496",
                    "width": "0.000015434633308815544",
                },
                "score": 0.05473545436471026,
                "skipped": [
                    "a row of overnight_harvest_ckpt123 with no node id",
                    "a row of reframe_g5 with no node id",
                    "a row of julia_descent_ckpt123 with no node id",
                ],
            },
            {
                "percentile": 75,
                "value": 0.5695645264777288,
                "ledger": "harvest_run10",
                "node": 3712,
                "family": {
                    "kind": "julia",
                    "degree": 2,
                    "c": ["0.23002552265542775", "-0.5282683241239875"],
                },
                "viewport": {
                    "center_re": "0.6483942129427398",
                    "center_im": "0.7931045373748454",
                    "width": "0.005153308865278363",
                },
                "score": 0.5695645264777288,
                "skipped": [],
            },
            {
                "percentile": 95,
                "value": 0.9813259893231517,
                "ledger": "mandelbrot_sourcing",
                "node": 1609,
                "family": {"kind": "mandelbrot"},
                "viewport": {
                    "center_re": "-0.7492678179380668",
                    "center_im": "0.0944173168207033",
                    "width": "0.0000007091262622173049",
                },
                "score": 0.9813241786127688,
                "skipped": ["a row of reframe_g4 with no node id"],
            },
        ],
    },
    WALLPAPER: {
        "population": 566920,
        "examples": [
            {
                "percentile": 5,
                "value": 7.93932813507158e-07,
                "key": "ed28955a8dc13430",
                "score": 7.944759490116916e-07,
                "skipped": [
                    "5096d4f2ab423d68: mode trap_circle, which has no wording here",
                    "821a545d3e6e8229: tone curve not on record",
                    "85557d82d99edf54: tone curve not on record",
                    "031212e9e3e1d2b7: mode gaussian_int, which has no wording here",
                    "d9562f07aadd83b7: tone curve not on record",
                    "9cf05a16c3646974: mode gaussian_int, which has no wording here",
                    "92595708b841cb4c: tone curve not on record",
                    "ea5a667ded8c4262: tone curve not on record",
                    "d3a7e49191778953: mode trap_circle, which has no wording here",
                ],
            },
            {
                "percentile": 25,
                "value": 0.0006086904593837392,
                "key": "7cb2beb322ffe514",
                "score": 0.0006086904593837392,
                "skipped": [],
            },
            {
                "percentile": 50,
                "value": 0.00428342178917246,
                "key": "bdc476d5085f0427",
                "score": 0.00428342178917246,
                "skipped": [],
            },
            {
                "percentile": 75,
                "value": 0.05550474853658405,
                "key": "e87db4f1e4c8d01e",
                "score": 0.05550474853658405,
                "skipped": [],
            },
            {
                "percentile": 95,
                "value": 0.9088164908481661,
                "key": "2c7d54f2b4778e50",
                "score": 0.9088257842494433,
                "skipped": [
                    "ffd2c903c03fe4c0: mode exp_smoothing, which the explorer does not offer",
                    "188ab5c3b317d8cb: tone curve not on record",
                ],
            },
        ],
    },
    PALETTE: {
        "population": 11626,
        "sets": 377,
        "examples": [
            {
                "percentile": 5,
                "value": -1.2850761413574219,
                "set": "colorize-0082",
                "batch": "2026-08-05_wallpaper_colorize_path_v1",
                "partition": "multibrot4",
                "map": "795549-3840x2160-desktop-4k-fractal-background",
                "score": -1.2850761413574219,
                "skipped": [],
            },
            {
                "percentile": 25,
                "value": 1.5079575777053833,
                "set": "minibrot-0113",
                "batch": "2026-08-11_wallpaper_blind_minibrot_v1",
                "partition": "multibrot3",
                "map": "quiet-waiting-25",
                "score": 1.5079575777053833,
                "skipped": [],
            },
            {
                "percentile": 50,
                "value": 3.142144203186035,
                "set": "minibrot-0159",
                "batch": "2026-08-11_wallpaper_blind_minibrot_v1",
                "partition": "mandelbrot",
                "map": "dolphin-dance-25",
                "score": 3.142144203186035,
                "skipped": [],
            },
            {
                "percentile": 75,
                "value": 4.839202880859375,
                "set": "minibrot-0137",
                "batch": "2026-08-11_wallpaper_blind_minibrot_v1",
                "partition": "multibrot3",
                "map": "cmr.swamp",
                "score": 4.839202880859375,
                "skipped": [],
            },
            {
                "percentile": 95,
                "value": 8.145249366760254,
                "set": "minibrot-0017",
                "batch": "2026-08-11_wallpaper_blind_minibrot_v1",
                "partition": "multibrot3",
                "map": "gist_heat",
                "score": 8.145249366760254,
                "skipped": [],
            },
        ],
    },
    GALLERY: {
        "population": 62373,
        "examples": [
            {
                "percentile": 5,
                "value": 5.174657893536408e-05,
                "key": "45bdf025f9ee684a",
                "score": 5.174657893536408e-05,
                "skipped": [],
            },
            {
                "percentile": 25,
                "value": 0.0008505540808685961,
                "key": "6c9dd13f42a0f4be",
                "score": 0.0008505540808685961,
                "skipped": [],
            },
            {
                "percentile": 50,
                "value": 0.006314988099310766,
                "key": "dcef16cbd83ed37e",
                "score": 0.006314988099310766,
                "skipped": [],
            },
            {
                "percentile": 75,
                "value": 0.057990961391565204,
                "key": "17c40ba4bd471be4",
                "score": 0.057990961391565204,
                "skipped": [],
            },
            {
                "percentile": 95,
                "value": 0.4304410361556365,
                "key": "2b88bea0e859f1c3",
                "score": 0.4304410361556365,
                "skipped": [],
            },
        ],
    },
}


class JudgesError(RuntimeError):
    """The figure cannot be drawn or picked as its records describe it."""


# ------------------------------------------------------------------------- the search


@dataclass(frozen=True)
class Member:
    """One recorded reading: its score, the record's own name for it, and the row."""

    score: float
    name: str
    row: dict


def nearest_rank(scores: list[float], percentile: int) -> float:
    """The p-th percentile of an ascending list, nearest-rank: rank ceil(p/100 * N)."""
    rank = -(-percentile * len(scores) // 100)
    return scores[max(rank, 1) - 1]


def by_nearness(members: list[Member], value: float) -> list[Member]:
    """Every member, nearest the value first, ties by the record's own name."""
    return sorted(members, key=lambda one: (abs(one.score - value), one.name))


def _jsonl(path):
    with path.open(encoding="utf-8") as handle:
        for line in handle:
            if line.strip():
                yield json.loads(line)


def location_population() -> list[Member]:
    """The supply sidecar, amended, one member per location key."""
    amended = {}
    for row in _jsonl(renders.artifact(*AMENDMENTS)):
        if row.get("engine") != AMENDMENT_ENGINE:
            raise JudgesError(
                f"score_amendments.jsonl carries a reading under engine {row.get('engine')}; "
                f"this figure was picked under {AMENDMENT_ENGINE} alone. Re-pick it."
            )
        amended[row["key"]] = row
    found = []
    for row in _jsonl(renders.artifact(*SUPPLY)):
        if row.get("head_sha256") != LOCATION_HEAD:
            raise JudgesError(f"a supply row read by {row.get('head_sha256')}, not the shipped one")
        read = amended.get(row["key"], row)
        found.append(Member(float(read["p_ge3"]), row["key"], row))
    return found


def wallpaper_population() -> list[Member]:
    """The candidate ledger as the shipped render judge read it, at the candidate regime."""
    found = []
    for row in _jsonl(renders.artifact(*LEDGER_SCORES)):
        if row.get("judge_artifact") == RENDER_HEAD and row.get("regime") == RENDER_REGIME:
            found.append(Member(float(row["p_ge4"]), str(row["recipe_key"]), row))
    return found


def gallery_population() -> list[Member]:
    """The pool as the shipped fine head read it, latest row per key."""
    latest = {}
    for row in _jsonl(renders.artifact(*POOL_SCORES)):
        if row.get("run") != GALLERY_RUN:
            raise JudgesError(f"pool_scores.jsonl carries run {row.get('run')}, not {GALLERY_RUN}")
        latest[str(row["key"])] = row
    return [Member(float(row["p_ge4"]), key, row) for key, row in latest.items()]


def palette_population() -> list[Member]:
    """Every (set, map) reading of the shipped palette run, aligned by name, never position."""
    found = []
    root = renders.data_file(*PALETTE_SCORES)
    for path in sorted(root.rglob("*.jsonl")):
        for row in _jsonl(path):
            if len(row["candidates"]) != len(row["score"]):
                raise JudgesError(f"{path.name}: set {row['set']} scores a different list")
            for name, score in zip(row["candidates"], row["score"], strict=True):
                found.append(
                    Member(
                        float(score),
                        f"{row['set']}|{name}",
                        {
                            "set": row["set"],
                            "batch": row["source_batch"],
                            "partition": row["partition"],
                            "map": name,
                        },
                    )
                )
    return found


def _taken() -> tuple[set, set]:
    """Every place another figure stands on, and every recipe key another figure cites."""
    registry = {key: one for key, one in figures_module.load_all().items() if key != ID}
    places = set(frames.resolve(registry)["places"])
    cited = set()
    for figure in registry.values():
        for source in figure.sources:
            for key in source.keys:
                if source.kind == figures_module.GALLERY_SEAT:
                    cited.add(str(key).partition(picks_module.PICK_SEPARATOR)[2])
                elif source.kind == figures_module.CANDIDATE:
                    cited.add(str(key))
    return places, cited


def _refused_view(spec: dict, roster: dict, curves: dict) -> str | None:
    """Why the explorer could not open this spec exactly, or `None` where it can."""
    answer = links._view("probe", {}, links.spec_record(spec), "spec", roster, curves)
    return answer.why if isinstance(answer, links.Link) else None


def _location_refusal(member: Member, places: set, roster, curves) -> str | None:
    row = member.row
    ledger = str(row.get("ledger") or "")
    if not ledger.startswith("artifacts/"):
        return f"its ledger {ledger or 'none'} is not an artifacts ledger a source key names"
    if row.get("node_id") is None:
        return "its sidecar row carries no node id, so no source key names it"
    spot = frames.place_of_viewport(row["viewport"])
    if spot in places:
        return "another figure stands on its place"
    why = _refused_view(neutral_spec(row), roster, curves)
    if why:
        return why
    name = ledger.removeprefix("artifacts/").removesuffix("/walk.jsonl")
    try:
        node = node_rows(name, [row["node_id"]])[row["node_id"]]
    except renders.EngineError as error:
        return str(error)
    if node.get("viewport") != row["viewport"] or node.get("family") != row["family"]:
        return "the ledger node's frame is not the sidecar's"
    return None


def _candidate_spec(pick, level: dict | None = None) -> dict:
    """The engine spec a candidate panel is: its ledger recipe whole (see `start.modes`)."""
    recipe = pick.recipe
    spec = {
        "family": pick.family,
        "viewport": recipe["viewport"],
        "mode": pick.mode,
        "mode_params": recipe.get("mode_params") or {},
        "curve": recipe["curve"],
        "colormap": recipe["colormap"],
        "palette": recipe["palette"],
        "maxiter": recipe["maxiter"],
    }
    if level is not None:
        spec["level"] = level
    return spec


def _candidate_refusal(pick, cited: set, roster, curves) -> str | None:
    if pick.key in cited:
        return "another figure cites its recipe key"
    try:
        picks_module.mode_words(pick.mode)
        picks_module.shade_words(pick.recipe["palette"])
        levelling = picks_module.run_stamp(pick)
    except picks_module.PickError as error:
        return str(error)
    if levelling.way == picks_module.UNRECOVERABLE:
        return "the autolevel operator acted and its run kept no curve"
    _, why = links.panel_level(pick)
    if why:
        return why
    return _refused_view(_candidate_spec(pick), roster, curves)


#: How far down the nearest list a candidate band looks before it gives up. Every one of
#: them is read out of the candidate ledger in one streamed pass, so it is bounded.
SHORTLIST = 40


def _pick_candidates(members, values, places, cited, roster, curves) -> list[dict]:
    """The five candidate examples: one ledger pass for every shortlisted key, then the rule."""
    shortlists = [by_nearness(members, value)[:SHORTLIST] for value in values]
    wanted = {one.name for shortlist in shortlists for one in shortlist}
    rows = picks_module.ledger_rows(wanted)
    chosen = []
    for percentile, value, shortlist in zip(PERCENTILES, values, shortlists, strict=True):
        skipped = []
        for member in shortlist:
            row = rows.get(member.name)
            if row is None:
                skipped.append((member.name, "not a row of the candidate ledger"))
                continue
            pick = picks_module.Pick(
                identifier=f"{picks_module.CANDIDATE_STAMP}{picks_module.PICK_SEPARATOR}"
                f"{member.name}",
                stamp=picks_module.CANDIDATE_STAMP,
                key=member.name,
                seat={},
                recipe=row["recipe"],
                source={
                    "picture": row.get("picture"),
                    "colour": row.get("colour") or {},
                    **(row.get("provenance") or {}),
                },
            )
            spots = {
                frames.place_of_location_key(row["location"]["key"]),
                frames.place_of_viewport(row["recipe"]["viewport"]),
            }
            if spots & places:
                skipped.append((member.name, "another figure stands on its place"))
                continue
            why = _candidate_refusal(pick, cited, roster, curves)
            if why:
                skipped.append((member.name, why))
                continue
            places.update(spots)
            chosen.append(
                {
                    "percentile": percentile,
                    "value": value,
                    "key": member.name,
                    "score": member.score,
                    "skipped": [f"{name}: {reason}" for name, reason in skipped],
                }
            )
            break
        else:
            raise JudgesError(
                f"no candidate among the {SHORTLIST} nearest the {percentile}th percentile "
                "clears the rules; widen SHORTLIST"
            )
    return chosen


def select() -> dict:
    """Run the search the figure is frozen from, and return its answer; see the docstring."""
    places, cited = _taken()
    roster = links.baked_palettes()
    curves = links.catalog_curves()
    answer: dict = {"read_on": READ_ON}

    members = location_population()
    scores = sorted(one.score for one in members)
    values = [nearest_rank(scores, p) for p in PERCENTILES]
    chosen = []
    for percentile, value in zip(PERCENTILES, values, strict=True):
        skipped = []
        for member in by_nearness(members, value):
            why = _location_refusal(member, places, roster, curves)
            if why:
                skipped.append(f"{member.name}: {why}")
                continue
            row = member.row
            places.add(frames.place_of_viewport(row["viewport"]))
            chosen.append(
                {
                    "percentile": percentile,
                    "value": value,
                    "ledger": row["ledger"].removeprefix("artifacts/").removesuffix("/walk.jsonl"),
                    "node": row["node_id"],
                    "family": row["family"],
                    "viewport": row["viewport"],
                    "score": member.score,
                    "skipped": skipped,
                }
            )
            break
    answer[LOCATION] = {"population": len(members), "examples": chosen}
    del members

    for judge, read in ((WALLPAPER, wallpaper_population), (GALLERY, gallery_population)):
        members = read()
        scores = sorted(one.score for one in members)
        values = [nearest_rank(scores, p) for p in PERCENTILES]
        picked = _pick_candidates(members, values, places, cited, roster, curves)
        answer[judge] = {"population": len(members), "examples": picked}
        del members

    members = palette_population()
    library = palettes.library()
    scores = sorted(one.score for one in members)
    values = [nearest_rank(scores, p) for p in PERCENTILES]
    chosen, used = [], set()
    for percentile, value in zip(PERCENTILES, values, strict=True):
        skipped = []
        for member in by_nearness(members, value):
            name = member.row["map"]
            if name not in library:
                skipped.append(f"{member.name}: not a map of the library, so no strip")
                continue
            if name in used:
                skipped.append(f"{member.name}: that map is already in this band")
                continue
            used.add(name)
            chosen.append(
                {
                    "percentile": percentile,
                    "value": value,
                    **member.row,
                    "score": member.score,
                    "skipped": skipped,
                }
            )
            break
    answer[PALETTE] = {
        "population": len(members),
        "sets": len({one.row["set"] for one in members}),
        "examples": chosen,
    }
    return answer


# ------------------------------------------------------------------------- the drawing


def score_text(judge: str, value: float) -> str:
    """The number under a panel: the quantity, then three decimals, real minus and all.

    A probability that rounds to nought at three places is printed `<0.001` rather than
    `0.000`, which would read as a judge certain of something it only thinks unlikely.
    """
    if judge != PALETTE and 0 < value < 0.0005:
        return f"{QUANTITY[judge]} <0.001"
    return f"{QUANTITY[judge]} {sheets.number(value, 3)}"


def _examples(judge: str) -> list[dict]:
    held = CHOSEN.get(judge) or {}
    found = held.get("examples") or []
    if [one["percentile"] for one in found] != list(PERCENTILES):
        raise JudgesError(f"{ID}: CHOSEN holds no complete {judge} band; run select()")
    return found


def _band(judge: str) -> dict:
    return {"title": TITLES[judge], "note": _note(judge), "columns": COLUMNS}


#: The line under each band's title: the quantity and the population it is a range of.
NOTES = {
    LOCATION: "P(≥3), over {population:,} places the walks offered it",
    WALLPAPER: "P(≥4), over {population:,} candidate pictures",
    PALETTE: "Its score, over {population:,} palettes in {sets} sets it ranked",
    GALLERY: "P(≥4), over the {population:,} pictures in the pool it orders",
}


def _note(judge: str) -> str:
    held = CHOSEN[judge]
    return NOTES[judge].format(population=held["population"], sets=held.get("sets"))


def _family_words(family: dict) -> str:
    """A family and its constants, the way `check`'s `locations` reads a frame."""
    kind = family["kind"]
    words = f"family {kind}"
    if kind in ("multibrot", "julia"):
        words += f", degree {family.get('degree', 2)}"
    for constant in ("c", "p", "z_prev"):
        if family.get(constant):
            words += f", {constant} = {family[constant][0]} + {family[constant][1]}i"
    return words


def _percentile_words(example: dict) -> str:
    skipped = example["skipped"]
    told = (
        f", {len(skipped)} nearer member(s) skipped ({'; '.join(skipped)})"
        if skipped
        else ", nothing nearer skipped"
    )
    return (
        f"{example['percentile']}th percentile, nearest-rank value {example['value']!r}; "
        f"this example scored {example['score']!r}{told}"
    )


def _location_panels(made: list[Made], lines: list[str]) -> None:
    examples = _examples(LOCATION)
    lines.append(
        f"Location judge, band 1. Population: artifacts/curation/supply_scores.jsonl next door, "
        f"{CHOSEN[LOCATION]['population']:,} rows, one per location key, every one read by the "
        f"shipped location head {LOCATION_HEAD[:12]} (models/weights.json), overlaid by "
        f"score_amendments.jsonl's readings under engine {AMENDMENT_ENGINE} the way the "
        "project's intake.read_scores overlays them. Quantity p_ge3, P(>=3), the walk's own "
        "score. Skipped: a member whose ledger is not an artifacts walk ledger or whose row "
        "carries no node id, so that no source key can name it, whose ledger node does not "
        "carry the sidecar's own frame, whose place "
        "another figure stands on, or that the explorer cannot open exactly. Each panel is "
        f"drawn fresh at {RENDER[0]}x{RENDER[1]}, supersample 3, mode smooth, in the neutral "
        "map the judge reads, cap from the depth policy, and fitted to "
        f"{PANEL[0]}x{PANEL[1]}."
    )
    for index, example in enumerate(examples):
        place = {"family": example["family"], "viewport": example["viewport"]}
        picture = renders.Cache().render(f"{ID}-location-{example['percentile']}", place, RENDER)
        made.append(
            Made(
                sheets.save(
                    sheets.fitted(picture.path, PANEL),
                    panel_path(ID, len(made) + 1),
                    quiet=True,
                ),
                alt=(
                    f"A {picks_module.family_name(example['family'])} location, drawn in one "
                    "neutral palette."
                ),
                label=score_text(LOCATION, example["score"]),
                spec=neutral_spec(place),
                band=_band(LOCATION) if index == 0 else None,
            )
        )
        view = example["viewport"]
        lines.append(
            f"Location panel {index + 1}, {example['ledger']}/walk.jsonl node "
            f"{example['node']}: {_family_words(example['family'])}, centre "
            f"{view['center_re']} + {view['center_im']}i, width {view['width']}, mode smooth, "
            + ("colormap" if index == 0 else "palette")
            + f" {renders.COLORMAP}, maxiter auto (the depth policy); "
            f"{_percentile_words(example)}."
        )


def _candidate_panels(judge: str, made: list[Made], lines: list[str], lead: str) -> None:
    examples = _examples(judge)
    resolved = picks_module.candidates([one["key"] for one in examples])
    picks_module.project_stamps(resolved)
    catalog = renders.mode_catalog()
    lines.append(lead)
    lines.append(_tone_line(resolved))
    for index, (example, pick) in enumerate(zip(examples, resolved, strict=True)):
        picture = picks_module.panel(pick, f"{ID}-{judge}-{example['percentile']}", catalog)
        made.append(
            Made(
                sheets.save(
                    sheets.fitted(picture, PANEL), panel_path(ID, len(made) + 1), quiet=True
                ),
                alt=picks_module.panel_alt(pick),
                label=score_text(judge, example["score"]),
                seat=pick.identifier,
                band=_band(judge) if index == 0 else None,
            )
        )
        lines.append(
            f"{TITLES[judge]} panel {index + 1}, candidate {pick.key} (ledger run "
            f"{pick.source.get('run')}, candidate {pick.source.get('candidate')}) — "
            f"{picks_module.recipe_words(pick, representative=False)}. Drawn at regime "
            f"{pick.recipe['regime']}; {_percentile_words(example)}."
        )


def _tone_line(resolved: list) -> str:
    """What the autolevel operator did to one band's five, read off each run's own record."""
    ways: dict[str, list[str]] = {}
    where = set()
    for pick in resolved:
        levelling = picks_module.run_stamp(pick)
        ways.setdefault(levelling.way, []).append(pick.alias)
        where.add(levelling.where)
    carried = [pick for pick in resolved if pick.recipe.get("autolevel")]
    stamped = sorted({str(pick.recipe["autolevel"].get("operator")) for pick in carried})
    bare = len(resolved) - len(carried)
    return (
        f"Tone: the autolevel stamp on these recipes is {', '.join(stamped) or 'none'}"
        + (f" ({bare} of {len(resolved)} carry no stamp at all)" if bare else "")
        + "; the curve is "
        f"read from each run's own record ({', '.join(sorted(where))}). Replayed through the "
        f"recorded curve: {', '.join(ways.get(picks_module.REPLAYED, [])) or 'none'}. "
        f"Untouched, the engine's own render: {len(ways.get(picks_module.UNTOUCHED, []))}. "
        "A candidate whose run recorded that the operator acted and not the curve was skipped "
        "rather than copied, so every panel here is drawn from its recipe."
    )


def _palette_panels(made: list[Made], lines: list[str]) -> None:
    examples = _examples(PALETTE)
    names = palettes.explorer_names()
    held = CHOSEN[PALETTE]
    lines.append(
        "Palette judge, band 3. Population: models/palette/seed2_listwise/scores/ next door, "
        f"the shipped palette head's run, its reading of {held['sets']} real candidate sets, "
        f"{held['population']:,} (set, map) utilities pooled; a utility is only comparable "
        "inside its own set. Quantity: the head's `score`, aligned to `candidates` by name. "
        "Skipped: a map that is not in the library next door, or one already in this band. "
        f"Each panel is that map's strip, drawn by `fractal-wallpapers palettes strip` at "
        f"{STRIP[0]}x{STRIP[1]}, folded unless the map is cyclic; no render of a plane."
    )
    for index, example in enumerate(examples):
        name = example["map"]
        shown = (names.get(name) or {}).get("name") or name
        strip = palettes.strip(name, *STRIP)
        made.append(
            Made(
                sheets.save(sheets.fitted(strip, STRIP), panel_path(ID, len(made) + 1), quiet=True),
                alt=f"The {shown} palette, as a strip of its colors.",
                label=score_text(PALETTE, example["score"]),
                note=shown,
                band=_band(PALETTE) if index == 0 else None,
            )
        )
        lines.append(
            f"Palette panel {index + 1}, palette {name} ({shown}), a candidate of set "
            f"{example['set']} of {example['batch']}, drawn as a strip; "
            f"{_percentile_words(example)}."
        )


def make() -> Split:
    """The four bands, drawn from `CHOSEN` and nothing re-derived."""
    made: list[Made] = []
    lines = [
        f"builder.tools_judges:make — four bands of {COLUMNS} panels, one band per judge, each "
        f"its {', '.join(f'{p}th' for p in PERCENTILES)} percentile over its own recorded "
        "readings, landed one file a panel. Percentiles are nearest-rank: the value at rank "
        "ceil(p/100 * N) of the N readings sorted ascending. The example is the member whose "
        "score is nearest that value, ties by the record's own name ascending, skipping a "
        "member that cannot be drawn and linked exactly or whose place another figure "
        f"already stands on; chosen by builder.tools_judges.select() on {READ_ON}, never for "
        "how anything looks, and frozen there. No judge was run for this figure.",
    ]
    _location_panels(made, lines)
    _candidate_panels(
        WALLPAPER,
        made,
        lines,
        "Wallpaper judge, band 2. Population: artifacts/curation/candidate_ledger/scores.jsonl "
        f"next door, the {CHOSEN[WALLPAPER]['population']:,} rows read by the shipped render "
        f"judge {RENDER_HEAD[:12]} at regime {RENDER_REGIME}, one per candidate. Quantity "
        "p_ge4, P(>=4). Skipped as well: a candidate whose recipe key another figure cites, "
        "or whose tone curve is not on record. Each panel is the candidate's own ledger "
        f"recipe drawn fresh at {RENDER[0]}x{RENDER[1]}, supersample "
        f"{picks_module.PANEL_SUPERSAMPLE}, through its run's recorded tone curve, and "
        f"fitted to {PANEL[0]}x{PANEL[1]}: exactly as builder.picks draws a seat.",
    )
    _palette_panels(made, lines)
    _candidate_panels(
        GALLERY,
        made,
        lines,
        "Gallery judge, band 4. Population: artifacts/gallery_grade_head/pool_scores.jsonl next "
        f"door, {CHOSEN[GALLERY]['population']:,} pool candidates read by the shipped "
        f"{GALLERY_RUN} ensemble, latest row per key. Quantity p_ge4, P(>=4), the project's "
        "p_fine(>=4). The same skips as the wallpaper band. Each panel is a pool candidate "
        "drawn exactly as builder.picks draws a gallery seat, from its ledger recipe through "
        "its recorded tone curve; the percentile, not a gallery's seating, is what chose it.",
    )
    return Split(made, lines, COLUMNS)


# ------------------------------------------------------------------------ the interface


def sources() -> list[dict]:
    locations = [f"{one['ledger']}/walk.jsonl#{one['node']}" for one in _examples(LOCATION)]
    candidates = [one["key"] for judge in (WALLPAPER, GALLERY) for one in _examples(judge)]
    return [
        {"kind": figures_module.LOCATION, "keys": locations},
        {"kind": figures_module.CANDIDATE, "keys": candidates},
        # The palette strips stand on no record a source kind addresses.
        {"kind": figures_module.SYNTHETIC, "keys": []},
    ]


def recipe() -> dict:
    return {"maker": f"{__name__}:make", "args": {}}


def main() -> int:
    """Print `select()`'s answer as the literal `CHOSEN` is frozen from."""
    answer = select()
    print(json.dumps(answer, indent=1, ensure_ascii=False))
    for judge in JUDGES:
        held = answer[judge]
        read = [(one["percentile"], one["value"], one["score"]) for one in held["examples"]]
        print(judge, held["population"], read)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
