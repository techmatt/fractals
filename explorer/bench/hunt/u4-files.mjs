// U4 — files dropped in, and files taken out.
//
// The drop half builds its files **in the page** — canvas to blob to `File`, stamped
// through the page's own `stamp.js` — and dispatches a real `DataTransfer`, which is the
// route `scratch/drop-probe.html` already established on this box. The download half
// takes the file Chrome actually writes, reads the stamp back out of the bytes in node,
// and reopens the link to see whether the picture comes back.
//
// usage: node explorer/bench/hunt/u4-files.mjs [debugPort]
import { mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { record } from "../output.mjs";
import { fileURLToPath } from "node:url";
import { Page, SITE, say, sleep } from "./lib.mjs";
import { linkIn } from "../../stamp.js";

const debug = Number(process.argv[2] ?? 9440);
const DOWNLOADS = fileURLToPath(new URL("../../../artifacts/hunt/downloads/", import.meta.url));
rmSync(DOWNLOADS, { recursive: true, force: true });
mkdirSync(DOWNLOADS, { recursive: true });

const page = await new Page({ debug, port: SITE }).start();
const findings = [];
const rows = [];

const BUSY = "v=3&f=multibrot4&x=0.3190049359670787&y=0.7493803355819899&w=0.00000030536169435018664&p=pink&mirror=1";
const HOME = "v=3&f=mandelbrot&x=-0.5&y=0&w=3&p=twilight_shifted";

// ------------------------------------------------------------------ dropping files

/** Build a file in the page and drop it where `target` says. `kind` picks what it is. */
async function drop(kind, target, { count = 1 } = {}) {
  return page.ev(`(async () => {
    const { stamp } = await import('./stamp.js');
    const LINK = ${JSON.stringify(BUSY)};
    async function picture(type) {
      const c = document.createElement('canvas');
      c.width = 64; c.height = 36;
      const ink = c.getContext('2d', { alpha: false });
      ink.fillStyle = '#204060'; ink.fillRect(0, 0, 64, 36);
      ink.fillStyle = '#e0b040'; ink.fillRect(8, 8, 20, 12);
      return await new Promise((r) => c.toBlob(r, type, 0.9));
    }
    const make = {
      'stamped-png': async () => new File([await stamp(await picture('image/png'), 'image/png', LINK)], 'a.png', { type: 'image/png' }),
      'stamped-jpeg': async () => new File([await stamp(await picture('image/jpeg'), 'image/jpeg', LINK)], 'a.jpg', { type: 'image/jpeg' }),
      'plain-png': async () => new File([await picture('image/png')], 'plain.png', { type: 'image/png' }),
      'text': async () => new File(['not a picture at all'], 'notes.txt', { type: 'text/plain' }),
      'json': async () => new File(['{"link":"v=3"}'], 'list.json', { type: 'application/json' }),
      'empty': async () => new File([], 'empty.png', { type: 'image/png' }),
      'huge': async () => new File([new Uint8Array(50 * 1024 * 1024)], 'huge.png', { type: 'image/png' }),
      'truncated-png': async () => {
        const b = new Uint8Array(await (await stamp(await picture('image/png'), 'image/png', LINK)).arrayBuffer());
        return new File([b.slice(0, Math.floor(b.length / 2))], 'half.png', { type: 'image/png' });
      },
      'corrupt-stamp': async () => {
        const b = new Uint8Array(await (await stamp(await picture('image/png'), 'image/png', LINK)).arrayBuffer());
        // Find the keyword and break a byte inside the payload, leaving the chunk's CRC
        // claiming the original. A stamp nobody can trust must be refused, not guessed at.
        for (let i = 0; i < b.length - 4; i++) {
          if (b[i] === 0x76 && b[i + 1] === 0x3d && b[i + 2] === 0x33) { b[i + 2] = 0x39; break; }
        }
        return new File([b], 'bad.png', { type: 'image/png' });
      },
    };
    const files = [];
    for (let i = 0; i < ${count}; i++) files.push(await make[${JSON.stringify(kind)}]());
    const dt = new DataTransfer();
    for (const f of files) dt.items.add(f);
    const where = ${JSON.stringify(target)} === 'stage'
      ? document.getElementById('stage')
      : document.getElementById('panel-saved');
    where.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
    where.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
    return { dropped: files.length, bytes: files[0].size };
  })()`, 90000);
}

async function dropCase(kind, target, expect, { count = 1 } = {}) {
  const name = `drop ${kind} on ${target}${count > 1 ? ` x${count}` : ""}`;
  await page.open(`?${HOME}`, { settle: 900 });
  await page.settled(100);
  if (target === "saved") {
    await page.ev(`document.getElementById('tab-saved').click()`);
    await sleep(300);
  }
  const before = await page.state();
  const row = { name, expect };
  try {
    row.built = await drop(kind, target, { count });
    await sleep(2500);
    await page.settled(120);
    const after = await page.state();
    row.url = after.url;
    row.status = after.status;
    row.noticeUp = after.noticeUp;
    row.moved = after.url !== before.url;
    if (expect === "opens" && !row.moved) {
      findings.push({ name, why: `a stamped picture did not reopen: url stayed ${after.url.slice(0, 60)}` });
    }
    if (expect === "says no") {
      if (row.moved) findings.push({ name, why: `a file with no link in it moved the view to ${after.url.slice(0, 60)}` });
      if (!after.status) findings.push({ name, why: "a file that could not be used said nothing at all" });
    }
    // Whatever happened, the page must still be a page.
    const alive = await page.ev(`!!document.getElementById('canvas') && !document.getElementById('studio').hidden`);
    if (alive !== true) findings.push({ name, why: "the studio is gone after the drop" });
  } catch (e) {
    row.threw = String(e.message).slice(0, 200);
    findings.push({ name, why: row.threw });
  }
  const said = page.drain();
  if (said.length) {
    row.console = said;
    findings.push({ name, why: `console: ${said.join(" | ").slice(0, 300)}` });
  }
  rows.push(row);
  say(`  ${name}: moved=${row.moved} said=${JSON.stringify(row.status ?? "").slice(0, 70)}${row.threw ? ` THREW` : ""}`);
}

say("U4: drops");
await dropCase("stamped-png", "stage", "opens");
await dropCase("stamped-jpeg", "stage", "opens");
await dropCase("plain-png", "stage", "says no");
await dropCase("text", "stage", "says no");
await dropCase("json", "stage", "says no");
await dropCase("empty", "stage", "says no");
await dropCase("truncated-png", "stage", "says no");
await dropCase("corrupt-stamp", "stage", "says no");
await dropCase("stamped-png", "stage", "opens", { count: 3 });
await dropCase("huge", "stage", "says no");
await dropCase("stamped-png", "saved", "opens");
await dropCase("text", "saved", "says no");

// ------------------------------------------------------------------ downloads out

say("U4: downloads");
await page.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: DOWNLOADS, eventsEnabled: true });

