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

**A figure may be live** *(atlas_live_ckpt146)*: a piece of the site that runs in the page
instead of a picture of it. Such a row says `live` and names which piece, from `LIVE`
below, and carries no file, size or panels, because nothing about it is a raster. Its
block is a well holding the row's `alt` and a link to where the piece lives on its own,
and one module script that mounts the piece over that well. A page that cannot run the
script (scripting off, or opened from disk, where a browser refuses a module) keeps the
well as it was written, which is the same honesty a pending row's well has.

**A figure may be a video** *(start_video_embed_ckpt152)*: a YouTube player rather than a
picture. Such a row says `video`, the video's YouTube id, and like a live row carries no
file, size or panels. Its block is one `<iframe>` from `youtube-nocookie.com`, lazy and
16:9, whose `title` is the row's `alt`, since that is the player's accessible name. The
site hosts no video of its own: a video is somebody else's player, and the site's own
markup carries no script for it.

**A video may carry linked pictures under its player** *(start_video_links_ckpt152)*: its
row then says `panels` and `columns` as a split figure's does, and every panel names a
short link in `go`, a row of `go/redirects.jsonl`, which is what the picture links to.
The register stays the one place the target is written; the row's recipe keeps the target
each picture was drawn at, and `check`'s `go` holds the two equal, so a redirect that
moves takes its picture out of date loudly rather than in silence.
"""

import importlib
import json
import re
from dataclasses import dataclass
from pathlib import Path

from . import go, records
from .escape import attribute, text
from .paths import FIGURE_IMAGES_DIR, FIGURE_REGISTRY, SITE_ROOT, carrier_path, relative_href

INDENT = " " * 6

#: The hand-off a staged figure draws between one band and the next. It was a drawn
#: triangle on a sheet and is a glyph now, hidden from a screen reader: the band titles
#: already say the order, and *down arrow* read aloud between them says nothing.
ARROW = "↓"

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
#: - `gallery_seat` — a seat of a recorded tentative gallery, `<stamp>|<recipe key>`.
#:   A seat is a location with a recipe already on it, the way a release row is, and it
#:   is how a figure names a picture Matt chose off the curation browser.
#: - `candidate` — a row of the curation candidate ledger, by its own recipe key. A
#:   candidate is what a seat is chosen *from*, and a figure about the choosing shows
#:   pictures the pass looked at and did not seat — which is a record and not a picture
#:   with nothing behind it.
#: - `synthetic` — nothing stored stands behind it: drawn here, or rendered for this
#:   article alone. The row's own `provenance` is the record, and it carries no keys.
#: - `none` — the picture cannot be reconstructed. The row says why, in `held_reason`.
RUN_ROW, LOCATION, SYNTHETIC, NO_SOURCE = "run_row", "location", "synthetic", "none"
GALLERY_SEAT, CANDIDATE = "gallery_seat", "candidate"
SOURCE_KINDS = (RUN_ROW, LOCATION, GALLERY_SEAT, CANDIDATE, SYNTHETIC, NO_SOURCE)


@dataclass(frozen=True)
class Live:
    """A piece a live figure mounts: its module, and the way to it when it cannot run.

    `module` and `elsewhere` are paths from the site root, spelled relative to the page at
    derivation like every other href here; `elsewhere` may carry a query, which rides
    along untouched. `words` is the link text the well carries.
    """

    module: str
    elsewhere: str
    words: str


#: The pieces a figure may mount live. A closed list, like the statuses: a name outside it
#: is a typo in the registry rather than a new kind of figure.
#:
#: - `atlas` — the explorer's Atlas panel, `atlas/frame.js`, mounted by `atlas/embed.js`
#:   in the explorer's own stylesheet for it, with a click opening the explorer.
LIVE = {
    "atlas": Live(
        module="atlas/embed.js",
        elsewhere="explorer/index.html?panel=atlas",
        words="Open the atlas in the fractal explorer",
    ),
}

#: Where a video figure's player comes from: the privacy-enhanced host, which sets no
#: cookie until the reader presses play.
VIDEO_EMBED = "https://www.youtube-nocookie.com/embed/"

#: A YouTube id: eleven characters of the URL-safe alphabet. Anything else is a pasted URL
#: or a typo, and would derive a player that shows an error.
_VIDEO_ID = re.compile(r"[A-Za-z0-9_-]{11}")
#: The kinds that carry keys at all. A `synthetic` or `none` row naming one is a row
#: claiming a record it does not have.
KEYED_KINDS = (RUN_ROW, LOCATION, GALLERY_SEAT, CANDIDATE)

#: How a `gallery_seat` source's keys stand behind the figure's pictures. The word is
#: what `check`'s `seats` reads to decide whether a panel is answerable to the seat's own
#: shipped picture, and it exists because the alternative is a list of figure ids inside
#: the check — an exemption by name, which nothing can audit and which goes stale the
#: first time a figure is re-picked.
#:
#: - `own_recipe` — the default, and what a pick normally means: a panel is that seat,
#:   drawn at the seat's own recipe, so the site's picture and the gallery's are the same
#:   picture and `seats` holds them to that.
#: - `recipe_changed` — the figure alters the recipe on purpose. `render-cyclic-repeats`
#:   sweeps the palette's `cycles` across four panels; the frame and the map are the
#:   seat's and the coloring deliberately is not, so there is nothing to hold to.
#: - `cited` — the key says where a location came from and no panel claims the seat's
#:   pixels at all. `wallpapers-mine` draws a visit of twenty attempts and cites the seat
#:   because it is how that location was chosen, which is what a source key is for.
OWN_RECIPE, RECIPE_CHANGED, CITED = "own_recipe", "recipe_changed", "cited"
DRAWN_WAYS = (OWN_RECIPE, RECIPE_CHANGED, CITED)

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

#: What separates a split figure's id from the panel's number, wherever one picture of a
#: figure has to be addressed on its own — the link registry is the only place so far. A
#: figure id is a slug and carries none of these, so a panel address cannot collide with
#: a figure's.
PANEL_SEPARATOR = "#"

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
    drawn: str | None = None


@dataclass(frozen=True)
class Fact:
    """One load-bearing claim a figure's caption or prose makes, and where it comes from.

    Not published, and not a substitute for the prose: it is the answer to "who checked
    this, against what?" asked of a number the article states as if it were settled.
    """

    claim: str
    source: str


@dataclass(frozen=True)
class Panel:
    """One picture of a **split** figure: its own raster, its own words, its own link.

    A figure used to be one file always, because a sheet of six wallpapers was six
    rasters composited into one picture with its labels drawn into the pixels. That costs
    a reader everything the panels are worth separately: the explorer can only be opened
    at one of the six, a label cannot be selected or read aloud, and nothing scales the
    grid down on a narrow screen. A split figure is the same arrangement made of real
    elements — one `<img>` per panel, each its own link, every label HTML text.

    `label` is the panel's own name and `note` a quieter second piece on the same line,
    which is what a drawn label spelled with a dash between them. The separator is CSS's
    here, so the words a reader meets carry no punctuation this site would not write.

    A panel says which **record** it is, and that is what its link is derived from. `seat`
    is a tentative-gallery seat, `<stamp>|<recipe key>`, and the ledger recipe behind it is
    the whole answer. `spec` is the engine render spec the maker drew with, for the far
    commoner panel that is no seat at all — a frame frozen into a maker, in a neutral map,
    at the mode the figure is about. One or the other, per panel and not per figure,
    because the sheets that need this most are mixed: a family's parameter plane is a
    render this repository asked for and the two Julia sets beside it are seats. Either
    way it describes the **un-annotated** picture wherever the maker letters or marks the
    tile, because the way into the explorer is a way into the place rather than into the
    drawing on top of it.

    Two panels of this article are not one cell of the grid. `wide` is a panel that runs
    the whole row — a plane with the four Julia sets it draws underneath it, a stage
    heading over the pictures it names — and it reflows with the grid rather than pinning
    a column count. `ink` is the colour that ties a panel to a mark drawn on another
    panel: the maker used to draw a frame of it into the tile and letter the label in it,
    and both are the page's now, one custom property wide. A colour is the figure's own
    datum and not a site metric, which is why it travels on the row and the rule that
    spends it is `site.css`'s.

    `band` opens a **stage**: a title, what that stage does, the chips a sheet drew as
    boxes, and how many panels across it runs. The staged figures on this site are
    several grids down one sheet with a hand-off drawn between them, and a band is that
    said in elements — which is also the only way a stage three across can sit above one
    four across, since a grid has one column count and a sheet had none.
    """

    file: str
    width: int
    height: int
    alt: str
    label: str | list[str] | None = None
    note: str | list[str] | None = None
    spec: dict | None = None
    seat: str | None = None
    wide: bool = False
    ink: str | None = None
    band: dict | None = None
    #: A deep panel's key in `article/figure-recipes.jsonl`, `<figure id>#<panel>`: the
    #: Deep-tab link it was drawn from and the grid, which is all a deep panel is. See
    #: `builder/deep_figures.py`.
    deep: str | None = None
    #: The short link a picture under a video's player opens, by its name in
    #: `go/redirects.jsonl`. See the module docstring.
    go: str | None = None

    @property
    def path(self):
        return FIGURE_IMAGES_DIR / self.file


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
    caption_link: tuple[str, str] | None
    panels: tuple[Panel, ...] = ()
    columns: int | None = None
    #: The piece a live figure mounts, by its name in `LIVE`; `None` for a picture.
    live: str | None = None
    #: A video figure's YouTube id; `None` for anything else.
    video: str | None = None

    @property
    def embedded(self) -> bool:
        """Whether this figure is something that runs in its well rather than a raster."""
        return self.live is not None or self.video is not None

    @property
    def split(self) -> bool:
        """Whether this figure is panels rather than one composited picture."""
        return bool(self.panels)

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
        """True while the picture is planned but not yet made. A live or video one never is."""
        return self.file is None and not self.panels and not self.embedded

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

    def panel_src(self, panel: Panel) -> str:
        """One panel's src, spelled the same way and from the same page."""
        return relative_href(self.page_path, panel.path)

    @property
    def rasters(self) -> tuple[tuple[str, object, int, int], ...]:
        """Every file this figure ships, as name, path and the size the row claims.

        One entry for a composited figure and one per panel for a split one, so a caller
        that only wants to know whether the pictures are there and are the size the
        registry says does not have to know which shape it is holding. A live figure ships
        none: what it shows is its piece's own record. Nor does a video, which YouTube hosts,
        beyond the pictures under its player, which are panels.
        """
        if self.split:
            return tuple(
                (panel.file, panel.path, panel.width, panel.height) for panel in self.panels
            )
        if self.pending or self.embedded:
            return ()
        return ((self.file, self.path, self.width, self.height),)


