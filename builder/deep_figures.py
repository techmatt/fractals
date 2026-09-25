"""The figures of *Deep zoom*: deep frames drawn the way the Deep tab draws them.

    python -m builder deep [ID ...] [--place] [--replace]

## One renderer, one shader, one link

A deep panel is **a Deep-tab link and a grid**, and nothing else. The link names the place
to exact decimals, the family, the palette and its pass, and — once settled — the cap; the
grid is the raster the figure wants. From those two:

1. `deep_figures.mjs` reads the link through `explorer/deep-link.js`, settles its cap with
   the tab's own probe where the link names none, and draws the field through
   `zoom_fields.mjs`'s band renderer on the committed `perturb.wasm` — the renderer the deep
   zoom video's keyframes come out of, and so the one `nu` every deep picture on this page
   is measured in.
2. `deep_gallery_shade.mjs` colours that field exactly as the tab colours the link, through
   `deep-render.js`'s `shadeSpecOf` and the committed `engine.wasm`.
3. The lossless picture lands in `artifacts/deep-figures/`, and `--place` encodes it into
   the site through `images.import_web_res`, the one encoder every figure goes through.

So the picture on the page, the link in its corner and the picture the Deep tab opens are
three readings of one string. **The link is the recipe**, and it lives in
`article/figure-recipes.jsonl` as a `deep` row keyed `<figure id>#<panel>`, beside the
seats and candidates every other figure stands on; the panel's own registry row names that
key in `deep`, the way a seat panel names its seat. `builder/links.py` reads the link off
the store and never derives one.

**Nothing new is drawn.** No second renderer, no second colouring: a change to how the tab
draws a deep frame is a change to these pictures on their next redraw, which is the point.

## What is not a deep panel

The one picture here the Deep tab cannot draw is the left half of
`deep-f64-and-perturbation`, which is the frame computed in plain doubles *on purpose*.
That is an engine render spec with `allow_unresolvable_in_f64` — the opt-in
`fractal-engine` grew for exactly this picture — drawn through `renders.render`, and its
panel carries the `spec` like any other spec panel. `links.py` refuses it a link as `deep`,
which is the truth: the explorer refuses that frame rather than drawing the arithmetic, and
the Deep tab would draw the right-hand picture instead.

## Colouring

Every panel but one is `scale=absolute`: the frame's own percentile stretch spends the
palette on a few percent of a deep frame's range (the prose says so, and the figure after
the video is about it). The one is the shallow half of `deep-shallow-and-deep`, whose link
is Matt's as he gave it, on the leveled scale. `lambda` and `period` are chosen per figure
and written into the link, which is where the recipe records them. Panels of one strip
share one colouring, so that one colour means one escape count across the strip, the way
the video's frames do; that pair is one exception, and `deep-misiurewicz-pairs` the other:
one map to a row, so that its three rows read as three places, and one colouring across
each row's three panels.
"""

from __future__ import annotations

import hashlib
import json
import math
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import quote, unquote

from . import images
from .locations import Made, Split, panel_path
from .paths import SITE_ROOT

HERE = Path(__file__).resolve().parent
FIELDS = HERE / "deep_figures.mjs"
SHADE = HERE / "deep_gallery_shade.mjs"

#: Where fields and lossless pictures land. Ignored, and re-derivable from the store.
WORK = SITE_ROOT / "artifacts" / "deep-figures"


class DeepFigureError(RuntimeError):
    """A deep panel cannot be drawn as its record describes it."""


@dataclass(frozen=True)
class Drawn:
    """One deep panel, drawn: the lossless picture and what the render said about itself."""

    path: Path
    link: str
    maxiter: int
    seconds: float
    interior: float


def _node(script: Path, jobs: list[dict]) -> list[dict]:
    with tempfile.TemporaryDirectory() as scratch:
        path = Path(scratch) / "jobs.json"
        path.write_text(json.dumps(jobs), encoding="utf-8", newline="\n")
        out = subprocess.run(
            ["node", str(script), str(path)],
            capture_output=True,
            text=True,
            encoding="utf-8",
            cwd=str(SITE_ROOT),
        )
    if out.returncode != 0:
        raise DeepFigureError(f"{script.name} failed:\n{out.stderr[-3000:]}")
    return json.loads(out.stdout)


