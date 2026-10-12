// Writes the Deep tab's GPU self-test bundle, out of the model it is held to.
//
//   node explorer/deep-gpu-selftest/export.mjs
//
// Builds `explorer/deep-gpu-model`'s `export` and runs it three times into this directory:
// the primitive vectors (`vectors.json`: `ds::self_test_vectors`'s 31 cases and the three
// primitives they leave out, derived from their inputs), and two slim frame bundles
// (`<id>.manifest.json` and `<id>.bin`: the `Frame` and `FrameLo` uniforms, the `HiLo`
// orbit, and every pixel's whole double-single state with its proof, as the model leaves
// it after one unbounded pass). Then `selftest.json`, which says what a page runs and how.
//
// Every frame is exported with `--ftz-check on` and refused here unless flushing
// subnormals moves no pixel's state and no `frac`: a frame that provokes a flush would
// fail on a GPU that flushes (D3D12 does) for a reason that is not a defect, and turn the
// GPU off there. Every bundle is also re-run from its written bytes, all pixels, before
// it is kept.
//
// The rows are `frames.jsonl` beside this file; `export --help` has the flags. It takes no
// arguments of its own and refuses any, because what it does is rewrite this directory.
// **A rerun is byte for byte**: the one thing `export` writes that a rerun would move is
// each manifest's `wall_s`, a timing, and it is taken out of the kept manifests here.

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const crate = join(here, "..", "deep-gpu-model");
const exe = join(crate, "target", "release", process.platform === "win32" ? "export.exe" : "export");
const rel = (p) => relative(crate, p).replaceAll("\\", "/");

/** Each frame, its sample grid, and the policy a gated sample it cannot prove takes. */
const FRAMES = [
  // Escapes, proved interior, capped, and gated under `flag`; a periodic reference, a
  // stored zero at every return (flush 139), the scaled regime throughout, degree 3.
  { id: "selftest-d3-nucleus-edge", res: "32x18", policy: "flag" },
  // A Julia plane's start (`init` from dc, the entry), degree 2, every sample proved.
  { id: "selftest-d2-julia-rabbit", res: "16x9", policy: "cap" },
  // The skip table *(gpu_deep_depth_ckpt163)*: each run by the model with the table at
  // `EPSILON_DS_DEFAULT`, which the bundle carries as the page binds it, with the `f64`
  // orbit it was built from so that `deep-gpu.test.mjs` holds the page's own build to it.
  // Escapes on both planes, and the proof armed and carrying beside the skip.
  { id: "selftest-d2-skip", res: "16x9", policy: "flag", bla: true },
  { id: "selftest-d2-julia-skip", res: "16x9", policy: "flag", bla: true },
  { id: "selftest-d2-seahorse-skip", res: "16x9", policy: "flag", bla: true },
  // The exact points: a minibrot interior whose reference flushes at every return, proved
  // only where `Z` is read at its true size in the delta's units, under the page's policy.
  { id: "selftest-d3-deep-interior", res: "16x9", policy: "handoff" },
];

/** Budgets a self-test runs every frame at: the first pass, then every later one. */
const BUDGETS = [[37, 37], [1, 4096]];

function run(args) {
  const line = `export ${args.join(" ")}`;
  console.log(line);
  const out = execFileSync(exe, args, { cwd: crate, encoding: "utf8" });
  process.stdout.write(out);
  return line;
}

if (process.argv.length > 2) {
  console.error("usage: node explorer/deep-gpu-selftest/export.mjs\n(no arguments: it rewrites the self-test bundle in place, out of explorer/deep-gpu-model)");
  process.exit(2);
}

execFileSync("cargo", ["build", "--release", "--bin", "export"], { cwd: crate, stdio: "inherit" });
const commands = [run(["--vectors", rel(join(here, "vectors.json")), "--extra-vectors", "on"])];
for (const f of FRAMES) {
  commands.push(
    run([
      "--frames", rel(join(here, "frames.jsonl")),
      "--ids", f.id,
      "--res", f.res,
      "--interior", "on",
      "--interior-policy", f.policy,
      "--slim", "on",
      "--ftz-check", "on",
      ...(f.bla ? ["--bla", "on"] : []),
      "--verify", "100000",
      "--out", rel(here),
    ]),
  );
}

const index = JSON.parse(readFileSync(join(here, "index.json"), "utf8"));
const frames = [];
for (const f of FRAMES) {
  const entry = index.frames.find((e) => e.id === f.id);
  if (entry === undefined) throw new Error(`${f.id}: not in index.json`);
  // The timings out, so that a rerun of an unchanged model rewrites nothing.
  const path = join(here, entry.manifest);
  const text = readFileSync(path, "utf8").replace(/,"wall_s":[-+.\deE]+/g, "");
  writeFileSync(path, text);
  const manifest = JSON.parse(text);
  if (manifest.ftz === null || manifest.ftz.differ !== 0 || manifest.ftz.frac_differ !== 0) {
    throw new Error(`${f.id}: flushing subnormals moves it (${JSON.stringify(manifest.ftz)}); choose another frame`);
  }
  if (f.bla && !(manifest.bla?.valid > 0)) throw new Error(`${f.id}: its skip table has no live run; choose another frame`);
  frames.push({ id: f.id, manifest: entry.manifest, bin: entry.bin, classes: manifest.ds.classes, flush_hilo: manifest.flush_hilo, ...(f.bla ? { bla: manifest.bla } : {}) });
}
const vectors = JSON.parse(readFileSync(join(here, "vectors.json"), "utf8"));
writeFileSync(
  join(here, "selftest.json"),
  JSON.stringify(
    {
      what: "The Deep tab's GPU self-test, written by explorer/deep-gpu-selftest/export.mjs out of explorer/deep-gpu-model. A device passes when every vector comes back bit for bit and every frame, run at each budget schedule, leaves every pixel's state word for word the model's, frac alone excepted.",
      vectors: { file: "vectors.json", cases: vectors.cases.length },
      budgets: BUDGETS,
      frames,
      commands: [`cargo build --release --bin export (in explorer/deep-gpu-model)`, ...commands],
    },
    null,
    1,
  ) + "\n",
);
console.log(`selftest.json: ${vectors.cases.length} vectors, ${frames.length} frames`);
