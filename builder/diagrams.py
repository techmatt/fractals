"""The figures that are drawn rather than rendered.

Two of the article's figures are diagrams: they explain a mechanism instead of showing a
location, so no fractal engine is involved and nothing outside this repository is read.
Those two are drawn here, from the stylesheet's own colours, so the picture in the well
matches the well it sits in — and so a wording change is an edit to this file rather than
to an image somebody has to find again.

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


def pipeline(destination: Path) -> tuple[int, int]:
    """The four stages as boxes, each naming the sections that take it one at a time."""
    from PIL import Image, ImageDraw

    columns = len(STAGES)
    box_width = (PIPELINE_WIDTH - 2 * PIPELINE_MARGIN - (columns - 1) * PIPELINE_GAP) // columns
    name_font = font(30, SEMIBOLD)
    body_font = font(17)
    section_font = font(15)
    section_lines = max(len(sections) for _, _, sections in STAGES)
    height = PIPELINE_MARGIN + PIPELINE_BOX + 12 + section_lines * 21 + PIPELINE_MARGIN

    image = Image.new("RGB", (PIPELINE_WIDTH, height), WELL)
    draw = ImageDraw.Draw(image)
    for index, (name, body, sections) in enumerate(STAGES):
        left = PIPELINE_MARGIN + index * (box_width + PIPELINE_GAP)
        right = left + box_width
        draw.rounded_rectangle(
            [left, PIPELINE_MARGIN, right, PIPELINE_MARGIN + PIPELINE_BOX],
            radius=7,
            fill=WELL_PANEL,
            outline=WELL_RULE,
            width=1,
        )
        draw.text((left + 20, PIPELINE_MARGIN + 22), name, fill=WELL_INK, font=name_font)
        for line_index, line in enumerate(body):
            draw.text(
                (left + 20, PIPELINE_MARGIN + 76 + line_index * 25),
                line,
                fill=WELL_INK_DIM,
                font=body_font,
            )
        for line_index, section in enumerate(sections):
            draw.text(
                (left + 20, PIPELINE_MARGIN + PIPELINE_BOX + 12 + line_index * 21),
                section,
                fill=SECTION_INK,
                font=section_font,
            )
        if index + 1 < columns:
            _arrow(draw, right + 8, right + PIPELINE_GAP - 8, PIPELINE_MARGIN + PIPELINE_BOX / 2)

    destination.parent.mkdir(parents=True, exist_ok=True)
    image.save(destination, format="PNG", optimize=True)
    return image.size


def _arrow(draw, start: float, finish: float, y: float) -> None:
    draw.line([start, y, finish - 5, y], fill=WELL_INK_DIM, width=2)
    draw.polygon(
        [(finish, y), (finish - 9, y - 5), (finish - 9, y + 5)],
        fill=WELL_INK_DIM,
    )


DIAGRAMS = {
    "escape-orbit-race": ("escape-orbit-race.png", orbit_race),
    "overview-pipeline": ("overview-pipeline.png", pipeline),
}


def draw(identifier: str) -> tuple[Path, int, int]:
    """Draw one diagram into the figures directory; return where it went and its size."""
    file, drawer = DIAGRAMS[identifier]
    destination = FIGURE_IMAGES_DIR / file
    width, height = drawer(destination)
    return destination, width, height
