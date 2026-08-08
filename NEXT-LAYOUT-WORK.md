# The page split + layout simplification — the plan, ready to execute

**Status: ✅ ALL STEPS DONE — 1-2 on 2026-08-06, 3-5 (the page split) on 2026-08-07 (commit `379e62e`).**
Measured at the artifact 2026-08-07: `docs/rate.html` exists and serves 200; `next_watch.jsx` is **696
lines** (was 1,591), new `rate.jsx` is **307**, with shared code in `lib/kit.jsx` (434), `lib/taste.js`
(250) and `shared_queries.malloy`. The per-step detail below is kept as the record of what was decided
and which premises turned out false — read §"three premises that were wrong" before touching either page.
This was the last outstanding item from Andrew's 2026-08-05 list, and the one he
weighted heaviest: *"The site feels 'hacky', not visually beautiful anymore. Too crowded, too many
different layers of visuals, too many different placement styles, too many different things to click on
to change the way the dataset is shown on different parts of the screen"* and *"instead of making one
page that is crowded and has every tool jammed in, let's make different pages for different tools, so the
ones that are most useful can become clear winners."*

It is written down at this level of detail so the next session pastes rather than re-derives.

## 1. The measurement, so the target is not a feeling

`dashboards/next_watch.jsx` is **1,591 lines** and renders, on ONE page: a genre picker, a timeline, a
3-way mode switch (grid / swipe / search), a poster grid, a swipe deck with its own person/film sub-mode,
a search box with results for both titles and people, an import control, the recommendation list, the
"what your ratings are doing" strip, the service picker, and a detail modal. That is the crowding.

## 2. The biggest single win, and it is now free

**The swipe deck should leave the fork entirely.** It moved to `../movie-swipe/` on 2026-08-05 (CHARTER
§7.2), and the fork is still carrying it: a **246-line `SwipeStage`** component plus ~92 lines of deck,
gesture, person-card and re-centre logic. Deleting it removes a whole mode from the switch and a whole
class of visual layer.

⛔ **IT IS NOT A STRAIGHT DELETE, and this is the trap.** Person ratings must SURVIVE, because:
- `peopleVerdicts` feeds `LIKED_PEOPLE` / `DISLIKED_PEOPLE`, which feed `recommendations_by_person`;
- CHARTER F4 ("seed the recommender from a person") is delivered through SEARCH, not the deck;
- Andrew's 2026-08-05 ruling keeps a recommender in the fork.

So the deck goes; `peopleVerdicts`, the undo history, and the person rating path through search all stay.
Entangled state to preserve: `peopleVerdicts`, `likedPeople`, `dislikedPeople`, `history`/undo,
`ratePerson`. Things that go with the deck: `SwipeStage`, `useNarrow`/`narrow`, `deck`/`setDeck`,
`swipeKind`, `personCard`, `stageRef`, `recenterRef`, the fold/re-centre effects, and the
`mode === "swipe"` block.

## 3. The page split

