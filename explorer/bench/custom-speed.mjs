// What a custom mode costs in the served page: the screen's pass, stage by stage, and a
// 1280x800 2×2 download (item 026's speed frame), each mode at its first example.
//
//   node explorer/bench/custom-speed.mjs <base url> <out.jsonl> [--workers n] [--modes a,b,c]
//                                        [--no-switch] [--no-download] [--verify] [--port n]
//
// `--workers` holds the page's pool (default: the page's own, half the machine's threads);
// `--modes` takes public or style names (default: every mode). One line per mode: the screen
// grid, the preview, the preview-balanced tiles, the exact measure, the exact tiles and the
// whole pass in seconds (time to the first full exact frame), then a palette switch to the
// set's next swatch (`switch`, the pass; `switch_wall`, click to picture), and the
// download's seconds. `--verify` then opens the switched link afresh and says whether the
// canvas is the same bytes (`switch_same_as_fresh`: a recolour is the fresh measure's
// picture). `--port` is Chrome's debugging port. A reading on a busy machine is
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
const switching = !args.includes("--no-switch");
const downloading = !args.includes("--no-download");
const verifying = args.includes("--verify");

const browser = await open({ port: Number(option("--port", "9434")), width: 1600, height: 1000 });
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
  if (pass.timing.recoloured !== undefined) row.recoloured = pass.timing.recoloured;
  // A palette switch: the first swatch of the set not drawn yet, from click to the exact
  // picture, read off the page's own pass (a mode with a set of one has none).
  const swatch = `document.querySelector('.custom-swatch:not(.is-chosen)')`;
  if (switching && (await browser.evaluate(`${swatch} !== null && !${swatch}.closest('[hidden]')`))) {
    row.switch_to = await browser.evaluate(`${swatch}.dataset.palette`);
    const clicked = Date.now();
    await browser.evaluate(`(globalThis.__customTimings = [], ${swatch}.click())`);
    await browser.until(`(globalThis.__customTimings ?? []).length > 0`, { within: 1800000, every: 200 });
    const [after] = await browser.evaluate("globalThis.__customTimings");
    row.switch = seconds(after.timing.total);
    row.switch_wall = (Date.now() - clicked) / 1000;
    if (after.timing.recoloured !== undefined) row.switch_recoloured = after.timing.recoloured;
    if (verifying) {
      // The switched picture against a fresh load of the link it left: the canvas's bytes.
      const canvas = `(() => { const c = document.getElementById("canvas"); const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data; let h = 2166136261; for (let i = 0; i < d.length; i++) h = Math.imul(h ^ d[i], 16777619) >>> 0; return h; })()`;
      const switched = await browser.evaluate(canvas);
      const href = await browser.evaluate("location.href");
      await browser.send("Page.navigate", { url: href });
      await browser.until(`(globalThis.__customTimings ?? []).length > 0`, { within: 1800000, every: 200 });
      row.switch_same_as_fresh = switched === (await browser.evaluate(canvas));
    }
  }
  if (!downloading) {
    appendFileSync(out, `${JSON.stringify(row)}\n`);
    console.log(JSON.stringify(row));
    continue;
  }
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