def page_name(path) -> str:
    """How a registry row spells this page — the inverse of `paths.carrier_path`."""
    relative = Path(path).resolve().relative_to(SITE_ROOT)
    if relative.parent.name == "article":
        return relative.name
    # A page at the root has no slash to say it is not a section, so it is given one.
    return relative.as_posix() if len(relative.parts) > 1 else f"./{relative.name}"


def markup(figure: Figure, opened: dict[str, str] | None = None) -> str:
    """The canonical figure block: what an article page must contain, exactly.

    `opened` is every explorer link one page carries, keyed the way `builder/links.py`
    keys them — `figure:<id>` for a composited figure and `figure:<id>#<n>` for a panel
    of a split one. A picture the explorer cannot reproduce carries no link at all rather
    than one that lands somewhere near it, so a missing key is a picture without an
    anchor and never an error.

    **The caption is the caption and nothing else** *(Matt, 2026-08-21)*. It used to end
    with two more sentences that were not about the picture: a credit saying the engine
    drew it, which every render on the site said identically, and the way into the
    explorer written out as a line of prose. The credit is gone and the link is a mark on
    the corner of the picture, so what is left under a figure is what a reader is looking
    at.
    """
    links_by_id = opened or {}
    classes = ["figure"]
    if figure.pending:
        classes.append("figure-pending")
    if figure.split:
        classes.append("figure-split")
    if figure.live is not None:
        classes.append("figure-live")
    if figure.video is not None:
        classes.append("figure-video")
    if figure.live is not None:
        well = _live(figure)
    elif figure.video is not None:
        well = _video(figure)
    elif figure.split:
        well = _panels(figure, links_by_id)
    else:
        well = _well(figure, links_by_id)
    lines = [
        f'{INDENT}<figure class="{" ".join(classes)}" data-figure="{attribute(figure.id)}">',
        well,
    ]
    if figure.caption or figure.caption_link is not None:
        lines.append(
            f"{INDENT}  <figcaption>{_mark(figure)}{text(figure.caption)}"
            f"{_caption_anchor(figure)}</figcaption>"
        )
    lines.append(f"{INDENT}</figure>")
    return "\n".join(lines)


