// The pipeline's two judges, in the browser: the render judge (the gate) and the fused
// three-seed fine head, as the judges lab exported them.
//
// **Loaded on the Walk tab's first Start and never before.** The runtime's wasm is 28 MB,
// the gate 5.1 MB and the fine head 15.3 MB, none of which compresses, so a reader who
// never presses Start downloads none of it. The fine head waits longer still: it is
// fetched the first time a walk clears the bar, because until then there is nothing for
// it to read.
//
// **fp16 weights, fp32 arithmetic.** The files are the lab's `fp16w` export: weights stored
// at the precision they shipped at and cast to fp32 when the session loads. Real fp16
// compute moved `p_ge4` by up to 0.026 and flipped four pictures across a bar in the lab,
// so nothing here asks for it, on WebGPU or anywhere else.
//
// **A backend is detected, never assumed.** WebGPU where `navigator.gpu` hands back an
// adapter, and the WASM backend otherwise — single-threaded, because Pages cannot send the
// headers that would let it share memory. Where the runtime cannot load at all, `load`
// throws and the walk runs on the screen gates alone.
//
// The assets are untracked and placed by `python -m builder walk`; see explorer/README.md.

import { resizeBicubic, toTensorData } from "./resize.mjs";

/** What the judges read: a stretch to this size, PIL's bicubic, no crop and no pad. */
export const JUDGE_WIDTH = 384;
export const JUDGE_HEIGHT = 224;

const BASE = new URL("./judges/", import.meta.url);
const RUNTIME = new URL("ort/ort.min.mjs", BASE);
const RUNTIME_WASM = new URL("ort/ort-wasm-simd-threaded.jsep.wasm", BASE);
const GATE = new URL("render.fp16w.onnx", BASE);
const FINE = new URL("fine.fused.fp16w.onnx", BASE);

/** Fetch a file, saying how much of it has arrived. */
async function fetchBytes(url, onProgress) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url.pathname.split("/").pop()}: ${response.status}`);
  const total = Number(response.headers.get("content-length")) || 0;
  if (!response.body || total === 0) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    onProgress?.(bytes.length, bytes.length);
    return bytes;
  }
  const reader = response.body.getReader();
  const out = new Uint8Array(total);
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    out.set(value, received);
    received += value.length;
    onProgress?.(received, total);
  }
  return received === total ? out : out.slice(0, received);
}

/** Whether this browser hands back a WebGPU adapter. */
async function webgpu() {
  try {
    return (await navigator.gpu?.requestAdapter()) != null;
  } catch {
    return false;
  }
}

/**
 * The runtime and the gate, ready to score. `onProgress(what, received, total)` is told
 * about each download as it arrives. Throws where the runtime cannot be loaded.
 */
export async function load(onProgress) {
  const ort = await import(RUNTIME.href);
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.wasmPaths = new URL("ort/", BASE).href;
  ort.env.wasm.wasmBinary = await fetchBytes(RUNTIME_WASM, (got, of) =>
    onProgress?.("runtime", got, of),
  );
  const gpu = await webgpu();
  const judges = new Judges(ort, gpu ? "webgpu" : "wasm");
  judges.gateSession = await judges.session(
    await fetchBytes(GATE, (got, of) => onProgress?.("gate", got, of)),
  );
  return judges;
}

/** The two sessions, and the pixels-to-probabilities step both of them share. */
export class Judges {
  constructor(ort, backend) {
    this.ort = ort;
    this.backend = backend;
    this.gateSession = null;
    this.fineSession = null;
    this.fineLoading = null;
  }

  /** One session on the chosen backend, falling back to WASM where WebGPU will not take it. */
  async session(bytes) {
    const options = { graphOptimizationLevel: "all" };
    if (this.backend === "webgpu") {
      try {
        return await this.ort.InferenceSession.create(bytes, {
          ...options,
          executionProviders: ["webgpu"],
        });
      } catch (error) {
        console.warn("WebGPU would not take the judge; falling back to WASM", error);
        this.backend = "wasm";
      }
    }
    return this.ort.InferenceSession.create(bytes, { ...options, executionProviders: ["wasm"] });
  }

  /** The fine head, fetched the first time it is asked for. */
  loadFine(onProgress) {
    this.fineLoading ??= fetchBytes(FINE, (got, of) => onProgress?.("fine", got, of))
      .then((bytes) => this.session(bytes))
      .then((session) => {
        this.fineSession = session;
        return session;
      });
    return this.fineLoading;
  }

  /** `[P≥2, P≥3, P≥4]` for one picture, from a session whose output is `probs`. */
  async #read(session, image) {
    const rgb = resizeBicubic(image.data, image.width, image.height, 4, JUDGE_WIDTH, JUDGE_HEIGHT);
    const data = toTensorData(rgb, 1, JUDGE_WIDTH, JUDGE_HEIGHT);
    const pixels = new this.ort.Tensor("float32", data, [1, 3, JUDGE_HEIGHT, JUDGE_WIDTH]);
    const out = await session.run({ pixels });
    const probs = [...out.probs.data];
    out.probs.dispose?.();
    pixels.dispose?.();
    return probs;
  }

  /** The render judge on one `ImageData`: `{ p2, p3, p4 }`. */
  async gate(image) {
    const [p2, p3, p4] = await this.#read(this.gateSession, image);
    return { p2, p3, p4 };
  }

  /** The fine head on one `ImageData`: the three seeds' mean `P≥4`, averaged in the graph. */
  async fine(image) {
    return (await this.#read(this.fineSession, image))[2];
  }
}
