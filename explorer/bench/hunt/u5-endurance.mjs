// U5 — endurance, failed fetches, and storage that is not what the page left there.
//
// **The endurance leg never navigates.** A navigation is a fresh document and a fresh
// heap, so a session driven by reopening links would measure nothing: what accumulates,
// accumulates inside one document. So this is one page, several hundred in-page actions,
// sampled with a forced collection every twenty-five.
//
// usage: node explorer/bench/hunt/u5-endurance.mjs [debugPort] [actions]
import { record } from "../output.mjs";
import { Page, say, sleep } from "./lib.mjs";

const debug = Number(process.argv[2] ?? 9450);
const ACTIONS = Number(process.argv[3] ?? 300);
const findings = [];
const rows = [];
const samples = [];

const HOME = "v=3&f=mandelbrot&x=-0.5&y=0&w=3&p=twilight_shifted";

// ---------------------------------------------------------------- the long session

say(`U5: ${ACTIONS} in-page actions`);
{
  const page = await new Page({ debug }).start();
  await page.open(`?${HOME}`, { settle: 1200 });
  await page.settled(120);

  const box = await page.ev(`(() => { const r = document.getElementById('canvas').getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);

  /** One action, picked by index so the mix is the same run to run. */
  const act = async (i) => {
    const which = i % 12;
    if (which === 0 || which === 6) {
      await page.send("Input.dispatchMouseEvent", { type: "mouseWheel", x: box.x, y: box.y, deltaX: 0, deltaY: i % 24 === 0 ? 120 : -120 });
    } else if (which === 1) {
      await page.ev(`document.getElementById('view-palette').click()`);
    } else if (which === 2) {
      await page.ev(`(() => { const s = document.getElementById('mode');
        s.selectedIndex = ${i} % s.options.length; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    } else if (which === 3) {
      await page.send("Input.dispatchMouseEvent", { type: "mousePressed", x: box.x, y: box.y, button: "left", clickCount: 1 });
      await page.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: box.x + 40, y: box.y + 20, button: "left" });
      await page.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: box.x + 40, y: box.y + 20, button: "left", clickCount: 1 });
    } else if (which === 4) {
      await page.ev(`document.getElementById('view-phase').click()`);
    } else if (which === 5) {
      const tabs = ["tab-gallery", "tab-walk", "tab-saved", "tab-deep", "tab-atlas"];
      await page.ev(`document.getElementById('${tabs[i % tabs.length]}').click()`);
    } else if (which === 7) {
      await page.ev(`document.getElementById('view-whole').click()`);
    } else if (which === 8) {
      await page.ev(`document.querySelector('#palette-list [role="option"], #palette-list button')?.click()`);
    } else if (which === 9) {
      await page.ev(`document.getElementById('view-julia').click()`);
    } else if (which === 10) {
      await page.ev(`document.getElementById('save-view')?.click()`);
    } else {
      await page.ev(`document.getElementById('view-seat')?.click() ?? document.getElementById('view-whole').click()`);
    }
  };

  const first = await page.metrics();
  samples.push({ at: 0, ...first });
  say(`  start: ${JSON.stringify(first)}`);
  for (let i = 1; i <= ACTIONS; i++) {
    try {
      await act(i);
      await sleep(120);
    } catch (e) {
      findings.push({ name: "endurance", why: `action ${i} threw: ${String(e.message).slice(0, 160)}` });
      break;
    }
    if (i % 25 === 0) {
      await page.settled(40);
      const m = await page.metrics();
      samples.push({ at: i, ...m });
      say(`  ${i}: heap ${m.heapMB} MB, nodes ${m.nodes}, listeners ${m.listeners}, workers ${m.workers}`);
      const said = page.drain();
      if (said.length) findings.push({ name: `endurance at ${i}`, why: `console: ${said.join(" | ").slice(0, 300)}` });
    }
  }
  // Twenty walks and fifteen deep passes, each started and cancelled, in the same document.
  say("  walks and deep passes, started and cancelled");
  await page.ev(`document.getElementById('tab-walk').click()`);
  for (let i = 0; i < 20; i++) {
    await page.ev(`document.getElementById('walk-start').click()`);
    await sleep(400 + (i % 5) * 300);
    await page.ev(`(() => { const b = document.getElementById('walk-start'); if (b.textContent !== 'Start') b.click(); })()`);
    await sleep(200);
  }
  const afterWalks = await page.metrics();
  samples.push({ at: "after 20 walks", ...afterWalks });
  say(`  after walks: ${JSON.stringify(afterWalks)}`);

  const last = await page.metrics();
  samples.push({ at: "end", ...last });
  const grewHeap = last.heapMB - first.heapMB;
  const grewNodes = last.nodes - first.nodes;
  const grewListeners = last.listeners - first.listeners;
  const grewWorkers = last.workers - first.workers;
  rows.push({ name: "endurance", first, last, grewHeap, grewNodes, grewListeners, grewWorkers });
  say(`  grew: heap ${grewHeap.toFixed(1)} MB, nodes ${grewNodes}, listeners ${grewListeners}, workers ${grewWorkers}`);
  // A threshold rather than a vibe. Nodes and listeners must not climb without bound in a
  // document whose visible content is one canvas and a few panels.
  if (grewListeners > 2000) findings.push({ name: "endurance", why: `listeners grew by ${grewListeners} over ${ACTIONS} actions` });
  if (grewNodes > 20000) findings.push({ name: "endurance", why: `DOM nodes grew by ${grewNodes} over ${ACTIONS} actions` });
  if (grewWorkers > 4) findings.push({ name: "endurance", why: `worker count grew by ${grewWorkers} (${first.workers} -> ${last.workers})` });
  if (grewHeap > 400) findings.push({ name: "endurance", why: `heap grew by ${grewHeap.toFixed(0)} MB after a forced collection` });
  const said = page.drain();
  if (said.length) findings.push({ name: "endurance", why: `console: ${said.join(" | ").slice(0, 400)}` });
  await page.stop();
}

