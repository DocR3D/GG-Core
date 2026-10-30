// End-to-end tournament scenario, through the HTTP API only (`make e2e-tournament`).
//
// A 4-team group, two matches played AUTOMATICALLY (a game launched on the server, then a real GGLan log replayed
// by the Sandbox through the agent → CS2 engine → game result → series → standings) and four entered by the
// admin, then qualification (ranks 1-2 → Elite, 3-4 → Amateur). The first automatic match gets its map from a
// veto played by the admin (the second one is launched with an explicit map, without veto). Also checks the
// server guards (disabled / busy). Prints the ASCII view at the end so a human can look for anything odd.
// Exit code 1 on any failure.
//
// Requires the dev stack (`make up`; the Go agent is used for the replays). Uses server E2E_SERVER (srv-a):
// it is released first, its CS2 (if running) receives the usual match commands.

import { io } from 'socket.io-client';

const API = process.env.API || 'http://localhost:8081';
// admin token (set in the backend container by the dev stack): the scenario creates and changes data
const ADMIN_AUTH = process.env.GG_ADMIN_TOKEN ? { Authorization: `Bearer ${process.env.GG_ADMIN_TOKEN}` } : {};
const SERVER = process.env.E2E_SERVER || 'srv-a';
const AUTO_FIXTURES = ['gglan19_mirage_13-11_anonymized.log', 'gglan19_overpass_13-5_anonymized.log'];
const MAP_POOL = ['de_ancient', 'de_anubis', 'de_dust2', 'de_inferno', 'de_mirage', 'de_nuke', 'de_train'];

let failures = 0;
const ok = (cond, label) => {
  console.log(`${cond ? '  ✓' : '  ✗'} ${label}`);
  if (!cond) failures++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function req(method, path, body) {
  const res = await fetch(API + path, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...ADMIN_AUTH },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, json };
}
async function must(method, path, body) {
  const r = await req(method, path, body);
  if (r.status >= 300) throw new Error(`${method} ${path} -> ${r.status} ${JSON.stringify(r.json).slice(0, 300)}`);
  return r.json;
}
const overview = (id) => must('GET', `/api/tournament/tournaments/${id}/overview`);

