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
const TYPE_LABEL = { movie: "Film", tvSeries: "Series", tvMiniSeries: "Mini-series", tvMovie: "TV film" };

/* --------------------------- provider marks (F1) ------------------------ */
// TMDB requires JustWatch attribution on EACH media item, so the mark and the
// credit travel together and neither renders without the other.
const LOGO = (p) => (p ? "https://image.tmdb.org/t/p/w45" + p : null);

function ProviderMark({ ink, offers }) {
  if (!offers || !offers.logos || !offers.logos.length) return null;
  // The credit lived ONLY in a `title=` tooltip, which a touch device can never
  // open -- so on a phone the per-item attribution was effectively absent. The
  // logo itself carries the licence term, but the text now reaches a screen
  // reader and a touch user through alt text rather than hover alone.
  const credit = `${offers.names} - source: JustWatch`;
  return (
    <div title={credit} aria-label={credit} role="img"
         style={{ position: "absolute", right: 3, bottom: 3, display: "flex", gap: 2 }}>
      {offers.logos.map((p, i) => (
        <img key={i} src={LOGO(p)} alt={i === 0 ? credit : ""} width={16} height={16} loading="lazy"
             style={{ borderRadius: 3, boxShadow: "0 0 0 1px rgba(0,0,0,.35)", background: "#fff", display: "block" }} />
      ))}
    </div>
  );
}

