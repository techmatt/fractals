"""Friends' votes: the links they send, which seats those are, and the order they make.

A friend sends a list of explorer links, each one a favourite with no score. `ingest`
reads the list with the explorer's own reader (`votes.mjs`), names the seat each link
draws out of `seated-candidates/all.jsonl`, and appends **one event** to the store;
`status` counts, `view` writes a local page of everyone's picks, and `export-order`
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

## The match

Exact on the recipe as `permalink.js` parses and re-spells it, with `level` taken off: it
is the tone curve a pass derived from the rest, and about 1,500 gallery links gained it
after friends could have copied the link without it. No tolerance.

## The page

`artifacts/votes/index.html`, which is ignored, is walked by no check, and is served by
`builder serve` at `/artifacts/votes/`. It is rewritten after every ingest and by `view`.
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


def likes(rows: list[dict]) -> dict[str, int]:
    """How many friends picked each seat."""
    count: dict[str, int] = {}
    for keys in selections(rows).values():
        for key in keys:
            count[key] = count.get(key, 0) + 1
    return count


# ---------------------------------------------------------------------------- matching


def seat_rows() -> list[dict]:
    """Every seat the gallery panel can show, in the `all` collection's page order."""
    rows = [json.loads(line) for line in ALL_SEATS.read_text(encoding="utf-8").splitlines()]
    return sorted(rows, key=lambda row: row["collections"].get("all", 0))


def _go() -> dict[str, str]:
    lines = GO_REGISTER.read_text(encoding="utf-8").splitlines() if GO_REGISTER.is_file() else []
    return {row["name"]: row["target"] for row in map(json.loads, filter(str.strip, lines))}


def match(text: str) -> dict:
    """Each link in `text`, with its seat's key or the reason there is none."""
    ask = {
        "text": text,
        "seats": {row["key"]: row["link"] for row in seat_rows()},
        "go": _go(),
    }
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
    before = selections(events(path)).get(friend, set())
    at = (now or datetime.now(UTC)).strftime("%Y-%m-%dT%H:%M:%SZ")
    append({"schema": SCHEMA, "friend": friend, "at": at, "links": entries}, path)

    matched = [entry["key"] for entry in entries if "key" in entry]
    distinct = list(dict.fromkeys(matched))
    new = [key for key in distinct if key not in before]
    missed = [entry for entry in entries if "key" not in entry]
    lines = [
        f"{friend}: {len(entries)} links, {len(matched)} matched a seat"
        + (f" ({len(distinct)} distinct)" if len(distinct) != len(matched) else ""),
        f"  {len(new)} new to {friend}, {len(distinct) - len(new)} already theirs; "
        f"{len(before | set(distinct))} picked in all",
    ]
    if answer["ignored"]:
        lines.append(f"  {answer['ignored']} words of other text around the links, ignored")
    for entry in missed:
        lines.append(f"  unmatched ({entry['reason']}): {entry['link']}")
        lines.append(f"    {entry['detail']}")
    if answer["unreadable_seats"]:
        lines.append(f"  ⚠ {len(answer['unreadable_seats'])} seats could not be read to match")
    lines.append(f"stored in {path}")
    view()
    lines.append(f"page: {served_url()} (under `python -m builder serve`)")
    return lines


def status() -> list[str]:
    path = store_path()
    rows = events(path)
    if not rows:
        return [f"no votes yet ({path} is {'empty' if path.is_file() else 'not there'})"]
    picked = selections(rows)
    unmatched: dict[str, int] = {}
    sent: dict[str, int] = {}
    for row in rows:
        sent[row["friend"]] = sent.get(row["friend"], 0) + 1
        unmatched[row["friend"]] = unmatched.get(row["friend"], 0) + sum(
            "key" not in entry for entry in row["links"]
        )
    general = {row["key"] for row in seat_rows() if ORDER_COLLECTION in row["collections"]}
    lines = [f"{path}: {len(rows)} events from {len(picked)} friends"]
    width = max(len(name) for name in picked)
    for friend in sorted(picked):
        keys = picked[friend]
        lines.append(
            f"  {friend:<{width}}  {len(keys):>4} picked, {len(keys & general):>4} in the "
            f"general thousand, {unmatched[friend]} unmatched, {sent[friend]} events"
        )
    counted = likes(rows)
    lines.append(
        f"  {len(counted)} seats with a like; most liked: {max(counted.values(), default=0)}"
    )
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
    counted = likes(events())
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