def draw_link(link: str, width: int, height: int, supersample: int, name: str) -> Drawn:
    """One deep panel at one grid, cached on the link it was asked for and the grid.

    A link that names no cap comes back naming the one the probe settled, so the key is the
    link as *asked* and the answer is recorded beside the picture. Anything derived on top
    of a cached render carries that render's key in its own name — `builder/README.md` has
    the case that made that a rule.
    """
    asked = f"{link}|{width}x{height}x{supersample}"
    key = hashlib.sha256(asked.encode("utf-8")).hexdigest()[:16]
    WORK.mkdir(parents=True, exist_ok=True)
    png = WORK / f"{name}_{key}.png"
    meta = WORK / f"{name}_{key}.json"
    if png.is_file() and meta.is_file():
        held = json.loads(meta.read_text(encoding="utf-8"))
        return Drawn(png, held["link"], held["maxiter"], held["seconds"], held["interior"])
    field = WORK / f"{key}.f64"
    (rendered,) = _node(
        FIELDS,
        [
            {
                "id": name,
                "link": link,
                "width": width,
                "height": height,
                "ss": supersample,
                "field": str(field),
            }
        ],
    )
    raw = WORK / f"{key}.rgba"
    _node(
        SHADE,
        [
            {
                "id": name,
                "query": rendered["link"],
                "field": str(field),
                "width": width,
                "height": height,
                "ss": supersample,
                "out": str(raw),
            }
        ],
    )
    images.write_rgba(raw.read_bytes(), (width, height), png)
    raw.unlink()
    field.unlink()
    meta.write_text(
        json.dumps({"asked": asked, **rendered}, indent=1) + "\n", encoding="utf-8", newline="\n"
    )
    return Drawn(
        png, rendered["link"], rendered["maxiter"], rendered["seconds"], rendered["interior"]
    )


# ------------------------------------------------------------------------------ figures

#: The deep zoom video's target, from `data/deep-zoom-descent.keyframes.json`.
TARGET = ("-0.74937053247003823168823992075369", "0.041472667068168900034718746387049")

#: The opening figure's colouring, off Matt's explorer link (deep_opening_palette_ckpt150),
#: as the explorer's own parser reads it back: `Porcelain Field` is the map's own name.
OPENING = "p=Porcelain%20Field&phase=0.41&scale=absolute&lambda=0&period=0.295"
#: The video's final frame and its cap, and the four colourings `deep-final-colorings` lays
#: over its field, each exactly Matt's link as the explorer's parser reads it back
#: (deep_opening_palette_ckpt150 addendum 1). The second names no `scale`, so it is leveled.
FINAL = "3.4869054402668363e-15"
FINAL_COLOURINGS = (
    ("Final frame", "n=63534&p=glowdon&scale=absolute&lambda=0&period=0.25"),
    ("Leveled", "n=63534&p=glowdon&lambda=0&period=2.14"),
    ("Higher period", "n=63534&p=glowdon&scale=absolute&lambda=0&period=0.794"),
    (
        "Palette switch",
        "n=63534&p=fractal_abstraction_lines_130499_2560x1600&scale=absolute&lambda=0&period=0.575",
    ),
)
FINAL_ALTS = {
    "Final frame": "The video's final frame: a spiral wound from dense filigree, banded many "
    "times over in blue, orange, and pale green.",
    "Leveled": "The same frame on the leveled scale: the spiral in dark red and orange over "
    "broad fields that run from deep blue to pale yellow.",
    "Higher period": "The same frame at a longer period: fewer, wider bands, so the spiral "
    "reads as orange and yellow arms over blue.",
    "Palette switch": "The same frame and pass in a palette of blues: the spiral in pale "
    "lavender and white over deep blue.",
}
#: The coarse pass, one `scale=absolute` function of the smooth count at period 0.5, which
#: bands less on frames whose counts are tens rather than tens of thousands.
COARSE = "p=glowdon&scale=absolute&lambda=0&period=0.5"
#: `deep-descent-rungs` in its own map: the coarse pass in Chalcedony, Matt's pick off the
#: sheet (small_fixes_ckpt146).
RUNGS = COARSE.replace("p=glowdon", "p=Chalcedony")

#: The period-27 copy of the S4 descent in the wallpaper project's
#: `artifacts/discovery/minibrot_examples.jsonl`, re-solved by Newton to 30 places, and its
#: period-54 disk as `nuclei::search` gave it inside that copy's view, 2e-6 wide.
NUCLEUS_27 = ("-0.782601462031970873215191715691", "0.150070431906352576566418312168")
NUCLEUS_54 = ("-0.78260206005940088591", "0.15006965844999610089")
#: The descent's last frame: the place of the `threads` pool candidate `ca42a73543b6c213`.
THREADS = ("-0.782601984654748", "0.15006989511782523", "1.2860948266974178e-9")

#: The rung between the period-54 disk and the threads frame: the nucleus of the period-972
#: bulb (54 × 18) 2.3e-9 from the threads centre, by Newton to 30 places from that centre.
#: No component of lower period lies between: the threads centre's atom domains run 1, 2,
#: 27, 54, 1026, and Newton from it for every period 55–1025 lands only on 918 and 972.
NUCLEUS_972 = ("-0.782601984826695942254944884344", "0.15006989282157889324981067557")

