"""PyTorch reference readings of the samples, the production way, plus the fed inputs.

Writes:
  artifacts/inputs.u8     N x 224 x 384 x 3 uint8, PIL bicubic — what every ONNX runner is fed
  measured/reference.json   per sample: p_ge3, p_ge4 (render), p_fine (+ per member), recorded
"""

from __future__ import annotations

import json
import time

import numpy as np
import torch

from judges import LAB, MEAN, STD, load_fine, load_render, resized


def probabilities(logits: np.ndarray) -> np.ndarray:
    # head.probabilities: stable sigmoid in float64, then cumprod
    x = logits.astype(np.float64)
    return np.cumprod(1.0 / (1.0 + np.exp(-x)), axis=1)


def main() -> None:
    torch.set_num_threads(4)
    rows = [json.loads(line) for line in (LAB / "samples.jsonl").read_text().splitlines()]
    pixels = np.stack([resized(LAB / row["file"]) for row in rows])
    out = LAB / "artifacts"
    out.mkdir(exist_ok=True)
    pixels.tofile(out / "inputs.u8")

    x = torch.from_numpy(pixels).permute(0, 3, 1, 2).float() / 255.0
    x = (x - torch.tensor(MEAN).view(1, 3, 1, 1)) / torch.tensor(STD).view(1, 3, 1, 1)

    render, _ = load_render()
    members, _ = load_fine()
    began = time.time()
    with torch.no_grad():
        r = probabilities(torch.cat([render(b) for b in x.split(32)]).numpy())
        f = np.stack(
            [probabilities(torch.cat([m(b) for b in x.split(32)]).numpy()) for m in members]
        )
    print(f"reference forward: {time.time() - began:.1f}s for {len(rows)} x 4 models")
    fine = f.mean(axis=0)
    for i, row in enumerate(rows):
        row["p_ge3"] = float(r[i, 1])
        row["p_ge4"] = float(r[i, 2])
        row["p_fine"] = float(fine[i, 2])
        row["p_fine_members"] = [float(f[k, i, 2]) for k in range(len(members))]
    (LAB / "measured" / "reference.json").write_text(json.dumps(rows, indent=1), newline="\n")

    rec = np.array([row["recorded_p_ge4"] for row in rows])
    ours = np.array([row["p_ge4"] for row in rows])
    print(
        f"p_ge4 vs recorded (production fp16-artifact read): max |d| {np.abs(rec - ours).max():.2e}"
    )
    have = [(row["recorded_p_fine"], row["p_fine"]) for row in rows if row["recorded_p_fine"]]
    d = np.abs(np.array(have)[:, 0] - np.array(have)[:, 1])
    print(f"p_fine vs pool record (fp32 run checkpoints): n={len(have)} max |d| {d.max():.2e}")


if __name__ == "__main__":
    main()
