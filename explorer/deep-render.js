// The deep renderer: `perturb.wasm` over a pool, and `engine.wasm` to colour what it drew.
//
// **Two modules, and they meet at a buffer of `f64` lanes.** `perturb.wasm` computes the
// smooth field of `z^d + c` for degrees two to six below the `f64` floor and knows nothing
// about colour; `engine.wasm` colours a smooth field and knows nothing about where it came
// from. What crosses between them is exactly what `engine.wasm`'s own `compute_band`
// produces for `smooth` — one lane, little-endian `f64`, `NaN` for the interior — so the
// existing `shade_level` reads it without being told which kernel drew it. Nothing in
// either module is linked into the other, which is what keeps the shallow path exactly as
// fast and exactly as many bytes as it was.
//
// **The shade spec carries a placeholder viewport, and that is sound rather than a
// shortcut.** `engine.wasm` refuses any spec whose viewport `f64` cannot resolve, and a
// deep viewport is precisely one of those — so the spec handed to `shade_level` names the
// Mandelbrot home instead. What makes that honest is that the colouring never reads it:
// `colour` in `engine-wasm/src/lib.rs` takes `sample_width`, `sample_height`, `out_width`,
// `out_height` and `supersample` off the viewport and nothing else, because a percentile
// stretch is a statement about the numbers in the buffer and not about where they were
// taken. `deep-shade.test.mjs` holds that to the committed module rather than to this
// comment: the same lanes under two different viewports come back byte for byte the same
// picture.
//
// **The orbit is the shape of everything here.** One high-precision reference orbit per
// frame, computed in one worker, sent to each of the others once, and held there across
// every band. A band call never computes one. See `deep-worker.js`.

import { BAND_TARGET_MS, bandsOf, recut } from "./render.js";
import { CHEAP_ITERATIONS_PER_WORKER, quarterOnGpu } from "./deep-gpu.js";
import { stopsOf } from "./stops.js";
import * as fx from "./deep-fx.js";

/** The pool, sized like the viewer's. A deep frame is the most arithmetic this page ever
 *  asks for, so there is no reason to give it less of the machine than a shallow one. */
const MAX_WORKERS = 16;
const DEFAULT_WORKERS = 8;

/**
 * The rows a band is cut to before anything about this frame has been measured.
 *
 * **Small, deliberately.** The viewer's opening cut is four bands to a worker, which is
 * right when a whole frame is a second: a quarter of it is a quarter of a second and the
 * per-band message is noise beside it. A deep frame is seconds to minutes, so a quarter of
 * one is a cancel the reader waits half a minute for. Two rows is a cut that is certainly
 * too fine and costs a few messages to find that out; the first band to report replaces it
 * with a measurement and everything still queued is re-cut to `BAND_TARGET_MS`. Erring
 * fine is the cheap direction: the overhead of a band that was too small is microseconds,
 * and the cost of one that was too big is the reader waiting.
 */
const OPENING_BAND_ROWS = 2;

/** How far over target a band may be predicted to run before the queue is re-cut. */
const RECUT_OVER = 1.5;

/**
 * The most samples a chunk of a sample list is cut to before the list has been measured
 * *(gpu_deep_ship_ckpt162)*: `OPENING_BAND_ROWS`'s reasoning, for the samples a GPU pass
 * hands back. Those are the frame's slowest by construction — each is still running at a
 * step checkpoint — so a chunk of them costs far more than the frame's average sample, and
 * the first chunk to report replaces this with a measurement of the list's own.
 */
const OPENING_SAMPLES = 64;

/**
 * The fewest samples a chunk of a long sample list is cut to *(deep_wait_ckpt163)*: about
 * a row of the full grid, the floor a band has. `compute_samples` unpacks the held orbit on
 * every call, as `compute_band` does, so a message costs the orbit's length whatever it
 * carries. Without the floor, one chunk of a frame's interior measured at a hundred times
 * the average re-cut everything still queued to a few samples a message. On
 * `random-dives#6` (an orbit of 1.45 M points) that was about 21,000 messages for 9.4 G
 * iterations: a full pass of 53 to 111 s, where its bands took 15. A list too short to give
 * every worker four chunks of it is cut finer instead, so a small list still spreads.
 */
const LIST_FLOOR = 1024;

/**
 * What an iteration costs with the kernel's interior switch on, against one with it off,
 * where the switch does not fire — the price a pass pays for asking.
 *
 * **Measured in the committed module, and taken low** *(profiling_pass_ckpt146)*: on
 * frames the switch never fires on, off ran in 0.50 to 0.73 of the time on did, the lanes
 * identical, so the price is 1.4x to 2x. The rule below keeps the switch on unless
 * turning it off is cheaper at the low end of that range, so a frame near the crossing
 * keeps the setting the kernel ships.
 *
 * **Measured again under SIMD, and left** *(deep_holes_ckpt163)*: the 43 frames of the
 * 159-frame sample whose census puts them between 1.15 and 3.3, each landed with the switch
 * forced on and forced off, twice, alternated, the wait the median. Summed over them, 1.4
 * costs the CPU 300.9 s, against 297.9 s at its best price (1.69), and the GPU 226.8 s,
 * against 224.1 s at its best (1.27); each kernel's best costs the other more than 1.4 does
 * (1.3 gives the CPU 302.1 s, 1.7 gives the GPU 230.0 s). About 1% either way, inside the
 * frame-to-frame noise, and in opposite directions, so no value is better on both.
 */
export const SWITCH_PRICE = 1.4;

/** A switch a bench page forces, through `globalThis.__deepForceSwitch` (`true` or `false`),
 *  so that one frame can be timed both ways *(deep_holes_ckpt163)*; `null` everywhere else. */
function forcedSwitch() {
  const forced = globalThis.__deepForceSwitch;
  return forced === true || forced === false ? forced : null;
}

/**
 * Whether a pass should run with the interior switch on, read off samples of the same
 * frame drawn with it on.
 *
 * **The switch never moves a CPU pixel**: a sample it stops early is one the plain loop
 * runs to the cap, and both write `NaN`. So on the CPU this is a speed and nothing else,
 * and samples drawn with it on — the kernel's default — say exactly what the plain loop
 * would have run: `ran` is what they did run and `saved` what the switch spared them. The
 * plain loop runs `ran + saved` at the lower price; the switch runs `ran` at
 * `SWITCH_PRICE`. (The GPU kernel is chosen by it too, so there it chooses a picture, and
 * the counts it reads are the frame's own.)
 */
export function switchFor(drawn) {
  const forced = forcedSwitch();
  if (forced !== null) return forced;
  if (drawn?.ran == null || drawn.saved == null || drawn.ran <= 0) return true;
  return drawn.ran + drawn.saved >= SWITCH_PRICE * drawn.ran;
}

/**
 * **The quarter pass is a quarter of the full grid's own samples** *(deep_wait_ckpt163)*.
 * It used to be a grid of its own, a quarter the width, whose sample centres fell between
 * the full grid's; now quarter sample `(r, c)` is full sample `(4r + 2, 4c + 2)` of the
 * full spec, drawn against the full grid's orbit, so the full pass has a sixteenth of its
 * samples already and finishes only the rest. Every value is `compute_samples` under the
 * full spec, which is bit for bit what a band covering that sample computes, so the full
 * field is the field it always was.
 */
export const QUARTER_STRIDE = 4;
const QUARTER_OFFSET = 2;

/** One quarter sample in four along each axis is drawn first with the switch on — the
 *  census that chooses the switch for the rest of the quarter and for the full pass. */
const CENSUS_STRIDE = 4;

/** A quarter whose census says the whole frame is under this many times the GPU's cheap
 *  line keeps the switch on, as every quarter used to: there the switch costs tenths of a
 *  second, and the cheap rule reads the quarter's iterations exactly as it was fitted to. */
const SWITCH_KEPT_UNDER_CHEAP = 4;

/** Whether `quarter` is a quarter of the `width` x `height` grid's own samples, which a full
 *  pass at that grid may take as its first sixteenth. */
export function seeds(quarter, width, height, supersample = 1) {
  return (
    quarter != null &&
    supersample === 1 &&
    Array.isArray(quarter.grid) &&
    quarter.grid[0] === width &&
    quarter.grid[1] === height &&
    quarter.width * QUARTER_STRIDE === width &&
    quarter.height * QUARTER_STRIDE === height &&
    quarter.values instanceof Float64Array &&
    quarter.values.length === quarter.width * quarter.height
  );
}

/** The full grid's index of each quarter sample, split into the census and the rest, both
 *  in the quarter's own row order. */
export function quarterIndices(width, height) {
  const qw = width / QUARTER_STRIDE;
  const qh = height / QUARTER_STRIDE;
  const census = [];
  const rest = [];
  for (let r = 0; r < qh; r++) {
    const row = (QUARTER_STRIDE * r + QUARTER_OFFSET) * width;
    for (let c = 0; c < qw; c++) {
      const at = row + QUARTER_STRIDE * c + QUARTER_OFFSET;
      if (r % CENSUS_STRIDE === 0 && c % CENSUS_STRIDE === 0) census.push(at);
      else rest.push(at);
    }
  }
  return { census: Uint32Array.from(census), rest: Uint32Array.from(rest) };
}

/** The packed reference's header: `count`, flags, the period residual. */
const ORBIT_HEADER = 16;

/**
 * **The held orbit, as this frame's own spec would have computed it** *(deep_wait_ckpt163)*.
 * `sameOrbit` hands a frame an orbit held from a deeper cap — a key zoom out, a Julia pan,
 * a lowered cap — and the CPU kernel reads no point past its own cap, so its pixels never
 * knew. The GPU reads the whole orbit to narrow it, and takes its flush term and its skip
 * table's verdict over every point it holds, so the same link drew a different GPU picture
 * reached that way than loaded fresh. Cut to `referenceBytes` (the plan's: the points this
 * spec reads), it is byte for byte the orbit a fresh load computes: the same limbs, so the
 * same points, and an orbit that escaped inside the cut is never longer than it. The
 * escaped flag is cleared where the cut is past the held escape, as a fresh orbit that
 * never reached it would say; the GPU reads only the periodic one.
 */
export function orbitFor(held, referenceBytes) {
  if (held === null || !(referenceBytes > ORBIT_HEADER)) return held;
  const count = new DataView(held.packed).getUint32(0, true);
  const limit = Math.floor((referenceBytes - ORBIT_HEADER) / 16);
  if (count <= limit) return held;
  const packed = held.packed.slice(0, ORBIT_HEADER + 16 * limit);
  const head = new DataView(packed);
  head.setUint32(0, limit, true);
  head.setUint32(4, head.getUint32(4, true) & ~1, true);
  return { ...held, packed, points: limit, bytes: packed.byteLength, stamp: `${held.stamp}:${limit}` };
}

/** A sample-list chunk of about `BAND_TARGET_MS` at `perSample` milliseconds a sample on
 *  one worker, never under `OPENING_SAMPLES`: a list cut finer than its cost pays the
 *  orbit's unpacking on every message. */
function chunkFor(perSample) {
  if (!(perSample > 0)) return OPENING_SAMPLES;
  return Math.max(OPENING_SAMPLES, Math.round(BAND_TARGET_MS / perSample));
}

/**
 * The cap policy's probe grid: how many of the frame's own sample cells one rung of the
 * escalation looks at.
 *
 * **The page names it rather than the module**, because how finely to probe is a cost and
 * the pool is what pays it; `perturb-wasm`'s `policy::PROBE_COLS` and `PROBE_ROWS` are the
 * same two numbers as the crate's own default, and its harness measures at them. 2,304
 * samples is about a thousandth of one pass of a deep frame, and measured over the
 * thirteen frames of `perturb-wasm/tests/common` the whole escalation costs 0.08% to 0.22% of the
 * fine pass it decides the cap for.
 *
 * The rows are cut across the pool exactly as a band's are: one worker walking the whole
 * probe of the deepest frame at eight times the policy cap is about seven seconds nobody
 * can cancel, and over eight workers it is under a second.
 */
