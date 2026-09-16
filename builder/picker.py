"""What the explorer's palette picker reads beside the baked index: Popular, and names.

Two committed records, both under `explorer/`, and both written from here:

* **`popular.json`** — the maps the picker's Popular tab lists, in order. It used to be
  the top twenty by seat count, taken straight off the index, and the pool's favourites
  look alike: that list carried four cream, gold and green ramps. So the list is now a
  *curated* top 24, and the curation is a rule rather than a taste. Maps are ranked by
  `seats` — how many seats of the published record were drawn in each — and taken
  greedily. A candidate is skipped when too much of its colour is already on the list,
  or when its hue family already holds `FAMILY_CAP` places.
* **`palette-names.json`** — `{underlying: display}` for every map the explorer carries.
  The underlying name is an address — it is what a link, a download filename and every
  record spell — and a great many of them are codes: `wallhaven_wallhaven-1joljg`,
  `cmr.gothic`, `RdPu`. The display name is what a reader is shown.

## What "too much of its colour" means

Read off the wallpaper project's carrier record, `carriers.jsonl`: for each map, the
codebook cells it comes out dominant in on three reference fields, with each cell's mean
share (`palettes.carriers` derives that mean). The cells are pooled onto the **hue family**
each row names, and two maps overlap by the share of the *smaller* map's pooled colour that
the other map carries too — the sum over families of the lesser share, over the lesser
total. A candidate that overlaps any map already taken by `OVERLAP` or more is skipped.

Pooled onto families, not compared cell by cell, because the cells split a colour by tone
and chroma: the three cream-and-gold ramps that crowded the old list lead with three
different cells of one family, and a cell-level overlap reads them as strangers. Over the
lesser total, not the union, because a map whose carrier rows are thin — most of its
picture neutral — is still exactly as much *of* its colour as its rows say.
`OVERLAP = 0.7` is where that list came apart without cutting maps that merely share one
colour: at 0.6 the list reaches down to maps seated twice, and at 0.8 three of the four
cream, gold and green ramps survive. The family cap is on `family`, the reading
the picker's own tabs are built from, so "three to a tab" is what a reader can see.

## How a display name is chosen

**A name that already reads as one is kept.** Words in Title Case, joined by spaces and
the odd comma, connective or ampersand — `Pale Fire Rose`, `Copper Bloom, Teal Fleck`,
`Y2K Bubblegum` — with no underscore, no dot and no trailing number. The library's authored
maps are named that way on purpose, so a name of four such words is kept too: it is not a
code, and renaming it would be replacing somebody's name with a generated one.

**Everything else gets two words:** a colour word, then a material or an object —
`Cobalt Harbor`, `Ivory Ember`. The colour word comes from the map's **dominant** cell and
the material from its **secondary** one: the largest cell of a *different* hue family, or
of the other neutral kind, so the two words name two colours whenever the map has two.
Both are read from the codebook's ramp census, `codebook.of_ramp` next door, over the
gradient a render of the map really spends — the carrier record is chromatic only, and a
name has to be able to say *ivory* and *coal*.

**Unique, and stable.** Maps are named in seat order, so the most seated maps get the
first word of each list. A name already taken — by a kept name or an earlier generated one —
moves to the next pair. And **an entry already in the file is never rewritten**: the
generator fills missing entries only, so a name Matt authors by hand stays his, and the
next map the library grows gets a name without renaming the thousand before it.

American spelling throughout, and nothing on the site's banned lists: the vocabulary is
typed below, and `builder check`'s `vocabulary` sweep reads the committed file.
"""

from __future__ import annotations

import json
import re
import subprocess
from collections import Counter
from pathlib import Path

from . import explorer, palettes, renders

POPULAR_RECORD = explorer.EXPLORER_DIR / "popular.json"
NAMES_RECORD = explorer.EXPLORER_DIR / "palette-names.json"

#: How many maps the Popular tab holds.
POPULAR_SIZE = 24

#: A candidate overlapping a taken map by this much of its pooled carrier colour is skipped.
OVERLAP = 0.7

#: At most this many Popular places to one hue family, as `palettes.jsonl` files it.
FAMILY_CAP = 3

#: `.gitattributes` normalizes this repository to LF; anything written here spells it.
LF = "\n"


class PickerError(RuntimeError):
    """A picker record cannot be written or read as it stands."""


# --------------------------------------------------------------------------- popular


