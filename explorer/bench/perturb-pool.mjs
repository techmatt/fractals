// Pool throughput of the perturbation kernel: N worker threads per module, each its own
// instance and its own copy of the orbit (as the page's pool is), all drawing the same
// tile at once. Several modules are measured round-robin, best of the rounds, so drift on
// a shared machine lands on each alike.
//
//   node explorer/bench/perturb-pool.mjs <workers> <long|short> <on|off> <rounds> <a.wasm> [b.wasm ...]
//
// Prints aggregate ns per sample-iteration (wall / iterations of the whole pool). Against
// the single-thread figure this says whether two threads a core saturate it, and a long
// orbit against a short one whether memory does.

import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const T54 = {
  re: "-0.745017728290198619298779298918851031533262270733325571484375",
  im: "0.149934432756897045833502829651788491167588360989048041953125",
};
const T54_D5 = {
  re: "-0.887826199618715930869553864091772850002956453437043331796875",
  im: "0.544060594138298891586824680413895627027934585266413727421875",
};
const ANCHOR = {
  re: "-0.74501772828532335842941892835857434",
  im: "0.14993443275456819177805709088257971",
};

function specFor(kind, on) {
  if (kind === "short") {
    return {
      schema: 1, center_re: ANCHOR.re, center_im: ANCHOR.im, width: 2e-11, maxiter: 60000,
      interior: on, resolution: [24, 14], reference_re: ANCHOR.re, reference_im: ANCHOR.im,
      period: 2838,
    };
  }
  if (kind === "cusp") {
    return {
      schema: 1, center_re: "0.25000000000986960440108935861883", center_im: "0",
      width: 9.3e-17, maxiter: 2000000, interior: on, resolution: [5, 1],
    };
  }
  if (kind === "d5") {
    return {
      schema: 1, center_re: T54_D5.re, center_im: T54_D5.im, width: 1e-54, maxiter: 221162,
      interior: on, resolution: [12, 7], degree: 5,
    };
  }
  return {
    schema: 1, center_re: T54.re, center_im: T54.im, width: 1e-54, maxiter: 221162,
    interior: on, resolution: [24, 14],
  };
}

if (isMainThread) {
  const [count, kind, sw, roundsText, ...paths] = process.argv.slice(2);
  const workers = Number(count);
  const rounds = Number(roundsText);
  const spec = specFor(kind, sw === "on");
  const pools = await Promise.all(
    paths.map(async (path) => {
      const url = pathToFileURL(resolve(path)).href;
      const threads = Array.from({ length: workers }, () =>
        new Worker(new URL(import.meta.url), { workerData: { url, spec } }),
      );
      await Promise.all(threads.map((t) => new Promise((r) => t.once("message", r))));
      return threads;
    }),
  );
  const best = paths.map(() => Infinity);
  for (let k = 0; k < rounds; k++) {
    for (let j = 0; j < pools.length; j++) {
      const i = (j + k) % pools.length;
      const threads = pools[i];
      const t0 = performance.now();
      const done = threads.map((t) => new Promise((r) => t.once("message", r)));
      threads.forEach((t) => t.postMessage("go"));
      const results = await Promise.all(done);
      const wall = performance.now() - t0;
      const ran = results.reduce((s, r) => s + r.ran, 0);
      best[i] = Math.min(best[i], (wall * 1e6) / ran);
    }
  }
  const cells = best.map(
    (ns, i) => `${ns.toFixed(3)}${i > 0 ? ` (${(best[0] / ns).toFixed(3)}x)` : ""}`,
  );
  console.log(`${kind} ${sw} x${workers}: aggregate ns/it ${cells.join("  ")}`);
  pools.flat().forEach((t) => t.terminate());
} else {
  const { load } = await import("./perturb.mjs");
  const module = await load(new URL(workerData.url));
  const { wasm } = module;
  const spec = workerData.spec;
  const orbit = module.reference(spec);
  const text = new TextEncoder().encode(JSON.stringify(spec));
  const s = wasm.alloc(text.length);
  new Uint8Array(wasm.memory.buffer, s, text.length).set(text);
  const o = wasm.alloc(orbit.length);
  new Uint8Array(wasm.memory.buffer, o, orbit.length).set(orbit);
  const rows = spec.resolution[1];
  const bytes = rows * spec.resolution[0] * 8;
  const once = () => {
    const out = wasm.compute_band(s, text.length, o, orbit.length, 0, rows);
    wasm.dealloc(out, bytes);
    return wasm.band_ran();
  };
  // Warm, and let V8's background tier-up land (wasm has no on-stack replacement).
  once();
  once();
  await new Promise((done) => setTimeout(done, 500));
  once();
  parentPort.postMessage("ready");
  parentPort.on("message", () => {
    parentPort.postMessage({ ran: once() });
  });
}
