// The GPU probe page, driven headless: what WebGPU adapter this machine's Chrome gets,
// whether double-single arithmetic survives its shader compilers, and the per-pixel
// kernel held to the model and timed on the bundles in `artifacts/gpu-probe/`.
//
//   node explorer/bench/gpu-probe.mjs                  # print the report
//   node explorer/bench/gpu-probe.mjs --out FILE       # and write it to FILE
//   node explorer/bench/gpu-probe.mjs --json FILE      # the structured result as well
//   node explorer/bench/gpu-probe.mjs --query "frames=random-dives_504&schemes=f32"
//   node explorer/bench/gpu-probe.mjs --patience 7200  # seconds to wait (default 5400)
//   node explorer/bench/gpu-probe.mjs --port 8001      # serve elsewhere than 8000
//   node explorer/bench/gpu-probe.mjs --headed         # a visible window
//
// `python -m builder serve` must be up. The page is `gpu-probe/index.html` beside this
// file; it does all the work and puts its report on `window.__probe`, so this harness only
// opens it, waits for `__probe.done`, and copies the text out. `--query` is handed to the
// page as its query string (`probe.js` lists what it reads). Chrome is started with its
// timestamp quantization off, so that a pass's GPU time is not rounded to 100 us. Like the
// rest of `bench/` it asserts nothing and always exits 0 once the page has answered.

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
const headless = !args.includes("--headed");
const search = option("--query");

/** Long enough for every frame, scheme and budget, three times over; #337 dominates. */
const PATIENCE = 1000 * Number(option("--patience") ?? 5400);

const url = `http://localhost:${port}/explorer/bench/gpu-probe/index.html${search ? `?${search}` : ""}`;
const browser = await open({
  port: 9431,
  headless,
  flags: ["--disable-dawn-features=timestamp_quantization"],
});
try {
  await browser.send("Page.navigate", { url });
  if (!(await browser.until("window.__probe !== undefined", { within: 30000 }))) {
    throw new Error(`the probe page never started at ${url}`);
  }
  // Polled rather than awaited in one evaluate, so that a long run shows its progress.
  const deadline = Date.now() + PATIENCE;
  let shown = 0;
  let finished = false;
  for (;;) {
    finished = await browser.evaluate(
      `Promise.race([window.__probe.done.then(() => true), new Promise((r) => setTimeout(() => r(false), 5000))])`,
    );
    const text = await browser.evaluate("window.__probe.text");
    const lines = text.split("\n");
    if (lines.length > shown) {
      process.stderr.write(lines.slice(shown).join("\n") + "\n");
      shown = lines.length;
    }
    if (finished || Date.now() > deadline) break;
  }
  const text = await browser.evaluate("window.__probe.text");
  if (!finished) console.log(`(gave up waiting for __probe.done after ${PATIENCE / 1000} s)`);
  if (outFile !== null) writeFileSync(outFile, text + "\n");
  else process.stdout.write(text + "\n");
  if (jsonFile !== null) {
    const result = await browser.evaluate("window.__probe.result");
    writeFileSync(jsonFile, JSON.stringify(result, null, 2) + "\n");
  }
} finally {
  await browser.close();
}
