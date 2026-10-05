"""Run the pipeline yourself: a worked example of fractal-wallpapers from a fresh install.

    python -m builder.run_it_yourself import <walkthrough> [--readme README.md]
    python -m builder.run_it_yourself page

*(run_it_yourself_page_ckpt161, revised by run_it_yourself_revise_ckpt161.)*
`tools-and-data/run-it-yourself/` walks a reader through the wallpapers README's path, one
section per stage: the stage's sentences, its command blocks, each followed by a closed
"All options" fold holding that command's `--help` from the walkthrough's `help/`, and then
the inspection page that stage's own command wrote, hosted in place. Render one picture
shows the README's two render commands with the pictures and times in `render/`, and a
table of every setting one render takes, read from `parameters.json` and linked into the
article where it explains a family, a mode, or a knob. The README's cost table stays in
the README. **The site draws none of those pages.** `fractal-wallpapers
walkthrough` gathers them into one folder of self-contained bundles, and `import` copies
that folder here byte for byte, under `walkthrough/`, so the page rebuilds without the
clone it came from. The bundles are hosted pages rather than this site's pages:
`paths.HOSTED_DIRS` keeps them out of the head, icon and bar checks, which would otherwise
ask them to carry furniture they cannot carry unchanged, and `check`'s `links` still
resolves every href in them. `.gitattributes` exempts the folder from end-of-line
normalization, because a bundle's JSON may be written with CRLF and a byte rewritten on
commit is a byte changed.

`import` also reads the README once, for the command blocks, and writes
what it read to `builder/data/run-it-yourself.json`; `page` reads that record and the
imported folder and nothing else. The README to read is the one whose numbers describe the
run the walkthrough came from, which can be a commit after the clone that made it: name it
with `--readme`. Like every maker, neither step is part of `build` or `check`.
"""

from __future__ import annotations

import argparse
import hashlib
import html
import json
import re
import shutil
from pathlib import Path

from . import heads, icons
from .escape import attribute, text
from .pages import AUTHOR_SITE, CODE_REPO
from .paths import SITE_ROOT

LF = "\n"
OUT = SITE_ROOT / "tools-and-data" / "run-it-yourself"
HOSTED = OUT / "walkthrough"
RECORD = SITE_ROOT / "builder" / "data" / "run-it-yourself.json"

TITLE = "Run the pipeline yourself"
DESCRIPTION = (
    "A worked example of the fractal-wallpapers pipeline from a fresh install, with sample "
    "output from every stage."
)
FORMATS = f"{CODE_REPO}/blob/main/FORMATS.md"

#: The page's prose, placed verbatim from the prompt; the numbers are the walkthrough run's
#: (its README at the commit `import` read, and `trace/counts.json`). Links are `[words](href)`.
INTRO = [
    "Everything on this site was made by the code in the "
    f"[fractal-wallpapers repository]({CODE_REPO}), and you can run all of it yourself. This "
    "page walks through a fresh install on one machine and shows a small sample of what each "
    "stage writes, so you can check your own run against it. I ran each stage for about ten "
    "minutes. That is enough to see every file and a first small gallery, but nowhere near "
    "enough to find many good wallpapers.",
    "You do not need a GPU. The judges run several times faster with one, but most of the "
    "time goes to rendering, which runs on the CPU either way. The whole example takes about "
    "45 minutes on a CPU install and about 27 with CUDA, and leaves about 1.1 GB on disk.",
    "The pages embedded below are the ones the repository's own commands write, taken from "
    "my run. Follow one picture, at the end, traces the twelve pictures of the final gallery "
    "back through every file, along with a few that were rejected along the way. Each file's "
    f"fields are defined in [FORMATS.md]({FORMATS}) in the repository.",
]

