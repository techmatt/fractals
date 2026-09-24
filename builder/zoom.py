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
- `power`: `g = nu ** alpha`, `0 < alpha < 1`, whose cycles lengthen as `nu` grows.

The palette is the engine's own, lifted once by `zoom_palette.mjs`; the interior is black.

    python builder/zoom.py stats                     nu and band widths per keyframe
    python builder/zoom.py colour --mapping log      keyframe PNGs for one mapping
    python builder/zoom.py sheet --mapping log       a contact sheet of chosen keyframes
    python builder/zoom.py encode --mapping log      composite and encode that mapping
    python builder/zoom.py video --mapping log       colour, then encode
"""

from __future__ import annotations

import argparse
import json
import math
import os
import subprocess
import sys
import time
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parent
RECORD = HERE / "data" / "deep-zoom-descent.keyframes.json"
TABLE_SIZE = 65536
MAPPINGS = ("linear", "log", "power")


#: The record this run reads: `RECORD` unless `--record` names another, such as an
#: automatic descent's (`builder/descent.py`).
_record_path = RECORD


def zoom_dir(name: str | None = None) -> Path:
    """Where a record's fields, colourings and videos land: `artifacts/deep-zoom/` for the
    deep zoom video, which had it first, and `artifacts/<name>/` for any other record."""
    moved = os.environ.get("FRACTAL_WEBSITE_ZOOM_DIR")
    if moved:
        return Path(moved)
    name = name or read_record()["name"]
    return HERE.parent / "artifacts" / ("deep-zoom" if name == "deep-zoom-descent" else name)


def read_record() -> dict:
    return json.loads(_record_path.read_text(encoding="utf-8"))


def tag(k: int) -> str:
    return f"k{k:02d}"


def read_field(record: dict, k: int) -> np.ndarray:
    cols, rows = record["keyframes"]["grid"]
    ss = record["keyframes"]["supersample"]
    path = zoom_dir(record["name"]) / "fields" / f"{tag(k)}.f64"
    return np.fromfile(path, dtype="<f8").reshape(rows * ss, cols * ss)


# ----------------------------------------------------------------------------- colouring


def mapping_of(record: dict, args: argparse.Namespace) -> dict:
    """The record's defaults for one mapping, with any flag given laid over them."""
    chosen = dict(record["colour"]["mappings"][args.mapping])
    chosen["kind"] = args.mapping
    for key in ("L", "alpha", "phase"):
        value = getattr(args, key, None)
        if value is not None:
            chosen[key] = value
    chosen["palette"] = args.palette or record["palette"]
    chosen["record"] = record["name"]
    chosen["mirror"] = bool(args.mirror)
    chosen["reverse"] = bool(args.reverse)
    if not chosen["L"] or chosen["L"] <= 0:
        raise SystemExit(f"{args.mapping}: L must be positive")
    if args.mapping == "power" and not 0 < chosen.get("alpha", 0) < 1:
        raise SystemExit("power: alpha must be in (0, 1)")
    return chosen


def mapping_name(m: dict) -> str:
    """A directory name that says every parameter, so two runs never share one."""
    parts = [m["kind"], f"L{m['L']:g}"]
    if m["kind"] == "power":
        parts.append(f"a{m['alpha']:g}")
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
    return np.power(np.maximum(nu, 0.0), m["alpha"])


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


def colour(nu: np.ndarray, m: dict, table: np.ndarray, interior) -> np.ndarray:
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
    rgb = colour(read_field(record, k), m, table, record["colour"]["interior"])
    Image.fromarray(rgb, "RGB").save(out, compress_level=1)
    return out.name


def colour_all(record: dict, m: dict, workers: int) -> Path:
    out_dir = zoom_dir(record["name"]) / "colour" / mapping_name(m)
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "mapping.json").write_text(json.dumps(m, indent=2) + "\n", encoding="utf-8")
    palette_table(m)  # lifted once here, not raced by the pool
    jobs = [
        (record, f["k"], m, out_dir / f"{tag(f['k'])}.png") for f in record["keyframes"]["frames"]
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
    for k in picks:
        rgb = colour(read_field(record, k), m, table, record["colour"]["interior"])
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


def ffmpeg_exe() -> str:
    try:
        import imageio_ffmpeg
    except ImportError as missing:
        raise SystemExit("no encoder: pip install imageio-ffmpeg") from missing
    return imageio_ffmpeg.get_ffmpeg_exe()


def encode(record: dict, directory: Path, out: Path, crf: int, preset: str) -> None:
    video = record["video"]
    size = tuple(video["resolution"])
    frames = Keyframes(directory, record)
    plan = schedule(record)
    out.parent.mkdir(parents=True, exist_ok=True)
    command = [
        ffmpeg_exe(), "-y", "-loglevel", "error",
        "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{size[0]}x{size[1]}",
        "-r", str(video["fps"]), "-i", "-",
        "-c:v", "libx264", "-preset", preset, "-crf", str(crf), "-tune", "film",
        "-pix_fmt", "yuv420p", "-colorspace", "bt709", "-color_primaries", "bt709",
        "-color_trc", "bt709", "-movflags", "+faststart", str(out),
    ]  # fmt: skip
    started = time.perf_counter()
    with subprocess.Popen(command, stdin=subprocess.PIPE) as encoder:
        for i, s in enumerate(plan):
            encoder.stdin.write(composite(frames, s, size, video["feather"]).tobytes())
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
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("stats", help="nu and band widths per keyframe")
    for name in ("colour", "sheet", "encode", "video"):
        p = sub.add_parser(name)
        p.add_argument("--mapping", choices=MAPPINGS, required=True)
        p.add_argument("--L", type=float, help="the cycle length, in units of g")
        p.add_argument("--alpha", type=float, help="power only: the exponent")
        p.add_argument("--phase", type=float)
        p.add_argument("--palette", help="a palette name from explorer/palettes.js")
        p.add_argument("--mirror", action="store_true")
        p.add_argument("--reverse", action="store_true")
        p.add_argument("--workers", type=int, default=6, help="colouring processes")
        p.add_argument("--crf", type=int, default=14)
        p.add_argument("--preset", default="slow")
        p.add_argument("--out", type=Path, help="encode: the MP4's path")
        p.add_argument("--keys", default="51,45,38,30,24,20,12,4,0", help="sheet: keyframes")
    args = parser.parse_args(argv)
    global _record_path
    if args.record is not None:
        _record_path = args.record.resolve()
    record = read_record()
    if args.command == "stats":
        stats(record)
        return
    m = mapping_of(record, args)
    directory = zoom_dir(record["name"]) / "colour" / mapping_name(m)
    if args.command == "sheet":
        sheet(record, m, [int(k) for k in args.keys.split(",")])
        return
    if args.command in ("colour", "video"):
        directory = colour_all(record, m, args.workers)
    if args.command in ("encode", "video"):
        if not directory.exists():
            raise SystemExit(f"{directory} is not coloured yet: run colour first")
        video = zoom_dir(record["name"]) / "video"
        out = args.out or video / f"{record['name']}_{mapping_name(m)}.mp4"
        encode(record, directory, out, args.crf, args.preset)


if __name__ == "__main__":
    main(sys.argv[1:])
