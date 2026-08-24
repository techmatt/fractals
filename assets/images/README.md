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
APNG, and `overview-pipeline.png` — are the exception: `python -m builder diagram <id>`
draws them here from `builder/diagrams.py`, so there is no original anywhere.

Before staging an image drop, check its aggregate size against the 20 MB commit gate in
`CLAUDE.md`.
