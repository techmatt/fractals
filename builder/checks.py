"""The checks the bootstrap did by hand, made mechanical.

Every one of them read-only, and every one of them runs on a clone with nothing beside
it. Three things a clone need not have are wanted here — the wallpaper project's
checkout, Pillow, and a staged gallery's untracked pictures — and what a check does
without one is report a **named skip**: which check, which half of it, and why. Never a
crash before the other checks, and never a silent pass. `check` used to build the palette
library page straight off the checkout, so the first thing it did on a machine without one
was raise, and every check after it went unrun.

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
  `builder` names one that is still there. Every source key resolves against the store
  its kind names, where the wallpaper project is checked out — a note rather than a
  failure where it is not, because CI clones this repository alone. A `held` row is the
  one row that is registered and deliberately not on a page, and it says what it is
  held on.
- **seats** — every panel that is a gallery seat *at its own recipe* is that seat's own
  picture, to a stated tolerance. The site draws such a panel by redrawing the recipe,
  and a recipe is not the whole story: the autolevel operator may have pushed a tone
  curve through the map's stops before the run wrote the picture the gallery ships. Where
  it did and the site did not, the page publishes the right geometry in the wrong colour,
  and every other check stays green — which is exactly what happened to
  `overview-pipeline` on 2026-09-02. Held at the seat's own regime, so the number is
  colour and not resampling. Exemptions are **on the record**: a `gallery_seat` source
  says `recipe_changed` or `cited` and the check reads it, because a list of excused
  figure ids inside the check is an exemption nothing can audit. Needs the wallpapers
  checkout and Pillow, and says so by name where either is missing.
- **landing** — every made figure's page carries a block a redraw could land on. `figures
  --replace` and every drawing command find the block they are about to swap by
  deriving it, so the derivation is load-bearing in a way **figures** does not reach:
  `landing_block` once left the explorer link out and refused a redraw of nearly every
  render here while every other check stayed green.
- **locations** — no location stands under two figures. A figure's `provenance` spells
  out the frame each panel was drawn on, and **no location is reused across the site
  unless the repetition is intentional** *(Matt, 2026-09-01)* — so a frame appearing
  under two slugs fails here, and the way to keep it is a `reuse_reason` on the row that
  says why the repetition is wanted and **names the figure it repeats** — which is what
  keeps one excused frame from excusing every other frame that row stands on. The reason
  is checked back: one that excuses no collision has outlived it, and comes out. What
  the check compares is the frame written down — family, degree, constants, centre and
  width — so a place drawn at two different zooms reads as two locations here and is a
  judgement call the record cannot make for anybody.
- **contents** — every hand-written page carries the contents rail the builder derives,
  every prose heading carries the id its own words give it, and the front page's contents
  list marks the same sections done that `sections.jsonl` calls written.
- **assets** — every image the metadata names exists at the size it claims, every
  thumbnail is current, and no orphan file is left in a gallery directory. A **staged**
  gallery is held to the same things once its pictures are here, bar the thumbnail — its
  picture is already the explorer panel's tile — and is a named skip where they are not:
  they are untracked by design, so a clone has the record alone.
- **prose** — every row of `article/prose.jsonl` names a page that is in the article and
  is written. The master itself lives in the Drive-synced working folder, which is not
  in a clone and never in CI, so what is checked here is the registry and not the
  document: `python -m builder prose` is what holds the two texts together.
- **library** — this repository's palette record still says what the wallpaper project's
  own library says: the same maps, in the same hues, in the same order. The page is
  held to the record by **pages**, everywhere; the record is held to the library here,
  and only where that checkout is configured.
- **guidance** — `CLAUDE.md` names `writing-guidance.md`, the editorial authority. That
  document is not in this repository and cannot be: both halves of the project write to
  it. So the one thing a clone can be held to is that the file every prompt does read
  points at it, and a rename or a tidy-up that drops the pointer fails here.
- **atlas** — the atlas record is the shape the atlas frame reads, which the explorer's
  Atlas tab is the one page to mount: every dot carries its own viewport keys as decimal
  strings, sits inside the plane its partition names and no closer to its neighbours than
  the separation radius that partition claims, and every pre-rendered thumbnail is on disk
  at the size its row gives. Whether a dot's *link* parses is asked of the permalink
  contract itself, by `atlas/atlas.test.mjs`, for the same reason the explorer's links are:
  the contract is written in JavaScript.
- **agreement** — every atlas slot's link is its picture. The **atlas** check and
  `atlas.test.mjs` ask whether a slot's link is a well-formed link; this asks whether it
  opens the picture on the card, member for member against the recipe the thumbnail was
  drawn from, on every slot — and, for a fixed sample of one slot a plane, by drawing the
  link through the committed wasm and setting it beside the stored thumbnail, with a
  control that has to fail. `agreement.py` says why it exists: 28 slots once opened at a
  texture weight none of them was drawn at, with every structural test green. The pixel
  half is a named skip without the staged thumbnails, `palettes.bin` or Pillow.
- **theme** — the well colours a drawn figure is made of are the stylesheet's own. They
  have to be transcribed, because Pillow cannot read CSS; this is what keeps a restyle
  from moving the well and leaving every diagram drawn against the old one.
- **vocabulary** — no tracked file uses a word this site has banned. `vocabulary.py`
  holds the list and says why each term is on it.
- **dashes** — no em-dash in the words a reader meets: the body of every section, of the
  front page, of the gallery index and of the page hanging off Color palettes, and every
  caption and alt in the figure registry. The rule is `writing-guidance.md`'s and it was
  held by hand through a two-day sweep; it is mechanical from 2026-09-07, because the
  regression it catches is a page **arriving** with them rather than a page drifting.
  `dashes.py` says what it reads, what it does not, and why there is no allowlist.
- **endings** — no tracked file has drifted to CRLF on disk. `.gitattributes` normalizes
  on the way in, so a CRLF file **still commits as LF**: `git status` is empty, `git diff`
  is empty, and the drift waits there until something rewrites the file line by line and
  produces a whole-file diff nobody asked for. `git ls-files --eol` is the only thing that
  reports it — `grep` cannot, and confidently names a clean tree dirty — and this is that
  sweep, with the assertion that it returned rows at all, because a parse that silently
  yields nothing is a guard that passes everything.
- **explorer** — every figure and every gallery tile is in the explorer link registry,
  as a link or as a stated reason there is none, and every link the registry holds is
  the one the page carries. Whether a link *parses* is asked of the permalink contract
  itself, by `permalink.test.mjs`, because the contract is written in JavaScript and a
  second reading of it in Python is exactly what a URL contract cannot survive. The
  picker's two records are held here too: `palette-names.json` names only maps the
  explorer carries and never gives two of them one display name, and `popular.json` lists
  24 carried maps once each. A map with no display name is a printed count, not a failure.
- **bake** — the explorer's two generated modules are what a rebake produces from the
  committed rosters and the wallpaper project next door, both byte for byte, because both
  stamps are read off a record — `explorer/palettes.jsonl` and `explorer/modes.jsonl` —
  rather than off the clock. So a gradient, an identity line or an anchor constant that
  moved next door fails here rather than arriving as a diff nobody looks at, and a mode
  the engine promotes does not reach the picker at all until the record names it. It also
  holds the palette roster to the figures: a picture drawn in a map the roster does not
  carry is a picture the explorer cannot open. Only where the checkout is configured — a
  clone has no library to bake from, and the modules it serves are the committed ones
  either way.
"""

