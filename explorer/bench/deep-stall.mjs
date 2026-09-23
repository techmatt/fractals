// The Deep tab's recolour, held to landing *(deep_stall_ckpt143)*.
//
// Matt's symptom: the Deep tab stopped recolouring — a phase, a palette, a cycles change
// did nothing to the picture — while the rest of the page kept working. Two causes, both in
// `deep.js`: a tint made while a pass ran was deferred to the pass's next stage, which on a
// deep frame is minutes away; and a recolour was keyed on `view`, which after a Cancel past
// the cap probe, or a gesture with Auto-render off, is a frame with no field, so it found
// nothing and did nothing, every time. `deep.js`'s rule 5 is the fix.
//
// This drives the served page over CDP through the sequences that broke it — tints singly
// and in bursts; during a pass, just after one and during one that started on its own;
// Cancel, undo and zoom around them — and after each asks one question: **does a fresh
// phase change reach the canvas, with the tab idle, within seconds?** `cancelAfterProbe`,
// `autoOffGesture` and `tintInPass` are the reproductions; all three failed on the code
// before the fix.
//
//   node explorer/bench/deep-stall.mjs [scenario ...]      # all of them by default
//   PORT=8014 FRAME='?dv=3&...' node explorer/bench/deep-stall.mjs
//
// `python -m builder serve` must be up. The default frame is `tangle 1e-22`, whose full
// pass is about 40 s on a twelve-thread desktop: a frame that draws in a second never
// leaves a pass running long enough to tint into, and is how this stayed hidden.
//
// **Unlike the rest of `bench/`, this one asserts**: a recolour that does not land is
// `STUCK` and the exit is non-zero. It is still no part of `builder check` — it needs a
// browser and minutes — and it is what to run after touching the tab's pass, cancel or
// recolour code.

import { open, sleep } from "./cdp.mjs";

const BASE = `http://localhost:${process.env.PORT ?? "8000"}/explorer/`;
const FRAME =
  process.env.FRAME ??
  "?dv=3&x=-0.745017728290198619298817365858&y=0.149934432756897045833502403382&w=1e-22&panel=deep";

const STATE = `(() => {
  const q = (id) => document.getElementById(id);
  const c = q("canvas");
  const g = c.getContext("2d");
  const d = g.getImageData(0, 0, c.width, c.height).data;
  let h = 2166136261;
  for (let i = 0; i < d.length; i += 97) { h ^= d[i]; h = Math.imul(h, 16777619) >>> 0; }
  return {
    hash: h,
    button: q("deep-render").textContent,
    bar: q("deep-bar").dataset.state ?? null,
    progress: q("deep-progress").hidden ? null : q("deep-progress").textContent,
    stats: q("deep-stats").textContent,
    note: q("deep-note").textContent,
    phase: q("shade-phase").value,
    url: location.search,
  };
})()`;

const setBox = (id, value) => `(() => {
  const b = document.getElementById(${JSON.stringify(id)});
  b.value = ${JSON.stringify(String(value))};
  b.dispatchEvent(new Event("change"));
  return true;
})()`;

const clickPalette = (index) => `(() => {
  const items = [...document.querySelectorAll("#palette-list [role=option], #palette-list button")];
  const it = items[${index} % items.length];
  it.click();
  return it.textContent || it.getAttribute("aria-label") || String(items.length);
})()`;

const click = (id) => `(() => { document.getElementById(${JSON.stringify(id)}).click(); return true; })()`;

const wheel = (dy) => `(() => {
  const c = document.getElementById("canvas");
  const r = c.getBoundingClientRect();
  c.dispatchEvent(new WheelEvent("wheel", { deltaY: ${dy}, clientX: r.left + r.width * 0.55, clientY: r.top + r.height * 0.45, bubbles: true, cancelable: true }));
  return true;
})()`;

const undo = `(() => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true })); return true; })()`;

/** The tab at rest. Waits out `SETTLE_MS` first: a control that moves the frame arms the
 *  settle timer, and a tab that looks idle inside those 350 ms is about to start a pass. */
async function idle(page, within = 120000) {
  await sleep(450);
  return page.until(`document.getElementById("deep-progress").hidden`, { within, every: 50 });
}

