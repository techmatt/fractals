"""Twenty tentative records, landed here as one staged gallery.

## What this is for

The explorer grew a gallery panel: a reader who has a picture on the canvas can look at
what the curation passes actually seated, and open any of it. That wants thousands of
pictures and a link beside each, which is a gallery in every respect the builder already
understands — a directory, a `gallery.jsonl`, web-res images — and a gallery in no respect
the *article* understands, because there is no page, no cover tile and no written caption
anywhere in it. `staged` is that state, and `builder/README.md` says what it means. Here is
what fills one.

## Collections, and one row a seat across all of them

The panel shows one **collection** at a time: the general gallery, or one of the nineteen
the project next door solves on a single axis — twelve hue families and seven modes, whose
sizes are `curation/targets.py`'s. They overlap, since a seat of the rose collection may
well be a seat of the general one, so the record is their **union**: one row, and one
picture, per recipe key, and each row carries `collections`, a map from every collection
that seats it to its place in that collection's presentation order. The panel's dropdown
chooses a key of that map; it never fetches anything.

**The pictures are thumbnails and nothing else** *(explorer_gallery_collections_ckpt129)*.
Clicking a tile opens the viewer, which draws the picture itself, so the full picture is
one click away and a second, larger copy of it here would be a gigabyte nobody is shown. A
row's `file` is a WebP at `TILE_SIZE`, encoded through `images.write_thumb` at the one
quality `images` holds for that format, and it is the only size this gallery ships.

## The four reads, and where each answer comes from

`builder.picks` already resolves a seat: the recorded gallery for the seat row, the
candidate ledger for the recipe, and the run's own record for what the tone operator did.
This module does the same reads a thousand at a time rather than six, so each store is
opened once:

- **the seats**, `artifacts/curation/tentative/<stamp>/gallery.jsonl` — seat order, the
  alias, and the hue family the colour reading rolls the picture up to;
- **the recipes**, the candidate ledger, in one streamed pass through `picks.ledger_rows`;
- **the tone curves**, asked of that project's own reader, `curation.stamps.for_rows` with
  the backfill overlay beneath it, in one call for the thousand. The two kinds that draw
  by attempt are not among its stores, and `PICTURE_RECORDS` reads theirs here, one pass
  per run record. Neither is `picks.RUN_RECORDS`: that one answers *did the operator
  act*, and this wants the five numbers it acted with.
- **the hue families each picture contains**, read off the pictures themselves through
  `palettes.dominance`, at `HUE_PRESENT` rather than at that module's dominance bar. The
  seat row already says which family *leads* a picture; the panel's chips inside a colour
  collection ask the other question — *what else is in here* — and a hint of a hue is the
  answer to it. This is the one read that opens the pictures, and it is a minute and a
  half for five thousand.

And a fifth thing that is not a read of a record: **the presentation order**. The
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

from . import images, links, picks, renders
from .paths import GALLERY_IMAGES_DIR, GALLERY_METADATA_NAME, SITE_ROOT

#: The tentative record the general collection is. A stamp rather than "the latest": a
#: second solve writes a second stamp, and a staged gallery that re-pointed itself would
#: replace a thousand committed rows without anybody deciding to.
#:
#: **Since `site_rebase_ckpt132` (2026-09-19) it is not a published record.** It is the
#: `general_n1000` solve of the pinned batch — the first solves with the project's pinned
#: seats seated first — and it is kept next door by `tentative.KEPT_UNPUBLISHED`, not by
#: `PUBLISHED`, which still ends at `20260914T171846Z`. The header's `published` asks that
#: tuple rather than assuming the general collection is the published one. The batch's
#: `general_n2000` record is a comparison only and is not a collection here.
STAMP = "20260919T171003Z"

#: The general collection's name, which is what `collections` keys it by.
GENERAL = "general"

#: Every collection the panel offers, in the order its dropdown lists them, and the stamp
#: each one is read from.
#:
#: The general gallery first; then the nine ordinary hue families, in the codebook's wheel
#: order; then the three thin ones — `green`, `cyan`, `lime` — the families whose stock
#: ran short at the old target; then the seven modes, the three smooth-family composites last.
#:
#: ⚠ **None of the twenty is published.** They are one batch, the pinned records of
#: 2026-09-19 17:10-17:38Z (`site_rebase_ckpt132` repointed every line here): the general
#: `general_n1000` solve and nineteen `targets_<collection>_n<seats>` solves at the sizes
#: `curation/targets.py` sets, all with `data/curation/pins.json` seated first and all
#: kept next door by `tentative.KEPT_UNPUBLISHED`. Matt's word on the collections is that
#: they are not final, so a re-solve is a re-pointing of this table, and
#: `_collection_stamp` refuses a stamp whose solve was not that collection's so a mistyped
#: line cannot seat one family's pictures under another's name.
#: A stamp that leaves the keep list next door is a `seats` run that refuses once it is
#: deleted, not a panel that quietly shrinks.
COLLECTIONS: tuple[tuple[str, str], ...] = (
    (GENERAL, STAMP),
    ("rose", "20260919T171517Z"),
    ("red", "20260919T171636Z"),
    ("orange", "20260919T171754Z"),
    ("yellow", "20260919T171915Z"),
    ("teal", "20260919T172300Z"),
    ("azure", "20260919T172535Z"),
    ("blue", "20260919T172651Z"),
    ("purple", "20260919T172806Z"),
    ("magenta", "20260919T172927Z"),
    ("green", "20260919T172144Z"),
    ("cyan", "20260919T172420Z"),
    ("lime", "20260919T172029Z"),
    ("tia", "20260919T173059Z"),
    ("smooth", "20260919T173230Z"),
    ("stripe", "20260919T173402Z"),
    ("threads", "20260919T173514Z"),
    ("smooth_mean_angle", "20260919T173625Z"),
    ("smooth_angle_min", "20260919T173732Z"),
    ("smooth_stripe", "20260919T173838Z"),
)

#: What the general collection's solve is called by the pass that recorded it. The rest are
#: `targets_<collection>_n<seats>`; this one is the batch's n=1000 general solve, and the
#: `_n1000_` is what keeps its n=2000 comparison from being taken for it.
GENERAL_SOLVE = "general_n1000_"

#: Which of those are a mode, so the header can say which axis each was cut on. The rest
#: after the general one are hue families.
MODE_COLLECTIONS = frozenset(
    {"tia", "smooth", "stripe", "threads", "smooth_mean_angle", "smooth_angle_min", "smooth_stripe"}
)

#: The one picture size this gallery ships: 316 wide at 16:9. Chosen for the panel's tile,
#: which is a third of a side panel that is 40% of a desktop window, and no larger size is
#: kept — the viewer is where a picture is looked at.
TILE_SIZE = (316, 178)

#: The format every tile is written in. At 316 px WebP holds about 1.5 dB more than a JPEG
#: of the same bytes (measured on fifty seats, explorer_gallery_collections_ckpt129), and
#: every browser the explorer's wasm runs in decodes it.
TILE_SUFFIX = ".webp"

#: The directory, which is the slug, which is a permanent URL.
SLUG = "seated-candidates"

TITLE = "Seated candidates"

BLURB = (
    "Every wallpaper the curation passes seated, in the general gallery and in a "
    "collection per color family and per mode, each one openable at the frame, the "
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

#: The order each tentative gallery's own page presents its seats in, as recipe keys, and
#: the basis it was taken on, for every stamp named. Keys rather than indices, so the
#: answer does not depend on the two sides reading the rows in the same order; one process
#: for all of them, because the import is most of the cost.
ORDER_PROGRAM = """
import json, sys

