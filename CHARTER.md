# Goal Charter — malloyyo-imdb-fork (fork of Lloyd Tabb's malloyyo-imdb)

- **Drafted:** 2026-08-04 by work/orchestrator
- **Ratified:** 2026-08-04 — **by Andrew, who explicitly delegated ratification this turn**
  (*"Draft and ratify a charter for this goal and then proceed as recommended"*). Recording the
  delegation rather than claiming independent authority: ratification is normally his alone.
- **Upstream:** https://github.com/lloydtabb/malloyyo-imdb · https://lloydtabb.github.io/malloyyo-imdb/
- **Origin:** Lloyd challenged Andrew to add two features. His framing is the goal, quoted below.

---

## 1. THE GOAL (one sentence, and everything below serves it)

> **Lloyd:** *"I don't know how much patience people have for clicking around in it, but let's see what
> we can do."*

**Get a visitor to a list of things they actually want to watch, before their patience runs out.**

That is the whole charter. Not "browse movies", not "explore IMDb" — **leave with a list**.
Since 2026-08-04 that list spans **films and television**, and can be reached from a **person** as
readily as from a genre (F3, F4).

### Why this framing and not "add two features"
Lloyd named the risk himself: **patience is the binding constraint, not data and not features.** The
upstream tool is a browsing surface — it answers *"what pairs with Comedy?"* beautifully and then the
visitor leaves with nothing in hand. Every decision here is judged against whether it shortens the path
to a list, and a feature that adds a step without adding a list is a regression however good it looks.

### Success, stated so it can fail
1. **Time-to-first-recommendation under 60 seconds** for a first-time visitor who has never used it.
2. **Zero mandatory account, upload, or server round-trip** — see §3.
3. **A visitor who does nothing but scroll still gets a usable list** (see the cold-start rule, §4).
4. **The list is exportable/shareable** — a list you cannot take with you was not delivered.

### Non-goals (things we will NOT do, so scope cannot creep)
- Not a Letterboxd/IMDb competitor: no reviews, no social graph, no profiles, no accounts.
- Not a streaming-price comparison or deep-link affiliate site.
- Not a "complete" catalogue: the corpus is upstream's ~19k popular titles and stays that way.
- Not a rebuild: we **fork** and extend. Upstream's genre-pairs browsing stays and stays credited.

---

## 2. THE FEATURES

**F1 and F2 are Lloyd's ask. F3, F4 and F5 are Andrew's expansion, 2026-08-04**, and they change the shape of
the thing: with TV in and the people tool wired up, this stops being "a movie chart" and becomes **one
surface for deciding what to watch tonight** — which is much closer to the goal in §1 than movies alone
ever was. A watchlist people actually keep is mixed; excluding TV was excluding half the answer.

### F1 — Where to watch
A small provider mark (Netflix, Prime Video, Paramount+, …) in the **bottom-right of each thumbnail**;
clicking a movie opens the **full set of viewing options** (stream / rent / buy).

⛔ **Binding constraint discovered before building, not after:** TMDB's watch-provider data is
**JustWatch's**, and TMDB requires attribution **on each media item** — *"a reference or logo on each
media item"* — with API access revoked for non-compliance. So the per-thumbnail mark is not merely a
design choice, it is the licence condition, and the detail view must name JustWatch explicitly.
Non-commercial tier permits a 6-month cache; our refresh is weekly, well inside it.

### F2 — Your next watch
Pick things you loved (and optionally things you hated) → get recommendations.

**Lloyd's own caveat is the design brief:** if there is a faster way than clicking movies one by one,
find it. See §4.

### F3 — TV shows, not just movies (Andrew, 2026-08-04)

The corpus is movies-only by one line: `transform.malloy:63` reads
`where: raw_ratings.numVotes::number > 5000 and titleType = 'movie'`. Adding `tvSeries` (and probably
`tvMiniSeries`; `tvMovie` is a judgement call) is a one-line change **plus a full data rebuild**.

**The honest cost, stated before starting:** the rebuild downloads ~1.2 GB of IMDb TSVs (`title.principals`
alone is most of it) and needs two tools this machine does not have yet — the `duckdb` CLI and
`malloy-cli`. It also grows every downstream artifact: posters, watch providers and the taste-feature table
all key off the title list. Nothing here is hard; it is just not free, and it must happen **before** F1's
provider fetch, or the fetch runs twice.

