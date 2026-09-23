"""The Deep tab's gallery: the frames it opens at, how the first set was found, and its tiles.

## What this is for

The Deep tab draws below the `f64` floor, and a reader arriving there has nowhere in
particular to go. Its gallery is a set of deep frames a click opens. The set is
`explorer/deep-gallery.jsonl`, one row a frame, `{"subject", "link"}` and nothing else, in
subject order: everything else about a frame is in its link. **Adding a frame is appending a
row** and running `thumbs`. The first set is Matt's 31 picks from the numbered sheet this
module's discovery stages drew *(deep_gallery_sheet_ckpt144; promoted out of scratch by
deep_gallery_build_ckpt144)*.

`builder/README.md`'s *The Deep tab's gallery* states the method in prose; this docstring
names the stages and where each one's choices live.

## The stages

```
python -m builder deep-gallery thumbs                    tiles for the register (the one to rerun)
python -m builder deep-gallery descend D COUNT SEED EXTRA  descents from enclosed places
python -m builder deep-gallery frames                    frames from the record's choices
python -m builder deep-gallery preview FRAMES NAME       256x144 previews and a labelled sheet
python -m builder deep-gallery zooms                     off-centre zooms into the busiest exterior
python -m builder deep-gallery render                    the selection at 640x360, 2x2
python -m builder deep-gallery sheet                     colour, number, lay out, write candidates
```

Every stage but `thumbs` writes under ignored `artifacts/deep-gallery/`. The choices the
first run made by eye — which descents became frames, which previews were zoomed into and
which 65 made the sheet — are frozen in `builder/data/deep-gallery-sheet.json`, and the
descents themselves in `builder/data/deep-gallery-descents.jsonl`, so `frames` reproduces
the first run's frames rather than a new search's. A place is addressed by its coordinates
there and never by a position in a list.

The arithmetic is `explorer/perturb-wasm`'s, natively: `builder/deep-gallery-native/` is a
small crate that uses it as an rlib, built on first use. Colour is the tab's own:
`deep_gallery_shade.mjs` reads each link through `deep-link.js` and shades through the
committed `engine.wasm`, so a tile is coloured exactly as its link colours it. The discovery
stages need numpy; `thumbs` needs Pillow, node and cargo.
"""

from __future__ import annotations

import cmath
import json
import math
import random
import subprocess
import sys
import tempfile
from concurrent.futures import ThreadPoolExecutor
from decimal import Decimal, DefaultContext, getcontext
from pathlib import Path
from urllib.parse import parse_qsl, quote

from . import images
from .paths import SITE_ROOT

# Coordinates are exact decimals; ninety digits covers a centre at 1e-30 with room.
DefaultContext.prec = 90  # worker threads copy this one
getcontext().prec = 90

REGISTER = SITE_ROOT / "explorer" / "deep-gallery.jsonl"
THUMBS = SITE_ROOT / "explorer" / "deep-gallery"
CRATE = Path(__file__).resolve().parent / "deep-gallery-native"
NATIVE = CRATE / "target" / "release" / "deep-gallery-native"
SHADE = Path(__file__).resolve().parent / "deep_gallery_shade.mjs"
RECORD = Path(__file__).resolve().parent / "data" / "deep-gallery-sheet.json"
DESCENTS = Path(__file__).resolve().parent / "data" / "deep-gallery-descents.jsonl"
WORK = SITE_ROOT / "artifacts" / "deep-gallery"
VIDEO = Path(__file__).resolve().parent / "data" / "deep-zoom-descent.keyframes.json"

#: A tile: the Phoenix starting points' size, 2 samples a pixel each way.
THUMB = {"width": 316, "height": 178, "supersample": 2}

# ----------------------------------------------------------------------- the rules
#
# Each is stated once here, and `builder/README.md` says why.

#: The kernel's iteration ceiling, `perturb::cap::CEILING`.
CEILING = 1_000_000
#: Periods of its own nucleus a framed minibrot's cap is raised to.
MINIBROT_PERIODS = 32
#: The same for a symmetry stage cut from a descent: the tab's own tile rule.
STAGE_PERIODS = 8
#: A framed minibrot is this many bodies wide.
FRAME_BODIES = 6
#: The next rung's view is this many bodies wide, centred on the nucleus just taken.
LOOK_BODIES = 20
#: A rung's nucleus must be smaller than the last one by at least this factor...
RUNG_SHRINK = 8
#: ...and farther than this many of each earlier body from its nucleus.
APART_BODIES = 1.5
#: Rungs at most, and the largest period a rung may take.
MAX_RUNGS = 12
MAX_PERIOD = 120_000
#: `nuclei::search`'s seed budget and how many it returns, per rung.
SEARCH_BUDGET = 60
SEARCH_WANT = 40
#: The floor: a frame whose width is under this many ulps of its centre, times the
#: samples across, is one `f64` cannot draw (`RESOLUTION_ULPS`, at 1280 across).
RESOLUTION_ULPS = 4
ACROSS = 1280

PREVIEW = (256, 144)
FINAL = (640, 360, 2)

