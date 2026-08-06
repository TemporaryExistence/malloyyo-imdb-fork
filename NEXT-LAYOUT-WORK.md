# The page split + layout simplification — the plan, ready to execute

**Status: NOT STARTED.** This is the last outstanding item from Andrew's 2026-08-05 list, and the one he
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
