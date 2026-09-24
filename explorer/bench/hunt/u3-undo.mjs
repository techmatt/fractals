// U3 — the way back, across every seam the prompt names.
//
// `undo.test.mjs` holds the trail's two rules in isolation. What is held here is the
// **page**: that one action is one entry, and that a step back puts the *picture* back and
// not only the address bar. Every step records the raster as well as the link, and the
// walk back compares both.
//
// usage: node explorer/bench/hunt/u3-undo.mjs [debugPort]
import { record } from "../output.mjs";
import { Page, SITE, say, sleep } from "./lib.mjs";

const debug = Number(process.argv[2] ?? 9430);
const page = await new Page({ debug, port: SITE }).start();
const findings = [];
const rows = [];

const HOME = "v=3&f=mandelbrot&x=-0.5&y=0&w=3&p=twilight_shifted";
const DEEP =
  "dv=2&x=-0.74501772828532335842941892835857434&y=0.14993443275456819177805709088257971" +
  "&w=2e-11&n=48551&p=twilight_shifted&panel=deep";

const ctrl = async (k, shift = false) => {
  await page.send("Input.dispatchKeyEvent", {
    type: "keyDown", key: k, modifiers: 2 + (shift ? 8 : 0),
    windowsVirtualKeyCode: k.toUpperCase().charCodeAt(0), text: "",
  });
  await page.send("Input.dispatchKeyEvent", {
    type: "keyUp", key: k, modifiers: 2 + (shift ? 8 : 0),
    windowsVirtualKeyCode: k.toUpperCase().charCodeAt(0),
  });
};
const back = () => ctrl("z");
const forward = () => ctrl("y");

/** A picture, as the page now stands: its link and its raster. */
async function shot() {
  await page.settled(200);
  const s = await page.state();
  return { url: s.url, hash: await page.canvasHash(), tab: s.tab };
}

async function stack(name, steps) {
  say(`U3: ${name}`);
  const row = { name, steps: [] };
  await page.open(`?${HOME}`, { settle: 900 });
  await page.settled(120);
  const marks = [await shot()];
  for (const [what, act] of steps) {
    await act();
    await sleep(700);
    const m = await shot();
    m.what = what;
    marks.push(m);
    row.steps.push({ what, url: m.url.slice(0, 80) });
  }
  // Walk back to the beginning, checking each rung.
  for (let i = marks.length - 1; i > 0; i--) {
    await back();
    await sleep(1400);
    const now = await shot();
    const want = marks[i - 1];
    if (now.url !== want.url) {
      findings.push({
        name, why: `step back ${marks.length - i} landed on ${now.url.slice(0, 70)}, wanted ${want.url.slice(0, 70)}`,
      });
      break;
    }
    if (want.hash && now.hash && want.hash !== now.hash) {
      findings.push({ name, why: `step back ${marks.length - i} put the link back but not the picture` });
      break;
    }
  }
  // And forward again.
  for (let i = 1; i < marks.length; i++) {
    await forward();
    await sleep(1400);
    const now = await shot();
    if (now.url !== marks[i].url) {
      findings.push({ name, why: `step forward ${i} landed on ${now.url.slice(0, 70)}, wanted ${marks[i].url.slice(0, 70)}` });
      break;
    }
  }
  const said = page.drain();
  if (said.length) findings.push({ name, why: `console: ${said.join(" | ").slice(0, 300)}` });
  rows.push(row);
  say(`  ${row.steps.length} steps, ${findings.filter((f) => f.name === name).length} findings`);
}

const click = (id) => () => page.ev(`document.getElementById('${id}')?.click()`);
const pick = (mode) => () =>
  page.ev(`(() => { const s = document.getElementById('mode'); s.value = '${mode}';
            s.dispatchEvent(new Event('change', { bubbles: true })); return s.value; })()`);

