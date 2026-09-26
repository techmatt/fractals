"""The one measurement Full pipeline's figures are read from, taken over the pool next door.

**Run with the wallpaper project's interpreter, never imported by the builder.** Every
other module here reads that project's records as files; this one has to ask its solve a
question, so it imports `fractal_wallpapers` and is run as a script by the Python that
package is installed into:

    <wallpapers>/.venv/Scripts/python.exe builder/pool_study.py [--smoke]

It holds the pool, so it is one pool-holding process and never runs beside a wallpapers
merge, another solve or the slow lane. It writes nothing next door: the solve is the
in-memory door (`solve.solve(candidates=…)`, whose record is its return value), and every
byte lands under this repository's ignored `artifacts/pool-study/<stamp>/`.

## What it measures, in one pool load

- `counts.json`: the pipeline's coarse counts for `pipeline-overview`. Frames the walks
  evaluated and the locations they admitted, off every walk ledger; candidates mined, off
  the candidate ledger; the pool the solve offers and how much of it clears the gallery
  judge's bar; and the seats of the kept records.
- `hues.json`: for `pipeline-hue-shares` and `pipeline-hue-extremes`. Every pool candidate
  tallied under its main hue (`families[0]`) and its dominant shade (`cells[0]`), the way
  curation reads them, with how many clear `solve.DEFAULT_FINE_BAR`, and each shade's best
  candidates by `p_fine`.
- `growth.jsonl`: for `pipeline-growth`. The general gallery at n = 1000, re-solved over
  random fractions of the pool's visits at every doubling, three draws a rung below the
  whole pool. The draw is next door's own (`curation.growth.visits`, `draw`, `restrict`),
  so a rung here is a rung there; what differs is only what is kept per seat, which is
  `p_fine`, the column the cascade seats by.

Next door's `curate growth` is not used, for two reasons that are both findings: it writes
into that project's artifacts tree, and its per-cell check counts the eligible pool before
the fine bar narrows it inside `solve.solve`, so it refuses at any size the bar bites on.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
from datetime import UTC, datetime
from pathlib import Path

from fractal_wallpapers.curation import candidate_ledger, growth, solve, tentative
from fractal_wallpapers.supply import ledgers

SITE_ROOT = Path(__file__).resolve().parent.parent
OUT_ROOT = SITE_ROOT / "artifacts" / "pool-study"

SCHEMA = 1
GENERAL_SEATS = 1000
#: How many of each shade's best candidates are kept, so a figure that finds its first
#: choice at a location another figure already uses has somewhere to go.
BEST_PER_CELL = 40


def _commit(root: Path) -> str | None:
    try:
        return subprocess.run(
            ["git", "-C", str(root), "rev-parse", "HEAD"],
            capture_output=True,
            text=True,
            check=True,
        ).stdout.strip()
    except (OSError, subprocess.CalledProcessError):
        return None


def _write(path: Path, value) -> None:
    path.write_text(json.dumps(value, indent=1) + "\n", encoding="utf-8", newline="\n")


def walk_counts() -> dict:
    """Frames evaluated and locations admitted, over every walk ledger on both tiers."""
    paths = ledgers.ledger_paths()
    frames = 0
    for path in paths:
        with path.open(encoding="utf-8") as handle:
            frames += sum(1 for line in handle if line.strip())
    _rows, diagnostics = ledgers.admitted_union(paths)
    return {"ledgers": len(paths), "frames": frames, "admitted": int(diagnostics["size"])}


def kept_seats() -> dict:
    """The general record's seats and the kept collections' total, off their own files.

    A collection is a kept record whose solve is `final139_<collection>`; the general
    record and the n=2000 pass are kept too and are not collections.
    """
    total = 0
    distinct: set[str] = set()
    records = []
    general = None
    for stamp in tentative.KEPT_UNPUBLISHED:
        directory = tentative.gallery_dir(stamp)
        name = json.loads((directory / "manifest.json").read_text(encoding="utf-8"))["solve"][
            "name"
        ]
        with (directory / "gallery.jsonl").open(encoding="utf-8") as handle:
            rows = [json.loads(line) for line in handle if line.strip()]
        if name == "final139_general":
            general = {"stamp": stamp, "seats": len(rows)}
            continue
        if not name.startswith("final139_"):
            continue
        total += len(rows)
        distinct.update(row["key"] for row in rows)
        records.append({"stamp": stamp, "name": name, "seats": len(rows)})
    return {
        "general": general,
        "collections": len(records),
        "collection_seats": total,
        "collection_distinct": len(distinct),
        "records": records,
    }


def hue_tallies(candidates, fine: dict, bar: float) -> dict:
    families: dict[str, dict] = {}
    cells: dict[str, dict] = {}
    unplaced = {"no_family": 0, "no_cell": 0}
    for held in candidates:
        p = fine.get(held.key)
        clears = p is not None and p >= bar
        if held.families:
            tally = families.setdefault(held.families[0], {"candidates": 0, "cleared": 0})
            tally["candidates"] += 1
            tally["cleared"] += clears
        else:
            unplaced["no_family"] += 1
        if held.cells:
            tally = cells.setdefault(held.cells[0], {"candidates": 0, "cleared": 0, "best": []})
            tally["candidates"] += 1
            tally["cleared"] += clears
            if p is not None:
                tally["best"].append((p, held.key, held.location))
        else:
            unplaced["no_cell"] += 1
    for tally in cells.values():
        tally["best"] = [
            {"key": key, "location": location, "p_fine": round(p, 6)}
            for p, key, location in sorted(tally["best"], key=lambda t: (-t[0], t[1]))[
                :BEST_PER_CELL
            ]
        ]
    return {"families": families, "cells": cells, "unplaced": unplaced}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--smoke", action="store_true", help="the 1/64 rung, one seed")
    parser.add_argument("--stamp")
    args = parser.parse_args()

    stamp = args.stamp or datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
    out = OUT_ROOT / stamp
    out.mkdir(parents=True, exist_ok=False)
    started = time.monotonic()

    def quiet(message: str) -> None:
        if message.startswith(("[growth]", "[study]")):
            print(message, flush=True)

    candidates, refused = solve.pool(log=quiet)
    column = solve.fine_column(log=quiet)
    fine = column.read
    bar = float(solve.DEFAULT_FINE_BAR)
    cleared = sum(1 for held in candidates if (fine.get(held.key) or -1.0) >= bar)
    print(f"[study] pool {len(candidates):,}, {cleared:,} clear {bar}", flush=True)

    manifest = {
        "schema": SCHEMA,
        "stamp": stamp,
        "taken_at": datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "wallpapers_commit": _commit(Path(solve.__file__).resolve().parents[3]),
        "fine_bar": bar,
        "pool": {
            "stamp": growth.pool_stamp(candidates),
            "candidates": len(candidates),
            "locations": len({held.location for held in candidates}),
            "cleared": cleared,
            "scored": len(fine),
        },
        "smoke": bool(args.smoke),
    }

    if not args.smoke:
        wallpapers = Path(solve.__file__).resolve().parents[3]
        ledger_manifest = (
            wallpapers / "data" / "curation" / "candidate_ledger" / "rows.manifest.json"
        )
        manifest_rows = json.loads(ledger_manifest.read_text(encoding="utf-8"))
        manifest_rows = {k: manifest_rows[k] for k in ("rows", "locations") if k in manifest_rows}
        counts = {
            "walks": walk_counts(),
            "ledger_rows_manifest": manifest_rows,
            "pool": manifest["pool"],
            "seats": kept_seats(),
        }
        _write(out / "counts.json", counts)
        _write(out / "hues.json", hue_tallies(candidates, fine, bar))
        print("[study] counts and hues written", flush=True)

    visit_of, _per_visit = growth.visits(candidate_ledger.stream())
    reachable = sorted({visit_of[held.key] for held in candidates if held.key in visit_of})
    manifest["pool"]["ledger_rows"] = len(visit_of)
    manifest["pool"]["visits_reachable"] = len(reachable)
    plan = [(64, 11)] if args.smoke else growth.plan_of(growth.DENOMINATORS, growth.SEEDS)
    with (out / "growth.jsonl").open("w", encoding="utf-8", newline="\n") as sink:
        for denominator, seed in plan:
            drawn = growth.draw(reachable, 1.0 / denominator, 0 if seed is None else seed)
            held = growth.restrict(candidates, visit_of, drawn)
            tick = time.monotonic()
            order, coverage = solve.ranking_for(held, solve.DEFAULT_KEY, fine=column, log=quiet)
            record = solve.solve(
                held,
                n=GENERAL_SEATS,
                fine=column,
                order=order,
                coverage=coverage,
                log=quiet,
            )
            seated = [
                {"key": row["key"], "p_fine": fine.get(row["key"])} for row in record["seated"]
            ]
            row = {
                "schema": SCHEMA,
                "denominator": denominator,
                "seed": seed,
                "visits": len(drawn),
                "candidates": len(held),
                "cleared": sum(1 for c in held if (fine.get(c.key) or -1.0) >= bar),
                "filled": int(record["filled"]),
                "asked": GENERAL_SEATS,
                "seconds": round(time.monotonic() - tick, 1),
                "seated": seated,
            }
            sink.write(json.dumps(row) + "\n")
            sink.flush()
            print(
                f"[growth] 1/{denominator} seed={seed}: {len(held):,} candidates, "
                f"{row['cleared']:,} clear, {row['filled']} seated, {row['seconds']}s",
                flush=True,
            )

    manifest["refused"] = {
        str(k): len(v) if isinstance(v, list | set | dict) else v for k, v in refused.items()
    }
    manifest["plan"] = [list(each) for each in plan]
    manifest["seconds"] = round(time.monotonic() - started, 1)
    _write(out / "manifest.json", manifest)
    print(f"[study] done in {manifest['seconds']}s -> {out}", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
