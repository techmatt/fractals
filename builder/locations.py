"""The makers for the figures on *Finding good locations*.

Every other figure this site ships was composed by a script under `scratch/`, which is
untracked by design and dies with the session that wrote it — the registry keeps prose
`provenance` precisely because the maker does not survive. Section 5's figures are drawn
here instead, inside the package, so a row's `recipe` names something `check` can
resolve and a caption that needs one panel changed is a one-line edit rather than an
archaeology problem.

    python -m builder locations                 # what is drawable, and what it reads
    python -m builder locations locations-foci-proposals
    python -m builder locations locations-foci-proposals --place

Drawing writes a lossless sheet into `artifacts/figures/`; `--place` then imports it,
fills the registry row with the size, the provenance and the recipe, and heals the
page's pending well. The renders behind the panels go through `renders.Cache`, so
adjusting a label or a layout re-renders nothing.

## What the panels are made of

Almost nothing here is a picture somebody chose by hand. A location comes off a record —
a ledger row from the demo neighborhood run, a row of the tracked label store, a release
record of a curation run — and the maker renders it fresh through the engine. The picks
are node ids and file/line pairs, small enough to read in this file, and each figure's
provenance spells the frame out in full so the picture can be drawn again from the
registry alone.

**The one identity rule.** Joining a release or a ledger row to a human label is the
wallpaper project's own question and it answers it in one place
(`supply.location.location_key`); a second answer built here would eventually disagree
about one row in a thousand. So no join happens in this file. What a join decided is
recorded as a pick — the batch file and line a label row sits at, the release key a
wallpaper came from — and this module reads exactly that row.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

from . import records, renders, sheets
from . import theme as theme_module
from .paths import SITE_ROOT
from .theme import (
    REGULAR,
    SECTION_INK,
    SEMIBOLD,
    WELL_INK,
    WELL_INK_DIM,
    WELL_PANEL,
    WELL_RULE,
    font,
    text_width,
)

#: Where a composed sheet lands before `--place` imports it. Under `artifacts/`, which
#: `.gitignore` already keeps out: what ships is the imported JPEG, not this.
SHEETS_DIR = SITE_ROOT / "artifacts" / "figures"

#: The run every walk figure on this page reads. One run, so the numbers a reader adds
#: up across figures are the same run's numbers.
LEDGER = "demo_neighborhood"

#: The walk's own presentation geometry: what the gates read and the judge scored. A
#: panel that claims to show "the frame as the walk saw it" is rendered at exactly this.
NODE_TILE = (384, 216)
NODE_SUPERSAMPLE = 1

#: The house sheet width. Every figure on the page is this wide, so a reader scrolling
#: the section sees one column rather than a ragged edge.
SHEET_WIDTH = 1316


def panels(columns: int, *, width: int = SHEET_WIDTH, aspect: float = 16 / 9) -> tuple[int, int]:
    """The panel size that fills a sheet of this width in this many columns.

    The gutter is `sheets.PAD` on both sides and between, so the arithmetic is the same
    one `sheets.grid_size` runs backwards and a grid built on this fills the sheet — to
    within the remainder of the division, which is why a three-column sheet is 1314 and
    a four-column one 1316. The page scales an image to its column either way.
    """
    panel_width = (width - (columns + 1) * sheets.PAD) // columns
    return panel_width, round(panel_width / aspect)


# ------------------------------------------------------------------------- the records


def ledger(name: str = LEDGER) -> list[dict]:
    """Every row of a walk's ledger, in the order it was written."""
    path = renders.artifact(name, "walk.jsonl")
    if not path.is_file():
        raise renders.EngineError(f"no walk ledger at {path}")
    with path.open(encoding="utf-8") as handle:
        return [json.loads(line) for line in handle if line.strip()]


def nodes(rows: list[dict]) -> dict[int, dict]:
    """Every row that became a node of the forest, keyed by its id.

    Roots and candidates share one id space, which is what makes a chain walkable: a
    candidate names its parent, and the parent is a candidate or the root it grew from.
    """
    found = {}
    for row in rows:
        if row.get("kind") in ("root", "candidate") and row.get("node_id") is not None:
            found[row["node_id"]] = row
    return found


def children(rows: list[dict], node_id: int) -> list[dict]:
    """One node's four proposed children, in the order they were proposed.

    Every proposal is here, not only the survivors: a candidate a gate refused carries
    `node_id: null` — it never became a node — and its fate is what the gate said.
    """
    found = [
        row for row in rows if row.get("kind") == "candidate" and row["parent_node_id"] == node_id
    ]
    return sorted(found, key=lambda row: row.get("child_index", 0))


def location(row: dict) -> dict:
    """The `{family, viewport}` half of a record: what the engine needs to draw it."""
    return {"family": row["family"], "viewport": row["viewport"]}


#: How far a child's width may sit from its parent's, as a fraction. The walk's policy
#: zooms each proposal to between 35% and 50%, and the slack either side is what makes
#: a containment test a *check* rather than a coincidence.
ZOOM_BAND = (0.34, 0.51)

#: The aspect every frame in this project shares, as height over width.
ASPECT = 9 / 16


def _inside(parent: dict, child: dict) -> bool:
    """Whether a child frame is one this parent could have proposed."""
    outer, inner = parent["viewport"], child["viewport"]
    width, narrower = float(outer["width"]), float(inner["width"])
    low, high = ZOOM_BAND
    if not low < narrower / width < high:
        return False
    return (
        abs(float(inner["center_re"]) - float(outer["center_re"])) <= width / 2
        and abs(float(inner["center_im"]) - float(outer["center_im"])) <= width * ASPECT / 2
    )


class Forest:
    """A run's ledger read as the forest of frames it actually was.

    Two of this page's figures follow a walk downwards, and the ledger will not let you
    do that naively: **a reframing does not record the node id it pushes.** An operator
    proposes a frame, the frame is pushed on the frontier, and the row that records the
    proposal names only the node that triggered it. Every child of that pushed frame
    therefore names a parent no row of the ledger carries, and a chain reconstructed by
    following `parent_node_id` stops dead at the first reframing in it.

    The ids are recoverable because they are handed out contiguously from one counter:
    the ids missing from `1..N` are exactly the reframings the run marked used, in the
    order it wrote them. That alone is an ordering argument, so it is not trusted alone.
    Each recovered id is then **confirmed geometrically** — every child that names it
    must fall inside that proposed frame at the policy's own zoom, and no other proposal
    of the run may fit them all — and a recovery that fails the check is dropped rather
    than used. `unconfirmed` counts what was dropped, so a caller can say how much of
    the forest it is walking.
    """

    def __init__(self, rows: list[dict]) -> None:
        self.rows = rows
        self.nodes = nodes(rows)
        self.kids: dict[int, list[dict]] = {}
        for row in rows:
            if row.get("kind") == "candidate":
                self.kids.setdefault(row["parent_node_id"], []).append(row)
        for group in self.kids.values():
            group.sort(key=lambda row: row.get("child_index", 0))
        self.proposals = [row for row in rows if row.get("kind") == "reframing" and row.get("used")]
        self.pushed, self.unconfirmed = self._recover()

    def _recover(self) -> tuple[dict[int, dict], int]:
        total = len(self.nodes) + len(self.proposals)
        free = [number for number in range(1, total + 1) if number not in self.nodes]
        if len(free) != len(self.proposals):
            raise renders.EngineError(
                f"{len(free)} ids are missing from 1..{total} and the run marked "
                f"{len(self.proposals)} reframings used — the ids are not one counter's, "
                "and a chain through a reframing cannot be recovered from this ledger"
            )
        recovered, dropped = {}, 0
        for node_id, row in zip(free, self.proposals, strict=True):
            group = self.kids.get(node_id)
            if not group:
                continue
            fits = [other for other in self.proposals if all(_inside(other, kid) for kid in group)]
            if len(fits) == 1 and fits[0] is row:
                recovered[node_id] = row
            else:
                dropped += 1
        return recovered, dropped

    def frame(self, node_id: int) -> dict | None:
        """The row that holds this id's frame, whether it is a node or a proposal."""
        return self.nodes.get(node_id) or self.pushed.get(node_id)

    def children(self, node_id: int) -> list[dict]:
        """Every candidate proposed inside this frame, refused ones included."""
        return self.kids.get(node_id, [])

    def proposal_id(self, row: dict) -> int | None:
        """The id a recorded reframing's pushed frame was given, where it is recoverable."""
        return next((node_id for node_id, other in self.pushed.items() if other is row), None)

    def chain(self, node_id: int) -> list[dict] | None:
        """Root to this frame, in order, or `None` where a rung cannot be recovered."""
        found = []
        while True:
            row = self.frame(node_id)
            if row is None:
                return None
            found.append(row)
            if row.get("kind") == "root":
                return list(reversed(found))
            node_id = row["parent_node_id"] if row["kind"] == "candidate" else row["node_id"]

    def below(self, node_id: int) -> list[dict]:
        """Every candidate anywhere under this frame, the frame's own children first."""
        found, queue = [], [node_id]
        while queue:
            for kid in self.children(queue.pop()):
                found.append(kid)
                if kid["node_id"] is not None:
                    queue.append(kid["node_id"])
        return found


def label_row(batch: str, line: int) -> dict:
    """One row of the tracked label store, addressed by the file and line it sits at.

    Deliberately positional. The store is append-only tracked data, so a file and a line
    is a stable address, and reading it by position means this module never has to have
    an opinion about what makes two locations the same — see the module docstring.
    """
    path = renders.data_file("data", "labels", "rows", f"{batch}.jsonl")
    with path.open(encoding="utf-8") as handle:
        for index, text in enumerate(handle, start=1):
            if index == line:
                row = json.loads(text)
                row["_batch"], row["_line"] = batch, line
                return row
    raise renders.EngineError(f"{path.name} has no line {line}")


def release_record(run: str, candidate: str) -> dict:
    """One curation run's release record for one candidate, with its picture beside it."""
    for path in sorted((renders.data_file("data", "curation", "release")).rglob("*.jsonl")):
        with path.open(encoding="utf-8") as handle:
            for text in handle:
                if not text.strip():
                    continue
                row = json.loads(text)
                if row.get("run") == run and row.get("candidate") == candidate:
                    row["_picture"] = renders.artifact(
                        "curation/runs", run, row["picture"].replace("\\", "/")
                    )
                    return row
    raise renders.EngineError(f"no release record for {run}|{candidate}")


# -------------------------------------------------------------------------- the renders


def cache() -> renders.Cache:
    return renders.Cache()


def panel(name: str, row: dict, size: tuple[int, int], **extra) -> Path:
    """One location, rendered at panel size in the neutral map every figure here uses."""
    return cache().render(name, dict(location(row), **extra), size).path


def node_panel(name: str, row: dict) -> Path:
    """One location at the walk's own geometry: the picture the judge was shown.

    384x216 at one sample per pixel is not a pretty render and is not meant to be. It is
    what the gates measured and what the judge scored, so a figure making a claim about
    a verdict shows the frame the verdict was passed on.
    """
    return cache().render(name, location(row), NODE_TILE, supersample=NODE_SUPERSAMPLE).path


# ------------------------------------------------------------------------- the lettering


def stack(draw, x: int, y: int, lines, *, size: int = 15, lead=WELL_INK) -> None:
    """A note beside a picture: first line leading, the rest a rank quieter, ranged left.

    Not the label under a tile — that is `under`, which centres and owns its own size.
    """
    sheets.label(draw, x, y, lines, size=size, lead=lead)


def under(draw, origin, tile, lines, *, lead=WELL_INK, inks=None) -> None:
    """The label under one tile, by the site's one rule for them. No size to pass."""
    sheets.tile_label(draw, origin, tile, lines, SHEET_WIDTH, lead=lead, inks=inks)


def band(tile_height: int, lines: int = 1) -> int:
    """The room that label needs, for the arithmetic that lays a sheet out around it."""
    return sheets.caption_band(tile_height, SHEET_WIDTH, lines)


