// The explorer as a reader meets it: a real page, a real pool, a real canvas.
//
// The three harnesses beside this one time the arithmetic — one thread, no browser, whole
// frame in one band — and that is the right question for "what did specializing the field
// loop buy". It is the wrong question for "why does this page feel slow", because the
// answers to that live in the pool, the stages, the cancel and the main thread, none of
// which exist under Node.
//
// So this drives the committed page in headless Chrome over CDP and splits the wall time
// from an input to a finished picture into the stages it is actually made of. Four runs:
//
//   node explorer/bench/page.mjs ladder     # a fixed ladder of views, stage by stage
//   node explorer/bench/page.mjs edits      # palette, phase, level, mode, pan, zoom, resize
//   node explorer/bench/page.mjs cancel     # how long a new view waits for the old one
//   node explorer/bench/page.mjs load       # cold open: bytes, compile, first picture
//
// `python -m builder serve` must be up; pass a port as the last argument to move off 8000.
//
// **Nothing here asserts anything**, the same as the rest of `bench/`: no threshold, no
// non-zero exit, nothing in `builder check` runs it. It is how the figures under
// *Measured* in `explorer/README.md` are taken again.
//
// Two seams into the page, and both are read-only. `#render-state`'s `data-state` and
// `#stats`'s text are what a reader sees, so a `MutationObserver` on the pair is a
// timeline of the stages with no instrumentation at all. What that cannot see is inside a
// worker, and `globalThis.__render.passes` in `render.js` is a ring buffer of every band's
// rows and milliseconds — which is the only way to tell a frame that is slow because the
// recurrence is expensive from one that is slow because eleven workers spent the tail
// waiting on the twelfth.

import { open, sleep } from "./cdp.mjs";
import { record } from "./output.mjs";

const [, , run = "ladder", out = null, port = "8000"] = process.argv;
const ORIGIN = `http://localhost:${port}`;

/** How long any one view may take before the harness gives up on it and says so. */
const PATIENCE = 300000;

/** And how long a cancel gets, which is a much smaller number by construction: if the page
 *  has not started drawing the view the reader asked for within this, it is not a latency
 *  any more. Short, so a miss costs a measurement rather than a run. */
const CANCEL_PATIENCE = 30000;

/**
 * The recorder, installed before the page's own script runs.
 *
 * `longtask` buffered, so the entries from before this ran are in it too — the module
 * evaluation and the wasm compile are long tasks and they happen before anything here
 * could observe them.
 */
const RECORDER = `(() => {
  const bench = { marks: [], long: [], zero: 0, attached: false };
  globalThis.__bench = bench;
  bench.mark = (what, text) => bench.marks.push({ at: performance.now(), what, text });
  bench.reset = () => {
    bench.marks.length = 0;
    bench.long.length = 0;
    bench.zero = performance.now();
  };
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) bench.long.push({ at: entry.startTime, ms: entry.duration });
    }).observe({ type: "longtask", buffered: true });
  } catch {}
  const attach = () => {
    const state = document.getElementById("render-state");
    const stats = document.getElementById("stats");
    if (state === null || stats === null) { setTimeout(attach, 8); return; }
    bench.attached = true;
    bench.mark("state", state.dataset.state);
    new MutationObserver(() => bench.mark("state", state.dataset.state))
      .observe(state, { attributes: true, attributeFilter: ["data-state"] });
    new MutationObserver(() => bench.mark("stat", stats.textContent))
      .observe(stats, { childList: true, characterData: true, subtree: true });
  };
  attach();
})()`;

/** What the harness reads back: the timeline, the long tasks, and every band of every pass. */
const HARVEST = `(() => {
  const bench = globalThis.__bench;
  const zero = bench.zero;
  return {
    zero,
    marks: bench.marks.map((m) => ({ ...m, at: m.at - zero })),
    long: bench.long.filter((l) => l.at >= zero).map((l) => ({ ...l, at: l.at - zero })),
    passes: (globalThis.__render?.passes ?? []).map((p) => ({ ...p, at: p.at - zero })),
    grid: [document.getElementById("canvas").width, document.getElementById("canvas").height],
    cores: navigator.hardwareConcurrency,
    stats: document.getElementById("stats").textContent,
    state: document.getElementById("render-state").dataset.state,
  };
})()`;

