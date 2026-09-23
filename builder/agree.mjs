// Whether an atlas picture and the link under it are the same picture.
//
// A slot carries two things a reader takes as one: a thumbnail the pipeline drew next
// door, and a link into the explorer built from the record's recipe by `atlas/links.js`.
// Every other test of the atlas asks whether the *link* is well formed. This asks whether
// it is the *picture*, which is the promise the page makes, and it asks it twice.
//
//   * **members** — every slot on every plane: the view the link parses back to, held
//     member for member to the recipe the record says the thumbnail was drawn from.
//     Family, constants, frame, mode, each mode parameter, map, each shade key, curve.
//     A member the recipe names and the link does not carry is a failure unless the
//     record's own `refused` says so; a member the recipe leaves out is held to the
//     constant the picture was drawn at.
//   * **draw** — named slots only, through the committed wasm, at the thumbnail's own
//     size and sampling: the RGBA the explorer paints for that link, for `check` to set
//     beside the stored picture. Node cannot decode WebP and nothing is going to be
//     installed for it, so the comparison is Python's.
//
// Written because the members half would have caught *ckpt141* on the first run: the
// ingest copied the engine's `texture_weight` into the record, the link writer read the
// contract's `weight`, and 28 thumbnails opened at the catalog's 0.85 over pictures drawn
// at their own weights. Every structural test here passed throughout, because each one
// asked whether the link was a link.
//
// The cap is the one member a link has no key for at all, so it is held the way the record
// holds a map the explorer does not bake: where the link's cap is not the picture's, the
// slot's `refused` must say `cap <n>`, and the ingest writes that line off `caps` below.
//
//   node builder/agree.mjs members
//   node builder/agree.mjs caps < slots.json
//   node builder/agree.mjs draw <out-dir> <plane/dot/slot>...

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import * as link from "../explorer/permalink.js";
import { SETTLED } from "../explorer/catalog.js";
import { specOf } from "../explorer/render.js";
import { install } from "../explorer/stops.js";
import { load } from "../explorer/bench/engine.mjs";
import { contractOf, opened } from "../atlas/links.js";

const ATLAS = new URL("../atlas/", import.meta.url);

/** Samples a pixel along each axis the maker draws a slot thumbnail at: next door's
 *  `curation/atlas/pictures.SUPERSAMPLE`. The record's `thumb` carries the size and not
 *  the sampling, so it is stated here, once, and a thumbnail drawn at another would show
 *  up as every sampled slot failing at once rather than as one of them. */
export const THUMB_SUPERSAMPLE = 2;

const engine = await load();
const CONTRACT = contractOf((family) => {
  const answer = engine.plan({ schema: 1, family });
  if (!answer.ok) throw new Error(answer.why);
  return answer.home;
});

function rowsOf(name) {
  return readFileSync(fileURLToPath(new URL(name, ATLAS)), "utf8")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line));
}

const index = rowsOf("atlas.jsonl");
const method = index.find((row) => row.kind === "method");
const partitions = index.filter((row) => row.kind === "partition");

/** Every slot, addressed `plane/dot/slot` — the record's own names, never a position. */
function everySlot() {
  return partitions.flatMap((partition) =>
    rowsOf(partition.file)
      .filter((row) => row.kind === "dot")
      .flatMap((dot) =>
        Object.entries(dot.slots).map(([name, slot]) => ({
          where: `${partition.partition}/${dot.id}/${name}`,
          slot,
        })),
      ),
  );
}

/** The slot at one address, or a throw naming it. `~bare` strips the recipe's mode
 *  parameters, which is the ckpt141 defect on purpose: `check`'s control that the pixel
 *  half can still tell a wrong link from a right one. */
function slotAt(where) {
  const [address, variant] = where.split("~");
  const found = everySlot().find((entry) => entry.where === address);
  if (found === undefined) throw new Error(`the atlas record has no slot ${address}`);
  if (variant === undefined) return found.slot;
  if (variant !== "bare") throw new Error(`${where}: the only variant is ~bare`);
  const { mode_params: _, ...bare } = found.slot;
  return bare;
}

/**
 * The iteration cap the explorer draws a slot's link at, which is the engine's depth policy
 * at that frame: **a link carries no cap**, and the page asks `plan` for one. The recipe's
 * `maxiter` is the cap the picture was drawn at, and where the two differ the link is not
 * the picture. At thumbnail size that is invisible on nearly every slot and not on all of
 * them: `phoenix/4/gallery`, drawn at 1,071 where the policy gives 8,574, opens 24 of 255
 * away from its thumbnail and 7.5 at its own cap. So the record says it, `cap <n>` in
 * `refused`, the way it says a map it could not carry.
 */
function plannedCap(slot) {
  const view = link.parse(opened(CONTRACT, slot).query, CONTRACT);
  const { width, height } = method.thumb;
  const shape = engine.plan(specOf(view, width, height, { colormap: false }));
  if (!shape.ok) throw new Error(shape.why);
  return shape.maxiter;
}

