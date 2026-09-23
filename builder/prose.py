"""The prose master behind a page, and the two ways of reading a page's own words.

Article prose is written and reviewed as a document — a markdown *master* in the
Drive-synced working folder — and then placed as hand-written HTML. Two copies of the
same words is a drift waiting to happen, so the copies are held together mechanically:
`python -m builder prose` reduces both sides the same way — tags out, markdown markers
out, whitespace collapsed — and reports the first word they disagree on. That check ran
as a one-page script under `scratch/` and died with the session that wrote it; here it
is one command that knows about every page.

`article/prose.jsonl` says which master belongs to which page. A page with no row is a
page whose HTML is its own master — legitimate, and said out loud rather than assumed.

A row may also record *sanctioned divergences*: places where the page deliberately says
something the master does not, because the master was approved before a correction
landed. Each one names the master's words, the page's words, and why — a divergence
nobody wrote down is indistinguishable from a page somebody quietly edited.

The other half of this module reads a page's prose *as served*, block by block, which
is what the review doc is built from. Figures are not prose: a figure block is derived
from the registry, so it appears here as a marker naming its slug and its words are
reviewed with the other captions.
"""

import html as html_module
import re
from dataclasses import dataclass, replace
from html.parser import HTMLParser
from pathlib import Path

from . import records
from .paths import PROSE_REGISTRY, carrier_path
from .settings import local

#: Where the Drive-synced working folder is. The variable wins over `local.toml`.
DRIVE_KEY = "drive_sync_root"
DRIVE_VARIABLE = "FRACTAL_DRIVE_SYNC_ROOT"

#: What the working folder holds: the approved masters, and the review docs built here.
PROSE_DIR_NAME = "prose"
REVIEW_DIR_NAME = "review"
APPLIED_DIR_NAME = "applied"

_PROSE_SECTION = re.compile(r'<section class="prose">(.*?)\n  </section>', re.S)
_MAIN = re.compile(r"<main>(.*?)\n</main>", re.S)
_FIGURE = re.compile(r"<figure .*?</figure>", re.S)
_COMMENT = re.compile(r"<!--.*?-->", re.S)
_THEAD = re.compile(r"<thead>.*?</thead>", re.S)
_CELL = re.compile(r"</t[dh]>")
_TAG = re.compile(r"<[^>]*>")
_STANDFIRST = re.compile(r'<p class="standfirst">(.*?)</p>', re.S)
_TITLE = re.compile(r"<h1[^>]*>(.*?)</h1>", re.S)

_MASTER_TITLE = re.compile(r"^# .*?\n")
_MASTER_EDITORIAL = re.compile(r"<editorial,.*?>\n", re.S)
_MASTER_COMMENT = re.compile(r"<!--.*?-->", re.S)
_MASTER_FIGURE = re.compile(r"^\[FIGURE:.*?\]$", re.M)
_MASTER_TABLE = re.compile(r"^\[TABLE:[^\]]*\]\n(.*?)^\[/TABLE\]$", re.S | re.M)
_MASTER_PENDING = re.compile(r"\[PENDING —.*?\]", re.S)
_MASTER_BULLET = re.compile(r"^- ", re.M)
_MARKDOWN_LINK = re.compile(r"\[([^\]]+)\]\([^)]*\)")
_WIKI_LINK = re.compile(r"\[([^\]]+)\]")
_INLINE_TAG = re.compile(r"</?(?:i|em|b|strong|code|sub|sup)>")


class ProseError(Exception):
    """A master could not be found, or the page and the master disagree."""


@dataclass(frozen=True)
class Divergence:
    """One sanctioned difference: what the master says, what the page says, and why."""

    master: str
    page: str
    why: str


@dataclass(frozen=True)
class Master:
    """The approved document a page was placed from."""

    page: str
    file: str
    divergences: tuple[Divergence, ...]

    @property
    def page_path(self) -> Path:
        return carrier_path(self.page)

    @property
    def path(self) -> Path:
        """Where the master is on this machine — outside the checkout, always."""
        return prose_dir() / self.file


