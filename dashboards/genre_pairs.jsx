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

// A given holds a filter EXPRESSION ('Comedy'), not a bare value. Unwrap for
// display, re-wrap with filters.oneOf when writing back.
const unwrap = (src) => {
  if (!src) return "";
  try { const v = filters.values(src); if (Array.isArray(v) && v.length) return String(v[0]); } catch (e) {}
  return String(src).replace(/^'|'$/g, "");
};

const Chevron = ({ dir, size = 16, color }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true" style={{ display: "block" }}>
    <path d={dir === "left" ? "M10 3.5 5.5 8 10 12.5" : "M6 3.5 10.5 8 6 12.5"}
          stroke={color} strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

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

/* --------------------------------- year rail --------------------------- */
// "All Time" pinned at the left, then step-back / year / step-forward. Stepping
// walks the years this genre ACTUALLY has films in, so you never land on an
// empty screen; from All Time, stepping enters at the newest year.
function YearRail({ ink, years, value, onChange }) {
  const idx = value == null ? -1 : years.indexOf(value);
  const canPrev = years.length > 0 && (idx === -1 || idx > 0);
  const canNext = idx !== -1 && idx < years.length - 1;
  const step = (delta) => {
    if (!years.length) return;
    if (idx === -1) { onChange(years[years.length - 1]); return; }
    const next = idx + delta;
    if (next >= 0 && next < years.length) onChange(years[next]);
  };
  const allTime = value == null;
  const btn = (enabled) => ({
    width: 40, height: 40, flex: "none", display: "grid", placeItems: "center",
    borderRadius: 10, cursor: enabled ? "pointer" : "default",
    border: "1px solid var(--dash-border)", background: ink.surface,
    opacity: enabled ? 1 : 0.35,
  });

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "0 0 22px" }}>
      <button
        type="button"
        onClick={() => onChange(null)}
        aria-pressed={allTime}
        style={{
          font: "inherit", fontSize: 13, fontWeight: 620, cursor: "pointer",
          height: 40, padding: "0 14px", flex: "none", borderRadius: 10,
          border: `1.5px solid ${allTime ? ink.accent : "var(--dash-border)"}`,
          background: allTime ? ink.accent : ink.surface,
          color: allTime ? "#fff" : ink.text2,
        }}
      >
        All Time
      </button>
      <button type="button" onClick={() => step(-1)} disabled={!canPrev} aria-label="Previous year" style={btn(canPrev)}>
        <Chevron dir="left" color={ink.text2} />
      </button>
      <div style={{
        width: 132, height: 40, flex: "none", display: "grid", placeItems: "center",
        borderRadius: 10, border: "1px solid var(--dash-border)", background: ink.surface,
        fontSize: 16, fontWeight: 680, fontVariantNumeric: "tabular-nums",
        color: allTime ? ink.muted : ink.text,
      }}>
        {allTime ? "1915 – 2025" : value}
      </div>
      <button type="button" onClick={() => step(1)} disabled={!canNext} aria-label="Next year" style={btn(canNext)}>
        <Chevron dir="right" color={ink.text2} />
      </button>
    </div>
  );
}

/* ---------------------------------- shelves ---------------------------- */
const TILE_W = 104;

function Tile({ ink, row }) {
  const [bad, setBad] = React.useState(false);
  const frame = { width: TILE_W, height: 156, borderRadius: 7, background: ink.track, overflow: "hidden", display: "block" };
  return (
    <a
      href={row.movie_url || undefined}
      target="_blank"
      rel="noopener noreferrer"
      title={`${row.title} (${row.release_year})`}
      style={{ width: TILE_W, flex: "none", textDecoration: "none", color: "inherit", display: "block" }}
    >
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
  );
}

function Shelf({ ink, genre, shelf }) {
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
      <div style={{
        display: "flex", gap: 14, overflowX: "auto", paddingBottom: 4,
        scrollbarWidth: "thin",
      }}>
        {shelf.titles.map((t, i) => <Tile key={t.tconst || i} ink={ink} row={t} />)}
      </div>
    </section>
  );
}

/* -------------------------------- dashboard ---------------------------- */
export default function Dashboard({ dashboard, givens }) {
  const { ink } = useTheme();
  const gGenre = useGiven("GENRE");
  const gYear = useGiven("RELEASE_YEAR");

  const genre = unwrap(gGenre.value);
  const year = React.useMemo(() => {
    const n = parseInt(unwrap(gYear.value), 10);
    return Number.isFinite(n) ? n : null;
  }, [gYear.value]);

  const options = useQuery({ query: "genre_options", givens });
  const shelvesQ = useQuery({ query: "genre_shelves", givens });
  const yearsQ = useQuery({ query: "genre_pair_years", givens });

  const genreOptions = React.useMemo(
    () => (options.rows || []).map((r) => ({ genre: r.genre, count: num(r.title_count) })).filter((o) => o.genre),
    [options.rows]
  );

  const years = React.useMemo(
    () => (yearsQ.rows || []).map((r) => num(r.release_year)).filter((y) => y > 0).sort((x, y) => x - y),
    [yearsQ.rows]
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

      <YearRail ink={ink} years={years} value={year} onChange={(y) => gYear.set(y == null ? "" : String(y))} />

      <div style={{ opacity: stale ? 0.45 : 1, transition: "opacity .15s ease" }}>
        {shelvesQ.error ? (
          <div style={{ color: "var(--dash-danger)", fontSize: 13 }}>{String(shelvesQ.error)}</div>
        ) : shelvesQ.loading && shown.length === 0 ? (
          <div style={{ color: ink.muted, fontSize: 13, padding: "40px 0", textAlign: "center" }}>Loading&hellip;</div>
        ) : shown.length === 0 ? (
          <div style={{ color: ink.muted, fontSize: 13.5, padding: "40px 0", textAlign: "center" }}>
            No pairings for {genre || "this genre"}{year != null ? ` in ${year}` : ""}.
          </div>
        ) : (
          shown.map((s) => <Shelf key={s.subgenre} ink={ink} genre={genre} shelf={s} />)
        )}
      </div>
    </div>
  );
}
