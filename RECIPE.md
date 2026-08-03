# Data recipe

How the data behind this site is built and kept current. The site is static
HTML in `docs/` (served by GitHub Pages) that fetches parquet files
client-side with DuckDB-WASM, so "updating the site" just means rebuilding
those parquet files.

## The pipeline

```
data/get.sh            download IMDb .tsv.gz into data/        (gitignored)
transform.malloy       clean + rank into titles/principals/names tables
  via malloy-build.json  (the `build` DuckDB connection)
duckdb COPY            export those tables to docs/imdb_*.parquet  (committed)
resolve_posters.py     imdb_id -> TMDB poster_path -> docs/data/poster_paths.parquet
```

`scripts/build_data.sh` runs the first three steps. It's linear on purpose:
to reuse this pattern for another dataset, change the download list, the
transform, and the exported tables.

## Run it by hand

```bash
npm install -g @malloydata/cli      # once; also needs `duckdb` and `wget` on PATH
bash scripts/build_data.sh          # download -> transform -> docs/imdb_*.parquet
TMDB_READ_ACCESS_TOKEN=... python3 scripts/resolve_posters.py   # posters (optional)
```

Then commit the changed files in `docs/`.

## Weekly automation

`.github/workflows/refresh-data.yml` runs the whole recipe every Sunday at
06:00 UTC (and on demand from the Actions tab via "Run workflow"). It commits
the refreshed parquet back to the repo; Pages serves the new data with no
re-bundle.

Requires one repo secret: `TMDB_READ_ACCESS_TOKEN` (Settings -> Secrets and
variables -> Actions). Without it the data still rebuilds; only posters are
skipped.

## Keeping git from growing (occasional flatten)

Each weekly run commits ~12 MB of parquet, so history grows ~0.6 GB/year. This
is intentionally **not** part of the weekly job -- normal commits keep local
clones and Pages working simply. When the size bothers you, flatten the whole
history to a single commit (destroys history, keeps the current files):

```bash
git checkout --orphan flat
git add -A
git commit -m "flatten history"
git branch -M flat main
git push -f origin main
```

Do this only when you're the sole user of the repo (it force-pushes and
rewrites history; any other clone must `git reset --hard origin/main`
afterwards). Run it as often -- or as rarely -- as you like.
