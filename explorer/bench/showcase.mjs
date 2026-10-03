// The showcase video: a scripted tour of the explorer, captured from the real UI and
// assembled into a 30 fps MP4 *(showcase_video_build_ckpt159)*.
//
//   node explorer/bench/showcase.mjs [out-dir] [port]
//
// `python -m builder serve` must be up on 8000. Output lands in `scratch/showcase/` unless
// another directory is named: `frames/` (every captured frame), `concat.txt`, `beats.json`
// (where each beat starts and ends in the video), and `mandelnaut_showcase.mp4`. ffmpeg is
// the binary `imageio_ffmpeg` bundles, asked of Python, so nothing needs installing.
//
// **Three kinds of footage, one timeline.** The page runs in demo mode (`?demo=1`,
// `explorer/demo.js`), which draws the cursor and owns the clock the cursor reads.
//
// - **Stepped**: cursor moves, scrolls and click pulses. The clock is pinned and moved on one
//   frame at a time, a screenshot each, so a move is smooth whatever a screenshot costs.
// - **Live**: anything that renders a shallow picture. The clock runs on the wall and a
//   screencast keeps every frame Chrome paints with its own timestamp, so each stage of a
//   render is on screen for exactly as long as it really took, previews included.
// - **Cuts**: the Deep tab. Its waits are minutes, so a deep picture is a still taken once
//   `__demo.deepReady()` says it has drawn to the end, and held.
//
// Every click is a real mouse event sent through the browser at the drawn cursor's tip.
// Nothing here asserts anything, the same as the rest of `bench/`.

import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { open, sleep } from "./cdp.mjs";

const [, , outArg = "scratch/showcase", port = "9470"] = process.argv;
const OUT = resolve(outArg);
const FRAMES = join(OUT, "frames");
const ORIGIN = "http://localhost:8000";
const FPS = 30;
const FRAME_MS = 1000 / FPS;
const WIDTH = 1920;
const HEIGHT = 1080;
const QUALITY = 92;

// ------------------------------------------------------------------ the path
//
// Every choice below is the planning sheet's (scratch/showcase_plan/index.html, letters in
// brackets) or a probe's answer to it; the report beside the video says which.

/** [2D] The Scarlet Lantern Julia, as the general gallery seats it. */
const HERO_KEY = "2fd9890d487a9782";
/** [3A, re-aimed] The eye of the spiral right of centre, found by recentring on its dark
 *  disc six times over (scratch/showcase/probe-eye2.mjs), and how many 1.15× notches go
 *  into it: 38 is ×202, the deepest probed end that still lands in about a second. */
const EYE = { x: 0.4375192845561648, y: 0.06339884287635515 };
const ZOOM_NOTCHES = 38;
/** The pace asked for; the page's own handling of a notch (~110 ms) is what sets it. */
const NOTCH_MS = 70;
/** [4A] Warm to cool, all on the Popular grid under the picture. */
const PALETTES = [
  "wallhaven_wallhaven-6d3zz6",
  "Rose Furnace",
  "river-of-light-25",
  "visionary-spires-25",
  "fractal_abstraction_lines_130499_2560x1600",
];
/** [5B] Ember Against Steel, a cubic Multibrot, opened as a cut and walked through four modes. */
const MODE_VIEW =
  "v=4&f=multibrot3&m=threads&x=0.41691833629614466&y=0.006924273487264031&w=0.0000004578508045543094&p=Ember%20Against%20Steel&phase=0.049494";
const MODES = ["smooth", "tia", "stripe", "threads"];
/** [7A] The marks the cursor sweeps over on the z² plate, by their aria-label's place, and
 *  the one it clicks (a published Mandelbrot seat, Chalcedony). */
