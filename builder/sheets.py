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

from .theme import SECTION_INK, WELL, WELL_INK, WELL_INK_DIM, font

#: A real minus sign, not a hyphen. Every number a figure prints goes through here:
#: the labels are typeset, not code, and `-0.8038` in a caption reads as a dash.
MINUS = "−"

#: The separator between two facts on one label line.
MIDDOT = " · "

#: The gutter between panels, and the margin around the sheet — one number, because a
#: sheet with a different margin than gutter looks like a mistake at every size.
PAD = 12

#: How much room one and two label lines need under a panel.
CAPTION_ONE = 28
CAPTION_TWO = 46

LABEL_SIZE = 16


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
    """A panel's label: the first line in caption ink, the rest a rank quieter.

    One string is one line; the ranks are what let a label say what the panel *is* and
    then what it was made from, without the second half competing with the first. A sheet
    whose labels are all one line and all the same kind of fact passes `lead=WELL_INK_DIM`
    and gets one quiet rank, which is what the rendering figures do.
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


def grid_size(
    panel: tuple[int, int], columns: int, rows: int, caption: int = CAPTION_ONE
) -> tuple[int, int]:
    """The sheet a grid of this shape needs — for a caller laying out around it."""
    panel_width, panel_height = panel
    return (
        PAD + columns * (panel_width + PAD),
        PAD + rows * (panel_height + caption + PAD),
    )


def panel_origin(
    index: int, panel: tuple[int, int], columns: int, caption: int = CAPTION_ONE
) -> tuple[int, int]:
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
    caption: int | None = None,
    label_size: int = LABEL_SIZE,
    lead=WELL_INK,
    after=None,
):
    """Panels in a grid on the well, one label under each. The commonest figure there is.

    `panels` is `(path, lines)` per panel, where `lines` is a string or a list of them.
    The panel size is the first panel's unless one is given, and the caption band is
    sized to the tallest label unless one is given — so the ordinary call is two
    arguments and a sheet whose label band fits its labels.

    `after(draw, index, x, y, panel_width, panel_height)` runs once per panel with the
    panel already pasted, which is where a marked box or a marker goes.
    """
    from PIL import Image

    if not panels:
        raise ValueError("a sheet needs at least one panel")
    entries = [(path, [lines] if isinstance(lines, str) else list(lines)) for path, lines in panels]
    if panel is None:
        with Image.open(entries[0][0]) as first:
            panel = first.size
    if caption is None:
        deepest = max(len(lines) for _, lines in entries)
        caption = CAPTION_ONE if deepest <= 1 else 6 + deepest * (label_size + 5)
    rows = (len(entries) + columns - 1) // columns
    sheet, draw = canvas(*grid_size(panel, columns, rows, caption))
    panel_width, panel_height = panel
    for index, (path, lines) in enumerate(entries):
        x, y = panel_origin(index, panel, columns, caption)
        paste(sheet, path, (x, y), panel)
        if after is not None:
            after(draw, index, x, y, panel_width, panel_height)
        label(draw, x, y + panel_height + 6, lines, size=label_size, lead=lead)
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
