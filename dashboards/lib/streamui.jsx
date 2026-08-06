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
export function StreamGlyph({ size = 16, color }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true" focusable="false"
         style={{ display: "block" }}>
      <rect x="0.75" y="2.25" width="14.5" height="11.5" rx="2.25"
            fill="rgba(255,255,255,.92)" stroke={color} strokeWidth="1.2" />
      <path d="M6.4 5.6 L11 8 L6.4 10.4 Z" fill={color} />
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
        <StreamGlyph size={size} color={ink.text} />
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
export function ServicePicker({ ink, all, mine, onToggle }) {
  const [open, setOpen] = React.useState(false);
  // Ordered by how much of the corpus each service carries, so the ones worth
  // picking are the ones on screen. The long tail (190-odd niche channels) sits
  // behind "more" rather than in front of everyone -- showing all of them would
  // be the crowding this feature exists to remove.
  const top = all.slice(0, 14);
  const rest = all.slice(14);
  const shown = open ? all : top;
  const chosen = new Set(mine);
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 11, letterSpacing: ".06em", textTransform: "uppercase",
                    color: ink.muted, fontWeight: 700, marginBottom: 7 }}>
        What do you subscribe to?
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 5, alignItems: "center" }}>
        {shown.map((sv) => (
          <ChipBase key={sv} ink={ink} on={chosen.has(sv)} onClick={() => onToggle(sv)}>{sv}</ChipBase>
        ))}
        {!open && rest.length > 0 && (
          <button type="button" onClick={() => setOpen(true)}
                  style={{ font: "inherit", fontSize: 12, cursor: "pointer", background: "transparent",
                           border: 0, color: ink.accent, padding: "0 4px" }}>
            {rest.length} more
          </button>
        )}
      </div>
      <div style={{ fontSize: 11.5, color: ink.muted, marginTop: 6 }}>
        {chosen.size
          ? "Titles you cannot stream lose the mark."
          : "Pick yours and the mark only shows what you can watch."}
      </div>
    </div>
  );
}
