
// Adversarial test run. Tries to BREAK the site rather than confirm it works.
// Every page, mobile, dark mode, every credential level, hostile URL params,
// special characters in drill values, and internal link resolution.
// Fails loudly on: console errors, NaN/undefined/Infinity in rendered text,
// horizontal scroll, or a page that never populates.
//   node scripts/stress.js [baseUrl]
const { chromium } = require("playwright-core");
const BASE = process.argv[2] || "http://127.0.0.1:8810";
const PAGES = ["index", "genre_pairs", "next_watch", "works_together"];
// Only these render posters. `index` is a landing list and `works_together`
// uses Malloy's table renderer, so demanding images of them was the harness
// being wrong about the site, not the site being broken.
const POSTER_PAGES = new Set(["genre_pairs", "next_watch"]);

// ⛔ THE CONSTANTS BELOW ARE A CONTRACT, AND THIS ASSERTS THEY STILL MATCH THE
// SOURCE. The card-size checks recompute what the CSS intends rather than using
// a magic ratio, which stops a CSS-only shrink from passing. But the numbers
// were a hand copy in this file, so weakening the HARNESS alone would have gone
// green and undetectable — the "threshold parked below what the code does" trap
// wearing its third disguise. Parsing the source and requiring agreement means:
// a CSS-only change fails (rendered < intent), a harness-only change fails
// (here), and changing both is a deliberate edit visible in one diff.
const CARD_INTENT = { wideVh: 0.82, wideMax: 820, wideReserve: 145,
                      narrowVh: 0.78, narrowMax: 660, narrowReserve: 220 };
(function assertCardIntentMatchesSource() {
  const src = require("fs").readFileSync(__dirname + "/../dashboards/next_watch.jsx", "utf8");
  const grab = (name) => {
    const m = src.match(new RegExp(name + '\\s*=\\s*"min\\((\\d+)vh,\\s*(\\d+)px,\\s*calc\\(100vh - (\\d+)px\\)\\)"'));
    return m ? { vh: +m[1] / 100, max: +m[2], reserve: +m[3] } : null;
  };
  const w = grab("CARD_H_WIDE"), n = grab("CARD_H_NARROW");
  const bad = [];
  if (!w) bad.push("could not parse CARD_H_WIDE from the component");
  else if (w.vh !== CARD_INTENT.wideVh || w.max !== CARD_INTENT.wideMax || w.reserve !== CARD_INTENT.wideReserve)
    bad.push(`CARD_H_WIDE is ${w.vh * 100}vh/${w.max}px/${w.reserve}px, harness expects ${CARD_INTENT.wideVh * 100}vh/${CARD_INTENT.wideMax}px/${CARD_INTENT.wideReserve}px`);
  if (!n) bad.push("could not parse CARD_H_NARROW from the component");
  else if (n.vh !== CARD_INTENT.narrowVh || n.max !== CARD_INTENT.narrowMax || n.reserve !== CARD_INTENT.narrowReserve)
    bad.push(`CARD_H_NARROW is ${n.vh * 100}vh/${n.max}px/${n.reserve}px, harness expects ${CARD_INTENT.narrowVh * 100}vh/${CARD_INTENT.narrowMax}px/${CARD_INTENT.narrowReserve}px`);
  if (bad.length) {
    console.log("\nCARD-SIZE CONTRACT BROKEN — the component and this suite disagree:");
    bad.forEach((b) => console.log("  " + b));
    console.log("If the change is intended, update BOTH deliberately.\n");
    process.exit(1);
  }
})();

