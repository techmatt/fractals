# perturb — the Deep tab's kernel, as wasm

The crate `perturb` wraps the deep picture kernel for the explorer's Deep tab and builds the
two modules the page loads: `perturb.wasm`, with wasm SIMD, and `perturb-scalar.wasm`, the
fallback for an engine without it. It has no UI, no page, and no link contract: those are
`explorer/README.md`'s, written against what this exports.

**The kernel is not here.** The fixed-point reals, the reference orbit, the delta loop, the
cap policy, and the spec are the crate `fractal-wallpapers/perturbation` in the sibling
checkout, which `fractal-engine render-link` also builds natively to draw `dv=` links: one
copy for the page and the CLI. This crate depends on it by path, re-exports it (so
`perturb::kernel` and the rest resolve), and keeps what only the explorer asks for:

```text
src/lib.rs               the 25 extern "C" exports the page calls, and plan's JSON report
src/nuclei.rs            the minibrots in and around a view, and the root test (§9, §10, §12)
src/dive.rs              the Dive block and New coloring's rule (§11)
build.rs                 empty, and kept: deleting it moves both modules' bytes
tests/probe.rs           three-way probes; not proofs, and they say so
tests/descend.rs         the frame finder (ignored by default)
tests/measure.rs         the cap sweep, the policy, and the nucleus search (ignored)
tests/classify_speed.rs  §12's frame set and both root solves (ignored)
```

The three ignored harnesses read the kernel's record of deep frames,
`fractal-wallpapers/perturbation/tests/common`, by `#[path]` across the two checkouts.

**§1 to §8 are the kernel's**, in `fractal-wallpapers/perturbation/README.md` under the same
numbers, so a §2c or a §8 cited from this repository is that file's. §9 to §12, below, are
the explorer's own; their mechanics are in the module docstrings of `src/nuclei.rs` and
`src/dive.rs`, and what is here is the contract a change must keep.

**Why a second module.** Nothing here, or in the kernel, is linked into `engine.wasm`, the
shallow renderer (`engine-wasm` takes the engine with `default-features = false`), so
nothing written here can move a byte of the shallow path. The two meet on the page at a
buffer of `f64` lanes: this module's output is what `engine.wasm`'s `compute_band` produces
for `smooth`, in the same layout, so `shade_level` colors it either way.

## Proof, continued: what only the explorer asks for

### 9. The minibrots in and around a view

