// Every custom mode's example locations, opened by their buttons in the served explorer and
// downloaded through the page's own Download row, for `custom-compare.py --png`.
//
//   node explorer/bench/custom-browser.mjs <base url> <out dir> [--size 640x400] [--only <mode>,…]
//                                          [--tier curated|lab] [--wait <seconds>]
//                                          [--workers <n>] [--port <debugging port>]
//
// **The page says when it is busy**: `#render-state` carries `data-busy` while a download
// holds the controls (`explorer.js`'s `setBusy`), and every press here waits for it to go,
// so a slow download is waited out however long it takes (frost-feather's Example was a
// whole-frame measure of about 12 min a worker on a loaded box at its old cap of 9062, 008;
// about 150 s for the whole download at 1000, two workers) and no press lands on
// a page that would ignore it. `--wait` is a ceiling on one download, none by default.
//
// Chooses each mode's tier in the mode select (`Custom` or `Custom (lab)`, `style.js`'s
// `TIERS`), picks the mode in the tier's own select, presses
// each Example button, and saves a PNG at `--size` with the row's default 2×2 samples: the
// whole path a reader's download takes, pool, tiles and encoder included. Each file lands
// as `<style>__<n>.png`, the numbering `style wasm-parity` uses next door. Also writes a
// screenshot of the page with the first example drawn (`page.png`) and `browser.jsonl`, a
// line per example with the seconds the download took and any console error.

import { mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync, appendFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { open, sleep } from "./cdp.mjs";
import { encode } from "../permalink.js";
import { TIERS, offeredExamples, tierOf } from "../style.js";

const args = process.argv.slice(2);
const [base, outArg] = args;
const out = resolve(outArg);
const option = (name, fallback) => {
  const at = args.indexOf(name);
  return at === -1 ? fallback : args[at + 1];
};
const [width, height] = option("--size", "640x400").split("x").map(Number);
const only = option("--only", null)?.split(",") ?? null;
const tierOnly = option("--tier", null);
const waitSeconds = Number(option("--wait", "Infinity"));
/** Whether the page holds no control for a download (`data-busy` absent). */
const idle = `document.getElementById("render-state").dataset.busy === undefined`;
const waitIdle = () => browser.until(idle, { within: waitSeconds * 1000, every: 500 });
const landing = join(out, "landing");
mkdirSync(landing, { recursive: true });

const bundle = JSON.parse(readFileSync(fileURLToPath(new URL("../custom-modes.json", import.meta.url)), "utf8"));
// `--port` names Chrome's debugging port; by default Chrome picks a free one (`cdp.mjs`'s
// `open`), so runs side by side never drive each other's page.
const browser = await open({ port: Number(option("--port", "0")), width: 1400, height: 900 });
const errors = [];
browser.on((message) => {
  if (message.method === "Runtime.exceptionThrown") errors.push(message.params.exceptionDetails?.exception?.description);
  if (message.method === "Runtime.consoleAPICalled" && message.params.type === "error") {
    errors.push(message.params.args.map((arg) => arg.value ?? arg.description).join(" "));
  }
});
await browser.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: landing });
// `--workers n` holds the page's custom pool to n, for a run beside other work.
const workers = Number(option("--workers", "0"));
if (workers > 0) {
  await browser.send("Page.addScriptToEvaluateOnNewDocument", { source: `globalThis.__customWorkers = ${workers};` });
}
// A run picked up where an earlier one stopped skips what it already saved.
const done = new Set(
  (() => {
    try {
      const lines = readFileSync(join(out, "browser.jsonl"), "utf8").split(/\r?\n/).filter(Boolean);
      return lines.map((line) => JSON.parse(line)).filter((row) => row.ok).map((row) => row.id);
    } catch {
      return [];
    }
  })(),
);
await browser.send("Page.navigate", { url: `${base}/explorer/?v=4&custom=${bundle.modes[0].name}` });
if (!(await browser.until(`document.querySelector("#custom-examples button") !== null`, { within: 60000 }))) {
  throw new Error("the custom mode's controls never appeared");
}

