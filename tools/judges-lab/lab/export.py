"""Export both judges to ONNX, fp32 and fp16, and record what it took.

Artifacts (models/):
  render.fp32.onnx / render.fp16.onnx
  fine.seed{0,1,2}.fp32.onnx / .fp16.onnx   the three members, one graph each
  fine.fused.fp32.onnx / fine.fused.fp16.onnx   one graph, mean of the three on the prob scale

Also <name>.fp16w.onnx: fp16 weights + Cast, fp32 compute, exported with BatchNorm unfolded
so the stored weights are the shipped artifact's own fp16 values.

Every graph: input `pixels` float32 [N, 3, 224, 384] in [0, 1] (resized, not normalized);
output `probs` float32 [N, 3] = P(>=2), P(>=3), P(>=4). fp16 graphs keep fp32 I/O.
"""

from __future__ import annotations

import json
import sys

import onnx
import torch

from judges import HEIGHT, LAB, WIDTH, graph_modules, load_fine, load_render

OPSET = int(sys.argv[1]) if len(sys.argv) > 1 else 17
OUT = LAB / "models"


def export(module, name: str) -> dict:
    OUT.mkdir(exist_ok=True)
    path = OUT / f"{name}.fp32.onnx"
    dummy = torch.rand(2, 3, HEIGHT, WIDTH)
    torch.onnx.export(
        module,
        (dummy,),
        str(path),
        input_names=["pixels"],
        output_names=["probs"],
        dynamic_axes={"pixels": {0: "n"}, "probs": {0: "n"}},
        opset_version=OPSET,
        dynamo=False,
        do_constant_folding=True,
    )
    model = onnx.load(str(path))
    onnx.checker.check_model(model)
    ops = sorted({node.op_type for node in model.graph.node})

    from onnxconverter_common import float16

    half = float16.convert_float_to_float16(model, keep_io_types=True)
    half_path = OUT / f"{name}.fp16.onnx"
    onnx.save(half, str(half_path))
    import copy

    unfolded_path = OUT / f"{name}.unfolded.fp32.onnx"
    torch.onnx.export(
        unfold_batchnorm(copy.deepcopy(module)),
        (dummy,),
        str(unfolded_path),
        input_names=["pixels"],
        output_names=["probs"],
        dynamic_axes={"pixels": {0: "n"}, "probs": {0: "n"}},
        opset_version=OPSET,
        dynamo=False,
        do_constant_folding=True,
    )
    storage_path = OUT / f"{name}.fp16w.onnx"
    onnx.save(fp16_storage(onnx.load(str(unfolded_path))), str(storage_path))
    unfolded_path.unlink()
    return {
        "name": name,
        "opset": OPSET,
        "ops": ops,
        "nodes": len(model.graph.node),
        "fp32_bytes": path.stat().st_size,
        "fp16_bytes": half_path.stat().st_size,
        "fp16w_bytes": storage_path.stat().st_size,
    }


def unfold_batchnorm(module):
    """Swap every BatchNorm2d for an explicit per-channel affine, so the exporter cannot
    fold it into the conv. The conv weights then stay the shipped fp16 values exactly, and
    the fp16 storage variant re-reads the artifact's own bytes instead of re-rounding
    folded weights. The affine vectors are computed in fp32, as the load does."""
    import torch

    class Affine(torch.nn.Module):
        def __init__(self, bn):
            super().__init__()
            scale = bn.weight / torch.sqrt(bn.running_var + bn.eps)
            self.register_buffer("scale", scale.detach().view(1, -1, 1, 1))
            self.register_buffer(
                "shift", (bn.bias - bn.running_mean * scale).detach().view(1, -1, 1, 1)
            )

        def forward(self, x):
            return x * self.scale + self.shift

    for name, child in list(module.named_children()):
        if type(child).__name__ == "BatchNormAct2d":
            # timm's BN+activation: keep its act/drop, replace only the normalization.
            affine, act, drop = Affine(child), child.act, child.drop

            class Wrapped(torch.nn.Module):
                def __init__(self, affine=affine, act=act, drop=drop):
                    super().__init__()
                    self.affine, self.act, self.drop = affine, act, drop

                def forward(self, x):
                    return self.act(self.drop(self.affine(x)))

            setattr(module, name, Wrapped())
        elif isinstance(child, torch.nn.BatchNorm2d):
            setattr(module, name, Affine(child))
        else:
            unfold_batchnorm(child)
    return module


def fp16_storage(model):
    """fp16 weights on disk, fp32 compute: every float initializer becomes fp16 + a Cast.

    Half the download, and it runs on any backend that runs fp32 — the browser pays one
    widening per weight at session create, exactly as `.float()` does at load in PyTorch.
    """
    import copy

    import numpy as np
    from onnx import TensorProto, helper, numpy_helper

    model = copy.deepcopy(model)
    graph = model.graph
    casts, keep = [], []
    for init in graph.initializer:
        array = numpy_helper.to_array(init)
        # Only weight tensors (conv, gemm): the per-channel affine vectors stay fp32.
        if init.data_type != TensorProto.FLOAT or sum(d > 1 for d in array.shape) < 2:
            keep.append(init)
            continue
        half = numpy_helper.from_array(array.astype(np.float16), init.name + "__h")
        keep.append(half)
        casts.append(helper.make_node("Cast", [half.name], [init.name], to=TensorProto.FLOAT))
    del graph.initializer[:]
    graph.initializer.extend(keep)
    nodes = casts + list(graph.node)
    del graph.node[:]
    graph.node.extend(nodes)
    onnx.checker.check_model(model)
    return model


def main() -> None:
    Single, Fused = graph_modules()
    render, _ = load_render()
    members, _ = load_fine()
    records = [export(Single(render).eval(), "render")]
    for k, member in enumerate(members):
        records.append(export(Single(member).eval(), f"fine.seed{k}"))
    records.append(export(Fused(members).eval(), "fine.fused"))
    for r in records:
        print(
            f"{r['name']:16} fp32 {r['fp32_bytes']:>10,}  fp16 {r['fp16_bytes']:>10,}  "
            f"fp16w {r['fp16w_bytes']:>10,}  "
            f"nodes {r['nodes']}  ops {' '.join(r['ops'])}"
        )
    (LAB / "measured" / "export.json").write_text(json.dumps(records, indent=1), newline="\n")


if __name__ == "__main__":
    main()
