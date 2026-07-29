#!/usr/bin/env python3
"""Inject the Google Analytics tag into every generated page in docs/.

`malloyyo dashboard bundle` has no analytics option — it writes the <head> of
each page itself — so the tag has to be added afterwards. That means this script
must be re-run after every bundle, or the tag silently disappears:

    malloyyo dashboard bundle --out docs
    python3 scripts/add_analytics.py

Idempotent: a page that already carries the measurement id is left alone, so
running it twice does not double up the snippet.
"""

from __future__ import annotations

import glob
import os
import sys

MEASUREMENT_ID = os.environ.get("GA_MEASUREMENT_ID", "G-6F8VEHMGWT")
ANCHOR = "</head>"


def snippet(mid: str) -> str:
    return (
        f'<script async src="https://www.googletagmanager.com/gtag/js?id={mid}"></script>\n'
        "<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}\n"
        f"gtag('js',new Date());gtag('config',\"{mid}\");</script>\n"
    )


def main() -> int:
    root = sys.argv[1] if len(sys.argv) > 1 else "docs"
    pages = sorted(glob.glob(os.path.join(root, "*.html")))
    if not pages:
        print(f"no .html files in {root}/ — run `malloyyo dashboard bundle` first", file=sys.stderr)
        return 1

    tag = snippet(MEASUREMENT_ID)
    added, skipped = [], []
    for path in pages:
        with open(path, encoding="utf-8") as fh:
            html = fh.read()
        if MEASUREMENT_ID in html:
            skipped.append(os.path.basename(path))
            continue
        if ANCHOR not in html:
            print(f"! {path}: no {ANCHOR} to anchor to, skipping", file=sys.stderr)
            continue
        # Last </head> guards against the string appearing earlier in content.
        head, sep, rest = html.rpartition(ANCHOR)
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(head + tag + sep + rest)
        added.append(os.path.basename(path))

    if added:
        print(f"added {MEASUREMENT_ID} to: {', '.join(added)}")
    if skipped:
        print(f"already tagged: {', '.join(skipped)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
