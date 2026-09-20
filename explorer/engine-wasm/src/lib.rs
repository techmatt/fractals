//! The renderer the explorer page runs, as a raw `wasm32-unknown-unknown` module.
//!
//! Three exports carry the page, and the seam between the last two is the whole
//! design:
//!
//! ```text
//! plan(spec)                -> JSON        what this spec implies, or why not
//! compute_band(spec, rows)  -> f64 lanes   expensive, split over workers
//! shade(spec, lanes)        -> RGBA bytes  a frame at a time, and it owns them
//! ```
//!
//! `shade_level` is `shade` with the autolevel operator's measure half after it —
//! the finished picture measured, and where it acts the same field coloured again
//! through a curved map — and `derive_level` is that measurement alone, for a test.
//! `shade_level` also derives an angle mode's texture weight from the lanes it holds, and
//! `probe_band` and `derive_opacity` do the same for a trap's opacity: see [`derive`].
//!
//! A field is what costs seconds; a color is what costs milliseconds. Computing
//! them apart is what lets a worker own a band of rows, and lets a palette change
//! recolor a picture that is already on the screen without iterating anything
//! again. It is the same seam [`fractal_engine`] keeps between its `field` and
//! `coloring` modules, held open one level further out so that JavaScript sits in
//! it.
//!
//! **One spec, and the module answers what it implies.** Every export above takes
//! the same JSON object — the engine's own render spec, minus the two keys that
//! name files — so a family, a degree, a constant, a mode, a mode parameter, a
//! palette recipe and a colormap have exactly one spelling on this boundary, and
//! adding a family is not adding an export. `plan` is what JavaScript reads first:
//! it says how many lanes the coloring needs, which of them may not be narrowed to
//! `f32`, whether the mode paints during the iteration instead of making a field
//! at all, and where the family comes home to. Everything the page would otherwise
//! have to know about the mode catalog it asks for instead.
//!
//! No wasm-bindgen. The module is the engine plus this file, JS owns every buffer
//! through [`alloc`] and [`dealloc`], and nothing is generated.
//!
//! **The engine decides everything a picture depends on.** The iteration cap is
//! `maxiter::for_width`, the coloring is whatever `mode::resolve` says a mode is,
//! the blend of a composite and the perturbation of the modulate are
//! `coloring::composite` and `coloring::modulate`, a direct trap's stroke is
//! `direct_trap::Painter::trace`, and the last pass is `resample::downsample` —
//! Lanczos-3 in linear light, at whatever supersample the spec asked for, which is
//! why a download from this page is the wallpaper pipeline's own picture and not a
//! canvas scaled. This file chooses a row range and nothing else.
//!
//! ## No loop of its own
//!
//! [`compute_band`] does not iterate anything: it calls
//! [`fractal_engine::field::sweep_row`], the engine's own table of specialized
//! call sites, a row at a time. That table forms its coordinates from the *whole*
//! viewport with a global row index — which is exactly what a band needs, and the
//! reason this file used to carry a hand-written copy of the escape loop instead.
//! Every lane of the coloring is reduced from one orbit inside that table, so a
//! two-field composite costs one iteration rather than two, and there is no second
//! spelling of the recurrence on this side of the boundary to drift out of step
//! with the engine's.

use std::collections::BTreeMap;

use fractal_engine::coloring::{self, Coloring, Layer, Palette, Rolloff};
use fractal_engine::colormap::{Colormap, Kind};
use fractal_engine::direct_trap;
use fractal_engine::family::{Family, HomeView};
use fractal_engine::field::{self, Channels, Exact, Field, FieldSpec};
use fractal_engine::iterate::Wants;
use fractal_engine::spec::{FamilySpec, ViewportSpec};
use fractal_engine::viewport::Viewport;
use fractal_engine::{maxiter, mode, resample};
use num_complex::Complex;
use serde::Deserialize;

mod derive;
mod inflect;
mod level;

/// The name a colormap baked from control points is given. It exists only to
/// appear in the engine's own refusal messages — the page addresses maps by the
/// name a permalink carries, and never asks this module to look one up.
const COLORMAP_NAME: &str = "explorer";

// ----------------------------------------------------------------------- the spec

/// One picture, as JSON. The engine's own render spec minus `output` and
/// `colormap_dir`, plus the two things a page needs that a file render does not:
/// the colormap by value rather than by name, and the mode's parameters apart from
/// the mode.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct Spec {
    schema: u32,
    family: FamilySpec,
    /// Anything omitted falls back to the family's home view, exactly as a render
    /// spec's does — which is also how the page asks what that home view is.
    #[serde(default)]
    viewport: ViewportSpec,
    #[serde(default = "one_by_one")]
    resolution: [u32; 2],
    /// Samples per output pixel per axis. One is what the page draws at — an
    /// explorer shows the resolution it computes — and a download asks for more.
    /// The extra samples are reduced by the engine's own [`resample::downsample`],
    /// the Lanczos-3-in-linear-light a finished wallpaper is written through, so a
    /// download at four is the picture the wallpaper pipeline would have drawn for
    /// this spec rather than a canvas scaled up and back.
    #[serde(default = "one")]
    supersample: u32,
    #[serde(default = "smooth")]
    mode: String,
    /// The mode's own constants, by the name the permalink gives them. A key the
    /// mode has no room for is refused rather than ignored: a knob that silently
    /// did nothing would look exactly like a knob that worked.
    #[serde(default)]
    params: BTreeMap<String, f64>,
    #[serde(default)]
    palette: Palette,
    /// Absent is legal, and means *this spec is a question rather than a render*:
    /// the page asks for a home view before it has a picture to color.
    #[serde(default)]
    colormap: Option<ColormapSpec>,
    /// The tone curve a run's `band_autolevel/v1` derived, replayed on this map's
    /// stops. Absent means no curve is replayed: either the operator did not act, or
    /// the caller is [`shade_level`] asking to measure one — see [`level`].
    #[serde(default)]
    autolevel: Option<level::Curve>,
    /// Iterations per sample, where the caller wants a cap other than the engine's
    /// depth policy. **A probe's knob and never a picture's**: the walk panel asks
    /// for 256 on the 64×36 straddle probe, which is what the sampler's own
    /// `dump-field` runs at, and nothing a permalink opens ever sets it — the
    /// contract has no key for it, because a picture's cap is the policy's.
    #[serde(default)]
    maxiter: Option<u32>,
    /// The inflection points, in click order, each as a decimal pair — see [`inflect`].
    ///
    /// **Absent is the whole of the compatibility story.** An empty list means no
    /// pre-map, which means the starting point is `view.sample_point` exactly as it has
    /// always been, and the code that draws it is the engine's table exactly as it has
    /// always been. Every spec this page wrote before this key existed is a spec without
    /// it, and draws the same bytes.
    #[serde(default)]
    inflections: Vec<[String; 2]>,
}

/// A colormap as its control points, because the page has no filesystem to load
/// one from.
///
/// The positions are `f64` and not a quantized byte — the engine does not require
/// a map's stops to be evenly spaced, and rounding them would bend every gradient
/// slightly rather than fail loudly.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct ColormapSpec {
    kind: Kind,
    stops: Vec<(f64, [u8; 3])>,
}

fn one_by_one() -> [u32; 2] {
    [1, 1]
}

fn one() -> u32 {
    1
}

fn smooth() -> String {
    "smooth".to_string()
}

// -------------------------------------------------------------------- the resolve

/// A spec with every string parsed, every default filled in, and every refusal
/// already made.
struct Plan {
    family: Family,
    home: HomeView,
    view: Viewport,
    maxiter: u32,
    coloring: Coloring,
    palette: Palette,
    colormap: Option<Colormap>,
    /// The map's control points as they arrived, before any curve: what a view that
    /// measures its own tone curves and bakes again. See [`shade_level`].
    source: Option<(Kind, Vec<(f64, [u8; 3])>)>,
    /// Whether the spec carried a curve to replay. A picture drawn through one is
    /// already levelled, and measuring it would level it twice.
    replays: bool,
    /// The curve it carried, kept so that [`curve_stops`] can hand a caller the stops
    /// this plan's own map was baked from rather than making it send the curve back.
    curve: Option<level::Curve>,
    /// The fields this coloring reads, in the order this module stores them: base
    /// first, texture second. Empty for a direct trap, which reads none.
    lanes: Vec<Layer>,
    /// Which lanes must not be narrowed to `f32`. One coloring needs this — see
    /// [`fractal_engine::field::Exact`].
    exact: Vec<bool>,
    /// The texture weight the catalog settled this mode at, before any parameter the
    /// spec carried: the ceiling a derived weight is held under. `None` off a composite.
    settled_weight: Option<f64>,
    /// The inflection pre-map, in click order. Empty on every spec but the Inflection
    /// tab's, and empty is the identity — see [`inflect::premap`].
    inflections: Vec<Complex<f64>>,
}

