// @ts-nocheck
// Your next watch — rate a few things, get a list you can actually go and watch.
//
// Three ways in, because the charter's binding constraint is patience, not data:
//   GRID   multi-select posters. Breadth in one screen; yields likes only.
//   SWIPE  one card at a time, left/right. Slower per item but yields a SIGNED
//          signal — the grid cannot tell "I disliked it" from "I never saw it".
//   SEARCH for the visitor who already knows their three favourite films and
//          should not have to wait for us to guess them.
// Ratings live in React state and are written into the LIKED/DISLIKED givens,
// so scoring happens in DuckDB-WASM. Nothing a visitor taps leaves the page.
//
// Visual language is deliberately UPSTREAM'S — same INK tokens, same chip row,
// same poster tiles as genre_pairs. This is a fork; it should read as a
// continuation, not as someone else's design bolted on.
import React from "react";
import { filters, useGiven, useQuery } from "@malloyyo/dashboard";

/* ============================ shared viz kit ============================ */
/* copied from genre_pairs.jsx on purpose: jsx components are sandboxed, so
   there is no shared local module to import. Keep these in step with it.     */
const INK = {
  light: { surface: "#fcfcfb", track: "#eceff3", muted: "#898781", text: "#0b0b0b", text2: "#52514e", accent: "#2a78d6" },
  dark: { surface: "#1a1a19", track: "#26262b", muted: "#898781", text: "#ffffff", text2: "#c3c2b7", accent: "#4f9bff" },
};
const GOOD = "#1a7f5a", BAD = "#b4432c";

function relLum(c) {
  if (!c) return null;
  c = c.trim(); let r, g, b, m;
  if ((m = c.match(/^#([0-9a-f]{3})$/i))) { const h = m[1]; r = parseInt(h[0] + h[0], 16); g = parseInt(h[1] + h[1], 16); b = parseInt(h[2] + h[2], 16); }
  else if ((m = c.match(/^#([0-9a-f]{6})$/i))) { const h = m[1]; r = parseInt(h.slice(0, 2), 16); g = parseInt(h.slice(2, 4), 16); b = parseInt(h.slice(4, 6), 16); }
  else if ((m = c.match(/rgba?\(([^)]+)\)/i))) { const p = m[1].split(",").map((x) => parseFloat(x)); [r, g, b] = p; }
  else return null;
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}
function useTheme() {
  const [dark, setDark] = React.useState(false);
  React.useLayoutEffect(() => {
    const read = () => {
      const cs = getComputedStyle(document.body || document.documentElement);
      const lum = relLum(cs.getPropertyValue("--dash-fg"));
      setDark(lum != null ? lum > 0.5 : window.matchMedia("(prefers-color-scheme: dark)").matches);
    };
    read();
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", read);
    const obs = new MutationObserver(read);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "class", "style"] });
    return () => { mq.removeEventListener("change", read); obs.disconnect(); };
  }, []);
  return { dark, ink: dark ? INK.dark : INK.light };
}
const num = (x) => (x == null || x === "" ? 0 : +x);
const compact = (n) =>
  n >= 1e6 ? (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + "M" : n >= 1e3 ? Math.round(n / 1e3) + "K" : String(n);
/* ========================== end shared viz kit ========================= */

const TILE_W = 103;
const TYPE_LABEL = { movie: "Film", tvSeries: "Series", tvMiniSeries: "Mini-series", tvMovie: "TV film" };

/* --------------------------- provider marks (F1) ------------------------ */
// TMDB requires JustWatch attribution on EACH media item, so the mark and the
// credit travel together and neither renders without the other.
const LOGO = (p) => (p ? "https://image.tmdb.org/t/p/w45" + p : null);

function ProviderMark({ ink, offers }) {
  if (!offers || !offers.logos || !offers.logos.length) return null;
  return (
    <div title={`${offers.names} - source: JustWatch`}
         style={{ position: "absolute", right: 3, bottom: 3, display: "flex", gap: 2 }}>
      {offers.logos.map((p, i) => (
        <img key={i} src={LOGO(p)} alt="" width={16} height={16} loading="lazy"
             style={{ borderRadius: 3, boxShadow: "0 0 0 1px rgba(0,0,0,.35)", background: "#fff", display: "block" }} />
      ))}
    </div>
  );
}

function Availability({ ink, offers }) {
  if (!offers || !offers.length) {
    return <div style={{ color: ink.muted, fontSize: 12 }}>No US streaming, rental or purchase listed.</div>;
  }
  const KINDS = [["flatrate", "Stream"], ["free", "Free"], ["ads", "Free with ads"], ["rent", "Rent"], ["buy", "Buy"]];
  const link = offers.find((o) => o.link)?.link;
  return (
    <div style={{ display: "grid", gap: 8 }}>
      {KINDS.map(([k, label]) => {
        const rows = offers.filter((o) => o.offer_kind === k);
        if (!rows.length) return null;
        return (
          <div key={k} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ fontSize: 11, letterSpacing: ".06em", textTransform: "uppercase", color: ink.muted,
                           fontWeight: 700, minWidth: 92 }}>{label}</span>
            {rows.map((o, i) => (
              <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, color: ink.text2 }}>
                <img src={LOGO(o.logo_path)} alt="" width={18} height={18} loading="lazy"
                     style={{ borderRadius: 4, background: "#fff", display: "block" }} />
                {o.provider_name}
              </span>
            ))}
          </div>
        );
      })}
      <div style={{ fontSize: 11, color: ink.muted, borderTop: `1px solid ${ink.track}`, paddingTop: 6 }}>
        Availability data from <b>JustWatch</b>, via TMDB. US only.{" "}
        {link && <a href={link} target="_blank" rel="noopener noreferrer" style={{ color: ink.accent }}>Open on TMDB</a>}
      </div>
    </div>
  );
}

