/**
 * Streaming services: canonicalisation, the visitor's own subscriptions, and
 * per-title links. Shared by every dashboard that shows a "where to watch" mark.
 *
 * WHY THIS FILE EXISTS. TMDB returns JustWatch's raw provider rows, and for US
 * flatrate that is ~80 names, most of them resellers of the same service:
 * "Netflix" and "Netflix Standard with Ads"; "HBO Max" and "HBO Max Amazon
 * Channel"; four separate Paramount rows. Rendering those one-per-logo is what
 * made the availability row look, in Andrew's words, crowded. Collapsing them to
 * the SERVICE a person would actually say they subscribe to is the substance of
 * the fix, not a cosmetic tidy. CHARTER §7.3.
 */

// Reseller wrappers. "Starz Apple TV Channel" is Starz, billed through Apple.
// Someone who has Starz has the title; someone who does not, does not -- the
// billing route is noise for the question being asked.
const RESELLER = /\s+(amazon|apple tv|roku premium|roku)\s+channel\s*$/i;

// Ordered: first match wins, so "Paramount Plus Premium" resolves before any
// looser rule could claim it.
const ALIASES = [
  [/^netflix/i, "Netflix"],
  [/^amazon prime video/i, "Prime Video"],
  [/^paramount\s*(\+|plus)/i, "Paramount+"],
  [/^peacock/i, "Peacock"],
  [/^(hbo\s*)?max$/i, "Max"],
  [/^hbo max/i, "Max"],
  [/^disney\s*(\+|plus)/i, "Disney+"],
  [/^mgm\s*(\+|plus)/i, "MGM+"],
  [/^amc\s*(\+|plus)/i, "AMC+"],
  [/^apple tv\+?$/i, "Apple TV+"],
  [/^britbox/i, "BritBox"],
  [/^starz/i, "Starz"],
  [/^shudder/i, "Shudder"],
  [/^crunchyroll/i, "Crunchyroll"],
  [/^mubi/i, "MUBI"],
  [/^cinemax/i, "Cinemax"],
  [/^screenpix/i, "ScreenPix"],
  [/^midnight pulp/i, "Midnight Pulp"],
  [/^fandor/i, "Fandor"],
  [/^indieflix/i, "IndieFlix"],
  [/^hi-yah/i, "Hi-YAH"],
  [/^sundance now/i, "Sundance Now"],
  [/^criterion channel/i, "Criterion Channel"],
  [/^youtube tv/i, "YouTube TV"],
  [/^fubo/i, "fuboTV"],
  [/^philo/i, "Philo"],
  [/^hulu/i, "Hulu"],
];

/** TMDB provider name -> the service a person would name. */
export function canonicalService(name) {
  const base = String(name || "").replace(RESELLER, "").trim();
  for (const [re, canon] of ALIASES) if (re.test(base)) return canon;
  return base;
}

/**
 * Per-service link for one title.
 *
 * ⚠ HONEST LIMIT, and it is not a shortcut taken for speed. TMDB returns ONE
 * aggregate JustWatch link per title per region -- it does not return a
 * per-provider deep link, and there is no licensed source that does. So a
 * canonical "netflix.com/title/<id>" URL cannot be constructed: we do not have
 * and cannot get each service's own id for the title.
 *
 * What IS deterministic is each service's own search URL with the exact title
 * pre-filled, which lands the visitor on that title inside that service. That
 * is what this returns.
 *
 * ⛔ EVERY ROUTE BELOW IS PROBED, and two were not. The rater found
 * `peacocktv.com/search` and `disneyplus.com/search` both returning 404 --
 * Peacock is one of Andrew's five services and was The Matrix's ONLY offer
 * under his profile, so his first click in his own test case was dead. Peacock
 * is now `/watch/search`, which returns 200; Disney+ has no search route that
 * does, so it is REMOVED and falls back to the JustWatch page. A guessed URL
 * that 404s is worse than admitting we do not have one -- which is what the
 * fallback exists to say. Re-probe with curl before adding any new service. `justwatchLink` (TMDB's own link, the exact-title page
 * listing every option) is the fallback and stays reachable in the popover, so
 * nothing here pretends to be more precise than it is.
 */
export function serviceLink(service, title, year, justwatchLink) {
  const q = encodeURIComponent(String(title || "").trim());
  if (!q) return justwatchLink || null;
  switch (service) {
    case "Netflix":           return `https://www.netflix.com/search?q=${q}`;
    case "Prime Video":       return `https://www.amazon.com/s?k=${q}&i=instant-video`;
    case "Hulu":              return `https://www.hulu.com/search?q=${q}`;
    case "Max":               return `https://play.max.com/search?q=${q}`;
    case "Paramount+":        return `https://www.paramountplus.com/search/?query=${q}`;
    case "Peacock":           return `https://www.peacocktv.com/watch/search?q=${q}`;
    case "Apple TV+":         return `https://tv.apple.com/search?term=${q}`;
    case "Starz":             return `https://www.starz.com/us/en/search?q=${q}`;
    case "AMC+":              return `https://www.amcplus.com/search?q=${q}`;
    case "MUBI":              return `https://mubi.com/en/us/search/films?query=${q}`;
    case "Criterion Channel": return `https://www.criterionchannel.com/search?q=${q}`;
    case "Crunchyroll":       return `https://www.crunchyroll.com/search?q=${q}`;
    case "Shudder":           return `https://www.shudder.com/search?q=${q}`;
    case "BritBox":           return `https://www.britbox.com/us/search?q=${q}`;
    // Anything without a verified search route falls back to the exact-title
    // JustWatch page rather than to a guessed URL. A link that lands somewhere
    // wrong is worse than one that admits what it is.
    default:                  return justwatchLink || null;
  }
}

/** Whether serviceLink returned a real service route rather than the fallback. */
export function hasDirectRoute(service) {
  return serviceLink(service, "x", null, null) !== null;
}

/**
 * Parse the `provider_entries` column: entries joined by ~|~, fields by ~:~.
 * Returns unique SERVICES (not raw provider rows), each keeping the first logo
 * seen for it, ordered by the query's own ordering.
 */
export function parseProviders(raw) {
  const out = [];
  const seen = new Set();
  for (const entry of String(raw || "").split("~|~")) {
    if (!entry) continue;
    const [, name, logo] = entry.split("~:~");
    const service = canonicalService(name);
    if (!service || seen.has(service)) continue;
    seen.add(service);
    out.push({ service, logo: logo || null });
  }
  return out;
}

/* ------------------------- the visitor's own services ------------------- */
// Kept in localStorage, like every other preference here: nothing about a
// visitor's taste or their subscriptions leaves their machine (CHARTER §3).
const KEY = "mif.myServices.v1";

export function loadMyServices() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || "[]");
    return Array.isArray(v) ? v.filter((s) => typeof s === "string") : [];
  } catch { return []; }
}

export function saveMyServices(list) {
  try { localStorage.setItem(KEY, JSON.stringify([...new Set(list)])); } catch { /* private mode */ }
}

/**
 * The services to SHOW for a title.
 *
 * ⛔ The rule Andrew stated, and the empty case is the whole point: if a title
 * streams only on services he does not have, the mark must not appear at all.
 * So this returns an empty array in that case, and the caller renders nothing.
 *
 * Before he has picked anything, `mine` is empty and every service shows -- a
 * first visit must not look like nothing is streamable anywhere (CHARTER §4's
 * cold-start rule applies to this control too).
 */
export function visibleServices(all, mine) {
  if (!mine || !mine.length) return all;
  const set = new Set(mine);
  return all.filter((p) => set.has(p.service));
}
