// The Deep tab's final picture, held to itself across two servers or two ways of arriving
// *(deep_wait_ckpt163)*.
//
// `--mode=servers` (the default) loads each frame on two origins under one setting and
// compares the rested canvases **exactly**: run with the committed tree on one port and a
// changed one on the other, it proves a change moved no pixel of the final picture. With
// `--kernel=cpu` that is the CPU kernel's picture, which a quarter drawn as a subset of the
// full grid, or any other change to how the pool is fed, must not move by a single byte.
//
// `--mode=paths` compares two ways of reaching each frame on one origin, with the GPU box
// ticked as a reader has it (no `kernel=`): a fresh navigation, which runs the self-test
// beside the frame, against the frame landed through the page's own door for a link
// (`demo.open`) after another frame has been drawn, when the self-test has long passed.
// The rule the tab is held to is that the two never differ on one machine.
//
//   node explorer/bench/deep-same.mjs [--mode=servers|paths] [--a=8000] [--b=8001]
//                                     [--kernel=cpu|gpu|ticked] [--only=<name>,…] [--all]
//
// The frames are `deep-gpu-frames.mjs`'s `FRAMES`, less the two whose CPU full pass is
// minutes unless `--all`, and with its three D frames swapped for structured ones at the same
// depths *(cleanup_ckpt163)*. D is stage 2's minibrot interior: at screen size it is one
// solid colour at 1e-60, 1e-80 and 1e-100 alike, so all three hashed 2530616773 on both
// kernels and matched themselves without testing anything. The ladder's busy frames stand in,
// each under a minute on the CPU and drawn on the GPU when ticked: `B-1e-60`, `A-1e-80` and
// `A-1e-100` (`B-1e-80` is one of the two minutes-long frames already here behind `--all`,
// and `B-1e-100` is longer still). A run also names any two frames that came to one picture,
// since a frame that matches its neighbour proves nothing about either.
// Exits 1 where any frame differs or never came to rest. It records
// `artifacts/explorer-bench/deep-same-<mode>.json`. No part of `builder check` or CI.

import { open, sleep } from "./cdp.mjs";
import { FRAMES, LADDER } from "./deep-gpu-frames.mjs";
import { record } from "./output.mjs";

const option = (name) => process.argv.find((arg) => arg.startsWith(`--${name}=`))?.split("=")[1];
const MODE = option("mode") ?? "servers";
const A = option("a") ?? "8000";
const B = option("b") ?? "8001";
const KERNEL = option("kernel") ?? (MODE === "paths" ? "ticked" : "cpu");
const only = option("only")?.split(",") ?? null;
const SLOW = new Set(["B-1e-80", "C-1e-80 Julia"]);
const STRUCTURED = { "D-1e-60": "B-1e-60", "D-1e-80": "A-1e-80", "D-1e-100": "A-1e-100" };
const CASES = Object.entries(FRAMES).map(([name, link]) =>
  name in STRUCTURED ? [STRUCTURED[name], LADDER[STRUCTURED[name]]] : [name, link],
);
const frames = CASES.filter(
  ([name]) => (only === null || only.includes(name)) && (process.argv.includes("--all") || only !== null || !SLOW.has(name)),
);

const QUIET = `(() => {
  const deep = document.getElementById("deep-render");
  const prog = document.getElementById("deep-progress");
  const dot = document.getElementById("render-state")?.dataset.state;
  const deepQuiet = !deep || deep.textContent !== "Cancel";
  return deepQuiet && (!prog || prog.hidden) && (dot === "final" || dot === "stopped");
})()`;

const STATE = `(() => {
  const c = document.getElementById("canvas");
  const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
  let h = 2166136261;
  for (let i = 0; i < d.length; i++) { h ^= d[i]; h = Math.imul(h, 16777619) >>> 0; }
  return { hash: h, kernel: document.getElementById("deep-kernel")?.dataset.kernel ?? null, w: c.width, h: c.height };
})()`;

const TICKED = `(() => { try { localStorage.setItem("explorer.deep-gpu", "on"); } catch {} })();`;

async function rest(page, within = 900000) {
  const deadline = Date.now() + within;
  let last = null;
  let same = 0;
  while (Date.now() < deadline) {
    await sleep(500);
    const quiet = await page.evaluate(QUIET).catch(() => false);
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

const query = (link) => `${link}&panel=deep${KERNEL === "ticked" ? "" : `&kernel=${KERNEL}`}`;

async function navigate(page, port, link) {
  await page.send("Page.navigate", { url: `http://localhost:${port}/explorer/?${query(link)}` });
  await sleep(500);
  return rest(page);
}

async function land(page, link) {
  await page.evaluate(`globalThis.__demo.open(${JSON.stringify(query(link))})`);
  await sleep(500);
  return rest(page);
}

const debug = 9500 + Math.floor(Math.random() * 380);
const pages = {
  a: await open({ port: debug, width: 1920, height: 1055 }),
  b: await open({ port: debug + 9, width: 1920, height: 1055 }),
};
for (const page of Object.values(pages)) {
  if (KERNEL === "ticked") await page.send("Page.addScriptToEvaluateOnNewDocument", { source: TICKED });
}
if (MODE === "paths") {
  // The landing browser is up and has drawn a frame of its own first.
  await navigate(pages.b, A, `dv=3&x=-0.7436438870371587&y=0.131825904205312&w=1e-12&p=inferno&scale=absolute&demo=1`);
}

const rows = [];
let failed = 0;
for (const [name, link] of frames) {
  const first = await navigate(pages.a, A, link);
  const second = MODE === "paths" ? await land(pages.b, link) : await navigate(pages.b, B, link);
  const row = { name, a: first, b: second };
  if (first === null || second === null) {
    row.verdict = "BUSY";
    failed++;
  } else if (first.w !== second.w || first.h !== second.h) {
    row.verdict = "SIZE";
    failed++;
  } else {
    row.verdict = first.hash === second.hash && first.kernel === second.kernel ? "SAME" : "DIFFER";
    if (row.verdict !== "SAME") failed++;
  }
  rows.push(row);
  console.log(`${name}: ${row.verdict} · ${first?.kernel ?? "-"} ${first?.hash ?? "-"} / ${second?.kernel ?? "-"} ${second?.hash ?? "-"}`);
  record(`deep-same-${MODE}.json`, { mode: MODE, kernel: KERNEL, a: A, b: B, rows });
}
console.log(`${rows.length - failed}/${rows.length} the same`);
const pictures = new Map();
for (const row of rows) {
  if (row.a === null) continue;
  const key = `${row.a.kernel} ${row.a.hash}`;
  pictures.set(key, [...(pictures.get(key) ?? []), row.name]);
}
for (const [key, names] of pictures) {
  if (names.length > 1) console.log(`one picture (${key}): ${names.join(", ")}`);
}
for (const page of Object.values(pages)) await page.close().catch(() => {});
process.exit(failed > 0 ? 1 : 0);
