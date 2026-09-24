// How the Deep tab behaves with Auto-render on: arriving draws, and new input supersedes a
// pass in flight *(interior_seam_deep_autorender_ckpt146)*.
//
// Three scenarios, each against the served page:
//
// - `entry` opens a shallow link with `panel=deep` twice on fresh loads and asks that both
//   draw, and draw the same raster — the bug hunt's u1 finding, which was the canvas keeping
//   whatever was up because entering drew nothing.
// - `supersede` opens the anchor at 2e-11, waits for its full pass to be running, and turns
//   the wheel one notch. It times the notch to the new frame's quarter picture, and the same
//   notch again from an idle tab, alternated: the difference is what superseding costs,
//   which is the cancel's yield plus the pool's restart.
// - `burst` turns the wheel ten times at 120 ms during a pass — continuous input — and asks
//   whether any pass starts before the input stops, and how long after it the frame comes.
//
//   node explorer/bench/deep-supersede.mjs [scenario ...]    # all of them by default
//
// `python -m builder serve` must be up. It prints and records; it asserts nothing but the
// entry raster, which exits non-zero when the two loads differ.

import { open, sleep } from "./cdp.mjs";
import { record } from "./output.mjs";

const BASE = `http://localhost:${process.env.PORT ?? "8000"}/explorer/`;
const SHALLOW_DEEP = "?v=3&f=mandelbrot&x=-0.5&y=0&w=3&p=twilight_shifted&panel=deep";
const ANCHOR =
  "?dv=3&x=-0.74501772828532335842941892835857434&y=0.14993443275456819177805709088257971" +
  "&w=2e-11&p=twilight_shifted&panel=deep";
const ROUNDS = Number(process.env.ROUNDS ?? 3);

/** Every change to the progress line, stamped, from the moment this is installed. */
const TRACE = `(() => {
  window.__trace = [];
  const p = document.getElementById("deep-progress");
  const note = () => window.__trace.push([performance.now(), p.hidden ? null : p.textContent]);
  new MutationObserver(note).observe(p, { attributes: true, childList: true, subtree: true, characterData: true });
  return true;
})()`;

const HASH = `(() => {
  const c = document.getElementById("canvas");
  const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
  let h = 2166136261;
  for (let i = 0; i < d.length; i += 7) { h ^= d[i]; h = Math.imul(h, 16777619) >>> 0; }
  return h;
})()`;

const PROGRESS = `(document.getElementById("deep-progress").hidden ? "" : document.getElementById("deep-progress").textContent)`;

/** One wheel notch in, at the canvas's middle; returns the page's clock at the dispatch. */
const NOTCH = `(() => {
  const c = document.getElementById("canvas");
  const r = c.getBoundingClientRect();
  const t = performance.now();
  c.dispatchEvent(new WheelEvent("wheel", { deltaY: -100, clientX: r.left + r.width * 0.5, clientY: r.top + r.height * 0.5, bubbles: true, cancelable: true }));
  return t;
})()`;

async function load(page, query) {
  await page.evaluate(`location.href = ${JSON.stringify(BASE + query)}`);
  await sleep(500);
  await page.until(`!!document.getElementById("deep-progress") && document.querySelector(".viewer.is-deep") !== null`, { within: 60000 });
  await page.evaluate(TRACE);
}

/** Idle: nothing drawing, and past the settle timer. */
async function idle(page, within = 180000) {
  await sleep(450);
  return page.until(`document.getElementById("deep-progress").hidden && document.getElementById("deep-render").textContent !== "Cancel"`, { within, every: 25 });
}

/** From the trace, for the pass begun after `after`: when it began — the first line after
 *  `after` that is not a full stage, since a pass in flight at `after` is still in its own
 *  full stage — and when its full stage first shows, which is the moment its quarter picture
 *  is up. `{ began, quarter }`, either `null` if it never came. */