| page | what it is for | source |
|---|---|---|
| `index.html` | landing (Lloyd's) | unchanged |
| `genre_pairs.html` | browse pairings (Lloyd's) | unchanged except the streamable mark |
| `works_together.html` | who worked with whom (Lloyd's) | unchanged — see §5 |
| **`rate.html`** *(new)* | **tell it what you like**: the poster grid + search with fuzzy autofill + IMDb import | split out of `next_watch.jsx` |
| `next_watch.html` | **your list**: recommendations, why each is there, where to watch | what remains |

The two halves already share state through the URL and `localStorage`, so the split costs no new
plumbing: `rate.html` writes the profile, `next_watch.html` reads it. Each page keeps ONE job, which is
the whole ask.

Genre picker and timeline belong on `next_watch.html` (they filter the OUTPUT), not on both.

## 4. Order of work

1. Delete the deck (§2), keeping the person path. Rebuild, run `scripts/stress.js`.
2. **Repair the suite deliberately, not reflexively.** Roughly 15 assertions cover the deck: `[6c]` drag /
   click-halves / card size, `[6d]` the person deck and mobile fold, `[6e]` swipe feel and the viewport
   matrix. Those that describe the SWIPE belong in `../movie-swipe/scripts/smoke.cjs`; those that describe
   RATING (undo, "not seen" surviving a rating, keyboard) must survive here against the grid and search.
   Deleting an assertion because its UI moved is how coverage silently drops.
3. Create `rate.html` (new `dashboards/rate.jsx` + `rate.malloy`, or a second artifact in the existing
   model). Move the grid, search and import.
4. Strip `next_watch.jsx` to the output surface.
5. Re-run both suites and read the rendered pages at 1440 and 390.

## 5. The people-page search — DONE 2026-08-05, and the hesitation was wrong

Andrew overruled the hesitation and he was right: **Lloyd DECLARED
`suggest{query=name_options dimension=name}` on the NAME given**, so he wanted suggestions. He did not
decide against the feature; it simply does not work. Measured: his `name_options` query returns 10,000
rows, the rendered datalist ships with ONE option, and a native datalist is filtered by the BROWSER on a
substring of what you typed — so "mikel cain" could never reach Michael Caine through it however well it
were populated.

**Built without touching his page:** `assets/person-autofill.js` attaches to the input he already renders
and draws its own dropdown, installed by `scripts/postbuild.sh`. Verified: "mikel cain" → Michael Caine →
his table re-queries to Zimmer / Freeman / Nolan / Pfister. Covered by a stress assertion.

**So §3's `rate.html` does NOT need to carry person search on Lloyd's behalf.** It can still have its own
search for rating titles, but the people page is no longer a gap.

⛑ **Two build rules this created, both enforced:**
- **Run `scripts/build.sh`, never the bare `malloyyo dashboard bundle`.** The bundler regenerates
  `docs/*.html` and destroys the injected script tag; `postbuild.sh` restores it and the suite fails if it
  was skipped.
- **Source does not live in `docs/`.** The first version of the autofill script was written into
  `docs/assets/` and the next bundle deleted it outright.


---

# 2026-08-06 — what was actually done, and THREE premises in this plan that were wrong

Steps 1 and 2 are done. Steps 3-5 (the `rate.html` split) are **not started** — but the ground under
them changed, so read this before executing them.

## Done

- **§2, the deck is gone.** `next_watch.jsx` **1591 → 1225 lines.** Removed `SwipeStage`, `useNarrow`,
  `CARD_H_WIDE`/`CARD_H_NARROW`, `deck`/`setDeck`, `swipeKind`, `personCard`/`usePersonCard`,
  `genreSeen`, the `card` memo, the face/poster preloader, `stageRef`/`recenterRef` + the scroll
  re-centre effect, the deck keyboard handler, the Swipe chip and the `mode === "swipe"` block.
- **§2 step 2, the suite was repaired deliberately.** Rating-side assertions retargeted at the grid and
  search; swipe-side assertions retired here and **recorded as owed** in
  `/home/andrew/Project/work/products/movie-swipe/OWED-FROM-THE-FORK.md` (six items, none implemented
  there yet — a green suite here is not coverage that exists somewhere else).

## ⛔ Premise 1 that was wrong — "the person rating path through search stays"

§2 says the deck can go because person ratings survive through search. **They did not: `ratePerson`
had NO call site outside the deck.** Deleting the deck first would have left `peopleVerdicts`
permanently empty and killed `recommendations_by_person` and the disliked-person veto (CHARTER F4/F5)
— while every page still rendered and every remaining assertion still passed.

Built first, then the deck was removed: `search_people` now also groups by `principals.nconst` (person
verdicts key on the nconst, because `LIKED_PEOPLE`/`DISLIKED_PEOPLE` match `taste_features.feature`),
and each search People result carries ✕/✓ marks. `ratePerson(nconst, null)` un-rates.

## ⛔ Premise 2 that was wrong — the grid could stand in for the deck

The plan treats the grid as the surviving rating surface. **The grid offered exactly ONE outcome** —
click toggles "liked". "Not for me" and "not seen" existed only inside the deck. Removing the deck as
written would have cut the fork's rating vocabulary from three outcomes to one, silently.

`Tile` now carries all three marks (✕ / ✓ / —) wherever rating is the job, and none on the
recommendation list. `skip()` is a toggle and `undo` records `was`, so "not seen" reverses too.

## ⛔ Premise 3 that was wrong, and it is the one that BLOCKS §3 — "the two halves already share state
through the URL and `localStorage`, so the split costs no new plumbing"

**Only the streaming-service preference was ever in `localStorage`** (`lib/streaming.js`). Title and
person verdicts lived in React state plus the URL givens and **nothing else**. Splitting the page on
that premise would have meant: rate on `rate.html`, click through to `next_watch.html`, arrive with an
empty profile. A plain reload lost them too — already true, just never visible while one page held
both jobs.

**Built, so §3 now costs what the plan claimed:** `dashboards/lib/profile.js` persists verdicts, person
verdicts and "not seen" to `localStorage` (debounced, wrapped for private mode, nothing leaves the
machine). One seed is computed **before** any state so all three slices initialise together — the old
seeding ran between the state declarations and could only ever reach `verdicts`, so a shared link
restored titles and silently dropped people. **Precedence is deliberate: a URL carrying ratings WINS
over the saved profile**, because that is someone opening a list shared with them, and showing them
their own profile instead is the same bug from the other side. A new stress assertion proves ratings
survive a reload.

## So §3-5 are unchanged in shape, and now stand on true ground

Create `rate.html` (grid + search + fuzzy autofill + IMDb import), strip `next_watch.jsx` to the output
surface (recommendations, "what your ratings are doing", service picker, detail modal, genre picker and
timeline — the last two filter the OUTPUT and belong on one page only, not both). Cross-page links
should still carry the current givens so a SHARED link keeps working; `localStorage` covers the same
visitor moving between pages.
