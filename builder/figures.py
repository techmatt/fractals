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
import re
from dataclasses import dataclass
from pathlib import Path

from . import records
from .escape import attribute, text
from .paths import FIGURE_IMAGES_DIR, FIGURE_REGISTRY, SITE_ROOT, carrier_path, relative_href

INDENT = " " * 6

#: How a `provenance` line names the frame its panel was drawn on.
#:
#: Provenance is prose, deliberately — it has to survive the script that wrote it — but
#: the frame inside it is written the same way everywhere, because every line of it came
#: out of the same renderer: a family, sometimes a degree, sometimes a set of complex
#: constants, and always `centre <re> + <im>i, width <w>`. These four patterns are what
#: reads that back out, and `frames()` below is the only thing that uses them.
_NUMBER = r"-?\d+(?:\.\d+)?(?:[eE]-?\d+)?"
_CENTRE = re.compile(rf"cent(?:re|er)\s+({_NUMBER})\s*\+\s*({_NUMBER})i")
_WIDTH = re.compile(rf"width\s+({_NUMBER})")
_CONSTANT = re.compile(rf"\b([a-z_]+)\s*=\s*({_NUMBER})\s*\+\s*({_NUMBER})i")
_FAMILY = re.compile(
    r"\b(mandelbrot|julia|multibrot|phoenix|burning[_ ]ship|tricorn|celtic|nova)\b",
    re.IGNORECASE,
)
_DEGREE = re.compile(r"degree\s+(\d+(?:\.\d+)?)")


def _point(real: str, imaginary: str) -> str:
    """One complex number, spelled the same way whatever the line it came out of.

    `0.0`, `0` and `-0.0` are the same place, and provenance writes all three; the
    comparison is between what the numbers mean, not how somebody typed them.
    """
    return f"{float(real) + 0.0:.12g}{float(imaginary) + 0.0:+.12g}i"


#: What a row's `status` may say, and what each one means.
#:
#: - `placed` — the picture is made and its block is on the page.
#: - `pending` — planned; the page carries a well saying what will go there.
#: - `held` — registered and deliberately **not** on the page, blocked on something
#:   outside this repository. A held row names what it is waiting for.
#: - `stale` — made and on the page, and the event its `stale_when` names has happened.
#: - `draft` — made and on the page, and its **numbers** are expected to change. Every
#:   page on this site is a draft and none of them says so; this status is for the
#:   narrower case where the picture is a reading of a measurement that is going to be
#:   taken again, and a reader who wrote a number down off it would be writing down
#:   something that is about to be false. A draft row says in `note` what re-bakes it,
#:   and its caption carries a small mark so the page says it too.
#:
#: `stale_when` is not only for a row that is already stale: it is the standing warning a
#: placed row carries about the event that will overtake it, which is the point at which
#: somebody can still do something about it.
PLACED, PENDING, HELD, STALE, DRAFT = "placed", "pending", "held", "stale", "draft"
STATUSES = (PLACED, PENDING, HELD, STALE, DRAFT)

#: The statuses whose row owns a made asset — a file, a width and a height — as against
#: one that is planned or deliberately off its page.
MADE = (PLACED, STALE, DRAFT)

#: Where a figure's pictures came from, as a kind and the keys that address them.
#:
#: - `run_row` — a curation release record, `<run>|release|<candidate>`, or a
#:   finished-render label row, `<head>/<batch>.jsonl:<line>`.
#: - `location` — a location label row, `labels/<batch>.jsonl:<line>`, or a walk
#:   ledger, `<ledger>/walk.jsonl` with `#<node_id>` where one node is meant.
#: - `synthetic` — nothing stored stands behind it: drawn here, or rendered for this
#:   article alone. The row's own `provenance` is the record, and it carries no keys.
#: - `none` — the picture cannot be reconstructed. The row says why, in `held_reason`.
RUN_ROW, LOCATION, SYNTHETIC, NO_SOURCE = "run_row", "location", "synthetic", "none"
SOURCE_KINDS = (RUN_ROW, LOCATION, SYNTHETIC, NO_SOURCE)

