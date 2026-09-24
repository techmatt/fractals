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

Every panel is `scale=absolute`: the frame's own percentile stretch spends the palette on a
few percent of a deep frame's range (the prose says so, and the figure after the video is
about it). `lambda` and `period` are chosen per figure and written into the link, which is
where the recipe records them. Panels of one strip share one colouring, so that one colour
means one escape count across the strip, the way the video's frames do.
"""

from __future__ import annotations

import hashlib
import json
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path

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

#: Two colourings, each one `scale=absolute` function of the smooth count. The finer
#: period is the one the page's own Deep-tab link carries; the coarser one bands less on
#: frames whose counts are tens rather than tens of thousands.
FINE = "p=glowdon&scale=absolute&lambda=0&period=0.25"
COARSE = "p=glowdon&scale=absolute&lambda=0&period=0.5"

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
#: link (deep_zoom_edits_ckpt145). The shallow frame shares its centre and its colouring.
KNOT = ("-0.7493705324700378557700614606921816", "0.0414726670681690448763936935919414")
COALGLOW = "p=Coalglow&phase=0.617&scale=absolute&lambda=0.04&period=0.596"

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

    def link(self) -> str:
        c = f"cx={self.julia[0]}&cy={self.julia[1]}&" if self.julia else ""
        return f"dv=3&{c}x={self.x}&y={self.y}&w={self.w}&{self.colour}"


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
# At a Misiurewicz point c the critical orbit z_0 = 0, z_{n+1} = z_n² + c lands on a
# repelling cycle of period p with multiplier ρ. A Julia offset d at z_1 = c reaches
# a_n·d at z_n, where a_n = ∂z_n/∂z_1, and a parameter offset e reaches b_n·e, where
# b_n = ∂z_n/∂c; both land in the same neighbourhood of the cycle. So M at c + e looks like
# J_c at c + λe, λ = lim b_n/a_n — Tan Lei's similarity, derived rather than fitted. J_c is
# self-similar about c by ρ as well, so λρ^m aligns the two for every integer m: m is
# chosen to leave the least rotation, since the explorer draws no rotation. The J panel's
# width is |λρ^m| times the M panel's, and arg(λρ^m) is the rotation left over.
#
# Each c is Newton-solved to 25 places in mpmath; λ and ρ come from the same orbit. A
# numerical check (log smooth count at 20,000 random offsets, correlated between the two
# planes over a grid of ±10% scale and ±6° rotation) put its maximum on the derived value
# for all three.


@dataclass(frozen=True)
class Misiurewicz:
    """One point: where it is, where its orbit lands, and the similarity at it."""

    x: str
    y: str
    #: The orbit first lands on its cycle at z_k, a cycle of period p.
    k: int
    p: int
    #: The power of ρ that aligns the pair, |λρ^m|, and arg(λρ^m) in degrees: the
    #: rotation the pair is left with.
    m: int
    scale: float
    rotation: float
    #: The M panel's width; the J panel's is `scale` times it.
    width: str
    #: What each panel shows, for its alt text.
    shape: str
    likeness: str

    def short(self) -> str:
        """c as a reader reads it: four places, real minus signs."""

        def four(text: str) -> str:
            return f"{abs(float(text)):.4f}"

        re = ("−" if self.x.startswith("-") else "") + four(self.x)
        sign = "−" if self.y.startswith("-") else "+"
        return f"c = {re} {sign} {four(self.y)}i"

    def julia_width(self) -> str:
        return f"{self.scale * float(self.width):.5g}"


MISIUREWICZ = (
    Misiurewicz(
        "-0.7756837680090537974694835",
        "0.1364673682946901247332744",
        24,
        1,
        -10,
        2.97912,
        0.485,
        "2e-5",
        "in the seahorse valley: a spiral arm of filigree winding in to the center over "
        "orange and blue bands",
        "the same spiral, in shifted colors",
    ),
    Misiurewicz(
        "-0.2397161902231344106662341",
        "0.8455033137002887225928533",
        7,
        1,
        0,
        0.892874,
        0.921,
        "1e-4",
        "a jagged chain of filigree branching through the center over blue bands",
        "the same chain, nearly pixel for pixel",
    ),
    Misiurewicz(
        "0.3973918222965411749842944",
        "0.1335112048718776326576995",
        8,
        1,
        -56,
        0.0592612,
        0.929,
        "1e-4",
        "seven arms of filigree radiating from the center, studded with small spirals",
        "the same seven-armed star, in shifted colors",
    ),
)


def _pair(point: Misiurewicz, colour: str) -> tuple[Frame, Frame]:
    here = point.short()
    return (
        Frame(
            point.x,
            point.y,
            point.width,
            colour,
            "Mandelbrot set",
            note=f"{here}, {_wide(point.width)}",
            alt=f"The Mandelbrot set at {here}, {point.shape}.",
        ),
        Frame(
            point.x,
            point.y,
            point.julia_width(),
            colour,
            "Julia set",
            note=_wide(point.julia_width()),
            julia=(point.x, point.y),
            alt=f"The Julia set for that c at the same point: {point.likeness}.",
        ),
    )


FIGURES = {
    "deep-f64-and-perturbation": Figure(
        (
            Frame(
                *TARGET,
                K2,
                FINE,
                "Double precision",
                f64=True,
                alt="The frame computed in double precision: horizontal bars and flat blocks "
                "of color where neighboring pixels round to the same coordinate, with the "
                "shapes of the true picture only roughly visible through them.",
            ),
            Frame(
                *TARGET,
                K2,
                FINE,
                "Perturbation",
                alt="The same frame computed by perturbation: fine spirals and filigree in "
                "blue, orange and pale green, sharp down to the pixel.",
            ),
        ),
        2,
        (960, 540),
        2,
        "the video's target at its keyframe k2, 1.4e-14 wide",
    ),
    "deep-shallow-and-deep": Figure(
        (
            Frame(
                *KNOT,
                "1e-12",
                COALGLOW,
                "Shallow",
                note=_wide("1e-12"),
                alt="A frame at the same center 10⁻¹² wide: broad smooth bands of pale orange "
                "crossed by thin chains of filigree, the center on a small knot where two of them "
                "meet.",
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
        "the deep frame deep_zoom_edits_ckpt145 names, 2.3e-17 wide, and the same centre "
        "zoomed out to 1e-12, the first width going out at which the neighbourhood of the "
        "centre reads as smooth bands",
    ),
    "deep-descent-rungs": Figure(
        (
            Frame(
                "-0.5",
                "0",
                "3",
                COARSE,
                "Whole set",
                note="width 3",
                alt="The whole Mandelbrot set, black on banded color.",
            ),
            Frame(
                *NUCLEUS_27,
                "0.05",
                COARSE,
                "Seahorse valley",
                note="width 0.05",
                alt="The seahorse valley between the main cardioid and the large disk, "
                "centered on a copy too small to see.",
            ),
            Frame(
                *NUCLEUS_27,
                "1.94e-5",
                COARSE,
                "Period 27",
                note=_wide("1.94e-5"),
                alt="A small copy of period 27, a black speck ringed with filigree.",
            ),
            Frame(
                *NUCLEUS_54,
                "2e-6",
                COARSE,
                "Period 54",
                note=_wide("2e-6"),
                alt="The copy's own large disk, of period 54, with the filigree around it.",
            ),
            Frame(
                *NUCLEUS_972,
                "5e-8",
                COARSE,
                "Period 972",
                note=_wide("5e-8"),
                alt="The edge of the period-54 disk, lined with its tiny satellite bulbs, the one "
                "of period 972 at the center, under a band of filigree.",
            ),
            Frame(
                *THREADS,
                COARSE,
                "Last step",
                note=_wide(THREADS[2]),
                alt="The last frame, about a billionth wide: a tiny copy among dense spirals "
                "in orange and blue.",
            ),
        ),
        2,
        (960, 540),
        2,
        "the S4 descent chain of the wallpaper project's minibrot examples, periods 1, 2, "
        "27, 54 and 972, ending on the place of the threads candidate ca42a73543b6c213",
    ),
    "deep-seahorse-valley": Figure(
        (
            Frame(
                *TARGET,
                "0.02",
                FINE,
                "The cleft",
                note="width 0.02",
                alt="The seahorse valley: a narrow cleft between two black bodies, banded in "
                "orange and blue and lined with small bulbs.",
            ),
            Frame(
                *TARGET,
                "0.004",
                FINE,
                "The wall",
                note="width 0.004",
                alt="One wall of the valley close up: bulbs and curled shapes along the edge "
                "of the main cardioid.",
            ),
            Frame(
                *TARGET,
                "0.0009",
                FINE,
                "Spiral and seahorse",
                note="width 0.0009",
                alt="A double spiral of tight rings at upper left and a seahorse's curled "
                "tail below it.",
            ),
        ),
        3,
        (800, 450),
        2,
        "the video's target at three widths inside its first decades",
    ),
    "deep-misiurewicz-pairs": Figure(
        tuple(frame for point in MISIUREWICZ for frame in _pair(point, COARSE)),
        2,
        (960, 540),
        2,
        "three Misiurewicz points, each drawn in the parameter plane and in its own Julia "
        "set's plane at Tan Lei's scale; the constants are MISIUREWICZ's",
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
    "deep-seahorse-valley": (
        "Three frames down the seahorse valley along the video's path.",
        "The seahorse valley along the video's path: the cleft, the double spiral on one "
        "side and the seahorses on the other.",
    ),
    "deep-misiurewicz-pairs": (
        "Three pairs of zooms, each the Mandelbrot set and a Julia set at one Misiurewicz point.",
        "Each pair shows the Mandelbrot set (left) and the Julia set for the parameter at its "
        "center (right), zoomed in at the same point. The two agree up to a fixed scale and "
        "rotation.",
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
        f"supersample {ss}, drawn in colormap {_map(figure)} under scale absolute. A Deep-tab "
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
            out = renders.default_cache_root() / "deep-f64" / f"{identifier}_{width}x{height}.png"
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
        family = (
            f"family julia, c = {frame.julia[0]} + {frame.julia[1]}i"
            if frame.julia
            else "family mandelbrot"
        )
        cap = "named by the link" if "n=" in frame.colour else "settled by the tab's own probe"
        lines.append(
            f"panel {index}, {frame.label}: Deep tab, {family}, centre {frame.x} + {frame.y}i, "
            f"width {frame.w}, cap {one.maxiter} {cap}, palette "
            f"{_colour_words(frame.colour)}; recipe {key}"
        )
    return Split(made, lines, figure.columns)


def _parts(colour: str) -> dict[str, str]:
    return dict(part.split("=") for part in colour.split("&"))


def _colour_words(colour: str) -> str:
    """The palette pass in words, map first: `palette` and never `colormap`, which the
    figure's header line spends once."""
    parts = _parts(colour)
    phase = f"phase {parts['phase']}, " if "phase" in parts else ""
    return (
        f"{parts['p']} {phase}scale {parts['scale']}, lambda {parts['lambda']}, "
        f"period {parts['period']}"
    )


def _map(figure: Figure) -> str:
    """The one map a figure is drawn in: one colouring to a figure, so one map."""
    (name,) = {_parts(frame.colour)["p"] for frame in figure.frames}
    return name


def _f64_spec(frame: Frame, cap: int) -> dict:
    """The engine render spec an f64 panel is drawn from, colouring spelled as the link's."""
    parts = _parts(frame.colour)
    return {
        "family": {"kind": "mandelbrot"},
        "viewport": {"center_re": frame.x, "center_im": frame.y, "width": frame.w},
        "mode": "smooth",
        "colormap": parts["p"],
        "palette": {
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
