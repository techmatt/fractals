"""Composing a figure out of panels. Pillow only; no engine anywhere in here.

A contact sheet is the article's commonest figure: panels in a grid on the site's dark
well, a line or two of label under each, sometimes a box marking what the next panel
zooms into, sometimes a numbered ring pointing at a spot on a map. Every rig that has
ever drawn one re-implemented all of it, and the three that exist agree about the
padding by coincidence.

The split this module is one half of is the point of it. **Composition takes paths**:
give it PNGs and it gives you a sheet, and it neither knows nor cares whether those
panels came out of the fractal engine, off a curation run's release directory, or out
of `diagrams.py`. So it runs anywhere, needs nothing outside this repository, and is
the part a figure gets adjusted in — which is the part that gets adjusted most.
`renders.py` is the other half and the only one that shells anything.

Sizes here are the ones the made figures were composed at, so a sheet drawn against
these defaults matches the ones already in `assets/images/figures/`.
"""

from __future__ import annotations

from pathlib import Path

from .theme import SECTION_INK, SEMIBOLD, WELL, WELL_INK, WELL_INK_DIM, font, text_width

#: A real minus sign, not a hyphen. Every number a figure prints goes through here:
#: the labels are typeset, not code, and `-0.8038` in a caption reads as a dash.
MINUS = "−"

#: The separator between two facts on one label line.
MIDDOT = " · "

#: The gutter between panels, and the margin around the sheet — one number, because a
#: sheet with a different margin than gutter looks like a mistake at every size.
PAD = 12

#: The size a label not under a tile is drawn at — a note beside a panel, a block's own
#: name. The label *under* a tile is not this; it is `label_size` below, and there is no
#: per-figure knob for it.
LABEL_SIZE = 16


# ------------------------------------------------------------------- the tile-label rule
#
# **One rule for every label drawn under a tile, site-wide** *(Matt, 2026-08-22)*. Every
# sheet used to name its own label size — 13 here, 17 there — and every one of them was
# chosen by looking at the sheet at the size it was composed at. Nothing is ever read at
# that size. A figure is displayed at the article column's width whatever it was composed
# at, and the sheets are composed at anything from 1316 to 2688 wide, so the same 17px
# label is ten reading pixels under one figure and seven under another. Seven is not a
# size; it is a smudge that happens to have been a sentence.
#
# So the size is derived twice and the larger wins:
#
# - **from the tile**, at `LABEL_TILE_SHARE` of its height, so a label stays in
#   proportion to the picture it names — a big panel earns a bigger label;
# - **from the sheet**, at `LABEL_SHEET_SHARE` of its width, which is the floor. A
#   sheet's width is what the column's width divides by, so this share is the one number
#   that means the same thing on every figure: about twelve reading pixels, a step under
#   the figure's own caption, whatever the sheet was composed at. A floor typed in the
#   sheet's own pixels cannot do that — 20 is legible on a 1316-wide sheet and half a
#   size too small on a 2688-wide one.
#
# The tile share is Matt's 2.5–3%, and it is what a big panel gets: the map panel of
# `escape-julia-map` is 738 tall and takes 20px by it. Everywhere the tiles are small
# relative to their sheet — which is most of the site — the sheet floor is what applies.

#: A tile label's size as a share of the tile's height.
LABEL_TILE_SHARE = 0.0275

#: The floor, as a share of the composed sheet's width. See above for why it is a share.
LABEL_SHEET_SHARE = 0.0145

#: The air between a tile and its label, and one line of label with its leading — both
#: as shares of the label's own size, so the band under a tile grows with the type in it.
LABEL_GAP_SHARE = 0.4
LABEL_LINE_SHARE = 1.35

#: Nothing steps down past this, however long the line is. A label that will not fit its
#: tile at a readable size is a label somebody has to shorten, not a size to keep cutting.
LABEL_FLOOR = 14


def label_size(tile_height: int, sheet_width: int) -> int:
    """The size the label under a tile of this shape is drawn at. The only answer."""
    return max(
        round(LABEL_TILE_SHARE * tile_height),
        round(LABEL_SHEET_SHARE * sheet_width),
    )


def fitted_size(draw, lines, tile_width: int, size: int) -> int:
    """That size, stepped down until the longest line stops running past the tile.

    **A tile label is never wider than its tile.** Centred, an overlong line runs into
    the gutter on both sides and collides with the label beside it, which is worse than
    a size smaller. The band the caller laid out is still the unstepped size's, so a row
    of tiles keeps one baseline even where one label in it had to give way.
    """
    while size > LABEL_FLOOR:
        face = font(size)
        if all(text_width(draw, line, face) <= tile_width for line in lines):
            break
        size -= 1
    return size