#: The kinds that carry keys at all. A `synthetic` or `none` row naming one is a row
#: claiming a record it does not have.
KEYED_KINDS = (RUN_ROW, LOCATION)

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
class Source:
    """One kind of record a figure's pictures came out of, and the keys addressing them.

    **A key is a string, and never a number.** A pool index retargeted four figures'
    provenance in one afternoon — the pool grew, the index came to land somewhere else,
    and a rerun rewrote the record under pictures nobody had touched. An integer here is
    refused at load, so that shape of record cannot be written down again.
    """

    kind: str
    keys: tuple[str, ...]


@dataclass(frozen=True)
class Fact:
    """One load-bearing claim a figure's caption or prose makes, and where it comes from.

    Not published, and not a substitute for the prose: it is the answer to "who checked
    this, against what?" asked of a number the article states as if it were settled.
    """

    claim: str
    source: str


@dataclass(frozen=True)
class Figure:
    """One registered figure and the words that travel with it; the asset is optional."""

    id: str
    page: str
    status: str
    alt: str
    caption: str
    file: str | None
    width: int | None
    height: int | None
    provenance: tuple[str, ...]
    recipe: Recipe | None
    sources: tuple[Source, ...]
    params: dict
    facts: tuple[Fact, ...]
    held_reason: str | None
    stale_when: str | None
    reuse_reason: str | None
    note: str | None

    @property
    def draft(self) -> bool:
        """Whether the page should say out loud that these numbers are going to move."""
        return self.status == DRAFT

    @property
    def frames(self) -> frozenset[str]:
        """Every distinct frame this figure's panels stand on, as comparable keys.

        A *frame* here is what the article calls a location, spelled out completely: the
        family, its degree where it has one, whatever complex constants pin the formula
        down, and the centre and width the camera was at. Two panels agree on a key when
        they are literally the same picture of the same place, which is the only claim
        the record can support — provenance is prose and this reads it, so anything
        looser would be inventing an equivalence nobody wrote down.

        A line that names a family starts a fresh reading; a line that names none —
        `left:`, `rung 3`, `panel 7` — inherits the family, degree and constants of the
        last line that did, because that is how a sheet's provenance is written.

        A row's `sources` keys are the other half, and both keyed kinds count. A
        `location` key is the record's own name for a place, which is the way a maker is
        meant to address one. A `run_row` key is a released wallpaper — a location with a
        recipe already on it — and two figures standing on one release row are two
        figures standing on one location however differently they crop it. Without that
        half the modes gallery could show the same released wallpaper as the threads
        figure beside it and nothing would say so, because a panel taken from a release
        row is recorded by its key rather than by its frame.
        """
        found: set[str] = set()
        family = degree = None
        constants: dict[str, str] = {}
        for line in self.provenance:
            named = _FAMILY.search(line)
            if named:
                family = named.group(1).lower().replace(" ", "_")
                found_degree = _DEGREE.search(line)
                degree = found_degree.group(1) if found_degree else None
                constants = {
                    name: _point(real, imaginary)
                    for name, real, imaginary in _CONSTANT.findall(line)
                }
            centre = _CENTRE.search(line)
            width = _WIDTH.search(line)
            if not centre or not width:
                continue
            frame = [family or "?"]
            if degree:
                frame.append(f"d{degree}")
            frame += [f"{name}={value}" for name, value in sorted(constants.items())]
            frame.append(f"@ {_point(centre.group(1), centre.group(2))}")
            frame.append(f"w {float(width.group(1)):.12g}")
            found.add(" ".join(frame))
        for source in self.sources:
            if source.kind in KEYED_KINDS:
                found.update(source.keys)
        return frozenset(found)

    @property
    def pending(self) -> bool:
        """True while the picture is planned but not yet made."""
        return self.file is None

    @property
    def held(self) -> bool:
        """True while the row is deliberately not on its page."""
        return self.status == HELD

    @property
    def on_page(self) -> bool:
        """Whether a page is expected to be carrying this figure's block at all."""
        return self.status != HELD

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
            f"{INDENT}  <figcaption>{_mark(figure)}{text(figure.caption)}</figcaption>",
            f"{INDENT}</figure>",
        ]
    )


#: What a draft figure's mark says. A word, not an abbreviation: this is the one piece of
#: the site's own bookkeeping a reader is ever shown, so it is shown in words they have.
DRAFT_MARK = "Draft"