`src/nuclei.rs`: atom domains (`Kernel::domain_with`, on `policy`'s probe grid) say where,
then Newton on `z_p(c) = 0` says exactly where. The rules:

- **The derivative is not fixed point**: `dz_p/dc` and the size product ride as an `f64`
  mantissa and a power-of-two exponent, since `Fx`'s limb overflows silently.
- **Lowest period first, then one nucleus per place.** The walk reports harmonics, which
  Newton takes to one point with a degenerate size; deduplicate by where Newton lands.
- **The size is the body**, `1/|b·l²|`, not the atom domain `1/|l|`: a minibrot found in a
  view at 1e-n sits near 1e-2n. The anchor test pins 6.478e-12.
- ⚠ **A tile's cap is not the width's to give**: at the width policy's cap a deep tile is
  flat black. `tile_cap` is `TILE_PERIODS` periods, `open_cap` (an opened copy)
  `OPEN_PERIODS` under `cap::EXPLICIT_CEILING`, each or the width policy if larger; both
  frame at `TILE_BODIES` sizes, `copy_width` falling back on `FALLBACK_BODIES`. So a search
  costs about `samples × 8p`, and `p` at depth is of the order of the cap.
- **A tile is centred on its nucleus**, so the view centre is already the reference; whether
  a nucleus reference pays on an ordinary frame is open.

### 10. Degrees three to six

Nothing in the method depends on the degree. `D` is a const generic on `Kernel::run` beside
`JULIA`, and four things change: the step is the binomial `(Z + δ)^d − Z^d` in Horner form;
the interior switch's slope is `d²|z|^{2(d−1)}`; the smooth count's base is `ln d`; the
reference orbit is `z^d` in fixed point. ⚠ Its bailout is checked after the step, and at
degree four a limb can wrap silently; `newton_step` has the same guard. At `d = 2` each is
the original line, and the kernel's `oracle.rs` pins degree two's bytes. The cap has no
term for the degree. The degree frames are the kernel's `DEGREE_FRAMES`, found by
`descend_to_deep_frames_at_a_degree`.

**The constants are shared across degrees**, re-swept at each: the kernel's
`policy::FAULT_EXPONENT` and `FAULT_SHARE`, `kernel::INTERIOR_EXPONENT`, and `TILE_PERIODS`.
⚠ At degree six the body frames run out of ceiling, and **`cap::AUTOMATIC_CEILING` stays a
million (Matt)**: Details' stat line says how much is undecided there, and Double takes a
frame to `cap::EXPLICIT_CEILING`.

**Minibrots at degree `d`**: Newton is `d·z^{d−1}` and the body is `1/|b·l^{d/(d−1)}|`, so a
view at 1e-n finds minibrots near 1e-(d/(d−1))n (`nuclei::body_power`, `body_scale`).
`each_degrees_island_is_found_and_sized_against_a_measured_body` holds the formula at 1% to
a body measured independently. It holds for copies, not bulbs; that is §12's.

### 11. The dive

`src/dive.rs` is the arithmetic of the Dive block and New coloring, exported as
`dive_pick`, `dive_land`, `landing_periods`, and `coloring_rule`;
`builder/deep-gallery-native` runs the same functions natively, so a frame found either way
opens identically. `explorer/README.md`'s *The Dive block* is what the page does with it.

- **`twin` eliminates its shooting backward**, so the recursion contracts; forward, it grows
  like the multipliers' product and a period in the hundreds cannot be anchored.
- **A mapped landing is anchored and scaled locally**: `twin + s·(C − c_B)`, `w·|s|` wide,
  `s = σ_B / σ_twin`. The first-order place lands thousands of frames off, and the copy's
  own scale is a few percent and degrees off the local one. The page states the turn.
- **The rung rule** (`pick`): the first copy, largest first, that is a step down
  (`RUNG_SHRINK`, `RUNG_APART`, or with no rungs `FRESH_SHARE`) and whose landing fits.
  Refusals: `no_copy`, `none_smaller`, `over_budget`.
- **The cap rule** (`cap_for`): the width's cap or `period × count`, whichever is more;
  `fits` refuses past `cap::EXPLICIT_CEILING`. So a chain of mapped landings gets its depth
  from the first view, and Dive's own search (`WIDEN` in `explorer/deep.js`) misses the
  low-period copies a deeper stage could use.
- **The coloring rule** is `deep_gallery.py`'s `choose`, ported (`LAMBDAS`, `ROUGH`). Its
  two draws, the cycles (uniform from 1 to 4, Matt) and a passing λ, are uniform numbers
  the caller passes in and can record. The page runs it on a worker.

### 12. Copy or bulb, by the root

A component of period `p` is a satellite if and only if its root's cycle point has a lower
period `q | p`. `nuclei::classify` solves all `d − 1` roots: it polishes the nucleus (or
refuses it as not one), solves each root from the renormalization's cusp, reads a regular
root by the literal test (`QUADRATIC`) and a singular one by the collapse test at
`ROOT_CONVERGED`, and calls anything else unresolved (escaped, wandered, or unconverged in
`ROOT_MAX_STEPS`), which the page treats as not a copy and logs. No pre-filter is used: one
may only reject, which saves nothing on the copies the cost is spent on.

#### Perturbed roots

The passes run as perturbation around the nucleus's `f64` orbit (`newton_perturbed`), with
the fixed-point solve's tests and stopping rule. A root goes to the fixed-point solve on a
glitch, on a deep cusp (whose quadratic fall a perturbed pass cannot see), outside a
double's exponent, or where a literal-test distance does not clear its rounding bound.
`classify_by` runs either solve; `tests/classify_speed.rs` holds them to the same verdicts.

## Running it

Everything here needs the sibling checkout, `fractal-wallpapers`, beside this one: without
it cargo stops before building, and `cargo fmt --check` cannot resolve the tests' `#[path]`
`mod common`.

```text
cargo fmt  --check                                            # held: rustfmt-clean
cargo test --release                                          # the unit tests
cargo test --release --test probe   -- --ignored --nocapture  # the three-way probes
cargo test --release --test measure -- --ignored --nocapture  # minutes
cargo test --release --test descend -- --ignored --nocapture  # minutes
cargo test --release --test classify_speed -- --ignored --nocapture collect  # or bench
MEASURE_DEGREE=3 cargo test --release --test measure -- --ignored --nocapture
DESCEND_DEGREE=3 cargo test --release --test descend -- --ignored --nocapture at_a_degree
python -m builder explorer --perturb                          # from the site's root
node explorer/bench/perturb-parity.mjs <old.wasm> <new.wasm>  # a rebuild against the old
```

The kernel's own tests run in `fractal-wallpapers/perturbation` (its README's *Running
it*). `perturb-parity.mjs` holds a rebuild, since native pins cannot (wasm takes `ln` from
another library): over every spec in the kernel's `tests/parity-specs.jsonl` it compares
the reference orbit, `compute_band` whole and split, `compute_samples`, and `band_ran` /
`band_saved`, between two builds, byte for byte.

