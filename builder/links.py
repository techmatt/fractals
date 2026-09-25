"""Every picture on this site that the explorer can reopen, and every one it cannot.

A reader who has just looked at a figure has exactly one question the article cannot
answer: *what happens if I move it?* The explorer answers that, and a permalink is what
carries a picture into it — the same family, constants, mode, frame and palette the
figure was drawn at, in a URL. `explorer/links.jsonl` is the tracked answer, one row per
figure and per gallery tile, and it is either a link or a reason there is none.

## Where a spec comes from

**Nothing here is typed.** A figure's registry row already carries the `provenance` its
picture can be drawn again from, one line per panel, and several of those lines cite a
wallpapers-side record by its own address: a release record's key, a finished-render
store's file and line. Those are read as records, whole. What is left is prose, and it is
read by a scanner that takes only the fields it can name.

A sheet is many pictures and a link is one, so the rule is stated rather than guessed at:

- **The representative is the first panel that names a frame** — by citing a record, or
  by spelling a centre and a width. It is the sheet's opening picture, and the rest of
  the sheet is what the explorer's own controls do: a degree row is the family picker, a
  mode grid is the mode picker, a zoom strip is the scroll wheel.
- **Everything before it is the sheet's preamble**, and a preamble that says "every panel
  is mode smooth in twilight_shifted" is where the representative's coloring comes from.
  Later lines win over earlier ones, and the representative wins over all of them.

## What is refused, and why refusing is the point

A link that is *nearly* the figure is worse than no link: the reader lands on a picture
that does not match what they were just looking at and has no way to know which half is
wrong. So a spec that cannot be said exactly is not approximated — the row says
`no_link` and which of the four reasons it is. `REASONS` spells them.

## Who writes the link

**This module never spells a permalink.** It derives a view — family, constants, mode,
parameters, frame, palette, shade recipe — and hands the list to `emit.mjs`, which
imports `explorer/permalink.js` and asks the contract itself. The same module reads the
canonical string back and refuses if parse-then-emit is not a fixed point. A second
opinion about what a link means is exactly what a URL contract cannot survive, and one
written in Python beside one written in JavaScript is two.
"""

from __future__ import annotations

import json
import re
import subprocess
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import parse_qs

from . import figures, galleries, records
from .paths import SITE_ROOT, relative_href

#: The tracked registry. One row per picture, in figure order and then gallery order.
LINK_REGISTRY = SITE_ROOT / "explorer" / "links.jsonl"

#: The node helper that owns the permalink contract on this side of the boundary.
EMITTER = Path(__file__).resolve().parent / "emit.mjs"

#: `.gitattributes` normalizes this repository to LF, so anything that rewrites a
#: tracked file spells the line ending rather than taking the platform's.
LF = "\n"

#: The explorer page every link points at.
EXPLORER_PAGE = SITE_ROOT / "explorer" / "index.html"

#: The word a provenance line puts in front of a colormap's name.
COLORMAP_WORD = "colormap "

#: Why a picture has no link. A closed list: a reason outside it is a bug in this module
#: rather than a new kind of refusal, and `check` holds the registry to it.
REASONS = {
    "drawn": "a drawn diagram or chart, with no engine render behind it to reopen",
    "deep": "the frame is past the wall f64 coordinates stop resolving, and the explorer "
    "refuses it in the engine's own words rather than drawing the arithmetic",
    "incomplete_provenance": "the record does not carry everything a link needs, and a "
    "link is not guessed at",
    "not_exposed": "the picture depends on something this page does not offer by ruling "
    "— a render-only family, a niche mode, a curve a mode does not carry, a fold a cyclic "
    "map refuses",
}

# ------------------------------------------------------------------------- the registry


@dataclass(frozen=True)
class Link:
    """One picture, and either the view it reopens at or why it does not."""

    id: str
    link: str | None
    reason: str | None
    why: str | None
    source: str | None

    @property
    def linked(self) -> bool:
        return self.link is not None

    def href(self, page: Path) -> str:
        """The href a page carries, relative to the page that carries it.

        Relative and never rooted: this site is served from a project-Pages subpath, so
        a `/explorer/…` href works locally and breaks in production.
        """
        return f"{relative_href(page, EXPLORER_PAGE)}?{self.link}"

    def row(self) -> dict:
        row = {"schema": records.SCHEMA, "kind": "link", "id": self.id}
        if self.link is not None:
            row["link"] = self.link
            row["from"] = self.source
        else:
            row["no_link"] = self.reason
            row["why"] = self.why
        return row


def load_all() -> dict[str, Link]:
    """The link registry, keyed by picture id."""
    if not LINK_REGISTRY.is_file():
        return {}
    registry: dict[str, Link] = {}
    for row in records.read(LINK_REGISTRY):
        row.expect_kind("link")
        identifier = row.text("id")
        if identifier in registry:
            raise records.RecordError(f"{row.where}: {identifier!r} is registered twice")
        link = row.optional_text("link")
        reason = row.optional_text("no_link")
        if (link is None) == (reason is None):
            raise records.RecordError(
                f"{row.where}: a row is either a link or a no_link with its reason"
            )
        if reason is not None and reason not in REASONS:
            raise records.RecordError(
                f"{row.where}: no_link {reason!r} — the reasons are {', '.join(sorted(REASONS))}"
            )
        registry[identifier] = Link(
            id=identifier,
            link=link,
            reason=reason,
            why=row.optional_text("why"),
            source=row.optional_text("from"),
        )
    return registry


