"""The figures of the Start here page: an outline of the project told in six pictures.

    python -m builder start [ID ...] [--place] [--replace]

The page is the project in a few paragraphs, and its figures are the pipeline's stages in
the order the page walks them: the base sets a search starts from, one descent, one
location drawn in four rendering modes, a general gallery and a pink one. **Every picture
here but the first is new to the site** *(start_here_ckpt146)*: no seat, candidate or frame
another figure already stands on, because the point of the page is how much the collection
holds. Which places are taken is `builder.frames`, asked before anything was picked. The
first is the base sets whole at their home views *(start_here_layout_ckpt146)*, which are
each family's identity rather than a place, and its row says so in `reuse_reason`.

Three of the five drawn figures stand on records next door and name them on their own
registry rows, the way `builder.picks` does: a re-pick is an edit to the row followed by
`python -m builder start <id> --replace`. The walk is frozen here instead, as the ledger
nodes it was read from, because a descent is a path through one ledger rather than a list
of independent picks. `start-video` is a YouTube player, and nothing here draws it; what
is drawn here is the pair of linked pictures under it, each the explorer's arrival at one
of the video's short links (`video_links`).

These are placeholders Matt adjusts. The seats were drawn by a seeded shuffle, not chosen
for how they look, and each row's provenance says so; `start-pink-gallery` in particular
stands in for his daughter's own picks.
"""

from __future__ import annotations

import json
from urllib.parse import parse_qs

from . import deep_figures, go, links, records, renders, sheets
from . import families as families_module
from . import figures as figures_module
from . import picks as picks_module
from .locations import Made, Split, neutral_spec, panel_path, panels

#: Which figure is drawn by what, in page order.
FAMILIES, WALK, MODES, GALLERY, PINK, VIDEO = (
    "start-families",
    "start-walk",
    "start-modes",
    "start-gallery",
    "start-pink-gallery",
    "start-video",
)

#: The base sets, one picture each, whole at the engine's home view with nothing marked on
#: them, and the map each is drawn in *(start_here_layout_ckpt146)*. **No Julia set**, so
#: that nobody reads the figure as "there is one Julia set": each plane has a Julia set at
#: every point of it, and a single one standing beside its plane says otherwise. Six maps,
#: no two alike, and none that the Escape-time fractals page colours anything in. Phoenix is
#: drawn at the engine's own default constants, which is what its home view is.
FAMILY_SETS = (
    ({"kind": "mandelbrot"}, "cmr.guppy"),
    ({"kind": "multibrot", "degree": 3}, "cmr.viola"),
    ({"kind": "multibrot", "degree": 4}, "summer"),
    ({"kind": "multibrot", "degree": 5}, "cmr.copper_s"),
    ({"kind": "multibrot", "degree": 6}, "cmr.iceburn"),
    (families_module.PHOENIX_DEFAULT, "turbo"),
)
FAMILY_COLUMNS = 3

#: The two galleries: twelve seats each, four across and three down.
GRID_COLUMNS = 4
GRID_SEATS = 12

#: The recorded galleries these were drawn from: the `final139_*` solves `builder/seats.py`
#: names for the general, magenta and rose collections.
GENERAL_STAMP = "20260922T012627Z"
MAGENTA_STAMP = "20260922T014213Z"
ROSE_STAMP = "20260922T012745Z"

#: The four renderings a location is shown in, in the page's own words' order.
MODE_ROW = ("smooth", "tia", "threads", "stripe")

#: How each seat figure's seats were arrived at, which the resolution cannot say for itself.
SEED = 20260924
DRAW = (
    f"Which seats: a seeded shuffle (seed {SEED}) of each collection's seats, taking the "
    "first that clear the rejections, by scratch/start/select.py — a seat whose place "
    "(centre and width, as builder.frames reduces it) any other figure on the site already "
    "stands on, or whose key a figure already cites; a seat whose run recorded that the "
    "autolevel operator acted without recording the curve, so no render of the recipe is "
    "its picture; a place another Start here panel already took. Nothing here was chosen "
    "for how it looks.",
)
GALLERY_DRAW = (
    *DRAW,
    "start-gallery takes twelve seats of the general collection, at most two of any one "
    "rendering mode, hue family or partition.",
)
PINK_DRAW = (
    *DRAW,
    "start-pink-gallery takes six seats of the magenta collection and then six of the rose "
    "collection, at most two of any one rendering mode or partition in each. It is a "
    "placeholder for the gallery Matt's daughter chose.",
)


