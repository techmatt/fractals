"""The Deep tab's Random dives: landings of the Dive block's mixture, recorded and tiled.

    python -m builder random-dives [--until N] [--budget-s S] [--seed N]

*(random_dives_ckpt155.)* A dive here is a unit of `python -m builder dive-candidates`
(`builder/dive_candidates.py`), run the same way with three differences: **every landing
takes New coloring**, as the page's does on arrival, **with the page's aliasing guard**
(`explorer/aliasing.js`) laid over the field before its period is written; the picture is
drawn at the **Deep gallery's tile**, 316 by 178 at 2x2 samples a pixel, rather than the
candidate sheet's 640 by 360; and **a frame already recorded is refused** before it is drawn,
as is a link already recorded, so no dive appears twice. The mixture — which plane, where the
search starts, where the last press lands, how many rungs go down first, and how a route that
stops landing gives its weight away — is the candidate generator's, unchanged, and so is the
rule that lands only on a true copy (`nuclei::classify`, read by `pick`): an unresolved
nucleus is never landed on.

What is tracked is the record, `explorer/random-dives.jsonl`, one `{"link"}` a dive and
nothing a link already says, and a tile a row in `explorer/random-dives/`, named by the
64-bit FNV-1a of its link exactly as the Deep gallery's are (`deep_gallery.fnv`,
`deep-gallery.js`'s `tileName`). No full-size picture is stored: a tile opens its link, and
the Deep tab draws the frame. What is not tracked is the run's log, under ignored
`artifacts/random-dives/`: `units.jsonl` (every unit, kept or dropped, with the route that
made it — the provenance of each row), `heartbeat.log`, and the candidate sheet's
`index.html` of what was kept.

**The command is rerunnable, and resumes.** A run counts the rows already recorded towards
`--until`, draws past the units its log holds, and refuses every frame and link the record
names; a tile no row names — a run stopped between the two writes — is removed on the way
in. It stops at `--until`, at its budget, at `dive-candidates`' five errors in a row, or when
`DRY` units in a row have kept nothing, which is the mixture running out of new frames.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from urllib.parse import parse_qsl

from . import images
from .deep_gallery import THUMB, fnv
from .dive_candidates import (
    DEFAULT_SEED,
    DiveCandidatesError,
    Run,
    below_normal,
    read_units,
    sheet,
)
from .paths import SITE_ROOT

RECORD = SITE_ROOT / "explorer" / "random-dives.jsonl"
TILES = SITE_ROOT / "explorer" / "random-dives"
LOG_DIR = SITE_ROOT / "artifacts" / "random-dives"
DEFAULT_UNTIL = 1000
#: Long enough never to be what stops a run to 1,000; `--until` is.
DEFAULT_BUDGET_S = 12 * 3600
#: Units in a row that keep nothing before a run calls the mixture dry.
DRY = 300
LF = "\n"


class RandomDivesError(DiveCandidatesError):
    """The record refused: a row that is not a deep link alone, or a link twice."""


def records() -> list[dict]:
    """The record's rows, each `{link}` and nothing else, no link twice."""
    if not RECORD.exists():
        return []
    rows = []
    seen = set()
    for number, line in enumerate(RECORD.read_text(encoding="utf-8").splitlines(), 1):
        if not line.strip():
            continue
        row = json.loads(line)
        if set(row) != {"link"} or not str(row["link"]).startswith("dv="):
            raise RandomDivesError(f"{RECORD.name} line {number}: a row is a deep link alone")
        if row["link"] in seen:
            raise RandomDivesError(f"{RECORD.name} line {number}: a link recorded twice")
        seen.add(row["link"])
        rows.append(row)
    return rows


def tile_name(link: str) -> str:
    return f"{fnv(link)}.webp"


def frame_key(link: str) -> tuple[str, str, str]:
    """Where a dive is: its plane and its centre. Two dives here are one place to a reader,
    whatever width or colour either is drawn at."""
    keys = dict(parse_qsl(link, keep_blank_values=True))
    return (keys.get("f", "mandelbrot"), keys["x"], keys["y"])


