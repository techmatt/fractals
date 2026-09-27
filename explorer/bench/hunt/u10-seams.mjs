// U10 — the seams between the viewer and Browse *(explorer_render_seams_ckpt153)*: one user
// action is one render, the picture the reader clicked is on the canvas at once, and a view
// opened out of Browse lands as quickly as the same link opened fresh.
//
// It reads two witnesses the page keeps on `globalThis`: `__viewer`, the viewer's passes —
// begun, overtaken, landed, and what started each — and `__browse`, the preview's. For each
// action it takes both before and after and asserts the difference:
//
//   open a link              one viewer pass, landed, and nothing else
//   press Browse mid-render  the viewer's pass stops, and nothing starts
//   Esc out of Browse        the pass Browse stopped drawn again, once; a viewer that had
//                            landed left alone
//   open a preview           one preview render
//   step → and ←             one preview render each
//   Open in explorer         one viewer pass and no preview render, the overtaken preview
//                            cancelled once, the preview's picture on the canvas at once,
//                            and time to final within `SLOWER_BY` of a fresh open
//   a narrow-panel tile      one viewer pass, the tile's picture on the canvas at once
//
// **The fresh open it is held to is a page load of the same link**, and Open in explorer
// always opens a seat the viewer has not drawn in that page: the viewer keeps its fields, so
// a seat it already holds lands in a recolour's time and would prove nothing. Matt's link is
// one of the two, the case the prompt came with: a Phoenix seat in `collection=all`.
//
// usage: node explorer/bench/hunt/u10-seams.mjs [debugPort] [sitePort]
import { record } from "../output.mjs";
import { Page, SITE, say, sleep } from "./lib.mjs";

const debug = Number(process.argv[2] ?? 9491);
const port = Number(process.argv[3] ?? SITE);

const MATT =
  "v=4&f=phoenix&cx=0.4507380371623594&cy=0.13346705902013667&px=0.8375476102242677&py=0.4087796988016554&zx=0.0&zy=0.0&m=smooth_mean_angle&weight=0.85&x=0.006128867032600854&y=0.8225859488340285&w=0.00017342094259689654&p=hoarfrost-25&phase=0.043348&level=band_autolevel/v1:0.3162801085747081,0.9458416553754185,0.9529936456122116,0.3008176686683185,0.9458416553754185";
const MATT_SEAT = "049a89bf5ef08c2f";
/** A second seat of the union, a Phoenix at `smooth_angle_min`, for the mid-preview Open. */
const OTHER_SEAT = "78ae27b80f679b1c";
const HOME = "v=4&f=mandelbrot&x=-0.5&y=0&w=3&p=twilight_shifted";
const ALL = "../assets/images/galleries/seated-candidates/all.jsonl";
/** How much slower than a fresh open an Open in explorer may land before it is a finding:
 *  the two draw the same pass on the same pool, so this is room for noise and nothing else. */
const SLOWER_BY = 1.25;
/** The most a picture put up at once may differ from its source, as a mean over channels of
 *  a 32 × 18 thumbnail, out of 255. A stretch of the same picture reads a few; the view the
 *  reader left reads tens. */
const SAME_PICTURE = 12;

const page = await new Page({ debug, port }).start();
const findings = [];
const rows = [];
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
  say(`  ${name}: ${JSON.stringify(row).slice(0, 320)}`);
}

async function until(expression, limit = 240, step = 100) {
  for (let i = 0; i < limit; i++) {
    if (await page.ev(expression)) return true;
    await sleep(step);
  }
  return false;
}

const key = async (name) => {
  const code = { ArrowLeft: 37, ArrowRight: 39, Escape: 27 }[name];
  const common = { key: name, code: name, windowsVirtualKeyCode: code };
  await page.send("Input.dispatchKeyEvent", { type: "rawKeyDown", ...common });
  await page.send("Input.dispatchKeyEvent", { type: "keyUp", ...common });
};

