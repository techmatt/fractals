"""The one seam between this repository and the fractal engine next door.

Nothing else here shells a binary or names a path outside the checkout. A figure that
needs a fractal drawn asks this module; a figure that needs panels arranged asks
`sheets.py`; and the two halves meet in a rig that is a list of locations and a layout.
Three copies of this file used to live in `scratch/`, each with the wallpaper project's
absolute path typed into it, and each died with the session that wrote it.

## Where the engine is

Never in tracked code — `CLAUDE.md` is explicit that no absolute path is committed here,
and the wallpaper project is not at the same place on two machines. So:

    FRACTAL_WALLPAPERS_ROOT=D:/src/fractal-wallpapers    # an environment variable, or

    # local.toml at the root of this repository, untracked
    wallpapers_root = "C:/Code/fractal-wallpapers"

The variable wins when it is set. Neither being present is not an error until something
actually asks for a render: `check` and `build` never do, and a clone with no wallpaper
project beside it builds the site fine.

## Which disk the artifacts are on

The wallpaper project's regenerable tree has two storage tiers — a hot one on the system
disk where work happens, and an archive on an external drive where finished bulk goes —
and a top-level name lives in exactly one of them. `artifacts/curation` and every ledger
moved to the archive, which is how a figure script that read
`<wallpapers>/artifacts/curation/...` came to read a path that is no longer there.

So a name under the tree is resolved through both tiers, by the same rule the wallpaper
project resolves it by, and from the same settings: that project's own `local.toml`, or
`FRACTAL_WALLPAPERS_HOT_ROOT` / `FRACTAL_WALLPAPERS_ARCHIVE_ROOT`. Deliberately not a
second copy of the setting in this repo's `local.toml` — one machine, one answer to
where its tree is, and a duplicate would be a copy free to drift.

## The cache

Renders are the expensive part and compositions are the part that gets adjusted, so
every render goes through a keyed cache with a manifest beside it: adjusting a label
never re-renders a panel. The key is the spec, so a changed constant is a new key and a
new render, and nothing is ever stale. See `Cache`.
"""

from __future__ import annotations

import hashlib
import json
import os
import subprocess
import time
import tomllib
from dataclasses import dataclass
from pathlib import Path

from .paths import SITE_ROOT

#: This repository's own untracked settings, read from the checkout root.
LOCAL_SETTINGS = SITE_ROOT / "local.toml"

#: Where the wallpaper project is checked out. The variable wins over the file.
WALLPAPERS_KEY = "wallpapers_root"
WALLPAPERS_VARIABLE = "FRACTAL_WALLPAPERS_ROOT"

#: Where the render cache lives. Defaults to `artifacts/` here, which `.gitignore`
#: already keeps out and which the manifest makes re-derivable in full.
CACHE_KEY = "render_cache"
CACHE_VARIABLE = "FRACTAL_WEBSITE_RENDER_CACHE"

#: The wallpaper project's own tier settings, read from *its* checkout, never copied
#: into this one. Same key names, same environment variables, same meaning.
ARTIFACTS_NAME = "artifacts"
HOT_ROOT_KEY = "hot_root"
HOT_ROOT_VARIABLE = "FRACTAL_WALLPAPERS_HOT_ROOT"
ARCHIVE_ROOT_KEY = "archive_root"
ARCHIVE_ROOT_VARIABLE = "FRACTAL_WALLPAPERS_ARCHIVE_ROOT"

ENGINE_BINARY = ("engine", "target", "release", "fractal-engine")

#: The neutral map every figure that is not *about* colour is drawn in.
COLORMAP = "twilight_shifted"


class EngineError(RuntimeError):
    """The engine could not be found, could not be run, or refused what it was asked."""


# ------------------------------------------------------------------------ the settings


def _settings(path: Path) -> dict:
    """One TOML settings file, or an empty mapping where there is none.

    Read fresh every time. Caching would mean a process that started with a disk
    unplugged could never be told it is plugged in now, and the read is one small file.
    """
    if not path.is_file():
        return {}
    return tomllib.loads(path.read_text(encoding="utf-8"))


