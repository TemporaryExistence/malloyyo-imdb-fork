#!/usr/bin/env bash
# Assert the availability vote-bands still fit under the runtime's 5,000-row cap.
#
# WHY THIS EXISTS. The where-to-watch marks are split into four vote bands
# because the runtime silently truncates any result at 5,000 rows -- a truncated
# result still renders, so the failure looks like "some posters have no badge"
# rather than like an error. The band thresholds are LITERALS in
# dashboards/genre_pairs.malloy, and they are the quartiles of the streamable
# set at the moment they were measured. Any change to the corpus moves the real
# quartiles and leaves those literals behind: removing television on 2026-08-05
# moved them from 50400/16866/8414 to 58196/18156/8675.
#
# So this re-derives the band sizes FROM THE PARQUET, using the literals that
# are actually in the model, and fails while there is still headroom -- rather
# than at the cap, where the symptom is silent.
set -euo pipefail
cd "$(dirname "$0")/.."

MODEL="dashboards/genre_pairs.malloy"
DUCKDB="${DUCKDB_BIN:-duckdb}"
WARN_AT=4500   # 10% of headroom left is already too little to sit on

# Pull the thresholds out of the model rather than restating them here: a copy
# in this file would be one more literal to drift.
mapfile -t T < <(grep -oP 'title\.numVotes >= \K[0-9]+' "$MODEL" | sort -rn | uniq)
if [ "${#T[@]}" -ne 3 ]; then
  echo "check_bands: expected 3 distinct thresholds in $MODEL, found ${#T[@]}" >&2
  exit 1
fi
A="${T[0]}"; B="${T[1]}"; C="${T[2]}"
echo "thresholds from $MODEL: >=$A, >=$B, >=$C"

read -r a b c d total q75 q50 q25 <<<"$("$DUCKDB" -noheader -list -c "
with t as (select tconst, numVotes v from 'docs/imdb_titles.parquet'),
wp as (select distinct imdb_id from 'docs/data/watch_providers.parquet'
       where offer_kind='flatrate' and region='US'),
j as (select t.tconst, t.v from t join wp on t.tconst=wp.imdb_id)
select count(*) filter (v >= $A),
       count(*) filter (v >= $B and v < $A),
       count(*) filter (v >= $C and v < $B),
       count(*) filter (v <  $C),
       count(*),
       cast(quantile_cont(v,0.75) as bigint),
       cast(quantile_cont(v,0.50) as bigint),
       cast(quantile_cont(v,0.25) as bigint)
from j;" | tr '|' ' ')"

echo "band sizes: a=$a b=$b c=$c d=$d   (streamable titles: $total)"
echo "current quartiles: q75=$q75 q50=$q50 q25=$q25"

fail=0
for pair in "a:$a" "b:$b" "c:$c" "d:$d"; do
  name="${pair%%:*}"; n="${pair##*:}"
  if [ "$n" -ge 5000 ]; then
    echo "FAIL band $name holds $n rows -- AT OR OVER the 5,000 cap. Marks are being dropped RIGHT NOW." >&2
    fail=1
  elif [ "$n" -ge "$WARN_AT" ]; then
    echo "FAIL band $name holds $n rows -- past the $WARN_AT safety line. Re-cut the bands at the quartiles above." >&2
    fail=1
  fi
done

if [ "$fail" -eq 0 ]; then
  echo "OK: every band is under $WARN_AT rows."
fi
exit "$fail"
