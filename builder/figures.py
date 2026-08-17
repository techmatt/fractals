"""Figures on article pages.

Article prose is hand-written HTML and stays that way. What the builder owns is the
*figure block*: one registry row per figure, and one canonical piece of markup derived
from it. `python -m builder figure <id>` prints the block to paste; `check` re-derives
it and asserts the page carries it verbatim. So a caption or a size lives in exactly one
place, and a page that has drifted from the registry is a failing check rather than a
thing someone notices later.

The block is written for a page in `article/`, which is where figures go.

A figure can be registered before its asset exists. Such a row carries `"status":
"pending"` and names no file or size, and the block it derives is a well holding the
description of the picture that will go there. Prose gets written before pictures get
made, and a page that says "this is coming, and here is what it will show" is honest in
a way an empty space or a broken image is not.
"""

from dataclasses import dataclass

from . import records
from .escape import attribute, text
from .paths import ARTICLE_DIR, FIGURE_IMAGES_DIR, FIGURE_REGISTRY, relative_href

INDENT = " " * 6
PENDING = "pending"


@dataclass(frozen=True)
class Figure:
    """One registered figure and the words that travel with it; the asset is optional."""

    id: str
    alt: str
    caption: str
    file: str | None
    width: int | None
    height: int | None
    credit: str | None

    @property
    def pending(self) -> bool:
        """True while the picture is planned but not yet made."""
        return self.file is None

    @property
    def path(self):
        if self.file is None:
            raise ValueError(f"figure {self.id!r} is pending and has no file")
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
    classes = "figure figure-pending" if figure.pending else "figure"
    return "\n".join(
        [
            f'{INDENT}<figure class="{classes}" data-figure="{attribute(figure.id)}">',
            _well(figure),
            f"{INDENT}  <figcaption>{caption}</figcaption>",
            f"{INDENT}</figure>",
        ]
    )


def _well(figure: Figure) -> str:
    """What sits in the figure's well: the picture, or a note saying what will."""
    if figure.pending:
        return (
            f'{INDENT}  <p class="pending"><span class="pending-label">Figure pending</span>'
            f"{text(figure.alt)}</p>"
        )
    return (
        f'{INDENT}  <img src="{attribute(figure.src)}" width="{figure.width}" '
        f'height="{figure.height}" alt="{attribute(figure.alt)}">'
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
        registry[identifier] = _figure(row, identifier)
    return registry


def _figure(row: records.Record, identifier: str) -> Figure:
    """One registry row, held to being either a made picture or a planned one."""
    status = row.optional_text("status")
    if status is not None and status != PENDING:
        raise records.RecordError(
            f"{row.where}: status {status!r} — the only status is {PENDING!r}"
        )
    asset = (row.optional_text("file"), row.optional_count("width"), row.optional_count("height"))
    if status == PENDING and any(field is not None for field in asset):
        raise records.RecordError(
            f"{row.where}: a pending figure names no file or size — the asset does not exist yet"
        )
    if status is None and any(field is None for field in asset):
        raise records.RecordError(
            f'{row.where}: a figure needs file, width and height, or "status": "{PENDING}"'
        )
    file, width, height = asset
    return Figure(
        id=identifier,
        alt=row.text("alt"),
        caption=row.text("caption"),
        file=file,
        width=width,
        height=height,
        credit=row.optional_text("credit"),
    )
