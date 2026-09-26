"""Short links into the explorer: `go/<name>/`, one page per row of `go/redirects.jsonl`.

A video description or a slide wants `…/fractals/go/favicon-end/` rather than a
two-hundred-character explorer query, and the query is the permanent thing either way, so
the short name is a page that forwards to it. A row is `name`, `target` — the explorer
query as a site-relative link, `explorer/?<query>` — and an optional one-line `note` that
is the register's alone and never reaches the page. `python -m builder build` writes
`go/<name>/index.html` from each; adding a redirect is one row and a build.

A page forwards by `<meta http-equiv="refresh">` and nothing else — no script — and says
the same target again as its canonical link and as a plain link a reader can click where
the refresh does not fire. It asks not to be indexed, and it is in neither the rail nor the
Contents. Every link on it is relative, so it works at `/fractals/` and on localhost alike,
and names `explorer/index.html` rather than the bare directory, which is what `links`
holds every page here to.

**go** in `builder check` holds two things: every target is a link the explorer's own
reader accepts — `go.mjs` asks `permalink.js` or `deep-link.js`, whichever the page's door
would — and every page under `go/` is byte for byte what the register writes, with no page
standing where no row names one.
"""

from __future__ import annotations

import json
import re
import subprocess
from dataclasses import dataclass
from html import escape
from pathlib import Path

from . import icons
from .paths import SITE_ROOT

GO_DIR = SITE_ROOT / "go"
REGISTER = GO_DIR / "redirects.jsonl"
PAGE = "index.html"
PARSER = SITE_ROOT / "builder" / "go.mjs"

#: What a target opens with. The query after it is the explorer's to read.
TARGET_PREFIX = "explorer/?"

#: A name is a URL a reader types, so it is lowercase words and hyphens and nothing else.
NAME = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")


class GoError(ValueError):
    """The register cannot be read as short links."""


@dataclass(frozen=True)
class Redirect:
    name: str
    query: str
    note: str | None

    @property
    def path(self) -> Path:
        return GO_DIR / self.name / PAGE

    @property
    def href(self) -> str:
        """The target, relative to the page that forwards to it."""
        return f"../../explorer/{PAGE}?{self.query}"


def load() -> list[Redirect]:
    """Every row of the register, in file order."""
    if not REGISTER.is_file():
        raise GoError(f"{REGISTER.relative_to(SITE_ROOT).as_posix()}: no such register")
    found: list[Redirect] = []
    seen: set[str] = set()
    with REGISTER.open(encoding="utf-8") as handle:
        for line, raw in enumerate(handle, start=1):
            if not raw.strip():
                continue
            where = f"go/redirects.jsonl:{line}"
            try:
                row = json.loads(raw)
            except json.JSONDecodeError as error:
                raise GoError(f"{where}: {error.msg}") from error
            if not isinstance(row, dict):
                raise GoError(f"{where}: a row must be a JSON object")
            unknown = set(row) - {"name", "target", "note"}
            if unknown:
                raise GoError(f"{where}: unknown field(s) {', '.join(sorted(unknown))}")
            name, target, note = row.get("name"), row.get("target"), row.get("note")
            if not isinstance(name, str) or not NAME.match(name):
                raise GoError(f"{where}: name must be lowercase words joined by hyphens")
            if name in seen:
                raise GoError(f"{where}: {name} is named twice")
            seen.add(name)
            if not isinstance(target, str) or not target.startswith(TARGET_PREFIX):
                raise GoError(f"{where}: target must open with {TARGET_PREFIX!r}")
            query = target[len(TARGET_PREFIX) :]
            if not query or any(char.isspace() or char in '"<>' for char in query):
                raise GoError(f"{where}: target's query is empty or unfit for a URL")
            if note is not None and (not isinstance(note, str) or "\n" in note or not note):
                raise GoError(f"{where}: note must be one line of text when present")
            found.append(Redirect(name, query, note))
    return found


