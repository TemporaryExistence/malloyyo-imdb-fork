// Dev-only screenshot helper. Drives the LOCAL bundled site with the system
// Chrome and WAITS for the DuckDB-WASM query to actually finish before
// capturing -- a plain `--screenshot` fires before the async query returns and
// photographs an empty page, which is what made this site look broken during
// development when it was fine.
const { chromium } = require("playwright-core");

const [, , page = "value-ranking", out = "/home/andrew/.cache/degree-roi-shots/shot.png", h = "2000"] = process.argv;
const URL = `http://127.0.0.1:8810/${page}.html`;

(async () => {
  const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox"] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: +h }, deviceScaleFactor: 1 });
  const pg = await ctx.newPage();
  const errors = [];
  pg.on("console", (m) => m.type() === "error" && errors.push(m.text().slice(0, 200)));
  pg.on("pageerror", (e) => errors.push("pageerror: " + String(e).slice(0, 200)));
  await pg.goto(URL, { waitUntil: "networkidle", timeout: 90000 });
  // The tell that a query really returned: the parquet was fetched AND at least
  // one tile shows a non-zero figure. Poll rather than sleep a fixed amount.
  // The predicate must key on a STAT TILE, not on any dollar figure in the text.
  // The old one matched prose in the disclaimer and footnotes, so it reported
  // "clean" over a fully-zeroed page. Caught by the rater 2026-08-04 - a
  // verification harness that lies is worse than no harness.
  // This site renders POSTERS, not stat tiles. Waiting on rendered images is the
  // honest signal that the DuckDB-WASM query returned and the grid populated.
  try {
    await pg.waitForFunction(() => {
      const imgs = [...document.querySelectorAll("img")].filter((i) => i.naturalWidth > 20);
      return imgs.length >= 5;
    }, { timeout: 60000 });
  } catch { errors.push("TIMEOUT: fewer than 5 posters rendered"); }
  await pg.waitForTimeout(2500);
  await pg.screenshot({ path: out, fullPage: true });
  console.log(errors.length ? "CONSOLE ERRORS:\n" + errors.slice(0, 8).join("\n") : "clean (no console errors)");
  await browser.close();
})();
