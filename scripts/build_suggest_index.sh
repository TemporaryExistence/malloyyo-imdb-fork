#!/usr/bin/env bash
# Build docs/data/suggest.json -- the client-side autocomplete index.
#
# WHY A BUILD ARTIFACT AND NOT A QUERY. Autofill has to answer per keystroke and
# has to tolerate a misspelling ("mikel cain" must reach Michael Caine), and
# neither is a query's job here:
#   * the runtime silently truncates any result at 5,000 rows, and this index is
#     ~30k -- the same cap that quietly broke the where-to-watch marks;
#   * a `contains` filter can never match a misspelling, and per-keystroke
#     round-trips to the engine are the wrong shape for a dropdown anyway.
# So the index is built once, shipped as a static file, and matched in JS.
#
# It is deliberately SMALL: text, kind, id, year, and a popularity weight. No
# genres, no posters -- the dropdown shows a name and a year, and the click
# hands the id to the existing queries.
set -euo pipefail
cd "$(dirname "$0")/.."
DUCKDB="${DUCKDB_BIN:-duckdb}"
OUT="docs/data/suggest.json"
mkdir -p "$(dirname "$OUT")"

# People are capped by real involvement rather than included wholesale: the
# names table carries 141,356 rows and 100,327 of them touch a principal credit,
# but someone with a single minor credit is noise in a dropdown and weight in
# the payload. Two credits AND 100,000 summed votes keeps 16,266 people --
# verified to include the names this feature was specified against (Michael
# Caine, Brad Pitt). Ranking is by summed votes, so the cut only removes rows
# that could never have surfaced above them anyway.
# COMPACT ROWS, not objects. As {"t":...,"k":...} the file was 3.92 MB because
# every row repeated five key names; as positional arrays [text, kind, id, year,
# votes] it is a third of that, for a payload the visitor downloads before they
# can type. The reader in lib/suggest.js owns the column order.
"$DUCKDB" -noheader -list -c "
COPY (
  select json_group_array(json_array(t, k, i, y, v)) as j
  from (
    select primaryTitle as t, 't' as k, tconst as i,
           cast(startYear as int) as y, cast(numVotes as bigint) as v
    from 'docs/imdb_titles.parquet'
    union all
    select n.primaryName as t, 'p' as k, n.nconst as i, null as y, p.v as v
    from (
      select pr.nconst, sum(t.numVotes)::bigint as v
      from 'docs/imdb_principals.parquet' pr
      join 'docs/imdb_titles.parquet' t on t.tconst = pr.tconst
      where pr.category in ('actor','actress','director','writer')
      group by 1
      having count(*) >= 2 and sum(t.numVotes) >= 100000
    ) p
    join 'docs/imdb_names.parquet' n on n.nconst = p.nconst
  )
) TO '$OUT' (FORMAT csv, HEADER false, QUOTE '', DELIMITER '\x07');
"

# Assert it is real. A JSON file that parses to an empty array would leave the
# dropdown permanently silent with nothing on screen to say why.
node -e '
const fs=require("fs");
const rows=JSON.parse(fs.readFileSync("'"$OUT"'","utf8"));
if (!Array.isArray(rows) || rows.length < 10000) { console.error("suggest index looks wrong: "+(rows.length||0)+" rows"); process.exit(1); }
const titles=rows.filter(r=>r[1]==="t").length, people=rows.length-titles;
console.error(`suggest index: ${rows.length} rows (${titles} titles, ${people} people), ${(fs.statSync("'"$OUT"'").size/1e6).toFixed(2)} MB`);
'