class RandomDives(Run):
    def __init__(self, until: int, budget_s: float, seed: int, port: int):
        self.until = until
        self.rows = records()
        self.links = {row["link"] for row in self.rows}
        self.frames = {frame_key(row["link"]) for row in self.rows}
        self.dry = 0
        LOG_DIR.mkdir(parents=True, exist_ok=True)
        logged = len(read_units(LOG_DIR / "units.jsonl"))
        # A lost log would otherwise draw the same choices again from the top; every one of
        # them would be refused as a repeat, and the run would spend its time finding that out.
        super().__init__(
            LOG_DIR,
            budget_s,
            seed + (len(self.rows) if logged == 0 else 0),
            port,
            True,
            res=(THUMB["width"], THUMB["height"]),
            ss=THUMB["supersample"],
            always_new=True,
            guard=True,
        )
        self.tiles = TILES

    def kept_before(self, before):
        return len(self.rows)

    def refuse(self, record, frame):
        plane = record["plane"]
        if (plane, *_spelled(frame)) in self.frames:
            return "repeat"
        return None

    def finished(self):
        if self.kept >= self.until:
            return f"{self.kept} recorded, at --until {self.until}"
        if self.dry >= DRY:
            return f"{self.dry} units in a row kept nothing: the mixture is dry"
        return None

    def keep(self, record, image, uid):
        link = record["link"]
        if link in self.links or frame_key(link) in self.frames:
            record["dropped"] = self.drop("repeat")
            return False
        self.tiles.mkdir(parents=True, exist_ok=True)
        target = self.tiles / tile_name(link)
        images.write_rgba(
            image.convert("RGBA").tobytes(),
            image.size,
            target,
            webp_quality=images.TILE_WEBP_QUALITY,
        )
        with RECORD.open("a", encoding="utf-8", newline=LF) as f:
            f.write(json.dumps({"link": link}) + LF)
        self.links.add(link)
        self.frames.add(frame_key(link))
        record["tile"] = Path(os.path.relpath(target, self.out)).as_posix()
        return True

    def finish(self, record, route, started, landed):
        self.dry = 0 if landed else self.dry + 1
        return super().finish(record, route, started, landed)


def _spelled(frame: dict) -> tuple[str, str]:
    """A landed frame's centre as its link spells it: `deep-fx` trims trailing zeros."""
    out = []
    for text in (frame["re"], frame["im"]):
        if "." in text:
            text = text.rstrip("0").rstrip(".")
        out.append(text)
    return out[0], out[1]


def orphans() -> list[str]:
    """Tiles no row names, removed: what a run stopped between its two writes leaves."""
    if not TILES.is_dir():
        return []
    named = {tile_name(row["link"]) for row in records()}
    said = []
    for path in sorted(TILES.iterdir()):
        if path.name not in named:
            path.unlink()
            said.append(f"removed {path.name}, which no row names")
    return said


def main(options) -> list[str]:
    """`python -m builder random-dives`: land dives until the record holds `--until`."""
    lines = orphans()
    run = RandomDives(options.until, options.budget_s, options.seed, options.port)
    if run.kept >= options.until:
        return [*lines, f"{run.kept} recorded already, at or past --until {options.until}"]
    below_normal()
    run.run()
    total = sum(path.stat().st_size for path in TILES.iterdir()) if TILES.is_dir() else 0
    lines.append(
        f"{run.kept} recorded in {RECORD.relative_to(SITE_ROOT).as_posix()}, "
        f"{total:,} bytes of tiles; this run {run.unit - run.resumed} units"
    )
    lines.append(f"wrote {sheet(LOG_DIR, options.port)}")
    return lines


__all__ = ["DEFAULT_SEED", "DEFAULT_UNTIL", "DEFAULT_BUDGET_S", "RandomDivesError", "main"]
