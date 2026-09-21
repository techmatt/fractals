// The unbalanced pointer sequence, with the page's own gesture state read back.
import { Page, SITE, say, sleep } from "./lib.mjs";
const p = await new Page({ debug: 9498, port: SITE }).start();
const HOME = "v=3&f=mandelbrot&x=-0.5&y=0&w=3&p=twilight_shifted";
const m = (type, x, y, extra = {}) =>
  p.send("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1, ...extra });

async function run(name, fn) {
  await p.open(`?${HOME}`, { settle: 1200 });
  await p.settled(80);
  const before = await p.state();
  await fn();
  for (const t of [1, 3, 8, 20, 45]) {
    await sleep(t === 1 ? 1000 : 3000);
    const s = await p.state();
    if (s.dot === "final" || s.dot === "stopped") { say(`${name}: settled by ~${t}s, dot=${s.dot}`); return; }
  }
  const s = await p.state();
  say(`${name}: STUCK dot=${s.dot} stats=${JSON.stringify((s.stats ?? "").slice(0, 60))} url=${(s.url ?? "").slice(0, 46)} (was ${(before.url ?? "").slice(0, 46)})`);
  say("   console:", p.drain());
}

await run("press, move, press again, release", async () => {
  await m("mousePressed", 700, 400);
  for (let i = 0; i < 10; i++) await m("mouseMoved", 700 + i * 8, 400);
  await m("mousePressed", 650, 350);
  await m("mouseReleased", 650, 350);
});
await run("press, move, no release at all", async () => {
  await m("mousePressed", 700, 400);
  for (let i = 0; i < 10; i++) await m("mouseMoved", 700 + i * 8, 400);
});
await run("press, move, release outside the canvas", async () => {
  await m("mousePressed", 700, 400);
  for (let i = 0; i < 10; i++) await m("mouseMoved", 700 + i * 8, 400);
  await m("mouseReleased", 5, 5);
});
await run("plain drag, for the control", async () => {
  await m("mousePressed", 700, 400);
  for (let i = 0; i < 10; i++) await m("mouseMoved", 700 + i * 8, 400);
  await m("mouseReleased", 780, 400);
});
await p.stop();