def _configured(settings: dict, key: str, variable: str) -> Path | None:
    """A path from the environment or the settings file, with the environment winning.

    Set to nothing is a statement, not an absence: it says *this machine has no such
    root*, overriding a file that says otherwise.
    """
    stated = os.environ.get(variable)
    if stated is not None:
        return Path(stated) if stated.strip() else None
    value = settings.get(key)
    return Path(str(value)) if value else None


def wallpapers_root() -> Path:
    """Where the wallpaper project is checked out, or a refusal naming both ways to say."""
    configured = _configured(_settings(LOCAL_SETTINGS), WALLPAPERS_KEY, WALLPAPERS_VARIABLE)
    if configured is None:
        raise EngineError(
            "the fractal-wallpapers checkout is not configured. Set the "
            f"{WALLPAPERS_VARIABLE} environment variable, or put "
            f'`{WALLPAPERS_KEY} = "..."` in {LOCAL_SETTINGS.name} at the root of this '
            "repository — untracked, because no absolute path is committed here."
        )
    if not configured.is_dir():
        raise EngineError(
            f"{configured} is configured as the wallpapers checkout, and is not there"
        )
    return configured


def engine_binary() -> Path:
    """The release binary inside that checkout, with or without Windows' suffix."""
    root = wallpapers_root()
    stem = root.joinpath(*ENGINE_BINARY)
    for candidate in (stem, stem.with_suffix(".exe")):
        if candidate.is_file():
            return candidate
    raise EngineError(
        f"no engine binary at {stem} — build it in the wallpapers checkout with "
        "`cargo build --release`"
    )


# --------------------------------------------------------------------------- the tiers


@dataclass(frozen=True)
class Tiers:
    """Where each top-level name of the wallpaper project's tree actually is.

    The unit of tiering is a top-level name, not a file: `curation` is on one disk or the
    other, whole. That is what the wallpaper project's `storage` commands move, and it is
    what makes resolution one lookup per subtree rather than one per file.
    """

    hot: Path
    archive: Path | None

    @classmethod
    def current(cls) -> Tiers:
        """The tiers as this machine is configured this second."""
        root = wallpapers_root()
        settings = _settings(root / "local.toml")
        hot = _configured(settings, HOT_ROOT_KEY, HOT_ROOT_VARIABLE) or root / ARTIFACTS_NAME
        return cls(hot, _configured(settings, ARCHIVE_ROOT_KEY, ARCHIVE_ROOT_VARIABLE))

    @property
    def archive_is_reachable(self) -> bool:
        return self.archive is not None and self.archive.is_dir()

    def unit(self, name: str) -> Path:
        """Where one top-level name is. A name neither tier holds resolves hot."""
        hot_here = (self.hot / name).exists()
        cold_here = self.archive_is_reachable and (self.archive / name).exists()
        if hot_here and cold_here:
            raise EngineError(
                f"{ARTIFACTS_NAME}/{name} is in both tiers — {self.hot / name} and "
                f"{self.archive / name}. Which copy is the truth is a guess from here; "
                "the wallpaper project refuses this too. Compare them and delete one."
            )
        if cold_here:
            return self.archive / name
        if hot_here or self.archive is None or self.archive_is_reachable:
            return self.hot / name
        raise EngineError(
            f"{ARTIFACTS_NAME}/{name} is not in the hot tier ({self.hot}), and the archive "
            f"that could hold it — {self.archive} — is not plugged in. From here an "
            "archived subtree and one nobody has built yet look exactly alike."
        )

    def resolve(self, *parts) -> Path:
        """A name inside the tree, addressed against whichever tier holds its subtree."""
        named = [part for part in "/".join(str(part) for part in parts).split("/") if part]
        if named and named[0] == ARTIFACTS_NAME:
            named = named[1:]
        if not named:
            return self.hot
        return self.unit(named[0]).joinpath(*named[1:])


def artifact(*parts) -> Path:
    """A file under the wallpaper project's regenerable tree, on the disk it is on.

    The one funnel a figure names such a file through — because a path built out of the
    checkout root and a string finds the hot tier and nothing else, which is exactly how
    the gallery-hook figure came to read six wallpapers that had moved to the archive.
    """
    return Tiers.current().resolve(*parts)


