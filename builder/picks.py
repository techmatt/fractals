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

`fractal-wallpapers`' own `curate solve resolve` does exactly the same two reads, and
answers with the same pair; this is that path in-process, so a figure's provenance is
written from the records rather than from a printout somebody pasted.

## What is drawn

The engine, at the figure's own geometry, from the recipe's own coloring —
`renders.wallpaper_spec` is the bridge and it is the same one `locations-style-spectrum`
crosses. The 640×360 thumbnails the record points at are the pictures the *judges* were
shown; they are not a source for a figure, and nothing here opens one.

## The autolevel curve, and the third read that finds it

Every candidate of this pool was made with `band_autolevel/v1` switched on. The operator
measures a finished render's tone, and where that tone sits outside the band of finished
wallpapers it pushes a curve through the **map's own stops** and renders again — so the
picture a seat ships is drawn through a colormap that is not quite the one the recipe
names. **A fresh render of the recipe alone is therefore the wrong picture whenever the
operator acted**, and wrong by a lot: `a693d6c7` came back at mean absolute difference
29.5 of 255 from its own gallery tile, a deep rust ground rendered as pale salmon.

The ledger's recipe row cannot fix that on its own. It keeps the **reduced** stamp — the
operator, the switch, and the band's sha256 — because that is what decides a recipe's
*identity*, and the curve is not part of an identity. The curve is on the **run's** own
record, which the ledger row names in `provenance.run` and addresses again by the file in
`picture`. So a pick resolves through a third read, `run_stamp` below, and where that
stamp acted the panel is rendered through the stops
`fractal_wallpapers.coloring.autolevel.stops_from_stamp` rebuilds — the project's own
operator replaying its own curve, never a second one measured here. Re-measuring was
tried and is not equivalent: the same frame redrawn at the seat's own regime derives a
black point of 0.634 where the run stamped 0.595, so a re-measurement would quietly
publish a different picture from the one the gallery shows.

**Four run stores, and only two of them keep the curve.** A candidate made by a
`reframe_draw` run or a gallery `runs` pass has its whole stamp on that run's record. The
other two do not:

- a **`depth` run writes down `acted` and nothing else** — no curve, no band — so a seat
  it acted on cannot be redrawn correctly from any record this project keeps;
- a **`mine` run does not write down even that**, keeping only the reduced stamp its
  ledger row already carries, so nothing says whether the operator acted at all. A record
  that does not say a picture was left alone is not a record that says it was, and the
  answer here is the same as if it had acted.

That is a gap in the wallpaper project's own records and is not this repository's to
close; `run_stamp` reports both as `acted_unrecoverable` and `seat_picture` is the way
out, copying the seat's shipped picture rather than publishing a render known to be — or
merely not known not to be — the wrong colour.
"""

from __future__ import annotations

import json
import re
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

#: Where each kind of run writes the records carrying its own autolevel stamp, and which
#: field of each addresses one row. A `depth` run is matched by the recipe key it drew;
#: the others by the picture file, because their rows are numbered by attempt and the
#: ledger's `picture` is the only name shared across both stores.
#:
#: **A kind may write more than one record, and every one of them has to be named here.**
#: A `runs` pass writes `candidates.jsonl` for the candidates its own plan asked for and
#: `on_demand.jsonl` for the ones Matt asked for from the browser — the `d####.jpg`
#: pictures — and for a year this named only the first. Fifteen seats of the tentative
#: gallery then had no record this could reach, so a figure naming one raised rather than
#: mis-drew; `check`'s `seats` now holds every seat a figure cites to being reachable
#: through this table, so the next unnamed record is a red rather than a silent gap.
RUN_RECORDS = {
    "depth": (("sequence.jsonl", "key"),),
    "hunt": (("rows.jsonl", "key"),),
    "mine": (("rows.jsonl", "key"),),
    "reframe_draw": (("attempts.jsonl", "picture"),),
    "runs": (("candidates.jsonl", "picture"), ("on_demand.jsonl", "picture")),
}

#: What `run_stamp` answers with, in the one word a caller has to branch on.
UNTOUCHED, REPLAYED, UNRECOVERABLE = "untouched", "replayed", "acted_unrecoverable"

#: What separates a stamp from a recipe key in a pick. The same separator a release key
#: uses, because both are one address made of parts a record spells.
PICK_SEPARATOR = "|"

#: `.gitattributes` normalizes this repository to LF; anything written here spells it.
LF = "\n"

#: What a panel is rendered at before it is fitted into its cell, and how many samples a
#: pixel each axis. Three times the cell's width for the same reason
#: `locations-style-spectrum` uses it: a wallpaper's fine texture is most of what makes
#: it read as a wallpaper, and a render made at cell size never has it to lose.
PANEL_RENDER = (1280, 720)
PANEL_SUPERSAMPLE = 3

#: What the recipe-to-render bridge is worth, and how it was read. **Every** seat panel
#: on the site — all twenty-one — drawn again at the candidate's own regime, 640x360
#: supersample 2, and compared with the stored picture its seat points at; beside it,
#: what re-encoding that same JPEG at this site's own quality costs, which is the floor
#: any comparison against a stored JPEG has. Measured 2026-09-02 and quoted in provenance
#: rather than recomputed on every redraw: the stored pictures live under the artifacts
#: tree and a subtree of it may be archived, and a figure that cannot be drawn without
#: the archive plugged in is a worse figure.
#:
#: The reading is about twice the floor rather than at it, which is the honest shape of
#: it: close enough to say the recipe *is* the picture, and not identical, because the
#: engine's sampling and a stored JPEG never agree to the byte. What it is emphatically
#: not is a band wide enough to hide a tone curve — `a693d6c7` unlevelled read 29.51.
#: `check`'s `seats` is what holds this true rather than a note that was true once.
RECIPE_AGREEMENT = "mean absolute difference 3.0-5.5 of 255, codec floor 1.4-2.8"

#: Every mode a figure of this module may label, in the words a reader has. The article's
#: first figure is met before the mode catalog exists, so a panel says what its rendering
#: *does* rather than what the engine calls it. A mode with no wording here is refused
#: rather than labelled with its own spelling: a reader meeting `smooth_angle_min` on the
#: front page has met the vocabulary before the article teaches any of it.
MODE_WORDS = {
    "smooth": "smooth",
    "tia": "triangle-inequality average",
    "stripe": "stripe average",
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
    #: The ledger row's own account of where the candidate came from: `provenance.run`
    #: and `provenance.candidate`, and the `picture` that run wrote. It is what
    #: `run_stamp` addresses the run's record by, and what `seat_picture` opens.
    source: dict

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


def ledger_rows(keys) -> dict[str, dict]:
    """`{key: row}` for the keys asked for, in one streamed pass that stops early.

    The ledger is a quarter of a gigabyte and a solve may be reading it, so this is a
    read of the file and never a load of the pool: it holds one line at a time and
    returns the moment every key asked for has been seen.

    The whole row rather than just its recipe, because the recipe alone cannot say which
    run drew the candidate — and without that there is no way to reach the autolevel
    curve the run stamped, which the recipe deliberately does not carry.
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
            try:
                row = json.loads(line)
            except json.JSONDecodeError:
                # A run next door appends to this file while a figure reads it, so the
                # last line can be half-written. Skipping an unreadable row is safe here
                # only because `resolve` refuses by name for every key it did not find —
                # a torn row that happened to be a wanted one comes back as a refusal
                # naming that key, never as a figure quietly drawn without it.
                continue
            key = str(row.get("key"))
            if key in wanted:
                found[key] = row
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
    rows = ledger_rows({key for _, key in parts})
    unrecorded = [key for _, key in parts if key not in rows]
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
            recipe=rows[key]["recipe"],
            source={
                "picture": rows[key].get("picture"),
                **(rows[key].get("provenance") or {}),
            },
        )
        for stamp, key in parts
    ]