await stack("plain: zoom, pan, mode, palette, phase", [
  ["zoom in", async () => {
    const b = await page.ev(`(() => { const r = document.getElementById('canvas').getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
    await page.send("Input.dispatchMouseEvent", { type: "mouseWheel", x: b.x, y: b.y, deltaX: 0, deltaY: -240 });
  }],
  ["whole set", click("view-whole")],
  ["a mode", pick("smooth_stripe")],
  ["random palette", click("view-palette")],
  ["random phase", click("view-phase")],
]);

await stack("across the planes: Julia here, and back to the parameter plane", [
  ["julia here", click("view-julia")],
  ["a mode", pick("stripe")],
  // Not *Whole Julia set*: "Julia here" lands on the plane's home, where that button is
  // disabled on purpose, so the step made no rung and every later step read one short.
  ["random palette", click("view-palette")],
]);

// The shallow/deep contract. A deep view is a different reader and a different emitter,
// which is the seam most likely to lose a rung.
say("U3: across the shallow/deep contract");
{
  const name = "shallow -> deep -> shallow";
  await page.open(`?${HOME}`, { settle: 900 });
  await page.settled(120);
  const a = await shot();
  await page.open(`?${DEEP}`, { settle: 1800 });
  await page.settled(240);
  const b = await shot();
  await page.ev(`document.getElementById('deep-back')?.click()`);
  await sleep(2000);
  const c = await shot();
  rows.push({ name, steps: [a, b, c].map((m) => ({ url: m.url.slice(0, 70), tab: m.tab })) });
  // A navigation is a fresh document, so the trail does not span it — what is checked is
  // that the way out of the tab is a rung and that the key never throws.
  await back();
  await sleep(1800);
  const d = await shot();
  if (d.url !== b.url && d.url !== c.url) {
    findings.push({ name, why: `ctrl+z after leaving Deep landed somewhere new: ${d.url.slice(0, 80)}` });
  }
  const said = page.drain();
  if (said.length) findings.push({ name, why: `console: ${said.join(" | ").slice(0, 300)}` });
  say(`  out of deep: ${c.url.slice(0, 60)} | back: ${d.url.slice(0, 60)}`);
}

// A running walk. The rule under test is that a walk's own pictures do not each become a
// rung, and that a step back during one does not leave the walk half-owning the canvas.
say("U3: during a walk");
{
  const name = "a step back while the walk is running";
  await page.open(`?${HOME}`, { settle: 900 });
  await page.ev(`document.getElementById('tab-walk').click()`);
  await sleep(300);
  await page.ev(`document.getElementById('walk-start').click()`);
  await sleep(2500);
  await back();
  await sleep(1500);
  const s = await page.state();
  if (s.noticeUp) findings.push({ name, why: `a refusal came up during a walk: ${s.said}` });
  await page.ev(`(() => { const b = document.getElementById('walk-start'); if (b.textContent !== 'Start') b.click(); return b.textContent; })()`);
  await sleep(800);
  const said = page.drain();
  if (said.length) findings.push({ name, why: `console: ${said.join(" | ").slice(0, 300)}` });
  rows.push({ name, url: s.url?.slice(0, 80), dot: s.dot });
  say(`  survived: dot=${s.dot}`);
}

// A minibrot entered from the list, which is a frame nothing else on the page produced.
say("U3: a list-entered minibrot frame");
{
  const name = "into a minibrot and back";
  await page.open(`?${DEEP}`, { settle: 2000 });
  await page.settled(300);
  const before = await shot();
  await page.ev(`document.getElementById('deep-minibrots').click()`);
  for (let i = 0; i < 240 && !(await page.ev(
    `document.getElementById('deep-minibrots').textContent !== 'Looking…'`)); i++) await sleep(500);
  await sleep(800);
  const entries = await page.ev(`document.querySelectorAll('.minibrot').length`);
  if (entries > 1) {
    await page.ev(`document.querySelectorAll('.minibrot')[1].click()`);
    await sleep(2500);
    const after = await shot();
    await back();
    await sleep(4000);
    const now = await shot();
    if (now.url !== before.url) {
      findings.push({ name, why: `back from a minibrot landed on ${now.url.slice(0, 70)}, wanted ${before.url.slice(0, 70)}` });
    }
    rows.push({ name, entries, before: before.url.slice(0, 60), after: after.url.slice(0, 60), now: now.url.slice(0, 60) });
    say(`  ${entries} entries; back to the frame: ${now.url === before.url}`);
  } else {
    rows.push({ name, entries, note: "no entries to enter" });
    say(`  no entries found`);
  }
  const said = page.drain();
  if (said.length) findings.push({ name, why: `console: ${said.join(" | ").slice(0, 300)}` });
}

// Both ends of the trail. Nothing is said at either end by design; what must not happen
// is a throw or a picture that moves.
say("U3: past both ends");
{
  const name = "forty steps past each end";
  await page.open(`?${HOME}`, { settle: 900 });
  await page.settled(120);
  const at = await shot();
  for (let i = 0; i < 40; i++) await back();
  await sleep(1500);
  const b = await shot();
  for (let i = 0; i < 40; i++) await forward();
  await sleep(1500);
  const f = await shot();
  if (b.url !== at.url || f.url !== at.url) {
    findings.push({ name, why: `the ends moved the picture: start ${at.url.slice(0, 60)}, back ${b.url.slice(0, 60)}, forward ${f.url.slice(0, 60)}` });
  }
  const said = page.drain();
  if (said.length) findings.push({ name, why: `console: ${said.join(" | ").slice(0, 300)}` });
  rows.push({ name, held: b.url === at.url && f.url === at.url });
  say(`  held: ${b.url === at.url && f.url === at.url}`);
}

record("hunt-u3.json", { rows, findings });
say(`U3 done: ${findings.length} findings`);
for (const f of findings) say("  FINDING", f.name, "—", f.why);
await page.stop();
