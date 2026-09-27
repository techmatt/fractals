// U9 — Browse *(explorer_browse_ckpt153)*: the gallery across the whole window, its chip
// rows, the preview drawn in three stages, and the way back into the viewer.
//
// What it asserts, one check each: every chip row on two collections filters the grid and
// lets it go again; a preview settles on its seat with the bar full; twenty fast steps
// settle on the twentieth neighbour with every overtaken render cancelled and no worker
// left over; a close mid-render cancels it; leaving Browse gives its pool back; and Open in
// explorer puts that seat's link in the address bar, with the way back stepping to where
// the viewer was. And the chrome *(browse_chrome_ckpt153)*: the bar live over Browse and the
// tab row in it, and Copy link copying the previewed seat's link, the collection's on the
// grid, and the picture outside Browse. And the header *(browse_header_ckpt153)*: one row
// with nothing empty in it, Screensaver from Browse coming back to Browse, and the one exit.
// And the union *(gallery_all_ckpt153)*: General gallery · all in the narrow panel and in
// Browse, each chip row on it, and one of its pictures previewed.
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
 *  panel's header row inside the layer with Gallery selected, and it the only header:
 *  one line of visible controls in order, none of them empty, and one way out. */
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
      row: (() => {
        if (head === null) return null;
        const box = (e) => e.getBoundingClientRect();
        const shown = [...head.children].filter((e) => box(e).width > 0);
        const middles = shown.map((e) => Math.round(box(e).top + box(e).height / 2));
        return {
          ids: shown.map((e) => e.id || e.className),
          oneLine: Math.max(...middles) - Math.min(...middles) <= 2,
          empty: shown.filter((e) => e.textContent.trim() === '' || box(e).height === 0).map((e) => e.id || e.className),
          inOrder: shown.map((e) => box(e).left).every((x, i, all) => i === 0 || x > all[i - 1]),
          exit: document.getElementById('browse-exit').textContent.trim(),
          // Nothing between the row and the chip rows: the second header row is gone.
          next: head.nextElementSibling?.className ?? null,
        };
      })(),
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
let baseline = (await page.metrics()).workers;
// The address the page settles on, which is the link canonicalised to the current version.
const home = (await page.state()).url;

await check("the button opens Browse on the panel's collection", async () => {
  await page.ev(`document.getElementById('gallery-browse').click()`);
  const up = await until(`document.querySelectorAll('#browse-tiles .tile').length > 0`);
  if (!up) note("enter", "no tiles in Browse");
  const collection = await page.ev(`document.getElementById('browse-collection').value`);
  if (collection !== "general") note("enter", `opened on ${collection}`);
  // Everything in the studio but the narrow grid is inert *(explorer_render_seams_ckpt153)*,
  // and focus sent into the grid comes back to Browse. A headless page has no focus of its
  // own, and fires no focus event without it, so focus is emulated for the one check.
  await page.send("Emulation.setFocusEmulationEnabled", { enabled: true });
  const inert = await page.ev(`(() => {
    const viewer = document.querySelector('.viewer').inert;
    const note = document.getElementById('gallery-note').inert;
    document.querySelector('#gallery-tiles .tile')?.focus();
    return { viewer, note, trapped: document.activeElement?.id === 'browse-collection' };
  })()`);
  await page.send("Emulation.setFocusEmulationEnabled", { enabled: false });
  if (!inert.viewer || !inert.note || !inert.trapped) note("enter", `the studio is within reach under Browse: ${JSON.stringify(inert)}`);
  const chrome = await chromeState();
  if (!chrome.bar) note("chrome", "the bar's Copy link is not the thing on top at its own spot");
  if (!chrome.below) note("chrome", "the layer does not start under the bar");
  if (!chrome.head) note("chrome", "the tab row is not in Browse");
  if (chrome.tabs !== 6 || chrome.selected !== "gallery") note("chrome", `tabs ${chrome.tabs}, selected ${chrome.selected}`);
  const want = ["tabs", "browse-collection", "gallery-screensaver", "browse-exit"];
  const row = chrome.row;
  if (row === null || JSON.stringify(row.ids) !== JSON.stringify(want)) note("header", `the row shows ${JSON.stringify(row?.ids)}`);
  else if (!row.oneLine || !row.inOrder || row.empty.length > 0) note("header", `not one clean row: ${JSON.stringify(row)}`);
  if (row?.exit !== "Back to explorer (Esc)") note("header", `the exit reads ${row?.exit}`);
  if (!String(row?.next).includes("browse-filters")) note("header", `under the row: ${row?.next}`);
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
  if (box.grid > 2560) note("preview", `a grid wider than 2560: ${JSON.stringify(box)}`);
  const chrome = await chromeState();
  if (!chrome.bar || !chrome.head) note("preview", `the chrome is covered: ${JSON.stringify(chrome)}`);
  // Copy link in a preview is the seat's link, the one Open in explorer loads.
  const link = await seatLink(target);
  const got = await copied();
  if (got?.split("?")[1] !== link) note("copy", `a preview copied ${String(got).slice(0, 90)}, not ${link.slice(0, 90)}`);
  return { target, done, box, copied: got?.split("?")[1] === link, workers: (await page.metrics()).workers };
});

