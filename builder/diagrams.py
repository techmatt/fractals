"""The figures that are drawn rather than rendered.

Three of the article's figures are diagrams: each explains a mechanism instead of showing a
location, so no fractal engine is involved and nothing outside this repository is read.
Each is drawn here, from the stylesheet's own colours, so the picture in the well matches
the well it sits in — and so a wording change is an edit to this file rather than to an
image somebody has to find again.

The overview's pipeline teaser used to be the second *(Matt, 2026-08-22)*. It is a paper
teaser now — real renders of one location at each stage, with the stages' parts drawn
around them — so it is composed where every other sheet of renders is composed, in
`scratch/figures/make_sheets.py`, and this module keeps its rule that no engine is
reached from here.

    python -m builder diagram escape-orbit-race

writes the asset into `assets/images/figures/` and prints the size to record in
`figures.jsonl`. It is a separate command from `build` and is not part of `check`: text
is rasterized through whatever font the machine has, so two machines agree about the
picture and not about its bytes.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from pathlib import Path

from . import sheets
from .paths import FIGURE_IMAGES_DIR
from .theme import (
    SECTION_INK,
    SEMIBOLD,
    WELL,
    WELL_INK,
    WELL_INK_DIM,
    WELL_PANEL,
    WELL_PENDING,
    WELL_RULE,
    font,
    text_width,
)

# Three tracks that have to stay apart at a glance, and legible on the well.
TRACK_FAST = (0xE8, 0x73, 0x4A)
TRACK_BOUND = (0x6F, 0xB3, 0xFF)
TRACK_SLOW = (0xE3, 0xC6, 0x5A)
TRACKS = (TRACK_FAST, TRACK_BOUND, TRACK_SLOW)

#: Every ink the orbit race is drawn with, for the palette its frames share. Flat art
#: on a flat ground: a ramp from the well to each of these covers every pixel.
ORBIT_INKS = (WELL_RULE, WELL_PENDING, SECTION_INK, WELL_INK_DIM, WELL_INK, *TRACKS)

# --------------------------------------------------------------------------- orbit race

#: The three constants the race is run with, in the order they are drawn.
#:
#: Each is `c` in `z ← z² + c` with the orbit started at `z = 0`, which is the loop the
#: Mandelbrot set is painted from — so a "starting point" here is a pixel of that picture.
#: The middle one is the centre of the period-3 bulb, where the orbit is an exact
#: three-cycle and therefore visibly *moving* rather than merely not leaving.
RUNNERS = [
    (complex(0.5, 0.5), TRACK_FAST, "escapes at step 5"),
    (complex(-0.075, 0.655), TRACK_SLOW, "escapes at step 35"),
    (complex(-0.12256116687665, 0.74486176661974), TRACK_BOUND, "never escapes"),
]
STEPS = 40
FRAME_MS = 130
HOLD_MS = 1600
BAILOUT = 2.0

ORBIT_SIZE = (960, 540)
ORBIT_SCALE = 2
PLANE_EXTENT = 2.45
CHART_CEILING = 2.5
PALETTE_COLORS = 64


def _orbits() -> list[list[complex]]:
    """Each runner's orbit, one entry per step, ending on the step it escaped."""
    tracks = []
    for constant, _, _ in RUNNERS:
        z = complex(0.0, 0.0)
        track = [z]
        for _ in range(STEPS):
            z = z * z + constant
            track.append(z)
            if abs(z) > BAILOUT:
                break
        tracks.append(track)
    return tracks


@dataclass(frozen=True)
class _Frame:
    """The two panels' pixel geometry, at whatever scale the frame is drawn at."""

    scale: int

    @property
    def plane(self) -> tuple[int, int, int, int]:
        return (24 * self.scale, 82 * self.scale, 466 * self.scale, 524 * self.scale)

    @property
    def chart(self) -> tuple[int, int, int, int]:
        return (516 * self.scale, 82 * self.scale, 936 * self.scale, 524 * self.scale)

    def to_plane(self, value: complex) -> tuple[float, float]:
        left, top, right, bottom = self.plane
        x = left + (value.real + PLANE_EXTENT) / (2 * PLANE_EXTENT) * (right - left)
        y = top + (PLANE_EXTENT - value.imag) / (2 * PLANE_EXTENT) * (bottom - top)
        return x, y

    def to_chart(self, step: int, magnitude: float) -> tuple[float, float]:
        left, top, right, bottom = self.chart
        x = left + step / STEPS * (right - left)
        clipped = min(magnitude, CHART_CEILING)
        y = bottom - clipped / CHART_CEILING * (bottom - top)
        return x, y


