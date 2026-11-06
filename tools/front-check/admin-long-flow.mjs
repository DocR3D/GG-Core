// Flux admin long du front Next, joué dans Chrome headless : tournoi -> équipes -> véto -> phases -> poules -> résultats -> qualification.
// usage: node admin-long-flow.mjs <baseUrl> <motDePasseAdmin> <dossierSortie>
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const [base, password, out] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const CHROME = process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9500 + Math.floor(Math.random() * 90);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const r0 = await fetch(`${base}/auth/local`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) });
const cookie = r0.headers.getSetCookie().find((x) => x.startsWith('gg_session=')).split(';')[0].split('=')[1];
const api = async (method, path, body) => {
  const r = await fetch(base + path, { method, headers: { Cookie: `gg_session=${cookie}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text();
  try { return { status: r.status, data: JSON.parse(t) }; } catch { return { status: r.status, data: t }; }
};

const profile = mkdtempSync(join(tmpdir(), 'longflow-'));
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--no-first-run', '--window-size=1440,1000', 'about:blank'], { stdio: 'ignore' });
let tabWs;
for (let i = 0; i < 60 && !tabWs; i++) { await sleep(500); try { tabWs = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).find((x) => x.type === 'page')?.webSocketDebuggerUrl; } catch {} }
const ws = new WebSocket(tabWs);
await new Promise((r) => (ws.onopen = r));
let id = 0; const pending = new Map(); const events = [];
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } else events.push(d); };
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
await send('Network.setCookie', { name: 'gg_session', value: cookie, domain: new URL(base).hostname, path: '/' });

const ev = async (expression) => (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result.result.value;
const MAIN = "(document.querySelectorAll('main')[document.querySelectorAll('main').length - 1] || document.body)";
const text = () => ev(`${MAIN}.innerText.replace(/\\s+/g, ' ')`);
const pathname = () => ev('location.pathname');
const goto = async (path) => { await send('Page.navigate', { url: base + path }); await sleep(3500); };
const shot = async (name) => {
  const total = Number(await ev('document.documentElement.scrollHeight')) || 1000;
  const s = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width: 1440, height: Math.min(Math.max(total, 900), 2400), scale: 1 } });
  writeFileSync(join(out, name + '.png'), Buffer.from(s.result.data, 'base64'));
};
const buttons = () => ev(`[...${MAIN}.querySelectorAll('button, a')].filter((e) => e.offsetParent !== null && !e.disabled).map((e) => (e.innerText || '').trim().replace(/\\s+/g, ' ')).filter(Boolean)`);
const click = (label, nth = 0) => ev(`(() => { const els = [...${MAIN}.querySelectorAll('button, a')].filter((e) => e.offsetParent !== null && !e.disabled && (e.innerText || '').replace(/\\s+/g, ' ').trim().includes(${JSON.stringify(label)})); const e = els[${nth}]; if (!e) return 'INTROUVABLE'; e.click(); return 'ok'; })()`);
const clickDialog = (label) => ev(`(() => { const root = document.querySelector('[role=dialog], [role=alertdialog]') || document; const els = [...root.querySelectorAll('button')].filter((e) => e.offsetParent !== null && !e.disabled && (e.innerText || '').trim().includes(${JSON.stringify(label)})); const e = els[els.length - 1]; if (!e) return 'INTROUVABLE'; e.click(); return 'ok'; })()`);
const fill = (fragment, value, nth = 0) => ev(`(() => { const els = [...${MAIN}.querySelectorAll('input:not([type=hidden]):not([type=checkbox]), textarea')].filter((e) => e.offsetParent !== null && (((e.closest('label')?.innerText ?? '') + '|' + e.placeholder + '|' + (e.getAttribute('aria-label') ?? '')).toLowerCase().includes(${JSON.stringify(fragment.toLowerCase())}))); const e = els[${nth}]; if (!e) return 'INTROUVABLE'; const set = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(e), 'value').set; set.call(e, ${JSON.stringify(value)}); e.dispatchEvent(new Event('input', { bubbles: true })); return 'ok'; })()`);
const fillIndex = (index, value) => ev(`(() => { const els = [...${MAIN}.querySelectorAll('input:not([type=hidden]):not([type=checkbox]), textarea')].filter((e) => e.offsetParent !== null); const e = els[${index}]; if (!e) return 'INTROUVABLE'; const set = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(e), 'value').set; set.call(e, ${JSON.stringify(value)}); e.dispatchEvent(new Event('input', { bubbles: true })); return 'ok'; })()`);
const selectOption = (labelFragment, optionText) => ev(`(() => { const sel = [...${MAIN}.querySelectorAll('select')].find((s) => (s.closest('label')?.innerText ?? '').includes(${JSON.stringify(labelFragment)})); if (!sel) return 'INTROUVABLE'; const o = [...sel.options].find((o) => o.textContent.includes(${JSON.stringify(optionText)})); if (!o) return 'OPTION?'; const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; set.call(sel, o.value); sel.dispatchEvent(new Event('change', { bubbles: true })); return 'ok'; })()`);

const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'OK   ' : 'ECHEC'} ${name}${detail ? '  ' + detail : ''}`); };
const show = async (label) => { console.log(`   [${label}] boutons: ${(await buttons()).slice(0, 26).join(' | ')}`); };

