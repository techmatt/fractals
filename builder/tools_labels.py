"""`tools-labels`: four random pictures at each of Matt's ratings, in three kinds of rating.

    python -m builder tools tools-labels [--place] [--replace]
    python -c "from builder import tools_labels as m; m.main()"

Three bands, top to bottom, one per kind of hand label the Tools and data page offers
*(tools_bands_ckpt156)*:

* **Places** — `data/labels/rows/` next door, the location ratings. A row there is a place
  and the cap it was drawn at, and names no palette; its panel is the neutral picture every
  place on this site is drawn as, at that cap, and links to the same neutral view. The store
  does not record which map a place was shown in when it was rated — the imported rows
  predate this renderer — so the panel is the place as the location judge sees it, not a
  claim about the pixels that were on the rater's screen.
* **Wallpapers** — `data/smooth_render/rows/` and `data/strange_render/rows/`, the verdicts
  on finished renders. A row is a whole picture — family with every constant, frame, mode
  with its settings, curve, map, every knob of the palette pass and the cap — so a panel is
  drawn from the row and nothing else and its link opens that picture.
* **Gallery pictures** — `data/gallery_grade/rows/`, the grades of gallery candidates. The
  same shape as a finished-render row, with the rating in `grade` rather than `score`. A
  row whose sheet picture went through its candidate's levelled colormap (`leveled: true`)
  is refused: the row does not carry that curve, so neither a redraw nor a link could be
  the picture that was graded.

Each band is four groups, ratings 1 to 4 left to right, each a 2×2 block with its rating
said once under it *(tools_labels_groups_ckpt156)*. A group wraps whole, so on a narrow
screen a block moves to the next line and never splits. The panels run rating by rating,
since a group is the panels between it and the next; within a block the four picks read
two across in the order the draw took them.

**Only Matt's rows.** A row carries its `labeler`: `matt` for everything the labelling rig
wrote since each store existed, and `null` for the rows imported from the corpus before
it, which are his too. `origin` must be `human` — the labels store also holds rows a stated
rule cast, with no labeler, and those are nobody's rating.

**Which rows is a seeded draw, frozen once it was taken** (`draw`, then `PICKS`). The
stores are append-only and grow with every round of labels, so re-running the draw later
shuffles a bigger population and lands elsewhere; a redraw of the figure must not move its
pictures. `make` draws exactly the frozen rows, refusing any that a later verdict has
superseded or whose rating is no longer the one its block claims. Nothing here was chosen
for how it looks.
"""

from __future__ import annotations

import json
import random

from . import figures as figures_module
from . import frames, judges, links, picks, renders, sheets
from .locations import Made, Split, panel_path, panels

ID = "tools-labels"

#: The labeler whose rows these are, and the rows the store leaves unattributed, which are
#: his as well: the corpus imported before the labelling rig wrote a name.
LABELERS = ("matt", None)
ORIGIN = "human"

#: The bands, top to bottom: title, the stores it draws from, the field its rating is in.
PLACES, WALLPAPERS, GALLERY = "places", "wallpapers", "gallery"
BANDS = (PLACES, WALLPAPERS, GALLERY)
TITLES = {PLACES: "Places", WALLPAPERS: "Wallpapers", GALLERY: "Gallery pictures"}
STORES = {
    PLACES: ("labels",),
    WALLPAPERS: ("smooth_render", "strange_render"),
    GALLERY: ("gallery_grade",),
}
RATING_FIELD = {PLACES: "score", WALLPAPERS: "score", GALLERY: "grade"}

#: The ratings, left to right, and how many pictures each shows.
RATINGS = (1, 2, 3, 4)
PER_RATING = 4

#: Each rating is a block this many panels across (and so this many down).
BLOCK = 2
COLUMNS = BLOCK * len(RATINGS)

#: The draw's seed. Band b (0, 1, 2) at rating r is shuffled by `random.Random(SEED + 10b + r)`.
SEED = 20260929