const SWEEP_MARK = "-0.19968144 + 0.67566608i";
const CLICK_MARK = "-0.51902498 + 0.51337248i";
/** [8aD] The Dive's landing, fixed: Random dives row 105, a Mandelbrot copy at 1.6e-15. */
const LANDING =
  "dv=3&x=-0.19599662263968433271287&y=-0.67072144230774529882991&w=1.6174822950825801e-15&n=1898236&p=Rose%20Quartz%20Deep&phase=0.297&scale=absolute&lambda=0&period=0.34400000000000003";
/** [8bA] Three decades of descent, as cuts. */
const CUTS = [
  "dv=3&x=-0.7457678733494240262&y=-0.1642103703068078663&w=2.370620930576088e-11&n=628120&p=fractal_flowers_abstract_104352_2560x1600&phase=0.7539&scale=absolute&lambda=0&period=0.1201",
  "dv=3&x=-0.749449505859123081945&y=0.094426240163924656299&w=5.03602929192567e-13&n=1877888&p=cet_diverging_bwr_20_95_c54&phase=0.164&mirror=1&scale=absolute&lambda=0&period=0.201",
  "dv=3&x=-0.748738954044648030223533819&y=-0.125038735681201010900414782&w=1.1296319426470532e-19&n=1568108&p=triangulate-25&phase=0.102&scale=absolute&lambda=0&period=0.2005",
];
/** [9D] */
const CAPTION = "Mandelnaut Explorer · techmatt.github.io/fractals/explorer";

// ------------------------------------------------------------------ the recorder

rmSync(FRAMES, { recursive: true, force: true });
mkdirSync(FRAMES, { recursive: true });
/** Every frame of the video, in order, with how long it is held: the concat list. */
const reel = [];
let seconds = 0;
let shots = 0;
const beats = [];
const notes = [];
const say = (text) => {
  notes.push(text);
  console.log(`${seconds.toFixed(2)}s  ${text}`);
};

const page = await open({ port: Number(port), width: WIDTH, height: HEIGHT });
await page.send("Emulation.setDeviceMetricsOverride", { width: WIDTH, height: HEIGHT, deviceScaleFactor: 1, mobile: false });

function keep(data, hold) {
  const name = `f${String(++shots).padStart(5, "0")}.jpg`;
  writeFileSync(join(FRAMES, name), Buffer.from(data, "base64"));
  reel.push({ name, hold });
  seconds += hold;
}
async function screenshot() {
  return (await page.send("Page.captureScreenshot", { format: "jpeg", quality: QUALITY })).data;
}
/** One frame, held for `ms`. */
async function still(ms) {
  keep(await screenshot(), ms / 1000);
}

const js = (value) => JSON.stringify(value);
const mouse = (type, at, extra = {}) =>
  page.send("Input.dispatchMouseEvent", { type, x: at.x, y: at.y, button: "none", ...extra });
const where = () => page.evaluate("__demo.where()");

/** Stepped footage: pin the clock, start `begin` (an expression that starts animations), and
 *  take `ms` of frames one at a time, moving the real pointer with the drawn one. */
async function stepped(ms, begin = "0", { hover = true, at = null } = {}) {
  await page.evaluate("__demo.step(true)");
  await page.evaluate(`void (${begin})`);
  const frames = Math.max(1, Math.round(ms / FRAME_MS));
  for (let i = 0; i < frames; i++) {
    await page.evaluate(`__demo.advance(${FRAME_MS})`);
    if (hover) await mouse("mouseMoved", await where());
    if (at !== null) await at(i);
    keep(await screenshot(), 1 / FPS);
  }
  await page.evaluate("__demo.step(false)");
}

/** Ease the cursor to a target (a selector, or `{x, y}`) over `ms`. */
const move = (target, ms = 500, share = {}) => stepped(ms, `__demo.moveTo(${js(target)}, ${ms}, ${js(share)})`);

async function press() {
  const at = await where();
  await mouse("mousePressed", at, { button: "left", clickCount: 1 });
  await mouse("mouseReleased", at, { button: "left", clickCount: 1 });
}