from fractal_wallpapers.curation import page_order, tentative

answer = {}
for stamp in sys.argv[1:]:
    rows = tentative.read_rows(stamp)
    vectors = page_order.vectors_for(rows)
    answer[stamp] = {
        "basis": page_order.basis(vectors),
        "keys": [rows[at]["key"] for at in page_order.order(rows, vectors)],
    }
print(json.dumps(answer))
"""

#: The stamps the project next door has published, asked of its own tuple so the header's
#: `published` says what that project says rather than what this one assumes.
PUBLISHED_PROGRAM = """
import json

from fractal_wallpapers.curation import tentative

print(json.dumps(list(tentative.PUBLISHED)))
"""

#: What `tone` answers with, in the one word a caller branches on. `CLEAN` is the link
#: being the picture with no curve in it; `CURVED` carries one; `LOST` is a gap.
CLEAN, CURVED, LOST = "clean", "curved", "lost"

#: How much of a picture's colour a hue family holds before the row says the picture
#: **contains** it.
#:
#: The share is `palettes.dominance`'s — the codebook's census of the picture with the
#: neutrals out of the numerator and the denominator, so it is a share of the colour and
#: not of the pixels, which is the only reading of "what colour is this" the project next
#: door has. What is different here is the bar. That module answers *what is this picture
#: of*, at 0.20 for a family; a panel offering "also contains" is asking the other
#: question, and a hue a picture merely has a hint of is the answer to it.
#:
#: **0.03, eyeballed rather than reasoned** *(explorer_smooth_first_colour_contains)*. Two
#: sheets settled it: across every collection, twelve pictures whose share of a family
#: three wheel-steps or further away fell between 0.025 and 0.04 — teal spirals through a
#: red picture, gold through a teal one — and every one of those accents is there to be seen,
#: so a bar above them would be hiding what a reader can point at. The cost is at the
#: other end and is a property of the wheel rather than of the number: a green palette's
#: cool shoulder falls in teal's cells, so 195 of the green collection's 300 seats contain
#: teal at 0.05 and 221 at 0.03, and raising the bar to 0.08 still leaves 166. A neighbour
#: reads high at every bar, which is why the bar was chosen for the far hues it catches.
HUE_PRESENT = 0.03

#: Every seat's hue-family share vector, read the one way this project reads a picture's
#: colour. The pictures are the candidate renders the seats ship, which is the population
#: `dominance` is defined over; a tile drawn down to 316 px is a different one.
SHARES_PROGRAM = """
import json, sys