# ----------------------------------------------------------------------- the tone curve


@dataclass(frozen=True)
class Levelling:
    """What the autolevel operator did to one seat's picture, read off the run's record.

    `way` is the one word a caller branches on, and the rest is what the provenance line
    needs so that a reader of the record can tell which of the three happened without
    opening the wallpaper project at all.
    """

    way: str
    #: Which record answered, as `<kind>/<run>` — named in provenance so that a person
    #: chasing a colour can open the same file this did.
    where: str
    #: The full stamp, where the run kept one. `None` for a depth run, which does not.
    stamp: dict | None

    @property
    def acted(self) -> bool:
        return self.way in (REPLAYED, UNRECOVERABLE)


def run_record(pick: Pick) -> tuple[str, list[tuple[Path, str]]]:
    """Which run wrote this candidate, and every record of that run's that could hold it.

    A list rather than one file, because a kind may keep more than one: a `runs` pass
    writes its planned candidates to one record and the ones asked for from the browser
    to another, and a seat can be in either.
    """
    stored = str(pick.source.get("picture") or "")
    if not stored:
        raise PickError(
            f"{pick.identifier}: the ledger row names no picture, so nothing says which run "
            "drew it or where that run wrote its autolevel stamp"
        )
    parts = [part for part in stored.replace("\\", "/").split("/") if part]
    # artifacts / curation / <kind> / <run> / pictures / <file>
    if len(parts) < 5 or parts[1] != "curation" or parts[2] not in RUN_RECORDS:
        raise PickError(
            f"{pick.identifier}: {stored} is not a picture under a run store this knows — "
            f"the kinds are {', '.join(sorted(RUN_RECORDS))}"
        )
    kind, run = parts[2], parts[3]
    named = [
        (renders.artifact("curation", kind, run, name), match) for name, match in RUN_RECORDS[kind]
    ]
    return f"{kind}/{run}", named


def run_stamp(pick: Pick) -> Levelling:
    """The autolevel stamp of the run that drew this candidate, and what it means here.

    The third read of a pick, and the one that decides what colour the panel comes out.
    See the module docstring: a `depth` run records only whether the operator acted, so a
    seat it acted on is `acted_unrecoverable` and no render of the recipe is that seat's
    picture.
    """
    where, named = run_record(pick)
    present = [(path, match) for path, match in named if path.is_file()]
    if not present:
        raise PickError(
            f"{pick.identifier}: {where} kept none of "
            f"{', '.join(path.name for path, _ in named)}, so no stamp answers"
        )
    for path, match in present:
        found = _stamp_in(pick, where, path, match)
        if found is not None:
            return found
    filename = str(pick.source["picture"]).replace("\\", "/").rsplit("/", 1)[-1]
    raise PickError(
        f"{pick.identifier}: no record of {where} — {', '.join(p.name for p, _ in present)} — "
        f"has a row for {filename}, so nothing says whether the autolevel operator acted on "
        "the picture the gallery ships"
    )


def _stamp_in(pick: Pick, where: str, path: Path, match: str) -> Levelling | None:
    """One run record read for this pick's row, or `None` where it has no row for it."""
    filename = str(pick.source["picture"]).replace("\\", "/").rsplit("/", 1)[-1]
    with path.open(encoding="utf-8") as handle:
        for line in handle:
            if not line.strip():
                continue
            if match == "key":
                if pick.key not in line:
                    continue
                row = json.loads(line)
                if str(row.get("key")) != pick.key:
                    continue
                # A depth run stamps the fact and drops the curve; a mine or a hunt run
                # does not stamp even the fact, and a record that does not say the
                # operator left a picture alone is not a record that says it did. Both are
                # unrecoverable here, and only the depth one is unrecoverable *knowing* it
                # acted. The one exception is a recipe carrying no autolevel identity at
                # all: that is the operator's own ruling that it has nothing to say about
                # this mode's kind — a direct trap paints over a flat ground and a
                # modulate reads a different place in the map per sample — so there was
                # never a curve for the run to record, and the engine's render is the
                # picture.
                if "acted" not in row:
                    if pick.recipe.get("autolevel") is None:
                        return Levelling(UNTOUCHED, where, None)
                    return Levelling(UNRECOVERABLE, where, None)
                acted = bool(row.get("acted"))
                return Levelling(UNRECOVERABLE if acted else UNTOUCHED, where, None)
            if filename not in line:
                continue
            row = json.loads(line)
            if str(row.get("picture") or "").replace("\\", "/").rsplit("/", 1)[-1] != filename:
                continue
            stamp = row.get("autolevel") or {}
            if not stamp.get("acted"):
                return Levelling(UNTOUCHED, where, stamp or None)
            if not stamp.get("curve"):
                return Levelling(UNRECOVERABLE, where, stamp)
            return Levelling(REPLAYED, where, stamp)
    return None


def levelled_colormap(pick: Pick, stamp: dict) -> Path:
    """A directory holding this map, curved by the stops the run's own stamp rebuilds.

    The same arrangement `builder/palettes.py` uses for the autolevel figure and the same
    one the operator itself uses — one spec with one colormap directory changed — so the
    engine's fold decision and its bake are the production call's, and only the stop
    colours differ.
    """
    name = str(pick.recipe["colormap"])
    replayed = renders.levelled_stops(name, stamp)
    return renders.colormap_directory(
        name,
        replayed["kind"],
        replayed["stops"],
        renders.spec_key("levelled", {"colormap": name, "curve": stamp["curve"]}),
    )


