"""The page of dives and their Julia sets: about 500 deep frames, picked by the location judge.

    python -m builder.julia_dives population  # both runs' landings, and the forced picks
    python -m builder.julia_dives verify      # this route against judge_deep_ckpt156's
    python -m builder.julia_dives score       # draw + neutral + location judge for the unscored
    python -m builder.julia_dives pick        # top N per degree, plus the forced picks
    python -m builder.julia_dives render      # every pick: field, Julia twin, both colourings
    python -m builder.julia_dives page        # deep-zoom/dives-and-julia-sets/index.html
    python -m builder.julia_dives all         # score, pick, render, page
    python -m builder.julia_dives twins       # re-frame the Julia twins, then page

Fields are the dive chain pilot's (`deep-gallery-native field`, 640x360 at 2x2, the frame's own
cap); the neutral picture and the judge are judge_deep_ckpt156's, so a score made here is made
the way `builder/data/deep-judges-scores.jsonl`'s were. Every working record is appended to a
JSONL under `WORK` and a key already there is never run again. Only the picks record and the
page's images are tracked, and `page` rebuilds the page from those two alone.
"""

from __future__ import annotations

import contextlib
import hashlib
import json
import random
import shutil
import subprocess
import sys
import threading
import time
from decimal import Decimal, localcontext
from pathlib import Path
from urllib.parse import parse_qsl

from . import deep_figures, heads, icons, renders
from .deep_gallery import _native
from .dive_candidates import below_normal, random_palettes
from .paths import SITE_ROOT

HERE = Path(__file__).resolve().parent
SITE = SITE_ROOT
#: The fields, neutral pictures, scores and every other working record stay out of the
#: repository; what the page is rebuilt from is the picks record and the images.
WORK = SITE / "scratch" / "carried_dives_work"

LF = "\n"
OUT = SITE / "deep-zoom" / "dives-and-julia-sets"
IMG = OUT / "img"
PICKS = HERE / "data" / "julia-dives-picks.jsonl"
FIELDS = WORK / "fields"
NEUTRAL = WORK / "neutral"
POPULATION = WORK / "population.jsonl"
FORCED = WORK / "forced.jsonl"
RENDERS = WORK / "renders.jsonl"
SCORES = WORK / "scores.jsonl"
SHADES = WORK / "shades.jsonl"
LOG = WORK / "run.log"
HEART = WORK / "heartbeat.log"
STUDY = SITE / "scratch" / "judge_deep_ckpt156"
RECORDED = SITE / "builder" / "data" / "deep-judges-scores.jsonl"
SETS = {
    "sheet": SITE / "artifacts" / "dive-reference" / "deep_minibrot_candidates",
    "random": SITE / "artifacts" / "random-dives",
}
PACK = SITE / "builder" / "data" / "deep-pack.jsonl"

RES = (640, 360)
SS = 2
#: What a page shows: the drawn 640x360 picture scaled to this, WebP at this quality.
SHOWN = (480, 270)
QUALITY = 80
TAKE = {2: 200, 3: 100, 4: 100, 5: 50, 6: 50}
DEGREES = [2, 3, 4, 5, 6]
OTHER = "other"
DEGREE = {"mandelbrot": 2, "multibrot3": 3, "multibrot4": 4, "multibrot5": 5, "multibrot6": 6}
FIXED_PALETTE = "glowdon"  # Scarlet Lantern, as the pilots drew it
FIXED_CYCLES = 2.5
#: The candidate sheet's rule for a new colouring's cycles (ckpt154, `deep_minibrot_candidates`).
CYCLES = (1.5, 6.0)
NATIVE_TIMEOUT = 1800
HEARTBEAT_S = 15 * 60
#: Two landings are one place when they sit on one plane, their centres closer than this share
#: of the smaller width, and their widths within this ratio.
NEAR_SHARE = 0.01
NEAR_RATIO = 2.0
#: Where the folder is assumed to sit on the site, and so how its links reach the explorer.
SITE_PLACE = "deep-zoom/dives-and-julia-sets/"
EXPLORER = "../../explorer/index.html?"
TITLE = "500 dives and their Julia sets"
#: The page has no prose to take a description from, so it carries this one in its head.
DESCRIPTION = (
    "About 500 deep frames from random dives, picked by the location judge, each with the "
    "Julia set at its center."
)
#: carried_dives_twins_ckpt160: a twin is zoomed out about its centre until the black disk round
#: z = c is at most this share of the frame's width; probes are drawn at this size, ss1.
TWIN_DISK = 0.05
PROBE = (384, 216)
PROBE_STEP = 4.0
TWINS = WORK / "twins.jsonl"
PROBE_FIELD = WORK / "probe.f64"


# --------------------------------------------------------------------------- plumbing


def log(*words):
    WORK.mkdir(parents=True, exist_ok=True)
    line = time.strftime("%H:%M:%S ") + " ".join(str(w) for w in words)
    print(line, flush=True)
    with LOG.open("a", encoding="utf-8", newline=LF) as f:
        f.write(line + LF)


def read(path: Path) -> list[dict]:
    if not path.exists():
        return []
    out = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if line.strip():
            with contextlib.suppress(json.JSONDecodeError):
                out.append(json.loads(line))
    return out


def append(path: Path, row: dict):
    with path.open("a", encoding="utf-8", newline=LF) as f:
        f.write(json.dumps(row) + LF)


def write(path: Path, rows: list[dict]):
    path.write_text("".join(json.dumps(r) + LF for r in rows), encoding="utf-8", newline=LF)


def spelled(text: str) -> str:
    if "." in text:
        text = text.rstrip("0").rstrip(".")
    return text


def keys(link: str) -> dict:
    return dict(parse_qsl(link, keep_blank_values=True))


# ---------------------------------------------------------------------------- population


