"""The article's sections, and the contents rail derived from them.

Order and completion live in `article/sections.jsonl`. Every word the rail shows comes
off the pages themselves: a section's name is its `<h1>`, and the entries that open
beneath the current page are the `<h2>`s of its prose. So the rail cannot drift from the
article — rename a heading and the next `build` renames it everywhere it is listed.

A page carries the rail between two marker comments, the way an article page carries a
figure block: `build` writes what sits between them and `check` re-derives it. The same
pass gives every prose `<h2>` the id its rail entry links to, derived from the heading's
own words — a fragment is a permanent URL, so it is spelled by rule and not by hand.
"""

import html as html_module
import re
from dataclasses import dataclass
from pathlib import Path

from . import records
from .escape import attribute, text
from .paths import ARTICLE_DIR, SECTION_REGISTRY, SITE_INDEX, SITE_ROOT, relative_href

WRITTEN = "written"

RAIL_START = "<!-- contents-rail:start — written by builder/. Run `python -m builder build`. -->"
RAIL_END = "<!-- contents-rail:end -->"

DONE = '<span class="done" role="img" aria-label="written">✓</span>'

#: A page's prose: everything between the opening tag and the **first** `</section>`
#: after it. Nothing inside a prose block may open a `section` of its own, or this stops
#: there and the page loses every heading past that point — which a split figure's bands
#: did for one commit, and `check`'s `contents` caught.
_PROSE = re.compile(r'(<section class="prose">)(.*?)(</section>)', re.S)
_TITLE = re.compile(r"<h1[^>]*>(.*?)</h1>", re.S)
_HEADING = re.compile(r"<h2(?P<attrs>[^>]*)>(?P<title>.*?)</h2>", re.S)
_ID = re.compile(r'\s*\bid="[^"]*"')
_TAG = re.compile(r"<[^>]*>")
_UNSLUGGABLE = re.compile(r"['’]")
_SEPARATORS = re.compile(r"[^a-z0-9]+")
_BLOCK = re.compile(re.escape(RAIL_START) + r".*?" + re.escape(RAIL_END), re.S)


@dataclass(frozen=True)
class Heading:
    """One `<h2>` of a written section: what it says, and the fragment it answers to."""

    id: str
    title: str


@dataclass(frozen=True)
class Section:
    """One article section: its page, its name, whether it is written, and its headings."""

    page: str
    title: str
    written: bool
    headings: tuple[Heading, ...]

    @property
    def path(self) -> Path:
        return ARTICLE_DIR / self.page


def slug(title: str) -> str:
    """A heading's fragment, spelled by rule: lowercase words joined by hyphens."""
    plain = _UNSLUGGABLE.sub("", title.lower())
    return _SEPARATORS.sub("-", plain).strip("-")


def read_page(path: Path) -> str:
    with path.open(encoding="utf-8", newline="") as handle:
        return handle.read()


def _plain(markup: str) -> str:
    """The words of a heading: no tags, no entities, no line breaks."""
    return " ".join(html_module.unescape(_TAG.sub("", markup)).split())


def title_of(page_html: str, page: str) -> str:
    match = _TITLE.search(page_html)
    if match is None:
        raise records.RecordError(f"{page}: no <h1> — a section is named by its title")
    return _plain(match.group(1))


def headings_of(page_html: str) -> tuple[Heading, ...]:
    """The `<h2>`s of the page's prose, in reading order.

    Prose only: a stub's *Figures* block is scaffolding for the section that will be
    written there, not a part of it, and the rail lists what a reader can read.
    """
    prose = _PROSE.search(page_html)
    if prose is None:
        return ()
    found = [
        Heading(slug(_plain(match.group("title"))), _plain(match.group("title")))
        for match in _HEADING.finditer(prose.group(2))
    ]
    return tuple(found)


def with_heading_ids(page_html: str) -> str:
    """The page with every prose `<h2>` carrying the id derived from its own words."""
    prose = _PROSE.search(page_html)
    if prose is None:
        return page_html

    def rewritten(match: re.Match) -> str:
        attrs = _ID.sub("", match.group("attrs")).strip()
        rest = f" {attrs}" if attrs else ""
        identifier = slug(_plain(match.group("title")))
        return f'<h2 id="{attribute(identifier)}"{rest}>{match.group("title")}</h2>'

    body = _HEADING.sub(rewritten, prose.group(2))
    return page_html[: prose.start(2)] + body + page_html[prose.end(2) :]


def load_all() -> list[Section]:
    """Every section, in reading order, read off the registry and the pages together."""
    loaded: list[Section] = []
    seen: set[str] = set()
    for row in records.read(SECTION_REGISTRY):
        row.expect_kind("section")
        page = row.text("page")
        if page in seen:
            raise records.RecordError(f"{row.where}: {page} is listed twice")
        seen.add(page)
        status = row.optional_text("status")
        if status is not None and status != WRITTEN:
            raise records.RecordError(
                f"{row.where}: status {status!r} — the only status is {WRITTEN!r}"
            )
        path = ARTICLE_DIR / page
        if not path.is_file():
            raise records.RecordError(f"{row.where}: no article/{page}")
        page_html = read_page(path)
        headings = headings_of(page_html)
        duplicated = {heading.id for heading in headings}
        if len(duplicated) != len(headings):
            raise records.RecordError(f"{page}: two headings want the same fragment")
        loaded.append(
            Section(
                page=page,
                title=title_of(page_html, page),
                written=status == WRITTEN,
                headings=headings,
            )
        )
    return loaded


