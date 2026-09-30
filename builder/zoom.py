"""The deep zoom video: colour the keyframe fields, composite the frames, encode an MP4.

A standalone tool over what `zoom_fields.mjs` rendered. It is not a figure maker, nothing in
`build` or `check` runs it, and no page carries what it makes; `README.md` has the commands.
Everything it reads comes from `data/deep-zoom-descent.keyframes.json`, and every flag below
overrides one value of that record for one run.

The colouring is **one fixed function of `nu` for the whole zoom**: no per-frame stretch and
no levelling, so a place two keyframes share is the same colour in both. The index is
`frac(g(nu) / L + phase)`, with `g` one of

- `linear`: `g = nu`;
- `log`: `g = ln nu`;
- `power`: `g = nu ** alpha`, `0 < alpha < 1`, whose cycles lengthen as `nu` grows;
- `absolute`: `g = T_lambda(nu)`, the engine's Box–Cox compression, `(nu ** lambda - 1) /
  lambda` and `ln nu` at zero: the explorer's `scale=absolute`, whose `period` is `L`, so
  that a link's colour is carried here exactly;
- `knee`: the link's own `absolute` at `lambda = 1` above a `knee`, `g = nu - 1`, and below
  it `g = (knee - 1) + knee * T_lambda(nu / knee)`, the same Box–Cox joined where both the
  value and the slope agree. `lambda = 0` is a log joined to a line; nearer one, the low end
  is calmer. `L` and `phase` are the record's `absolute` ones unless it names a `knee` of
  its own (julia3_curve_ckpt157). **It is coloured by the engine, not here**
  (explorer_knee_ckpt157): the formula's one home is `Palette::absolute_value`, the
  explorer's Straighten iter, and `engine_colour` hands the field to `engine.wasm` through
  `zoom_shade.mjs` with the Deep tab's own spec — so a knee frame is the picture the link
  `scale=absolute&lambda=…&period=L&phase=…&knee=…` draws of that field, byte for byte.

The palette is the engine's own, lifted once by `zoom_palette.mjs` into a 65536-entry table
for every mapping but `knee`; the interior is black. The table snaps where the engine
interpolates its 4096 entries, so a table mapping differs from the engine's own colouring by
one level on about half a percent of pixels (measured on julia3 under `absolute`).

**A schedule** is the one exception to "one fixed function" (julia3_palette_ckpt157). A
mapping may carry `schedule`, a list of `{"w": width, "L": …, "phase": …, "lambda": …}`
points, and then `L`, `phase` and `lambda` are functions of the frame's width: `L` and
`lambda` interpolated linearly in `log2 w` (`L` in its log), `phase` linearly, held
constant past either end. A scheduled mapping colours each video frame from the fields at
that frame's own width, so the two keyframes it blends always agree; `colour` then writes
each keyframe at its own width, which is what its PNG is used for (a sheet, a still).
**A schedule makes colour flow**: structure already on screen is recoloured as the width
passes it. `knee` is the answer that does not, being one function of `nu` again.

    python builder/zoom.py stats                     nu and band widths per keyframe
    python builder/zoom.py colour --mapping log      keyframe PNGs for one mapping
    python builder/zoom.py sheet --mapping log       a contact sheet of chosen keyframes
    python builder/zoom.py encode --mapping log      composite and encode that mapping
    python builder/zoom.py video --mapping log       colour, then encode

The encode is `ENCODE` unless the record says otherwise; `--crf` and `--preset` override it
for one run.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import subprocess
import sys
import tempfile
import time
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parent
RECORD = HERE / "data" / "deep-zoom-descent.keyframes.json"
TABLE_SIZE = 65536
MAPPINGS = ("linear", "log", "power", "absolute", "knee")
#: The encode every video gets unless its record, its variant or a flag says otherwise: the
#: double-descent `4k60` master's (double_descent_4k_ckpt148), taken as the baseline by
#: video_defaults_ckpt151. The profile, the 4:2:0 and the BT.709 tags are in `encode_command`
#: and are not a choice.
ENCODE = {"crf": 12, "preset": "slow", "tune": "film"}


#: The record this run reads: `RECORD` unless `--record` names another, such as an
#: automatic descent's (`builder/descent.py`).
_record_path = RECORD
#: The record's variant this run draws, or None for its own keyframes and video. A variant
#: (`variants.<name>` in the record) keeps every width and colour and changes the grid, the
#: caps, the video's size and rate, and its speed.
_variant: str | None = None


def zoom_dir(name: str | None = None) -> Path:
    """Where a record's fields, colourings and videos land: `artifacts/deep-zoom/` for the
    deep zoom video, which had it first, and `artifacts/<name>/` for any other record."""
    moved = os.environ.get("FRACTAL_WEBSITE_ZOOM_DIR")
    if moved:
        return Path(moved)
    name = name or read_record()["name"]
    return HERE.parent / "artifacts" / ("deep-zoom" if name == "deep-zoom-descent" else name)


def read_record() -> dict:
    """The record, with the variant this run draws laid over its keyframes and video."""
    record = json.loads(_record_path.read_text(encoding="utf-8"))
    if _variant is None:
        return record
    variant = record.get("variants", {}).get(_variant)
    if variant is None:
        raise SystemExit(f"{record['name']} has no variant {_variant}")
    caps = {f["k"]: f["maxiter"] for f in variant.get("frames", [])}
    frames = record["keyframes"]["frames"]
    record["keyframes"] = dict(
        record["keyframes"],
        grid=variant["grid"],
        supersample=variant.get("supersample", 1),
        frames=[dict(f, maxiter=caps.get(f["k"], f["maxiter"])) for f in frames],
    )
    if "encode" in variant:
        record["encode"] = dict(record.get("encode", {}), **variant["encode"])
    video = dict(record["video"], **variant.get("video", {}))
    # The same path and easing, faster: every time in the schedule divided alike.
    speedup = video.pop("speedup", 1)
    for key in ("seconds_per_halving", "hold_start", "hold_end", "ease_seconds"):
        video[key] = video[key] / speedup
    record["video"] = video
    record["variant"] = _variant
    return record


def variant_dir(record: dict) -> Path:
    """Where this run's fields and colourings live: the record's directory, or the variant's
    own directory inside it."""
    base = zoom_dir(record["name"])
    return base / record["variant"] if record.get("variant") else base


def tag(k: int) -> str:
    return f"k{k:02d}"


def read_field(record: dict, k: int) -> np.ndarray:
    cols, rows = record["keyframes"]["grid"]
    ss = record["keyframes"]["supersample"]
    path = variant_dir(record) / "fields" / f"{tag(k)}.f64"
    return np.fromfile(path, dtype="<f8").reshape(rows * ss, cols * ss)


# ----------------------------------------------------------------------------- colouring


def mapping_of(record: dict, args: argparse.Namespace) -> dict:
    """The record's defaults for one mapping, with any flag given laid over them."""
    mappings = record["colour"]["mappings"]
    if args.mapping == "knee" and "knee" not in mappings:
        # The knee's line is the link's own colouring, so it is read off `absolute`; the
        # Box–Cox under it starts as a log.
        link = mappings.get("absolute")
        if link is None or link.get("lambda", 1) != 1:
            raise SystemExit("knee: the record needs a knee mapping, or an absolute at lambda 1")
        chosen = {"L": link["L"], "phase": link.get("phase", 0), "lambda": 0.0}
    else:
        chosen = dict(mappings[args.mapping])
    chosen["kind"] = args.mapping
    for key, flag in (
        ("L", "L"),
        ("alpha", "alpha"),
        ("phase", "phase"),
        ("lambda", "lam"),
        ("knee", "knee"),
    ):
        value = getattr(args, flag, None)
        if value is not None:
            chosen[key] = value
    if getattr(args, "schedule", None) is not None:
        laid = json.loads(args.schedule.read_text(encoding="utf-8"))
        chosen["schedule"] = laid["points"]
        chosen["schedule_name"] = laid["name"]
    chosen["palette"] = args.palette or record["palette"]
    chosen["record"] = record["name"]
    chosen["mirror"] = bool(args.mirror)
    chosen["reverse"] = bool(args.reverse)
    if not chosen["L"] or chosen["L"] <= 0:
        raise SystemExit(f"{args.mapping}: L must be positive")
    if args.mapping == "power" and not 0 < chosen.get("alpha", 0) < 1:
        raise SystemExit("power: alpha must be in (0, 1)")
    if args.mapping == "absolute" and not 0 <= chosen.get("lambda", 1) <= 1:
        raise SystemExit("absolute: lambda must be in [0, 1]")
    if args.mapping == "knee":
        if not chosen.get("knee") or chosen["knee"] <= 0:
            raise SystemExit("knee: --knee must be positive")
        if not 0 <= chosen.get("lambda", 0) <= 1:
            raise SystemExit("knee: lambda must be in [0, 1]")
        if chosen.get("schedule"):
            raise SystemExit("knee: one function of nu, so it takes no schedule")
    return chosen


