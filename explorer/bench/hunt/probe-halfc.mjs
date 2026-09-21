// Half of an identity: what happens when a link names one of `cx`/`cy`, `px`/`py` or
// `zx`/`zy` and not the other.
//
// This found finding 3 and is now the regression guard for its fix. It used to draw: `cx`
// alone gave c = -0.4 - 0.6514609012382414i, the missing half taken from the shipped anchor,
// and the address bar canonicalized to that hybrid — a saved link naming a set nobody chose.
// Every half case should now refuse with a sentence naming the missing half, and `both` and
// `neither` should still draw. `u1-links.mjs` carries one case of this; the matrix is here.
//
//   python -m builder serve --port 8014
//   PORT=8014 node explorer/bench/hunt/probe-halfc.mjs
import { Page, SITE, say } from "./lib.mjs";
const p = await new Page({ debug: 9501, port: SITE }).start();
const cases = [
  ["both",        "v=3&f=julia&cx=-0.4&cy=0.6&p=twilight_shifted"],
  ["cx only",     "v=3&f=julia&cx=-0.4&p=twilight_shifted"],
  ["cy only",     "v=3&f=julia&cy=0.6&p=twilight_shifted"],
  ["neither",     "v=3&f=julia&p=twilight_shifted"],
  ["julia4 cx",   "v=3&f=julia4&cx=-0.4&p=twilight_shifted"],
  ["phoenix cx",  "v=3&f=phoenix&cx=0.5667&p=twilight_shifted"],
  ["phoenix cx,px", "v=3&f=phoenix&cx=0.5667&px=-0.5&p=twilight_shifted"],
];
for (const [name, q] of cases) {
  const answered = await p.open(`?${q}`, { settle: 1500 });
  await p.settled(80);
  const s = await p.state();
  say(name.padEnd(16), answered === "notice" ? `REFUSED: ${s.said.slice(0, 80)}` : `drew -> ${s.url}`);
  p.drain();
}
await p.stop();
