// Drive Chrome over CDP (puppeteer-core) through every configuration of bench.html.
// Starts its own two servers (plain = what GitHub Pages gives; isolated = COOP/COEP).
// Usage: node web/browser-run.mjs [--tag label] [--headful] [--only render]
// Writes results/chrome-<ep>-<mode>-<set>-<variant>.json

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const LAB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const PY = path.join(LAB, ".venv", "Scripts", "python.exe");
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
};
const tag = arg("tag", "");
const only = arg("only", "");

const servers = [
  spawn(PY, [path.join(LAB, "lab", "serve.py"), "8731"], { stdio: "ignore" }),
  spawn(PY, [path.join(LAB, "lab", "serve.py"), "8732", "--isolated"], { stdio: "ignore" }),
];
await new Promise((r) => setTimeout(r, 1500));

// mode: how the page is served and threaded. "st" = plain server, 1 thread (Pages);
// "mt" = isolated server, ORT's default thread count.
const configs = [];
for (const set of ["render", "fine3", "fused"]) {
  for (const variant of ["fp32", "fp16", "fp16w"]) {
    configs.push({ ep: "webgpu", mode: "st", set, variant });
    configs.push({ ep: "wasm", mode: "st", set, variant });
    configs.push({ ep: "wasm", mode: "mt", set, variant });
  }
}
// End-to-end: the browser's own JPEG decode + the PIL port, into the gate.
configs.push({ ep: "webgpu", mode: "st", set: "render", variant: "fp32", source: "js" });
configs.push({ ep: "webgpu", mode: "st", set: "fused", variant: "fp32", source: "js" });

const launch = () =>
  puppeteer.launch({
    executablePath: CHROME,
    headless: process.argv.includes("--headful") ? false : "new",
    args: ["--enable-unsafe-webgpu", "--enable-gpu", "--ignore-gpu-blocklist", "--no-first-run"],
    protocolTimeout: 600000,
  });
fs.mkdirSync(path.join(LAB, "results"), { recursive: true });

for (const c of configs) {
  if (only && c.set !== only) continue;
  const name = `chrome-${c.ep}-${c.mode}-${c.set}-${c.variant}${c.source ? "-prepjs" : ""}`;
  const port = c.mode === "mt" ? 8732 : 8731;
  const threads = c.mode === "st" ? 1 : 0;
  const url =
    `http://127.0.0.1:${port}/web/bench.html?set=${c.set}&variant=${c.variant}&ep=${c.ep}` +
    `&threads=${threads}&prep=${c.source ?? "pil"}`;
  // A fresh browser (so a fresh temporary profile) per configuration: no HTTP cache, no
  // compiled wasm, no GPU shader cache carried over — so create_ms and first_run_ms are cold.
  const browser = await launch();
  const page = await browser.newPage();
  let result;
  try {
    await page.goto(url);
    await page.waitForFunction("window.__result !== undefined", { timeout: 600000, polling: 250 });
    result = await page.evaluate("window.__result");
  } catch (e) {
    result = { error: String(e?.message ?? e).slice(0, 300) };
  }
  await browser.close();
  Object.assign(result, { ...c, tag, url, set: c.set, variant: c.variant, ep: c.ep });
  fs.writeFileSync(path.join(LAB, "results", `${name}.json`), JSON.stringify(result));
  if (result.error) console.log(`${name.padEnd(40)} FAILED: ${result.error}`);
  else
    console.log(
      `${name.padEnd(40)} thr ${result.threads} create ${result.create_ms.toFixed(0)}ms  ` +
        `first ${result.first_run_ms.toFixed(0)}ms  b1 ${result.warm_b1.median_ms.toFixed(1)}ms  ` +
        `b8 ${result.warm_bN.per_image_ms.toFixed(1)}ms/img` +
        (result.prep ? `  prep diff bytes ${result.prep.differing_bytes} max ${result.prep.max_byte_diff}` : ""),
    );
}

for (const s of servers) s.kill();
