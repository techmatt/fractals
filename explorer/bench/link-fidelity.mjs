// A link is a picture: every way a view is reached writes a link that redraws its canvas
// *(link_fidelity_ckpt157)*.
//
// Matt saved a Phoenix view whose canvas and Saved thumbnail were solid black. The link was
// right about its picture — `c = p = 0` is a plain disk, and the frame sat inside it — and
// wrong about the wallpaper he had opened: seventeen gallery seats whose recipes named no
// Phoenix constants had been given the origin for them, where the engine means the classic
// set. So the question is put as the invariant rather than as that one path: **the link a
// page writes, opened fresh, draws the canvas the page is showing.**
//
// Two browsers. One is driven through each tab's common actions — open a tile or a
// keypoint, pan, zoom, Box, change the mode, the palette, `p` or `c`, open a Julia set and
// step back, Save, and Copy link — and after each it is let come to rest and read: the
// address, what Copy link copied, and the canvas. The other opens that address on a fresh
// load, comes to rest, and is read the same way. The two canvases are compared exactly and
// then as block means, `recolour-race.mjs`'s rule, so sampling is told apart from a
// different picture. Every family and every mode the contract lists is reached at least
// once, by a link and then by a gesture on it, and the Phoenix tab's complex `p` by each
// of its keypoints.
//
//   PORT=8000 node explorer/bench/link-fidelity.mjs [--only=<tab>,<tab>] [--no-walk]
//
// `python -m builder serve` must be up. It asserts: a step whose rest is not its own link is
// `MISMATCH` (or `COPIED` where Copy link wrote another link, `SAVED` where Save kept
// another) and the exit is non-zero. It is no part of `builder check`: it needs a browser and
// about ten minutes, most of them the Walk and the Deep tab coming to rest.

import { spawnSync } from "node:child_process";

import { CONSTANTS as ANCHORS } from "../catalog.js";
import { FAMILIES, MODES } from "../permalink.js";
import { Page, say, sleep } from "./hunt/lib.mjs";
import { record } from "./output.mjs";

const option = (name) => process.argv.find((arg) => arg.startsWith(`--${name}=`))?.split("=")[1];
const only = option("only")?.split(",") ?? null;
const walk = !process.argv.includes("--no-walk");

// ------------------------------------------------------------------------ reading

/** A digest and a coarse picture of the canvas, and the address, read in the page. */
const READ = `(() => {
  const c = document.getElementById("canvas");
  const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
  let h = 2166136261;
  for (let i = 0; i < d.length; i++) { h ^= d[i]; h = Math.imul(h, 16777619) >>> 0; }
  const BX = 48, BY = 27, blocks = [];
  let dark = 0;
  for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] < 12) dark++;
  for (let by = 0; by < BY; by++) for (let bx = 0; bx < BX; bx++) {
    const x0 = Math.floor(bx * c.width / BX), x1 = Math.floor((bx + 1) * c.width / BX);
    const y0 = Math.floor(by * c.height / BY), y1 = Math.floor((by + 1) * c.height / BY);
    let r = 0, g = 0, b = 0, n = 0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const i = (y * c.width + x) * 4; r += d[i]; g += d[i + 1]; b += d[i + 2]; n++;
    }
    blocks.push(r / n, g / n, b / n);
  }
  const n = document.getElementById("notice");
  return {
    hash: h, size: c.width + "x" + c.height, blocks, dark: dark / (d.length / 4),
    url: location.search.replace(/^\\?/, ""),
    refused: !n.hidden && n.textContent.trim().length > 0 ? n.textContent.trim().slice(0, 200) : null,
  };
})()`;

const QUIET = `(() => {
  const deep = document.getElementById("deep-render");
  const prog = document.getElementById("deep-progress");
  const dot = document.getElementById("render-state")?.dataset.state;
  const deepQuiet = !deep || deep.textContent !== "Cancel";
  return deepQuiet && (!prog || prog.hidden) && (dot === "final" || dot === "stopped");
})()`;

/** Rest: quiet, and the canvas and the address the same across three reads apart. */
async function rest(page, within = 240000) {
  const deadline = Date.now() + within;
  let last = null;
  let same = 0;
  while (Date.now() < deadline) {
    await sleep(600);
    if (!(await page.ev(QUIET))) {
      same = 0;
      continue;
    }
    const now = await page.ev(READ);
    same = last !== null && now.hash === last.hash && now.url === last.url ? same + 1 : 0;
    last = now;
    if (same >= 2) return now;
  }
  return null;
}

