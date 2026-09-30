"""The figures of the Tools and data page: one small picture under each section's heading.

    python -m builder tools [ID ...] [--place] [--replace]

The page is four sections, each a thing this project made that somebody else could use, and
each figure shows what the section offers *(tools_figures_ckpt156)*:

* `tools-atlas`, **Gallery locations** — the atlas plates, one per plane, each a way into
  its plane on the explorer's Atlas tab (`builder/tools_atlas.py`);
* `tools-palettes`, **Palettes** — every hand-made palette as a thin strip, by hue family in
  the wheel's order and then by mean lightness (`builder/tools_palettes.py`);
* `tools-judges`, **Judges** — five examples across each judge's range of scores, shown the
  way that judge sees them (`builder/tools_judges.py`);
* `tools-labels`, **Hand labels** — four seeded-random pictures at each of Matt's four
  ratings (`builder/tools_labels.py`).

Each figure's maker is its own module, because the four share nothing but the page; this
one is the table `builder/__main__.py` drives, in the shape every other page's maker has.
Nothing here is chosen for how it looks: each module's provenance states the rule it drew by.
"""

from __future__ import annotations

from importlib import import_module

from . import records
from .locations import Split

#: Which figure is drawn by which module, in page order.
MODULES = {
    "tools-atlas": "tools_atlas",
    "tools-palettes": "tools_palettes",
    "tools-judges": "tools_judges",
    "tools-labels": "tools_labels",
}
MAKERS = tuple(MODULES)


def _module(identifier: str):
    if identifier not in MODULES:
        raise records.RecordError(f"{identifier} is not drawn by {__name__}")
    return import_module(f"{__package__}.{MODULES[identifier]}")


def composite(identifier: str) -> bool:
    """Whether the figure is one composed sheet rather than panels: a module that says so."""
    return bool(getattr(_module(identifier), "COMPOSITE", False))


def keep(identifier: str) -> None:
    """Land the figure-recipes rows a module's panels read their links off, where it has any."""
    module = _module(identifier)
    if hasattr(module, "keep"):
        module.keep(identifier)


def sources(identifier: str) -> list[dict]:
    return _module(identifier).sources()


def recipe(identifier: str) -> dict:
    return _module(identifier).recipe()


def draw(identifier: str) -> Split:
    return _module(identifier).make()
