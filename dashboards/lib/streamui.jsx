/**
 * The "where to watch" UI, shared by every dashboard that shows it.
 *
 * ONE component, deliberately. The mark was briefly written twice -- once in
 * next_watch.jsx and once in genre_pairs.jsx -- and two copies of a control this
 * fiddly diverge on the first fix that only lands in one of them. The pages
 * differ in layout, not in what a streaming mark means.
 */
import React from "react";
import { serviceLink } from "./streaming.js";

export const LOGO = (p) => (p ? "https://image.tmdb.org/t/p/w45" + p : null);

export function ChipBase({ ink, on, onClick, children }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={!!on}
      style={{ font: "inherit", fontSize: 12.5, cursor: "pointer", lineHeight: 1.15, padding: "5px 9px",
               borderRadius: 7, background: on ? ink.accent : ink.surface, color: on ? "#fff" : ink.text2,
               border: `1px solid ${on ? ink.accent : ink.track}`,
               transition: "background .12s ease, border-color .12s ease" }}>
      {children}
    </button>
  );
}

// A glyph, not the word "Streamable". Andrew asked for an icon specifically --
// the word repeated across a grid is the same crowding in another font.
//
// ⛔ IT MUST NOT TAKE ITS COLOUR FROM THE THEME'S TEXT INK. It used to:
// `fill="rgba(255,255,255,.92)"` for the screen with the play triangle drawn in
// `ink.text`. In DARK MODE ink.text is near-white, so a white triangle sat on a
// white screen and the whole thing read as "just a blank white box" -- Andrew's
// words, 2026-08-07. A mark whose legibility depends on the theme is not a mark.
// So the contrast pair is FIXED here: a solid dark screen with a WHITE play
// triangle, plus a light ring so it also separates from a dark poster. It is the
// same two colours in both themes, on top of arbitrary poster art, by design.
export function StreamGlyph({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 18 18" aria-hidden="true" focusable="false"
         style={{ display: "block" }}>
      <rect x="0.6" y="0.6" width="16.8" height="16.8" rx="4.2"
            fill="#111827" stroke="rgba(255,255,255,.92)" strokeWidth="1.2" />
      <path d="M7 5.4 L12.6 9 L7 12.6 Z" fill="#ffffff" />
    </svg>
  );
}

/**
 * `offers` is {all, services, link}. `services` is ALREADY filtered to what this
 * visitor can use.
 *
 * ⛔ An empty `services` renders NOTHING. That is the rule Andrew stated in as
 * many words: if a film streams only where he has no subscription, he does not
 * want to be told it is streamable.
 */
export function StreamableMark({ ink, offers, title, year, size = 16 }) {
  const [open, setOpen] = React.useState(false);
  const services = offers && offers.services;
  if (!services || !services.length) return null;
  // TMDB requires JustWatch attribution on EACH media item, so the credit rides
  // on the mark itself and reaches a screen reader and a touch user -- not only
  // a hover tooltip, which a phone can never open.
  const credit = `Streaming on ${services.map((p) => p.service).join(", ")} - source: JustWatch`;
  const pad = size <= 16 ? 3 : 8;
  return (
    <span style={{ position: "absolute", right: pad, bottom: pad, display: "block" }}
          onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button type="button" title={credit} aria-label={credit} aria-expanded={open}
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen((v) => !v); }}
              onFocus={() => setOpen(true)} onBlur={() => setOpen(false)}
              style={{ border: 0, padding: 0, background: "transparent", cursor: "pointer", lineHeight: 0,
                       borderRadius: 4, boxShadow: "0 0 0 1px rgba(0,0,0,.35)" }}>
        <StreamGlyph size={size} />
        {/* ⛔ THE LICENCE TERM MUST NOT BE HOVER-ONLY. TMDB requires the
            JustWatch credit on EACH media item, and the previous design carried
            it in the alt text of a visible logo. Collapsing to one glyph put the
            logos in a popover, which put the credit behind a hover -- exactly
            the failure a `title=` tooltip caused before, arrived at from the
            other direction. This is REAL TEXT in the document, clipped rather
            than hidden: display:none and visibility:hidden are both dropped by
            screen readers, and the point is that it is always reachable. */}
        <span style={{ position: "absolute", width: 1, height: 1, overflow: "hidden",
                       clip: "rect(0 0 0 0)", clipPath: "inset(50%)", whiteSpace: "nowrap" }}>
          {credit}
        </span>
      </button>
      {open && (
        <span role="menu"
              style={{ position: "absolute", right: 0, bottom: size + 6, zIndex: 40, minWidth: 148, display: "block",
                       background: ink.surface, border: `1px solid ${ink.track}`, borderRadius: 8,
                       boxShadow: "0 6px 20px rgba(0,0,0,.18)", padding: 6, textAlign: "left" }}>
          {services.map((p) => (
            <a key={p.service} href={serviceLink(p.service, title, year, offers.link) || undefined}
               target="_blank" rel="noopener noreferrer" role="menuitem" onClick={(e) => e.stopPropagation()}
               style={{ display: "flex", alignItems: "center", gap: 7, padding: "5px 6px", fontSize: 12,
                        color: ink.text2, textDecoration: "none", borderRadius: 5, whiteSpace: "nowrap" }}>
              {p.logo
                ? <img src={LOGO(p.logo)} alt="" width={16} height={16} loading="lazy"
                       style={{ borderRadius: 3, background: "#fff", display: "block" }} />
                : <span style={{ width: 16, height: 16, display: "block" }} />}
              {p.service}
            </a>
          ))}
          <span style={{ display: "block", fontSize: 10.5, color: ink.muted, padding: "5px 6px 1px",
                         borderTop: `1px solid ${ink.track}`, marginTop: 3 }}>via JustWatch</span>
        </span>
      )}
    </span>
  );
}

