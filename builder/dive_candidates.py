"""Candidates for a deep figure, landed by the Deep tab's Dive block, drawn and laid out.

    python -m builder dive-candidates [--budget-s S] [--seed N] [--out DIR] [--resume]
    python -m builder dive-candidates --sheet [--out DIR]     # rebuild index.html only

*(deep_dive_block_ckpt154 found the method in `scratch/`; deep_multibrots_gallery_ckpt154
moved it here, because a figure came out of its sheet.)* Every landing is `perturb::dive`
through `builder/deep-gallery-native` — the rung rule (`pick`), the landings (`land`), the
coloring rule (`coloring`) — driven the way `explorer/deep.js`'s `diveOnce` drives
`perturb.wasm`: search near the source, take the rung, widen a mapped landing's search where
the budget refuses, anchor a mapped view on the nucleus nearest its centre. So every
candidate's link is one the Deep tab opens identically. The link and the picture come from
`dive_candidates_shade.mjs`, which is the page's contract and shading.

What one unit varies, and the budget it runs under, are `builder/README.md`'s *Dive
candidates*. Everything is written under `--out`: `tiles/`, `units.jsonl`, `heartbeat.log`,
`choices.json` and `index.html`, the numbered contact sheet a person picks from. A tile's
number is its place among the kept units in `units.jsonl`'s order, so a directory is only
ever appended to (`--resume`), never regenerated over.
"""

from __future__ import annotations

import ctypes
import importlib.util
import json
import math
import random
import re
import shutil
import subprocess
import sys
import threading
import time
from decimal import Decimal, localcontext
from pathlib import Path
from urllib.parse import parse_qsl

from . import explorer, seats, serve
from .deep_gallery import EXPLICIT_CEILING, FINAL, _native
from .paths import SITE_ROOT

SHADE = Path(__file__).resolve().parent / "dive_candidates_shade.mjs"
#: Where a run writes when `--out` is not given: ignored, like every stage of `deep-gallery`.
DEFAULT_OUT = Path("artifacts") / "dive-candidates"
DEFAULT_BUDGET_S = 3 * 3600
DEFAULT_SEED = 154

PLANES = {"mandelbrot": 2, "multibrot3": 3, "multibrot4": 4, "multibrot5": 5, "multibrot6": 6}
PLANE_WEIGHT = {"mandelbrot": 3, "multibrot3": 2, "multibrot4": 2, "multibrot5": 2, "multibrot6": 1}
#: Where the last press lands ("to"), and where its search starts ("from"). `to` is adjusted
#: as routes dry up; see [`Run.adapt`].
LANDING_WEIGHT = {"seat": 0.35, "view": 0.35, "center": 0.15, "halfway": 0.15}
FROM_WEIGHT = {"view": 0.6, "seat": 0.4}
#: A center or halfway landing from the view first presses Go on its center this many times.
PRE_RUNGS = (1, 8)
#: The search's grid, the Deep tab's canvas at 1600 wide.
SEARCH_RES = "1136x639"
SEARCH_BUDGET = 24
SEARCH_WANT = 12
#: The count a landing with no carried view searches at: `diveOnce`'s tile rules.
CENTER_COUNT = 32
HALFWAY_COUNT = 8
#: A candidate tile: the Deep gallery's own finish, 16:9 at 2x2 samples a pixel.
RES = FINAL[:2]
SS = FINAL[2]
#: Search widths tried, in multiples of the view's, for a mapped landing with no chain.
WIDEN = [1, 16, 256]
WIDEST = 4.0
#: Presses tried where a random seat is involved, before the unit is dropped.
RANDOM_TRIES = 4
#: A route that landed at most `ADAPT_LANDED` of its last `ADAPT_WINDOW` has its weight halved.
ADAPT_WINDOW = 12
ADAPT_LANDED = 1
ADAPT_FLOOR = 0.05
#: A weight at or under this is at its floor already, and is left there.
ADAPT_HALVES_ABOVE = 0.06
#: A coordinate longer than this is one the link will not spell.
SPELLABLE = 64
ALL_INTERIOR = 0.97
#: A picture whose luminance spread is under this is blank.
BLANK_SPREAD = 4.0
TILE_WEBP_QUALITY = 86
NATIVE_TIMEOUT_S = 600
RENDER_TIMEOUT_S = 900
HEARTBEAT_S = 15 * 60
#: A run stops after this many units in a row raise: something is broken rather than
#: refused, and every further unit would raise the same way until the budget ran out.
ERRORS_IN_A_ROW = 5
#: Until this many units have run, a unit is estimated at `FIRST_ESTIMATE_S`; after, at the
#: 90th percentile of the last `ESTIMATE_WINDOW`.
FIRST_ESTIMATE_S = 120.0
ESTIMATE_WINDOW = 30
LANDINGS = {
    "center": "its center",
    "halfway": "halfway in",
    "view": "this view inside it",
    "seat": "a random wallpaper inside it",
}
UNIT_ID = re.compile(r"^u(\d+)$")
LF = "\n"