def _orbit_background(box: _Frame):
    """Everything that never changes: the legend, the axes, the bailout circle, the chart."""
    from PIL import Image, ImageDraw

    scale = box.scale
    image = Image.new("RGB", (ORBIT_SIZE[0] * scale, ORBIT_SIZE[1] * scale), WELL)
    draw = ImageDraw.Draw(image)
    small = font(15 * scale)

    for index, (constant, colour, note) in enumerate(RUNNERS):
        y = (12 + index * 21) * scale
        swatch = 9 * scale
        draw.ellipse(
            [24 * scale, y + 5 * scale, 24 * scale + swatch, y + 5 * scale + swatch], fill=colour
        )
        draw.text(
            (24 * scale + swatch + 9 * scale, y),
            f"c = {sheets.complex_text(constant)} — {note}",
            fill=WELL_INK_DIM,
            font=small,
        )

    left, top, right, bottom = box.plane
    draw.rectangle([left, top, right, bottom], outline=WELL_RULE, width=scale)
    centre_x, centre_y = box.to_plane(complex(0, 0))
    draw.line([left, centre_y, right, centre_y], fill=WELL_PENDING, width=scale)
    draw.line([centre_x, top, centre_x, bottom], fill=WELL_PENDING, width=scale)
    radius = BAILOUT / (2 * PLANE_EXTENT) * (right - left)
    _dashed_circle(draw, centre_x, centre_y, radius, WELL_PENDING, 2 * scale, 7 * scale)
    draw.text(
        (left + 9 * scale, top + 8 * scale), "the complex plane", fill=WELL_INK_DIM, font=small
    )
    draw.text(
        (centre_x + radius * 0.70, centre_y - radius - 6 * scale),
        "|z| = 2",
        fill=WELL_INK_DIM,
        font=small,
    )

    left, top, right, bottom = box.chart
    draw.rectangle([left, top, right, bottom], outline=WELL_RULE, width=scale)
    _, line_y = box.to_chart(0, BAILOUT)
    _dashed_line(draw, left, line_y, right, line_y, WELL_PENDING, 2 * scale, 7 * scale)
    draw.text(
        (left + 9 * scale, top + 8 * scale), "|z| against step", fill=WELL_INK_DIM, font=small
    )
    draw.text((left + 9 * scale, line_y - 36 * scale), "|z| = 2", fill=WELL_INK_DIM, font=small)
    return image


def _dashed_line(draw, x0: float, y0: float, x1: float, y1: float, colour, width, dash) -> None:
    span = math.hypot(x1 - x0, y1 - y0)
    steps = max(1, int(span / (dash * 2)))
    for index in range(steps):
        start = index * 2 * dash / span
        end = min(1.0, (index * 2 + 1) * dash / span)
        draw.line(
            [
                x0 + (x1 - x0) * start,
                y0 + (y1 - y0) * start,
                x0 + (x1 - x0) * end,
                y0 + (y1 - y0) * end,
            ],
            fill=colour,
            width=width,
        )


def _dashed_circle(draw, x: float, y: float, radius: float, colour, width, dash) -> None:
    span = 2 * math.pi * radius
    count = max(8, int(span / (dash * 2)))
    for index in range(count):
        start = index * 360 / count
        draw.arc(
            [x - radius, y - radius, x + radius, y + radius],
            start,
            start + 360 / count / 2,
            fill=colour,
            width=width,
        )


