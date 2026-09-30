"""The Wallpaper packs page: the prose, the packs record, and one block per pack.

    python -m builder packs            # what the record says, pack by pack
    python -m builder packs --import   # rewrite the record from the project next door

## Where each piece comes from

The page is generated, so its prose cannot be read off a master on a synced drive at
build time: a clone has no drive, and CI regenerates this page byte for byte. **`PROSE`
below is the master placed** (`Wallpaper packs v1.md`, registered in
`article/prose.jsonl`), which makes it this page's second edit site; `python -m builder
prose wallpaper-packs/index.html` holds the two together, the way it holds every placed
page. Two lines of it differ from the master by ruling, and neither is a word:
`[FIGURE packs-hero]` is the registry's figure, and "Back to the article" keeps the
front page as its target where the master says the start page (packs_page_ckpt153).

**The packs are a record, `wallpaper-packs/packs.jsonl`**, one row per `[PACK <name>]`
marker: its zip files with their picture counts and, once the zips exist, their sizes;
and the five pictures its block shows. It is written by `--import` and read by nothing
else, and the reason it exists is the order. The project next door's `curation/packs.py`
ranks the general gallery by a seeded shuffle of its seat order (the friends' votes will
replace the shuffle with `--order FILE`), and neither that seat order nor a votes file is
anything this repository holds. So the answer is imported, the same way the palette
record and the gallery's collections are, and a clone reads the answer.

- **Counts** are `packs.plan()`'s, which are the collections' sizes in
  `curation/targets.py`, with the general thousand cut 334, 333 and 333.
- **Sizes** are `packs.json`'s, which `curate packs build` writes beside the zips, and
  only for an entry that says `complete`. Until the zips are built there is no size and
  the line says nothing about one: **a rebuild after the packs are built fills them in**,
  `--import` then `build`, with no prose change.
- **The five pictures** are Gallery tab tiles, already tracked under
  `assets/images/galleries/seated-candidates/`, and they are the friends' votes *(Matt,
  packs_stage_voted_ckpt157)*: `ranking.previews` walks each pack in its staged order and
  takes up to five seats that have a vote, are shown nowhere else on the site, and are no
  earlier pack's preview (`builder/ranking.py` has the rules). Where fewer than five
  qualify, the rest are empty in the record and the block draws each as a
  `NEEDS_VOTES` cell. This is on purpose ahead of the zips: `--import` writes the picks
  whether or not the packs have been rebuilt, so a best pack may preview a picture its
  built zip does not hold yet. The import therefore needs the votes store as well as the
  checkout and the full set. **The best packs and the general one may be picked by hand
  instead**: `wallpaper-packs/preview-picks.json` (`PICKS`), written from `votes browse`'s
  pick mode, is those packs' preview wherever it names one, and the colour packs walk on,
  never reusing a hand pick. **A best pack's hand picks are also its members** (`forced`,
  packs_forced_members_ckpt157), even from outside the thousand, and its row lists them.

## Links

A picture links into the explorer at its seat row's own `link`, which the contract
emitted when the gallery was landed. **A seat whose row carries a `gap` is shown and not
linked**: that link opens near the picture rather than at it, and on this site a link
that is nearly the picture is worse than none. The Gallery tab opens those anyway, where
the view a tile opens is the view the reader explores (explorer_render_seams_ckpt153), and
a page's figure is a claim about one picture.

**No preview repeats on this page, or anywhere else on the site**: the picker refuses
both, which is stricter than packs_page_ckpt153's blanket exception needed. None of these
blocks is a registry figure, so the `locations` check never sees them, and `check` holds
the no-repeat half itself.
"""

from __future__ import annotations

import json
import subprocess
from dataclasses import dataclass
from pathlib import Path

from . import records, renders, seats, sections, votes
from .escape import attribute, text
from .paths import GALLERIES_DIR, GALLERY_IMAGES_DIR, SITE_ROOT, relative_href
from .settings import local

#: The record, beside the page it feeds.
RECORD = GALLERIES_DIR / "packs.jsonl"