class DiveCandidatesError(Exception):
    """A run or a sheet refused: an existing record without `--resume`, or no record."""


# --------------------------------------------------------------------------- the inputs


def out_dir(out: Path | None) -> Path:
    """`--out`, a relative one read against the site root."""
    path = DEFAULT_OUT if out is None else out
    return path if path.is_absolute() else SITE_ROOT / path


def below_normal() -> None:
    """Below-normal priority for this process, which its children inherit on Windows."""
    if sys.platform == "win32":
        kernel = ctypes.windll.kernel32
        kernel.SetPriorityClass(kernel.GetCurrentProcess(), 0x4000)


def cap_for_width(w: float) -> int:
    """`perturb::cap::for_width`, the cap a link that names none is carried in at."""
    raw = 4000.0 * (1.0 + 0.30 * math.log2(3.0 / w))
    return int(min(max(raw, 200.0), 1_000_000.0))


def load_seats() -> dict[str, list[dict]]:
    """Every image seat of the staged gallery's union record, by plane."""
    planes: dict[str, list[dict]] = {name: [] for name in PLANES}
    path = seats.directory() / seats.collection_file(seats.ALL)
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        row = json.loads(line)
        if row.get("kind") != "image":
            continue
        q = dict(parse_qsl(row["link"], keep_blank_values=True))
        family = q.get("f", "mandelbrot")
        if family not in planes:
            continue
        w = float(q["w"])
        planes[family].append(
            {
                "key": row["key"],
                "link": row["link"],
                "re": q["x"],
                "im": q["y"],
                "w": w,
                "cap": int(q["n"]) if "n" in q else cap_for_width(w),
            }
        )
    return planes


def random_palettes() -> list[str]:
    """The maps Random palette may land on, in the roster's order."""
    _, entries = explorer.roster()
    return [entry.name for entry in entries if entry.random]


def view_args(v: dict, degree: int) -> dict:
    args = {"re": v["re"], "im": v["im"], "w": repr(v["w"]), "res": SEARCH_RES}
    if degree != 2:
        args["deg"] = degree
    return args


def apart(a: dict, b: dict) -> Decimal:
    with localcontext(prec=140):
        return max(
            abs(Decimal(a["re"]) - Decimal(b["re"])), abs(Decimal(a["im"]) - Decimal(b["im"]))
        )


def canonical_len(text: str) -> int:
    """The length of a coordinate as `deep-fx` spells it: trailing zeros trimmed."""
    if "." in text:
        text = text.rstrip("0").rstrip(".")
    return len(text)


# ------------------------------------------------------------------------------ a press