def write(found: list[Link]) -> Path:
    """Write the registry, one row a line, in the order the pictures appear."""
    body = LF.join(json.dumps(link.row(), ensure_ascii=False) for link in found)
    LINK_REGISTRY.write_text(body + LF, encoding="utf-8", newline=LF)
    return LINK_REGISTRY


def opened(page: Path) -> dict[str, str]:
    """Every picture's explorer href on one page, keyed the way the registry keys it.

    A picture with no link is simply absent, which is what a caller wants: the block it
    derives carries no link at all rather than a dead one.

    The way to the explorer is one href per page, so it is worked out once here rather than
    by `Link.href` per row: that resolves two paths on disk each time, and `check` asks for
    every figure's page.
    """
    explorer = relative_href(page, EXPLORER_PAGE)
    return {
        identifier: f"{explorer}?{link.link}"
        for identifier, link in load_all().items()
        if link.link is not None
    }


def picture_ids() -> list[str]:
    """Every picture that has to be registered, in registry order.

    Figures first, in the order the registry holds them; then each gallery's tiles in
    the order the gallery shows them. A pending figure is in the list — it is a picture
    the site has planned, and a row saying so is what stops it being forgotten. A **held**
    figure is not: it is registered and deliberately not on a page, so there is no picture
    for a link to sit in the corner of and nothing for a reader to open.

    **A split figure is its panels and not itself.** Six pictures a reader can open one
    at a time are six rows here; a row for the figure as a whole would be a link nothing
    on the page could carry.

    **A live figure is not a picture at all.** It is a piece running in the page, and
    every mark in it builds its own link through the piece's own code — the atlas's
    `atlas/links.js` — so a row here would be a second author of links that already have
    one.
    """
    found = []
    for identifier, figure in figures.load_all().items():
        if not figure.on_page or figure.live is not None:
            continue
        if figure.split:
            found.extend(
                figures.panel_id(identifier, index) for index in range(1, len(figure.panels) + 1)
            )
        else:
            found.append(f"figure:{identifier}")
    for gallery in galleries.load_all():
        found.extend(f"gallery:{gallery.slug}/{image.file}" for image in gallery.images)
    return found


# ----------------------------------------------------------------------- the derivation


def derive() -> list[Link]:
    """Work out every picture's link, or the reason it has none.

    Needs the wallpaper project beside this checkout — the records the provenance cites
    live there — and `node`, which is what runs the permalink contract.
    """
    wanted: list[Link] = []
    views: dict[str, dict] = {}
    palettes = baked_palettes()
    roster = sorted(palettes, key=len, reverse=True)
    curves = catalog_curves()

    for identifier, figure in figures.load_all().items():
        key = f"figure:{identifier}"
        if not figure.on_page or figure.live is not None:
            continue
        if figure.pending:
            wanted.append(_refused(key, "incomplete_provenance", "the picture is not made yet"))
            continue
        if figure.split:
            wanted.extend(_panel_links(figure, views, palettes, curves))
            continue
        found = _figure_view(figure, roster, palettes, curves)
        if isinstance(found, Link):
            wanted.append(found)
        else:
            view, source = found
            views[key] = view
            wanted.append(Link(key, None, None, None, source))

    # `load_all` is the publishable galleries. A **staged** gallery is on no page, so
    # there is no picture for a link to sit in the corner of and nothing for a reader to
    # open from here; its rows carry their own links, derived at the same contract, in
    # its own record.
    for gallery in galleries.load_all():
        for image in gallery.images:
            key = f"gallery:{gallery.slug}/{image.file}"
            wanted.append(
                _refused(
                    key,
                    "incomplete_provenance",
                    "a gallery tile carries no provenance of its own, and this gallery's "
                    "pictures were cropped from a contact sheet whose generator is gone: "
                    "no mode is written down anywhere for them",
                )
            )

    emitted = emit(views)
    return [
        link if link.link is not None or link.reason is not None else _settled(link, emitted)
        for link in wanted
    ]


def _settled(link: Link, emitted: dict[str, dict]) -> Link:
    """A derived view, once the contract has had its say about it."""
    answer = emitted[link.id]
    if not answer.get("ok"):
        return _refused(link.id, "not_exposed", answer["why"], link.source)
    return Link(link.id, answer["link"], None, None, link.source)


def _refused(identifier: str, reason: str, why: str, source: str | None = None) -> Link:
    return Link(identifier, None, reason, why, source)


# --------------------------------------------------------------- a split figure's panels

#: What a split figure's row has to say before a panel of it can be linked at all.
PANEL_RECORD = (
    "a panel says which record it is — a gallery seat the row claims was drawn at its "
    "own recipe, or the engine spec its maker drew it with — and this one says neither"
)


