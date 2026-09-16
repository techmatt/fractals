"""One published tentative record, landed here as a staged gallery.

## What this is for

The explorer grew a gallery panel: a reader who has a picture on the canvas can look at
what the curation pass actually seated, and open any of it. That wants a thousand
pictures and a thousand links beside them, which is a gallery in every respect the
builder already understands — a directory, a `gallery.jsonl`, web-res images, thumbnails
— and a gallery in no respect the *article* understands, because there is no page, no
cover tile and no written caption anywhere in it. `staged` is that state, and
`builder/README.md` says what it means. Here is what fills one.

## The three reads, and where each answer comes from

`builder.picks` already resolves a seat: the recorded gallery for the seat row, the
candidate ledger for the recipe, and the run's own record for what the tone operator did.
This module does the same three reads a thousand at a time rather than six, so each store
is opened once:

- **the seats**, `artifacts/curation/tentative/<stamp>/gallery.jsonl` — seat order, the
  alias, and the hue family the colour reading rolls the picture up to;
- **the recipes**, the candidate ledger, in one streamed pass through `picks.ledger_rows`;
- **the tone curves**, asked of that project's own reader, `curation.stamps.for_rows` with
  the backfill overlay beneath it, in one call for the thousand. The two kinds that draw
  by attempt are not among its stores, and `PICTURE_RECORDS` reads theirs here, one pass
  per run record. Neither is `picks.RUN_RECORDS`: that one answers *did the operator
  act*, and this wants the five numbers it acted with.

And a fourth thing that is not a read of a record: **the presentation order**. The
tentative gallery's own page opens on `curation.page_order`'s permutation of the seating,
computed at its build and written onto no record, and this gallery asks the same module
for the same permutation so that the explorer's panel opens on the tiles that page does.

## The link, and what it cannot carry

The permalink is emitted by the contract itself — `links.ledger_view` puts a ledger recipe
into the shape `emit.mjs` reads, and all thousand go through one node process. A link that
is not the picture is not silently shipped: the row carries a `gap` saying in one clause
what is missing, and there are three ways that happens here.

- **The tone curve.** Every candidate of this pool was drawn with `band_autolevel/v1`
  switched on, and where it acted the picture is drawn through a curve pushed into the
  map's stops. The permalink's `level` key carries that curve, so a seat whose curve is on
  a record, its run's own or the backfill's, opens as the picture it ships; a seat with
  neither says so.
- **A curve that does nothing is not carried.** `applies` and `identity` are different
  claims: an identity curve is the operator having measured and declined, and replaying
  one is not free — it costs a fraction of a level through the Oklab round trip — so a
  seat whose curve is identity needs no `level` key and has no gap for one.
- **The iteration cap.** A recipe pins `maxiter`; a link carries a place, and the engine's
  depth policy derives the cap from the width. Where the two differ the row says so, in
  the words `links._settled` uses for a figure.
- **A mode's curve.** A mode's identity here includes the curve it reads its field
  through, and the catalog fixes it; four of these seats read `smooth` through a `log`
  curve, which no key can say.
"""

from __future__ import annotations

import json
import subprocess
from dataclasses import dataclass
from functools import cache
from pathlib import Path

from . import galleries, images, links, picks, renders
from .paths import GALLERY_IMAGES_DIR, GALLERY_METADATA_NAME, SITE_ROOT, THUMBS_DIR_NAME

#: The published tentative record this gallery is. A stamp rather than "the latest": a
#: second solve writes a second stamp, and a staged gallery that re-pointed itself would
#: replace a thousand committed rows without anybody deciding to.
STAMP = "20260914T171846Z"

#: The directory, which is the slug, which is a permanent URL.
SLUG = "seated-candidates"

TITLE = "Seated candidates"

BLURB = (
    "Every wallpaper one curation pass seated, each one openable at the frame, the "
    "rendering mode and the palette that drew it."
)

#: The tone operator every candidate of this pool was drawn under, and the only one a
#: link may name. The version is part of the name on purpose: an operator that measured
#: differently would be a value the contract refuses rather than a curve it misread.
OPERATOR = "band_autolevel/v1"

