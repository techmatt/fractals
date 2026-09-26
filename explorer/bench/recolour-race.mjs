// Once the explorer is idle, the canvas is a fresh render of the address bar
// *(deep_leveled_link_and_recolour_ckpt150)*.
//
// Matt's report: he opened a deep link in glowdon, picked Rose Furnace, and the address bar
// said Rose Furnace while the picture stayed glowdon under a green bar. It did not happen
// again when he repeated it, so it is a race and not a path, and the question is put as the
// invariant it breaks rather than as that one sequence: **a page at rest shows the picture
// its own link opens.** Each trial opens a link, fires colour changes at a moment in the
// page's own life — its first stage, the arrival fit, the cap probe, a recolour in flight,
// back to back — waits for rest, and reads the canvas and the address. Then it opens that
// address on a fresh load, waits for rest again, and compares the two canvases: exactly,
// and as block means where they are not exact, so a real miss is told apart from sampling.
//
//   node explorer/bench/recolour-race.mjs [--quick] [--at=<moment>] [--only=<a>,<b+c>] [scenario ...]
//
// The moments are the page's, never a clock's. A delay on a clock lands somewhere else on
// a faster machine, or a busier one, which is how a race hides; a moment is read off the
// page's own status — `deep-progress` and the render dot — and a trial fires at it. An
// offset after the moment was tried and dropped: on a loaded machine it lands wherever the
// scheduler puts it, and it found nothing the moment alone did not.
//
// `python -m builder serve` must be up. Like `deep-stall.mjs` beside it, this one asserts:
// a trial whose rest disagrees with its own link is `MISMATCH` and the exit is non-zero. It
// is no part of `builder check`, because it needs a browser and a quarter of an hour.

import { spawnSync } from "node:child_process";

import { Page, say, sleep } from "./hunt/lib.mjs";
import { record } from "./output.mjs";

const quick = process.argv.includes("--quick");
const asked = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
/** `--at=quarter` and `--only=phase` narrow a run to one moment and to one action or burst. */
const option = (name) => process.argv.find((arg) => arg.startsWith(`--${name}=`))?.split("=")[1];
const onlyAt = option("at");
const onlyActions = option("only")?.split(",");

// The video's final frame, as `deep-final-colorings` links it: Matt's report was this link.
const FINAL =
  "dv=3&x=-0.74937053247003823168823992075369&y=0.041472667068168900034718746387049" +
  "&w=3.4869054402668363e-15";
const ABSOLUTE = `${FINAL}&n=63534&p=glowdon&scale=absolute&lambda=0&period=0.25&panel=deep`;
/** No `scale`: the arrival fit runs, off the quarter pass and again off the full one. */
const FITTED = `${FINAL}&n=63534&p=glowdon&lambda=0&period=2.14&panel=deep`;
/** No `n`: Render probes the cap. */
const PROBED = `${FINAL}&p=glowdon&scale=absolute&lambda=0&period=0.25&panel=deep`;
const SHALLOW = "v=4&f=mandelbrot&x=-0.7453&y=0.1127&w=0.0065&m=smooth&p=glowdon&scale=absolute&lambda=0&period=0.5";

// ------------------------------------------------------------------------ the actions

const key = (k) =>
  `(() => { window.dispatchEvent(new KeyboardEvent("keydown", { key: ${JSON.stringify(k)}, bubbles: true })); return true; })()`;
const click = (selector) =>
  `(() => { const b = document.querySelector(${JSON.stringify(selector)}); if (!b || b.hidden || b.disabled) return false; b.click(); return true; })()`;
const box = (id, value) =>
  `(() => { const b = document.getElementById(${JSON.stringify(id)}); if (!b) return false; b.value = ${JSON.stringify(String(value))}; b.dispatchEvent(new Event("change")); return true; })()`;
/** A drag on a slider: several `input`s, then the `change` of the release. */
const drag = (id, fractions) => `(async () => {
  const s = document.getElementById(${JSON.stringify(id)})?.closest(".group")?.querySelector("input.slider");
  if (!s) return false;
  const lo = Number(s.min), hi = Number(s.max);
  for (const f of ${JSON.stringify(fractions)}) {
    s.value = String(lo + (hi - lo) * f);
    s.dispatchEvent(new Event("input"));
    await new Promise((r) => setTimeout(r, 16));
  }
  s.dispatchEvent(new Event("change"));
  return true;
})()`;
/** A row of the picker that is not the map up, by position among the rows shown. */
const pick = (n) => `(() => {
  const up = document.getElementById("palette-shown")?.textContent;
  const rows = [...document.querySelectorAll("#palette-list button[data-palette]")]
    .filter((row) => !row.getAttribute("aria-selected") || row.getAttribute("aria-selected") === "false");
  if (rows.length === 0) return false;
  const row = rows[${n} % rows.length];
  row.click();
  return row.dataset.palette;
})()`;