const PROBE_COLS = 64;
const PROBE_ROWS = 36;

/** The atom-domain grid the nucleus search walks, which is the probe's own — the same
 *  cells of the same frame, for the same cost reason. `perturb-wasm`'s `nuclei::GRID_COLS`
 *  and `GRID_ROWS` are the crate's defaults and its harness measures at them. */
const GRID_COLS = 64;
const GRID_ROWS = 36;

/** Newton steps one seed gets. The crate's `nuclei::MAX_STEPS`, against an expectation of
 *  three or four: the correction is formed in `f64`, so a step is worth sixteen digits
 *  past the size of the step before it and a solve converges quadratically. */
const NEWTON_STEPS = 8;

/** `2^k` where an `f64` still holds it, for a size that arrived as a logarithm because
 *  `|l|` at these depths runs past what an exponent carries. Zero underneath that, which
 *  is a minibrot no link could reach anyway. */
function sizeOf(log2) {
  if (!Number.isFinite(log2) || log2 < -1060) return 0;
  return 2 ** log2;
}

/** How many fraction digits a centre needs to place a pixel of a frame this wide: the
 *  width's own decade and eight guard digits, which is `tests/descend.rs`'s rule for the
 *  committed deep frames and puts the truncation well under a pixel. Held under
 *  `deep-fx`'s own ceiling, past which a coordinate is refused outright. */
function digitsFor(width) {
  const decade = width > 0 && Number.isFinite(width) ? Math.ceil(-Math.log10(width)) : 0;
  return Math.min(fx.MAX_SCALE, Math.max(0, decade) + 8);
}

/** A plain decimal's fraction, truncated toward zero. The text is always `to_decimal`'s —
 *  sign, digits, point, digits, never an exponent — so this is a substring and not a
 *  re-spelling, which is what keeps it exact down to the digit it stops at. */
function trim(text, digits) {
  const point = text.indexOf(".");
  if (point < 0) return text;
  return text.slice(0, point + 1 + digits);
}

/** Whether two solves landed on one minibrot — asked of **where they stopped and not of
 *  what they were asked for**, because a harmonic of a period lands on that period's own
 *  nucleus. `step` is one sample of the frame: two centres closer than that are one dot on
 *  the screen, and a harmonic is at distance zero. */
function near(a, b, step) {
  const apart = Math.max(
    Math.abs(fx.difference(a.x.dec, b.x.dec)),
    Math.abs(fx.difference(a.y.dec, b.y.dec)),
  );
  return apart <= step;
}

/** The share of a frame's height a copy's body should fill once it is opened: a quarter,
 *  `nuclei::TILE_BODIES`' own target. */
export const BODY_TARGET = 0.25;

/**
 * **The body a preview tile holds, measured** *(find_minibrots_bulbs_ckpt145)*: the rows
 * the interior component through the tile's centre spans, as a share of its height.
 *
 * The lanes are the field `field()` resolves with, one `f64` a sample and `NaN` for the
 * interior, so this reads the tile before it is coloured. The component is 4-connected and
 * starts at the interior sample nearest the centre within four samples — the tile is centred
 * on the nucleus, which is interior — so a copy's cardioid and its bulbs count and the
 * filaments round it do not.
 *
 * `null` where there is nothing to measure: no interior near the centre, a component that
 * reaches the tile's edge (a lower bound, not a measurement), or one under four rows, where
 * a row either way is more than a tenth of the answer. `tests/measure.rs`'s `body_share` is
 * the same measurement natively, and is what the fallback factors were calibrated with.
 */
export function bodyShare(values, width, height) {
  const inside = (at) => Number.isNaN(values[at]);
  const cx = width >> 1;
  const cy = height >> 1;
  let start = -1;
  search: for (let r = 0; r <= 4; r++) {
    for (let y = Math.max(0, cy - r); y <= Math.min(height - 1, cy + r); y++) {
      for (let x = Math.max(0, cx - r); x <= Math.min(width - 1, cx + r); x++) {
        if (inside(y * width + x)) {
          start = y * width + x;
          break search;
        }
      }
    }
  }
  if (start < 0) return null;
  const seen = new Uint8Array(width * height);
  const stack = [start];
  seen[start] = 1;
  let top = height;
  let bottom = 0;
  while (stack.length > 0) {
    const at = stack.pop();
    const x = at % width;
    const y = (at - x) / width;
    if (x === 0 || y === 0 || x === width - 1 || y === height - 1) return null;
    top = Math.min(top, y);
    bottom = Math.max(bottom, y);
    for (const next of [at - 1, at + 1, at - width, at + width]) {
      if (!seen[next] && inside(next)) {
        seen[next] = 1;
        stack.push(next);
      }
    }
  }
  const rows = bottom - top + 1;
  return rows < 4 ? null : rows / height;
}

/** The viewport the shade spec names, so that `engine.wasm` has one it can resolve.
 *
 *  Left empty, which the module reads as the family's own home view — the most obviously
 *  placeholder thing available, and one whose resolvability is not a number written down
 *  here. See the note at the top of this file for why the colouring cannot see it. */
const SHADE_VIEWPORT = {};

/** The spec `shade_level` is handed for a deep field.
 *
 *  `palette` is the view's seven shade keys handed over as they stand — they ARE the
 *  engine's palette recipe, which is why the deep link spells them the shallow link's way
 *  and why nothing is translated here. `autolevel` rides beside them under the operator's
 *  own field names, as it does on the shallow path.
 *
 *  `colormap` is passed in rather than looked up, which is `rampSpecOf`'s shape and is
 *  there for `rampSpecOf`'s reason: it lets `deep.test.mjs` hand the module a map without
 *  the blob, and the blob is a fetch this page makes and a test does not. */
export function shadeSpecOf(view, colormap, width, height, { supersample = 1, level = true } = {}) {
  const spec = {
    schema: 1,
    // **A placeholder too, and for the viewport's reason** *(deep_degrees_ckpt140)*: the
    // colouring reads the buffer and not the family, so a degree-5 field is shaded under
    // the Mandelbrot name. `deep.test.mjs` holds that to the committed module.
    family: { kind: "mandelbrot" },
    viewport: SHADE_VIEWPORT,
    resolution: [width, height],
    mode: "smooth",
    palette: view.shade,
    colormap,
  };
  if (supersample > 1) spec.supersample = supersample;
  if (level && view.level) {
    spec.autolevel = {
      black_pt: view.level.black_pt,
      white_pt: view.level.white_pt,
      exponent: view.level.exponent,
      out_ends: view.level.out_ends,
    };
  }
  return spec;
}

/** The spec `perturb.wasm` is handed for a frame.
 *
 *  The centre crosses as **text** and nothing else will do: the module's own `Spec::parse`
 *  refuses a coordinate written as a JSON number by name, because a number has already
 *  lost the digits both this file and that one exist for. */
export function deepSpecOf(
  view,
  width,
  height,
  { supersample = 1, reference = null, period = null, interior = true } = {},
) {
  const spec = {
    schema: 1,
    center_re: view.x.text,
    center_im: view.y.text,
    width: view.w.value,
    resolution: [width, height],
    maxiter: view.maxiter,
  };
  if (supersample > 1) spec.supersample = supersample;
  // **The interior switch, only where it is turned off** *(profiling_pass_ckpt146)*: the
  // kernel ships it on, so a spec with the switch on is byte for byte the spec it was. It
  // never moves a pixel — a sample it stops early is one the plain loop runs to the cap,
  // and both write `NaN` — so which way it is set is a speed and nothing else. See
  // `switchFor` in `deep.js`.
  if (interior === false) spec.interior = false;
  // The degree, where it is not two: the kernel's default is two, so a degree-2 spec is
  // byte for byte the spec it was before the member existed.
  if ((view.degree ?? 2) !== 2) spec.degree = view.degree;
  if (view.julia !== null && view.julia !== undefined) {
    spec.julia_re = view.julia.x.text;
    spec.julia_im = view.julia.y.text;
    spec.anchor = anchorOf(view);
  } else if (reference !== null) {
    spec.reference_re = reference.x;
    spec.reference_im = reference.y;
  }
  // **A named period makes the reference periodic**, which is the whole payoff of having
  // solved a nucleus: the orbit is stored for one period and the index wraps instead of
  // rebasing. It rides beside the reference rather than inside it because the kernel takes
  // it that way, and a tile centred on its own nucleus names no reference at all — the
  // centre already is one.
  if (period !== null && period > 0) spec.period = period;
  return spec;
}

/**
 * Which of a Julia frame's two anchors it is drawn from: the nearer one.
 *
 * **Derived from the view and never carried in the link**, which is the ruling
 * worth stating. Both anchors are points of the same stored orbit and both are
 * exact, so they are two spellings of one picture — what differs is only how much
 * of the pixel step survives into the `f64` delta, and that is a property of where
 * the frame is rather than a decision anybody made about it. A link that carried
 * the anchor would be carrying a precision choice as though it were part of the
 * picture, and would go stale the moment the reader panned.
 *
 * The distance is the larger of the two components, because that is the number the
 * kernel's own `delta_ulps` is taken against. Ties go to the parameter, which is
 * where the filigree is and so where a reader is more likely to be.
 */
export function anchorOf(view) {
  if (!view.julia) return null;
  const toParameter = Math.max(
    Math.abs(fx.difference(view.x.dec, view.julia.x.dec)),
    Math.abs(fx.difference(view.y.dec, view.julia.y.dec)),
  );
  const toOrigin = Math.max(Math.abs(fx.toNumber(view.x.dec)), Math.abs(fx.toNumber(view.y.dec)));
  return toOrigin < toParameter ? "origin" : "parameter";
}

/**
 * What makes one reference orbit a different object from another, as a string.
 *
 * Not "where it is" — that is [`sameOrbit`]'s second question, asked of the point in
 * decimal. This is the part of an orbit that has to **match**, and every piece of it
 * is a way a held orbit would be silently wrong for a frame rather than merely unhelpful:
 *
 * - **the limb count**, because the points were computed to that many and a deeper view
 *   wants precision they do not carry;
 * - **the period**, because a periodic orbit is stored for one period and the kernel's
 *   index wraps into it — hand one to a frame that wanted the full walk and it says the
 *   reference returns to the origin when it does not;
 * - **which set, and at what parameter.** A Julia orbit and a Mandelbrot orbit are never
 *   swapped for each other even at the same point, because a view entered at `Z₁` is
 *   handed an orbit one step longer.
 * - **the degree**, because the orbit of `z³ + c` at a point is not the orbit of `z² + c`
 *   there, and a degree change keeps the centre, the width and the cap.
 *
 * One string rather than a field-by-field compare because the compare was the thing that
 * had to be remembered: `julia` was wanted when the Julia case landed and `period` when a
 * nucleus could be the reference, and each was a line somebody had to think to add. The
 * same move `deepLink.fieldKey` already makes for a field.
 */
export function orbitKey(view, limbs, period = null) {
  const plane = view.julia ? `j:${view.julia.x.text},${view.julia.y.text}` : "m";
  const set = `${plane}^${view.degree ?? 2}`;
  return `${set}|${limbs}|${period ?? "-"}`;
}

