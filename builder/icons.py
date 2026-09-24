"""The site's icon: one square crop of one wallpaper, at every size a browser asks for.

    python -m builder icons

Matt picked it off a contact sheet of forty *(favicon_sheet_ckpt145, F08)*: gallery seat
`dff7e280`, a Multibrot d = 3 frame drawn in tia and `along-the-starry-way-25`, cropped to
the centred square as tall as the seat's own frame. The sheet was a probe, and it lives
under ignored `scratch/`; nothing here reads it. What is kept is the choice — which seat,
which crop — and the files are drawn from that, the way every figure is drawn from its
record rather than from a picture somebody saved.

## The recipe

One row of `article/figure-recipes.jsonl`, kind `icon`, stamp `icon`, key `site`. It
carries the seat it was cropped from, the **crop link** (the explorer view that draws
exactly the square, cap pinned with `n` because a narrower frame is not the width the
depth policy gave the seat), the seat's own link, the crop's width, and the master's size
and sampling. `draw` writes the row and then renders from it: the seat's ledger recipe,
through `picks.panel_spec` so it is coloured exactly the way a seat panel is, with the
frame's width replaced by the row's and the resolution made square. Nothing else moves —
the same centre, the same cap, the same map and palette pass.

## The files

`assets/icons/`, all tracked, all small: `favicon.ico` holding 16, 32 and 48, the
180-pixel `apple-touch-icon.png`, `icon-192.png` and `icon-512.png`, and
`site.webmanifest`, which names the last two for a phone's home screen. Every size is a
Lanczos reduction of one 1024-pixel master, never a resize of another size, and the
`.ico` holds PNG payloads rather than bitmaps — every browser this site targets reads
them, and a PNG is the one encoder the rest of the icon set already goes through.

There is no `/favicon.ico` at the origin root and there cannot be: the site is a
project-Pages subpath, and the root is not this repository's to write. A browser asks
the root only when a page declares no icon, which is why every page declares one.

## The head

`head(page)` is the three `<link>` lines, spelled relative to the page that carries them.
The builder's generated pages get them from `pages._shell`; every other page the site
serves gets them from `build`, which replaces the run of icon links in its `<head>` the
way it replaces the contents rail between its markers. `check`'s `icons` holds every
served page to carrying exactly `head(page)`, and holds the files to the sizes named here.
"""

from __future__ import annotations

import io
import json
import re
import struct
from decimal import Decimal
from pathlib import Path

from . import records
from .paths import SITE_ROOT, relative_href, site_pages

#: The seat the icon is cropped from, by its own `<stamp>|<recipe key>`: the purple
#: collection's solve, whose seat 335 this is.
SEAT = "20260922T014052Z|dff7e280effc3aa3"

#: The square's side as a share of the seat frame's height. F08 on the sheet was the
#: search's 1.0: the whole height, centred, nothing offset.
CROP = Decimal(1)

#: The store's address for the row. One icon, so one key.
STAMP, KEY = "icon", "site"

ICONS_DIR = SITE_ROOT / "assets" / "icons"
MASTER = 1024
SUPERSAMPLE = 3

ICO = "favicon.ico"
ICO_SIZES = (16, 32, 48)
APPLE = "apple-touch-icon.png"
PNGS = {APPLE: 180, "icon-192.png": 192, "icon-512.png": 512}
MANIFEST = "site.webmanifest"
#: What the manifest names, which is what a phone's home screen draws.
MANIFEST_ICONS = ("icon-192.png", "icon-512.png")

#: The words a phone puts under the icon, where the full title will not fit.
SHORT_NAME = "Fractal Wallpapers"


class IconError(RuntimeError):
    """The icon cannot be drawn or declared as its record describes it."""


# ------------------------------------------------------------------------------ the head


def head(page: Path) -> str:
    """The icon links a page's `<head>` carries, relative to that page."""

    def href(name: str) -> str:
        return relative_href(page, ICONS_DIR / name)

    sizes = " ".join(f"{size}x{size}" for size in ICO_SIZES)
    return "\n".join(
        [
            f'<link rel="icon" href="{href(ICO)}" sizes="{sizes}">',
            f'<link rel="apple-touch-icon" href="{href(APPLE)}">',
            f'<link rel="manifest" href="{href(MANIFEST)}">',
        ]
    )