// ------------------------------------------------------------------------------ the ladder
//
// Eight views that span the cost range, plus the two tabs that draw their own way. Each is
// a permalink, because a permalink is the one way into this page that names a whole view
// and the one thing about it that is a contract.

const LADDER = [
  { name: "home", note: "mandelbrot smooth, the home view — the cheap end", query: "v=3&f=mandelbrot&m=smooth" },
  {
    name: "spike",
    note: "the anchor `bench/kernel.mjs` uses: deep in the spike, interior-heavy",
    query: "v=3&f=mandelbrot&m=smooth&x=0.4104135054546244&y=0.20967482476903096&w=0.5622541254857749",
  },
  {
    name: "interior",
    note: "inside the main cardioid: every sample runs to the cap",
    query: "v=3&f=mandelbrot&m=smooth&x=-0.5&y=0&w=0.3",
  },
  { name: "stripe", note: "an `atan2` and a `sin` per iteration", query: "v=3&f=mandelbrot&m=stripe&density=9" },
  { name: "angle", note: "the angle reduction", query: "v=3&f=mandelbrot&m=smooth_mean_angle" },
  { name: "trap", note: "a direct trap: painted during the iteration, no field", query: "v=3&f=mandelbrot&m=direct_trap_ring&radius=0.5" },
  { name: "d6", note: "the degree-6 parameter plane", query: "v=3&f=multibrot6&m=smooth" },
  { name: "julia", note: "a dynamical plane", query: "v=3&f=julia&cx=-0.4&cy=0.6&m=smooth" },
  // The shipped `c` has an attracting cycle at degrees 3 to 6, so these homes are mostly
  // interior: the page's dearest until the engine's interior seam (ckpt146).
  { name: "julia3", note: "degree-3 Julia home: an attracting fixed point", query: "v=3&f=julia3&m=smooth" },
  { name: "julia4", note: "degree-4 Julia home: an attracting fixed point", query: "v=3&f=julia4&m=smooth" },
  { name: "julia6", note: "degree-6 Julia home: an attracting fixed point", query: "v=3&f=julia6&m=smooth" },
  {
    name: "floor",
    note: "two ulps off the `f64` wall at 1e-12, cap 53 737",
    query: "v=3&f=mandelbrot&m=smooth&x=-0.7436438870371587&y=0.13182590420531198&w=0.000000000001",
  },
];

/** The stat line's own words for each stage, as prefixes: what a mark's text is matched on. */
function stageOf(text, grid) {
  const size = `${grid[0]}×${grid[1]}`;
  if (text.startsWith(`${size} ·`)) return text.includes("iterating") ? "final-iterating" : "final-coloring";
  if (text.startsWith(`iterating at ${size}`)) return "full-iterating";
  if (text.startsWith("iterating at ")) return "preview-iterating";
  if (text.startsWith("probing at ")) return "probing";
  if (text.startsWith(size)) return "done";
  return "other";
}

/**
 * A view's timeline, reduced to the stages a reader waits through.
 *
 * Zero is the pass's **first stat line**, and deliberately not its first `rendering` state:
 * the canvas ships with `data-state="rendering"` written into the HTML, so the recorder
 * marks one the moment it attaches and a timeline zeroed on that would charge every view
 * with however long the page took to reach its first pass. `open_ms` is that offset, kept
 * rather than discarded because on a cold open it is most of the wait.
 *
 * `first` is the moment the quarter-resolution preview is on the canvas — the stat line
 * moves to the full pass in the same synchronous block as the `stretch` that put it there,
 * so the mark is the paint. `full` is the one-sample picture up, `final` the supersampled
 * one.
 */