def seat_picture(pick: Pick) -> Path:
    """The picture the gallery browser ships for this seat, on the disk it is on.

    The way out of `acted_unrecoverable`: where no record carries the curve, the seat's
    own file is the only thing that *is* the seat's picture, and copying it is honest in
    a way redrawing the recipe and calling it the same picture is not.
    """
    stored = pick.seat.get("picture") or pick.source.get("picture")
    if not stored:
        raise PickError(f"{pick.identifier}: neither the seat nor the ledger row names a picture")
    path = renders.rehome(stored)
    if path is None or not path.is_file():
        raise PickError(f"{pick.identifier}: {stored} is not on this machine")
    return path


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


def panel_spec(
    pick: Pick,
    catalog: dict[str, dict],
    *,
    resolution=PANEL_RENDER,
    supersample: int = PANEL_SUPERSAMPLE,
    levelling: Levelling | None = None,
) -> dict:
    """The engine spec that draws this seat's picture, tone curve and all.

    One place, because the check and the makers have to ask the engine for the *same*
    picture — a guard that renders the seat differently from the rig is a guard that
    passes while the page is wrong.
    """
    spec = renders.wallpaper_spec(
        wallpaper_row(pick),
        resolution=resolution,
        supersample=supersample,
        catalog=catalog,
    )
    levelling = levelling if levelling is not None else run_stamp(pick)
    if levelling.way == REPLAYED:
        spec = dict(spec, colormap_dir=str(levelled_colormap(pick, levelling.stamp)))
    return spec


def panel(pick: Pick, name: str, catalog: dict[str, dict]) -> Path:
    """One pick at this module's panel geometry, drawn the way its seat was drawn.

    Where the run's autolevel operator acted and the run kept its curve, the panel goes
    through the levelled stops that curve rebuilds. Where it acted and the run kept no
    curve, this refuses rather than publishing a render known to be the wrong colour —
    the caller's answer is `seat_picture`, and it has to say so in provenance.
    """
    levelling = run_stamp(pick)
    if levelling.way == UNRECOVERABLE:
        raise PickError(
            f"{pick.identifier}: the autolevel operator acted on this candidate and "
            f"{levelling.where} did not record the curve, so no render of the recipe is the "
            "picture the gallery ships. Copy it with `seat_picture`, or re-pick the seat."
        )
    spec = panel_spec(pick, catalog, levelling=levelling)
    return cache().produce(name, "render", spec).path


def panel_or_seat(pick: Pick, name: str, catalog: dict[str, dict]) -> tuple[Path, Levelling]:
    """The panel, or the seat's own shipped picture where nothing can reproduce it.

    For a maker that would rather publish the gallery's picture than nothing. It hands
    back what it did as well as the file, because a copied panel is not the same claim as
    a drawn one and the row has to say which it is — `unrecoverable_line` is the sentence.
    """
    levelling = run_stamp(pick)
    if levelling.way == UNRECOVERABLE:
        return seat_picture(pick), levelling
    return cache().produce(name, "render", panel_spec(pick, catalog, levelling=levelling)).path, (
        levelling
    )


def unrecoverable_line(pick: Pick, levelling: Levelling) -> str:
    """Why one panel is a copied file rather than a render, in the record's own terms."""
    return (
        f"{pick.alias} is the seat's own shipped picture, copied rather than redrawn: "
        f"{pick.seat.get('picture')}. The autolevel operator acted on this candidate — it "
        "pushed a tone curve through the map's stops and the run wrote the picture that "
        f"came back — and {levelling.where} records only that it acted, never the curve, so "
        "no render of the recipe is this seat's picture. A depth run keeps the fact and "
        "drops the coefficients; the two stores that keep the whole stamp are reframe_draw "
        "and a gallery pass. The cost is the panel's own sharpness — a stored 640x360 "
        "supersample 2 JPEG where its neighbours are 1280x720 supersample 3 fitted down — "
        "and it is the cheaper of the two errors, the other being a wallpaper published in "
        "a colour the gallery does not show."
    )


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

#: The Rendering modes roster, in the engine catalog's own order — the order the page's
#: own scoreboard reads in, and the order the sheet draws. Spelled here rather than read
#: out of the catalog next door for the reason the explorer's mode record is spelled out:
#: a mode promoted to production over there is a panel somebody has to pick, never one a
#: redraw quietly adds to a figure a reader has already been shown.
MODES_ROSTER = (
    "smooth",
    "tia",
    "stripe",
    "curvature",
    "smooth_mean_angle",
    "smooth_angle_min",
    "smooth_stripe",
    "smooth_curvature",
    "direct_trap_screen",
    "direct_trap_multiply",
    "direct_trap_lines",
    "threads",
    "itinerary",
)

#: The roster's shape: thirteen panels in sixteen cells, four across. Five across left
#: each panel too small to read a rendering mode off, which is the only thing this figure
#: asks a reader to do — the page's whole argument is that these thirteen pictures differ
#: in a way you can see. Four across buys a third more width per panel and costs one more
#: row. The three cells left over are well and nothing else; one of them was a panel until
#: the roster lost a mode to a niche ruling *(2026-09-04)*, and one used to carry a legend
#: saying what the caption says a few lines below the picture, which is the same paragraph
#: twice *(Matt, 2026-09-02, taking the last of these off the page)*.
MODES_COLUMNS = 4
MODES_ROWS = 4

#: How a panel of the roster is labelled: the engine's own name for the mode, which is
#: the name this page teaches and the name its scoreboard lists. Not `MODE_WORDS` — that
#: is for the front page, which meets a rendering before the vocabulary exists.
MODES_LABEL_LINES = 1

#: How the thirteen seats were arrived at, which is the one thing the resolution cannot
#: say for itself. Written down because a random draw is only a record if the draw is.
MODES_DRAW = (
    "Which seat stands for a mode is a uniform random draw over that mode's q4 seats of "
    "the stamp — scratch/modes/repick_gallery.py, seed 20260905 — rejecting any seat "
    "standing on a location another figure already stands on, and any whose run recorded "
    "that the autolevel operator acted without recording the curve it acted with. A q4 "
    "seat is one over P(>=4) 0.50, the render judge's own cutpoint and the bar the solve "
    "seats on; the stamp filled all thousand of its seats and every one of them clears "
    "it, so the bar refused nothing here and is stated because a later stamp's might. "
    "Nothing was chosen for how it looks: the figure's claim is that the roster draws "
    "wallpapers, and a hand-picked panel per mode would be a claim about the picker.",
    "A seat's mode is read off the ledger recipe and never off the seat row, the two "
    "having disagreed on eighteen seats of an earlier stamp — every one seated as smooth "
    "and recipe'd as itinerary — and the recipe being what the engine is handed.",
)