async function main() {
  console.log(`API ${API}, server ${SERVER}`);

  // A run replaces the previous E2E runs (and their teams) instead of piling up
  for (const old of await must('GET', '/api/tournament/tournaments')) {
    if (old.name.startsWith('E2E ')) await must('DELETE', `/api/tournament/tournaments/${old.id}`);
  }

  console.log('\n1. Tournament, teams, stages, group');
  const t = await must('POST', '/api/tournament/tournaments', { name: `E2E ${new Date().toISOString().slice(0, 19)}` });
  const teams = await must('POST', '/api/tournament/teams', { names: ['E2E Alpha', 'E2E Bravo', 'E2E Charlie', 'E2E Delta'] });
  const groups = await must('POST', `/api/tournament/tournaments/${t.id}/stages`, { name: 'Poules', type: 'ROUND_ROBIN', order: 1 });
  const elite = await must('POST', `/api/tournament/tournaments/${t.id}/stages`, { name: 'Élite', type: 'DOUBLE_ELIM', order: 2 });
  const amateur = await must('POST', `/api/tournament/tournaments/${t.id}/stages`, { name: 'Amateur', type: 'DOUBLE_ELIM', order: 3 });
  const gen = await must('POST', `/api/tournament/stages/${groups.id}/groups/generate`, { teamIds: teams.map((x) => x.id), groupCount: 1 });
  ok(gen.groups.length === 1 && gen.groups[0].matchesTotal === 6, '1 group of 4, 6 matches');

  console.log(`\n2. Server ${SERVER}`);
  const servers = await must('GET', '/api/tournament/servers');
  if (!servers.some((s) => s.name === SERVER)) await must('POST', '/api/tournament/servers', { name: SERVER, ip: 'cs2' });
  await must('POST', `/api/tournament/servers/${SERVER}/enable`);
  const released = await must('POST', `/api/tournament/servers/${SERVER}/release`);
  if (released.released) console.log(`  (released from ${released.released.matchId}, ${released.released.phase})`);

  let ov = await overview(t.id);
  const matches = ov.stages[0].groups[0].matches;

  await must('POST', `/api/tournament/servers/${SERVER}/disable`);
  const refused = await req('POST', `/api/tournament/matches/${matches[0].id}/games/1/launch`, { server: SERVER, mapName: 'de_mirage' });
  ok(refused.status === 409, `launch on a disabled server refused (${refused.status})`);
  await must('POST', `/api/tournament/servers/${SERVER}/enable`);

  console.log('\n3. Veto of the first match (BO1, knife): RPS played elsewhere, the admin bans for both teams');
  await must('PUT', `/api/tournament/tournaments/${t.id}/veto`, { mapPool: MAP_POOL, sideMode: 'knife' });
  const vetoMatch = matches[0];
  // a spectator follows the veto live (WebSocket room of the match)
  const pushed = [];
  const socket = io(API, { query: { matchId: vetoMatch.id }, transports: ['websocket'] });
  socket.on('veto:updated', (e) => pushed.push(e));
  await new Promise((resolve, reject) => {
    socket.on('connect', resolve);
    socket.on('connect_error', reject);
  });
  await must('POST', `/veto/${vetoMatch.id}/start`, { teamId: teams.find((x) => x.name === vetoMatch.home).id });
  for (const map of MAP_POOL.filter((x) => x !== 'de_mirage')) {
    if (map === 'de_ancient') {
      // the page's form: urlencoded body, answered by a redirect to the page
      const form = await fetch(`${API}/veto/${vetoMatch.id}/step`, {
        method: 'POST',
        redirect: 'manual',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...ADMIN_AUTH },
        body: new URLSearchParams({ _form: '1', map }),
      });
      ok(form.status === 303 && form.headers.get('location') === `/veto/${vetoMatch.id}`, `veto form step redirects to the page (${form.status})`);
    } else {
      await must('POST', `/veto/${vetoMatch.id}/step`, { map });
    }
  }
  for (let k = 0; k < 20 && pushed.length < 7; k++) await sleep(100);
  socket.close();
  const last = pushed[pushed.length - 1];
  ok(pushed.length === 7 && last?.payload?.phase === 'done' && last.seq === 7, `veto pushed live: ${pushed.length} veto:updated (start + 6 bans), last seq ${last?.seq}`);
  const board = await must('GET', `/api/tournament/tournaments/${t.id}/vetos`);
  ok(board.length === 6 && board.find((x) => x.matchId === vetoMatch.id)?.phase === 'done', 'admin overview: 6 matches, the vetoed one done');
  const vetoed = await must('GET', `/api/tournament/matches/${vetoMatch.id}/veto`);
  ok(vetoed.phase === 'done' && vetoed.maps.length === 1 && vetoed.maps[0].map === 'de_mirage', `veto done: decider ${vetoed.maps[0]?.map}`);
  const page = await fetch(`${API}/veto/${vetoMatch.id}`).then((r) => r.text());
  ok(page.includes('Maps du match') && page.includes('de_mirage'), 'veto page shows the maps of the match');

  console.log('\n4. Two matches played automatically (launch + real log replayed through the agent)');
  for (const [i, fixture] of AUTO_FIXTURES.entries()) {
    const m = matches[i];
    const map = fixture.split('_')[1];
    // first match: map from the veto (no mapName); second one: explicit map, no veto
    const launched = await must('POST', `/api/tournament/matches/${m.id}/games/1/launch`, i === 0 ? { server: SERVER } : { server: SERVER, mapName: `de_${map}` });
    if (i === 0) ok(launched.mapName === 'de_mirage' && launched.sides === 'knife', `launched on the veto map (${launched.mapName}, ${launched.sides})`);
    console.log(`  ${m.home} vs ${m.away}: game ${launched.gameId} on ${launched.server} (${launched.mapName})`);
    if (i === 0) {
      const busy = await req('POST', `/api/tournament/matches/${matches[2].id}/games/1/launch`, { server: SERVER, mapName: 'de_nuke' });
      ok(busy.status === 409, `second launch on the busy server refused (${busy.status})`);
    }
    const replay = await must('POST', '/sandbox/replay/raw-log', {
      fixtureName: fixture, matchId: launched.engineMatchId, serverId: SERVER, speed: 'instant',
    });
    console.log(`  replay ${fixture}: ${replay.linesSent}/${replay.totalLines} lines (${replay.mode})`);
    let done;
    for (let k = 0; k < 60 && !done; k++) {
      await sleep(1000);
      ov = await overview(t.id);
      done = ov.stages[0].groups[0].matches.find((x) => x.id === m.id && x.status === 'FINISHED');
    }
    ok(!!done, `series finished from the CS2 engine result`);
    const game = done?.games?.[0];
    ok(game?.source === 'AUTOMATIC' && game.server === SERVER, `game result AUTOMATIC on ${SERVER} (${game?.scoreHome}-${game?.scoreAway})`);
    ok(game && Math.max(game.scoreHome, game.scoreAway) === 13, 'game score taken from the real log (13 rounds for the winner)');
  }

  console.log('\n5. Four matches entered by the admin');
  for (const m of matches.slice(2)) {
    await must('POST', `/api/tournament/matches/${m.id}/games/1/result`, { scoreHome: 13, scoreAway: 8, mapName: 'de_nuke', reportedBy: 'e2e' });
  }

  console.log('\n6. Standings and qualification');
  const st = await must('GET', `/api/tournament/stages/${groups.id}/standings`);
  const rows = st.groups[0].standings;
  ok(rows.every((r) => r.played === 3), 'every team played 3 matches');
  ok(rows.reduce((s, r) => s + r.points, 0) === 18, 'total points = 18 (6 matches, no draw)');
  const tied = rows.filter((r) => r.tied);
  const manualOrder = tied.length ? { [st.groups[0].groupId]: rows.map((r) => r.teamId) } : undefined;
  if (tied.length) console.log(`  tie to settle (${tied.map((r) => r.teamName).join(', ')}): admin keeps the displayed order`);
  const q = await must('POST', `/api/tournament/stages/${groups.id}/qualify`, {
    rules: [{ ranks: [1, 2], targetStageId: elite.id }, { ranks: [3, 4], targetStageId: amateur.id }],
    manualOrder,
  });
  ok(q[0].seeds.length === 2 && q[1].seeds.length === 2, 'Elite 2 teams, Amateur 2 teams');
  ok(q[0].seeds[0] === rows[0].teamId, 'group winner is Elite seed 1');

  console.log('\n7. ASCII view (look for anything odd)\n');
  const ascii = await fetch(`${API}/view/tournaments/${t.id}.txt`).then((r) => r.text());
  console.log(ascii);
  console.log(`View: ${API}/view/tournaments/${t.id}`);

  console.log(failures ? `\n✗ ${failures} check(s) failed` : '\n✓ all checks passed');
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error('\n✗ scenario aborted:', e.message);
  process.exit(1);
});