/* ------------------------------ poster tile ----------------------------- */
function Tile({ ink, row, verdict, onRate, offers, onOpen }) {
  const [bad, setBad] = React.useState(false);
  const frame = {
    width: TILE_W, height: 156, borderRadius: 6, display: "block",
    border: verdict === "up" ? `2px solid ${GOOD}` : verdict === "down" ? `2px solid ${BAD}` : `1px solid ${ink.track}`,
    background: ink.track, opacity: verdict === "down" ? 0.45 : 1,
    transition: "opacity .12s ease, border-color .12s ease",
  };
  return (
    <div style={{ width: TILE_W }}>
      {/* the primary interaction must not be mouse-only: swipe mode had keyboard
          support from the start, the grid did not */}
      <div role="button" tabIndex={0}
           aria-pressed={onRate ? verdict === "up" : undefined}
           aria-label={(onRate ? "Rate " : "Open ") + row.primary_title}
           style={{ position: "relative", cursor: "pointer", outlineOffset: 2 }}
           onKeyDown={(e) => {
             if (e.key === "Enter" || e.key === " ") {
               e.preventDefault();
               onRate ? onRate(verdict === "up" ? null : "up") : onOpen && onOpen();
             }
           }}
           onClick={() => (onRate ? onRate(verdict === "up" ? null : "up") : onOpen && onOpen())}>
        {row.poster && !bad
          ? <img src={row.poster} alt={`Poster for ${row.primary_title}`} width={TILE_W} height={156} loading="lazy"
                 onError={() => setBad(true)} style={{ ...frame, objectFit: "cover" }} />
          : <div style={{ ...frame, display: "flex", alignItems: "center", justifyContent: "center",
                          color: ink.muted, fontSize: 10, textAlign: "center", padding: 6 }}>{row.primary_title}</div>}
        <ProviderMark ink={ink} offers={offers} />
        {verdict === "up" && <Badge color={GOOD} ch="✓" />}
        {verdict === "down" && <Badge color={BAD} ch="✕" />}
      </div>
      <div style={{ fontSize: 12, fontWeight: 620, color: ink.text, marginTop: 5, lineHeight: 1.2 }}>{row.primary_title}</div>
      <div style={{ fontSize: 11, color: ink.muted, fontVariantNumeric: "tabular-nums" }}>
        {row.start_year ? Math.round(num(row.start_year)) : ""}
        {row.title_type && row.title_type !== "movie" ? ` · ${TYPE_LABEL[row.title_type] || row.title_type}` : ""}
        {row.num_votes ? ` · ${compact(num(row.num_votes))}` : ""}
      </div>
    </div>
  );
}
function Badge({ color, ch }) {
  return (
    <span style={{ position: "absolute", left: 3, top: 3, width: 17, height: 17, borderRadius: 9, background: color,
                   color: "#fff", fontSize: 11, lineHeight: "17px", textAlign: "center", fontWeight: 700 }}>{ch}</span>
  );
}

