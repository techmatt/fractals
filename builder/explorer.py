"""What the explorer page is built from: its palettes, its wasm module, its manifest.

The explorer is a page that runs code, which is new here, and the rule the rest of the
site is held to still holds: **the builder generates; it never becomes the site.**
`engine.wasm`, `palettes.js` and `engine.manifest.json` are committed artifacts. A clone
with no wallpaper project beside it serves the explorer exactly as this one does; only
*regenerating* those three files needs the sibling checkout and a Rust toolchain.

Five things are baked, and each for its own reason:

- **The palettes** — every colormap the library holds, as a small ES module indexing a
  binary blob. Names are the ids a permalink carries, so they are baked as names and
  never as indices: a colormap added to the wallpaper project must not silently
  renumber somebody's link.
- **The blob** — `palettes.bin`, the control points of all of them, sRGB8, three bytes
  a stop, in the index's own order. See *The blob, and what is not in it* below.
- **The catalog** — the modes the picker offers with the line that says what each one
  is for, and the family constants a dynamical plane needs. What each mode *is* is a fact
  the wallpaper project owns, and so are the constants: the identity lines come out of
  `fractal-engine modes` and the constants out of the shipped anchors, so neither is
  typed here. **Which** modes are offered is this repository's own record — see below.
  What the *permalink* will accept is still `permalink.js`'s own business — a contract
  that read its vocabulary from a generated file could be widened by rebuilding it.
- **The wasm** — `explorer/engine-wasm/` compiled for `wasm32-unknown-unknown` and
  copied in. The crate depends on the engine by path, so the module is the engine's own
  arithmetic and not a second implementation of it.
- **The manifest** — which commit of the wallpaper project the module was built from,
  and with what. `builder check` reads it back and says so when the module is older than
  the engine beside it.

Which colormaps count as curated is the wallpaper project's own distinction, written into
every map it holds: a map that arrived by mechanical conversion — brought across only
because a labeled corpus names it — says so in its `source` line, and the rest were
chosen. `CONVERTED_MARKER` is the tail of that sentence.

**The baked set is wider than the offered one**, and the difference is what a link may
say against what a picker may choose *(Matt, 2026-08-21)*. Every curated map is offered.
Baked alongside them, and not offered, is every map one of this site's own pictures was
drawn in — most of them converted, because that is what the corpora the article draws
from were colored through. A map the article publishes a picture in has to be nameable,
or the explorer cannot open that picture at all; it does not have to be on the menu, and
putting it there would widen a curated set this repository does not own. So `offered`
travels with each baked map, the picker reads it, and a link arriving on an unoffered map
draws it and shows it in the picker for as long as it is in force.

**Which maps those are is a committed record here, not a question asked next door**
*(2026-08-25)*. It used to be derived: every map whose `source` line did not say it was
converted, plus every map a figure names. That derivation read "everything curated", and
when the wallpaper project admitted two hundred authored maps in one drop the picker
silently went from 77 entries to 277 — a bake nobody ran deliberately changing what a
reader is offered. `explorer/palettes.jsonl` is the roster instead: one row per map the
explorer carries, saying whether the picker lists it. The bake reads the names from that
record and the gradients from the library next door, so growing the picker is an edit
somebody made on purpose and a rebake on an unchanged tree reproduces the committed
module byte for byte — which `builder check` asserts.

## The blob, and what is not in it

The module used to carry every map's stops inline and carried 126 maps. It carries
**1,021** now — the whole library — because a link built from a gallery seat's recipe
has to be able to name the map that seat was drawn in, and 451 distinct maps are seated
in the published record alone. Inline, that is about twelve megabytes of JavaScript
source; as three bytes a stop it is about one megabyte of binary that the page fetches
once beside the wasm.

**The positions are not in it, and the bake refuses a map that would need them.** Every
map the library holds spaces its stops evenly — position `i` is exactly `i/(n-1)`, on all
1,021, checked — so the blob carries colour alone and the index carries the count. That
is not an assumption the format makes quietly: `blob` compares each stop's own position
with `i/(n-1)` as an exact `f64` and **stops the bake by name** where one differs, because
rounding a map's positions would bend its gradient slightly rather than fail, and the
engine does not require even spacing even though this library happens to have it.

**Stored planar and byte-delta, so that gzip can see it** *(explorer_slim_ckpt131)*. A
map's stops are written as its reds, then its greens, then its blues, each channel as the
difference from the stop before it, mod 256, starting from zero at the map's first stop.
It is the same number of bytes as `r g b r g b` and occupies the same span, so the index's
`at` and `stops` address a map exactly as before; what changes is that a gradient's
neighbouring stops are close, so its deltas are small and repeat. Pages gzips the file on
the way out, and it goes from 897 KB on the wire interleaved to 185 KB. `stops.js` undoes
it once, on arrival, into the interleaved bytes it always read, and the index names the
`layout` so a reader of one can tell which it is holding.

**Two fields ride in the index that the library does not hold**, `family` and `seats`,
and both are frozen into the roster record rather than derived at bake time. `family` is
the hue family a map most often *produces* — the modal `colour.families[0]` over the
candidate-ledger rows drawn in it whose fine-head reading clears `solve.DEFAULT_FINE_BAR`
— and `seats` is how many seats of the published record named it. Neither is a fact about
the gradient; both are readings of a pool that is being written to while this runs. A bake
that went out to the ledger would answer differently on two days of one tree, which is
what the roster record exists to prevent — the picker's 77 went the same way once. So
`python -m builder explorer --roster` is what reads them, deliberately, and the method row
records the release and the ledger row count it read them at.

**The mode roster is a committed record for the same reason** *(2026-09-01)*. It used to
be derived — every mode the engine catalog called `production` — and the engine promoted
`tail_itinerary`, so the next bake would have put a nineteenth entry in the picker and a
nineteenth name in the contract without anybody deciding to. `explorer/modes.jsonl` names
the seventeen the picker offers, in the order it shows them; the bake takes each mode's
identity line and its curve from the catalog next door and offers nothing the record does
not name. There are three copies of that list and all three are held together: the record
is held to the module by `builder check`'s bake, and the module to `permalink.js`'s typed
`MODES` by `permalink.test.mjs`.
"""

from __future__ import annotations

import contextlib
import csv
import gzip
import hashlib
import json
import re
import shutil
import subprocess
from dataclasses import dataclass
from datetime import date
from pathlib import Path

from . import figures, records, renders
from .paths import SITE_ROOT
from .renders import EngineError, wallpapers_root

