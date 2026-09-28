// New coloring's aliasing guard *(dive_mixture_ckpt154)*.
//
// **A period the picture cannot show reads as static.** New coloring sizes its period to the
// spread of the field's values, and the λ smoothness test asks whether neighbouring samples
// sit within a quarter turn of each other. Deep in a minibrot's neighbourhood that is not
// enough: the escape counts beside a copy change by more than a whole period from one pixel
// to the next over much of the frame, every λ fails the test, the smoothest is taken anyway,
// and the palette comes out as noise. So once the rule has answered, the colouring it chose is
// laid over the quarter pass's field here, **the mean colour difference between neighbouring
// pixels** is measured, and where it is over `THRESHOLD` the period is lengthened `STRETCH`
// times and measured again, `TRIES` times at most.
//
// The colour is the absolute scale's own placement — `frac(g / period + phase)`, `g` the
// engine's Box–Cox of the value (`hold.js`'s `colourAt`), a mirrored map folded the way the
// engine folds one — looked up in the map's stops. It is interpolated in sRGB where the engine
// works in OKLab, which moves a colour between two stops a little and moves the measure less:
// it is a question about how far apart neighbours are, not about what they are.
//
// Nothing here touches the page. `aliasing.test.mjs` holds it.

import { colourAt } from "./hold.js";

/**
 * **The mean colour difference, in 8-bit levels averaged over red, green and blue, above
 * which a colouring reads as static.** Chosen on real deep frames — the dive candidates'
 * landings and the reported case — measured on their quarter passes: `explorer/README.md`'s
 * *New coloring* has the reading it was taken from.
 */
export const THRESHOLD = 35;

/** How much longer the period is made at each try. */
export const STRETCH = 2;

/** How many times the period is lengthened at most. A colouring still over the line after
 *  these is kept at the longest, which is the smoothest the rule's own λ can do. */
export const TRIES = 3;

/**
 * **The measure is taken at the quarter pass's spacing**, whatever field it is handed: the
 * Deep tab's quarter pass of a 1136-wide canvas is 284 across, and a field wider than this
 * is read at every `k`-th pixel so that neighbours stand about as far apart in the plane as a
 * quarter pass's do. New coloring's button colours whichever pass is up, and a full pass
 * read pixel by pixel would measure a finer picture than the one this threshold was set on.
 */
export const MEASURE_WIDTH = 400;

/** How finely a map is looked up: a table of this many colours across the gradient. */
const TABLE = 1024;

/** A map's `{ stops }` (`stops.js`'s `stopsOf`) as a table of `TABLE` colours, folded where
 *  `mirror` asks: the first half forward, the second back. */
export function tableOf(map, mirror = false) {
  const stops = [...map.stops].sort((a, b) => a[0] - b[0]);
  const table = new Float32Array(TABLE * 3);
  let at = 0;
  for (let index = 0; index < TABLE; index += 1) {
    let t = index / (TABLE - 1);
    if (mirror) t = t < 0.5 ? 2 * t : 2 - 2 * t;
    while (at < stops.length - 2 && stops[at + 1][0] < t) at += 1;
    while (at > 0 && stops[at][0] > t) at -= 1;
    const [p0, c0] = stops[at];
    const [p1, c1] = stops[Math.min(at + 1, stops.length - 1)];
    const u = p1 > p0 ? Math.min(1, Math.max(0, (t - p0) / (p1 - p0))) : 0;
    for (let channel = 0; channel < 3; channel += 1) {
      table[index * 3 + channel] = c0[channel] + (c1[channel] - c0[channel]) * u;
    }
  }
  return table;
}

/**
 * The mean colour difference between neighbouring pixels of `field` coloured by `shade`
 * (`{ lambda, period, phase }`) through `table`, or `null` where fewer than a hundred pairs of
 * neighbours are both outside the set.
 *
 * `field` is either tab's — `{ values, width, height, supersample }`, lane 0 read as the
 * `width·ss × height·ss` grid, `NaN` inside the set. A pixel's colour is the mean of its
 * samples' where every one of them escaped, and a pixel with any sample inside is skipped,
 * with the pairs it is in.
 */
export function roughness(field, shade, table) {
  if (field == null || !field.values) return null;
  const ss = field.supersample ?? 1;
  const across = field.width * ss;
  const step = Math.max(1, Math.ceil(field.width / MEASURE_WIDTH));
  const columns = Math.floor((field.width - 1) / step) + 1;
  const rows = Math.floor((field.height - 1) / step) + 1;
  const colours = new Float32Array(columns * rows * 3).fill(Number.NaN);
  const recipe = { lambda: shade.lambda, period: shade.period, phase: shade.phase ?? 0 };
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      let inside = false;
      for (let sy = 0; sy < ss && !inside; sy += 1) {
        const line = (row * step * ss + sy) * across + column * step * ss;
        for (let sx = 0; sx < ss; sx += 1) {
          const value = field.values[line + sx];
          if (!Number.isFinite(value)) {
            inside = true;
            break;
          }
          const at = Math.min(TABLE - 1, Math.floor(colourAt(value, recipe) * TABLE)) * 3;
          r += table[at];
          g += table[at + 1];
          b += table[at + 2];
        }
      }
      if (inside) continue;
      const cell = (row * columns + column) * 3;
      const samples = ss * ss;
      colours[cell] = r / samples;
      colours[cell + 1] = g / samples;
      colours[cell + 2] = b / samples;
    }
  }
  let pairs = 0;
  let sum = 0;
  const apart = (a, b) =>
    (Math.abs(colours[a] - colours[b]) +
      Math.abs(colours[a + 1] - colours[b + 1]) +
      Math.abs(colours[a + 2] - colours[b + 2])) /
    3;
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const here = (row * columns + column) * 3;
      if (Number.isNaN(colours[here])) continue;
      if (column + 1 < columns && !Number.isNaN(colours[here + 3])) {
        sum += apart(here, here + 3);
        pairs += 1;
      }
      const below = here + columns * 3;
      if (row + 1 < rows && !Number.isNaN(colours[below])) {
        sum += apart(here, below);
        pairs += 1;
      }
    }
  }
  return pairs < 100 ? null : sum / pairs;
}

/** A period as a link writes New coloring's: three significant figures. */
function figures3(value) {
  return Number(value.toPrecision(3));
}

/**
 * **The guard**: `shade` with its period lengthened until `field` coloured by it measures at
 * or under `THRESHOLD`, `TRIES` times at most. Answers `{ period, redraws, before, after }` —
 * `period` the one to use, `redraws` how many times it was lengthened, and the measure before
 * and after. `before` is `null`, and nothing moves, where the field has too little outside the
 * set to measure.
 */
export function guard(field, shade, table) {
  const before = roughness(field, shade, table);
  let period = shade.period;
  let after = before;
  let redraws = 0;
  while (after !== null && after > THRESHOLD && redraws < TRIES) {
    period = figures3(period * STRETCH);
    redraws += 1;
    after = roughness(field, { ...shade, period }, table);
  }
  return { period, redraws, before, after };
}