def panel_id(identifier: str, index: int) -> str:
    """How the link registry addresses one panel of a split figure. One-based."""
    return f"figure:{identifier}{PANEL_SEPARATOR}{index}"


def _caption_anchor(figure: Figure) -> str:
    """The sentence a caption ends with where its row carries one, and nothing otherwise."""
    if figure.caption_link is None:
        return ""
    href, words = figure.caption_link
    return f' <a href="{attribute(href)}">{text(words)}</a>.'


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


_FIGURE_ID = re.compile(r'data-figure="([^"]*)"')


def leads_its_page(figure: Figure) -> bool:
    """Whether this is the first figure its page carries, which is the one loaded eagerly.

    **Every other figure is `loading="lazy"`** *(explorer_slim_ckpt131_addendum1)*. A page
    like Rendering modes carries thirteen renders, 5.9 MB, and every one of them used to
    load before a reader had scrolled at all. The first figure is usually on the first
    screen or just under it, so it stays eager; the rest wait until they are near the
    viewport. Every `<img>` already carries its `width` and `height`, so a picture that
    arrives late takes the space it was always given and nothing shifts.

    Read off the page rather than the registry, because the order of figures is the page's.
    A page not carrying any figure yet is one this figure is about to lead.
    """
    page = figure.page_path
    if not page.is_file():
        return True
    first = _FIGURE_ID.search(page.read_text(encoding="utf-8"))
    return first is None or first.group(1) == figure.id


def _well(figure: Figure, opened: dict[str, str]) -> str:
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
    lazy = "" if leads_its_page(figure) else ' loading="lazy"'
    picture = (
        f'<img src="{attribute(figure.src)}" width="{figure.width}" '
        f'height="{figure.height}" alt="{attribute(figure.alt)}"{lazy}>'
    )
    return f"{INDENT}  {_linked(picture, opened.get(f'figure:{figure.id}'))}"


def _live(figure: Figure) -> str:
    """A live figure's well, and the one script that mounts its piece over it.

    The well is what a reader gets where the script cannot run: the row's `alt`, saying
    what would be here, and a link to the piece on its own page. The module finds the well
    by `data-live` beside it and mounts into it. A module script is deferred by the
    browser, so it costs the page nothing before the page has been drawn, and the piece
    fetches what it needs only when its well comes near the viewport.
    """
    piece = LIVE[figure.live]
    target, _, query = piece.elsewhere.partition("?")
    elsewhere = relative_href(figure.page_path, SITE_ROOT / target) + (query and f"?{query}")
    module = relative_href(figure.page_path, SITE_ROOT / piece.module)
    return "\n".join(
        [
            f'{INDENT}  <div class="figure-live-host" data-live="{attribute(figure.live)}">',
            f'{INDENT}    <p class="figure-live-note">{text(figure.alt)} '
            f'<a href="{attribute(elsewhere)}">{text(piece.words)}</a>.</p>',
            f"{INDENT}  </div>",
            f'{INDENT}  <script type="module" src="{attribute(module)}"></script>',
        ]
    )


