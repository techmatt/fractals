"""Writing the generated tree.

A build is something done on a workstation and reviewed in a diff, so this writes only
what actually differs: an unchanged page keeps its bytes and its timestamp, and a run
over unchanged inputs reports nothing.
"""

from pathlib import Path

from . import galleries, images, pages
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


def build(*, thumbnails: bool = True) -> list[str]:
    """Regenerate the pages and thumbnails the builder owns; report what moved."""
    loaded = galleries.load_all()
    changed = []
    if thumbnails:
        for gallery in loaded:
            changed.extend(_thumbs(gallery))
    for path, html in pages.generated_pages(loaded).items():
        written = _write_page(path, html)
        if written:
            changed.append(written)
    return changed