def frame_of_link(link: str) -> dict:
    """A deep link's frame: plane, centre, width, cap, and c for a Julia view."""
    q = keys(link)
    f = q.get("f", "mandelbrot")
    julia = None
    if "cx" in q:
        julia = {"re": q["cx"], "im": q["cy"]}
        deg = 2 if f in ("julia", "mandelbrot") else int(f.removeprefix("julia"))
    else:
        deg = DEGREE[f]
    return {
        "deg": deg,
        "julia": julia,
        "re": q["x"],
        "im": q["y"],
        "w": float(q["w"]),
        "cap": int(q["n"]),
    }


def section_of(frame: dict):
    return OTHER if frame["julia"] is not None else frame["deg"]


def same_place(a: dict, b: dict) -> bool:
    if a["deg"] != b["deg"] or (a["julia"] is None) != (b["julia"] is None):
        return False
    if a["julia"] is not None and (a["julia"]["re"], a["julia"]["im"]) != (
        b["julia"]["re"],
        b["julia"]["im"],
    ):
        return False
    lo, hi = sorted((a["w"], b["w"]))
    if hi / lo > NEAR_RATIO:
        return False
    if (spelled(a["re"]), spelled(a["im"])) == (spelled(b["re"]), spelled(b["im"])):
        return True
    with localcontext(prec=120):
        d = max(abs(Decimal(a["re"]) - Decimal(b["re"])), abs(Decimal(a["im"]) - Decimal(b["im"])))
    return float(d) < NEAR_SHARE * lo


def population(_args=None):
    rows, repeats = [], []
    for name, folder in SETS.items():
        for u in read(folder / "units.jsonl"):
            if not u.get("tile") or u["to"] not in ("seat", "view"):
                continue
            fr = u["frame"]
            frame = {
                "deg": DEGREE[u["plane"]],
                "julia": None,
                "re": fr["re"],
                "im": fr["im"],
                "w": float(fr["width"]),
                "cap": int(fr["cap"]),
            }
            row = {
                "id": f"{name}:{u['id']}",
                "set": name,
                "unit": u["id"],
                "tile": u["tile"],
                "to": u["to"],
                "link": u["link"],
                "frame": frame,
            }
            first = next((r for r in rows if same_place(r["frame"], frame)), None)
            if first is not None:
                exact = (spelled(first["frame"]["re"]), spelled(first["frame"]["im"])) == (
                    spelled(frame["re"]),
                    spelled(frame["im"]),
                )
                repeats.append({"id": row["id"], "same_as": first["id"], "exact": exact})
                first.setdefault("repeats", []).append(row["id"])
                continue
            rows.append(row)
    # The forced picks: the figure's 15 panels, then every member of the deep gallery.
    forced = []
    for n, (link, _alt) in enumerate(deep_figures.RANDOM_DIVES, 1):
        forced.append({"from": f"deep-random-dives#{n}", "link": link})
    for m in read(PACK):
        if m.get("kind") == "member":
            forced.append({"from": f"deep-gallery#{m['rank']} ({m['from']})", "link": m["link"]})
    entries = []
    for f in forced:
        frame = frame_of_link(f["link"])
        hit = next((r for r in rows if same_place(r["frame"], frame)), None)
        if hit is not None:
            if hit.get("forced"):
                hit["forced_also"] = hit.get("forced_also", []) + [f["from"]]
                continue
            hit["forced"] = f["from"]
            hit["own"] = f["link"]
            continue
        prior = next((e for e in entries if same_place(e["frame"], frame)), None)
        if prior is not None:
            prior["forced_also"] = prior.get("forced_also", []) + [f["from"]]
            continue
        entries.append(
            {
                "id": f"forced:{len(entries) + 1:02d}",
                "set": "forced",
                "unit": None,
                "tile": None,
                "to": None,
                "link": f["link"],
                "frame": frame,
                "forced": f["from"],
                "own": f["link"],
            }
        )
    write(POPULATION, rows)
    write(FORCED, entries)
    write(WORK / "repeats.jsonl", repeats)
    by = {d: sum(1 for r in rows if r["frame"]["deg"] == d) for d in DEGREES}
    log(
        f"population: {len(rows)} places after {len(repeats)} repeats "
        f"({sum(r['exact'] for r in repeats)} exact); by degree {by}; "
        f"forced: {sum(1 for r in rows if r.get('forced'))} in the population, "
        f"{len(entries)} outside it"
    )


def everyone() -> list[dict]:
    return read(POPULATION) + read(FORCED)


# ----------------------------------------------------------------------------- rendering


def field_key(frame: dict) -> str:
    j = frame["julia"]
    text = (
        f"{frame['deg']}|{j['re'] + ',' + j['im'] if j else '-'}|{frame['re']}|{frame['im']}|"
        f"{float(frame['w']):.17g}|{frame['cap']}"
    )
    return hashlib.sha1(text.encode()).hexdigest()[:16]


def twin_of(frame: dict) -> dict:
    """The Julia twin: the Deep tab's `j` — same centre, width and cap, c = the centre. A Julia
    view's twin goes the other way, to the parameter plane at its c."""
    if frame["julia"] is not None:
        return {**frame, "julia": None, "re": frame["julia"]["re"], "im": frame["julia"]["im"]}
    return {**frame, "julia": {"re": frame["re"], "im": frame["im"]}}


def anchor_of(frame: dict) -> str:
    """`deep-render.js`'s `anchorOf`: the nearer of z = c and z = 0."""
    with localcontext(prec=120):
        to_c = max(
            abs(Decimal(frame["re"]) - Decimal(frame["julia"]["re"])),
            abs(Decimal(frame["im"]) - Decimal(frame["julia"]["im"])),
        )
        to_0 = max(abs(Decimal(frame["re"])), abs(Decimal(frame["im"])))
    return "origin" if to_0 < to_c else "parameter"


