
// Adversarial test run. Tries to BREAK the site rather than confirm it works.
// Every page, mobile, dark mode, every credential level, hostile URL params,
// special characters in drill values, and internal link resolution.
// Fails loudly on: console errors, NaN/undefined/Infinity in rendered text,
// horizontal scroll, or a page that never populates.
//   node scripts/stress.js [baseUrl]
const { chromium } = require("playwright-core");
const BASE = process.argv[2] || "http://127.0.0.1:8810";

// Titles whose genre set is EXACTLY the genre set of `title`, read out of the
// built parquet with the duckdb CLI. Used instead of a hand-maintained list so
// a corpus change cannot turn a correct ranking into a red test (it did once).
function fullGenreMatches(title) {
  const { execFileSync } = require("child_process");
  const sql = `
    with g as (select genres from 'docs/imdb_titles.parquet'
               where primaryTitle = '${title.replace(/'/g, "''")}'
               order by numVotes desc limit 1)
    select t.primaryTitle from 'docs/imdb_titles.parquet' t, g
    where list_sort(t.genres) = list_sort(g.genres);`;
  try {
    const out = execFileSync(process.env.DUCKDB_BIN || "duckdb", ["-noheader", "-list", "-c", sql],
                             { encoding: "utf8" });
    return new Set(out.split("\n").map((x) => x.trim()).filter(Boolean));
  } catch (e) {
    // A missing duckdb must not silently turn this into a check that passes
    // whatever it is handed.
    console.log("  WARN  fullGenreMatches could not run duckdb - thin-rank will fail closed");
    return new Set();
  }
}
const PAGES = ["index", "genre_pairs", "next_watch", "works_together"];
// Only these render posters. `index` is a landing list and `works_together`
// uses Malloy's table renderer, so demanding images of them was the harness
// being wrong about the site, not the site being broken.
const POSTER_PAGES = new Set(["genre_pairs", "next_watch"]);

// ⛑ THE CARD-SIZE CONTRACT MOVED OUT WITH THE DECK (2026-08-06).
// It asserted `CARD_H_WIDE`/`CARD_H_NARROW` in `next_watch.jsx` matched this
// harness's intent. Those constants sized the SWIPE CARD, and the swipe deck
// left the fork for `../movie-swipe` (Watchpile) per CHARTER §7.2 — so the check
// had no subject left and failed on "could not parse", which is the contract
// working, not a regression.
// ⛔ IT WAS NOT TRANSPLANTED, and that is deliberate rather than an omission:
// Watchpile's `Card` does not use these constants (it sizes its own way), so
// copying the numbers across would assert a contract that project never agreed
// to. Standing up the equivalent check there is REAL WORK THAT HAS NOT BEEN
// DONE — recorded in Watchpile's notes rather than quietly implied by a deleted
// assertion. The rating-side assertions this suite carried ("not seen" survives
// interleaved ratings, undo, keyboard) are KEPT and now run against the grid and
// search, which is where those outcomes live now.

// ⛑ PAGE ISOLATION (2026-08-06). Ratings now persist to localStorage
// (`nwProfile.v1`), which every page in this suite SHARES because they are all
// `b.newPage()` on one browser. Without this, a page that rates something leaves
// the next page starting mid-profile — the list re-renders under the harness and
// assertions fail on "element never became stable", which is a suite artefact
// masquerading as a product defect. `addInitScript` runs before the page's own
// scripts on EVERY navigation, so a reload cannot resurrect a stale profile.
// ⛔ The persistence test deliberately does NOT use this — it needs the profile
// to survive its own reload. It clears once by hand instead.
const PROFILE_KEY = "nwProfile.v1";
async function cleanPage(b, viewport) {
  const p = await b.newPage({ viewport });
  await p.addInitScript((k) => { try { localStorage.removeItem(k); } catch (e) {} }, PROFILE_KEY);
  return p;
}

const fails = [];
const note = (t, m) => { fails.push(`${t}: ${m}`); console.log(`  FAIL  ${t} - ${m}`); };
const ok = (t) => console.log(`  ok    ${t}`);
// ⛔ `Infinity` MUST NOT MATCH A FILM TITLE. The corpus contains "Avengers: Infinity
// War", so a bare \bInfinity\b flagged a correct page the moment the crossover
// sections put that film on screen — a false failure that reads exactly like a real
// number-formatting bug. The poison form is Infinity STANDING ALONE as a value
// (optionally signed, optionally with a unit), never followed by another word.
// Same care is not needed for NaN/undefined: no title contains them.
const POISON = /\bNaN\b|\bundefined\b|[-+]?\bInfinity\b(?!\s+\p{L})|\[object Object\]|&quot;|NaN%/u;

