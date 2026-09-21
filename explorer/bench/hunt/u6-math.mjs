// U6 — the edges of the math, driven through the controls rather than through links.
//
// U1 asks whether a *link* saying something absurd is refused. This asks the other half:
// whether a reader who types the same thing into a number box, or zooms until the doubles
// give out, or picks a cyclic map under a fold, gets a picture or a sentence. A blank
// canvas with a settled dot is the failure this unit exists to catch.
//
// usage: node explorer/bench/hunt/u6-math.mjs [debugPort]
import { record } from "../output.mjs";
import { Page, SITE, say, sleep } from "./lib.mjs";
import { FAMILIES, MODES } from "../../permalink.js";

const debug = Number(process.argv[2] ?? 9460);
const page = await new Page({ debug, port: SITE }).start();
const findings = [];
const rows = [];

/** Is there a picture here, and is it more than one flat colour? */
const painted = () => page.ev(`(() => {
  const c = document.getElementById('canvas');
  if (!c || !c.width) return { drawn: false };
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  const seen = new Set();
  let opaque = 0;
  for (let i = 0; i < d.length; i += 4 * 97) {
    seen.add(d[i] + ',' + d[i + 1] + ',' + d[i + 2]);
    if (d[i + 3] > 0) opaque++;
  }
  return { drawn: true, colours: seen.size, opaque, w: c.width, h: c.height };
})()`);

