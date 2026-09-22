"""The Overview page's pipeline figure: three stages down one sheet.

Recovered into the repository on 2026-09-06 from a discarded scratch tree, under the rule
in `CLAUDE.md` that a figure's maker is tracked.

    python -m builder overview overview-pipeline

One location is followed through all three stages, which is the figure's whole subject:
`a693d6c7` is the first pick of stage one, the whole of stage two, and the first pick of
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

from pathlib import Path

from . import images, picks, renders, sheets
from . import palettes as palette_library
from .paths import FIGURE_IMAGES_DIR
from .sheets import PAD, canvas, tile_label
from .theme import (
    MARK_INK,
    SECTION_INK,
    SEMIBOLD,
    WELL_INK,
    WELL_INK_DIM,
    WELL_PANEL,
    WELL_RULE,
    font,
)

FIGURE = "overview-pipeline"

#: How many locations each of the outer bands shows.
FOUND = 3
CHOSEN = 3

#: The seed the stage-two draw was found with. Recorded, never re-run — see the module
#: docstring.
SHADE_SEED = 20260902

#: The four maps stage two lays the followed frame out in, in reading order: the map the
#: run kept, then the three the seeded draw took from the authored maps of the colorize
#: pool. Frozen off the figure's own provenance.
SHADES = (
    "cmr.prinsenvlag",
    "Green, Gold, Magenta",
    "Sulphur & Plum",
    "Mist Field, Ink Well",
)

#: Whether each of those is folded, as the record says it was. Derived from the library at
#: draw time and checked against this, so a map changing kind next door is a refusal rather
#: than a figure that quietly redraws.
FOLDED = (True, False, False, False)

SHEET = 1344
TITLE = 25
LINE = 16
HEAD = TITLE + 6 + 2 * LINE
BLOCK = 32
BLOCK_WIDTH = 310
BLOCK_GAP = 12
STRIP = 16
GUTTER = 30

#: The three parts, in the shape the Overview page frames the project in.
STAGES = (
    (
        "1 · Find good locations",
        ("A guided walk descends through a family,", "keeping the frames worth drawing."),
        ("structural gates", "location judge"),
        (1,),
    ),
    (
        "2 · Render them beautifully",
        ("One frame is drawn many ways — several", "modes, and a neighborhood of palettes."),
        ("the mode roster · 32 palettes a location", "render judge"),
        (1,),
    ),
    (
        "3 · Gallery curation",
        ("A gallery is chosen out of the pool those", "attempts fill: quality first, then range."),
        ("one seat to a location · no near-duplicates", "color balance · every mode"),
        (),
    ),
)


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


def _coloring(cache, followed, name: str, catalog, *, kept: bool):
    """One coloring of the followed frame, autolevelled the way the attempt was.

    The middle band is four colorize attempts on one frame, and an attempt does not stop at
    the render: the operator measures its tone and, where it falls outside the band, pushes
    a curve through the map's stops and draws again. The caption says the tones are
    balanced, so the panels have to be.

    The kept map replays the run's **own** stamp rather than a curve measured here, which
    is what makes this panel the same picture as the one in stage three. For the other
    three there is no run and no stamp — these colorings exist only in this figure — so the
    operator measures them here, which is it acting rather than a second reading of
    something it already did.
    """
    row = picks.wallpaper_row(followed)
    row["colormap"] = name
    row["recipe"] = dict(row["recipe"], mirror=_mirror(name))
    spec = renders.wallpaper_spec(row, resolution=(1280, 720), supersample=3, catalog=catalog)
    base = cache.produce(f"pipe-shade-{_slug(name)}", "render", spec).path
    if kept:
        levelling = picks.run_stamp(followed)
        if levelling.way != picks.REPLAYED:
            return base
        directory = picks.levelled_colormap(followed, levelling.stamp)
    else:
        measured = renders.measured_stops(name, base)
        if measured is None:
            return base
        directory = renders.colormap_directory(
            name,
            measured["kind"],
            measured["stops"],
            renders.spec_key("levelled", {"colormap": name, "curve": measured["curve"]}),
        )
    return cache.produce(
        f"pipe-shade-{_slug(name)}-levelled", "render", dict(spec, colormap_dir=str(directory))
    ).path


def _heading(draw, y: int, stage) -> None:
    """One stage's band: its name and what it does, and the pieces it is made of."""
    title, lines, blocks, judges = stage
    draw.text((PAD, y), title, fill=WELL_INK, font=font(TITLE, SEMIBOLD))
    for index, line in enumerate(lines):
        draw.text((PAD, y + TITLE + 6 + index * LINE), line, fill=SECTION_INK, font=font(15))
    left = SHEET - PAD - len(blocks) * BLOCK_WIDTH - (len(blocks) - 1) * BLOCK_GAP
    top = y + (HEAD - BLOCK) // 2
    for index, text in enumerate(blocks):
        x = left + index * (BLOCK_WIDTH + BLOCK_GAP)
        judge = index in judges
        ink = MARK_INK[0] if judge else WELL_INK_DIM
        edge = MARK_INK[0] if judge else WELL_RULE
        draw.rectangle(
            [x, top, x + BLOCK_WIDTH - 1, top + BLOCK - 1], fill=WELL_PANEL, outline=edge
        )
        face = font(15)
        _, above, _, below = draw.textbbox((0, 0), text, font=face)
        sheets.centred(
            draw, x, top + (BLOCK - (below - above)) // 2 - above, BLOCK_WIDTH, text, face, ink
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


def _arrow(draw, y: float) -> None:
    """The step from one stage to the next, pointing down the sheet."""
    x = SHEET / 2
    draw.line([x, y - 8, x, y], fill=WELL_INK_DIM, width=4)
    draw.polygon([(x, y + 9), (x - 8, y + 1), (x + 8, y + 1)], fill=WELL_INK_DIM)


def pipeline(destination: Path) -> tuple[tuple[int, int], list[str]]:
    """Three stages down the sheet, one location followed through all of them."""
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
    label_band = sheets.caption_band(short, SHEET, 1)

    bands = [
        HEAD + 8 + tall,
        HEAD + 8 + short + 4 + STRIP + label_band,
        HEAD + 8 + tall,
    ]
    height = PAD + sum(bands) + 2 * GUTTER + PAD
    sheet, draw = canvas(SHEET, height)

    y = PAD
    for stage, band in zip(STAGES, bands, strict=True):
        _heading(draw, y, stage)
        top = y + HEAD + 8

        if stage is STAGES[0]:
            # The locations as the walk found them: the neutral map, so what a reader is
            # being shown is the geometry rather than anybody's colour choice.
            for index, pick in enumerate(found):
                x = PAD + index * (wide + PAD)
                spec = {
                    "family": pick.recipe["family"],
                    "viewport": pick.recipe["viewport"],
                    "mode": "smooth",
                }
                drawn = cache.render(f"pipe-found-{pick.alias}", spec, (wide, tall))
                with Image.open(drawn.path) as opened:
                    sheet.paste(opened.convert("RGB"), (x, top))
        elif stage is STAGES[1]:
            for index, name in enumerate(SHADES):
                x = PAD + index * (narrow + PAD)
                kept = index == 0
                drawn = _coloring(cache, followed, name, catalog, kept=kept)
                with Image.open(drawn) as opened:
                    sheet.paste(
                        opened.convert("RGB").resize((narrow, short), Image.LANCZOS), (x, top)
                    )
                sheets.paste(
                    sheet,
                    palette_library.strip(name, narrow, STRIP),
                    (x, top + short + 4),
                    (narrow, STRIP),
                )
                # No palette names on this row *(Matt, 2026-09-02)*. What the row is
                # showing is that a colorize tries many maps and one is kept; a reader
                # cannot do anything with `cet_linear_wyor_100_45_c55` under a picture, and
                # four such names turn a band of colour into a band of text. The gradient
                # under each panel is the map, said in the only language that matters here,
                # and the names stay in the provenance.
                if kept:
                    tile_label(
                        draw,
                        (x, top),
                        (narrow, short + 4 + STRIP),
                        ["the pick"],
                        SHEET,
                        lead=WELL_INK,
                    )
                    sheets.framed(draw, (x, top), (narrow, short), MARK_INK[0], width=3)
        else:
            for index, pick in enumerate(chosen):
                x = PAD + index * (wide + PAD)
                picture = picks.panel(pick, f"pipe-chosen-{pick.alias}", catalog)
                sheet.paste(sheets.fitted(picture, (wide, tall)), (x, top))

        y += band
        if stage is not STAGES[-1]:
            _arrow(draw, y + GUTTER / 2)
            y += GUTTER

    provenance = _provenance(found, chosen, (wide, tall), (narrow, short))
    return images.land(sheet, destination), provenance


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


#: Figure id to the file it writes and the maker that writes it. The file is the id plus
#: `images.FIGURE_SUFFIX`, so the format is named once for the whole repository.
SHEETS = {"overview-pipeline": (f"overview-pipeline{images.FIGURE_SUFFIX}", pipeline)}


def draw(identifier: str) -> tuple[Path, int, int, list[str]]:
    """Draw one figure into the figures directory; return where it went and its size."""
    file, maker = SHEETS[identifier]
    destination = FIGURE_IMAGES_DIR / file
    (width, height), provenance = maker(destination)
    return destination, width, height, provenance