/* -------------------------------- dashboard ---------------------------- */
export default function Dashboard({ dashboard, givens }) {
  const { ink } = useTheme();
  const gLiked = useGiven("LIKED");
  const gDisliked = useGiven("DISLIKED");
  const gTitle = useGiven("TITLE");
  const gName = useGiven("NAME");
  const gPerson = useGiven("PERSON_EXACT");
  const gLikedPeople = useGiven("LIKED_PEOPLE");
  const gDetail = useGiven("DETAIL_ID");

  // verdicts: tconst -> 'up' | 'down'. The single source of truth for the UI;
  // the givens are derived from it so the engine and the screen cannot disagree.
  let [verdicts, setVerdicts] = React.useState({});
  const [mode, setMode] = React.useState("grid");
  const [deck, setDeck] = React.useState(0);
  const [open, setOpen] = React.useState(null);
  const [history, setHistory] = React.useState([]);
  const [q, setQ] = React.useState("");

  // Seed from the URL once, BEFORE the effects below start writing. Without
  // this a shared link opened to an empty page: the givens carried the ratings
  // but the UI state did not, and the first effect overwrote them with the
  // sentinel. A list you cannot reopen is a list you cannot share.
  const seeded = React.useRef(false);
  if (!seeded.current) {
    seeded.current = true;
    const fromGiven = (g) => {
      try { const v = filters.values(g.value); return Array.isArray(v) ? v.map(String) : []; }
      catch (e) { return []; }
    };
    const init = {};
    for (const t of fromGiven(gLiked)) if (t && t !== "__none__") init[t] = "up";
    for (const t of fromGiven(gDisliked)) if (t && t !== "__none__") init[t] = "down";
    if (Object.keys(init).length) verdicts = init;
  }

  const liked = React.useMemo(() => Object.keys(verdicts).filter((k) => verdicts[k] === "up"), [verdicts]);
  const disliked = React.useMemo(() => Object.keys(verdicts).filter((k) => verdicts[k] === "down"), [verdicts]);

  // push ratings into the model. filters.oneOf('') matches nothing, which is
  // what we want before anyone has rated anything.
  // "__none__" rather than "" — an empty filter matches everything and the
  // recommendation self-join then tries to score the whole corpus against the
  // whole corpus.
  React.useEffect(() => { gLiked.set(filters.oneOf(...(liked.length ? liked : ["__none__"]))); }, [liked.join(",")]);
  React.useEffect(() => { gDisliked.set(filters.oneOf(...(disliked.length ? disliked : ["__none__"]))); }, [disliked.join(",")]);

  const seeds = useQuery({ query: "seed_titles", givens });
  const recs = useQuery({ query: "recommendations", givens });
  const recsPeople = useQuery({ query: "recommendations_by_person", givens });
  const avail = useQuery({ query: "availability", givens });
  const detail = useQuery({ query: "availability_detail", givens });
  const found = useQuery({ query: "search_titles", givens });
  const people = useQuery({ query: "search_people", givens });
  const seedPeople = useQuery({ query: "seed_people", givens });
  const personTitles = useQuery({ query: "titles_by_person", givens });
  const [person, setPerson] = React.useState("");
  // Kept apart from title verdicts on purpose. A liked PERSON raises their
  // weight in the profile; it never marks their filmography as liked.
  const [peopleVerdicts, setPeopleVerdicts] = React.useState({});
  const likedPeople = React.useMemo(
    () => Object.keys(peopleVerdicts).filter((k) => peopleVerdicts[k] === "up"), [peopleVerdicts]);
  React.useEffect(() => {
    gLikedPeople.set(filters.oneOf(...(likedPeople.length ? likedPeople : ["__none__"])));
  }, [likedPeople.join(",")]);

  // availability indexed by title, so a tile lookup is O(1) not a scan
  // one row per title now: logos are a pipe-joined string
  const offersFor = React.useMemo(() => {
    const m = {};
    for (const r of avail.rows || []) {
      m[r.imdb_id] = {
        logos: String(r.logos || "").split("|").filter(Boolean).slice(0, 3),
        names: r.names || "",
      };
    }
    return m;
  }, [avail.rows]);

  // Seed pool, ROUND-ROBINED ACROSS GENRES. Taking the most-voted 48 gave a wall
  // of the same blockbusters -- and a tap on a film that shares its genres with
  // everything else on screen teaches almost nothing. Cycling genres makes each
  // tap discriminate, which is what CHARTER §4.1 asks the grid to do.
  const pool = React.useMemo(() => {
    const byGenre = new Map();
    const seen = new Set();
    for (const r of seeds.rows || []) {
      const g = r.genre || "Other";
      if (!byGenre.has(g)) byGenre.set(g, []);
      byGenre.get(g).push(r);
    }
    const lanes = [...byGenre.values()];
    const out = [];
    for (let i = 0; lanes.length && out.length < 300; i++) {
      let progressed = false;
      for (const lane of lanes) {
        const r = lane[i];
        if (!r) continue;
        progressed = true;
        if (!seen.has(r.tconst)) { seen.add(r.tconst); out.push(r); }
      }
      if (!progressed) break;
    }
    return out;
  }, [seeds.rows]);

  const rate = (tconst, v) => {
    setHistory((h) => [...h, { tconst, prev: verdicts[tconst] ?? null }]);
    setVerdicts((s) => { const n = { ...s }; if (v == null) delete n[tconst]; else n[tconst] = v; return n; });
  };
  const ratePerson = (nconst, v) => {
    setPeopleVerdicts((s) => ({ ...s, [nconst]: v }));
  };

  const undo = () => {
    setHistory((h) => {
      if (!h.length) return h;
      const last = h[h.length - 1];
      setVerdicts((s) => { const n = { ...s }; if (last.prev == null) delete n[last.tconst]; else n[last.tconst] = last.prev; return n; });
      setDeck((d) => Math.max(0, d - 1));
      return h.slice(0, -1);
    });
  };

  // Drop anything already rated. The model used to do this with `not (x ~ $G)`,
  // which silently returned zero rows for every input; doing it here is one
  // line and cannot fail quietly.
  // Final ranking, applying the two rules validated against the data before any
  // of this was built:
  //  - a single shared person is coincidence (Buscemi is in Fargo AND
  //    Armageddon); require TWO shared people, or real genre agreement.
  //  - at most two titles per director, or a strong match returns a filmography
  //    instead of a recommendation.
  const recommended = React.useMemo(() => {
    let rows = (recs.rows || [])
      .filter((r) => !verdicts[r.tconst])
      // TWO shared people, full stop. The earlier `>= 2 people OR >= 2 genres`
      // let everything through -- with only 29 genres almost any pair of films
      // shares two -- and Roseanne came back for a Coen-brothers profile on
      // John Goodman alone. Validated against the data: this is the clause that
      // separates a creative-team overlap from a coincidence.
      // Either a real creative-team link (a shared director or writer), or a
      // substantial cast overlap. One shared actor is coincidence.
      .filter((r) => num(r.shared_crew) >= 1 || num(r.shared_cast) >= 3)
      // COSINE, not the raw dot product: divide by the candidate's own vector
      // length so a film with a huge cast cannot win on having more features to
      // match against. Then a modest bonus for a real creative-team overlap.
      // Genre agreement carries the ranking; shared people add a bounded bonus.
      // This is the formula validated against the data before any UI existed --
      // it is what put Reservoir Dogs and Hard Eight at the top and left
      // Armageddon out.
      .map((r) => ({
        ...r,
        _score: num(r.genre_fit) / Math.max(1, num(r.norm))
              + Math.log1p(num(r.shared_crew)) * 0.22
              + Math.log1p(num(r.shared_cast)) * 0.06
              + num(r.average_rating) * 0.004,
      }))
      .sort((a, b) => b._score - a._score);
    // Titles carried in by a liked PERSON, appended after the feature-scored
    // ones. They earn their place on the person alone, so they are not scored
    // against the genre profile and must not outrank things that were.
    const seen = new Set(rows.map((r) => r.tconst));
    const byPerson = (recsPeople.rows || [])
      .filter((r) => !verdicts[r.tconst] && !seen.has(r.tconst))
      .map((r) => ({ ...r, _score: -1, shared_crew: 0, shared_cast: 0 }));
    rows = rows.concat(byPerson);

    const perDir = {};
    const out = [];
    for (const r of rows) {
      // Key on the WHOLE director set, sorted. Keying on the first id alone let
      // four Coen brothers films through: they are credited as two people, and
      // different titles list the pair in different orders.
      const d = Array.isArray(r.director) ? [...r.director].sort().join("+") : String(r.director || "?");
      perDir[d] = (perDir[d] || 0) + 1;
      if (perDir[d] <= 2) out.push(r);
    }
    return out;
  }, [recs.rows, recsPeople.rows, verdicts]);

  // people count as ratings: swiping right on an actor is a real signal and
  // the list must fill from it alone, or the person cards look decorative
  const rated = liked.length + disliked.length + likedPeople.length;

  // ADAPTIVE DECK. A fixed sequence stops informing after a handful of swipes:
  // if someone has liked three action films, a fourth teaches almost nothing.
  // Each next card is the most-voted unrated title whose genres we know LEAST
  // about, so swipe 15 is worth more than swipe 5 instead of less. Cheap on
  // purpose -- it reuses the genre already on the seed rows and needs no extra
  // query, so the deck stays instant.
  const genreSeen = React.useMemo(() => {
    const c = {};
    for (const r of pool) if (verdicts[r.tconst] && r.genre) c[r.genre] = (c[r.genre] || 0) + 1;
    return c;
  }, [pool, verdicts]);

  // People cards come FIRST while we know nothing: one swipe on an actor
  // touches every title they are in, where a film swipe touches one. Once a
  // few are down, titles are the finer instrument (CHARTER F5).
  const personCard = React.useMemo(() => {
    const rows = (seedPeople.rows || []).filter((r) => r.nconst && !peopleVerdicts[r.nconst]);
    return rows.length ? rows[0] : null;
  }, [seedPeople.rows, peopleVerdicts]);

  const usePersonCard = Object.keys(peopleVerdicts).length < 4 && personCard;

  const card = React.useMemo(() => {
    const unrated = pool.filter((r) => !verdicts[r.tconst]);
    if (!unrated.length) return null;
    // `deck` still advances so "haven't seen it" can skip past a card without
    // rating it; it just no longer dictates the order.
    let best = null, bestScore = -Infinity;
    for (const r of unrated) {
      const known = genreSeen[r.genre || "?"] || 0;
      const score = -known * 3 + Math.log10(Math.max(10, num(r.num_votes))) - (r._shown || 0) * 10;
      if (score > bestScore) { bestScore = score; best = r; }
    }
    return best;
  }, [pool, verdicts, genreSeen, deck]);

  // keyboard: swipe mode must not require a mouse or a touchscreen
  React.useEffect(() => {
    if (mode !== "swipe") return;
    const onKey = (e) => {
      if (!card) return;
      if (usePersonCard) {
        if (e.key === "ArrowRight") ratePerson(personCard.nconst, "up");
        else if (e.key === "ArrowLeft") ratePerson(personCard.nconst, "down");
        else if (e.key === "ArrowUp" || e.key === " ") ratePerson(personCard.nconst, "skip");
        return;
      }
      if (e.key === "ArrowRight") { rate(card.tconst, "up"); setDeck((d) => d + 1); }
      else if (e.key === "ArrowLeft") { rate(card.tconst, "down"); setDeck((d) => d + 1); }
      else if (e.key === "ArrowUp" || e.key === " ") { card._shown = (card._shown || 0) + 1; setDeck((d) => d + 1); }
      else if ((e.key === "z" && (e.metaKey || e.ctrlKey)) || e.key === "Backspace") undo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode, card, verdicts, usePersonCard, personCard]);

  const Chip = ({ on, onClick, children }) => (
    <button type="button" onClick={onClick}
      style={{ font: "inherit", fontSize: 12.5, cursor: "pointer", lineHeight: 1.15, padding: "5px 9px", borderRadius: 7,
               background: on ? ink.accent : ink.surface, color: on ? "#fff" : ink.text2,
               border: `1px solid ${on ? ink.accent : ink.track}`, transition: "background .12s ease, border-color .12s ease" }}>
      {children}
    </button>
  );

  return (
    <div style={{ maxWidth: 1120, margin: "0 auto", padding: "22px 24px 48px", color: "var(--dash-fg)" }}>
      <h1 style={{ fontSize: 22, fontWeight: 680, letterSpacing: "-.02em", margin: "0 0 3px" }}>
        {dashboard.title}
      </h1>
      <p style={{ color: ink.muted, fontSize: 13.5, lineHeight: 1.45, margin: "0 0 20px" }}>
        Rate a few things you have seen and get a list you can actually go and watch, with where each one
        is streaming in the US. Nothing you tap leaves your browser.
      </p>

      {/* mode picker - same chip row as the genre picker upstream */}
      <div style={{ margin: "0 0 18px" }}>
        <div style={{ fontSize: 11, letterSpacing: ".08em", textTransform: "uppercase", color: ink.muted, fontWeight: 700, marginBottom: 9 }}>
          Tell us what you like
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 5, alignItems: "center" }}>
          <Chip on={mode === "grid"} onClick={() => setMode("grid")}>Pick from a grid</Chip>
          <Chip on={mode === "swipe"} onClick={() => setMode("swipe")}>Swipe</Chip>
          <Chip on={mode === "search"} onClick={() => setMode("search")}>Search</Chip>
          <span style={{ marginLeft: 8, fontSize: 12, color: ink.muted, fontVariantNumeric: "tabular-nums" }}>
            {rated || likedPeople.length
              ? `${liked.length} liked · ${disliked.length} not for you`
                + (likedPeople.length ? ` · ${likedPeople.length} people` : "")
              : "nothing rated yet"}
          </span>
          {history.length > 0 && (
            <button type="button" onClick={undo}
              style={{ font: "inherit", fontSize: 12, cursor: "pointer", padding: "4px 8px", borderRadius: 7,
                       background: ink.surface, color: ink.text2, border: `1px solid ${ink.track}` }}>Undo</button>
          )}
        </div>
      </div>

      {mode === "grid" && (
        <div style={{ margin: "0 0 26px" }}>
          <div style={{ fontSize: 12, color: ink.muted, marginBottom: 10 }}>
            Tap everything you liked. Tap again to clear. Ten is plenty.
          </div>
          <div style={{ display: "grid", gridTemplateColumns: `repeat(auto-fill, ${TILE_W}px)`, gap: 14 }}>
            {pool.slice(0, 48).map((r) => (
              <Tile key={r.tconst} ink={ink} row={r} verdict={verdicts[r.tconst]} offers={offersFor[r.tconst]}
                    onRate={(v) => rate(r.tconst, v)} />
            ))}
          </div>
        </div>
      )}

      {mode === "swipe" && (
        <div style={{ margin: "0 0 26px" }}>
          <div style={{ fontSize: 12, color: ink.muted, marginBottom: 10 }}>
            Left is no, right is yes, up is \u201chaven\u2019t seen it\u201d. Arrow keys work too.
          </div>
          {usePersonCard ? (
            <div style={{ display: "flex", gap: 14, alignItems: "flex-start", flexWrap: "wrap" }}>
              <button type="button" aria-label={`Not a favourite: ${personCard.person}`}
                onClick={() => ratePerson(personCard.nconst, "down")}
                style={{ font: "inherit", cursor: "pointer", border: `1px solid ${ink.track}`,
                         background: ink.surface, color: BAD, borderRadius: 8, padding: "60px 16px",
                         fontSize: 22, fontWeight: 700 }}>✕</button>
              <div style={{ width: TILE_W * 2, textAlign: "center" }}>
                <div style={{ height: 300, borderRadius: 8, border: `1px solid ${ink.track}`,
                              background: ink.track, display: "flex", flexDirection: "column",
                              alignItems: "center", justifyContent: "center", padding: 16 }}>
                  <div style={{ fontSize: 11, letterSpacing: ".08em", textTransform: "uppercase",
                                color: ink.muted, fontWeight: 700, marginBottom: 8 }}>Person</div>
                  <div style={{ fontSize: 20, fontWeight: 680, color: ink.text, lineHeight: 1.2 }}>
                    {personCard.person}
                  </div>
                  <div style={{ fontSize: 12, color: ink.muted, marginTop: 6 }}>
                    {Math.round(num(personCard.titles))} titles here
                  </div>
                </div>
                <div style={{ fontSize: 12, color: ink.muted, marginTop: 8 }}>
                  Do you seek their work out? This raises their weight - it does not assume you liked
                  everything they are in.
                </div>
                <button type="button" onClick={() => ratePerson(personCard.nconst, "skip")}
                  style={{ marginTop: 10, font: "inherit", fontSize: 12, cursor: "pointer",
                           padding: "5px 10px", borderRadius: 7, background: ink.surface,
                           color: ink.text2, border: `1px solid ${ink.track}` }}>No opinion</button>
              </div>
              <button type="button" aria-label={`Favourite: ${personCard.person}`}
                onClick={() => ratePerson(personCard.nconst, "up")}
                style={{ font: "inherit", cursor: "pointer", border: `1px solid ${ink.track}`,
                         background: ink.surface, color: GOOD, borderRadius: 8, padding: "60px 16px",
                         fontSize: 22, fontWeight: 700 }}>✓</button>
            </div>
          ) : card ? (
            <div style={{ display: "flex", gap: 14, alignItems: "flex-start", flexWrap: "wrap" }}>
              <button type="button" aria-label="Did not like"
                onClick={() => { rate(card.tconst, "down"); setDeck((d) => d + 1); }}
                style={{ font: "inherit", cursor: "pointer", border: `1px solid ${ink.track}`, background: ink.surface,
                         color: BAD, borderRadius: 8, padding: "60px 16px", fontSize: 22, fontWeight: 700 }}>✕</button>
              <div style={{ width: TILE_W * 2, textAlign: "center" }}>
                <div style={{ position: "relative" }}>
                  {card.poster
                    ? <img src={card.poster.replace("/w154", "/w342")} alt={`Poster for ${card.primary_title}`}
                           style={{ width: "100%", borderRadius: 8, border: `1px solid ${ink.track}`, display: "block" }} />
                    : <div style={{ height: 300, borderRadius: 8, background: ink.track, display: "flex",
                                    alignItems: "center", justifyContent: "center", color: ink.muted }}>{card.primary_title}</div>}
                  <ProviderMark ink={ink} offers={offersFor[card.tconst]} />
                </div>
                <div style={{ fontSize: 14, fontWeight: 650, color: ink.text, marginTop: 8 }}>{card.primary_title}</div>
                <div style={{ fontSize: 12, color: ink.muted }}>
                  {card.start_year ? Math.round(num(card.start_year)) : ""} · ★ {num(card.average_rating).toFixed(1)}
                  {card.title_type !== "movie" ? ` · ${TYPE_LABEL[card.title_type] || card.title_type}` : ""}
                </div>
                <button type="button" onClick={() => { card._shown = (card._shown || 0) + 1; setDeck((d) => d + 1); }}
                  style={{ marginTop: 10, font: "inherit", fontSize: 12, cursor: "pointer", padding: "5px 10px",
                           borderRadius: 7, background: ink.surface, color: ink.text2, border: `1px solid ${ink.track}` }}>
                  Haven’t seen it
                </button>
              </div>
              <button type="button" aria-label="Liked it"
                onClick={() => { rate(card.tconst, "up"); setDeck((d) => d + 1); }}
                style={{ font: "inherit", cursor: "pointer", border: `1px solid ${ink.track}`, background: ink.surface,
                         color: GOOD, borderRadius: 8, padding: "60px 16px", fontSize: 22, fontWeight: 700 }}>✓</button>
            </div>
          ) : <div style={{ color: ink.muted, fontSize: 13 }}>That\u2019s the whole deck. Your list is below.</div>}
        </div>
      )}

      {mode === "search" && (
        <div style={{ margin: "0 0 26px" }}>
          <input
            value={q}
            onChange={(e) => {
              setQ(e.target.value); setPerson("");
              const v = e.target.value;
              // the model lowercases both sides, so send a lowercased term
              gTitle.set(v ? filters.contains(v.toLowerCase()) : "");
              gName.set(v ? filters.contains(v.toLowerCase()) : "");
            }}
            placeholder="Search films, shows and people…"
            style={{ font: "inherit", fontSize: 14, padding: "8px 11px", borderRadius: 7, width: "min(420px, 100%)",
                     border: `1px solid ${ink.track}`, background: ink.surface, color: ink.text }} />
          {q && (people.rows || []).length > 0 && (
            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: 11, letterSpacing: ".08em", textTransform: "uppercase",
                            color: ink.muted, fontWeight: 700, marginBottom: 7 }}>People</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                {(people.rows || []).slice(0, 12).map((r) => (
                  <button key={r.person} type="button"
                    onClick={() => { setPerson(r.person); gPerson.set(filters.oneOf(r.person)); }}
                    style={{ font: "inherit", fontSize: 12.5, cursor: "pointer", padding: "5px 9px", borderRadius: 7,
                             background: person === r.person ? ink.accent : ink.surface,
                             color: person === r.person ? "#fff" : ink.text2,
                             border: `1px solid ${person === r.person ? ink.accent : ink.track}` }}>
                    {r.person}
                    <span style={{ marginLeft: 5, fontSize: 10.5, opacity: 0.6 }}>{Math.round(num(r.titles))}</span>
                  </button>
                ))}
              </div>
              {person && (
                <div style={{ fontSize: 12, color: ink.muted, marginTop: 9 }}>
                  Rate what you have seen of {person}. Picking a person does not assume you liked
                  everything they are in.
                </div>
              )}
            </div>
          )}
          <div style={{ display: "grid", gridTemplateColumns: `repeat(auto-fill, ${TILE_W}px)`, gap: 14, marginTop: 14 }}>
            {(person ? (personTitles.rows || []) : (found.rows || [])).map((r) => (
              <Tile key={r.tconst} ink={ink} row={r} verdict={verdicts[r.tconst]} offers={offersFor[r.tconst]}
                    onRate={(v) => rate(r.tconst, v)} />
            ))}
          </div>
        </div>
      )}

      {/* ------------------------------ the list ------------------------- */}
      <div style={{ margin: "0 0 26px" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 8 }}>
          <div style={{ fontSize: 11, letterSpacing: ".08em", textTransform: "uppercase", color: ink.muted, fontWeight: 700 }}>
            Your next watch
          </div>
          <span style={{ fontSize: 12, color: ink.muted }}>
            {rated === 0 ? "rate something above and this fills in"
              : `${recommended.length} suggestions from ${rated} rating${rated === 1 ? "" : "s"}`}
          </span>
        </div>
        {rated === 0 ? (
          <div>
            <div style={{ color: ink.muted, fontSize: 13, marginBottom: 12 }}>
              Nothing rated yet, so this is simply what most people have watched. Tap a few posters above
              and it becomes yours - ten takes about five seconds.
            </div>
            <div style={{ display: "grid", gridTemplateColumns: `repeat(auto-fill, ${TILE_W}px)`, gap: 14 }}>
              {/* deliberately NOT the same titles as the grid above: repeating
                  the visible 48 made the section read as a rendering bug rather
                  than as a starting point */}
              {pool.slice(48, 62).map((r) => (
                <Tile key={"cold" + r.tconst} ink={ink} row={r} offers={offersFor[r.tconst]}
                      onOpen={() => { setOpen(r); gDetail.set(filters.oneOf(r.tconst)); }} />
              ))}
            </div>
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: `repeat(auto-fill, ${TILE_W}px)`, gap: 14 }}>
            {recommended.slice(0, 28).map((r) => (
              <Tile key={r.tconst} ink={ink} row={r} offers={offersFor[r.tconst]} onOpen={() => { setOpen(r); gDetail.set(filters.oneOf(r.tconst)); }} />
            ))}
          </div>
        )}
      </div>

      {open && (
        <div onClick={() => setOpen(null)}
             style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.45)", display: "flex",
                      alignItems: "center", justifyContent: "center", padding: 20, zIndex: 50 }}>
          <div onClick={(e) => e.stopPropagation()}
               style={{ background: ink.surface, border: `1px solid ${ink.track}`, borderRadius: 10, padding: 18,
                        maxWidth: 520, width: "100%", maxHeight: "80vh", overflowY: "auto" }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: ink.text }}>{open.primary_title}</div>
            <div style={{ fontSize: 12, color: ink.muted, margin: "3px 0 14px" }}>
              {open.start_year ? Math.round(num(open.start_year)) : ""} · ★ {num(open.average_rating).toFixed(1)} ·{" "}
              {TYPE_LABEL[open.title_type] || open.title_type} · {compact(num(open.num_votes))} ratings
            </div>
            <Availability ink={ink} offers={detail.rows || []} />
            <button type="button" onClick={() => setOpen(null)}
              style={{ marginTop: 16, font: "inherit", fontSize: 12.5, cursor: "pointer", padding: "6px 11px",
                       borderRadius: 7, background: ink.surface, color: ink.text2, border: `1px solid ${ink.track}` }}>Close</button>
          </div>
        </div>
      )}
    </div>
  );
}