/** A recolour lands: after a phase change to a fresh value, the canvas changes and the page
 *  goes idle within `within` ms. */
async function recolourLands(page, value, within = 15000) {
  const before = await page.evaluate(STATE);
  await page.evaluate(setBox("shade-phase", value));
  const deadline = Date.now() + within;
  for (;;) {
    const now = await page.evaluate(STATE);
    if (now.progress === null && now.hash !== before.hash) return { ok: true, now };
    if (Date.now() > deadline) return { ok: false, before, now };
    await sleep(50);
  }
}

let phaseCounter = 0;
const freshPhase = () => (0.05 + ((phaseCounter++ * 0.137) % 0.9)).toFixed(3);

const SCENARIOS = {
  // Render (which probes the cap), Cancel once the full stage is running, then tint.
  async probeCancel(page) {
    await page.evaluate(setBox("deep-cap", "2000"));
    await sleep(100);
    await page.evaluate(click("deep-cap-policy"));
    await idle(page);
    await page.evaluate(click("deep-render"));
    const inFull = await page.until(
      `(document.getElementById("deep-progress").textContent || "").startsWith("full resolution")`,
      { within: 60000, every: 10 },
    );
    await page.evaluate(click("deep-render")); // Cancel
    const s = await page.evaluate(STATE);
    const r = await recolourLands(page, freshPhase(), 8000);
    return { ...r, inFull, afterCancel: s };
  },
  // Cancel after the probe has moved the cap and before anything at the new cap has landed:
  // `view` is then a frame with no field.
  async cancelAfterProbe(page) {
    await page.evaluate(click("deep-cap-policy"));
    await idle(page);
    await page.evaluate(click("deep-render"));
    const past = await page.until(
      `(() => { const t = document.getElementById("deep-progress").textContent || "";
        return !document.getElementById("deep-progress").hidden && !t.startsWith("choosing") && !t.startsWith("starting"); })()`,
      { within: 60000, every: 5 },
    );
    await page.evaluate(click("deep-render")); // Cancel
    const after = await page.evaluate(STATE);
    const r = await recolourLands(page, freshPhase(), 8000);
    return { ...r, past, after };
  },
  // Auto-render off, a gesture, then a tint: the picture up is the old frame, and it
  // should still take the colour.
  async autoOffGesture(page) {
    await page.evaluate(`(() => { const b = document.getElementById("deep-auto"); if (b.checked) b.click(); return true; })()`);
    await page.evaluate(wheel(-100));
    await sleep(500);
    await idle(page);
    const r = await recolourLands(page, freshPhase(), 8000);
    await page.evaluate(`(() => { const b = document.getElementById("deep-auto"); if (!b.checked) b.click(); return true; })()`);
    await page.evaluate(click("deep-render"));
    await idle(page);
    return r;
  },
  // A tint during a long field stage: the picture up should take the colour at once.
  async tintInPass(page) {
    await page.evaluate(click("deep-render"));
    await page.until(
      `(document.getElementById("deep-progress").textContent || "").startsWith("full resolution")`,
      { within: 60000, every: 10 },
    );
    const before = await page.evaluate(STATE);
    await page.evaluate(setBox("shade-phase", freshPhase()));
    await sleep(600);
    const now = await page.evaluate(STATE);
    const running = now.progress !== null;
    await idle(page);
    return { ok: !running || now.hash !== before.hash, running, before, now };
  },
  async single(page) {
    for (let i = 0; i < 5; i++) {
      const r = await recolourLands(page, freshPhase());
      if (!r.ok) return r;
    }
    return { ok: true };
  },
  async burst(page) {
    for (let i = 0; i < 25; i++) {
      await page.evaluate(setBox("shade-phase", freshPhase()));
    }
    for (let i = 0; i < 10; i++) await page.evaluate(clickPalette(i * 7));
    for (let i = 0; i < 6; i++) await page.evaluate(setBox("shade-cycles", String(1 + (i % 4))));
    await idle(page, 30000);
    return recolourLands(page, freshPhase());
  },
  async duringPass(page) {
    // Render again, then recolour while it runs, and again as it lands.
    await page.evaluate(click("deep-render"));
    await sleep(300);
    for (let i = 0; i < 8; i++) {
      await page.evaluate(setBox("shade-phase", freshPhase()));
      await sleep(120);
    }
    await idle(page);
    return recolourLands(page, freshPhase());
  },
  async duringAuto(page) {
    await page.evaluate(wheel(-100));
    await sleep(500); // past SETTLE_MS: the auto pass starts
    for (let i = 0; i < 8; i++) {
      await page.evaluate(setBox("shade-phase", freshPhase()));
      await page.evaluate(clickPalette(3 + i));
      await sleep(90);
    }
    await idle(page);
    return recolourLands(page, freshPhase());
  },
  async justAfter(page) {
    await page.evaluate(wheel(100));
    await sleep(400);
    // Poll for the pass to land, and tint in the same tick it does.
    await page.until(`document.getElementById("deep-progress").hidden`, { within: 120000, every: 5 });
    for (let i = 0; i < 4; i++) await page.evaluate(setBox("shade-phase", freshPhase()));
    await idle(page);
    return recolourLands(page, freshPhase());
  },
  async cancelUndo(page) {
    await page.evaluate(wheel(-100));
    await sleep(500);
    await page.evaluate(setBox("shade-phase", freshPhase()));
    await page.evaluate(click("deep-render")); // Cancel / revert
    await page.evaluate(setBox("shade-phase", freshPhase()));
    await page.evaluate(undo);
    await page.evaluate(undo);
    await sleep(100);
    await page.evaluate(setBox("shade-phase", freshPhase()));
    await idle(page);
    return recolourLands(page, freshPhase());
  },
  async zoomTint(page) {
    for (let i = 0; i < 6; i++) {
      await page.evaluate(wheel(i % 2 ? 100 : -100));
      await sleep(150 + 60 * i);
      await page.evaluate(setBox("shade-phase", freshPhase()));
      await page.evaluate(clickPalette(i * 5));
    }
    await idle(page);
    return recolourLands(page, freshPhase());
  },
};