#: The page.
PAGE = GALLERIES_DIR / "index.html"

#: Where a zip is downloaded from: the latest release of this site's own repository,
#: under the file name `curation/packs.py` gives it. These answer 404 until the assets
#: are uploaded, which is the expected state until they are.
RELEASE = "https://github.com/techmatt/fractals/releases/latest/download/"

#: Where the full set and the built packs are on this machine. Untracked, like every
#: absolute path: `local.toml` or the environment, the environment winning.
FULL_KEY, FULL_VARIABLE = "full_set_root", "FRACTAL_WEBSITE_FULL_SET"
BUILT_KEY, BUILT_VARIABLE = "packs_root", "FRACTAL_WEBSITE_PACKS"

#: How many pictures a pack's block shows.
SHOWN = 5

#: What a slot says that no voted seat filled.
NEEDS_VOTES = "needs votes"

#: The best packs, each the first K of the general rank, as next door cuts them.
BEST = ("best-30", "best-100", "best-200")

#: The general gallery's pack on this page, and the zips it is cut into next door.
GENERAL = "general"

#: Matt's own previews for the best packs and the general one, picked in `votes browse`'s
#: pick mode and pasted back. Where a pack is named here, this list is its preview and the
#: walk is not asked; a colour pack is never named here.
PICKS = GALLERIES_DIR / "preview-picks.json"
PICKED = (*BEST, GENERAL)

#: A pack as the page names it. The master names none of them; these are what the
#: prose around them already calls them.
TITLES = {
    "best-30": "Best 30",
    "best-100": "Best 100",
    "best-200": "Best 200",
    GENERAL: "Main gallery",
}

#: What the download line is, and what the explorer line under it is.
DOWNLOAD = "Download"
EXPLORE = "View this gallery in the explorer"

LF = "\n"


class PacksError(RuntimeError):
    """The packs record cannot be read, written or held to what it was written from."""


# ------------------------------------------------------------------------------ the prose

#: The master, `Wallpaper packs v1.md`, placed. `("p", html)` is a paragraph, already
#: markup; `("h2", words)` a subhead; `("figure", id)` a registry figure; `("pack", name)`
#: a pack's block; `("back", words)` the way back to the article.
PROSE: tuple[tuple[str, str], ...] = (
    ("figure", "packs-hero"),
    (
        "p",
        "These are the finished wallpapers: 2560×1440 JPEGs, zipped by gallery. Every one "
        "was found and rendered with the search and rendering methods this site describes. "
        "They're free to use under "
        '<a href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a>. If you share '
        'them, credit <a href="https://techmatt.github.io/">Matt Fisher</a>.',
    ),
    (
        "p",
        'If you want a different size, open any picture in <a href="../explorer/index.html">'
        "the explorer</a> and download it at the resolution you need, or render it yourself "
        'with the code in <a href="https://github.com/techmatt/fractal-wallpapers">'
        "fractal-wallpapers</a>.",
    ),
    ("h2", "The best of the main gallery"),
    (
        "p",
        "A few friends voted on the main gallery, and these are the pictures they liked "
        "most. Each pack contains the one before it.",
    ),
    ("pack", "best-30"),
    ("pack", "best-100"),
    ("pack", "best-200"),
    ("h2", "The main gallery"),
    (
        "p",
        "All thousand pictures, the best 200 are in part 1.",
    ),
    ("pack", GENERAL),
    ("h2", "Color galleries"),
    ("p", "Each of these is its own gallery, chosen for one family of colors."),
    ("pack", "rose"),
    ("pack", "red"),
    ("pack", "orange"),
    ("pack", "yellow"),
    ("pack", "lime"),
    ("pack", "green"),
    ("pack", "teal"),
    ("pack", "cyan"),
    ("pack", "azure"),
    ("pack", "blue"),
    ("pack", "purple"),
    ("pack", "magenta"),
    ("back", "Back to the article"),
)


def marked() -> list[str]:
    """Every pack the prose places, in page order."""
    return [value for kind, value in PROSE if kind == "pack"]