#: The grid the gallery figure ships: twenty-four seats, six across. A pass seats
#: hundreds and a figure shows a sample of them, which the caption says out loud — the
#: claim being made is about the collection's spread and not its size.
OUTPUT_COLUMNS = 6
OUTPUT_ROWS = 4

#: How a tile of that grid is labelled: the fractal family it was found in, which is the
#: axis the pass constrains nothing on and the page says so.
OUTPUT_LABEL_LINES = 1

#: How the twenty-four were arrived at, which the resolution cannot say for itself.
OUTPUT_DRAW = (
    "Which seats stand for the pass is a seeded shuffle of its whole seating — "
    "scratch/curation/pick_output.py, seed 20260903 — taking the first that clear four "
    "rejections: a seat another figure already stands on, by key and by frame; a seat "
    "whose run recorded that the autolevel operator acted without recording the curve; "
    "and the caps that keep one draw from being a picture of itself rather than of the "
    "pass — at most four tiles of one rendering mode, three of one hue family, four of "
    "one partition. Nothing here was chosen for how it looks.",
    "The spread that came back: eleven of the pass's fourteen modes, nine partitions, "
    "and all twelve hue families plus one picture the reading finds dominant in no "
    "color at all.",
)


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


def modes_gallery() -> Drawn:
    """The Rendering modes roster: one gallery seat per mode, in the catalog's own order.

    Which seat is not this module's choice any more than the hook's six are — the IDs are
    on the registry row. What is fixed here is the roster: exactly one pick per mode of
    `MODES_ROSTER` and in its order, so a row that has drifted out of the order the page's
    scoreboard reads in is a refusal rather than a sheet whose labels run out of step with
    the table above it.
    """
    identifier = "modes-gallery"
    wanted = picks_of(identifier)
    resolved = resolve(wanted)
    drawn = [pick.mode for pick in resolved]
    if drawn != list(MODES_ROSTER):
        raise PickError(
            f"{identifier} is one seat per mode in the engine catalog's order — "
            f"{', '.join(MODES_ROSTER)} — and its row names {', '.join(drawn) or 'none'}"
        )
    catalog = renders.mode_catalog()
    size = panels(MODES_COLUMNS)
    caption = sheets.caption_band(size[1], SHEET_WIDTH, MODES_LABEL_LINES)
    sheet, draw = sheets.canvas(*sheets.grid_size(size, MODES_COLUMNS, MODES_ROWS, caption))
    for index, pick in enumerate(resolved):
        picture = panel(pick, f"modes-{index + 1}-{pick.alias}", catalog)
        origin = sheets.panel_origin(index, size, MODES_COLUMNS, caption)
        sheet.paste(sheets.fitted(picture, size), origin)
        sheets.tile_label(draw, origin, size, pick.mode, sheet.width)
    destination = sheets.save(sheet, sheet_path(identifier))
    return Drawn(
        destination,
        provenance(resolved, size, columns=MODES_COLUMNS, chosen=MODES_DRAW),
    )


def gallery_output() -> Drawn:
    """`gallery-output` — a sample of what one curation pass ships, labelled by family.

    The same shape as the roster above and a different claim: the roster is one seat a
    mode and says so, this is a draw over the whole seating and says that. Which seats
    is not this module's choice — they are the IDs on the registry row.
    """
    identifier = "gallery-output"
    wanted = picks_of(identifier)
    if len(wanted) != OUTPUT_COLUMNS * OUTPUT_ROWS:
        raise PickError(
            f"{identifier} is {OUTPUT_COLUMNS}x{OUTPUT_ROWS} and its row names "
            f"{len(wanted)} pick(s)"
        )
    resolved = resolve(wanted)
    catalog = renders.mode_catalog()
    size = panels(OUTPUT_COLUMNS)
    caption = sheets.caption_band(size[1], SHEET_WIDTH, OUTPUT_LABEL_LINES)
    sheet, draw = sheets.canvas(*sheets.grid_size(size, OUTPUT_COLUMNS, OUTPUT_ROWS, caption))
    for index, pick in enumerate(resolved):
        picture = panel(pick, f"output-{index + 1}-{pick.alias}", catalog)
        origin = sheets.panel_origin(index, size, OUTPUT_COLUMNS, caption)
        sheet.paste(sheets.fitted(picture, size), origin)
        sheets.tile_label(draw, origin, size, family_name(pick.family), sheet.width)
    destination = sheets.save(sheet, sheet_path(identifier))
    return Drawn(
        destination,
        provenance(resolved, size, columns=OUTPUT_COLUMNS, chosen=OUTPUT_DRAW),
    )


# ------------------------------------------------------------------- minibrots in a row

#: Three across, one down, and no lettering at all. The figure's whole claim is that the
#: small dark shape in each of these wallpapers is a copy of the set, so anything drawn
#: over the picture is competing with the one thing the reader is being asked to look at.
MINIBROT_COLUMNS = 3

#: How the three were arrived at, for the row's own provenance.
MINIBROT_DRAW = (
    "Chosen by this session from the 1,000-seat tentative gallery, out of the 129 seats "
    "on a parameter plane whose shipped picture carries one compact near-black region "
    "wholly inside the frame — a copy's body rather than a lobe running off an edge — "
    "measured on the seat's own thumbnail, narrowed to the ones whose run kept enough "
    "of the autolevel stamp to be redrawn from the recipe, and then looked at. One seat "
    "per plane and no two through the same rendering mode or hue family, so the row "
    "varies in everything except the shape it is about.",
)


def minibrot_examples() -> Drawn:
    """Three finished wallpapers with a minibrot's body plainly in frame."""
    identifier = "locations-minibrot-examples"
    wanted = picks_of(identifier)
    if len(wanted) != MINIBROT_COLUMNS:
        raise PickError(
            f"{identifier} is a row of {MINIBROT_COLUMNS} and its row names {len(wanted)} pick(s)"
        )
    resolved = resolve(wanted)
    catalog = renders.mode_catalog()
    size = panels(MINIBROT_COLUMNS)
    sheet, _draw = sheets.canvas(*sheets.grid_size(size, MINIBROT_COLUMNS, 1, caption=0))
    for index, pick in enumerate(resolved):
        picture = panel(pick, f"minibrot-{index + 1}-{pick.alias}", catalog)
        sheet.paste(
            sheets.fitted(picture, size),
            sheets.panel_origin(index, size, MINIBROT_COLUMNS, caption=0),
        )
    destination = sheets.save(sheet, sheet_path(identifier))
    return Drawn(
        destination,
        provenance(resolved, size, columns=MINIBROT_COLUMNS, chosen=MINIBROT_DRAW),
    )


