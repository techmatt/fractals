"""Figures on article pages.

Article prose is hand-written HTML and stays that way. What the builder owns is the
*figure block*: one registry row per figure, and one canonical piece of markup derived
from it. `python -m builder figure <id>` prints the block to paste; `check` re-derives
it and asserts the page carries it verbatim. So a caption or a size lives in exactly one
place, and a page that has drifted from the registry is a failing check rather than a
thing someone notices later.

The block is written for a page in `article/`, which is where figures go.
"""

from dataclasses import dataclass

from . import records
from .escape import attribute, text
from .paths import ARTICLE_DIR, FIGURE_IMAGES_DIR, FIGURE_REGISTRY, relative_href

INDENT = " " * 6


@dataclass(frozen=True)
class Figure:
    """One registered figure asset and the words that travel with it."""

    id: str
    file: str
    alt: str
    caption: str
    width: int
    height: int
    credit: str | None

    @property
    def path(self):
        return FIGURE_IMAGES_DIR / self.file

    @property
    def src(self) -> str:
        """The figure's src as an article page must spell it: relative, never rooted."""
        return relative_href(ARTICLE_DIR / "any-section.html", self.path)


def markup(figure: Figure) -> str:
    """The canonical figure block: what an article page must contain, exactly."""
    caption = text(figure.caption)
    if figure.credit:
        caption += f' <span class="credit">{text(figure.credit)}</span>'
    return "\n".join(
        [
            f'{INDENT}<figure class="figure" data-figure="{attribute(figure.id)}">',
            f'{INDENT}  <img src="{attribute(figure.src)}" width="{figure.width}" '
            f'height="{figure.height}" alt="{attribute(figure.alt)}">',
            f"{INDENT}  <figcaption>{caption}</figcaption>",
            f"{INDENT}</figure>",
        ]
    )


def load_all() -> dict[str, Figure]:
    """The figure registry, keyed by id."""
    if not FIGURE_REGISTRY.is_file():
        return {}
    registry: dict[str, Figure] = {}
    for row in records.read(FIGURE_REGISTRY):
        row.expect_kind("figure")
        identifier = row.text("id")
        if identifier in registry:
            raise records.RecordError(f"{row.where}: figure {identifier!r} is registered twice")
        registry[identifier] = Figure(
            id=identifier,
            file=row.text("file"),
            alt=row.text("alt"),
            caption=row.text("caption"),
            width=row.count("width"),
            height=row.count("height"),
            credit=row.optional_text("credit"),
        )
    return registry
