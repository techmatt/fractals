//! The Deep tab's kernel as a raw `wasm32-unknown-unknown` module: the exports the
//! page calls, over the picture kernel that lives in the wallpaper project.
//!
//! ```text
//! plan(spec)                              -> JSON     what this spec implies, or why not
//! reference_orbit(spec)                   -> f64 pairs one orbit, computed once per frame
//! compute_band(spec, orbit, rows)         -> f64 lane  the smooth field, NaN for interior
//! dive_pick(request) / dive_land(request) -> JSON     the Dive block's rung and landing
//! coloring_rule(field, …)                 -> JSON     New coloring's λ, period, roughness
//! ```
//!
//! **The picture is not drawn here.** `fractal-wallpapers/perturbation` is the kernel —
//! the fixed-point reals, the reference orbit, the delta loop, the cap, the spec — and
//! `fractal-engine render-link` draws a `dv=` link from the same copy natively. This
//! crate depends on it by path, as `engine-wasm` depends on the engine, re-exports it
//! under the names the page's other Rust (`deep-gallery-native`, this crate's own
//! modules) has always used, and adds what only the explorer asks for: the minibrot
//! search ([`nuclei`]), the Dive ([`dive`]) and the `extern "C"` surface.
//!
//! **A separate module from `engine.wasm`, on purpose.** `engine.wasm` is the shallow
//! renderer and nothing here is linked into it: the shallow path cannot be slowed,
//! re-ordered or re-bytes by anything in this file, and a shallow permalink drawn today
//! draws the same pixels tomorrow. The two meet on the page, at a buffer of `f64`
//! lanes — this module's output is what `engine.wasm`'s `smooth` band produces, in the
//! same layout, so the existing `shade_level` colours it without knowing which kernel
//! drew it.
//!
//! **The reference orbit crosses the boundary as a buffer.** It costs milliseconds
//! to tenths of a second, against a frame of seconds to minutes, so the arithmetic is not the
//! problem; the problem is that the page's workers cannot share memory — no
//! `SharedArrayBuffer`, because GitHub Pages will not send COOP/COEP — and a
//! band's `resolve` runs once per band per worker. An orbit computed inside one
//! would be computed some fifty times a frame. So [`reference_orbit`] is called
//! once, its buffer is copied out to each worker, and [`compute_band`] is handed
//! it.
//!
//! No wasm-bindgen, JS owns every buffer through [`alloc`] and [`dealloc`], and the
//! spec crosses as a JSON string — the same conventions `engine-wasm` keeps, for the
//! same reasons.

use crate::fx::Fx;

pub use perturbation::{
    Anchor, DELTA_ULPS, REFERENCE_HEADER, SCHEMA, SHIPS_INTERIOR, Spec, cap, compute_listed,
    compute_rows, fx, json, kernel, pack_reference, policy, progress, reference, unpack_reference,
};

pub mod dive;
pub mod nuclei;

// ------------------------------------------------------------------- the exports

/// The iterations the last [`compute_band`] ran, as an `f64` (a `u64` does not cross).
/// [`perturbation::band_ran`] has why the page reads it.
#[unsafe(no_mangle)]
pub extern "C" fn band_ran() -> f64 {
    perturbation::band_ran()
}

/// The iterations the interior switch spared the last [`compute_band`]: the cap less
/// the step it stopped at, summed over the samples it stopped. Zero with it off.
#[unsafe(no_mangle)]
pub extern "C" fn band_saved() -> f64 {
    perturbation::band_saved()
}

/// What this spec implies, or why it cannot be drawn, as JSON.
///
/// Returns a buffer whose first four bytes are the UTF-8 length, little-endian —
/// `engine-wasm`'s convention, so a page that already speaks to one module
/// speaks to this one. `ceiling` is [`cap::AUTOMATIC_CEILING`] and
/// `explicit_ceiling` [`cap::EXPLICIT_CEILING`], so that a test can hold the
/// link contract's `CAP_LIMIT` to this crate rather than to a copy of it.
#[unsafe(no_mangle)]
pub extern "C" fn plan(spec_ptr: *const u8, spec_len: usize) -> *mut u8 {
    let read = text(spec_ptr, spec_len)
        .ok_or_else(|| "the spec is not UTF-8".to_string())
        .and_then(|text| Spec::parse(&text));
    // The two refusals are the kernel's own (`Spec::drawable`), so `render-link` refuses
    // the frames this does, in the same sentences.
    report(
        read.and_then(|spec| spec.drawable().map(|()| spec))
            .map(|spec| {
                // **The numbers a second kernel needs to form `dc` exactly as this one does**
                // *(gpu_deep_ship_ckpt162)*: the offset `compute_rows` reads (the same
                // `unwrap_or`), the entry index, and the plane's width and height and the sample
                // spacing, each the `f64` this crate computes rather than one a reader re-derives.
                // Written `{:e}`, Rust's shortest round-trip form, so `JSON.parse` lands on the
                // same `f64` bit for bit, signed zero included.
                let offset = spec.centre_offset().unwrap_or((0.0, 0.0));
                format!(
                    concat!(
                        r#"{{"ok":true,"maxiter":{},"limbs":{},"fraction_bits":{},"#,
                        r#""sample_width":{},"sample_height":{},"interior":{},"#,
                        r#""julia":{},"anchor":"{}","degree":{},"delta_ulps":{},"#,
                        r#""reference_bytes":{},"ceiling":{},"explicit_ceiling":{},"#,
                        r#""offset_re":{:e},"offset_im":{:e},"entry":{},"width":{:e},"#,
                        r#""plane_height":{:e},"spacing":{:e},"interior_floor":{}}}"#
                    ),
                    spec.maxiter(),
                    spec.limbs(),
                    64 * (spec.limbs() - 1),
                    spec.sample_width(),
                    spec.sample_height(),
                    spec.interior,
                    spec.julia.is_some(),
                    match spec.anchor {
                        Anchor::Parameter => "parameter",
                        Anchor::Origin => "origin",
                    },
                    spec.degree,
                    // `null` rather than `inf`, which is not JSON — and infinite is the
                    // ordinary case, an offset of exactly zero.
                    match json::finite(spec.delta_ulps()) {
                        Some(ulps) => format!("{ulps:.3}"),
                        None => "null".to_string(),
                    },
                    REFERENCE_HEADER
                        + 16 * match spec.period {
                            Some(period) => period as usize,
                            None => spec.maxiter() as usize + 1 + spec.entry(),
                        },
                    cap::AUTOMATIC_CEILING as u32,
                    cap::EXPLICIT_CEILING as u32,
                    offset.0,
                    offset.1,
                    spec.entry(),
                    spec.width,
                    spec.plane_height(),
                    spec.width / spec.sample_width() as f64,
                    kernel::INTERIOR_EXPONENT,
                )
            }),
    )
}

