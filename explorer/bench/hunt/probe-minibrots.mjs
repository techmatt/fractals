// How many nuclei the Deep tab's Nearby minibrots lists, on the frames the crate's own
// table measured. `perturb-wasm/README.md` §9 says 6 for `tangle 1e-22`; the tab listed 3,
// because it searched at the view's cap and a `dv` link pins that at the policy's 93,600
// while the largest nucleus there is period 94,776.
//
//   python -m builder serve --port 8014
//   PORT=8014 node explorer/bench/hunt/probe-minibrots.mjs
import { Page, SITE, say, sleep } from "./lib.mjs";

/** The committed centres, spelled exactly as `perturb-wasm/tests/common/mod.rs` has them. */
const FRAMES = [
  ["anchor 2e-11", "dv=2&x=-0.74501772828532335842941892835857434&y=0.14993443275456819177805709088257971&w=2e-11&n=48551&p=twilight_shifted&panel=deep", 6],
  ["tangle 1e-22", "dv=2&x=-0.745017728290198619298817365858&y=0.149934432756897045833502403382&w=1e-22&n=93600&p=twilight_shifted&panel=deep", 6],
];

const p = await new Page({ debug: 9503, port: SITE }).start();
for (const [name, query, want] of FRAMES) {
  const answered = await p.open(`?${query}`, { settle: 1500 });
  await p.settled(400);
  const before = await p.ev(`document.getElementById('deep-minibrots')?.disabled ?? null`);
  await p.ev(`document.getElementById('deep-minibrots').click()`);
  // The search settles a cap, walks the domains, solves and then draws tiles one at a
  // time; the list is filled before the tiles are, so the note is what to wait for.
  let found = null;
  for (let i = 0; i < 600; i++) {
    await sleep(500);
    const said = await p.ev(`(() => {
      const note = document.getElementById('deep-minibrot-note');
      const list = document.getElementById('deep-minibrot-list');
      return {
        note: note && !note.hidden ? note.textContent.trim() : null,
        entries: list ? list.querySelectorAll('.minibrot').length : 0,
        stat: document.getElementById('stats')?.textContent?.trim() ?? "",
      };
    })()`);
    if (said?.note) {
      found = said;
      break;
    }
  }
  say(
    `${name} answered=${answered} button-disabled=${before} -> ` +
      (found === null ? "NOTHING in 5 min" : `${found.entries} entries · ${found.note.slice(0, 90)}`) +
      `  (the crate's table says ${want})`,
  );
  const said = p.drain();
  if (said.length > 0) say("  console:", said.slice(0, 3));
}
await p.stop();
