"""Whether every explorer link in the two root READMEs is the link its picture is.

Each repository's root `README.md` opens with a strip of four thumbnails, and each
thumbnail links to its view in the live explorer. Those links are written by hand into a
page no build touches, which is how the wallpapers strip came to carry
`curation.pins.query_of`'s spelling of three seats *(readme_links_complete_ckpt154)*: a
writer for authoring pins that drops `mirror`, the tone curve and a mode's parameters, so
the first thumbnail opened in the un-mirrored map and looked like a different picture.

Two halves:

* **parse**, everywhere: every explorer link either README carries, in a thumbnail's
  `<a>` or anywhere else in the text, is read by `permalink.js` itself (`go.mjs`, the
  reader the short links are held to) and is already its own canonical spelling. A link
  the page rewrites on arrival is a link somebody typed.
* **seats**, where the wallpapers checkout is configured: a thumbnail whose row in its
  folder's `examples/README.md` names a seat is held to the link the contract emits for
  that seat's recipe, with the tone curve its run or the backfill recorded, byte for byte
  after the base. That is the gallery row's own link (`builder/seats.py`), and `stamps`
  holds it to `explorer_link.query_of` next door. A thumbnail whose row names no seat is a
  link and nothing else, and the parse half is the whole of what can be asked of it.

Without the checkout, the wallpapers README is not there to read and no seat can be
resolved, so both are a named skip and this repository's README is still parsed.
"""

from __future__ import annotations

import html
import re
from pathlib import Path

from . import go, links, picks, renders, seats
from .pages import SITE_URL
from .paths import SITE_ROOT

#: An explorer link as a README spells it, with or without the page's file name.
LINK = re.compile(re.escape(f"{SITE_URL}explorer/") + r'(?:index\.html)?\?([^"\s)<>`\]]+)')

#: A thumbnail: a link wrapped round an image of the strip.
THUMBNAIL = re.compile(r'<a href="([^"]+)"><img src="(examples/[^"]+)"')

#: A `seat` cell that names one: an eight-or-more hex prefix of a recipe key.
SEAT = re.compile(r"`([0-9a-f]{8,16})`")


def readme_links(text: str) -> list[str]:
    """Every explorer link's query in a README, in order."""
    return [html.unescape(found) for found in LINK.findall(text)]


def thumbnails(text: str) -> dict[str, str]:
    """Each strip image, by its path, and the query its link carries."""
    found = {}
    for href, image in THUMBNAIL.findall(text):
        queries = readme_links(href)
        found[image] = queries[0] if queries else ""
    return found


def seats_named(folder: Path) -> dict[str, str | None]:
    """`examples/README.md`'s table: each file, and the seat prefix its row names or `None`."""
    path = folder / "examples" / "README.md"
    named: dict[str, str | None] = {}
    columns: list[str] | None = None
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.startswith("|"):
            columns = None
            continue
        cells = [cell.strip() for cell in line.strip().strip("|").split("|")]
        if columns is None:
            columns = [cell.lower() for cell in cells]
            continue
        if "file" not in columns or "seat" not in columns or set(line) <= set("|- "):
            continue
        file = cells[columns.index("file")].strip("`")
        seat = SEAT.search(cells[columns.index("seat")])
        named[f"examples/{file}"] = seat.group(1) if seat else None
    return named


def _readmes(with_checkout: bool) -> dict[str, Path]:
    found = {"this README": SITE_ROOT}
    if with_checkout:
        found["fractal-wallpapers' README"] = renders.wallpapers_root()
    return found


def problems(*, with_checkout: bool) -> list[str]:
    """Every README link that does not parse, is not canonical, or is not its seat's."""
    found: list[str] = []
    readmes = _readmes(with_checkout)
    texts = {
        name: (root / "README.md").read_text(encoding="utf-8") for name, root in readmes.items()
    }

    asked = []
    for name, text in texts.items():
        for index, query in enumerate(readme_links(text)):
            asked.append(go.Redirect(name=f"{name} link {index + 1}", query=query, note=None))
    try:
        answers = go.parsed(asked)
    except (go.GoError, OSError) as error:
        return [f"go.mjs: {error}"]
    for redirect in asked:
        answer = answers.get(redirect.name) or {"ok": False, "why": "no answer"}
        if not answer.get("ok"):
            found.append(f"{redirect.name} is refused by the explorer: {answer.get('why')}")
        elif answer.get("deep"):
            found.append(f"{redirect.name} is a deep link, and a README strip is shallow")
        elif answer["canonical"] != redirect.query:
            found.append(
                f"{redirect.name} is not the contract's own spelling: {redirect.query} "
                f"opens as {answer['canonical']}"
            )

    if with_checkout:
        found += _seats(readmes, texts)
    return found


def _seats(readmes: dict[str, Path], texts: dict[str, str]) -> list[str]:
    found: list[str] = []
    wanted: dict[tuple[str, str], str] = {}
    for name, root in readmes.items():
        strip = thumbnails(texts[name])
        named = seats_named(root)
        for image in strip:
            if image not in named:
                found.append(f"{name}'s {image} has no row in its examples/README.md table")
            elif named[image] is not None:
                wanted[(name, image)] = named[image]
        for image in named:
            if image not in strip:
                found.append(
                    f"{name}'s examples table names {image}, which its strip does not show"
                )
    if not wanted:
        return found

    rows = seats.seat_rows(seats.STAMP)
    keys: dict[tuple[str, str], str] = {}
    for where, prefix in wanted.items():
        matched = [row["key"] for row in rows if str(row["key"]).startswith(prefix)]
        if len(matched) != 1:
            found.append(
                f"{where[0]}'s {where[1]} names seat {prefix}, which is "
                f"{'no' if not matched else 'more than one'} seat of the general collection"
            )
            continue
        keys[where] = matched[0]
    resolved = picks.resolve(
        f"{seats.STAMP}{picks.PICK_SEPARATOR}{key}" for key in sorted(set(keys.values()))
    )
    stamps = seats.stamps_of(resolved)
    views, tones = {}, {}
    for pick in resolved:
        toned = seats.tone(pick, stamps)
        tones[pick.key] = toned
        curve = toned.curve if toned.way == seats.CURVED else None
        view = links.ledger_view(pick.recipe, level=curve)
        view["cap"] = pick.recipe.get("maxiter")
        views[pick.key] = view
    emitted = links.emit(views)

    strips = {name: thumbnails(texts[name]) for name in readmes}
    for (name, image), key in keys.items():
        if tones[key].way == seats.LOST:
            found.append(
                f"{name}'s {image} is seat {key[:8]}, whose tone curve is lost "
                f"({tones[key].why}), so no link to it is exact"
            )
            continue
        answer = emitted[key]
        if not answer.get("ok"):
            found.append(f"{name}'s {image} is seat {key[:8]}, which has no link: {answer['why']}")
        elif strips[name][image] != answer["link"]:
            found.append(
                f"{name}'s {image} links {strips[name][image]}, and seat {key[:8]}'s recipe "
                f"is {answer['link']}"
            )
    return found
