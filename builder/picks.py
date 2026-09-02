"""Figures whose panels are named by a tentative gallery's own IDs.

## The path this module is

A tentative gallery is the curation solve written down: `artifacts/curation/tentative/
<stamp>/gallery.jsonl`, one row per seat, and a browser page beside it that Matt drives.
He picks off that page by the short alias printed under a tile. Before this module the
picks then had to be turned into pictures by hand — somebody read the recipe out of the
records, typed the numbers into a rig under `scratch/`, and typed them again into the
figure's provenance.

So a figure of this module names its panels by **ID and nothing else**, in its own
registry row:

    "recipe": {"maker": "builder.picks:gallery_hook",
               "args": {"picks": ["<stamp>|<key>", ...]}}

and re-picking is an edit to that list followed by
`python -m builder picks <id> --replace`. The row is the source of truth and the maker
reads it, rather than the other way round: a list of IDs in a Python constant would be a
second place the picks live, and the registry is the place a person looks.

## Where a pick resolves

Two reads, and the split matters because a solve may be running next door.

- **The seat** comes out of the record the pick was made off — that stamp's own
  `gallery.jsonl`. It says which seat, which mode, which partition and which location,
  and it is a few hundred short lines.
- **The recipe** comes out of the candidate ledger, by a **streamed lookup that stops as
  soon as it has the keys asked for**. The record is what a curation *rule* reads and it
  carries no palette at all; a render needs the map, the palette pass and the cap, and
  the ledger is the only store that holds them per recipe key. This is one pass of a
  file, never `headroom.population()` — the pool nothing here loads.

`fractal-wallpapers`' own `curate gallery resolve` does exactly the same two reads, and
answers with the same pair; this is that path in-process, so a figure's provenance is
written from the records rather than from a printout somebody pasted.

## What is drawn

The engine, at the figure's own geometry, from the recipe's own coloring —
`renders.wallpaper_spec` is the bridge and it is the same one `locations-style-spectrum`
crosses. The 640×360 thumbnails the record points at are the pictures the *judges* were
shown; they are not a source for a figure, and nothing here opens one.

**What a fresh render does not carry is the autolevel curve.** Every candidate of this
pool was made with `band_autolevel/v1` switched on, and the ledger's recipe row keeps
only the reduced stamp of it — the operator, the switch, and the band's sha256 — because
that is what decides a recipe's *identity*. The curve itself is on the run's own record
and is a function of the render it was measured on, which a panel drawn at another size
is not. So a panel here is the engine's own render of the recipe, and the provenance
says so rather than implying the operator ran.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

from . import figures as figures_module
from . import records, renders, sheets
from .locations import SHEET_WIDTH, Drawn, panels, sheet_path

#: Where a recorded tentative gallery lives under the wallpaper project's tree, and what
#: the seats file inside a stamp is called.
TENTATIVE = ("curation", "tentative")
SEATS_NAME = "gallery.jsonl"

#: The store that answers a recipe key with the recipe. Read one streamed pass at a time
#: and never whole — see the module docstring.
LEDGER = ("curation", "candidate_ledger", "rows.jsonl")

#: What separates a stamp from a recipe key in a pick. The same separator a release key
#: uses, because both are one address made of parts a record spells.
PICK_SEPARATOR = "|"

#: What a panel is rendered at before it is fitted into its cell, and how many samples a
#: pixel each axis. Three times the cell's width for the same reason
#: `locations-style-spectrum` uses it: a wallpaper's fine texture is most of what makes
#: it read as a wallpaper, and a render made at cell size never has it to lose.
PANEL_RENDER = (1280, 720)
PANEL_SUPERSAMPLE = 3

#: What the recipe-to-render bridge was last measured to be worth, and how. Every pick
#: of `overview-gallery-hook` was drawn again at the candidate's own regime — 640x360,
#: supersample 2 — and compared with the stored picture its seat points at, the one the
#: judges scored; beside it, what re-encoding that same JPEG at this site's own quality
#: costs, which is the floor any comparison against a stored JPEG has. Read by hand on
#: 2026-09-02 and quoted in provenance rather than recomputed on every redraw: the
#: stored pictures live under the artifacts tree and a subtree of it may be archived,
#: and a figure that cannot be drawn without the archive plugged in is a worse figure.
#:
#: The reading is about twice the floor rather than at it, which is the honest shape of
#: it: close enough to say the recipe *is* the picture, and not identical — which is
#: where the autolevel curve would show if the operator had acted on any of the six.
RECIPE_AGREEMENT = "mean absolute difference 2.9-4.9 of 255, codec floor 1.4-2.6"

#: Every mode a figure of this module may label, in the words a reader has. The article's
#: first figure is met before the mode catalog exists, so a panel says what its rendering
#: *does* rather than what the engine calls it. A mode with no wording here is refused
#: rather than labelled with its own spelling: a reader meeting `smooth_angle_min` on the
#: front page has met the vocabulary before the article teaches any of it.
MODE_WORDS = {
    "smooth": "smooth",
    "tia": "triangle-inequality average",
    "stripe": "stripe average",
    "exp_smoothing": "exponential smoothing",
    "curvature": "curvature",
    "smooth_curvature": "curvature over smooth",
    "smooth_stripe": "stripe over smooth",
    "smooth_mean_angle": "trap spread angle over smooth",
    "smooth_angle_min": "closest trap angle over smooth",
    "threads": "cross trap over smooth",
    "itinerary": "orbit itinerary",
    "direct_trap_lines": "line trap",
    "direct_trap_screen": "screened trap",
    "direct_trap_multiply": "multiplied trap",
}


class PickError(RuntimeError):
    """A pick that does not resolve to a picture this repository can draw."""


@dataclass(frozen=True)
class Pick:
    """One tentative-gallery seat, resolved: the record's row and the render's recipe."""

    identifier: str
    stamp: str
    key: str
    seat: dict
    recipe: dict

    @property
    def alias(self) -> str:
        return str(self.seat.get("alias") or self.key[:8])

    @property
    def family(self) -> dict:
        return self.recipe["family"]

    @property
    def mode(self) -> str:
        return str(self.recipe["mode"])


# ------------------------------------------------------------------------- the records


def stamps() -> list[str]:
    """Every tentative gallery recorded on this machine, oldest first."""
    root = renders.artifact(*TENTATIVE)
    if not root.is_dir():
        return []
    return sorted(path.name for path in root.iterdir() if (path / SEATS_NAME).is_file())


def seats(stamp: str) -> dict[str, dict]:
    """One recorded gallery's seats, keyed by the recipe key each seat stands on."""
    path = renders.artifact(*TENTATIVE, stamp, SEATS_NAME)
    if not path.is_file():
        raise PickError(
            f"no tentative gallery recorded under {stamp} — {path} is not there. "
            f"Recorded here: {', '.join(stamps()) or 'none'}"
        )
    rows = {}
    with path.open(encoding="utf-8") as handle:
        for line in handle:
            if line.strip():
                row = json.loads(line)
                rows[str(row["key"])] = row
    return rows