**Where TV is genuinely different, not just more rows:**
- Availability is **per-show, not per-episode**. TMDB's `/tv/{id}/watch/providers` answers at show level,
  which is the right grain for "where can I watch this" and the wrong grain for "which season". Do not
  imply season-level precision we do not have.
- A show's `startYear`/`endYear` spans years, so the timeline filter and any era affinity in the
  recommender must treat a run as a range, not a point.
- Vote counts are not comparable across types: a long-running series accumulates votes a film cannot.
  Ranking movies and shows in one list on raw `numVotes` would quietly bury films. Normalise or separate.
- `fetch_watch_providers.py` **already handles both** — it reads `movie_results` and `tv_results` from
  TMDB's `find` and switches the endpoint accordingly. That part was built for this before it was asked for.

### F4 — the same features in the people tool (Andrew, 2026-08-04)

Upstream's second dashboard (`works_together`) answers "who has worked with this person". It gets both
new features:
- **Availability on every title it lists**, same provider mark and same per-item JustWatch attribution.
- **Seed the recommender from a person.** "Everything with this person you have not seen" is a
  one-click taste signal that costs a visitor nothing — which is exactly what §4 is chasing. A person is
  a far cheaper thing for someone to name than ten films.

This is the cheapest large win on the sheet: it reuses the F1 component and the F2 scoring with no new
data, and it turns a browsing dashboard into a list-producing one.

### F5 — Swipe mode: "Tinder for movies and shows" (Andrew, 2026-08-04)

One title, full-bleed poster. **Swipe right = liked, left = disliked.** On desktop, **click the left or
right half of the screen**. Around 10–20 swipes produces a recommendation; keep swiping and it narrows.

**Why this is not a duplicate of the grid, and why both ship.** The grid (§4.1) is the faster *cold*
start, but it only ever yields **likes** — an untapped poster is ambiguous, because "I did not like it" and
"I have never seen it" look identical. Swipe mode yields a **signed** signal, and the recommender in §4 is
built to score *toward* liked and *away* from disliked. So the two are different instruments: the grid is
breadth in five seconds, the swipe is depth and sign, and it is the one that keeps someone in the tool.
Lloyd's worry is patience; swiping is the interaction pattern that consumer products use precisely because
people will do it far longer than they will fill in a form.

**Sequence, so both metrics hold:** grid first → a first list inside the 60-second target → *"not quite
right? keep swiping"* → swipe mode refines it. Reward early, deepen optionally.

**People are swipeable too (Andrew, 2026-08-04).** An actor card is a *coarse, high-leverage* signal: one
swipe touches every title they are in, where a film swipe touches one. So the deck mixes card types and the
adaptive picker should open with people (broad strokes, cheap) and move to titles as the profile sharpens.
⚠ **Liking an actor is not liking their filmography** — it raises that person's weight in the taste profile,
it does not mark their titles as liked. Conflating the two would recommend someone the worst film of a
favourite actor's career and call it a match. A disliked actor is a strong negative and should be treated
as one.

**Design rules that are not optional:**
- **Three outcomes, not two.** Like / dislike / **haven't seen**. Binary would fold "I have never seen it"
  into "I disliked it" and poison the profile with a judgement the visitor never made. Swipe up, or a
  visible skip.
- **Undo.** One mis-swipe (or a stray click on the wrong half) must be reversible. Without it a single slip
  silently corrupts every recommendation that follows and the visitor cannot tell.
- **Keyboard too.** Arrow keys, and real focus states. Swipe-and-click-only would make the primary input
  path unusable for anyone not using a mouse or a touchscreen.
- **The click-halves need an affordance.** An invisible hit target that judges films is a trap; show what
  each half does before the first click, not after.

**⚑ The part that makes "keep swiping to narrow" true rather than decorative — pick the next card
adaptively.** A fixed deck of popular titles stops informing us after a handful of swipes: if someone has
liked three action films, a fourth teaches almost nothing. Choose each next card to **maximise information
given what we already know** — target the boundary of what is still uncertain, favouring titles whose
features split the current profile rather than confirm it. This is the same idea as seeding the grid with
high-IDF, low-overlap titles (§4.1), applied one card at a time, and it is what makes swipe number 15
worth more than swipe number 5 instead of less.

### F6 — Search, to rate anything directly (Andrew, 2026-08-04)

A search box over **titles and people**: find the thing, rate it, without waiting for the deck to offer it.