def _draw_step(image, box: _Frame, tracks: list[list[complex]], step: int) -> None:
    from PIL import ImageDraw

    draw = ImageDraw.Draw(image)
    scale = box.scale
    for track, (_, colour, _) in zip(tracks, RUNNERS, strict=True):
        shown = min(step, len(track) - 1)
        escaped = abs(track[-1]) > BAILOUT and shown == len(track) - 1

        trail = [box.to_plane(value) for value in track[: shown + 1] if abs(value) <= BAILOUT]
        if len(trail) > 1:
            draw.line([point for pair in trail for point in pair], fill=colour, width=2 * scale)
        for point in trail[:-1]:
            _dot(draw, point, 2.5 * scale, colour)
        if trail:
            _dot(draw, trail[-1], 6 * scale if not escaped else 3 * scale, colour, ring=not escaped)
        if escaped:
            _escape_arrow(draw, box, track, colour, scale)

        chart = [box.to_chart(index, abs(value)) for index, value in enumerate(track[: shown + 1])]
        if len(chart) > 1:
            draw.line([point for pair in chart for point in pair], fill=colour, width=2 * scale)
        if chart:
            _dot(draw, chart[-1], 5 * scale if not escaped else 3 * scale, colour)
        if escaped:
            _escape_time(draw, box, len(track) - 1, colour, scale)

    caption = f"step {min(step, STEPS)}"
    face = font(17 * scale, SEMIBOLD)
    draw.text(
        (box.chart[2] - text_width(draw, caption, face), 16 * scale),
        caption,
        fill=WELL_INK,
        font=face,
    )


def _dot(draw, point: tuple[float, float], radius: float, colour, *, ring: bool = False) -> None:
    x, y = point
    draw.ellipse([x - radius, y - radius, x + radius, y + radius], fill=colour)
    if ring:
        draw.ellipse(
            [x - radius - 3, y - radius - 3, x + radius + 3, y + radius + 3],
            outline=colour,
            width=2,
        )


def _escape_time(draw, box: _Frame, step: int, colour, scale: int) -> None:
    """Where this track crossed the line, and on which step — the orbit's escape time."""
    x, y = box.to_chart(step, BAILOUT)
    radius = 5 * scale
    draw.ellipse(
        [x - radius, y - radius, x + radius, y + radius], fill=WELL, outline=colour, width=2 * scale
    )
    draw.text(
        (x + radius + 5 * scale, y + 3 * scale), str(step), fill=colour, font=font(15 * scale)
    )


def _escape_arrow(draw, box: _Frame, track: list[complex], colour, scale: int) -> None:
    """Where an escaped orbit left: a stub past the bailout circle, pointing out."""
    last_inside = next(value for value in reversed(track) if abs(value) <= BAILOUT)
    direction = track[-1] / abs(track[-1])
    start = box.to_plane(last_inside)
    finish = box.to_plane(direction * (PLANE_EXTENT - 0.12))
    draw.line([start, finish], fill=colour, width=2 * scale)
    angle = math.atan2(finish[1] - start[1], finish[0] - start[0])
    size = 9 * scale
    draw.polygon(
        [
            finish,
            (
                finish[0] - size * math.cos(angle - 0.42),
                finish[1] - size * math.sin(angle - 0.42),
            ),
            (
                finish[0] - size * math.cos(angle + 0.42),
                finish[1] - size * math.sin(angle + 0.42),
            ),
        ],
        fill=colour,
    )


def orbit_race(destination: Path) -> tuple[int, int]:
    """The animated figure: three orbits stepping together, and their |z| tracks."""
    from PIL import Image

    box = _Frame(ORBIT_SCALE)
    tracks = _orbits()
    background = _orbit_background(box)
    frames = []
    for step in range(STEPS + 1):
        frame = background.copy()
        _draw_step(frame, box, tracks, step)
        frames.append(frame.resize(ORBIT_SIZE, Image.LANCZOS))
    return sheets.animate(
        frames,
        destination,
        frame_ms=FRAME_MS,
        hold_ms=HOLD_MS,
        inks=ORBIT_INKS,
        extra=[
            sheets.mix(TRACK_FAST, TRACK_SLOW, 0.5),
            sheets.mix(TRACK_SLOW, TRACK_BOUND, 0.5),
        ],
    )


# ------------------------------------------------------------------------- flow figures
#
# One diagram lives here, and it used to be two. The tenth section is about a **loop** —
# three parts, two stores between them, and one arrow running the other way — so
# `pipeline-overview` is a spine read left to right with the return path in its own lane
# underneath. The eighth section's `wallpapers-stages` was the same three parts drawn as
# what each hands to the next, and it is gone: `wallpapers-three-bands` makes that claim
# out of real pictures instead, which is a claim a box of lettering cannot make.
#
# Nothing here is a count. Every other figure of that page that carries a number reads it
# off a record, and this one is about shape, which no record holds.

#: The sheet a flow diagram is composed at — the width every figure of this article is
#: composed at, so a diagram and a sheet of renders sit at the same size in the column.
FLOW_WIDTH = 1316