#: Where the explorer's committed artifacts live.
EXPLORER_DIR = SITE_ROOT / "explorer"
PALETTES_MODULE = EXPLORER_DIR / "palettes.js"
#: The control points themselves. Untracked: a megabyte of binary is the one thing here
#: that is library-sized, and what is committed is the index that addresses it.
PALETTES_BLOB = EXPLORER_DIR / "palettes.bin"
#: How the blob lays a map's colours out; `stops.js` refuses an index naming another.
BLOB_LAYOUT = "planar-delta"
#: One row of gradient per map, in index order — a picture of what the blob holds, for a
#: person rather than for the page. Untracked, and nothing serves it.
PALETTES_SWATCH = EXPLORER_DIR / "palettes-swatch.png"
CATALOG_MODULE = EXPLORER_DIR / "catalog.js"
WASM_MODULE = EXPLORER_DIR / "engine.wasm"
MANIFEST = EXPLORER_DIR / "engine.manifest.json"
CRATE_DIR = EXPLORER_DIR / "engine-wasm"

#: The wallpaper project's shipped anchors, relative to its checkout root. Three rows,
#: one per family that has constants to remember — a known-good quadratic Julia `c` and
#: Ushiki's Phoenix pair — and they are what the explorer opens a dynamical plane at.
ANCHOR_SOURCE = "data/anchors.jsonl"

#: Which permalink family names take their constants from which anchor row. The Julia
#: degrees share the degree-2 anchor's `c`: the tracked pool is degree 2, and that `c`
#: is a fine picture at any degree — it is a starting point rather than a claim about
#: the higher-degree planes.
CONSTANT_FAMILIES = {
    "julia": "julia",
    "julia3": "julia",
    "julia4": "julia",
    "julia5": "julia",
    "julia6": "julia",
    "phoenix": "phoenix",
}

#: The wallpaper project's colormap directory, relative to its checkout root. Recorded
#: in the provenance stamp, so a reader can go and look at what was baked.
COLORMAP_SOURCE = "data/palettes"

#: The maps a Random palette press may draw from, as that project states them:
#: `palette name,count` for every colormap that seated more than one wallpaper in the
#: published n=1000 record. Its own `README.md` documents the join it came out of and
#: says out loud that it is a reading of one record rather than a standing rule, which is
#: why the list is imported and frozen here instead of being re-derived at a threshold
#: this repository would have to hold an opinion about.
RANDOM_SOURCE = ("data", "palettes", "palettes_for_random_choice.csv")
RANDOM_NAME_COLUMN = "palette name"
RANDOM_COUNT_COLUMN = "count"

#: The roster the bake reads: one row per map the explorer carries, beside the module it
#: is baked into, the way `gallery.jsonl` sits beside the gallery page it writes. Its
#: first row is the method row, carrying the two facts the provenance stamp cannot
#: recompute — when the roster was fixed, and against which commit of the library.
PICKS_RECORD = EXPLORER_DIR / "palettes.jsonl"
PICKS_METHOD = "method"
PICKS_ROW = "palette"

#: The same shape for the modes, and for the same reason: one row per mode the picker
#: offers, in the order it shows them, beside the module the bake writes. Presence is the
#: offer — there is no unoffered half here, because a mode outside the roster is a mode no
#: link and no figure of this site names.
MODES_RECORD = EXPLORER_DIR / "modes.jsonl"
MODES_ROW = "mode"

#: The tail of the sentence a mechanically-converted map carries in its `source` line.
#: See `src/fractal_wallpapers/palettes/library_import.py` over there. Nothing bakes off
#: this any more — the roster does — and it is kept because it is still the sentence that
#: says which maps a *widening* of the roster would be reaching for.
CONVERTED_MARKER = "not because it was curated"

#: The word a provenance line puts in front of a colormap's name.
COLORMAP_WORD = "colormap "

#: How wide the swatch is drawn. A swatch is not the shading table — the engine bakes
#: that at 4,096 — so this is only wide enough to look at, and each column is a stop of
#: the blob taken whole rather than a colour interpolated between two. What it shows is
#: what is in the file.
SWATCH_WIDTH = 1024

#: The candidate ledger's rows and the fine head's reading of the pool, relative to the
#: wallpaper project's artifacts tree and to its checkout. `--roster` reads both, and
#: nothing else here does.
LEDGER_ROWS = ("curation", "candidate_ledger", "rows.jsonl")
FINE_SCORES = ("gallery_grade_head", "pool_scores.jsonl")

#: Where a published tentative gallery keeps its seats' recipes, under the artifacts
#: tree. `gallery.jsonl` names no colormap at all — the recipe beside it does.
TENTATIVE = ("curation", "tentative")
RECIPES_NAME = "recipes.jsonl"

#: The bar a candidate's fine-head `p_ge4` clears to count toward a map's `family`.
#: `curation.solve.DEFAULT_FINE_BAR`, transcribed: reading it would mean importing the
#: wallpaper project's Python into this builder, which nothing here does.
FINE_BAR = 0.030242

#: The wasm target and the file cargo leaves the module at.
WASM_TARGET = "wasm32-unknown-unknown"
WASM_ARTIFACT = ("target", WASM_TARGET, "release", "explorer_engine_wasm.wasm")

#: The manifest's schema, in the same spirit as every JSONL record here.
SCHEMA = 1

#: Every change this consumer has needed in the sibling engine, one line each. CLAUDE.md
#: allows a website prompt a zero-behaviour engine change — visibility, inlining, `cfg` —
#: only on condition that it is named here, because a committed module nobody can rebuild
#: from the sibling checkout is a dead end. Typed rather than derived: nothing in the
#: sibling repository marks a commit as one of these, and a list that guessed would be
#: worse than no list. A change lands here in the same commit that bakes it in.
ENGINE_CHANGES = [
    "coloring::composite, coloring::modulate and direct_trap::Painter::trace are pub: "
    "visibility only, no signature moved, engine tests unmoved.",
    "iterate::run is #[inline(always)]: the specialization cascade this crate depended on "
    "for its own call sites, and now depends on through the engine's table.",
    "field::sweep_row and field::Channels are pub: the engine's own table of specialized "
    "call sites, twelve channel sets over nine families, which compute_lanes now calls "
    "instead of keeping a hand-written copy of nine of them. Visibility only, no signature "
    "moved, engine tests unmoved.",
    "colormap::srgb_to_linear, linear_to_srgb, linear_srgb_to_oklab and oklab_to_linear_srgb "
    "were ALREADY pub, and are named here because the autolevel port leans on them: "
    "`level.rs` replays band_autolevel/v1 on a map's stops through the engine's own copy of "
    "Ottosson's matrices rather than a third one. Nothing was changed next door for it.",
    "screen::Battery, its Default, Battery::screen and Screening were ALREADY pub, and are "
    "named here because the Walk tab's `screen` export leans on them: it runs the "
    "pipeline's own gate battery rather than a JavaScript copy of its rule. Nothing was "
    "changed next door for it.",
]

_RUSTC_VERSION = re.compile(r"^rustc (\S+ \([0-9a-f]+ \d{4}-\d{2}-\d{2}\))")


