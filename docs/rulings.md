# Standing rulings

The rulings an item in this repository works under, current only. `CLAUDE.md` holds the
conventions; this file holds what was ruled. A ruling changes by an edit here.

## The two repositories

- A website item never commits into `fractal-wallpapers`. An engine change the website needs
  is its own `fractal-wallpapers` item.

## Checks and `CLAUDE.md`

- **No wording or prose checks** (Matt, 2026-11-13; removed by website 009): checks cover
  structure and data only, and none is to be added back. A prose pass runs only when a prompt
  asks for one.
- `CLAUDE.md` cleanup picks standing (2026-11-04): figure conventions live in builder/README
  *Figures are a registry*; `builder check` runs before done only for items touching the
  site, records or builder; the "ingest NAME" and review-doc triggers stay until those flows
  arrive.

## Styles and custom modes

- **Styles may post-process** (Matt, 2026-11-19): image-space passes with neighbour reads are
  allowed as a separate post stage (layers stay per-sample); post-processed modes go to
  Mandelnaut too, with explorer extensions as needed, never wallpaper-only.
- Custom modes never use deep zoom; Mandelnaut renders them in plain double precision (Matt,
  2026-11-05).
- Custom modes reach the browser as the pipeline's own style compositor compiled to
  WebAssembly, checked for parity against the keeps; a GPU shader is a later speed-up only
  (2026-11-05).
- Lighting is a style layer only, never a catalog mode; the mode catalog and `de` stay unlit
  (Matt, 2026-11-04).
- New modes enter the *Custom (lab)* tier; Matt promotes modes out of lab himself
  (2026-11-19).

## The explorer

- Explorer targets desktop only; explorer-only fast paths are fine if quality barely moves
  and their cost is easy to bound.
- Deep tab: the GPU double-single kernel is opt-in (checkbox, default off).

## Zoom videos

- Zoom videos use non-flowing colouring (fixed escape-count → colour); `knee` mapping is the
  default; final zoom renders raise the iteration cap.
