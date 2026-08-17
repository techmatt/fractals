"""What a gallery is.

A gallery is a directory of web-res images plus one metadata file. The directory name
is the slug, and the slug is a permanent URL, so it answers to the naming rule in
`CLAUDE.md` before anything else about it is decided.

The metadata carries each image's pixel dimensions rather than the builder reading them
off disk. That is what lets page generation be a pure function of text — no image
library, no decode order, byte-stable output — and it gives `check` something to verify
the files against.
"""

from dataclasses import dataclass
from pathlib import Path

from . import records
from .paths import GALLERY_IMAGES_DIR, GALLERY_METADATA_NAME, THUMBS_DIR_NAME

THUMB_WIDTH = 480


@dataclass(frozen=True)
class Image:
    """One web-res image on a gallery page."""

    file: str
    title: str
    caption: str
    alt: str
    width: int
    height: int
    credit: str | None

    @property
    def thumb_size(self) -> tuple[int, int]:
        """The thumbnail's dimensions, derived so the page never guesses at a shape.

        Nothing is enlarged: an image already narrower than a thumbnail is its own.
        """
        if self.width <= THUMB_WIDTH:
            return self.width, self.height
        return THUMB_WIDTH, max(1, round(self.height * THUMB_WIDTH / self.width))


@dataclass(frozen=True)
class Gallery:
    """A directory of web-res images and the page the builder writes for it."""

    slug: str
    title: str
    standfirst: str
    note: str | None
    release: str | None
    images: tuple[Image, ...]

    @property
    def directory(self) -> Path:
        return GALLERY_IMAGES_DIR / self.slug

    @property
    def thumbs_directory(self) -> Path:
        return self.directory / THUMBS_DIR_NAME

    @property
    def metadata_path(self) -> Path:
        return self.directory / GALLERY_METADATA_NAME


def load(slug: str) -> Gallery:
    """Read one gallery's metadata file."""
    rows = records.read(GALLERY_IMAGES_DIR / slug / GALLERY_METADATA_NAME)
    header, rest = rows[0], rows[1:]
    header.expect_kind("gallery")
    if header.text("slug") != slug:
        raise records.RecordError(
            f"{header.where}: slug {header.text('slug')!r} does not match the directory {slug!r}"
        )
    if not rest:
        raise records.RecordError(f"{header.where}: a gallery needs at least one image")

    images = []
    seen: set[str] = set()
    for row in rest:
        row.expect_kind("image")
        file = row.text("file")
        if file in seen:
            raise records.RecordError(f"{row.where}: {file} appears twice")
        seen.add(file)
        images.append(
            Image(
                file=file,
                title=row.text("title"),
                caption=row.text("caption"),
                alt=row.text("alt"),
                width=row.count("width"),
                height=row.count("height"),
                credit=row.optional_text("credit"),
            )
        )

    return Gallery(
        slug=slug,
        title=header.text("title"),
        standfirst=header.text("standfirst"),
        note=header.optional_text("note"),
        release=header.optional_text("release"),
        images=tuple(images),
    )


def slugs() -> list[str]:
    """Every gallery directory that carries a metadata file, in page order."""
    if not GALLERY_IMAGES_DIR.is_dir():
        return []
    found = [
        directory.name
        for directory in GALLERY_IMAGES_DIR.iterdir()
        if directory.is_dir() and (directory / GALLERY_METADATA_NAME).is_file()
    ]
    return sorted(found)


def load_all() -> list[Gallery]:
    return [load(slug) for slug in slugs()]
