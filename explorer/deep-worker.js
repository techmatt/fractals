// One worker, one `perturb.wasm` instance, one reference orbit, one band of rows.
//
// The shape is `worker.js`'s and the reasons are the same: the module arrives already
// compiled and structured-cloned, so a pool of any size costs one compile between them;
// nothing is shared, because GitHub Pages will not send the headers a `SharedArrayBuffer`
// needs; and a band is copied off the wasm heap and transferred once, when it is done.
//
// **What is different is the orbit, and it is the whole reason this file exists rather
// than a third branch of `worker.js`.** The perturbation kernel needs one high-precision
// reference orbit per frame — a couple of megabytes of `f64` pairs, fifteen to
// twenty-five milliseconds to compute — and every sample of every band reads it. A band
// call that computed its own would compute it some fifty times a frame. So the orbit is
// computed once on the main thread, sent here once, and **held in this instance's heap
// across every band of that frame**: `band` names no orbit, it uses the one that is here.
//
// A frame whose orbit is still good sends none, and the held one is used again. That is
// what makes a zoom into the same neighbourhood cost no orbit at all.

let wasm = null;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** The orbit this instance is holding: where it is in the heap, and how long. Freed when
 *  another arrives, because a wasm heap never gives memory back and two orbits of a deep
 *  frame are four megabytes that nothing would ever read again. */
let orbit = null;

/** Write a string into the module's heap, call an export with it, and free it.
 *
 *  Every message kind below sends a spec or a request in and takes something back,
 *  and the put / call / dealloc shape was written out four times. It is written
 *  here, so that the kinds differ by what they ask and not by how they ask it. */
function withText(text, call) {
  const raw = encoder.encode(text);
  const pointer = wasm.alloc(raw.length);
  new Uint8Array(wasm.memory.buffer, pointer, raw.length).set(raw);
  try {
    return call(pointer, raw.length);
  } finally {
    wasm.dealloc(pointer, raw.length);
  }
}

function release() {
  if (orbit !== null) wasm.dealloc(orbit.pointer, orbit.length);
  orbit = null;
}

/** Read back what a report-returning export left: four bytes of little-endian length, then
 *  the UTF-8, and the whole buffer handed back. Every export in `perturb.wasm` that answers
 *  with a sentence rather than with lanes returns this shape. */
function take(out) {
  const size = new DataView(wasm.memory.buffer).getUint32(out, true);
  const body = decoder.decode(new Uint8Array(wasm.memory.buffer, out + 4, size));
  wasm.dealloc(out, size + 4);
  return JSON.parse(body);
}

self.onmessage = (event) => {
  const message = event.data;

  if (message.kind === "start") {
    wasm = new WebAssembly.Instance(message.module, {}).exports;
    self.postMessage({ kind: "ready" });
    return;
  }

  if (message.kind === "orbit") {
    release();
    const bytes = new Uint8Array(message.orbit);
    const pointer = wasm.alloc(bytes.length);
    new Uint8Array(wasm.memory.buffer, pointer, bytes.length).set(bytes);
    orbit = { pointer, length: bytes.length };
    self.postMessage({ kind: "orbited", stamp: message.stamp });
    return;
  }

  // **The two walks of the frame's own cells, cut the way a band is.**
  //
  // A cap-policy rung is a few thousand sample cells at the cap being tried, and on the
  // frames that want four rungs the deepest is seconds; the atom-domain walk is the cheap
  // half of finding a minibrot, no interior shortcut and no high precision. Both are
  // spread over the same pool for the same reason a field is, both read the orbit already
  // here, and both answer with counts rather than lanes — nothing about either is a
  // picture. They are one branch because the only things that differ are the export and
  // the name the answer travels under.
  const WALKS = {
    probe: { call: "probe_band", field: "counts" },
    seeds: { call: "seed_band", field: "found" },
  };
  if (WALKS[message.kind] !== undefined) {
    const { call, field } = WALKS[message.kind];
    const { kind, job, spec, cols, rows, rowStart, rowEnd } = message;
    if (orbit === null) {
      self.postMessage({ kind, job, [field]: { ok: false, why: "no reference orbit" } });
      return;
    }
    const answer = withText(spec, (pointer, length) =>
      take(wasm[call](pointer, length, orbit.pointer, orbit.length, cols, rows, rowStart, rowEnd)),
    );
    self.postMessage({ kind, job, [field]: answer });
    return;
  }

  // **One Newton step, and it reads no orbit at all.** A solve is the expensive half and
  // it is its own high-precision iteration from `z = 0`, so any worker can take any step
  // of any seed — which is what lets a dozen solves go over the pool at once instead of
  // down one thread. One step a call is the cancel granularity: a wasm call cannot be
  // interrupted, and a step at a period of a hundred thousand is a tenth of a second.
  if (message.kind === "newton") {
    const { job, request } = message;
    const step = withText(request, (pointer, length) => take(wasm.newton_step(pointer, length)));
    self.postMessage({ kind: "newton", job, step });
    return;
  }

  if (message.kind === "band") {
    const { job, spec, rowStart, rowEnd, bytes } = message;
    if (orbit === null) {
      // Never reached by the pool, which sends an orbit before it dispatches a band. Said
      // rather than trapped, because a null pointer into `compute_band` is a refusal with
      // no sentence in it.
      self.postMessage({ kind: "band", job, rowStart, rowEnd, refused: true });
      return;
    }
    const started = performance.now();
    // The orbit is **borrowed** here and not taken: it stays in this heap for the next
    // band of the same frame.
    const pointer = withText(spec, (specPointer, specLength) =>
      wasm.compute_band(specPointer, specLength, orbit.pointer, orbit.length, rowStart, rowEnd),
    );

    if (pointer === 0) {
      self.postMessage({ kind: "band", job, rowStart, rowEnd, refused: true });
      return;
    }
    // `.slice()` off the wasm heap: the view would be detached the moment the module grew
    // its memory, and the copy is what can be transferred.
    const band = new Uint8Array(wasm.memory.buffer, pointer, bytes).slice().buffer;
    wasm.dealloc(pointer, bytes);
    self.postMessage(
      { kind: "band", job, rowStart, rowEnd, band, elapsed: performance.now() - started },
      [band],
    );
    return;
  }

  if (message.kind === "drop") {
    release();
  }
};
