# fractal-website

The public site for the fractal wallpapers project: a tutorial article on rendering
escape-time fractals, finding views worth keeping, and training models to judge them —
plus galleries of the finished wallpapers.

Live at **https://techmatt.github.io/fractal-website/**. Plain static HTML and CSS,
deployed from `main` by GitHub Actions. Full-size wallpapers ship as Releases assets;
only web-res images live in this repository.

Gallery pages, and the contents rail every page carries, are written by `builder/`, a
local Python program whose output is committed — Pages serves the commit and never runs a
build. `python -m builder check` verifies that the committed HTML is what the builder
produces and that every internal link resolves.

Companion code repository: [techmatt/fractal-wallpapers](https://github.com/techmatt/fractal-wallpapers).