// The preview's size *(browse_preview_size_ckpt153)*: within 85% of the layer each way, at
// the seat's aspect, with the tab row above it and the bar under it on screen, and a grid
// that follows the device pixels to 2560 across and no further. The 2x case is the cap's.
// An override that moves only the pixel ratio, or nothing, fires no `resize`, so one is sent:
// what is under test is the size a redraw chooses, not whether the browser announces it.
async function metrics(width, height, deviceScaleFactor = 1) {
  await page.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor, mobile: false });
  await page.ev(`window.dispatchEvent(new Event('resize'))`);
}
for (const [width, height, ratio] of [[1600, 1100, 1], [2560, 1440, 1], [2560, 1440, 2]]) {
  await check(`the preview at ${width}x${height} at ${ratio}x`, async () => {
    const started = (await witness()).started;
    const on = await page.ev(`document.getElementById('browse-preview').dataset.key`);
    await metrics(width, height, ratio);
    const redrawn = await until(`globalThis.__browse.started > ${started}`, 40);
    if (!redrawn) note("size", `${width}x${height}: no redraw on resize`);
    await settledOn(on);
    const got = await page.ev(`(() => {
      const r = (id) => { const b = document.getElementById(id).getBoundingClientRect(); return { top: b.top, bottom: b.bottom, width: b.width, height: b.height }; };
      const head = document.querySelector('#browse > .side-head').getBoundingClientRect();
      const bar = document.querySelector('.browse-bar').getBoundingClientRect();
      const c = document.getElementById('browse-picture');
      const w = globalThis.__browse;
      return { layer: r('browse'), picture: r('browse-picture'), headBottom: head.bottom, barBottom: bar.bottom,
        grid: { width: c.width, height: c.height }, box: w.box, took: w.took, inner: innerHeight };
    })()`);
    const { layer, picture, grid } = got;
    const share = { width: picture.width / layer.width, height: picture.height / layer.height };
    if (share.width > 0.851 || share.height > 0.851) note("size", `${width}x${height}: over 85% ${JSON.stringify(share)}`);
    if (Math.max(share.width, share.height) < 0.8) note("size", `${width}x${height}: neither side binds ${JSON.stringify(share)}`);
    const aspect = Math.abs(picture.width / picture.height - grid.width / grid.height);
    if (aspect > 0.01) note("size", `${width}x${height}: the grid's aspect is not the box's`);
    if (got.headBottom > picture.top) note("size", `${width}x${height}: the tab row covers the picture`);
    if (got.barBottom > got.inner) note("size", `${width}x${height}: the bar is off screen`);
    if (grid.width > 2560) note("size", `${width}x${height}: a grid ${grid.width} wide`);
    if (ratio > 1 && picture.width * ratio > 2560 && grid.width !== 2560) note("size", `${width}x${height}@${ratio}: grid ${grid.width}, not capped at 2560`);
    return { share, box: got.box, grid, finalMs: got.took[2], took: got.took };
  });
}
const before = (await witness()).started;
await metrics(1600, 1100, 1);
await until(`globalThis.__browse.started > ${before}`, 40);
await settledOn(await page.ev(`document.getElementById('browse-preview').dataset.key`));

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
  // Drained, not instant: one worker can still be counted for a while after Browse is
  // left, and after this run's twenty cancelled renders and a close mid-render it was about
  // ten seconds (measured: 15 for ~9 s after leaving, then 14 and flat through 15 s more;
  // without that load, about two). Which worker it is was not identified. So the count has
  // fifteen seconds to come back, and a worker that stays past them is a leak.
  let workers = Infinity;
  for (let i = 0; i < 30 && workers > baseline; i++) {
    workers = Math.min(workers, (await page.metrics()).workers);
    await sleep(500);
  }
  if (up) note("exit", "Browse is still up");
  if (workers > baseline) note("exit", `workers ${baseline} before Browse, ${inside} in it, ${workers} after`);
  const inert = await page.ev(`document.getElementById('studio').inert || document.querySelector('.viewer').inert`);
  if (inert) note("exit", "the studio is still inert");
  const url = (await page.state()).url;
  if (url !== home) note("exit", `the viewer moved: ${url.slice(0, 80)}`);
  const headHome = await page.ev(`document.querySelector('.side > .side-head') !== null`);
  // Back in the panel, the row is the panel's again: Browse's three are gone from it.
  const narrow = await page.ev(`[...document.querySelector('.side-head').children].filter((e) => e.getBoundingClientRect().width > 0).map((e) => e.id || e.className)`);
  const wantNarrow = ["tabs", "gallery-collection", "gallery-screensaver", "gallery-browse"];
  if (!headHome || JSON.stringify(narrow) !== JSON.stringify(wantNarrow)) note("exit", `the row back in the panel ${headHome}, showing ${JSON.stringify(narrow)}`);
  return { baseline, inside, workers };
});