import json
import re
import subprocess
from dataclasses import dataclass
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote, urldefrag

from . import (
    agreement,
    dashes,
    explorer,
    figures,
    galleries,
    images,
    links,
    pages,
    palettes,
    picker,
    picks,
    prose,
    recipes,
    records,
    renders,
    sections,
    theme,
    vocabulary,
)
from . import (
    atlas as atlas_module,
)
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

#: `.gitattributes` normalizes this repository to LF, and a generated module is compared
#: to a committed one line by line, so the split is spelled rather than taken from the
#: platform.
LF = "\n"


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
    # The picker's two records beside the index. A map with no display name is not a
    # problem — the page shows its underlying name — so that is a count `check` prints as
    # a note, and what fails here is a record naming a map the page does not carry, or two
    # maps a reader would see under one name.
    carried = [entry.name for entry in explorer.roster()[1]]
    problems.extend(picker.name_problems(carried)[0])
    problems.extend(picker.popular_problems(carried))
    return problems


def unnamed_palettes() -> tuple[int, int]:
    """How many carried maps `palette-names.json` gives no display name, and of how many."""
    carried = [entry.name for entry in explorer.roster()[1]]
    return picker.name_problems(carried)[1], len(carried)


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
            elif figures.markup(figure, opened) not in html:
                problems.append(
                    f"{where}: figure {identifier!r} does not match the registry — "
                    f"`python -m builder figure {identifier}`"
                )

    for figure in registry.values():
        problems.extend(_figure_page(figure, carried))
        problems.extend(_figure_recipe(figure))
        if figure.pending:
            continue
        problems.extend(_figure_facts(figure))
        for name, path, width, height in figure.rasters:
            if not path.is_file():
                problems.append(f"figures.jsonl: {figure.id} names a missing {name}")
            elif images.available():
                actual = images.dimensions(path)
                if actual != (width, height):
                    problems.append(
                        f"figures.jsonl: {figure.id} says {width}x{height}, "
                        f"{name} is {actual[0]}x{actual[1]}"
                    )
    problems.extend(recipes.problems())
    if figures.stores_available():
        problems.extend(figures.unresolved(registry))
    return problems


