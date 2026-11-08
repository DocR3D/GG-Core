// Page publique d'un match (visiteur) et écran Matchs déplié (admin).
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const [base, password, out] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const CHROME = process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9650 + Math.floor(Math.random() * 90);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const r0 = await fetch(`${base}/auth/local`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) });
const cookie = r0.headers.getSetCookie().find((x) => x.startsWith('gg_session=')).split(';')[0].split('=')[1];

const ts = await (await fetch(base + '/api/tournament/tournaments')).json();
const t = ts.find((x) => String(x.name).startsWith('E2E')) ?? ts[0];
const ov = await (await fetch(`${base}/api/tournament/tournaments/${t.id}/overview`)).json();
const all = ov.stages.flatMap((s) => [...s.groups.flatMap((g) => g.matches), ...s.matches]);
const finished = all.find((m) => m.status === 'FINISHED');
const detail = await (await fetch(`${base}/api/tournament/matches/${finished.id}`)).json();
console.log(`match ${detail.home} - ${detail.away} : ${detail.games.length} game(s), stats: ${detail.games.map((g) => (g.stats ?? []).length).join('/')}`);

const profile = mkdtempSync(join(tmpdir(), 'matchchk-'));
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--no-first-run', '--window-size=1440,1000', 'about:blank'], { stdio: 'ignore' });
let tabWs;
for (let i = 0; i < 60 && !tabWs; i++) { await sleep(500); try { tabWs = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).find((x) => x.type === 'page')?.webSocketDebuggerUrl; } catch {} }
const ws = new WebSocket(tabWs);
await new Promise((r) => (ws.onopen = r));
let id = 0; const pending = new Map(); const events = [];
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } else events.push(d); };
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
const ev = async (expression) => (await send('Runtime.evaluate', { expression, returnByValue: true })).result.result.value;
const text = () => ev("document.body.innerText.replace(/\\s+/g, ' ')");
const shot = async (name) => {
  const total = Number(await ev('document.documentElement.scrollHeight')) || 1000;
  const s = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width: 1440, height: Math.min(Math.max(total, 900), 2400), scale: 1 } });
  writeFileSync(join(out, name + '.png'), Buffer.from(s.result.data, 'base64'));
};
const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'OK   ' : 'ECHEC'} ${name}${detail ? '  ' + detail : ''}`); };

// 1. visiteur : page publique du match
await send('Page.navigate', { url: `${base}/view/matches/${finished.id}` });
await sleep(4500);
let t1 = await text();
check('1a le score du match est dans le titre', new RegExp(`${detail.scoreHome} - ${detail.scoreAway}`).test(t1), (t1.match(/E2E \w+ \d+ - \d+ E2E \w+/) ?? [''])[0]);
check('1b le tableau des joueurs est affiché (K D A HS ADR)', /Équipe Joueur K D A HS ADR/.test(t1));
const rows = await ev("document.querySelectorAll('table tbody tr').length");
check('1c des lignes de joueurs', rows > 0, `${rows} lignes`);
check('1d la frise des rounds est affichée', /Victoire CT/.test(t1) && /Victoire T/.test(t1));
check('1e pas de section "Se connecter" vide', !/Se connecter\s+Voir le véto/.test(t1));
await shot('1-match-public');

// 2. admin : écran Matchs, un match déplié
await send('Network.setCookie', { name: 'gg_session', value: cookie, domain: new URL(base).hostname, path: '/' });
await send('Page.navigate', { url: `${base}/admin` });
await sleep(2500);
await ev(`localStorage.setItem('gg:tournament', ${JSON.stringify(t.id)})`);
await send('Page.navigate', { url: `${base}/admin/matchs` });
await sleep(4500);
const fake = t;
const fm = finished;
console.log('écran Matchs, tournoi', fake.name, ':', fm.home, '-', fm.away);
const opened = await ev(`(() => { const want = [${JSON.stringify(fm.home)}, ${JSON.stringify(fm.away)}]; const els = [...document.querySelectorAll('div')].filter((e) => want.every((n) => e.innerText && e.innerText.includes(n)) && e.innerText.length < 160 && e.offsetParent !== null); if (!els.length) return 'INTROUVABLE'; els.sort((a, b) => a.innerText.length - b.innerText.length)[0].click(); return 'ok'; })()`);
await sleep(2500);
const t2 = await text();
check('2a le match se déplie (Détail par map)', opened === 'ok' && /détail par map/i.test(t2), opened);
check('2b la frise est dans le déplié', /Victoire CT/.test(t2));
await shot('2-matchs-deplie');

const errs = events.filter((e) => e.method === 'Runtime.exceptionThrown' || (e.method === 'Network.responseReceived' && e.params.response.status >= 400 && !/auth\/me|favicon/.test(e.params.response.url))).map((e) => e.method === 'Runtime.exceptionThrown' ? 'EXC ' + (e.params.exceptionDetails.exception?.description ?? '').split('\n')[0] : `${e.params.response.status} ${e.params.response.url.replace(base, '')}`);
console.log(errs.length ? `ERREURS NAVIGATEUR: ${[...new Set(errs)].join(' || ')}` : 'aucune erreur navigateur');
console.log(`BILAN ${results.filter(Boolean).length}/${results.length}`);
ws.close(); chrome.kill(); process.exit(0);