def rule(draw, y: int, *, width: int = SHEET_WIDTH, inset: int = sheets.PAD) -> None:
    """The hairline that separates one block of a sheet from the next."""
    draw.line([inset, y, width - inset, y], fill=WELL_RULE, width=1)


def heading(draw, x: int, y: int, text: str, *, size: int = 16) -> None:
    """The name of a block within a sheet, in the quiet rank a section name gets."""
    draw.text((x, y), text, fill=SECTION_INK, font=font(size))


def centred(draw, x: int, y: int, width: int, text: str, *, size: int = 15, fill=WELL_INK_DIM):
    face = font(size)
    draw.text((x + (width - text_width(draw, text, face)) / 2, y), text, fill=fill, font=face)


def chip(draw, x: int, y: int, text: str, *, size: int = 14, ink=WELL_INK) -> int:
    """A boxed word — a verdict, a rating — that has to read as a stamp and not a caption."""
    face = font(size)
    pad = 6
    width = round(text_width(draw, text, face)) + 2 * pad
    draw.rounded_rectangle(
        [x, y, x + width, y + size + 9], radius=4, fill=WELL_PANEL, outline=WELL_RULE, width=1
    )
    draw.text((x + pad, y + 4), text, fill=ink, font=face)
    return width


# --------------------------------------------------------------------------- the outputs


@dataclass(frozen=True)
class Drawn:
    """A composed sheet, and the lines that say how each of its panels was made."""

    path: Path
    provenance: list[str]


def sheet_path(identifier: str) -> Path:
    SHEETS_DIR.mkdir(parents=True, exist_ok=True)
    return SHEETS_DIR / f"{identifier}.png"


def frame_box(inner: dict, outer: dict, box: tuple[int, int, int, int]) -> tuple[float, ...]:
    """Where one frame's rectangle lands inside a panel showing another frame.

    Both are `{center_re, center_im, width}` and both carry the project's fixed aspect,
    so the inner rectangle's height follows from its width the same way the panel's
    does. This is what draws a proposal on top of the parent it was proposed inside.
    """
    left, top, right, bottom = box
    aspect = (bottom - top) / (right - left)
    outer_width = float(outer["width"])
    centre = (float(outer["center_re"]), float(outer["center_im"]))
    half = float(inner["width"]) / 2
    corners = [
        (float(inner["center_re"]) - half, float(inner["center_im"]) + half * aspect),
        (float(inner["center_re"]) + half, float(inner["center_im"]) - half * aspect),
    ]
    (x0, y0), (x1, y1) = (
        sheets.plane_point(corner, box, centre, outer_width) for corner in corners
    )
    return x0, y0, x1, y1


def outline(draw, box, colour, *, width: int = 2) -> None:
    """A rectangle drawn dark-under-light, so it survives whatever is beneath it."""
    x0, y0, x1, y1 = box
    draw.rectangle([x0 - 1, y0 - 1, x1 + 1, y1 + 1], outline=(0, 0, 0), width=width + 1)
    draw.rectangle([x0, y0, x1, y1], outline=colour, width=width)


# ---------------------------------------------------------------------- foci proposals

#: The expansion the foci figure is drawn from, out of the run's 1,813 with a full set of
#: kept foci and four proposed children. Three things a reader has to be able to see
#: picked it. Its six kept foci are spread across the frame rather than crowded into one
#: feature; its four children are four visibly different pictures; and all four of its
#: proposals lie **wholly inside** the parent, which only 318 of the 1,813 do — the
#: placement rules put a child's centre in the parent and let the frame itself run over
#: the edge, and a box hanging off the corner of the picture would read as a drawing
#: error rather than as the rule it is.
FOCI_NODE = 2804

#: One colour per proposed child, in the order the run proposed them. A child aimed at a
#: focus rings that focus in its own colour and its label names the colour, which is the
#: whole join between the small panel at the foot and the mark in the picture above it.
#: Named the way a reader would say them, because the label says the name out loud.
CHILD_INKS = (
    ("red", (231, 76, 60)),
    ("yellow", (247, 196, 63)),
    ("green", (88, 196, 122)),
    ("pink", (240, 122, 197)),
)

#: Room left under the bottom row for the mark that opens the picture in the explorer.
#:
#: That mark is CSS's — a rounded square in the picture's own bottom-right corner — and a
#: sheet whose last label runs the full width of its tile has the mark land on the label's
#: last word. Every other figure on this page ends in a label short enough to sit clear of
#: it; this one's does not, and moving the mark is a stylesheet change that would move it
#: on forty pictures. So the sheet leaves the corner empty instead. Sized against the
#: figure at the reading column's own width, where the mark is about 34 CSS pixels tall on
#: a sheet drawn at 1316 and shown at about 840.
MARK_CLEARANCE = 60

#: A focus no child was aimed at. Still marked — the figure's claim is that the blurring
#: keeps several and the proposal rule spends only some of them — and marked quietly, so
#: that the coloured rings stay the ones a label can point at.
SPARE_FOCUS = (236, 236, 236)


def foci_proposals() -> Drawn:
    """The parent frame with its kept foci marked, and the four children it proposed.

    Two blocks and one line of lettering. The figure used to carry a table of focus
    scores, a caption naming the node, and three lines under every child saying which
    placement rule ran and what the judge made of it — a ledger printed where a reader
    looks first. What the reader needs is the join between a box in the parent and a
    picture at the foot, so each proposal has a colour of its own, the focus it was
    aimed at is ringed in that colour, and the one label says the colour out loud.
    """
    rows = ledger()
    parent = nodes(rows)[FOCI_NODE]
    foci = next(
        row for row in rows if row.get("kind") == "foci" and row.get("node_id") == FOCI_NODE
    )
    kept = foci["kept"]
    proposed = children(rows, FOCI_NODE)
    aimed = _aimed_at(kept, proposed)

    big = (SHEET_WIDTH - 2 * sheets.PAD, round((SHEET_WIDTH - 2 * sheets.PAD) * 9 / 16))
    small = panels(4)
    parent_render = panel("foci-parent", parent, big)
    child_renders = [
        (child, panel(f"foci-child-{index}", child, small)) for index, child in enumerate(proposed)
    ]

    top = sheets.PAD
    kids_top = top + big[1] + sheets.PAD
    height = kids_top + small[1] + band(small[1], 1) + sheets.PAD + MARK_CLEARANCE
    sheet, draw = sheets.canvas(SHEET_WIDTH, height)

    box = (0, 0, big[0], big[1])
    marked, over = _overlay(big)
    for index, child in enumerate(proposed):
        outline(
            over,
            frame_box(child["viewport"], parent["viewport"], box),
            CHILD_INKS[index][1],
            width=3,
        )
    for index, focus in enumerate(kept):
        colour = CHILD_INKS[aimed[index]][1] if index in aimed else SPARE_FOCUS
        x = (focus["x"] + 0.5) / NODE_TILE[0] * big[0]
        y = (focus["y"] + 0.5) / NODE_TILE[1] * big[1]
        _ring(over, x, y, colour)
    _paste_marked(sheet, sheets.fitted(parent_render, big), marked, (sheets.PAD, top))

    for index, (child, render) in enumerate(child_renders):
        x = sheets.PAD + index * (small[0] + sheets.PAD)
        sheet.paste(sheets.fitted(render, small), (x, kids_top))
        draw.rectangle(
            [x, kids_top, x + small[0] - 1, kids_top + small[1] - 1],
            outline=CHILD_INKS[index][1],
            width=3,
        )
        under(draw, (x, kids_top), small, [_child_label(index, child, aimed)])

    destination = sheets.save(sheet, sheet_path("locations-foci-proposals"))
    return Drawn(destination, _foci_provenance(parent, foci, proposed, aimed, big, small))


def _aimed_at(kept: list[dict], proposed: list[dict]) -> dict[int, int]:
    """Which kept focus each foci-branch child was pointed at: focus index to child index.

    Read off the child's own `focus_score`, which is the peak strength the placement rule
    recorded when it chose one — the ledger writes no other join between the two.
    """
    found: dict[int, int] = {}
    for child_index, child in enumerate(proposed):
        if child.get("branch") != "foci":
            continue
        for focus_index, focus in enumerate(kept):
            if child.get("focus_score") == focus["score"] and focus_index not in found:
                found[focus_index] = child_index
                break
    return found


def _ring(draw, x: float, y: float, colour, *, radius: int = 13) -> None:
    """A focus marked on the parent, dark-under-light like every other mark on a sheet."""
    draw.ellipse(
        [x - radius - 1, y - radius - 1, x + radius + 1, y + radius + 1],
        outline=(0, 0, 0),
        width=4,
    )
    draw.ellipse([x - radius, y - radius, x + radius, y + radius], outline=colour, width=3)


def _child_label(index: int, child: dict, aimed: dict[int, int]) -> str:
    """The one line under a child: what it was aimed at, in the colour it is ringed in."""
    if child["branch"] == "foci":
        colour = next(
            (CHILD_INKS[value][0] for value in aimed.values() if value == index),
            None,
        )
        aim = f"aimed at {colour} focus" if colour else "aimed at a focus"
    else:
        aim = {"random": "placed at random", "density": "toward detail density"}[child["branch"]]
    return f"Child {index + 1}{sheets.MIDDOT}{aim}"


def _overlay(size: tuple[int, int]):
    """A transparent layer the size of a panel, and something to draw marks on it with.

    Marks belong *to* the panel, so they are drawn on a layer of its size and clipped by
    it: a proposal that runs off the parent's edge stops at the edge rather than spilling
    onto the sheet, and a focus on the top row of the tile does not put half a
    ring in the margin above the picture.
    """
    from PIL import Image, ImageDraw

    layer = Image.new("RGBA", size, (0, 0, 0, 0))
    return layer, ImageDraw.Draw(layer)


def _paste_marked(sheet, picture, layer, origin: tuple[int, int]) -> None:
    """One panel with its marks composited on, pasted onto the sheet."""
    picture = picture.convert("RGBA")
    picture.alpha_composite(layer)
    sheet.paste(picture.convert("RGB"), origin)


def _tag(draw, x: float, y: float, text: str, colour) -> None:
    """A number on a marked box, dark-under-light like the box itself."""
    face = font(15)
    for offset, ink in (((1, 1), (0, 0, 0)), ((0, 0), colour)):
        draw.text((x + offset[0], y + offset[1]), text, fill=ink, font=face)


def _family_name(family: dict) -> str:
    """A family as the article names it, not as a record spells it."""
    kind = family.get("kind")
    if kind == "multibrot":
        return f"multibrot d = {family.get('degree')}"
    if kind == "julia":
        return f"Julia d = {family.get('degree')}"
    return {"mandelbrot": "Mandelbrot", "phoenix": "Phoenix"}.get(kind, str(kind))


def _foci_provenance(parent, foci, proposed, aimed, big, small) -> list[str]:
    marks = ", ".join(
        f"({focus['x']:.0f},{focus['y']:.0f}) "
        + (CHILD_INKS[aimed[index]][0] if index in aimed else "unaimed")
        for index, focus in enumerate(foci["kept"])
    )
    lines = [
        f"Ledger {LEDGER}/walk.jsonl, seed 11. All panels {_family_name(parent['family'])}, "
        f"mode smooth, colormap {renders.COLORMAP}, cap from the depth-aware policy, "
        "no crop; the engine chooses maxiter, so it is recorded per panel below.",
        f"parent: node {parent['node_id']} (root, depth {parent.get('depth', 0)}), centre "
        f"{parent['viewport']['center_re']} + {parent['viewport']['center_im']}i, width "
        f"{parent['viewport']['width']}, {big[0]}x{big[1]} at supersample 3, "
        f"maxiter {parent.get('maxiter')}. Rings mark the {len(foci['kept'])} foci the run "
        f"kept of {foci['found']} peaks found, at tile coordinates {marks} on a "
        f"{NODE_TILE[0]}x{NODE_TILE[1]} tile; boxes are the four proposals below, each in "
        "its own colour.",
    ]
    for index, child in enumerate(proposed):
        lines.append(
            f"child {index + 1} ({CHILD_INKS[index][0]}): branch {child['branch']}, placement "
            f"{child['placement']}, centre {child['viewport']['center_re']} + "
            f"{child['viewport']['center_im']}i, width {child['viewport']['width']}, "
            f"{small[0]}x{small[1]} at supersample 3, maxiter {child['maxiter']}, fate "
            f"{child['fate']}, judge P(>=3) {child['score']:.6f} under head "
            f"{child['scorer']}."
        )
    return lines