def ledger_recipes(keys) -> dict[str, dict]:
    """`{key: recipe}` for the keys asked for, in one streamed pass that stops early.

    The ledger is a quarter of a gigabyte and a solve may be reading it, so this is a
    read of the file and never a load of the pool: it holds one line at a time and
    returns the moment every key asked for has been seen.
    """
    wanted = {str(key) for key in keys}
    path = renders.artifact(*LEDGER)
    if not path.is_file():
        raise PickError(f"no candidate ledger at {path}, so no pick resolves to a recipe")
    found: dict[str, dict] = {}
    with path.open(encoding="utf-8") as handle:
        for line in handle:
            if not line.strip():
                continue
            row = json.loads(line)
            key = str(row.get("key"))
            if key in wanted:
                found[key] = row["recipe"]
                if len(found) == len(wanted):
                    break
    return found


def split(identifier: str) -> tuple[str, str]:
    """One pick's `<stamp>|<key>`, held to being both."""
    stamp, separator, key = str(identifier).partition(PICK_SEPARATOR)
    if not separator or not stamp.strip() or not key.strip():
        raise PickError(
            f"{identifier!r} is not a pick — a pick is <stamp>{PICK_SEPARATOR}<recipe key>, "
            "the full key with the stamp it was recorded under"
        )
    return stamp.strip(), key.strip()


