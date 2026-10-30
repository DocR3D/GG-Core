// Plays a fake tournament described by a JSON file (`make tournament F=fake-gglan-32.json`), as fast as possible,
// through the Sandbox simulation (/sandbox/tournament — same engine as the page, deterministic results, fake
// players and stats), then prints the ASCII view. A run replaces the previous tournament of the same scenario.

import { basename } from 'node:path';

const API = process.env.API || 'http://localhost:8081';
const file = process.argv[2];
if (!file) {
  console.error('usage: node scripts/tournament-scenario.mjs <scenario.json>');
  process.exit(2);
}

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

async function main() {
  let run = await api('POST', '/sandbox/tournament/runs', { fixtureName: basename(file), delayMs: 0, parallel: 8, withStats: true });
  console.log(`simulation ${run.name} (${run.id})`);
  while (run.status === 'running' || run.status === 'paused') {
    await new Promise((r) => setTimeout(r, 500));
    run = await api('GET', `/sandbox/tournament/runs/${run.id}`);
  }
  if (run.status !== 'done') throw new Error(`simulation ${run.status}${run.error ? `: ${run.error}` : ''}`);
  console.log(`${run.seriesPlayed} séries, ${run.gamesPlayed} games\n`);
  console.log(await api('GET', `/view/tournaments/${run.tournamentId}.txt`));
  console.log(`Vue : ${API}/view/tournaments/${run.tournamentId}`);
}

main().catch((e) => {
  console.error('✗', e.message);
  process.exit(1);
});
