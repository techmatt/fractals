//! How far a long call has got, told to the page while the call is still running.
//!
//! **The module's one import, and it exists because a wasm call cannot be looked
//! into.** A reference orbit at a cap of a million, or one rung of the cap probe on
//! a frame beside a parabolic point, is seconds inside a single export, and until
//! it returns the worker that made the call can say nothing at all. The page could
//! not tell a slow frame from a stranded pool, and that was the whole of the
//! problem `deep_tab_activity_and_layout_ckpt141` was sent to fix.
//!
//! So the long loops call [`report`] with how much of their own work is done, and
//! on `wasm32` that is `env.progress(done, total)`, supplied by whoever instantiates
//! the module. **The rate is the host's to limit, not this file's**: the worker
//! posts at most one message every hundred milliseconds whatever this calls it
//! with, and the main thread's own instance supplies a function that does nothing.
//! What this file keeps down is the cost of the call itself — the orbit reports once
//! every [`EVERY`] iterations and a probe once a cell, both of which are noise
//! beside the work between two calls.
//!
//! Natively there is nothing to tell, and [`report`] compiles to nothing, which is
//! what keeps every native test and harness exactly as it was.

/// How many orbit iterations go by between two reports. A power of two, so the
/// test is a mask; at the few hundred nanoseconds a fixed-point step costs, this is
/// about a millisecond of orbit between calls.
pub const EVERY: u32 = 4096;

#[cfg(target_arch = "wasm32")]
#[link(wasm_import_module = "env")]
unsafe extern "C" {
    fn progress(done: u32, total: u32);
}

/// `done` of `total` units of the call in flight — iterations of an orbit, cells of
/// a probe share. The units are the caller's; the page reads the ratio and, for the
/// probe, the count.
#[inline]
pub fn report(done: u32, total: u32) {
    #[cfg(target_arch = "wasm32")]
    unsafe {
        progress(done, total);
    }
    #[cfg(not(target_arch = "wasm32"))]
    let _ = (done, total);
}
