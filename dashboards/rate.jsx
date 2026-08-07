// @ts-nocheck
// RATE — "tell it what you like". The INPUT half of the fork.
//
// Split out of next_watch.jsx on 2026-08-07 (NEXT-LAYOUT-WORK.md §3). Andrew's
// words, and the reason this file exists: the one page had become "too crowded,
// too many different layers of visuals, too many different placement styles, too
// many different things to click on"; the instruction was "instead of making one
// page that is crowded and has every tool jammed in, let's make different pages
// for different tools, so the ones that are most useful can become clear winners."
//
// So this page has ONE job: collect verdicts. Two ways in — a poster grid for
// breadth, and search for the visitor who already knows their three favourite
// films. Plus the IMDb ratings import, which belongs with rating and nowhere else.
//
// What is deliberately NOT here: the recommendation list, the "what your ratings
// are doing" strip, the service picker, the detail modal, the genre picker and the
// timeline. Those all describe the OUTPUT and live on next_watch. The genre picker
// and timeline in particular filter the RESULT, so having them on both pages was
// two controls that looked identical and did different things.
//
// State is shared with next_watch through ./lib/taste.js (localStorage + the URL
// givens). No backend; nothing a visitor taps leaves the page.
import React from "react";
import { filters, useGiven, useQuery } from "@malloyyo/dashboard";
import { parseProviders, visibleServices, canonicalService, loadMyServices } from "./lib/streaming.js";
import { LOGO, ChipBase, StreamableMark } from "./lib/streamui.jsx";
import { SearchBox } from "./lib/searchui.jsx";
// GOOD/BAD are the verdict colours used by the person ✓/✕ marks in the search
// results. Omitting them threw "ReferenceError: BAD is not defined" — but ONLY
// after a person was rated, so the page loaded and looked fine and the render
// error appeared on interaction. There is no typecheck over these dashboard
// files, so the stress suite is the only thing that catches this class.
import { useTheme, num, TILE_W, Tile, GOOD, BAD } from "./lib/kit.jsx";
import { useTaste } from "./lib/taste.js";

