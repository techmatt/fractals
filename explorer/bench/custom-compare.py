"""Hold the explorer's custom-mode pictures to the pipeline's, byte for byte.

    python explorer/bench/custom-compare.py <explorer dir> <native dir> [--png]

`<explorer dir>` holds `custom-parity.mjs`'s `<id>.rgba` and `results.jsonl` (or, with
`--png`, the explorer's own downloads, `<id>.png`); `<native dir>` holds the native
engine's `<id>.native.png` at the same size, as the sibling's `style wasm-parity` writes
them (`artifacts/style-wasm/wasm-parity/`). The tolerance is the one item 026 set: on
Windows, identical bytes; elsewhere at most 2 steps on 0.5% of pixels, which nobody has
measured. Prints one line per example and exits 1 on any that misses.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

from PIL import Image

#: Item 026's off-Windows allowance, unmeasured: a worst step and a share of pixels.
WORST_STEP = 2
SHARE = 0.005


def compare(native: bytes, rgb: bytes) -> tuple[int, int]:
    differ, worst = 0, 0
    if native != rgb:
        for i in range(0, len(native), 3):
            step = max(abs(native[i + k] - rgb[i + k]) for k in range(3))
            if step:
                differ += 1
                worst = max(worst, step)
    return differ, worst


def main(argv: list[str]) -> int:
    ours, theirs = Path(argv[0]), Path(argv[1])
    png = "--png" in argv
    if png:
        ids = sorted(path.stem for path in ours.glob("*__*.png"))
    else:
        rows = [json.loads(line) for line in (ours / "results.jsonl").read_text().splitlines()]
        # `custom-parity.mjs` appends, so a rerun into one directory repeats an id.
        ids = sorted({row["id"] for row in rows if row["ok"]})
        for row in rows:
            if not row["ok"]:
                print(f"{row['id']:<24} REFUSED {row['why']}")
    missed = 0
    for ident in ids:
        # A missing native is a miss said by name, not a traceback: an id a rerun left from an
        # older bundle, an Example no reference was drawn for, or a keep no longer offered.
        if not (theirs / f"{ident}.native.png").exists():
            print(f"{ident:<24} NO NATIVE  MISS")
            missed += 1
            continue
        with Image.open(theirs / f"{ident}.native.png") as picture:
            native = picture.convert("RGB")
            size = native.size
            native = native.tobytes()
        if png:
            with Image.open(ours / f"{ident}.png") as picture:
                rgb = picture.convert("RGB").tobytes()
        else:
            rgba = (ours / f"{ident}.rgba").read_bytes()
            rgb = bytearray(len(rgba) // 4 * 3)
            rgb[0::3], rgb[1::3], rgb[2::3] = rgba[0::4], rgba[1::4], rgba[2::4]
            rgb = bytes(rgb)
        if len(rgb) != len(native):
            print(f"{ident:<24} SIZE {len(rgb)} bytes against {size}")
            missed += 1
            continue
        differ, worst = compare(native, rgb)
        pixels = size[0] * size[1]
        verdict = "identical" if differ == 0 else f"{differ} px differ, worst {worst}"
        within = differ == 0 or (
            sys.platform != "win32" and worst <= WORST_STEP and differ <= SHARE * pixels
        )
        missed += not within
        print(f"{ident:<24} {verdict}{'' if within else '  MISS'}")
    print(f"{len(ids) - missed} of {len(ids)} within item 026's tolerance")
    return 1 if missed else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
