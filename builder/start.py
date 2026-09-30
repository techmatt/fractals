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
for how they look, and each row's provenance says so.

`start-pink-gallery` is the exception, and it is a list rather than a draw
*(start_pink_gallery_ckpt155)*: `article/pink-gallery.jsonl` holds the picks Matt's
daughter made, as the explorer links she chose them at, and then placeholder seats of the
magenta collection. The figure takes every pick in order and fills the rest of its twelve
cells from the placeholders, so a pick appended to the list takes the first remaining
placeholder's cell and nothing else moves. A pick is drawn from its link and nothing else;
the link lands in `article/figure-recipes.jsonl` beside the seats (`link` for a shallow
one, `deep` for a Deep-tab one), which is what the panel's own link is read from.
"""

from __future__ import annotations

import json
import random
from collections import Counter
from urllib.parse import parse_qs

from . import deep_figures, frames, go, links, recipes, records, renders, sheets
from . import families as families_module
from . import figures as figures_module
from . import picks as picks_module
from .locations import Made, Split, neutral_spec, panel_path, panels
from .paths import ARTICLE_DIR

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
#: names for the general and magenta collections.
GENERAL_STAMP = "20260922T012627Z"
MAGENTA_STAMP = "20260922T014213Z"

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
#: The pink gallery's list: the picks, then the placeholders that fill what they leave.
PINK_LIST = ARTICLE_DIR / "pink-gallery.jsonl"
PICK, PLACEHOLDER = "pick", "placeholder"

#: How the placeholders were drawn, once, by `draw_placeholders`: this many seats of the
#: magenta collection, in this seed's shuffle. More than the list needed on the day, so
#: that a pick appended later has a placeholder to take the cell of.
PLACEHOLDER_SEED = 20260928
PLACEHOLDERS = 7
PLACEHOLDER_CAPS = {"mode": 2, "partition": 2}
PINK_DRAW = (
    f"Which placeholders: a seeded shuffle (seed {PLACEHOLDER_SEED}) of the magenta "
    f"collection's seats ({MAGENTA_STAMP}), by builder.start.draw_placeholders, taking the "
    f"first {PLACEHOLDERS} that clear the rejections, at most two of any one rendering mode "
    "or partition: a seat whose place (centre and width, as builder.frames reduces it) any "
    "other figure on the site stands on, or whose key another figure cites; a seat whose "
    "run recorded that the autolevel operator acted without recording the curve; a place a "
    "pick or an earlier placeholder already took. Nothing here was chosen for how it looks, "
    "and the list holds more of them than the figure draws.",
)

#: A deep pick is drawn at the Deep figures' supersample, and a shallow one at a seat's.
PINK_RENDER = picks_module.PANEL_RENDER


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


def pink_list() -> list[dict]:
    """The pink gallery's list as it stands: picks and placeholders, in the list's order."""
    found = []
    for row in records.read(PINK_LIST):
        if row.kind == PICK:
            found.append({"kind": PICK, "link": row.text("link"), "from": row.text("from")})
        elif row.kind == PLACEHOLDER:
            seat = row.text("seat")
            if picks_module.split(seat)[0] != MAGENTA_STAMP:
                raise StartError(f"{row.where}: a placeholder is a magenta seat, not {seat}")
            found.append({"kind": PLACEHOLDER, "seat": seat})
        else:
            raise StartError(f"{row.where}: {row.kind!r} is neither {PICK} nor {PLACEHOLDER}")
    return found


def pink_tiles() -> list[dict]:
    """The twelve cells: every pick in order, then as many placeholders as are left."""
    listed = pink_list()
    chosen = [one for one in listed if one["kind"] == PICK]
    spare = [one for one in listed if one["kind"] == PLACEHOLDER]
    if len(chosen) > GRID_SEATS:
        raise StartError(f"{PINK_LIST.name} holds {len(chosen)} picks for {GRID_SEATS} cells")
    tiles = chosen + spare[: GRID_SEATS - len(chosen)]
    if len(tiles) < GRID_SEATS:
        raise StartError(
            f"{PINK_LIST.name}: {len(chosen)} picks and {len(spare)} placeholders do not fill "
            f"{GRID_SEATS} cells — `python -m builder start --placeholders` draws more"
        )
    return tiles


def _read_links(queries: list[str]) -> list[dict]:
    """Each pick as the explorer's own reader answers it, refused unless canonical."""
    answers = go.read({str(index): query for index, query in enumerate(queries)})
    found = []
    for index, query in enumerate(queries):
        answer = answers[str(index)]
        if not answer.get("ok"):
            raise StartError(f"the explorer refuses {query}: {answer.get('error')}")
        if answer.get("canonical") != query:
            raise StartError(
                f"{PINK_LIST.name} holds a link the explorer spells otherwise; write "
                f"{answer.get('canonical')} for {query}"
            )
        found.append(answer)
    return found