**The case it serves is the one the other modes handle worst.** The grid and the swipe both *choose for*
the visitor. Someone who already knows their three favourite films is forced to wait for us to guess them.
Search is the escape hatch, and for a decisive visitor it is the fastest route to a good profile there is.

- Runs **client-side** over the parquet already in the browser — no server, no autocomplete API, consistent
  with everything else here.
- Searches **~19k titles and ~14.7k people** in one box; results carry the same rate controls as any card,
  and titles carry the F1 availability mark.
- Match on title, original title, and person name; tolerate missing punctuation and articles ("dark knight"
  should find it). Rank by vote weight so the obvious answer is first.

---

## 2A. BUILD ORDER — what ships first, so six features do not become none

The charter's job is to stop divergence, and a six-feature list is exactly how divergence starts. Ordered
by dependency first, then by value to the goal in §1:

1. **TV rebuild (F3).** Everything downstream keys off the title list; doing it later means redoing the
   poster and provider fetches. Blocking, and first.
2. **Watch providers (F1 data).** Long-running fetch; start it as soon as the title list is final.
3. **Availability UI (F1).** The provider mark and the detail view, with per-item JustWatch attribution.
   Useful on its own the moment it lands, on both existing dashboards.
4. **Recommender + grid cold start (F2).** The scoring is already validated; this is the input path.
   **This is the first point at which a visitor can leave with a list** — the charter's actual goal.
5. **Swipe mode (F5), titles then people.** The retention instrument, and the signed signal the grid lacks.
6. **Search (F6).** The escape hatch. Cheap once the rate controls from 4 and 5 exist.
7. **People-tool integration (F4).** ⚑ **HALF DELIVERED, half deliberately cut.**
   - *Delivered:* seeding the recommender from a person. Search covers people; picking one surfaces their
     titles to rate. It does NOT mark their filmography as liked, and says so on screen.
   - *Cut, with reason:* the provider mark on `works_together`. That dashboard has **no custom
     component** — Lloyd renders it with Malloy's built-in table renderer. Adding marks means replacing
     his page with a bespoke React component, which is a **redesign of his work**, and §5's style ruling
     forbids exactly that. The mark is on every poster surface that has one (`genre_pairs`,
     `next_watch`); it is absent from the one page that has no posters. Revisit only if Lloyd wants it.
8. **Import (§4.2).** ⚑ **CUT for now**, as the build order explicitly permits. Andrew has no ratings
   export anywhere, which is the evidence that demoted it from headline to power-user path in the first
   place (§4). The three input modes that ship — grid, swipe, search-including-people — cover a visitor
   who has nothing, which is the charter's actual cold-start requirement. Import remains a clean addition
   later; nothing built here forecloses it.

**A cut is allowed and expected.** If any of 5–8 will not be good, it does not ship; 1–4 is a coherent,
honest product on its own. Shipping four finished things beats eight half-built ones, and Lloyd asked for
two of them.

---

## 3. CONSTRAINTS (inherited and non-negotiable)

- **Static site, no backend.** Malloy model + DuckDB-WASM in the browser, parquet served from the repo.
  Everything upstream established stays: weekly GitHub Action refresh, posters hotlinked from TMDB's CDN.
- **Nothing a visitor does leaves their machine.** No uploads, no telemetry of taste, no account. This is
  not a privacy nicety — it is the *architectural advantage* that makes F2 possible at all (§4).
- **Credit is load-bearing.** Malloy, Malloyyo and Lloyd's upstream tool are named on every page, as on
  First Year Out. Fork, not appropriation.
- **Licensing:** IMDb non-commercial dataset terms; TMDB attribution; JustWatch attribution per item.
  Any feature that cannot be built inside those terms is not built.

---

## 4. THE DESIGN CALL THAT DECIDES WHETHER THIS WORKS

Lloyd's challenge is really: **how do you learn someone's taste without spending their patience?**
Three routes, and we do them in this order:

**⚑ REORDERED 2026-08-04.** The import was written here as "the headline". Then Andrew — a technical
person building this — said he does not use Letterboxd or IMDb ratings and **has no ratings stored
anywhere**. If he does not, the ordinary visitor certainly does not. Import serves a minority; designing
around it would have optimised for the rarest visitor. **The cold start is the main path.**

