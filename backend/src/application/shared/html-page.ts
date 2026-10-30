// src/application/shared/html-page.ts
// Skeleton of the server-rendered pages (/login, /view, /sandbox/tournament): plain semantic HTML styled by
// Pico.css + our own stylesheets (backend/public/css, served locally under /assets - no CDN, LAN-first). No script.
// The look lives in the CSS only: base.css (GG-Lan palette, Poppins, class vocabulary) then one theme file.

export const PICO_CSS = '/assets/pico.classless.min.css';

/** admin: dense console (Sandbox, operations) - public: players and spectators. */
export type PageTheme = 'admin' | 'public';

export const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const NAV: Record<PageTheme, [string, string][]> = {
  public: [['/view', 'Tournois'], ['/login', 'Connexion']],
  admin: [['/view', 'Tournois'], ['/sandbox/tournament', 'Simulations'], ['/sandbox', 'Sandbox'], ['/login', 'Connexion']],
};

export function htmlPage(opts: { title: string; body: string; refreshSec?: number; theme?: PageTheme }): string {
  const theme = opts.theme ?? 'public';
  const refresh = opts.refreshSec && opts.refreshSec > 0 ? `<meta http-equiv="refresh" content="${Math.floor(opts.refreshSec)}">` : '';
  const links = NAV[theme].map(([href, label]) => `<li><a href="${href}">${label}</a></li>`).join('');
  return `<!doctype html>
<html lang="fr" data-theme="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">${refresh}
<title>${escapeHtml(opts.title)}</title>
<link rel="stylesheet" href="${PICO_CSS}">
<link rel="stylesheet" href="/assets/css/base.css">
<link rel="stylesheet" href="/assets/css/${theme}.css">
</head>
<body>
<header><nav><ul><li><a class="gg-brand" href="/view"><b>GG</b>-Core</a></li></ul><ul>${links}</ul></nav></header>
<main>
${opts.body}
</main></body></html>
`;
}