class Dive:
    """One press of Go, natively, as `deep.js`'s `diveOnce` makes it."""

    def __init__(self, seats_by_plane, rng):
        self.seats = seats_by_plane
        self.rng = rng

    def seat(self, plane):
        return self.rng.choice(self.seats[plane])

    def press(self, plane, v, chain, frm, to):
        """`(frame, copy, said)` or `(None, why, None)`."""
        degree = PLANES[plane]
        seat_a = self.seat(plane) if frm == "seat" else None
        near = seat_a if seat_a is not None else v
        seat_b = None
        into = None
        if to == "view":
            into = v
        elif to == "seat":
            seat_b = self.seat(plane)
            into = seat_b
        if into is not None:
            count = into["cap"]
        else:
            count = CENTER_COUNT if to == "center" else HALFWAY_COUNT
        if into is not None and 2 * count > EXPLICIT_CEILING:
            return None, f"budget: the carried view is drawn at {count}", None
        rungs = chain if seat_a is None else []
        widths = WIDEN if into is not None and not rungs else [1]
        picked = None
        searched = near
        for factor in widths:
            wide = near["w"] * factor
            if factor > 1 and wide > WIDEST:
                break
            searched = dict(near, w=wide) if factor > 1 else near
            rung_text = ";".join(f"{r['re']},{r['im']},{r['size_log2']}" for r in rungs)
            picked = _native(
                "pick",
                timeout=NATIVE_TIMEOUT_S,
                **view_args(searched, degree),
                count=count,
                budget=SEARCH_BUDGET,
                want=SEARCH_WANT,
                rungs=rung_text or None,
            )
            if picked["refusal"] != "over_budget":
                break
        if picked["index"] is None:
            why = picked["refusal"]
            if why == "over_budget":
                why += f" (period {picked['period']} needs {int(picked['need']):,})"
            return None, why, None
        copy = picked["nuclei"][picked["index"]]
        base = {
            "re": copy["re"],
            "im": copy["im"],
            "period": copy["period"],
            "size-log2": repr(copy["size_log2"]),
        }
        if degree != 2:
            base["deg"] = degree
        anchor = None
        if to == "center":
            frame = _native("land", timeout=NATIVE_TIMEOUT_S, landing="center", **base)
        elif to == "halfway":
            frame = _native(
                "land",
                timeout=NATIVE_TIMEOUT_S,
                landing="halfway",
                **base,
                **{"found-in": repr(near["w"])},
            )
        else:
            if into is searched:
                around = picked["nuclei"]
            else:
                around = _native(
                    "find",
                    timeout=NATIVE_TIMEOUT_S,
                    **view_args(into, degree),
                    budget=SEARCH_BUDGET,
                    want=SEARCH_WANT,
                )["nuclei"]
            anchor = min(around, key=lambda one: apart(one, into)) if around else None
            mapped = {"vre": into["re"], "vim": into["im"], "vw": repr(into["w"]), "count": count}
            if anchor is not None:
                mapped.update(are=anchor["re"], aim=anchor["im"], aperiod=anchor["period"])
            frame = _native("land", timeout=RENDER_TIMEOUT_S, landing="mapped", **base, **mapped)
        if not frame.get("ok"):
            return None, f"land: {frame.get('why')}", None
        said = {
            "plane": plane,
            "a_seat": seat_a["key"] if seat_a else None,
            "b_seat": seat_b["key"] if seat_b else None,
            "copy_period": copy["period"],
            "copy_size_log2": copy["size_log2"],
            "widened": round(searched["w"] / near["w"]),
            "turn": frame.get("turn"),
            "twin_period": frame.get("twin_period"),
        }
        return frame, copy, said


# -------------------------------------------------------------------------------- a run


def read_units(log: Path) -> list[dict]:
    """`units.jsonl`'s records. A line that does not parse is skipped: the heartbeat reads
    the file while the run appends to it, and may meet a half-written last line."""
    if not log.exists():
        return []
    rows = []
    for line in log.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        try:
            rows.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    return rows


def last_unit(rows: list[dict]) -> int:
    numbers = [int(m.group(1)) for r in rows if (m := UNIT_ID.match(str(r.get("id", ""))))]
    return max(numbers, default=0)


