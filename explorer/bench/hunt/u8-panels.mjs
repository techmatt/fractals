// U8 — the two surfaces the other units only pass through: the Saved panel's own
// buttons, and the Julia preview under the pointer.
//
// usage: node explorer/bench/hunt/u8-panels.mjs [debugPort] [sitePort]
import { mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { record } from "../output.mjs";
import { fileURLToPath } from "node:url";
import { Page, SITE, say, sleep } from "./lib.mjs";

const debug = Number(process.argv[2] ?? 9480);
const port = Number(process.argv[3] ?? SITE);
const DOWNLOADS = fileURLToPath(new URL("../../../artifacts/hunt/downloads-u8/", import.meta.url));
rmSync(DOWNLOADS, { recursive: true, force: true });
mkdirSync(DOWNLOADS, { recursive: true });

const page = await new Page({ debug, port }).start();
const findings = [];
const rows = [];

const HOME = "v=3&f=mandelbrot&x=-0.5&y=0&w=3&p=twilight_shifted";
const note = (name, why) => findings.push({ name, why });

async function check(name, fn) {
  const row = { name };
  try {
    Object.assign(row, (await fn()) ?? {});
    const alive = await page.ev(`!document.getElementById('studio').hidden`);
    if (alive !== true) note(name, "the studio is gone");
  } catch (e) {
    row.threw = String(e.message).slice(0, 200);
    note(name, row.threw);
  }
  const said = page.drain();
  if (said.length) {
    row.console = said;
    note(name, `console: ${said.join(" | ").slice(0, 300)}`);
  }
  rows.push(row);
  say(`  ${name}: ${JSON.stringify(row).slice(0, 200)}`);
}

// ------------------------------------------------------------------- Saved panel

say("U8: the Saved panel");
await page.open(`?${HOME}`, { settle: 1500 });
await page.settled(120);
await page.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: DOWNLOADS, eventsEnabled: true });

const savedCount = () => page.ev(`document.querySelectorAll('#saved-tiles .tile').length`);
const openSaved = async () => {
  await page.ev(`document.getElementById('tab-saved').click()`);
  await sleep(500);
};

await check("save six pictures from the studio", async () => {
  for (let i = 0; i < 6; i++) {
    await page.ev(`document.getElementById('view-palette').click()`);
    await sleep(700);
    await page.ev(`document.getElementById('save-view').click()`);
    await sleep(300);
  }
  await openSaved();
  return { tiles: await savedCount(), said: await page.ev(`document.getElementById('saved-count')?.textContent`) };
});

await check("export, and what it hands back", async () => {
  const text = await page.ev(`(async () => {
    const b = document.getElementById('saved-export');
    if (!b) return null;
    b.click();
    await new Promise((r) => setTimeout(r, 800));
    return document.getElementById('saved-progress')?.textContent ?? '';
  })()`);
  return { said: text, files: readdirSync(DOWNLOADS) };
});

await check("copy the list", async () => {
  await page.send("Browser.grantPermissions", { permissions: ["clipboardReadWrite", "clipboardSanitizedWrite"] }).catch(() => {});
  await page.ev(`document.getElementById('saved-copy')?.click()`);
  await sleep(500);
  return { said: await page.ev(`document.getElementById('saved-progress')?.textContent`) };
});

await check("import: three good links pasted", async () => {
  const before = await savedCount();
  await page.ev(`(() => {
    document.getElementById('saved-import').click();
    document.getElementById('saved-paste').value = [
      'v=3&f=mandelbrot&x=-0.5&y=0&w=3&p=viridis',
      'v=3&f=multibrot3&x=0&y=0&w=3&p=magma',
      'http://localhost:${port}/explorer/?v=3&f=julia&cx=-0.4&cy=0.6&p=inferno',
    ].join('\\n');
    document.getElementById('saved-import-go').click();
    return true;
  })()`);
  await sleep(1500);
  const after = await savedCount();
  if (after <= before) note("import good links", `count did not rise: ${before} -> ${after}`);
  return { before, after, said: await page.ev(`document.getElementById('saved-progress')?.textContent`) };
});