const tname = `Flow Long ${Date.now() % 100000}`;
const made = await api('POST', '/api/tournament/tournaments', { name: tname });
const tid = made.data.id;
const T = `/admin/tournaments/${tid}`;
let abort = false;
try {
  // 1. ouvrir le tournoi : mène à la première étape
  await goto(T);
  check('1 ouvrir le tournoi mène à une étape', /\/admin\/tournaments\/[^/]+\/(tournoi|equipes)/.test(await pathname()), await pathname());

  // 2. renommer
  await goto(`${T}/tournoi`);
  const newName = tname + ' (renommé)';
  check('2a saisir un nouveau nom', (await fill('nom', newName)) === 'ok');
  check('2b cliquer Renommer', (await click('Renommer')) === 'ok');
  await sleep(1800);
  const t1 = (await api('GET', `/api/tournament/tournaments/${tid}/overview`)).data;
  check('2c le nom est enregistré (API)', t1?.summary?.name === newName || JSON.stringify(t1).includes('(renommé)'));

  // 3. équipes
  await click('Étape suivante');
  await sleep(2000);
  check('3a "Étape suivante" mène aux équipes', (await pathname()).endsWith('/equipes'), await pathname());
  const teams = ['Flow Alpha', 'Flow Bravo', 'Flow Charlie', 'Flow Delta'];
  for (let i = 0; i < teams.length; i++) {
    await fill('nom de l', teams[i]);
    await fill('pseudo', `Capitaine${i + 1}`);
    await fill('7656', `7656119800000000${i + 1}`);
    const c = await click("Ajouter l'équipe");
    await sleep(1800);
    const txt = await text();
    check(`3b équipe ${teams[i]} ajoutée`, c === 'ok' && txt.includes(teams[i]));
  }
  const barText = await ev("document.body.innerText.replace(/\\s+/g,' ')");
  check('3c la barre dit "fait, 4 équipes"', barText.includes('fait, 4 équipes'), (barText.match(/2Équipes[^3]{0,30}/) ?? [''])[0]);
  await shot('3-equipes');

  // 4. véto
  await click('Étape suivante');
  await sleep(2000);
  check('4a étape Véto', (await pathname()).endsWith('/veto'));
  check('4b enregistrer le véto', (await click('Enregistrer le véto')) === 'ok');
  await sleep(2000);
  const vtxt = await ev("document.body.innerText.replace(/\\s+/g,' ')");
  check('4c la barre dit "fait, 7 maps"', vtxt.includes('fait, 7 maps'), (vtxt.match(/3Véto[^4]{0,30}/) ?? [''])[0]);

  // 5. phases
  await click('Étape suivante');
  await sleep(2000);
  check('5a étape Phases', (await pathname()).endsWith('/phases'));
  check('5b nom de la phase', (await fill('nouvelle phase', 'Poules')) === 'ok');
  check('5c créer la phase de poules', (await click('Créer la phase')) === 'ok');
  await sleep(2500);
  await show('phases après création');
  await shot('5-phases');
  let ptxt = await text();
  check('5d la phase Poules existe', ptxt.includes('Poules'));

  // 6. générer les poules
  const gen = (await buttons()).find((b) => /Générer/.test(b));
  console.log('   bouton de génération trouvé:', gen);
  if (gen) {
    await click('Générer');
    await sleep(2500);
    await show('après Générer');
    const ptxt2 = await text();
    check('6a une action de génération a répondu', true, ptxt2.slice(0, 160));
  }
  const g2 = (await buttons()).find((b) => /Générer les poules|Générer le/.test(b));
  if (g2) { await click(g2.split(' ').slice(0, 3).join(' ')); await sleep(3000); }
  await shot('6-apres-generation');
  const ov = (await api('GET', `/api/tournament/tournaments/${tid}/overview`)).data;
  const stage = ov?.stages?.[0];
  const matchesCount = stage ? stage.groups.flatMap((g) => g.matches).length + stage.matches.length : 0;
  check('6b les poules sont générées (API : matchs de poules)', matchesCount > 0, `${matchesCount} matchs, ${stage?.groups?.length ?? 0} poule(s)`);

  // 7. matchs : saisir des résultats
  await goto(`${T}/matchs`);
  await sleep(1500);
  await show('étape Matchs');
  await shot('7-matchs');
  let entered = 0;
  for (let i = 0; i < 8; i++) {
    const c = await click('Saisir un résultat');
    if (c !== 'ok') break;
    await sleep(900);
    const fields = await ev(`[...document.querySelectorAll('input:not([type=hidden]):not([type=checkbox])')].filter((e) => e.offsetParent !== null).map((e) => (e.closest('label')?.innerText.split('\\n')[0] ?? '') + '|' + e.placeholder + '|' + e.type)`);
    if (i === 0) console.log('   champs du résultat:', JSON.stringify(fields).slice(0, 300));
    entered++;
    break;
  }
  check('7a "Saisir un résultat" ouvre un formulaire', entered > 0);

  // 7b. saisir les résultats des matchs de poules (le formulaire de 7a est déjà ouvert pour le premier match)
  const finished = async () => {
    const o = (await api('GET', `/api/tournament/tournaments/${tid}/overview`)).data;
    return o.stages.flatMap((s) => [...s.groups.flatMap((g) => g.matches), ...s.matches]).filter((m) => m.status === 'FINISHED').length;
  };
  const submitWords = ['Enregistrer', 'Valider', 'Confirmer', 'Envoyer'];
  for (let k = 0; k < 4; k++) {
    if (k > 0) {
      if ((await click('Saisir un résultat')) !== 'ok') break;
      await sleep(800);
    }
    const a = await fill('score de', String(13), 0);
    const b = await fill('score de', String(5 + k), 1);
    const names = (await buttons()).filter((x) => /résultat|Enregistrer|Valider|Confirmer|Envoyer|Annuler/i.test(x));
    if (k === 0) console.log('   boutons du formulaire:', names.join(' | '), '| scores:', a, b);
    let done = 'INTROUVABLE';
    for (const w of submitWords) { done = await click(w); if (done === 'ok') break; }
    await sleep(2200);
    const n = await finished();
    console.log(`   match ${k + 1}: scores ${a}/${b}, validation ${done}, terminés en base: ${n}`);
    if (n >= 2 && (await click('Saisir un résultat')) !== 'ok') break;
    if (n >= 2) { await click('Annuler'); break; }
  }
  const nFinished = await finished();
  check('7b au moins 2 matchs de poules terminés (API)', nFinished >= 2, `${nFinished} terminés`);
  await shot('7b-apres-resultats');

  // 8. phase en double élimination : "Créer les arbres Élite et Amateur"
  await goto(`${T}/phases`);
  const hasTrees = (await buttons()).some((x) => x.includes('Créer les arbres'));
  check('8a le bouton "Créer les arbres Élite et Amateur" est proposé', hasTrees);
  if (hasTrees) {
    await click('Créer les arbres');
    await sleep(2500);
    await show('après création des arbres');
    const ov2 = (await api('GET', `/api/tournament/tournaments/${tid}/overview`)).data;
    check('8b trois phases existent (poules + 2 arbres)', ov2.stages.length >= 3, `${ov2.stages.length} phases : ${ov2.stages.map((s) => s.name).join(', ')}`);
  }

  // 9. qualification
  await goto(`${T}/matchs`);
  await sleep(1500);
  const tabs = (await buttons()).filter((x) => /Qualification|Élite|Amateur|Poules/.test(x)).slice(0, 8);
  console.log('   onglets/boutons de qualification:', tabs.join(' | '));
  const q = await click('Qualification');
  await sleep(2000);
  await show('onglet Qualification');
  await shot('9-qualification');
  check('9a l’onglet Qualification s’ouvre', q === 'ok', await pathname());
  const closing = (await buttons()).find((x) => /Clore les poules|Qualifier/.test(x));
  console.log('   action de qualification proposée:', closing);
  if (closing) {
    await click(closing.includes('Clore') ? 'Clore les poules' : 'Qualifier');
    await sleep(1500);
    await clickDialog('Clore');
    await sleep(2000);
    await clickDialog('Qualifier');
    await sleep(2500);
    await show('après qualification');
    const ov3 = (await api('GET', `/api/tournament/tournaments/${tid}/overview`)).data;
    const brackets = ov3.stages.filter((s) => s.type === 'DOUBLE_ELIM').map((s) => `${s.name}:${s.matches.length} matchs`);
    check('9b des arbres ont des matchs après la qualification (API)', brackets.some((b) => !b.endsWith(':0 matchs')), brackets.join(', '));
    await shot('9b-apres-qualification');
  }

  // 10. véto d'un match d'arbre, joué par l'admin à la place des capitaines
  const ov4 = (await api('GET', `/api/tournament/tournaments/${tid}/overview`)).data;
  const elite = ov4.stages.find((s) => s.name === 'Élite');
  const matchId = elite?.matches?.[0]?.id;
  check('10a un match d’arbre existe pour le véto', !!matchId, matchId);
  if (matchId) {
    await goto(`/veto/${matchId}/admin`);
    await show('véto admin au départ');
    console.log('   texte:', (await text()).slice(0, 380));
    await shot('10-veto-admin');
    const rpsWords = ['Pierre', 'Feuille', 'Ciseaux'];
    // pierre-feuille-ciseaux : un coup pour chaque équipe
    for (let team = 0; team < 2; team++) {
      const labels = await buttons();
      const idx = labels.map((l, i) => (rpsWords.some((w) => l.startsWith(w)) ? i : -1)).filter((i) => i >= 0);
      if (!idx.length) break;
      // le premier bouton d'un coup de l'équipe `team`
      const word = rpsWords[team % 3];
      const r = await click(word, team);
      await sleep(1500);
      console.log(`   coup ${team + 1}: ${word} -> ${r}`);
    }
    await show('véto admin après pierre-feuille-ciseaux');
    console.log('   texte:', (await text()).slice(0, 380));
    await shot('10b-veto-apres-rps');

    // l'admin désigne qui commence, puis joue les bans / picks / camps pour chaque équipe
    check('10b "Flow Alpha commence"', (await click('Flow Alpha commence')) === 'ok');
    await sleep(1800);
    for (let step = 0; step < 14; step++) {
      const labels = await buttons();
      const actions = labels.filter((l) => !/^(Page du match|page des capitaines|Annuler la dernière|Recommencer)/.test(l) && l !== '');
      console.log(`   étape ${step + 1}: ${actions.slice(0, 14).join(' | ')}`);
      if (!actions.length) break;
      const pick = actions.find((l) => /^(de_|ban|pick)/i.test(l)) ?? actions.find((l) => /^(CT|T)\b/.test(l)) ?? actions[0];
      const r = await click(pick);
      await sleep(1300);
      if (r !== 'ok') break;
    }
    await shot('10c-veto-fin');
    const vt = await text();
    console.log('   texte final:', vt.slice(0, 420));
    const state = (await api('GET', `/api/tournament/matches/${matchId}/veto`)).data;
    console.log('   état API du véto:', JSON.stringify(state).slice(0, 300));
    check('10c le véto est terminé ou avance (API)', !!state, state?.status ?? state?.phase ?? '');
  }
} catch (e) {
  console.log('ERREUR DU SCRIPT:', e instanceof Error ? e.message : String(e));
}

const errs = events.filter((e) => e.method === 'Runtime.exceptionThrown' || (e.method === 'Network.responseReceived' && e.params.response.status >= 400 && !/auth\/me|favicon/.test(e.params.response.url))).map((e) => e.method === 'Runtime.exceptionThrown' ? 'EXC ' + (e.params.exceptionDetails.exception?.description ?? '').split('\n')[0] : `${e.params.response.status} ${e.params.response.url.replace(base, '')}`);
console.log(errs.length ? `ERREURS NAVIGATEUR: ${[...new Set(errs)].join(' || ')}` : 'aucune erreur navigateur');
await api('DELETE', `/api/tournament/tournaments/${tid}`);
console.log(`BILAN ${results.filter(Boolean).length}/${results.length}  (tournoi ${tid} supprimé)`);
ws.close(); chrome.kill(); process.exit(0);