/**
 * Live footage: run `act` with the clock on the wall and the screencast on, and keep going
 * until `ms` have passed and `until` (an expression) holds. Each frame is held until the
 * next one's timestamp, the last until the segment ends, so the segment lasts in the video
 * exactly as long as it did on the wall.
 */
async function live(ms, act, { until = "true", within = 30000 } = {}) {
  const frames = [];
  const off = page.on((message) => {
    if (message.method !== "Page.screencastFrame") return;
    frames.push({ data: message.params.data, at: message.params.metadata.timestamp });
    page.send("Page.screencastFrameAck", { sessionId: message.params.sessionId }).catch(() => {});
  });
  const first = await screenshot();
  const start = Date.now() / 1000;
  await page.send("Page.startScreencast", { format: "jpeg", quality: QUALITY, maxWidth: WIDTH, maxHeight: HEIGHT, everyNthFrame: 1 });
  await act();
  const deadline = Date.now() + within;
  while (Date.now() < start * 1000 + ms || !(await page.evaluate(until))) {
    if (Date.now() > deadline) {
      say(`live segment gave up waiting on ${until}`);
      break;
    }
    await sleep(15);
  }
  const end = Date.now() / 1000;
  await page.send("Page.stopScreencast");
  off();
  const kept = frames.filter((f) => f.at >= start && f.at <= end).sort((a, b) => a.at - b.at);
  const times = [start, ...kept.map((f) => f.at)];
  const datas = [first, ...kept.map((f) => f.data)];
  for (let i = 0; i < datas.length; i++) {
    const hold = (i + 1 < times.length ? times[i + 1] : end) - times[i];
    if (hold > 0.0005) keep(datas[i], hold);
  }
  return { frames: kept.length, wall: end - start };
}

/** A click: the ring at the cursor, and the real press, live for `ms` after. */
const click = (ms, opts) =>
  live(
    ms,
    async () => {
      await page.evaluate("void __demo.pulse()");
      await press();
    },
    opts,
  );

/** A click whose consequence is not to be watched happening: the ring is stepped, then the
 *  press, then whatever waits before the next frame is taken. */
async function clickThenCut() {
  await stepped(200, "__demo.pulse()");
  await press();
}

const beat = async (name, run) => {
  const from = seconds;
  await run();
  beats.push({ beat: name, from: Number(from.toFixed(2)), to: Number(seconds.toFixed(2)) });
  say(`beat ${name}: ${from.toFixed(2)}–${seconds.toFixed(2)} s`);
};

const final = "document.getElementById('render-state').dataset.state === 'final'";

// ------------------------------------------------------------------ the tour

