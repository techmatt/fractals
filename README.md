# Making Fractal Wallpapers

A tutorial on making fractal wallpapers worth keeping: how an escape-time fractal is
drawn, how a search finds views worth looking at, how those views get their color, and how
a judge trained on somebody's taste picks between the thousands of pictures that come out.
It is an article about a working pipeline rather than about the mathematics, so every
claim in it stands on pictures that pipeline actually made, and the galleries are there to
be argued with.

**Read it at [techmatt.github.io/fractal-website](https://techmatt.github.io/fractal-website/).**

- **[The article](https://techmatt.github.io/fractal-website/)** — fourteen sections in
  reading order, from what a fractal is through to the whole pipeline end to end.
- **[The explorer](https://techmatt.github.io/fractal-website/explorer/)** — the same
  renderer the wallpapers were drawn with, running in the browser. Pan and zoom any family
  the article covers, in any of its rendering modes, under any of a thousand palettes, and
  copy a link to whatever is on screen. Most pictures in the article open straight into it.
- **[The wallpaper packs](https://techmatt.github.io/fractal-website/wallpaper-packs/index.html)** —
  the finished wallpapers. What a page shows is web-res; full-size files are to ship as
  release assets rather than in this repository's history.

The pipeline that found, rendered and judged all of it is a separate project:
**[techmatt/fractal-wallpapers](https://github.com/techmatt/fractal-wallpapers)**. The
article links into it section by section, at the code each part is about.

## Reading it locally

The site is static and has no build step, but it wants to be served rather than opened off
the disk: a browser will not load the explorer's modules, workers or renderer over
`file://`, and Chrome forgets page zoom there at every navigation.

```
python -m builder serve
```

Then open `http://localhost:8000/index.html`. That builds nothing and writes nothing — it
puts the committed tree on localhost exactly as GitHub Pages serves it.

---

## For anyone working on it

Plain static HTML and CSS, no framework, no bundler, no npm. **What is committed is what
is served**: `builder/` is a local Python program that writes the gallery pages, the
contents rail and the figure blocks, and its output is committed — Pages serves the commit
and never runs Python. `python -m builder check` is eighteen named checks over the
committed tree: that every internal link resolves, that the generated HTML is what the
builder would produce, that every figure block matches its registry row, and fifteen more.

- [`builder/README.md`](builder/README.md) — every command, and what each check holds.
- [`explorer/README.md`](explorer/README.md) — the one page that runs code: the wasm
  modules, the link contract and its test suites.
- [`CLAUDE.md`](CLAUDE.md) — the conventions this repository is held to, and why each one
  is there.

Deployed from `main` by GitHub Actions. MIT.