def _mark(figure: Figure) -> str:
    """The small stamp a draft figure's caption opens with, and nothing for any other.

    The page around it is a draft too, and says so nowhere. What this marks is narrower:
    the *numbers* in this picture are a reading of a measurement that will be taken
    again, so a reader who copies one out is copying something with a shelf life.

    Inside the caption rather than over the picture. A badge on a chart is furniture
    competing with the chart, and the caption is where a reader already looks to find out
    what a figure is.
    """
    if not figure.draft:
        return ""
    return f'<span class="figure-draft">{text(DRAFT_MARK)}</span> '


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
    """One registry row, held to being either a made picture or one that is not made yet."""
    status = row.text("status")
    if status not in STATUSES:
        raise records.RecordError(
            f"{row.where}: status {status!r} — the statuses are {', '.join(STATUSES)}"
        )
    made = status in MADE
    asset = (row.optional_text("file"), row.optional_count("width"), row.optional_count("height"))
    if not made and any(field is not None for field in asset):
        raise records.RecordError(
            f"{row.where}: a {status} figure names no file or size — the asset does not exist yet"
        )
    if made and any(field is None for field in asset):
        raise records.RecordError(f"{row.where}: a {status} figure needs file, width and height")
    held_reason = row.optional_text("held_reason")
    if status == HELD and held_reason is None:
        raise records.RecordError(
            f"{row.where}: a held figure says what it is held on, in held_reason"
        )
    if status == STALE and row.optional_text("stale_when") is None:
        raise records.RecordError(
            f"{row.where}: a stale figure names the event that staled it, in stale_when"
        )
    note = row.optional_text("note")
    if status == DRAFT and note is None:
        raise records.RecordError(
            f"{row.where}: a draft figure says in note what re-bakes it — a mark on the "
            "caption that points at nothing is worse than no mark"
        )
    # A picture that is not made yet has nothing to record; a made one has no excuse.
    provenance = row.lines("provenance") if made else ()
    file, width, height = asset
    return Figure(
        id=identifier,
        page=row.text("page"),
        status=status,
        alt=row.text("alt"),
        caption=row.text("caption"),
        file=file,
        width=width,
        height=height,
        provenance=provenance,
        recipe=_recipe(row),
        sources=_sources(row),
        params=_params(row),
        facts=_facts(row),
        held_reason=held_reason,
        stale_when=row.optional_text("stale_when"),
        reuse_reason=row.optional_text("reuse_reason"),
        note=note,
    )


def _sources(row: records.Record) -> tuple[Source, ...]:
    """A row's `sources`, held to naming kinds this repository can answer for.

    A figure may draw on more than one kind at once — the modes gallery is ten kept
    wallpapers and eight panels drawn for the figure alone — so this is a list, and the
    synthetic half is stated rather than left to be inferred from a shorter list of keys.
    """
    stated = row.fields.get("sources")
    if not isinstance(stated, list) or not stated:
        raise records.RecordError(f"{row.where}: sources must be a non-empty list")
    found = []
    for entry in stated:
        if not isinstance(entry, dict):
            raise records.RecordError(f"{row.where}: every sources entry is an object")
        unknown = set(entry) - {"kind", "keys"}
        if unknown:
            raise records.RecordError(
                f"{row.where}: a sources entry is kind and keys, not {', '.join(sorted(unknown))}"
            )
        kind = entry.get("kind")
        if kind not in SOURCE_KINDS:
            raise records.RecordError(
                f"{row.where}: source kind {kind!r} — the kinds are {', '.join(SOURCE_KINDS)}"
            )
        keys = entry.get("keys", [])
        if not isinstance(keys, list):
            raise records.RecordError(f"{row.where}: a sources entry's keys is a list")
        for key in keys:
            # The whole reason this field exists. An index into live data is a moving
            # target, and a record written against one is rewritten under a picture
            # nobody changed — so a key is a string, and a number is refused here.
            if not isinstance(key, str) or not key.strip():
                raise records.RecordError(
                    f"{row.where}: source key {key!r} is not a string — a key addresses a "
                    "record by its own name, never by its position in live data"
                )
        if keys and kind not in KEYED_KINDS:
            raise records.RecordError(
                f"{row.where}: a {kind} source carries no keys, and this one names {len(keys)}"
            )
        if not keys and kind in KEYED_KINDS:
            raise records.RecordError(f"{row.where}: a {kind} source with no keys says nothing")
        found.append(Source(kind=kind, keys=tuple(keys)))
    return tuple(found)


