#!/usr/bin/env python3
"""Resolve IMDb IDs to TMDB poster paths.

Build-time resolver for a static site. The TMDB metadata API needs a key;
image.tmdb.org does not. So we resolve paths here, with the secret, and ship
only the paths -- the browser hotlinks the CDN with no credentials at all.

Output: docs/data/poster_paths.parquet (committed; read by DuckDB-WASM).

Deliberately stdlib-only for HTTP -- parquet I/O shells out to the `duckdb`
CLI. That keeps one code path that runs identically here and in CI.

    TMDB_READ_ACCESS_TOKEN=... python3 scripts/resolve_posters.py
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone

# --- configuration ----------------------------------------------------------

OUTPUT_PARQUET = "docs/data/poster_paths.parquet"

# Source of truth for the ID list. The site ships docs/imdb_titles.parquet, so
# resolving against it guarantees the poster table covers exactly what the
# dashboards render. MOTHERDUCK_QUERY hits the upstream mirror instead
# (--source motherduck); both carry the same tconst set.
INPUT_QUERY = """
  SELECT DISTINCT tconst AS imdb_id
  FROM 'docs/imdb_titles.parquet'
  WHERE tconst IS NOT NULL
"""

MOTHERDUCK_QUERY = """
  SELECT DISTINCT tconst AS imdb_id
  FROM mayolo.imdb_titles
  WHERE tconst IS NOT NULL
