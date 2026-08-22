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

**Every made figure records how it was made**, in two fields that answer two different
questions. A row's `provenance` is one line per panel, in prose: the family and its
constants, the centre and width of the frame, the mode, the palette, the cap, the sample
count — or, for a one-off, the command that was run. It is the answer to "where did this
picture come from?" asked a year later, and it survives the script that drew it. A row's
`recipe` names the maker and the arguments that redraw it *now*, which is the answer to
"make it again, one shade darker". Prose outlives code and code is what runs, so both.
`check` holds every non-pending row to a provenance, and holds a recipe naming a maker
inside `builder` to that maker still existing.

Every row also names the `page` it sits on. A figure exists to be on a page; a row that
is on none is either a rename that half-landed or a figure somebody forgot to place, and
before this field both passed `check` in silence.
"""

import importlib
import json
from dataclasses import dataclass
from pathlib import Path

from . import records
from .escape import attribute, text
from .paths import FIGURE_IMAGES_DIR, FIGURE_REGISTRY, SITE_ROOT, carrier_path, relative_href

INDENT = " " * 6
PENDING = "pending"

#: The words the explorer link is spelled with, here and on a gallery tile. One string,
#: because a link a reader learns to recognize has to read the same everywhere. On a
#: figure it is the link's accessible name rather than its visible text *(Matt,
#: 2026-08-21)*: the way back into the explorer is a mark on the picture, not a sentence
#: under it, so the words are what a screen reader and a hover both say.
OPEN_TEXT = "open in fractal explorer"

#: The mark that carries the link on a picture. A glyph and not an image file: the site
#: loads no webfont and commits no icon set, and an arrow out of a box is the one shape
#: every reader already reads as "this opens somewhere else".
OPEN_MARK = "\u2197"

#: `.gitattributes` normalizes this repository to LF, so anything that rewrites a
#: tracked file spells the line ending rather than taking the platform's.
LF = "\n"

#: What separates a maker's module from the function inside it, in a recipe.
MAKER_SEPARATOR = ":"

#: The package whose makers `check` can actually resolve. A maker outside it — a rig
#: under `scratch/`, which is where a figure is usually composed — is recorded and not
#: resolved, because untracked code is exactly what the registry cannot vouch for.
TRACKED_MAKER = "builder."


@dataclass(frozen=True)
class Recipe:
    """The tracked maker that draws a figure, and the arguments it draws it with.

    `maker` is `module:function` — `builder.diagrams:orbit_race` for a diagram, or a
    rig's path for a sheet composed under `scratch/`. `args` is whatever that function
    takes, so a figure is adjusted by editing one line of JSON rather than by finding
    the script, remembering which function in it, and rerunning the whole file.
    """

    maker: str
    args: dict

    @property
    def module(self) -> str:
        return self.maker.split(MAKER_SEPARATOR, 1)[0]

    @property
    def function(self) -> str:
        return self.maker.split(MAKER_SEPARATOR, 1)[1]

    @property
    def is_tracked(self) -> bool:
        """Whether the maker is code this repository commits, and so can be held to."""
        return self.module.startswith(TRACKED_MAKER)

    def resolve(self):
        """The callable, for a tracked maker. Raises for one that has been renamed."""
        return getattr(importlib.import_module(self.module), self.function)


@dataclass(frozen=True)
class Figure:
    """One registered figure and the words that travel with it; the asset is optional."""

    id: str
    page: str
    alt: str
    caption: str
    file: str | None
    width: int | None
    height: int | None
    provenance: tuple[str, ...]
    recipe: Recipe | None

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
    def page_path(self):
        """The page this figure is registered on — a section, or a page hanging off one."""
        return carrier_path(self.page)

    @property
    def src(self) -> str:
        """The figure's src as an article page must spell it: relative, never rooted."""
        return relative_href(self.page_path, self.path)


def page_name(path) -> str:
    """How a registry row spells this page — the inverse of `paths.carrier_path`."""
    relative = Path(path).resolve().relative_to(SITE_ROOT)
    return relative.name if relative.parent.name == "article" else relative.as_posix()


