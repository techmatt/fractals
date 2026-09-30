"""Friends' votes: the links they send, which seats those are, and the order they make.

A friend sends a list of explorer links, each one a favourite with no score. `ingest`
reads the list with the explorer's own reader (`votes.mjs`), names the seat each link
draws out of `seated-candidates/all.jsonl`, and appends **one event** to the store;
`status` counts, `browse` writes a local page of everyone's picks, and `export-order`
turns the likes into the `--order` file `curate packs build` takes next door.

## The store

`votes/events.jsonl` under the Drive-synced working folder (`drive_sync_root`, the setting
`prose` reads), **outside this repository, which is public and never carries a friend's
name**. `FRACTAL_WEBSITE_VOTES_STORE` names another file instead, which is how the tests
keep off the real one.

The file is append-only. One row per ingest — the friend, lowercased, the UTC time, and
one entry per link: the raw link verbatim, then either the seat's `key` or the `reason` it
matched none. Nothing here rewrites, deletes or re-keys a row, and a file that does not
end in a newline is refused rather than repaired. A friend's selection is derived, the
union of the keys across their events, so a link sent twice is one like.

An ingest is idempotent per friend and link: an entry already that friend's — a seat by
its key, an unmatched link by its raw text — is left out of the event, and a paste with
nothing new appends nothing at all. So running the same ingest twice leaves the store as
the first run left it.

## The match

Exact on the recipe as `permalink.js` parses and re-spells it, with `level` taken off: it
is the tone curve a pass derived from the rest, and about 1,500 gallery links gained it
after friends could have copied the link without it. No tolerance.

**A seat's old spelling still names it** *(julia3_video_4k_ckpt157, addendum 1)*. Where a fix
re-derives a seat's link, a friend may have copied the old one first. `data/seat-link-aliases.jsonl`
keeps each such spelling beside its seat, and the reader matches it after every current seat.
That is done at read time, never by rewriting the store: `resolved` matches every stored entry
that named no seat again, against the seats and the aliases as they stand, so `status`,
`browse`, `export-order` and `ingest` all count it, and the entry on disk keeps the reason it
was given when it was sent.

## The page

`artifacts/votes/index.html`, which is ignored, is walked by no check, and is served by
`builder serve` at `/artifacts/votes/`. It is rewritten after every ingest and by `browse`.
Two views: by person, with each friend's share of picks in the twelve hue families, their
modes and families, their thumbnails and the links that are no seat; and by score, every
liked seat by its vote count, ties in the general rank the packs ship in.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
from datetime import UTC, datetime
from pathlib import Path

from . import renders, seats
from .paths import GALLERY_IMAGES_DIR, SITE_ROOT
from .prose import DRIVE_KEY, DRIVE_VARIABLE
from .settings import local

#: The store, under the Drive-synced folder.
STORE_PARTS = ("votes", "events.jsonl")

#: A whole store path, which wins over the Drive setting. The tests set it.
STORE_VARIABLE = "FRACTAL_WEBSITE_VOTES_STORE"

SCHEMA = 1

READER = SITE_ROOT / "builder" / "votes.mjs"
SEATED = GALLERY_IMAGES_DIR / "seated-candidates"
ALL_SEATS = SEATED / "all.jsonl"
GO_REGISTER = SITE_ROOT / "go" / "redirects.jsonl"
#: The spellings a seat's link had before a fix re-derived it, each beside its seat.
ALIASES = SITE_ROOT / "builder" / "data" / "seat-link-aliases.jsonl"

#: The local viewer: under ignored `artifacts/`, which `paths.UNSERVED_DIRS` keeps out of
#: every check and `serve` still serves.
VIEWER = SITE_ROOT / "artifacts" / "votes" / "index.html"

#: The collection an order is written for: the general thousand, `final139_general`.
ORDER_COLLECTION = seats.GENERAL
ORDER_STAMP = seats.STAMP

#: Another place for the page, which the tests set so a test store never overwrites it.
VIEWER_VARIABLE = "FRACTAL_WEBSITE_VOTES_VIEWER"

#: A friend's name as the store keeps it.
NAME = re.compile(r"[a-z0-9][a-z0-9._-]*")

LF = "\n"


class VotesError(RuntimeError):
    """A vote that cannot be read, stored or turned into an order as asked."""


# ------------------------------------------------------------------------- the store


def store_path() -> Path:
    stated = os.environ.get(STORE_VARIABLE)
    if stated is not None and stated.strip():
        return Path(stated)
    root = local(DRIVE_KEY, DRIVE_VARIABLE)
    if root is None:
        raise VotesError(
            f"no store: set {STORE_VARIABLE}, or `{DRIVE_KEY}` in local.toml "
            f"({DRIVE_VARIABLE} in the environment)"
        )
    return root.joinpath(*STORE_PARTS)


def events(path: Path | None = None) -> list[dict]:
    """Every event in the store, oldest first; none where there is no store yet."""
    path = store_path() if path is None else path
    if not path.is_file():
        return []
    rows = []
    for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        if not line.strip():
            continue
        try:
            rows.append(json.loads(line))
        except json.JSONDecodeError as error:
            raise VotesError(f"{path}:{number} is not a JSON row ({error}); fix it by hand") from (
                error
            )
    return rows


def append(row: dict, path: Path | None = None) -> Path:
    """One row onto the end of the store. The only write this module makes to it."""
    path = store_path() if path is None else path
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.is_file() and path.stat().st_size:
        with path.open("rb") as held:
            held.seek(-1, os.SEEK_END)
            if held.read(1) != b"\n":
                raise VotesError(
                    f"{path} does not end in a newline, so its last row may be cut short; "
                    "look at it by hand. Nothing was written."
                )
    line = json.dumps(row, ensure_ascii=False) + LF
    with path.open("a", encoding="utf-8", newline=LF) as out:
        out.write(line)
        out.flush()
        os.fsync(out.fileno())
    return path


def selections(rows: list[dict]) -> dict[str, set[str]]:
    """Each friend's picks: the union of the keys their events matched."""
    picked: dict[str, set[str]] = {}
    for row in rows:
        mine = picked.setdefault(row["friend"], set())
        mine.update(entry["key"] for entry in row["links"] if "key" in entry)
    return picked


