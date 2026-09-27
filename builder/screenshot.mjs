// Photograph one element of a served page, over CDP (deep_zoom_v4_place_ckpt154).
//
//   node builder/screenshot.mjs <json job>
//
// The job is `{url, selector, out, width, height, scale, clicks}`: open `url` in a headless
// Chrome on a throwaway profile, wait until the explorer is up and at rest, click each of
// `clicks` in order (a selector each, pressed through the page so its own handlers run),
// wait for rest again, and write the PNG of
// `selector`'s box, `scale` device pixels to a CSS pixel, to `out`. `builder/screenshots.py`
// is the only caller and serves the tree it points at.
//
// **Never Chrome's `--screenshot`.** It shoots at load and never waits for the wasm module
// or the workers, so every shot of the explorer is *Starting the renderer…*
// (`explorer/README.md`). The client is `explorer/bench/cdp.mjs`'s, the bench's own: one
// CDP client for a page that works, which is what a figure photographs.
import { writeFileSync } from "node:fs";
import { open, sleep } from "../explorer/bench/cdp.mjs";

const job = JSON.parse(process.argv[2]);

/** The studio is up and no pass is running: the boot notice gone, the Deep tab's progress
 *  line hidden. Held twice across the settle timer, since a control that moves the frame
 *  arms it and a tab idle inside those 350 ms is about to start a pass. */
const REST = `(() => {
  const studio = document.querySelector(".studio");
  const notice = document.getElementById("notice");
  const progress = document.getElementById("deep-progress");
  return !!studio && !studio.hidden && (!notice || notice.hidden)
    && (!progress || progress.hidden);
})()`;

const page = await open({ port: job.debug ?? 9431, width: job.width, height: job.height });
try {
  await page.send("Emulation.setDeviceMetricsOverride", {
    width: job.width,
    height: job.height,
    deviceScaleFactor: job.scale,
    mobile: false,
  });
  await page.send("Page.navigate", { url: job.url });
  for (let settled = 0; settled < 2; settled++) {
    await sleep(450);
    if (!(await page.until(REST, { within: 120000, every: 50 }))) {
      throw new Error(`${job.url} did not come to rest within two minutes`);
    }
  }
  for (const selector of job.clicks ?? []) {
    const clicked = await page.evaluate(`(() => {
      const it = document.querySelector(${JSON.stringify(selector)});
      if (!it) return false;
      it.click();
      return true;
    })()`);
    if (!clicked) throw new Error(`${selector} is not on ${job.url}, so it cannot be clicked`);
    await sleep(450);
    if (!(await page.until(REST, { within: 120000, every: 50 }))) {
      throw new Error(`${job.url} did not come to rest after clicking ${selector}`);
    }
  }
  const box = await page.evaluate(`(() => {
    const it = document.querySelector(${JSON.stringify(job.selector)});
    if (!it) return null;
    it.scrollIntoView({ block: "center" });
    const r = it.getBoundingClientRect();
    return { x: r.left + scrollX, y: r.top + scrollY, width: r.width, height: r.height };
  })()`);
  if (box === null || box.width === 0 || box.height === 0) {
    throw new Error(`${job.selector} is not on ${job.url}, or has no box`);
  }
  await sleep(200);
  const shot = await page.send("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: true,
    clip: { ...box, scale: 1 },
  });
  writeFileSync(job.out, Buffer.from(shot.data, "base64"));
  console.log(JSON.stringify({ out: job.out, css: box }));
} finally {
  await page.close();
}