await check("Back to explorer leaves Browse", async () => {
  await page.ev(`document.getElementById('gallery-browse').click()`);
  await until(`document.querySelectorAll('#browse-tiles .tile').length > 0`);
  await page.ev(`document.getElementById('browse-exit').click()`);
  await sleep(600);
  const up = await browseUp();
  if (up) note("back", "Browse is still up");
  const url = (await page.state()).url;
  if (url !== home) note("back", `the viewer moved: ${url.slice(0, 80)}`);
  return { up, focused: await page.ev(`document.activeElement?.id`) };
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
  const inert = await page.ev(`document.getElementById('studio').inert || document.querySelector('.viewer').inert`);
  if (up || selected !== "atlas" || !shown || inert) note("tabs", `up ${up}, selected ${selected}, atlas shown ${shown}, inert ${inert}`);
  // Outside Browse, Copy link is the picture, as it always was.
  const picture = await copied();
  if (picture?.split("?")[1] !== home) note("copy", `outside Browse it copied ${String(picture).slice(0, 90)}`);
  await page.ev(`document.getElementById('tab-gallery').click()`);
  await sleep(500);
  return { up, selected, shown, picture: picture?.split("?")[1] === home };
});

// ----------------------------------------------------------- the union
// *(gallery_all_ckpt153)*: General gallery · all, listed right after the n=2000 one, opened
// in the narrow panel and then in Browse, filtered on every chip row, and one picture
// previewed. It is a general gallery, so its hue row reads Color family.

const ALL_FILE = "../assets/images/galleries/seated-candidates/all.jsonl";
const allHeader = () =>
  page.ev(`(async () => {
    const text = await (await fetch('../assets/images/galleries/seated-candidates/gallery.jsonl')).text();
    return JSON.parse(text.split('\\n')[0]).collections.find((c) => c.name === 'all') ?? null;
  })()`);