from pathlib import Path

from fractal_wallpapers.palettes import dominance

ask = json.load(sys.stdin)
print(json.dumps({
    key: dominance.of_picture(Path(path)).family_shares for key, path in ask.items()
}))
"""

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


def seat_rows(stamp: str = STAMP) -> list[dict]:
    """One record's seats, in its own seat order.

    Ordered by the record's `seat` rather than by the file, so the gallery's order is the
    solve's own seating and not an accident of how the rows were appended.
    """
    path = renders.artifact("curation", "tentative", stamp, picks.SEATS_NAME)
    if not path.is_file():
        raise SeatError(
            f"no tentative gallery recorded under {stamp} — {path} is not there. "
            f"Recorded here: {', '.join(picks.stamps()) or 'none'}"
        )
    rows = [json.loads(line) for line in path.open(encoding="utf-8") if line.strip()]
    return sorted(rows, key=lambda row: int(row["seat"]))


def _collection_stamp(name: str, stamp: str) -> str:
    """The stamp, once its own manifest says the solve behind it was this collection's.

    The general record's solve is called `GENERAL_SOLVE…` and every other stamp's
    `targets_<collection>_n<seats>`, by the pass that recorded it, and a stamp whose solve
    says another name is refused.
    """
    path = renders.artifact("curation", "tentative", stamp, "manifest.json")
    if not path.is_file():
        raise SeatError(f"the {name} collection's record {stamp} is not there — {path}")
    solved = str(json.loads(path.read_text(encoding="utf-8"))["solve"]["name"])
    wanted = GENERAL_SOLVE if name == GENERAL else f"targets_{name}_n"
    if not solved.startswith(wanted):
        raise SeatError(f"{stamp} is the solve {solved!r}, not the {name} collection's")
    return stamp


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


def hues_of(seats: list[tuple[str, dict]]) -> dict[str, list[str]]:
    """Which hue families each seat's picture **contains**, most first, by recipe key.

    One process for all of them, the same shape the stamps are read in: the import is most
    of the cost and a census of five thousand pictures is a minute and a half of it.

    A seat whose picture is not on this machine is refused, the way `pictures` refuses one,
    which is what makes `--records-only` a run that skips re-encoding the tiles rather than
    one that can be made without the renders.
    """
    ask = {}
    for _, seat in seats:
        stored = str(seat["picture"])
        home = renders.rehome(stored)
        if home is None or not home.is_file():
            raise SeatError(f"{seat['key']}: {stored} is not on this machine")
        ask[str(seat["key"])] = str(home)
    shares: dict[str, dict[str, float]] = _program(
        SHARES_PROGRAM, "reading the seats' hue shares", ask=ask
    )
    return {
        key: [
            name
            for name, _ in sorted(held.items(), key=lambda item: (-float(item[1]), item[0]))
            if float(held[name]) >= HUE_PRESENT
        ]
        for key, held in shares.items()
    }


@cache
def presentation_orders() -> dict[str, tuple[list[str], str]]:
    """Every collection's seats as its own page presents them, as recipe keys, and the
    basis, by collection name.

    Asked once a process: `derive` orders the rows by it and `header` says each basis.
    """
    stamps = {name: _collection_stamp(name, stamp) for name, stamp in COLLECTIONS}
    answer = _program(ORDER_PROGRAM, "reading the presentation orders", *stamps.values())
    return {
        name: ([str(key) for key in answer[stamp]["keys"]], str(answer[stamp]["basis"]))
        for name, stamp in stamps.items()
    }


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


def union() -> tuple[list[tuple[str, dict]], dict[str, dict[str, int]]]:
    """Every seat of every collection once, and where each one sits in each collection.

    The seats come first in the general collection's presentation order, then each further
    collection's new seats in its own, so the file reads in the order the panel opens on.
    Each seat is paired with the stamp it was first found under, which is the record its
    seat row, its recipe and its picture are read from.
    """
    orders = presentation_orders()
    seen: dict[str, tuple[str, dict]] = {}
    places: dict[str, dict[str, int]] = {}
    for name, stamp in COLLECTIONS:
        keys, _ = orders[name]
        rows = {str(seat["key"]): seat for seat in seat_rows(stamp)}
        if set(keys) != set(rows) or len(keys) != len(rows):
            raise SeatError(
                f"the {name} collection's presentation order is not a permutation of its seats"
            )
        for position, key in enumerate(keys):
            seen.setdefault(key, (stamp, rows[key]))
            places.setdefault(key, {})[name] = position
    return list(seen.values()), places


def derive() -> list[dict]:
    """Every seat of every collection, as the row this gallery's metadata carries.

    Needs the wallpaper project beside this checkout for all three reads and for the
    orders, and `node`, which is what runs the permalink contract.
    """
    seats, places = union()
    resolved = picks.resolve(f"{stamp}{picks.PICK_SEPARATOR}{seat['key']}" for stamp, seat in seats)
    stamps = stamps_of(resolved)
    hues = hues_of(seats)
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
    for (_, seat), pick in zip(seats, resolved, strict=True):
        answer = emitted[pick.key]
        if not answer.get("ok"):
            raise SeatError(f"{pick.key}: the contract refuses this seat — {answer['why']}")
        rows.append(
            _row(seat, pick, tones[pick.key], answer, curves, places[pick.key], hues[pick.key])
        )
    return rows


def _row(
    seat: dict,
    pick: picks.Pick,
    toned: Tone,
    answer: dict,
    curves: dict[str, str],
    places: dict[str, int],
    hues: list[str],
) -> dict:
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
    width, height = TILE_SIZE
    return {
        "schema": 1,
        "kind": "image",
        "file": f"{pick.key}{TILE_SUFFIX}",
        "width": width,
        "height": height,
        "alt": alt_text(mode, hue),
        "key": pick.key,
        "collections": places,
        "mode": mode,
        "hue": hue,
        "hues": hues,
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
    orders = presentation_orders()
    published = set(_program(PUBLISHED_PROGRAM, "reading the published stamps"))
    held = {name: 0 for name, _ in COLLECTIONS}
    for row in rows:
        for name in row["collections"]:
            held[name] += 1
    return {
        "schema": 1,
        "kind": "gallery",
        "slug": SLUG,
        "staged": True,
        "title": TITLE,
        "blurb": BLURB,
        "collections": [
            {
                "name": name,
                "axis": "general"
                if name == GENERAL
                else "mode"
                if name in MODE_COLLECTIONS
                else "family",
                "stamp": stamp,
                "published": stamp in published,
                "seats": held[name],
                "ordered_on": orders[name][1],
                "file": collection_file(name),
            }
            for name, stamp in COLLECTIONS
        ],
        "modes": modes_published(rows),
        "seats": len(rows),
        "wallpapers_commit": _wallpapers_commit(),
        "written_by": "python -m builder seats",
        "for": (
            "the explorer's gallery panel, which reads this record and nothing else: a "
            "staged gallery has no page on this site, no tile on the gallery index and no "
            "row in the explorer's link registry."
        ),
        "rule": (
            "One row per recipe key seated by any collection named above, each collection "
            "being one tentative record next door, published where that project's "
            "tentative.PUBLISHED lists its stamp. "
            "collections maps every collection that seats the row to its place in that "
            "record's presentation order, the permutation its own page opens on, whose basis "
            "ordered_on names. This header is the whole of gallery.jsonl: each collection's "
            "rows are in the file its entry names, in that collection's presentation order, "
            "so a seat in several collections is a row in each. modes is every mode the "
            "general collection seats. "
            "The seat's mode and hue family come from the first record that seats it; hues "
            "is every family holding at least "
            f"{HUE_PRESENT} of that picture's colour, largest first, read off the picture "
            "the record ships through palettes.dominance with the neutrals dropped, which "
            "is what the panel's chips inside a color collection tally. The "
            "recipe every link is built from comes from the candidate ledger by a streamed "
            "lookup; the tone curve a link carries in its level key comes from the run that "
            "drew the candidate. A link is emitted by explorer/permalink.js through "
            "builder/emit.mjs and never spelled here. Where the link is not quite the picture, "
            "gap says in one clause what it cannot carry: a tone curve the run did not record, "
            "a curve a mode's identity fixes, or an iteration cap the depth policy answers "
            "differently. file is a tile-sized WebP drawn from the picture the record ships "
            "and is the only size this gallery holds; it is untracked, and this record is "
            "what commits."
        ),
    }


def modes_published(rows: list[dict]) -> list[str]:
    """The modes the published collection seats, which is what the explorer's Mode select
    lists; in the header so that the page has it without reading any collection's rows."""
    return sorted({row["mode"] for row in rows if GENERAL in row["collections"]})


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