#: Not a friend: Matt's "guaranteed top 30", ingested under this name and counted as
#: `PIN_WEIGHT` votes, which outranks any count of real friends there will be.
PINNED = "pinned"
PIN_WEIGHT = 100


def score(names) -> int:
    """A seat's score from who picked it: one per friend, `PIN_WEIGHT` for a pin."""
    return sum(PIN_WEIGHT if name == PINNED else 1 for name in names)


def likes(rows: list[dict]) -> dict[str, int]:
    """Each seat's score: how many friends picked it, a pin counting `PIN_WEIGHT`."""
    count: dict[str, int] = {}
    for friend, keys in selections(rows).items():
        for key in keys:
            count[key] = count.get(key, 0) + score([friend])
    return count


# ---------------------------------------------------------------------------- matching


def seat_rows() -> list[dict]:
    """Every seat the gallery panel can show, in the `all` collection's page order."""
    rows = [json.loads(line) for line in ALL_SEATS.read_text(encoding="utf-8").splitlines()]
    return sorted(rows, key=lambda row: row["collections"].get("all", 0))


def _go() -> dict[str, str]:
    lines = GO_REGISTER.read_text(encoding="utf-8").splitlines() if GO_REGISTER.is_file() else []
    return {row["name"]: row["target"] for row in map(json.loads, filter(str.strip, lines))}


def aliases() -> dict[str, list[str]]:
    """Each seat's old spellings, from `ALIASES`."""
    lines = ALIASES.read_text(encoding="utf-8").splitlines() if ALIASES.is_file() else []
    out: dict[str, list[str]] = {}
    for row in map(json.loads, filter(str.strip, lines)):
        out.setdefault(row["key"], []).append(row["link"])
    return out


def match(text: str = "", links: list[str] | None = None) -> dict:
    """Each link in `text`, or each of `links` as it is, with its seat's key or the reason
    there is none."""
    ask = {
        "text": text,
        "seats": {row["key"]: row["link"] for row in seat_rows()},
        "aliases": aliases(),
        "go": _go(),
    }
    if links is not None:
        ask["links"] = links
    completed = subprocess.run(
        ["node", str(READER)],
        input=json.dumps(ask),
        capture_output=True,
        text=True,
        encoding="utf-8",
        check=False,
    )
    if completed.returncode != 0:
        raise VotesError(completed.stderr.strip() or f"votes.mjs exited {completed.returncode}")
    return json.loads(completed.stdout)