#: One stage a section, in pipeline order: heading, its sentences (`lead` before the
#: commands, `after` between them and the bundle), the README's steps whose command blocks
#: it shows (`install` is the Install section's), and the bundle it hosts. The numbers are
#: the walkthrough run's: 4,022 places is `stats.json`'s `places`, and 327 and 109 are the
#: README's step 5.
STAGES = [
    {
        "heading": "Install",
        "lead": [
            "The code is Rust and Python. The Rust engine draws every picture, and you can "
            "build and use it alone if rendering is all you want. Python runs the pipeline "
            "around it and the judges, which are neural networks in PyTorch.",
            "The CPU and CUDA installs differ only in which PyTorch they pull.",
        ],
        "steps": ["install"],
    },
    {
        "heading": "Render one picture",
        "lead": [
            "One command draws one picture from a family, a view, a rendering mode, and a palette."
        ],
        "steps": ["1"],
        "render": True,
    },
    {
        "heading": "Check your install",
        "lead": [
            "This renders eight fixed pictures and compares them to mine, then scores them "
            "with all four judges and compares the scores. It also shows how long each render "
            "took on my machine and on yours. If the pictures and the numbers match, your "
            "install matches mine."
        ],
        "steps": ["2"],
        "bundle": "judges-check",
    },
    {
        "heading": "Walk for locations",
        "lead": [
            "The walk explores each fractal family for a fixed amount of time and records "
            "the places it finds, and the location judge then scores each place. No two "
            "walks find the same places.",
            "In my run, ten minutes of walking found 4,022 places, and ten minutes of mining "
            "made 327 candidate pictures from the best 109 of them. Only 2 of those pictures "
            "were good enough for the gallery at its usual standard.",
        ],
        "steps": ["3"],
        "bundle": "walk-stats",
        "whole": ["summary.json", "stats.json"],
    },
    {
        "heading": "Mine candidates",
        "lead": [
            "Mining takes the best-scoring places, tries rendering modes and palettes on "
            "each, and keeps the pictures the wallpaper judge likes."
        ],
        "steps": ["4", "5"],
        "bundle": "candidates",
    },
    {
        "heading": "Grade and solve a gallery",
        "lead": [
            "The gallery judge grades the candidates, and the solve picks a set that is "
            "good and varied. After ten minutes of mining only a couple of pictures meet the "
            "gallery's usual standard, so for the gallery shown here I told it to ignore that "
            "standard and take the twelve best pictures it had."
        ],
        "steps": ["6", "7", "8"],
        "bundle": "gallery",
        "whole": ["keep.jsonl"],
    },
    {
        "heading": "Continue from your own pool",
        "lead": [
            "Every later run adds to the same collection of candidates. Merging new ones in "
            "also throws out the weakest, but never a picture in a gallery you have saved."
        ],
        "steps": ["9"],
    },
    {
        "heading": "Follow one picture",
        "lead": ["Here is one gallery picture as it appears in each file."],
        "steps": ["10"],
        "bundle": "trace",
    },
]

#: Render one picture's second sentence, between its two commands.
RENDER_LINK = (
    "Every picture on this site and in Mandelnaut Explorer carries a link that holds its "
    "whole recipe. This command reads the link's text and draws the same picture on your "
    "machine, at any size, without going online."
)

#: Alt text for `render/`'s pictures, by `render.json`'s name. Written by looking at them,
#: so a re-export that draws a different view owes a new line here.
RENDER_ALT = {
    "render": (
        "A whole Julia set in stripe mode: a band of spirals and starbursts across the "
        "center, with streaming stripes above and below."
    ),
    "render-link": (
        "A Julia set in the tia mode: clusters of glowing red points among teal fronds, in "
        "the Oxblood, Cyan, Cream palette."
    ),
}

ARTICLE = "../../article"

#: Where the site introduces each family `parameters.json` names.
FAMILY_HREF = {
    "mandelbrot": "escape-time-fractals.html#the-mandelbrot-set",
    "multibrot": "escape-time-fractals.html#multibrot-sets",
    "julia": "escape-time-fractals.html#julia-sets",
    "phoenix": "escape-time-fractals.html#phoenix-fractals",
    "phoenix_m": "escape-time-fractals.html#phoenix-fractals",
    "fractional_multibrot": "escape-time-fractals.html#fractional-degrees",
}

