// Parcours automatique du front Next avec Chrome headless (protocole DevTools, aucune dépendance).
// usage: node walk-screens.mjs <baseUrl> <motDePasseAdmin> <dossierSortie> [visitor]
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const [base, password, out, mode, only] = process.argv.slice(2);
const visitor = mode === 'visitor';
mkdirSync(out, { recursive: true });
const CHROME = process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9400 + Math.floor(Math.random() * 300);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function login() {
  const r = await fetch(`${base}/auth/local`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  });
  if (r.status !== 200) throw new Error(`login ${r.status}`);
  const c = r.headers.getSetCookie().find((x) => x.startsWith('gg_session='));
  return c.split(';')[0].split('=')[1];
}

async function api(path, cookie) {
  const r = await fetch(`${base}${path}`, { headers: cookie ? { Cookie: `gg_session=${cookie}` } : {} });
  return r.ok ? r.json() : null;
}

function findMatchIds(node, acc = new Set(), depth = 0) {
  if (!node || depth > 8) return acc;
  if (Array.isArray(node)) node.forEach((n) => findMatchIds(n, acc, depth + 1));
  else if (typeof node === 'object') {
    if (typeof node.id === 'string' && (node.games || node.series || node.homeTeam || node.home)) acc.add(node.id);
    Object.values(node).forEach((n) => findMatchIds(n, acc, depth + 1));
  }
  return acc;
}

const cookie = visitor ? null : await login();
const tournaments = (await api('/api/tournament/tournaments', cookie)) ?? [];
const t = tournaments.find((x) => String(x.name).startsWith(process.env.T_PREFIX ?? 'E2E')) ?? tournaments[0];
const overview = t ? await api(`/api/tournament/tournaments/${t.id}/overview`, cookie) : null;
const matchIds = [...findMatchIds(overview)];
const live = (await api('/api/tournament/live', cookie)) ?? [];
console.log(`tournoi: ${t?.name} (${t?.id}) | matchs trouvés: ${matchIds.length} | games en cours: ${live.length}`);

const routes = visitor
  ? ['/', '/login', '/view', t && `/view/tournaments/${t.id}`, matchIds[0] && `/view/matches/${matchIds[0]}`, matchIds[0] && `/veto/${matchIds[0]}`, '/admin']
  : [
      '/',
      '/admin',
      '/admin/dashboard',
      '/admin/tournois',
      '/admin/equipes',
      '/admin/matchs',
      '/admin/serveurs',
      t && `/admin/tournaments/${t.id}`,
      t && `/admin/tournaments/${t.id}/equipes`,
      t && `/admin/tournaments/${t.id}/phases`,
      t && `/admin/tournaments/${t.id}/matchs`,
      '/admin/sandbox',
      '/admin/sandbox/match',
      '/admin/messages',
      live[0] && `/admin/games/${live[0].gameId ?? live[0].id}`,
      '/view',
      t && `/view/tournaments/${t.id}`,
      matchIds[0] && `/view/matches/${matchIds[0]}`,
      matchIds[0] && `/veto/${matchIds[0]}`,
      matchIds[0] && `/veto/${matchIds[0]}/admin`,
      '/veto',
    ];

const profile = mkdtempSync(join(tmpdir(), 'cdp-'));
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--no-first-run', '--window-size=1440,900', 'about:blank'], { stdio: 'ignore' });
let tabWs;
for (let i = 0; i < 60 && !tabWs; i++) {
  await sleep(500);
  try {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
    tabWs = list.find((x) => x.type === 'page')?.webSocketDebuggerUrl;
  } catch {}
}
if (!tabWs) { chrome.kill(); throw new Error('Chrome DevTools injoignable'); }

const ws = new WebSocket(tabWs);
await new Promise((r) => (ws.onopen = r));
let id = 0;
const pending = new Map();
const handlers = [];
ws.onmessage = (m) => {
  const d = JSON.parse(m.data);
  if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); }
  else handlers.forEach((h) => h(d));
};
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });

await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable'); await send('Log.enable');
const host = new URL(base).hostname;
if (cookie) await send('Network.setCookie', { name: 'gg_session', value: cookie, domain: host, path: '/' });

