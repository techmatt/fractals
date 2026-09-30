"""The friends' votes as a pack order, and the five pictures each pack's block shows.

    python -m builder packs stage   # STAGING: the page under artifacts/packs-stage/

## The ranking

A seat's score is its vote count, one per voter, from `votes.resolved` so that an old
spelling of a seat's link still counts. A pack's staged order is its **current** order
(`packs.current()`, a built zip's order winning over the seeded plan) stable-sorted by
score, so the current order is the tie-break and an unvoted pack keeps the order it ships
in. The general thousand in that order is written as an order file, and next door's
`packs.plan()` is asked with it, so the general parts and the best packs are cut the way
`curate packs build --order FILE` would cut them rather than by a restatement here.

**A colour pack's staged order is not one next door can ship yet.** `plan()` takes the
order file for the general thousand only and draws each colour pack's own seeded shuffle,
so the colour order here is this module's alone until the project next door takes an
order per collection.

## The five pictures

`pick` walks a pack's members in staged order and takes the first `PREVIEWS` that pass
three rules, which are Matt's first cut and are constants so he can tune them:

- a seat shown anywhere else on the site is skipped (`shown_on_site`: every figure panel
  and figure source key that is a seat, whatever the figure is for, since reuse is reuse);
- a seat already chosen by an earlier pack on the page is skipped, walking the packs in
  page order;
- no hue family takes more than `HUE_CAP` of a pack's five, except in a colour pack, which
  is one family by construction.

The pack page's own five pictures are not on the site for this purpose: they are what the
staged picks replace.

## The staging page

`artifacts/packs-stage/index.html` is ignored, walked by no check, and served by `builder
serve` at `/artifacts/packs-stage/`. It shows each pack's block as the packs page lays it
out, with the staged five and no download line, then the staged Best 200 in three bands
(Best 30, then the ranks each larger pack adds), each tile with its score, its voters, and
what each preview walk that reached it made of it.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path

from . import figures, packs, seats, votes
from .escape import attribute, text
from .paths import GALLERY_IMAGES_DIR, SITE_ROOT, relative_href

#: How many pictures a pack's block shows.
PREVIEWS = packs.SHOWN

#: At most this many of one pack's previews share a hue family, outside the colour packs.
HUE_CAP = 2

#: Why a member was passed over for a preview.
ON_SITE = "on the site"
EARLIER = "an earlier preview"
HUE = "hue cap"
REASONS = (ON_SITE, EARLIER, HUE)

#: The staging output: ignored, and never tracked, because Pages serves everything tracked.
STAGE_DIR = SITE_ROOT / "artifacts" / "packs-stage"
STAGE_PAGE = STAGE_DIR / "index.html"
ORDER_FILE = STAGE_DIR / "order.txt"

LF = "\n"


# ----------------------------------------------------------------------------- the ranking


def voters() -> dict[str, list[str]]:
    """Who voted for each seat, old spellings of a seat's link included."""
    picked = votes.selections(votes.resolved(votes.events()))
    out: dict[str, list[str]] = {}
    for friend in sorted(picked):
        for key in picked[friend]:
            out.setdefault(key, []).append(friend)
    return out


def ranked(keys: list[str], scores: dict[str, int]) -> list[str]:
    """`keys` by score, most first, ties in the order given."""
    return sorted(keys, key=lambda key: -scores.get(key, 0))


def general_order(current: dict[str, dict]) -> list[str]:
    """The general thousand as it ships: its parts end to end."""
    parts = sorted(name for name in current if name.startswith(f"{packs.GENERAL}-"))
    return [key for name in parts for key in current[name]["keys"]]


def staged(scores: dict[str, int]) -> tuple[dict[str, list[str]], list[str]]:
    """Each pack on the page by name, members in staged order, and the general rank.

    The general pack is its parts end to end, as the page names it once.
    """
    current = packs.current()
    order = ranked(general_order(current), scores)
    ORDER_FILE.parent.mkdir(parents=True, exist_ok=True)
    ORDER_FILE.write_text("".join(key + LF for key in order), encoding="utf-8", newline=LF)
    # Read raw, never through `current()`: its built-wins merge puts the shipped order back.
    planned = {pack["name"]: pack for pack in packs._asked(ORDER_FILE)["planned"]}
    out: dict[str, list[str]] = {}
    for name in packs.marked():
        if name == packs.GENERAL:
            out[name] = general_order(planned)
        elif name in packs.BEST:
            out[name] = planned[name]["keys"]
        else:
            out[name] = ranked(current[name]["keys"], scores)
        ships = general_order(current) if name == packs.GENERAL else current[name]["keys"]
        if name in packs.BEST:
            ships = order[: len(current[name]["keys"])]
        if set(out[name]) != set(ships):
            raise packs.PacksError(f"staged {name} is not the members {name} ships")
    if out[packs.GENERAL] != order:
        raise packs.PacksError("next door's plan did not keep the staged general order")
    return out, order