await check("import: junk pasted", async () => {
  const before = await savedCount();
  await page.ev(`(() => {
    document.getElementById('saved-paste').value = 'not a link\\n{]\\nv=99&f=nope\\n' + 'x'.repeat(5000);
    document.getElementById('saved-import-go').click();
    return true;
  })()`);
  await sleep(1500);
  const after = await savedCount();
  const said = await page.ev(`document.getElementById('saved-progress')?.textContent + ' | ' + (document.getElementById('saved-warning')?.textContent ?? '')`);
  if (after > before) note("import junk", `junk was taken as ${after - before} pictures`);
  if (!said || !said.trim() || said.trim() === "|") note("import junk", "junk was refused in silence");
  return { before, after, said: String(said).slice(0, 140) };
});

await check("import: two megabytes of nothing", async () => {
  const before = await savedCount();
  await page.ev(`(() => {
    document.getElementById('saved-paste').value = 'q'.repeat(2 * 1024 * 1024);
    document.getElementById('saved-import-go').click();
    return true;
  })()`, 60000);
  await sleep(2500);
  return { before, after: await savedCount() };
});

await check("import from a file", async () => {
  const path = fileURLToPath(new URL("./import.json", import.meta.url));
  writeFileSync(path, JSON.stringify({ v: 1, items: [{ link: "v=3&f=multibrot5&x=0&y=0&w=3&p=plasma", added: 1 }] }));
  const before = await savedCount();
  const node = await page.send("DOM.getDocument", { depth: -1 });
  const found = await page.send("DOM.querySelector", { nodeId: node.result.root.nodeId, selector: "#saved-file" });
  await page.send("DOM.setFileInputFiles", { files: [path], nodeId: found.result.nodeId });
  await sleep(2000);
  return { before, after: await savedCount() };
});

await check("Download all, in each format", async () => {
  const out = [];
  for (const fmt of await page.ev(`[...document.getElementById('saved-format').options].map((o) => o.value)`)) {
    // By modification time and not by name: the two formats' zips share a name, and
    // Chrome overwrites the first with the second, which read as "wrote nothing". And
    // only a zip: a fresh profile's component updater drops a `.htm` CRX in the same
    // folder, which read as the JPEG run's file.
    const stamp = (f) => statSync(`${DOWNLOADS}${f}`).mtimeMs;
    const before = new Map(readdirSync(DOWNLOADS).map((f) => [f, stamp(f)]));
    await page.ev(`(() => { const s = document.getElementById('saved-format'); s.value = ${JSON.stringify(fmt)};
      s.dispatchEvent(new Event('change', { bubbles: true })); document.getElementById('saved-download').click(); })()`);
    let file = null;
    for (let i = 0; i < 300 && !file; i++) {
      await sleep(500);
      file = readdirSync(DOWNLOADS).find(
        (f) => f.endsWith(".zip") && before.get(f) !== stamp(f),
      );
    }
    out.push({ fmt, file });
    if (!file) note("Download all", `${fmt} wrote nothing in 150 s`);
  }
  return { out };
});

await check("Clear all, then the panel is empty and says so", async () => {
  await page.ev(`document.getElementById('saved-clear').click()`);
  await sleep(1200);
  const tiles = await savedCount();
  const empty = await page.ev(`!document.getElementById('saved-empty').hidden`);
  if (tiles !== 0) note("clear all", `${tiles} tiles survived Clear all`);
  return { tiles, empty };
});

await check("the panel after a reload", async () => {
  await page.open(`?${HOME}`, { settle: 1500 });
  await openSaved();
  return { tiles: await savedCount() };
});

// --------------------------------------------------------------- the Julia preview