def rehome(stored) -> Path | None:
    """A path recorded under *an* artifacts tree, re-addressed against this machine's.

    A rig's notes name the files a run made, as the run saw them. Move the tree — archive
    a subtree to the external disk, or clone onto a machine that keeps it elsewhere — and
    every one of those names points at nothing. So a stored name is read as the part below
    the artifacts root and joined onto wherever that part lives now.

    `None` where the stored name has no artifacts component: that is not a name this knows
    anything about, and the caller keeps whatever it had. Returning `None` rather than the
    input is what makes the two distinguishable.
    """
    parts = str(stored).replace("\\", "/").split("/")
    for index in range(len(parts) - 1, -1, -1):
        if parts[index] == ARTIFACTS_NAME:
            return Tiers.current().resolve(*parts[index + 1 :])
    return None


def data_file(*parts) -> Path:
    """A file under the wallpaper project's *tracked* data — labels, palettes, ledgers.

    Tracked material is in the checkout, never tiered, so it is addressed straight.
    """
    return wallpapers_root().joinpath(*(str(part) for part in parts))


# ---------------------------------------------------------------------------- the runs


def run(subcommand: str, spec: dict) -> dict:
    """One engine invocation, spec on stdin, echo on stdout.

    The working directory is the wallpapers checkout, because the engine finds
    `data/palettes` relative to it.
    """
    binary = engine_binary()
    root = wallpapers_root()
    started = time.monotonic()
    completed = subprocess.run(
        [str(binary), subcommand],
        input=json.dumps(spec),
        capture_output=True,
        text=True,
        cwd=str(root),
        check=False,
    )
    if completed.returncode != 0:
        raise EngineError(
            f"engine {subcommand} failed: {completed.stderr.strip()}\nspec: {json.dumps(spec)}"
        )
    echo = json.loads(completed.stdout)
    echo["seconds"] = round(time.monotonic() - started, 1)
    return echo


def home_view(family: dict) -> dict:
    """The frame a family is drawn whole in — its own answer, not a guessed rectangle."""
    return run("home-view", {"schema": 1, "family": family})


def render(spec: dict, out: Path, **extra) -> Path:
    """One render to a named file, skipped where that file is already there.

    The plain form, keyed on the path the caller chose rather than on the spec. It is
    what the rigs that drew the article's existing figures use, and what a rig wants when
    the panels themselves are worth reading on disk under names a person picked. A figure
    being made fresh should prefer `Cache`, which keys on the spec and cannot go stale.
    """
    out = Path(out)
    out.parent.mkdir(parents=True, exist_ok=True)
    if out.is_file():
        return out
    full = dict(spec, output=str(out), **extra)
    full.setdefault("schema", 1)
    echo = run("render", full)
    print(f"  rendered {out.name}  {echo.get('seconds')}s  maxiter={echo.get('maxiter')}")
    return out


def dump_field(spec: dict, stem: Path, **extra) -> tuple[Path, dict]:
    """Dump the raw escape field beside its record, skipped where the record is there.

    The field is what `recolor` re-reads, which is how a palette figure draws eight
    versions of one location for the cost of rendering it once.
    """
    stem = Path(stem)
    stem.parent.mkdir(parents=True, exist_ok=True)
    record = stem.with_suffix(".json")
    if not record.is_file():
        full = dict(spec, output=str(stem.with_suffix(".f32")), **extra)
        full.setdefault("schema", 1)
        echo = run("dump-field", full)
        print(f"  dumped {stem.name}  {echo.get('seconds')}s  maxiter={echo.get('maxiter')}")
    return stem.with_suffix(".f32"), json.loads(record.read_text(encoding="utf-8"))


def recolor(field: Path, out: Path, **tail) -> Path:
    """Colour an already-dumped field, skipped where the output is already there."""
    out = Path(out)
    out.parent.mkdir(parents=True, exist_ok=True)
    if out.is_file():
        return out
    run("recolor", {"schema": 1, "field": str(field), "output": str(out), **tail})
    return out


# --------------------------------------------------------------------------- the cache


