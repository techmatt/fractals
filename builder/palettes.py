"""The figures of the Color palettes page, and the palette library's own page.

Section 5's figures are about a search and section 6's are about verdicts, so those two
modules read walk ledgers and score files. This page's subject is the *library*, so this
module reads four things next door and nothing else:

* the **colormap library** itself — one JSON per palette, and the `provenance.jsonl`
  saying which of them were authored against the palette prompt and under which mood family;
* the **carrier table** that repository ships, `carriers.jsonl`, which says which
  codebook cell each map comes out dominant in — a reading of the library rather than
  something the pipeline consumes, and the one thing the library page groups on;
* the **finished-render label stores**, for the locations: every single-location figure
  here stands on a frame Matt rated 4, addressed by the file and line it sits at;
* the **palette head**, for the two figures whose subject is a ranking — asked through
  `renders.palette_scores`, which is that project's own loader and its own transform.

## A strip is the gradient, drawn by the thing that renders it

Every figure here shows palettes as **strips**, and no strip is drawn in Python. The
wallpaper project's `palettes strip` writes a horizontal ramp as a field and colors it
through the engine — same OKLab bake, same 4,096-entry table, same fold — so a strip on
this page and a picture beside it cannot disagree about what a palette is. One artifact
travels with that and is not compensated for: the coloring normalizes against its own
0.5/99.5 percentiles, so the outer half a per cent of a strip's width is its end colour
held flat.

## What a panel is, and what it is not

Every panel that shows a location is the **same frame drawn the same neutral way** and
varied in the palette alone, which is the geometry case of the figure rule: the subject
is what a palette does, so nothing else may move. The cap is the engine's own depth
policy rather than the cap the rated picture was drawn to — a link carries a place and
not a budget, and a figure of this page is worth being able to open.

`palette-autolevel` is the one exception, and deliberately: its subject is a record, so
both its panels come off a release row and are drawn exactly as that row says.

## The word `colormap` in a provenance line bakes a palette into the explorer

`explorer.py` reads the figure registry for the maps this site's own pictures were drawn
in, and bakes each one into `palettes.js` so a link can name it. It finds them by the
word `colormap` in front of a name. A sheet here shows up to eighty palettes and gets
**one** link, at its representative panel, so exactly one line of each row's provenance
says `colormap`; every other line names its palette without that word. The alternative
is a browser page carrying hundreds of gradients so that a sheet of strips could be
opened at a picture it does not show.
"""

from __future__ import annotations

import json
import random
import re
from dataclasses import dataclass
from pathlib import Path

from . import records, renders, sheets
from .locations import SHEET_WIDTH, Drawn, panels, release_record, sheet_path
from .paths import SITE_ROOT
from .theme import WELL_INK, WELL_INK_DIM, font, text_width

# --------------------------------------------------------------------------- the library

#: Where the tracked colormap library is, in the wallpaper project.
LIBRARY = ("data", "palettes")

#: The dominant-colour reading of every map in that library, one row per (map, cell) the
#: map carries on at least one of three pinned reference fields. A row already names the
#: hue family its cell rolls up to, so nothing here re-derives the codebook.
CARRIERS = "carriers.jsonl"

#: The twelve hue names of the codebook's chromatic half — 48 cells, twelve hues by
#: {dark, light} by {muted, vivid} — in the wheel's own order, which is the order the
#: library page lays its sections out in. Spelled here rather than imported: the codebook
#: is that repository's module and this record has to build on a machine with no checkout.
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

#: The shipped pool a colorize may draw from: 900 of the 901 maps, `blue_orange` apart.
#: What a run actually *draws* from is narrower again — the project stands one member of
#: each set of near-duplicates, which takes 900 to 822. That reading is the pipeline's and
#: not the library page's: the page shows every map in its own right.
POOL = ("data", "palette_choice", "pool.json")

#: What a strip is drawn at inside a full-width sheet, and inside a panel's own cell.
STRIP_HEIGHT = 24
TILE_STRIP_HEIGHT = 12

#: What a panel is rendered at before it is fitted to its cell: twice the widest cell any
#: figure here uses, so the filigree that a palette's bright band lands on survives.
RENDER = (860, 484)
SUPERSAMPLE = 2

#: The frames every single-location figure stands on, addressed by the store file and
#: the line inside it. All seven are rows Matt rated 4 by hand; none is a machine pick.
#: `fire_ice` is deliberately not a spiral *(Matt, 2026-08-22)*: the rated-4 mandelbrot
#: rows are overwhelmingly spirals, and a page whose figures are all one shape teaches
#: the shape rather than the subject.
#:
#: `phoenix` is chosen for how much of a ramp it spends *(Matt, 2026-08-22)*. The frame
#: this row used to carry covered 0.176 of the stretched range between its 5th and 95th
#: percentiles, so each of its three panels showed a sliver of its column's map and the
#: row taught nothing; this one covers 0.57, which is what the mandelbrot and julia rows
#: above it cover. Of the 33 phoenix frames rated 4, the old one ranked 25th by that
#: measure.
FRAMES = {
    "mandelbrot": ("pool_draw_human_good", 451),
    "julia": ("bucketed_correction", 57),
    "phoenix": ("released_top_end", 39),
    "fire_ice": ("blind_minibrot", 17),
    "params": ("dramatic_palettes", 48),
    "spread": ("blind_minibrot", 56),
    "neighborhood": ("pool_draw_human_good", 683),
}

#: The three palettes the opening figure's columns are: three authored maps far apart by
#: the descriptor distance, so the columns differ by more than a hue.
OPENING_PALETTES = ("Amber Highlands", "Petrol & Coral", "Wisteria Nightfall")

#: The palette the knobs figure is spent on, and what it is spent at. Cycles first,
#: then phase at a fixed three cycles — the row that shows what phase does needs the
#: gradient repeating, or there is nothing for a rotation to move.
KNOB_PALETTE = "Ember Rising"
KNOB_CYCLES = (1, 2, 3, 5, 8)
KNOB_PHASES = (0.0, 0.2, 0.4, 0.6, 0.8)
KNOB_PHASE_CYCLES = 3

#: The anchor the neighborhood figure's candidate set is built around, and the seed the
#: uniform row underneath it is drawn with. Both written down rather than derived: the
#: run that drew a real set is a run this repository does not have, and an arbitrary
#: choice recorded is better than an arbitrary choice recomputed.
NEIGHBORHOOD_ANCHOR = "Petrol & Coral"
NEIGHBORHOOD_SEED = 20260821
SPREAD_SEED = 20260822
SPREAD_WIDE = 12

#: How the spread figure's twelve panels are laid out *(Matt, 2026-08-22, replacing six
#: across by two down)*. Four across gives each panel half again the width, which is what
#: a reader needs to see that most of these colorings are wrong; the twelve and their
#: order are untouched.
SPREAD_COLUMNS = 4

#: The batch the generator page shows: the largest one shipped, so a reader sees what a
#: single run of the prompt actually produces rather than a trimmed version of it.
GENERATOR_BATCH = "sapphire-rose_c3-4_v3_1.json"

