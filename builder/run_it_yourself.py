"""Run the pipeline yourself: a worked example of fractal-wallpapers from a fresh install.

    python -m builder.run_it_yourself import <walkthrough> [--readme README.md]
    python -m builder.run_it_yourself page

*(run_it_yourself_page_ckpt161.)* `tools-and-data/run-it-yourself/` walks a reader through
the wallpapers README's path, one section per stage: the stage's sentence, its command
block, its rows of the README's cost table, and then the inspection page that stage's own
command wrote, hosted in place. **The site draws none of those pages.** `fractal-wallpapers
walkthrough` gathers them into one folder of self-contained bundles, and `import` copies
that folder here byte for byte, under `walkthrough/`, so the page rebuilds without the
clone it came from. The bundles are hosted pages rather than this site's pages:
`paths.HOSTED_DIRS` keeps them out of the head, icon and bar checks, which would otherwise
ask them to carry furniture they cannot carry unchanged, and `check`'s `links` still
resolves every href in them. `.gitattributes` exempts the folder from end-of-line
normalization, because a bundle's JSON may be written with CRLF and a byte rewritten on
commit is a byte changed.

`import` also reads the README once, for the command blocks and the cost table, and writes
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
    "The files below are slices: the twelve pictures in the final gallery, traced back "
    "through every stage, plus a few that were rejected along the way. Each file's fields "
    f"are defined in [FORMATS.md]({FORMATS}) in the repository.",
]

#: After the Walk section's cost rows.
RUN_LINE = (
    "The full ten-minute run found 4,069 places, mined 327 candidates from them, and seated "
    "2 of 12 at the default bars."
)

#: One stage a section, in pipeline order: heading, sentence, the README's steps whose
#: command blocks it shows (`install` is the Install section's), the cost-table rows it
#: owns by their first cell, and the bundle it hosts.
STAGES = [
    {
        "heading": "Install",
        "sentence": "The CPU and CUDA installs differ only in which PyTorch they pull.",
        "steps": ["install"],
        "cost": [],
    },
    {
        "heading": "Render one picture",
        "sentence": (
            "One command draws one picture from a family, a view, a rendering mode, and a palette."
        ),
        "steps": ["1"],
        "cost": ["full-size wallpaper"],
    },
    {
        "heading": "Check the judges",
        "sentence": (
            "This renders eight fixed pictures, scores them with all four judges, and "
            "compares the scores to the ones I got. If your numbers match, your install "
            "matches mine."
        ),
        "steps": ["2"],
        "cost": ["palette judge"],
        "bundle": "judges-check",
    },
    {
        "heading": "Walk for locations",
        "sentence": (
            "The walk explores each fractal family for a fixed amount of time and records "
            "the places it finds, and the location judge then scores each place. No two "
            "walks find the same places."
        ),
        "steps": ["3"],
        "cost": ["walk frame (gate render)", "location judge"],
        "after_cost": RUN_LINE,
        "bundle": "walk-stats",
        "whole": ["summary.json", "stats.json"],
    },
    {
        "heading": "Mine candidates",
        "sentence": (
            "Mining takes the best-scoring places, tries rendering modes and palettes on "
            "each, and keeps the pictures the wallpaper judge likes."
        ),
        "steps": ["4", "5"],
        "cost": ["embedding (DINOv2)", "mined candidate", "wallpaper (render) judge"],
        "bundle": "candidates",
    },
    {
        "heading": "Grade and solve a gallery",
        "sentence": (
            "The gallery judge grades the candidates, and the solve picks a set that is "
            "good and varied. After ten minutes of mining only a handful of pictures clear "
            "the bars, so the gallery shown here was made with the forced fill, which seats "
            "the best of whatever the pool holds."
        ),
        "steps": ["6", "7", "8"],
        "cost": ["gallery judge", "solve seat"],
        "bundle": "gallery",
        "whole": ["keep.jsonl"],
    },
    {
        "heading": "Continue from your own pool",
        "sentence": (
            "Every later run adds to the same pool. A merge prunes weaker pictures, and the "
            "galleries you recorded keep theirs."
        ),
        "steps": ["9"],
        "cost": [],
    },
    {
        "heading": "Follow one picture",
        "sentence": "Here is one gallery picture as it appears in each file.",
        "steps": ["10"],
        "cost": [],
        "bundle": "trace",
    },
]

#: The site's names for what the README's table calls by the code's (the naming rule).
COST_NAMES = {"wallpaper (render) judge": "wallpaper judge"}

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


def _readme(readme: str) -> dict:
    """The README's command blocks, by step, and its cost table."""
    lines = readme.split("\n")
    blocks: dict[str, list[str]] = {}
    step = None
    fence: list[str] | None = None
    cost: list[list[str]] = []
    in_cost = False
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
            in_cost = False
        elif line.startswith("### "):
            step = None
            in_cost = line == "### What each stage costs"
        elif numbered := re.match(r"\*\*(\d+)\. ", line):
            step = numbered.group(1)
        elif in_cost and line.startswith("|"):
            cells = [cell.strip() for cell in line.strip().strip("|").split("|")]
            if not all(set(cell) <= {"-", " "} for cell in cells):
                cost.append(cells)
    if not cost:
        raise RunItYourselfError("the README has no 'What each stage costs' table")
    return {"blocks": blocks, "cost": cost}