_renders: dict[str, dict] = {}


def render(frame: dict) -> dict:
    if not _renders:
        _renders.update({r["key"]: r for r in read(RENDERS)})
    key = field_key(frame)
    if key in _renders:
        return _renders[key]
    FIELDS.mkdir(exist_ok=True)
    path = FIELDS / f"{key}.f64"
    args = dict(
        re=frame["re"],
        im=frame["im"],
        w=f"{float(frame['w']):.17g}",
        res=f"{RES[0]}x{RES[1]}",
        ss=SS,
        cap=frame["cap"],
        out=path,
        deg=frame["deg"] if frame["deg"] != 2 else None,
    )
    if frame["julia"] is not None:
        args.update(jre=frame["julia"]["re"], jim=frame["julia"]["im"])
        if anchor_of(frame) == "origin":
            args["anchor"] = "origin"
    t = time.monotonic()
    try:
        drawn = _native("field", timeout=NATIVE_TIMEOUT, **args)
        rec = {
            "key": key,
            "frame": frame,
            "seconds": round(time.monotonic() - t, 2),
            "interior": drawn["interior"],
            "bytes": path.stat().st_size,
        }
    except subprocess.TimeoutExpired:
        rec = {"key": key, "frame": frame, "why": "render timeout"}
    except Exception as error:  # noqa: BLE001 — recorded, not the run's end
        rec = {"key": key, "frame": frame, "why": repr(error)[-400:]}
    append(RENDERS, rec)
    _renders[key] = rec
    return rec


def job_of(frame: dict, key: str, colourings: list[dict]) -> dict:
    return {
        "id": key,
        "deg": frame["deg"],
        "re": frame["re"],
        "im": frame["im"],
        "w": repr(float(frame["w"])),
        "n": frame["cap"],
        "julia": frame["julia"],
        "field": str(FIELDS / f"{key}.f64"),
        "width": RES[0],
        "height": RES[1],
        "ss": SS,
        "colourings": colourings,
    }


def shade(jobs: list[dict]) -> list[dict]:
    path = WORK / "work-jobs.json"
    path.write_text(json.dumps(jobs), encoding="utf-8", newline=LF)
    done = subprocess.run(
        ["node", str(HERE / "julia_dives_shade.mjs"), str(path)],
        capture_output=True,
        text=True,
        cwd=SITE,
    )
    if done.returncode != 0:
        raise RuntimeError(done.stderr[-2000:])
    return json.loads(done.stdout)


def image_of(rgba: Path):
    from PIL import Image

    img = Image.frombytes("RGBA", RES, rgba.read_bytes()).convert("RGB")
    rgba.unlink()
    return img


# -------------------------------------------------------------------------------- scoring


def recorded() -> dict[str, dict]:
    return {r["id"]: r for r in read(RECORDED)}


def neutral_jpg(frame: dict, key: str) -> Path:
    NEUTRAL.mkdir(exist_ok=True)
    jpg = NEUTRAL / f"{key}.jpg"
    if not jpg.exists():
        rgba = NEUTRAL / f"{key}.rgba"
        said = shade([job_of(frame, key, [{"tag": "neutral", "out": str(rgba), "neutral": True}])])
        if not said[0].get("link"):
            raise RuntimeError("neutral: nothing drawn")
        image_of(rgba).save(jpg, quality=90)
    return jpg


def judge(jobs: list[dict]):
    if not jobs:
        return
    path = WORK / "score-jobs.json"
    path.write_text(json.dumps(jobs), encoding="utf-8", newline=LF)
    done = subprocess.run(
        [str(renders.venv_python()), str(HERE / "julia_dives_score.py"), str(path), str(SCORES)],
        capture_output=True,
        text=True,
        cwd=SITE,
    )
    if done.returncode != 0:
        raise RuntimeError(done.stderr[-2000:])
    log("judge:", done.stdout.strip())


def verify(_args=None):
    """Draw a few of the sheet's carried frames by this route: the neutral picture should be the
    study's, and the judge's reading of it the recorded one."""
    import numpy as np
    from PIL import Image

    rec = recorded()
    rows = [r for r in read(POPULATION) if r["set"] == "sheet"][:6]
    jobs = []
    for r in rows:
        got = render(r["frame"])
        key = got["key"]
        jpg = neutral_jpg(r["frame"], key)
        mine = np.asarray(Image.open(jpg), dtype=np.int16)
        theirs = np.asarray(Image.open(STUDY / "neutral" / f"{r['unit']}.jpg"), dtype=np.int16)
        log(
            f"verify {r['id']}: field {got.get('seconds')} s, neutral vs study max "
            f"{int(np.abs(mine - theirs).max())}, identical bytes "
            f"{jpg.read_bytes() == (STUDY / 'neutral' / (r['unit'] + '.jpg')).read_bytes()}"
        )
        jobs.append({"id": f"verify:{r['id']}", "jpg": str(jpg)})
    judge(jobs)
    got = {s["id"]: s["location"] for s in read(SCORES)}
    for r in rows:
        mine = got["verify:" + r["id"]]
        log(f"verify {r['id']}: score {mine:.6f} recorded {rec[r['unit']]['location']:.6f}")


def scores() -> dict[str, float]:
    """Every scored dive: the recorded reading for a sheet frame, this route's for the rest."""
    rec = recorded()
    out = {}
    for r in everyone():
        if r["set"] == "sheet" and r["unit"] in rec and rec[r["unit"]]["link"] == r["link"]:
            out[r["id"]] = rec[r["unit"]]["location"]
    out.update({s["id"]: s["location"] for s in read(SCORES) if not s["id"].startswith("verify:")})
    return out