#: Each mode's own section of Rendering modes; a mode the page names under no heading of
#: its own links to the page.
MODES_PAGE = "rendering-modes.html"
MODE_SECTION = {
    "tia": "fields-from-the-orbits-path",
    "stripe": "fields-from-the-orbits-path",
    "curvature": "fields-from-the-orbits-path",
    "gaussian_int": "orbit-traps",
    "trap_circle": "orbit-traps",
    "smooth_mean_angle": "blending-modes-together",
    "smooth_angle_min": "blending-modes-together",
    "smooth_trap_circle": "blending-modes-together",
    "smooth_stripe": "blending-modes-together",
    "smooth_curvature": "blending-modes-together",
    "threads": "blending-modes-together",
    "itinerary": "the-itinerary-mode",
    "tail_itinerary": "the-itinerary-mode",
    "direct_trap_ring": "direct-traps",
    "direct_trap_screen": "direct-traps",
    "direct_trap_multiply": "direct-traps",
    "direct_trap_lines": "direct-traps",
    "de": "beyond-this-catalog",
}
MODE_PAGE_ONLY = {"smooth", "exp_smoothing"}

#: The frame's settings, in the table's words, and where the site explains one.
FRAME = {
    "center_re": ("view center, real part", None),
    "center_im": ("view center, imaginary part", None),
    "width": ("view width", None),
    "resolution": ("size", None),
    "supersample": ("supersampling", "rendering-fundamentals.html#supersampling"),
    "maxiter": ("iteration cap", "rendering-fundamentals.html#iteration-caps"),
}

#: The palette knobs Color palettes explains.
KNOB_HREF = {
    knob: "color-palettes.html#applying-a-palette" for knob in ("gamma", "cycles", "phase")
}

#: The whole files the walkthrough carries beside its bundles: the command that writes
#: each, and its section of FORMATS.md.
WHOLE = {
    "summary.json": ("fractal-wallpapers harvest", "walkjsonl"),
    "stats.json": ("fractal-wallpapers harvest stats", "locationsjsonl"),
    "keep.jsonl": ("fractal-wallpapers curate solve record", "keepjsonl"),
}

#: FORMATS.md's section for each JSON file a bundle carries.
SECTIONS = {
    "page.json": "pagejson",
    "counts.json": "countsjson",
    "gallery.jsonl": "galleryjsonl",
    "manifest.json": "manifestjson",
    "rows.jsonl": "candidate-ledger-rows",
    "scores.jsonl": "candidate-ledger-scores",
    "flatness.jsonl": "candidate-ledger-flatness",
    "pool_scores.jsonl": "pool_scoresjsonl",
    "supply_scores.jsonl": "supply_scoresjsonl",
    "locations.jsonl": "locationsjsonl",
    "walk.jsonl": "walkjsonl",
}

#: The order the trace's slices are listed in: the walk's row first, the gallery's last.
TRACE_ORDER = [
    "walk.jsonl",
    "supply_scores.jsonl",
    "locations.jsonl",
    "rows.jsonl",
    "scores.jsonl",
    "flatness.jsonl",
    "pool_scores.jsonl",
    "gallery.jsonl",
    "manifest.json",
]


class RunItYourselfError(RuntimeError):
    pass


# ---------------------------------------------------------------------------- import


def _readme(readme: str) -> dict[str, list[str]]:
    """The README's command blocks, by step."""
    lines = readme.split("\n")
    blocks: dict[str, list[str]] = {}
    step = None
    fence: list[str] | None = None
    for line in lines:
        if fence is not None:
            if line.startswith("```"):
                if step is not None:
                    blocks.setdefault(step, []).append(LF.join(fence))
                fence = None
            else:
                fence.append(line)
            continue
        if line.startswith("```"):
            fence = []
            continue
        if line.startswith("## "):
            step = "install" if line == "## Install" else None
        elif line.startswith("### "):
            step = None
        elif numbered := re.match(r"\*\*(\d+)\. ", line):
            step = numbered.group(1)
    return blocks