def title(name: str) -> str:
    return TITLES.get(name, name.capitalize())


# ----------------------------------------------------------------------------- the record


@dataclass(frozen=True)
class Download:
    """One zip: its file name next door, how many pictures, and its size once built."""

    file: str
    pictures: int
    bytes: int | None

    @property
    def href(self) -> str:
        return RELEASE + self.file


@dataclass(frozen=True)
class Pack:
    name: str
    collection: str
    files: tuple[Download, ...]
    thumbs: tuple[str, ...]
    #: A best pack's forced members: seats it holds whatever their rank (`forced`).
    forced: tuple[str, ...] = ()

    @property
    def best(self) -> bool:
        return self.name in BEST


def load() -> tuple[dict, dict[str, Pack]]:
    """The record's header fields and its packs, by name, in record order."""
    rows = records.read(RECORD)
    header, rest = rows[0], rows[1:]
    header.expect_kind("packs")
    loaded: dict[str, Pack] = {}
    for row in rest:
        row.expect_kind("pack")
        name = row.text("name")
        if name in loaded:
            raise records.RecordError(f"{row.where}: {name} appears twice")
        files = []
        for one in row.fields.get("files") or []:
            size = one.get("bytes")
            if size is not None and (not isinstance(size, int) or size <= 0):
                raise records.RecordError(f"{row.where}: {one.get('file')}'s bytes {size!r}")
            files.append(Download(str(one["file"]), int(one["pictures"]), size))
        if not files:
            raise records.RecordError(f"{row.where}: a pack needs at least one file")
        # Possibly empty: a pack with no voted seat to show is five "needs votes" cells.
        thumbs = row.fields.get("thumbs")
        if not isinstance(thumbs, list) or not all(
            isinstance(key, str) and key.strip() for key in thumbs
        ):
            raise records.RecordError(f"{row.where}: thumbs must be a list of seat keys")
        forced = row.fields.get("forced", [])
        if not isinstance(forced, list) or not all(isinstance(key, str) for key in forced):
            raise records.RecordError(f"{row.where}: forced must be a list of seat keys")
        loaded[name] = Pack(
            name, row.text("collection"), tuple(files), tuple(thumbs), tuple(forced)
        )
    return header.fields, loaded


def manual() -> dict[str, list[str]]:
    """The hand-picked previews by pack, none where there is no picks file.

    Refuses a file that names a pack outside `PICKED`, holds more than `SHOWN` for one, or
    names one seat twice; whether each is a voted seat is `problems`' to say, since that
    needs the votes store and this does not.
    """
    if not PICKS.is_file():
        return {}
    try:
        held = json.loads(PICKS.read_text(encoding="utf-8"))
    except json.JSONDecodeError as error:
        raise PacksError(f"{PICKS.name}: {error}") from error
    picks = held.get("packs") if isinstance(held, dict) else None
    if held.get("kind") != "preview-picks" or not isinstance(picks, dict):
        raise PacksError(f'{PICKS.name}: wants {{"kind": "preview-picks", "packs": {{...}}}}')
    seen: dict[str, str] = {}
    out: dict[str, list[str]] = {}
    for name, keys in picks.items():
        if name not in PICKED:
            raise PacksError(f"{PICKS.name}: {name!r} is not one of {', '.join(PICKED)}")
        if not isinstance(keys, list) or not all(isinstance(key, str) for key in keys):
            raise PacksError(f"{PICKS.name}: {name} must be a list of seat keys")
        if len(keys) > SHOWN:
            raise PacksError(f"{PICKS.name}: {name} picks {len(keys)}, over {SHOWN}")
        for key in keys:
            if key in seen:
                raise PacksError(f"{PICKS.name}: {key} is picked for {seen[key]} and {name}")
            seen[key] = name
        out[name] = list(keys)
    return out


