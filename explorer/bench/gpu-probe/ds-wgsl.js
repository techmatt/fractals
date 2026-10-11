// The double-single error-free transforms in WGSL, written once and compiled in several
// forms.
//
// Every arithmetic result passes through `G(...)`, and a form is nothing but a body for
// `G`. The plain form makes it the identity, so the module is the textbook code; every
// other form is a different way of telling the compiler chain (Tint -> HLSL -> DXC or
// FXC -> the driver, on Chrome for Windows) that it may not see through an intermediate,
// which is what stops a fused multiply-add or a reassociation from rewriting the error
// term the transform exists to compute. Which of them survive is an empirical question
// about this adapter, and the self-test is how it is asked.
//
// The algorithms are the ones `explorer/deep-gpu-model`'s `ds.rs` models, with no FMA
// anywhere: the vectors the page checks against are that model's arithmetic.

/** Op codes, in the order the shader's `switch` takes them. */
export const OPS = ["two_sum", "quick_two_sum", "split", "two_prod", "ds_add", "ds_mul"];

/** How many f32 inputs each op reads from its case. */
export const ARITY = { two_sum: 2, quick_two_sum: 2, split: 1, two_prod: 2, ds_add: 4, ds_mul: 4 };

/** u32 slots per case in the input buffer: the op, four inputs, padding to a power of two. */
export const CASE_STRIDE = 8;

/** Threads per workgroup; also the length of the workgroup scratch array. */
export const WORKGROUP = 64;

/**
 * The forms, by name: a one-line body for `G` and what it is trying.
 *
 * `knobs` is a uniform the page fills at run time with one = 1.0, zero = 0.0, uzero = 0
 * and flag = 0, so none of them is a constant the compiler can fold. Subtracting the zero
 * rather than adding it keeps a negative zero negative (-0 + 0 is +0, -0 - 0 is -0), so
 * the form changes nothing about signed zeros that the plain one does not.
 */
export const FORMS = [
  { name: "plain", body: "return x;", note: "no defence; the textbook code" },
  { name: "mul-one", body: "return x * knobs.one;", note: "multiply by a runtime 1.0" },
  { name: "sub-zero", body: "return x - knobs.zero;", note: "subtract a runtime 0.0" },
  {
    name: "bitcast",
    body: "return bitcast<f32>(bitcast<u32>(x));",
    note: "a bare bitcast round trip, provably the identity",
  },
  {
    name: "bitcast-xor",
    body: "return bitcast<f32>(bitcast<u32>(x) ^ knobs.uzero);",
    note: "bitcast round trip through an xor with a runtime 0u",
  },
  {
    name: "select",
    body: "return select(x, knobs.zero, knobs.flag != 0u);",
    note: "select() on a runtime flag that is always false",
  },
  {
    name: "workgroup",
    body: "wg[slot] = x; return wg[slot];",
    note: "store to and reload from workgroup memory",
  },
  {
    name: "storage",
    body: "scratch[slot] = x; return scratch[slot];",
    note: "store to and reload from a read_write storage buffer",
  },
  // Controls: the plain form with, by hand, exactly what a compiler that contracted or
  // reassociated would have done. They are expected to FAIL; a control that passes means
  // the vectors are too gentle to see the hazard, and every pass above it means nothing.
  {
    name: "control-fma",
    body: "return x;",
    note: "CONTROL, expected to fail split and ds_mul: fma() written where a contraction would land",
    control: true,
    patch: [
      ["let hi = G(c - G(c - a));", "let hi = c - fma(4097.0, a, -a);"],
      ["let e = G(pe.y + G(G(a.x * b.y) + G(a.y * b.x)));", "let e = fma(a.x, b.y, fma(a.y, b.x, pe.y));"],
    ],
  },
  {
    name: "control-reassoc",
    body: "return x;",
    note: "CONTROL, expected to fail two_sum and what uses it: s - a rewritten as b",
    control: true,
    patch: [["let bb = G(s - a);", "let bb = b;"]],
  },
];

