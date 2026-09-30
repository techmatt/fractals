"""`tools-labels`: four random pictures from each of Matt's four ratings, on Tools and data.

    python -c "from builder import tools_labels as m; m.make()"
    python -c "from builder import tools_labels as m; print(*m.draw()[1], sep='\\n')"

The figure shows what the hand labels are: four pictures a person rated 1, four rated 2,
four rated 3 and four rated 4. **Every picture is a row of the smooth render store**,
`data/smooth_render/rows/` next door — the verdicts on finished smooth renders, the judge
that decides which pictures survive. That store and not the others, because a row there is
a whole picture: family with every constant, frame, mode with its settings, curve, map,
every knob of the palette pass and the cap, all on one line, so a panel is drawn from the
row and nothing else and its link opens that picture. `data/labels/` rates places and
names no palette; `data/gallery_grade/` grades gallery seats; `strange_render` is the
same shape but its modes are the ones the explorer mostly does not carry.

**Only rows the store says Matt rated.** A row carries its `labeler`; the rows the
labeling rig wrote since the store existed say `matt`, and the 4,795 imported from the
corpus before it say nothing (`labeler: null`). The caption says these are his ratings,
so the draw takes the rows that record it rather than the rows that could only be assumed
to be his. It also means every picture here was drawn by this engine's own rig at the
recipe the row keeps, rather than by an earlier renderer the import translated from.

**Which rows is a seeded draw, frozen once it was taken** (`draw`, then `PICKS`). The
store is append-only and grows with every round of labels, so re-running the draw later shuffles a
bigger population and lands elsewhere; a redraw of the figure must not move its pictures.
`PICKS` is what the draw returned on 2026-09-29, and `make` draws exactly those rows,
refusing any that a later verdict has superseded (`renders.finished_row`) or whose rating
is no longer the one its column claims. Nothing here was chosen for how it looks.

**The page cannot group panels into four labelled 2×2 blocks.** A split figure is one grid
or several bands, and bands stack top to bottom unless the figure is a flow, which is a
pipeline's stages with a store drawn between each — not a thing four ratings are. So the
figure is one grid of eight across and two down, which at the article's width is exactly
Matt's arrangement: columns one and two are the 1s, three and four the 2s, and so on, each
pair of columns a 2×2 block. Every panel is labelled with its rating in HTML, because the
grid reflows on a narrow screen and a panel's rating must survive the reflow.
"""

from __future__ import annotations

import json
import random

from . import figures as figures_module
from . import frames, judges, links, picks, renders, sheets
from .locations import Made, Split, panel_path, panels

ID = "tools-labels"

#: The store the pictures come from, and whose ratings they are.
HEAD = "smooth_render"
LABELER = "matt"

#: The ratings, left to right, and how many pictures each shows.
RATINGS = (1, 2, 3, 4)
PER_RATING = 4

#: Each rating is a block this many panels across (and so this many down).
BLOCK = 2
COLUMNS = BLOCK * len(RATINGS)

#: The draw's seed. Each rating's population is shuffled by `random.Random(SEED + rating)`.
SEED = 20260929

#: What the draw returned on 2026-09-29, rating by rating, in the order it took them:
#: `smooth_render/<batch>.jsonl:<line>`, the key the registry's `run_row` source spells.
#: The first two of a rating sit in the block's top row, left then right; the next two
#: under them.
PICKS: dict[int, tuple[str, ...]] = {
    1: (
        "smooth_render/mandelbrot_mix_pricing.jsonl:19",
        "smooth_render/mandelbrot_mix_pricing.jsonl:14",
        "smooth_render/mandelbrot_mix_pricing.jsonl:61",
        "smooth_render/mandelbrot_mix_pricing.jsonl:12",
    ),
    2: (
        "smooth_render/repeat_axis_smooth_render_20260911.jsonl:24",
        "smooth_render/manufactured_rare_colors.jsonl:75",
        "smooth_render/manufactured_rare_colors.jsonl:209",
        "smooth_render/itinerary_promotion.jsonl:48",
    ),
    3: (
        "smooth_render/seated_and_head_top.jsonl:49",
        "smooth_render/new_maps_top4_20260905.jsonl:48",
        "smooth_render/p_ge4_calibration_smooth.jsonl:92",
        "smooth_render/smooth_decision_bands.jsonl:352",
    ),
    4: (
        "smooth_render/new_maps_top4_20260905.jsonl:14",
        "smooth_render/smooth_decision_bands.jsonl:119",
        "smooth_render/smooth_decision_bands.jsonl:70",
        "smooth_render/released_top_end.jsonl:9",
    ),
}

