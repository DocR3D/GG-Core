// Super Golden Test CS2 avec plugin QA Oracle (comparaison Mémoire CS2 <-> Snapshot GG-Core).
// Codes de sortie :
//   0  = succès
//   77 = plugin Metamod / CounterStrikeSharp absent ou cassé (ex: après une MAJ Valve) -> allow_failure dans la CI
//   1  = vraie régression / divergence d'état entre CS2 et GG-Core

const ORACLE_URL = process.env.CS2_QA_ORACLE_URL ?? 'http://cs2-qa:27080';
const BACKEND_URL = process.env.GG_BACKEND_URL ?? 'http://127.0.0.1:8081';
const ADMIN_TOKEN = process.env.GG_ADMIN_TOKEN ?? '';
const SERVER_NAME = process.env.E2E_SERVER ?? 'srv-a';

const AUTH_HEADERS = ADMIN_TOKEN ? { Authorization: `Bearer ${ADMIN_TOKEN}` } : {};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(method, path, body) {
  const res = await fetch(`${BACKEND_URL}${path}`, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...AUTH_HEADERS },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  if (res.status >= 300) {
    throw new Error(`${method} ${path} -> ${res.status} ${JSON.stringify(json).slice(0, 300)}`);
  }
  return json;
}

async function oracleGet(path) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(`${ORACLE_URL}${path}`, { signal: controller.signal });
    if (!res.ok) throw new Error(`Oracle GET ${path} -> HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function oracleExec(command) {
  const res = await fetch(`${ORACLE_URL}/qa/exec`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ command }),
  });
  if (!res.ok) throw new Error(`Oracle exec "${command}" -> HTTP ${res.status}`);
  return res.json();
}

async function waitUntil(fn, { timeoutMs = 20000, intervalMs = 500, label = 'condition' } = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastErr;
  while (Date.now() < deadline) {
    try {
      const val = await fn();
      if (val) return val;
    } catch (err) {
      lastErr = err;
    }
    await sleep(intervalMs);
  }
  throw new Error(`Timeout (${timeoutMs}ms) en attendant : ${label}${lastErr ? ` (${lastErr.message})` : ''}`);
}

async function checkOracleHealth() {
  try {
    const body = await oracleGet('/qa/health');
    return { ok: true, body };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
}

async function main() {
  console.log('🔍 1. Vérification du backend GG-Core...');
  await api('GET', '/api/health');
  console.log('✅ Backend GG-Core prêt.');

  console.log(`🔍 2. Vérification du plugin QA Oracle (${ORACLE_URL}/qa/health)...`);
  const oracle = await checkOracleHealth();
  if (!oracle.ok) {
    console.warn(`⚠️  Plugin QA Oracle injoignable (${oracle.reason}).`);
    console.warn('⚠️  Cause probable : Metamod / CounterStrikeSharp non monté ou cassé par une MAJ CS2 Valve.');
    console.warn('⏭️  Sortie avec code 77 (allow_failure côté CI/CD).');
    process.exit(77);
  }
  console.log('✅ Plugin QA Oracle actif :', JSON.stringify(oracle.body));

  if (!ADMIN_TOKEN) {
    console.warn('ℹ️  GG_ADMIN_TOKEN absent : arrêt après vérification Oracle (mode smoke).');
    process.exit(0);
  }

  let tournamentId = null;
  try {
    console.log('\n🏟️  3. Préparation du tournoi QA Golden & lancement sur', SERVER_NAME);
    for (const old of await api('GET', '/api/tournament/tournaments')) {
      if (old.name?.startsWith('QA Golden ')) {
        await api('DELETE', `/api/tournament/tournaments/${old.id}`);
      }
    }

    const t = await api('POST', '/api/tournament/tournaments', {
      name: `QA Golden ${new Date().toISOString().slice(0, 19)}`,
    });
    tournamentId = t.id;

    const teams = await api('POST', '/api/tournament/teams', { names: ['QA Alpha', 'QA Bravo'] });
    await api('PUT', `/api/tournament/tournaments/${t.id}/veto`, {
      mapPool: ['de_ancient', 'de_anubis', 'de_dust2', 'de_inferno', 'de_mirage', 'de_nuke', 'de_train'],
      sideMode: 'pick',
    });
    const stage = await api('POST', `/api/tournament/tournaments/${t.id}/stages`, {
      name: 'QA Poule',
      type: 'ROUND_ROBIN',
      order: 1,
    });
    await api('POST', `/api/tournament/stages/${stage.id}/groups/generate`, {
      teamIds: teams.map((x) => x.id),
      groupCount: 1,
    });

    const ov = await api('GET', `/api/tournament/tournaments/${t.id}/overview`);
    const match = ov.stages[0].groups[0].matches[0];

    const servers = await api('GET', '/api/tournament/servers');
    if (!servers.some((s) => s.name === SERVER_NAME)) {
      await api('POST', '/api/tournament/servers', { name: SERVER_NAME, ip: 'cs2-qa' });
    }
    await api('POST', `/api/tournament/servers/${SERVER_NAME}/enable`);
    await api('POST', `/api/tournament/servers/${SERVER_NAME}/release`);

    const launched = await api('POST', `/api/tournament/matches/${match.id}/games/1/launch`, {
      server: SERVER_NAME,
      mapName: 'de_inferno',
      settings: { knifeEnabled: false },
    });
    const matchId = launched.engineMatchId;
    console.log(`✅ Match lancé : engineMatchId=${matchId} (map=${launched.mapName})`);

    // Forcer le passage en live_main côté GG-Core (envoie live.cfg + mp_restartgame 1)
    console.log('⚡ 4. Passage en live_main (force-start)...');
    await api('POST', `/api/matches/${matchId}/force-start`);

    await waitUntil(async () => {
      const state = await oracleGet('/qa/state');
      const snap = await api('GET', `/api/matches/${matchId}/snapshot`);
      return state.gameRules && state.gameRules.warmupPeriod === false && snap.phase === 'live_main';
    }, { timeoutMs: 25000, intervalMs: 500, label: 'fin du warmup côté CS2 et phase live_main côté GG-Core' });
    console.log('✅ Serveur CS2 et GG-Core synchronisés en live_main !');

    // Ajouter 2 bots (1 CT + 1 T) APRÈS l'exécution de live.cfg (qui contient bot_kick)
    await sleep(1500);
    await oracleExec('mp_autoteambalance 0; mp_limitteams 0; bot_quota_mode normal; bot_kick; bot_add_ct; bot_add_t');
    await waitUntil(async () => {
      const state = await oracleGet('/qa/state');
      const hasCt = state.players.some((p) => p.team === 'CT');
      const hasT = state.players.some((p) => p.team === 'T');
      return hasCt && hasT;
    }, { timeoutMs: 10000, intervalMs: 400, label: 'présence des bots CT et T' });
    console.log('✅ Bots CT et T prêts dans la partie.');

    // Scénario de 3 rounds déterministes : CT gagne, T gagne, CT gagne
    const expectedWinners = ['CT', 'T', 'CT'];
    for (let i = 0; i < expectedWinners.length; i++) {
      const winner = expectedWinners[i];
      const loserCmd = winner === 'CT' ? 'bot_kill t' : 'bot_kill ct';

      // Attendre la fin du freeze time pour que le round soit actif
      await waitUntil(async () => {
        const s = await oracleGet('/qa/state');
        return s.gameRules && s.gameRules.freezePeriod === false;
      }, { timeoutMs: 15000, intervalMs: 400, label: `fin de freeze time (round ${i + 1})` });

      const before = await oracleGet('/qa/state');
      const roundsBefore = before.gameRules.totalRoundsPlayed;

      console.log(`\n🎮 Round ${i + 1} : victoire simulée pour ${winner} (${loserCmd})...`);
      await oracleExec(loserCmd);

      const afterOracle = await waitUntil(async () => {
        const s = await oracleGet('/qa/state');
        return s.gameRules && s.gameRules.totalRoundsPlayed > roundsBefore ? s : null;
      }, { timeoutMs: 15000, intervalMs: 400, label: `incrément totalRoundsPlayed côté CS2 (round ${i + 1})` });

      // Comparaison stricte Mémoire CS2 (Oracle) <-> Snapshot GG-Core (Redis/HTTP)
      const matchedSnap = await waitUntil(async () => {
        const snap = await api('GET', `/api/matches/${matchId}/snapshot`);
        if (
          snap.score?.ct === afterOracle.teams.ct.score &&
          snap.score?.t === afterOracle.teams.t.score
        ) {
          return snap;
        }
        return null;
      }, { timeoutMs: 8000, intervalMs: 400, label: `synchronisation score GG-Core (${afterOracle.teams.ct.score}-${afterOracle.teams.t.score})` });

      console.log(
        `  ✅ Accord parfait Round ${i + 1} : CS2 Oracle [${afterOracle.teams.ct.score}-${afterOracle.teams.t.score}] == GG-Core [${matchedSnap.score.ct}-${matchedSnap.score.t}]`
      );
    }

    console.log('\n🎉 Super Golden Test CS2 QA réussi : aucune perte d\'événement entre CS2, Go Agent, Redis et NestJS !');
  } finally {
    console.log('\n🧹 Nettoyage QA...');
    await api('POST', `/api/tournament/servers/${SERVER_NAME}/release`).catch(() => {});
    if (tournamentId) {
      await api('DELETE', `/api/tournament/tournaments/${tournamentId}`).catch(() => {});
    }
  }
}

main().catch((err) => {
  console.error('❌ Échec du Super Golden Test CS2 QA :', err);
  process.exit(1);
});
