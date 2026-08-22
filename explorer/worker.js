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
//
// One worker is asked for a **shade** instead, and it is a worker of its own that
// is terminated afterwards: a download's frame is far too many samples to colour
// on the main thread, and far too many to leave in a pool worker's heap. See
// `shadeApart` in `render.js`.

let wasm = null;
const encoder = new TextEncoder();

/** Write a string into the module's heap, and hand back what frees it. */
function put(text) {
  const raw = encoder.encode(text);
  const pointer = wasm.alloc(raw.length);
  new Uint8Array(wasm.memory.buffer, pointer, raw.length).set(raw);
  return [pointer, raw.length];
}

self.onmessage = (event) => {
  const message = event.data;

  if (message.kind === "start") {
    wasm = new WebAssembly.Instance(message.module, {}).exports;
    self.postMessage({ kind: "ready" });
    return;
  }

  if (message.kind === "shade") {
    const [specPointer, specLength] = put(message.spec);
    const lanes = new Uint8Array(message.lanes);
    const lanePointer = wasm.alloc(lanes.length);
    new Uint8Array(wasm.memory.buffer, lanePointer, lanes.length).set(lanes);
    // The lanes are `shade`'s to free from here, and it frees them before it
    // allocates a byte of colour — which is what makes a wallpaper's worth of
    // samples fit in a 32-bit address space at all.
    const pointer = wasm.shade(specPointer, specLength, lanePointer, lanes.length);
    wasm.dealloc(specPointer, specLength);
    if (pointer === 0) {
      self.postMessage({ kind: "shaded", refused: true });
      return;
    }
    const image = new Uint8Array(wasm.memory.buffer, pointer, message.bytes).slice().buffer;
    wasm.dealloc(pointer, message.bytes);
    self.postMessage({ kind: "shaded", image }, [image]);
    return;
  }

  const { job, spec, rowStart, rowEnd, bytes } = message;
  const started = performance.now();

  const [specPointer, specLength] = put(spec);
  const pointer = wasm.compute_band(specPointer, specLength, rowStart, rowEnd);
  wasm.dealloc(specPointer, specLength);

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