/**
 * Whether `held`, the orbit a pool holds, is the orbit a fresh load of this frame would
 * compute.
 *
 * **The held orbit is a memo, and nothing else** *(deep_orbit_history_ckpt150)*. A deep
 * picture is a function of its link, whatever the explorer drew before it, so the orbit
 * is kept only where it is provably the one a fresh load would pick or draws the
 * identical picture. Three things have to hold. **Its identity**, which is [`orbitKey`]
 * — the limb count, the period, the set and the degree. **The cap**: the held orbit was
 * run at least as far as this frame asks. That is the identical-picture case: an orbit
 * is computed step by step without reference to its cap, so a longer one begins with
 * the shorter one's points, and the kernel returns at the cap before it could read a
 * point past it. And **the point**: the reference is this frame's own centre, exactly,
 * in decimal.
 *
 * The point used to be anywhere inside the frame, so that a zoom about a point near the
 * middle paid for one orbit a descent rather than one a rung. That made the picture
 * depend on the path to it: the same address drew a different field after a zoom, or
 * after leaving the tab and coming back, than it did on a fresh load. Neither field
 * was wrong. Against `f64` on a shallow frame, and against the fixed-point oracle on
 * two frames below it, the kept reference and the frame's own drew equally close to the
 * truth, and they differed only in the chaotic tail, a percent or two of the samples
 * that sit on the boundary. So what this buys back is determinism, and the price is an
 * orbit per zoom (`explorer/README.md` has it measured).
 */
export function sameOrbit(held, view, limbs, period = null) {
  if (held === null) return false;
  // **Everything about the orbit that is its identity is one string**, which is what
  // keeps this test honest as the kind grows: a new field of a reference — `julia` when
  // the Julia case landed, `period` when a nucleus could be one — is a field of the key
  // rather than a line somebody has to remember to add here.
  if (held.key !== orbitKey(view, limbs, period)) return false;
  if (held.maxiter < view.maxiter) return false;
  // **A Julia frame's orbit does not depend on its frame at all.** It is the critical
  // orbit of the parameter, which the key already names, so a pan or a zoom inside a
  // Julia view is the orbit a fresh load would compute and never recomputes one.
  if (view.julia !== null) return true;
  // In decimal, and it has to be: two deep coordinates agree in every digit a double
  // holds, so `Number(a) === Number(b)` would say the reference is at the centre
  // wherever it actually is.
  return fx.compare(view.x.dec, held.x.dec) === 0 && fx.compare(view.y.dec, held.y.dec) === 0;
}

/** One pool worker, instantiated and ready. */
function spawn(module) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./deep-worker.js", import.meta.url), { type: "module" });
    worker.onmessage = (event) => {
      if (event.data.kind === "ready") {
        worker.onerror = null;
        resolve(worker);
      }
    };
    // As `render.js`'s: a worker whose script never arrived rejects rather than leaving the
    // tab on "starting the deep renderer…" for good (profiling_pass_ckpt146).
    worker.onerror = (event) => {
      worker.terminate();
      reject(new Error(`a deep worker did not start (${event.message || "its script did not load"})`));
    };
    worker.postMessage({ kind: "start", module });
  });
}

/**
 * Everything the Deep tab needs to draw, once `perturb.wasm` is compiled and the pool is up.
 *
 * **One request per worker at a time, matched by id, and a worker is idle exactly when it
 * has none outstanding** *(deep_tab_activity_and_layout_ckpt141)*. That sentence replaces a
 * hand-kept `idle` list and a worker handler that each caller swapped in and out, and the
 * pair of them was the bug the test frame was stuck on: a cancel left in-flight workers off
 * the list, the next probe's handler swallowed their late bands, and after three gestures
 * during a pass no worker was idle and the frame never started. Nothing is kept by hand
 * now — `#slot.busy` is the only record of whether a worker is working, and the router
 * that clears it is installed once, when the worker is born.
 *
 * **Cancel ends every worker that is working, and the pool comes back idle.** A wasm call
 * cannot be interrupted, and the long ones — a reference orbit at a million, a probe rung
 * beside a parabolic point — are seconds to minutes, so a cancel that waited for them was
 * not a cancel. A busy worker is terminated and a fresh one started from the module already
 * compiled, which costs a few milliseconds; it is fed the held orbit again the next time a
 * request needs it, and that is the whole cost of being able to stop anything.
 */
/**
 * **Copies first, and bulbs only where there is no copy** *(find_minibrots_bulbs_ckpt145)*, of
 * the entries that have been read, largest first and at most `want` of them. An entry the root
 * test could not finish is neither and is never offered; `unresolved` on the list says how many
 * and why *(dive_primitive_only_ckpt154)*, and an entry never read is not counted at all.
 */
function offered(distinct, want) {
  const copies = distinct.filter((nucleus) => nucleus.kind === "copy");
  const bulbs = distinct.filter((nucleus) => nucleus.kind === "bulb");
  const list = (copies.length > 0 ? copies : bulbs).slice(0, want);
  list.unresolved = distinct
    .filter((nucleus) => nucleus.kind === "unresolved")
    .map((nucleus) => ({ period: nucleus.period, reason: nucleus.reason }));
  return list;
}

export class DeepRenderer {
  constructor(module, planner, workers, shading) {
    this.module = module;
    /** A main-thread instance, for `plan` and the policy's small questions. Never for an
     *  orbit, which is a worker's (see `#reference`). */
    this.planner = planner;
    /** The pool: `{ worker, ready, busy, fed }` a worker. `busy` is the request in flight
     *  or `null`; `ready` resolves once a (re)started worker is up; `fed` is the stamp of
     *  the orbit it holds. */
    this.slots = workers.map((worker) => this.#slotOf(worker));
    /** The page's own shade worker, over `engine.wasm`. Deep fields are coloured there for
     *  the reason the viewer's final stage is: a recolour of a frame that took a minute
     *  must not freeze the page for half a second. */
    this.shading = shading;
    this.generation = 0;
    this.queue = [];
    this.job = null;
    this.requests = 0;
    /** Milliseconds per output row per sample-per-pixel, as the last bands measured it. */
    this.rowCost = null;
    /** The reference orbit the pool holds: its bytes, the point it is of, the cap and the
     *  limb count it was computed at, its stamp, and its reach. `null` before the first. */
    this.orbit = null;
    this.orbits = 0;
    /** When any worker was last heard from — a reply or a progress message. What the tab's
     *  watchdog reads: a pool that has said nothing for ten seconds is not a slow frame. */
    this.heard = performance.now();
    /** Called with every message a worker sends, for the tab's log. `null` is silence. */
    this.onMessage = null;
    /** The page's GPU (`deep-gpu.js`'s `DeepGpu`), set by the tab; `null` draws every
     *  field with the bands. */
    this.gpu = null;
    /** Called with which kernel a GPU-eligible field went to and why, for the tab's log. */
    this.onGpu = null;
  }

  static async start(url, engineShading, wanted) {
    const module = await compiled(url);
    // The module's one import, and on this thread there is nobody to tell: the planner
    // answers `plan` and the policy's constants, all of which are microseconds.
    const planner = new WebAssembly.Instance(module, PLANNER_IMPORTS).exports;
    const count =
      wanted ?? Math.min(MAX_WORKERS, navigator.hardwareConcurrency || DEFAULT_WORKERS);
    const workers = [];
    for (let index = 0; index < Math.max(1, count); index++) workers.push(await spawn(module));
    return new DeepRenderer(module, planner, workers, engineShading);
  }

  get workerCount() {
    return this.slots.length;
  }

  /** Whether any worker has a request in flight. */
  get busy() {
    return this.slots.some((slot) => slot.busy !== null);
  }

  #slotOf(worker) {
    const slot = { worker, ready: Promise.resolve(), busy: null, fed: null };
    this.#route(slot);
    return slot;
  }

