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
"""

import functools
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

from .paths import SITE_ROOT

DEFAULT_PORT = 8000
HOST = "localhost"


def serve(port: int = DEFAULT_PORT) -> None:
    """Serve the checkout root until interrupted."""
    handler = functools.partial(SimpleHTTPRequestHandler, directory=str(SITE_ROOT))
    with ThreadingHTTPServer((HOST, port), handler) as server:
        print(f"serving the committed tree at http://{HOST}:{port}/index.html")
        print("ctrl-c to stop")
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            print()
