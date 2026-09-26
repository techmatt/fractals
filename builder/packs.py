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
  `assets/images/galleries/seated-candidates/`. A colour pack and the general one show
  the first five seats of that collection's own page order (`curation/page_order.py`, as
  the Gallery tab lays them out, which is each row's `collections` place). A best pack
  shows the ranks the pack before it does not hold: Best 30 its ranks 1 to 5, Best 100
  its 31 to 35, Best 200 its 101 to 105.

## Links

A picture links into the explorer at its seat row's own `link`, which the contract
emitted when the gallery was landed. **A seat whose row carries a `gap` is shown and not
linked**: that link opens near the picture rather than at it, and on this site a link
that is nearly the picture is worse than none. The Gallery tab opens those anyway, with a
sentence saying what differs, and it has somewhere to put that sentence where a page does
not.

**Any repetition on this page is fine** *(Matt, packs_page_ckpt153)*: a pack's five are
its own collection's opening, and the general gallery's first seat is also the cyan
collection's. None of these blocks is a registry figure, so the `locations` check never
sees them, and this is the blanket exception said once rather than a `reuse_reason` per
pack.
"""

from __future__ import annotations

import json
import subprocess
from dataclasses import dataclass
from pathlib import Path

from . import records, renders, seats, sections
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

#: The best packs, each the first K of the general rank, as next door cuts them.
BEST = ("best-30", "best-100", "best-200")

#: The general gallery's pack on this page, and the zips it is cut into next door.
GENERAL = "general"

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
        "These are the finished wallpapers: 2560×1440 JPEGs, zipped by gallery. Each "
        "picture carries its explorer link in its metadata, so if you like one you can "
        "open it in the explorer and keep going from there.",
    ),
    (
        "p",
        "They're free to use under "
        '<a href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a>. If you share '
        "them, credit Matt Fisher.",
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
        "All thousand pictures, in three downloads so no single file is too large. The first "
        "part has the ones my friends liked best.",
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
        loaded[name] = Pack(name, row.text("collection"), tuple(files), row.lines("thumbs"))
    return header.fields, loaded


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


def opening(collection: str, rows: dict[str, dict]) -> list[str]:
    """A collection's first `SHOWN` seats in its own page order."""
    placed = sorted(
        (row["collections"][collection], key)
        for key, row in rows.items()
        if collection in (row.get("collections") or {})
    )
    return [key for _, key in placed[:SHOWN]]


# ------------------------------------------------------------------ the import, next door

#: What `packs.plan()` makes of the full set, and what `packs.json` says was built. One
#: process, run in that project's interpreter, reading and writing nothing of its own.
PLAN_PROGRAM = """
import json, sys
from pathlib import Path

from fractal_wallpapers.curation import packs

full, built = Path(sys.argv[1]), sys.argv[2]
manifest = Path(built) / packs.MANIFEST_NAME if built else None
held = json.loads(manifest.read_text("utf-8"))["packs"] if manifest and manifest.is_file() else []
print(json.dumps({
    "planned": [
        {
            "name": pack.name,
            "collection": pack.collection,
            "file": pack.file_name(),
            "keys": pack.keys,
            "order_from": pack.order_from,
        }
        for pack in packs.plan(full)
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
    return None


def _asked() -> dict:
    root = full_root()
    built = built_root()
    completed = subprocess.run(
        [
            str(renders.venv_python()),
            "-c",
            PLAN_PROGRAM,
            str(root),
            str(built) if built is not None else "",
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


def derive() -> list[dict]:
    """The record, header first, as the project next door answers today."""
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
    general_parts = sorted(name for name in planned if name.startswith(f"{GENERAL}-"))
    rows = seat_rows()
    out = [
        {
            "schema": records.SCHEMA,
            "kind": "packs",
            "release": RELEASE,
            "order_from": planned[BEST[0]]["order_from"],
        }
    ]
    before = 0
    for name in marked():
        if name == GENERAL:
            parts = [planned[part] for part in general_parts]
            thumbs = opening(GENERAL, rows)
        elif name in BEST:
            parts = [planned[name]]
            thumbs = parts[0]["keys"][before : before + SHOWN]
            before = len(parts[0]["keys"])
        else:
            if name not in planned:
                raise PacksError(f"the prose places {name!r} and next door plans no such pack")
            parts = [planned[name]]
            thumbs = opening(name, rows)
        out.append(
            {
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
        )
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


def download_words(pack: Pack, index: int) -> str:
    """One download line's words: which part where there are several, count, size."""
    lead = DOWNLOAD
    if len(pack.files) > 1:
        lead = f"{DOWNLOAD} part {index + 1} of {len(pack.files)}"
    one = pack.files[index]
    words = [lead, _count(one.pictures)]
    if one.bytes is not None:
        words.append(size(one.bytes))
    return " · ".join(words)


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
    lines.append(f"{pad}  </div>")
    lines.append(f'{pad}  <ul class="pack-downloads">')
    for index, one in enumerate(pack.files):
        lines.append(
            f'{pad}    <li><a class="pack-download" href="{attribute(one.href)}">'
            f"{text(download_words(pack, index))}</a></li>"
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
    each picture is a seat whose tile is on disk, and a colour or general pack's five are
    that collection's opening. The second half is the record being what `--import` would
    write today, which needs the checkout and the full set, and says so by name where
    either is missing.
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
    for name, pack in loaded.items():
        total = sum(one.pictures for one in pack.files)
        wanted = widths.get(name, sizes.get(pack.collection))
        if total != wanted:
            found.append(f"{where}: {name} holds {total} pictures, and its collection {wanted}")
        if len(pack.thumbs) != SHOWN:
            found.append(f"{where}: {name} shows {len(pack.thumbs)} pictures, not {SHOWN}")
        for key in pack.thumbs:
            row = rows.get(key)
            if row is None:
                found.append(f"{where}: {name}'s {key} is no seat of the Gallery tab's record")
            elif not (GALLERY_IMAGES_DIR / seats.SLUG / row["file"]).is_file():
                found.append(f"{where}: {name}'s {key} has no tile on disk")
            elif pack.collection not in row.get("collections", {}):
                found.append(f"{where}: {name}'s {key} is not a seat of {pack.collection}")
        if not pack.best and list(pack.thumbs) != opening(pack.collection, rows):
            found.append(f"{where}: {name}'s pictures are not its collection's first {SHOWN}")
    if with_checkout and unaskable() is None:
        try:
            if derive() != committed_rows():
                found.append(
                    f"{where}: not what the project next door answers today — "
                    "`python -m builder packs --import`, then `build`"
                )
        except (PacksError, renders.EngineError, OSError) as error:
            found.append(f"{where}: next door could not be asked — {error}")
    return found
