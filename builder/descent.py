"""Automatic minibrot descents: a chain of frames, each centred on a copy, descended by twins.

    python -m builder descent <link> [<link> ...] [--name N] [--branch J] [--dry-run]
    python -m builder descent --colour <record>
    python -m builder descent --stills <record>

## The idea (Matt, double_descent_ckpt145 and its addendum)

The neighbourhood of a primitive copy `M_A`, nucleus `c_A`, period `p_A`, is close to
`c_A + s_A·M`, with `s_A` its complex size. So every place of the set has a **twin** inside
`M_A`: the twin of a location `B`, centred on its own copy `c_B`, sits at `c_A + s_A·c_B`,
`|s_A|` times smaller and turned by `arg(s_A)`, and at its heart is `M_AB`, the copy of `M_B`
inside `M_A`, of period `p_A·p_B`. A chain `L₁ … L_k` descends home → `L₁` → `M₁` framed →
the twin of `L₂` → `M₁₂` framed → the twin of `L₃` → … The single-location descent is the
chain `[A, A]`.

Every number comes from `builder/deep-gallery-native`, which is `perturb-wasm`'s arithmetic
natively:

- each location's nucleus is `search`'s nucleus nearest the frame's centre, **refused** where
  it is a bulb (`classify`, Find minibrots' test) or where no nucleus is within an eighth of
  the frame;
- `s_A` is `orient`'s complex scale, from the nucleus's own derivatives: `1/(d·l^{1/(D−1)})`;
- the twin's copy is `twin`'s multiple-shooting solve, because first-order `c_A + s_A·c_B` is
  only right to the tuning's nonlinearity — a thousandth of the offset, which on the test
  seat is a hundred thousand twin frames and outside Newton's reach at period `p_A·p_B`;
- a copy is framed by `frame`, Find minibrots' own rule: the body measured on the preview
  tile and set at a quarter of the height.

**The ceiling.** A copy is opened at 32 of its periods. Where `32·p_A·p_B` passes
`cap::CEILING`, the descent ends instead on the lowest-period copy `find` offers in the twin
frame that fits; where none fits — and inside a twin every copy's period is a multiple of
`p_A`, so often none does — it ends on the twin's copy at the ceiling and says so.

**Rotation.** Neither the explorer nor `zoom.py` rotates, so a twin appears turned by
`arg(s_A)`; the record carries it. At degree `D` the scale is defined up to a `(D−1)`-th root
of unity, the Multibrot set's own symmetry, and `--branch` picks which twin.

## The record

`data/<name>.keyframes.json`, in the shape of `data/deep-zoom-descent.keyframes.json` so that
`zoom_fields.mjs --record` renders it and `zoom.py --record` colours and encodes it. Every
keyframe is centred on the last copy, which is how `zoom.py` composites; the stage frames
are named on their nearest keyframe and kept exactly in `stages`. Caps are the Deep tab's
settle, raised at each stage frame and every keyframe deeper to 32 periods of the copy that
stage is about, under the ceiling.
"""

from __future__ import annotations

import argparse
import json
import math
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

import numpy as np

from .deep_gallery import DeepGalleryError, _native

HERE = Path(__file__).resolve().parent
DATA = HERE / "data"
SITE_ROOT = HERE.parent

#: `cap::CEILING` and `nuclei::OPEN_PERIODS`.
CEILING = 1_000_000
OPEN_PERIODS = 32

#: The families a descent may run in, and their degrees: the Deep tab's parameter planes.
FAMILIES = {"mandelbrot": 2, "multibrot3": 3, "multibrot4": 4, "multibrot5": 5, "multibrot6": 6}

#: Each family's home view, `(centre re, width)` with the centre on the real axis, as
#: `engine.wasm`'s `plan` answers it (read 2026-09-23). The descent's first keyframe is the
#: first width that holds this frame whole.
HOME = {
    2: (-0.77, 4.4),
    3: (0.0, 5.2),
    4: (-0.23, 4.4),
    5: (0.0, 3.6),
    6: (-0.09, 4.3),
}

