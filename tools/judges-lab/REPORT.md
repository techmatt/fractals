# onnx_judges_lab_ckpt131: can the two shipped judges run in the browser?

**Yes. They run at full fidelity and at a cost worth paying.** Both judges export to ONNX
with nothing but basic ops. Store the weights as fp16 and compute in fp32 (`fp16w`): that
halves the download and reproduces PyTorch to 3.6e-6, with **zero bar crossings on every
backend**. On WebGPU, the gate costs **~2 ms/image** warm and the three-seed fine head **~3.5 ms**.
The browser's own JPEG decode plus a JS port of PIL's resize is **byte-identical** to the
Python preprocessing on all 120 pictures.

⚠ **Every timing here was taken beside a running leg**: `curate depth run --name d6s_deep2`,
three workers, held the CPU for the whole session. Treat the numbers as pessimistic, the
CPU/WASM ones most of all. `.venv\Scripts\python.exe lab\retime.py` re-takes all of them.
It refuses to run while any wallpapers process is up, and tags its results `idle`.

## Inputs
- Weights: tag `weights-2026-09-14`. `render.fp16.pt` (sha 481fe058…) and
  `gallery_grade.fp16.pt` (db682d25…, three members, seeds 0/1/2) were copied from the checkout
  after their sha256 matched `models/weights.json`. Nothing needed fetching.
- Samples: 120 real ledger candidates (640×360 JPEG). There are 40 per stratum: recorded
  `p_ge4` in [0.30, 0.70], recorded pool `p_fine` in [0.012, 0.075], and uniform random.
  Relative to PyTorch, 64 of the 120 sit above the Q4 bar and 24 above the fine bar. 2 rows
  are within 0.003 of the Q4 bar, and 8 are within 0.003 of the fine bar.
- PyTorch reference: the lab rebuilds both judges from the artifacts (CPU, torch 2.14, timm
  1.0.28). It reproduces the ledger's recorded `p_ge4` to a **max of 3.4e-6**, so the rebuild
  holds. Against the pool's recorded `p_fine` the gap is **1.1e-3** (n=63). That gap belongs to
  production, not to the lab: `score_pool`/`score_fine` read the fp32 run checkpoints, and the
  release artifact is fp16. Any browser port of the fine head inherits that 1e-3 offset
  against the pool's column, whatever runtime it uses.

## Preprocessing spec (what JS must do)
1. Decode the JPEG to 8-bit RGB. PIL uses `.convert("RGB")`. In the browser that is
   `createImageBitmap(blob, {colorSpaceConversion:"none"})`, then a 2D canvas, then `getImageData`.
2. Resize to **384×224** as a stretch (no crop or pad), using **PIL `Image.BICUBIC`**: a=-0.5,
   with antialiasing (support 2×scale), horizontal pass first, then vertical. Each pass
   rounds to uint8 in 22-bit fixed point. `web/resize.mjs` is a line-for-line port of Pillow's
   `Resample.c`, and it matches PIL on **0 differing bytes out of 31M** (in Node from PIL's
   decode, and in Chrome from Chrome's own decode). It costs ~11 ms/image in JS, and decode ~4.5 ms.
3. Convert uint8 to float with /255, into NCHW. **Normalization happens inside the graph**
   (ImageNet mean/std), as does the CORN read (sigmoid, then running product), so the page
   feeds pixels in [0,1] and reads `probs = [P≥2, P≥3, P≥4]`. There is no levelling step: both
   judges read the finished picture exactly as stored.
4. Gate: `p_ge3 = probs[1]`, `p_ge4 = probs[2]`. Fine head: the mean of the three members'
   `probs[2]` on the probability scale. The fused graph does that mean internally.

## Export
- TorchScript exporter, **opset 17**. Ops: Conv, Gemm, Relu, Add, Mul, Sub, Div,
  GlobalAveragePool, Flatten, Slice, Concat, Sigmoid. There were **no unsupported ops and no
  workarounds**. The dynamo exporter (opset 18) also works: 98 nodes, max diff 5e-8.
- Variants: `fp32`; `fp16` (onnxconverter-common, fp16 compute with fp32 I/O); `fp16w` (fp16
  weight storage with a Cast to fp32 at load, fp32 compute).
- **One obstacle, found and fixed.** The exporter folds BatchNorm into the conv weights. Rounding
  those *folded* weights back to fp16 costs up to 7e-3 on `p_ge4`, because it is a new rounding
  and not the shipped one. `export.py` therefore swaps each BN for an explicit fp32 per-channel
  affine before the fp16w export, so the conv weights stored are the shipped fp16 values
  bit for bit. The per-channel vectors stay fp32, costing about +100 KB per model.
- Sizes (bytes). Gzip barely helps (fp16w render 4.6 MB gz):

| model | fp32 | fp16 | fp16w |
|---|---|---|---|
| render (gate) | 9,963,870 | 5,003,782 | 5,101,279 |
| fine, one seed ×3 | 3 × 9,963,870 | 3 × 5,003,782 | 3 × 5,101,279 |
| fine, fused graph | 29,895,453 | 15,015,829 | 15,314,886 |

## Tradeoff table (the configurations that matter; the full 56-row table is in `measured/table.md`)
Load time = session create + first inference, served from localhost, so there is no network
time. Every run used a fresh Chrome profile. Warm time is the median. Crossings count rows
that land on the other side of the acting bar (0.50 on `p_ge4`, 0.030242 on `p_fine`).

| judge · variant · backend | bytes | create + 1st run ms | warm b1 ms | warm b8 ms/img | max abs Δ | crossings |
|---|---|---|---|---|---|---|
| gate fp32 · WebGPU | 9.96 M | 620 + 626 | 7.8 | 2.2 | 3.3e-6 | 0/120 |
| **gate fp16w · WebGPU** | 5.10 M | 834 + 644 | 7.6 | 2.2 | 3.3e-6 | **0** |
| gate fp16 · WebGPU (shader-f16) | 5.00 M | 671 + 654 | 7.6 | 2.2 | **2.6e-2** | **2** |
| gate fp16w · WASM 1 thread (Pages) | 5.10 M | 719 + 98 | 39.8 | 35.5 | 3.1e-6 | 0 |
| gate fp16w · WASM 4 threads (COOP/COEP) | 5.10 M | 757 + 62 | 19.8 | 20.7 | 3.1e-6 | 0 |
| fine fused fp32 · WebGPU | 29.9 M | 1031 + 892 | 13.4 | 3.3 | 9.9e-7 | 0 |
| **fine fused fp16w · WebGPU** | 15.3 M | 1548 + 913 | 15.7 | 3.5 | 9.9e-7 | **0** |
| fine 3 graphs fp16w · WebGPU | 15.3 M | 1321 + 974 | 23.5 | 6.0 | 9.8e-7 | 0 |
| fine fused fp16 · WebGPU | 15.0 M | 1163 + 873 | 14.3 | 3.4 | 3.9e-3 | **2** |
| fine fused fp16w · WASM 1 thread | 15.3 M | 1072 + 204 | 147.9 | 131.7 | 8.8e-7 | 0 |
| fine fused fp16w · WASM 4 threads | 15.3 M | 1183 + 107 | 56.6 | 48.5 | 8.8e-7 | 0 |
| gate fp16w · Node CPU | 5.10 M | 66 + 4 | 3.4 | 3.2 | 3.6e-6 | 0 |
| gate fp16w · Node DirectML | 5.10 M | 280 + 172 | 3.1 | 3.9 | 3.5e-6 | 0 |
| fine fused fp16w · Node CPU | 15.3 M | 183 + 12 | 9.0 | 7.7 | 9.3e-7 | 0 |
| fine fused fp16w · Node DirectML | 15.3 M | 406 + 211 | 6.9 | 10.1 | 5.5e-7 | 0 |

Findings behind the table:
- **Real fp16 compute is the only thing that moves decisions.** On WebGPU it shifts `p_ge4` by
  up to 0.026 and `p_ge3` by 0.007. It flipped 0.4984→0.5059 and 0.5020→0.4980 across the
  gate, and 0.02924→0.03047 and 0.02998→0.03052 across the fine bar. fp16 on CPU/WASM does
  better (max 7.9e-3, 0 crossings), but it is still ~2000× worse than fp16w for no size saving.
  **Ship fp16w.**
- **fp16w costs no speed anywhere.** On WebGPU it matched fp16's speed: the GPU (RTX 2060 SUPER,
  shader-f16 available) is not compute-bound on this model at this size.
