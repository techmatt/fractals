// Where the two modules meet, held to the committed bytes of both.
//
//   node --test explorer/deep.test.mjs
//
// The Deep tab rests on three claims that nothing else on this page could catch going
// wrong, because each of them fails by drawing a plausible picture rather than by raising:
//
// 1. **The lane buffer `perturb.wasm` produces is the one `engine.wasm` colours** — same
//    layout, same `NaN` for the interior, same count.
// 2. **`shade_level` cannot see the viewport it is given**, which is what makes the
//    placeholder viewport in `deep-render.js`'s shade spec sound rather than a shortcut.
//    A deep viewport is one `engine.wasm` refuses outright, so there is no "shade it the
//    real way" to compare against — the comparison available is two different viewports
//    over the same lanes, and if the colouring read either of them they would differ.
// 3. **The deep kernel's geometry is the engine's geometry.** Half a pixel of disagreement
//    about where the sample grid sits would be invisible at depth and obvious to nobody,
//    so it is measured where both kernels are still honest: a shallow frame, drawn both
//    ways, held to agreeing about the picture.
//
// Both modules are read off disk, so this suite runs on Node's own runner with nothing
// installed and nothing served.

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";

import { load as loadEngine, RAMP } from "./bench/engine.mjs";
import { load as loadPerturb } from "./bench/perturb.mjs";
import { shadeSpecOf, deepSpecOf } from "./deep-render.js";
import * as deep from "./deep-link.js";

const MODULE = new URL("./perturb.wasm", import.meta.url);
const missing = !existsSync(MODULE);

const engine = missing ? null : await loadEngine();
const perturb = missing ? null : await loadPerturb();

/** The audit's anchor: a period-2838 minibrot nucleus in the seahorse valley. */
const ANCHOR = {
  center_re: "-0.74501772828532335842941892835857434",
  center_im: "0.14993443275456819177805709088257971",
  width: 2e-11,
};

/** A shallow frame both kernels can draw honestly. `f64` resolves it with room to spare,
 *  so the engine's field is a real answer rather than a picture of its own arithmetic. */
const SHALLOW = {
  center_re: "-0.743643887037158704752191506114774",
  center_im: "0.131825904205311970493132056385139",
  width: 1e-6,
};

const skip = missing ? "explorer/perturb.wasm is not built (cargo build --release --target wasm32-unknown-unknown)" : false;

test("the kernel's cap policy is the engine's shape with the engine's ceiling lifted", { skip }, () => {
  // Where the engine still answers, the two agree to the iteration.
  assert.equal(perturb.maxiter(3), engine.wasm.maxiter_for_width(3));
  assert.equal(perturb.maxiter(1e-6), engine.wasm.maxiter_for_width(1e-6));
  // Past the engine's ceiling this one keeps going, which is the whole reason it restates
  // the shape instead of importing it.
  assert.equal(engine.wasm.maxiter_for_width(1e-28), 67000);
  assert.equal(perturb.maxiter(1e-28), 117518);
  assert.equal(perturb.maxiter(2e-11), 48551);
});

test("a deep spec the engine refuses outright is one the kernel plans", { skip }, () => {
  const spec = { ...ANCHOR, schema: 1, resolution: [48, 27], maxiter: 48551 };
  const planned = perturb.plan(spec);
  assert.ok(planned.ok, planned.why);
  assert.equal(planned.maxiter, 48551);
  assert.equal(planned.limbs, 3);
  assert.equal(planned.sample_width, 48);

  // And the engine says why not, in its own words, which is the refusal the shade spec's
  // placeholder viewport exists to step around.
  //
  // **The width alone is not what the engine refuses**, and it is worth knowing that
  // before reading this: the wall is the spacing between neighbouring samples against the
  // unit of last place of the coordinate, so the same place at 48 pixels across is
  // resolvable and at 1136 is not. The frame below is deep enough that no resolution
  // rescues it — the spacing is five decades under an ulp at any size.
  const refused = engine.plan({
    schema: 1,
    family: { kind: "mandelbrot" },
    viewport: { center_re: ANCHOR.center_re, center_im: ANCHOR.center_im, width: "1e-19" },
    resolution: [48, 27],
    mode: "smooth",
    colormap: RAMP,
  });
  assert.equal(refused.ok, false);
  assert.match(refused.why, /unit of last place/);
  // And the kernel draws exactly that frame, at four limbs rather than three.
  const deeper = perturb.plan({ ...spec, width: 1e-19, maxiter: perturb.maxiter(1e-19) });
  assert.ok(deeper.ok, deeper.why);
  assert.equal(deeper.limbs, 4);
});

