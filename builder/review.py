"""Review docs: a page's words in a form Matt can mark up, and read back afterwards.

The loop this serves is two commands, both of them Matt's:

    create the review doc for <page>   →  python -m builder review <page>
    apply the review doc for <page>    →  python -m builder review <page> --read

A review doc is a `.docx` in the Drive-synced `review/` folder, which means it opens in
Google Docs, gets marked up there, and syncs back to the same file. It carries the
page's prose *as served* — no HTML, no editorial scaffolding — then every figure caption
on the page, by slug, so caption feedback lands in the same document rather than in a
second channel. `docs/page-review.md` is the workflow; this module is the mechanics.

**Why a .docx written by hand.** The format is a zip of XML, and the part of it a
document like this needs is small enough to spell out. No dependency, no build step, and
nothing to install on a machine that has only the standard library — the same bargain
the rest of this builder makes. Reading back needs even less: paragraphs, in order, as
text.

Formatting does not survive the round trip and is not asked to. Links, italics and code
spans are flattened on the way out; the apply session re-applies each edit to the HTML,
where that markup is still sitting. What a review doc carries is words.
"""

import difflib
import json
import re
import shutil
import xml.etree.ElementTree as ElementTree
import zipfile
from dataclasses import dataclass
from datetime import date
from pathlib import Path

from . import figures as figures_module
from . import prose

#: Every part of the package, and the one namespace inside the document.
WORD = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
PACKAGE_RELATIONSHIPS = "http://schemas.openxmlformats.org/package/2006/relationships"
OFFICE_RELATIONSHIPS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
DOCUMENT_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"
STYLES_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"

#: A fixed timestamp on every zip entry: the same doc built twice is the same bytes.
FIXED_STAMP = (1980, 1, 1, 0, 0, 0)

SUFFIX = ".docx"
NATIVE_SUFFIX = ".gdoc"

#: The paragraph styles the doc uses, and what each is for.
TITLE = "Title"
HEADING = "Heading1"
SUBHEADING = "Heading2"
NORMAL = "Normal"
CODE = "Code"

#: How a figure appears in the prose flow, and how a caption line is spelled.
FIGURE_MARKER = "[figure: {id}]"
CAPTION_LINE = "{id}: {caption}"
PENDING_LINE = "{id} — text shown while the picture is pending: {alt}"
STANDFIRST_LINE = "Standfirst: {text}"

CONVENTION = (
    "Edit the text directly where you want different wording. A direct edit means "
    "roughly this wording — it is applied in spirit, not pasted in.",
    "Write [M: ...] for anything that is not itself the new wording: an instruction, a "
    "question, a comment. Every one of them is carried out, and a question is answered "
    "in the report that comes back.",
    "Leave the [figure: slug] markers alone — they only say where a picture sits. "
    "Captions are at the end of this doc, one line per slug; edit them there.",
    "Links, italics and code spans are flattened here. They are still on the page, and "
    "they survive an edit that does not delete the words carrying them.",
    "A new factual claim — a number, a mechanism, a name — is verified against the code "
    "and the records before it lands, or it is flagged in the report and left out.",
)


class ReviewError(Exception):
    """A review doc could not be written, found, or read."""


@dataclass(frozen=True)
class Paragraph:
    """One paragraph of the doc: the style it carries and what it says."""

    style: str
    text: str


@dataclass(frozen=True)
class State:
    """Where one page's review doc is in the loop."""

    page: str
    waiting: Path | None
    applied: tuple[Path, ...]


# ------------------------------------------------------------------ where the docs live


def slug_of(page: str) -> str:
    """The page's own name, which is what its review doc is named after."""
    return page[: -len(".html")] if page.endswith(".html") else page


def doc_path(page: str) -> Path:
    return prose.review_dir() / f"{slug_of(page)}{SUFFIX}"


def native_path(page: str) -> Path:
    """Where a Google-native doc would sit, if Matt converted the .docx to one."""
    return prose.review_dir() / f"{slug_of(page)}{NATIVE_SUFFIX}"


def state_of(page: str) -> State:
    """Whether a doc is waiting for this page, and what has already been applied."""
    waiting = next((path for path in (doc_path(page), native_path(page)) if path.is_file()), None)
    applied = prose.applied_dir()
    consumed = sorted(applied.glob(f"{slug_of(page)}-*")) if applied.is_dir() else []
    return State(page=page, waiting=waiting, applied=tuple(consumed))


# ------------------------------------------------------------------- building the words