#: The previews' palettes, in turn.
PREVIEW_PALETTES = [
    "glowdon",
    "Chalcedony",
    "river-of-light-25",
    "Rose Furnace",
    "visions-25",
    "Gilded Moss",
]
#: The sheet's palettes: 24 cyclic maps, the Popular list's cyclic entries among them.
PALETTES = [
    "glowdon",
    "Chalcedony",
    "river-of-light-25",
    "Rose Furnace",
    "visions-25",
    "Gilded Moss",
    "Cobalt Furnace Ultra",
    "torque-25",
    "visionary-spires-25",
    "fractal_flowers_abstract_104352_2560x1600",
    "wallhaven_wallhaven-6d3zz6",
    "fractal_abstraction_lines_130499_2560x1600",
    "wallhaven_wallhaven-kwg7v6",
    "Pale Fire Rose",
    "gemini-25",
    "Furnace Rose",
    "abstract-3d-wallpapers",
    "rolling",
    "Amethyst Veil",
    "Ice Shaft",
    "High Cyan, Low Gold",
    "Aurora Curtain",
    "Brass Tide",
    "Coalglow",
]
#: Colour cycles across the field's robust range, and the preferred lambda, by tile.
CYCLES = [2, 3, 1.5, 4, 2.5, 6]
LAMBDAS = [0.0, 0.3, 0.6, 1.0, 0.15, 0.45]
#: The lambdas `choose` tries, and the roughness it accepts.
LAMBDA_GRID = (0.0, 0.15, 0.3, 0.5, 0.75, 1.0)
ROUGH = 0.04

#: The sheet's groups, in the order the register keeps: (frame subject, title, Julia plane).
GROUPS = [
    ("minibrot", "Framed minibrots", None),
    ("julia-stage", "Embedded-Julia symmetry stages, parameter plane", False),
    ("julia-stage", "Embedded Julia sets, dynamical plane", True),
    ("spiral", "Satellite spirals and seahorses", None),
    ("filigree", "Dense filigree", None),
]


class DeepGalleryError(Exception):
    """A register row, a stage or the native path refused."""


# ------------------------------------------------------------------ the native path


def _native(command: str, **options) -> dict:
    """Run the native crate once; every answer is one JSON object on stdout."""
    exe = NATIVE.with_suffix(".exe") if sys.platform == "win32" else NATIVE
    if not exe.exists():
        built = subprocess.run(
            ["cargo", "build", "--release"], cwd=CRATE, capture_output=True, text=True
        )
        if built.returncode != 0:
            raise DeepGalleryError(f"cargo build failed:\n{built.stderr[-2000:]}")
    argv = [str(exe), command]
    for key, value in options.items():
        if value is None or value is False:
            continue
        argv.append(f"--{key}")
        if value is not True:
            argv.append(str(value))
    out = subprocess.run(argv, capture_output=True, text=True)
    if out.returncode != 0:
        raise DeepGalleryError(f"{argv}: {out.stderr[-2000:]}")
    return json.loads(out.stdout)


def _frame_args(frame: dict) -> dict:
    options = {
        "re": frame["re"],
        "im": frame["im"],
        "w": float(f"{float(frame['w']):.4g}"),
        "deg": frame.get("deg", 2),
    }
    if frame.get("jre") is not None:
        options.update(jre=frame["jre"], jim=frame["jim"], anchor=_anchor(frame))
    return options


def _anchor(frame: dict) -> str:
    """`deep-render.js`'s `anchorOf`: the nearer of `z = c` and `z = 0`, ties to `c`."""
    to_c = max(
        abs(float(_dec(frame["re"]) - _dec(frame["jre"]))),
        abs(float(_dec(frame["im"]) - _dec(frame["jim"]))),
    )
    to_origin = max(abs(float(frame["re"])), abs(float(frame["im"])))
    return "origin" if to_origin < to_c else "parameter"


def _shade(jobs: list[dict]) -> dict[str, str]:
    """Colour fields as the tab does; returns each job's canonical link by id."""
    with tempfile.TemporaryDirectory() as scratch:
        path = Path(scratch) / "jobs.json"
        path.write_text(json.dumps(jobs), encoding="utf-8", newline="\n")
        out = subprocess.run(["node", str(SHADE), str(path)], capture_output=True, text=True)
    if out.returncode != 0:
        raise DeepGalleryError(out.stderr[-3000:])
    return {row["id"]: row["link"] for row in json.loads(out.stdout)}


# ------------------------------------------------------------------- exact decimals


def _dec(text) -> Decimal:
    return Decimal(str(text))


def _spell(x, places: int) -> str:
    """An exact decimal to `places` fraction digits, plain notation, trimmed of zeros."""
    s = format(Decimal(x).quantize(Decimal(1).scaleb(-places)), "f")
    if "." in s:
        s = s.rstrip("0").rstrip(".")
    return "0" if s in ("-0", "") else s


def _places(width: float) -> int:
    """Digits a centre needs at `width` on a 1280 grid, plus four of guard."""
    return max(18, math.ceil(-math.log10(width / ACROSS)) + 4)


def floor_width(re, im) -> float:
    """The width under which `f64` cannot draw this centre at 1280 across."""
    return RESOLUTION_ULPS * math.ulp(max(abs(float(re)), abs(float(im)))) * ACROSS


# ------------------------------------------------------------------------ the register


def fnv(text: str) -> str:
    """A tile's file name: 64-bit FNV-1a of the row's link, as `deep-gallery.js` computes it."""
    h = 0xCBF29CE484222325
    for byte in text.encode("utf-8"):
        h = ((h ^ byte) * 0x100000001B3) & 0xFFFFFFFFFFFFFFFF
    return f"{h:016x}"


def register() -> list[dict]:
    """The register's rows, each `{subject, link}` and nothing else."""
    rows = []
    for number, line in enumerate(REGISTER.read_text(encoding="utf-8").splitlines(), 1):
        if not line.strip():
            continue
        row = json.loads(line)
        if set(row) != {"subject", "link"}:
            raise DeepGalleryError(
                f"{REGISTER.name} line {number}: a row is subject and link, got {sorted(row)}"
            )
        if not row["link"].startswith("dv="):
            raise DeepGalleryError(f"{REGISTER.name} line {number}: not a deep link")
        rows.append(row)
    return rows