class Run:
    """A run of units into `out`. The keywords are what `builder/random_dives.py` changes;
    their defaults are this command's, and a run that passes none of them is this command's
    run exactly."""

    def __init__(
        self,
        out: Path,
        budget_s: float,
        seed: int,
        port: int,
        resume: bool,
        *,
        res: tuple[int, int] = RES,
        ss: int = SS,
        always_new: bool = False,
        guard: bool = False,
    ):
        self.out = out
        self.res = res
        self.ss = ss
        #: New coloring on every landing. The coin a unit tosses for it is still tossed, so a
        #: unit's other draws come out of the generator the way they always have.
        self.always_new = always_new
        #: The page's aliasing guard on a New coloring (`explorer/aliasing.js`).
        self.guard = guard
        self.tiles = out / "tiles"
        self.work = out / "work"
        self.log = out / "units.jsonl"
        self.heart = out / "heartbeat.log"
        self.port = port
        before = read_units(self.log)
        if before and not resume:
            raise DiveCandidatesError(
                f"{self.log} already holds {len(before)} units, and a rerun would renumber "
                "the sheet a person picks from; --resume appends to it"
            )
        # Checked here rather than left to `one`'s import: an import that fails there fails
        # before the unit is numbered, every unit, as fast as the loop can go.
        if importlib.util.find_spec("PIL") is None:
            raise DiveCandidatesError("dive-candidates needs Pillow to encode its tiles")
        self.budget_s = budget_s
        # A resumed run is seeded past the one before it, so that it draws new choices.
        self.seed = seed + len(before)
        self.rng = random.Random(self.seed)
        self.seats = load_seats()
        self.palettes = random_palettes()
        self.dive = Dive(self.seats, self.rng)
        self.started = time.monotonic()
        self.durations: list[float] = []
        self.kept = self.kept_before(before)
        self.dropped: dict[str, int] = {}
        for r in before:
            if r.get("dropped"):
                self.dropped[r["dropped"]] = self.dropped.get(r["dropped"], 0) + 1
        self.weights = dict(LANDING_WEIGHT)
        self.from_weights = dict(FROM_WEIGHT)
        self.tries: dict[str, list[int]] = {}
        # A resumed run keeps the notes the runs before it made; `run` rewrites the file.
        choices = out / "choices.json"
        self.choices: list[str] = (
            json.loads(choices.read_text(encoding="utf-8")) if before and choices.exists() else []
        )
        self.unit = last_unit(before)
        self.resumed = len(before)
        self.lock = threading.Lock()
        self.last_error = ""

    def elapsed(self):
        return time.monotonic() - self.started

    def kept_before(self, before: list[dict]) -> int:
        """How many a resumed run has kept already."""
        return sum(1 for r in before if r.get("tile"))

    def refuse(self, record: dict, frame: dict) -> str | None:
        """A reason to drop a landed frame before it is drawn, or `None`."""
        return None

    def finished(self) -> str | None:
        """A reason to stop the run before its budget is spent, or `None`."""
        return None

    def keep(self, record: dict, image, uid: str) -> bool:
        """Land a kept unit's picture and say whether it was kept: a numbered tile here."""
        self.tiles.mkdir(parents=True, exist_ok=True)
        image.save(self.tiles / f"{uid}.webp", quality=TILE_WEBP_QUALITY)
        record["tile"] = f"tiles/{uid}.webp"
        return True

    def pick_weighted(self, table):
        names = list(table)
        return self.rng.choices(names, weights=[table[n] for n in names])[0]

    def drop(self, reason):
        key = reason.split(" (")[0].split(":")[0]
        # Under the lock: the heartbeat thread serializes this dict, and a new key mid-dump
        # is a RuntimeError that would end that thread.
        with self.lock:
            self.dropped[key] = self.dropped.get(key, 0) + 1
        return key

    def adapt(self, route, landed):
        """A route that has stopped landing gives its weight to the ones that still do."""
        seen = self.tries.setdefault(route, [])
        seen.append(1 if landed else 0)
        recent = sum(seen[-ADAPT_WINDOW:])
        if len(seen) >= ADAPT_WINDOW and recent <= ADAPT_LANDED:
            to = route.split("/")[1]
            if self.weights.get(to, 0) > ADAPT_HALVES_ABOVE:
                self.weights[to] = max(ADAPT_FLOOR, self.weights[to] / 2)
                note = (
                    f"route {route} landed {recent} of its last {ADAPT_WINDOW}: its weight "
                    f"halved to {self.weights[to]:.2f}"
                )
                self.choices.append(note)
                self.beat(note)

    def beat(self, extra=""):
        with self.lock:
            line = {
                "at": time.strftime("%H:%M:%S"),
                "elapsed_min": round(self.elapsed() / 60, 1),
                "units": self.unit,
                "kept": self.kept,
                "dropped": self.dropped,
                "weights": {k: round(v, 3) for k, v in self.weights.items()},
                "note": extra,
            }
            with self.heart.open("a", encoding="utf-8", newline=LF) as f:
                f.write(json.dumps(line) + LF)
            print(json.dumps(line), flush=True)

    def heartbeat(self, stop):
        while not stop.wait(HEARTBEAT_S):
            self.beat("heartbeat")
            try:
                sheet(self.out, self.port)
            except Exception as error:  # the sheet is a view of the log; never the run's end
                self.beat(f"sheet failed: {error}")

    def estimate(self):
        if len(self.durations) < 3:
            return FIRST_ESTIMATE_S
        ordered = sorted(self.durations[-ESTIMATE_WINDOW:])
        return ordered[int(0.9 * (len(ordered) - 1))]

    def one(self):
        from PIL import Image, ImageStat

        self.unit += 1
        uid = f"u{self.unit:04d}"
        started = time.monotonic()
        plane = self.pick_weighted(PLANE_WEIGHT)
        to = self.pick_weighted(self.weights)
        frm = self.pick_weighted(self.from_weights)
        # A center or halfway landing from this view goes down a few rungs first, so it lands
        # below the f64 floor rather than at a wallpaper's own depth.
        pre = self.rng.randint(*PRE_RUNGS) if to in ("center", "halfway") and frm == "view" else 0
        colouring = self.rng.random() < 0.5 or self.always_new
        start = self.dive.seat(plane)
        record = {
            "id": uid,
            "plane": plane,
            "from": frm,
            "to": to,
            "pre_rungs": pre,
            "coloring": colouring,
            "start_seat": start["key"],
        }
        route = f"{frm}/{to}"
        v, chain = dict(start), []
        # The rungs before the last press: this view, its center, pressed `pre` times.
        for _ in range(pre):
            frame, copy, said = self.dive.press(plane, v, chain, "view", "center")
            if frame is None:
                break
            chain = chain + [{"re": copy["re"], "im": copy["im"], "size_log2": copy["size_log2"]}]
            v = {"re": frame["re"], "im": frame["im"], "w": frame["width"], "cap": frame["cap"]}
        record["rungs_before"] = len(chain)
        landed = None
        why = None
        tries = RANDOM_TRIES if "seat" in (frm, to) else 1
        for _ in range(tries):
            frame, copy, said = self.dive.press(plane, v, chain, frm, to)
            if frame is not None:
                landed = (frame, copy, said)
                break
            why = copy
        if landed is None:
            record["dropped"] = self.drop(f"refused: {why}")
            record["why"] = why
            return self.finish(record, route, started, False)
        frame, copy, said = landed
        record.update(said)
        record["rung"] = len(chain) + 1
        if max(canonical_len(frame["re"]), canonical_len(frame["im"])) > SPELLABLE:
            record["dropped"] = self.drop("refused: unspellable")
            return self.finish(record, route, started, False)
        refused = self.refuse(record, frame)
        if refused is not None:
            record["dropped"] = self.drop(refused)
            return self.finish(record, route, started, False)
        # The picture, natively.
        field = self.work / f"{uid}.f64"
        rgba = self.work / f"{uid}.rgba"
        jobs = self.work / f"{uid}.json"
        res = f"{self.res[0]}x{self.res[1]}"
        try:
            drawn = _native(
                "field",
                timeout=RENDER_TIMEOUT_S,
                re=frame["re"],
                im=frame["im"],
                w=repr(frame["width"]),
                res=res,
                ss=self.ss,
                cap=frame["cap"],
                out=field,
                deg=PLANES[plane] if PLANES[plane] != 2 else None,
            )
        except subprocess.TimeoutExpired:
            record["dropped"] = self.drop("refused: render over 15 min")
            return self.finish(record, route, started, False)
        record["render_s"] = drawn["seconds"]
        record["interior"] = drawn["interior"]
        record["frame"] = {k: frame[k] for k in ("re", "im", "width", "cap")}
        try:
            if drawn["interior"] > ALL_INTERIOR:
                record["dropped"] = self.drop("all-interior")
                return self.finish(record, route, started, False)
            if colouring:
                rule = _native(
                    "coloring",
                    timeout=NATIVE_TIMEOUT_S,
                    field=field,
                    res=res,
                    ss=self.ss,
                    **{"cycles-pick": self.rng.random()},
                    pick=self.rng.random(),
                )
                if not rule.get("ok"):
                    record["dropped"] = self.drop("blank")
                    return self.finish(record, route, started, False)
                colour = {
                    "kind": "new",
                    "palette": self.rng.choice(self.palettes),
                    "lambda": rule["lambda"],
                    "period": rule["period"],
                    "phase": round(self.rng.random(), 3),
                    "guard": self.guard,
                }
                record["rule"] = {
                    "cycles": rule["cycles"],
                    "lambda": rule["lambda"],
                    "period": rule["period"],
                }
            else:
                colour = {"kind": "keep", "seat": start["link"]}
            job = {
                "id": uid,
                "deg": PLANES[plane],
                "re": frame["re"],
                "im": frame["im"],
                "w": repr(frame["width"]),
                "n": frame["cap"],
                "field": str(field),
                "width": self.res[0],
                "height": self.res[1],
                "ss": self.ss,
                "out": str(rgba),
                "colour": colour,
            }
            jobs.write_text(json.dumps([job]), encoding="utf-8", newline=LF)
            shaded = subprocess.run(
                ["node", str(SHADE), str(jobs)], capture_output=True, text=True, cwd=SITE_ROOT
            )
            if shaded.returncode != 0:
                record["dropped"] = self.drop("refused: link")
                record["why"] = shaded.stderr.strip()[-300:]
                return self.finish(record, route, started, False)
            out = json.loads(shaded.stdout)[0]
            record["link"] = out["link"]
            record["palette"] = out["palette"]
            if out.get("guard"):
                record["guard"] = out["guard"]
            image = Image.frombytes("RGBA", self.res, rgba.read_bytes()).convert("RGB")
        finally:
            for f in (field, jobs, rgba):
                f.unlink(missing_ok=True)
        spread = ImageStat.Stat(image.convert("L")).stddev[0]
        record["spread"] = round(spread, 2)
        if spread < BLANK_SPREAD:
            record["dropped"] = self.drop("blank")
            return self.finish(record, route, started, False)
        if not self.keep(record, image, uid):
            return self.finish(record, route, started, False)
        self.kept += 1
        return self.finish(record, route, started, True)

    def finish(self, record, route, started, landed):
        record["unit_s"] = round(time.monotonic() - started, 2)
        self.durations.append(record["unit_s"])
        self.append(record)
        self.adapt(route, landed)
        return landed

    def append(self, record):
        with self.log.open("a", encoding="utf-8", newline=LF) as f:
            f.write(json.dumps(record) + LF)

    def run(self):
        self.out.mkdir(parents=True, exist_ok=True)
        self.work.mkdir(parents=True, exist_ok=True)
        stop = threading.Event()
        threading.Thread(target=self.heartbeat, args=(stop,), daemon=True).start()
        opening = (
            f"start: budget {self.budget_s / 3600:.2f} h, seats "
            f"{sum(map(len, self.seats.values()))}, seed {self.seed}"
        )
        if self.resumed:
            opening += f", resuming after {self.resumed} units at u{self.unit + 1:04d}"
        self.beat(opening)
        failed = 0
        try:
            while True:
                reason = self.finished()
                if reason is not None:
                    self.beat(f"stop: {reason}")
                    break
                if failed >= ERRORS_IN_A_ROW:
                    self.beat(f"stop: {failed} units in a row raised, the last {self.last_error}")
                    break
                left = self.budget_s - self.elapsed()
                if left < self.estimate():
                    self.beat(
                        f"stop: {left:.0f} s left, a unit estimated at {self.estimate():.0f} s"
                    )
                    break
                try:
                    self.one()
                    failed = 0
                except Exception as error:
                    # An error never reaches `finish`, so it never moves the estimate: a
                    # failure that repeats every unit would otherwise run the whole budget.
                    failed += 1
                    self.last_error = repr(error)
                    self.drop("refused: error")
                    self.append(
                        {"id": f"u{self.unit:04d}", "dropped": "refused", "why": repr(error)}
                    )
        finally:
            stop.set()
            shutil.rmtree(self.work, ignore_errors=True)
        (self.out / "choices.json").write_text(
            json.dumps(self.choices, indent=2), encoding="utf-8", newline=LF
        )
        self.beat("done")


