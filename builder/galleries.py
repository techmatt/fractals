"""What a gallery is.

A gallery is a directory of web-res images plus one metadata file. The directory name
is the slug, and the slug is a permanent URL, so it answers to the naming rule in
`CLAUDE.md` before anything else about it is decided.

The metadata carries each image's pixel dimensions rather than the builder reading them
off disk. That is what lets page generation be a pure function of text — no image
library, no decode order, byte-stable output — and it gives `check` something to verify
the files against.

A header record may say `"staged": true`, and then the record and its pictures exist and
**no page is generated from them**. `load_all` answers with the publishable galleries and
`staged` with the rest, so nothing that writes a page, an index tile or an explorer link
sees a staged one — see `builder/README.md`. Two fields relax for a staged gallery and
only there: `title` and `caption`, because such a record is a machine's reading of a
record next door rather than anybody's prose, and a thousand invented captions would be a
thousand claims nobody made. `alt` does not relax: a picture a reader can be shown owes
them a description whatever it is filed under.

**A header may split its rows by collection** *(explorer_slim_ckpt131)*. Where its
`collections` entries each name a `file`, the metadata file is the header alone and the
images are the union of those files, each image once. That is the staged
`seated-candidates` gallery, whose panel fetches one collection at a time.
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
    #: The prose a page puts under the picture. `None` only in a staged gallery, which
    #: has no page to put it on.
    title: str | None
    caption: str | None
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
    blurb: str
    note: str | None
    release: str | None
    images: tuple[Image, ...]
    #: Whether this is a record and its pictures with no page made from them.
    staged: bool = False
    #: The files a split record keeps its rows in, beside the metadata file.
    records: tuple[str, ...] = ()

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
    split = tuple(
        one["file"]
        for one in header.fields.get("collections") or []
        if isinstance(one, dict) and "file" in one
    )
    if split:
        if rest:
            raise records.RecordError(
                f"{header.where}: a record split by collection carries its rows in "
                f"{', '.join(split)}, and this file holds rows as well"
            )
        union: dict[str, records.Record] = {}
        for name in split:
            for row in records.read(GALLERY_IMAGES_DIR / slug / name):
                union.setdefault(row.text("file"), row)
        rest = list(union.values())
    if not rest:
        raise records.RecordError(f"{header.where}: a gallery needs at least one image")
    # Absent is the ordinary case and says so. Present and not a boolean is refused by
    # `flag`, because `0` and `"no"` are not a way of saying this.
    staged = header.flag("staged") if "staged" in header.fields else False

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
                title=row.optional_text("title") if staged else row.text("title"),
                caption=row.optional_text("caption") if staged else row.text("caption"),
                alt=row.text("alt"),
                width=row.count("width"),
                height=row.count("height"),
                credit=row.optional_text("credit"),
            )
        )

    return Gallery(
        slug=slug,
        title=header.text("title"),
        blurb=header.text("blurb"),
        note=header.optional_text("note"),
        release=header.optional_text("release"),
        images=tuple(images),
        staged=staged,
        records=split,
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


def load_every() -> list[Gallery]:
    """Every gallery directory here, staged or not. The only reader that wants both."""
    return [load(slug) for slug in slugs()]


def load_all() -> list[Gallery]:
    """The galleries this site publishes: a page, a cover tile and an explorer link each.

    A staged gallery is deliberately absent. Everything that writes or checks a page goes
    through here, so `staged` is a state the page generator never has to know about — and
    a staged record cannot grow a page by somebody forgetting a flag somewhere.
    """
    return [gallery for gallery in load_every() if not gallery.staged]


def staged() -> list[Gallery]:
    """The galleries that are a record and its pictures, with no page made from them."""
    return [gallery for gallery in load_every() if gallery.staged]
