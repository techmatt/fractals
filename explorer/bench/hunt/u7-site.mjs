// U7 — the rest of the site, one light pass.
//
// `builder check` already resolves every internal link statically, so this pass is only
// for what a browser sees and a static check cannot: a console that says something, an
// `<img>` whose bytes never arrived, and a figure block that is on the page but blank. The
// one page that runs code is the explorer, and `atlas/` is a redirect into its Atlas tab
// since `website_webp_and_atlas_deprecate`, so this pass does not load it.
//
// Stale counts, outdated figures and stale prose are not findings and are not looked for.
//
// usage: node explorer/bench/hunt/u7-site.mjs [debugPort]
import { readdirSync } from "node:fs";
import { record } from "../output.mjs";
import { Page, SITE, say, sleep } from "./lib.mjs";

const debug = Number(process.argv[2] ?? 9470);
const PORT = Number(process.argv[3] ?? SITE);
const page = await new Page({ debug, port: PORT }).start();
const findings = [];
const rows = [];

const PAGES = [
  "",
  ...readdirSync(new URL("../../../article/", import.meta.url)).filter((f) => f.endsWith(".html")).map((f) => `article/${f}`),
  "wallpaper-packs/",
  "palettes/all-palettes.html",
  "palettes/make-your-own.html",
  "explorer/",
];

say(`U7: ${PAGES.length} pages`);