#: The field grid the movie's keyframes are drawn at, twice the video's own size, and the
#: video: `deep-zoom-descent`'s timing at a first cut's resolution.
GRID = (1920, 1080)
VIDEO = {
    "resolution": [960, 540],
    "fps": 60,
    "seconds_per_halving": 1.5,
    "hold_start": 1,
    "hold_end": 3,
    "ease_seconds": 2,
    "ease_note": "The zoom's speed in halvings per second rises from zero to "
    "1/seconds_per_halving over ease_seconds along a raised cosine, and falls back the same "
    "way at the end.",
    "feather": 0.08,
    "feather_note": "The inner keyframe's edge fades over this share of its own width.",
}


class DescentError(DeepGalleryError):
    """A chain the descent refuses, or a step it could not take."""


@dataclass(frozen=True)
class Location:
    link: str
    family: str
    degree: int
    x: str
    y: str
    w: float
    palette: str | None


@dataclass
class Copy:
    """A solved nucleus: where, its period, its size and the complex scale's argument."""

    period: int
    re: str
    im: str
    size_log2: float
    arg: float  # arg(s), radians, on the chosen branch

    @property
    def size(self) -> float:
        return 2.0**self.size_log2

    @property
    def centre(self) -> tuple[float, float]:
        return float(self.re), float(self.im)


def parse(link: str) -> Location:
    """A shallow (`v=`) or deep (`dv=`) explorer link, or its bare query."""
    query = urlsplit(link).query if "?" in link else link
    q = {key: values[0] for key, values in parse_qs(query).items()}
    family = q.get("f", "mandelbrot")
    if family not in FAMILIES:
        raise DescentError(f"{family}: a descent runs in a parameter plane of degree 2 to 6")
    for key in ("x", "y", "w"):
        if key not in q:
            raise DescentError(f"{link}: the link names no `{key}`")
    return Location(link, family, FAMILIES[family], q["x"], q["y"], float(q["w"]), q.get("p"))


def _limbs(size_log2: float) -> int:
    """Limbs to hold a coordinate well under a body of this size, as the harness's own
    `limbs_for_size`, and one more for the arithmetic between steps."""
    bits = max(-size_log2 + 84.0, 128.0)
    return min(math.ceil(bits / 64) + 2, 16)


def _places(size_log2: float) -> int:
    return max(40, math.ceil(-size_log2 * math.log10(2)) + 24)


def _solved(re: str, im: str, period: int, degree: int, size_log2: float) -> Copy:
    """Newton at `period` from `re + im·i`, to the places the body wants, with its scale."""
    answer = _native(
        "solve",
        re=re,
        im=im,
        period=period,
        deg=degree,
        limbs=_limbs(size_log2),
        places=_places(size_log2),
    )
    if answer.get("escaped"):
        raise DescentError(f"Newton at period {period} escaped from {re} + {im}i")
    return Copy(period, answer["re"], answer["im"], answer["size_log2"], -answer["scale_arg"])


def _kind(copy: Copy, degree: int) -> str:
    answer = _native(
        "classify",
        re=copy.re,
        im=copy.im,
        period=copy.period,
        deg=degree,
        limbs=_limbs(copy.size_log2),
        **{"size-log2": copy.size_log2},
    )
    return answer["kind"]