#: A seat panel's render geometry, which is what every wallpaper panel on the site draws at.
RENDER = picks.PANEL_RENDER
SUPERSAMPLE = picks.PANEL_SUPERSAMPLE


class LabelsError(RuntimeError):
    """The figure cannot be drawn as `PICKS` says."""


# ------------------------------------------------------------------------ the addresses


def key_of(row: dict) -> str:
    """A store row's registry key: the head, the batch file and the line."""
    return f"{row['_head']}/{row['_batch']}.jsonl:{row['_line']}"


def _address(key: str) -> tuple[str, str, int]:
    head, _, rest = key.partition("/")
    batch, _, line = rest.rpartition(":")
    return head, batch.removesuffix(".jsonl"), int(line)


def _place(row: dict) -> tuple[str, str]:
    return frames.place_of_viewport(row["viewport"])


# ----------------------------------------------------------------------- the refusals


def panel_spec(row: dict) -> dict:
    """The panel's record: what was drawn, in the shape `links.spec_record` reads."""
    spec = {
        "family": row["family"],
        "viewport": row["viewport"],
        "mode": row["mode"],
        "curve": row["curve"],
        "colormap": row["colormap"],
        "palette": {key: row["recipe"][key] for key in SHADE_KEYS},
        "maxiter": int(row["render"]["maxiter"]),
    }
    if row.get("mode_params"):
        spec["mode_params"] = row["mode_params"]
    return spec


#: The palette pass a finished-render row keeps, as `renders.wallpaper_spec` hands it on.
SHADE_KEYS = ("gamma", "cycles", "phase", "reverse", "mirror", "transfer", "rolloff")

#: A Phoenix set is its three constants, and a row that spells none would be drawn by the
#: engine at its defaults and linked at the origin: two different pictures.
PHOENIX_CONSTANTS = ("c", "p", "z_prev")


class _Linker:
    """Whether a row's picture can be linked exactly, asked the way `links.py` asks it."""

    def __init__(self) -> None:
        self.palettes = links.baked_palettes()
        self.curves = links.catalog_curves()

    def refusal(self, row: dict) -> str | None:
        family = row["family"]
        if family["kind"] == "phoenix" and not all(k in family for k in PHOENIX_CONSTANTS):
            return "a Phoenix row that spells no constants"
        answer = links._view(
            key_of(row),
            {},
            links.spec_record(panel_spec(row)),
            "spec",
            self.palettes,
            self.curves,
        )
        if isinstance(answer, links.Link):
            return f"{answer.reason}: {answer.why}"
        view, _ = answer
        emitted = links.emit({"one": view})["one"]
        if not emitted.get("ok"):
            return f"not_exposed: {emitted.get('why')}"
        return None


# --------------------------------------------------------------------------- the draw


def population() -> dict[int, list[dict]]:
    """Every current verdict Matt cast in the store, by rating, in (batch, line) order."""
    grouped: dict[int, list[dict]] = {rating: [] for rating in RATINGS}
    for row in judges.resolved_store(HEAD).values():
        if row.get("labeler") == LABELER and row.get("origin") == "human":
            grouped[int(row["score"])].append(row)
    for rows in grouped.values():
        rows.sort(key=lambda row: (row["_batch"], row["_line"]))
    return grouped


def taken_places() -> set:
    """Every place another figure on the site already stands on."""
    registry = figures_module.load_all()
    others = {key: figure for key, figure in registry.items() if key != ID}
    return set(frames.resolve(others)["places"])


