import { Page, say } from "./lib.mjs";
const p = await new Page({ debug: 9402 }).start();
const L = "v=3&f=multibrot4&x=0.3190049359670787&y=0.7493803355819899&w=0.00000030536169435018664&p=pink&mirror=1";
const t0 = Date.now();
for (let i = 0; i < 3; i++) {
  const t = Date.now();
  await p.open(`?${L}`);
  await p.settled(120);
  say(i, await p.canvasHash(), `${Date.now() - t} ms`, (await p.state()).url === L ? "fixed point" : "MOVED");
}
say("total", Date.now() - t0, "ms; logs:", p.drain());
await p.stop();