# --------------------------------------------------------------------- the reframings

#: How the article names each operator, and the sentence its row of the figure is about.
OPERATORS = {
    "snap_to_nucleus": "recenters exactly, on a nucleus already inside the frame",
    "lateral_to_sibling": "steps sideways, to a neighbour at comparable scale",
    "expand_neighborhood": "widens the net, sweeping the surrounding disc",
}

#: One firing per operator, in the order the prose introduces them. Picked from the
#: firings the ledger records with a frame on both sides, for the clearest reading of
#: what each operator *does*: the snap and the lateral keep the parent's own width, so
#: the pair is a pure recomposition; the neighborhood one takes 16x a copy thirty times
#: smaller than the frame it was spotted from, which is the case for the operator
#: existing at all.
REFRAMINGS = (
    ("snap_to_nucleus", 6957, None),
    ("lateral_to_sibling", 8958, None),
    ("expand_neighborhood", 728, 16.0),
)

#: The node the bottom strip is about: one frame all three operators fired on, and the
#: only one of the 67 such nodes whose three answers are all at a scale the same strip
#: can show. Its three children were pushed to the frontier and never popped — the run
#: ended first — so the frames are the proposals themselves, drawn here after the fact.
THREE_WAYS = 5700

#: How a framing is said in words. `None` is not "no framing": it is the rung of the
#: ladder that keeps whatever width the triggering frame had.
FRAMINGS = {
    None: "the parent's own width",
    4.0: "4\u00d7 the copy's own size",
    16.0: "16\u00d7 the copy's own size",
}


def reframing(rows: list[dict], node_id: int, operator: str, framing: float | None) -> dict:
    """The one row where this operator fired on this node at this rung of the ladder."""
    for row in rows:
        if (
            row.get("kind") == "reframing"
            and row.get("node_id") == node_id
            and row.get("operator") == operator
            and row.get("framing") == framing
            and row.get("used")
        ):
            return row
    raise renders.EngineError(f"no used {operator} on node {node_id} at framing {framing}")


def as_location(family: dict, row: dict) -> dict:
    """A reframing's proposal as a location: the frame it pushed, in its trigger's family.

    A reframing row records the frame and not the family, because the operator cannot
    change it — a nucleus of the plane the trigger was drawn on is on that same plane.
    """
    return {"family": family, "viewport": row["viewport"]}


def reframe_examples() -> Drawn:
    """One firing per operator, what it led to, and one frame reframed three ways.

    Three columns rather than two, because two would say something false. A reframed
    frame is a *proposal*, not a find: two of these three score lower than the frame
    that triggered them, since the first rung of the ladder puts a black copy in the
    middle of the picture. What the operator is worth shows up one column later, in the
    best frame the walk admitted underneath it.
    """
    forest = Forest(ledger())
    rows = forest.rows
    picks = []
    for operator, node_id, framing in REFRAMINGS:
        row = reframing(rows, node_id, operator, framing)
        pushed = forest.proposal_id(row)
        below = [kid for kid in forest.below(pushed) if kid.get("fate") == "survived"]
        picks.append((operator, forest.nodes[node_id], row, max(below, key=_score)))
    trigger = forest.nodes[THREE_WAYS]
    three = [
        (operator, reframing(rows, THREE_WAYS, operator, framing))
        for operator, framing in _three_way_framings(rows)
    ]

    wanted = []
    for _operator, node, row, found in picks:
        wanted += [location(node), as_location(node["family"], row), location(found)]
    wanted += [location(trigger)]
    wanted += [as_location(trigger["family"], row) for _, row in three]
    judged = renders.scores(wanted)
    head = judged[0]

    big = panels(3)
    small = panels(4)
    row_height = 24 + big[1] + band(big[1], 1) + sheets.PAD + 8
    strip_top = sheets.PAD + 3 * row_height + 6
    height = strip_top + 26 + small[1] + band(small[1], 1) + sheets.PAD
    sheet, draw = sheets.canvas(SHEET_WIDTH, height)

    for index, (operator, node, row, found) in enumerate(picks):
        y = sheets.PAD + index * row_height
        if index:
            rule(draw, y - 14)
        heading(draw, sheets.PAD, y, operator, size=15)
        cells = (
            (panel(f"reframe-{operator}-before", node, big), "The frame that triggered it"),
            (
                cache()
                .render(f"reframe-{operator}-after", as_location(node["family"], row), big)
                .path,
                "What the operator proposed",
            ),
            (
                panel(f"reframe-{operator}-found", found, big),
                "The best frame admitted below it",
            ),
        )
        for column, (picture, label) in enumerate(cells):
            x = sheets.PAD + column * (big[0] + sheets.PAD)
            sheet.paste(sheets.fitted(picture, big), (x, y + 24))
            under(draw, (x, y + 24), big, [label])

    rule(draw, strip_top - 12)
    heading(draw, sheets.PAD, strip_top, "One frame, all three operators")
    strip = [(location(trigger), "The triggering frame")]
    for _offset, (operator, row) in enumerate(three):
        strip.append((as_location(trigger["family"], row), operator))
    for index, (spec, label) in enumerate(strip):
        x = sheets.PAD + index * (small[0] + sheets.PAD)
        y = strip_top + 26
        picture = cache().render(f"reframe-three-{index}", spec, small).path
        sheet.paste(sheets.fitted(picture, small), (x, y))
        under(draw, (x, y), small, [label])

    destination = sheets.save(sheet, sheet_path("locations-reframe-examples"))
    return Drawn(destination, _reframe_provenance(picks, trigger, three, big, small, head, forest))


def _score(row: dict) -> float:
    return row.get("score") or 0.0


def _three_way_framings(rows: list[dict]) -> list[tuple[str, float | None]]:
    """Which rung of the ladder each operator took on the three-ways node.

    Read off the ledger rather than written down, because the framing is the operator's
    own verdict — a shallow atom takes the 4x frame and refuses the 16x one — and a
    figure that hardcoded it would keep printing the old answer after a re-run.
    """
    found = []
    for operator in OPERATORS:
        row = next(
            other
            for other in rows
            if other.get("kind") == "reframing"
            and other.get("node_id") == THREE_WAYS
            and other.get("operator") == operator
            and other.get("used")
        )
        found.append((operator, row["framing"]))
    return found


def _reframe_provenance(picks, trigger, three, big, small, head, forest) -> list[str]:
    lines = [
        f"Ledger {LEDGER}/walk.jsonl, seed 11, mode smooth, colormap {renders.COLORMAP}, "
        "supersample 3, cap from the depth-aware policy, no crop. Every judge score "
        f"printed is P(>=3) read after the fact at regime {head['regime']} through head "
        f"{head['head']} sha256 {head['head_sha256']} — the head the run itself "
        "scored with, so the triggering frames reproduce their ledger scores exactly. "
        "The third column is reached through a reframing, whose pushed node id the "
        f"ledger does not record: {len(forest.pushed)} of the run's "
        f"{len(forest.proposals)} used reframings were recovered from the id counter "
        "and confirmed geometrically (see builder.locations.Forest); "
        f"{forest.unconfirmed} recoveries failed the check and were dropped.",
    ]
    for operator, node, row, found in picks:
        lines.append(
            f"{operator}, before: node {node['node_id']} ({_family_name(node['family'])}), "
            f"centre {node['viewport']['center_re']} + {node['viewport']['center_im']}i, "
            f"width {node['viewport']['width']}, {big[0]}x{big[1]}."
        )
        lines.append(
            f"{operator}, after: the frame it pushed — atom {row['atom_key']} of period "
            f"{row['period']} at framing {row['framing']}, centre "
            f"{row['viewport']['center_re']} + {row['viewport']['center_im']}i, width "
            f"{row['viewport']['width']}, {big[0]}x{big[1]}."
        )
        lines.append(
            f"{operator}, found: node {found['node_id']} at depth {found['depth']}, the "
            f"highest-scoring frame the run admitted anywhere below that proposal, centre "
            f"{found['viewport']['center_re']} + {found['viewport']['center_im']}i, width "
            f"{found['viewport']['width']}, {big[0]}x{big[1]}."
        )
    lines.append(
        f"three ways, trigger: node {trigger['node_id']} "
        f"({_family_name(trigger['family'])}), centre {trigger['viewport']['center_re']} + "
        f"{trigger['viewport']['center_im']}i, width {trigger['viewport']['width']}, "
        f"{small[0]}x{small[1]}."
    )
    for operator, row in three:
        lines.append(
            f"three ways, {operator}: atom {row['atom_key']} of period {row['period']} at "
            f"framing {row['framing']}, centre {row['viewport']['center_re']} + "
            f"{row['viewport']['center_im']}i, width {row['viewport']['width']}, "
            f"{small[0]}x{small[1]}. Pushed to the frontier and never popped; drawn here "
            "after the fact from the proposal the ledger recorded."
        )
    return lines


# -------------------------------------------------------------------- the framing ladder

#: The nucleus the ladder is drawn at: one `snap_to_nucleus` firing that came back
#: available at all three rungs off a single Newton solve. Picked for its proportions —
#: the copy is about a twelfth of the frame it was spotted in, so the parent's own width
#: shows it as a speck, 16x gives it a third of the frame, and 4x fills the frame with
#: the halo. A copy much smaller than that makes the first rung an empty picture.
LADDER_NODE = 4214


def framing_ladder() -> Drawn:
    """One minibrot nucleus at each rung of the ladder, with what each rung costs."""
    rows = ledger()
    trigger = nodes(rows)[LADDER_NODE]
    rungs = [
        (framing, reframing(rows, LADDER_NODE, "snap_to_nucleus", framing)) for framing in FRAMINGS
    ]
    window = rungs[0][1]["window_scale"]
    parent_width = float(trigger["viewport"]["width"])

    wanted = [as_location(trigger["family"], row) for _, row in rungs]
    judged = renders.scores(wanted)

    size = panels(3)
    height = sheets.PAD + 26 + size[1] + band(size[1], 3) + sheets.PAD
    sheet, draw = sheets.canvas(SHEET_WIDTH, height)
    heading(
        draw,
        sheets.PAD,
        sheets.PAD,
        f"One minibrot found in a {_family_name(trigger['family'])} walk"
        f"{sheets.MIDDOT}the copy's own size is {sheets.width_text(window)}, "
        f"the frame it was spotted in {sheets.width_text(parent_width)}",
    )
    for index, (framing, row) in enumerate(rungs):
        x = sheets.PAD + index * (size[0] + sheets.PAD)
        y = sheets.PAD + 26
        picture = cache().render(f"ladder-{framing}", as_location(trigger["family"], row), size)
        sheet.paste(sheets.fitted(picture.path, size), (x, y))
        width = float(row["viewport"]["width"])
        under(
            draw,
            (x, y),
            size,
            [
                FRAMINGS[framing],
                f"width {sheets.width_text(width)}{sheets.MIDDOT}"
                + (
                    f"{width / window:.0f}× the copy"
                    if framing
                    else f"{width / window:.0f}× the copy, unchanged from the parent"
                ),
            ],
        )
    destination = sheets.save(sheet, sheet_path("locations-framing-ladder"))
    return Drawn(destination, _ladder_provenance(trigger, rungs, size, judged))