export default function Dashboard({ dashboard, givens }) {
  const { ink } = useTheme();
  const gLiked = useGiven("LIKED");
  const gDisliked = useGiven("DISLIKED");
  const gTitle = useGiven("TITLE");
  const gName = useGiven("NAME");
  const gPerson = useGiven("PERSON_EXACT");
  const gLikedPeople = useGiven("LIKED_PEOPLE");
  const gDislikedPeople = useGiven("DISLIKED_PEOPLE");

  // Only the queries this dashboard's model can resolve (rate.malloy imports
  // ./shared_queries.malloy). The output-side queries are next_watch's.
  const seeds = useQuery({ query: "seed_titles", givens });
  const avail = useQuery({ query: "availability", givens });
  const found = useQuery({ query: "search_titles", givens });
  const people = useQuery({ query: "search_people", givens });
  const personTitles = useQuery({ query: "titles_by_person", givens });

  const {
    verdicts, peopleVerdicts, skipped, history,
    liked, disliked, likedPeople, dislikedPeople, rated,
    rate, skip, ratePerson, undo, importCsv, importMsg,
  } = useTaste({ liked: gLiked, disliked: gDisliked, likedPeople: gLikedPeople, dislikedPeople: gDislikedPeople },
               React.useMemo(() => (seeds.rows || []).map((r) => r.tconst), [seeds.rows]));

  const [mode, setMode] = React.useState("grid");
  const [q, setQ] = React.useState("");
  const [person, setPerson] = React.useState("");
  const [myServices] = React.useState(() => loadMyServices());

  // availability indexed by title, so a tile lookup is O(1) not a scan
  // one row per title now: logos are a pipe-joined string
  const offersFor = React.useMemo(() => {
    const m = {};
    for (const r of avail.rows || []) {
      const all = parseProviders(r.provider_entries);
      m[r.imdb_id] = {
        all,
        // Filtered to what this visitor can actually watch on. Empty means the
        // mark does not render -- see StreamableMark.
        services: visibleServices(all, myServices),
        link: r.link || null,
      };
    }
    return m;
  }, [avail.rows, myServices]);

  // Pickable services, ordered by corpus coverage. Derived from the loaded rows
  // rather than hardcoded: TMDB renames and re-bundles providers regularly, and
  // a static list would quietly stop matching (the same class of failure as the
  // stale canary rank).
  const allServices = React.useMemo(() => {
    const count = new Map();
    for (const r of avail.rows || [])
      for (const p of parseProviders(r.provider_entries))
        count.set(p.service, (count.get(p.service) || 0) + 1);
    return [...count.entries()].sort((a, b) => b[1] - a[1]).map(([sv]) => sv);
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

  const Chip = (props) => <ChipBase ink={ink} {...props} />;

  return (
    <div style={{ maxWidth: 1120, margin: "0 auto", padding: "22px 24px 48px", color: "var(--dash-fg)" }}>
      <h1 style={{ fontSize: 22, fontWeight: 680, letterSpacing: "-.02em", margin: "0 0 3px" }}>
        {dashboard.title}
      </h1>
      <p style={{ color: ink.muted, fontSize: 13.5, lineHeight: 1.45, margin: "0 0 20px" }}>
        Tap what you liked. Your list is on <a href="./next_watch.html" style={{ color: ink.accent }}>Your next watch</a>.
      </p>

      {/* mode picker - same chip row as the genre picker upstream */}
      <div style={{ margin: "0 0 18px" }}>
        <div style={{ fontSize: 11, letterSpacing: ".08em", textTransform: "uppercase", color: ink.muted, fontWeight: 700, marginBottom: 9 }}>
          Rate
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 5, alignItems: "center" }}>
          <Chip on={mode === "grid"} onClick={() => setMode("grid")}>Grid</Chip>
          <Chip on={mode === "search"} onClick={() => setMode("search")}>Search</Chip>
          <span style={{ marginLeft: 8, fontSize: 12, color: ink.muted, fontVariantNumeric: "tabular-nums" }}>
            {rated
              ? `${liked.length} liked · ${disliked.length} not for you`
                + (likedPeople.length || dislikedPeople.length
                    ? ` · ${likedPeople.length + dislikedPeople.length} people` : "")
              : "nothing rated yet"}
          </span>
          {history.length > 0 && (
            <button type="button" onClick={undo}
              style={{ font: "inherit", fontSize: 12, cursor: "pointer", padding: "4px 8px", borderRadius: 7,
                       background: ink.surface, color: ink.text2, border: `1px solid ${ink.track}` }}>Undo</button>
          )}
          {/* Drawn as a chip so it reads as one more way in, not a feature
              bolted on. The file is read in the page; there is nowhere for it
              to be uploaded TO. */}
          <label style={{ font: "inherit", fontSize: 12, cursor: "pointer", padding: "4px 9px", borderRadius: 7,
                          background: ink.surface, color: ink.text2, border: `1px solid ${ink.track}` }}>
            Import IMDb ratings
            <input type="file" accept=".csv,text/csv" style={{ display: "none" }}
                   onChange={(e) => { importCsv(e.target.files && e.target.files[0]); e.target.value = ""; }} />
          </label>
        </div>
        {importMsg && (
          <div style={{ fontSize: 12, color: ink.muted, marginTop: 8 }}>{importMsg}</div>
        )}
      </div>

      {mode === "grid" && (
        <div style={{ margin: "0 0 26px" }}>
          <div style={{ fontSize: 12, color: ink.muted, marginBottom: 10 }}>
            Tap what you liked.
          </div>
          <div style={{ display: "grid", gridTemplateColumns: `repeat(auto-fill, ${TILE_W}px)`, gap: 14 }}>
            {pool.slice(0, 48).map((r) => (
              <Tile key={r.tconst} ink={ink} row={r} verdict={verdicts[r.tconst]} offers={offersFor[r.tconst]}
                    skipped={skipped.has(r.tconst)} onSkip={() => skip(r.tconst)}
                    onRate={(v) => rate(r.tconst, v)} />
            ))}
          </div>
        </div>
      )}

      {mode === "search" && (
        <div style={{ margin: "0 0 26px" }}>
          {/* Autofill tolerates a misspelling; the underlying query does not,
              and cannot -- `contains` can never reach Michael Caine from
              "mikel cain". Picking a suggestion sets the EXACT value, so the
              query below is handed something it can match on the nose. */}
          <SearchBox
            ink={ink}
            value={q}
            placeholder="Search films and people"
            onChange={(v) => {
              setQ(v); setPerson("");
              // the model lowercases both sides, so send a lowercased term
              gTitle.set(v ? filters.contains(v.toLowerCase()) : "");
              gName.set(v ? filters.contains(v.toLowerCase()) : "");
            }}
            onPickTitle={(h) => {
              setQ(h.text); setPerson("");
              gTitle.set(filters.contains(h.text.toLowerCase()));
              gName.set("");
            }}
            onPickPerson={(h) => {
              setQ(h.text); setPerson(h.text);
              gTitle.set("");
              gName.set(filters.contains(h.text.toLowerCase()));
              gPerson.set(filters.oneOf(h.text));
            }} />
          {q && (people.rows || []).length > 0 && (
            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: 11, letterSpacing: ".08em", textTransform: "uppercase",
                            color: ink.muted, fontWeight: 700, marginBottom: 7 }}>People</div>
              {/* ⛑ RATING A PERSON LIVES HERE NOW (2026-08-06), and it had to be
                  BUILT, not merely preserved. The layout plan said the person
                  path "stays" through search when the deck leaves — but
                  `ratePerson` had NO call site outside the deck, so deleting the
                  deck first would have left `peopleVerdicts` permanently empty
                  and silently killed `recommendations_by_person` and the
                  disliked-person veto (CHARTER F4/F5) while every page still
                  rendered. The name still SELECTS (surfacing their titles to
                  rate, which is not the same as liking their filmography); the
                  two marks beside it are the verdict, keyed on the nconst the
                  model matches — see the note on `search_people`. */}
              <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                {(people.rows || []).slice(0, 12).map((r) => {
                  const v = r.nconst ? peopleVerdicts[r.nconst] : undefined;
                  return (
                    <span key={r.nconst || r.person}
                          style={{ display: "inline-flex", alignItems: "stretch", gap: 0 }}>
                      <button type="button"
                        onClick={() => { setPerson(r.person); gPerson.set(filters.oneOf(r.person)); }}
                        style={{ font: "inherit", fontSize: 12.5, cursor: "pointer", padding: "5px 9px",
                                 borderRadius: r.nconst ? "7px 0 0 7px" : 7,
                                 background: person === r.person ? ink.accent : ink.surface,
                                 color: person === r.person ? "#fff" : ink.text2,
                                 border: `1px solid ${person === r.person ? ink.accent : ink.track}`,
                                 borderRight: r.nconst ? "none" : undefined }}>
                        {r.person}
                        <span style={{ marginLeft: 5, fontSize: 10.5, opacity: 0.6 }}>{Math.round(num(r.titles))}</span>
                      </button>
                      {/* No nconst -> no verdict is possible, so no control is
                          drawn. A button that silently does nothing is worse
                          than an absent one. */}
                      {r.nconst && (
                        <>
                          <button type="button"
                            data-rate="person"
                            aria-label={`Not for me: ${r.person}`}
                            aria-pressed={v === "down"}
                            title={v === "down" ? `Rated: not for you` : `Not for me`}
                            onClick={() => ratePerson(r.nconst, v === "down" ? null : "down")}
                            style={{ font: "inherit", fontSize: 12.5, cursor: "pointer", padding: "5px 8px",
                                     background: v === "down" ? BAD : ink.surface,
                                     color: v === "down" ? "#fff" : ink.muted,
                                     border: `1px solid ${ink.track}`, borderRight: "none" }}>✕</button>
                          <button type="button"
                            data-rate="person"
                            aria-label={`Yes: ${r.person}`}
                            aria-pressed={v === "up"}
                            title={v === "up" ? `Rated: liked` : `Like`}
                            onClick={() => ratePerson(r.nconst, v === "up" ? null : "up")}
                            style={{ font: "inherit", fontSize: 12.5, cursor: "pointer", padding: "5px 8px",
                                     borderRadius: "0 7px 7px 0",
                                     background: v === "up" ? GOOD : ink.surface,
                                     color: v === "up" ? "#fff" : ink.muted,
                                     border: `1px solid ${ink.track}` }}>✓</button>
                        </>
                      )}
                    </span>
                  );
                })}
              </div>
              <div style={{ fontSize: 11.5, color: ink.muted, marginTop: 7 }}>
                A name weights the person, not their films. Pick the name itself to rate their titles.
              </div>
            </div>
          )}
          <div style={{ display: "grid", gridTemplateColumns: `repeat(auto-fill, ${TILE_W}px)`, gap: 14, marginTop: 14 }}>
            {(person ? (personTitles.rows || []) : (found.rows || [])).map((r) => (
              <Tile key={r.tconst} ink={ink} row={r} verdict={verdicts[r.tconst]} offers={offersFor[r.tconst]}
                    skipped={skipped.has(r.tconst)} onSkip={() => skip(r.tconst)}
                    onRate={(v) => rate(r.tconst, v)} />
            ))}
          </div>
          {/* A search that matches nothing rendered silent white space, so a
              typo was indistinguishable from a page that had stopped working.
              Same wording the results list already uses. */}
          {/* Searching a person's name matches PEOPLE and no titles, so the
              grid below came up empty and the whole thing read as "no results"
              — with the one control that would have helped sitting unexplained
              right above it. */}
          {q && !person && (found.rows || []).length === 0 && (people.rows || []).length > 0 && (
            <div style={{ fontSize: 12.5, color: ink.muted, marginTop: 14 }}>
              Pick a name to rate their titles.
            </div>
          )}
          {q && !person && (found.rows || []).length === 0 && (people.rows || []).length === 0 && (
            <div style={{ fontSize: 12.5, color: ink.muted, marginTop: 14 }}>
              Nothing matches “{q}”.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