def import_walkthrough(source: Path, readme_path: Path, readme_from: str) -> None:
    if not (source / "walkthrough.json").is_file():
        raise RunItYourselfError(f"{source}: no walkthrough.json — not a walkthrough folder")
    readme = readme_path.read_bytes()
    blocks = _readme(readme.decode("utf-8"))
    for stage in STAGES:
        for step in stage["steps"]:
            if step not in blocks:
                raise RunItYourselfError(f"the README has no command block for step {step}")
    for name in ("render/render.json", "parameters.json", "help"):
        if not (source / name).exists():
            raise RunItYourselfError(f"{source}: no {name} — a walkthrough from before ckpt161")
    if HOSTED.exists():
        shutil.rmtree(HOSTED)
    shutil.copytree(source, HOSTED, copy_function=shutil.copy2)
    files = sorted(path for path in HOSTED.rglob("*") if path.is_file())
    size = sum(path.stat().st_size for path in files)
    for path in files:
        if path.read_bytes() != (source / path.relative_to(HOSTED)).read_bytes():
            raise RunItYourselfError(f"{path}: not the byte-for-byte copy of its source")
    record = {
        "schema": 2,
        "readme": {"read": readme_from, "sha256": hashlib.sha256(readme).hexdigest()},
        "blocks": blocks,
    }
    RECORD.write_text(
        json.dumps(record, indent=2, ensure_ascii=False) + LF, encoding="utf-8", newline=LF
    )
    print(f"imported {len(files)} files, {size / 1e6:.2f} MB, into {HOSTED.relative_to(SITE_ROOT)}")
    for folder in sorted(path for path in HOSTED.iterdir() if path.is_dir()):
        own = sum(p.stat().st_size for p in folder.rglob("*") if p.is_file())
        print(f"  {folder.name}: {own / 1e6:.2f} MB")


# ---------------------------------------------------------------------------- page


def _inline(words: str) -> str:
    """Prose with `[words](href)` links and `code` spans, escaped."""
    out, at = [], 0
    for found in re.finditer(r"\[([^\]]+)\]\(([^)]+)\)|`([^`]+)`", words):
        out.append(text(words[at : found.start()]))
        if found.group(3) is not None:
            out.append(f"<code>{text(found.group(3))}</code>")
        else:
            out.append(f'<a href="{attribute(found.group(2))}">{text(found.group(1))}</a>')
        at = found.end()
    out.append(text(words[at:]))
    return "".join(out)


def _slug(heading: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", heading.lower()).strip("-")


def _commands(block: str) -> list[str]:
    """A command block's commands, each with its continuation lines."""
    out: list[str] = []
    joining = False
    for line in block.split(LF):
        if joining:
            out[-1] += LF + line
        else:
            out.append(line)
        joining = line.rstrip().endswith("\\")
    return out


def _program(command: str) -> tuple[str, str] | None:
    """A command's program and subcommand as typed, and its `help/` file, or None."""
    words = command.split("#")[0].split()
    for at, word in enumerate(words):
        name = word.rsplit("/", 1)[-1]
        if name in ("fractal-wallpapers", "fractal-engine"):
            sub = []
            for rest in words[at + 1 :]:
                if rest.startswith(("-", "<", "\\")):
                    break
                sub.append(rest)
            if not sub:
                continue  # a clone URL or a directory, not a command
            typed = " ".join([name, *sub])
            stem = "-".join(sub if name == "fractal-wallpapers" else [name, *sub])
            return typed, f"{stem}.txt"
    return None


def _block(block: str) -> str:
    return f"<pre><code>{html.escape(block, quote=False)}</code></pre>"


def _options(typed: str, help_file: str, titled: bool) -> str:
    path = HOSTED / "help" / help_file
    if not path.is_file():
        raise RunItYourselfError(f"{path}: no --help transcript for {typed}")
    summary = f"All options for <code>{text(typed)}</code>" if titled else "All options"
    body = path.read_text(encoding="utf-8").rstrip(LF)
    return LF.join(
        [
            '<details class="fold">',
            f"<summary>{summary}</summary>",
            _block(body),
            "</details>",
        ]
    )


def _blocks_with_options(blocks: list[str]) -> list[str]:
    """Each command block, then a closed fold of every command's `--help` under it."""
    helped = [_program(c) for block in blocks for c in _commands(block)]
    titled = len({one for one in helped if one}) > 1
    out = []
    for block in blocks:
        out.append(_block(block))
        seen = []
        for command in _commands(block):
            found = _program(command)
            if found and found not in seen:
                seen.append(found)
                out.append(_options(*found, titled))
    return out


def _href(target: str) -> str:
    """A link into the article, held to an id the page actually carries."""
    page, _, fragment = target.partition("#")
    source = SITE_ROOT / "article" / page
    if fragment and f'id="{fragment}"' not in source.read_text(encoding="utf-8"):
        raise RunItYourselfError(f"article/{page} has no #{fragment}")
    return f"{ARTICLE}/{target}"


def _a(words: str, target: str | None) -> str:
    if target is None:
        return text(words)
    return f'<a href="{attribute(_href(target))}">{text(words)}</a>'


def _mode_target(name: str) -> str:
    if name in MODE_PAGE_ONLY:
        return MODES_PAGE
    if name not in MODE_SECTION:
        raise RunItYourselfError(f"mode {name!r} has no place on Rendering modes in this maker")
    return f"{MODES_PAGE}#{MODE_SECTION[name]}"


def _number(value) -> str:
    if isinstance(value, bool):
        return "on" if value else "off"
    if value is None:
        return "none"
    if isinstance(value, list):
        return " ".join(_number(one) for one in value)
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value)