def import_walkthrough(source: Path, readme_path: Path, readme_from: str) -> None:
    if not (source / "walkthrough.json").is_file():
        raise RunItYourselfError(f"{source}: no walkthrough.json — not a walkthrough folder")
    readme = readme_path.read_bytes()
    parsed = _readme(readme.decode("utf-8"))
    for stage in STAGES:
        for step in stage["steps"]:
            if step not in parsed["blocks"]:
                raise RunItYourselfError(f"the README has no command block for step {step}")
        named = {row[0] for row in parsed["cost"][1:]}
        missing = [name for name in stage["cost"] if name not in named]
        if missing:
            raise RunItYourselfError(f"the README's cost table has no row {missing[0]!r}")
    if HOSTED.exists():
        shutil.rmtree(HOSTED)
    shutil.copytree(source, HOSTED, copy_function=shutil.copy2)
    files = sorted(path for path in HOSTED.rglob("*") if path.is_file())
    size = sum(path.stat().st_size for path in files)
    for path in files:
        if path.read_bytes() != (source / path.relative_to(HOSTED)).read_bytes():
            raise RunItYourselfError(f"{path}: not the byte-for-byte copy of its source")
    record = {
        "schema": 1,
        "readme": {"read": readme_from, "sha256": hashlib.sha256(readme).hexdigest()},
        "blocks": parsed["blocks"],
        "cost": parsed["cost"],
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


def _cost_table(cost: list[list[str]], names: list[str]) -> str:
    head, rows = cost[0], {row[0]: row for row in cost[1:]}
    lines = ["<table>", "<tr>" + "".join(f"<th>{_inline(cell)}</th>" for cell in head) + "</tr>"]
    for name in names:
        row = [COST_NAMES.get(name, name), *rows[name][1:]]
        lines.append("<tr>" + "".join(f"<td>{_inline(cell)}</td>" for cell in row) + "</tr>")
    lines.append("</table>")
    return LF.join(lines)


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
        body.append(f"<p>{_inline(stage['sentence'])}</p>")
        for step in stage["steps"]:
            for block in record["blocks"][step]:
                body.append(f"<pre><code>{html.escape(block, quote=False)}</code></pre>")
        if stage["cost"]:
            body.append(_cost_table(record["cost"], stage["cost"]))
        if stage.get("after_cost"):
            body.append(f"<p>{_inline(stage['after_cost'])}</p>")
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