def _video(figure: Figure) -> str:
    """A video figure's well: the player, and the linked pictures under it where it has any.

    Always lazy, even leading its page: a player is a frame of somebody else's page, and it
    is worth nothing before a reader has scrolled to it. The size is the stylesheet's, 16:9
    at the width of the well, so the iframe carries no width or height of its own. The
    pictures are a split figure's grid, each linking to its short link rather than to a
    link derived from a record, and they stack as the column narrows like any other grid.
    """
    player = (
        f'{INDENT}  <iframe src="{attribute(VIDEO_EMBED + figure.video)}" '
        f'title="{attribute(figure.alt)}" loading="lazy" allowfullscreen></iframe>'
    )
    if not figure.split:
        return player
    return f"{player}\n{_panels(figure, {})}"


def go_href(figure: Figure, panel: Panel) -> str:
    """Where a picture under a video's player links: its short link's page, relatively."""
    return relative_href(figure.page_path, go.GO_DIR / panel.go / go.PAGE)


def _linked(picture: str, opened: str | None) -> str:
    """One picture, wrapped in the way into the explorer where there is one."""
    if not opened:
        return picture
    mark = f'<span class="figure-open-mark" aria-hidden="true">{OPEN_MARK}</span>'
    return (
        f'<a class="figure-open" href="{attribute(opened)}" '
        f'title="{attribute(OPEN_TEXT)}" aria-label="{attribute(OPEN_TEXT)}">'
        f"{picture}{mark}</a>"
    )


def _panels(figure: Figure, opened: dict[str, str]) -> str:
    """A split figure's grid: one picture, one link and one label per panel.

    The arrangement is the composite's — `columns` across at the article's width — and
    the grid stacks on its own as the column narrows, which is the thing a composited
    sheet could never do: a sheet of six scaled to a phone is six pictures at a sixth of
    the size a phone can show one at.

    **A figure in bands is sections of that**, which is the shape the staged sheets have:
    a stage's title and what it does, then the pictures that stage makes, then the
    hand-off to the next one. A band may be a different number across from its
    neighbours — the pipeline's three stages are three, four and three — so the grid is
    the section's and the figure's `columns` is what a band that names none inherits.
    """
    lazy = "" if leads_its_page(figure) else ' loading="lazy"'
    staged = any(panel.band for panel in figure.panels)
    outer = "figure-panels figure-staged" if staged else "figure-panels"
    if any(panel.band and panel.band.get("pool") for panel in figure.panels):
        outer += " figure-flow"
    lines = [f'{INDENT}  <div class="{outer}" style="--figure-across: {figure.columns}">']
    depth = 4 if staged else 2
    open_stage = False
    for index, panel in enumerate(figure.panels, start=1):
        if panel.band:
            if open_stage:
                lines.append(f"{INDENT}    </div>")
            lines.extend(_band(panel.band, figure.columns))
            open_stage = True
        picture = (
            f'<img src="{attribute(figure.panel_src(panel))}" width="{panel.width}" '
            f'height="{panel.height}" alt="{attribute(panel.alt)}"{lazy}>'
        )
        classes = ["figure-panel"]
        if panel.wide:
            classes.append("figure-panel-wide")
        if panel.ink:
            classes.append("figure-panel-marked")
        ink = f' style="--panel-ink: {attribute(panel.ink)}"' if panel.ink else ""
        pad = INDENT + " " * depth
        lines.append(f'{pad}<div class="{" ".join(classes)}"{ink}>')
        target = go_href(figure, panel) if panel.go else opened.get(panel_id(figure.id, index))
        lines.append(f"{pad}  {_linked(picture, target)}")
        if panel.label:
            lines.append(f'{pad}  <p class="figure-label">{_label(panel)}</p>')
        lines.append(f"{pad}</div>")
    if open_stage:
        lines.append(f"{INDENT}    </div>")
    lines.append(f"{INDENT}  </div>")
    return "\n".join(lines)


def _label(panel: Panel) -> str:
    """A panel's words: its own name, then whatever quieter pieces travel with it.

    `note` is one string or several. Several is what a sheet drew as a stack of lines
    under a tile — the step a descent took, the width it reached — and they stay one
    line here with the separator CSS's, because a label that wraps is a label and a label
    in four hard-broken lines is a table.
    """
    notes = (
        panel.note if isinstance(panel.note, list | tuple) else ([panel.note] if panel.note else [])
    )
    quiet = "".join(f'<span class="figure-note">{text(one)}</span>' for one in notes)
    return f"{text(panel.label)}{quiet}"