say("U8: the Julia preview under the pointer");
await page.open(`?${HOME}`, { settle: 1500 });
await page.settled(120);
// **The preview is off until a tab switches it on** (explorer_ui_text_ckpt139), and the
// switch is the tab's sessionStorage, so it is set here by state rather than toggled: a
// click that assumed it started on is how this unit came to report the card coming up
// with the switch off, when the click had just turned it on.
const preview = (on) => page.ev(`(() => { const t = document.getElementById('julia-preview-on');
  if (t.checked !== ${on}) t.click(); return t.checked; })()`);
await preview(true);
const box = await page.ev(`(() => { const r = document.getElementById('canvas').getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height }; })()`);
const move = (x, y) => page.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });

await check("the pointer swept across the plane, fast", async () => {
  for (let i = 0; i < 80; i++) {
    await move(box.x + (i * 13) % box.w, box.y + (i * 7) % box.h);
  }
  await sleep(1200);
  return {
    shown: await page.ev(`!document.getElementById('julia-preview').hidden`),
    said: await page.ev(`document.getElementById('julia-preview-c')?.textContent?.slice(0, 60)`),
  };
});

await check("the pointer parked, then off the canvas", async () => {
  await move(box.x + box.w / 2, box.y + box.h / 2);
  await sleep(1500);
  const on = await page.ev(`!document.getElementById('julia-preview').hidden`);
  await move(5, 5);
  await sleep(900);
  const off = await page.ev(`!document.getElementById('julia-preview').hidden`);
  if (on && off) note("julia preview", "the card stayed up with the pointer off the canvas");
  return { on, off };
});

await check("the preview during a slow render", async () => {
  await page.open(`?${HOME}&m=stripe`, { settle: 200 });
  for (let i = 0; i < 30; i++) await move(box.x + 100 + i * 7, box.y + 100);
  await sleep(1000);
  const shown = await page.ev(`!document.getElementById('julia-preview').hidden`);
  await page.settled(300);
  return { shownMidRender: shown };
});

await check("the preview switched off and on again", async () => {
  await page.open(`?${HOME}`, { settle: 1200 });
  await page.ev(`document.getElementById('details').open = true`);
  await preview(false);
  await sleep(300);
  for (let i = 0; i < 20; i++) await move(box.x + 200 + i * 5, box.y + 150);
  await sleep(900);
  const offShown = await page.ev(`!document.getElementById('julia-preview').hidden`);
  if (offShown) note("julia preview", "the card came up with the switch off");
  await preview(true);
  await sleep(300);
  for (let i = 0; i < 20; i++) await move(box.x + 200 + i * 5, box.y + 150);
  await sleep(1200);
  return { offShown, onShown: await page.ev(`!document.getElementById('julia-preview').hidden`) };
});

await check("a click on the preview is the way in", async () => {
  const before = (await page.state()).url;
  await move(box.x + box.w * 0.35, box.y + box.h * 0.5);
  await sleep(1200);
  await page.send("Input.dispatchMouseEvent", { type: "mousePressed", x: box.x + box.w * 0.35, y: box.y + box.h * 0.5, button: "left", clickCount: 1 });
  await page.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: box.x + box.w * 0.35, y: box.y + box.h * 0.5, button: "left", clickCount: 1 });
  await sleep(2000);
  await page.settled(200);
  const after = await page.state();
  return { before: before?.slice(0, 60), after: after.url?.slice(0, 70), moved: after.url !== before };
});

await check("the preview on a dynamical plane, where there is no c to take", async () => {
  await page.open("?v=3&f=julia&cx=-0.4&cy=0.6&p=twilight_shifted", { settle: 1500 });
  for (let i = 0; i < 30; i++) await move(box.x + 150 + i * 6, box.y + 150);
  await sleep(1200);
  return { shown: await page.ev(`!document.getElementById('julia-preview').hidden`) };
});

record("hunt-u8.json", { rows, findings });
say(`U8 done: ${findings.length} findings`);
for (const f of findings) say("  FINDING", f.name, "—", f.why);
await page.stop();
