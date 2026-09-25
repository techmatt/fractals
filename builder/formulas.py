"""Display formulas, typeset once from TeX and written into the page as inline SVG.

A formula set off on its own line is TeX in the master, spelled as a `$$ … $$` block on a
line of its own, and on the page it is a block that carries that same TeX and the picture
of it:

    <div class="formula" data-tex="z_{n+1} = z_n^2 + c">
      <svg …role="img" aria-label="z sub n plus 1 baseline equals …">…</svg>
    </div>

`data-tex` is the source and the SVG is output. `python -m builder formulas` fills every block
from its TeX, so placing a formula is writing the empty `<div>` with the master's TeX in
it and running that command; editing one is editing the TeX, on the page and in the
master, and running it again. `python -m builder prose` compares the TeX and never the
SVG — see `prose.py`.

What the picture is held to, and why each:

- **No script and no web font on the page.** Every glyph is a path, and the page carries
  nothing that runs; the formula is drawn when the page is written, not when it is read.
- **`currentColor`.** MathJax fills and strokes with it, so a formula is the colour of the
  text around it and follows it wherever that text goes.
- **A spoken reading.** `aria-label` on the `<svg>`, from MathJax's speech rule engine in
  its ClearSpeak style — "lim over epsilon right arrow 0 of …" — rather than the TeX, which
  a screen reader would spell backslash by backslash.

**The renderer is MathJax, pinned and fetched, never installed.** It runs on node, which
the builder already needs for its other `.mjs` helpers, and needs no TeX. The site has no
npm and no `package.json`, and is not getting one for this: `fetch` downloads the two
tarballs `MATHJAX` names from the npm registry over plain HTTPS, holds each to its pinned
SHA-512, and unpacks them into ignored `artifacts/mathjax/`. Nothing of it is committed and
nothing of it is served. A version bump is an edit to `MATHJAX` followed by `formulas`, which
rewrites every formula, and the diff is the review.

**`check`'s `formulas` check has two halves.** The shape half runs everywhere: no
`<pre class="formula">` is left, and every block has TeX, one SVG, a role, a reading, and
no `<text>`. The render half re-typesets every formula and holds the page to it byte for
byte, which MathJax's output is — same version, same bytes, on any machine, because the
glyphs come out of the pinned font's path data and not out of whatever fonts the machine
has. Where MathJax has not been fetched or node is missing, that half is a named skip.
"""

import base64
import hashlib
import html
import io
import json
import re
import shutil
import subprocess
import tarfile
import urllib.request
from dataclasses import dataclass
from pathlib import Path

from .paths import SITE_ROOT, site_pages

#: The two packages, pinned by version and by the registry's own integrity hash. The font
#: is MathJax 4's default and its own package; `mathjax` depends on it by `^4.1.3`, and
#: that range is pinned here to one file.
MATHJAX = (
    (
        "mathjax",
        "https://registry.npmjs.org/mathjax/-/mathjax-4.1.3.tgz",
        "sha512-BN/8Pkgn7G1pIDYJqd9md+JHsE/jydSYbyOZnSdSA0WziuVO8mRxdYiWFumkVVly/8U+hm9DpIIoWuvySverzw==",
    ),
    (
        "@mathjax/mathjax-newcm-font",
        "https://registry.npmjs.org/@mathjax/mathjax-newcm-font/-/mathjax-newcm-font-4.1.3.tgz",
        "sha512-gzAB3dFHilHX1l5x2xUqRL+1jDQt3Fyza1DkEMVXWC4E8SvsGdlgEza47HYi2WhVcgfkvf4zgUGzuhbq3Pjlew==",
    ),
)
VERSION = "4.1.3"

#: Where the fetched copy is unpacked: one directory per version, so a bump never runs
#: against a half-replaced tree.
MODULES = SITE_ROOT / "artifacts" / "mathjax" / VERSION / "node_modules"
RENDERER = Path(__file__).with_name("formulas.mjs")

#: A formula block as a page carries it. The body is whatever the last `formulas` wrote, or
#: nothing at all for a block that has just been placed.
FORMULA = re.compile(
    r'(?P<indent>[ ]*)<div class="formula" data-tex="(?P<tex>[^"]*)">(?P<body>.*?)</div>',
    re.S,
)
_OLD_FORMULA = re.compile(r'<pre class="formula"')
_SVG_OPEN = re.compile(r"<svg\b([^>]*)>")
_ATTRIBUTE = re.compile(r'([a-zA-Z:-]+)="([^"]*)"')
_DATA_ATTRIBUTE = re.compile(r' data-[a-z-]+="[^"]*"')