def frame_of(link: str) -> dict:
    """What the native path needs out of a deep link: the set, the frame and the cap."""
    keys = dict(parse_qsl(link, keep_blank_values=True))
    if "n" not in keys:
        raise DeepGalleryError(f"a gallery link pins its cap with n: {link}")
    family = keys.get("f", "julia" if "cx" in keys else "mandelbrot")
    degree = (
        2
        if family == "mandelbrot"
        else int(family.removeprefix("julia").removeprefix("multibrot") or 2)
    )
    frame = {"re": keys["x"], "im": keys["y"], "w": keys["w"], "deg": degree}
    if "cx" in keys:
        frame.update(jre=keys["cx"], jim=keys["cy"])
    return {**frame, "cap": int(keys["n"])}


def thumbs() -> list[str]:
    """Draw a tile for every register row that has none; remove tiles no row names."""
    rows = register()
    canonical = _shade([{"id": str(i), "query": row["link"]} for i, row in enumerate(rows)])
    for i, row in enumerate(rows):
        if canonical[str(i)] != row["link"]:
            raise DeepGalleryError(
                f"row {i + 1} is not in its canonical spelling; write it as\n{canonical[str(i)]}"
            )
    THUMBS.mkdir(exist_ok=True)
    (WORK / "fields").mkdir(parents=True, exist_ok=True)
    wanted = {f"{fnv(row['link'])}.webp": row for row in rows}
    said = []
    for stale in sorted(THUMBS.iterdir()):
        if stale.name not in wanted:
            stale.unlink()
            said.append(f"removed {stale.name}")
    size = (THUMB["width"], THUMB["height"])
    for name, row in wanted.items():
        target = THUMBS / name
        if target.exists():
            continue
        frame = frame_of(row["link"])
        field = WORK / "fields" / f"thumb_{target.stem}.f64"
        drawn = _native(
            "field",
            res=f"{size[0]}x{size[1]}",
            ss=THUMB["supersample"],
            cap=frame["cap"],
            out=field,
            **_frame_args(frame),
        )
        raw = WORK / "fields" / f"thumb_{target.stem}.rgba"
        job = {
            "id": name,
            "query": row["link"],
            "field": str(field),
            "width": size[0],
            "height": size[1],
            "ss": THUMB["supersample"],
            "out": str(raw),
        }
        _shade([job])
        images.write_rgba(raw.read_bytes(), size, target, webp_quality=images.TILE_WEBP_QUALITY)
        raw.unlink()
        said.append(f"drew {name}: {drawn['seconds']} s, cap {frame['cap']:,}")
    total = sum(path.stat().st_size for path in THUMBS.iterdir())
    said.append(
        f"{len(wanted)} tiles in {THUMBS.relative_to(SITE_ROOT).as_posix()}/, {total:,} bytes"
    )
    return said


# ----------------------------------------------------------------------- descents


def _places_to_descend(degree: int, count: int, seed: int) -> list[dict]:
    """`count` enclosed places of this degree, one per region, shuffled by `seed`."""
    from .renders import wallpapers_root

    examples = wallpapers_root() / "artifacts" / "discovery" / "minibrot_examples.jsonl"
    rows = [json.loads(line) for line in examples.read_text().splitlines()[1:]]
    mine = []
    for r in rows:
        if "place" not in r or not r.get("picture"):
            continue
        _family, deg, _k, x, y, w = json.loads(r["place"])
        if deg == degree:
            mine.append((r, x, y, w))
    random.Random(seed).shuffle(mine)
    seen, picked = set(), []
    for r, x, y, w in mine:
        key = (r["q"], round(float(x), 3), round(float(y), 3))
        if key in seen:
            continue
        seen.add(key)
        picked.append(
            {
                "x": x,
                "y": y,
                "w": w,
                "q": r["q"],
                "candidate": r.get("candidate"),
                "query": r["query"],
            }
        )
        if len(picked) == count:
            break
    return picked


def descend_from(place: dict, degree: int, extra: int = 0) -> list[dict]:
    """One descent: a chain of nuclei, each a smaller copy inside the view of the last.

    Each rung searches its view and takes the first nucleus `nuclei::search` returns —
    it returns them largest first — that is under an `RUNG_SHRINK`th of the last one's
    body and farther than `APART_BODIES` of every earlier body from it. The next view is
    `LOOK_BODIES` of the new body, centred on it. The chain stops when no nucleus
    qualifies, at `MAX_RUNGS`, or `extra` rungs after the first whose framed tile is below
    the floor.
    """
    view = {"re": place["x"], "im": place["y"], "w": float(place["w"])}
    chain, below = [], 0
    for _rung in range(MAX_RUNGS):
        found = _native("search", **view, deg=degree, budget=SEARCH_BUDGET, want=SEARCH_WANT)[
            "nuclei"
        ]
        candidates = [n for n in found if n["period"] <= MAX_PERIOD]
        if chain:
            last = chain[-1]

            def outside(n):
                for c in chain:
                    apart = max(
                        abs(float(_dec(n["re"]) - _dec(c["re"]))),
                        abs(float(_dec(n["im"]) - _dec(c["im"]))),
                    )
                    if apart < APART_BODIES * c["size"]:
                        return False
                return True

            candidates = [
                n for n in candidates if n["size"] < last["size"] / RUNG_SHRINK and outside(n)
            ]
        if not candidates:
            break
        n = candidates[0]
        n["found_in"] = dict(view)
        chain.append(n)
        tile = FRAME_BODIES * n["size"]
        places = _places(tile) + 4
        view = {
            "re": _spell(_dec(n["re"]), places),
            "im": _spell(_dec(n["im"]), places),
            "w": LOOK_BODIES * n["size"],
        }
        if tile < floor_width(n["re"], n["im"]):
            below += 1
            if below > extra:
                break
    return chain


