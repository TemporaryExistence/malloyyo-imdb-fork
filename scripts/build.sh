#!/usr/bin/env bash
# Bundle the site, then apply the post-bundle patches.
#
# ⛑ USE THIS, not the bare malloyyo command. The bundler regenerates docs/*.html
# from scratch, so the person-autofill script tag added to works_together.html
# is destroyed by every raw bundle. scripts/postbuild.sh puts it back, and
# stress.js has an assertion that fails if it was skipped.
set -euo pipefail
cd "$(dirname "$0")/.."
npx --no-install malloyyo dashboard bundle --out docs --title "malloyyo-imdb-fork" --duckdb bundled --no-serve
bash scripts/postbuild.sh
