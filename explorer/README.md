# The visitor explorer

One page that runs the wallpaper project's own renderer in the browser: pan and zoom
the Mandelbrot set in the `smooth` mode, pick from the curated palettes, and copy a link
to whatever is on screen. Draft 1 — one family, one mode, `f64` only.

**This is the site's one page that runs code.** Everything under `article/` is still
plain HTML and still opens from the filesystem; this one needs to be served, because a
browser will not load a page's module, its workers or its wasm over `file://`.
`python -m builder serve` is enough.

## What is here

```
index.html            the page
explorer.css          its own stylesheet, on top of the site's
explorer.js           what a reader touches: drag, wheel, keys, picker, copy link
render.js             the worker pool, the field passes, the shade
worker.js             one worker: one wasm instance, one band of rows
permalink.js          the link contract — parse, validate, canonicalize
permalink.test.mjs    `node --test explorer/permalink.test.mjs`
palettes.js           generated: the curated colormaps, by name
engine.wasm           generated: the engine, compiled
engine.manifest.json  generated: what engine.wasm was built from
engine-wasm/          the crate that produces engine.wasm
```

The three generated files are **committed artifacts**. The site never builds; a clone
with no wallpaper project beside it serves this page exactly as this checkout does.
Regenerating them is `python -m builder explorer`, which needs the sibling checkout and
a Rust toolchain with the `wasm32-unknown-unknown` target.

## The seam

The engine keeps a seam between a *field* — one scalar per sample, the expensive part —
and the *color* it is read into. This page holds that seam open one level further out:

```
compute_field(spec, row_start, row_end) -> f32 bytes   in a worker, a band at a time
shade(field, palette, shade params)     -> RGBA        on the main thread, milliseconds
```

That is why a palette change is instant: the field is already here, and only the color
is recomputed. It is also why `shade` takes the **whole** field and never a band — the
engine normalizes a frame against its own 0.5th and 99.5th percentiles, so a band shaded
alone would be stretched against the wrong histogram and would not match its neighbours.

A pass draws twice: a quarter-resolution field first, then the full one. The preview is
a separate field of the same rectangle rather than a subsample, so it carries its own
normalization and can be a shade off the picture that replaces it.

## The permalink

`permalink.js` is the only thing that decides what a link means, and the contract it
implements is meant to outlive every other file here. The keys, in the order they are
emitted:

```
v · f · m · x · y · w · a · p · gamma · cycles · phase · reverse · mirror · transfer · rolloff
```

`v=1` is required. An unknown version, an unknown key, a family or a mode this draft
does not draw, a palette outside the curated set — every one of them is **refused with a
visible message**, never guessed at. Defaults are left out on emit, so the canonical
string carries what somebody actually chose — except `p`, which is **always** emitted.
The palette is the one default whose meaning lives outside `permalink.js`, in the baked
set, and a bare link that inherited it would change colour the day that set is rebuilt.
Reading a link with no `p` is unchanged and still means the default, so nothing about
what a v1 link means has moved. `x`, `y` and `w` are echoed back verbatim:
the decimal string is the identity of a location, and a round trip through a double
would quietly rewrite a link that was more precise than today's renderer.

`julia`, `multibrot3`, `multibrot4`, `multibrot5` and `phoenix`, the engine's other
seventeen production modes, and the keys `cx`, `cy` and `pp` are all **reserved**: they
parse, and they are refused with "not yet" rather than "no such thing".

## Rebuilding

```
python -m builder explorer                 # palettes, wasm, manifest
python -m builder explorer --palettes-only # when only the colormaps moved
node --test explorer/permalink.test.mjs    # the contract
```

`python -m builder check` reads `engine.manifest.json` back and prints a note when the
committed module was built from a wallpapers commit that is no longer an ancestor of
that checkout's HEAD. A note, not a failure: the module is committed and the site serves
it whichever commit it came from.