def draw() -> tuple[dict[int, tuple[str, ...]], list[str], dict]:
    """The seeded draw `PICKS` froze: see `DRAW_RULE`. Returns picks, a log and counts."""
    grouped = population()
    taken = taken_places()
    linker = _Linker()
    chosen: dict[int, tuple[str, ...]] = {}
    log: list[str] = []
    counts: dict = {"population": {}, "examined": {}, "refused": {}}
    for rating in RATINGS:
        pool = list(grouped[rating])
        random.Random(SEED + rating).shuffle(pool)
        took: list[str] = []
        refused: dict[str, int] = {}
        examined = 0
        for row in pool:
            if len(took) == PER_RATING:
                break
            examined += 1
            spot = _place(row)
            if spot in taken:
                why = "place taken by another figure"
                refused[why] = refused.get(why, 0) + 1
                log.append(f"  {rating}: refused {key_of(row)}: {why}")
                continue
            reason = linker.refusal(row)
            if reason is not None:
                why = reason.split(":", 1)[0]
                refused[why] = refused.get(why, 0) + 1
                log.append(f"  {rating}: refused {key_of(row)}: {reason}")
                continue
            taken.add(spot)
            took.append(key_of(row))
            log.append(f"  {rating}: took {key_of(row)}")
        if len(took) < PER_RATING:
            raise LabelsError(f"only {len(took)} rows rated {rating} clear the rejections")
        chosen[rating] = tuple(took)
        counts["population"][rating] = len(pool)
        counts["examined"][rating] = examined
        counts["refused"][rating] = refused
    return chosen, log, counts


DRAW_RULE = (
    f"Which rows: every current verdict of data/{HEAD}/rows/ next door (resolved latest-wins "
    f"per picture, as the store's own reader does) whose labeler is {LABELER}, grouped by "
    f"rating and put in (batch, line) order; each rating's rows shuffled by "
    f"random.Random({SEED} + rating) (Python's Mersenne Twister), taking the first "
    f"{PER_RATING} that clear the rejections, ratings 1 to 4 in turn — by "
    "builder.tools_labels.draw, run once on 2026-09-29 and frozen as PICKS. Refused: a row "
    "whose place (centre and width, as builder.frames reduces it) another figure on the site "
    "already stands on, or an earlier pick of this figure took; a Phoenix row that spells no "
    "constants; a row builder/links.py would refuse to link (a map the explorer does not "
    "carry, a mode it does not offer, a fold on a cyclic map, a frame past f64) or that the "
    "permalink contract will not emit. Nothing here was chosen for how it looks."
)


# ------------------------------------------------------------------------ the figure


def _rows() -> dict[int, list[dict]]:
    """`PICKS` resolved, each row checked to be current and still at its rating."""
    if sorted(PICKS) != list(RATINGS) or any(len(PICKS[r]) != PER_RATING for r in RATINGS):
        raise LabelsError(f"PICKS is {PER_RATING} keys for each of {RATINGS}")
    found: dict[int, list[dict]] = {}
    for rating in RATINGS:
        found[rating] = []
        for key in PICKS[rating]:
            head, batch, line = _address(key)
            row = renders.finished_row(head, batch, line)
            if int(row["score"]) != rating or row.get("labeler") != LABELER:
                raise LabelsError(
                    f"{key} is rated {row['score']} by {row.get('labeler')}, and its column "
                    f"is {LABELER}'s {rating}s"
                )
            found[rating].append(row)
    return found


def _order(found: dict[int, list[dict]]) -> list[tuple[int, dict]]:
    """The panels in the grid's reading order: two rows of eight, each rating a 2×2 block."""
    ordered = []
    for top in range(0, PER_RATING, BLOCK):
        for rating in RATINGS:
            ordered += [(rating, row) for row in found[rating][top : top + BLOCK]]
    return ordered


def _family_words(family: dict) -> str:
    parts = [family["kind"] + (f" degree {family['degree']}" if "degree" in family else "")]
    for name in PHOENIX_CONSTANTS:
        if name in family:
            parts.append(f"{name} = {family[name][0]} + {family[name][1]}i")
    return ", ".join(parts)


def _stage(stage: dict) -> str:
    extra = "".join(f" {key} {value}" for key, value in stage.items() if key != "kind")
    return f"{stage.get('kind')}{extra}"