// ------------------------------------------------------------- a fetch that fails

const RESOURCES = [
  "engine.wasm", "perturb.wasm", "palettes.bin", "palettes.js", "catalog.js",
  "palette-names.json", "popular.json", "gallery.jsonl", "worker.js",
];

say("U5: each resource failed at the door");
for (const what of RESOURCES) {
  const name = `failed fetch: ${what}`;
  const page = await new Page({ debug: debug + 1 }).start();
  const row = { name };
  try {
    await page.send("Fetch.enable", { patterns: [{ urlPattern: "*" }] });
    // Every request is continued except the one under test, which is failed at the door.
    const pending = [];
    page.ws.addEventListener("message", (e) => {
      const m = JSON.parse(e.data);
      if (m.method !== "Fetch.requestPaused") return;
      const id = m.params.requestId;
      const url = m.params.request.url;
      const fail = url.includes(`/${what}`);
      pending.push(url);
      page.send(fail ? "Fetch.failRequest" : "Fetch.continueRequest",
        fail ? { requestId: id, errorReason: "Failed" } : { requestId: id }).catch(() => {});
    });
    const answered = await page.open(`?${HOME}`, { settle: 2500, limit: 60 });
    row.answered = answered;
    const s = await page.state();
    row.said = (s.said || s.status || "").slice(0, 160);
    row.dot = s.dot;
    // The rule: a said failure. Never a blank page that looks like it is still coming,
    // and never a picture drawn as if nothing were missing.
    if (answered === "neither") {
      findings.push({ name, why: "the page never answered: no picture and no notice" });
    } else if (answered === "studio" && !s.noticeUp && !s.status && s.dot === "rendering") {
      findings.push({ name, why: `the page is still saying 'rendering' with ${what} unavailable` });
    } else if (!row.said && answered === "studio" && s.dot !== "final") {
      findings.push({ name, why: `nothing was said and nothing was drawn (dot ${s.dot})` });
    }
  } catch (e) {
    row.threw = String(e.message).slice(0, 160);
    findings.push({ name, why: row.threw });
  }
  rows.push(row);
  say(`  ${what}: answered=${row.answered} dot=${row.dot} said=${JSON.stringify(row.said ?? "").slice(0, 90)}`);
  await page.stop();
}

// ----------------------------------------------------------------- slow, not failed

