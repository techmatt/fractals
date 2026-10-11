// The Deep tab's GPU kernel held to its CPU kernel, picture against picture, on this
// machine's real adapter *(gpu_deep_ship_ckpt162)*.
//
// For each frame: load it with `kernel=cpu`, let it come to rest, read the canvas; load it
// again with `kernel=gpu`, rest, read again, and read the Details line's `data-kernel`. The
// two canvases are compared by stage 2's visible-pixel rule (`visible.mjs`), with the CPU
// picture as the reference: a frame **matches** at 1% visible or less and is **acceptable**
// at 5% or less. `link-fidelity.mjs` is what proves the CPU kernel exact; this proves the GPU
// draws the same picture a reader would see.
//
// A GPU load whose Details line says the CPU drew it is a **named skip** with the GPU's own
// reason, never a pass; a browser with no WebGPU adapter at all skips the whole run by name.
// The frames are the stage-2 views past 1e-50 (A, B, C, and D, the degree-3 minibrot whose
// interior the kernel's proof settles), the deep links the site publishes, one Mandelbrot
// and one Julia set per degree 2 to 6, `random-dives#337`, the long tail the tail rule
// was measured on, and the golden-mean Siegel boundary, the frame nearest the 1% line.
//
//   node explorer/bench/deep-gpu-agree.mjs [--only=<name>,<name>] [--port=8000]
//
// `python -m builder serve` must be up. It prints a row per frame and records
// `artifacts/explorer-bench/deep-gpu-agree.json`; it exits 1 when any frame is past 5% or a
// load never came to rest, and lists every frame past 1%. No part of `builder check` or CI,
// which have no adapter; about twenty minutes, most of it the CPU loads.

import { open, sleep } from "./cdp.mjs";
import { record } from "./output.mjs";
import { ACCEPTABLE, MATCH, verdictOf, visible } from "./visible.mjs";

const option = (name) => process.argv.find((arg) => arg.startsWith(`--${name}=`))?.split("=")[1];
const only = option("only")?.split(",") ?? null;
const PORT = option("port") ?? process.env.PORT ?? "8000";
const ORIGIN = `http://localhost:${PORT}/explorer/`;

const z = (n) => "0".repeat(n);
/** Stage 2's D view (`dive-sheet:u0772`'s centre), spelled long, at the given depth. */
const D = (w, n) =>
  "dv=3&f=multibrot3" +
  "&x=0.1910258774893687636653877341274335024092451852712527787373444953080999108165070735350743200670512192979234202411" +
  "&y=0.7697886011067241138026380754819675260484313308802967905631746244826988315742777985064207673891411360184969591657" +
  `&w=${w}&n=${n}&p=twilight_shifted`;

