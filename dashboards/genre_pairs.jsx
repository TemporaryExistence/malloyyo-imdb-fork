// @ts-nocheck
// Genre combinations — pick ONE genre and see every genre it pairs with as a
// shelf of its seven most-voted films, poster above title.
//
// Layout is desktop-first: shelves are a fixed 7-up grid on a wide screen and
// fall back to horizontal scroll when the column gets narrow. The picker is a
// plain wrapped chip row rather than a dropdown or sheet — with only 25 genres,
// showing all of them makes it obvious the selection is yours to change.
//
// The viz "kit" (theme tokens, num/compact) is copied across dashboards on
// purpose: jsx components are sandboxed (only React + @malloyyo/dashboard
// import), so there is no shared local module to import.
import React from "react";
import { filters, useGiven, useQuery } from "@malloyyo/dashboard";
import { parseProviders, visibleServices, loadMyServices, saveMyServices } from "./lib/streaming.js";
import { StreamableMark, ServicePicker } from "./lib/streamui.jsx";

/* ============================ shared viz kit ============================ */
const INK = {
  light: { surface: "#fcfcfb", track: "#eceff3", muted: "#898781", text: "#0b0b0b", text2: "#52514e", accent: "#2a78d6" },
  dark: { surface: "#1a1a19", track: "#26262b", muted: "#898781", text: "#ffffff", text2: "#c3c2b7", accent: "#4f9bff" },
};

