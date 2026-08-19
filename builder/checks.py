"""The checks the bootstrap did by hand, made mechanical.

Five of them, all read-only:

- **links** — every internal href and src on every page resolves to a file that exists,
  and none is root-absolute. The site is served from `/fractal-website/`, so a rooted
  href works locally and breaks only in production: exactly the bug that survives
  review. A link to a bare directory fails too, because a page in this repo has to open
  from the filesystem and `file:///…/galleries/` is a directory listing.
- **pages** — the committed HTML under `galleries/` is byte-identical to what the
  builder produces from today's metadata. What is committed is what is served, so the
  commit is the thing worth checking.
- **figures** — every figure block on an article page matches its registry row exactly,
  and every made figure carries the provenance its picture can be drawn again from.
- **contents** — every hand-written page carries the contents rail the builder derives,
  every prose heading carries the id its own words give it, and the front page's contents
  list marks the same sections done that `sections.jsonl` calls written.
- **assets** — every image the metadata names exists at the size it claims, every
  thumbnail is current, and no orphan file is sitting in a gallery directory.
"""

import re
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote, urldefrag

from . import figures, galleries, images, pages, sections
from .paths import (
    ARTICLE_DIR,
    GALLERIES_DIR,
    GALLERY_METADATA_NAME,
    SITE_INDEX,
    SITE_ROOT,
    THUMBS_DIR_NAME,
    site_pages,
)

_SCHEME = re.compile(r"^[a-zA-Z][a-zA-Z0-9+.\-]*:")
_FIGURE_ID = re.compile(r'data-figure="([^"]*)"')
_FIGURE_OPEN = re.compile(r"<figure class=\"figure\"(?![^>]*data-figure=)")


