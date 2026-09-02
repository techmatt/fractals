"""The figures of *Finding good wallpapers*.

Section 8's subject is the two processes either side of one store: a **run**, which
searches and judges and empties everything it makes into the pool, and a **gallery
pass**, which reads the whole pool at once and ships a few of them.

## What this module reads today

The **curation release records** carry it, `data/curation/release/<run>/*.jsonl`, one row
per candidate every run and every pass has judged. A row is the whole recipe: the
location, the mode and the curve, the palette anchor and the thirty-two maps of the
candidate set with the palette head's score against each, the map that won, the geometry
it was drawn at, the autolevel stamp, and the finished-render judge's verdict. **A figure
here is addressed by a release key** — `run10|release|0078` — which is a name a record
answers to and not a position in a list, so a pool that grows cannot quietly repoint a
picture at something else.

Two smaller reads hang off a seated row, and they are named because "the release records
and nothing else" stopped being true when `gallery-release` landed. `pass_record` opens
`data/curation/gallery/<pass>/pass.json` for the geometry a pass rendered its slots at,
so no figure of this page restates it; and the judged picture itself comes off the
artifacts tree at `curation/runs/<run>/pictures/<candidate>.jpg`, because it is copied
rather than redrawn.

**What is not read, and what waits on it.** A pass's **seating** — which candidate took
which seat, and what it beat — and the **solve record** the demands and their shortfalls are
written to are both records this module does not open. That is the whole of why
`gallery-pool`, `gallery-allowance`, `gallery-twins` and `gallery-floors` are `pending` and
`gallery-output` is `held`: the figures of section 9 are about a pass's own choosing, and a
release row says what a pass decided without saying how. Reaching them is a reader for those
records, not a composition.

## What is redrawn, and what is copied

The judged picture is **copied**, never redrawn. It is the file the render judge actually
read, and a redraw of it would be a second picture that merely ought to be the same one.
Everything a figure shows *around* that picture — the field it was picked on, the mode
before a palette, the thirty-two colorings — is drawn here from the row's own geometry,
because none of it was kept.

## The field is smooth, and the mode is not

`curation/colorize.py` next door: every candidate of the set is a **recolor of one dumped
smooth field**, and the map that wins then colours whatever mode the attempt drew. So the
palette is chosen on a picture that is not the picture it ends up on, which is the thing
`wallpapers-attempt` is a figure of — one iteration pass, two readings of it, and thirty-two
colorings of the first deciding the colour of the second.
"""

from __future__ import annotations

import json
from pathlib import Path

from . import records, renders, sheets
from .locations import (
    SHEET_WIDTH,
    Drawn,
    band,
    panels,
    release_record,
    rule,
    sheet_path,
    under,
)
from .palettes import strip
from .theme import WELL_INK

#: The two rows these figures stand on, by the key their release record answers to. Matt
#: chose each off a numbered contact sheet — `scratch/contact/wallpapers-attempt.png` tile 40
#: and `scratch/contact/gallery-release.png` tile 58 — and what is written down is the
#: record's own name for what he picked, never the tile number, because the sheet is
#: regenerated and the record is not.
ATTEMPT = ("run10", "0078")
SEAT = ("gallery3", "gallery1_0441")

#: How the candidate set is laid out. Eight across is what `palette-neighborhood` uses for
#: the same thirty-two, so two figures of one candidate set are read at one size.
CANDIDATE_COLUMNS = 8

#: The height of the gradient under a candidate panel — the same strip the palette pages
#: draw, at the size a small tile can carry.
TILE_STRIP_HEIGHT = 12

#: The ramp the dumped field is shown as: black to white, unmirrored, so a panel of it is
#: the field's own lightness and nothing else. Written out to the render cache and handed
#: to the engine as a colormap directory of one, rather than painted in Python — the
#: stretch a reader sees is then the engine's own 0.5/99.5 percentile stretch, the same
#: one every other panel on this page went through, instead of a second operator's
#: reading of the same numbers.
LIGHTNESS = "lightness"
LIGHTNESS_MAP = {
    "schema": 1,
    "name": LIGHTNESS,
    "kind": "sequential",
    "source": (
        "black to white in two stops, written by builder/pool.py so that a dumped field "
        "can be shown as plain lightness through the engine's own coloring stage."
    ),
    "stops": [[0.0, [0, 0, 0]], [1.0, [255, 255, 255]]],
}

#: Where a gallery pass writes down what it did, beside the slot files it filled. The
#: geometry the wallpapers were drawn at is on it, so no figure of this page restates it.
PASS_RECORD = ("data", "curation", "gallery")

#: The size a band's own name is set at. Brighter and a rank up from `locations.heading`,
#: which is for a note beside a picture: these lines say what the block under them *is*,
#: and a reader who cannot follow them cannot follow the figure. `palette-neighborhood`
#: labels its two blocks the same way, and the two figures share a candidate set.
BAND_SIZE = 16

#: The block the crop search moves on, in full-size pixels. The window is scored off block
#: means, so the origin it returns is a multiple of this — a crop is a region of a picture
#: and not a pixel-exact claim, and a coarse grid is what keeps the search honest about
#: that rather than pretending to a precision it does not have.
CROP_BLOCK = 40