def caption_band(tile_height: int, sheet_width: int, lines: int = 1) -> int:
    """How much room that label needs under the tile, for a caller laying out around it."""
    size = label_size(tile_height, sheet_width)
    return round(size * (LABEL_GAP_SHARE + lines * LABEL_LINE_SHARE))


def centred(draw, x: int, y: int, room: int, text: str, face, fill) -> None:
    """One line, centred in a box of this width. The primitive under every tile label."""
    left, _, right, _ = draw.textbbox((0, 0), text, font=face)
    draw.text((x + (room - (right - left)) / 2, y), text, fill=fill, font=face)


def tile_label(
    draw,
    origin: tuple[int, int],
    tile: tuple[int, int],
    lines,
    sheet_width: int,
    *,
    lead=WELL_INK,
    inks=None,
    semibold_lead: bool = False,
) -> None:
    """The label under one tile: centred on it, sized by the rule above.

    `origin` is the tile's own top-left and `tile` its size, so a caller says where the
    picture is and never where the lettering goes. The first line leads and the rest are
    a rank quieter, which is what lets a label say what the panel *is* and then what it
    was made from; `inks` overrides the fills line by line where a figure colours a label
    to match something in the picture, and `semibold_lead` is for the one figure whose
    first line names an outcome rather than describing a panel.
    """
    if isinstance(lines, str):
        lines = [lines]
    x, y = origin
    tile_width, tile_height = tile
    size = label_size(tile_height, sheet_width)
    step = round(size * LABEL_LINE_SHARE)
    top = y + tile_height + round(size * LABEL_GAP_SHARE)
    size = fitted_size(draw, lines, tile_width, size)
    face, strong = font(size), font(size, SEMIBOLD)
    for index, line in enumerate(lines):
        ranked = lead if index == 0 else WELL_INK_DIM
        fill = ranked if inks is None else inks[index]
        chosen = strong if index == 0 and semibold_lead else face
        centred(draw, x, top + index * step, tile_width, line, chosen, fill)


# ------------------------------------------------------------------- number formatting


def number(value: float, places: int = 4) -> str:
    """A fixed-point number, typeset: real minus, the places a caption can read."""
    return f"{value:.{places}f}".replace("-", MINUS)


def complex_text(pair, places: int = 4) -> str:
    """`a + bi`, from the two-string spelling every record in this project uses.

    Records carry a complex number as a pair of decimal *strings* rather than floats,
    because a deep location needs more digits than a float literal survives. Both
    spellings arrive here — a pair of strings off a ledger, or a Python `complex` — and
    both come out reading the same way.
    """
    if isinstance(pair, complex):
        real, imaginary = pair.real, pair.imag
    else:
        real, imaginary = (float(part) for part in pair)
    sign = "+" if imaginary >= 0 else MINUS
    return f"{number(real, places)} {sign} {number(abs(imaginary), places)}i"


def width_text(width: float | str) -> str:
    """A frame width, in the form that is readable at the width it happens to be.

    Three significant figures while a frame is something a person could measure, and
    scientific notation with a typeset exponent once it is not — a deep frame is `1e-13`
    to a machine and `1x10^-13` to a reader.
    """
    value = float(width)
    if value >= 0.001:
        return f"{value:.3g}"
    mantissa, exponent = f"{value:.2e}".split("e")
    return f"{mantissa}×10{MINUS}{abs(int(exponent))}"


# -------------------------------------------------------------------------- the canvas


def canvas(width: int, height: int):
    """A sheet-sized rectangle of well, and something to draw on it with."""
    from PIL import Image, ImageDraw

    image = Image.new("RGB", (width, height), WELL)
    return image, ImageDraw.Draw(image)


def label(draw, x: int, y: int, lines, size: int = LABEL_SIZE, lead=WELL_INK) -> None:
    """Ranged-left lettering: the first line in caption ink, the rest a rank quieter.

    One string is one line; the ranks are what let a note say what a thing *is* and then
    what it was made from, without the second half competing with the first.

    **This is not the label under a tile** — that is `tile_label`, which owns its own
    size and centres. What is left here is the lettering that stands beside a picture
    rather than under it: a note next to a table, the settings a run used, the sentence
    an animation's beat is explaining. Those are prose set in a column and stay ranged
    left, at the size their sheet asks for.
    """
    if isinstance(lines, str):
        lines = [lines]
    face = font(size)
    for index, line in enumerate(lines):
        fill = lead if index == 0 else WELL_INK_DIM
        draw.text((x, y + index * (size + 5)), line, fill=fill, font=face)


def provenance_line(draw, x: int, y: int, text: str, size: int = 15) -> None:
    """The quietest rank: where a panel came from, under the label that names it."""
    draw.text((x, y), text, fill=SECTION_INK, font=font(size))