# ------------------------------------------------------------------ one mode, two pairs

#: The Rendering modes page's per-mode figure: two examples down, and each example is the
#: same location twice — `smooth` on the left, the mode on the right. The comparison is
#: the whole figure, so the two panels of a row differ in exactly one field of the recipe.
PAIR_COLUMNS = 2
PAIR_ROWS = 2

#: One line under a panel: which rendering drew it. The engine's own spelling, because
#: this page is where a reader meets the roster and its scoreboard lists the same words.
PAIR_LABEL_LINES = 1

#: The mode a panel is swapped to on the left of every row.
SMOOTH = "smooth"

#: How a candidate's regime is spelled in the ledger, and what it means.
REGIME = re.compile(r"^(\d+)x(\d+)ss(\d+)$")

#: Which mode each per-mode figure of the page stands for. Spelled here rather than read
#: off whatever the picks happen to be, for the reason `MODES_ROSTER` is spelled: a mode
#: promoted or re-picked next door is a panel somebody chose, never one a redraw quietly
#: swaps under a caption a reader has already been shown. `smooth` has no figure of its
#: own — it is introduced a section earlier and is the left half of every row here.
MODE_FIGURES = {
    "modes-tia": "tia",
    "modes-stripe": "stripe",
    "modes-curvature": "curvature",
    "modes-smooth-mean-angle": "smooth_mean_angle",
    "modes-smooth-angle-min": "smooth_angle_min",
    "modes-smooth-stripe": "smooth_stripe",
    "modes-smooth-curvature": "smooth_curvature",
    "modes-direct-trap-screen": "direct_trap_screen",
    "modes-direct-trap-multiply": "direct_trap_multiply",
    "modes-direct-trap-lines": "direct_trap_lines",
    "modes-threads": "threads",
    "modes-itinerary": "itinerary",
}


@dataclass(frozen=True)
class Example:
    """One row of a per-mode figure: the picture on the right, and what made it.

    Two things can stand on the right — a seat of the recorded gallery, or a released
    wallpaper the page already showed and is keeping. They answer the same three
    questions, and the maker asks nothing else of either.
    """

    #: What a sentence about this row calls it: a seat's alias, or a released
    #: wallpaper's candidate spelled so that it is **not** a release key. `links.py`
    #: reads `<run>|release|<id>` anywhere it appears as a citation of that record, and a
    #: sentence about the tone operator that happened to spell one would send the link
    #: derivation to a line that is not a panel at all.
    name: str
    #: The wallpaper row `renders.wallpaper_spec` reads, at the mode this row is about.
    row: dict
    #: The geometry the candidate behind this row was drawn and measured at.
    regime: str
    #: The right panel's own file, drawn or copied.
    picture: Path
    #: The seat this row stands on, or `None` for a released wallpaper.
    pick: Pick | None
    #: The release key this row stands on, or `None` for a seat.
    release: str | None
    #: What the autolevel operator did to the *right* panel, in the record's own words.
    right_levelling: str
    #: The curve the operator derived for the *left* panel, or `None` where it left it be.
    left_curve: dict | None
    #: The left panel's own file.
    left: Path


def regime_geometry(spelled: str) -> tuple[tuple[int, int], int]:
    """`640x360ss2` as the resolution and sample count it names."""
    found = REGIME.match(str(spelled or ""))
    if not found:
        raise PickError(
            f"{spelled!r} is not a regime this can read — a regime is <width>x<height>ss<n>, "
            "and the left panel's autolevel has to be measured at the one the seat was "
            "drawn at or the curve is not the one production would have derived"
        )
    return (int(found.group(1)), int(found.group(2))), int(found.group(3))


def smooth_row(row: dict) -> dict:
    """One wallpaper row with its mode swapped for `smooth` and nothing else moved.

    The frame, the cap, the curve, the map, the fold and the whole palette pass are the
    seat's. What the figure is about is the one field that changed, so the one field is
    all that changes — a left panel that also re-picked the map would be a picture of two
    differences and an argument for neither.
    """
    return dict(row, mode=SMOOTH, mode_params={})


def smooth_counterpart(
    row: dict, name: str, catalog: dict[str, dict], *, regime: str
) -> tuple[Path, dict | None]:
    """The left panel: this recipe in `smooth`, autolevelled the way production would.

    The operator is a function of the *picture*, not of the recipe, so a mode swap is a
    new picture and the curve has to be derived again rather than borrowed. Production
    derives it from a render at the candidate regime, which is what the band was measured
    against, so that is where this measures it too — and then draws the panel at figure
    size through the stops that curve bakes. `renders.measured_stops` is the wallpaper
    project's own operator acting; nothing about the tone is decided on this side.

    Returns the panel and the curve, or the panel and `None` where the operator's own
    identity case fired, which is the commonest answer.
    """
    plain = smooth_row(row)
    resolution, supersample = regime_geometry(regime)
    measured_on = (
        cache()
        .produce(
            f"{name}-at-regime",
            "render",
            renders.wallpaper_spec(
                plain, resolution=resolution, supersample=supersample, catalog=catalog
            ),
        )
        .path
    )
    acted = renders.measured_stops(plain["colormap"], measured_on)
    spec = renders.wallpaper_spec(
        plain, resolution=PANEL_RENDER, supersample=PANEL_SUPERSAMPLE, catalog=catalog
    )
    if acted:
        spec = dict(
            spec,
            colormap_dir=str(
                renders.colormap_directory(
                    plain["colormap"],
                    acted["kind"],
                    acted["stops"],
                    renders.spec_key(
                        "measured", {"colormap": plain["colormap"], "curve": acted["curve"]}
                    ),
                )
            ),
        )
    return cache().produce(name, "render", spec).path, (acted["curve"] if acted else None)


