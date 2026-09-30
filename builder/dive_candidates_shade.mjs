// `python -m builder dive-candidates`: a candidate's link and picture, through the page's own code.
//
//   node builder/dive_candidates_shade.mjs jobs.json
//
// jobs.json: [{ id, deg, re, im, w, n, field, width, height, out,
//               ss, colour: { kind: "keep", seat } | { kind: "new", palette, lambda, period, phase,
//                                                       guard? } }]
//
// "keep" is the starting seat's palette and recipe, carried across the floor as entering the
// Deep tab carries it, and then fitted to Absolute on the landed field as the page's Fit (f)
// does. "new" is New coloring: the rule's lambda and period, the drawn palette and phase, and
// the Deep tab's fold on an open map. `guard` runs the page's aliasing guard (`aliasing.js`)
// over the field before the period is written, as the page's New coloring does; `dive-candidates`
// sends none and `random-dives` sends it. The link is emitted by `deep-link.js` and the field is
// shaded through `engine.wasm` exactly as the tab shades it. Prints [{ id, link, palette,
// guard? }], `guard` being the guard's `{ redraws, before, after }` where it ran.
//
// `deep_gallery_shade.mjs` cannot stand in for this: it canonicalizes a finished link, and has
// neither Fit nor the fold.
//
// **Straighten iter is left off here on purpose** (explorer_knee_ckpt157): the candidates and
// the random dives were drawn before the page turned it on for a fit from Leveled and for New
// coloring, and a rerun redraws those pictures as they were made. So what this draws is not
// what the page's Fit or New coloring gives the same frame today.

import { readFileSync, writeFileSync } from "node:fs";
import { load } from "../explorer/bench/engine.mjs";
import { install, stopsOf } from "../explorer/stops.js";
import { PALETTES } from "../explorer/palettes.js";
import * as deepLink from "../explorer/deep-link.js";
import { shadeSpecOf } from "../explorer/deep-render.js";
import * as shade from "../explorer/shade.js";
import * as fitting from "../explorer/fit.js";
import { SHADE_KEYS } from "../explorer/permalink.js";
import * as aliasing from "../explorer/aliasing.js";

const root = new URL("../explorer/", import.meta.url);
install(new Uint8Array(readFileSync(new URL("palettes.bin", root))));
const engine = await load(new URL("engine.wasm", root));

const context = {
  palettes: PALETTES,
  defaultPalette: "glowdon",
  deepHome: () => ({ x: "-0.5", y: "0", w: "3" }),
  deepCap: () => {
    throw new Error("every candidate names its cap");
  },
};

const COLOUR_KEYS = new Set(["p", ...SHADE_KEYS.map((spec) => spec.key)]);

function frameQuery(job) {
  const parts = ["dv=3"];
  if (job.deg !== 2) parts.push(`f=multibrot${job.deg}`);
  parts.push(`x=${job.re}`, `y=${job.im}`, `w=${job.w}`, `n=${job.n}`);
  return parts.join("&");
}

const out = [];
for (const job of JSON.parse(readFileSync(process.argv[2], "utf8"))) {
  let view;
  if (job.colour.kind === "keep") {
    // The seat's own colour keys, spelled as its link spells them, on the landed frame.
    const seat = new URLSearchParams(job.colour.seat);
    const kept = [...seat].filter(([key]) => COLOUR_KEYS.has(key));
    const query = `${frameQuery(job)}&${new URLSearchParams(kept)}`;
    view = deepLink.parse(`?${query}`, context);
  } else {
    view = deepLink.parse(`?${frameQuery(job)}&p=${encodeURIComponent(job.colour.palette)}`, context);
  }
  const lanes = new Uint8Array(readFileSync(job.field));
  const field = {
    values: new Float64Array(lanes.buffer, lanes.byteOffset, lanes.byteLength / 8),
    width: job.width,
    height: job.height,
    supersample: job.ss ?? 1,
  };
  let next;
  let guarded = null;
  if (job.colour.kind === "keep") {
    // Fit (f): Absolute sized to this picture, from Leveled as the recipe stands, or from
    // Leveled as the engine draws it where the recipe is Absolute already.
    const absolute = view.shade.scale === "absolute";
    const target = absolute ? { ...view.shade, lambda: 1, phase: 0 } : view.shade;
    const found = fitting.fit(field, target, "smooth");
    next = { ...view.shade, scale: "absolute" };
    if (found !== null) {
      for (const key of ["lambda", "period", "phase"]) next = shade.withKey(next, key, String(found[key]));
    }
  } else {
    next = { ...view.shade, scale: "absolute" };
    // The Deep tab folds an open map on every palette change, New coloring's included.
    const mirror = !PALETTES.get(job.colour.palette).cyclic;
    let period = job.colour.period;
    if (job.colour.guard) {
      guarded = aliasing.guard(
        field,
        { lambda: job.colour.lambda, period, phase: job.colour.phase },
        aliasing.tableOf(stopsOf(job.colour.palette), mirror),
      );
      period = guarded.period;
    }
    for (const [key, value] of [
      ["lambda", job.colour.lambda],
      ["period", period],
      ["phase", job.colour.phase],
    ]) {
      next = shade.withKey(next, key, String(value));
    }
    next = { ...next, mirror };
  }
  view = { ...view, shade: next, level: null, capFrom: "tile" };
  const link = deepLink.emit(view);
  // The link is the picture: read back, it is this view, and canonical.
  const again = deepLink.parse(`?${link}`, context);
  if (deepLink.emit(again) !== link) throw new Error(`${job.id}: link is not a fixed point`);
  const spec = shadeSpecOf(again, stopsOf(again.palette), job.width, job.height, {
    supersample: job.ss ?? 1,
  });
  const { image } = engine.shadeLevel(spec, lanes, 0);
  writeFileSync(job.out, image);
  const said = { id: job.id, link, palette: again.palette };
  if (guarded !== null) {
    const { redraws, before, after } = guarded;
    said.guard = { redraws, before, after };
  }
  out.push(said);
}
console.log(JSON.stringify(out));