def resolved(rows: list[dict]) -> list[dict]:
    """The store's rows with every entry that named no seat matched again, in memory only.

    An entry that matches now gains its seat's `key` and `rematched: true`; one that still
    matches nothing is as it was stored. The store itself is never touched."""
    raws = list(
        dict.fromkeys(entry["link"] for row in rows for entry in row["links"] if "key" not in entry)
    )
    if not raws:
        return rows
    found = {entry["link"]: entry["key"] for entry in match(links=raws)["links"] if "key" in entry}
    if not found:
        return rows
    out = []
    for row in rows:
        entries = [
            dict(entry, key=found[entry["link"]], rematched=True)
            if "key" not in entry and entry["link"] in found
            else entry
            for entry in row["links"]
        ]
        out.append(dict(row, links=entries))
    return out


def rematched(rows: list[dict]) -> int:
    """How many stored entries `resolved` matched again."""
    return sum(1 for row in rows for entry in row["links"] if entry.get("rematched"))


# ------------------------------------------------------------------------------ ingest


def friend_name(name: str) -> str:
    folded = name.strip().lower()
    if not NAME.fullmatch(folded):
        raise VotesError(f"{name!r} is not a name the store keeps: letters, digits, . _ -")
    return folded


def ingest(name: str, text: str, *, now: datetime | None = None) -> list[str]:
    """Append one event for `name` and say what it held."""
    friend = friend_name(name)
    answer = match(text)
    entries = answer["links"]
    if not entries:
        raise VotesError("no links in that text, so nothing was stored")
    path = store_path()
    rows = resolved(events(path))
    before = selections(rows).get(friend, set())
    fresh = unstored(entries, before, {entry["link"] for entry in missed(rows).get(friend, [])})
    if fresh:
        at = (now or datetime.now(UTC)).strftime("%Y-%m-%dT%H:%M:%SZ")
        append({"schema": SCHEMA, "friend": friend, "at": at, "links": fresh}, path)

    matched = [entry["key"] for entry in entries if "key" in entry]
    distinct = list(dict.fromkeys(matched))
    new = [key for key in distinct if key not in before]
    misses = [entry for entry in entries if "key" not in entry]
    lines = [
        f"{friend}: {len(entries)} links, {len(matched)} matched a seat"
        + (f" ({len(distinct)} distinct)" if len(distinct) != len(matched) else ""),
        f"  {len(new)} new to {friend}, {len(distinct) - len(new)} already theirs; "
        f"{len(before | set(distinct))} picked in all",
    ]
    if answer["ignored"]:
        lines.append(f"  {answer['ignored']} words of other text around the links, ignored")
    for entry in misses:
        lines.append(f"  unmatched ({entry['reason']}): {entry['link']}")
        lines.append(f"    {entry['detail']}")
    if answer["unreadable_seats"]:
        lines.append(f"  ⚠ {len(answer['unreadable_seats'])} seats could not be read to match")
    if not fresh:
        lines.append(f"nothing new for {friend}, so nothing was appended to {path}")
    else:
        if len(fresh) != len(entries):
            lines.append(f"  {len(entries) - len(fresh)} entries already stored, not appended")
        lines.append(f"stored {len(fresh)} entries in {path}")
    browse()
    lines.append(f"page: {served_url()} (under `python -m builder serve`)")
    return lines


def unstored(entries: list[dict], keys: set[str], links: set[str]) -> list[dict]:
    """The entries a friend has not sent before, each once: a seat by key, a miss by link."""
    keys, links = set(keys), set(links)
    fresh = []
    for entry in entries:
        seen, mark = (keys, entry["key"]) if "key" in entry else (links, entry["link"])
        if mark not in seen:
            seen.add(mark)
            fresh.append(entry)
    return fresh


def missed(rows: list[dict]) -> dict[str, list[dict]]:
    """Each friend's links that matched no seat, once each by their raw text."""
    out: dict[str, list[dict]] = {}
    for row in rows:
        mine = out.setdefault(row["friend"], [])
        for entry in row["links"]:
            if "key" not in entry and all(held["link"] != entry["link"] for held in mine):
                mine.append(entry)
    return {friend: entries for friend, entries in out.items() if entries}


