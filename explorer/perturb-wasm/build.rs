//! The sibling-checkout guard `engine-wasm/build.rs` keeps, kept the same here.
//!
//! **Measured, it cannot fire, and neither can that one**: cargo reads a path
//! dependency's manifest while it resolves the package, before any build script
//! runs, so with the sibling missing the reader meets cargo's own "failed to read
//! `…/fractal-wallpapers/perturbation/Cargo.toml`" — whose path names the missing
//! repository — and never the sentence below. What this file does do is the
//! `rerun-if-changed` on the kernel's sources.

use std::path::Path;

fn main() {
    let kernel = Path::new("../../../fractal-wallpapers/perturbation/Cargo.toml");
    println!("cargo:rerun-if-changed=../../../fractal-wallpapers/perturbation/src");
    if !kernel.exists() {
        panic!(
            "\n\n  the fractal-wallpapers checkout is not beside this one.\n\n  \
             This crate depends on `<sibling>/fractal-wallpapers/perturbation` by path, so \
             both repositories\n  have to be checked out into the same parent directory:\n\n    \
             <parent>/fractal-website/explorer/perturb-wasm   (here)\n    \
             <parent>/fractal-wallpapers/perturbation         (missing)\n\n  \
             Nothing in this repository needs the build to succeed — `perturb.wasm` and \
             `perturb-scalar.wasm`\n  are committed artifacts, and the site serves them \
             whether or not anyone can rebuild them today.\n"
        );
    }
}