def drive_root() -> Path:
    """The Drive-synced working folder, or a refusal naming both ways to say where."""
    root = local(DRIVE_KEY, DRIVE_VARIABLE)
    if root is None:
        raise ProseError(
            "the Drive-synced working folder is not configured. Set the "
            f"{DRIVE_VARIABLE} environment variable, or put "
            f'`{DRIVE_KEY} = "..."` in local.toml at the root of this repository — '
            "untracked, because no absolute path is committed here."
        )
    if not root.is_dir():
        raise ProseError(f"{root} is configured as the working folder, and is not there")
    return root


def prose_dir() -> Path:
    return drive_root() / PROSE_DIR_NAME


def review_dir() -> Path:
    return drive_root() / REVIEW_DIR_NAME


def applied_dir() -> Path:
    return review_dir() / APPLIED_DIR_NAME


def load_all() -> dict[str, Master]:
    """Every page that has an approved master, keyed by page."""
    if not PROSE_REGISTRY.is_file():
        return {}
    masters: dict[str, Master] = {}
    for row in records.read(PROSE_REGISTRY):
        row.expect_kind("prose")
        page = row.text("page")
        if page in masters:
            raise records.RecordError(f"{row.where}: {page} names two masters")
        masters[page] = Master(page=page, file=row.text("file"), divergences=_divergences(row))
    return masters


def _divergences(row: records.Record) -> tuple[Divergence, ...]:
    stated = row.fields.get("divergences")
    if stated is None:
        return ()
    if not isinstance(stated, list) or not stated:
        raise records.RecordError(f"{row.where}: divergences must be a non-empty list")
    found = []
    for entry in stated:
        if not isinstance(entry, dict) or set(entry) != {"master", "page", "why"}:
            raise records.RecordError(
                f"{row.where}: a divergence is master, page and why — nothing else, "
                "and nothing missing"
            )
        if not all(isinstance(value, str) and value.strip() for value in entry.values()):
            raise records.RecordError(f"{row.where}: every part of a divergence is a phrase")
        found.append(Divergence(master=entry["master"], page=entry["page"], why=entry["why"]))
    return tuple(found)


# ------------------------------------------------------------------- the verbatim check


def read_page(page: str) -> str:
    path = carrier_path(page)
    if not path.is_file():
        raise ProseError(f"no page at {page}")
    with path.open(encoding="utf-8", newline="") as handle:
        return handle.read()


def prose_html(page_html: str) -> str | None:
    """The page's prose section, or `None` for a stub that has none yet."""
    found = _PROSE_SECTION.search(page_html)
    return None if found is None else found.group(1)


def words_of_page(page_html: str) -> str:
    """The page's prose reduced to words: no figures, no comments, no tags.

    Figures are excluded because captions are written at placement rather than carried
    from the master, and comments because a page carries the master's pending notes on
    purpose.

    A table's **body** is prose and is compared; its header row is not. A master spells a
    table `[TABLE: a | b | c]`, rows, `[/TABLE]` — the marker line names the columns the
    way `[FIGURE: id]` names a slug, and the words a `<th>` actually carries are the
    page's own, chosen at placement. So the head comes out on both sides and the cells
    are compared with a space between them, which is what a cell boundary is worth: `<td>`
    tags vanish with every other tag, and without this `314` and `708` would reduce to
    `314708` and a wrong number could hide inside a right one.
    """
    return _reduced(prose_html(page_html) or "")


def _reduced(body: str) -> str:
    """The reduction itself: figures, comments and table heads out, then every tag."""
    body = _FIGURE.sub("", body)
    body = _COMMENT.sub("", body)
    body = _THEAD.sub("", body)
    body = _CELL.sub(" ", body)
    return " ".join(html_module.unescape(_TAG.sub("", body)).split())