impl Plan {
    fn direct(&self) -> bool {
        matches!(self.coloring, Coloring::Direct { .. })
    }

    /// Whether `band_autolevel/v1` acts on this coloring at all: the operator's own
    /// `applies_to`, a field coloring and a composite and nothing else.
    fn levels(&self) -> bool {
        matches!(
            self.coloring,
            Coloring::Field { .. } | Coloring::Composite { .. }
        )
    }

    /// Samples in one band of rows.
    fn band_samples(&self, row_start: u32, row_end: u32) -> usize {
        (row_end - row_start) as usize * self.view.sample_width() as usize
    }
}

fn resolve(text: &str) -> Result<Plan, String> {
    let spec: Spec = serde_json::from_str(text).map_err(|e| format!("spec: {e}"))?;
    if spec.schema != 1 {
        return Err(format!("spec has schema {}, expected 1", spec.schema));
    }

    let resolved = spec.family.resolve()?;
    let family = resolved.family;
    // A render-only family has no home view and no place in anything but a written
    // render — see `Family::is_render_only`. The explorer is a door, so it refuses.
    let home = family.home_view().ok_or_else(|| {
        "this family is render-only: it draws pictures by written spec and has no home view, so \
         there is nowhere for an explorer to open it at"
            .to_string()
    })?;

    let read = |written: Option<String>, at: f64, key: &str| match written {
        Some(text) => decimal(&text, key),
        None => Ok(at),
    };
    let center = Complex::new(
        read(spec.viewport.center_re, home.center.re, "center_re")?,
        read(spec.viewport.center_im, home.center.im, "center_im")?,
    );
    let width = read(spec.viewport.width, home.width, "width")?;
    if !(width > 0.0) {
        return Err(format!("the view's width has to be positive, got {width}"));
    }

    let [out_width, out_height] = spec.resolution;
    if out_width == 0 || out_height == 0 {
        return Err("the resolution has to be positive in both dimensions".into());
    }
    if spec.supersample == 0 {
        return Err("the supersample factor has to be at least one".into());
    }
    let view = Viewport {
        center,
        width,
        out_width,
        out_height,
        supersample: spec.supersample,
    };
    // The engine's own floor, asked the engine's own way. The page reads
    // `resolution_ulps` against `resolution_ulps_floor` before it zooms, so this is
    // the second refusal and not the first.
    if !view.is_resolvable_in_f64() {
        return Err(format!(
            "the samples of this view are {:.2} of a unit of last place apart, so neighbouring \
             samples would round to the same number and the picture would be of the arithmetic",
            view.resolution_ulps()
        ));
    }

    let settled = mode::resolve(&spec.mode, Some(&family))?;
    let settled_weight = match &settled {
        Coloring::Composite { texture_weight, .. } => Some(*texture_weight),
        _ => None,
    };
    let coloring = tune(&spec.mode, settled, &spec.params)?;
    coloring.validate()?;
    spec.palette.validate()?;
    coloring.agrees_with(&spec.palette)?;
    coloring.agrees_with_family(&family)?;

    // The operator acts on the map, not on the picture, so this is the one place it
    // can go: the stops are curved and then baked exactly as they would have been.
    // The refusal below is the operator's own `applies_to` — it acts on a field
    // coloring and on a composite and on nothing else, so a link asking for it under
    // a direct trap or the modulate would be replaying a decision no run ever took.
    if let Some(curve) = &spec.autolevel {
        curve.validate()?;
        if !matches!(
            coloring,
            Coloring::Field { .. } | Coloring::Composite { .. }
        ) {
            return Err(format!(
                "{} does not act on this mode: the operator reads a finished picture's tone \
                 and only a field coloring or a composite is measured that way, so there is \
                 no curve for {} to replay",
                level::OPERATOR,
                spec.mode
            ));
        }
    }
    let replays = spec.autolevel.is_some();
    let colormap = match &spec.colormap {
        Some(map) => {
            let curved;
            let stops: &[(f64, [u8; 3])] = match &spec.autolevel {
                Some(curve) => {
                    curved = level::curved_stops(&map.stops, curve);
                    &curved
                }
                None => &map.stops,
            };
            Some(Colormap::from_stops_baked(
                COLORMAP_NAME,
                map.kind,
                stops,
                spec.palette.bake,
            )?)
        }
        None => None,
    };
    let source = spec.colormap.map(|map| (map.kind, map.stops));
    if spec.maxiter == Some(0) {
        return Err("maxiter has to be at least one".into());
    }

    // The pre-map, and every refusal it brings, before a band is planned. An empty list
    // takes none of these branches and leaves the plan exactly as it was.
    let mut inflections = Vec::with_capacity(spec.inflections.len());
    if !spec.inflections.is_empty() {
        if spec.inflections.len() > inflect::MAX_INFLECTIONS {
            return Err(format!(
                "an inflected picture carries at most {} points, and this spec has {}",
                inflect::MAX_INFLECTIONS,
                spec.inflections.len()
            ));
        }
        if let Some(why) = inflect::refuse_family(&family) {
            return Err(why);
        }
        for (at, [re, im]) in spec.inflections.iter().enumerate() {
            inflections.push(Complex::new(
                decimal(re, &format!("inflections[{at}].re"))?,
                decimal(im, &format!("inflections[{at}].im"))?,
            ));
        }
    }

    let lanes = lanes_of(&coloring);
    if !inflections.is_empty() {
        let wants = lanes
            .iter()
            .map(|layer| layer.field.wants())
            .fold(Wants::default(), Wants::union);
        if let Some(why) = inflect::refuse_wants(&wants) {
            return Err(why);
        }
    }
    // The modulate's texture is a base-`k` expansion whose deep digits are the
    // picture, so it is the one lane the engine never narrows. Everything else
    // crosses at the `f32` a dumped field would have been stored as, which is what
    // keeps this module's picture the engine's picture rather than a finer one.
    let exact = (0..lanes.len())
        .map(|lane| matches!(coloring, Coloring::Modulate { .. }) && lane == 1)
        .collect();

    Ok(Plan {
        family,
        home,
        view,
        maxiter: spec.maxiter.unwrap_or_else(|| maxiter::for_width(width)),
        coloring,
        palette: spec.palette,
        colormap,
        source,
        replays,
        curve: spec.autolevel,
        lanes,
        exact,
        settled_weight,
        inflections,
    })
}

fn decimal(text: &str, key: &str) -> Result<f64, String> {
    text.trim()
        .parse::<f64>()
        .ok()
        .filter(|value| value.is_finite())
        .ok_or_else(|| format!("{key} is not a number this arithmetic can hold: '{text}'"))
}

/// The fields a coloring reads, in the order this module stores them.
fn lanes_of(coloring: &Coloring) -> Vec<Layer> {
    match coloring {
        Coloring::Field { field, transform } => vec![Layer {
            field: *field,
            transform: *transform,
        }],
        Coloring::Composite { base, texture, .. } | Coloring::Modulate { base, texture, .. } => {
            vec![*base, *texture]
        }
        Coloring::Direct { .. } => Vec::new(),
    }
}

/// Apply the mode's own parameters to the coloring the catalog resolved.
///
/// **A parameter is a number `mode::resolve` writes down for that mode**, and
/// nothing else. The *shape* of the coloring is the mode's identity — which field,
/// which blend, which trap shape, which start color — and moving any of those
/// would put a different picture on the screen under the first one's name, so none
/// of them is reachable here at all. What is left is the settled constants: how
/// dense the stripes are, how wide the threads kernel is, how much of a texture is
/// let through, how close a trap has to come.
///
/// A key the mode has no room for is an error. There is no default to fall back to
/// that would not be a lie about what the reader asked for.
fn tune(
    name: &str,
    mut coloring: Coloring,
    params: &BTreeMap<String, f64>,
) -> Result<Coloring, String> {
    for (key, &value) in params {
        if !value.is_finite() {
            return Err(format!("{key} has to be a number, got {value}"));
        }
        set(name, &mut coloring, key, value)?;
    }
    Ok(coloring)
}

