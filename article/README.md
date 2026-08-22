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

`overview.html`, `escape-time-fractals.html`, `rendering-fundamentals.html`,
`rendering-modes.html` and `finding-good-locations.html` are written. Every other page is
still a stub: the slug, the section navigation, whatever figures the prose will be built
around, and an `intro` section that says what the section is about and then says it is not
written yet. A page that has been written loses that `intro`, and its prose lives in
`<section class="prose">`. **No page carries a standfirst** — the ruling in
`writing-guidance.md` cut the device site-wide, and a page opens on its lead.

Slugs here are permanent URLs, so they answer to the naming rule in `CLAUDE.md` before
anything else — a section is named for what it does, in vocabulary the article itself
teaches.

Three conventions the written pages follow:

- **First mention gets the italic.** The first time the article introduces a piece of its
  own vocabulary — *pipeline*, *location*, *escape time*, *palette*, a mode name — that
  mention is wrapped in `<i>`, Wikipedia's words-as-words style. Once across the whole
  article in reading order, not once per page, and `<em>` stays reserved for emphasis.
  `CLAUDE.md` carries the full rule.
- **First mention gets the link.** The first time a page names a topic it does not itself
  teach — the complex plane, Ultra Fractal, a Mandelbulb — that mention carries an outside
  reference, usually Wikipedia. Later mentions are plain. Sparingly: a paragraph of blue is
  a link list, not prose.
- **A forward reference is a link, not a promise.** A section named in the text points at
  its page whether or not that page is written yet, spelled relative
  (`finding-good-locations.html`) and with the section's ratified name as the link text.

**These pages are hand-written and the builder does not generate them.** Two parts of one
are the builder's:

- **the figure block** — `python -m builder figure <id>` prints the markup to paste, and
  `python -m builder check` asserts the page still matches the registry in
  `../assets/images/figures/figures.jsonl`;
- **the contents rail**, between the `contents-rail` marker comments, and the `id` on
  every prose `<h2>`, which is derived from the heading's own words. `python -m builder
  build` writes both; nothing between the markers is worth typing.

Two pages hang off **Color palettes** without being sections of their own, and they live
in `../palettes/` rather than here: `all-palettes.html`, which the builder generates —
every palette in the library as a strip, grouped the way the section groups them — and
`make-your-own.html`, the generator brief, which is hand-written the way a section is.
A registry names either of them with its slash: `palettes/make-your-own.html`.

`sections.jsonl` here gives the ten pages their reading order and marks the ones that are
written — the flag behind the done marker in the rail and on the front page. A new page
goes in that file, or the rail will not know about it and `check` will say so.