class ExplorerError(RuntimeError):
    """A bake cannot proceed, and guessing would be worse than stopping."""


# ------------------------------------------------------------------------- the palettes


@dataclass(frozen=True)
class Colormap:
    """One baked map: the name a link carries, and the gradient it names.

    `offered` is whether the picker lists it. A curated map is offered; a map baked
    only because one of this site's pictures was drawn in it is not — see the note at
    the top on why the two sets differ.

    `random` is whether a Random palette press may land on it: the list the wallpaper
    project states in [`RANDOM_SOURCE`], imported by `--random` and frozen here like
    every other roster field. It is neither `offered` nor derivable from `seats` by
    anything this repository should be deciding — see [`mark_random`].

    `family` and `seats` are the two readings the roster carries and the library does
    not: the hue family this map most often produces, and how many seats of the
    published record were drawn in it. Both come off the record rather than off the
    gradient — see *The blob, and what is not in it*.
    """

    name: str
    cyclic: bool
    stops: tuple[tuple[float, tuple[int, int, int]], ...]
    offered: bool
    random: bool = False
    family: str | None = None
    seats: int = 0

    @property
    def even(self) -> bool:
        """Whether stop `i` sits at exactly `i/(n-1)`, which is what the blob assumes."""
        last = len(self.stops) - 1
        return last > 0 and all(at == index / last for index, (at, _) in enumerate(self.stops))


@dataclass(frozen=True)
class Entry:
    """One row of the roster: what the record says about a map before its gradient."""

    name: str
    offered: bool
    random: bool
    family: str | None
    seats: int


def random_choice() -> dict[str, int] | None:
    """The maps a Random palette press may draw from, as `{name: count}`.

    Read from [`RANDOM_SOURCE`] in the checkout next door. `None` where there is no such
    file: the list is that project's to state, and a checkout that does not state it is
    not a reason for anything here to stop — the page falls back to the whole library,
    which is what Random palette did before this list existed.

    A name may carry a comma — `Gold Field, Blood Spark` is a map — so the file is read
    with the csv module and never split on the character.
    """
    path = wallpapers_root().joinpath(*RANDOM_SOURCE)
    if not path.is_file():
        return None
    # `utf-8-sig`: the file is written next door and a BOM is not part of a palette's name.
    with path.open(encoding="utf-8-sig", newline="") as handle:
        rows = list(csv.DictReader(handle))
    if not rows or RANDOM_NAME_COLUMN not in rows[0]:
        raise ExplorerError(f"{path} has no {RANDOM_NAME_COLUMN!r} column")
    found: dict[str, int] = {}
    for row in rows:
        name = (row.get(RANDOM_NAME_COLUMN) or "").strip()
        if not name:
            continue
        try:
            count = int(row[RANDOM_COUNT_COLUMN])
        except (KeyError, TypeError, ValueError) as error:
            raise ExplorerError(f"{path}: {name} has no whole {RANDOM_COUNT_COLUMN}") from error
        found[name] = count
    if not found:
        raise ExplorerError(f"{path} names no palette")
    return found


def roster() -> tuple[dict, tuple[Entry, ...]]:
    """The committed roster: its method row, and one [`Entry`] per map.

    Read in file order, which is name order, which is what the picker shows — the same
    `sorted` order the bake used to produce, kept as the record's own so that a rebake
    and a hand edit cannot disagree about it.
    """
    rows = records.read(PICKS_RECORD)
    head, rest = rows[0], rows[1:]
    head.expect_kind(PICKS_METHOD)
    found = []
    for record in rest:
        record.expect_kind(PICKS_ROW)
        seats = record.fields.get("seats", 0)
        if not isinstance(seats, int) or isinstance(seats, bool) or seats < 0:
            raise ExplorerError(f"{record.where}: seats must be a whole number, not {seats!r}")
        # Absent is false, the way an absent `seats` is nought: a roster written before the
        # random list arrived still reads, and reads as a page that draws from everything.
        chosen = record.fields.get("random", False)
        if not isinstance(chosen, bool):
            raise ExplorerError(f"{record.where}: random must be true or false, not {chosen!r}")
        found.append(
            Entry(
                record.text("name"),
                record.flag("offered"),
                chosen,
                record.optional_text("family"),
                seats,
            )
        )
    if not found:
        raise ExplorerError(f"{PICKS_RECORD.name} names no palette")
    if not any(entry.offered for entry in found):
        raise ExplorerError(f"{PICKS_RECORD.name} offers nothing, so the picker would be empty")
    names = [entry.name for entry in found]
    if names != sorted(names):
        raise ExplorerError(f"{PICKS_RECORD.name} is not in name order, and the picker shows it")
    if len(set(names)) != len(names):
        raise ExplorerError(f"{PICKS_RECORD.name} names a map twice, and a name is an address")
    return head.fields, tuple(found)


def baked() -> list[Colormap]:
    """Every colormap the explorer carries, in the roster's order: its gradient, read
    from the library next door, under the name and the `offered` flag the record fixes.

    Name order is `sorted`'s — codepoint, so the capitalized matplotlib names lead. The
    order is what the picker shows and what "first by name" means where the default has
    to fall back to it, so it is one rule and not two.

    A name the record holds and the library no longer does is an **error**, not a map
    quietly dropped: it is either a rename next door or a deletion, and both are things
    somebody has to look at before a link that used to resolve stops resolving.
    """
    directory = wallpapers_root() / COLORMAP_SOURCE
    if not directory.is_dir():
        raise ExplorerError(f"no colormaps at {directory}")
    held = {}
    for path in sorted(directory.glob("*.json")):
        loaded = json.loads(path.read_text(encoding="utf-8"))
        held[loaded["name"]] = loaded

    found = []
    for entry in roster()[1]:
        loaded = held.get(entry.name)
        if loaded is None:
            raise ExplorerError(
                f"{PICKS_RECORD.name} names {entry.name!r}, and {COLORMAP_SOURCE} holds no such map"
            )
        stops = tuple((float(at), tuple(int(c) for c in rgb)) for at, rgb in loaded["stops"])
        found.append(
            Colormap(
                entry.name,
                loaded["kind"] == "cyclic",
                stops,
                entry.offered,
                entry.random,
                entry.family,
                entry.seats,
            )
        )
    return found


def library_names() -> list[str]:
    """Every map the library next door holds, by name, in the order a roster wants."""
    directory = wallpapers_root() / COLORMAP_SOURCE
    if not directory.is_dir():
        raise ExplorerError(f"no colormaps at {directory}")
    return sorted(path.stem for path in directory.glob("*.json"))