class _Links(HTMLParser):
    """Every href and src on a page, with the line each sits on."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.found: list[tuple[int, str, str]] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        for name, value in attrs:
            if name in ("href", "src") and value is not None:
                self.found.append((self.getpos()[0], name, value))


def _read(path: Path) -> str:
    with path.open(encoding="utf-8", newline="") as handle:
        return handle.read()


def _shown(path: Path) -> str:
    return path.relative_to(SITE_ROOT).as_posix()


def check_links() -> list[str]:
    problems = []
    for page in site_pages():
        parser = _Links()
        parser.feed(_read(page))
        where = _shown(page)
        for line, attribute, value in parser.found:
            problem = _link_problem(page, attribute, value)
            if problem:
                problems.append(f"{where}:{line}: {problem}")
    return problems


def _link_problem(page: Path, attribute: str, value: str) -> str | None:
    raw = value.strip()
    if not raw:
        return f"empty {attribute}"
    if raw.startswith("#") or raw.startswith("//") or _SCHEME.match(raw):
        return None
    if raw.startswith("/"):
        return f"root-absolute {attribute}={raw!r} — breaks under the /fractal-website/ subpath"
    target, _ = urldefrag(raw)
    target = unquote(target.split("?", 1)[0])
    if not target:
        return None
    resolved = (page.parent / target).resolve()
    try:
        resolved.relative_to(SITE_ROOT)
    except ValueError:
        return f"{attribute}={raw!r} leaves the site tree"
    if resolved.is_dir():
        return f"{attribute}={raw!r} names a directory — name the file, so the page opens from disk"
    if not resolved.is_file():
        return f"{attribute}={raw!r} does not resolve ({_shown_missing(resolved)})"
    return None


def _shown_missing(path: Path) -> str:
    try:
        return f"no {path.relative_to(SITE_ROOT).as_posix()}"
    except ValueError:  # pragma: no cover - guarded by the caller
        return "outside the site"


def check_pages(loaded: list[galleries.Gallery], article: list[sections.Section]) -> list[str]:
    problems = []
    expected = pages.generated_pages(loaded, article)
    for path, html in expected.items():
        if not path.is_file():
            problems.append(f"{_shown(path)}: missing — run `python -m builder build`")
        elif _read(path) != html:
            problems.append(f"{_shown(path)}: differs from builder output — run `build`")
    for path in sorted(GALLERIES_DIR.glob("*.html")):
        if path not in expected:
            problems.append(f"{_shown(path)}: no gallery metadata produces this page")
    return problems


def check_figures() -> list[str]:
    problems = []
    registry = figures.load_all()

    for page in sorted(ARTICLE_DIR.glob("*.html")):
        html = _read(page)
        where = _shown(page)
        if _FIGURE_OPEN.search(html):
            problems.append(f"{where}: a figure without a data-figure id")
        for identifier in _FIGURE_ID.findall(html):
            figure = registry.get(identifier)
            if figure is None:
                problems.append(f"{where}: figure {identifier!r} is not in the registry")
            elif figures.markup(figure) not in html:
                problems.append(
                    f"{where}: figure {identifier!r} does not match the registry — "
                    f"`python -m builder figure {identifier}`"
                )

    for figure in registry.values():
        if figure.pending:
            continue
        if not figure.path.is_file():
            problems.append(f"figures.jsonl: {figure.id} names a missing {figure.file}")
        elif images.available():
            actual = images.dimensions(figure.path)
            if actual != (figure.width, figure.height):
                problems.append(
                    f"figures.jsonl: {figure.id} says {figure.width}x{figure.height}, "
                    f"{figure.file} is {actual[0]}x{actual[1]}"
                )
    return problems


def check_contents(article: list[sections.Section]) -> list[str]:
    problems = []
    listed = {section.page for section in article}
    for path in sorted(ARTICLE_DIR.glob("*.html")):
        if path.name not in listed:
            problems.append(f"{_shown(path)}: not in sections.jsonl, so the rail would skip it")

    for path in sections.hand_written(article):
        html = _read(path)
        where = _shown(path)
        if sections.RAIL_START not in html or sections.RAIL_END not in html:
            problems.append(f"{where}: no contents-rail markers — the page skeleton carries them")
            continue
        if sections.with_heading_ids(html) != html:
            problems.append(
                f"{where}: a prose heading's id is not the one its words give it — run `build`"
            )
        if sections.with_rail(path, html, article) != html:
            problems.append(f"{where}: the contents rail is not today's — run `build`")

    return problems + _index_markers(article)


def _index_markers(article: list[sections.Section]) -> list[str]:
    """The front page's contents list marks what `sections.jsonl` calls written.

    The rail is generated; these markers are typed, because they sit inside prose the
    builder does not touch. So the flag still lives in one place and drifting from it is a
    failing check rather than something a reader notices. An entry is one `<h3>` on one
    line — the same shape the contents list has always had, and what makes the marker
    findable without parsing the page.
    """
    problems = []
    lines = _read(SITE_INDEX).splitlines()
    for section in article:
        href = f'href="article/{section.page}"'
        entry = next((line for line in lines if "<h3>" in line and href in line), None)
        if entry is None:
            problems.append(f"index.html: no one-line <h3> entry in the contents links {href}")
        elif (sections.DONE in entry) != section.written:
            wanted = "carry the done marker" if section.written else "not be marked done"
            problems.append(f"index.html: the {section.title} entry should {wanted}")
    return problems


def check_assets(loaded: list[galleries.Gallery]) -> list[str]:
    problems = []
    can_measure = images.available()
    for gallery in loaded:
        named = {image.file for image in gallery.images}
        for image in gallery.images:
            source = gallery.directory / image.file
            thumb = gallery.thumbs_directory / image.file
            if not source.is_file():
                problems.append(f"{_shown(gallery.metadata_path)}: no {image.file}")
                continue
            if can_measure and images.dimensions(source) != (image.width, image.height):
                actual = images.dimensions(source)
                problems.append(
                    f"{_shown(source)}: metadata says {image.width}x{image.height}, "
                    f"file is {actual[0]}x{actual[1]}"
                )
            if not thumb.is_file():
                problems.append(f"{_shown(thumb)}: missing — run `python -m builder build`")
            elif can_measure and images.dimensions(thumb) != image.thumb_size:
                problems.append(f"{_shown(thumb)}: not the size the page expects — run `build`")
        problems.extend(_orphans(gallery, named))
    return problems


def _orphans(gallery: galleries.Gallery, named: set[str]) -> list[str]:
    problems = []
    for path in sorted(gallery.directory.iterdir()):
        if path.is_dir():
            if path.name != THUMBS_DIR_NAME:
                problems.append(f"{_shown(path)}: unexpected directory in a gallery")
            continue
        if path.name != GALLERY_METADATA_NAME and path.name not in named:
            problems.append(f"{_shown(path)}: not named by {GALLERY_METADATA_NAME}")
    if gallery.thumbs_directory.is_dir():
        for path in sorted(gallery.thumbs_directory.iterdir()):
            if path.name not in named:
                problems.append(f"{_shown(path)}: thumbnail of an image no longer in the gallery")
    return problems


def run_all() -> dict[str, list[str]]:
    """Every check, named, so a failure says which one."""
    loaded = galleries.load_all()
    article = sections.load_all()
    return {
        "links": check_links(),
        "pages": check_pages(loaded, article),
        "contents": check_contents(article),
        "figures": check_figures(),
        "assets": check_assets(loaded),
    }