fn set(name: &str, coloring: &mut Coloring, key: &str, value: f64) -> Result<(), String> {
    // The knobs the coloring itself carries: how a pair is mixed, how far an
    // address pushes, how a trap paints.
    match (key, &mut *coloring) {
        ("weight", Coloring::Composite { texture_weight, .. }) => {
            *texture_weight = value;
            return Ok(());
        }
        ("shift", Coloring::Modulate { shift, .. }) => {
            *shift = value;
            return Ok(());
        }
        ("threshold", Coloring::Direct { threshold, .. }) => {
            *threshold = Some(value);
            return Ok(());
        }
        ("opacity", Coloring::Direct { opacity, .. }) => {
            *opacity = value;
            return Ok(());
        }
        ("radius", Coloring::Direct { trap_radius, .. }) => {
            *trap_radius = value;
            return Ok(());
        }
        _ => {}
    }
    // The knobs the mode's own field carries. The *characteristic* field: a plain
    // field mode has one, and a composite's is its texture — the smooth base is
    // shared by every composite and has no constants of its own, so there is
    // nothing there to name.
    if let Some(field) = characteristic_field(coloring) {
        match (key, field) {
            ("density", FieldSpec::Stripe { density }) => {
                *density = value;
                return Ok(());
            }
            ("radius", FieldSpec::TrapCircle { radius }) => {
                *radius = value;
                return Ok(());
            }
            ("sigma", FieldSpec::Threads { sigma }) => {
                *sigma = value;
                return Ok(());
            }
            _ => {}
        }
    }
    Err(format!("the {name} mode has no {key} parameter"))
}

/// What the parameters of this coloring currently are, by the name [`set`] takes.
///
/// The page reads this to seed its controls, so the number under a slider is the
/// catalog's own settled value rather than a copy of it kept in JavaScript. It is
/// the read half of [`set`] and is written beside it for the same reason a getter
/// sits beside its setter: the pair is one fact about each mode, and splitting them
/// across two files is how one of them gets a knob the other has never heard of.
fn params_of(coloring: &Coloring) -> BTreeMap<&'static str, f64> {
    let mut params = BTreeMap::new();
    match coloring {
        Coloring::Composite { texture_weight, .. } => {
            params.insert("weight", *texture_weight);
        }
        Coloring::Modulate { shift, .. } => {
            params.insert("shift", *shift);
        }
        Coloring::Direct {
            shape,
            trap_radius,
            threshold,
            opacity,
            ..
        } => {
            params.insert("radius", *trap_radius);
            // Absent means the shape's own calibrated distance, which is a number
            // the engine holds and the page would otherwise have to guess at.
            params.insert(
                "threshold",
                threshold.unwrap_or_else(|| shape.default_threshold()),
            );
            params.insert("opacity", *opacity);
        }
        Coloring::Field { .. } => {}
    }
    // The characteristic field is the last one the coloring reads: the only one a
    // plain field mode has, and the texture of a pair — which is the same rule
    // `characteristic_field` applies to write it.
    match coloring.fields().last() {
        Some(FieldSpec::Stripe { density }) => {
            params.insert("density", *density);
        }
        Some(FieldSpec::TrapCircle { radius }) => {
            params.insert("radius", *radius);
        }
        Some(FieldSpec::Threads { sigma }) => {
            params.insert("sigma", *sigma);
        }
        _ => {}
    }
    params
}

fn characteristic_field(coloring: &mut Coloring) -> Option<&mut FieldSpec> {
    match coloring {
        Coloring::Field { field, .. } => Some(field),
        Coloring::Composite { texture, .. } | Coloring::Modulate { texture, .. } => {
            Some(&mut texture.field)
        }
        Coloring::Direct { .. } => None,
    }
}

// -------------------------------------------------------------------- the exports

/// What this spec implies, or why it cannot be drawn, as JSON.
///
/// The page calls this before anything else and reads the whole shape of a pass
/// out of it: how many lanes to allocate, how many bytes a band will be, whether
/// the mode paints color during the iteration instead of making a field, and where
/// this family comes home to. A refusal carries the engine's own sentence, which is
/// what the page puts in front of a reader.
///
/// Returns a buffer whose first four bytes are the UTF-8 length, little-endian.
#[unsafe(no_mangle)]
pub extern "C" fn plan(spec_ptr: *const u8, spec_len: usize) -> *mut u8 {
    let report = match text(spec_ptr, spec_len).and_then(|text| resolve(&text)) {
        Ok(plan) => serde_json::json!({
            "ok": true,
            "home": {"x": plan.home.center.re, "y": plan.home.center.im, "w": plan.home.width},
            "maxiter": plan.maxiter,
            "lanes": plan.lanes.len(),
            "exact": plan.exact,
            "direct": plan.direct(),
            "levels": plan.levels(),
            "params": params_of(&plan.coloring),
            "resolution_ulps": plan.view.resolution_ulps(),
        }),
        Err(why) => serde_json::json!({"ok": false, "why": why}),
    };
    release_text(&report.to_string())
}

/// Compute output rows `[row_start, row_end)`, as little-endian `f64`, lane by lane.
///
/// **A band is a range of output rows, and never of samples.** At one sample per
/// pixel the two are the same range and this is what the page has always done;
/// above it a band is the `supersample` sample rows that reduce to those output
/// rows, which is the only cut that lets a direct trap encode its own band. A
/// caller that had to know which of the two a row index meant would get it wrong
/// exactly once.
///
/// The coordinates are formed from the **whole** viewport — `sample_point(col,
/// row)` with the global row index — so a band is bit for bit the rows the engine's
/// own whole-frame pass would have produced. A band that re-derived its own
/// sub-viewport would land on almost the same coordinates and draw seams between
/// the bands at the last place of the arithmetic.
///
/// The buffer is **lane-major**: lane 0's whole band, then lane 1's. `NaN` marks a
/// sample with no value, which is the engine's own spelling for the interior. A
/// narrow lane is reduced at `f64` and rounded through `f32` here, because that is
/// what the engine stores a field as and the picture wanted is the one it draws.
///
/// For a direct trap there are no lanes: the mode paints during the iteration, so
/// the band comes back as `rows * out_width * 4` finished RGBA bytes and there is
/// nothing left for [`shade`] to do. That is also why a palette change re-iterates
/// under those four modes and under no others.
#[unsafe(no_mangle)]
pub extern "C" fn compute_band(
    spec_ptr: *const u8,
    spec_len: usize,
    row_start: u32,
    row_end: u32,
) -> *mut u8 {
    let Ok(spec) = text(spec_ptr, spec_len) else {
        return std::ptr::null_mut();
    };
    let Ok(plan) = resolve(&spec) else {
        return std::ptr::null_mut();
    };
    if row_end > plan.view.out_height || row_start >= row_end {
        return std::ptr::null_mut();
    }
    let ss = plan.view.supersample;
    let band = if plan.direct() {
        paint_band(&plan, row_start, row_end)
    } else {
        Some(compute_lanes(&plan, row_start * ss, row_end * ss))
    };
    match band {
        Some(bytes) => release(bytes),
        None => std::ptr::null_mut(),
    }
}

