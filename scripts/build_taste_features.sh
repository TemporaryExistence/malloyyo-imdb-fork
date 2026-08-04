#!/usr/bin/env bash
# Build docs/data/taste_features.parquet -- the table the "next watch" recommender
# runs on, entirely in the visitor's browser.
#
# ONE ROW PER (title, feature). A feature is a genre or a person (director,
# writer, or top-billed cast). Each carries an IDF weight computed here, once, so
# the runtime query is two group-bys instead of a pile of CTEs:
#
#   liked tconsts -> features -> sum(idf) per feature      = taste profile
#   profile       -> features -> sum(weight) per candidate = score
#
# WHY IDF, and it is not decoration. Scored on raw overlap, a set of
# {Big Lebowski, Fargo, No Country, Pulp Fiction, Snatch} returned ten Coen
# Brothers films -- the recommender had found "same director" and stopped.
# Weighting each genre and person by ln(N/df) makes a common genre (Drama, on a
# third of everything) nearly worthless and a distinctive collaborator valuable,
# which is what turns a filmography into a recommendation.
#
#   bash scripts/build_taste_features.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="$ROOT/docs/data/taste_features.parquet"
# Uses the duckdb CLI, not malloyyo: build_data.sh already requires duckdb on
# PATH and the refresh workflow installs it, whereas malloyyo is only a local
# dev dependency here. Depending on it would have failed in CI on the first
# scheduled run and gone unnoticed until the recommender quietly went stale.
DUCKDB="${DUCKDB_BIN:-duckdb}"

mkdir -p "$(dirname "$OUT")"
cd "$ROOT"

"$DUCKDB" <<SQL
COPY (
  WITH t AS (SELECT * FROM 'docs/imdb_titles.parquet'),
  -- Only the roles that actually predict taste. 'self' and archive credits are
  -- noise, and a full cast list would let bit-part actors dominate.
  -- Crew and cast are separated because they carry different information. A
  -- shared DIRECTOR or WRITER is a creative-team overlap; a shared ACTOR is
  -- often just a jobbing career (John Goodman is in The Big Lebowski and in
  -- Roseanne, Steve Buscemi in Fargo and in Armageddon). Scoring treats them
  -- differently, so they cannot be one feature class.
  -- CAST from principals (top-billed only: a bit-part actor should not connect
  -- two films). CREW from the titles table's own directors/writers arrays --
  -- principals with ordering <= 6 is almost entirely cast, which is why sourcing
  -- crew from there produced 138 rows for the whole corpus.
  pr AS (
    SELECT tconst, nconst FROM 'docs/imdb_principals.parquet'
    WHERE category IN ('actor','actress') AND ordering <= 6
  ),
  crew AS (
    SELECT tconst, u.n AS nconst FROM t, UNNEST(t.directors) AS u(n) WHERE u.n IS NOT NULL
    UNION ALL
    SELECT tconst, u.n AS nconst FROM t, UNNEST(t.writers) AS u(n) WHERE u.n IS NOT NULL
  ),
  n AS (SELECT count(*)::DOUBLE AS n FROM t),

  genre_rows AS (SELECT t.tconst, 'genre' AS kind, u.g AS feature FROM t, UNNEST(t.genres) AS u(g)),
  person_rows AS (
    SELECT pr.tconst, 'cast' AS kind, pr.nconst AS feature FROM pr
    UNION ALL
    SELECT crew.tconst, 'crew' AS kind, crew.nconst AS feature FROM crew
  ),
  all_rows AS (SELECT * FROM genre_rows UNION ALL SELECT * FROM person_rows),

  -- df = how many titles carry this feature; idf = how surprising it is.
  -- Floored at 0 so a feature on nearly everything cannot score negative.
  idf AS (
    SELECT kind, feature, count(*) AS df,
           greatest(ln((SELECT n FROM n) / count(*)), 0.0) AS idf
    FROM all_rows GROUP BY 1,2
  )
  ,
  -- Per-title vector length. Without it, scoring is a raw dot product and a
  -- film with a huge cast outranks a genuinely similar one purely by having
  -- more features to match on -- which is how Armageddon and The Polar Express
  -- surfaced for a Coen-brothers profile. Precomputed here so the browser
  -- divides instead of aggregating twice.
  norms AS (
    SELECT a.tconst, sqrt(sum(i.idf * i.idf)) AS title_norm
    FROM all_rows a JOIN idf i USING (kind, feature)
    WHERE NOT (a.kind IN ('crew','cast') AND i.df < 2)
    GROUP BY 1
  )
  SELECT a.tconst, a.kind, a.feature, i.df, round(i.idf, 4) AS idf,
         round(n.title_norm, 4) AS title_norm
  FROM all_rows a JOIN idf i USING (kind, feature) JOIN norms n ON n.tconst = a.tconst
  -- A person credited on a single title in the corpus can never connect two
  -- films, so they are pure weight with no recall value.
  WHERE NOT (a.kind IN ('crew','cast') AND i.df < 2)
) TO '$OUT' (FORMAT PARQUET, COMPRESSION ZSTD);
SQL

"$DUCKDB" -c "
SELECT kind, count(*) AS rows, count(DISTINCT feature) AS features,
       round(min(idf),2) AS min_idf, round(max(idf),2) AS max_idf
FROM '$OUT' GROUP BY 1 ORDER BY 1;"

ls -la "$OUT"