#: The run of icon links a page carries: one or more lines, each a `<link>` of one of the
#: three kinds `head` writes. What `build` replaces and what `check` reads.
_BLOCK = re.compile(r'^(?:<link rel="(?:icon|apple-touch-icon|manifest)"[^>\n]*>\n)+', re.MULTILINE)


def with_icons(page: Path, page_html: str) -> str:
    """The page with its run of icon links replaced by today's."""
    if _BLOCK.search(page_html) is None:
        raise records.RecordError(
            f"{page.relative_to(SITE_ROOT).as_posix()}: no icon link in its <head> — "
            'every page declares one, `<link rel="icon" ...>` on a line of its own'
        )
    return _BLOCK.sub(lambda _: head(page) + "\n", page_html, count=1)


def served_pages() -> list[Path]:
    """Every page the site serves, which is every page that has to declare the icon."""
    return site_pages()


# ---------------------------------------------------------------------------- the recipe


def _pick():
    from . import picks

    (pick,) = picks.resolve([SEAT])
    return pick


def recipe_row() -> dict:
    """The store row for the icon, derived from the seat and the crop above."""
    from . import links, picks

    pick = _pick()
    ledger = pick.recipe
    (frame_width, frame_height), _ = picks.regime_geometry(ledger["regime"])
    width = Decimal(ledger["viewport"]["width"])
    side = width * Decimal(frame_height) / Decimal(frame_width) * CROP
    side_text = format(side.normalize(), "f")
    cropped = dict(ledger, viewport=dict(ledger["viewport"], width=side_text))

    crop_view = links.ledger_view(cropped)
    crop_view["cap"] = ledger["maxiter"]
    seat_view = links.ledger_view(ledger)
    seat_view["cap"] = ledger["maxiter"]
    emitted = links.emit({"crop": crop_view, "seat": seat_view})
    for name, answer in emitted.items():
        if not answer.get("ok"):
            raise IconError(f"the {name} link cannot be written: {answer}")
    return {
        "schema": 1,
        "kind": "icon",
        "stamp": STAMP,
        "key": KEY,
        "read": (
            "drawn here by builder.icons: the seat's own recipe with its frame narrowed to "
            "the centred square, which the crop link spells whole"
        ),
        "recipe": {
            "seat": SEAT,
            "link": emitted["crop"]["link"],
            "source_link": emitted["seat"]["link"],
            "crop": {
                "centre": "the seat's own",
                "side": f"{CROP} x the seat frame's height",
                "width": side_text,
            },
            "maxiter": ledger["maxiter"],
            "resolution": [MASTER, MASTER],
            "supersample": SUPERSAMPLE,
            "sizes": {ICO: list(ICO_SIZES), **{name: [size] for name, size in PNGS.items()}},
            "maker": f"{__name__}:draw",
            "picked": "Matt, off the contact sheet of favicon_sheet_ckpt145, as F08",
        },
        "source": {},
    }


def held():
    """The icon's row as the store holds it, or `None` before `draw` has landed one."""
    from . import recipes

    return recipes.load_all().get(f"{STAMP}{recipes.SEPARATOR}{KEY}")


# ------------------------------------------------------------------------------ drawing


def master(row: dict) -> Path:
    """The square, drawn from the recipe row: the seat's spec at the row's width."""
    from . import picks, renders

    pick = _pick()
    if pick.identifier != row["seat"]:
        raise IconError(f"the row names {row['seat']} and this module crops {SEAT}")
    levelling = picks.run_stamp(pick)
    if levelling.way == picks.UNRECOVERABLE:
        raise IconError(
            f"{SEAT}: the tone operator acted and {levelling.where} kept no curve, so no "
            "render of the recipe is the picture the gallery ships"
        )
    spec = picks.panel_spec(
        pick,
        renders.mode_catalog(),
        resolution=tuple(row["resolution"]),
        supersample=row["supersample"],
        levelling=levelling,
    )
    spec = dict(spec, viewport=dict(spec["viewport"], width=row["crop"]["width"]))
    return picks.cache().produce(f"icon-{KEY}", "render", spec).path


def _png(image) -> bytes:
    out = io.BytesIO()
    image.save(out, format="PNG", optimize=True)
    return out.getvalue()


