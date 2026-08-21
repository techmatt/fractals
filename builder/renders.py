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
import subprocess
import time
from dataclasses import dataclass
from pathlib import Path

from .paths import SITE_ROOT
from .settings import LOCAL_SETTINGS, configured, read_settings

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


def wallpapers_root() -> Path:
    """Where the wallpaper project is checked out, or a refusal naming both ways to say."""
    root = configured(read_settings(LOCAL_SETTINGS), WALLPAPERS_KEY, WALLPAPERS_VARIABLE)
    if root is None:
        raise EngineError(
            "the fractal-wallpapers checkout is not configured. Set the "
            f"{WALLPAPERS_VARIABLE} environment variable, or put "
            f'`{WALLPAPERS_KEY} = "..."` in {LOCAL_SETTINGS.name} at the root of this '
            "repository — untracked, because no absolute path is committed here."
        )
    if not root.is_dir():
        raise EngineError(f"{root} is configured as the wallpapers checkout, and is not there")
    return root


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
        settings = read_settings(root / "local.toml")
        hot = configured(settings, HOT_ROOT_KEY, HOT_ROOT_VARIABLE) or root / ARTIFACTS_NAME
        return cls(hot, configured(settings, ARCHIVE_ROOT_KEY, ARCHIVE_ROOT_VARIABLE))

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
    root = configured(read_settings(LOCAL_SETTINGS), CACHE_KEY, CACHE_VARIABLE)
    return root if root is not None else SITE_ROOT / "artifacts" / "renders"