for (const path of PAGES) {
  const name = path || "index.html";
  const row = { name };
  try {
    await page.send("Page.navigate", { url: `http://localhost:${PORT}/${path}` });
    await sleep(path === "explorer/" ? 4000 : 1800);
    const look = await page.ev(`(() => {
      const imgs = [...document.images];
      return {
        title: document.title,
        h1: document.querySelector('h1')?.textContent?.trim()?.slice(0, 60) ?? null,
        images: imgs.length,
        // Only an image that was asked for can be broken: the gallery's tiles carry a
        // data-src and no src until they scroll into view, and an img with no src reports
        // complete with a natural width of zero, which read as 967 broken pictures on the
        // first run of this unit. (No backticks here: this lives inside a template literal.)
        broken: imgs.filter((i) => i.getAttribute('src') && i.complete && i.naturalWidth === 0)
          .map((i) => i.getAttribute('src')).slice(0, 8),
        pending: imgs.filter((i) => !i.complete).length,
        rootAbsolute: [...document.querySelectorAll('[href], [src]')]
          .map((e) => e.getAttribute('href') ?? e.getAttribute('src'))
          .filter((v) => v && v.startsWith('/')).slice(0, 8),
        figures: document.querySelectorAll('.figure').length,
        emptyFigures: [...document.querySelectorAll('.figure')]
          .filter((f) => !f.querySelector('img, .well, canvas')).length,
      };
    })()`);
    Object.assign(row, look);
    if (look.broken?.length) findings.push({ name, why: `images that did not load: ${look.broken.join(", ")}` });
    if (look.rootAbsolute?.length) findings.push({ name, why: `root-absolute href/src: ${look.rootAbsolute.join(", ")}` });
    if (look.emptyFigures) findings.push({ name, why: `${look.emptyFigures} figure blocks with nothing in them` });
    if (!look.h1) findings.push({ name, why: "no h1 on the page" });
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
  say(`  ${name}: ${row.images ?? "?"} images, ${row.broken?.length ?? "?"} broken, ${row.figures ?? 0} figures`);
}

// ------------------------------------------------------- the two pages that run code

say("U7: the gallery panel's filters");
{
  const name = "gallery panel";
  await page.open("", { settle: 2500 });
  try {
    const before = await page.ev(`document.querySelectorAll('#gallery-tiles .tile').length`);
    const chips = await page.ev(`(async () => {
      const out = [];
      const all = [...document.querySelectorAll('#gallery-modes button, #gallery-hues button')];
      for (const c of all.slice(0, 8)) {
        c.click();
        await new Promise((r) => setTimeout(r, 250));
        out.push({ said: c.textContent.trim().slice(0, 24), tiles: document.querySelectorAll('#gallery-tiles .tile').length });
        c.click();
        await new Promise((r) => setTimeout(r, 150));
      }
      return out;
    })()`, 60000);
    const after = await page.ev(`document.querySelectorAll('#gallery-tiles .tile').length`);
    rows.push({ name, before, after, chips });
    if (before !== after) findings.push({ name, why: `a chip toggled on and off left ${after} tiles where there were ${before}` });
    if (chips?.some?.((c) => c.tiles === before)) {
      const dead = chips.filter((c) => c.tiles === before).map((c) => c.said);
      rows.push({ name: "chips that filtered nothing", dead });
    }
    // Every collection loads, which is the split record's own seam.
    const collections = await page.ev(`(async () => {
      const sel = document.getElementById('gallery-collection');
      const out = [];
      for (const o of [...sel.options]) {
        sel.value = o.value;
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 700));
        out.push({ name: o.textContent.trim().slice(0, 28), tiles: document.querySelectorAll('#gallery-tiles .tile').length });
      }
      return out;
    })()`, 120000);
    rows.push({ name: "collections", collections });
    const empty = (collections ?? []).filter((c) => !c.tiles);
    if (empty.length) findings.push({ name, why: `collections that showed no tiles: ${empty.map((c) => c.name).join(", ")}` });
    say(`  ${collections?.length ?? 0} collections, ${empty.length} empty`);
  } catch (e) {
    findings.push({ name, why: String(e.message).slice(0, 160) });
  }
  const said = page.drain();
  if (said.length) findings.push({ name, why: `console: ${said.join(" | ").slice(0, 300)}` });
}

say("U7: a gallery tile opens the explorer at its own picture");
{
  const name = "gallery tile link";
  try {
    // A tile is a `<button>` and not an anchor — clicking it opens the picture in place —
    // so what is checked is the click, and the link line beside the grid separately.
    const clicked = await page.ev(`(() => {
      const before = location.search;
      document.querySelector('#gallery-tiles .tile')?.click();
      return before;
    })()`);
    await sleep(2500);
    const moved = await page.ev(`location.search`);
    rows.push({ name: "tile click", from: String(clicked).slice(0, 50), to: String(moved).slice(0, 70) });
    if (clicked === moved) findings.push({ name, why: "clicking a gallery tile did not open anything" });
    const href = await page.ev(`(() => {
      const a = document.querySelector('#gallery-tiles a[href*="?"], .tile-link, #gallery-tiles a');
      return a?.getAttribute('href') ?? null;
    })()`);
    if (!href) {
      rows.push({ name, note: "no anchor beside the tiles; the tile itself is the control" });
    } else {
      const query = href.includes("?") ? `?${href.split("?")[1]}` : "";
      const answered = await page.open(query, { settle: 1500 });
      rows.push({ name, href: href.slice(0, 100), answered });
      if (answered !== "studio") findings.push({ name, why: `a tile's own link is refused: ${(await page.refused()).said}` });
      say(`  ${answered}`);
    }
  } catch (e) {
    findings.push({ name, why: String(e.message).slice(0, 160) });
  }
  page.drain();
}

say("U7: the atlas");
{
  const name = "atlas";
  try {
    await page.send("Page.navigate", { url: `http://localhost:${PORT}/atlas/` });
    await sleep(3500);
    const look = await page.ev(`(() => ({
      dots: document.querySelectorAll('svg circle, .mark, canvas').length,
      controls: [...document.querySelectorAll('button, select')].map((b) => (b.textContent || b.id).trim().slice(0, 20)).slice(0, 14),
      links: [...document.querySelectorAll('a[href*="explorer"]')].length,
    }))()`);
    rows.push({ name, ...look });
    if (!look.dots) findings.push({ name, why: "the atlas drew nothing" });
    // And one of its links into the explorer opens.
    const href = await page.ev(`document.querySelector('a[href*="explorer"]')?.getAttribute('href') ?? null`);
    if (href && href.includes("?")) {
      const answered = await page.open(`?${href.split("?")[1]}`, { settle: 1500 });
      rows.push({ name: "atlas link", href: href.slice(0, 100), answered });
      if (answered !== "studio") findings.push({ name: "atlas link", why: `refused: ${(await page.refused()).said}` });
    }
    say(`  ${look.dots} marks, ${look.links} links into the explorer`);
  } catch (e) {
    findings.push({ name, why: String(e.message).slice(0, 160) });
  }
  const said = page.drain();
  if (said.length) findings.push({ name, why: `console: ${said.join(" | ").slice(0, 300)}` });
}

record("hunt-u7.json", { rows, findings });
say(`U7 done: ${findings.length} findings`);
for (const f of findings) say("  FINDING", f.name, "—", f.why);
await page.stop();
