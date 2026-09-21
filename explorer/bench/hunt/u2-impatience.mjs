// U2 — the impatient visitor, and the seams between tabs.
//
// Every burst ends with the same three questions: did the console say anything, is the
// state machine consistent, and **does the canvas match the address bar**. That last one
// is asked with a second browser — a verifier page that opens what the first page's
// address bar settled to — because reopening in the page under test would destroy the
// state the burst just built.
//
// usage: node explorer/bench/hunt/u2-impatience.mjs [debugPort]
import { record } from "../output.mjs";
import { Page, SITE, say, sleep } from "./lib.mjs";

const debug = Number(process.argv[2] ?? 9420);
const page = await new Page({ debug, port: SITE }).start();
const verifier = await new Page({ debug: debug + 1, port: SITE }).start();

const findings = [];
const rows = [];

const HOME = "v=3&f=mandelbrot&x=-0.5&y=0&w=3&p=twilight_shifted";
/** A frame with structure in it, so a wrong picture is visible rather than flat. */
const BUSY = "v=3&f=multibrot4&x=0.3190049359670787&y=0.7493803355819899&w=0.00000030536169435018664&p=pink&mirror=1";
const DEEP =
  "dv=2&x=-0.74501772828532335842941892835857434&y=0.14993443275456819177805709088257971" +
  "&w=2e-11&n=48551&p=twilight_shifted&panel=deep";

