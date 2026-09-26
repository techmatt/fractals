// U9 — Browse *(explorer_browse_ckpt153)*: the gallery across the whole window, its chip
// rows, the preview drawn in three stages, and the way back into the viewer.
//
// What it asserts, one check each: every chip row on two collections filters the grid and
// lets it go again; a preview settles on its seat with the bar full; twenty fast steps
// settle on the twentieth neighbour with every overtaken render cancelled and no worker
// left over; a close mid-render cancels it; leaving Browse gives its pool back; and Open in
// explorer puts that seat's link in the address bar, with the way back stepping to where
// the viewer was. And the chrome *(browse_chrome_ckpt153)*: the bar live over Browse and the
// tab row in it, Browse pressed again and a tab each leaving it, and Copy link copying the
// previewed seat's link, the collection's on the grid, and the picture outside Browse.
//
// usage: node explorer/bench/hunt/u9-browse.mjs [debugPort] [sitePort]
import { record } from "../output.mjs";
import { Page, SITE, say, sleep } from "./lib.mjs";

const debug = Number(process.argv[2] ?? 9490);
const port = Number(process.argv[3] ?? SITE);

const page = await new Page({ debug, port }).start();
const findings = [];
const rows = [];

const HOME = "v=3&f=mandelbrot&x=-0.5&y=0&w=3&p=twilight_shifted";
const ROWS = ["browse-modes", "browse-hues", "browse-families", "browse-centered", "browse-spiral"];
const note = (name, why) => findings.push({ name, why });