/** Until a chip row tallies to the whole union: the old collection's chips and tiles stay up
 *  while its 3.8 MB of rows arrive, so a tile count alone says nothing about which is shown. */
const unionShown = (row, seats) =>
  until(`[...document.querySelectorAll('#${row} .chip')].reduce((t, c) => t + Number(c.textContent.match(/(\\d+)$/)?.[1] ?? 0), 0) === ${seats}`);
const choose = (id, name) =>
  page.ev(`(() => {
    const s = document.getElementById(${JSON.stringify(id)});
    s.value = ${JSON.stringify(name)};
    s.dispatchEvent(new Event('change'));
  })()`);

await check("the union in the narrow panel", async () => {
  const entry = await allHeader();
  if (entry === null) throw new Error("the header carries no all collection");
  await choose("gallery-collection", "all");
  const up = await unionShown("gallery-modes", entry.seats);
  if (!up) note("all narrow", "the union's chips never came up");
  const listed = await page.ev(`[...document.getElementById('gallery-collection').options].map((o) => [o.value, o.textContent.trim()])`);
  const at = listed.findIndex(([value]) => value === "all");
  if (at < 0 || listed[at - 1]?.[0] !== "general_2000") note("all narrow", `listed at ${at}, after ${listed[at - 1]?.[0]}`);
  if (listed[at]?.[1] !== "General gallery · all") note("all narrow", `the option reads ${listed[at]?.[1]}`);
  if (listed[0]?.[0] !== "general") note("all narrow", `the dropdown opens on ${listed[0]?.[0]}`);
  const head = await page.ev(`document.getElementById('head-gallery-hues').textContent`);
  if (head !== "Color family") note("all narrow", `the hue row reads ${head}`);
  const address = await page.ev(`location.search`);
  if (!address.includes("collection=all")) note("all narrow", `the address is ${address}`);
  // Filtered on the first mode chip: the note counts what it leaves.
  const chip = await page.ev(`document.querySelector('#gallery-modes .chip').textContent`);
  await page.ev(`document.querySelector('#gallery-modes .chip').click()`);
  await sleep(250);
  const said = await page.ev(`document.getElementById('gallery-note').textContent`);
  if (Number(said.match(/^(\d+) of/)?.[1]) !== Number(chip.match(/(\d+)$/)[1])) note("all narrow", `chip ${chip}, note "${said}"`);
  if (Number(said.match(/of (\d+)/)?.[1]) !== entry.seats) note("all narrow", `note "${said}", the union holds ${entry.seats}`);
  await page.ev(`document.querySelector('#gallery-modes .chip').click()`);
  await sleep(250);
  return { seats: entry.seats, at, option: listed[at]?.[1], head, chip, said };
});

