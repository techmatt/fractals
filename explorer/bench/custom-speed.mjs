// What a custom mode costs in the served page: the screen's pass, stage by stage, and a
// 1280x800 2×2 download (item 026's speed frame), each mode at its first example.
//
//   node explorer/bench/custom-speed.mjs <base url> <out.jsonl> [--workers n] [--modes a,b,c]
//
// `--workers` holds the page's pool (default: the page's own, half the machine's threads);
// `--modes` takes public or style names (default: every mode). One line per mode: the screen
// grid, the preview, the preview-balanced tiles, the exact measure, the exact tiles and the
// whole pass in seconds, and the download's seconds. A reading on a busy machine is
// inflated; say so beside it.

import { appendFileSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { open, sleep } from "./cdp.mjs";

const args = process.argv.slice(2);
const [base, out] = args;
const option = (name, fallback) => {
  const at = args.indexOf(name);
  return at === -1 ? fallback : args[at + 1];
};
const workers = Number(option("--workers", "0"));
const bundle = JSON.parse(readFileSync(fileURLToPath(new URL("../custom-modes.json", import.meta.url)), "utf8"));
const wanted = option("--modes", null)?.split(",");
const modes = bundle.modes.filter((mode) => !wanted || wanted.includes(mode.name) || wanted.includes(mode.style));

const browser = await open({ port: 9434, width: 1600, height: 1000 });
if (workers > 0) {
  await browser.send("Page.addScriptToEvaluateOnNewDocument", { source: `globalThis.__customWorkers = ${workers};` });
}
await browser.send("Browser.setDownloadBehavior", { behavior: "deny" });
const seconds = (ms) => Math.round(ms) / 1000;

for (const mode of modes) {
  await browser.send("Page.navigate", { url: `${base}/explorer/?v=4&custom=${mode.name}` });
  await browser.until(`document.querySelector('#custom-examples button[data-example="0"]') !== null`, { within: 60000 });
  await sleep(500);
  await browser.evaluate(`(globalThis.__customTimings = [], document.querySelector('#custom-examples button[data-example="0"]').click())`);
  await browser.until(`(globalThis.__customTimings ?? []).length > 0`, { within: 1800000, every: 500 });
  const [pass] = await browser.evaluate("globalThis.__customTimings");
  const row = {
    mode: mode.name,
    style: mode.style,
    workers: pass.workers,
    screen: pass.size,
    preview: seconds(pass.timing.preview),
    sharpened: seconds(pass.timing.preview + pass.timing.sharpening),
    measure: seconds(pass.timing.measure),
    tiles: seconds(pass.timing.tiles),
    total: seconds(pass.timing.total),
  };
  // The 1280x800 2×2 download, through the row.
  await browser.evaluate(`(() => {
    const set = (id, value) => {
      const el = document.getElementById(id);
      el.value = value;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    };
    set("download-size", "custom");
    set("download-width", "1280");
    set("download-height", "800");
    document.getElementById("download-png").click();
  })()`);
  const started = Date.now();
  await browser.until(`/^Saved /.test(document.getElementById("status").textContent)`, { within: 1800000, every: 500 });
  row.download_1280x800 = (Date.now() - started) / 1000;
  appendFileSync(out, `${JSON.stringify(row)}\n`);
  console.log(JSON.stringify(row));
}
await browser.close();