class StartError(RuntimeError):
    """A Start here figure cannot be drawn as its registry row describes it."""


# ------------------------------------------------------------------- the seat figures


def _args(identifier: str) -> dict:
    figure = figures_module.load_all().get(identifier)
    if figure is None or figure.recipe is None:
        raise StartError(f"{identifier} has no recipe on its registry row")
    return dict(figure.recipe.args)


def _family_words(family: dict) -> str:
    """A base set as the provenance of the degree ladder spells it."""
    kind = family["kind"]
    if kind == "multibrot":
        return f"multibrot degree {family['degree']}"
    if kind == "phoenix":
        c, p, z_prev = (f"{a} + {b}i" for a, b in (family[k] for k in ("c", "p", "z_prev")))
        return f"phoenix, c = {c}, p = {p}, z_prev = {z_prev}"
    return kind


def families() -> Split:
    """Each base set whole, labelled with the family and the iteration it runs."""
    cache = renders.Cache()
    size = families_module.FAMILIES_PANEL
    supersample = families_module.SUPERSAMPLE
    made: list[Made] = []
    lines = [
        f"builder.start:families — {len(FAMILY_SETS)} panels at {size[0]}x{size[1]}, "
        f"{FAMILY_COLUMNS} to a row, landed one file a panel: each base set whole at the "
        "home view the engine derives for it, with no marks, in the map named on its line. "
        "The maps were picked by this session off a sheet of candidates at these home views "
        "(start_here_layout_ckpt146), for a ground that reads in the well and so that no two "
        "panels and nothing on the Escape-time fractals page share one."
    ]
    for family, colormap in FAMILY_SETS:
        spec = families_module.home_spec(family, colormap)
        drawn = cache.render(
            f"start-families-{colormap}", spec, size, supersample=supersample, colormap=None
        )
        name = picks_module.family_name(family)
        made.append(
            Made(
                sheets.save(
                    sheets.fitted(drawn.path, size), panel_path(FAMILIES, len(made) + 1), quiet=True
                ),
                alt=f"The whole {name} set, drawn in one palette.",
                label=name,
                note=picks_module.family_formula(family),
                spec=spec,
            )
        )
        view = spec["viewport"]
        lines.append(
            f"fractal-engine render: {_family_words(family)} at its home view (centre "
            f"{view['center_re']} + {view['center_im']}i, width {view['width']}), "
            f"{size[0]}x{size[1]}, supersample {supersample}, mode smooth, "
            + ("colormap" if not lines[1:] else "palette")
            + f" {colormap}, maxiter auto (the depth policy)"
        )
    return Split(made, lines, FAMILY_COLUMNS)


def _grid(identifier: str, chosen: tuple[str, ...], stamps: tuple[str, ...]) -> Split:
    wanted = picks_module.picks_of(identifier)
    if len(wanted) != GRID_SEATS:
        raise StartError(f"{identifier} is {GRID_SEATS} seats and its row names {len(wanted)}")
    strays = [one for one in wanted if picks_module.split(one)[0] not in stamps]
    if strays:
        raise StartError(f"{identifier} draws from {', '.join(stamps)}; not {', '.join(strays)}")
    resolved = picks_module.resolve(wanted)
    made, size = picks_module.seat_panels(identifier, resolved, GRID_COLUMNS, identifier)
    return Split(
        made,
        picks_module.provenance(
            resolved, size, columns=GRID_COLUMNS, chosen=chosen, composed=False
        ),
        GRID_COLUMNS,
    )


def gallery() -> Split:
    """Twelve seats of the general gallery, unlabelled."""
    return _grid(GALLERY, GALLERY_DRAW, (GENERAL_STAMP,))


def pink_gallery() -> Split:
    """Six seats of the magenta collection and six of the rose, unlabelled."""
    wanted = picks_module.picks_of(PINK)
    stamps = [picks_module.split(one)[0] for one in wanted]
    if stamps != [MAGENTA_STAMP] * 6 + [ROSE_STAMP] * 6:
        raise StartError(f"{PINK} is six magenta seats and then six rose seats")
    return _grid(PINK, PINK_DRAW, (MAGENTA_STAMP, ROSE_STAMP))


# ----------------------------------------------------------------------- the walk figure

