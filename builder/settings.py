"""This machine's own answers about where things outside the checkout live.

No absolute path is committed in this repository, and the folders this builder
sometimes reaches — the wallpaper project next door, the Drive-synced working folder —
are not in the same place on two machines. So each one is named either by an
environment variable or by an untracked `local.toml` at the checkout root, and the
variable wins. Both halves of that rule used to live inside `renders.py`, which is the
engine seam and had no business being imported by anything that only wanted to read a
setting.
"""

import os
import tomllib
from pathlib import Path

from .paths import SITE_ROOT

#: This repository's own untracked settings, read from the checkout root.
LOCAL_SETTINGS = SITE_ROOT / "local.toml"


def read_settings(path: Path) -> dict:
    """One TOML settings file, or an empty mapping where there is none.

    Read fresh every time. Caching would mean a process that started with a disk
    unplugged could never be told it is plugged in now, and the read is one small file.
    """
    if not path.is_file():
        return {}
    return tomllib.loads(path.read_text(encoding="utf-8"))


def configured(settings: dict, key: str, variable: str) -> Path | None:
    """A path from the environment or the settings file, with the environment winning.

    Set to nothing is a statement, not an absence: it says *this machine has no such
    root*, overriding a file that says otherwise.
    """
    stated = os.environ.get(variable)
    if stated is not None:
        return Path(stated) if stated.strip() else None
    value = settings.get(key)
    return Path(str(value)) if value else None


def local(key: str, variable: str) -> Path | None:
    """A path this repository's own settings name, however this machine names it."""
    return configured(read_settings(LOCAL_SETTINGS), key, variable)
