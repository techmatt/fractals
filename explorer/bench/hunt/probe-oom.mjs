// Thirty alternating loads in one tab: deep link / home / gallery link. Every one of them
// must come up.
//
// This is finding 1's measurement, and the reason it stays: a document Chrome holds for the
// back/forward cache holds its workers too, so live worker count climbed a whole document's
// worth per navigation and wasm instantiation ran out of memory past the plateau. The page
// answered with the studio up, the dot on `rendering` and no picture — and it recovered on a
// later load, which is worse than failing cleanly.
//
// **A load "came up" when it drew, or when it refused on purpose.** A refusal is an answer;
// neither is a failure. What is a failure is `Out of memory` in the console, or a load that
// answered with neither.
//
// Before the `pagehide` teardown: 5 of 30 failed, workers 103-127. After: 0 of 30, workers
// flat at one document's worth — 13 shallow, 25-27 deep. It alternated two kinds over 24
// loads when it found the bug; three kinds over thirty is what the fix was judged by.
//
//   python -m builder serve --port 8014
//   PORT=8014 node explorer/bench/hunt/probe-oom.mjs
import { Page, SITE, say } from "./lib.mjs";

const LOADS = [
  ["deep ", "dv=2&x=-0.74501772828532335842941892835857434&y=0.14993443275456819177805709088257971&w=2e-11&n=48551&p=twilight_shifted&panel=deep"],
  ["home ", "v=3&f=mandelbrot&x=-0.5&y=0&w=3&p=twilight_shifted"],
  ["gallery", "v=3&f=multibrot4&x=0.3190049359670787&y=0.7493803355819899&w=0.00000030536169435018664&p=pink&mirror=1&panel=gallery"],
];

const p = await new Page({ debug: 9502, port: SITE }).start();
let failures = 0;
const workerSeries = [];
const bootMs = [];
for (let i = 1; i <= 30; i++) {
  const [name, query] = LOADS[(i - 1) % LOADS.length];
  const began = performance.now();
  const answered = await p.open(`?${query}`, { settle: 1200 });
  const boot = Math.round(performance.now() - began);
  await p.settled(100);
  const s = await p.state();
  const m = await p.metrics();
  const said = p.drain();
  const oom = said.filter((l) => /Out of memory|WebAssembly/.test(l));
  // A load "came up" when it drew, or refused on purpose. Neither is the failure.
  const up = answered === "studio" || (answered === "notice" && s.dot === "stopped");
  if (!up || oom.length) failures++;
  workerSeries.push(m.workers);
  if (up) bootMs.push(boot);
  say(
    `${String(i).padStart(2)} ${name} answered=${answered} dot=${s.dot} boot=${boot}ms ` +
      `heap=${m.heapMB}MB workers=${m.workers}` +
      (oom.length ? `  <-- OOM x${oom.length}` : "") +
      (!up ? "  <-- DID NOT COME UP" : "") +
      (said.length && !oom.length ? `  other: ${said[0].slice(0, 70)}` : ""),
  );
}
bootMs.sort((a, b) => a - b);
say("");
say(`failures: ${failures} of 30`);
say(`workers: ${workerSeries.join(" ")}`);
say(`workers max=${Math.max(...workerSeries)} last=${workerSeries.at(-1)}`);
say(`boot ms: median=${bootMs[bootMs.length >> 1]} p90=${bootMs[Math.floor(bootMs.length * 0.9)]} max=${bootMs.at(-1)}`);
await p.stop();
