# Goal Charter — the Malloyyo IMDb fork (Lloyd's tool)

Status: **DRAFT** (the *substance* below was ratified by Andrew on 2026-08-04; the §2/§3 schema fields are
new and drafted 2026-08-09 by work/orchestrator, so the file as a whole awaits his word)
Last reviewed: 2026-08-09   ·   Review cadence: every 5 sessions that touch the fork

> **⚑ THE SUBSTANCE OF THIS CHARTER IS `CHARTER.md`, IN THIS DIRECTORY.** That file is the real thing —
> the goal in Lloyd's words, the six features, the build order, the constraints, the style ruling, and the
> 2026-08-05 amendment (§7) written after Andrew met Lloyd. It was ratified 2026-08-04 by Andrew, who
> explicitly delegated ratification that turn. **Read it, not a summary of it.**
>
> This file exists because the fleet's anti-divergence gate (`charter-scoreboard.sh` →
> `goal-charter-check.sh`) matches the filename **`GOAL-CHARTER.md`** exactly, so a charter named
> `CHARTER.md` read as *no charter at all* — the silent-false-clean shape the gate is meant to prevent.
> It adds the two schema fields `CHARTER.md` does not carry (a single convergence metric and the
> metric-validity check) and points at `CHARTER.md` for everything else.

## 1. GOAL (one operational sentence)
> **Lloyd:** *"A clear and easy-to-use tool built on Malloy/Malloyyo that helps users with films and actors
> from that starting data set."* (`CHARTER.md` §7.1 — this amends and wins over §1)

**Get a visitor to a list of things they actually want to watch, before their patience runs out** —
clearly, one tool per page, films and actors from one data set.

**Done-condition:** time-to-first-recommendation under 60 seconds for a first-time visitor; zero mandatory
account/upload/server round-trip; a visitor who only scrolls still gets a usable list; the list is
exportable. (`CHARTER.md` §1.)

## 2. CONVERGENCE METRIC (the one number tracked every session)
- **Metric:** **`stress.js` failures, target 0, at a check count that only ever grows** — currently
  **69 checks, 0 failures** (was 59; ten assertions added 2026-08-08, each born of a defect that shipped
  past the old 59).
- **Measured by:** the adversarial suite run **cold, against a served build, in a fresh browser profile**
  — never against the changelog. Growth is the load-bearing half: every defect Andrew or Lloyd finds
  becomes a new assertion before it is called fixed.
- **Recorded in:** `convergence.ledger` (one dated line per session that touches the fork).
- **Current reading:** 2026-08-08 — **69/69, `ALL CHECKS PASSED - could not break it`**. Trend: improving.

## 3. METRIC-VALIDITY CHECK ⭐
Q: **Name a way this metric could improve while the REAL goal gets worse.**
A: **Green on an unfiltered page.** This has already happened here and is not hypothetical: the Timeline
was **dead** — selecting 1970-1975 changed nothing, because `filters.between(lo,hi)` writes `1970 to 1979`
and every query reading `$RELEASE_YEAR` returns **zero rows** for that form, silently. **All 59 checks
were green** at the time, because every one of them looked at a page with no filter applied. A suite can
grow indefinitely while testing only the state where nothing is wrong.

The second, subtler form: **passing while the page gets less clear.** Lloyd's word is *clear*; a suite
measures function, and the site can pass 69 checks while becoming exactly the crowded, layered thing he
called a defect (`CHARTER.md` §7.3).

Ruled out by: (a) new assertions must exercise a **changed** state and assert the **specific** outcome —
`[6i]` asserts the list changed **BY YEAR**, because "the list changed" would have passed while still
showing 2019 films; (b) the **rater gates presentation and its brief includes style-match to upstream** —
*"does this look like Lloyd built it?"* is pass/fail, not a preference (`CHARTER.md` §5), so clarity has an
owner outside the suite.

## 4. GOAL-GATE (applied at session close)
- A session counts only if it moved the suite toward 0 failures at an equal-or-greater check count, **or**
  states plainly that it was enabling work.
- **Off-charter work (does NOT count, flag it):**
  - **Restyling Lloyd's pages.** "Better" means MORE, not DIFFERENT (`CHARTER.md` §5, §7.7). A diff that
    reads as "someone else did this bit" is wrong, and it would poison the PR the charter aims at.
  - **Swipe-deck work** — that is Watchpile (`products/movie-swipe/`), split out 2026-08-05.
  - **Television** — removed 2026-08-05; `titleType = 'movie'`. TV code found here is a regression.
  - Proposing anything upstream before Lloyd asks (`CHARTER.md` §6.2).
  - Any feature that adds a step without adding a list.

## 5. RE-CHARTER PATH
- Change the goal/metric by amending `CHARTER.md` (the §7 amendment is the precedent: append, never
  delete the prior reasoning), append the WHY + date to `work/DECISIONS.md`, and re-ratify with Andrew.
- **⛔ One open trade Andrew has NOT ratified:** `pair_titles` cut to 1,200 rows for latency moved
  Crime + Drama from **469** films-in-both to **117**. Reversible — raise `ROW_LIMIT` in
  `scripts/build_cold_start.sh` **and** `limit:` in `dashboards/next_watch.malloy` together (the drift
  guard refuses the build if they disagree, deliberately).
- **Publishing remains Andrew's**, and it carries an outward-facing dimension this fleet's other products
  do not: it is a public fork of a named person's work, and that person is family.
- Next scheduled review: on the next session that touches the fork.