/// One band of every lane of the coloring, through the engine's own specialized
/// escape loop.
///
/// Every lane is reduced from the same orbit, in the order [`lanes_of`] put them,
/// which is what makes a two-field composite cost one iteration rather than two.
///
/// **The table is [`field::sweep_row`]'s and this crate keeps none of its own.**
/// `iterate::run` is a long loop with eleven per-iteration channel checks and a
/// match over the families, and it collapses to the bare recurrence only when the
/// compiler can see *both* the family and the channel set at the call site. The
/// engine writes that pair out for itself — twelve channel sets over nine
/// families, held bit-for-bit against the generic loop by its own tests — and it
/// forms coordinates from the **whole** viewport with a global row index, which is
/// the one thing a band needs and the reason this function used to be a
/// hand-written copy. A copy is what it was: nine call sites covering the one mode
/// whose channel set is empty, and every other mode down the generic fallthrough.
/// Nothing held that copy to the engine's recurrence, so a change there would have
/// left this page rendering the old one with no test going red.
///
/// A band is a range of rows and a row appends to `lanes`, so the whole band goes
/// into one buffer a row at a time and the dispatch is re-taken per row — nothing
/// against a row of thousands of iterations per sample.
///
/// The engine reduces at `f64` and leaves the narrowing to its caller, which is
/// this: every lane crosses at the `f32` a dumped field would have been stored as,
/// except the modulate's texture — an address whose deep digits are the picture,
/// and the one lane the engine never narrows either.
fn compute_lanes(plan: &Plan, row_start: u32, row_end: u32) -> Vec<u8> {
    let fields: Vec<FieldSpec> = plan.lanes.iter().map(|layer| layer.field).collect();
    let wants = fields
        .iter()
        .map(FieldSpec::wants)
        .fold(Wants::default(), Wants::union);
    // The engine's own dispatch, except under the bench cfg, which sends every mode
    // to the generic loop so that the table can be priced against it. Written as an
    // `if cfg!` rather than an `#[cfg]` attribute for the reason README gives: an
    // attribute is a line, and a line moves every panic `Location` under it.
    let channels = if cfg!(generic_loop) {
        Channels::Many(wants)
    } else {
        Channels::of(wants)
    };

    let per_lane = plan.band_samples(row_start, row_end);
    let mut lanes: Vec<Vec<f64>> = vec![Vec::with_capacity(per_lane); fields.len()];
    for row in row_start..row_end {
        // **The empty list takes the engine's own call, untouched.** Not `premap` over an
        // empty slice through a shared loop — the branch is here, at the row, so that a
        // frame nobody inflected reaches `field::sweep_row` by the same line it always
        // did and cannot be slowed or re-byted by a feature it is not using.
        if plan.inflections.is_empty() {
            field::sweep_row(
                &plan.view,
                &plan.family,
                plan.maxiter,
                &fields,
                channels,
                row,
                &mut lanes,
            );
        } else {
            inflect::sweep_row(
                &plan.view,
                &plan.family,
                &plan.inflections,
                plan.maxiter,
                &fields,
                wants,
                row,
                &mut lanes,
            );
        }
    }

    let mut bytes = Vec::with_capacity(per_lane * lanes.len() * 8);
    for (index, lane) in lanes.into_iter().enumerate() {
        for value in lane {
            let value = if plan.exact[index] {
                value
            } else {
                value as f32 as f64
            };
            bytes.extend_from_slice(&value.to_le_bytes());
        }
    }
    bytes
}

/// One band of a direct trap: the color is built during the iteration and there is
/// no field to keep.
///
/// The last two steps are the engine's, taken here rather than dropped on the way
/// past: the rolloff acts on the finished linear color, and the engine's own
/// Lanczos-3 reduction is what encodes it. A band may be encoded on its own
/// because neither step reads anything outside its own *output pixel's*
/// neighbourhood — which is exactly what is not true of a field mode, whose
/// stretch is measured over the whole frame.
///
/// **The neighbourhood is why this band is padded.** Lanczos-3 reaches three
/// output pixels either side, which is `3 * ss` sample rows, so a band that
/// reduced only its own sample rows would renormalize a clipped kernel at both
/// edges and draw a visibly darker line between every pair of bands. So the band
/// iterates `3 * ss` rows past itself on each side, reduces through
/// [`resample::build_taps_at`] at an origin that says where its own first output
/// row sits in what it computed, and keeps only its own rows. At the top and
/// bottom of the frame there is nothing to pad with and the kernel clips — which
/// is exactly what a whole-frame reduction does there too.
///
/// **At one sample per pixel the pad is zero**, because the taps are then the
/// identity: `lanczos3` is 1 at 0 and 0 at every other integer, so the only sample
/// an output row reads is its own. That is the on-screen path, and it does not pay
/// a row for a filter that is not filtering.
fn paint_band(plan: &Plan, out_row_start: u32, out_row_end: u32) -> Option<Vec<u8>> {
    let colormap = plan.colormap.as_ref()?;
    let painter = painter_of(plan)?;

    let ss = plan.view.supersample;
    let width = plan.view.sample_width();
    let pad = if ss == 1 { 0 } else { 3 * ss };
    let first = (out_row_start * ss).saturating_sub(pad);
    let last = (out_row_end * ss + pad).min(plan.view.sample_height());
    let before = out_row_start * ss - first;
    let rows = (last - first) as usize;

    let mut linear = Vec::with_capacity(rows * width as usize);
    for row in first..last {
        for col in 0..width {
            let (color, _escaped) = painter.trace(
                &plan.family,
                inflect::premap(&plan.inflections, plan.view.sample_point(col, row)),
                plan.maxiter,
                colormap,
            );
            linear.push(color);
        }
    }
    if plan.palette.rolloff != Rolloff::None {
        for pixel in &mut linear {
            *pixel = plan.palette.rolloff.shade(*pixel);
        }
    }
    let horizontal =
        resample::build_taps_at(plan.view.out_width as usize, width as usize, 0.0, ss as f64);
    let vertical = resample::build_taps_at(
        (out_row_end - out_row_start) as usize,
        rows,
        before as f64,
        ss as f64,
    );
    Some(rgba(&resample::apply_taps(
        &linear,
        width as usize,
        rows,
        &horizontal,
        &vertical,
    )))
}

/// The second field a coloring reads, at the width that coloring reads it.
enum Texture {
    /// A composite's texture, at the `f32` the engine stores a field as.
    Narrow(Field),
    /// The modulate's, which is a base-`k` address whose deep digits are the
    /// picture and is the one lane the engine never narrows.
    Exact(Exact),
    None,
}

/// Color an assembled set of lanes, and return `out_width * out_height * 4` RGBA
/// bytes.
///
/// **The whole frame, and never a band.** The engine normalizes a frame against its
/// own distribution — the 0.5th and 99.5th percentiles of its valid samples at the
/// shipped transfer — so a band shaded alone would be stretched against its own
/// histogram and would not match its neighbours. The other two transfers the
/// palette recipe can ask for bring one frame-wide statistic each, and both are
/// equally frame-wide.
///
/// Which of the engine's three colorings runs is the coloring's own shape, and all
/// three are the engine's: one field through the map, two fields blended, or a base
/// whose palette position the second field perturbs.
///
/// **This export takes the lanes buffer, and frees it.** It is the one place on
/// this boundary where JavaScript hands a buffer over rather than lending it, and
/// the reason is a download: the lanes are eight bytes for every sample of every
/// lane, the linear-light color made from them is twenty-four bytes for every
/// sample, and holding both at once is what puts a two-lane mode at a wallpaper's
/// size past what a 32-bit address space has. It is freed the moment its numbers
/// have been read out into fields, which is before a byte of color is allocated,
/// and it is freed on every path including a refusal — a caller cannot be told
/// sometimes.
#[unsafe(no_mangle)]
pub extern "C" fn shade(
    spec_ptr: *const u8,
    spec_len: usize,
    lanes_ptr: *mut u8,
    lanes_len: usize,
) -> *mut u8 {
    let read = read_lanes(spec_ptr, spec_len, lanes_ptr, lanes_len, true);
    if !lanes_ptr.is_null() {
        unsafe { dealloc(lanes_ptr, lanes_len) };
    }
    let Some((plan, base, texture)) = read else {
        return std::ptr::null_mut();
    };
    let colormap = plan
        .colormap
        .as_ref()
        .expect("a colormap, which read_lanes refuses without");
    match colour(&plan, &base, &texture, colormap) {
        Some(rgb) => release(rgba(&rgb)),
        None => std::ptr::null_mut(),
    }
}

/// How many bytes [`derive_level`] puts in front of what it returns: one saying whether
/// a curve acts, seven of padding, and the curve's five numbers as little-endian `f64`.
const LEVEL_HEADER: usize = 48;

/// How many bytes [`shade_level`] puts in front of the picture: the level header, whose
/// second byte says whether a texture weight was derived, and that weight as one more
/// little-endian `f64` (NaN where none was).
const SHADE_HEADER: usize = LEVEL_HEADER + 8;

/// `shade_level`'s `derive` bits: measure the tone curve, and derive the texture weight.
const DERIVE_LEVEL: u32 = 1;
const DERIVE_WEIGHT: u32 = 2;