test("the lanes are one per sample, NaN for the interior, in the engine's own layout", { skip }, () => {
  const spec = { ...ANCHOR, schema: 1, resolution: [32, 18], maxiter: 4000 };
  const lanes = perturb.frame(spec);
  assert.equal(lanes.length, 32 * 18 * 8, "one f64 a sample and no more");
  const values = new Float64Array(lanes.buffer);
  const inside = values.filter((value) => Number.isNaN(value)).length;
  // The anchor is a minibrot nucleus at a width below its own atom, so this frame is
  // almost all interior — which is what `NaN` has to mean for the engine to colour it.
  assert.ok(inside > values.length * 0.9, `${inside} of ${values.length} interior`);
  for (const value of values) {
    assert.ok(Number.isNaN(value) || (value > 0 && Number.isFinite(value)), `${value}`);
  }
});

test("a band is a range of output rows, and the bands assemble to the frame", { skip }, () => {
  const spec = { ...SHALLOW, schema: 1, resolution: [40, 24], maxiter: 2000 };
  const orbit = perturb.reference(spec);
  const whole = perturb.frame(spec);
  const pieces = [
    perturb.band(spec, orbit, 0, 7),
    perturb.band(spec, orbit, 7, 19),
    perturb.band(spec, orbit, 19, 24),
  ];
  const assembled = new Uint8Array(whole.length);
  let at = 0;
  for (const piece of pieces) {
    assembled.set(piece, at);
    at += piece.length;
  }
  assert.equal(at, whole.length);
  assert.deepEqual(assembled, whole, "a cut moved the arithmetic, which it must not");
});

test("one orbit draws every band of its frame", { skip }, () => {
  // The claim `deep-worker.js` holds the orbit for: a reference computed once is what
  // every band of that frame reads, so the answer does not depend on when it was made.
  const spec = { ...SHALLOW, schema: 1, resolution: [24, 14], maxiter: 2000 };
  const first = perturb.reference(spec);
  const second = perturb.reference(spec);
  assert.deepEqual(first, second, "the orbit is a function of the spec");
  assert.deepEqual(
    perturb.band(spec, first, 3, 9),
    perturb.band(spec, second, 3, 9),
  );
});

test("a named reference draws the same picture as the centre it is at", { skip }, () => {
  // Naming the view's own centre as the reference is what a kept orbit does on a frame
  // that has not moved, so the two have to be the same picture.
  const spec = { ...SHALLOW, schema: 1, resolution: [24, 14], maxiter: 2000 };
  const named = {
    ...spec,
    reference_re: SHALLOW.center_re,
    reference_im: SHALLOW.center_im,
  };
  assert.deepEqual(perturb.frame(named), perturb.frame(spec));
});