def status() -> list[str]:
    path = store_path()
    rows = events(path)
    if not rows:
        return [f"no votes yet ({path} is {'empty' if path.is_file() else 'not there'})"]
    rows = resolved(rows)
    picked = selections(rows)
    unmatched = {friend: len(entries) for friend, entries in missed(rows).items()}
    sent: dict[str, int] = {}
    for row in rows:
        sent[row["friend"]] = sent.get(row["friend"], 0) + 1
    general = {row["key"] for row in seat_rows() if ORDER_COLLECTION in row["collections"]}
    lines = [f"{path}: {len(rows)} events from {len(picked)} friends"]
    width = max(len(name) for name in picked)
    for friend in sorted(picked):
        keys = picked[friend]
        lines.append(
            f"  {friend:<{width}}  {len(keys):>4} picked, {len(keys & general):>4} in the "
            f"general thousand, {unmatched.get(friend, 0)} unmatched, {sent[friend]} events"
        )
    counted = likes(rows)
    lines.append(
        f"  {len(counted)} seats with a like; most liked: {max(counted.values(), default=0)}"
    )
    again = rematched(rows)
    if again:
        lines.append(f"  {again} stored entries that named no seat match one now (aliases)")
    return lines


# ------------------------------------------------------------------------ export-order

#: The general rank's tie-break, asked of the project that ranks: its membership's general
#: seats in `order`, drawn through `packs.seeded` at `packs.SEED`, then stable-sorted by
#: likes, and the file written held to `packs.read_order` before this says it is done.
ORDER_PROGRAM = """
import json, sys
from pathlib import Path

from fractal_wallpapers.curation import packs

full, out, collection, stamp = Path(sys.argv[1]), Path(sys.argv[2]), sys.argv[3], sys.argv[4]
likes = json.loads(sys.stdin.read())
general = sorted(
    (row for row in packs.read_membership(full) if row["collection"] == collection),
    key=lambda row: row["order"],
)
stamps = sorted({row["stamp"] for row in general})
if stamps != [stamp]:
    sys.exit(f"the full set's {collection} is {stamps}, and the site's is {stamp}")
seats = [str(row["key"]) for row in general]
ranked = sorted(packs.seeded(seats, packs.SEED), key=lambda key: -likes.get(key, 0))
out.parent.mkdir(parents=True, exist_ok=True)
with out.open("w", encoding="utf-8", newline="\\n") as held:
    held.write("".join(key + "\\n" for key in ranked))
assert packs.read_order(out, seats) == ranked
print(json.dumps({"seed": packs.SEED, "seats": len(seats), "top": ranked[:3]}))
"""


def export_order(out: Path) -> list[str]:
    from . import packs as site_packs

    full = site_packs.full_root()
    if full is None or not full.is_dir():
        raise VotesError(f"the full set is not here (`{site_packs.FULL_KEY}` in local.toml)")
    counted = likes(resolved(events()))
    general = {row["key"] for row in seat_rows() if ORDER_COLLECTION in row["collections"]}
    inside = {key: count for key, count in counted.items() if key in general}
    completed = subprocess.run(
        [
            str(renders.venv_python()),
            "-c",
            ORDER_PROGRAM,
            str(full),
            str(out.resolve()),
            ORDER_COLLECTION,
            ORDER_STAMP,
        ],
        input=json.dumps(inside),
        capture_output=True,
        text=True,
        encoding="utf-8",
        cwd=str(renders.wallpapers_root()),
        check=False,
    )
    if completed.returncode != 0:
        raise VotesError(f"the order was not written: {completed.stderr.strip()[-2000:]}")
    told = json.loads(completed.stdout)
    return [
        f"wrote {out}: {told['seats']} keys of {ORDER_COLLECTION} ({ORDER_STAMP}), "
        f"{len(inside)} with a like, the rest in packs.SEED {told['seed']}'s order",
        f"  {len(counted) - len(inside)} liked seats outside the thousand, ignored",
        "  packs.read_order accepts it; pass it as `curate packs build --order FILE`",
    ]


# ------------------------------------------------------------------------------ viewer


def viewer_path() -> Path:
    stated = os.environ.get(VIEWER_VARIABLE)
    return Path(stated) if stated is not None and stated.strip() else VIEWER


def pack_order() -> tuple[dict[str, list[str]], list[str], dict[str, list[str]], str | None]:
    """Which packs hold each seat, the general rank they ship in, and why not, if not.

    The general pack is cut into parts next door; the page names it once. The rank is the
    parts end to end, which the best packs are the opening of. The third answer is the
    pick mode's: each of the packs `packs.PICKED` names, in its staged membership.
    """
    from . import packs as site_packs
    from . import ranking

    why = site_packs.unaskable()
    if why is not None:
        return {}, [], {}, why
    held: dict[str, list[str]] = {}
    rank: list[str] = []
    current = site_packs.current()
    order = ranking.previews(current).order
    staged = {name: order[name] for name in site_packs.PICKED}
    for name, pack in current.items():
        general = name.startswith(f"{site_packs.GENERAL}-")
        shown = site_packs.GENERAL if general else name
        if general:
            rank.extend(pack["keys"])
        for key in pack["keys"]:
            names = held.setdefault(key, [])
            if shown not in names:
                names.append(shown)
    return held, rank, staged, None


