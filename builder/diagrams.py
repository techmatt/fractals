"""The figures that are drawn rather than rendered.

Two of the article's figures are diagrams: each explains a mechanism instead of showing a
location, so no fractal engine is involved and nothing outside this repository is read.
It is drawn here, from the stylesheet's own colours, so the picture in the well matches
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


# ----------------------------------------------------------------------------- pipeline

STAGES = [
    (
        "Search",
        ["A guided walk proposes", "locations worth drawing"],
        ["Finding good locations", "Training judges"],
    ),
    (
        "Render",
        ["Each location is drawn at", "quality, in one of the modes"],
        ["Rendering fundamentals", "Rendering modes"],
    ),
    (
        "Color",
        ["A palette is chosen and", "its tones are balanced"],
        ["Color palettes"],
    ),
    (
        "Select",
        ["Judges score, and a few", "are kept for quality and range"],
        ["From locations to wallpapers"],
    ),
]
PIPELINE_WIDTH = 1316
PIPELINE_MARGIN = 20
PIPELINE_GAP = 34
PIPELINE_BOX = 150


# --------------------------------------------------------------------------- pool stages

#: The sheet this diagram is composed at — the width every figure of this article is
#: composed at, so a diagram and a sheet of renders sit at the same size in the column.
POOL_WIDTH = 1316

#: The two processes, each as a name in the left gutter and the stages it runs through.
#: A stage is a title and the two quiet lines under it, and nothing here is a count: every
#: other figure of this page that carries a number reads it off a record, and this one is
#: about the *shape* of the two processes, which is the thing no record holds.
RUN_LANE = ("A run", ["hours or days at a time,", "and it happens again"])
RUN_STAGES = [
    ("Walk ledgers", ["every partition's search,", "one judge score a location"]),
    ("Locations to draw", ["ordered inside a partition,", "the junk floor cutting it off"]),
    ("Judged small renders", ["one smooth attempt and two", "of the other seventeen"]),
]
PASS_LANE = ("A gallery pass", ["one selection over the", "whole pool, at a size"])
PASS_STAGES = [
    ("Slots", ["the gallery size split by", "share, then between kinds"]),
    ("Chosen locations", ["farthest point in the", "embedding, and a radius"]),
    ("More judged renders", ["several modes and palettes", "at each point a slot took"]),
    ("Finished wallpapers", ["seated over the kind's bar,", "drawn again and unjudged"]),
]

#: What the band between the two says. The pool is the subject: both processes write into
#: it, neither reads the other, and that is the whole claim of the picture.
POOL_TITLE = "The pool"
POOL_LINES = [
    "every candidate every run and every pass has judged — its location, its recipe, its "
    "palette, its scores, and the small picture itself",
    "nothing a run makes is discarded, and nothing a run makes is a wallpaper",
]

#: The one arrow that runs the other way: a pass's own attempts are ordinary candidates
#: and join the pool like any others.
RETURN_TEXT = "a pass's own attempts join the pool"

POOL_PAD = 24
POOL_GUTTER = 186
POOL_GAP = 16
POOL_BOX = 112
POOL_BAND = 104
POOL_JOIN = 52
POOL_TITLE_SIZE = 21
POOL_SUB_SIZE = 17


def _pool_box(draw, x: int, y: int, width: int, height: int, title: str, lines) -> None:
    """One stage: a panel of well, its name, and the two quiet lines under it."""
    draw.rounded_rectangle(
        (x, y, x + width - 1, y + height - 1),
        radius=6,
        fill=WELL_PANEL,
        outline=WELL_RULE,
        width=1,
    )
    draw.text((x + 14, y + 14), title, fill=WELL_INK, font=font(POOL_TITLE_SIZE, SEMIBOLD))
    for index, line in enumerate(lines):
        draw.text(
            (x + 14, y + 48 + index * (POOL_SUB_SIZE + 7)),
            line,
            fill=WELL_INK_DIM,
            font=font(POOL_SUB_SIZE),
        )


def _pool_arrow(draw, start, end, colour=WELL_INK_DIM) -> None:
    """A straight arrow with a solid head, horizontal or vertical."""
    x0, y0 = start
    x1, y1 = end
    draw.line((x0, y0, x1, y1), fill=colour, width=2)
    head = 6
    if y0 == y1:
        step = head if x1 > x0 else -head
        draw.polygon(
            [(x1, y1), (x1 - step, y1 - head + 1), (x1 - step, y1 + head - 1)], fill=colour
        )
    else:
        step = head if y1 > y0 else -head
        draw.polygon(
            [(x1, y1), (x1 - head + 1, y1 - step), (x1 + head - 1, y1 - step)], fill=colour
        )


def _pool_lane(draw, top: int, lane, stages, inner: int) -> tuple[int, int]:
    """One process: its name in the left gutter, its stages across the rest."""
    name, under = lane
    draw.text((POOL_PAD, top + 12), name, fill=WELL_INK, font=font(POOL_TITLE_SIZE, SEMIBOLD))
    for index, line in enumerate(under):
        draw.text(
            (POOL_PAD, top + 46 + index * (POOL_SUB_SIZE + 6)),
            line,
            fill=SECTION_INK,
            font=font(POOL_SUB_SIZE),
        )
    left = POOL_PAD + POOL_GUTTER
    room = inner - POOL_GUTTER
    width = (room - (len(stages) - 1) * POOL_GAP) // len(stages)
    for index, (title, lines) in enumerate(stages):
        x = left + index * (width + POOL_GAP)
        _pool_box(draw, x, top, width, POOL_BOX, title, lines)
        if index:
            _pool_arrow(draw, (x - POOL_GAP + 2, top + POOL_BOX // 2), (x - 3, top + POOL_BOX // 2))
    return left, width


def pool_stages(destination: Path) -> tuple[int, int]:
    """The two processes that stand between a stock of locations and a gallery.

    A run reads left to right and empties into the pool; a gallery pass reads the whole
    pool at once, and its own attempts go back into it. Drawn rather than rendered:
    there is no picture of a process, and the two arrows meeting in the middle are the
    only thing the reader is being asked to see.
    """
    height = POOL_PAD + POOL_BOX + POOL_JOIN + POOL_BAND + POOL_JOIN + POOL_BOX + POOL_PAD
    sheet, draw = sheets.canvas(POOL_WIDTH, height)
    inner = POOL_WIDTH - 2 * POOL_PAD

    run_top = POOL_PAD
    run_left, run_width = _pool_lane(draw, run_top, RUN_LANE, RUN_STAGES, inner)

    band_top = run_top + POOL_BOX + POOL_JOIN
    draw.rounded_rectangle(
        (POOL_PAD, band_top, POOL_PAD + inner - 1, band_top + POOL_BAND - 1),
        radius=8,
        fill=WELL_PANEL,
        outline=SECTION_INK,
        width=2,
    )
    draw.text((POOL_PAD + 18, band_top + 14), POOL_TITLE, fill=WELL_INK, font=font(23, SEMIBOLD))
    for index, line in enumerate(POOL_LINES):
        draw.text(
            (POOL_PAD + 18, band_top + 50 + index * (POOL_SUB_SIZE + 7)),
            line,
            fill=WELL_INK_DIM,
            font=font(POOL_SUB_SIZE),
        )

    pass_top = band_top + POOL_BAND + POOL_JOIN
    pass_left, pass_width = _pool_lane(draw, pass_top, PASS_LANE, PASS_STAGES, inner)

    # A run empties into the pool out of its last stage; a pass draws from it into its
    # first, and puts its own attempts back in out of its third.
    down = run_left + (len(RUN_STAGES) - 1) * (run_width + POOL_GAP) + run_width // 2
    _pool_arrow(draw, (down, run_top + POOL_BOX + 4), (down, band_top - 4))
    draws_from = pass_left + pass_width // 2
    _pool_arrow(
        draw,
        (draws_from, band_top + POOL_BAND + 4),
        (draws_from, pass_top - 4),
        colour=SECTION_INK,
    )
    returns = pass_left + 2 * (pass_width + POOL_GAP) + pass_width // 2
    _pool_arrow(
        draw,
        (returns, pass_top - 4),
        (returns, band_top + POOL_BAND + 4),
        colour=WELL_PENDING,
    )
    draw.text(
        (returns + 12, band_top + POOL_BAND + POOL_JOIN // 2 - 9),
        RETURN_TEXT,
        fill=SECTION_INK,
        font=font(15),
    )

    sheets.save(sheet, destination)
    return sheet.width, sheet.height


DIAGRAMS = {
    "escape-orbit-race": ("escape-orbit-race.png", orbit_race),
    "pool-stages": ("pool-stages.png", pool_stages),
}


def draw(identifier: str) -> tuple[Path, int, int]:
    """Draw one diagram into the figures directory; return where it went and its size."""
    file, drawer = DIAGRAMS[identifier]
    destination = FIGURE_IMAGES_DIR / file
    width, height = drawer(destination)
    return destination, width, height
