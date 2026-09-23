// The deep figures' fields: each panel's Deep-tab link read by the tab's own contract, its cap
// settled by the tab's own probe, and its field drawn by `zoom_fields.mjs`'s band renderer
// through the committed `perturb.wasm`. Colour is the next step and is not here: the field
// goes to `deep_gallery_shade.mjs`, which shades it exactly as the tab shades that link.
//
//   node builder/deep_figures.mjs jobs.json
//
// jobs.json: [{ id, link, width, height, ss, field }]. A link that names no cap (`n`) is
// settled at the job's own grid and comes back naming the settled one, so every figure's
// link opens pinned at the cap its picture was drawn at, the way a Deep gallery tile's does.
// A link that names one is drawn at it. Prints [{ id, link, maxiter, settled, seconds,
// interior }] as JSON. `builder/deep_figures.py` is the only caller.

import { readFileSync, writeFileSync } from "node:fs";
import { cpus } from "node:os";
import { PALETTES } from "../explorer/palettes.js";
import { canonicalize, emit, parse } from "../explorer/deep-link.js";
import { deepSpecOf } from "../explorer/deep-render.js";
import { load } from "../explorer/bench/perturb.mjs";
import { renderSpec, settleSpec } from "./zoom_fields.mjs";

const p = await load();

const context = {
  palettes: PALETTES,
  defaultPalette: "glowdon",
  deepHome: () => ({ x: "-0.5", y: "0", w: "3" }),
  deepCap: (width) => p.maxiter(width),
};

const jobs = JSON.parse(readFileSync(process.argv[2], "utf8"));
const threads = cpus().length;
const out = [];
for (const job of jobs) {
  const view = parse(job.link, context);
  const ss = job.ss ?? 1;
  let settled = null;
  if (view.capFrom === "width") {
    const found = settleSpec(p, deepSpecOf(view, job.width, job.height, { supersample: ss }));
    view.maxiter = found.maxiter;
    settled = { rungs: found.rungs, fault: +found.fault.toFixed(4), at_ceiling: found.atCeiling };
  }
  // Written as the tab writes a cap nothing but its probe chose.
  view.capFrom = "probe";
  const link = emit(view);
  if (canonicalize(link, context) !== link) throw new Error(`${job.id}: ${link} is not a fixed point`);
  const spec = deepSpecOf(view, job.width, job.height, { supersample: ss });
  const { field, seconds } = await renderSpec(p, spec, threads, job.id);
  let interior = 0;
  for (const v of field) if (Number.isNaN(v)) interior++;
  writeFileSync(job.field, Buffer.from(field.buffer));
  out.push({
    id: job.id,
    link,
    maxiter: view.maxiter,
    settled,
    seconds: Math.round(seconds * 10) / 10,
    interior: +(interior / field.length).toFixed(4),
  });
  console.error(`${job.id}: cap ${view.maxiter}, ${seconds.toFixed(1)} s, interior ${(100 * interior / field.length).toFixed(2)}%`);
}
console.log(JSON.stringify(out));