#: Where the speech rule engine's ClearSpeak reading says something no reader would, and
#: the fix, as whole phrases. Each is general rather than one formula's: an upright capital
#: delta is read as a triangle wherever it appears, however it is spelled in TeX, and `\ln`
#: letter by letter. What is *not* here is the engine reading `N(−¾ + εi)` as N times a
#: bracket: it reads `N(c)` as a function and a compound argument as a product, and a
#: phrase fix for that would be wrong wherever a letter really does multiply one.
READING_FIXES = (
    ("normal triangle", "capital delta"),
    ("l n", "natural log"),
)

#: The opening tag's attributes that survive, in the order they are written back. The rest
#: — MathJax's inline `vertical-align`, which a block does not want, and `focusable` — go.
_KEPT = ("xmlns", "width", "height", "viewBox")


class FormulaError(Exception):
    """A formula could not be typeset, or MathJax is not here to typeset it."""


@dataclass(frozen=True)
class Typeset:
    """One formula, drawn and read aloud."""

    svg: str
    speech: str


# ------------------------------------------------------------------------- the renderer


def fetched() -> bool:
    return all((MODULES / name / "package.json").is_file() for name, _, _ in MATHJAX)


def unaskable() -> str | None:
    """Why a formula cannot be typeset on this machine, or `None` where it can."""
    if shutil.which("node") is None:
        return "node is not on PATH here"
    if not fetched():
        return f"MathJax {VERSION} is not fetched here (python -m builder formulas --fetch)"
    return None


def fetch() -> list[str]:
    """Download, verify and unpack the pinned MathJax, or say it is already here."""
    lines = []
    for name, url, integrity in MATHJAX:
        target = MODULES / name
        if (target / "package.json").is_file():
            lines.append(f"{name} {VERSION} is already at {_shown(target)}")
            continue
        with urllib.request.urlopen(url, timeout=120) as response:
            payload = response.read()
        algorithm, expected = integrity.split("-", 1)
        actual = base64.b64encode(hashlib.new(algorithm, payload).digest()).decode("ascii")
        if actual != expected:
            raise FormulaError(f"{url}: {algorithm} is {actual}, and the pin says {expected}")
        _unpack(payload, target)
        lines.append(f"fetched {name} {VERSION} into {_shown(target)}")
    return lines


def _unpack(payload: bytes, target: Path) -> None:
    """An npm tarball's `package/` directory, unpacked as `target`."""
    staging = target.with_name(target.name + ".partial")
    shutil.rmtree(staging, ignore_errors=True)
    staging.mkdir(parents=True)
    with tarfile.open(fileobj=io.BytesIO(payload), mode="r:gz") as archive:
        for member in archive.getmembers():
            if not member.isfile():
                continue
            parts = Path(member.name).parts
            if parts[0] != "package" or ".." in parts:
                raise FormulaError(f"{target.name}: unexpected member {member.name}")
            destination = staging.joinpath(*parts[1:])
            destination.parent.mkdir(parents=True, exist_ok=True)
            source = archive.extractfile(member)
            if source is None:
                raise FormulaError(f"{target.name}: unreadable member {member.name}")
            destination.write_bytes(source.read())
    shutil.rmtree(target, ignore_errors=True)
    staging.rename(target)


def typeset(texs: list[str]) -> list[Typeset]:
    """Every formula in `texs`, in order, as the SVG a page carries."""
    reason = unaskable()
    if reason is not None:
        raise FormulaError(reason)
    completed = subprocess.run(
        ["node", str(RENDERER), str(MODULES)],
        input=json.dumps(texs),
        capture_output=True,
        text=True,
        encoding="utf-8",
        cwd=str(SITE_ROOT),
    )
    if completed.returncode != 0:
        exited = f"formulas.mjs exited {completed.returncode}"
        raise FormulaError(completed.stderr.strip() or exited)
    drawn = json.loads(completed.stdout)
    return [_cleaned(tex, row["svg"], row["speech"]) for tex, row in zip(texs, drawn, strict=True)]


