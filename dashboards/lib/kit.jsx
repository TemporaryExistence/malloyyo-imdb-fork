// @ts-nocheck
// Shared presentation kit for the fork's dashboard pages.
//
// EXTRACTED 2026-08-07 from next_watch.jsx, when that page was split into
// `rate` (collect verdicts) and `next_watch` (show the list) per
// NEXT-LAYOUT-WORK.md §3. Both pages render posters, both need the ink tokens,
// and both filter by genre and period — so without one definition the split
// would immediately fork the visual language it was meant to simplify.
//
// ⛑ The old comment at the top of next_watch.jsx claimed "jsx components are
// sandboxed, so there is no shared local module to import". That is NOT true and
// was already contradicted by the same file importing ./lib/streaming.js,
// ./lib/streamui.jsx, ./lib/searchui.jsx and ./lib/profile.js. Local ESM imports
// resolve fine; the duplication it excused was avoidable.
import React from "react";
import { parseProviders, visibleServices, serviceLink, canonicalService } from "./streaming.js";
import { LOGO, StreamableMark } from "./streamui.jsx";

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

export { INK, GOOD, BAD, relLum, useTheme, num, compact, GenrePicker, periodLabel, Timeline, TILE_W, Availability, Tile, CopyButton, Badge };