def descend(degree: int, count: int, seed: int, extra: int) -> list[str]:
    """Descend from `count` places of one degree; append the chains to the working copy."""
    places = _places_to_descend(degree, count, seed)

    def one(place):
        try:
            return {"place": place, "degree": degree, "chain": descend_from(place, degree, extra)}
        except DeepGalleryError as error:
            return {"place": place, "degree": degree, "error": str(error)}

    with ThreadPoolExecutor(6) as pool:
        results = list(pool.map(one, places))
    WORK.mkdir(parents=True, exist_ok=True)
    said = []
    with (WORK / "descents.jsonl").open("a", encoding="utf-8", newline="\n") as out:
        for r in results:
            out.write(json.dumps(r) + "\n")
            steps = " > ".join(f"{n['period']}:{n['size']:.1e}" for n in r.get("chain", []))
            said.append(f"{degree} {r['place']['q']} {r.get('error', '')}{steps}")
    return said


def _chains() -> dict[tuple, dict]:
    """The committed descents, the longest chain per place, keyed by (degree, x, y)."""
    best = {}
    for line in DESCENTS.read_text(encoding="utf-8").splitlines():
        r = json.loads(line)
        if not r.get("chain"):
            continue
        key = (r["degree"], r["place"]["x"], r["place"]["y"])
        if key not in best or len(r["chain"]) > len(best[key]["chain"]):
            best[key] = r
    return best


# ------------------------------------------------------------------------- frames


def main_root(degree: int, theta: float, rho: float = 1.0) -> complex:
    """The main component's point whose fixed point has multiplier rho·e^{2πiθ}."""
    z = (rho * cmath.exp(2j * math.pi * theta) / degree) ** (1 / (degree - 1))
    return z - z**degree


def _escape(grid, degree: int, cap: int):
    import numpy as np

    z = np.zeros_like(grid)
    n = np.full(grid.shape, cap)
    alive = np.ones(grid.shape, bool)
    for k in range(cap):
        z[alive] = z[alive] ** degree + grid[alive]
        out = alive & (np.abs(z) > 4)
        n[out] = k
        alive &= ~out
    return n


def spots(degree: int) -> tuple[complex, complex | None, complex | None]:
    """A whole-set valley and spiral point near the period-2 root, on the upper side.

    The valley is an exterior point 0.05 to 0.12 from the root escaping in 80 to 400, the
    one nearest 0.08 from it; the spiral point is the slowest escape (1200 to 3000) 0.02 to
    0.12 from it. A 401-square grid 0.4 wide, escape radius 4.
    """
    import numpy as np

    root = main_root(degree, 0.5)
    g = np.linspace(-0.2, 0.2, 401)
    grid = root + g[None, :] + 1j * g[:, None]
    n = _escape(grid, degree, 3000)
    dist = np.abs(grid - root)
    if degree == 2:
        side = (grid - root).imag * np.sign(root.real or 1) > 0
    else:
        side = (grid - root).imag > 0
    v = (n > 80) & (n < 400) & (dist > 0.05) & (dist < 0.12) & side
    s = (n > 1200) & (n < 3000) & (dist > 0.02) & (dist < 0.12) & side
    iv, isp = np.argwhere(v), np.argwhere(s)
    valley = grid[tuple(iv[np.argmin(np.abs(dist[tuple(iv.T)] - 0.08))])] if len(iv) else None
    spiral = grid[tuple(isp[np.argmax(n[tuple(isp.T)])])] if len(isp) else None
    # Plain complex numbers: a numpy scalar's repr is not a decimal a copy point can read.
    return root, *(None if v is None else complex(v) for v in (valley, spiral))


def _copy_point(nucleus: dict, whole: complex) -> tuple[Decimal, Decimal]:
    """The point of a copy whose whole-set coordinate is `whole`: nucleus + whole / scale."""
    z = complex(whole) / cmath.rect(1.0, nucleus["scale_arg"])
    factor = Decimal(2) ** Decimal(-nucleus["scale_log2"])
    return (
        _dec(nucleus["re"]) + Decimal(repr(z.real)) * factor,
        _dec(nucleus["im"]) + Decimal(repr(z.imag)) * factor,
    )


def _spot(nucleus: dict, whole: complex, width_whole: float) -> tuple[str, str, float]:
    x, y = _copy_point(nucleus, whole)
    w = width_whole * 2.0 ** (-nucleus["scale_log2"])
    places = _places(w)
    return _spell(x, places), _spell(y, places), float(f"{w:.3g}")


