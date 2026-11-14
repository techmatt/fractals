// The native picture each offered Example button draws, from the sibling's own `style render`,
// for `custom-compare.py` to hold the page's and Node's pictures against.
//
//   node explorer/bench/custom-natives.mjs <out dir> [--size 640x400] [--only <id>,…]
//
// Each button is drawn at its keep's place, on the palette and with the knobs it opens with
// (`offeredExamples`), the published stack: `<id>.native.png` beside its `<id>.location.json`.
// For a button whose keep the published settings reach this is the keep's own picture, which
// `style wasm-parity` also draws; for one no setting reproduces it is the published look,
// docs/custom-modes.md step 9. `wasm-parity` draws its natives only after its whole wasm
// half (about an hour for 69 keeps on a busy box, 008); this draws only the natives, one
// process at a time, in about 20 s each. An Example whose picture is already in the out dir
// is skipped, so a run picks up where one stopped. An Example whose button opens with Auto
// tone off (`autotone=0`) has no `style render` flag for it, and is named and skipped.
//
// Needs the sibling checkout beside this one, with its `.venv`.

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { encode } from "../permalink.js";
import { offeredExamples, palettesOf } from "../style.js";

const args = process.argv.slice(2);
const out = resolve(args[0]);
const option = (name, fallback) => {
  const at = args.indexOf(name);
  return at === -1 ? fallback : args[at + 1];
};
const [width, height] = option("--size", "640x400").split("x").map(Number);
const only = option("--only", null)?.split(",") ?? null;
mkdirSync(out, { recursive: true });

const sibling = fileURLToPath(new URL("../../../fractal-wallpapers/", import.meta.url));
const cli = process.platform === "win32" ? join(sibling, ".venv", "Scripts", "fractal-wallpapers.exe") : join(sibling, ".venv", "bin", "fractal-wallpapers");
if (!existsSync(cli)) throw new Error(`no sibling CLI at ${cli}`);
const bundle = JSON.parse(readFileSync(fileURLToPath(new URL("../custom-modes.json", import.meta.url)), "utf8"));

for (const mode of bundle.modes) {
  for (const { index, shown, custom } of offeredExamples(mode, encode)) {
    const id = `${mode.style}__${index}`;
    if (only && !only.includes(id)) continue;
    const target = join(out, `${id}.native.png`);
    if (existsSync(target)) continue;
    if (custom.autotone === false) {
      console.log(`${id}  skipped: opens with Auto tone off, which style render cannot draw`);
      continue;
    }
    const location = join(out, `${id}.location.json`);
    writeFileSync(location, JSON.stringify(shown.location));
    const palette = custom.palette ?? palettesOf(mode)[0].colormap;
    const command = ["style", "render", mode.style, "--location", location, "--colormap", palette];
    command.push("--resolution", String(width), String(height), "--supersample", "2", "--out", target);
    for (const [name, value] of Object.entries(custom.knobs)) command.push("--knob", `${name}=${value}`);
    const started = Date.now();
    const done = spawnSync(cli, command, { cwd: sibling, encoding: "utf8" });
    const seconds = ((Date.now() - started) / 1000).toFixed(1);
    const said = done.status === 0 ? "ok" : `FAILED ${done.stderr.trim().split("\n").at(-1)}`;
    console.log(`${id}  ${palette}  ${JSON.stringify(custom.knobs)}  ${seconds} s  ${said}`);
  }
}
