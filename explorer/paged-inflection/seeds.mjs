// Which `c` has no interior, decided by the critical orbit rather than by a list.
//
// **Paged**, and kept out of `scratch/` for the one reason this file is worth keeping: it
// is the test, not the answer. This is how the second sheet's seeds were chosen, and the
// eight that turned out well are written into `inflect.js`'s `SEEDS` by hand afterwards.
// `README.md` beside it says what paged means and how to put the tab back.
//
// **The rule the first sheet got wrong.** I was told solid nodes sculpt best, and that is
// true of real deep-zoom morphing and false here: a filled node inflects to a black disc,
// because the pre-map sends a disc of interior two-to-one onto a disc of interior. What
// sculpts is a Julia set with **no interior at all**, and that is a property of `c` that
// can be decided:
//
//   - iterate `z ← z² + c` from the critical point `z₀ = 0`;
//   - if it escapes, `c` is outside the Mandelbrot set and the Julia set is a Cantor dust
//     — no interior, and the later it escapes the more the dust still looks like the
//     connected set next door;
//   - if it stays bounded and settles onto an attracting cycle, the Fatou set has an
//     interior basin and the Julia set is filled — reject;
//   - if it stays bounded and settles onto nothing, `c` is a Misiurewicz point (or on the
//     boundary): the Julia set is a dendrite, connected and interior-free — the best case.
//
// The cycle test is the only fiddly part. An attracting cycle of period `p` pulls the
// orbit in geometrically, so after a long settling run `|z_{n+p} − z_n|` is tiny for that
// `p` and not for others. A Misiurewicz orbit lands exactly on a repelling cycle, which
// pushes away, so no `p` gets small — the orbit stays on the cycle but a float does not,
// and the distance grows. That is the whole discriminator.

const CAP = 20000;
const SETTLE = 3000;
const BAILOUT = 4.0;
const PERIODS = 64;

/**
 * Whether the Julia set of `c` has interior, decided by the **multiplier** of the cycle
 * the critical orbit settles on.
 *
 * **Closing a cycle is not the test, and that is the correction.** The first version asked
 * whether `z_{n+p}` came back to `z_n`, and called `c = i` — the classic dendrite — a
 * filled set of period 2. It is period 2: the critical orbit of `i` is
 * `0 → i → −1+i → −i → −1+i → …`, landing *exactly* on a 2-cycle. What matters is that the
 * cycle **repels**: nothing else is attracted to it, there is no basin, and the Julia set
 * is a dendrite with no interior at all. An attracting cycle has a basin, and that basin
 * is the interior.
 *
 * So the discriminator is `|λ|`, the derivative of `f^p` around the cycle, which is the
 * product of `2z` over its points. Under one, the cycle attracts and the set is filled.
 * Over one, it repels and the set is interior-free. Exactly one is parabolic — the cusps,
 * `c = 0.25` and `c = −0.75` — which **does** have a basin, so it goes with the filled.
 *
 * In floating point a Misiurewicz orbit does not stay on its repelling cycle: the error
 * is multiplied by `|λ|` every step and reaches order one after a few dozen of them, so
 * the orbit escapes. That reads here as `outside`, and it does not matter which name it
 * gets — both answers are interior-free, which is the only question being asked.
 */
