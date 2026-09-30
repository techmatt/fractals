"""`deep-judges-top15`: each shallow judge's top 15 of the dive candidates, starring Matt's 15.

    python -m builder deep deep-judges-top15 [--place] [--replace]
    python -m builder deep --judge-scores <folder>

*(deep_judges_fold_ckpt156.)* `judge_deep_ckpt156` asked whether the three judges trained on
shallow pictures carry over to depth. It drew every frame of the dive candidate sheet
(`artifacts/dive-reference/deep_minibrot_candidates/`, 817 kept) twice — in the frame's own
link, and in the location judge's neutral recipe — scored both with the shipped heads next
door, and compared their rankings with the 15 frames of `deep-random-dives`. Its addendum
rescored the colour pictures on the leveled scale. None of that is run here: this module
reads the scores the study wrote down.

## The record

`builder/data/deep-judges-scores.jsonl` is the study's scores, one row a frame, promoted out
of the untracked `scratch/judge_deep_ckpt156/` by `--judge-scores` and never rewritten by a
draw. A row is the frame's link, which of Matt's piles it is in (`tier`: `top` for the 15,
`gallery` for another Deep-gallery pick, `unpicked`), its place in the figure where it is one
of the 15 (`pick`), its interior fraction, and five readings:

* `location` — the location judge's P(≥3) of the **neutral** picture;
* `wallpaper` and `gallery` — the wallpaper judge's P(≥4) (next door's `render` head) and the
  gallery judge's `p_fine`, of the picture the frame's own link draws, `scale=absolute`;
* `wallpaper_leveled` and `gallery_leveled` — the same two judges on the addendum's leveled
  and autolevelled recolouring of the same field, kept because the page's claim that a
  recolouring reshuffles those rankings is read off them.

A judge's ranking is its reading, highest first, ties broken by the frame's id ascending.

## The figure

Three bands, three across and five deep: the location, wallpaper and gallery judges' top 15,
each labelled by its rank and starred where it is one of Matt's 15. Those 15 are not a band of
their own *(deep_fold_micro_ckpt156)*: they are `deep-random-dives`, the figure directly above
the fold, and the caption points there rather than showing them twice. **Every panel is a
Deep-tab link and draws exactly its picture**, at the grid the judges read, 640 by 360 at 2x2:

* the wallpaper and gallery bands are the frame's own link, the absolute colouring those
  judges scored;
* the location band is the **neutral** link — the frame, its cap, `p=twilight_shifted` and
  `scale=leveled` and nothing else — which the Deep contract spells exactly, because its
  defaults (cycles 1, phase 0, no mirror, the 0.5/99.5 stretch, black interior) are the
  location judge's own recipe (`judge_deep_ckpt156`'s report, *Render*);
* a starred panel is one of `deep_figures.RANDOM_DIVES`, the links of the figure above.
  Fourteen are the candidate's link; pick 3 was recoloured by Matt, so the wallpaper and
  gallery bands, which show what was scored, carry it in the candidate's colouring instead.

The panels are drawn by `deep_figures.draw_link`, the renderer and shader every deep figure
goes through, so no second drawing exists.
"""

from __future__ import annotations

import json
from pathlib import Path

from . import deep_figures
from .locations import Made, Split, panel_path

ID = "deep-judges-top15"
HERE = Path(__file__).resolve().parent
SCORES = HERE / "data" / "deep-judges-scores.jsonl"

#: The grid every judge read its pictures at, and so the grid the panels are drawn at.
PANEL = (640, 360)
SUPERSAMPLE = 2
TOP = 15
COLUMNS = 3
#: The location judge's neutral recipe, as the Deep contract spells it after the frame.
NEUTRAL = "p=twilight_shifted&scale=leveled"
#: The keys of a deep link that say where a frame is and how deep it is drawn.
PLACE = ("f", "cx", "cy", "x", "y", "w", "n")

LOCATION, WALLPAPER, GALLERY = "location", "wallpaper", "gallery"
JUDGES = (LOCATION, WALLPAPER, GALLERY)
TITLES = {
    LOCATION: "Location judge",
    WALLPAPER: "Wallpaper judge",
    GALLERY: "Gallery judge",
}
STAR = "★"