## Committed: `perturb.wasm`

`explorer/perturb.wasm`, `explorer/perturb-scalar.wasm`, and `explorer/perturb.manifest.json`
are tracked. The page picks by `deep-render.js`'s `simdSupported`, and fetches neither until
the Deep tab opens or Find minibrots or New coloring is pressed.

⚠ **Any source edit here, a formatting commit included, owes a rebake**: `python -m builder
explorer --perturb` rebuilds both modules and the manifest, and nothing else; `builder
check`'s `bake` does not catch a stale module. It needs `cargo`, the
`wasm32-unknown-unknown` target, and the sibling checkout, sets `RUSTUP_TOOLCHAIN` to
`builder/explorer.py`'s `TOOLCHAIN` and refuses any other, and refuses a kernel that is not
the tree the engine manifest pins (uncommitted edits included). So a kernel change, a
wallpapers item, is rebuilt here pin first: `python -m builder explorer` (which writes
`wallpapers_commit`), then `--perturb`, in the order `explorer/README.md`'s *Rebuilding*
gives.

**One import, `env.progress(done, total)`**, supplied by whoever instantiates the module:
`deep-worker.js` posts at most every `PROGRESS_MS`, the planner and `bench/perturb.mjs` do
nothing. The kernel's `progress.rs` calls it every `EVERY` orbit steps and once a probe or
domain-walk cell, so the page can tell a slow frame from a stranded pool.

| manifest field | what it holds |
| --- | --- |
| `schema`, `built`, `crate` | the record's version (`3`), the build date, `explorer/perturb-wasm` |
| `dependencies` | `["fractal-wallpapers/perturbation"]` |
| `kernel_tree` | git's id for the sibling's `perturbation/` tree built from: a fingerprint, not a pin |
| `modules` | each module's `raw_bytes`, `gzip_bytes`, and `rustflags` |
| `pinned_by` | `"engine.manifest.json wallpapers_commit"` |
| `rustc` | the compiler, with its commit and date |

**One pin, written once**: the kernel's commit is the engine manifest's `wallpapers_commit`,
which `build_perturb` checks, so it is true of all three modules at once. `builder check`'s
staleness notes report a sibling `HEAD` off the pin and modules whose `kernel_tree` is not
the pin's. `engine_version` and `engine_changes` are absent: this crate does not link the
engine, and the tab shades through the existing `shade_level` (`explorer/deep.test.mjs`).

**Reproducibility**: built under `--remap-path-prefix` as `engine.wasm` is, but cargo's
`-C metadata` hash of a path dependency's location moves the bytes with the checkouts'
parent directory (`explorer/README.md`, *The engine, compiled*). `core::fmt` is most of the
size, and stays: refusals are sentences the tab reads.