def _ladder_provenance(trigger, rungs, size, judged) -> list[str]:
    row = rungs[0][1]
    lines = [
        f"Ledger {LEDGER}/walk.jsonl, seed 11. All three panels are the same nucleus — "
        f"atom {row['atom_key']}, period {row['period']}, |A| giving a window scale of "
        f"{row['window_scale']} — solved by snap_to_nucleus on node {trigger['node_id']} "
        f"({_family_name(trigger['family'])}, centre {trigger['viewport']['center_re']} + "
        f"{trigger['viewport']['center_im']}i, width {trigger['viewport']['width']}). "
        f"Every panel {size[0]}x{size[1]}, supersample 3, mode smooth, colormap "
        f"{renders.COLORMAP}, cap from the depth-aware policy, no crop. Judge scores are "
        f"P(>=3) at regime {judged[0]['regime']} through head {judged[0]['head']} sha256 "
        f"{judged[0]['head_sha256']}.",
    ]
    for (framing, entry), score in zip(rungs, judged, strict=True):
        lines.append(
            f"framing {framing}: centre {entry['viewport']['center_re']} + "
            f"{entry['viewport']['center_im']}i, width {entry['viewport']['width']}, "
            f"maxiter {score['maxiter']} at the scoring regime, P(>=3) {score['score']:.6f}."
        )
    return lines


# ---------------------------------------------------------------------- the descent chain

#: The admitted frame the chain ends on. Its whole line back to the root is in the
#: ledger, and the root is a location a human rated 4 — which is what put it in the
#: proven channel this run drew its roots from.
CHAIN_TIP = 4691

#: Where that root's own rating is recorded, as a file and a line of the label store.
CHAIN_ROOT_LABEL = ("correction_page", 285)


def descent_chain() -> Drawn:
    """Every frame of one seeded descent, root to admitted find, in order."""
    forest = Forest(ledger())
    chain = forest.chain(CHAIN_TIP)
    if chain is None:
        raise renders.EngineError(f"node {CHAIN_TIP} has a rung this ledger cannot recover")
    root = chain[0]
    rated = label_row(*CHAIN_ROOT_LABEL)
    if rated["viewport"] != root["viewport"] or rated["family"] != root["family"]:
        raise renders.EngineError(
            f"{CHAIN_ROOT_LABEL[0]}.jsonl line {CHAIN_ROOT_LABEL[1]} is not the frame root "
            f"{root['root_id']} was placed at — the chain's first claim would be false"
        )

    wanted = [_chain_location(root, entry) for entry in chain]
    judged = renders.scores(wanted)

    size = panels(3)
    columns = 3
    rows_down = (len(chain) + columns - 1) // columns
    cell = 26 + size[1] + band(size[1], 3)
    height = sheets.PAD + rows_down * (cell + sheets.PAD) + sheets.PAD
    sheet, draw = sheets.canvas(SHEET_WIDTH, height)
    for index, entry in enumerate(chain):
        row, column = divmod(index, columns)
        x = sheets.PAD + column * (size[0] + sheets.PAD)
        y = sheets.PAD + row * (cell + sheets.PAD)
        heading(draw, x, y, f"{index + 1} of {len(chain)}{sheets.MIDDOT}{_rung(entry)}", size=15)
        picture = cache().render(f"chain-{index}", _chain_location(root, entry), size)
        sheet.paste(sheets.fitted(picture.path, size), (x, y + 26))
        under(draw, (x, y + 26), size, _chain_lines(entry, rated))
    destination = sheets.save(sheet, sheet_path("locations-descent-chain"))
    return Drawn(destination, _chain_provenance(root, chain, judged, rated, size))


def _chain_location(root: dict, entry: dict) -> dict:
    """A rung as a location: a reframing carries no family, so the root's is used."""
    if entry["kind"] == "reframing":
        return as_location(root["family"], entry)
    return location(entry)


def _rung(entry: dict) -> str:
    """What kind of step this rung was."""
    if entry["kind"] == "root":
        return "the root"
    if entry["kind"] == "reframing":
        return entry["operator"]
    return {
        "foci": "zoom onto a focus",
        "random": "zoom, placed at random",
        "density": "zoom toward detail density",
    }[entry["branch"]]


def _chain_lines(entry: dict, rated: dict) -> list[str]:
    """The lines under one rung: what the step was, and how wide the frame it reached."""
    if entry["kind"] == "root":
        return [
            f"Rated {rated['score']} by hand",
            f"width {sheets.width_text(entry['viewport']['width'])}",
            "the proven channel: a root per rated keeper",
        ]
    if entry["kind"] == "reframing":
        return [
            FRAMINGS[entry["framing"]],
            f"width {sheets.width_text(entry['viewport']['width'])}",
        ]
    fate = {"survived": "admitted", "expandable": "expandable"}.get(entry["fate"], entry["fate"])
    return [
        fate,
        f"width {sheets.width_text(entry['viewport']['width'])}",
    ]


def _chain_provenance(root, chain, judged, rated, size) -> list[str]:
    lines = [
        f"Ledger {LEDGER}/walk.jsonl, seed 11, root {root['root_id']} of the proven "
        f"channel (seed {root['provenance']['seed_id']}). Every panel "
        f"{_family_name(root['family'])}, {size[0]}x{size[1]}, supersample 3, mode smooth, "
        f"colormap {renders.COLORMAP}, cap from the depth-aware policy, no crop. Rung 4 is "
        "a reframing, whose pushed node id the ledger does not record; it was recovered "
        "and geometrically confirmed (see builder.locations.Forest). Judge scores on the "
        f"walk's own rungs are the ledger's; the reframing's is P(>=3) read after the fact "
        f"at regime {judged[0]['regime']} through head {judged[0]['head']} sha256 "
        f"{judged[0]['head_sha256']}, the head the run scored with.",
        f"rung 1, the root: the location recorded at data/labels/rows/"
        f"{CHAIN_ROOT_LABEL[0]}.jsonl line {CHAIN_ROOT_LABEL[1]}, scored {rated['score']} by "
        f"{rated['labeler']} on {rated['recorded_at']}; centre "
        f"{root['viewport']['center_re']} + {root['viewport']['center_im']}i, width "
        f"{root['viewport']['width']}.",
    ]
    for index, entry in enumerate(chain[1:], start=2):
        where = (
            f"reframing by {entry['operator']} at framing {entry['framing']}, atom "
            f"{entry['atom_key']} of period {entry['period']}"
            if entry["kind"] == "reframing"
            else f"node {entry['node_id']} at depth {entry['depth']}, branch "
            f"{entry['branch']}, placement {entry['placement']}, fate {entry['fate']}, "
            f"ledger score {entry['score']:.6f}"
        )
        lines.append(
            f"rung {index}: {where}; centre {entry['viewport']['center_re']} + "
            f"{entry['viewport']['center_im']}i, width {entry['viewport']['width']}."
        )
    return lines


# ------------------------------------------------------------------------ the label store

#: The spectrum, most open to busiest, as picks into the two **finished-render** label
#: stores — a store, a batch file and a line each. A row there is a picture rather than a
#: place: it carries the family, the frame, the mode with its settings, the curve, the map
#: and every knob of the palette pass, so a pick is a whole wallpaper and not a location
#: somebody has to choose a coloring for. All six are Matt's own 4s, the top of that
#: scale, drawn from a pool of 836.
#:
#: Chosen for six different partitions — all four families, both planes — and five
#: different rendering modes, and ordered on how much of the frame carries detail: mean
#: edge magnitude of the luminance at 512×288, over the pictures the judges' corpora
#: already hold. The order is a measurement because the axis
#: is the figure's whole subject; what the measurement does *not* decide, and the caption
#: says so, is which of the six belongs on a desktop.
SPECTRUM = (
    ("smooth_render", "fresh_pool_draw", 313),
    ("strange_render", "rare_palette", 508),
    ("strange_render", "threads_promotion", 24),
    ("strange_render", "rare_palette", 502),
    ("strange_render", "rare_palette", 513),
    ("strange_render", "mode_correction", 1024),
)

#: The verdict every pick has to carry. Asserted rather than trusted: four of these six
#: were re-rated upward on 2026-08-18 and the addresses that read 3 are still in the file,
#: so a pick is one edit away from captioning a picture with a score nobody holds.
SPECTRUM_SCORE = 4

#: What the edge measure read on each pick, in the same order — kept so the ordering can
#: be checked without the archive disk the corpora live on.
SPECTRUM_DENSITY = (0.032, 0.067, 0.087, 0.111, 0.152, 0.194)

#: Three examples per rung of the four-point scale, all rated by hand, spread across
#: families so no row reads as being about one fractal.
#:
#: Rung 1 runs empty, plain, formless — the three ways the rung's own wording says a
#: frame is junk — and its third panel is a location whose detail is finer than the
#: pixels it is drawn at, which reads as noise rather than as geometry. Rung 4 is held
#: to being *geometrically* diverse as well: a rosette, a lace of ribbons and a field of
#: beaded scrolls, in three different families, because three spirals side by side teach
#: a reader that exceptional means spiral (Matt, 2026-09-02).
RATED = {
    1: (
        ("minibrot_roster", 268),
        ("parameter_space_uniform", 132),
        ("julia_parameter_ladder", 840),
    ),
    2: (
        ("guided_descent_rev4_refiltered", 814),
        ("screened_queue_v2", 404),
        ("minibrot_roster", 451),
    ),
    3: (("screened_queue_v2", 917), ("twin_top_slices", 87), ("plane_deep_admissions", 21)),
    4: (
        ("julia_multibrot45_score_band", 18),
        ("twin_top_slices", 74),
        ("phoenix_parameter_grid", 296),
    ),
}

#: What each rung of the scale is for, in the labeler's own terms.
RUNGS = {
    1: "junk — too empty, too plain, or too formless to use",
    2: "something is happening, but it does not hold the frame",
    3: "a keeper: worth rendering properly and coloring",
    4: "exceptional — wallpaper material as it stands",
}

#: The site's rating palette, from `theme.py`. Not restated here: the page that teaches
#: the four-point scale and the page that evaluates a judge against it have to colour a
#: 3 the same way, or the second one is teaching a different scale.
RUNG_INK = theme_module.RATING_INK


#: How big the step numeral on a panel is, and how far in from its corner it sits.
STEP_NUMERAL = 22
STEP_INSET = 10

#: What a spectrum panel is rendered at before it is fitted into its cell. Three times
#: the cell's width and three samples per pixel per axis: a wallpaper's fine texture is
#: most of what makes it read as busy, and a render made at cell size never has it to
#: lose. Nothing here needs wallpaper resolution — the sheet that ships is 1314 wide.
SPECTRUM_RENDER = (1280, 720)
SPECTRUM_SUPERSAMPLE = 3


def style_spectrum() -> Drawn:
    """Six rated wallpapers in order of how full the frame is, with no verdict attached."""
    catalog = renders.mode_catalog()
    picks = [renders.finished_row(*pick) for pick in SPECTRUM]
    wrong = [row for row in picks if row["score"] != SPECTRUM_SCORE]
    if wrong:
        raise renders.EngineError(
            "every panel of the spectrum is a picture rated "
            f"{SPECTRUM_SCORE}, and "
            + ", ".join(
                f"{row['_head']}/{row['_batch']}.jsonl line {row['_line']} scores {row['score']}"
                for row in wrong
            )
        )
    size = panels(3)
    sheet, draw = sheets.canvas(*sheets.grid_size(size, 3, 2, caption=0))
    for index, row in enumerate(picks):
        spec = renders.wallpaper_spec(
            row,
            resolution=SPECTRUM_RENDER,
            supersample=SPECTRUM_SUPERSAMPLE,
            catalog=catalog,
        )
        picture = cache().produce(f"spectrum-{index + 1}", "render", spec)
        x, y = sheets.panel_origin(index, size, 3, caption=0)
        sheet.paste(sheets.fitted(picture.path, size), (x, y))
        _step_numeral(draw, x + STEP_INSET, y + STEP_INSET, index + 1)
    destination = sheets.save(sheet, sheet_path("locations-style-spectrum"))
    return Drawn(destination, _spectrum_provenance(picks, size))


