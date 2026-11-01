// Automatic opponent for the demo veto (`make veto-bot`, after `make veto-demo`): plays the captain of
// "Démo Noir" through the real captain routes, with a PLAYER session (no admin right) signed with the dev
// JWT_SECRET. It follows the veto on the WebSocket like a spectator, prints every live update, and plays as
// soon as it is its turn: random rock-paper-scissors, random start decision, random ban / pick / side.
// You play "Démo Rouge" on the veto page meanwhile. Stops when the veto is over (Ctrl+C to stop earlier).

import jwt from 'jsonwebtoken';
import { io } from 'socket.io-client';

const API = process.env.API || 'http://localhost:8081';
const DEMO = 'Démo véto';
// captain of "Démo Noir" in the demo (scripts/veto-demo.mjs); VETO_BOT_STEAM_ID=<id> plays another captain
const BOT_STEAM_ID = process.env.VETO_BOT_STEAM_ID || 'veto-bot';
const THINK_MS = Number(process.env.BOT_THINK_MS ?? 1500); // looks human, and leaves time to watch the page

if (!process.env.JWT_SECRET) {
  console.error('✗ JWT_SECRET missing (run through make veto-bot)');
  process.exit(1);
}
const session = jwt.sign({ sub: BOT_STEAM_ID, role: 'player', name: 'Capitaine Noir (bot)', via: 'steam' }, process.env.JWT_SECRET, { expiresIn: '2h' });
const COOKIE = { Cookie: `gg_session=${encodeURIComponent(session)}` };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pick = (list) => list[Math.floor(Math.random() * list.length)];
const RPS_FR = { rock: 'pierre', paper: 'feuille', scissors: 'ciseaux' };
const time = () => new Date().toLocaleTimeString('fr-FR');

async function call(method, path, body) {
  const res = await fetch(API + path, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...COOKIE },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (res.status >= 300) throw new Error(`${method} ${path} -> ${res.status} ${json?.message ?? text}`);
  return json;
}

async function findDemoMatch() {
  const demo = (await call('GET', '/api/tournament/tournaments')).find((t) => t.name === DEMO);
  if (!demo) throw new Error(`no "${DEMO}" tournament: run make veto-demo first`);
  const overview = await call('GET', `/api/tournament/tournaments/${demo.id}/overview`);
  return overview.stages[0].groups[0].matches[0].id;
}

const teamName = (v, id) => (id === v.teams.home.id ? v.teams.home.name : id === v.teams.away.id ? v.teams.away.name : '?');

function describe(v) {
  const waiting = v.waitingFor.map((id) => teamName(v, id)).join(' + ') || 'personne';
  const last = v.steps[v.steps.length - 1];
  const lastStep = last ? ` · dernier : ${teamName(v, last.teamId)} ${last.kind} ${last.map}${last.side ? ` ${last.side}` : ''}` : '';
  return `${v.phase}${lastStep} · on attend : ${waiting}`;
}

async function main() {
  const matchId = await findDemoMatch();
  const me = await call('GET', `/api/tournament/matches/${matchId}/veto`);
  if (!me.viewer.teamId) throw new Error('the bot is not a captain of this match: run make veto-demo again');
  console.log(`Bot = capitaine de ${teamName(me, me.viewer.teamId)}. Véto : ${API}/veto/${matchId}`);

  let busy = false;
  let again = false;
  const play = async () => {
    if (busy) return void (again = true);
    busy = true;
    try {
      const v = await call('GET', `/api/tournament/matches/${matchId}/veto`);
      if (!v.viewer.canAct) return;
      await sleep(THINK_MS);
      if (v.phase === 'rps') {
        const choice = pick(['rock', 'paper', 'scissors']);
        await call('POST', `/veto/${matchId}/rps`, { choice });
        console.log(`${time()}  bot  → ${RPS_FR[choice]}`);
      } else if (v.phase === 'rps_decision') {
        const first = Math.random() < 0.5;
        await call('POST', `/veto/${matchId}/start`, { first });
        console.log(`${time()}  bot  → ${first ? 'commence le véto' : 'laisse commencer l’adversaire'}`);
      } else if (v.phase === 'veto' && v.next) {
        const body = v.next.kind === 'side' ? { side: pick(['CT', 'T']) } : { map: pick(v.remaining) };
        await call('POST', `/veto/${matchId}/step`, body);
        console.log(`${time()}  bot  → ${v.next.kind} ${body.map ?? `${v.next.map} ${body.side}`}`);
      }
    } catch (e) {
      console.log(`${time()}  bot  ✗ ${e.message}`); // e.g. the captain acted at the same time: the next update retries
    } finally {
      busy = false;
      if (again) {
        again = false;
        play();
      }
    }
  };

  const socket = io(API, { query: { matchId }, transports: ['websocket'] });
  socket.on('connect', () => console.log(`${time()}  ws   connecté à la room du match, en attente…`));
  socket.on('veto:updated', (e) => {
    console.log(`${time()}  ws   #${e.seq} ${describe(e.payload)}`);
    if (e.payload.phase === 'done') {
      for (const m of e.payload.maps) {
        const side = m.side ? `${teamName(e.payload, m.side.teamId)} en ${m.side.side}` : 'knife';
        console.log(`        game ${m.order} : ${m.map} (${m.pickedByTeamId ? `pick ${teamName(e.payload, m.pickedByTeamId)}` : 'decider'}, ${side})`);
      }
      console.log('Véto terminé.');
      socket.close();
      process.exit(0);
    }
    play();
  });
  play(); // maybe it is already its turn
}

main().catch((e) => {
  console.error('✗', e.message);
  process.exit(1);
});