#: Each panel's alt, by the frame's id in the record and the picture it is: `colour` for the
#: frame's own link, `neutral` for the location judge's. A pick drawn in its own link reads
#: its alt off `RANDOM_DIVES`, beside its link.
ALTS: dict[tuple[str, str], str] = {
    ("u0351", "colour"): "Rows of spirals in coral, cream, and brown filigree over orange-red.",
    ("u0482", "colour"): "A small black copy of the set in a ring of pale gold filigree, among "
    "mauve spirals on dark plum.",
    ("u0199", "colour"): "A small black copy of the set in a web of pale blue filigree over dark "
    "navy clouds.",
    ("u0573", "colour"): "Chains of small blue spirals across dark slate, with one large spiral "
    "at the right.",
    ("u0285", "colour"): "A four-armed pinwheel of peach filigree around a small dark copy, on "
    "brown.",
    ("u0028", "colour"): "A small copy of the set framed in rings of purple and white filigree, "
    "on violet and pale blue.",
    ("u0549", "colour"): "Two large spirals of cream and amber filigree on dark brown.",
    ("u0387", "colour"): "A small black copy of the set in a cross of rose and navy filigree, with "
    "spirals at its tips, on pale peach.",
    ("u0302", "colour"): "A small black copy of the set in a lattice of magenta filigree over pale "
    "pink.",
    ("u0228", "colour"): "The edge of a broad black region lined with seahorse spirals, among "
    "teal and cream filigree.",
    ("u0903", "colour"): "A small black copy of the set among curls of sky-blue filigree.",
    ("u0303", "colour"): "A small black copy of the set among spirals of blue filigree on pale ice "
    "blue.",
    ("u0779", "colour"): "A small black copy of the set at the center of spiral arms in lavender, "
    "blue, and pink.",
    ("u0383", "colour"): "One large spiral of pink filigree beside smaller ones, over rose and "
    "deep maroon.",
    ("u0889", "colour"): "A tiny copy of the set in square rings of lilac filigree, on periwinkle "
    "and near-black.",
    ("u0618", "colour"): "A small black copy of the set in a web of cream filigree over orange and "
    "red.",
    ("u0735", "colour"): "Curls of mint filigree over dark teal.",
    ("u0440", "colour"): "A tiny copy of the set at the center of pinwheel spirals in lavender, "
    "violet, and magenta.",
    ("u0390", "colour"): "A tiny copy of the set in pentagonal rings of mint and dark teal "
    "filigree.",
    ("u0210", "colour"): "A small black copy of the set among spiral arms of gold filigree on "
    "yellow.",
    ("u0104", "colour"): "A small black copy of the set at the center of a four-armed pinwheel in "
    "rust, cream, and pale pink.",
    ("u0222", "colour"): "A small black copy of the set ringed in aqua filigree, among spirals on "
    "dark teal.",
    ("u0079", "colour"): "A small black copy of the set in a chain of cream and teal filigree, "
    "between dark teal pools and patches of ochre.",
    ("u0056", "neutral"): "In the neutral palette, a small dark copy ringed in white, among "
    "chains of pale blue spirals on purple.",
    ("u0936", "neutral"): "In the neutral palette, a black copy of the set among spirals of pale "
    "blue filigree on dark purple.",
    ("u0759", "neutral"): "In the neutral palette, a tiny black copy on a thin thread of blue "
    "filigree, with spirals at the edges, on purple.",
    ("u0411", "neutral"): "In the neutral palette, chains of pale blue spirals with bright "
    "centers, on purple.",
    ("u0034", "neutral"): "In the neutral palette, arms of pale blue filigree spiraling out from "
    "a bright center at the left, on dark purple.",
    ("u0939", "neutral"): "In the neutral palette, one large spiral with a red center among "
    "chains of blue filigree, on purple.",
    ("u0303", "neutral"): "In the neutral palette, a small black copy in a triangle of pale blue "
    "filigree, among spirals on purple.",
    ("u0705", "neutral"): "In the neutral palette, a tiny black copy at the center of five large "
    "white spirals, on dark purple.",
    ("u0900", "neutral"): "In the neutral palette, one wide spiral of pale blue filigree with a "
    "red center, on purple.",
    ("u0157", "neutral"): "In the neutral palette, a spiral of pale blue filigree with a dark red "
    "center, its arms reaching across purple.",
    ("u0074", "neutral"): "In the neutral palette, spirals of pale blue filigree, two with red "
    "centers, on dark purple.",
    ("u0701", "neutral"): "In the neutral palette, one large spiral of white and pale blue "
    "filigree with a red center, on purple.",
    ("u0440", "neutral"): "In the neutral palette, a small dark copy in a ring of red, at the "
    "center of pale blue pinwheel spirals on purple.",
    ("u0702", "neutral"): "In the neutral palette, one spiral of pale blue filigree with a red "
    "center, on dark purple.",
    ("u0275", "neutral"): "In the neutral palette, a black copy of the set among four arms of "
    "pale blue filigree, on purple.",
}


class DeepJudgesError(RuntimeError):
    """The record is missing, or disagrees with the study it was promoted from."""


# --------------------------------------------------------------------------- the record


def rows() -> list[dict]:
    if not SCORES.is_file():
        raise DeepJudgesError(
            f"{SCORES.relative_to(HERE.parent).as_posix()} is missing; promote it with "
            "python -m builder deep --judge-scores <the study's folder>"
        )
    return [json.loads(line) for line in SCORES.read_text(encoding="utf-8").splitlines() if line]


