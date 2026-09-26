"""The Overview page's pipeline figure: three stages down one sheet.

Recovered into the repository on 2026-09-06 from a discarded scratch tree, under the rule
in `CLAUDE.md` that a figure's maker is tracked.

    python -m builder overview overview-pipeline

One location is followed through all three stages, which is the figure's whole subject:
`72b1680f` is the first pick of stage one, the whole of stage two, and the first pick of
stage three, and that recurrence is the only reason the three bands are about one project
rather than three.

**The stage-two draw is frozen, not re-run.** It was found by
`random.Random(20260902).sample` over the authored maps of the colorize pool, and the pool
next door grows; re-running the sample at draw time would quietly recolour three panels of
a committed figure. So the maps are written down here and the seed is recorded as how they
were found — the rule in `CLAUDE.md` that a maker addresses a location by its record. The
fold flag is still derived, because it is a property of the map rather than a choice, but
it is held to what the record says it was.
"""

from __future__ import annotations

from . import figures as figures_module
from . import links, picks, renders, sheets
from . import palettes as palette_library
from .locations import Made, Split, panel_path
from .sheets import PAD, canvas
from .theme import MARK_INK

FIGURE = "overview-pipeline"

#: How many locations each of the outer bands shows.
FOUND = 3
CHOSEN = 3

#: The seed the stage-two draw was found with. Recorded, never re-run — see the module
#: docstring.
SHADE_SEED = 20260902

#: The four maps stage two lays the followed frame out in, in reading order: the map the
#: run kept, then the three the seeded draw took from the authored maps of the colorize
#: pool. Frozen off the figure's own provenance; the first was re-pointed with the
#: followed seat on 2026-09-26 (publishing_fixes_ckpt152).
SHADES = (
    "Ember Terracotta",
    "Green, Gold, Magenta",
    "Sulphur & Plum",
    "Mist Field, Ink Well",
)

#: Whether each of those is folded, as the record says it was. Derived from the library at
#: draw time and checked against this, so a map changing kind next door is a refusal rather
#: than a figure that quietly redraws.
FOLDED = (False, False, False, False)

#: What the sheet was composed at, and so what one panel of a band is across. The
#: lettering metrics the sheet needed — the title's size, the leading, the boxes and the
#: gutter the arrow was drawn in — are the stylesheet's now and are gone from here.
SHEET = 1344
STRIP = 16

#: The three parts, in the shape the Overview page frames the project in.
#: What each stage is called, what it does, the boxes down its right-hand side, and which
#: of those is a judge. The sentence used to be two hard-broken lines, because it was
#: drawn into a sheet; as the page's own text it is one sentence that wraps, and the
#: em-dash the second one carried — invisible to the site's sweep while it was pixels —
#: is a colon.
STAGES = (
    (
        "1 · Find good locations",
        "A guided walk descends through a family, keeping the frames worth drawing.",
        ("structural gates", "location judge"),
        (1,),
    ),
    (
        "2 · Render them beautifully",
        "One frame is drawn many ways: several modes, and a neighborhood of palettes.",
        ("the mode roster · 32 palettes a location", "wallpaper judge"),
        (1,),
    ),
    (
        "3 · Gallery curation",
        "A gallery is chosen out of the pool those attempts fill: quality first, then range.",
        ("one seat to a location · no near-duplicates", "color balance · every mode"),
        (),
    ),
)


def band_of(stage, columns: int) -> dict:
    """One stage as the band its panels open.

    `columns` is that band's own, because the three are not the same width: three
    locations, then four colorings, then three wallpapers. `arrow` is the hand-off, on
    every band but the first.
    """
    title, note, blocks, judges = stage
    return {
        "title": title,
        "note": note,
        "blocks": [{"text": text, "judge": index in judges} for index, text in enumerate(blocks)],
        "columns": columns,
        "arrow": stage is not STAGES[0],
    }


class OverviewError(RuntimeError):
    """The figure cannot be drawn as its record describes it."""


def _panel_size(columns: int) -> tuple[int, int]:
    """The panel that fills the sheet in this many columns, at 16:9."""
    width = (SHEET - (columns + 1) * PAD) // columns
    return width, round(width * 9 / 16)


def _slug(name: str) -> str:
    return "".join(character if character.isalnum() else "-" for character in name).strip("-")


def _mirror(name: str) -> bool:
    """Whether this map is folded — the pipeline's own rule, which is the map's kind.

    `colorize.py` spells it `colormap not in self.cyclic` and `palettes.Palette.mirror`
    spells it here. Mirror is not a knob this row holds fixed; it follows the map, so a
    cyclic map arrives unfolded and the engine is never asked to halve a cycle.
    """
    return palette_library.library()[name].mirror


