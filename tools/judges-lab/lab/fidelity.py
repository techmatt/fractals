"""Every reading of the samples against the PyTorch reference, and the tradeoff table.

Reads measured/reference.json and results/*.json (Node and Chrome runs), adds a Python
onnxruntime CPU reading of every model as a third runtime, and writes
measured/table.md + measured/fidelity.json.

Columns per configuration: the probability column that acts (p_ge4 for the gate, p_fine
for the fine head), max / mean |d| vs PyTorch, Spearman rho, and how many rows change side
of the acting bar. The gate's p_ge3 is reported too, since it is part of its interface.
"""

from __future__ import annotations

import json
import time

import numpy as np
from scipy.stats import spearmanr

from judges import FINE_BAR, LAB, Q4_BAR

SETS = {
    "render": ["render.{v}.onnx"],
    "fine3": [f"fine.seed{k}.{{v}}.onnx" for k in range(3)],
    "fused": ["fine.fused.{v}.onnx"],
}


def python_ort() -> None:
    import onnxruntime as ort

    pixels = np.fromfile(LAB / "artifacts" / "inputs.u8", dtype=np.uint8).reshape(-1, 224, 384, 3)
    x = (pixels.astype(np.float32) / 255.0).transpose(0, 3, 1, 2)
    for s, files in SETS.items():
        for v in ("fp32", "fp16", "fp16w"):
            sessions = [
                ort.InferenceSession(
                    str(LAB / "models" / f.format(v=v)), providers=["CPUExecutionProvider"]
                )
                for f in files
            ]
            began = time.time()
            probs = np.mean(
                [
                    np.concatenate([se.run(None, {"pixels": b})[0] for b in np.array_split(x, 15)])
                    for se in sessions
                ],
                axis=0,
            )
            out = {
                "set": s,
                "variant": v,
                "ep": "cpu",
                "runtime": "onnxruntime-python",
                "probs": probs.tolist(),
                "seconds": time.time() - began,
            }
            (LAB / "results" / f"python-cpu-{s}-{v}.json").write_text(json.dumps(out))


def compare(ours: np.ndarray, ref: np.ndarray, bar: float) -> dict:
    d = np.abs(ours - ref)
    return {
        "max_abs": float(d.max()),
        "mean_abs": float(d.mean()),
        "spearman": float(spearmanr(ours, ref).statistic),
        "crossings": int(((ours >= bar) != (ref >= bar)).sum()),
        "ref_above": int((ref >= bar).sum()),
    }


def main() -> None:
    python_ort()
    ref = json.loads((LAB / "measured" / "reference.json").read_text())
    r4 = np.array([r["p_ge4"] for r in ref])
    r3 = np.array([r["p_ge3"] for r in ref])
    rf = np.array([r["p_fine"] for r in ref])
    rows = []
    for path in sorted((LAB / "results").glob("*.json")):
        res = json.loads(path.read_text())
        row = {
            "name": path.stem,
            **{k: res.get(k) for k in ("set", "variant", "ep", "mode", "tag", "error")},
        }
        if res.get("probs"):
            p = np.array(res["probs"])
            if res["set"] == "render":
                row["acting"] = compare(p[:, 2], r4, Q4_BAR)
                row["p_ge3"] = compare(p[:, 1], r3, Q4_BAR)
            else:
                row["acting"] = compare(p[:, 2], rf, FINE_BAR)
        for k in (
            "bytes",
            "download_ms",
            "create_ms",
            "first_run_ms",
            "cold_ms",
            "prep",
            "gpu",
            "threads",
        ):
            if k in res:
                row[k] = res[k]
        if "warm_b1" in res:
            row["b1_ms"] = res["warm_b1"]["median_ms"]
            row["b8_ms_per_image"] = res["warm_bN"]["per_image_ms"]
        rows.append(row)
    (LAB / "measured" / "fidelity.json").write_text(json.dumps(rows, indent=1), newline="\n")

    head = (
        "| config | bytes | create ms | 1st run ms | warm b1 ms | warm b8 ms/img | "
        "max abs d | mean abs d | Spearman | crossings |"
    )
    lines = [head, "|" + "---|" * 10]
    for row in rows:
        if row.get("error"):
            lines.append(f"| {row['name']} | FAILED: {row['error'][:80]} |||||||||")
            continue
        a = row["acting"]
        fmt = lambda k, f="{:.0f}", row=row: (  # noqa: E731
            f.format(row[k]) if row.get(k) is not None else "n/a"
        )
        lines.append(
            f"| {row['name']} | {fmt('bytes', '{:,}')} | {fmt('create_ms')} | "
            f"{fmt('first_run_ms')} | "
            f"{fmt('b1_ms', '{:.1f}')} | {fmt('b8_ms_per_image', '{:.1f}')} | {a['max_abs']:.1e} | "
            f"{a['mean_abs']:.1e} | {a['spearman']:.6f} | {a['crossings']}/{a['ref_above']} |"
        )
    (LAB / "measured" / "table.md").write_text("\n".join(lines) + "\n", newline="\n")
    print("\n".join(lines))


if __name__ == "__main__":
    main()
