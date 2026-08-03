#!/usr/bin/env bash
# Download the IMDb source datasets into this directory (data/, gitignored).
#
# -N ("timestamping") only re-fetches a file when the server's copy is newer
# than the local one, so re-runs are cheap and safe to repeat.
set -euo pipefail
cd "$(dirname "$0")"

wget -N \
  https://datasets.imdbws.com/title.crew.tsv.gz \
  https://datasets.imdbws.com/title.ratings.tsv.gz \
  https://datasets.imdbws.com/title.basics.tsv.gz \
  https://datasets.imdbws.com/title.principals.tsv.gz \
  https://datasets.imdbws.com/name.basics.tsv.gz
