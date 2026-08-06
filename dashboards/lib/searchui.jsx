/**
 * The search box with fuzzy autofill.
 *
 * Matching lives in ./suggest.js; this file is only the control. The index
 * (docs/data/suggest.json, ~1.6 MB) is fetched LAZILY on first focus rather
 * than at page load: most visitors never open search, and making everyone pay
 * for it would trade the charter's 60-second-to-a-list target for a feature
 * they did not ask for.
 */
import React from "react";
import { buildIndex, suggest } from "./suggest.js";

export function SearchBox({ ink, value, onChange, onPickTitle, onPickPerson, placeholder }) {
  const [index, setIndex] = React.useState(null);
  const [loading, setLoading] = React.useState(false);
  const [failed, setFailed] = React.useState(false);
  const [open, setOpen] = React.useState(false);
  const [cursor, setCursor] = React.useState(0);
  const boxRef = React.useRef(null);

  const load = React.useCallback(() => {
    if (index || loading || failed) return;
    setLoading(true);
    fetch("data/suggest.json")
      .then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
      .then((rows) => setIndex(buildIndex(rows)))
      // Autofill is an accelerator, never the only way in: if the index cannot
      // be fetched the box still works as a plain search. Failing silently
      // would leave a dropdown that never appears with nothing to explain it,
      // so the state is remembered and shown once.
      .catch(() => setFailed(true))
      .finally(() => setLoading(false));
  }, [index, loading, failed]);

  const hits = React.useMemo(
    () => (index && value.trim().length >= 2 ? suggest(index, value, 8) : []),
    [index, value]);

  React.useEffect(() => { setCursor(0); }, [value]);

  // A click anywhere else closes the list. Without this it stayed open over the
  // results it was covering.
  React.useEffect(() => {
    if (!open) return;
    const away = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open]);

  // Close as soon as the input loses focus. Without this the list stayed open
  // over the results it was covering, and the first row of posters could not be
  // clicked at all -- the suggestion intercepted the pointer instead.
  const closeSoon = () => window.setTimeout(() => setOpen(false), 120);

  const pick = (h) => {
    setOpen(false);
    if (h.kind === "person") onPickPerson(h);
    else onPickTitle(h);
  };

  const onKeyDown = (e) => {
    if (!open || !hits.length) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setCursor((c) => Math.min(c + 1, hits.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); pick(hits[cursor]); }
    else if (e.key === "Escape") { setOpen(false); }
  };

  return (
    <div ref={boxRef} style={{ position: "relative", width: "min(420px, 100%)" }}>
      <input
        value={value}
        onFocus={() => { load(); setOpen(true); }}
        onChange={(e) => { onChange(e.target.value); setOpen(true); }}
        onKeyDown={onKeyDown}
        onBlur={closeSoon}
        placeholder={placeholder}
        role="combobox"
        aria-expanded={open && hits.length > 0}
        aria-autocomplete="list"
        style={{ font: "inherit", fontSize: 14, padding: "8px 11px", borderRadius: 7, width: "100%",
                 border: `1px solid ${ink.track}`, background: ink.surface, color: ink.text }} />
      {open && hits.length > 0 && (
        <ul role="listbox"
            style={{ position: "absolute", zIndex: 50, left: 0, right: 0, top: "100%", marginTop: 4,
                     listStyle: "none", padding: 4, background: ink.surface, borderRadius: 8,
                     border: `1px solid ${ink.track}`, boxShadow: "0 8px 24px rgba(0,0,0,.16)",
                     maxHeight: 320, overflowY: "auto" }}>
          {hits.map((h, i) => (
            <li key={h.kind + h.id} role="option" aria-selected={i === cursor}
                onMouseEnter={() => setCursor(i)}
                onMouseDown={(e) => { e.preventDefault(); pick(h); }}
                style={{ display: "flex", alignItems: "baseline", gap: 8, padding: "6px 8px", borderRadius: 6,
                         cursor: "pointer", background: i === cursor ? ink.track : "transparent" }}>
              <span style={{ fontSize: 13, color: ink.text, fontWeight: i === cursor ? 620 : 500 }}>{h.text}</span>
              <span style={{ fontSize: 11, color: ink.muted, marginLeft: "auto", whiteSpace: "nowrap" }}>
                {h.kind === "person" ? "person" : h.year ? String(Math.round(h.year)) : "film"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