const wanted = process.argv.slice(2);
const names = wanted.length ? wanted : Object.keys(SCENARIOS);
const rounds = Number(process.env.ROUNDS ?? 1);

const page = await open({ width: 1600, height: 1000 });
const logs = [];
page.on((m) => {
  if (m.method === "Runtime.consoleAPICalled") {
    logs.push(m.params.args.map((a) => a.value ?? a.description ?? "").join(" "));
  } else if (m.method === "Runtime.exceptionThrown") {
    logs.push(`EXCEPTION ${m.params.exceptionDetails?.exception?.description ?? m.params.exceptionDetails?.text}`);
  }
});
try {
  await page.send("Page.navigate", { url: BASE + FRAME });
  await sleep(1500);
  if (process.env.LOG) await page.evaluate(`localStorage.setItem("explorer.deep-log", "1")`);
  const up = await page.until(`!!document.getElementById("deep-stats")?.textContent`, { within: 120000 });
  await idle(page);
  console.log("first frame", up, await page.evaluate(STATE));
  let failures = 0;
  for (let round = 0; round < rounds; round++) {
    for (const name of names) {
      const t = Date.now();
      let r;
      try {
        r = await SCENARIOS[name](page);
      } catch (error) {
        r = { ok: false, error: String(error) };
      }
      console.log(`${r.ok ? "ok  " : "STUCK"} ${name} (${Date.now() - t} ms)`, r.ok ? "" : JSON.stringify(r));
      if (!r.ok) {
        failures++;
        console.log(logs.slice(-40).join("\n"));
        if (process.env.STOP) break;
      }
    }
  }
  console.log(`failures: ${failures}`);
  const exceptions = logs.filter((l) => l.startsWith("EXCEPTION") || /error/i.test(l));
  if (exceptions.length) console.log("errors seen:\n" + exceptions.slice(0, 20).join("\n"));
  // A pass that died is a stall of its own: the tab stops drawing and says why. Counted,
  // because a scenario can still pass around one — the recolour lands on the old picture.
  const died = logs.filter((l) => l.startsWith("the deep render failed")).length;
  if (died > 0) console.log(`passes that failed: ${died}`);
  process.exitCode = failures > 0 || died > 0 ? 1 : 0;
} finally {
  await page.close();
}
