"""Where things live, addressed from the checkout root.

Nothing here is an absolute path in tracked code: the root is found from this file's
own location, so a clone works from any directory on any platform.
"""

from pathlib import Path

SITE_ROOT = Path(__file__).resolve().parent.parent

SITE_INDEX = SITE_ROOT / "index.html"
ARTICLE_DIR = SITE_ROOT / "article"
GALLERIES_DIR = SITE_ROOT / "galleries"
IMAGES_DIR = SITE_ROOT / "assets" / "images"
GALLERY_IMAGES_DIR = IMAGES_DIR / "galleries"
FIGURE_IMAGES_DIR = IMAGES_DIR / "figures"
FIGURE_REGISTRY = FIGURE_IMAGES_DIR / "figures.jsonl"
SECTION_REGISTRY = ARTICLE_DIR / "sections.jsonl"

GALLERY_METADATA_NAME = "gallery.jsonl"
THUMBS_DIR_NAME = "thumbs"

# Trees that are not part of the served site and are never walked by the checks.
UNSERVED_DIRS = frozenset({".git", ".github", ".ruff_cache", "artifacts", "scratch"})


def site_pages() -> list[Path]:
    """Every HTML page the site serves, in a stable order."""
    pages = [
        path
        for path in SITE_ROOT.rglob("*.html")
        if not UNSERVED_DIRS.intersection(path.relative_to(SITE_ROOT).parts)
    ]
    return sorted(pages, key=lambda path: path.relative_to(SITE_ROOT).as_posix())


def relative_href(from_page: Path, target: Path) -> str:
    """A relative, POSIX-style href from the page that carries it to the file it names.

    Project Pages serve this site from `/fractal-website/`, so a root-absolute href
    works locally and breaks in production. Every link the builder emits comes from
    here, which is why it cannot emit one.
    """
    source_parts = from_page.resolve().parent.relative_to(SITE_ROOT).parts
    target_parts = target.resolve().relative_to(SITE_ROOT).parts
    shared = 0
    while (
        shared < len(source_parts)
        and shared < len(target_parts) - 1
        and source_parts[shared] == target_parts[shared]
    ):
        shared += 1
    upwards = [".."] * (len(source_parts) - shared)
    return "/".join([*upwards, *target_parts[shared:]])