let cur;
const reset = () => (cur = { errors: [], failed: [], sockets: [], frames: 0, closed: [] });
reset();
const urlOf = new Map();
handlers.push((d) => {
  const { method, params: p } = d;
  if (method === 'Runtime.exceptionThrown') cur.errors.push('EXC ' + (p.exceptionDetails.exception?.description ?? p.exceptionDetails.text).split('\n')[0].slice(0, 200));
  if (method === 'Runtime.consoleAPICalled' && p.type === 'error') cur.errors.push('console.error ' + p.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 200));
  if (method === 'Network.requestWillBeSent') urlOf.set(p.requestId, p.request.url);
  if (method === 'Network.responseReceived' && p.response.status >= 400) cur.failed.push(`${p.response.status} ${p.response.url.replace(base, '')}`);
  if (method === 'Network.loadingFailed' && !p.canceled) cur.failed.push(`FAILED ${(urlOf.get(p.requestId) ?? '').replace(base, '')} ${p.errorText}`);
  if (method === 'Network.webSocketCreated') cur.sockets.push(p.url.replace(/^wss?:\/\/[^/]+/, ''));
  if (method === 'Network.webSocketFrameReceived') cur.frames++;
  if (method === 'Network.webSocketClosed') cur.closed.push('closed');
});

const report = [];
let n = 0;
const base_list = routes.filter(Boolean);
const run_list = !only ? base_list : base_list.some((r) => r.includes(only)) ? base_list.filter((r) => r.includes(only)) : [only];
for (const route of run_list) {
  reset();
  await send('Page.navigate', { url: base + route });
  await sleep(4500);
  const ev = await send('Runtime.evaluate', {
    expression: `JSON.stringify({url: location.pathname + location.search, title: document.title, text: (document.querySelector('main')||document.body).innerText.replace(/\\s+/g,' ').slice(0,260), len: document.body.innerText.length})`,
    returnByValue: true,
  });
  const info = JSON.parse(ev.result.result.value);
  if (process.env.STEP_ROUND) {
    const readScore = async () => (await send('Runtime.evaluate', { expression: "(document.querySelectorAll('main')[document.querySelectorAll('main').length-1]||document.body).innerText.slice(0,500)", returnByValue: true })).result.result.value;
    const before = await readScore();
    await fetch(`${base}/sandbox/replay/rounds/step`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: `gg_session=${cookie}` }, body: JSON.stringify({ matchId: process.env.STEP_MATCH, action: 'goto', round: Number(process.env.STEP_ROUND) }) });
    await sleep(3500);
    const after = await readScore();
    console.log('LIVE avant :', before.replace(/\s+/g, ' ').slice(0, 170));
    console.log('LIVE apres :', after.replace(/\s+/g, ' ').slice(0, 170));
    console.log('LIVE mis a jour sans rechargement:', before !== after);
  }
  const h = await send('Runtime.evaluate', { expression: 'document.documentElement.scrollHeight', returnByValue: true });
  const total = Number(h.result.result.value) || 900;
  const y0 = Number(process.env.CLIP_Y ?? 0);
  const height = Math.min(Math.max(total - y0, 600), 2600);
  console.log(`  hauteur page: ${total}`);
  const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: y0, width: 1440, height, scale: 1 } });
  const file = `${String(++n).padStart(2, '0')}${route.replace(/[^a-z0-9]+/gi, '_').slice(0, 40)}.png`;
  writeFileSync(join(out, file), Buffer.from(shot.result.data, 'base64'));
  report.push({ route, ...info, errors: [...new Set(cur.errors)], failed: [...new Set(cur.failed)], sockets: cur.sockets, frames: cur.frames, file });
}
writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2));
for (const r of report) {
  const redirected = r.url !== r.route ? ` -> ${r.url}` : '';
  console.log(`\n${r.route}${redirected}  [${r.file}]`);
  console.log(`  titre: ${r.title} | texte(${r.len}): ${r.text}`);
  if (r.errors.length) console.log('  ERREURS:', r.errors.join(' || '));
  if (r.failed.length) console.log('  REQUETES EN ECHEC:', r.failed.join(' || '));
  if (r.sockets.length) console.log(`  websocket: ${r.sockets.join(', ')} | trames recues: ${r.frames}`);
}
ws.close(); chrome.kill();
process.exit(0);
