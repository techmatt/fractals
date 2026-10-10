//! A native model of the Deep tab's WebGPU kernel, and later that shader's oracle.
//!
//! The Deep tab draws with `perturb`, a perturbation kernel in `f64`. A WebGPU compute
//! shader has no `f64`, so before one is written this crate restates the kernel in the
//! types WGSL has, runs it natively, and measures it against `perturb` sample for
//! sample. Once a shader exists, this model is what its output is held to, with a
//! tolerance: WGSL cannot forbid contraction (see [`model`]), so bit for bit is not a
//! claim a shader can be held to.
//!
//! # The arithmetic rules
//!
//! These hold for everything on the per-pixel path ([`model::init`], [`model::pass`]
//! and what they call, and [`frame::Frame::dc_mantissa`]):
//!
//! - **`f32`, `i32` and `u32` only.** No `f64` anywhere in the per-pixel loop. `f64` is
//!   allowed in CPU-side setup only: narrowing the reference orbit ([`orbit`]), reducing
//!   the frame to its constants ([`frame::Frame::from_spec`]), and the comparison
//!   harness ([`compare`]).
//! - **No fused multiply-add.** Every multiply and every add is its own operation, in
//!   the order `perturb` writes it.
//! - **No infinity or NaN is read**, and nothing on the path is formed that could
//!   overflow before a test has ruled it out.
//! - **No reliance on the compiler keeping an order it could reassociate**, except the
//!   hi/lo reference sums, which are flagged where they are written (`REASSOCIATION
//!   HAZARD`) and measured: with [`orbit::Encoding::F32Pair`] they are not formed at all.
//! - **Scaling by powers of two goes through [`wgsl::ldexp_exact`]**, integer arithmetic
//!   on the exponent field, never through WGSL's `ldexp` outside `[-126, 128]`.
//! - **The builtins the loop calls are in [`wgsl`]**, one function per WGSL builtin or
//!   bit idiom, so the shader port is line for line.
//!
//! The scaling scheme, the state struct, and what changed from `perturb` to fit these
//! types are documented in [`model`]. Iteration skipping, a switch that is off unless a
//! table is passed ([`model::pass_bla`]), is in [`bla`]: its table is CPU-side setup in
//! `f64`, and its lookup and its step are on the per-pixel path and keep these rules.

pub mod bla;
pub mod compare;
pub mod frame;
pub mod json;
pub mod model;
pub mod orbit;
pub mod wgsl;

pub use frame::Frame;
pub use model::{PixelState, STATE_BYTES};
pub use orbit::{Encoding, GpuOrbit};