#: What the permalink contract spells the tone curve's key. Named here only so a count of
#: how many links carry one can be taken off the links themselves; the key is emitted by
#: `explorer/permalink.js` and never by anything on this side.
LEVEL_KEY = "level"

#: Where the two kinds that draw by attempt wrote the **curve** the autolevel operator
#: acted with, keyed by the picture the attempt produced.
#:
#: Every other kind is `STAMPS_PROGRAM`'s to answer. The stores that write a whole stamp
#: per recipe key, and the backfill that gives one back to the rows whose leg wrote none,
#: are that project's to list, and a second list here is what went stale the last time a
#: store joined it. These two are not among its stores, so they are read here.
PICTURE_RECORDS = {
    "runs": ("candidates.jsonl", "on_demand.jsonl"),
    "reframe_draw": ("attempts.jsonl",),
}

#: The whole stamp behind each recipe key, asked of the reader that project's releases and
#: its atlas take it from: every sequence store, with the backfill overlay read first.
STAMPS_PROGRAM = """
import json, sys

from fractal_wallpapers.curation import backfill, stamps

ask = json.load(sys.stdin)
rows = {key: {"provenance": {"run": run}} for key, run in ask["runs"].items()}
print(json.dumps(stamps.for_rows(rows, backfill.read())))
"""

#: The order the tentative gallery's own page presents its seats in, as recipe keys, and
#: the basis it was taken on. Keys rather than indices, so the answer does not depend on
#: the two sides reading the rows in the same order.
ORDER_PROGRAM = """
import json, sys

from fractal_wallpapers.curation import page_order, tentative

rows = tentative.read_rows(sys.argv[1])
vectors = page_order.vectors_for(rows)
print(json.dumps({
    "basis": page_order.basis(vectors),
    "keys": [rows[at]["key"] for at in page_order.order(rows, vectors)],
}))
"""

#: What `tone` answers with, in the one word a caller branches on. `CLEAN` is the link
#: being the picture with no curve in it; `CURVED` carries one; `LOST` is a gap.
CLEAN, CURVED, LOST = "clean", "curved", "lost"

#: `.gitattributes` normalizes this repository to LF, and `Path.write_text` on Windows
#: translates a newline back to CRLF, so anything written here spells the ending.
LF = "\n"


class SeatError(RuntimeError):
    """A seat of the record does not resolve to a row this gallery can carry."""


# -------------------------------------------------------------------------- the records


def directory() -> Path:
    return GALLERY_IMAGES_DIR / SLUG


def metadata_path() -> Path:
    return directory() / GALLERY_METADATA_NAME


def seat_rows() -> list[dict]:
    """The record's seats, in its own seat order.

    Ordered by the record's `seat` rather than by the file, so the gallery's order is the
    solve's own seating and not an accident of how the rows were appended.
    """
    path = renders.artifact("curation", "tentative", STAMP, picks.SEATS_NAME)
    if not path.is_file():
        raise SeatError(
            f"no tentative gallery recorded under {STAMP} — {path} is not there. "
            f"Recorded here: {', '.join(picks.stamps()) or 'none'}"
        )
    rows = [json.loads(line) for line in path.open(encoding="utf-8") if line.strip()]
    return sorted(rows, key=lambda row: int(row["seat"]))


# ------------------------------------------------------------------------ the tone curve


@dataclass(frozen=True)
class Tone:
    """What the autolevel operator did to one seat, and whether a link can say it."""

    way: str
    #: Which record answered, as `<kind>/<run>`, so a person chasing a colour opens the
    #: same file this did.
    where: str
    #: The five numbers a link carries, or `None`.
    curve: dict | None
    #: The clause a `gap` is written from, where there is one.
    why: str | None


def _stored(pick: picks.Pick) -> tuple[str, str]:
    """The run kind and run name the ledger row's picture sits under."""
    parts = [part for part in str(pick.source.get("picture") or "").split("/") if part]
    if len(parts) < 5 or parts[1] != "curation":
        raise SeatError(
            f"{pick.key}: {pick.source.get('picture')!r} is not a picture under a curation run"
        )
    return parts[2], parts[3]


