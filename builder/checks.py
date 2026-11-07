"""What `python -m builder check` checks.

Every check is read-only and runs on a bare clone. Three things a clone may lack are wanted
here: the wallpaper project's checkout (with its artifacts tree), Pillow, and a staged
gallery's pictures. Without one, a check reports a **named skip** (which check, which half,
and why), never a crash and never a silent pass.

- **links** — every internal href and src resolves to an existing file; none is
  root-absolute (the site lives under `/fractals/`) or a bare directory.
- **pages** — the committed HTML under `wallpaper-packs/` is byte-identical to what the
  builder produces from today's metadata.
- **figures** — every figure block on an article page matches its registry row, every row
  names the page that carries it, every made figure carries its provenance, and a maker a
  recipe names inside `builder` still exists. A `held` row is off its page on purpose and
  says why. Source keys resolve against their stores (a named skip without the checkout or
  its artifacts); sizes on disk are a named skip without Pillow.
- **seats** — every panel that is a gallery seat at its own recipe is that seat's own
  picture, to a tolerance, at the seat's regime, which catches a tone curve the gallery's
  picture has and the redraw lacks. Exemptions are on the record: a `gallery_seat` source
  says `recipe_changed` or `cited`. A whole skip without the checkout or its artifacts;
  without Pillow only the pixel half is skipped.
- **landing** — every made figure's page carries a block a redraw could land on.
- **locations** — no location stands under two figures unless the repetition is
  intentional (Matt): a `reuse_reason` on the row says why and names the figure it repeats,
  and a reason that excuses no collision fails. Frames compare as written (family, degree,
  constants, center, and width).
- **contents** — every hand-written page carries the derived contents rail, every prose
  heading the id its words give it, and the front page's contents list an `<h3>` entry per
  section in `sections.jsonl`.
- **bar** — every served page with a site bar carries the one `pages.topbar` spells; the
  explorer's studio bar is its own.
- **assets** — every image the metadata names exists at its claimed size, every thumbnail
  is current, and no gallery directory holds an orphan. A staged gallery is held the same
  once its pictures are here, bar the thumbnail. Sizes are a named skip without Pillow, a
  staged gallery's pictures one where they are not landed.
- **prose** — every row of `article/prose.jsonl` names a written page of the article. The
  masters are outside any clone; `python -m builder prose` holds the texts together.
- **library** — the palette record says what the wallpaper project's library says: the
  same maps, hues, and order. A whole skip without the checkout.
- **guidance** — `CLAUDE.md` names `writing-guidance.md`, the editorial authority.
- **atlas** — the atlas record is the shape the atlas frame reads: decimal-string viewport
  keys on every dot, each inside its partition's plane and its separation radius from its
  neighbors, and every thumbnail on disk at its row's size. A staged plane's slot pictures
  are a named skip where not landed. Links are parsed by `atlas/atlas.test.mjs`.
- **agreement** — every atlas slot's link opens the picture on its card: member for member
  against the thumbnail's recipe on every slot, and for one sampled slot a plane by drawing
  the link through the committed wasm, with a control that must fail. The pixel half is a
  named skip without the staged thumbnails, `palettes.bin`, or Pillow.
- **coloring** — `renders.wallpaper_coloring` matches the wallpaper project's
  `engine_spec.coloring_of` on every committed seat recipe, refusals included. A whole skip
  without the checkout or its artifacts.
- **theme** — the well colors drawn figures use are the stylesheet's own (transcribed, since
  Pillow cannot read CSS).
- **vocabulary** — no tracked file uses a word `vocabulary.py` bans.
- **dashes** — no em-dash in reader-facing words: section bodies, the front page, the
  gallery index, the page off Color palettes, and the registry's captions and alts.
  `dashes.py` says what it reads.
- **endings** — no tracked file is CRLF on disk, per `git ls-files --eol`, which must
  return rows.
- **icons** — every served page declares the site icon with exactly the links
  `builder.icons.head` spells, and the set is whole: the `.ico` holds 16, 32, and 48, each
  PNG is its size, the manifest is the builder's, and the recipe store holds its row.
- **heads** — every served page carries, between its `head-tags` markers, the
  `description` and `og:` tags `builder.heads` derives. `og:image` and `og:url` are
  absolute, the one exception to relative links. A page with both a prose paragraph and an
  authored description fails.
- **formulas** — every display formula is a formula block (TeX on the `<div>`, one inline
  SVG with a role, a spoken reading, `currentColor`, and no `<text>`), with no
  `<pre class="formula">` left. Matching a fresh MathJax typesetting byte for byte is a
  named skip without node and the pinned renderer.
- **explorer** — every figure and gallery tile is in the explorer link registry, as a link
  or a reason there is none, and each link matches its page; parsing is
  `permalink.test.mjs`'s. `palette-names.json` names only carried maps, no display name
  twice; `popular.json` lists 24 carried maps once each, `pinned` first, no `dropped`.
- **caps** — every panel linked from a gallery seat opens at that seat's `maxiter`: the
  link's `n`, or the width policy, asked through `emit.mjs`. Seats outside the site's
  recipe store are a named skip without the checkout; the whole check is one without node.
- **bake** — the explorer's two generated modules are byte for byte a rebake from
  `explorer/palettes.jsonl`, `explorer/modes.jsonl`, and the wallpaper project, and no
  figure uses a map the roster does not carry. A whole skip without the checkout.
- **stamps** — a full-size picture's metadata link is the contract's, whoever wrote it.
  Everywhere: `stamp.js`'s `EXPLORER_URL` is `pages.SITE_URL` plus `explorer/`. With the
  checkout, the release writer spells every general-collection seat as `emit.mjs` does and
  embeds PNG and JPEG bytes as `stamp.js` does; a named skip without the checkout or its
  artifacts. About half a minute.
- **go** — every short link in `go/redirects.jsonl` targets a link the explorer's reader
  accepts (asked by `go.mjs`), and every page under `go/` is what the register writes.
- **packs** — the Wallpaper packs record answers the page: one row per `[PACK]` marker,
  counts matching collection sizes, five on-disk Gallery seats each, a color or general
  pack's five its collection's opening, and the deep row held to
  `builder/data/deep-pack.jsonl`. Matching what `packs --import` would write today is a
  named skip without the checkout and the full set.
- **readmes** — every explorer link in the root `README.md` parses under `permalink.js` in
  canonical spelling. With the checkout, the same of fractal-wallpapers' README, and each
  `examples/README.md` strip seat is held to its recipe's link; a named skip without the
  checkout or its artifacts.
- **repeats** — every stored explorer link (records, served pages, the root README) names
  each key once; fractal-wallpapers' README too, a named skip without the checkout.
- **deep** — the Deep tab's gallery (`explorer/deep-gallery.jsonl`) and Random dives
  (`explorer/random-dives.jsonl`): every row a deep link, none twice, exactly one tracked
  tile per row named by its FNV-1a, each 316×178 (a named skip without Pillow). Random dives
  holds no place twice.
"""

