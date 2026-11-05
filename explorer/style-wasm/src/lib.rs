//! `style.wasm`: the sibling's style module, linked whole.
//!
//! Every export (`open`, `measure`, `tile`, `frame`, `close`, `last_error`, `alloc`,
//! `dealloc`) is `fractal-wallpapers/style-wasm`'s own `#[no_mangle]` function; a cdylib
//! exports a linked dependency's, so this crate holds no code. `explorer/style.js` is the
//! page's side of it, and `fractal-wallpapers/engine/README.md`'s *The style module* the
//! API.

pub use style_wasm::*;
