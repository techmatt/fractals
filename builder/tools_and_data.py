"""The two data files the Tools and data page offers, rebuilt from their records.

    python -m builder tools-and-data

*(tools_and_data_ckpt156.)* The page, `tools-and-data/index.html`, hangs off the site the
way Wallpaper packs does and is hand-written from its master. What it links to is data, and
data a reader downloads has to be something this repository can make again, so both files
are written here and nowhere else:

- **`gallery-locations.jsonl`**, one JSON object a line for every seat of the Gallery tab's
  union record — every picture any collection seats, once. The rows are the committed
  `all.jsonl` of `seated-candidates` joined to three reads next door: the recipe out of the
  candidate ledger (one streamed pass, `picks.ledger_rows`), the wallpaper judge's `p_ge4`
  out of each collection's tentative record, and the gallery judge's `p_fine` out of its
  pool scores. Matt ruled on 2026-09-29 that publishing the recipes is fine.
- **`hand-made-palettes.json`**, the palettes whose library `source` is `authored`, with
  their color stops as the library next door stores them. Converted and extracted maps stay
  out: they are other people's work.

**The tone curve comes off the link, not off a second read.** Every seat's permalink was
emitted by the contract from the curve its run recorded (`seats.tone`), and `level` spells
all five numbers, so the link already is the record of it; a seat whose link carries no
`level` was drawn with no curve. A seat whose curve was lost would have a `gap` saying so,
and that case is refused here rather than written as `null`.

Nothing here is part of `build` or `check`: it needs the wallpapers checkout for all three
reads. It is rerun after `seats` re-lands the gallery, or when the library changes.
"""

from __future__ import annotations

import json
from pathlib import Path
from urllib.parse import parse_qsl

from . import palettes, picks, renders, seats
from .pages import SITE_URL
from .paths import SITE_ROOT

#: Where the page and its two files live.
DIRECTORY = SITE_ROOT / "tools-and-data"
LOCATIONS = DIRECTORY / "gallery-locations.jsonl"
PALETTES = DIRECTORY / "hand-made-palettes.json"

#: The gallery judge's score for every candidate it read: the averaged ensemble's P(>=4),
#: which the solve calls `p_fine`. The same store `pipeline._fine_scores` reads.
FINE_SCORES = ("gallery_grade_head", "pool_scores.jsonl")

#: Where the explorer is served, which is what a link in a downloaded file has to name.
EXPLORER_URL = f"{SITE_URL}explorer/"

#: The level key's own spelling in a link: `<operator>:<black>,<white>,<exponent>,<lo>,<hi>`.
LEVEL_KEY = seats.LEVEL_KEY

#: What the palettes file says about itself, at its head.
PALETTES_ABOUT = (
    "The palettes Matt Fisher made for the fractal wallpapers project "
    "(https://techmatt.github.io/fractals/tools-and-data/). Each palette is cyclic: its "
    "stops run from position 0 to position 1 and the color at 1 is the color at 0. "
    "`stops` lists the colors as sRGB hex, evenly spaced, so stop i of n sits at position "
    "i / (n - 1); a renderer interpolates between neighbors. Released under CC0 1.0."
)
PALETTES_LICENSE = "CC0-1.0"

#: `.gitattributes` normalizes this repository to LF, and `Path.write_text` on Windows
#: would translate a newline back to CRLF.
LF = "\n"


class ToolsDataError(RuntimeError):
    """A record does not answer the question a data file asks of it."""


# ------------------------------------------------------------------ gallery locations


def _level(link: str) -> dict | None:
    """The tone curve a link spells, or `None` where it spells none."""
    spelled = dict(parse_qsl(link, keep_blank_values=True)).get(LEVEL_KEY)
    if spelled is None:
        return None
    operator, _, numbers = spelled.rpartition(":")
    values = [float(value) for value in numbers.split(",")]
    if not operator or len(values) != 5:
        raise ToolsDataError(f"a level of {spelled!r} is not an operator and five numbers")
    black, white, exponent, low, high = values
    return {
        "operator": operator,
        "black_point": black,
        "white_point": white,
        "exponent": exponent,
        "output_range": [low, high],
    }


def _wallpaper_scores() -> dict[str, float | None]:
    """The wallpaper judge's `p_ge4` for every seat, off every collection's own record.

    Every record that seats a key scored it off the same store, so they have to agree;
    a disagreement is refused rather than resolved by picking one.
    """
    found: dict[str, float | None] = {}
    for name, stamp in seats.COLLECTIONS:
        for seat in seats.seat_rows(stamp):
            key = str(seat["key"])
            score = seat.get("p_ge4")
            score = None if score is None else float(score)
            if key in found and found[key] != score:
                raise ToolsDataError(
                    f"{key}: the {name} record scores it {score}, another record {found[key]}"
                )
            found[key] = score
    return found


def _fine_scores(keys: set[str]) -> dict[str, float]:
    """The gallery judge's `p_fine` for the keys asked for, where it read them."""
    path = renders.artifact(*FINE_SCORES)
    if not path.is_file():
        raise ToolsDataError(f"no gallery judge scores at {path}")
    found: dict[str, float] = {}
    with path.open(encoding="utf-8") as handle:
        for line in handle:
            if line.strip():
                row = json.loads(line)
                if str(row["key"]) in keys:
                    found[str(row["key"])] = float(row["p_ge4"])
    return found