test("shade_level cannot see the viewport it is given", { skip }, () => {
  const spec = { ...SHALLOW, schema: 1, resolution: [64, 36], maxiter: 3000 };
  const lanes = perturb.frame(spec);

  const view = {
    palette: "ramp",
    shade: {
      gamma: 1,
      cycles: 1,
      phase: 0,
      reverse: false,
      mirror: false,
      transfer: { kind: "value" },
      rolloff: { kind: "none" },
    },
    level: null,
  };
  // The spec the tab actually sends, with its placeholder viewport, and the same spec
  // pointed at a completely different place. Both are f64-resolvable; neither is where
  // the lanes came from.
  const placeholder = shadeSpecOf(view, RAMP, 64, 36);
  const elsewhere = {
    ...placeholder,
    viewport: { center_re: "0.35", center_im: "-0.61", width: "0.004" },
  };
  const a = engine.shade(placeholder, new Uint8Array(lanes));
  const b = engine.shade(elsewhere, new Uint8Array(lanes));
  assert.deepEqual(a, b, "the colouring read the viewport, and the placeholder is unsound");
  // Not a picture of nothing: a stretch over a real field is many colours.
  assert.ok(new Set(a).size > 8, "the shade came back flat, so this proved nothing");
});

test("and the shade is the same picture through shade_level as through shade", { skip }, () => {
  const spec = { ...SHALLOW, schema: 1, resolution: [48, 27], maxiter: 3000 };
  const lanes = perturb.frame(spec);
  const view = {
    palette: "ramp",
    shade: {
      gamma: 1,
      cycles: 1,
      phase: 0,
      reverse: false,
      mirror: false,
      transfer: { kind: "value" },
      rolloff: { kind: "none" },
    },
    level: null,
  };
  const shadeSpec = shadeSpecOf(view, RAMP, 48, 27);
  const plain = engine.shade(shadeSpec, new Uint8Array(lanes));
  const levelled = engine.shadeLevel(shadeSpec, new Uint8Array(lanes), 0);
  assert.equal(levelled.acts, false);
  assert.deepEqual(levelled.image, plain);
});

test("the deep kernel's sample grid is the engine's, measured where both are honest", { skip }, () => {
  // At 1e-6 the two kernels are drawing the same field with different arithmetic, and the
  // engine is still well above the wall. What is being held here is the GEOMETRY: half a
  // pixel of disagreement about where the grid sits would move the picture and raise
  // nothing, at a depth where nobody could see it.
  const [width, height] = [96, 54];
  const cap = 3000;
  const deepLanes = new Float64Array(
    perturb.frame({ ...SHALLOW, schema: 1, resolution: [width, height], maxiter: cap }).buffer,
  );
  const engineSpec = {
    schema: 1,
    family: { kind: "mandelbrot" },
    viewport: {
      center_re: SHALLOW.center_re,
      center_im: SHALLOW.center_im,
      width: String(SHALLOW.width),
    },
    resolution: [width, height],
    mode: "smooth",
    maxiter: cap,
    colormap: RAMP,
  };
  const shape = engine.plan(engineSpec);
  assert.ok(shape.ok, shape.why);
  assert.equal(shape.lanes, 1);
  const engineLanes = new Float64Array(engine.band(engineSpec, shape, 0, height).buffer);
  assert.equal(deepLanes.length, engineLanes.length);

  const against = (ours) => {
    let disagreements = 0;
    const relative = [];
    for (let at = 0; at < ours.length; at++) {
      const mine = ours[at];
      const theirs = engineLanes[at];
      if (Number.isNaN(mine) !== Number.isNaN(theirs)) {
        disagreements += 1;
        continue;
      }
      if (Number.isNaN(theirs)) continue;
      relative.push(Math.abs(mine - theirs) / Math.max(1, Math.abs(theirs)));
    }
    relative.sort((a, b) => a - b);
    return { disagreements, escaping: relative.length, median: relative[relative.length >> 1] };
  };

  // **Held to the median, for `perturb-wasm/README.md`'s reason.** The two loops disagree
  // wildly on samples within an ulp of the boundary — the worst here is hundreds of
  // iterations — and that tail is the chaos of the boundary rather than anything about
  // either kernel, so a worst case would be pinning this suite to `f64`'s own error.
  const same = against(deepLanes);
  assert.equal(same.disagreements, 0, `${same.disagreements} samples disagree about the interior`);
  assert.ok(same.escaping > width * height * 0.1, `only ${same.escaping} escaping samples`);
  assert.ok(same.median < 1e-6, `median relative difference ${same.median.toExponential(2)}`);

  // **And the control, because a loose threshold on one reading proves nothing.** The same
  // comparison with the deep frame's centre moved a tenth of one pixel: if this passed too,
  // the test above would be measuring the weather.
  const nudged = new Float64Array(
    perturb.frame({
      ...SHALLOW,
      schema: 1,
      center_re: String(Number(SHALLOW.center_re) + (0.1 * SHALLOW.width) / width),
      resolution: [width, height],
      maxiter: cap,
    }).buffer,
  );
  const moved = against(nudged);
  assert.ok(moved.disagreements > 10, "a tenth of a pixel moved no sample, so this test is blind");
  assert.ok(
    moved.median > same.median * 1000,
    `a tenth of a pixel moved the median only from ${same.median.toExponential(2)} to ${moved.median.toExponential(2)}`,
  );
});