/// The reference orbit for this spec: **once per frame**, and handed to the
/// workers as a buffer.
///
/// Null on a spec that will not parse; the caller has already had the sentence
/// from [`plan`]. The buffer's first four bytes are the orbit's length in points,
/// so a caller can size it before reading it: `16 + 16 * count` bytes in all.
#[unsafe(no_mangle)]
pub extern "C" fn reference_orbit(spec_ptr: *const u8, spec_len: usize) -> *mut u8 {
    let Some(spec) = text(spec_ptr, spec_len).and_then(|text| Spec::parse(&text).ok()) else {
        return std::ptr::null_mut();
    };
    let Ok(orbit) = spec.reference_orbit() else {
        return std::ptr::null_mut();
    };
    release(pack_reference(&orbit))
}

/// Compute output rows `[row_start, row_end)`, as little-endian `f64`.
///
/// A band is a range of **output** rows, as it is in `engine.wasm`: at one sample
/// per pixel the two are the same range, and above it a band is the `supersample`
/// sample rows that reduce to those output rows. The coordinates are formed from
/// the whole viewport with a global row index, so a band is bit for bit the rows
/// a whole-frame pass would have produced.
///
/// The orbit buffer is **borrowed, not taken** — the caller keeps it for the next
/// band, which is the entire reason it crosses the boundary at all.
#[unsafe(no_mangle)]
pub extern "C" fn compute_band(
    spec_ptr: *const u8,
    spec_len: usize,
    orbit_ptr: *const u8,
    orbit_len: usize,
    row_start: u32,
    row_end: u32,
) -> *mut u8 {
    let Some(spec) = text(spec_ptr, spec_len).and_then(|text| Spec::parse(&text).ok()) else {
        return std::ptr::null_mut();
    };
    if row_end > spec.resolution[1] || row_start >= row_end || orbit_ptr.is_null() {
        return std::ptr::null_mut();
    }
    let bytes = unsafe { std::slice::from_raw_parts(orbit_ptr, orbit_len) };
    let Some(orbit) = unpack_reference(bytes) else {
        return std::ptr::null_mut();
    };
    let ss = spec.supersample;
    release(compute_rows(&spec, &orbit, row_start * ss, row_end * ss))
}

/// [`compute_listed`] across the boundary: `count` little-endian `u32` sample indices at
/// `index_ptr`, and `8 · count` bytes back, one `f64` per index in list order, freed by
/// the caller through [`dealloc`]. The orbit and the list are **borrowed**.
#[unsafe(no_mangle)]
pub extern "C" fn compute_samples(
    spec_ptr: *const u8,
    spec_len: usize,
    orbit_ptr: *const u8,
    orbit_len: usize,
    index_ptr: *const u8,
    count: u32,
) -> *mut u8 {
    let Some(spec) = text(spec_ptr, spec_len).and_then(|text| Spec::parse(&text).ok()) else {
        return std::ptr::null_mut();
    };
    if orbit_ptr.is_null() || index_ptr.is_null() || count == 0 {
        return std::ptr::null_mut();
    }
    let bytes = unsafe { std::slice::from_raw_parts(orbit_ptr, orbit_len) };
    let Some(orbit) = unpack_reference(bytes) else {
        return std::ptr::null_mut();
    };
    // Read as bytes, so the list need not be four-byte aligned in the heap.
    let raw = unsafe { std::slice::from_raw_parts(index_ptr, count as usize * 4) };
    let indices: Vec<u32> = raw
        .chunks_exact(4)
        .map(|word| u32::from_le_bytes([word[0], word[1], word[2], word[3]]))
        .collect();
    match compute_listed(&spec, &orbit, &indices) {
        Some(out) => release(out),
        None => std::ptr::null_mut(),
    }
}

// ------------------------------------------------- the minibrots in and around a view