def score(_args=None):
    have = scores()
    todo = [r for r in everyone() if r["id"] not in have]
    log(f"score: {len(have)} scored, {len(todo)} to draw and score")
    beat = Heart(len(todo), "score")
    batch = []
    for r in todo:
        got = render(r["frame"])
        if "why" in got:
            log(f"{r['id']}: no field ({got['why']})")
        else:
            try:
                batch.append({"id": r["id"], "jpg": str(neutral_jpg(r["frame"], got["key"]))})
            except Exception as error:  # noqa: BLE001
                log(f"{r['id']}: no neutral picture ({error!r})"[:400])
        beat.tick()
        if len(batch) >= 50:
            judge(batch)
            batch = []
    judge(batch)
    beat.stop()


# ---------------------------------------------------------------------------------- picks


def pick(_args=None):
    have = scores()
    rows = read(POPULATION)
    picks = []
    for d in DEGREES:
        ranked = sorted(
            (r for r in rows if r["frame"]["deg"] == d and r["id"] in have),
            key=lambda r: (-have[r["id"]], r["id"]),
        )
        unscored = sum(1 for r in rows if r["frame"]["deg"] == d and r["id"] not in have)
        top = ranked[: TAKE[d]]
        cut = have[top[-1]["id"]] if top else None
        log(
            f"degree {d}: {len(ranked)} scored ({unscored} without a score), take {len(top)} of "
            f"{TAKE[d]}, cut {cut}"
        )
        for n, r in enumerate(ranked, 1):
            if n <= TAKE[d] or r.get("forced"):
                picks.append(entry(r, d, have, n, n <= TAKE[d]))
    for r in read(FORCED):
        # The three Julia-view gallery members were dropped from the set (Matt, 2026-10-04).
        if section_of(r["frame"]) != OTHER:
            picks.append(entry(r, section_of(r["frame"]), have, None, False))
    write(PICKS, picks)
    log(
        f"picks: {len(picks)}, forced {sum(p['forced'] for p in picks)}, of which "
        f"{sum(p['forced'] and not p['in_top'] for p in picks)} added on top"
    )


def entry(r: dict, section, have: dict, rank, in_top: bool) -> dict:
    return {
        "id": r["id"],
        "source": r["set"],
        "unit": r["unit"],
        "tile": r["tile"],
        "section": section,
        "degree": r["frame"]["deg"],
        "score": have.get(r["id"]),
        "rank": rank,
        "in_top": in_top,
        "forced": bool(r.get("forced")),
        "forced_from": [r["forced"], *r.get("forced_also", [])] if r.get("forced") else [],
        "own": r.get("own"),
        "frame": r["frame"],
        "key": field_key(r["frame"]),
        "repeats": r.get("repeats", []),
    }


def queue(picks: list[dict]) -> list[dict]:
    """Rank order, round-robin over the sections: the forced picks first in each."""
    lanes = []
    for s in [*DEGREES, OTHER]:
        mine = [p for p in picks if p["section"] == s]
        mine.sort(key=lambda p: (not p["forced"], -(p["score"] or -1), p["id"]))
        lanes.append(mine)
    out = []
    while any(lanes):
        for lane in lanes:
            if lane:
                out.append(lane.pop(0))
    return out


# --------------------------------------------------------------------------------- render


def colour_seed(pid: str) -> int:
    return int(hashlib.sha1(f"carried-dives|{pid}".encode()).hexdigest()[:12], 16)


def picture(p: dict) -> dict:
    """One pick's four pictures: its frame and its Julia twin, each fixed and random."""
    done = {(s["id"], s["view"]): s for s in read(SHADES)}
    out = {}
    for view, frame in (("frame", p["frame"]), ("twin", twin_of(p["frame"]))):
        if (p["id"], view) in done:
            out[view] = done[(p["id"], view)]
            continue
        t0 = time.monotonic()
        got = render(frame)
        rec = {"id": p["id"], "view": view, "key": got["key"]}
        if "why" in got:
            rec["why"] = got["why"]
            append(SHADES, rec)
            out[view] = rec
            continue
        stem = f"d{p['degree']}-{p['key']}" + ("-twin" if view == "twin" else "")
        cols = []
        if view == "frame":
            rng = random.Random(colour_seed(p["id"]))
            palette = rng.choice(random_palettes())
            cycles = rng.uniform(*CYCLES)
            phase = round(rng.random(), 3)
            cols.append(
                {"tag": "fixed", "palette": FIXED_PALETTE, "cycles": FIXED_CYCLES, "phase": 0}
            )
            if p["own"]:
                cols.append({"tag": "random", "own": p["own"]})
            else:
                cols.append({"tag": "random", "palette": palette, "cycles": cycles, "phase": phase})
                rec["cycles"] = round(cycles, 3)
        else:
            parent = out.get("frame", {})
            for tag in ("fixed", "random"):
                said = parent.get(tag)
                if not said:
                    continue
                if tag == "random" and p["own"]:
                    cols.append({"tag": tag, "own": p["own"]})
                else:
                    cols.append({"tag": tag, "palette": said["palette"], "recipe": said["recipe"]})
        for c in cols:
            c["out"] = str(IMG / f"{stem}-{c['tag']}.rgba")
        IMG.mkdir(parents=True, exist_ok=True)
        for s in shade([job_of(frame, got["key"], cols)]) if cols else []:
            if not s.get("link"):
                rec[s["tag"]] = None
                rec[f"{s['tag']}_why"] = s.get("why")
                continue
            rgba = Path(next(c["out"] for c in cols if c["tag"] == s["tag"]))
            name = rgba.with_suffix(".webp").name
            from PIL import Image

            image_of(rgba).resize(SHOWN, Image.LANCZOS).save(IMG / name, quality=QUALITY, method=6)
            rec[s["tag"]] = {
                "link": s["link"],
                "palette": s["palette"],
                "recipe": s["recipe"],
                "img": f"img/{name}",
                **({"guard": s["guard"]} if "guard" in s else {}),
            }
        rec["render_s"] = got.get("seconds")
        rec["unit_s"] = round(time.monotonic() - t0, 2)
        append(SHADES, rec)
        out[view] = rec
    return out