/** The studio, or the refusal, is up. */
const UP = `(() => {
  const s = document.getElementById("studio"), n = document.getElementById("notice");
  if (!s || !n) return false;
  const said = n.textContent.trim();
  return !s.hidden || (!n.hidden && said && !said.startsWith("Starting the renderer"));
})()`;

async function until(page, expression, within = 60000) {
  const deadline = Date.now() + within;
  while (Date.now() < deadline) {
    if (await page.ev(expression)) return true;
    await sleep(150);
  }
  return false;
}

async function load(page, query) {
  await page.send("Page.navigate", { url: `http://localhost:${page.port}/explorer/?${query}` });
  await sleep(150);
  await until(page, UP, 90000);
  // Copy link's clipboard, kept in the page where the harness can read it back.
  await page.ev(`(() => {
    window.__copied = null;
    navigator.clipboard.writeText = async (text) => { window.__copied = String(text); };
    return true;
  })()`);
}

function compare(a, b) {
  if (a.size !== b.size) return { exact: false, mad: Infinity, worst: Infinity };
  let sum = 0;
  let worst = 0;
  for (let i = 0; i < a.blocks.length; i++) {
    const d = Math.abs(a.blocks[i] - b.blocks[i]);
    sum += d;
    worst = Math.max(worst, d);
  }
  return { exact: a.hash === b.hash, mad: sum / a.blocks.length, worst };
}

/** A block difference past this is a different picture; sampling alone stays under it. */
const MISS = 2;

// ------------------------------------------------------------------------ gestures

const js = (source) => async (page) => page.ev(source);
const click = (selector) => js(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return "no ${selector}"; e.click(); return true; })()`);
const clickNth = (selector, n) =>
  js(`(() => { const all = [...document.querySelectorAll(${JSON.stringify(selector)})]; const e = all[${n} % Math.max(1, all.length)]; if (!e) return "no ${selector}"; e.scrollIntoView({ block: "center" }); e.click(); return all.length; })()`);
const key = (k) => js(`(() => { document.dispatchEvent(new KeyboardEvent("keydown", { key: ${JSON.stringify(k)}, bubbles: true })); return true; })()`);
const tab = (name) => click(`#tab-${name}`);
const select = (id, pick) =>
  js(`(() => { const s = document.getElementById(${JSON.stringify(id)}); const o = [...s.options].filter((o) => !o.disabled && o.value !== s.value); const want = ${JSON.stringify(pick)}; const chosen = want === null ? o[0] : o.find((x) => x.value === want); if (!chosen) return "no option " + want; s.value = chosen.value; s.dispatchEvent(new Event("change", { bubbles: true })); return chosen.value; })()`);
const type = (id, text) =>
  js(`(() => { const e = document.getElementById(${JSON.stringify(id)}); if (!e) return "no #${id}"; e.value = ${JSON.stringify(text)}; e.dispatchEvent(new Event("input", { bubbles: true })); e.dispatchEvent(new Event("change", { bubbles: true })); return true; })()`);