@dataclass(frozen=True)
class Cached:
    """One cached render: where the file is, and what the engine said making it."""

    path: Path
    key: str
    echo: dict
    fresh: bool


class Cache:
    """Keyed renders and a manifest, so composing is cheap and re-deriving is possible.

    The key is a digest of the spec the engine was given, with the output path taken out
    of it — so two figures asking for the same panel share one render, and a figure whose
    constant changed gets a new key rather than a stale file. Nothing here is ever
    invalidated by age, because a spec fully determines its picture.

    The manifest is one JSONL row per entry, holding the whole spec. It is what makes the
    cache *re-derivable* rather than merely disposable: delete the tree and every panel in
    it can be drawn again from the manifest alone, and a figure whose recipe has been lost
    can still be traced back to the numbers that made its panels.
    """

    MANIFEST_NAME = "manifest.jsonl"

    def __init__(self, root: Path | None = None) -> None:
        self.root = Path(root) if root is not None else default_cache_root()

    @property
    def manifest_path(self) -> Path:
        return self.root / self.MANIFEST_NAME

    def manifest(self) -> dict[str, dict]:
        """Every recorded entry, keyed. A later row for a key replaces an earlier one."""
        if not self.manifest_path.is_file():
            return {}
        rows: dict[str, dict] = {}
        with self.manifest_path.open(encoding="utf-8") as handle:
            for line in handle:
                if line.strip():
                    row = json.loads(line)
                    rows[row["key"]] = row
        return rows

    def _record(self, row: dict) -> None:
        self.root.mkdir(parents=True, exist_ok=True)
        with self.manifest_path.open("a", encoding="utf-8", newline="\n") as handle:
            handle.write(json.dumps(row, ensure_ascii=False) + "\n")

    def render(
        self,
        name: str,
        spec: dict,
        size: tuple[int, int],
        *,
        supersample: int = 3,
        subcommand: str = "render",
        suffix: str = ".png",
        colormap: str | None = COLORMAP,
    ) -> Cached:
        """A rendered panel, drawn once per spec and reused ever after.

        `name` is for the human reading the cache directory; the key is the spec, so
        renaming a panel does not re-render it and changing its numbers does.
        """
        full = dict(spec)
        full.setdefault("schema", 1)
        full["resolution"] = list(size)
        full["supersample"] = supersample
        if colormap is not None:
            full.setdefault("colormap", colormap)
        return self.produce(name, subcommand, full, suffix=suffix)

    def produce(self, name: str, subcommand: str, spec: dict, *, suffix: str = ".png") -> Cached:
        """The general form: any engine subcommand that writes one output file."""
        key = spec_key(subcommand, spec)
        path = self.root / f"{_slug(name)}-{key}{suffix}"
        if path.is_file():
            recorded = self.manifest().get(key, {})
            return Cached(path, key, recorded.get("echo", {}), fresh=False)
        path.parent.mkdir(parents=True, exist_ok=True)
        echo = run(subcommand, dict(spec, output=str(path)))
        self._record(
            {
                "schema": 1,
                "kind": "render",
                "key": key,
                "name": name,
                "file": path.name,
                "subcommand": subcommand,
                "spec": spec,
                "echo": echo,
                "bytes": path.stat().st_size,
            }
        )
        print(f"  rendered {path.name}  {echo.get('seconds')}s  maxiter={echo.get('maxiter')}")
        return Cached(path, key, echo, fresh=True)


def default_cache_root() -> Path:
    """Where cached renders go unless this machine says otherwise."""
    configured = _configured(_settings(LOCAL_SETTINGS), CACHE_KEY, CACHE_VARIABLE)
    return configured if configured is not None else SITE_ROOT / "artifacts" / "renders"


def spec_key(subcommand: str, spec: dict) -> str:
    """A digest of what was asked for, with the output path — which is not — left out."""
    without_output = {key: value for key, value in spec.items() if key != "output"}
    canonical = json.dumps([subcommand, without_output], sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()[:16]


def _slug(name: str) -> str:
    kept = [character if character.isalnum() else "-" for character in name.lower()]
    return "".join(kept).strip("-") or "panel"
