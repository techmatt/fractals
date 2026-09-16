"""Previewing the committed tree over localhost.

Every page a reader *reads* opens from the filesystem, and that is a rule. Two things
still want a server. The explorer runs code, and a browser will not load a page's module,
its workers or its wasm over `file://` at all — so that one page has to be served or it
does not start. And a browser is not neutral about the origin even for the pages that do
open: Chrome keys page zoom to one, and does not persist a zoom level for `file://`, so a
preview opened from disk snaps back to 100% at every navigation. Served from here the
whole site is one origin, and a zoom set on the first page is still there on the tenth.

What it serves is the committed bytes, from the checkout root, the way Pages serves
them. It builds nothing, writes nothing, and is not a dependency of anything.

**And it asks a browser to revalidate, which is not how Pages serves them**
*(2026-09-16)*. This server sends a `Last-Modified` and nothing else, so a browser is free
to apply its own heuristic freshness and reuse a module it fetched days ago without
asking. The port is always 8000 and the paths never change, which makes that likely
rather than theoretical: the studio's first preview came up on a stale `explorer.js` from
before the page was rebuilt, which took the old module's `getElementById` of a control
that no longer exists, threw at evaluation, and left the boot notice standing — a page
that looks like it never started, over a file nobody would think to look at, because the
request is not in the log.

`no-cache` is the header for that and `no-store` is not, though the names suggest
otherwise: this one says *keep it, and ask before using it*, so the browser sends its
`If-Modified-Since` and gets a 304 for everything that has not moved. `no-store` was the
first fix here and it was the wrong one — it made every reload re-fetch the gallery
panel's thumbnails, a couple of hundred of them, and on a machine with a solve running
next door they painted half-decoded, which reads as a grid of broken pictures. Neither
header is a claim about production: Pages sends its own.
"""

import functools
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

from .paths import SITE_ROOT

DEFAULT_PORT = 8000
HOST = "localhost"


class Preview(SimpleHTTPRequestHandler):
    """The committed bytes, with every response marked to be revalidated before use."""

    def end_headers(self) -> None:
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()


def serve(port: int = DEFAULT_PORT) -> None:
    """Serve the checkout root until interrupted."""
    handler = functools.partial(Preview, directory=str(SITE_ROOT))
    with ThreadingHTTPServer((HOST, port), handler) as server:
        print(f"serving the committed tree at http://{HOST}:{port}/index.html")
        print("ctrl-c to stop")
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            print()