#: The deep frame of `deep-shallow-and-deep`, and its colouring, exactly as Matt gave the
#: link (deep_zoom_edits_ckpt145). The shallow frame shares its centre, and since
#: PLACE_deep_zoom_v3_ckpt145 its whole link is Matt's too: its own cap and its own
#: colouring, on the leveled scale, so the pair no longer shares one colouring.
KNOT = ("-0.7493705324700378557700614606921816", "0.0414726670681690448763936935919414")
COALGLOW = "p=Coalglow&phase=0.617&scale=absolute&lambda=0.04&period=0.596"
SHALLOW = "n=53737&p=Coalglow&gamma=0.559&cycles=2&phase=0.645&lambda=0.04&period=0.596"

#: The video's keyframe k2: a double still places a pixel along the imaginary axis here and
#: no longer does along the real one, so the f64 picture breaks up and is still recognizable.
K2 = "1.3947621761067345e-14"


@dataclass(frozen=True)
class Frame:
    """One panel: where, what it says, and whether the Deep tab or plain doubles draw it."""

    x: str
    y: str
    w: str
    colour: str
    label: str
    alt: str
    note: str | None = None
    julia: tuple[str, str] | None = None
    #: Drawn by `fractal-engine` in plain `f64` past its own floor, on purpose.
    f64: bool = False
    #: The degree of `z^d + c`; the link names a family only where it is not two.
    degree: int = 2

    def link(self) -> str:
        f = ""
        if self.degree != 2:
            f = f"f={'julia' if self.julia else 'multibrot'}{self.degree}&"
        c = f"cx={self.julia[0]}&cy={self.julia[1]}&" if self.julia else ""
        return f"dv=3&{f}{c}x={self.x}&y={self.y}&w={self.w}&{self.colour}"


@dataclass(frozen=True)
class Figure:
    frames: tuple[Frame, ...]
    columns: int
    size: tuple[int, int]
    supersample: int
    about: str


def _width(text: str) -> str:
    """A width as a reader reads it: `1.4 × 10⁻¹⁴`, with a real minus."""
    value = float(text)
    if value >= 0.01:
        return f"{value:g}"
    mantissa, exponent = f"{value:.1e}".split("e")
    mantissa = mantissa.rstrip("0").rstrip(".")
    raised = str(int(exponent)).translate(str.maketrans("-0123456789", "⁻⁰¹²³⁴⁵⁶⁷⁸⁹"))
    return f"10{raised}" if mantissa == "1" else f"{mantissa} × 10{raised}"


def _wide(text: str) -> str:
    return f"width {_width(text)}"


# ---------------------------------------------------------------------- Misiurewicz pairs
#
# At a Misiurewicz point c the critical orbit z_0 = 0, z_{n+1} = z_n^d + c lands on a
# repelling cycle of period p with multiplier ρ. A Julia offset δ at z_1 = c reaches
# a_n·δ at z_n, where a_n = ∂z_n/∂z_1, and a parameter offset e reaches b_n·e, where
# b_n = ∂z_n/∂c; both land in the same neighbourhood of the cycle. So the parameter plane
# at c + e looks like J_c at c + λe, λ = lim b_n/a_n — Tan Lei's similarity, derived
# rather than fitted, and the same at every degree. J_c is self-similar about c by ρ as
# well, so λρ^m aligns the two for every integer m. The J zoom's width is |λρ^m| times the
# M zoom's, and arg(λρ^m) is the turn left over: the explorer draws no rotation, so the J
# zoom is drawn unturned and the turn is recorded rather than undone.
#
# Row one is shallow: c is M(4,1) of the Mandelbrot set, Newton-solved on
# f^{k+p}(0) = f^k(0). The deep rows are *tuned* Misiurewicz points (deep_misiurewicz_
# ckpt146), because an ordinary one cannot carry what the figure shows: near c a copy at
# distance r is about r² over the size of c's own neighbourhood, so at 1e-15 the copies
# round an ordinary point are some thirteen orders below a pixel and the two zooms are
# the same picture. So each deep c is a shallow point B of the multibrot, preperiod 4 and
# period 1 and weakly repelling (|ρ| ≈ 1.33, which is what puts filigree through its
# centre rather than a hair), carried into a copy A of period P found by `deep-gallery-
# native find` next to a strongly repelling point: seeded at c_A + s_A·c_B and solved by
# Newton on f^{P(k+p)}(0) = f^{Pk}(0) to 80 digits. Its orbit lands at z_{3P+1} on a cycle
# of period P, and the frame is s_A times B's frame at 0.01, where B's own copies show.
#
# Each (k, p) is read off the solved orbit, not assumed. The turn was also measured, as
# `measured`: log smooth count at 20,000 random offsets in a disc about c, from the
# native fields of both planes, correlated over the full circle at 0.5°, then 0.05° and
# a scale grid of ±30%. The peak r is `agreement`: 0.95 on the shallow row at 3e-3, near
# 0.8 on the deep rows, whose frames are 1e-2 of their B's, wide enough to show copies.
# Every deep candidate agreed better at 1e-2 of its B than at 3e-2, as the theorem says.


