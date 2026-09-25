"""Guard: the em-dash rule, over the words a reader actually meets.

`writing-guidance.md` bans the em-dash from article body and figure captions — they read
as machine-written — and says to recast each one as a parenthesis, a colon or two
sentences. The rule was held by whoever was reading, page by page, at Matt's pace: the
sweep ran from 2026-09-06 to 2026-09-07 and it took a register in `docs/page-review.md`
to say which pages were clean. That register is a count somebody typed, and nothing
regenerated it.

**It is a check now** *(Matt, 2026-09-07)*. The site is at zero, so it adopts green, and
the regression it exists to catch is not a page drifting on its own: it is a page
**arriving** from a design session with em-dashes in it, which is what every placed page
did. Caught at placement, that is a short recast; caught a round later, it is another
sweep of the whole page. A failure names the page and quotes the words around each one,
because the point is to fix them on the spot rather than to know how many there are.

Three edit sites, three readings, and they are the three columns the register already
had. **Body** is the page's words reduced the way `python -m builder prose` reduces them
— figures, comments and table heads out, then every tag — so what is compared to a master
is what is swept here. **Captions** and **alt** are the figure registry's own fields,
because a caption lives in the row and never on the page.

What is covered, and why it stops where it does:

- **every section** of the article, written or not. A stub is prose a reader can read:
  `fractal-atlases.html` carried one em-dash in the intro above its *not written yet*
  line, and the register's body column read zero for it because the column was defined as
  `section.prose` and a stub has none. `words_of_body` falls back to `<main>`, which is
  what closed that gap.
- **`palettes/make-your-own.html`**, the page that hangs off Color palettes, which the
  register always carried.
- **`index.html`**, the front page: a lead, fourteen section blurbs and two pointers, all of
  it reader-facing prose with no master behind it, and outside every register until now.
- **the gallery index**, whose prose is two paragraphs and carries none.

And what it does not reach. A page's `<title>` is furniture rather than prose and spells
its separator `Overview — Making Fractal Wallpapers` site-wide; the contents rail is
derived by `build`; both sit outside `<main>` and outside this. `palettes/all-palettes.html`
is generated, and its em-dashes are the generator's — a hue heading and the lead — so the
place to rule on those is `builder/palettes.py` and not a check that can only report them.
The explorer and the atlas are tool pages rather than sections and carry one recast each
in their served-not-filesystem note. **Text drawn into a figure is not counted here or
anywhere** *(Matt, 2026-09-06)*, so a sheet that letters one is not a defect.

There is no allowlist. The guidance keeps one carve-out — an em-dash *may* stand where no
recast preserves the meaning, which it calls rare — and with the rule mechanical that
carve-out costs an edit to this file, which is the right price: it makes the exception a
thing somebody wrote down rather than a thing somebody left in.
"""

from pathlib import Path

from . import figures, prose, sections
from .paths import ARTICLE_DIR, SITE_INDEX, SITE_ROOT, carrier_path

#: The one character. Not the en-dash, which the guidance says nothing about and which
#: this site spells in a numeric range rather than as punctuation between clauses.
EM_DASH = "—"

#: The pages that carry reader-facing prose without being a section of the article.
#: `index.html` cannot be addressed the way a registry row addresses a page — a bare name
#: is an article section, so `carrier_path` would read it as `article/index.html` — which
#: is why the front page is named by its path here and labelled by hand.
EXTRA_PAGES = ("./start-here.html", "palettes/make-your-own.html", "wallpaper-packs/index.html")

#: How many words of context a quoted offender carries on each side. Enough to find the
#: sentence in the page, short enough that ten of them are still a list somebody reads.
WINDOW = 7


def covered() -> list[tuple[str, Path]]:
    """Every page this sweep reads, as the name it is reported under and its path."""
    found = [(SITE_INDEX.relative_to(SITE_ROOT).as_posix(), SITE_INDEX)]
    found += [(section.page, ARTICLE_DIR / section.page) for section in sections.load_all()]
    found += [(page, carrier_path(page)) for page in EXTRA_PAGES]
    return found


def quoted(text: str) -> list[str]:
    """The words around each em-dash in one reduced string, one quotation each."""
    words = text.split()
    return [
        "..." + " ".join(words[max(0, index - WINDOW) : index + WINDOW + 1]) + "..."
        for index, word in enumerate(words)
        if EM_DASH in word
    ]


def in_page(label: str, path: Path) -> list[str]:
    """One page's body, as `page: body: the words around it`.

    A page this sweep names and cannot find is a problem rather than a page with no
    em-dashes in it: a guard that answers `ok` for a file it never opened is the shape
    of bug the rest of this package's checks are written against.
    """
    if not path.is_file():
        return [f"{label}: named for the em-dash sweep, and not a page of this site"]
    text = prose.words_of_body(path.read_text(encoding="utf-8"))
    return [f"{label}: body: {found}" for found in quoted(text)]


def in_figures() -> list[str]:
    """Every caption and every alt in the registry, by figure id and by field."""
    problems = []
    for figure in sorted(figures.load_all().values(), key=lambda found: found.id):
        for field, text in (("caption", figure.caption), ("alt", figure.alt)):
            problems += [f"figures.jsonl: {figure.id}: {field}: {found}" for found in quoted(text)]
    return problems


def sweep() -> list[str]:
    """Every em-dash in reader-facing prose, quoted, or an empty list."""
    problems = []
    for label, path in covered():
        problems.extend(in_page(label, path))
    return problems + in_figures()