def _step_numeral(draw, x: int, y: int, step: int) -> None:
    """Which step of the axis a panel is, outlined so any picture underneath carries it.

    A drop shadow is not enough here: the thing under the numeral is a wallpaper and can be
    white, so the glyph is stroked all the way round rather than offset once.
    """
    draw.text(
        (x, y),
        str(step),
        fill=WELL_INK,
        font=font(STEP_NUMERAL, SEMIBOLD),
        stroke_width=3,
        stroke_fill=(0, 0, 0),
    )


def _spectrum_provenance(picks: list[dict], size: tuple[int, int]) -> list[str]:
    """One line per panel: everything it takes to draw that wallpaper again."""
    lines = [
        "Every panel is a row of a tracked finished-render label store, read by store, "
        "file and line, and rendered fresh from that row's own recipe at "
        f"{SPECTRUM_RENDER[0]}x{SPECTRUM_RENDER[1]}, supersample {SPECTRUM_SUPERSAMPLE}, "
        f"then fitted to {size[0]}x{size[1]} in the sheet. Nothing about the coloring is "
        "this figure's choice: mode, mode settings, curve, colormap, the whole palette "
        "recipe and the cap all come off the row. The recipe this repository builds from a "
        "row was checked against the picture the judges' corpora hold for the same row, at "
        "the row's own geometry: all six reproduce it to within what re-compressing that "
        "JPEG costs (mean absolute difference 1.1-9.3 of 255, codec floor 1.1-9.5).",
    ]
    for (head, batch, line), row, density in zip(SPECTRUM, picks, SPECTRUM_DENSITY, strict=True):
        family = row["family"]
        lines.append(
            f"{head}/{batch}.jsonl line {line}: {_family_name(family)}"
            + (f" c = {family['c'][0]} + {family['c'][1]}i" if "c" in family else "")
            + (f", p = {family['p'][0]} + {family['p'][1]}i" if "p" in family else "")
            + (
                f", z_prev = {family['z_prev'][0]} + {family['z_prev'][1]}i"
                if "z_prev" in family
                else ""
            )
            + f", centre {row['viewport']['center_re']} + {row['viewport']['center_im']}i, "
            f"width {row['viewport']['width']}, mode {row['mode']}"
            + (f" {json.dumps(row['mode_params'])}" if row.get("mode_params") else "")
            + f", curve {row['curve']}, colormap {row['colormap']}, palette "
            f"{json.dumps(row['recipe'])}, cap {row['render']['maxiter']}, no crop beyond "
            f"the sheet's; scored {row['score']} by hand on {row['recorded_at']}, origin "
            f"{row['origin']}; edge measure {density}."
        )
    return lines


#: How tall the numeral that names a row is, and how much room its band needs.
RUNG_NUMERAL = 34
RUNG_BAND = 46


def rating_examples() -> Drawn:
    """The four-point scale by example, one row per rung, three locations each.

    Four buckets and nothing else. The figure used to print a family, a frame width and
    a labelling date under every panel, which is a provenance record standing where a
    reader's eye goes first — and none of it is what the figure is for. A reader wants
    to know what a 1 looks like beside what a 4 looks like, so the rung is what is
    loud: a numeral in the rung's own colour, the band it sits in, and a border in the
    same colour around every panel that earned it. Where each panel came from is in the
    registry's provenance, which is where a frame belongs.
    """
    order = sorted(RATED)
    picks = {score: [label_row(*pick) for pick in RATED[score]] for score in order}
    size = panels(3)
    cell = RUNG_BAND + size[1]
    height = sheets.PAD + len(order) * (cell + sheets.PAD) + sheets.PAD
    sheet, draw = sheets.canvas(SHEET_WIDTH, height)
    for row_index, score in enumerate(order):
        y = sheets.PAD + row_index * (cell + sheets.PAD)
        _rung_band(draw, y, score)
        for column, row in enumerate(picks[score]):
            x = sheets.PAD + column * (size[0] + sheets.PAD)
            picture = cache().render(f"rated-{score}-{column}", location(row), size)
            sheet.paste(sheets.fitted(picture.path, size), (x, y + RUNG_BAND))
            draw.rectangle(
                [x, y + RUNG_BAND, x + size[0] - 1, y + RUNG_BAND + size[1] - 1],
                outline=RUNG_INK[score],
                width=2,
            )
    destination = sheets.save(sheet, sheet_path("locations-rating-examples"))
    flat = [pick for score in order for pick in RATED[score]]
    rows = [row for score in order for row in picks[score]]
    return Drawn(destination, _store_provenance("by rating, 1 to 4", flat, rows, size, True))


def _rung_band(draw, y: int, score: int) -> None:
    """The numeral that names a rung, and the sentence that says what earns it."""
    face = font(RUNG_NUMERAL, SEMIBOLD)
    draw.text((sheets.PAD, y), str(score), fill=RUNG_INK[score], font=face)
    x = sheets.PAD + round(text_width(draw, str(score), face)) + 14
    draw.line([x - 7, y + 6, x - 7, y + RUNG_NUMERAL + 2], fill=RUNG_INK[score], width=2)
    draw.text((x, y + 10), RUNGS[score], fill=WELL_INK, font=font(17))


def _day(stamp: str) -> str:
    """A label's date. The store writes some rows as a day and some as an instant."""
    return stamp.split("T", 1)[0]


def _store_provenance(order: str, picks, rows, size, with_score: bool) -> list[str]:
    lines = [
        "Every panel is a row of the tracked label store, read by file and line from "
        f"data/labels/rows/, rendered fresh at {size[0]}x{size[1]}, supersample 3, mode "
        f"smooth, colormap {renders.COLORMAP}, cap from the depth-aware policy, no crop. "
        f"Panels are in reading order, {order}. The store's own render settings are not "
        "used: what is being shown is the location, and every panel is drawn the same way "
        "so the geometry is what differs.",
    ]
    for (batch, line), row in zip(picks, rows, strict=True):
        # Some batches of the store record no labeler at all, and "scored 4 by None" is
        # a worse record than saying only what the row says.
        by = f" by {row['labeler']}" if row.get("labeler") else ""
        verdict = f"scored {row['score']}{by} on {row['recorded_at']}, " if with_score else ""
        lines.append(
            f"{batch}.jsonl line {line}: {_family_name(row['family'])}"
            + (
                f" c = {row['family']['c'][0]} + {row['family']['c'][1]}i"
                if "c" in row["family"]
                else ""
            )
            + f", centre {row['viewport']['center_re']} + {row['viewport']['center_im']}i, "
            f"width {row['viewport']['width']}; {verdict}origin {row['origin']}."
        )
    return lines


# ------------------------------------------------------------------- the boundary draw

#: The seed the published draw was made at. Recorded because the sampler is seeded and
#: a number reproduces the twelve frames exactly — this figure is a *measurement*, and
#: a measurement nobody can repeat is an assertion.
BOUNDARY_SEED = 11
BOUNDARY_KEEP = 12
BOUNDARY_COLUMNS = 4

#: What each gate refuses, said the way the prose says it.
FATES = {
    "flat": "already escaped to blandness",
    "interior_cap": "mostly interior",
    "occupancy_floor": "too little of the frame carrying detail",
}


def random_samples() -> Drawn:
    """Twelve frames drawn uniformly over the home view and kept only by the gates.

    The draw's tally — how many frames it took, which gate refused how many, what the
    pass rate came to — used to stand across the top of the sheet. It is provenance and
    the caption's, not the picture's: what a reader is here to see is twelve frames that
    got through, and a line of counts above them is a record where the eye goes first.
    """
    draws, kept = renders.boundary_draw(seed=BOUNDARY_SEED, keep=BOUNDARY_KEEP)
    run = next(row for row in draws if row["kind"] == "run")
    summary = next(row for row in draws if row["kind"] == "summary")

    size = panels(BOUNDARY_COLUMNS)
    rows_down = (len(kept) + BOUNDARY_COLUMNS - 1) // BOUNDARY_COLUMNS
    cell = size[1] + band(size[1], 1)
    height = sheets.PAD + rows_down * (cell + sheets.PAD) + sheets.PAD
    sheet, draw = sheets.canvas(SHEET_WIDTH, height)
    for index, row in enumerate(kept):
        column, down = index % BOUNDARY_COLUMNS, index // BOUNDARY_COLUMNS
        x = sheets.PAD + column * (size[0] + sheets.PAD)
        y = sheets.PAD + down * (cell + sheets.PAD)
        picture = cache().render(f"boundary-{BOUNDARY_SEED}-{index}", location(row), size)
        sheet.paste(sheets.fitted(picture.path, size), (x, y))
        under(
            draw,
            (x, y),
            size,
            [f"width {sheets.width_text(row['viewport']['width'])}"],
            lead=WELL_INK_DIM,
        )
    destination = sheets.save(sheet, sheet_path("locations-random-samples"))
    return Drawn(destination, _boundary_provenance(run, summary, kept, size))


def _boundary_provenance(run, summary, kept, size) -> list[str]:
    battery = run["battery"]
    lines = [
        f"`fractal-wallpapers sample-boundary --family {run['family']['kind']} --seed "
        f"{run['seed']} --keep {run['keep']} --attempts {run['attempt_cap']}` — a uniform "
        f"draw over {run['home_box']['share_of_home']:.0%} of the family's home view at "
        f"widths log-uniform in [{run['width_band'][0]:g}, {run['width_band'][1]:g}], "
        f"screened at a {run['probe_width']}-pixel probe and a {run['tile'][0]}x"
        f"{run['tile'][1]} tile by the walk's own battery: interior cap "
        f"{battery['interior_cap']}, escape spread at least {battery['band']['spread_min']}, "
        f"escape median at least {battery['band']['escape_median_min']}, occupancy floor "
        f"{battery['occupancy_floor']}. {summary['attempts']} attempts, "
        f"{summary['survived']} survivors, {summary['kept']} kept; refusals "
        + ", ".join(
            f"{fate} {count}" for fate, count in summary["fates"].items() if fate != "survived"
        )
        + f". The draw took {summary['seconds']:.0f}s.",
        f"All twelve panels re-rendered here at {size[0]}x{size[1]}, supersample 3, mode "
        f"smooth, colormap {renders.COLORMAP}, cap from the depth-aware policy, no crop; "
        "the sampler's own thumbnails are not used.",
    ]
    for index, row in enumerate(kept):
        lines.append(
            f"panel {index + 1}: centre {row['viewport']['center_re']} + "
            f"{row['viewport']['center_im']}i, width {row['viewport']['width']}."
        )
    return lines


# ------------------------------------------------------ what a walk found, and what it became

#: One released wallpaper per partition whose location carries a human class-4 label,
#: as `(run, candidate, label file, label line)`. The pairing was made by joining every
#: release record against the label store through the wallpaper project's own location
#: identity; what is recorded here is what that join returned, and the label line is
#: read back at draw time so the rating printed under a panel is the store's, not a
#: number copied into this file.
#:
#: Five partitions, not the article's six families: `mandelbrot`, `multibrot3`,
#: `phoenix` and `julia:mandelbrot` have released wallpapers and **no** class-4 human
#: label on the location behind any of them, so they are absent rather than filled with
#: a machine-scored pick.
FOUND_AND_FINISHED = (
    ("run9", "0077", "plane_deep_admissions", 3),
    ("run2", "0072", "plane_deep_admissions", 1),
    ("run3", "0021", "twin_top_slices", 3),
    ("run9", "0080", "twin_top_slices", 5),
    ("run9", "0165", "twin_top_slices", 9),
)