- **Fused beats three graphs** on WebGPU (13–16 vs 19–24 ms at b1) for the same bytes. There is
  one session and one upload of the input. It was a cheap export: 330 nodes, one file.
- **The WebGPU first run is ~0.65–0.9 s**, which is shader compilation and paid once per page
  load. Session create is 0.6–1.5 s. So cold is ~1.3 s for the gate and ~2.4 s for the fine
  head, plus the download.
- End to end in Chrome (Chrome decode, JS resize, WebGPU, fp32) the outputs are identical to
  PIL-prepared input (Δ 3.3e-6, 0 crossings). JS preprocessing (~16 ms/image) **costs more than
  the gate's forward pass**. It is the next thing to move, into a worker or into WebGPU.
- The first pass also ran each variant once with the pre-fix fp16w. The numbers above are the
  re-run after the fix. Every timing in both passes was taken beside the leg. Cold creates
  ranged up to 6.7 s once (gate fp32 WebGPU, first pass): treat single cold readings as noisy.

## Shipping this on a static site
**Download budget.** The ORT WebGPU/JSEP runtime is `ort-wasm-simd-threaded.jsep.wasm` at
28.3 MB (6.6 MB gzipped) plus 0.8 MB of JS. The gate adds 5.1 MB and the fine head 15.3 MB,
and neither compresses. So a walk tab that uses only the gate is ~12 MB over the wire on
first visit, and one that uses both is ~27 MB. The browser caches it after that. The
explorer's existing wasm is the scale to compare against, and the fine head is the part
worth deferring: load it only when a walk first clears the gate. **GPU availability.**
WebGPU works in headless Chrome here with no flags beyond the defaults this machine
already allows. In the wild it covers current Chrome/Edge on Windows/macOS/ChromeOS and
recent Safari, but Firefox is only partial and older Linux/Android devices are patchy. So it
has to be detected (`navigator.gpu?.requestAdapter()`), never assumed. **Fallback.** Pages
cannot send COOP/COEP, so WASM runs single-threaded there: ~36 ms/image for the gate and
~130 ms for the fine head. That is fine for scoring a handful of walk steps and too slow for
a sweep. The `coi-serviceworker` trick would buy ~2× (the 4-thread row), at the cost of a
reload on first visit. A page with neither WebGPU nor a fast CPU should fall back to the proxy
statistics it would have used anyway. Fidelity is not a reason to fall back: every
fp32-compute path agrees with PyTorch to ≤3.6e-6.

## Files
`lab/` (Python: sample, judges, reference, export, fidelity, retime, serve); `web/`
(`resize.mjs` PIL port, `core.mjs` bench, `node-run.mjs`, `bench.html`, `browser-run.mjs`
over CDP via puppeteer-core); `results/*.json` holds the raw readings;
`measured/table.md`/`fidelity.json` hold the full table. Models and weights are not tracked
(they are rebuilt by `lab/export.py`). Runtimes: onnxruntime-web / -node / python 1.30.0,
Chrome 153.