#: A mood family that shipped no batch cannot be represented, and the roster is read off
#: the records rather than restated. `span` is a run knob rather than a family and is
#: left out of the figure; the page's prose says what it is.
NOT_A_FAMILY = "span"

#: `.gitattributes` normalizes this repository to LF; anything written here spells it.
LF = "\n"


class PaletteError(RuntimeError):
    """A figure of this page cannot be drawn from what the records say."""


@dataclass(frozen=True)
class Palette:
    """One map of the library: its name, whether it closes, and what made it."""

    name: str
    cyclic: bool
    source: str
    mood_family: str | None

    @property
    def mirror(self) -> bool:
        """Whether a render folds it — the pipeline's rule, and the strip's default."""
        return not self.cyclic


def library() -> dict[str, Palette]:
    """Every palette the wallpaper project tracks, keyed by name."""
    directory = renders.data_file(*LIBRARY)
    made = {}
    for line in renders.jsonl(directory / "provenance.jsonl"):
        made[line["name"]] = (line["source"], line.get("mood_family"))
    found = {}
    for path in sorted(directory.glob("*.json")):
        loaded = json.loads(path.read_text(encoding="utf-8"))
        source, mood = made.get(loaded["name"], ("converted", None))
        found[loaded["name"]] = Palette(loaded["name"], loaded["kind"] == "cyclic", source, mood)
    return found


def dominant_hues() -> dict[str, str]:
    """Every map's dominant hue, keyed by name: the one word the library page groups on.

    The tracked carrier table next door reads each map onto three pinned reference fields
    and writes a row for every codebook cell the map is *dominant* in on at least one of
    them, with that cell's mean share across the three and the hue family it rolls up to.
    A map's hue is the family of its largest such row — the colour it puts most of a
    picture in, measured on pictures rather than on the ramp.

    Ties are broken by the cell's own name, so the answer cannot depend on the order the
    rows were written; at the time of writing no map has one. Every one of the 901 maps
    carries at least one cell, which is why the page needs no section for the colourless:
    a map that carried none would reach no section at all, and `_uncarried` says so.
    """
    best: dict[str, tuple[float, str, str]] = {}
    for row in renders.jsonl(renders.data_file(*LIBRARY) / CARRIERS):
        if row.get("kind") != "carrier":
            continue
        mark = (float(row["mean"]), str(row["cell"]))
        held = best.get(row["map"])
        if held is None or mark > (held[0], held[1]):
            best[row["map"]] = (mark[0], mark[1], str(row["family"]))
    return {name: family for name, (_, _, family) in best.items()}


def pool() -> list[str]:
    """The maps a colorize may pick between, in the order that record holds them."""
    loaded = json.loads(renders.data_file(*POOL).read_text(encoding="utf-8"))
    return list(loaded["pool"])


def batches() -> dict[str, list[str]]:
    """Every authored batch, in name order, keyed by the file the run wrote."""
    found: dict[str, list[str]] = {}
    for line in renders.jsonl(renders.data_file(*LIBRARY) / "provenance.jsonl"):
        if line.get("source") != "authored":
            continue
        found.setdefault(line["batch"], []).append(line["name"])
    return {batch: sorted(names) for batch, names in found.items()}


def mood_families(held: dict[str, Palette]) -> dict[str, list[str]]:
    """The mood families that shipped a batch, and their members, in roster order."""
    found: dict[str, list[str]] = {}
    for palette in held.values():
        if palette.mood_family in (None, NOT_A_FAMILY):
            continue
        found.setdefault(palette.mood_family, []).append(palette.name)
    return {family: sorted(names) for family, names in sorted(found.items())}


# ----------------------------------------------------------------------------- the parts


def strip(name: str, width: int, height: int = STRIP_HEIGHT) -> Path:
    """One palette's gradient as a render sweeps through it, drawn by the engine.

    Never in Python: a second densifier is how a strip and the picture beside it come to
    disagree about the same palette. Skipped where the file is already there, so a sheet
    is composed without redrawing eighty ramps.

    The fold is not passed and does not need to be: `palettes strip` already defaults to
    *folded unless the map is cyclic*, which is the pipeline's own rule and the one
    `Palette.mirror` spells. A strip and the picture above it therefore agree about the
    map without either side saying so.
    """
    directory = renders.default_cache_root() / "strips"
    directory.mkdir(parents=True, exist_ok=True)
    out = directory / f"{_slug(name)}-{width}x{height}.png"
    if not out.is_file():
        renders.cli(
            "palettes",
            "strip",
            "--name",
            name,
            "--width",
            width,
            "--height",
            height,
            "--out",
            out,
        )
    return out


def _slug(name: str) -> str:
    kept = [character if character.isalnum() else "-" for character in name.lower()]
    return "".join(kept).strip("-") or "map"


def frame(which: str) -> dict:
    """One of this page's frames, as the store row it was rated on."""
    batch, line = FRAMES[which]
    return renders.finished_row("smooth_render", batch, line)


def field_of(row: dict) -> Path:
    """The location's smooth field, dumped once and recolored by every panel that wants it.

    The one iteration pass a whole figure pays for, and the same arrangement a colorize
    attempt uses: thirty-two candidates cost one render, not thirty-two. The cap is left
    to the engine's depth policy, so the frame a link opens is the frame drawn here.
    """
    stem = renders.default_cache_root() / "fields" / f"palette-{row['_batch']}-{row['_line']}"
    spec = {
        "family": row["family"],
        "viewport": row["viewport"],
        "mode": "smooth",
        "resolution": list(RENDER),
        "supersample": SUPERSAMPLE,
        "colormap": "twilight_shifted",
    }
    field, _ = renders.dump_field(spec, stem)
    return field


def coloured(field: Path, palette: Palette, **recipe) -> Path:
    """One candidate picture: the dumped field through one palette, no re-iteration."""
    key = renders.spec_key("recolor", {"field": field.name, "map": palette.name, **recipe})
    name = f"{field.stem}-{_slug(palette.name)}-{key}.png"
    out = renders.default_cache_root() / "candidates" / name
    return renders.recolor(
        field,
        out,
        colormap=palette.name,
        palette={"mirror": palette.mirror, **recipe},
    )


# -------------------------------------------------------------------------- the lettering


def elided(draw, text: str, face, room: float) -> str:
    """A label cut to the room its cell has, with an ellipsis where it was cut."""
    if text_width(draw, text, face) <= room:
        return text
    kept = text
    while kept and text_width(draw, kept + "…", face) > room:
        kept = kept[:-1]
    return kept + "…"


def _name_under(draw, x: int, y: int, name: str, room: int, *, size: int = 14, ink=WELL_INK_DIM):
    """A name ranged left in a column of its own — the mood table, and nothing else."""
    face = font(size)
    draw.text((x, y), elided(draw, name, face, room), fill=ink, font=face)