def pooled_carriers() -> dict[str, dict[str, float]]:
    """Every map's carrier shares, pooled onto the hue family each carrier row names."""
    pooled: dict[str, dict[str, float]] = {}
    for row in palettes.carriers():
        mine = pooled.setdefault(str(row["map"]), {})
        family = str(row["family"])
        mine[family] = mine.get(family, 0.0) + float(row["mean"])
    return pooled


def overlap(one: dict[str, float], other: dict[str, float]) -> float:
    """How much of the smaller map's pooled colour the other carries too, 0 to 1."""
    lesser = min(sum(one.values()), sum(other.values()))
    if lesser <= 0:
        return 0.0
    shared = sum(min(one[family], other[family]) for family in one.keys() & other.keys())
    return shared / lesser


def popular() -> dict:
    """The Popular list and the reason each passed-over map was passed over."""
    head, entries = explorer.roster()
    pooled = pooled_carriers()
    ranked = sorted(entries, key=lambda entry: (-entry.seats, entry.name))
    taken: list[explorer.Entry] = []
    held: Counter[str] = Counter()
    skipped = []
    for entry in ranked:
        if len(taken) == POPULAR_SIZE:
            break
        mine = pooled.get(entry.name, {})
        worst = max(
            ((overlap(mine, pooled.get(other.name, {})), other.name) for other in taken),
            default=(0.0, ""),
        )
        if worst[0] >= OVERLAP:
            why = f"overlaps {worst[1]} by {worst[0]:.2f}"
        elif entry.family is not None and held[entry.family] >= FAMILY_CAP:
            why = f"{entry.family} already holds {FAMILY_CAP}"
        else:
            taken.append(entry)
            if entry.family is not None:
                held[entry.family] += 1
            continue
        skipped.append({"name": entry.name, "seats": entry.seats, "why": why})
    if len(taken) < POPULAR_SIZE:
        raise PickerError(f"only {len(taken)} maps pass the Popular rule, not {POPULAR_SIZE}")
    return {
        "schema": 1,
        "release": head.get("release"),
        "rule": (
            "the maps ranked by seats in the release named here, ties by name, taken greedily: "
            f"a map is skipped when it overlaps one already taken by {OVERLAP} or more — the "
            "share of the smaller map's carrier colour, pooled onto hue families, that the "
            f"other carries too — or when its family already holds {FAMILY_CAP}. Written by "
            "`python -m builder explorer --popular`; see builder/picker.py."
        ),
        "overlap": OVERLAP,
        "family_cap": FAMILY_CAP,
        "maps": [entry.name for entry in taken],
        "skipped": skipped,
    }


def write_popular() -> tuple[Path, dict]:
    """Write `popular.json` from the roster and the carrier record."""
    made = popular()
    _write_json(POPULAR_RECORD, made)
    return POPULAR_RECORD, made


def load_popular() -> dict:
    """The committed Popular record."""
    return json.loads(POPULAR_RECORD.read_text(encoding="utf-8"))


# --------------------------------------------------------------------------- names

#: Short joining words a Title Case name may carry in lower case.
CONNECTIVES = frozenset(
    {
        "a", "an", "and", "at", "by", "for", "from", "in", "into", "of", "on", "over",
        "the", "to", "under", "with", "without", "against", "through", "&",
    }
)  # fmt: skip

