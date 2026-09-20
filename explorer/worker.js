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
// A worker outside the pool is asked for a **shade** instead: the screen's finished
// frame goes to one the page keeps warm, and a download's to one of its own that is
// terminated afterwards, because that frame is far too many samples to leave in any
// heap. See `ShadeWorker` and `shadeApart` in `render.js`.

let wasm = null;
const encoder = new TextEncoder();

/** What `shade_level` puts in front of the picture: two flags, padding, five `f64` of
 *  tone curve, and one of texture weight. */
const SHADE_HEADER = 56;

/** The one tone operator the module derives, by the name a permalink spells it with.
 *  Written here rather than imported so that a worker stays one file with no imports;
 *  a curve under any other name is refused by `permalink.js`'s `OPERATORS` the moment a
 *  link carrying it is opened, so a drift here cannot pass for a working link. */
const OPERATOR = "band_autolevel/v1";

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
    // The lanes are `shade_level`'s to free from here, and it frees them before it
    // allocates a byte of colour — which is what makes a wallpaper's worth of
    // samples fit in a 32-bit address space at all. With `derive` set it also
    // measures what it drew and colours again where the operator acts; either way
    // the picture comes back behind a 48-byte header that says whether a curve acted
    // and what it was.
    const pointer = wasm.shade_level(
      specPointer,
      specLength,
      lanePointer,
      lanes.length,
      message.derive ? 1 : 0,
    );
    wasm.dealloc(specPointer, specLength);
    if (pointer === 0) {
      self.postMessage({ kind: "shaded", refused: true });
      return;
    }
    const header = new DataView(wasm.memory.buffer, pointer, SHADE_HEADER);
    const level =
      header.getUint8(0) === 1
        ? {
            operator: OPERATOR,
            black_pt: header.getFloat64(8, true),
            white_pt: header.getFloat64(16, true),
            exponent: header.getFloat64(24, true),
            out_ends: [header.getFloat64(32, true), header.getFloat64(40, true)],
          }
        : null;
    const image = new Uint8Array(wasm.memory.buffer, pointer + SHADE_HEADER, message.bytes)
      .slice().buffer;
    wasm.dealloc(pointer, SHADE_HEADER + message.bytes);
    self.postMessage({ kind: "shaded", image, level }, [image]);
    return;
  }

  // The frame-wide statistics a pooled shade spends, measured once over the whole field
  // and handed to every band. The answer crosses back as the module's JSON **as text**,
  // because that is exactly what a band is handed next: parsing it here and stringifying
  // it again on the main thread would be two conversions for no reader.
  if (message.kind === "stats") {
    const [specPointer, specLength] = put(message.spec);
    const lanes = new Uint8Array(message.lanes);
    const lanePointer = wasm.alloc(lanes.length);
    new Uint8Array(wasm.memory.buffer, lanePointer, lanes.length).set(lanes);
    // `shade_stats` takes the lanes and frees them, as `shade_level` does.
    const pointer = wasm.shade_stats(specPointer, specLength, lanePointer, lanes.length);
    wasm.dealloc(specPointer, specLength);
    const size = new DataView(wasm.memory.buffer).getUint32(pointer, true);
    const answer = new TextDecoder().decode(new Uint8Array(wasm.memory.buffer, pointer + 4, size));
    wasm.dealloc(pointer, size + 4);
    self.postMessage({ kind: "stats", answer });
    return;
  }

  // The map's stops with the tone curve already spent on them — measured off a finished
  // picture, or the one the spec carries replayed. Once for the whole pass: the bands,
  // the palette strip and a download all take the stops rather than the curve.
  if (message.kind === "curve") {
    const [specPointer, specLength] = put(message.spec);
    const picture = message.image === undefined ? null : new Uint8Array(message.image);
    const picturePointer = picture === null ? 0 : wasm.alloc(picture.length);
    if (picture !== null) {
      new Uint8Array(wasm.memory.buffer, picturePointer, picture.length).set(picture);
    }
    const pointer = wasm.curve_stops(
      specPointer,
      specLength,
      picturePointer,
      picture === null ? 0 : picture.length,
    );
    wasm.dealloc(specPointer, specLength);
    if (picture !== null) wasm.dealloc(picturePointer, picture.length);
    const size = new DataView(wasm.memory.buffer).getUint32(pointer, true);
    const answer = new TextDecoder().decode(new Uint8Array(wasm.memory.buffer, pointer + 4, size));
    wasm.dealloc(pointer, size + 4);
    self.postMessage({ kind: "curve", answer });
    return;
  }

  // The Walk tab's screen: the engine's own gate battery over one frame, which iterates
  // two fields and colours one on this thread. Its answer is the module's JSON as it came.
  if (message.kind === "screen") {
    const [specPointer, specLength] = put(message.spec);
    const pointer = wasm.screen(specPointer, specLength, message.occupancy ? 1 : 0);
    wasm.dealloc(specPointer, specLength);
    const size = new DataView(wasm.memory.buffer).getUint32(pointer, true);
    const text = new TextDecoder().decode(new Uint8Array(wasm.memory.buffer, pointer + 4, size));
    wasm.dealloc(pointer, size + 4);
    self.postMessage({ kind: "screened", id: message.id, report: JSON.parse(text) });
    return;
  }

  const { job, spec, rowStart, rowEnd, bytes } = message;
  const started = performance.now();

  // One band of the *colour*, through statistics the whole field was measured for. It
  // answers as a field band does — `kind: "band"`, its own rows, transferred — because
  // the pool assembles it the same way a painted band is assembled, and a second reply
  // shape would be a second path through `#collect` for no difference.
  if (message.kind === "shade_band") {
    const [statsPointer, statsLength] = put(message.stats);
    const lanes = new Uint8Array(message.lanes);
    const lanePointer = wasm.alloc(lanes.length);
    new Uint8Array(wasm.memory.buffer, lanePointer, lanes.length).set(lanes);
    const [specAt, specLen] = put(spec);
    // `shade_band` takes the lanes and frees them before it allocates a byte of colour.
    const pointer = wasm.shade_band(
      specAt,
      specLen,
      statsPointer,
      statsLength,
      lanePointer,
      lanes.length,
      rowStart,
      rowEnd,
    );
    wasm.dealloc(specAt, specLen);
    wasm.dealloc(statsPointer, statsLength);
    if (pointer === 0) {
      self.postMessage({ kind: "band", job, rowStart, rowEnd, refused: true });
      return;
    }
    const band = new Uint8Array(wasm.memory.buffer, pointer, bytes).slice().buffer;
    wasm.dealloc(pointer, bytes);
    self.postMessage(
      { kind: "band", job, rowStart, rowEnd, band, elapsed: performance.now() - started },
      [band],
    );
    return;
  }

  const [specPointer, specLength] = put(spec);
  // A probe is the same row range over the same orbits, counted rather than drawn: what a
  // direct trap's opacity is derived from. See `probe` in `render.js`.
  const pointer = message.probe
    ? wasm.probe_band(specPointer, specLength, rowStart, rowEnd)
    : wasm.compute_band(specPointer, specLength, rowStart, rowEnd);
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