# ------------------------------------------------------------------------------ the census


def shown_on_site() -> dict[str, list[str]]:
    """Every seat a figure shows, by recipe key, with the figures that show it.

    Three routes, as flag_sheet_ckpt157 found them: a panel's link that the ingest matcher
    names a seat, a panel's `from` that names one by key where the link differs, and a
    figure's source key that is a seat no panel link carried. The matcher's answers are
    aligned by link text, never by position, because it drops what it cannot read.
    """
    seat_keys = {row["key"] for row in votes.seat_rows()}
    with_link = [row for row in _jsonl(SITE_ROOT / "explorer" / "links.jsonl") if "link" in row]
    asked = ["explorer/?" + row["link"] for row in with_link]
    matched = {
        entry["link"]: entry["key"] for entry in votes.match(links=asked)["links"] if "key" in entry
    }
    shown: dict[str, list[str]] = {}

    def seen(key: str, figure: str) -> None:
        places = shown.setdefault(key, [])
        if figure not in places:
            places.append(figure)

    for row in with_link:
        figure = row["id"].split(":", 1)[1].partition("#")[0]
        key = matched.get("explorer/?" + row["link"])
        if key is None and row.get("from", "").startswith("seat "):
            key = row["from"].split("|")[-1]
        if key in seat_keys:
            seen(key, figure)
    for row in _jsonl(SITE_ROOT / "article" / "figures.jsonl"):
        for source in row.get("sources") or []:
            for raw in source.get("keys") or []:
                key = str(raw).split("|")[-1]
                if key in seat_keys:
                    seen(key, row["id"])
    return shown


def _jsonl(path: Path) -> list[dict]:
    lines = path.read_text(encoding="utf-8").splitlines()
    return [json.loads(line) for line in lines if line.strip()]


# ------------------------------------------------------------------------------ the picker


@dataclass
class Previews:
    """One pack's five, and every member its walk passed over before the fifth, and why."""

    name: str
    picks: list[str] = field(default_factory=list)
    skipped: dict[str, str] = field(default_factory=dict)

    def counts(self) -> dict[str, int]:
        return {why: sum(1 for said in self.skipped.values() if said == why) for why in REASONS}


def pick(
    name: str,
    members: list[str],
    hue: dict[str, str],
    on_site: set[str],
    taken: set[str],
    *,
    capped: bool,
) -> Previews:
    """A pack's `PREVIEWS`, walking `members` in order under the three rules."""
    chosen = Previews(name)
    per_hue: dict[str, int] = {}
    for key in members:
        if len(chosen.picks) == PREVIEWS:
            break
        if key in on_site:
            chosen.skipped[key] = ON_SITE
        elif key in taken:
            chosen.skipped[key] = EARLIER
        elif capped and per_hue.get(hue[key], 0) >= HUE_CAP:
            chosen.skipped[key] = HUE
        else:
            chosen.picks.append(key)
            per_hue[hue[key]] = per_hue.get(hue[key], 0) + 1
    return chosen


def pick_all(
    order: dict[str, list[str]], hue: dict[str, str], on_site: set[str]
) -> dict[str, Previews]:
    """Every pack's previews, in page order, none reused and none shown on the site."""
    taken: set[str] = set()
    out = {}
    for name in packs.marked():
        collection = packs.GENERAL if name in packs.BEST else name
        chosen = pick(name, order[name], hue, on_site, taken, capped=collection == packs.GENERAL)
        taken.update(chosen.picks)
        out[name] = chosen
    return out


# ------------------------------------------------------------------------------- the stage


def stage() -> list[str]:
    """Rank, pick and write the staging page; the lines say what came out."""
    why = packs.unaskable()
    if why is not None:
        raise packs.PacksError(f"cannot stage the packs: {why}")
    who = voters()
    scores = {key: len(names) for key, names in who.items()}
    order, general = staged(scores)
    rows = packs.seat_rows()
    hue = {key: row["hue"] for key, row in rows.items()}
    site = shown_on_site()
    previews = pick_all(order, hue, set(site))
    _write(order, previews, rows, who, site)

    best = order[packs.BEST[-1]]
    lines = [f"page: {_served()} (under `python -m builder serve`)", f"order: {ORDER_FILE}"]
    lines.append(
        f"{sum(1 for key in best if scores.get(key))} of {packs.title(packs.BEST[-1])} ranked "
        f"by votes, {sum(1 for key in best if not scores.get(key))} by the tie-break; "
        f"{len(site)} seats shown on the site"
    )
    for name, chosen in previews.items():
        skipped = ", ".join(f"{n} {why}" for why, n in chosen.counts().items() if n)
        lines.append(f"  {name:<9} {' '.join(chosen.picks)}  skipped: {skipped or 'none'}")
    return lines


def _served(port: int = 8000) -> str:
    return f"http://localhost:{port}/{STAGE_PAGE.relative_to(SITE_ROOT).as_posix()}"