def ranking(record: list[dict], column: str) -> list[dict]:
    """The frames in one judge's order: its reading highest first, ties by id."""
    return sorted(record, key=lambda row: (-row[column], row["id"]))


def ranks(record: list[dict], column: str) -> dict[str, int]:
    return {row["id"]: n for n, row in enumerate(ranking(record, column), start=1)}


def neutral_link(link: str) -> str:
    """The frame of a deep link in the location judge's neutral recipe, and nothing else."""
    parts = link.split("&")
    kept = [part for part in parts[1:] if part.split("=", 1)[0] in PLACE]
    return "&".join([parts[0], *kept, NEUTRAL])


def promote(folder: Path) -> list[str]:
    """Write the record from `judge_deep_ckpt156`'s files, refusing on any disagreement."""

    def jsonl(name: str) -> dict[str, dict]:
        lines = (folder / name).read_text(encoding="utf-8").splitlines()
        return {row["id"]: row for row in map(json.loads, filter(None, lines))}

    population = jsonl("population.jsonl")
    scores = jsonl("scores.jsonl")
    leveled = jsonl("scores_leveled.jsonl")
    rendered = jsonl("renders.jsonl")
    labels = json.loads((folder / "labels.json").read_text(encoding="utf-8"))
    picks = {entry["id"]: entry["n"] for entry in labels["top"]}
    if set(population) != set(scores) or set(scores) != set(leveled):
        raise DeepJudgesError("the population and the two score files name different frames")
    out = []
    for identifier in sorted(population):
        frame, read, again = population[identifier], scores[identifier], leveled[identifier]
        if rendered[identifier]["neutral_link"] != neutral_link(frame["link"]):
            raise DeepJudgesError(f"{identifier}: the study's neutral link is not this rule's")
        if (frame["tier"] == "top") != (identifier in picks):
            raise DeepJudgesError(f"{identifier}: its tier and the 15 disagree")
        out.append(
            {
                "id": identifier,
                "link": frame["link"],
                "tier": frame["tier"],
                "pick": picks.get(identifier),
                "interior": frame["interior"],
                # Each head's own column: P(>=3) for location, P(>=4) for the other two.
                LOCATION: read["location"][1],
                WALLPAPER: read["render"][2],
                GALLERY: read["gallery"][2],
                f"{WALLPAPER}_leveled": again["render"][2],
                f"{GALLERY}_leveled": again["gallery"][2],
            }
        )
    text = "".join(json.dumps(row) + "\n" for row in out)
    SCORES.write_text(text, encoding="utf-8", newline="\n")
    return [f"wrote {len(out)} frames to {SCORES.relative_to(HERE.parent).as_posix()}"]


# ---------------------------------------------------------------------------- readout


def _auc(positive: list[float], negative: list[float]) -> float:
    """P(a positive outscores a negative), ties counted half."""
    wins = sum((p > n) + 0.5 * (p == n) for p in positive for n in negative)
    return wins / (len(positive) * len(negative))


def _average_ranks(values: list[float]) -> list[float]:
    order = sorted(range(len(values)), key=values.__getitem__)
    out = [0.0] * len(values)
    i = 0
    while i < len(order):
        j = i
        while j + 1 < len(order) and values[order[j + 1]] == values[order[i]]:
            j += 1
        for k in range(i, j + 1):
            out[order[k]] = (i + j) / 2 + 1
        i = j + 1
    return out


def spearman(one: list[float], other: list[float]) -> float:
    a, b = _average_ranks(one), _average_ranks(other)
    mean = (len(a) + 1) / 2
    cov = sum((x - mean) * (y - mean) for x, y in zip(a, b, strict=True))
    var = (sum((x - mean) ** 2 for x in a) * sum((y - mean) ** 2 for y in b)) ** 0.5
    return cov / var


def readout(record: list[dict] | None = None) -> dict:
    """The numbers the page's paragraph leans on, read off the record."""
    record = rows() if record is None else record
    top = [row for row in record if row["tier"] == "top"]
    rest = [row for row in record if row["tier"] != "top"]
    fifth = len(record) // 5
    placed = ranks(record, LOCATION)
    auc = {
        judge: _auc([row[judge] for row in top], [row[judge] for row in rest]) for judge in JUDGES
    }
    # Less interior is better, so the baseline scores a frame by its interior negated.
    auc["less interior"] = _auc(
        [-row["interior"] for row in top], [-row["interior"] for row in rest]
    )
    return {
        "frames": len(record),
        "picks": len(top),
        "top fifth": fifth,
        "picks in the location judge's top fifth": sum(placed[row["id"]] <= fifth for row in top),
        "auc, the 15 against the rest": {name: round(value, 3) for name, value in auc.items()},
        "spearman, absolute against leveled": {
            judge: round(
                spearman(
                    [row[judge] for row in record], [row[f"{judge}_leveled"] for row in record]
                ),
                3,
            )
            for judge in (WALLPAPER, GALLERY)
        },
    }


