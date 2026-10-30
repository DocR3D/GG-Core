// src/application/shared/html-page.ts
// Skeleton of the server-rendered pages (/login, /view, /sandbox/tournament): plain semantic HTML styled by
// Pico.css (classless, served locally under /assets - no CDN, LAN-first). No script.

export const PICO_CSS = '/assets/pico.classless.min.css';

export const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function htmlPage(opts: { title: string; body: string; refreshSec?: number }): string {
  const refresh = opts.refreshSec && opts.refreshSec > 0 ? `<meta http-equiv="refresh" content="${Math.floor(opts.refreshSec)}">` : '';
  return `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">${refresh}
<title>${escapeHtml(opts.title)}</title>
<link rel="stylesheet" href="${PICO_CSS}">
</head>
<body><main>
${opts.body}
</main></body></html>
`;
}