const mouse = (type, x, y, extra = {}) =>
  page.send("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1, ...extra });
const key = (type, k, extra = {}) =>
  page.send("Input.dispatchKeyEvent", { type, key: k, ...extra });
const wheel = (x, y, dy) =>
  page.send("Input.dispatchMouseEvent", { type: "mouseWheel", x, y, deltaX: 0, deltaY: dy });

/** Where the canvas is, in page coordinates. */
async function canvasBox() {
  return page.ev(`(() => {
    const r = document.getElementById('canvas').getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, h: r.height };
  })()`);
}

/** 500 quarter-second polls is just over two minutes. Forty wheel notches in lands on
 *  a frame whose final 4x pass alone is 17.6 s here, and the first run of this unit
 *  called three settled pages unsettled at a fifty-second limit. */
async function burst(name, fn, { verify = true, settleLimit = 500 } = {}) {
  const row = { name };
  try {
    await fn();
    row.settled = await page.settled(settleLimit);
    const s = await page.state();
    row.url = s.url;
    row.dot = s.dot;
    row.tab = s.tab;
    row.noticeUp = s.noticeUp;
    if (!row.settled) findings.push({ name, why: `never settled: dot ${s.dot}, stats ${s.stats}` });
    if (s.noticeUp) findings.push({ name, why: `a burst left a refusal up: ${s.said}` });
    if (verify && !s.noticeUp && s.url) {
      const hash = await page.canvasHash();
      await verifier.open(`?${s.url}`, { settle: 900 });
      await verifier.settled(120);
      const v = await verifier.state();
      const vhash = await verifier.canvasHash();
      row.match = hash === vhash;
      if (v.url !== s.url) {
        findings.push({ name, why: `address bar is not a fixed point: ${s.url} -> ${v.url}` });
      } else if (hash && vhash && hash !== vhash) {
        findings.push({ name, why: `canvas does not match its own link (${hash} vs ${vhash})` });
      }
      const vsaid = verifier.drain();
      if (vsaid.length) findings.push({ name, why: `verifier console: ${vsaid.join(" | ").slice(0, 200)}` });
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
  say(`  ${name}: settled=${row.settled} dot=${row.dot} match=${row.match ?? "-"}${row.threw ? ` THREW ${row.threw}` : ""}`);
}

// ------------------------------------------------------------------ the gestures

say("U2: gestures");
await page.open(`?${HOME}`);
await page.settled(80);
const box = await canvasBox();

await burst("40 wheel notches down", async () => {
  for (let i = 0; i < 40; i++) await wheel(box.x, box.y, -120);
});
await burst("40 wheel notches up", async () => {
  for (let i = 0; i < 40; i++) await wheel(box.x, box.y, 120);
});
await burst("wheel storm alternating", async () => {
  for (let i = 0; i < 60; i++) await wheel(box.x + (i % 7) * 10, box.y, i % 2 ? 120 : -120);
});
await burst("a drag across the canvas", async () => {
  await mouse("mousePressed", box.x - 100, box.y - 60);
  for (let i = 0; i < 20; i++) await mouse("mouseMoved", box.x - 100 + i * 10, box.y - 60 + i * 5);
  await mouse("mouseReleased", box.x + 100, box.y + 40);
});
await burst("a drag that never releases, then one that does", async () => {
  await mouse("mousePressed", box.x, box.y);
  for (let i = 0; i < 10; i++) await mouse("mouseMoved", box.x + i * 8, box.y);
  await mouse("mousePressed", box.x - 50, box.y - 50);
  await mouse("mouseReleased", box.x - 50, box.y - 50);
});
await burst("triple click on the canvas", async () => {
  for (const n of [1, 2, 3]) {
    await mouse("mousePressed", box.x, box.y, { clickCount: n });
    await mouse("mouseReleased", box.x, box.y, { clickCount: n });
  }
});
await burst("50 arrow keys held down", async () => {
  for (let i = 0; i < 50; i++) {
    await key("keyDown", "ArrowRight", { autoRepeat: i > 0, windowsVirtualKeyCode: 39 });
  }
  await key("keyUp", "ArrowRight", { windowsVirtualKeyCode: 39 });
});
await burst("60 zoom-in keys to the f64 wall", async () => {
  for (let i = 0; i < 60; i++) {
    await key("keyDown", "+", { text: "+", windowsVirtualKeyCode: 187 });
    await key("keyUp", "+", { windowsVirtualKeyCode: 187 });
  }
}, { settleLimit: 500 });
await burst("and 60 back out", async () => {
  for (let i = 0; i < 60; i++) {
    await key("keyDown", "-", { text: "-", windowsVirtualKeyCode: 189 });
    await key("keyUp", "-", { windowsVirtualKeyCode: 189 });
  }
}, { settleLimit: 500 });

// ------------------------------------------------------------------ the controls

say("U2: controls hammered");
await page.open(`?${BUSY}`);
await page.settled(80);

await burst("every view toggle, twice each, fast", async () => {
  await page.ev(`(() => {
    for (const id of ['view-whole', 'view-julia', 'view-palette', 'view-phase', 'view-seat']) {
      const b = document.getElementById(id);
      if (b && !b.disabled) { b.click(); b.click(); }
    }
    return true;
  })()`);
});
await burst("the mode select swept through every option", async () => {
  await page.ev(`(async () => {
    const sel = document.getElementById('mode');
    for (const o of [...sel.options]) {
      sel.value = o.value;
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 40));
    }
    return sel.value;
  })()`, 60000);
}, { settleLimit: 500 });
await burst("every number box fed junk", async () => {
  await page.ev(`(() => {
    const out = [];
    for (const input of document.querySelectorAll('input.param[type="number"], input.constant')) {
      for (const junk of ['abc', '-1', '1e400', 'NaN', '', '0']) {
        input.value = junk;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      }
      out.push(input.id || input.name || '?');
    }
    return out;
  })()`);
});
await burst("every range dragged to both ends", async () => {
  await page.ev(`(() => {
    const out = [];
    for (const r of document.querySelectorAll('input[type="range"]')) {
      for (const v of [r.min, r.max, r.min, String(Number(r.max) * 10), '-999']) {
        r.value = v;
        r.dispatchEvent(new Event('input', { bubbles: true }));
        r.dispatchEvent(new Event('change', { bubbles: true }));
      }
      out.push(r.id);
    }
    return out;
  })()`);
}, { settleLimit: 500 });
await burst("palette reset then eight palettes in a row", async () => {
  await page.ev(`(async () => {
    document.getElementById('palette-reset')?.click();
    const swatches = [...document.querySelectorAll('#palette-list [role="option"], #palette-list button')].slice(0, 8);
    for (const s of swatches) { s.click(); await new Promise((r) => setTimeout(r, 30)); }
    return swatches.length;
  })()`, 60000);
}, { settleLimit: 500 });

// ------------------------------------------------------------------ the seams

say("U2: tab seams");
await burst("five tab switches as fast as they go", async () => {
  await page.ev(`(() => {
    for (const id of ['tab-walk', 'tab-deep', 'tab-saved', 'tab-atlas', 'tab-gallery']) {
      document.getElementById(id).click();
    }
    return true;
  })()`);
});
await burst("a slow mode started, then the tabs churned under it", async () => {
  await page.open(`?${BUSY.replace("&mirror=1", "")}&m=stripe`, { settle: 100 });
  await page.ev(`(() => {
    for (const id of ['tab-walk', 'tab-deep', 'tab-saved', 'tab-gallery']) document.getElementById(id).click();
    return true;
  })()`);
}, { settleLimit: 500 });
await burst("a walk started and the tab left immediately", async () => {
  await page.ev(`document.getElementById('tab-walk').click()`);
  await sleep(300);
  await page.ev(`document.getElementById('walk-start').click()`);
  await sleep(600);
  await page.ev(`document.getElementById('tab-deep').click()`);
  await sleep(400);
  await page.ev(`document.getElementById('tab-walk').click()`);
  await sleep(400);
  // Stop it if it is still going: a walk left running poisons every later burst.
  await page.ev(`(() => { const b = document.getElementById('walk-start'); if (b.textContent !== 'Start') b.click(); return b.textContent; })()`);
}, { verify: false, settleLimit: 500 });
await burst("deep: render started and cancelled at three different moments", async () => {
  await page.open(`?${DEEP}`, { settle: 1500 });
  await page.settled(200);
  for (const wait of [200, 1200, 3000]) {
    await page.ev(`document.getElementById('deep-render').click()`);
    await sleep(wait);
    await page.ev(`(() => { const b = document.getElementById('deep-render'); if (b.textContent === 'Cancel') b.click(); return b.textContent; })()`);
    await sleep(500);
  }
}, { verify: false, settleLimit: 500 });
await burst("deep: the tab left mid-render and come back", async () => {
  await page.ev(`document.getElementById('deep-render').click()`);
  await sleep(900);
  await page.ev(`document.getElementById('tab-gallery').click()`);
  await sleep(600);
  await page.ev(`document.getElementById('tab-deep').click()`);
  await sleep(600);
  await page.ev(`(() => { const b = document.getElementById('deep-render'); if (b.textContent === 'Cancel') b.click(); return b.textContent; })()`);
}, { verify: false, settleLimit: 500 });
await burst("deep: minibrot search started and the tab left", async () => {
  await page.ev(`document.getElementById('deep-minibrots').click()`);
  await sleep(700);
  await page.ev(`document.getElementById('tab-saved').click()`);
  await sleep(500);
  await page.ev(`document.getElementById('tab-deep').click()`);
}, { verify: false, settleLimit: 600 });

// ------------------------------------------------------------ the window itself

say("U2: the window");
await page.open(`?${BUSY}`, { settle: 200 });
await burst("resized four times during a render", async () => {
  for (const [w, h] of [[900, 700], [1920, 1080], [700, 1200], [1600, 1100]]) {
    await page.send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: false });
    await sleep(250);
  }
}, { settleLimit: 500 });
await burst("hidden and restored during a render", async () => {
  await page.open(`?${BUSY}&m=stripe`, { settle: 100 });
  await page.ev(`Object.defineProperty(document, 'visibilityState', { get: () => 'hidden', configurable: true });
                 document.dispatchEvent(new Event('visibilitychange'))`);
  await sleep(1500);
  await page.ev(`Object.defineProperty(document, 'visibilityState', { get: () => 'visible', configurable: true });
                 document.dispatchEvent(new Event('visibilitychange'))`);
}, { settleLimit: 500 });
await burst("a tiny window", async () => {
  await page.send("Emulation.setDeviceMetricsOverride", { width: 380, height: 420, deviceScaleFactor: 1, mobile: false });
  await page.open(`?${HOME}`, { settle: 900 });
}, { verify: false, settleLimit: 200 });
await burst("a very wide, very short window", async () => {
  await page.send("Emulation.setDeviceMetricsOverride", { width: 2400, height: 300, deviceScaleFactor: 1, mobile: false });
  await page.open(`?${HOME}`, { settle: 900 });
}, { verify: false, settleLimit: 200 });
await page.send("Emulation.setDeviceMetricsOverride", { width: 1600, height: 1100, deviceScaleFactor: 1, mobile: false });

// -------------------------------------------------- one action before the last settles

say("U2: overlapping actions");
await burst("navigate, change mode, change palette, pan — with no waiting at all", async () => {
  await page.open(`?${BUSY}`, { settle: 0 });
  await page.ev(`(() => {
    const sel = document.getElementById('mode');
    sel.value = 'smooth_stripe'; sel.dispatchEvent(new Event('change', { bubbles: true }));
    const s = document.querySelector('#palette-list [role="option"], #palette-list button');
    s?.click();
    document.getElementById('view-phase')?.click();
    return true;
  })()`);
  await mouse("mousePressed", box.x, box.y);
  await mouse("mouseMoved", box.x + 120, box.y + 40);
  await mouse("mouseReleased", box.x + 120, box.y + 40);
}, { settleLimit: 500 });

record("hunt-u2.json", { rows, findings });
say(`U2 done: ${findings.length} findings`);
for (const f of findings) say("  FINDING", f.name, "—", f.why);
await page.stop();
await verifier.stop();
