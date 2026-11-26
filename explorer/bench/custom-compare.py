"""Hold the explorer's custom-mode pictures to the pipeline's, byte for byte.

    python explorer/bench/custom-compare.py <explorer dir> <native dir> [--png]

`<explorer dir>` holds `custom-parity.mjs`'s `<id>.rgba` and `results.jsonl` (or, with
`--png`, `custom-browser.mjs`'s downloads, `<id>.png`, and its `browser.jsonl`);
`<native dir>` holds the native engine's `<id>.native.png` at the same size, as
`custom-natives.mjs` draws them (or, against `--stack keep`, the sibling's `style
wasm-parity`, in its `artifacts/style-wasm/wasm-parity/`). The tolerance is the one item 026 set: on
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
    record = ours / ("browser.jsonl" if png else "results.jsonl")
    missed = refused = 0
    if png and not record.exists():
        ids = sorted(path.stem for path in ours.glob("*__*.png"))
    else:
        # Both benches append, so a rerun into one directory repeats an id: its last row is
        # the one that counts. A refused row is a miss, and so, with `--png`, is a download
        # that never landed; a button the page rightly does not offer is skipped.
        last = {}
        for line in record.read_text().splitlines():
            if line.strip():
                row = json.loads(line)
                last[row["id"]] = row
        ids = sorted(ident for ident, row in last.items() if row["ok"] and "skipped" not in row)
        for ident, row in sorted(last.items()):
            if not row["ok"]:
                print(f"{ident:<24} REFUSED {row.get('why', 'no download landed')}  MISS")
                refused += 1
        missed = refused
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
    total = len(ids) + refused
    print(f"{total - missed} of {total} within item 026's tolerance")
    return 1 if missed else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
