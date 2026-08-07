// @ts-nocheck
// The visitor's taste profile: every verdict they give, wherever they give it.
//
// EXTRACTED 2026-08-07 when next_watch was split into `rate` (collect verdicts)
// and `next_watch` (show the list) per NEXT-LAYOUT-WORK.md §3. This state is the
// ONLY thing the two pages share, so it has to have exactly one definition — two
// copies drifting apart would mean rating on one page and a different profile on
// the other, which is the split's whole failure mode.
//
// Everything here was live, load-bearing logic in next_watch.jsx; the comments
// are carried across because each one records a bug that was actually hit.
import React from "react";
import { filters } from "@malloyyo/dashboard";
import { loadProfile, saveProfile, profileIsEmpty } from "./profile.js";

/**
 * @param givens        the dashboard `givens` object
 * @param g             the useGiven handles this page holds:
 *                      { liked, disliked, likedPeople, dislikedPeople }
 * @param knownTconsts  ids present in the local corpus, used only to count how
 *                      many imported ratings we could not match. Optional.
 */
export function useTaste(g, knownTconsts) {
  // ⛑ ONE SEED, COMPUTED BEFORE ANY STATE (2026-08-06). Titles, people and
  // "not seen" are three separate pieces of state declared in three places; the
  // old seeding ran between them and could therefore only reach `verdicts`. So a
  // shared link restored your titles and silently dropped your PEOPLE — and
  // nothing persisted at all across a reload. Computing the whole seed up front
  // is what lets all three initialise from the same decision.
  //
  // ⛔ PRECEDENCE IS DELIBERATE: the URL WINS over the saved profile. A URL that
  // carries ratings is someone opening a list that was SHARED with them, and
  // showing them their own saved profile instead would be the same bug the URL
  // seeding exists to prevent, arriving from the other side. localStorage is the
  // fallback — the same person returning, or moving between this site's pages.
  const seed = React.useRef(null);
  if (!seed.current) {
    const fromGiven = (given) => {
      try { const v = filters.values(given.value); return Array.isArray(v) ? v.map(String) : []; }
      catch (e) { return []; }
    };
    const titles = {}, people = {};
    for (const t of fromGiven(g.liked)) if (t && t !== "__none__") titles[t] = "up";
    for (const t of fromGiven(g.disliked)) if (t && t !== "__none__") titles[t] = "down";
    for (const n of fromGiven(g.likedPeople)) if (n && n !== "__none__") people[n] = "up";
    for (const n of fromGiven(g.dislikedPeople)) if (n && n !== "__none__") people[n] = "down";

    if (Object.keys(titles).length || Object.keys(people).length) {
      seed.current = { verdicts: titles, people, skipped: [], from: "url" };
    } else {
      const saved = loadProfile();
      seed.current = profileIsEmpty(saved)
        ? { verdicts: {}, people: {}, skipped: [], from: "empty" }
        : { ...saved, from: "storage" };
    }
  }

  // verdicts: tconst -> 'up' | 'down'. The single source of truth for the UI;
  // the givens are derived from it so the engine and the screen cannot disagree.
  const [verdicts, setVerdicts] = React.useState(() => seed.current.verdicts);
  // ⛔ "NOT SEEN" IS STATE, NOT A MUTATION ON A QUERY ROW. It used to be
  // remembered as `row._shown++` on the object the seed query returned. Rating
  // anything writes a given, the runtime re-runs its query set, and the fresh
  // rows arrive WITHOUT that property — so every skip was forgotten the moment
  // the visitor rated something, and the skipped card came back about two
  // swipes later. A React set survives any number of query re-runs.
  const [skipped, setSkipped] = React.useState(() => new Set(seed.current.skipped));
  const [history, setHistory] = React.useState([]);
  // Kept apart from title verdicts on purpose. A liked PERSON raises their
  // weight in the profile; it never marks their filmography as liked.
  const [peopleVerdicts, setPeopleVerdicts] = React.useState(() => seed.current.people);

  const liked = React.useMemo(
    () => Object.keys(verdicts).filter((k) => verdicts[k] === "up"), [verdicts]);
  const disliked = React.useMemo(
    () => Object.keys(verdicts).filter((k) => verdicts[k] === "down"), [verdicts]);
  const likedPeople = React.useMemo(
    () => Object.keys(peopleVerdicts).filter((k) => peopleVerdicts[k] === "up"), [peopleVerdicts]);
  // ⛔ A LEFT SWIPE ON A PERSON USED TO GO NOWHERE. Only the liked set was ever
  // pushed into a given, so half of every verdict the visitor gave was silently
  // discarded. CHARTER F5: "A disliked actor is a strong negative and should be
  // treated as one."
  const dislikedPeople = React.useMemo(
    () => Object.keys(peopleVerdicts).filter((k) => peopleVerdicts[k] === "down"), [peopleVerdicts]);

  // push ratings into the model. filters.oneOf('') matches nothing, which is
  // what we want before anyone has rated anything. "__none__" rather than "" —
  // an empty filter matches everything and the recommendation self-join then
  // tries to score the whole corpus against the whole corpus.
  //
  // ⛔ DEBOUNCED. Every rating writes a given, and every given write re-runs the
  // recommendation queries in DuckDB-WASM. Rating at a natural pace queued one
  // full query round PER CLICK and they executed in series, so the UI fell
  // further behind the more you rated. Holding the writes back a beat collapses
  // a burst into one query round and costs nothing visible.
  const useDebouncedGiven = (given, values) => {
    const key = values.join(",");
    React.useEffect(() => {
      const t = window.setTimeout(
        () => given.set(filters.oneOf(...(values.length ? values : ["__none__"]))), 350);
      return () => window.clearTimeout(t);
    }, [key]);
  };
  useDebouncedGiven(g.liked, liked);
  useDebouncedGiven(g.disliked, disliked);
  useDebouncedGiven(g.likedPeople, likedPeople);
  useDebouncedGiven(g.dislikedPeople, dislikedPeople);

  // ⛑ PERSIST. One effect for all three slices, so they can never save out of
  // step with each other. Debounced for the same reason the givens are.
  // `skipped` is a Set, so it is compared by its serialised contents rather than
  // by identity — a Set never compares equal to itself across renders and this
  // would otherwise fire on every single render.
  const skippedKey = [...skipped].sort().join(",");
  React.useEffect(() => {
    const t = window.setTimeout(() => saveProfile(verdicts, peopleVerdicts, skipped), 400);
    return () => window.clearTimeout(t);
  }, [verdicts, peopleVerdicts, skippedKey]);

  // One history stack for BOTH kinds of verdict. It used to hold title verdicts
  // only, so people had no Undo at all. CHARTER F5 lists Undo under "Design
  // rules that are not optional", and a mis-rated person is the most expensive
  // kind of slip: one person touches every title they are in.
  const rate = React.useCallback((tconst, v) => {
    setHistory((h) => [...h, { kind: "title", id: tconst, prev: verdicts[tconst] ?? null }]);
    setVerdicts((s) => { const n = { ...s }; if (v == null) delete n[tconst]; else n[tconst] = v; return n; });
  }, [verdicts]);

  // Undoable like any other verdict — a mis-tapped "not seen" removes a title
  // from the session, exactly the kind of slip Undo exists for. Toggles, and
  // history records which way it went so Undo restores either direction.
  const skip = React.useCallback((tconst) => {
    setSkipped((s) => {
      const was = s.has(tconst);
      setHistory((h) => [...h, { kind: "skip", id: tconst, was }]);
      const n = new Set(s);
      if (was) n.delete(tconst); else n.add(tconst);
      return n;
    });
  }, []);

  // `v == null` UN-RATES (removes the key) rather than storing a third state —
  // the same contract `rate` has for titles, and what the search-side toggle
  // needs when you click the mark that is already lit.
  const ratePerson = React.useCallback((nconst, v) => {
    setHistory((h) => [...h, { kind: "person", id: nconst, prev: peopleVerdicts[nconst] ?? null }]);
    setPeopleVerdicts((s) => { const n = { ...s }; if (v == null) delete n[nconst]; else n[nconst] = v; return n; });
  }, [peopleVerdicts]);

  const undo = React.useCallback(() => {
    setHistory((h) => {
      if (!h.length) return h;
      const last = h[h.length - 1];
      const restore = (s) => {
        const n = { ...s };
        if (last.prev == null) delete n[last.id]; else n[last.id] = last.prev;
        return n;
      };
      if (last.kind === "skip") {
        // `was` records the state BEFORE the toggle, so undo restores it in
        // either direction rather than always un-skipping.
        setSkipped((s) => { const n = new Set(s); if (last.was) n.add(last.id); else n.delete(last.id); return n; });
      } else if (last.kind === "person") setPeopleVerdicts(restore);
      else setVerdicts(restore);
      return h.slice(0, -1);
    });
  }, []);

  // --- ratings import (CHARTER §4.2) ----------------------------------------
  // It ships because it is the sharpest demonstration of the thing this whole
  // architecture exists to show: the query engine is in the BROWSER, so a
  // ratings file is parsed where it sits and no upload happens.
  //
  // IMDb's export carries `Const` (tt…) so it matches EXACTLY. Letterboxd's does
  // not, and title+year matching is a different job — so a Letterboxd file is
  // REFUSED BY NAME rather than silently importing zero rows.
  const [importMsg, setImportMsg] = React.useState(null);

  const importCsv = React.useCallback((file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onerror = () => setImportMsg("Could not read that file.");
    reader.onload = () => {
      try {
        const text = String(reader.result || "");
        // quoted fields contain commas (titles do), so split on commas that are
        // followed by an even number of quotes
        const splitRow = (line) =>
          (line.match(/("([^"]|"")*"|[^,]*)(,|$)/g) || [])
            .map((c) => c.replace(/,$/, "").replace(/^"|"$/g, "").replace(/""/g, '"'))
            .slice(0, -1);
        const lines = text.split(/\r?\n/).filter((l) => l.trim());
        if (!lines.length) return setImportMsg("That file is empty.");
        const head = splitRow(lines[0]).map((h) => h.trim().toLowerCase());
        const idCol = head.findIndex((h) => h === "const" || h === "imdb id" || h === "tconst");
        const rateCol = head.findIndex((h) => h === "your rating" || h === "rating");
        if (idCol === -1) {
          return setImportMsg(
            head.indexOf("letterboxd uri") !== -1
              ? "That is a Letterboxd export. It has no IMDb ids, so it cannot be matched exactly. Use IMDb's ratings.csv."
              : "No IMDb id column found. Export ratings.csv from IMDb.");
        }
        const known = new Set(knownTconsts || []);
        let up = 0, down = 0, unknown = 0;
        const next = {};
        for (const line of lines.slice(1)) {
          const c = splitRow(line);
          const id = (c[idCol] || "").trim();
          if (!/^tt\d+$/.test(id)) continue;
          const score = rateCol === -1 ? NaN : parseFloat(c[rateCol]);
          // IMDb rates 1-10. 7+ is a like, 4- is a dislike, 5-6 is an opinion
          // too weak to push the profile either way.
          let v = null;
          if (!isNaN(score)) v = score >= 7 ? "up" : score <= 4 ? "down" : null;
          if (!v) continue;
          next[id] = v;
          if (v === "up") up++; else down++;
          if (!known.has(id)) unknown++;
        }
        if (!up && !down) return setImportMsg("No usable ratings in that file.");
        setVerdicts((s) => ({ ...s, ...next }));
        // The corpus is upstream's popular titles, not all of IMDb, so a real
        // export will contain films that are simply not here. Saying so is the
        // difference between an honest count and a silently short list.
        setImportMsg(
          `Imported ${up + down} ratings (${up} liked, ${down} not for you). ` +
          `Nothing left your browser.`);
      } catch (e) {
        setImportMsg("Could not parse that file as a CSV.");
      }
    };
    reader.readAsText(file);
  }, [knownTconsts]);

  // ⛔ PEOPLE COUNT TOO. Extracting this hook on 2026-08-07 I wrote
  // `liked.length + disliked.length`, dropping the person verdicts that the
  // original in next_watch.jsx included. The visible effect: rate only a PERSON
  // and the counter reads "nothing rated yet" — the verdict was recorded, the
  // model had it, and the screen denied it. Caught by the suite's person-dislike
  // assertion, which is exactly the case CHARTER F5 says must not be silent.
  const rated = liked.length + disliked.length + likedPeople.length + dislikedPeople.length;

  return {
    verdicts, peopleVerdicts, skipped, history,
    liked, disliked, likedPeople, dislikedPeople, rated,
    rate, skip, ratePerson, undo,
    importCsv, importMsg,
    seededFrom: seed.current.from,
  };
}
