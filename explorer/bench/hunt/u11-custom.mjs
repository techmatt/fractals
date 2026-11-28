// U11: the custom (experimental) render mode, driven as a reader drives it, with checks at
// every moment the page changes (fractal-website 004_bug_hunt, 2026-11-06).
//
//   python -m builder serve --port 8000          # in another terminal; PORT= moves it
//   node explorer/bench/hunt/u11-custom.mjs                  # every scenario
//   node explorer/bench/hunt/u11-custom.mjs boot examples    # some of them
//   WORKERS=3 SIZE=1200x800 node explorer/bench/hunt/u11-custom.mjs
//
// Scenarios: `boot` (each mode's bare link), `examples` (every Example button, its link read
// back, the first of each mode reopened and its raster compared), `impatience` (presses
// overtaking a pass), `knobs` (every knob at both ends, junk and out-of-range typing, Reset),
// `toggles` (Matched palette and Auto tone, through a reload), `leave` (to an engine mode
// mid-pass and back), `endurance` (thirty knob moves, heap and workers before and after),
// `download` (a small custom download through the Download row, and a 4K one refused),
// `narrow` (1000, 760 and 420 px by device emulation), `tabs` (every tab taking the canvas
// mid-pass, then a resize mid-pass), `undo` (Ctrl+Z inside a knob's pass, then Ctrl+Y),
// `saved` (a custom view saved, its tile read and reopened, then the screensaver over one),
// `offline` (`style.wasm` blocked: a sentence and a stopped dot, then a later try that works),
// `recolour` (022_bug_hunt: at each mode's first Example, `]`, a knob and Auto tone, each
// picture held to a fresh load of its link, since website 020 recolours the kept frame),
// `aliases` (every old name's link lands on its mode and palette), `rests` (a knob a palette
// tunes shows the tuned value, and its default typed there is a setting the link keeps). `MODES=a,b` narrows
// `boot`, `examples` and `recolour` to those modes, and `SKIP=a,b` leaves some out.
//
// At every meaningful moment (the preview landing, the exact picture, a refusal) it takes a
// screenshot and runs the same checks: console errors and warnings (`lib.mjs`'s witness log),
// the custom controls overflowing their bar or the screen, two controls overlapping, an
// enabled control covered by something else, an Example tooltip or knob text in internal
// shorthand, the address bar not a fixed point, long main-thread tasks, and the workers the
// page holds against its pool. Each failed check is a `finding` row. Output goes to
// `artifacts/explorer-bench/u11-custom/<stamp>/`: `rows.jsonl`, `findings.jsonl`, the
// screenshots, and `contact.png`, every screenshot on one sheet.
//
// `WORKERS` holds the page's custom pool (`__customWorkers`; default 3, so a run beside other
// work leaves the box room), `SIZE` the window. The slowest modes take a minute a picture at
// 1200×800 on three workers; the full run is about forty minutes.

import { appendFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { aliasesOf, knobRest, palettesOf, roundEven, wholeKnob } from "../../style.js";
import { Page, say, sleep } from "./lib.mjs";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const bundle = JSON.parse(readFileSync(join(ROOT, "explorer/custom-modes.json"), "utf8"));
/** A scenario's mode by public name: a rebake that deletes it stops the run here, rather than
 *  quietly testing another mode (028: steel-blades, arch-tunnel and gilt-orbs left in 107). */
const named = (name) => {
  const mode = bundle.modes.find((m) => m.name === name);
  if (!mode) throw new Error(`u11: no custom mode ${name} in the bundle; pick another for this scenario`);
  return mode;
};
const WORKERS = Number(process.env.WORKERS ?? 3);
const [WIDTH, HEIGHT] = (process.env.SIZE ?? "1200x800").split("x").map(Number);
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const OUT = join(ROOT, "artifacts/explorer-bench/u11-custom", stamp);
mkdirSync(OUT, { recursive: true });

const ALL = ["boot", "examples", "impatience", "knobs", "toggles", "leave", "endurance", "download", "narrow", "tabs", "undo", "saved", "offline", "recolour", "aliases", "rests"];
const asked = process.argv.slice(2).filter((arg) => !arg.startsWith("-"));
const scenarios = asked.length > 0 ? asked : ALL;

let shots = 0;
const findings = [];
/** The modes a run walks: `MODES=a,b` names them, `SKIP=a,b` leaves some out (frost-feather's
 *  Example takes about forty minutes). */
const NAMED = process.env.MODES?.split(",").filter(Boolean) ?? null;
const SKIPPED = new Set(process.env.SKIP?.split(",").filter(Boolean) ?? []);
const chosen = (modes = bundle.modes) => modes.filter((m) => (NAMED === null || NAMED.includes(m.name)) && !SKIPPED.has(m.name));
function row(data) {
  appendFileSync(join(OUT, "rows.jsonl"), `${JSON.stringify(data)}\n`);
}
function finding(scenario, check, detail) {
  const entry = { scenario, check, detail };
  findings.push(entry);
  appendFileSync(join(OUT, "findings.jsonl"), `${JSON.stringify(entry)}\n`);
  say("FINDING", scenario, check, typeof detail === "string" ? detail : JSON.stringify(detail).slice(0, 300));
}

/** Internal shorthand a reader would meet in a tooltip or label: `d5`, `m2`, `seed4`,
 *  `variant:`, a style's internal name. The naming rule (CLAUDE.md) says none ships. */
const INTERNAL = bundle.modes.map((mode) => mode.style);
const SHORTHAND = [/\bd\d\b/, /\bm\d\b/, /\bseed\d/, /\bvariant\b/, /\bmultibrot\d\b/, /\bjulia\d\b/, /_/];

// ---------------------------------------------------------------------------------------
// In-page probes, one round trip each.

/** Installed before any script: long main-thread tasks, kept for the checks. */
const BEFORE = `
  globalThis.__customWorkers = ${WORKERS};
  globalThis.__longtasks = [];
  // Live workers by script, counted at the constructor and at terminate: CDP's target list
  // names a module worker by type alone, which cannot say which pool grew.
  globalThis.__workers = {};
  {
    const Original = globalThis.Worker;
    globalThis.Worker = class extends Original {
      constructor(url, options) {
        super(url, options);
        this.__script = String(url).split("?")[0].split("/").pop();
        __workers[this.__script] = (__workers[this.__script] ?? 0) + 1;
      }
      terminate() {
        if (!this.__gone) __workers[this.__script] -= 1;
        this.__gone = true;
        return super.terminate();
      }
    };
  }
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) globalThis.__longtasks.push(Math.round(entry.duration));
    }).observe({ type: "longtask", buffered: true });
  } catch {}
`;

const LAYOUT = `(() => {
  const out = { overflow: [], overlap: [], covered: [], clipped: [] };
  const vw = innerWidth;
  const visible = (el) => {
    if (el.closest('[hidden]')) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const name = (el) => el.id ? '#' + el.id : el.tagName.toLowerCase() + (el.className ? '.' + String(el.className).split(' ')[0] : '') + (el.textContent ? ' "' + el.textContent.trim().slice(0, 30) + '"' : '');
  const column = document.querySelector('.shallow-cell-mode');
  const box = column?.getBoundingClientRect();
  for (const id of ['custom-bar', 'custom-knobs', 'custom-examples', 'custom-note', 'stats', 'readout', 'status', 'download']) {
    const bar = document.getElementById(id);
    if (!bar || !visible(bar)) continue;
    const kids = [...bar.querySelectorAll('*')].filter(visible);
    for (const el of [bar, ...kids]) {
      const r = el.getBoundingClientRect();
      if (r.right > vw + 1 || r.left < -1) out.overflow.push(name(el) + ' off-screen ' + Math.round(r.left) + '..' + Math.round(r.right) + ' of ' + vw);
      else if (box && id.startsWith('custom') && (r.right > box.right + 1)) out.overflow.push(name(el) + ' past its column by ' + Math.round(r.right - box.right) + 'px');
      if (['LABEL', 'BUTTON', 'SELECT', 'P', 'SPAN'].includes(el.tagName) && el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflow !== 'visible') {
        out.clipped.push(name(el) + ' text clipped ' + el.scrollWidth + '>' + el.clientWidth);
      }
    }
    // Overlaps among the bar's own controls.
    const parts = [...bar.querySelectorAll('button, select, input, label')].filter(visible);
    for (let i = 0; i < parts.length; i++) {
      for (let j = i + 1; j < parts.length; j++) {
        const a = parts[i].getBoundingClientRect();
        const b = parts[j].getBoundingClientRect();
        const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (w > 2 && h > 2 && !parts[i].contains(parts[j]) && !parts[j].contains(parts[i])) out.overlap.push(name(parts[i]) + ' over ' + name(parts[j]));
      }
    }
    // An enabled control another element covers cannot be pressed.
    for (const el of parts) {
      if (el.disabled) continue;
      const r = el.getBoundingClientRect();
      const x = r.left + r.width / 2, y = r.top + r.height / 2;
      if (y < 0 || y > innerHeight) continue;
      const hit = document.elementFromPoint(x, y);
      if (hit && hit !== el && !el.contains(hit) && !(el.labels && [...el.labels].includes(hit)) && hit.tagName !== 'LABEL') out.covered.push(name(el) + ' under ' + name(hit));
    }
  }
  return out;
})()`;

const STATE = `(() => {
  const t = (id) => document.getElementById(id)?.textContent?.trim() ?? null;
  const examples = [...document.querySelectorAll('#custom-examples button')];
  const knobs = [...document.querySelectorAll('#custom-knobs input[type=number]')];
  return {
    url: location.search.replace(/^\\?/, ''),
    dot: document.getElementById('render-state')?.dataset.state ?? null,
    status: t('status'), stats: t('stats'), readout: t('readout'), note: t('custom-note'),
    mode: document.getElementById('mode')?.value,
    custom: document.getElementById('custom-mode')?.value,
    barHidden: document.getElementById('custom-bar').hidden,
    matched: document.getElementById('custom-matched').checked,
    autotone: document.getElementById('custom-autotone').checked,
    resetDisabled: document.getElementById('custom-reset').disabled,
    knobs: knobs.map((k) => ({ name: k.dataset.knob, value: k.value, disabled: k.disabled, title: k.closest('.group').title })),
    sliders: [...document.querySelectorAll('#custom-knobs input[type=range]')].map((k) => k.value),
    labels: [...document.querySelectorAll('#custom-knobs label')].map((l) => l.textContent),
    examples: examples.map((b) => ({ n: b.textContent, title: b.title, disabled: b.disabled, example: b.dataset.example })),
    paletteShown: t('palette-shown'),
    downloadEnabled: !document.getElementById('download-png').disabled,
    estimate: t('download-estimate'),
    longtasks: (globalThis.__longtasks ?? []).splice(0),
    workers: { ...(globalThis.__workers ?? {}) },
  };
})()`;

// ---------------------------------------------------------------------------------------
// Moments.

async function look(page, scenario, label, { layout = true } = {}) {
  const state = await page.ev(STATE);
  const file = `${String(++shots).padStart(3, "0")}-${scenario}-${label}.png`.replace(/[^\w.-]+/g, "_");
  await page.shot(join(OUT, file));
  // The custom controls sit below the picture; a second look with them scrolled into view.
  if (layout) {
    await page.ev(`document.getElementById('custom-examples')?.scrollIntoView({ block: 'end' })`);
    await page.shot(join(OUT, file.replace(/\.png$/, "-controls.png")));
    await page.ev(`document.getElementById('canvas')?.scrollIntoView({ block: 'start' })`);
  }
  const said = page.drain();
  if (said.length > 0) finding(scenario, "console", { label, said });
  if (state?.THREW) {
    finding(scenario, "probe threw", state.THREW);
    return state;
  }
  const long = state.longtasks.filter((ms) => ms >= 200);
  if (long.length > 0) finding(scenario, "long main-thread task", { label, ms: long });
  if (layout) {
    const found = await page.ev(LAYOUT);
    for (const kind of ["overflow", "overlap", "covered", "clipped"]) {
      if (found?.[kind]?.length) finding(scenario, `layout ${kind}`, { label, items: found[kind].slice(0, 8) });
    }
  }
  row({ scenario, label, file, ...state, longtasks: undefined, long });
  return state;
}

/** Wait for the dot to leave and come back to a resting state; times each stage. */
async function pass(page, { within = 300000, stage = null } = {}) {
  const started = Date.now();
  const times = {};
  let last = null;
  let sawWork = false;
  for (;;) {
    const dot = await page.ev(`document.getElementById('render-state')?.dataset.state`);
    if (dot !== last) {
      times[dot] = Date.now() - started;
      last = dot;
      if (stage && dot === "sharpening") await stage();
    }
    if (dot !== "final" && dot !== "stopped") sawWork = true;
    if ((dot === "final" || dot === "stopped") && (sawWork || Date.now() - started > 1500)) return { dot, times, ms: Date.now() - started };
    if (Date.now() - started > within) return { dot: "timeout", times, ms: Date.now() - started };
    await sleep(150);
  }
}

const click = (page, selector) =>
  page.ev(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; el.click(); return true; })()`);
const set = (page, selector, value) =>
  page.ev(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return null;
    el.value = ${JSON.stringify(String(value))};
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return el.value;
  })()`);

