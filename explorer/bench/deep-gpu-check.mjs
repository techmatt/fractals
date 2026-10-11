// The Deep tab's shipped GPU kernel held to its model, driven headless: opens
// `gpu-probe/kernel-check.html`, waits for `window.__check.done`, and prints its report.
//
//   node explorer/bench/deep-gpu-check.mjs                 # print the report
//   node explorer/bench/deep-gpu-check.mjs --out FILE      # and write it to FILE
//   node explorer/bench/deep-gpu-check.mjs --json FILE     # the structured result as well
//   node explorer/bench/deep-gpu-check.mjs --query "frames=D-1e-60&vectors=0"
//   node explorer/bench/deep-gpu-check.mjs --patience 3600 # seconds to wait (default 3600)
//   node explorer/bench/deep-gpu-check.mjs --port 8001     # serve elsewhere than 8000
//
// `python -m builder serve` must be up. The page reads `explorer/deep-gpu-selftest/` and the
// bundles `deep-gpu-model`'s `export --interior on` writes under `artifacts/deep-gpu-check/`
// (the page's header says which). Like the rest of `bench/` it asserts nothing in CI; it
// exits 1 when the page says a run differs, and 0 otherwise.

import { writeFileSync } from "node:fs";
import { open } from "./cdp.mjs";

const args = process.argv.slice(2);
const option = (name) => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : null;
};
const port = option("--port") ?? "8000";
const outFile = option("--out");
const jsonFile = option("--json");
const search = option("--query");
const PATIENCE = 1000 * Number(option("--patience") ?? 3600);

const url = `http://localhost:${port}/explorer/bench/gpu-probe/kernel-check.html${search ? `?${search}` : ""}`;
const browser = await open({ port: 9432, headless: !args.includes("--headed") });
let ok = false;
try {
  await browser.send("Page.navigate", { url });
  if (!(await browser.until("window.__check !== undefined", { within: 30000 }))) throw new Error(`the page never started at ${url}`);
  const deadline = Date.now() + PATIENCE;
  let shown = 0;
  let finished = false;
  for (;;) {
    finished = await browser.evaluate(`Promise.race([window.__check.done.then(() => true), new Promise((r) => setTimeout(() => r(false), 5000))])`);
    const text = await browser.evaluate("window.__check.text");
    const lines = text.split("\n");
    if (lines.length > shown) {
      process.stderr.write(lines.slice(shown).join("\n") + "\n");
      shown = lines.length;
    }
    if (finished || Date.now() > deadline) break;
  }
  const text = await browser.evaluate("window.__check.text");
  if (!finished) console.log(`(gave up waiting after ${PATIENCE / 1000} s)`);
  if (outFile !== null) writeFileSync(outFile, text + "\n");
  else process.stdout.write(text + "\n");
  const result = await browser.evaluate("window.__check.result");
  if (jsonFile !== null) writeFileSync(jsonFile, JSON.stringify(result, null, 2) + "\n");
  ok = finished && result.ok === true;
} finally {
  await browser.close();
}
process.exit(ok ? 0 : 1);