def resolve(identifiers) -> list[Pick]:
    """Every pick, in the order asked for. A pick that does not resolve is a refusal.

    Never a partial answer: a figure is six panels in an order Matt chose, and five of
    them with a hole is not a picture anybody wants landed on a page.
    """
    parts = [split(identifier) for identifier in identifiers]
    by_stamp: dict[str, dict[str, dict]] = {}
    for stamp, _ in parts:
        if stamp not in by_stamp:
            by_stamp[stamp] = seats(stamp)
    missing = [
        f"{stamp}{PICK_SEPARATOR}{key}" for stamp, key in parts if key not in by_stamp[stamp]
    ]
    if missing:
        raise PickError(
            f"{', '.join(missing)}: no seat of that recorded gallery has that key. "
            "An alias is not an address here — a pick is the full recipe key."
        )
    recipes = ledger_recipes({key for _, key in parts})
    unrecorded = [key for _, key in parts if key not in recipes]
    if unrecorded:
        raise PickError(
            f"{', '.join(unrecorded)}: seated in the gallery record and not in the candidate "
            "ledger, so nothing says which map or which cap drew it"
        )
    return [
        Pick(
            identifier=f"{stamp}{PICK_SEPARATOR}{key}",
            stamp=stamp,
            key=key,
            seat=by_stamp[stamp][key],
            recipe=recipes[key],
        )
        for stamp, key in parts
    ]


# -------------------------------------------------------------------------- the panels


def cache() -> renders.Cache:
    return renders.Cache()


def wallpaper_row(pick: Pick) -> dict:
    """One ledger recipe in the shape `renders.wallpaper_spec` reads.

    The two records spell the same picture differently — a finished-render row carries
    the palette pass under `recipe` and the cap under `render`, and a ledger recipe
    carries them under `palette` and `maxiter`. This is the whole of the difference, and
    it is written once here rather than at every call site.
    """
    recipe = pick.recipe
    return {
        "family": recipe["family"],
        "viewport": recipe["viewport"],
        "mode": recipe["mode"],
        "mode_params": recipe.get("mode_params") or {},
        "curve": recipe["curve"],
        "colormap": recipe["colormap"],
        "recipe": recipe["palette"],
        "render": {"maxiter": recipe["maxiter"]},
    }


def panel(pick: Pick, name: str, catalog: dict[str, dict]) -> Path:
    """One pick, rendered fresh through the engine at this module's panel geometry."""
    spec = renders.wallpaper_spec(
        wallpaper_row(pick),
        resolution=PANEL_RENDER,
        supersample=PANEL_SUPERSAMPLE,
        catalog=catalog,
    )
    return cache().produce(name, "render", spec).path


def family_name(family: dict) -> str:
    """A family as the article names it, in the shape a tile label wants."""
    kind = family.get("kind")
    if kind == "multibrot":
        return f"Multibrot d = {family.get('degree')}"
    if kind == "julia":
        degree = int(family.get("degree", 2))
        return "Julia" if degree == 2 else f"Julia d = {degree}"
    return {"mandelbrot": "Mandelbrot", "phoenix": "Phoenix"}.get(kind, str(kind))


def mode_words(mode: str) -> str:
    """What a tile calls a rendering mode, or a refusal naming the mode with no wording."""
    if mode not in MODE_WORDS:
        raise PickError(
            f"no wording for mode {mode!r} — a panel of this figure says what its "
            f"rendering does rather than what the engine spells it, so add it to "
            f"{__name__}.MODE_WORDS before picking a wallpaper drawn in it"
        )
    return MODE_WORDS[mode]


# ------------------------------------------------------------------------- the figures

#: How many panels across the hook runs, and how many rows it fills.
HOOK_COLUMNS = 3
HOOK_ROWS = 2

#: How many lines a tile label under the hook carries: the family, then the rendering.
HOOK_LABEL_LINES = 2


def picks_of(identifier: str) -> list[str]:
    """The IDs a figure's own registry row names, which is where the picks live."""
    figure = figures_module.load_all().get(identifier)
    if figure is None:
        raise PickError(f"{identifier} is not in the figure registry")
    if figure.recipe is None or "picks" not in figure.recipe.args:
        raise PickError(
            f"{identifier}'s registry row carries no `picks` — a figure of this module "
            "names its panels by tentative-gallery ID in its own recipe args"
        )
    wanted = figure.recipe.args["picks"]
    if not isinstance(wanted, list) or not all(isinstance(one, str) for one in wanted):
        raise PickError(f"{identifier}: `picks` is a list of <stamp>{PICK_SEPARATOR}<key> strings")
    return list(wanted)


