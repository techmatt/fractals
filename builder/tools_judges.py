"""`tools-judges`: one example of each class a judge predicts, and the palette judge's set.

    python -m builder tools tools-judges [--place] [--replace]

Four bands, one per judge — location, wallpaper, gallery, then palette *(tools_bands_ckpt156)*.

**The location, wallpaper and gallery bands are one picture per predicted class.** Each of
those three judges returns P(>=2), P(>=3) and P(>=4) on the 1-to-4 scale, and the class
probabilities are the differences: P(=1) = 1 - P(>=2), P(=2) = P(>=2) - P(>=3),
P(=3) = P(>=3) - P(>=4), P(=4) = P(>=4). The band's k-th panel is a member whose most
likely class is k, labelled with its P(=k) as page text. Each is shown the way its judge
saw it: a location in the one neutral map the location judge reads, at the cap it was read
at, and a candidate in its own finished colouring.

**The palette band is one set** *(deep_judges_fold_ckpt156)*. A palette score means
something only against the other maps of its own set, so the band is one place drawn in
five of one set's maps, at that set's own 5th, 25th, 50th, 75th and 95th percentiles,
lowest on the left.

## Whose readings, and where they are written down

Nothing here runs a judge. Every number is a reading a judge already recorded next door,
read streamed and never through a pool a solve might be holding:

* **location** — `artifacts/curation/supply_scores.jsonl`, the serving location head's one
  reading of every location the walks have offered (the "supply sidecar", one row per
  location key), overlaid by `score_amendments.jsonl` exactly as that project's
  `intake.read_scores` overlays it: a location re-read under the recorded engine build
  takes the re-read.
* **wallpaper** — `artifacts/curation/candidate_ledger/scores.jsonl`, the rows whose
  `judge_artifact` is the shipped render judge (`models/weights.json`'s `render` sha256) at
  the candidate regime 640x360ss2: one reading per candidate.
* **gallery** — `artifacts/gallery_grade_head/pool_scores.jsonl`, the shipped fine head's
  reading of the pool it orders, latest row per key as that project's `read_pool_scores`
  takes it.
* **palette** — `models/palette/seed2_listwise/scores/**.jsonl`, the shipped run's reading
  of the 377 real candidate sets it was accepted on: one utility per candidate map, `score`
  aligned to `candidates`, beside the set's place and grid.

## Which example, by rule

For class k: the members whose most likely class is k (ties to the lower class), and among
them the **window** of P(=k) between its 70th and 90th percentile, nearest-rank (the value
at rank ceil(p/100 * N) of the N sorted ascending), ends included. Confident, and not the
most confident: the point is the range of what a judge calls a k, not its extremes. The
window is put in the order of the records' own names and shuffled by
`random.Random(SEED + k)`; the first member that can be drawn and linked exactly, whose
place no other figure on the site stands on and no earlier panel of this figure took, is
the example, and the ones before it are counted in the record. `select()` is that search,
run once; its answer is frozen in `CHOSEN` below, because the populations grow and a figure
re-picked at draw time would rewrite itself under a caption that had not changed. The
palette band takes its set by `select_palette`'s rule.
"""

from __future__ import annotations

import json
import random
from dataclasses import dataclass

from . import figures as figures_module
from . import frames, links, palettes, renders, sheets
from . import picks as picks_module
from .locations import Made, Split, neutral_spec, node_rows, panel_path, panels

ID = "tools-judges"

#: The classes each scored band shows, lowest on the left.
CLASSES = (1, 2, 3, 4)
#: The window of P(=k) an example is drawn from, as percentiles of that class's own members.
WINDOW = (70, 90)
#: The draw's seed. Class k's window is shuffled by `random.Random(SEED + k)`.
SEED = 20260929
#: The percentiles the palette band shows, lowest on the left.
PERCENTILES = (5, 25, 50, 75, 95)
COLUMNS = len(CLASSES)
PALETTE_COLUMNS = len(PERCENTILES)

#: The judges, in band order.
LOCATION, WALLPAPER, PALETTE, GALLERY = "location", "wallpaper", "palette", "gallery"
JUDGES = (LOCATION, WALLPAPER, GALLERY, PALETTE)
SCORED = (LOCATION, WALLPAPER, GALLERY)
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

# ------------------------------------------------------------------------ the geometry