def _band(band: dict, default_columns: int | None) -> list[str]:
    """One band's hand-off, heading and the section its panels stand in.

    A band may open with the **pool** the stage before it filled *(place_full_pipeline_v6)*:
    a narrow column of its own between two stages, a title and what it holds, which is the
    shape `pipeline-overview` is. A figure with one reads left to right above the rail's
    breakpoint and stacks below it, which is the stylesheet's business, and the hand-off
    glyphs are the stylesheet's too, since which way they point depends on which of the two
    it is.
    """
    lines = []
    pool = band.get("pool")
    if pool:
        lines.append(f'{INDENT}    <div class="figure-pool">')
        lines.append(f'{INDENT}      <p class="figure-pool-title">{text(pool["title"])}</p>')
        if pool.get("note"):
            lines.append(f'{INDENT}      <p class="figure-pool-note">{text(pool["note"])}</p>')
        lines.append(f"{INDENT}    </div>")
    elif band.get("arrow"):
        lines.append(f'{INDENT}    <p class="figure-arrow" aria-hidden="true">{ARROW}</p>')
    across = band.get("columns") or default_columns
    # A `div` and deliberately not a `section`: the contents rail reads a page's prose as
    # everything between `<section class="prose">` and the first `</section>` after it, so
    # a band that closed a section here would take seven of this page's eight rail entries
    # with it. Found by `check`, which is what that check is for.
    lines.append(f'{INDENT}    <div class="figure-stage" style="--figure-across: {across}">')
    lines.append(f'{INDENT}      <header class="figure-band">')
    lines.append(f'{INDENT}        <p class="figure-band-title">{text(band["title"])}</p>')
    if band.get("note"):
        lines.append(f'{INDENT}        <p class="figure-band-note">{text(band["note"])}</p>')
    if band.get("blocks"):
        chips = "".join(
            f'<span class="figure-block{" figure-block-judge" if block.get("judge") else ""}">'
            f"{text(block['text'])}</span>"
            for block in band["blocks"]
        )
        lines.append(f'{INDENT}        <p class="figure-blocks">{chips}</p>')
    lines.append(f"{INDENT}      </header>")
    return lines


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
    panels = _panel_rows(row)
    columns = row.optional_count("columns")
    live = row.optional_text("live")
    if live is not None:
        if live not in LIVE:
            raise records.RecordError(
                f"{row.where}: live {live!r} — the pieces are {', '.join(sorted(LIVE))}"
            )
        if not made:
            raise records.RecordError(
                f"{row.where}: a live figure is made or it is not on the page — "
                f"it cannot be {status}"
            )
        if panels or columns is not None or any(field is not None for field in asset):
            raise records.RecordError(
                f"{row.where}: a live figure is a piece that runs, and names no file, size "
                "or panels"
            )
    video = row.optional_text("video")
    if video is not None:
        if not _VIDEO_ID.fullmatch(video):
            raise records.RecordError(
                f"{row.where}: video {video!r} — a video is its YouTube id, eleven characters"
            )
        if live is not None:
            raise records.RecordError(f"{row.where}: a figure is live or a video, not both")
        if not made:
            raise records.RecordError(
                f"{row.where}: a video figure is made or it is not on the page — "
                f"it cannot be {status}"
            )
        if any(field is not None for field in asset):
            raise records.RecordError(
                f"{row.where}: a video figure is hosted elsewhere, and names no file or size"
            )
        if any(panel.go is None for panel in panels):
            raise records.RecordError(
                f"{row.where}: a picture under a video's player is a short link into the "
                "explorer, and names it in go"
            )
    elif any(panel.go is not None for panel in panels):
        raise records.RecordError(
            f"{row.where}: go is for the pictures under a video's player; a figure's own "
            "panel links from its record"
        )
    if not made and (any(field is not None for field in asset) or panels):
        raise records.RecordError(
            f"{row.where}: a {status} figure names no file or size — the asset does not exist yet"
        )
    if panels and any(field is not None for field in asset):
        raise records.RecordError(
            f"{row.where}: a split figure is its panels — it names no file, width or height "
            "of its own"
        )
    if panels and columns is None:
        raise records.RecordError(
            f"{row.where}: a split figure says how many panels stand across, in columns"
        )
    if columns is not None and not panels:
        raise records.RecordError(f"{row.where}: columns is the width of a grid, and there is none")
    if (
        made
        and not panels
        and live is None
        and video is None
        and any(field is None for field in asset)
    ):
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
        caption=_caption(row, status, note),
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
        caption_link=_caption_link(row),
        panels=panels,
        columns=columns,
        live=live,
        video=video,
    )


def _caption(row: records.Record, status: str, note: str | None) -> str:
    """A row's caption, or nothing where the picture is the whole of what it says.

    **A caption is optional** *(index_top_picture_ckpt141)*. Every figure in the article
    has one, and the row that has none is the front page's picture, which is there to be
    looked at before anything is explained. Absent rather than empty: the registry refuses
    an empty string everywhere, and a figure with no caption carries no `<figcaption>` at
    all. A draft cannot be one, because the caption is where its mark sits.
    """
    caption = row.optional_text("caption")
    if caption is None and status == DRAFT:
        raise records.RecordError(
            f"{row.where}: a draft figure has a caption — it is where the Draft mark goes"
        )
    return caption or ""


#: What one panel of a split figure may say, and which of it it must.
PANEL_FIELDS = (
    "file",
    "width",
    "height",
    "alt",
    "label",
    "note",
    "spec",
    "seat",
    "wide",
    "ink",
    "band",
    "deep",
    "go",
)
PANEL_REQUIRED = ("file", "width", "height", "alt")