def _tile_name(draw, origin, tile, name: str, *, ink=WELL_INK_DIM) -> None:
    """A name under one tile, by the site's one rule for a tile label.

    `tile` is everything the name is under — a picture and the strip beneath it are one
    tile here, because the name belongs to both. Long names are still cut to the tile's
    width, at whatever size the rule gives them.
    """
    face = font(sheets.label_size(tile[1], SHEET_WIDTH))
    cut = [elided(draw, name, face, tile[0])]
    sheets.tile_label(draw, origin, tile, cut, SHEET_WIDTH, lead=ink)


def _tile_band(tile_height: int) -> int:
    """The room that name needs, for the arithmetic that lays a sheet out around it."""
    return sheets.caption_band(tile_height, SHEET_WIDTH)


def _band(draw, x: int, y: int, text: str, *, size: int = 15) -> None:
    """The line that says what the block of panels under it is."""
    draw.text((x, y), text, fill=WELL_INK, font=font(size))


def _outline(draw, box, colour=WELL_INK, width: int = 3) -> None:
    x0, y0, x1, y1 = box
    draw.rectangle([x0 - 1, y0 - 1, x1 + 1, y1 + 1], outline=(0, 0, 0), width=width + 1)
    draw.rectangle([x0, y0, x1, y1], outline=colour, width=width)


def _frame_line(row: dict, label: str) -> str:
    """A panel's provenance: the family, the frame, and where the rating for it is."""
    family = row["family"]
    kind = family["kind"]
    named = kind if kind != "multibrot" else f"multibrot degree {family.get('degree', 2)}"
    constants = ""
    if family.get("c"):
        constants += f", c = {family['c'][0]} + {family['c'][1]}i"
    if family.get("p"):
        constants += f", p = {family['p'][0]} + {family['p'][1]}i"
    if family.get("z_prev"):
        constants += f", z_prev = {family['z_prev'][0]} + {family['z_prev'][1]}i"
    view = row["viewport"]
    return (
        f"{label}: {named}{constants}, degree {family.get('degree', 2)}, centre "
        f"{view['center_re']} + {view['center_im']}i, width {view['width']}; mode smooth, "
        f"{RENDER[0]}x{RENDER[1]} supersample {SUPERSAMPLE}, maxiter auto — the engine's own "
        f"depth policy. The frame is data/smooth_render/rows/{row['_batch']}.jsonl line "
        f"{row['_line']}, scored {row['score']} by hand."
    )


# ------------------------------------------------------------------------------ the figures


def locations_by_palettes() -> Drawn:
    """Three locations down, three palettes across: each row is one stored field."""
    held = library()
    maps = [held[name] for name in OPENING_PALETTES]
    rows = [frame(which) for which in ("mandelbrot", "julia", "phoenix")]
    panel = panels(3)
    head = STRIP_HEIGHT + _tile_band(STRIP_HEIGHT)
    sheet, draw = sheets.canvas(
        SHEET_WIDTH, sheets.PAD + head + sheets.PAD + 3 * (panel[1] + sheets.PAD)
    )
    for column, palette in enumerate(maps):
        x = sheets.PAD + column * (panel[0] + sheets.PAD)
        head_strip = strip(palette.name, panel[0])
        sheets.paste(sheet, head_strip, (x, sheets.PAD), (panel[0], STRIP_HEIGHT))
        _tile_name(draw, (x, sheets.PAD), (panel[0], STRIP_HEIGHT), palette.name, ink=WELL_INK)
    top = sheets.PAD + head + sheets.PAD
    for index, row in enumerate(rows):
        field = field_of(row)
        for column, palette in enumerate(maps):
            picture = coloured(field, palette)
            origin = (
                sheets.PAD + column * (panel[0] + sheets.PAD),
                top + index * (panel[1] + sheets.PAD),
            )
            sheet.paste(sheets.fitted(picture, panel), origin)
    provenance = [
        "Three frames, each dumped once as a smooth field and recolored down its row, so a "
        "row differs in nothing but the palette. Strips above the columns are `palettes "
        "strip` at the column's own width. The representative panel is the first row's "
        f"first column, colormap {maps[0].name}.",
        _frame_line(rows[0], "Row 1"),
        _frame_line(rows[1], "Row 2"),
        _frame_line(rows[2], "Row 3"),
        "Columns, left to right: "
        + ", ".join(f"palette {palette.name}" for palette in maps)
        + " — each folded only where it is sequential, which none of these three is.",
    ]
    return Drawn(sheets.save(sheet, sheet_path("palette-locations")), provenance)


def mood_family_strips() -> Drawn:
    """One strip per mood family the prompt names, at that family's most central member."""
    held = library()
    families = mood_families(held)
    label_width = 268
    strip_width = SHEET_WIDTH - label_width - 2 * sheets.PAD
    row_height = 46
    sheet, draw = sheets.canvas(SHEET_WIDTH, sheets.PAD + len(families) * row_height + sheets.PAD)
    chosen = {}
    for index, (family, members) in enumerate(families.items()):
        name = renders.palette_space("medoid", names=members)
        chosen[family] = (name, len(members))
        y = sheets.PAD + index * row_height
        draw.text((sheets.PAD, y + 2), family, fill=WELL_INK, font=font(16))
        _name_under(draw, sheets.PAD, y + 22, name, label_width - sheets.PAD, size=13)
        sheets.paste(
            sheet,
            strip(name, strip_width, STRIP_HEIGHT + 4),
            (label_width, y + 4),
            (strip_width, STRIP_HEIGHT + 4),
        )
    provenance = [
        "No render: every panel is a gradient rather than a picture of a location. Each "
        "strip is `fractal-wallpapers palettes strip` at the sheet's own width, which colors "
        "a horizontal ramp through the engine — same OKLab bake, same 4,096-entry table, "
        "same fold — so the outer 0.5% of each strip is its end colour held flat by the "
        "coloring's own percentile stretch.",
        "The roster is every mood family with a shipped batch in data/palettes/"
        "provenance.jsonl; the run knob `span` is not a family and is left out.",
    ] + [
        f"{family}: palette {name}, the member of that family's {count} nearest the rest of "
        "them by palettes.space.distances, ties by name."
        for family, (name, count) in chosen.items()
    ]
    return Drawn(sheets.save(sheet, sheet_path("palette-moods")), provenance)