def spec_key(subcommand: str, spec: dict) -> str:
    """A digest of what was asked for, with the output path — which is not — left out."""
    without_output = {key: value for key, value in spec.items() if key != "output"}
    canonical = json.dumps([subcommand, without_output], sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()[:16]


def _slug(name: str) -> str:
    kept = [character if character.isalnum() else "-" for character in name.lower()]
    return "".join(kept).strip("-") or "panel"


# ----------------------------------------------------------------------- the other CLI

#: The wallpaper project's own entry point, inside its virtualenv. Windows puts console
#: scripts in `Scripts`, everything else in `bin`; both are tried, and neither is a path
#: this repository commits — it is derived from where that checkout is.
CLI_NAME = "fractal-wallpapers"
CLI_DIRS = ("Scripts", "bin")
VENV_NAME = ".venv"

#: The geometry the walk's own judge reads. A score printed under a figure is read at
#: this unless the figure says otherwise, so it is the number the run itself recorded
#: rather than a second opinion taken at a different size.
NODE_REGIME = "384x216ss1"


def cli_binary() -> Path:
    """The wallpaper project's console script, or a refusal saying where it looked.

    Some of what a figure needs is not the engine: the boundary sampler, the structural
    gates run over a frame somebody named, the judge asked about a list of locations.
    Those live in that project's Python entry point, which is the second of the three
    things this repository shells — the engine, this, and that project's bare interpreter
    for the one job neither of them has a door for.
    """
    root = wallpapers_root()
    for directory in CLI_DIRS:
        for name in (CLI_NAME, f"{CLI_NAME}.exe"):
            candidate = root / VENV_NAME / directory / name
            if candidate.is_file():
                return candidate
    raise EngineError(
        f"no {CLI_NAME} entry point under {root / VENV_NAME} — create the wallpaper "
        'project\'s virtualenv and `pip install -e ".[dev,models]"` into it'
    )


def cli(subcommand: str, *arguments) -> str:
    """One invocation of that entry point, with its stdout returned."""
    binary = cli_binary()
    completed = subprocess.run(
        [str(binary), subcommand, *(str(argument) for argument in arguments)],
        capture_output=True,
        text=True,
        cwd=str(wallpapers_root()),
        check=False,
    )
    if completed.returncode != 0:
        raise EngineError(
            f"{CLI_NAME} {subcommand} failed: {completed.stderr.strip() or completed.stdout[-800:]}"
        )
    return completed.stdout


#: The one thing that project does that neither its engine nor its console script has a
#: door for: reading a picture through a trained judge. `head score` exists, and it
#: rewrites a tracked scores file inside that checkout — which this repository may not
#: do. So the third and last thing shelled here is that project's own interpreter,
#: running the program below: its loader, its checkpoint, its deploy transform, its
#: reading of the ordinal head. No policy is restated here and nothing is written there.
SCORE_PROGRAM = """
import json, sys
from pathlib import Path

from fractal_wallpapers.models import finished_scoring, finished_train, train
from fractal_wallpapers.models import head as head_module

ask = json.load(sys.stdin)
checkpoint = finished_train.checkpoint_path(ask["head"], ask["which"], ask["run"])
model, config, where = finished_scoring.load(checkpoint)
transform = head_module.Transform(
    tuple(config["mean"]), tuple(config["std"]), config["interpolation"], train=False
)
paths = [Path(name) for name in ask["pictures"]]
classes = int(config["classes"])
probabilities = train.score(model, paths, transform, where, classes, config)
with open(ask["out"], "w", encoding="utf-8", newline=chr(10)) as handle:
    for index, row in enumerate(probabilities):
        found = {f"p_ge{step + 2}": float(value) for step, value in enumerate(row)}
        handle.write(json.dumps({"schema": 1, "index": index, **found}) + chr(10))
print(json.dumps({"pictures": len(paths), "checkpoint": checkpoint.name, "device": where}))
"""


CROP_PROGRAM = """
import json, sys

from fractal_wallpapers.models import renders

ask = json.load(sys.stdin)
found = [str(renders.crop_of(ask["head"], row)) for row in ask["rows"]]
print(json.dumps(found))
"""


def corpus_crops(head: str, rows) -> list[Path]:
    """Where that project keeps the picture each of these rows was judged on.

    Its own answer, asked of its own module. A crop's file name is a digest of the whole
    render spec, so spelling it here would be a second spelling, free to drift from the
    first the next time a field enters that spec. Asked in that project's interpreter
    rather than by importing it into this one: this repository's builder depends on
    Pillow and nothing else, and that is worth keeping true.
    """
    wanted = [
        {key: value for key, value in row.items() if not key.startswith(chr(95))} for row in rows
    ]
    completed = subprocess.run(
        [str(venv_python()), "-c", CROP_PROGRAM],
        input=json.dumps({"head": head, "rows": wanted}),
        capture_output=True,
        text=True,
        cwd=str(wallpapers_root()),
        check=False,
    )
    if completed.returncode != 0:
        raise EngineError(
            f"resolving {len(wanted)} corpus crop(s) for {head} failed: "
            f"{completed.stderr.strip()[-2000:]}"
        )
    return [Path(name) for name in json.loads(completed.stdout)]


def venv_python() -> Path:
    """That project's interpreter, where its models and their weights can be loaded."""
    root = wallpapers_root()
    for directory in CLI_DIRS:
        for name in ("python.exe", "python", "python3"):
            candidate = root / VENV_NAME / directory / name
            if candidate.is_file():
                return candidate
    raise EngineError(
        f"no interpreter under {root / VENV_NAME} — create the wallpaper project's "
        'virtualenv and `pip install -e ".[dev,models]"` into it'
    )


def judge_probabilities(
    head: str,
    pictures,
    *,
    which: str = "best",
    run: str | None = None,
    root: Path | None = None,
) -> list[dict]:
    """`P(≥2)`, `P(≥3)`, `P(≥4)` for a list of pictures, read through a trained judge.

    The pictures are paths, in order, and they are the corpus crops — the files the
    judge was scored on — not a fresh render of the same row. A figure re-renders for
    its panel and reads the verdict here, because a verdict is about the picture that
    was actually put in front of the network.

    Cached on what was asked, in this repository's own artifacts. The wallpaper
    project's committed scores are the check on this: re-reading a side it has already
    published reproduces its numbers, which is what `builder judges --verify` does.
    """
    wanted = [str(Path(picture)) for picture in pictures]
    root = Path(root) if root is not None else default_cache_root()
    key = spec_key("judge", {"head": head, "which": which, "run": run, "pictures": wanted})
    out = root / f"judged-{head}-{key}.jsonl"
    if not out.is_file():
        out.parent.mkdir(parents=True, exist_ok=True)
        ask = {"head": head, "which": which, "run": run, "pictures": wanted, "out": str(out)}
        completed = subprocess.run(
            [str(venv_python()), "-c", SCORE_PROGRAM],
            input=json.dumps(ask),
            capture_output=True,
            text=True,
            cwd=str(wallpapers_root()),
            check=False,
        )
        if completed.returncode != 0:
            raise EngineError(
                f"reading {len(wanted)} picture(s) through the {head} judge failed: "
                f"{completed.stderr.strip()[-2000:]}"
            )
        echo = json.loads(completed.stdout.strip().splitlines()[-1])
        print(
            f"  judged {echo['pictures']} picture(s) through {echo['checkpoint']} "
            f"on {echo['device']}"
        )
    return jsonl(out)


def jsonl(path: Path) -> list[dict]:
    """Every row of a JSONL file, in order."""
    with Path(path).open(encoding="utf-8") as handle:
        return [json.loads(line) for line in handle if line.strip()]


def write_jsonl(rows, path: Path) -> Path:
    """A JSONL file, written with the line ending this repository normalizes to."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="\n") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False) + "\n")
    return path


def scores(locations, *, regime: str = NODE_REGIME, root: Path | None = None) -> list[dict]:
    """The judge's estimate for each of a list of locations, cached on what was asked.

    `curate score` and `score-parity` both read a ledger; nothing in that project reads
    a list of locations until this subcommand, and a panel that prints `P(>=3)` under a
    picture needs exactly that — including for a frame the run proposed and never popped,
    which has no ledger row of its own to carry a score.

    Every returned row names the sha256 of the head that produced it and the regime it
    was read at, because heads are re-shipped and the floors that read them move with
    them. A figure that prints a score records both.
    """
    wanted = [dict(location) for location in locations]
    root = Path(root) if root is not None else default_cache_root()
    key = spec_key("score-locations", {"regime": regime, "locations": wanted})
    out = root / f"scores-{key}.jsonl"
    if not out.is_file():
        manifest = write_jsonl(wanted, root / f"scores-{key}-manifest.jsonl")
        cli("score-locations", "--manifest", manifest, "--out", out, "--regime", regime)
        print(f"  scored {len(wanted)} location(s) at {regime}")
    return jsonl(out)


def screened(locations, *, node_width: int = 384, root: Path | None = None) -> list[dict]:
    """What each structural gate read on each of these frames, and which way it went.

    The same battery `expand` spends on a proposal, run over frames somebody named. A
    gate that a refusal came before reports nothing, because it did not run.
    """
    wanted = [dict(location) for location in locations]
    root = Path(root) if root is not None else default_cache_root()
    key = spec_key("screen", {"node_width": node_width, "locations": wanted})
    out = root / f"screened-{key}.jsonl"
    if not out.is_file():
        manifest = write_jsonl(wanted, root / f"screened-{key}-manifest.jsonl")
        cli("screen", "--manifest", manifest, "--out", out, "--node-width", node_width)
        print(f"  screened {len(wanted)} frame(s) at node width {node_width}")
    return jsonl(out)


def boundary_draw(
    *,
    seed: int,
    keep: int = 12,
    family: str = "mandelbrot",
    degree: int | None = None,
    attempts: int = 4000,
    root: Path | None = None,
) -> tuple[list[dict], list[dict]]:
    """A seeded uniform draw over a family, screened: every attempt, and the survivors.

    An unscreened uniform draw plus the structural gates *is* a boundary sampler —
    nothing clears all three gates without straddling the boundary — and this is that
    subcommand. The whole draw comes back, not only the keepers, because the yield is
    the measurement the figure is about.
    """
    root = Path(root) if root is not None else default_cache_root()
    key = spec_key(
        "sample-boundary",
        {
            "seed": seed,
            "keep": keep,
            "family": family,
            "degree": degree,
            "attempts": attempts,
        },
    )
    out = root / f"boundary-{key}"
    if not (out / "draws.jsonl").is_file():
        arguments = [
            "--family",
            family,
            "--seed",
            seed,
            "--keep",
            keep,
            "--attempts",
            attempts,
            "--out-dir",
            out,
            "--no-images",
        ]
        if degree is not None:
            arguments += ["--degree", degree]
        cli("sample-boundary", *arguments)
        print(f"  drew {family} at seed {seed} until {keep} survived")
    return jsonl(out / "draws.jsonl"), jsonl(out / "kept.jsonl")


# --------------------------------------------------------- the finished-render recipe

#: The two finished-render label stores. A row in one of them is a *picture* rather than
#: a place: the family, the frame, the mode with its own settings, the curve the field is
#: read through, the map, and every knob of the palette pass, all on one line.
FINISHED_HEADS = ("smooth_render", "strange_render")

#: The one mode whose coloring is not the same on both planes, and where its address
#: opens when the pixel is z₀. The wallpaper project's verdict of 2026-08-17.
ITINERARY = "itinerary"
Z1 = "z1"

#: Which plane a family is on — the wallpaper project's `engine.DYNAMICAL_KINDS` and
#: `PARAMETER_KINDS`. `fractional_multibrot` is deliberately in neither: it is render-only
#: there and never enters a judge's corpus, so a row naming it is a row that cannot exist.
DYNAMICAL_KINDS = frozenset({"julia", "phoenix"})
PARAMETER_KINDS = frozenset({"mandelbrot", "multibrot"})


def mode_catalog() -> dict[str, dict]:
    """`{mode: its coloring}`, read out of the engine's own list.

    The catalog is the engine's, so a mode cannot mean one thing here and another there.
    `modes` answers with a JSON array and reads no spec, which is why it does not go
    through `run`.
    """
    completed = subprocess.run(
        [str(engine_binary()), "modes"],
        capture_output=True,
        text=True,
        cwd=str(wallpapers_root()),
        check=False,
    )
    if completed.returncode != 0:
        raise EngineError(f"engine modes failed: {completed.stderr.strip()}")
    return {mode["name"]: mode["coloring"] for mode in json.loads(completed.stdout)}


#: What makes two rows of a finished-render store verdicts on the *same picture*. The
#: store's own join, minus the verdict and the geometry: family, frame, mode and the whole
#: coloring recipe. Two rows agreeing on all of it are one picture judged twice.
FINISHED_IDENTITY = ("family", "viewport", "mode", "mode_params", "curve", "colormap", "recipe")


def finished_row(head: str, batch: str, line: int) -> dict:
    """One row of a finished-render label store, addressed by the file and line it is at.

    Positional for the same reason `locations.label_row` is: the stores are append-only
    tracked data, so a file and a line is a stable address.

    **And a stable address is not the same as a current verdict.** These stores are
    append-only and resolved at read time — a rating that changes is a *new row*, and the
    canonical reader takes the latest per picture over `recorded_at`, then file name, then
    line. So an address that was right when it was written can quietly become an address
    to a superseded verdict, which is how a figure comes to caption a picture with a score
    nobody holds any more. Reading one refuses in that case and names the row that
    supersedes it, rather than handing back a row whose `score` is no longer the answer.
    """
    if head not in FINISHED_HEADS:
        raise EngineError(
            f"{head!r} is not a finished-render store; the heads are {FINISHED_HEADS}"
        )
    path = data_file("data", head, "rows", f"{batch}.jsonl")
    with path.open(encoding="utf-8") as handle:
        for index, text in enumerate(handle, start=1):
            if index == line:
                row = json.loads(text)
                row["_head"], row["_batch"], row["_line"] = head, batch, line
                _refuse_if_superseded(head, row)
                return row
    raise EngineError(f"{head}/{path.name} has no line {line}")


def _refuse_if_superseded(head: str, row: dict) -> None:
    """Refuse a row some later row of the same store has already overruled."""
    wanted = json.dumps([row.get(name) for name in FINISHED_IDENTITY], sort_keys=True)
    here = (str(row.get("recorded_at")), row["_batch"], row["_line"])
    for path in sorted(data_file("data", head, "rows").glob("*.jsonl")):
        with path.open(encoding="utf-8") as handle:
            for index, text in enumerate(handle, start=1):
                if not text.strip():
                    continue
                other = json.loads(text)
                if json.dumps([other.get(name) for name in FINISHED_IDENTITY], sort_keys=True) != (
                    wanted
                ):
                    continue
                there = (str(other.get("recorded_at")), path.stem, index)
                if there > here:
                    raise EngineError(
                        f"{head}/{row['_batch']}.jsonl line {row['_line']} scores "
                        f"{row.get('score')}, and {path.stem}.jsonl line {index} is a later "
                        f"verdict on the same picture scoring {other.get('score')}. The "
                        "store resolves latest-wins, so this address is stale — pick the "
                        "later row."
                    )


def wallpaper_coloring(row: dict, catalog: dict[str, dict] | None = None) -> dict:
    """The mode's coloring with this row's curve, trap settings and plane written into it.

    A finished-render row names a mode and a curve separately, because the curve
    **replaces** the mode's own rather than composing with it — that is what the corpora
    did, and a composed curve is a picture nobody judged. So a spec built from a row does
    not name a mode to the engine: it takes the mode's coloring out of the catalog, puts
    the row's curve in it, puts the row's trap settings in it, and hands over the result
    in full.

    This mirrors `fractal_wallpapers.models.renders.coloring_of`, which is library code
    with no command-line door, and it is the only piece of that project's policy this
    repository restates. It is held to the original by rendering a row at its own geometry
    and comparing the picture against the corpus crop the judge was trained on — see
    `scratch/verify_wallpaper_recipe.py` and the provenance of `locations-style-spectrum`.
    """
    known = catalog if catalog is not None else mode_catalog()
    mode = row["mode"]
    if mode not in known:
        raise EngineError(f"the engine has no mode named {mode!r}")
    coloring = json.loads(json.dumps(known[mode]))
    settings = dict(row.get("mode_params") or {})
    _open_the_address(coloring, row["family"])
    if coloring["kind"] == "field":
        coloring["transform"] = row["curve"]
    elif coloring["kind"] in ("composite", "modulate"):
        coloring["base"]["transform"] = row["curve"]
    elif coloring["kind"] == "direct":
        # No curve here, and that is what the corpora did: a direct trap has no field, so
        # its colour key is how near the orbit came and the gradient is sampled at that
        # key untouched.
        for name, value in settings.items():
            if name not in ("opacity", "threshold"):
                raise EngineError(f"{mode}: no setting named {name!r}")
            coloring[name] = value
        settings = {}
    if settings:
        raise EngineError(f"{mode} takes no settings, and this row carries {settings}")
    return coloring


def _open_the_address(coloring: dict, family: dict) -> dict:
    """Where an `itinerary` address opens on this row's plane, written in explicitly.

    On a dynamical plane the z₀ address spells its leading symbol from the pixel's own
    angular sector, which draws a hard wedge seam along the axes; z₁ opens the address one
    step in. On a parameter plane z₀ = 0 for every pixel and the engine refuses `z1`.
    """
    kind = (family or {}).get("kind")
    if kind not in DYNAMICAL_KINDS and kind not in PARAMETER_KINDS:
        raise EngineError(f"family kind {kind!r} is not one a finished-render row carries")
    if kind not in DYNAMICAL_KINDS:
        return coloring
    for field in _coloring_fields(coloring):
        if field.get("kind") == ITINERARY:
            field["start"] = Z1
    return coloring


def _coloring_fields(coloring: dict) -> list[dict]:
    """Every field a coloring reads. A direct trap makes none."""
    if coloring["kind"] == "field":
        return [coloring["field"]]
    if coloring["kind"] in ("composite", "modulate"):
        return [coloring["base"]["field"], coloring["texture"]["field"]]
    return []


def wallpaper_spec(
    row: dict,
    *,
    resolution,
    supersample: int,
    catalog: dict[str, dict] | None = None,
) -> dict:
    """The engine spec for one finished-render row, at whatever geometry is asked for.

    Everything but the geometry comes off the row, so the picture is the one that was
    judged; the geometry is the caller's, and has no default here because there is no
    right one — a figure panel and a wallpaper want different sizes of the same picture.
    The cap comes off the row: it is a policy on the frame's *width* and not on how many
    pixels the frame is drawn into, so the same cap at a bigger size is the same picture
    with more of it resolved.
    """
    return {
        "schema": 1,
        "family": row["family"],
        "viewport": row["viewport"],
        "resolution": [int(resolution[0]), int(resolution[1])],
        "supersample": int(supersample),
        "maxiter": int(row["render"]["maxiter"]),
        "coloring": wallpaper_coloring(row, catalog),
        "palette": {
            key: row["recipe"][key]
            for key in ("gamma", "cycles", "phase", "reverse", "mirror", "transfer", "rolloff")
        },
        "colormap": row["colormap"],
    }