def _params(row: records.Record) -> dict:
    """What the maker takes that its recipe's args do not already spell.

    Deliberately thin. Everything a panel is drawn from is in `provenance`, one line
    each, and a second copy of it here would be a second place to edit — which is the
    drift this registry exists to refuse.
    """
    stated = row.fields.get("params")
    if stated is None:
        return {}
    if not isinstance(stated, dict) or not stated:
        raise records.RecordError(f"{row.where}: params must be a non-empty object when present")
    return stated


def _facts(row: records.Record) -> tuple[Fact, ...]:
    """The claims this figure carries, each with the source it was checked against."""
    stated = row.fields.get("facts")
    if stated is None:
        return ()
    if not isinstance(stated, list) or not stated:
        raise records.RecordError(f"{row.where}: facts must be a non-empty list when present")
    found = []
    for entry in stated:
        if not isinstance(entry, dict) or set(entry) != {"claim", "source"}:
            raise records.RecordError(f"{row.where}: a fact is a claim and its source, both")
        for name in ("claim", "source"):
            if not isinstance(entry[name], str) or not entry[name].strip():
                raise records.RecordError(f"{row.where}: a fact's {name} is a non-empty string")
        found.append(Fact(claim=entry["claim"], source=entry["source"]))
    return tuple(found)


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
    "held_reason",
    "stale_when",
    "reuse_reason",
    "note",
    "file",
    "width",
    "height",
    "alt",
    "caption",
    "recipe",
    "sources",
    "params",
    "facts",
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
    status: str = PLACED,
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
    if figure.held:
        raise records.RecordError(
            f"{identifier} is held: {figure.held_reason}. Lift the hold in the registry "
            "first — a held figure is one nobody has decided to draw yet."
        )
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

    if status not in MADE:
        raise records.RecordError(
            f"a landing lands a made figure — {status!r} is not one of {', '.join(MADE)}"
        )
    if status == DRAFT and not row.get("note"):
        raise records.RecordError(
            f"{identifier} would land as a draft and its row carries no note — a draft "
            "says what re-bakes it before its mark goes onto a page"
        )
    row["status"] = status
    row.pop("held_reason", None)
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


# --------------------------------------------------------------- resolving the keys

#: How each kind of key is spelled, and which store answers it.
#:
#: The stores are the wallpaper project's, read-only and next door, so this half of the
#: check only runs where that checkout is configured — `check` says so and moves on
#: where it is not, exactly as it does for Pillow. CI clones this repository alone.
KEY_FORMS = {
    RUN_ROW: (
        "<run>|release|<candidate>  → data/curation/release/**/*.jsonl",
        "<head>/<batch>.jsonl:<line>  → data/<head>/rows/<batch>.jsonl",
    ),
    LOCATION: (
        "labels/<batch>.jsonl:<line>  → data/labels/rows/<batch>.jsonl",
        "<ledger>/walk.jsonl[#<node_id>]  → the artifacts tree, through renders.artifact",
    ),
}

FINISHED_HEADS = ("smooth_render", "strange_render")


