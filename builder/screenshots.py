"""The figures that are photographs of the site itself (deep_zoom_v4_place_ckpt154).

A screenshot is a figure like any other: a registry row, a provenance, a recipe naming the
maker here, and a picture landed through `images`. What it photographs is the committed
tree, served for the length of one shot by `serve.Server` on a port of its own, so a
preview somebody has up on 8000 is neither needed nor disturbed. `screenshot.mjs` drives a
headless Chrome over CDP and waits for the page to be at rest, because Chrome's own
`--screenshot` shoots at load and photographs the boot notice.

Like `diagram`, no part of `build` or `check`: the page rasterizes its text through the
machine's fonts, so two machines agree about the picture and not about its bytes.

    python -m builder screenshot deep-dive-block            # draw into artifacts/
    python -m builder screenshot deep-dive-block --place    # and land it
"""

from __future__ import annotations

import functools
import json
import subprocess
import threading
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

from . import records
from . import serve as serve_module
from .paths import SITE_ROOT

#: Where a shot lands before `--place` encodes it: lossless, and ignored.
ARTIFACT_DIR = SITE_ROOT / "artifacts" / "screenshots"

#: A port no other rig here uses, so a shot never lands on somebody's preview.
PORT = 8431

#: The window a shot is taken in, and device pixels to a CSS pixel. At 2 the block is drawn
#: at twice the size a reader's 1x screen shows it, so the landed PNG is sharp on a 2x one.
WIDTH, HEIGHT, SCALE = 1600, 1000, 2

SCRIPT = Path(__file__).with_name("screenshot.mjs")


@dataclass(frozen=True)
class Shot:
    """One element of one served page."""

    about: str
    query: str
    selector: str
    #: Controls clicked through the page before the shot, in order, each by its selector:
    #: what a reader would press, so the page's own handlers run and nothing is a default.
    clicks: tuple[str, ...] = ()


@dataclass(frozen=True)
class Drawn:
    path: Path
    provenance: tuple[str, ...]


def dive_block() -> Shot:
    """The Deep tab's Dive block: the sentence at its defaults, on the Mandelbrot plane at the
    tab's opening view, with New coloring on arrival ticked through the page for the shot and
    Keep diving left unticked (Matt, dive_defaults_ckpt154). The box is off by default; it is
    ticked here because the figure shows what a dive can do, not what a first visit sees."""
    return Shot(
        about="the Dive block of the explorer's Deep tab at its default sentence, with New "
        "coloring on arrival ticked by a click on the page and Keep diving unticked",
        query="?panel=deep",
        selector="#dive",
        clicks=("#dive-color",),
    )


MAKERS: dict[str, Callable[[], Shot]] = {"deep-dive-block": dive_block}


def recipe(identifier: str) -> dict:
    if identifier not in MAKERS:
        raise records.RecordError(f"{identifier} is not drawn by {__name__}")
    return {"maker": f"{__name__}:{MAKERS[identifier].__name__}", "args": {}}


class _Quiet(serve_module.Preview):
    """The preview without its request log: a shot asks for a few hundred files."""

    def log_message(self, format: str, *args) -> None:  # noqa: A002 - the base's name
        pass


def _served(port: int) -> tuple[serve_module.Server, threading.Thread]:
    handler = functools.partial(_Quiet, directory=str(SITE_ROOT))
    server = serve_module.Server((serve_module.HOST, port), handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server, thread


def draw(identifier: str) -> Drawn:
    """Serve the tree, photograph the element, and write it lossless under `artifacts/`."""
    if identifier not in MAKERS:
        raise records.RecordError(f"{identifier} is not drawn by {__name__}")
    shot = MAKERS[identifier]()
    ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)
    out = ARTIFACT_DIR / f"{identifier}.png"
    url = f"http://{serve_module.HOST}:{PORT}/explorer/index.html{shot.query}"
    job = {
        "url": url,
        "selector": shot.selector,
        "out": str(out),
        "width": WIDTH,
        "height": HEIGHT,
        "scale": SCALE,
        "clicks": list(shot.clicks),
    }
    server, thread = _served(PORT)
    try:
        subprocess.run(
            ["node", str(SCRIPT), json.dumps(job)], check=True, cwd=SITE_ROOT, timeout=600
        )
    finally:
        server.shutdown()
        server.server_close()
        thread.join()
    maker = MAKERS[identifier].__name__
    provenance = (
        f"no render: a screenshot of {shot.about}. builder.screenshots:{maker} "
        "serves the committed tree and builder/screenshot.mjs photographs "
        f"explorer/index.html{shot.query} over CDP in headless Chrome, a {WIDTH}x{HEIGHT} "
        f"window at device scale {SCALE}, "
        + (f"clicking {', '.join(shot.clicks)} through the page, then " if shot.clicks else "")
        + f"clipped to {shot.selector} once the page is at "
        "rest; `python -m builder screenshot "
        f"{identifier} --replace` takes it again",
    )
    return Drawn(out, provenance)