#: A picture panel: the house cell at four across for a scored band and five across for the
#: palette band, drawn at a seat's own geometry.
PANEL = panels(COLUMNS)
PALETTE_PANEL = panels(PALETTE_COLUMNS)
RENDER = picks_module.PANEL_RENDER

# ---------------------------------------------------------------------- the frozen pick

#: `select()`'s answer, read on the day below. Per scored judge: the population's size,
#: and per class the class's size, its P(=k) window, the example, its four class
#: probabilities and the members of the shuffled window passed over before it. The palette
#: band's set is as `select_palette` found it. Re-run `select()` to re-pick; nothing here
#: re-derives it.
READ_ON = "2026-09-29"
CHOSEN: dict = {
    LOCATION: {
        "population": 226791,
        "examples": [
            {
                "class": 1,
                "class_size": 95067,
                "window": [0.9692998441801876, 0.9958180400217518],
                "probs": [
                    0.9803515325468273,
                    0.019532921027246578,
                    0.00011554642073448255,
                    5.191711895392464e-12,
                ],
                "skipped": {"no node id, so no source key names it": 1},
                "ledger": "harvest_run10",
                "node": 26835,
                "family": {"degree": 5, "kind": "multibrot"},
                "viewport": {
                    "center_re": "0.386742114337409",
                    "center_im": "0.7106705990008451",
                    "width": "0.0008195181771176593",
                },
                "maxiter": 18205,
            },
            {
                "class": 2,
                "class_size": 68691,
                "window": [0.7066222413606261, 0.8090124450212651],
                "probs": [
                    0.2023741792933036,
                    0.7467526702551008,
                    0.05087291600331812,
                    2.344482774913551e-07,
                ],
                "skipped": {"no node id, so no source key names it": 4},
                "ledger": "overnight_harvest_ckpt123",
                "node": 56732,
                "family": {"degree": 5, "kind": "multibrot"},
                "viewport": {
                    "center_re": "0.02407428233816584",
                    "center_im": "0.6050681090925887",
                    "width": "0.0002293947652144274",
                },
                "maxiter": 20409,
            },
            {
                "class": 3,
                "class_size": 48776,
                "window": [0.895861980874603, 0.9712786397688512],
                "probs": [
                    0.006307167218645771,
                    0.061699588000715844,
                    0.9175968847532788,
                    0.014396360027359592,
                ],
                "skipped": {"not an artifacts walk ledger, so no source key names it": 1},
                "ledger": "harvest_run2",
                "node": 9241,
                "family": {
                    "c": ["-0.04483050528988386", "0.6715214031556422"],
                    "degree": 2,
                    "kind": "julia",
                },
                "viewport": {
                    "center_re": "-0.9850054897915694",
                    "center_im": "0.47605013578947475",
                    "width": "0.00552106051969406",
                },
                "maxiter": 14902,
            },
            {
                "class": 4,
                "class_size": 14257,
                "window": [0.9755813180474274, 0.9982146016661704],
                "probs": [
                    0.00020669130327966023,
                    0.0018230882791486769,
                    0.015625084262203992,
                    0.9823451361553677,
                ],
                "skipped": {
                    "not an artifacts walk ledger, so no source key names it": 2,
                    "no node id, so no source key names it": 1,
                },
                "ledger": "harvest_run2",
                "node": 3214,
                "family": {
                    "c": ["0.6754829834227287", "0.43371675798382153"],
                    "degree": 5,
                    "kind": "julia",
                },
                "viewport": {
                    "center_re": "0.5584315705475812",
                    "center_im": "-0.3813951202883029",
                    "width": "0.03536523661660321",
                },
                "maxiter": 11687,
            },
        ],
    },
    WALLPAPER: {
        "population": 566920,
        "examples": [
            {
                "class": 1,
                "class_size": 127516,
                "window": [0.9648266196250996, 0.9974906248901626],
                "probs": [
                    0.979294951702843,
                    0.020704524178948434,
                    5.155848457432741e-07,
                    8.533362832622672e-09,
                ],
                "skipped": {
                    "no wording for mode 'gaussian_int'": 1,
                    "the autolevel operator acted and its run kept no curve": 4,
                },
                "key": "0768d2640a38f5c7",
            },
            {
                "class": 2,
                "class_size": 178318,
                "window": [0.767211738280839, 0.8811307154525027],
                "probs": [
                    0.00972207411749293,
                    0.7806916066092102,
                    0.20727832703331447,
                    0.002307992239982418,
                ],
                "skipped": {
                    "no wording for mode 'smooth_trap_circle'": 1,
                    "no wording for mode 'gaussian_int'": 1,
                    "the autolevel operator acted and its run kept no curve": 1,
                },
                "key": "4a8e387e36b78144",
            },
            {
                "class": 3,
                "class_size": 190094,
                "window": [0.8936931620814774, 0.9707298039225597],
                "probs": [
                    3.756942559485221e-05,
                    0.005488480025732989,
                    0.9555209225443019,
                    0.03895302800437031,
                ],
                "skipped": {"the autolevel operator acted and its run kept no curve": 2},
                "key": "bf63ad8929c9542c",
            },
            {
                "class": 4,
                "class_size": 70992,
                "window": [0.94684242439424, 0.9928160787840752],
                "probs": [
                    2.473498739163915e-08,
                    2.0577627471651816e-05,
                    0.0072259618950749616,
                    0.992753435742466,
                ],
                "skipped": {},
                "key": "0c13c918f771eea4",
            },
        ],
    },
    GALLERY: {
        "population": 62373,
        "examples": [
            {
                "class": 1,
                "class_size": 32669,
                "window": [0.6453613605899584, 0.7786899124380343],
                "probs": [
                    0.7202868976363732,
                    0.26213344882048223,
                    0.017446950690384398,
                    0.00013270285276022602,
                ],
                "skipped": {},
                "key": "693175d004fb8432",
            },
            {
                "class": 2,
                "class_size": 15786,
                "window": [0.4736144842441523, 0.529970370488035],
                "probs": [
                    0.40906411621298255,
                    0.48109431917026985,
                    0.10004233424423635,
                    0.009799230372511231,
                ],
                "skipped": {"the autolevel operator acted and its run kept no curve": 2},
                "key": "de4c6672e35a8fe8",
            },
            {
                "class": 3,
                "class_size": 9058,
                "window": [0.5124270096655215, 0.6345410714995026],
                "probs": [
                    0.10037640389790636,
                    0.31215327351129885,
                    0.5337029522621796,
                    0.053767370328615276,
                ],
                "skipped": {},
                "key": "39b0cf7897e3452a",
            },
            {
                "class": 4,
                "class_size": 4860,
                "window": [0.6054364019751041, 0.780767171621099],
                "probs": [
                    0.04409746663706515,
                    0.1389195960595775,
                    0.18058740009350405,
                    0.6363955372098533,
                ],
                "skipped": {},
                "key": "6f4a4ff456e0f917",
            },
        ],
    },
    #: The palette band as deep_judges_fold_ckpt156 froze it, carried over untouched.
    PALETTE: {
        "population": 377,
        "set": "colorize-0000",
        "batch": "2026-08-05_wallpaper_colorize_path_v1",
        "partition": "mandelbrot",
        "family": {"kind": "mandelbrot"},
        "viewport": {
            "center_re": "0.416430973537498134049060945005",
            "center_im": "-0.327457679053278233172069084786",
            "width": "1.9933817999999997e-09",
        },
        "mode": "smooth",
        "curve": "linear",
        "render": {"resolution": [640, 360], "supersample": 2, "maxiter": 40584},
        "size": 32,
        "examples": [
            {
                "percentile": 5,
                "value": -3.606534719467163,
                "map": "silk-scarves-25",
                "score": -3.606534719467163,
            },
            {
                "percentile": 25,
                "value": 0.604196310043335,
                "map": "cet_rainbow_bgyrm_35_85_c71",
                "score": 0.604196310043335,
            },
            {
                "percentile": 50,
                "value": 2.6398069858551025,
                "map": "RdYlGn",
                "score": 2.6398069858551025,
            },
            {
                "percentile": 75,
                "value": 3.835376739501953,
                "map": "Oranges",
                "score": 3.835376739501953,
            },
            {
                "percentile": 95,
                "value": 5.8483452796936035,
                "map": "OrRd",
                "score": 5.8483452796936035,
            },
        ],
        "skipped": [],
    },
}


