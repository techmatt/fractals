// The page of dives and their Julia sets: one field's pictures, through the page's own code.
//
//   node builder/julia_dives_shade.mjs jobs.json
//
// The dive chain pilot's shade.mjs (scratch/dive_chain_pilot/), with two more colouring kinds:
//
// jobs.json: [{ id, deg, re, im, w, n, julia: null | { re, im }, field, width, height, ss,
//               colourings: [ { tag, out, palette, cycles, phase }      New coloring, knee on
//                           | { tag, out, recipe, palette }             another tile's recipe
//                           | { tag, out, own }                         a recorded link's colouring
//                           | { tag, out, neutral: true } ] }]          the location judge's recipe
//
// `own` is a deep link whose palette and shade (scale, λ, period, phase, knee, mirror, …) are put
// on this job's frame unchanged — a forced-in pick in the colouring it was picked in, or its
// Julia twin in that same colouring. `neutral` is judge_deep_ckpt156's: the frame and cap under
// `p=twilight_shifted` and nothing else, the contract's defaults being the judge's recipe.
// Prints [{ id, tag, link, palette, recipe }].

import { readFileSync, writeFileSync } from "node:fs";
import { load } from "../explorer/bench/engine.mjs";
import { install, stopsOf } from "../explorer/stops.js";
import { PALETTES } from "../explorer/palettes.js";
import * as deepLink from "../explorer/deep-link.js";
import { shadeSpecOf } from "../explorer/deep-render.js";
import * as shade from "../explorer/shade.js";
import * as travel from "../explorer/period-range.js";
import * as aliasing from "../explorer/aliasing.js";
import * as fitting from "../explorer/fit.js";

const root = new URL("../explorer/", import.meta.url);
install(new Uint8Array(readFileSync(new URL("palettes.bin", root))));
const engine = await load(new URL("engine.wasm", root));

const context = {
  palettes: PALETTES,
  defaultPalette: "glowdon",
  deepHome: () => ({ x: "-0.5", y: "0", w: "3" }),
  deepCap: () => {
    throw new Error("every tile names its cap");
  },
};

function frameQuery(job) {
  const parts = ["dv=3"];
  const family = job.julia ? (job.deg === 2 ? "julia" : `julia${job.deg}`) : `multibrot${job.deg}`;
  if (job.deg !== 2 || job.julia) parts.push(`f=${family}`);
  if (job.julia) parts.push(`cx=${job.julia.re}`, `cy=${job.julia.im}`);
  parts.push(`x=${job.re}`, `y=${job.im}`, `w=${job.w}`, `n=${job.n}`);
  return parts.join("&");
}

const out = [];
for (const job of JSON.parse(readFileSync(process.argv[2], "utf8"))) {
  const lanes = new Uint8Array(readFileSync(job.field));
  const field = {
    values: new Float64Array(lanes.buffer, lanes.byteOffset, lanes.byteLength / 8),
    width: job.width,
    height: job.height,
    supersample: job.ss ?? 1,
  };
  const measured = travel.measure(field);
  for (const colouring of job.colourings) {
    let view;
    let said = {};
    if (colouring.neutral) {
      view = { ...deepLink.parse(`?${frameQuery(job)}&p=twilight_shifted`, context), level: null };
    } else if (colouring.refit) {
      // carried_dives_twin_fit_ckpt160: the Deep tab's Fit pressed on this frame, absolute with
      // Straighten iter on — `explorer.js`'s `fitted` with the knee at `shade.STRAIGHTEN`.
      const was = deepLink.parse(`?${colouring.refit}`, context);
      const frame = deepLink.parse(`?${frameQuery(job)}&p=${encodeURIComponent(was.palette)}`, context);
      const subject = { ...frame, palette: was.palette, shade: shade.straightened({ ...was.shade, scale: "absolute" }) };
      const target = { ...subject.shade, lambda: 1, phase: 0 };
      const straight = { knee: subject.shade.knee, lambda: subject.shade.lambda };
      const found = fitting.fit(field, target, subject.mode ?? "smooth", subject.curve ?? null, straight);
      if (found === null) {
        out.push({ id: job.id, tag: colouring.tag, link: null, why: "nothing to fit" });
        continue;
      }
      let next = { ...subject.shade, scale: "absolute", knee: straight.knee };
      for (const key of ["lambda", "period", "phase"]) next = shade.withKey(next, key, String(found[key]));
      view = { ...subject, shade: next, level: null, capFrom: "tile" };
      said = { fit: found };
    } else if (colouring.own) {
      const own = deepLink.parse(`?${colouring.own}`, context);
      const frame = deepLink.parse(`?${frameQuery(job)}&p=${encodeURIComponent(own.palette)}`, context);
      view = { ...frame, palette: own.palette, shade: own.shade, level: null, capFrom: "tile" };
    } else {
      const palette = colouring.palette;
      view = deepLink.parse(`?${frameQuery(job)}&p=${encodeURIComponent(palette)}`, context);
      let next;
      if (colouring.recipe) {
        next = { ...view.shade, scale: "absolute" };
        for (const key of ["lambda", "period", "phase", "knee"]) {
          next = shade.withKey(next, key, String(colouring.recipe[key]));
        }
        next = { ...next, mirror: colouring.recipe.mirror };
      } else {
        const mirror = !PALETTES.get(palette).cyclic;
        const { knee, lambda } = shade.STRAIGHTEN;
        const spread = measured === null ? null : travel.spreadOf(measured, lambda, knee);
        if (spread === null) {
          out.push({ id: job.id, tag: colouring.tag, link: null, why: "too little exterior to colour" });
          continue;
        }
        const period = Number((spread / colouring.cycles).toPrecision(3));
        const guarded = aliasing.guard(
          field,
          { lambda, period, phase: colouring.phase, knee },
          aliasing.tableOf(stopsOf(palette), mirror),
        );
        next = { ...view.shade, scale: "absolute" };
        for (const [key, value] of [
          ["lambda", lambda],
          ["period", guarded.period],
          ["phase", colouring.phase],
          ["knee", knee],
        ]) {
          next = shade.withKey(next, key, String(value));
        }
        next = { ...next, mirror };
        said = { guard: { redraws: guarded.redraws, before: guarded.before, after: guarded.after } };
      }
      view = { ...view, shade: next, level: null, capFrom: "tile" };
    }
    const link = deepLink.emit(view);
    const again = deepLink.parse(`?${link}`, context);
    if (deepLink.emit(again) !== link) throw new Error(`${job.id}: link is not a fixed point`);
    // Shaded with no level, as both the study (neutral) and the pilot (the rest) shaded.
    const spec = shadeSpecOf({ ...again, level: null }, stopsOf(again.palette), job.width, job.height, {
      supersample: job.ss ?? 1,
    });
    const { image } = engine.shadeLevel(spec, lanes, 0);
    writeFileSync(colouring.out, image);
    const s = again.shade;
    out.push({
      id: job.id,
      tag: colouring.tag,
      link,
      palette: again.palette,
      recipe: { lambda: s.lambda, period: s.period, phase: s.phase, knee: s.knee, mirror: s.mirror },
      ...said,
    });
  }
}
console.log(JSON.stringify(out));
