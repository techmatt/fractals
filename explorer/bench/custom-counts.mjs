// Every number `style.test.mjs` pins about the custom-mode bundle, from the committed
// `custom-modes.json`, in one run: what a rebake or a re-keep next door moves
// (`docs/custom-modes.md` step 8). Without it the counts were found by failing the test
// over and over, one assertion at a time (015).
//
//   node explorer/bench/custom-counts.mjs
//
// Prints the modes in all and by tier, the keeps and the buttons offered, the keeps not
// offered, the offered keeps no setting reaches (the test's `UNREACHED`, less the
// unoffered), and brass-foam's palette set. Reads only; writes nothing.

import { readFileSync } from "node:fs";

import { encode } from "../permalink.js";
import { offeredExamples, palettesOf, tierOf } from "../style.js";

const bundle = JSON.parse(readFileSync(new URL("../custom-modes.json", import.meta.url), "utf8"));
const id = (mode, index) => `${mode.style}__${index}`;

const tiers = {};
for (const mode of bundle.modes) tiers[tierOf(mode)] = (tiers[tierOf(mode)] ?? 0) + 1;
const keeps = bundle.modes.flatMap((mode) => mode.shown.map((_, index) => id(mode, index)));
const offered = bundle.modes.flatMap((mode) => offeredExamples(mode, encode).map(({ index }) => id(mode, index)));
const unreached = bundle.modes.flatMap((mode) =>
  offeredExamples(mode, encode)
    .filter(({ reached }) => !reached)
    .map(({ index }) => id(mode, index)),
);
const brass = bundle.modes.find((mode) => mode.name === "brass-foam");

console.log(`modes      ${bundle.modes.length} (${Object.entries(tiers).map(([tier, count]) => `${tier} ${count}`).join(", ")})`);
console.log(`keeps      ${keeps.length}, offered ${offered.length}`);
console.log(`unoffered  ${JSON.stringify(keeps.filter((each) => !offered.includes(each)))}`);
console.log(`unreached  ${JSON.stringify(unreached)}`);
console.log(`brass-foam ${brass ? JSON.stringify(palettesOf(brass).map((entry) => entry.colormap)) : "absent"}`);