function stagesOf(harvest) {
  const { marks, grid } = harvest;
  const start = marks.find((m) => m.what === "stat" && m.text !== "")?.at ?? 0;
  const at = (predicate) => marks.find(predicate)?.at ?? null;
  const rel = (value) => (value === null ? null : Math.round(value - start));
  const stat = (stage) => at((m) => m.what === "stat" && stageOf(m.text, grid) === stage);
  return {
    open_ms: Math.round(start),
    probe: rel(stat("probing")),
    preview: rel(stat("preview-iterating")),
    first: rel(stat("full-iterating")),
    full: rel(at((m) => m.what === "state" && m.text === "sharpening")),
    final: rel(at((m) => m.what === "state" && m.text === "final")),
    stats: harvest.stats,
  };
}

/** What the pool did, per pass: wall, worker-seconds, utilisation, and the tail. */
function poolOf(harvest) {
  return harvest.passes
    .filter((pass) => pass.elapsed !== null)
    .map((pass) => {
      const busy = pass.bands.reduce((sum, band) => sum + band.ms, 0);
      const ends = pass.bands.map((band) => band.at + band.ms);
      const last = Math.max(0, ...ends);
      // The tail is what the frame waited on after the second-slowest worker was done: a
      // band nobody could help with. It is what the duration-target re-cut is for, and
      // what says whether a finer cut would pay.
      const ordered = [...ends].sort((a, b) => b - a);
      return {
        kind: pass.kind,
        at: Math.round(pass.at),
        size: `${pass.width}×${pass.height}${pass.supersample > 1 ? `@${pass.supersample}` : ""}`,
        workers: pass.workers,
        bands: pass.bands.length,
        wall_ms: Math.round(pass.elapsed),
        worker_ms: Math.round(busy),
        utilisation: Number((busy / (pass.elapsed * pass.workers)).toFixed(3)),
        tail_ms: Math.round(last - (ordered[1] ?? last)),
        widest_band_ms: Math.round(Math.max(0, ...pass.bands.map((band) => band.ms))),
      };
    });
}

/**
 * The main thread's long tasks over a run: how many, the worst, and where each one was.
 *
 * **They are kept one by one because where one falls is the finding.** A band's cost is
 * measured on the main thread — `performance.now()` at dispatch against
 * `performance.now()` in the message handler — so a main thread blocked for a quarter of a
 * second reports a band that cost thirteen milliseconds as one that cost two hundred and
 * ninety, and the pass it belongs to genuinely does not finish until the block clears. A
 * summary would have hidden that; a list beside the stage marks shows it.
 */
function mainOf(harvest) {
  const long = harvest.long;
  return {
    tasks: long.length,
    total_ms: Math.round(long.reduce((sum, task) => sum + task.ms, 0)),
    worst_ms: Math.round(Math.max(0, ...long.map((task) => task.ms))),
    at: long.map((task) => [Math.round(task.at), Math.round(task.ms)]),
  };
}

const page = await open({ width: 1600, height: 1000 });
await page.send("Page.addScriptToEvaluateOnNewDocument", { source: RECORDER });
await page.send("Network.enable");

/** Load a view and wait for the studio to be up. */
async function openView(query, { cache = true } = {}) {
  await page.send("Network.setCacheDisabled", { cacheDisabled: !cache });
  await page.send("Page.navigate", { url: `${ORIGIN}/explorer/?${query}` });
  const up = await page.until(
    "!!document.getElementById('studio') && !document.getElementById('studio').hidden",
    { within: 60000 },
  );
  if (!up) throw new Error("the studio never came up");
  await page.until("globalThis.__bench?.attached === true", { within: 20000 });
}

/** Wait until the pass on the screen has settled, whichever way it settled. */
async function settled(within = PATIENCE) {
  return page.until(
    "['final','stopped'].includes(document.getElementById('render-state').dataset.state)",
    { within, every: 40 },
  );
}

async function harvest() {
  return page.evaluate(HARVEST);
}

// ------------------------------------------------------------------------------ ladder