def paragraphs_for(page: str, master: prose.Master | None) -> list[Paragraph]:
    """Everything the review doc says, in order: the convention, the prose, the captions."""
    page_html = prose.read_page(page)
    blocks = prose.blocks_of(page_html)
    if not blocks:
        raise ReviewError(
            f"{page} has no prose yet — a stub has nothing to review. Write the section first."
        )
    source = master.file if master else "none — this page's HTML is its own master"
    written = [
        Paragraph(TITLE, f"{prose.title_of(page_html)} — review"),
        Paragraph(
            NORMAL,
            f"Page: article/{page} · Prose master: {source} · Built {date.today():%Y-%m-%d}",
        ),
        Paragraph(HEADING, "How to mark this doc"),
        *(Paragraph(NORMAL, line) for line in CONVENTION),
        Paragraph(HEADING, "Prose"),
    ]
    # A page need not carry a standfirst — the 2026-08-21 review ruled the device off
    # `finding-good-locations`, and an empty "Standfirst:" line in the doc is a line
    # Matt can mark up that stands for nothing.
    standfirst = prose.standfirst_of(page_html)
    if standfirst:
        written.append(Paragraph(NORMAL, STANDFIRST_LINE.format(text=standfirst)))
    written.extend(_prose_paragraphs(blocks))
    written.extend(_caption_paragraphs(blocks))
    return written


def _prose_paragraphs(blocks: list[prose.Block]) -> list[Paragraph]:
    written = []
    for block in blocks:
        if block.kind == prose.HEADING:
            written.append(Paragraph(SUBHEADING, block.text))
        elif block.kind == prose.FIGURE:
            written.append(Paragraph(NORMAL, FIGURE_MARKER.format(id=block.text)))
        elif block.kind == prose.BULLET:
            written.append(Paragraph(NORMAL, f"• {block.text}"))
        elif block.kind == prose.ROW:
            written.append(Paragraph(NORMAL, f"| {block.text} |"))
        elif block.kind == prose.CODE:
            written.append(Paragraph(CODE, block.text))
        else:
            written.append(Paragraph(NORMAL, block.text))
    return written


def _caption_paragraphs(blocks: list[prose.Block]) -> list[Paragraph]:
    """The captions of the figures this page carries, in the order the page carries them.

    Read off the registry, which is where a caption lives — the page's copy of it is
    derived, and editing the page instead of the row is the one way to change a caption
    that `check` will not let stand.
    """
    registry = figures_module.load_all()
    written = [
        Paragraph(HEADING, "Captions"),
        Paragraph(
            NORMAL,
            "One line per figure on this page, in page order: the slug, then the caption "
            "as it reads under the picture. Edit the caption; leave the slug alone.",
        ),
    ]
    for block in blocks:
        if block.kind != prose.FIGURE:
            continue
        figure = registry.get(block.text)
        if figure is None:
            written.append(Paragraph(NORMAL, f"{block.text}: not in the figure registry"))
            continue
        written.append(Paragraph(NORMAL, CAPTION_LINE.format(id=figure.id, caption=figure.caption)))
        if figure.pending:
            written.append(Paragraph(NORMAL, PENDING_LINE.format(id=figure.id, alt=figure.alt)))
    return written


# --------------------------------------------------------------------- writing the file


def _element(tag: str, **attributes: str) -> ElementTree.Element:
    named = {f"{{{WORD}}}{key}": value for key, value in attributes.items()}
    return ElementTree.Element(f"{{{WORD}}}{tag}", named)


def _paragraph_xml(paragraph: Paragraph) -> ElementTree.Element:
    node = _element("p")
    properties = _element("pPr")
    properties.append(_element("pStyle", val=paragraph.style))
    node.append(properties)
    run = _element("r")
    text = _element("t")
    text.set("{http://www.w3.org/XML/1998/namespace}space", "preserve")
    text.text = paragraph.text
    run.append(text)
    node.append(run)
    return node


def document_xml(paragraphs: list[Paragraph]) -> bytes:
    ElementTree.register_namespace("w", WORD)
    document = _element("document")
    body = _element("body")
    for paragraph in paragraphs:
        body.append(_paragraph_xml(paragraph))
    body.append(_element("sectPr"))
    document.append(body)
    return _serialized(document)


def _serialized(root: ElementTree.Element) -> bytes:
    return ElementTree.tostring(root, encoding="UTF-8", xml_declaration=True)