def _check_folds() -> None:
    """Hold the derived fold flags to what the figure's record says they were."""
    derived = tuple(_mirror(name) for name in SHADES)
    if derived != FOLDED:
        moved = [
            f"{name}: recorded {was}, library now says {now}"
            for name, was, now in zip(SHADES, FOLDED, derived, strict=True)
            if was is not now
        ]
        raise OverviewError(
            "the palette library disagrees with this figure's record about which of its "
            "maps fold, so a redraw would not be the committed picture — " + "; ".join(moved)
        )


def _family_words(family: dict) -> str:
    """A family spelled the way every provenance line on this site spells one."""
    kind = family.get("kind")
    named = f"family {kind}"
    if kind in ("multibrot", "julia"):
        named += f", degree {family.get('degree', 2)}"
    for constant in ("c", "p", "z_prev"):
        if family.get(constant):
            named += f", {constant} = {family[constant][0]} + {family[constant][1]}i"
    return named


LEVEL_OPERATOR = "band_autolevel/v1"


def _coloured(cache, followed, name: str, catalog, *, kept: bool):
    """One coloring of the followed frame, and the tone curve its link has to carry.

    `_coloring` beside this draws the picture; this is the same answer with the curve
    kept rather than thrown away, because a link that says nothing about tone draws the
    render underneath and the whole middle band is autolevelled. The kept map replays the
    run's own stamp, which is what makes that panel the same picture as the one in stage
    three; the other three exist only in this figure and the operator measures them here.
    """
    row = picks.wallpaper_row(followed)
    row["colormap"] = name
    row["recipe"] = dict(row["recipe"], mirror=_mirror(name))
    spec = renders.wallpaper_spec(row, resolution=(1280, 720), supersample=3, catalog=catalog)
    base = cache.produce(f"pipe-shade-{_slug(name)}", "render", spec).path
    if kept:
        levelling = picks.run_stamp(followed)
        if levelling.way != picks.REPLAYED:
            return base, None, row
        level, _why = links.panel_level(followed)
        directory = picks.levelled_colormap(followed, levelling.stamp)
    else:
        measured = renders.measured_stops(name, base)
        if measured is None:
            return base, None, row
        curve = measured["curve"]
        level = {
            "operator": LEVEL_OPERATOR,
            "black_pt": float(curve["black_pt"]),
            "white_pt": float(curve["white_pt"]),
            "exponent": float(curve["exponent"]),
            "out_ends": [float(curve["out_ends"][0]), float(curve["out_ends"][1])],
        }
        directory = renders.colormap_directory(
            name,
            measured["kind"],
            measured["stops"],
            renders.spec_key("levelled", {"colormap": name, "curve": curve}),
        )
    drawn = cache.produce(
        f"pipe-shade-{_slug(name)}-levelled", "render", dict(spec, colormap_dir=str(directory))
    ).path
    return drawn, level, row


def _shade_spec(row: dict, name: str, level) -> dict:
    """One middle-band panel's record: the followed frame through one map, tone and all."""
    spec = {
        "family": row["family"],
        "viewport": row["viewport"],
        "mode": row["mode"],
        "mode_params": row.get("mode_params") or {},
        "curve": row.get("curve", "linear"),
        "colormap": name,
        "palette": row.get("recipe") or {},
        "maxiter": (row.get("render") or {}).get("maxiter"),
    }
    if level is not None:
        spec["level"] = level
    return spec