def markup(figure: Figure, opened: str | None = None) -> str:
    """The canonical figure block: what an article page must contain, exactly.

    `opened` is the explorer link this figure reopens at, where the link registry holds
    one — see `builder/links.py`. A figure the explorer cannot reproduce carries no
    link at all rather than one that lands somewhere near it.

    **The caption is the caption and nothing else** *(Matt, 2026-08-21)*. It used to end
    with two more sentences that were not about the picture: a credit saying the engine
    drew it, which every render on the site said identically, and the way into the
    explorer written out as a line of prose. The credit is gone and the link is a mark on
    the corner of the picture, so what is left under a figure is what a reader is looking
    at.
    """
    classes = ["figure"]
    if figure.pending:
        classes.append("figure-pending")
    return "\n".join(
        [
            f'{INDENT}<figure class="{" ".join(classes)}" data-figure="{attribute(figure.id)}">',
            _well(figure, opened),
            f"{INDENT}  <figcaption>{text(figure.caption)}</figcaption>",
            f"{INDENT}</figure>",
        ]
    )


def _well(figure: Figure, opened: str | None = None) -> str:
    """What sits in the figure's well: the picture, or a note saying what will.

    A picture the explorer can draw again *is* the link. The mark in its corner is the
    affordance — the picture on its own gives a reader nothing to notice — and the words
    ride on the anchor, where a screen reader and a hover both find them.
    """
    if figure.pending:
        return (
            f'{INDENT}  <p class="pending"><span class="pending-label">Figure pending</span>'
            f"{text(figure.alt)}</p>"
        )
    picture = (
        f'<img src="{attribute(figure.src)}" width="{figure.width}" '
        f'height="{figure.height}" alt="{attribute(figure.alt)}">'
    )
    if not opened:
        return f"{INDENT}  {picture}"
    mark = f'<span class="figure-open-mark" aria-hidden="true">{OPEN_MARK}</span>'
    return (
        f'{INDENT}  <a class="figure-open" href="{attribute(opened)}" '
        f'title="{attribute(OPEN_TEXT)}" aria-label="{attribute(OPEN_TEXT)}">'
        f"{picture}{mark}</a>"
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
    # A pending figure has nothing to record yet; a made one has no excuse.
    provenance = () if status == PENDING else row.lines("provenance")
    file, width, height = asset
    return Figure(
        id=identifier,
        page=row.text("page"),
        alt=row.text("alt"),
        caption=row.text("caption"),
        file=file,
        width=width,
        height=height,
        provenance=provenance,
        recipe=_recipe(row),
    )


def _recipe(row: records.Record) -> Recipe | None:
    """A row's recipe, held to naming a function inside something."""
    stated = row.optional_mapping("recipe")
    if stated is None:
        return None
    unknown = set(stated) - {"maker", "args"}
    if unknown:
        raise records.RecordError(
            f"{row.where}: a recipe is maker and args, not {', '.join(sorted(unknown))}"
        )
    maker = stated.get("maker")
    if (
        not isinstance(maker, str)
        or maker.count(MAKER_SEPARATOR) != 1
        or not all(part.strip() for part in maker.split(MAKER_SEPARATOR))
    ):
        raise records.RecordError(
            f"{row.where}: a recipe's maker is module{MAKER_SEPARATOR}function, not {maker!r}"
        )
    args = stated.get("args", {})
    if not isinstance(args, dict):
        raise records.RecordError(f"{row.where}: a recipe's args is an object")
    return Recipe(maker=maker, args=args)


#: The order a row's keys are written in, so every line of the registry reads the same
#: way and a placed row does not shuffle itself in the diff.
KEY_ORDER = (
    "schema",
    "kind",
    "id",
    "page",
    "status",
    "file",
    "width",
    "height",
    "alt",
    "caption",
    "recipe",
    "provenance",
)


def place(
    identifier: str,
    file: str,
    width: int,
    height: int,
    *,
    provenance: list[str] | None = None,
    recipe: dict | None = None,
    replace: bool = False,
) -> Figure:
    """Turn a pending row into a made one, and heal the well its page is still showing.

    Going pending → made was four steps with two numbers retyped out of `import`'s
    printout: fill the row, retype the size, retype it again, replace the pending well on
    the page by hand. A size typed one digit wrong is a failing `check` at best and a
    stretched picture at worst, so none of it is typed here.

    `replace` is the same landing for a figure that is already made and has been **drawn
    again** — a review round that redesigns a picture, which is the only way a made
    figure legitimately changes. It is opt-in because the far commoner call is a first
    placement, and a redraw that lands by accident is a picture nobody chose to change;
    the row and the page are rewritten exactly as a first placement writes them, so a
    new size reaches the `<img>` rather than stretching the old one.

    Everything that can refuse refuses *before* anything is written: a made row with no
    provenance is a row `load_all` will not read back, and writing one would leave the
    registry unloadable rather than merely wrong.
    """
    figure = load_all().get(identifier)
    if figure is None:
        raise records.RecordError(f"no figure {identifier!r} in the registry")
    if not figure.pending and not replace:
        raise records.RecordError(
            f"{identifier} is already made, as {figure.file} — place is for a pending row. "
            "Pass --replace to land a redraw of a figure that is already on the page."
        )
    lines = [line for line in FIGURE_REGISTRY.read_text(encoding="utf-8").splitlines() if line]
    rows = [json.loads(line) for line in lines]
    row = next(row for row in rows if row.get("id") == identifier)
    if not (provenance or row.get("provenance")):
        raise records.RecordError(
            f"{identifier} has no provenance, and a made figure records how it was made. "
            "Give one line per panel — family and constants, centre and width, mode, "
            "palette, cap, samples, crop — or the command that was run."
        )
    was = landing_block(figure)
    # The page is checked before the registry is written, not after: a heal that fails
    # once the row is filled leaves the registry a size ahead of the page, and the next
    # attempt cannot even find the block it was going to replace.
    page = figure.page_path
    with page.open(encoding="utf-8", newline="") as handle:
        if was not in handle.read():
            raise records.RecordError(
                f"{page.name} is not carrying {identifier}'s block — place the block "
                f"`python -m builder figure {identifier}` by hand"
            )

    row.pop("status", None)
    row["file"], row["width"], row["height"] = file, width, height
    if provenance:
        row["provenance"] = list(provenance)
    if recipe:
        row["recipe"] = recipe
    ordered = {key: row[key] for key in KEY_ORDER if key in row}
    ordered.update({key: value for key, value in row.items() if key not in ordered})
    index = next(index for index, other in enumerate(rows) if other.get("id") == identifier)
    lines[index] = json.dumps(ordered, ensure_ascii=False)
    with FIGURE_REGISTRY.open("w", encoding="utf-8", newline=LF) as handle:
        handle.write(LF.join(lines) + LF)

    placed = load_all()[identifier]
    _heal(placed, was)
    return placed


def landing_block(figure: Figure) -> str:
    """The block on the page a landing has to find before it may replace anything.

    `place` looks for exactly this and refuses when the page is not carrying it, so it is
    the one derivation a redraw stands on. It was once `markup(figure)` with no link,
    which refused `--replace` on every figure the explorer can reopen — very nearly every
    render figure on the site — and nothing failed until somebody redrew one. `check`'s
    `landing` check holds this function's answer to the page for every made figure, so
    the next time it drifts a check says so instead of a redraw.
    """
    return markup(figure, _opened(figure))


def _opened(figure: Figure) -> str | None:
    """The explorer link this figure's block carries, where the link registry has one.

    Derived rather than assumed: a picture the explorer can draw again *is* the link, so
    the block on the page has an anchor around it and the block a redraw has to find and
    replace has to have one too.
    """
    from . import links

    return links.opened(figure.page_path).get(f"figure:{figure.id}")


def _heal(figure: Figure, was: str) -> None:
    """Swap the block the figure's page is showing for the one the filled row derives.

    The page is hand-written prose and stays that way; this replaces exactly the block
    the registry already owned, and fails loudly if the page is not carrying it.
    """
    page = figure.page_path
    with page.open(encoding="utf-8", newline="") as handle:
        html = handle.read()
    if was not in html:
        raise records.RecordError(
            f"{page.name} is not carrying {figure.id}'s block — place the block "
            f"`python -m builder figure {figure.id}` by hand"
        )
    with page.open("w", encoding="utf-8", newline=LF) as handle:
        handle.write(html.replace(was, landing_block(figure), 1))


def by_page(registry: dict[str, Figure]) -> dict[str, list[Figure]]:
    """Every figure grouped under the page it sits on, pages in reading order.

    Reading order is `sections.jsonl`'s, so the grouping a person sees is the order
    they would meet the figures in.
    """
    from . import sections

    order = [section.page for section in sections.load_all()]
    grouped: dict[str, list[Figure]] = {page: [] for page in order}
    for figure in registry.values():
        grouped.setdefault(figure.page, []).append(figure)
    return {page: found for page, found in grouped.items() if found}