def _figure_facts(figure: figures.Figure) -> list[str]:
    """A row that records no source at all records nothing, and says so out loud.

    `sources` is required at load, so what is left to check here is the one combination
    the loader cannot see: a made picture whose only source is `none` has to carry the
    reason, or the gap it is admitting to is not written down anywhere.
    """
    if all(source.kind == figures.NO_SOURCE for source in figure.sources) and (
        not figure.held_reason
    ):
        return [
            f"figures.jsonl: {figure.id} records no source and no held_reason — "
            "an unreconstructible picture says why, or the gap is invisible"
        ]
    return []


#: How far a panel drawn here may sit from the picture the gallery ships, as a mean
#: absolute difference per channel out of 255, compared at the seat's own regime.
#:
#: Picked off a measurement of all twenty-one seat panels on the site *(2026-09-02)*
#: rather than chosen: the codec floor — the shipped JPEG merely re-encoded at this
#: site's own quality — runs 1.39 to 2.75, and a correctly drawn panel lands between
#: 3.03 and 5.52, roughly twice the floor, which is the engine's own sampling against a
#: stored JPEG and not a colour difference. Six is the round number above that spread.
#: It is not a slack tolerance: the bug this check was written for measured 29.51, and
#: `escape-families`' one unrecoverable seat measured 9.04, so the band that passes every
#: reproducible panel still fails both by a wide margin.
SEAT_TOLERANCE = 6.0

#: What a seat panel is compared at. The seat's own picture is the size the run wrote it,
#: and comparing there is what isolates colour from resampling — a panel drawn at the
#: figure's own geometry and scaled would fold a resize into the number and make the
#: tolerance mean nothing.
SEAT_SUPERSAMPLE = 2