def _link_fields(query: str) -> dict[str, str]:
    return {key: values[0] for key, values in parse_qs(query).items()}


def _link_family(fields: dict[str, str]) -> dict:
    """The family a link names, in the engine's own shape: no `f` is the Mandelbrot set."""
    name = fields.get("f", "mandelbrot")
    if name == "mandelbrot":
        return {"kind": "mandelbrot"}
    for kind in ("julia", "multibrot"):
        if name.startswith(kind):
            family = {"kind": kind, "degree": int(name.removeprefix(kind) or 2)}
            if kind == "julia":
                family["c"] = [fields["cx"], fields["cy"]]
            return family
    raise StartError(f"a pick in family {name!r}, which this figure has no words for")


def _pick_line(index: int, pick: dict, how: str) -> str:
    """One pick as a provenance line: its place in the words `frames` reads, then the link."""
    fields = _link_fields(pick["link"])
    family = _link_family(fields)
    words = family["kind"]
    if "degree" in family:
        words += f" degree {family['degree']}"
    if "c" in family:
        words += f", c = {family['c'][0]} + {family['c'][1]}i"
    shade = "".join(f", {key} {fields[key]}" for key in LINK_SHADE_KEYS if key in fields)
    return (
        f"panel {index}, a pick ({pick['from']}): {words}, centre {fields['x']} + "
        f"{fields['y']}i, width {fields['w']}, mode {fields.get('m', 'smooth')}, "
        + ("colormap" if index == 1 else "palette")
        + f" {fields['p']}{shade}; the link, whole: {pick['link']}; {how}."
    )


#: What a landing writes into `article/figure-recipes.jsonl`: each pick's recipe row, by the
#: kind of row it is, as the last draw left them.
_KEPT: dict[str, dict[str, dict]] = {}