# ------------------------------------------------------------------ automatic descents
#
# A and B are two seats of the general gallery, degree 2, each centred on a copy, picked by
# the session (double_descent_ckpt145 addendum 1: "pick A and B yourself") as the two
# highest-ranked general seats whose centre is a copy of low period: seat afdb47c0d3307d70
# (general #17, period 28) and seat 9c6a3d8779c20d20 (general #51, period 18). Every pair's
# product stays far under the ceiling at 32 periods. A panel is its seat's frame, drawn by
# the Deep tab; the seat's own mode and palette do not travel, because the tab draws smooth.
#
# The four twins are `python -m builder descent`'s: the copy of M_B inside M_A, solved by
# multiple shooting and confirmed by Newton at period p_A·p_B, framed at w_B·|s_A| and
# turned by arg(s_A), which the explorer does not undo. Frozen here as the solve gave them.

DESCENT_PLACES = {
    "A": {
        "x": "-0.048481003091324464",
        "y": "0.671423098072995",
        "w": "0.000004214533046626384",
        "period": 28,
        "alt": "Spiral arms of filigree in blue, orange and pale green winding round a center "
        "whose copy is too small to see.",
    },
    "B": {
        "x": "-0.7965805906382233",
        "y": "0.1836388307197798",
        "w": "0.00014167356735746674",
        "period": 18,
        "alt": "A small black copy of the set at the center of a cross of filigree, between "
        "broad smooth fields of blue.",
    },
}

DESCENT_TWINS = {
    "AA": {
        "x": "-0.04848101781523578090590898720382084",
        "y": "0.67142308149718838830534665356761823",
        "w": "1.3876788125863967e-13",
        "period": 784,
        "turned": 134,
        "alt": "A's spirals again, inside A's own copy and turned by 134 degrees, their "
        "smooth fields now grained with finer filigree.",
    },
    "AB": {
        "x": "-0.04848098911754255814904710902389903",
        "y": "0.67142307507264977946066054203043301",
        "w": "4.664749464542912e-12",
        "period": 504,
        "turned": 134,
        "alt": "B's cross and its copy again, inside A's copy and turned by 134 degrees, "
        "the blue fields grained with finer filigree.",
    },
    "BA": {
        "x": "-0.79658390622656352414119250317177613",
        "y": "0.18364103042075131818520349951684389",
        "w": "2.487866381089557e-11",
        "period": 504,
        "turned": 52,
        "alt": "A's spirals again, inside B's copy and turned by 52 degrees, with finer "
        "filigree grained through the smooth fields.",
    },
    "BB": {
        "x": "-0.79658432800273572645421705275026704",
        "y": "0.18363575208568885608713189736359006",
        "w": "8.363083203246127e-10",
        "period": 324,
        "turned": 52,
        "alt": "B's cross and copy again, inside B's own copy and turned by 52 degrees, "
        "its fields grained with finer filigree.",
    },
}


@dataclass(frozen=True)
class Misiurewicz:
    """One point: where it is, where its orbit lands, and the similarity at it."""

    x: str
    y: str
    degree: int
    #: The orbit first lands on its cycle at z_k, a cycle of period p.
    k: int
    p: int
    #: The power of ρ that aligns the pair, |λρ^m|, and arg(λρ^m) in degrees: the
    #: rotation the pair is left with.
    m: int
    scale: float
    rotation: float
    #: The turn the correlation found, in degrees, and its peak r.
    measured: float
    agreement: float
    #: The M panel's width; the J panel's is `scale` times it.
    width: str
    #: The row's colouring: one map to a row, one colouring across its three panels.
    colour: str
    #: What each panel shows, for its alt text: the whole Julia set, its zoom, and the
    #: parameter plane's zoom.
    whole: str
    likeness: str
    shape: str
    #: The whole-Julia panel's width, centred at 0: the Julia home's 3 unless the set
    #: runs off the frame there.
    home: str = "3"

    def short(self) -> str:
        """c as a reader reads it: four places, real minus signs."""

        def four(text: str) -> str:
            return f"{abs(float(text)):.4f}"

        re = ("−" if self.x.startswith("-") else "") + four(self.x)
        sign = "−" if self.y.startswith("-") else "+"
        return f"c = {re} {sign} {four(self.y)}i"

    def julia_width(self) -> str:
        return f"{self.scale * float(self.width):.5g}"


