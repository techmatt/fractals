// The atlas record, read.
//
// `builder/atlas.py` is the authority on what the record may say and holds it to that
// shape before anything is committed; this file is the browser's half — it fetches the
// index, fetches each partition it names, and hands back objects the page draws from.
//
// **It reads keys and never composes them.** A dot's viewport is the record's own `x`,
// `y`, `w` and constants, spelled the way `permalink.js` spells them, and they go to the
// contract untouched. Nothing here works out where a location is from where it sits in a
// list — a rig that did would draw at a moving target the day the maker reran next door,
// and the pictures would not change while the links underneath them did.

/** The constants a permalink carries for a family that has them. */
const CONSTANT_KEYS = ["cx", "cy", "px", "py", "zx", "zy"];

/** One JSONL file as the rows it holds. */
async function rowsOf(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url.pathname}: ${response.status} ${response.statusText}`);
  const text = await response.text();
  return text
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line));
}

/** A dot's viewport, as the keys the contract reads. */
function viewportOf(row) {
  const held = { x: row.x, y: row.y, w: row.w };
  for (const key of CONSTANT_KEYS) {
    if (row[key] !== undefined) held[key] = row[key];
  }
  return held;
}

/**
 * The whole record: the method row, and one entry per partition.
 *
 * `base` is the directory the record lives in, so every fetch is relative to the page
 * that carries it — this site is served from a project-Pages subpath, and a rooted URL
 * is the bug that works locally.
 */
export async function load(base) {
  const index = await rowsOf(new URL("atlas.jsonl", base));
  const method = index.find((row) => row.kind === "method");
  if (method === undefined) throw new Error("atlas.jsonl: no method row");

  const partitions = [];
  for (const row of index.filter((entry) => entry.kind === "partition")) {
    const rows = await rowsOf(new URL(row.file, base));
    const density = rows.find((entry) => entry.kind === "density");
    const dots = rows
      .filter((entry) => entry.kind === "dot")
      .map((entry) => ({
        key: entry.location_key,
        family: entry.family,
        viewport: viewportOf(entry),
        at: entry.at,
        keepers: entry.keepers,
        score: entry.score,
        judged: entry.judged ?? null,
      }));
    partitions.push({
      name: row.partition,
      title: row.title,
      family: row.family,
      radius: row.radius,
      keepers: row.keepers,
      plane: planeOf(row.plane),
      says: row.says,
      dots,
      density: {
        bins: density.bins,
        total: density.total,
        cells: density.cells,
        peak: density.cells.reduce((most, cell) => Math.max(most, cell[2]), 0),
      },
    });
  }
  if (partitions.length === 0) throw new Error("atlas.jsonl: no partitions");

  return {
    fixture: method.fixture === true,
    made: method.made,
    rule: method.rule ?? "",
    nodeView: method.node_view,
    partitions,
  };
}

/**
 * The frame an atlas is drawn over, with the four numbers a plot needs beside it.
 *
 * The record spells the plane the way it spells a view — a centre and a width — because
 * it is a view, and the same three keys open it in the explorer. The edges are worked
 * out here because a rectangle is what a canvas wants.
 */
function planeOf(plane) {
  const width = Number(plane.w);
  const height = (width * plane.aspect[1]) / plane.aspect[0];
  return {
    family: plane.family,
    x: plane.x,
    y: plane.y,
    w: plane.w,
    aspect: plane.aspect,
    frame: {
      x: Number(plane.x),
      y: Number(plane.y),
      width,
      height,
      left: Number(plane.x) - width / 2,
      top: Number(plane.y) + height / 2,
    },
  };
}

/** The plane rectangle one density cell covers, in the plane's own coordinates. */
export function cellRect(partition, cell) {
  const [ix, iy, count] = cell;
  const [across, down] = partition.density.bins;
  const { left, top, width, height } = partition.plane.frame;
  return {
    left: left + (ix * width) / across,
    top: top - (iy * height) / down,
    width: width / across,
    height: height / down,
    count,
  };
}