def _fold_cell(summary: str, items: list[str]) -> str:
    return f"<details><summary>{summary}</summary>{', '.join(items)}</details>"


def _parameters(params: dict) -> str:
    """Everything a reader can set on one render, from `parameters.json` alone."""
    flags = {entry["dest"]: entry for entry in params["flags"]}
    families = params["families"]
    rows: list[tuple[str, str, str, str]] = []

    def flag_of(dest: str) -> str:
        return f"<code>{text(flags[dest]['flag'])}</code>" if dest in flags else "spec only"

    family_values = []
    for name, family in families.items():
        line = _a(name, FAMILY_HREF[name])
        if not family["flag"]:
            line += " (spec only)"
        family_values.append(line)
    rows.append(
        (
            _a("family", "escape-time-fractals.html#the-projects-families"),
            flag_of("family"),
            ", ".join(family_values),
            text(flags["family"]["default"]),
        )
    )
    rows.append(
        (
            "degree",
            flag_of("degree"),
            "<br>".join(f"{text(name)}: {text(f['degree'])}" for name, f in families.items()),
            text(_number(flags["degree"]["default"])),
        )
    )
    for constant in ("c", "p", "z_prev"):
        uses = []
        for name, family in families.items():
            for take in family["takes"]:
                said = re.fullmatch(rf"{constant} \((.+)\)", take)
                if said:
                    value = said.group(1).removeprefix("default ")
                    uses.append(f"{text(name)}: {text(value)}")
                elif take == constant:
                    uses.append(f"{text(name)}: no default given")
        rows.append((constant, flag_of(constant), "a point, RE IM", "<br>".join(uses)))
    for key, (words, target) in FRAME.items():
        one = params["frame"][key]
        default = one["unsaid"] if one["default"] is None else _number(one["default"])
        rows.append(
            (
                _a(words, target),
                f"<code>{text(one['flag'])}</code>",
                text(one["range"]),
                text(default),
            )
        )
    modes = [
        _a(m["name"], _mode_target(m["name"]))
        + ("" if m["production"] else f" ({text(m['tier'])})")
        for m in params["modes"]
    ]
    rows.append(
        (
            _a("rendering mode", MODES_PAGE),
            flag_of("mode"),
            ", ".join(modes),
            text(params["default_mode"]),
        )
    )
    knobs: dict[str, dict] = {}
    for mode in params["modes"]:
        for knob, said in mode["params"].items():
            entry = knobs.setdefault(knob, {"range": said["range"], "defaults": {}})
            entry["defaults"].setdefault(_number(said["default"]), []).append(mode["name"])
    knob_lines = []
    for knob, entry in knobs.items():
        defaults = "; ".join(
            f"{value} in {', '.join(names)}" for value, names in entry["defaults"].items()
        )
        knob_lines.append(f"{text(knob)}: {text(entry['range'])}, default {text(defaults)}")
    rows.append(
        (
            "mode parameter",
            "<code>--param NAME=VALUE</code>",
            f"<details><summary>{len(knobs)} parameters, each for its own modes</summary>"
            + "<br>".join(knob_lines)
            + "</details>",
            "per mode",
        )
    )
    names = [text(m["name"]) for m in params["colormaps"]]
    rows.append(
        (
            _a("palette", "color-palettes.html"),
            flag_of("colormap"),
            _fold_cell(f"{len(names):,} palettes", names),
            text(flags["colormap"]["default"]),
        )
    )
    for knob, one in params["palette"].items():
        rows.append(
            (
                _a(knob, KNOB_HREF.get(knob)) + f", {_inline(one['says'])}",
                f"<code>{text(one['flag'])}</code>",
                _inline(one["range"]),
                text(_number(one["default"])),
            )
        )
    for key, says in params["spec_only"].items():
        rows.append((text(key), "spec only", _inline(says), ""))
    head = ("setting", "flag", "values", "default")
    lines = [
        '<table class="parameters">',
        "<tr>" + "".join(f"<th>{cell}</th>" for cell in head) + "</tr>",
    ]
    lines += ["<tr>" + "".join(f"<td>{cell}</td>" for cell in row) + "</tr>" for row in rows]
    lines.append("</table>")
    # `parameters.json` spells the spec route with the FORMATS.md section in asterisks;
    # the section becomes a link and the asterisks, which would be an italic, go.
    spec = params["settable_by"]["spec"].replace(
        "FORMATS.md's *The render spec*", f"[FORMATS.md's render spec]({FORMATS}#the-render-spec)"
    )
    if "*" in spec:
        raise RunItYourselfError(f"parameters.json's settable_by.spec moved: {spec!r}")
    lines.append(f'<p class="table-note">Spec only means settable {_inline(spec)}.</p>')
    return LF.join(lines)


