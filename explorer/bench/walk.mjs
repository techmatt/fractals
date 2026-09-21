// The Walk tab, driven headlessly, so that what a walk costs is measured rather than felt.
//
// The harnesses beside this one ask what one frame costs. A walk is not one frame: it is a
// root search nobody watches, a descent of rungs, and a place painted several ways, and the
// question it answers — "is this too long, and which part of it is" — only exists over
// dozens of them. `Math.random` is everywhere in `walk.js` and there is no seed, so a walk
// is not repeatable and a pair of them says nothing; a distribution over thirty does.
//
//   python -m builder serve                          # in another terminal
//   node explorer/bench/walk.mjs walks               # WALKS=30 by default
//   WALKS=5 node explorer/bench/walk.mjs walks       # the pilot
//   WALKS=6 node explorer/bench/walk.mjs shots       # photograph each end frame
//
// **Nothing here asserts anything**, as everywhere else in `bench/`: no threshold, no
// non-zero exit, nothing in `builder check` runs it.
//
// The seam is `walk.js`'s `__walk`, which is read-only and was already there: `walks` is one
// row per walk — where it went, what it saw, and what each rung and each recipe cost — and
// `timings` is every step's milliseconds bucketed by kind and again by the stage it ran in.
// Nothing on the page reads either.
//
// **A judgeless run is not a reading of this tab.** The judges are 5.1 MB of ONNX and 28 MB
// of runtime, untracked, placed by `python -m builder walk`; without them the walk picks at
// random among what the screen passes, which is a different program. `gate` timings are the
// test — a coin flip is not timed — and a run that took none says so and is thrown away.

import { open, sleep } from "./cdp.mjs";
import { record } from "./output.mjs";
import { mkdirSync, writeFileSync } from "node:fs";

const [, , run = "walks", out = null, port = process.env.PORT ?? "8000"] = process.argv;
const ORIGIN = `http://localhost:${port}`;

/** How many walks a run waits for. */
const WALKS = Number(process.env.WALKS ?? 30);

/**
 * Which planes a walk may pick from, where a run says — `PLANES=multibrot6`, comma
 * separated. Empty leaves the tab's own default, which is all six.
 *
 * **A before-and-after over the default set is not a comparison**, and this is here because
 * a pair of twelve-walk runs proved it: a walk picks its plane uniformly, the families cost
 * up to 47x apart at their home views, and twelve draws are nowhere near enough to level
 * that. One run came up four phoenix and four multibrot6 and the next seven multibrot3 and
 * multibrot4, which is most of a threefold difference before any code has changed. So the
 * headline distribution is read over the default set and the controlled reading is pinned
 * to one plane, alternated.
 */
const PLANES = (process.env.PLANES ?? "").split(",").filter(Boolean);

/** How long the judges have to arrive: 33 MB over localhost, then two ONNX sessions. */
const LOADING = 180000;

/** How long one walk may take before the harness gives up on the run. A place is seconds
 *  and a descent is tens of them, so this is generous by design — a slow walk is a
 *  measurement and a stuck one is a bug. */
const PATIENCE = 420000;

/** Where a `shots` run's pictures land, beside the numbers, in ignored `artifacts/`. */
const SHOTS = new URL("../../artifacts/explorer-bench/walk-shots/", import.meta.url);

const page = await open({ width: 1600, height: 1000 });

/** Open the explorer with the Walk tab showing. `panel=walk` opens the tab; only Start
 *  starts a walk, which is the tab's own rule and is why this clicks it. */
async function openWalk() {
  await page.send("Page.navigate", { url: `${ORIGIN}/explorer/?panel=walk` });
  const up = await page.until(
    "!!document.getElementById('studio') && !document.getElementById('studio').hidden",
    { within: 60000 },
  );
  if (!up) throw new Error("the studio never came up");
  const mounted = await page.until("!!globalThis.__walk", { within: 60000 });
  if (!mounted) throw new Error("the walk never mounted");
  // The config's own Set, narrowed before Start. The checkboxes are not re-drawn from it and
  // a headless run has nobody to mislead; a run that does this records what it pinned.
  if (PLANES.length > 0) {
    await page.evaluate(
      `(() => { const planes = globalThis.__walk.config.planes; planes.clear(); ` +
        `${PLANES.map((plane) => `planes.add(${JSON.stringify(plane)});`).join(" ")} ` +
        `return [...planes]; })()`,
    );
    console.log(`pinned to ${PLANES.join(", ")}`);
  }
}