def gallery_hook() -> Drawn:
    """The article's opening figure: six wallpapers the search found, three across, two down.

    Nothing about which six is this module's choice — they are the IDs on the registry
    row, in the order they are written there, filling left to right and then down.
    """
    identifier = "overview-gallery-hook"
    wanted = picks_of(identifier)
    if len(wanted) != HOOK_COLUMNS * HOOK_ROWS:
        raise PickError(
            f"{identifier} is {HOOK_COLUMNS}x{HOOK_ROWS} and its row names {len(wanted)} pick(s)"
        )
    resolved = resolve(wanted)
    catalog = renders.mode_catalog()
    size = panels(HOOK_COLUMNS)
    caption = sheets.caption_band(size[1], SHEET_WIDTH, HOOK_LABEL_LINES)
    sheet, draw = sheets.canvas(*sheets.grid_size(size, HOOK_COLUMNS, HOOK_ROWS, caption))
    for index, pick in enumerate(resolved):
        picture = panel(pick, f"hook-{index + 1}-{pick.alias}", catalog)
        origin = sheets.panel_origin(index, size, HOOK_COLUMNS, caption)
        sheet.paste(sheets.fitted(picture, size), origin)
        sheets.tile_label(
            draw,
            origin,
            size,
            [family_name(pick.family), mode_words(pick.mode)],
            sheet.width,
        )
    destination = sheets.save(sheet, sheet_path(identifier))
    return Drawn(destination, provenance(resolved, size))


# ---------------------------------------------------------------------- the provenance


def shade_words(palette: dict) -> str:
    """One palette pass spelled in words, the way `links.py`'s scanner reads a shade.

    Not as JSON. `builder/links.py` derives a permalink by scanning provenance prose, and
    what it looks for is `mirror true` as a bare phrase and a `palette gamma …` clause; a
    pass written out as a JSON object reads to it as *no fold and every default*, which
    is a link that opens a picture the reader was not just looking at — the one failure
    the whole link registry exists to refuse. So the words are the record here, and
    anything the words cannot say is a refusal rather than a rounding.
    """
    for name in ("transfer", "rolloff"):
        stage = palette.get(name) or {}
        if set(stage) - {"kind"}:
            raise PickError(
                f"the {name} stage carries {sorted(set(stage) - {'kind'})} beside its kind, "
                "and a provenance line spells a palette pass in words a link can read. "
                "Widen shade_words before picking a wallpaper coloured this way."
            )
    return (
        f"palette gamma {number(palette['gamma'])}, cycles {number(palette['cycles'])}, "
        f"phase {number(palette['phase'])}, reverse {flag(palette['reverse'])}, "
        f"transfer {(palette.get('transfer') or {}).get('kind')}, "
        f"rolloff {(palette.get('rolloff') or {}).get('kind')}"
    )


def number(value) -> str:
    """A palette knob, without the trailing zero a float carries and a reader does not."""
    text = f"{float(value):.6f}".rstrip("0").rstrip(".")
    return text or "0"


def flag(value) -> str:
    return "true" if value else "false"


def frame_line(pick: Pick, *, representative: bool) -> str:
    """One panel: the seat it was, and everything it takes to draw the picture again.

    **Exactly one line of a row puts the word `colormap` in front of a map's name**, and
    that line is the representative panel's — the one a link is derived from. Every other
    line says `palette` instead, so a sheet of six is one link at its opening picture
    rather than six gradients the explorer is asked to carry.
    """
    recipe = pick.recipe
    family = recipe["family"]
    viewport = recipe["viewport"]
    kind = family.get("kind")
    named = f"family {kind}"
    if kind in ("multibrot", "julia"):
        named += f", degree {family.get('degree', 2)}"
    for constant in ("c", "p", "z_prev"):
        if family.get(constant):
            named += f", {constant} = {family[constant][0]} + {family[constant][1]}i"
    map_word = "colormap" if representative else "palette"
    palette = recipe["palette"]
    return (
        f"{family_name(family)}, {mode_words(pick.mode)}: gallery seat "
        f"{pick.stamp}{PICK_SEPARATOR}{pick.key}, alias {pick.alias}, seat "
        f"{pick.seat.get('seat')}, partition {pick.seat.get('partition')} — {named}, "
        f"centre {viewport['center_re']} + {viewport['center_im']}i, "
        f"width {viewport['width']}, mode {recipe['mode']}"
        + (f" {json.dumps(recipe['mode_params'])}" if recipe.get("mode_params") else "")
        + f", curve {recipe['curve']}, {map_word} {recipe['colormap']}, "
        f"mirror {flag(palette.get('mirror'))}, cap {recipe['maxiter']}, no crop beyond "
        f"the sheet's; {shade_words(palette)}. The candidate the seat stands on was drawn "
        f"at regime {recipe['regime']} and scored P(>=4) {pick.seat.get('p_ge4')}."
    )


