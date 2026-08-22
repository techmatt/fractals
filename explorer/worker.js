// One worker, one wasm instance, one band of rows at a time.
//
// The module arrives already compiled, cloned from the main thread, so eight
// workers cost one compile between them rather than eight. Nothing is shared: no
// SharedArrayBuffer, no cross-origin-isolation headers, no service worker to
// install them — which is what lets this page be a plain file on GitHub Pages.
// The band a worker computes is copied out and transferred, once, when it is done.
//
// A worker knows nothing about families, modes or colorings. It is handed the spec
// as text and the number of bytes its answer will be — both worked out on the main
// thread from the module's own plan — and its whole job is a row range.

let wasm = null;
const encoder = new TextEncoder();

self.onmessage = (event) => {
  const message = event.data;

  if (message.kind === "start") {
    wasm = new WebAssembly.Instance(message.module, {}).exports;
    self.postMessage({ kind: "ready" });
    return;
  }

  const { job, spec, rowStart, rowEnd, bytes } = message;
  const started = performance.now();

  const raw = encoder.encode(spec);
  const specPointer = wasm.alloc(raw.length);
  new Uint8Array(wasm.memory.buffer, specPointer, raw.length).set(raw);
  const pointer = wasm.compute_band(specPointer, raw.length, rowStart, rowEnd);
  wasm.dealloc(specPointer, raw.length);

  if (pointer === 0) {
    self.postMessage({ kind: "band", job, rowStart, rowEnd, refused: true });
    return;
  }
  // `.slice()` off the wasm heap: the view would be detached the moment the
  // module grew its memory, and the copy is what can be transferred.
  const band = new Uint8Array(wasm.memory.buffer, pointer, bytes).slice().buffer;
  wasm.dealloc(pointer, bytes);
  self.postMessage(
    { kind: "band", job, rowStart, rowEnd, band, elapsed: performance.now() - started },
    [band],
  );
};