/** The address bar after the page's own debounce. */
async function address(page) {
  await sleep(700);
  return page.ev(`location.search.replace(/^\\?/, '')`);
}

/** Reopen a query and hold it to being a fixed point (and, `raster`, to the same picture). */
async function fixedPoint(page, scenario, query, { raster = null } = {}) {
  const answered = await page.open(`?${query}`, { settle: 300 });
  const drawn = await pass(page);
  const back = await address(page);
  if (answered !== "studio") finding(scenario, "link refused", { query, answered, said: (await page.refused()).said });
  else if (back !== query) finding(scenario, "link not a fixed point", { query, back });
  if (raster !== null && drawn.dot === "final") {
    const hash = await page.canvasHash();
    if (hash !== raster) finding(scenario, "reopened link drew another picture", { query, raster, hash });
  }
  return drawn;
}

function shorthand(scenario, where, text) {
  if (!text) return;
  const hit = SHORTHAND.find((re) => re.test(text)) ?? INTERNAL.find((style) => text.includes(style));
  if (hit) finding(scenario, "internal shorthand shown to a reader", { where, text });
}

// ---------------------------------------------------------------------------------------
// Scenarios.

async function boot(page) {
  for (const mode of chosen()) {
    const query = `v=4&custom=${mode.name}`;
    const answered = await page.open(`?${query}`, { settle: 0 });
    if (answered !== "studio") {
      finding("boot", "bare custom link refused", { query, said: (await page.refused()).said });
      continue;
    }
    const drawn = await pass(page, { stage: () => look(page, "boot", `${mode.name}-preview`, { layout: false }) });
    const state = await look(page, "boot", `${mode.name}-final`);
    row({ scenario: "boot", mode: mode.name, ...drawn });
    if (drawn.dot !== "final") finding("boot", "pass did not finish", { mode: mode.name, drawn, status: state.status });
    if (!state.stats?.includes(mode.name)) finding("boot", "stats line not the mode's", { mode: mode.name, stats: state.stats });
    for (const knob of state.knobs) shorthand("boot", `knob ${knob.name} tooltip`, knob.title);
    for (const label of state.labels) shorthand("boot", "knob label", label);
    for (const example of state.examples) shorthand("boot", `${mode.name} example ${example.n} tooltip`, example.title);
    const back = await address(page);
    const again = await page.open(`?${back}`, { settle: 0 });
    const redrawn = await pass(page);
    const twice = await address(page);
    if (again !== "studio" || twice !== back) finding("boot", "link not a fixed point", { back, twice, again });
    void redrawn;
  }
}

async function examples(page) {
  for (const mode of chosen()) {
    await page.open(`?v=4&custom=${mode.name}`, { settle: 0 });
    await pass(page);
    const buttons = (await page.ev(STATE)).examples;
    for (const button of buttons) {
      await click(page, `#custom-examples button[data-example="${button.example}"]`);
      const drawn = await pass(page);
      const state = await look(page, "examples", `${mode.name}-${button.n}`);
      if (drawn.dot !== "final") finding("examples", "pass did not finish", { mode: mode.name, button: button.n, drawn, status: state.status });
      const query = await address(page);
      if (!query.includes(`custom=${mode.name}`)) finding("examples", "example link lost its mode", { query });
      row({ scenario: "examples", mode: mode.name, button: button.n, query, ...drawn });
      if (button.n === "1" && drawn.dot === "final") {
        const raster = await page.canvasHash();
        await fixedPoint(page, "examples", query, { raster });
        await page.open(`?v=4&custom=${mode.name}`, { settle: 0 });
        await pass(page);
      }
    }
  }
}