def drawn_in(held: set[str]) -> set[str]:
    """Every colormap this site's own pictures name in their provenance.

    Read off the figure registry, which is where the answer survives: the scripts that
    drew the figures live in ignored `scratch/`.

    **A name is matched against the maps the project holds, longest first**, rather than
    read off as whatever follows the word. Map names carry spaces and dots — `Ice Walk`,
    `Ember Against Steel`, `cmr.voltage` — so there is no punctuation rule that ends one
    reliably, and `colormap Ice Walk over the leveled range` proves it: a rule that read
    to the comma invented a map nobody has. Matching against the roster cannot.
    """
    ordered = sorted(held, key=len, reverse=True)
    named = set()
    for figure in figures.load_all().values():
        for line in figure.provenance:
            for at in _occurrences(line, COLORMAP_WORD):
                tail = line[at + len(COLORMAP_WORD) :]
                match = next((name for name in ordered if tail.startswith(name)), None)
                if match is not None:
                    named.add(match)
    return named


def _occurrences(line: str, word: str) -> list[int]:
    """Where a word starts, every time it appears."""
    found, at = [], line.find(word)
    while at != -1:
        found.append(at)
        at = line.find(word, at + 1)
    return found


def blob(maps: list[Colormap]) -> bytes:
    """Every map's control points, sRGB8, three bytes a stop, in the index's order.

    **No header and no positions.** The index in `palettes.js` says where each map
    starts and how many stops it has, which is the whole of the addressing; a header
    would be a second copy of the count. The positions are not written because stop `i`
    of every map in this library sits at exactly `i/(n-1)` — and a map where that is not
    true stops the bake here rather than being rounded into the format, because rounding
    a gradient's positions bends it slightly instead of failing.

    **Per map, planar and byte-delta** — `BLOB_LAYOUT`: the map's reds, greens and blues
    in turn, each byte the difference from the one before it in that channel, mod 256.
    """
    out = bytearray()
    for colormap in maps:
        if not colormap.even:
            raise ExplorerError(
                f"{colormap.name} does not space its {len(colormap.stops)} stops evenly, and "
                f"{PALETTES_BLOB.name} carries colour alone — its positions are derived as "
                "i/(n-1). Carrying this map means widening the format to write positions "
                "beside the colours, which is a deliberate change and not a rounding."
            )
        for channel in range(3):
            before = 0
            for _at, rgb in colormap.stops:
                out.append((rgb[channel] - before) & 0xFF)
                before = rgb[channel]
    return bytes(out)


def swatch(maps: list[Colormap]) -> bytes:
    """One row of gradient per map, in index order, as a PNG.

    A picture of the blob, for a person: it is how a reader of a report sees that 1,021
    maps went in and that they are the maps they should be. It is **not** the shading
    table — the engine bakes that at 4,096 entries by interpolating in Oklab — so nothing
    is interpolated here. Each column is one of the map's own stops, taken whole, which
    is the honest thing for a picture of a file to show.
    """
    from PIL import Image

    rows = bytearray()
    for colormap in maps:
        last = len(colormap.stops) - 1
        for column in range(SWATCH_WIDTH):
            at = round(column * last / (SWATCH_WIDTH - 1))
            rows.extend(colormap.stops[at][1])
    image = Image.frombytes("RGB", (SWATCH_WIDTH, len(maps)), bytes(rows))
    from io import BytesIO

    buffer = BytesIO()
    image.save(buffer, format="PNG", optimize=True)
    return buffer.getvalue()


def default_palette(names: list[str]) -> tuple[str, str]:
    """Which map the explorer opens on, and the sentence that says why.

    The rule is the article's: whatever its own mandelbrot `smooth` figures are colored
    through, when the curated set holds exactly one such map. Figures drawn in a map
    nobody may choose — a released wallpaper's own colormap, a palette figure's
    deliberate pair — cannot be the default, because the picker does not offer them.
    Where that leaves no single answer the fallback is the first name, and the caller
    prints the reason either way rather than leaving it to be re-derived.
    """
    offered = set(names)
    used = sorted({name for name in _article_smooth_colormaps() if name in offered})
    if len(used) == 1:
        return used[0], f"the article's mandelbrot smooth figures are colored through {used[0]}"
    listed = ", ".join(used) if used else "none of them"
    return names[0], (
        f"the article's mandelbrot smooth figures use {listed} of the curated set, "
        f"so the fallback applies: the first curated name"
    )


def _article_smooth_colormaps() -> list[str]:
    """Every colormap a mandelbrot `smooth` panel of this article was drawn through.

    Read off the figure registry's provenance, which is the only place the answer
    survives: the scripts that drew the figures live in ignored `scratch/`.

    **The family is the one the line names first**, `figures._FAMILY`'s reading and not
    the word `mandelbrot` appearing anywhere in the line. A gallery seat's provenance
    writes its partition out, and `julia:mandelbrot` is a Julia set of the mandelbrot
    parameter plane rather than a mandelbrot — so the looser test read one as the other,
    and a re-picked roster panel that happened to be a curated map away from the rule's
    single answer moved the explorer's default with it.
    """
    named = []
    for figure in figures.load_all().values():
        for line in figure.provenance:
            family = figures._FAMILY.search(line)
            if not family or family.group(1).lower() != "mandelbrot":
                continue
            if "mode smooth" not in line.lower():
                continue
            found = re.search(r"colormap ([^,]+)", line)
            if found:
                named.append(found.group(1).strip())
    return named


@dataclass(frozen=True)
class Baked:
    """What one bake of the palettes produced, for the caller that has to report it."""

    text: str
    blob: bytes
    count: int
    offered: int
    random: int
    chosen: str
    families: int