def words_of_body(page_html: str) -> str:
    """A page's own words, reduced the way `words_of_page` reduces a section's.

    The same reduction, over a wider set of pages. An article section keeps its words in
    `<section class="prose">` and is compared to a master; the front page and the gallery
    index have no master and no prose section, and their words — a lead, twelve blurbs,
    two pointers — are read by exactly the same reader. So where there is no prose
    section this falls back to `<main>`, which on those two pages is all of it and on an
    article page would also carry the section nav.

    The contents rail sits outside `<main>` and is not read here, which is right twice
    over: it is derived by `build` rather than written, and its words are other pages'
    titles.
    """
    body = prose_html(page_html)
    if body is None:
        found = _MAIN.search(page_html)
        body = "" if found is None else found.group(1)
    return _reduced(body)


def words_of_master(text: str, divergences: tuple[Divergence, ...] = ()) -> str:
    """The master reduced the same way: title, editorial block and markers all out.

    A `[TABLE: ...]` block keeps its rows and loses its two marker lines and its column
    separators, so it lands on the same words the page's `<tbody>` does.

    A list marker goes the way every other markdown marker here goes. `#`, `*` and a
    backtick are already dropped as markup rather than as words, and a `- ` opening a
    line is the same kind of thing: the page spells that list as `<li>`, whose tags
    vanish with every other tag, so leaving the hyphen in would part the two sides on a
    character neither of them is prose.

    `<sub>` and `<sup>` are on that list for the same reason `<i>` is: a master sets its
    inline mathematics as HTML, because the alternative — a Unicode superscript on one
    side and a tag on the other — is two spellings that reduce to two different words.

    An HTML comment goes out here for the reason it goes out of the page: a master's
    standing note to whoever places it — *this number wants re-checking against a run
    nobody has made yet* — is carried across to the page as a comment on purpose, and it
    is prose on neither side.
    """
    text = _MASTER_TITLE.sub("", text, count=1)
    text = _MASTER_EDITORIAL.sub("", text)
    text = _MASTER_COMMENT.sub("", text)
    text = _MASTER_FIGURE.sub("", text)
    text = _MASTER_TABLE.sub(lambda found: found.group(1).replace("|", " "), text)
    text = _MASTER_PENDING.sub("", text)
    text = _MASTER_BULLET.sub("", text)
    for divergence in divergences:
        text = text.replace(divergence.master, divergence.page)
    text = _MARKDOWN_LINK.sub(r"\1", text)
    text = _WIKI_LINK.sub(r"\1", text)
    text = _INLINE_TAG.sub("", text)
    text = text.replace("*", "").replace("`", "").replace("#", "")
    return " ".join(text.split())


@dataclass(frozen=True)
class Comparison:
    """What one page's words and its master's words came to."""

    page: str
    master: str
    words: int
    difference: str | None

    @property
    def matches(self) -> bool:
        return self.difference is None


def compare(page: str, master: Master) -> Comparison:
    """Hold one page to its master, word for word."""
    if not master.path.is_file():
        raise ProseError(f"{master.file}: no such master in {prose_dir()}")
    approved = words_of_master(master.path.read_text(encoding="utf-8"), master.divergences)
    placed = words_of_page(read_page(page))
    return Comparison(
        page=page,
        master=master.file,
        words=len(approved.split()),
        difference=_difference(approved, placed),
    )


def _difference(approved: str, placed: str) -> str | None:
    """The first place the two sides part, in the words around it, or `None`."""
    left, right = approved.split(), placed.split()
    for index, (a, b) in enumerate(zip(left, right, strict=False)):
        if a != b:
            window = slice(max(0, index - 8), index + 8)
            return (
                f"first difference at word {index}\n"
                f"  master: {' '.join(left[window])}\n"
                f"  page  : {' '.join(right[window])}"
            )
    if len(left) == len(right):
        return None
    longer, tail = (
        ("master", left[len(right) :])
        if len(left) > len(right)
        else (
            "page",
            right[len(left) :],
        )
    )
    return (
        f"the {longer} runs longer: master {len(left)} words, page {len(right)}\n"
        f"  {longer} tail: {' '.join(tail[:40])}"
    )


# ------------------------------------------------------- a page's prose, block by block