def pink_gallery() -> Split:
    """Twelve cells off `article/pink-gallery.jsonl`: the picks, then placeholder seats."""
    tiles = pink_tiles()
    chosen = [tile for tile in tiles if tile["kind"] == PICK]
    queries = [tile["link"] for tile in chosen]
    answers = dict(zip(queries, _read_links(queries), strict=True))
    seats = [tile["seat"] for tile in tiles if tile["kind"] == PLACEHOLDER]
    resolved = dict(zip(seats, picks_module.resolve(seats), strict=True)) if seats else {}
    size = panels(GRID_COLUMNS)
    catalog = renders.mode_catalog()
    made: list[Made] = []
    lines: list[str] = []
    kept: dict[str, dict[str, dict]] = {recipes.LINK: {}, recipes.DEEP: {}}
    for index, tile in enumerate(tiles, start=1):
        key = f"{PINK}#{index}"
        if tile["kind"] == PLACEHOLDER:
            pick = resolved[tile["seat"]]
            picture = picks_module.panel(pick, f"{PINK}-{index}-{pick.alias}", catalog)
            made.append(
                Made(
                    sheets.save(sheets.fitted(picture, size), panel_path(PINK, index), quiet=True),
                    alt=picks_module.panel_alt(pick),
                    seat=pick.identifier,
                )
            )
            lines.append(
                f"panel {index}, a placeholder: "
                + picks_module.frame_line(pick, representative=index == 1)
            )
            continue
        query = tile["link"]
        if answers[query].get("deep"):
            drawn = deep_figures.draw_link(query, *PINK_RENDER, DEEP_SUPERSAMPLE, f"{PINK}-{index}")
            picture, kind, supersample = drawn.path, recipes.DEEP, DEEP_SUPERSAMPLE
            how = (
                f"cap {drawn.maxiter}; drawn by builder.deep_figures.draw_link, the Deep tab's "
                f"own renderer and shader, at {PINK_RENDER[0]}x{PINK_RENDER[1]} supersample "
                f"{DEEP_SUPERSAMPLE}, {drawn.seconds:.0f} s, and fitted"
            )
        else:
            picture = panel_path(PINK, index).with_name(f"{PINK}-{index}-link.png")
            report = renders.render_link(query, picture, PINK_RENDER, SHALLOW_SUPERSAMPLE)
            kind, supersample = recipes.LINK, SHALLOW_SUPERSAMPLE
            how = (
                f"cap {report['maxiter']} (the depth policy); drawn by `fractal-engine "
                f"render-link` at {PINK_RENDER[0]}x{PINK_RENDER[1]} supersample "
                f"{SHALLOW_SUPERSAMPLE}, and fitted"
            )
        kept[kind][f"{kind}{recipes.SEPARATOR}{key}"] = {
            "link": query,
            "resolution": list(PINK_RENDER),
            "supersample": supersample,
            "maker": f"{__name__}:pink_gallery",
        }
        fields = _link_fields(query)
        family = picks_module.family_name(_link_family(fields))
        mode = picks_module.mode_words(fields.get("m", "smooth"))
        made.append(
            Made(
                sheets.save(sheets.fitted(picture, size), panel_path(PINK, index), quiet=True),
                alt=f"A wallpaper drawn in {mode}, in the {family} family.",
                **{kind: f"{kind}{recipes.SEPARATOR}{key}"},
            )
        )
        lines.append(_pick_line(index, tile, how))
    _KEPT[PINK] = kept
    head = [
        f"builder.start:pink_gallery — {GRID_SEATS} panels at {size[0]}x{size[1]}, "
        f"{GRID_COLUMNS} across, landed one file a panel, filled in order from "
        f"article/{PINK_LIST.name}: every pick the list holds, in its order, then the first "
        "placeholders the cells still need. A pick is an explorer link somebody chose and is "
        "drawn from that link and nothing else, and the link is kept in "
        "article/figure-recipes.jsonl under link|<figure>#<panel> for a shallow one and "
        "deep|<figure>#<panel> for a Deep-tab one. A placeholder is a seat of the magenta "
        "collection drawn from its ledger recipe exactly as builder.picks draws one.",
    ]
    if seats:
        head += [picks_module.autolevel_line(list(resolved.values())), *PINK_DRAW]
    return Split(made, head + lines, GRID_COLUMNS)


def keep(identifier: str) -> None:
    """Write the pink gallery's pick rows into `article/figure-recipes.jsonl`, as it lands."""
    if identifier != PINK:
        return
    kept = _KEPT[PINK]
    recipes.keep_drawn(
        recipes.LINK,
        kept[recipes.LINK],
        "chosen by a person as an explorer link, drawn here by builder.start with "
        "`fractal-engine render-link`: the link is the whole recipe",
        figure=PINK,
    )
    recipes.keep_drawn(
        recipes.DEEP,
        kept[recipes.DEEP],
        "chosen by a person as a Deep-tab link, drawn here by builder.deep_figures: the link "
        "is the whole recipe",
        figure=PINK,
    )


