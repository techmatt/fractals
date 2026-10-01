"""The description and link-preview tags in every page's `<head>`, derived from the page.

A link pasted into a chat or a post is shown by what the page's `<head>` says about it:
`<meta name="description">`, Open Graph's `og:title`, `og:description`, `og:image` and
`og:url`, and Twitter's `twitter:card`. None of that is typed *(release_polish_ckpt157)*.
Every value is read off the page it describes, the way the rail is read off the sections:

- **The description is the page's own first sentence**, verbatim. The first prose
  paragraph is the first `<p>` inside `<main>` that sits in no `<figure>` and carries no
  `class` — every paragraph of furniture here is classed (a figure's label, a side note, a
  signpost), and a paragraph a person wrote as prose is not. Its words are taken as served:
  tags out, entities read, whitespace collapsed. The first sentence ends at the first `.`,
  `?` or `!` that is followed by a space and a capital, a digit or an opening quote, or at
  the paragraph's end; `e.g. the` is one sentence. Past `DESCRIPTION_MAX` characters it is
  cut at the last sentence end inside it that fits, or failing that at the last clause
  boundary that fits — a comma, a semicolon or a dash — where the boundary becomes a full
  stop; only where neither exists is it cut at the last word boundary that fits, marked
  with an ellipsis. The derivation adds that one character and never a word.
- **A page with no prose paragraph** is a tool, and there is one: the explorer, whose
  every paragraph is a tab's side note. It carries a description its author wrote in its
  head, outside the block, and the block derives `og:description` from that by the same
  rule rather than writing a second `name="description"` beside it. A page that has a
  prose paragraph and an authored description as well is a failing check, because the two
  would disagree about what the page is.
- **`og:image` is the page's first figure**: the first `<img>` inside the first registry
  figure block (`<figure class="figure …" data-figure=…>`) that carries one, which for a
  split figure is its first panel and for a video is the first picture under the player.
  A page with no figure falls back to the site icon's 512-pixel PNG, and the card says
  `summary` rather than `summary_large_image`, because a square icon stretched across a
  wide card is worse than a small one beside the text.
- **`og:title` is the page's `<title>`**, and `og:url` is where the page is served.

⚠ **These are the one place the site spells an absolute URL to itself**, a deliberate,
narrow exception to "relative links, always". A crawler that builds a preview does not
resolve `og:image` or `og:url` against the page, so a relative value there is no value at
all. They are written from `pages.SITE_URL`, and they sit in `content` attributes, which
`check`'s `links` never reads as a link to resolve. (The `404.html` page is the other
absolute spelling, for its own reason: `pages.not_found_page` says it.)

`build` writes the block between its two markers, inserting it under `<title>` on a page
that has none yet; `check`'s `heads` derives every served page's block again and fails on a
page whose block is missing or not today's.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from html.parser import HTMLParser
from pathlib import Path

from . import icons, records
from .escape import attribute
from .paths import SITE_ROOT, site_pages

HEAD_START = "<!-- head-tags:start, written by builder/. Run `python -m builder build`. -->"
HEAD_END = "<!-- head-tags:end -->"

#: About what a search result or a card shows before it cuts the text itself.
DESCRIPTION_MAX = 160
ELLIPSIS = "…"

#: The picture a page with no figure is previewed by: the icon's largest square.
FALLBACK_IMAGE = icons.ICONS_DIR / "icon-512.png"

_BLOCK = re.compile(re.escape(HEAD_START) + r".*?" + re.escape(HEAD_END) + r"\n", re.S)
_TITLE = re.compile(r"<title>(.*?)</title>\n", re.S)
#: A sentence ends at terminal punctuation, a closing quote or bracket if one follows, then
#: whitespace and the opening of the next sentence.
_SENTENCE_END = re.compile(r"[.!?][\"'”’)]?(?=\s+[A-Z0-9\"“(])")
#: Inside an over-long first sentence, the end of a sentence it holds (a `?` the next word
#: does not capitalize after, say), never the dot of an `e.g.` or an initial.
_INNER_END = re.compile(r"(?<!\b\w)[.!?][\"'”’)]?(?=\s)")
#: A clause boundary a long sentence may be cut at: a comma, a semicolon, or a dash.
_CLAUSE = re.compile(r"[,;](?=\s)|\s?[—–]\s?|\s-\s")


@dataclass(frozen=True)
class Head:
    title: str
    description: str
    image: str
    url: str
    card: str
    #: False on a page whose `name="description"` is its author's, outside the block.
    own_description: bool


class _Reader(HTMLParser):
    """The page's title, its first prose paragraph, its first figure's first image, and a
    description its author wrote into the head."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.title: list[str] = []
        self.in_title = False
        self.main = 0
        self.figure = 0
        self.figure_is_registry: list[bool] = []
        self.paragraph: list[str] | None = None
        self.prose: str | None = None
        self.image: str | None = None
        self.authored: str | None = None

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        named = dict(attrs)
        if tag == "title":
            self.in_title = True
        elif tag == "meta" and named.get("name") == "description":
            self.authored = named.get("content") or ""
        elif tag == "main":
            self.main += 1
        elif tag == "figure":
            classes = (named.get("class") or "").split()
            self.figure_is_registry.append("figure" in classes and "data-figure" in named)
            self.figure += 1
        elif tag == "img" and self.image is None and any(self.figure_is_registry[-1:]):
            self.image = named.get("src")
        elif tag == "p" and self._opens_prose(named):
            self.paragraph = []

    def _opens_prose(self, named: dict) -> bool:
        """A paragraph is the first prose one if nothing has been taken yet and it is an
        unclassed `<p>` in `<main>` and in no figure."""
        if self.prose is not None or self.paragraph is not None:
            return False
        return bool(self.main) and not self.figure and "class" not in named

    def handle_endtag(self, tag: str) -> None:
        if tag == "title":
            self.in_title = False
        elif tag == "main":
            self.main -= 1
        elif tag == "figure" and self.figure:
            self.figure -= 1
            self.figure_is_registry.pop()
        elif tag == "p" and self.paragraph is not None:
            self.prose = " ".join("".join(self.paragraph).split())
            self.paragraph = None

    def handle_data(self, data: str) -> None:
        if self.in_title:
            self.title.append(data)
        if self.paragraph is not None:
            self.paragraph.append(data)