#: What a band may say. `title` is required; `note` is the sentence under it, `blocks`
#: the chips beside it, `columns` how many panels that band runs across, and `arrow` the
#: hand-off from the band before. `pool` is the store the stage before filled, drawn
#: between the two in place of the arrow: a title and a note.
BAND_FIELDS = ("title", "note", "blocks", "columns", "arrow", "pool")


def _panel_rows(row: records.Record) -> tuple[Panel, ...]:
    """A row's `panels`, held to each one being a real picture with its own words."""
    stated = row.fields.get("panels")
    if stated is None:
        return ()
    if not isinstance(stated, list) or not stated:
        raise records.RecordError(f"{row.where}: panels must be a non-empty list when present")
    found = []
    for entry in stated:
        if not isinstance(entry, dict):
            raise records.RecordError(f"{row.where}: every panels entry is an object")
        unknown = set(entry) - set(PANEL_FIELDS)
        if unknown:
            raise records.RecordError(
                f"{row.where}: a panel is {', '.join(PANEL_FIELDS)}, "
                f"not {', '.join(sorted(unknown))}"
            )
        missing = [name for name in PANEL_REQUIRED if entry.get(name) is None]
        if missing:
            raise records.RecordError(
                f"{row.where}: a panel names {', '.join(PANEL_REQUIRED)} — "
                f"this one is missing {', '.join(missing)}"
            )
        for name in ("file", "alt", "label", "seat", "deep", "go"):
            value = entry.get(name)
            if value is not None and (not isinstance(value, str) or not value.strip()):
                raise records.RecordError(f"{row.where}: a panel's {name} is a non-empty string")
        note = entry.get("note")
        if note is not None:
            written = note if isinstance(note, list) else [note]
            if not written or not all(isinstance(one, str) and one.strip() for one in written):
                raise records.RecordError(
                    f"{row.where}: a panel's note is a non-empty string, or a list of them"
                )
        _band_fields(row, entry.get("band"))
        for name in ("width", "height"):
            value = entry[name]
            if not isinstance(value, int) or isinstance(value, bool) or value <= 0:
                raise records.RecordError(f"{row.where}: a panel's {name} is a positive integer")
        if entry.get("note") and not entry.get("label"):
            raise records.RecordError(
                f"{row.where}: a panel's note is the quiet half of its label, and this one "
                "has no label to be the quiet half of"
            )
        if entry.get("wide") not in (None, True, False):
            raise records.RecordError(f"{row.where}: a panel's wide is true or absent")
        ink = entry.get("ink")
        if ink is not None and not re.fullmatch(r"#[0-9a-fA-F]{6}", str(ink)):
            raise records.RecordError(
                f"{row.where}: a panel's ink is the colour a mark on another panel was "
                "drawn in, as #rrggbb"
            )
        spec = entry.get("spec")
        if spec is not None and (
            not isinstance(spec, dict) or not isinstance(spec.get("viewport"), dict)
        ):
            raise records.RecordError(
                f"{row.where}: a panel's spec is the engine render spec its picture came "
                "out of, and an engine render spec names a viewport"
            )
        if sum(entry.get(name) is not None for name in ("spec", "seat", "deep", "go")) > 1:
            raise records.RecordError(
                f"{row.where}: a panel is one record — a spec, a seat, a deep recipe or a "
                "short link"
            )
        if entry.get("go") is not None and not go.NAME.fullmatch(entry["go"]):
            raise records.RecordError(
                f"{row.where}: a panel's go is a short link's name, lowercase words joined "
                "by hyphens"
            )
        held = {name: entry.get(name) for name in PANEL_FIELDS}
        held["wide"] = bool(held["wide"])
        found.append(Panel(**held))
    return tuple(found)


def _band_fields(row: records.Record, band) -> None:
    """A band says what it is, and nothing this does not know how to draw."""
    if band is None:
        return
    if not isinstance(band, dict):
        raise records.RecordError(f"{row.where}: a panel's band is an object")
    unknown = set(band) - set(BAND_FIELDS)
    if unknown:
        raise records.RecordError(
            f"{row.where}: a band is {', '.join(BAND_FIELDS)}, not {', '.join(sorted(unknown))}"
        )
    if not isinstance(band.get("title"), str) or not band["title"].strip():
        raise records.RecordError(f"{row.where}: a band names itself in a non-empty title")
    across = band.get("columns")
    if across is not None and (
        not isinstance(across, int) or isinstance(across, bool) or across < 1
    ):
        raise records.RecordError(f"{row.where}: a band's columns is a positive integer")
    for block in band.get("blocks") or []:
        if not isinstance(block, dict) or not isinstance(block.get("text"), str):
            raise records.RecordError(f"{row.where}: a band's block is an object with text")
    pool = band.get("pool")
    if pool is not None and (
        not isinstance(pool, dict)
        or set(pool) - {"title", "note"}
        or not isinstance(pool.get("title"), str)
        or not pool["title"].strip()
        or not isinstance(pool.get("note", ""), str)
    ):
        raise records.RecordError(
            f"{row.where}: a band's pool is an object with a title and, optionally, a note"
        )