def nucleus_of(location: Location) -> Copy:
    """The copy a location is centred on, or a refusal."""
    found = _native(
        "search",
        re=location.x,
        im=location.y,
        w=location.w,
        deg=location.degree,
        res="1280x720",
        want=12,
        budget=24,
    )
    best = None
    for n in found["nuclei"]:
        apart = math.hypot(float(n["re"]) - float(location.x), float(n["im"]) - float(location.y))
        if apart < location.w / 8 and (best is None or apart < best[0]):
            best = (apart, n)
    if best is None:
        raise DescentError(f"{location.link}: no nucleus within an eighth of the frame's centre")
    n = best[1]
    copy = _solved(n["re"], n["im"], n["period"], location.degree, n["size_log2"])
    kind = _kind(copy, location.degree)
    if kind != "copy":
        raise DescentError(
            f"{location.link}: the nucleus at the centre, period {copy.period}, is a bulb"
        )
    return copy


def twin_of(a: Copy, b: Copy, degree: int, branch: int) -> tuple[Copy, dict]:
    """`M_AB`, the copy of `M_B` inside `M_A`, and what the shooting said about itself."""
    expected = a.size_log2 + b.size_log2
    answer = _native(
        "twin",
        re=a.re,
        im=a.im,
        period=a.period,
        bre=b.re,
        bim=b.im,
        bperiod=b.period,
        deg=degree,
        branch=branch,
        limbs=_limbs(expected),
        blimbs=_limbs(b.size_log2),
        places=_places(expected),
    )
    if not answer["ok"]:
        raise DescentError(f"the twin of period {b.period} inside {a.period}: {answer['why']}")
    period = a.period * b.period
    copy = _solved(answer["re"], answer["im"], period, degree, expected)
    s = complex(*answer["s1"])
    guess = complex(float(a.re), float(a.im)) + s * complex(float(b.re), float(b.im))
    placed = complex(float(copy.re), float(copy.im))
    # With the branch folded in: `orient` answers on the principal branch.
    copy.arg = math.atan2(s.imag, s.real) + b.arg
    return copy, {
        "turned_degrees": math.degrees(math.atan2(s.imag, s.real)),
        "shooting_steps": answer["steps"],
        "first_order_miss": abs(placed - guess),
        "first_order_miss_of_offset": abs(placed - guess) / abs(guess - complex(*a.centre)),
        "size_over_product": copy.size / (a.size * b.size),
    }


def framed(copy: Copy, degree: int) -> dict:
    return _native(
        "frame",
        re=copy.re,
        im=copy.im,
        period=copy.period,
        deg=degree,
        **{"size-log2": copy.size_log2},
    )


def _fits(period: int) -> bool:
    return OPEN_PERIODS * period <= CEILING