#: The walk ledger the descent is read from, and the frames of it the strip shows, frozen
#: here as the ledger spells them (the maker rule: a location is addressed by its record,
#: never re-derived at draw time). Each is `(node id, what the step was, family, frame)`.
#:
#: The strip joins two walks, because the second maneuver is not a move inside one: when
#: the walk admits a parameter-plane frame, the **twin channel** seeds a new Julia root
#: whose c is that frame's centre, and the new walk starts from the whole Julia set.
#: Node 41476's c is node 41449's centre to the last digit, which is the whole of the join;
#: the ledger records the channel and the parent plane, and no edge between the two.
WALK_LEDGER = "overnight_harvest_ckpt123"
WALK_PLANE = {"kind": "multibrot", "degree": 5}
WALK_JULIA = {"kind": "julia", "degree": 5, "c": ["0.6396478567167911", "0.8014732252520101"]}
WALK_FRAMES = (
    (
        41329,
        "start at the boundary",
        "a plane root, seed multibrot5-p8-236 of the nucleus grid (period 8)",
        WALK_PLANE,
        (
            "0.64772441057660679437835345159946391",
            "0.79958643911529491469312485601892427",
            "0.014003207864659872",
        ),
    ),
    (
        41429,
        "find a nearby minibrot",
        "the frame expand_neighborhood pushed off node 41414 (depth 2, fate expandable): "
        "a period-14 copy found near the one node 41414 sat by, framed at 16 times its "
        "own size; a reframing row, recorded under pushed_node_id",
        WALK_PLANE,
        (
            "0.63961646701407355514917967935072030",
            "0.80151544692150116231700805519388370",
            "0.00015081973101883472",
        ),
    ),
    (
        41449,
        "descend",
        "depth 3, branch foci, origin expand_neighborhood, fate survived, score 0.7776",
        WALK_PLANE,
        ("0.6396478567167911", "0.8014732252520101", "0.00006260019458830486"),
    ),
    (
        41476,
        "switch to its Julia set",
        "a Julia root of the twin channel (twin:run, seed twin-multibrot5-0060, parent plane "
        "multibrot5), c = node 41449's centre, at the whole Julia set",
        WALK_JULIA,
        ("0.0", "0.0", "3.0"),
    ),
    (
        41523,
        "descend",
        "depth 3 of the Julia walk, branch foci, fate survived, score 0.9576",
        WALK_JULIA,
        ("0.40882936760407346", "-0.19514354203728235", "0.4386329180089233"),
    ),
    (
        41563,
        "descend",
        "depth 4, branch density, fate survived, score 0.9773",
        WALK_JULIA,
        ("0.42071628484331147", "-0.1969184752598213", "0.17794212908189785"),
    ),
)
WALK_COLUMNS = 3

#: The nodes a source key can address: every frame but the reframing, which is a row of
#: its own kind rather than a node the ledger writes a `node_id` for.
WALK_KEYED = (41329, 41449, 41476, 41523, 41563)


def walk() -> Split:
    """One descent in six frames: a plane walk to a minibrot, then its Julia set's walk."""
    size = panels(WALK_COLUMNS)
    made: list[Made] = []
    lines = [
        f"builder.start:walk — six frames of ledger {WALK_LEDGER}/walk.jsonl at {size[0]}x"
        f"{size[1]}, landed one file a panel, each drawn fresh at 1280x720 supersample 3, mode "
        f"smooth, in the neutral map, cap from the depth policy, and fitted. The frames are "
        "frozen in builder/start.py as the ledger spells them. Two walks joined: the plane "
        "walk from root 41329 through node 41414 and the expand_neighborhood reframing it "
        "offered to node 41449, admitted; then the Julia root the twin channel seeded at "
        "41449's centre (node 41476) and that walk's nodes 41491, 41523 and 41563, each "
        "admitted. Nodes 41414 and 41491 are steps of the chain the strip leaves out. Found "
        "for this figure by reading the ledger for a plane admission whose twin root "
        "descended, not chosen for how it looks.",
    ]
    for index, (node, words, step, family, (re_, im_, width)) in enumerate(WALK_FRAMES, start=1):
        place = {
            "family": dict(family),
            "viewport": {"center_re": re_, "center_im": im_, "width": width},
        }
        picture = renders.Cache().render(f"start-walk-{node}", place, (1280, 720)).path
        made.append(
            Made(
                sheets.save(sheets.fitted(picture, size), panel_path(WALK, index), quiet=True),
                alt=(
                    f"Step {index} of one descent, in the "
                    f"{picks_module.family_name(family)} family, drawn in one neutral palette."
                ),
                label=f"{index}. {words}",
                spec=neutral_spec(place),
            )
        )
        lines.append(
            f"frame {index}, node {node}: {step}; family {json.dumps(family)}, centre {re_} + "
            f"{im_}i, width {width}, mode smooth, "
            + ("colormap" if index == 1 else "palette")
            + f" {renders.COLORMAP}, maxiter auto (the depth policy)."
        )
    return Split(made, lines, WALK_COLUMNS)


