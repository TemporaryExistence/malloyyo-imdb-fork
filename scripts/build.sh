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

# ⚡ THE COLD-START CACHE. Must run on EVERY build, because it is derived from the
# same parquets and the same bounds as shared_queries.malloy — a build that refreshed
# the data but not this file would serve a homepage from stale data while every
# post-rating query returned the new data. It fails the build loudly rather than
# shipping an empty or truncated cache (see the assertions in the script).
bash scripts/build_cold_start.sh