/** Both witnesses, the viewer's dot, and the page's clock. */
const both = () =>
  page.ev(`({
    viewer: { ...globalThis.__viewer, log: globalThis.__viewer.log.map((e) => ({ ...e })) },
    browse: { ...globalThis.__browse },
    dot: document.getElementById('render-state').dataset.state,
    now: performance.now(),
  })`);

/** What moved between two readings, and the viewer passes begun since the first. */
function moved(a, b) {
  const since = b.viewer.log.slice(b.viewer.log.length - (b.viewer.started - a.viewer.started));
  return {
    viewer: {
      started: b.viewer.started - a.viewer.started,
      cancelled: b.viewer.cancelled - a.viewer.cancelled,
      final: b.viewer.final - a.viewer.final,
    },
    browse: { started: b.browse.started - a.browse.started, cancelled: b.browse.cancelled - a.browse.cancelled },
    passes: since.map((e) => ({ trigger: e.trigger, ended: e.ended, ms: e.ms, after: Math.round(e.at - a.now) })),
  };
}

const viewerQuiet = () => until(`['final', 'stopped'].includes(document.getElementById('render-state').dataset.state)`, 600);
const previewSettled = (target) =>
  until(`globalThis.__browse.settled === ${JSON.stringify(target)} && document.getElementById('browse-state').dataset.state === 'final'`, 600);
const enterBrowse = async () => {
  await page.ev(`document.getElementById('gallery-browse').click()`);
  return until(`!document.getElementById('browse').hidden && document.querySelectorAll('#browse-tiles .tile').length > 0`);
};
const browseTile = (seat) => `document.querySelector('#browse-tiles .tile[data-key="${seat}"]')`;
const seatLink = (seat) =>
  page.ev(`(async () => {
    const text = await (await fetch(${JSON.stringify(ALL)})).text();
    return text.split('\\n').filter(Boolean).map(JSON.parse).find((r) => r.key === ${JSON.stringify(seat)}).link;
  })()`);

/** In the page: a 32 × 18 thumbnail of an image or a canvas, and the mean channel
 *  difference of two. Drawn through a canvas of its own, so the viewer's is never read back.
 *  At `high` smoothing, because the default samples so sparsely that a 316-pixel tile and
 *  the same tile stretched to the canvas read 15.7 apart — measured, with the canvas 0.0
 *  from the stretch itself — and `high` reads them 4.6. */
const THUMBS = `
  const thumb = (element) => {
    const c = document.createElement('canvas');
    c.width = 32; c.height = 18;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.imageSmoothingQuality = 'high';
    g.drawImage(element, 0, 0, 32, 18);
    return g.getImageData(0, 0, 32, 18).data;
  };
  const apart = (a, b) => {
    let sum = 0;
    for (let i = 0; i < a.length; i += 4) sum += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
    return +(sum / (a.length * 0.75)).toFixed(1);
  };`;

/** Click `click`, and read in the same task how far the viewer's canvas is from `source`
 *  and from what it showed before: whether the picture put up at once is the new one. */
const clickAndCompare = (source, click) =>
  page.ev(`(() => {
    ${THUMBS}
    const viewer = document.getElementById('canvas');
    const from = thumb(${source});
    const before = thumb(viewer);
    const at = performance.now();
    ${click}.click();
    const after = thumb(viewer);
    return { at, fromSource: apart(from, after), fromBefore: apart(before, after), sourceToBefore: apart(from, before) };
  })()`);

say("U10: render seams");

// Each link opened fresh twice: the first warms the server and the browser's caches, the
// second is the time Open in explorer is held to.
const fresh = {};
await check("open a link", async () => {
  const out = {};
  const other = await (async () => {
    await page.open(`?${HOME}`, { settle: 0 });
    return seatLink(OTHER_SEAT);
  })();
  for (const [name, query] of [["matt", MATT], ["other", other]]) {
    for (const round of [1, 2]) {
      await page.open(`?${query}&collection=all`, { settle: 0 });
      await viewerQuiet();
      await sleep(2500);
      const w = await both();
      const passes = w.viewer.log.map((e) => ({ trigger: e.trigger, ended: e.ended, ms: e.ms }));
      if (w.viewer.started !== 1 || w.viewer.final !== 1) note("open a link", `${name}: ${w.viewer.started} passes, ${w.viewer.final} landed: ${JSON.stringify(passes)}`);
      if (round === 2) fresh[name] = w.viewer.log.find((e) => e.ended === "final")?.ms ?? null;
      out[`${name}${round}`] = passes;
    }
  }
  return { ...out, fresh };
});