def found_and_finished() -> Drawn:
    """Each pair: the frame the walk admitted, and the wallpaper made from it."""
    pairs = []
    for run, candidate, batch, line in FOUND_AND_FINISHED:
        release = release_record(run, candidate)
        rated = label_row(batch, line)
        if rated["viewport"] != release["location"]["viewport"]:
            raise renders.EngineError(
                f"{batch}.jsonl line {line} is not the location behind {run}|{candidate} — "
                "the rating this figure prints would be about a different frame"
            )
        pairs.append((release, rated))

    size = panels(4)
    cell = 22 + size[1] + band(size[1], 2)
    rows_down = (len(pairs) + 1) // 2
    height = sheets.PAD + rows_down * (cell + sheets.PAD) + sheets.PAD
    sheet, draw = sheets.canvas(SHEET_WIDTH, height)
    for index, (release, rated) in enumerate(pairs):
        down, side = divmod(index, 2)
        left = sheets.PAD + side * 2 * (size[0] + sheets.PAD)
        y = sheets.PAD + down * (cell + sheets.PAD)
        heading(
            draw,
            left,
            y,
            f"{_family_name(release['location']['family'])}"
            f"{sheets.MIDDOT}the location was rated {rated['score']} by hand",
            size=15,
        )
        found = cache().render(
            f"found-{release['run']}-{release['candidate']}",
            location(release["location"]),
            NODE_TILE,
            supersample=NODE_SUPERSAMPLE,
        )
        sheet.paste(sheets.fitted(found.path, size), (left, y + 22))
        under(
            draw,
            (left, y + 22),
            size,
            [
                "As the walk found it",
                f"width {sheets.width_text(release['location']['viewport']['width'])}"
                f"{sheets.MIDDOT}{NODE_TILE[0]}\u00d7{NODE_TILE[1]}, no palette",
            ],
        )
        x = left + size[0] + sheets.PAD
        sheet.paste(sheets.fitted(release["_picture"], size), (x, y + 22))
        recipe = release["recipe"]
        under(
            draw,
            (x, y + 22),
            size,
            [
                "The wallpaper released from it",
                f"{recipe['mode']}{sheets.MIDDOT}{recipe['colormap']}"
                + (f"{sheets.MIDDOT}mirrored" if recipe.get("mirror") else ""),
            ],
        )
    spare = sheets.PAD + 2 * (size[0] + sheets.PAD)
    stack(
        draw,
        spare,
        sheets.PAD + (rows_down - 1) * (cell + sheets.PAD) + 22,
        [
            "Five kinds of fractal, not nine.",
            "",
            "Mandelbrot, multibrot d = 3, Phoenix and the",
            "degree-2 Julias all ship released wallpapers",
            "too, and none of the locations behind those",
            "carries a class-4 human rating — so they are",
            "absent here rather than filled in with a pick",
            "the judge liked and nobody ever looked at.",
        ],
        size=15,
        lead=WELL_INK_DIM,
    )
    destination = sheets.save(sheet, sheet_path("locations-found-and-finished"))
    return Drawn(destination, _pair_provenance(pairs, size))


def _released_at(release: dict) -> str:
    """How big the released wallpaper is, stated and never guessed.

    A release row's `recipe.render` is the **candidate** geometry — the small
    render the curation verdict was cast on, 640x360 at supersample 2 — and this
    line read it as the wallpaper's own size, so every provenance line here said
    640x360 about a picture that is 2560x1440.

    The wallpapers project records `release_geometry` on a release row since
    2026-08-25, when a gallery pass's release regime became a per-pass decision
    and the answer stopped being inferable at all. A row older than that field
    does not carry one, so the frame is read off the shipped PNG this figure is
    pasting anyway — a fact, not an inference — and the supersample is reported
    as unrecorded rather than filled in from a constant in another repository.
    """
    from PIL import Image

    geometry = release.get("release_geometry") or {}
    resolution, supersample = geometry.get("resolution"), geometry.get("supersample")
    if resolution and supersample is not None:
        return f"at {resolution[0]}x{resolution[1]} supersample {supersample}"
    with Image.open(release["_picture"]) as opened:
        width, height = opened.size
    return (
        f"at {width}x{height}, read off the shipped PNG — the record predates the "
        f"release-geometry field and does not carry its supersample"
    )


def _pair_provenance(pairs, size) -> list[str]:
    lines = [
        "Each row is one release record of a curation run beside the location it was "
        "made from. The location panel is rendered here at the walk's own node regime, "
        f"{NODE_TILE[0]}x{NODE_TILE[1]} at supersample {NODE_SUPERSAMPLE}, mode smooth, "
        f"colormap {renders.COLORMAP}, cap from the depth-aware policy, then fitted to "
        f"{size[0]}x{size[1]}: the picture the walk's gates and judge actually saw, "
        "before any palette or curation. The wallpaper panel is the released PNG itself, "
        "fitted to the same box and not re-rendered.",
    ]
    for release, rated in pairs:
        recipe, place = release["recipe"], release["location"]
        lines.append(
            f"{release['key']}: {_family_name(place['family'])}"
            + (
                f", c = {place['family']['c'][0]} + {place['family']['c'][1]}i"
                if "c" in place["family"]
                else ""
            )
            + f", centre {place['viewport']['center_re']} + {place['viewport']['center_im']}i, "
            f"width {place['viewport']['width']}, maxiter {place.get('maxiter')}; found in "
            f"{place.get('ledger')}. Released as mode {recipe['mode']}, curve "
            f"{recipe['curve']}, colormap {recipe['colormap']}, mirror "
            f"{bool(recipe.get('mirror'))}, {_released_at(release)}. The location is scored "
            f"{rated['score']} by {rated['labeler']} on {_day(rated['recorded_at'])}, "
            f"recorded at data/labels/rows/{rated['_batch']}.jsonl line {rated['_line']}."
        )
    return lines


# ----------------------------------------------------------------------- walk lengths

#: The two hues the comparison is drawn in, and the neutral the context arm gets.
#: They are `diagrams.py`'s own track colours — the site already owns a set of inks
#: chosen to stay apart on this well — and the pair separates at ΔE 24 under every
#: simulated colour deficiency. The third arm is deliberately *not* a third hue: it is
#: not part of the comparison, and giving it one would say it was.
SEEDED_INK = (0x6F, 0xB3, 0xFF)
FRESH_INK = (0xE8, 0x73, 0x4A)
CONTEXT_INK = WELL_INK_DIM

#: The prior production run the third arm reads. Same limits as the demo run — batch 8,
#: twelve expansions per root, the same breadth floor and grace — and a different root
#: mix, which is exactly why it is shown apart rather than pooled with either arm.
PRIOR_RUN = "harvest_run2"