async function rectOf(page, selector) {
  return page.ev(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); e.scrollIntoView({ block: "center" }); const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; })()`);
}

async function mouse(page, type, x, y, extra = {}) {
  await page.send("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1, ...extra });
}

/** A drag across a share of the element, from one share of it to another. */
const drag = (selector, from, to) => async (page) => {
  const r = await rectOf(page, selector);
  const at = ([u, v]) => [r.x + u * r.w, r.y + v * r.h];
  const [x0, y0] = at(from);
  const [x1, y1] = at(to);
  await mouse(page, "mouseMoved", x0, y0, { button: "none" });
  await mouse(page, "mousePressed", x0, y0);
  for (let i = 1; i <= 8; i++) {
    await mouse(page, "mouseMoved", x0 + ((x1 - x0) * i) / 8, y0 + ((y1 - y0) * i) / 8, { buttons: 1 });
    await sleep(16);
  }
  await mouse(page, "mouseReleased", x1, y1);
  return true;
};

const tap = (selector, [u, v]) => async (page) => {
  const r = await rectOf(page, selector);
  const x = r.x + u * r.w;
  const y = r.y + v * r.h;
  await mouse(page, "mouseMoved", x, y, { button: "none" });
  await sleep(50);
  await mouse(page, "mousePressed", x, y);
  await mouse(page, "mouseReleased", x, y);
  return true;
};

const wheel = (selector, [u, v], notches) => async (page) => {
  const r = await rectOf(page, selector);
  for (let i = 0; i < Math.abs(notches); i++) {
    await page.send("Input.dispatchMouseEvent", {
      type: "mouseWheel", x: r.x + u * r.w, y: r.y + v * r.h, deltaX: 0, deltaY: notches < 0 ? -100 : 100,
    });
    await sleep(40);
  }
  return true;
};

/** Box is two clicks, not a drag: the centre, then a click away from it that sets the width
 *  and zooms. A drag leaves the tool armed with its outline painted over the picture. */
const box = async (page) => {
  await page.ev(`document.getElementById("view-box").click()`);
  const r = await rectOf(page, "#canvas");
  const [cx, cy] = [r.x + 0.45 * r.w, r.y + 0.42 * r.h];
  await mouse(page, "mouseMoved", cx, cy, { button: "none" });
  await mouse(page, "mousePressed", cx, cy);
  await mouse(page, "mouseReleased", cx, cy);
  for (let i = 1; i <= 6; i++) {
    await mouse(page, "mouseMoved", cx + i * 0.02 * r.w, cy + i * 0.012 * r.h, { button: "none" });
    await sleep(20);
  }
  const [ex, ey] = [cx + 0.12 * r.w, cy + 0.072 * r.h];
  await mouse(page, "mousePressed", ex, ey);
  await mouse(page, "mouseReleased", ex, ey);
  return true;
};

const pan = drag("#canvas", [0.5, 0.5], [0.62, 0.42]);
const zoom = wheel("#canvas", [0.55, 0.45], -3);

/** The Walk tab's run: started, and its first found tile opened once there is one. */
const walkAndOpen = async (page) => {
  await page.ev(`document.getElementById("walk-start").click()`);
  const found = await until(page, `document.querySelectorAll(".walk-tile").length > 0`, 240000);
  if (!found) return "the walk found nothing in four minutes";
  return clickNth(".walk-tile", 0)(page);
};

/** An atlas plane, then a mark on it focused so its slots show, then a slot. */
const atlasPick = (plane, mark, slot) => async (page) => {
  const ready = await until(page, `document.querySelectorAll("#atlas-host .mark").length > 0`, 60000);
  if (!ready) return "the atlas never came up";
  const said = await page.ev(`(() => {
    const planes = [...document.querySelectorAll("#atlas-host .plane")];
    const plane = planes[${plane} % planes.length];
    plane.click();
    return plane.textContent.trim();
  })()`);
  await sleep(600);
  return page.ev(`(() => {
    const marks = [...document.querySelectorAll("#atlas-host .mark")];
    const mark = marks[${mark} % marks.length];
    mark.focus();
    const slots = [...document.querySelectorAll("#atlas-host .slot")].filter((s) => !s.querySelector("img")?.hidden);
    const slot = slots[${slot} % Math.max(1, slots.length)];
    if (!slot) return "no slot on ${"$"}{mark.className}";
    slot.click();
    return ${JSON.stringify(said)} + " / " + slot.dataset.slot;
  })()`);
};

/** A family and mode reached by a link. Constants only where the family has them, so the
 *  page fills in the anchor, the way a link a reader types would. */
function linkOf(family, mode) {
  return `v=4&f=${family}&m=${mode}&p=twilight_shifted`;
}

// ------------------------------------------------------------------------ the sweep

/** Each tab: where it starts, and the steps it takes. A step is checked after it rests. */
const TABS = {
  gallery: {
    from: "v=4&p=twilight_shifted&panel=gallery",
    steps: [
      ["open tile 0", clickNth("#gallery-tiles .tile", 0)],
      ["pan", pan],
      ["zoom", zoom],
      ["mode", select("mode", null)],
      ["palette", clickNth("#palette-list .swatch", 3)],
      ["open tile 7", clickNth("#gallery-tiles .tile", 7)],
      ["Box", box],
      ["Julia here", key("j")],
      ["pan in the set", pan],
      ["Back", key("j")],
      ["stripe collection", select("gallery-collection", "stripe")],
      ["open a stripe tile", clickNth("#gallery-tiles .tile", 2)],
    ],
  },
  atlas: {
    from: "v=4&p=twilight_shifted&panel=atlas",
    steps: [
      ["plane 0, a slot", atlasPick(0, 3, 0)],
      ["pan", pan],
      ["plane 2, a slot", atlasPick(2, 5, 1)],
      ["plane 5 (Phoenix), a slot", atlasPick(5, 2, 2)],
      ["zoom", zoom],
      ["palette", clickNth("#palette-list .swatch", 9)],
    ],
  },
  walk: {
    from: "v=4&p=twilight_shifted&panel=walk",
    steps: [
      ["walk, open a found tile", walkAndOpen],
      ["pan", pan],
    ],
  },
  deep: {
    from: "dv=3&x=-0.5&y=0&w=3&p=twilight_shifted&panel=deep",
    steps: [
      ["open a deep tile", clickNth(".deep-gallery-tile", 4)],
      ["pan", pan],
      ["zoom", zoom],
      ["palette", clickNth("#palette-list .swatch", 5)],
    ],
  },
  phoenix: {
    from: "v=4&p=twilight_shifted&panel=phoenix",
    steps: [
      ...Array.from({ length: 8 }, (_, n) => [`keypoint ${n}`, clickNth("#phoenix-points .phoenix-point", n)]),
      ["pan the Phoenix set", pan],
      ["stripe", select("mode", "stripe")],
      ["palette", clickNth("#palette-list .swatch", 11)],
      ["Back to the plane", key("j")],
      ["click on the plane", tap("#phoenix-canvas", [0.42, 0.4])],
      ["p slider", type("phoenix-p", "0.25")],
      ["click on the plane at p = 0.25", tap("#phoenix-canvas", [0.55, 0.62])],
      ["a cleared p box", type("phoenix-p-value", "")],
      ["p box", type("phoenix-p-value", "-0.3")],
      ["preview on", click("#phoenix-preview-on")],
      ["click through the preview", async (page) => {
        await tap("#phoenix-canvas", [0.47, 0.44])(page);
        await sleep(900);
        return tap("#phoenix-canvas", [0.47, 0.44])(page);
      }],
      ["a keypoint, then the slider", async (page) => {
        await clickNth("#phoenix-points .phoenix-point", 3)(page);
        await rest(page);
        return type("phoenix-p", "-0.6")(page);
      }],
      ["and a click on that plane", tap("#phoenix-canvas", [0.5, 0.5])],
      ["c typed", type("constant-cx", "0.3")],
    ],
  },
  saved: {
    from: "v=4&f=julia&cx=-0.4&cy=0.6&m=tia&p=twilight_shifted&panel=saved",
    steps: [
      ["open a keypoint's set and save", async (page) => {
        await tab("phoenix")(page);
        await until(page, `document.querySelectorAll("#phoenix-points .phoenix-point").length > 0`);
        await clickNth("#phoenix-points .phoenix-point", 5)(page);
        await rest(page);
        await click("#save-view")(page);
        return tab("saved")(page);
      }],
      ["reopen it from Saved", clickNth("#saved-tiles .saved-tile", 0)],
      ["open the first saved", clickNth("#saved-tiles .saved-tile", 0)],
    ],
  },
  families: {
    from: "v=4&p=twilight_shifted",
    // Every family and every mode at least once: a link, then a gesture on it.
    steps: MODES.flatMap((mode, n) => {
      const family = FAMILIES[n % FAMILIES.length];
      return [
        [`link ${family} ${mode}`, async (page) => load(page, linkOf(family, mode))],
        [`pan ${family} ${mode}`, pan],
      ];
    }).concat(
      FAMILIES.slice(MODES.length).flatMap((family) => [
        [`link ${family} smooth`, async (page) => load(page, linkOf(family, "smooth"))],
        [`pan ${family} smooth`, pan],
      ]),
    ),
  },
};

const DEBUG = Number(process.env.DEBUG_PORT ?? 9441);

async function fresh(debug) {
  return new Page({ width: 1400, height: 900, debug }).start();
}
async function finish(page) {
  if (process.platform === "win32" && page.proc?.pid) {
    spawnSync("taskkill", ["/T", "/F", "/PID", String(page.proc.pid)], { stdio: "ignore" });
  }
  await page.stop().catch(() => {});
}

/** The keys a page carries and the picture ignores (`permalink.js`'s UI keys): Copy link and
 *  Save leave them out, so an address is held to what they write without them. */
const UI_KEYS = ["panel", "every", "collection", "modes", "hue"];
const pictureOf = (query) =>
  query
    .split("&")
    .filter((part) => !UI_KEYS.includes(part.split("=")[0]))
    .join("&");

/** One step: act, rest, copy, and hold the rest to a fresh load of its own address. */
async function step(driver, checker, tabName, name, act) {
  const row = { tab: tabName, step: name };
  row.did = await act(driver);
  const after = await rest(driver);
  if (after === null) return { ...row, verdict: "BUSY", error: "never came to rest" };
  row.url = after.url;
  row.dark = Number(after.dark.toFixed(3));
  if (after.refused) return { ...row, verdict: "REFUSED", said: after.refused };
  await driver.ev(`window.__copied = null; document.getElementById("copy").click(); true`);
  await until(driver, `window.__copied !== null`, 3000);
  const copied = await driver.ev(`window.__copied`);
  const copiedQuery = typeof copied === "string" ? (copied.split("?")[1] ?? "") : null;
  if (copiedQuery !== null && copiedQuery !== pictureOf(after.url)) {
    row.copied = copiedQuery;
  }
  await load(checker, after.url);
  const again = await rest(checker);
  if (again === null) return { ...row, verdict: "BUSY", error: "the fresh load never came to rest" };
  if (again.refused) return { ...row, verdict: "REFUSED", said: again.refused };
  const found = compare(after, again);
  Object.assign(row, found, again.url === after.url ? {} : { freshUrl: again.url });
  row.verdict = found.exact ? "exact" : found.mad < MISS && found.worst < 8 * MISS ? "close" : "MISMATCH";
  if (row.copied !== undefined && row.verdict !== "MISMATCH") row.verdict = "COPIED";
  return row;
}

/** Save's own check: the link the Saved list holds is the address the view was saved at. */
async function savedLinks(page) {
  return page.ev(`(() => {
    try { return (JSON.parse(localStorage.getItem("fractal-website.explorer.saved")).items ?? []).map((i) => i.link); }
    catch { return []; }
  })()`);
}

let driver = await fresh(DEBUG);
let checker = await fresh(DEBUG + 1);
const rows = [];
let misses = 0;
try {
  for (const [tabName, { from, steps }] of Object.entries(TABS)) {
    if (only !== null && !only.includes(tabName)) continue;
    if (tabName === "walk" && !walk) continue;
    await load(driver, from);
    await rest(driver);
    for (const [name, act] of steps) {
      let row;
      try {
        row = await step(driver, checker, tabName, name, act);
      } catch (error) {
        row = { tab: tabName, step: name, verdict: "ERROR", error: String(error.message ?? error).slice(0, 200) };
        await finish(driver);
        await finish(checker);
        driver = await fresh(DEBUG);
        checker = await fresh(DEBUG + 1);
        await load(driver, from);
      }
      if (tabName === "saved" && row.url) {
        const held = await savedLinks(driver);
        if (name.endsWith("save") && !held.some((link) => link === pictureOf(row.url))) {
          row.saved = held;
          if (row.verdict === "exact" || row.verdict === "close") row.verdict = "SAVED";
        }
      }
      const logs = driver.drain();
      if (logs.length > 0) row.logs = logs.slice(0, 5);
      if (!["exact", "close"].includes(row.verdict)) misses++;
      say(
        `${tabName} · ${name}: ${row.verdict}` +
          (row.mad !== undefined && Number.isFinite(row.mad) ? ` mad ${row.mad.toFixed(2)} worst ${row.worst.toFixed(1)}` : "") +
          (row.error ? ` (${row.error})` : "") +
          (row.said ? ` (${row.said})` : "") +
          (row.copied !== undefined ? ` copied ${row.copied}` : ""),
      );
      rows.push(row);
    }
  }
} finally {
  await finish(driver);
  await finish(checker);
}

const reached = {
  families: [...new Set(rows.map((r) => /(?:^|&)f=([^&]+)/.exec(r.url ?? "")?.[1] ?? (r.url ? "mandelbrot" : null)).filter(Boolean))],
  modes: [...new Set(rows.map((r) => /(?:^|&)m=([^&]+)/.exec(r.url ?? "")?.[1] ?? (r.url && !r.url.startsWith("dv=") ? "smooth" : null)).filter(Boolean))],
};
const missing = {
  families: FAMILIES.filter((f) => !reached.families.includes(f)),
  modes: MODES.filter((m) => !reached.modes.includes(m)),
};
record("link-fidelity.json", { misses, missing, anchors: Object.keys(ANCHORS), rows });
say(`${rows.length} steps, ${misses} not their own link; never reached: ${JSON.stringify(missing)}`);
process.exit(misses > 0 ? 1 : 0);