const set = (selector, value) =>
  browser.evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    el.value = ${JSON.stringify(String(value))};
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return el.value;
  })()`);

await set("#download-size", "custom");
await set("#download-width", width);
await set("#download-height", height);

/** The download that landed, once Chrome has finished it. **The landing directory is emptied
 *  before every press** (`empty`): a file left from the last one could be overwritten in place
 *  and never read as new (008: when every Example of a mode downloaded under one file name,
 *  two ember-streams downloads the page said it saved were missed). */
function empty() {
  for (const name of readdirSync(landing)) rmSync(join(landing, name), { force: true });
}

/** The file, once the page has let go of the controls: Chrome writes it a moment after the
 *  page hands it over, so a minute is ample. */
async function landed() {
  if (!(await waitIdle())) return null;
  for (let tries = 0; tries < 240; tries++) {
    const files = readdirSync(landing).filter((name) => name.endsWith(".png"));
    if (files.length > 0) return files[0];
    await sleep(250);
  }
  return null;
}

let screenshot = false;
for (const mode of bundle.modes) {
  if (only && !only.includes(mode.style) && !only.includes(mode.name)) continue;
  if (tierOnly && tierOf(mode) !== tierOnly) continue;
  // The tier's entry first: the custom select lists that tier's modes only.
  const tier = TIERS.find((each) => each.tier === tierOf(mode)).option;
  // **A busy page ignores both selects** (a download in flight locks every control; 008:
  // frost-feather and molten-folds drew gear-halo's view and timed out), so the switch
  // waits for `data-busy` to go, then retries until the mode is the view's.
  const switched = `new URLSearchParams(location.search).get("custom") === ${JSON.stringify(mode.name)}`;
  await waitIdle();
  // (011: on a loaded box, one switch from an idle page had not landed after 60 tries.)
  for (let tries = 0; tries < 600 && !(await browser.evaluate(switched)); tries++) {
    if ((await browser.evaluate(`document.getElementById("mode").value`)) !== tier) await set("#mode", tier);
    await set("#custom-mode", mode.name);
    await sleep(1000);
  }
  for (let index = 0; index < mode.shown.length; index++) {
    const id = `${mode.style}__${index}`;
    if (done.has(id) && screenshot) continue;
    const row = { id, mode: mode.name };
    errors.length = 0;
    // A keep whose button is not offered (it would draw another button's picture) is skipped.
    await waitIdle();
    const offered = await browser.evaluate(`(() => {
      const button = document.querySelector('#custom-examples button[data-example="${index}"]');
      if (button) button.click();
      return button !== null;
    })()`);
    if (!offered) {
      // Held to the bundle's own rule: a button the record offers and the page lacks is the
      // page's miss, not a skip (015 read one as "not offered" while two runs shared a page).
      const owed = offeredExamples(mode, encode).some((each) => each.index === index);
      const skipped = owed ? { ok: false, why: "the page lacks a button the bundle offers" } : { ok: true, skipped: "not offered" };
      appendFileSync(join(out, "browser.jsonl"), `${JSON.stringify({ ...row, ...skipped })}\n`);
      continue;
    }
    // The address bar is rewritten at most every 350 ms (`ADDRESS_MS`).
    await sleep(800);
    row.query = await browser.evaluate("location.search");
    // A press the page ignored leaves another mode's view up: a row of that would compare
    // the wrong picture, so it is refused here, by name.
    if (new URLSearchParams(row.query).get("custom") !== mode.name) {
      row.ok = false;
      row.why = "the page did not open the example (still busy?)";
      appendFileSync(join(out, "browser.jsonl"), JSON.stringify(row) + "\n");
      console.log(JSON.stringify(row));
      continue;
    }
    if (!screenshot) {
      // One look at the page itself: the first example, drawn on the screen to the end.
      await browser.until(`document.getElementById("render-state").dataset.state === "final"`, { within: 600000, every: 500 });
      const shot = await browser.send("Page.captureScreenshot", { format: "png" });
      writeFileSync(join(out, "page.png"), Buffer.from(shot.data, "base64"));
      screenshot = true;
    }
    // The row prices a custom view off a finished screen pass; until then it says so and
    // the buttons wait, so the harness presses once the row offers it.
    await browser.until(`!document.getElementById("download-png").disabled`, { within: 600000, every: 500 });
    empty();
    const started = Date.now();
    await browser.evaluate(`document.getElementById("download-png").click()`);
    const name = await landed();
    row.seconds = (Date.now() - started) / 1000;
    row.said = await browser.evaluate(`document.getElementById("status").textContent`);
    // The page's own file name, which names the family and the Example.
    row.file = name;
    if (name) renameSync(join(landing, name), join(out, `${id}.png`));
    row.ok = name !== null;
    row.errors = [...errors];
    appendFileSync(join(out, "browser.jsonl"), JSON.stringify(row) + "\n");
    console.log(JSON.stringify(row));
  }
}
await browser.close();