/// The header: whether the curve acts, and its five numbers (zeros where there is none).
fn level_header(acts: bool, curve: Option<level::Curve>) -> Vec<u8> {
    let mut out = Vec::with_capacity(SHADE_HEADER);
    out.extend_from_slice(&[u8::from(acts), 0, 0, 0, 0, 0, 0, 0]);
    match curve {
        Some(curve) => {
            for value in [
                curve.black_pt,
                curve.white_pt,
                curve.exponent,
                curve.out_ends[0],
                curve.out_ends[1],
            ] {
                out.extend_from_slice(&value.to_le_bytes());
            }
        }
        None => out.extend_from_slice(&[0; 40]),
    }
    out
}

/// [`shade`], and then the operator's measure half on the picture it made.
///
/// **One export and not three calls from JavaScript**, because the second colouring
/// is of the field this call already holds. `shade` frees the lanes before it
/// allocates a byte of colour — that is what fits a wallpaper's download into a
/// 32-bit heap — so a page that measured in one call and coloured again in another
/// would copy and narrow the whole field a second time to get back what was just
/// dropped.
///
/// `derive` is two bits. With neither set this is `shade` with a header in front.
///
/// - **`DERIVE_WEIGHT`**, on a composite: before anything is coloured, the texture's
///   roughness is measured on these lanes at one output pixel's spacing
///   ([`derive::roughness`]) and the weight the coloring is drawn at is replaced by
///   [`derive::weight`]'s. The weight comes back in the header, so the page can show it
///   and a link can carry it.
/// - **`DERIVE_LEVEL`**, on a coloring the operator acts on: the finished picture is
///   measured ([`level::derive`]); where the curve acts, the map's own stops go through
///   [`level::curved_stops`], are baked again exactly as [`resolve`] bakes a replayed
///   curve, and the same fields are coloured through them. The first picture is dropped
///   before the second is made. The weight goes first, because the picture the tone is
///   measured on is the one drawn at it.
///
/// Returns `SHADE_HEADER + out_width * out_height * 4` bytes, or null on a refusal.
/// A spec that carries `autolevel` and asks to derive a curve is refused: that picture
/// is already levelled, and measuring it would level it twice.
#[unsafe(no_mangle)]
pub extern "C" fn shade_level(
    spec_ptr: *const u8,
    spec_len: usize,
    lanes_ptr: *mut u8,
    lanes_len: usize,
    derive: u32,
) -> *mut u8 {
    let read = read_lanes(spec_ptr, spec_len, lanes_ptr, lanes_len, true);
    if !lanes_ptr.is_null() {
        unsafe { dealloc(lanes_ptr, lanes_len) };
    }
    let Some((mut plan, base, texture)) = read else {
        return std::ptr::null_mut();
    };
    if derive & DERIVE_LEVEL != 0 && plan.replays {
        return std::ptr::null_mut();
    }
    let mut weighed = None;
    if derive & DERIVE_WEIGHT != 0 {
        if let (
            Coloring::Composite { texture_weight, .. },
            Texture::Narrow(second),
            Some(ceiling),
        ) = (&mut plan.coloring, &texture, plan.settled_weight)
        {
            let rough = derive::roughness(
                &base,
                second,
                plan.lanes[1].transform,
                plan.view.supersample,
            );
            *texture_weight = derive::weight(rough.unwrap_or(0.0), ceiling);
            weighed = Some(*texture_weight);
        }
    }
    let derive = derive & DERIVE_LEVEL;
    let colormap = plan
        .colormap
        .as_ref()
        .expect("a colormap, which read_lanes refuses without");
    let Some(mut rgb) = colour(&plan, &base, &texture, colormap) else {
        return std::ptr::null_mut();
    };

    let mut acted = None;
    if derive != 0 && plan.levels() {
        if let Some(curve) = level::derive(&rgb, 3) {
            let (kind, stops) = plan.source.as_ref().expect("a colormap keeps its stops");
            let curved = level::curved_stops(stops, &curve);
            let Ok(levelled) =
                Colormap::from_stops_baked(COLORMAP_NAME, *kind, &curved, plan.palette.bake)
            else {
                return std::ptr::null_mut();
            };
            drop(rgb);
            let Some(again) = colour(&plan, &base, &texture, &levelled) else {
                return std::ptr::null_mut();
            };
            rgb = again;
            acted = Some(curve);
        }
    }

    let mut out = level_header(acted.is_some(), acted);
    out[1] = u8::from(weighed.is_some());
    out.extend_from_slice(&weighed.unwrap_or(f64::NAN).to_le_bytes());
    out.reserve(rgb.len() / 3 * 4);
    for pixel in rgb.chunks_exact(3) {
        out.extend_from_slice(pixel);
        out.push(255);
    }
    release(out)
}

// ------------------------------------------------------ the shade, over the pool

/// The frame-wide statistics a colouring reads, apart from the samples it reads them
/// for: what [`shade_stats`] measures once and hands to every [`shade_band`].
///
/// A frame is normalized against its own distribution — the 0.5th and 99.5th
/// percentiles of its valid samples — so a band coloured alone would be stretched
/// against its own histogram and would draw a step between itself and its
/// neighbours. Split into a reduction that answers those numbers and a colouring that
/// is handed them, **every band is independent and the bytes are the whole frame's**.
/// The statistics are the engine's own [`coloring::Spend`], measured by the engine's
/// own code over the whole field; this module keeps no second opinion about what a
/// frame's normalization is.
///
/// **There is no variant for the modulate or for a rank transfer, and that is the
/// refusal.** Both normalize by [`coloring::Ranks`], which is the frame's valid
/// samples sorted — eight bytes a sample, the field over again. Sending that to
/// twelve workers costs more than the colouring it splits, so those two keep the
/// one-worker shade and [`shade_stats`] says so rather than guessing.
#[derive(serde::Serialize, Deserialize)]
enum Stats {
    Field(coloring::Spend),
    Composite(coloring::Spend, coloring::Stretch),
}

/// Measure what a band will need, or `None` where this coloring's statistics are the
/// field over again. See [`Stats`].
fn measure_stats(plan: &Plan, base: &Field, texture: &Texture) -> Option<Stats> {
    let composite = match (&plan.coloring, texture) {
        (Coloring::Field { .. }, _) => false,
        (Coloring::Composite { .. }, Texture::Narrow(_)) => true,
        _ => return None,
    };
    let spend = coloring::Spend::measure(base, plan.palette.transfer);
    if matches!(spend, coloring::Spend::Rank(_)) {
        return None;
    }
    match (composite, texture) {
        (true, Texture::Narrow(second)) => {
            Some(Stats::Composite(spend, coloring::Stretch::measure(second)))
        }
        _ => Some(Stats::Field(spend)),
    }
}

/// The statistics a pooled shade of this field needs, as JSON, or why it has none.
///
/// `{"ok": true, "pooled": true, "stats": …}`, `{"ok": true, "pooled": false}` where
/// the caller should take the one-worker [`shade_level`] instead, or `{"ok": false,
/// "why": …}`. **This export takes the lanes buffer and frees it**, on every path
/// including a refusal, exactly as [`shade`] does and for the same reason.
///
/// The statistics depend on the field and on the recipe's `transfer` and on nothing
/// else — not on the map, the gamma, the cycles, the phase or the curve — so a caller
/// that is recolouring a field it already measured may keep this answer and spend it
/// again. That is what makes a palette edit a colouring and nothing more.
#[unsafe(no_mangle)]
pub extern "C" fn shade_stats(
    spec_ptr: *const u8,
    spec_len: usize,
    lanes_ptr: *mut u8,
    lanes_len: usize,
) -> *mut u8 {
    let read = read_lanes(spec_ptr, spec_len, lanes_ptr, lanes_len, false);
    if !lanes_ptr.is_null() {
        unsafe { dealloc(lanes_ptr, lanes_len) };
    }
    let report = match read {
        None => serde_json::json!({
            "ok": false,
            "why": "this spec, this colormap and these lanes do not describe one picture",
        }),
        Some((plan, base, texture)) => match measure_stats(&plan, &base, &texture) {
            Some(stats) => serde_json::json!({"ok": true, "pooled": true, "stats": stats}),
            None => serde_json::json!({"ok": true, "pooled": false}),
        },
    };
    release_text(&report.to_string())
}

/// How many OUTPUT pixels the reduction reaches either side of its own, which is
/// [`resample`]'s Lanczos-3 radius. The same three [`paint_band`] pads by.
const REDUCE_REACH: u32 = 3;