#: The first word of a generated name: a colour or a light word per codebook cell, best
#: first. Tone is the codebook's own `dark`/`light` at Oklab lightness 0.40/0.75.
COLOUR_WORDS: dict[str, tuple[str, ...]] = {
    "dark_vivid_rose": ("Raspberry", "Cerise", "Garnet"),
    "dark_muted_rose": ("Mauve", "Heather", "Rosewood"),
    "light_vivid_rose": ("Pink", "Flamingo", "Peony"),
    "light_muted_rose": ("Blush", "Petal", "Shell"),
    "dark_vivid_red": ("Crimson", "Scarlet", "Cardinal"),
    "dark_muted_red": ("Oxblood", "Maroon", "Brick"),
    "light_vivid_red": ("Coral", "Vermilion", "Salmon"),
    "light_muted_red": ("Clay", "Terracotta", "Rosehip"),
    "dark_vivid_orange": ("Copper", "Rust", "Paprika"),
    "dark_muted_orange": ("Umber", "Sienna", "Cocoa"),
    "light_vivid_orange": ("Amber", "Tangerine", "Saffron"),
    "light_muted_orange": ("Peach", "Sand", "Apricot"),
    "dark_vivid_yellow": ("Ochre", "Mustard", "Brass"),
    "dark_muted_yellow": ("Olive", "Khaki", "Bronze"),
    "light_vivid_yellow": ("Gold", "Honey", "Lemon"),
    "light_muted_yellow": ("Cream", "Straw", "Wheat"),
    "dark_vivid_lime": ("Moss", "Fern", "Avocado"),
    "dark_muted_lime": ("Lichen", "Loden", "Bracken"),
    "light_vivid_lime": ("Chartreuse", "Lime", "Citron"),
    "light_muted_lime": ("Pistachio", "Celery", "Pear"),
    "dark_vivid_green": ("Emerald", "Forest", "Clover"),
    "dark_muted_green": ("Pine", "Spruce", "Hunter"),
    "light_vivid_green": ("Mint", "Spring", "Leaf"),
    "light_muted_green": ("Sage", "Celadon", "Willow"),
    "dark_vivid_teal": ("Teal", "Petrol", "Lagoon"),
    "dark_muted_teal": ("Verdigris", "Juniper", "Balsam"),
    "light_vivid_teal": ("Turquoise", "Aqua", "Jade"),
    "light_muted_teal": ("Seafoam", "Eucalyptus", "Patina"),
    "dark_vivid_cyan": ("Cyan", "Peacock", "Kingfisher"),
    "dark_muted_cyan": ("Storm", "Squall", "Lake"),
    "light_vivid_cyan": ("Aquamarine", "Surf", "Lagoon"),
    "light_muted_cyan": ("Rain", "Spray", "Frost"),
    "dark_vivid_azure": ("Azure", "Cerulean", "Marine"),
    "dark_muted_azure": ("Denim", "Steel", "Harbor"),
    "light_vivid_azure": ("Sky", "Cornflower", "Delphinium"),
    "light_muted_azure": ("Powder", "Haze", "Ice"),
    "dark_vivid_blue": ("Cobalt", "Sapphire", "Ultramarine"),
    "dark_muted_blue": ("Indigo", "Navy", "Ink"),
    "light_vivid_blue": ("Periwinkle", "Bluebell", "Hyacinth"),
    "light_muted_blue": ("Lavender", "Twilight", "Dusk"),
    "dark_vivid_purple": ("Violet", "Amethyst", "Royal"),
    "dark_muted_purple": ("Plum", "Aubergine", "Grape"),
    "light_vivid_purple": ("Lilac", "Iris", "Crocus"),
    "light_muted_purple": ("Wisteria", "Thistle", "Heather"),
    "dark_vivid_magenta": ("Magenta", "Fuchsia", "Berry"),
    "dark_muted_magenta": ("Wine", "Mulberry", "Bordeaux"),
    "light_vivid_magenta": ("Orchid", "Candy", "Bougainvillea"),
    "light_muted_magenta": ("Mallow", "Rosebay", "Foxglove"),
    "black": ("Jet", "Onyx", "Ebony", "Sable"),
    "dark_gray": ("Slate", "Graphite", "Smoke", "Pewter"),
    "light_gray": ("Silver", "Ash", "Dove", "Mist"),
    "white": ("Ivory", "Pearl", "Snow", "Chalk"),
}