/**
 * **The Julia field, against the engine's own Julia render of the same `c`.**
 *
 * The deep kernel's Julia case is the one thing on this page drawn by an arithmetic
 * nothing else here can check — except at a width where `f64` is still honest, which is
 * exactly where `engine.wasm` draws the same set through a completely different loop:
 * `z ↦ z² + c` iterated directly, with no reference orbit, no delta and no rebasing. Two
 * kernels sharing no code and agreeing about a picture is the strongest statement
 * available about the recurrence, the entry index and the geometry all at once.
 */
test("a shallow julia field is the engine's own julia render of the same c", { skip }, () => {
  const [width, height] = [96, 54];
  const cap = 3000;
  // The Douady rabbit, `c` in the period-3 bulb and so inside the Mandelbrot set: a filled
  // Julia set with a boundary that has structure at this width, so the frame has both
  // interior and exterior in it. A `c` outside the set would give a dust with neither.
  const c = ["-0.123", "0.745"];
  const frame = { center_re: c[0], center_im: c[1], width: 3 };

  const deepLanes = new Float64Array(
    perturb.frame({
      ...frame,
      schema: 1,
      resolution: [width, height],
      maxiter: cap,
      julia_re: c[0],
      julia_im: c[1],
    }).buffer,
  );

  const engineSpec = {
    schema: 1,
    family: { kind: "julia", degree: 2, c },
    viewport: { center_re: frame.center_re, center_im: frame.center_im, width: String(frame.width) },
    resolution: [width, height],
    mode: "smooth",
    maxiter: cap,
    colormap: RAMP,
  };
  const shape = engine.plan(engineSpec);
  assert.ok(shape.ok, shape.why);
  assert.equal(shape.lanes, 1);
  const engineLanes = new Float64Array(engine.band(engineSpec, shape, 0, height).buffer);
  assert.equal(deepLanes.length, engineLanes.length);

  let disagreements = 0;
  let interior = 0;
  const relative = [];
  for (let at = 0; at < deepLanes.length; at++) {
    const mine = deepLanes[at];
    const theirs = engineLanes[at];
    if (Number.isNaN(mine) !== Number.isNaN(theirs)) {
      disagreements += 1;
      continue;
    }
    if (Number.isNaN(theirs)) {
      interior += 1;
      continue;
    }
    relative.push(Math.abs(mine - theirs) / Math.max(1, Math.abs(theirs)));
  }
  relative.sort((a, b) => a - b);
  const median = relative[relative.length >> 1];

  // Both halves of the picture have to be there, or the agreement is about a blank.
  assert.ok(interior > width * height * 0.1, `only ${interior} interior samples`);
  assert.ok(relative.length > width * height * 0.3, `only ${relative.length} escaping samples`);
  assert.equal(disagreements, 0, `${disagreements} samples disagree about the interior`);
  // Held to the median, for the reason the Mandelbrot comparison above is.
  assert.ok(median < 1e-6, `median relative difference ${median.toExponential(2)}`);

  // **The control: the same field at a neighbouring parameter.** A Julia set is a
  // different picture for every `c`, so a test that passed at the wrong one would be
  // measuring nothing at all — and the parameter is the one thing here that no geometry
  // check further up would have caught.
  const elsewhere = new Float64Array(
    perturb.frame({
      ...frame,
      schema: 1,
      resolution: [width, height],
      maxiter: cap,
      julia_re: "-0.113",
      julia_im: c[1],
    }).buffer,
  );
  let moved = 0;
  for (let at = 0; at < elsewhere.length; at++) {
    const mine = elsewhere[at];
    const theirs = engineLanes[at];
    // Any disagreement at all: the mask, or the count by more than the agreement above
    // was held to. A tenth of a percent on `c` is a different picture, not a nudge.
    if (Number.isNaN(mine) !== Number.isNaN(theirs)) moved += 1;
    else if (!Number.isNaN(theirs) && Math.abs(mine - theirs) > 1e-6) moved += 1;
  }
  assert.ok(moved > 1000, `a different c moved only ${moved} samples, so this test is blind`);
});