#: The margin around a flow diagram, and the corner every box is drawn with.
FLOW_PAD = 24
FLOW_RADIUS = 6

#: The three ranks of lettering a flow diagram carries: a box's name, its lines, and the
#: small note that rides beside an arrow.
FLOW_TITLE_SIZE = 21
FLOW_SUB_SIZE = 16
FLOW_NOTE_SIZE = 15


#: The air a box keeps between its lettering and its own edge, on both sides.
FLOW_INSET = 14


def _flow_lines(draw, x: int, y: int, lines, size: int, room: int) -> None:
    """A box's quiet lines, held to fitting inside the box that carries them.

    The wording of these two figures is a constant at the top of this module and the boxes
    are sized from the sheet, so a line that outgrows its box is an edit somebody made to
    the words. It is a refusal rather than lettering that runs out over the well: an
    overrun is invisible in a diff and obvious in the picture, which is the wrong way
    round.
    """
    face = font(size)
    for index, line in enumerate(lines):
        span = text_width(draw, line, face)
        if span > room:
            raise ValueError(
                f"{line!r} is {span:.0f}px at size {size} and its box holds {room}px — "
                "shorten the line rather than letting it run over the well"
            )
        draw.text((x, y + index * (size + 7)), line, fill=WELL_INK_DIM, font=face)


def _flow_box(
    draw,
    box: tuple[int, int, int, int],
    title: str,
    lines,
    *,
    outline=WELL_RULE,
    width: int = 1,
    title_size: int = FLOW_TITLE_SIZE,
    sub_size: int = FLOW_SUB_SIZE,
    fill=WELL_PANEL,
) -> None:
    """One panel of a flow diagram: a plate of well, its name, and its quiet lines."""
    left, top, right, bottom = box
    draw.rounded_rectangle(
        (left, top, right - 1, bottom - 1),
        radius=FLOW_RADIUS,
        fill=fill,
        outline=outline,
        width=width,
    )
    draw.text((left + FLOW_INSET, top + 13), title, fill=WELL_INK, font=font(title_size, SEMIBOLD))
    _flow_lines(
        draw,
        left + FLOW_INSET,
        top + title_size + 25,
        lines,
        sub_size,
        right - left - 2 * FLOW_INSET,
    )


#: The arrow both this module and `pool.py` draw, which is why it lives in `sheets.py`
#: now: `wallpapers-three-bands` hands one band's material to the next the way the loop
#: figure hands one plate's to the next, and two arrowheads drawn two ways would be two
#: conventions for a reader to learn.
_flow_arrow = sheets.elbow_arrow


# ------------------------------------------------------------------- the pipeline's loop

#: The three parts, in reading order, each with the lines that say what it does. The words
#: are the tenth section's own prose reduced to a box.
LOOP_PARTS = [
    (
        "Find locations",
        [
            "a guided walk in every family,",
            "admitting the frames the",
            "location judge rates good",
        ],
    ),
    (
        "Find wallpapers",
        [
            "a mine returns to locations",
            "and draws each many ways,",
            "every picture judged",
        ],
    ),
    (
        "Curate a gallery",
        [
            "one solve over the whole",
            "candidate pool, at a size,",
            "under the bar and the floors",
        ],
    ),
]

#: The two stores, each drawn between the parts that write it and read it. Both say the
#: thing that makes them stores rather than steps.
LOOP_STORES = [
    ("The location pool", ["every admitted frame,", "from every run —", "never pruned"]),
    (
        "The candidate pool",
        ["every judged picture,", "its recipe and its", "scores — never pruned"],
    ),
]

#: What the solve writes down when it comes up short, and the arrow out of it. This box is
#: the whole difference between a loop and a sequence.
LOOP_READOUT = (
    "The shortfall readout",
    [
        "for every seat it could not fill: what the pool",
        "had to offer, which rule refused the pictures",
        "that were there, and which locations could have fed it",
    ],
)
LOOP_RETURN = "what the solve could not seat is what the next mine reads"

LOOP_GAP = 20
LOOP_PART_HEIGHT = 152
LOOP_STORE_HEIGHT = 112
LOOP_DROP = 54
LOOP_READOUT_HEIGHT = 118

#: How far under the readout the return arrow runs, and where the sheet then stops. The
#: lane is the last thing on the sheet: nothing is drawn below the line a reader follows.
LOOP_LANE = 46