await check("press Browse mid-render", async () => {
  await page.open(`?${MATT}&collection=all`, { settle: 0 });
  await until(`globalThis.__viewer.started > 0`);
  await sleep(150);
  const a = await both();
  if (["final", "stopped"].includes(a.dot)) note("browse mid-render", "the viewer had landed before Browse was pressed; nothing was tested");
  await enterBrowse();
  await sleep(1500);
  const b = await both();
  const d = moved(a, b);
  if (d.viewer.started !== 0 || d.browse.started !== 0) note("browse mid-render", `started ${JSON.stringify(d)}`);
  if (d.viewer.final !== 0) note("browse mid-render", `the viewer's pass went on under Browse and landed: ${JSON.stringify(d.passes)}`);
  if (d.viewer.cancelled !== 1) note("browse mid-render", `the viewer's pass was not stopped: ${JSON.stringify(d.viewer)}`);
  return { ...d, dotBefore: a.dot, workers: (await page.metrics()).workers };
});

await check("Esc out of Browse draws the stopped pass again", async () => {
  const a = await both();
  await key("Escape");
  await viewerQuiet();
  await sleep(1500);
  const b = await both();
  const d = moved(a, b);
  if (await page.ev(`!document.getElementById('browse').hidden`)) note("esc", "Browse is still up");
  if (d.viewer.started !== 1 || d.viewer.final !== 1) note("esc", `an unfinished viewer came back with ${JSON.stringify(d)}`);
  return d;
});

await check("Esc out of Browse leaves a landed viewer alone", async () => {
  await enterBrowse();
  await sleep(500);
  const a = await both();
  await key("Escape");
  await sleep(1500);
  const b = await both();
  const d = moved(a, b);
  if (d.viewer.started !== 0) note("esc landed", `a landed viewer was drawn again: ${JSON.stringify(d)}`);
  return d;
});

await check("open a preview", async () => {
  await enterBrowse();
  const target = await page.ev(`document.querySelectorAll('#browse-tiles .tile')[2].dataset.key`);
  const a = await both();
  await page.ev(`document.querySelectorAll('#browse-tiles .tile')[2].click()`);
  await previewSettled(target);
  const b = await both();
  const d = moved(a, b);
  if (d.browse.started !== 1 || d.viewer.started !== 0) note("preview", JSON.stringify(d));
  return { target, ...d, took: b.browse.took };
});

await check("step → and ←", async () => {
  const out = {};
  for (const name of ["ArrowRight", "ArrowLeft"]) {
    const a = await both();
    await key(name);
    const on = await page.ev(`document.getElementById('browse-preview').dataset.key`);
    await previewSettled(on);
    const b = await both();
    const d = moved(a, b);
    if (d.browse.started !== 1 || d.viewer.started !== 0) note(`step ${name}`, JSON.stringify(d));
    out[name] = d;
  }
  await key("Escape");
  await key("Escape");
  await sleep(500);
  return out;
});

/** Preview `seat` and press Open in explorer `wait` ms after (null: once it has settled). */
async function openFromBrowse(seat, wait) {
  await enterBrowse();
  await until(`${browseTile(seat)} !== null`);
  await page.ev(`${browseTile(seat)}.click()`);
  if (wait === null) await previewSettled(seat);
  else await sleep(wait);
  const preview = await page.ev(`({ stage: globalThis.__browse.stage, drawing: globalThis.__browse.settled === null })`);
  const a = await both();
  const source = `(document.getElementById('browse-picture').hidden ? document.getElementById('browse-under') : document.getElementById('browse-picture'))`;
  const at = await clickAndCompare(source, `document.getElementById('browse-open')`);
  await viewerQuiet();
  await sleep(1500);
  const b = await both();
  const d = moved(a, b);
  const pass = b.viewer.log.at(-1);
  return { preview, at: { fromSource: at.fromSource, fromBefore: at.fromBefore, sourceToBefore: at.sourceToBefore }, ...d, toFinal: Math.round(pass.at + pass.ms - at.at) };
}