def forced(picked: dict[str, list[str]] | None = None) -> dict[str, list[str]]:
    """Each best pack's forced members: its own hand picks and every smaller pack's.

    *(Matt, packs_forced_members_ckpt157)* A best pack's preview picks join its membership
    even from outside the thousand, and a pick for Best K is in every larger best pack, so
    the nesting holds. Next door's `packs.plan()` takes this as `--forced` and does the
    displacing; the keys here are in pick order, and the plan puts them in rank order.
    """
    picked = manual() if picked is None else picked
    out: dict[str, list[str]] = {}
    held: list[str] = []
    for name in BEST:
        held = held + [key for key in picked.get(name, []) if key not in held]
        out[name] = list(held)
    return out


def seat_rows() -> dict[str, dict]:
    """Every seat row of the Gallery tab's record, by recipe key."""
    directory = seats.directory()
    head = records.read(seats.metadata_path())[0]
    rows: dict[str, dict] = {}
    for one in head.fields.get("collections") or []:
        for row in records.read(directory / one["file"]):
            rows.setdefault(row.text("key"), row.fields)
    return rows


def collection_sizes() -> dict[str, int]:
    """Each collection's size as the Gallery tab's header records it."""
    head = records.read(seats.metadata_path())[0]
    return {one["name"]: int(one["seats"]) for one in head.fields.get("collections") or []}


# ------------------------------------------------------------------ the import, next door

#: What `packs.plan()` makes of the full set, and what `packs.json` says was built. One
#: process, run in that project's interpreter, reading and writing nothing of its own.
PLAN_PROGRAM = """
import json, sys
from pathlib import Path

from fractal_wallpapers.curation import packs

full, built, order, forced, orders = Path(sys.argv[1]), *sys.argv[2:6]
manifest = Path(built) / packs.MANIFEST_NAME if built else None
forced = packs.read_forced(Path(forced)) if forced else None
orders = packs.read_orders(Path(orders)) if orders else None
held = json.loads(manifest.read_text("utf-8"))["packs"] if manifest and manifest.is_file() else []
print(json.dumps({
    "planned": [
        {
            "name": pack.name,
            "collection": pack.collection,
            "file": pack.file_name(),
            "keys": pack.keys,
            "order_from": pack.order_from,
            "forced": pack.forced,
        }
        for pack in packs.plan(full, Path(order) if order else None, forced=forced, orders=orders)
    ],
    "built": held,
}))
"""


def full_root() -> Path | None:
    return local(FULL_KEY, FULL_VARIABLE)


def built_root() -> Path | None:
    return local(BUILT_KEY, BUILT_VARIABLE)


def unaskable() -> str | None:
    """Why this machine cannot derive the record, or `None` where it can."""
    try:
        renders.wallpapers_root()
    except renders.EngineError:
        return "the wallpapers checkout is not configured here"
    root = full_root()
    if root is None:
        return f"the full set is not configured here (`{FULL_KEY}` in local.toml)"
    if not root.is_dir():
        return f"{root} is configured as the full set, and is not there"
    try:
        store = votes.store_path()
    except votes.VotesError:
        return "the votes store is not configured here"
    if not store.is_file():
        return f"{store} is configured as the votes store, and is not there"
    return None


def _asked(
    order: Path | None = None, forced: Path | None = None, orders: Path | None = None
) -> dict:
    """`plan()` and `packs.json` as next door answers.

    The plan is ranked by `order` if given, with `forced` (a JSON of forced best-pack
    members) and `orders` (a directory of `<collection>.txt`) passed through as
    `curate packs build` takes them.
    """
    root = full_root()
    built = built_root()
    completed = subprocess.run(
        [
            str(renders.venv_python()),
            "-c",
            PLAN_PROGRAM,
            str(root),
            str(built) if built is not None else "",
            str(order.resolve()) if order is not None else "",
            str(forced.resolve()) if forced is not None else "",
            str(orders.resolve()) if orders is not None else "",
        ],
        capture_output=True,
        text=True,
        encoding="utf-8",
        cwd=str(renders.wallpapers_root()),
        check=False,
    )
    if completed.returncode != 0:
        raise PacksError(f"packs.plan() failed: {completed.stderr.strip()[-2000:]}")
    return json.loads(completed.stdout)