def palettes_module_text() -> Baked:
    """The text of `palettes.js` and the bytes of `palettes.bin`, as one answer.

    Split out from writing them so that `check` can bake into memory and compare, which
    is the whole reason the stamp below is read off the roster rather than off the clock:
    `baked` and `wallpapers_commit` say when the roster was fixed and against which
    commit of the library, so two bakes of one tree are the same bytes. A gradient that
    moved next door is then a failing check rather than a diff nobody looks at.

    **The module is an index and the gradients are beside it.** `at` is the byte the
    map's colours start at in `palettes.bin` and `stops` is how many there are; position
    `i` is `i/(stops-1)`, which is what every map in the library spaces its stops at and
    what `blob` refuses to write around. A page reads the blob once, beside the wasm.
    """
    stated, _entries = roster()
    maps = baked()
    names = [colormap.name for colormap in maps if colormap.offered]
    chosen, why = default_palette(names)
    bytes_ = blob(maps)
    stamp = {
        "source": str(stated["source"]),
        "wallpapers_commit": str(stated["wallpapers_commit"]),
        "baked": str(stated["baked"]),
        "count": len(maps),
        "offered": len(names),
        "random": sum(1 for colormap in maps if colormap.random),
        "default_because": why,
        "blob": {
            "file": PALETTES_BLOB.name,
            "layout": BLOB_LAYOUT,
            "bytes": len(bytes_),
            "sha256": hashlib.sha256(bytes_).hexdigest(),
            "stops": sum(len(colormap.stops) for colormap in maps),
        },
        "readings": {
            "release": str(stated["release"]),
            "ledger_rows": int(stated["ledger_rows"]),
            "fine_bar": FINE_BAR,
        },
    }

    lines = [
        "// The colormaps the explorer carries: the index, beside the blob that holds",
        "// their control points. Baked from the wallpaper project's library.",
        "//",
        "// Generated by `python -m builder explorer` — edit that, not this. A map is",
        "// addressed by NAME everywhere, in this file and in a permalink, because a name",
        "// is stable and a position in a list is not: a colormap added next year must not",
        "// silently repaint a link somebody saved this year.",
        "//",
        "// `offered` is whether the picker lists it. Every map the library holds is baked,",
        "// because a link built from a gallery seat's recipe has to be able to name the map",
        "// that seat was drawn in; the picker lists a frozen subset of them.",
        "//",
        "// `random` is whether Random palette may land on it: the maps that seated more than",
        "// one wallpaper in the published record, as the wallpaper project's own",
        "// `data/palettes/palettes_for_random_choice.csv` states them. Every map is still",
        "// selectable by hand — this narrows one button and nothing else.",
        "//",
        "// `at` is where this map's colours start in the blob and `stops` is how many there",
        "// are, three sRGB8 bytes each. Position `i` is `i/(stops-1)` — every map in this",
        "// library spaces its stops evenly, and the bake refuses one that does not rather",
        "// than rounding it.",
        "//",
        "// `family` is the hue family this map most often produces, read off the candidate",
        "// ledger; `seats` is how many seats of the published record were drawn in it.",
        "// Neither is a fact about the gradient — both are frozen in `palettes.jsonl`.",
        "",
        f"export const PROVENANCE = {json.dumps(stamp, indent=2, sort_keys=True)};",
        "",
        f"export const DEFAULT_PALETTE = {json.dumps(chosen)};",
        "",
        "export const PALETTES = new Map([",
    ]
    at = 0
    for colormap in maps:
        row = {
            "cyclic": colormap.cyclic,
            "offered": colormap.offered,
            "random": colormap.random,
            "at": at,
            "stops": len(colormap.stops),
            "family": colormap.family,
            "seats": colormap.seats,
        }
        lines.append(f"  [{json.dumps(colormap.name)}, {json.dumps(row, sort_keys=True)}],")
        at += 3 * len(colormap.stops)
    lines.append("]);")
    lines.append("")
    return Baked(
        "\n".join(lines),
        bytes_,
        len(maps),
        len(names),
        sum(1 for colormap in maps if colormap.random),
        chosen,
        sum(1 for colormap in maps if colormap.family),
    )


def write_palettes() -> Baked:
    """Bake the index into `palettes.js` and the control points into `palettes.bin`.

    The swatch goes down beside them, which is neither committed nor served and is only
    how a person looks at a megabyte of binary.
    """
    made = palettes_module_text()
    PALETTES_MODULE.write_text(made.text, encoding="utf-8", newline="\n")
    PALETTES_BLOB.write_bytes(made.blob)
    # Pillow is the one thing here a machine may not have, and the swatch is the one
    # output nothing reads — so its absence is a missing picture and never a failed bake.
    with contextlib.suppress(ImportError):
        PALETTES_SWATCH.write_bytes(swatch(baked()))
    return made


# ---------------------------------------------------------------------------- the roster


def _above_the_bar() -> set[str]:
    """Every candidate key the fine-tier head reads at or above [`FINE_BAR`].

    `models/gallery_grade`'s own pool scores, which is the column `solve.at_fine_bar`
    reads and the column `DEFAULT_FINE_BAR` was derived against. The render judge's
    column in the ledger's own `scores.jsonl` is a different head on a different scale
    and is not this bar's.
    """
    path = renders.artifact(*FINE_SCORES)
    if not path.is_file():
        raise ExplorerError(f"no fine-head pool scores at {path}, so no map has a hue family")
    found = set()
    with path.open(encoding="utf-8") as handle:
        for line in handle:
            if not line.strip():
                continue
            row = json.loads(line)
            if float(row["p_ge4"]) >= FINE_BAR:
                found.add(str(row["key"]))
    return found


def _families_and_rows(wanted: set[str]) -> tuple[dict[str, str], int]:
    """`({map: the hue family it most often produces}, how many ledger rows were read)`.

    One streamed pass. The ledger is a couple of gigabytes across its files and a solve
    may be appending to it while this runs, so this reads the file a line at a time and
    never loads the pool — `picks.ledger_rows`' discipline, for its reason. A key is
    lifted out of the raw line before anything is parsed, because 97% of the rows are
    not wanted and `json.loads` on all of them is most of the clock.

    A torn last line is skipped, exactly as `picks.ledger_rows` skips one: a run next
    door appends while this reads, and a half-written row is not a reading.
    """
    counts: dict[str, dict[str, int]] = {}
    read = 0
    path = renders.artifact(*LEDGER_ROWS)
    if not path.is_file():
        raise ExplorerError(f"no candidate ledger at {path}, so no map has a hue family")
    marker = '"key": "'
    with path.open(encoding="utf-8") as handle:
        for line in handle:
            if not line.strip():
                continue
            read += 1
            at = line.find(marker)
            if at == -1:
                continue
            end = line.find('"', at + len(marker))
            if end == -1 or line[at + len(marker) : end] not in wanted:
                continue
            try:
                row = json.loads(line)
            except json.JSONDecodeError:
                continue
            families = (row.get("colour") or {}).get("families") or []
            colormap = (row.get("recipe") or {}).get("colormap")
            if not families or not colormap:
                continue
            tally = counts.setdefault(str(colormap), {})
            leading = str(families[0])
            tally[leading] = tally.get(leading, 0) + 1
    # Ties by name, so the answer is a function of the pool and not of insertion order.
    return (
        {
            name: max(sorted(tally), key=lambda family: (tally[family], family))
            for name, tally in counts.items()
        },
        read,
    )


def _seats_per_map(stamp: str) -> dict[str, int]:
    """How many seats of one published record were drawn in each map.

    Read off that record's own `recipes.jsonl` and never off the ledger: a published
    record was made redrawable on purpose and carries every seat's recipe beside its
    seats, so the colormap is one file away. `gallery.jsonl` names no map at all.
    """
    path = renders.artifact(*TENTATIVE, stamp, RECIPES_NAME)
    if not path.is_file():
        raise ExplorerError(f"no recipes beside the published record at {path}")
    counts: dict[str, int] = {}
    with path.open(encoding="utf-8") as handle:
        for line in handle:
            if not line.strip():
                continue
            name = (json.loads(line).get("recipe") or {}).get("colormap")
            if name:
                counts[str(name)] = counts.get(str(name), 0) + 1
    if not counts:
        raise ExplorerError(f"{path} names no colormap, so no map has a seat count")
    return counts


