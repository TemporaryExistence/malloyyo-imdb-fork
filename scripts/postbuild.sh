#!/usr/bin/env bash
# Post-bundle patches that must survive every rebuild.
#
# The bundler regenerates docs/*.html from scratch, so anything added to a
# generated page by hand is gone on the next build. This script is where those
# additions live, so "it worked yesterday" cannot become "nobody knows why it
# stopped".
set -euo pipefail
cd "$(dirname "$0")/.."

# Fuzzy autofill on the person search. It attaches to the input Lloyd's page
# already renders rather than replacing his table with a component -- see the
# header of docs/assets/person-autofill.js for why.
TAG='<script src="assets/person-autofill.js" defer></script>'
FILE="docs/works_together.html"
[ -f "$FILE" ] || { echo "postbuild: $FILE missing -- did the bundle run?" >&2; exit 1; }
# ⛑ COPY IT IN. The source lives in assets/, not docs/assets/: the bundler wipes
# and regenerates docs/ every build, and the first version of this file was
# written straight into docs/assets/ and deleted by the very next bundle.
[ -f "assets/person-autofill.js" ] || { echo "postbuild: assets/person-autofill.js missing (source)" >&2; exit 1; }
mkdir -p docs/assets
cp assets/person-autofill.js docs/assets/person-autofill.js
if ! grep -q "person-autofill.js" "$FILE"; then
  python3 - "$FILE" "$TAG" <<'PY'
import sys
path, tag = sys.argv[1], sys.argv[2]
s = open(path).read()
assert "</body>" in s, "no </body> in " + path
open(path, "w").write(s.replace("</body>", "  " + tag + "\n</body>"))
PY
  echo "postbuild: attached person-autofill to $FILE"
else
  echo "postbuild: person-autofill already attached"
fi

# Assert it, rather than trusting the grep above to have been reached.
grep -q "person-autofill.js" "$FILE" || { echo "postbuild: injection did not take" >&2; exit 1; }
