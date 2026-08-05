#!/usr/bin/env python3
"""Resolve IMDb name ids (nm...) to TMDB profile photos.

Same shape as resolve_posters.py: the metadata API needs a key, image.tmdb.org
does not, so we resolve paths here and the browser hotlinks the CDN with no
credentials.

Output: docs/data/person_images.parquet (committed; read by DuckDB-WASM).

    TMDB_API_KEY=... python3 scripts/fetch_person_images.py
"""
from __future__ import annotations

import argparse, csv, json, os, subprocess, sys, tempfile, threading, time
import urllib.error, urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

OUTPUT = "docs/data/person_images.parquet"
REQS_PER_SECOND = 30
MAX_WORKERS = 10

# Only people who can appear on a swipe card: the query behind it is limited to
# well-known cast and crew, so resolving all 40k names would be wasted calls.
INPUT_SQL = """
  SELECT DISTINCT p.nconst
  FROM 'docs/imdb_principals.parquet' p
  JOIN 'docs/imdb_titles.parquet' t USING (tconst)
  WHERE p.category IN ('actor','actress','director','writer')
    AND t.numVotes > 150000
"""


def duckdb_bin() -> str:
    return os.environ.get("DUCKDB_BIN", "duckdb")


def duckdb_run(sql: str) -> None:
    r = subprocess.run([duckdb_bin(), "-noheader", "-c", sql], capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError(f"duckdb failed:\n{r.stderr.strip()}")


def duckdb_select(sql: str) -> list[dict]:
    with tempfile.TemporaryDirectory() as tmp:
        out = os.path.join(tmp, "o.csv")
        duckdb_run(f"COPY ({sql}) TO '{out}' (FORMAT csv, HEADER)")
        with open(out, newline="", encoding="utf-8") as fh:
            return list(csv.DictReader(fh))


class Limiter:
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
    bearer = os.environ.get("TMDB_READ_ACCESS_TOKEN")
    if bearer:
        return {"Authorization": f"Bearer {bearer}", "Accept": "application/json"}
    if os.environ.get("TMDB_API_KEY"):
        return {"Accept": "application/json"}
    sys.exit("Set TMDB_READ_ACCESS_TOKEN or TMDB_API_KEY.")


def with_key(url: str) -> str:
    if os.environ.get("TMDB_READ_ACCESS_TOKEN"):
        return url
    sep = "&" if "?" in url else "?"
    return f"{url}{sep}api_key=" + os.environ["TMDB_API_KEY"]


def resolve(nconst: str, headers, limiter) -> dict:
    url = with_key(f"https://api.themoviedb.org/3/find/{nconst}?external_source=imdb_id")
    for attempt in range(3):
        limiter.acquire()
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=25) as r:
                d = json.load(r)
            people = d.get("person_results") or []
            if not people:
                return {"nconst": nconst, "profile_path": "", "status": "not_found"}
            p = people[0]
            path = p.get("profile_path") or ""
            return {"nconst": nconst, "profile_path": path,
                    "status": "ok" if path else "no_image"}
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return {"nconst": nconst, "profile_path": "", "status": "not_found"}
            if e.code == 429:
                time.sleep(float(e.headers.get("Retry-After") or 2)); continue
            if attempt == 2:
                return {"nconst": nconst, "profile_path": "", "status": "error"}
        except Exception:
            if attempt == 2:
                return {"nconst": nconst, "profile_path": "", "status": "error"}
            time.sleep(1.0 * (attempt + 1))
    return {"nconst": nconst, "profile_path": "", "status": "error"}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--out", default=OUTPUT)
    args = ap.parse_args()

    headers = auth_headers()
    limiter = Limiter(REQS_PER_SECOND)
    ids = [r["nconst"] for r in duckdb_select(" ".join(INPUT_SQL.split()))]
    if args.limit:
        ids = ids[: args.limit]

    # keep anything already resolved; only fetch the gap
    have = {}
    if os.path.exists(args.out):
        for r in duckdb_select(f"SELECT * FROM read_parquet('{args.out}')"):
            have[r["nconst"]] = r
    todo = [i for i in ids if i not in have]
    print(f"people: {len(ids):,} · already have: {len(have):,} · to fetch: {len(todo):,}")

    rows = list(have.values())
    done = 0
    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as pool:
        for r in pool.map(lambda i: resolve(i, headers, limiter), todo):
            rows.append(r); done += 1
            if done % 500 == 0:
                print(f"  {done:,}/{len(todo):,}", flush=True)

    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        c = os.path.join(tmp, "r.csv")
        with open(c, "w", newline="", encoding="utf-8") as fh:
            w = csv.DictWriter(fh, fieldnames=["nconst", "profile_path", "status"])
            w.writeheader()
            for r in rows:
                w.writerow({k: r.get(k, "") for k in ("nconst", "profile_path", "status")})
        duckdb_run(f"COPY (SELECT * FROM read_csv('{c}', header=true)) TO '{args.out}' "
                   f"(FORMAT PARQUET, COMPRESSION ZSTD)")
    ok = sum(1 for r in rows if r.get("status") == "ok")
    print(f"wrote {args.out}: {len(rows):,} people, {ok:,} with a photo")


if __name__ == "__main__":
    main()
