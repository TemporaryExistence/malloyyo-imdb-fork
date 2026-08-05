
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
      // 0.70, raised from 0.55 after the rater measured 74vh as "666 of 900"
      // and called the desktop card the single most likely repeat complaint.
      if (geom.h < geom.vh * 0.70) note("swipe-card", `card is ${geom.h}px of a ${geom.vh}px viewport, not nearly full screen`);
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

    // 6. TMDB requires the JustWatch credit on EACH media item. It lived only
    // in a `title=` tooltip, which a touch device cannot open.
    const credit = await p.evaluate(() =>
      [...document.querySelectorAll("img")].filter((i) => /JustWatch/.test(i.getAttribute("alt") || "")).length);
    if (!credit) note("attribution", "per-item JustWatch credit is hover-only (unreachable on touch)");
    else ok(`per-item JustWatch credit is in alt text (${credit} marks)`);
    await p.close();
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
