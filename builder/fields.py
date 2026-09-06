"""Color a dumped field the way the engine does — and, for one figure, the way it doesn't.

The engine's coloring stage always stretches a field against the 0.5th and 99.5th
percentiles of its own frame, so it cannot draw the *unstretched* half of
`render-percentile-stretch`. This reimplements the engine's field path exactly — an
OKLab-interpolated colormap table, the percentile stretch, the sRGB encode — and then lets
the stretch be replaced by a linear map across the field's whole range, which is the only
difference between that figure's two panels. The reimplementation was held to the engine's
own render of the same field at max channel difference 0.

Recovered into the repository on 2026-09-06 with the makers that read it. It is the one
piece of the article's figure machinery that reproduces engine arithmetic rather than
calling the engine, so it is worth saying plainly that the constants below are the
engine's: `CLIP_LOW` and `CLIP_HIGH` are `coloring.rs`'s, and `TABLE_SIZE` is the size
`Colormap::from_stops_baked` bakes at.
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np

from . import renders

#: Where the wallpaper project keeps the stops a colormap is baked from.
PALETTES = ("data", "palettes")

TABLE_SIZE = 4096
CLIP_LOW, CLIP_HIGH = 0.5, 99.5


def srgb_to_linear(c):
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def linear_to_srgb(c):
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * np.clip(c, 0.0, None) ** (1 / 2.4) - 0.055)


def linear_srgb_to_oklab(rgb):
    long_ = np.cbrt(
        0.4122214708 * rgb[..., 0] + 0.5363325363 * rgb[..., 1] + 0.0514459929 * rgb[..., 2]
    )
    medium = np.cbrt(
        0.2119034982 * rgb[..., 0] + 0.6806995451 * rgb[..., 1] + 0.1073969566 * rgb[..., 2]
    )
    short = np.cbrt(
        0.0883024619 * rgb[..., 0] + 0.2817188376 * rgb[..., 1] + 0.6299787005 * rgb[..., 2]
    )
    return np.stack(
        [
            0.2104542553 * long_ + 0.7936177850 * medium - 0.0040720468 * short,
            1.9779984951 * long_ - 2.4285922050 * medium + 0.4505937099 * short,
            0.0259040371 * long_ + 0.7827717662 * medium - 0.8086757660 * short,
        ],
        axis=-1,
    )


def oklab_to_linear_srgb(lab):
    long_ = (lab[..., 0] + 0.3963377774 * lab[..., 1] + 0.2158037573 * lab[..., 2]) ** 3
    medium = (lab[..., 0] - 0.1055613458 * lab[..., 1] - 0.0638541728 * lab[..., 2]) ** 3
    short = (lab[..., 0] - 0.0894841775 * lab[..., 1] - 1.2914855480 * lab[..., 2]) ** 3
    return np.stack(
        [
            4.0767416621 * long_ - 3.3077115913 * medium + 0.2309699292 * short,
            -1.2684380046 * long_ + 2.6097574011 * medium - 0.3413193965 * short,
            -0.0041960863 * long_ - 0.7034186147 * medium + 1.7076147010 * short,
        ],
        axis=-1,
    )


def table(name: str) -> np.ndarray:
    """The colormap baked exactly as `Colormap::from_stops_baked` bakes it, as written."""
    path = renders.data_file(*PALETTES, f"{name}.json")
    stops = json.loads(path.read_text(encoding="utf-8"))["stops"]
    stops.sort(key=lambda stop: stop[0])
    positions = np.array([stop[0] for stop in stops])
    lab = linear_srgb_to_oklab(srgb_to_linear(np.array([stop[1] for stop in stops]) / 255.0))
    t = np.arange(TABLE_SIZE) / (TABLE_SIZE - 1)
    interpolated = np.stack([np.interp(t, positions, lab[:, i]) for i in range(3)], axis=-1)
    return oklab_to_linear_srgb(interpolated)


def lookup(baked: np.ndarray, t: np.ndarray) -> np.ndarray:
    """`Colormap::lookup`: linear interpolation between neighbouring table entries."""
    position = np.clip(t, 0.0, 1.0) * (TABLE_SIZE - 1)
    index = np.minimum(np.floor(position).astype(np.int64), TABLE_SIZE - 2)
    fraction = (position - index)[..., None]
    low, high = baked[index], baked[index + 1]
    return low + (high - low) * fraction


def percentile(values: np.ndarray, p: float) -> float:
    """`coloring::percentile`: an index into the sorted samples, rounded."""
    last = values.size - 1
    index = min(int(round((p / 100.0) * last)), last)
    return float(np.partition(values, index)[index])


def read_field(stem: Path) -> tuple[np.ndarray, dict]:
    """One dumped field and the record beside it, as `dump_field` wrote them."""
    record = json.loads(stem.with_suffix(".json").read_text(encoding="utf-8"))
    samples = record["samples"]
    values = np.fromfile(stem.with_suffix(".f32"), dtype="<f4").astype(np.float64)
    return values.reshape(samples[1], samples[0]), record


def _encode(linear: np.ndarray, valid: np.ndarray):
    from PIL import Image

    linear[~valid] = 0.0
    return Image.fromarray((linear_to_srgb(linear) * 255.0 + 0.5).astype(np.uint8), "RGB")


def paint(field: np.ndarray, colormap: str, *, low: float, span: float):
    """One field, one working range, the engine's own path from there to sRGB8."""
    valid = np.isfinite(field)
    position = np.clip((np.where(valid, field, 0.0) - low) / span, 0.0, 1.0)
    return _encode(lookup(table(colormap), position), valid)


def stretched_range(field: np.ndarray) -> tuple[float, float]:
    """What `Stretch::over` measures: the 0.5th and 99.5th percentiles of valid samples."""
    valid = field[np.isfinite(field)]
    low = percentile(valid, CLIP_LOW)
    high = percentile(valid, CLIP_HIGH)
    return low, (high - low if high > low else 1.0)


def whole_range(field: np.ndarray) -> tuple[float, float]:
    """The theoretical extremes instead: the lowest and highest values in the frame."""
    valid = field[np.isfinite(field)]
    low, high = float(valid.min()), float(valid.max())
    return low, (high - low if high > low else 1.0)


def grey_table() -> np.ndarray:
    """Black to white, baked the way a colormap file is: OKLab, then linear sRGB."""
    lab = linear_srgb_to_oklab(np.array([[0.0, 0.0, 0.0], [1.0, 1.0, 1.0]]))
    t = np.arange(TABLE_SIZE) / (TABLE_SIZE - 1)
    interpolated = np.stack([np.interp(t, [0.0, 1.0], lab[:, i]) for i in range(3)], axis=-1)
    return oklab_to_linear_srgb(interpolated)


def paint_grey(field: np.ndarray, *, low: float, span: float):
    """The field alone: the same working range, value as lightness and nothing else."""
    valid = np.isfinite(field)
    position = np.clip((np.where(valid, field, 0.0) - low) / span, 0.0, 1.0)
    return _encode(lookup(grey_table(), position), valid)
