# assets/images

Web-res images only: what a page displays, sized for a page.

Full-size wallpapers are **GitHub Releases assets** and never enter git history. If a
reader would want the actual wallpaper, the page links to a release download; if the
page needs to show it, a derivative goes here.

```
figures/     one image per article figure. The registry that names them is
             article/figures.jsonl, beside the other two article registries
galleries/<slug>/
             a gallery: web-res images, gallery.jsonl, and a generated thumbs/
```

Images arrive through `python -m builder import <source> <destination>`, which
downscales, crops if asked, and writes the format the destination's suffix names. The
source path is a command-line argument and is never recorded: originals live outside
this repository.

The two figures that are diagrams rather than renders — `escape-orbit-race.png`, an
APNG, and `pipeline-overview.png` — are the exception: `python -m builder diagram <id>` draws
them here from `builder/diagrams.py`, so there is no original anywhere.
`overview-pipeline.webp` is not one of them: it reads as a diagram and is a composed sheet
with four real renders in it, drawn by a rig under ignored `scratch/`.

**An animation is copied, never imported.** Pillow's one-image read keeps the first frame
and silently drops the rest, so an APNG that went through `import_web_res` would land as
a still nobody would notice was still. A maker that draws one names it in its own
`ANIMATED` set — `locations.ANIMATED` is the one such set, and it is empty since
`locations-walk-descent` replaced the animated walk step — and `--place` writes the bytes
across and measures the file rather than reopening it. The sheet is already web-res, which
is what makes that safe. `escape-orbit-race` never meets the question: `diagram` writes it
here directly.

Before staging an image drop, check its aggregate size against the 20 MB commit gate in
`CLAUDE.md`.
