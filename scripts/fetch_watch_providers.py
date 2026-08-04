#!/usr/bin/env python3
"""Resolve IMDb IDs to streaming/rent/buy availability.

Build-time resolver for a static site, deliberately shaped like its sibling
`resolve_posters.py`: the TMDB metadata API needs a key, image.tmdb.org does
not. So we resolve here, with the secret, and ship only paths and names -- the
browser hotlinks provider logos from the CDN with no credentials at all.

Output: docs/data/watch_providers.parquet (committed; read by DuckDB-WASM).

    TMDB_READ_ACCESS_TOKEN=... python3 scripts/fetch_watch_providers.py
    ...                          python3 scripts/fetch_watch_providers.py --regions US,GB --limit 200

⚖ LICENCE, and it is not optional
The watch-provider data is **JustWatch's**, surfaced through TMDB. TMDB's terms
require attributing JustWatch, and their stated expectation is "a reference or
logo on each media item" -- not one line in a footer -- with API access revoked
for non-compliance. Two consequences baked in here:

  1. Every row carries `attribution` so the UI cannot render availability
     without the credit travelling beside it.
  2. `link` is JustWatch's own deep link for the title, which TMDB returns and
     asks be used. We keep it and the UI surfaces it.

TMDB refreshes from JustWatch once every 24h, and the non-commercial tier caps
caching at 6 months; the weekly refresh workflow sits comfortably inside both.

Stdlib-only for HTTP; parquet I/O shells out to the `duckdb` CLI, so one code
path runs identically here and in CI.
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

OUTPUT_PARQUET = "docs/data/watch_providers.parquet"

# Resolve against the ID list the site actually ships, so availability covers
# exactly what the dashboards can render -- same rule as the poster resolver.
INPUT_QUERY = """
  SELECT DISTINCT t.tconst AS imdb_id
  FROM 'docs/imdb_titles.parquet' t
  WHERE t.tconst IS NOT NULL