async function downloadCase(link, button, size, { custom = null, deep = false } = {}) {
  const name = `download ${deep ? "deep " : ""}${button} at ${custom ? custom.join("x") : size}`;
  const row = { name };
  const before = new Set(readdirSync(DOWNLOADS));
  try {
    await page.open(`?${link}`, { settle: deep ? 1800 : 900 });
    await page.settled(deep ? 300 : 120);
    if (deep) {
      await page.ev(`document.getElementById('deep-render').click()`);
      await page.settled(400);
    }
    await page.ev(`(() => {
      const sel = document.getElementById('download-size');
      const want = [...sel.options].find((o) => o.textContent.includes(${JSON.stringify(size)}));
      if (want) { sel.value = want.value; sel.dispatchEvent(new Event('change', { bubbles: true })); }
      return sel.value;
    })()`);
    if (custom) {
      await page.ev(`(() => {
        const w = document.getElementById('download-width'), h = document.getElementById('download-height');
        w.value = ${custom[0]}; h.value = ${custom[1]};
        for (const el of [w, h]) { el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }
        return [w.value, h.value];
      })()`);
    }
    await page.ev(`document.getElementById('${button}').click()`);
    let file = null;
    for (let i = 0; i < 240 && !file; i++) {
      await sleep(500);
      file = readdirSync(DOWNLOADS).find((f) => !before.has(f) && !f.endsWith(".crdownload"));
    }
    if (!file) {
      findings.push({ name, why: "nothing was written in two minutes" });
      row.file = null;
    } else {
      row.file = file;
      const bytes = readFileSync(resolve(DOWNLOADS, file));
      row.bytes = bytes.length;
      const link2 = linkIn(new Uint8Array(bytes));
      row.stamp = link2 ? link2.slice(0, 90) : null;
      if (!link2) {
        findings.push({ name, why: "the downloaded file carries no link" });
      } else {
        // And the link in it opens the picture it is a picture of.
        const answered = await page.open(`?${link2}`, { settle: 1200 });
        if (answered !== "studio") findings.push({ name, why: `the link out of the file is refused: ${(await page.refused()).said}` });
      }
    }
  } catch (e) {
    row.threw = String(e.message).slice(0, 200);
    findings.push({ name, why: row.threw });
  }
  const said = page.drain();
  if (said.length) {
    row.console = said;
    findings.push({ name, why: `console: ${said.join(" | ").slice(0, 300)}` });
  }
  rows.push(row);
  say(`  ${name}: ${row.file ?? "nothing"} ${row.bytes ?? ""} stamp=${row.stamp ? "yes" : "no"}`);
}

await downloadCase(BUSY, "download-png", "1920");
await downloadCase(BUSY, "download-jpg", "1920");
await downloadCase(BUSY, "download-png", "2560");
await downloadCase(BUSY, "download-png", "Custom", { custom: [640, 400] });
await downloadCase(BUSY, "download-png", "Custom", { custom: [16, 16] });
await downloadCase(BUSY, "download-png", "Custom", { custom: [8192, 8192] });

// And the deep side, which renders through a different kernel and stamps through the
// deep contract — the one place a downloaded file could come back carrying a link the
// other reader would refuse.
const DEEP =
  "dv=2&x=-0.74501772828532335842941892835857434&y=0.14993443275456819177805709088257971" +
  "&w=2e-11&n=48551&p=twilight_shifted&panel=deep";
await downloadCase(DEEP, "download-png", "1920", { deep: true });
await downloadCase(DEEP, "download-jpg", "1920", { deep: true });

record("hunt-u4.json", { rows, findings });
say(`U4 done: ${findings.length} findings`);
for (const f of findings) say("  FINDING", f.name, "—", f.why);
await page.stop();
