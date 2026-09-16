"""Write `level-derive-cases.json`: the measure half of band_autolevel/v1, pinned.

Run with the wallpaper project's own interpreter, from this repository's root:

    ..\\fractal-wallpapers\\.venv\\Scripts\\python.exe explorer\\engine-wasm\\make-derive-cases.py

It imports that project read-only and writes nowhere next door. Two kinds of case:

* `curves` — backfill rows whose **stored** measured statistics go through the port's
  `derive_curve` and must come back as the **stored** curve, exactly. Chosen to cover
  every branch: a guarded black, a clamped exponent at each end, each statistic below
  and above its band, the identity, and a degenerate range where one exists.
* `stats` — a few of those rows whose base render is drawn again at its own candidate
  geometry with the operator switched off, JPEG-encoded by the engine and decoded by
  PIL, exactly as the operator reads it. The decoded pixels land in this repository's
  ignored `artifacts/level-derive/<key>.rgb`, and this script refuses a base whose
  Python `tone_stats` is not the row's stored `measured` — which is the proof that it
  is the same picture. The Rust test reads those files and skips by name without them.

The sidecar lives in the wallpaper project's ignored store, so the curve cases are
committed as numbers and the stats cases as numbers plus a path that only this machine
can fill.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
SITE = HERE.parent.parent
OUT = HERE / "level-derive-cases.json"
PIXELS = SITE / "artifacts" / "level-derive"
BAND_SHA = "49d4f43b200904c5967df788308834be163698081d85802df978554261aa63a1"
STATS_CASES = 4
CURVE_FIELDS = ("applies", "identity", "black_pt", "white_pt", "exponent", "out_ends")


def pick(rows: list[dict]) -> list[dict]:
    """One row per branch of `derive_curve` that the sidecar holds, in a stable order."""
    rows = sorted(rows, key=lambda row: row["key"])
    wanted = {
        "guarded black": lambda c: c.get("black_guarded"),
        "clamped at 2": lambda c: c.get("clamped") and c["exponent"] > 1,
        "clamped at 1/2": lambda c: c.get("clamped") and c["exponent"] < 1,
        "black above band": lambda c: (c.get("sides") or {}).get("black_pt") == 1,
        "white below band": lambda c: (c.get("sides") or {}).get("white_pt") == -1,
        "white above band": lambda c: (c.get("sides") or {}).get("white_pt") == 1,
        "mid below band": lambda c: (c.get("sides") or {}).get("mid") == -1,
        "mid above band": lambda c: (c.get("sides") or {}).get("mid") == 1,
        "identity": lambda c: c.get("applies") and c.get("identity"),
        "degenerate": lambda c: c.get("applies") is False,
        "unclamped, both ends moved": lambda c: (
            c.get("applies")
            and not c.get("identity")
            and not c.get("clamped")
            and (c.get("sides") or {}).get("black_pt") != 0
            and (c.get("sides") or {}).get("white_pt") != 0
        ),
    }
    chosen, seen = [], set()
    for why, test in wanted.items():
        for row in rows:
            curve = row["autolevel"]["curve"]
            if row["key"] not in seen and test(curve):
                chosen.append({**row, "_why": why})
                seen.add(row["key"])
                break
        else:
            print(f"no backfill row for {why}", file=sys.stderr)
    return chosen


def main() -> int:
    import numpy
    from fractal_wallpapers.coloring import autolevel
    from fractal_wallpapers.coloring import band as band_module
    from fractal_wallpapers.curation import backfill, candidate_ledger, colorize, recipes
    from PIL import Image

    rows = backfill.rows()
    for row in rows:
        if row["autolevel"]["band"]["sha256"] != BAND_SHA:
            raise SystemExit(f"{row['key']} was levelled under another band")
    chosen = pick(rows)

    curves = []
    for row in chosen:
        measured, curve = row["autolevel"]["measured"], row["autolevel"]["curve"]
        curves.append(
            {
                "key": row["key"],
                "why": row["_why"],
                "measured": {
                    name: measured[name] for name in ("black_pt", "black_pt_all", "white_pt", "mid")
                },
                "curve": {name: curve.get(name) for name in CURVE_FIELDS},
            }
        )

    # Branches no recorded row reaches, answered by the operator itself on statistics
    # written here. They are marked `synthetic` and carry no key.
    synthetic = {
        "degenerate range": {"black_pt": 0.5, "black_pt_all": 0.5, "white_pt": 0.52, "mid": 0.51},
        "midtone outside the position window": {
            "black_pt": 0.1,
            "black_pt_all": 0.1,
            "white_pt": 0.9,
            "mid": 0.1,
        },
        "guarded black high in the range": {
            "black_pt": None,
            "black_pt_all": 0.95,
            "white_pt": 1.0,
            "mid": 0.97,
        },
    }
    bands = autolevel._bands(band_module.load())
    for why, measured in synthetic.items():
        curve = autolevel.derive_curve(measured, bands)
        curves.append(
            {
                "key": None,
                "why": f"synthetic: {why}",
                "measured": measured,
                "curve": {name: curve.get(name) for name in CURVE_FIELDS},
            }
        )

    # The stats cases: the first few chosen rows whose base can still be drawn and still
    # measures as it was recorded, in the branch order above.
    stats = []
    ledger = candidate_ledger.by_key([row["key"] for row in chosen])
    band, cyclic = colorize.band(), colorize.cyclic()
    PIXELS.mkdir(parents=True, exist_ok=True)
    for row in chosen:
        if len(stats) == STATS_CASES:
            break
        held = ledger.get(row["key"])
        if held is None:
            continue
        recipe = recipes.of_record(held["recipe"])
        picture = PIXELS / f"{row['key']}.jpg"
        made, _ = colorize.render(
            {"family": recipe.family, "viewport": recipe.viewport, "maxiter": recipe.maxiter},
            recipe.mode,
            recipe.colormap,
            cyclic,
            picture,
            render_geometry=recipe.render(),
            level=False,
            band=band,
            mode_params=recipe.mode_params,
            curve=recipe.curve,
            palette=recipe.palette,
        )
        with Image.open(made) as opened:
            array = numpy.asarray(opened.convert("RGB"), dtype=numpy.uint8)
        ours = autolevel.tone_stats(array)
        stored = row["autolevel"]["measured"]
        names = ("black_pt", "black_pt_all", "white_pt", "mid")
        if any(ours[name] != stored[name] for name in names):
            print(f"{row['key']}: the base drawn now is not the one measured", file=sys.stderr)
            continue
        (PIXELS / f"{row['key']}.rgb").write_bytes(array.tobytes())
        stats.append(
            {
                "key": row["key"],
                "width": int(array.shape[1]),
                "height": int(array.shape[0]),
                "measured": {name: stored[name] for name in names},
            }
        )

    OUT.write_text(
        json.dumps(
            {
                "band_sha256": BAND_SHA,
                "source": "fractal-wallpapers artifacts/curation/autolevel_backfill.jsonl",
                "pixels": "artifacts/level-derive/<key>.rgb, written by make-derive-cases.py",
                "curves": curves,
                "stats": stats,
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
        newline="\n",
    )
    print(f"{len(curves)} curve case(s), {len(stats)} stats case(s) -> {OUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