/** How a slot's `refused` spells a cap its link cannot carry. `builder/atlas.py` writes it. */
export const capRefusal = (maxiter) => `cap ${maxiter}`;

/** Every way the parsed view differs from the recipe, as sentences. */
function disagreements(slot) {
  const said = new Set(slot.refused ?? []);
  const { view, palette } = opened(CONTRACT, slot);
  const found = [];
  const differ = (member, recipe, carried) =>
    found.push(`${member}: the picture was drawn at ${recipe}, the link opens at ${carried}`);

  const planned = plannedCap(slot);
  if (planned !== slot.maxiter && !said.has(capRefusal(slot.maxiter))) {
    differ("maxiter", slot.maxiter, `${planned}, and refused does not say so`);
  }
  for (const line of said) {
    if (line.startsWith("cap ") && (line !== capRefusal(slot.maxiter) || planned === slot.maxiter)) {
      found.push(`refused says "${line}", and the link draws at ${planned} over a picture drawn at ${slot.maxiter}`);
    }
  }

  if (view.family !== slot.family) differ("family", slot.family, view.family);
  for (const key of link.CONSTANTS[slot.family] ?? []) {
    if (view.constants[key].text !== slot[key]) differ(key, slot[key], view.constants[key].text);
  }
  for (const key of ["x", "y", "w"]) {
    if (view[key].text !== slot[key]) differ(key, slot[key], view[key].text);
  }
  if (view.mode !== slot.mode) differ("mode", slot.mode, view.mode);

  const recipe = slot.mode_params ?? {};
  const settled = SETTLED[slot.mode] ?? {};
  for (const key of new Set([...Object.keys(recipe), ...Object.keys(view.params)])) {
    // Where the recipe names none, the picture was drawn at the catalog's constant.
    const drawn = recipe[key] ?? settled[key];
    if (view.params[key] !== drawn) differ(`${slot.mode} ${key}`, drawn, view.params[key]);
  }

  if (palette !== slot.colormap && !said.has(`colormap ${slot.colormap}`)) {
    differ("colormap", slot.colormap, palette);
  }
  const shade = { ...link.defaultShade(), ...(slot.shade ?? {}) };
  for (const spec of link.SHADE_KEYS) {
    if (spec.key === "mirror" && said.has("mirror on a cyclic map")) continue;
    if (!spec.same(view.shade[spec.key], shade[spec.key])) {
      differ(spec.key, JSON.stringify(shade[spec.key]), JSON.stringify(view.shade[spec.key]));
    }
  }

  const level = slot.level == null ? null : link.LEVEL_KEY.read(slot.level);
  const fellBack = palette !== slot.colormap;
  if (!fellBack && !link.LEVEL_KEY.same(view.level ?? null, level)) {
    differ("level", slot.level, JSON.stringify(view.level));
  }
  return found;
}

function members() {
  const problems = [];
  let checked = 0;
  for (const { where, slot } of everySlot()) {
    checked += 1;
    let found;
    try {
      found = disagreements(slot);
    } catch (error) {
      found = [`the link cannot be built: ${error.message}`];
    }
    for (const sentence of found) problems.push(`${where}: ${sentence}`);
  }
  return { checked, problems };
}

/** The RGBA the explorer paints for one slot's link, at the thumbnail's geometry. */
function draw(where, out) {
  const { query } = opened(CONTRACT, slotAt(where));
  const view = link.parse(query, CONTRACT);
  const { width, height } = method.thumb;
  const spec = specOf(view, width, height, { supersample: THUMB_SUPERSAMPLE });
  const shape = engine.plan(spec);
  if (!shape.ok) throw new Error(`${where}: ${shape.why}`);
  const lanes = engine.band(spec, shape, 0, height);
  const image = shape.direct ? lanes : engine.shadeLevel(spec, lanes, 0).image;
  writeFileSync(out, image);
  return { where, query, rgba: out, width, height };
}

const [command, ...rest] = process.argv.slice(2);
if (command === "members") {
  process.stdout.write(JSON.stringify(members()));
} else if (command === "caps") {
  // Slots as the ingest is about to write them, on stdin: the cap each one's link draws at.
  const slots = JSON.parse(readFileSync(0, "utf8"));
  process.stdout.write(JSON.stringify(slots.map(plannedCap)));
} else if (command === "draw") {
  const [directory, ...wheres] = rest;
  const blob = fileURLToPath(new URL("../explorer/palettes.bin", import.meta.url));
  install(new Uint8Array(readFileSync(blob)));
  mkdirSync(directory, { recursive: true });
  const drawn = wheres.map((where) =>
    draw(where, `${directory}/${where.replaceAll("/", "-").replace("~", "-")}.rgba`),
  );
  process.stdout.write(JSON.stringify(drawn));
} else {
  process.stderr.write("usage: node builder/agree.mjs members | draw <out-dir> <plane/dot/slot>...\n");
  process.exit(2);
}