/** Each frame as a committed literal, named for where it came from. */
const FRAMES = {
  // Degree 2.
  "anchor 2e-11":
    "dv=3&x=-0.74501772828532335842941892835857434&y=0.14993443275456819177805709088257971&w=2e-11&n=48551&p=inferno",
  "go:seahorse-end":
    "dv=3&x=-0.74937053247003823168823992075369&y=0.041472667068168900034718746387049&w=3.4869054402668363e-15&n=63534&p=glowdon&scale=absolute&lambda=0&period=0.25",
  "deep-gallery#1":
    "dv=3&x=0.416430980278418242193322&y=-0.327457674651491584712249&w=1.48e-17&n=72990&p=visions-25&phase=0.548&scale=absolute&lambda=0.15&period=1.6",
  "deep-gallery#17 Julia":
    "dv=3&cx=0.416430980278418242282411583&cy=-0.327457674651491586571633386&x=0.416430980278418240531025249&y=-0.327457674651491585527422356&w=1.22e-17&n=146650&p=Chalcedony&phase=0.247&scale=absolute&lambda=0.3&period=19.3",
  "B-1e-80":
    "dv=3&x=-0.747102167390933138624904793338996994904308695362993964762533162938471238595520844140625" +
    "&y=-0.125652637396963165462380965272284382567197549561391109397067549423809159778107326171875" +
    "&w=1e-80&n=649614&p=twilight_shifted",
  "C-1e-80 Julia":
    "dv=3&cx=-0.747102167390933138625728909934578786053109039383977227197551796239669129000470514453125" +
    "&cy=-0.125652637396963165457448222514078642178107541347455939820652471040391047399697773828125" +
    "&x=-0.747102167390933138625728909934578786053109039383977227197551796239669129000470514453125" +
    "&y=-0.125652637396963165457448222514078642178107541347455939820652471040391047399697773828125" +
    "&w=1e-80&n=324807&p=twilight_shifted",
  "M-1e-100": `dv=3&x=0.${z(100)}25&y=1.${z(100)}15&w=1e-100&p=twilight_shifted`,
  // The near-threshold frame: the golden-mean Siegel disc's boundary, where long chaotic
  // orbits swap capped and escaped samples between double-single and `f64` in both
  // directions (0.88% visible when the Phase 3 review found it). Not a proof error: the
  // GPU proves no sample of it interior.
  "siegel-M 1e-6":
    "dv=3&x=-0.3905408702184000506697626007137984858176&y=-0.5867879073469687511967146430557158400967&w=1e-6&n=200000&p=twilight_shifted",
  // Degree 3.
  "deep-gallery#4":
    "dv=3&f=multibrot3&x=0.4099618230638989641036299883&y=0.6016943539588373952892855668&w=3.51e-21&n=206080&p=wallhaven_wallhaven-kwg7v6&phase=0.644&scale=absolute&lambda=0&period=0.514",
  "go:multibrot3-end":
    "dv=3&f=multibrot3&x=-0.091789550132415001067&y=0.770122710433646015127&w=5.844395282808642e-13&n=1028544&p=Terminal%20Flare&phase=0.681&scale=absolute&lambda=0.157&period=2270&knee=5000",
  "go:favicon-end":
    "dv=3&f=multibrot3&x=-0.091787572404909345106232727870690288512781443&y=0.770122809612858986618006679377867322680058673&w=3.331396073173065e-20&n=2000000&p=along-the-starry-way-25&phase=0.6315789473684212&scale=absolute&lambda=0.15&period=2.5333333333333337",
  "dive-sheet:u0772":
    "dv=3&f=multibrot3&x=0.19102587748936876366538773412&y=0.76978860110672411380263807548&w=4.079101949823663e-22&n=91166&p=cmr.emergency&phase=0.255&scale=absolute&lambda=0.15&period=0.607",
  "D-1e-60": D("1e-60", 245080),
  "D-1e-80": D("1e-80", 324807),
  "D-1e-100": D("1e-100", 404533),
  "go:julia3-end":
    "dv=3&f=julia3&cx=-0.58413281594404725991481&cy=0.59245849880966115110917&x=-0.584132815944058992898512215843141062&y=0.5924584988096639248232840130634390744&w=9.56660258469484e-19&n=1607102&p=Ink%20%26%20Fuchsia%20Flare&phase=0.091&scale=absolute&lambda=0.157&period=1870&knee=5000",
  // Degree 4.
  "deep-gallery#0":
    "dv=3&f=multibrot4&x=0.46213756663599396642203&y=0.63716077751275259356461&w=2.95e-16&n=67810&p=gemini-25&phase=0.274&scale=absolute&period=812",
  "random-dives#6":
    "dv=3&f=multibrot4&x=0.31872587250583457794594&y=0.74984312750261768882059&w=9.491066615678378e-15&n=1449392&p=795548-3840x2160-desktop-4k-fractal-background&phase=0.23&scale=absolute&lambda=0&period=0.44",
  "deep-gallery#43 Julia":
    "dv=3&f=julia4&cx=0.5083915086801963955211&cy=0.6503769802361925397409&x=0.50839150868150646175466574305506&y=0.65037698023628680100690871973694&w=1.2665591191544339e-12&n=1620000&p=BuGn&phase=0.976&mirror=1&scale=absolute&lambda=0&period=0.2008",
  // Degree 5.
  "random-dives#337":
    "dv=3&f=multibrot5&x=0.619854127581862228404287&y=0.513290921285380470622871&w=7.342553728286889e-16&n=1935908&p=Amber%20Signal&phase=0.311&scale=absolute&lambda=0&period=0.321",
  "A-1e-60":
    "dv=3&f=multibrot5&x=0.6477473116173450093090170021243187238082842294228079986531972265625" +
    "&y=0.5177656398110725968877340046398762808296533138887045880159123046875&w=1e-60&n=245080&p=twilight_shifted",
  "deep-gallery#47 Julia":
    "dv=3&f=julia5&cx=0.66616831546320803226979394142613758&cy=0.782735297907992585741603133271278035&x=0.000086251923016585676&y=-0.0000281573646113747857&w=0.007250744942350984&n=1765050&p=dolphin-dance-25&phase=0.9468&scale=absolute&lambda=0&period=0.355",
  // Degree 6.
  "deep-gallery#3":
    "dv=3&f=multibrot6&x=0.6987676527736156598101284202&y=0.4167238248186412616319658312&w=7.18e-21&n=86201&p=Brass%20Tide&phase=0.37&scale=absolute&period=1750",
  "deep-gallery#19 Julia":
    "dv=3&f=julia6&cx=0.731317921888244089723623346751&cy=0.387113729318409700562713089968&x=0.731317921888244089723034008353&y=0.387113729318409700563659204364&w=6.67e-21&n=86329&p=fractal_flowers_abstract_104352_2560x1600&phase=0.343&scale=absolute&lambda=0&period=1.01",
};