await check("the union in Browse, filtered, and a preview", async () => {
  const entry = await allHeader();
  await page.ev(`document.getElementById('gallery-browse').click()`);
  await until(`document.querySelectorAll('#browse-tiles .tile').length > 0`);
  const collection = await page.ev(`document.getElementById('browse-collection').value`);
  if (collection !== "all") note("all browse", `Browse opened on ${collection}`);
  if (!(await unionShown("browse-modes", entry.seats))) note("all browse", "the union's chips never came up");
  const head = await page.ev(`document.getElementById('head-browse-hues').textContent`);
  if (head !== "Color family") note("all browse", `the hue row reads ${head}`);
  const out = { collection, head, rows: {} };
  for (const id of ROWS) {
    const chips = await page.ev(`[...document.querySelectorAll('#${id} .chip')].map((c) => c.textContent)`);
    if (!chips.length) {
      note(`all ${id}`, "the row has no chips");
      continue;
    }
    const sum = chips.reduce((total, text) => total + Number(text.match(/(\d+)$/)[1]), 0);
    if (sum !== entry.seats) note(`all ${id}`, `counts add to ${sum}, not ${entry.seats}`);
    await page.ev(`document.querySelector('#${id} .chip').click()`);
    await until(`document.getElementById('browse-note').textContent !== ''`, 20, 100);
    const said = await page.ev(`document.getElementById('browse-note').textContent`);
    const first = Number(chips[0].match(/(\d+)$/)[1]);
    if (Number(said.match(/^(\d+) of/)?.[1] ?? -1) !== first) note(`all ${id}`, `chip says ${first}, the note says "${said}"`);
    await page.ev(`document.querySelector('#${id} .chip').click()`);
    await sleep(250);
    out.rows[id] = { chips: chips.length, first: chips[0] };
  }
  const grid = await copied();
  if (grid?.split("?")[1] !== "panel=gallery&collection=all") note("all browse", `the grid copied ${grid}`);
  // One picture previewed, and its link is the seat's own in the union's record.
  const target = await page.ev(`document.querySelectorAll('#browse-tiles .tile')[3].dataset.key`);
  await page.ev(`document.querySelectorAll('#browse-tiles .tile')[3].click()`);
  const done = await settledOn(target);
  if (!done) note("all browse", `the preview did not settle on ${target}`);
  const link = await page.ev(`(async () => {
    const text = await (await fetch(${JSON.stringify(ALL_FILE)})).text();
    return text.split('\\n').filter(Boolean).map(JSON.parse).find((r) => r.key === ${JSON.stringify(target)}).link;
  })()`);
  const got = await copied();
  if (got?.split("?")[1] !== link) note("all browse", `the preview copied ${String(got).slice(0, 90)}`);
  await key("Escape");
  await sleep(300);
  await choose("browse-collection", "general");
  await until(`document.getElementById('browse-collection').value === 'general' && document.querySelectorAll('#browse-tiles .tile').length > 0`);
  await key("Escape");
  await sleep(600);
  if (await browseUp()) note("all browse", "Browse is still up");
  await choose("gallery-collection", "general");
  await until(`document.getElementById('gallery-collection').value === 'general'`);
  await sleep(300);
  return { ...out, target, done, copied: got?.split("?")[1] === link };
});

// ----------------------------------------------------------- saving from Browse
// *(browse_chrome_ckpt153_addendum1)*: one seat saved by its grid mark and one by the
// preview's Save, each seen on the narrow panel's mark, on the Saved tab and in its Copy
// links by the seat's exact link; then both unsaved from Browse and both surfaces clear.

const SAVED_KEY = "fractal-website.explorer.saved";
const storedLinks = () =>
  page.ev(`(() => { try { return (JSON.parse(localStorage.getItem(${JSON.stringify(SAVED_KEY)}))?.items ?? []).map((i) => i.link); } catch { return []; } })()`);
const narrowPressed = (key) =>
  page.ev(`document.querySelector('#gallery-tiles .tile[data-key="${key}"]')?.parentElement.querySelector('.save-mark')?.getAttribute('aria-pressed') ?? null`);
const browseMark = (i) => `document.querySelectorAll('#browse-tiles .tile-cell')[${i}].querySelector('.save-mark')`;
const savedShows = (link) =>
  page.ev(`[...document.querySelectorAll('#panel-saved .saved-tile')].some((t) => t.dataset.key === ${JSON.stringify(link)})`);
let pair = null;

async function openSavedTab() {
  await page.ev(`document.getElementById('tab-saved').click()`);
  await until(`document.querySelectorAll('#panel-saved .saved-tile').length > 0 || document.getElementById('saved-copy')?.getBoundingClientRect().width > 0`);
  await sleep(500);
}