def descend(links: list[str], branch: int = 0) -> dict:
    """The chain's stages, each with its frame, its copy and what was measured on the way."""
    locations = [parse(link) for link in links]
    if len({loc.family for loc in locations}) > 1:
        raise DescentError("every location must be the same family: " + ", ".join(links))
    degree = locations[0].degree
    first = locations[0]
    current = nucleus_of(first)
    size_1 = framed(current, degree)
    stages = [
        {"name": "location 1", "width": first.w, "period": current.period},
        {
            "name": "copy 1",
            "width": size_1["width"],
            "period": current.period,
            "body_share": size_1["share"],
        },
    ]
    chain = [
        {
            "link": first.link,
            "period": current.period,
            "re": current.re,
            "im": current.im,
            "size": current.size,
            "arg_degrees": math.degrees(current.arg),
        }
    ]
    notes = []
    label = "1"
    for index, location in enumerate(locations[1:], start=2):
        b = nucleus_of(location)
        chain.append(
            {
                "link": location.link,
                "period": b.period,
                "re": b.re,
                "im": b.im,
                "size": b.size,
                "arg_degrees": math.degrees(b.arg),
            }
        )
        twin_width = location.w * current.size
        nxt, measured = twin_of(current, b, degree, branch)
        label = f"{label}·{index}"
        stages.append(
            {
                "name": f"twin {index}",
                "width": twin_width,
                "period": nxt.period,
                "centre_re": nxt.re,
                "centre_im": nxt.im,
                **measured,
            }
        )
        if not _fits(nxt.period):
            fallback = _native(
                "find",
                re=nxt.re,
                im=nxt.im,
                w=twin_width,
                deg=degree,
                res="1280x720",
                want=24,
                budget=48,
            )
            fitting = [n for n in fallback["nuclei"] if n["kind"] == "copy" and _fits(n["period"])]
            if fitting:
                pick = min(fitting, key=lambda n: n["period"])
                nxt = _solved(pick["re"], pick["im"], pick["period"], degree, pick["size_log2"])
                notes.append(
                    f"32 x {current.period * b.period} passes the ceiling: ended on the "
                    f"period-{nxt.period} copy Find minibrots offers in the twin frame"
                )
            else:
                periods = sorted({n["period"] for n in fallback["nuclei"]})
                notes.append(
                    f"32 x {nxt.period} = {32 * nxt.period} passes the ceiling of {CEILING}, and "
                    f"the twin frame offers no copy that fits (Find minibrots' periods there: "
                    f"{periods}); ended on the twin's own copy at the ceiling, "
                    f"{CEILING / nxt.period:.1f} periods"
                )
        size_n = framed(nxt, degree)
        stages.append(
            {
                "name": f"copy {label}",
                "width": size_n["width"],
                "period": nxt.period,
                "body_share": size_n["share"],
                "size": nxt.size,
                "arg_degrees": math.degrees(nxt.arg),
            }
        )
        current = nxt
        if notes and "ceiling" in notes[-1]:
            break
    return {
        "degree": degree,
        "family": first.family,
        "palette": first.palette,
        "branch": branch,
        "chain": chain,
        "final": {"period": current.period, "re": current.re, "im": current.im},
        "stages": stages,
        "notes": notes,
    }


# ------------------------------------------------------------------------------ the record


def _needed(degree: int, cx: float, cy: float, aspect: float) -> tuple[float, dict]:
    """The width that holds the family's home frame whole, centred where the descent is."""
    hx, hw = HOME[degree]
    hh = hw * aspect
    re = [hx - hw / 2, hx + hw / 2]
    im = [-hh / 2, hh / 2]
    need = max(2 * max(cx - re[0], re[1] - cx), 2 * max(cy - im[0], im[1] - cy) / aspect)
    return need, {"re": re, "im": im}


def _settle(re: str, im: str, width: float, degree: int) -> dict:
    return _native(
        "settle", re=re, im=im, w=f"{width:.17g}", deg=degree, res=f"{GRID[0]}x{GRID[1]}"
    )