async function check(page, label, opts) {
  opts = opts || {};
  const expectData = opts.expectData !== false;
  const errs = [];
  page.on("console", (m) => { if (m.type() === "error") errs.push(m.text().slice(0, 160)); });
  page.on("pageerror", (e) => errs.push("pageerror: " + String(e).slice(0, 160)));
  if (expectData) {
    await page.waitForFunction(
      () => [...document.querySelectorAll("img")].filter((i) => i.naturalWidth > 20).length >= 3,
      { timeout: 45000 }).catch(() => note(label, "never populated (fewer than 3 posters rendered)"));
  }
  await page.waitForTimeout(1400);
  const t = await page.evaluate(() => document.body.innerText);
  const m = t.match(POISON);
  if (m) note(label, "poison text rendered: " + JSON.stringify(m[0]));
  const hs = await page.evaluate(() =>
    document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  if (hs) note(label, "horizontal scroll");
  const real = errs.filter((e) => !/favicon|404 \(File not found\)/i.test(e));
  if (real.length) note(label, "console errors: " + real.slice(0, 2).join(" | "));
  if (!fails.some((f) => f.indexOf(label + ":") === 0)) ok(label);
}

const g = (v) => encodeURIComponent(JSON.stringify(v));

(async () => {
  const b = await chromium.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox"] });

  console.log("\n[1] every page, desktop 1440");
  for (const pg of PAGES) {
    const p = await cleanPage(b, { width: 1440, height: 1000 });
    await p.goto(BASE + "/" + pg + ".html", { waitUntil: "networkidle", timeout: 90000 });
    await check(p, "desktop/" + pg, { expectData: POSTER_PAGES.has(pg) });
    await p.close();
  }

  console.log("\n[2] every page, mobile 390");
  for (const pg of PAGES) {
    const p = await b.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await p.goto(BASE + "/" + pg + ".html", { waitUntil: "networkidle", timeout: 90000 });
    await check(p, "mobile/" + pg, { mobile: true, expectData: POSTER_PAGES.has(pg) });
    await p.close();
  }

  console.log("\n[3] dark mode");
  for (const pg of ["genre_pairs", "next_watch"]) {
    const p = await b.newPage({ viewport: { width: 1440, height: 1000 }, colorScheme: "dark" });
    await p.goto(BASE + "/" + pg + ".html", { waitUntil: "networkidle", timeout: 90000 });
    await check(p, "dark/" + pg);
    await p.close();
  }

  console.log("\n[4] every genre on the pairs page");
  const GENRES = ["Drama","Comedy","Action","Crime","Romance","Horror","Documentary","Western","Film-Noir","Talk-Show"];
  for (const g of GENRES) {
    const p = await cleanPage(b, { width: 1440, height: 1000 });
    await p.goto(BASE + "/genre_pairs.html?$GENRE=" + g, { waitUntil: "domcontentloaded", timeout: 90000 });
    await check(p, "genre/" + g, { expectData: false });
    await p.close();
  }

  console.log("\n[5] hostile / nonsense URL params");
  const HOSTILE = [
    ["bogus-genre",   "?$GENRE=NOT_A_GENRE"],
    ["sql-injection", "?$GENRE=" + encodeURIComponent("'; DROP TABLE titles; --")],
    ["xss-attempt",   "?$GENRE=" + encodeURIComponent("<script>alert(1)</script>")],
    ["bogus-name",    "?$NAME=" + encodeURIComponent("zzzz nobody")],
    ["empty-all",     "?$GENRE=&$NAME=&$LIKED="],
    ["param-flood",   "?" + "x=1&".repeat(200)],
  ];
  for (const [label, q] of HOSTILE) {
    const p = await cleanPage(b, { width: 1440, height: 1000 });
    await p.goto(BASE + "/genre_pairs.html" + q, { waitUntil: "domcontentloaded", timeout: 90000 }).catch(() => {});
    await check(p, "hostile/" + label, { expectData: false });
    await p.close();
  }

  console.log("\n[6] the recommender actually produces a list");
  {
    // ⛑ RETARGETED ACROSS THE PAGE SPLIT (2026-08-07). Rating and the list are no
    // longer the same page: rate.html collects verdicts, next_watch.html shows the
    // result. The assertion is unchanged in meaning — "rating produces a list" —
    // but it now has to CROSS the split to test it, which makes it a stronger check
    // than before: it also proves the profile survives the page boundary, which is
    // the one thing the split could plausibly break.
    // ⛔ Both pages are opened in the SAME browser context on purpose. The handoff
    // is localStorage; a fresh context per page would silently test nothing.
    // ⛔ NOT cleanPage(). `cleanPage` installs an addInitScript that removes
    // `nwProfile.v1` on EVERY navigation — correct for the isolated page checks,
    // fatal here: this phase's whole point is that the profile SURVIVES the hop
    // from rate.html to next_watch.html, and the init script wiped it mid-test.
    // It reported "next_watch reports nothing rated" — a suite artefact that reads
    // exactly like a broken product (the failure mode the cleanPage comment warns
    // about, arriving from the other direction). Clear once, by hand, then leave
    // storage alone. Same exemption the persistence test already takes.
    const p = await b.newPage({ viewport: { width: 1440, height: 1100 } });
    await p.goto(BASE + "/rate.html", { waitUntil: "domcontentloaded", timeout: 120000 });
    await p.evaluate(() => { try { localStorage.removeItem("nwProfile.v1"); } catch (e) {} });
    await p.reload({ waitUntil: "domcontentloaded", timeout: 120000 });
    await p.waitForTimeout(16000);
    // ⛔ CLICK THE CONTROL, NOT THE POSTER. The rateable element is the tile's
    // role=button wrapper (kit.jsx); the <img> inside it is overlaid by the mark
    // row, so Playwright reports "<div> intercepts pointer events" and retries
    // until it times out — which is how this phase hung on 2026-08-07. Targeting
    // the actual control is also the more honest test: it asserts the thing a
    // keyboard or screen-reader user reaches.
    const tiles = await p.locator('[role="button"][aria-label^="Rate "]').all();
    if (tiles.length < 5) note("rate-page", `only ${tiles.length} rateable tiles on rate.html`);
    for (const t of tiles.slice(0, 5)) { await t.click(); await p.waitForTimeout(300); }
    await p.waitForTimeout(3000);
    await p.goto(BASE + "/next_watch.html", { waitUntil: "domcontentloaded", timeout: 120000 });
    await p.waitForTimeout(14000);
    const txt = await p.evaluate(() => document.body.innerText);
    // The profile must have crossed. Without this, a next_watch showing its cold
    // "top rated" fallback would still satisfy the count check below and the split
    // could be quietly broken while the suite stayed green.
    if (!/Rated [1-9]\d* so far/.test(txt))
      note("profile-handoff", "rated on rate.html but next_watch.html reports nothing rated");
    else ok("profile crosses rate.html -> next_watch.html");
    // Keyed on the COUNTS, not on the sentence. The first version matched the
    // literal "N suggestions from N ratings" and went red the moment that copy
    // was cut, reporting a broken recommender that was working perfectly --
    // a harness that lies in the other direction is still a harness that lies.
    const m = txt.match(/(\d+) from (\d+) rating/);
    if (!m || Number(m[1]) === 0) note("recommender", "rated 5 titles and got no suggestions");
    else ok("recommender (" + m[0] + ")");
    // ⛑ RETARGETED FROM THE DECK TO THE GRID (2026-08-06). The assertion is
    // "rating must not be mouse-only", which is about RATING, not about swiping,
    // so it survives the deck's departure — it just has to point at where rating
    // happens now. The grid tile is a real focusable control; Enter toggles it.
    // ⛑ MOVED TO rate.html (2026-08-07). The assertion is "rating must not be
    // mouse-only", which is about RATING — so it follows rating to its new page
    // rather than being deleted because the Grid chip left next_watch. Deleting an
    // assertion because its UI moved is how coverage silently drops.
    await p.goto(BASE + "/rate.html", { waitUntil: "domcontentloaded", timeout: 120000 });
    await p.waitForTimeout(14000);
    await p.getByRole("button", { name: "Grid" }).click();
    await p.waitForTimeout(1200);
    const tile = p.locator('[role="button"][aria-label^="Rate "]').first();
    await tile.focus();
    await p.keyboard.press("Enter");
    await p.waitForTimeout(2500);
    const t2 = await p.evaluate(() => document.body.innerText);
    if (!/liked ·/.test(t2)) note("keyboard-rating", "Enter on a focused grid tile did not register a rating");
    else ok("rating from the keyboard (grid tile)");
    await p.close();
  }

  console.log("\n[6b] the defects a green suite once missed");
  {
    // The suite was green while three blocking bugs were live: the rec list
    // rendered 28 posterless boxes, search was case-sensitive, and provider
    // marks reached 6 of 48 posters. A suite that cannot see the actual product
    // failing is worse than none, so each is now asserted directly.
    // Plain newPage, not cleanPage: this phase now navigates between rate.html and
    // next_watch.html, and cleanPage's addInitScript would wipe the shared profile
    // on each hop (see [6]).
    const p = await b.newPage({ viewport: { width: 1440, height: 1100 } });
    await p.goto(BASE + "/next_watch.html", { waitUntil: "domcontentloaded", timeout: 120000 });
    await p.evaluate(() => { try { localStorage.removeItem("nwProfile.v1"); } catch (e) {} });
    await p.reload({ waitUntil: "domcontentloaded", timeout: 120000 });
    await p.waitForTimeout(17000);

    // ⚑ THE CONTRACT CHANGED ON 2026-08-05 AND SO DID THIS CHECK. The mark used
    // to be up to three provider logos sitting on the tile, so counting 16px
    // <img> elements measured it. It is now ONE glyph whose logos live in a
    // popover that is closed until hover -- so the old check counted zero and
    // called a working feature broken. What is asserted now is the mark itself
    // AND the licence term it must carry: TMDB requires JustWatch credited on
    // each media item, and a mark rendering without that credit is the failure
    // that actually matters.
    const marks = await p.evaluate(() => {
      const btns = [...document.querySelectorAll('button[aria-label^="Streaming on"]')];
      return {
        tiles: document.querySelectorAll('img[alt^="Poster for"]').length,
        glyphs: btns.length,
        credited: btns.filter((b) => /JustWatch/.test(b.getAttribute("aria-label") || "")).length,
      };
    });
    if (marks.tiles >= 20 && marks.glyphs < 20)
      note("provider-marks", `only ${marks.glyphs} streamable marks over ${marks.tiles} posters`);
    else if (marks.glyphs !== marks.credited)
      note("provider-marks", `${marks.glyphs - marks.credited} marks render with no JustWatch credit`);
    else ok(`streamable marks (${marks.glyphs} over ${marks.tiles} posters, all credited)`);

    // The mark must OPEN, and what it opens must be a real route rather than a
    // dead popover -- the whole feature is the reveal, not the glyph.
    const firstMark = p.locator('button[aria-label^="Streaming on"]').first();
    if (await firstMark.count()) {
      await firstMark.hover();
      await p.waitForTimeout(600);
      const pop = await p.evaluate(() => {
        const menu = document.querySelector('[role="menu"]');
        if (!menu) return null;
        const links = [...menu.querySelectorAll("a")];
        return { n: links.length, allHref: links.every((a) => a.href && /^https?:/.test(a.href)) };
      });
      if (!pop || !pop.n) note("provider-marks", "hovering the mark opens no service list");
      else if (!pop.allHref) note("provider-marks", "a service in the popover has no link to follow");
      else ok(`the mark opens ${pop.n} linked service(s)`);
    }

    // ⛑ RATING MOVED TO rate.html (2026-08-07 page split), and the tile's role=button
    // wrapper is the clickable control — the <img> is overlaid by the mark row, so
    // clicking it times out on "intercepts pointer events". Rate there, then come
    // back here for the recommendation-poster coverage check, which is next_watch's.
    await p.goto(BASE + "/rate.html", { waitUntil: "domcontentloaded", timeout: 120000 });
    await p.waitForTimeout(14000);
    const tiles = await p.locator('[role="button"][aria-label^="Rate "]').all();
    for (const t of tiles.slice(0, 5)) { await t.click(); await p.waitForTimeout(240); }
    await p.waitForTimeout(3000);
    await p.goto(BASE + "/next_watch.html", { waitUntil: "domcontentloaded", timeout: 120000 });
    await p.waitForTimeout(12000);
    // ⚑ SCROLL FIRST. The recommendation grid is far below the fold and its
    // posters are loading="lazy", so measuring naturalWidth without scrolling
    // counts images the browser deliberately never fetched: 19 of 28 "missing"
    // became 28 of 28 the moment the section was scrolled into view. The check
    // is about poster COVERAGE, not about lazy-loading working.
    await p.evaluate(async () => {
      for (let y = 0; y < document.body.scrollHeight; y += 400) {
        window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 120));
      }
    });
    await p.waitForTimeout(4000);
    const recImgs = await p.evaluate(() => {
      const h = [...document.querySelectorAll("div")].find((d) => d.innerText && d.innerText.startsWith("YOUR NEXT WATCH"));
      const sec = h ? h.parentElement : document;
      const imgs = [...sec.querySelectorAll('img[alt^="Poster for"]')];
      return { n: imgs.length, loaded: imgs.filter((i) => i.naturalWidth > 20).length };
    });
    if (recImgs.n && recImgs.loaded < recImgs.n * 0.8) note("rec-posters", `${recImgs.loaded}/${recImgs.n} rendered`);
    else ok(`rec list posters (${recImgs.loaded}/${recImgs.n})`);

    // Search is a RATING tool and moved to rate.html with the rest of the input side.
    await p.goto(BASE + "/rate.html", { waitUntil: "domcontentloaded", timeout: 120000 });
    await p.waitForTimeout(13000);
    await p.getByRole("button", { name: "Search" }).click();
    await p.waitForTimeout(400);
    const box = p.locator('input[placeholder*="Search"]');
    for (const q of ["batman", "dark knight"]) {
      await box.fill(q);
      await p.waitForTimeout(4000);
      const n = await p.evaluate(() => document.querySelectorAll('img[alt^="Poster for"]').length);
      if (n === 0) note("search-case", `lowercase "${q}" returned nothing`);
      else ok(`search lowercase "${q}" (${n})`);
    }
    await p.close();
  }

  // Every check below exists because the thing it asserts was BROKEN on
  // 2026-08-04 while this suite ran green. That is the rule: after an escaped
  // defect, add the assertion that would have caught it.
  console.log("\n[6c] the defects THIS session produced");
  {
    // ⛔ NOT cleanPage: this block now hops rate.html <-> next_watch.html (the
    // 2026-08-07 split), and cleanPage's addInitScript removes nwProfile.v1 on
    // EVERY navigation — it silently wiped the Gladiator like mid-test and the
    // thin-rank check then graded the COLD list, reporting a ranking failure that
    // was really the harness. Clear once, by hand.
    const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
    await p.goto(BASE + "/next_watch.html", { waitUntil: "domcontentloaded", timeout: 120000 });
    await p.evaluate((k) => { try { localStorage.removeItem(k); } catch (e) {} }, PROFILE_KEY);
    await p.reload({ waitUntil: "domcontentloaded", timeout: 120000 });
    await p.waitForTimeout(17000);

    // 1. QUERIES MUST RESOLVE, NOT JUST NOT-ERROR. A `genres.value` unnest in
    // the recommendation query never returned in DuckDB-WASM; because the
    // dashboard runs one query queue, EVERY control on the page came up empty
    // with no error and `loading` stuck true. The genre chips and the timeline
    // bars are the cheapest queries on the page, so if they are empty the
    // queue is wedged.
    const controls = await p.evaluate(() => {
      // the count sits in a nested span with NO separator, so the chip reads
      // "Drama14K" -- an anchored /Drama\s/ matched nothing and reported a
      // wedged queue over a working page
      const chips = [...document.querySelectorAll("button")].map((b) => (b.textContent || "").trim());
      const bars = document.querySelectorAll('div[title*="films"]').length;
      return { genres: chips.filter((t) => /^(Drama|Comedy|Action|Horror)\d/.test(t)).length, bars };
    });
    if (controls.genres < 4) note("query-queue", `genre chips did not populate (${controls.genres}) - the query queue is wedged`);
    else ok(`genre chips populate (${controls.genres} of the known 4)`);
    if (controls.bars < 10) note("query-queue", `timeline drew ${controls.bars} bars`);
    else ok(`timeline populates (${controls.bars} bars)`);

    // 2. COLD START. CHARTER §4: a defensible list from ZERO input. The
    // previous fix for "'Your next watch' is useless with no ratings" deleted
    // the section, which answers the complaint and breaks the charter.
    const cold = await p.evaluate(() => {
      const t = document.body.innerText;
      // "Open <title>" is the aria-label of the tile WRAPPER; the <img> inside
      // carries "Poster for <title>". Selecting the img by the wrapper's label
      // counted zero over a full list.
      return { labelled: /top rated/.test(t), tiles: document.querySelectorAll('div[aria-label^="Open "]').length };
    });
    if (!cold.labelled) note("cold-start", "the zero-rating list is not labelled for what it is");
    else if (cold.tiles < 10) note("cold-start", `only ${cold.tiles} titles with nothing rated`);
    else ok(`cold start lists ${cold.tiles} titles, honestly labelled`);

    // 3. EXPORT. CHARTER §1: "a list you cannot take with you was not delivered."
    const exp = await p.evaluate(() =>
      [...document.querySelectorAll("button")].filter((b) => /^Copy (link|list)$/.test(b.textContent)).length);
    if (exp < 2) note("export", `${exp} of 2 copy buttons present`);
    else ok("list is exportable (copy link + copy list)");

    // 4. ⛑ THE SWIPE ASSERTIONS LEFT WITH THE DECK (2026-08-06).
    // What stood here asserted the swipe CARD: that it is nearly full screen,
    // that it sits above the fold, that both click-half labels are readable
    // before the first click, that dragging right records a like and clicking
    // the left half records a dislike. Every one of those describes a swipe, and
    // the swipe deck moved to `../movie-swipe` (Watchpile) per CHARTER §7.2.
    // ⛔ THEY ARE OWED THERE, NOT DISCHARGED. Watchpile's `Card` is a different
    // component with its own sizing, so these could not be copied across as
    // written — porting them is REAL WORK THAT HAS NOT BEEN DONE. It is recorded
    // in Watchpile's notes so a green suite here is not mistaken for coverage
    // that exists somewhere. Deleting an assertion because its UI moved, without
    // saying where it went, is how coverage drops silently.
    // What is KEPT here is the rating-side half: the keyboard check above (now
    // against the grid), "not seen" surviving interleaved ratings, undo, and the
    // person-verdict check — all retargeted at the grid and search.

    // 5. A NO-MATCH SEARCH must say so. It rendered silent white space, which
    // makes a typo indistinguishable from a page that has stopped working.
    // Search is a rating tool and lives on rate.html since the 2026-08-07 split;
    // everything above this line is genuinely next_watch's (genre chips, timeline,
    // cold-start label, export, thin-rank), which is why this block stays split
    // across both pages instead of being retargeted wholesale.
    await p.goto(BASE + "/rate.html", { waitUntil: "domcontentloaded", timeout: 120000 });
    await p.waitForTimeout(14000);
    await p.getByRole("button", { name: "Search" }).click();
    await p.waitForTimeout(800);
    const sbox = p.locator('input[placeholder*="Search"]');
    await sbox.fill("zzzzqqq");
    await p.waitForTimeout(5000);
    if (!/Nothing matches/.test(await p.evaluate(() => document.body.innerText)))
      note("search-empty", "a no-match search renders nothing at all");
    else ok("a no-match search shows an empty state");
    await sbox.fill("batman");
    await p.waitForTimeout(5000);
    if (/Nothing matches/.test(await p.evaluate(() => document.body.innerText)))
      note("search-empty", "the empty state did not clear when results returned");
    else ok("the empty state clears when results return");

    // 7. THIN-PROFILE RANKING. With ONE liked title, genre_fit spans ~5% while
    // the cosine denominator spans ~47%, so the denominator decided the order:
    // The Counselor (genre_fit 5.74) ranked FIRST, above Kingdom of Heaven and
    // First Knight (both 6.03). Rating one title must put the FULL genre
    // matches on top. Asserted unconditionally — an earlier version of this
    // check used indexOf and silently passed when the title was absent.
    await sbox.fill("gladiator");
    await p.waitForTimeout(6000);
    // ⚑ DISMISS THE SUGGESTIONS FIRST. The autocomplete dropdown added on
    // 2026-08-05 is an overlay, so it sits on top of the first row of results --
    // Playwright refused to click the Gladiator poster because
    // "<span>Gladiator II</span> ... intercepts pointer events", and a real
    // visitor would hit the same thing: the suggestion, not the poster. Escape
    // closes it, which is the same key a person would reach for.
    await p.keyboard.press("Escape");
    await p.waitForTimeout(300);
    const g1 = p.locator('img[alt^="Poster for"]').first();
    if ((await g1.getAttribute("alt")) !== "Poster for Gladiator") {
      note("thin-rank", "could not seed the single-like case (Gladiator not first in search)");
    } else {
      await g1.click();
      await p.waitForTimeout(4000);
      // ⛑ SEED HERE, READ THERE (2026-08-07 split). The like is given on rate.html,
      // but the RANKING under test is the recommendation list, which is next_watch's.
      // Reading "the last 103px grid on the page" without moving returns the SEARCH
      // results instead — which is exactly what this check reported when it failed
      // with "Gladiator, Gladiator II, Gladiator": three search hits, not a ranking.
      await p.goto(BASE + "/next_watch.html", { waitUntil: "domcontentloaded", timeout: 120000 });
      await p.waitForTimeout(14000);
      const list = await p.evaluate(() => {
        const grids = [...document.querySelectorAll("div")].filter((d) =>
          d.style && d.style.gridTemplateColumns && d.style.gridTemplateColumns.includes("103px"));
        const last = grids[grids.length - 1];
        return [...last.children].map((c) => c.children[1] && c.children[1].textContent).filter(Boolean);
      });
      // ⛔ DERIVED, NOT PASTED. This used to be a hardcoded list of five titles
      // -- the full-genre matches as they happened to be when the check was
      // written. Removing television from the corpus (CHARTER §7.2) surfaced
      // The Dark Tower, which IS [Action, Adventure, Drama] exactly like
      // Gladiator, and the check called a correct result a regression. A list
      // of names asserts a moment; the property being tested is "shares every
      // one of the liked title's genres", so that is what is computed, from
      // the parquet, at run time.
      const FULL = fullGenreMatches("Gladiator");
      const top4 = list.slice(0, 4);
      const allFull = top4.length === 4 && top4.every((t) => FULL.has(t));
      if (!allFull) note("thin-rank", `top 4 from one like are not all full-genre matches: ${top4.join(", ")}`);
      else ok(`one like ranks full genre matches first (${top4.join(", ")})`);
      const cIdx = list.indexOf("The Counselor");
      if (cIdx !== -1 && cIdx < 5) note("thin-rank", `The Counselor is back at position ${cIdx} (short-vector bias)`);
      else ok("the short-vector bias is gone (The Counselor is not top-5)");
    }

    // 8. RATINGS IMPORT (CHARTER §4.2). The claim on screen is "nothing left
    // your browser" — so the test asserts the NETWORK, not just the message.
    // A Letterboxd file must be refused BY NAME; silently importing zero rows
    // from a file the user just handed us is the worst available outcome.
    const p2 = await cleanPage(b, { width: 1440, height: 1200 });
    const uploads = [];
    p2.on("request", (r) => { if (r.method() === "POST" || /upload/i.test(r.url())) uploads.push(r.url()); });
    // The IMDb import control moved to rate.html with the rest of the input side.
    await p2.goto(BASE + "/rate.html", { waitUntil: "domcontentloaded", timeout: 120000 });
    await p2.waitForTimeout(17000);
    const FIX = __dirname + "/../fixtures";
    await p2.locator("input[type=file]").setInputFiles(FIX + "/letterboxd.csv");
    await p2.waitForTimeout(2500);
    let it = await p2.evaluate(() => document.body.innerText);
    if (!/Letterboxd export/.test(it)) note("import", "a Letterboxd file was not refused by name");
    else if (!/nothing rated yet/.test(it)) note("import", "a refused file still changed the ratings");
    else ok("a Letterboxd file is refused by name and changes nothing");

    await p2.locator("input[type=file]").setInputFiles(FIX + "/imdb-ratings.csv");
    await p2.waitForTimeout(9000);
    it = await p2.evaluate(() => document.body.innerText);
    // 10, 9, 8 are likes; 2 is a dislike; the 6 is too weak to count either way
    if (!/Imported 4 ratings \(3 liked, 1 not for you\)/.test(it))
      note("import", "IMDb import did not apply the expected 3 likes / 1 dislike / 1 ignored");
    else ok("IMDb ratings.csv imports with the middling score correctly ignored");
    if (uploads.length) note("import", `the file was uploaded somewhere (${uploads.length} requests)`);
    else ok("the imported file never left the browser (0 uploads)");
    await p2.close();

    // 5b. FUZZY AUTOFILL ON LLOYD'S PEOPLE PAGE. He declared
    // `suggest{query=name_options dimension=name}` on the NAME given, so he
    // wanted suggestions; measured 2026-08-05 the datalist shipped with ONE
    // option and nothing appeared. Ours attaches to the input he already
    // renders (docs/assets/person-autofill.js) rather than replacing his table.
    // ⛑ IT IS ATTACHED BY scripts/postbuild.sh, which the bundler will undo
    // every time it regenerates docs/*.html. This check is what catches a build
    // that forgot to run it -- the failure is otherwise silent and looks like
    // "no matches".
    const wt = await cleanPage(b, { width: 1440, height: 1100 });
    await wt.goto(BASE + "/works_together.html", { waitUntil: "domcontentloaded", timeout: 120000 });
    await wt.waitForTimeout(20000);
    const wtIn = wt.locator('input[list="dash-options-NAME"]');
    if (!(await wtIn.count())) {
      note("person-autofill", "the NAME input is gone - upstream changed the control");
    } else {
      await wtIn.click();
      await wt.waitForTimeout(9000);
      const st = await wt.evaluate(() => (window.__personAutofill && window.__personAutofill.state()) || null);
      if (!st) note("person-autofill", "person-autofill.js is not on the page - did postbuild.sh run?");
      else if (!st.loaded || st.people < 10000)
        note("person-autofill", `the suggestion index did not load (${st.people} people)`);
      else {
        await wtIn.fill("");
        await wtIn.type("mikel cain", { delay: 35 });
        await wt.waitForTimeout(900);
        const opts = await wt.evaluate(() =>
          [...document.querySelectorAll('#person-autofill-list [role="option"]')].map((o) => o.textContent.trim()));
        if (opts[0] !== "Michael Caine")
          note("person-autofill", `"mikel cain" did not reach Michael Caine (got: ${opts.slice(0,3).join(", ") || "nothing"})`);
        else {
          // Filling the box is half the job; the page must actually re-query.
          await wt.keyboard.press("Enter");
          await wt.waitForTimeout(13000);
          const applied = await wt.evaluate(() => ({
            value: document.querySelector('input[list="dash-options-NAME"]').value,
            collaborators: /Christopher Nolan|Hans Zimmer|Wally Pfister/.test(document.body.innerText),
          }));
          if (applied.value !== "Michael Caine")
            note("person-autofill", `picking a suggestion did not set the input (${applied.value})`);
          else if (!applied.collaborators)
            note("person-autofill", "the input was set but the table never re-queried");
          else ok("fuzzy person autofill: \"mikel cain\" -> Michael Caine, and the table re-queried");
        }
      }
    }
    await wt.close();

    // 6. TMDB requires the JustWatch credit on EACH media item. It lived only
    // in a `title=` tooltip, which a touch device cannot open.
    // Reachable WITHOUT hover, by any of the routes that actually reach a
    // person: alt text on a visible image, an aria-label on a visible control,
    // or clipped-but-rendered text. What is forbidden is the credit existing
    // only inside something you have to hover to open.
    const credit = await p.evaluate(() => {
      const imgs = [...document.querySelectorAll("img")]
        .filter((i) => /JustWatch/.test(i.getAttribute("alt") || "")).length;
      const marks = [...document.querySelectorAll('button[aria-label*="JustWatch"]')]
        .filter((b) => b.offsetParent !== null).length;
      const inline = [...document.querySelectorAll('button[aria-label^="Streaming on"] span')]
        .filter((sp) => /JustWatch/.test(sp.textContent || "")).length;
      return { imgs, marks, inline };
    });
    if (!credit.imgs && !credit.marks) note("attribution", "per-item JustWatch credit is hover-only (unreachable on touch)");
    else if (!credit.inline && !credit.imgs) note("attribution", "the credit is only an aria-label - no rendered text carries it");
    else ok(`per-item JustWatch credit reachable without hover (${credit.marks} marks, ${credit.inline} with rendered text)`);
    await p.close();
  }

  // The suite was GREEN over every one of these. `grep -i undo` returned zero
  // hits, nothing asserted that a person dislike was recorded, and the
  // card-on-screen check ran at 1440x900 only — never at the width where it
  // overflowed. Extending the suite for the KNOWN list is what let the same
  // class reopen.
  console.log("\n[6d] the swipe deck's DEFAULT mode, and the mobile fold");
  {
    const p = await cleanPage(b, { width: 1440, height: 900 });
    // ⛑ RETARGETED TO rate.html (2026-08-07 page split): this block's subject is
    // RATING (grid / search / import / undo / "not seen" / persistence), and every
    // one of those controls moved to rate.html. The assertions are unchanged; only
    // the page that hosts the thing under test changed.
    await p.goto(BASE + "/rate.html", { waitUntil: "domcontentloaded", timeout: 120000 });
    await p.waitForTimeout(17000);
    // ⛑ RETARGETED FROM THE DECK TO SEARCH (2026-08-06). The DEFECT this guards
    // is not "a left swipe did nothing" — it is "a person DISLIKE reaches state
    // but never the model, so half of every person verdict is discarded in
    // silence" (CHARTER F5). That defect is about the person-rating PATH, which
    // still exists; only its UI moved. Rating a person now lives on the ✕/✓ marks
    // beside each search result, so the assertion points there.
    await p.getByRole("button", { name: "Search" }).click();
    await p.waitForTimeout(1200);
    await p.locator('input[placeholder*="Search"]').fill("Morgan Freeman");
    await p.waitForTimeout(9000);
    // ⛑ DISMISS THE AUTOFILL DROPDOWN FIRST. Typing opens the fuzzy suggestion
    // list, whose <li role="option"> overlays the People row — Playwright reported
    // "element is visible, enabled and stable" and then "…intercepts pointer
    // events", i.e. the button was fine and something was ON TOP of it. A real
    // visitor dismisses it the same way before clicking underneath, so this is the
    // honest interaction, not a workaround. (Diagnosed by reading the click log
    // rather than assuming instability — the first two guesses were both wrong.)
    await p.keyboard.press("Escape");
    await p.waitForTimeout(600);
    // ⛑ `data-rate="person"` rather than the aria-label alone: title marks carry
    // the SAME "Not for me: …" label shape, so a label-only selector picks
    // whichever is first in the DOM and would quietly assert the wrong surface.
    const dislikePerson = p.locator('button[data-rate="person"][aria-label^="Not for me: "]').first();
    if (!(await dislikePerson.count())) {
      note("person-dislike", "search results offer no way to rate a person — the person path is unreachable");
    } else {
      await dislikePerson.waitFor({ state: "visible", timeout: 30000 });
      // ⛑ WAIT FOR THE LAYOUT TO STOP MOVING, don't force the click. This page
      // re-queries on a debounce, so the People row can still be settling when the
      // element is already "visible" — Playwright then retries its actionability
      // check until it times out, which reads as a product failure and is not one
      // (measured: the button IS perfectly stable once the page quiesces).
      // `force: true` would "fix" it by asserting nothing about whether a real
      // person could click it, so instead: poll the element's own box until two
      // consecutive reads agree, then click normally.
      let prevBox = null, settled = false;
      for (let i = 0; i < 40; i++) {
        const box = await dislikePerson.boundingBox().catch(() => null);
        const key = box ? `${Math.round(box.x)},${Math.round(box.y)},${Math.round(box.width)}` : "none";
        if (key !== "none" && key === prevBox) { settled = true; break; }
        prevBox = key;
        await p.waitForTimeout(500);
      }
      if (!settled) note("person-dislike", "the person rate mark never acquired a stable box");
      await dislikePerson.scrollIntoViewIfNeeded().catch(() => {});
      await dislikePerson.click({ timeout: 30000 });
      await p.waitForTimeout(4000);
      let t = await p.evaluate(() => document.body.innerText);
      if (/nothing rated yet/.test(t)) note("person-dislike", "disliking a person from search recorded nothing");
      else if (!/1 people/.test(t)) note("person-dislike", "the disliked person is not counted");
      else ok("a person dislike registers and is counted (from search)");
      // CHARTER F5 lists Undo under "design rules that are not optional".
      if (!/Undo/.test(t)) note("person-undo", "a person verdict offers no Undo");
      else {
        await p.getByRole("button", { name: "Undo" }).click();
        await p.waitForTimeout(3000);
        if (!/nothing rated yet/.test(await p.evaluate(() => document.body.innerText)))
          note("person-undo", "Undo did not reverse the person verdict");
        else ok("Undo reverses a person verdict");
      }
    }
    // A modal with no keyboard exit is a trap.
    // ⛑ THE DETAIL MODAL STAYED ON next_watch (2026-08-07 split): it belongs to the
    // OUTPUT surface, and its opener is the recommendation tile, whose wrapper is
    // labelled "Open <title>". rate.html's tiles are labelled "Rate <title>" because
    // rating, not opening, is their job — so this check has to move to the page that
    // still has a modal rather than be dropped for lack of a selector.
    await p.goto(BASE + "/next_watch.html", { waitUntil: "domcontentloaded", timeout: 120000 });
    await p.waitForTimeout(15000);
    await p.locator('div[aria-label^="Open "]').first().click();
    await p.waitForTimeout(3500);
    await p.keyboard.press("Escape");
    await p.waitForTimeout(1500);
    if (await p.evaluate(() => /Availability data from/.test(document.body.innerText)))
      note("modal-escape", "Escape does not close the detail modal");
    else ok("Escape closes the detail modal");
    await p.close();

    // ⛑ THE MOBILE-FOLD BLOCK LEFT WITH THE DECK (2026-08-06). It asserted that
    // the swipe STAGE (card + its title + skip button + disclaimer) fits above
    // the fold at an EMULATED 390x844, and that the card is near-full-bleed. Both
    // describe the swipe card, which now lives in `../movie-swipe` (Watchpile).
    // ✅ DISCHARGED THERE 2026-08-06, RE-VERIFIED GREEN 2026-08-07 — this comment
    // said "owed, not discharged" and that is no longer true. Watchpile's
    // `scripts/smoke.cjs` DOES emulate a touch viewport now (`isMobile`/`hasTouch`
    // at 390x844) and both halves pass: "the whole mobile stage fits the fold
    // (844 of 844, emulated)" and "the mobile card is near-full-bleed (92% of
    // width)". It FAILED on its first run there at 124px past the fold, which is
    // the assertion earning its transfer rather than being copied green.
    // Do not re-implement it here — the subject is still Watchpile's card.
  }

  console.log("\n[6e] profile sign, session history, viewport matrix, and swipe feel");
  {
    const p = await cleanPage(b, { width: 1440, height: 900 });
    // ⛑ RETARGETED TO rate.html (2026-08-07 page split): this block's subject is
    // RATING (grid / search / import / undo / "not seen" / persistence), and every
    // one of those controls moved to rate.html. The assertions are unchanged; only
    // the page that hosts the thing under test changed.
    await p.goto(BASE + "/rate.html", { waitUntil: "domcontentloaded", timeout: 120000 });
    await p.waitForTimeout(17000);
    // A DISLIKE-ONLY PROFILE. One real dislike from cold took the list from 28
    // tiles to 0, printed "Nothing matches those filters." with no filter set,
    // and unmounted the export. ⛑ Retargeted 2026-08-06: the defect is about the
    // PROFILE having only negatives, not about how the negative was entered, so
    // it now uses the grid tile's ✕ mark. Same state, same assertion.
    await p.getByRole("button", { name: "Grid" }).click();
    await p.waitForTimeout(2500);
    await p.locator('button[data-rate="title"][aria-label^="Not for me: "]').first().click();
    await p.waitForTimeout(3500);
    // The dislike is ENTERED on rate.html; what the defect was about — the LIST
    // collapsing to zero and the export unmounting — is next_watch's surface. Both
    // halves are needed, so the check crosses the split rather than measuring the
    // rating page for tiles it was never supposed to have.
    await p.goto(BASE + "/next_watch.html", { waitUntil: "domcontentloaded", timeout: 120000 });
    await p.waitForTimeout(15000);
    const neg = await p.evaluate(() => ({
      tiles: document.querySelectorAll('div[aria-label^="Open "]').length,
      copy: [...document.querySelectorAll("button")].filter((x) => /^Copy (link|list)$/.test(x.textContent)).length,
      txt: document.body.innerText,
    }));
    if (neg.tiles < 10) note("negative-only", `a dislike-only profile left ${neg.tiles} tiles`);
    else if (neg.copy !== 2) note("negative-only", `the export vanished (${neg.copy}/2 copy buttons)`);
    else if (/Nothing matches those filters/.test(neg.txt)) note("negative-only", "claims a filter matched nothing when none is set");
    else ok(`a dislike-only profile keeps a list (${neg.tiles}) and its export`);

    // STALE CLOSURE: arrow keys leaking through the modal to rate the card
    // behind it. Needs the SESSION HISTORY that produced it, not a fresh load.
    // ⛑ Retargeted 2026-08-06. The defect class is "keys leak THROUGH the modal
    // and rate what is behind it", which the deck's arrow keys demonstrated; the
    // grid's Enter/Space are now the keys that could leak, so those are pressed.
    // The session-history part is preserved deliberately — the original bug was a
    // stale closure and reproduced only after a modal had already been opened and
    // closed once, so a fresh load would not have caught it.
    // ⛑ RE-EXPRESSED, NOT DELETED (2026-08-07 page split). The original pressed keys
    // through an open modal and asserted the RATING COUNTER behind it did not move.
    // After the split those two things are on different pages: the detail modal is
    // next_watch's, and next_watch has no rating controls or counter at all — so the
    // original interaction cannot be performed, and a test that cannot fail is worse
    // than no test.
    // What actually protects against the defect NOW is structural: the page that
    // owns the modal owns no way to rate. That is what is asserted, so if a future
    // change puts rating controls back onto next_watch this check goes red and the
    // key-leak class becomes reachable again.
    await p.goto(BASE + "/next_watch.html", { waitUntil: "domcontentloaded", timeout: 120000 });
    await p.waitForTimeout(15000);
    await p.locator('div[aria-label^="Open "]').first().click(); await p.waitForTimeout(3000);
    for (let i = 0; i < 4; i++) { await p.keyboard.press("Enter"); await p.waitForTimeout(300); }
    await p.waitForTimeout(2000);
    const leak = await p.evaluate(() => ({
      counter: /\d+ liked · \d+ not for you/.test(document.body.innerText),
      rateControls: document.querySelectorAll('[role="button"][aria-label^="Rate "], button[data-rate]').length,
      modalOpen: /Availability data from/.test(document.body.innerText),
    }));
    if (leak.rateControls > 0)
      note("modal-keys", `next_watch exposes ${leak.rateControls} rating control(s) behind its modal — the key-leak class is reachable again`);
    else if (leak.counter)
      note("modal-keys", "next_watch renders a rating counter, so it is a rating surface again");
    else ok("the modal's page owns no rating control, so keys cannot leak into a rating");
    await p.keyboard.press("Escape"); await p.waitForTimeout(1200);
    await p.close();

    // ⛑ SWIPE FEEL and the VIEWPORT FOLD MATRIX left with the deck (2026-08-06).
    // "Feel" sampled the outgoing card's transform every frame to prove it never
    // animates BACK to centre before the next card arrives (Andrew's "moves away,
    // then comes back, then lags"). The matrix re-ran the above-the-fold check at
    // 1366x768 / 1280x720 / 1024x768 / 414x896, because the original check ran at
    // 1440x900 only — never at a width where it overflowed.
    // ✅ BOTH DISCHARGED IN WATCHPILE, RE-VERIFIED GREEN 2026-08-07 (this comment
    // previously read "OWED, NOT DISCHARGED" — stale). They were the two most
    // valuable swipe assertions in this file: one caught a defect no static check
    // could see, the other caught the class "we only ever measured one viewport".
    // Both now live in `../movie-swipe/scripts/smoke.cjs` and pass there:
    //   feel   -> "the swipe swaps cleanly, next card decoded in 427ms"
    //   matrix -> 1366x768 / 1280x720 / 1024x768 / 414x896 all above the fold
    // Full run 2026-08-07: 23 checks, 0 failures. See ../movie-swipe/OWED-FROM-THE-FORK.md.
  }

  // All three of these were found by Andrew USING the live site, not by this
  // suite. Each is now asserted.
  console.log("\n[6f] what the suite missed and a user did not");
  {
    // ⛔ PROVIDER MARKS ON UPSTREAM'S OWN PAGE. [6b] only ever counted marks on
    // next_watch. genre_pairs is the page a visitor LANDS on, its availability
    // query returned one row per (title x kind x provider) with no collapse and
    // no limit — 220,963 rows against a 5,000-row runtime cap — and it rendered
    // 167 posters carrying THREE marks. Nothing errored.
    const gp = await cleanPage(b, { width: 1440, height: 1200 });
    await gp.goto(BASE + "/genre_pairs.html", { waitUntil: "domcontentloaded", timeout: 120000 });
    await gp.waitForTimeout(20000);
    await gp.evaluate(async () => {
      for (let y = 0; y < document.body.scrollHeight; y += 500) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 100)); }
    });
    await gp.waitForTimeout(3000);
    const gpm = await gp.evaluate(() => ({
      posters: document.querySelectorAll('img[alt^="Poster for"]').length,
      glyphs: document.querySelectorAll('button[aria-label^="Streaming on"]').length,
    }));
    if (gpm.posters >= 50 && gpm.glyphs < gpm.posters * 0.4)
      note("genre-pairs-marks", `only ${gpm.glyphs} streamable marks over ${gpm.posters} posters on upstream's own page`);
    else ok(`genre_pairs carries streamable marks (${gpm.glyphs} over ${gpm.posters} posters)`);
    await gp.close();

    // ⛔ THE ROW-CAP CANARY, and it is a named title rather than a percentage on
    // purpose. A coverage ratio cannot tell "the cap is hiding marks" from "these
    // films genuinely do not stream" — measured against the parquet, only 24 of
    // the 44 Film-Noir tiles have US streaming at all, so a 55% ratio there is
    // CORRECT and a threshold would have failed a working page.
    // The canary is The Thicket (tt4058618, 6,068 votes) — in the DEEPEST vote
    // band (d, under 8,675), so it can only carry a badge if the last band
    // query is working, and it fails the moment the bands collapse back into
    // one capped result.
    // ⚑ TWO REPLACEMENTS ON 2026-08-05, and the second one is the lesson.
    // Zorro (tt0050079) went first: it is a 1957 tvSeries, so removing
    // television (CHARTER §7.2) took the canary out of the corpus with it.
    // Comanche Station (tt0053729) replaced it — chosen as the lowest-ranked
    // streaming Western in the parquet — and FAILED, because the shelves show
    // only seven titles per subgenre and it never renders. That is exactly what
    // the note below already warned about, and picking from the data rather
    // than from the page walked into it anyway.
    // ⛔ SO: choose this from the titles the page ACTUALLY RENDERS, never from
    // the parquet alone. The selection is reproducible — scrape the rendered
    // tt ids off /genre_pairs.html?$GENRE=Western, join them to the streaming
    // set, and take the lowest-vote row that lands in band d.
    // (El Dorado was the first choice and is a better-known example of the bug,
    // but it never renders here — the shelves show seven per subgenre — and a
    // canary that is not on the page is a check that cannot fail for the right
    // reason.)
    const wn = await cleanPage(b, { width: 1440, height: 1200 });
    await wn.goto(BASE + "/genre_pairs.html?$GENRE=Western", { waitUntil: "domcontentloaded", timeout: 120000 });
    await wn.waitForTimeout(20000);
    await wn.evaluate(async () => {
      for (let y = 0; y < document.body.scrollHeight; y += 500) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 100)); }
    });
    await wn.waitForTimeout(3000);
    const canary = await wn.evaluate(() => {
      // The mark is now a SIBLING of the link, not a child of it -- an <a>
      // inside an <a> is invalid, so the tile was restructured. Look at the
      // tile wrapper, not at the anchor.
      const a = [...document.querySelectorAll('a[href*="tt4058618"]')][0];
      if (!a) return { found: false };
      const tile = a.parentElement;
      return { found: true, marked: !!(tile && tile.querySelector('button[aria-label^="Streaming on"]')) };
    });
    if (!canary.found) note("row-cap-canary", "The Thicket (tt4058618) not on the Western page — check the fixture, not the cap");
    else if (!canary.marked) note("row-cap-canary", "The Thicket has US streaming but no mark — the deepest vote band is not reaching the page");
    else ok("row-cap canary marked (The Thicket, 6068 votes, deepest band)");

    // A mark must not cover the caption it sits beside.
    const overlap = await wn.evaluate(() => {
      let n = 0;
      for (const a of document.querySelectorAll('a[href*="imdb.com/title/"]')) {
        const tile = a.parentElement;
        const mk = tile && tile.querySelector('button[aria-label^="Streaming on"]');
        if (!mk) continue;
        const m = mk.getBoundingClientRect();
        const cap = [...a.children].slice(1).map((c) => c.getBoundingClientRect()).find((c) => c.height > 0);
        if (cap && m.bottom > cap.top + 1) n++;
      }
      return n;
    });
    if (overlap) note("mark-overlap", `${overlap} provider marks cover the title/year caption`);
    else ok("no provider mark covers its caption");
    await wn.close();

    // ⛔ "NOT SEEN" MUST SURVIVE A RATING. It was stored by mutating the seed
    // query's row; rating writes a given, the runtime re-runs its queries, the
    // fresh rows lack the mutation, and the skipped card returned ~2 swipes
    // later. Pure skipping never reproduced it — only skip INTERLEAVED with
    // rating does, which is what a real visitor does.
    // ⛔ NOT `cleanPage`: this block ends by asserting that ratings SURVIVE a
    // reload, and an init-script clear would wipe them on that very reload and
    // report a persistence failure that is really the harness. It clears ONCE,
    // by hand, so the block still starts from an empty profile.
    const sk = await b.newPage({ viewport: { width: 1440, height: 900 } });
    // ⛑ RETARGETED TO rate.html (2026-08-07 page split): this block's subject is
    // RATING (grid / search / import / undo / "not seen" / persistence), and every
    // one of those controls moved to rate.html. The assertions are unchanged; only
    // the page that hosts the thing under test changed.
    await sk.goto(BASE + "/rate.html", { waitUntil: "domcontentloaded", timeout: 120000 });
    await sk.evaluate((k) => { try { localStorage.removeItem(k); } catch (e) {} }, PROFILE_KEY);
    await sk.reload({ waitUntil: "domcontentloaded", timeout: 120000 });
    await sk.waitForTimeout(18000);
    // ⛑ RETARGETED TO THE GRID (2026-08-06), and it is a SHARPER test of the same
    // defect. The bug was that "not seen" lived as a mutation on the seed query's
    // row, so rating anything re-ran the queries and the fresh rows arrived
    // without it. The deck version detected that indirectly (a skipped card came
    // back around). In the grid the mark is on the tile itself, so the assertion
    // can be direct: mark it unseen, rate something ELSE, and require the mark to
    // still be there after the re-query. Interleaving is still the point — pure
    // skipping never reproduced it.
    await sk.getByRole("button", { name: "Grid" }).click(); await sk.waitForTimeout(3000);

    const unseenMarks = sk.locator('button[data-rate="title"][aria-label^="Not seen: "]');
    if (!(await unseenMarks.count())) {
      note("skip-persist", 'the grid offers no "not seen" mark — the third outcome is unreachable');
    } else {
      const target = await unseenMarks.first().getAttribute("aria-label");
      await unseenMarks.first().click();
      await sk.waitForTimeout(1500);

      // Rate FIVE other titles, so the givens are written and the query set
      // genuinely re-runs between the mark and the check.
      const likes = sk.locator('button[data-rate="title"][aria-label^="Yes: "]');
      const n = Math.min(5, await likes.count());
      for (let i = 1; i <= n; i++) { await likes.nth(i).click(); await sk.waitForTimeout(700); }
      await sk.waitForTimeout(6000);

      const stillSet = await sk.evaluate((label) => {
        const b = [...document.querySelectorAll("button")].find((x) => x.getAttribute("aria-label") === label);
        return b ? b.getAttribute("aria-pressed") === "true" : null;
      }, target);
      if (stillSet === null) note("skip-persist", `the tile marked "${target}" vanished from the grid after rating`);
      else if (!stillSet) note("skip-persist", `"${target}" lost its "not seen" mark once other titles were rated`);
      else ok('"not seen" survives interleaved ratings (grid, verified on the tile itself)');

      // Andrew: the third outcome must be reachable and must NOT record a verdict.
      const before = await sk.evaluate(() => document.body.innerText);
      const another = unseenMarks.nth(1);
      if (await another.count()) {
        await another.click();
        await sk.waitForTimeout(2500);
        const after = await sk.evaluate(() => document.body.innerText);
        const likeCount = (t) => (t.match(/(\d+) liked/) || [0, "0"])[1];
        if (likeCount(before) !== likeCount(after)) note("skip-keys", '"not seen" recorded a rating instead of skipping');
        else ok('"not seen" marks unseen without recording a verdict');
      }
    }

    // ⛑ NEW 2026-08-06: RATINGS MUST SURVIVE A RELOAD. Until now they lived in
    // React state plus the URL givens and nothing else, so a refresh emptied the
    // profile — and the page split planned in NEXT-LAYOUT-WORK.md §3 was
    // justified on the premise that "the two halves already share state through
    // the URL and localStorage", which was only ever true of the SERVICE picker.
    // This asserts the persistence that premise assumed.
    const ratedBefore = await sk.evaluate(() => (document.body.innerText.match(/(\d+) liked/) || [0, "0"])[1]);
    await sk.reload({ waitUntil: "domcontentloaded", timeout: 120000 });
    await sk.waitForTimeout(18000);
    const ratedAfter = await sk.evaluate(() => (document.body.innerText.match(/(\d+) liked/) || [0, "0"])[1]);
    if (Number(ratedBefore) === 0) note("profile-persist", "nothing was rated, so the reload check proved nothing");
    else if (ratedAfter !== ratedBefore) note("profile-persist", `ratings did not survive a reload (${ratedBefore} liked -> ${ratedAfter})`);
    else ok(`ratings survive a reload (${ratedAfter} liked)`);

    await sk.close();
  }

  // ⛔ THE GREETING RULE. Andrew, 2026-08-07: "No user should ever be GREETED with a
  // 'rate what you've seen' tool. That is a total failure." The suite had 59 checks and
  // NONE of them looked at what a cold visitor is asked to do before they are given
  // anything — so three separate rating demands shipped: the site-nav label (rate.malloy's
  // artifact title, on EVERY page), next_watch's subtitle ("Rate a few things..."), and a
  // "Rated 0 so far" counter above the list. This is the missing check, not a new feature.
  // It is also CHARTER §4 stated as an assertion: a list from ZERO input is the main path.
  console.log("\n[6g] a cold visitor is GIVEN something before being asked for anything");
  {
    const p = await cleanPage(b, { width: 1440, height: 900 });
    await p.goto(BASE + "/next_watch.html", { waitUntil: "domcontentloaded", timeout: 120000 });
    await p.waitForTimeout(18000);
    const g = await p.evaluate(() => {
      const tile = document.querySelector('div[aria-label^="Open "]');
      const tileTop = tile ? tile.getBoundingClientRect().top + window.scrollY : null;
      const above = [];
      const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let n = w.nextNode(); n; n = w.nextNode()) {
        const t = (n.textContent || "").trim();
        if (!t) continue;
        const el = n.parentElement; if (!el) continue;
        const b2 = el.getBoundingClientRect();
        if (b2.width === 0 && b2.height === 0) continue;
        if (tileTop == null || b2.top + window.scrollY < tileTop) above.push(t);
      }
      return { tiles: document.querySelectorAll('div[aria-label^="Open "]').length,
               above, body: document.body.innerText };
    });
    if (!g.tiles) note("cold-greeting", "a cold visitor gets NO list at all (CHARTER §4)");
    else ok(`a cold visitor gets a list without doing anything (${g.tiles} tiles)`);
    // Deliberately IMPERATIVES only, not every string containing "rate": the list's own
    // caption ("top rated, until you rate something") DESCRIBES state and is honest. A
    // match-everything rule would push a future edit to delete a truthful label to go green.
    const nag = g.above.filter((t) => /^\s*(rate|tap what|tell (us|it)|pick what)\b/i.test(t));
    if (nag.length) note("cold-greeting", `rating instruction ABOVE the first film: ${JSON.stringify(nag.slice(0, 3))}`);
    else ok("nothing above the first film asks the visitor to rate");
    if (/Rated 0 so far/i.test(g.body)) note("cold-greeting", '"Rated 0 so far" shown to someone who rated nothing');
    else ok('no "Rated 0 so far" counter for a cold visitor');
    // ...and the fix must not become a dead end.
    if (!(await p.locator('a[href="./rate.html"]').count()))
      note("cold-greeting", "no route to rate.html at all — the greeting fix became a dead end");
    else ok("the rating route still exists, below the list");
    await p.close();
  }

  // ⚡ THE COLD-START CACHE, ASSERTED. Andrew, 2026-08-07: "make the site load all
  // titles/thumbnails/content right away for users who have not inserted any specific
  // preferences yet." docs/cold-start.json is built by scripts/build_cold_start.sh and
  // renders before DuckDB-WASM has booted (10.7s -> 1.5s on next_watch, 8.2s -> 1.9s
  // on rate). Three ways this silently rots, so three assertions:
  //   1. the cache 404s -> the .catch() degrades to the slow path and NOTHING looks
  //      broken, it is just slow again. That already happened once (the fetch was
  //      resolved against import.meta.url, i.e. docs/assets/, not the page).
  //   2. the cache is stale/empty -> a blank or wrong homepage.
  //   3. the hand-off breaks -> rating something empties the page while the engine
  //      boots. That also already happened: one gate instead of two.
  console.log("\n[6h] the cold page is INSTANT, and hands off to the engine");
  {
    const p = await cleanPage(b, { width: 1440, height: 1100 });
    const t0 = Date.now();
    await p.goto(BASE + "/next_watch.html", { waitUntil: "domcontentloaded", timeout: 120000 });
    let painted = null;
    for (let i = 0; i < 40; i++) {
      const n = await p.evaluate(() => document.querySelectorAll('div[aria-label^="Open "]').length);
      if (n >= 30) { painted = Date.now() - t0; break; }
      await p.waitForTimeout(250);
    }
    // 5s, not 1.5s: the bound is "before the engine could possibly have booted"
    // (~6s measured), so it fails on a REGRESSION rather than on a slow CI box.
    if (painted === null) note("cold-start", "next_watch never reached 30 tiles");
    else if (painted > 5000) note("cold-start", `next_watch took ${painted}ms to paint — the cache is not being used`);
    else ok(`next_watch paints a full cold page in ${painted}ms`);

    const cached = await p.evaluate(() => performance.getEntriesByType("resource")
      .filter((e) => /cold-start\.json/.test(e.name))
      .map((e) => ({ n: e.name, size: e.encodedBodySize || e.transferSize || 0 })));
    if (!cached.length) note("cold-start", "cold-start.json was never requested");
    else if (!cached.some((c) => c.size > 20000))
      note("cold-start", `cold-start.json returned ${JSON.stringify(cached)} — a 404 returns 0 bytes and degrades silently`);
    else ok(`cold-start.json served (${Math.round(cached[0].size / 1024)}KB)`);
    await p.close();

    // The hand-off. Rate on rate.html, return, and require the page NOT to go empty
    // while the engine is still starting.
    const q = await cleanPage(b, { width: 1440, height: 1100 });
    await q.goto(BASE + "/rate.html", { waitUntil: "domcontentloaded", timeout: 120000 });
    await q.waitForTimeout(6000);
    const yes = q.locator('button[data-rate="title"][aria-label^="Yes: "]').first();
    if (!(await yes.count())) note("cold-start", "rate.html offered no rating control within 6s");
    else {
      await yes.click();
      await q.waitForTimeout(3000);
      await q.goto(BASE + "/next_watch.html", { waitUntil: "domcontentloaded", timeout: 120000 });
      // ⛔ WAIT FOR THE FIRST PAINT BEFORE WATCHING FOR EMPTINESS. Sampling from t=0
      // counts the ordinary pre-mount frame — zero tiles because React has not run yet —
      // and reports "the list went EMPTY at ~0ms", which is the harness describing a
      // page load, not a defect. The claim under test is that the list must not go
      // empty AFTER it has had content, which is the regression a single gate caused.
      let painted2 = false;
      for (let i = 0; i < 40 && !painted2; i++) {
        painted2 = (await q.evaluate(() => document.querySelectorAll('div[aria-label^="Open "]').length)) > 0;
        if (!painted2) await q.waitForTimeout(500);
      }
      if (!painted2) note("cold-start", "after rating, next_watch never painted a single tile");
      else {
        let broke = null;
        for (let i = 0; i < 30; i++) {
          const st = await q.evaluate(() => ({
            tiles: document.querySelectorAll('div[aria-label^="Open "]').length,
            empty: /Nothing matches those filters/.test(document.body.innerText),
          }));
          if (st.tiles === 0 || st.empty) { broke = i * 500; break; }
          await q.waitForTimeout(500);
        }
        if (broke !== null) note("cold-start", `after rating, the list EMPTIED ${broke}ms after painting — the cache dropped before the engine answered`);
        else ok("after rating, the page never empties while the engine boots");
      }
    }
    await q.close();
  }

  console.log("\n[7] internal links resolve");
  const p = await cleanPage(b, { width: 1440, height: 1000 });
  await p.goto(BASE + "/index.html", { waitUntil: "networkidle", timeout: 90000 });
  const hrefs = await p.evaluate(() =>
    Array.from(document.querySelectorAll("a[href]")).map((a) => a.getAttribute("href"))
      .filter((h) => h && !/^https?:|^mailto:|^#/.test(h)));
  for (const h of Array.from(new Set(hrefs))) {
    const r = await p.request.get(BASE + "/" + h.replace(/^\.\//, "")).catch(() => null);
    if (!r || r.status() >= 400) note("links", h + " -> " + (r ? r.status() : "unreachable"));
  }
  if (!fails.some((f) => f.indexOf("links:") === 0)) ok("links (all internal hrefs resolve)");
  await p.close();

  await b.close();
  console.log("\n" + "=".repeat(58));
  console.log(fails.length ? fails.length + " FAILURE(S)\n" + fails.map((f) => " - " + f).join("\n")
                           : "ALL CHECKS PASSED - could not break it");
  process.exit(fails.length ? 1 : 0);
})();