export function classify(cre, cim) {
  let zr = 0;
  let zi = 0;
  for (let n = 1; n <= SETTLE; n += 1) {
    const nr = zr * zr - zi * zi + cre;
    zi = 2 * zr * zi + cim;
    zr = nr;
    if (zr * zr + zi * zi > BAILOUT * BAILOUT) {
      return { kind: "outside", interior: false, escape: n };
    }
  }
  const tail = [];
  for (let n = 0; n < PERIODS * 3; n += 1) {
    const nr = zr * zr - zi * zi + cre;
    zi = 2 * zr * zi + cim;
    zr = nr;
    if (zr * zr + zi * zi > BAILOUT * BAILOUT) {
      return { kind: "outside", interior: false, escape: SETTLE + n };
    }
    tail.push([zr, zi]);
  }
  let best = { period: null, gap: Infinity };
  for (let period = 1; period <= PERIODS; period += 1) {
    let worst = 0;
    for (let at = 0; at + period < tail.length; at += 1) {
      const d = Math.hypot(tail[at + period][0] - tail[at][0], tail[at + period][1] - tail[at][1]);
      if (d > worst) worst = d;
    }
    if (worst < best.gap) best = { period, gap: worst };
  }
  if (best.gap > 1e-9) {
    // **A parabolic cycle converges like 1/n, not geometrically**, so three thousand
    // iterations leave it a long way short of closing and the multiplier below is never
    // reached. A cusp — `c = 0.25`, `c = −0.75` — lands here with a gap of 1e-7 to 1e-5,
    // while a genuinely wandering critical orbit sits at 0.1 and up. So a small gap that
    // did not close is read as parabolic, and parabolic has a basin and so has interior.
    //
    // The case this gets wrong is a **Siegel** parameter, whose orbit wanders on an
    // invariant curve and so reads as interior-free although its disc is interior. Those
    // are a measure-zero set on the boundary and nothing here lands on one by accident.
    if (best.gap < 1e-4) return { kind: "parabolic", interior: true, gap: best.gap };
    return { kind: "wandering", interior: false, gap: best.gap };
  }
  // The multiplier around the closed cycle: ∏ 2z over its points.
  let lr = 1;
  let li = 0;
  for (let at = 0; at < best.period; at += 1) {
    const [pr, pi] = tail[at];
    const nr = lr * 2 * pr - li * 2 * pi;
    li = lr * 2 * pi + li * 2 * pr;
    lr = nr;
  }
  const lambda = Math.hypot(lr, li);
  if (lambda < 1 - 1e-9) {
    return { kind: "filled", interior: true, period: best.period, lambda };
  }
  if (lambda < 1 + 1e-9) {
    // Parabolic: a cusp. There is a basin, so there is interior.
    return { kind: "parabolic", interior: true, period: best.period, lambda };
  }
  return { kind: "dendrite", interior: false, period: best.period, lambda };
}

/**
 * A Misiurewicz point near `(cre, cim)`, by Newton on `f^(k+n)(0) = f^k(0)`.
 *
 * The critical orbit of a Misiurewicz point is strictly preperiodic: it walks for `k`
 * steps and then lands exactly on a repelling cycle of period `n`. Solving that equation
 * gives the exact parameter, and exact is worth having — a dendrite is the sharpest thing
 * to sculpt and a `c` a whisker off one has a tiny interior that inflects to a blot.
 *
 * The derivative is carried alongside the orbit by the chain rule, which is the standard
 * way and costs one complex multiply-add a step.
 */
export function misiurewicz(cre, cim, preperiod, period, steps = 60) {
  let c = [cre, cim];
  const mul = (a, b) => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]];
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
  const div = (a, b) => {
    const d = b[0] * b[0] + b[1] * b[1];
    return [(a[0] * b[0] + a[1] * b[1]) / d, (a[1] * b[0] - a[0] * b[1]) / d];
  };
  for (let step = 0; step < steps; step += 1) {
    let z = [0, 0];
    let dz = [0, 0];
    let zk = null;
    let dzk = null;
    for (let n = 1; n <= preperiod + period; n += 1) {
      // z ← z² + c, and dz/dc ← 2 z dz + 1
      dz = [2 * (z[0] * dz[0] - z[1] * dz[1]) + 1, 2 * (z[0] * dz[1] + z[1] * dz[0])];
      z = [z[0] * z[0] - z[1] * z[1] + c[0], 2 * z[0] * z[1] + c[1]];
      if (n === preperiod) {
        zk = z;
        dzk = dz;
      }
    }
    const f = sub(z, zk);
    const df = sub(dz, dzk);
    if (Math.hypot(df[0], df[1]) < 1e-300) break;
    const delta = div(f, df);
    c = sub(c, delta);
    if (Math.hypot(delta[0], delta[1]) < 1e-15) break;
  }
  void mul;
  return c;
}

/** Step outward from `(cre, cim)` along `angle` until the critical orbit escapes at a
 *  count inside `[low, high]`: just outside the set, where the dust is still dense enough
 *  to read as the connected shape next to it. */
export function justOutside(cre, cim, angle, { low = 400, high = 20000, span = 0.05 } = {}) {
  let lo = 0;
  let hi = span;
  // Walk out until it escapes at all, then bisect on the escape count.
  for (let step = 0; step < 40; step += 1) {
    const at = classify(cre + hi * Math.cos(angle), cim + hi * Math.sin(angle));
    if (at.kind === "outside") break;
    lo = hi;
    hi *= 1.6;
    if (hi > 2) return null;
  }
  for (let step = 0; step < 80; step += 1) {
    const mid = (lo + hi) / 2;
    const at = classify(cre + mid * Math.cos(angle), cim + mid * Math.sin(angle));
    if (at.kind === "outside") {
      if (at.escape >= low && at.escape <= high) {
        return { c: [cre + mid * Math.cos(angle), cim + mid * Math.sin(angle)], escape: at.escape };
      }
      if (at.escape > high) lo = mid;
      else hi = mid;
    } else {
      lo = mid;
    }
  }
  return null;
}