const QUIET = `(() => {
  const deep = document.getElementById("deep-render");
  const prog = document.getElementById("deep-progress");
  const dot = document.getElementById("render-state")?.dataset.state;
  const deepQuiet = !deep || deep.textContent !== "Cancel";
  return deepQuiet && (!prog || prog.hidden) && (dot === "final" || dot === "stopped");
})()`;

/** The Details lines and a digest of the canvas: what rest waits on. */
const STATE = `(() => {
  const c = document.getElementById("canvas");
  const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
  let h = 2166136261;
  for (let i = 0; i < d.length; i += 3) { h ^= d[i]; h = Math.imul(h, 16777619) >>> 0; }
  const k = document.getElementById("deep-kernel");
  const g = globalThis.__deepGpu;
  return {
    hash: h,
    kernel: k?.dataset.kernel ?? null,
    said: k?.textContent ?? "",
    stats: document.getElementById("deep-stats")?.textContent ?? "",
    full: window.__fullPass ?? null,
    why: g ? (g.health?.why ?? null) : null,
    status: g ? (g.health?.status ?? null) : null,
  };
})()`;

/** The canvas's RGBA as base64, so a 1.7 MB raster crosses CDP as one string. */
const CANVAS = `(() => {
  const c = document.getElementById("canvas");
  const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
  let s = "";
  for (let i = 0; i < d.length; i += 0x8000) s += String.fromCharCode.apply(null, d.subarray(i, i + 0x8000));
  return { w: c.width, h: c.height, b64: btoa(s) };
})()`;

/** Rest: quiet, a kernel line written, and the canvas the same across three reads apart. */
async function rest(page, within) {
  const deadline = Date.now() + within;
  let last = null;
  let same = 0;
  while (Date.now() < deadline) {
    await sleep(500);
    let quiet = false;
    try {
      quiet = await page.evaluate(QUIET);
    } catch {
      quiet = false;
    }
    if (!quiet) {
      same = 0;
      continue;
    }
    const now = await page.evaluate(STATE).catch(() => null);
    if (now === null || now.kernel === null) {
      same = 0;
      continue;
    }
    same = last !== null && now.hash === last.hash ? same + 1 : 0;
    last = now;
    if (same >= 2) return now;
  }
  return null;
}

async function draw(page, link, kernel, within) {
  await page.send("Page.navigate", { url: `${ORIGIN}?${link}&panel=deep&kernel=${kernel}` });
  await sleep(500);
  const t0 = Date.now();
  const state = await rest(page, within);
  if (state === null) return null;
  const raw = await page.evaluate(CANVAS);
  const data = Buffer.from(raw.b64, "base64");
  // The full pass's own time, off the stats line ("full pass 884×496 · 6.87 s").
  const full = /full pass [^·]*· ([\d.]+) (ms|s)\b/.exec(state.full ?? state.stats);
  const fullMs = full ? Math.round(Number(full[1]) * (full[2] === "s" ? 1000 : 1)) : null;
  const handed = /; ([\d,]+) pixels? (?:was|were) finished on the CPU/.exec(state.said);
  return {
    ...state,
    wallMs: Date.now() - t0,
    fullMs,
    handed: handed ? Number(handed[1].replaceAll(",", "")) : 0,
    picture: { w: raw.w, h: raw.h, data },
  };
}

/** The full pass's stats line, kept as it is written: a frame that settles its colouring
 *  after landing ends on a recolor's line, which says no field time, often within a poll. */
const FULL_PASS = `document.addEventListener("DOMContentLoaded", () => {
  const s = document.getElementById("deep-stats");
  if (!s) return;
  new MutationObserver(() => {
    if (s.textContent.startsWith("full pass")) window.__fullPass = s.textContent;
  }).observe(s, { childList: true, subtree: true, characterData: true });
});`;

/** `Browser.close` on the browser's own websocket; a page target refuses it. */
async function browserClose(port) {
  try {
    const { webSocketDebuggerUrl } = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
    const socket = new WebSocket(webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      socket.addEventListener("open", resolve, { once: true });
      socket.addEventListener("error", reject, { once: true });
    });
    socket.send(JSON.stringify({ id: 1, method: "Browser.close" }));
    await sleep(1000);
    socket.close();
  } catch {
    // Already gone.
  }
}