#: How wide a store is drawn against a part. A store holds rather than does, and the eye
#: should be able to say which is which before it has read either.
LOOP_STORE_SHARE = 0.78

#: A store's lines are set a rank smaller than a part's: it is the narrower box, and what
#: is in it is a caption on the store rather than a description of work.
LOOP_STORE_SUB = 15


def pipeline_loop(destination: Path) -> tuple[int, int]:
    """`pipeline-overview` — the three parts, the two stores, and the way back.

    Read left to right the picture is a sequence, which is the one thing the page says the
    pipeline is not; the arrow underneath, out of the solve's own readout and into mining,
    is the claim. So the return path gets its own lane rather than being threaded between
    the boxes: it is the line of this figure a reader is meant to follow all the way back.
    """
    inner = FLOW_WIDTH - 2 * FLOW_PAD
    content = inner - 4 * LOOP_GAP
    part_width = round(content / (3 + 2 * LOOP_STORE_SHARE))
    store_width = (content - 3 * part_width) // 2

    top = FLOW_PAD
    bottom = top + LOOP_PART_HEIGHT
    readout_top = bottom + LOOP_DROP
    readout_bottom = readout_top + LOOP_READOUT_HEIGHT
    back = readout_bottom + LOOP_LANE
    height = back + FLOW_PAD
    sheet, draw = sheets.canvas(FLOW_WIDTH, height)

    parts, stores = [], []
    x = FLOW_PAD
    for index, (title, lines) in enumerate(LOOP_PARTS):
        parts.append((x, x + part_width))
        _flow_box(draw, (x, top, x + part_width, bottom), title, lines)
        x += part_width + LOOP_GAP
        if index < len(LOOP_STORES):
            store_top = top + (LOOP_PART_HEIGHT - LOOP_STORE_HEIGHT) // 2
            stores.append((x, x + store_width))
            _flow_box(
                draw,
                (x, store_top, x + store_width, store_top + LOOP_STORE_HEIGHT),
                LOOP_STORES[index][0],
                LOOP_STORES[index][1],
                outline=SECTION_INK,
                width=2,
                title_size=FLOW_SUB_SIZE + 2,
                sub_size=LOOP_STORE_SUB,
            )
            x += store_width + LOOP_GAP

    spine = top + LOOP_PART_HEIGHT // 2
    for left, right in zip(
        [parts[0], stores[0], parts[1], stores[1]],
        [stores[0], parts[1], stores[1], parts[2]],
        strict=True,
    ):
        _flow_arrow(draw, [(left[1] + 3, spine), (right[0] - 4, spine)])

    # The readout hangs under the solve that writes it and stops at the second store's
    # left edge, so the lane the return arrow climbs is clear of it: an arrow crossing a
    # plate it has nothing to do with is a line a reader has to work out rather than read.
    third_left, third_right = parts[2]
    _flow_box(
        draw,
        (stores[1][0], readout_top, third_right, readout_bottom),
        LOOP_READOUT[0],
        LOOP_READOUT[1],
        title_size=FLOW_SUB_SIZE + 2,
    )
    down = (third_left + third_right) // 2
    _flow_arrow(draw, [(down, bottom + 4), (down, readout_top - 5)])

    into = (parts[1][0] + parts[1][1]) // 2
    # A rank heavier than the spine's arrows, and in the same ink: this is the one line
    # of the figure a reader is asked to follow, and colouring it would make it a fourth
    # thing to learn rather than the same arrow drawn louder.
    _flow_arrow(
        draw,
        [(down, readout_bottom + 4), (down, back), (into, back), (into, bottom + 5)],
        width=3,
    )
    draw.text(
        (into + 18, back - FLOW_NOTE_SIZE - 11),
        LOOP_RETURN,
        fill=SECTION_INK,
        font=font(FLOW_NOTE_SIZE),
    )

    sheets.save(sheet, destination)
    return sheet.width, sheet.height


DIAGRAMS = {
    "escape-orbit-race": ("escape-orbit-race.png", orbit_race),
    "pipeline-overview": ("pipeline-overview.png", pipeline_loop),
}


def draw(identifier: str) -> tuple[Path, int, int]:
    """Draw one diagram into the figures directory; return where it went and its size."""
    file, drawer = DIAGRAMS[identifier]
    destination = FIGURE_IMAGES_DIR / file
    width, height = drawer(destination)
    return destination, width, height