  /** The one handler a worker ever has. A reply settles the request with its id and frees
   *  the worker; a progress message goes to that request's listener; anything else — a
   *  reply to a request that was cancelled — is dropped, and the worker is still free. */
  #route(slot) {
    slot.worker.onmessage = (event) => {
      const message = event.data;
      this.heard = performance.now();
      this.onMessage?.(message);
      const busy = slot.busy;
      if (busy === null || message.id !== busy.id) return;
      if (message.kind === "progress") {
        busy.onProgress?.(message.done, message.total);
        return;
      }
      slot.busy = null;
      busy.resolve(message);
    };
  }

  /** Put a worker back as it was born: terminated, restarted from the compiled module, and
   *  holding no orbit. Whatever it was asked is answered `null`. */
  #restart(slot) {
    const busy = slot.busy;
    slot.busy = null;
    slot.worker.terminate();
    slot.fed = null;
    slot.ready = spawn(this.module).then((worker) => {
      slot.worker = worker;
      this.#route(slot);
    });
    // Whoever next waits on the slot hears a failed start; nobody waiting is not a fault.
    slot.ready.catch(() => {});
    busy?.resolve(null);
  }

  /**
   * Ask one worker one thing, and resolve with its reply — or with `null` where the request
   * was cancelled before it was answered.
   *
   * The worker must be free; every caller here waits for a reply before it asks the same
   * worker again, which is what one-at-a-time means, and a request sent to a busy worker
   * is a mistake of this file's and is thrown as one.
   *
   * **A request asked before a cancel is never sent after it** *(deep_stall_ckpt143)*. A
   * cancel restarts a busy worker and `ready` is then a pending start, so everything asked
   * of that worker waits on it — a cancelled pass's orbit feed as well as the new pass's.
   * The one asked first resumed first, took the worker for a generation nobody wanted, and
   * the new pass's request found it busy and threw this file's own mistake: the pass died
   * as *the deep render failed*, measured over CDP on a zoom during a tangle 1e-22 pass. So
   * the generation is read when a request is asked, and one the pool has moved past while
   * it waited resolves `null`, which is what a cancelled request already means here.
   */
  async #send(slot, message, { onProgress, transfer = [] } = {}) {
    const generation = this.generation;
    await slot.ready;
    if (generation !== this.generation) return null;
    if (slot.busy !== null) throw new Error("a deep worker was asked two things at once");
    const id = ++this.requests;
    return new Promise((resolve) => {
      slot.busy = { id, kind: message.kind, resolve, onProgress, at: performance.now() };
      slot.worker.postMessage({ ...message, id }, transfer);
    });
  }

  /** Write a string into the planner's heap, call an export with it, and free it.
   *
   *  The same shape `deep-worker.js` uses on its own instance, for the same reason: a
   *  spec goes in, something comes back, and the allocation is nobody's business
   *  afterwards. */
  #with(text, call) {
    const raw = new TextEncoder().encode(text);
    const pointer = this.planner.alloc(raw.length);
    new Uint8Array(this.planner.memory.buffer, pointer, raw.length).set(raw);
    try {
      return call(pointer, raw.length);
    } finally {
      this.planner.dealloc(pointer, raw.length);
    }
  }

  /** Read back what a report-returning export left: four bytes of little-endian length,
   *  then the UTF-8, and the whole buffer freed. */
  #take(out) {
    const size = new DataView(this.planner.memory.buffer).getUint32(out, true);
    const body = new TextDecoder().decode(
      new Uint8Array(this.planner.memory.buffer, out + 4, size),
    );
    this.planner.dealloc(out, size + 4);
    return JSON.parse(body);
  }

  /** What this spec implies, or why it cannot be drawn: the kernel's own answer. */
  plan(spec) {
    return this.#with(JSON.stringify(spec), (pointer, length) =>
      this.#take(this.planner.plan(pointer, length)),
    );
  }

  /**
   * **The rung rule** *(deep_dive_block_ckpt154)*: which of a search's entries the Dive block
   * lands on, `perturb-wasm`'s `dive::pick`. Microseconds, so the planner's.
   *
   * `found` is the search's list, largest first, each with `x`, `y`, `period`, `sizeLog2`
   * and `kind`; `rungs` the dive's earlier copies, the same shape. Every offset is taken from
   * `view`'s centre in decimal, which is the only way two deep centres differ at all.
   * Resolves `{ index }`, or `{ index: null, refusal, period, need }`.
   */
  pick(view, found, rungs, count) {
    const off = (one, axis) => fx.difference(one[axis].dec, view[axis].dec);
    const request = {
      width: view.w.value,
      degree: view.degree ?? 2,
      count,
      periods: found.map((one) => one.period),
      off_re: found.map((one) => off(one, "x")),
      off_im: found.map((one) => off(one, "y")),
      size_log2: found.map((one) => one.sizeLog2),
      // A copy only where the root test said so: a bulb and an unresolved reading are both
      // "not a copy" to the rung rule (dive_primitive_only_ckpt154).
      copy: found.map((one) => (one.kind === "copy" ? 1 : 0)),
      rung_re: rungs.map((one) => off(one, "x")),
      rung_im: rungs.map((one) => off(one, "y")),
      rung_size_log2: rungs.map((one) => one.sizeLog2),
    };
    return this.#with(JSON.stringify(request), (pointer, length) =>
      this.#take(this.planner.dive_pick(pointer, length)),
    );
  }

  /**
   * **A landing** *(deep_dive_block_ckpt154)*: `perturb-wasm`'s `dive_land`, on a worker,
   * because a mapped landing's shooting is up to a couple of seconds. `null` where the pool
   * moved on while it ran, which is what a cancelled request means everywhere here.
   */
  async land(request, { onProgress } = {}) {
    const generation = this.generation;
    const slot = this.slots.find((each) => each.busy === null) ?? this.slots[0];
    if (slot.busy !== null) this.cancel();
    const reply = await this.#send(
      slot,
      { kind: "land", request: JSON.stringify(request) },
      { onProgress },
    );
    if (generation !== this.generation) return null;
    return reply?.landing ?? null;
  }

  /** How many of its copy's periods a landing asks for: `"center"` thirty-two, `"halfway"`
   *  eight — the crate's `dive::Landing::count`, asked rather than restated. */
  landingPeriods(landing) {
    return this.planner.landing_periods(landing === "center" ? 0 : 1);
  }

  /** The kernel's cap policy — the engine's shape, with the engine's ceiling lifted. */
  maxiter(width) {
    return this.planner.maxiter_for_width(width);
  }

  /** How many 64-bit limbs a view of this width and this many samples across is computed
   *  at: the one number that says what the reference orbit will cost. */
  limbs(width, sampleWidth) {
    return this.planner.limbs_for_width(width, sampleWidth);
  }

  /** How wide a preview tile of a minibrot this size is — twelve body widths, the crate's
   *  `nuclei::TILE_BODIES`, which is also the frame an entry opens at. */
  tileWidth(size) {
    return this.planner.tile_width(size);
  }

  /** How wide a copy of this size is framed before its body has been measured, or where
   *  it cannot be: twelve sizes times the degree's calibrated factor, the crate's
   *  `nuclei::copy_width`. A bulb keeps `tileWidth`. */
  copyWidth(size, degree = 2) {
    return this.planner.copy_width(size, degree);
  }

  /**
   * The cap a preview tile of a period-`p` nucleus is drawn at.
   *
   * **Asked and never guessed**, and it is emphatically not the width policy: a tile needs
   * eight periods of its own nucleus before a minibrot's neighbourhood resolves at all, and
   * the width policy at a tile's width gives about one and a half. `nuclei::TILE_PERIODS`
   * in the crate is where that is measured; a page that used the width's answer would draw
   * a flat black rectangle, slowly.
   */
  tileCap(period, width) {
    return this.planner.tile_cap(period, width);
  }

  /**
   * The cap an opened minibrot of period `p` is drawn at, and the `n` its link carries:
   * thirty-two periods of it, or the width policy where that is more, under the ceiling.
   *
   * **Four times a tile's**, because a tile's eight was measured on a 316-pixel preview
   * and the frame a reader opens is the viewer's own, where a copy at about thirteen
   * periods is an all-black blob. `nuclei::OPEN_PERIODS` is where that is said.
   */
  openCap(period, width) {
    return this.planner.open_cap(period, width);
  }

  /** The share of a frame that may still be the cap's fault before the cap is raised.
   *  The kernel's `policy::FAULT_SHARE`, asked rather than restated. */
  get faultShare() {
    return this.planner.fault_share();
  }

  /**
   * **The cap this frame asks for**, walked a rung at a time.
   *
   * Opens at the view's own cap — the width policy's, since a reader who has pinned one
   * never reaches here — renders [`PROBE_COLS`] × [`PROBE_ROWS`] of the frame's own sample
   * cells at it, and doubles while more than `faultShare` of those cells died at the cap
   * with `|dz|` grown past the escape radius. The crate's `policy` module is where the
   * three kinds of cap-death are set out and why only that one is a fault; what is here is
   * the loop and the pool.
   *
   * `onStep` hears the rung's two halves as they go: `{ phase: "orbit", done, total, cap,
   * rung }` in iterations of the reference, then `{ phase: "probe", done, total, cap, rung }`
   * in cells of the probe, summed over the pool.
   *
   * Resolves with `{ maxiter, from, steps, atCeiling, fault, rungs, iterations, elapsed }`,
   * or `null` where a newer generation started while it ran.
   *
   * **The probe is a subset of the frame, not a smaller picture of it**: the cells, the
   * limb count, the geometry and the reference orbit are the frame's own, so the fine pass
   * runs once, at the cap this settled on, and nothing about the decision is an
   * approximation of the thing being decided.
   */
  async settle(view, width, height, { supersample = 1, onRung, onStep } = {}) {
    this.cancel();
    const generation = this.generation;
    const started = performance.now();
    const from = view.maxiter;
    let at = view;
    let iterations = 0;
    const rungs = [];

    for (;;) {
      const rung = rungs.length + 1;
      const cap = at.maxiter;
      const reference = await this.#reference(at, width, height, supersample, null, {
        generation,
        onProgress: (done, total) => onStep?.({ phase: "orbit", done, total, cap, rung }),
      });
      if (generation !== this.generation) return null;
      if (reference === null) {
        throw new Error("the kernel could not compute a reference orbit for this view");
      }
      const spec = deepSpecOf(at, width, height, { supersample, reference });
      const counts = await this.#probe(JSON.stringify(spec), generation, (done, total) =>
        onStep?.({ phase: "probe", done, total, cap, rung }),
      );
      if (counts === null || generation !== this.generation) return null;
      iterations += counts.iterations;
      rungs.push(counts);
      onRung?.(counts, rungs.length);

      const fault = counts.samples > 0 ? counts.fault / counts.samples : 0;
      const next = this.planner.next_cap(at.maxiter);
      // Resolved, or there is nowhere left to go: `next_cap` saturates at the kernel's
      // ceiling and hands back the cap it was given, which is what ends the walk.
      if (fault <= this.faultShare || next === at.maxiter) {
        return {
          maxiter: at.maxiter,
          from,
          steps: rungs.length - 1,
          atCeiling: fault > this.faultShare,
          fault,
          rungs,
          iterations,
          elapsed: performance.now() - started,
        };
      }
      at = { ...at, maxiter: next };
    }
  }

  /** One rung's counts, over the pool. The probe's rows are cut between the workers and
   *  the counts summed; a band that comes back refused is the rung's error. */
  async #probe(spec, generation, onProgress) {
    const shares = await this.#shares(
      "probe",
      "counts",
      "the kernel refused to probe this view",
      spec,
      PROBE_COLS,
      PROBE_ROWS,
      generation,
      onProgress,
    );
    if (shares === null) return null;
    const total = {
      maxiter: 0,
      samples: 0,
      escaped: 0,
      proven: 0,
      starved: 0,
      fault: 0,
      iterations: 0,
    };
    for (const counts of shares) {
      for (const key of ["samples", "escaped", "proven", "starved", "fault", "iterations"]) {
        total[key] += counts[key];
      }
      total.maxiter = Math.max(total.maxiter, counts.maxiter);
    }
    return total;
  }

  /**
   * The minibrots in and around this view, largest first.
   *
   * **Three phases, and only the third streams.** The domain walk goes over the pool in
   * bands like a probe; the solves go over the pool too, one seed to a worker, because a
   * Newton step reads no orbit and so any worker can take any step of any seed. Only when
   * every solve is in can the list be *ranked*, which is what the reader is promised —
   * largest first — so the tiles are drawn after that, one at a time, and `onFound` is
   * what lets the caller put each one up as it lands.
   *
   * Drawing is serial and has to be: the pool holds one reference orbit between all its
   * workers, and every tile wants a different one. That is also why the view's own orbit
   * is gone afterwards and the next Render recomputes it.
   *
   * Resolves with `null` where a newer generation started, as everything here does.
   */
  async nuclei(
    view,
    width,
    height,
    { supersample = 1, tileSamples = 316, budget = 12, want = 6, enough = null, onStep } = {},
  ) {
    this.cancel();
    const generation = this.generation;
    const reference = await this.#reference(view, width, height, supersample, null, {
      generation,
      onProgress: (done, total) => onStep?.({ phase: "orbit", done, total }),
    });
    if (generation !== this.generation) return null;
    if (reference === null) {
      throw new Error("the kernel could not compute a reference orbit for this view");
    }
    const spec = JSON.stringify(deepSpecOf(view, width, height, { supersample, reference }));
    const seeds = await this.#seeds(spec, generation, (done, total) =>
      onStep?.({ phase: "seeds", done, total }),
    );
    if (seeds === null || generation !== this.generation) return null;

    // Widest domain first: the cells a domain takes on the grid are a free measure of how
    // much of the frame its nucleus dominates, and a domain's scale is its body's square
    // root — so this is the cheap proxy for "largest", spent before any solve is.
    seeds.sort((a, b) => b.cells - a.cells || a.minimum - b.minimum);
    // **Twelve solves for six entries**, which is `tests/measure.rs`'s own budget: the
    // harmonics and the one body that contains the whole view are only found by solving
    // them, so a budget equal to `want` returns fewer than `want`. Twelve is two rounds
    // over an eight-worker pool, and a solve is 0.05 s at 2e-11 and 2 s at 1e-54.
    const chosen = seeds.slice(0, budget);
    const degree = view.degree ?? 2;
    const limbs = this.planner.nucleus_limbs(view.w.value, tileSamples, degree);

    let settled = 0;
    const lanes = this.slots.map((slot, index) => {
      const mine = chosen.filter((_, at) => at % this.slots.length === index);
      return this.#solveEach(slot, mine, view, limbs, generation, () =>
        onStep?.({ phase: "solves", done: ++settled, total: chosen.length }),
      );
    });
    const solved = (await Promise.all(lanes)).flat();
    if (generation !== this.generation) return null;

    // **Lowest period first, then one nucleus per place** — `perturb-wasm`'s `nuclei`
    // module keeps the same two rules in the same order, and its own tests are where they
    // are argued. A period-`p` nucleus satisfies `z_kp(c) = 0` for every multiple, so the
    // walk reports harmonics and Newton takes each of them to the *same point* with a
    // collapsed size; keeping the lowest period at each place is what makes the size real.
    // And a minibrot larger than the view is not in the view, it contains it.
    const step = view.w.value / (width * supersample);
    const distinct = [];
    for (const nucleus of solved.sort((a, b) => a.period - b.period)) {
      if (distinct.some((held) => near(held, nucleus, step))) continue;
      if (!(nucleus.size > 0) || nucleus.size >= view.w.value) continue;
      distinct.push(nucleus);
    }
    distinct.sort((a, b) => b.sizeLog2 - a.sizeLog2);

    // **Copies first, and bulbs only where the view holds no copy**
    // *(find_minibrots_bulbs_ckpt145)*. A satellite bulb is a nucleus like any other and
    // the walk finds them readily — seven of the thirteen entries the last check opened
    // were bulbs — but a bulb is not a copy. Every distinct nucleus is read, not only the
    // first `want`, because a list of copies is filled from all of them; `perturb-wasm`'s
    // `nuclei::classify` is the reading and `nuclei::copies_first` the same rule natively.
    // **A reading the root test could not finish is neither** *(dive_primitive_only_ckpt154)*:
    // it is never offered, and `unresolved` says how many were left out and why.
    //
    // **Read in rounds where the caller can stop early** *(dive_primitive_only_ckpt154)*. The
    // root test is two or three orbits of the period a root, `d − 1` roots, so at depth a
    // reading is more than the solve that found the nucleus. A dive's rung rule takes the
    // first acceptable copy largest first, so `enough`, given the list the entries read so
    // far make, says when the rest cannot change its answer: every entry larger than the
    // one it takes has been read. Unread entries are left out of the list, as neither.
    let read = 0;
    const readRound = (round) =>
      Promise.all(
        this.slots.map((slot, index) => {
          const mine = round.filter((_, at) => at % this.slots.length === index);
          return this.#classifyEach(slot, mine, limbs, degree, generation, () =>
            onStep?.({ phase: "classify", done: ++read, total: distinct.length }),
          );
        }),
      );
    if (enough === null) {
      await readRound(distinct);
    } else {
      for (let from = 0; from < distinct.length; from += this.slots.length) {
        await readRound(distinct.slice(from, from + this.slots.length));
        if (generation !== this.generation) return null;
        if (enough(offered(distinct.slice(0, from + this.slots.length), want))) break;
      }
    }
    if (generation !== this.generation) return null;
    return offered(distinct, want);
  }

  /** Every nucleus in this lane read as a copy, a bulb or unresolved, on this worker, in
   *  turn. A reading the module refuses is unresolved: it used to leave its nucleus a copy,
   *  and a dive lands only on what the root test called one. */
  async #classifyEach(slot, mine, limbs, degree, generation, onRead) {
    for (const nucleus of mine) {
      if (generation !== this.generation) return;
      const reply = await this.#send(slot, {
        kind: "classify",
        request: JSON.stringify({
          c_re: nucleus.x.text,
          c_im: nucleus.y.text,
          period: nucleus.period,
          limbs,
          degree,
          size_log2: nucleus.sizeLog2,
        }),
      });
      const reading = reply?.reading ?? null;
      nucleus.kind = reading?.ok ? reading.kind : "unresolved";
      nucleus.parent = reading?.ok ? reading.parent : 0;
      nucleus.m = reading?.ok ? reading.m : 0;
      nucleus.reason = reading?.ok ? reading.reason : (reading?.why ?? "the reading was refused");
      onRead();
    }
  }

  /** The domain walk over the pool, its rows cut between the workers and its seeds merged
   *  by period: cells add, and the smallest approach keeps its cell. */
  async #seeds(spec, generation, onProgress) {
    const shares = await this.#shares(
      "seeds",
      "found",
      "the kernel refused to walk this view",
      spec,
      GRID_COLS,
      GRID_ROWS,
      generation,
      onProgress,
    );
    if (shares === null) return null;
    const merged = new Map();
    for (const found of shares) {
      for (const seed of found.seeds) {
        const held = merged.get(seed.period);
        if (held === undefined) merged.set(seed.period, { ...seed });
        else {
          held.cells += seed.cells;
          if (seed.minimum < held.minimum) {
            held.minimum = seed.minimum;
            held.from_re = seed.from_re;
            held.from_im = seed.from_im;
          }
        }
      }
    }
    return [...merged.values()];
  }

  /** Every seed in this lane, solved on this worker, in turn. */
  async #solveEach(slot, mine, view, limbs, generation, onSolved) {
    const solved = [];
    for (const seed of mine) {
      if (generation !== this.generation) return solved;
      const nucleus = await this.#solve(slot, seed, view, limbs, generation);
      onSolved();
      if (nucleus !== null) solved.push(nucleus);
    }
    return solved;
  }

  /**
   * Newton from one seed until it stops moving.
   *
   * **The centre is exact on the way in and on the way out.** The seed's offset is a
   * fraction of the view's width and so an `f64`, which becomes an exact decimal through
   * `fromNumber` and is added to the centre in `deep-fx`'s own arithmetic; the module
   * hands back every digit of what it stored, and that text goes straight back in as the
   * next step's input. Nothing is narrowed between steps, which is the only reason a
   * solve converges past 1e-38 at all.
   */
  async #solve(slot, seed, view, limbs, generation) {
    let re = fx.text(fx.add(view.x.dec, fx.fromNumber(seed.from_re) ?? fx.ZERO));
    let im = fx.text(fx.add(view.y.dec, fx.fromNumber(seed.from_im) ?? fx.ZERO));
    // The body is the view's width squared, near enough — to the power `d/(d−1)` at degree
    // `d`, `nuclei::body_power` — and this is eight digits below it. Newton stalls at its
    // own `f64` floor well above this; the stall is the real end.
    const degree = view.degree ?? 2;
    const power = degree === 2 ? 2 : degree / (degree - 1);
    const tolerance = view.w.value ** power * 1e-8;
    let last = Infinity;
    for (let step = 1; step <= NEWTON_STEPS; step++) {
      if (generation !== this.generation) return null;
      const reply = await this.#send(slot, {
        kind: "newton",
        request: JSON.stringify({ c_re: re, c_im: im, period: seed.period, limbs, degree }),
      });
      const answer = reply?.step ?? null;
      if (answer === null || !answer.ok || answer.escaped) return null;
      re = answer.c_re;
      im = answer.c_im;
      const done = answer.moved <= tolerance || !(answer.moved < last);
      last = answer.moved;
      if (done || step === NEWTON_STEPS) {
        // **Trimmed here and nowhere earlier.** The module hands back every digit of what
        // it stored — `64(limbs-1)`, about two hundred — because that text goes straight
        // back in as the next step's input and a truncation between steps would be
        // precision thrown away once a step. But `deep-fx` caps a coordinate at
        // `MAX_SCALE` digits and refuses anything longer, so the *answer* has to come down
        // to what the picture needs: the tile's own decade and eight guard digits, which
        // puts the truncation far under one of its pixels. Not doing this was worth
        // finding: `fx.parse` returned null on every solve and the list came back empty.
        const digits = digitsFor(sizeOf(answer.size_log2) * this.planner.tile_width(1));
        const trimmed = { x: trim(re, digits), y: trim(im, digits) };
        // **The two refusals are not the same refusal, and only one of them is this
        // seed's fault.** A coordinate that is not a decimal at all means the module
        // answered with something unreadable — drop the seed, the way an unconverged one
        // is dropped. A coordinate that is merely *longer than `deep-fx` carries* means
        // the trim above did not do its job, which is this page's own mistake and is
        // exactly the bug that made every solve come back empty with a clean console.
        // That one is said out loud rather than counted as a seed that did not converge.
        for (const [axis, text] of Object.entries(trimmed)) {
          if (fx.refusal(text) === fx.TOO_LONG) {
            throw new Error(
              `the solver's ${axis} is ${text.length} digits, past what a coordinate carries` +
                " — the trim to the tile's own decade did not happen",
            );
          }
        }
        const dec = { x: fx.parse(trimmed.x), y: fx.parse(trimmed.y) };
        if (dec.x === null || dec.y === null) return null;
        return {
          period: seed.period,
          x: { text: fx.text(dec.x), dec: dec.x },
          y: { text: fx.text(dec.y), dec: dec.y },
          sizeLog2: answer.size_log2,
          windowLog2: answer.window_log2,
          size: sizeOf(answer.size_log2),
          steps: step,
          residual: last,
        };
      }
    }
    return null;
  }

  /**
   * Cut `rows` of the frame's own grid across the pool and ask every worker for its
   * share, as one request each.
   *
   * **What a band of a probe and a band of the domain walk have in common**, which is
   * everything except the tally: the same cut, the same one-request round trip, the same
   * refusal. Resolves with one answer per worker, or `null` where the pool is empty or a
   * newer generation has started; throws the kernel's own sentence where a share was
   * refused. `onProgress(done, total)` hears the cells walked so far over the whole pool,
   * summed from each worker's own report of its share.
   */
  async #shares(kind, field, refusal, spec, cols, rows, generation, onProgress) {
    const workers = this.slots.length;
    if (workers === 0) return null;
    const ranges = [];
    for (let index = 0; index < workers; index++) {
      const start = Math.floor((index * rows) / workers);
      const end = Math.floor(((index + 1) * rows) / workers);
      if (end > start) ranges.push([start, end]);
    }
    if (!(await this.#feedAll(generation))) return null;
    const done = ranges.map(() => 0);
    const total = cols * rows;
    const answers = await Promise.all(
      ranges.map(([rowStart, rowEnd], index) =>
        this.#send(
          this.slots[index],
          { kind, spec, cols, rows, rowStart, rowEnd },
          {
            onProgress: (cells) => {
              done[index] = cells;
              onProgress?.(done.reduce((sum, count) => sum + count, 0), total);
            },
          },
        ),
      ),
    );
    if (generation !== this.generation || answers.some((reply) => reply === null)) return null;
    for (const reply of answers) {
      if (!reply[field]?.ok) throw new Error(reply[field]?.why ?? refusal);
    }
    return answers.map((reply) => reply[field]);
  }

  /**
   * Stop whatever the pool is doing, and come back idle.
   *
   * The generation moves, so everything still awaiting drops its answer on the floor; and
   * every worker with a request in flight is ended and restarted, so nothing is still
   * running when this returns. That second half is what a reader's Cancel means — a probe
   * rung, an orbit and a band are all things a wasm call cannot be talked out of.
   */
  cancel() {
    this.generation += 1;
    this.queue = [];
    const job = this.job;
    this.job = null;
    for (const slot of this.slots) {
      if (slot.busy !== null) this.#restart(slot);
    }
    if (job !== null) job.resolve(null);
  }

  /** Throw away the pool and the orbit every worker is holding. */
  stop() {
    this.cancel();
    for (const slot of this.slots) slot.worker.terminate();
    this.slots = [];
    this.orbit = null;
  }

  /** Whether the held orbit is the one this frame would compute: [`sameOrbit`]. */
  #holds(view, limbs, period) {
    return sameOrbit(this.orbit, view, limbs, period);
  }

  /**
   * Make sure the pool has the orbit this frame needs, computing one if the held one will
   * not do. Resolves with the reference the frame's spec should name, or `null` where the
   * kernel refused to produce one or the generation moved on.
   *
   * **Computed in a worker, never on this thread** *(deep_tab_activity_and_layout_
   * ckpt141)*. At a cap of a million an orbit takes tenths of a second, and on the page's
   * own thread that was time in which nothing — the progress line, the spinner, Cancel —
   * could run. The first worker computes it and keeps it, and the bytes it hands back are what
   * every other worker is fed from, lazily, by [`#feedAll`].
   */
  async #reference(view, width, height, supersample, period = null, { generation, onProgress } = {}) {
    // **The limbs are the spec's, asked of `plan`, and not the width's** *(deep_degrees_ckpt140)*.
    // A Julia frame anchored at `z = 0` is computed at twice the view's bits, because its
    // first step squares the pixel offset — so the width's own count would be the key of
    // an orbit the kernel never computes for this frame, and a held orbit at the width's
    // count would pass the identity test above while being short of the bits this frame
    // needs. The kernel decides the count; this reads it.
    const planned = this.plan(deepSpecOf(view, width, height, { supersample, period }));
    const limbs = planned.ok ? planned.limbs : this.limbs(view.w.value, width * supersample);
    // Named by the view's own spelling, so the spec is the one a fresh load writes: the
    // held point is the same number, and may have been spelled with another digit count.
    if (this.#holds(view, limbs, period)) return { x: view.x.text, y: view.y.text, kept: true };

    // The reference is the view's own centre. For an ordinary frame that is the best point
    // available; for a preview tile it is the nucleus the search solved, and the centre
    // *is* the nucleus — which is why a tile names a period and no reference.
    const spec = deepSpecOf(view, width, height, { supersample, period });
    const slot = this.slots[0];
    if (slot === undefined) return null;
    const reply = await this.#send(
      slot,
      { kind: "reference", spec: JSON.stringify(spec) },
      { onProgress },
    );
    if (reply === null || (generation !== undefined && generation !== this.generation)) return null;
    if (reply.orbit === null) return null;

    this.orbits += 1;
    this.orbit = {
      x: view.x,
      y: view.y,
      // What this orbit *is* — the set, the parameter, the limbs, the period — as the one
      // string `sameOrbit` compares. Where it is stays `x` and `y`, the point it asks
      // about second.
      key: orbitKey(view, limbs, period),
      // The parameter this orbit is the critical orbit of, as text. `null` on the
      // Mandelbrot side, where the orbit is of the frame's own reference point. In the
      // key as well as here: the whole record goes to `onOrbit`, which is what the page
      // says an orbit is, and that stays a description rather than becoming a compare.
      julia: view.julia ? { x: view.julia.x.text, y: view.julia.y.text } : null,
      limbs,
      maxiter: view.maxiter,
      // `null` for the ordinary walk; a period where this orbit wraps.
      period: period ?? null,
      points: reply.points,
      bytes: reply.orbit.byteLength,
      stamp: this.orbits,
      packed: reply.orbit,
      // The worker's own time inside `reference_orbit`, without the message hop.
      ms: reply.ms ?? null,
    };
    // The worker that computed it holds it already.
    slot.fed = this.orbit.stamp;
    return { x: this.orbit.x.text, y: this.orbit.y.text, kept: false };
  }

  /** Hand the held orbit to every worker that does not have it yet — the others after a
   *  new one is computed, and a restarted worker after a cancel. Resolves `false` where the
   *  generation moved on while it ran. */
  async #feedAll(generation) {
    const held = this.orbit;
    if (held === null) return generation === this.generation;
    const hungry = this.slots.filter((slot) => slot.fed !== held.stamp);
    const replies = await Promise.all(
      hungry.map((slot) => {
        const copy = held.packed.slice(0);
        return this.#send(slot, { kind: "orbit", orbit: copy }, { transfer: [copy] }).then(
          (reply) => {
            if (reply !== null) slot.fed = held.stamp;
            return reply;
          },
        );
      }),
    );
    return generation === this.generation && replies.every((reply) => reply !== null);
  }

  /**
   * Compute one deep field over the whole pool, and resolve with it.
   *
   * Resolves with `null` if a newer generation started while this one was running, as the
   * viewer's renderer does and for the same reason: a promise nobody settles holds its
   * whole `await` chain alive.
   */
  async field(
    view,
    width,
    height,
    {
      supersample = 1,
      period = null,
      interior = true,
      gpu = false,
      preview = null,
      of = null,
      have = null,
      onPartial = null,
      onProgress,
      onOrbit,
      onStep,
    } = {},
  ) {
    this.cancel();
    const generation = this.generation;
    // **A quarter of a grid's own samples** *(deep_wait_ckpt163)*, where the caller names the
    // grid as `of` and it is four times this field on each axis: drawn by `#quarter` under
    // the grid's spec and orbit, so everything below asks about the grid.
    const quartered =
      of !== null &&
      supersample === 1 &&
      of[0] === width * QUARTER_STRIDE &&
      of[1] === height * QUARTER_STRIDE;
    const [gridWidth, gridHeight] = quartered ? of : [width, height];

    // **Where the time before the bands went** *(deep_wait_ckpt163)*: the orbit (the
    // worker's own time and the wall from asking to holding it), feeding it to the pool, and
    // planning. Read by the Deep log alone, as `timing` on the `field landed` line.
    const began = performance.now();
    const timing = { orbitMs: null, orbitWallMs: 0, kept: false, feedMs: 0, planMs: 0 };
    this.timing = timing;
    // **Asked before the orbit, not after it.** A frame the kernel will refuse —
    // a Julia view too far from both its anchors for the width it is asking for —
    // should cost a sentence rather than a reference orbit, and the refusal is
    // the module's own words either way.
    const refusal = this.plan(deepSpecOf(view, gridWidth, gridHeight, { supersample, period }));
    if (!refusal.ok) throw new Error(refusal.why);

    const asked = performance.now();
    const reference = await this.#reference(view, gridWidth, gridHeight, supersample, period, {
      generation,
      onProgress: (done, total) => onStep?.({ phase: "orbit", done, total }),
    });
    if (generation !== this.generation) return null;
    if (reference === null) throw new Error("the kernel could not compute a reference orbit for this view");
    timing.orbitWallMs = performance.now() - asked;
    timing.kept = reference.kept;
    timing.orbitMs = reference.kept ? 0 : (this.orbit?.ms ?? null);
    onOrbit?.({ ...this.orbit, packed: undefined, kept: reference.kept });

    // A tile centred on its own nucleus names the period and **not** the reference: the
    // centre already is the reference, and naming it as well would put the same point in
    // the spec twice.
    const specAt = (switched) =>
      deepSpecOf(view, gridWidth, gridHeight, {
        supersample,
        period,
        reference: period === null ? reference : null,
        interior: switched,
      });
    const spec = specAt(interior);
    const shape = this.plan(spec);
    if (!shape.ok) throw new Error(shape.why);
    const feeding = performance.now();
    if (!(await this.#feedAll(generation))) return null;
    timing.feedMs = performance.now() - feeding;
    timing.planMs = feeding - began - timing.orbitWallMs;

    if (quartered) {
      // The quarter's own grid, for a quarter the GPU draws: a picture of its own, never
      // a seed of the CPU's full pass.
      const ownAt = (switched) =>
        deepSpecOf(view, width, height, {
          supersample,
          period,
          reference: period === null ? reference : null,
          interior: switched,
        });
      return this.#quarter(specAt, width, height, generation, {
        onProgress,
        gpu: gpu ? { ownAt, degree: view.degree ?? 2 } : null,
      });
    }

    // **The GPU, where the caller allows it and the device will take the frame**
    // *(gpu_deep_ship_ckpt162)*. It fills the same lanes and resolves the same object, so
    // nothing past this call knows which kernel drew it; `undefined` is a frame it would
    // not take, which the bands below then draw.
    if (gpu && this.gpu != null) {
      const drawn = await this.#gpuField(spec, shape, width, height, supersample, generation, {
        preview,
        onPartial,
        onProgress,
      });
      if (drawn !== undefined) return drawn;
      if (generation !== this.generation) return null;
    }

    // The quarter's samples, where it is a quarter of this grid: the CPU finishes the rest.
    if (seeds(have, width, height, supersample)) {
      return this.#complete(spec, have, width, height, generation, { onProgress });
    }

    const sampleWidth = width * supersample;
    const values = new Float64Array(sampleWidth * height * supersample);
    const bands = this.#cut(bandsOf(height, this.slots.length), supersample, true);

    return new Promise((resolve, reject) => {
      this.job = {
        generation,
        spec: JSON.stringify(spec),
        width,
        height,
        supersample,
        sampleWidth,
        values,
        rows: height,
        done: 0,
        onProgress,
        resolve,
        reject,
        started: performance.now(),
        ran: 0,
        saved: 0,
      };
      this.queue = bands;
      for (const slot of this.slots) this.#dispatch(slot, this.job);
    });
  }

  /**
   * The quarter pass as a quarter of the full grid's samples *(deep_wait_ckpt163)*: a census
   * of one quarter sample in sixteen drawn with the interior switch on, then the rest with
   * the switch the census chooses — the switch is a speed on the CPU and never a pixel, and
   * the quarter used to pay its price on every frame, 1.2x to 1.7x on the busy ones where
   * it never fires. Resolves the object the bands resolve, at the quarter's own size, with
   * `grid` (the full grid it is a quarter of) and `fullSwitch` (the switch the full pass
   * should run, chosen from counts drawn with it on, as it always was).
   */
  async #quarter(specAt, width, height, generation, { onProgress, gpu = null }) {
    const gridWidth = width * QUARTER_STRIDE;
    const gridHeight = height * QUARTER_STRIDE;
    const { census, rest } = quarterIndices(gridWidth, gridHeight);
    const total = census.length + rest.length;
    const started = performance.now();
    const scratch = new Float64Array(gridWidth * gridHeight);
    const first = await this.samples(specAt(true), census, scratch, {
      generation,
      onProgress: (_, __, done) => onProgress?.(done / total, performance.now() - started),
    });
    if (first === null) return null;
    // The whole frame's iterations, as the census counts them with the switch on.
    const frame =
      first.ran === null
        ? null
        : (first.ran * total * QUARTER_STRIDE * QUARTER_STRIDE) / census.length;
    const cheapLine = CHEAP_ITERATIONS_PER_WORKER * this.slots.length;
    const quarterSwitch =
      forcedSwitch() ??
      (frame === null || frame < SWITCH_KEPT_UNDER_CHEAP * cheapLine ? true : switchFor(first));
    // What the census counted, on whichever quarter this becomes: the full pass's switch
    // and, after a quarter the GPU drew, its cheap rule and the Download row's estimate.
    // **The full pass's switch is the census's alone**, so it is the same however the
    // quarter was drawn — on the GPU, on the CPU after the device refused, or held from
    // before the box was ticked.
    const counted = {
      ran: first.ran,
      saved: first.saved,
      count: census.length,
      elapsed: first.elapsed,
      iterations: frame,
      samples: gridWidth * gridHeight,
    };
    const fullSwitch = switchFor(first);

    // **The GPU's, where the census says it is worth it** *(deep_wait_ckpt163)*: decided by
    // the census's counts and the self-test's outcome, never by the clock, so a frame's
    // quarter goes the same way on every load. Its picture is the GPU's own grid, a
    // quarter the width, and its `ran` is `null` (the GPU's steps are not iterations), so
    // the full pass reads the census instead: the switch here, and the cheap rule, which
    // a frame the census put here is a hundred times over.
    if (
      gpu !== null &&
      this.gpu != null &&
      !this.gpu.off &&
      this.gpu.kernel !== "gpu" &&
      quarterOnGpu({ iterations: frame === null ? null : frame / (QUARTER_STRIDE * QUARTER_STRIDE), degree: gpu.degree, workers: this.slots.length })
    ) {
      const own = gpu.ownAt(quarterSwitch);
      const shape = this.plan(own);
      if (shape.ok) {
        const drawn = await this.#gpuField(own, shape, width, height, 1, generation, {
          preview: null,
          onPartial: null,
          // After the census's share of the bar, so it never runs backward.
          onProgress: (fraction) =>
            onProgress?.((census.length + fraction * rest.length) / total, performance.now() - started),
          estimate: { iterations: frame, frameSamples: gridWidth * gridHeight },
          stage: "quarter",
        });
        if (drawn === null) return null;
        if (drawn !== undefined) {
          return {
            ...drawn,
            elapsed: performance.now() - started,
            quarter: true,
            census: counted,
            quarterSwitch,
            fullSwitch,
          };
        }
        if (generation !== this.generation) return null;
      }
    }
    const second = await this.samples(specAt(quarterSwitch), rest, scratch, {
      generation,
      opening: chunkFor((first.elapsed * this.slots.length) / Math.max(1, census.length)),
      onProgress: (_, __, done) =>
        onProgress?.((census.length + done) / total, performance.now() - started),
    });
    if (second === null) return null;
    const values = new Float64Array(width * height);
    for (let r = 0; r < height; r++) {
      const row = (QUARTER_STRIDE * r + QUARTER_OFFSET) * gridWidth + QUARTER_OFFSET;
      for (let c = 0; c < width; c++) values[r * width + c] = scratch[row + QUARTER_STRIDE * c];
    }
    const ran = first.ran === null || second.ran === null ? null : first.ran + second.ran;
    const saved =
      first.saved === null || second.saved === null ? null : first.saved + second.saved;
    return {
      values,
      width,
      height,
      supersample: 1,
      elapsed: performance.now() - started,
      ran,
      saved,
      kernel: "cpu",
      handed: 0,
      grid: [gridWidth, gridHeight],
      quarter: true,
      census: counted,
      quarterSwitch,
      fullSwitch,
    };
  }

  /** The full pass finished from a quarter of its own samples *(deep_wait_ckpt163)*: the
   *  quarter's values put in place, and the other fifteen sixteenths drawn as a list. */
  async #complete(spec, have, width, height, generation, { onProgress }) {
    const values = new Float64Array(width * height);
    const rest = new Uint32Array(width * height - have.width * have.height);
    let k = 0;
    for (let r = 0; r < height; r++) {
      const kept = r % QUARTER_STRIDE === QUARTER_OFFSET;
      const from = ((r - QUARTER_OFFSET) / QUARTER_STRIDE) * have.width;
      for (let c = 0; c < width; c++) {
        const at = r * width + c;
        if (kept && c % QUARTER_STRIDE === QUARTER_OFFSET) {
          values[at] = have.values[from + (c - QUARTER_OFFSET) / QUARTER_STRIDE];
        } else {
          rest[k++] = at;
        }
      }
    }
    const got = await this.samples(spec, rest, values, {
      generation,
      opening: chunkFor((have.elapsed * this.slots.length) / (have.width * have.height)),
      onProgress: (fraction, elapsed) => onProgress?.(fraction, elapsed),
    });
    if (got === null) return null;
    return {
      values,
      width,
      height,
      supersample: 1,
      elapsed: got.elapsed,
      ran: have.ran === null || got.ran === null ? null : have.ran + got.ran,
      saved: have.saved === null || got.saved === null ? null : have.saved + got.saved,
      kernel: "cpu",
      handed: 0,
      // The samples this pass drew itself, for the Download row's estimate.
      computed: rest.length,
    };
  }

  /**
   * How finely to cut, given what a band is costing: bands of about `BAND_TARGET_MS`.
   *
   * `opening` is the first cut of a pass, which has no measurement of its own behind it —
   * and where nothing at all has been measured yet it is `OPENING_BAND_ROWS` rather than
   * the viewer's four-to-a-worker, for the reason that constant gives.
   */
  #cut(bands, supersample, opening = false) {
    if (this.rowCost === null) {
      return opening ? recut(bands, OPENING_BAND_ROWS, 1) : bands;
    }
    const perRow = this.rowCost * supersample * supersample;
    const rows = BAND_TARGET_MS / perRow;
    const widest = bands.reduce((most, [start, end]) => Math.max(most, end - start), 0);
    return rows * RECUT_OVER < widest ? recut(bands, rows, 1) : bands;
  }

  /** Give this worker the next band of the job, if there is one and the job is current. */
  #dispatch(slot, job) {
    if (job !== this.job || job.generation !== this.generation || this.queue.length === 0) return;
    if (slot.busy !== null) return;
    const [rowStart, rowEnd] = this.queue.shift();
    const span = rowEnd - rowStart;
    const at = performance.now();
    this.#send(slot, {
      kind: "band",
      spec: job.spec,
      rowStart,
      rowEnd,
      bytes: span * job.supersample * job.sampleWidth * 8,
    }).then((reply) => this.#collect(slot, reply, job, at, span));
  }

  #collect(slot, reply, job, at, span) {
    if (reply === null || job !== this.job || job.generation !== this.generation) return;
    const cost = (performance.now() - at) / (span * job.supersample * job.supersample);
    this.rowCost = this.rowCost === null ? cost : (this.rowCost + cost) / 2;
    this.queue = this.#cut(this.queue, job.supersample);
    if (reply.refused) {
      this.job = null;
      job.reject(new Error("the kernel refused this view"));
      return;
    }
    const rows = (reply.rowEnd - reply.rowStart) * job.supersample;
    job.values.set(
      new Float64Array(reply.band),
      reply.rowStart * job.supersample * job.sampleWidth,
    );
    job.done += reply.rowEnd - reply.rowStart;
    // Iterations, summed over the pass; one band without the pair makes the pass's `null`.
    job.ran = reply.ran === null || job.ran === null ? null : job.ran + reply.ran;
    job.saved = reply.saved === null || job.saved === null ? null : job.saved + reply.saved;
    if (job.onProgress) {
      job.onProgress(job.done / job.rows, performance.now() - job.started, rows);
    }
    if (job.done >= job.rows) {
      this.job = null;
      job.resolve({
        values: job.values,
        width: job.width,
        height: job.height,
        supersample: job.supersample,
        elapsed: performance.now() - job.started,
        ran: job.ran,
        saved: job.saved,
        kernel: "cpu",
        handed: 0,
      });
      return;
    }
    this.#dispatch(slot, job);
  }

  /**
   * A field drawn on the GPU *(gpu_deep_ship_ckpt162)*: `deep-gpu.js`'s passes, then the
   * samples it hands back finished here on the CPU by [`samples`], so every lane is either
   * the GPU kernel's or exactly the CPU kernel's. Resolves the object the bands resolve,
   * with `kernel: "gpu"`, `identity` (the device and guard form that drew it) and `handed`,
   * the samples the CPU finished; `null` where the generation moved; `undefined` where the
   * GPU would not take this frame at all, so the caller draws it with the bands.
   *
   * **A lost device never finishes the frame** *(deep_holes_ckpt163)*. The attempt it was
   * drawing is thrown away, its tail lists stopped from writing into it (`alive`: `samples`
   * cannot be cancelled, so a list already running finishes into a buffer nobody reads, and
   * the next attempt waits for it, since the pool takes one list at a time), and the frame
   * waits for the recovery's outcome (`refuses`, which waits on `ready`). A device that
   * recovered with the same identity resumes it at the strip it lost, keeping the strips
   * before; one of another identity draws it again from the start; and a GPU gone off
   * resolves `undefined`, so the bands draw the whole frame on the CPU. A pass's outcome
   * never depends on its budgets, so either way the frame is the one kernel's picture, and
   * the one an unbroken draw gives.
   *
   * `ran` and `saved` are `null`: the GPU's steps are not the CPU kernel's iterations,
   * and the one reader of the pair, the interior switch, reads it off the quarter's census,
   * which is always the CPU's.
   */
  async #gpuField(
    spec,
    shape,
    width,
    height,
    supersample,
    generation,
    { preview, onPartial, onProgress, estimate = null, stage = "full" },
  ) {
    const gpu = this.gpu;
    const orbit = orbitFor(this.orbit, shape.reference_bytes);
    const samples = shape.sample_width * shape.sample_height;
    const workers = this.slots.length;
    // The CPU's own estimate of the frame, which keeps a cheap one on the CPU: the census's,
    // for a quarter or for a full stage after a quarter the GPU drew; otherwise what the
    // quarter pass ran, scaled to this stage's samples.
    const census = estimate ?? (preview?.kernel === "gpu" ? (preview.census ?? null) : null);
    const iterations =
      census !== null
        ? estimate !== null
          ? census.iterations
          : census.iterations === null
            ? null
            : (census.iterations * samples) / census.samples
        : preview?.ran == null || !(preview.values?.length > 0)
          ? null
          : (preview.ran * samples) / preview.values.length;
    const live = () => generation === this.generation;
    const started = performance.now();
    // What the device finished, and what the CPU finished of what it was handed: the bar is
    // their sum, and never runs backward, a redraw after a loss included.
    let shown = 0;
    let onDevice = 0;
    // The attempt drawing the frame: its values, its tail, and whether it still counts.
    let attempt = null;
    // The last lost draw (`strip`, `rows`, `identity`), and how many there were.
    let lost = null;
    let losses = 0;
    const said = () => {
      const tail = attempt.tail;
      shown = Math.max(shown, Math.min(1, onDevice + (tail.done + tail.part) / samples));
      onProgress?.(shown, performance.now() - started, 0);
    };
    /** Stop an attempt's tail from writing, and wait for the list already running. */
    const abandon = async (gone) => {
      if (gone === null) return;
      gone.alive = false;
      await gone.tail.chain.catch(() => false);
    };
    const fresh = () => {
      const made = {
        values: new Float64Array(samples),
        alive: true,
        tail: { lists: 0, total: 0, done: 0, part: 0, ms: 0, ran: 0, failed: null, chain: Promise.resolve(true) },
      };
      const { tail, values } = made;
      // **A strip's tail is finished while the next strip runs** *(gpu_optin_downloads_ckpt162)*:
      // the pool is idle while the device draws, so each list the GPU hands over goes to it at
      // once, one list after another (`samples` takes one at a time).
      made.take = (indices) => {
        if (indices.length === 0) return;
        tail.lists += 1;
        tail.total += indices.length;
        tail.chain = tail.chain.then(async (going) => {
          if (!going || !live() || !made.alive) return false;
          const got = await this.samples(spec, indices, values, {
            generation,
            onProgress: (fraction) => {
              if (!made.alive) return;
              tail.part = fraction * indices.length;
              said();
            },
          });
          if (got === null || !made.alive) return false;
          tail.done += indices.length;
          tail.part = 0;
          tail.ms += got.elapsed;
          tail.ran = got.ran === null || tail.ran === null ? null : tail.ran + got.ran;
          said();
          return true;
        });
        // A list the kernel refused stops the device at its next check (`going`, below)
        // rather than one whole GPU run later, and is thrown once the draw has returned.
        tail.chain.catch((error) => {
          tail.failed ??= error;
        });
      };
      made.going = () => live() && made.alive && tail.failed === null;
      return made;
    };
    for (;;) {
      // A redraw after a loss asks again, which is what waits for the recovery's outcome.
      const refused = await gpu.refuses({
        samples,
        frameSamples: estimate?.frameSamples ?? samples,
        sampleWidth: shape.sample_width,
        degree: shape.degree,
        interior: shape.interior === true,
        orbitPoints: orbit === null ? 0 : new DataView(orbit.packed).getUint32(0, true),
        iterations,
        workers,
      });
      if (generation !== this.generation) {
        if (attempt !== null) attempt.alive = false;
        return null;
      }
      if (refused !== null || orbit === null) {
        await abandon(attempt);
        this.onGpu?.("cpu", { stage, why: refused ?? "no orbit", ...(losses > 0 ? { losses } : {}) });
        return undefined;
      }
      // **Resumed where the device that recovered is the one that was lost**, and otherwise
      // drawn from the start into a buffer of its own.
      // The identity rides along, and the draw checks it again at its turn (`#draw`).
      const resume = lost !== null && lost.identity !== null && lost.identity === gpu.identity && attempt !== null ? { strip: lost.strip, rows: lost.rows, identity: lost.identity } : null;
      if (resume === null) {
        await abandon(attempt);
        if (!live()) return null;
        attempt = fresh();
        onDevice = 0;
      }
      const { values, tail } = attempt;
      const drawn = await gpu.draw({
        plan: shape,
        orbit,
        values,
        preview,
        workers,
        resume,
        live: attempt.going,
        onPass: () => {
          this.heard = performance.now();
        },
        onProgress: (fraction) => {
          onDevice = fraction;
          said();
        },
        onHanded: attempt.take,
        onPartial:
          onPartial === null
            ? null
            : () => onPartial({ values, width, height, supersample, elapsed: performance.now() - started }),
      });
      if (tail.failed !== null) throw tail.failed;
      if (!live()) {
        attempt.alive = false;
        return null;
      }
      if (drawn.status === "cancelled") return null;
      if (drawn.status === "lost") {
        lost = drawn;
        // A resume the draw would not honour is no loss: the frame is drawn again afresh.
        if (drawn.stale) continue;
        losses += 1;
        this.onGpu?.("lost", { stage, strip: drawn.strip, losses, identity: drawn.identity });
        continue;
      }
      if (drawn.status === "unserved") {
        await abandon(attempt);
        this.onGpu?.("cpu", { stage, why: drawn.why ?? drawn.status, ...(losses > 0 ? { losses } : {}) });
        return undefined;
      }
      attempt.take(drawn.handed);
      // What the device settled is everything the CPU was not given.
      onDevice = (samples - tail.total) / samples;
      const finished = await tail.chain;
      if (!finished || !live()) return null;
      this.onGpu?.("gpu", {
        stage,
        handed: tail.total,
        losses,
        identity: drawn.identity,
        ms: performance.now() - started,
        // The CPU's time over the handed samples, summed over the lists; with strips, most
        // of it ran beside the device's.
        tailMs: tail.ms,
        tailRan: tail.ran,
        strips: gpu.last?.strips ?? 1,
        // Of `handed`, the samples the interior proof gave up on; the rest are the tail's.
        gated: gpu.last?.gated ?? null,
        compileWaitMs: gpu.last?.compileWaitMs ?? null,
        // Passes and dispatches, and the longest of each on the device (`passStats`).
        passes: drawn.passes ?? null,
      });
      return {
        values,
        width,
        height,
        supersample,
        elapsed: performance.now() - started,
        ran: null,
        saved: null,
        kernel: "gpu",
        identity: drawn.identity ?? null,
        handed: tail.total,
        // Never true while the loop above stands: a field a loss mixed would say so, and the
        // page would neither keep it nor hold it (`deep.js`'s `remember` and `hold`).
        ...(drawn.status === "lost" ? { lost: true } : {}),
      };
    }
  }

  /**
   * Finish a list of samples of a field on the CPU, over the pool, and write each into
   * `values` at its own index *(gpu_deep_ship_ckpt162)*.
   *
   * `spec` is the frame's spec exactly as [`field`] builds it for its bands (an object, or
   * the JSON text of one); `indices` a `Uint32Array` of global sample indices,
   * `row · sampleWidth + col`, in the supersampled grid; `values` the field's
   * `Float64Array`, which every listed index of is overwritten and nothing else of is
   * touched. Each value is bit for bit the one a band covering that sample computes
   * (`compute_samples`), so a field finished this way is the CPU's field at every listed
   * sample.
   *
   * **It does not cancel**, unlike [`field`]: it is the second half of a field already in
   * progress, and runs under that field's `generation` (the current one by default).
   * Resolves `{ count, elapsed, ran, saved }` — `ran` and `saved` summed over the list,
   * `null` where a module older than the pair answered — or `null` where the generation
   * moved on, as everything here does; rejects where the kernel refused the list.
   * `onProgress(fraction, elapsedMs, samplesDone)` is called as chunks land.
   */
  async samples(
    spec,
    indices,
    values,
    { generation = this.generation, onProgress, opening: chunk = OPENING_SAMPLES } = {},
  ) {
    if (generation !== this.generation) return null;
    const count = indices.length;
    if (count === 0) return { count: 0, elapsed: 0, ran: 0, saved: 0 };
    if (this.job !== null) throw new Error("a deep sample list was asked for while a pass ran");
    if (!(await this.#feedAll(generation))) return null;
    // A cut to four chunks a worker, and never coarser than the opening cap: `recut` is the
    // band cutter, and a range of list positions is a range like any other.
    const spread = Math.ceil(count / (4 * this.slots.length));
    const floor = Math.max(1, Math.min(LIST_FLOOR, spread));
    const opening = Math.max(floor, Math.min(chunk, spread));
    const chunks = recut([[0, count]], opening, floor);
    return new Promise((resolve, reject) => {
      this.job = {
        kind: "samples",
        generation,
        spec: typeof spec === "string" ? spec : JSON.stringify(spec),
        indices,
        values,
        count,
        done: 0,
        sampleCost: null,
        onProgress,
        resolve,
        reject,
        started: performance.now(),
        ran: 0,
        saved: 0,
        floor,
      };
      this.queue = chunks;
      for (const slot of this.slots) this.#dispatchSamples(slot, this.job);
    });
  }

  /** Give this worker the next chunk of the sample list, if there is one and the job is
   *  current: [`#dispatch`] for a list. */
  #dispatchSamples(slot, job) {
    if (job !== this.job || job.generation !== this.generation || this.queue.length === 0) return;
    if (slot.busy !== null) return;
    const [start, end] = this.queue.shift();
    // A copy, so the caller's list is never detached by the transfer.
    const list = job.indices.slice(start, end);
    const at = performance.now();
    this.#send(
      slot,
      { kind: "samples", spec: job.spec, indices: list.buffer },
      { transfer: [list.buffer] },
    ).then((reply) => this.#collectSamples(slot, reply, job, at, start, end));
  }

  #collectSamples(slot, reply, job, at, start, end) {
    if (reply === null || job !== this.job || job.generation !== this.generation) return;
    if (reply.refused) {
      this.job = null;
      this.queue = [];
      job.reject(new Error("the kernel refused this list of samples"));
      return;
    }
    const span = end - start;
    // Re-cut what is queued toward `BAND_TARGET_MS` from this list's own cost a sample.
    const cost = (performance.now() - at) / span;
    job.sampleCost = job.sampleCost === null ? cost : (job.sampleCost + cost) / 2;
    const target = BAND_TARGET_MS / job.sampleCost;
    const widest = this.queue.reduce((most, [a, b]) => Math.max(most, b - a), 0);
    if (target * RECUT_OVER < widest) this.queue = recut(this.queue, target, job.floor);
    const out = new Float64Array(reply.values);
    for (let k = 0; k < span; k++) job.values[job.indices[start + k]] = out[k];
    job.done += span;
    job.ran = reply.ran === null || job.ran === null ? null : job.ran + reply.ran;
    job.saved = reply.saved === null || job.saved === null ? null : job.saved + reply.saved;
    job.onProgress?.(job.done / job.count, performance.now() - job.started, job.done);
    if (job.done >= job.count) {
      this.job = null;
      job.resolve({
        count: job.count,
        elapsed: performance.now() - job.started,
        ran: job.ran,
        saved: job.saved,
      });
      return;
    }
    this.#dispatchSamples(slot, job);
  }

  /**
   * Colour a deep field through `engine.wasm`, in the page's own kept shade worker.
   *
   * The field is handed over and its buffer detached, exactly as the viewer's final stage
   * hands one over — so a caller keeping the field for a recolour passes a copy, and the
   * arithmetic of what that costs is in `deep.js` where the cache is.
   */
  shade(field, view, holder = {}, { derive = false } = {}) {
    return this.shading.shade(field, view, holder, {
      derive,
      spec: shadeSpecOf(view, stopsOf(view.palette), field.width, field.height, {
        supersample: field.supersample,
        level: !derive,
      }),
    });
  }
}