def _collections(places: dict[str, int]) -> list[str]:
    """The collections that seat a picture, in the order the Gallery tab lists them.

    `all` is the union itself, so every row would carry it and it says nothing.
    """
    return [name for name in seats.offered() if name in places and name != seats.ALL]


def location_rows() -> list[dict]:
    """One row per seat of the union record, in its order."""
    path = seats.directory() / seats.collection_file(seats.ALL)
    seated = [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line]
    keys = [str(row["key"]) for row in seated]
    ledger = picks.ledger_rows(keys)
    missing = [key for key in keys if key not in ledger]
    if missing:
        raise ToolsDataError(f"{len(missing)} seats not in the candidate ledger: {missing[:5]}")
    wallpaper = _wallpaper_scores()
    fine = _fine_scores(set(keys))

    rows = []
    for row in seated:
        key = str(row["key"])
        recipe = ledger[key]["recipe"]
        if row.get("gap") and "tone" in str(row["gap"]):
            raise ToolsDataError(f"{key}: its tone curve is not on its link — {row['gap']}")
        if recipe.get("colormap") != row["palette"]:
            raise ToolsDataError(f"{key}: the ledger's map is not the gallery record's")
        viewport = recipe["viewport"]
        written = {
            "key": key,
            "family": recipe["family"],
            "center": {"re": viewport["center_re"], "im": viewport["center_im"]},
            "width": viewport["width"],
            "iteration_cap": int(recipe["maxiter"]),
            "mode": str(recipe["mode"]),
            "mode_params": recipe.get("mode_params") or {},
            "mode_curve": str(recipe.get("curve") or "linear"),
            "palette": str(recipe["colormap"]),
            "palette_settings": recipe["palette"],
            "tone_curve": _level(row["link"]),
            "collections": _collections(row["collections"]),
            "wallpaper_judge_p_ge4": wallpaper.get(key),
            "gallery_judge_p_fine": fine.get(key),
            "explorer_link": f"{EXPLORER_URL}?{row['link']}",
        }
        if row.get("gap"):
            written["link_differs_by"] = row["gap"]
        rows.append(written)
    return rows


# ------------------------------------------------------------------ hand-made palettes


def _hex(rgb) -> str:
    red, green, blue = (int(channel) for channel in rgb)
    return f"#{red:02x}{green:02x}{blue:02x}"


def palette_file() -> dict:
    """The authored palettes, by name, each as its evenly spaced stops."""
    authored = [held.name for held in palettes.held_library() if held.source == palettes.AUTHORED]
    directory = renders.data_file(*palettes.LIBRARY)
    stored = {}
    for path in sorted(directory.glob("*.json")):
        loaded = json.loads(path.read_text(encoding="utf-8"))
        stored[str(loaded["name"])] = loaded
    written = []
    for name in sorted(authored, key=lambda name: (name.casefold(), name)):
        loaded = stored.get(name)
        if loaded is None:
            raise ToolsDataError(f"{name}: in the library record and not next door")
        if loaded.get("kind") != "cyclic":
            raise ToolsDataError(f"{name}: an authored map that is not cyclic")
        stops = loaded["stops"]
        last = len(stops) - 1
        if any(abs(float(at) - index / last) > 1e-9 for index, (at, _) in enumerate(stops)):
            raise ToolsDataError(f"{name}: its stops are not evenly spaced")
        written.append({"name": name, "stops": [_hex(rgb) for _, rgb in stops]})
    return {"about": PALETTES_ABOUT, "license": PALETTES_LICENSE, "palettes": written}


# ------------------------------------------------------------------------ the landing


def write() -> list[str]:
    """Rewrite both files; say what each holds."""
    DIRECTORY.mkdir(parents=True, exist_ok=True)
    rows = location_rows()
    with LOCATIONS.open("w", encoding="utf-8", newline=LF) as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False) + LF)
    held = palette_file()
    with PALETTES.open("w", encoding="utf-8", newline=LF) as handle:
        handle.write(_palette_text(held))
    return [
        f"{_shown(LOCATIONS)}: {len(rows):,} seats, {LOCATIONS.stat().st_size:,} bytes",
        f"{_shown(PALETTES)}: {len(held['palettes'])} palettes, {PALETTES.stat().st_size:,} bytes",
    ]


def _palette_text(held: dict) -> str:
    """The palettes file as JSON with one palette a line, so a reader can scan the names."""
    lines = [
        "{",
        f' "about": {json.dumps(held["about"], ensure_ascii=False)},',
        f' "license": {json.dumps(held["license"])},',
        ' "palettes": [',
    ]
    entries = [json.dumps(one, ensure_ascii=False) for one in held["palettes"]]
    lines += [f"  {entry}," for entry in entries[:-1]] + [f"  {entries[-1]}"]
    lines += [" ]", "}"]
    text = LF.join(lines) + LF
    if json.loads(text) != held:
        raise ToolsDataError("the palettes file does not read back as what was written")
    return text


def _shown(path: Path) -> str:
    return path.relative_to(SITE_ROOT).as_posix()
