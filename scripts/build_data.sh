#!/usr/bin/env bash
# Rebuild the site's data files from the IMDb source datasets.
#
# This is the whole data recipe, runnable by hand or from CI
# (.github/workflows/refresh-data.yml). It is deliberately linear so it reads
# as a template: to adapt it to another dataset, change the three numbered
# steps -- the download list (data/get.sh), the transform (transform.malloy),
# and the exported tables (the COPY block below).
#
# Prereqs on PATH: bash, wget, duckdb, and malloy-cli
# (install with: npm install -g @malloydata/cli).
set -euo pipefail

cd "$(dirname "$0")/.."   # repo root

# 1. Download the source datasets into data/ (gitignored).
bash data/get.sh

# 2. Transform: build the cleaned tables with Malloy.
#    transform.malloy reads data/*.tsv.gz through the `build` connection
#    (malloy-build.json) and materializes each `#@ persist` source into a
#    fresh data/build.duckdb.
rm -f data/build.duckdb
malloy-cli -c malloy-build.json build transform.malloy

# 3. Export each table to the parquet the site serves (docs/, committed).
#    The persist name (e.g. titles) maps to the served name (imdb_titles) here.
duckdb data/build.duckdb <<'SQL'
COPY titles     TO 'docs/imdb_titles.parquet'     (FORMAT parquet);
COPY principals TO 'docs/imdb_principals.parquet' (FORMAT parquet);
COPY names      TO 'docs/imdb_names.parquet'      (FORMAT parquet);
SQL

echo "Built:"
echo "  docs/imdb_titles.parquet"
echo "  docs/imdb_principals.parquet"
echo "  docs/imdb_names.parquet"
