// Le live se reconnecte-t-il après un redémarrage du backend ? (console de match ouverte, backend redémarré, une victoire de round envoyée)
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const [base, password] = process.argv.slice(2);
const CHROME = process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9800 + Math.floor(Math.random() * 90);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const r0 = await fetch(`${base}/auth/local`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) });
const cookie = r0.headers.getSetCookie().find((x) => x.startsWith('gg_session=')).split(';')[0].split('=')[1];
const post = (p, b) => fetch(base + p, { method: 'POST', headers: { Cookie: `gg_session=${cookie}`, 'Content-Type': 'application/json' }, body: JSON.stringify(b) });

const profile = mkdtempSync(join(tmpdir(), 'reco-'));
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--no-first-run', '--window-size=1440,1000', 'about:blank'], { stdio: 'ignore' });
let tabWs;
for (let i = 0; i < 60 && !tabWs; i++) { await sleep(500); try { tabWs = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).find((x) => x.type === 'page')?.webSocketDebuggerUrl; } catch {} }
const ws = new WebSocket(tabWs);
await new Promise((r) => (ws.onopen = r));
let id = 0; const pending = new Map();
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } };
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
await send('Page.enable'); await send('Runtime.enable');
await send('Network.enable');
await send('Network.setCookie', { name: 'gg_session', value: cookie, domain: new URL(base).hostname, path: '/' });
const ev = async (expression) => (await send('Runtime.evaluate', { expression, returnByValue: true })).result.result.value;
const view = () => ev("(() => { const m = [...document.querySelectorAll('main')].pop(); const t = (m ? m.innerText : document.body.innerText).replace(/\\s+/g, ' '); return { round: (t.match(/round (\\d+)/) ?? [])[1], badge: (document.body.innerText.match(/Connecté|Déconnecté|Reconnexion|Hors ligne/) ?? ['?'])[0] }; })()");

await send('Page.navigate', { url: `${base}/admin/games/m-sandbox-1` });
await sleep(4500);
const before = await view();
console.log('avant redémarrage :', JSON.stringify(before));

console.log('redémarrage du backend...');
execFileSync('wsl.exe', ['-d', 'Debian', '--', 'docker', 'restart', 'ggcore-backend-dev'], { stdio: 'ignore' });
for (let i = 0; i < 50; i++) { try { if ((await fetch(`${base}/api/health`)).status === 200) break; } catch {} await sleep(3000); }
await sleep(8000);
const during = await view();
console.log('après redémarrage (page non rechargée) :', JSON.stringify(during));

const win = await post('/sandbox/simulate/round-win', { matchId: 'm-sandbox-1', serverId: 'srv-a', winner: 'CT' });
console.log('victoire de round envoyée :', win.status);
await sleep(5000);
const after = await view();
console.log('après la victoire :', JSON.stringify(after));
const moved = Number(after.round) > Number(before.round);
console.log(moved ? 'LIVE REPRIS : la page a suivi la partie sans rechargement' : 'LIVE PERDU : la page n\'a pas suivi la partie après la reconnexion');
ws.close(); chrome.kill(); process.exit(0);
