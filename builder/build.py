"""Writing the generated tree.

A build is something done on a workstation and reviewed in a diff, so this writes only
what actually differs: an unchanged page keeps its bytes and its timestamp, and a run
over unchanged inputs reports nothing.
"""

from pathlib import Path

from . import galleries, go, icons, images, pages, sections
from .paths import SITE_ROOT


def _shown(path: Path) -> str:
    return path.relative_to(SITE_ROOT).as_posix()


def _write_page(path: Path, html: str) -> str | None:
    if path.is_file():
        with path.open(encoding="utf-8", newline="") as handle:
            if handle.read() == html:
                return None
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="\n") as handle:
        handle.write(html)
    return _shown(path)


def _thumbs(gallery: galleries.Gallery) -> list[str]:
    written = []
    named = {image.file for image in gallery.images}
    for image in gallery.images:
        source = gallery.directory / image.file
        thumb = gallery.thumbs_directory / image.file
        if not source.is_file():
            raise images.ImageError(f"{_shown(gallery.metadata_path)} names a missing {image.file}")
        stale = (
            not thumb.is_file()
            or images.dimensions(thumb) != image.thumb_size
            or thumb.stat().st_mtime < source.stat().st_mtime
        )
        if stale:
            images.write_thumb(source, thumb, image.thumb_size)
            written.append(_shown(thumb))
    if gallery.thumbs_directory.is_dir():
        for path in sorted(gallery.thumbs_directory.iterdir()):
            if path.name not in named:
                path.unlink()
                written.append(f"{_shown(path)} (removed)")
    return written


def _hand_written(article: list[sections.Section]) -> list[str]:
    """The two things the builder owns inside a hand-written page.

    The prose is nobody's business but the writer's. The contents rail between the
    markers is derived from all fourteen pages at once, and a prose `<h2>` gets the id its
    rail entry links to — both would be a chore to keep by hand and neither is prose.
    """
    changed = []
    for path in sections.hand_written(article):
        page = sections.read_page(path)
        written = _write_page(
            path, sections.with_rail(path, sections.with_heading_ids(page), article)
        )
        if written:
            changed.append(written)
    return changed


def build(*, thumbnails: bool = True) -> list[str]:
    """Regenerate the pages and thumbnails the builder owns; report what moved."""
    loaded = galleries.load_all()
    article = sections.load_all()
    changed = []
    if thumbnails:
        for gallery in loaded:
            changed.extend(_thumbs(gallery))
    changed.extend(_hand_written(article))
    generated = pages.generated_pages(loaded, article)
    # The short links under `go/`, which `check` holds by name as **go** rather than as
    # **pages**, because their other half is whether the explorer accepts the target.
    generated.update(go.pages())
    for path, html in generated.items():
        written = _write_page(path, html)
        if written:
            changed.append(written)
    changed.extend(_icon_links(set(generated)))
    return changed


def _icon_links(generated: set[Path]) -> list[str]:
    """The icon links in every served page's `<head>` that the builder does not generate.

    Every page declares the icon, and the lines are `builder.icons`'s rather than each
    page's: a generated page gets them from its shell, and every other page, the
    explorer and the atlas frame included, gets them here, the way a hand-written page gets
    its rail. Nothing else in such a page is touched.
    """
    changed = []
    for path in icons.served_pages():
        if path in generated:
            continue
        written = _write_page(path, icons.with_icons(path, sections.read_page(path)))
        if written:
            changed.append(written)
    return changed
