"""Pick ~120 real candidate pictures from the wallpapers ledger, read-only, and copy them in.

Three strata, 40 each, so the bar-crossing counts have something to cross:
  near_q4    recorded p_ge4 in [0.30, 0.70]           (the gate's bar is 0.50)
  near_fine  recorded p_fine in [0.012, 0.075]         (the fine bar is 0.030242)
  random     uniform over ledger rows with a score

The ledger is streamed once; nothing in the wallpapers checkout is written. Where
that checkout is, and which disk each part of its artifacts tree is on, is the
website builder's to say (`builder.renders.artifact`, from `local.toml`), so no
absolute path is written here.
The recorded columns are kept beside each row as a cross-check, not as the reference:
the reference is PyTorch run here (see reference.py).
"""

from __future__ import annotations

import json
import random
import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))
from builder.renders import artifact  # noqa: E402

RENDER_SHA = "481fe0582328f0de8d64d8e0ddc9a0bde1f044419e2074af6a559239b5792d46"

LAB = Path(__file__).resolve().parents[1]
OUT = LAB / "samples"
PER = 40


def resolve(picture: str) -> Path | None:
    """A recorded `artifacts/...` picture, on whichever tier holds it now."""
    path = artifact(picture)
    return path if path.is_file() else None


def main() -> None:
    rng = random.Random(20260918)
    fine = {}
    with artifact("gallery_grade_head", "pool_scores.jsonl").open(encoding="utf-8") as handle:
        for line in handle:
            row = json.loads(line)
            fine[row["key"]] = row["p_ge4"]

    scores = {}
    ledger = artifact("curation", "candidate_ledger")
    with (ledger / "scores.jsonl").open(encoding="utf-8") as handle:
        for line in handle:
            row = json.loads(line)
            if row.get("judge_artifact") == RENDER_SHA and row.get("regime") == "640x360ss2":
                scores[row["recipe_key"]] = (row["p_ge3"], row["p_ge4"])

    pools = {"near_q4": [], "near_fine": [], "random": []}
    seen = 0
    with (ledger / "rows.jsonl").open(encoding="utf-8") as handle:
        for line in handle:
            row = json.loads(line)
            key = row["key"]
            if key not in scores or not row.get("picture") or row.get("rejected"):
                continue
            seen += 1
            item = (key, row["picture"], row["recipe"].get("mode"), row["partition"])
            p4 = scores[key][1]
            if 0.30 <= p4 <= 0.70:
                pools["near_q4"].append(item)
            if key in fine and 0.012 <= fine[key] <= 0.075:
                pools["near_fine"].append(item)
            # Reservoir over everything scored.
            if len(pools["random"]) < 4000:
                pools["random"].append(item)
            elif rng.random() < 4000 / seen:
                pools["random"][rng.randrange(4000)] = item

    OUT.mkdir(parents=True, exist_ok=True)
    chosen, taken = [], set()
    for stratum, items in pools.items():
        rng.shuffle(items)
        got = 0
        for key, picture, mode, partition in items:
            if got >= PER or key in taken:
                if got >= PER:
                    break
                continue
            source = resolve(picture)
            if source is None:
                continue
            target = OUT / f"{key}.jpg"
            shutil.copyfile(source, target)
            taken.add(key)
            got += 1
            chosen.append(
                {
                    "key": key,
                    "stratum": stratum,
                    "mode": mode,
                    "partition": partition,
                    "file": f"samples/{key}.jpg",
                    "source": picture,
                    "recorded_p_ge3": scores[key][0],
                    "recorded_p_ge4": scores[key][1],
                    "recorded_p_fine": fine.get(key),
                }
            )
        print(f"{stratum}: {got} of {len(items)} eligible")
    with (LAB / "samples.jsonl").open("w", encoding="utf-8", newline="\n") as handle:
        for row in chosen:
            handle.write(json.dumps(row) + "\n")
    print(f"{len(chosen)} pictures; {seen:,} scored ledger rows seen")


if __name__ == "__main__":
    main()