def frames_for(label: str, degree: int, n: dict, parent_w: float, kinds: dict, where) -> list:
    """Frames cut from one solved nucleus `n` (with `l_log2`, `l_arg`, the copy's scale).

    - `minibrot`: centred on the nucleus, `FRAME_BODIES` bodies wide.
    - `stage`: centred on it at two widths between the framed minibrot and the view it was
      found in, geometric at a half and a quarter of the way up.
    - `valley`, `spiral`, `filigree`: a whole-set point mapped into the copy.
    - `julia`: for each `(tag, C)`, the Julia set at the copy point of `C`, framed on the
      image of that whole-set Julia set.

    A frame not below the floor is dropped.
    """
    body = 2.0 ** n["size_log2"]
    period = n["period"]
    base = {"deg": degree, "period": period, "source": label}
    out = []
    places = _places(FRAME_BODIES * body)
    if "minibrot" in kinds:
        w = float(f"{FRAME_BODIES * body:.3g}")
        out.append(
            dict(base, id=f"{label}-mb", re=_spell(_dec(n["re"]), places),
                 im=_spell(_dec(n["im"]), places), w=repr(w),
                 periods=MINIBROT_PERIODS, subject="minibrot")
        )  # fmt: skip
    if "stage" in kinds:
        for t, tag in ((0.5, "st"), (0.25, "st2")):
            w = float(f"{(FRAME_BODIES * body) ** (1 - t) * parent_w**t:.3g}")
            pw = _places(w)
            out.append(
                dict(base, id=f"{label}-{tag}", re=_spell(_dec(n["re"]), pw),
                     im=_spell(_dec(n["im"]), pw), w=repr(w),
                     periods=STAGE_PERIODS, subject="julia-stage")
            )  # fmt: skip
    if "valley" in kinds:
        x, y, w = _spot(n, where[degree][1], 0.06)
        out.append(dict(base, id=f"{label}-sh", re=x, im=y, w=repr(w), subject="spiral"))
    if "spiral" in kinds:
        x, y, w = _spot(n, where[degree][2], 0.006)
        out.append(dict(base, id=f"{label}-sp", re=x, im=y, w=repr(w), subject="spiral"))
    if "filigree" in kinds:
        x, y, w = _spot(n, 2.2 * cmath.exp(0.6j), 1.6)
        out.append(dict(base, id=f"{label}-fg", re=x, im=y, w=repr(w), subject="filigree"))
    for tag, whole in kinds.get("julia", []):
        c = _copy_point(n, whole)
        # Near c, the copy's Julia set is s^D·(J_C − C) about c, with s = l^{−1/(D−1)}.
        ln_l = n["l_log2"] * math.log(2) + 1j * n["l_arg"]
        s_d = cmath.exp(-degree / (degree - 1) * ln_l)
        size = abs(s_d)
        shift = -whole * (s_d / size)
        f = Decimal(repr(size))
        zx = c[0] + Decimal(repr(shift.real)) * f
        zy = c[1] + Decimal(repr(shift.imag)) * f
        w = float(f"{4.5 * size:.3g}")
        pc = _places(w) + 2
        out.append(
            dict(deg=degree, source=label, id=f"{label}-j{tag}", jre=_spell(c[0], pc),
                 jim=_spell(c[1], pc), re=_spell(zx, pc), im=_spell(zy, pc), w=repr(w),
                 subject="julia-stage" if tag.startswith("i") else "spiral")
        )  # fmt: skip
    return [f for f in out if float(f["w"]) < floor_width(f["re"], f["im"])]


def _solve(n: dict, degree: int, places: int = 60) -> dict:
    limbs = max(3, math.ceil((-n["size_log2"] + 100) / 64) + 1)
    return _native(
        "solve", re=n["re"], im=n["im"], period=n["period"], deg=degree, limbs=limbs, places=places
    )


def frames() -> list[str]:
    """Every candidate frame the record's choices make, into `artifacts/deep-gallery/`."""
    record = json.loads(RECORD.read_text(encoding="utf-8"))
    video = json.loads(VIDEO.read_text(encoding="utf-8"))
    where = {d: spots(d) for d in range(2, 7)}
    out = []
    for frame in record["video"]["frames"]:
        out.append(
            dict(id=frame["id"], re=video["center_re"], im=video["center_im"], w=frame["w"],
                 subject="filigree", source=frame["source"])
        )  # fmt: skip
    for name, spec in record["continuations"].items():
        n = record["nuclei"][name]
        for w in spec["widths"]:
            places = _places(float(w))
            out.append(
                dict(id=f"{name}-{w}", re=_spell(_dec(n["re"]), places),
                     im=_spell(_dec(n["im"]), places), w=w, period=n["period"],
                     periods=MINIBROT_PERIODS,
                     subject="minibrot" if w == spec["framed"] else "julia-stage",
                     source=f"period-{n['period']} nucleus continuation")
            )  # fmt: skip
    chains = _chains()
    solved = {}
    for entry in record["plan"]:
        degree = entry["degree"]
        chain = chains[(degree, *entry["place"])]["chain"]
        n = chain[entry["rung"]]
        s = _solve(n, degree)
        solved[entry["label"]] = s
        kinds = {k: True for k in entry["kinds"] if k != "julia"}
        if "julia" in entry["kinds"]:
            kinds["julia"] = [
                ("i", main_root(degree, 1 / 3, 0.95)),
                ("o", where[degree][1]),
            ]
        out += frames_for(entry["label"], degree, s, n["found_in"]["w"], kinds, where)
    extra = record["julia_extra_constants"]
    for entry in record["julia_extra"]:
        if "nucleus" in entry:
            n = record["nuclei"][entry["nucleus"]]
            s = _native("solve", re=n["re"], im=n["im"], period=n["period"], limbs=5, places=60)
        else:
            s = solved[entry["plan"]]
        constants = [
            ("i", main_root(2, 1 / 3, 0.95)),
            ("o", where[2][1]),
            *((tag, complex(*value)) for tag, value in extra.items()),
        ]
        out += frames_for(entry["label"], 2, s, entry["parent_w"], {"julia": constants}, where)
    WORK.mkdir(parents=True, exist_ok=True)
    path = WORK / "frames.jsonl"
    path.write_text("".join(json.dumps(f) + "\n" for f in out), encoding="utf-8", newline="\n")
    return [f"{len(out)} frames in {path.relative_to(SITE_ROOT).as_posix()}"]


