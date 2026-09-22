// The pipeline's render judge in the browser, as the judges lab exported it. It is the one
// judge the Walk tab runs, which is what the pipeline's own walk scores with.
//
// **The fine head is gone** *(pre_closeout_website_ckpt140, 2026-09-22)*. It ranked
// recipes only where a config box was ticked; the box went with the walk's frozen tuning,
// which left its download and its session reachable by nothing, so both were cut and the
// site no longer ships its weights.
//
// **Loaded on the Walk tab's first Start and never before.** The runtime's wasm is 28 MB
// raw and 6.7 MB gzipped on the wire, and the judge is 5.1 MB, which gzip barely touches
// (4.7 MB), so a reader who never presses Start downloads none of it.
//
// **A download can be stopped, and what finished is kept** *(explorer_slim_ckpt131)*.
// Every fetch here takes the walk's `AbortSignal`, so leaving the tab or pressing Pause
// mid-download cuts it off. A file that had fully arrived stays in this module, and so does
// a session that was made, so the next Start picks up where this one stopped rather than
// downloading again. A session still being made when the signal fires is released as soon
// as it exists, which is the nearest the runtime comes to cancelling one.
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

/**
 * Fetch a file, saying how much of it has arrived: `onProgress(received, total)`, where
 * `total` is `0` when the response does not say how long the file is.
 *
 * **A compressed response's length is not the file's.** Pages gzips everything but
 * images and sends the length of what it gzipped, while the body a page reads is the
 * file after the browser has unzipped it. This used to size its buffer from that header,
 * so under Pages the runtime's 28 MB arrived into a 6.7 MB buffer and the judges never
 * loaded; the walk ran on coin flips and said only that no judge could load. So chunks are
 * gathered and joined, and a length is reported only where the response is not encoded.
 */
async function fetchBytes(url, onProgress, signal) {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`${url.pathname.split("/").pop()}: ${response.status}`);
  const encoded = (response.headers.get("content-encoding") ?? "identity") !== "identity";
  const total = encoded ? 0 : Number(response.headers.get("content-length")) || 0;
  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    onProgress?.(bytes.length, bytes.length);
    return bytes;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    onProgress?.(received, total);
  }
  const out = new Uint8Array(received);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

/** What has fully arrived, kept across Starts: the runtime's bytes, the gate's bytes until
 *  its session is made, and the judges once they are. */
const held = { ort: null, runtime: null, gate: null, judges: null };

/** Whether an error is a download being stopped rather than failing. */
export function stopped(error, signal) {
  return signal?.aborted === true || error?.name === "AbortError";
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
export async function load(onProgress, signal) {
  if (held.judges !== null) return held.judges;
  if (held.ort === null) {
    const ort = await import(RUNTIME.href);
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.wasmPaths = new URL("ort/", BASE).href;
    held.ort = ort;
  }
  signal?.throwIfAborted();
  if (held.runtime === null) {
    held.runtime = await fetchBytes(
      RUNTIME_WASM,
      (got, of) => onProgress?.("runtime", got, of),
      signal,
    );
    held.ort.env.wasm.wasmBinary = held.runtime;
  }
  if (held.gate === null) {
    held.gate = await fetchBytes(GATE, (got, of) => onProgress?.("gate", got, of), signal);
  }
  const gpu = await webgpu();
  const judges = new Judges(held.ort, gpu ? "webgpu" : "wasm");
  judges.gateSession = await judges.session(held.gate, signal);
  held.gate = null;
  held.judges = judges;
  return judges;
}

/** The render judge's session, and the pixels-to-probabilities step it runs. */
export class Judges {
  constructor(ort, backend) {
    this.ort = ort;
    this.backend = backend;
    this.gateSession = null;
  }

  /**
   * One session on the chosen backend, falling back to WASM where WebGPU will not take it.
   * A session the signal was fired under while it was being made is released and not
   * returned: the runtime cannot cancel one, so this is where it stops.
   */
  async session(bytes, signal) {
    const made = await this.#create(bytes);
    if (signal?.aborted) {
      await made.release().catch(() => {});
      signal.throwIfAborted();
    }
    return made;
  }

  async #create(bytes) {
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
}
