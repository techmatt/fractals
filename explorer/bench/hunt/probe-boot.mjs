// How long an honest boot takes, so that `index.html`'s fallback delay is chosen rather than
// guessed. A fresh tab each time, the HTTP cache disabled, at four connection speeds.
//
// The number it was chosen from: 222-456 ms locally, ~4.9 s on fast 3G, ~17 s on slow 3G,
// ~42 s on a 2G-ish profile — so the notice is replaced at 45 s, past the slowest boot that
// still arrived. A false "this failed" is the expensive error in both directions.
//
// ⚠ The 2G leg can trip the harness watchdog: 30 s is `send`'s default and the main thread
// is busy for longer than that under the heaviest throttle. A `-1` in the row is a boot that
// did not arrive inside the poll limit, not a boot that failed.
//
//   python -m builder serve --port 8014
//   PORT=8014 node explorer/bench/hunt/probe-boot.mjs
import { Page, SITE, say } from "./lib.mjs";

const HOME = "v=3&f=mandelbrot&x=-0.5&y=0&w=3&p=twilight_shifted";
const NETS = [
  ["local     ", null],
  ["fast 3G   ", { downloadThroughput: (1.6e6 / 8), uploadThroughput: (750e3 / 8), latency: 150 }],
  ["slow 3G   ", { downloadThroughput: (400e3 / 8), uploadThroughput: (400e3 / 8), latency: 400 }],
  ["2G-ish    ", { downloadThroughput: (150e3 / 8), uploadThroughput: (150e3 / 8), latency: 800 }],
];

for (const [name, net] of NETS) {
  const p = await new Page({ debug: 9506, port: SITE }).start();
  await p.send("Network.enable");
  await p.send("Network.setCacheDisabled", { cacheDisabled: true });
  if (net) await p.send("Network.emulateNetworkConditions", { offline: false, ...net });
  const took = [];
  for (let i = 0; i < 3; i++) {
    const began = performance.now();
    const answered = await p.open(`?${HOME}`, { settle: 0, limit: 400 });
    took.push(answered === "studio" ? Math.round(performance.now() - began) : -1);
  }
  say(`${name} studio visible after: ${took.join(" / ")} ms`);
  await p.stop();
}
