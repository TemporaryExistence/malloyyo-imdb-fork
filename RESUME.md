# RESUME HERE — malloyyo-imdb-fork (updated 2026-08-07)

**Read this, then `CHARTER.md` — and in the charter, read §7 first: it amends everything above it.**

---

## 0. ⛔ THE PAGE SPLIT IS BUILT AND COMMITTED BUT **NOT LIVE** (2026-08-07)

Measured, not inferred, on 2026-08-07:

```
local  docs/rate.html                                       serves 200
commit 379e62e  "Split next_watch into rate.html + next_watch.html"   UNPUSHED (git log @{u}..HEAD)
live   https://temporaryexistence.github.io/.../rate.html    404
live   https://temporaryexistence.github.io/.../next_watch.html  200  (still the OLD 1,268-line page)
```

**Do not read "the split is done" as "the split shipped."** Everything §1's table calls done below the
split line IS live; the split itself is one `bash scripts/push.sh` away and that push has not happened.
Publishing this is outward-facing — Lloyd sees this site — so it is Andrew's call, not an agent's.

---

## 1. WHAT CHANGED TODAY

Andrew met Lloyd about the fork and brought back direction. It is all in **CHARTER §7**. The headline
items, and their state:

| | State |
|---|---|
| Swipe tool splits into its own site | **Done** — `../movie-swipe/`, builds and runs. Name is a placeholder. |
| Television removed from the corpus | **Done** — 24,052 → 18,965 titles, movies only. |
| Where-to-watch collapsed to one personalised mark | **Done** — one glyph, hover shows only the visitor's services. |
| Per-provider deep links | **Done, and bounded** — see §4. |
| Fuzzy autofill on search | **Done** — his three examples verified in the browser. |
| The fork's own legible recommender | **Done** — "What your ratings are doing" + a per-tile reason. |
| **Per-page tool split + layout simplification** | **BUILT 2026-08-07 (`379e62e`), NOT PUSHED — see §0.** `next_watch.jsx` 1,591 → 696; new `rate.jsx` 307; shared code in `lib/kit.jsx`, `lib/taste.js`, `shared_queries.malloy`. |

⛔ **PUSH STATE (re-measured 2026-08-07):** everything through `2815db0` (2026-08-06) **is** on
`origin/main` and live. **One commit is unpushed — `379e62e`, the page split.**
Push the fork with `bash scripts/push.sh` — Sync All still does not cover this repo.

## 2. WHAT ANDREW OWES — ✅ BOTH DISCHARGED (re-verified 2026-08-07)

1. ✅ **`TMDB_READ_ACCESS_TOKEN` IS SET** (closed). Verified against the repo, not assumed:
   ```
   gh secret list --repo TemporaryExistence/malloyyo-imdb-fork
     TMDB_API_KEY             2026-08-06T01:13:50Z
     TMDB_READ_ACCESS_TOKEN   2026-08-06T01:16:08Z
   ```
   And the refresh actually ran green with it: `refresh-data` `workflow_dispatch` succeeded in 27m21s on
   2026-08-06T01:13:58Z. The original text (*"`gh secret list` returns empty... only he can add the
   secret"*) is **no longer true** and is preserved here only as the record of what the gap was.
2. ✅ **The swipe site is named `Watchpile`** (closed, 2026-08-05) — Andrew delegated the naming
   ("Generate your own name for the swipe site for now... it doesn't really matter"), so it is a working
   name he may overrule, not a settled brand. See `../movie-swipe/profile.md`. The **directory** is still
   `products/movie-swipe/` on purpose: nothing is published yet, so renaming it buys only sync churn.

⚑ Still genuinely open, but it is **not** an Andrew-owes: the fork's own repo/URL are fine; **Watchpile
has no git repo and no live URL yet** (target: GitHub Pages under `TemporaryExistence`).

## 3. THE TWO THINGS STILL OPEN, BOTH HIS ASKS

- ~~**"The site feels hacky... too crowded... give each tool its own page."**~~ → **BUILT 2026-08-07.**
  `next_watch.jsx` went 1,591 → 696 lines and `rate.html` now owns the collecting job. **Still gated on
  a push (§0), and Lloyd has not seen it.** The remaining question is his verdict, not more building.
- Everything else from the meeting is built.

## 4. WHAT IS TRUE BUT EASY TO MISREAD

- **The deep links are search routes, not canonical title pages.** TMDB returns ONE aggregate JustWatch
  link per title per region; no licensed source has per-provider deep links. Clicking Netflix opens
  Netflix's own search for the exact title. Services without a verified route fall back to the JustWatch
  page. This is short of what he asked for and the code says so — do not "fix" it by guessing URLs.
- **The browser-cache join is real but boot-bounded.** The swipe site registers the visitor's ratings as
  a DuckDB table from a blob before the runtime starts, and Malloy joins it. It reflects ratings **as of
  page load**, and the page says so.
- **`docs/user_ratings.csv` in the swipe site is header-only ON PURPOSE.** The Malloy CLI compiles the
  model against real DuckDB at build time, where no browser exists; without the file the WHOLE model
  failed. Do not delete it for looking empty — it is the schema.

## 5. CONTROLS THAT WILL CATCH THE NEXT MISTAKE

- `scripts/check_bands.sh` — re-derives the availability vote-band sizes from the parquet and fails
  before the runtime's silent 5,000-row truncation bites. Wired into the refresh workflow. The literals
  were the quartiles of a corpus WITH television and moved to 58196/18156/8675 today; **re-run this after
  any data change.**
- `scripts/stress.js` — the adversarial suite. Two assertions were rewritten today because they tested an
  old implementation rather than the requirement: the provider marks (counted 16px logos that no longer
  exist) and `thin-rank` (pasted five title names, so a correct new result read as a regression).
- **The row-cap canary is now The Thicket (tt4058618).** Zorro was a tvSeries and left with television;
  its first replacement never rendered on the page. **Pick a canary from the ids the page ACTUALLY
  RENDERS, never from the parquet alone.**

## 6. HOW TO WORK ON THIS

- **Bundle:** `npx --no-install malloyyo dashboard bundle --out docs --title "malloyyo-imdb-fork" --duckdb bundled --no-serve`
- **Serve:** any no-cache static server on `docs/` at `127.0.0.1:8810`. Free the port with
  `fuser -k 8810/tcp` — a `pkill -f` pattern matches its own argv and kills the shell.
- **Data rebuild:** `bash scripts/build_data.sh` re-downloads ~1.4 GB. To rebuild from the tsv already on
  disk, run the malloy build and the duckdb COPY directly — that is what isolated today's TV removal.
- **After any data change:** `scripts/build_taste_features.sh`, `scripts/build_people.sh`,
  `scripts/build_suggest_index.sh`, then `scripts/check_bands.sh`.
- **Push:** `bash scripts/push.sh` — never a bare `git push`.
- **Style ruling (§5, unchanged):** match Lloyd's visual system. "Better means MORE, not DIFFERENT."
  §7.3's "simplify" means remove OUR accretion, not redesign his pages.

## 7. THE STANDING LESSON, AND IT HELD AGAIN TODAY

**A green suite has never meant correct here.** Today it went the other way too: three suite failures
were investigated and **all three were the TEST, not the site** — a stale pasted title list, a canary
that had been deleted from the corpus, and lazy-loaded images measured without scrolling. The one real
regression (the JustWatch licence credit disappearing into a hover-only popover) was found by a check
that tested the old implementation and had to be rewritten to test the requirement.
Both halves of that are the same rule: **assert the property, not the moment.**
