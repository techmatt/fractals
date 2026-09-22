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
FIGURE_REGISTRY = ARTICLE_DIR / "figures.jsonl"
SECTION_REGISTRY = ARTICLE_DIR / "sections.jsonl"
PROSE_REGISTRY = ARTICLE_DIR / "prose.jsonl"

GALLERY_METADATA_NAME = "gallery.jsonl"
THUMBS_DIR_NAME = "thumbs"

# Trees that are not part of the served site and are never walked by the checks.
UNSERVED_DIRS = frozenset({".git", ".github", ".ruff_cache", ".venv", "artifacts", "scratch"})


def carrier_path(page: str) -> Path:
    """The page a figure row or a prose row names.

    A bare file name is an article section — the case every row was until the palette
    library and the palette prompt arrived, and the one a row should keep saying. A
    name with a `/` in it is site-relative, which is how a page that hangs off a section
    without being one of the twelve is addressed. Two spellings, and the slash is what
    tells them apart, so no row has to say which kind it is. The front page is
    `./index.html`, which is the same rule given the slash a bare name at the root lacks.
    """
    return SITE_ROOT / page if "/" in page else ARTICLE_DIR / page


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