def _panel_links(
    figure: figures.Figure,
    views: dict[str, dict],
    palettes: dict[str, bool],
    curves: dict[str, str],
) -> list[Link]:
    """One link per panel of a split figure, each derived from the record that panel is.

    **Not from the prose, and that is the whole of the design.** A composited sheet is one
    link at its representative panel, and the convention that pays for it — exactly one
    line of a row puts the word `colormap` in front of a map's name, and every other line
    says `palette` — means the remaining panels' maps are written in a way nothing here
    reads. Scanning a sheet panel by panel does not fail: it quietly carries the
    representative's map onto every panel after it, which is a link that opens the right
    place in the wrong colour. Measured on the first figure to be split, and it is the
    reason a panel is linked from a record rather than from a sentence about it.

    A panel says which record it is, and there are two kinds. **A seat** —
    `<stamp>|<recipe key>` — is linked from that seat's ledger recipe whole, the way a
    staged gallery's tiles are, and carries the tone curve the run that drew it recorded.
    **A spec** is the engine render spec the maker drew with: most of this article's
    sheets are not seats at all, their panels being renders at frames frozen into the
    maker, in a neutral map, at a mode the figure is *about*, and nothing next door is a
    record of them. A spec goes down the same `_view` a citation of the wallpapers side
    does, so the same refusals apply — a fractional degree, a mode the explorer does not
    offer, a curve the catalog does not give that mode, a map the picker does not carry,
    a fold on a cyclic map, a frame past what `f64` resolves, and a cap the depth policy
    would not choose are each a labelled panel with no link rather than a link to
    something else.

    **Per panel and not per row**, because the sheets that need this most are mixed: a
    family's parameter plane is a render this repository asked for and the two Julia sets
    beside it are gallery seats, and a rule that made a row choose one kind would leave
    one of those two unlinkable. A seat is only linked where the row *claims* the seat's
    own recipe drew it — `sources` says `own_recipe`, which `check`'s `seats` holds to
    the gallery's own pixels — and a maker that changed the recipe to make its point says
    so by handing back what it actually drew instead.
    """
    from . import picks

    identifiers = [figures.panel_id(figure.id, index) for index in range(1, len(figure.panels) + 1)]
    claimed = _claimed_seats(figure)
    wanted = sorted({panel.seat for panel in figure.panels if panel.seat and panel.seat in claimed})
    try:
        resolved = dict(zip(wanted, picks.resolve(wanted), strict=True)) if wanted else {}
    except picks.PickError as error:
        return [
            _refused(identifier, "incomplete_provenance", f"the seat does not resolve: {error}")
            for identifier in identifiers
        ]

    found = []
    held = _deep_recipes() if any(panel.deep for panel in figure.panels) else {}
    for identifier, panel in zip(identifiers, figure.panels, strict=True):
        if panel.deep:
            # **A deep panel's link is its recipe, and is read rather than derived**
            # (deep_figures_ckpt145). The maker drew the picture from exactly this string,
            # which the Deep contract canonicalized, so there is no second opinion to form;
            # `deep-link.test.mjs` holds every such row to that contract.
            recipe = held.get(panel.deep)
            if recipe is None:
                found.append(
                    _refused(
                        identifier,
                        "incomplete_provenance",
                        f"figure-recipes.jsonl holds no {panel.deep}",
                    )
                )
                continue
            # **A Leveled deep picture has no link that reopens it** (deep_opening_palette_
            # ckpt150). The contract spells Leveled by saying no `scale`, and the page fits a
            # deep link that says none to Absolute on arrival (`fitUnlessStated`), so the
            # link would open a picture the panel is not.
            if "scale" not in parse_qs(recipe["link"]):
                found.append(
                    _refused(
                        identifier,
                        "not_exposed",
                        "the picture is Leveled, and the explorer fits a deep link that "
                        "names no scale to Absolute on arrival",
                    )
                )
                continue
            found.append(Link(identifier, recipe["link"], None, None, f"deep {panel.deep}"))
            continue
        if panel.seat:
            if panel.seat not in resolved:
                found.append(_refused(identifier, "incomplete_provenance", PANEL_RECORD))
                continue
            pick = resolved[panel.seat]
            level, why = _panel_level(pick, picks)
            if why is not None:
                found.append(_refused(identifier, "incomplete_provenance", why, pick.identifier))
                continue
            views[identifier] = ledger_view(pick.recipe, level=level)
            found.append(Link(identifier, None, None, None, f"seat {pick.identifier}"))
            continue
        if panel.spec is None:
            found.append(_refused(identifier, "incomplete_provenance", PANEL_RECORD))
            continue
        answer = _view(identifier, {}, spec_record(panel.spec), "spec", palettes, curves)
        if isinstance(answer, Link):
            found.append(answer)
            continue
        view, source = answer
        if panel.spec.get("level") is not None:
            view["level"] = panel.spec["level"]
        views[identifier] = view
        found.append(Link(identifier, None, None, None, source))
    return found


def _deep_recipes() -> dict[str, dict]:
    """Every deep panel's recipe in the site's store, by the key a panel names it with."""
    from . import recipes

    return {
        identifier: one.recipe
        for identifier, one in recipes.load_all().items()
        if one.kind == recipes.DEEP
    }


def _claimed_seats(figure: figures.Figure) -> set[str]:
    """The seats this row says were drawn at their own recipe, and so may be linked.

    A pool candidate a panel names as `candidate|<key>` is claimed by its `candidate`
    source. That kind carries no `drawn`, because a candidate has only the one recipe to be
    drawn at: `gallery-top-scored` is the figure whose panels are candidates rather than seats.
    """
    from . import picks

    return {
        key
        for source in figure.sources
        if source.kind == figures.GALLERY_SEAT and source.drawn == figures.OWN_RECIPE
        for key in source.keys
    } | {
        f"{picks.CANDIDATE_STAMP}{picks.PICK_SEPARATOR}{key}"
        for source in figure.sources
        if source.kind == figures.CANDIDATE
        for key in source.keys
    }


