#!/usr/bin/env bash
# Precompute the COLD-START page into one static JSON, at BUILD time.
#
# WHY (Andrew, 2026-08-07): "make the site load all titles/thumbnails/content right
# away for users who have not inserted any specific preferences yet ... then as users
# input specifics, actual queries have to happen, and it gets a little slower."
#
# The floor this removes: the page took ~8s to show anything, and MEASURING it showed
# the time was not any one query — chrome painted at 1.4s, the parquets finished at
# 2.4s, and first content landed at ~8s. Roughly 5.5s of that is DuckDB-WASM booting
# and the Malloy model compiling, paid BEFORE a single query runs. No amount of query
# tuning gets under that, because the engine has to exist first.
#
# But a visitor with no profile always sees the SAME page. So it does not need an
# engine at all — it needs a file. This computes exactly what that visitor sees
# (the genre-crossover sections, the cold list, and the streaming marks) with the
# duckdb CLI at build time and writes docs/cold-start.json. The page renders it
# immediately and swaps to live query results the moment anyone rates anything.
#
# ⛔ THE NUMBERS HERE MUST MATCH THE LIVE QUERIES. This file is a CACHE of
# shared_queries.malloy's `pair_titles` + the cold list, and a cache that drifts from
# its source is worse than no cache: the page would show one thing cold and something
# different the instant a visitor rated something. The vote floor and row limit below
# are deliberately the same as `pair_titles` — change them together or not at all.
set -euo pipefail
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

DUCKDB="${DUCKDB_BIN:-duckdb}"
OUT="docs/cold-start.json"

# Same bounds as shared_queries.malloy `pair_titles` — see the warning above.
VOTE_FLOOR=25000
ROW_LIMIT=1200
# Films shown per crossover section, and number of sections. Matches next_watch.jsx.
PER_PAIR=6
PAIRS=6
COLD_LIST=60

command -v "$DUCKDB" >/dev/null || { echo "cold-start: no duckdb on PATH — SKIPPING (page falls back to live queries)"; exit 0; }

