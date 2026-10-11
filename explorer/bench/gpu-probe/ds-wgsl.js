// The double-single error-free transforms in WGSL, compiled in several forms, for the
// probe's self-test. The ops are the Deep tab's own (`explorer/deep-gpu-wgsl.js`'s
// `selfTestSource`, which is the kernel's text); this file adds what only the probe runs:
// the `storage` guard, which needs a fourth binding, and the two controls.
//
// Every arithmetic result passes through `G(...)`, and a form is nothing but a body for
// `G`. The plain form makes it the identity, so the module is the textbook code; every
// other form is a different way of telling the compiler chain (Tint -> HLSL -> DXC or
// FXC -> the driver, on Chrome for Windows) that it may not see through an intermediate,
// which is what stops a fused multiply-add or a reassociation from rewriting the error
// term the transform exists to compute. Which of them survive is an empirical question
// about this adapter, and the self-test is how it is asked.

import {
  FORMS as KERNEL_GUARDS,
  SELFTEST_ARITY,
  SELFTEST_OPS,
  SELFTEST_STRIDE,
  SELFTEST_WORKGROUP,
  selfTestSource,
} from "../../deep-gpu-wgsl.js";

/** Op codes, in the order the shader's `switch` takes them: stage 2's six. */
export const OPS = SELFTEST_OPS.slice(0, 6);

/** How many f32 inputs each op reads from its case. */
export const ARITY = SELFTEST_ARITY;

/** u32 slots per case in the input buffer: the op, four inputs, padding to a power of two. */
export const CASE_STRIDE = SELFTEST_STRIDE;

/** Threads per workgroup; also the length of the workgroup scratch array. */
export const WORKGROUP = SELFTEST_WORKGROUP;

/**
 * The forms, by name: the shipped module's, then the probe's own. `knobs` is a uniform the
 * page fills at run time with one = 1.0, zero = 0.0, uzero = 0 and flag = 0, so none of
 * them is a constant the compiler can fold.
 */
export const FORMS = [
  ...KERNEL_GUARDS,
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
      ["let high = G(c - G(c - a));", "let high = c - fma(4097.0, a, -a);"],
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
  let text = selfTestSource(form);
  for (const [from, to] of form.patch ?? []) {
    if (!text.includes(from)) throw new Error(`form ${form.name}: patch target not found: ${from}`);
    text = text.replace(from, to);
  }
  return text;
}