class JudgesError(RuntimeError):
    """The figure cannot be drawn or picked as its records describe it."""


# ------------------------------------------------------------------------- the search


@dataclass(frozen=True)
class Member:
    """One recorded reading: its four class probabilities, the record's own name, the row."""

    probs: tuple[float, float, float, float]
    name: str
    row: dict

    @property
    def top(self) -> int:
        """The most likely class, ties to the lower."""
        return max(CLASSES, key=lambda k: (self.probs[k - 1], -k))


def class_probs(row: dict) -> tuple[float, float, float, float]:
    """P(=1..4) from a reading's three cumulative probabilities."""
    ge2, ge3, ge4 = float(row["p_ge2"]), float(row["p_ge3"]), float(row["p_ge4"])
    return (1 - ge2, ge2 - ge3, ge3 - ge4, ge4)


def nearest_rank(scores: list[float], percentile: int) -> float:
    """The p-th percentile of an ascending list, nearest-rank: rank ceil(p/100 * N)."""
    rank = -(-percentile * len(scores) // 100)
    return scores[max(rank, 1) - 1]


def window(members: list[Member], k: int) -> tuple[list[Member], int, float, float]:
    """Class k's window, shuffled by the seed; the class's size; and the window's ends."""
    ours = [one for one in members if one.top == k]
    if not ours:
        raise JudgesError(f"no member's most likely class is {k}")
    values = sorted(one.probs[k - 1] for one in ours)
    low, high = (nearest_rank(values, p) for p in WINDOW)
    inside = sorted(
        (one for one in ours if low <= one.probs[k - 1] <= high), key=lambda one: one.name
    )
    random.Random(SEED + k).shuffle(inside)
    return inside, len(ours), low, high


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
        found.append(Member(class_probs(read), row["key"], row))
    return found


def wallpaper_population() -> list[Member]:
    """The candidate ledger as the shipped render judge read it, at the candidate regime."""
    found = []
    for row in _jsonl(renders.artifact(*LEDGER_SCORES)):
        if row.get("judge_artifact") == RENDER_HEAD and row.get("regime") == RENDER_REGIME:
            found.append(Member(class_probs(row), str(row["recipe_key"]), {}))
    return found


def gallery_population() -> list[Member]:
    """The pool as the shipped fine head read it, latest row per key."""
    latest = {}
    for row in _jsonl(renders.artifact(*POOL_SCORES)):
        if row.get("run") != GALLERY_RUN:
            raise JudgesError(f"pool_scores.jsonl carries run {row.get('run')}, not {GALLERY_RUN}")
        latest[str(row["key"])] = row
    return [Member(class_probs(row), key, {}) for key, row in latest.items()]


def palette_sets() -> list[dict]:
    """The shipped palette run's sets, each whole, in the order of their names."""
    found = []
    for path in sorted(renders.data_file(*PALETTE_SCORES).rglob("*.jsonl")):
        for row in _jsonl(path):
            if len(row["candidates"]) != len(row["score"]):
                raise JudgesError(f"{path.name}: set {row['set']} scores a different list")
            found.append(row)
    return sorted(found, key=lambda row: row["set"])


def palette_spec(row: dict, name: str, library: dict) -> dict:
    """One candidate of a set as the palette judge saw it, in the fields a link reads.

    Next door's `palette_sets.candidate_row`: the set's place, smooth on a linear curve at
    the set's own cap, and the canonical palette pass — every knob the identity, folded
    unless the map is cyclic. The grid is the set's own too, and `_palette_panels` draws at
    it.
    """
    return {
        "family": row["family"],
        "viewport": row["viewport"],
        "mode": row.get("mode", "smooth"),
        "curve": row.get("curve", "linear"),
        "colormap": name,
        "palette": {"mirror": library[name].mirror},
        "maxiter": row["render"]["maxiter"],
    }


def _in_set(row: dict) -> list[tuple[float, str]]:
    """A set's readings, ascending, ties by the map's own name."""
    pairs = zip(row["score"], row["candidates"], strict=True)
    return sorted((float(score), name) for score, name in pairs)


def select_palette(places: set, roster: dict, curves: dict) -> dict:
    """The palette band's set: the first, by name, that can be shown whole.

    Within a set the p-th example is its nearest-rank member, the reading at rank
    ceil(p/100 * N) itself, so no nearness search is needed. A set is passed over where
    another figure stands on its place, where one of its five maps is not in the library,
    or where the explorer cannot open one of the five exactly.
    """
    library = palettes.library()
    skipped = []
    sets = palette_sets()
    for row in sets:
        spot = frames.place_of_viewport(row["viewport"])
        if spot in places:
            skipped.append(f"{row['set']}: another figure stands on its place")
            continue
        ordered = _in_set(row)
        values = [nearest_rank([score for score, _ in ordered], p) for p in PERCENTILES]
        chosen = [next(pair for pair in ordered if pair[0] == value) for value in values]
        missing = [name for _, name in chosen if name not in library]
        if missing:
            skipped.append(f"{row['set']}: {', '.join(missing)} not in the library")
            continue
        why = next(
            (
                f"{name}: {refused}"
                for _, name in chosen
                if (refused := _refused_view(palette_spec(row, name, library), roster, curves))
            ),
            None,
        )
        if why:
            skipped.append(f"{row['set']}: {why}")
            continue
        return {
            "population": len(sets),
            "set": row["set"],
            "batch": row["source_batch"],
            "partition": row["partition"],
            "family": row["family"],
            "viewport": row["viewport"],
            "mode": row.get("mode", "smooth"),
            "curve": row.get("curve", "linear"),
            "render": row["render"],
            "size": len(ordered),
            "examples": [
                {"percentile": p, "value": value, "map": name, "score": score}
                for p, value, (score, name) in zip(PERCENTILES, values, chosen, strict=True)
            ],
            "skipped": skipped,
        }
    raise JudgesError("no palette set can be shown whole")


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


def location_spec(row: dict) -> dict:
    """A location panel's record: the neutral picture at the cap the judge read it at."""
    return {**neutral_spec(row), "maxiter": int(row["maxiter"])}


def brief(reason: str) -> str:
    """A refusal as the record tallies it: the clause before any explanation."""
    return reason.split(" — ")[0]


def tally(reasons: list[str]) -> dict[str, int]:
    """How many members of a shuffled window were passed over, and why, in first-seen order."""
    found: dict[str, int] = {}
    for reason in reasons:
        found[brief(reason)] = found.get(brief(reason), 0) + 1
    return found


def _location_refusal(member: Member, places: set, roster, curves) -> str | None:
    row = member.row
    ledger = str(row.get("ledger") or "")
    if not ledger.startswith("artifacts/"):
        return "not an artifacts walk ledger, so no source key names it"
    if row.get("node_id") is None:
        return "no node id, so no source key names it"
    if not row.get("maxiter"):
        return "no cap"
    spot = frames.place_of_viewport(row["viewport"])
    if spot in places:
        return "place taken"
    why = _refused_view(location_spec(row), roster, curves)
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


#: How far down a class's shuffled window a candidate band looks before it gives up. Every
#: one of them is read out of the candidate ledger in one streamed pass, so it is bounded.
SHORTLIST = 40


def _entry(k: int, size: int, low: float, high: float, member: Member, skipped) -> dict:
    return {
        "class": k,
        "class_size": size,
        "window": [low, high],
        "probs": list(member.probs),
        "skipped": tally(skipped),
    }


def _pick_candidates(members, places, cited, roster, curves) -> list[dict]:
    """One candidate per class: one ledger pass for every shortlisted key, then the rule."""
    windows = {k: window(members, k) for k in CLASSES}
    shortlists = {k: windows[k][0][:SHORTLIST] for k in CLASSES}
    wanted = {one.name for shortlist in shortlists.values() for one in shortlist}
    rows = picks_module.ledger_rows(wanted)
    chosen = []
    for k in CLASSES:
        _, size, low, high = windows[k]
        skipped = []
        for member in shortlists[k]:
            row = rows.get(member.name)
            if row is None:
                skipped.append("not a row of the candidate ledger")
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
                skipped.append("place taken")
                continue
            why = _candidate_refusal(pick, cited, roster, curves)
            if why:
                skipped.append(why)
                continue
            places.update(spots)
            chosen.append({**_entry(k, size, low, high, member, skipped), "key": member.name})
            break
        else:
            raise JudgesError(
                f"no candidate among the first {SHORTLIST} of class {k}'s window clears the "
                "rules; widen SHORTLIST"
            )
    return chosen


def select() -> dict:
    """Run the search the figure is frozen from, and return its answer; see the docstring."""
    places, cited = _taken()
    # The palette band is frozen as it stands, so its place is one this search keeps off.
    places.add(frames.place_of_viewport(CHOSEN[PALETTE]["viewport"]))
    roster = links.baked_palettes()
    curves = links.catalog_curves()
    answer: dict = {"read_on": READ_ON}

    members = location_population()
    chosen = []
    for k in CLASSES:
        inside, size, low, high = window(members, k)
        skipped = []
        for member in inside:
            why = _location_refusal(member, places, roster, curves)
            if why:
                skipped.append(why)
                continue
            row = member.row
            places.add(frames.place_of_viewport(row["viewport"]))
            chosen.append(
                {
                    **_entry(k, size, low, high, member, skipped),
                    "ledger": row["ledger"].removeprefix("artifacts/").removesuffix("/walk.jsonl"),
                    "node": row["node_id"],
                    "family": row["family"],
                    "viewport": row["viewport"],
                    "maxiter": int(row["maxiter"]),
                }
            )
            break
        else:
            raise JudgesError(f"no location in class {k}'s window clears the rules")
    answer[LOCATION] = {"population": len(members), "examples": chosen}
    del members

    for judge, read in ((WALLPAPER, wallpaper_population), (GALLERY, gallery_population)):
        members = read()
        picked = _pick_candidates(members, places, cited, roster, curves)
        answer[judge] = {"population": len(members), "examples": picked}
        del members
    return answer


# ------------------------------------------------------------------------- the drawing


def class_text(example: dict) -> str:
    """The words under a scored panel: its class and that class's probability, two places."""
    k = example["class"]
    return f"P(={k}) {sheets.number(example['probs'][k - 1], 2)}"


def score_text(value: float) -> str:
    """The words under a palette panel: its utility, three places, real minus and all."""
    return f"score {sheets.number(value, 3)}"


def _examples(judge: str) -> list[dict]:
    held = CHOSEN.get(judge) or {}
    found = held.get("examples") or []
    if judge == PALETTE:
        complete = [one["percentile"] for one in found] == list(PERCENTILES)
    else:
        complete = [one["class"] for one in found] == list(CLASSES)
    if not complete:
        raise JudgesError(f"{ID}: CHOSEN holds no complete {judge} band; run select()")
    return found


#: The line under each band's title: the population the band is drawn from.
NOTES = {
    LOCATION: "Over {population:,} places the walks offered it",
    WALLPAPER: "Over {population:,} candidate pictures",
    GALLERY: "Over the {population:,} pictures in the pool it orders",
    PALETTE: "Its score, over one place drawn in the {size} palettes of one set",
}


def _band(judge: str) -> dict:
    held = CHOSEN[judge]
    note = NOTES[judge].format(population=held["population"], size=held.get("size"))
    columns = PALETTE_COLUMNS if judge == PALETTE else COLUMNS
    return {"title": TITLES[judge], "note": note, "columns": columns}


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


def _class_words(example: dict) -> str:
    k = example["class"]
    low, high = example["window"]
    probs = ", ".join(f"P(={n}) {p!r}" for n, p in zip(CLASSES, example["probs"], strict=True))
    skipped = example["skipped"]
    told = (
        f"; {sum(skipped.values())} earlier member(s) of the shuffled window passed over ("
        + "; ".join(f"{reason}: {count}" for reason, count in skipped.items())
        + ")"
        if skipped
        else "; the first of the shuffled window"
    )
    return (
        f"class {k}, one of {example['class_size']:,} members whose most likely class is {k}, "
        f"from the window P(={k}) {low!r} to {high!r}; its readings {probs}{told}"
    )


def _location_panels(made: list[Made], lines: list[str]) -> None:
    examples = _examples(LOCATION)
    lines.append(
        f"Location judge, band 1. Population: artifacts/curation/supply_scores.jsonl next door, "
        f"{CHOSEN[LOCATION]['population']:,} rows, one per location key, every one read by the "
        f"shipped location head {LOCATION_HEAD[:12]} (models/weights.json), overlaid by "
        f"score_amendments.jsonl's readings under engine {AMENDMENT_ENGINE} the way the "
        "project's intake.read_scores overlays them. Skipped: a member whose ledger is not an "
        "artifacts walk ledger or whose row carries no node id, so that no source key can name "
        "it, whose ledger node does not carry the sidecar's own frame, whose place another "
        "figure or an earlier panel stands on, or that the explorer cannot open exactly. Each "
        f"panel is drawn fresh at {RENDER[0]}x{RENDER[1]}, supersample 3, mode smooth, in the "
        "neutral map the judge reads, at the cap the sidecar row records it was read at, and "
        f"fitted to {PANEL[0]}x{PANEL[1]}."
    )
    for index, example in enumerate(examples):
        place = {"family": example["family"], "viewport": example["viewport"]}
        drawn = {**place, "maxiter": example["maxiter"]}
        picture = renders.Cache().render(f"{ID}-location-{example['class']}", drawn, RENDER)
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
                label=class_text(example),
                spec=location_spec({**place, "maxiter": example["maxiter"]}),
                band=_band(LOCATION) if index == 0 else None,
            )
        )
        view = example["viewport"]
        lines.append(
            f"Location panel {index + 1}, {example['ledger']}/walk.jsonl node "
            f"{example['node']}: {_family_words(example['family'])}, centre "
            f"{view['center_re']} + {view['center_im']}i, width {view['width']}, mode smooth, "
            + ("colormap" if index == 0 else "palette")
            + f" {renders.COLORMAP}, maxiter {example['maxiter']}; {_class_words(example)}."
        )


