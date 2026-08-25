"""Guard: words this site does not ship, in prose and in names alike.

`writing-guidance.md` keeps a banned list, and the naming rule in `CLAUDE.md` says
nothing ships under a name the article would not teach. Both were enforced by whoever
happened to be reading. This sweeps every tracked file instead.

Three terms are on the list today, and none is spelled plainly anywhere in this file —
each is written with one character in a class, so the module that bans a word is not
itself a hit. The compiled patterns are unaffected.

* **`sittin[g]`** — filler wherever it appears, and an old drop name from a private
  version of this project.
* **`fractal typ[e]`** — banned in both of the senses it was covering *(Matt,
  2026-08-21)*. The engine concept is a **family**: mandelbrot, julia, phoenix,
  multibrot, as Overview teaches it. The supply-allocation bucket is a **partition**:
  one per family at one degree, with a parameter plane counted apart from its dynamical
  twin. "Type" merged the two, and a reader who met it in one sense carried the wrong
  idea into the other.
* **`emissio[n]`** — vocabulary from a private version of this project with nothing on
  this site behind it *(Matt, 2026-08-22)*. It has been on the wallpaper project's list
  since that repository's own sweep, and it enters this one because a name does not have
  to be copied across to arrive: it can be written fresh by somebody who met it in a
  report.

One banned word is deliberately **not** here. `writing-guidance.md` bans **colormap** in
reader-facing text — the article's word for the thing is *palette*, and a reader who meets
both learns two names for one idea — and it stops at the reader, because the same word is
the engine's own field name. A figure's `provenance`, the link registry, the permalink
contract and the wasm all spell it, and one of this repository's rules depends on its being
spelled: the single `colormap` line of a figure's provenance is what bakes that map into
the explorer. A sweep over tracked files cannot tell prose from a field name, so that ban
is held editorially and this list stays the part a machine can decide.

The wallpaper project's `tests/test_banned_vocabulary.py` guards a longer list, and its
extra entries are all *code* names out of an older codebase. None of them can reach this
repository — nothing is copied across without being rewritten — so this is the prose half
of the shared list rather than a second copy of the whole thing.

A second list bans **framing a run by the clock** *(Matt, 2026-08-25, site-wide)*. A run
is described by its budget in hours and by what it produced, never by what time of day it
was still going: the word for the dark half of a day, the one that runs through it, and
the one for the start of the next are all off. They are on this list rather than held
editorially because the shape they arrive in is a sentence somebody writes once — "left it
running, and by then it had found forty" — and nobody re-reads a page looking for it.

Those three are matched with a boundary of their own: a neighbouring hyphen means the word
is part of a **name**, and names are the naming rule's business rather than this one's. The
palette library next door holds maps whose authors called them after the time of day, and
this repository records the map a picture was drawn in exactly as the library spells it.
The ban is on a sentence framing a run, not on a gradient's name.

A term is banned as a **name**, not as a substring: a hit is a match whose neighbours are
not letters. `\\b` would be wrong, because `_` is a word character and snake_case is a
form these names take. There are no exceptions and there is no allowlist. `scratch/` and
`artifacts/` are exempt *by construction* rather than by exception — they are untracked,
so a report may discuss the old vocabulary freely, and that is why this walks the git
index rather than the tree. The cost of that choice: a file only becomes visible to this
sweep once it is staged, so the run that first stages a new file is the run that first
checks it.
"""

import re
import subprocess

from .paths import SITE_ROOT

#: Each term with one character written as a class, so this file is not a hit for its
#: own list. Nothing here spells a banned term plainly, and nothing may: a guard that
#: needs an exception for itself is one exception away from needing another.
BANNED_TERMS = (
    "sittin[g]",
    "fractal typ[e]",
    "emissio[n]",
)

#: The clock terms, written the same way. Reader-facing text never frames a run by the
#: hour of the day it was still running *(Matt, 2026-08-25)* — a run has a budget in
#: hours and a set of admissions, and neither of those is a time on a clock.
CLOCK_TERMS = (
    "nigh[t]",
    "overnigh[t]",
    "mornin[g]",
)


def spelled_out(term: str) -> str:
    """The term as a person writes it, for a message naming something recognizable."""
    return term.replace("[", "").replace("]", "")


def pattern_for(term: str) -> re.Pattern:
    r"""The term as it is looked for: any separator between its words, and a plural.

    A letter on either side means this is a longer word and not the term. Anything else —
    a separator, a digit, a space, the end of the line — means the term is there. Not
    `\b`: `_` is a word character, and snake_case is a form these names take.
    """
    body = term.replace(" ", "[ _-]")
    return re.compile(rf"(?<![a-z]){body}s?(?![a-z])", re.IGNORECASE)


def clock_pattern_for(term: str) -> re.Pattern:
    """A clock term as it is looked for: the word itself, and never inside a name.

    A hyphen on either side is the difference between a sentence and a name. The palette
    library holds maps their authors named after the time of day, and a figure's
    provenance spells the map exactly as the library does — those are names, and the
    naming rule governs them. What this catches is the word standing on its own.
    """
    return re.compile(rf"(?<![a-z-]){term}s?(?![a-z-])", re.IGNORECASE)


BANNED = tuple((spelled_out(term), pattern_for(term)) for term in BANNED_TERMS) + tuple(
    (spelled_out(term), clock_pattern_for(term)) for term in CLOCK_TERMS
)

#: Suffixes that are not text. Reading one costs nothing but says nothing either.
BINARY_SUFFIXES = frozenset({".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".wasm"})


def tracked_files() -> list[str]:
    """Every file git is tracking, as POSIX paths from the repository root."""
    completed = subprocess.run(
        ["git", "ls-files", "-z"],
        cwd=str(SITE_ROOT),
        capture_output=True,
        text=True,
        check=True,
    )
    return [name for name in completed.stdout.split("\0") if name]


def offenders_in(name: str, text: str) -> list[str]:
    """Every banned name in one file, as `file:line: the term`."""
    return [
        f"{name}:{number}: {term}"
        for number, line in enumerate(text.splitlines(), start=1)
        for term, pattern in BANNED
        if pattern.search(line)
    ]


def sweep() -> list[str]:
    """The banned vocabulary in tracked files, or an empty list."""
    problems = []
    for name in tracked_files():
        if any(name.lower().endswith(suffix) for suffix in BINARY_SUFFIXES):
            continue
        path = SITE_ROOT / name
        if not path.is_file():
            continue
        try:
            text = path.read_text(encoding="utf-8")
        except (UnicodeDecodeError, OSError):
            continue
        problems.extend(offenders_in(name, text))
    return problems
