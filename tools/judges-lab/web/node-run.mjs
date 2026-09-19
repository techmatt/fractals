// onnxruntime-node over every set x variant, CPU EP (and DirectML where it loads).
// Usage: node web/node-run.mjs [--eps cpu,dml] [--tag label]
// Writes results/node-<ep>-<set>-<variant>.json

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as ort from "onnxruntime-node";
import { runConfig } from "./core.mjs";

const LAB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
};
const eps = arg("eps", "cpu").split(",");
const tag = arg("tag", "");
const pixels = new Uint8Array(fs.readFileSync(path.join(LAB, "artifacts", "inputs.u8")));
const count = pixels.length / (384 * 224 * 3);
fs.mkdirSync(path.join(LAB, "results"), { recursive: true });

for (const ep of eps) {
  for (const set of ["render", "fine3", "fused"]) {
    for (const variant of ["fp32", "fp16", "fp16w"]) {
      const name = `node-${ep}-${set}-${variant}`;
      try {
        const r = await runConfig(ort, {
          set,
          variant,
          ep,
          count,
          pixels,
          loadBytes: async (f) => new Uint8Array(fs.readFileSync(path.join(LAB, "models", f))),
        });
        r.runtime = `onnxruntime-node ${ort.env.versions?.common ?? ""}`.trim();
        r.tag = tag;
        fs.writeFileSync(path.join(LAB, "results", `${name}.json`), JSON.stringify(r));
        console.log(
          `${name.padEnd(28)} create ${r.create_ms.toFixed(0)}ms  first ${r.first_run_ms.toFixed(0)}ms  ` +
            `b1 ${r.warm_b1.median_ms.toFixed(1)}ms  b8 ${r.warm_bN.per_image_ms.toFixed(1)}ms/img`,
        );
      } catch (e) {
        const msg = String(e?.message ?? e).split("\n")[0].slice(0, 300);
        fs.writeFileSync(
          path.join(LAB, "results", `${name}.json`),
          JSON.stringify({ set, variant, ep, runtime: "onnxruntime-node", error: msg, tag }),
        );
        console.log(`${name.padEnd(28)} FAILED: ${msg}`);
      }
    }
  }
}
