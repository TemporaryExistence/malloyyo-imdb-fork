#!/usr/bin/env python3
"""No-cache, THREADED static server for docs/ on 127.0.0.1:8810.

Two failures this replaces, both real:
  * `python3 -m http.server` is SINGLE-THREADED. The parquet + duckdb-wasm assets are large
    and requested concurrently, so anything else hitting the port (the stress suite) starves
    a real browser and the page renders empty — which looks exactly like a product bug.
  * Cached bundles. RESUME.md §6 records that a stale cached bundle has twice made a session
    verify a build it was not looking at. Every response here is explicitly uncacheable.
"""
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = sys.argv[1] if len(sys.argv) > 1 else "docs"
PORT = int(sys.argv[2]) if len(sys.argv) > 2 else 8810


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def log_message(self, *a):
        pass


if __name__ == "__main__":
    srv = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    srv.daemon_threads = True
    print(f"serving {ROOT} on http://127.0.0.1:{PORT} (threaded, no-cache)")
    srv.serve_forever()