await check("save from the grid and from a preview", async () => {
  await page.ev(`document.getElementById('gallery-browse').click()`);
  await until(`document.querySelectorAll('#browse-tiles .tile-cell .save-mark').length > 10`);
  const keys = await page.ev(`[7, 8, 9].map((i) => document.querySelectorAll('#browse-tiles .tile')[i].dataset.key)`);
  const links = [await seatLink(keys[0]), await seatLink(keys[1])];
  pair = { keys, links };
  // A profile that kept a save from an earlier run starts this one clean.
  for (const i of [7, 8]) {
    if ((await page.ev(`${browseMark(i)}.getAttribute('aria-pressed')`)) === "true") await page.ev(`${browseMark(i)}.click()`);
  }
  await page.ev(`${browseMark(7)}.click()`);
  const grid = await page.ev(`${browseMark(7)}.getAttribute('aria-pressed')`);
  if (grid !== "true") note("save", "the grid mark did not press");
  await page.ev(`document.querySelectorAll('#browse-tiles .tile')[8].click()`);
  await sleep(200);
  const before = await page.ev(`document.getElementById('browse-save').textContent`);
  await page.ev(`document.getElementById('browse-save').click()`);
  const after = await page.ev(`({ text: document.getElementById('browse-save').textContent, pressed: document.getElementById('browse-save').getAttribute('aria-pressed') })`);
  if (before !== "Save" || after.text !== "Saved" || after.pressed !== "true") note("save", `preview Save ${before} → ${JSON.stringify(after)}`);
  // The mark under the preview pressed with it, and ← → keep the state per picture.
  const underMark = await page.ev(`${browseMark(8)}.getAttribute('aria-pressed')`);
  await key("ArrowRight");
  const next = await page.ev(`document.getElementById('browse-save').textContent`);
  await key("ArrowLeft");
  const back = await page.ev(`document.getElementById('browse-save').textContent`);
  if (underMark !== "true" || next !== "Save" || back !== "Saved") note("save", `mark ${underMark}, → ${next}, ← ${back}`);
  await key("Escape");
  await sleep(300);
  const stored = await storedLinks();
  const exact = links.every((l) => stored.includes(l));
  if (!exact) note("save", `stored ${JSON.stringify(stored).slice(0, 200)} lacks a seat's exact link`);
  const narrow = [await narrowPressed(keys[0]), await narrowPressed(keys[1])];
  if (narrow.some((p) => p !== "true")) note("save", `the narrow panel's marks read ${narrow}`);
  // The Saved tab: a tab leaves Browse onto it.
  await openSavedTab();
  const shown = [await savedShows(links[0]), await savedShows(links[1])];
  if (shown.some((s) => !s)) note("save", `the Saved tab shows ${shown}`);
  await page.ev(`(() => {
    globalThis.__copied = null;
    navigator.clipboard.writeText = async (text) => { globalThis.__copied = text; };
    document.getElementById('saved-copy').click();
  })()`);
  await sleep(200);
  const lines = String(await page.ev(`globalThis.__copied`)).split("\n").map((l) => l.split("?")[1]).filter(Boolean);
  const copiedExact = links.every((l) => lines.includes(l));
  if (!copiedExact) note("save", `Copy links lacks a seat's exact link: ${lines.slice(0, 4).join(" | ").slice(0, 200)}`);
  await page.ev(`document.getElementById('tab-gallery').click()`);
  await sleep(300);
  return { grid, preview: after.text, underMark, next, back, exact, narrow, shown, copiedExact, lines: lines.length };
});

