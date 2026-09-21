// Exact decimal arithmetic for the Deep tab's coordinates.
//
// **The centre of a deep view is a decimal, and it stays one for the whole life of the
// tab.** Below about 1e-16 an `f64` no longer tells two neighbouring coordinates apart,
// so a centre that made one round trip through a double would come back as a different
// place — and it would look entirely plausible, because the digits a double drops are
// exactly the ones that say where the view is. Nothing here narrows: a centre is parsed
// from text into `BigInt` and stays there, every pan and zoom is an exact addition, and
// the text a link carries is the text this module writes back.
//
// A number is `{ units, scale }` meaning `units × 10⁻ˢᶜᵃˡᵉ`, with `units` a `BigInt` and
// `scale` a non-negative integer. That is the whole representation: decimal rather than
// binary because the thing being held is a decimal *string* — what a link carries, what a
// reader pastes, and what `perturb.wasm`'s `Fx::parse` reads on the other side of the
// boundary. A binary fixed point would have to round on the way in and on the way out,
// twice per link, for nothing.
//
// **What an increment is.** A pan or a zoom is measured off the canvas in `f64`: a
// fraction of the view's width, and the width is an `f64`. So the increment arrives as a
// double, and [`fromNumber`] turns it into the shortest decimal that reads back as that
// double. That decimal is then added exactly. The centre therefore never rounds — it
// accumulates exact decimals — while the *size* of each step is an `f64`'s worth of
// precision about a quantity that is itself an `f64`. That is the honest seam, and it is
// here rather than hidden: a step is a double, a place is a decimal.
//
// Nothing here touches the DOM or the module, so `deep-fx.test.mjs` runs it under node's
// own runner with nothing installed.

/** The most fraction digits a coordinate is allowed to carry.
 *
 *  A guard against unbounded growth rather than a precision limit. Each increment's scale
 *  is about seventeen digits past the view's own width, so the digit count is bounded by
 *  how deep the reader has gone and grows by decades, not by gestures — but a number with
 *  no ceiling at all is a number that can be made to cost `BigInt` time by scrolling, and
 *  a coordinate this long is already far past what the link's 64 characters can carry. */
export const MAX_SCALE = 120;

const DIGITS = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

/** Ten to the `n`, as a `BigInt`. Memoized, because a rescale asks for the same few. */
const powers = [1n];
function pow10(n) {
  while (powers.length <= n) powers.push(powers[powers.length - 1] * 10n);
  return powers[n];
}

/** A decimal from its parts, with trailing zero digits taken off.
 *
 *  Trimming is what keeps a scale from ratcheting: an addition takes the larger of two
 *  scales, so a step whose decimal happens to end in zeros would otherwise leave the
 *  centre carrying them forever. It never changes the value. */
export function make(units, scale) {
  let u = units;
  let s = scale;
  while (s > 0 && u % 10n === 0n) {
    u /= 10n;
    s -= 1;
  }
  if (u === 0n) s = 0;
  return { units: u, scale: s };
}

/** Zero. */
export const ZERO = make(0n, 0);

/** Why [`parse`] refused, where it did. */
export const NOT_A_NUMBER = "not a number";
export const TOO_LONG = "longer than this module carries";

/**
 * A decimal string as an exact decimal, or `null` where it is not one.
 *
 * Accepts what the permalink's coordinate reader accepts — a sign, digits, a point, and
 * an exponent — so a string that parses as a shallow coordinate parses here too, and
 * means the same number to the last digit rather than to the last double.
 *
 * **Two different things are refused here and [`refusal`] is how a caller tells them
 * apart.** A string that is not a decimal is somebody's input; a decimal past
 * [`MAX_SCALE`] is this module's own ceiling, and a caller that meets one has usually
 * handed over a number it was supposed to trim. That distinction cost an hour once:
 * `perturb.wasm` answers a Newton solve with the full ~190 digits of what it stored, by
 * design, and until `deep_nearby_minibrots_ckpt138` the page fed that straight back in
 * here — every solve came back `null`, every nucleus was dropped as unconverged, and the
 * list said "No minibrot was found in this view" with a clean console.
 */
export function parse(text) {
  return read(text);
}

/**
 * `null` where the text parses, and which of the two refusals it is otherwise.
 *
 * Separate from [`parse`] rather than a second return value, because every caller that
 * only wants the number should keep reading like one — and the caller that has to tell a
 * reader something is the exception.
 */
