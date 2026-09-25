// Typeset display formulas: TeX in, one inline SVG and one spoken reading out, per formula.
//
// `builder/formulas.py` is the caller and says why this exists; this is only the part that has
// to be JavaScript, because MathJax is. It reads a JSON list of TeX strings on stdin and
// writes a JSON list of `{svg, speech}` on stdout, in the same order.
//
// The MathJax it loads is the pinned copy `formulas.py` fetched into ignored `artifacts/`, named
// by the one argument: the `node_modules` directory that copy was unpacked into. Nothing is
// installed and nothing here is part of any page's runtime — the SVG is written into the
// page and the page carries no script.
//
// Two things about how it is loaded, both measured on Windows rather than supposed:
// MathJax's own component loader resolves its files with `import()` of a bare `C:\...`
// path, which Node's ESM loader refuses, so it is handed a CommonJS `require` instead; and
// the speech engine keeps a worker alive after the last formula, so the process is ended
// explicitly once stdout has drained.

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

const modules = process.argv[2];
if (!modules) {
  process.stderr.write("usage: node formulas.mjs <node_modules directory>\n");
  process.exit(2);
}

const require = createRequire(join(modules, "noop.js"));
const MathJax = require("mathjax/node-main.cjs");

await MathJax.init({
  loader: {
    require,
    paths: { mathjax: "mathjax" },
    load: ["input/tex", "output/svg", "adaptors/liteDOM", "a11y/speech"],
  },
  // Every glyph drawn as its own path, with no shared <defs> and so no ids: two formulas on
  // one page cannot collide, and one formula is self-contained wherever it is pasted.
  output: { fontCache: "none" },
});

const adaptor = MathJax.startup.adaptor;
const texs = JSON.parse(readFileSync(0, "utf-8"));
const out = [];
for (const tex of texs) {
  const node = await MathJax.tex2svgPromise(tex, { display: true });
  const html = adaptor.outerHTML(node);
  const speech = html.match(/data-semantic-speech-none="([^"]*)"/);
  if (!speech) {
    throw new Error(`no spoken reading for ${tex}`);
  }
  const svg = html.match(/<svg[\s\S]*<\/svg>/);
  if (!svg) {
    throw new Error(`no svg for ${tex}`);
  }
  out.push({ svg: svg[0], speech: speech[1] });
}
process.stdout.write(JSON.stringify(out), () => process.exit(0));
