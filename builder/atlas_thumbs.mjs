// The atlas's pre-rendered thumbnails, drawn through the link that opens them.
//
// A dot on the atlas page carries a permalink into the explorer, and a judged dot also
// carries a picture. Those two have to be the same view or the page is lying: a reader
// who clicks the picture must land on the picture. So this does not build a render spec
// out of the record's fields — it builds the **permalink** out of them, parses it back
// through `explorer/permalink.js`, and renders what the parsed view says. The picture is
// then the link's own picture by construction rather than by agreement, and the one way
// they could drift is a way the contract itself would have to move.
//
// Everything here is the explorer's: `permalink.js` decides what the link means,
// `render.js` turns a view into the engine's spec, and the committed wasm module draws
// it. No new export, no second spelling of the recipe.
//
//   node builder/atlas_thumbs.mjs <out-dir> < jobs.json
//
// `jobs.json` is `{ id: { family, mode, palette, viewport } }`, where `viewport` is the
// record's own keys. Each frame lands as raw RGBA at `<out-dir>/<id>.rgba` —
// `builder/atlas.py` is what turns those into the JPEGs the page ships, because Pillow is
// where this repository writes an image. Importing this module does not run any of that:
// the main-thread half is guarded on having been invoked by name, so the test suite can
// import `TILE` without the module reaching for stdin.

import { readFileSync, writeFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import { fileURLToPath } from "node:url";
import { isMainThread, parentPort, Worker, workerData } from "node:worker_threads";

import { specOf } from "../explorer/render.js";
import { contractOf, opened } from "../atlas/links.js";

const WASM = fileURLToPath(new URL("../explorer/engine.wasm", import.meta.url));
const HERE = fileURLToPath(import.meta.url);

/** The size a fixture thumbnail is drawn at. 16:9, and the panel's own tile width. */
export const TILE = [320, 180];

const engine = new WebAssembly.Instance(new WebAssembly.Module(readFileSync(WASM)), {}).exports;

function put(text) {
  const raw = new TextEncoder().encode(text);
  const pointer = engine.alloc(raw.length);
  new Uint8Array(engine.memory.buffer, pointer, raw.length).set(raw);
  return [pointer, raw.length];
}

function plan(spec) {
  const [pointer, length] = put(JSON.stringify(spec));
  const out = engine.plan(pointer, length);
  engine.dealloc(pointer, length);
  const size = new DataView(engine.memory.buffer).getUint32(out, true);
  const body = new TextDecoder().decode(new Uint8Array(engine.memory.buffer, out + 4, size));
  engine.dealloc(out, size + 4);
  return JSON.parse(body);
}

/** The home views come out of the module, the way `emit.mjs` gets them. */
const CONTRACT = contractOf((familySpec) => {
  const answer = plan({ schema: 1, family: familySpec });
  if (!answer.ok) throw new Error(answer.why);
  return answer.home;
});

/** One frame, whole, on this thread. */
function draw(job) {
  const started = performance.now();
  const { query, view } = opened(CONTRACT, {
    family: job.family,
    viewport: job.viewport,
    palette: job.palette,
    mode: job.mode,
  });
  const [width, height] = TILE;
  const shape = plan(specOf(view, width, height, { colormap: false }));
  if (!shape.ok) return { ok: false, why: shape.why };

  // The field pass leaves the map out — only a direct trap reads the gradient while it
  // iterates — and the shade is where it is spent. Two specs, the way `render.js` has it.
  const field = JSON.stringify(specOf(view, width, height, { colormap: shape.direct }));
  const [specPointer, specLength] = put(field);
  const lanes = engine.compute_band(specPointer, specLength, 0, height);
  engine.dealloc(specPointer, specLength);
  if (lanes === 0) return { ok: false, why: "the renderer refused this spec" };

  const laneBytes = width * height * 8 * shape.lanes;
  // `shade` takes the lanes and frees them, on every path including a refusal — so the
  // spec is deallocated here and the lanes deliberately are not.
  const [shadePointer, shadeLength] = put(JSON.stringify(specOf(view, width, height)));
  const out = engine.shade(shadePointer, shadeLength, lanes, laneBytes);
  engine.dealloc(shadePointer, shadeLength);
  if (out === 0) return { ok: false, why: "the renderer refused this palette recipe" };

  const rgba = new Uint8Array(engine.memory.buffer, out, width * height * 4).slice();
  engine.dealloc(out, width * height * 4);
  return {
    ok: true,
    link: query,
    width,
    height,
    maxiter: shape.maxiter,
    ms: Math.round(performance.now() - started),
    rgba,
  };
}

const invoked = (process.argv[1] ?? "").endsWith("atlas_thumbs.mjs");

if (!isMainThread) {
  const { outDir, jobs } = workerData;
  const found = {};
  for (const [id, job] of Object.entries(jobs)) {
    try {
      const drawn = draw(job);
      if (drawn.ok) {
        writeFileSync(`${outDir}/${id}.rgba`, drawn.rgba);
        delete drawn.rgba;
      }
      found[id] = drawn;
    } catch (error) {
      found[id] = { ok: false, why: error.message };
    }
  }
  parentPort.postMessage(found);
} else if (invoked) {
  const outDir = process.argv[2];
  if (!outDir) throw new Error("usage: node builder/atlas_thumbs.mjs <out-dir> < jobs.json");
  const wanted = JSON.parse(readFileSync(0, "utf8"));
  const ids = Object.keys(wanted);
  // A frame is one wasm instance's whole job, so the pool is threads and not bands: at
  // a thumbnail's size the cut a band would buy is smaller than the instantiation.
  const pool = Math.max(1, Math.min(8, availableParallelism() - 1));
  const shares = Array.from({ length: pool }, () => ({}));
  ids.forEach((id, index) => {
    shares[index % pool][id] = wanted[id];
  });

  const answers = await Promise.all(
    shares
      .filter((share) => Object.keys(share).length > 0)
      .map(
        (jobs) =>
          new Promise((resolve, reject) => {
            const worker = new Worker(HERE, { workerData: { outDir, jobs } });
            worker.on("message", resolve);
            worker.on("error", reject);
          }),
      ),
  );
  process.stdout.write(JSON.stringify(Object.assign({}, ...answers)));
}