/** Press Start, and wait out the runtime and the gate. */
async function start() {
  await page.evaluate("document.getElementById('walk-start').click()");
  const going = await page.until(
    "document.getElementById('walk-start').textContent === 'Pause' && " +
      "!document.getElementById('walk-progress').textContent.startsWith('The')",
    { within: LOADING, every: 250 },
  );
  if (!going) throw new Error("the walk did not start");
}

const finished = "globalThis.__walk.walks.filter((row) => row.ms !== undefined).length";

/** Wait until `count` walks have finished, saying so as each one lands. `onWalk` is called
 *  with the number that have finished, before the next one is waited for. */
async function walksDone(count, onWalk = null) {
  let had = 0;
  const deadline = () => Date.now() + PATIENCE;
  let giveUp = deadline();
  while (had < count) {
    const now = await page.evaluate(finished);
    if (now > had) {
      had = now;
      giveUp = deadline();
      const row = await page.evaluate(`(() => {
        const row = globalThis.__walk.walks.filter((one) => one.ms !== undefined).at(-1);
        return { family: row.family, ms: row.ms, rungs: (row.rungs ?? []).length,
                 places: (row.places ?? []).length, recipes: (row.recipes ?? []).length,
                 outcome: row.outcome };
      })()`);
      console.log(
        `  walk ${String(had).padStart(2)}/${count}  ${row.family.padEnd(11)} ` +
          `${String((row.ms / 1000).toFixed(1)).padStart(6)} s  ${String(row.rungs).padStart(2)} rungs  ` +
          `${row.places} place(s)  ${row.recipes} recipe(s)  ${row.outcome}`,
      );
      if (onWalk !== null) await onWalk(had);
      continue;
    }
    if (Date.now() > giveUp) throw new Error(`walk ${had + 1} never finished`);
    await sleep(500);
  }
}

/** Everything the page knows about the run. */
async function harvest() {
  return page.evaluate(`(() => {
    const walk = globalThis.__walk;
    const each = (list) => (list ?? []).map((ms) => Math.round(ms));
    const timings = {};
    for (const [kind, list] of Object.entries(walk.timings)) timings[kind] = each(list);
    return {
      walks: walk.walks,
      timings,
      found: walk.found.length,
      progress: document.getElementById('walk-progress').textContent,
      config: {
        modes: [...walk.config.modes],
        planes: [...walk.config.planes],
        rungs: walk.config.rungs,
        julia: walk.config.julia,
        bar: walk.config.bar,
        keep: walk.config.keep,
      },
      cores: navigator.hardwareConcurrency,
    };
  })()`);
}

// ------------------------------------------------------------------------------ reading

const sum = (list) => list.reduce((a, b) => a + b, 0);
const mean = (list) => (list.length === 0 ? null : sum(list) / list.length);
function quantile(list, at) {
  if (list.length === 0) return null;
  const sorted = [...list].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(at * sorted.length))];
}
const stats = (list) => ({
  n: list.length,
  mean: mean(list) === null ? null : Math.round(mean(list)),
  median: quantile(list, 0.5),
  p10: quantile(list, 0.1),
  p90: quantile(list, 0.9),
  total_s: Number((sum(list) / 1000).toFixed(1)),
});

/**
 * **What a step is, counted the way a reader sees one**: a card in the walk strip. The root
 * frame is one, every rung is one, a twin's home frame is one, and the place being painted
 * is one — however many recipes that place is painted in, which is the whole question this
 * harness is here to answer either side of.
 */