def collection_file(name: str) -> str:
    """The file one collection's rows are written to: its name, hyphenated, because a
    filename is a URL and the naming rule spells those with hyphens."""
    return f"{name.replace('_', '-')}.jsonl"


def _write_rows(path: Path, rows: list[dict]) -> Path:
    body = LF.join(json.dumps(row, ensure_ascii=False) for row in rows)
    path.write_text(body + LF, encoding="utf-8", newline=LF)
    return path


def write(rows: list[dict], head: dict | None = None) -> list[Path]:
    """The header, and then each collection's rows in that collection's presentation order.

    **One file per collection, and the header alone in `gallery.jsonl`**
    *(explorer_slim_ckpt131)*. The union was one 3.2 MB record, 605 KB on the wire, and the
    explorer waited for all of it before its first frame because the Mode select's roster
    was in it. The header is a few kilobytes and carries that roster as `modes`; a
    collection's rows are fetched the first time the panel shows it, so a visitor who
    stays in the general gallery downloads about 115 KB of rows. A seat in several
    collections is a row in each of their files, which is the price of a collection being
    one fetch: the files add up to more than the union did, and nobody downloads them all.

    `head` is a header already made, where the rows are being re-split rather than
    re-derived and the provenance should stay that of the derive that made them.
    """
    where = directory()
    where.mkdir(parents=True, exist_ok=True)
    written = [_write_rows(metadata_path(), [head or header(rows)])]
    for name, _ in COLLECTIONS:
        members = sorted(
            (row for row in rows if name in row["collections"]),
            key=lambda row: row["collections"][name],
        )
        written.append(_write_rows(where / collection_file(name), members))
    wanted = {path.name for path in written}
    for stale in where.glob("*.jsonl"):
        if stale.name not in wanted:
            stale.unlink()
    return written


