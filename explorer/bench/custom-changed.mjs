// Which Examples a rebake owes a redraw, against the bundle before it: every Example of a mode
// whose record moved beyond its `shown` list (stack, knobs, palette set, text) or whose earlier
// keeps moved, and every Example a mode gained; the rest keep the last rebake's reading, as
// long as the sibling's `engine/` and `style-wasm/` did not move between the two pins
// (`git diff --stat <old pin> <new pin> -- engine style-wasm` names no source).
//
//   git show HEAD:explorer/custom-modes.json > <scratch>/before.json   # before the rebake
//   node explorer/bench/custom-changed.mjs <scratch>/before.json [--skip <mode or style>,…]
//
// Prints the deleted and new modes, then `draw` (a comma list for every custom bench's
// `--only`) and `reuse`. 028 drew 206 and reused 42 of 248; the showcase's seats took 20 to
// 70 s a side each at one thread, so a whole redraw is hours. Reads only; writes nothing.

import { readFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";

const args = process.argv.slice(2);
if (args.length === 0) throw new Error("usage: custom-changed.mjs <before.json> [--skip <mode or style>,…]");
const at = args.indexOf("--skip");
const skip = at === -1 ? [] : args[at + 1].split(",");
const read = (path) => JSON.parse(readFileSync(path, "utf8"));
const before = new Map(read(args[0]).modes.map((mode) => [mode.style, mode]));
const after = read(new URL("../custom-modes.json", import.meta.url)).modes;

const draw = [];
const reuse = [];
for (const mode of after) {
  if (skip.includes(mode.name) || skip.includes(mode.style)) continue;
  const old = before.get(mode.style);
  const rest = (each) => ({ ...each, shown: undefined });
  const kept = old && isDeepStrictEqual(rest(old), rest(mode)) && isDeepStrictEqual(mode.shown.slice(0, old.shown.length), old.shown);
  mode.shown.forEach((_, index) => (kept && index < old.shown.length ? reuse : draw).push(`${mode.style}__${index}`));
}
const now = new Set(after.map((mode) => mode.style));
console.log("deleted", JSON.stringify([...before.values()].filter((mode) => !now.has(mode.style)).map((mode) => mode.name)));
console.log("new    ", JSON.stringify(after.filter((mode) => !before.has(mode.style)).map((mode) => mode.name)));
console.log(`draw    ${draw.length}: ${draw.join(",")}`);
console.log(`reuse   ${reuse.length}: ${reuse.join(",")}`);