def released_row(key: str) -> dict:
    """One released wallpaper in the shape `renders.wallpaper_spec` reads.

    A release record spells the same picture a third way: the frame is under `location`,
    the coloring under `recipe`, and the palette pass is the labeling defaults rather than
    a stored object. Only the fold is a per-release choice, and it is the one thing read
    off the row.
    """
    from .locations import release_record

    run, separator, candidate = str(key).partition("|release|")
    if not separator:
        raise PickError(f"{key!r} is not a release key — a release key is <run>|release|<id>")
    row = release_record(run, candidate)
    recipe = row["recipe"]
    return {
        "family": row["location"]["family"],
        "viewport": row["location"]["viewport"],
        "mode": recipe["mode"],
        "mode_params": {},
        "curve": recipe.get("curve", "linear"),
        "colormap": recipe["colormap"],
        "recipe": {
            "gamma": 1.0,
            "cycles": 1.0,
            "phase": 0.0,
            "reverse": False,
            "mirror": bool(recipe.get("mirror")),
            "transfer": {"kind": "value"},
            "rolloff": {"kind": "none"},
        },
        "render": {"maxiter": (recipe.get("render") or {}).get("maxiter")},
        "regime": f"{(recipe.get('render') or {}).get('resolution', [640, 360])[0]}x"
        f"{(recipe.get('render') or {}).get('resolution', [640, 360])[1]}ss"
        f"{(recipe.get('render') or {}).get('supersample', 2)}",
        "_picture": row["_picture"],
        "_key": key,
    }


def pair_examples(identifier: str, catalog: dict[str, dict]) -> list[Example]:
    """The rows of one per-mode figure, resolved and drawn: seats first, then releases."""
    figure = figures_module.load_all().get(identifier)
    if figure is None:
        raise PickError(f"{identifier} is not in the figure registry")
    wanted = picks_of(identifier)
    released = list((figure.recipe.args if figure.recipe else {}).get("released") or [])
    mode = MODE_FIGURES[identifier]

    examples: list[Example] = []
    for index, pick in enumerate(resolve(wanted)):
        if pick.mode != mode:
            raise PickError(
                f"{identifier} is the {mode} figure and {pick.alias} is a {pick.mode} seat — "
                "a per-mode figure shows the mode its caption names, and a re-pick into "
                "another mode is a different figure"
            )
        row = wallpaper_row(pick)
        picture, levelling = panel_or_seat(pick, f"{identifier}-{index + 1}-{pick.alias}", catalog)
        left, curve = smooth_counterpart(
            row,
            f"{identifier}-{index + 1}-{pick.alias}-smooth",
            catalog,
            regime=pick.recipe["regime"],
        )
        examples.append(
            Example(
                name=pick.alias,
                row=row,
                regime=pick.recipe["regime"],
                picture=picture,
                pick=pick,
                release=None,
                right_levelling=levelling.way,
                left_curve=curve,
                left=left,
            )
        )
    for index, key in enumerate(released):
        row = released_row(key)
        if row["mode"] != mode:
            raise PickError(f"{identifier} is the {mode} figure and {key} is a {row['mode']} row")
        left, curve = smooth_counterpart(
            row, f"{identifier}-release-{index + 1}-smooth", catalog, regime=row["regime"]
        )
        examples.append(
            Example(
                name=f"released {key.split('|release|')[1]} of {key.split('|release|')[0]}",
                row=row,
                regime=row["regime"],
                picture=row["_picture"],
                pick=None,
                release=key,
                right_levelling=UNTOUCHED,
                left_curve=curve,
                left=left,
            )
        )
    if len(examples) != PAIR_ROWS:
        raise PickError(
            f"{identifier} is {PAIR_COLUMNS}x{PAIR_ROWS} — two examples, each of them a "
            f"pair — and its row names {len(examples)}"
        )
    return examples


def mode_pair(identifier: str) -> Drawn:
    """One rendering mode against `smooth`, twice: a 2 x 2, one location a row.

    The right panel of a row is the wallpaper — a seat of the recorded gallery, or the one
    released picture this page is keeping — and the left is that same recipe with the mode
    swapped. Nothing else moves between them, which is the whole of what the figure
    claims: this is what the mode did to this location in this palette.
    """
    catalog = renders.mode_catalog()
    examples = pair_examples(identifier, catalog)
    size = panels(PAIR_COLUMNS)
    caption = sheets.caption_band(size[1], SHEET_WIDTH, PAIR_LABEL_LINES)
    sheet, draw = sheets.canvas(*sheets.grid_size(size, PAIR_COLUMNS, PAIR_ROWS, caption))
    for index, example in enumerate(examples):
        for column, (picture, word) in enumerate(
            ((example.left, SMOOTH), (example.picture, example.row["mode"]))
        ):
            origin = sheets.panel_origin(index * PAIR_COLUMNS + column, size, PAIR_COLUMNS, caption)
            sheet.paste(sheets.fitted(picture, size), origin)
            sheets.tile_label(draw, origin, size, word, sheet.width)
    destination = sheets.save(sheet, sheet_path(identifier))
    return Drawn(destination, pair_provenance(identifier, examples, size))


def pair_provenance(identifier: str, examples: list[Example], size: tuple[int, int]) -> list[str]:
    """The registry lines for a per-mode pair figure: the composition, then two per row.

    **The seat's panel comes first inside a pair, and the sheet reads the other way.**
    The order is stated in the composition line rather than left to be inferred, because
    two things read the first panel line: the rule that exactly one line of a row may put
    the word `colormap` in front of a map's name, and `builder/links.py`, which opens the
    figure at the first panel that names a frame. Both want the picture the figure is
    *about* — a `smooth` render carrying a tone curve nothing outside this repository
    recorded is not a picture the explorer can reopen.

    **And where that first panel is not the engine's own render of its recipe, no line
    names a colormap at all**, so the link derivation refuses the figure rather than
    approximating it. A copied seat carries a curve nobody wrote down and a replayed one
    was drawn through stops that are not the map the record names; the explorer has
    neither, so it would open the right place in the wrong colour. A link that is nearly
    the figure is worse than none, and this is what that rule costs when Matt's pick lands
    on a candidate a `depth` run drew.
    """
    stamps = sorted({one.pick.stamp for one in examples if one.pick})
    mode = MODE_FIGURES[identifier]
    lines = [
        f"builder.picks — {PAIR_COLUMNS} x {PAIR_ROWS}: two examples of {mode}, one location "
        f"a row, drawn in that location's own palette. The right panel of a row is the "
        f"wallpaper; the left is a render of that same recipe with the mode swapped for "
        f"{SMOOTH} and nothing else moved — same frame, same cap, same curve, same map, "
        f"same fold, same palette pass. A seat panel is named by its own "
        f"`<stamp>{PICK_SEPARATOR}<recipe key>` and resolved from artifacts/curation/"
        f"tentative/<stamp>/{SEATS_NAME} for the seat and the candidate ledger for the "
        f"recipe. Both panels are rendered through the engine at {PANEL_RENDER[0]}x"
        f"{PANEL_RENDER[1]}, supersample {PANEL_SUPERSAMPLE}, then fitted to "
        f"{size[0]}x{size[1]} in the sheet."
        + (f" Stamp{'s' if len(stamps) > 1 else ''} {', '.join(stamps)}." if stamps else "")
        + " The lines below run one row at a time and put the wallpaper's panel first, "
        "which is the order the record is read in and not the order the sheet is looked "
        "at.",
        pair_autolevel_line(examples),
    ]
    opens = examples[0].right_levelling == UNTOUCHED
    for example in examples:
        lines += pair_lines(example, representative=opens and example is examples[0])
    return lines