/** A page on a view that is neither seat, so neither is in the viewer's cache. */
async function freshPage() {
  await page.open(`?${HOME}&collection=all`, { settle: 0 });
  await viewerQuiet();
  await until(`document.querySelectorAll('#gallery-tiles .tile').length > 5`);
  await sleep(1000);
}

const opened = {};
await check("Open in explorer, the preview settled (Matt's link)", async () => {
  await freshPage();
  const out = await openFromBrowse(MATT_SEAT, null);
  opened.matt = out.toFinal;
  if (out.viewer.started !== 1 || out.viewer.final !== 1) note("open settled", `viewer ${JSON.stringify(out.viewer)}: ${JSON.stringify(out.passes)}`);
  if (out.browse.started !== 0) note("open settled", `a preview began: ${JSON.stringify(out.browse)}`);
  if (out.at.fromSource > SAME_PICTURE) note("open settled", `the canvas at once is not the preview's picture: ${JSON.stringify(out.at)}`);
  const url = (await page.state()).url;
  if (!url.startsWith(MATT)) note("open settled", `the address is ${url.slice(0, 80)}`);
  return out;
});

await check("Open in explorer, mid-preview", async () => {
  await freshPage();
  const out = await openFromBrowse(OTHER_SEAT, 120);
  opened.other = out.toFinal;
  if (!out.preview.drawing) note("open mid-preview", "the preview had settled before Open; nothing was tested");
  if (out.viewer.started !== 1 || out.viewer.final !== 1) note("open mid-preview", `viewer ${JSON.stringify(out.viewer)}: ${JSON.stringify(out.passes)}`);
  if (out.browse.cancelled !== 1 || out.browse.started !== 0) note("open mid-preview", `the preview was not cancelled once: ${JSON.stringify(out.browse)}`);
  if (out.at.fromSource > SAME_PICTURE) note("open mid-preview", `the canvas at once is not the preview's picture: ${JSON.stringify(out.at)}`);
  return out;
});

await check("Open in explorer is as quick as a fresh open", async () => {
  for (const name of ["matt", "other"]) {
    if (fresh[name] == null || opened[name] > fresh[name] * SLOWER_BY) note("open timing", `${name}: fresh ${fresh[name]} ms, from Browse ${opened[name]} ms`);
  }
  return { fresh, opened };
});

await check("a narrow-panel tile", async () => {
  const tile = `document.querySelectorAll('#gallery-tiles .tile')[4]`;
  await until(`${tile}?.querySelector('img')?.complete === true`);
  const a = await both();
  const at = await clickAndCompare(`${tile}.querySelector('img')`, tile);
  await viewerQuiet();
  await sleep(1500);
  const b = await both();
  const d = moved(a, b);
  if (d.viewer.started !== 1 || d.viewer.final !== 1) note("narrow tile", JSON.stringify(d));
  if (at.fromSource > SAME_PICTURE) note("narrow tile", `the canvas at once is not the tile's picture: ${JSON.stringify(at)}`);
  return { at: { fromSource: at.fromSource, fromBefore: at.fromBefore }, ...d };
});

await check("no worker left over", async () => {
  let workers = Infinity;
  for (let i = 0; i < 6; i++) {
    await sleep(700);
    workers = Math.min(workers, (await page.metrics()).workers);
  }
  return { workers, pools: await page.ev(`globalThis.__browse.pool`) };
});

record("hunt-u10.json", { rows, findings });
say(`U10 done: ${findings.length} findings`);
for (const f of findings) say("  FINDING", f.name, "—", f.why);
await page.stop();