try {
  // Off camera: the page, the General gallery, Browse over it with every visible tile in.
  await page.send("Page.navigate", { url: `${ORIGIN}/explorer/?demo=1&panel=gallery&collection=general` });
  await sleep(500);
  await page.until("globalThis.__demo?.ready === true", { within: 60000 });
  await page.until("document.querySelectorAll('#gallery-tiles img').length > 10", { within: 30000 });
  await page.until(final, { within: 60000 });
  await page.evaluate("document.getElementById('gallery-browse').click()");
  const tilesIn = `(() => { const imgs = [...document.querySelectorAll('#browse-tiles img')].filter(i => { const r = i.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight && r.width > 0; }); return imgs.length > 0 && imgs.every(i => i.complete && i.naturalWidth > 0); })()`;
  await page.until(tilesIn, { within: 30000 });
  await sleep(800);
  await page.evaluate(`void __demo.moveTo({ x: 1240, y: 640 }, 0)`);

  await beat("1 grid", async () => {
    await still(250);
    // One slow scroll down the grid, the tiles filling as it goes.
    await stepped(1400, "__demo.scroll('#browse-tiles', 1450, 1400)");
    await move("#browse-hues .chip:last-child", 500);
    await clickThenCut();
    await page.until(tilesIn, { within: 10000 });
    // [probe] Where the hero lands once the grid is lime: on screen, or scrolled to.
    const box = await page.evaluate(`(() => { const r = document.querySelector('#browse-tiles .tile[data-key="${HERO_KEY}"]').getBoundingClientRect(); return { top: r.top, bottom: r.bottom }; })()`);
    if (box.top < 250 || box.bottom > HEIGHT) {
      say(`hero off screen after the lime chip (${Math.round(box.top)}–${Math.round(box.bottom)}), scrolled to it`);
      await stepped(600, `__demo.scroll('#browse-tiles', document.getElementById('browse-tiles').scrollTop + ${Math.round(box.top - 400)}, 600)`);
    } else {
      say(`hero on screen after the lime chip at y ${Math.round(box.top)}–${Math.round(box.bottom)}`);
    }
    await still(200);
  });

  await beat("2 hero", async () => {
    await move(`#browse-tiles .tile[data-key="${HERO_KEY}"]`, 450, { dx: 0.55, dy: 0.5 });
    await click(650);
    await move("#browse-open", 400);
    await click(700, { until: final });
  });

  await beat("3 zoom", async () => {
    // The view up is the seat's own link; the wheel tracks the eye from it, a notch at the
    // whole pixel nearest the eye each time, mirroring the page's own `zoomAbout`.
    const q = new URLSearchParams(await page.evaluate("location.search"));
    const v = { x: Number(q.get("x")), y: Number(q.get("y")), w: Number(q.get("w")) };
    const box = await page.evaluate("(() => { const b = canvas.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height, W: canvas.width, H: canvas.height }; })()");
    const aspect = box.H / box.W;
    const eyeAt = () => ({
      x: box.x + ((EYE.x - v.x) / v.w + 0.5) * box.w,
      y: box.y + (0.5 - (EYE.y - v.y) / (v.w * aspect)) * box.h,
    });
    await move(eyeAt(), 500);
    const notch = async () => {
      const at = eyeAt();
      const c = { x: Math.round(at.x), y: Math.round(at.y) };
      await mouse("mouseWheel", c, { deltaX: 0, deltaY: -120 });
      const ax = v.x + ((c.x - box.x) / box.w - 0.5) * v.w;
      const ay = v.y + (0.5 - (c.y - box.y) / box.h) * v.w * aspect;
      const k = 1 / 1.15;
      v.x = ax + (v.x - ax) * k;
      v.y = ay + (v.y - ay) * k;
      v.w *= k;
    };
    const t0 = Date.now();
    const got = await live(ZOOM_NOTCHES * NOTCH_MS + 300, async () => {
      for (let i = 0; i < ZOOM_NOTCHES; i++) {
        await notch();
        await sleep(Math.max(0, t0 + (i + 1) * NOTCH_MS - Date.now()));
      }
    }, { until: final });
    say(`zoom: ${ZOOM_NOTCHES} notches, ${got.frames} screencast frames over ${got.wall.toFixed(2)} s; ends at ${await page.evaluate("location.search")}`);
  });

  await beat("4 palettes", async () => {
    for (const name of PALETTES) {
      await move(`#palette-list [data-palette="${name}"]`, 300);
      await click(280, { until: final });
    }
    await still(150);
  });

  await beat("5 modes", async () => {
    // A cut: Ember Against Steel, put up in smooth off camera.
    await page.evaluate(`__demo.open(${js(MODE_VIEW)})`);
    await page.until(final, { within: 60000 });
    const setMode = (m) => `(() => { const el = document.getElementById('mode'); el.value = ${js(m)}; el.dispatchEvent(new Event('change', { bubbles: true })); })()`;
    await page.evaluate(setMode(MODES[0]));
    await sleep(80);
    await page.until(final, { within: 60000 });
    await page.evaluate(`void __demo.moveTo('#mode', 0, { dx: 0.7, dy: 0.5 })`);
    await still(500);
    for (const m of MODES.slice(1)) {
      await stepped(150, "__demo.pulse()");
      await live(m === "threads" ? 1000 : 800, () => page.evaluate(setMode(m)), m === "threads" ? { until: final } : {});
    }
  });

  await beat("6 julia", async () => {
    await move("#view-julia", 400);
    await click(1100, { until: final });
  });

  await beat("7 atlas", async () => {
    await move("#tab-atlas", 400);
    await click(350, { until: `[...document.querySelectorAll('#atlas-host img')].some(i => i.complete && i.naturalWidth >= 400)` });
    await move("#atlas-host .plane", 350);
    await click(550, { until: final });
    const mark = (place) => `[...document.querySelectorAll('#atlas-host .mark.mark-mandelbrot')].find(m => m.getAttribute('aria-label').includes(${js(place)}))`;
    const sweep = await page.evaluate(`(() => { const r = ${mark(SWEEP_MARK)}.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
    const target = await page.evaluate(`(() => { const r = ${mark(CLICK_MARK)}.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
    await move(sweep, 450);
    await still(150);
    await move(target, 400);
    await still(100);
    await click(900, { until: final });
    say(`atlas mark opened ${await page.evaluate("location.search")}`);
  });

  await beat("8 deep", async () => {
    await move("#tab-deep", 400);
    await clickThenCut();
    const entered = await page.evaluate("__demo.deepReady({ within: 240000 })");
    say(`deep tab entered, ready ${entered}`);
    await still(450);
    await move("#dive-go", 400);
    await page.evaluate(`__demo.landing(${js(LANDING)})`);
    await clickThenCut();
    let t0 = Date.now();
    const landed = await page.evaluate("__demo.deepReady({ within: 600000 })");
    say(`dive landing ready ${landed} after ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    await still(1100);
    await page.evaluate("__demo.cursor(false)");
    for (const [i, cut] of CUTS.entries()) {
      await page.evaluate(`__demo.open(${js(cut)})`);
      await sleep(300);
      t0 = Date.now();
      const ready = await page.evaluate("__demo.deepReady({ within: 600000 })");
      say(`cut ${i + 1} ready ${ready} after ${((Date.now() - t0) / 1000).toFixed(1)} s`);
      await still(i + 1 < CUTS.length ? 850 : 800);
    }
  });

  await beat("9 close", async () => {
    await page.evaluate(`__demo.caption(${js(CAPTION)})`);
    await sleep(100);
    await still(2000);
  });
} finally {
  await page.close();
}

// ------------------------------------------------------------------ the video

const list = reel.map((f) => `file '${f.name}'\nduration ${f.hold.toFixed(6)}`).join("\n");
// The concat demuxer takes the last entry's duration only when the file is named again.
writeFileSync(join(FRAMES, "concat.txt"), `${list}\nfile '${reel.at(-1).name}'\n`);
writeFileSync(join(OUT, "beats.json"), JSON.stringify({ seconds: Number(seconds.toFixed(2)), frames: reel.length, beats, notes }, null, 1));
const ffmpeg = execFileSync("python", ["-c", "import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())"]).toString().trim();
const video = join(OUT, "mandelnaut_showcase.mp4");
execFileSync(
  ffmpeg,
  [
    "-y", "-loglevel", "error",
    "-f", "concat", "-safe", "0", "-i", join(FRAMES, "concat.txt"),
    // The frames are full-range JPEG; the video is the limited range every player assumes.
    "-vf", `fps=${FPS},scale=${WIDTH}:${HEIGHT}:out_range=tv,format=yuv420p`, "-color_range", "tv",
    // The repeated last entry would otherwise add a frame's worth more than the timeline.
    "-t", seconds.toFixed(3),
    "-c:v", "libx264", "-preset", "slow", "-crf", "16", "-r", String(FPS),
    "-movflags", "+faststart", video,
  ],
  { stdio: "inherit" },
);
console.log(`${reel.length} frames, ${seconds.toFixed(2)} s → ${video}`);