def draw_placeholders() -> list[str]:
    """Draw the placeholder seats once and append them to the list; see `PINK_DRAW`.

    Refuses a list that already holds placeholders, because a second draw would be a
    second answer to a question the list has already recorded.
    """
    listed = pink_list() if PINK_LIST.is_file() else []
    if any(one["kind"] == PLACEHOLDER for one in listed):
        raise StartError(f"{PINK_LIST.name} already holds its placeholders")
    registry = figures_module.load_all()
    others = {key: figure for key, figure in registry.items() if key != PINK}
    taken = set(frames.resolve(others)["places"])
    cited = {
        key
        for figure in others.values()
        for source in figure.sources
        if source.kind == figures_module.GALLERY_SEAT
        for key in source.keys
    }
    for one in listed:
        fields = _link_fields(one["link"])
        taken.add(frames.place(fields["x"], fields["y"], fields["w"]))
    rows = picks_module.seats(MAGENTA_STAMP)
    pool = [
        row
        for key, row in sorted(rows.items())
        if f"{MAGENTA_STAMP}{picks_module.PICK_SEPARATOR}{key}" not in cited
    ]
    random.Random(PLACEHOLDER_SEED).shuffle(pool)
    counts = {name: Counter() for name in PLACEHOLDER_CAPS}
    drawn: list[str] = []
    lines = [f"{len(pool)} magenta seats no other figure cites, shuffled by {PLACEHOLDER_SEED}"]
    for row in pool:
        if len(drawn) == PLACEHOLDERS:
            break
        spot = frames.place_of_location_key(row["location"])
        identifier = f"{MAGENTA_STAMP}{picks_module.PICK_SEPARATOR}{row['key']}"
        if spot in taken:
            lines.append(f"  refused {identifier}: its place is taken")
            continue
        (pick,) = picks_module.resolve([identifier])
        if picks_module.run_stamp(pick).way == picks_module.UNRECOVERABLE:
            lines.append(f"  refused {identifier}: its autolevel curve is not on record")
            continue
        seen = {"mode": pick.mode, "partition": row["partition"]}
        if any(counts[name][seen[name]] >= cap for name, cap in PLACEHOLDER_CAPS.items()):
            lines.append(f"  passed over {identifier}: {seen} is at its cap")
            continue
        for name in PLACEHOLDER_CAPS:
            counts[name][seen[name]] += 1
        taken.add(spot)
        drawn.append(identifier)
        lines.append(f"  took {identifier} ({pick.mode}, {row['partition']})")
    if len(drawn) < PLACEHOLDERS:
        raise StartError(f"only {len(drawn)} magenta seats clear the rejections")
    body = "".join(
        json.dumps({"schema": records.SCHEMA, "kind": PLACEHOLDER, "seat": one}) + "\n"
        for one in drawn
    )
    with PINK_LIST.open("a", encoding="utf-8", newline="\n") as handle:
        handle.write(body)
    return lines


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


def _targets(named=VIDEO_LINKS) -> dict[str, str]:
    """Each short link's explorer query, as the register writes it today."""
    held = {redirect.name: redirect.query for redirect in go.load()}
    # A name of `None` is a blank cell, which opens nothing.
    named = [name for name, _ in named if name is not None]
    missing = [name for name in named if name not in held]
    if missing:
        raise StartError(f"go/redirects.jsonl has no {', '.join(missing)}")
    return {name: held[name] for name in named}


#: The palette keys a link may spell after its map, in the order a provenance line gives them.
LINK_SHADE_KEYS = ("phase", "scale", "lambda", "period", "knee")


def _link_words(query: str) -> str:
    """A link's place and colouring as a provenance line spells them.

    Only what the link says: a mode it leaves out is the contract's first, smooth, and a
    palette key it leaves out is the contract's default and is not written here either.
    """
    fields = {key: values[0] for key, values in parse_qs(query).items()}
    # A link that names no family is the contract's first, the Mandelbrot set.
    family = fields.get("f")
    if not family:
        family = "mandelbrot"
    elif family.startswith("julia"):
        family = (
            f"julia degree {family.removeprefix('julia') or 2}, "
            f"c = {fields['cx']} + {fields['cy']}i"
        )
    else:
        family = f"multibrot degree {family.removeprefix('multibrot')}"
    shade = "".join(f", {key} {fields[key]}" for key in LINK_SHADE_KEYS if key in fields)
    return (
        f"{family}, centre {fields['x']} + {fields['y']}i, width "
        f"{fields['w']}, mode {fields.get('m', 'smooth')}, {{map}} {fields['p']}{shade}"
    )


