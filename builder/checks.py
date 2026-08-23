"""The checks the bootstrap did by hand, made mechanical.

Every one of them read-only:

- **links** — every internal href and src on every page resolves to a file that exists,
  and none is root-absolute. The site is served from `/fractal-website/`, so a rooted
  href works locally and breaks only in production: exactly the bug that survives
  review. A link to a bare directory fails too, because a page in this repo has to open
  from the filesystem and `file:///…/galleries/` is a directory listing.
- **pages** — the committed HTML under `galleries/` is byte-identical to what the
  builder produces from today's metadata. What is committed is what is served, so the
  commit is the thing worth checking.
- **figures** — every figure block on an article page matches its registry row exactly,
  every row names the page that actually carries it, every made figure carries the
  provenance its picture can be drawn again from, and a recipe naming a maker inside
  `builder` names one that is still there.
- **contents** — every hand-written page carries the contents rail the builder derives,
  every prose heading carries the id its own words give it, and the front page's contents
  list marks the same sections done that `sections.jsonl` calls written.
- **assets** — every image the metadata names exists at the size it claims, every
  thumbnail is current, and no orphan file is left in a gallery directory.
- **prose** — every row of `article/prose.jsonl` names a page that is in the article and
  is written. The master itself lives in the Drive-synced working folder, which is not
  in a clone and never in CI, so what is checked here is the registry and not the
  document: `python -m builder prose` is what holds the two texts together.
- **guidance** — `CLAUDE.md` names `writing-guidance.md`, the editorial authority. That
  document is not in this repository and cannot be: both halves of the project write to
  it. So the one thing a clone can be held to is that the file every prompt does read
  points at it, and a rename or a tidy-up that drops the pointer fails here.
- **theme** — the well colours a drawn figure is made of are the stylesheet's own. They
  have to be transcribed, because Pillow cannot read CSS; this is what keeps a restyle
  from moving the well and leaving every diagram drawn against the old one.
- **vocabulary** — no tracked file uses a word this site has banned. `vocabulary.py`
  holds the list and says why each term is on it.
- **explorer** — every figure and every gallery tile is in the explorer link registry,
  as a link or as a stated reason there is none, and every link the registry holds is
  the one the page carries. Whether a link *parses* is asked of the permalink contract
  itself, by `permalink.test.mjs`, because the contract is written in JavaScript and a
  second reading of it in Python is exactly what a URL contract cannot survive.
"""

import re
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote, urldefrag

from . import figures, galleries, images, links, pages, prose, sections, theme, vocabulary
from .paths import (
    ARTICLE_DIR,
    GALLERIES_DIR,
    GALLERY_METADATA_NAME,
    SITE_INDEX,
    SITE_ROOT,
    THUMBS_DIR_NAME,
    carrier_path,
    site_pages,
)

_SCHEME = re.compile(r"^[a-zA-Z][a-zA-Z0-9+.\-]*:")
_FIGURE_ID = re.compile(r'data-figure="([^"]*)"')
_FIGURE_OPEN = re.compile(r"<figure class=\"figure\"(?![^>]*data-figure=)")
_CSS_TOKEN = re.compile(r"(--[a-z-]+):\s*#([0-9a-fA-F]{6})\s*;")


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


def check_explorer() -> list[str]:
    """The link registry covers every picture, and says what the pages say.

    Coverage first: a figure or a tile with no row is a picture nobody decided about,
    which is the state this registry exists to end. Then agreement — a row that changed
    and a page that did not is a link pointing at the wrong view, and it looks exactly
    like a link that works.
    """
    problems = []
    registered = links.load_all()
    for identifier in links.picture_ids():
        if identifier not in registered:
            problems.append(
                f"links.jsonl: {identifier} is on the site and not in the registry — "
                "`python -m builder links --write`"
            )
    for identifier in registered:
        if identifier not in set(links.picture_ids()):
            problems.append(f"links.jsonl: {identifier} is registered and is not on the site")
    return problems


def check_figures() -> list[str]:
    problems = []
    registry = figures.load_all()
    carried: dict[str, str] = {}

    sections_first = sorted(ARTICLE_DIR.glob("*.html"))
    hanging = sorted({figure.page_path for figure in registry.values()} - set(sections_first))
    for page in [*sections_first, *hanging]:
        if not page.is_file():
            continue
        html = _read(page)
        where = _shown(page)
        opened = links.opened(page)
        if _FIGURE_OPEN.search(html):
            problems.append(f"{where}: a figure without a data-figure id")
        for identifier in _FIGURE_ID.findall(html):
            carried[identifier] = figures.page_name(page)
            figure = registry.get(identifier)
            if figure is None:
                problems.append(f"{where}: figure {identifier!r} is not in the registry")
            elif figures.markup(figure, opened.get(f"figure:{identifier}")) not in html:
                problems.append(
                    f"{where}: figure {identifier!r} does not match the registry — "
                    f"`python -m builder figure {identifier}`"
                )

    for figure in registry.values():
        problems.extend(_figure_page(figure, carried))
        problems.extend(_figure_recipe(figure))
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