"""

# Availability churns constantly -- a title leaves Netflix with no warning -- so
# unlike posters there is no long negative cache. A weekly full refresh is the
# point; STALE_AFTER only protects a re-run on the same day from re-hammering.
STALE_AFTER = timedelta(hours=20)

# TMDB allows ~40 req/s per IP. Stay well under.
REQS_PER_SECOND = 35   # TMDB tolerates ~50/s; 24k titles x 2 calls needs the headroom
MAX_WORKERS = 12

# TMDB's provider "type" buckets. `flatrate` is what people mean by "on Netflix".
OFFER_KINDS = ("flatrate", "free", "ads", "rent", "buy")

ATTRIBUTION = "Source: JustWatch"


# --- duckdb helpers ---------------------------------------------------------

def duckdb_bin() -> str:
    return os.environ.get("DUCKDB_BIN", "duckdb")


def duckdb_run(sql: str) -> None:
    proc = subprocess.run([duckdb_bin(), "-noheader", "-c", sql],
                          capture_output=True, text=True)
    if proc.returncode != 0:
        raise RuntimeError(f"duckdb failed:\n{proc.stderr.strip()}\n--- sql ---\n{sql}")


def duckdb_select(sql: str) -> list[dict]:
    with tempfile.TemporaryDirectory() as tmp:
        out = os.path.join(tmp, "out.csv")
        duckdb_run(f"COPY ({sql}) TO '{out}' (FORMAT csv, HEADER)")
        with open(out, newline="", encoding="utf-8") as fh:
            return list(csv.DictReader(fh))


# --- input / existing -------------------------------------------------------

def load_input_ids() -> list[str]:
    return [r["imdb_id"] for r in duckdb_select(" ".join(INPUT_QUERY.split()))]


def load_existing(path: str) -> dict[str, str]:
    """imdb_id -> fetched_at, for rows already present."""
    if not os.path.exists(path):
        return {}
    rows = duckdb_select(
        f"SELECT imdb_id, max(fetched_at) AS fetched_at FROM read_parquet('{path}') GROUP BY imdb_id")
    return {r["imdb_id"]: r["fetched_at"] for r in rows}


def parse_ts(value) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None


def needs_fetch(existing: dict[str, str], ids: list[str], now: datetime) -> list[str]:
    out = []
    for i in ids:
        ts = parse_ts(existing.get(i))
        if ts is None or (now - ts) > STALE_AFTER:
            out.append(i)
    return out


# --- HTTP -------------------------------------------------------------------

class RateLimiter:
    def __init__(self, per_second: int):
        self.interval = 1.0 / max(1, per_second)
        self.lock = threading.Lock()
        self.next_at = 0.0

    def acquire(self) -> None:
        with self.lock:
            now = time.monotonic()
            wait = max(0.0, self.next_at - now)
            self.next_at = max(now, self.next_at) + self.interval
        if wait:
            time.sleep(wait)


def auth_headers() -> dict[str, str]:
    """Same convention as resolve_posters.py: v4 bearer preferred, v3 key accepted."""
    bearer = os.environ.get("TMDB_READ_ACCESS_TOKEN")
    if bearer:
        # v4 bearer keeps the secret out of URLs, and therefore out of logs.
        return {"Authorization": f"Bearer {bearer}", "Accept": "application/json"}
    if os.environ.get("TMDB_API_KEY"):
        return {"Accept": "application/json"}
    sys.exit("Set TMDB_READ_ACCESS_TOKEN (preferred) or TMDB_API_KEY.")


def with_key(url: str) -> str:
    """Append the v3 key when that is the credential we have."""
    if os.environ.get("TMDB_READ_ACCESS_TOKEN"):
        return url
    sep = "&" if "?" in url else "?"
    return f"{url}{sep}api_key=" + os.environ["TMDB_API_KEY"]


def get_json(url: str, headers: dict[str, str], limiter: RateLimiter) -> dict | None:
    for attempt in range(4):
        limiter.acquire()
        try:
            req = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(req, timeout=30) as resp:
                return json.load(resp)
        except urllib.error.HTTPError as exc:
            if exc.code == 404:
                return None
            if exc.code == 429:
                time.sleep(float(exc.headers.get("Retry-After") or 2))
                continue
            if 500 <= exc.code < 600 and attempt < 3:
                time.sleep(1.5 * (attempt + 1))
                continue
            return None
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError):
            if attempt < 3:
                time.sleep(1.5 * (attempt + 1))
                continue
            return None
    return None


# --- resolve one title ------------------------------------------------------

def rows_for(imdb_id: str, regions: list[str], headers: dict[str, str],
             limiter: RateLimiter, now_iso: str) -> list[dict]:
    """One row per (title, region, offer kind, provider). Empty list if unavailable."""
    found = get_json(
        with_key(f"https://api.themoviedb.org/3/find/{imdb_id}?external_source=imdb_id"), headers, limiter)
    if not found:
        return []
    results = (found.get("movie_results") or []) + (found.get("tv_results") or [])
    if not results:
        return []
    tmdb_id = results[0].get("id")
    kind = "movie" if found.get("movie_results") else "tv"
    if not tmdb_id:
        return []

    payload = get_json(
        with_key(f"https://api.themoviedb.org/3/{kind}/{tmdb_id}/watch/providers"), headers, limiter)
    if not payload:
        return []

    out: list[dict] = []
    for region in regions:
        block = (payload.get("results") or {}).get(region)
        if not block:
            continue
        # TMDB's watch page for this title/region -- their sanctioned deep link,
        # powered by JustWatch. (It is a themoviedb.org URL, not justwatch.com;
        # verified against live responses rather than assumed.)
        link = block.get("link") or ""
        for offer_kind in OFFER_KINDS:
            for prov in block.get(offer_kind) or []:
                out.append({
                    "imdb_id": imdb_id,
                    "tmdb_id": tmdb_id,
                    "region": region,
                    "offer_kind": offer_kind,
                    "provider_id": prov.get("provider_id"),
                    "provider_name": prov.get("provider_name") or "",
                    "logo_path": prov.get("logo_path") or "",
                    "display_priority": prov.get("display_priority"),
                    "link": link,
                    "attribution": ATTRIBUTION,
                    "fetched_at": now_iso,
                })
    return out


# --- write ------------------------------------------------------------------

FIELDS = ["imdb_id", "tmdb_id", "region", "offer_kind", "provider_id", "provider_name",
          "logo_path", "display_priority", "link", "attribution", "fetched_at"]


def write_parquet(rows: list[dict], path: str) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        csv_path = os.path.join(tmp, "rows.csv")
        with open(csv_path, "w", newline="", encoding="utf-8") as fh:
            w = csv.DictWriter(fh, fieldnames=FIELDS)
            w.writeheader()
            for r in rows:
                w.writerow(r)
        duckdb_run(
            f"COPY (SELECT * FROM read_csv('{csv_path}', header=true, all_varchar=false)) "
            f"TO '{path}' (FORMAT PARQUET, COMPRESSION ZSTD)")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--regions", default="US",
                    help="comma-separated ISO country codes, e.g. US,GB,CA")
    ap.add_argument("--limit", type=int, default=0,
                    help="only resolve the first N titles (for a smoke test)")
    ap.add_argument("--out", default=OUTPUT_PARQUET)
    args = ap.parse_args()

    regions = [r.strip().upper() for r in args.regions.split(",") if r.strip()]
    headers = auth_headers()
    limiter = RateLimiter(REQS_PER_SECOND)
    now = datetime.now(timezone.utc)
    now_iso = now.isoformat()

    ids = load_input_ids()
    if args.limit:
        ids = ids[: args.limit]
    todo = needs_fetch(load_existing(args.out), ids, now)
    print(f"titles: {len(ids):,} · to fetch: {len(todo):,} · regions: {','.join(regions)}")
    if not todo:
        print("nothing stale; leaving the existing file alone")
        return

    rows: list[dict] = []
    done = 0
    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as pool:
        futures = [pool.submit(rows_for, i, regions, headers, limiter, now_iso) for i in todo]
        for fut in futures:
            rows.extend(fut.result())
            done += 1
            if done % 500 == 0:
                print(f"  {done:,}/{len(todo):,} titles · {len(rows):,} offers")

    write_parquet(rows, args.out)
    titles_with = len({r["imdb_id"] for r in rows})
    print(f"\nwrote {args.out}: {len(rows):,} offers across {titles_with:,} titles "
          f"({titles_with / max(1, len(todo)) * 100:.0f}% of those fetched had any availability)")


if __name__ == "__main__":
    main()