# ----------------------------------------------------------------------------- figure


def _bands(record: list[dict]) -> list[tuple[str, list[tuple[str, str, str, str | None]]]]:
    """Each judge's band as (frame id, link, picture, label), in `JUDGES` order."""
    bands = []
    for judge in JUDGES:
        chosen = []
        for rank, row in enumerate(ranking(record, judge)[:TOP], start=1):
            neutral = judge == LOCATION
            link = neutral_link(row["link"]) if neutral else row["link"]
            star = f" {STAR}" if row["tier"] == "top" else ""
            chosen.append(
                (row["id"], link, "neutral" if neutral else "colour", f"Rank {rank}{star}")
            )
        bands.append((judge, chosen))
    return bands


def _alt(identifier: str, link: str, picture: str, pick: int | None) -> str:
    """A panel's alt: `RANDOM_DIVES`' for a pick drawn in its own link, else `ALTS`'."""
    if pick is not None and picture != "neutral":
        own, alt = deep_figures.RANDOM_DIVES[pick - 1]
        if own == link:
            return alt
    alt = ALTS.get((identifier, picture))
    if not alt:
        raise DeepJudgesError(f"{identifier} has no {picture} alt in ALTS")
    return alt


_DRAWN: dict[int, deep_figures.Drawn] = {}


def draw() -> Split:
    record = rows()
    picks = {row["id"]: row["pick"] for row in record}
    bands = _bands(record)
    width, height = PANEL
    lines: list[str] = []
    made: list[Made] = []
    maps: list[str] = []
    index = 0
    for band, chosen in bands:
        for place, (identifier, link, picture, label) in enumerate(chosen):
            index += 1
            frame = deep_figures._linked(link, label or "", "")
            one = deep_figures.draw_link(link, width, height, SUPERSAMPLE, ID)
            if one.link != link:
                raise DeepJudgesError(f"panel {index}: drawn as {one.link}, asked as {link}")
            _DRAWN[index] = one
            target = panel_path(ID, index)
            target.write_bytes(one.path.read_bytes())
            key = deep_figures._key(ID, index)
            made.append(
                Made(
                    target,
                    _alt(identifier, link, picture, picks[identifier]),
                    label=label,
                    deep=key,
                    band={"title": TITLES[band]} if place == 0 else None,
                )
            )
            maps.append(deep_figures._parts(frame.colour)["p"])
            family = "family mandelbrot"
            if frame.degree != 2:
                family = f"family multibrot, degree {frame.degree}"
            lines.append(
                f"panel {index}, {TITLES[band]}, {label}, frame "
                f"{identifier}: Deep tab, {family}, centre {frame.x} + {frame.y}i, width "
                f"{frame.w}, cap {one.maxiter} named by the link, palette "
                f"{deep_figures._colour_words(frame.colour)}; recipe {key}"
            )
    named = list(dict.fromkeys(maps))
    words = [f"colormap {name}" for name in named]
    said = readout(record)
    head = (
        f"builder.deep_judges:draw — the {said['frames']} frames of the dive candidate sheet as "
        "judge_deep_ckpt156 scored them, read off builder/data/deep-judges-scores.jsonl: the "
        f"location, wallpaper and gallery judges' top {TOP}, ranked by the record's location, "
        "wallpaper and gallery columns, ties by frame id, starred where a frame is one of Matt's "
        f"{said['picks']} (deep_figures.RANDOM_DIVES, the links of deep-random-dives, which the "
        "fold no longer repeats as a band of its own). The location band is each frame's "
        f"neutral link ({NEUTRAL} on the frame and its cap); the others are the frame's own "
        f"link. Every panel {width}x{height}, supersample {SUPERSAMPLE}, the grid the judges "
        f"read, drawn in {', '.join(words[:-1])} and {words[-1]}, one to a panel. A Deep-tab "
        "panel is its link, held in article/figure-recipes.jsonl under "
        "deep|<figure id>#<panel>: its field drawn by zoom_fields.mjs on the committed "
        "perturb.wasm and coloured by deep_gallery_shade.mjs through engine.wasm, exactly as "
        "the Deep tab draws the link."
    )
    return Split(made, [head, *lines], COLUMNS)


def keep() -> None:
    from . import recipes

    recipes.keep_deep(
        {
            deep_figures._key(ID, index): {
                "link": one.link,
                "resolution": list(PANEL),
                "supersample": SUPERSAMPLE,
                "maker": "builder.deep_judges:draw",
            }
            for index, one in _DRAWN.items()
        }
    )


def recipe() -> dict:
    return {"maker": f"{__name__}:draw", "args": {"id": ID}}