class _Stores:
    """The wallpaper project's stores, opened once and asked many times.

    Every resolver below is line-counting or a set membership, deliberately: the readers
    a *maker* uses — `renders.finished_row`, `locations.release_record` — each walk a
    whole store to answer one question, which is right for one row and hopeless for the
    sixty this registry holds.
    """

    def __init__(self) -> None:
        from . import locations, renders

        self._renders = renders
        self._locations = locations
        self._release: set[str] | None = None
        self._lines: dict[Path, int] = {}
        self._nodes: dict[str, set[int] | None] = {}

    def release_keys(self) -> set[str]:
        if self._release is None:
            found = set()
            root = self._renders.data_file("data", "curation", "release")
            for path in sorted(root.rglob("*.jsonl")):
                with path.open(encoding="utf-8") as handle:
                    for raw in handle:
                        if not raw.strip():
                            continue
                        row = json.loads(raw)
                        found.add(f"{row.get('run')}|release|{row.get('candidate')}")
            self._release = found
        return self._release

    def lines_in(self, path: Path) -> int | None:
        """How many lines a store file has, or `None` where the file is not there."""
        if path not in self._lines:
            if not path.is_file():
                self._lines[path] = -1
            else:
                with path.open(encoding="utf-8") as handle:
                    self._lines[path] = sum(1 for raw in handle if raw.strip())
        found = self._lines[path]
        return None if found < 0 else found

    def ledger_nodes(self, name: str) -> set[int] | None:
        """Every node id one walk ledger holds, or `None` where the ledger is not there."""
        if name not in self._nodes:
            path = self._renders.artifact(name, "walk.jsonl")
            if not path.is_file():
                self._nodes[name] = None
            else:
                rows = self._locations.ledger(name)
                self._nodes[name] = set(self._locations.nodes(rows))
        return self._nodes[name]

    def rows_file(self, head: str, batch: str) -> Path:
        return self._renders.data_file("data", head, "rows", f"{batch}.jsonl")

    def labels_file(self, batch: str) -> Path:
        return self._renders.data_file("data", "labels", "rows", f"{batch}.jsonl")


def stores_available() -> bool:
    """Whether the wallpaper project's checkout is configured on this machine."""
    from . import renders

    try:
        renders.wallpapers_root()
    except renders.EngineError:
        return False
    return True


def unresolved(registry: dict[str, Figure] | None = None) -> list[str]:
    """Every source key of every row that does not answer to the store its kind names.

    The half of the figures check that needs the wallpaper project. A key that resolves
    is a picture somebody can still find; one that does not is a record that has quietly
    come loose from what it describes, which is the state this registry exists to end.
    """
    stores = _Stores()
    problems = []
    for figure in (registry or load_all()).values():
        for source in figure.sources:
            for key in source.keys:
                problem = _unresolved_key(stores, source.kind, key)
                if problem:
                    problems.append(f"figures.jsonl: {figure.id} {problem}")
    return problems


def _unresolved_key(stores: _Stores, kind: str, key: str) -> str | None:
    if kind == RUN_ROW:
        return _unresolved_run_row(stores, key)
    if kind == LOCATION:
        return _unresolved_location(stores, key)
    return None


def _unresolved_run_row(stores: _Stores, key: str) -> str | None:
    if "|release|" in key:
        if key not in stores.release_keys():
            return f"names {key}, and no curation release record has that run and candidate"
        return None
    head, _, address = key.partition("/")
    if head not in FINISHED_HEADS:
        return f"names {key}, which is neither a release key nor a {'/'.join(FINISHED_HEADS)} row"
    return _unresolved_line(stores, key, stores.rows_file(head, _batch(address)), address)


def _unresolved_location(stores: _Stores, key: str) -> str | None:
    if key.startswith("labels/"):
        address = key[len("labels/") :]
        return _unresolved_line(stores, key, stores.labels_file(_batch(address)), address)
    ledger, _, node = key.partition("#")
    if not ledger.endswith("/walk.jsonl"):
        return f"names {key}, which is neither a label row nor a walk ledger"
    name = ledger[: -len("/walk.jsonl")]
    nodes = stores.ledger_nodes(name)
    if nodes is None:
        return f"names {key}, and there is no {name}/walk.jsonl under the artifacts tree"
    if node and int(node) not in nodes:
        return f"names {key}, and that ledger has no node {node}"
    return None


def _batch(address: str) -> str:
    return address.rsplit(".jsonl", 1)[0]


def _unresolved_line(stores: _Stores, key: str, path: Path, address: str) -> str | None:
    at = address.rsplit(":", 1)
    if len(at) != 2 or not at[1].isdigit():
        return f"names {key}, and a store row is addressed <batch>.jsonl:<line>"
    held = stores.lines_in(path)
    if held is None:
        return f"names {key}, and there is no {path.name} in that store"
    if not 1 <= int(at[1]) <= held:
        return f"names {key}, and {path.name} has {held} lines"
    return None