def params_at(m: dict, width: float | None) -> dict:
    """The mapping as it stands at a frame this wide: itself, or its schedule read there."""
    points = m.get("schedule")
    if not points or width is None:
        return m
    points = sorted(points, key=lambda p: -p["w"])  # home first, as the descent runs
    at = math.log2(width)
    xs = [math.log2(p["w"]) for p in points]
    out = dict(m)
    if at >= xs[0]:
        lo, hi, t = points[0], points[0], 0.0
    elif at <= xs[-1]:
        lo, hi, t = points[-1], points[-1], 0.0
    else:
        i = next(i for i in range(len(xs) - 1) if xs[i] >= at >= xs[i + 1])
        lo, hi = points[i], points[i + 1]
        t = (xs[i] - at) / (xs[i] - xs[i + 1])
    out["L"] = math.exp((1 - t) * math.log(lo["L"]) + t * math.log(hi["L"]))
    out["phase"] = (1 - t) * lo.get("phase", 0) + t * hi.get("phase", 0)
    if "lambda" in lo or "lambda" in hi:
        low, high = lo.get("lambda", m.get("lambda", 1)), hi.get("lambda", m.get("lambda", 1))
        out["lambda"] = (1 - t) * low + t * high
    return out


def mapping_name(m: dict) -> str:
    """A directory name that says every parameter, so two runs never share one."""
    parts = [m["kind"], f"L{m['L']:g}"]
    if m["kind"] == "power":
        parts.append(f"a{m['alpha']:g}")
    if m["kind"] == "absolute" and m.get("lambda", 1) != 1:
        parts.append(f"l{m['lambda']:g}")
    if m["kind"] == "knee":
        parts += [f"k{m['knee']:g}", f"l{m.get('lambda', 0):g}"]
    if m.get("schedule"):
        parts.append(m.get("schedule_name", "scheduled"))
    if m["phase"]:
        parts.append(f"p{m['phase']:g}")
    parts.append(
        m["palette"] + ("-mirror" if m["mirror"] else "") + ("-reverse" if m["reverse"] else "")
    )
    return "_".join(parts)