1. **A cold start that costs almost nothing.** A **multi-select poster grid**: one screen of well-known,
   genre-spread titles, "tap the ones you liked". Multi-select is the highest information-per-second input
   there is — a this-or-that pair yields one bit per click, a grid yields ten signals in five seconds.
   Seed the grid with titles that **split the space** (high-IDF, low mutual overlap) rather than simply the
   most popular, so each tap discriminates instead of confirming what everything already shares.
   **A person also works as a seed** (F4): naming one actor is cheaper than naming ten films.
2. **Import for the minority who have it.** IMDb and Letterboxd both export ratings as CSV; IMDb's carries
   `tt…` IDs so it matches exactly, Letterboxd needs title+year matching. Still worth building — **and
   because the query engine is in the browser, the file is never uploaded** — but as the power-user path,
   not the front door.
3. **Passive signal.** Scrolling, expanding a shelf and opening a title are all taste signals already
   being generated. Use them so the list starts forming before anyone is asked for anything.

**Cold-start rule:** the tool must produce a defensible list from **zero** explicit input. A blank
"pick 10 movies to begin" screen is a failure of this charter, not an implementation of it.

**Recommendation basis** (all computable in-browser from upstream's existing data — genres, cast/crew,
year, votes, rating): similarity on shared genre-pairs and shared principals, era proximity and rating
band, scored *toward* the liked set and *away* from the disliked set. No model, no embeddings, no server.

---

## 5. HOW WE JUDGE OURSELVES

Every change answers: **does this shorten the path to a list, or lengthen it?**

### ⛔ VISUAL STYLE IS LLOYD'S, NOT OURS (Andrew, 2026-08-04) — this reverses a default

> *"make sure what you have built is consistent with the visual style of what Lloyd has already built. We
> want our tool to match his. We want to blend in. Make it just like his, but better. Not different, just
> more."*

**This overrides the house taste rules for this product.** On our own sites the default is a light rich
multi-hue gradient field, our own card system, our own type. **None of that applies here.** This is a fork
of someone else's tool, intended to read as a continuation of it — a stranger should not be able to tell
which parts we added. Concretely:

- **Match upstream's existing look**: his light background, his shelf layout, his poster grid, his chip
  filters, his type scale, his spacing, his nav. Study the rendered pages and copy the system.
- **New UI must look like it was always there.** A swipe deck, a search box and a provider badge all have
  to be drawn in *his* visual language, not ours.
- **"Better" means MORE, not DIFFERENT** — more capability inside the same design, never a redesign.
- **Do not import the First Year Out visual system.** No gradient field, no our-brand palette, no
  restyling of his components. If a change would be visible in a screenshot as "someone else did this
  bit", it is wrong.
- ⚑ **A gratuitous restyle would also poison the PR** the charter is aiming at (§6.2): a diff Lloyd can
  read as additive is one that leaves his design alone.

**Still ours and unchanged** (these are craft floors, not house style): no horizontal scroll, real keyboard
access, terse copy, no customer-facing em-dashes, and honest labelling of anything a number claims.

### Process bar, carried over from First Year Out and not re-litigated
- Verify against the **rendered artifact**, never the changelog — three bugs there printed *plausible*
  numbers rather than failing.
- The adversarial suite (`stress.js`) is ported and must stay green.
- **The rater gates presentation, and its brief here includes style-match to upstream** — "does this look
  like Lloyd built it?" is a pass/fail question, not a preference.

**⚑ Publishing remains Andrew's**, and this one carries a new outward-facing dimension the last product
did not: it is a **public fork of a named person's work, and that person is family.** Nothing ships to
Lloyd that we have not verified end to end.

---

## 6. SETTLED BY ANDREW, 2026-08-04 — do not re-ask

1. **Region: US only, first.** Region-switching is deferred, not designed out; `fetch_watch_providers.py`
   already takes `--regions`, so adding one is a data decision rather than a rewrite.
2. **It stays a real GitHub fork** of `lloydtabb/malloyyo-imdb` — **until Lloyd has reviewed it and
   encourages a pull request.** Nothing is proposed upstream before he asks. The fork relationship is the
   credit, and it is structural rather than a line of prose.
3. **Name: `malloyyo-imdb-fork`** — Lloyd's own name, plus `-fork`. Deliberately not a rebrand: this is
   his tool with two features added, and the name should say so.

**Consequence of (2) for how we work:** upstream is wired as the `upstream` remote. Keep our changes
reviewable as a diff against Lloyd's `main` — no gratuitous reformatting, no moving his files, no
rewriting his prose. If he does invite a PR, it should read as additive.