def pair_autolevel_line(examples: list[Example]) -> str:
    """What the tone operator did on both sides of every row, in one paragraph.

    Two different questions, deliberately answered together. On the right it is a matter
    of record — the run that drew the candidate either kept its curve or did not, and
    `run_stamp` reads it. On the left there is no record to read, because no run ever made
    that picture: the operator is run here, on a render at the seat's own regime, which is
    the operator acting rather than a second reading of one that already acted.
    """
    ruled = [one for one in examples if _no_autolevel(one)]
    replayed = [one for one in examples if one.right_levelling == REPLAYED]
    copied = [one for one in examples if one.right_levelling == UNRECOVERABLE]
    told = []
    if ruled:
        told.append(
            "The operator has nothing to say about "
            + ", ".join(one.name for one in ruled)
            + ": their recipes carry no autolevel identity at all, which is the operator's "
            "own ruling that this mode's kind is outside it — a direct trap paints over a "
            "flat ground and a modulate reads a different place in the map per sample — so "
            "the right panel is the engine's own render of the recipe."
        )
    plain = [one for one in examples if one not in ruled and one.right_levelling == UNTOUCHED]
    if plain:
        told.append(
            "It was switched on behind "
            + ", ".join(one.name for one in plain)
            + " and left "
            + ("that render" if len(plain) == 1 else "those renders")
            + " alone, so the right panel is the engine's own render of the recipe."
        )
    if replayed:
        told.append(
            "It acted on "
            + ", ".join(one.name for one in replayed)
            + ", and those right panels were drawn through the stops that curve rebuilds — "
            "the wallpaper project's own `stops_from_stamp` replaying its own curve."
        )
    if copied:
        told.append(
            "It also acted on "
            + ", ".join(one.name for one in copied)
            + ", whose run recorded the fact and not the curve; "
            + ("that right panel is" if len(copied) == 1 else "those right panels are")
            + " the seat's own shipped picture rather than a render, and the line for "
            + ("it says so" if len(copied) == 1 else "each says so")
            + "."
        )
    left = []
    for one in examples:
        if one.left_curve is None:
            left.append(f"{one.name} left alone")
        else:
            left.append(
                f"{one.name} acted on, black point {one.left_curve['black_pt']:.4f}, white "
                f"point {one.left_curve['white_pt']:.4f}"
            )
    return (
        "Autolevel: on the right it is what the run recorded. "
        + " ".join(told)
        + " On the left there is nothing to replay, because no run ever drew that picture: "
        "the operator was run here the way production runs it for a field mode — "
        "`renders.measured_stops`, over a render of the swapped recipe at the seat's own "
        "regime — and where it acted the panel is drawn through the stops it baked. Its "
        "readings, in row order: " + "; ".join(left) + "."
    )


def _no_autolevel(example: Example) -> bool:
    """Whether this row's own recipe carries no autolevel identity to begin with."""
    if example.pick is not None:
        return example.pick.recipe.get("autolevel") is None
    return True


def pair_lines(example: Example, *, representative: bool) -> list[str]:
    """One row of a pair figure: the wallpaper's panel, then its `smooth` counterpart."""
    lines = []
    if example.pick is not None:
        lines.append(frame_line(example.pick, representative=representative))
        if example.right_levelling == UNRECOVERABLE:
            lines.append(unrecoverable_line(example.pick, run_stamp(example.pick)))
    else:
        lines.append(released_line(example, representative=representative))
    lines.append(smooth_line(example))
    return lines


def released_line(example: Example, *, representative: bool) -> str:
    """The right panel of a row that is a released wallpaper rather than a seat."""
    row = example.row
    family, viewport = row["family"], row["viewport"]
    kind = family.get("kind")
    named = f"family {kind}"
    if kind in ("multibrot", "julia"):
        named += f", degree {family.get('degree', 2)}"
    for constant in ("c", "p", "z_prev"):
        if family.get(constant):
            named += f", {constant} = {family[constant][0]} + {family[constant][1]}i"
    map_word = "colormap" if representative else "palette"
    return (
        f"{family_name(family)}, {mode_words(row['mode'])}: released wallpaper "
        f"{example.release} — {named}, centre {viewport['center_re']} + "
        f"{viewport['center_im']}i, width {viewport['width']}, mode {row['mode']}, curve "
        f"{row['curve']}, {map_word} {row['colormap']}, mirror {flag(row['recipe']['mirror'])}, "
        f"cap {row['render']['maxiter']}, no crop beyond the sheet's; "
        f"{shade_words(row['recipe'])}. Not re-rendered here: the panel is the released "
        f"picture itself, {example.picture.name} at its release size {_size(example.picture)}, "
        f"fitted into the cell. "
        "It is the one location this page keeps from the figures these replace, and it is "
        "kept because it is the itinerary picture the section was written around."
    )


def _size(picture: Path) -> str:
    """One picture's pixel size, for a line that says a panel was copied rather than drawn."""
    from . import images

    width, height = images.dimensions(picture)
    return f"{width}x{height}"


def smooth_line(example: Example) -> str:
    """The left panel of a row: the same recipe in `smooth`, and what the operator did."""
    row = smooth_row(example.row)
    family, viewport = row["family"], row["viewport"]
    kind = family.get("kind")
    named = f"family {kind}"
    if kind in ("multibrot", "julia"):
        named += f", degree {family.get('degree', 2)}"
    for constant in ("c", "p", "z_prev"):
        if family.get(constant):
            named += f", {constant} = {family[constant][0]} + {family[constant][1]}i"
    if example.left_curve is None:
        levelled = (
            "The autolevel operator was run on this render at the row's own regime "
            f"{example.regime} and returned it untouched, so the panel is the engine's own "
            "render of the swapped recipe."
        )
    else:
        levelled = (
            "The autolevel operator was run on this render at the row's own regime "
            f"{example.regime} and acted — black point {example.left_curve['black_pt']:.4f}, "
            f"white point {example.left_curve['white_pt']:.4f} — so the panel is drawn "
            "through the stops that curve bakes into the map rather than through the map "
            "itself."
        )
    return (
        f"{family_name(family)}, {mode_words(SMOOTH)}: the left panel beside "
        f"{example.name}, the same recipe with mode {SMOOTH} and no mode settings — "
        f"{named}, centre "
        f"{viewport['center_re']} + {viewport['center_im']}i, width {viewport['width']}, "
        f"mode {SMOOTH}, curve {row['curve']}, palette {row['colormap']}, mirror "
        f"{flag(row['recipe'].get('mirror'))}, cap {row['render']['maxiter']}, no crop "
        f"beyond the sheet's; {shade_words(row['recipe'])}. {levelled}"
    )


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