def autolevel_line(picks: list[Pick]) -> str:
    """What the operator did to the pictures Matt picked off, and what a panel here is."""
    stamped = sorted({str((pick.recipe.get("autolevel") or {}).get("operator")) for pick in picks})
    switches = sorted({str((pick.recipe.get("autolevel") or {}).get("switch")) for pick in picks})
    return (
        f"Autolevel: every candidate behind these seats was made with "
        f"{', '.join(stamped)} switched {', '.join(switches)}, and a ledger recipe keeps only "
        "the reduced stamp of that — the operator, the switch and the band's sha256. The tone "
        "curve itself is a function of the render it was measured on, which a panel drawn at "
        "another size is not, so every panel here is the engine's own render of the recipe and "
        "no curve was replayed onto it. Held to that: each pick redrawn at the candidate's own "
        f"640x360 supersample 2 reproduces the stored picture its seat points at to "
        f"{RECIPE_AGREEMENT}, so the operator either did not act on any of the six or acted "
        "under what that record's own compression costs."
    )


def provenance(picks: list[Pick], size: tuple[int, int]) -> list[str]:
    """The registry lines for a sheet of picks: the composition, then one line per panel."""
    stamped = sorted({pick.stamp for pick in picks})
    lines = [
        f"builder.picks — every panel is a seat of a recorded tentative gallery, named on "
        f"this row by its own `<stamp>{PICK_SEPARATOR}<recipe key>` and resolved from "
        f"artifacts/curation/tentative/<stamp>/{SEATS_NAME} for the seat and the candidate "
        f"ledger for the recipe. Rendered fresh through the engine at {PANEL_RENDER[0]}x"
        f"{PANEL_RENDER[1]}, supersample {PANEL_SUPERSAMPLE}, then fitted to "
        f"{size[0]}x{size[1]} in the sheet; the stored 640x360 thumbnail a seat points at "
        f"is the picture the judges were shown and is not a source here. Nothing about the "
        f"coloring is this figure's choice: mode, mode settings, curve, map, the whole "
        f"palette pass and the cap all come off the ledger's recipe. Stamp"
        f"{'s' if len(stamped) > 1 else ''} {', '.join(stamped)}; panels in reading order, "
        f"{HOOK_COLUMNS} across.",
        autolevel_line(picks),
    ]
    lines += [frame_line(pick, representative=index == 0) for index, pick in enumerate(picks)]
    return lines


# ----------------------------------------------------------------------- the interface

MAKERS = {
    "overview-gallery-hook": gallery_hook,
}


def sources(identifier: str) -> list[dict]:
    """The registry `sources` for a figure of this module: its picks, as gallery seats."""
    return [{"kind": figures_module.GALLERY_SEAT, "keys": picks_of(identifier)}]


def recipe(identifier: str) -> dict:
    """The registry recipe: the maker, and the picks the row already names.

    Read back off the row rather than restated, because the row is where a pick is
    edited — a constant here would be a second list to keep in step with the first.
    """
    if identifier not in MAKERS:
        raise records.RecordError(f"{identifier} is not drawn by {__name__}")
    return {
        "maker": f"{__name__}:{MAKERS[identifier].__name__}",
        "args": {"picks": picks_of(identifier)},
    }


def draw(identifier: str) -> Drawn:
    if identifier not in MAKERS:
        raise records.RecordError(f"{identifier} is not drawn by {__name__}")
    return MAKERS[identifier]()