def browse() -> Path:
    """Write the local page of everyone's picks, from the store as it stands."""
    from .palettes import HUES

    rows = resolved(events())
    picked = selections(rows)
    by_key = {row["key"]: row for row in seat_rows()}
    families = match("")["families"]
    from . import packs as site_packs

    held, rank, staged, why = pack_order()
    ranked = {key: at for at, key in enumerate(rank)}
    members = {name: set(keys) for name, keys in staged.items()}
    # The pick mode opens on what the packs page shows today, hand-picked or walked.
    _, loaded = site_packs.load()
    shown = {name: list(loaded[name].thumbs) for name in site_packs.PICKED if name in loaded}

    def tie(key: str) -> int:
        return ranked.get(key, len(rank) + by_key[key]["collections"].get("all", 0))

    tiles = {}
    for key in sorted({key for keys in picked.values() for key in keys if key in by_key}, key=tie):
        row = by_key[key]
        tiles[key] = {
            "file": row["file"],
            "link": row["link"],
            "alt": row["alt"],
            "palette": row["palette"],
            "hue": row["hue"],
            "mode": row["mode"],
            "family": families.get(key, "?"),
            "who": sorted(friend for friend, keys in picked.items() if key in keys),
            "score": score(friend for friend, keys in picked.items() if key in keys),
            "pinned": key in picked.get(PINNED, set()),
            "general": ORDER_COLLECTION in row["collections"],
            "packs": held.get(key, []),
            "staged": [name for name in site_packs.PICKED if key in members.get(name, ())],
            "tie": tie(key),
        }
    people = {}
    for friend in sorted(set(picked) | set(missed(rows))):
        keys = [key for key in tiles if key in picked.get(friend, set())]
        people[friend] = {
            "keys": keys,
            "hues": _tally(tiles[key]["hue"] for key in keys),
            "modes": _tally(tiles[key]["mode"] for key in keys),
            "families": _tally(tiles[key]["family"] for key in keys),
        }
    data = {
        "tiles": tiles,
        "people": people,
        "missed": missed(rows),
        "hues": list(HUES),
        "packs_note": why,
        "pick": {
            "packs": [
                {"name": name, "chip": PICK_CHIPS[name], "title": site_packs.title(name)}
                for name in site_packs.PICKED
            ],
            "limit": site_packs.SHOWN,
            "shown": shown,
            "file": f"wallpaper-packs/{site_packs.PICKS.name}",
        },
        "gone": sorted({key for keys in picked.values() for key in keys if key not in by_key}),
    }
    path = viewer_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    blob = json.dumps(data, ensure_ascii=False).replace("</", "<\\/")
    path.write_text(PAGE.replace("__DATA__", blob), encoding="utf-8", newline=LF)
    return path


#: The pick mode's chip for each pack it picks for.
PICK_CHIPS = {"best-30": "30", "best-100": "100", "best-200": "200", "general": "Main"}


def _tally(values) -> dict[str, int]:
    """Counts, most first."""
    counted: dict[str, int] = {}
    for value in values:
        counted[value] = counted.get(value, 0) + 1
    return dict(sorted(counted.items(), key=lambda item: -item[1]))


def served_url(port: int = 8000) -> str:
    """Where `builder serve` puts the page, or its file where it is outside the site."""
    path = viewer_path().resolve()
    root = SITE_ROOT.resolve()
    if not path.is_relative_to(root):
        return str(path)
    return f"http://localhost:{port}/{path.relative_to(root).as_posix()}"


