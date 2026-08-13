# Product: Malloyyo IMDb fork (Lloyd's tool)

> **Orientation card.** First file to read when entering this product's context.
> Written 2026-08-06 to close Control 37 (every product carries a profile.md).

## Name
**No brand name — it is "the fork".** Deliberately: this is a fork of **Lloyd Tabb's**
`malloyyo-imdb`, built to answer a challenge he set Andrew, not a product of ours to name.
Refer to it as *the fork* or *Lloyd's tool*. Naming it would misrepresent whose thing it is.

## Aliases & Paths
- **Directory:** `/home/andrew/Project/work/products/malloyyo-imdb-fork/`
- **Own git repo:** `https://github.com/TemporaryExistence/malloyyo-imdb-fork.git`
  (nested own-repo — the root repo must NOT carry it as a gitlink; it is in the root `.gitignore`)
- **Upstream:** `https://github.com/lloydtabb/malloyyo-imdb` · `https://lloydtabb.github.io/malloyyo-imdb/`
- **Published surface:** GitHub Pages from `docs/` on the fork repo.
- **Goal charter:** `CHARTER.md` (ratified 2026-08-04 by Andrew, who delegated ratification that turn).

## What It IS NOT
- **It is NOT Watchpile.** `products/movie-swipe/` (= **Watchpile**) is the swipe site, **split out of
  this fork on 2026-08-05** because Lloyd said swiping was not what he envisioned for his tool. Watchpile
  has a backend; the fork stays fully static. Do not put swipe work here.
- **It is NOT upstream.** Nothing is proposed to Lloyd until Lloyd asks (CHARTER §6.2). Do not open PRs
  against `lloydtabb/malloyyo-imdb`.
- **It is NOT `malloy-preview/`.** That is a **web-agency** client preview of the Malloy *marketing*
  website (repo `malloy-site-preview`). Same word, unrelated surface.
- **It is NOT a TV browser.** Television was removed 2026-08-05 (`titleType = 'movie'`, 24,052 → 18,965
  titles). If you find TV code, it is a regression.
- **It is NOT a second copy of the data.** This repo BUILDS the parquet; Watchpile copies it in.

## How To Launch / View The REAL Thing
```
bash /home/andrew/Project/work/products/malloyyo-imdb-fork/scripts/build.sh
```
⛑ **Use `build.sh`, never the bare `malloyyo dashboard bundle` command.** The bundler regenerates
`docs/*.html` from scratch and destroys the injected `person-autofill.js` script tag;
`scripts/postbuild.sh` restores it, and `stress.js` carries an assertion that fails if it was skipped.
⛑ **Source never lives in `docs/`** — `docs/` is build output. The first copy of the autofill script was
written there and the next bundle deleted it.
⛑ Serve **no-cache** when showing Andrew; a cached bundle has twice made a session verify a build it was
not looking at.

Pushing is via the repo's own gated script, not a bare `git push`:
```
bash /home/andrew/Project/work/products/malloyyo-imdb-fork/scripts/push.sh
```

```launch-manifest
CANONICAL: work/products/malloyyo-imdb-fork
RUN_MODEL: static site; Malloy + DuckDB-WASM in the visitor's browser; parquet served from the repo; zero backend
DEPLOY_STATUS: not-yet
LAUNCH_CMD: bash scripts/build.sh && python3 scripts/serve.py docs 8810
NOT_THE_PRODUCT: work/products/movie-swipe (Watchpile, the swipe site); malloy-preview (the Malloy MARKETING site, a web-agency client preview); https://lloydtabb.github.io/malloyyo-imdb (upstream, Lloyd's own)
```
⚠ `DEPLOY_STATUS: not-yet` is deliberate: GitHub Pages from `docs/` on
`TemporaryExistence/malloyyo-imdb-fork` is the intended surface, but **the push is Andrew's and had not
happened as of 2026-08-09**. Flip to `live` + fill `DEPLOY_URL` only after the published page is opened
and confirmed — not when the push is run.

## The one thing that makes it different
**Zero backend, nothing leaves the visitor's machine.** DuckDB-WASM + Malloy run in the browser; even
the personal ratings join is a localStorage CSV registered into DuckDB at page load. The no-backend
constraint was amended **for Watchpile only** — it still binds here.

## Live constraints to know before touching it
- **⛑ ANDREW OWES: set `TMDB_READ_ACCESS_TOKEN` on `TemporaryExistence/malloyyo-imdb-fork`.** A fork does
  NOT inherit upstream's repo secrets (`gh secret list` returns empty) and both TMDB steps are
  `continue-on-error`, so a scheduled run would ship stale posters on a green tick. A credential preflight
  + final assert now exist, but the token is still missing.
- **The scheduled data refresh runs Sunday 06:00 UTC.** Un-rebased local work gets re-cemented against.
- **Open work:** the per-page tool split + layout simplification — the item Andrew weighted heaviest, not
  started. Full plan ready to paste: `NEXT-LAYOUT-WORK.md`.
- **Hygiene debt:** `scripts/` holds ~200 throwaway `_rater*.js` / `_wt_*.cjs` verification scratch files
  mixed in with the 12 real scripts. The real ones are `build.sh`, `postbuild.sh`, `push.sh`,
  `build_data.sh`, `build_people.sh`, `build_suggest_index.sh`, `build_taste_features.sh`,
  `check_bands.sh`, `stress.js`, `shot.js`, and the three `fetch_*/resolve_*` python helpers.