def autolevel_line(picks: list[Pick], levellings: dict[str, Levelling] | None = None) -> str:
    """What the operator did to the pictures Matt picked off, and what a panel here is."""
    stamped = sorted(
        {
            str((pick.recipe.get("autolevel") or {}).get("operator"))
            for pick in picks
            if pick.recipe.get("autolevel")
        }
    )
    switches = sorted(
        {
            str((pick.recipe.get("autolevel") or {}).get("switch"))
            for pick in picks
            if pick.recipe.get("autolevel")
        }
    )
    levellings = levellings or {pick.identifier: run_stamp(pick) for pick in picks}
    replayed = [pick for pick in picks if levellings[pick.identifier].way == REPLAYED]
    copied = [pick for pick in picks if levellings[pick.identifier].way == UNRECOVERABLE]
    where = sorted({levellings[pick.identifier].where for pick in picks})

    told = []
    if replayed:
        told.append(
            "The operator acted on "
            + ", ".join(
                f"{pick.alias} (black point "
                f"{levellings[pick.identifier].stamp['curve']['black_pt']:.4f}, white point "
                f"{levellings[pick.identifier].stamp['curve']['white_pt']:.4f})"
                for pick in replayed
            )
            + ", and those panels were drawn through the stops that curve rebuilds — the "
            "wallpaper project's own `stops_from_stamp` replaying its own curve, never a "
            "second one measured here."
        )
    if copied:
        told.append(
            "It also acted on "
            + ", ".join(pick.alias for pick in copied)
            + ", whose run recorded the fact and not the curve; "
            + ("that panel is" if len(copied) == 1 else "those panels are")
            + " the seat's own shipped picture rather than a render, and the line for "
            + ("it says so" if len(copied) == 1 else "each says so")
            + "."
        )
    if not replayed and not copied:
        told.append(
            "It acted on none of them, which by that operator's rule means it returned each "
            "base render untouched, so every panel here is the engine's own render of the "
            "recipe."
        )
    elif len(replayed) + len(copied) < len(picks):
        told.append("It left the rest exactly alone, and those are the engine's own render.")

    return (
        f"Autolevel: every candidate behind these seats was made with {', '.join(stamped)} "
        f"switched {', '.join(switches)}. A ledger recipe keeps only the reduced stamp of "
        "that — the operator, the switch and the band's sha256 — so the curve is read from "
        f"the run's own record instead, {', '.join(where)}. {' '.join(told)} Held to that: "
        "each pick redrawn at the candidate's own 640x360 supersample 2 reproduces the "
        f"stored picture its seat points at to {RECIPE_AGREEMENT}, and `builder check`'s "
        "`seats` is what keeps it true."
    )


def provenance(
    picks: list[Pick],
    size: tuple[int, int],
    *,
    columns: int = HOOK_COLUMNS,
    chosen: tuple[str, ...] = (),
) -> list[str]:
    """The registry lines for a sheet of picks: the composition, then one line per panel.

    `chosen` is where a figure says how its seats were arrived at, which is the one thing
    the resolution above cannot say for itself — the hook's six are Matt's, and the modes
    roster's thirteen are a seeded random draw.
    """
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
        f"{columns} across.",
        autolevel_line(picks),
        *chosen,
    ]
    lines += [frame_line(pick, representative=index == 0) for index, pick in enumerate(picks)]
    return lines


# ----------------------------------------------------------------------- the interface


def _pair(identifier: str):
    """One per-mode figure's maker, bound to the figure it draws.

    `MAKERS` holds callables of no arguments, so the twelve pair figures each get one
    of these rather than twelve copies of the same function. The name it answers to is
    the real function's, which is what `recipe` writes down and what `check` holds to
    still existing.
    """

    def make() -> Drawn:
        return mode_pair(identifier)

    make.__name__ = mode_pair.__name__
    return make


MAKERS = {
    "overview-gallery-hook": gallery_hook,
    "modes-gallery": modes_gallery,
    "gallery-output": gallery_output,
    "locations-minibrot-examples": minibrot_examples,
    **{identifier: _pair(identifier) for identifier in MODE_FIGURES},
}


def released_of(identifier: str) -> list[str]:
    """The release keys a figure's row names beside its picks, if any."""
    figure = figures_module.load_all().get(identifier)
    if figure is None or figure.recipe is None:
        return []
    return list(figure.recipe.args.get("released") or [])


def sources(identifier: str) -> list[dict]:
    """The registry `sources` for a figure of this module: its picks, as gallery seats.

    A per-mode pair figure says the same keys **twice**, because its panels stand on them
    two different ways: the right panel of a row is the seat drawn at its own recipe, and
    the left is the same seat with the recipe deliberately changed. `check`'s `seats`
    reads the word and holds only the first of those to the picture the gallery ships,
    which is the whole reason `drawn` is a claim on the row rather than a list of excused
    figures inside the check.
    """
    keys = picks_of(identifier)
    if identifier not in MODE_FIGURES:
        return [{"kind": figures_module.GALLERY_SEAT, "keys": keys}]
    found = []
    if keys:
        found += [
            {"kind": figures_module.GALLERY_SEAT, "keys": keys, "drawn": figures_module.OWN_RECIPE},
            {
                "kind": figures_module.GALLERY_SEAT,
                "keys": keys,
                "drawn": figures_module.RECIPE_CHANGED,
            },
        ]
    released = released_of(identifier)
    if released:
        found.append({"kind": figures_module.RUN_ROW, "keys": released})
    return found


def recipe(identifier: str) -> dict:
    """The registry recipe: the maker, and the picks the row already names.

    Read back off the row rather than restated, because the row is where a pick is
    edited — a constant here would be a second list to keep in step with the first.
    """
    if identifier not in MAKERS:
        raise records.RecordError(f"{identifier} is not drawn by {__name__}")
    args: dict = {"picks": picks_of(identifier)}
    released = released_of(identifier) if identifier in MODE_FIGURES else []
    if released:
        args["released"] = released
    return {"maker": f"{__name__}:{MAKERS[identifier].__name__}", "args": args}


def draw(identifier: str) -> Drawn:
    if identifier not in MAKERS:
        raise records.RecordError(f"{identifier} is not drawn by {__name__}")
    return MAKERS[identifier]()
