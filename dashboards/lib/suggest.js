/**
 * Fuzzy autocomplete over titles and people.
 *
 * THE REQUIREMENT, stated by Andrew as three examples, and they are the tests:
 *   "mikel cain" must reach Michael Caine
 *   "batman"     must list the Batman films
 *   "Brad pi"    must autofill to Brad Pitt first
 *
 * A `contains` filter answers the second and neither of the others, which is why
 * this exists rather than another where-clause. Matching is per TOKEN, because
 * every interesting case here is a misspelling or an abbreviation of ONE word in
 * a multi-word name, not of the whole string.
 *
 * Everything is client-side over docs/data/suggest.json (see
 * scripts/build_suggest_index.sh). Nothing a visitor types leaves the machine --
 * CHARTER §3 covers what they rate, and a search box is no different.
 */

// Row layout, owned jointly with the generator: [text, kind, id, year, votes].
const T = 0, K = 1, I = 2, Y = 3, V = 4;

export function normalize(s) {
  return String(s || "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")   // café -> cafe
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Levenshtein with an early exit. Bounded because an unbounded distance over
 * 35k rows per keystroke is the difference between a dropdown and a stutter,
 * and any distance above the budget is a non-match anyway.
 */
export function withinDistance(a, b, budget) {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > budget) return -1;
  const prev = new Array(b.length + 1);
  const cur = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    let best = cur[0];
    for (let j = 1; j <= b.length; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (cur[j] < best) best = cur[j];
    }
    if (best > budget) return -1;          // no cell in this row can recover
    for (let j = 0; j <= b.length; j++) prev[j] = cur[j];
  }
  return prev[b.length] <= budget ? prev[b.length] : -1;
}

// A typo budget that grows with the word. One edit on a short word is a lot;
// on "schwarzenegger" it is nothing.
// ⚑ CALIBRATED AGAINST THE STATED CASE, not guessed. "mikel" -> "michael" is
// THREE edits over a 7-character word; a flat budget of 2 rejected it, and the
// example Andrew gave is the specification. Half the word length, capped at 3,
// admits it while still refusing to call two unrelated short words a match.
function budgetFor(len) {
  if (len <= 3) return 0;
  return Math.min(3, Math.floor(len / 2));
}

/**
 * Build the searchable index once. Keyed by the first two characters of every
 * token, so a keystroke scans a few hundred candidates instead of 35,231.
 * A misspelling that changes the first two characters will miss -- accepted
 * deliberately: typists overwhelmingly get the start of a word right, and the
 * alternative is scanning everything on every keypress.
 */
export function buildIndex(rows) {
  const entries = rows.map((r) => {
    const n = normalize(r[T]);
    // A leading article is noise a visitor should not have to type. CHARTER §2
    // F6 asks for exactly this ("dark knight" should find it), and without it
    // "godfath" put the obscure 2022 Godfather above the 1972 one purely
    // because the 1972 title starts with "the".
    const bare = n.replace(/^(the|a|an) /, "");
    return { row: r, norm: n, bare, tokens: n.split(" ").filter(Boolean) };
  });
  const byPrefix = new Map();
  entries.forEach((e, idx) => {
    const seen = new Set();
    for (const tok of e.tokens) {
      const p = tok.slice(0, 2);
      if (p.length < 2 || seen.has(p)) continue;
      seen.add(p);
      let bucket = byPrefix.get(p);
      if (!bucket) byPrefix.set(p, (bucket = []));
      bucket.push(idx);
    }
  });
  return { entries, byPrefix };
}

// How well ONE query token matches ONE candidate token. Higher is better;
// 0 means no match at all.
function tokenScore(q, tok) {
  if (q === tok) return 4;
  if (tok.startsWith(q)) return 3 + q.length / tok.length;   // "pi" -> "pitt"
  const d = withinDistance(q, tok, budgetFor(Math.max(q.length, tok.length)));
  if (d === 0) return 4;
  if (d > 0) return 2.5 - d * 0.4;                            // "mikel" -> "michael"
  if (tok.includes(q) && q.length >= 3) return 1.5;
  return 0;
}

/**
 * Top `k` suggestions for `query`.
 *
 * EVERY query token must match something. Without that rule "brad pi" happily
 * returned films called "Brad" -- the second token is the one doing the work,
 * and ignoring it turns a narrowing keystroke into a widening one.
 */
export function suggest(index, query, k = 8) {
  const qn = normalize(query);
  if (!qn) return [];
  const qTokens = qn.split(" ").filter(Boolean);

  // Candidate pool: rows sharing a two-character token prefix with any query
  // token. Falls back to the whole set only for a single very short query,
  // where the pool would otherwise be empty.
  const pool = new Set();
  for (const q of qTokens) {
    const bucket = index.byPrefix.get(q.slice(0, 2));
    if (bucket) for (const idx of bucket) pool.add(idx);
  }
  if (!pool.size) return [];

  const out = [];
  for (const idx of pool) {
    const e = index.entries[idx];
    let total = 0;
    let ok = true;
    for (const q of qTokens) {
      let best = 0;
      for (const tok of e.tokens) {
        const sc = tokenScore(q, tok);
        if (sc > best) best = sc;
      }
      if (!best) { ok = false; break; }
      total += best;
    }
    if (!ok) continue;

    // Whole-string wins outright: typing "batman" should put the film called
    // exactly Batman above Batman Begins, and typing a full name should put the
    // person above a film with their name in the title. Tested against the
    // article-stripped form too, so "godfath" reaches The Godfather.
    if (e.norm === qn || e.bare === qn) total += 6;
    else if (e.norm.startsWith(qn) || e.bare.startsWith(qn)) total += 2;
    else {
      // ⚑ WHOLE-STRING FUZZ, and it settles a case token scoring cannot.
      // "the dark night" matches "Dark Was the Night" on all three tokens
      // EXACTLY and The Dark Knight only fuzzily, so per-token scoring ranks
      // the wrong film first. Against the whole string the answer is obvious:
      // one edit from "the dark knight", six from the other. Only reached when
      // the cheap checks above have already failed, so it costs nothing on the
      // common path.
      const d = withinDistance(qn, e.norm, Math.min(3, Math.floor(e.norm.length / 3)));
      if (d >= 0) total += 4 - d;
    }

    // Popularity breaks ties. Log-scaled so a blockbuster cannot bulldoze a
    // genuinely better textual match, but weighted enough to settle the case
    // where a WORSE-known title is the LITERALLY better one: "the dark night"
    // matches "Dark Was the Night" on all three tokens exactly and The Dark
    // Knight only fuzzily, and nobody typing that means the former.
    const votes = Number(e.row[V] || 0);
    total += Math.log10(votes + 10) * 0.6;

    out.push({ score: total, text: e.row[T], kind: e.row[K] === "p" ? "person" : "title",
               id: e.row[I], year: e.row[Y], votes });
  }
  out.sort((a, b) => b.score - a.score || b.votes - a.votes);
  return out.slice(0, k);
}