@dataclass(frozen=True)
class Block:
    """One piece of a page's prose as served, flattened to its words.

    `kind` is what the piece is — a heading, a paragraph, a bullet, a line of code, a
    table row, or the marker standing where a figure sits. `text` is what it says with
    every tag gone; italics and code spans are flattened, because a review doc is read
    and marked up as text and the markup is re-applied on this side.

    `links` keeps the one piece of markup a reader of the doc wants to follow: each
    link's words, as they read in `text`, and its href as the page spells it. A figure
    block's `caption` is its `<figcaption>` as the page carries it, which is the only
    copy a placeholder with no registry row has.
    """

    kind: str
    text: str
    links: tuple[tuple[str, str], ...] = ()
    caption: str = ""


HEADING = "heading"
PARAGRAPH = "paragraph"
BULLET = "bullet"
CODE = "code"
ROW = "row"
FIGURE = "figure"


class _Reader(HTMLParser):
    """A page's prose section, read into blocks in the order a reader meets them."""

    _BLOCKS = {"h2": HEADING, "p": PARAGRAPH, "li": BULLET, "pre": CODE}

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.blocks: list[Block] = []
        self._kind: str | None = None
        self._parts: list[str] = []
        self._cells: list[str] | None = None
        self._depth = 0
        self._links: list[tuple[str, str]] = []
        self._href: str | None = None
        self._anchor: list[str] = []
        self._caption: list[str] | None = None

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag == "figure":
            self._depth += 1
            given = dict(attrs)
            identifier = given.get("data-figure") or given.get("data-placeholder") or "unregistered"
            self.blocks.append(Block(FIGURE, identifier))
            return
        if self._depth:
            if tag == "figcaption":
                self._caption = []
            return
        if tag == "a" and self._kind is not None:
            self._href, self._anchor = dict(attrs).get("href"), []
        elif tag == "tr":
            self._cells, self._links = [], []
        elif tag in ("td", "th"):
            self._kind, self._parts = ROW, []
        elif tag in self._BLOCKS:
            self._kind, self._parts, self._links = self._BLOCKS[tag], [], []

    def handle_endtag(self, tag: str) -> None:
        if tag == "figure":
            self._depth = max(0, self._depth - 1)
            return
        if self._depth:
            if tag == "figcaption" and self._caption is not None and self.blocks:
                caption = " ".join("".join(self._caption).split())
                self.blocks[-1] = replace(self.blocks[-1], caption=caption)
                self._caption = None
            return
        if tag == "a" and self._href is not None:
            anchor = " ".join("".join(self._anchor).split())
            if anchor:
                self._links.append((anchor, self._href))
            self._href = None
        elif tag in ("td", "th") and self._cells is not None:
            self._cells.append(self._text())
            self._kind = None
        elif tag == "tr" and self._cells is not None:
            self.blocks.append(Block(ROW, " | ".join(self._cells), tuple(self._links)))
            self._cells, self._links = None, []
        elif tag in self._BLOCKS and self._kind == self._BLOCKS[tag]:
            text = self._text()
            if text:
                self.blocks.append(Block(self._kind, text, tuple(self._links)))
            self._kind, self._links = None, []

    def handle_data(self, data: str) -> None:
        if self._depth:
            if self._caption is not None:
                self._caption.append(data)
        elif self._kind is not None:
            self._parts.append(data)
            if self._href is not None:
                self._anchor.append(data)

    def _text(self) -> str:
        return " ".join("".join(self._parts).split())


def blocks_of(page_html: str) -> list[Block]:
    """A page's prose as blocks: what a review doc shows, in reading order."""
    body = prose_html(page_html)
    if body is None:
        return []
    reader = _Reader()
    reader.feed(_COMMENT.sub("", body))
    reader.close()
    return reader.blocks


def title_of(page_html: str) -> str:
    found = _TITLE.search(page_html)
    return "" if found is None else _flat(found.group(1))


def standfirst_of(page_html: str) -> str:
    found = _STANDFIRST.search(page_html)
    return "" if found is None else _flat(found.group(1))


def _flat(markup: str) -> str:
    return " ".join(html_module.unescape(_TAG.sub("", markup)).split())
