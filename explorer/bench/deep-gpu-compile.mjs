// What the Deep tab's GPU kernels cost to compile, kernel by kernel and entry point by entry
// point, cold and again after a navigation on the same profile *(deep_holes_ckpt163)*.
//
//   node explorer/bench/deep-gpu-compile.mjs [--port=8000] [--form=<guard form>]
//        [--kernels=d6M,d6Mi,...] [--rounds=2] [--parallel] [--source=<module path>]
//
// One headless Chrome on a throwaway profile. Each round navigates to the site's front page
// (an article page: no script of its own runs) and, in it, imports `kernelSource` from the
// module `--source` names (default `deep-gpu-wgsl.js`), asks for a device, and for each
// kernel creates the module and then each entry point's pipeline in turn, timing each. A
// kernel is `d<degree><M|J>[i]`: the parameter plane or a Julia set, with `i` for the
// interior proof compiled in. Round 1 is a first visit; every later round is the same
// browser after a navigation, which is what a reader's next page load finds in the GPU
// process's caches and on disk. `--parallel` asks for a kernel's five pipelines at once,
// as the page does, instead of one after another.
//
// `python -m builder serve` must be up. Nothing else heavy should run: it is a timing. No
// part of `builder check` or CI.

import { open, sleep } from "./cdp.mjs";
import { record } from "./output.mjs";

const option = (name) => process.argv.find((arg) => arg.startsWith(`--${name}=`))?.split("=")[1];
const PORT = option("port") ?? process.env.PORT ?? "8000";
const FORM = option("form") ?? "plain";
const ROUNDS = Number(option("rounds") ?? 2);
const PARALLEL = process.argv.includes("--parallel");
const SOURCE = option("source") ?? "deep-gpu-wgsl.js";
const ALL = [];
for (const julia of [false, true])
  for (let degree = 2; degree <= 6; degree++)
    for (const interior of [true, false]) ALL.push(`d${degree}${julia ? "J" : "M"}${interior ? "i" : ""}`);
const KERNELS = option("kernels")?.split(",") ?? ALL;

const ROUND = (kernels) => `(async () => {
  const W = await import("/explorer/${SOURCE}");
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
  if (!adapter) return { error: "no adapter" };
  const device = await adapter.requestDevice();
  // The fallback is a --source copy of the module from before c76f8adb, which had two pass
  // entries and no list of them: kept so that old-against-new compile timing still runs.
  const entries = W.KERNEL_ENTRY_POINTS ?? ["init", "pass_all", "pass_list", "compact", "emit"];
  const rows = [];
  for (const name of ${JSON.stringify(kernels)}) {
    const [, degree, plane, interior] = name.match(/^d(\\d)([MJ])(i?)$/);
    const code = W.kernelSource({ degree: Number(degree), julia: plane === "J", interior: interior === "i", form: ${JSON.stringify(FORM)}, workgroup: 64, smooth: "builtin" });
    const started = performance.now();
    const module = device.createShaderModule({ code });
    const info = await module.getCompilationInfo();
    const errors = info.messages.filter((m) => m.type === "error").map((m) => m.message);
    const moduleMs = performance.now() - started;
    const each = {};
    const make = async (entryPoint) => {
      const t = performance.now();
      try {
        await device.createComputePipelineAsync({ layout: "auto", compute: { module, entryPoint } });
        each[entryPoint] = Math.round(performance.now() - t);
      } catch (error) {
        each[entryPoint] = String(error?.message ?? error).slice(0, 120);
      }
    };
    if (${PARALLEL}) await Promise.all(entries.map(make));
    else for (const entry of entries) await make(entry);
    rows.push({ name, bytes: code.length, moduleMs: Math.round(moduleMs), ms: Math.round(performance.now() - started), each, errors });
  }
  device.destroy();
  return { adapter: [adapter.info?.vendor, adapter.info?.architecture].join(" "), rows };
})()`;

const page = await open({ port: 9600 + Math.floor(Math.random() * 300), width: 800, height: 600 });
const out = { form: FORM, parallel: PARALLEL, source: SOURCE, started: new Date().toISOString(), rounds: [] };
try {
  for (let round = 1; round <= ROUNDS; round++) {
    await page.send("Page.navigate", { url: `http://localhost:${PORT}/index.html?round=${round}` });
    await page.until("document.readyState === 'complete'", { within: 30000 });
    await sleep(500);
    const result = await page.evaluate(ROUND(KERNELS));
    if (result?.error) throw new Error(result.error);
    out.adapter = result.adapter;
    out.rounds.push(result.rows);
    let total = 0;
    for (const row of result.rows) {
      total += row.ms;
      const each = Object.entries(row.each).map(([k, v]) => `${k} ${v}`).join(", ");
      console.log(`round ${round} ${row.name}: ${row.ms} ms (module ${row.moduleMs}; ${each})${row.errors.length ? ` ERRORS ${row.errors.join("; ")}` : ""}`);
    }
    console.log(`round ${round}: ${KERNELS.length} kernels, ${total} ms`);
    record("deep-gpu-compile.json", out);
  }
} finally {
  await page.close();
}