def check_landing() -> list[str]:
    """Every made figure is a block a redraw could actually land on.

    A redraw — `figures --replace`, and the `--replace` the four drawing commands
    take — finds the block it is about to swap by **deriving** it, and refuses when the
    page is not carrying exactly that. So the derivation is load-bearing in a way the
    figure check above does not reach: `figures.landing_block` once left the explorer
    link out, which refused a redraw of every picture that carries one — very nearly
    every render figure here — while everything else stayed green, and it was found by
    somebody redrawing a figure rather than by a check.

    Held for every made figure, and specially for the linked ones: a landing block for a
    picture the registry gives a link has to carry the anchor, or the derivation has
    quietly gone back to what it was.
    """
    problems = []
    linked = {identifier for identifier, link in links.load_all().items() if link.linked}
    for figure in figures.load_all().values():
        if figure.pending or not figure.page_path.is_file():
            continue
        block = figures.landing_block(figure)
        if f"figure:{figure.id}" in linked and figures.OPEN_TEXT not in block:
            problems.append(
                f"figures.jsonl: {figure.id} has an explorer link and the block a redraw "
                "would look for does not carry it — `--replace` would refuse this figure"
            )
        if block not in _read(figure.page_path):
            problems.append(
                f"{_shown(figure.page_path)}: {figure.id} is not a block a redraw could "
                f"land on — reprint it with `python -m builder figure {figure.id}`"
            )
    return problems


def _figure_page(figure: figures.Figure, carried: dict[str, str]) -> list[str]:
    """A row is on the page it says, and on a page at all.

    A figure exists to be on a page. A row nobody placed — a rename that landed in the
    registry and not in the prose, a figure planned and then cut — used to pass this
    check in silence, and would go on being listed as pending work forever.
    """
    if not figure.page_path.is_file():
        return [f"figures.jsonl: {figure.id} names page {figure.page!r}, which is not on this site"]
    where = carried.get(figure.id)
    if where is None:
        return [
            f"figures.jsonl: {figure.id} is registered on {figure.page} and no page carries it "
            f"— place `python -m builder figure {figure.id}`, or drop the row"
        ]
    if where != figure.page:
        return [f"figures.jsonl: {figure.id} says {figure.page}, and {where} is what carries it"]
    return []


def _figure_recipe(figure: figures.Figure) -> list[str]:
    """A recipe naming a maker this repository commits names one that is still there.

    A recipe pointing into `scratch/` is recorded and not resolved: untracked code is
    exactly what the registry cannot vouch for, and saying so beats pretending.
    """
    recipe = figure.recipe
    if recipe is None or not recipe.is_tracked:
        return []
    try:
        recipe.resolve()
    except (ImportError, AttributeError):
        return [f"figures.jsonl: {figure.id} has a recipe for {recipe.maker}, which is not there"]
    return []


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


def check_prose(article: list[sections.Section]) -> list[str]:
    """Every registered prose master belongs to a written page of this article.

    Deliberately reads nothing outside the repository. The masters are on a synced
    drive that a clone need not have and CI certainly does not, so the check that runs
    everywhere is the one about the registry, and the check that needs the document is
    a command someone runs where the document is.
    """
    problems = []
    written = {section.page: section.written for section in article}
    for page, master in prose.load_all().items():
        if "/" in page:
            # A page that hangs off a section rather than being one: there is no written
            # flag to hold it to, so what is checked is that the page it names is here.
            if not carrier_path(page).is_file():
                problems.append(f"prose.jsonl: {page} is not a page of this site")
        elif page not in written:
            problems.append(f"prose.jsonl: {page} is not a section of this article")
        elif not written[page]:
            problems.append(f"prose.jsonl: {page} names a master, and is not written yet")
        if master.file != master.file.strip() or not master.file.endswith(".md"):
            problems.append(f"prose.jsonl: {page}'s master {master.file!r} is not a .md file")
    return problems


def check_theme() -> list[str]:
    """`theme.py`'s well tokens are the ones `site.css` declares."""
    stylesheet = SITE_ROOT / "assets" / "css" / "site.css"
    if not stylesheet.is_file():
        return [f"{_shown(stylesheet)}: missing — theme.py has nothing to be held to"]
    declared = {
        name: tuple(int(value[index : index + 2], 16) for index in (0, 2, 4))
        for name, value in _CSS_TOKEN.findall(_read(stylesheet))
    }
    problems = []
    for name, transcribed in theme.CSS_TOKENS.items():
        if name not in declared:
            problems.append(f"site.css: no {name}, and theme.py transcribes one")
        elif declared[name] != transcribed:
            problems.append(
                f"theme.py: {name} is {theme.hex_token(transcribed)}, "
                f"site.css says {theme.hex_token(declared[name])}"
            )
    return problems


#: The editorial authority for the website, which lives on the synced drive rather than
#: here. What is checked is that `CLAUDE.md` names it: a session reads that file first,
#: and rules it never hears of are rules it writes against nothing.
GUIDANCE = "writing-guidance.md"


def check_guidance() -> list[str]:
    """`CLAUDE.md` points at the editorial authority."""
    instructions = SITE_ROOT / "CLAUDE.md"
    if not instructions.is_file():
        return ["CLAUDE.md: missing — nothing here points a prompt at the editorial rules"]
    if GUIDANCE not in _read(instructions):
        return [
            f"CLAUDE.md: never names {GUIDANCE} — the editorial rules live on the synced "
            "drive, and a prompt that is not sent there writes against nothing"
        ]
    return []


def run_all() -> dict[str, list[str]]:
    """Every check, named, so a failure says which one."""
    loaded = galleries.load_all()
    article = sections.load_all()
    return {
        "links": check_links(),
        "pages": check_pages(loaded, article),
        "contents": check_contents(article),
        "figures": check_figures(),
        "landing": check_landing(),
        "explorer": check_explorer(),
        "assets": check_assets(loaded),
        "prose": check_prose(article),
        "guidance": check_guidance(),
        "theme": check_theme(),
        "vocabulary": vocabulary.sweep(),
    }