def panel_level(pick) -> tuple[dict | None, str | None]:
    """The tone curve one seat's link carries, for a maker writing a panel's record."""
    from . import picks

    return _panel_level(pick, picks)


def spec_record(spec: dict) -> dict:
    """An engine render spec in the shape `_view` reads a cited record in.

    The two are nearly the same thing already — the engine's own spec is what a finished
    render row keeps — so this is a rename and two defaults rather than a translation.
    The map defaults to the neutral one every un-coloured sheet on this site is drawn in,
    because a maker that names none drew in it.
    """
    from . import renders

    return {
        "family": spec["family"],
        "viewport": spec["viewport"],
        "mode": spec.get("mode", "smooth"),
        "mode_params": spec.get("mode_params") or {},
        "curve": spec.get("curve", "linear"),
        "colormap": spec.get("colormap", renders.COLORMAP),
        "recipe": spec.get("palette") or {},
        "cap": spec.get("maxiter"),
    }


def _panel_level(pick, picks) -> tuple[dict | None, str | None]:
    """The tone curve one panel's link carries, or why the panel cannot carry a link.

    The operator measures a picture's tone and, where it sits outside the band, draws it
    again through a curve pushed into the map's stops. A link that says nothing about tone
    draws the render underneath, which for a seat the operator acted on is a visibly
    different picture — so the curve is carried or the panel is refused, never dropped.

    A second reading of the stamp `builder/seats.py` reads for a gallery tile. The shapes
    agree because both read `band_autolevel/v1`'s own record; what differs is the way in,
    which is one run record a panel here against a batch of a thousand there.
    """
    levelling = picks.run_stamp(pick)
    if levelling.way == picks.UNTOUCHED:
        return None, None
    stamp = levelling.stamp or {}
    curve = stamp.get("curve") or {}
    if levelling.way != picks.REPLAYED or not curve.get("applies") or curve.get("identity"):
        return None, (
            f"the tone operator acted on this seat and {levelling.where} did not record "
            "the curve it acted with, so no link draws the picture the panel shows"
        )
    return {
        "operator": str(stamp["operator"]),
        "black_pt": float(curve["black_pt"]),
        "white_pt": float(curve["white_pt"]),
        "exponent": float(curve["exponent"]),
        "out_ends": [float(curve["out_ends"][0]), float(curve["out_ends"][1])],
    }, None


def emit(views: dict[str, dict]) -> dict[str, dict]:
    """Ask `permalink.js` for the canonical string of each view, through node.

    The helper also parses what it emitted and emits that again, so a link only reaches
    the registry once the contract has agreed it is a fixed point.
    """
    if not views:
        return {}
    # A view's `cap` goes over as it stands: since permalink v4 it is a key, and the
    # contract writes `n` only where it is not what the width already gives.
    finished = subprocess.run(
        ["node", str(EMITTER)],
        input=json.dumps(views),
        capture_output=True,
        text=True,
        encoding="utf-8",
        cwd=str(SITE_ROOT),
    )
    if finished.returncode != 0:
        raise LinkError(f"emit.mjs failed:\n{finished.stderr.strip()}")
    return json.loads(finished.stdout)


class LinkError(RuntimeError):
    """A link cannot be derived, and guessing would be worse than stopping."""


# ------------------------------------------------------------------- reading provenance

NUMBER = r"[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?"

#: How a curation release record is cited: its own key, `<run>|release|<candidate>`,
#: wherever a provenance line spells it. The words in front of it used to be part of the
#: pattern and the candidate had to be digits, which meant a row a *gallery pass* seated
#: — whose id carries the run that made it, `gallery1_0441` — could not be cited at all.
#: The key is distinctive enough to stand on its own: no sentence holds two pipes and the
#: word `release` between them by accident.
RELEASED = re.compile(r"\b([A-Za-z0-9_]+)\|release\|([A-Za-z0-9_]+)\b")

#: How a finished-render store row is cited: the head, the batch file, and the line.
FINISHED = re.compile(r"\b(smooth_render|strange_render)/([A-Za-z0-9_]+)\.jsonl line (\d+)")

FIELD = {
    "centre": re.compile(rf"centre ({NUMBER}) \+ ({NUMBER})i"),
    # The other form a frame is recorded in, where a rung of a walk is written out as
    # the place and then the scale: `-0.0645 + 0.6645i at width 0.00040`.
    "at": re.compile(rf"(?<![\w.])({NUMBER}) \+ ({NUMBER})i at width ({NUMBER})"),
    "width": re.compile(rf"width ({NUMBER})"),
    "c": re.compile(rf"(?<![A-Za-z_])c = ({NUMBER}) \+ ({NUMBER})i"),
    "p": re.compile(rf"(?<![A-Za-z_])p = ({NUMBER}) \+ ({NUMBER})i"),
    "z_prev": re.compile(rf"z_prev = ({NUMBER}) \+ ({NUMBER})i"),
    "degree": re.compile(r"\b(?:degree|d =) (\d+)"),
    "mode": re.compile(r"\bmode ([a-z_]+)(?: (\{[^}]*\}))?"),
    "coloring": re.compile(r"\bcoloring the .*written out in full"),
    "curve": re.compile(r"\bcurve ([a-z]+)"),
    "mirror": re.compile(r"\bmirror (true|false|True|False)"),
    # A cap the record pinned. `maxiter auto` is the depth policy answering and does not
    # match, which is right: the policy is what a link gets. A cap is a whole number of
    # iterations, so the fraction is refused too — `interior cap 0.3` is a gate's
    # threshold and became a cap of nought under a rule that read the digits alone.
    "cap": re.compile(r"\b(?:maxiter|cap) (\d+)(?![\d.])"),
    "reading": re.compile(r"Panels in reading order: ([a-z_]+)"),
    "recipe": re.compile(r"palette (\{[^}]*\})"),
}