function relLum(c) {
  if (!c) return null;
  c = c.trim();
  let r, g, b, m;
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

// Query numerics arrive as STRINGS — always coerce before formatting or maths.
const num = (x) => (x == null || x === "" ? 0 : +x);
const compact = (n) =>
  n >= 1e6 ? (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + "M" : n >= 1e3 ? Math.round(n / 1e3) + "K" : String(n);
/* ========================== end shared viz kit ========================= */

/* --------------------- FORK ADDITION: where to watch -------------------- */
// StreamableMark and ServicePicker live in ./lib/streamui.jsx, shared with
// next_watch. TMDB requires JustWatch credited on EACH media item; the mark
// carries that in its own label, so the two travel together wherever it renders.

// A given holds a filter EXPRESSION ('Comedy'), not a bare value. Unwrap for
// display, re-wrap with filters.oneOf when writing back.
const unwrap = (src) => {
  if (!src) return "";
  try { const v = filters.values(src); if (Array.isArray(v) && v.length) return String(v[0]); } catch (e) {}
  return String(src).replace(/^'|'$/g, "");
};

/* -------------------------------- genre picker ------------------------- */
// Every genre, always visible. The selected one is filled; the rest are
// outlined and obviously tappable.
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
const TILE_W = 104;

function Tile({ ink, row, offers }) {
  const [bad, setBad] = React.useState(false);
  const frame = { width: TILE_W, height: 156, borderRadius: 7, background: ink.track, overflow: "hidden", display: "block" };
  // ⛔ THE MARK IS A SIBLING OF THE LINK, NOT A CHILD OF IT. The tile used to be
  // one big <a> with the mark inside; that was fine while the mark was inert
  // decoration, and became invalid the moment it grew a button and its own
  // links -- an <a> inside an <a> is not valid HTML and the browser silently
  // restructures the DOM around it, which breaks the tile's own click. So the
  // outer element is a positioned <div>, the poster and caption are the link,
  // and the mark sits beside it.
  return (
    <div style={{ width: TILE_W, flex: "none", position: "relative" }}>
      <a
        href={row.movie_url || undefined}
        target="_blank"
        rel="noopener noreferrer"
        title={`${row.title} (${row.release_year})`}
        style={{ textDecoration: "none", color: "inherit", display: "block" }}
      >
        {/* The mark is anchored to the POSTER, not to the whole tile. Anchored
            to the tile its bottom:3 sat on the caption, and 34 of 123 marks
            covered the year and vote count (worst case 54px of text). */}
        <span style={{ position: "relative", display: "block", width: TILE_W, height: 156 }}>
          {row.movie_image && !bad ? (
            <img
              src={row.movie_image}
              alt={`Poster for ${row.title}`}
              width={TILE_W}
              height={156}
              loading="lazy"
              onError={() => setBad(true)}
              style={{ ...frame, objectFit: "cover" }}
            />
          ) : (
            <div style={{ ...frame, display: "grid", placeItems: "center" }} aria-hidden="true">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={ink.muted} strokeWidth="1.5">
                <rect x="3" y="3" width="18" height="18" rx="2.5" />
                <path d="m4 16 4.5-4.5 3 3L15 11l5 5" />
              </svg>
            </div>
          )}
        </span>
        <div style={{
          fontSize: 12.5, fontWeight: 600, color: ink.text, lineHeight: 1.28,
          marginTop: 7,
          display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden",
        }}>
          {row.title}
        </div>
        <div style={{ fontSize: 11, color: ink.muted, marginTop: 2, fontVariantNumeric: "tabular-nums" }}>
          {row.release_year} · {compact(row.total_votes)}
        </div>
      </a>
      {/* Positioned against the poster box, which is the first 156px of the
          tile -- same visual result as before, valid markup this time. */}
      <span style={{ position: "absolute", left: 0, top: 0, width: TILE_W, height: 156, pointerEvents: "none" }}>
        <span style={{ pointerEvents: "auto" }}>
          <StreamableMark ink={ink} offers={offers} title={row.title} year={row.release_year} />
        </span>
      </span>
    </div>
  );
}

const PER_ROW = 7;

function Shelf({ ink, genre, shelf, offersFor}) {
  // Rows revealed so far. Resets when the shelf's contents change (new genre or
  // period) so a deep-expanded shelf doesn't stay expanded into the next view.
  const [rows, setRows] = React.useState(1);
  const key = shelf.subgenre + ":" + shelf.titles.length;
  const lastKey = React.useRef(key);
  if (lastKey.current !== key) { lastKey.current = key; if (rows !== 1) setRows(1); }

  const visible = shelf.titles.slice(0, rows * PER_ROW);
  const remaining = shelf.titles.length - visible.length;

  return (
    <section style={{ margin: "0 0 26px" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 9, marginBottom: 10 }}>
        <h2 style={{ fontSize: 15, fontWeight: 660, margin: 0, color: ink.text }}>
          {genre} <span style={{ color: ink.muted, fontWeight: 500 }}>+</span> {shelf.subgenre}
        </h2>
        <span style={{ fontSize: 12, color: ink.muted, fontVariantNumeric: "tabular-nums" }}>
          {compact(shelf.title_count)} films
        </span>
      </div>

      {/* Fixed 7-up so "another row" means another row; scrolls if the column
          is too narrow to hold seven tiles. */}
      <div style={{
        display: "grid", gap: 14,
        gridTemplateColumns: `repeat(${PER_ROW}, ${TILE_W}px)`,
        overflowX: "auto", paddingBottom: 4,
      }}>
        {visible.map((t, i) => <Tile key={t.tconst || i} ink={ink} row={t} offers={offersFor && offersFor[t.tconst]} />)}
      </div>

      {remaining > 0 && (
        <button
          type="button"
          onClick={() => setRows((r) => r + 1)}
          style={{
            font: "inherit", fontSize: 12, fontWeight: 600, cursor: "pointer",
            marginTop: 10, padding: "5px 11px", borderRadius: 7,
            border: "1px solid var(--dash-border)", background: ink.surface, color: ink.text2,
          }}
        >
          Show {Math.min(remaining, PER_ROW)} more
        </button>
      )}
    </section>
  );
}

/* -------------------------------- dashboard ---------------------------- */
export default function Dashboard({ dashboard, givens }) {
  const { ink } = useTheme();
  // FORK ADDITION: US availability, indexed by title so a tile lookup is O(1).
  // Four vote bands, merged. One query cannot answer this: 15,343 titles have US
  // streaming and the runtime caps a result at 5,000 rows regardless of `limit`
  // (measured — raising it to 20,000 changed nothing on screen). The band cuts
  // are re-derived by scripts/check_bands.sh, which fails the data refresh if
  // the distribution moves under them.
  const avail = useQuery({ query: "availability", givens });
  const availB = useQuery({ query: "availability_b", givens });
  const availC = useQuery({ query: "availability_c", givens });
  const availD = useQuery({ query: "availability_d", givens });
  // The visitor's own subscriptions, shared with next_watch through the same
  // localStorage key -- picking Netflix on one page must not leave the other
  // page still offering Hulu.
  const [myServices, setMyServices] = React.useState(() => loadMyServices());
  const toggleService = React.useCallback((name) => {
    setMyServices((cur) => {
      const next = cur.includes(name) ? cur.filter((x) => x !== name) : [...cur, name];
      saveMyServices(next);
      return next;
    });
  }, []);

  const offersFor = React.useMemo(() => {
    const m = {};
    for (const q of [avail, availB, availC, availD]) {
      for (const r of q.rows || []) {
        const all = parseProviders(r.provider_entries);
        m[r.imdb_id] = { all, services: visibleServices(all, myServices), link: r.link || null };
      }
    }
    return m;
  }, [avail.rows, availB.rows, availC.rows, availD.rows, myServices]);

  const allServices = React.useMemo(() => {
    const count = new Map();
    for (const q of [avail, availB, availC, availD])
      for (const r of q.rows || [])
        for (const p of parseProviders(r.provider_entries))
          count.set(p.service, (count.get(p.service) || 0) + 1);
    return [...count.entries()].sort((a, b) => b[1] - a[1]).map(([sv]) => sv);
  }, [avail.rows, availB.rows, availC.rows, availD.rows]);
  const gGenre = useGiven("GENRE");
  const gYear = useGiven("RELEASE_YEAR");

  const genre = unwrap(gGenre.value);

  // RELEASE_YEAR holds an inclusive year range ('[1990 to 2004]'). Read it back
  // as the first and last PERIOD it covers: the range's end is the LAST year of
  // its bucket, so that bucket starts 4 years earlier.
  const range = React.useMemo(() => {
    const src = String(gYear.value || "");
    if (!src) return null;
    const r = filters.numberRange(src);
    if (!r) return null;
    return { lo: r.lo, hi: Math.max(r.lo, r.hi - 4) };
  }, [gYear.value]);

  const options = useQuery({ query: "genre_options", givens });
  const shelvesQ = useQuery({ query: "genre_shelves", givens });
  const periodsQ = useQuery({ query: "genre_periods", givens });

  const genreOptions = React.useMemo(
    () => (options.rows || []).map((r) => ({ genre: r.genre, count: num(r.title_count) })).filter((o) => o.genre),
    [options.rows]
  );

  const periods = React.useMemo(
    () => (periodsQ.rows || [])
      .map((r) => ({ period: num(r.period), count: num(r.title_count) }))
      .filter((p) => p.period > 0)
      .sort((a, b) => a.period - b.period),
    [periodsQ.rows]
  );

  // Nested queries come back with the nest as a real JS array on each row.
  const shelves = React.useMemo(
    () => (shelvesQ.rows || []).map((r) => ({
      subgenre: r.subgenre,
      title_count: num(r.title_count),
      titles: (r.titles || []).map((t) => ({
        tconst: t.tconst,
        title: t.title,
        release_year: num(t.release_year),
        movie_image: t.movie_image || null,
        movie_url: t.movie_url || null,
        total_votes: num(t.total_votes),
      })),
    })).filter((s) => s.subgenre && s.titles.length),
    [shelvesQ.rows]
  );

  // Keep the previous shelves on screen while a new genre loads, so the page
  // dims rather than flashing empty.
  const last = React.useRef(shelves);
  if (shelves.length) last.current = shelves;
  const shown = shelves.length ? shelves : shelvesQ.loading ? last.current : shelves;
  const stale = shelvesQ.loading && shelves.length === 0 && last.current.length > 0;

  return (
    <div style={{ maxWidth: 1120, margin: "0 auto", padding: "22px 24px 48px", color: "var(--dash-fg)" }}>
      <h1 style={{ fontSize: 22, fontWeight: 680, letterSpacing: "-.02em", margin: "0 0 3px" }}>
        {dashboard.title}
      </h1>
      <p style={{ color: ink.muted, fontSize: 13.5, lineHeight: 1.45, margin: "0 0 20px" }}>
        Every genre <strong style={{ color: ink.text2 }}>{genre || "—"}</strong> pairs with, each showing its
        seven most-voted films. Shelves ranked by total ratings.
      </p>

      <GenrePicker
        ink={ink}
        options={genreOptions}
        current={genre}
        onPick={(g) => gGenre.set(filters.oneOf(g))}
      />

      <Timeline
        ink={ink}
        periods={periods}
        range={range}
        onSelect={(lo, hi) => gYear.set(lo == null ? "" : filters.between(lo, (hi ?? lo) + 4))}
      />

      {/* Sits directly above the shelves it governs, not up with the genre and
          period controls: it changes what the MARKS say, not which films are
          shown, and grouping it with the filters would read as a third filter. */}
      <ServicePicker ink={ink} all={allServices} mine={myServices} onToggle={toggleService} />

      <div style={{ opacity: stale ? 0.45 : 1, transition: "opacity .15s ease" }}>
        {shelvesQ.error ? (
          <div style={{ color: "var(--dash-danger)", fontSize: 13 }}>{String(shelvesQ.error)}</div>
        ) : shelvesQ.loading && shown.length === 0 ? (
          <div style={{ color: ink.muted, fontSize: 13, padding: "40px 0", textAlign: "center" }}>Loading&hellip;</div>
        ) : shown.length === 0 ? (
          <div style={{ color: ink.muted, fontSize: 13.5, padding: "40px 0", textAlign: "center" }}>
            No pairings for {genre || "this genre"}
            {range ? ` in ${range.lo}–${range.hi + 4}` : ""}.
          </div>
        ) : (
          shown.map((s) => <Shelf key={s.subgenre} ink={ink} genre={genre} shelf={s} offersFor={offersFor} />)
        )}
      </div>
    </div>
  );
}