/// One band of the atom-domain walk: the nuclei whose domains these probe rows
/// fall in.
///
/// **A band, for [`probe_band`]'s reason**, and the two are cut the same way over
/// the same grid: the walk runs to the escape or to the cap with no interior
/// shortcut, so on a frame that is mostly inside a minibrot it is seconds on one
/// worker and well under one over the pool. The orbit is **borrowed**, and it is
/// the frame's own.
///
/// Returns `{"ok":true,"seeds":[{"period":…,"from_re":…,"from_im":…,"minimum":…,
/// "cells":…}]}`, the offsets being **from the view centre**, which the page merges across bands by period — `cells` adds
/// and the smallest `minimum` wins, which is what [`nuclei::seeds`] does within
/// one.
#[unsafe(no_mangle)]
#[allow(clippy::too_many_arguments)]
pub extern "C" fn seed_band(
    spec_ptr: *const u8,
    spec_len: usize,
    orbit_ptr: *const u8,
    orbit_len: usize,
    cols: u32,
    rows: u32,
    row_start: u32,
    row_end: u32,
) -> *mut u8 {
    let read = text(spec_ptr, spec_len)
        .ok_or_else(|| "the spec is not UTF-8".to_string())
        .and_then(|text| Spec::parse(&text))
        .and_then(|spec| {
            if orbit_ptr.is_null() {
                return Err("no reference orbit".to_string());
            }
            let bytes = unsafe { std::slice::from_raw_parts(orbit_ptr, orbit_len) };
            let orbit = unpack_reference(bytes).ok_or("the reference orbit is malformed")?;
            let cols = if cols == 0 { nuclei::GRID_COLS } else { cols };
            let rows = if rows == 0 { nuclei::GRID_ROWS } else { rows };
            Ok(nuclei::seeds_in_rows(
                &spec, &orbit, cols, rows, row_start, row_end,
            ))
        });
    report(read.map(|seeds| {
        let mut body = String::from(r#"{"ok":true,"seeds":["#);
        for (index, seed) in seeds.iter().enumerate() {
            if index > 0 {
                body.push(',');
            }
            body.push_str(&format!(
                r#"{{"period":{},"from_re":{:e},"from_im":{:e},"minimum":{:e},"cells":{}}}"#,
                seed.period, seed.from_re, seed.from_im, seed.minimum, seed.cells,
            ));
        }
        body.push_str("]}");
        body
    }))
}

/// One Newton step on `z_p(c) = 0`, from a `c` that arrives as text and leaves
/// as text.
///
/// **One step a call, and that is the cancel granularity.** A wasm call cannot be
/// interrupted, and a step at a period of a hundred thousand is a tenth of a
/// second; the page drives the iteration so that a new search or a navigation
/// stops between steps rather than not at all.
///
/// **The `c` that comes back is the full decimal of what is stored**, all
/// `64(limbs−1)` digits of it, because the page feeds it straight back in as the
/// next step's input and a truncation there would be precision thrown away once
/// a step. `explorer/deep-link.js` is what trims a centre to what a link can
/// carry, and it happens once, at the end.
///
/// Takes `{"c_re":"…","c_im":"…","period":n,"limbs":k}` and returns
/// `{"ok":true,"c_re":"…","c_im":"…","moved":…,"size_log2":…,"window_log2":…,
/// "escaped":false}`.
#[unsafe(no_mangle)]
pub extern "C" fn newton_step(request_ptr: *const u8, request_len: usize) -> *mut u8 {
    const KNOWN: &[&str] = &["c_re", "c_im", "period", "limbs", "degree"];
    let read = text(request_ptr, request_len)
        .ok_or_else(|| "the request is not UTF-8".to_string())
        .and_then(|text| {
            let object = json::object(&text).ok_or("the request is not a flat JSON object")?;
            if let Some(name) = object.unknown(KNOWN) {
                return Err(format!("the request carries no member named `{name}`"));
            }
            let count = |key: &str| match object.get(key) {
                Some(json::Value::Num(value)) if *value >= 1.0 && value.fract() == 0.0 => {
                    Ok(*value as u32)
                }
                _ => Err(format!("`{key}` is a whole number of at least one")),
            };
            let coordinate = |key: &str| match object.get(key) {
                Some(json::Value::Str(value)) => Ok(value.clone()),
                _ => Err(format!(
                    "`{key}` has to be a string: a coordinate written as a JSON number has \
                     already lost the digits this module exists for"
                )),
            };
            let limbs = (count("limbs")? as usize).clamp(3, fx::MAX_LIMBS);
            let period = count("period")?;
            // Absent is two, as it is in a spec.
            let degree = match object.get("degree") {
                None => 2,
                Some(_) => match count("degree") {
                    Ok(degree) if kernel::DEGREES.contains(&degree) => degree,
                    _ => return Err("`degree` is a whole number from 2 to 6".to_string()),
                },
            };
            let re_text = coordinate("c_re")?;
            let im_text = coordinate("c_im")?;
            let c_re = Fx::parse(&re_text, limbs)
                .ok_or_else(|| format!("`{re_text}` is not a decimal"))?;
            let c_im = Fx::parse(&im_text, limbs)
                .ok_or_else(|| format!("`{im_text}` is not a decimal"))?;
            Ok((nuclei::newton_step(&c_re, &c_im, period, degree), limbs))
        });
    report(read.map(|(step, limbs)| {
        let digits = 64 * (limbs - 1);
        format!(
            concat!(
                r#"{{"ok":true,"c_re":"{}","c_im":"{}","moved":{:e},"#,
                r#""size_log2":{:e},"window_log2":{:e},"escaped":{}}}"#
            ),
            step.c_re.to_decimal(digits),
            step.c_im.to_decimal(digits),
            finite(step.moved),
            finite(step.size_log2),
            finite(step.window_log2),
            step.escaped,
        )
    }))
}

/// **A copy, a bulb, or neither said**: [`nuclei::classify`] on one solved nucleus
/// *(find_minibrots_bulbs_ckpt145; the root test since dive_primitive_only_ckpt154)*.
///
/// One request per nucleus rather than one per Newton step, as [`newton_step`] is:
/// a copy's reading is a handful of passes at its period per cusp, and a reader who
/// cancels loses at most that.
///
/// Takes `{"c_re":"…","c_im":"…","period":n,"limbs":k,"degree":d,"size_log2":x}`
/// and returns `{"ok":true,"kind":"copy"|"bulb"|"unresolved","parent":q,"m":m,
/// "reason":"…"|null,"cusps":n,"steps":n}` — `parent` and `m` zero unless a bulb;
/// `reason` [`nuclei::Unresolved::reason`] where the root test could not be carried
/// out, which the page treats as **not a copy**. `size_log2` is accepted and unread:
/// the reading measures the component's size from its own orbit.
#[unsafe(no_mangle)]
pub extern "C" fn classify_nucleus(request_ptr: *const u8, request_len: usize) -> *mut u8 {
    const KNOWN: &[&str] = &["c_re", "c_im", "period", "limbs", "degree", "size_log2"];
    let read = text(request_ptr, request_len)
        .ok_or_else(|| "the request is not UTF-8".to_string())
        .and_then(|text| {
            let object = json::object(&text).ok_or("the request is not a flat JSON object")?;
            if let Some(name) = object.unknown(KNOWN) {
                return Err(format!("the request carries no member named `{name}`"));
            }
            let count = |key: &str| match object.get(key) {
                Some(json::Value::Num(value)) if *value >= 1.0 && value.fract() == 0.0 => {
                    Ok(*value as u32)
                }
                _ => Err(format!("`{key}` is a whole number of at least one")),
            };
            let coordinate = |key: &str| match object.get(key) {
                Some(json::Value::Str(value)) => Ok(value.clone()),
                _ => Err(format!("`{key}` has to be a string")),
            };
            let limbs = (count("limbs")? as usize).clamp(3, fx::MAX_LIMBS);
            let period = count("period")?;
            let degree = match object.get("degree") {
                None => 2,
                Some(_) => match count("degree") {
                    Ok(degree) if kernel::DEGREES.contains(&degree) => degree,
                    _ => return Err("`degree` is a whole number from 2 to 6".to_string()),
                },
            };
            let size_log2 = match object.get("size_log2") {
                Some(json::Value::Num(value)) if value.is_finite() => *value,
                _ => return Err("`size_log2` is a finite number".to_string()),
            };
            let re_text = coordinate("c_re")?;
            let im_text = coordinate("c_im")?;
            let c_re = Fx::parse(&re_text, limbs)
                .ok_or_else(|| format!("`{re_text}` is not a decimal"))?;
            let c_im = Fx::parse(&im_text, limbs)
                .ok_or_else(|| format!("`{im_text}` is not a decimal"))?;
            let nucleus = nuclei::Nucleus {
                period,
                c_re,
                c_im,
                size_log2,
                window_log2: f64::NAN,
                steps: 0,
                residual: 0.0,
            };
            Ok(nuclei::classify(&nucleus, degree))
        });
    report(read.map(|reading| {
        let (kind, parent, m, reason) = match reading.kind {
            nuclei::Kind::Copy => ("copy", 0, 0, "null".to_string()),
            nuclei::Kind::Bulb { parent, m } => ("bulb", parent, m, "null".to_string()),
            nuclei::Kind::Unresolved(why) => ("unresolved", 0, 0, format!("\"{}\"", why.reason())),
        };
        format!(
            concat!(
                r#"{{"ok":true,"kind":"{}","parent":{},"m":{},"reason":{},"#,
                r#""cusps":{},"steps":{}}}"#
            ),
            kind, parent, m, reason, reading.cusps, reading.steps,
        )
    }))
}

// ------------------------------------------------------------------------- the dive

/// **The rung rule** *(deep_dive_block_ckpt154)*: which of a search's copies the Dive block
/// lands on, [`dive::pick`].
///
/// Takes `{"width":w,"degree":d,"count":n,"periods":[…],"off_re":[…],"off_im":[…],
/// "size_log2":[…],"copy":[1|0,…],"rung_re":[…],"rung_im":[…],"rung_size_log2":[…]}`, the
/// found copies largest first as parallel arrays and the dive's earlier rungs likewise, every
/// offset from the searched view's centre. Returns `{"ok":true,"index":i}`, or
/// `{"ok":true,"index":null,"refusal":"no_copy"|"none_smaller"|"over_budget","period":p,
/// "need":x}` — `period` and `need` naming, for a refusal on the budget, the lowest-period
/// copy that was a step down and what its landing asked for.
#[unsafe(no_mangle)]
pub extern "C" fn dive_pick(request_ptr: *const u8, request_len: usize) -> *mut u8 {
    const KNOWN: &[&str] = &[
        "width",
        "degree",
        "count",
        "periods",
        "off_re",
        "off_im",
        "size_log2",
        "copy",
        "rung_re",
        "rung_im",
        "rung_size_log2",
    ];
    let read = text(request_ptr, request_len)
        .ok_or_else(|| "the request is not UTF-8".to_string())
        .and_then(|text| {
            let object = json::object(&text).ok_or("the request is not a flat JSON object")?;
            if let Some(name) = object.unknown(KNOWN) {
                return Err(format!("the request carries no member named `{name}`"));
            }
            let number = |key: &str| match object.get(key) {
                Some(json::Value::Num(value)) if value.is_finite() => Ok(*value),
                _ => Err(format!("`{key}` is a finite number")),
            };
            let list = |key: &str| match object.get(key) {
                Some(json::Value::Nums(values)) => Ok(values.clone()),
                None => Ok(Vec::new()),
                _ => Err(format!("`{key}` is an array of numbers")),
            };
            let degree = number("degree")? as u32;
            if !kernel::DEGREES.contains(&degree) {
                return Err("`degree` is a whole number from 2 to 6".to_string());
            }
            let (periods, off_re, off_im) = (list("periods")?, list("off_re")?, list("off_im")?);
            let (sizes, copies) = (list("size_log2")?, list("copy")?);
            let found: Vec<dive::Candidate> = (0..periods.len())
                .map(|at| dive::Candidate {
                    period: periods[at] as u32,
                    off_re: off_re.get(at).copied().unwrap_or(f64::NAN),
                    off_im: off_im.get(at).copied().unwrap_or(f64::NAN),
                    size_log2: sizes.get(at).copied().unwrap_or(f64::NAN),
                    copy: copies.get(at).copied().unwrap_or(0.0) != 0.0,
                })
                .collect();
            let (r_re, r_im, r_size) =
                (list("rung_re")?, list("rung_im")?, list("rung_size_log2")?);
            let earlier: Vec<dive::Rung> = (0..r_re.len())
                .map(|at| dive::Rung {
                    off_re: r_re[at],
                    off_im: r_im.get(at).copied().unwrap_or(f64::NAN),
                    size_log2: r_size.get(at).copied().unwrap_or(f64::NAN),
                })
                .collect();
            let count = number("count")? as u32;
            Ok((
                dive::pick(&found, number("width")?, degree, &earlier, count),
                count,
            ))
        });
    report(read.map(|(picked, count)| match picked {
        Ok(index) => format!(r#"{{"ok":true,"index":{index}}}"#),
        Err(refusal) => {
            let (name, period) = match refusal {
                dive::Refusal::NoCopy => ("no_copy", 0),
                dive::Refusal::NoneSmaller => ("none_smaller", 0),
                dive::Refusal::OverBudget { period } => ("over_budget", period),
            };
            format!(
                r#"{{"ok":true,"index":null,"refusal":"{name}","period":{period},"need":{}}}"#,
                dive::need(period, count)
            )
        }
    }))
}

/// **A landing** *(deep_dive_block_ckpt154)*: [`dive::center`], [`dive::halfway`] or
/// [`dive::mapped`], as the frame a `dv=3` link carries.
///
/// Takes `{"landing":"center"|"halfway"|"mapped","degree":d,"re":"…","im":"…","period":p,
/// "size_log2":x}` for the copy, with `"found_in":w` for the halfway stage, and for a mapped
/// view `"view_re":"…","view_im":"…","view_width":w,"count":n` and, where a nucleus near the
/// view anchors it, `"anchor_re":"…","anchor_im":"…","anchor_period":q`. Returns
/// `{"ok":true,"re":"…","im":"…","width":w,"cap":n,"turn":t,"twin_period":p|null,
/// "twin_steps":[…]}`, or the refusal — a mapped landing whose `period × count` passes the
/// explicit ceiling among them. **The mapped landing's shooting is seconds at the largest
/// periods the budget lets through**, so the page asks a worker for it, never the planner.
#[unsafe(no_mangle)]
pub extern "C" fn dive_land(request_ptr: *const u8, request_len: usize) -> *mut u8 {
    const KNOWN: &[&str] = &[
        "landing",
        "degree",
        "re",
        "im",
        "period",
        "size_log2",
        "found_in",
        "view_re",
        "view_im",
        "view_width",
        "count",
        "anchor_re",
        "anchor_im",
        "anchor_period",
    ];
    let read = text(request_ptr, request_len)
        .ok_or_else(|| "the request is not UTF-8".to_string())
        .and_then(|text| {
            let object = json::object(&text).ok_or("the request is not a flat JSON object")?;
            if let Some(name) = object.unknown(KNOWN) {
                return Err(format!("the request carries no member named `{name}`"));
            }
            let number = |key: &str| match object.get(key) {
                Some(json::Value::Num(value)) if value.is_finite() => Ok(*value),
                _ => Err(format!("`{key}` is a finite number")),
            };
            let count_of = |key: &str| match object.get(key) {
                Some(json::Value::Num(value)) if *value >= 1.0 && value.fract() == 0.0 => {
                    Ok(*value as u32)
                }
                _ => Err(format!("`{key}` is a whole number of at least one")),
            };
            let string = |key: &str| match object.get(key) {
                Some(json::Value::Str(value)) => Ok(value.clone()),
                _ => Err(format!("`{key}` has to be a string")),
            };
            let degree = count_of("degree")?;
            if !kernel::DEGREES.contains(&degree) {
                return Err("`degree` is a whole number from 2 to 6".to_string());
            }
            let (re, im) = (string("re")?, string("im")?);
            let period = count_of("period")?;
            match string("landing")?.as_str() {
                "center" => Ok(dive::center(&re, &im, period, number("size_log2")?, degree)),
                "halfway" => Ok(dive::halfway(
                    &re,
                    &im,
                    period,
                    number("size_log2")?,
                    degree,
                    number("found_in")?,
                )),
                "mapped" => {
                    let count = count_of("count")?;
                    if !dive::fits(period, count) {
                        return Err(format!(
                            "a view drawn at {count} iterations, carried into a period-{period} \
                             copy, asks for {} and the ceiling is {}",
                            dive::need(period, count),
                            cap::EXPLICIT_CEILING
                        ));
                    }
                    let (v_re, v_im) = (string("view_re")?, string("view_im")?);
                    let anchor = match object.get("anchor_re") {
                        None => None,
                        Some(_) => Some((
                            string("anchor_re")?,
                            string("anchor_im")?,
                            count_of("anchor_period")?,
                        )),
                    };
                    dive::mapped(
                        (&re, &im, period),
                        degree,
                        (&v_re, &v_im, number("view_width")?, count),
                        anchor
                            .as_ref()
                            .map(|(a, b, p)| (a.as_str(), b.as_str(), *p)),
                    )
                }
                other => Err(format!("`{other}` is not a landing")),
            }
        });
    report(read.map(|frame| {
        let (twin_period, steps) = match &frame.twin {
            Some((p, steps)) => (
                p.to_string(),
                steps
                    .iter()
                    .map(|s| format!("{:e}", finite(*s)))
                    .collect::<Vec<_>>()
                    .join(","),
            ),
            None => ("null".to_string(), String::new()),
        };
        format!(
            concat!(
                r#"{{"ok":true,"re":"{}","im":"{}","width":{:e},"cap":{},"turn":{},"#,
                r#""twin_period":{},"twin_steps":[{}]}}"#
            ),
            frame.re,
            frame.im,
            frame.width,
            frame.cap,
            finite(frame.turn),
            twin_period,
            steps,
        )
    }))
}

/// How many of its copy's periods a landing is iterated for — `0` the centre, `1` the
/// halfway stage — so the page's budget check asks rather than restates. A mapped landing's
/// count is its view's own cap. See [`dive::Landing::count`].
#[unsafe(no_mangle)]
pub extern "C" fn landing_periods(kind: u32) -> u32 {
    match kind {
        0 => dive::Landing::Center.count(),
        _ => dive::Landing::Halfway.count(),
    }
}

/// **New coloring's rule** *(deep_dive_block_ckpt154)*: [`dive::coloring`] over a field at
/// the cycles [`dive::cycles`] draws with `cycles_pick`, and the λ [`dive::choose`] takes with
/// `pick` — both uniform in `[0, 1)`, drawn by the caller, so the whole rule is this crate's
/// and a caller's randomness is two numbers it can record.
///
/// The field is `count` little-endian `f64`s, `width × height` of them read as the grid,
/// `NaN` for the interior — lane 0 as either kernel lays it out. **Borrowed**, like an orbit.
/// Returns `{"ok":true,"cycles":c,"lambda":λ,"period":P,"roughness":r,"tried":[{"lambda":…,"period":…,
/// "roughness":…},…]}`, or a refusal where the field has too little exterior to measure.
#[unsafe(no_mangle)]
pub extern "C" fn coloring_rule(
    values_ptr: *const u8,
    count: usize,
    width: u32,
    height: u32,
    cycles_pick: f64,
    pick: f64,
) -> *mut u8 {
    let cycles = dive::cycles(cycles_pick);
    let read = if values_ptr.is_null() {
        Err("no field".to_string())
    } else {
        let bytes = unsafe { std::slice::from_raw_parts(values_ptr, count * 8) };
        let values: Vec<f64> = bytes
            .chunks_exact(8)
            .map(|b| f64::from_le_bytes(b.try_into().unwrap()))
            .collect();
        dive::coloring(&values, width as usize, height as usize, cycles)
            .ok_or_else(|| "this picture has too little outside the set to color by".to_string())
    };
    report(read.map(|tried| {
        let chosen = dive::choose(&tried, pick);
        let each: Vec<String> = tried
            .iter()
            .map(|t| {
                format!(
                    r#"{{"lambda":{},"period":{},"roughness":{}}}"#,
                    t.lambda,
                    finite(t.period),
                    finite(t.roughness)
                )
            })
            .collect();
        format!(
            r#"{{"ok":true,"cycles":{},"lambda":{},"period":{},"roughness":{},"tried":[{}]}}"#,
            cycles,
            chosen.lambda,
            finite(chosen.period),
            finite(chosen.roughness),
            each.join(",")
        )
    }))
}

/// The limb count a nucleus found in a view of this width is solved at, so the
/// page does not restate the rule. See [`nuclei::limbs_for_nucleus`].
#[unsafe(no_mangle)]
pub extern "C" fn nucleus_limbs(width: f64, tile_samples: u32, degree: u32) -> u32 {
    // A caller that passes no degree passes zero, which is two.
    let degree = if kernel::DEGREES.contains(&degree) {
        degree
    } else {
        2
    };
    nuclei::limbs_for_nucleus(width, tile_samples, degree) as u32
}

/// The cap a preview tile of a period-`p` nucleus is drawn at.
///
/// **The page asks rather than restates**, because this one is not the width
/// policy and a page that guessed it would draw a black rectangle: see
/// [`nuclei::TILE_PERIODS`], which is where the measurement is.
#[unsafe(no_mangle)]
pub extern "C" fn tile_cap(period: u32, width: f64) -> u32 {
    nuclei::tile_cap(period, width)
}

/// The cap an opened minibrot of period `p` is drawn at, and the `n` its link
/// carries — four times a tile's periods. See [`nuclei::OPEN_PERIODS`].
#[unsafe(no_mangle)]
pub extern "C" fn open_cap(period: u32, width: f64) -> u32 {
    nuclei::open_cap(period, width)
}

/// How wide a preview tile is, given the body it frames. See
/// [`nuclei::TILE_BODIES`].
#[unsafe(no_mangle)]
pub extern "C" fn tile_width(size: f64) -> f64 {
    size * nuclei::TILE_BODIES
}

/// How wide to frame a copy of this size at this degree, before its body has been
/// measured or where it cannot be. See [`nuclei::copy_width`]. A caller that passes
/// no degree passes zero, which is two.
#[unsafe(no_mangle)]
pub extern "C" fn copy_width(size: f64, degree: u32) -> f64 {
    let degree = if kernel::DEGREES.contains(&degree) {
        degree
    } else {
        2
    };
    nuclei::copy_width(size, degree)
}

/// What [`newton_step`] means by a number JSON cannot carry: a step that did not
/// move.
///
/// [`json::finite`] is where the rule that `NaN` and the infinities are not JSON
/// lives; the answer is here because it is this export's and not `plan`'s, which
/// says `null` to the same question.
fn finite(value: f64) -> f64 {
    json::finite(value).unwrap_or(0.0)
}

/// This crate's cap policy, so a page does not restate it.
#[unsafe(no_mangle)]
pub extern "C" fn maxiter_for_width(width: f64) -> u32 {
    cap::for_width(width)
}

/// The limb count a view of this width and this many samples across is computed
/// at — the one number that says how much the reference orbit will cost.
#[unsafe(no_mangle)]
pub extern "C" fn limbs_for_width(width: f64, sample_width: u32) -> u32 {
    reference::limbs_for(width, sample_width) as u32
}

// -------------------------------------------------------------- the cap the frame asks for

/// One band of one rung of the cap policy: what died at this spec's cap, and how.
///
/// **A band, for a band's reason.** The probe is a few thousand of the frame's
/// own sample cells at whatever cap is being tried, and on the frames that want
/// four rungs the deepest of them is seconds; cut into row ranges it is spread
/// over the same pool a field is and a reader can cancel between rungs. See
/// [`policy`] for what the three kinds of cap-death are and why only one of them
/// is the cap's fault.
///
/// The orbit is **borrowed, not taken**, exactly as [`compute_band`] borrows it,
/// and it is the orbit for *this rung's* cap. `cols` and `rows` are the probe
/// grid — the page names its own, since how finely to probe is a cost the pool
/// pays; zero takes [`policy::PROBE_COLS`] and [`policy::PROBE_ROWS`].
///
/// Returns the same length-prefixed JSON [`plan`] does.
#[unsafe(no_mangle)]
#[allow(clippy::too_many_arguments)]
pub extern "C" fn probe_band(
    spec_ptr: *const u8,
    spec_len: usize,
    orbit_ptr: *const u8,
    orbit_len: usize,
    cols: u32,
    rows: u32,
    row_start: u32,
    row_end: u32,
) -> *mut u8 {
    let read = text(spec_ptr, spec_len)
        .ok_or_else(|| "the spec is not UTF-8".to_string())
        .and_then(|text| Spec::parse(&text))
        .and_then(|spec| {
            if orbit_ptr.is_null() {
                return Err("no reference orbit".to_string());
            }
            let bytes = unsafe { std::slice::from_raw_parts(orbit_ptr, orbit_len) };
            let orbit = unpack_reference(bytes).ok_or("the reference orbit is malformed")?;
            let cols = if cols == 0 { policy::PROBE_COLS } else { cols };
            let rows = if rows == 0 { policy::PROBE_ROWS } else { rows };
            Ok(policy::probe_rows(
                &spec, &orbit, cols, rows, row_start, row_end,
            ))
        });
    report(read.map(|counts| {
        format!(
            concat!(
                r#"{{"ok":true,"maxiter":{},"samples":{},"escaped":{},"proven":{},"#,
                r#""starved":{},"fault":{},"iterations":{}}}"#
            ),
            counts.maxiter,
            counts.samples,
            counts.escaped,
            counts.proven,
            counts.starved,
            counts.fault,
            counts.iterations,
        )
    }))
}

/// The share of a frame that may still be the cap's fault before the cap is
/// raised. [`policy::FAULT_SHARE`], so that the threshold is written once and
/// the page compares against it rather than restating it.
#[unsafe(no_mangle)]
pub extern "C" fn fault_share() -> f64 {
    policy::FAULT_SHARE
}

/// The next cap to try after one that did not resolve the frame, saturating at
/// [`cap::AUTOMATIC_CEILING`]. [`policy::next_cap`].
#[unsafe(no_mangle)]
pub extern "C" fn next_cap(maxiter: u32) -> u32 {
    policy::next_cap(maxiter)
}

// ------------------------------------------------------------------ the buffers

/// Lend the module `len` bytes. JavaScript owns them until it says otherwise.
#[unsafe(no_mangle)]
pub extern "C" fn alloc(len: usize) -> *mut u8 {
    let mut buffer = Vec::<u8>::with_capacity(len);
    let pointer = buffer.as_mut_ptr();
    std::mem::forget(buffer);
    pointer
}

/// Take back what [`alloc`] lent, or what an export returned.
///
/// # Safety
/// `ptr` and `len` are a pair this module handed out and has not already taken
/// back.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn dealloc(ptr: *mut u8, len: usize) {
    if !ptr.is_null() {
        drop(unsafe { Vec::from_raw_parts(ptr, len, len) });
    }
}

/// A borrowed UTF-8 buffer, as a `String` this module owns.
fn text(ptr: *const u8, len: usize) -> Option<String> {
    if ptr.is_null() {
        return None;
    }
    let bytes = unsafe { std::slice::from_raw_parts(ptr, len) };
    core::str::from_utf8(bytes).ok().map(str::to_string)
}

/// Hand a buffer to JavaScript, which frees it through [`dealloc`].
fn release(bytes: Vec<u8>) -> *mut u8 {
    let mut bytes = bytes;
    bytes.shrink_to_fit();
    let pointer = bytes.as_mut_ptr();
    std::mem::forget(bytes);
    pointer
}

/// **What every export that answers with a sentence hands back**: the report it
/// produced, or the refusal, as length-prefixed JSON.
///
/// Four exports answer this way — [`plan`], [`probe_band`], [`seed_band`] and
/// [`newton_step`] — and each used to carry its own `{"ok":false,"why":…}` arm
/// *(deep_refactor_ckpt138)*. One of them was going to get it subtly wrong: the
/// page reads `ok` before anything else, so a refusal missing that field is a
/// report the tab treats as an answer. The shape is written once here, and a
/// fifth export gets it by construction.
fn report(answer: Result<String, String>) -> *mut u8 {
    release_text(&match answer {
        Ok(body) => body,
        Err(why) => format!(r#"{{"ok":false,"why":{}}}"#, json::quote(&why)),
    })
}

/// The same, for text: four bytes of little-endian length, then the UTF-8.
fn release_text(text: &str) -> *mut u8 {
    let mut bytes = Vec::with_capacity(4 + text.len());
    bytes.extend_from_slice(&(text.len() as u32).to_le_bytes());
    bytes.extend_from_slice(text.as_bytes());
    release(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::json::Value;

    const ANCHOR: &str = r#"{
        "schema": 1,
        "center_re": "-0.74501772828532335842941892835857434",
        "center_im": "0.14993443275456819177805709088257971",
        "width": 2e-11,
        "resolution": [480, 270]
    }"#;

    // ------------------------------------------------------------------ julia

    /// The anchor spec with a Julia parameter bolted on: the same deep `c`, now
    /// drawn as the Julia set of itself at `z = c`.
    fn julia_spec() -> String {
        ANCHOR.replace(
            r#""resolution": [480, 270]"#,
            r#""resolution": [480, 270],
              "julia_re": "-0.74501772828532335842941892835857434",
              "julia_im": "0.14993443275456819177805709088257971""#,
        )
    }

    /// The anchor's `c`, drawn as a Julia set, framed at `z = 0` — a full 0.76
    /// away from the anchor the arithmetic is measured against.
    fn far_spec(width: f64) -> String {
        julia_spec()
            .replace(
                r#""center_re": "-0.74501772828532335842941892835857434""#,
                r#""center_re": "0""#,
            )
            .replace(
                r#""center_im": "0.14993443275456819177805709088257971""#,
                r#""center_im": "0""#,
            )
            .replace(r#""width": 2e-11"#, &format!(r#""width": {width:e}"#))
    }

    #[test]
    fn a_frame_too_far_from_its_anchor_is_refused_in_a_sentence() {
        let report = plan_text(&far_spec(1e-20));
        assert!(report.contains(r#""ok":false"#), "{report}");
        assert!(report.contains("flat"), "{report}");
    }

    #[test]
    fn a_julia_spec_plans_and_says_which_anchor_it_is_drawn_from() {
        let report = plan_text(&julia_spec());
        assert!(report.contains(r#""julia":true"#), "{report}");
        assert!(report.contains(r#""anchor":"parameter""#), "{report}");
        // Infinite is not JSON, and a reader of this report is `JSON.parse`.
        assert!(report.contains(r#""delta_ulps":null"#), "{report}");
        assert!(!report.contains("inf"), "{report}");
    }

    /// `plan` refuses the origin anchor past the limbs its square needs, in a sentence.
    #[test]
    fn plan_refuses_an_origin_frame_too_narrow_for_its_limbs() {
        let past = far_spec(1e-150).replace(r#""schema": 1"#, r#""schema": 1, "anchor": "origin""#);
        let report = plan_text(&past);
        assert!(report.contains(r#""ok":false"#), "{report}");
        assert!(report.contains("limbs"), "{report}");
    }

    /// `plan` reports the degree a spec carries, two to six.
    #[test]
    fn plan_reports_the_degree() {
        let with = |degree: &str| {
            ANCHOR.replace(
                r#""schema": 1"#,
                &format!(r#""schema": 1, "degree": {degree}"#),
            )
        };
        for degree in 2..=6 {
            let report = plan_text(&with(&degree.to_string()));
            assert!(
                report.contains(&format!(r#""degree":{degree}"#)),
                "{report}"
            );
        }
    }

    /// `plan` says where `dc` comes from in numbers that round-trip: the offset the band
    /// reads, the entry, and the plane's own `f64`s.
    #[test]
    fn plan_carries_the_frames_dc_constants() {
        let report = plan_text(&julia_spec());
        assert!(report.contains(r#""entry":1"#), "{report}");
        assert!(report.contains(r#""offset_re":0e0"#), "{report}");
        assert!(report.contains(r#""width":2e-11"#), "{report}");
        assert!(report.contains(r#""interior_floor":-64"#), "{report}");
        let object = json::object(&report).unwrap();
        let spec = Spec::parse(&julia_spec()).unwrap();
        match object.get("spacing") {
            Some(Value::Num(value)) => assert_eq!(*value, spec.width / 480.0),
            other => panic!("{other:?}"),
        }
    }

    /// `plan`'s report, read back as text.
    fn plan_text(spec: &str) -> String {
        let bytes = spec.as_bytes();
        let out = plan(bytes.as_ptr(), bytes.len());
        let size = unsafe { std::ptr::read_unaligned(out as *const u32) } as usize;
        let body = unsafe { std::slice::from_raw_parts(out.add(4), size) };
        let text = String::from_utf8(body.to_vec()).unwrap();
        unsafe { dealloc(out, size + 4) };
        text
    }
}
