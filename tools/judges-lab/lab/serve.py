"""Serve the lab root on localhost. `--isolated` adds COOP/COEP, which is what lets
onnxruntime-web's WASM backend use threads (SharedArrayBuffer). GitHub Pages cannot send
those headers, so the non-isolated server is the one a static site actually gets.

    python lab/serve.py 8731            # plain, like Pages
    python lab/serve.py 8732 --isolated # cross-origin isolated
"""

from __future__ import annotations

import functools
import http.server
import sys
from pathlib import Path

LAB = Path(__file__).resolve().parents[1]


class Handler(http.server.SimpleHTTPRequestHandler):
    isolated = False
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        ".mjs": "text/javascript",
        ".wasm": "application/wasm",
        ".onnx": "application/octet-stream",
    }

    def end_headers(self):
        if self.isolated:
            self.send_header("Cross-Origin-Opener-Policy", "same-origin")
            self.send_header("Cross-Origin-Embedder-Policy", "require-corp")
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, *args):
        pass


def main() -> None:
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8731
    Handler.isolated = "--isolated" in sys.argv
    handler = functools.partial(Handler, directory=str(LAB))
    with http.server.ThreadingHTTPServer(("127.0.0.1", port), handler) as server:
        server.serve_forever()


if __name__ == "__main__":
    main()
