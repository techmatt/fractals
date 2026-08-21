// One worker, one wasm instance, one band of rows at a time.
//
// The module arrives already compiled, cloned from the main thread, so eight
// workers cost one compile between them rather than eight. Nothing is shared: no
// SharedArrayBuffer, no cross-origin-isolation headers, no service worker to
// install them — which is what lets this page be a plain file on GitHub Pages.
// The field a worker computes is copied out and transferred, once, when it is
// done.

let wasm = null;

self.onmessage = (event) => {
  const message = event.data;

  if (message.kind === "start") {
    wasm = new WebAssembly.Instance(message.module, {}).exports;
    self.postMessage({ kind: "ready" });
    return;
  }

  const { job, family, mode, cx, cy, fw, width, height, rowStart, rowEnd } = message;
  const started = performance.now();
  const bytes = (rowEnd - rowStart) * width * 4;
  const pointer = wasm.compute_field(family, mode, cx, cy, fw, width, height, rowStart, rowEnd);
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