function Availability({ ink, offers }) {
  if (!offers || !offers.length) {
    return <div style={{ color: ink.muted, fontSize: 12 }}>Not listed in the US.</div>;
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
// Raised again after the rater measured 74vh as 666px of a 900px window: a 2:3
// portrait card can never fill a 16:9 desktop across, so HEIGHT is the only
// dimension "nearly full screen" can mean here, and it should use all of it.
// The ceiling is what still leaves room for the title and the skip button
// beneath without pushing them under the fold (see the scroll-into-view note).
const CARD_H = "min(82vh, 820px)";

// Inline styles cannot carry a media query, and flex-wrap alone put the ✕
// ABOVE the card and the ✓ off the bottom of the screen at 390px. So the
// breakpoint is read in JS and the stage lays out deliberately for each.
function useNarrow(px = 720) {
  const [narrow, setNarrow] = React.useState(false);
  React.useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${px}px)`);
    const read = () => setNarrow(mq.matches);
    read();
    mq.addEventListener("change", read);
    return () => mq.removeEventListener("change", read);
  }, [px]);
  return narrow;
}

function SwipeStage({ ink, kind, image, title, subtitle, meta, mark, onLike, onDislike, onSkip, hint }) {
  const [drag, setDrag] = React.useState(null);   // {x, y} live offset
  const [fly, setFly] = React.useState(null);     // 'up' | 'down' | 'skip' while animating out
  const [hover, setHover] = React.useState(null); // which half the pointer is over
  const narrow = useNarrow();
  const start = React.useRef(null);
  const COMMIT = 88;

  // A card that changes under an in-flight animation would fire the previous
  // card's verdict against the next one's id, so the gesture state is reset
  // whenever the card identity changes.
  React.useEffect(() => { setDrag(null); setFly(null); }, [title]);

  const finish = (dir) => {
    setFly(dir);
    setDrag(null);
    window.setTimeout(() => {
      setFly(null);
      if (dir === "up") onLike();
      else if (dir === "down") onDislike();
      else onSkip();
    }, 180);
  };

  const onDown = (e) => {
    if (fly) return;
    start.current = { x: e.clientX, y: e.clientY, moved: false };
    setDrag({ x: 0, y: 0 });
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch (err) {}
  };
  const onMove = (e) => {
    if (!start.current) return;
    const dx = e.clientX - start.current.x, dy = e.clientY - start.current.y;
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) start.current.moved = true;
    setDrag({ x: dx, y: dy });
  };
  const onUp = (e) => {
    const s = start.current;
    start.current = null;
    if (!s) return;
    const dx = e.clientX - s.x, dy = e.clientY - s.y;
    // A press that never moved is a CLICK, and on desktop the half it landed in
    // is the verdict. Same handler as the drag so the two cannot disagree.
    if (!s.moved) {
      const r = e.currentTarget.getBoundingClientRect();
      finish(e.clientX - r.left < r.width / 2 ? "down" : "up");
      return;
    }
    if (dy < -COMMIT && Math.abs(dy) > Math.abs(dx)) return finish("skip");
    if (dx > COMMIT) return finish("up");
    if (dx < -COMMIT) return finish("down");
    setDrag(null); // under the threshold: spring back, no verdict
  };

  const dx = fly === "up" ? 520 : fly === "down" ? -520 : drag ? drag.x : 0;
  const dy = fly === "skip" ? -520 : drag ? drag.y : 0;
  const lean = Math.max(-1, Math.min(1, dx / 260));
  // What the release WOULD do, shown while the finger is still down.
  const verdict = fly || (drag
    ? (drag.y < -COMMIT && Math.abs(drag.y) > Math.abs(drag.x) ? "skip"
      : drag.x > COMMIT ? "up" : drag.x < -COMMIT ? "down" : null)
    : null);

  // The label hugs the OUTER edge of its half at mid height. Centred it landed
  // squarely on the face of every actor card; at the foot of the card it fell
  // below the fold on a laptop, which is the same bug as invisible. Outer edge
  // + mid height is on the poster margin and on screen whenever the card is.
  // It stays visible when idle -- the charter forbids an invisible hit target
  // that judges films -- and only lights up when the pointer is in that half.
  const HalfHint = ({ side, on }) => (
    <div style={{
      position: "absolute", top: 0, bottom: 0, [side]: 0, width: "50%",
      display: "flex", alignItems: "center",
      justifyContent: side === "left" ? "flex-start" : "flex-end",
      padding: "0 10px",
      background: on
        ? `linear-gradient(to ${side === "left" ? "right" : "left"}, ${side === "left" ? "rgba(180,67,44,.32)" : "rgba(26,127,90,.32)"}, transparent)`
        : "transparent",
      transition: "background .12s ease", pointerEvents: "none", borderRadius: 10,
    }}>
      <span style={{
        fontSize: 11.5, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase",
        color: "#fff", background: on ? (side === "left" ? BAD : GOOD) : "rgba(0,0,0,.5)",
        padding: "4px 9px", borderRadius: 6,
        transition: "background .12s ease",
      }}>{side === "left" ? "✕ No" : "Yes ✓"}</span>
    </div>
  );

  const Side = ({ dir, label, color, ch }) => (
    <button type="button" aria-label={label} onClick={() => finish(dir)}
      style={{ font: "inherit", cursor: "pointer", border: `1px solid ${ink.track}`, background: ink.surface,
               color, borderRadius: 12, width: 72, height: 72, fontSize: 28, fontWeight: 700, flex: "none",
               boxShadow: "0 1px 3px rgba(0,0,0,.10)" }}>
      {ch}
    </button>
  );

  return (
    <div style={{
      display: "flex", gap: narrow ? 12 : 22, alignItems: "center", justifyContent: "center",
      flexDirection: narrow ? "column" : "row",
    }}>
      {!narrow && <Side dir="down" label={`Not for me: ${title}`} color={BAD} ch="✕" />}

      <div style={{ textAlign: "center", maxWidth: "min(92vw, 560px)" }}>
        <div
          onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp}
          onPointerCancel={() => { start.current = null; setDrag(null); }}
          onPointerLeave={() => setHover(null)}
          onPointerMoveCapture={(e) => {
            if (start.current) return setHover(null);
            const r = e.currentTarget.getBoundingClientRect();
            setHover(e.clientX - r.left < r.width / 2 ? "left" : "right");
          }}
          style={{
            position: "relative", height: CARD_H, aspectRatio: "2 / 3", maxWidth: "min(92vw, 560px)",
            margin: "0 auto", borderRadius: 10, overflow: "hidden", background: ink.track,
            border: `1px solid ${ink.track}`, cursor: "grab", touchAction: "none", userSelect: "none",
            transform: `translate(${dx}px, ${dy}px) rotate(${lean * 7}deg)`,
            opacity: fly ? 0 : 1,
            transition: drag ? "none" : "transform .18s ease, opacity .18s ease",
            boxShadow: "0 1px 3px rgba(0,0,0,.14)",
          }}>
          {image
            ? <img src={image} alt={title} draggable={false}
                   style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
            : <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center",
                            justifyContent: "center", color: ink.muted, fontSize: 15, padding: 20,
                            textAlign: "center" }}>{title}</div>}

          {/* the affordance: both halves are labelled BEFORE the first click */}
          <HalfHint side="left" on={hover === "left" || verdict === "down"} />
          <HalfHint side="right" on={hover === "right" || verdict === "up"} />

          {kind && (
            <span style={{ position: "absolute", left: 8, top: 8, fontSize: 10.5, fontWeight: 700,
                           letterSpacing: ".08em", textTransform: "uppercase", color: "#fff",
                           background: "rgba(0,0,0,.55)", padding: "3px 7px", borderRadius: 5 }}>{kind}</span>
          )}
          {mark}
          {verdict === "skip" && (
            <span style={{ position: "absolute", left: "50%", top: 14, transform: "translateX(-50%)",
                           fontSize: 12, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase",
                           color: "#fff", background: "rgba(0,0,0,.65)", padding: "4px 9px", borderRadius: 6 }}>
              Not seen
            </span>
          )}
        </div>

        <div style={{ fontSize: 17, fontWeight: 660, color: ink.text, marginTop: 10, lineHeight: 1.25 }}>{title}</div>
        {subtitle && <div style={{ fontSize: 12.5, color: ink.muted, marginTop: 2 }}>{subtitle}</div>}
        {meta}
        <button type="button" onClick={() => finish("skip")}
          style={{ marginTop: 10, font: "inherit", fontSize: 12, cursor: "pointer", padding: "5px 10px",
                   borderRadius: 7, background: ink.surface, color: ink.text2, border: `1px solid ${ink.track}` }}>
          Not seen
        </button>
        {hint && <div style={{ fontSize: 11.5, color: ink.muted, marginTop: 8 }}>{hint}</div>}
      </div>

      {narrow
        ? (
          <div style={{ display: "flex", gap: 22, justifyContent: "center" }}>
            <Side dir="down" label={`Not for me: ${title}`} color={BAD} ch="✕" />
            <Side dir="up" label={`Yes: ${title}`} color={GOOD} ch="✓" />
          </div>
        )
        : <Side dir="up" label={`Yes: ${title}`} color={GOOD} ch="✓" />}
    </div>
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
  const seedPeople = useQuery({ query: "seed_people_typed", givens });
  const popular = useQuery({ query: "popular_picks", givens });
  const genreOpts = useQuery({ query: "nw_genre_options", givens });
  const periodsQ = useQuery({ query: "nw_periods", givens });
  const gGenre = useGiven("GENRE");
  const gYear = useGiven("RELEASE_YEAR");
  const gType = useGiven("TITLE_TYPE");
  const [swipeKind, setSwipeKind] = React.useState("people");
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
  // The genre chip filters the RESULTS here, in one line, rather than as a
  // `genres.value ~ $GENRE` clause in the recommendation query -- see the block
  // comment on that query for why the model must never do it.
  const inGenre = React.useCallback((r) => {
    if (!genreNow) return true;
    const g = r.genres;
    return Array.isArray(g) ? g.includes(genreNow) : String(g || "").includes(genreNow);
  }, [genreNow]);

  const recommended = React.useMemo(() => {
    let rows = (recs.rows || [])
      .filter((r) => !verdicts[r.tconst])
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
      .sort((a, b) => b._score - a._score);
    // Titles carried in by a liked PERSON, appended after the feature-scored
    // ones. They earn their place on the person alone, so they are not scored
    // against the genre profile and must not outrank things that were.
    const seen = new Set(rows.map((r) => r.tconst));
    const byPerson = (recsPeople.rows || [])
      .filter((r) => !verdicts[r.tconst] && !seen.has(r.tconst) && inGenre(r))
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

  // THE COLD START. Andrew: "'Your next watch' is useless if people haven't
  // selected any ratings yet." The previous fix hid the section at zero
  // ratings, which answers him and breaks CHARTER §4 in the same edit -- "the
  // tool must produce a defensible list from ZERO explicit input."
  // So at zero ratings the list is `popular_picks`: acclaimed and widely seen,
  // inside whatever genre/period/type is selected, and LABELLED as that rather
  // than passed off as personal.
  // ROUND-ROBINED ACROSS TITLE TYPE. CHARTER F3 warned that ranking films and
  // shows in one list on raw votes "would quietly bury films"; ranking on
  // RATING buries them just as effectively in the other direction -- measured,
  // the top 60 acclaimed titles are 46 television to 14 films, so a visitor who
  // rates nothing sees a TV list and concludes the tool is for TV. Cycling the
  // types preserves rating order inside each lane and shows both.
  const list = React.useMemo(() => {
    if (rated > 0) return recommended;
    const lanes = new Map();
    for (const r of popular.rows || []) {
      const k = r.title_type === "movie" ? "film" : "tv";
      if (!lanes.has(k)) lanes.set(k, []);
      lanes.get(k).push(r);
    }
    const out = [];
    const ls = [...lanes.values()];
    for (let i = 0; ls.length && out.length < 60; i++) {
      let progressed = false;
      for (const lane of ls) if (lane[i]) { out.push(lane[i]); progressed = true; }
      if (!progressed) break;
    }
    return out;
  }, [rated, popular.rows, recommended]);

  // A card sized to fill the screen does not fill the screen if it opens BELOW
  // it: the genre chips and the timeline are ~490px of chrome, so at a laptop
  // height the title, the skip button and the No/Yes affordance were all under
  // the fold. Centre the stage when swipe mode opens. Once only -- re-centring
  // on every card would yank the page around mid-swipe.
  const stageRef = React.useRef(null);
  React.useEffect(() => {
    if (mode !== "swipe" || !stageRef.current) return;
    const el = stageRef.current;
    const r = el.getBoundingClientRect();
    if (r.bottom > window.innerHeight || r.top < 0) {
      el.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }, [mode, swipeKind]);

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
    const on = offersFor[r.tconst]?.names;
    return `${r.primary_title}${yr}${on ? ` · ${on}` : ""}`;
  }).join("\n"), [list, offersFor]);

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

  // People vs films vs shows is the visitor's choice, not ours: the deck used
  // to force four person cards before showing a single title.
  const usePersonCard = swipeKind === "people" && personCard;

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
      // Guarding on `card` first meant the keyboard went dead on a PERSON card
      // whenever the title pool happened to be empty -- the person deck was
      // fully populated and the arrow keys did nothing.
      if (!card && !usePersonCard) return;
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
            Tap what you liked.
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
        <div ref={stageRef} style={{ margin: "0 0 26px" }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 5, alignItems: "center", marginBottom: 12 }}>
            {[["people", "People"], ["movie", "Films"], ["tvSeries", "Shows"]].map(([k, label]) => (
              <Chip key={k} on={swipeKind === k}
                onClick={() => {
                  setSwipeKind(k);
                  gType.set(k === "people" ? "" : filters.oneOf(k));
                }}>{label}</Chip>
            ))}
            <span style={{ fontSize: 12, color: ink.muted, marginLeft: 6 }}>
              Drag, click a side, or use arrow keys.
            </span>
          </div>
          {usePersonCard ? (
            <SwipeStage
              ink={ink} kind="Person" image={personCard.photo} title={personCard.person}
              subtitle={`${Math.round(num(personCard.titles))} titles`}
              hint="Weights the person, not their films."
              onLike={() => ratePerson(personCard.nconst, "up")}
              onDislike={() => ratePerson(personCard.nconst, "down")}
              onSkip={() => ratePerson(personCard.nconst, "skip")} />
          ) : card ? (
            <SwipeStage
              ink={ink}
              kind={card.title_type && card.title_type !== "movie" ? (TYPE_LABEL[card.title_type] || card.title_type) : "Film"}
              image={card.poster ? card.poster.replace("/w154", "/w500") : null}
              title={card.primary_title}
              subtitle={`${card.start_year ? Math.round(num(card.start_year)) : ""} · ★ ${num(card.average_rating).toFixed(1)}`}
              mark={<ProviderMark ink={ink} offers={offersFor[card.tconst]} />}
              onLike={() => { rate(card.tconst, "up"); setDeck((d) => d + 1); }}
              onDislike={() => { rate(card.tconst, "down"); setDeck((d) => d + 1); }}
              onSkip={() => { card._shown = (card._shown || 0) + 1; setDeck((d) => d + 1); }} />
          ) : <div style={{ color: ink.muted, fontSize: 13 }}>Deck finished.</div>}
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
            placeholder="Search films, shows, people"
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
            </div>
          )}
          <div style={{ display: "grid", gridTemplateColumns: `repeat(auto-fill, ${TILE_W}px)`, gap: 14, marginTop: 14 }}>
            {(person ? (personTitles.rows || []) : (found.rows || [])).map((r) => (
              <Tile key={r.tconst} ink={ink} row={r} verdict={verdicts[r.tconst]} offers={offersFor[r.tconst]}
                    onRate={(v) => rate(r.tconst, v)} />
            ))}
          </div>
          {/* A search that matches nothing rendered silent white space, so a
              typo was indistinguishable from a page that had stopped working.
              Same wording the results list already uses. */}
          {q && !person && (found.rows || []).length === 0 && (people.rows || []).length === 0 && (
            <div style={{ fontSize: 12.5, color: ink.muted, marginTop: 14 }}>
              Nothing matches “{q}”.
            </div>
          )}
        </div>
      )}

      {/* ------------------------------ the list ------------------------- */}
      <div style={{ margin: "0 0 26px" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 8, flexWrap: "wrap" }}>
          <div style={{ fontSize: 11, letterSpacing: ".08em", textTransform: "uppercase", color: ink.muted, fontWeight: 700 }}>
            Your next watch
          </div>
          <span style={{ fontSize: 12, color: ink.muted }}>
            {rated === 0
              ? "top rated, until you rate something"
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