def _candidate_panels(judge: str, made: list[Made], lines: list[str], lead: str) -> None:
    examples = _examples(judge)
    resolved = picks_module.candidates([one["key"] for one in examples])
    picks_module.project_stamps(resolved)
    catalog = renders.mode_catalog()
    lines.append(lead)
    lines.append(_tone_line(resolved))
    for index, (example, pick) in enumerate(zip(examples, resolved, strict=True)):
        picture = picks_module.panel(pick, f"{ID}-{judge}-class{example['class']}", catalog)
        made.append(
            Made(
                sheets.save(
                    sheets.fitted(picture, PANEL), panel_path(ID, len(made) + 1), quiet=True
                ),
                alt=picks_module.panel_alt(pick),
                label=class_text(example),
                seat=pick.identifier,
                band=_band(judge) if index == 0 else None,
            )
        )
        lines.append(
            f"{TITLES[judge]} panel {index + 1}, candidate {pick.key} (ledger run "
            f"{pick.source.get('run')}, candidate {pick.source.get('candidate')}) — "
            f"{picks_module.recipe_words(pick, representative=False)}. Drawn at regime "
            f"{pick.recipe['regime']}; {_class_words(example)}."
        )


def _tone_line(resolved: list) -> str:
    """What the autolevel operator did to one band's panels, read off each run's own record."""
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
    library = palettes.library()
    held = CHOSEN[PALETTE]
    view = held["viewport"]
    grid = held["render"]
    lines.append(
        "Palette judge, band 4. Population: models/palette/seed2_listwise/scores/ next door, "
        f"the shipped palette head's run, its reading of {held['population']} real candidate "
        f"sets; a score is only comparable inside its own set. The band is one set, "
        f"{held['set']} of {held['batch']} ({held['partition']}), {held['size']} candidate "
        "maps on one place, each panel the set's own nearest-rank member at the 5th, 25th, "
        "50th, 75th and 95th percentile of the set's own scores. The set is the first by name "
        "that another figure does not stand on, whose five maps are all in the library, and "
        f"that the explorer opens exactly; {len(held['skipped'])} set(s) before it were "
        "passed over"
        + (f" ({'; '.join(held['skipped'])})" if held["skipped"] else "")
        + f". Every panel: {_family_words(held['family'])}, centre {view['center_re']} + "
        f"{view['center_im']}i, width {view['width']}, mode {held['mode']}, curve "
        f"{held['curve']}, maxiter {grid['maxiter']}, drawn at the set's own "
        f"{grid['resolution'][0]}x{grid['resolution'][1]}, supersample {grid['supersample']}, "
        "through next door's canonical palette pass (palette_sets.candidate_row: gamma 1, "
        "cycles 1, phase 0, no reverse, transfer value, no rolloff, folded unless the map is "
        f"cyclic), and fitted to {PALETTE_PANEL[0]}x{PALETTE_PANEL[1]}: the picture the "
        "judge scored."
    )
    place = {"family": held["family"], "viewport": view}
    shown_in = picks_module.family_name(held["family"])
    for index, example in enumerate(examples):
        name = example["map"]
        shown = (names.get(name) or {}).get("name") or name
        spec = palette_spec(held, name, library)
        # The engine takes a curve inside the mode's coloring, never beside it, and this is
        # how `picks` hands it one: the spec a link reads, spelled the way a render reads.
        drawn = {key: value for key, value in spec.items() if key not in ("mode", "curve")}
        drawn["coloring"] = renders.wallpaper_coloring({**spec, "mode_params": {}})
        picture = renders.Cache().render(
            f"{ID}-palette-{example['percentile']}",
            drawn,
            tuple(grid["resolution"]),
            supersample=grid["supersample"],
        )
        made.append(
            Made(
                sheets.save(
                    sheets.fitted(picture.path, PALETTE_PANEL),
                    panel_path(ID, len(made) + 1),
                    quiet=True,
                ),
                alt=f"The same {shown_in} location, drawn in the {shown} palette.",
                label=score_text(example["score"]),
                note=shown,
                spec=spec,
                band=_band(PALETTE) if index == 0 else None,
            )
        )
        folded = "folded" if library[name].mirror else "unfolded, cyclic"
        lines.append(
            f"Palette panel {index + 1}, {_family_words(place['family'])}, centre "
            f"{view['center_re']} + {view['center_im']}i, width {view['width']}: palette "
            f"{name} ({shown}), {folded}; {example['percentile']}th percentile, nearest-rank "
            f"value {example['value']!r}, this map scored {example['score']!r}."
        )