def pictures(rows: list[dict]) -> int:
    """Each seat's tile, drawn down from the picture its record ships.

    **Nothing is rendered.** Every seat of every collection already has a picture next
    door, and a seat whose picture is not on this machine is refused rather than drawn:
    the collections are not final, and a render leg for a tile is not this command's to
    start. A tile already at `TILE_SIZE` is left alone, so a re-run writes only what is new.
    """
    where = directory()
    where.mkdir(parents=True, exist_ok=True)
    # Addressed by the seat's own key rather than by position: two lists in the same order
    # is a thing that stays true until it does not, and what it would land is every
    # picture under its neighbour's name.
    shipped = {}
    for _, stamp in COLLECTIONS:
        for seat in seat_rows(stamp):
            shipped.setdefault(str(seat["key"]), seat["picture"])
    written = 0
    for row in rows:
        tile = where / row["file"]
        if tile.is_file() and images.dimensions(tile) == TILE_SIZE:
            continue
        stored = shipped[row["key"]]
        source = renders.rehome(stored)
        if source is None or not source.is_file():
            raise SeatError(f"{row['key']}: {stored} is not on this machine")
        images.write_thumb(source, tile, TILE_SIZE)
        written += 1
    return written


def prune(rows: list[dict]) -> int:
    """Remove every tile the record no longer names, and say how many went.

    **A repoint leaves nothing behind** *(explorer_slim_ckpt131_addendum2)*. A collection
    re-solved under a new stamp seats some pictures the old one did not and drops some it
    did, and the dropped seats' tiles used to stay in the directory until `check`'s orphan
    sweep named them. They are untracked and made from records next door, so a tile
    nothing names is nothing but a stale file. Only tiles go: the records are written by
    `write`, which clears its own.
    """
    named = {row["file"] for row in rows}
    gone = 0
    for tile in directory().glob(f"*{TILE_SUFFIX}"):
        if tile.name not in named:
            tile.unlink()
            gone += 1
    return gone


def land(*, records_only: bool = False) -> list[str]:
    """The whole of `python -m builder seats`, as the lines it prints."""
    rows = derive()
    told = []
    if not records_only:
        told.append(f"{pictures(rows)} tile(s) written, {prune(rows)} no longer named removed")
    paths = write(rows)
    told.append(
        f"wrote {paths[0].relative_to(SITE_ROOT).as_posix()} and {len(paths) - 1} collection "
        f"file(s)  {len(rows)} seat(s)"
    )
    held = {name: 0 for name, _ in COLLECTIONS}
    inside = dict(held)
    for row in rows:
        for name in row["collections"]:
            held[name] += 1
            inside[name] += GENERAL in row["collections"]
    for name, stamp in COLLECTIONS:
        told.append(f"  {name:<8} {stamp}  {held[name]} seat(s), {inside[name]} in {GENERAL}")
    levelled = sum(1 for row in rows if f"&{LEVEL_KEY}=" in row["link"])
    gapped = [row for row in rows if row["gap"]]
    told.append(f"{levelled} link(s) carry a tone curve, {len(gapped)} row(s) carry a gap")
    return told
