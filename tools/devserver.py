"""Static dev server for site/ that never lets the browser cache.

`python -m http.server` sends no cache headers, so browsers apply heuristic
caching to ES modules - which means an edit to a .js file can silently not
appear while the HTML around it updates. That failure mode is invisible and
wastes time, so local preview serves everything as no-store.

Production is GitHub Pages, which sets its own sensible caching; this only
affects local development.
"""

from __future__ import annotations

import argparse
import functools
import http.server
import socketserver


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self) -> None:
        self.send_header("Cache-Control", "no-store, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def log_message(self, fmt: str, *args) -> None:
        # Keep the console readable; errors still surface via log_error.
        if not str(args[1] if len(args) > 1 else "").startswith("2"):
            super().log_message(fmt, *args)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--directory", default="site")
    args = parser.parse_args()

    handler = functools.partial(NoCacheHandler, directory=args.directory)
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("", args.port), handler) as httpd:
        print(f"serving {args.directory}/ at http://localhost:{args.port} (no-store)")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nstopped")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