def current() -> dict[str, dict]:
    """Each pack by name, `keys` in the order it ships, as the project next door answers."""
    asked = _asked()
    built = {
        entry["pack"]: entry
        for entry in asked["built"]
        if entry.get("complete") and entry.get("pictures") == entry.get("of")
    }
    planned = {}
    for pack in asked["planned"]:
        entry = built.get(pack["name"])
        # A built zip is the order that was actually shipped: the day the votes arrive as
        # `--order`, the plan's seeded default and the zip part ways, and the zip wins.
        if entry is not None and entry["file"] == pack["file"]:
            pack = {**pack, "keys": entry["seats"], "order_from": entry["order_from"]}
            pack["bytes"] = entry["bytes"]
        else:
            pack = {**pack, "bytes": None}
        planned[pack["name"]] = pack
    return planned


def derive() -> list[dict]:
    """The record, header first, as the project next door answers today."""
    from . import ranking

    planned = current()
    general_parts = sorted(name for name in planned if name.startswith(f"{GENERAL}-"))
    staging = ranking.previews(planned)
    picked = staging.previews
    out = [
        {
            "schema": records.SCHEMA,
            "kind": "packs",
            "release": RELEASE,
            "order_from": planned[BEST[0]]["order_from"],
        }
    ]
    for name in marked():
        if name == GENERAL:
            parts = [planned[part] for part in general_parts]
        else:
            if name not in planned:
                raise PacksError(f"the prose places {name!r} and next door plans no such pack")
            parts = [planned[name]]
        thumbs = picked[name].picks
        row = {
            "schema": records.SCHEMA,
            "kind": "pack",
            "name": name,
            "collection": parts[0]["collection"],
            "files": [
                {"file": part["file"], "pictures": len(part["keys"]), "bytes": part["bytes"]}
                for part in parts
            ],
            "thumbs": thumbs,
        }
        if staging.forced.get(name):
            # What makes a best pack's membership more than its collection's first K.
            row["forced"] = staging.forced[name]
        out.append(row)
    return out


def write(rows: list[dict]) -> Path:
    body = LF.join(json.dumps(row, ensure_ascii=False) for row in rows)
    RECORD.write_text(body + LF, encoding="utf-8", newline=LF)
    return RECORD


def committed_rows() -> list[dict]:
    with RECORD.open(encoding="utf-8") as handle:
        return [json.loads(line) for line in handle if line.strip()]


# ------------------------------------------------------------------------------ the page


def size(count: int) -> str:
    """A zip's size as a reader reads one: decimal GB to two places, MB under one."""
    if count >= 1_000_000_000:
        return f"{count / 1e9:.2f} GB"
    return f"{round(count / 1e6)} MB"


def _count(pictures: int) -> str:
    return "1 wallpaper" if pictures == 1 else f"{pictures:,} wallpapers"


def _download_terms(pack: Pack, index: int) -> list[str]:
    """One download line's terms: which part where there are several, count, size."""
    lead = DOWNLOAD
    if len(pack.files) > 1:
        lead = f"{DOWNLOAD} part {index + 1} of {len(pack.files)}"
    one = pack.files[index]
    terms = [lead, _count(one.pictures)]
    if one.bytes is not None:
        terms.append(size(one.bytes))
    return terms


def download_words(pack: Pack, index: int) -> str:
    """One download line's words: which part where there are several, count, size."""
    return " · ".join(_download_terms(pack, index))


def download_label(pack: Pack, index: int) -> str:
    """One download line as the button's markup: the same words, escaped.

    A pack in several parts says which part, and that makes its line too long for a phone's
    column at any size worth reading: 363 px of words at the button's 17, in a list 301
    wide at 375. So its count sits in a span the stylesheet hides where the list is narrow
    (`.pack-download-count`), and the button there reads part and size. The words are the
    same everywhere else, and a one-file pack has no span because it fits without one.
    """
    lead, count, *rest = _download_terms(pack, index)
    if len(pack.files) == 1:
        return text(download_words(pack, index))
    tail = "".join(f" · {term}" for term in rest)
    return f'{text(lead)}<span class="pack-download-count">{text(f" · {count}")}</span>{text(tail)}'


