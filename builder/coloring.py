"""The site's wallpaper coloring held to the wallpaper project's own, seat for seat.

`renders.wallpaper_coloring` is a copy of `fractal_wallpapers.engine_spec.coloring_of`:
library code next door with no command-line door, restated here because a figure drawn
from a finished-render row has to hand the engine the same coloring that project would.
A copy drifts, and this one has: the composite's `texture_weight` branch was missing here
until *start_here_followups_ckpt146*, and every screened recipe that carried its own
weight was refused on this side while every check stayed green.

So the `coloring` check asks both functions about every seat recipe the committed
collection records name — the `seated-candidates` header's collections, each seat
resolved through `picks.resolve` exactly as a figure resolves one — and holds the two
answers equal dict for dict. A refusal is an answer: where both sides refuse a recipe
they agree, and where one refuses and the other does not, that is the drift. Needs the
wallpapers checkout, for the ledger the recipes come out of and for the interpreter
`coloring_of` runs in, and is a named skip without it. About 15 s, most of it the
resolve.
"""

from __future__ import annotations

import json

from . import picks, renders, seats
from .paths import GALLERY_IMAGES_DIR, GALLERY_METADATA_NAME

#: The program next door: `coloring_of` for every recipe it is sent, or the refusal.
PROGRAM = """
import json, sys

from fractal_wallpapers.engine_spec import coloring_of

answers = {}
for key, row in json.load(sys.stdin)["rows"].items():
    try:
        answers[key] = {"coloring": coloring_of(row)}
    except Exception as error:
        answers[key] = {"refused": f"{type(error).__name__}: {error}"}
print(json.dumps(answers))
"""

#: How many disagreeing seats are spelled out. A drift in a branch reaches every seat of
#: that kind, hundreds of them, and the first few say what the rest would.
SHOWN = 10


def seat_identifiers() -> dict[str, str]:
    """`{recipe key: pick identifier}` for every seat of every committed collection.

    A seat several collections share is asked about once, under the first collection's
    stamp: its recipe is the ledger's and does not depend on which solve seated it.
    """
    gallery = GALLERY_IMAGES_DIR / seats.SLUG
    header_line = (gallery / GALLERY_METADATA_NAME).read_text(encoding="utf-8").split("\n")[0]
    header = json.loads(header_line)
    found: dict[str, str] = {}
    for collection in header["collections"]:
        for line in (gallery / collection["file"]).read_text(encoding="utf-8").split("\n"):
            if line.strip():
                key = json.loads(line)["key"]
                found.setdefault(key, f"{collection['stamp']}{picks.PICK_SEPARATOR}{key}")
    return found


def problems() -> list[str]:
    """Every seat whose coloring this side and next door's `coloring_of` disagree on."""
    resolved = picks.resolve(seat_identifiers().values())
    catalog = renders.mode_catalog()
    ours: dict[str, dict] = {}
    for pick in resolved:
        try:
            ours[pick.key] = {"coloring": renders.wallpaper_coloring(pick.recipe, catalog)}
        except renders.EngineError as error:
            ours[pick.key] = {"refused": str(error)}
    theirs = seats._program(
        PROGRAM,
        "asking engine_spec.coloring_of for every seat's coloring",
        ask={"rows": {pick.key: pick.recipe for pick in resolved}},
    )

    found = []
    for pick in resolved:
        here, there = ours[pick.key], theirs[pick.key]
        if "refused" in here and "refused" in there:
            continue
        if "refused" in here:
            found.append(
                f"seat {pick.key} ({pick.recipe['mode']}): wallpaper_coloring refuses it "
                f"({here['refused']}) and coloring_of draws it"
            )
        elif "refused" in there:
            found.append(
                f"seat {pick.key} ({pick.recipe['mode']}): coloring_of refuses it "
                f"({there['refused']}) and wallpaper_coloring draws it"
            )
        elif here["coloring"] != there["coloring"]:
            found.append(
                f"seat {pick.key} ({pick.recipe['mode']}): wallpaper_coloring gives "
                f"{json.dumps(here['coloring'], sort_keys=True)} and coloring_of gives "
                f"{json.dumps(there['coloring'], sort_keys=True)}"
            )
    if len(found) > SHOWN:
        found[SHOWN:] = [f"and {len(found) - SHOWN} more seat(s) the same way or otherwise"]
    return found
