"""The two shipped judges, rebuilt here from their artifacts. Rewritten, not imported.

What the wallpapers repository does, restated in the smallest form that reproduces it
(sources: `models/head.py`, `models/train.py`, `models/render_train.py`,
`models/gallery_grade_train.py`, `curation/colorize.py`, `curation/rotation.py`):

* Both artifacts carry `config` with backbone `mobilenetv4_conv_small.e2400_r224_in1k`,
  `classes` 4, `target_dims` [384, 224], `interpolation` bicubic, ImageNet mean/std.
* The model is `timm.create_model(backbone, num_classes=3)`: three CORN logits.
* Weights are stored fp16 and widened to fp32 at load (`v.float()`).
* Preprocessing: PIL open, `.convert("RGB")`, `image.resize((384, 224), Image.BICUBIC)`
  (a stretch, not a crop or pad), uint8 -> float /255, `(x - mean) / std`, CHW.
* Probabilities: `sigmoid(logits)`, then the running product along the cutpoints:
  `P(>=2), P(>=3), P(>=4)`.
* Render judge: `p_ge3 = P[:, 1]`, `p_ge4 = P[:, 2]`.
* Fine head: three members, each to probabilities, averaged on the probability scale;
  `p_fine = mean_k P_k[:, 2]`.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np

LAB = Path(__file__).resolve().parents[1]
WEIGHTS = LAB / "weights"
MEAN = (0.485, 0.456, 0.406)
STD = (0.229, 0.224, 0.225)
WIDTH, HEIGHT = 384, 224

Q4_BAR = 0.50  # solve.Q4_BAR = floors.RELEASE_ADVISORY, on p_ge4
FINE_BAR = 0.030242  # solve.DEFAULT_FINE_BAR, on p_fine


def _build(config, state):
    import timm

    model = timm.create_model(config["backbone"], num_classes=int(config["classes"]) - 1)
    model.load_state_dict({k: v.float() for k, v in state.items()})
    return model.eval()


def load_render():
    import torch

    saved = torch.load(WEIGHTS / "render.fp16.pt", map_location="cpu", weights_only=False)
    return _build(saved["config"], saved["state_dict"]), saved["config"]


def load_fine():
    import torch

    saved = torch.load(WEIGHTS / "gallery_grade.fp16.pt", map_location="cpu", weights_only=False)
    return [_build(saved["config"], m["state_dict"]) for m in saved["members"]], saved["config"]


def resized(path) -> np.ndarray:
    """The picture as the head's input, before normalization: HxWx3 uint8, PIL bicubic."""
    from PIL import Image

    with Image.open(path) as opened:
        opened.load()
        image = opened.convert("RGB")
    return np.asarray(image.resize((WIDTH, HEIGHT), Image.BICUBIC), dtype=np.uint8)


def unit_tensor(pixels: np.ndarray) -> np.ndarray:
    """HxWx3 uint8 -> 1x3xHxW float32 in [0, 1]: what the exported graphs take."""
    return (pixels.astype(np.float32) / 255.0).transpose(2, 0, 1)[None]


def cumulative(logits):
    """CORN logits -> unconditional P(>=2..4), as the graph computes it."""
    import torch

    s = torch.sigmoid(logits)
    p2 = s[:, 0:1]
    p3 = p2 * s[:, 1:2]
    p4 = p3 * s[:, 2:3]
    return torch.cat([p2, p3, p4], dim=1)


def graph_modules():
    """The modules that get exported: input 0..1 NCHW, output probabilities [N, 3].

    Normalization and the CORN product are inside the graph so a browser feeds a
    resized picture and reads probabilities off, with no constants of its own.
    """
    import torch

    class Normalized(torch.nn.Module):
        def __init__(self):
            super().__init__()
            self.register_buffer("mean", torch.tensor(MEAN).view(1, 3, 1, 1))
            self.register_buffer("std", torch.tensor(STD).view(1, 3, 1, 1))

        def norm(self, x):
            return (x - self.mean) / self.std

    class Single(Normalized):
        def __init__(self, model):
            super().__init__()
            self.model = model

        def forward(self, x):
            return cumulative(self.model(self.norm(x)))

    class Fused(Normalized):
        def __init__(self, models):
            super().__init__()
            self.members = torch.nn.ModuleList(models)

        def forward(self, x):
            x = self.norm(x)
            total = cumulative(self.members[0](x))
            for member in self.members[1:]:
                total = total + cumulative(member(x))
            return total / len(self.members)

    return Single, Fused