def _filename(pick: picks.Pick) -> str:
    return str(pick.source.get("picture") or "").rsplit("/", 1)[-1]


def _program(program: str, what: str, *arguments: str, ask: dict | None = None):
    """One program run in that project's interpreter, and the JSON it prints."""
    completed = subprocess.run(
        [str(renders.venv_python()), "-c", program, *arguments],
        input=json.dumps(ask or {}),
        capture_output=True,
        text=True,
        cwd=str(renders.wallpapers_root()),
        check=False,
    )
    if completed.returncode != 0:
        raise SeatError(f"{what} failed: {completed.stderr.strip()[-2000:]}")
    return json.loads(completed.stdout)


def stamps_of(resolved: list[picks.Pick]) -> dict[str, dict]:
    """Every seat's autolevel stamp, by recipe key, where any record holds one.

    Two reads. The project's own reader answers for every sequence store and the
    backfill, in one call. The kinds that draw by attempt are read here, grouped so each
    record file — tens of megabytes — is opened once. A seat nothing answers for is
    simply absent, which is what `tone` reads as a gap.
    """
    runs = {pick.key: str(pick.source.get("run") or _stored(pick)[1]) for pick in resolved}
    found: dict[str, dict] = _program(
        STAMPS_PROGRAM, "reading the seats' autolevel stamps", ask={"runs": runs}
    )

    wanted: dict[tuple[str, str], dict[str, str]] = {}
    for pick in resolved:
        kind, run = _stored(pick)
        if pick.key in found or kind not in PICTURE_RECORDS:
            continue
        wanted.setdefault((kind, run), {})[_filename(pick)] = pick.key
    for (kind, run), looking in wanted.items():
        for name in PICTURE_RECORDS[kind]:
            path = renders.artifact("curation", kind, run, name)
            if not path.is_file():
                continue
            with path.open(encoding="utf-8") as handle:
                for line in handle:
                    if not line.strip():
                        continue
                    row = json.loads(line)
                    address = str(row.get("picture") or "").replace("\\", "/")
                    address = address.rsplit("/", 1)[-1]
                    if address in looking:
                        found[looking[address]] = row.get("autolevel") or {}
    return found


@cache
def presentation_order() -> tuple[list[str], str]:
    """The record's seats as its own page presents them, as recipe keys, and the basis.

    Asked once a process: `derive` orders the rows by it and `header` says its basis.
    """
    answer = _program(ORDER_PROGRAM, "reading the presentation order", STAMP)
    return [str(key) for key in answer["keys"]], str(answer["basis"])


def tone(pick: picks.Pick, stamps: dict[str, dict]) -> Tone:
    """What one seat's picture was toned with, and whether the link can carry it."""
    kind, run = _stored(pick)
    where = f"{kind}/{run}"
    if pick.recipe.get("autolevel") is None:
        # The operator's own ruling that it has nothing to say about this mode's kind —
        # a direct trap paints over a flat ground — so there was never a curve to record.
        return Tone(CLEAN, where, None, None)
    stamp = stamps.get(pick.key)
    if stamp is None:
        return Tone(
            LOST,
            where,
            None,
            f"the tone operator's own stamp, which no record of {where} has a row for",
        )
    if not stamp.get("acted"):
        return Tone(CLEAN, where, None, None)
    curve = stamp.get("curve") or {}
    if not curve.get("applies") or curve.get("identity"):
        return Tone(
            LOST,
            where,
            None,
            f"the tone curve the operator acted with, which {where} recorded as a fact "
            "and not as coefficients",
        )
    return Tone(
        CURVED,
        where,
        {
            "operator": str(stamp.get("operator") or OPERATOR),
            "black_pt": float(curve["black_pt"]),
            "white_pt": float(curve["white_pt"]),
            "exponent": float(curve["exponent"]),
            "out_ends": [float(curve["out_ends"][0]), float(curve["out_ends"][1])],
        },
        None,
    )


# ------------------------------------------------------------------------------ the rows

#: How a mode's own curve is spelled where the catalog fixes a different one. A mode's
#: identity here includes the curve it reads its field through, so this is a difference no
#: key can say — and it is a gap rather than a refusal because the geometry, the mode and
#: the palette of the link are still this seat's.
CURVE_GAP = "the {read} curve this seat reads {mode} through, where the catalog's {mode} is {held}"