#: The styles the document names. Word and Google Docs both key off the id, and a
#: document that names a style it does not define reads as unstyled in one of them.
STYLES = f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="{WORD}">
  <w:docDefaults>
    <w:rPrDefault><w:rPr>
      <w:rFonts w:ascii="Georgia" w:hAnsi="Georgia"/><w:sz w:val="22"/>
    </w:rPr></w:rPrDefault>
  </w:docDefaults>
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal">
    <w:name w:val="Normal"/><w:pPr><w:spacing w:after="160"/></w:pPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Title">
    <w:name w:val="Title"/><w:basedOn w:val="Normal"/>
    <w:pPr><w:spacing w:after="240"/></w:pPr>
    <w:rPr><w:b/><w:sz w:val="40"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading1">
    <w:name w:val="heading 1"/><w:basedOn w:val="Normal"/>
    <w:pPr><w:outlineLvl w:val="0"/><w:spacing w:before="320" w:after="160"/></w:pPr>
    <w:rPr><w:b/><w:sz w:val="32"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading2">
    <w:name w:val="heading 2"/><w:basedOn w:val="Normal"/>
    <w:pPr><w:outlineLvl w:val="1"/><w:spacing w:before="280" w:after="140"/></w:pPr>
    <w:rPr><w:b/><w:sz w:val="28"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Code">
    <w:name w:val="Code"/><w:basedOn w:val="Normal"/>
    <w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/></w:rPr>
  </w:style>
</w:styles>
"""

CONTENT_TYPES = f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels"
    ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="{DOCUMENT_TYPE}"/>
  <Override PartName="/word/styles.xml" ContentType="{STYLES_TYPE}"/>
</Types>
"""

ROOT_RELATIONSHIPS = f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="{PACKAGE_RELATIONSHIPS}">
  <Relationship Id="rId1" Type="{OFFICE_RELATIONSHIPS}/officeDocument" Target="word/document.xml"/>
</Relationships>
"""

DOCUMENT_RELATIONSHIPS = f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="{PACKAGE_RELATIONSHIPS}">
  <Relationship Id="rId1" Type="{OFFICE_RELATIONSHIPS}/styles" Target="styles.xml"/>
</Relationships>
"""