# --------------------------------------------------------------- caps and colour


def cap_for(frame: dict, resolution: tuple[int, int]) -> tuple[int, dict]:
    """The kernel's settled cap for this frame, raised to `periods` of its nucleus.

    `max(settled, min(CEILING, period × periods))`: a framed minibrot and every
    nucleus continuation ask for `MINIBROT_PERIODS`, a descent's stage for
    `STAGE_PERIODS`, and a frame with no nucleus of its own takes the settled cap.
    """
    settled = _native("settle", res=f"{resolution[0]}x{resolution[1]}", **_frame_args(frame))
    cap = settled["maxiter"]
    if frame.get("period") and frame.get("periods"):
        cap = max(cap, min(CEILING, frame["period"] * frame["periods"]))
    return cap, settled


def _load_field(path: Path, width: int, height: int, ss: int = 1):
    import numpy as np

    return np.fromfile(path, dtype="<f8").reshape(height * ss, width * ss)


def _compress(nu, lam: float):
    import numpy as np

    nu = np.maximum(nu, 1e-12)
    return np.log(nu) if lam == 0 else (nu**lam - 1.0) / lam


def _roughness(g, period: float) -> float:
    """Share of neighbouring sample pairs more than a quarter turn apart in colour."""
    import numpy as np

    t = g / period
    dx = np.abs(np.diff(t, axis=1))
    dy = np.abs(np.diff(t, axis=0))
    both = np.concatenate([dx[np.isfinite(dx)], dy[np.isfinite(dy)]])
    return 1.0 if both.size == 0 else float(np.mean(both > 0.25))


def choose(field, cycles: float, prefer: float | None = None) -> tuple[float, float, float]:
    """`(lambda, period, roughness)` for a field under `scale=absolute`.

    For each lambda in `LAMBDA_GRID`, `g` is the Box-Cox of the smooth count (its log at
    zero) and the period is the 3rd-to-97th-percentile range of `g` over `cycles`, to three
    figures. A lambda is acceptable where under `ROUGH` of neighbouring pairs are more than a
    quarter turn apart; the acceptable one nearest `prefer` wins, else the smoothest.
    """
    import numpy as np

    if np.isfinite(field).sum() < 100:
        return 0.0, 1.0, 1.0
    tried = []
    for lam in LAMBDA_GRID:
        g = _compress(field, lam)
        lo, hi = np.percentile(g[np.isfinite(g)], [3, 97])
        period = float(f"{max(hi - lo, 1e-9) / cycles:.3g}")
        tried.append((lam, period, _roughness(g, period)))
    fine = [t for t in tried if t[2] < ROUGH]
    if fine:
        return min(fine, key=lambda t: abs(t[0] - prefer) if prefer is not None else t[0])
    return min(tried, key=lambda t: t[2])


def query(frame: dict, cap: int, palette: str, lam: float, period: float, phase: float) -> str:
    """A frame and a colour as a deep link, before `deep-link.js` canonicalizes it."""
    degree = frame.get("deg", 2)
    julia = frame.get("jre") is not None
    parts = ["dv=3"]
    if degree != 2:
        parts.append(f"f={'julia' if julia else 'multibrot'}{degree}")
    if julia:
        parts += [f"cx={frame['jre']}", f"cy={frame['jim']}"]
    parts += [f"x={frame['re']}", f"y={frame['im']}", f"w={frame['w']}", f"n={cap}"]
    parts += [f"p={quote(palette, safe='')}", "scale=absolute"]
    if lam != 1:
        parts.append(f"lambda={lam:g}")
    parts.append(f"period={period:g}")
    if phase:
        parts.append(f"phase={phase:g}")
    return "&".join(parts)


# ------------------------------------------------------------------ previews


def _render(frame: dict, resolution, ss: int, tag: str, threads: int | None = None) -> dict:
    cap = frame.get("cap")
    settled = None
    if cap is None:
        cap, settled = cap_for(frame, resolution[:2])
    field = WORK / "fields" / f"{tag}_{frame['id']}.f64"
    drawn = _native(
        "field", res=f"{resolution[0]}x{resolution[1]}", ss=ss, cap=cap, out=field,
        threads=threads, **_frame_args(frame),
    )  # fmt: skip
    return {**drawn, "settle": settled, "cap": cap, "field": str(field)}