const ACTIONS = {
  pick: pick(5),
  pick2: pick(11),
  randomPalette: key("p"),
  randomPhase: key("h"),
  phase: box("shade-phase", "0.613"),
  phaseDrag: drag("shade-phase", [0.1, 0.3, 0.5, 0.7]),
  lambda: box("shade-lambda", "0.35"),
  lambdaDrag: drag("shade-lambda", [0.2, 0.4, 0.6]),
  period: box("shade-period", "0.9"),
  periodDrag: drag("shade-period", [0.45, 0.5, 0.55]),
  leveled: click('.scale-switch [data-scale="leveled"]'),
  absolute: click('.scale-switch [data-scale="absolute"]'),
  fit: key("f"),
  reset: click("#palette-reset"),
  hold: click("#hold-toggle"),
  // Out to Saved and straight back to whichever tab was up. Coming back to Deep carries the
  // viewer's frame in, which found two ways a picture depended on history rather than on
  // its link *(deep_orbit_history_ckpt150)*: the pool drew the carried frame off the deep
  // link's reference orbit rather than the frame's own, and on a cold browser the pass
  // leaving the tab started put the viewer's own picture over the deep one. It sat behind a
  // `--away` flag while the first was a known finding; both are fixed, and it runs by
  // default.
  away: `(() => {
    const up = document.querySelector('.tab[aria-selected="true"]');
    document.getElementById("tab-saved").click();
    up.click();
    return up.id;
  })()`,
};

/**
 * What a single action must still say once the page is at rest: the value the reader set,
 * as the address carries it. A picture that agrees with its link but not with the reader —
 * a fit that lands after a hand-set phase and overwrites it — is a race the canvas
 * comparison cannot see, so it is asked separately. A pick is held to the row it clicked.
 */
const KEPT = {
  phase: /[?&]phase=0\.613(&|$)/,
  lambda: /[?&]lambda=0\.35(&|$)/,
  period: /[?&]period=0\.9(&|$)/,
  // Leveled is the shallow contract's default and a shallow link leaves it out, so what is
  // asked of both contracts is that the link is not Absolute.
  leveled: { test: (url) => !/[?&]scale=absolute(&|$)/.test(url) },
};

/** One colour change of each kind, alone; and the runs back to back. */
const SINGLES = Object.keys(ACTIONS).map((name) => [name]);
const BURSTS = [
  ["pick", "phase", "pick2"],
  ["hold", "lambda", "pick"],
  ["randomPalette", "randomPalette", "randomPhase", "randomPalette"],
  ["absolute", "fit", "pick", "periodDrag"],
  ["leveled", "pick", "absolute"],
  ["reset", "pick", "fit"],
  ["pick", "hold", "lambdaDrag", "hold", "periodDrag"],
  ["pick", "away"],
  ["phase", "away", "pick2"],
];

// ------------------------------------------------------------------------ the moments

const DEEP_STATE = `(() => {
  const p = document.getElementById("deep-progress");
  return { text: p.hidden ? null : p.textContent, button: document.getElementById("deep-render").textContent };
})()`;

/** A moment is a predicate on the page, or a list of them met in order; a trial fires at it
 *  plus an offset. */
const MOMENTS = {
  // The studio is up. For a deep link the tab may still be mounting, and its controls are
  // held until it owns the canvas — see `mount` below.
  start: `!document.getElementById("studio").hidden`,
  // A deep link's first stage is being iterated: the tab owns the canvas.
  rendering: `!document.getElementById("deep-progress").hidden`,
  // The quarter pass has landed and the full one begun — which is where the arrival fit runs.
  quarter: `(document.getElementById("deep-progress").textContent || "").startsWith("full resolution")`,
  // The cap probe is running. On a frame this shallow it lasts milliseconds, which a poll
  // from outside the page misses every time, so this one is armed in the page instead:
  // see `ARMED`.
  probe: `(document.getElementById("deep-progress").textContent || "").startsWith("choosing")`,
  // The pass has just finished — where the arrival refit runs. It has to have been seen
  // running first: before the first pass starts, the line is hidden too.
  landed: [
    `!document.getElementById("deep-progress").hidden`,
    `document.getElementById("deep-progress").hidden && document.getElementById("deep-render").textContent !== "Cancel"`,
  ],
  // The shallow view's first stage.
  drawing: `document.getElementById("render-state").dataset.state === "rendering"`,
  sharpening: `document.getElementById("render-state").dataset.state === "sharpening"`,
};