def fire_ice() -> Drawn:
    """One field under every palette the fire-ice batch produced."""
    held = library()
    names = sorted(name for name, palette in held.items() if palette.mood_family == "fire-ice")
    row = frame("fire_ice")
    field = field_of(row)
    panel = panels(4)
    tile = (panel[0], panel[1] + 4 + TILE_STRIP_HEIGHT)
    cell = tile[1] + _tile_band(tile[1])
    rows = (len(names) + 3) // 4
    sheet, draw = sheets.canvas(SHEET_WIDTH, sheets.PAD + rows * (cell + sheets.PAD))
    for index, name in enumerate(names):
        palette = held[name]
        x = sheets.PAD + (index % 4) * (panel[0] + sheets.PAD)
        y = sheets.PAD + (index // 4) * (cell + sheets.PAD)
        sheet.paste(sheets.fitted(coloured(field, palette), panel), (x, y))
        sheets.paste(
            sheet,
            strip(name, panel[0], TILE_STRIP_HEIGHT),
            (x, y + panel[1] + 4),
            (panel[0], TILE_STRIP_HEIGHT),
        )
        _tile_name(draw, (x, y), tile, name)
    provenance = [
        "One frame, dumped once as a smooth field and recolored through every palette the "
        f"fire-ice batch shipped; a strip of each palette sits under its own tile. The "
        f"representative panel is the first, colormap {names[0]}.",
        _frame_line(row, "Every panel"),
        "Panels in reading order: "
        + ", ".join(f"palette {name}" for name in names)
        + " — the whole of data/palettes/provenance.jsonl's fire-ice mood family, "
        f"{len(names)} maps, every one of them cyclic and so drawn unfolded.",
    ]
    return Drawn(sheets.save(sheet, sheet_path("palette-fire-ice")), provenance)


def palette_params() -> Drawn:
    """One location and one palette, under the two knobs a reader can see."""
    held = library()
    palette = held[KNOB_PALETTE]
    row = frame("params")
    field = field_of(row)
    panel = panels(5)
    head = STRIP_HEIGHT + _tile_band(STRIP_HEIGHT)
    cell = panel[1] + _tile_band(panel[1])
    sheet, draw = sheets.canvas(
        SHEET_WIDTH, sheets.PAD + head + sheets.PAD + 2 * (cell + sheets.PAD)
    )
    sheets.paste(
        sheet,
        strip(palette.name, SHEET_WIDTH - 2 * sheets.PAD),
        (sheets.PAD, sheets.PAD),
        (SHEET_WIDTH - 2 * sheets.PAD, STRIP_HEIGHT),
    )
    _tile_name(
        draw,
        (sheets.PAD, sheets.PAD),
        (SHEET_WIDTH - 2 * sheets.PAD, STRIP_HEIGHT),
        palette.name,
        ink=WELL_INK,
    )
    top = sheets.PAD + head + sheets.PAD
    made = []
    for column, cycles in enumerate(KNOB_CYCLES):
        picture = coloured(field, palette, cycles=float(cycles))
        x = sheets.PAD + column * (panel[0] + sheets.PAD)
        sheet.paste(sheets.fitted(picture, panel), (x, top))
        _tile_name(draw, (x, top), panel, f"cycles {cycles}")
        made.append(f"cycles {cycles}, phase 0")
    second = top + cell + sheets.PAD
    for column, phase in enumerate(KNOB_PHASES):
        picture = coloured(field, palette, cycles=float(KNOB_PHASE_CYCLES), phase=phase)
        x = sheets.PAD + column * (panel[0] + sheets.PAD)
        sheet.paste(sheets.fitted(picture, panel), (x, second))
        _tile_name(draw, (x, second), panel, f"phase {phase:.1f}")
        made.append(f"cycles {KNOB_PHASE_CYCLES}, phase {phase}")
    provenance = [
        "One frame, dumped once as a smooth field and recolored ten times through one "
        f"palette; nothing moves between panels but the recipe. Strip along the top is "
        f"`palettes strip`. The representative panel is the first, colormap {palette.name} "
        "at the engine's own defaults.",
        _frame_line(row, "Every panel"),
        "Panels in reading order, as the engine's palette recipe: "
        + "; ".join(made)
        + f" — gamma 1, reverse false, mirror false ({palette.name} is cyclic), transfer "
        "value, rolloff none throughout.",
    ]
    return Drawn(sheets.save(sheet, sheet_path("palette-params")), provenance)


def palette_spread() -> Drawn:
    """One location under twelve palettes drawn at random, the head's pick marked."""
    held = library()
    members = pool()
    draw_from = random.Random(SPREAD_SEED)
    names = sorted(draw_from.sample(members, SPREAD_WIDE))
    row = frame("spread")
    field = field_of(row)
    pictures = [coloured(field, held[name]) for name in names]
    scores = renders.palette_scores(pictures)
    best = max(range(len(names)), key=lambda index: scores[index])
    panel = panels(SPREAD_COLUMNS)
    tile = (panel[0], panel[1] + 4 + TILE_STRIP_HEIGHT)
    cell = tile[1] + _tile_band(tile[1])
    rows = (len(names) + SPREAD_COLUMNS - 1) // SPREAD_COLUMNS
    sheet, drawer = sheets.canvas(SHEET_WIDTH, sheets.PAD + rows * (cell + sheets.PAD))
    for index, name in enumerate(names):
        x = sheets.PAD + (index % SPREAD_COLUMNS) * (panel[0] + sheets.PAD)
        y = sheets.PAD + (index // SPREAD_COLUMNS) * (cell + sheets.PAD)
        sheet.paste(sheets.fitted(pictures[index], panel), (x, y))
        sheets.paste(
            sheet,
            strip(name, panel[0], TILE_STRIP_HEIGHT),
            (x, y + panel[1] + 4),
            (panel[0], TILE_STRIP_HEIGHT),
        )
        lead = WELL_INK if index == best else WELL_INK_DIM
        label = f"the pick — {name}" if index == best else name
        _tile_name(drawer, (x, y), tile, label, ink=lead)
        if index == best:
            _outline(drawer, (x, y, x + panel[0] - 1, y + panel[1] - 1))
    provenance = [
        "One frame, dumped once as a smooth field and recolored through twelve palettes "
        "drawn uniformly without replacement from data/palette_choice/pool.json, "
        f"random.Random({SPREAD_SEED}).sample, then sorted by name. The marked panel is the "
        "one the shipped palette head scores highest of the twelve — its own loader, its "
        f"own deploy transform. The representative panel is the first, colormap {names[0]}.",
        _frame_line(row, "Every panel"),
        "Panels in reading order, with the head's score: "
        + ", ".join(f"palette {name} {scores[index]:.3f}" for index, name in enumerate(names))
        + f" — the pick is {names[best]}.",
    ]
    return Drawn(sheets.save(sheet, sheet_path("palette-spread")), provenance)


def neighborhood_ranked() -> Drawn:
    """A real candidate set in the judge's own order, above a uniform draw of the same width."""
    held = library()
    members = pool()
    candidates = renders.palette_space(
        "neighbourhood", anchor=NEIGHBORHOOD_ANCHOR, names=members, size=32
    )
    uniform = random.Random(NEIGHBORHOOD_SEED).sample(members, 32)
    row = frame("neighborhood")
    field = field_of(row)
    ranked_pictures = [coloured(field, held[name]) for name in candidates]
    scores = renders.palette_scores(ranked_pictures)
    order = sorted(range(len(candidates)), key=lambda index: -scores[index])
    ranked = [candidates[index] for index in order]
    uniform_pictures = [coloured(field, held[name]) for name in uniform]

    columns = 8
    panel = panels(columns)
    cell = panel[1] + 3 + TILE_STRIP_HEIGHT
    block = 22 + 4 * (cell + sheets.PAD)
    sheet, drawer = sheets.canvas(SHEET_WIDTH, sheets.PAD + 2 * block + sheets.PAD)

    def _block(top: int, caption: str, names, pictures, mark: int | None) -> None:
        _band(drawer, sheets.PAD, top, caption)
        for index, name in enumerate(names):
            x = sheets.PAD + (index % columns) * (panel[0] + sheets.PAD)
            y = top + 22 + (index // columns) * (cell + sheets.PAD)
            sheet.paste(sheets.fitted(pictures[index], panel), (x, y))
            sheets.paste(
                sheet,
                strip(name, panel[0], TILE_STRIP_HEIGHT),
                (x, y + panel[1] + 3),
                (panel[0], TILE_STRIP_HEIGHT),
            )
            if index == mark:
                _outline(drawer, (x, y, x + panel[0] - 1, y + panel[1] - 1), width=2)

    _block(
        sheets.PAD,
        "The 32 candidates a colorize would ask about, in the judge's order — its pick first",
        ranked,
        [ranked_pictures[index] for index in order],
        0,
    )
    _block(
        sheets.PAD + block,
        "32 palettes drawn uniformly from the same pool, for contrast",
        uniform,
        uniform_pictures,
        None,
    )
    provenance = [
        "One frame, dumped once as a smooth field and recolored sixty-four times. The top "
        f"block is palettes.space.neighbourhood('{NEIGHBORHOOD_ANCHOR}', pool, 32) over "
        "data/palette_choice/pool.json — the candidate set a colorize builds — reordered by "
        "the shipped palette head's own score, best first, and the first panel is its pick. "
        f"The representative panel is that pick, colormap {ranked[0]}.",
        _frame_line(row, "Every panel"),
        "Top block in reading order, with the head's score: "
        + ", ".join(f"palette {name} {scores[order[i]]:.3f}" for i, name in enumerate(ranked)),
        f"Bottom block is random.Random({NEIGHBORHOOD_SEED}).sample(pool, 32), in the order "
        "it drew them: " + ", ".join(f"palette {name}" for name in uniform),
    ]
    return Drawn(sheets.save(sheet, sheet_path("palette-neighborhood")), provenance)


def autolevel_pairs() -> Drawn:
    """Two releases the operator acted on, as rendered and after it moved the tone.

    Stacked rather than side by side *(Matt, 2026-08-22)*: one pair says the operator
    moved something, and two say what it is *for* — the same band pulls a picture that
    came out too light down and lifts one that came out too dark, and a reader sees a rule
    rather than an adjustment. Both rows are released rows, and both are drawn exactly as
    their record says.
    """
    rows = [_acted_release(run, candidate) for run, candidate in ACTED]
    panel = panels(2)
    cell = panel[1] + sheets.caption_band(panel[1], SHEET_WIDTH, 2)
    sheet, drawer = sheets.canvas(SHEET_WIDTH, sheets.PAD + len(rows) * (cell + sheets.PAD))
    provenance = [
        "Two release records, each drawn twice: the picture as the chosen palette renders "
        "it, and the picture the autolevel operator returned. Every panel is that row's own "
        "recipe at the size the run drew, so this is the only figure of this page whose "
        "panels are the pictures a record describes rather than a neutral redraw. The "
        "representative panel is the first row's left, colormap "
        f"{rows[0][0]['recipe']['colormap']}."
    ]
    for index, (record, stamp) in enumerate(rows):
        before, after = _autolevel_panels(record, stamp)
        measured, curve = stamp["measured"], stamp["curve"]
        top = sheets.PAD + index * (cell + sheets.PAD)
        for column, (path, lines) in enumerate(
            (
                (
                    before,
                    [
                        "as rendered",
                        f"black {measured['black_pt']:.2f} · white {measured['white_pt']:.2f}"
                        f" · median {measured['mid']:.2f}",
                    ],
                ),
                (after, ["after leveling", _what_moved(measured, curve)]),
            )
        ):
            x = sheets.PAD + column * (panel[0] + sheets.PAD)
            sheet.paste(sheets.fitted(path, panel), (x, top))
            sheets.tile_label(drawer, (x, top), panel, lines, SHEET_WIDTH)
        provenance.extend(_autolevel_provenance(record, stamp, index, name=index == 0))
    return Drawn(sheets.save(sheet, sheet_path("palette-autolevel")), provenance)


#: How a row of the figure is named in its own provenance, so a line says which picture
#: it is about without a reader counting panels.
ROW_WORDS = ("Top row", "Bottom row")


def _what_moved(measured: dict, curve: dict) -> str:
    """The second label line: which of the three statistics the operator took, and where.

    Built from the stamp's own `sides` rather than written down, because the two rows
    are out of band on different statistics — which is the reason there are two.
    """
    moved = []
    if curve["sides"].get("black_pt"):
        moved.append(
            f"black point {_moved(measured['black_pt'], curve['out_ends'][0])} to "
            f"{curve['out_ends'][0]:.2f}"
        )
    if curve["sides"].get("white_pt"):
        moved.append(
            f"white point {_moved(measured['white_pt'], curve['out_ends'][1])} to "
            f"{curve['out_ends'][1]:.2f}"
        )
    if curve["sides"].get("mid"):
        moved.append(
            f"median {_moved(measured['mid'], curve['mid_target'])} to {curve['mid_target']:.2f}"
        )
    ends = [name for name in ("black_pt", "white_pt") if not curve["sides"].get(name)]
    if len(ends) == 2:
        moved.append("both ends held")
    elif ends:
        moved.append(f"{'black' if ends[0] == 'black_pt' else 'white'} point held")
    return " · ".join(moved)


def _autolevel_provenance(record: dict, stamp: dict, index: int, *, name: bool) -> list[str]:
    """The three lines one row of the figure records.

    Only the first row spells the word `colormap`. A sheet gets one link, at its
    representative panel, and `explorer.py` bakes a map into the browser page for every
    line that says the word — see this module's docstring.
    """
    measured, curve, band = stamp["measured"], stamp["curve"], stamp["band"]
    where = ROW_WORDS[index]
    geometry = record["recipe"]["render"]
    return [
        f"{where}, left panel: released wallpaper "
        f"{record['run']}|release|{record['candidate']} — "
        f"{'colormap' if name else 'palette'} {record['recipe']['colormap']}, mode "
        f"{record['recipe']['mode']}, mirror "
        f"{str(record['recipe'].get('mirror', False)).lower()}, maxiter "
        f"{geometry['maxiter']}, {geometry['resolution'][0]}x{geometry['resolution'][1]} "
        f"supersample {geometry['supersample']}.",
        f"{where}, right panel: the same field and the same map, rendered again through the "
        "levelled stops the row's autolevel stamp rebuilds — operator "
        f"{stamp['operator']}, band {band['path']} sha256 {band['sha256'][:16]}… derived "
        f"{band['derived']} over {band['n_images']} pictures; exponent "
        f"{curve['exponent']:.4f}, out_ends {curve['out_ends'][0]:.4f}/"
        f"{curve['out_ends'][1]:.4f}, chroma retain {stamp['chroma_cap']['retain']}.",
        f"{where}, measured on the left panel: black_pt {measured['black_pt']:.6f}, white_pt "
        f"{measured['white_pt']:.6f}, mid {measured['mid']:.6f}. Out of band on "
        + ", ".join(name for name, side in curve["sides"].items() if side)
        + ".",
    ]


def generator_batch() -> Drawn:
    """One shipped batch of the prompt, as strips: what a single run produces."""
    names = batches()[GENERATOR_BATCH]
    columns = 3
    width = (SHEET_WIDTH - (columns + 1) * sheets.PAD) // columns
    cell = STRIP_HEIGHT + _tile_band(STRIP_HEIGHT)
    rows = (len(names) + columns - 1) // columns
    sheet, drawer = sheets.canvas(SHEET_WIDTH, sheets.PAD + rows * (cell + sheets.PAD))
    for index, name in enumerate(names):
        x = sheets.PAD + (index % columns) * (width + sheets.PAD)
        y = sheets.PAD + (index // columns) * (cell + sheets.PAD)
        sheets.paste(sheet, strip(name, width), (x, y), (width, STRIP_HEIGHT))
        _tile_name(drawer, (x, y), (width, STRIP_HEIGHT), name)
    provenance = [
        "No render: every panel is a gradient rather than a picture of a location. Strips "
        "are `fractal-wallpapers palettes strip` at the cell's own width.",
        f"Every palette of the {GENERATOR_BATCH} batch that shipped, in name order, read off "
        f"data/palettes/provenance.jsonl — {len(names)} of them. The batch is the largest the "
        "prompt produced; the prompt's own batch size is a run knob and the batches that ship "
        "are what survived the validator and the pool.",
        "Panels in reading order: " + ", ".join(f"palette {name}" for name in names) + ".",
    ]
    return Drawn(sheets.save(sheet, sheet_path("palette-generator-batch")), provenance)


# --------------------------------------------------------------------- the autolevel pair


def _moved(was: float, now: float) -> str:
    """Which way the operator took a statistic, in the word a reader would use."""
    return "lifted" if now > was else "pulled down"


def _acted_release(run: str, candidate: str) -> tuple[dict, dict]:
    """A released row the operator acted on, and its stamp. Named, not searched for.

    The rows are written down rather than picked by a rule, because "the acted rows the
    operator moved furthest" is a rule whose answer moves the day a run is added, and a
    figure's subject should not.
    """
    record = release_record(run, candidate)
    stamp = record.get("autolevel")
    if not stamp or not stamp.get("acted"):
        raise PaletteError(f"{run}|release|{candidate} carries no autolevel stamp that acted")
    if record.get("verdict") != "released":
        raise PaletteError(
            f"{run}|release|{candidate} is {record.get('verdict')}, and the caption says released"
        )
    return record, stamp


#: The two releases the leveling figure is drawn from *(Matt, 2026-08-22, picked off
#: `sheet-autolevel-pairs`)*. One came out too light and is pulled down; the other came
#: out too dark and is lifted, and the second is why there are two rows.
ACTED = (("release_v1", "0023"), ("run10", "0127"))


def _autolevel_panels(record: dict, stamp: dict) -> tuple[Path, Path]:
    """The two pictures: the base render, and the levelled one the operator returned."""
    recipe = record["recipe"]
    geometry = recipe["render"]
    base = {
        "family": record["location"]["family"],
        "viewport": record["location"]["viewport"],
        "mode": recipe["mode"],
        "colormap": recipe["colormap"],
        "maxiter": geometry["maxiter"],
        "resolution": list(geometry["resolution"]),
        "supersample": geometry["supersample"],
        "recipe": {"mirror": bool(recipe.get("mirror", False))},
    }
    cache = renders.Cache()
    before = cache.produce("palette-autolevel-before", "render", _render_spec(base)).path
    after = _levelled(base, stamp)
    return before, after


def _render_spec(base: dict) -> dict:
    return {
        "schema": 1,
        "family": base["family"],
        "viewport": base["viewport"],
        "mode": base["mode"],
        "colormap": base["colormap"],
        "maxiter": base["maxiter"],
        "resolution": base["resolution"],
        "supersample": base["supersample"],
        "palette": {"mirror": base["recipe"]["mirror"]},
    }


def _levelled(base: dict, stamp: dict) -> Path:
    """The same render through the levelled stops the stamp rebuilds.

    The replay is that project's own `stops_from_stamp`; this side writes the result as a
    colormap under its own ignored artifacts tree, keeping the map's name and its kind,
    and points the render at that directory. That is the arrangement the operator itself
    uses — one spec with one directory changed — so the engine's fold decision and its
    bake are the production call's and only the stop colours differ.
    """
    replayed = renders.levelled_stops(base["colormap"], stamp)
    directory = (
        renders.default_cache_root()
        / "levelled"
        / renders.spec_key("levelled", {**base, "curve": stamp["curve"]})
    )
    made = directory / f"{base['colormap']}.json"
    if not made.is_file():
        directory.mkdir(parents=True, exist_ok=True)
        made.write_text(
            json.dumps(
                {
                    "schema": 1,
                    "name": base["colormap"],
                    "kind": replayed["kind"],
                    "source": f"{base['colormap']}, levelled by the operator for one render",
                    "stops": replayed["stops"],
                }
            ),
            encoding="utf-8",
            newline=LF,
        )
    spec = _render_spec(base)
    spec["colormap_dir"] = str(directory)
    return renders.Cache().produce("palette-autolevel-after", "render", spec).path


# ------------------------------------------------------------------------------- the wiring


MAKERS = {
    "palette-locations": locations_by_palettes,
    "palette-moods": mood_family_strips,
    "palette-fire-ice": fire_ice,
    "palette-params": palette_params,
    "palette-spread": palette_spread,
    "palette-neighborhood": neighborhood_ranked,
    "palette-autolevel": autolevel_pairs,
    "palette-generator-batch": generator_batch,
}


def recipe(identifier: str) -> dict:
    """The registry recipe for a figure of this module: the maker, and no arguments."""
    if identifier not in MAKERS:
        raise records.RecordError(f"{identifier} is not drawn by builder.palettes")
    return {"maker": f"{__name__}:{MAKERS[identifier].__name__}", "args": {}}


def draw(identifier: str) -> Drawn:
    if identifier not in MAKERS:
        raise records.RecordError(f"{identifier} is not drawn by builder.palettes")
    return MAKERS[identifier]()


# ------------------------------------------------------------------ the all-palettes page

#: Where the library page's strips live, and what one is drawn at. Small, because there
#: are nine hundred of them and a gradient is the one picture PNG compresses perfectly.
LIBRARY_ASSETS = ("assets", "images", "palettes")
LIBRARY_STRIP = (420, 28)

#: The library page itself, and how it is named. The slug is what it says: every palette,
#: with nothing left out — which is the thing the section's own figure cannot be.
LIBRARY_PAGE = ("palettes", "all-palettes.html")
LIBRARY_TITLE = "All palettes"

#: The page's opening paragraph. The count is derived and formatted in, because a library
#: that grows is a page that has to say so without anybody remembering to.
LIBRARY_LEAD = (
    "Every palette the project ships — {palettes} of them — grouped by the color each one "
    "is dominant in: a map is read onto three fixed pictures, and the hue it puts most of "
    "a picture in is the section it sits in here. Each is drawn as a render sweeps through "
    "it — folded where it does not close on the color it opened with — so what is on the "
    "page is the gradient a picture is read through, and not the handful of stops it was "
    "written as."
)


def library_lead() -> str:
    """The lead with this record's own number in it."""
    return LIBRARY_LEAD.format(palettes=len(held_library()))


def library_page_path():
    """Where the generated page lands."""
    return SITE_ROOT.joinpath(*LIBRARY_PAGE)


def library_assets_dir():
    return SITE_ROOT.joinpath(*LIBRARY_ASSETS)


def library_strip_name(name: str) -> str:
    return f"{_slug(name)}.png"


def place_library_strips() -> tuple[int, int]:
    """Draw every palette's strip and land it as this site's own asset.

    Returns `(written, total)`. A strip already on disk is left alone, and one that lands
    is copied rather than imported: it is already a PNG at the size the page shows it, and
    a re-encode would be new bytes for the same picture.

    **One invocation, not nine hundred.** `palettes strip` takes a manifest for exactly
    this reason: drawing a ramp is three milliseconds and starting that project's
    interpreter is a third of a second, so the per-name form spends two hundred times the
    figure's own cost on process start.
    """
    held = library()
    directory = library_assets_dir()
    directory.mkdir(parents=True, exist_ok=True)
    wanted = [name for name in sorted(held) if not (directory / library_strip_name(name)).is_file()]
    if not wanted:
        return 0, len(held)
    staging = renders.default_cache_root() / "library-strips"
    staging.mkdir(parents=True, exist_ok=True)
    manifest = staging / "wanted.txt"
    manifest.write_text(LF.join(wanted) + LF, encoding="utf-8", newline=LF)
    renders.cli(
        "palettes",
        "strip",
        "--manifest",
        manifest,
        "--width",
        LIBRARY_STRIP[0],
        "--height",
        LIBRARY_STRIP[1],
        "--out-dir",
        staging,
    )
    for name in wanted:
        (directory / library_strip_name(name)).write_bytes((staging / f"{name}.png").read_bytes())
    return len(wanted), len(held)


# ------------------------------------------------------ the library, as this repository has it

#: This repository's own record of the library page: one row per palette, in the order the
#: page lays them out, carrying the four facts the page is made of and nothing else.
#: Written from the wallpaper project by `palettes --library` and read by everything else,
#: so the largest generated page here is a function of committed text — which is what every
#: other generated page on this site already is, and what lets `check` hold it to its record
#: on a machine with no checkout, CI included.
LIBRARY_REGISTRY = ("palettes", "library.jsonl")
LIBRARY_ROW = "palette"

#: How many disagreements a drift report names one by one before it starts counting. A
#: library that grew by two hundred is one instruction, not two hundred lines of it.
DRIFT_NAMED = 8

#: Where a map's name came from, which is the whole of what decides whether the page shows
#: it under a display name — see `display_name`.
EXTRACTED = "extracted"

#: The maps written against the palette prompt, as opposed to `extracted` from a picture
#: or `converted` from an upstream library. **These are the maps a figure draws at random**
#: *(Matt, 2026-09-02)*: their names were written as prose rather than being a library
#: identifier or a wallpaper's filename, and all 375 of them are cyclic — where 90% of the
#: extracted maps close by *mirroring*, and so read as 2k bands when swept k times, not one
#: authored map is a palindrome. A random draw over the whole pool put
#: `cet_rainbow_bgyr_35_85_c72` under a picture on the article's front page.
AUTHORED = "authored"

#: Words a filename carries that say nothing about the palette: the site a picture came
#: off, the resolution words beside it, and `fractal`, which every map on a fractal site
#: is. Dropped wherever they fall rather than only at the ends, because they turn up in the
#: middle as often — `at-the-beach-hd-wallpaper-1920x1200`.
NAME_NOISE = frozenset(
    {
        "hd",
        "4k",
        "8k",
        "uhd",
        "wallpaper",
        "wallpapers",
        "background",
        "backgrounds",
        "desktop",
        "widescreen",
        "image",
        "images",
        "photo",
        "fractal",
        "com",
        "www",
        "org",
        "wallhaven",
        "commons",
        "imgur",
        "deviantart",
        "flickr",
        "pixabay",
        "unsplash",
    }
)

#: The words a title keeps lower case anywhere but first, cut to what actually turns up in
#: a wallpaper's filename.
NAME_SMALL = frozenset(
    {
        "a",
        "an",
        "and",
        "as",
        "at",
        "but",
        "by",
        "for",
        "from",
        "in",
        "into",
        "of",
        "on",
        "or",
        "over",
        "the",
        "to",
        "under",
        "up",
        "with",
    }
)

_VOWELS = frozenset("aeiouyAEIOUY")

#: A filename that arrived percent-encoded, its `%` written as `_`: two or more two-digit
#: hex bytes in a row is UTF-8 the file system flattened, and there are twenty-three of
#: them in the library — Wikimedia Commons titles in Vietnamese. Decoding them is guessing
#: about a separator that is also a word break, and a wrong guess is mojibake in front of a
#: reader, so these keep the name they have.
PERCENT_ENCODED = re.compile(r"(?:_[0-9A-F]{2}){2}")


def _hashish(word: str) -> bool:
    """Whether a word is an identifier rather than a word: `dg6v93`, `2pi1Zz6`, `Jqmsl`."""
    mixed = any(character.isdigit() for character in word) and any(
        character.isalpha() for character in word
    )
    return mixed or (len(word) >= 4 and not _VOWELS & set(word))


def display_name(name: str, source: str) -> str:
    """What the page calls a palette, which is not always what the library calls it.

    **The id is never renamed.** It is the key a permalink carries, the key the explorer
    resolves and the key `provenance` writes down, and the page shows it under the strip
    wherever the two differ. This is a reading label and nothing else.

    Only an *extracted* map gets one. Those names are the filenames of the wallpapers the
    maps were distilled out of — `02591_vermilionlakes_2560x1600`,
    `along-the-starry-way-25` — and a filename is not a name a reader can use. A
    *converted* ramp's name is the upstream library's own identifier,
    `cet_cyclic_mrybm_35_75_c68`, which is the thing to look up and would be destroyed by
    title-casing it; an *authored* map's name was written as prose in the first place.

    The rule: drop resolution tokens and everything that is not a letter or a digit, drop
    `NAME_NOISE` wherever it falls, collapse a token repeated straight after itself
    (`wallhaven_wallhaven-…`), drop a leading id number and any trailing number, and title
    what is left. **Where what survives is more identifier than words — over half of it a
    hash or a bare number, or nothing at all — the name stands as it is.** That is the
    honest answer for the maps whose filenames were only ever a hash, and it is what stops
    `commons_Julia-Menge_-0.8_0.156i` from being read out as *Julia Menge 0 8 0 156i*.
    """
    if source != EXTRACTED or PERCENT_ENCODED.search(name):
        return name
    text = re.sub(r"\d{3,4}\s*x\s*\d{3,4}", " ", name)
    words: list[str] = []
    for word in re.sub(r"[^0-9A-Za-z]+", " ", text).split():
        if word.lower() in NAME_NOISE:
            continue
        if words and word.lower() == words[-1].lower():
            continue
        words.append(word)
    while words and words[0].isdigit():
        words.pop(0)
    while words and words[-1].isdigit():
        words.pop()
    kept = words
    if not kept or sum(_hashish(word) or word.isdigit() for word in kept) * 2 > len(kept):
        return name
    return " ".join(
        word.lower() if at and word.lower() in NAME_SMALL else word.lower().capitalize()
        for at, word in enumerate(kept)
    )


@dataclass(frozen=True)
class Held:
    """One palette as the library page needs it: its name, whether it closes, the hue it is
    dominant in, and where its name came from.

    `source` is on the row because the page's display name turns on it and on nothing else
    — see `display_name` — and a page that is a pure function of committed text cannot go
    next door to ask. `hue` is one of `HUES` and never a number: the section a map sits in
    is a colour a reader can see, so it is spelled.
    """

    name: str
    cyclic: bool
    hue: str
    source: str

    @property
    def display(self) -> str:
        """What the page calls it."""
        return display_name(self.name, self.source)

    @property
    def renamed(self) -> bool:
        """Whether the page owes the reader the true id as well as the display name.

        Compared with case and punctuation squashed out, because `azarn` shown as *Azarn*
        is the same string to anyone reading it or searching for it, and a line under nine
        hundred strips repeating what the caption already says is noise. `Along the Starry
        Way` against `along-the-starry-way-25` is a real difference and is shown.
        """
        squashed = "".join(character for character in self.display if character.isalnum())
        was = "".join(character for character in self.name if character.isalnum())
        return squashed.casefold() != was.casefold()

    @property
    def strip(self) -> str:
        return library_strip_name(self.name)

    @property
    def alt(self) -> str:
        """What a strip is, for a reader who cannot see it."""
        closing = "closes on the color it opens with" if self.cyclic else "drawn folded"
        return f"The gradient {self.name}, {closing}."

    def row(self) -> dict:
        return {
            "schema": records.SCHEMA,
            "kind": LIBRARY_ROW,
            "name": self.name,
            "cyclic": self.cyclic,
            "hue": self.hue,
            "source": self.source,
        }


def library_registry_path() -> Path:
    return SITE_ROOT.joinpath(*LIBRARY_REGISTRY)


def held_library() -> tuple[Held, ...]:
    """The library as this repository records it, in the order the page shows it."""
    found = []
    for record in records.read(library_registry_path()):
        record.expect_kind(LIBRARY_ROW)
        found.append(
            Held(
                record.text("name"),
                record.flag("cyclic"),
                record.text("hue"),
                record.text("source"),
            )
        )
    return tuple(found)


def held_hues() -> list[tuple[str, tuple[Held, ...]]]:
    """The record's rows as the page's sections: each hue some map is dominant in, in the
    wheel's order, and inside it the maps in the order the record holds them.

    A hue no map is dominant in gets no section rather than an empty one — the sections are
    a reading of the library and not a promise about the codebook.
    """
    ordered: dict[str, list[Held]] = {}
    for held in held_library():
        ordered.setdefault(held.hue, []).append(held)
    return [(hue, tuple(ordered[hue])) for hue in HUES if hue in ordered]


def derive_library() -> tuple[Held, ...]:
    """The same rows, read off the wallpaper project — the record's one source.

    The order is the page's reading order and is derived here rather than taken from
    anything next door: the twelve hues in the wheel's own order, and inside a hue the maps
    by name, case folded, so a section a reader is scrolling can be searched by eye.
    """
    held = library()
    hues = dominant_hues()
    placed = []
    for name in sorted(held, key=lambda name: (name.casefold(), name)):
        hue = hues.get(name)
        if hue is None:
            raise PaletteError(
                f"the carrier table names no dominant cell for {name!r}, so no page shows it"
            )
        if hue not in HUES:
            raise PaletteError(f"{name!r} is dominant in {hue!r}, which is not one of HUES")
        placed.append(Held(name, held[name].cyclic, hue, held[name].source))
    return tuple(sorted(placed, key=lambda entry: HUES.index(entry.hue)))


def write_library(derived: tuple[Held, ...]) -> Path:
    """Land the record. LF, spelled out, because this is a tracked file on Windows."""
    path = library_registry_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    body = LF.join(json.dumps(entry.row(), ensure_ascii=False) for entry in derived)
    path.write_text(body + LF, encoding="utf-8", newline=LF)
    return path


def library_drift() -> list[str]:
    """Where this repository's record and the project's own library disagree.

    The half of the library check that needs the checkout. The page is held to the record
    everywhere; the record is held to the library here, and a palette that entered the
    library and never reached the page is what this is for.
    """
    recorded = held_library()
    derived = derive_library()
    if recorded == derived:
        return _uncarried()
    fix = "`python -m builder palettes --library`"
    by_recorded = {entry.name: entry for entry in recorded}
    by_derived = {entry.name: entry for entry in derived}
    problems = [
        f"library.jsonl: {name} is in the project's library and not in this record — {fix}"
        for name in sorted(set(by_derived) - set(by_recorded))
    ]
    problems += [
        f"library.jsonl: {name} is in this record and not in the project's library — {fix}"
        for name in sorted(set(by_recorded) - set(by_derived))
    ]
    problems += [
        f"library.jsonl: {name} is recorded {_shape(by_recorded[name])}, the library says "
        f"{_shape(by_derived[name])} — {fix}"
        for name in sorted(set(by_recorded) & set(by_derived))
        if by_recorded[name] != by_derived[name]
    ]
    if not problems:
        problems = [f"library.jsonl: the record's order is not the library's — {fix}"]
    return _capped(problems) + _uncarried()


def _shape(entry: Held) -> str:
    return f"{entry.hue}, {'cyclic' if entry.cyclic else 'folded'}, {entry.source}"


def _uncarried() -> list[str]:
    """A map the carrier table reads as dominant in nothing reaches no section at all."""
    missing = sorted(set(library()) - set(dominant_hues()))
    if not missing:
        return []
    return _capped(
        [
            f"carriers.jsonl: {name} is in the library and is dominant in no cell, so no "
            "page shows it"
            for name in missing
        ]
    )


def _capped(problems: list[str]) -> list[str]:
    if len(problems) <= DRIFT_NAMED:
        return problems
    return [*problems[:DRIFT_NAMED], f"… and {len(problems) - DRIFT_NAMED} more of the same"]


def refresh_library() -> tuple[int, int, bool]:
    """Land every strip the library page shows, and the record the page is built from.

    Returns `(strips written, palettes, the record moved)`.
    """
    written, total = place_library_strips()
    derived = derive_library()
    before = library_registry_path()
    had = before.read_text(encoding="utf-8") if before.is_file() else None
    write_library(derived)
    return written, total, before.read_text(encoding="utf-8") != had
