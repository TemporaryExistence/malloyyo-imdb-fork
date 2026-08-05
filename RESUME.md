# RESUME HERE — malloyyo-imdb-fork (updated 2026-08-04, session 4)

**Read this first, then `CHARTER.md`.**

---

## 1. STATUS: Andrew's eight rejections are all addressed. Nothing is pushed.

Commit `d390661` is **local only**. The live site is still `81cd348` and does **not** have any of
this. Publishing is Andrew's (CHARTER §5) and the site auto-deploys on push.

| # | His words | State |
|---|---|---|
| 1 | "There is no picture of the actor." | **Done.** `person_images.parquet` = 13,560 people, 11,762 portraits; all 150 in the deck have one. |
| 2 | "The picture should be nearly full screen." | **Done.** 74vh (was a 206px tile), and it scrolls into view. |
| 3 | "No way to switch to movies/shows, only actors." | **Done.** People / Films / Shows toggle, verified by clicking it. |
| 4 | "'Your next watch' is useless if people haven't selected any ratings." | **Done**, without breaking §4's cold-start rule. |
| 5 | "Overly verbose page text, AS ALWAYS." | **Done.** Every rendered string re-read and cut; longest is 9 words. |
| 6 | "You didn't build all the features I asked for." | **Done.** Export/share (a §1 success criterion, never built) + F4's provider marks. |
| 7 | "Doesn't allow you to sort by year or select genres to filter by." | **Done.** Genre picker + timeline, asserted to actually filter. |
| 8 | "You seem to have missed the whole point." | **Done.** Swipe mode was two buttons; it is now a real drag. |

---

## 2. THE ROOT CAUSE OF "30% DONE"

Last session's work compiled, linted green, and was **never bundled**. It contained
`title.genres.value ~ $GENRE` in the recommendation query — an unnest across a source already
fanned out one row per (candidate feature × liked title). 3.1s → 60s+ locally; in DuckDB-WASM it
**never returned**. The dashboard runs one query queue, so that single hang left **every** control
on the page empty, with no error and `loading` stuck true.

⛔ **Do not put `genres.value` (or any unnest) in a where-clause on the `scoring` source.** The
block comment on that query says so. Genre is carried out as a plain list column and filtered in JS.

---

## 3. WHAT IS ACTUALLY VERIFIED (not "it compiled")

- `scripts/stress.js` — full adversarial suite, **green**, now with a `[6c]` section holding a check
  for every defect this session produced (query-queue wedge, cold start, export, card size,
  card-on-screen, affordance visible, drag, click-halves).
- Filter assertions: Horror changes the grid; a timeline click puts **every** visible year inside
  the selected range.
- Gesture assertions: drag right/left, sub-threshold drag records nothing, click-halves, swipe-up
  skip, undo.
- Read as images at 1440×900, 1440×1200, 390×844 and dark mode.
- Cold start measured in the browser: 28 titles, **14 film / 14 TV**.

## 4. THE ONE PROCESS STEP NOT RUN

**The context-isolated rater gate (CHARTER §5) has NOT run this session** — this agent is not
spawning subagents. Run it before showing Lloyd anything:
```
/run-rater
```

## 5. STILL OPEN

- **Ratings-CSV import** — cut, and the build order (§2A item 8) explicitly permits it.
- The recommender with **zero title ratings and only people liked** returns "every title carrying
  those people, most-voted first". Correct and documented, but it reads generic. Worth revisiting.
- Nothing has been proposed upstream. §6.2: not until Lloyd asks.

## 6. HOW TO WORK ON THIS

- **Bundle:** `npx --no-install malloyyo dashboard bundle --out docs --title "malloyyo-imdb-fork" --duckdb bundled --no-serve`
- **Serve:** any no-cache static server on `docs/` at `127.0.0.1:8810`. Free the port with
  `fuser -k 8810/tcp` — a `pkill -f` pattern matches its own argv and kills the shell.
- **Time a query before trusting it:** `npx --no-install malloy-cli run dashboards/next_watch.malloy <query>`.
  Anything over ~5s locally will hang the browser. This is the check that would have saved the session.
- **Push:** `bash scripts/push.sh` — never a bare `git push`.
- **Skill:** `work/.claude/skills/data-site` holds every trap this stack produces.
- **Style ruling:** match Lloyd's visual system exactly. "Better means MORE, not DIFFERENT."