#: Which permalink family a provenance line's own word names. Ordered: a line that says
#: `fractional_multibrot` also says `multibrot`, and the longer name is the true one.
FAMILY_WORDS = (
    ("fractional_multibrot", "fractional_multibrot"),
    ("multibrot", "multibrot"),
    ("mandelbrot", "mandelbrot"),
    ("julia", "julia"),
    ("phoenix", "phoenix"),
)

#: A line that names its family **in so many words** says so here, and this wins over the
#: word scan above.
#:
#: The word scan takes the first family word anywhere in the line, which is a guess that a
#: seat's own record breaks: `builder.picks` writes the curation partition into every panel
#: line, and a Julia set of the Mandelbrot parameter plane is partitioned `julia:mandelbrot`
#: — so a line reading `partition julia:mandelbrot - family julia, degree 2, c = ...` was
#: read as a Mandelbrot, and a Mandelbrot takes no `c`, so the constants that make it that
#: Julia set were dropped from the link. The picture the reader clicked and the picture the
#: explorer opened were different objects, which is the one failure this registry exists to
#: refuse. Held to the family names rather than to `[a-z_]+`, because `the field family` is
#: a phrase this site's provenance also writes.
FAMILY_NAMED = re.compile(r"\bfamily (fractional_multibrot|multibrot|mandelbrot|julia|phoenix)\b")

#: The shade keys a prose provenance line spells out, and how each is read.
PROSE_SHADE = {
    "gamma": re.compile(rf"\bgamma ({NUMBER})"),
    "cycles": re.compile(rf"\bcycles ({NUMBER})"),
    "phase": re.compile(rf"\bphase ({NUMBER})"),
    "reverse": re.compile(r"\breverse (true|false|True|False)"),
    "transfer": re.compile(r"\btransfer ([a-z]+)"),
    "rolloff": re.compile(r"\brolloff ([a-z_]+)"),
}


def scan(line: str, roster: list[str], modes: set[str]) -> dict:
    """Every field one provenance line names, by the name the derivation uses."""
    found: dict = {}
    for key, pattern in FIELD.items():
        match = pattern.search(line)
        if match:
            found[key] = match.groups()
    colormap = named_colormap(line, roster)
    if colormap is not None:
        found["colormap"] = colormap
    named = FAMILY_NAMED.search(line.lower())
    if named:
        found["family"] = named.group(1)
    else:
        lowered = line.lower()
        for word, family in FAMILY_WORDS:
            if word in lowered:
                found["family"] = family
                break
    # A mode is a name the catalog holds. `Only the mode changes.` is a sentence about a
    # sheet and not a mode called `changes`, and a rule that read whatever followed the
    # word would put a mode nobody has into a link.
    if "mode" in found and found["mode"][0] not in modes:
        del found["mode"]
    if "reading" in found and "mode" not in found:
        found["mode"] = (found["reading"][0], None)
    if "at" in found and "centre" not in found:
        found["centre"] = found["at"][:2]
        found["width"] = (found["at"][2],)
    shade = _prose_shade(line)
    if shade:
        found["shade"] = shade
    return found


def _prose_shade(line: str) -> dict:
    """The palette recipe a line spells in words, where it spells one.

    Only read when the word `palette` is there in front of it: `phase` and `cycles` are
    ordinary words, and a sentence about a walk's phases is not a shade recipe.
    """
    if "palette gamma" not in line:
        return {}
    shade: dict = {}
    for key, pattern in PROSE_SHADE.items():
        match = pattern.search(line)
        if not match:
            continue
        text = match.group(1)
        if key in ("gamma", "cycles", "phase"):
            shade[key] = float(text)
        elif key == "reverse":
            shade[key] = text.lower() == "true"
        else:
            shade[key] = {"kind": text}
    return shade


def _figure_view(
    figure: figures.Figure, roster: list[str], palettes: dict[str, bool], curves: dict[str, str]
) -> Link | tuple[dict, str]:
    """A figure's representative view, or the reason it has none.

    **A panel is preferred to the preamble.** A sheet's first line is usually about how
    the sheet was made and sometimes carries a frame of its own — the node a nucleus was
    solved on, say — which is a picture the figure does not show. So the panels are
    looked at first, and the preamble supplies a frame only where no panel does, which
    is what a one-frame figure's record looks like.
    """
    said = _not_rendered(figure)
    if said is not None:
        return _refused(f"figure:{figure.id}", "drawn", said)
    modes = set(curves)
    scanned = [scan(line, roster, modes) for line in figure.provenance]
    cited = [_cited(line) for line in figure.provenance]
    framed = [
        index
        for index in range(len(scanned))
        if cited[index] is not None or ("centre" in scanned[index] and "width" in scanned[index])
    ]
    chosen = next((index for index in framed if index > 0), framed[0] if framed else None)
    if chosen is None:
        return _refused(
            f"figure:{figure.id}",
            "incomplete_provenance",
            "no panel of the record names a frame to open at",
        )
    merged: dict = {}
    for fields in scanned[:chosen]:
        merged.update(fields)
    merged.update(scanned[chosen])
    return _view(f"figure:{figure.id}", merged, cited[chosen], f"panel {chosen}", palettes, curves)