/// Which SAMPLE rows a band of output rows `[row_start, row_end)` has to be handed,
/// padding included: `[first, last)`.
///
/// **The pad is the reduction's, and it is the only thing about a shade that is not
/// per-sample.** Colouring reads one sample; the Lanczos-3 reduction that follows it
/// reaches three output pixels either side, so a band that was handed only its own
/// sample rows would renormalize a clipped kernel at both edges and draw a lighter
/// line between every pair of bands. At one sample a pixel the taps are the identity
/// and the pad is zero, which is [`paint_band`]'s reasoning exactly.
fn band_rows(view: &Viewport, row_start: u32, row_end: u32) -> (u32, u32) {
    let ss = view.supersample;
    let pad = if ss == 1 { 0 } else { REDUCE_REACH * ss };
    (
        (row_start * ss).saturating_sub(pad),
        (row_end * ss + pad).min(view.sample_height()),
    )
}

/// One band of a shade: output rows `[row_start, row_end)`, through statistics
/// [`shade_stats`] measured over the whole field.
///
/// The lanes are the **padded** sample rows [`band_rows`] names, lane-major exactly
/// as [`compute_band`] writes them: lane 0's rows, then lane 1's. **This export takes
/// that buffer and frees it**, before it allocates a byte of colour, for the reason
/// [`shade`] gives.
///
/// The caller states the pad — it is `render.js`'s `TRAP_PAD_ROWS`, the same three
/// output rows either side a direct trap's band already pads by, because it is the
/// same reduction reaching the same distance. What ties the two statements together
/// is the length check below: a buffer that is not exactly the padded rows this band
/// needs is refused rather than coloured, so a page that padded by a different rule
/// draws nothing instead of drawing a seam.
///
/// Returns `(row_end - row_start) * out_width * 4` RGBA bytes, or null on a refusal.
/// Every stage is the same call the whole-frame [`shade`] makes: the engine's own
/// colouring over a run of samples, the rolloff, and the engine's own Lanczos-3
/// reduction at the origin this band's first output row sits at.
#[unsafe(no_mangle)]
pub extern "C" fn shade_band(
    spec_ptr: *const u8,
    spec_len: usize,
    stats_ptr: *const u8,
    stats_len: usize,
    lanes_ptr: *mut u8,
    lanes_len: usize,
    row_start: u32,
    row_end: u32,
) -> *mut u8 {
    let read = read_band(
        spec_ptr, spec_len, stats_ptr, stats_len, lanes_ptr, lanes_len, row_start, row_end,
    );
    if !lanes_ptr.is_null() {
        unsafe { dealloc(lanes_ptr, lanes_len) };
    }
    let Some((plan, stats, base, texture)) = read else {
        return std::ptr::null_mut();
    };
    let colormap = plan
        .colormap
        .as_ref()
        .expect("a colormap, which read_band refuses without");
    match colour_band(
        &plan,
        &stats,
        &base,
        texture.as_deref(),
        colormap,
        row_start,
        row_end,
    ) {
        Some(bytes) => release(bytes),
        None => std::ptr::null_mut(),
    }
}

/// Everything [`shade_band`] reads out of its caller's buffers, and nothing else —
/// split out so the lanes are freed at exactly one point and on every path.
#[allow(clippy::too_many_arguments)]
fn read_band(
    spec_ptr: *const u8,
    spec_len: usize,
    stats_ptr: *const u8,
    stats_len: usize,
    lanes_ptr: *const u8,
    lanes_len: usize,
    row_start: u32,
    row_end: u32,
) -> Option<(Plan, Stats, Vec<f32>, Option<Vec<f32>>)> {
    let plan = resolve(&text(spec_ptr, spec_len).ok()?).ok()?;
    plan.colormap.as_ref()?;
    if lanes_ptr.is_null() || plan.lanes.is_empty() {
        return None;
    }
    if row_end > plan.view.out_height || row_start >= row_end {
        return None;
    }
    let stats: Stats = serde_json::from_str(&text(stats_ptr, stats_len).ok()?).ok()?;
    // The statistics and the coloring have to be the same shape, or the picture would
    // be drawn against a normalization of a field it is not.
    match (&stats, &plan.coloring) {
        (Stats::Field(_), Coloring::Field { .. }) => {}
        (Stats::Composite(..), Coloring::Composite { .. }) => {}
        _ => return None,
    }
    let (first, last) = band_rows(&plan.view, row_start, row_end);
    let width = plan.view.sample_width() as usize;
    let count = (last - first) as usize * width;
    if lanes_len != count * plan.lanes.len() * 8 {
        return None;
    }
    let raw = unsafe { std::slice::from_raw_parts(lanes_ptr, lanes_len) };
    let narrow = |index: usize| -> Vec<f32> {
        raw[index * count * 8..(index + 1) * count * 8]
            .chunks_exact(8)
            .map(|eight| f64::from_le_bytes(eight.try_into().expect("eight bytes")) as f32)
            .collect()
    };
    let base = narrow(0);
    let texture = matches!(stats, Stats::Composite(..)).then(|| narrow(1));
    Some((plan, stats, base, texture))
}

/// One band's colour: the engine's colouring over these samples, the rolloff, and the
/// reduction at this band's own origin.
fn colour_band(
    plan: &Plan,
    stats: &Stats,
    base: &[f32],
    texture: Option<&[f32]>,
    colormap: &Colormap,
    row_start: u32,
    row_end: u32,
) -> Option<Vec<u8>> {
    let ss = plan.view.supersample;
    let width = plan.view.sample_width() as usize;
    let (first, last) = band_rows(&plan.view, row_start, row_end);
    let rows = (last - first) as usize;

    let mut linear = match (&plan.coloring, stats, texture) {
        (Coloring::Field { transform, .. }, Stats::Field(spend), _) => {
            coloring::shade_samples(base, spend, *transform, &plan.palette, colormap)
        }
        (
            Coloring::Composite {
                blend,
                texture_weight,
                texture_gamma,
                ..
            },
            Stats::Composite(spend, stretch),
            Some(second),
        ) => coloring::composite_samples(
            base,
            second,
            spend,
            stretch,
            plan.lanes[0].transform,
            plan.lanes[1].transform,
            *blend,
            *texture_weight,
            *texture_gamma,
            &plan.palette,
            colormap,
        ),
        _ => return None,
    };
    if plan.palette.rolloff != Rolloff::None {
        for pixel in &mut linear {
            *pixel = plan.palette.rolloff.shade(*pixel);
        }
    }
    let out_width = plan.view.out_width as usize;
    let out_rows = (row_end - row_start) as usize;
    // At one sample a pixel the reduction is the encode `downsample` skips to, and the
    // band is its own rows: the same call the whole frame makes, over fewer of them.
    if ss == 1 {
        return Some(rgba(&resample::downsample(
            &linear, width, rows, out_width, out_rows, 1,
        )));
    }
    let horizontal = resample::build_taps_at(out_width, width, 0.0, ss as f64);
    let vertical =
        resample::build_taps_at(out_rows, rows, (row_start * ss - first) as f64, ss as f64);
    Some(rgba(&resample::apply_taps(
        &linear,
        width,
        rows,
        &horizontal,
        &vertical,
    )))
}

/// The operator's measure half on a finished RGBA picture, alone, as the same
/// `LEVEL_HEADER` [`shade_level`] writes. The curve is written for an identity as well
/// as for an acting curve, and is zeros for a degenerate range.
///
/// Here so that a test can hold the **module's** arithmetic — `cbrt`, `ln` and `powf`
/// as wasm computes them, which is not the native build's libm — to the operator's
/// answers. The native test cannot make that claim on the module's behalf.
#[unsafe(no_mangle)]
pub extern "C" fn derive_level(rgba_ptr: *const u8, rgba_len: usize) -> *mut u8 {
    if rgba_ptr.is_null() || rgba_len % 4 != 0 {
        return std::ptr::null_mut();
    }
    let raw = unsafe { std::slice::from_raw_parts(rgba_ptr, rgba_len) };
    release(match level::derive_curve(&level::tone_stats(raw, 4)) {
        level::Decision::Acts(curve) => level_header(true, Some(curve)),
        level::Decision::Identity(curve) => level_header(false, Some(curve)),
        level::Decision::Degenerate => level_header(false, None),
    })
}

/// A colormap spec as the page sends one: the kind, and the stops.
fn map_of(kind: Kind, stops: &[(f64, [u8; 3])]) -> serde_json::Value {
    serde_json::json!({
        "kind": match kind {
            Kind::Cyclic => "cyclic",
            Kind::Sequential => "sequential",
        },
        "stops": stops,
    })
}