const fails = [];
const note = (t, m) => { fails.push(`${t}: ${m}`); console.log(`  FAIL  ${t} - ${m}`); };
const ok = (t) => console.log(`  ok    ${t}`);
const POISON = /\bNaN\b|\bundefined\b|\bInfinity\b|\[object Object\]|&quot;|NaN%/;

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
    const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
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
    const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
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
    const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
    await p.goto(BASE + "/genre_pairs.html" + q, { waitUntil: "domcontentloaded", timeout: 90000 }).catch(() => {});
    await check(p, "hostile/" + label, { expectData: false });
    await p.close();
  }

  console.log("\n[6] the recommender actually produces a list");
  {
    const p = await b.newPage({ viewport: { width: 1440, height: 1100 } });
    await p.goto(BASE + "/next_watch.html", { waitUntil: "domcontentloaded", timeout: 120000 });
    await p.waitForTimeout(16000);
    const tiles = await p.locator('img[alt^="Poster for"]').all();
    for (const t of tiles.slice(0, 5)) { await t.click(); await p.waitForTimeout(250); }
    await p.waitForTimeout(9000);
    const txt = await p.evaluate(() => document.body.innerText);
    // Keyed on the COUNTS, not on the sentence. The first version matched the
    // literal "N suggestions from N ratings" and went red the moment that copy
    // was cut, reporting a broken recommender that was working perfectly --
    // a harness that lies in the other direction is still a harness that lies.
    const m = txt.match(/(\d+) from (\d+) rating/);
    if (!m || Number(m[1]) === 0) note("recommender", "rated 5 titles and got no suggestions");
    else ok("recommender (" + m[0] + ")");
    // swipe mode must respond to the keyboard, not just to clicks
    await p.getByRole("button", { name: "Swipe" }).click();
    await p.waitForTimeout(1200);
    await p.keyboard.press("ArrowRight");
    await p.waitForTimeout(2500);
    const t2 = await p.evaluate(() => document.body.innerText);
    if (!/liked ·/.test(t2)) note("swipe", "arrow key did not register a rating");
    else ok("swipe keyboard");
    await p.close();
  }

  console.log("\n[6b] the defects a green suite once missed");
  {
    // The suite was green while three blocking bugs were live: the rec list
    // rendered 28 posterless boxes, search was case-sensitive, and provider
    // marks reached 6 of 48 posters. A suite that cannot see the actual product
    // failing is worse than none, so each is now asserted directly.
    const p = await b.newPage({ viewport: { width: 1440, height: 1100 } });
    await p.goto(BASE + "/next_watch.html", { waitUntil: "domcontentloaded", timeout: 120000 });
    await p.waitForTimeout(17000);

    const marks = await p.evaluate(() => ({
      tiles: document.querySelectorAll('img[alt^="Poster for"]').length,
      logos: [...document.querySelectorAll("img")].filter((i) => i.getAttribute("width") === "16").length,
    }));
    if (marks.tiles >= 20 && marks.logos < 20) note("provider-marks", `only ${marks.logos} logos over ${marks.tiles} posters`);
    else ok(`provider marks (${marks.logos} logos / ${marks.tiles} posters)`);

    const tiles = await p.locator('img[alt^="Poster for"]').all();
    for (const t of tiles.slice(0, 5)) { await t.click(); await p.waitForTimeout(220); }
    await p.waitForTimeout(9000);
    const recImgs = await p.evaluate(() => {
      const h = [...document.querySelectorAll("div")].find((d) => d.innerText && d.innerText.startsWith("YOUR NEXT WATCH"));
      const sec = h ? h.parentElement : document;
      const imgs = [...sec.querySelectorAll('img[alt^="Poster for"]')];
      return { n: imgs.length, loaded: imgs.filter((i) => i.naturalWidth > 20).length };
    });
    if (recImgs.n && recImgs.loaded < recImgs.n * 0.8) note("rec-posters", `${recImgs.loaded}/${recImgs.n} rendered`);
    else ok(`rec list posters (${recImgs.loaded}/${recImgs.n})`);

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
    const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
    await p.goto(BASE + "/next_watch.html", { waitUntil: "domcontentloaded", timeout: 120000 });
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

    // 4. THE SWIPE MUST SWIPE, and the card must be BIG and ON SCREEN. It was
    // two buttons with tick glyphs; then it was 720px tall opening below the
    // fold, which is the same as invisible.
    await p.getByRole("button", { name: "Swipe" }).click();
    await p.waitForTimeout(1500);
    await p.getByRole("button", { name: "Films" }).click();
    await p.waitForTimeout(3500);
    const geom = await p.evaluate(() => {
      const c = document.querySelector('div[style*="aspect-ratio"]');
      if (!c) return null;
      const r = c.getBoundingClientRect();
      return { h: Math.round(r.height), top: Math.round(r.top), bottom: Math.round(r.bottom), vh: window.innerHeight };
    });
    if (!geom) note("swipe-card", "no card rendered");
    else {
      // ⛔ NO MAGIC THRESHOLD. The history of this number is the whole point: it
      // was 0.55, then 0.70 while the card sat at 0.82 — so when a later fix
      // shrank the card to 0.73, this check PASSED and certified the
      // regression. Raising it to 0.78 only moved the same trap 4 points.
      // So it no longer guesses: it recomputes what the CSS INTENDS —
      // min(82vh, 820px, 100vh - 145px) — and requires the card to actually be
      // that. A threshold cannot be parked below what the code does if it is
      // derived from what the code is supposed to do.
      const wantWide = Math.min(CARD_INTENT.wideVh * geom.vh, CARD_INTENT.wideMax, geom.vh - CARD_INTENT.wideReserve);
      if (geom.h < wantWide - 3) note("swipe-card", `card is ${geom.h}px where the CSS intends ${Math.round(wantWide)}px (${Math.round(geom.h / geom.vh * 100)}% of ${geom.vh})`);
      else ok(`card is ${geom.h}px of ${geom.vh} (nearly full screen)`);
      if (geom.top < 0 || geom.bottom > geom.vh + 2) note("swipe-card", `card runs off screen (${geom.top}..${geom.bottom} of ${geom.vh})`);
      else ok("card sits fully on screen");
    }
    // the affordance must be readable BEFORE the first click
    const hints = await p.evaluate(() =>
      [...document.querySelectorAll("span")].filter((s) => /^(✕ No|Yes ✓)$/.test(s.textContent.trim())).length);
    if (hints < 2) note("swipe-affordance", `${hints} of 2 half-labels visible before the first click`);
    else ok("both click-half labels are visible up front");

    if (geom) {
      const cx = (geom.top + geom.bottom) / 2;
      const card = p.locator('div[style*="aspect-ratio"]').first();
      const bb = await card.boundingBox();
      await p.mouse.move(bb.x + bb.width / 2, cx); await p.mouse.down();
      for (let i = 1; i <= 8; i++) { await p.mouse.move(bb.x + bb.width / 2 + i * 25, cx); await p.waitForTimeout(20); }
      await p.mouse.up();
      await p.waitForTimeout(2500);
      const liked = await p.evaluate(() => /1 liked/.test(document.body.innerText));
      if (!liked) note("swipe-drag", "dragging the card right did not record a like");
      else ok("drag right records a like");

      await p.mouse.click(bb.x + bb.width * 0.25, cx);
      await p.waitForTimeout(2500);
      const disliked = await p.evaluate(() => /1 not for you/.test(document.body.innerText));
      if (!disliked) note("swipe-halves", "clicking the left half did not record a dislike");
      else ok("clicking a half records a verdict");
    }

    // 5. A NO-MATCH SEARCH must say so. It rendered silent white space, which
    // makes a typo indistinguishable from a page that has stopped working.
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
    const g1 = p.locator('img[alt^="Poster for"]').first();
    if ((await g1.getAttribute("alt")) !== "Poster for Gladiator") {
      note("thin-rank", "could not seed the single-like case (Gladiator not first in search)");
    } else {
      await g1.click();
      await p.waitForTimeout(9000);
      const list = await p.evaluate(() => {
        const grids = [...document.querySelectorAll("div")].filter((d) =>
          d.style && d.style.gridTemplateColumns && d.style.gridTemplateColumns.includes("103px"));
        const last = grids[grids.length - 1];
        return [...last.children].map((c) => c.children[1] && c.children[1].textContent).filter(Boolean);
      });
      const FULL = ["Robin Hood", "King Arthur", "Kingdom of Heaven", "First Knight", "Exodus: Gods and Kings"];
      const top4 = list.slice(0, 4);
      const allFull = top4.length === 4 && top4.every((t) => FULL.indexOf(t) !== -1);
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
    const p2 = await b.newPage({ viewport: { width: 1440, height: 1200 } });
    const uploads = [];
    p2.on("request", (r) => { if (r.method() === "POST" || /upload/i.test(r.url())) uploads.push(r.url()); });
    await p2.goto(BASE + "/next_watch.html", { waitUntil: "domcontentloaded", timeout: 120000 });
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

    // 6. TMDB requires the JustWatch credit on EACH media item. It lived only
    // in a `title=` tooltip, which a touch device cannot open.
    const credit = await p.evaluate(() =>
      [...document.querySelectorAll("img")].filter((i) => /JustWatch/.test(i.getAttribute("alt") || "")).length);
    if (!credit) note("attribution", "per-item JustWatch credit is hover-only (unreachable on touch)");
    else ok(`per-item JustWatch credit is in alt text (${credit} marks)`);
    await p.close();
  }

  // The suite was GREEN over every one of these. `grep -i undo` returned zero
  // hits, nothing asserted that a person dislike was recorded, and the
  // card-on-screen check ran at 1440x900 only — never at the width where it
  // overflowed. Extending the suite for the KNOWN list is what let the same
  // class reopen.
  console.log("\n[6d] the swipe deck's DEFAULT mode, and the mobile fold");
  {
    const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
    await p.goto(BASE + "/next_watch.html", { waitUntil: "domcontentloaded", timeout: 120000 });
    await p.waitForTimeout(17000);
    await p.getByRole("button", { name: "Swipe" }).click();
    await p.waitForTimeout(2500);
    const name0 = await p.evaluate(() => {
      const c = document.querySelector('div[style*="aspect-ratio"]');
      return c && c.parentElement.children[1] ? c.parentElement.children[1].textContent : "";
    });
    // A LEFT SWIPE ON A PERSON REACHED NOTHING: state was set, no given was
    // written, the counter never moved. Half of every verdict the deck's
    // default mode collected was discarded in silence.
    await p.keyboard.press("ArrowLeft");
    await p.waitForTimeout(4000);
    let t = await p.evaluate(() => document.body.innerText);
    if (/nothing rated yet/.test(t)) note("person-dislike", "a left swipe on a person recorded nothing");
    else if (!/1 people/.test(t)) note("person-dislike", "the disliked person is not counted");
    else ok("a person dislike registers and is counted");
    // CHARTER F5 lists Undo under "design rules that are not optional", and the
    // deck OPENS on People — the one mode that had no Undo at all.
    if (!/Undo/.test(t)) note("person-undo", "People mode offers no Undo");
    else {
      await p.getByRole("button", { name: "Undo" }).click();
      await p.waitForTimeout(3000);
      const back = await p.evaluate(() => {
        const c = document.querySelector('div[style*="aspect-ratio"]');
        return c && c.parentElement.children[1] ? c.parentElement.children[1].textContent : "";
      });
      if (!/nothing rated yet/.test(await p.evaluate(() => document.body.innerText)))
        note("person-undo", "Undo did not reverse the person verdict");
      else if (back !== name0) note("person-undo", `Undo did not bring the card back (${back} != ${name0})`);
      else ok("Undo reverses a person verdict and restores the card");
    }
    // A modal with no keyboard exit is a trap.
    await p.getByRole("button", { name: "Grid" }).click();
    await p.waitForTimeout(2500);
    await p.locator('div[aria-label^="Open "]').first().click();
    await p.waitForTimeout(3500);
    await p.keyboard.press("Escape");
    await p.waitForTimeout(1500);
    if (await p.evaluate(() => /Availability data from/.test(document.body.innerText)))
      note("modal-escape", "Escape does not close the detail modal");
    else ok("Escape closes the detail modal");
    await p.close();

    // THE MOBILE FOLD. Sizing the card to fill the screen pushed the card's own
    // title, its skip button and its disclaimer BELOW the fold at 390x844.
    // ⚑ EMULATED, not merely narrow. The fold bug presented as emulation-only
    // and was written off once as an emulator artifact; it was a race between
    // the one-shot scrollIntoView and the swipe-mode relayout. A plain narrow
    // viewport does not reproduce it — `isMobile`/`hasTouch` does.
    const mctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const m = await mctx.newPage();
    await m.goto(BASE + "/next_watch.html", { waitUntil: "domcontentloaded", timeout: 120000 });
    await m.waitForTimeout(17000);
    await m.getByRole("button", { name: "Swipe" }).click();
    await m.waitForTimeout(4000);
    const geo = await m.evaluate(() => {
      const c = document.querySelector('div[style*="aspect-ratio"]');
      if (!c) return null;
      const r = c.getBoundingClientRect(), s = c.parentElement.getBoundingClientRect();
      return { w: Math.round(r.width), h: Math.round(r.height), bot: Math.round(s.bottom),
               vh: window.innerHeight, vw: window.innerWidth };
    });
    if (!geo) note("mobile-stage", "no card rendered at 390x844 (emulated)");
    else {
      if (geo.bot > geo.vh) note("mobile-stage", `the stage runs ${geo.bot - geo.vh}px past the fold (name/skip/disclaimer hidden)`);
      else ok(`the whole mobile stage fits the fold (${geo.bot} of ${geo.vh}, emulated)`);
      if (geo.w < geo.vw * 0.85) note("mobile-stage", `card is only ${Math.round(geo.w / geo.vw * 100)}% of width, not near-full-bleed`);
      else ok(`the mobile card is near-full-bleed (${Math.round(geo.w / geo.vw * 100)}% of width)`);
      // Same rule as the desktop check, and for the same reason: 0.70 against
      // an actual 0.725 was the identical trap one level down. Derived from the
      // CSS intent, min(78vh, 660px, 100vh - 220px), not from a round number.
      const wantNarrow = Math.min(CARD_INTENT.narrowVh * geo.vh, CARD_INTENT.narrowMax, geo.vh - CARD_INTENT.narrowReserve);
      if (geo.h < wantNarrow - 3) note("mobile-stage", `mobile card is ${geo.h}px where the CSS intends ${Math.round(wantNarrow)}px`);
      else ok(`the mobile card is the full intended ${geo.h}px (${Math.round(geo.h / geo.vh * 100)}% of viewport height)`);
    }
    await m.close(); await mctx.close();
  }

  // The class reopened in dimensions neither the suite nor the rater had ever
  // varied: the SIGN of the profile, a viewport MATRIX rather than two widths,
  // and session HISTORY (a stale closure that reproduced 6/6 on one path and
  // 0/4 on a clean one). Vary those here, not just the known list.
  console.log("\n[6e] profile sign, session history, viewport matrix, and swipe feel");
  {
    const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
    await p.goto(BASE + "/next_watch.html", { waitUntil: "domcontentloaded", timeout: 120000 });
    await p.waitForTimeout(17000);
    await p.getByRole("button", { name: "Swipe" }).click();
    await p.waitForTimeout(2500);

    // A DISLIKE-ONLY PROFILE. One real left-half click from cold took the list
    // from 28 tiles to 0, printed "Nothing matches those filters." with no
    // filter set, and unmounted the export — on the most natural first gesture
    // the deck offers.
    const cardBox = await p.locator('div[style*="aspect-ratio"]').first().boundingBox();
    await p.mouse.click(cardBox.x + cardBox.width * 0.25, cardBox.y + cardBox.height / 2);
    await p.waitForTimeout(7000);
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
    await p.getByRole("button", { name: "Grid" }).click(); await p.waitForTimeout(2000);
    await p.locator('div[aria-label^="Open "]').first().click(); await p.waitForTimeout(3000);
    await p.keyboard.press("Escape"); await p.waitForTimeout(1200);
    await p.getByRole("button", { name: "Swipe" }).click(); await p.waitForTimeout(2500);
    const cA = await p.evaluate(() => (document.body.innerText.match(/\d+ liked · \d+ not for you/) || [""])[0]);
    await p.getByRole("button", { name: "Grid" }).click(); await p.waitForTimeout(2000);
    await p.locator('div[aria-label^="Open "]').first().click(); await p.waitForTimeout(3000);
    for (let i = 0; i < 4; i++) { await p.keyboard.press("ArrowRight"); await p.waitForTimeout(350); }
    await p.waitForTimeout(2500);
    const cB = await p.evaluate(() => (document.body.innerText.match(/\d+ liked · \d+ not for you/) || [""])[0]);
    if (cA !== cB) note("modal-keys", `arrow keys rated the card behind the modal (${cA} -> ${cB})`);
    else ok("arrow keys do not leak through the detail modal");
    await p.close();

    // SWIPE FEEL. Andrew: "the image of the actor moves away, then comes back,
    // then lags for a moment, THEN it changes." Sample every frame: once the
    // outgoing card has flown out, it must never return to centre.
    const f = await b.newPage({ viewport: { width: 1440, height: 900 } });
    await f.goto(BASE + "/next_watch.html", { waitUntil: "domcontentloaded", timeout: 120000 });
    await f.waitForTimeout(17000);
    await f.getByRole("button", { name: "Swipe" }).click();
    await f.waitForTimeout(3000);
    await f.evaluate(() => {
      window.__s = []; const t0 = performance.now();
      const tick = () => {
        const c = document.querySelector('div[style*="aspect-ratio"]');
        if (c) {
          const m = new DOMMatrixReadOnly(getComputedStyle(c).transform);
          const img = c.querySelector("img");
          window.__s.push({ t: Math.round(performance.now() - t0), x: Math.round(m.m41),
            name: c.parentElement.children[1] ? c.parentElement.children[1].textContent : "",
            ready: !!(img && img.complete && img.naturalWidth > 20) });
        }
        if (performance.now() - t0 < 2200) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    const fb = await f.locator('div[style*="aspect-ratio"]').first().boundingBox();
    await f.mouse.click(fb.x + fb.width * 0.75, fb.y + fb.height / 2);
    await f.waitForTimeout(2600);
    const samples = await f.evaluate(() => window.__s);
    const firstName = samples[0].name;
    let flown = false, bounced = false;
    for (const s of samples) {
      if (s.name === firstName && Math.abs(s.x) > 200) flown = true;
      if (flown && s.name === firstName && Math.abs(s.x) < 50) { bounced = true; break; }
    }
    const settled = samples.find((s) => s.name !== firstName && s.ready && Math.abs(s.x) < 20);
    if (bounced) note("swipe-feel", "the outgoing card flies out and then animates BACK before the next one arrives");
    else if (!settled) note("swipe-feel", "the next card never settled with a decoded image inside 2.2s");
    else if (settled.t > 1200) note("swipe-feel", `the next card took ${settled.t}ms to settle`);
    else ok(`the swipe swaps cleanly, next card decoded in ${settled.t}ms`);
    await f.close();

    // VIEWPORT MATRIX, not two widths. The disclaimer the charter requires on
    // screen was clipped at four common desktop sizes that were never checked.
    for (const [w, h] of [[1366, 768], [1280, 720], [1024, 768], [414, 896]]) {
      const q = await b.newPage({ viewport: { width: w, height: h } });
      await q.goto(BASE + "/next_watch.html", { waitUntil: "domcontentloaded", timeout: 120000 });
      await q.waitForTimeout(17000);
      await q.getByRole("button", { name: "Swipe" }).click();
      await q.waitForTimeout(4000);
      const g = await q.evaluate(() => {
        const c = document.querySelector('div[style*="aspect-ratio"]');
        if (!c) return null;
        const s = c.parentElement.getBoundingClientRect();
        return { bot: Math.round(s.bottom), vh: window.innerHeight };
      });
      if (!g) note("fold-matrix", `${w}x${h}: no card rendered`);
      else if (g.bot > g.vh) note("fold-matrix", `${w}x${h}: stage runs ${g.bot - g.vh}px past the fold`);
      else ok(`${w}x${h}: whole stage above the fold (${g.bot}/${g.vh})`);
      await q.close();
    }
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
    const gp = await b.newPage({ viewport: { width: 1440, height: 1200 } });
    await gp.goto(BASE + "/genre_pairs.html", { waitUntil: "domcontentloaded", timeout: 120000 });
    await gp.waitForTimeout(20000);
    await gp.evaluate(async () => {
      for (let y = 0; y < document.body.scrollHeight; y += 500) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 100)); }
    });
    await gp.waitForTimeout(3000);
    const gpm = await gp.evaluate(() => ({
      posters: document.querySelectorAll('img[alt^="Poster for"]').length,
      logos: [...document.querySelectorAll("img")].filter((i) => /image\.tmdb\.org\/t\/p\/w45/.test(i.src)).length,
    }));
    if (gpm.posters >= 50 && gpm.logos < gpm.posters * 0.4)
      note("genre-pairs-marks", `only ${gpm.logos} provider marks over ${gpm.posters} posters on upstream's own page`);
    else ok(`genre_pairs carries provider marks (${gpm.logos} over ${gpm.posters} posters)`);
    await gp.close();

    // ⛔ "NOT SEEN" MUST SURVIVE A RATING. It was stored by mutating the seed
    // query's row; rating writes a given, the runtime re-runs its queries, the
    // fresh rows lack the mutation, and the skipped card returned ~2 swipes
    // later. Pure skipping never reproduced it — only skip INTERLEAVED with
    // rating does, which is what a real visitor does.
    const sk = await b.newPage({ viewport: { width: 1440, height: 900 } });
    await sk.goto(BASE + "/next_watch.html", { waitUntil: "domcontentloaded", timeout: 120000 });
    await sk.waitForTimeout(18000);
    await sk.getByRole("button", { name: "Swipe" }).click(); await sk.waitForTimeout(2000);
    await sk.getByRole("button", { name: "Films" }).click(); await sk.waitForTimeout(4000);
    const nameOf = () => sk.evaluate(() => {
      const c = document.querySelector('div[style*="aspect-ratio"]');
      return c ? c.parentElement.children[1].textContent : "";
    });
    const seq = [], skippedNames = new Set();
    for (let i = 0; i < 10; i++) {
      const n = await nameOf();
      seq.push(n);
      if (i % 2 === 0) { skippedNames.add(n); await sk.keyboard.press("ArrowDown"); }
      else { await sk.keyboard.press("ArrowRight"); }
      await sk.waitForTimeout(2100);
    }
    const returned = [...skippedNames].filter((s) => seq.filter((x) => x === s).length > 1);
    if (returned.length) note("skip-persist", `a skipped card came back after a rating: ${returned.join(", ")}`);
    else ok(`"not seen" survives interleaved ratings (${new Set(seq).size}/${seq.length} distinct)`);

    // Andrew: down arrow or space should mark unseen, like left/right rate.
    const before = await sk.evaluate(() => document.body.innerText);
    await sk.keyboard.press("Space");
    await sk.waitForTimeout(2200);
    const after = await sk.evaluate(() => document.body.innerText);
    const likes = (s) => (s.match(/(\d+) liked/) || [0, "0"])[1];
    if (likes(before) !== likes(after)) note("skip-keys", "Space recorded a rating instead of skipping");
    else ok("Space marks unseen without recording a verdict");
    await sk.close();
  }

  console.log("\n[7] internal links resolve");
  const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
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