def _roster_row(name: str, entry: Entry | None, seats: int, family: str | None) -> dict:
    """One row of the roster, in the order every row is written in.

    Both writers go through here — `--roster`, which re-reads the two pool readings, and
    `--random`, which re-reads one list — so a row written by either has the same shape
    and a diff shows what actually moved.
    """
    row = {
        "schema": records.SCHEMA,
        "kind": PICKS_ROW,
        "name": name,
        "offered": bool(entry.offered) if entry else False,
        "random": bool(entry.random) if entry else False,
        "seats": seats,
    }
    if family:
        row["family"] = family
    return row


#: What the method row says about `random`, written by [`mark_random`] beside the flags.
RANDOM_METHOD = (
    "`random` is whether a Random palette press may land on a map. It is the list the "
    "wallpaper project states in `data/palettes/palettes_for_random_choice.csv` — every "
    "colormap that seated more than one wallpaper in the published record — imported by "
    "`python -m builder explorer --random` and frozen here like every other field. It is "
    "not derived: that file's own README says it is a reading of one record rather than a "
    "standing rule, and the threshold it was filtered at is that project's to move. The "
    "page narrows one button by it and nothing else — every map the roster carries is "
    "still selectable by hand, and still resolves in a link."
)


def mark_random(listed: dict[str, int] | None = None) -> tuple[Path, int, int, tuple[str, ...]]:
    """Rewrite each roster row's `random` flag from the list next door.

    `(the record, how many names the list holds, how many were marked, the names skipped)`.
    A listed name the roster does not carry is **skipped and reported**, not an error: the
    list is a reading of a published gallery and this roster is the library, so a map that
    has left the library since is a name this page cannot draw and has nothing to mark.

    Nothing else in the record moves — not the two pool readings, not `offered`, not the
    method row's own prose — because this is one list being re-read and not a re-reading
    of the roster.
    """
    read = random_choice() if listed is None else listed
    if read is None:
        raise ExplorerError(
            f"no list at {wallpapers_root().joinpath(*RANDOM_SOURCE)}, so there is nothing to "
            "mark — the page falls back to drawing from every map it carries"
        )
    stated, entries = roster()
    carried = {entry.name for entry in entries}
    method = dict(stated)
    method["random"] = RANDOM_METHOD
    method["random_read"] = date.today().isoformat()
    lines = [json.dumps(method, sort_keys=False)]
    for entry in entries:
        marked = Entry(entry.name, entry.offered, entry.name in read, entry.family, entry.seats)
        lines.append(json.dumps(_roster_row(entry.name, marked, entry.seats, entry.family)))
    PICKS_RECORD.write_text("\n".join(lines) + "\n", encoding="utf-8", newline="\n")
    skipped = tuple(sorted(name for name in read if name not in carried))
    return PICKS_RECORD, len(read), len(read) - len(skipped), skipped


def refresh_roster(release: str) -> tuple[Path, int, int, int]:
    """Rewrite `palettes.jsonl`: every map the library holds, with its two readings.

    **This is the deliberate act, and the bake is not.** `family` and `seats` are
    readings of a pool that is written to while this runs and of one named release, so
    a bake that went out to them would answer differently on two days of one tree and
    `check`'s own bake would go red for a reason that has nothing to do with this
    repository. They are frozen here instead, the same way `offered` is, and the method
    row says which release and how many ledger rows they were read at.

    **Nothing is removed and nothing changes what the picker offers.** A name already in
    the roster keeps its `offered` flag; a name the library holds and the roster does not
    is added, unoffered. A name in the roster that the library has dropped stops this,
    because a link that used to resolve would stop resolving.
    """
    stated, entries = roster()
    held = {entry.name: entry for entry in entries}
    names = library_names()
    missing = sorted(set(held) - set(names))
    if missing:
        raise ExplorerError(
            f"{PICKS_RECORD.name} names {', '.join(missing)}, and {COLORMAP_SOURCE} no longer "
            "holds them — a rename or a deletion next door, and either way a link that used "
            "to resolve stops resolving"
        )

    seats = _seats_per_map(release)
    families, ledger_rows = _families_and_rows(_above_the_bar())
    method = dict(stated)
    method["baked"] = date.today().isoformat()
    method["wallpapers_commit"] = _wallpapers_commit()
    method["rule"] = (
        "every map the library holds, and which of them the picker offers. The roster is the "
        "whole library because a link built from a gallery seat's recipe has to be able to "
        "name the map that seat was drawn in — 451 distinct maps are seated in the published "
        "record alone — and the gradients ride in `palettes.bin` beside the index rather than "
        "in it. What the picker LISTS is the narrower thing and is still frozen: the 77 "
        "curated maps as they stood on 2026-08-23, unchanged by this widening. The distinction "
        "used to be derived from the library's own `source` lines, and a drop of two hundred "
        "authored maps next door would have taken the picker to 277 entries without anybody "
        "deciding to, which is why `offered` is a field here and not a question asked over "
        "there. Nothing is ever removed: a name that has been in a link is a name that has to "
        "keep resolving. This record is what `python -m builder explorer` bakes from, and "
        "`builder check`'s bake check holds the committed module and blob to it."
    )
    method["release"] = release
    method["ledger_rows"] = ledger_rows
    method["readings"] = (
        "`family` is the hue family a map most often PRODUCES: the modal leading entry of "
        "`colour.families` over the candidate-ledger rows drawn in it whose fine-head "
        f"p_ge4 clears solve.DEFAULT_FINE_BAR ({FINE_BAR}), ties by name, absent where the "
        "map has no such row. `seats` is how many seats of the release named above were "
        "drawn in it, counted off that record's own recipes. Both are frozen here rather "
        "than derived at bake time, because the ledger is written to while a bake runs and "
        "a picker's metadata that moved on its own is the failure this record exists for. "
        "`python -m builder explorer --roster` is what rewrites them."
    )

    lines = [json.dumps(method, sort_keys=False)]
    for name in names:
        entry = held.get(name)
        # A name already in the roster keeps its `random` flag as it keeps `offered`: this
        # act re-reads the pool, and which maps a random pick may draw is another list.
        lines.append(
            json.dumps(_roster_row(name, entry, int(seats.get(name, 0)), families.get(name)))
        )
    PICKS_RECORD.write_text("\n".join(lines) + "\n", encoding="utf-8", newline="\n")
    return PICKS_RECORD, len(names), sum(1 for name in names if families.get(name)), ledger_rows


# --------------------------------------------------------------------------- the catalog