#: One colouring to a row: the figure's pass, `scale=absolute` at period 0.5, in the
#: row's own map. Three maps so that the rows read as three places; Matt picks the maps.
def _colour(name: str) -> str:
    return COARSE.replace("p=glowdon", f"p={quote(name, safe='')}")


MISIUREWICZ = (
    # M(4,1) of the Mandelbrot set, where three arms of the 1/3 limb meet.
    Misiurewicz(
        "-0.1010963638456221610257854",
        "0.9562865108091415007710961",
        2,
        4,
        1,
        0,
        0.803354,
        -21.88,
        -21.70,
        0.950,
        "3e-3",
        _colour("High Cyan, Low Gold"),
        "a thin branching curve of pale filigree lying on a diagonal, ringed by bands of "
        "cyan, orange and green",
        "the same three-armed junction, turned about 22 degrees, its arms studded with "
        "six-pointed stars",
        "three arms of filigree meeting at the center, each studded with six-pointed stars, "
        "over dark green",
        # At the home's 3 the set runs off the frame's top and bottom edges: it reaches
        # |Im z| 1.11, and a 16:9 frame holds that with a margin from 4.4 across. 3.6, the
        # first ask, still clipped both tips.
        home="4.4",
    ),
    # Degree 3: B = M(4,1) at 0.6578512382 + 0.5005407815i (|ρ| 1.33), carried into the
    # period-25 copy at -0.6352281642333385081490412669827353703653
    # + 0.6451971639494240000173174432003595722745i (|s| 5.22e-14).
    Misiurewicz(
        "-0.6352281642333808681320495886221720723227",
        "0.6451971639494320595845265674548798440034",
        3,
        76,
        25,
        0,
        1.05600,
        -1.06,
        -2.15,
        0.790,
        "5.2e-16",
        _colour("Orchid Furnace"),
        "a thin branching curve of magenta filigree inside a dark halo on pale pink",
        "a branching chain of magenta filigree with spiral knots along it, over plain "
        "magenta fields",
        "the same chain almost line for line, with small dark copies of the set in its "
        "knots and a larger black one at the right edge",
    ),
    # Degree 4: B = M(4,1) at 0.0110987848 + 0.8573524529i (|ρ| 1.33), carried into the
    # period-19 copy at 0.3261226732769855817858158047731364348231
    # + 1.1187243018613302414634701202642722569353i (|s| 1.98e-14).
    Misiurewicz(
        "0.3261226732769710318848390308533958858192",
        "1.1187243018613215064422951991895119177729",
        4,
        58,
        19,
        3,
        2.08028,
        -2.09,
        -2.95,
        0.778,
        "2e-16",
        _colour("Coral Tideline"),
        "a thin branching cross of filigree over bands of brown and cream",
        "a dense web of filigree full of small spirals, between smooth fields of cream and brown",
        "the same web, with small black copies of the set scattered through it",
    ),
)


def _descents() -> tuple[Frame, ...]:
    """A and B, then the four two-step descents: AA, AB, BA, BB, in that order."""
    period = float(dict(part.split("=") for part in COARSE.split("&"))["period"])
    frames = []
    for name in ("A", "B"):
        place = DESCENT_PLACES[name]
        frames.append(
            Frame(
                place["x"],
                place["y"],
                place["w"],
                COARSE,
                name,
                note=f"period {place['period']}, {_wide(place['w'])}",
                alt=place["alt"],
            )
        )
    for pair, twin in DESCENT_TWINS.items():
        # A twin's escape counts are about p_A times its source's, so under a log colouring
        # it is its source's picture shifted by ln p_A: taking that back off the phase puts
        # the twin in its source's colors.
        outer = DESCENT_PLACES[pair[0]]["period"]
        shift = (-math.log(outer) / period) % 1.0
        frames.append(
            Frame(
                twin["x"],
                twin["y"],
                twin["w"],
                COARSE.replace("&scale=", f"&phase={shift:.4f}&scale="),
                f"{pair[0]} then {pair[1]}",
                note=f"period {twin['period']}, {_wide(twin['w'])}, turned {twin['turned']}°",
                alt=twin["alt"],
            )
        )
    return tuple(frames)