def check_seats() -> list[str]:
    """Every panel that is a gallery seat at its own recipe is that seat's own picture.

    The check the colour bug of 2026-09-02 earned. `overview-pipeline` drew `a693d6c7`
    from the ledger recipe alone, the autolevel operator had acted on the picture the
    gallery ships, and the two were 29.51 apart on a scale where 2.4 is what re-encoding
    the JPEG costs — a rust-red ground published as pale salmon, with every other check
    green. Nothing compared a figure's pixels with the record's pixels, so nothing could
    have caught it.

    What is exempt is exempt **by the record**, never by name: a `gallery_seat` source
    says how it is drawn, and `recipe_changed` or `cited` is a claim on the row that a
    person can read and `figures` refuses to load misspelled. A figure that quietly stops
    reproducing its seat cannot buy itself an exemption by being added to a list here.

    **Two halves, and the first covers every seat a figure cites however it is drawn.**
    A pick is only as good as the run record that answers it, and `picks.RUN_RECORDS` is
    a typed list of those records rather than a search: a `runs` pass writing its browser
    picks to `on_demand.jsonl` went unnamed there, and fifteen seats of the tentative
    gallery had no reachable stamp at all. A figure naming one raised where a maker ran
    it and nowhere else. So the reachability half asks `run_stamp` for every cited seat,
    exempt or not, and the pixel half compares only the ones drawn at their own recipe.
    The first needs no Pillow, which is why it is not behind the same gate.
    """
    problems: list[str] = []
    if not figures.stores_available():
        return problems
    registry = figures.load_all()

    cited: dict[str, list[str]] = {}
    wanted: list[tuple[str, str]] = []
    for figure in registry.values():
        if figure.pending:
            continue
        for source in figure.sources:
            if source.kind != figures.GALLERY_SEAT:
                continue
            for key in source.keys:
                cited.setdefault(key, []).append(figure.id)
            if source.drawn == figures.OWN_RECIPE:
                wanted.extend((figure.id, key) for key in source.keys)
    if not cited:
        return problems

    try:
        resolved = {pick.identifier: pick for pick in picks.resolve(sorted(cited))}
    except picks.PickError as error:
        return [f"seats: no panel could be held to its seat — {error}"]

    levelled: dict[str, picks.Levelling] = {}
    for identifier in sorted(cited):
        try:
            levelled[identifier] = picks.run_stamp(resolved[identifier])
        except picks.PickError as error:
            problems.append(
                f"figures.jsonl: {', '.join(sorted(set(cited[identifier])))} names a seat no "
                f"run record reaches — {error}. If the run wrote a record "
                "`picks.RUN_RECORDS` does not name, name it there."
            )
    if not wanted:
        return problems
    if not images.available():
        return problems

    try:
        catalog = renders.mode_catalog()
    except renders.EngineError as error:
        return problems + [f"seats: no panel could be held to its seat — {error}"]

    cache = picks.cache()
    for figure_id, identifier in wanted:
        pick = resolved[identifier]
        levelling = levelled.get(identifier)
        if levelling is None:
            continue
        try:
            shipped = picks.seat_picture(pick)
            if levelling.way == picks.UNRECOVERABLE:
                # The rig's own answer here is the shipped file itself — `panel` refuses
                # to draw one of these at all, so a maker either copies the seat or has
                # no figure. Comparing the copy with itself is not a vacuous test: what it
                # holds is that the seat *is* still on this machine and still addressable,
                # which is the one way a copied panel can rot.
                drawn = shipped
            else:
                drawn = cache.produce(
                    f"seats-{pick.key[:8]}",
                    "render",
                    picks.panel_spec(
                        pick,
                        catalog,
                        resolution=images.dimensions(shipped),
                        supersample=SEAT_SUPERSAMPLE,
                        levelling=levelling,
                    ),
                ).path
        except (picks.PickError, renders.EngineError) as error:
            problems.append(
                f"figures.jsonl: {figure_id} cannot hold {identifier} to its seat — {error}"
            )
            continue
        difference = images.mean_abs_difference(shipped, drawn)
        if difference > SEAT_TOLERANCE:
            problems.append(
                f"figures.jsonl: {figure_id} draws {pick.alias} {difference:.2f} from the "
                f"picture its seat ships, over the {SEAT_TOLERANCE:.1f} this site allows "
                f"(the codec floor alone is about 2). The panel was drawn {levelling.way} "
                f"off {levelling.where}."
            )
    return problems