def alt_text(mode: str, hue: str | None) -> str:
    """What a reader's screen reader says about one tile.

    Derived by rule and never written, because a thousand written sentences would be a
    thousand chances to say something the record does not. Two facts, both of them on the
    record: what drew the picture, and the colour the reading finds it dominant in.
    """
    if hue:
        return f"A wallpaper drawn in {mode}, in the {hue} family."
    return f"A wallpaper drawn in {mode}."


def derive() -> list[dict]:
    """Every seat of the record, as the row this gallery's metadata carries, in the order
    the record's own page presents them.

    Needs the wallpaper project beside this checkout for all three reads and for the
    order, and `node`, which is what runs the permalink contract.
    """
    keys, _ = presentation_order()
    at = {key: position for position, key in enumerate(keys)}
    seats = seat_rows()
    if set(at) != {str(seat["key"]) for seat in seats} or len(keys) != len(seats):
        raise SeatError("the presentation order is not a permutation of the record's seats")
    seats.sort(key=lambda seat: at[str(seat["key"])])
    resolved = picks.resolve(f"{STAMP}{picks.PICK_SEPARATOR}{row['key']}" for row in seats)
    stamps = stamps_of(resolved)
    curves = links.catalog_curves()

    tones = {pick.key: tone(pick, stamps) for pick in resolved}
    views = {
        pick.key: links.ledger_view(
            pick.recipe, level=tones[pick.key].curve if tones[pick.key].way == CURVED else None
        )
        for pick in resolved
    }
    emitted = links.emit(views)

    rows = []
    for seat, pick in zip(seats, resolved, strict=True):
        answer = emitted[pick.key]
        if not answer.get("ok"):
            raise SeatError(f"{pick.key}: the contract refuses this seat — {answer['why']}")
        rows.append(_row(seat, pick, tones[pick.key], answer, curves))
    for position, row in enumerate(rows):
        row["order"] = position
    return rows


def _row(seat: dict, pick: picks.Pick, toned: Tone, answer: dict, curves: dict[str, str]) -> dict:
    """One seat's metadata row, gap and all."""
    recipe = pick.recipe
    mode = str(recipe["mode"])
    hue = seat.get("hue_family") or None
    gaps = []
    if toned.why:
        gaps.append(toned.why)
    held = curves.get(mode)
    read = str(recipe.get("curve") or "linear")
    if held is not None and read != held:
        gaps.append(CURVE_GAP.format(read=read, mode=mode, held=held))
    cap = recipe.get("maxiter")
    if cap is not None and int(cap) != int(answer["maxiter"]):
        gaps.append(
            f"the cap of {int(cap):,} this seat was drawn at, where the depth policy "
            f"gives {int(answer['maxiter']):,} at this width"
        )
    return {
        "schema": 1,
        "kind": "image",
        "file": f"{pick.key}.jpg",
        "width": 640,
        "height": 360,
        "alt": alt_text(mode, hue),
        "seat": int(seat["seat"]),
        "order": None,
        "key": pick.key,
        "mode": mode,
        "hue": hue,
        "palette": str(recipe["colormap"]),
        "link": answer["link"],
        "gap": "; ".join(gaps) or None,
    }


# --------------------------------------------------------------------------- the landing


