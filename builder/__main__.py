"""The one entry point: `python -m builder <command>`.

`build` writes, `check` only reads and exits 1 on a problem, `figure` prints markup to
paste, `figures` lists what is still to make and lands a finished one, `diagram` draws
the two figures that are diagrams rather than renders, `serve` puts the committed tree
on localhost for previewing, `prose` holds each page to the approved document it was
placed from, and `review` builds the doc a page is marked up in and reads it back.
`import`, `prose` and `review` are the commands that reach outside the repository — for
a full-size original, for the approved prose, and for the Drive-synced review folder.
Run `python -m builder --help` for the list.
"""

import argparse
import sys
from pathlib import Path

from . import build as build_module
from . import checks, diagrams, figures, images, records
from . import locations as locations_module
from . import prose as prose_module
from . import review as review_module
from . import sections as sections_module
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

    made = commands.add_parser(
        "locations", help="draw the figures of the Finding good locations page"
    )
    made.add_argument(
        "id",
        nargs="*",
        choices=sorted(locations_module.MAKERS) or None,
        help="which figures to draw; all of them by default",
        metavar="ID",
    )
    made.add_argument(
        "--place",
        action="store_true",
        help="import each drawn sheet as its figure's asset and fill its registry row",
    )
    made.add_argument(
        "--replace",
        action="store_true",
        help="land the redraw over a figure that is already made, page and row together",
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

    held = commands.add_parser("prose", help="hold a placed page to the prose it was placed from")
    held.add_argument(
        "page",
        nargs="*",
        help="which pages to check; every page with a registered master by default",
    )

    marked = commands.add_parser("review", help="build the doc a page is reviewed in, or read it")
    marked.add_argument("page", nargs="?", help="the page, named with or without .html")
    marked.add_argument(
        "--read", action="store_true", help="print the marked-up doc back, edits and notes first"
    )
    marked.add_argument(
        "--full", action="store_true", help="with --read, print every paragraph as well"
    )
    marked.add_argument(
        "--consume",
        action="store_true",
        help="move an applied doc into review/applied/, so it cannot be applied twice",
    )
    marked.add_argument(
        "--force", action="store_true", help="overwrite a doc that is already waiting"
    )
    marked.add_argument(
        "--list", action="store_true", help="what is waiting for review and what was applied"
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


def _do_locations(options: argparse.Namespace) -> int:
    """Draw section 5's figures, and optionally land each one where it belongs.

    Drawing writes a lossless sheet and its provenance into `artifacts/figures/`;
    `--place` then does what `figures --place` does, with the provenance and the recipe
    filled in from the maker rather than typed.
    """
    wanted = options.id or sorted(locations_module.MAKERS)
    for identifier in wanted:
        drawn = locations_module.draw(identifier)
        relative = drawn.path.relative_to(SITE_ROOT).as_posix()
        print(f"wrote {relative}")
        if not options.place:
            continue
        lossless = identifier in locations_module.LOSSLESS
        destination = FIGURE_IMAGES_DIR / f"{identifier}{'.png' if lossless else '.jpg'}"
        if identifier in locations_module.ANIMATED:
            # An animation is copied, never imported: Pillow's one-image read keeps the
            # first frame and silently drops the rest, and the sheet is already web-res.
            destination.write_bytes(drawn.path.read_bytes())
            width, height = images.dimensions(destination)
        else:
            width, height = images.import_web_res(drawn.path, destination)
        placed = figures.place(
            identifier,
            destination.name,
            width,
            height,
            provenance=list(drawn.provenance),
            recipe=locations_module.recipe(identifier),
            replace=options.replace,
        )
        size = destination.stat().st_size / 1024
        print(f"  {destination.name}  {width}x{height}  ({size:.0f} KB) — {placed.page}")
    return 0


def _do_diagram(identifier: str) -> int:
    destination, width, height = diagrams.draw(identifier)
    relative = destination.relative_to(SITE_ROOT).as_posix()
    size = destination.stat().st_size
    print(f'wrote {relative}  "width": {width}, "height": {height}  ({size / 1024:.0f} KB)')
    return 0


def _do_prose(options: argparse.Namespace) -> int:
    """Hold each placed page to its approved master, word for word."""
    masters = prose_module.load_all()
    wanted = [_page_name(page) for page in options.page] if options.page else sorted(masters)
    if not wanted:
        print(f"no page has a registered master — {prose_module.PROSE_REGISTRY.name} is empty")
        return 0
    problems = 0
    for page in wanted:
        master = masters.get(page)
        if master is None:
            print(f"{page}: no master registered — this page's HTML is its own master")
            continue
        comparison = prose_module.compare(page, master)
        if comparison.matches:
            print(f"{page}: verbatim — {comparison.words} words match {master.file}")
            continue
        problems += 1
        print(f"{page}: drifted from {master.file}")
        print("  " + comparison.difference.replace("\n", "\n  "))
    return 1 if problems else 0


def _page_name(page: str) -> str:
    """A page named either way — `overview` or `overview.html` — as the registry spells it."""
    return page if page.endswith(".html") else f"{page}.html"


def _do_review(options: argparse.Namespace) -> int:
    if options.list or not options.page:
        return _do_review_list()
    page = _page_name(options.page)
    if options.consume:
        moved = review_module.consume(page)
        print(f"moved to {moved}")
        return 0
    if options.read:
        return _do_review_read(page, full=options.full)
    written = review_module.create(page, force=options.force)
    paragraphs = review_module.read_doc(written)
    print(f"wrote {written}")
    print(f"{len(paragraphs)} paragraphs — mark it up in Google Docs, then apply it")
    return 0


def _do_review_list() -> int:
    """What is waiting for a mark-up pass, and what has already been through one."""
    for section in sections_module.load_all():
        state = review_module.state_of(section.page)
        if state.waiting is None and not state.applied:
            continue
        waiting = state.waiting.name if state.waiting else "—"
        applied = ", ".join(path.name for path in state.applied) or "none"
        print(f"{section.page:34} waiting: {waiting:34} applied: {applied}")
    print(f"in {prose_module.review_dir()}")
    return 0


def _do_review_read(page: str, *, full: bool) -> int:
    """The marked-up doc, as the edits it makes and the notes it carries."""
    state = review_module.state_of(page)
    if state.waiting is None:
        print(f"no review doc for {page} in {prose_module.review_dir()}", file=sys.stderr)
        return 1
    paragraphs = review_module.read_doc(state.waiting)
    print(f"{state.waiting.name}: {len(paragraphs)} paragraphs")
    notes = review_module.notes_in(paragraphs)
    changes = review_module.changes(page, paragraphs)
    print(f"\n{len(changes)} changed paragraph(s), {len(notes)} note(s)\n")
    for change in changes:
        print(f"— {change.kind}: {change.inline}\n")
    for note in notes:
        print(f"— note: {note}")
    if full:
        print("\n--- the whole doc ---")
        for paragraph in paragraphs:
            prefix = "" if paragraph.style == review_module.NORMAL else f"[{paragraph.style}] "
            print(f"{prefix}{paragraph.text}")
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
        if options.command == "locations":
            return _do_locations(options)
        if options.command == "diagram":
            return _do_diagram(options.id)
        if options.command == "prose":
            return _do_prose(options)
        if options.command == "review":
            return _do_review(options)
        if options.command == "serve":
            return _do_serve(options)
        return _do_import(options)
    except (
        records.RecordError,
        images.ImageError,
        prose_module.ProseError,
        review_module.ReviewError,
        OSError,
    ) as error:
        print(f"error: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
