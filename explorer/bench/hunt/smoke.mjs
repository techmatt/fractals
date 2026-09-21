// The harness's own self-test: open the home view, read the page, take a hash and metrics,
// then send a link the contract refuses and check the refusal arrives. Run it first after
// the harness moves or a page's ids change — every unit here is built on these seven calls.
//
//   python -m builder serve --port 8014
//   PORT=8014 node explorer/bench/hunt/smoke.mjs
import { Page, say } from "./lib.mjs";
const p = await new Page({ debug: 9401 }).start();
say("home:", await p.open(""));
say("state:", JSON.stringify(await p.state()));
say("settled:", await p.settled(60));
say("hash:", await p.canvasHash());
say("metrics:", JSON.stringify(await p.metrics()));
say("refusal case:", await p.open("?v=3&nonsense=1"));
say("refused:", JSON.stringify(await p.refused()));
say("logs:", p.drain());
await p.stop();