def record(descent: dict, name: str, links: list[str], log=print) -> dict:
    """The keyframe record: a keyframe at every halving from the last copy's frame up to the
    first width that holds the home view, the stages named on their nearest keyframe."""
    degree = descent["degree"]
    centre = descent["final"]
    cx, cy = float(centre["re"]), float(centre["im"])
    aspect = GRID[1] / GRID[0]
    need, fit = _needed(degree, cx, cy, aspect)
    stages = [{"name": "home", "width": need}, *descent["stages"]]
    target = stages[-1]["width"]
    count = math.ceil(math.log2(need / target)) + 1
    for stage in stages:
        stage["k"] = min(count - 1, max(0, round(math.log2(stage["width"] / target))))
        period = stage.get("period")
        stage["cap_floor"] = min(OPEN_PERIODS * period, CEILING) if period else None
    frames = []
    for k in range(count):
        width = target * 2.0**k
        settled = _settle(centre["re"], centre["im"], width, degree)
        floor = max((s["cap_floor"] for s in stages if s["cap_floor"] and s["k"] >= k), default=0)
        frame = {
            "k": k,
            "width": width,
            "maxiter": max(settled["maxiter"], floor),
            "settled": settled["maxiter"],
            "probe_mean": round(settled["mean_iter"]),
            "escaped": settled["escaped"],
        }
        named = [s["name"] for s in stages if s["k"] == k]
        if named:
            frame["stage"] = ", ".join(named)
        frames.append(frame)
        log(
            f"k{k:02d} w={width:.4e} settled={settled['maxiter']} cap={frame['maxiter']} "
            f"mean={frame['probe_mean']} escaped={settled['escaped']:.3f} {frame.get('stage', '')}"
        )
    family = descent["family"]
    f = "" if family == "mandelbrot" else f"&f={family}"
    palette = descent["palette"] or "glowdon"
    link = (
        f"explorer/index.html?dv=3{f}&x={centre['re']}&y={centre['im']}&w={target:.6g}&p={palette}"
    )
    return {
        "schema": 1,
        "name": name,
        "note": "An automatic minibrot descent's recipe, written by `python -m builder "
        "descent`: the chain it was asked for, the stages it found, and a keyframe at every "
        "halving centred on the last copy. `zoom_fields.mjs --record` draws the fields and "
        "`zoom.py --record` colours and encodes them; `builder/README.md` has the commands.",
        "links": links,
        "link": link,
        "center_re": centre["re"],
        "center_im": centre["im"],
        "target_width": target,
        "degree": degree,
        "family": family,
        "mode": "smooth",
        "palette": palette,
        "branch": descent["branch"],
        "chain": descent["chain"],
        "stages": stages,
        "notes": descent["notes"],
        "fit": {"note": "The family's home view, from engine.wasm's plan.", **fit},
        "keyframes": {
            "rule": "w_k = target_width * 2^k, k = 0 up to the first width that holds the "
            "home view",
            "grid": list(GRID),
            "supersample": 1,
            "cap_rule": "the Deep tab's settle (deep-gallery-native settle, policy::settle), "
            "raised at every stage frame and each keyframe deeper to 32 periods of that "
            "stage's copy, under cap::CEILING",
            "frames": frames,
        },
        "video": VIDEO,
        "colour": {
            "interior": [0, 0, 0],
            "note": "index = frac(g(nu) / L + phase). The log mapping's L and phase are Hold "
            "look's, set by `python -m builder descent --colour`.",
            "mappings": {
                "linear": {"g": "nu", "L": 600, "phase": 0},
                "log": {"g": "ln nu", "L": 0.25, "phase": 0},
                "power": {"g": "nu^alpha", "alpha": 0.3, "L": 0.6, "phase": 0},
            },
        },
    }


def write(rec: dict) -> Path:
    """The record, one keyframe to a line, as `zoom_fields.mjs` writes its own."""
    text = json.dumps(rec, indent=2, ensure_ascii=False)
    lines = text.split("\n")
    out, i = [], 0
    while i < len(lines):
        line = lines[i]
        stripped = line.strip()
        # Collapse a keyframe object and a short numeric list onto one line.
        if stripped == "{" and i + 1 < len(lines) and lines[i + 1].strip().startswith('"k":'):
            j = i + 1
            body = []
            while not lines[j].strip().startswith("}"):
                body.append(lines[j].strip().rstrip(","))
                j += 1
            tail = lines[j].strip()
            out.append(line[: len(line) - len(stripped)] + "{ " + ", ".join(body) + " " + tail)
            i = j + 1
            continue
        if stripped.endswith("[") and i + 2 < len(lines):
            j = i + 1
            items = []
            while j < len(lines) and not lines[j].strip().startswith("]"):
                items.append(lines[j].strip().rstrip(","))
                j += 1
            if len(items) <= 3 and all(_numeric(item) for item in items):
                out.append(line + ", ".join(items) + lines[j].strip())
                i = j + 1
                continue
        out.append(line)
        i += 1
    path = DATA / f"{rec['name']}.keyframes.json"
    path.write_text("\n".join(out) + "\n", encoding="utf-8", newline="\n")
    return path


def _numeric(text: str) -> bool:
    try:
        float(text)
    except ValueError:
        return False
    return True


# ------------------------------------------------------------------------------ colour


