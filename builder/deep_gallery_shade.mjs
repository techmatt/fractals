// The Deep tab's gallery: colour a native field exactly as the tab colours it from a link.
//
//   node builder/deep_gallery_shade.mjs jobs.json
//
// jobs.json: [{ id, query, field?, width, height, ss, out? }]. Each query is read by the
// Deep tab's own contract — `deep-link.js`'s `canonicalize`, which must be a fixed point —
// and the canonical link is printed back. Where a job names a field, it is shaded through
// `engine.wasm`'s `shade_level` with the spec `deep-render.js`'s `shadeSpecOf` builds from
// the parsed view, and the raw RGBA lands at `out`. Prints [{ id, link }] as JSON.
//
// `builder/deep_gallery.py` is the only caller; `builder/README.md`'s *The Deep tab's
// gallery* is the method.

import { readFileSync, writeFileSync } from "node:fs";
import { load } from "../explorer/bench/engine.mjs";
import { install, stopsOf } from "../explorer/stops.js";
import { PALETTES } from "../explorer/palettes.js";
import { canonicalize, parse } from "../explorer/deep-link.js";
import { shadeSpecOf } from "../explorer/deep-render.js";

const root = new URL("../explorer/", import.meta.url);
install(new Uint8Array(readFileSync(new URL("palettes.bin", root))));
const engine = await load(new URL("engine.wasm", root));

const context = {
  palettes: PALETTES,
  defaultPalette: "glowdon",
  deepHome: () => ({ x: "-0.5", y: "0", w: "3" }),
  deepCap: () => {
    throw new Error("every gallery link names its cap");
  },
};

const jobs = JSON.parse(readFileSync(process.argv[2], "utf8"));
const out = [];
for (const job of jobs) {
  const link = canonicalize(job.query, context);
  if (canonicalize(link, context) !== link) throw new Error(`${job.id}: link is not a fixed point`);
  const entry = { id: job.id, link };
  if (job.field) {
    const view = parse(link, context);
    const lanes = new Uint8Array(readFileSync(job.field));
    const spec = shadeSpecOf(view, stopsOf(view.palette), job.width, job.height, {
      supersample: job.ss ?? 1,
    });
    const { image } = engine.shadeLevel(spec, lanes, 0);
    writeFileSync(job.out, image);
  }
  out.push(entry);
}
console.log(JSON.stringify(out));
