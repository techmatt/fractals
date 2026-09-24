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
// twenty-five milliseconds to compute at a shallow cap and seconds at a million — and
// every sample of every band reads it. A band call that computed its own would compute it
// some fifty times a frame. So the orbit is computed once, in one worker, sent to the
// others once, and **held in each instance's heap across every band of that frame**:
// `band` names no orbit, it uses the one that is here.
//
// **Every request carries an `id` and every answer echoes it** *(deep_tab_activity_and_
// layout_ckpt141)*. The pool matches a reply to the request that asked for it by that id and
// by nothing else, which is what makes a reply to a cancelled request land nowhere rather
// than in whichever handler happens to be listening. Until this, a band that finished after
// a cancel was read by the next probe's handler, ignored for being the wrong kind, and its
// worker was never counted idle again: three gestures during a pass stranded the whole pool.

let wasm = null;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** The orbit this instance is holding: where it is in the heap, and how long. Freed when
 *  another arrives, because a wasm heap never gives memory back and two orbits of a deep
 *  frame are four megabytes that nothing would ever read again. */
let orbit = null;

/** The request in flight, whose `id` a progress message is sent under. */
let current = null;

/** The fewest milliseconds between two progress messages. The module calls its import far
 *  more often than that — once a cell of a probe, once every 4,096 steps of an orbit — and
 *  a message a millisecond would be the main thread's whole budget spent reading them. */
const PROGRESS_MS = 100;
let posted = 0;

/** `env.progress`, the module's one import: `done` of `total` units of the call in flight,
 *  posted at most every `PROGRESS_MS`. `perturb-wasm/src/progress.rs` says where it is
 *  called from and in what units. */
const imports = {
  env: {
    progress(done, total) {
      if (current === null) return;
      const now = performance.now();
      if (now - posted < PROGRESS_MS) return;
      posted = now;
      self.postMessage({ kind: "progress", id: current, done, total });
    },
  },
};

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

/** Bytes of header on the reference buffer, before the orbit's `f64` pairs. */
const REFERENCE_HEADER = 16;

/** Answer `message`, under its own id. */
function answer(message, reply, transfer = []) {
  self.postMessage({ kind: message.kind, id: message.id, ...reply }, transfer);
}

self.onmessage = (event) => {
  const message = event.data;

  if (message.kind === "start") {
    wasm = new WebAssembly.Instance(message.module, imports).exports;
    self.postMessage({ kind: "ready" });
    return;
  }

  current = message.id ?? null;
  posted = performance.now();
  try {
    handle(message);
  } finally {
    current = null;
  }
};

function handle(message) {
  // **The orbit, computed here** *(deep_tab_activity_and_layout_ckpt141)*. It used to be
  // computed on the page's own thread, where a cap of a million froze the page for as long
  // as it took and nothing — not a spinner, not Cancel — could run until it was done. Here
  // it reports as it goes and a cancel can end it by ending the worker. The orbit is kept
  // in this heap, where it was computed, and a copy goes back for the rest of the pool.
  if (message.kind === "reference") {
    release();
    const out = withText(message.spec, (pointer, length) => wasm.reference_orbit(pointer, length));
    if (out === 0) {
      answer(message, { orbit: null });
      return;
    }
    const count = new DataView(wasm.memory.buffer).getUint32(out, true);
    const length = REFERENCE_HEADER + 16 * count;
    orbit = { pointer: out, length };
    const copy = new Uint8Array(wasm.memory.buffer, out, length).slice().buffer;
    answer(message, { orbit: copy, points: count }, [copy]);
    return;
  }

  if (message.kind === "orbit") {
    release();
    const bytes = new Uint8Array(message.orbit);
    const pointer = wasm.alloc(bytes.length);
    new Uint8Array(wasm.memory.buffer, pointer, bytes.length).set(bytes);
    orbit = { pointer, length: bytes.length };
    answer(message, {});
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
    const { spec, cols, rows, rowStart, rowEnd } = message;
    if (orbit === null) {
      answer(message, { [field]: { ok: false, why: "no reference orbit" } });
      return;
    }
    const found = withText(spec, (pointer, length) =>
      take(wasm[call](pointer, length, orbit.pointer, orbit.length, cols, rows, rowStart, rowEnd)),
    );
    answer(message, { [field]: found });
    return;
  }

  // **One Newton step, and it reads no orbit at all.** A solve is the expensive half and
  // it is its own high-precision iteration from `z = 0`, so any worker can take any step
  // of any seed — which is what lets a dozen solves go over the pool at once instead of
  // down one thread. One step a call is the cancel granularity: a wasm call cannot be
  // interrupted, and a step at a period of a hundred thousand is a tenth of a second.
  if (message.kind === "newton") {
    const step = withText(message.request, (pointer, length) => take(wasm.newton_step(pointer, length)));
    answer(message, { step });
    return;
  }

  // **A copy or a bulb, in one call** *(find_minibrots_bulbs_ckpt145)*. It reads no orbit
  // either — its chain and its solves start from the nucleus — and it is one call rather
  // than one a step because the periods it solves are divisors of the one just solved, so
  // the whole reading costs about what that solve did.
  if (message.kind === "classify") {
    const reading = withText(message.request, (pointer, length) =>
      take(wasm.classify_nucleus(pointer, length)),
    );
    answer(message, { reading });
    return;
  }

  if (message.kind === "band") {
    const { spec, rowStart, rowEnd, bytes } = message;
    if (orbit === null) {
      // Never reached by the pool, which feeds a worker an orbit before it dispatches a
      // band. Said rather than trapped, because a null pointer into `compute_band` is a
      // refusal with no sentence in it.
      answer(message, { rowStart, rowEnd, refused: true });
      return;
    }
    const started = performance.now();
    // The orbit is **borrowed** here and not taken: it stays in this heap for the next
    // band of the same frame.
    const pointer = withText(spec, (specPointer, specLength) =>
      wasm.compute_band(specPointer, specLength, orbit.pointer, orbit.length, rowStart, rowEnd),
    );

    if (pointer === 0) {
      answer(message, { rowStart, rowEnd, refused: true });
      return;
    }
    // `.slice()` off the wasm heap: the view would be detached the moment the module grew
    // its memory, and the copy is what can be transferred.
    const band = new Uint8Array(wasm.memory.buffer, pointer, bytes).slice().buffer;
    wasm.dealloc(pointer, bytes);
    // What the band ran and what the interior switch spared it, in iterations: the
    // renderer sums them over the pass, and the tab reads a quarter pass's pair to choose
    // the switch for the full one (`deep.js`, `switchFor`). A module older than the pair
    // answers `null`, and the tab then leaves the switch as the kernel ships it.
    const ran = wasm.band_ran?.() ?? null;
    const saved = wasm.band_saved?.() ?? null;
    answer(
      message,
      { rowStart, rowEnd, band, elapsed: performance.now() - started, ran, saved },
      [band],
    );
    return;
  }

  if (message.kind === "drop") {
    release();
    answer(message, {});
  }
}