def preview(frames_path: Path, name: str, workers: int = 3) -> list[str]:
    """Render each frame at 256x144, colour it automatically, lay the lot out labelled."""
    frames_list = [json.loads(line) for line in frames_path.read_text().splitlines() if line]
    held = WORK / "previews"
    held.mkdir(parents=True, exist_ok=True)
    (WORK / "fields").mkdir(exist_ok=True)

    def one(frame):
        meta = held / f"{frame['id']}.json"
        if meta.exists():
            return json.loads(meta.read_text())
        if not float(frame["w"]) < floor_width(frame["re"], frame["im"]):
            raise DeepGalleryError(f"{frame['id']} is above the floor")
        drawn = _render(frame, PREVIEW, 1, "p", threads=max(1, 12 // workers))
        drawn["frame"] = frame
        meta.write_text(json.dumps(drawn), encoding="utf-8", newline="\n")
        return drawn

    with ThreadPoolExecutor(workers) as pool:
        metas = list(pool.map(one, frames_list))
    jobs = []
    for i, m in enumerate(metas):
        f = m["frame"]
        field = _load_field(Path(m["field"]), *PREVIEW)
        lam, period, _ = choose(field, f.get("cycles", 3), prefer=f.get("lam", 0.3))
        jobs.append(
            dict(id=f["id"], query=query(f, m["cap"], PREVIEW_PALETTES[i % 6], lam, period, 0.1),
                 field=m["field"], width=PREVIEW[0], height=PREVIEW[1], ss=1,
                 out=str(held / f"{f['id']}.rgba"))
        )  # fmt: skip
    _shade(jobs)
    _to_png(jobs)
    lines = [f"{m['frame']['id']}: cap {m['cap']:,}, interior {m['interior']:.2f}" for m in metas]
    _contact(metas, held, WORK / f"{name}.png")
    return [*lines, f"{WORK / name}.png"]


def _to_png(jobs: list[dict]) -> None:
    import numpy as np
    from PIL import Image

    for job in jobs:
        raw = np.fromfile(job["out"], dtype=np.uint8).reshape(job["height"], job["width"], 4)
        Image.fromarray(raw[:, :, :3]).save(job["out"].replace(".rgba", ".png"))
        Path(job["out"]).unlink()


def _font(name: str, size: int):
    from PIL import ImageFont

    try:
        return ImageFont.truetype(name, size)
    except OSError:
        return ImageFont.load_default()


def _contact(metas: list[dict], held: Path, path: Path, cols: int = 5) -> None:
    from PIL import Image, ImageDraw

    w, h = PREVIEW
    rows = math.ceil(len(metas) / cols)
    sheet = Image.new("RGB", (cols * (w + 6), rows * (h + 36)), (30, 30, 30))
    draw = ImageDraw.Draw(sheet)
    font = _font("arial.ttf", 12)
    for i, m in enumerate(metas):
        f = m["frame"]
        x, y = (i % cols) * (w + 6), (i // cols) * (h + 36)
        sheet.paste(Image.open(held / f"{f['id']}.png"), (x, y))
        draw.text((x + 2, y + h + 1), f["id"], fill=(255, 255, 255), font=font)
        draw.text(
            (x + 2, y + h + 15),
            f"d{f.get('deg', 2)} w{float(f['w']):.1e} n{m['cap']} int{m['interior']:.2f}",
            fill=(200, 200, 200),
            font=font,
        )
    sheet.save(path)


def zooms() -> list[str]:
    """Two off-centre frames into each named preview's busiest exterior, a sixth as wide.

    The preview is cut into an 8×6 grid, corners skipped and any cell over 1% interior
    skipped. A cell scores the median of its colour gradient under a log compression,
    folded so that a middling gradient beats both a flat one and noise
    (`m` under 0.08, else `0.16 − m`); the two best cells more than two apart are taken.
    """
    import numpy as np

    record = json.loads(RECORD.read_text(encoding="utf-8"))
    factor = record["zooms"]["factor"]
    out = []
    for fid in record["zooms"]["from"]:
        m = json.loads((WORK / "previews" / f"{fid}.json").read_text())
        f = m["frame"]
        field = _load_field(Path(m["field"]), *PREVIEW)
        g = _compress(field, 0.0)
        gx = np.abs(np.diff(g, axis=1))[:-1, :]
        gy = np.abs(np.diff(g, axis=0))[:, :-1]
        e = np.nan_to_num(np.minimum(gx + gy, 1.0), nan=0.0)
        interior = ~np.isfinite(field)
        cw, ch = PREVIEW[0] // 8, PREVIEW[1] // 6
        scores = []
        for j in range(6):
            for i in range(8):
                if i in (0, 7) and j in (0, 5):
                    continue
                cell = np.s_[j * ch : (j + 1) * ch, i * cw : (i + 1) * cw]
                if interior[cell].mean() > 0.01:
                    continue
                median = np.median(e[cell])
                scores.append((median if median < 0.08 else 0.16 - median, i, j))
        scores.sort(reverse=True)
        picks = []
        for s, i, j in scores:
            if all(abs(i - a) + abs(j - b) > 2 for _, a, b in picks):
                picks.append((s, i, j))
            if len(picks) == 2:
                break
        w = Decimal(f["w"])
        height = w * Decimal(9) / Decimal(16)
        for k, (_s, i, j) in enumerate(picks):
            cx, cy = (i + 0.5) * cw, (j + 0.5) * ch
            x = _dec(f["re"]) + (Decimal(cx) / PREVIEW[0] - Decimal("0.5")) * w
            y = _dec(f["im"]) + (Decimal("0.5") - Decimal(cy) / PREVIEW[1]) * height
            nw = float(f"{float(w) / factor:.3g}")
            places = _places(nw)
            zoom = {k2: v for k2, v in f.items() if k2 not in ("period", "periods", "cap")}
            zoom.update(
                id=f"{fid}-z{k}", re=_spell(x, places), im=_spell(y, places), w=repr(nw),
                subject="spiral", source=f"zoom of {fid}",
            )  # fmt: skip
            out.append(zoom)
    path = WORK / "frames-zoom.jsonl"
    path.write_text("".join(json.dumps(z) + "\n" for z in out), encoding="utf-8", newline="\n")
    return [f"{len(out)} zoom frames in {path.relative_to(SITE_ROOT).as_posix()}"]


# ------------------------------------------------------------------ the sheet


def _selection() -> list[dict]:
    """The record's 65, each with the cap its preview settled, subject as the record says."""
    record = json.loads(RECORD.read_text(encoding="utf-8"))
    rows = []
    for subject, ids in record["selection"].items():
        for fid in ids:
            m = json.loads((WORK / "previews" / f"{fid}.json").read_text())
            rows.append({"frame": {**m["frame"], "subject": subject}, "cap": m["cap"]})
    return rows


def render() -> list[str]:
    """The selection at 640x360, 2x2 samples, at each preview's cap. Resumes."""
    said = []
    for row in _selection():
        f = row["frame"]
        meta = WORK / "fields" / f"final_{f['id']}.json"
        if meta.exists():
            continue
        drawn = _render({**f, "cap": row["cap"]}, FINAL[:2], FINAL[2], "final")
        meta.write_text(json.dumps(drawn), encoding="utf-8", newline="\n")
        said.append(f"{f['id']}: {drawn['seconds']} s, interior {drawn['interior']}")
    return said


def _grouped() -> list[tuple[str, list[dict]]]:
    rows = _selection()
    out = []
    for subject, title, julia in GROUPS:
        group = [
            r
            for r in rows
            if r["frame"]["subject"] == subject
            and (julia is None or bool(r["frame"].get("jre")) == julia)
        ]
        group.sort(key=lambda r: -float(r["frame"]["w"]))
        out.append((title, group))
    return out


def sheet() -> list[str]:
    """Colour the rendered selection, number it shallow to deep within each group, and
    write `candidates.jsonl` and the four contact sheets.

    Tile `number` in group `g` takes palette `PALETTES[7·number mod 24]`, `cycles`
    `CYCLES[k mod 6]` and preferred lambda `LAMBDAS[k mod 6]` with `k = number + 3g`, except
    that a framed minibrot at odd `k` prefers lambda 0; phase `0.137·number mod 1`.
    """
    groups = _grouped()
    tiles = WORK / "tiles"
    tiles.mkdir(parents=True, exist_ok=True)
    width, height, ss = FINAL
    number, jobs, records = 0, [], []
    for g, (title, rows) in enumerate(groups):
        for r in rows:
            number += 1
            f = r["frame"]
            meta = json.loads((WORK / "fields" / f"final_{f['id']}.json").read_text())
            field_path = WORK / "fields" / f"final_{f['id']}.f64"
            field = _load_field(field_path, width, height, ss)
            k = number + 3 * g
            palette = PALETTES[(number * 7) % len(PALETTES)]
            prefer = 0.0 if f["subject"] == "minibrot" and k % 2 else LAMBDAS[k % len(LAMBDAS)]
            lam, period, rough = choose(field, CYCLES[k % len(CYCLES)], prefer=prefer)
            phase = round((number * 0.137) % 1, 3)
            jobs.append(
                dict(id=f["id"], query=query(f, meta["maxiter"], palette, lam, period, phase),
                     field=str(field_path), width=width, height=height, ss=ss,
                     out=str(tiles / f"{number:02d}.rgba"))
            )  # fmt: skip
            records.append(
                dict(tile=number, group=title, id=f["id"], degree=f.get("deg", 2),
                     plane="julia" if f.get("jre") else "mandelbrot", width=f["w"],
                     cap=meta["maxiter"], source=f.get("source", ""), palette=palette)
            )  # fmt: skip
    links = _shade(jobs)
    _to_png(jobs)
    with (WORK / "candidates.jsonl").open("w", encoding="utf-8", newline="\n") as out:
        for rec in records:
            row = dict(tile=rec["tile"], link=links[rec["id"]], subject=rec["group"],
                       degree=rec["degree"], plane=rec["plane"], width=rec["width"],
                       cap=rec["cap"], source=rec["source"], frame=rec["id"])  # fmt: skip
            out.write(json.dumps(row) + "\n")
    _sheets(groups, records, tiles)
    return [f"{number} tiles; candidates.jsonl and sheet1-4.png in {WORK.as_posix()}"]


def _sheets(groups, records, tiles: Path) -> None:
    from PIL import Image, ImageDraw

    width, height, _ = FINAL
    big, small, head = _font("arialbd.ttf", 28), _font("arial.ttf", 15), _font("arialbd.ttf", 30)
    by_group = {}
    for rec in records:
        by_group.setdefault(rec["group"], []).append(rec)
    cols, gap, label = 3, 10, 26
    for s, members in enumerate([[0], [1], [2, 3], [4]], 1):
        blocks = [(groups[i][0], by_group.get(groups[i][0], [])) for i in members]
        total = sum(50 + math.ceil(len(r) / cols) * (height + label + gap) for _, r in blocks)
        im = Image.new("RGB", (cols * (width + gap) + gap, total + gap), (24, 24, 24))
        draw = ImageDraw.Draw(im)
        y = 0
        for title, recs in blocks:
            draw.text((gap, y + 10), f"{title}  ({len(recs)})", fill=(235, 235, 235), font=head)
            y += 50
            for i, rec in enumerate(recs):
                x = gap + (i % cols) * (width + gap)
                yy = y + (i // cols) * (height + label + gap)
                im.paste(Image.open(tiles / f"{rec['tile']:02d}.png"), (x, yy))
                draw.rectangle([x, yy, x + 44, yy + 34], fill=(0, 0, 0))
                draw.text((x + 4, yy + 2), f"{rec['tile']}", fill=(255, 255, 255), font=big)
                plane = "Julia" if rec["plane"] == "julia" else "Mandelbrot"
                draw.text(
                    (x + 2, yy + height + 4),
                    f"degree {rec['degree']} · {plane} · width {float(rec['width']):.2g} · "
                    f"cap {rec['cap']:,} · {rec['palette'][:28]}",
                    fill=(200, 200, 200),
                    font=small,
                )
            y += math.ceil(len(recs) / cols) * (height + label + gap)
        im.save(WORK / f"sheet{s}.png")
