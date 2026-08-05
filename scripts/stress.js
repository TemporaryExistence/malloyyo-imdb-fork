
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
    const m = txt.match(/(\d+) suggestions from (\d+) rating/);
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