def _row(point: Misiurewicz) -> tuple[Frame, Frame, Frame]:
    """The whole Julia set centred at 0 at the point's `home` width, that set zoomed in at
    c, and the parameter plane zoomed in at c."""
    here = point.short()
    c = (point.x, point.y)
    degree = "" if point.degree == 2 else f", degree {point.degree}"
    return (
        Frame(
            "0",
            "0",
            point.home,
            point.colour,
            "Julia set",
            note=f"{here}{degree}",
            julia=c,
            degree=point.degree,
            alt=f"The whole Julia set for {here}{degree}: {point.whole}.",
        ),
        Frame(
            point.x,
            point.y,
            point.julia_width(),
            point.colour,
            "Julia set, zoomed",
            note=_wide(point.julia_width()),
            julia=c,
            degree=point.degree,
            alt=f"That Julia set zoomed in at c: {point.likeness}.",
        ),
        Frame(
            point.x,
            point.y,
            point.width,
            point.colour,
            "Parameter plane",
            note=_wide(point.width),
            degree=point.degree,
            alt=f"The parameter plane zoomed in at c: {point.shape}.",
        ),
    )


FIGURES = {
    "deep-f64-and-perturbation": Figure(
        (
            Frame(
                *TARGET,
                K2,
                OPENING,
                "Double precision",
                f64=True,
                alt="The frame computed in double precision: horizontal bars and flat blocks "
                "of color where neighboring pixels round to the same coordinate, with the "
                "shapes of the true picture only roughly visible through them.",
            ),
            Frame(
                *TARGET,
                K2,
                OPENING,
                "Perturbation",
                alt="The same frame computed by perturbation: fine spirals and filigree in "
                "navy, blue, and white, sharp down to the pixel.",
            ),
        ),
        2,
        (960, 540),
        2,
        "the video's target at its keyframe k2, 1.4e-14 wide",
    ),
    "deep-final-colorings": Figure(
        tuple(
            Frame(*TARGET, FINAL, colour, label, alt=FINAL_ALTS[label])
            for label, colour in FINAL_COLOURINGS
        ),
        2,
        (960, 540),
        2,
        "the video's final frame, 3.5e-15 wide at cap 63534, under four colourings of its "
        "field; the links are FINAL_COLOURINGS'",
    ),
    "deep-shallow-and-deep": Figure(
        (
            Frame(
                *KNOT,
                "1e-12",
                SHALLOW,
                "Shallow",
                note=_wide("1e-12"),
                alt="A frame at the same center 10⁻¹² wide: two spirals joined in an S by chains "
                "of cream and orange filigree over broad smooth fields of dark red and black, the "
                "center on a small four-armed knot where the chains meet.",
            ),
            Frame(
                *KNOT,
                "2.2944996147726803e-17",
                "n=66636&" + COALGLOW,
                "Deep",
                note=_wide("2.2944996147726803e-17"),
                alt="The deep frame at the center of the shallow one: rings of small curled "
                "spirals around a dark eye, in rust, cream and black, with a field of finer "
                "filigree at lower left.",
            ),
        ),
        2,
        (960, 540),
        2,
        "the deep frame deep_zoom_edits_ckpt145 names, 2.3e-17 wide, and the shallow frame "
        "PLACE_deep_zoom_v3_ckpt145 names, the same centre 1e-12 wide in a colouring of its "
        "own",
    ),
    "deep-descent-rungs": Figure(
        (
            Frame(
                "-0.5",
                "0",
                "3",
                RUNGS,
                "Whole set",
                note="width 3",
                alt="The whole Mandelbrot set, black on banded color.",
            ),
            Frame(
                *NUCLEUS_27,
                "0.05",
                RUNGS,
                "Seahorse valley",
                note="width 0.05",
                alt="The seahorse valley between the main cardioid and the large disk, "
                "centered on a copy too small to see.",
            ),
            Frame(
                *NUCLEUS_27,
                "1.94e-5",
                RUNGS,
                "Period 27",
                note=_wide("1.94e-5"),
                alt="A small copy of period 27, a black speck ringed with filigree.",
            ),
            Frame(
                *NUCLEUS_54,
                "2e-6",
                RUNGS,
                "Period 54",
                note=_wide("2e-6"),
                alt="The copy's own large disk, of period 54, with the filigree around it.",
            ),
            Frame(
                *NUCLEUS_972,
                "5e-8",
                RUNGS,
                "Period 972",
                note=_wide("5e-8"),
                alt="The edge of the period-54 disk, lined with its tiny satellite bulbs, the one "
                "of period 972 at the center, under a band of filigree.",
            ),
            Frame(
                *THREADS,
                RUNGS,
                "Last step",
                note=_wide(THREADS[2]),
                alt="The last frame, about a billionth wide: a tiny copy among dense spirals "
                "in purple and blue.",
            ),
        ),
        2,
        (960, 540),
        2,
        "the S4 descent chain of the wallpaper project's minibrot examples, periods 1, 2, "
        "27, 54 and 972, ending on the place of the threads candidate ca42a73543b6c213",
    ),
    "deep-descent-pairs": Figure(
        _descents(),
        2,
        (960, 540),
        2,
        "two general-gallery seats A and B, each centred on a copy, and the four two-step "
        "descents python -m builder descent builds from them; the constants are "
        "DESCENT_PLACES' and DESCENT_TWINS'",
    ),
    "deep-misiurewicz-pairs": Figure(
        tuple(frame for point in MISIUREWICZ for frame in _row(point)),
        3,
        (960, 540),
        2,
        "three Misiurewicz points, one of degree 2 at 3e-3 and tuned ones of degrees 3 and "
        "4 at 5.2e-16 and 2e-16, each row the whole Julia set centred at 0 at width 3 (4.4 "
        "for the degree-2 point, whose set runs off the frame at 3), that set "
        "zoomed in at c at Tan Lei's scale, and the parameter plane zoomed in at c; the "
        "constants are MISIUREWICZ's",
    ),
}