async function ladder() {
  const rows = [];
  // `LADDER=interior,trap REPEAT=3` narrows and repeats, which is how a suspected
  // regression is separated from this machine's drift: the ladder takes ten minutes and a
  // reading taken ten minutes after another is not a reading of the same machine.
  const only = (process.env.LADDER ?? "").split(",").filter(Boolean);
  const chosen = only.length === 0 ? LADDER : LADDER.filter((view) => only.includes(view.name));
  const repeat = Number(process.env.REPEAT ?? 1);
  for (let pass = 0; pass < repeat; pass++)
  for (const view of chosen) {
    // A cheap load first, so what is measured is not paying for a cold open: the HTTP
    // cache, the module compile and the JIT are all warm by the time the view under
    // measurement is opened, and none of that warmth is per-mode — the modes are wasm, and
    // the module is compiled once either way. A cold open is what `page.mjs load` is for.
    await openView(LADDER[0].query);
    await settled(PATIENCE);
    await openView(view.query);
    const done = await settled(PATIENCE);
    const got = await harvest();
    const row = {
      ...view,
      grid: got.grid,
      cores: got.cores,
      settled: done ? got.state : "timed out",
      stages: stagesOf(got),
      pool: poolOf(got),
      main: mainOf(got),
      marks: got.marks,
    };
    rows.push(row);
    const s = row.stages;
    console.log(
      `${view.name.padEnd(9)} first ${String(s.first).padStart(6)} ms  ` +
        `1×  ${String(s.full).padStart(7)} ms  final ${String(s.final).padStart(7)} ms  ` +
        `· ${row.settled}`,
    );
    for (const pass of row.pool) {
      console.log(
        `             ${pass.kind} ${pass.size.padEnd(12)} ${String(pass.wall_ms).padStart(7)} ms wall  ` +
          `${String(pass.bands).padStart(3)} bands  util ${pass.utilisation.toFixed(2)}  ` +
          `tail ${String(pass.tail_ms).padStart(6)} ms  widest ${String(pass.widest_band_ms).padStart(6)} ms`,
      );
    }
    console.log(`             ${row.stats ?? ""}`);
  }
  return { run: "ladder", rows };
}

// ------------------------------------------------------------------------------ edits
//
// The interactions a reader spends their time in, each from the page's own control and
// each timed from the gesture to the picture. What matters here is which of them
// re-iterate: the header of `render.js` says a field is cached by geometry so a palette
// change re-shades, and this is where that claim is priced rather than believed.

/** Drive one interaction and time it from the call to the settled picture. */
async function interaction(name, script, { within = PATIENCE } = {}) {
  await page.evaluate("globalThis.__bench.reset()");
  const started = Date.now();
  await page.evaluate(script);
  const done = await settled(within);
  const got = await harvest();
  const stages = stagesOf(got);
  const row = {
    name,
    wall_ms: Date.now() - started,
    settled: done ? got.state : "timed out",
    stages,
    pool: poolOf(got),
    main: mainOf(got),
    stats: got.stats,
  };
  console.log(
    `${name.padEnd(16)} ${String(row.wall_ms).padStart(6)} ms  first ${String(stages.first).padStart(6)}  ` +
      `final ${String(stages.final).padStart(6)}  passes ${row.pool.length}  ` +
      `longest task ${String(row.main.worst_ms).padStart(4)} ms`,
  );
  return row;
}

/** Set a control the way a reader does, so the page's own listener runs. */
const set = (id, value, event = "change") =>
  `(() => { const el = document.getElementById(${JSON.stringify(id)});` +
  ` el.value = ${JSON.stringify(String(value))};` +
  ` el.dispatchEvent(new Event(${JSON.stringify(event)}, { bubbles: true })); return el.value; })()`;

const click = (id) => `document.getElementById(${JSON.stringify(id)}).click()`;

/** A pointer drag across the canvas: the pan a reader makes, through the page's own
 *  gesture handlers rather than through whatever function is behind them. */
const DRAG = (dx, dy) => `(() => {
  const canvas = document.getElementById("canvas");
  const box = canvas.getBoundingClientRect();
  const from = { clientX: box.left + box.width / 2, clientY: box.top + box.height / 2 };
  const make = (type, x, y) => new PointerEvent(type, {
    pointerId: 1, isPrimary: true, bubbles: true, clientX: x, clientY: y, buttons: 1,
  });
  canvas.dispatchEvent(make("pointerdown", from.clientX, from.clientY));
  canvas.dispatchEvent(make("pointermove", from.clientX + ${dx}, from.clientY + ${dy}));
  canvas.dispatchEvent(make("pointerup", from.clientX + ${dx}, from.clientY + ${dy}));
})()`;