#: What a provenance line says when the picture did not come out of the engine's
#: renderer. Read rather than planted: each of these is a phrase a row already writes.
#:
#: **Asked before a frame is looked for, not after** *(figure_split_all_ckpt140,
#: 2026-09-22)*. It used to be the fallback when no panel named a frame, which caught the
#: charts and the gradient strips — they name none — and missed the one figure that says
#: it is not a render *and* spells a frame anyway. `render-percentile-stretch` paints two
#: pictures from a dumped field, because the engine's coloring stage always stretches
#: against the frame's own percentiles and the whole-range panel **cannot be asked for**;
#: its record says exactly that, and it carried a link to a picture the explorer would
#: draw the other way. A row that says the engine did not draw this is believed.
NOT_RENDERED = {
    "drawn, not rendered": REASONS["drawn"],
    "no render:": REASONS["drawn"],
    "cannot be asked for": (
        "the record says this picture cannot be asked of the engine — it is painted from "
        "a dumped field, past the stage whose behaviour the figure is about — so there is "
        "no view to reopen it at"
    ),
}


def _not_rendered(figure: figures.Figure) -> str | None:
    """The line saying no engine render stands behind this picture, where there is one."""
    for line in figure.provenance:
        lowered = line.lower()
        for phrase, why in NOT_RENDERED.items():
            if phrase in lowered:
                return why
    return None


def _cited(line: str) -> dict | None:
    """The wallpapers-side record a provenance line addresses, read whole.

    A record beats prose about the same picture wherever both are there: the prose was
    written from the record, and one of them is the original.
    """
    from . import locations, renders

    found = FINISHED.search(line)
    if found:
        head, batch, at = found.group(1), found.group(2), int(found.group(3))
        row = renders.finished_row(head, batch, at)
        return {
            "family": row["family"],
            "viewport": row["viewport"],
            "mode": row["mode"],
            "mode_params": row.get("mode_params") or {},
            "curve": row.get("curve", "linear"),
            "colormap": row["colormap"],
            "recipe": row.get("recipe") or {},
            "cap": row.get("maxiter"),
        }
    found = RELEASED.search(line)
    if found:
        row = locations.release_record(found.group(1), found.group(2))
        if row is None:
            # A key-shaped string the release store does not answer to. The pattern is
            # deliberately loose about what a candidate id looks like, so a line that
            # merely resembles a citation falls back to the prose around it rather than
            # taking the whole derivation down with it.
            return None
        recipe = row["recipe"]
        return {
            "family": row["location"]["family"],
            "viewport": row["location"]["viewport"],
            "mode": recipe["mode"],
            "mode_params": {},
            "curve": recipe.get("curve", "linear"),
            "colormap": recipe["colormap"],
            "recipe": {"mirror": recipe.get("mirror", False)},
            "cap": (recipe.get("render") or {}).get("maxiter"),
        }
    return None


# ---------------------------------------------------------------------------- the view


def _view(
    identifier: str,
    fields: dict,
    record: dict | None,
    source: str,
    palettes: dict[str, bool],
    curves: dict[str, str],
) -> Link | tuple:
    """One picture's view, ready for the contract, or the reason there is none."""
    family = _family(fields, record)
    if family is None:
        return _refused(identifier, "incomplete_provenance", "no family is written down")
    if family == "fractional_multibrot":
        return _refused(
            identifier,
            "not_exposed",
            "a non-integer degree is render-only: the engine gives it no home view, so "
            "there is nowhere for the explorer to open it at",
        )

    frame = _frame(fields, record)
    if frame is None:
        return _refused(identifier, "incomplete_provenance", "no centre and width to open at")

    mode = _text(fields.get("mode")) if record is None else record["mode"]
    if mode is None:
        if "coloring" in fields:
            return _refused(
                identifier,
                "not_exposed",
                "the picture was drawn from a coloring written out in full rather than "
                "from a named mode, and a link names a mode",
            )
        return _refused(identifier, "incomplete_provenance", "no mode is written down")

    colormap = _colormap(fields, record)
    if colormap is None:
        return _refused(identifier, "incomplete_provenance", "no colormap is written down")

    if mode not in curves:
        return _refused(
            identifier,
            "not_exposed",
            f"the {mode} mode is not one the explorer offers — the page draws the "
            "engine's production roster, and this is not on it",
        )
    curve = record["curve"] if record else _text(fields.get("curve"))
    if curve is not None and curve != curves[mode]:
        return _refused(
            identifier,
            "not_exposed",
            f"the picture reads {mode} through a {curve} curve, and the catalog's "
            f"{mode} is {curves[mode]}: a curve is part of a mode's identity here and "
            "is not a key a link may carry",
        )

    if colormap not in palettes:
        return _refused(
            identifier,
            "incomplete_provenance",
            f"{colormap} is not a map the explorer carries — rebake with "
            "`python -m builder explorer --palettes-only`",
        )

    shade = _shade(fields, record)
    if shade["mirror"] and palettes[colormap]:
        return _refused(
            identifier,
            "not_exposed",
            f"the picture folds {colormap}, which is cyclic, and the contract refuses a "
            "fold on a cyclic map: folding it would halve the cycle it was drawn to have",
        )

    if _too_deep(frame):
        return _refused(identifier, "deep", REASONS["deep"])

    params = dict(record["mode_params"]) if record else _params(fields)
    cap = record["cap"] if record else (int(fields["cap"][0]) if "cap" in fields else None)
    return (
        {
            "family": family,
            "constants": _constants(family, fields, record),
            "mode": mode,
            "params": params,
            **frame,
            "palette": colormap,
            "shade": shade,
            "cap": cap,
        },
        source,
    )


