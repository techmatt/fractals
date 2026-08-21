"""The one entry point: `python -m builder <command>`.

`build` writes, `check` only reads and exits 1 on a problem, `figure` prints markup to
paste, `figures` lists what is still to make and lands a finished one, `diagram` draws
the two figures that are diagrams rather than renders, `serve` puts the committed tree
on localhost for previewing, and `import` is the one command that reaches outside the
repository — for the full-size original an asset is derived from. Run
`python -m builder --help` for the list.
"""

import argparse
import sys
from pathlib import Path

from . import build as build_module
from . import checks, diagrams, figures, images, records
from . import serve as serve_module
from .paths import FIGURE_IMAGES_DIR, IMAGES_DIR, SITE_ROOT


def _crop(value: str) -> tuple[int, int, int, int]:
    parts = value.split(",")
    if len(parts) != 4:
        raise argparse.ArgumentTypeError("a crop is four integers: left,top,right,bottom")
    try:
        left, top, right, bottom = (int(part) for part in parts)
    except ValueError as error:
        raise argparse.ArgumentTypeError("a crop is four integers: left,top,right,bottom") from (
            error
        )
    if right <= left or bottom <= top:
        raise argparse.ArgumentTypeError("a crop must have positive width and height")
    return left, top, right, bottom


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="python -m builder", description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)

    built = commands.add_parser("build", help="regenerate gallery pages and thumbnails")
    built.add_argument(
        "--no-thumbnails",
        action="store_true",
        help="write pages only; leave existing thumbnails alone",
    )

    commands.add_parser("check", help="verify the committed tree; writes nothing")

    figure = commands.add_parser("figure", help="print a figure's markup block")
    figure.add_argument("id", help="the figure id, as registered in figures.jsonl")

    listed = commands.add_parser(
        "figures", help="list the figures still to make, or land a finished one"
    )
    listed.add_argument(
        "--all", action="store_true", help="list every figure, not only the pending ones"
    )
    listed.add_argument(
        "--place",
        nargs=2,
        metavar=("ID", "SOURCE"),
        help="import SOURCE as figure ID's asset, fill its registry row, and heal its page",
    )
    listed.add_argument("--crop", type=_crop, help="left,top,right,bottom, in source pixels")
    listed.add_argument(
        "--max-width",
        type=int,
        default=images.WEB_RES_MAX_WIDTH,
        help=f"downscale wider images to this (default {images.WEB_RES_MAX_WIDTH})",
    )
    listed.add_argument(
        "--lossless",
        action="store_true",
        help="land as .png rather than .jpg — for animation and flat drawn art",
    )
    listed.add_argument(
        "--provenance",
        type=Path,
        help="a text file, one line per panel, saying how each was made",
    )

    drawn = commands.add_parser("diagram", help="draw one of the figures that is not a render")
    drawn.add_argument("id", choices=sorted(diagrams.DIAGRAMS), help="the diagram's figure id")

    served = commands.add_parser("serve", help="preview the committed tree over localhost")
    served.add_argument(
        "--port",
        type=int,
        default=serve_module.DEFAULT_PORT,
        help=f"the port to listen on (default {serve_module.DEFAULT_PORT})",
    )

    brought = commands.add_parser("import", help="bring an image in as a web-res asset")
    brought.add_argument("source", type=Path, help="the full-size original, from anywhere on disk")
    brought.add_argument(
        "destination",
        type=Path,
        help="where it lands, relative to the repository root (under assets/images/)",
    )
    brought.add_argument("--crop", type=_crop, help="left,top,right,bottom, in source pixels")
    brought.add_argument(
        "--max-width",
        type=int,
        default=images.WEB_RES_MAX_WIDTH,
        help=f"downscale wider images to this (default {images.WEB_RES_MAX_WIDTH})",
    )
    return parser


def _do_build(options: argparse.Namespace) -> int:
    changed = build_module.build(thumbnails=not options.no_thumbnails)
    for line in changed:
        print(f"wrote {line}")
    print(f"{len(changed)} file(s) changed" if changed else "already up to date")
    return 0