def check_landing() -> list[str]:
    """Every made figure is a block a redraw could actually land on.

    A redraw — `figures --replace`, and the `--replace` every drawing command
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
    if figure.held:
        # The one row that is registered and deliberately not on its page. What it owes
        # instead is its reason, which the loader has already required.
        if where is not None:
            return [
                f"figures.jsonl: {figure.id} is held and {where} is carrying it — lift the "
                "hold, or take the block off the page"
            ]
        return []
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


def staged_without_pictures(gallery: galleries.Gallery) -> bool:
    """Whether a staged gallery's directory holds none of the pictures its record names.

    A staged gallery's pictures are untracked by design — thousands of tiles are tens of
    megabytes, and what commits is the record. So on a clone, and on any machine where
    `python -m builder seats` has not been run, the directory is the record alone, and
    that is a check this machine cannot ask rather than a site that is broken. One or more
    pictures present means the command has run and the whole gallery is checked exactly as
    a publishable one is: a half-landed directory is a real problem and says so.
    """
    return gallery.staged and not any(
        (gallery.directory / image.file).is_file() for image in gallery.images
    )


def check_assets(loaded: list[galleries.Gallery]) -> list[str]:
    problems = []
    can_measure = images.available()
    for gallery in loaded:
        if staged_without_pictures(gallery):
            continue
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
            if gallery.staged:
                # A staged gallery's picture is its tile: the explorer panel opens the
                # viewer on a click, so there is no larger size to make a thumbnail of.
                continue
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
        if (
            path.name != GALLERY_METADATA_NAME
            and path.name not in gallery.records
            and path.name not in named
        ):
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


def check_locations() -> list[str]:
    """No location stands under two figure slugs unless a row says the repetition is wanted.

    *No location is reused across the site unless the repetition is intentional* (Matt,
    2026-09-01). The site's argument is that the search keeps finding places worth
    looking at, and a place that turns up on three pages quietly says the opposite — so
    the repetition has to be a decision somebody made rather than one nobody noticed.

    A row claims its repetition with `reuse_reason`, and **the reason names the other
    figure by slug**. That is what scopes it: a row excused for one frame stays under the
    guard for every other frame it stands on. The first cut of this check took an excused
    row out of the comparison altogether, which meant a reason written about a family's
    home view silently excused the same figure's reuse of a Julia set on another page —
    and the tamper test caught it by finding nothing.

    The reason is held the other way too. One that excuses no collision — because the
    figure it names is not on any frame this figure stands on, or because the collision
    is gone — is stale, and stale is how a guard rots: the follow-up prompt that re-picks
    a figure's location drops the collision, and the excuse has to come out with it.
    """
    registry = figures.load_all()
    standing: dict[str, set[str]] = {}
    for figure in registry.values():
        for frame in figure.frames:
            standing.setdefault(frame, set()).add(figure.id)

    problems = []
    honoured: set[str] = set()
    for frame, slugs in sorted(standing.items()):
        if len(slugs) < 2:
            continue
        claiming = {
            slug
            for slug in slugs
            if (registry[slug].reuse_reason or "")
            and any(other in registry[slug].reuse_reason for other in slugs - {slug})
        }
        if claiming:
            honoured |= claiming
            continue
        problems.append(
            f"figures.jsonl: the location `{frame}` stands under {', '.join(sorted(slugs))} — "
            "one location to one figure, or the row that repeats it carries a reuse_reason "
            "naming the figure it repeats"
        )
    for figure in sorted(registry.values(), key=lambda found: found.id):
        if figure.reuse_reason and figure.id not in honoured:
            problems.append(
                f"figures.jsonl: {figure.id} carries a reuse_reason that excuses no "
                "collision — the excuse has outlived the repetition, or never named it"
            )
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


def check_bake() -> list[str]:
    """The explorer's generated modules against a rebake of them.

    The picker is a thing a reader is offered, and it changed once by accident: the bake
    read "every curated map" out of the library next door, that library took a drop of
    two hundred authored maps, and a rebake nobody ran on purpose would have grown the
    picker from 77 entries to 277. The mode half went the same way a fortnight later,
    when the engine promoted `tail_itinerary` into a roster the bake was reading whole.
    Both rosters are committed here now, and this is what says the committed modules are
    still what they bake to.

    Nothing here without the checkout: a bake reads the gradients out of the library, so
    a clone cannot ask the question at all — and the module it serves is the committed
    one regardless, which is the whole point of committing it.
    """
    if not figures.stores_available():
        return []
    try:
        return _bake_problems()
    except (renders.EngineError, explorer.ExplorerError, records.RecordError, OSError) as error:
        return [f"explorer: the bake could not be reproduced here — {error}"]


def _bake_problems() -> list[str]:
    problems = []
    made = explorer.palettes_module_text()
    committed = _read(explorer.PALETTES_MODULE)
    if made.text != committed:
        problems.append(
            f"{_shown(explorer.PALETTES_MODULE)}: not what "
            "`python -m builder explorer --palettes-only` bakes from "
            f"{_shown(explorer.PICKS_RECORD)} — {_first_difference(made.text, committed)}"
        )
    problems += _blob_problems(made.blob)
    catalogued, _modes = explorer.catalog_module_text()
    committed = _read(explorer.CATALOG_MODULE)
    if catalogued != committed:
        problems.append(
            f"{_shown(explorer.CATALOG_MODULE)}: not what `python -m builder explorer` bakes "
            f"from {_shown(explorer.MODES_RECORD)} and the engine beside it — "
            f"{_first_difference(catalogued, committed)}"
        )
    return problems + _unbakeable() + _random_problems()


def _blob_problems(baked: bytes) -> list[str]:
    """The control points on disk against the ones this bake makes of them.

    **Absent is a problem and not a skip.** The blob is untracked, so a fresh clone of
    this repository has the index and not the gradients — but this check only runs where
    the wallpapers checkout is configured, and on such a machine the blob is one command
    away. A page whose index addresses a file that is not there draws nothing, and saying
    so here is cheaper than finding out in a browser.
    """
    where = _shown(explorer.PALETTES_BLOB)
    if not explorer.PALETTES_BLOB.is_file():
        return [
            f"{where}: the index in {_shown(explorer.PALETTES_MODULE)} addresses it and it is "
            "not here. `python -m builder explorer --palettes-only` writes it; it is untracked "
            "on purpose, so a clone has to bake it."
        ]
    committed = explorer.PALETTES_BLOB.read_bytes()
    if committed == baked:
        return []
    if len(committed) != len(baked):
        return [
            f"{where}: {len(committed):,} bytes on disk and {len(baked):,} baked, so the index "
            "beside it addresses the wrong gradients"
        ]
    pairs = enumerate(zip(committed, baked, strict=True))
    at = next(index for index, (one, other) in pairs if one != other)
    return [
        f"{where}: the bytes differ from a rebake, first at byte {at:,} of {len(baked):,} — "
        "a gradient moved in the library next door, or the roster did"
    ]


def _first_difference(baked: str, committed: str) -> str:
    """Where two texts part company, as a line number and both lines."""
    left, right = baked.split(LF), committed.split(LF)
    for number, (one, other) in enumerate(zip(left, right, strict=False), start=1):
        if one != other:
            return f"line {number} bakes to {one.strip()[:60]!r}, committed {other.strip()[:60]!r}"
    return f"the bake is {len(left)} lines and the committed module is {len(right)}"


def _unbakeable() -> list[str]:
    """A colormap one of this site's pictures was drawn in and the roster does not carry.

    The roster is what the bake reads, so a map outside it is not in `palettes.js`, so
    the link that figure carries names a palette the page cannot draw. `links.py` derives
    those links off the same word in the same provenance line, which is why this is the
    one thing the roster owes the figure registry.
    """
    directory = renders.wallpapers_root() / explorer.COLORMAP_SOURCE
    held = {
        json.loads(path.read_text(encoding="utf-8"))["name"] for path in directory.glob("*.json")
    }
    carried = {entry.name for entry in explorer.roster()[1]}
    missing = sorted(explorer.drawn_in(held) - carried)
    return [
        f"{_shown(explorer.PICKS_RECORD)}: a figure is drawn in {name}, which the roster does "
        "not carry, so the explorer cannot open that picture"
        for name in missing
    ]


def _random_problems() -> list[str]:
    """The roster's `random` flags against the list the wallpaper project states.

    A record next door with a consumer here is a schema with two readers, and the second
    is invisible from the first: the list is re-derived over there at every publication,
    and this is what turns a list that moved into a failing check rather than a Random
    palette button quietly drawing from last month's answer. `python -m builder explorer
    --random` is the fix, and it names what changed.

    A listed map the roster does not carry is not counted here — [`mark_random`] skips it
    and says so, because the list reads a published gallery and this roster is the library.
    """
    listed = explorer.random_choice()
    if listed is None:
        return [
            f"{_shown(explorer.PICKS_RECORD)}: its `random` flags cite "
            f"{'/'.join(explorer.RANDOM_SOURCE)} and the checkout no longer holds it — either "
            "the list moved next door or this record is citing a file nobody wrote"
        ]
    entries = explorer.roster()[1]
    carried = {entry.name for entry in entries}
    wanted = {name for name in listed if name in carried}
    marked = {entry.name for entry in entries if entry.random}
    if wanted == marked:
        return []
    return [
        f"{_shown(explorer.PICKS_RECORD)}: {len(marked)} maps are marked for a random pick and "
        f"the list next door holds {len(wanted)} this roster carries — "
        f"{len(wanted - marked)} listed and unmarked, {len(marked - wanted)} marked and no "
        "longer listed. `python -m builder explorer --random`"
    ]


def check_library() -> list[str]:
    """The palette record against the library it was written from.

    Nothing here on a machine without the checkout: the record *is* what the page is held
    to, everywhere, and this is the one question that needs the thing next door. A
    configured checkout that cannot answer is reported rather than raised — a broken
    machine is a problem this can name, and it is not a reason for every other check to
    go unrun.
    """
    if not figures.stores_available():
        return []
    try:
        return palettes.library_drift()
    except (renders.EngineError, palettes.PaletteError, OSError) as error:
        return [f"library.jsonl: the configured checkout could not be read — {error}"]


#: The working-tree endings that are drift. `git ls-files --eol` writes each tracked file
#: as `i/<eol> w/<eol> attr/<attrs>`, a tab, then the path; `i/` is what the index holds
#: and `w/` is what is on disk. A binary file reads `-text` on both sides and is never a
#: hit here.
DRIFTED_ENDINGS = frozenset({"w/crlf", "w/mixed"})


def endings_rows() -> list[str]:
    """Every tracked file's endings, one row each, as git reports them."""
    completed = subprocess.run(
        ["git", "ls-files", "--eol"],
        cwd=str(SITE_ROOT),
        capture_output=True,
        text=True,
        check=True,
    )
    return [row for row in completed.stdout.split(LF) if row]


def check_endings() -> list[str]:
    """No tracked file has drifted to CRLF on disk.

    `.gitattributes` normalizes this repository on the way in, so a CRLF working-tree file
    **still commits as LF**: `git status` shows nothing, `git diff` comes back empty, and
    the file sits there until something reads it and rewrites it with an explicit LF
    newline — a diff that rewrites every line at once for no reason anybody can see. This
    is the one thing that reports it. `grep` cannot: a CR-at-end-of-line pattern matches
    every line of a pure-LF file in Git Bash here, and names a clean tree dirty.

    The vacuity assertion is the second half and not a flourish. A guard whose parse
    silently yields nothing passes everything, and this one's parse is a split on a tab in
    text that comes back from a subprocess — exactly the shape that goes quiet rather than
    loud when it breaks.
    """
    rows = endings_rows()
    if not rows:
        return [
            "git ls-files --eol: no rows — the sweep read nothing, and a sweep that reads "
            "nothing has no file it could ever fail on"
        ]
    problems = []
    for row in rows:
        flags, _, path = row.partition("\t")
        drifted = sorted(DRIFTED_ENDINGS.intersection(flags.split()))
        if drifted:
            problems.append(
                f"{path}: {drifted[0]} on disk, and nothing else will ever say so — "
                "the index holds it as LF and the diff is empty"
            )
    return problems


#: Why a skip happened, spelled once. Both are states of the machine rather than of the
#: site, which is exactly why neither may fail a check and neither may pass one silently.
NO_CHECKOUT = "the fractal-wallpapers checkout is not configured here"
NO_PILLOW = "Pillow is not installed here"

#: The third state of the machine that stops a check asking its question. A staged
#: gallery's pictures are untracked on purpose, so a clone has the record and none of the
#: files it names — which is not the site being wrong, and must not read as the check
#: having passed either.
NO_STAGED_PICTURES = "its pictures are untracked and have not been landed on this machine"


@dataclass(frozen=True)
class Skip:
    """A check that could not run in full, named rather than passed over in silence.

    `whole` is the difference between a check that asked half its questions and one that
    asked none: the first still reports `ok`, and the second must never, because `ok` for
    a check nobody ran is the shape of the bug this whole file just came out of.
    """

    check: str
    what: str
    why: str
    whole: bool = False

    def __str__(self) -> str:
        return f"{self.what} ({self.why})"


@dataclass(frozen=True)
class Report:
    """What every check found, and what none of them could ask here."""

    problems: dict[str, list[str]]
    skipped: tuple[Skip, ...]

    @property
    def total(self) -> int:
        return sum(len(found) for found in self.problems.values())

    @property
    def unrun(self) -> dict[str, Skip]:
        """The checks that asked nothing at all here, by name."""
        return {skip.check: skip for skip in self.skipped if skip.whole}


def skips() -> tuple[Skip, ...]:
    """Which halves of which checks this machine cannot ask, and why."""
    found = []
    if not figures.stores_available():
        found.append(
            Skip("figures", "every source key against the store its kind names", NO_CHECKOUT)
        )
        found.append(
            Skip(
                "library",
                "the palette record against the project's own library",
                NO_CHECKOUT,
                whole=True,
            )
        )
        found.append(
            Skip(
                "bake",
                "the explorer's generated modules against a rebake of them",
                NO_CHECKOUT,
                whole=True,
            )
        )
        found.append(
            Skip(
                "seats",
                "every seat panel against the picture its gallery ships",
                NO_CHECKOUT,
                whole=True,
            )
        )
    if not images.available():
        found.append(Skip("figures", "each figure's size on disk", NO_PILLOW))
        found.append(Skip("assets", "each image's and each thumbnail's size on disk", NO_PILLOW))
        if figures.stores_available():
            # Half, not whole: the reachability sweep below it reads records rather than
            # pixels, so a machine without Pillow still holds every cited seat to a run
            # record that answers for it.
            found.append(
                Skip("seats", "every seat panel against the picture its gallery ships", NO_PILLOW)
            )
    for gallery in galleries.staged():
        if staged_without_pictures(gallery):
            # Never `whole`: the publishable galleries beside it are checked in full, and
            # a check reporting `ok` here is still answering for them.
            found.append(
                Skip(
                    "assets",
                    f"the staged gallery {gallery.slug}'s {len(gallery.images)} picture(s) "
                    "and their thumbnails",
                    NO_STAGED_PICTURES,
                )
            )
    for partition in atlas_module.staged_without_pictures():
        # Half, the same way: the record, the plates and every tracked plane are still held.
        found.append(
            Skip(
                "atlas",
                f"the staged {partition.name} plane's {len(partition.dots) * 3} slot pictures",
                NO_STAGED_PICTURES,
            )
        )
    unaskable = agreement.pixels_unaskable()
    if unaskable is not None:
        # Half: the members half reads the record and the contract, which a clone has.
        found.append(
            Skip(
                "agreement",
                f"the explorer's render of {len(agreement.SAMPLE)} sampled atlas slot(s) "
                "against their thumbnails",
                unaskable,
            )
        )
    return tuple(found)


def run_all() -> Report:
    """Every check, named, so a failure says which one — and every skip, for the same reason."""
    loaded = galleries.load_all()
    article = sections.load_all()
    return Report(
        {
            "links": check_links(),
            "pages": check_pages(loaded, article),
            "contents": check_contents(article),
            "figures": check_figures(),
            "seats": check_seats(),
            "landing": check_landing(),
            "locations": check_locations(),
            "explorer": check_explorer(),
            "atlas": atlas_module.problems(),
            "agreement": agreement.problems(),
            "bake": check_bake(),
            # Every gallery here, staged or not: a staged record has no page, and its
            # files are held to it exactly as any other gallery's are once they are landed.
            "assets": check_assets(galleries.load_every()),
            "library": check_library(),
            "prose": check_prose(article),
            "guidance": check_guidance(),
            "theme": check_theme(),
            "vocabulary": vocabulary.sweep(),
            "dashes": dashes.sweep(),
            "endings": check_endings(),
        },
        skips(),
    )