def page(redirect: Redirect) -> str:
    """The forwarding page for one row."""
    href = escape(redirect.href, quote=True)
    return "\n".join(
        [
            "<!doctype html>",
            '<html lang="en">',
            "<head>",
            '<meta charset="utf-8">',
            '<meta name="viewport" content="width=device-width, initial-scale=1">',
            icons.head(redirect.path),
            "<title>Fractal explorer</title>",
            "<!-- Written by `python -m builder build` from go/redirects.jsonl: edit the row. -->",
            '<meta name="robots" content="noindex">',
            f'<meta http-equiv="refresh" content="0; url={href}">',
            f'<link rel="canonical" href="{href}">',
            '<link rel="stylesheet" href="../../assets/css/site.css">',
            "</head>",
            "<body>",
            "<main>",
            f'  <p>This link opens a view in the fractal explorer. <a href="{href}">Open it '
            "in the fractal explorer</a>.</p>",
            "</main>",
            "</body>",
            "</html>",
            "",
        ]
    )


def pages() -> dict[Path, str]:
    """Every page the register writes, as {path: html}."""
    return {redirect.path: page(redirect) for redirect in load()}


def parsed(redirects: list[Redirect]) -> dict[str, dict]:
    """Each target as the explorer's own reader answers it, by name."""
    completed = subprocess.run(
        ["node", str(PARSER)],
        input=json.dumps({redirect.name: redirect.query for redirect in redirects}),
        capture_output=True,
        text=True,
        encoding="utf-8",
        cwd=SITE_ROOT,
    )
    if completed.returncode != 0:
        raise GoError(completed.stderr.strip() or f"go.mjs exited {completed.returncode}")
    return json.loads(completed.stdout)


def _read(path: Path) -> str:
    with path.open(encoding="utf-8", newline="") as handle:
        return handle.read()


def problems() -> list[str]:
    """The `go` check: every target parses, and every page is the register's own."""
    try:
        redirects = load()
    except GoError as error:
        return [str(error)]
    found = []
    try:
        answers = parsed(redirects)
    except (GoError, OSError) as error:
        found.append(f"go.mjs: {error}")
    else:
        for redirect in redirects:
            answer = answers.get(redirect.name)
            if answer is None or not answer.get("ok"):
                why = "no answer" if answer is None else answer.get("why")
                found.append(f"{redirect.name}: the explorer refuses its target: {why}")
    expected = {redirect.path: page(redirect) for redirect in redirects}
    for path, html in expected.items():
        shown = path.relative_to(SITE_ROOT).as_posix()
        if not path.is_file():
            found.append(f"{shown}: missing — run `python -m builder build`")
        elif _read(path) != html:
            found.append(f"{shown}: differs from what the register writes — run `build`")
    for path in sorted(GO_DIR.rglob("*")):
        if path.is_file() and path != REGISTER and path not in expected:
            found.append(f"{path.relative_to(SITE_ROOT).as_posix()}: no register row writes this")
    return found + _drawn_at(redirects)


def _drawn_at(redirects: list[Redirect]) -> list[str]:
    """Every picture that links through a short link was drawn at the target it links to.

    A picture under a video's player opens its short link, so the link is the register's
    and the picture is the figure's, and the two are free to drift: a moved redirect would
    leave the picture showing somewhere the click no longer goes. The figure's recipe keeps
    each target as it was drawn, under `links`, and this holds that to the register.
    Imported here rather than at the top, because the figures read this module's names.
    """
    from . import figures

    targets = {redirect.name: redirect.query for redirect in redirects}
    found = []
    for figure in figures.load_all().values():
        drawn = (figure.recipe.args.get("links") if figure.recipe else None) or {}
        for panel in figure.panels:
            if panel.go is None:
                continue
            if panel.go not in targets:
                found.append(f"{figure.id}: a panel links to go/{panel.go}, which no row names")
            elif drawn.get(panel.go) != targets[panel.go]:
                found.append(
                    f"{figure.id}: its go/{panel.go} picture was drawn at a target the register "
                    f"no longer names — redraw it with `python -m builder start {figure.id} "
                    "--replace`"
                )
    return found