"""

# Negative caching: don't re-hammer the thousands of obscure titles that will
# never resolve. 'error' still retries every run.
#
# TODO: TMDB's API terms (section 1.C) forbid caching API data beyond 6 months,
# so 'ok' rows should eventually expire too -- deferred for now.
STALE_AFTER = timedelta(days=90)
RETRY_STATUSES = {"no_poster", "not_found"}

# TMDB allows ~40 req/s per IP and ~20 simultaneous connections. Stay under the
# connection cap rather than racing it. Re-check the published limits at
# developer.themoviedb.org/docs/rate-limiting before tuning these.
CONCURRENCY = 16
REQUESTS_PER_SECOND = 35
MAX_ATTEMPTS = 3
TIMEOUT_SECONDS = 20

API_ROOT = "https://api.themoviedb.org/3/find/{imdb_id}?external_source=imdb_id"

# A run that mostly errors means a bad key or a TMDB outage, not bad data.
CATASTROPHE_THRESHOLD = 0.5


# --- duckdb helpers ---------------------------------------------------------


def duckdb_bin() -> str:
    return os.environ.get("DUCKDB_BIN", "duckdb")


def duckdb_run(sql: str, *, motherduck: bool = False) -> None:
    """Execute SQL with the duckdb CLI, raising with stderr on failure."""
    cmd = [duckdb_bin(), "-noheader", "-c", sql]
    env = dict(os.environ)
    if motherduck:
        # `duckdb md:` picks the token up from the environment.
        cmd = [duckdb_bin(), "-noheader", "md:", "-c", sql]
        token = env.get("MOTHERDUCK_TOKEN") or env.get("MALLOYYO_TOKEN")
        if not token:
            sys.exit("MOTHERDUCK_TOKEN (or MALLOYYO_TOKEN) required for --source motherduck")
        env["MOTHERDUCK_TOKEN"] = token
    proc = subprocess.run(cmd, capture_output=True, text=True, env=env)
    if proc.returncode != 0:
        raise RuntimeError(f"duckdb failed:\n{proc.stderr.strip()}\n--- sql ---\n{sql}")


def duckdb_select(sql: str, *, motherduck: bool = False) -> list[dict]:
    """Run a SELECT and return rows as dicts, via a temp CSV."""
    with tempfile.TemporaryDirectory() as tmp:
        out = os.path.join(tmp, "out.csv")
        duckdb_run(f"COPY ({sql}) TO '{out}' (FORMAT csv, HEADER)", motherduck=motherduck)
        with open(out, newline="", encoding="utf-8") as fh:
            return list(csv.DictReader(fh))


# --- input ------------------------------------------------------------------


def normalized(query: str) -> str:
    """Coerce whatever the source stores into canonical 'tt0111161' form.

    lpad() would truncate anything already longer than 7 digits, and newer IMDb
    titles have 8+, so pad only when short.
    """
    return f"""
      SELECT DISTINCT
        CASE
          WHEN imdb_id LIKE 'tt%' THEN imdb_id
          WHEN length(imdb_id::VARCHAR) >= 7 THEN 'tt' || imdb_id::VARCHAR
          ELSE 'tt' || lpad(imdb_id::VARCHAR, 7, '0')
        END AS imdb_id
      FROM ({query}) AS src
      WHERE imdb_id IS NOT NULL
      ORDER BY imdb_id
    """


def load_input_ids(source: str) -> list[str]:
    if source == "motherduck":
        rows = duckdb_select(normalized(MOTHERDUCK_QUERY), motherduck=True)
    else:
        rows = duckdb_select(normalized(INPUT_QUERY))
    return [r["imdb_id"] for r in rows if r["imdb_id"]]


def load_existing(path: str) -> dict[str, dict]:
    if not os.path.exists(path):
        return {}
    rows = duckdb_select(f"SELECT * FROM read_parquet('{path}')")
    return {r["imdb_id"]: r for r in rows}


def needs_resolution(existing: dict[str, dict], ids: list[str], now: datetime) -> list[str]:
    """Absent IDs, every prior error, and stale negatives. 'ok' is permanent."""
    todo = []
    for imdb_id in ids:
        row = existing.get(imdb_id)
        if row is None:
            todo.append(imdb_id)
            continue
        status = row.get("status")
        if status == "error":
            todo.append(imdb_id)
        elif status in RETRY_STATUSES:
            resolved_at = parse_ts(row.get("resolved_at"))
            if resolved_at is None or now - resolved_at > STALE_AFTER:
                todo.append(imdb_id)
    return todo


def parse_ts(value) -> datetime | None:
    if not value:
        return None
    text = str(value).strip().replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


# --- TMDB -------------------------------------------------------------------


class RateLimiter:
    """Token bucket. Threads block here so we pace the whole pool, not each thread."""

    def __init__(self, per_second: int):
        self._interval = 1.0 / per_second
        self._lock = threading.Lock()
        self._next = time.monotonic()

    def acquire(self) -> None:
        with self._lock:
            now = time.monotonic()
            wait = max(0.0, self._next - now)
            self._next = max(now, self._next) + self._interval
        if wait:
            time.sleep(wait)


def auth_headers() -> dict[str, str]:
    bearer = os.environ.get("TMDB_READ_ACCESS_TOKEN")
    if bearer:
        # v4 bearer keeps the secret out of URLs, and therefore out of logs.
        return {"Authorization": f"Bearer {bearer}"}
    if os.environ.get("TMDB_API_KEY"):
        return {}
    sys.exit("Set TMDB_READ_ACCESS_TOKEN (preferred) or TMDB_API_KEY.")


def request_url(imdb_id: str) -> str:
    url = API_ROOT.format(imdb_id=imdb_id)
    if not os.environ.get("TMDB_READ_ACCESS_TOKEN"):
        url += "&api_key=" + os.environ["TMDB_API_KEY"]
    return url


def resolve_one(imdb_id: str, headers: dict[str, str], limiter: RateLimiter) -> dict:
    """One title -> one output row. Never raises; failures become status='error'."""
    last_error = None
    for attempt in range(1, MAX_ATTEMPTS + 1):
        limiter.acquire()
        req = urllib.request.Request(request_url(imdb_id), headers={**headers, "Accept": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=TIMEOUT_SECONDS) as resp:
                payload = json.load(resp)
            return row_from_payload(imdb_id, payload)
        except urllib.error.HTTPError as exc:
            if exc.code == 404:
                # Terminal: TMDB has never heard of this ID.
                return make_row(imdb_id, status="not_found")
            if exc.code == 429:
                retry_after = exc.headers.get("Retry-After")
                time.sleep(float(retry_after) if retry_after else 2**attempt)
                last_error = exc
                continue
            if 500 <= exc.code < 600:
                time.sleep(2**attempt)
                last_error = exc
                continue
            return make_row(imdb_id, status="error")
        except Exception as exc:  # network hiccup, timeout, bad JSON
            last_error = exc
            time.sleep(2**attempt)
    _ = last_error
    return make_row(imdb_id, status="error")


def row_from_payload(imdb_id: str, payload: dict) -> dict:
    # FORK CHANGE: also accept television.
    #
    # NOT A BUG UPSTREAM. Upstream's corpus is movies-only by construction
    # (transform.malloy: `titleType = 'movie'`), so reading movie_results alone
    # was correct AND complete for it -- measured, not assumed: of a random 400
    # movie-type titles, 400 resolved via movie_results and none were TV-only,
    # and the 8 movie-type ids that still fail are genuinely absent from TMDB
    # rather than misclassified.
    #
    # What changed is the corpus, not the code: this fork added tvSeries /
    # tvMiniSeries / tvMovie, and `find` returns those in a separate array, so
    # 4,641 of them came back "not_found" until this line learned to look.
    # Films still take precedence when an id matches both.
    results = (payload.get("movie_results") or []) or (payload.get("tv_results") or [])
    if not results:
        return make_row(imdb_id, status="not_found")
    movie = results[0]
    poster = movie.get("poster_path")
    return make_row(
        imdb_id,
        tmdb_id=movie.get("id"),
        # Already carries a leading slash -- do not add another downstream.
        poster_path=poster,
        backdrop_path=movie.get("backdrop_path"),
        status="ok" if poster else "no_poster",
    )


def make_row(imdb_id, tmdb_id=None, poster_path=None, backdrop_path=None, status="error") -> dict:
    return {
        "imdb_id": imdb_id,
        "tmdb_id": tmdb_id,
        "poster_path": poster_path,
        "backdrop_path": backdrop_path,
        "status": status,
        "resolved_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
    }


# --- output -----------------------------------------------------------------

COLUMNS = ["imdb_id", "tmdb_id", "poster_path", "backdrop_path", "status", "resolved_at"]


def write_parquet(rows: list[dict], path: str) -> None:
    """Write via a temp file so a crash can't leave a truncated parquet in git."""
    target_dir = os.path.dirname(path) or "."
    os.makedirs(target_dir, exist_ok=True)
    # The staging parquet must sit on the same filesystem as the destination,
    # or os.replace() raises EXDEV instead of swapping atomically.
    tmp_parquet = os.path.join(target_dir, f".{os.path.basename(path)}.tmp")
    with tempfile.TemporaryDirectory() as tmp:
        staging_csv = os.path.join(tmp, "rows.csv")
        with open(staging_csv, "w", newline="", encoding="utf-8") as fh:
            writer = csv.DictWriter(fh, fieldnames=COLUMNS)
            writer.writeheader()
            for row in sorted(rows, key=lambda r: r["imdb_id"]):
                writer.writerow({k: row.get(k) for k in COLUMNS})

        duckdb_run(
            f"""
            COPY (
              SELECT
                imdb_id::VARCHAR    AS imdb_id,
                tmdb_id::INTEGER    AS tmdb_id,
                poster_path::VARCHAR   AS poster_path,
                backdrop_path::VARCHAR AS backdrop_path,
                status::VARCHAR     AS status,
                resolved_at::TIMESTAMP AS resolved_at
              FROM read_csv('{staging_csv}',
                            header = true,
                            columns = {{
                              'imdb_id': 'VARCHAR', 'tmdb_id': 'VARCHAR',
                              'poster_path': 'VARCHAR', 'backdrop_path': 'VARCHAR',
                              'status': 'VARCHAR', 'resolved_at': 'VARCHAR'
                            }})
              ORDER BY imdb_id
            ) TO '{tmp_parquet}' (FORMAT parquet, COMPRESSION zstd)
            """
        )
    try:
        os.replace(tmp_parquet, path)
    except BaseException:
        if os.path.exists(tmp_parquet):
            os.unlink(tmp_parquet)
        raise