async function look(name, query, { expectFlat = false, settle = 1200 } = {}) {
  const row = { name };
  try {
    const answered = await page.open(`?${query}`, { settle });
    row.answered = answered;
    if (answered === "notice") {
      row.said = (await page.refused()).said.slice(0, 120);
    } else if (answered === "neither") {
      findings.push({ name, why: "neither a picture nor a notice" });
    } else {
      await page.settled(200);
      const s = await page.state();
      const p = await painted();
      Object.assign(row, p, { dot: s.dot, stats: s.stats?.slice(0, 60), status: s.status?.slice(0, 80) });
      // The failure this unit is for: the page says it is finished and there is nothing
      // on the canvas and nothing in the line under it.
      if (s.dot !== "rendering" && p.drawn && p.colours === 1 && !expectFlat && !s.status) {
        findings.push({ name, why: `one flat colour and nothing said (dot ${s.dot}, ${p.w}x${p.h})` });
      }
      if (!p.drawn) findings.push({ name, why: "no canvas at all" });
      if (p.drawn && p.opaque === 0) findings.push({ name, why: "the canvas is fully transparent" });
    }
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
  say(`  ${name}: ${row.answered} colours=${row.colours ?? "-"} dot=${row.dot ?? "-"}${row.said ? ` | ${row.said.slice(0, 70)}` : ""}`);
}

// --------------------------------------------------------------- every home view

say("U6: every family's home view");
for (const f of FAMILIES) {
  const c = f.startsWith("julia")
    ? "&cx=-0.4&cy=0.6"
    : f === "phoenix" ? "&cx=0.5667&cy=0&px=-0.5&py=0&zx=0&zy=0" : "";
  await look(`home:${f}`, `v=3&f=${f}${c}&p=twilight_shifted`);
}

// ------------------------------------------------- every mode, cyclic and not

say("U6: every mode on a cyclic and a non-cyclic map");
for (const m of MODES) {
  await look(`mode:${m}:cyclic`, `v=3&f=mandelbrot&x=-0.5&y=0&w=3&m=${m}&p=twilight`);
  await look(`mode:${m}:plain`, `v=3&f=mandelbrot&x=-0.5&y=0&w=3&m=${m}&p=viridis`);
}

// ------------------------------------------------------------- frames with nothing in

say("U6: all interior, all exterior, and the f64 floor");
await look("all interior", "v=3&f=mandelbrot&x=-0.2&y=0&w=0.05&p=twilight_shifted", { expectFlat: true });
await look("all exterior", "v=3&f=mandelbrot&x=3&y=3&w=0.5&p=twilight_shifted", { expectFlat: true });
await look("far outside", "v=3&f=mandelbrot&x=1000&y=1000&w=10&p=twilight_shifted", { expectFlat: true });
await look("a hair above the f64 floor", "v=3&f=mandelbrot&x=-0.743643887037151&y=0.13182590420533&w=1e-13&p=twilight_shifted");
await look("at the f64 floor", "v=3&f=mandelbrot&x=-0.743643887037151&y=0.13182590420533&w=1e-15&p=twilight_shifted");
await look("past the f64 floor", "v=3&f=mandelbrot&x=-0.743643887037151&y=0.13182590420533&w=1e-18&p=twilight_shifted");

say("U6: extreme aspects");
await look("1:10000", "v=3&f=mandelbrot&x=-0.5&y=0&w=3&a=1:10000&p=twilight_shifted");
await look("10000:1", "v=3&f=mandelbrot&x=-0.5&y=0&w=3&a=10000:1&p=twilight_shifted");
await look("1:1", "v=3&f=mandelbrot&x=-0.5&y=0&w=3&a=1:1&p=twilight_shifted");

say("U6: the recipe at its limits");
for (const [what, q] of [
  ["gamma tiny", "gamma=0.0001"],
  ["gamma huge", "gamma=1000"],
  ["cycles tiny", "cycles=0.0001"],
  ["cycles huge", "cycles=10000"],
  ["phase huge", "phase=1e9"],
  ["phase negative", "phase=-1e9"],
  ["reverse and mirror", "reverse=1&mirror=1"],
  ["edge weight zero", "transfer=edge:0"],
  ["edge weight huge", "transfer=edge:1000"],
  ["rank", "transfer=rank"],
  ["soft knee at zero", "rolloff=soft_knee:0"],
  ["soft knee near one", "rolloff=soft_knee:0.999"],
  ["reinhard", "rolloff=reinhard"],
  ["aces", "rolloff=aces"],
  ["level on", "level=1"],
]) {
  await look(`recipe:${what}`, `v=3&f=mandelbrot&x=-0.5&y=0&w=3&p=viridis&${q}`);
}

// -------------------------------------------------- the same values, typed in

say("U6: the number boxes fed junk, and then fed limits");
{
  const name = "typed junk into every number box";
  await page.open("?v=3&f=mandelbrot&x=-0.5&y=0&w=3&m=stripe&p=viridis", { settle: 1200 });
  await page.settled(120);
  const before = await page.canvasHash();
  try {
    const touched = await page.ev(`(async () => {
      const out = [];
      const boxes = [...document.querySelectorAll('input[type="number"], input.constant')];
      for (const b of boxes) {
        for (const junk of ['abc', '1e400', '-1e400', 'NaN', 'Infinity', '', '-0', '1e-400']) {
          b.value = junk;
          b.dispatchEvent(new Event('input', { bubbles: true }));
          b.dispatchEvent(new Event('change', { bubbles: true }));
          await new Promise((r) => setTimeout(r, 25));
        }
        out.push({ id: b.id || b.getAttribute('aria-label'), left: b.value });
      }
      return out;
    })()`, 120000);
    await page.settled(300);
    const s = await page.state();
    const p = await painted();
    const after = await page.canvasHash();
    rows.push({ name, boxes: touched?.length, dot: s.dot, colours: p.colours, moved: before !== after, url: s.url?.slice(0, 90) });
    if (s.noticeUp) findings.push({ name, why: `typing in a box brought up the whole-page refusal: ${s.said}` });
    if (p.drawn && p.colours === 1) findings.push({ name, why: "the canvas went to one flat colour" });
    say(`  ${touched?.length} boxes, dot=${s.dot}, colours=${p.colours}`);
  } catch (e) {
    findings.push({ name, why: String(e.message).slice(0, 160) });
  }
  const said = page.drain();
  if (said.length) findings.push({ name, why: `console: ${said.join(" | ").slice(0, 300)}` });
}

say("U6: zoomed to the floor with the keyboard, then asked to go deeper");
{
  const name = "keyboard zoom into the wall";
  await page.open("?v=3&f=mandelbrot&x=-0.743643887037151&y=0.13182590420533&w=0.001&p=viridis", { settle: 1200 });
  await page.settled(120);
  try {
    for (let i = 0; i < 80; i++) {
      await page.send("Input.dispatchKeyEvent", { type: "keyDown", key: "+", text: "+", windowsVirtualKeyCode: 187 });
      await page.send("Input.dispatchKeyEvent", { type: "keyUp", key: "+", windowsVirtualKeyCode: 187 });
      await sleep(40);
    }
    await page.settled(400);
    const s = await page.state();
    const p = await painted();
    rows.push({ name, dot: s.dot, status: s.status?.slice(0, 120), url: s.url?.slice(0, 90), colours: p.colours });
    if (!s.status && p.colours === 1) findings.push({ name, why: "zoomed past the wall into a flat canvas with nothing said" });
    say(`  dot=${s.dot} said=${JSON.stringify(s.status ?? "").slice(0, 90)}`);
  } catch (e) {
    findings.push({ name, why: String(e.message).slice(0, 160) });
  }
  const said = page.drain();
  if (said.length) findings.push({ name, why: `console: ${said.join(" | ").slice(0, 300)}` });
}

record("hunt-u6.json", { rows, findings });
say(`U6 done: ${findings.length} findings`);
for (const f of findings) say("  FINDING", f.name, "—", f.why);
await page.stop();