async function impatience(page) {
  const mode = bundle.modes.find((m) => m.shown.length >= 3) ?? bundle.modes[0];
  await page.open(`?v=4&custom=${mode.name}`, { settle: 0 });
  await pass(page);
  const before = await page.metrics();
  // Three presses, each inside the previous pass.
  for (const delay of [100, 400, 1500, 4000]) {
    await click(page, `#custom-examples button:nth-of-type(1)`);
    await sleep(delay);
    await click(page, `#custom-examples button:nth-of-type(2)`);
    await sleep(delay);
    const knob = mode.knobs[0];
    await set(page, `#custom-knobs input[type=number][data-knob="${knob.name}"]`, knob.range[1]);
    await sleep(delay);
    // A mode change and straight back, mid-pass.
    const other = bundle.modes.find((m) => m.name !== mode.name);
    await set(page, "#custom-mode", other.name);
    await sleep(delay);
    await set(page, "#custom-mode", mode.name);
    const drawn = await pass(page);
    const state = await look(page, "impatience", `delay-${delay}`);
    const query = await address(page);
    if (drawn.dot !== "final") finding("impatience", "pass did not finish", { delay, drawn, status: state.status });
    if (state.custom !== mode.name || !query.includes(`custom=${mode.name}`)) finding("impatience", "ended in the wrong mode", { delay, custom: state.custom, query });
    if (!state.stats?.startsWith(mode.name)) finding("impatience", "stats line is another pass's", { delay, stats: state.stats });
    row({ scenario: "impatience", delay, query, ...drawn });
  }
  const after = await page.metrics();
  const live = (await page.ev(STATE)).workers;
  row({ scenario: "impatience", before, after, live });
  if ((live["style-worker.js"] ?? 0) > WORKERS) finding("impatience", "workers leaked", { live });
}

async function knobs(page) {
  for (const mode of bundle.modes.slice(0, 3)) {
    await page.open(`?v=4&custom=${mode.name}`, { settle: 0 });
    await pass(page);
    for (const knob of mode.knobs) {
      for (const [label, typed, expect] of [
        // Junk and an emptied box first, from the default: at a knob's minimum already, a
        // box that reads junk as zero (clamped to the minimum) would move nothing.
        ["junk", "abc", null],
        ["emptied", "", null],
        ["min", knob.range[0], knob.range[0]],
        ["max", knob.range[1], knob.range[1]],
        ["past-max", knob.range[1] * 10 + 7, knob.range[1]],
        ["below-min", knob.range[0] - 1000, knob.range[0]],
        // Half past the middle: a whole-number knob shows, links and draws one number.
        ["half", knob.range[0] + 0.5, Math.min(knob.range[1], wholeKnob(knob) ? roundEven(knob.range[0] + 0.5) : knob.range[0] + 0.5)],
      ]) {
        const prior = await address(page);
        await set(page, `#custom-knobs input[type=number][data-knob="${knob.name}"]`, typed);
        await sleep(200);
        const state = await page.ev(STATE);
        const box = state.knobs.find((k) => k.name === knob.name);
        const query = await address(page);
        if (expect !== null && Number(box.value) !== expect && Math.abs(Number(box.value) - expect) > 1e-9) {
          finding("knobs", "box does not show the clamped value", { mode: mode.name, knob: knob.name, label, typed, shown: box.value, expect });
        }
        if (expect === null && query !== prior) finding("knobs", "junk typing moved the link", { mode: mode.name, knob: knob.name, prior, query });
        const slider = state.sliders[state.knobs.findIndex((k) => k.name === knob.name)];
        if (Math.abs(Number(slider) - Number(box.value)) > (knob.range[1] - knob.range[0]) / 50) {
          finding("knobs", "slider and box disagree", { mode: mode.name, knob: knob.name, label, slider, box: box.value });
        }
      }
    }
    const drawn = await pass(page);
    await look(page, "knobs", `${mode.name}-moved`);
    const query = await address(page);
    await fixedPoint(page, "knobs", query);
    await click(page, "#custom-reset");
    await pass(page);
    const reset = await look(page, "knobs", `${mode.name}-reset`);
    if (reset.url.includes("knobs=")) finding("knobs", "Reset left knobs in the link", { url: reset.url });
    if (!reset.resetDisabled) finding("knobs", "Reset still enabled at the defaults", { mode: mode.name });
    row({ scenario: "knobs", mode: mode.name, ...drawn });
  }
}

