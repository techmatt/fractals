//! One job: declare `generic_loop` to check-cfg, so the compiler expects the name.
//!
//! `generic_loop` is a bench-only cfg, never a cargo feature. A feature would put itself in
//! the crate's metadata hash and the committed module would stop rebuilding to its own
//! bytes; a bare `--cfg` leaves the default build exactly where it was.
//!
//! The file stays rather than moving that declaration into `[lints.rust]`, because whether a
//! package has a build script is itself part of cargo's `-C metadata` hash: deleting this
//! file was measured to move `engine.wasm`'s bytes, and the two perturbation modules' with
//! the empty one in `perturb-wasm`. There is no sibling-checkout guard here, because none
//! could fire: without `fractal-wallpapers` beside this checkout, cargo stops while it
//! resolves the package, failing to read `…/fractal-wallpapers/engine/Cargo.toml`, before
//! any build script runs.

fn main() {
    println!("cargo::rustc-check-cfg=cfg(generic_loop)");
}