say("U5: the whole page on a slow link");
{
  const name = "slow network";
  const page = await new Page({ debug: debug + 2 }).start();
  try {
    await page.send("Network.enable");
    await page.send("Network.emulateNetworkConditions", {
      offline: false, latency: 400, downloadThroughput: 120000, uploadThroughput: 120000,
    });
    const answered = await page.open(`?${HOME}`, { settle: 3000, limit: 200 });
    const s = await page.state();
    rows.push({ name, answered, dot: s.dot, said: (s.said || "").slice(0, 120) });
    if (answered === "neither") findings.push({ name, why: "the page never came up on a slow link" });
    say(`  answered=${answered} dot=${s.dot}`);
  } catch (e) {
    findings.push({ name, why: String(e.message).slice(0, 160) });
  }
  const said = page.drain();
  if (said.length) findings.push({ name, why: `console: ${said.join(" | ").slice(0, 300)}` });
  await page.stop();
}

// --------------------------------------------------------------- storage, abused

const STORAGE = [
  ["a brace", "{"],
  ["null", "null"],
  ["an empty string", ""],
  ["an array where an object goes", "[1,2,3]"],
  ["a bumped version", '{"v":99,"items":[{"link":"v=3","added":1}]}'],
  ["items that are not links", '{"v":1,"items":["nope",42,null]}'],
  ["a 6 MB string", `{"v":1,"items":[{"link":"${"a".repeat(6 * 1024 * 1024)}","added":1}]}`],
];

say("U5: storage that is not what the page left there");
for (const [what, value] of STORAGE) {
  const name = `saved storage: ${what}`;
  const page = await new Page({ debug: debug + 3 }).start();
  const row = { name };
  try {
    // Reach the origin first, plant the value, then load the page over it.
    await page.open("", { settle: 300, limit: 40 });
    const key = await page.ev(`(async () => {
      const m = await import('./saved.js');
      return m.KEY ?? m.STORAGE_KEY ?? Object.values(m).find((v) => typeof v === 'string' && v.includes('fractal'));
    })()`);
    row.key = key;
    await page.ev(`localStorage.setItem(${JSON.stringify(typeof key === "string" ? key : "fractal-explorer-saved")}, ${JSON.stringify(value)})`);
    const answered = await page.open(`?${HOME}`, { settle: 1500 });
    row.answered = answered;
    await page.ev(`document.getElementById('tab-saved')?.click()`);
    await sleep(600);
    const s = await page.state();
    row.count = await page.ev(`document.getElementById('saved-count')?.textContent ?? null`);
    row.tiles = await page.ev(`document.querySelectorAll('#saved-tiles .tile').length`);
    if (answered !== "studio") findings.push({ name, why: `the page did not come up: ${answered} — ${s.said}` });
  } catch (e) {
    row.threw = String(e.message).slice(0, 160);
    findings.push({ name, why: row.threw });
  }
  const said = page.drain();
  if (said.length) {
    row.console = said;
    findings.push({ name, why: `console: ${said.join(" | ").slice(0, 300)}` });
  }
  rows.push(row);
  say(`  ${what}: answered=${row.answered} count=${JSON.stringify(row.count)} tiles=${row.tiles}`);
  await page.stop();
}

say("U5: the stored switches, set to junk");
{
  const name = "stored switches";
  const page = await new Page({ debug: debug + 4 }).start();
  try {
    await page.open("", { settle: 300, limit: 40 });
    await page.ev(`(() => {
      for (const k of Object.keys(localStorage)) localStorage.setItem(k, '\\u0000garbage');
      localStorage.setItem('fractal-explorer-julia-preview', '{]');
      sessionStorage.setItem('fractal-explorer-deep-warned', '{]');
      return Object.keys(localStorage);
    })()`);
    const answered = await page.open(`?${HOME}`, { settle: 1500 });
    const s = await page.state();
    rows.push({ name, answered, dot: s.dot });
    if (answered !== "studio") findings.push({ name, why: `junk in a stored switch stopped the page: ${s.said}` });
    say(`  answered=${answered} dot=${s.dot}`);
  } catch (e) {
    findings.push({ name, why: String(e.message).slice(0, 160) });
  }
  const said = page.drain();
  if (said.length) findings.push({ name, why: `console: ${said.join(" | ").slice(0, 300)}` });
  await page.stop();
}

record("hunt-u5.json", { samples, rows, findings });
say(`U5 done: ${findings.length} findings`);
for (const f of findings) say("  FINDING", f.name, "—", f.why);
