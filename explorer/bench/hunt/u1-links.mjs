// U1 — every kind of link, round-tripped, then fuzzed.
//
// The parsers are already held by `permalink.test.mjs` (51) and `deep-link.test.mjs` (27).
// The subject here is the **page**: that a refusal the parser returns actually reaches the
// notice and stops the dot, and that a link the page accepts draws a picture the link
// describes — checked by reopening what the address bar settled to and comparing rasters.
//
// usage: node explorer/bench/hunt/u1-links.mjs [shard] [of] [debugPort]
import { readFileSync } from "node:fs";
import { record } from "../output.mjs";
import { Page, say } from "./lib.mjs";
import { FAMILIES, MODES } from "../../permalink.js";

const shard = Number(process.argv[2] ?? 0);
const of = Number(process.argv[3] ?? 1);
const debug = Number(process.argv[4] ?? 9410);

const SHALLOW = "v=3&f=mandelbrot&x=-0.5&y=0&w=3&p=twilight_shifted";
const DEEP =
  "dv=2&x=-0.74501772828532335842941892835857434&y=0.14993443275456819177805709088257971" +
  "&w=2e-11&n=48551&p=twilight_shifted&panel=deep";

/** Every link the site itself publishes, which is the valid pool with real provenance. */
const registry = readFileSync(new URL("../../links.jsonl", import.meta.url), "utf8")
  .split("\n")
  .filter(Boolean)
  .map((l) => JSON.parse(l))
  .filter((r) => r.link)
  .map((r) => ({ name: `registry:${r.id}`, q: r.link, expect: "draws" }));

/** A family crossed with a mode of each coloring shape, and both palette kinds. */
const crossed = [];
for (const f of FAMILIES) {
  const c = f.startsWith("julia") ? "&cx=-0.4&cy=0.6" : f === "phoenix" ? "&cx=0.5667&cy=0&px=-0.5&py=0&zx=0&zy=0" : "";
  for (const m of ["smooth", "stripe", "direct_trap_ring", "itinerary"]) {
    crossed.push({ name: `cross:${f}:${m}`, q: `v=3&f=${f}${c}&m=${m}&p=twilight_shifted`, expect: "draws" });
  }
}

const LONG = "0.1234567890123456789012345678901234567890123456789012345678901234567890";

/** The fuzz. `expect` is what a reader should get, and a case that gets the other one is
 *  reported rather than assumed wrong — some of these are legitimately accepted. */