#: Each figure's words for its registry row: the whole-figure alt, and the caption, which
#: is the placeholder's own.
WORDS = {
    "deep-f64-and-perturbation": (
        "One deep frame drawn twice, in double precision and by perturbation.",
        "The same deep frame computed in double precision (left), where the picture breaks "
        "into flat blocks because neighboring pixels round to the same coordinate, and "
        "computed by perturbation (right).",
    ),
    "deep-final-colorings": (
        "The video's final frame four times over: its absolute coloring, the leveled "
        "scale, a longer period, and another palette.",
        "The video's final frame under several colorings of the same field.",
    ),
    "deep-shallow-and-deep": (
        "A shallow frame and a deep frame at its center.",
        "A shallow frame (left) and a deep frame inside it (right): a region that is smooth "
        "at the shallow depth fills with detail further down.",
    ),
    "deep-descent-rungs": (
        "Six frames down one descent, from the whole set to a frame about a billionth wide.",
        "Six steps down one descent, each frame centered on the next component in a chain "
        "nested one inside the next. Filigree from each copy appears in regions that were "
        "smooth one step earlier.",
    ),
    "deep-descent-pairs": (
        "Two deep frames, A and B, each centered on a copy, and the four two-step descents "
        "built from them.",
        "Two frames, A and B (top), each centered on a minibrot, and the four two-step "
        "descents built from them: A then A, A then B, B then A, and B then B.",
    ),
    "deep-misiurewicz-pairs": (
        "Three rows at three Misiurewicz points, each the whole Julia set, that Julia set "
        "zoomed in at the point, and the parameter plane zoomed in at the same point.",
        "Three Misiurewicz points: one shallow on the Mandelbrot set (top) and two deep on "
        "the degree-3 and degree-4 multibrots. Each row shows the whole Julia set for the "
        "point's c (left), that Julia set zoomed in at the point (middle), and that row's "
        "Mandelbrot or multibrot set zoomed in at the same point (right). The two zooms "
        "agree up to a fixed scale and rotation.",
    ),
}

#: What each figure's deep panels were drawn as, between `draw` and `keep`.
_DRAWN: dict[str, dict[int, Drawn]] = {}


def _key(identifier: str, index: int) -> str:
    from . import recipes

    return f"{recipes.DEEP}{recipes.SEPARATOR}{identifier}#{index}"