def explore_href(page: Path, pack: Pack) -> str:
    explorer = relative_href(page, SITE_ROOT / "explorer" / "index.html")
    return f"{explorer}?panel=gallery&collection={pack.collection}"


def block(page: Path, pack: Pack, rows: dict[str, dict]) -> str:
    """One pack: its name, its five pictures, its downloads, and the explorer line."""
    from . import figures

    pad = figures.INDENT
    lines = [
        f'{pad}<figure class="figure figure-split pack" data-pack="{attribute(pack.name)}">',
        f'{pad}  <p class="pack-title">{text(title(pack.name))}</p>',
        f'{pad}  <div class="figure-panels" style="--figure-across: {SHOWN}">',
    ]
    alt = f"A wallpaper from the {title(pack.name)} pack."
    for key in pack.thumbs:
        row = rows[key]
        src = relative_href(page, GALLERY_IMAGES_DIR / seats.SLUG / row["file"])
        picture = (
            f'<img src="{attribute(src)}" width="{row["width"]}" height="{row["height"]}" '
            f'alt="{attribute(alt)}" loading="lazy">'
        )
        opened = None
        if row.get("link") and not row.get("gap"):
            explorer = relative_href(page, SITE_ROOT / "explorer" / "index.html")
            opened = f"{explorer}?{row['link']}"
        lines.append(f'{pad}    <div class="figure-panel">')
        lines.append(f"{pad}      {figures._linked(picture, opened)}")
        lines.append(f"{pad}    </div>")
    # A slot no voted seat filled: a figure's blank cell at a tile's shape, saying so.
    width, height = seats.TILE_SIZE
    for _ in range(SHOWN - len(pack.thumbs)):
        lines.append(f'{pad}    <div class="figure-panel">')
        lines.append(
            f'{pad}      <div class="figure-blank pack-needs-votes" '
            f'style="aspect-ratio: {width} / {height}">{text(NEEDS_VOTES)}</div>'
        )
        lines.append(f"{pad}    </div>")
    lines.append(f"{pad}  </div>")
    lines.append(f'{pad}  <ul class="pack-downloads">')
    for index, one in enumerate(pack.files):
        lines.append(
            f'{pad}    <li><a class="pack-download" href="{attribute(one.href)}">'
            f"{download_label(pack, index)}</a></li>"
        )
    lines.append(f"{pad}  </ul>")
    if not pack.best:
        lines.append(
            f'{pad}  <p class="pack-explore"><a href="{attribute(explore_href(page, pack))}">'
            f"{text(EXPLORE)}</a></p>"
        )
    lines.append(f"{pad}</figure>")
    return LF.join(lines)


def prose_section(page: Path, figure_block, back: str) -> str:
    """The page's prose: the master, with each marker replaced by the block it names.

    `figure_block` is how the caller derives a registry figure, and `back` is the href of
    the way back to the article, both relative to `page`.
    """
    _, loaded = load()
    rows = seat_rows()
    lines = ['  <section class="prose">']
    for kind, value in PROSE:
        if kind == "p":
            lines.append(f"    <p>{value}</p>")
        elif kind == "h2":
            lines.append(f'    <h2 id="{attribute(sections.slug(value))}">{text(value)}</h2>')
        elif kind == "figure":
            lines.append(figure_block(value))
        elif kind == "pack":
            lines.append(block(page, loaded[value], rows))
        elif kind == "back":
            lines.append(f'    <p><a href="{attribute(back)}">{text(value)}</a></p>')
        lines.append("")
    lines.pop()
    lines.append("  </section>")
    return LF.join(lines)


# ------------------------------------------------------------------------------ the check