// ------------------------------------------------------------------------ the scenarios

/**
 * Each scenario is a link, an optional step before the moment, the moments to fire at and
 * the offsets after each. The deep ones are Matt's frame; the shallow one is a frame of the
 * same palette in the viewer, which shares the shade worker with the Deep tab.
 */
const SCENARIOS = {
  deepFirst: { link: ABSOLUTE, moments: ["rendering", "quarter", "landed"], offsets: [0] },
  deepFit: { link: FITTED, moments: ["rendering", "quarter", "landed"], offsets: [0] },
  // The moment the studio shows, before the tab owns the canvas: a colour set here is held
  // off (`locked`), so the verdict wanted is that the link's own picture is what rests.
  deepMount: { link: ABSOLUTE, moments: ["start"], offsets: [0], held: true },
  deepProbe: {
    link: PROBED,
    before: rest,
    trigger: click("#deep-render"),
    moments: ["probe", "quarter"],
    offsets: [0],
  },
  deepIdle: { link: ABSOLUTE, before: rest, moments: ["start"], offsets: [0], idle: true },
  shallow: { link: SHALLOW, moments: ["start", "drawing", "sharpening"], offsets: [0] },
  shallowIdle: { link: SHALLOW, before: rest, moments: ["start"], offsets: [0], idle: true },
};

// ------------------------------------------------------------------------ rest and reading

/** A digest and a coarse picture of the canvas, read in the page. */
const READ = `(() => {
  const c = document.getElementById("canvas");
  const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
  let h = 2166136261;
  for (let i = 0; i < d.length; i++) { h ^= d[i]; h = Math.imul(h, 16777619) >>> 0; }
  const BX = 48, BY = 27, blocks = [];
  for (let by = 0; by < BY; by++) for (let bx = 0; bx < BX; bx++) {
    const x0 = Math.floor(bx * c.width / BX), x1 = Math.floor((bx + 1) * c.width / BX);
    const y0 = Math.floor(by * c.height / BY), y1 = Math.floor((by + 1) * c.height / BY);
    let r = 0, g = 0, b = 0, n = 0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const i = (y * c.width + x) * 4; r += d[i]; g += d[i + 1]; b += d[i + 2]; n++;
    }
    blocks.push(r / n, g / n, b / n);
  }
  return { hash: h, size: c.width + "x" + c.height, blocks, url: location.search.replace(/^\\?/, "") };
})()`;

const QUIET = `(() => {
  const deep = document.getElementById("deep-render");
  const prog = document.getElementById("deep-progress");
  const dot = document.getElementById("render-state")?.dataset.state;
  const deepQuiet = !deep || deep.textContent !== "Cancel";
  return deepQuiet && (!prog || prog.hidden) && (dot === "final" || dot === "stopped");
})()`;