/** The imports the page's own instance is given: `env.progress` is the module's one import
 *  (`perturb-wasm/src/progress.rs`), and the planner never makes a call long enough to
 *  have anything to report. */
const PLANNER_IMPORTS = { env: { progress() {} } };

/** The smallest module that holds a wasm SIMD instruction: one function returning
 *  `i8x16.splat(0)`. An engine that validates it runs `perturb.wasm`. */
const SIMD_PROBE = new Uint8Array([
  0, 97, 115, 109, 1, 0, 0, 0, // "\0asm", version 1
  1, 5, 1, 96, 0, 1, 123, // types: () -> v128
  3, 2, 1, 0, // functions: one, of type 0
  10, 8, 1, 6, 0, 65, 0, 253, 15, 11, // code: i32.const 0, i8x16.splat, end
]);

/** Whether this engine runs wasm SIMD, asked once. */
let simd = null;
export function simdSupported() {
  simd ??= (() => {
    try {
      return WebAssembly.validate(SIMD_PROBE);
    } catch {
      return false;
    }
  })();
  return simd;
}

/** **Which perturbation module this engine fetches** *(deep_wait_ckpt163)*.
 *  `perturb.wasm` draws two samples a vector with wasm SIMD, and an engine without SIMD
 *  refuses the whole module, so where the probe does not validate (Safari 15.4 to 16.3)
 *  the page fetches `perturb-scalar.wasm`, the same crate built without it: slower, and the
 *  same bits (`bench/perturb-parity.mjs`). `simd` is there to force the fallback. */