def _render(record: dict) -> list[str]:
    """Render one picture: each command, its picture and time, then the parameter table."""
    renders = json.loads((HOSTED / "render" / "render.json").read_text(encoding="utf-8"))
    by_name = {one["name"]: one for one in renders["renders"]}
    commands = [c for block in record["blocks"]["1"] for c in _commands(block)]
    out = []
    for at, command in enumerate(commands):
        typed, help_file = _program(command)
        name = typed.split(" ")[-1] if typed.startswith("fractal-engine") else "render"
        made = by_name[name]
        alt = RENDER_ALT.get(name)
        if not alt:
            raise RunItYourselfError(f"render/{made['picture']} has no alt text in RENDER_ALT")
        across, down = made["rendered_at"]
        width, height = made["shown_at"], made["shown_at"] * down // across
        seconds = made["seconds"]
        said = f"{seconds:.1f}".removesuffix(".0") if seconds < 10 else f"{round(seconds):,}"
        unit = "second" if said == "1" else "seconds"
        if at:
            out.append(f"<p>{_inline(RENDER_LINK)}</p>")
        out.append(_block(command))
        out.append(_options(typed, help_file, True))
        out.append(
            LF.join(
                [
                    '<div class="render-shot">',
                    f'<img src="walkthrough/render/{attribute(made["picture"])}" width="{width}" '
                    f'height="{height}" alt="{attribute(alt)}" loading="lazy">',
                    f'<p class="table-note">{said} {unit} on my machine.</p>',
                    "</div>",
                ]
            )
        )
    params = json.loads((HOSTED / "parameters.json").read_text(encoding="utf-8"))
    out.append(_parameters(params))
    return out


def _file(href: str, name: str, command: str, anchor: str | None, note: str = "") -> str:
    parts = [f'<a href="{attribute(href)}">{text(name)}</a>', f"<code>{text(command)}</code>"]
    if note:
        parts.append(text(note))
    if anchor:
        parts.append(f'<a href="{FORMATS}#{anchor}">FORMATS.md</a>')
    return "<li>" + " · ".join(parts) + "</li>"


