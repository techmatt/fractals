"""Whether every stored explorer link names each of its keys once.

*(duplicate_key_links_ckpt154)* The explorer told Matt *"the link gives f twice, and there
is no rule for which wins"*. No record here carried such a link: it was the Dive block's
Paste, which read a text holding one link twice as one query naming every key twice, and
`permalink.js`'s `firstQuery` is where that was fixed. The readers now take a key named
twice with one value as the key named once, and refuse a key named twice with two values in
the reader's words. So a stored link with a repeated key would still open, or still be
refused, and either way it is a writer somewhere that appended a key where it should have
set one. This check is what says so before a reader does.

What it reads is every record this repository keeps a link in, walked value by value, so a
field added to one later is read without this file hearing about it: the figure links, the
figure recipes and registry, every gallery collection, the Deep gallery and the descents
behind it, the atlas partitions, the short links, the Wallpaper packs record, every served
page's hrefs, and this repository's root README. Where the wallpapers checkout is
configured, fractal-wallpapers' root README as well; a named skip elsewhere.
"""

from __future__ import annotations

import html
import json
import re
from pathlib import Path
from urllib.parse import parse_qsl

from . import renders
from .paths import SITE_ROOT, site_pages

#: The records a link is stored in, as globs under the site root.
RECORDS = (
    "explorer/links.jsonl",
    "explorer/deep-gallery.jsonl",
    "article/figure-recipes.jsonl",
    "article/figures.jsonl",
    "assets/images/galleries/*/*.jsonl",
    "atlas/*.jsonl",
    "builder/data/*.jsonl",
    "go/redirects.jsonl",
    "wallpaper-packs/packs.jsonl",
)

#: A query as a record or a page spells one: two or more `key=value` pairs.
QUERY = re.compile(r"^[A-Za-z_]+=[^&]*(?:&[A-Za-z_]+=[^&]*)+$")

#: An explorer link in a page or a README: whatever follows `explorer/` and a `?`.
EXPLORER = re.compile(r'explorer/(?:index\.html)?\?([^"\s)<>`\]\']+)')


def query_of(text: str) -> str | None:
    """The query a stored string carries, or `None` where it carries none."""
    held = text.split("#", 1)[0]
    if "?" in held:
        held = held.split("?", 1)[1]
    return held if QUERY.match(held) else None


def repeated(query: str) -> list[str]:
    """The keys a query names more than once, in the order they first repeat."""
    seen: set[str] = set()
    found: list[str] = []
    for key, _ in parse_qsl(query, keep_blank_values=True):
        if key in seen and key not in found:
            found.append(key)
        seen.add(key)
    return found


def _strings(value) -> list[str]:
    """Every string anywhere inside a record, however deep."""
    if isinstance(value, str):
        return [value]
    if isinstance(value, dict):
        return [text for held in value.values() for text in _strings(held)]
    if isinstance(value, list):
        return [text for held in value for text in _strings(held)]
    return []


def _record_queries(path: Path) -> list[tuple[str, str]]:
    found = []
    where = path.relative_to(SITE_ROOT).as_posix()
    for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        if not line.strip():
            continue
        for text in _strings(json.loads(line)):
            query = query_of(text)
            if query is not None:
                found.append((f"{where}:{number}", query))
    return found


def _text_queries(where: str, text: str) -> list[tuple[str, str]]:
    return [(where, html.unescape(query)) for query in EXPLORER.findall(text)]


def stored(*, with_checkout: bool) -> list[tuple[str, str]]:
    """Every stored explorer link, as `(where, query)`."""
    found: list[tuple[str, str]] = []
    for pattern in RECORDS:
        for path in sorted(SITE_ROOT.glob(pattern)):
            found += _record_queries(path)
    for page in site_pages():
        where = page.relative_to(SITE_ROOT).as_posix()
        found += _text_queries(where, page.read_text(encoding="utf-8"))
    readmes = {"README.md": SITE_ROOT / "README.md"}
    if with_checkout:
        readmes["fractal-wallpapers' README.md"] = renders.wallpapers_root() / "README.md"
    for name, path in readmes.items():
        found += _text_queries(name, path.read_text(encoding="utf-8"))
    return found


def problems(*, with_checkout: bool) -> list[str]:
    """Every stored link that names a key more than once."""
    return [
        f"{where}: names {', '.join(keys)} more than once: {query[:120]}"
        for where, query in stored(with_checkout=with_checkout)
        if (keys := repeated(query))
    ]