def _cleaned(tex: str, svg: str, speech: str) -> Typeset:
    """MathJax's SVG with its bookkeeping out and its reading in.

    MathJax annotates every node with `data-` attributes for its own explorer — the
    semantic tree, the TeX of every sub-expression — which is most of the bytes and none
    of the picture. They go, and the opening tag is rewritten to carry the reading.
    """
    if 'data-mml-node="merror"' in svg:
        raise FormulaError(f"MathJax could not parse {tex!r}")
    opening = _SVG_OPEN.match(svg)
    if opening is None:
        raise FormulaError(f"no <svg> for {tex!r}")
    attributes = dict(_ATTRIBUTE.findall(opening.group(1)))
    missing = [name for name in _KEPT if name not in attributes]
    if missing:
        raise FormulaError(f"{tex!r}: MathJax's <svg> carries no {', '.join(missing)}")
    reading = f" {' '.join(html.unescape(speech).split())} "
    for wrong, right in READING_FIXES:
        reading = reading.replace(f" {wrong} ", f" {right} ")
    reading = reading.strip()
    kept = " ".join(f'{name}="{attributes[name]}"' for name in _KEPT)
    head = f'<svg {kept} role="img" aria-label="{html.escape(reading)}">'
    body = _DATA_ATTRIBUTE.sub("", svg[opening.end() :])
    return Typeset(svg=head + body, speech=reading)


# ------------------------------------------------------------------------- the pages


def pages_with_formulas() -> list[Path]:
    return [path for path in site_pages() if 'class="formula"' in _read(path)]


def block(indent: str, tex: str, svg: str) -> str:
    """A formula block, as `formulas` writes it: TeX on the div, the picture inside."""
    return f'{indent}<div class="formula" data-tex="{tex}">\n{indent}  {svg}\n{indent}</div>'


def _expected(page_html: str, drawn: dict[str, Typeset]) -> str:
    return FORMULA.sub(
        lambda found: block(
            found.group("indent"), found.group("tex"), drawn[html.unescape(found.group("tex"))].svg
        ),
        page_html,
    )


def _drawn_for(paths: list[Path]) -> dict[str, Typeset]:
    texs = sorted(
        {
            html.unescape(found.group("tex"))
            for path in paths
            for found in FORMULA.finditer(_read(path))
        }
    )
    return dict(zip(texs, typeset(texs), strict=True))


def write() -> list[str]:
    """Typeset every formula on every page, and rewrite the pages whose SVG moved."""
    paths = pages_with_formulas()
    drawn = _drawn_for(paths)
    lines = []
    for path in paths:
        before = _read(path)
        after = _expected(before, drawn)
        count = len(FORMULA.findall(before))
        if after == before:
            lines.append(f"{_shown(path)}: {count} formula(s), unchanged")
            continue
        with path.open("w", encoding="utf-8", newline="\n") as handle:
            handle.write(after)
        lines.append(f"{_shown(path)}: {count} formula(s), rewritten")
    for tex, typeset_ in drawn.items():
        lines.append(f"  {tex}\n    reads: {typeset_.speech}")
    return lines


# ------------------------------------------------------------------------- the check


def problems(with_renderer: bool) -> list[str]:
    """The shape of every formula block everywhere; its bytes, where MathJax is here."""
    found = []
    paths = [path for path in site_pages() if "formula" in _read(path)]
    for path in paths:
        page_html = _read(path)
        if _OLD_FORMULA.search(page_html):
            found.append(
                f'{_shown(path)}: a <pre class="formula"> is left — a display formula is '
                "TeX in a formula block now"
            )
        for match in FORMULA.finditer(page_html):
            found.extend(_shape(path, match))
    if with_renderer and not found:
        with_blocks = [path for path in paths if FORMULA.search(_read(path))]
        drawn = _drawn_for(with_blocks)
        for path in with_blocks:
            if _expected(_read(path), drawn) != _read(path):
                found.append(
                    f"{_shown(path)}: a formula is not what its TeX typesets to "
                    "(python -m builder formulas)"
                )
    return found


def _shape(path: Path, match: re.Match[str]) -> list[str]:
    tex, body = html.unescape(match.group("tex")), match.group("body")
    where = f"{_shown(path)}: formula {tex!r}" if tex.strip() else f"{_shown(path)}: a formula"
    if not tex.strip():
        return [f"{where} has no TeX"]
    if body.count("<svg") != 1:
        return [f"{where} carries {body.count('<svg')} <svg> (python -m builder formulas)"]
    wrong = []
    opening = _SVG_OPEN.search(body)
    attributes = dict(_ATTRIBUTE.findall(opening.group(1))) if opening else {}
    if attributes.get("role") != "img":
        wrong.append('its <svg> is not role="img"')
    if not attributes.get("aria-label", "").strip():
        wrong.append("its <svg> carries no spoken reading")
    if "<text" in body:
        wrong.append("its <svg> sets text, which wants a font the page does not carry")
    if "currentColor" not in body:
        wrong.append("its <svg> is not drawn in currentColor")
    return [f"{where}: {problem}" for problem in wrong]


def _read(path: Path) -> str:
    with path.open(encoding="utf-8", newline="") as handle:
        return handle.read()


def _shown(path: Path) -> str:
    return path.relative_to(SITE_ROOT).as_posix()