/// The map's stops with this view's tone curve already spent on them, and the curve.
///
/// **The curve acts on the map and never on the picture, so it is worth exactly one
/// application.** It used to be worth two or twelve: the page redrew a 512-pixel
/// palette strip through the same map and the same curve on the main thread, and a
/// shade split over the pool would have had every band replay it — [`level::curved_stops`]
/// densifies the ramp and pulls each stop's chroma back into sRGB by a bisection with
/// a bisection inside it, which is per stop and is hundreds of milliseconds on a map
/// with hundreds. Curved once here, the stops go into the band specs, into the strip,
/// and into the download, and nothing replays anything.
///
/// The curve comes from one of two places, and the picture says which:
///
/// * **`rgba_len` of zero** — the curve the spec carries, replayed. That is a gallery
///   seat or a pasted link: the measurement was made by the run that recorded it.
/// * **a picture** — measured off it ([`level::derive`]), the way [`shade_level`] does.
///   A spec that already replays a curve is refused, because that picture is levelled
///   already and measuring it would level it twice.
///
/// `{"ok": true, "acts": bool, "curve": {…}|null, "colormap": {kind, stops}}`, with the
/// map handed straight back where no curve acts — a whole colormap spec rather than the
/// stops alone, so a caller drops it into the next spec without knowing what a kind is.
/// Or `{"ok": false, "why": …}`. The picture is the caller's buffer to free.
#[unsafe(no_mangle)]
pub extern "C" fn curve_stops(
    spec_ptr: *const u8,
    spec_len: usize,
    rgba_ptr: *const u8,
    rgba_len: usize,
) -> *mut u8 {
    let report = text(spec_ptr, spec_len)
        .and_then(|text| resolve(&text))
        .and_then(|plan| {
            let (kind, stops) = plan
                .source
                .as_ref()
                .ok_or("this spec carries no colormap to curve")?;
            let measured = if rgba_len == 0 {
                if !plan.replays {
                    return Ok(serde_json::json!({
                        "ok": true, "acts": false, "curve": null, "colormap": map_of(*kind, stops),
                    }));
                }
                // The spec's own curve, which `resolve` has already spent on `plan`'s
                // baked map: re-spending it on the source stops is the same call with
                // the same arguments, and what comes back is that map's stops.
                plan.curve
            } else {
                if plan.replays {
                    return Err("this picture is levelled already".into());
                }
                if rgba_ptr.is_null() || rgba_len % 4 != 0 {
                    return Err("the picture is not whole pixels".into());
                }
                let raw = unsafe { std::slice::from_raw_parts(rgba_ptr, rgba_len) };
                level::derive(raw, 4)
            };
            Ok(match measured {
                Some(curve) => serde_json::json!({
                    "ok": true,
                    "acts": true,
                    "curve": {
                        "operator": level::OPERATOR,
                        "black_pt": curve.black_pt,
                        "white_pt": curve.white_pt,
                        "exponent": curve.exponent,
                        "out_ends": curve.out_ends,
                    },
                    "colormap": map_of(*kind, &level::curved_stops(stops, &curve)),
                }),
                None => serde_json::json!({
                    "ok": true, "acts": false, "curve": null, "colormap": map_of(*kind, stops),
                }),
            })
        })
        .unwrap_or_else(|why: String| serde_json::json!({"ok": false, "why": why}));
    release_text(&report.to_string())
}

/// [`derive::roughness`] on a composite's lanes, which the caller keeps: the number a
/// derived weight is read off, for the pilot and the tests. NaN where the spec is not a
/// composite or no pair of samples has a base and a texture.
#[unsafe(no_mangle)]
pub extern "C" fn texture_roughness(
    spec_ptr: *const u8,
    spec_len: usize,
    lanes_ptr: *const u8,
    lanes_len: usize,
    stride: u32,
) -> f64 {
    let Some((plan, base, Texture::Narrow(texture))) =
        read_lanes(spec_ptr, spec_len, lanes_ptr, lanes_len, true)
    else {
        return f64::NAN;
    };
    derive::roughness(&base, &texture, plan.lanes[1].transform, stride).unwrap_or(f64::NAN)
}

/// A direct trap's near misses over output rows `[row_start, row_end)`, at one sample a
/// pixel of whatever resolution the spec names: [`derive::PROBE_BYTES`] per pixel, the
/// hit count and the load as little-endian `f32`. Split over the pool the way
/// [`compute_band`] is, and read by [`derive_opacity`]. Null for anything but a
/// screened or multiplied direct trap.
#[unsafe(no_mangle)]
pub extern "C" fn probe_band(
    spec_ptr: *const u8,
    spec_len: usize,
    row_start: u32,
    row_end: u32,
) -> *mut u8 {
    let Ok(spec) = text(spec_ptr, spec_len) else {
        return std::ptr::null_mut();
    };
    let Ok(plan) = resolve(&spec) else {
        return std::ptr::null_mut();
    };
    if plan.view.supersample != 1
        || row_end > plan.view.out_height
        || row_start >= row_end
        || !derive::probes(&plan.coloring)
    {
        return std::ptr::null_mut();
    }
    let (Some(painter), Some(colormap)) = (painter_of(&plan), plan.colormap.as_ref()) else {
        return std::ptr::null_mut();
    };
    let mut out =
        Vec::with_capacity((row_end - row_start) as usize * plan.view.out_width as usize * 8);
    for row in row_start..row_end {
        derive::probe_row(
            &painter,
            &plan.coloring,
            &plan.view,
            &plan.family,
            plan.maxiter,
            colormap,
            &plan.inflections,
            row,
            &mut out,
        );
    }
    release(out)
}

/// The opacity a whole probe derives, as JSON: `{"opacity", "hit_share", "load"}`, with
/// `opacity` null where no pixel was hit. The probe buffer is the caller's to free.
#[unsafe(no_mangle)]
pub extern "C" fn derive_opacity(
    spec_ptr: *const u8,
    spec_len: usize,
    probe_ptr: *const u8,
    probe_len: usize,
) -> *mut u8 {
    let report = text(spec_ptr, spec_len)
        .and_then(|text| resolve(&text))
        .and_then(|plan| match plan.coloring {
            Coloring::Direct { shape, merge, .. } if derive::probes(&plan.coloring) => {
                if probe_ptr.is_null() || probe_len % derive::PROBE_BYTES != 0 {
                    return Err("the probe is not whole pixels".into());
                }
                let probe = unsafe { std::slice::from_raw_parts(probe_ptr, probe_len) };
                let probed = derive::opacity(probe, merge, derive::opacity_cap(shape, merge));
                Ok(serde_json::json!({"ok": true, "probed": probed}))
            }
            _ => Err("only a screened or multiplied direct trap derives its opacity".into()),
        })
        .unwrap_or_else(|why: String| serde_json::json!({"ok": false, "why": why}));
    release_text(&report.to_string())
}

/// The painter a direct plan draws with, every clamp applied.
fn painter_of(plan: &Plan) -> Option<direct_trap::Painter> {
    let Coloring::Direct {
        shape,
        trap_radius,
        threshold,
        opacity,
        merge,
        merge_order,
        start_color,
        transform,
    } = &plan.coloring
    else {
        return None;
    };
    direct_trap::Painter::new(
        *shape,
        *trap_radius,
        *threshold,
        *opacity,
        *merge,
        *merge_order,
        start_color,
        *transform,
    )
    .ok()
}