const WHEEL = (deltaY) => `(() => {
  const canvas = document.getElementById("canvas");
  const box = canvas.getBoundingClientRect();
  canvas.dispatchEvent(new WheelEvent("wheel", {
    bubbles: true, cancelable: true, deltaY: ${deltaY},
    clientX: box.left + box.width / 2, clientY: box.top + box.height / 2,
  }));
})()`;

async function edits() {
  const rows = [];
  // A mid-cost field mode, so a re-iteration is visible against a recolour without the
  // run taking minutes: mandelbrot `smooth` at the spike anchor.
  const base = LADDER[1].query;
  await openView(base);
  await settled();

  // Two palettes in a row, so neither measurement is the one that pays for the first
  // shade of the session — the page's own note on `measure` says the first is about five
  // times a later one.
  const swatch = (nth) =>
    `(() => { const rows = [...document.getElementById("palette-list")
       .querySelectorAll("[role=option]")].filter((r) => r.getAttribute("aria-selected") !== "true");
      rows[${nth}].click(); return rows[${nth}].textContent; })()`;
  rows.push(await interaction("palette", swatch(1)));
  rows.push(await interaction("palette again", swatch(2)));
  rows.push(await interaction("phase", set("shade-phase", "0.37")));
  rows.push(await interaction("cycles", set("shade-cycles", "2.5")));
  rows.push(await interaction("gamma", set("shade-gamma", "1.4")));
  rows.push(await interaction("level off", click("level-toggle")));
  rows.push(await interaction("level on", click("level-toggle")));
  rows.push(await interaction("mode → itinerary", set("mode", "itinerary")));
  rows.push(await interaction("mode → smooth", set("mode", "smooth")));
  rows.push(await interaction("pan", DRAG(120, 60)));
  rows.push(await interaction("zoom in", WHEEL(-120)));
  rows.push(await interaction("zoom out", WHEEL(120)));
  rows.push(
    await interaction(
      "resize",
      `(async () => { window.__benchWidth = window.innerWidth; return true; })()`,
    ),
  );
  // A resize is the window's, not a control's, so it goes through the browser.
  await page.evaluate("globalThis.__bench.reset()");
  const startedResize = Date.now();
  await page.send("Emulation.setDeviceMetricsOverride", {
    width: 1400,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });
  const resized = await settled();
  const afterResize = await harvest();
  rows[rows.length - 1] = {
    name: "resize",
    wall_ms: Date.now() - startedResize,
    settled: resized ? afterResize.state : "timed out",
    stages: stagesOf(afterResize),
    pool: poolOf(afterResize),
    main: mainOf(afterResize),
    stats: afterResize.stats,
  };
  console.log(
    `${"resize".padEnd(16)} ${String(rows[rows.length - 1].wall_ms).padStart(6)} ms  ` +
      `final ${String(rows[rows.length - 1].stages.final).padStart(6)}`,
  );
  await page.send("Emulation.clearDeviceMetricsOverride");
  return { run: "edits", base, rows };
}

// ------------------------------------------------------------------------------ cancel
//
// How long the page ignores the reader. A cancel is by generation, so the band a worker is
// already inside is finished and thrown away unless it is predicted to run four targets
// past the target — see `#abandon` in `render.js`. What that costs is measured here from
// the two ends that matter: the gesture, and the first pixels of the view it asked for.

