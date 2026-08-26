"""The only module that touches an image library.

Pillow is imported inside the functions that need it, not at module scope, so `check`
and page generation run on a machine that has never installed it. Page generation reads
sizes out of the metadata instead of off the pixels, so the only jobs left here are
bringing new material in and writing thumbnails.
"""

from pathlib import Path

WEB_RES_MAX_WIDTH = 1600
JPEG_QUALITY = 88

_JPEG_SUFFIXES = frozenset({".jpg", ".jpeg"})


class ImageError(Exception):
    """Something about an image file, or the library that reads them."""


def available() -> bool:
    """Whether the checks that need pixels can run here."""
    try:
        import PIL  # noqa: F401
    except ImportError:
        return False
    return True


def _open(path: Path):
    try:
        from PIL import Image
    except ImportError as error:  # pragma: no cover - depends on the machine
        raise ImageError("Pillow is not installed; `pip install pillow` to work on images") from (
            error
        )
    if not path.is_file():
        raise ImageError(f"{path.name}: no such image")
    return Image.open(path)


def dimensions(path: Path) -> tuple[int, int]:
    """An image's pixel size, without decoding it."""
    with _open(path) as image:
        return image.size


def _save(image, destination: Path) -> None:
    """Write an image in the format its suffix names, with fixed, deterministic options."""
    destination.parent.mkdir(parents=True, exist_ok=True)
    suffix = destination.suffix.lower()
    if suffix in _JPEG_SUFFIXES:
        # An optimized JPEG is encoded through one buffer, and libjpeg refuses to suspend
        # when a scanline does not fit it: a small, densely detailed frame — a fractal at
        # a thumbnail's size is the worst case this repository has — fails with "broken
        # data stream" on Pillow's default. The buffer is a working size and never lands
        # in the file, so raising it changes nothing about the bytes written.
        from PIL import ImageFile

        ImageFile.MAXBLOCK = max(ImageFile.MAXBLOCK, 4 * 1024 * 1024)
        image.convert("RGB").save(
            destination,
            format="JPEG",
            quality=JPEG_QUALITY,
            subsampling=0,
            optimize=True,
            progressive=False,
        )
    elif suffix == ".png":
        image.save(destination, format="PNG", optimize=True)
    else:
        raise ImageError(f"{destination.name}: write .jpg or .png, not {suffix or 'nothing'}")


def _resize(image, width: int):
    """Downscale to a width. Nothing is ever enlarged."""
    from PIL import Image

    if image.width <= width:
        return image
    height = max(1, round(image.height * width / image.width))
    return image.resize((width, height), Image.LANCZOS)


def import_web_res(
    source: Path,
    destination: Path,
    *,
    crop: tuple[int, int, int, int] | None = None,
    max_width: int = WEB_RES_MAX_WIDTH,
) -> tuple[int, int]:
    """Bring one image in as a web-res asset, returning the size it landed at.

    The source path is a command-line argument and is never recorded: full-size material
    lives outside this repository and stays there.
    """
    with _open(source) as image:
        working = image.crop(crop) if crop else image
        working = _resize(working, max_width)
        _save(working, destination)
        return working.size


def write_thumb(source: Path, destination: Path, size: tuple[int, int]) -> None:
    """Write one thumbnail at exactly the size the metadata says the page expects."""
    from PIL import Image

    with _open(source) as image:
        thumb = image.copy() if image.size == size else image.resize(size, Image.LANCZOS)
        _save(thumb, destination)


def write_rgba(raw: bytes, size: tuple[int, int], destination: Path) -> None:
    """Write a frame the renderer handed over as raw bytes, in the format the suffix names.

    The wasm module's `shade` returns RGBA and nothing else — there is no image encoder
    on that side of the boundary, and there should not be one — so a picture drawn in the
    browser's own renderer and landed in this repository comes through here.
    """
    from PIL import Image

    width, height = size
    if len(raw) != width * height * 4:
        raise ImageError(
            f"{destination.name}: {len(raw)} bytes is not a {width}x{height} RGBA frame"
        )
    _save(Image.frombytes("RGBA", size, raw), destination)
