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
import { parseProviders, visibleServices, serviceLink, canonicalService, loadMyServices, saveMyServices } from "./lib/streaming.js";
import { LOGO, ChipBase, StreamableMark, ServicePicker } from "./lib/streamui.jsx";
import { SearchBox } from "./lib/searchui.jsx";
import { loadProfile, saveProfile, profileIsEmpty } from "./lib/profile.js";

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

function GenrePicker({ ink, options, current, onPick }) {
  return (
    <div style={{ margin: "0 0 18px" }}>
      <div style={{ fontSize: 11, letterSpacing: ".08em", textTransform: "uppercase", color: ink.muted, fontWeight: 700, marginBottom: 9 }}>
        Genre
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
        {options.map((o) => {
          const on = o.genre === current;
          return (
            <button
              key={o.genre}
              type="button"
              onClick={() => onPick(o.genre)}
              aria-pressed={on}
              style={{
                font: "inherit", fontSize: 12.5, cursor: "pointer", lineHeight: 1.15,
                padding: "5px 9px", borderRadius: 7,
                border: `1px solid ${on ? ink.accent : "var(--dash-border)"}`,
                background: on ? ink.accent : ink.surface,
                color: on ? "#fff" : ink.text2,
                fontWeight: on ? 650 : 500,
                transition: "background .12s ease, border-color .12s ease",
              }}
            >
              {o.genre}
              <span style={{ marginLeft: 5, fontSize: 10.5, opacity: on ? 0.8 : 0.5, fontVariantNumeric: "tabular-nums" }}>
                {compact(o.count)}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* -------------------------------- timeline ----------------------------- */
// The timeline is the picker: one bar per 5-year period, height by film count.
// Clicking a bar scopes everything below to that period; clicking the selected
// bar again clears it. "All Time" is the explicit reset.
//
// Bars are <button>s rather than a chart library so each one is a real click
// target with its own label and pressed state.
const periodLabel = (p) => `${p}–${String(p + 4).slice(-2)}`;

// Click one bar for a single 5-year period, or drag across bars for a longer
// span. Pointer position is mapped to a bar index off the strip's own rect
// rather than per-bar enter/leave handlers, so a fast drag can't skip a bar.
function Timeline({ ink, periods, range, onSelect }) {
  const stripRef = React.useRef(null);
  const [drag, setDrag] = React.useState(null); // {anchor, cur} indices, while dragging
  const [moved, setMoved] = React.useState(false);

  const max = periods.reduce((m, p) => Math.max(m, p.count), 0);
  const idxOf = (period) => periods.findIndex((p) => p.period === period);

  const indexAt = (clientX) => {
    const el = stripRef.current;
    if (!el || !periods.length) return 0;
    const r = el.getBoundingClientRect();
    const i = Math.floor(((clientX - r.left) / r.width) * periods.length);
    return Math.max(0, Math.min(periods.length - 1, i));
  };

  const onDown = (e) => {
    const i = indexAt(e.clientX);
    setDrag({ anchor: i, cur: i });
    setMoved(false);
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch (err) {}
  };
  const onMove = (e) => {
    if (!drag) return;
    const i = indexAt(e.clientX);
    if (i !== drag.cur) { setDrag((d) => ({ ...d, cur: i })); setMoved(true); }
  };
  const onUp = () => {
    if (!drag) return;
    const lo = Math.min(drag.anchor, drag.cur);
    const hi = Math.max(drag.anchor, drag.cur);
    const single = lo === hi && !moved;
    // Tapping the bar that is already the whole selection clears it.
    const isCurrent = range && range.lo === periods[lo]?.period && range.hi === periods[hi]?.period;
    setDrag(null);
    setMoved(false);
    if (single && isCurrent) onSelect(null);
    else onSelect(periods[lo].period, periods[hi].period);
  };

  // While dragging, preview the drag; otherwise reflect the committed range.
  const sel = drag
    ? { lo: Math.min(drag.anchor, drag.cur), hi: Math.max(drag.anchor, drag.cur) }
    : range
      ? { lo: idxOf(range.lo), hi: idxOf(range.hi) }
      : null;
  const allTime = !sel || sel.lo < 0;

  const label = allTime
    ? "every year"
    : sel.lo === sel.hi
      ? `showing ${periodLabel(periods[sel.lo].period)}`
      : `showing ${periods[sel.lo].period}–${periods[sel.hi].period + 4}`;

  return (
    <div style={{ margin: "0 0 26px" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 8 }}>
        <div style={{ fontSize: 11, letterSpacing: ".08em", textTransform: "uppercase", color: ink.muted, fontWeight: 700 }}>
          Timeline
        </div>
        <button
          type="button"
          onClick={() => onSelect(null)}
          aria-pressed={allTime}
          style={{
            font: "inherit", fontSize: 12, fontWeight: 620, cursor: "pointer",
            padding: "3px 9px", borderRadius: 7,
            border: `1px solid ${allTime ? ink.accent : "var(--dash-border)"}`,
            background: allTime ? ink.accent : ink.surface,
            color: allTime ? "#fff" : ink.text2,
          }}
        >
          All Time
        </button>
        <span style={{ fontSize: 12, color: ink.muted, fontVariantNumeric: "tabular-nums" }}>{label}</span>
        <span style={{ fontSize: 11.5, color: ink.muted, marginLeft: "auto" }}>
          click a bar, or drag across several
        </span>
      </div>

      <div
        ref={stripRef}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={() => { setDrag(null); setMoved(false); }}
        style={{
          display: "flex", alignItems: "flex-end", gap: 3, height: 78,
          cursor: "col-resize", touchAction: "none", userSelect: "none",
        }}
      >
        {periods.map((p, i) => {
          const on = sel && i >= sel.lo && i <= sel.hi;
          const h = max > 0 ? Math.max((p.count / max) * 58, 3) : 3;
          const edge = on && (i === sel.lo || i === sel.hi);
          return (
            <div
              key={p.period}
              title={`${periodLabel(p.period)} · ${p.count.toLocaleString()} films`}
              style={{
                flex: "1 1 0", minWidth: 0, height: "100%",
                display: "flex", flexDirection: "column", justifyContent: "flex-end", gap: 4,
              }}
            >
              <div style={{
                height: h, flex: "none",
                borderRadius: "3px 3px 0 0",
                background: on ? ink.accent : ink.track,
                border: `1px solid ${on ? ink.accent : ink.track}`,
                transition: drag ? "none" : "background .12s ease, height .18s ease",
              }} />
              {/* Fixed height and flex:none on EVERY column, labelled or not:
                  the column is bottom-aligned, so a label that only some bars
                  have would lift those bars off the shared baseline. */}
              <div style={{
                height: 10, flex: "none",
                fontSize: 9, lineHeight: "10px", textAlign: "center",
                color: edge ? ink.accent : ink.muted,
                fontWeight: edge ? 700 : 500,
                fontVariantNumeric: "tabular-nums",
                whiteSpace: "nowrap", overflow: "hidden",
              }}>
                {edge || p.period % 20 === 0 ? p.period : ""}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ---------------------------------- shelves ---------------------------- */

const TILE_W = 103;
// TYPE_LABEL went with television (CHARTER §7.2, 2026-08-05). The corpus is
// films only, so every label it could return was "Film".

/* --------------------------- provider marks (F1) ------------------------ */
// ChipBase, StreamGlyph, StreamableMark and ServicePicker live in
// ./lib/streamui.jsx so this page and genre_pairs share ONE definition.

function Availability({ ink, offers, myServices, title, year }) {
  const [showAll, setShowAll] = React.useState(false);
  if (!offers || !offers.length) {
    return <div style={{ color: ink.muted, fontSize: 12 }}>Not listed in the US.</div>;
  }
  const KINDS = [["flatrate", "Stream"], ["free", "Free"], ["ads", "Free with ads"], ["rent", "Rent"], ["buy", "Buy"]];
  const link = offers.find((o) => o.link)?.link;
  const mine = new Set(myServices || []);
  // ⛔ THE DETAIL VIEW IS NOT THE TILE. On a tile, a service the visitor does
  // not have is noise and is hidden outright. Here they have deliberately
  // opened "where can I watch this", so hiding the answer would be withholding
  // it -- the non-subscribed options collapse behind one line instead.
  const hiddenCount = mine.size
    ? new Set(offers.filter((o) => o.offer_kind === "flatrate")
        .map((o) => canonicalService(o.provider_name)).filter((sv) => !mine.has(sv))).size
    : 0;
  return (
    <div style={{ display: "grid", gap: 8 }}>
      {KINDS.map(([k, label]) => {
        // Collapse TMDB's reseller rows to services, so "Paramount+" appears
        // once rather than four times (Essential, Premium, Amazon, Roku).
        const seen = new Set();
        const rows = [];
        for (const o of offers) {
          if (o.offer_kind !== k) continue;
          const sv = canonicalService(o.provider_name);
          if (seen.has(sv)) continue;
          if (k === "flatrate" && mine.size && !mine.has(sv) && !showAll) continue;
          seen.add(sv);
          rows.push({ ...o, service: sv });
        }
        if (!rows.length) return null;
        return (
          <div key={k} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ fontSize: 11, letterSpacing: ".06em", textTransform: "uppercase", color: ink.muted,
                           fontWeight: 700, minWidth: 92 }}>{label}</span>
            {rows.map((o, i) => {
              const href = serviceLink(o.service, title, year, o.link || link);
              return (
                <a key={i} href={href || undefined} target="_blank" rel="noopener noreferrer"
                   style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12,
                            color: ink.text2, textDecoration: "none" }}>
                  <img src={LOGO(o.logo_path)} alt="" width={18} height={18} loading="lazy"
                       style={{ borderRadius: 4, background: "#fff", display: "block" }} />
                  {o.service}
                </a>
              );
            })}
          </div>
        );
      })}
      {hiddenCount > 0 && !showAll && (
        <button type="button" onClick={() => setShowAll(true)}
                style={{ justifySelf: "start", font: "inherit", fontSize: 12, cursor: "pointer",
                         background: "transparent", border: 0, padding: 0, color: ink.accent }}>
          {hiddenCount} more service{hiddenCount === 1 ? "" : "s"} you have not selected
        </button>
      )}
      <div style={{ fontSize: 11, color: ink.muted, borderTop: `1px solid ${ink.track}`, paddingTop: 6 }}>
        Availability data from <b>JustWatch</b>, via TMDB. US only.{" "}
        {link && <a href={link} target="_blank" rel="noopener noreferrer" style={{ color: ink.accent }}>All options</a>}
      </div>
    </div>
  );
}

/* ------------------------------ poster tile ----------------------------- */
function Tile({ ink, row, verdict, onRate, offers, onOpen, reason, onSkip, skipped }) {
  const [bad, setBad] = React.useState(false);
  const frame = {
    width: TILE_W, height: 156, borderRadius: 6, display: "block",
    border: verdict === "up" ? `2px solid ${GOOD}` : verdict === "down" ? `2px solid ${BAD}` : `1px solid ${ink.track}`,
    background: ink.track, opacity: verdict === "down" || skipped ? 0.45 : 1,
    transition: "opacity .12s ease, border-color .12s ease",
  };
  // ⛑ ALL THREE OUTCOMES LIVE ON THE TILE NOW (2026-08-06). The tile used to
  // offer exactly one — click toggles "liked" — because "not for me" and "not
  // seen" were reachable ONLY through the swipe deck. The deck is leaving the
  // fork (CHARTER §7.2), so removing it without this would have silently deleted
  // two thirds of the rating vocabulary from the whole page while every test
  // still passed. Drawn as a small row under the poster rather than as overlay
  // halves: the halves were a swipe affordance, and a grid is not swiped.
  // `data-rate` exists for the harness: person marks and title marks share the
  // "Not for me: …" label shape, so a selector on the label alone is ambiguous and
  // silently picks whichever happens to be first in the DOM.
  const Mark = ({ on, label, title, color, ch, onPick }) => (
    <button type="button" data-rate="title" onClick={onPick} aria-label={label} aria-pressed={on} title={title}
      style={{ font: "inherit", fontSize: 11, lineHeight: 1, cursor: "pointer", flex: 1,
               padding: "4px 0", borderRadius: 5,
               background: on ? color : "transparent", color: on ? "#fff" : ink.muted,
               border: `1px solid ${on ? color : ink.track}` }}>{ch}</button>
  );
  return (
    // ⛑ FLEX COLUMN + `marginTop:auto` ON THE MARKS ROW (2026-08-06). CSS grid
    // stretches every cell in a row to the tallest, so with a plain block the
    // three marks sat at a different height under every tile whose title wrapped
    // to two or three lines — ragged, and a direct consequence of adding them.
    // Pushing the row to the bottom of the cell aligns them without truncating
    // anyone's title, which would be deciding content to fix layout.
    <div style={{ width: TILE_W, height: "100%", display: "flex", flexDirection: "column" }}>
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
        <StreamableMark ink={ink} offers={offers} title={row.primary_title} year={row.start_year} />
        {verdict === "up" && <Badge color={GOOD} ch="✓" />}
        {verdict === "down" && <Badge color={BAD} ch="✕" />}
      </div>
      <div style={{ fontSize: 12, fontWeight: 620, color: ink.text, marginTop: 5, lineHeight: 1.2 }}>{row.primary_title}</div>
      {reason && (
        <div style={{ fontSize: 10.5, color: ink.muted, marginTop: 1 }}>{reason}</div>
      )}
      <div style={{ fontSize: 11, color: ink.muted, fontVariantNumeric: "tabular-nums" }}>
        {row.start_year ? Math.round(num(row.start_year)) : ""}
        {row.num_votes ? ` · ${compact(num(row.num_votes))}` : ""}
      </div>
      {/* Only where rating is the job. The recommendation list passes no
          `onRate`, and a verdict row there would invite rating the output. */}
      {onRate && (
        <div style={{ display: "flex", gap: 3, marginTop: "auto", paddingTop: 4 }}>
          <Mark on={verdict === "down"} color={BAD} ch="✕"
                label={`Not for me: ${row.primary_title}`}
                title="Not for me"
                onPick={() => onRate(verdict === "down" ? null : "down")} />
          <Mark on={verdict === "up"} color={GOOD} ch="✓"
                label={`Yes: ${row.primary_title}`}
                title="Liked"
                onPick={() => onRate(verdict === "up" ? null : "up")} />
          {onSkip && (
            <Mark on={!!skipped} color={ink.muted} ch="—"
                  label={`Not seen: ${row.primary_title}`}
                  title="Not seen"
                  onPick={() => onSkip()} />
          )}
        </div>
      )}
    </div>
  );
}
function CopyButton({ ink, label, done, onCopy }) {
  return (
    <button type="button" onClick={onCopy}
      style={{ font: "inherit", fontSize: 12, cursor: "pointer", padding: "4px 9px", borderRadius: 7,
               background: ink.surface, color: done ? GOOD : ink.text2,
               border: `1px solid ${done ? GOOD : ink.track}` }}>
      {done ? "Copied" : label}
    </button>
  );
}

function Badge({ color, ch }) {
  return (
    <span style={{ position: "absolute", left: 3, top: 3, width: 17, height: 17, borderRadius: 9, background: color,
                   color: "#fff", fontSize: 11, lineHeight: "17px", textAlign: "center", fontWeight: 700 }}>{ch}</span>
  );
}

/* ------------------------------- swipe stage ---------------------------- */
// ONE component for both card types. The person card and the title card were
// separately hand-laid-out before, which is how one ended up a 300px grey box
// with no picture and the other a 206px thumbnail: "the picture should be
// nearly full screen" has to be true of both or it is true of neither.
//
// CHARTER F5 asks for three things this did not have:
//   - a real drag. It was two buttons labelled with ticks, which is not a swipe.
//   - click-halves on desktop, WITH an affordance ("an invisible hit target
//     that judges films is a trap").
//   - three outcomes. Up (or the visible button) is "haven't seen it".
// Keyboard already worked and still does; it is handled by the parent.
// "The picture should be nearly full screen." 62vh capped at 560px was still
// half the window on a laptop; the cap was doing the limiting, not the vh.
/* -------------------------------- dashboard ---------------------------- */
export default function Dashboard({ dashboard, givens }) {
  const { ink } = useTheme();
  const gLiked = useGiven("LIKED");
  const gDisliked = useGiven("DISLIKED");
  const gTitle = useGiven("TITLE");
  const gName = useGiven("NAME");
  const gPerson = useGiven("PERSON_EXACT");
  const gLikedPeople = useGiven("LIKED_PEOPLE");
  const gDislikedPeople = useGiven("DISLIKED_PEOPLE");
  const gDetail = useGiven("DETAIL_ID");

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
    const fromGiven = (g) => {
      try { const v = filters.values(g.value); return Array.isArray(v) ? v.map(String) : []; }
      catch (e) { return []; }
    };
    const titles = {}, people = {};
    for (const t of fromGiven(gLiked)) if (t && t !== "__none__") titles[t] = "up";
    for (const t of fromGiven(gDisliked)) if (t && t !== "__none__") titles[t] = "down";
    for (const n of fromGiven(gLikedPeople)) if (n && n !== "__none__") people[n] = "up";
    for (const n of fromGiven(gDislikedPeople)) if (n && n !== "__none__") people[n] = "down";

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
  const [mode, setMode] = React.useState("grid");
  // ⛔ "NOT SEEN" IS STATE, NOT A MUTATION ON A QUERY ROW. It used to be
  // remembered as `row._shown++` on the object the seed query returned. Rating
  // anything writes a given, the runtime re-runs its query set, and the fresh
  // rows arrive WITHOUT that property — so every skip was forgotten the moment
  // the visitor rated something, and the skipped card came back about two
  // swipes later. Reproduced exactly: skip, like, skip → Shawshank returns.
  // A React set survives any number of query re-runs.
  const [skipped, setSkipped] = React.useState(() => new Set(seed.current.skipped));
  const [open, setOpen] = React.useState(null);
  const [history, setHistory] = React.useState([]);
  const [q, setQ] = React.useState("");

  const liked = React.useMemo(() => Object.keys(verdicts).filter((k) => verdicts[k] === "up"), [verdicts]);
  const disliked = React.useMemo(() => Object.keys(verdicts).filter((k) => verdicts[k] === "down"), [verdicts]);

  // push ratings into the model. filters.oneOf('') matches nothing, which is
  // what we want before anyone has rated anything.
  // "__none__" rather than "" — an empty filter matches everything and the
  // recommendation self-join then tries to score the whole corpus against the
  // whole corpus.
  // ⛔ DEBOUNCED, and this is why swipe mode felt slow. Every single swipe wrote
  // a given, and every given write re-ran the recommendation queries in
  // DuckDB-WASM. Swiping at a natural pace queued one full query round PER CARD
  // and they executed in series, so the deck fell further behind the further you
  // got. Swiping is meant to be the fast input; it was the slowest.
  // The card itself never waited on these — the deck comes from a local list —
  // so holding the writes back a beat costs nothing visible and collapses a
  // burst of swipes into one query round.
  const useDebouncedGiven = (given, values) => {
    const key = values.join(",");
    React.useEffect(() => {
      const t = window.setTimeout(
        () => given.set(filters.oneOf(...(values.length ? values : ["__none__"]))), 350);
      return () => window.clearTimeout(t);
    }, [key]);
  };
  useDebouncedGiven(gLiked, liked);
  useDebouncedGiven(gDisliked, disliked);

  const seeds = useQuery({ query: "seed_titles", givens });
  const recs = useQuery({ query: "recommendations", givens });
  const recsPeople = useQuery({ query: "recommendations_by_person", givens });
  // The visitor's own subscriptions (CHARTER §7.3). Empty on a first visit,
  // which deliberately means "show every service" rather than "show none" --
  // an untouched control must not make a working site look empty.
  const [myServices, setMyServices] = React.useState(() => loadMyServices());
  const toggleService = React.useCallback((name) => {
    setMyServices((cur) => {
      const next = cur.includes(name) ? cur.filter((x) => x !== name) : [...cur, name];
      saveMyServices(next);
      return next;
    });
  }, []);

  const avail = useQuery({ query: "availability", givens });
  // ⛑ WIRED 2026-08-05. This query existed in the model and NOTHING read it --
  // which is precisely Andrew's criticism: the page handed over a list with no
  // indication of how his ratings produced it.
  const profileQ = useQuery({ query: "taste_profile", givens });
  const detail = useQuery({ query: "availability_detail", givens });
  const found = useQuery({ query: "search_titles", givens });
  const people = useQuery({ query: "search_people", givens });
  const seedPeople = useQuery({ query: "seed_people", givens });
  const popular = useQuery({ query: "popular_picks", givens });
  const vetoed = useQuery({ query: "titles_by_disliked_people", givens });
  const genreOpts = useQuery({ query: "nw_genre_options", givens });
  const periodsQ = useQuery({ query: "nw_periods", givens });
  const gGenre = useGiven("GENRE");
  const gYear = useGiven("RELEASE_YEAR");
  const personTitles = useQuery({ query: "titles_by_person", givens });
  const [person, setPerson] = React.useState("");

  const genreOptions = React.useMemo(
    () => (genreOpts.rows || []).map((r) => ({ genre: r.genre, count: num(r.title_count) })).filter((o) => o.genre),
    [genreOpts.rows]);
  const periods = React.useMemo(
    () => (periodsQ.rows || []).map((r) => ({ period: num(r.period), count: num(r.title_count) }))
      .filter((p) => p.period > 0).sort((a, b) => a.period - b.period),
    [periodsQ.rows]);
  const genreNow = React.useMemo(() => {
    try { const v = filters.values(gGenre.value); return Array.isArray(v) && v.length ? String(v[0]) : ""; }
    catch (e) { return ""; }
  }, [gGenre.value]);
  const yearRange = React.useMemo(() => {
    const src = String(gYear.value || "");
    const m = src.match(/(\d{4})\s*to\s*(\d{4})/);
    if (!m) return null;
    return { lo: +m[1], hi: +m[2] - 4 };
  }, [gYear.value]);
  // Kept apart from title verdicts on purpose. A liked PERSON raises their
  // weight in the profile; it never marks their filmography as liked.
  const [peopleVerdicts, setPeopleVerdicts] = React.useState(() => seed.current.people);
  const likedPeople = React.useMemo(
    () => Object.keys(peopleVerdicts).filter((k) => peopleVerdicts[k] === "up"), [peopleVerdicts]);
  // ⛔ A LEFT SWIPE ON A PERSON USED TO GO NOWHERE. Only the liked set was ever
  // pushed into a given, so in the deck's DEFAULT mode half of every verdict the
  // visitor gave was silently discarded — the counter did not move and the list
  // did not change. CHARTER F5: "A disliked actor is a strong negative and
  // should be treated as one."
  const dislikedPeople = React.useMemo(
    () => Object.keys(peopleVerdicts).filter((k) => peopleVerdicts[k] === "down"), [peopleVerdicts]);
  useDebouncedGiven(gLikedPeople, likedPeople);
  useDebouncedGiven(gDislikedPeople, dislikedPeople);

  // ⛑ PERSIST. One effect for all three slices, so they can never save out of
  // step with each other. Debounced for the same reason the givens are: a burst
  // of ratings should cost one write, not one per click. `skipped` is a Set, so
  // it is compared by its serialised contents rather than by identity — a Set
  // never compares equal to itself across renders and this would otherwise fire
  // on every single render.
  const skippedKey = [...skipped].sort().join(",");
  React.useEffect(() => {
    const t = window.setTimeout(() => saveProfile(verdicts, peopleVerdicts, skipped), 400);
    return () => window.clearTimeout(t);
  }, [verdicts, peopleVerdicts, skippedKey]);

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

  // One history stack for BOTH card types. It used to hold title verdicts only,
  // so the deck's DEFAULT mode — people — had no Undo at all, while Films and
  // Shows did. CHARTER F5 lists Undo under "Design rules that are not optional",
  // and a mis-swipe there is the most expensive kind: one person card touches
  // every title they are in.
  const rate = (tconst, v) => {
    setHistory((h) => [...h, { kind: "title", id: tconst, prev: verdicts[tconst] ?? null }]);
    setVerdicts((s) => { const n = { ...s }; if (v == null) delete n[tconst]; else n[tconst] = v; return n; });
  };
  // Undoable like any other verdict — a mis-tapped "not seen" removes a card
  // from the session, which is exactly the kind of slip Undo exists for.
  // Toggles, so the tile's "not seen" mark can be un-set the same way the other
  // two can. History records which way it went, so Undo restores either.
  const skip = (tconst) => {
    setSkipped((s) => {
      const was = s.has(tconst);
      setHistory((h) => [...h, { kind: "skip", id: tconst, was }]);
      const n = new Set(s);
      if (was) n.delete(tconst); else n.add(tconst);
      return n;
    });
  };
  // `v == null` UN-RATES (removes the key) rather than storing a third state —
  // the same contract `rate` already has for titles, and what the search-side
  // toggle needs when you click the mark that is already lit. The deck's own
  // "not seen" still passes the literal "skip", which is a real verdict there
  // (it is what takes the card out of the deck), so both callers stay honest.
  const ratePerson = (nconst, v) => {
    setHistory((h) => [...h, { kind: "person", id: nconst, prev: peopleVerdicts[nconst] ?? null }]);
    setPeopleVerdicts((s) => { const n = { ...s }; if (v == null) delete n[nconst]; else n[nconst] = v; return n; });
  };

  const undo = () => {
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
  // The genre chip filters the RESULTS here, in one line, rather than as a
  // `genres.value ~ $GENRE` clause in the recommendation query -- see the block
  // comment on that query for why the model must never do it.
  const inGenre = React.useCallback((r) => {
    if (!genreNow) return true;
    const g = r.genres;
    return Array.isArray(g) ? g.includes(genreNow) : String(g || "").includes(genreNow);
  }, [genreNow]);

  // Titles carrying a person the visitor swiped LEFT on. CHARTER F5 calls a
  // disliked actor "a strong negative"; exclusion is the strongest honest
  // reading and the one that cannot fail quietly.
  const veto = React.useMemo(
    () => new Set((vetoed.rows || []).map((r) => r.tconst)), [vetoed.rows]);

  const recommended = React.useMemo(() => {
    let rows = (recs.rows || [])
      .filter((r) => !verdicts[r.tconst] && !veto.has(r.tconst))
      .filter(inGenre)
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
      // ⚑ THIN-PROFILE ORDERING. The comment above says "genre agreement
      // carries the ranking". With a RICH liked set that is true, because
      // genre_fit spans a wide range. With ONE or TWO liked titles it is
      // measurably FALSE: for a single like on Gladiator, genre_fit spans only
      // 5.74..6.03 (5%) while the candidate's own vector length spans 17..25
      // (47%), so the cosine denominator, not the signal, decides the order.
      // Measured consequence: The Counselor (genre_fit 5.74, norm 17.1) ranked
      // FIRST, above Kingdom of Heaven (6.03, norm 21.4) and First Knight
      // (6.03, norm 24.1) — a candidate with strictly LOWER genre agreement
      // winning purely by having fewer features. That is the short-vector bias
      // the cosine was introduced to prevent, reappearing from the other side.
      //
      // So below three liked titles, order by genre agreement FIRST and use the
      // cosine only to break ties within equal agreement. Gladiator then leads
      // with the five full-match historical epics (Robin Hood, King Arthur,
      // Kingdom of Heaven, Exodus, First Knight) and The Counselor falls to 6th.
      //
      // ⛔ DELIBERATELY NOT APPLIED TO RICH PROFILES, AND THIS WAS MEASURED IN
      // THE RENDERED UI, NOT REASONED ABOUT. Upstream's own ranking style is one
      // legible aggregate per query with a stated reason (`order_by:
      // total_ratings desc` "a symmetric aggregate that survives the fan-out";
      // `numVotes.max()` "rather than sum() so it stays the title's own vote
      // count"), so ordering by genre agreement alone everywhere is the
      // Lloyd-shaped choice. It was tried, on the validated Coen/Tarantino
      // five-title seed, and it REGRESSES:
      //
      //   cosine (kept):  Blood Simple, Kill Bill, RESERVOIR DOGS, Ladykillers…
      //   genre-first:    Ladykillers, Blood Simple, Jackie Brown, Kill Bill…
      //                   Reservoir Dogs falls out of the top 14 entirely, and
      //                   CSI: Crime Scene Investigation and MobLand come in.
      //
      // Reservoir Dogs is the exact title the original scoring work cited as the
      // good outcome. Losing it to gain a TV procedural is a worse list, so the
      // cosine stays wherever genre_fit has real dynamic range. Style-match to
      // upstream governs the VISUAL system (CHARTER §5); it does not outrank a
      // measured quality regression. Narrow the fix to the regime where it was
      // measured to help; do not re-tune the regime that already works.
      .sort((a, b) => (liked.length < 3 && Math.abs(num(a.genre_fit) - num(b.genre_fit)) > 1e-9
        ? num(b.genre_fit) - num(a.genre_fit)
        : b._score - a._score));
    // Titles carried in by a liked PERSON, appended after the feature-scored
    // ones. They earn their place on the person alone, so they are not scored
    // against the genre profile and must not outrank things that were.
    const seen = new Set(rows.map((r) => r.tconst));
    const byPerson = (recsPeople.rows || [])
      .filter((r) => !verdicts[r.tconst] && !seen.has(r.tconst) && !veto.has(r.tconst) && inGenre(r))
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
  }, [recs.rows, recsPeople.rows, verdicts, veto, inGenre, liked.length]);

  // people count as ratings: swiping right on an actor is a real signal and
  // the list must fill from it alone, or the person cards look decorative
  // A disliked person counts as a rating: it is a verdict the visitor gave, and
  // leaving it out of `rated` is what let the whole left-swipe path read as
  // "nothing rated yet" after several deliberate swipes.
  const rated = liked.length + disliked.length + likedPeople.length + dislikedPeople.length;

  // One short line per tile saying why it is there. Built from figures the
  // scoring query ALREADY returns -- shared_crew / shared_cast / shared_genres
  // -- so it costs no extra query and cannot drift from the ranking it explains.
  const reasonFor = React.useCallback((r) => {
    const crew = num(r.shared_crew), cast = num(r.shared_cast), gen = num(r.shared_genres);
    if (crew >= 1) return `${crew} shared ${crew === 1 ? "director/writer" : "crew"}`;
    if (cast >= 3) return `${cast} shared cast`;
    if (gen >= 2) return `${gen} shared genres`;
    return null;
  }, []);

  // THE COLD START. Andrew: "'Your next watch' is useless if people haven't
  // selected any ratings yet." The previous fix hid the section at zero
  // ratings, which answers him and breaks CHARTER §4 in the same edit -- "the
  // tool must produce a defensible list from ZERO explicit input."
  // So at zero ratings the list is `popular_picks`: acclaimed and widely seen,
  // inside whatever genre/period is selected, and LABELLED as that rather than
  // passed off as personal.
  // ⛔ A NEGATIVE-ONLY PROFILE USED TO EMPTY THE PAGE. One left swipe on the
  // first face — the deck's default mode, and the most natural first gesture
  // there is — took the list from 28 tiles to 0, printed "Nothing matches those
  // filters." when no filter was set, and unmounted Copy link and Copy list.
  // Dislikes alone give the scorer nothing to score TOWARD, so `recommended` is
  // legitimately empty; the bug is treating "no personalised list yet" as "no
  // list". CHARTER §4's cold-start rule and §1's criteria 3 and 4 both say a
  // list must be there. So the fallback is the cold-start list with the
  // visitor's negatives honoured, and it says which one it is showing.
  // This used to interleave a film lane and a TV lane so a mixed corpus could
  // not open as 60 films. With television removed (CHARTER §7.2) there is one
  // lane, and interleaving one lane is just a slower slice.
  const coldFallback = React.useMemo(
    () => (popular.rows || []).slice(0, 60),
    [popular.rows]);

  // Three states, and each says which one it is. `personalised` is the only one
  // that may claim to be about you.
  const listMode = rated === 0 ? "cold" : recommended.length ? "personalised" : "negative-only";
  const list = React.useMemo(() => {
    if (listMode === "personalised") return recommended;
    return coldFallback.filter((r) => !verdicts[r.tconst] && !veto.has(r.tconst));
  }, [listMode, recommended, coldFallback, verdicts, veto]);

  // A card sized to fill the screen does not fill the screen if it opens BELOW
  // it: the genre chips and the timeline are ~490px of chrome, so at a laptop
  const [copied, setCopied] = React.useState(null);
  const copy = (what, text) => {
    const ok = () => { setCopied(what); window.setTimeout(() => setCopied(null), 1600); };
    try {
      navigator.clipboard.writeText(text).then(ok, ok);
    } catch (e) {
      // clipboard is permission-gated and absent over plain http on some
      // browsers; the fallback keeps the button honest rather than silent
      const ta = document.createElement("textarea");
      ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand("copy"); } catch (err) {}
      document.body.removeChild(ta); ok();
    }
  };
  const listAsText = React.useMemo(() => list.slice(0, 28).map((r) => {
    const yr = r.start_year ? ` (${Math.round(num(r.start_year))})` : "";
    // The exported list carries the services THIS visitor can watch on -- a
    // copied list naming Hulu to someone without Hulu is the same defect as the
    // on-screen mark, just pasted somewhere else.
    const on = (offersFor[r.tconst]?.services || []).map((x) => x.service).join(", ");
    return `${r.primary_title}${yr}${on ? ` · ${on}` : ""}`;
  }).join("\n"), [list, offersFor]);

  // --- ratings import (CHARTER §4.2) ---------------------------------------
  // The charter demoted this from headline to power-user path and the build
  // order permits cutting it. It ships because it is the sharpest demonstration
  // of the thing this whole architecture exists to show: the query engine is in
  // the BROWSER, so a ratings file is parsed where it sits and no upload
  // happens. Upstream's entire design is "static site, parquet, no backend";
  // an import that needs a server would contradict it, and this one cannot.
  //
  // IMDb's export carries `Const` (tt…) so it matches EXACTLY. Letterboxd's
  // does not, and title+year matching is a different job -- so a Letterboxd
  // file is REFUSED BY NAME rather than silently importing zero rows.
  const [importMsg, setImportMsg] = React.useState(null);

  const importCsv = (file) => {
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
        const known = new Set((seeds.rows || []).map((r) => r.tconst));
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
        // The corpus is upstream's ~24k popular titles, not all of IMDb, so a
        // real export will contain films that are simply not here. Saying so is
        // the difference between an honest count and a silently short list.
        setImportMsg(
          `Imported ${up + down} ratings (${up} liked, ${down} not for you). ` +
          `Nothing left your browser.`);
      } catch (e) {
        setImportMsg("Could not parse that file as a CSV.");
      }
    };
    reader.readAsText(file);
  };

  // Escape closes the detail modal. It did, then stopped when the swipe deck
  // took over the keydown listener, which turns a modal into a trap for anyone
  // not using a mouse. Bound separately from the deck so the two cannot fight.
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === "Escape") setOpen(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const Chip = (props) => <ChipBase ink={ink} {...props} />;

  return (
    <div style={{ maxWidth: 1120, margin: "0 auto", padding: "22px 24px 48px", color: "var(--dash-fg)" }}>
      <h1 style={{ fontSize: 22, fontWeight: 680, letterSpacing: "-.02em", margin: "0 0 3px" }}>
        {dashboard.title}
      </h1>
      <p style={{ color: ink.muted, fontSize: 13.5, lineHeight: 1.45, margin: "0 0 20px" }}>
        Rate a few things. Get a list, and where to watch it.
      </p>

      {/* Tapping the SELECTED genre clears it. Upstream's picker has no clear
          because on his page the genre is the required input; here it is an
          optional filter, and without this you cannot get back to all genres
          without reloading. The behaviour is his own Timeline idiom ("tapping
          the bar that is already the whole selection clears it"), not a new
          one. */}
      <GenrePicker ink={ink} options={genreOptions} current={genreNow}
                   onPick={(g) => gGenre.set(!g || g === genreNow ? "" : filters.oneOf(g))} />
      <Timeline ink={ink} periods={periods} range={yearRange}
                onSelect={(lo, hi) => gYear.set(lo == null ? "" : filters.between(lo, (hi ?? lo) + 4))} />

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

      {/* ------------------------------ the list ------------------------- */}
      <div style={{ margin: "0 0 26px" }}>
        {/* ⛑ WHY THIS LIST. Andrew, 2026-08-05: it "needs to be immediately
            clear and apparent how it works and what your preferences do to the
            recommendations." Deliberately compact -- the deep, table-driven
            version of this is the swipe site's job (CHARTER §7.4); what belongs
            here is the one line that stops the list being a black box. */}
        {rated > 0 && (profileQ.rows || []).length > 0 && (
          <div style={{ marginBottom: 12, padding: "10px 12px", borderRadius: 8,
                        background: ink.surface, border: `1px solid ${ink.track}` }}>
            <div style={{ fontSize: 11, letterSpacing: ".06em", textTransform: "uppercase",
                          color: ink.muted, fontWeight: 700, marginBottom: 7 }}>
              What your ratings are doing
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 5, alignItems: "center" }}>
              {(profileQ.rows || []).slice(0, 8).map((r) => (
                <span key={r.kind + r.feature}
                      style={{ fontSize: 12, padding: "3px 8px", borderRadius: 6,
                               border: `1px solid ${ink.track}`, color: ink.text2,
                               background: "transparent", whiteSpace: "nowrap" }}>
                  {r.label}
                  <span style={{ color: ink.muted, marginLeft: 5, fontSize: 11 }}>
                    {r.kind === "genre" ? "genre" : r.kind === "crew" ? "director/writer" : "cast"}
                    {num(r.from_titles) > 1 ? ` ×${Math.round(num(r.from_titles))}` : ""}
                  </span>
                </span>
              ))}
            </div>
            <div style={{ fontSize: 11.5, color: ink.muted, marginTop: 7 }}>
              Strongest first, from {liked.length} liked {liked.length === 1 ? "title" : "titles"}.
              A rare shared name counts for far more than a common genre, which is why one distinctive
              director outranks Drama.
            </div>
          </div>
        )}
        {/* Placed with the list rather than up with the filters on purpose: it
            governs what the marks ON THESE TILES say, and the top of the page
            already carries more controls than it should (CHARTER §7.3). */}
        <ServicePicker ink={ink} all={allServices} mine={myServices} onToggle={toggleService} />
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 8, flexWrap: "wrap" }}>
          <div style={{ fontSize: 11, letterSpacing: ".08em", textTransform: "uppercase", color: ink.muted, fontWeight: 700 }}>
            Your next watch
          </div>
          <span style={{ fontSize: 12, color: ink.muted }}>
            {listMode === "cold" ? "top rated, until you rate something"
              : listMode === "negative-only" ? "top rated. Like something to make this yours"
              : `${recommended.length} from ${rated} rating${rated === 1 ? "" : "s"}`}
          </span>
          {/* CHARTER §1 success criterion 4: "a list you cannot take with you was
              not delivered". It never was. Ratings already round-trip through
              the URL, so the link IS the list; the text copy is for anyone who
              wants it outside a browser. */}
          {list.length > 0 && (
            <span style={{ display: "flex", gap: 6, marginLeft: "auto" }}>
              <CopyButton ink={ink} label="Copy link" done={copied === "link"}
                          onCopy={() => copy("link", window.location.href)} />
              <CopyButton ink={ink} label="Copy list" done={copied === "list"}
                          onCopy={() => copy("list", listAsText)} />
            </span>
          )}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: `repeat(auto-fill, ${TILE_W}px)`, gap: 14 }}>
          {list.slice(0, 28).map((r) => (
            <Tile key={r.tconst} ink={ink} row={r} offers={offersFor[r.tconst]}
                  reason={reasonFor(r)}
                  onOpen={() => { setOpen(r); gDetail.set(filters.oneOf(r.tconst)); }} />
          ))}
        </div>
        {list.length === 0 && (
          <div style={{ fontSize: 12.5, color: ink.muted }}>Nothing matches those filters.</div>
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
              {compact(num(open.num_votes))} ratings
            </div>
            <Availability ink={ink} offers={detail.rows || []} myServices={myServices}
                          title={open.primary_title} year={open.start_year} />
            <button type="button" onClick={() => setOpen(null)}
              style={{ marginTop: 16, font: "inherit", fontSize: 12.5, cursor: "pointer", padding: "6px 11px",
                       borderRadius: 7, background: ink.surface, color: ink.text2, border: `1px solid ${ink.track}` }}>Close</button>
          </div>
        </div>
      )}
    </div>
  );
}