# ⛑ MECHANICAL TIE TO THE LIVE QUERY, because "change them together" is a comment and
# comments do not fail a build. The bounds above duplicate shared_queries.malloy's
# pair_titles in SQL; if someone edits the Malloy and not this file, the cold page and the
# post-rating page silently disagree and NOTHING catches it. So read the real values out of
# the model and refuse to build on a mismatch.
# ⛑ FIND THE QUERY WHEREVER IT LIVES. It moved from shared_queries.malloy to
# next_watch.malloy on 2026-08-08 (it needs the page-local RELEASE_YEAR given), and a
# hardcoded path would have silently stopped guarding anything.
MODEL=$(grep -l "query: pair_titles is" dashboards/*.malloy 2>/dev/null | head -1 || true)
# ⛔ `|| true` ON EVERY EXTRACTION. Under `set -euo pipefail` a grep that matches nothing
# exits 1 and kills the script MID-GUARD with no message — which is exactly what happened
# the first time the query moved: the build printed nothing, returned 0, and shipped no
# cache. A guard that dies quietly is worse than no guard, because the silence reads as a
# pass. Every failure below must reach the explicit REFUSED branch.
M_VOTES=$( { awk "/query: pair_titles is/,/^}/" "$MODEL" 2>/dev/null | grep -oE "numVotes > [0-9]+" | grep -oE "[0-9]+" | head -1; } || true)
M_LIMIT=$( { awk "/query: pair_titles is/,/^}/" "$MODEL" 2>/dev/null | grep -oE "limit: [0-9]+" | grep -oE "[0-9]+" | head -1; } || true)
if [ -z "$MODEL" ] || [ -z "$M_VOTES" ] || [ -z "$M_LIMIT" ]; then
  echo "cold-start: REFUSED — could not read pair_titles bounds (model=${MODEL:-NOT FOUND}). Did the query move or get renamed?"
  exit 1
fi
if [ "$M_VOTES" != "$VOTE_FLOOR" ] || [ "$M_LIMIT" != "$ROW_LIMIT" ]; then
  echo "cold-start: REFUSED — this cache and the live query DISAGREE."
  echo "  $MODEL pair_titles : numVotes > $M_VOTES, limit $M_LIMIT"
  echo "  this script        : numVotes > $VOTE_FLOOR, limit $ROW_LIMIT"
  echo "  Update both, or the homepage will differ from the page you get after rating."
  exit 1
fi

"$DUCKDB" -json -c "
with base as (
  select t.tconst, t.primaryTitle as primary_title, t.startYear as start_year,
         t.averageRating as average_rating, t.numVotes as num_votes, t.genres,
         -- ⛔ THE FULL URL, exactly as imdb.malloy's movie_image field builds it. Shipping
         -- the bare poster_path made every cached tile request /<hash>.jpg from our own
         -- origin and 404 — a page of broken images that still passed a tile COUNT.
         case when p.poster_path is null then null
              else 'https://image.tmdb.org/t/p/w154' || p.poster_path end as poster
  from 'docs/imdb_titles.parquet' t
  left join 'docs/data/poster_paths.parquet' p on p.imdb_id = t.tconst
  where t.numVotes > $VOTE_FLOOR
  order by t.numVotes desc
  limit $ROW_LIMIT
),
-- every unordered genre pair present in the candidate set, with its true size
pairs as (
  select least(a.g, b.g) as ga, greatest(a.g, b.g) as gb, count(distinct a.tconst) as n
  from (select tconst, unnest(genres) as g from base) a
  join (select tconst, unnest(genres) as g from base) b on a.tconst = b.tconst and a.g < b.g
  group by 1, 2
  having count(distinct a.tconst) >= 12
  order by n desc
  limit $PAIRS
),
-- the streaming marks, one row per title
prov as (
  -- ⛔ CARRY THE LINK. The first version of this cache dropped it and set link:null in
  -- the UI, so a cached mark opened a popover whose services had nowhere to go — the
  -- suite caught it: a service in the popover had no link to follow. TMDB gives one
  -- aggregate JustWatch link per title (there are no per-provider deep links in this
  -- data), and it is the fallback every service falls back to, so losing it breaks the
  -- whole popover rather than one row.
  select imdb_id,
         max(link) as link,
         list(struct_pack(service := provider_name, logo := logo_path)
              order by display_priority) as services
  from 'docs/data/watch_providers.parquet'
  where offer_kind = 'flatrate' and region = 'US'
  group by imdb_id
)
select
  (select list(struct_pack(
      a := p.ga, b := p.gb, total := p.n,
      titles := (select list(struct_pack(
                    tconst := t.tconst, primary_title := t.primary_title,
                    start_year := t.start_year, average_rating := t.average_rating,
                    num_votes := t.num_votes, poster := t.poster)
                  order by t.num_votes desc)[1:$PER_PAIR]
                 from base t
                 where list_contains(t.genres, p.ga) and list_contains(t.genres, p.gb))
    ) order by p.n desc) from pairs p) as crossovers,
  (select list(struct_pack(
      tconst := t.tconst, primary_title := t.primary_title, start_year := t.start_year,
      average_rating := t.average_rating, num_votes := t.num_votes, poster := t.poster,
      genres := t.genres) order by t.num_votes desc)[1:$COLD_LIST]
   from base t) as cold_list,
  (select list(struct_pack(imdb_id := imdb_id, link := link, services := services)) from prov
    where imdb_id in (select tconst from base)) as offers,
  -- rate.html's poster grid. Same shape as shared_queries.malloy seed_titles, and the
  -- same reason: the rating page is IDENTICAL for every visitor who has rated nothing,
  -- which is by definition everyone arriving at it for the first time. It was 8.2s.
  (select list(struct_pack(
      tconst := t.tconst, primary_title := t.primary_title, start_year := t.start_year,
      average_rating := t.average_rating, num_votes := t.num_votes, poster := t.poster,
      genre := t.genres[1]) order by t.num_votes desc)[1:400]
   from base t) as seed_titles
" > "$OUT"

# ⛔ ASSERT, don't trust the exit code. duckdb exits 0 on a query that returns an
# empty result, and an empty cold-start.json would ship a blank homepage that looks
# like the product is broken — the precise failure this whole file exists to prevent.
BYTES=$(wc -c < "$OUT")
SEEDS=$(python3 -c "import json; d=json.load(open('$OUT')); print(len(d[0].get('seed_titles') or []))" 2>/dev/null || echo 0)
CROSS=$(python3 -c "import json,sys; d=json.load(open('$OUT')); print(len(d[0].get('crossovers') or []))" 2>/dev/null || echo 0)
LIST=$(python3 -c "import json,sys; d=json.load(open('$OUT')); print(len(d[0].get('cold_list') or []))" 2>/dev/null || echo 0)
if [ "$BYTES" -lt 1000 ] || [ "$CROSS" -lt 3 ] || [ "$LIST" -lt 20 ] || [ "$SEEDS" -lt 100 ]; then
  echo "cold-start: REFUSED to ship — ${BYTES}B, ${CROSS} crossovers, ${LIST} cold titles, ${SEEDS} seeds"
  exit 1
fi
echo "cold-start: $(( BYTES / 1024 ))KB · ${CROSS} crossovers · ${LIST} cold titles · ${SEEDS} seeds -> $OUT"