def g_of(nu: np.ndarray, m: dict) -> np.ndarray:
    if m["kind"] == "linear":
        return nu
    if m["kind"] == "log":
        # nu can dip under one right at the bailout; the log is taken of what it is.
        return np.log(np.maximum(nu, 1e-9))
    if m["kind"] == "absolute":
        # The engine's `Palette::compress`: below zero is zero's, and zero's log is its floor.
        lam = m.get("lambda", 1)
        if lam == 0:
            return np.log(np.maximum(nu, 1e-9))
        return (np.power(np.maximum(nu, 0.0), lam) - 1.0) / lam
    if m["kind"] == "knee":
        # The knee has one home, the engine's `Palette::absolute_value`, and `colour` hands
        # it there whole (`engine_colour`); a second copy here is what that rules out.
        raise ValueError("knee: coloured by engine.wasm, not by g_of")
    return np.power(np.maximum(nu, 0.0), m["alpha"])


def engine_colour(nu: np.ndarray, m: dict, interior) -> np.ndarray:
    """The field in colour exactly as the explorer's Deep tab colours it: `zoom_shade.mjs`,
    which hands it to the committed `engine.wasm` with `shadeSpecOf`'s spec — the absolute
    scale at `period = L`, `phase`, `lambda` and the `knee` (explorer_knee_ckpt157). So the
    knee's formula is the engine's alone, and a link with these keys is this picture."""
    field = np.ascontiguousarray(nu, dtype="<f8")
    rows, cols = field.shape
    scratch = zoom_dir(m["record"]) / "shade"
    scratch.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=scratch) as held:
        source, out = Path(held) / "field.f64", Path(held) / "field.rgb"
        field.tofile(source)
        command = ["node", str(HERE / "zoom_shade.mjs"), m["palette"]]
        for flag, value in (
            ("--field", source),
            ("--width", cols),
            ("--height", rows),
            ("--period", repr(float(m["L"]))),
            ("--phase", repr(float(m["phase"]))),
            ("--lambda", repr(float(m.get("lambda", 0)))),
            ("--knee", repr(float(m["knee"]))),
            ("--out", out),
        ):
            command += [flag, str(value)]
        command += ["--mirror"] * m["mirror"] + ["--reverse"] * m["reverse"]
        subprocess.run(command, check=True)
        rgb = np.fromfile(out, dtype=np.uint8).reshape(rows, cols, 3)
    rgb[np.isnan(nu)] = interior
    return rgb