def _caption_link(row: records.Record) -> tuple[str, str] | None:
    """The one link a caption may end with, where the figure stands in for a page.

    **A caption is the caption and nothing else**, and that rule is not loosened here:
    this is not the way into the explorer written out as prose, which is a mark on the
    corner of the picture. It is for the narrow case where the figure is a still of
    something a reader can go and use — the atlas plate on the section page, whose marks
    are pictures and links on the tool page and nothing but marks here. The words are a
    sentence of their own and the block supplies the full stop, so there is one place the
    caption lives and the link is part of it.
    """
    held = row.optional_mapping("caption_link")
    if held is None:
        return None
    unknown = set(held) - {"href", "words"}
    if unknown:
        raise records.RecordError(
            f"{row.where}: caption_link is href and words, not {', '.join(sorted(unknown))}"
        )
    for key in ("href", "words"):
        if not isinstance(held.get(key), str) or not held[key]:
            raise records.RecordError(f"{row.where}: caption_link.{key} must be a non-empty string")
    if held["href"].startswith("/") or held["href"].endswith("/"):
        raise records.RecordError(
            f"{row.where}: caption_link.href is relative and names a file — {held['href']!r}"
        )
    return (held["href"], held["words"])


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
        unknown = set(entry) - {"kind", "keys", "drawn"}
        if unknown:
            raise records.RecordError(
                f"{row.where}: a sources entry is kind, keys and drawn, "
                f"not {', '.join(sorted(unknown))}"
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
        drawn = entry.get("drawn")
        if drawn is not None and kind != GALLERY_SEAT:
            raise records.RecordError(
                f"{row.where}: only a {GALLERY_SEAT} source says how it is drawn, and this "
                f"one is {kind}"
            )
        if drawn is not None and drawn not in DRAWN_WAYS:
            raise records.RecordError(
                f"{row.where}: drawn {drawn!r} — the ways are {', '.join(DRAWN_WAYS)}"
            )
        if kind == GALLERY_SEAT and drawn is None:
            drawn = OWN_RECIPE
        found.append(Source(kind=kind, keys=tuple(keys), drawn=drawn))
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
    "live",
    "video",
    "file",
    "width",
    "height",
    "columns",
    "panels",
    "alt",
    "caption",
    "caption_link",
    "recipe",
    "sources",
    "params",
    "facts",
    "provenance",
)