const fuzz = [
  // the version
  ["v=0", `${SHALLOW.replace("v=3", "v=0")}`, "refused"],
  ["v=4", `${SHALLOW.replace("v=3", "v=4")}`, "refused"],
  ["v empty", `${SHALLOW.replace("v=3", "v=")}`, "refused"],
  ["v=3.0", `${SHALLOW.replace("v=3", "v=3.0")}`, "refused"],
  ["v missing", SHALLOW.replace("v=3&", ""), "refused"],
  ["v twice", `v=3&${SHALLOW}`, "refused"],
  ["v=1 bare", "v=1", "draws"],
  ["v=2 bare", "v=2", "draws"],
  // the family
  ["unknown family", `${SHALLOW.replace("mandelbrot", "nosuch")}`, "refused"],
  ["render-only family", `${SHALLOW.replace("mandelbrot", "fractional_multibrot")}`, "refused"],
  ["family in caps", `${SHALLOW.replace("mandelbrot", "MANDELBROT")}`, "refused"],
  ["family empty", `${SHALLOW.replace("f=mandelbrot", "f=")}`, "refused"],
  ["family with space", `${SHALLOW.replace("mandelbrot", "mandelbrot%20")}`, "refused"],
  ["family twice", `${SHALLOW}&f=julia`, "refused"],
  // the mode
  ["niche mode de", `${SHALLOW}&m=de`, "refused"],
  ["unknown mode", `${SHALLOW}&m=nosuch`, "refused"],
  ["demoted mode", `${SHALLOW}&m=tail_itinerary`, "refused"],
  ["mode empty", `${SHALLOW}&m=`, "refused"],
  // a mode's parameters
  ["param on paramless mode", `${SHALLOW}&m=smooth&density=6`, "refused"],
  ["wrong param for mode", `${SHALLOW}&m=stripe&radius=1`, "refused"],
  ["param not a number", `${SHALLOW}&m=stripe&density=abc`, "refused"],
  ["param NaN", `${SHALLOW}&m=stripe&density=NaN`, "refused"],
  ["param negative", `${SHALLOW}&m=stripe&density=-1`, "refused"],
  ["param overflow", `${SHALLOW}&m=stripe&density=1e400`, "refused"],
  ["param twice", `${SHALLOW}&m=stripe&density=6&density=7`, "refused"],
  ["weight at 1", `${SHALLOW}&m=smooth_stripe&weight=1`, "draws"],
  ["weight past 1", `${SHALLOW}&m=smooth_stripe&weight=1.5`, "refused"],
  ["screen clamp is invisible", `${SHALLOW}&m=direct_trap_screen&opacity=0.9&threshold=0.9`, "draws"],
  // the frame
  ["x not a number", `${SHALLOW.replace("x=-0.5", "x=abc")}`, "refused"],
  ["x NaN", `${SHALLOW.replace("x=-0.5", "x=NaN")}`, "refused"],
  ["x Infinity", `${SHALLOW.replace("x=-0.5", "x=Infinity")}`, "refused"],
  ["x overflow", `${SHALLOW.replace("x=-0.5", "x=1e400")}`, "refused"],
  ["x empty", `${SHALLOW.replace("x=-0.5", "x=")}`, "refused"],
  ["x past 64 chars", `${SHALLOW.replace("x=-0.5", `x=${LONG}`)}`, "refused"],
  ["x twice", `${SHALLOW}&x=0.1`, "refused"],
  ["x without y", `v=3&f=mandelbrot&x=-0.5&w=3&p=twilight_shifted`, "refused"],
  ["w zero", `${SHALLOW.replace("w=3", "w=0")}`, "refused"],
  ["w negative", `${SHALLOW.replace("w=3", "w=-1")}`, "refused"],
  ["w not a number", `${SHALLOW.replace("w=3", "w=abc")}`, "refused"],
  ["w underflow", `${SHALLOW.replace("w=3", "w=1e-400")}`, "refused"],
  ["w overflow", `${SHALLOW.replace("w=3", "w=1e400")}`, "refused"],
  ["w past the f64 wall", `${SHALLOW.replace("w=3", "w=1e-17")}`, "either"],
  ["raw + exponent", `${SHALLOW.replace("w=3", "w=1e+1")}`, "either"],
  ["encoded + exponent", `${SHALLOW.replace("w=3", "w=1e%2B1")}`, "draws"],
  // the aspect
  ["aspect valid", `${SHALLOW}&a=21:9`, "draws"],
  ["aspect encoded colon", `${SHALLOW}&a=21%3A9`, "draws"],
  ["aspect 0:1", `${SHALLOW}&a=0:1`, "refused"],
  ["aspect 1:0", `${SHALLOW}&a=1:0`, "refused"],
  ["aspect past 10000", `${SHALLOW}&a=10001:9`, "refused"],
  ["aspect negative", `${SHALLOW}&a=-1:9`, "refused"],
  ["aspect no colon", `${SHALLOW}&a=16`, "refused"],
  ["aspect three parts", `${SHALLOW}&a=16:9:3`, "refused"],
  ["aspect letters", `${SHALLOW}&a=abc:9`, "refused"],
  ["aspect fractional", `${SHALLOW}&a=16:9.5`, "either"],
  ["aspect extreme tall", `${SHALLOW}&a=1:10000`, "draws"],
  ["aspect extreme wide", `${SHALLOW}&a=10000:1`, "draws"],
  // the palette
  ["unknown palette", `${SHALLOW.replace("twilight_shifted", "nosuch")}`, "refused"],
  ["palette empty", `${SHALLOW.replace("p=twilight_shifted", "p=")}`, "refused"],
  ["palette twice", `${SHALLOW}&p=pink`, "refused"],
  ["unoffered palette draws", `${SHALLOW.replace("twilight_shifted", "watercolours-in-the-rain-25")}`, "either"],
  // the shade recipe
  ["gamma zero", `${SHALLOW}&gamma=0`, "refused"],
  ["gamma negative", `${SHALLOW}&gamma=-1`, "refused"],
  ["gamma letters", `${SHALLOW}&gamma=abc`, "refused"],
  ["gamma overflow", `${SHALLOW}&gamma=1e400`, "refused"],
  ["cycles zero", `${SHALLOW}&cycles=0`, "refused"],
  ["cycles negative", `${SHALLOW}&cycles=-1`, "refused"],
  ["cycles huge", `${SHALLOW}&cycles=1000000`, "either"],
  ["phase letters", `${SHALLOW}&phase=abc`, "refused"],
  ["phase huge", `${SHALLOW}&phase=1e9`, "either"],
  ["reverse=2", `${SHALLOW}&reverse=2`, "refused"],
  ["reverse letters", `${SHALLOW}&reverse=abc`, "refused"],
  ["mirror=2", `${SHALLOW}&mirror=2`, "refused"],
  ["mirror on a cyclic map", `${SHALLOW.replace("twilight_shifted", "twilight")}&mirror=1`, "either"],
  ["transfer edge no weight", `${SHALLOW}&transfer=edge`, "refused"],
  ["transfer edge negative", `${SHALLOW}&transfer=edge:-1`, "refused"],
  ["transfer rank with param", `${SHALLOW}&transfer=rank:2`, "refused"],
  ["transfer unknown", `${SHALLOW}&transfer=nosuch`, "refused"],
  ["transfer empty", `${SHALLOW}&transfer=`, "refused"],
  ["rolloff knee missing", `${SHALLOW}&rolloff=soft_knee`, "refused"],
  ["rolloff knee at 1", `${SHALLOW}&rolloff=soft_knee:1`, "refused"],
  ["rolloff knee past 1", `${SHALLOW}&rolloff=soft_knee:1.5`, "refused"],
  ["rolloff reinhard with param", `${SHALLOW}&rolloff=reinhard:1`, "refused"],
  ["rolloff unknown", `${SHALLOW}&rolloff=nosuch`, "refused"],
  ["level letters", `${SHALLOW}&level=abc`, "refused"],
  // the constants
  ["constant on a family without one", `${SHALLOW}&cx=0.1`, "refused"],
  ["julia missing cy", `v=3&f=julia&cx=-0.4&p=twilight_shifted`, "refused"],
  ["julia bare", `v=3&f=julia&p=twilight_shifted`, "either"],
  ["phoenix param on julia", `v=3&f=julia&cx=-0.4&cy=0.6&px=0.1&p=twilight_shifted`, "refused"],
  ["constant letters", `v=3&f=julia&cx=abc&cy=0.6&p=twilight_shifted`, "refused"],
  ["z-1 carried", `v=3&f=julia&cx=-0.4&cy=0.6&zx=0.1&zy=0.1&p=twilight_shifted`, "draws"],
  // the paged tab's marker, which must be refused by name at both doors
  ["iv=1 shallow", `${SHALLOW}&iv=1`, "refused"],
  ["iv=0 shallow", `${SHALLOW}&iv=0`, "refused"],
  ["q shallow", `${SHALLOW}&q=1`, "refused"],
  ["iv=1 deep", `${DEEP}&iv=1`, "refused"],
  ["q deep", `${DEEP}&q=1`, "refused"],
  ["iv alone", "iv=1", "refused"],
  // the two doors
  ["deep keys at the shallow door", `${SHALLOW}&n=1000`, "refused"],
  ["shallow keys at the deep door", `${DEEP}&f=mandelbrot`, "refused"],
  ["deep link with v", `${DEEP}&v=3`, "refused"],
  ["shallow link with dv", `${SHALLOW}&dv=2`, "refused"],
  // deep's own
  ["deep valid", DEEP, "draws"],
  ["deep v1", DEEP.replace("dv=2", "dv=1"), "draws"],
  ["deep dv=3", DEEP.replace("dv=2", "dv=3"), "refused"],
  ["deep dv=0", DEEP.replace("dv=2", "dv=0"), "refused"],
  ["deep n zero", DEEP.replace("n=48551", "n=0"), "refused"],
  ["deep n negative", DEEP.replace("n=48551", "n=-1"), "refused"],
  ["deep n letters", DEEP.replace("n=48551", "n=abc"), "refused"],
  ["deep n past the ceiling", DEEP.replace("n=48551", "n=100000000"), "refused"],
  ["deep n missing", DEEP.replace("&n=48551", ""), "refused"],
  ["deep w zero", DEEP.replace("w=2e-11", "w=0"), "refused"],
  ["deep w negative", DEEP.replace("w=2e-11", "w=-1"), "refused"],
  ["deep x past 64 chars", DEEP.replace(/x=[^&]+/, `x=${LONG}${LONG}`), "refused"],
  ["deep x letters", DEEP.replace(/&x=[^&]+/, "&x=abc"), "refused"],
  ["deep cx without cy", `${DEEP}&cx=-0.4`, "refused"],
  ["deep julia", `${DEEP}&cx=-0.4&cy=0.6`, "draws"],
  ["deep unknown key", `${DEEP}&nosuch=1`, "refused"],
  ["deep key twice", `${DEEP}&n=48551`, "refused"],
  ["deep shallow-width", DEEP.replace("w=2e-11", "w=3"), "either"],
  // shapes rather than keys
  ["empty query", "", "draws"],
  ["a lone question mark", "?", "draws"],
  ["ampersand soup", "&&&&", "either"],
  ["equals only", "=", "either"],
  ["invalid escape", `${SHALLOW}&p=%ZZ`, "refused"],
  ["percent alone", `${SHALLOW}&p=%`, "refused"],
  ["null byte", `${SHALLOW}&p=%00`, "refused"],
  ["two hundred unknown keys", `${SHALLOW}&${Array.from({ length: 200 }, (_, i) => `k${i}=1`).join("&")}`, "refused"],
  ["a 60 KB query", `${SHALLOW}&junk=${"a".repeat(60000)}`, "refused"],
  ["a 60 KB coordinate", `${SHALLOW.replace("x=-0.5", `x=${"1".repeat(60000)}`)}`, "refused"],
  ["fragment only", "#deep", "draws"],
  ["unknown panel", `${SHALLOW}&panel=nosuch`, "either"],
  ["panel deep", `${SHALLOW}&panel=deep`, "draws"],
];