#: The widest canvas the explorer is asked to hold a frame on, and the engine's own
#: floor for how many representable numbers one sample step has to span. The wall moves
#: with the sample grid, and a link carries no resolution — so it is asked at the
#: demanding end: a frame refused on a wide screen is refused, whatever the reader's
#: window is. See `Viewport::is_resolvable_in_f64` and `RESOLUTION_ULPS` in the engine.
REFERENCE_WIDTH = 3840
RESOLUTION_ULPS = 4.0


def _too_deep(frame: dict) -> bool:
    """Whether f64 has stopped resolving this frame at the reference grid."""
    import math

    width = float(frame["w"])
    height = width * 9 / 16
    reach = max(abs(float(frame["x"])) + width / 2, abs(float(frame["y"])) + height / 2)
    ulp = math.ulp(reach) if reach > 0 else math.ulp(0.0)
    return (width / REFERENCE_WIDTH) / ulp < RESOLUTION_ULPS


def catalog_curves() -> dict[str, str]:
    """The curve each mode reads its field through, out of the baked catalog.

    The catalog is generated from `fractal-engine modes`, so this is the engine's own
    answer rather than a second one — and it is read out of the committed module, so
    deriving the registry needs no engine binary.
    """
    text = (SITE_ROOT / "explorer" / "catalog.js").read_text(encoding="utf-8")
    found = re.search(r"export const CURVES = (\{.*?\n\});", text, re.S)
    if found is None:
        raise LinkError("explorer/catalog.js carries no CURVES — rebake it")
    return json.loads(found.group(1))


def _text(found) -> str | None:
    return found[0] if found else None


def _params(fields: dict) -> dict:
    """A mode's own parameters, where the record spelled them after the mode's name."""
    written = fields.get("mode")
    if not written or written[1] is None:
        return {}
    return {key: float(value) for key, value in json.loads(written[1]).items()}


def _family(fields: dict, record: dict | None) -> str | None:
    """The permalink's own name for the family, exponent included."""
    if record is not None:
        kind = record["family"]["kind"]
        degree = record["family"].get("degree", 2)
        return _named(kind, degree)
    kind = fields.get("family")
    if kind is None:
        return None
    degree = int(fields["degree"][0]) if "degree" in fields else 2
    return _named(kind, degree)


def _named(kind: str, degree: int) -> str:
    if kind == "mandelbrot":
        return "mandelbrot"
    if kind == "multibrot":
        return "mandelbrot" if degree == 2 else f"multibrot{degree}"
    if kind == "julia":
        return "julia" if degree == 2 else f"julia{degree}"
    return kind


def _frame(fields: dict, record: dict | None) -> dict | None:
    """The centre and the width, as the decimal strings they were recorded as."""
    if record is not None:
        view = record["viewport"]
        return {"x": view["center_re"], "y": view["center_im"], "w": view["width"]}
    if "centre" not in fields or "width" not in fields:
        return None
    return {"x": fields["centre"][0], "y": fields["centre"][1], "w": fields["width"][0]}


def _constants(family: str, fields: dict, record: dict | None) -> dict:
    """A family's own constants, as decimal strings. Absent means the origin."""
    if record is not None:
        held = record["family"]
        pair = {
            "cx": held.get("c", ["0", "0"])[0],
            "cy": held.get("c", ["0", "0"])[1],
            "px": held.get("p", ["0", "0"])[0],
            "py": held.get("p", ["0", "0"])[1],
            "zx": (held.get("z_prev") or ["0", "0"])[0],
            "zy": (held.get("z_prev") or ["0", "0"])[1],
        }
    else:
        pair = {
            "cx": fields.get("c", ("0", "0"))[0],
            "cy": fields.get("c", ("0", "0"))[1],
            "px": fields.get("p", ("0", "0"))[0],
            "py": fields.get("p", ("0", "0"))[1],
            "zx": fields.get("z_prev", ("0", "0"))[0],
            "zy": fields.get("z_prev", ("0", "0"))[1],
        }
    if family.startswith("julia"):
        return {"cx": pair["cx"], "cy": pair["cy"]}
    if family == "phoenix":
        return pair
    return {}


#: What the candidate ledger calls a screened composite's drawn texture weight: next door's
#: `engine_spec.TEXTURE_WEIGHT`, written into `mode_params` since `9c615d6`.
LEDGER_TEXTURE_WEIGHT = "texture_weight"