def place(
    identifier: str,
    file: str | None,
    width: int | None,
    height: int | None,
    *,
    provenance: list[str] | None = None,
    recipe: dict | None = None,
    sources: list[dict] | None = None,
    panels: list[dict] | None = None,
    columns: int | None = None,
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

    `sources` is for a maker whose panels **are** record keys: `builder.picks` names its
    picks on the row and draws exactly those, so the row's sources are rewritten with the
    picture rather than left saying what the last set of panels came from.

    `panels` and `columns` land a **split** figure — one raster per panel rather than one
    composited sheet — and then `file`, `width` and `height` are all `None`, because the
    figure has no picture of its own. Landing a split over a composited row takes the old
    row's file, width and height off it, so the registry cannot claim both shapes at once.

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
    if (panels is None) == (file is None):
        raise records.RecordError(
            f"{identifier}: a landing is either one file and its size or a list of panels"
        )
    row["status"] = status
    row.pop("held_reason", None)
    if panels is None:
        row.pop("panels", None)
        row.pop("columns", None)
        row["file"], row["width"], row["height"] = file, width, height
    else:
        for key in ("file", "width", "height"):
            row.pop(key, None)
        row["panels"], row["columns"] = list(panels), columns
    if provenance:
        row["provenance"] = list(provenance)
    if recipe:
        row["recipe"] = recipe
    if sources:
        row["sources"] = list(sources)
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


def _opened(figure: Figure) -> dict[str, str]:
    """The explorer links this figure's block carries, as the link registry keys them.

    Derived rather than assumed: a picture the explorer can draw again *is* the link, so
    the block on the page has an anchor around it and the block a redraw has to find and
    replace has to have one too.
    """
    from . import links

    return links.opened(figure.page_path)


def _heal(figure: Figure, was: str) -> None:
    """Swap the block the figure's page is showing for the one the filled row derives.

    The page is hand-written prose and stays that way; this replaces exactly the block
    the registry already owned, and fails loudly if the page is not carrying it.

    **The new block is derived before the file is opened for writing.** `landing_block`
    reads the page — `leads_its_page` is the page's question, not the registry's — and
    `open("w")` truncates it, so deriving inside the `with` asked that question of an empty
    file: every figure came back leading its page and every non-leading one lost its
    `loading="lazy"` *(website_webp_and_atlas_deprecate, 2026-09-21, found by healing 54
    blocks at once — `figures` and `landing` both went red on 44 of them)*.
    """
    page = figure.page_path
    with page.open(encoding="utf-8", newline="") as handle:
        html = handle.read()
    if was not in html:
        raise records.RecordError(
            f"{page.name} is not carrying {figure.id}'s block — place the block "
            f"`python -m builder figure {figure.id}` by hand"
        )
    healed = html.replace(was, landing_block(figure), 1)
    with page.open("w", encoding="utf-8", newline=LF) as handle:
        handle.write(healed)


#: Where a page's copy of a figure's block begins, so that a block whose *links* moved can
#: be found without knowing what it used to say.
BLOCK_START = '{indent}<figure class="'
BLOCK_END = f"{INDENT}</figure>"


def reprint(figure: Figure) -> bool:
    """Rewrite the block a page carries for one figure, from the registry, in place.

    The second pass `builder/README.md` lists under *still hand-done*. `place` heals with
    the link as it stood **before** the redraw, so a figure whose links moved — every
    split figure, whose one link becomes one per panel — lands on the page with the old
    hrefs and needs the block printing again. That was a copy and paste, which is a step
    somebody forgets and `check` then names on the next run; twenty figures of it is
    twenty chances. This finds the block by its `data-figure`, which is the one part of it
    that does not move, and swaps in what the row derives. It writes nothing else: it
    cannot land a figure, cannot change a row, and a page already carrying the right block
    comes back untouched.
    """
    page = figure.page_path
    with page.open(encoding="utf-8", newline="") as handle:
        html = handle.read()
    marker = f'data-figure="{attribute(figure.id)}"'
    at = html.find(marker)
    if at < 0:
        raise records.RecordError(f"{page.name} carries no block for {figure.id}")
    start = html.rfind(BLOCK_START.format(indent=INDENT), 0, at)
    end = html.find(BLOCK_END, at)
    if start < 0 or end < 0:
        raise records.RecordError(
            f"{page.name}: {figure.id}'s block is not a whole <figure> element"
        )
    was = html[start : end + len(BLOCK_END)]
    block = landing_block(figure)
    if was == block:
        return False
    with page.open("w", encoding="utf-8", newline=LF) as handle:
        handle.write(html[:start] + block + html[end + len(BLOCK_END) :])
    return True


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
    GALLERY_SEAT: ("<stamp>|<recipe key>  → artifacts/curation/tentative/<stamp>/gallery.jsonl",),
    CANDIDATE: ("<recipe key>  → artifacts/curation/candidate_ledger/rows.jsonl",),
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
        self._seats: dict[str, set[str] | None] = {}

    def candidate_keys(self, wanted) -> set[str]:
        from . import picks

        return set(picks.ledger_rows(wanted))

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

    def gallery_keys(self, stamp: str) -> set[str] | None:
        """Every recipe key one recorded tentative gallery seats, or `None` for no record.

        The record and never the ledger: what a `gallery_seat` key claims is a *seat*,
        and the seats file is a few hundred short lines while the ledger is a quarter of
        a gigabyte a solve next door may be reading.
        """
        if stamp not in self._seats:
            path = self._renders.artifact("curation", "tentative", stamp, "gallery.jsonl")
            if not path.is_file():
                self._seats[stamp] = None
            else:
                with path.open(encoding="utf-8") as handle:
                    self._seats[stamp] = {
                        str(json.loads(raw)["key"]) for raw in handle if raw.strip()
                    }
        return self._seats[stamp]

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
    from . import recipes

    stores = _Stores()
    # **The site's own recipe store answers for a seat or a candidate before the stores
    # next door do** *(atlas_refresh_ckpt139)*. Six of the recorded galleries this site's
    # figures were picked off no longer exist there; what makes those keys resolve is that
    # `article/figure-recipes.jsonl` holds the seat and the recipe, and that is the answer
    # this check wants — a picture somebody can still redraw. A key the store does not
    # hold is asked of the stores as before, and `check`'s `figures` separately holds every
    # cited pick to *being* in the store.
    held = set(recipes.load_all())
    problems = []
    for figure in (registry or load_all()).values():
        for source in figure.sources:
            for key in source.keys:
                problem = _unresolved_key(stores, source.kind, key, held)
                if problem:
                    problems.append(f"figures.jsonl: {figure.id} {problem}")
    return problems


def _unresolved_key(stores: _Stores, kind: str, key: str, held: set[str]) -> str | None:
    from . import recipes

    if kind == GALLERY_SEAT and str(key) in held:
        return None
    if kind == CANDIDATE and f"{recipes.CANDIDATE_STAMP}{recipes.SEPARATOR}{key}" in held:
        return None
    if kind == RUN_ROW:
        return _unresolved_run_row(stores, key)
    if kind == LOCATION:
        return _unresolved_location(stores, key)
    if kind == GALLERY_SEAT:
        return _unresolved_gallery_seat(stores, key)
    if kind == CANDIDATE:
        return _unresolved_candidate(stores, key)
    return None


def _unresolved_candidate(stores: _Stores, key: str) -> str | None:
    """A bare recipe key against the candidate ledger, in one streamed pass.

    Never the pool: a solve may be running next door, and a check has no business
    loading what it is solving over. `picks.ledger_rows` stops as soon as it has the
    keys it was asked for.
    """
    if "|" in key or not key.strip():
        return f"names {key}, and a candidate is addressed by its recipe key alone"
    if key not in stores.candidate_keys((key,)):
        return f"names {key}, and the candidate ledger has no row with that recipe key"
    return None


def _unresolved_gallery_seat(stores: _Stores, key: str) -> str | None:
    """A seat key against the recorded gallery its stamp names."""
    stamp, separator, recipe_key = key.partition("|")
    if not separator or not stamp.strip() or not recipe_key.strip():
        return f"names {key}, and a gallery seat is addressed <stamp>|<recipe key>"
    seated = stores.gallery_keys(stamp.strip())
    if seated is None:
        return f"names {key}, and no tentative gallery is recorded under {stamp.strip()}"
    if recipe_key.strip() not in seated:
        return f"names {key}, and no seat of that recorded gallery has that key"
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