def _do_check() -> int:
    results = checks.run_all()
    total = 0
    for name, problems in results.items():
        total += len(problems)
        if problems:
            print(f"{name}: {len(problems)} problem(s)")
            for problem in problems:
                print(f"  {problem}")
        else:
            print(f"{name}: ok")
    pending = sorted(figure.id for figure in figures.load_all().values() if figure.pending)
    if pending:
        print(f"note: {len(pending)} figure(s) still to make: {', '.join(pending)}")
    if not images.available():
        print("note: Pillow is not installed, so image sizes were not verified")
    if total:
        print(f"\n{total} problem(s)")
        return 1
    return 0


def _do_figure(identifier: str) -> int:
    registry = figures.load_all()
    figure = registry.get(identifier)
    if figure is None:
        known = ", ".join(sorted(registry)) or "none registered"
        print(f"no figure {identifier!r} — known: {known}", file=sys.stderr)
        return 1
    print(figures.markup(figure))
    return 0


def _do_figures(options: argparse.Namespace) -> int:
    if options.place:
        return _do_place(options)
    registry = figures.load_all()
    wanted = [figure for figure in registry.values() if options.all or figure.pending]
    if not wanted:
        print("every registered figure is made")
        return 0
    grouped = figures.by_page({figure.id: figure for figure in wanted})
    for page, found in grouped.items():
        print(f"{page}  ({len(found)})")
        for figure in found:
            state = "pending" if figure.pending else f"{figure.width}x{figure.height}"
            recipe = figure.recipe.maker if figure.recipe else "no recipe"
            print(f"  {figure.id:<28} {state:<12} {recipe}")
            if figure.pending:
                print(f"    {figure.alt}")
    total = sum(1 for figure in wanted if figure.pending)
    print(f"{total} figure(s) still to make")
    return 0


def _do_place(options: argparse.Namespace) -> int:
    """The four steps between a composed sheet and a placed figure, done as one."""
    identifier, source = options.place
    registry = figures.load_all()
    figure = registry.get(identifier)
    if figure is None:
        known = ", ".join(sorted(registry)) or "none registered"
        print(f"no figure {identifier!r} — known: {known}", file=sys.stderr)
        return 1
    suffix = ".png" if options.lossless else ".jpg"
    destination = FIGURE_IMAGES_DIR / f"{identifier}{suffix}"
    width, height = images.import_web_res(
        Path(source), destination, crop=options.crop, max_width=options.max_width
    )
    provenance = None
    if options.provenance:
        provenance = [
            line.strip()
            for line in options.provenance.read_text(encoding="utf-8").splitlines()
            if line.strip()
        ]
    placed = figures.place(identifier, destination.name, width, height, provenance=provenance)
    size = destination.stat().st_size / 1024
    print(f"{destination.name}  {width}x{height}  ({size:.0f} KB)")
    print(f"filled figures.jsonl and healed {placed.page}")
    return 0


def _do_diagram(identifier: str) -> int:
    destination, width, height = diagrams.draw(identifier)
    relative = destination.relative_to(SITE_ROOT).as_posix()
    size = destination.stat().st_size
    print(f'wrote {relative}  "width": {width}, "height": {height}  ({size / 1024:.0f} KB)')
    return 0


def _do_serve(options: argparse.Namespace) -> int:
    serve_module.serve(options.port)
    return 0


def _do_import(options: argparse.Namespace) -> int:
    destination = (SITE_ROOT / options.destination).resolve()
    try:
        destination.relative_to(IMAGES_DIR)
    except ValueError:
        print(f"{options.destination}: web-res assets go under assets/images/", file=sys.stderr)
        return 1
    width, height = images.import_web_res(
        options.source,
        destination,
        crop=options.crop,
        max_width=options.max_width,
    )
    relative = destination.relative_to(SITE_ROOT).as_posix()
    size = destination.stat().st_size
    print(f'wrote {relative}  "width": {width}, "height": {height}  ({size / 1024:.0f} KB)')
    return 0


def main(argv: list[str] | None = None) -> int:
    options = _parser().parse_args(argv)
    try:
        if options.command == "build":
            return _do_build(options)
        if options.command == "check":
            return _do_check()
        if options.command == "figure":
            return _do_figure(options.id)
        if options.command == "figures":
            return _do_figures(options)
        if options.command == "diagram":
            return _do_diagram(options.id)
        if options.command == "serve":
            return _do_serve(options)
        return _do_import(options)
    except (records.RecordError, images.ImageError, OSError) as error:
        print(f"error: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