def palette_table(m: dict) -> np.ndarray:
    """The engine's bake of this palette, lifted through `engine.wasm` once and kept."""
    suffix = ("-mirror" if m["mirror"] else "") + ("-reverse" if m["reverse"] else "")
    path = zoom_dir(m["record"]) / "palettes" / f"{m['palette']}{suffix}.rgb"
    if not path.exists():
        command = ["node", str(HERE / "zoom_palette.mjs"), m["palette"]]
        command += ["--mirror"] * m["mirror"] + ["--reverse"] * m["reverse"]
        path.parent.mkdir(parents=True, exist_ok=True)
        subprocess.run(command + ["--out", str(path)], check=True)
    return np.fromfile(path, dtype=np.uint8).reshape(TABLE_SIZE, 3)


def colour(
    nu: np.ndarray, m: dict, table: np.ndarray, interior, width: float | None = None
) -> np.ndarray:
    """The field in colour; a scheduled mapping is read at `width`, the frame's own."""
    m = params_at(m, width)
    if m["kind"] == "knee":
        return engine_colour(nu, m, interior)
    inside = np.isnan(nu)
    g = g_of(np.where(inside, 1.0, nu), m)
    index = np.mod(g / m["L"] + m["phase"], 1.0)
    at = np.minimum((index * TABLE_SIZE).astype(np.int64), TABLE_SIZE - 1)
    rgb = table[at]
    rgb[inside] = interior
    return rgb


def _colour_one(job: tuple) -> str:
    record, k, m, out = job
    table = palette_table(m)
    width = next(f["width"] for f in record["keyframes"]["frames"] if f["k"] == k)
    rgb = colour(read_field(record, k), m, table, record["colour"]["interior"], width)
    Image.fromarray(rgb, "RGB").save(out, compress_level=1)
    return out.name


def colour_all(record: dict, m: dict, workers: int, only: list[int] | None = None) -> Path:
    out_dir = variant_dir(record) / "colour" / mapping_name(m)
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "mapping.json").write_text(json.dumps(m, indent=2) + "\n", encoding="utf-8")
    palette_table(m)  # lifted once here, not raced by the pool
    jobs = [
        (record, f["k"], m, out_dir / f"{tag(f['k'])}.png")
        for f in record["keyframes"]["frames"]
        if only is None or f["k"] in only
    ]
    started = time.perf_counter()
    with ProcessPoolExecutor(workers) as pool:
        for name in pool.map(_colour_one, jobs):
            print(f"  {name}", end="", flush=True)
    print(f"\ncoloured {len(jobs)} keyframes in {time.perf_counter() - started:.0f}s: {out_dir}")
    return out_dir


# -------------------------------------------------------------------------------- stats


