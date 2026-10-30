// Map veto to try by hand (`make veto-demo`, `F=BO1|BO3|BO5`, BO3 by default): tournament "Démo véto", one match
// between two teams, side mode "pick".
//
// The captain of "Démo Rouge" is the first SteamID of GG_ADMIN_STEAMIDS (you, signed in through Steam); the one
// of "Démo Noir" is the automatic opponent (`make veto-bot`, SteamID "veto-bot"). The veto starts at
// rock-paper-scissors. Without the bot, as an admin you can set who starts and play Démo Noir's turns.
// A run replaces the previous demo.

const API = process.env.API || 'http://localhost:8081';
const ADMIN_AUTH = process.env.GG_ADMIN_TOKEN ? { Authorization: `Bearer ${process.env.GG_ADMIN_TOKEN}` } : {};
const ME = (process.env.GG_ADMIN_STEAMIDS ?? '').split(',').map((s) => s.trim()).find(Boolean);
const NAME = 'Démo véto';
const FORMAT = process.env.VETO_FORMAT || 'BO3';
const BOT_STEAM_ID = 'veto-bot'; // scripts/veto-bot.mjs
const POOL = ['de_ancient', 'de_anubis', 'de_dust2', 'de_inferno', 'de_mirage', 'de_nuke', 'de_train'];

async function must(method, path, body) {
  const res = await fetch(API + path, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...ADMIN_AUTH },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (res.status >= 300) throw new Error(`${method} ${path} -> ${res.status} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

async function main() {
  if (!['BO1', 'BO3', 'BO5'].includes(FORMAT)) throw new Error(`F=${FORMAT}: BO1 | BO3 | BO5`);
  for (const old of await must('GET', '/api/tournament/tournaments')) {
    if (old.name === NAME) await must('DELETE', `/api/tournament/tournaments/${old.id}`);
  }
  const t = await must('POST', '/api/tournament/tournaments', { name: NAME });
  const [rouge, noir] = await must('POST', '/api/tournament/teams', { names: ['Démo Rouge', 'Démo Noir'] });
  const stage = await must('POST', `/api/tournament/tournaments/${t.id}/stages`, { name: 'Poules', type: 'ROUND_ROBIN', order: 1 });
  await must('POST', `/api/tournament/stages/${stage.id}/groups/generate`, { teamIds: [rouge.id, noir.id], groupCount: 1, format: FORMAT });
  await must('PUT', `/api/tournament/tournaments/${t.id}/veto`, { mapPool: POOL, sideMode: 'pick' });
  await must('POST', `/api/tournament/tournaments/${t.id}/teams/${rouge.id}/players`, {
    players: [{ username: ME ? 'Toi (capitaine)' : 'Capitaine Rouge', ...(ME ? { steamId: ME } : {}), captain: true }],
  });
  await must('POST', `/api/tournament/tournaments/${t.id}/teams/${noir.id}/players`, {
    players: [{ username: 'Capitaine Noir (bot)', steamId: BOT_STEAM_ID, captain: true }],
  });

  const overview = await must('GET', `/api/tournament/tournaments/${t.id}/overview`);
  const match = overview.stages[0].groups[0].matches[0];

  console.log(ME ? `Capitaine de Démo Rouge : SteamID ${ME} (connecte-toi avec Steam).` : 'GG_ADMIN_STEAMIDS vide : joue en admin.');
  console.log(`Véto ${FORMAT} : ${API}/veto/${match.id}`);
  console.log('Adversaire automatique (capitaine de Démo Noir) : make veto-bot');
}

main().catch((e) => {
  console.error('✗', e.message);
  process.exit(1);
});