#: What the draw returned, band by band and rating by rating, in the order it took them:
#: `<store>/<batch>.jsonl:<line>`. The first two of a rating sit in the block's top row,
#: left then right; the next two under them.
PICKS: dict[str, dict[int, tuple[str, ...]]] = {
    PLACES: {
        1: (
            "labels/guided_descent_rev4.jsonl:259",
            "labels/guided_descent_rev4.jsonl:962",
            "labels/crawl_stratified_b.jsonl:145",
            "labels/crawl_stratified_a.jsonl:40",
        ),
        2: (
            "labels/screened_queue_v2.jsonl:900",
            "labels/minibrot_roster.jsonl:328",
            "labels/run10_novel_ground.jsonl:110",
            "labels/screened_queue_v2.jsonl:617",
        ),
        3: (
            "labels/correction_page.jsonl:407",
            "labels/gather_v6.jsonl:262",
            "labels/mandelbrot_offer_body.jsonl:83",
            "labels/multibrot_score_band.jsonl:293",
        ),
        4: (
            "labels/guided_descent_rev4.jsonl:66",
            "labels/correction_page.jsonl:315",
            "labels/correction_page_backfill.jsonl:30",
            "labels/steady_state_ranked.jsonl:41",
        ),
    },
    WALLPAPERS: {
        1: (
            "smooth_render/fresh_colorize_path.jsonl:98",
            "smooth_render/fresh_pool_draw.jsonl:211",
            "smooth_render/fresh_pool_draw.jsonl:626",
            "smooth_render/dramatic_palettes.jsonl:980",
        ),
        2: (
            "strange_render/under_seen_modes.jsonl:223",
            "smooth_render/dramatic_palettes.jsonl:905",
            "strange_render/release_bar_band.jsonl:13",
            "smooth_render/manufactured_rare_colors.jsonl:107",
        ),
        3: (
            "smooth_render/dramatic_palettes.jsonl:793",
            "strange_render/under_seen_modes.jsonl:392",
            "smooth_render/bucketed_correction.jsonl:292",
            "strange_render/dtm_variants_20260902.jsonl:109",
        ),
        4: (
            "strange_render/p_ge4_calibration_strange.jsonl:101",
            "smooth_render/bucketed_correction.jsonl:569",
            "smooth_render/smooth_decision_bands.jsonl:321",
            "smooth_render/pool_draw_human_good.jsonl:731",
        ),
    },
    GALLERY: {
        1: (
            "gallery_grade/gallery_top_20260910.jsonl:169",
            "gallery_grade/gallery_top_20260910.jsonl:399",
            "gallery_grade/aug_sweep_B_20260910.jsonl:38",
            "gallery_grade/gallery_top_20260910.jsonl:542",
        ),
        2: (
            "gallery_grade/p_fine_correction_20260909.jsonl:350",
            "gallery_grade/gallery_top_20260910.jsonl:383",
            "gallery_grade/gallery_top_20260910.jsonl:48",
            "gallery_grade/p_fine_correction_20260909.jsonl:169",
        ),
        3: (
            "gallery_grade/gallery_top_20260910.jsonl:51",
            "gallery_grade/gallery_tail_20260910.jsonl:11",
            "gallery_grade/n1000_0906_1.jsonl:327",
            "gallery_grade/aug_sweep_A_20260910.jsonl:174",
        ),
        4: (
            "gallery_grade/n1000_0906_2.jsonl:160",
            "gallery_grade/n1000_0906_3.jsonl:218",
            "gallery_grade/p_fine_correction_20260909.jsonl:303",
            "gallery_grade/n1000_0906_1.jsonl:199",
        ),
    },
}

#: A seat panel's render geometry, which is what every wallpaper panel on the site draws at.
RENDER = picks.PANEL_RENDER
SUPERSAMPLE = picks.PANEL_SUPERSAMPLE


class LabelsError(RuntimeError):
    """The figure cannot be drawn as `PICKS` says."""


# ------------------------------------------------------------------------ the addresses


def key_of(row: dict) -> str:
    """A store row's address: the store, the batch file and the line."""
    return f"{row['_head']}/{row['_batch']}.jsonl:{row['_line']}"


def _place(row: dict) -> tuple[str, str]:
    return frames.place_of_viewport(row["viewport"])


def rating_of(band: str, row: dict):
    return row.get(RATING_FIELD[band])


# ----------------------------------------------------------------------- the refusals


#: The palette pass a finished-render row keeps, as `renders.wallpaper_spec` hands it on.
SHADE_KEYS = ("gamma", "cycles", "phase", "reverse", "mirror", "transfer", "rolloff")

#: A Phoenix set is its three constants, and a row that spells none would be drawn by the
#: engine at its defaults and linked at the origin: two different pictures.
PHOENIX_CONSTANTS = ("c", "p", "z_prev")