def stats(record: dict) -> None:
    """Per keyframe: the spread of nu, and how many pixels one unit of g spans at the
    video's scale under each mapping, the number a choice of L is made against."""
    alpha = record["colour"]["mappings"]["power"].get("alpha") or 0.5
    print(
        f"{'k':>3} {'p5 nu':>9} {'p50 nu':>9} {'p95 nu':>9}  median |grad g| per video pixel:"
        f" lin, log, pow(a={alpha})"
    )
    for f in record["keyframes"]["frames"]:
        nu = read_field(record, f["k"])
        ok = nu[~np.isnan(nu)]
        if ok.size == 0:
            print(f"{f['k']:>3}  all interior")
            continue
        p5, p50, p95 = np.percentile(ok, [5, 50, 95])
        grads = []
        for m in ({"kind": "linear"}, {"kind": "log"}, {"kind": "power", "alpha": alpha}):
            g = g_of(nu, m)
            # Two field samples to a video pixel at the frame a keyframe lands on whole.
            gx = np.abs(g[:, 2:] - g[:, :-2])
            gy = np.abs(g[2:, :] - g[:-2, :])
            both = np.concatenate([gx[np.isfinite(gx)], gy[np.isfinite(gy)]])
            grads.append(np.median(both) if both.size else float("nan"))
        print(
            f"{f['k']:>3} {p5:9.1f} {p50:9.1f} {p95:9.1f}  " + "  ".join(f"{v:.3g}" for v in grads)
        )


