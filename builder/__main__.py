"""The one entry point: `python -m builder <command>`.

`build` writes, `check` only reads and exits 1 on a problem, `figure` prints markup to
paste, `diagram` draws the two figures that are diagrams rather than renders, and
`import` is the one command that reaches outside the repository — for the full-size
original an asset is derived from. Run `python -m builder --help` for the list.
"""

import argparse
import sys
from pathlib import Path

from . import build as build_module
from . import checks, diagrams, figures, images, records
from .paths import IMAGES_DIR, SITE_ROOT


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

    drawn = commands.add_parser("diagram", help="draw one of the figures that is not a render")
    drawn.add_argument("id", choices=sorted(diagrams.DIAGRAMS), help="the diagram's figure id")

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


def _do_diagram(identifier: str) -> int:
    destination, width, height = diagrams.draw(identifier)
    relative = destination.relative_to(SITE_ROOT).as_posix()
    size = destination.stat().st_size
    print(f'wrote {relative}  "width": {width}, "height": {height}  ({size / 1024:.0f} KB)')
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
        if options.command == "diagram":
            return _do_diagram(options.id)
        return _do_import(options)
    except (records.RecordError, images.ImageError) as error:
        print(f"error: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