const cases = [
  ...registry,
  ...crossed,
  ...fuzz.map(([name, q, expect]) => ({ name: `fuzz:${name}`, q, expect })),
].filter((_, i) => i % of === shard);

say(`U1 shard ${shard}/${of}: ${cases.length} cases`);

let page = await new Page({ debug }).start();
const findings = [];
const rows = [];

for (const [i, c] of cases.entries()) {
  const query = c.q === "" ? "" : c.q.startsWith("#") || c.q === "?" ? c.q : `?${c.q}`;
  let row = { name: c.name, expect: c.expect, q: c.q.slice(0, 120) };
  try {
    const answered = await page.open(query, { settle: 700 });
    if (answered === "neither") {
      row.got = "HANG";
      findings.push({ ...row, why: "the page answered with neither a picture nor a notice" });
    } else if (answered === "notice") {
      const r = await page.refused();
      row.got = "refused";
      row.said = r.said.slice(0, 100);
      if (!r.studioHidden || r.dot !== "stopped" || !r.said) {
        findings.push({ ...row, why: `refusal is incomplete: ${JSON.stringify(r)}` });
      }
    } else {
      await page.settled(80);
      const s = await page.state();
      const hash = await page.canvasHash();
      row.got = "drew";
      row.url = s.url;
      // The fixed point: reopening what the address bar settled to must land on the same
      // string and the same raster. A link that draws a picture it does not describe is
      // exactly the gap between these two.
      await page.open(`?${s.url}`, { settle: 700 });
      await page.settled(80);
      const again = await page.state();
      const hash2 = await page.canvasHash();
      if (again.url !== s.url) {
        findings.push({ ...row, why: `not a fixed point: ${s.url} -> ${again.url}` });
      } else if (hash && hash2 && hash !== hash2) {
        findings.push({ ...row, why: `same link, different raster: ${hash} vs ${hash2}` });
      }
      // A stopped dot with an empty stat line is what a refusal looks like since
      // `a4cf6cd` — the line is taken back rather than left claiming work — so what
      // makes it a finding is a stopped dot with *nothing said anywhere*.
      if (s.dot === "stopped" && !s.stats && !s.status && !s.noticeUp) {
        findings.push({ ...row, why: "drew nothing and said nothing: dot stopped, no stats, no sentence" });
      }
    }
  } catch (e) {
    row.got = "THREW";
    findings.push({ ...row, why: String(e.message).slice(0, 200) });
    await page.stop();
    page = await new Page({ debug }).start();
  }
  const said = page.drain();
  if (said.length) {
    row.console = said;
    findings.push({ ...row, why: `console: ${said.join(" | ").slice(0, 300)}` });
  }
  if (c.expect !== "either" && row.got !== "HANG" && row.got !== "THREW") {
    const wanted = c.expect === "draws" ? "drew" : "refused";
    if (row.got !== wanted) row.surprise = `expected ${wanted}, got ${row.got}`;
  }
  rows.push(row);
  if (i % 25 === 0) say(`  ${i}/${cases.length}`);
}

record(`hunt-u1-${shard}.json`, { rows, findings });
say(`done: ${findings.length} findings, ${rows.filter((r) => r.surprise).length} surprises`);
for (const f of findings) say("  FINDING", f.name, "—", f.why);
for (const r of rows.filter((x) => x.surprise)) say("  surprise", r.name, "—", r.surprise, "|", (r.said ?? r.url ?? "").slice(0, 90));
await page.stop();