def render_all(_args=None):
    picks = read(PICKS)
    order = queue(picks)
    done = {(s["id"], s["view"]) for s in read(SHADES)}
    todo = [p for p in order if not {(p["id"], "frame"), (p["id"], "twin")} <= done]
    log(
        f"render: {len(picks)} picks, {len(todo)} to draw; free disk "
        f"{shutil.disk_usage(WORK).free / 1e9:.0f} GB"
    )
    beat = Heart(len(todo), "render")
    for p in todo:
        if shutil.disk_usage(WORK).free < 20e9:
            log("stop: under 20 GB free")
            break
        try:
            picture(p)
        except Exception as error:  # noqa: BLE001 — a pick's failure is recorded, not the run's end
            log(f"{p['id']}: {error!r}"[:600])
        beat.tick()
    beat.stop()


# ---------------------------------------------------------------------------------- twins


def interior_mask(path: Path, width: int, height: int):
    import numpy as np

    return np.isnan(np.fromfile(path, dtype="<f8").reshape(height, width))


def disk(mask) -> dict | None:
    """The black disk round z = c, as a share of the frame's width.

    The rule: the 4-connected interior component under the frame's centre, found after one
    4-neighbour erosion so that a pinch point cannot join it to the next component, and measured
    as its horizontal extent plus the eroded sample on each side. None when the centre is not
    interior; `touches` when the component reaches the frame's edge, so its width is unknown.
    """
    import numpy as np
    from scipy import ndimage

    h, w = mask.shape
    r = max(1, w // 320)
    for m in (ndimage.binary_erosion(mask), mask):
        lab, _ = ndimage.label(m)
        win = lab[h // 2 - r : h // 2 + r, w // 2 - r : w // 2 + r]
        ids = win[win > 0]
        if ids.size:
            break
    else:
        return None
    pad = 2 if m is not mask else 0
    ys, xs = np.nonzero(lab == np.bincount(ids).argmax())
    touches = xs.min() <= 1 or ys.min() <= 1 or xs.max() >= w - 2 or ys.max() >= h - 2
    return {"share": round(float((xs.max() - xs.min() + 1 + pad) / w), 4), "touches": bool(touches)}


def probe(frame: dict) -> dict | None:
    args = dict(
        re=frame["re"],
        im=frame["im"],
        w=f"{float(frame['w']):.17g}",
        res=f"{PROBE[0]}x{PROBE[1]}",
        ss=1,
        cap=frame["cap"],
        out=PROBE_FIELD,
        deg=frame["deg"] if frame["deg"] != 2 else None,
        jre=frame["julia"]["re"],
        jim=frame["julia"]["im"],
    )
    _native("field", timeout=NATIVE_TIMEOUT, **args)
    return disk(interior_mask(PROBE_FIELD, *PROBE))


def up(x: float) -> float:
    """Round a zoom-out factor up to three significant figures."""
    from math import ceil, floor, log10

    step = 10 ** (floor(log10(x)) - 2)
    return ceil(x / step - 1e-9) * step


def zoom_out(tf: dict, first: dict) -> tuple[float, list, str | None]:
    """The smallest factor that brings the disk to TWIN_DISK of the frame, by probes."""
    factor, got, probes = 1.0, first, []
    while got is not None and got["touches"]:
        factor *= PROBE_STEP
        if tf["w"] * factor > 4.0:
            return factor / PROBE_STEP, probes, "disk fills the frame out to the whole set"
        got = probe({**tf, "w": tf["w"] * factor})
        probes.append({"factor": factor, **(got or {"share": None})})
    if got is None:
        return factor, probes, "centre stopped being interior"
    for _ in range(4):
        factor = max(1.0, up(factor * got["share"] / TWIN_DISK))
        got = probe({**tf, "w": tf["w"] * factor})
        probes.append({"factor": factor, **(got or {"share": None})})
        if got is None:
            return factor, probes, "centre stopped being interior"
        if not got["touches"] and got["share"] <= TWIN_DISK * 1.05:
            return factor, probes, None
    return factor, probes, f"probe still at {got['share']} after four corrections"


def twin_colourings(p: dict, parent: dict) -> list[dict]:
    cols = []
    for tag in ("fixed", "random"):
        said = parent.get(tag)
        if not said:
            continue
        if tag == "random" and p["own"]:
            cols.append({"tag": tag, "own": p["own"]})
        else:
            cols.append({"tag": tag, "palette": said["palette"], "recipe": said["recipe"]})
    return cols


def reframe(p: dict, shades: dict) -> dict:
    t0 = time.monotonic()
    tf = twin_of(p["frame"])
    old = render(tf)
    first = disk(interior_mask(FIELDS / f"{old['key']}.f64", RES[0] * SS, RES[1] * SS))
    row = {"id": p["id"], "old_key": old["key"], "w0": tf["w"], "disk_before": first}
    if first is None or (not first["touches"] and first["share"] <= TWIN_DISK):
        row.update(
            factor=1.0,
            w=tf["w"],
            disk_after=first,
            kept="no central black region" if first is None else "already at or under the target",
        )
        row["unit_s"] = round(time.monotonic() - t0, 2)
        return row
    factor, probes, short = zoom_out(tf, first)
    tw = {**tf, "w": tf["w"] * factor}
    got = render(tw)
    row.update(factor=factor, w=tw["w"], key=got["key"], probes=probes, render_s=got.get("seconds"))
    if short:
        row["short"] = short
    if "why" in got:
        row["why"] = got["why"]
        return row
    row["disk_after"] = disk(interior_mask(FIELDS / f"{got['key']}.f64", RES[0] * SS, RES[1] * SS))
    settle = _native(
        "settle",
        timeout=NATIVE_TIMEOUT,
        re=tw["re"],
        im=tw["im"],
        w=f"{tw['w']:.17g}",
        cap=tw["cap"],
        deg=tw["deg"] if tw["deg"] != 2 else None,
        jre=tw["julia"]["re"],
        jim=tw["julia"]["im"],
    )
    row["settle"] = {k: settle[k] for k in ("maxiter", "steps", "proven", "starved", "fault")}
    # Shade it as the old twin was shaded, into the old twin's image names.
    cols = twin_colourings(p, shades[(p["id"], "frame")])
    stem = f"d{p['degree']}-{p['key']}-twin"
    for c in cols:
        c["out"] = str(IMG / f"{stem}-{c['tag']}.rgba")
    rec = {"id": p["id"], "view": "twin", "key": got["key"], "reframed": factor}
    from PIL import Image

    for s in shade([job_of(tw, got["key"], cols)]):
        if not s.get("link"):
            rec[s["tag"]] = None
            rec[f"{s['tag']}_why"] = s.get("why")
            continue
        rgba = IMG / f"{stem}-{s['tag']}.rgba"
        name = rgba.with_suffix(".webp").name
        image_of(rgba).resize(SHOWN, Image.LANCZOS).save(IMG / name, quality=QUALITY, method=6)
        rec[s["tag"]] = {
            "link": s["link"],
            "palette": s["palette"],
            "recipe": s["recipe"],
            "img": f"img/{name}",
        }
    rec["render_s"] = got.get("seconds")
    rec["unit_s"] = round(time.monotonic() - t0, 2)
    append(SHADES, rec)
    if got["key"] != old["key"]:
        (FIELDS / f"{old['key']}.f64").unlink(missing_ok=True)
    row["unit_s"] = rec["unit_s"]
    return row


def twins(_args=None):
    picks = read(PICKS)
    shades = {(s["id"], s["view"]): s for s in read(SHADES)}
    done = {r["id"] for r in read(TWINS)}
    todo = [p for p in queue(picks) if p["frame"]["julia"] is None and p["id"] not in done]
    log(f"twins: {len(todo)} to measure ({len(done)} done)")
    beat = Heart(len(todo), "twins")
    for p in todo:
        try:
            row = reframe(p, shades)
        except Exception as error:  # noqa: BLE001 — recorded, not the run's end
            row = {"id": p["id"], "error": repr(error)[-600:]}
        append(TWINS, row)
        log(
            f"{p['id']}: factor {row.get('factor')} disk {row.get('disk_before')} -> "
            f"{row.get('disk_after')} {row.get('short') or row.get('error') or ''}"[:400]
        )
        beat.tick()
    beat.stop()
    PROBE_FIELD.unlink(missing_ok=True)
    rows = {r["id"]: r for r in read(TWINS)}
    for p in picks:
        r = rows.get(p["id"])
        if r and "factor" in r:
            p["twin_zoom"] = {
                k: r.get(k)
                for k in ("factor", "w", "disk_before", "disk_after", "kept", "short", "settle")
                if r.get(k) is not None
            }
    write(PICKS, picks)
    page()


# ---------------------------------------------------------------------------------- refit
#
# carried_dives_twin_fit_ckpt160: a twin's colouring numbers were its primary's, fitted to the
# primary's field. Each twin is recoloured as the Deep tab's Fit would colour it, off its own
# field: the palette kept, absolute with Straighten iter on (`shade.mjs`'s `refit`).

REFITS = WORK / "refits.jsonl"
BEFORE = WORK / "twin-before"


def refit(_args=None):
    from PIL import Image

    picks = read(PICKS)
    shades = {(s["id"], s["view"]): s for s in read(SHADES)}
    done = {r["id"] for r in read(REFITS)}
    BEFORE.mkdir(exist_ok=True)
    todo = [p for p in queue(picks) if p["id"] not in done]
    log(f"refit: {len(todo)} twins to recolour ({len(done)} done)")
    beat = Heart(len(todo), "refit")
    for p in todo:
        t0 = time.monotonic()
        old = shades[(p["id"], "twin")]
        if not _renders:
            _renders.update({r["key"]: r for r in read(RENDERS)})
        key = old["key"]
        tf = _renders[key]["frame"]
        if not (FIELDS / f"{key}.f64").exists():
            _renders.pop(key, None)
            got = render(tf)
            if "why" in got:
                append(REFITS, {"id": p["id"], "why": got["why"]})
                continue
        cols = []
        for tag in ("fixed", "random"):
            one = old.get(tag)
            if not one:
                continue
            src = IMG / Path(one["img"]).name
            keep = BEFORE / src.name
            if not keep.exists():
                shutil.copyfile(src, keep)
            cols.append({"tag": tag, "refit": one["link"], "out": str(src.with_suffix(".rgba"))})
        rec = {**old, "refit": True}
        row = {"id": p["id"], "key": key}
        for s in shade([job_of(tf, key, cols)]) if cols else []:
            if not s.get("link"):
                row[f"{s['tag']}_why"] = s.get("why")
                Path(next(c["out"] for c in cols if c["tag"] == s["tag"])).unlink(missing_ok=True)
                continue
            rgba = Path(next(c["out"] for c in cols if c["tag"] == s["tag"]))
            name = rgba.with_suffix(".webp").name
            image_of(rgba).resize(SHOWN, Image.LANCZOS).save(IMG / name, quality=QUALITY, method=6)
            before = old[s["tag"]]["recipe"]
            rec[s["tag"]] = {
                "link": s["link"],
                "palette": s["palette"],
                "recipe": s["recipe"],
                "img": f"img/{name}",
            }
            row[s["tag"]] = {"before": before, "after": s["recipe"], "miss": s["fit"]["miss"]}
        rec["unit_s"] = round(time.monotonic() - t0, 2)
        append(SHADES, rec)
        append(REFITS, row)
        beat.tick()
    beat.stop()
    page()


# ----------------------------------------------------------------------------- heartbeat


class Heart:
    def __init__(self, total: int, what: str):
        self.total, self.what, self.done = total, what, 0
        self.t0 = time.monotonic()
        self.halt = threading.Event()
        threading.Thread(target=self.run, daemon=True).start()
        self.beat("start")

    def tick(self):
        self.done += 1

    def beat(self, note):
        el = time.monotonic() - self.t0
        left = (self.total - self.done) * el / self.done / 60 if self.done else None
        line = {
            "at": time.strftime("%H:%M:%S"),
            "phase": self.what,
            "done": self.done,
            "total": self.total,
            "elapsed_min": round(el / 60, 1),
            "eta_min": round(left, 1) if left is not None else None,
            "free_gb": round(shutil.disk_usage(WORK).free / 1e9),
            "note": note,
        }
        with HEART.open("a", encoding="utf-8", newline=LF) as f:
            f.write(json.dumps(line) + LF)
        print(json.dumps(line), flush=True)

    def run(self):
        while not self.halt.wait(HEARTBEAT_S):
            self.beat("heartbeat")

    def stop(self):
        self.halt.set()
        self.beat("done")


# ----------------------------------------------------------------------------------- page

#: What a section's twins are, for its heading while they are shown: a Julia view's twin is the
#: parameter plane at its c.
TWIN_HEADINGS = {OTHER: "parameter-plane twin"}
HEADINGS = {
    2: "Mandelbrot set",
    3: "Multibrot 3",
    4: "Multibrot 4",
    5: "Multibrot 5",
    6: "Multibrot 6",
    OTHER: "Julia sets",
}

STYLE = """
:root { --bg: #111214; --fg: #e8e6e3; --control: #2a2c30; --edge: #3a3d42; }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--fg);
  font: 15px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif; }
.bar { position: sticky; top: 0; z-index: 1; display: flex; gap: 12px; flex-wrap: wrap;
  padding: 10px 16px; background: rgba(17, 18, 20, .94); border-bottom: 1px solid var(--edge); }
.bar button, .bar label { background: var(--control); color: var(--fg); border: 1px solid var(--edge);
  border-radius: 6px; padding: 6px 12px; font: inherit; cursor: pointer; }
.bar label { display: inline-flex; gap: 8px; align-items: center; }
.jump { display: flex; gap: 6px; flex-wrap: wrap; }
.jump a { color: var(--fg); text-decoration: none; border: 1px solid var(--edge); border-radius: 6px;
  padding: 6px 10px; background: var(--control); opacity: .7; }
.jump a:hover { opacity: 1; }
.jump a.on { opacity: 1; background: #e8e6e3; color: #111214; font-weight: 600; }
section { scroll-margin-top: var(--bar, 60px); }
h2 { font-weight: 600; font-size: 20px; margin: 28px 16px 12px; }
.grid { display: grid; gap: 6px; padding: 0 16px; grid-template-columns: repeat(auto-fill, minmax(min(100%, 300px), 1fr)); }
.grid a { display: block; aspect-ratio: 16 / 9; background: #000; }
.grid img { display: block; width: 100%; height: 100%; object-fit: cover; }
.grid a.none { pointer-events: none; }
.grid a.t { display: none; }
.julia .grid a.t { display: block; }
.grid .gap { grid-column: 1 / -1; height: 14px; }
.bar button span { opacity: .55; }
.bar button span.on { opacity: 1; font-weight: 600; }
footer { height: 32px; }
"""  # noqa: E501

SCRIPT = """
(() => {
  const state = { random: true, julia: true };
  const colour = document.getElementById("colour");
  const julia = document.getElementById("julia");
  const grids = [...document.querySelectorAll(".grid")];
  const cells = [...document.querySelectorAll(".grid a")];
  // With twins shown, each row of primaries is followed by the row of their twins, then a gap.
  function arrange() {
    for (const grid of grids) {
      for (const g of grid.querySelectorAll(".gap")) g.remove();
      const ps = [...grid.querySelectorAll("a.p")], ts = [...grid.querySelectorAll("a.t")];
      if (!state.julia) { for (const a of [...ps, ...ts]) a.style.order = ""; continue; }
      const n = Math.max(1, getComputedStyle(grid).gridTemplateColumns.split(" ").length);
      ps.forEach((a, i) => {
        const row = Math.floor(i / n), at = row * (2 * n + 1);
        a.style.order = String(at + (i % n));
        ts[i].style.order = String(at + n + (i % n));
        if (i % n === n - 1 || i === ps.length - 1) {
          const gap = document.createElement("div");
          gap.className = "gap";
          gap.style.order = String(at + 2 * n);
          grid.append(gap);
        }
      });
    }
  }
  function show() {
    const tag = state.random ? "r" : "f";
    colour.querySelector(".f").classList.toggle("on", !state.random);
    colour.querySelector(".r").classList.toggle("on", state.random);
    colour.setAttribute("aria-pressed", String(state.random));
    document.body.classList.toggle("julia", state.julia);
    for (const h of document.querySelectorAll("h2[data-twin]")) {
      h.textContent = state.julia ? h.dataset.twin : h.dataset.plain;
    }
    for (const a of cells) {
      const src = a.dataset[tag + "i"], href = a.dataset[tag + "h"];
      const img = a.firstElementChild;
      if (src) { img.src = src; a.href = href; a.classList.remove("none"); }
      else { img.removeAttribute("src"); a.removeAttribute("href"); a.classList.add("none"); }
    }
    arrange();
    current();
  }
  let columns = "";
  addEventListener("resize", () => {
    const now = grids.length ? getComputedStyle(grids[0]).gridTemplateColumns.split(" ").length : 0;
    if (state.julia && String(now) !== columns) arrange();
    columns = String(now);
  });
  // The jump button of the section on screen: the last one whose top has passed under the bar.
  const bar = document.querySelector(".bar");
  const sections = [...document.querySelectorAll("section[id]")];
  const jumps = new Map([...document.querySelectorAll(".jump a")].map((a) => [a.hash.slice(1), a]));
  function current() {
    const line = bar.offsetHeight + 8;
    document.documentElement.style.setProperty("--bar", `${bar.offsetHeight}px`);
    let on = sections[0];
    for (const s of sections) if (s.getBoundingClientRect().top <= line) on = s;
    if (innerHeight + scrollY >= document.documentElement.scrollHeight - 2) on = sections.at(-1);
    for (const [id, a] of jumps) a.classList.toggle("on", on !== undefined && id === on.id);
  }
  addEventListener("scroll", current, { passive: true });
  addEventListener("resize", current);
  colour.addEventListener("click", () => { state.random = !state.random; show(); });
  julia.addEventListener("change", () => { state.julia = julia.checked; show(); });
  julia.checked = true;
  show();
})();
"""


def esc(text: str) -> str:
    return text.replace("&", "&amp;").replace('"', "&quot;").replace("<", "&lt;")


def page(_args=None):
    """The page, from the picks record alone; where the working shades are here, the record's
    links and images are refreshed from them first, so a bare clone rebuilds the same page."""
    picks = read(PICKS)
    shades = {(s["id"], s["view"]): s for s in read(SHADES)}
    if shades:
        # Fill each pick's links and images in the picks record from what was drawn.
        for p in picks:
            for field, view in (("", "frame"), ("twin_", "twin")):
                drawn = shades.get((p["id"], view), {})
                said = {tag: drawn.get(tag) or {} for tag in ("fixed", "random")}
                p[f"{field}link"] = {tag: one.get("link") for tag, one in said.items()}
                p[f"{field}img"] = {tag: one.get("img") for tag, one in said.items()}
        write(PICKS, picks)
    parts, jumps = [], []
    shown = 0
    for s in [*DEGREES, OTHER]:
        mine = [p for p in picks if p["section"] == s and p.get("img")]
        mine.sort(key=lambda p: (not p["forced"], -(p["score"] or -1), p["id"]))
        if not mine:
            continue
        cells = []
        for p in mine:
            pair = []
            for cls, field in (("p", ""), ("t", "twin_")):
                data = {}
                for tag, short in (("fixed", "f"), ("random", "r")):
                    img = (p.get(f"{field}img") or {}).get(tag)
                    if img:
                        data[f"{short}i"] = img
                        data[f"{short}h"] = EXPLORER + p[f"{field}link"][tag]
                pair.append((cls, data))
            if "fi" not in pair[0][1]:
                continue
            for cls, data in pair:
                attrs = " ".join(f'data-{k}="{esc(v)}"' for k, v in data.items())
                if "ri" in data:
                    # Random colouring is the page's default (Matt, 2026-10-04).
                    cells.append(
                        f'<a class="{cls}" href="{esc(data["rh"])}" {attrs}><img '
                        f'src="{esc(data["ri"])}" width="{SHOWN[0]}" height="{SHOWN[1]}" '
                        'loading="lazy" decoding="async" alt=""></a>'
                    )
                else:
                    cells.append(
                        f'<a class="{cls} none" {attrs}><img width="{SHOWN[0]}" '
                        f'height="{SHOWN[1]}" alt=""></a>'
                    )
            shown += 1
        slug = HEADINGS[s].lower().replace(" ", "-")
        twin = TWIN_HEADINGS.get(s, "Julia twin")
        jumps.append(f'<a href="#{slug}">{HEADINGS[s]}</a>')
        parts.append(
            f'<section id="{slug}">\n<h2 data-plain="{HEADINGS[s]}" '
            f'data-twin="{HEADINGS[s]} and {twin}">{HEADINGS[s]} and {twin}</h2>\n'
            '<div class="grid">\n' + "\n".join(cells) + "\n</div>\n</section>"
        )
    where = OUT / "index.html"
    html = (
        '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n'
        '<meta name="viewport" content="width=device-width, initial-scale=1">\n'
        f"{icons.head(where)}\n"
        f'<meta name="description" content="{esc(DESCRIPTION)}">\n<title>{TITLE}</title>\n'
        f'<style>{STYLE}</style>\n</head>\n<body class="julia">\n<div class="bar">\n'
        '<button id="colour" type="button" aria-pressed="true"><span class="f">Fixed'
        '</span> / <span class="r on">Random</span> coloring</button>\n'
        '<label><input id="julia" type="checkbox" checked> Show Julia twin</label>\n'
        '<nav class="jump">'
        + "".join(jumps)
        + "</nav>\n</div>\n"
        + "\n".join(parts)
        + f"\n<footer></footer>\n<script>{SCRIPT}</script>\n</body>\n</html>\n"
    )
    OUT.mkdir(parents=True, exist_ok=True)
    where.write_text(heads.with_head(where, html), encoding="utf-8", newline=LF)
    size = sum(f.stat().st_size for f in OUT.rglob("*") if f.is_file())
    log(f"page: {shown} pictures, folder {size / 1e6:.1f} MB")


def main():
    below_normal()
    command = sys.argv[1]
    steps = {
        "population": [population],
        "verify": [verify],
        "score": [score],
        "pick": [pick],
        "render": [render_all],
        "page": [page],
        "all": [score, pick, render_all, page],
        "twins": [twins],
        "refit": [refit],
    }[command]
    for step in steps:
        step()


if __name__ == "__main__":
    main()