#: The second word: a material or an object whose colour is the secondary cell's, by hue
#: family and tone. The neutrals split by kind rather than by tone.
MATERIALS: dict[str, tuple[str, ...]] = {
    "dark_rose": ("Velvet", "Rosewood", "Garnet", "Dahlia"),
    "light_rose": ("Petal", "Blossom", "Quartz", "Sorbet"),
    "dark_red": ("Ruby", "Brick", "Cinder", "Lacquer"),
    "light_red": ("Poppy", "Coral", "Clay", "Hibiscus"),
    "dark_orange": ("Kiln", "Copper", "Rust", "Hearth"),
    "light_orange": ("Ember", "Lantern", "Flame", "Marigold"),
    "dark_yellow": ("Brass", "Bronze", "Ochre", "Tallow"),
    "light_yellow": ("Gold", "Honey", "Candle", "Sunlight"),
    "dark_lime": ("Moss", "Olive", "Lichen", "Bracken"),
    "light_lime": ("Meadow", "Citron", "Pear", "Sprout"),
    "dark_green": ("Fern", "Pine", "Malachite", "Ivy"),
    "light_green": ("Jade", "Mint", "Clover", "Willow"),
    "dark_teal": ("Verdigris", "Patina", "Lagoon", "Kelp"),
    "light_teal": ("Seaglass", "Tide", "Shoal", "Reef"),
    "dark_cyan": ("Harbor", "Current", "Fjord", "Depths"),
    "light_cyan": ("Glacier", "Surf", "Spray", "Stream"),
    "dark_azure": ("Sea", "Denim", "Deep", "Channel"),
    "light_azure": ("Sky", "Horizon", "Ice", "Air"),
    "dark_blue": ("Sapphire", "Ink", "Abyss", "Lapis"),
    "light_blue": ("Porcelain", "Bluebell", "Dusk", "Hydrangea"),
    "dark_purple": ("Amethyst", "Plum", "Velvet", "Iris"),
    "light_purple": ("Lilac", "Wisteria", "Orchid", "Lavender"),
    "dark_magenta": ("Berry", "Wine", "Dahlia", "Beet"),
    "light_magenta": ("Fuchsia", "Peony", "Orchid", "Sweetpea"),
    "black": ("Coal", "Obsidian", "Iron", "Soot", "Shadow"),
    "dark_gray": ("Slate", "Flint", "Graphite", "Stone"),
    "light_gray": ("Ash", "Smoke", "Pewter", "Silver"),
    "white": ("Glass", "Frost", "Linen", "Porcelain", "Bone", "Pearl"),
}

#: A cell under this share is not a colour a name should claim.
NAMED_SHARE = 0.05

#: A chromatic cell holding this much is named ahead of any neutral, however large.
COLOURED_SHARE = 0.08

NEUTRAL_GROUPS = frozenset({"dark neutral", "light neutral"})

#: Everything `of_ramp` says about every map, asked once of the module that owns it.
CENSUS_PROGRAM = """
import json, sys

from fractal_wallpapers.palettes import codebook

names = json.load(sys.stdin)
print(json.dumps({name: codebook.of_ramp(name)["shares"] for name in names}))
"""


def census(names: list[str]) -> dict[str, dict[str, float]]:
    """Each map's share over the codebook's fifty-two cells, from its spent gradient."""
    completed = subprocess.run(
        [str(renders.venv_python()), "-c", CENSUS_PROGRAM],
        input=json.dumps(names),
        capture_output=True,
        text=True,
        cwd=str(renders.wallpapers_root()),
        check=False,
    )
    if completed.returncode != 0:
        raise PickerError(f"the ramp census failed: {completed.stderr.strip()[-2000:]}")
    return json.loads(completed.stdout)


def reads_as_display(name: str) -> bool:
    """Whether a library name is already a name a reader can be shown as it stands."""
    if re.search(r"[_.]|\d+$", name) or " " not in name:
        return False
    words = [word for word in re.split(r"[ ,]+", name) if word]
    significant = [word for word in words if word.lower() not in CONNECTIVES]
    return len(significant) >= 2 and all(
        word[0].isupper() for word in significant if word[0].isalpha()
    )


def _group(cell: str) -> str:
    """What makes two cells different colours for a name: hue family, or neutral kind."""
    if cell in ("black", "dark_gray"):
        return "dark neutral"
    if cell in ("light_gray", "white"):
        return "light neutral"
    return cell.rsplit("_", 1)[1]


def _material_key(cell: str) -> str:
    if cell in MATERIALS:
        return cell
    tone, _, hue = cell.split("_")
    return f"{tone}_{hue}"


def _cells(shares: dict[str, float]) -> list[str]:
    """The cells worth naming, largest first, ties by name."""
    ordered = sorted(shares, key=lambda cell: (-shares[cell], cell))
    kept = [cell for cell in ordered if shares[cell] >= NAMED_SHARE]
    return kept or ordered[:1]


def candidates(shares: dict[str, float]) -> list[str]:
    """Every name this map could take, best first.

    A colour leads over a neutral wherever the map spends `COLOURED_SHARE` on one: most of
    this library runs through black or white on its way between colours, and a name that
    says *ivory* and *coal* of a green and red map has named the part that is not it.
    """
    cells = _cells(shares)
    coloured = [c for c in cells if _group(c) not in NEUTRAL_GROUPS and shares[c] >= COLOURED_SHARE]
    cells = coloured + [cell for cell in cells if cell not in coloured]
    dominant = cells[0]
    others = [cell for cell in cells[1:] if _group(cell) != _group(dominant)]
    seconds = others + [cell for cell in cells[1:] if cell not in others] or [dominant]
    firsts = [dominant] + [cell for cell in cells[1:] if cell not in (seconds[0],)]
    found = []
    for second in seconds:
        for first in firsts:
            for colour in COLOUR_WORDS[first]:
                for material in MATERIALS[_material_key(second)]:
                    if colour != material:
                        found.append(f"{colour} {material}")
    # A last resort that cannot run dry: the dominant colour against every material.
    for colour in COLOUR_WORDS[dominant]:
        for materials in MATERIALS.values():
            found.extend(f"{colour} {material}" for material in materials if material != colour)
    return list(dict.fromkeys(found))


