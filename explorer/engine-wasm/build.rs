//! One job: say why the build failed when the sibling checkout is not there.
//!
//! Cargo's own message for a missing path dependency names a `Cargo.toml` that
//! does not exist and leaves the reader to work out that a whole other
//! repository is meant. This says it.

use std::path::Path;

fn main() {
    let engine = Path::new("../../../fractal-wallpapers/engine/Cargo.toml");
    println!("cargo:rerun-if-changed=../../../fractal-wallpapers/engine/src");
    if !engine.exists() {
        panic!(
            "\n\n  the fractal-wallpapers checkout is not beside this one.\n\n  \
             This crate depends on `<sibling>/fractal-wallpapers/engine` by path, so both \
             repositories\n  have to be checked out into the same parent directory:\n\n    \
             <parent>/fractal-website/explorer/engine-wasm   (here)\n    \
             <parent>/fractal-wallpapers/engine              (missing)\n\n  \
             Nothing in this repository needs the build to succeed — `engine.wasm` is a \
             committed\n  artifact, and the site serves it whether or not anyone can rebuild \
             it today.\n"
        );
    }
}
