// Landing page for the published site (`malloyyo dashboard bundle`).
//
// Deliberately the same shape as the default generated index — heading plus a
// card per dashboard — with a credits footer added. It exists because TMDB's
// terms require their logo and a specific credit line displayed wherever their
// data or images are used, and the generated pages have no footer hook.
//
// Plain React: no Malloy, no DuckDB. `dashboards` is injected by the build as
// {name, title, description, href}.

const IMDB_DATA = "https://developer.imdb.com/non-commercial-datasets/";
const TMDB = "https://www.themoviedb.org/";

const S = `
.lp{max-width:760px;margin:0 auto;padding:48px 20px 64px}
.lp h1{font-size:22px;font-weight:650;margin:0 0 6px}
.lp .sub{color:var(--muted);font-size:14.5px;margin:0 0 24px;line-height:1.5}
.cards{list-style:none;padding:0;margin:0;display:grid;gap:10px}
.cards a{display:flex;flex-direction:column;gap:3px;padding:16px 18px;border:1px solid var(--line);border-radius:12px;background:var(--card);text-decoration:none;color:inherit}
.cards a:hover{border-color:var(--accent)}
.cards strong{font-size:15px}
.cards span{font-size:13px;color:var(--muted)}
.credits{border-top:1px solid var(--line);margin-top:40px;padding-top:18px;color:var(--muted);font-size:13px;line-height:1.55}
.credits p{margin:0 0 10px}
.credits a{color:var(--accent)}
.tmdb{display:flex;align-items:center;gap:11px;margin:0 0 10px}
`;

// TMDB's official long wordmark, downloaded from
// themoviedb.org/about/logos-attribution. Their terms require the logo shown
// alongside the credit line, so it is inlined here rather than hotlinked. The
// <style>/class the original ships with became a direct fill reference, and the
// gradient id is namespaced so it cannot collide with anything on the page.
const TmdbLogo = () => (
  <svg viewBox="0 0 489.04 35.4" width="132" height="9.6" role="img"
       aria-label="TMDB" style={{ display: "block", flex: "none" }}>
    <defs>
      <linearGradient id="tmdb-wordmark" y1="17.7" x2="489.04" y2="17.7" gradientUnits="userSpaceOnUse">
        <stop offset="0" stopColor="#90cea1" />
        <stop offset="0.56" stopColor="#3cbec9" />
        <stop offset="1" stopColor="#00b3e5" />
      </linearGradient>
    </defs>
    <path fill="url(#tmdb-wordmark)" d="M293.5,0h8.9l8.75,23.2h.1L320.15,0h8.35L313.9,35.4h-6.25Zm46.6,0h7.8V35.4h-7.8Zm22.2,0h24.05V7.2H370.1v6.6h15.35V21H370.1v7.2h17.15v7.2H362.3Zm55,0H429a33.54,33.54,0,0,1,8.07,1A18.55,18.55,0,0,1,443.75,4a15.1,15.1,0,0,1,4.52,5.53A18.5,18.5,0,0,1,450,17.8a16.91,16.91,0,0,1-1.63,7.58,16.37,16.37,0,0,1-4.37,5.5,19.52,19.52,0,0,1-6.35,3.37A24.59,24.59,0,0,1,430,35.4H417.29Zm7.81,28.2h4a21.57,21.57,0,0,0,5-.55,10.87,10.87,0,0,0,4-1.83,8.69,8.69,0,0,0,2.67-3.34,11.92,11.92,0,0,0,1-5.08,9.87,9.87,0,0,0-1-4.52,9,9,0,0,0-2.62-3.18,11.68,11.68,0,0,0-3.88-1.88,17.43,17.43,0,0,0-4.67-.62h-4.6ZM461.24,0h13.2a34.42,34.42,0,0,1,4.63.32,12.9,12.9,0,0,1,4.17,1.3,7.88,7.88,0,0,1,3,2.73A8.34,8.34,0,0,1,487.39,9a7.42,7.42,0,0,1-1.67,5,9.28,9.28,0,0,1-4.43,2.82v.1a10,10,0,0,1,3.18,1,8.38,8.38,0,0,1,2.45,1.85,7.79,7.79,0,0,1,1.57,2.62,9.16,9.16,0,0,1,.55,3.2,8.52,8.52,0,0,1-1.2,4.68,9.42,9.42,0,0,1-3.1,3,13.38,13.38,0,0,1-4.27,1.65,23.11,23.11,0,0,1-4.73.5h-14.5ZM469,14.15h5.65a8.16,8.16,0,0,0,1.78-.2A4.78,4.78,0,0,0,478,13.3a3.34,3.34,0,0,0,1.13-1.2,3.63,3.63,0,0,0,.42-1.8,3.22,3.22,0,0,0-.47-1.82,3.33,3.33,0,0,0-1.23-1.13,5.77,5.77,0,0,0-1.7-.58,10.79,10.79,0,0,0-1.85-.17H469Zm0,14.65h7a8.91,8.91,0,0,0,1.83-.2,4.78,4.78,0,0,0,1.67-.7,4,4,0,0,0,1.23-1.3,3.71,3.71,0,0,0,.47-2,3.13,3.13,0,0,0-.62-2A4,4,0,0,0,479,21.45,7.83,7.83,0,0,0,477,20.9a15.12,15.12,0,0,0-2.05-.15H469Zm-265,6.53H271a17.66,17.66,0,0,0,17.66-17.66h0A17.67,17.67,0,0,0,271,0H204.06A17.67,17.67,0,0,0,186.4,17.67h0A17.66,17.66,0,0,0,204.06,35.33ZM10.1,6.9H0V0H28V6.9H17.9V35.4H10.1ZM39,0h7.8V13.2H61.9V0h7.8V35.4H61.9V20.1H46.75V35.4H39ZM80.2,0h24V7.2H88v6.6h15.35V21H88v7.2h17.15v7.2h-25Zm55,0H147l8.15,23.1h.1L163.45,0H175.2V35.4h-7.8V8.25h-.1L158,35.4h-5.95l-9-27.15H143V35.4h-7.8Z" />
  </svg>
);

export default function Landing({ dashboards = [] }) {
  return (
    <main className="lp">
      <style>{S}</style>

      <h1>malloyyo-imdb</h1>
      <p className="sub">
        The 24,052 films and shows with more than 5,000 IMDb ratings &mdash; who made
        them, who appeared in them, how they were rated, and where to watch them.
        Every dashboard runs entirely in your browser.
      </p>

      <ul className="cards">
        {dashboards.map((d) => (
          <li key={d.name}>
            <a href={d.href}>
              <strong>{d.title || d.name}</strong>
              {d.description ? <span>{d.description}</span> : null}
            </a>
          </li>
        ))}
      </ul>

      <div className="credits">
        <p>
          Titles, cast, crew and ratings from the{" "}
          <a href={IMDB_DATA} target="_blank" rel="noopener noreferrer">
            IMDb non-commercial datasets
          </a>.
        </p>
        <div className="tmdb">
          <a href={TMDB} target="_blank" rel="noopener noreferrer" aria-label="The Movie Database">
            <TmdbLogo />
          </a>
        </div>
        <p>This product uses the TMDB API but is not endorsed or certified by TMDB.</p>
      </div>
    </main>
  );
}