def load_names() -> dict[str, str]:
    """The committed `{underlying: display}` map, or an empty one where there is none yet."""
    if not NAMES_RECORD.is_file():
        return {}
    return json.loads(NAMES_RECORD.read_text(encoding="utf-8"))


def fill_names() -> tuple[Path, int, int, int]:
    """Give every carried map without an entry a display name; never touch one that has.

    Returns the record's path, how many entries were added, and of those how many kept the
    map's own name and how many were generated.
    """
    _, entries = explorer.roster()
    names = load_names()
    missing = [entry for entry in entries if entry.name not in names]
    taken = {display.casefold() for display in names.values()}
    kept = 0
    for entry in missing:
        if reads_as_display(entry.name) and entry.name.casefold() not in taken:
            names[entry.name] = entry.name
            taken.add(entry.name.casefold())
            kept += 1
    wanted = [entry for entry in missing if entry.name not in names]
    # Reserve every kept name before generating any, so a generated name can never take a
    # library name that a later map in seat order was going to keep.
    shares = census([entry.name for entry in wanted]) if wanted else {}
    for entry in sorted(wanted, key=lambda entry: (-entry.seats, entry.name)):
        chosen = next(
            (name for name in candidates(shares[entry.name]) if name.casefold() not in taken),
            None,
        )
        if chosen is None:
            raise PickerError(f"every generated name for {entry.name} is taken")
        names[entry.name] = chosen
        taken.add(chosen.casefold())
    ordered = {entry.name: names[entry.name] for entry in entries}
    ordered.update({name: display for name, display in names.items() if name not in ordered})
    _write_json(NAMES_RECORD, ordered)
    return NAMES_RECORD, len(missing), kept, len(wanted)


def name_problems(carried: list[str]) -> tuple[list[str], int]:
    """What is wrong with the names record, and how many carried maps it does not name.

    A missing entry is not a problem — the page falls back to the underlying name — so it
    is counted rather than failed. A display name two maps share is a problem, because the
    picker would show two rows a reader cannot tell apart.
    """
    if not NAMES_RECORD.is_file():
        return [f"{NAMES_RECORD.name} is missing"], len(carried)
    try:
        names = load_names()
    except json.JSONDecodeError as error:
        return [f"{NAMES_RECORD.name} is not JSON: {error}"], len(carried)
    problems = []
    known = set(carried)
    seen: dict[str, str] = {}
    for name, display in names.items():
        if name not in known:
            problems.append(f"{NAMES_RECORD.name}: {name!r} is not a map the explorer carries")
        if not isinstance(display, str) or display.strip() != display or not display:
            problems.append(f"{NAMES_RECORD.name}: {name!r} has no usable display name")
            continue
        other = seen.setdefault(display.casefold(), name)
        if other != name:
            problems.append(f"{NAMES_RECORD.name}: {name!r} and {other!r} are both {display!r}")
    return problems, sum(1 for name in carried if name not in names)


def popular_problems(carried: list[str]) -> list[str]:
    """The Popular record names maps the explorer carries, once each, and enough of them."""
    if not POPULAR_RECORD.is_file():
        return [f"{POPULAR_RECORD.name} is missing"]
    maps = load_popular().get("maps", [])
    problems = [
        f"{POPULAR_RECORD.name}: {name!r} is not a map the explorer carries"
        for name in maps
        if name not in set(carried)
    ]
    if len(set(maps)) != len(maps):
        problems.append(f"{POPULAR_RECORD.name} names a map twice")
    if len(maps) != POPULAR_SIZE:
        problems.append(f"{POPULAR_RECORD.name} lists {len(maps)} maps, not {POPULAR_SIZE}")
    return problems


def _write_json(path: Path, value) -> None:
    text = json.dumps(value, indent=2, ensure_ascii=False) + LF
    path.write_text(text, encoding="utf-8", newline=LF)