/** Rest: quiet, and the canvas and the address the same across three reads a second apart. */
async function rest(page, within = 240000) {
  const deadline = Date.now() + within;
  let last = null;
  let same = 0;
  while (Date.now() < deadline) {
    await sleep(700);
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

async function moment(page, predicate, within = 180000) {
  const deadline = Date.now() + within;
  for (const each of [predicate].flat()) {
    for (;;) {
      if (await page.ev(each)) break;
      if (Date.now() > deadline) return false;
      await sleep(8);
    }
  }
  return true;
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

/**
 * The moments a poll cannot catch: an element and the condition on it that opens each. For
 * these the actions are handed to the page first, and a `MutationObserver` on the element
 * fires them in the page the moment the condition holds — the cap probe on a frame this
 * shallow, and the viewer's sharpening stage, each last milliseconds.
 */
const ARMED = {
  probe: { id: "deep-progress", when: `(el.textContent || "").startsWith("choosing")` },
  sharpening: { id: "render-state", when: `el.dataset.state === "sharpening"` },
};

async function armed(page, { id, when }, actions) {
  const sources = actions.map((name) => ACTIONS[name]);
  await page.ev(`(() => {
    window.__fired = null;
    const el = document.getElementById(${JSON.stringify(id)});
    const sources = ${JSON.stringify(sources)};
    const watch = new MutationObserver(async () => {
      if (window.__fired !== null || !(${when})) return;
      watch.disconnect();
      window.__fired = [];
      for (const source of sources) window.__fired.push(await (0, eval)(source));
    });
    watch.observe(el, { childList: true, characterData: true, subtree: true, attributes: true });
    return true;
  })()`);
}

/** A block difference past this is a different picture; sampling alone stays under it. */
const MISS = 2;

async function trial(page, scenario, at, offset, actions) {
  await page.send("Page.navigate", { url: `http://localhost:${page.port}/explorer/?${scenario.link}` });
  await sleep(100);
  if (!(await moment(page, MOMENTS.start))) return { error: "the studio never came up" };
  if (scenario.before) await scenario.before(page);
  let reached;
  const fired = [];
  if (ARMED[at]) {
    await armed(page, ARMED[at], actions);
    if (scenario.trigger) await page.ev(scenario.trigger);
    reached = await moment(page, `window.__fired?.length === ${actions.length}`, 60000);
    const said = (await page.ev("window.__fired")) ?? [];
    actions.forEach((name, i) => fired.push([name, said[i]]));
  } else {
    if (scenario.trigger) await page.ev(scenario.trigger);
    reached = await moment(page, MOMENTS[at], 180000);
    if (offset > 0) await sleep(offset);
    for (const name of actions) fired.push([name, await page.ev(ACTIONS[name])]);
  }
  // A moment that never came fired nothing, or fired late: the trial tested nothing, and
  // says so rather than scoring a picture nobody raced (an armed stage that was over before
  // it was armed is the usual cause).
  if (!reached) return { error: `the moment ${at} never came`, fired };
  const after = await rest(page);
  if (after === null) return { error: "never came to rest", fired };
  await page.send("Page.navigate", { url: `http://localhost:${page.port}/explorer/?${after.url}` });
  await sleep(100);
  await moment(page, MOMENTS.start);
  const fresh = await rest(page);
  if (fresh === null) return { error: "the fresh load never came to rest", fired, url: after.url };
  const found = compare(after, fresh);
  const lost =
    !scenario.held &&
    actions.length === 1 &&
    ((KEPT[actions[0]] && !KEPT[actions[0]].test(`?${after.url}`)) ||
      (actions[0].startsWith("pick") &&
        typeof fired[0][1] === "string" &&
        !after.url.includes(`p=${encodeURIComponent(fired[0][1])}&`)));
  return {
    reached,
    fired,
    url: after.url,
    freshUrl: fresh.url === after.url ? undefined : fresh.url,
    ...found,
    verdict: lost
      ? "LOST"
      : found.exact
        ? "exact"
        : found.mad < MISS && found.worst < 8 * MISS
          ? "close"
          : "MISMATCH",
  };
}

// ------------------------------------------------------------------------ the run

const DEBUG = Number(process.env.DEBUG_PORT ?? 9431);

/** A fresh browser. On Windows, killing `chrome.exe` leaves its children holding the
 *  debugging port, so the whole tree goes. */
async function fresh() {
  return new Page({ width: 1200, height: 820, debug: DEBUG }).start();
}
async function finish(page) {
  if (process.platform === "win32" && page.proc?.pid) {
    spawnSync("taskkill", ["/T", "/F", "/PID", String(page.proc.pid)], { stdio: "ignore" });
  }
  await page.stop();
}

let page = await fresh();
const rows = [];
let misses = 0;
try {
  for (const [name, scenario] of Object.entries(SCENARIOS)) {
    if (asked.length > 0 && !asked.includes(name)) continue;
    const sequences = scenario.idle
      ? [...SINGLES, ...BURSTS]
      : quick
        ? BURSTS.slice(0, 3)
        : [...SINGLES, ...BURSTS];
    for (const at of scenario.moments) {
      if (onlyAt && at !== onlyAt) continue;
      for (const offset of scenario.offsets) {
        for (const actions of sequences) {
          if (onlyActions && !onlyActions.includes(actions.join("+"))) continue;
          const row = { scenario: name, at, offset, actions: actions.join("+") };
          try {
            Object.assign(row, await trial(page, scenario, at, offset, actions));
          } catch (error) {
            // A call the page never answers is a finding and not the end of the run.
            row.error = String(error.message ?? error).slice(0, 200);
            await finish(page);
            page = await fresh();
          }
          const logs = page.drain();
          if (logs.length > 0) row.logs = logs;
          if (row.verdict === "MISMATCH" || row.verdict === "LOST" || row.error) misses++;
          say(
            `${name} @${at}+${offset} ${row.actions}: ${row.verdict ?? row.error}` +
              (row.mad !== undefined ? ` mad ${row.mad.toFixed(2)} worst ${row.worst.toFixed(1)}` : ""),
          );
          rows.push(row);
        }
      }
    }
  }
} finally {
  await finish(page);
}
record("recolour-race.json", { misses, rows });
say(`${rows.length} trials, ${misses} not at rest on their own link`);
process.exit(misses > 0 ? 1 : 0);
