// Ratings that survive a reload — and, once the page split lands, a page change.
//
// ⛑ WHY THIS EXISTS (2026-08-06). `NEXT-LAYOUT-WORK.md` §3 justified splitting
// the page in two on the grounds that "the two halves already share state through
// the URL and localStorage, so the split costs no new plumbing." Half of that was
// not true: only the STREAMING-SERVICE preference was ever in localStorage
// (`lib/streaming.js`). Title and person verdicts lived in React state plus the
// URL givens and NOTHING else — so a split would have meant rating on one page,
// clicking through to the other, and arriving with an empty profile unless the
// link happened to carry every given. Reloading lost them too, which was already
// true before any split and simply never surfaced because one page held both jobs.
//
// The URL stays the SHARE mechanism (a link someone else opens must still carry
// the ratings — that is CHARTER §1's "a list you cannot take with you was not
// delivered"). This is the LOCAL mechanism, for the same person coming back or
// moving between the site's own pages.
//
// ⛔ NOTHING LEAVES THE MACHINE. Same constraint as the rest of the fork, and the
// same storage the service picker already uses. Every access is wrapped: private
// mode makes localStorage throw on read AND write, and a rating tool that dies
// because someone opened a private window is worse than one that forgets.

const KEY = "nwProfile.v1";

/** Read the saved profile. Always returns a usable shape, never throws. */
export function loadProfile() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || "null");
    if (!raw || typeof raw !== "object") return { verdicts: {}, people: {}, skipped: [] };
    return {
      verdicts: raw.verdicts && typeof raw.verdicts === "object" ? raw.verdicts : {},
      people: raw.people && typeof raw.people === "object" ? raw.people : {},
      skipped: Array.isArray(raw.skipped) ? raw.skipped.filter((x) => typeof x === "string") : [],
    };
  } catch (e) {
    return { verdicts: {}, people: {}, skipped: [] };
  }
}

/** Persist the profile. Silent on failure — see the private-mode note above. */
export function saveProfile(verdicts, people, skipped) {
  try {
    localStorage.setItem(KEY, JSON.stringify({
      verdicts: verdicts || {},
      people: people || {},
      skipped: [...(skipped || [])],
    }));
  } catch (e) { /* private mode, or quota — forgetting is the acceptable failure */ }
}

/**
 * True when the saved profile holds nothing. Used to decide precedence: a URL
 * that carries ratings is someone opening a SHARED list and must win over
 * whatever this browser happens to remember, otherwise a shared link silently
 * shows the recipient their own profile — the exact bug the URL seeding was
 * written to prevent, re-introduced from the other side.
 */
export function profileIsEmpty(p) {
  return !p
    || (Object.keys(p.verdicts || {}).length === 0
        && Object.keys(p.people || {}).length === 0
        && (p.skipped || []).length === 0);
}