async function passAfter(page, after, within = 180000) {
  const deadline = Date.now() + within;
  for (;;) {
    const hit = await page.evaluate(`(() => {
      const t = window.__trace;
      const i = t.findIndex(([at, s]) => at > ${after} && s !== null && !s.startsWith("full"));
      if (i < 0) return null;
      const j = t.findIndex(([at, s], k) => k > i && s !== null && s.startsWith("full"));
      return { began: t[i][0], quarter: j < 0 ? null : t[j][0] };
    })()`);
    if (hit !== null && hit.quarter !== null) return hit;
    if (Date.now() > deadline) return hit ?? { began: null, quarter: null };
    await sleep(20);
  }
}

const SCENARIOS = {
  async entry(page) {
    const hashes = [];
    const times = [];
    for (let i = 0; i < 2; i++) {
      const started = Date.now();
      await load(page, SHALLOW_DEEP);
      await idle(page);
      times.push(Date.now() - started);
      hashes.push(await page.evaluate(HASH));
    }
    const drew = await page.evaluate(`document.getElementById("deep-stats").textContent`);
    return { hashes, same: hashes[0] === hashes[1], times, stats: drew };
  },

  async supersede(page) {
    const rows = [];
    for (let round = 0; round < ROUNDS; round++) {
      for (const busy of round % 2 === 0 ? [true, false] : [false, true]) {
        await load(page, ANCHOR);
        if (busy) {
          await page.until(`(${PROGRESS}).startsWith("full")`, { within: 120000, every: 10 });
          await sleep(1500);
        } else {
          await idle(page);
        }
        const at = await page.evaluate(NOTCH);
        const pass = await passAfter(page, at);
        rows.push({
          busy,
          // The settle timer is 350 ms of this; what is left is the cancel's yield.
          notchToStart: pass.began === null ? null : Math.round(pass.began - at),
          notchToQuarter: pass.quarter === null ? null : Math.round(pass.quarter - at),
        });
        await idle(page);
      }
    }
    const median = (xs) => {
      const s = xs.filter((x) => x !== null).sort((a, b) => a - b);
      return s.length ? s[Math.floor(s.length / 2)] : null;
    };
    const of = (busy, key) => median(rows.filter((r) => r.busy === busy).map((r) => r[key]));
    return {
      rows,
      startBusy: of(true, "notchToStart"),
      startIdle: of(false, "notchToStart"),
      quarterBusy: of(true, "notchToQuarter"),
      quarterIdle: of(false, "notchToQuarter"),
    };
  },

  async burst(page) {
    await load(page, ANCHOR);
    await page.until(`(${PROGRESS}).startsWith("full")`, { within: 120000, every: 10 });
    await sleep(1000);
    const first = await page.evaluate(NOTCH);
    let last = first;
    for (let i = 1; i < 10; i++) {
      await sleep(120);
      last = await page.evaluate(NOTCH);
    }
    const pass = await passAfter(page, last);
    // Anything the progress line said between the first notch and the last one that is not
    // the pass already running: a pass started mid-burst would show a quarter stage.
    const during = await page.evaluate(
      `window.__trace.filter(([t, s]) => t > ${first} && t < ${last} && s !== null && !s.startsWith("full")).length`,
    );
    return { burstMs: Math.round(last - first), startedDuringBurst: during, lastNotchToStart: pass.began === null ? null : Math.round(pass.began - last), lastNotchToQuarter: pass.quarter === null ? null : Math.round(pass.quarter - last) };
  },
};

const wanted = process.argv.slice(2);
const names = wanted.length ? wanted : Object.keys(SCENARIOS);
const page = await open({ port: 9431, width: 1400, height: 900 });
const results = {};
let failed = false;
try {
  for (const name of names) {
    results[name] = await SCENARIOS[name](page);
    console.log(name, JSON.stringify(results[name]));
    if (name === "entry" && !results[name].same) failed = true;
  }
} finally {
  await page.close();
}
record("deep-supersede.json", results);
process.exit(failed ? 1 : 0);