await check("unsave from Browse clears both surfaces", async () => {
  const { links, keys } = pair;
  await page.ev(`document.getElementById('gallery-browse').click()`);
  await until(`document.querySelectorAll('#browse-tiles .tile-cell .save-mark').length > 10`);
  const marked = await page.ev(`${browseMark(7)}.getAttribute('aria-pressed')`);
  if (marked !== "true") note("unsave", "a saved seat's mark was not pressed on the way back into Browse");
  await page.ev(`${browseMark(7)}.click()`);
  await page.ev(`document.querySelectorAll('#browse-tiles .tile')[8].click()`);
  await sleep(200);
  const on = await page.ev(`document.getElementById('browse-save').textContent`);
  await page.ev(`document.getElementById('browse-save').click()`);
  const off = await page.ev(`document.getElementById('browse-save').textContent`);
  if (on !== "Saved" || off !== "Save") note("unsave", `preview Save ${on} → ${off}`);
  await key("Escape");
  await sleep(200);
  const marks = [await page.ev(`${browseMark(7)}.getAttribute('aria-pressed')`), await page.ev(`${browseMark(8)}.getAttribute('aria-pressed')`)];
  const stored = await storedLinks();
  const narrow = [await narrowPressed(keys[0]), await narrowPressed(keys[1])];
  await openSavedTab();
  const shown = [await savedShows(links[0]), await savedShows(links[1])];
  if (marks.some((p) => p !== "false")) note("unsave", `Browse marks read ${marks}`);
  if (links.some((l) => stored.includes(l))) note("unsave", "a seat is still stored");
  if (narrow.some((p) => p !== "false")) note("unsave", `the narrow panel's marks read ${narrow}`);
  if (shown.some(Boolean)) note("unsave", `the Saved tab still shows ${shown}`);
  await page.ev(`document.getElementById('tab-gallery').click()`);
  await sleep(300);
  // The Saved tab keeps a thumbnail pool of its own once it has drawn, hidden or not
  // (`saved-panel.js`), so the worker count Browse is held to is taken again here.
  const was = baseline;
  baseline = Infinity;
  for (let i = 0; i < 3; i++) {
    await sleep(700);
    baseline = Math.min(baseline, (await page.metrics()).workers);
  }
  return { marks, narrow, shown, stored: stored.length, workers: { was, now: baseline } };
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

// Last, because it leaves the narrow panel on Browse's collection, as a screensaver does.
// Screensaver from Browse: it plays Browse's collection with its mode chip, the way the
// narrow panel's would, and when it ends Browse is back on that collection and its chips.
await check("Screensaver from Browse comes back to Browse", async () => {
  await page.ev(`document.getElementById('gallery-browse').click()`);
  await until(`document.querySelectorAll('#browse-tiles .tile').length > 0`);
  await page.ev(`(() => {
    const s = document.getElementById('browse-collection');
    s.value = 'blue';
    s.dispatchEvent(new Event('change'));
  })()`);
  await sleep(1000);
  await page.ev(`document.querySelector('#browse-modes .chip').click()`);
  await page.ev(`document.querySelector('#browse-families .chip').click()`);
  await sleep(300);
  const shown = await tileCount();
  await page.ev(`document.getElementById('gallery-screensaver').click()`);
  const running = await until(`!document.getElementById('screensaver').hidden`, 40);
  if (!running) note("saver", "the screensaver did not start from Browse");
  // The address is written when its first picture is up.
  await until(`location.search.includes('panel=screensaver')`, 80);
  const address = (await page.state()).url;
  if (!address.includes("panel=screensaver") || !address.includes("collection=blue") || !address.includes("modes=")) note("saver", `its address ${address.slice(0, 160)}`);
  if (await browseUp()) note("saver", "Browse is still up over the screensaver");
  await key("Escape");
  const back = await until(`!document.getElementById('browse').hidden && document.querySelectorAll('#browse-tiles .tile').length > 0`, 40);
  if (!back) note("saver", "the screensaver did not come back to Browse");
  await sleep(500);
  const after = await page.ev(`({
    collection: document.getElementById('browse-collection').value,
    mode: document.querySelector('#browse-modes .chip[aria-pressed="true"]') !== null,
    family: document.querySelector('#browse-families .chip[aria-pressed="true"]') !== null,
    saver: !document.getElementById('screensaver').hidden,
    head: document.querySelector('#browse > .side-head') !== null,
  })`);
  const tiles = await tileCount();
  if (after.collection !== "blue" || !after.mode || !after.family || tiles !== shown) note("saver", `back on ${JSON.stringify(after)}, ${tiles} tiles, not ${shown}`);
  if (after.saver || !after.head) note("saver", `after: ${JSON.stringify(after)}`);
  // And the one way out still leaves it.
  await key("Escape");
  await sleep(600);
  if (await browseUp()) note("saver", "Esc did not leave Browse after the screensaver");
  return { shown, running, address: address.slice(0, 140), back, after, tiles };
});

record("hunt-u9.json", { rows, findings });
say(`U9 done: ${findings.length} findings`);
for (const f of findings) say("  FINDING", f.name, "—", f.why);
await page.stop();