def draw(identifier: str) -> Split:
    """Every panel of one figure, lossless in `artifacts/`; `--place` encodes them.

    The deep panels are drawn first, because an f64 panel is drawn at its perturbation
    twin's settled cap: the two pictures then differ in the arithmetic and nothing else.
    """
    from . import renders

    figure = FIGURES[identifier]
    width, height = figure.size
    ss = figure.supersample
    drawn = {
        index: draw_link(frame.link(), width, height, ss, identifier)
        for index, frame in enumerate(figure.frames, start=1)
        if not frame.f64
    }
    _DRAWN[identifier] = drawn
    lines = [
        f"builder.deep_figures:draw — {figure.about}. Every panel {width}x{height}, "
        f"supersample {ss}, drawn in {_maps(figure)} under the scale each panel's "
        "line names. A Deep-tab "
        "panel is its link, held in article/figure-recipes.jsonl under deep|<figure id>#<panel>: "
        "its field drawn by zoom_fields.mjs on the committed perturb.wasm and coloured by "
        "deep_gallery_shade.mjs through engine.wasm, exactly as the Deep tab draws the link.",
    ]
    made: list[Made] = []
    for index, frame in enumerate(figure.frames, start=1):
        target = panel_path(identifier, index)
        if frame.f64:
            cap = next(iter(drawn.values())).maxiter
            spec = _f64_spec(frame, cap)
            full = dict(spec, resolution=[width, height], supersample=ss)
            # `renders.render` skips on the path alone, so the path carries the spec: a
            # recolour keyed on the grid alone came back in the old map.
            key = hashlib.sha256(json.dumps(full, sort_keys=True).encode("utf-8")).hexdigest()
            out = renders.default_cache_root() / "deep-f64" / f"{identifier}_{key[:16]}.png"
            target.write_bytes(Path(renders.render(full, out)).read_bytes())
            made.append(Made(target, frame.alt, label=frame.label, note=frame.note, spec=spec))
            lines.append(
                f"panel {index}, {frame.label}: fractal-engine render, family mandelbrot, "
                f"centre {frame.x} + {frame.y}i, width {frame.w}, mode smooth, palette "
                f"{_colour_words(frame.colour)}, maxiter {cap} (the perturbation panel's "
                "settled cap, so the two differ only in arithmetic), allow_unresolvable_in_f64 "
                "true, the engine's opt-in past its f64 floor. The explorer refuses this frame "
                "rather than drawing the arithmetic, so the panel carries no link."
            )
            continue
        one = drawn[index]
        target.write_bytes(one.path.read_bytes())
        key = _key(identifier, index)
        made.append(Made(target, frame.alt, label=frame.label, note=frame.note, deep=key))
        family = "family julia" if frame.julia else "family mandelbrot"
        if frame.degree != 2:
            family = f"family {'julia' if frame.julia else 'multibrot'}, degree {frame.degree}"
        if frame.julia:
            family += f", c = {frame.julia[0]} + {frame.julia[1]}i"
        cap = "named by the link" if "n=" in frame.colour else "settled by the tab's own probe"
        lines.append(
            f"panel {index}, {frame.label}: Deep tab, {family}, centre {frame.x} + {frame.y}i, "
            f"width {frame.w}, cap {one.maxiter} {cap}, palette "
            f"{_colour_words(frame.colour)}; recipe {key}"
        )
    return Split(made, lines, figure.columns)


def _parts(colour: str) -> dict[str, str]:
    """A colouring's keys, each value as it reads rather than as a link escapes it."""
    return {key: unquote(value) for key, value in (p.split("=") for p in colour.split("&"))}


def _colour_words(colour: str) -> str:
    """The palette pass in words, map first: `palette` and never `colormap`, which the
    figure's header line spends once."""
    parts = _parts(colour)
    shade = "".join(f"{key} {parts[key]}, " for key in ("gamma", "cycles", "phase") if key in parts)
    return (
        f"{parts['p']} {shade}scale {parts.get('scale', 'leveled')}, "
        f"lambda {parts['lambda']}, period {parts['period']}"
    )


def _maps(figure: Figure) -> str:
    """The maps a figure is drawn in, each after the word `colormap`: one colouring to a
    figure, so one map, except `deep-misiurewicz-pairs`, which has one to a row."""
    names = list(dict.fromkeys(_parts(frame.colour)["p"] for frame in figure.frames))
    if len(names) == 1:
        return f"colormap {names[0]}"
    words = [f"colormap {name}" for name in names]
    return f"{', '.join(words[:-1])} and {words[-1]}, one to a row,"


def _f64_spec(frame: Frame, cap: int) -> dict:
    """The engine render spec an f64 panel is drawn from, colouring spelled as the link's."""
    parts = _parts(frame.colour)
    phase = {"phase": float(parts["phase"])} if "phase" in parts else {}
    return {
        "family": {"kind": "mandelbrot"},
        "viewport": {"center_re": frame.x, "center_im": frame.y, "width": frame.w},
        "mode": "smooth",
        "colormap": parts["p"],
        "palette": {
            **phase,
            "scale": parts["scale"],
            "lambda": float(parts["lambda"]),
            "period": float(parts["period"]),
        },
        "maxiter": cap,
        "allow_unresolvable_in_f64": True,
    }


def keep(identifier: str) -> None:
    """Write one figure's deep rows into `article/figure-recipes.jsonl`, as it is landed."""
    from . import recipes

    figure = FIGURES[identifier]
    recipes.keep_deep(
        {
            _key(identifier, index): {
                "link": one.link,
                "resolution": list(figure.size),
                "supersample": figure.supersample,
                "maker": "builder.deep_figures:draw",
            }
            for index, one in _DRAWN[identifier].items()
        }
    )


def recipe(identifier: str) -> dict:
    if identifier not in FIGURES:
        raise DeepFigureError(f"{identifier} is not drawn by builder.deep_figures")
    return {"maker": f"{__name__}:draw", "args": {"id": identifier}}