// A debugging port per run: on Windows a closed headless Chrome can hold its port a while
// after it has stopped answering, and the next run's Chrome then never comes up on it.
const DEBUG_PORT = Number(option("debug-port") ?? 9500 + Math.floor(Math.random() * 400));
const page = await open({ port: DEBUG_PORT, width: 1600, height: 1000 });
const rows = [];
let failed = 0;
let adapter = null;
try {
  await page.send("Page.addScriptToEvaluateOnNewDocument", { source: FULL_PASS });
  await page.send("Page.navigate", { url: `${ORIGIN}?v=4` });
  await sleep(1000);
  adapter = await page.evaluate(`(async () => {
    if (!navigator.gpu) return null;
    const a = await navigator.gpu.requestAdapter();
    if (!a) return null;
    const i = a.info ?? {};
    return [i.vendor, i.architecture, i.description].filter(Boolean).join(" ") || "an adapter";
  })()`);
  if (adapter !== null) console.log(`adapter: ${adapter}`);
  for (const [name, link] of Object.entries(FRAMES)) {
    if (adapter === null) break;
    if (only !== null && !only.includes(name)) continue;
    const row = { name, link };
    const cpu = await draw(page, link, "cpu", 900000);
    const gpu = cpu === null ? null : await draw(page, link, "gpu", 900000);
    if (cpu === null || gpu === null) {
      row.verdict = "BUSY";
      row.error = `${cpu === null ? "cpu" : "gpu"} load never came to rest`;
      failed++;
    } else if (cpu.kernel !== "cpu") {
      row.verdict = "BUSY";
      row.error = `the kernel=cpu load says ${cpu.kernel}`;
      failed++;
    } else if (gpu.kernel !== "gpu") {
      row.verdict = "SKIP";
      row.why = gpu.why ?? gpu.status ?? "the GPU load says the CPU drew it";
    } else {
      Object.assign(row, visible(cpu.picture, gpu.picture));
      row.verdict = verdictOf(row.visible);
      if (row.visible > ACCEPTABLE) failed++;
    }
    // Times are the full pass's own off its stats line; the wall time from navigation to
    // rest is beside it.
    if (cpu !== null) Object.assign(row, { cpuMs: cpu.fullMs, cpuWallMs: cpu.wallMs, cpuStats: cpu.stats });
    if (gpu !== null) Object.assign(row, { gpuMs: gpu.fullMs, gpuWallMs: gpu.wallMs, gpuStats: gpu.stats, handed: gpu.handed });
    rows.push(row);
    const pct = (x) => (x === undefined ? "" : `${(100 * x).toFixed(2)}%`);
    console.log(
      `${name}: ${row.verdict}` +
        (row.visible !== undefined ? ` visible ${pct(row.visible)} moved ${pct(row.moved)}` : "") +
        (row.cpuMs != null ? ` · cpu ${row.cpuMs} ms` : "") +
        (row.gpuMs != null ? ` gpu ${row.gpuMs} ms` : "") +
        (row.handed ? ` (${row.handed} px to the CPU)` : "") +
        (row.why ? ` (${row.why})` : "") +
        (row.error ? ` (${row.error})` : ""),
    );
  }
} finally {
  // `close` kills the process it launched, and on Windows the browser it started can outlive
  // it holding the debugging port, so the browser is asked to go first, on its own target.
  await browserClose(DEBUG_PORT);
  await page.close();
}

if (adapter === null) {
  console.log("SKIPPED: no WebGPU adapter in this browser, so there is no GPU kernel to compare");
  record("deep-gpu-agree.json", { skipped: "no adapter", rows });
  process.exit(0);
}
const past = rows.filter((r) => r.visible !== undefined && r.visible > MATCH).map((r) => r.name);
const skipped = rows.filter((r) => r.verdict === "SKIP").map((r) => r.name);
record("deep-gpu-agree.json", { adapter, rows });
console.log(
  `${rows.length} frames: ${rows.filter((r) => r.verdict === "match").length} match, ` +
    `${rows.filter((r) => r.verdict === "acceptable").length} acceptable, ` +
    `${rows.filter((r) => r.verdict === "different").length} different, ${skipped.length} skipped` +
    (skipped.length ? ` (${skipped.join(", ")})` : "") +
    (past.length ? `; past 1%: ${past.join(", ")}` : ""),
);
process.exit(failed > 0 ? 1 : 0);
