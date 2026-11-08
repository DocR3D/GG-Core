// Parcours interactif des flux existants du front Next dans Chrome headless (protocole DevTools).
// usage: node admin-flows.mjs <baseUrl> <motDePasseAdmin> <dossierSortie>
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const [base, password, out] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const CHROME = process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9700 + Math.floor(Math.random() * 200);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stamp = new Date().toISOString().slice(11, 19);

const r0 = await fetch(`${base}/auth/local`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) });
const cookie = r0.headers.getSetCookie().find((x) => x.startsWith('gg_session=')).split(';')[0].split('=')[1];
const api = async (method, path, body) => {
  const r = await fetch(base + path, { method, headers: { Cookie: `gg_session=${cookie}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text();
  try { return { status: r.status, data: JSON.parse(t) }; } catch { return { status: r.status, data: t }; }
};

const profile = mkdtempSync(join(tmpdir(), 'uiflow-'));
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--no-first-run', '--window-size=1440,900', 'about:blank'], { stdio: 'ignore' });
let tabWs;
for (let i = 0; i < 60 && !tabWs; i++) {
  await sleep(500);
  try { tabWs = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).find((x) => x.type === 'page')?.webSocketDebuggerUrl; } catch {}
}
const ws = new WebSocket(tabWs);
await new Promise((r) => (ws.onopen = r));
let id = 0;
const pending = new Map();
const events = [];
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } else events.push(d); };
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
await send('Network.setCookie', { name: 'gg_session', value: cookie, domain: new URL(base).hostname, path: '/' });

const ev = async (expression) => (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result.result.value;
const text = () => ev("document.body.innerText.replace(/\\s+/g,' ')");
const goto = async (path) => { await send('Page.navigate', { url: base + path }); await sleep(3500); };
const shot = async (name) => {
  const h = Number(await ev('document.documentElement.scrollHeight')) || 900;
  const s = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width: 1440, height: Math.min(Math.max(h, 900), 2400), scale: 1 } });
  writeFileSync(join(out, name + '.png'), Buffer.from(s.result.data, 'base64'));
};
const click = (label, scope = 'document') => ev(`(() => { const root = ${scope}; const els = [...root.querySelectorAll('button,a,[role=button],[role=menuitem],[role=tab]')].filter((e) => e.offsetParent !== null && e.innerText && e.innerText.trim().includes(${JSON.stringify(label)})); if (!els.length) return 'INTROUVABLE'; els[els.length - 1].click(); return 'ok'; })()`);
const fill = (index, value, scope = 'document') => ev(`(() => { const root = ${scope}; const els = [...root.querySelectorAll('input:not([type=hidden]),textarea')].filter((e) => e.offsetParent !== null); const e = els[${index}]; if (!e) return 'INTROUVABLE'; const set = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(e), 'value').set; set.call(e, ${JSON.stringify(value)}); e.dispatchEvent(new Event('input', { bubbles: true })); return 'ok'; })()`);
const dialog = "document.querySelector('[role=dialog]') || document";
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'OK   ' : 'ECHEC'} ${name}${detail ? '  ' + detail : ''}`); };
const errors = () => events.filter((e) => e.method === 'Runtime.exceptionThrown' || (e.method === 'Network.responseReceived' && e.params.response.status >= 400 && !/\/auth\/me|favicon/.test(e.params.response.url))).map((e) => e.method === 'Runtime.exceptionThrown' ? 'EXC ' + (e.params.exceptionDetails.exception?.description ?? '').split('\n')[0] : `${e.params.response.status} ${e.params.response.url.replace(base, '')}`);

// ---- A. créer un tournoi depuis l'écran Tournois
const tname = `UI Test ${stamp}`;
await goto('/admin/tournois');
check('A1 ouvrir le dialogue "Créer un tournoi"', (await click('Créer un tournoi')) === 'ok');
await sleep(800);
console.log('   champs du dialogue:', await ev(`[...(${dialog}).querySelectorAll('input')].map((i) => i.placeholder || i.name || i.type).join(' | ')`));
check('A2 saisir le nom', (await fill(0, tname, dialog)) === 'ok');
await shot('A-dialogue-tournoi');
const created = await click('Créer', dialog);
await sleep(2500);
const afterCreate = await text();
const list = (await api('GET', '/api/tournament/tournaments')).data;
const made = Array.isArray(list) ? list.find((t) => t.name === tname) : null;
check('A3 le tournoi existe côté API', !!made, made ? made.id : `clic: ${created}`);
await goto('/admin/tournois');
check('A4 il apparait dans la liste', (await text()).includes(tname));
await shot('A-liste-tournois');

// ---- B. ajouter un serveur
const sname = `srv-ui-${Date.now() % 10000}`;
await goto('/admin/serveurs');
check('B1 ouvrir "Ajouter un serveur"', (await click('Ajouter un serveur')) === 'ok');
await sleep(800);
console.log('   champs du dialogue:', await ev(`[...(${dialog}).querySelectorAll('input')].map((i) => i.placeholder || i.name || i.type).join(' | ')`));
await fill(0, sname, dialog); await fill(1, '10.0.0.77', dialog); await fill(2, '27015', dialog);
await shot('B-dialogue-serveur');
const added = await click('Ajouter', dialog);
await sleep(2500);
const servers = (await api('GET', '/api/tournament/servers')).data;
const srv = Array.isArray(servers) ? servers.find((s) => s.name === sname) : null;
check('B2 le serveur existe côté API', !!srv, srv ? srv.id : `clic: ${added}`);
await goto('/admin/serveurs');
const t2 = await text();
check('B3 la carte du serveur est affichée', t2.includes(sname));
check('B4 la ligne des logs CS2 est affichée', /Logs CS2|Aucun log CS2/.test(t2), (t2.match(/(Aucun log CS2 reçu|Logs CS2 reçus[^.]{0,20}|Logs refusés[^.]{0,30})/) ?? [''])[0]);
await shot('B-serveurs');

// ---- C. désactiver puis remettre en service
if (srv) {
  await click('Actions');
  const c1 = await ev(`(() => { const b = [...document.querySelectorAll('button')].filter((e) => e.offsetParent !== null && e.getAttribute('aria-haspopup')); return b.length; })()`);
  console.log('   menus d actions visibles:', c1);
}

// ---- nettoyage
if (made) await api('DELETE', `/api/tournament/tournaments/${made.id}`);
if (srv) await api('DELETE', `/api/tournament/servers/${srv.id}`);
const left = (await api('GET', '/api/tournament/servers')).data;
console.log('nettoyage: serveur supprimé =', Array.isArray(left) && !left.some((s) => s.name === sname));

const errs = [...new Set(errors())];
console.log(errs.length ? `ERREURS NAVIGATEUR: ${errs.join(' || ')}` : 'aucune erreur navigateur');
console.log(`BILAN ${results.filter((r) => r.ok).length}/${results.length}`);
ws.close(); chrome.kill(); process.exit(0);