def _hosted(folder: str, walkthrough: dict, counts: dict, whole: list[str]) -> str:
    (made,) = [page for page in walkthrough["pages"] if page["folder"] == folder]
    command = made["command"]
    base = f"walkthrough/{folder}"
    if not (HOSTED / folder / "index.html").is_file():
        return (
            f'<p class="hosted-missing">Not in this walkthrough: <code>{text(command)}</code> '
            "makes it.</p>"
        )
    files = []
    if (HOSTED / folder / "page.json").is_file():
        anchor = "gallery-pagejson" if folder == "gallery" else "pagejson"
        files.append(_file(f"{base}/page.json", "page.json", command, anchor))
    if folder == "trace":
        files.append(_file(f"{base}/counts.json", "counts.json", command, "countsjson"))
        sliced = counts["files"]
        for name in TRACE_ORDER:
            if not (HOSTED / folder / "files" / name).is_file():
                continue
            note = ""
            if name in sliced:
                one = sliced[name]
                note = f"{one['sliced']:,} rows here, {one['rows']:,} in the full run"
            files.append(_file(f"{base}/files/{name}", name, command, SECTIONS[name], note))
    by_name = {entry["name"]: entry for entry in walkthrough["files"]}
    for name in whole:
        if name in by_name and (HOSTED / name).is_file():
            maker, anchor = WHOLE[name]
            files.append(_file(f"walkthrough/{name}", name, maker, anchor, "whole"))
    return LF.join(
        [
            '<div class="hosted">',
            f'<iframe src="{base}/index.html" title="{attribute(made["title"])}" '
            'loading="lazy"></iframe>',
            f'<p class="hosted-open"><a href="{base}/index.html">open this page on its own</a></p>',
            '<ul class="hosted-files">',
            *files,
            "</ul>",
            "</div>",
        ]
    )


def page(_args=None) -> None:
    record = json.loads(RECORD.read_text(encoding="utf-8"))
    walkthrough = json.loads((HOSTED / "walkthrough.json").read_text(encoding="utf-8"))
    counts_path = HOSTED / "trace" / "counts.json"
    counts = json.loads(counts_path.read_text(encoding="utf-8")) if counts_path.is_file() else {}
    body = [f"<p>{_inline(paragraph)}</p>" for paragraph in INTRO]
    for stage in STAGES:
        heading = stage["heading"]
        body.append(f'<h2 id="{_slug(heading)}">{text(heading)}</h2>')
        body += [f"<p>{_inline(sentence)}</p>" for sentence in stage["lead"]]
        if stage.get("render"):
            body += _render(record)
        else:
            body += _blocks_with_options(
                [b for step in stage["steps"] for b in record["blocks"][step]]
            )
        if stage.get("bundle"):
            body.append(_hosted(stage["bundle"], walkthrough, counts, stage.get("whole", [])))
    where = OUT / "index.html"
    page_html = LF.join(
        [
            "<!doctype html>",
            '<html lang="en">',
            "<head>",
            '<meta charset="utf-8">',
            '<meta name="viewport" content="width=device-width, initial-scale=1">',
            icons.head(where),
            f'<meta name="description" content="{attribute(DESCRIPTION)}">',
            f"<title>{text(TITLE)}</title>",
            '<link rel="stylesheet" href="../../assets/css/site.css">',
            "</head>",
            "<body>",
            '<div class="page-solo">',
            '<header class="masthead">',
            f"  <h1>{text(TITLE)}</h1>",
            "</header>",
            '<section class="prose">',
            *body,
            "</section>",
            '<nav class="section-nav">',
            '  <p><a href="../index.html">Tools and data</a></p>',
            "</nav>",
            "<footer>",
            f'  <p><a href="{AUTHOR_SITE}">Matt Fisher</a>',
            f'  · <a href="{CODE_REPO}">fractal-wallpapers</a> · MIT</p>',
            "</footer>",
            "</div>",
            "</body>",
            "</html>",
            "",
        ]
    )
    where.write_text(heads.with_head(where, page_html), encoding="utf-8", newline=LF)
    print(f"wrote {where.relative_to(SITE_ROOT).as_posix()}")


def main() -> None:
    parser = argparse.ArgumentParser(prog="python -m builder.run_it_yourself")
    commands = parser.add_subparsers(dest="command", required=True)
    imported = commands.add_parser("import", help="copy a walkthrough folder in, verbatim")
    imported.add_argument("walkthrough", type=Path)
    imported.add_argument(
        "--readme",
        type=Path,
        help="the README to read the commands and cost table from (default: the clone's)",
    )
    imported.add_argument(
        "--readme-from",
        default="the clone's README.md",
        help="where that README came from, as the record should say it",
    )
    commands.add_parser("page", help="write the page from the record and the imported folder")
    args = parser.parse_args()
    if args.command == "import":
        source = args.walkthrough.resolve()
        readme = args.readme or source.parent.parent / "README.md"
        import_walkthrough(source, readme, args.readme_from)
    page()


if __name__ == "__main__":
    main()