async function toggles(page) {
  const mode = named("glass-whorl");
  await page.open(`?v=4&custom=${mode.name}`, { settle: 0 });
  await pass(page);
  const on = await look(page, "toggles", "matched-on");
  await click(page, "#custom-matched");
  await pass(page);
  const off = await look(page, "toggles", "matched-off");
  if (off.paletteShown === on.paletteShown) finding("toggles", "palette heading did not move with Matched palette", { on: on.paletteShown, off: off.paletteShown });
  // Choose another palette with Matched off: it must reach the picture and the link.
  const before = await page.canvasHash();
  const picked = await page.ev(`(() => { const s = [...document.querySelectorAll('#palette-list [role=option]')]; const b = s[7] ?? s[1]; b?.click(); return b?.dataset?.name ?? b?.textContent ?? null; })()`);
  await pass(page);
  const palette = await look(page, "toggles", "palette-picked");
  if ((await page.canvasHash()) === before) finding("toggles", "a palette chosen with Matched off did not change the picture", { picked });
  await click(page, "#custom-autotone");
  await pass(page);
  const toned = await look(page, "toggles", "autotone-off");
  if (!toned.url.includes("matched=0") || !toned.url.includes("autotone=0")) finding("toggles", "toggles missing from the link", { url: toned.url });
  // A knob that writes only the tone pass does nothing without it, and says so.
  for (const knob of mode.knobs.filter((k) => k.set.every((t) => (typeof t === "string" ? t : t.path).startsWith("/tone/")))) {
    const box = toned.knobs.find((k) => k.name === knob.name);
    if (!box?.disabled) finding("toggles", "a tone-only knob is live with Auto tone off", { knob: knob.name });
  }
  const raster = await page.canvasHash();
  await fixedPoint(page, "toggles", toned.url, { raster });
  const reloaded = await page.ev(STATE);
  if (reloaded.matched || reloaded.autotone) finding("toggles", "a reload lost a toggle", { matched: reloaded.matched, autotone: reloaded.autotone });
  // Matched back on with Matched-off palette chosen: the strip must be the mode's own again.
  await click(page, "#custom-matched");
  await pass(page);
  const back = await look(page, "toggles", "matched-back-on");
  if (back.paletteShown !== on.paletteShown) finding("toggles", "palette heading not the mode's own after Matched back on", { on: on.paletteShown, back: back.paletteShown });
  row({ scenario: "toggles", palette: palette.paletteShown });
}

async function leave(page) {
  const mode = named("lacquer-lobes");
  await page.open(`?v=4&custom=${mode.name}`, { settle: 0 });
  await sleep(1500);
  const mid = await page.metrics();
  await set(page, "#mode", "smooth");
  const drawn = await pass(page);
  await sleep(3000);
  const state = await look(page, "leave", "smooth");
  if (!state.barHidden) finding("leave", "custom controls still shown in an engine mode", {});
  if (state.stats?.includes(mode.name) || state.status?.includes(mode.name)) finding("leave", "the cancelled custom pass wrote the stats line", { stats: state.stats, status: state.status });
  if (state.url.includes("custom=")) finding("leave", "link kept the custom key", { url: state.url });
  const idle = await page.metrics();
  row({ scenario: "leave", mid, idle, live: state.workers, ...drawn });
  // Out of the custom modes, the pool is given back (each worker holds its last frame's
  // memory, hundreds of megabytes, until it is terminated).
  if ((state.workers["style-worker.js"] ?? 0) > 0) finding("leave", "custom pool still held in an engine mode", { live: state.workers });
  await set(page, "#mode", "custom");
  await pass(page);
  const again = await look(page, "leave", "back-to-custom");
  if (again.custom !== mode.name) finding("leave", "returning to custom did not reopen the last mode", { custom: again.custom });
}

async function endurance(page) {
  const mode = bundle.modes[0];
  await page.open(`?v=4&custom=${mode.name}`, { settle: 0 });
  await pass(page);
  const before = await page.metrics();
  const knob = mode.knobs[0];
  for (let i = 0; i < 30; i++) {
    const value = knob.range[0] + ((i % 10) / 9) * (knob.range[1] - knob.range[0]);
    await set(page, `#custom-knobs input[type=number][data-knob="${knob.name}"]`, value);
    await sleep(i % 3 === 0 ? 2500 : 400);
  }
  const drawn = await pass(page);
  await look(page, "endurance", "after-30");
  const after = await page.metrics();
  const live = (await page.ev(STATE)).workers;
  row({ scenario: "endurance", before, after, live, ...drawn });
  if (after.heapMB > before.heapMB * 1.5 + 20) finding("endurance", "heap grew", { before: before.heapMB, after: after.heapMB });
  if ((live["style-worker.js"] ?? 0) > WORKERS) finding("endurance", "workers leaked", { live });
}

async function download(page) {
  const mode = named("glass-whorl");
  const landing = join(OUT, "downloads");
  mkdirSync(landing, { recursive: true });
  await page.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: landing });
  await page.open(`?v=4&custom=${mode.name}`, { settle: 0 });
  const early = await page.ev(STATE);
  row({ scenario: "download", early: { enabled: early.downloadEnabled, estimate: early.estimate } });
  await pass(page);
  await set(page, "#download-size", "custom");
  await set(page, "#download-width", 320);
  await set(page, "#download-height", 200);
  await sleep(300);
  const ready = await look(page, "download", "row-ready");
  const started = Date.now();
  await click(page, "#download-png");
  let file = null;
  for (let i = 0; i < 600 && !file; i++) {
    await sleep(250);
    file = readdirSync(landing).find((name) => name.endsWith(".png")) ?? null;
  }
  const done = await look(page, "download", "after");
  if (!file) finding("download", "no file landed", { status: done.status });
  else if (/[^a-z0-9._-]/.test(file)) finding("download", "filename outside lowercase-with-hyphens", { file });
  row({ scenario: "download", file, seconds: (Date.now() - started) / 1000, estimate: ready.estimate, status: done.status });
  await pass(page);
  const after = await page.ev(STATE);
  if (after.dot !== "final") finding("download", "screen not redrawn after the download", { dot: after.dot });
  if ((after.workers["style-worker.js"] ?? 0) > WORKERS) finding("download", "workers leaked", { live: after.workers });
  // A 4K picture at 4x is past what one worker's wasm memory holds: refused, not trapped.
  await set(page, "#download-width", 3840);
  await set(page, "#download-height", 2160);
  await sleep(300);
  const big = await look(page, "download", "4k-refused");
  if (big.downloadEnabled) finding("download", "a custom download past one worker's memory is offered", { estimate: big.estimate });
}

