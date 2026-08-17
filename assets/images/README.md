# assets/images

Web-res images only: what a page displays, sized for a page.

Full-size wallpapers are **GitHub Releases assets** and never enter git history. If a
reader would want the actual wallpaper, the page links to a release download; if the
page needs to show it, a derivative goes here.

```
figures/     one image per article figure, plus figures.jsonl — the registry the
             figure blocks on article pages are checked against
galleries/<slug>/
             a gallery: web-res images, gallery.jsonl, and a generated thumbs/
```

Images arrive through `python -m builder import <source> <destination>`, which
downscales, crops if asked, and writes the format the destination's suffix names. The
source path is a command-line argument and is never recorded: originals live outside
this repository.

Before staging an image drop, check its aggregate size against the 20 MB commit gate in
`CLAUDE.md`.