def contract_params(mode_params: dict | None) -> dict:
    """A ledger recipe's `mode_params` in the words a link spells them in.

    A composite's drawn weight is `texture_weight` in the ledger, which is the engine's
    word, and `weight` in a link, which is the contract's. Every other setting a recipe
    carries is spelled the same on both sides. **Every record this repository writes out
    of a ledger recipe goes through here** — the atlas ingest skipped it once and 28
    thumbnails opened at the catalog's 0.85 over pictures drawn at their own weights
    *(ckpt141)*. The contract now refuses a key it does not spell rather than dropping it,
    so a record that misses this fails at `check` instead of linking to the wrong picture.
    """
    params = dict(mode_params or {})
    if LEDGER_TEXTURE_WEIGHT in params:
        params["weight"] = params.pop(LEDGER_TEXTURE_WEIGHT)
    return params


def ledger_view(recipe: dict, *, level: dict | None = None) -> dict:
    """One candidate-ledger recipe in the shape `emit.mjs` reads.

    A ledger recipe is a record and not prose, so none of the scanning above applies to
    it: the family, the frame, the mode and its parameters, the map and the whole palette
    pass are fields. What this is for is the caller that already holds a recipe — a staged
    gallery is a thousand of them — and the reason it lives here rather than there is the
    module's own rule: **nothing outside this module decides what a view is**, because a
    second opinion about a view is a second opinion about the URL it emits.

    `level` is the recorded tone curve, where the caller found one on the run that drew
    the picture. Left out, the view says nothing about tone, which is the contract's own
    fallback and the link every picture drawn before that key existed still emits.
    """
    record = {
        "family": recipe["family"],
        "viewport": recipe["viewport"],
        "recipe": recipe.get("palette") or {},
    }
    family = _family({}, record)
    params = contract_params(recipe.get("mode_params"))
    view = {
        "family": family,
        "constants": _constants(family, {}, record),
        "mode": str(recipe["mode"]),
        "params": params,
        **_frame({}, record),
        "palette": str(recipe["colormap"]),
        "shade": _shade({}, record),
    }
    if level is not None:
        view["level"] = level
    return view


def _colormap(fields: dict, record: dict | None) -> str | None:
    """The map the picture was drawn through."""
    return record["colormap"] if record is not None else fields.get("colormap")


def baked_palettes() -> dict[str, bool]:
    """Every colormap the explorer carries, name to whether it is cyclic.

    Read out of the baked module rather than out of the wallpaper project, because the
    question this module asks is not "does a map by this name exist" — it is "can a link
    say it", and `palettes.js` is what answers that.

    Read by pattern rather than by parsing JavaScript, so the shape of the baked line is
    part of what this asks for. That shape changed once — the module became an index and
    each map went from a block of several lines to one line of JSON-spelled fields — and
    this went on matching nothing, quietly, because no check calls it: `links --write`
    would have refused every figure for naming a colormap the explorer does not carry.
    So the pattern is anchored at both ends now and the count is asserted: a module this
    cannot read is a loud failure rather than an empty roster.
    """
    text = (SITE_ROOT / "explorer" / "palettes.js").read_text(encoding="utf-8")
    found = {
        name: cyclic == "true"
        for name, cyclic in re.findall(
            r'^  \["(.+?)", \{.*?"cyclic": (true|false).*?\}\],$', text, re.M
        )
    }
    if not found:
        raise records.RecordError(
            "explorer/palettes.js carries no map this can read: the baked module's shape "
            "has changed and `baked_palettes` has not."
        )
    return found


def named_colormap(line: str, roster: list[str]) -> str | None:
    """The colormap a provenance line names, matched against the roster longest first.

    Map names carry spaces and dots — `Ice Walk`, `Ember Against Steel`, `cmr.voltage` —
    so no punctuation rule ends one reliably, and `colormap Ice Walk over the leveled
    range` is the line that proves it: reading to the comma invents a map nobody has.
    Matching against the roster cannot.
    """
    at = line.find(COLORMAP_WORD)
    while at != -1:
        tail = line[at + len(COLORMAP_WORD) :]
        match = next((name for name in roster if tail.startswith(name)), None)
        if match is not None:
            return match
        at = line.find(COLORMAP_WORD, at + 1)
    return None


def _shade(fields: dict, record: dict | None) -> dict:
    """The engine's palette recipe, at its defaults except where one was written down."""
    shade = {
        "gamma": 1.0,
        "cycles": 1.0,
        "phase": 0.0,
        "reverse": False,
        "mirror": False,
        "transfer": {"kind": "value"},
        "rolloff": {"kind": "none"},
        # The palette modes (palette_modes_ckpt143). The contract reads all seven shade
        # keys and three more, and a view that leaves these out is refused — which, until
        # deep_figures_ckpt145, refused 222 links on a rerun of `links --write`. At these
        # values each is omitted from the link, so no link written before them moves.
        "scale": "leveled",
        "lambda": 1.0,
        "period": 1.0,
    }
    if record is not None:
        shade.update({key: value for key, value in record["recipe"].items() if key in shade})
    shade.update(fields.get("shade", {}))
    if "mirror" in fields:
        shade["mirror"] = fields["mirror"][0].lower() == "true"
    return shade
