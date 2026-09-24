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

**And it gzips what Pages gzips** *(preclose_site_ckpt131)*. Pages compresses every text
type and `application/octet-stream` (and so the wasm and the models), gzip only, at about
level 6, and sends the *compressed* `content-length`. A preview that sent the raw bytes
hid exactly that: the Walk's `fetchBytes` sized its buffer from `content-length`, which
under Pages is a quarter of the runtime, and the judges never loaded on the deployed site
while loading fine here. So the same responses go out the same way, and a local walk takes
the load path a reader's does. Pictures go out as they are, which is also what Pages does.
A compressed body is kept per file and modification time, so the 28 MB runtime is
compressed once per edit rather than once per reload.
"""

import email.utils
import functools
import gzip
import threading
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from io import BytesIO
from pathlib import Path

from .paths import SITE_ROOT

DEFAULT_PORT = 8000
HOST = "localhost"
GZIP_LEVEL = 6

# The types Pages compresses. Everything else, which here means pictures, goes out raw.
COMPRESSED_TYPES = {
    "application/javascript",
    "application/json",
    "application/octet-stream",
    "application/wasm",
    "image/svg+xml",
}

_compressed: dict[Path, tuple[int, bytes]] = {}
_compressed_lock = threading.Lock()


def _gzipped(path: Path, mtime_ns: int) -> bytes:
    """The file's bytes at `GZIP_LEVEL`, compressed once per modification time."""
    with _compressed_lock:
        cached = _compressed.get(path)
    if cached is not None and cached[0] == mtime_ns:
        return cached[1]
    body = gzip.compress(path.read_bytes(), GZIP_LEVEL, mtime=0)
    with _compressed_lock:
        _compressed[path] = (mtime_ns, body)
    return body


class Preview(SimpleHTTPRequestHandler):
    """The committed bytes, gzipped where Pages gzips them, marked to be revalidated."""

    # Python's table leaves `.mjs` out on Windows and serves it as `text/plain`, which a
    # browser refuses to run as a module. Pages serves it as JavaScript, and so does this.
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map, ".mjs": "text/javascript"}

    def end_headers(self) -> None:
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def _compressible(self, path: Path) -> bool:
        kind = self.guess_type(path)
        return kind.startswith("text/") or kind in COMPRESSED_TYPES

    def send_head(self):
        path = Path(self.translate_path(self.path))
        accepts = self.headers.get("Accept-Encoding", "")
        if (
            not path.is_file()
            or self.path.split("?", 1)[0].endswith("/")
            or "gzip" not in accepts.lower()
            or not self._compressible(path)
        ):
            return super().send_head()

        stat = path.stat()
        if self.headers.get("If-Modified-Since") and "If-None-Match" not in self.headers:
            try:
                since = email.utils.parsedate_to_datetime(self.headers["If-Modified-Since"])
            except (TypeError, IndexError, OverflowError, ValueError):
                since = None
            fresh = since is not None and since.tzinfo is not None
            if fresh and int(stat.st_mtime) <= since.timestamp():
                self.send_response(HTTPStatus.NOT_MODIFIED)
                self.send_header("Vary", "Accept-Encoding")
                self.end_headers()
                return None

        body = _gzipped(path, stat.st_mtime_ns)
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", self.guess_type(path))
        self.send_header("Content-Encoding", "gzip")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Vary", "Accept-Encoding")
        self.send_header("Last-Modified", self.date_time_string(stat.st_mtime))
        self.end_headers()
        return BytesIO(body)


class Server(ThreadingHTTPServer):
    """A threading server whose listen queue can take a page's worth of requests at once.

    `socketserver` listens with a backlog of five, and a gallery panel asks for dozens of
    tiles in the same instant: on Windows the connections past the backlog are refused
    outright, which a browser reports as `ERR_CONNECTION_REFUSED` and the page as a tile or
    a module that never came. The bug hunt had filed that as this server's capacity limit
    and learned to discount it (`explorer/bench/hunt/lib.mjs`). It was the backlog
    (profiling_pass_ckpt146).
    """

    request_queue_size = 128


def serve(port: int = DEFAULT_PORT) -> None:
    """Serve the checkout root until interrupted."""
    handler = functools.partial(Preview, directory=str(SITE_ROOT))
    with Server((HOST, port), handler) as server:
        print(f"serving the committed tree at http://{HOST}:{port}/index.html")
        print("ctrl-c to stop")
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            print()