def _median_nu(path: Path) -> float:
    nu = np.fromfile(path, dtype="<f8")
    nu = nu[np.isfinite(nu)]
    return float(np.median(np.maximum(nu, 2.0**-126)))


def colour(name: str) -> dict:
    """The log mapping's L and phase by Hold look, at the last twin frame.

    Hold look keeps the band density and the colour at one value of the field, the frame's
    median escaped `nu`. The look it holds is `deep-zoom-descent`'s log mapping at that
    video's own target frame: density `1/(nu·L)` and colour `frac(ln nu / L + phase)` at its
    median, carried to this movie's twin frame. So a band here is as wide, at the value the
    twin frame is mostly made of, as a band there was at the value its target was.
    """
    from . import zoom

    path = DATA / f"{name}.keyframes.json"
    rec = json.loads(path.read_text(encoding="utf-8"))
    twin = [s for s in rec["stages"] if s["name"].startswith("twin")][-1]
    here = zoom.zoom_dir(rec["name"]) / "fields" / f"k{twin['k']:02d}.f64"
    old = json.loads(zoom.RECORD.read_text(encoding="utf-8"))
    there = zoom.zoom_dir(old["name"]) / "fields" / "k00.f64"
    for needed in (here, there):
        if not needed.exists():
            raise DescentError(f"{needed} is not drawn yet")
    nu_here, nu_there = _median_nu(here), _median_nu(there)
    held = old["colour"]["mappings"]["log"]
    density = 1.0 / (nu_there * held["L"])
    shade = (math.log(nu_there) / held["L"] + held["phase"]) % 1.0
    period = float(f"{1.0 / (nu_here * density):.4g}")
    phase = round((shade - math.log(nu_here) / period) % 1.0, 4)
    rec["colour"]["mappings"]["log"] = {
        "g": "ln nu",
        "L": period,
        "phase": phase,
        "why": f"Hold look at the twin frame k{twin['k']:02d}, median nu {nu_here:.6g}, "
        f"holding deep-zoom-descent's log L={held['L']} phase={held['phase']} as it lands "
        f"at that video's target frame, median nu {nu_there:.6g}",
    }
    write(rec)
    return rec["colour"]["mappings"]["log"]


# ------------------------------------------------------------------------------ stills

STILL = (640, 360)


def _still_field(re: str, im: str, width: float, cap: int, degree: int, size, path: Path):
    if not path.exists():
        _native(
            "field",
            re=re,
            im=im,
            w=f"{width:.17g}",
            deg=degree,
            res=f"{size[0]}x{size[1]}",
            cap=cap,
            out=path,
        )
    return np.fromfile(path, dtype="<f8").reshape(size[1], size[0])