def grid_size(panel: tuple[int, int], columns: int, rows: int, caption: int) -> tuple[int, int]:
    """The sheet a grid of this shape needs — for a caller laying out around it."""
    panel_width, panel_height = panel
    return (
        PAD + columns * (panel_width + PAD),
        PAD + rows * (panel_height + caption + PAD),
    )


def panel_origin(index: int, panel: tuple[int, int], columns: int, caption: int) -> tuple[int, int]:
    """Where the index-th panel's top-left corner lands, filling rows left to right."""
    panel_width, panel_height = panel
    row, column = divmod(index, columns)
    return (
        PAD + column * (panel_width + PAD),
        PAD + row * (panel_height + caption + PAD),
    )


def paste(sheet, path: Path, origin: tuple[int, int], size: tuple[int, int] | None = None):
    """One panel onto the sheet, resized only where it is not already the panel size."""
    from PIL import Image

    picture = Image.open(path).convert("RGB")
    if size is not None and picture.size != size:
        picture = picture.resize(size, Image.LANCZOS)
    sheet.paste(picture, origin)
    return picture.size


def fitted(source: Path, size: tuple[int, int]):
    """One picture, centre-cropped to the panel's aspect and then resized onto it.

    A panel is a real frame of the plane, so a render that is the wrong shape for its
    cell is cropped rather than squashed: a narrower or shorter slice of the same view,
    not the same view distorted. Every panel of a sheet is cropped the same way.
    """
    from PIL import Image

    image = Image.open(source).convert("RGB")
    want = size[0] / size[1]
    have = image.width / image.height
    if have > want:
        width = round(image.height * want)
        left = (image.width - width) // 2
        image = image.crop((left, 0, left + width, image.height))
    elif have < want:
        height = round(image.width / want)
        top = (image.height - height) // 2
        image = image.crop((0, top, image.width, top + height))
    return image.resize(size, Image.LANCZOS)


def panel_grid(
    panels,
    columns: int,
    *,
    panel: tuple[int, int] | None = None,
    lead=WELL_INK,
    inks=None,
    after=None,
):
    """Panels in a grid on the well, one label under each. The commonest figure there is.

    `panels` is `(path, lines)` per panel, where `lines` is a string or a list of them.
    The panel size is the first panel's unless one is given, and the label band is what
    the tile-label rule asks for at that panel's height — so the ordinary call is two
    arguments and there is nothing to get wrong.

    `after(draw, index, x, y, panel_width, panel_height)` runs once per panel with the
    panel already pasted, which is where a marked box or a marker goes. `inks` is a fill
    per label line, for a sheet that colours a label to match something in its picture,
    and may be given per panel as a dict keyed by panel index.
    """
    from PIL import Image

    if not panels:
        raise ValueError("a sheet needs at least one panel")
    entries = [(path, [lines] if isinstance(lines, str) else list(lines)) for path, lines in panels]
    if panel is None:
        with Image.open(entries[0][0]) as first:
            panel = first.size
    width = PAD + columns * (panel[0] + PAD)
    deepest = max(len(lines) for _, lines in entries)
    caption = caption_band(panel[1], width, deepest)
    rows = (len(entries) + columns - 1) // columns
    sheet, draw = canvas(*grid_size(panel, columns, rows, caption))
    panel_width, panel_height = panel
    for index, (path, lines) in enumerate(entries):
        x, y = panel_origin(index, panel, columns, caption)
        paste(sheet, path, (x, y), panel)
        if after is not None:
            after(draw, index, x, y, panel_width, panel_height)
        chosen = inks.get(index) if isinstance(inks, dict) else inks
        tile_label(draw, (x, y), panel, lines, width, lead=lead, inks=chosen)
    return sheet, draw


# ------------------------------------------------------------------------ the two marks


def marked_box(draw, x: int, y: int, panel_width: int, panel_height: int, step: float) -> None:
    """The box the next panel is drawn from: centred, one zoom step's worth of the frame.

    Two rectangles, black under white: a one-pixel white line vanishes over a pale
    filament and a black one vanishes over the well, and the pair survives both.
    """
    half_width, half_height = panel_width / (2 * step), panel_height / (2 * step)
    left, top = x + panel_width / 2 - half_width, y + panel_height / 2 - half_height
    right, bottom = x + panel_width / 2 + half_width, y + panel_height / 2 + half_height
    draw.rectangle([left - 1, top - 1, right + 1, bottom + 1], outline=(0, 0, 0), width=2)
    draw.rectangle([left, top, right, bottom], outline=WELL_INK, width=1)