def ico_bytes(pictures: list) -> bytes:
    """An `.ico` holding each picture as a PNG payload, smallest first."""
    payloads = [(picture.size, _png(picture)) for picture in pictures]
    header = struct.pack("<HHH", 0, 1, len(payloads))
    offset = len(header) + 16 * len(payloads)
    entries, body = b"", b""
    for (width, height), data in payloads:
        entries += struct.pack(
            "<BBBBHHII", width % 256, height % 256, 0, 0, 1, 32, len(data), offset + len(body)
        )
        body += data
    return header + entries + body


def ico_sizes(data: bytes) -> list[int]:
    """The square sizes an `.ico` holds, read off its directory."""
    reserved, kind, count = struct.unpack_from("<HHH", data, 0)
    if reserved != 0 or kind != 1:
        raise IconError("not an icon file")
    sizes = []
    for index in range(count):
        width, height = struct.unpack_from("<BB", data, 6 + 16 * index)
        width, height = width or 256, height or 256
        if width != height:
            raise IconError(f"a {width}x{height} entry is not square")
        sizes.append(width)
    return sizes


def manifest() -> str:
    from .pages import SITE_TITLE

    body = {
        "name": SITE_TITLE,
        "short_name": SHORT_NAME,
        "icons": [
            {"src": name, "sizes": f"{PNGS[name]}x{PNGS[name]}", "type": "image/png"}
            for name in MANIFEST_ICONS
        ],
        "start_url": "../../index.html",
        "display": "browser",
    }
    return json.dumps(body, indent=2) + "\n"


def draw() -> list[Path]:
    """Record the recipe, then draw every file of the icon set from it."""
    from PIL import Image

    from . import recipes

    row = recipe_row()
    recipes.keep_icon(row)
    kept = held()
    drawn = Image.open(master(kept.recipe)).convert("RGB")
    if drawn.size != (MASTER, MASTER):
        raise IconError(f"the master came back {drawn.size[0]}x{drawn.size[1]}")
    ICONS_DIR.mkdir(parents=True, exist_ok=True)
    written = []

    def reduced(size: int):
        return drawn.resize((size, size), Image.LANCZOS)

    path = ICONS_DIR / ICO
    path.write_bytes(ico_bytes([reduced(size) for size in ICO_SIZES]))
    written.append(path)
    for name, size in PNGS.items():
        path = ICONS_DIR / name
        path.write_bytes(_png(reduced(size)))
        written.append(path)
    path = ICONS_DIR / MANIFEST
    with path.open("w", encoding="utf-8", newline="\n") as handle:
        handle.write(manifest())
    written.append(path)
    return written


# ------------------------------------------------------------------------------ checking


def problems() -> list[str]:
    """`check`'s `icons`: every served page declares the icon, and the files are the set."""
    found = []
    for page in served_pages():
        shown = page.relative_to(SITE_ROOT).as_posix()
        with page.open(encoding="utf-8", newline="") as handle:
            html = handle.read()
        try:
            if with_icons(page, html) != html:
                found.append(f"{shown}: its icon links are not today's — run `build`")
        except records.RecordError as error:
            found.append(str(error))

    ico = ICONS_DIR / ICO
    if not ico.is_file():
        found.append(f"assets/icons/{ICO}: missing — `python -m builder icons`")
    else:
        try:
            sizes = ico_sizes(ico.read_bytes())
        except (IconError, struct.error) as error:
            sizes = []
            found.append(f"assets/icons/{ICO}: unreadable ({error})")
        if sizes and sizes != list(ICO_SIZES):
            found.append(f"assets/icons/{ICO}: holds {sizes}, the set is {list(ICO_SIZES)}")

    from . import images

    for name, size in PNGS.items():
        path = ICONS_DIR / name
        if not path.is_file():
            found.append(f"assets/icons/{name}: missing — `python -m builder icons`")
        elif images.available() and images.dimensions(path) != (size, size):
            found.append(f"assets/icons/{name}: is not {size}x{size}")

    path = ICONS_DIR / MANIFEST
    if not path.is_file():
        found.append(f"assets/icons/{MANIFEST}: missing — `python -m builder icons`")
    elif path.read_text(encoding="utf-8") != manifest():
        found.append(f"assets/icons/{MANIFEST}: not what `builder.icons.manifest` writes")

    if held() is None:
        found.append("figure-recipes.jsonl: no icon row — `python -m builder icons`")
    return found