async function check(name, fn) {
  const row = { name };
  try {
    Object.assign(row, (await fn()) ?? {});
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
  say(`  ${name}: ${JSON.stringify(row).slice(0, 240)}`);
}

async function until(expression, limit = 240, step = 250) {
  for (let i = 0; i < limit; i++) {
    if (await page.ev(expression)) return true;
    await sleep(step);
  }
  return false;
}

const key = async (name, modifiers = 0) => {
  const code = { ArrowLeft: 37, ArrowRight: 39, Escape: 27, z: 90, y: 89 }[name];
  const common = { key: name, code: name.length === 1 ? `Key${name.toUpperCase()}` : name, windowsVirtualKeyCode: code, modifiers };
  await page.send("Input.dispatchKeyEvent", { type: "rawKeyDown", ...common });
  await page.send("Input.dispatchKeyEvent", { type: "keyUp", ...common });
};

const tileCount = () => page.ev(`document.querySelectorAll('#browse-tiles .tile').length`);
const browseUp = () => page.ev(`!document.getElementById('browse').hidden`);
const previewUp = () => page.ev(`!document.getElementById('browse-preview').hidden`);
const witness = () => page.ev(`({ ...globalThis.__browse })`);
const barState = () => page.ev(`document.getElementById('browse-state').dataset.state`);
/** The page's chrome as Browse shows it: the bar live on top, the layer under it, and the
 *  panel's header row inside the layer with Gallery selected and Browse pressed. */
const chromeState = () =>
  page.ev(`(() => {
    const copy = document.getElementById('copy').getBoundingClientRect();
    const hit = document.elementFromPoint(copy.left + copy.width / 2, copy.top + copy.height / 2);
    const bar = document.querySelector('.studio-bar');
    const layer = document.getElementById('browse').getBoundingClientRect();
    const head = document.querySelector('#browse > .side-head');
    const tabs = [...document.querySelectorAll('.tab')].filter((t) => t.getBoundingClientRect().width > 0);
    return {
      bar: hit?.id === 'copy' && !bar.inert,
      below: Math.abs(layer.top - bar.getBoundingClientRect().bottom) < 1,
      head: head !== null && head.getBoundingClientRect().height > 0,
      tabs: tabs.length,
      selected: tabs.find((t) => t.getAttribute('aria-selected') === 'true')?.dataset.panel ?? null,
      pressed: document.getElementById('gallery-browse').getAttribute('aria-pressed'),
      panelSelect: document.getElementById('gallery-collection').getBoundingClientRect().width > 0,
    };
  })()`);

/** Press Copy link and read what it wrote: the clipboard is stubbed, since a headless
 *  page has no one to grant it. */
async function copied() {
  await page.ev(`(() => {
    globalThis.__copied = null;
    navigator.clipboard.writeText = async (text) => { globalThis.__copied = text; };
    document.getElementById('copy').click();
  })()`);
  await sleep(100);
  return page.ev(`globalThis.__copied`);
}

/** A seat's link in the general collection's record. */
const seatLink = (target) =>
  page.ev(`(async () => {
    const text = await (await fetch('../assets/images/galleries/seated-candidates/general.jsonl')).text();
    return text.split('\\n').filter(Boolean).map(JSON.parse).find((r) => r.key === ${JSON.stringify(target)}).link;
  })()`);

const settledOn = (expected) =>
  until(`globalThis.__browse?.settled === ${JSON.stringify(expected)} && document.getElementById('browse-state').dataset.state === 'final'`, 480);

say("U9: Browse");
await page.open(`?${HOME}`, { settle: 1500 });
await page.settled(120);
await until(`document.querySelectorAll('#gallery-tiles .tile').length > 0`);
const baseline = (await page.metrics()).workers;
// The address the page settles on, which is the link canonicalised to the current version.
const home = (await page.state()).url;

await check("the button opens Browse on the panel's collection", async () => {
  await page.ev(`document.getElementById('gallery-browse').click()`);
  const up = await until(`document.querySelectorAll('#browse-tiles .tile').length > 0`);
  if (!up) note("enter", "no tiles in Browse");
  const collection = await page.ev(`document.getElementById('browse-collection').value`);
  if (collection !== "general") note("enter", `opened on ${collection}`);
  const inert = await page.ev(`document.getElementById('studio').inert`);
  if (!inert) note("enter", "the studio is not inert under Browse");
  const chrome = await chromeState();
  if (!chrome.bar) note("chrome", "the bar's Copy link is not the thing on top at its own spot");
  if (!chrome.below) note("chrome", "the layer does not start under the bar");
  if (!chrome.head) note("chrome", "the tab row is not in Browse");
  if (chrome.tabs !== 6 || chrome.selected !== "gallery") note("chrome", `tabs ${chrome.tabs}, selected ${chrome.selected}`);
  if (chrome.pressed !== "true") note("chrome", "Browse is not pressed");
  if (chrome.panelSelect) note("chrome", "the panel's own dropdown shows beside Browse's");
  return { tiles: await tileCount(), collection, inert, chrome };
});

for (const collection of ["general", "blue"]) {
  await check(`every chip row on ${collection}`, async () => {
    await page.ev(`(() => {
      const s = document.getElementById('browse-collection');
      s.value = ${JSON.stringify(collection)};
      s.dispatchEvent(new Event('change'));
    })()`);
    await sleep(300);
    await until(`document.getElementById('browse-collection').value === ${JSON.stringify(collection)} && document.querySelectorAll('#browse-tiles .tile').length > 0`);
    const whole = await page.ev(`[...document.getElementById('browse-collection').selectedOptions][0].textContent.match(/(\\d+)$/)[1] * 1`);
    const out = { whole, rows: {} };
    for (const id of ROWS) {
      const chips = await page.ev(`[...document.querySelectorAll('#${id} .chip')].map((c) => c.textContent)`);
      if (!chips.length) {
        note(`${collection} ${id}`, "the row has no chips");
        continue;
      }
      const sum = chips.reduce((total, text) => total + Number(text.match(/(\d+)$/)[1]), 0);
      // Press the first chip: the note says how many it leaves, and the tiles are that many.
      await page.ev(`document.querySelector('#${id} .chip').click()`);
      await sleep(250);
      const said = await page.ev(`document.getElementById('browse-note').textContent`);
      const first = Number(chips[0].match(/(\d+)$/)[1]);
      const shown = Number(said.match(/^(\d+) of/)?.[1] ?? -1);
      if (shown !== first) note(`${collection} ${id}`, `chip says ${first}, the note says "${said}"`);
      const pressed = await page.ev(`document.querySelector('#${id} .chip').getAttribute('aria-pressed')`);
      if (pressed !== "true") note(`${collection} ${id}`, "the chip did not press");
      await page.ev(`document.querySelector('#${id} .chip').click()`);
      await sleep(250);
      const cleared = await page.ev(`document.getElementById('browse-note').textContent`);
      if (cleared !== "") note(`${collection} ${id}`, `releasing left "${cleared}"`);
      // A partition's counts add up to the collection; the hue row inside a colour collection
      // counts what else a picture contains, and is not one.
      const partition = !(id === "browse-hues" && collection === "blue");
      if (partition && sum !== whole) note(`${collection} ${id}`, `counts add to ${sum}, not ${whole}`);
      out.rows[id] = { chips: chips.length, first: chips[0], shown };
    }
    return out;
  });
}

await check("back to general, and a preview", async () => {
  await page.ev(`(() => {
    const s = document.getElementById('browse-collection');
    s.value = 'general';
    s.dispatchEvent(new Event('change'));
  })()`);
  await sleep(500);
  const target = await page.ev(`document.querySelectorAll('#browse-tiles .tile')[2].dataset.key`);
  await page.ev(`document.querySelectorAll('#browse-tiles .tile')[2].click()`);
  const underAtOnce = await page.ev(`document.getElementById('browse-under').getAttribute('src')?.includes(${JSON.stringify(target)})`);
  if (!underAtOnce) note("preview", "the tile was not put up at once");
  const done = await settledOn(target);
  if (!done) note("preview", `did not settle on ${target}: ${JSON.stringify(await witness())}`);
  const box = await page.ev(`(() => { const c = document.getElementById('browse-picture'); return { css: c.getBoundingClientRect().width, grid: c.width, shown: !c.hidden }; })()`);
  if (box.css > 1600 || box.grid > 1600) note("preview", `wider than 1600: ${JSON.stringify(box)}`);
  const chrome = await chromeState();
  if (!chrome.bar || !chrome.head) note("preview", `the chrome is covered: ${JSON.stringify(chrome)}`);
  // Copy link in a preview is the seat's link, the one Open in explorer loads.
  const link = await seatLink(target);
  const got = await copied();
  if (got?.split("?")[1] !== link) note("copy", `a preview copied ${String(got).slice(0, 90)}, not ${link.slice(0, 90)}`);
  return { target, done, box, copied: got?.split("?")[1] === link, workers: (await page.metrics()).workers };
});

await check("twenty steps right, fast", async () => {
  const before = await witness();
  const from = await page.ev(`[...document.querySelectorAll('#browse-tiles .tile')].findIndex((t) => t.dataset.key === document.getElementById('browse-preview').dataset.key)`);
  const expected = await page.ev(`document.querySelectorAll('#browse-tiles .tile')[${from + 20}].dataset.key`);
  for (let i = 0; i < 20; i++) await key("ArrowRight");
  const done = await settledOn(expected);
  const after = await witness();
  const on = await page.ev(`document.getElementById('browse-preview').dataset.key`);
  if (!done || on !== expected) note("steps", `settled on ${on}/${after.settled}, expected ${expected}`);
  const started = after.started - before.started;
  const cancelled = after.cancelled - before.cancelled;
  // Every render but the last was overtaken while it drew, so every one but the last is a cancel.
  if (started !== 20 || cancelled !== 19) note("steps", `started ${started}, cancelled ${cancelled}`);
  await sleep(1500);
  const workers = (await page.metrics()).workers;
  return { from, expected, done, started, cancelled, state: await barState(), workers };
});

await check("a close mid-render cancels it", async () => {
  const before = await witness();
  await key("ArrowLeft");
  await sleep(60);
  const drawing = (await witness()).settled === null;
  await key("Escape");
  await sleep(1500);
  const after = await witness();
  if (!drawing) note("close", "the render had already finished before the close; nothing was tested");
  if (after.cancelled !== before.cancelled + 1) note("close", `cancelled ${before.cancelled} → ${after.cancelled}`);
  if (after.settled !== null) note("close", `a cancelled render settled on ${after.settled}`);
  if (await previewUp()) note("close", "the preview is still up");
  if (!(await browseUp())) note("close", "Esc with a preview up left Browse");
  return { drawing, cancelled: after.cancelled - before.cancelled, settled: after.settled };
});

await check("Copy link on the grid is the collection's", async () => {
  const general = await copied();
  const wantGeneral = "panel=gallery&collection=general";
  if (general?.split("?")[1] !== wantGeneral) note("copy", `the grid copied ${general}`);
  await page.ev(`(() => {
    const s = document.getElementById('browse-collection');
    s.value = 'blue';
    s.dispatchEvent(new Event('change'));
  })()`);
  await until(`document.getElementById('browse-collection').value === 'blue' && document.querySelectorAll('#browse-tiles .tile').length > 0`);
  const blue = await copied();
  if (blue?.split("?")[1] !== "panel=gallery&collection=blue") note("copy", `blue's grid copied ${blue}`);
  await page.ev(`(() => {
    const s = document.getElementById('browse-collection');
    s.value = 'general';
    s.dispatchEvent(new Event('change'));
  })()`);
  await until(`document.getElementById('browse-collection').value === 'general' && document.querySelectorAll('#browse-tiles .tile').length > 0`);
  return { general, blue };
});

await check("Esc on the grid leaves Browse and gives its pool back", async () => {
  const inside = (await page.metrics()).workers;
  await key("Escape");
  await sleep(1200);
  const up = await browseUp();
  // The least of three samples, for the reason Open in explorer's check gives below.
  let workers = Infinity;
  for (let i = 0; i < 3; i++) {
    workers = Math.min(workers, (await page.metrics()).workers);
    await sleep(700);
  }
  if (up) note("exit", "Browse is still up");
  if (workers > baseline) note("exit", `workers ${baseline} before Browse, ${inside} in it, ${workers} after`);
  const inert = await page.ev(`document.getElementById('studio').inert`);
  if (inert) note("exit", "the studio is still inert");
  const url = (await page.state()).url;
  if (url !== home) note("exit", `the viewer moved: ${url.slice(0, 80)}`);
  const pressed = await page.ev(`document.getElementById('gallery-browse').getAttribute('aria-pressed')`);
  const headHome = await page.ev(`document.querySelector('.side > .side-head') !== null`);
  if (pressed !== "false" || !headHome) note("exit", `Browse pressed ${pressed}, the row back in the panel ${headHome}`);
  return { baseline, inside, workers };
});

await check("Browse pressed again leaves it", async () => {
  await page.ev(`document.getElementById('gallery-browse').click()`);
  await until(`document.querySelectorAll('#browse-tiles .tile').length > 0`);
  await page.ev(`document.getElementById('gallery-browse').click()`);
  await sleep(600);
  const up = await browseUp();
  if (up) note("toggle", "Browse is still up");
  const url = (await page.state()).url;
  if (url !== home) note("toggle", `the viewer moved: ${url.slice(0, 80)}`);
  return { up };
});

await check("a tab leaves Browse onto that tab", async () => {
  await page.ev(`document.getElementById('gallery-browse').click()`);
  await until(`document.querySelectorAll('#browse-tiles .tile').length > 0`);
  // Gallery is what Browse already shows, so pressing it stays.
  await page.ev(`document.getElementById('tab-gallery').click()`);
  await sleep(300);
  if (!(await browseUp())) note("tabs", "the Gallery tab left Browse");
  await page.ev(`document.getElementById('tab-atlas').click()`);
  await sleep(800);
  const up = await browseUp();
  const selected = await page.ev(`document.querySelector('.tab[aria-selected="true"]').dataset.panel`);
  const shown = await page.ev(`!document.getElementById('panel-atlas').hidden`);
  const inert = await page.ev(`document.getElementById('studio').inert`);
  if (up || selected !== "atlas" || !shown || inert) note("tabs", `up ${up}, selected ${selected}, atlas shown ${shown}, inert ${inert}`);
  // Outside Browse, Copy link is the picture, as it always was.
  const picture = await copied();
  if (picture?.split("?")[1] !== home) note("copy", `outside Browse it copied ${String(picture).slice(0, 90)}`);
  await page.ev(`document.getElementById('tab-gallery').click()`);
  await sleep(500);
  return { up, selected, shown, picture: picture?.split("?")[1] === home };
});

await check("Open in explorer", async () => {
  await page.ev(`document.getElementById('gallery-browse').click()`);
  await until(`document.querySelectorAll('#browse-tiles .tile').length > 5`);
  const target = await page.ev(`document.querySelectorAll('#browse-tiles .tile')[5].dataset.key`);
  await page.ev(`document.querySelectorAll('#browse-tiles .tile')[5].click()`);
  await sleep(400);
  const link = await seatLink(target);
  await page.ev(`document.getElementById('browse-open').click()`);
  await sleep(500);
  await page.settled(240);
  const url = (await page.state()).url;
  if (!url.startsWith(link)) note("open", `address ${url.slice(0, 90)} is not ${link.slice(0, 90)}`);
  const marked = await page.ev(`document.querySelector('#gallery-tiles .tile.is-open')?.dataset.key ?? null`);
  const seat = await page.ev(`({ text: document.getElementById('view-seat').textContent, disabled: document.getElementById('view-seat').disabled })`);
  if (await browseUp()) note("open", "Browse is still up");
  // The way back: one step back is the view Browse was opened over.
  await key("z", 2);
  await sleep(500);
  await page.settled(240);
  const back = (await page.state()).url;
  if (back !== home) note("open", `a step back went to ${back.slice(0, 80)}`);
  await key("y", 2);
  await sleep(500);
  await page.settled(240);
  const forward = (await page.state()).url;
  if (!forward.startsWith(link)) note("open", `a step forward went to ${forward.slice(0, 80)}`);
  // Reset to seat: disabled at the seat, as a tile leaves it, and after a pan it goes back.
  if (!seat.disabled) note("open", "Reset to seat is live on the seat itself");
  await key("ArrowRight");
  await sleep(600);
  await page.settled(240);
  const live = await page.ev(`!document.getElementById('view-seat').disabled`);
  await page.ev(`document.getElementById('view-seat').click()`);
  await sleep(500);
  await page.settled(240);
  const reset = (await page.state()).url;
  if (!live || !reset.startsWith(link)) note("open", `Reset to seat: live ${live}, went to ${reset.slice(0, 80)}`);
  // The least of three samples: the viewer's own colouring worker comes and goes by one
  // between passes (measured without Browse ever opening), and a leak is one that stays.
  let workers = Infinity;
  for (let i = 0; i < 3; i++) {
    await sleep(700);
    workers = Math.min(workers, (await page.metrics()).workers);
  }
  if (workers > baseline) note("open", `workers ${baseline} before, ${workers} after`);
  return { target, url: url.slice(0, 80), marked, seat, back: back.slice(0, 50), forward: forward.slice(0, 50), live, workers };
});

record("hunt-u9.json", { rows, findings });
say(`U9 done: ${findings.length} findings`);
for (const f of findings) say("  FINDING", f.name, "—", f.why);
await page.stop();