def first_sentence(prose: str) -> str:
    """The first sentence of a run of collapsed text, cut to `DESCRIPTION_MAX`: at the last
    sentence end that fits, else the last clause boundary, else a word and an ellipsis."""
    prose = " ".join(prose.split())
    end = _SENTENCE_END.search(prose)
    sentence = prose[: end.end()] if end else prose
    if len(sentence) <= DESCRIPTION_MAX:
        return sentence
    ends = [m.end() for m in _INNER_END.finditer(sentence) if m.end() <= DESCRIPTION_MAX]
    if ends:
        return sentence[: ends[-1]]
    clauses = [m.start() for m in _CLAUSE.finditer(sentence) if m.start() + 1 <= DESCRIPTION_MAX]
    if clauses:
        return sentence[: clauses[-1]].rstrip() + "."
    cut = sentence[: DESCRIPTION_MAX - len(ELLIPSIS) + 1].rsplit(" ", 1)[0]
    return cut.rstrip(",;:—-") + ELLIPSIS


def page_url(page: Path) -> str:
    """Where a page is served, absolute: a directory's index is named by its directory."""
    shown = page.relative_to(SITE_ROOT).as_posix()
    if shown == "index.html":
        shown = ""
    elif shown.endswith("/index.html"):
        shown = shown[: -len("index.html")]
    return _absolute(shown)


def _absolute(site_path: str) -> str:
    from .pages import SITE_URL

    return SITE_URL + site_path


def derive(page: Path, page_html: str) -> Head:
    """The head a page's own words and pictures give it."""
    shown = page.relative_to(SITE_ROOT).as_posix()
    reader = _Reader()
    reader.feed(_BLOCK.sub("", page_html))
    reader.close()
    title = " ".join("".join(reader.title).split())
    if not title:
        raise records.RecordError(f"{shown}: no <title> to derive og:title from")
    if reader.prose:
        if reader.authored is not None:
            raise records.RecordError(
                f"{shown}: carries a description of its own beside its first prose paragraph "
                '— take the authored <meta name="description"> out and let `build` derive it'
            )
        description, own = first_sentence(reader.prose), True
    elif reader.authored:
        description, own = first_sentence(reader.authored), False
    else:
        raise records.RecordError(
            f"{shown}: no prose paragraph in <main> and no authored description to read"
        )
    if reader.image:
        target = (page.parent / reader.image.split("?", 1)[0]).resolve()
        image, card = _absolute(target.relative_to(SITE_ROOT).as_posix()), "summary_large_image"
    else:
        image = _absolute(FALLBACK_IMAGE.relative_to(SITE_ROOT).as_posix())
        card = "summary"
    return Head(title, description, image, page_url(page), card, own)


def block(head: Head) -> str:
    """The block's lines, markers included, with its trailing newline."""
    lines = [HEAD_START]
    if head.own_description:
        lines.append(f'<meta name="description" content="{attribute(head.description)}">')
    lines.extend(
        [
            '<meta property="og:type" content="website">',
            f'<meta property="og:title" content="{attribute(head.title)}">',
            f'<meta property="og:description" content="{attribute(head.description)}">',
            f'<meta property="og:url" content="{attribute(head.url)}">',
            f'<meta property="og:image" content="{attribute(head.image)}">',
            f'<meta name="twitter:card" content="{head.card}">',
            HEAD_END,
        ]
    )
    return "\n".join(lines) + "\n"


def with_head(page: Path, page_html: str) -> str:
    """The page with its head block replaced by today's, or inserted under `<title>`."""
    fresh = block(derive(page, page_html))
    if _BLOCK.search(page_html):
        return _BLOCK.sub(lambda _: fresh, page_html, count=1)
    title = _TITLE.search(page_html)
    if title is None:
        raise records.RecordError(
            f"{page.relative_to(SITE_ROOT).as_posix()}: no <title> line to set the head under"
        )
    return page_html[: title.end()] + fresh + page_html[title.end() :]


def problems() -> list[str]:
    """`check`'s `heads`: every served page carries the block its own words derive."""
    found = []
    for page in site_pages():
        shown = page.relative_to(SITE_ROOT).as_posix()
        with page.open(encoding="utf-8", newline="") as handle:
            html = handle.read()
        if not _BLOCK.search(html):
            found.append(f"{shown}: no head-tags block — run `build`")
            continue
        try:
            if with_head(page, html) != html:
                found.append(
                    f"{shown}: its description or preview tags are not today's — run `build`"
                )
        except records.RecordError as error:
            found.append(str(error))
    return found


def described() -> list[tuple[str, Head]]:
    """Every served page and the head it derives, for a reader who wants the list."""
    out = []
    for page in site_pages():
        with page.open(encoding="utf-8", newline="") as handle:
            out.append((page.relative_to(SITE_ROOT).as_posix(), derive(page, handle.read())))
    return out