export function perturbModuleUrl(simd = simdSupported()) {
  return new URL(simd ? "./perturb.wasm" : "./perturb-scalar.wasm", import.meta.url);
}

/** The perturbation module, compiled once a page: the pool and New coloring's rule share
 *  the fetch. A failure is forgotten, so a later press asks again. */
let compiling = null;

function compiled(url = perturbModuleUrl()) {
  compiling ??= (async () => {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${url}: ${response.status} ${response.statusText}`);
    return WebAssembly.compile(await response.arrayBuffer());
  })().catch((error) => {
    compiling = null;
    throw error;
  });
  return compiling;
}

/** A worker of its own for New coloring, started the first time the rule is asked: the
 *  shallow view asks it without starting the Deep tab's pool, and the rule's six passes over
 *  every sample, half a second at 1136×639, stay off the page's thread. One request at a time
 *  in flight is not assumed: replies are matched by id. */
let colorer = null;
let colourings = 0;
const colouringsPending = new Map();

function colouringWorker() {
  colorer ??= compiled()
    .then(spawn)
    .then((worker) => {
      worker.onmessage = (event) => {
        const settle = colouringsPending.get(event.data.id);
        if (settle === undefined || event.data.kind !== "coloring") return;
        colouringsPending.delete(event.data.id);
        settle(event.data.rule);
      };
      return worker;
    })
    .catch((error) => {
      colorer = null;
      throw error;
    });
  return colorer;
}

/**
 * **New coloring's rule** *(deep_dive_block_ckpt154)*: `perturb-wasm`'s `coloring_rule`
 * over lane 0 of `field` — the cycles `cyclesPick` draws, the λ smoothness test at that many
 * turns across the field's 3rd to 97th percentile of `g`, and the acceptable λ `pick`
 * chooses, both picks uniform in `[0, 1)`. Either tab's field: a deep one is one lane, and a
 * shallow one's lane 0 is its base field, the value the absolute scale compresses. The field
 * is copied, never taken. Resolves the module's answer, `{ ok, cycles, lambda, period,
 * roughness, tried }` or `{ ok: false, why }`.
 */
/** The colouring worker given back, where it was ever started: the page's `pagehide`. */
export function stopColoring() {
  colorer?.then((worker) => worker.terminate(), () => {});
  colorer = null;
  for (const settle of colouringsPending.values()) settle({ ok: false, why: "the page is going" });
  colouringsPending.clear();
}

export async function coloringRule(field, cyclesPick, pick) {
  const worker = await colouringWorker();
  const ss = field.supersample ?? 1;
  const width = field.width * ss;
  const height = field.height * ss;
  const count = Math.min(field.values.length, width * height);
  const values = Float64Array.from(field.values.subarray(0, count));
  const id = ++colourings;
  return new Promise((resolve) => {
    colouringsPending.set(id, resolve);
    worker.postMessage(
      { kind: "coloring", id, values: values.buffer, count, width, height, cyclesPick, pick },
      [values.buffer],
    );
  });
}
