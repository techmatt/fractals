// The Phoenix tab's starting points, drawn through the committed wasm.
//
// `builder/phoenix_points.py` chooses the points; this draws what the tab shows of each,
// in the module the tab itself runs, so a tile is the explorer's own picture of that set
// rather than a second engine's opinion of it. Two things per point:
//
//   * **tile** — the whole Phoenix set at `(p, c)`, z₋₁ = 0, at the family's home view,
//     in the tab's one style: RGBA at the tile's size, for Python to encode.
//   * **plane** — the frame the plane opens at when the tile is clicked: the filled set of
//     `phoenix_m` at that `p`, with `c` itself, boxed and padded to 16:9. Found by a wide
//     field and then a close one, and recorded, so the page never re-derives it.
//
//   node builder/phoenix_points.mjs <out-dir> < request.json
//
// The request is `{style, tile: {width, height, supersample}, points: [{name, p, c}]}`;
// the answer on stdout is one `{name, rgba, plane}` per point.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import * as link from "../explorer/permalink.js";
import { specOf } from "../explorer/render.js";
import { install } from "../explorer/stops.js";
import { load } from "../explorer/bench/engine.mjs";
import { contractOf } from "../atlas/links.js";

/** The first look at a plane: wide enough for any `p` the tab offers, where every set
 *  of this recurrence with |p| ≤ 1 sits well inside. */
const WIDE = { x: -0.5, y: 0, w: 8 };

/** The grid both looks are taken at. */
const PROBE = { width: 640, height: 360 };

/** The room left round the set, as a share of its box, and the narrowest frame opened. */
const PAD = 1.3;
const NARROWEST = 0.3;

const engine = await load();
const CONTRACT = contractOf((family) => {
  const answer = engine.plan({ schema: 1, family });
  if (!answer.ok) throw new Error(answer.why);
  return answer.home;
});

const number = (value) => link.coordinateOf(value);

/** The tab's style laid onto a view: one mode, one map, the shade keys at their defaults
 *  but where the style names one, and no tone curve. */
function styled(view, style) {
  return {
    ...view,
    mode: style.mode,
    palette: style.palette,
    shade: { ...link.defaultShade(), ...style.shade },
    level: null,
  };
}

/** The whole Phoenix set at `(p, c)`: the view a click on the plane there opens, which
 *  is the family's home frame, in the style. */
function setView({ p, c }, style) {
  const fresh = link.fresh("phoenix", style.mode, CONTRACT);
  const constants = {
    ...fresh.constants,
    cx: number(c[0]),
    cy: number(c[1]),
    px: number(p[0]),
    py: number(p[1]),
    zx: number(0),
    zy: number(0),
  };
  return styled({ ...fresh, constants }, style);
}

/** The plane at `p` over one frame, as a view. */
function planeView(p, frame, style) {
  const fresh = link.fresh("phoenix_plane", style.mode, CONTRACT);
  return styled(
    {
      ...fresh,
      constants: { px: number(p[0]), py: number(p[1]) },
      x: number(frame.x),
      y: number(frame.y),
      w: number(frame.w),
    },
    style,
  );
}

/** The box, in plane coordinates, of the pixels that never escaped. `smooth` writes one
 *  f64 lane, and a pixel still bounded at the cap is NaN there. */
function interiorBox(p, frame, style) {
  const { width, height } = PROBE;
  const spec = specOf(planeView(p, frame, style), width, height, { colormap: false });
  const shape = engine.plan(spec);
  if (!shape.ok) throw new Error(shape.why);
  const lanes = engine.band(spec, shape, 0, height);
  if (lanes.length !== width * height * 8) {
    throw new Error(`expected one f64 lane, got ${lanes.length / (width * height)} bytes a pixel`);
  }
  const values = new Float64Array(lanes.buffer, lanes.byteOffset, width * height);
  const tall = (frame.w * height) / width;
  let box = null;
  for (let row = 0; row < height; row += 1) {
    for (let col = 0; col < width; col += 1) {
      if (!Number.isNaN(values[row * width + col])) continue;
      const x = frame.x + ((col + 0.5) / width - 0.5) * frame.w;
      const y = frame.y - ((row + 0.5) / height - 0.5) * tall;
      box = box === null
        ? { left: x, right: x, bottom: y, top: y }
        : {
            left: Math.min(box.left, x),
            right: Math.max(box.right, x),
            bottom: Math.min(box.bottom, y),
            top: Math.max(box.top, y),
          };
    }
  }
  return box;
}

/** A 16:9 frame round a box, padded, never narrower than `NARROWEST`. */
function frameRound(box) {
  const across = box.right - box.left;
  const up = box.top - box.bottom;
  const w = Math.max(NARROWEST, Math.max(across, (up * 16) / 9) * PAD);
  return { x: (box.left + box.right) / 2, y: (box.bottom + box.top) / 2, w };
}

/** Where the plane opens for a point: its set and its `c`, looked at twice. */
function planeFrame({ p, c }, style) {
  const grow = (box) => ({
    left: Math.min(box.left, c[0]),
    right: Math.max(box.right, c[0]),
    bottom: Math.min(box.bottom, c[1]),
    top: Math.max(box.top, c[1]),
  });
  const first = interiorBox(p, WIDE, style);
  if (first === null) throw new Error(`the plane at p = ${p} has no interior in the wide frame`);
  const second = interiorBox(p, frameRound(grow(first)), style) ?? first;
  const frame = frameRound(grow(second));
  // Six places is finer than a pixel of the narrowest frame, and a record that says
  // −0.1873 means it rather than the double's tail.
  return Object.fromEntries(Object.entries(frame).map(([key, value]) => [key, Number(value.toFixed(6))]));
}

function tile(point, style, { width, height, supersample }, out) {
  const spec = specOf(setView(point, style), width, height, { supersample });
  const shape = engine.plan(spec);
  if (!shape.ok) throw new Error(`${point.name}: ${shape.why}`);
  const lanes = engine.band(spec, shape, 0, height);
  const image = shape.direct ? lanes : engine.shadeLevel(spec, lanes, 0).image;
  writeFileSync(out, image);
  return out;
}

const [directory] = process.argv.slice(2);
if (directory === undefined) {
  process.stderr.write("usage: node builder/phoenix_points.mjs <out-dir> < request.json\n");
  process.exit(2);
}
const request = JSON.parse(readFileSync(0, "utf8"));
install(new Uint8Array(readFileSync(fileURLToPath(new URL("../explorer/palettes.bin", import.meta.url)))));
mkdirSync(directory, { recursive: true });
const answer = request.points.map((point) => ({
  name: point.name,
  rgba: tile(point, request.style, request.tile, `${directory}/${point.name}.rgba`),
  plane: planeFrame(point, request.style),
}));
process.stdout.write(JSON.stringify(answer));