def _tile(page, explorer, rank, row, names, marks, site) -> str:
    """One Best 200 tile: its rank, votes and voters, hue, and what the walks made of it."""
    src = relative_href(page, GALLERY_IMAGES_DIR / seats.SLUG / row["file"])
    facts = [f"#{rank}", f"{len(names)} vote{'' if len(names) == 1 else 's'}", *names]
    lines = [text(" · ".join(facts)), f'<span class="stage-hue">{text(row["hue"])}</span>']
    lines += [f'<span class="stage-mark">{text(mark)}</span>' for mark in marks]
    figures_showing = site.get(row["key"], [])
    if figures_showing:
        many = "s" if len(figures_showing) > 1 else ""
        lines.append(
            f'<span class="stage-where">shown in {len(figures_showing)} figure{many}: '
            f"{text(', '.join(figures_showing))}</span>"
        )
    picked = " picked" if any(mark.startswith("preview") for mark in marks) else ""
    return (
        f'        <div class="stage-tile{picked}">'
        f'<a href="{attribute(explorer + "?" + row["link"])}" target="_blank">'
        f'<img src="{attribute(src)}" alt="{attribute(row["alt"])}" loading="lazy"></a>'
        f"<p>{'<br>'.join(lines)}</p></div>"
    )


def _write(order, previews, rows, who, site) -> None:
    page = STAGE_PAGE
    explorer = relative_href(page, SITE_ROOT / "explorer" / "index.html")
    blocks = []
    for name, chosen in previews.items():
        shown = packs.Pack(name, name, (), tuple(chosen.picks))
        block = packs.block(page, shown, rows).replace(
            f'{figures.INDENT}  <ul class="pack-downloads">{LF}{figures.INDENT}  </ul>{LF}',
            "",
        )
        skipped = ", ".join(f"{n} {why}" for why, n in chosen.counts().items() if n)
        blocks.append(block)
        blocks.append(
            f'      <p class="stage-note">Skipped for a preview: {text(skipped or "none")}.</p>'
        )

    walks: dict[str, list[str]] = {}
    for name, chosen in previews.items():
        for key in chosen.picks:
            walks.setdefault(key, []).append(f"preview of {packs.title(name)}")
        for key, why in chosen.skipped.items():
            walks.setdefault(key, []).append(f"{packs.title(name)}: {why}")

    bands = []
    best = order[packs.BEST[-1]]
    start = 0
    for name in packs.BEST:
        end = len(order[name])
        tiles = [
            _tile(page, explorer, rank, rows[key], who.get(key, []), walks.get(key, []), site)
            for rank, key in enumerate(best[start:end], start + 1)
        ]
        heading = (
            packs.title(name) if start == 0 else f"{packs.title(name)}: ranks {start + 1} to {end}"
        )
        bands.append(f"      <h2>{text(heading)}</h2>")
        bands.append('      <div class="stage-grid">')
        bands.extend(tiles)
        bands.append("      </div>")
        start = end

    css = relative_href(page, SITE_ROOT / "assets" / "css" / "site.css")
    body = LF.join(
        [
            "<!doctype html>",
            '<html lang="en">',
            "<head>",
            '<meta charset="utf-8">',
            '<meta name="viewport" content="width=device-width, initial-scale=1">',
            '<meta name="robots" content="noindex">',
            "<title>Packs, staged</title>",
            f'<link rel="stylesheet" href="{attribute(css)}">',
            "<style>",
            STYLE,
            "</style>",
            "</head>",
            "<body>",
            '<div class="page">',
            "<main>",
            '  <section class="prose">',
            "    <h1>Wallpaper packs, staged from the votes</h1>",
            "    <p>STAGED, not published. Each pack's five are the picker's first cut: "
            f"no seat shown elsewhere on the site, none reused on this page, and at most "
            f"{HUE_CAP} of one hue family outside the color packs. Scores are votes, one per "
            "voter; ties keep the order the packs ship in.</p>",
            *blocks,
            *bands,
            "  </section>",
            "</main>",
            "</div>",
            "</body>",
            "</html>",
            "",
        ]
    )
    page.parent.mkdir(parents=True, exist_ok=True)
    page.write_text(body, encoding="utf-8", newline=LF)


STYLE = """
.page { display: block; }
.stage-note { font-size: 0.85rem; color: #5b6270; margin: -0.6rem 0 1.6rem; }
.stage-grid { display: grid; gap: 10px; margin: 0 0 2rem;
  grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); max-width: none; }
.stage-tile { background: var(--well); border-radius: 4px; overflow: hidden; }
.stage-tile.picked { outline: 3px solid #7fd48a; }
.stage-tile img { display: block; width: 100%; height: auto; aspect-ratio: 316 / 178;
  object-fit: cover; }
.stage-tile p { margin: 0; padding: 4px 6px 6px; font-size: 12px; line-height: 1.35;
  color: var(--well-ink); max-width: none; }
.stage-hue, .stage-where { color: var(--well-ink-dim); }
.stage-mark { color: #f0c36b; }
"""