def problems(*, with_checkout: bool) -> list[str]:
    """The record against the prose, the Gallery tab's record, and (here) next door.

    The first half reads this repository alone and runs on a clone: every `[PACK]` the
    prose places has a row and every row a marker, the counts are the collections' sizes,
    each picture is a seat of the pack's collection whose tile is on disk, and no picture
    is two packs' preview. A pack `PICKS` names shows exactly those picks, at most `SHOWN`.
    A best pack's are its members by being forced (its row's `forced`, held to `forced()`),
    and the Main gallery's may be any voted seat, since the thousand is not widened for
    one. The second half is the record being what `--import` would write
    today, which needs the checkout, the full set, and the votes store, and says so by name
    where one is missing. That half is what holds a walked preview to the rules: a vote,
    nowhere else on the site, and (for a best pack) a member of the staged pack rather than
    of the built zip, which the previews are deliberately ahead of. A hand pick is held to
    having a vote there, and to nothing else the walk asks.
    """
    found: list[str] = []
    where = "wallpaper-packs/packs.jsonl"
    try:
        header, loaded = load()
    except records.RecordError as error:
        return [str(error)]
    if header.get("release") != RELEASE:
        found.append(f"{where}: release {header.get('release')!r}, the page links {RELEASE}")
    placed = marked()
    if list(loaded) != placed:
        found.append(
            f"{where}: rows {list(loaded)} and the prose's [PACK] markers {placed} disagree"
        )
    rows = seat_rows()
    sizes = collection_sizes()
    widths = {"best-30": 30, "best-100": 100, "best-200": 200}
    previewed: dict[str, str] = {}
    try:
        picked = manual()
    except PacksError as error:
        found.append(str(error))
        picked = {}
    for name, keys in picked.items():
        if name in loaded and list(loaded[name].thumbs) != keys:
            found.append(
                f"{where}: {name}'s pictures are not {PICKS.name}'s — "
                "`python -m builder packs --import`, then `build`"
            )
    for name, pack in loaded.items():
        total = sum(one.pictures for one in pack.files)
        wanted = widths.get(name, sizes.get(pack.collection))
        if total != wanted:
            found.append(f"{where}: {name} holds {total} pictures, and its collection {wanted}")
        if len(pack.thumbs) > SHOWN:
            found.append(f"{where}: {name} shows {len(pack.thumbs)} pictures, over {SHOWN}")
        for key in pack.thumbs:
            if key in previewed:
                found.append(f"{where}: {name}'s {key} is already {previewed[key]}'s preview")
            previewed.setdefault(key, name)
            row = rows.get(key)
            if row is None:
                found.append(f"{where}: {name}'s {key} is no seat of the Gallery tab's record")
            elif not (GALLERY_IMAGES_DIR / seats.SLUG / row["file"]).is_file():
                found.append(f"{where}: {name}'s {key} has no tile on disk")
            elif (
                (name != GENERAL or name not in picked)
                and pack.collection not in row.get("collections", {})
                and key not in pack.forced
            ):
                # A best pack's membership is its collection's first K and its forced
                # members, so its picks are always members. A Main gallery pick may lie
                # outside the thousand, which stays the thousand (packs_forced_members_ckpt157).
                found.append(f"{where}: {name}'s {key} is no member of {name}")
    wanted_forced = forced(picked)
    for name in BEST:
        if name in loaded and set(loaded[name].forced) != set(wanted_forced[name]):
            found.append(
                f"{where}: {name}'s forced members are not {PICKS.name}'s picks for it and "
                "every smaller best pack — `python -m builder packs --import`, then `build`"
            )
    if with_checkout and unaskable() is None:
        try:
            from . import ranking

            voted = set(ranking.voters())
            for name, keys in picked.items():
                for key in keys:
                    if key not in voted:
                        found.append(f"{PICKS.name}: {name}'s {key} has no vote")
            if derive() != committed_rows():
                found.append(
                    f"{where}: not what the project next door answers today — "
                    "`python -m builder packs --import`, then `build`"
                )
        except (PacksError, renders.EngineError, votes.VotesError, OSError) as error:
            found.append(f"{where}: next door could not be asked — {error}")
    return found