# ---------------------------------------------------------------------- the modes figure


def _candidate_line(pick, index: int) -> str:
    recipe = pick.recipe
    view = recipe["viewport"]
    palette = recipe["palette"]
    return (
        f"row {index}, {picks_module.mode_words(pick.mode)}: candidate {pick.key} "
        f"(ledger run {pick.source.get('run')}, candidate {pick.source.get('candidate')}) — "
        f"centre {view['center_re']} + {view['center_im']}i, width {view['width']}, "
        f"mode {recipe['mode']}"
        + (f" {json.dumps(recipe['mode_params'])}" if recipe.get("mode_params") else "")
        + f", curve {recipe['curve']}, palette {recipe['colormap']}, "
        f"mirror {picks_module.flag(palette.get('mirror'))}, cap {recipe['maxiter']}; "
        f"{picks_module.shade_words(palette)}. Drawn at regime {recipe['regime']}."
    )


def modes() -> Split:
    """Two locations: each as the search found it, then in four rendering modes.

    Each row is one location of the candidate ledger that the pool drew in all four of
    `MODE_ROW`, and each of those four panels is a real candidate at that location — its
    own palette, its own cap, its own tone curve — so the row is what the search actually
    tried there, not a location recoloured here. The first panel is the frame itself in
    the neutral map every place-not-wallpaper figure on the site uses.
    """
    rows = _args(MODES).get("rows")
    if not isinstance(rows, list) or not rows:
        raise StartError(f"{MODES}'s row names no `rows` of candidate keys")
    size = panels(len(MODE_ROW) + 1)
    catalog = renders.mode_catalog()
    made: list[Made] = []
    lines = [
        f"builder.start:modes — {len(rows)} rows of {len(MODE_ROW) + 1} panels at "
        f"{size[0]}x{size[1]}, landed one file a panel. The first panel of a row is the "
        f"location, drawn fresh at 1280x720 supersample 3, mode smooth, colormap "
        f"{renders.COLORMAP}, cap from the depth policy; the other four are candidates of "
        "the candidate ledger at that exact frame, one per rendering mode, each drawn fresh "
        f"from its own ledger recipe at {picks_module.PANEL_RENDER[0]}x"
        f"{picks_module.PANEL_RENDER[1]} supersample {picks_module.PANEL_SUPERSAMPLE} and "
        "fitted.",
        "Which locations and candidates: Matt picked both rows off a contact sheet of 30 "
        "(start_modes_sheet_ckpt147). The sheet's rows were every location a kept record "
        "seats (the twenty final139_* solves and final140_general2000), less any place or "
        "seat key another figure already stood on, that the candidate ledger drew in all "
        "four modes; per mode the candidate with the best fine-head p_fine(>=4) from "
        "pool_scores.jsonl whose recipe frame is the location's own and whose tone curve is "
        "on its run's record, by scratch/start_modes_sheet/pick.py. Thirty locations cleared "
        "that, and the sheet showed all of them. Row 1 is sheet row 2, the place general "
        "20260922T012627Z|1004570ab7a4ff18 seats; row 2 is sheet row 3, the place "
        "20260922T012627Z|460117ee01aee127 seats.",
    ]
    everything = []
    for index, keys in enumerate(rows, start=1):
        if not isinstance(keys, list) or len(keys) != len(MODE_ROW):
            raise StartError(f"{MODES}: row {index} is {len(MODE_ROW)} candidate keys")
        resolved = picks_module.candidates(keys)
        everything += resolved
        drawn = [pick.mode for pick in resolved]
        if drawn != list(MODE_ROW):
            raise StartError(f"{MODES}: row {index} is {', '.join(drawn)}, not {MODE_ROW}")
        places = {json.dumps([p.family, p.recipe["viewport"]], sort_keys=True) for p in resolved}
        if len(places) != 1:
            raise StartError(f"{MODES}: row {index}'s four candidates are not one frame")
        first = resolved[0]
        place = {"family": first.family, "viewport": first.recipe["viewport"]}
        name = picks_module.family_name(first.family)
        picture = renders.Cache().render(f"start-modes-{index}-place", place, (1280, 720)).path
        made.append(
            Made(
                sheets.save(
                    sheets.fitted(picture, size), panel_path(MODES, len(made) + 1), quiet=True
                ),
                alt=f"A location in the {name} family, drawn in one neutral palette.",
                label="the location",
                spec=neutral_spec(place),
            )
        )
        view = place["viewport"]
        lines.append(
            f"row {index}, the location: {name}, family {json.dumps(first.family)}, centre "
            f"{view['center_re']} + {view['center_im']}i, width {view['width']}, mode smooth, "
            + ("colormap" if index == 1 else "palette")
            + f" {renders.COLORMAP}, maxiter auto (the depth policy)."
        )
        for pick in resolved:
            level, why = links.panel_level(pick)
            spec = {
                "family": pick.family,
                "viewport": pick.recipe["viewport"],
                "mode": pick.mode,
                "mode_params": pick.recipe.get("mode_params") or {},
                "curve": pick.recipe["curve"],
                "colormap": pick.recipe["colormap"],
                "palette": pick.recipe["palette"],
                "maxiter": pick.recipe["maxiter"],
            }
            if why is None and level is not None:
                spec["level"] = level
            made.append(
                Made(
                    sheets.save(
                        sheets.fitted(
                            picks_module.panel(pick, f"start-modes-{pick.key}", catalog), size
                        ),
                        panel_path(MODES, len(made) + 1),
                        quiet=True,
                    ),
                    alt=f"The same location, drawn in {picks_module.mode_words(pick.mode)}.",
                    label=pick.mode,
                    spec=spec,
                )
            )
            lines.append(_candidate_line(pick, index))
    lines.insert(2, picks_module.autolevel_line(everything))
    return Split(made, lines, len(MODE_ROW) + 1)