def pipeline() -> Split:
    """Three stages down the figure, one location followed through all of them.

    **Ten pictures rather than one** *(figure_split_all_ckpt140, 2026-09-22)*. The stage
    headings, the boxes down their right-hand side and the arrows between them are the
    page's own elements now; what stays in the pixels is the pictures and the gradient
    strip under each of the middle band's four, which is the map that panel spends. Each
    band keeps its own number across — three, four, three — which one grid cannot do and
    a band each can.

    The middle band's links carry the tone curve the panel was drawn through. Three of
    those four colorings exist only in this figure, so the curve is the one this
    repository measured for them; the fourth replays the run's own stamp, which is what
    makes it the same picture as the first panel of stage three.
    """
    from PIL import Image

    _check_folds()
    wanted = picks.picks_of(FIGURE)
    if len(wanted) != FOUND + CHOSEN:
        raise OverviewError(
            f"{FIGURE} shows {FOUND} found and {CHOSEN} chosen and its row names "
            f"{len(wanted)} pick(s)"
        )
    resolved = picks.resolve(wanted)
    found, chosen = resolved[:FOUND], resolved[FOUND:]
    followed = found[0]
    catalog = renders.mode_catalog()
    cache = renders.Cache()

    wide, tall = _panel_size(FOUND)
    narrow, short = _panel_size(len(SHADES))

    made: list[Made] = []
    for index, pick in enumerate(found):
        # The locations as the walk found them: the neutral map, so what a reader is
        # being shown is the geometry rather than anybody's colour choice.
        spec = {
            "family": pick.recipe["family"],
            "viewport": pick.recipe["viewport"],
            "mode": "smooth",
        }
        drawn = cache.render(f"pipe-found-{pick.alias}", spec, (wide, tall))
        tile, _ = canvas(wide, tall)
        with Image.open(drawn.path) as opened:
            tile.paste(opened.convert("RGB"), (0, 0))
        made.append(
            Made(
                sheets.save(tile, panel_path(FIGURE, len(made) + 1)),
                alt="A location the walk found, drawn in one neutral palette.",
                spec=dict(spec, colormap=renders.COLORMAP),
                band=band_of(STAGES[0], FOUND) if index == 0 else None,
            )
        )

    for index, name in enumerate(SHADES):
        kept = index == 0
        picture, level, row = _coloured(cache, followed, name, catalog, kept=kept)
        tile, _ = canvas(narrow, short + 4 + STRIP)
        with Image.open(picture) as opened:
            tile.paste(opened.convert("RGB").resize((narrow, short), Image.LANCZOS), (0, 0))
        sheets.paste(
            tile, palette_library.strip(name, narrow, STRIP), (0, short + 4), (narrow, STRIP)
        )
        # No palette names on this row *(Matt, 2026-09-02)*. What the row is showing is
        # that a colorize tries many maps and one is kept; a reader cannot do anything
        # with `cet_linear_wyor_100_45_c55` under a picture, and four such names turn a
        # band of colour into a band of text. The gradient under each panel is the map,
        # said in the only language that matters here, and the names stay in the
        # provenance.
        made.append(
            Made(
                sheets.save(tile, panel_path(FIGURE, len(made) + 1)),
                alt=(
                    "The followed location colored through one palette, with that "
                    "palette's gradient under it."
                ),
                label="the pick" if kept else None,
                spec=_shade_spec(row, name, level),
                ink="#{:02X}{:02X}{:02X}".format(*MARK_INK[0]) if kept else None,
                band=band_of(STAGES[1], len(SHADES)) if index == 0 else None,
            )
        )

    for index, pick in enumerate(chosen):
        tile, _ = canvas(wide, tall)
        tile.paste(
            sheets.fitted(picks.panel(pick, f"pipe-chosen-{pick.alias}", catalog), (wide, tall)),
            (0, 0),
        )
        made.append(
            Made(
                sheets.save(tile, panel_path(FIGURE, len(made) + 1)),
                alt="A finished wallpaper the gallery solve chose.",
                seat=pick.identifier,
                band=band_of(STAGES[2], CHOSEN) if index == 0 else None,
            )
        )

    return Split(made, _provenance(found, chosen, (wide, tall), (narrow, short)), FOUND)


