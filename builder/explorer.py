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
- **The catalog** — the engine's mode roster with the line that says what each mode is
  for, and the family constants a dynamical plane needs. Both are facts the wallpaper
  project owns: the modes come out of `fractal-engine modes`, and the constants out of
  its shipped anchors, so neither is typed here. What the *permalink* will accept is
  still `permalink.js`'s own business — a contract that read its vocabulary from a
  generated file could be widened by rebuilding it.
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

from . import figures
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

#: The tail of the sentence a mechanically-converted map carries in its `source` line.
#: See `src/fractal_wallpapers/palettes/library_import.py` over there.
CONVERTED_MARKER = "not because it was curated"

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
    "iterate::run is #[inline(always)]: the specialization cascade the nine call sites "
    "in the wasm crate depend on.",
]

_RUSTC_VERSION = re.compile(r"^rustc (\S+ \([0-9a-f]+ \d{4}-\d{2}-\d{2}\))")


class ExplorerError(RuntimeError):
    """A bake cannot proceed, and guessing would be worse than stopping."""


# ------------------------------------------------------------------------- the palettes


@dataclass(frozen=True)
class Colormap:
    """One curated map: the name a link carries, and the gradient it names."""

    name: str
    cyclic: bool
    stops: tuple[tuple[float, tuple[int, int, int]], ...]


def curated() -> list[Colormap]:
    """Every curated colormap the wallpaper project holds, in name order.

    Name order is `sorted`'s — codepoint, so the capitalized matplotlib names lead. The
    order is what the picker shows and what "first by name" means where the default has
    to fall back to it, so it is one rule and not two.
    """
    directory = wallpapers_root() / COLORMAP_SOURCE
    if not directory.is_dir():
        raise ExplorerError(f"no colormaps at {directory}")
    found = []
    for path in sorted(directory.glob("*.json")):
        loaded = json.loads(path.read_text(encoding="utf-8"))
        if CONVERTED_MARKER in loaded.get("source", ""):
            continue
        stops = tuple((float(at), tuple(int(c) for c in rgb)) for at, rgb in loaded["stops"])
        found.append(Colormap(loaded["name"], loaded["kind"] == "cyclic", stops))
    if not found:
        raise ExplorerError(f"{directory} holds no curated colormap")
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


def write_palettes() -> tuple[Path, int, str]:
    """Bake the curated set into `palettes.js`, with the stamp that says where from."""
    maps = curated()
    names = [colormap.name for colormap in maps]
    chosen, why = default_palette(names)
    stamp = {
        "source": f"{COLORMAP_SOURCE}/*.json",
        "wallpapers_commit": _wallpapers_commit(),
        "baked": date.today().isoformat(),
        "count": len(maps),
        "default_because": why,
    }

    lines = [
        "// The curated colormaps, baked from the wallpaper project at build time.",
        "//",
        "// Generated by `python -m builder explorer` — edit that, not this. A map is",
        "// addressed by NAME everywhere, in this file and in a permalink, because a name",
        "// is stable and a position in a list is not: a colormap added next year must not",
        "// silently repaint a link somebody saved this year.",
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
        lines.append(f"    positions: [{positions}],")
        lines.append(f"    colors: [{colors}],")
        lines.append("  }],")
    lines.append("]);")
    lines.append("")

    PALETTES_MODULE.write_text("\n".join(lines), encoding="utf-8", newline="\n")
    return PALETTES_MODULE, len(maps), chosen


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
        constants[family] = held
    return constants


def write_catalog() -> tuple[Path, int]:
    """Bake the mode roster and the family constants into `catalog.js`."""
    modes = [mode for mode in catalogued_modes() if mode["tier"] == "production"]
    constants = anchor_constants()
    stamp = {
        "modes_from": "fractal-engine modes",
        "constants_from": ANCHOR_SOURCE,
        "wallpapers_commit": _wallpapers_commit(),
        "baked": date.today().isoformat(),
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

    CATALOG_MODULE.write_text("\n".join(lines), encoding="utf-8", newline="\n")
    return CATALOG_MODULE, len(modes)


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
    path, count, chosen = write_palettes()
    written.append(f"{path.relative_to(SITE_ROOT).as_posix()}  {count} palettes, default {chosen}")
    path, modes = write_catalog()
    written.append(f"{path.relative_to(SITE_ROOT).as_posix()}  {modes} production modes")
    if palettes_only:
        return written
    path, raw_bytes, gzip_bytes = build_wasm()
    written.append(
        f"{path.relative_to(SITE_ROOT).as_posix()}  {raw_bytes:,} bytes, {gzip_bytes:,} gzipped"
    )
    path = write_manifest(raw_bytes, gzip_bytes)
    written.append(path.relative_to(SITE_ROOT).as_posix())
    return written