/** The whole module for one form. */
export function source(form) {
  let text = template(form);
  for (const [from, to] of form.patch ?? []) {
    if (!text.includes(from)) throw new Error(`form ${form.name}: patch target not found: ${from}`);
    text = text.replace(from, to);
  }
  return text;
}

function template(form) {
  return /* wgsl */ `
struct Knobs {
  one: f32,
  zero: f32,
  uzero: u32,
  flag: u32,
}

@group(0) @binding(0) var<storage, read> cases: array<u32>;
@group(0) @binding(1) var<storage, read_write> results: array<u32>;
@group(0) @binding(2) var<uniform> knobs: Knobs;
@group(0) @binding(3) var<storage, read_write> scratch: array<f32>;

var<workgroup> wg: array<f32, ${WORKGROUP}>;
// Which scratch slot this invocation owns: its local index for the workgroup form, its
// global index for the storage form.
var<private> slot: u32;

// The guard. Form: ${form.name} (${form.note}).
fn G(x: f32) -> f32 {
  ${form.body}
}

fn two_sum(a: f32, b: f32) -> vec2<f32> {
  let s = G(a + b);
  let bb = G(s - a);
  let err = G(G(a - G(s - bb)) + G(b - bb));
  return vec2<f32>(s, err);
}

fn quick_two_sum(a: f32, b: f32) -> vec2<f32> {
  let s = G(a + b);
  let err = G(b - G(s - a));
  return vec2<f32>(s, err);
}

fn split(a: f32) -> vec2<f32> {
  let c = G(4097.0 * a);
  let hi = G(c - G(c - a));
  let lo = G(a - hi);
  return vec2<f32>(hi, lo);
}

fn two_prod(a: f32, b: f32) -> vec2<f32> {
  let p = G(a * b);
  let x = split(a);
  let y = split(b);
  let err = G(G(G(G(G(x.x * y.x) - p) + G(x.x * y.y)) + G(x.y * y.x)) + G(x.y * y.y));
  return vec2<f32>(p, err);
}

fn ds_add(a: vec2<f32>, b: vec2<f32>) -> vec2<f32> {
  var se = two_sum(a.x, b.x);
  let tf = two_sum(a.y, b.y);
  var e = G(se.y + tf.x);
  se = quick_two_sum(se.x, e);
  e = G(se.y + tf.y);
  return quick_two_sum(se.x, e);
}

fn ds_mul(a: vec2<f32>, b: vec2<f32>) -> vec2<f32> {
  let pe = two_prod(a.x, b.x);
  let e = G(pe.y + G(G(a.x * b.y) + G(a.y * b.x)));
  return quick_two_sum(pe.x, e);
}

@compute @workgroup_size(${WORKGROUP})
fn main(@builtin(global_invocation_id) gid: vec3<u32>,
        @builtin(local_invocation_index) lid: u32) {
  let i = gid.x;
  let count = arrayLength(&results) / 2u;
  if (i >= count) {
    return;
  }
  slot = select(lid, i, ${form.name === "storage"});
  let base = i * ${CASE_STRIDE}u;
  let op = cases[base];
  let a = bitcast<f32>(cases[base + 1u]);
  let b = bitcast<f32>(cases[base + 2u]);
  let c = bitcast<f32>(cases[base + 3u]);
  let d = bitcast<f32>(cases[base + 4u]);
  var r = vec2<f32>(0.0, 0.0);
  switch (op) {
    case 0u: { r = two_sum(a, b); }
    case 1u: { r = quick_two_sum(a, b); }
    case 2u: { r = split(a); }
    case 3u: { r = two_prod(a, b); }
    case 4u: { r = ds_add(vec2<f32>(a, b), vec2<f32>(c, d)); }
    case 5u: { r = ds_mul(vec2<f32>(a, b), vec2<f32>(c, d)); }
    default: {}
  }
  results[2u * i] = bitcast<u32>(r.x);
  results[2u * i + 1u] = bitcast<u32>(r.y);
}
`;
}