def header(rows: list[dict]) -> dict:
    """The gallery's own header record: what it is, and where every byte of it came from.

    The provenance is the shape `explorer/palettes.jsonl`'s method row has, and for the
    same reason: a generated record that does not say what generated it is a record
    nobody can reproduce, and this one is a thousand rows nobody would reproduce by hand.
    """
    return {
        "schema": 1,
        "kind": "gallery",
        "slug": SLUG,
        "staged": True,
        "title": TITLE,
        "blurb": BLURB,
        "stamp": STAMP,
        "ordered_on": presentation_order()[1],
        "seats": len(rows),
        "wallpapers_commit": _wallpapers_commit(),
        "written_by": "python -m builder seats",
        "for": (
            "the explorer's gallery panel, which reads this record and nothing else: a "
            "staged gallery has no page on this site, no tile on the gallery index and no "
            "row in the explorer's link registry."
        ),
        "rule": (
            "One row per seat of the tentative record named above, in the presentation order "
            "its own page opens on, which order counts and ordered_on names the basis of; seat "
            "is the solve's own seating. "
            "The seat's alias, mode and hue family come from that record; the recipe every "
            "link is built from comes from the candidate ledger by a streamed lookup; the "
            "tone curve a link carries in its level key comes from the run that drew the "
            "candidate. A link is emitted by explorer/permalink.js through builder/emit.mjs "
            "and never spelled here. Where the link is not quite the picture, gap says in "
            "one clause what it cannot carry: a tone curve the run did not record, a curve "
            "a mode's identity fixes, or an iteration cap the depth policy answers "
            "differently. The pictures are the ones the record ships, copied unchanged; "
            "they are untracked, and this record is what commits."
        ),
    }


def _wallpapers_commit() -> str:
    """Which commit of the wallpaper project the records were read at."""
    import subprocess

    finished = subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=str(renders.wallpapers_root()),
        capture_output=True,
        text=True,
    )
    if finished.returncode != 0:
        raise SeatError(f"the wallpapers checkout would not name its commit: {finished.stderr}")
    return finished.stdout.strip()


def write(rows: list[dict]) -> Path:
    """The record, one row a line, in the presentation order `derive` put the rows in."""
    path = metadata_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    body = LF.join(json.dumps(row, ensure_ascii=False) for row in [header(rows), *rows])
    path.write_text(body + LF, encoding="utf-8", newline=LF)
    return path


def pictures(rows: list[dict]) -> tuple[int, int]:
    """Each seat's shipped picture copied in, and its thumbnail written beside it.

    **Copied rather than re-encoded.** The picture the record ships is what the judges
    were shown and what a reader is being offered; it is already web-res at 640x360, so
    there is nothing for `images.land` to downscale and a second encode would spend
    quality on nothing. The thumbnail is the gallery contract's own, at
    `galleries.THUMB_WIDTH`, through the one encoder every asset here goes through.
    """
    where = directory()
    thumbs = where / THUMBS_DIR_NAME
    where.mkdir(parents=True, exist_ok=True)
    thumbs.mkdir(parents=True, exist_ok=True)
    # Addressed by the seat's own key rather than by position: two lists in the same order
    # is a thing that stays true until it does not, and what it would land is every
    # picture under its neighbour's name.
    shipped = {str(seat["key"]): seat["picture"] for seat in seat_rows()}
    copied = written = 0
    for row in rows:
        stored = shipped[row["key"]]
        source = renders.rehome(stored)
        if source is None or not source.is_file():
            raise SeatError(f"{row['key']}: {stored} is not on this machine")
        destination = where / row["file"]
        raw = source.read_bytes()
        if not destination.is_file() or destination.read_bytes() != raw:
            destination.write_bytes(raw)
            copied += 1
        thumb = thumbs / row["file"]
        size = _thumb_size(row["width"], row["height"])
        if not thumb.is_file() or images.dimensions(thumb) != size:
            images.write_thumb(destination, thumb, size)
            written += 1
    return copied, written


def _thumb_size(width: int, height: int) -> tuple[int, int]:
    """The gallery contract's own thumbnail shape, asked of the contract rather than typed."""
    return galleries.Image(
        file="", title=None, caption=None, alt="", width=width, height=height, credit=None
    ).thumb_size


def land(*, records_only: bool = False) -> list[str]:
    """The whole of `python -m builder seats`, as the lines it prints."""
    rows = derive()
    told = []
    if not records_only:
        copied, written = pictures(rows)
        told.append(f"{copied} picture(s) copied, {written} thumbnail(s) written")
    path = write(rows)
    told.append(f"wrote {path.relative_to(SITE_ROOT).as_posix()}  {len(rows)} seat(s)")
    levelled = sum(1 for row in rows if f"&{LEVEL_KEY}=" in row["link"])
    gapped = [row for row in rows if row["gap"]]
    told.append(f"{levelled} link(s) carry a tone curve, {len(gapped)} row(s) carry a gap")
    return told