def marker(draw, x: float, y: float, text: str, *, radius: int = 11, size: int = 17) -> None:
    """A numbered ring on a picture: this spot, and the panel that belongs to it.

    Ring and number are both drawn twice, dark then light, for the same reason the box
    above is: the thing under a marker is a fractal and can be any colour at all.
    """
    draw.ellipse(
        [x - radius - 2, y - radius - 2, x + radius + 2, y + radius + 2],
        outline=(0, 0, 0),
        width=3,
    )
    draw.ellipse([x - radius, y - radius, x + radius, y + radius], outline=WELL_INK, width=2)
    face = font(size)
    left, _, right, _ = draw.textbbox((0, 0), text, font=face)
    badge_x, badge_y = x + radius + 6, y - radius - 4
    draw.text((badge_x - (right - left) / 2 + 1, badge_y + 1), text, fill=(0, 0, 0), font=face)
    draw.text((badge_x - (right - left) / 2, badge_y), text, fill=WELL_INK, font=face)


def plane_point(
    value,
    box: tuple[int, int, int, int],
    centre: tuple[float, float],
    width: float,
) -> tuple[float, float]:
    """Where a complex number lands inside a panel showing a frame of the plane.

    The panel's aspect fixes the frame's height, which is the same rule the engine
    renders by — so a marker placed through here sits where the render put the point.
    """
    left, top, right, bottom = box
    real, imaginary = (value.real, value.imag) if isinstance(value, complex) else value
    height = width * (bottom - top) / (right - left)
    centre_re, centre_im = centre
    x = left + (float(real) - (centre_re - width / 2)) / width * (right - left)
    y = top + ((centre_im + height / 2) - float(imaginary)) / height * (bottom - top)
    return x, y


# ------------------------------------------------------------------------------- saving


def save(image, destination: Path, *, quiet: bool = False) -> Path:
    """Write a composed sheet, losslessly.

    Always PNG here, whatever the figure ships as: `python -m builder import` does the
    one JPEG encode, so a sheet is never re-encoded from an already-lossy panel.
    """
    destination = Path(destination)
    if destination.suffix.lower() != ".png":
        destination = destination.with_suffix(".png")
    destination.parent.mkdir(parents=True, exist_ok=True)
    image.save(destination, format="PNG", optimize=True)
    if not quiet:
        size = destination.stat().st_size / 1024
        print(f"{destination.name}  {image.width}x{image.height}  {size:.0f} KB")
    return destination


# ------------------------------------------------------------------------ animated PNG


def animate(
    frames,
    destination: Path,
    *,
    frame_ms: int = 130,
    hold_ms: int | None = None,
    inks=(),
    ground=WELL,
    ramp_steps: int = 8,
    extra=(),
) -> tuple[int, int]:
    """Write frames as one looping APNG, on a palette built rather than measured.

    Flat art on a flat ground is a handful of inks and the antialiasing between them, so
    a ramp from the ground to each named ink covers every pixel the frames actually
    contain — and costs about a third of what full colour does. A palette *sampled* from
    a frame instead spends its entries on whatever covers the most pixels and renders a
    two-word caption in the nearest track colour.

    Naming no inks keeps full colour, which is what a sequence of renders wants.
    """
    frames = list(frames)
    if not frames:
        raise ValueError("an animation needs at least one frame")
    if inks:
        frames = shared_palette(frames, inks, ground=ground, ramp_steps=ramp_steps, extra=extra)
    durations = [frame_ms] * len(frames)
    if hold_ms is not None:
        durations[-1] = hold_ms
    destination = Path(destination)
    destination.parent.mkdir(parents=True, exist_ok=True)
    frames[0].save(
        destination,
        format="PNG",
        save_all=True,
        append_images=frames[1:],
        duration=durations,
        loop=0,
        optimize=True,
    )
    return frames[0].size


def shared_palette(frames, inks, *, ground=WELL, ramp_steps: int = 8, extra=()):
    """One palette for every frame: the ground, a ramp to each ink, and any extra mixes."""
    from PIL import Image

    entries = [ground]
    for ink in inks:
        entries.extend(ramp(ground, ink, ramp_steps))
    entries.extend(extra)
    if len(entries) > 256:
        raise ValueError(f"{len(entries)} palette entries; a PNG palette holds 256")
    reference = Image.new("P", (1, 1))
    flat = [channel for colour in entries for channel in colour]
    reference.putpalette(flat + [0] * (768 - len(flat)))
    return [frame.quantize(palette=reference, dither=Image.Dither.NONE) for frame in frames]


def ramp(ground: tuple[int, int, int], ink: tuple[int, int, int], steps: int) -> list:
    """The steps between a ground and an ink, ending on the ink."""
    return [mix(ground, ink, (index + 1) / steps) for index in range(steps)]


def mix(first: tuple[int, int, int], second: tuple[int, int, int], amount: float) -> tuple:
    """Two colours, blended."""
    return tuple(round(a + (b - a) * amount) for a, b in zip(first, second, strict=True))
