"""The figures of *From locations to wallpapers*.

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
and nothing else" stopped being true when `finishing-release` landed. `pass_record` opens
`data/curation/gallery/<pass>/pass.json` for the geometry a pass rendered its slots at,
so no figure of this page restates it; and the judged picture itself comes off the
artifacts tree at `curation/runs/<run>/pictures/<candidate>.jpg`, because it is copied
rather than redrawn.

**What is not read, and what waits on it.** A pass's **seating** — which candidate took
which slot, and what it beat — and the **embedding** the clustering was cut on are both
records this module does not open. That is the whole of why `gallery-slots`,
`gallery-embedding`, `gallery-cluster-attempts` and `gallery-floors` are `pending` and
`gallery-output` is `held`: four figures of section 8 are about a pass's own choosing, and
a release row says what a pass decided without saying how. Reaching them is a reader for
those two records, not a composition.

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
`pool-attempt` is a figure of — one iteration pass, two readings of it, and thirty-two
colorings of the first deciding the colour of the second.
"""

from __future__ import annotations

import json
from pathlib import Path

from . import records, renders, sheets
from .locations import SHEET_WIDTH, Drawn, band, panels, release_record, sheet_path, under
from .palettes import strip
from .theme import WELL_INK

#: The two rows these figures stand on, by the key their release record answers to. Matt
#: chose each off a numbered contact sheet — `scratch/contact/pool-attempt.png` tile 40
#: and `scratch/contact/finishing-release.png` tile 58 — and what is written down is the
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
    """`pool-attempt` — one location through one attempt, in the order the run takes it."""
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
    return Drawn(sheets.save(sheet, sheet_path("pool-attempt")), provenance)


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
    """`finishing-release` — the picture a slot was decided on, and the wallpaper it became."""
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
    return Drawn(sheets.save(sheet, sheet_path("finishing-release")), provenance)


MAKERS = {
    "pool-attempt": attempt_steps,
    "finishing-release": finished_beside_judged,
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