async function cancel() {
  const rows = [];
  for (const view of LADDER.filter((row) => ["spike", "trap", "floor"].includes(row.name))) {
    await openView(view.query);
    await settled();
    // Two pans the SAME way, so both geometries are ones the field cache has never held —
    // panning back would land on the frame that is still cached and be answered by a
    // recolour, which is not what a cancel costs.
    for (const wait of [80, 400, 1200]) {
      await page.evaluate("globalThis.__bench.reset()");
      await page.evaluate(DRAG(90, 50));
      await sleep(wait);
      const started = Date.now();
      await page.evaluate(DRAG(90, 50));
      // The first pixels of the pass the second pan asked for: its preview, which is the
      // second `rendering` and the full-pass stat that follows it.
      const got = await page.until(
        "(() => { const m = globalThis.__bench.marks;" +
          " const second = m.findIndex((x, i) => x.what === 'state' && x.text === 'rendering' &&" +
          " m.slice(0, i).some((y) => y.what === 'state' && y.text === 'rendering'));" +
          " if (second === -1) return false;" +
          " const size = document.getElementById('canvas').width;" +
          " return m.slice(second).some((x) => x.what === 'stat' && x.text.startsWith('iterating at ' + size));" +
          " })()",
        { within: CANCEL_PATIENCE },
      );
      const latency = Date.now() - started;
      await settled();
      const after = await harvest();
      rows.push({
        view: view.name,
        interrupted_after_ms: wait,
        latency_ms: got ? latency : null,
        found: got,
      });
      console.log(
        `${view.name.padEnd(9)} interrupted at ${String(wait).padStart(5)} ms → ` +
          (got ? `first pixels in ${String(latency).padStart(6)} ms` : "never got there"),
      );
    }
  }
  return { run: "cancel", rows };
}

// ------------------------------------------------------------------------------ load

async function load() {
  const seen = [];
  page.on((message) => {
    if (message.method === "Network.requestWillBeSent") {
      seen.push({ id: message.params.requestId, url: message.params.request.url, bytes: 0 });
    }
    if (message.method === "Network.loadingFinished") {
      const row = seen.find((entry) => entry.id === message.params.requestId);
      if (row) row.bytes = message.params.encodedDataLength;
    }
  });
  await openView(LADDER[0].query, { cache: false });
  await settled();
  const got = await harvest();
  const timing = await page.evaluate(`(() => {
    const nav = performance.getEntriesByType("navigation")[0];
    const wasm = performance.getEntriesByType("resource").find((r) => r.name.endsWith("engine.wasm"));
    return {
      responseEnd: nav?.responseEnd ?? null,
      domContentLoaded: nav?.domContentLoadedEventEnd ?? null,
      wasm_fetch_ms: wasm ? Math.round(wasm.responseEnd - wasm.startTime) : null,
      wasm_at: wasm ? Math.round(wasm.startTime) : null,
    };
  })()`);
  const total = seen.reduce((sum, row) => sum + row.bytes, 0);
  const biggest = [...seen]
    .sort((a, b) => b.bytes - a.bytes)
    .slice(0, 12)
    .map((row) => ({ file: row.url.split("/").pop().split("?")[0], kb: Math.round(row.bytes / 1024) }));
  console.log(`cold open: ${seen.length} requests, ${(total / 1024).toFixed(0)} KB on the wire`);
  console.log(
    `  first pass at ${stagesOf(got).open_ms} ms; first picture at ` +
      `${stagesOf(got).open_ms + (stagesOf(got).first ?? 0)} ms; final at ` +
      `${stagesOf(got).open_ms + (stagesOf(got).final ?? 0)} ms`,
  );
  for (const row of biggest) console.log(`  ${String(row.kb).padStart(5)} KB  ${row.file}`);
  console.log(`  longest main-thread task ${mainOf(got).worst_ms} ms of ${mainOf(got).total_ms} ms over ${mainOf(got).tasks}`);
  return {
    run: "load",
    requests: seen.length,
    wire_kb: Math.round(total / 1024),
    biggest,
    timing,
    marks: got.marks.slice(0, 40),
    stages: stagesOf(got),
    main: mainOf(got),
  };
}

// ------------------------------------------------------------------------------

const RUNS = { ladder, edits, cancel, load };
try {
  if (!(run in RUNS)) throw new Error(`no run called ${run}; one of ${Object.keys(RUNS).join(", ")}`);
  const payload = await RUNS[run]();
  record(out ?? `page-${run}.json`, { at: new Date().toISOString(), ...payload });
} finally {
  await page.close();
}