export function refusal(text) {
  if (typeof text !== "string") return NOT_A_NUMBER;
  const trimmed = text.trim();
  if (trimmed === "" || !DIGITS.test(trimmed)) return NOT_A_NUMBER;
  return read(text) === null ? TOO_LONG : null;
}

/** The reading itself, which both of the above are a view of. */
function read(text) {
  if (typeof text !== "string") return null;
  const trimmed = text.trim();
  if (trimmed === "" || !DIGITS.test(trimmed)) return null;

  const negative = trimmed.startsWith("-");
  let body = trimmed.replace(/^[+-]/, "");
  let exponent = 0;
  const at = body.search(/[eE]/);
  if (at >= 0) {
    exponent = Number(body.slice(at + 1));
    body = body.slice(0, at);
  }
  const point = body.indexOf(".");
  let fraction = 0;
  if (point >= 0) {
    fraction = body.length - point - 1;
    body = body.slice(0, point) + body.slice(point + 1);
  }
  if (body === "") return null;
  // `scale` is how many digits sit after the point once the exponent has been spent.
  const scale = fraction - exponent;
  let units = BigInt(body);
  if (negative) units = -units;
  if (scale < 0) return make(units * pow10(-scale), 0);
  if (scale > MAX_SCALE) return null;
  return make(units, scale);
}

/** The two at one scale, as `[unitsA, unitsB, scale]`. */
function align(a, b) {
  if (a.scale === b.scale) return [a.units, b.units, a.scale];
  if (a.scale > b.scale) return [a.units, b.units * pow10(a.scale - b.scale), a.scale];
  return [a.units * pow10(b.scale - a.scale), b.units, b.scale];
}

export function add(a, b) {
  const [x, y, scale] = align(a, b);
  return make(x + y, scale);
}

export function sub(a, b) {
  const [x, y, scale] = align(a, b);
  return make(x - y, scale);
}

export function compare(a, b) {
  const [x, y] = align(a, b);
  return x < y ? -1 : x > y ? 1 : 0;
}

export function isZero(value) {
  return value.units === 0n;
}

/**
 * A double as the exact decimal of its shortest round-trip spelling.
 *
 * `String(value)` is that spelling by definition of JavaScript's number formatting, so
 * this is a renaming rather than an algorithm — but it is worth a name, because it is the
 * one place a double becomes a coordinate and the whole tab's claim rests on it happening
 * here and nowhere else.
 */
export function fromNumber(value) {
  if (!Number.isFinite(value)) return null;
  return parse(String(value));
}

/**
 * The decimal as a plain decimal string — never an exponent.
 *
 * A deep centre is within a few units of the origin and what makes it deep is its
 * fraction, so `-0.7450177282853233584294189` is the spelling a reader can compare
 * against another one. An exponent form would be shorter only for a coordinate that is
 * essentially zero, and it would put the two spellings of one place in circulation.
 */
export function text(value) {
  const negative = value.units < 0n;
  const digits = (negative ? -value.units : value.units).toString();
  let body;
  if (value.scale === 0) {
    body = digits;
  } else if (digits.length > value.scale) {
    body = `${digits.slice(0, digits.length - value.scale)}.${digits.slice(digits.length - value.scale)}`;
  } else {
    body = `0.${"0".repeat(value.scale - digits.length)}${digits}`;
  }
  return negative ? `-${body}` : body;
}

/**
 * The decimal as a double, for the things that are allowed to be approximate.
 *
 * The frame's own geometry, the reference's reach, a readout — never the centre a link
 * carries and never anything handed to the kernel as a coordinate. `Number` of the text
 * is correctly rounded, which is the best a double can do with it.
 */
export function toNumber(value) {
  return Number(text(value));
}

/** How many digits of fraction the coordinate carries: what decides whether it still fits
 *  in a link, and how much `BigInt` work an addition is. */
export function scaleOf(value) {
  return value.scale;
}

/**
 * `a − b` as a double, taken exactly first.
 *
 * The difference of two deep coordinates is small where their leading digits agree, which
 * is exactly when `toNumber(a) - toNumber(b)` is zero and wrong. Subtracting in decimal
 * and narrowing the answer is the same fix `perturb.wasm`'s `centre_offset` makes on its
 * side of the boundary, for the same reason.
 */
export function difference(a, b) {
  return toNumber(sub(a, b));
}