def catalogued_modes() -> list[dict]:
    """The engine's mode roster, as `fractal-engine modes` prints it.

    Asked rather than restated. The roster carries each mode's tier, and the page
    offers the production ones; a mode promoted or retired in the wallpaper project
    arrives here by rebuilding rather than by somebody remembering.

    Shelled directly rather than through `renders.run`, because `modes` is the one
    subcommand that takes no spec and answers with a bare list.
    """
    from .renders import engine_binary

    finished = subprocess.run(
        [str(engine_binary()), "modes"],
        capture_output=True,
        text=True,
        cwd=str(wallpapers_root()),
    )
    if finished.returncode != 0:
        raise ExplorerError(f"engine modes failed: {finished.stderr.strip()}")
    return json.loads(finished.stdout)


def mode_roster() -> tuple[dict, tuple[str, ...]]:
    """The committed picker roster: its method row, and the modes it offers, in order.

    Read in file order, which is the order the picker shows and the order `catalog.js`
    bakes them in. The record decides what is offered; the engine catalog decides what
    each of those modes *is*.
    """
    rows = records.read(MODES_RECORD)
    head, rest = rows[0], rows[1:]
    head.expect_kind(PICKS_METHOD)
    found = []
    for record in rest:
        record.expect_kind(MODES_ROW)
        found.append(record.text("name"))
    if not found:
        raise ExplorerError(f"{MODES_RECORD.name} names no mode, so the picker would be empty")
    if len(set(found)) != len(found):
        raise ExplorerError(f"{MODES_RECORD.name} names a mode twice")
    return head.fields, tuple(found)


def offered_modes(names: tuple[str, ...] | None = None) -> list[dict]:
    """Each mode the roster offers, as the engine's catalog describes it, in roster order.

    Two things are refused rather than worked around. A name the record holds and the
    catalog does not is a **rename or a retirement next door**, and both are things
    somebody has to look at before the picker loses an entry. A name the catalog holds
    outside `production` is a mode the engine has **demoted**, and offering it would be
    this repository publishing something the project has stopped shipping.

    What is deliberately *not* refused is the other direction: a production mode the
    record does not name is simply not offered. That is the whole point of the record —
    the engine gained `tail_itinerary` and the picker did not, because widening what a
    reader is offered is an edit somebody makes rather than a build artifact.
    """
    catalog = {mode["name"]: mode for mode in catalogued_modes()}
    found = []
    for name in mode_roster()[1] if names is None else names:
        mode = catalog.get(name)
        if mode is None:
            raise ExplorerError(
                f"{MODES_RECORD.name} offers {name!r}, and the engine catalog has no such mode"
            )
        if mode["tier"] != "production":
            raise ExplorerError(
                f"{MODES_RECORD.name} offers {name!r}, and the engine catalog now calls it "
                f"{mode['tier']!r} rather than production"
            )
        found.append(mode)
    return found


def anchor_constants() -> dict[str, dict[str, str]]:
    """The family constants the explorer opens a dynamical plane at.

    Decimal strings throughout, because a constant is half of a dynamical location's
    identity in exactly the way a coordinate is the other half — the wallpaper
    project's own walk refuses to guess one, and this does not round one either.
    """
    rows = {}
    path = wallpapers_root() / ANCHOR_SOURCE
    if not path.is_file():
        raise ExplorerError(f"no anchors at {path}")
    for line in path.read_text(encoding="utf-8").splitlines():
        if line.strip():
            row = json.loads(line)
            rows[row["anchor"]] = row["family"]

    constants = {}
    for family, anchor in CONSTANT_FAMILIES.items():
        found = rows.get(anchor)
        if found is None:
            raise ExplorerError(f"{ANCHOR_SOURCE} has no {anchor} anchor")
        held = {"cx": found["c"][0], "cy": found["c"][1]}
        if "p" in found:
            held |= {"px": found["p"][0], "py": found["p"][1]}
            # An anchor that says nothing about the previous iterate means the classic
            # slice, which is `FamilySpec::Phoenix`'s own `origin` default over there.
            z_prev = found.get("z_prev", ["0", "0"])
            held |= {"zx": z_prev[0], "zy": z_prev[1]}
        constants[family] = held
    return constants


def curves(modes: list[dict]) -> dict[str, str]:
    """The curve each mode's coloring reads its field through, by mode name.

    The **curve is part of a mode's identity and is not a permalink key** — naming a
    mode is asking for the picture the catalog settled on, curve included. What this
    table is for is telling a *record* apart from that settlement: the wallpaper
    project's stores hold renders that overrode the curve, and one of those is not a
    view this page can open. Asked of the catalog rather than restated, so a retuned
    mode arrives by rebuilding.

    A composite and a modulate carry no curve of their own — each half of the pair
    carries one, and both are the catalog's `linear` — so they answer `linear`, which
    is what a record that left the curve alone says too.
    """
    return {mode["name"]: mode["coloring"].get("transform", "linear") for mode in modes}


def settled(modes: list[dict]) -> dict[str, dict[str, float]]:
    """The two constants a view may derive instead, as the catalog settled them, by mode.

    An angle mode's texture weight and a direct trap's opacity. A link written before
    permalink v3 meant these by leaving the key out, and every picture a record describes
    was drawn at them, so `permalink.js` reads an old link and `emit.mjs` writes a recorded
    picture's link with the number the catalog gives here rather than one typed there.
    Asked of the catalog rather than restated, like the curves above.
    """
    found = {}
    for mode in modes:
        coloring = mode["coloring"]
        if coloring.get("kind") == "composite" and "texture_weight" in coloring:
            found[mode["name"]] = {"weight": coloring["texture_weight"]}
        elif coloring.get("kind") == "direct" and "opacity" in coloring:
            found[mode["name"]] = {"opacity": coloring["opacity"]}
    return found


def catalog_module_text() -> tuple[str, int]:
    """The text of `catalog.js`, and how many modes the picker offers.

    The stamp is read off the roster's method row rather than off the clock, the way
    `palettes.js`'s is: two bakes of one tree are then the same bytes, and an identity
    line or an anchor constant that moved next door is a failing check rather than a
    diff nobody looks at.
    """
    stated, offered = mode_roster()
    modes = offered_modes(offered)
    constants = anchor_constants()
    stamp = {
        "modes_from": str(stated["source"]),
        "roster_from": MODES_RECORD.name,
        "constants_from": ANCHOR_SOURCE,
        "wallpapers_commit": str(stated["wallpapers_commit"]),
        "baked": str(stated["baked"]),
    }

    lines = [
        "// The engine's mode roster and the anchors' family constants, baked from the",
        "// wallpaper project at build time.",
        "//",
        "// Generated by `python -m builder explorer` — edit that, not this. What a",
        "// permalink will ACCEPT is not here: `permalink.js` keeps its own vocabulary, so",
        "// that rebuilding this file can never widen the contract. What is here is what",
        "// those names mean — the line under each mode in the picker, and the constant a",
        "// dynamical plane opens at.",
        "//",
        "// WHICH modes those are is `explorer/modes.jsonl`, not the whole engine catalog:",
        "// a mode the engine promotes arrives in the picker when somebody adds it to that",
        "// record, and not by rebuilding this file.",
        "",
        f"export const PROVENANCE = {json.dumps(stamp, indent=2, sort_keys=True)};",
        "",
        "export const MODES = new Map([",
    ]
    for mode in modes:
        lines.append(f"  [{json.dumps(mode['name'])}, {json.dumps(mode['identity'])}],")
    lines.append("]);")
    lines.append("")
    lines.append(f"export const CONSTANTS = {json.dumps(constants, indent=2, sort_keys=True)};")
    lines.append("")
    lines.append(f"export const CURVES = {json.dumps(curves(modes), indent=2, sort_keys=True)};")
    lines.append("")
    lines.append(f"export const SETTLED = {json.dumps(settled(modes), indent=2, sort_keys=True)};")
    lines.append("")
    return "\n".join(lines), len(modes)