/** Narrow windows, by device emulation (headless Chrome clamps a real window near 500 px):
 *  the custom rows must wrap inside the column, never past the screen. */
async function narrow(page) {
  const mode = named("lacquer-lobes");
  for (const [width, height, mobile] of [[1000, 900, false], [760, 1000, false], [420, 900, true]]) {
    await page.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile });
    await page.open(`?v=4&custom=${mode.name}`, { settle: 0 });
    const drawn = await pass(page);
    await look(page, "narrow", `${width}`);
    row({ scenario: "narrow", width, ...drawn });
  }
  await page.send("Emulation.setDeviceMetricsOverride", { width: WIDTH, height: HEIGHT, deviceScaleFactor: 1, mobile: false });
}

/** Other tabs taking the canvas mid-pass, and a resize mid-pass. */
async function tabs(page) {
  const mode = named("brass-foam");
  await page.open(`?v=4&custom=${mode.name}`, { settle: 0 });
  await sleep(1200);
  for (const tab of ["tab-deep", "tab-walk", "tab-saved", "tab-phoenix", "tab-gallery"]) {
    await click(page, `#${tab}`);
    await sleep(900);
  }
  let drawn = await pass(page);
  let state = await look(page, "tabs", "back-to-gallery");
  if (drawn.dot !== "final") finding("tabs", "pass did not finish after the tabs", { drawn, status: state.status });
  if (!state.url.includes(`custom=${mode.name}`)) finding("tabs", "the tabs lost the custom mode", { url: state.url });
  if ((state.workers["style-worker.js"] ?? 0) > WORKERS) finding("tabs", "workers leaked", { live: state.workers });
  // A resize mid-pass: the new grid's pass is the one that lands.
  await click(page, "#custom-examples button:nth-of-type(1)");
  await sleep(800);
  await page.send("Emulation.setDeviceMetricsOverride", { width: WIDTH - 260, height: HEIGHT, deviceScaleFactor: 1, mobile: false });
  drawn = await pass(page);
  state = await look(page, "tabs", "resized");
  const grid = await page.ev(`(() => { const c = document.getElementById('canvas'); return [c.width, c.height]; })()`);
  if (drawn.dot !== "final") finding("tabs", "pass did not finish after a resize", { drawn });
  if (!state.stats?.includes(`${grid[0]}×${grid[1]}`)) finding("tabs", "the stats line is not the resized grid's", { stats: state.stats, grid });
  await page.send("Emulation.setDeviceMetricsOverride", { width: WIDTH, height: HEIGHT, deviceScaleFactor: 1, mobile: false });
}

/** Ctrl+Z mid-pass returns to the picture just left, and Ctrl+Y comes forward again. */
async function undo(page) {
  const mode = named("glass-whorl");
  await page.open(`?v=4&custom=${mode.name}`, { settle: 0 });
  await pass(page);
  const first = await address(page);
  const knob = mode.knobs.find((k) => k.name === "core_glow");
  if (!knob) throw new Error("u11 undo: glass-whorl has no core_glow knob");
  await set(page, `#custom-knobs input[type=number][data-knob="${knob.name}"]`, knob.range[0]);
  // Undo while the moved knob's pass is still drawing, past its preview.
  for (let i = 0; i < 100; i++) {
    if ((await page.ev(`document.getElementById('render-state').dataset.state`)) === "sharpening") break;
    await sleep(100);
  }
  await sleep(500);
  const moved = await address(page);
  const key = (k, shift = false) =>
    page.ev(`document.getElementById('canvas').dispatchEvent(new KeyboardEvent('keydown', { key: '${k}', ctrlKey: true, shiftKey: ${shift}, bubbles: true })) || true`);
  await page.ev(`document.getElementById('canvas').focus()`);
  await key("z");
  await pass(page);
  const back = await look(page, "undo", "undone-mid-pass");
  if (back.url !== first) finding("undo", "Undo mid-pass did not return to the picture just left", { first, moved, back: back.url });
  await key("y");
  await pass(page);
  const again = await address(page);
  if (again !== moved) finding("undo", "Redo did not come forward to the moved knob", { moved, again });
}

/** Save a custom view, read its Saved tile as a reader does, and reopen it from there; then
 *  the screensaver over a custom view, and Escape back. */
