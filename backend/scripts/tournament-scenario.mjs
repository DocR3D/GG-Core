// Plays a fake tournament described by a JSON file, through the HTTP API (`make tournament F=fake-gglan-32.json`).
//
// File (test/fixtures/tournaments/*.json): teams (count or names), stages, qualification rules and a
// DETERMINISTIC result rule — the better seed usually wins, with upsets drawn from a seeded random generator,
// so the same file always produces the same tournament. Every result is an admin entry (no CS2 needed).
// Group stages and double-elimination stages are played to the end (the grand final winner). Prints the ASCII
// view at the end.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const API = process.env.API || 'http://localhost:8081';
const file = process.argv[2];
if (!file) {
  console.error('usage: node scripts/tournament-scenario.mjs <scenario.json>');
  process.exit(2);
}
const scenario = JSON.parse(readFileSync(resolve(file), 'utf8'));

// --- deterministic random (mulberry32) ---------------------------------------------------------------
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const results = scenario.results ?? {};
const random = rng(results.randomSeed ?? 1);
const pick = (list) => list[Math.floor(random() * list.length)];

const ADJ = ['Rapid', 'Silent', 'Golden', 'Crimson', 'Iron', 'Lucky', 'Frozen', 'Wild', 'Shadow', 'Electric', 'Brave', 'Cosmic', 'Savage', 'Mighty', 'Neon', 'Royal'];
const NOUN = ['Wolves', 'Falcons', 'Krakens', 'Otters', 'Vipers', 'Badgers', 'Comets', 'Pandas', 'Titans', 'Ravens', 'Lynx', 'Sharks', 'Goats', 'Hornets', 'Moose', 'Owls'];
const teamNames = Array.isArray(scenario.teams)
  ? scenario.teams
  : Array.from({ length: scenario.teams }, (_, i) => `${ADJ[i % ADJ.length]} ${NOUN[(i * 7 + Math.floor(i / ADJ.length)) % NOUN.length]}`);

async function api(method, path, body) {
  const res = await fetch(API + path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (res.status >= 300) throw new Error(`${method} ${path} -> ${res.status} ${text.slice(0, 300)}`);
  try { return JSON.parse(text); } catch { return text; }
}

const WINS = { BO1: 1, BO3: 2, BO5: 3 };

/** Enters every game of a series: the better seed wins each game unless an upset is drawn. */
async function playSeries(match, seedOf) {
  const homeBetter = seedOf(match.home) < seedOf(match.away);
  const needed = WINS[match.format] ?? 1;
  let home = match.advantageHome ?? 0; // grand final: the upper-bracket finalist starts one map up
  let away = 0;
  for (let order = 1; home < needed && away < needed; order++) {
    const upset = random() < (results.upsetRate ?? 0.25);
    const homeWins = homeBetter !== upset;
    const loserRounds = Math.floor(random() * 12); // 0..11
    await api('POST', `/api/tournament/matches/${match.id}/games/${order}/result`, {
      scoreHome: homeWins ? 13 : loserRounds,
      scoreAway: homeWins ? loserRounds : 13,
      mapName: pick(results.maps ?? ['de_mirage']),
      reportedBy: 'scenario',
    });
    homeWins ? home++ : away++;
  }
}

async function main() {
  console.log(`API ${API} — scénario ${file}`);
  // A run replaces the previous runs of the same scenario (and their teams) instead of piling up
  for (const old of await api('GET', '/api/tournament/tournaments')) {
    if (old.name.startsWith(`${scenario.name} `)) {
      const res = await api('DELETE', `/api/tournament/tournaments/${old.id}`);
      console.log(`ancienne exécution supprimée : ${res.deleted} (${res.teamsDeleted} équipes)`);
    }
  }
  const t = await api('POST', '/api/tournament/tournaments', {
    name: `${scenario.name} ${new Date().toISOString().slice(11, 19)}`,
    game: scenario.game,
  });
  const teams = await api('POST', '/api/tournament/teams', { names: teamNames });
  const seedOf = (name) => teamNames.indexOf(name) + 1;
  console.log(`tournoi ${t.id}, ${teams.length} équipes`);

  const stageId = {};
  for (const s of scenario.stages) {
    stageId[s.key] = (await api('POST', `/api/tournament/tournaments/${t.id}/stages`, { name: s.name, type: s.type, order: s.order })).id;
  }

  for (const s of [...scenario.stages].sort((a, b) => a.order - b.order)) {
    if (s.type === 'DOUBLE_ELIM') {
      const gen = await api('POST', `/api/tournament/stages/${stageId[s.key]}/bracket/generate`, s.formats ? { formats: s.formats } : {});
      // play every match whose two teams are known, until the grand final is over
      let played = 0;
      for (let guard = 0; guard < 200; guard++) {
        const overview = await api('GET', `/api/tournament/tournaments/${t.id}/overview`);
        const ready = overview.stages.find((x) => x.name === s.name).matches.filter((m) => m.home && m.away && m.status !== 'FINISHED');
        if (!ready.length) break;
        for (const m of ready) await playSeries(m, seedOf);
        played += ready.length;
      }
      console.log(`phase ${s.name} : arbre de ${gen.teams} équipes, ${played}/${gen.matches} matchs joués`);
      continue;
    }
    const isFirst = s.order === Math.min(...scenario.stages.map((x) => x.order));
    await api('POST', `/api/tournament/stages/${stageId[s.key]}/groups/generate`, {
      ...(isFirst ? { teamIds: teams.map((x) => x.id) } : {}),
      groupCount: s.groupCount,
      format: s.format,
    });
    const overview = await api('GET', `/api/tournament/tournaments/${t.id}/overview`);
    const stage = overview.stages.find((x) => x.name === s.name);
    const matches = stage.groups.flatMap((g) => g.matches);
    for (const m of matches) await playSeries(m, seedOf);
    console.log(`phase ${s.name} : ${stage.groups.length} poules, ${matches.length} matchs joués`);

    const q = scenario.qualify;
    if (q && q.from === s.key) {
      const standings = await api('GET', `/api/tournament/stages/${stageId[s.key]}/standings`);
      // Ties left unresolved: the admin keeps the displayed order (seed order) — the view flags them
      const manualOrder = Object.fromEntries(
        standings.groups.filter((g) => g.standings.some((r) => r.tied)).map((g) => [g.groupId, g.standings.map((r) => r.teamId)]),
      );
      const qualified = await api('POST', `/api/tournament/stages/${stageId[s.key]}/qualify`, {
        rules: q.rules.map((r) => ({ ranks: r.ranks, targetStageId: stageId[r.to] })),
        manualOrder,
      });
      for (const target of qualified) console.log(`qualifiés ${target.name} : ${target.seeds.length}`);
    }
  }

  console.log('\n' + (await api('GET', `/api/tournament/tournaments/${t.id}/ascii`)));
  console.log(`Vue : ${API}/api/tournament/tournaments/${t.id}/view`);
}

main().catch((e) => {
  console.error('✗', e.message);
  process.exit(1);
});