def rail(page: Path, sections: list[Section]) -> str:
    """The rail as one page carries it: fourteen sections, this page's own headings open,
    and under them the two places a reader leaves the article for.

    The title is the way back to the front page. It was the one word in the rail that
    named a destination and did not go there, and a reader deep in section six has no
    other one-click way home from the rail itself.
    """
    home = attribute(relative_href(page, SITE_INDEX))
    lines = [
        '<nav class="contents-rail" aria-label="Contents">',
        *_start(page),
        f'  <p class="rail-title"><a href="{home}">Contents</a></p>',
        '  <ol class="rail-sections">',
    ]
    for section in sections:
        here = page.resolve() == section.path.resolve()
        current = ' aria-current="page"' if here else ""
        marker = f" {DONE}" if section.written else ""
        href = attribute(relative_href(page, section.path))
        item = ' class="rail-current"' if here else ""
        entry = f'    <li{item}><a href="{href}"{current}>{text(section.title)}</a>{marker}'
        if not (here and section.headings):
            lines.append(f"{entry}</li>")
            continue
        lines.append(entry)
        lines.append('      <ol class="rail-headings">')
        for heading in section.headings:
            lines.append(
                f'        <li><a href="#{attribute(heading.id)}">{text(heading.title)}</a></li>'
            )
        lines.extend(["      </ol>", "    </li>"])
    lines.append("  </ol>")
    lines.extend(_offsite(page))
    lines.append("</nav>")
    return "\n".join(lines)


#: The page a reader new to the project is sent to first *(start_here_ckpt146)*. It sits in
#: the rail above the contents and is not one of them: it is an outline of the whole
#: project in a few paragraphs, told as how it came about, and the fourteen sections are the
#: article that outline points into. So it is not in `sections.jsonl`, carries no done
#: marker and no place in the reading order, and lives at the site's root beside the front
#: page rather than in `article/`, which holds exactly the fourteen.
START = SITE_ROOT / "start-here.html"

#: What the rail calls it, which is not its title *(start_here_layout_ckpt146)*. The page's
#: `<h1>` names the project, *Making fractal wallpapers*, and the rail names the page by
#: what it is for a reader arriving: the place to start.
START_NAME = "Start here"


def _start(page: Path) -> list[str]:
    """The rail's first entry: the start page, open to its own headings when it is current.

    Opened exactly as a section is, onto its prose `<h2>`s, so a renamed heading moves here
    on the next `build` the way a section's does. Named by `START_NAME` and not its `<h1>`.
    """
    if not START.is_file():
        return []
    start_html = read_page(START)
    here = page.resolve() == START.resolve()
    href = attribute(relative_href(page, START))
    current = ' aria-current="page"' if here else ""
    item = ' class="rail-current"' if here else ""
    entry = f'    <li{item}><a href="{href}"{current}>{text(START_NAME)}</a>'
    headings = headings_of(start_html) if here else ()
    lines = ['  <ul class="rail-start">']
    if not headings:
        lines.append(f"{entry}</li>")
    else:
        lines.append(entry)
        lines.append('      <ol class="rail-headings">')
        for heading in headings:
            lines.append(
                f'        <li><a href="#{attribute(heading.id)}">{text(heading.title)}</a></li>'
            )
        lines.extend(["      </ol>", "    </li>"])
    lines.append("  </ul>")
    return lines


#: What the rail carries under the fourteen sections: the page that runs the engine, and the
#: code the article is about. Both are in the site bar too, and the bar is one line at
#: the very top of a page the reader has scrolled away from — the rail is where a reader
#: is looking when the question "can I try this myself?" arrives.
OFFSITE = (
    ("explorer/index.html", "Fractal explorer"),
    ("https://github.com/techmatt/fractal-wallpapers", "fractal-wallpapers on GitHub"),
)


def _offsite(page: Path) -> list[str]:
    """The two links under the sections, each spelled from the page that carries it."""
    lines = ['  <ul class="rail-links">']
    for target, name in OFFSITE:
        href = target if "//" in target else relative_href(page, SITE_ROOT / target)
        lines.append(f'    <li><a href="{attribute(href)}">{text(name)}</a></li>')
    lines.append("  </ul>")
    return lines


def block(page: Path, sections: list[Section]) -> str:
    """The rail with the markers that say where a page's own hand stops."""
    return "\n".join([RAIL_START, rail(page, sections), RAIL_END])


def with_rail(page: Path, page_html: str, sections: list[Section]) -> str:
    """The page with whatever sits between the markers replaced by today's rail."""
    if _BLOCK.search(page_html) is None:
        raise records.RecordError(
            f"{page.name}: no contents-rail markers — the page skeleton carries them"
        )
    return _BLOCK.sub(lambda _: block(page, sections), page_html, count=1)


#: Pages that are written by hand and carry the rail without being one of the fourteen
#: sections — they hang off a section rather than taking a place in the reading order. Written
#: down here because there is nothing to derive them from: a page's own HTML cannot say
#: "check my rail" and be believed, and the alternative is a rail nothing re-derives.
HANGING = ("palettes/make-your-own.html",)


def hand_written(sections: list[Section]) -> list[Path]:
    """The pages a person writes and the builder only reaches into: index, the start page,
    the sections, and the pages that hang off one."""
    hanging = [SITE_ROOT / page for page in HANGING]
    return [SITE_INDEX, START, *(section.path for section in sections), *hanging]