def sheet(record: dict, m: dict, picks: list[int]) -> Path:
    """Chosen keyframes at a quarter size, side by side, for a choice of L."""
    table = palette_table(m)
    tiles = []
    widths = {f["k"]: f["width"] for f in record["keyframes"]["frames"]}
    for k in picks:
        rgb = colour(read_field(record, k), m, table, record["colour"]["interior"], widths[k])
        tiles.append(Image.fromarray(rgb).resize((960, 540), Image.Resampling.BOX))
    cols = min(3, len(tiles))
    rows = math.ceil(len(tiles) / cols)
    out = Image.new("RGB", (960 * cols, 540 * rows))
    for i, tile in enumerate(tiles):
        out.paste(tile, (960 * (i % cols), 540 * (i // cols)))
    path = zoom_dir(record["name"]) / "sheets" / f"{mapping_name(m)}.png"
    path.parent.mkdir(parents=True, exist_ok=True)
    out.save(path)
    print(path)
    return path


# ------------------------------------------------------------------------ composite


def schedule(record: dict) -> list[float]:
    """Halvings from the home view, one per video frame: a hold, the eased descent, a hold.

    The speed is 1/seconds_per_halving and ramps along a raised cosine over ease_seconds at
    each end, so the descent takes K * seconds_per_halving + ease_seconds.
    """
    video = record["video"]
    total = len(record["keyframes"]["frames"]) - 1
    speed = 1.0 / video["seconds_per_halving"]
    ease = video["ease_seconds"]
    motion = total / speed + ease

    def travelled(t: float) -> float:
        if t <= 0:
            return 0.0
        if t >= motion:
            return float(total)
        if t < ease:
            return speed * (t / 2 - ease / (2 * math.pi) * math.sin(math.pi * t / ease))
        if t > motion - ease:
            return total - travelled(motion - t)
        return speed * (t - ease / 2)

    fps = video["fps"]
    length = video["hold_start"] + motion + video["hold_end"]
    frames = round(length * fps)
    return [travelled(i / fps - video["hold_start"]) for i in range(frames)]


class Keyframes:
    """The coloured keyframes, decoded as they are needed and dropped once passed."""

    def __init__(self, directory: Path, record: dict):
        self.directory = directory
        self.top = len(record["keyframes"]["frames"]) - 1
        self.held: dict[int, Image.Image] = {}

    def get(self, k: int) -> Image.Image:
        if k not in self.held:
            image = Image.open(self.directory / f"{tag(k)}.png")
            image.load()
            self.held[k] = image
            for old in [key for key in self.held if key > k + 1]:
                del self.held[old]
        return self.held[k]


def feather_mask(w: int, h: int, edge: float) -> np.ndarray:
    """1 inside, falling to 0 at the rectangle's border over `edge` pixels, smoothstepped."""
    x = np.minimum(np.arange(w) + 0.5, w - np.arange(w) - 0.5) / edge
    y = np.minimum(np.arange(h) + 0.5, h - np.arange(h) - 0.5) / edge
    t = np.clip(np.minimum(x[None, :], y[:, None]), 0.0, 1.0)
    return (t * t * (3 - 2 * t)).astype(np.float32)


def composite(frames: Keyframes, s: float, size: tuple[int, int], feather: float) -> np.ndarray:
    """The frame `s` halvings down from the home view.

    Keyframe `top - floor(s)` is at least as wide as the frame: its centre is cropped to the
    frame and area-filtered down. The next keyframe in, half that width, covers the middle
    and is blended over it with a feathered edge. Both are always reduced, never enlarged:
    the outer by between one and two times the video's scale, the inner by two to four.
    """
    out_w, out_h = size
    j = min(int(math.floor(s)), frames.top)
    zoom = 2.0 ** (s - j)  # 1 <= zoom < 2: how far into keyframe j the frame has gone
    outer = frames.get(frames.top - j)
    kw, kh = outer.size
    hw, hh = kw / 2 / zoom, kh / 2 / zoom
    box = (kw / 2 - hw, kh / 2 - hh, kw / 2 + hw, kh / 2 + hh)
    base = outer.resize(size, Image.Resampling.BOX, box=box)
    k_inner = frames.top - j - 1
    if k_inner < 0:
        return np.asarray(base)
    inner = frames.get(k_inner)
    # The inner keyframe spans zoom/2 of the frame, centred, at fractional pixel edges; the
    # pasted rectangle is the whole pixels inside that span, and the source box is exactly
    # the part of the keyframe those pixels see.
    x0 = out_w / 2 * (1 - zoom / 2)
    y0 = out_h / 2 * (1 - zoom / 2)
    x1, y1 = out_w - x0, out_h - y0
    px0, py0, px1, py1 = math.ceil(x0), math.ceil(y0), math.floor(x1), math.floor(y1)
    scale = inner.size[0] / (x1 - x0)
    src = ((px0 - x0) * scale, (py0 - y0) * scale, (px1 - x0) * scale, (py1 - y0) * scale)
    patch = inner.resize((px1 - px0, py1 - py0), Image.Resampling.BOX, box=src)
    mask = feather_mask(px1 - px0, py1 - py0, feather * (x1 - x0))[..., None]
    frame = np.asarray(base).astype(np.float32)
    region = frame[py0:py1, px0:px1]
    frame[py0:py1, px0:px1] = region + (np.asarray(patch, np.float32) - region) * mask
    return np.clip(frame + 0.5, 0, 255).astype(np.uint8)


class Fields:
    """The `nu` fields a scheduled mapping composites from, read as needed and dropped once
    passed: `Keyframes`'s shape, with the colouring left to each video frame."""

    def __init__(self, record: dict, m: dict):
        self.record = record
        self.m = m
        self.table = palette_table(m)
        self.interior = record["colour"]["interior"]
        self.top = len(record["keyframes"]["frames"]) - 1
        self.target = record["target_width"]
        self.held: dict[int, np.ndarray] = {}

    def get(self, k: int) -> np.ndarray:
        if k not in self.held:
            self.held[k] = read_field(self.record, k)
            for old in [key for key in self.held if key > k + 1]:
                del self.held[old]
        return self.held[k]

    def crop(self, k: int, box: tuple[float, float, float, float], size, width: float):
        """The part of keyframe `k` inside `box` (field pixels), coloured at the frame's
        `width` and area-filtered to `size`: what `Keyframes` does, colour first."""
        nu = self.get(k)
        x0, y0 = max(0, math.floor(box[0])), max(0, math.floor(box[1]))
        x1, y1 = min(nu.shape[1], math.ceil(box[2])), min(nu.shape[0], math.ceil(box[3]))
        rgb = colour(nu[y0:y1, x0:x1], self.m, self.table, self.interior, width)
        inner = (box[0] - x0, box[1] - y0, box[2] - x0, box[3] - y0)
        return Image.fromarray(rgb).resize(size, Image.Resampling.BOX, box=inner)


def composite_scheduled(fields: Fields, s: float, size: tuple[int, int], feather: float):
    """`composite`, for a scheduled mapping: both keyframes coloured at this frame's width."""
    out_w, out_h = size
    j = min(int(math.floor(s)), fields.top)
    zoom = 2.0 ** (s - j)
    width = fields.target * 2.0 ** (fields.top - s)
    outer = fields.get(fields.top - j)
    kh, kw = outer.shape
    hw, hh = kw / 2 / zoom, kh / 2 / zoom
    base = fields.crop(fields.top - j, (kw / 2 - hw, kh / 2 - hh, kw / 2 + hw, kh / 2 + hh),
                       size, width)  # fmt: skip
    k_inner = fields.top - j - 1
    if k_inner < 0:
        return np.asarray(base)
    ih, iw = fields.get(k_inner).shape
    x0 = out_w / 2 * (1 - zoom / 2)
    y0 = out_h / 2 * (1 - zoom / 2)
    x1, y1 = out_w - x0, out_h - y0
    px0, py0, px1, py1 = math.ceil(x0), math.ceil(y0), math.floor(x1), math.floor(y1)
    scale = iw / (x1 - x0)
    src = ((px0 - x0) * scale, (py0 - y0) * scale, (px1 - x0) * scale, (py1 - y0) * scale)
    patch = fields.crop(k_inner, src, (px1 - px0, py1 - py0), width)
    mask = feather_mask(px1 - px0, py1 - py0, feather * (x1 - x0))[..., None]
    frame = np.asarray(base).astype(np.float32)
    region = frame[py0:py1, px0:px1]
    frame[py0:py1, px0:px1] = region + (np.asarray(patch, np.float32) - region) * mask
    return np.clip(frame + 0.5, 0, 255).astype(np.uint8)


def ffmpeg_exe() -> str:
    try:
        import imageio_ffmpeg
    except ImportError as missing:
        raise SystemExit("no encoder: pip install imageio-ffmpeg") from missing
    return imageio_ffmpeg.get_ffmpeg_exe()


def still(record: dict, directory: Path, s: float, out: Path, m: dict | None = None) -> None:
    """The one frame `s` halvings down, as a PNG: what a before-and-after pair is made of."""
    video = record["video"]
    size = tuple(video["resolution"])
    if m is not None and m.get("schedule"):
        frame = composite_scheduled(Fields(record, m), s, size, video["feather"])
    else:
        frame = composite(Keyframes(directory, record), s, size, video["feather"])
    out.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(frame).save(out)
    print(out)


def encode_of(record: dict, crf: int | None = None, preset: str | None = None) -> dict:
    """`ENCODE`, with the record's `encode` (a variant's laid over it) and any flag given laid
    over that. The two videos made before the baseline pin the CRF they were made at."""
    chosen = dict(ENCODE, **record.get("encode", {}))
    if crf is not None:
        chosen["crf"] = crf
    if preset is not None:
        chosen["preset"] = preset
    return chosen


def encode_command(
    record: dict, out: Path, crf: int | None = None, preset: str | None = None
) -> list[str]:
    """The ffmpeg command that takes raw RGB frames on stdin and writes `out`: libx264, High
    profile, 4:2:0, full BT.709 tags, at the CRF, preset and tune `encode_of` settles on."""
    video = record["video"]
    size = video["resolution"]
    chosen = encode_of(record, crf, preset)
    return [
        ffmpeg_exe(), "-y", "-loglevel", "error",
        "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{size[0]}x{size[1]}",
        "-r", str(video["fps"]), "-i", "-",
        "-c:v", "libx264", "-preset", chosen["preset"], "-crf", str(chosen["crf"]),
        "-tune", chosen["tune"],
        "-profile:v", "high", "-pix_fmt", "yuv420p",
        # the -color_* flags alone tag only the matrix; the primaries and transfer reach the
        # stream's VUI through x264's own parameters
        "-x264-params", "colorprim=bt709:transfer=bt709:colormatrix=bt709",
        "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709",
        "-movflags", "+faststart", str(out),
    ]  # fmt: skip


def encode(
    record: dict,
    directory: Path,
    out: Path,
    crf: int | None = None,
    preset: str | None = None,
    span: tuple[float, float] | None = None,
    m: dict | None = None,
) -> None:
    """Composite every frame of the schedule, or only those whose `s` lies in `span`, and
    encode them with `encode_command`. A scheduled mapping `m` composites from the fields."""
    video = record["video"]
    size = tuple(video["resolution"])
    scheduled = m is not None and bool(m.get("schedule"))
    frames = Fields(record, m) if scheduled else Keyframes(directory, record)
    draw = composite_scheduled if scheduled else composite
    plan = schedule(record)
    if span is not None:
        plan = [s for s in plan if span[0] <= s <= span[1]]
    out.parent.mkdir(parents=True, exist_ok=True)
    command = encode_command(record, out, crf, preset)
    started = time.perf_counter()
    with subprocess.Popen(command, stdin=subprocess.PIPE) as encoder:
        for i, s in enumerate(plan):
            encoder.stdin.write(draw(frames, s, size, video["feather"]).tobytes())
            if i % 600 == 0:
                print(
                    f"  frame {i}/{len(plan)} s={s:.2f} {time.perf_counter() - started:.0f}s",
                    flush=True,
                )
        encoder.stdin.close()
        if encoder.wait() != 0:
            raise SystemExit(f"ffmpeg failed on {out}")
    seconds = len(plan) / video["fps"]
    print(
        f"encoded {len(plan)} frames ({seconds:.1f}s of video) in "
        f"{time.perf_counter() - started:.0f}s: {out} ({out.stat().st_size / 1e6:.1f} MB)"
    )


# ------------------------------------------------------------------------------ main


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="zoom", description=__doc__.split("\n")[0])
    parser.add_argument(
        "--record", type=Path, help="a keyframe record other than the deep zoom video's"
    )
    parser.add_argument("--variant", help="one of the record's variants, such as 4k60 or preview")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("stats", help="nu and band widths per keyframe")
    for name in ("colour", "sheet", "encode", "video", "still"):
        p = sub.add_parser(name)
        p.add_argument("--mapping", choices=MAPPINGS, required=True)
        p.add_argument("--L", type=float, help="the cycle length, in units of g")
        p.add_argument("--alpha", type=float, help="power only: the exponent")
        p.add_argument(
            "--lambda", dest="lam", type=float, help="absolute, knee: the Box-Cox lambda"
        )
        p.add_argument("--knee", type=float, help="knee only: the nu the line starts at")
        p.add_argument(
            "--schedule",
            type=Path,
            help='a JSON {"name": N, "points": [{"w", "L", "phase", "lambda"}, ...]} laid over '
            "the mapping's own schedule",
        )
        p.add_argument("--phase", type=float)
        p.add_argument("--palette", help="a palette name from explorer/palettes.js")
        p.add_argument("--mirror", action="store_true")
        p.add_argument("--reverse", action="store_true")
        p.add_argument("--workers", type=int, default=6, help="colouring processes")
        p.add_argument("--crf", type=int, help="encode: over the record's (baseline 12)")
        p.add_argument("--preset", help="encode: over the record's (baseline slow)")
        p.add_argument("--out", type=Path, help="encode: the MP4's path")
        p.add_argument("--keys", default="51,45,38,30,24,20,12,4,0", help="sheet: keyframes")
        p.add_argument("--only", help="colour: these keyframes alone, as k,k,k")
        p.add_argument("--span", help="encode: only the frames from s0 to s1 halvings, as s0,s1")
        p.add_argument("--s", type=float, help="still: the frame this many halvings down")
    args = parser.parse_args(argv)
    global _record_path, _variant
    if args.record is not None:
        _record_path = args.record.resolve()
    _variant = args.variant
    record = read_record()
    if args.command == "stats":
        stats(record)
        return
    m = mapping_of(record, args)
    directory = variant_dir(record) / "colour" / mapping_name(m)
    if args.command == "sheet":
        sheet(record, m, [int(k) for k in args.keys.split(",")])
        return
    only = [int(k) for k in args.only.split(",")] if args.only else None
    # A scheduled mapping's video is coloured frame by frame from the fields, so the video
    # command skips the keyframe PNGs it would not read.
    if args.command == "colour" or (args.command == "video" and not m.get("schedule")):
        directory = colour_all(record, m, args.workers, only)
    suffix = f"_{record['variant']}" if record.get("variant") else ""
    if args.command == "still":
        name = f"{record['name']}_{mapping_name(m)}{suffix}_s{args.s:g}.png"
        still(record, directory, args.s, args.out or variant_dir(record) / "stills" / name, m)
    if args.command in ("encode", "video"):
        if not m.get("schedule") and not directory.exists():
            raise SystemExit(f"{directory} is not coloured yet: run colour first")
        video = variant_dir(record) / "video"
        out = args.out or video / f"{record['name']}_{mapping_name(m)}{suffix}.mp4"
        span = tuple(float(v) for v in args.span.split(",")) if args.span else None
        encode(record, directory, out, args.crf, args.preset, span, m)


if __name__ == "__main__":
    main(sys.argv[1:])
