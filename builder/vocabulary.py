"""Guard: words this site does not ship, in prose and in names alike.

`writing-guidance.md` keeps a banned list, and the naming rule in `CLAUDE.md` says
nothing ships under a name the article would not teach. Both were enforced by whoever
happened to be reading. This sweeps every tracked file instead.

Two terms are on the list today:

* **"sitting"** — filler wherever it appears, and an old drop name from a private
  version of this project.
* **"fractal type"** — banned in both of the senses it was covering *(Matt,
  2026-08-21)*. The engine concept is a **family**: mandelbrot, julia, phoenix,
  multibrot, as Overview teaches it. The supply-allocation bucket is a **partition**:
  one per family at one degree, with a parameter plane counted apart from its
  dynamical twin. "Type" merged the two, and a reader who met it in one sense carried
  the wrong idea into the other.

The wallpaper project's `tests/test_banned_vocabulary.py` guards a longer list, and the
extra entries there are all *code* names out of an older codebase. None of them can
reach this repository — nothing is copied across without being rewritten — so this list
is the prose half of the shared one rather than a second copy of the whole thing.

A term is banned as a **name**, not as a substring: a hit is a match whose neighbours
are not letters. `\\b` would be wrong, because `_` is a word character and snake_case is
a form these names take. `scratch/` and `artifacts/` are exempt by construction rather
than by exception — they are untracked, so a report may discuss the old vocabulary
freely, which is the whole reason this walks the git index and not the tree.
"""

import re
import subprocess

from .paths import SITE_ROOT

#: Each term's last character is written as a character class, so this file is not
#: itself a match for the pattern it compiles. The compiled regex is unaffected.
BANNED_TERMS = (
    "sittin[g]",
    "fractal[ _\\-]typ[e]s?",
)

#: A letter on either side means this is a longer word and not the term. Anything else —
#: a separator, a digit, a space, the end of the line — means the term is there.
BANNED = tuple(re.compile(rf"(?<![a-z]){term}(?![a-z])", re.IGNORECASE) for term in BANNED_TERMS)

#: Suffixes that are not text. Reading one costs nothing but says nothing either.
BINARY_SUFFIXES = frozenset({".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".wasm"})


def spelled_out(term: str) -> str:
    """The term as a person writes it, with the escaping brackets removed."""
    return term.replace("[", "").replace("]", "")


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
        f"{name}:{number}: {spelled_out(BANNED_TERMS[index])}"
        for number, line in enumerate(text.splitlines(), start=1)
        for index, pattern in enumerate(BANNED)
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