def video_links() -> Split:
    """The two pictures under the double-descent video, by `linked_pictures`."""
    return linked_pictures(VIDEO, VIDEO_LINKS, "the double-descent player")


def linked_pictures(identifier: str, named, under: str) -> Split:
    """The pictures under a video: its midpoint and its final frame, each linked.

    Each is what the explorer draws on arriving at its short link. The midpoint is a
    shallow link, drawn by `fractal-engine render-link`, which reads the explorer's own
    keys — `scale`, `lambda` and `period` among them — and draws the view the page would.
    The final frame is a deep link, drawn the way the Deep tab draws one, through
    `deep_figures.draw_link`: the video's own fields are coloured by `builder/zoom.py`'s
    power mapping rather than by the tab's shader, so a frame of the video is not the
    picture the link opens.

    A short link named `None` is a blank cell: a picture the video will have and does not
    yet, held open at the panel's size with its label and no link.
    """
    targets = _targets(named)
    size = VIDEO_PANEL
    made: list[Made] = []
    lines = [
        f"builder.start:linked_pictures — {len(named)} panels at {size[0]}x{size[1]}, "
        f"{VIDEO_COLUMNS} across, landed one file a panel under {under}: "
        "each is what the explorer draws on arriving at its short link, whose target this "
        "row's recipe records and `check`'s go holds to go/redirects.jsonl.",
    ]
    first = next(name for name, _ in named if name is not None)
    for index, (name, label) in enumerate(named, start=1):
        if name is None:
            made.append(Made(None, None, label=label, blank=size))
            lines.append(f"{label}: blank, a cell held open with nothing drawn in it and no link.")
            continue
        query = targets[name]
        words = _link_words(query).replace("{map}", "colormap" if name == first else "palette")
        if query.startswith("dv="):
            drawn = deep_figures.draw_link(query, *size, DEEP_SUPERSAMPLE, f"{identifier}-{name}")
            picture = drawn.path
            how = (
                f"cap {drawn.maxiter}; drawn by builder.deep_figures.draw_link — "
                "deep_figures.mjs on the committed perturb.wasm, shaded by "
                f"deep_gallery_shade.mjs through engine.wasm — at {size[0]}x{size[1]} "
                f"supersample {DEEP_SUPERSAMPLE}, {drawn.seconds:.0f} s"
            )
        else:
            picture = panel_path(identifier, index).with_name(f"{identifier}-{name}-link.png")
            report = renders.render_link(query, picture, size, SHALLOW_SUPERSAMPLE)
            how = (
                f"cap {report['maxiter']} "
                f"({'named by the link' if '&n=' in query else 'the depth policy'}); "
                "drawn by `fractal-engine "
                f"render-link` at {size[0]}x{size[1]} supersample {SHALLOW_SUPERSAMPLE}"
            )
        made.append(
            Made(
                sheets.save(
                    sheets.fitted(picture, size), panel_path(identifier, index), quiet=True
                ),
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
SEATED = (GALLERY,)


def sources(identifier: str) -> list[dict]:
    if identifier in (FAMILIES, VIDEO):
        return [{"kind": figures_module.SYNTHETIC, "keys": []}]
    if identifier == PINK:
        # The placeholders the cells draw are seats; a pick has nothing next door behind it.
        tiles = pink_tiles()
        seats = [tile["seat"] for tile in tiles if tile["kind"] == PLACEHOLDER]
        found = [{"kind": figures_module.GALLERY_SEAT, "keys": seats}] if seats else []
        if len(seats) < len(tiles):
            found.append({"kind": figures_module.SYNTHETIC, "keys": []})
        return found
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
    elif identifier == PINK:
        # The list is the one place the picks live; the row names it rather than copying it.
        args = {"list": f"article/{PINK_LIST.name}"}
    else:
        args = {} if identifier in (WALK, FAMILIES) else _args(identifier)
    return {"maker": f"{__name__}:{MAKERS[identifier].__name__}", "args": args}


def draw(identifier: str) -> Split:
    if identifier not in MAKERS:
        raise records.RecordError(f"{identifier} is not drawn by {__name__}")
    return MAKERS[identifier]()