# ------------------------------------------------------------- the pictures under the video

#: The pictures under the double-descent player, in page order: the short link each one
#: opens, by its name in `go/redirects.jsonl`, and the label under it, which is also its
#: alt. The register is the one place a target is written; the maker reads it at draw time
#: and the row's recipe keeps what it read, which `check`'s `go` holds to the register.
VIDEO_LINKS = (("favicon-mid", "Midway"), ("favicon-end", "Final frame"))

#: Half the article's column at twice the density, 16:9. Two across, stacking when narrow.
VIDEO_PANEL = (864, 486)
VIDEO_COLUMNS = 2

#: `render-link`'s own default for the shallow picture, and the Deep figures' for the deep
#: one: the deep picture is a perturbation render at a cap of two million, and four samples
#: a pixel is the most any deep figure on this site spends.
SHALLOW_SUPERSAMPLE = 3
DEEP_SUPERSAMPLE = 2


def _targets() -> dict[str, str]:
    """Each short link's explorer query, as the register writes it today."""
    held = {redirect.name: redirect.query for redirect in go.load()}
    missing = [name for name, _ in VIDEO_LINKS if name not in held]
    if missing:
        raise StartError(f"go/redirects.jsonl has no {', '.join(missing)}")
    return {name: held[name] for name, _ in VIDEO_LINKS}


#: The palette keys a link may spell after its map, in the order a provenance line gives them.
LINK_SHADE_KEYS = ("phase", "scale", "lambda", "period")


def _link_words(query: str) -> str:
    """A link's place and colouring as a provenance line spells them.

    Only what the link says: a mode it leaves out is the contract's first, smooth, and a
    palette key it leaves out is the contract's default and is not written here either.
    """
    fields = {key: values[0] for key, values in parse_qs(query).items()}
    degree = fields["f"].removeprefix("multibrot")
    shade = "".join(f", {key} {fields[key]}" for key in LINK_SHADE_KEYS if key in fields)
    return (
        f"multibrot degree {degree}, centre {fields['x']} + {fields['y']}i, width "
        f"{fields['w']}, mode {fields.get('m', 'smooth')}, {{map}} {fields['p']}{shade}"
    )