import json
import re
import shutil
import subprocess
from dataclasses import dataclass
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import parse_qs, unquote, urldefrag

from . import (
    agreement,
    coloring,
    dashes,
    deep_gallery,
    explorer,
    figures,
    formulas,
    galleries,
    go,
    heads,
    icons,
    images,
    links,
    packs,
    pages,
    palettes,
    picker,
    picks,
    prose,
    random_dives,
    readmes,
    recipes,
    records,
    renders,
    repeats,
    seats,
    sections,
    stamps,
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
    hosted_pages,
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
    for page in [*site_pages(), *hosted_pages()]:
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
        return f"root-absolute {attribute}={raw!r} — breaks under the /fractals/ subpath"
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
    # Read once: every call walks every gallery record and the figure registry.
    on_site = links.picture_ids()
    for identifier in on_site:
        if identifier not in registered:
            problems.append(
                f"links.jsonl: {identifier} is on the site and not in the registry — "
                "`python -m builder links --write`"
            )
    on_site = set(on_site)
    for identifier in registered:
        if identifier not in on_site:
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
    if figures.artifacts_available():
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
    if not figures.artifacts_available():
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
    """The front page's contents list has an entry for every section.

    The rail is generated; this list is typed, because it sits inside prose the builder
    does not touch, so a section added to `sections.jsonl` and not to the list is a failing
    check rather than something a reader notices. An entry is one `<h3>` on one line — the
    same shape the contents list has always had, and what makes it findable without parsing
    the page. It used to carry a mark for a written section, as the rail did; both went
    when every section was written *(front_and_start_ckpt147)*.
    """
    problems = []
    lines = _read(SITE_INDEX).splitlines()
    for section in article:
        href = f'href="article/{section.page}"'
        if not any("<h3>" in line and href in line for line in lines):
            problems.append(f"index.html: no one-line <h3> entry in the contents links {href}")
    return problems


def staged_without_pictures(gallery: galleries.Gallery) -> bool:
    """Whether a staged gallery's directory holds none of the pictures its record names.

    A staged gallery's pictures stay out of history until a deploy, and what commits is
    the record (the one gallery here has been committed whole since
    deploy_staged_assets_ckpt152). So on a clone, and on any machine where
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

    **Absent is a problem and not a skip.** The blob is committed beside its index
    *(deploy_staged_assets_ckpt152)*, so a tree without it has lost a file, and on a machine
    with the wallpapers checkout it is one command away. A page whose index addresses a file
    that is not there draws nothing, and saying so here is cheaper than finding out in a
    browser.
    """
    where = _shown(explorer.PALETTES_BLOB)
    if not explorer.PALETTES_BLOB.is_file():
        return [
            f"{where}: the index in {_shown(explorer.PALETTES_MODULE)} addresses it and it is "
            "not here. It is committed, and `python -m builder explorer --palettes-only` writes "
            "it again."
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


def check_coloring() -> list[str]:
    """The site's copy of the wallpaper coloring against the original, on every seat.

    `builder/coloring.py` says what it asks and why. Nothing here without the checkout, and
    a configured one that cannot answer is reported rather than raised, as `library` does.
    """
    if not figures.artifacts_available():
        return []
    try:
        return coloring.problems()
    except (renders.EngineError, picks.PickError, seats.SeatError, OSError) as error:
        return [f"the seats' colorings could not be asked about — {error}"]


#: The working-tree endings that are drift. `git ls-files --eol` writes each tracked file
#: as `i/<eol> w/<eol> attr/<attrs>`, a tab, then the path; `i/` is what the index holds
#: and `w/` is what is on disk. A binary file reads `-text` on both sides and is never a
#: hit here, and neither is a file the index holds with the same endings it has on disk:
#: the hosted walkthrough is `-text` so that a bundle's CRLF commits byte for byte, and a
#: CRLF file that commits as CRLF has not drifted from anything.
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


#: Where a seat panel's link came from, as `links.jsonl`'s `from` spells it.
_SEAT_FROM = "seat "


def _seat_panel_links() -> dict[str, tuple[str, str]]:
    """Every figure panel linked from a seat: `{picture id: (link, seat)}`."""
    return {
        identifier: (link.link, link.source[len(_SEAT_FROM) :])
        for identifier, link in links.load_all().items()
        if identifier.startswith("figure:")
        and link.link is not None
        and (link.source or "").startswith(_SEAT_FROM)
    }


def caps_unaskable() -> tuple[str, int] | None:
    """Why some seat panels cannot be held to their caps here, and how many, or `None`."""
    if shutil.which("node") is None:
        return "node is not on PATH here", len(_seat_panel_links())
    if figures.stores_available():
        return None
    stored = recipes.load_all()
    unstored = [seat for _, seat in _seat_panel_links().values() if seat not in stored]
    return (NO_CHECKOUT, len(unstored)) if unstored else None


def check_caps() -> list[str]:
    """Every seat panel's link opens at the cap its seat was drawn at.

    A seat panel's link is the seat's ledger recipe whole (`links.ledger_view`), and the
    cap is part of the recipe: since permalink v4 a link spells it as `n` wherever the
    width's depth policy gives another, and an absent `n` means the policy. Until
    release_polish_ckpt157 `ledger_view` dropped the cap, so every seat panel opened at the
    policy whatever it was drawn at, and four of them were drawn elsewhere — with every
    other check green, because nothing compared a panel link's cap with its seat's.

    What a link opens at is read off the link: its own `n` where it carries one, and
    otherwise the policy at its width, asked of the contract by emitting the same recipe
    with no cap (`emit.mjs` answers the cap a link is drawn at, never a second reading of
    the policy here). Seats the site's recipe store holds are asked on any clone; one only
    the ledger next door answers is a named skip where the checkout is not configured.
    """
    if shutil.which("node") is None:
        return []
    wanted = _seat_panel_links()
    if not figures.stores_available():
        stored = recipes.load_all()
        wanted = {key: value for key, value in wanted.items() if value[1] in stored}
    if not wanted:
        return []
    seats_named = sorted({seat for _, seat in wanted.values()})
    try:
        resolved = dict(zip(seats_named, picks.resolve(seats_named), strict=True))
    except picks.PickError as error:
        return [f"caps: no seat panel could be held to its cap — {error}"]

    problems = []
    uncapped = {}
    for identifier, (_, seat) in wanted.items():
        recipe = resolved[seat].recipe
        if recipe.get("maxiter") is None:
            problems.append(f"links.jsonl: {identifier}'s seat {seat} records no cap")
            continue
        view = links.ledger_view(recipe)
        view["cap"] = None
        uncapped[identifier] = view
    policies = links.emit(uncapped)
    for identifier in uncapped:
        link, seat = wanted[identifier]
        drawn = int(resolved[seat].recipe["maxiter"])
        policy = policies[identifier]
        if not policy.get("ok"):
            problems.append(f"links.jsonl: {identifier}: {policy['why']}")
            continue
        spelled = parse_qs(link).get("n")
        opens = int(spelled[0]) if spelled else int(policy["maxiter"])
        if opens != drawn:
            how = f"its n={opens:,}" if spelled else f"the width policy's {opens:,}"
            problems.append(
                f"links.jsonl: {identifier} opens at {how}, and seat {seat} was drawn at "
                f"cap {drawn:,} — `python -m builder links --write`"
            )
    return problems


def check_deep() -> list[str]:
    """The Deep tab's gallery and Random dives, each held to its tiles (see the docstring)."""
    problems = []
    can_measure = images.available()
    tracked = set(
        subprocess.run(
            ["git", "ls-files", "--", "explorer/deep-gallery", "explorer/random-dives"],
            cwd=SITE_ROOT,
            capture_output=True,
            text=True,
            check=False,
        ).stdout.splitlines()
    )
    size = (deep_gallery.THUMB["width"], deep_gallery.THUMB["height"])
    for record, tiles in (
        (deep_gallery.REGISTER, deep_gallery.THUMBS),
        (random_dives.RECORD, random_dives.TILES),
    ):
        shown = _shown(record)
        if not record.exists():
            problems.append(f"{shown}: missing")
            continue
        links: list[str] = []
        for number, line in enumerate(record.read_text(encoding="utf-8").splitlines(), 1):
            if not line.strip():
                continue
            link = str(json.loads(line).get("link", ""))
            if not link.startswith("dv="):
                problems.append(f"{shown} line {number}: not a deep link")
                continue
            links.append(link)
        seen: set[str] = set()
        for link in links:
            if link in seen:
                problems.append(f"{shown}: {link[:60]}… recorded twice")
            seen.add(link)
        if record == random_dives.RECORD:
            places: dict[tuple[str, str, str], str] = {}
            for link in links:
                place = random_dives.frame_key(link)
                if place in places and places[place] != link:
                    problems.append(f"{shown}: {place[0]} at {place[1]}, {place[2]} twice")
                places[place] = link
        named = {f"{deep_gallery.fnv(link)}.webp" for link in links}
        on_disk = {path.name for path in tiles.iterdir()} if tiles.is_dir() else set()
        for name in sorted(named - on_disk):
            problems.append(f"{_shown(tiles / name)}: missing, and its row is in {shown}")
        for name in sorted(on_disk - named):
            problems.append(f"{_shown(tiles / name)}: no row in {shown} names it")
        for name in sorted(named & on_disk):
            path = tiles / name
            relative = path.relative_to(SITE_ROOT).as_posix()
            if relative not in tracked:
                problems.append(f"{relative}: not tracked, so Pages would not serve it")
            if can_measure and images.dimensions(path) != size:
                actual = images.dimensions(path)
                problems.append(f"{relative}: {actual[0]}x{actual[1]}, not {size[0]}x{size[1]}")
    return problems


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
        words = flags.split()
        drifted = sorted(DRIFTED_ENDINGS.intersection(words))
        if drifted and f"i/{drifted[0][2:]}" not in words:
            problems.append(
                f"{path}: {drifted[0]} on disk, and nothing else will ever say so — "
                "the index holds it as LF and the diff is empty"
            )
    return problems


#: Why a skip happened, spelled once. Both are states of the machine rather than of the
#: site, which is exactly why neither may fail a check and neither may pass one silently.
NO_CHECKOUT = "the fractal-wallpapers checkout is not configured here"
NO_PILLOW = "Pillow is not installed here"

#: A configured checkout whose generated tree is not here — a fresh clone of the wallpaper
#: project has no candidate ledger. Also a state of the machine and not of the site, so a
#: skip and never 170 problems naming keys a clone was never going to hold.
NO_ARTIFACTS = "the fractal-wallpapers checkout has no artifacts tree here (no candidate ledger)"

#: The third state of the machine that stops a check asking its question. A staged
#: gallery's pictures stay out of history until a deploy, so a clone has the record and
#: none of the files it names — which is not the site being wrong, and must not read as the check
#: having passed either.
NO_STAGED_PICTURES = "its pictures are staged and have not been landed on this machine"


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
        found.append(
            Skip(
                "coloring",
                "the site's wallpaper coloring against coloring_of on every seat",
                NO_CHECKOUT,
                whole=True,
            )
        )
        # Half: the base half reads two files of this repository.
        found.append(
            Skip(
                "stamps",
                "the release writer's links and bytes against the explorer's own",
                NO_CHECKOUT,
            )
        )
        # Half: this repository's README is parsed everywhere.
        found.append(
            Skip(
                "readmes",
                "fractal-wallpapers' README, and every strip seat's link against its recipe",
                NO_CHECKOUT,
            )
        )
        # Half: every record and page of this repository is read everywhere.
        found.append(Skip("repeats", "the links in fractal-wallpapers' README", NO_CHECKOUT))
    elif not figures.artifacts_available():
        # Configured, with nothing generated beside it: the checks that read the tree are
        # the ones that cannot ask. `library`, `bake` and `repeats` read tracked files.
        found.append(
            Skip("figures", "every source key against the store its kind names", NO_ARTIFACTS)
        )
        found.append(
            Skip(
                "seats",
                "every seat panel against the picture its gallery ships",
                NO_ARTIFACTS,
                whole=True,
            )
        )
        found.append(
            Skip(
                "coloring",
                "the site's wallpaper coloring against coloring_of on every seat",
                NO_ARTIFACTS,
                whole=True,
            )
        )
        found.append(
            Skip(
                "stamps",
                "the release writer's links and bytes against the explorer's own",
                NO_ARTIFACTS,
            )
        )
        found.append(Skip("readmes", "every strip seat's link against its recipe", NO_ARTIFACTS))
    if not images.available():
        found.append(Skip("figures", "each figure's size on disk", NO_PILLOW))
        found.append(Skip("assets", "each image's and each thumbnail's size on disk", NO_PILLOW))
        found.append(Skip("deep", "each Deep gallery and Random dives tile's size", NO_PILLOW))
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
    unpacked = packs.unaskable()
    if unpacked is not None:
        # Half: the record against the prose and the Gallery tab's record reads this
        # repository alone.
        found.append(
            Skip("packs", "the packs record against what next door answers today", unpacked)
        )
    uncapped = caps_unaskable()
    if uncapped is not None:
        # Half where only the checkout is missing: every seat the site's recipe store holds
        # is still asked. Whole without node, which every one of them is asked through.
        why, count = uncapped
        found.append(
            Skip(
                "caps",
                f"{count} seat panel link(s) against their seats' caps",
                why,
                whole=shutil.which("node") is None,
            )
        )
    untypeset = formulas.unaskable()
    if untypeset is not None:
        # Half: the shape half reads the pages, which a clone has.
        found.append(Skip("formulas", "every formula's SVG against a fresh typesetting", untypeset))
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
            "bar": pages.topbar_problems(sections.hand_written(article)),
            "figures": check_figures(),
            "seats": check_seats(),
            "landing": check_landing(),
            "locations": check_locations(),
            "explorer": check_explorer(),
            "caps": check_caps(),
            "atlas": atlas_module.problems(),
            "agreement": agreement.problems(),
            "bake": check_bake(),
            "stamps": stamps.problems(with_checkout=figures.artifacts_available()),
            "coloring": check_coloring(),
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
            "icons": icons.problems(),
            "heads": heads.problems(),
            "formulas": formulas.problems(with_renderer=formulas.unaskable() is None),
            "go": go.problems(),
            "packs": packs.problems(with_checkout=figures.stores_available()),
            "readmes": readmes.problems(
                with_checkout=figures.stores_available(),
                with_artifacts=figures.artifacts_available(),
            ),
            "repeats": repeats.problems(with_checkout=figures.stores_available()),
            "deep": check_deep(),
        },
        skips(),
    )
