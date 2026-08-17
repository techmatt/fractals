# article

One page per section, in reading order, named for the section slug the front page links
to. The ten sections, ratified:

```
overview.html                     rendering-modes.html      color-palettes.html
escape-time-fractals.html         finding-good-locations.html
rendering-fundamentals.html       training-judges.html      running-at-scale.html
                                  from-locations-to-wallpapers.html
                                  deep-zoom.html
```

`overview.html` and `escape-time-fractals.html` are written. Every other page is still a
stub: the slug, the standfirst, the section navigation, and whatever figures the prose will
be built around. A page that has been written loses the *Not written yet* standfirst
treatment along with its `intro` section, and its prose lives in `<section class="prose">`.
Slugs here are permanent URLs, so they
answer to the naming rule in `CLAUDE.md` before anything else — a section is named for
what it does, in vocabulary the article itself teaches.

Two conventions the written pages follow:

- **First mention gets the link.** The first time a page names a topic it does not itself
  teach — the complex plane, Ultra Fractal, a Mandelbulb — that mention carries an outside
  reference, usually Wikipedia. Later mentions are plain. Sparingly: a paragraph of blue is
  a link list, not prose.
- **A forward reference is a link, not a promise.** A section named in the text points at
  its page whether or not that page is written yet, spelled relative
  (`finding-good-locations.html`) and with the section's ratified name as the link text.

**These pages are hand-written and the builder does not generate them.** The one part
it owns is the figure block: `python -m builder figure <id>` prints the markup to paste,
and `python -m builder check` asserts the page still matches the registry in
`../assets/images/figures/figures.jsonl`.