/**
 * Andrew: "make an option for users to select which streaming platforms they
 * have access to." Everything the mark does depends on this, so it is a control
 * on the page rather than a settings screen nobody opens.
 */
/**
 * ⚑ SUBSCRIBER POPULARITY, NOT CORPUS COVERAGE.
 *
 * `all` arrives ordered by how much of the CORPUS each service carries, which is a
 * different question from "which services do people actually have". Ordering the
 * menu by corpus share puts a niche channel with a deep back-catalogue above
 * Netflix. Andrew asked for "ordered by most popular subscription services", so the
 * majors lead in real subscriber order and everything else keeps its corpus order
 * behind them. Hardcoded on purpose: there is no subscriber-count column in the
 * data, and inventing one from corpus share would be the same mistake with a number
 * attached to make it look derived.
 */
const BY_SUBSCRIBERS = [
  "Netflix", "Amazon Prime Video", "Prime Video", "Disney Plus", "Disney+",
  "Max", "HBO Max", "Hulu", "Paramount Plus", "Paramount+",
  "Apple TV+", "Apple TV Plus", "Peacock", "Peacock Premium",
];

function bySubscriberPopularity(all) {
  const rank = new Map();
  BY_SUBSCRIBERS.forEach((n, i) => rank.set(n.toLowerCase(), i));
  return [...all].sort((a, b) => {
    const ra = rank.has(a.toLowerCase()) ? rank.get(a.toLowerCase()) : Infinity;
    const rb = rank.has(b.toLowerCase()) ? rank.get(b.toLowerCase()) : Infinity;
    if (ra !== rb) return ra - rb;
    return all.indexOf(a) - all.indexOf(b);   // stable: keep corpus order for the tail
  });
}

/**
 * Andrew: "make an option for users to select which streaming platforms they
 * have access to." Everything the mark does depends on this, so it is a control
 * on the page rather than a settings screen nobody opens.
 *
 * ⛔ ONE VISIBLE BUTTON THAT OPENS A MENU — not a chip row. Andrew, 2026-08-07:
 * "should be a single button that is more visible that pops up a menu for people to
 * click which subscriptions they have". The old form spilled 14 chips inline, which
 * was both easy to scroll past (it had already been found buried once) and part of
 * the crowding CHARTER §7.3 exists to remove. A closed control that states what it
 * is for is more visible than fourteen open ones.
 */
export function ServicePicker({ ink, all, mine, onToggle }) {
  const [open, setOpen] = React.useState(false);
  const ordered = React.useMemo(() => bySubscriberPopularity(all || []), [all]);
  const chosen = new Set(mine);
  const ref = React.useRef(null);

  // Click-away and Escape. A menu with no way out but a second precise click is a
  // trap on touch, where there is no "click somewhere harmless".
  React.useEffect(() => {
    if (!open) return;
    const away = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); };
  }, [open]);

  const label = chosen.size
    ? `Your services · ${chosen.size} selected`
    : "What do you subscribe to?";

  return (
    <div ref={ref} style={{ position: "relative", marginBottom: 14 }}>
      <button type="button" onClick={() => setOpen((v) => !v)}
              aria-expanded={open} aria-haspopup="true"
              style={{ font: "inherit", fontSize: 13.5, fontWeight: 600, cursor: "pointer",
                       display: "inline-flex", alignItems: "center", gap: 9,
                       padding: "9px 14px", borderRadius: 9,
                       background: chosen.size ? ink.accent : ink.surface,
                       color: chosen.size ? "#fff" : ink.text,
                       border: `1px solid ${chosen.size ? ink.accent : ink.text2}` }}>
        <StreamGlyph size={16} />
        {label}
        <span aria-hidden="true" style={{ fontSize: 10, opacity: .8 }}>{open ? "▲" : "▼"}</span>
      </button>

      {!chosen.size && (
        <span style={{ fontSize: 11.5, color: ink.muted, marginLeft: 10 }}>
          so the mark only shows what you can watch
        </span>
      )}

      {open && (
        <div role="menu"
             style={{ position: "absolute", left: 0, top: "calc(100% + 6px)", zIndex: 60,
                      background: ink.surface, border: `1px solid ${ink.track}`, borderRadius: 10,
                      boxShadow: "0 10px 28px rgba(0,0,0,.22)", padding: 10,
                      maxHeight: 340, overflowY: "auto", minWidth: 260, maxWidth: 420 }}>
          <div style={{ fontSize: 11, letterSpacing: ".06em", textTransform: "uppercase",
                        color: ink.muted, fontWeight: 700, marginBottom: 8 }}>
            Tick everything you have
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
            {ordered.map((sv) => (
              <ChipBase key={sv} ink={ink} on={chosen.has(sv)} onClick={() => onToggle(sv)}>{sv}</ChipBase>
            ))}
          </div>
          <div style={{ fontSize: 11.5, color: ink.muted, marginTop: 9,
                        borderTop: `1px solid ${ink.track}`, paddingTop: 8 }}>
            {chosen.size
              ? "Titles you cannot stream lose the mark."
              : "Most popular services first."}
          </div>
        </div>
      )}
    </div>
  );
}