/// One whole frame's colour, as RGB: the engine's coloring for this plan's shape, the
/// rolloff, and the Lanczos-3 reduction. `None` where the lanes and the coloring
/// disagree about what they are.
fn colour(plan: &Plan, base: &Field, texture: &Texture, colormap: &Colormap) -> Option<Vec<u8>> {
    let width = plan.view.sample_width();
    let height = plan.view.sample_height();

    let mut linear = match (&plan.coloring, texture) {
        (Coloring::Field { transform, .. }, _) => {
            coloring::shade(base, *transform, &plan.palette, colormap)
        }
        (
            Coloring::Composite {
                blend,
                texture_weight,
                texture_gamma,
                ..
            },
            Texture::Narrow(second),
        ) => coloring::composite(
            base,
            second,
            plan.lanes[0].transform,
            plan.lanes[1].transform,
            *blend,
            *texture_weight,
            *texture_gamma,
            &plan.palette,
            colormap,
        ),
        // `modulate` answers with the color and with whether the texture's stretch
        // came back flat. The flat flag is a diagnostic the CLI reports beside a
        // render; this boundary hands back pixels and nothing else, so it is read
        // and dropped here rather than widened into the module's return.
        (Coloring::Modulate { shift, .. }, Texture::Exact(second)) => {
            coloring::modulate(
                base,
                second,
                plan.lanes[0].transform,
                plan.lanes[1].transform,
                *shift,
                &plan.palette,
                colormap,
            )
            .0
        }
        _ => return None,
    };
    if plan.palette.rolloff != Rolloff::None {
        // `coloring::paint` rolls the highlights off after it colors and before
        // anything averages them. This path calls the colorings directly — it has
        // the fields already — so the same last step is taken here rather than
        // dropped on the way past.
        for pixel in &mut linear {
            *pixel = plan.palette.rolloff.shade(*pixel);
        }
    }
    Some(resample::downsample(
        &linear,
        width as usize,
        height as usize,
        plan.view.out_width as usize,
        plan.view.out_height as usize,
        plan.view.supersample,
    ))
}

/// Read every lane out of the caller's buffer, and nothing else.
///
/// Split out so that [`shade`] can free that buffer at exactly one point and on
/// every path: everything that reads it happens in here, and the free happens the
/// moment this returns.
fn read_lanes(
    spec_ptr: *const u8,
    spec_len: usize,
    lanes_ptr: *const u8,
    lanes_len: usize,
    colormap: bool,
) -> Option<(Plan, Field, Texture)> {
    let plan = resolve(&text(spec_ptr, spec_len).ok()?).ok()?;
    // A colouring needs a map and a measurement does not: [`shade_stats`] reads a
    // frame's own distribution, which is a fact about the field, so the spec it is sent
    // carries no colormap at all and a page recolouring one field measures it once.
    if colormap {
        plan.colormap.as_ref()?;
    }
    if lanes_ptr.is_null() || plan.lanes.is_empty() {
        return None;
    }
    let width = plan.view.sample_width();
    let height = plan.view.sample_height();
    let count = width as usize * height as usize;
    if lanes_len != count * plan.lanes.len() * 8 {
        return None;
    }
    let raw = unsafe { std::slice::from_raw_parts(lanes_ptr, lanes_len) };
    let doubles = |index: usize| {
        raw[index * count * 8..(index + 1) * count * 8]
            .chunks_exact(8)
            .map(|eight| f64::from_le_bytes(eight.try_into().expect("eight bytes")))
    };
    // Narrowed on the way out of the bytes rather than through a `Vec<f64>` that
    // is thrown away a line later. At a screen's worth of samples that copy is
    // invisible; at a download's it is half a gigabyte of a wasm heap that never
    // gives it back.
    let narrow = |index: usize| Field {
        values: doubles(index).map(|value| value as f32).collect(),
        width,
        height,
    };

    let base = narrow(0);
    let texture = match plan.coloring {
        Coloring::Composite { .. } => Texture::Narrow(narrow(1)),
        Coloring::Modulate { .. } => Texture::Exact(Exact {
            values: doubles(1).collect(),
            width,
            height,
        }),
        _ => Texture::None,
    };
    Some((plan, base, texture))
}

/// The iteration cap the engine's own policy gives this view.
#[unsafe(no_mangle)]
pub extern "C" fn maxiter_for_width(fw: f64) -> u32 {
    maxiter::for_width(fw)
}

/// Put one frame through the engine's structural screen, and say what each gate made
/// of it, as JSON.
///
/// **The pipeline's own battery, not a second copy of its rule.** This is
/// [`fractal_engine::screen::Battery::screen`] at its defaults, handed the view the
/// spec names at the resolution the spec names (the walk asks at the engine's
/// `NODE_WIDTH`, 384×216) and the cap the spec resolves to, which is the depth policy
/// unless `maxiter` was set. The colormap is the spec's by value, because a page has
/// no directory to load `twilight_shifted` from: the walk sends that map's stops, and
/// the occupancy floor reads its edges off that coloring exactly as `screen::run` does.
///
/// `occupancy` zero waives the last gate, as a walk's first rung does. The answer is
/// `{ok, fate, passed, interior_fraction, verdicts: [{gate, reading, threshold,
/// passed}]}`, or `{ok: false, why}`. Everything it iterates runs on the calling thread,
/// so the page calls it from a worker.
#[unsafe(no_mangle)]
pub extern "C" fn screen(spec_ptr: *const u8, spec_len: usize, occupancy: u32) -> *mut u8 {
    let report = match text(spec_ptr, spec_len).and_then(|text| resolve(&text)) {
        Ok(plan) => match &plan.colormap {
            Some(colormap) => {
                let screening = fractal_engine::screen::Battery::default().screen(
                    &plan.view,
                    &plan.family,
                    plan.maxiter,
                    colormap,
                    occupancy != 0,
                );
                serde_json::json!({
                    "ok": true,
                    "fate": screening.fate,
                    "passed": screening.passed(),
                    "interior_fraction": screening.interior_fraction(),
                    "verdicts": screening.verdicts,
                    "maxiter": plan.maxiter,
                })
            }
            None => serde_json::json!({
                "ok": false,
                "why": "the screen colors the frame for its occupancy floor, so it needs a colormap",
            }),
        },
        Err(why) => serde_json::json!({"ok": false, "why": why}),
    };
    release_text(&report.to_string())
}

/// How many representable numbers one sample step of this view spans.
///
/// Below [`fractal_engine::viewport::RESOLUTION_ULPS`] two neighbouring sample
/// centers are the same number, and the page stops zooming rather than draw the
/// arithmetic. Asked as bare geometry rather than through a spec because the page
/// asks it of a view it has not moved to yet.
#[unsafe(no_mangle)]
pub extern "C" fn resolution_ulps(cx: f64, cy: f64, fw: f64, px_w: u32, px_h: u32) -> f64 {
    Viewport {
        center: Complex::new(cx, cy),
        width: fw,
        out_width: px_w,
        out_height: px_h,
        // The screen's grid, which is what this question is asked about: a reader
        // zooms the canvas, and a download that asked for a finer grid than `f64`
        // resolves is refused by `plan` in the engine's own words.
        supersample: 1,
    }
    .resolution_ulps()
}

/// The floor `resolution_ulps` is read against, so the page does not restate it.
#[unsafe(no_mangle)]
pub extern "C" fn resolution_ulps_floor() -> f64 {
    fractal_engine::viewport::RESOLUTION_ULPS
}

#[unsafe(no_mangle)]
pub extern "C" fn alloc(len: usize) -> *mut u8 {
    let mut buffer = Vec::<u8>::with_capacity(len);
    let ptr = buffer.as_mut_ptr();
    std::mem::forget(buffer);
    ptr
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn dealloc(ptr: *mut u8, len: usize) {
    unsafe { drop(Vec::from_raw_parts(ptr, 0, len)) }
}

// ------------------------------------------------------------------- the plumbing

/// Read a spec out of the heap JavaScript wrote it to.
fn text(ptr: *const u8, len: usize) -> Result<String, String> {
    if ptr.is_null() {
        return Err("no spec was written to the heap".into());
    }
    let raw = unsafe { std::slice::from_raw_parts(ptr, len) };
    std::str::from_utf8(raw)
        .map(str::to_string)
        .map_err(|_| "the spec is not valid UTF-8".into())
}

/// Hand a `Vec` to JavaScript and forget it: the caller owns it until `dealloc`.
fn release(mut bytes: Vec<u8>) -> *mut u8 {
    let ptr = bytes.as_mut_ptr();
    std::mem::forget(bytes);
    ptr
}

/// The same, for a string: four bytes of little-endian length, then the UTF-8.
///
/// A length prefix rather than a second export returning it, because a caller that
/// has to ask twice can be told two different things.
fn release_text(text: &str) -> *mut u8 {
    let raw = text.as_bytes();
    let mut bytes = Vec::with_capacity(raw.len() + 4);
    bytes.extend_from_slice(&(raw.len() as u32).to_le_bytes());
    bytes.extend_from_slice(raw);
    release(bytes)
}

/// Opaque RGBA from the engine's RGB.
fn rgba(rgb: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(rgb.len() / 3 * 4);
    for pixel in rgb.chunks_exact(3) {
        out.extend_from_slice(pixel);
        out.push(255);
    }
    out
}
