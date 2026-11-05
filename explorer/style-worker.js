// One worker, one `style.wasm` instance, one custom-mode session at a time.
//
// The custom (experimental) render mode's half of the pool: `style.js` keeps several of
// these, each with the compiled module cloned in, and hands each the same request. A
// worker's whole job is the module's own calls (`fractal-wallpapers/engine/README.md`,
// *The style module*): open a session, measure it, draw tiles of it against that measure,
// or draw a small picture whole. Every answer names the job it belongs to, so the page
// drops what a cancelled pass finishes; a call already running cannot be interrupted, so
// a pass that must stop at once terminates the worker instead (`StylePool.cancel`).
//
// No imports: the glue is the sibling's `style-wasm.mjs`, transcribed to the few lines a
// worker needs, as `worker.js` keeps itself one file.

let wasm = null;
let session = 0;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** A `[u32 length][JSON]` answer, read and freed. */
function text(pointer) {
  pointer >>>= 0;
  const length = new DataView(wasm.memory.buffer).getUint32(pointer, true);
  const body = new Uint8Array(wasm.memory.buffer, pointer + 4, length);
  const value = JSON.parse(decoder.decode(body.slice()));
  wasm.dealloc(pointer, length + 4);
  return value;
}

/** Bare RGBA, copied out and freed; a null pointer is the module's refusal. */
function rgba(pointer, length) {
  pointer >>>= 0;
  if (pointer === 0) throw new Error(text(wasm.last_error()));
  const out = wasm.memory.buffer.slice(pointer, pointer + length);
  wasm.dealloc(pointer, length);
  return out;
}

function close() {
  if (session) wasm.close(session);
  session = 0;
}

function open(request) {
  close();
  const raw = encoder.encode(request);
  const pointer = wasm.alloc(raw.length);
  new Uint8Array(wasm.memory.buffer, pointer, raw.length).set(raw);
  const answer = text(wasm.open(pointer, raw.length));
  wasm.dealloc(pointer, raw.length);
  if (!answer.ok) throw new Error(answer.why);
  session = answer.handle;
  return answer;
}

self.onmessage = (event) => {
  const message = event.data;
  if (message.kind === "start") {
    wasm = new WebAssembly.Instance(message.module, {}).exports;
    self.postMessage({ kind: "ready" });
    return;
  }
  const { job } = message;
  const started = performance.now();
  try {
    if (message.kind === "open") {
      const summary = open(message.request);
      self.postMessage({ kind: "opened", job, summary, elapsed: performance.now() - started });
    } else if (message.kind === "measure") {
      const [width, height, supersample] = message.frame ?? [0, 0, 0];
      const report = text(wasm.measure(session, width, height, supersample));
      if (!report.ok) throw new Error(report.why);
      self.postMessage({ kind: "measured", job, report, elapsed: performance.now() - started });
    } else if (message.kind === "tile") {
      const { x, y, width, height } = message;
      const pixels = rgba(wasm.tile(session, x, y, width, height), width * height * 4);
      self.postMessage(
        { kind: "tile", job, x, y, width, height, pixels, elapsed: performance.now() - started },
        [pixels],
      );
    } else if (message.kind === "frame") {
      // A small picture whole, in a session of its own that is closed after: the
      // preview, which must not disturb the session the tiles are drawn in.
      const kept = session;
      session = 0;
      let summary;
      let pixels;
      try {
        summary = open(message.request);
        pixels = rgba(wasm.frame(session), summary.resolution[0] * summary.resolution[1] * 4);
      } finally {
        close();
        session = kept;
      }
      const [width, height] = summary.resolution;
      self.postMessage(
        { kind: "frame", job, width, height, pixels, elapsed: performance.now() - started },
        [pixels],
      );
    } else if (message.kind === "close") {
      close();
      self.postMessage({ kind: "closed", job });
    }
  } catch (error) {
    self.postMessage({ kind: "failed", job, why: String(error?.message ?? error) });
  }
};