PAGE = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Friends' votes</title>
<style>
  :root { --bg: #fff; --ink: #1d1f23; --soft: #5b6270; --well: #15171b; --chip: #e8ecf3; }
  body { margin: 0; padding: 16px; font: 15px/1.4 system-ui, sans-serif;
    background: var(--bg); color: var(--ink); }
  h1 { font-size: 22px; margin: 0 0 4px; }
  .bar { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; margin: 12px 0; }
  .bar label { color: var(--soft); }
  .grid { display: grid; gap: 12px;
    grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); }
  .tile { background: var(--well); border-radius: 6px; overflow: hidden; color: #eef1f6; }
  .tile img { display: block; width: 100%; aspect-ratio: 316 / 178; object-fit: cover; }
  .meta { padding: 6px 8px 8px; display: flex; flex-wrap: wrap; gap: 4px; align-items: center; }
  .count { font-weight: 700; margin-right: 4px; }
  .chip { background: #2d323b; border-radius: 10px; padding: 1px 8px; font-size: 13px; }
  .key { width: 100%; font: 12px ui-monospace, monospace; color: #9aa3b2;
    overflow-wrap: anywhere; }
  .missed li { word-break: break-all; margin: 4px 0; }
  .why { color: var(--soft); }
  .tabs button { font: inherit; padding: 4px 12px; border: 1px solid #c9ceda;
    background: var(--bg); border-radius: 4px; cursor: pointer; }
  .tabs button[aria-pressed="true"] { background: var(--ink); color: var(--bg); }
  .person { margin: 28px 0; border-top: 1px solid #dfe3ea; padding-top: 8px; }
  .person h2 { margin: 0 0 4px; }
  .hues { display: flex; height: 18px; border-radius: 4px; overflow: hidden; max-width: 720px;
    margin: 6px 0; }
  .hues span { display: block; }
  .facts { margin: 2px 0; }
  .facts b { font-weight: 600; }
  .small .grid { grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 8px; }
  .yes { color: #7fd48a; }
  .no { color: #9aa3b2; }
  .picks { position: sticky; top: 0; z-index: 2; background: var(--bg);
    border-bottom: 1px solid #dfe3ea; padding: 8px 0; margin-bottom: 12px; }
  .picks-row { display: flex; flex-wrap: wrap; gap: 6px 10px; align-items: center;
    margin: 4px 0; }
  .picks-row b { min-width: 130px; }
  .picks-row img { width: 80px; aspect-ratio: 316 / 178; object-fit: cover; border-radius: 3px;
    cursor: pointer; }
  .picks-row .slot { width: 80px; aspect-ratio: 316 / 178; border: 1px dashed #c9ceda;
    border-radius: 3px; box-sizing: border-box; }
  .picks-tools { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
  .picks-tools button { font: inherit; padding: 4px 12px; border-radius: 4px; cursor: pointer;
    border: 1px solid #c9ceda; background: var(--bg); }
  .picks-tools .copy { background: #2c6fd6; border-color: #2c6fd6; color: #fff; }
  #pick-status { color: #b3261e; }
  #pick-json { width: 100%; height: 150px; font: 12px ui-monospace, monospace; }
  .toggle { font: 13px system-ui, sans-serif; border-radius: 10px; padding: 1px 9px;
    cursor: pointer; background: transparent; color: #eef1f6; }
  .toggle.member { border: 1px solid #eef1f6; }
  .toggle.outside { border: 1px dashed #6b7381; color: #9aa3b2; }
  .toggle[aria-pressed="true"] { background: #7fd48a; border: 1px solid #7fd48a; color: #10331a;
    font-weight: 700; }
  .tile.chosen { outline: 3px solid #7fd48a; }
</style>
</head>
<body>
<h1>Friends' votes</h1>
<p class="why" id="summary"></p>
<div class="bar tabs">
  <button id="tab-person" aria-pressed="true">By person</button>
  <button id="tab-score" aria-pressed="false">By score</button>
  <button id="tab-pick" aria-pressed="false">Pick previews</button>
  <label>Friend <select id="friend"><option value="">everyone</option></select></label>
  <label id="only-label" hidden><input type="checkbox" id="only"> picked only</label>
</div>
<main id="view"></main>
<script>
const DATA = __DATA__;
const IMAGES = "../../assets/images/galleries/seated-candidates/";
const EXPLORER = "../../explorer/?";
const SWATCH = {
  rose: "#e8638f", red: "#d63a2f", orange: "#ef8a2c", yellow: "#e8c93a", lime: "#a6d13c",
  green: "#3fa35a", teal: "#2a9d8f", cyan: "#3cc4dc", azure: "#3a8ee8", blue: "#3a4fd6",
  purple: "#8a4fd0", magenta: "#cc3fb8",
};
const $ = (id) => document.getElementById(id);
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}
const friends = Object.keys(DATA.people);
for (const f of friends) {
  const o = el("option", "", f);
  o.value = f;
  $("friend").append(o);
}
const seated = Object.keys(DATA.tiles);
$("summary").textContent = `${friends.length} voters, ${seated.length} scored seats.` +
  (DATA.packs_note ? ` No pack columns: ${DATA.packs_note}.` : "") +
  (DATA.gone.length ? ` ${DATA.gone.length} voted seats are no longer in the record.` : "");

/** A link a friend sent, as something to click: a whole URL as it is, else the explorer. */
function hrefOf(raw) {
  return /^https?:[/][/]/i.test(raw) ? raw : EXPLORER + raw.replace(/^[^?]*[?]/, "");
}
function tile(key, extra) {
  const t = DATA.tiles[key];
  const box = el("div", "tile");
  const a = el("a");
  a.href = EXPLORER + t.link;
  a.target = "_blank";
  const img = el("img");
  img.src = IMAGES + t.file;
  img.alt = t.alt;
  img.loading = "lazy";
  a.append(img);
  const meta = el("div", "meta");
  if (extra) extra(meta, t);
  meta.append(el("span", "key", `${t.hue} · ${t.mode} · ${t.family} · ${t.palette}`));
  box.append(a, meta);
  return box;
}
function share(counts, total) {
  return Object.entries(counts)
    .map(([name, n]) => `${name} ${Math.round((100 * n) / total)}%`).join(", ");
}
function person(f) {
  const p = DATA.people[f];
  const sec = el("section", "person small");
  sec.append(el("h2", "", f));
  const total = p.keys.length;
  const missed = DATA.missed[f] || [];
  sec.append(el("p", "why", `${total} scored picks, ${missed.length} links that are no seat.`));
  if (total) {
    const bar = el("div", "hues");
    for (const hue of DATA.hues) {
      const n = p.hues[hue] || 0;
      if (!n) continue;
      const s = el("span");
      s.style.width = `${(100 * n) / total}%`;
      s.style.background = SWATCH[hue];
      s.title = `${hue} ${n} of ${total}`;
      bar.append(s);
    }
    sec.append(bar);
    for (const [label, counts] of [["Color", p.hues], ["Mode", p.modes],
      ["Family", p.families]]) {
      const line = el("p", "facts");
      line.append(el("b", "", `${label}: `), document.createTextNode(share(counts, total)));
      sec.append(line);
    }
    const grid = el("div", "grid");
    grid.append(...p.keys.map((key) => tile(key, (meta, t) => {
      if (t.who.length > 1) meta.append(el("span", "count", `${t.who.length} votes`));
    })));
    sec.append(grid);
  }
  if (missed.length) {
    sec.append(el("h3", "", "Not scored: not a seat in the published full set"));
    const ul = el("ul", "missed");
    for (const m of missed) {
      const li = el("li");
      const a = el("a", "", m.link);
      a.href = hrefOf(m.link);
      a.target = "_blank";
      li.append(el("span", "why", `${m.reason}: `), a);
      ul.append(li);
    }
    sec.append(ul);
  }
  return sec;
}
function byScore(friend) {
  const keys = seated.filter((k) => !friend || DATA.tiles[k].who.includes(friend));
  keys.sort((a, b) => DATA.tiles[b].score - DATA.tiles[a].score ||
    DATA.tiles[a].tie - DATA.tiles[b].tie);
  const grid = el("div", "grid");
  grid.append(...keys.map((key) => tile(key, (meta, t) => {
    meta.append(el("span", "count", `${t.pinned ? "📌 " : ""}${t.score} ♥`));
    t.who.forEach((f) => meta.append(el("span", "chip", f)));
    meta.append(el("span", t.general ? "yes" : "no", t.general ? "n=1000" : "not in n=1000"));
    meta.append(el("span", "key", `packs: ${t.packs.length ? t.packs.join(", ") : "none"}`));
  })));
  return grid;
}
// ---- pick mode: Matt's own previews for the best packs and the main gallery, as JSON to
// paste back into wallpaper-packs/preview-picks.json. At most `limit` a pack, no seat in two.
const PICK = DATA.pick;
const STORED = "packs-preview-picks";
function fresh() {
  const out = {};
  for (const p of PICK.packs) out[p.name] = [...(PICK.shown[p.name] || [])];
  return out;
}
let picks = fresh();
try {
  const kept = JSON.parse(localStorage.getItem(STORED) || "null");
  if (kept && PICK.packs.every((p) => Array.isArray(kept[p.name]))) picks = kept;
} catch (e) { /* no storage: start from the page */ }
for (const p of PICK.packs) picks[p.name] = picks[p.name].filter((key) => DATA.tiles[key]);
function save() {
  try { localStorage.setItem(STORED, JSON.stringify(picks)); } catch (e) { /* fine */ }
}
function holder(key) {
  return PICK.packs.find((p) => picks[p.name].includes(key))?.name;
}
function titleOf(name) { return PICK.packs.find((p) => p.name === name).title; }
let status = "";
function toggle(key, name) {
  status = "";
  const list = picks[name];
  if (list.includes(key)) {
    list.splice(list.indexOf(key), 1);
  } else if (list.length >= PICK.limit) {
    status = `${titleOf(name)} already has ${PICK.limit}: take one out first.`;
  } else {
    const other = holder(key);
    if (other) picks[other].splice(picks[other].indexOf(key), 1);
    list.push(key);
  }
  save();
  draw();
}
function asJson() {
  return JSON.stringify({ schema: 1, kind: "preview-picks", packs: picks }, null, 2) + "\\n";
}
function pickBar() {
  const bar = el("div", "picks");
  for (const p of PICK.packs) {
    const row = el("div", "picks-row");
    row.append(el("b", "", `${p.title} ${picks[p.name].length}/${PICK.limit}`));
    for (const key of picks[p.name]) {
      const img = el("img");
      img.src = IMAGES + DATA.tiles[key].file;
      img.title = `${key}: click to take out of ${p.title}`;
      img.addEventListener("click", () => toggle(key, p.name));
      row.append(img);
    }
    for (let n = picks[p.name].length; n < PICK.limit; n++) row.append(el("span", "slot"));
    bar.append(row);
  }
  const tools = el("div", "picks-tools");
  const copy = el("button", "copy", "Copy picks");
  const reset = el("button", "", "Reset to the packs page");
  const note = el("span", "", status);
  note.id = "pick-status";
  const legend = el("span", "why",
    "Solid chip: in that pack's staged membership. Dashed: not, and pickable anyway.");
  tools.append(copy, reset, note, legend);
  bar.append(tools);
  const out = el("textarea");
  out.id = "pick-json";
  out.readOnly = true;
  out.hidden = true;
  bar.append(out);
  copy.addEventListener("click", async () => {
    out.value = asJson();
    out.hidden = false;
    try {
      await navigator.clipboard.writeText(out.value);
      note.style.color = "#2e7d32";
      note.textContent = `Copied. Paste it back for ${PICK.file}.`;
    } catch (e) {
      out.select();
      note.textContent = "The clipboard refused: copy it from the box below.";
    }
  });
  reset.addEventListener("click", () => { picks = fresh(); status = ""; save(); draw(); });
  return bar;
}
function pickGrid(friend) {
  const only = $("only").checked;
  const keys = seated.filter((k) => (!friend || DATA.tiles[k].who.includes(friend)) &&
    (!only || holder(k)));
  keys.sort((a, b) => DATA.tiles[b].score - DATA.tiles[a].score ||
    DATA.tiles[a].tie - DATA.tiles[b].tie);
  const grid = el("div", "grid");
  grid.append(...keys.map((key) => {
    const box = tile(key, (meta, t) => {
      meta.append(el("span", "count", `${t.pinned ? "📌 " : ""}${t.score} ♥`));
      for (const p of PICK.packs) {
        const inside = t.staged.includes(p.name);
        const chip = el("button", `toggle ${inside ? "member" : "outside"}`, p.chip);
        chip.setAttribute("aria-pressed", String(picks[p.name].includes(key)));
        chip.title = `${p.title}: ${inside ? "in" : "not in"} its staged membership`;
        chip.addEventListener("click", () => toggle(key, p.name));
        meta.append(chip);
      }
      meta.append(el("span", "chip", t.who.join(", ")));
    });
    if (holder(key)) box.classList.add("chosen");
    return box;
  }));
  return grid;
}
let mode = location.hash === "#pick" ? "pick" : "person";
function draw() {
  const friend = $("friend").value;
  for (const name of ["person", "score", "pick"]) {
    $(`tab-${name}`).setAttribute("aria-pressed", String(mode === name));
  }
  $("only-label").hidden = mode !== "pick";
  const view = $("view");
  if (mode === "person") {
    view.replaceChildren(...friends.filter((f) => !friend || f === friend).map(person));
  } else if (mode === "score") {
    view.replaceChildren(byScore(friend));
  } else {
    view.replaceChildren(pickBar(), pickGrid(friend));
  }
}
$("tab-person").addEventListener("click", () => { mode = "person"; draw(); });
$("tab-score").addEventListener("click", () => { mode = "score"; draw(); });
$("tab-pick").addEventListener("click", () => { mode = "pick"; draw(); });
$("friend").addEventListener("change", draw);
$("only").addEventListener("change", draw);
draw();
</script>
</body>
</html>
"""