#: `.gitattributes` normalizes this repository to LF; anything written here spells it.
LF = "\n"


class PoolError(RuntimeError):
    """A figure of this page cannot be drawn from what the records say."""


# ------------------------------------------------------------------------- the records


def released(run: str, candidate: str) -> dict:
    """One release record, with the picture it was judged on resolved beside it."""
    row = release_record(run, candidate)
    if row is None:
        raise PoolError(f"no release record for {run}|release|{candidate}")
    return row


def pass_record(name: str) -> dict:
    """One gallery pass's own record of the run it was."""
    path = renders.data_file(*PASS_RECORD, name, "pass.json")
    if not path.is_file():
        raise PoolError(f"no pass record at {path}")
    return json.loads(path.read_text(encoding="utf-8"))


def source_key(run: str, candidate: str) -> str:
    """How the figure registry addresses that row."""
    return f"{run}|release|{candidate}"


def spec_of(row: dict, **extra) -> dict:
    """The engine spec that redraws one release row's frame, at the row's own geometry."""
    location = row["location"]
    render = row["recipe"]["render"]
    return {
        "family": location["family"],
        "viewport": location["viewport"],
        "resolution": list(render["resolution"]),
        "supersample": render["supersample"],
        "maxiter": render["maxiter"],
        **extra,
    }


def frame_line(row: dict, lead: str) -> str:
    """A panel's provenance: the family, the frame, and the geometry it was drawn at.

    **This is the line a link is derived from**, so it carries the release key as well:
    `links.py` reads a cited record whole and prefers it to prose about the same picture,
    which is right — the prose was written from the record and one of them is the
    original. It is also why the recipe named here is the *judged* picture's, whatever
    else a panel of the sheet shows, and why this row's is the only line of the record
    that puts the word `colormap` in front of a name.
    """
    location = row["location"]
    family = location["family"]
    kind = family["kind"]
    named = kind if kind != "multibrot" else f"multibrot degree {family.get('degree', 2)}"
    if kind == "julia" and family.get("degree", 2) != 2:
        named = f"julia degree {family['degree']}"
    constants = ""
    if family.get("c"):
        constants = f", c = {family['c'][0]} + {family['c'][1]}i"
    viewport = location["viewport"]
    render = row["recipe"]["render"]
    width, height = render["resolution"]
    recipe = row["recipe"]
    return (
        f"{lead}, and the record it is read off whole — {row['key']}: {named}{constants}, "
        f"centre {viewport['center_re']} + {viewport['center_im']}i, width "
        f"{viewport['width']}; mode {recipe['mode']}, curve {recipe['curve']}, colormap "
        f"{recipe['colormap']}, mirror {'true' if recipe['mirror'] else 'false'}, at "
        f"{width}x{height} supersample {render['supersample']}, maxiter {render['maxiter']}."
    )


def heading(draw, x: int, y: int, text: str) -> None:
    """The line that says what the block of panels under it is."""
    from .theme import font

    draw.text((x, y), text, fill=WELL_INK, font=font(BAND_SIZE))


# ---------------------------------------------------------------------------- the panels


def lightness_dir() -> Path:
    """A colormap directory of one, holding the black-to-white ramp and nothing else."""
    directory = renders.default_cache_root() / "lightness"
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / f"{LIGHTNESS}.json"
    if not path.is_file():
        path.write_text(json.dumps(LIGHTNESS_MAP, indent=2) + LF, encoding="utf-8", newline=LF)
    return directory


def smooth_field(row: dict) -> Path:
    """The one iteration pass the whole attempt is read out of.

    Dumped as `smooth` at the row's own geometry, because that is what a colorize attempt
    dumps: the candidate set is thirty-two recolors of this, not thirty-two renders.
    """
    stem = renders.default_cache_root() / "fields" / f"pool-{row['run']}-{row['candidate']}"
    field, _ = renders.dump_field(spec_of(row, mode="smooth", colormap=renders.COLORMAP), stem)
    return field


def as_lightness(field: Path) -> Path:
    """That field through the black-to-white ramp: the picture before it is a colour."""
    out = renders.default_cache_root() / "candidates" / f"{field.stem}-lightness.png"
    return renders.recolor(
        field,
        out,
        colormap=LIGHTNESS,
        colormap_dir=str(lightness_dir()),
        palette={"mirror": False},
    )


def coloured(field: Path, name: str, mirror: bool) -> Path:
    """One candidate picture: the dumped field through one map, with no re-iteration."""
    key = renders.spec_key("recolor", {"field": field.name, "map": name, "mirror": mirror})
    out = renders.default_cache_root() / "candidates" / f"{field.stem}-{key}.png"
    return renders.recolor(field, out, colormap=name, palette={"mirror": mirror})


def mirrors(names) -> dict[str, bool]:
    """Whether a render folds each map — the pipeline's rule, read off the library."""
    from .palettes import library

    held = library()
    found = {}
    for name in names:
        palette = held.get(name)
        if palette is None:
            raise PoolError(f"the candidate set names {name!r}, and the library holds no such map")
        found[name] = palette.mirror
    return found