function stepsOf(row) {
  const rungs = (row.rungs ?? []).length;
  const places = (row.places ?? []).length;
  const mined = (row.places ?? []).filter((place) => place.mine_ms !== undefined).length;
  return { rungs, places, mined, recipes: (row.recipes ?? []).length, steps: places + rungs + mined };
}

function readback(got) {
  const done = got.walks.filter((row) => row.ms !== undefined);
  const steps = done.map(stepsOf);
  const byMode = new Map();
  for (const row of done) {
    for (const recipe of row.recipes ?? []) {
      if (!byMode.has(recipe.mode)) byMode.set(recipe.mode, []);
      byMode.get(recipe.mode).push(recipe.ms);
    }
  }
  const modes = [...byMode]
    .map(([mode, list]) => ({ mode, ...stats(list) }))
    .sort((a, b) => b.median - a.median);
  // What a candidate was: a field drawn in full, a colouring of one already drawn, or the
  // dear picture. A run of the tab before `walk_faster_ckpt138` says nothing here, because
  // every candidate it drew was a field.
  const byCandidate = new Map();
  for (const row of done) {
    for (const recipe of row.recipes ?? []) {
      const kind = recipe.kind ?? "field";
      if (!byCandidate.has(kind)) byCandidate.set(kind, []);
      byCandidate.get(kind).push(recipe.ms);
    }
  }
  const kinds = {};
  for (const [kind, list] of Object.entries(got.timings)) {
    if (list.length > 0 && kind !== "walk") kinds[kind] = stats(list);
  }
  return {
    walks: done.length,
    judged: (got.timings.gate ?? []).length > 0,
    seconds_per_walk: stats(done.map((row) => row.ms)),
    steps_per_walk: stats(steps.map((one) => one.steps)),
    rungs_per_walk: stats(steps.map((one) => one.rungs)),
    recipes_per_walk: stats(steps.map((one) => one.recipes)),
    places_mined: sum(steps.map((one) => one.mined)),
    rung_ms: stats(done.flatMap((row) => (row.rungs ?? []).map((rung) => rung.ms))),
    recipe_ms: stats(done.flatMap((row) => (row.recipes ?? []).map((one) => one.ms))),
    root_ms: stats(done.map((row) => row.root_ms).filter((ms) => ms !== undefined)),
    mine_ms: stats(done.flatMap((row) => (row.places ?? []).map((one) => one.mine_ms)).filter((ms) => ms !== undefined)),
    by_mode: modes,
    by_candidate: [...byCandidate].map(([kind, list]) => ({ kind, ...stats(list) })),
    by_kind: kinds,
    found: got.found,
  };
}

function say(read) {
  const line = (name, one) =>
    console.log(
      `  ${name.padEnd(18)} n=${String(one.n).padStart(4)}  median ${String(one.median).padStart(7)}  ` +
        `mean ${String(one.mean).padStart(7)}  p10 ${String(one.p10).padStart(7)}  p90 ${String(one.p90).padStart(7)}`,
    );
  console.log(`\n${read.walks} walks, judge ${read.judged ? "loaded" : "ABSENT — this is not a reading of the tab"}`);
  line("seconds per walk", { ...read.seconds_per_walk });
  line("steps per walk", read.steps_per_walk);
  line("rungs per walk", read.rungs_per_walk);
  line("recipes per walk", read.recipes_per_walk);
  line("ms per rung", read.rung_ms);
  line("ms per recipe", read.recipe_ms);
  line("ms per root search", read.root_ms);
  line("ms per place mined", read.mine_ms);
  console.log("\n  per mode, one recipe = field + shade + gate");
  for (const one of read.by_mode) {
    console.log(`    ${one.mode.padEnd(20)} n=${String(one.n).padStart(4)}  median ${String(one.median).padStart(7)} ms  total ${String(one.total_s).padStart(7)} s`);
  }
  if (read.by_candidate.length > 1) {
    console.log("\n  per kind of candidate");
    for (const one of read.by_candidate) {
      console.log(`    ${one.kind.padEnd(20)} n=${String(one.n).padStart(4)}  median ${String(one.median).padStart(7)} ms  total ${String(one.total_s).padStart(7)} s`);
    }
  }
  console.log("\n  per kind of work, all stages");
  for (const [kind, one] of Object.entries(read.by_kind)) {
    console.log(`    ${kind.padEnd(20)} n=${String(one.n).padStart(4)}  median ${String(one.median).padStart(7)} ms  total ${String(one.total_s).padStart(7)} s`);
  }
}