def _line(index: int, rating: int, row: dict) -> str:
    view = row["viewport"]
    shade = row["recipe"]
    params = f" {json.dumps(row['mode_params'])}" if row.get("mode_params") else ""
    return (
        f"panel {index}, rated {rating}: {_family_words(row['family'])}, centre "
        f"{view['center_re']} + {view['center_im']}i, width {view['width']}, mode "
        f"{row['mode']}{params}, curve {row['curve']}, "
        + ("colormap" if index == 1 else "palette")
        + f" {row['colormap']}, mirror {picks.flag(shade['mirror'])}, gamma "
        f"{picks.number(shade['gamma'])}, cycles {picks.number(shade['cycles'])}, phase "
        f"{picks.number(shade['phase'])}, reverse {picks.flag(shade['reverse'])}, transfer "
        f"{_stage(shade['transfer'])}, rolloff {_stage(shade['rolloff'])}, cap "
        f"{row['render']['maxiter']}; data/{row['_head']}/rows/{row['_batch']}.jsonl line "
        f"{row['_line']}, rated {rating} by hand by {row['labeler']} on {row['recorded_at']}."
    )


def make() -> Split:
    """Sixteen panels, eight across: four of each rating, 1 on the left to 4 on the right."""
    found = _rows()
    taken = taken_places()
    linker = _Linker()
    seen: set = set()
    for rating in RATINGS:
        for row in found[rating]:
            spot = _place(row)
            if spot in taken or spot in seen:
                raise LabelsError(f"{key_of(row)}: its place is already on the site")
            seen.add(spot)
            reason = linker.refusal(row)
            if reason is not None:
                raise LabelsError(f"{key_of(row)} cannot be linked exactly: {reason}")
    size = panels(COLUMNS)
    catalog = renders.mode_catalog()
    cache = renders.Cache()
    made: list[Made] = []
    lines = [
        f"builder.tools_labels:make — {len(RATINGS) * PER_RATING} panels at {size[0]}x"
        f"{size[1]}, {COLUMNS} across and {PER_RATING // BLOCK} down, landed one file a panel: "
        f"each rating is a {BLOCK}x{BLOCK} block, ratings 1 to 4 left to right, and each "
        "panel is labelled with its rating. Every panel is one row of the smooth render store "
        "drawn again from that row alone — family, frame, mode, mode settings, curve, map, "
        "the whole palette pass and the cap — by renders.wallpaper_spec at "
        f"{RENDER[0]}x{RENDER[1]}, supersample {SUPERSAMPLE}, then centre-cropped and fitted. "
        "The cap is a policy on the frame's width, so this is the picture that was rated "
        "drawn into a different number of pixels. No tone operator acts on these renders, "
        "and none acted on the pictures that were rated.",
        DRAW_RULE,
    ]
    for index, (rating, row) in enumerate(_order(found), start=1):
        spec = renders.wallpaper_spec(
            row, resolution=RENDER, supersample=SUPERSAMPLE, catalog=catalog
        )
        picture = cache.produce(f"{ID}-{rating}-{row['_batch']}-{row['_line']}", "render", spec)
        made.append(
            Made(
                sheets.save(sheets.fitted(picture.path, size), panel_path(ID, index), quiet=True),
                alt=(
                    f"A wallpaper drawn in {picks.mode_words(row['mode'])}, in the "
                    f"{picks.family_name(row['family'])} family, rated {rating}."
                ),
                label=str(rating),
                spec=panel_spec(row),
            )
        )
        lines.append(_line(index, rating, row))
    return Split(made, lines, COLUMNS)


def sources() -> list[dict]:
    """The sixteen store rows, as `run_row` keys, in panel order."""
    found = _rows()
    return [
        {
            "kind": figures_module.RUN_ROW,
            "keys": [key_of(row) for _, row in _order(found)],
        }
    ]


def recipe() -> dict:
    return {
        "maker": f"{__name__}:make",
        "args": {"store": HEAD, "labeler": LABELER, "seed": SEED, "per_rating": PER_RATING},
    }


def main() -> None:
    """Run the draw and print what it takes, for freezing into `PICKS`."""
    chosen, log, counts = draw()
    print(*log, sep="\n")
    print(json.dumps(counts, indent=1))
    print(json.dumps({str(k): v for k, v in chosen.items()}, indent=1))


if __name__ == "__main__":
    main()
