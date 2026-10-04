"""The location judge over neutral pictures, as judge_deep_ckpt156 read it.

    <wallpapers>/.venv/Scripts/python.exe builder/julia_dives_score.py jobs.json out.jsonl

`julia_dives.py`'s `judge` runs it under the wallpaper project's interpreter.

jobs.json: [{"id": ..., "jpg": ...}]. Appends {"id", "location"} lines, where `location` is the
shipped location head's P(>=3) (column 1), loaded and read exactly as score.py of the study did.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path


def main() -> None:
    from fractal_wallpapers.models import scoring, ship, train

    jobs = json.loads(Path(sys.argv[1]).read_text("utf-8"))
    out = Path(sys.argv[2])
    if not jobs:
        return
    model, config, where = scoring.load(ship.shipped_path("location"), "auto")
    p = train.score(
        model,
        [Path(j["jpg"]) for j in jobs],
        scoring.transform_of(config),
        where,
        int(config["classes"]),
        {"batch_size": 64},
    )
    with out.open("a", encoding="utf-8", newline="\n") as f:
        for i, job in enumerate(jobs):
            f.write(json.dumps({"id": job["id"], "location": float(p[i][1])}) + "\n")
    print(json.dumps({"scored": len(jobs), "device": str(where)}))


if __name__ == "__main__":
    main()