async function saved(page) {
  const mode = named("gear-halo");
  await page.open(`?v=4&custom=${mode.name}`, { settle: 0 });
  await pass(page);
  await click(page, "#custom-examples button:nth-of-type(1)");
  await pass(page);
  const query = await address(page);
  await click(page, "#save-view");
  await sleep(400);
  await click(page, "#tab-saved");
  await sleep(800);
  const tile = await page.ev(`(() => { const t = document.querySelector('.saved-tile'); if (!t) return null;
    return { title: t.title, label: t.querySelector('.tile-label')?.textContent, alt: t.querySelector('img')?.alt ?? null }; })()`);
  await look(page, "saved", "tab");
  if (!tile) finding("saved", "no Saved tile for a saved custom view", {});
  else {
    if (/smooth/.test(tile.title) || !tile.title.includes(mode.name)) finding("saved", "Saved tile title does not name the custom mode", tile);
    shorthand("saved", "Saved tile title", tile.title);
  }
  await page.open(`?v=4&custom=${bundle.modes[0].name}`, { settle: 0 });
  await pass(page);
  await click(page, "#tab-saved");
  await sleep(800);
  await click(page, ".saved-tile");
  const drawn = await pass(page);
  // The open tab rides in the link as `panel=saved`; the view is the rest.
  const back = (await address(page)).replace(/&panel=[a-z]+/, "");
  if (back !== query) finding("saved", "a Saved custom entry reopened another view", { query, back });
  row({ scenario: "saved", tile, back, ...drawn });
  // The screensaver takes the canvas from a custom pass, and Escape gives it back.
  await click(page, "#tab-gallery");
  await sleep(300);
  await click(page, "#gallery-screensaver");
  await sleep(4000);
  await look(page, "saved", "screensaver", { layout: false });
  await page.ev(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
  await sleep(1500);
  const after = await page.ev(STATE);
  row({ scenario: "saved", screensaverAfter: { url: after.url, dot: after.dot, workers: after.workers } });
  if ((after.workers["style-worker.js"] ?? 0) > WORKERS) finding("saved", "workers leaked across the screensaver", { live: after.workers });
}

/** The module failing to load: a sentence, the dot stopped, and a later try that works. */
async function offline(page) {
  await page.send("Network.enable");
  await page.send("Network.setBlockedURLs", { urls: ["*style.wasm*"] });
  await page.open(`?v=4&custom=${bundle.modes[0].name}`, { settle: 0 });
  const drawn = await pass(page, { within: 30000 });
  const state = await look(page, "offline", "blocked", { layout: false });
  page.drain();
  if (drawn.dot !== "stopped") finding("offline", "a module that never loads did not stop the dot", { drawn });
  if (!/could not/.test(state.status ?? "")) finding("offline", "no sentence for a module that did not load", { status: state.status });
  await page.send("Network.setBlockedURLs", { urls: [] });
  // The same document tries again on the next draw: another mode from the select.
  await set(page, "#custom-mode", bundle.modes[1].name);
  const again = await pass(page);
  await look(page, "offline", "unblocked", { layout: false });
  if (again.dot !== "final") finding("offline", "the custom modes never recovered after the module loaded", { again });
}

/** Watch the status line through a pass, for the stage names it says (`recoloring` is the
 *  pool's recolour of its kept frame, website 020). */
async function passSaying(page, options = {}) {
  const said = new Set();
  const watch = setInterval(async () => {
    try {
      const status = await page.ev(`document.getElementById('stats')?.textContent ?? ''`);
      if (status) said.add(status.replace(/^[^:]*: \S+, /, ""));
    } catch {}
  }, 120);
  try {
    const drawn = await pass(page, options);
    return { ...drawn, said: [...said] };
  } finally {
    clearInterval(watch);
  }
}

/** One change at a finished picture, held to a fresh load of the link it ends on: what a
 *  recolour (website 020) must draw is exactly the picture the measure from scratch draws. */
async function heldToFresh(page, mode, label, act) {
  await act();
  const drawn = await passSaying(page);
  const state = await look(page, "recolour", `${mode.name}-${label}`, { layout: false });
  // The pool's own word for it (`timing.recoloured`), the status line a second witness.
  const timing = await page.ev(`(globalThis.__customTimings ?? []).at(-1)?.timing ?? null`);
  const recoloured = timing?.recoloured === true || drawn.said.some((line) => line.startsWith("recoloring"));
  const query = await address(page);
  row({ scenario: "recolour", mode: mode.name, label, recoloured, query, said: drawn.said, ...drawn });
  if (drawn.dot !== "final") {
    finding("recolour", "pass did not finish", { mode: mode.name, label, drawn, status: state.status });
    return null;
  }
  const raster = await page.canvasHash();
  await fixedPoint(page, "recolour", query, { raster });
  return recoloured;
}

/** A palette switch, a knob and Auto tone at a finished Example, each held to a fresh load
 *  (website 020's recolour), then a second `]` pressed inside the first one's pass. `MODES`
 *  (comma-separated names) narrows it; by default every mode with a palette set or a knob. */
async function recolour(page) {
  const modes = chosen(NAMED ? bundle.modes : bundle.modes.filter((m) => palettesOf(m).length > 1 || m.knobs.length > 0));
  const tally = { recoloured: 0, measured: 0 };
  for (const mode of modes) {
    // The first Example: a place the mode reads well at, and one the reader starts from.
    await page.open(`?v=4&custom=${mode.name}`, { settle: 0 });
    await pass(page);
    await click(page, `#custom-examples button[data-example]`);
    const first = await pass(page);
    if (first.dot !== "final") {
      finding("recolour", "example did not finish", { mode: mode.name, first });
      continue;
    }
    const steps = [];
    if (palettesOf(mode).length > 1) {
      steps.push(["palette", () => page.ev(`window.dispatchEvent(new KeyboardEvent('keydown', { key: ']', bubbles: true }))`)]);
    }
    const knob = mode.knobs.find((k) => !k.set.every((t) => (typeof t === "string" ? t : t.path).startsWith("/projection/")));
    if (knob) {
      const to = knob.default === knob.range[1] ? knob.range[0] : knob.range[1];
      steps.push([`knob-${knob.name}`, () => set(page, `#custom-knobs input[type=number][data-knob="${knob.name}"]`, to)]);
    }
    if ("tone" in mode.stack) steps.push(["autotone-off", () => click(page, "#custom-autotone")]);
    for (const [label, act] of steps) {
      const recoloured = await heldToFresh(page, mode, label, act);
      if (recoloured === true) tally.recoloured += 1;
      else if (recoloured === false) tally.measured += 1;
    }
    // Impatience: a second `]` inside the first one's recolour.
    if (palettesOf(mode).length > 2) {
      await page.ev(`window.dispatchEvent(new KeyboardEvent('keydown', { key: ']', bubbles: true }))`);
      await sleep(150);
      const recoloured = await heldToFresh(page, mode, "palette-twice", () =>
        page.ev(`window.dispatchEvent(new KeyboardEvent('keydown', { key: ']', bubbles: true }))`),
      );
      void recoloured;
    }
  }
  row({ scenario: "recolour", tally });
  say("recolour", JSON.stringify(tally));
}

/** Every old name the bundle still opens (`aliasesOf`): its link lands on the mode it was
 *  merged into, at the palette entry that was it, and the address bar says so. */
async function aliases(page) {
  for (const [old, alias] of aliasesOf(bundle)) {
    const answered = await page.open(`?v=4&custom=${encodeURIComponent(old)}`, { settle: 0 });
    if (answered !== "studio") {
      finding("aliases", "an old name's link refused", { old, said: (await page.refused()).said });
      continue;
    }
    const drawn = await pass(page, { within: 240000 });
    const state = await look(page, "aliases", old, { layout: false });
    const query = await address(page);
    const params = new URLSearchParams(query);
    row({ scenario: "aliases", old, alias, query, ...drawn });
    if (params.get("custom") !== alias.name) finding("aliases", "an old name opened another mode", { old, alias, query });
    if ((params.get("tuned") ?? null) !== alias.palette) finding("aliases", "an old name opened another palette", { old, alias, query });
    if (state.custom !== alias.name) finding("aliases", "the mode select is not the alias's mode", { old, alias, select: state.custom });
  }
}

/** Every palette entry that tunes a knob (022_bug_hunt): the box shows the tuned value the
 *  picture draws (`knobRest`), and the knob's default typed there is a setting the link keeps. */
async function rests(page) {
  for (const mode of chosen()) {
    for (const entry of palettesOf(mode)) {
      const tuned = mode.knobs.filter((knob) => knobRest(mode, entry, knob) !== knob.default);
      if (tuned.length === 0) continue;
      const own = entry === palettesOf(mode)[0];
      const query = `v=4&custom=${mode.name}${own ? "" : `&tuned=${encodeURIComponent(entry.colormap)}`}`;
      await page.open(`?${query}`, { settle: 300 });
      const state = await page.ev(STATE);
      for (const knob of tuned) {
        const box = state.knobs.find((k) => k.name === knob.name);
        const rest = knobRest(mode, entry, knob);
        if (Math.abs(Number(box?.value) - rest) > 1e-6) {
          finding("rests", "a knob box shows another value than the picture draws", { mode: mode.name, palette: entry.colormap, knob: knob.name, shown: box?.value, rest });
        }
      }
      const knob = tuned.find((k) => k.default >= k.range[0] && k.default <= k.range[1]);
      if (!knob) continue;
      await set(page, `#custom-knobs input[type=number][data-knob="${knob.name}"]`, knob.default);
      const back = await address(page);
      row({ scenario: "rests", mode: mode.name, palette: entry.colormap, knob: knob.name, back });
      if (!new URLSearchParams(back).get("knobs")?.includes(`${knob.name}:`)) {
        finding("rests", "the knob's default at a palette that tunes it was dropped as no setting", { mode: mode.name, palette: entry.colormap, knob: knob.name, back });
      }
    }
  }
}

const RUN = { offline, saved, boot, examples, impatience, knobs, toggles, leave, endurance, download, narrow, tabs, undo, recolour, aliases, rests };

// ---------------------------------------------------------------------------------------

/** Every screenshot on one sheet, laid out by the browser itself. */
async function contact(page) {
  const files = readdirSync(OUT).filter((name) => /^\d{3}-.*\.png$/.test(name));
  if (files.length === 0) return;
  const cells = files
    .map((name) => `<figure><img src="${name}"><figcaption>${name}</figcaption></figure>`)
    .join("");
  const html = `<!doctype html><style>body{margin:0;background:#222;display:grid;grid-template-columns:repeat(5,1fr);gap:4px}
figure{margin:0}img{width:100%;display:block}figcaption{color:#ddd;font:11px sans-serif;padding:2px}</style>${cells}`;
  writeFileSync(join(OUT, "contact.html"), html);
  await page.send("Page.navigate", { url: pathToFileURL(join(OUT, "contact.html")).href });
  await sleep(1500);
  await page.shot(join(OUT, "contact.png"));
}

const page = await new Page({ width: WIDTH, height: HEIGHT, debug: 9411 }).start();
await page.send("Page.addScriptToEvaluateOnNewDocument", { source: BEFORE });
say(`u11-custom: ${scenarios.join(", ")} at ${WIDTH}x${HEIGHT}, ${WORKERS} workers, into ${OUT}`);
for (const name of scenarios) {
  const started = Date.now();
  say(`— ${name}`);
  try {
    await RUN[name](page);
  } catch (error) {
    finding(name, "scenario threw", String(error?.stack ?? error).slice(0, 600));
    if (page.dead) {
      say("page dead; the run stops here");
      break;
    }
  }
  say(`— ${name} done in ${((Date.now() - started) / 1000).toFixed(0)} s`);
}
try {
  await contact(page);
} catch {}
if (page.hangs.length) finding("run", "hang", page.hangs);
await page.stop();
say(`${findings.length} findings; ${OUT}`);
writeFileSync(join(OUT, "DONE"), `${findings.length}\n`);