// ------------------------------------------------------------------------------ the runs

async function walks() {
  await openWalk();
  await start();
  console.log(`waiting for ${WALKS} walks`);
  await walksDone(WALKS);
  await page.evaluate("document.getElementById('walk-start').click()");
  const got = await harvest();
  const read = readback(got);
  say(read);
  return { run: "walks", cores: got.cores, config: got.config, progress: got.progress, read, walks: got.walks };
}

/**
 * The same, photographing the frame each walk ends on.
 *
 * **It pauses to take the picture, and that is the only way this is not a race.** Polling
 * for a finished row and shooting whatever is on the canvas catches the *next* walk's first
 * rung about half the time — the root search is out of sight and a cheap plane finds one
 * inside the poll interval, so the shot comes back with the quarters boxed over it. Pause
 * hands the viewer back to its own renderer at the frame the walk stands in (`unframe`),
 * which for a walk that painted something is the picture it kept; the shot waits for that
 * pass to settle and Start puts the walk back. A `shots` run's timings are therefore its
 * own and the numbers in this file come from `walks`.
 */
async function shots() {
  mkdirSync(SHOTS, { recursive: true });
  await openWalk();
  await start();
  console.log(`waiting for ${WALKS} walks, photographing each`);
  const taken = [];
  await walksDone(WALKS, async (nth) => {
    await page.evaluate("document.getElementById('walk-start').click()");
    await page.until(
      "['final','stopped'].includes(document.getElementById('render-state').dataset.state)",
      { within: 120000, every: 50 },
    );
    const shot = await page.send("Page.captureScreenshot", { format: "png" });
    const picture = await page.evaluate("document.getElementById('canvas').toDataURL('image/png')");
    const page_path = new URL(`walk-${String(nth).padStart(2, "0")}-page.png`, SHOTS);
    const canvas_path = new URL(`walk-${String(nth).padStart(2, "0")}-canvas.png`, SHOTS);
    writeFileSync(page_path, Buffer.from(shot.data, "base64"));
    writeFileSync(canvas_path, Buffer.from(picture.split(",")[1], "base64"));
    taken.push({ nth, page: page_path.pathname, canvas: canvas_path.pathname });
    console.log(`    photographed ${page_path.pathname}`);
    await page.evaluate("document.getElementById('walk-start').click()");
  });
  await page.evaluate("document.getElementById('walk-start').click()");
  const got = await harvest();
  const read = readback(got);
  say(read);
  return { run: "shots", cores: got.cores, config: got.config, taken, read, walks: got.walks };
}

// ------------------------------------------------------------------------------

const RUNS = { walks, shots };
try {
  if (!(run in RUNS)) throw new Error(`no run called ${run}; one of ${Object.keys(RUNS).join(", ")}`);
  const payload = await RUNS[run]();
  record(out ?? `walk-${run}-${Date.now()}.json`, { at: new Date().toISOString(), ...payload });
} catch (error) {
  // **A run that gave up still writes what it had.** These are half-hour runs over a dozen
  // walks, and losing eleven of them because the twelfth wedged is how a measurement gets
  // taken twice. Whatever the page still knows is recorded under its own name and said to
  // be partial; a page that has gone away leaves nothing to save and says that instead.
  console.error(`the run did not finish: ${error.message}`);
  try {
    const got = await harvest();
    record(`walk-${run}-partial-${Date.now()}.json`, {
      at: new Date().toISOString(),
      run,
      partial: error.message,
      cores: got.cores,
      config: got.config,
      read: readback(got),
      walks: got.walks,
    });
  } catch {
    console.error("and the page could not be asked what it had");
  }
} finally {
  await page.close();
}
