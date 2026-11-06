// Parcours de la page Sandbox match du front Next, dans Chrome headless (protocole DevTools).
// usage: node sandbox-flow.mjs <baseUrl> <motDePasseAdmin> <dossierSortie>
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const [base, password, out] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const CHROME = process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9900 + Math.floor(Math.random() * 90);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const r0 = await fetch(`${base}/auth/local`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) });
const cookie = r0.headers.getSetCookie().find((x) => x.startsWith('gg_session=')).split(';')[0].split('=')[1];

const profile = mkdtempSync(join(tmpdir(), 'sbxflow-'));
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--no-first-run', '--window-size=1440,1000', 'about:blank'], { stdio: 'ignore' });
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
const shot = async (name, y = 0, height = 2400) => {
  const total = Number(await ev('document.documentElement.scrollHeight')) || 1000;
  const s = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y, width: 1440, height: Math.min(Math.max(total - y, 600), height), scale: 1 } });
  writeFileSync(join(out, name + '.png'), Buffer.from(s.result.data, 'base64'));
};
const click = (label) => ev(`(() => { const els = [...document.querySelectorAll('button,a,[role=button]')].filter((e) => e.offsetParent !== null && !e.disabled && e.innerText && e.innerText.trim().includes(${JSON.stringify(label)})); if (!els.length) return 'INTROUVABLE'; els[0].click(); return 'ok'; })()`);
const select = (labelFragment, value) => ev(`(() => { const sel = [...document.querySelectorAll('select')].find((s) => (s.closest('label')?.innerText ?? s.options[0]?.textContent ?? '').includes(${JSON.stringify(labelFragment)})); if (!sel) return 'INTROUVABLE'; const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; set.call(sel, ${JSON.stringify(value)}); sel.dispatchEvent(new Event('change', { bubbles: true })); return sel.value; })()`);
const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'OK   ' : 'ECHEC'} ${name}${detail ? '  ' + detail : ''}`); };

await send('Page.navigate', { url: base + '/admin/sandbox/match' });
await sleep(4500);
let t = await text();
check('1 la page se charge (titre, scoreboard vide)', t.includes('Sandbox match') && t.includes('En attente de données joueurs'));
check('2 les presets sont affichés', /Scénarios prédéfinis\s*\d+/.test(t), (t.match(/Scénarios prédéfinis\s*(\d+)/) ?? [])[0]);
const fixturesCount = await ev("[...document.querySelectorAll('select option')].filter((o) => /\\.(log|json)$/.test(o.value)).length");
check('3 les fixtures sont listées', fixturesCount > 0, `${fixturesCount} options`);
check('4 le WebSocket est connecté', t.includes('WebSocket connecté'));

// injection d'un état
check('5 injecter GG-Core seul', (await click('Injecter GG-Core seul')) === 'ok');
await sleep(2500);
t = await text();
check('6 le scoreboard affiche le joueur testeur', t.includes('DocR3D'), (t.match(/Scoreboard[^A-Z]{0,40}/) ?? [''])[0]);
await shot('1-apres-injection');

// replay round par round
const fixtureValue = await ev("(() => { const o = [...document.querySelectorAll('select option')].find((o) => /gglan19_dust2_13-0/.test(o.value)); return o ? o.value : ''; })()");
check('7 la fixture dust2 13-0 existe', !!fixtureValue, fixtureValue);
await select('Match archivé', fixtureValue);
await select('Vitesse', 'rounds');
check('8 lancer la simulation', (await click('Lancer la simulation')) === 'ok');
await sleep(3000);
t = await text();
check('9 la barre round par round apparait (Round 0 / N)', /Round 0 \/ \d+/.test(t), (t.match(/Round 0 \/ \d+/) ?? [''])[0]);
for (let i = 0; i < 3; i++) { await click('Round suivant'); await sleep(1800); }
t = await text();
check('10 après 3 "Round suivant" : Round 3', /Round 3 \/ \d+/.test(t), (t.match(/Round \d \/ \d+/) ?? [''])[0]);
const sb3 = (t.match(/CT \d+ - \d+ T · [^R]{0,40}/) ?? [''])[0];
console.log('   dernier round:', sb3);
await select('avant le 1er round', '7');
await sleep(2500);
t = await text();
check('11 aller au round 7', /Round 7 \/ \d+/.test(t));
const players = await ev("document.querySelectorAll('tbody tr').length");
check('12 le scoreboard est rempli (joueurs des 2 équipes)', players >= 10, `${players} lignes`);
await shot('2-replay-round-7');
check('13 round précédent', (await click('Round précédent')) === 'ok');
await sleep(2000);
t = await text();
check('14 retour au round 6', /Round 6 \/ \d+/.test(t));

// simulation d'événements
check('15 simuler victoire CT', (await click('Simuler victoire CT')) === 'ok');
await sleep(1500);
check('16 commande !pause', (await click('!pause')) === 'ok');
await sleep(1500);
t = await text();
check('17 la console journalise les actions', /Victoire de round CT : fait/.test(t) && /Commande !pause/.test(t));
const wsEvents = await ev("document.body.innerText.match(/\\b(score:update|team_round_win|kill|match:state|item:purchase)\\b/g)?.length ?? 0");
console.log('   événements WebSocket vus dans la console:', wsEvents);
await shot('3-fin', 0, 3200);

const errors = events.filter((e) => e.method === 'Runtime.exceptionThrown' || (e.method === 'Network.responseReceived' && e.params.response.status >= 400 && !/auth\/me|favicon/.test(e.params.response.url))).map((e) => e.method === 'Runtime.exceptionThrown' ? 'EXC ' + (e.params.exceptionDetails.exception?.description ?? '').split('\n')[0] : `${e.params.response.status} ${e.params.response.url.replace(base, '')}`);
console.log(errors.length ? `ERREURS NAVIGATEUR: ${[...new Set(errors)].join(' || ')}` : 'aucune erreur navigateur');
console.log(`BILAN ${results.filter(Boolean).length}/${results.length}`);
ws.close(); chrome.kill(); process.exit(0);