# ---------------------------------------------------------------------------- the sheet


def sheet(out: Path, port: int = serve.DEFAULT_PORT) -> Path:
    """index.html: every kept tile, numbered, grouped by landing option."""
    log = out / "units.jsonl"
    if not log.exists():
        raise DiveCandidatesError(f"{log} does not exist; there is nothing to lay out")
    rows = read_units(log)
    kept = [r for r in rows if r.get("tile")]
    dropped: dict[str, int] = {}
    for r in rows:
        if r.get("dropped"):
            dropped[r["dropped"]] = dropped.get(r["dropped"], 0) + 1
    number = {r["id"]: i + 1 for i, r in enumerate(kept)}
    origin = f"{serve.HOST}:{port}"
    parts = [
        "<!doctype html><meta charset='utf-8'><title>Dive candidates</title>",
        "<style>body{background:#111;color:#ddd;font:13px/1.4 system-ui,sans-serif;margin:16px}"
        "h1{font-size:20px}h2{font-size:16px;margin:28px 0 8px;border-bottom:1px solid #333}"
        ".grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(330px,1fr));gap:14px}"
        ".tile{background:#1b1b1b;padding:6px;border-radius:4px}.tile img{width:100%;display:block}"
        ".n{font-weight:700;color:#fff;font-size:15px}.p{color:#aaa;font-size:12px}"
        ".l{font-family:monospace;font-size:10px;word-break:break-all;color:#8ab4f8}"
        "a{color:#8ab4f8}</style>",
        "<h1>Dive candidates</h1>",
        f"<p>{len(kept)} kept of {len(rows)} units. Dropped by reason: "
        + ", ".join(f"{k} {v}" for k, v in sorted(dropped.items()))
        + f". Each link opens in the Deep tab at <code>{origin}</code>.</p>",
    ]
    for option, words in LANDINGS.items():
        group = [r for r in kept if r["to"] == option]
        parts.append(f"<h2>{words} &middot; {len(group)}</h2><div class='grid'>")
        for r in group:
            a = f"seat {r['a_seat']}" if r.get("a_seat") else f"start seat {r['start_seat']}"
            if option == "seat":
                b = f"B seat {r['b_seat']}"
            elif option == "view":
                b = (
                    "B this view"
                    if r.get("rungs_before")
                    else f"B this view (start seat {r['start_seat']})"
                )
            else:
                b = f"landing {words}"
            turn = f", turned {round(r['turn'])}&deg;" if option in ("view", "seat") else ""
            twin = f", twin period {r['twin_period']:,}" if r.get("twin_period") else ""
            wide = f", searched {r['widened']}&times; wider" if r.get("widened", 1) > 1 else ""
            colour = "New coloring" if r["coloring"] else "seat's palette, fitted"
            href = f"http://{origin}/explorer/index.html?{r['link']}&panel=deep"
            parts.append(
                f"<div class='tile'><a href='{href}' target='_blank'>"
                f"<img src='{r['tile']}' loading='lazy'></a>"
                f"<div><span class='n'>#{number[r['id']]}</span> {r['plane']} "
                f"&middot; rung {r['rung']} "
                f"&middot; period {r['copy_period']:,} copy{wide}</div>"
                f"<div class='p'>A: {a} &middot; {b}{turn}{twin} &middot; {colour} "
                f"({r['palette']})</div>"
                f"<div class='p'>render {r['render_s']:.1f} s at {RES[0]}&times;{RES[1]}, "
                f"{SS * SS} samples a pixel &middot; width {r['frame']['width']:.1e} "
                f"&middot; cap {r['frame']['cap']:,} "
                f"&middot; interior {r['interior']:.0%} &middot; {r['id']}</div>"
                f"<div class='l'><a href='{href}' target='_blank'>{r['link']}</a></div></div>"
            )
        parts.append("</div>")
    path = out / "index.html"
    path.write_text(LF.join(parts), encoding="utf-8", newline=LF)
    return path


def main(options) -> list[str]:
    """`python -m builder dive-candidates`: a run into `--out`, then its sheet."""
    out = out_dir(options.out)
    if options.sheet:
        path = sheet(out, options.port)
        return [f"wrote {path}"]
    run = Run(out, options.budget_s, options.seed, options.port, options.resume)
    below_normal()
    run.run()
    lines = [f"{run.kept} kept of {run.unit} units in {out}"]
    if (out / "units.jsonl").exists():
        lines.append(f"wrote {sheet(out, options.port)}")
    return lines