# --- main -------------------------------------------------------------------


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", choices=["local", "motherduck"], default="local",
                        help="where the IMDb ID list comes from (default: local parquet)")
    parser.add_argument("--output", default=OUTPUT_PARQUET)
    parser.add_argument("--limit", type=int, help="resolve at most N titles (sampling)")
    parser.add_argument("--only", nargs="*", help="resolve just these IMDb IDs, ignoring the diff")
    parser.add_argument("--dry-run", action="store_true", help="report what would resolve, make no API calls")
    args = parser.parse_args()

    now = datetime.now(timezone.utc)
    existing = load_existing(args.output)

    if args.only:
        ids = list(args.only)
        todo = ids
    else:
        ids = load_input_ids(args.source)
        todo = needs_resolution(existing, ids, now)

    print(f"{len(ids)} ids in source, {len(existing)} already resolved, {len(todo)} to resolve", file=sys.stderr)

    if args.limit:
        todo = todo[: args.limit]
        print(f"limited to {len(todo)}", file=sys.stderr)

    if args.dry_run:
        for imdb_id in todo[:20]:
            print(imdb_id)
        return 0

    if not todo:
        print("nothing to do", file=sys.stderr)
        return 0

    headers = auth_headers()
    limiter = RateLimiter(REQUESTS_PER_SECOND)
    started = time.monotonic()
    done = 0
    resolved: list[dict] = []

    with ThreadPoolExecutor(max_workers=CONCURRENCY) as pool:
        for row in pool.map(lambda i: resolve_one(i, headers, limiter), todo):
            resolved.append(row)
            done += 1
            if done % 250 == 0 or done == len(todo):
                rate = done / max(time.monotonic() - started, 1e-6)
                print(f"  {done}/{len(todo)}  ({rate:.0f}/s)", file=sys.stderr)

    merged = dict(existing)
    for row in resolved:
        merged[row["imdb_id"]] = row
    write_parquet(list(merged.values()), args.output)

    counts: dict[str, int] = {}
    for row in resolved:
        counts[row["status"]] = counts.get(row["status"], 0) + 1
    print("this run: " + ", ".join(f"{k}={v}" for k, v in sorted(counts.items())), file=sys.stderr)
    print(f"wrote {len(merged)} rows to {args.output}", file=sys.stderr)

    error_rate = counts.get("error", 0) / len(resolved)
    if error_rate > CATASTROPHE_THRESHOLD:
        # Scattered failures are fine -- they're recorded and retried next run.
        # Majority failure means a bad key or an outage, and should break CI.
        print(f"FATAL: {error_rate:.0%} of resolutions errored", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