def write_catalog() -> tuple[Path, int]:
    """Bake the offered modes and the family constants into `catalog.js`."""
    text, modes = catalog_module_text()
    CATALOG_MODULE.write_text(text, encoding="utf-8", newline="\n")
    return CATALOG_MODULE, modes


# ------------------------------------------------------------------------------ the wasm


def build_wasm() -> tuple[Path, int, int]:
    """Compile the crate for wasm and copy the module in beside the page."""
    if not CRATE_DIR.is_dir():
        raise ExplorerError(f"no crate at {CRATE_DIR}")
    wallpapers_root()  # refuse early, with the message that names both ways to configure
    finished = subprocess.run(
        ["cargo", "build", "--target", WASM_TARGET, "--release"],
        cwd=CRATE_DIR,
        capture_output=True,
        text=True,
    )
    if finished.returncode != 0:
        raise ExplorerError(f"cargo build failed:\n{finished.stderr.strip()}")
    built = CRATE_DIR.joinpath(*WASM_ARTIFACT)
    if not built.is_file():
        raise ExplorerError(f"cargo reported success and left no module at {built}")
    shutil.copyfile(built, WASM_MODULE)
    raw = WASM_MODULE.read_bytes()
    return WASM_MODULE, len(raw), len(gzip.compress(raw, 9))


def write_manifest(raw_bytes: int, gzip_bytes: int) -> Path:
    """Record what the committed module was built from, and with what."""
    manifest = {
        "schema": SCHEMA,
        "built": date.today().isoformat(),
        "crate": CRATE_DIR.relative_to(SITE_ROOT).as_posix(),
        "engine_changes": list(ENGINE_CHANGES),
        "engine_version": _engine_version(),
        "gzip_bytes": gzip_bytes,
        "raw_bytes": raw_bytes,
        "rustc": _rustc_version(),
        "wallpapers_commit": _wallpapers_commit(),
    }
    MANIFEST.write_text(
        json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8", newline="\n"
    )
    return MANIFEST


def load_manifest() -> dict | None:
    """The committed manifest, or `None` where the module has never been built."""
    if not MANIFEST.is_file():
        return None
    return json.loads(MANIFEST.read_text(encoding="utf-8"))


def manifest_notes() -> list[str]:
    """Whether the committed module is behind the engine beside it — advice, not a failure.

    Deliberately a note. The module is committed and the site serves it whichever commit
    it was built from; a stale one is a thing to rebuild when somebody is next at a
    machine that can, not a red check on a tree that is serving fine. And a clone with no
    wallpaper project beside it — CI, every time — has nothing to compare against and
    says nothing at all.
    """
    manifest = load_manifest()
    if manifest is None:
        return [] if not WASM_MODULE.is_file() else ["explorer: engine.wasm has no manifest"]
    try:
        root = wallpapers_root()
    except EngineError:
        return []
    built_from = manifest.get("wallpapers_commit")
    if not isinstance(built_from, str) or not built_from:
        return ["explorer: engine.manifest.json names no wallpapers commit"]
    finished = subprocess.run(
        ["git", "merge-base", "--is-ancestor", built_from, "HEAD"],
        cwd=root,
        capture_output=True,
        text=True,
    )
    if finished.returncode == 0:
        return []
    return [
        f"explorer: engine.wasm was built from wallpapers {built_from[:12]}, which is not an "
        "ancestor of that checkout's HEAD — rebuild with `python -m builder explorer`"
    ]


# ----------------------------------------------------------------------------- the facts


def _wallpapers_commit() -> str:
    finished = subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=wallpapers_root(),
        capture_output=True,
        text=True,
    )
    if finished.returncode != 0:
        raise ExplorerError(f"git rev-parse in the wallpapers checkout failed: {finished.stderr}")
    return finished.stdout.strip()


def _engine_version() -> str:
    """The engine crate's own version, read from its manifest rather than restated."""
    text = (wallpapers_root() / "engine" / "Cargo.toml").read_text(encoding="utf-8")
    found = re.search(r'^version\s*=\s*"([^"]+)"', text, re.MULTILINE)
    if not found:
        raise ExplorerError("the engine crate's Cargo.toml names no version")
    return found.group(1)


def _rustc_version() -> str:
    finished = subprocess.run(["rustc", "--version"], capture_output=True, text=True)
    if finished.returncode != 0:
        raise ExplorerError("rustc is not on the path")
    found = _RUSTC_VERSION.match(finished.stdout.strip())
    return found.group(1) if found else finished.stdout.strip()


def bake(*, palettes_only: bool = False) -> list[str]:
    """Everything the explorer is generated from, in one pass."""
    written = []
    made = write_palettes()
    written.append(
        f"{PALETTES_MODULE.relative_to(SITE_ROOT).as_posix()}  {made.count} palettes "
        f"({made.offered} offered, {made.random} a random pick may draw, {made.families} with "
        f"a hue family), default {made.chosen}"
    )
    written.append(
        f"{PALETTES_BLOB.relative_to(SITE_ROOT).as_posix()}  {len(made.blob):,} bytes, untracked"
    )
    if PALETTES_SWATCH.is_file():
        written.append(
            f"{PALETTES_SWATCH.relative_to(SITE_ROOT).as_posix()}  "
            f"{PALETTES_SWATCH.stat().st_size:,} bytes, untracked"
        )
    path, modes = write_catalog()
    written.append(f"{path.relative_to(SITE_ROOT).as_posix()}  {modes} offered modes")
    if palettes_only:
        return written
    path, raw_bytes, gzip_bytes = build_wasm()
    written.append(
        f"{path.relative_to(SITE_ROOT).as_posix()}  {raw_bytes:,} bytes, {gzip_bytes:,} gzipped"
    )
    path = write_manifest(raw_bytes, gzip_bytes)
    written.append(path.relative_to(SITE_ROOT).as_posix())
    return written
