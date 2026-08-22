// Where a bench run's numbers land: `artifacts/explorer-bench/`, which is ignored.
//
// The harness itself is tracked — it is the regression guard for the specialization
// cascade, and a guard that lives in `scratch/` dies with the next wipe. What it
// *produces* is a measurement of this machine on this day, so it goes where the rest
// of this repository's runtime output goes and never into git.

import { mkdirSync, writeFileSync } from "node:fs";

const OUT = new URL("../../artifacts/explorer-bench/", import.meta.url);

export function record(name, payload) {
  mkdirSync(OUT, { recursive: true });
  const path = new URL(name, OUT);
  writeFileSync(path, JSON.stringify(payload, null, 2));
  console.log(`wrote ${path.pathname}`);
  return path;
}