def _provenance(found, chosen, big, small) -> list[str]:
    """One line per panel, and a preamble the first stage's three panels sit under."""
    followed = found[0]
    recipe = followed.recipe
    stamps = sorted({pick.stamp for pick in [*found, *chosen]})
    lines = [
        "builder.overview:pipeline — three stages down the sheet, "
        f"{SHEET} wide on the site's well. Every location on it is a seat of a recorded "
        "tentative gallery, named on this row by its own `<stamp>|<recipe key>` and "
        "resolved from artifacts/curation/tentative/<stamp>/gallery.jsonl for the seat and "
        f"the candidate ledger for the recipe. Stamp{'s' if len(stamps) > 1 else ''} "
        f"{', '.join(stamps)}.",
        f"Stage 1, three locations at {big[0]}x{big[1]}: each drawn fresh through the "
        f"engine at that size, supersample 3, mode smooth, colormap {renders.COLORMAP}, "
        "cap from the depth-aware policy, no crop — the neutral map every figure that is "
        "not about colour uses, because what the stage is showing is the geometry the walk "
        "found rather than any coloring of it. Panels in reading order.",
    ]
    for pick in found:
        family, viewport = pick.recipe["family"], pick.recipe["viewport"]
        lines.append(
            f"{picks.family_name(family)}: gallery seat {pick.identifier}, alias "
            f"{pick.alias}, seat {pick.seat.get('seat')}, partition "
            f"{pick.seat.get('partition')} — {_family_words(family)}, centre "
            f"{viewport['center_re']} + {viewport['center_im']}i, width {viewport['width']}."
        )
    lines.append(
        f"Stage 2, {len(SHADES)} colorings of {followed.alias}'s own frame at "
        f"{small[0]}x{small[1]}: rendered fresh at 1280x720, supersample 3, and fitted. "
        "Everything but the palette is held at that recipe's own pass — mode "
        f"{recipe['mode']}, curve {recipe['curve']}, cap {recipe['maxiter']}; "
        f"{picks.shade_words(recipe['palette'])} — so the only thing changing across the "
        "row is the colour. The marked panel is the map the run kept; the other three were "
        "a uniform draw without replacement from the **authored** maps of the pool a "
        "colorize may pick between, data/palette_choice/pool.json — the maps written "
        "against the palette prompt rather than extracted from a picture or converted from "
        f"an upstream library — random.Random({SHADE_SEED}).sample. Not a neighbourhood of "
        "the kept map, so the row shows the spread a colorize is choosing out of. The three "
        "are written down in the maker rather than re-drawn at draw time, because the pool "
        "grows and a re-run would recolour a committed figure. In reading order: "
        + "; ".join(f"palette `{name}`" for name in SHADES)
        + ". No name is drawn on the row: a map's name tells a reader nothing the gradient "
        "under the panel does not, and four of them turn a band of colour into a band of "
        "text."
    )
    lines.append(
        "Mirror follows the map here rather than being held at the kept recipe's flag: "
        "`colorize.py` sets it as `colormap not in self.cyclic` and this row does the same, "
        "so a cyclic map arrives unfolded and the engine is never asked to halve a cycle. "
        "That is also why a cyclic map is no longer dropped from the draw, which it used to "
        "be — holding the flag fixed was the thing that made it impossible, and every "
        "authored map is cyclic. The flags are derived from the library and held to this "
        "row's own record, so a map changing kind next door is a refusal rather than a "
        "quiet redraw. Folded here: "
        + "; ".join(f"`{name}` {picks.flag(_mirror(name))}" for name in SHADES)
        + "."
    )
    lines.append(
        "Every panel of this row is autolevelled, because an attempt is not finished at the "
        "render: the operator measures the picture's tone and, where it sits outside the "
        "band, pushes a curve through the map's own stops and draws again. The marked panel "
        "replays the run's own stamp, which is what makes it the same picture as the one in "
        "stage 3 rather than a shade lighter; the other three exist only in this figure, "
        "have no run and no stamp behind them, and are measured here by "
        "`autolevel.derive_curve` and drawn through `curved_stops` — the operator acting, "
        "not a second reading of something it already did."
    )
    lines.append(
        f"Stage 3, three seats of the same recorded gallery at {big[0]}x{big[1]}: each "
        "rendered fresh through the engine at 1280x720, supersample 3, and fitted. Nothing "
        "about the coloring is this figure's choice — mode, mode settings, curve, map, the "
        "whole palette pass and the cap all come off the ledger's recipe."
    )
    lines.append(picks.autolevel_line(chosen))
    lines += [picks.frame_line(pick, representative=False) for pick in chosen]
    lines.append(
        f"{followed.alias} stands in all three stages by design: the figure's subject is "
        "one location carried through the pipeline, so the same frame is the walk's find, "
        "the thing being colored, and a seat of the gallery. It is drawn neutrally in stage "
        "1, in four maps in stage 2, and in the map the run kept in stage 3."
    )
    return lines


#: Figure id to the maker that draws it. The one figure here is **split** since
#: `figure_split_all_ckpt140`, so what the maker returns is a list of pictures and the
#: bands they stand in, and the file names are `images.FIGURE_SUFFIX`'s at landing.
SHEETS = {FIGURE: pipeline}


def recipe(identifier: str) -> dict:
    """The registry recipe: the maker, and the six gallery seats the row already names."""
    if identifier not in SHEETS:
        raise OverviewError(f"{identifier} is not drawn by builder.overview")
    args = {}
    figure = figures_module.load_all().get(identifier)
    if figure is not None and figure.recipe is not None and "picks" in figure.recipe.args:
        args["picks"] = figure.recipe.args["picks"]
    return {"maker": f"{__name__}:{SHEETS[identifier].__name__}", "args": args}


def draw(identifier: str) -> Split:
    """Draw the figure's panels into `artifacts/figures/`; `--place` encodes and lands."""
    return SHEETS[identifier]()