def stills(name: str) -> Path:
    """Every stage frame at its own exact width and centre, coloured as the movie is, and
    beside them the first location's frame with its twin turned back by `arg(s)` — the
    by-eye comparison, since nothing on the site rotates. One labelled sheet, lossless, in
    `artifacts/<name>/stills.png`."""
    from PIL import Image, ImageDraw, ImageFont

    from . import zoom

    rec = json.loads((DATA / f"{name}.keyframes.json").read_text(encoding="utf-8"))
    out_dir = zoom.zoom_dir(name) / "stills"
    out_dir.mkdir(parents=True, exist_ok=True)
    m = dict(rec["colour"]["mappings"]["log"], kind="log", palette=rec["palette"])
    m.update(record=name, mirror=False, reverse=False)
    table = zoom.palette_table(m)
    degree = rec["degree"]
    caps = {f["k"]: f["maxiter"] for f in rec["keyframes"]["frames"]}
    seat = parse(rec["links"][0])
    first = rec["chain"][0]
    hx, _ = HOME[degree]
    centres = {
        "home": (f"{hx}", "0"),
        "location 1": (seat.x, seat.y),
        "copy 1": (first["re"], first["im"]),
    }
    tiles = []
    for stage in rec["stages"]:
        re, im = centres.get(stage["name"], (rec["center_re"], rec["center_im"]))
        width = HOME[degree][1] if stage["name"] == "home" else stage["width"]
        cap = caps[stage["k"]]
        tag = stage["name"].replace(" ", "-").replace("·", "x")
        nu = _still_field(re, im, width, cap, degree, STILL, out_dir / f"{tag}.f64")
        period = f", period {stage['period']}" if stage.get("period") else ""
        words = f"{stage['name']}: width {width:.3g}{period}, cap {cap}"
        tiles.append((Image.fromarray(zoom.colour(nu, m, table, [0, 0, 0])), words))
    # The seat's twin, turned back: drawn twice as wide so that the turn leaves no corner empty.
    twin = next(s for s in rec["stages"] if s["name"].startswith("twin"))
    big = (STILL[0] * 2, STILL[1] * 2)
    nu = _still_field(
        rec["center_re"],
        rec["center_im"],
        twin["width"] * 2,
        caps[twin["k"]],
        degree,
        big,
        out_dir / "twin-wide.f64",
    )
    # Undoing arg(s) is PIL's turn by minus it: measured on the favicon seat, that turn puts
    # the twin's log-nu on the seat's at correlation 0.93, and the next best angle reads 0.79.
    # Its counts are about p times the seat's, so the log colouring is shifted by ln p; the
    # phase takes that back off, so that the two read in the same colours.
    outer = rec["chain"][0]["period"]
    same = dict(m, phase=(m["phase"] - math.log(outer) / m["L"]) % 1.0)
    turned = Image.fromarray(zoom.colour(nu, same, table, [0, 0, 0])).rotate(
        -twin["turned_degrees"], resample=Image.Resampling.BICUBIC
    )
    x0, y0 = (big[0] - STILL[0]) // 2, (big[1] - STILL[1]) // 2
    turned = turned.crop((x0, y0, x0 + STILL[0], y0 + STILL[1]))
    location = tiles[1]
    if len(tiles) % 2:  # the comparison pair shares a row
        tiles.append((Image.new("RGB", STILL), ""))
    tiles.append((location[0], "location 1, for comparison"))
    tiles.append(
        (
            turned,
            f"twin 2, turned back by arg(s) = {twin['turned_degrees']:.1f} degrees, recoloured",
        )
    )
    cols, pad, band = 2, 8, 26
    rows = math.ceil(len(tiles) / cols)
    sheet = Image.new(
        "RGB", (cols * STILL[0] + (cols + 1) * pad, rows * (STILL[1] + band) + (rows + 1) * pad)
    )
    draw = ImageDraw.Draw(sheet)
    try:
        font = ImageFont.truetype("arial.ttf", 16)
    except OSError:
        font = ImageFont.load_default()
    for i, (tile, words) in enumerate(tiles):
        x = pad + (i % cols) * (STILL[0] + pad)
        y = pad + (i // cols) * (STILL[1] + band + pad)
        sheet.paste(tile, (x, y))
        draw.text((x, y + STILL[1] + 4), words, fill=(230, 230, 230), font=font)
    path = zoom.zoom_dir(name) / "stills.png"
    sheet.save(path)
    return path


# ------------------------------------------------------------------------------ the command


def main(options: argparse.Namespace) -> list[str]:
    if options.colour:
        return [json.dumps(colour(options.colour))]
    if options.stills:
        return [f"wrote {stills(options.stills)}"]
    links = options.links
    if not links:
        raise DescentError("a descent needs at least one link")
    if len(links) == 1:
        links = [links[0], links[0]]
    descent = descend(links, options.branch)
    lines = [json.dumps(descent, indent=1)]
    if options.dry_run:
        return lines
    rec = record(descent, options.name, links, log=print)
    lines.append(f"wrote {write(rec)}")
    return lines