def make() -> Split:
    """The four bands, drawn from `CHOSEN` and nothing re-derived."""
    made: list[Made] = []
    lines = [
        "builder.tools_judges:make — four bands, one per judge, landed one file a panel. The "
        f"location, wallpaper and gallery bands are {COLUMNS} panels, one per predicted class "
        "1 to 4: class probabilities are the differences of the recorded cumulative ones "
        "(P(=1) = 1 - P(>=2), P(=2) = P(>=2) - P(>=3), P(=3) = P(>=3) - P(>=4), "
        "P(=4) = P(>=4)); class k's example is drawn from the members whose most likely class "
        f"is k, within the {WINDOW[0]}th to {WINDOW[1]}th percentile (nearest-rank) of their "
        "P(=k), the window put in record-name order and shuffled by "
        f"random.Random({SEED} + k), taking the first that can be drawn and linked exactly and "
        "whose place neither another figure nor an earlier panel stands on. The palette band "
        f"is {PALETTE_COLUMNS} maps of one set at that set's own percentiles. Chosen by "
        f"builder.tools_judges.select() on {READ_ON}, never for how anything looks, and "
        "frozen there. No judge was run for this figure.",
    ]
    _location_panels(made, lines)
    _candidate_panels(
        WALLPAPER,
        made,
        lines,
        "Wallpaper judge, band 2. Population: artifacts/curation/candidate_ledger/scores.jsonl "
        f"next door, the {CHOSEN[WALLPAPER]['population']:,} rows read by the shipped render "
        f"judge {RENDER_HEAD[:12]} at regime {RENDER_REGIME}, one per candidate. Skipped as "
        "well: a candidate whose recipe key another figure cites, or whose tone curve is not "
        f"on record. Each panel is the candidate's own ledger recipe drawn fresh at "
        f"{RENDER[0]}x{RENDER[1]}, supersample {picks_module.PANEL_SUPERSAMPLE}, through its "
        f"run's recorded tone curve, and fitted to {PANEL[0]}x{PANEL[1]}: exactly as "
        "builder.picks draws a seat.",
    )
    _candidate_panels(
        GALLERY,
        made,
        lines,
        "Gallery judge, band 3. Population: artifacts/gallery_grade_head/pool_scores.jsonl next "
        f"door, {CHOSEN[GALLERY]['population']:,} pool candidates read by the shipped "
        f"{GALLERY_RUN} ensemble, latest row per key. The same skips as the wallpaper band. "
        "Each panel is a pool candidate drawn exactly as builder.picks draws a gallery seat, "
        "from its ledger recipe through its recorded tone curve; its class, not a gallery's "
        "seating, is what chose it.",
    )
    _palette_panels(made, lines)
    return Split(made, lines, PALETTE_COLUMNS)


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
    return {"maker": f"{__name__}:make", "args": {"seed": SEED, "window": list(WINDOW)}}


def main() -> int:
    """Print `select()`'s answer as the literal `CHOSEN` is frozen from."""
    answer = select()
    print(json.dumps(answer, indent=1, ensure_ascii=False))
    for judge in SCORED:
        held = answer[judge]
        read = [(one["class"], one["probs"][one["class"] - 1]) for one in held["examples"]]
        print(judge, held["population"], read)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