@dataclass(frozen=True)
class Arm:
    """One population of roots, and what became of each."""

    name: str
    note: str
    ink: tuple[int, int, int]
    depths: list[int]
    admitting: int

    @property
    def roots(self) -> int:
        return len(self.depths)

    @property
    def median(self) -> int:
        return sorted(self.depths)[self.roots // 2]

    @property
    def share(self) -> float:
        return self.admitting / self.roots


def arm(name: str, note: str, ink, rows: list[dict], keep=None) -> Arm:
    """Every root of a ledger that was ever expanded, with how deep it got.

    A root that never came off the queue has no walk to measure and is left out rather
    than counted as a walk of length zero — the run's budget ran out, which is a fact
    about the budget and not about the root.
    """
    roots = {row["root_id"]: row for row in rows if row.get("kind") == "root"}
    depth: dict[int, int] = {}
    admitted: set[int] = set()
    for row in rows:
        if row.get("kind") != "candidate" or row.get("root_id") is None:
            continue
        root = roots.get(row["root_id"])
        if root is None or (keep is not None and not keep(root)):
            continue
        depth[row["root_id"]] = max(depth.get(row["root_id"], 0), row.get("depth") or 0)
        if row.get("fate") == "survived":
            admitted.add(row["root_id"])
    return Arm(name, note, ink, sorted(depth.values()), len(admitted))


def _channel(root: dict) -> str:
    return (root.get("provenance") or {}).get("channel") or "pool"


def walk_lengths() -> Drawn:
    """How deep a walk runs from a seeded root and from a fresh one, in one run."""
    demo = ledger()
    prior = ledger(PRIOR_RUN)
    arms = [
        arm(
            "Seeded roots",
            "placed at locations a human rated a keeper",
            SEEDED_INK,
            demo,
            lambda root: _channel(root) == "proven",
        ),
        arm(
            "Fresh roots",
            "a grid of minibrot nuclei, and each plane's home view",
            FRESH_INK,
            demo,
            lambda root: _channel(root) != "proven",
        ),
        arm(
            "Another run entirely",
            "for scale — the same limits, a different root mix",
            CONTEXT_INK,
            prior,
        ),
    ]
    return _lengths_sheet(arms)


#: The two panels' geometry. The left one is a column of small multiples sharing one
#: depth axis; the right is three bars of one number. Two measures, two charts, one
#: scale each — a single pair of axes carrying both would be a lie about proportion.
DEPTH_PANEL = (12, 838)
SHARE_PANEL = (874, 1304)
ARM_ROW = 150
BAR_GAP = 3


def _lengths_sheet(arms: list[Arm]) -> Drawn:
    """Two charts: how deep each arm's walks ran, and how many found anything at all."""
    floor = min(min(one.depths) for one in arms)
    ceiling = max(max(one.depths) for one in arms)
    steps = list(range(floor, ceiling + 1))
    tallest = max(one.depths.count(step) / one.roots for one in arms for step in steps)
    height = sheets.PAD + 30 + len(arms) * ARM_ROW + 34 + sheets.PAD
    sheet, draw = sheets.canvas(SHEET_WIDTH, height)

    heading(draw, DEPTH_PANEL[0], sheets.PAD, "How deep the walk from each root got")
    heading(draw, SHARE_PANEL[0], sheets.PAD, "Roots that produced at least one find")
    for index, one in enumerate(arms):
        top = sheets.PAD + 30 + index * ARM_ROW
        if index:
            rule(draw, top - 10)
        _arm_heading(draw, DEPTH_PANEL[0], top, one)
        _depth_bars(draw, top + ARM_ROW - 16, one, steps, tallest)
        _share_bar(draw, top, one)
    _depth_axis(draw, sheets.PAD + 30 + len(arms) * ARM_ROW - 4, steps)
    destination = sheets.save(sheet, sheet_path("locations-walk-lengths"))
    return Drawn(destination, _lengths_provenance(arms))


def _arm_heading(draw, x: int, y: int, one: Arm) -> None:
    """The arm's name in its own ink, then what it is and how big it is, in text ink."""
    face = font(17)
    draw.text((x, y), one.name, fill=one.ink, font=face)
    offset = x + text_width(draw, one.name, face) + 10
    draw.text((offset, y + 2), f"— {one.note}", fill=WELL_INK_DIM, font=font(15))
    draw.text(
        (x, y + 24),
        f"{one.roots} roots expanded{sheets.MIDDOT}median depth {one.median}"
        f"{sheets.MIDDOT}deepest {max(one.depths)}",
        fill=SECTION_INK,
        font=font(14),
    )


def _depth_bars(draw, baseline: int, one: Arm, steps: list[int], tallest: float) -> None:
    """One arm's max-depth histogram, as a share of that arm's own roots."""
    left, right = DEPTH_PANEL
    span = (right - left) / len(steps)
    ceiling = 62
    draw.line([left, baseline, right, baseline], fill=WELL_RULE, width=1)
    for index, step in enumerate(steps):
        share = one.depths.count(step) / one.roots
        if not share:
            continue
        tall = max(2, round(share / tallest * ceiling))
        x = left + index * span
        box = [x + BAR_GAP, baseline - tall, x + span - BAR_GAP, baseline]
        radius = min(4, tall // 2, (span - 2 * BAR_GAP) // 2)
        if radius >= 1:
            draw.rounded_rectangle(
                box, radius=radius, fill=one.ink, corners=(True, True, False, False)
            )
        else:
            draw.rectangle(box, fill=one.ink)
        if share >= 0.10:
            centred(
                draw,
                round(x + BAR_GAP),
                baseline - tall - 19,
                round(span - 2 * BAR_GAP),
                f"{share:.0%}",
                size=13,
                fill=WELL_INK_DIM,
            )


def _depth_axis(draw, baseline: int, steps: list[int]) -> None:
    """The one depth axis all three rows are read against, labelled once at the foot."""
    left, right = DEPTH_PANEL
    span = (right - left) / len(steps)
    for index, step in enumerate(steps):
        centred(
            draw,
            round(left + index * span),
            baseline,
            round(span),
            str(step),
            size=14,
            fill=SECTION_INK,
        )
    draw.text(
        (left, baseline + 20),
        "deepest frame the walk reached from that root, in rungs below it",
        fill=SECTION_INK,
        font=font(14),
    )


def _share_bar(draw, y: int, one: Arm) -> None:
    """One arm's hit rate, as a bar and as the number it is."""
    left, right = SHARE_PANEL
    track = right - left - 96
    top = y + 58
    draw.rounded_rectangle([left, top, left + track, top + 26], radius=4, fill=WELL_PANEL)
    filled = max(2, round(track * one.share))
    draw.rounded_rectangle([left, top, left + filled, top + 26], radius=4, fill=one.ink)
    draw.text(
        (left + track + 12, top + 4),
        f"{one.share:.0%}",
        fill=WELL_INK,
        font=font(17),
    )
    draw.text(
        (left, top + 32),
        f"{one.admitting} of {one.roots} roots",
        fill=SECTION_INK,
        font=font(14),
    )


def _lengths_provenance(arms: list[Arm]) -> list[str]:
    lines = [
        "No render: a chart, drawn from two walk ledgers. A root counts once, and only "
        "if the run ever expanded it; depth is the deepest rung any candidate under it "
        "reached, and a root 'produced a find' if any candidate under it was admitted. "
        "Bars are shares of each arm's own roots, so arms of different sizes are "
        "comparable; the two demo arms ran in one run, under one frontier, competing "
        "for the same expansion budget.",
    ]
    for one in arms:
        counts = ", ".join(f"{step}:{one.depths.count(step)}" for step in sorted(set(one.depths)))
        lines.append(
            f"{one.name} ({one.note}): {one.roots} roots, median depth {one.median}, "
            f"deepest {max(one.depths)}, {one.admitting} admitting "
            f"({one.share:.1%}); depth histogram {counts}."
        )
    lines.append(
        f"Arms 1 and 2 are {LEDGER}/walk.jsonl split by root channel — proven against "
        f"everything else. Arm 3 is {PRIOR_RUN}/walk.jsonl entire."
    )
    return lines


# --------------------------------------------------------------------------- the walk step

#: The expansion the animated diagram steps through: four children proposed by the
#: three different rules, one refused at a gate with its reading recorded, and two
#: admitted against one merely expandable — every beat of the prose with a real number
#: under it.
STEP_NODE = 232

#: The two score floors the fates are decided at. They live in the wallpaper project
#: (`supply.currency.GOOD_FLOOR`, `curation.floors.JUNK_FLOOR`) and they *move* — both
#: were restated on 2026-08-20 at a head flip — so a figure that prints them checks
#: them against the ledger it is drawing rather than trusting this line.
GOOD_FLOOR = 0.385
JUNK_FLOOR = 0.100

#: The five beats, in the order the prose runs them, and what each one is doing here.
BEATS = (
    (
        "Render cheaply",
        "The frame is drawn small and fast, one sample per pixel — a"
        " thumbnail of its smooth field, not a finished render.",
    ),
    (
        "Propose children",
        "Four child frames are drawn inside it, each zoomed to between"
        " 35% and 50% of its width: most aimed at foci, the rest placed at random or toward"
        " raw detail density.",
    ),
    (
        "Gate",
        "Each child is rendered the same cheap way, and the structural checks throw"
        " out the hopeless before the judge sees one.",
    ),
    (
        "Score",
        "The judge reads the very render the gates just examined and rates the"
        " frame's chances. A strong reading is admitted; a middling one is expandable, a"
        " frame the walk may explore through but never counts as a find; a weak one is"
        " refused.",
    ),
    (
        "Prioritize",
        "The parent has been expanded and leaves the frontier. What survived"
        " goes back on, best first — the real order also carries a jitter and a small depth"
        " bonus, which this diagram leaves out.",
    ),
)

STEP_MS = 2600
STEP_HOLD_MS = 5200

#: Where each thing sits on the diagram's canvas. The two rows under the children are
#: measured off the label band rather than typed: the band is the tile-label rule's to
#: size now, and a typed 534 is a verdict line drawn through a caption.
STEP_PARENT = (sheets.PAD, 54)
STEP_KIDS_TOP = 300
STEP_VERDICT = STEP_KIDS_TOP + panels(4)[1] + band(panels(4)[1], 2) + 8
STEP_QUEUE = STEP_VERDICT + 76
STEP_SIZE = (SHEET_WIDTH, STEP_QUEUE + 58)

ADMITTED_INK = SEEDED_INK
REFUSED_INK = FRESH_INK


def walk_step() -> Drawn:
    """One expansion, beat by beat, as a looping diagram over the frames it really used."""
    forest = Forest(ledger())
    parent = forest.nodes[STEP_NODE]
    kids = forest.children(STEP_NODE)
    _check_floors(forest.rows)
    run = next(row for row in forest.rows if row.get("kind") == "run")
    small = panels(4)
    parent_panel = node_panel("step-parent", parent)
    kid_panels = [node_panel(f"step-kid-{kid['child_index']}", kid) for kid in kids]

    frames = [
        _step_frame(beat, parent, kids, parent_panel, kid_panels, small, run)
        for beat in range(len(BEATS))
    ]
    destination = sheet_path("locations-walk-step")
    sheets.animate(frames, destination, frame_ms=STEP_MS, hold_ms=STEP_HOLD_MS)
    size = destination.stat().st_size / 1024
    print(f"{destination.name}  {STEP_SIZE[0]}x{STEP_SIZE[1]}  {len(frames)} frames  {size:.0f} KB")
    return Drawn(destination, _step_provenance(parent, kids, small))


def _check_floors(rows: list[dict]) -> None:
    """Hold the three fates the diagram shows to the ledger it is drawing them from.

    The diagram prints no threshold any more — a floor is an operating constant and it
    moves — but it still asserts an ordering: admitted above expandable above refused.
    This is that assertion checked against the run, so a ledger whose fates no longer
    stack that way is a refusal rather than a diagram quietly telling the wrong story.
    """
    scored = [
        row for row in rows if row.get("kind") == "candidate" and row.get("score") is not None
    ]
    admitted = [row["score"] for row in scored if row["fate"] == "survived"]
    refused = [
        row["score"] for row in scored if row["fate"] == "not_admitted" and not row.get("grace")
    ]
    if min(admitted) < GOOD_FLOOR or max(refused) >= JUNK_FLOOR:
        raise renders.EngineError(
            f"this ledger admits from {min(admitted):.6f} and refuses up to "
            f"{max(refused):.6f}, against the {GOOD_FLOOR} and {JUNK_FLOOR} this run was "
            "meant to have used, so the three fates the diagram shows are not this run's"
        )


def _step_frame(beat, parent, kids, parent_panel, kid_panels, small, run):
    """One beat's frame: everything the beats before it drew, plus this beat's mark."""
    sheet, draw = sheets.canvas(*STEP_SIZE)
    _stepper(draw, beat)
    sheet.paste(sheets.fitted(parent_panel, NODE_TILE), STEP_PARENT)
    _beat_text(draw, beat)
    _step_settings(draw, parent, run)
    if beat >= 1:
        _proposals(sheet, draw, parent, kids)
        for index, (kid, picture) in enumerate(zip(kids, kid_panels, strict=True)):
            x = sheets.PAD + index * (small[0] + sheets.PAD)
            sheet.paste(sheets.fitted(picture, small), (x, STEP_KIDS_TOP))
            _kid_marks(draw, beat, index, kid, x, small)
    if beat >= 4:
        _queue(draw, parent, kids)
    return sheet


def _stepper(draw, beat: int) -> None:
    """The five beat names across the top, with the one being shown lit."""
    x = sheets.PAD
    for index, (name, _text) in enumerate(BEATS):
        lit = index == beat
        face = font(17, SEMIBOLD if lit else REGULAR)
        draw.text((x, sheets.PAD), f"{index + 1}", fill=WELL_RULE, font=font(17))
        draw.text(
            (x + 18, sheets.PAD),
            name,
            fill=WELL_INK if lit else SECTION_INK,
            font=face,
        )
        width = 18 + text_width(draw, name, face)
        if lit:
            draw.line([x + 18, sheets.PAD + 24, x + width, sheets.PAD + 24], fill=WELL_INK, width=2)
        x += width + 34
    rule(draw, sheets.PAD + 34)


def _beat_text(draw, beat: int) -> None:
    """What this beat is, beside the parent frame."""
    left = sheets.PAD + NODE_TILE[0] + 2 * sheets.PAD
    draw.text((left, STEP_PARENT[1]), BEATS[beat][0], fill=WELL_INK, font=font(21, SEMIBOLD))
    stack(draw, left, STEP_PARENT[1] + 34, _wrap(BEATS[beat][1], 78), size=16, lead=WELL_INK_DIM)


def _step_settings(draw, parent: dict, run: dict) -> None:
    """What this one expansion is, standing still under the stage text."""
    left = sheets.PAD + NODE_TILE[0] + 2 * sheets.PAD
    policy = run["policy"]
    heading(draw, left, STEP_PARENT[1] + 138, "This expansion", size=15)
    stack(
        draw,
        left,
        STEP_PARENT[1] + 162,
        [
            f"{_family_name(parent['family'])}{sheets.MIDDOT}"
            f"{parent['depth']} rungs below the root it grew from",
            f"frame width {sheets.width_text(parent['viewport']['width'])}"
            f"{sheets.MIDDOT}drawn at {NODE_TILE[0]}×{NODE_TILE[1]}, one sample per pixel",
            f"{policy['candidates']} candidates, each "
            f"{policy['zoom'][0]:.0%} to {policy['zoom'][1]:.0%} of the parent's width",
            "the gates: too much interior, escaped to blandness, a flat field, "
            "too little of the frame carrying detail",
        ],
        size=14,
        lead=WELL_INK_DIM,
    )


def _wrap(text: str, width: int) -> list[str]:
    """Text broken to a line width, because Pillow will not do it."""
    lines, line = [], ""
    for word in text.split():
        if line and len(line) + 1 + len(word) > width:
            lines.append(line)
            line = word
        else:
            line = f"{line} {word}".strip()
    if line:
        lines.append(line)
    return lines


def _proposals(sheet, draw, parent, kids) -> None:
    """The four child frames, marked on the parent they were proposed inside."""
    box = (0, 0, NODE_TILE[0], NODE_TILE[1])
    layer, over = _overlay(NODE_TILE)
    for kid in kids:
        corners = frame_box(kid["viewport"], parent["viewport"], box)
        outline(over, corners, WELL_INK, width=2)
        _tag(over, corners[0] + 5, corners[1] + 4, str(kid["child_index"] + 1), WELL_INK)
    _paste_marked(sheet, _render_of(sheet), layer, STEP_PARENT)


def _render_of(sheet):
    """The parent panel already on the sheet, so the marks composite over the picture."""
    return sheet.crop(
        (
            STEP_PARENT[0],
            STEP_PARENT[1],
            STEP_PARENT[0] + NODE_TILE[0],
            STEP_PARENT[1] + NODE_TILE[1],
        )
    )


def _kid_marks(draw, beat: int, index: int, kid: dict, x: int, small) -> None:
    """One child's caption, and whatever verdict the beats so far have reached."""
    refused = kid["fate"] in FATES
    under(
        draw,
        (x, STEP_KIDS_TOP),
        small,
        [
            f"{index + 1}{sheets.MIDDOT}{_branch_line(kid)}",
            f"width {sheets.width_text(kid['viewport']['width'])}",
        ],
    )
    if beat < 2:
        return
    if refused:
        draw.text(
            (x, STEP_VERDICT),
            f"refused: {FATES[kid['fate']]}",
            fill=REFUSED_INK,
            font=font(15),
        )
        draw.line(
            [x, STEP_KIDS_TOP, x + small[0], STEP_KIDS_TOP + small[1]],
            fill=REFUSED_INK,
            width=3,
        )
        draw.line(
            [x + small[0], STEP_KIDS_TOP, x, STEP_KIDS_TOP + small[1]],
            fill=REFUSED_INK,
            width=3,
        )
        return
    draw.text((x, STEP_VERDICT), "passed every gate", fill=SECTION_INK, font=font(15))
    if beat < 3:
        return
    admitted = kid["fate"] == "survived"
    draw.text(
        (x, STEP_VERDICT + 21),
        "admitted" if admitted else "expandable",
        fill=ADMITTED_INK if admitted else WELL_INK_DIM,
        font=font(15),
    )


def _branch_line(kid: dict) -> str:
    return {
        "foci": "aimed at a focus",
        "random": "placed at random",
        "density": "placed toward detail density",
    }[kid["branch"]]


def _queue(draw, parent, kids) -> None:
    """The last beat: the parent gone, and what survived going back on, best first."""
    rule(draw, STEP_QUEUE - 14)
    draw.text(
        (sheets.PAD, STEP_QUEUE),
        "Back on the frontier",
        fill=WELL_INK,
        font=font(17, SEMIBOLD),
    )
    x = sheets.PAD + 190
    gone = "the parent \u2014 expanded, off the queue"
    draw.text((x, STEP_QUEUE + 2), gone, fill=SECTION_INK, font=font(15))
    width = text_width(draw, gone, font(15))
    draw.line([x, STEP_QUEUE + 11, x + width, STEP_QUEUE + 11], fill=SECTION_INK, width=1)
    x += width + 26
    survivors = sorted(
        (kid for kid in kids if kid["fate"] not in FATES),
        key=lambda kid: -kid["score"],
    )
    for kid in survivors:
        admitted = kid["fate"] == "survived"
        ink = ADMITTED_INK if admitted else WELL_INK_DIM
        fate = "admitted" if admitted else "expandable"
        text = f"{kid['child_index'] + 1}{sheets.MIDDOT}{fate}"
        face = font(15)
        span = round(text_width(draw, text, face)) + 20
        draw.rounded_rectangle(
            [x, STEP_QUEUE - 4, x + span, STEP_QUEUE + 24],
            radius=5,
            fill=WELL_PANEL,
            outline=ink,
            width=2,
        )
        draw.text((x + 10, STEP_QUEUE + 2), text, fill=ink, font=face)
        x += span + 16


def _step_provenance(parent, kids, small) -> list[str]:
    lines = [
        f"An animated diagram over real frames. Ledger {LEDGER}/walk.jsonl, seed 11, "
        f"batch {parent['batch']}: one expansion of node {parent['node_id']} "
        f"({_family_name(parent['family'])}, depth {parent['depth']}). Every panel is "
        f"rendered at the walk's own node regime — {NODE_TILE[0]}x{NODE_TILE[1]}, "
        f"supersample {NODE_SUPERSAMPLE}, mode smooth, colormap {renders.COLORMAP}, cap "
        "from the depth-aware policy — because that is the render the gates measured and "
        f"the judge scored; the four children are fitted to {small[0]}x{small[1]}. Five "
        f"frames at {STEP_MS} ms, the last held {STEP_HOLD_MS} ms, written as a looping "
        "APNG in full colour.",
        f"parent: node {parent['node_id']}, centre {parent['viewport']['center_re']} + "
        f"{parent['viewport']['center_im']}i, width {parent['viewport']['width']}, "
        f"maxiter {parent['maxiter']}.",
    ]
    for kid in kids:
        lines.append(
            f"child {kid['child_index'] + 1}: branch {kid['branch']}, placement "
            f"{kid['placement']}, centre {kid['viewport']['center_re']} + "
            f"{kid['viewport']['center_im']}i, width {kid['viewport']['width']}, maxiter "
            f"{kid['maxiter']}, fate {kid['fate']}"
            + (
                f", occupancy {kid['occupancy']}"
                if kid["fate"] == "occupancy_floor"
                else f", judge P(>=3) {kid['score']:.6f} under head {kid['scorer']}"
                if kid.get("score") is not None
                else ""
            )
            + "."
        )
    lines.append(
        f"The floors printed on the Score beat are GOOD_FLOOR {GOOD_FLOOR} and "
        f"JUNK_FLOOR {JUNK_FLOOR}, checked against this ledger before drawing: its "
        "lowest admission and its highest ungraced refusal both fall the right side of "
        "them."
    )
    return lines


# ------------------------------------------------------------------------ walk examples

#: The run the example walks come from: one plane, one seed, and — the reason it is this
#: run and not the demo one — **one labelling batch** covering its finds. Where two
#: batches label a run, the batches disagree about which walks got looked at, and a
#: figure sorted by rating would be showing the labelling and calling it the walking.
EXAMPLES_LEDGER = "mandelbrot_sourcing"
EXAMPLES_BATCH = "mandelbrot_offer_body"

#: `(best-find rating, root, the rated frame's node, the label's line)`. Each root's
#: *best* human-rated find, over the 54 roots of this run that produced one at all.
EXAMPLES = (
    (2, 10, 422, 51),
    (3, 2, 879, 11),
    (4, 83, 3984, 4),
)

EXAMPLE_COLUMNS = 6


def walk_examples() -> Drawn:
    """Three complete walks, laid out rung by rung, ordered by how good their best find is."""
    rows = ledger(EXAMPLES_LEDGER)
    forest = Forest(rows)
    walks = []
    for rating, root_id, tip, line in EXAMPLES:
        chain = forest.chain(tip)
        if chain is None:
            raise renders.EngineError(f"node {tip} has a rung this ledger cannot recover")
        rated = label_row(EXAMPLES_BATCH, line)
        if rated["viewport"] != chain[-1]["viewport"]:
            raise renders.EngineError(
                f"{EXAMPLES_BATCH}.jsonl line {line} is not node {tip}'s frame"
            )
        if rated["score"] != rating:
            raise renders.EngineError(
                f"{EXAMPLES_BATCH}.jsonl line {line} is rated {rated['score']}, not {rating}"
            )
        walks.append((rating, root_id, chain, rated, _walk_tally(rows, root_id)))

    size = panels(EXAMPLE_COLUMNS)
    cell = 24 + size[1] + band(size[1], 2)
    height = sheets.PAD + len(walks) * (cell + sheets.PAD) + sheets.PAD
    sheet, draw = sheets.canvas(SHEET_WIDTH, height)
    for index, (rating, root_id, chain, _rated, tally) in enumerate(walks):
        y = sheets.PAD + index * (cell + sheets.PAD)
        if index:
            rule(draw, y - 8)
        found, admitted, deepest = tally
        heading(
            draw,
            sheets.PAD,
            y,
            f"Best find rated {rating} by hand",
            size=15,
        )
        for column, entry in enumerate(chain[:EXAMPLE_COLUMNS]):
            x = sheets.PAD + column * (size[0] + sheets.PAD)
            picture = cache().render(f"walk-{root_id}-{column}", location(entry), size)
            sheet.paste(sheets.fitted(picture.path, size), (x, y + 24))
            last = entry is chain[-1]
            under(
                draw,
                (x, y + 24),
                size,
                [
                    ("the root" if entry["kind"] == "root" else f"rung {entry['depth'] - 1}")
                    + (f"{sheets.MIDDOT}rated {rating} by hand" if last else ""),
                    sheets.width_text(entry["viewport"]["width"]),
                ],
                lead=WELL_INK if last else WELL_INK_DIM,
            )
    destination = sheets.save(sheet, sheet_path("locations-walk-examples"))
    return Drawn(destination, _examples_provenance(walks, size))


def _walk_tally(rows: list[dict], root_id: int) -> tuple[int, int, int]:
    """How many frames a root's walk proposed, how many were admitted, how deep it got."""
    under = [
        row for row in rows if row.get("kind") == "candidate" and row.get("root_id") == root_id
    ]
    return (
        len(under),
        sum(1 for row in under if row["fate"] == "survived"),
        max(row.get("depth") or 0 for row in under),
    )


def _examples_provenance(walks, size) -> list[str]:
    lines = [
        f"Ledger {EXAMPLES_LEDGER}/walk.jsonl. Three of the {len(walks)} best-find rating "
        f"classes this run has: every one of its finds that a human scored was scored in "
        f"one batch, data/labels/rows/{EXAMPLES_BATCH}.jsonl, so the rating a walk is "
        "filed under is about the walk and not about which batch happened to look at it. "
        f"Every panel {size[0]}x{size[1]}, supersample 3, mode smooth, colormap "
        f"{renders.COLORMAP}, cap from the depth-aware policy, no crop.",
    ]
    for rating, root_id, chain, rated, tally in walks:
        found, admitted, deepest = tally
        lines.append(
            f"rating {rating}, root {root_id}: {found} candidates, {admitted} admitted, "
            f"deepest rung {deepest}. Rungs, root first — "
            + "; ".join(
                f"{entry['viewport']['center_re']} + {entry['viewport']['center_im']}i at "
                f"width {entry['viewport']['width']}"
                for entry in chain[:EXAMPLE_COLUMNS]
            )
            + f". The last is scored {rated['score']} by {rated['labeler']} on "
            f"{_day(rated['recorded_at'])}, at data/labels/rows/{rated['_batch']}.jsonl "
            f"line {rated['_line']}."
        )
    return lines


# --------------------------------------------------------------------------- the command

#: Every figure this module draws, and what redraws it. The keys are registry ids, so
#: `builder locations <id>` and a row's `recipe` name the same thing.
MAKERS = {
    "locations-style-spectrum": style_spectrum,
    "locations-rating-examples": rating_examples,
    "locations-random-samples": random_samples,
    "locations-foci-proposals": foci_proposals,
    "locations-walk-step": walk_step,
    "locations-reframe-examples": reframe_examples,
    "locations-framing-ladder": framing_ladder,
    "locations-walk-lengths": walk_lengths,
    "locations-walk-examples": walk_examples,
    "locations-descent-chain": descent_chain,
    "locations-found-and-finished": found_and_finished,
}

#: The figures that land as PNG rather than JPEG: the animated one, which has no JPEG
#: form at all, and the chart, which is flat art a lossy encode would only smear.
LOSSLESS = frozenset({"locations-walk-step", "locations-walk-lengths"})

#: The figures that are more than one frame, and so are copied rather than imported.
ANIMATED = frozenset({"locations-walk-step"})


def recipe(identifier: str) -> dict:
    """The registry recipe for a figure of this module: the maker, and no arguments.

    A maker here takes nothing. Everything it needs — which node, which label line,
    which release — is a named constant beside it, so "adjust this figure" is an edit to
    one line of this file rather than to a row of JSON, and the registry's job is only
    to say *which* function draws it.
    """
    if identifier not in MAKERS:
        raise records.RecordError(f"{identifier} is not drawn by builder.locations")
    return {"maker": f"{__name__}:{MAKERS[identifier].__name__}", "args": {}}


def draw(identifier: str) -> Drawn:
    """Draw one figure, and write its provenance beside the sheet."""
    drawn = MAKERS[identifier]()
    notes = drawn.path.with_suffix(".provenance.txt")
    with notes.open("w", encoding="utf-8", newline="\n") as handle:
        handle.write("\n".join(drawn.provenance) + "\n")
    return drawn