test("a julia frame's reference orbit is the mandelbrot orbit at the same c", { skip }, () => {
  // The claim that makes *Julia at this c* free: the workers are already holding it.
  const at = { center_re: "-0.123", center_im: "0.745", width: 3, resolution: [16, 9], maxiter: 500 };
  const mandelbrot = perturb.reference({ ...at, schema: 1 });
  const julia = perturb.reference({ ...at, schema: 1, julia_re: "-0.123", julia_im: "0.745" });
  // One point longer, because a view entered at `Z₁` has one step less in front of it —
  // so the sixteen-byte headers differ, by exactly that count, and the points do not.
  assert.equal(julia.length, mandelbrot.length + 16);
  assert.deepEqual(julia.slice(16, mandelbrot.length), mandelbrot.slice(16));
});

test("a julia frame too far from both anchors is refused, and says why", { skip }, () => {
  const far = {
    schema: 1,
    julia_re: ANCHOR.center_re,
    julia_im: ANCHOR.center_im,
    center_re: "0",
    center_im: "0",
    width: 1e-20,
    resolution: [96, 54],
  };
  const refusal = perturb.plan(far);
  assert.equal(refusal.ok, false);
  assert.match(refusal.why, /flat/);
  // And the same frame drawn from the anchor it actually stands on is fine, which is
  // what the second anchor exists for.
  const anchored = perturb.plan({ ...far, anchor: "origin" });
  assert.ok(anchored.ok, anchored.why);
  assert.equal(anchored.anchor, "origin");
  assert.equal(anchored.julia, true);
});

test("the tab's own spec builder produces what the module reads", { skip }, () => {
  const context = {
    palettes: new Map([["ramp", { cyclic: false }]]),
    defaultPalette: "ramp",
    deepHome: () => ({ x: "-0.5", y: "0", w: "3" }),
    deepCap: (width) => perturb.maxiter(width),
  };
  const view = deep.parse(
    `?dv=1&x=${ANCHOR.center_re}&y=${ANCHOR.center_im}&w=2e-11&n=48551&p=ramp`,
    context,
  );
  const spec = deepSpecOf(view, 48, 27);
  // The centre crosses as text and the module refuses it any other way.
  assert.equal(typeof spec.center_re, "string");
  assert.equal(spec.center_re, ANCHOR.center_re);
  const planned = perturb.plan(spec);
  assert.ok(planned.ok, planned.why);
  assert.equal(planned.maxiter, 48551);

  // A centre handed over as a JSON number is refused by name, which is the one mistake
  // this whole boundary exists to make impossible.
  const narrowed = perturb.plan({ ...spec, center_re: Number(ANCHOR.center_re) });
  assert.equal(narrowed.ok, false);
  assert.match(narrowed.why, /has to be a string/);
});