def drawn_mode(row: dict) -> Path:
    """The mode the attempt drew, in the neutral map, at the row's own geometry."""
    recipe = row["recipe"]
    out = (
        renders.default_cache_root()
        / "panels"
        / f"pool-{row['run']}-{row['candidate']}-{recipe['mode']}-neutral.png"
    )
    return renders.render(spec_of(row, mode=recipe["mode"], colormap=renders.COLORMAP), out)


# ------------------------------------------------------------------- one attempt, in four


def attempt_steps() -> Drawn:
    """`wallpapers-attempt` — one location through one attempt, in the order the run takes it."""
    row = released(*ATTEMPT)
    recipe = row["recipe"]
    palette = row["palette"]
    names = list(palette["candidates"])
    scores = list(palette["scores"])
    if len(names) != len(scores):
        raise PoolError(f"{source_key(*ATTEMPT)} has {len(names)} candidates and {len(scores)}")
    picked = max(range(len(names)), key=lambda index: scores[index])
    if names[picked] != recipe["colormap"]:
        raise PoolError(
            f"{source_key(*ATTEMPT)} was drawn in {recipe['colormap']} and the head's best "
            f"candidate is {names[picked]}"
        )

    field = smooth_field(row)
    lightness = as_lightness(field)
    mode = drawn_mode(row)
    judged = row["_picture"]
    folds = mirrors(names)
    candidates = [coloured(field, name, folds[name]) for name in names]

    wide = panels(2)
    tile = panels(CANDIDATE_COLUMNS)
    cell = tile[1] + 3 + TILE_STRIP_HEIGHT
    rows = -(-len(names) // CANDIDATE_COLUMNS)
    wide_band = band(wide[1])
    head = 22

    height = (
        sheets.PAD
        + head
        + wide[1]
        + wide_band
        + sheets.PAD
        + head
        + rows * (cell + sheets.PAD)
        + head
        + wide[1]
        + wide_band
        + sheets.PAD
    )
    sheet, draw = sheets.canvas(SHEET_WIDTH, height)

    y = sheets.PAD
    heading(draw, sheets.PAD, y, "One iteration pass, and the two pictures it is read as")
    y += head
    for index, (picture, label) in enumerate(
        (
            (lightness, "the smooth field, as plain lightness"),
            (mode, f"{recipe['mode']}, the mode this attempt drew"),
        )
    ):
        x = sheets.PAD + index * (wide[0] + sheets.PAD)
        sheets.paste(sheet, picture, (x, y), wide)
        under(draw, (x, y), wide, [label])
    y += wide[1] + wide_band + sheets.PAD

    heading(
        draw,
        sheets.PAD,
        y,
        "Thirty-two colourings of that same field — the palette judge's pick outlined",
    )
    y += head
    for index, name in enumerate(names):
        x = sheets.PAD + (index % CANDIDATE_COLUMNS) * (tile[0] + sheets.PAD)
        top = y + (index // CANDIDATE_COLUMNS) * (cell + sheets.PAD)
        sheets.paste(sheet, candidates[index], (x, top), tile)
        sheets.paste(
            sheet,
            strip(name, tile[0], TILE_STRIP_HEIGHT),
            (x, top + tile[1] + 3),
            (tile[0], TILE_STRIP_HEIGHT),
        )
        if index == picked:
            _outline(draw, (x, top, x + tile[0] - 1, top + tile[1] - 1))
    y += rows * (cell + sheets.PAD)

    x = (SHEET_WIDTH - wide[0]) // 2
    heading(draw, x, y, "The picture the render judge scores: that mode, through that map")
    y += head
    sheets.paste(sheet, judged, (x, y), wide)
    under(draw, (x, y), wide, [f"{recipe['mode']} through {recipe['colormap']}"])

    ranked = sorted(range(len(names)), key=lambda index: -scores[index])
    provenance = [
        f"Release row {source_key(*ATTEMPT)}, drawn by builder.pool:attempt_steps. Every "
        "panel but the last is redrawn here from that row's own geometry; the last panel is "
        f"the file the render judge read, {row['picture'].replace(chr(92), '/')} under that "
        "run, copied and not redrawn.",
        frame_line(row, "Every panel is this frame, and the last panel is this recipe"),
        "Panel 1 is `fractal-engine dump-field` at mode smooth — the one pass a colorize "
        "attempt makes — recoloured through a two-stop black-to-white ramp written by "
        "builder/pool.py, so the stretch shown is the engine's own 0.5/99.5 percentile "
        "stretch rather than a second reading of the field.",
        f"Panel 2 is `fractal-engine render` at mode {recipe['mode']} "
        f"({recipe['mode_kind']}, curve {recipe['curve']}) through the neutral map "
        f"{renders.COLORMAP}: the mode before any palette, and not the picture that was judged.",
        f"The block is the row's own candidate set — palettes.space.neighbourhood around the "
        f"anchor {palette['anchor']}, {len(names)} maps — each a recolor of the same dumped "
        "field, folded where the library calls the map sequential, in the record's own order. "
        "The strip under a panel is `fractal-wallpapers palettes strip` for that map.",
        "The palette head's scores, best first: "
        + ", ".join(f"palette {names[index]} {scores[index]:.6f}" for index in ranked),
        f"The last panel is palette {recipe['colormap']}, the head's best of that set, over "
        f"mode {recipe['mode']}; the autolevel operator was on and did not act on this row, so "
        "the picture is the render's own bytes.",
        "What the render judge said, which the figure does not print: head "
        f"{row['scores']['head']}, P(>=3) {row['scores']['p_ge3']:.6f}, "
        f"P(>=4) {row['scores']['p_ge4']:.6f}, verdict "
        f"{row['verdict']} — {row['reason']}. It is in the pool either way, which is the point "
        "of the page.",
    ]
    return Drawn(sheets.save(sheet, sheet_path("wallpapers-attempt")), provenance)


def _outline(draw, box, colour=WELL_INK, width: int = 3) -> None:
    x0, y0, x1, y1 = box
    draw.rectangle([x0 - 1, y0 - 1, x1 + 1, y1 + 1], outline=(0, 0, 0), width=width + 1)
    draw.rectangle([x0, y0, x1, y1], outline=colour, width=width)


# --------------------------------------------------------- the small render and the wallpaper


def crop_window(full: Path, small: Path, block: int = CROP_BLOCK) -> tuple[int, int, float, float]:
    """Where the wallpaper carries texture the judged picture cannot, as `(x, y, gain, mean)`.

    The two pictures are the same frame at two scales, so the question has an answer that
    is not a matter of taste: enlarge the small render to the wallpaper's size and ask
    where the wallpaper disagrees with it most. What is left over is exactly the detail
    the extra samples bought — filigree finer than a 640x360 grid can hold — and the
    window with the most of it is the one worth cropping.

    Scored off block means rather than pixels: the answer wanted is a region, and a search
    that returned a pixel-exact origin would be claiming a precision it does not have.
    `gain` is the winning window's mean absolute difference and `mean` is the whole
    frame's, so a caller can say how much better than average the crop it chose is.
    """
    from PIL import Image, ImageChops

    with Image.open(full) as opened:
        wide = opened.convert("L")
    with Image.open(small) as opened:
        narrow = opened.convert("L")
    if wide.width % narrow.width or wide.height % narrow.height:
        raise PoolError(f"{wide.size} is not a whole multiple of {narrow.size}")
    lost = ImageChops.difference(wide, narrow.resize(wide.size, Image.LANCZOS))

    across, down = wide.width // block, wide.height // block
    means = list(lost.resize((across, down), Image.BOX).getdata())
    # A summed-area table over the block means, so every window is four lookups.
    total = [[0.0] * (across + 1) for _ in range(down + 1)]
    for j in range(down):
        for i in range(across):
            total[j + 1][i + 1] = (
                means[j * across + i] + total[j][i + 1] + total[j + 1][i] - total[j][i]
            )
    wide_blocks, high_blocks = narrow.width // block, narrow.height // block
    if wide_blocks < 1 or high_blocks < 1:
        raise PoolError(f"a {narrow.size} window does not fit the {block}px search grid")
    cells = wide_blocks * high_blocks
    best, where = -1.0, (0, 0)
    for j in range(down - high_blocks + 1):
        for i in range(across - wide_blocks + 1):
            score = (
                total[j + high_blocks][i + wide_blocks]
                - total[j][i + wide_blocks]
                - total[j + high_blocks][i]
                + total[j][i]
            ) / cells
            if score > best:
                best, where = score, (i * block, j * block)
    return where[0], where[1], best, total[down][across] / (across * down)


def finished_beside_judged() -> Drawn:
    """`gallery-release` — the picture a seat was decided on, and the wallpaper it became."""
    from PIL import Image

    row = released(*SEAT)
    recipe = row["recipe"]
    wallpaper = row["_picture"]
    source = row["source"]
    judged = renders.artifact(
        "curation/runs", source["run"], "pictures", f"{source['candidate']}.jpg"
    )
    if not judged.is_file():
        raise PoolError(f"the seated candidate's judged picture is not at {judged}")

    with Image.open(wallpaper) as opened:
        full = opened.convert("RGB")
    with Image.open(judged) as opened:
        judged_picture = opened.convert("RGB")
    scale = full.width // judged_picture.width
    x, y, gain, mean = crop_window(wallpaper, judged)
    crop = full.crop((x, y, x + judged_picture.width, y + judged_picture.height))

    wide = panels(2)
    head = 22
    label = band(wide[1])
    sheet, draw = sheets.canvas(SHEET_WIDTH, sheets.PAD + head + wide[1] + label + sheets.PAD)

    top = sheets.PAD + head
    heading(
        draw,
        sheets.PAD,
        sheets.PAD,
        "The same frame at both sizes, pixel for pixel — the marked region is what is "
        "enlarged beside it",
    )
    left = sheets.PAD
    sheet.paste(judged_picture.resize(wide, Image.LANCZOS), (left, top))
    marked = (
        left + round(x / scale * wide[0] / judged_picture.width),
        top + round(y / scale * wide[1] / judged_picture.height),
        left + round((x / scale + judged_picture.width / scale) * wide[0] / judged_picture.width),
        top + round((y / scale + judged_picture.height / scale) * wide[1] / judged_picture.height),
    )
    _outline(draw, marked, width=2)
    under(draw, (left, top), wide, ["the picture the slot was decided on"])

    right = sheets.PAD + wide[0] + sheets.PAD
    sheet.paste(crop.resize(wide, Image.LANCZOS), (right, top))
    under(draw, (right, top), wide, [f"the wallpaper, at {scale}x, over that region"])

    geometry = pass_record(row["slot"]["pass"])["render"]["geometry"]
    if list(geometry["resolution"]) != [full.width, full.height]:
        raise PoolError(
            f"{row['slot']['pass']} says it rendered at {geometry['resolution']} and the "
            f"wallpaper on disk is {full.width}x{full.height}"
        )
    samples = geometry["supersample"] ** 2
    provenance = [
        f"Release row {source_key(*SEAT)}, drawn by builder.pool:finished_beside_judged. "
        "Neither panel is redrawn: the left is the file the render judge read, "
        f"{source['run']}/pictures/{source['candidate']}.jpg, and the right is a crop of the "
        f"finished wallpaper {row['picture'].replace(chr(92), '/')} under that pass's run.",
        frame_line(row, "Both panels are this frame, and the left one is this recipe"),
        f"The seat: pass {row['slot']['pass']}, slot {row['slot']['id']}, partition "
        f"{row['location']['partition']}, head {row['scores']['head']}; the candidate was made "
        f"by run {source['run']} as {source['candidate']} and seated by the pass, which is why "
        "its id carries both.",
        f"The wallpaper is {full.width}x{full.height} supersample "
        f"{geometry['supersample']} — {samples} samples a pixel, off that pass's own record — "
        f"which is {scale} times the judged picture on each axis, and no judge has seen it; "
        "the release autolevel operator was on and did not act, so it is the render's own bytes.",
        f"The crop is the {judged_picture.width}x{judged_picture.height} window of the "
        f"wallpaper at ({x}, {y}), which is ({x // scale}, {y // scale}) size "
        f"{judged_picture.width // scale}x{judged_picture.height // scale} in the judged "
        "picture. Chosen by builder.pool:crop_window: the judged picture enlarged to the "
        "wallpaper's size and subtracted from it, the whole frame's mean absolute difference "
        f"{mean:.2f} of 255 and this window's {gain:.2f}, the highest of any window on a "
        f"{CROP_BLOCK}px grid. Both panels are shown at {wide[0]}x{wide[1]}, so the right is "
        "the wallpaper's own pixels and the left is the judged picture's own.",
        f"Palette {recipe['colormap']}, chosen by the palette head out of the "
        f"{len(row['palette']['candidates'])}-map set around the anchor "
        f"{row['palette']['anchor']}.",
    ]
    return Drawn(sheets.save(sheet, sheet_path("gallery-release")), provenance)


# ------------------------------------------------------------------- one visit, in full
#
# `wallpapers-attempt` above is one *attempt* — one location, one mode, and the palette
# neighbourhood that decided its colour. This is the layer above it: one **visit**, the
# few dozen attempts a mine makes at one place before it moves on, and the few of them the
# pool keeps.
#
# ## Which records a visit is read out of
#
# A mine writes `artifacts/curation/depth/<run>/sequence.jsonl`, one row an attempt in the
# order it was drawn, carrying the location it was at, the mode, the map, the cap and the
# judge's two probabilities; `scores.jsonl` beside it carries the fitted rank each attempt
# was ranked on. Those two are the visit. **Which of them survived is a third read** — the
# candidate ledger, in one streamed pass that never loads the pool, because retention runs
# later and afterwards and the run's own records still list every attempt it made.
#
# ## Why the pictures are the stored JPEGs
#
# Everywhere else on this site a panel is redrawn from a record, because a redraw is
# sharper and the record is the truth. Here it would be a lie of a kind: the claim of the
# figure is *the judge scored these and kept those*, and the files under `pictures/` are
# the ones the judge read. So they are copied, at the 640x360 the judges were trained at,
# and the only thing the engine draws for this figure is the field panel at the head of
# each mode — which the run dumped and did not keep.
#
# ## Why a visit whose pictures still exist is hard to find
#
# Retention deletes a pruned candidate's row and its picture together, so most visits are
# a set of survivors with holes where the rest were. A figure of the retention rule needs a
# visit that still has both halves, and there are very few. This one is named below.

#: The visit: the mine run, and the location key it visited. A location key is the
#: record's own name for the place — the partition, the degree, the family constants, the
#: centre and the width — so this is an address and not a position in anything.
MINE = (
    "teal_pilot",
    '["mandelbrot", 2, [], "-0.0779555612343306", "-0.6515573959617936", '
    '"0.00000013055391824593846"]',
)

#: The seat this location holds in the recorded tentative gallery it was picked out of.
#: The seated picture is **not** from the visit drawn here — it was made by a later mine at
#: the same place — and the row is cited because it is how the location was chosen, which
#: is the thing a source key is for.
MINE_SEAT = ("20260902T164622Z", "7836b31cb1ea13cb")

#: The mode this visit drew that the article does not teach. The ruling of 2026-09-01 is
#: that this site shows only the modes the galleries draw, which is why `gaussian_int` came
#: off `modes-gallery` and `modes-field-family`; a figure that put it back under a caption
#: about *the modes a mine cycles* would be teaching a name the article withholds. Its four
#: attempts are named in the provenance instead, so the record is still the whole visit.
MINE_UNTAUGHT = "gaussian_int"

#: How many candidates a mode's row holds. Five, because that is what this visit drew in
#: each of the four modes it is shown in, and a row that is the mode is what makes the
#: three-per-mode retention rule legible without a word being spent on it.
MINE_COLUMNS = 5

#: The two rows of the sheet: the fields at the head, one a mode, and the candidates under
#: them. Four across for the fields, because there are four modes and each one dumped one.
MINE_FIELD_COLUMNS = 4


def mine_file(run: str, name: str) -> Path:
    """One of a mine run's own records, under the artifacts tree it wrote them into."""
    path = renders.artifact("curation", "depth", run, name)
    if not path.is_file():
        raise PoolError(f"mine run {run} has no {name}, at {path}")
    return path


def visit_rows(run: str, location: str) -> list[dict]:
    """Every attempt one mine made at one location, in the order it drew them.

    Two of the run's own files, joined on the recipe key. `sequence.jsonl` is the order
    and the cost — which attempt came when, what the dump stage was charged, what the
    judge said — and `rows.jsonl` beside it carries the recipe, which the sequence does
    not: **the frame a mine draws is not always the frame the location key names**, and a
    figure of a visit has to stand on the frame that was drawn.
    """
    with mine_file(run, "rows.jsonl").open(encoding="utf-8") as handle:
        recipes = {
            str(row["key"]): row
            for row in (json.loads(line) for line in handle if line.strip())
            if row["location"]["key"] == location
        }
    with mine_file(run, "sequence.jsonl").open(encoding="utf-8") as handle:
        found = [
            row
            for row in (json.loads(line) for line in handle if line.strip())
            if row.get("location") == location
        ]
    if not found:
        raise PoolError(f"{run} recorded no attempt at {location}")
    missing = sorted(row["key"] for row in found if row["key"] not in recipes)
    if missing:
        raise PoolError(
            f"{run} drew {', '.join(missing)} at this location and wrote no recipe row for "
            "it, so nothing says what frame or what map it was"
        )
    return [dict(row, recipe=recipes[row["key"]]["recipe"]) for row in found]


def visit_scores(run: str, keys) -> dict[str, dict]:
    """The fitted rank and the judge's probabilities for the keys asked for."""
    path = renders.artifact("curation", "depth", run, "scores.jsonl")
    if not path.is_file():
        raise PoolError(f"no scores beside {run}'s sequence, at {path}")
    wanted = set(keys)
    found: dict[str, dict] = {}
    with path.open(encoding="utf-8") as handle:
        for line in handle:
            if not line.strip():
                continue
            row = json.loads(line)
            key = str(row.get("recipe_key"))
            if key in wanted and key not in found:
                found[key] = row
    missing = sorted(wanted - set(found))
    if missing:
        raise PoolError(f"{run} scored none of {', '.join(missing)}, and every tile prints a score")
    return found


def surviving(keys) -> set[str]:
    """Which of these attempts are still in the candidate pool, one streamed pass.

    Never `headroom.population()` and never the pool: a solve may be reading the ledger
    next door, and what is wanted here is a membership test over a couple of dozen keys.
    """
    from .picks import ledger_recipes

    return set(ledger_recipes(keys))


def visit_seat(stamp: str, key: str) -> dict:
    """The seat a location holds in one recorded tentative gallery."""
    from .picks import seats

    row = seats(stamp).get(key)
    if row is None:
        raise PoolError(f"no seat {key} in the tentative gallery recorded under {stamp}")
    return row


#: The regime a visit's candidates are drawn at — the geometry the judges were trained
#: at, which every row of this visit records as its own.
MINE_REGIME = ((640, 360), 2)


def mine_spec(row: dict, **extra) -> dict:
    """The engine spec that redraws one attempt's frame, at the regime it was drawn at."""
    recipe = row["recipe"]
    resolution, supersample = MINE_REGIME
    return {
        "family": recipe["family"],
        "viewport": recipe["viewport"],
        "resolution": list(resolution),
        "supersample": supersample,
        "maxiter": recipe["maxiter"],
        **extra,
    }


def mine_field(run: str, row: dict) -> Path:
    """One mode's field at this location, dumped once and shown as plain lightness.

    The same two steps `attempt_steps` takes for its one field, and the same reason: the
    stretch a reader sees is the engine's own percentile stretch rather than a second
    operator's reading of the same numbers.
    """
    stem = renders.default_cache_root() / "fields" / f"mine-{run}-{row['key']}-{row['mode']}"
    field, _ = renders.dump_field(mine_spec(row, mode=row["mode"], colormap=renders.COLORMAP), stem)
    return as_lightness(field)


def visit_steps() -> Drawn:
    """`wallpapers-mine` — one location, everything one mine drew there, and what it kept."""
    from .picks import mode_words

    run, location = MINE
    rows = visit_rows(run, location)
    scores = visit_scores(run, [row["key"] for row in rows])
    kept = surviving([row["key"] for row in rows])
    seat = visit_seat(*MINE_SEAT)

    shown = [row for row in rows if row["mode"] != MINE_UNTAUGHT]
    order: list[str] = []
    for row in shown:
        if row["mode"] not in order:
            order.append(row["mode"])
    if len(order) != MINE_FIELD_COLUMNS:
        raise PoolError(
            f"{run} drew {len(order)} teachable mode(s) at this location and the sheet is "
            f"laid out for {MINE_FIELD_COLUMNS}"
        )
    by_mode = {
        mode: sorted(
            (row for row in shown if row["mode"] == mode),
            key=lambda row: -scores[row["key"]]["rank_score"],
        )
        for mode in order
    }
    for mode, drawn in by_mode.items():
        if len(drawn) != MINE_COLUMNS:
            raise PoolError(
                f"{run} drew {len(drawn)} candidate(s) in {mode} at this location and a row "
                f"of this sheet is {MINE_COLUMNS} wide"
            )

    wide = panels(MINE_FIELD_COLUMNS)
    tile = panels(MINE_COLUMNS)
    fields = {mode: mine_field(run, by_mode[mode][0]) for mode in order}
    pictures = {
        row["key"]: renders.artifact("curation", "depth", run, "pictures", f"{row['key']}.jpg")
        for row in shown
    }
    absent = sorted(key for key, path in pictures.items() if not path.is_file())
    if absent:
        raise PoolError(
            f"{run} no longer has the picture for {', '.join(absent)} — retention deletes a "
            "pruned candidate's row and its picture together, and this figure is the one that "
            "shows both halves"
        )

    head = 22
    field_band = band(wide[1])
    cell = tile[1] + 3 + TILE_STRIP_HEIGHT
    row_height = head + cell + band(tile[1]) + sheets.PAD
    height = (
        sheets.PAD
        + head
        + wide[1]
        + field_band
        + sheets.PAD
        + 1
        + sheets.PAD
        + MINE_FIELD_COLUMNS * row_height
        + 26
        + sheets.PAD
    )
    sheet, draw = sheets.canvas(SHEET_WIDTH, height)

    y = sheets.PAD
    heading(
        draw,
        sheets.PAD,
        y,
        "One visit to one location — each mode's field, dumped once and painted five times",
    )
    y += head
    for index, mode in enumerate(order):
        x = sheets.PAD + index * (wide[0] + sheets.PAD)
        sheets.paste(sheet, fields[mode], (x, y), wide)
        under(draw, (x, y), wide, [mode_words(mode)])
    y += wide[1] + field_band + sheets.PAD
    rule(draw, y)
    y += 1 + sheets.PAD

    for mode in order:
        drawn = by_mode[mode]
        survivors = sum(1 for row in drawn if row["key"] in kept)
        heading(
            draw,
            sheets.PAD,
            y,
            f"{mode_words(mode)} — {len(drawn)} palettes, best first · {survivors} kept",
        )
        top = y + head
        for index, row in enumerate(drawn):
            x = sheets.PAD + index * (tile[0] + sheets.PAD)
            sheets.paste(sheet, pictures[row["key"]], (x, top), tile)
            sheets.paste(
                sheet,
                strip(row["colormap"], tile[0], TILE_STRIP_HEIGHT),
                (x, top + tile[1] + 3),
                (tile[0], TILE_STRIP_HEIGHT),
            )
            score = scores[row["key"]]
            sheets.tile_label(
                draw,
                (x, top + cell - tile[1]),
                tile,
                [f"P(≥4) {score['p_ge4']:.4f} · rank {score['rank_score']:.4f}"],
                SHEET_WIDTH,
            )
            if row["key"] in kept:
                _outline(draw, (x, top, x + tile[0] - 1, top + tile[1] - 1))
        y += row_height

    sheets.provenance_line(
        draw,
        sheets.PAD,
        y,
        "the outline is what the pool holds today; retention keeps three a mode, decided on "
        "the ranking as it now stands rather than on the rank this run recorded",
    )

    return Drawn(
        sheets.save(sheet, sheet_path("wallpapers-mine")),
        mine_provenance(run, location, rows, shown, order, by_mode, scores, kept, seat, wide, tile),
    )


def mine_provenance(
    run, location, rows, shown, order, by_mode, scores, kept, seat, wide, tile
) -> list[str]:
    """Every attempt of the visit, kept or not, and the three reads it was assembled from."""
    from .picks import mode_words

    first = rows[0]["recipe"]
    family = first["family"]
    viewport = first["viewport"]
    dumps = sum(1 for row in rows if row["stages"]["dump"] > 0.01)
    cut = [row for row in rows if row["mode"] == MINE_UNTAUGHT]
    stamp, key = MINE_SEAT
    lines = [
        f"Mine run {run}, one visit, drawn by builder.pool:visit_steps. The visit is read "
        f"out of three records and nothing else: artifacts/curation/depth/{run}/"
        f"sequence.jsonl for what was drawn, scores.jsonl beside it for the fitted rank each "
        "attempt was ranked on, and the candidate ledger — one streamed pass, never the pool "
        "— for which of them retention has left standing.",
        f"The location, as the record names it: {location}. Every panel is that frame — "
        f"{family['kind']}, centre {viewport['center_re']} + {viewport['center_im']}i, width "
        f"{viewport['width']}, cap {first['maxiter']}, curve {first['curve']}, at the "
        f"candidate regime {first['regime']}. It is seated in the tentative gallery "
        f"recorded under {stamp}, at "
        f"seat {seat['seat']} in partition {seat['partition']} by {key}, whose picture a later "
        f"mine made in mode {seat['mode']} — the seat is how this location was chosen and is "
        "not one of the pictures shown here.",
        f"The visit: {len(rows)} attempts across {len({row['mode'] for row in rows})} modes, "
        f"drawn at positions {min(row['at'] for row in rows)}–{max(row['at'] for row in rows)} "
        f"of the run, in {dumps} field dumps — the run paid for one field a mode and painted "
        f"the rest, which took {sum(row['seconds'] for row in rows):.1f} seconds in total.",
        f"Drawn here: {len(shown)} of them, in the {len(order)} modes this article teaches. "
        f"The visit also drew {MINE_UNTAUGHT} {len(cut)} times, and that mode is off the "
        "article's roster by the ruling of 2026-09-01 that this site shows only the modes the "
        "galleries draw — the same cut modes-gallery and modes-field-family took. Its four, "
        "for the record: "
        + " · ".join(
            f"palette {row['colormap']} rank {scores[row['key']]['rank_score']:.4f} "
            f"P(>=4) {scores[row['key']]['p_ge4']:.6f} "
            f"{'kept' if row['key'] in kept else 'pruned'}"
            for row in sorted(cut, key=lambda row: -scores[row["key"]]["rank_score"])
        )
        + ".",
        f"The head of each mode's row is `fractal-engine dump-field` at that mode, at the "
        f"visit's own geometry, recoloured through the two-stop black-to-white ramp "
        f"builder/pool.py writes — so it is the engine's own 0.5/99.5 percentile stretch and "
        f"not a second reading of the field. Shown at {wide[0]}x{wide[1]}.",
        f"Every candidate tile is the stored picture the render judge read, "
        f"artifacts/curation/depth/{run}/pictures/<key>.jpg at 640x360 supersample 2, copied "
        f"and not redrawn, shown at {tile[0]}x{tile[1]}. This is the one figure on the site "
        "whose panels are the judged files rather than fresh renders: the claim is that these "
        "were scored and those were kept, and a redraw would be a second picture that merely "
        "ought to be the same one. The strip under a tile is `fractal-wallpapers palettes "
        "strip` for that map. Every panel carried the release autolevel operator on, and it "
        "acted on none of them.",
    ]
    for mode in order:
        drawn = by_mode[mode]
        survivors = sum(1 for row in drawn if row["key"] in kept)
        lines.append(
            f"{mode_words(mode)} ({mode}) — {len(drawn)} drawn, {survivors} kept, best first: "
            + " · ".join(
                f"palette {row['colormap']} rank {scores[row['key']]['rank_score']:.4f} "
                f"P(>=4) {scores[row['key']]['p_ge4']:.6f} "
                f"P(>=3) {scores[row['key']]['p_ge3']:.6f} "
                f"{'kept' if row['key'] in kept else 'pruned'} [{row['key']}]"
                for row in drawn
            )
            + "."
        )
    lines.append(
        "The tiles are ordered by the rank this run recorded and the outline is what the "
        "candidate ledger still holds, and the two disagree at the third seat of two of these "
        "four modes: retention was applied against the ranking as it stands now, and the rank "
        "key is refitted whenever the judges behind it are. Nothing here is a claim that the "
        "printed number chose the outline — it is the number the run wrote down beside the "
        "picture the judge read."
    )
    return lines


MAKERS = {
    "wallpapers-attempt": attempt_steps,
    "wallpapers-mine": visit_steps,
    "gallery-release": finished_beside_judged,
}


def recipe(identifier: str) -> dict:
    """The registry recipe for a figure of this module: the maker, and no arguments."""
    if identifier not in MAKERS:
        raise records.RecordError(f"{identifier} is not drawn by builder.pool")
    return {"maker": f"{__name__}:{MAKERS[identifier].__name__}", "args": {}}


def draw(identifier: str) -> Drawn:
    if identifier not in MAKERS:
        raise records.RecordError(f"{identifier} is not drawn by builder.pool")
    return MAKERS[identifier]()
