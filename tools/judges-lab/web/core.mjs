// One configuration (judge set x variant x backend) timed and read, the same code in
// Node and in the browser. `ort` is whichever onnxruntime the host loaded.

import { toTensorData } from "./resize.mjs";

export const WIDTH = 384;
export const HEIGHT = 224;

// render: the gate, one graph. fine3: three member graphs, averaged on the probability
// scale here. fused: the three members in one graph, averaged inside it.
export const SETS = {
  render: (v) => [`render.${v}.onnx`],
  fine3: (v) => [0, 1, 2].map((k) => `fine.seed${k}.${v}.onnx`),
  fused: (v) => [`fine.fused.${v}.onnx`],
};

const now = () => performance.now();

function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

async function forward(ort, sessions, pixels, offset, n) {
  const data = toTensorData(pixels, n, WIDTH, HEIGHT, offset);
  const x = new ort.Tensor("float32", data, [n, 3, HEIGHT, WIDTH]);
  const sum = new Float64Array(n * 3);
  for (const s of sessions) {
    const out = await s.run({ pixels: x });
    const p = out.probs.data;
    for (let i = 0; i < n * 3; i++) sum[i] += p[i];
    out.probs.dispose?.();
  }
  for (let i = 0; i < n * 3; i++) sum[i] /= sessions.length;
  return sum;
}

// Timed forward only (tensor build included — it is part of what a page pays per image).
async function timed(ort, sessions, pixels, n, reps, warm) {
  for (let i = 0; i < warm; i++) await forward(ort, sessions, pixels, 0, n);
  const times = [];
  for (let i = 0; i < reps; i++) {
    const t = now();
    await forward(ort, sessions, pixels, (i * n) % (120 - n), n);
    times.push(now() - t);
  }
  return { median_ms: median(times), min_ms: Math.min(...times), reps };
}

export async function runConfig(ort, opts) {
  const { set, variant, ep, loadBytes, pixels, count, batch = 8 } = opts;
  const files = SETS[set](variant);
  const result = { set, variant, ep, files, batch };

  let t = now();
  const bytes = [];
  for (const f of files) bytes.push(await loadBytes(f));
  result.download_ms = now() - t;
  result.bytes = bytes.reduce((a, b) => a + b.byteLength, 0);

  t = now();
  const sessions = [];
  for (const b of bytes) {
    sessions.push(
      await ort.InferenceSession.create(b, {
        executionProviders: [ep],
        graphOptimizationLevel: "all",
        ...(opts.sessionOptions || {}),
      }),
    );
  }
  result.create_ms = now() - t;

  t = now();
  await forward(ort, sessions, pixels, 0, 1);
  result.first_run_ms = now() - t;
  result.cold_ms = result.download_ms + result.create_ms + result.first_run_ms;

  result.warm_b1 = await timed(ort, sessions, pixels, 1, opts.reps1 ?? 20, 3);
  result.warm_bN = await timed(ort, sessions, pixels, batch, opts.repsN ?? 8, 2);
  result.warm_bN.per_image_ms = result.warm_bN.median_ms / batch;

  // Fidelity pass: every sample, in batches.
  const probs = [];
  for (let i = 0; i < count; i += batch) {
    const n = Math.min(batch, count - i);
    const p = await forward(ort, sessions, pixels, i, n);
    for (let j = 0; j < n; j++) probs.push([p[j * 3], p[j * 3 + 1], p[j * 3 + 2]]);
  }
  result.probs = probs;
  for (const s of sessions) await s.release?.();
  return result;
}
