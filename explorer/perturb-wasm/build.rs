//! Empty on purpose.
//!
//! Whether a package has a build script is part of cargo's `-C metadata` hash, and deleting
//! this file was measured to move `perturb.wasm`'s and `perturb-scalar.wasm`'s bytes. It
//! carries no sibling-checkout guard, because none could fire: without `fractal-wallpapers`
//! beside this checkout, cargo stops while it resolves the package, failing to read
//! `…/fractal-wallpapers/perturbation/Cargo.toml`, before any build script runs. Nor a
//! `rerun-if-changed`: cargo fingerprints a path dependency's sources on its own.

fn main() {}
