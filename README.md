# Making Fractal Wallpapers

This builds the fractal wallpapers site: an article on how the collection was made, an
explorer for finding pictures of your own or interacting with the existing gallery pictures, and the wallpaper packs. The pipeline that generated the wallpapers, and the engine that draws them, live in [fractal-wallpapers](https://github.com/techmatt/fractal-wallpapers). Most visitors want one of the links below.

- **Wallpapers to download:** [Wallpaper packs](https://techmatt.github.io/fractals/wallpaper-packs/)
- **Exploring for yourself:** [The fractal explorer](https://techmatt.github.io/fractals/explorer/)
- **How it was made:** [The article, starting here](https://techmatt.github.io/fractals/start-here.html)
- **The pipeline and engine code:** [fractal-wallpapers](https://github.com/techmatt/fractal-wallpapers)
- **The site's code** (explorer, article, builder): you are here; read on.

<p align="center">
  <a href="https://techmatt.github.io/fractals/explorer/index.html?v=4&f=julia&cx=-1.2583366697573282&cy=-0.03810995140056672&m=smooth_mean_angle&weight=0.55&x=-0.0939167613435858&y=-0.2012267774092059&w=0.17345963982562132&p=skyroads-blue-25&phase=0.788175"><img src="examples/julia_smooth_mean_angle.jpg" width="24%" alt="Julia set, trap spread angle over smooth, Cobalt Obsidian palette"></a>
  <a href="https://techmatt.github.io/fractals/explorer/index.html?v=4&x=-0.056703850480536507&y=0.6689946803923973&w=0.0000000021132721900905024&p=Petal%20Dusk&phase=0.046639&level=band_autolevel/v1:0.2958367414372542,0.8390717419257583,1.1785094930375575,0.2958367414372542,0.8629886965307019"><img src="examples/mandelbrot_smooth.jpg" width="24%" alt="Mandelbrot set, smooth, Petal Dusk palette"></a>
  <a href="https://techmatt.github.io/fractals/explorer/index.html?v=4&f=julia&cx=-1.2517612129804818&cy=0.038979112285470574&m=stripe&x=0.190964531525442&y=-0.027508345978564743&w=0.13834453039497419&p=Emerald%20Ingot"><img src="examples/julia_stripe.jpg" width="24%" alt="Julia set, stripe average, Emerald Ingot palette"></a>
  <a href="https://techmatt.github.io/fractals/explorer/index.html?v=4&f=julia4&cx=0.4892207660373146&cy=-0.6507282511501382&m=threads&x=-0.1599467583852486&y=-0.6348190856721863&w=0.01057422759599882&p=abstract-wallpaper-backgrounds-hd&phase=0.827208"><img src="examples/julia_multibrot4_threads.jpg" width="24%" alt="Quartic Julia set, cross trap over smooth, Amber Sea palette"></a>
</p>

A tutorial on making fractal wallpapers worth keeping: how an escape-time fractal is
drawn, how a search finds views worth looking at, how those views get their color, and how
a judge trained on somebody's taste picks between the thousands of pictures that come out.
It is an article about a working pipeline rather than about the mathematics, so every
claim in it stands on pictures that pipeline actually made, and the finished wallpapers are
there to be argued with.

The explorer is the same renderer the wallpapers were drawn with, running in the browser:
pan and zoom any family the article covers, in any of its rendering modes, under any of a
thousand palettes, and copy a link to whatever is on screen. Most pictures in the article
open straight into it. The article links into fractal-wallpapers section by section, at the
code each part is about.

## Reading it locally

The site is static and has no build step, but it wants to be served rather than opened off
the disk: a browser will not load the explorer's modules, workers or renderer over
`file://`, and Chrome forgets page zoom there at every navigation.

```
python -m builder serve
```

Then open `http://localhost:8000/index.html`. That builds nothing and writes nothing — it
puts the committed tree on localhost exactly as GitHub Pages serves it. Serving needs only
Python 3; spell it `python3` on macOS or Linux outside a virtualenv.

## Installing

The same steps on Windows, macOS and Linux, and CI runs them on all three. Python 3.13 for
the builder and its checks, and Node 22 or later for the explorer's test suites, which need
nothing installed beyond Node itself.

```
python3 -m venv .venv                  # `python` on Windows
source .venv/bin/activate              # Windows: .venv\Scripts\activate
python -m pip install -r builder/requirements.txt
python -m builder check
```

Rust matters only if you rebuild the explorer's wasm modules, which are committed: the
toolchain their manifests record (`explorer/engine.manifest.json`'s `rustc`, 1.96.0 today)
with `rustup target add wasm32-unknown-unknown`. `explorer/engine-wasm` also wants a
`fractal-wallpapers` checkout beside this one, and says so if it is missing.

---

## For anyone working on it

Plain static HTML and CSS, no framework, no bundler, no npm. **What is committed is what
is served**: `builder/` is a local Python program that writes the gallery pages, the
contents rail and the figure blocks, and its output is committed — Pages serves the commit
and never runs Python. `python -m builder check` is twenty-four named checks over the
committed tree: that every internal link resolves, that the generated HTML is what the
builder would produce, that every figure block matches its registry row, and twenty-one more.

- [`builder/README.md`](builder/README.md) — every command, and what each check holds.
- [`explorer/README.md`](explorer/README.md) — the one page that runs code: the wasm
  modules, the link contract and its test suites.
- [`CLAUDE.md`](CLAUDE.md) — the conventions this repository is held to, and why each one
  is there.

Deployed from `main` by GitHub Actions. MIT.
