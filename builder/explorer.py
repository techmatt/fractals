"""What the explorer page is built from: its palettes, its wasm module, its manifest.

The explorer is a page that runs code, which is new here, and the rule the rest of the
site is held to still holds: **the builder generates; it never becomes the site.**
`engine.wasm`, `palettes.js` and `engine.manifest.json` are committed artifacts. A clone
with no wallpaper project beside it serves the explorer exactly as this one does; only
*regenerating* those three files needs the sibling checkout and a Rust toolchain.

Four things are baked, and each for its own reason:

- **The palettes** — the curated colormaps, name to stops, as an ES module. Names are
  the ids a permalink carries, so they are baked as names and never as indices: a
  colormap added to the wallpaper project must not silently renumber somebody's link.
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

import gzip
import json
import re
import shutil
import subprocess
from dataclasses import dataclass
from datetime import date
from pathlib import Path

from . import figures, records
from .paths import SITE_ROOT
from .renders import EngineError, wallpapers_root

#: Where the explorer's committed artifacts live.
EXPLORER_DIR = SITE_ROOT / "explorer"
PALETTES_MODULE = EXPLORER_DIR / "palettes.js"
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
    "phoenix": "phoenix",
}

#: The wallpaper project's colormap directory, relative to its checkout root. Recorded
#: in the provenance stamp, so a reader can go and look at what was baked.
COLORMAP_SOURCE = "data/palettes"

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
    """

    name: str
    cyclic: bool
    stops: tuple[tuple[float, tuple[int, int, int]], ...]
    offered: bool


def roster() -> tuple[dict, tuple[tuple[str, bool], ...]]:
    """The committed roster: its method row, and one `(name, offered)` per map.

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
        found.append((record.text("name"), record.flag("offered")))
    if not found:
        raise ExplorerError(f"{PICKS_RECORD.name} names no palette")
    if not any(offered for _, offered in found):
        raise ExplorerError(f"{PICKS_RECORD.name} offers nothing, so the picker would be empty")
    names = [name for name, _ in found]
    if names != sorted(names):
        raise ExplorerError(f"{PICKS_RECORD.name} is not in name order, and the picker shows it")
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
    for name, offered in roster()[1]:
        loaded = held.get(name)
        if loaded is None:
            raise ExplorerError(
                f"{PICKS_RECORD.name} names {name!r}, and {COLORMAP_SOURCE} holds no such map"
            )
        stops = tuple((float(at), tuple(int(c) for c in rgb)) for at, rgb in loaded["stops"])
        found.append(Colormap(name, loaded["kind"] == "cyclic", stops, offered))
    return found


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
    """
    named = []
    for figure in figures.load_all().values():
        for line in figure.provenance:
            lowered = line.lower()
            if "mandelbrot" not in lowered or "mode smooth" not in lowered:
                continue
            found = re.search(r"colormap ([^,]+)", line)
            if found:
                named.append(found.group(1).strip())
    return named


def palettes_module_text() -> tuple[str, int, int, str]:
    """The text of `palettes.js`, and the counts and default that go in the report line.

    Split out from writing it so that `check` can bake into memory and compare, which is
    the whole reason the stamp below is read off the roster rather than off the clock:
    `baked` and `wallpapers_commit` say when the roster was fixed and against which
    commit of the library, so two bakes of one tree are the same bytes. A gradient that
    moved next door is then a failing check rather than a diff nobody looks at.
    """
    stated, _picks = roster()
    maps = baked()
    names = [colormap.name for colormap in maps if colormap.offered]
    chosen, why = default_palette(names)
    stamp = {
        "source": str(stated["source"]),
        "wallpapers_commit": str(stated["wallpapers_commit"]),
        "baked": str(stated["baked"]),
        "count": len(maps),
        "offered": len(names),
        "default_because": why,
    }

    lines = [
        "// The colormaps the explorer carries, baked from the wallpaper project at",
        "// build time.",
        "//",
        "// Generated by `python -m builder explorer` — edit that, not this. A map is",
        "// addressed by NAME everywhere, in this file and in a permalink, because a name",
        "// is stable and a position in a list is not: a colormap added next year must not",
        "// silently repaint a link somebody saved this year.",
        "//",
        "// `offered` is whether the picker lists it. Every curated map is offered; a map",
        "// baked only because one of this site's own pictures was drawn in it is not, so",
        "// that a figure of this article can be opened here without widening a curated",
        "// set this repository does not own.",
        "//",
        "// Positions are the map's own, not assumed evenly spaced. Colors are sRGB8.",
        "",
        f"export const PROVENANCE = {json.dumps(stamp, indent=2, sort_keys=True)};",
        "",
        f"export const DEFAULT_PALETTE = {json.dumps(chosen)};",
        "",
        "export const PALETTES = new Map([",
    ]
    for colormap in maps:
        positions = ", ".join(repr(at) for at, _ in colormap.stops)
        colors = ", ".join(str(value) for _, rgb in colormap.stops for value in rgb)
        lines.append(f"  [{json.dumps(colormap.name)}, {{")
        lines.append(f"    cyclic: {'true' if colormap.cyclic else 'false'},")
        lines.append(f"    offered: {'true' if colormap.offered else 'false'},")
        lines.append(f"    positions: [{positions}],")
        lines.append(f"    colors: [{colors}],")
        lines.append("  }],")
    lines.append("]);")
    lines.append("")
    return "\n".join(lines), len(maps), len(names), chosen


def write_palettes() -> tuple[Path, int, int, str]:
    """Bake the maps into `palettes.js`, with the stamp that says where from."""
    text, count, offered, chosen = palettes_module_text()
    PALETTES_MODULE.write_text(text, encoding="utf-8", newline="\n")
    return PALETTES_MODULE, count, offered, chosen


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
    path, count, offered, chosen = write_palettes()
    written.append(
        f"{path.relative_to(SITE_ROOT).as_posix()}  {count} palettes ({offered} offered), "
        f"default {chosen}"
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