def video_links() -> Split:
    """The two pictures under the video: its midpoint and its final frame, each linked.

    Each is what the explorer draws on arriving at its short link. The midpoint is a
    shallow link, drawn by `fractal-engine render-link`, which reads the explorer's own
    keys — `scale`, `lambda` and `period` among them — and draws the view the page would.
    The final frame is a deep link, drawn the way the Deep tab draws one, through
    `deep_figures.draw_link`: the video's own fields are coloured by `builder/zoom.py`'s
    power mapping rather than by the tab's shader, so a frame of the video is not the
    picture the link opens.
    """
    targets = _targets()
    size = VIDEO_PANEL
    made: list[Made] = []
    lines = [
        f"builder.start:video_links — {len(VIDEO_LINKS)} panels at {size[0]}x{size[1]}, "
        f"{VIDEO_COLUMNS} across, landed one file a panel under the double-descent player: "
        "each is what the explorer draws on arriving at its short link, whose target this "
        "row's recipe records and `check`'s go holds to go/redirects.jsonl.",
    ]
    for index, (name, label) in enumerate(VIDEO_LINKS, start=1):
        query = targets[name]
        words = _link_words(query).replace("{map}", "colormap" if index == 1 else "palette")
        if query.startswith("dv="):
            drawn = deep_figures.draw_link(query, *size, DEEP_SUPERSAMPLE, f"{VIDEO}-{name}")
            picture = drawn.path
            how = (
                f"cap {drawn.maxiter}; drawn by builder.deep_figures.draw_link — "
                "deep_figures.mjs on the committed perturb.wasm, shaded by "
                f"deep_gallery_shade.mjs through engine.wasm — at {size[0]}x{size[1]} "
                f"supersample {DEEP_SUPERSAMPLE}, {drawn.seconds:.0f} s"
            )
        else:
            picture = panel_path(VIDEO, index).with_name(f"{VIDEO}-{name}-link.png")
            report = renders.render_link(query, picture, size, SHALLOW_SUPERSAMPLE)
            how = (
                f"cap {report['maxiter']} (the depth policy); drawn by `fractal-engine "
                f"render-link` at {size[0]}x{size[1]} supersample {SHALLOW_SUPERSAMPLE}"
            )
        made.append(
            Made(
                sheets.save(sheets.fitted(picture, size), panel_path(VIDEO, index), quiet=True),
                alt=label,
                label=label,
                go=name,
            )
        )
        lines.append(f"{label}, go/{name}: {words}; {how}.")
    return Split(made, lines, VIDEO_COLUMNS)


# ----------------------------------------------------------------------- the interface


MAKERS = {
    FAMILIES: families,
    WALK: walk,
    MODES: modes,
    GALLERY: gallery,
    PINK: pink_gallery,
    VIDEO: video_links,
}

#: The figures whose panels are gallery seats named in `picks`.
SEATED = (GALLERY, PINK)


def sources(identifier: str) -> list[dict]:
    if identifier in (FAMILIES, VIDEO):
        return [{"kind": figures_module.SYNTHETIC, "keys": []}]
    if identifier in SEATED:
        return [{"kind": figures_module.GALLERY_SEAT, "keys": picks_module.picks_of(identifier)}]
    if identifier == MODES:
        keys = [key for row in _args(MODES)["rows"] for key in row]
        return [{"kind": figures_module.CANDIDATE, "keys": keys}]
    if identifier == WALK:
        keys = [f"{WALK_LEDGER}/walk.jsonl#{node}" for node in WALK_KEYED]
        return [{"kind": figures_module.LOCATION, "keys": keys}]
    raise records.RecordError(f"{identifier} is not drawn by {__name__}")


def recipe(identifier: str) -> dict:
    if identifier not in MAKERS:
        raise records.RecordError(f"{identifier} is not drawn by {__name__}")
    if identifier == VIDEO:
        # The targets the pictures were drawn at, which the register may later move.
        args = {"links": _targets()}
    else:
        args = {} if identifier in (WALK, FAMILIES) else _args(identifier)
    return {"maker": f"{__name__}:{MAKERS[identifier].__name__}", "args": args}


def draw(identifier: str) -> Split:
    if identifier not in MAKERS:
        raise records.RecordError(f"{identifier} is not drawn by {__name__}")
    return MAKERS[identifier]()