def write_doc(path: Path, paragraphs: list[Paragraph]) -> None:
    """The whole package: four small XML parts and the document itself."""
    parts = {
        "[Content_Types].xml": CONTENT_TYPES.encode("utf-8"),
        "_rels/.rels": ROOT_RELATIONSHIPS.encode("utf-8"),
        "word/_rels/document.xml.rels": DOCUMENT_RELATIONSHIPS.encode("utf-8"),
        "word/styles.xml": STYLES.encode("utf-8"),
        "word/document.xml": document_xml(paragraphs),
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as package:
        for name, payload in parts.items():
            package.writestr(zipfile.ZipInfo(name, FIXED_STAMP), payload)


# --------------------------------------------------------------------- reading one back


def read_doc(path: Path) -> list[Paragraph]:
    """Every paragraph of a `.docx`, in order, as text.

    Whatever Google Docs did to the formatting is ignored; what matters is the words and
    the order. A paragraph inside a table comes through as its own paragraph, which is
    what a pipe-separated row was on the way out.
    """
    if path.suffix == NATIVE_SUFFIX:
        raise ReviewError(_native_message(path))
    if not path.is_file():
        raise ReviewError(f"{path}: no review doc there")
    try:
        with zipfile.ZipFile(path) as package:
            payload = package.read("word/document.xml")
    except (zipfile.BadZipFile, KeyError) as error:
        raise ReviewError(f"{path.name}: not a readable .docx ({error})") from error
    root = ElementTree.fromstring(payload)
    found = []
    for node in root.iter(f"{{{WORD}}}p"):
        text = _paragraph_text(node)
        if text:
            found.append(Paragraph(_style_of(node), text))
    return found


def _paragraph_text(node: ElementTree.Element) -> str:
    parts = []
    for child in node.iter():
        tag = child.tag
        if tag == f"{{{WORD}}}t":
            parts.append(child.text or "")
        elif tag in (f"{{{WORD}}}tab", f"{{{WORD}}}br"):
            parts.append(" ")
    return " ".join("".join(parts).split())


def _style_of(node: ElementTree.Element) -> str:
    style = node.find(f"{{{WORD}}}pPr/{{{WORD}}}pStyle")
    return NORMAL if style is None else style.get(f"{{{WORD}}}val", NORMAL)


def _native_message(path: Path) -> str:
    """What to do about a doc Matt converted to Google's own format.

    A `.gdoc` is a pointer, not a document: the words are on Drive. Saying which id
    beats saying "unreadable", because the id is what fetches it.
    """
    try:
        identifier = json.loads(path.read_text(encoding="utf-8")).get("doc_id", "unknown")
    except (OSError, json.JSONDecodeError):
        identifier = "unknown"
    return (
        f"{path.name} is a Google-native doc, whose words live on Drive rather than on "
        f"disk (doc id {identifier}). Read it with the Drive tools, or open it in Google "
        f'Docs and use File, Download, "Microsoft Word (.docx)" into {path.parent}.'
    )


# ------------------------------------------------------------------------- the three acts


def create(page: str, *, force: bool = False) -> Path:
    """Write the review doc for a page, after holding the page to its master."""
    masters = prose.load_all()
    master = masters.get(page)
    if master is not None:
        comparison = prose.compare(page, master)
        if not comparison.matches:
            raise ReviewError(
                f"{page} and {master.file} have drifted apart, and a review doc built "
                f"from a drifted page reviews the wrong words.\n{comparison.difference}"
            )
    path = doc_path(page)
    waiting = state_of(page).waiting
    if waiting is not None and not force:
        raise ReviewError(
            f"{waiting.name} is already in {path.parent} and may carry Matt's marks. "
            "Apply it first, or pass --force to overwrite it."
        )
    write_doc(path, paragraphs_for(page, master))
    return path


def consume(page: str) -> Path:
    """Move an applied doc out of the way, so a stale one can never be applied twice."""
    waiting = state_of(page).waiting
    if waiting is None:
        raise ReviewError(f"no review doc for {page} in {prose.review_dir()}")
    applied = prose.applied_dir()
    applied.mkdir(parents=True, exist_ok=True)
    destination = applied / f"{slug_of(page)}-{date.today():%Y-%m-%d}{waiting.suffix}"
    destination = _unused(destination)
    shutil.move(str(waiting), str(destination))
    return destination


def _unused(path: Path) -> Path:
    """The same name, or the next one free — two rounds in one day is not an error."""
    if not path.exists():
        return path
    for attempt in range(2, 100):
        candidate = path.with_name(f"{path.stem}-{attempt}{path.suffix}")
        if not candidate.exists():
            return candidate
    raise ReviewError(f"{path.parent} already holds a hundred copies of {path.stem}")


#: What an instruction looks like in a marked-up doc.
NOTE = re.compile(r"\[M:.*?\]", re.S)


def notes_in(paragraphs: list[Paragraph]) -> list[str]:
    """Every `[M: ...]` Matt wrote, in order — the list an apply session works through.

    Scanned from the Prose heading on, so the example in the convention block at the top
    is not reported as an instruction to carry out.
    """
    return [note for paragraph in reviewable(paragraphs) for note in NOTE.findall(paragraph.text)]


# ------------------------------------------------------- what the marked-up doc changed


@dataclass(frozen=True)
class Change:
    """One place the marked-up doc and the page as served part company."""

    kind: str
    served: str
    marked: str

    @property
    def inline(self) -> str:
        """The two texts as one line, with what went and what came marked."""
        if self.kind != "edited":
            return self.marked or self.served
        return _inline(self.served, self.marked)


def reviewable(paragraphs: list[Paragraph]) -> list[Paragraph]:
    """The doc from the Prose heading on: the part that is the page rather than the rules."""
    for index, paragraph in enumerate(paragraphs):
        if paragraph.style == HEADING and paragraph.text == "Prose":
            return paragraphs[index + 1 :]
    return paragraphs


def changes(page: str, marked: list[Paragraph]) -> list[Change]:
    """Every edit in a marked-up doc, found by diffing it against the page as served.

    The doc is rebuilt from today's page and the two are aligned paragraph by paragraph,
    so what comes back is Matt's marks and nothing else — an apply session works through
    this list rather than reading two documents side by side.
    """
    master = prose.load_all().get(page)
    served = [paragraph.text for paragraph in reviewable(paragraphs_for(page, master))]
    theirs = [paragraph.text for paragraph in reviewable(marked)]
    found: list[Change] = []
    matcher = difflib.SequenceMatcher(a=served, b=theirs, autojunk=False)
    for tag, start, end, other_start, other_end in matcher.get_opcodes():
        if tag == "equal":
            continue
        gone, came = served[start:end], theirs[other_start:other_end]
        if tag == "replace" and len(gone) == len(came):
            found.extend(Change("edited", a, b) for a, b in zip(gone, came, strict=True))
            continue
        found.extend(Change("removed", text, "") for text in gone)
        found.extend(Change("added", "", text) for text in came)
    return found


def _inline(served: str, marked: str) -> str:
    """A word-level diff of one paragraph: [-dropped-] and {+added+}, in place."""
    before, after = served.split(), marked.split()
    parts: list[str] = []
    for tag, start, end, other_start, other_end in difflib.SequenceMatcher(
        a=before, b=after, autojunk=False
    ).get_opcodes():
        if tag in ("equal", "delete", "replace"):
            segment = " ".join(before[start:end])
            parts.append(segment if tag == "equal" else f"[-{segment}-]")
        if tag in ("insert", "replace"):
            parts.append("{+" + " ".join(after[other_start:other_end]) + "+}")
    return " ".join(part for part in parts if part)
