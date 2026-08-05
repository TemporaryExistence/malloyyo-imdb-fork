# RESUME HERE — malloyyo-imdb-fork (2026-08-04 shutdown)

**Read this first, then `CHARTER.md`. Do not start new work until the list in §3 is done.**

---

## 1. ANDREW'S VERDICT: "You're like 30% done."

He reviewed the live site and rejected it. His words, verbatim — treat each as a defect, not a preference:

1. **"There is no picture of the actor."**
2. **"The picture should be nearly full screen."**
3. **"There is no way to switch to movies/shows, only actors for the like/dislike Tinder mode."**
4. **"'Your next watch' is useless if people haven't selected any ratings yet."**
5. **"You were overly verbose in the page text, AS ALWAYS. So annoying."** ← a REPEAT failure across sessions. Cut copy to the bone before he sees anything.
6. **"You didn't build all the features I asked for."**
7. **"The 'your next watch' page doesn't allow you to sort by year in the way Lloyd's original does or select genres to filter by."**
8. **"You seem to have missed the whole point."**

Plus a bug he did not have to mention: the swipe caption rendered **literal escape sequences**
(`“haven’t seen it”`) because a python replacement wrote them into the JSX as text.

**The lesson to carry in: he judges the RENDERED PAGE.** Screenshots of it were taken this session and
still missed all of the above, because the checks asserted "does it populate", never "is this good".

---

## 2. EXACT STATE AT SHUTDOWN

### Pushed and live
`https://temporaryexistence.github.io/malloyyo-imdb-fork/` — last pushed commit `81cd348`.
**Everything below is UNCOMMITTED and NOT BUNDLED.** The live site does NOT have it.

### Uncommitted work in the tree (compiles, `malloyyo lint` green, never bundled or seen)
- `dashboards/next_watch.malloy` — added `nw_genre_options`, `nw_periods`, `seed_people_typed`;
  `RELEASE_YEAR` declared dashboard-local (upstream does the same); recommendation + seed queries now
  filter on `$GENRE` and `$RELEASE_YEAR`.
- `dashboards/next_watch.jsx` — **Lloyd's real `GenrePicker` and `Timeline` components copied verbatim**
  from `genre_pairs.jsx` and wired; swipe **People / Films / Shows** toggle added; literal-escape bug
  fixed; copy cut; the zero-ratings "Your next watch" block removed entirely.
- `next_watch.malloy`, `storage.malloy`, `index.malloy` — `person_images` source registered.
- `scripts/fetch_person_images.py` — NEW, resolves `nm…` → TMDB `profile_path`.

### ⚠ A BACKGROUND JOB WAS KILLED MID-RUN
`scripts/fetch_person_images.py` was at **~8,500 / 13,560** people when the session ended.
`docs/data/person_images.parquet` is **incomplete or absent**. It resumes safely — it reads existing rows
and fetches only the gap:
```
cd /home/andrew/Project/work/products/malloyyo-imdb-fork && export PATH="/home/andrew/.local/bin:$PATH" && TMDB_API_KEY="$(cat /home/andrew/.config/work/secrets/tmdb-read-token)" python3 scripts/fetch_person_images.py
```

### Data already built and committed
24,052 titles (18,965 film / 5,087 TV) · posters 24,006 · **220,963 US watch offers over 21,509 titles** ·
taste features 167k rows (genre / cast / crew, with per-title norms).

---

## 3. WHAT TO DO, IN ORDER

1. **Finish the person-image fetch** (command above). Then wire the photo into the person card:
   join `person_images` in `seed_people_typed`, emit
   `concat('https://image.tmdb.org/t/p/w342', profile_path)`, and render it as the card's image.
2. **Make the swipe card nearly full screen** — currently a ~206px box. Target roughly `min(70vh, …)`
   for the image, with the ✕ / ✓ controls flanking it and the title beneath. This applies to BOTH the
   person card and the title card.
3. **Bundle, screenshot, and LOOK at it** before anything else:
   `npx --no-install malloyyo dashboard bundle --out docs --title "malloyyo-imdb-fork" --duckdb bundled --no-serve`
   then `node scripts/shot.js next_watch <path> 1400` and READ the png.
4. **Re-read every string on the page and cut it again.** Complaint 5 is a repeat offence.
5. **Verify the genre picker and timeline actually filter** the grid, the swipe deck and the results —
   they are wired but have NEVER been rendered or clicked.
6. **Then** re-run `node scripts/stress.js` and the rater.

### Still unbuilt from the charter
- Provider marks on `works_together` — recorded as a deliberate cut (that page has no custom component;
  adding them means replacing Lloyd's renderer, which the style ruling forbids). **Re-open this** given
  complaint 6; it may be one of the "features I asked for".
- Ratings-CSV import — charter permits cutting.
- **Re-read the charter's F1–F6 line by line against the built page.** Complaint 6 says something is
  missing and the specific item was never named.

---

## 4. HOW TO WORK ON THIS

- **Servers:** local site on `http://127.0.0.1:8810` (`scratchpad/serve-fork.py`); it will be dead after a
  restart — restart it before screenshotting.
- **Push:** `bash scripts/push.sh` — the harness blocks a bare `git push`; this button is authorised and
  refuses on detached HEAD, an upstream remote, or a tracked credential path.
- **Screenshots:** `scripts/shot.js` waits for real content. Headless Chrome AND Firefox both capture
  before the WASM query returns, so a plain `--screenshot` photographs an empty page.
- **Skill:** `work/.claude/skills/data-site` holds every trap this stack produces. Load it.
- **Style ruling:** match Lloyd's visual system exactly; never import our house style. "Better means MORE,
  not DIFFERENT."
- **Malloy traps that cost time this session** (all silent): an empty given matches EVERYTHING;
  `not (x ~ $G)` returns zero rows; `OR` across a join field and a candidate field returns zero rows; the
  runtime caps results at 5,000 rows whatever `limit` says.

---

## 5. THE ONE THING NOT TO REPEAT

Every serious bug this session **printed a plausible result instead of failing**, and every green test
suite missed them. Before showing him anything: bundle it, screenshot it, and read the screenshot as a
stranger would. He is judging the page, not the changelog.