def view() -> Path:
    """Write the local page of everyone's picks, from the store as it stands."""
    rows = events()
    picked = selections(rows)
    by_key = {row["key"]: row for row in seat_rows()}
    header = json.loads((SEATED / "gallery.jsonl").read_text(encoding="utf-8").splitlines()[0])
    tiles = []
    for key, row in by_key.items():
        who = sorted(friend for friend, keys in picked.items() if key in keys)
        if who:
            tiles.append(
                {
                    "key": key,
                    "file": row["file"],
                    "link": row["link"],
                    "alt": row["alt"],
                    "palette": row["palette"],
                    "who": who,
                    "in": sorted(row["collections"]),
                    "at": row["collections"].get("all", 0),
                }
            )
    gone = sorted({key for keys in picked.values() for key in keys if key not in by_key})
    missed: dict[str, list[dict]] = {}
    for row in rows:
        for entry in row["links"]:
            if "key" not in entry:
                missed.setdefault(row["friend"], []).append(entry)
    data = {
        "tiles": tiles,
        "friends": sorted(picked),
        "collections": [entry["name"] for entry in header["collections"]],
        "missed": missed,
        "gone": gone,
    }
    path = viewer_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    blob = json.dumps(data, ensure_ascii=False).replace("</", "<\\/")
    path.write_text(PAGE.replace("__DATA__", blob), encoding="utf-8", newline=LF)
    return path


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
  .missed { margin-top: 32px; }
  .missed li { word-break: break-all; margin: 4px 0; }
  .why { color: var(--soft); }
</style>
</head>
<body>
<h1>Friends' votes</h1>
<p class="why" id="summary"></p>
<div class="bar">
  <label>Friend <select id="friend"><option value="">everyone</option></select></label>
  <label>Collection <select id="collection"><option value="">any</option></select></label>
  <label>Sort <select id="sort">
    <option value="count">most liked</option><option value="page">gallery order</option>
  </select></label>
</div>
<div class="grid" id="grid"></div>
<section class="missed" id="missed"></section>
<script>
const DATA = __DATA__;
const IMAGES = "../../assets/images/galleries/seated-candidates/";
const EXPLORER = "../../explorer/?";
const $ = (id) => document.getElementById(id);
function option(select, value) {
  const o = document.createElement("option");
  o.value = o.textContent = value;
  select.append(o);
}
DATA.friends.forEach((f) => option($("friend"), f));
DATA.collections.forEach((c) => option($("collection"), c));
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}
function draw() {
  const friend = $("friend").value, collection = $("collection").value;
  let shown = DATA.tiles.filter((t) =>
    (!friend || t.who.includes(friend)) && (!collection || t.in.includes(collection)));
  shown.sort((a, b) => $("sort").value === "count"
    ? b.who.length - a.who.length || a.at - b.at : a.at - b.at);
  $("summary").textContent = `${shown.length} of ${DATA.tiles.length} liked seats shown, ` +
    `${DATA.friends.length} friends.` + (DATA.gone.length ?
    ` ${DATA.gone.length} liked seats are no longer in the gallery record.` : "");
  const grid = $("grid");
  grid.replaceChildren(...shown.map((t) => {
    const tile = el("div", "tile");
    const a = el("a");
    a.href = EXPLORER + t.link;
    a.target = "_blank";
    const img = el("img");
    img.src = IMAGES + t.file;
    img.alt = t.alt;
    img.loading = "lazy";
    a.append(img);
    const meta = el("div", "meta");
    meta.append(el("span", "count", `${t.who.length} ♥`));
    t.who.forEach((f) => meta.append(el("span", "chip", f)));
    meta.append(el("span", "key", `${t.key} · ${t.palette}`));
    tile.append(a, meta);
    return tile;
  }));
  const missed = $("missed");
  missed.replaceChildren();
  const names = Object.keys(DATA.missed).filter((f) => !friend || f === friend).sort();
  if (names.length) missed.append(el("h2", "", "Links that matched no seat"));
  for (const f of names) {
    missed.append(el("h3", "", f));
    const ul = el("ul");
    for (const m of DATA.missed[f]) {
      const li = el("li");
      li.append(el("span", "why", `${m.reason}: `), document.createTextNode(m.link));
      ul.append(li);
    }
    missed.append(ul);
  }
}
["friend", "collection", "sort"].forEach((id) => $(id).addEventListener("change", draw));
draw();
</script>
</body>
</html>
"""
