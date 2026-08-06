#!/usr/bin/env bash
# Build docs/data/people.parquet -- nconst -> name, with the weight that decides
# who is worth putting on a card.
#
# WHY, when imdb_names.parquet already exists: it is 5.8 MB of 141,356 rows, and
# every consumer of a person's NAME here wants the same ~16k people who actually
# carry credits. The swipe site in particular does not sync the big names and
# principals tables at all (products/movie-swipe/storage.malloy says why), and
# would otherwise have no way to label a face.
set -euo pipefail
cd "$(dirname "$0")/.."
DUCKDB="${DUCKDB_BIN:-duckdb}"
OUT="docs/data/people.parquet"
mkdir -p "$(dirname "$OUT")"

"$DUCKDB" <<SQL
COPY (
  select n.nconst, n.primaryName as name, p.total_votes, p.title_count
  from (
    select pr.nconst,
           sum(t.numVotes)::bigint as total_votes,
           count(*)::int           as title_count
    from 'docs/imdb_principals.parquet' pr
    join 'docs/imdb_titles.parquet' t on t.tconst = pr.tconst
    where pr.category in ('actor','actress','director','writer')
    group by 1
    having count(*) >= 2 and sum(t.numVotes) >= 100000
  ) p
  join 'docs/imdb_names.parquet' n on n.nconst = p.nconst
) TO '$OUT' (FORMAT parquet, COMPRESSION zstd);
SQL

"$DUCKDB" -c "select count(*) people, min(title_count) min_titles from '$OUT';"
ls -la "$OUT"