def panel_spec(band: str, row: dict) -> dict:
    """The panel's record: what was drawn, in the shape `links.spec_record` reads."""
    if band == PLACES:
        return {
            "family": row["family"],
            "viewport": row["viewport"],
            "mode": "smooth",
            "colormap": renders.COLORMAP,
            "maxiter": int(row["render"]["maxiter"]),
        }
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


class _Linker:
    """Whether a row's picture can be drawn and linked exactly, asked as `links.py` asks it."""

    def __init__(self) -> None:
        self.palettes = links.baked_palettes()
        self.curves = links.catalog_curves()

    def refusal(self, band: str, row: dict) -> str | None:
        family = row["family"]
        if family["kind"] == "phoenix" and not all(k in family for k in PHOENIX_CONSTANTS):
            return "a Phoenix row that spells no constants"
        if not (row.get("render") or {}).get("maxiter"):
            return "a row that records no cap"
        if band == PLACES and (row.get("render") or {}).get("mode", "smooth") != "smooth":
            return "a place rated in a mode other than smooth, which the neutral picture is not"
        if band == GALLERY and row.get("leveled"):
            return "levelled: graded through a curve the row does not carry"
        if band != PLACES:
            try:
                picks.mode_words(row["mode"])
            except picks.PickError:
                return f"no wording: mode {row['mode']} has no words for the alt text"
        answer = links._view(
            key_of(row),
            {},
            links.spec_record(panel_spec(band, row)),
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


def current(band: str) -> dict[str, dict]:
    """Every current verdict in a band's stores, latest-wins, keyed by its address."""
    found = {}
    for head in STORES[band]:
        for row in judges.resolved_store(head).values():
            found[key_of(row)] = row
    return found


def population(band: str) -> dict[int, list[dict]]:
    """Every current verdict Matt cast in a band's stores, by rating, in address order."""
    grouped: dict[int, list[dict]] = {rating: [] for rating in RATINGS}
    for row in current(band).values():
        rating = rating_of(band, row)
        if row.get("labeler") in LABELERS and row.get("origin") == ORIGIN and rating in RATINGS:
            grouped[int(rating)].append(row)
    for rows in grouped.values():
        rows.sort(key=lambda row: (row["_head"], row["_batch"], row["_line"]))
    return grouped


def taken_places() -> set:
    """Every place another figure on the site already stands on."""
    registry = figures_module.load_all()
    others = {key: figure for key, figure in registry.items() if key != ID}
    return set(frames.resolve(others)["places"])


def draw() -> tuple[dict, list[str], dict]:
    """The seeded draw `PICKS` froze: see `DRAW_RULE`. Returns picks, a log and counts."""
    taken = taken_places()
    linker = _Linker()
    chosen: dict[str, dict[int, tuple[str, ...]]] = {}
    log: list[str] = []
    counts: dict = {}
    for number, band in enumerate(BANDS):
        grouped = population(band)
        chosen[band] = {}
        counts[band] = {"population": {}, "examined": {}, "refused": {}}
        for rating in RATINGS:
            pool = list(grouped[rating])
            random.Random(SEED + 10 * number + rating).shuffle(pool)
            took: list[str] = []
            refused: dict[str, int] = {}
            examined = 0
            for row in pool:
                if len(took) == PER_RATING:
                    break
                examined += 1
                spot = _place(row)
                if spot in taken:
                    reason = "place taken by another figure or an earlier panel"
                else:
                    reason = linker.refusal(band, row)
                if reason is not None:
                    why = reason.split(":", 1)[0]
                    refused[why] = refused.get(why, 0) + 1
                    log.append(f"  {band} {rating}: refused {key_of(row)}: {reason}")
                    continue
                taken.add(spot)
                took.append(key_of(row))
                log.append(f"  {band} {rating}: took {key_of(row)}")
            if len(took) < PER_RATING:
                log.append(f"  {band} {rating}: SHORT, only {len(took)} of {PER_RATING}")
            chosen[band][rating] = tuple(took)
            counts[band]["population"][rating] = len(pool)
            counts[band]["examined"][rating] = examined
            counts[band]["refused"][rating] = refused
    return chosen, log, counts


DRAW_RULE = (
    "Which rows: every current verdict (resolved latest-wins per picture, or per place in "
    "the labels store, as each store's own reader does) whose labeler is matt or null and "
    "whose origin is human, grouped by rating and put in (store, batch, line) order; each "
    f"band b (0 places, 1 wallpapers, 2 gallery pictures) at rating r shuffled by "
    f"random.Random({SEED} + 10b + r) (Python's Mersenne Twister), taking the first "
    f"{PER_RATING} that clear the rejections, bands and ratings in order — by "
    "builder.tools_labels.draw, run once on 2026-09-29 and frozen as PICKS. Refused: a row "
    "whose place (centre and width, as builder.frames reduces it) another figure on the site "
    "already stands on, or an earlier pick of this figure took; a row that records no cap; a "
    "place rated in a mode other than smooth; a gallery row graded through its levelled "
    "colormap; a wallpaper or gallery row whose mode builder.picks has no words for (the alt "
    "text says what a mode does); a Phoenix row that spells no constants; a row "
    "builder/links.py would refuse "
    "to link (a map the explorer does not carry, a mode it does not offer, a fold on a "
    "cyclic map, a frame past f64) or that the permalink contract will not emit. Nothing "
    "here was chosen for how it looks."
)


# ------------------------------------------------------------------------ the figure


def _rows() -> dict[str, dict[int, list[dict]]]:
    """`PICKS` resolved, each row checked to be current, Matt's and still at its rating."""
    found: dict[str, dict[int, list[dict]]] = {}
    for band in BANDS:
        held = PICKS.get(band) or {}
        if sorted(held) != list(RATINGS) or any(len(held[r]) != PER_RATING for r in RATINGS):
            raise LabelsError(f"PICKS[{band!r}] is {PER_RATING} keys for each of {RATINGS}")
        now = current(band)
        found[band] = {}
        for rating in RATINGS:
            found[band][rating] = []
            for key in held[rating]:
                row = now.get(key)
                if row is None:
                    raise LabelsError(
                        f"{key} is not a current verdict: a later row on the same picture "
                        "supersedes it, or the address has gone"
                    )
                if rating_of(band, row) != rating or row.get("labeler") not in LABELERS:
                    raise LabelsError(
                        f"{key} is rated {rating_of(band, row)} by {row.get('labeler')}, and "
                        f"its block is Matt's {rating}s"
                    )
                found[band][rating].append(row)
    return found


def _order(found: dict[int, list[dict]]) -> list[tuple[int, dict]]:
    """One band's panels in group order: rating by rating, each a 2×2 block."""
    return [(rating, row) for rating in RATINGS for row in found[rating]]


def _family_words(family: dict) -> str:
    parts = [family["kind"] + (f" degree {family['degree']}" if "degree" in family else "")]
    for name in PHOENIX_CONSTANTS:
        if name in family:
            parts.append(f"{name} = {family[name][0]} + {family[name][1]}i")
    return ", ".join(parts)


def _stage(stage: dict) -> str:
    extra = "".join(f" {key} {value}" for key, value in stage.items() if key != "kind")
    return f"{stage.get('kind')}{extra}"


def _line(index: int, band: str, rating: int, row: dict) -> str:
    view = row["viewport"]
    where = (
        f"data/{row['_head']}/rows/{row['_batch']}.jsonl line {row['_line']}, rated {rating} "
        f"by hand by {row.get('labeler') or 'matt (an imported row, labeler null)'} on "
        f"{row['recorded_at']}."
    )
    frame = (
        f"panel {index}, {TITLES[band]}, rated {rating}: {_family_words(row['family'])}, "
        f"centre {view['center_re']} + {view['center_im']}i, width {view['width']}, mode "
    )
    word = "colormap" if index == 1 else "palette"
    if band == PLACES:
        return (
            f"{frame}smooth, {word} {renders.COLORMAP}, cap {row['render']['maxiter']} (the "
            f"neutral picture; the store names no map); {where}"
        )
    shade = row["recipe"]
    params = f" {json.dumps(row['mode_params'])}" if row.get("mode_params") else ""
    return (
        f"{frame}{row['mode']}{params}, curve {row['curve']}, {word} {row['colormap']}, "
        f"mirror {picks.flag(shade['mirror'])}, gamma {picks.number(shade['gamma'])}, cycles "
        f"{picks.number(shade['cycles'])}, phase {picks.number(shade['phase'])}, reverse "
        f"{picks.flag(shade['reverse'])}, transfer {_stage(shade['transfer'])}, rolloff "
        f"{_stage(shade['rolloff'])}, cap {row['render']['maxiter']}; {where}"
    )


def _alt(band: str, rating: int, row: dict) -> str:
    family = picks.family_name(row["family"])
    if band == PLACES:
        return f"A {family} location, drawn in one neutral palette, rated {rating}."
    kind = "wallpaper" if band == WALLPAPERS else "gallery picture"
    return (
        f"A {kind} drawn in {picks.mode_words(row['mode'])}, in the {family} family, "
        f"rated {rating}."
    )


def make() -> Split:
    """Three bands of sixteen panels, eight across: four of each rating, 1 left to 4 right."""
    found = _rows()
    taken = taken_places()
    linker = _Linker()
    seen: set = set()
    for band in BANDS:
        for rating in RATINGS:
            for row in found[band][rating]:
                spot = _place(row)
                if spot in taken or spot in seen:
                    raise LabelsError(f"{key_of(row)}: its place is already on the site")
                seen.add(spot)
                reason = linker.refusal(band, row)
                if reason is not None:
                    raise LabelsError(f"{key_of(row)} cannot be linked exactly: {reason}")
    size = panels(COLUMNS)
    catalog = renders.mode_catalog()
    cache = renders.Cache()
    made: list[Made] = []
    lines = [
        f"builder.tools_labels:make — three bands of {len(RATINGS) * PER_RATING} panels at "
        f"{size[0]}x{size[1]}, {COLUMNS} across and {PER_RATING // BLOCK} down, landed one file "
        f"a panel: in each band a rating is a {BLOCK}x{BLOCK} group, ratings 1 to 4 left to "
        "right, labelled once with its rating. Places are rows of data/labels "
        f"drawn fresh at {RENDER[0]}x{RENDER[1]}, supersample 3, mode smooth, in the neutral "
        f"map {renders.COLORMAP}, at the row's own cap. Wallpapers (data/smooth_render and "
        "data/strange_render) and gallery pictures (data/gallery_grade) are each one row drawn "
        "again from that row alone — family, frame, mode, mode settings, curve, map, the "
        "whole palette pass and the cap — by renders.wallpaper_spec at "
        f"{RENDER[0]}x{RENDER[1]}, supersample {SUPERSAMPLE}. Every panel is then "
        "centre-cropped and fitted. No tone operator acts on these renders, and none acted on "
        "the pictures that were rated: a gallery row graded through a levelled colormap is "
        "refused.",
        DRAW_RULE,
    ]
    for band in BANDS:
        for position, (rating, row) in enumerate(_order(found[band])):
            index = len(made) + 1
            name = f"{ID}-{band}-{rating}-{row['_head']}-{row['_batch']}-{row['_line']}"
            if band == PLACES:
                place = {
                    "family": row["family"],
                    "viewport": row["viewport"],
                    "maxiter": int(row["render"]["maxiter"]),
                }
                picture = cache.render(name, place, RENDER).path
            else:
                spec = renders.wallpaper_spec(
                    row, resolution=RENDER, supersample=SUPERSAMPLE, catalog=catalog
                )
                picture = cache.produce(name, "render", spec).path
            made.append(
                Made(
                    sheets.save(sheets.fitted(picture, size), panel_path(ID, index), quiet=True),
                    alt=_alt(band, rating, row),
                    spec=panel_spec(band, row),
                    band={"title": TITLES[band], "columns": COLUMNS} if position == 0 else None,
                    group=(
                        {"label": str(rating), "columns": BLOCK}
                        if position % PER_RATING == 0
                        else None
                    ),
                )
            )
            lines.append(_line(index, band, rating, row))
    return Split(made, lines, COLUMNS)


def sources() -> list[dict]:
    """The forty-eight store rows, in panel order: places as locations, the rest as rows."""
    found = _rows()
    places = [key_of(row) for _, row in _order(found[PLACES])]
    rows = [key_of(row) for band in (WALLPAPERS, GALLERY) for _, row in _order(found[band])]
    return [
        {"kind": figures_module.LOCATION, "keys": places},
        {"kind": figures_module.RUN_ROW, "keys": rows},
    ]


def recipe() -> dict:
    return {
        "maker": f"{__name__}:make",
        "args": {
            "stores": {band: list(STORES[band]) for band in BANDS},
            "labelers": list(LABELERS),
            "seed": SEED,
            "per_rating": PER_RATING,
        },
    }


def main() -> None:
    """Run the draw and print what it takes, for freezing into `PICKS`."""
    chosen, log, counts = draw()
    print(*log, sep="\n")
    print(json.dumps(counts, indent=1))
    print(
        json.dumps(
            {band: {str(k): v for k, v in held.items()} for band, held in chosen.items()}, indent=1
        )
    )


if __name__ == "__main__":
    main()
