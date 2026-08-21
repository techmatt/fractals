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

from . import records
from .escape import attribute, text
from .paths import ARTICLE_DIR, FIGURE_IMAGES_DIR, FIGURE_REGISTRY, relative_href

INDENT = " " * 6
PENDING = "pending"

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
    credit: str | None
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
        """The article page this figure is registered on."""
        return ARTICLE_DIR / self.page

    @property
    def src(self) -> str:
        """The figure's src as an article page must spell it: relative, never rooted."""
        return relative_href(self.page_path, self.path)


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
        credit=row.optional_text("credit"),
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
    "credit",
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
) -> Figure:
    """Turn a pending row into a made one, and heal the well its page is still showing.

    Going pending → made was four steps with two numbers retyped out of `import`'s
    printout: fill the row, retype the size, retype it again, replace the pending well on
    the page by hand. A size typed one digit wrong is a failing `check` at best and a
    stretched picture at worst, so none of it is typed here.

    Everything that can refuse refuses *before* anything is written: a made row with no
    provenance is a row `load_all` will not read back, and writing one would leave the
    registry unloadable rather than merely wrong.
    """
    figure = load_all().get(identifier)
    if figure is None:
        raise records.RecordError(f"no figure {identifier!r} in the registry")
    if not figure.pending:
        raise records.RecordError(
            f"{identifier} is already made, as {figure.file} — place is for a pending row"
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
    was = markup(figure)

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


def _heal(figure: Figure, was: str) -> None:
    """Swap the pending well on the figure's page for the block the filled row derives.

    The page is hand-written prose and stays that way; this replaces exactly the block
    the registry already owned, and fails loudly if the page is not carrying it.
    """
    page = figure.page_path
    with page.open(encoding="utf-8", newline="") as handle:
        html = handle.read()
    if was not in html:
        raise records.RecordError(
            f"{page.name} is not carrying {figure.id}'s pending block — place the block "
            f"`python -m builder figure {figure.id}` by hand"
        )
    with page.open("w", encoding="utf-8", newline=LF) as handle:
        handle.write(html.replace(was, markup(figure), 1))


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
