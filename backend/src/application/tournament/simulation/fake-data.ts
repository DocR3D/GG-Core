// src/application/tournament/simulation/fake-data.ts
// Deterministic fake data for simulated tournaments (pure functions): seeded random generator, team / player
// names, and CS2-like player stats consistent with a game score. Invented data only.

export type Random = () => number;

/** mulberry32: small, fast, deterministic — the same seed always gives the same tournament. */
export function seededRandom(seed: number): Random {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ADJ = ['Rapid', 'Silent', 'Golden', 'Crimson', 'Iron', 'Lucky', 'Frozen', 'Wild', 'Shadow', 'Electric', 'Brave', 'Cosmic', 'Savage', 'Mighty', 'Neon', 'Royal'];
const NOUN = ['Wolves', 'Falcons', 'Krakens', 'Otters', 'Vipers', 'Badgers', 'Comets', 'Pandas', 'Titans', 'Ravens', 'Lynx', 'Sharks', 'Goats', 'Hornets', 'Moose', 'Owls'];
const NICK_A = ['zap', 'kilo', 'nova', 'rusk', 'pix', 'oslo', 'vex', 'dune', 'mika', 'jolt', 'frost', 'yuki', 'brix', 'lumo', 'tank', 'echo'];
const NICK_B = ['', 'x', '42', 'dz', 'ou', 'ix', '07', 'ka', 'mo', 'ya'];

/** Team names: "Rapid Wolves", "Silent Falcons"… (unique for up to 256 teams). */
export function fakeTeamNames(count: number): string[] {
  return Array.from({ length: count }, (_, i) => `${ADJ[i % ADJ.length]} ${NOUN[(i * 7 + Math.floor(i / ADJ.length)) % NOUN.length]}`);
}

/** Player nicknames of a team (e.g. 5 starters), deterministic per team index. */
export function fakePlayerNames(teamIndex: number, count: number): string[] {
  return Array.from({ length: count }, (_, p) => {
    const k = teamIndex * count + p;
    return `${NICK_A[k % NICK_A.length]}${NICK_B[(k * 3 + teamIndex) % NICK_B.length]}`;
  });
}

export interface FakePlayerLine {
  kills: number;
  deaths: number;
  assists: number;
  headshots: number;
  mvps: number;
  damageDealt: number;
  adr: number;
}

function split(total: number, parts: number, rnd: Random): number[] {
  const weights = Array.from({ length: parts }, () => 0.5 + rnd());
  const sum = weights.reduce((a, b) => a + b, 0);
  const raw = weights.map((w) => Math.floor((w / sum) * total));
  let rest = total - raw.reduce((a, b) => a + b, 0);
  for (let i = 0; rest > 0; i = (i + 1) % parts, rest--) raw[i]++;
  return raw;
}

/**
 * Stats of the players of both teams for one game, consistent with its score: a lost round costs the loser
 * most of its lineup, the winner fewer deaths; each team's kills are the other team's deaths.
 */
export function fakeGameStats(
  roundsHome: number,
  roundsAway: number,
  playersPerTeam: number,
  rnd: Random,
): { home: FakePlayerLine[]; away: FakePlayerLine[] } {
  const rounds = Math.max(1, roundsHome + roundsAway);
  const deathsInLostRound = () => 4 + (rnd() < 0.6 ? 1 : 0);
  const deathsInWonRound = () => Math.floor(rnd() * 3.2);
  let homeDeaths = 0;
  let awayDeaths = 0;
  for (let r = 0; r < roundsHome; r++) {
    awayDeaths += deathsInLostRound();
    homeDeaths += deathsInWonRound();
  }
  for (let r = 0; r < roundsAway; r++) {
    homeDeaths += deathsInLostRound();
    awayDeaths += deathsInWonRound();
  }
  const team = (kills: number, deaths: number, roundsWon: number): FakePlayerLine[] => {
    const k = split(kills, playersPerTeam, rnd);
    const d = split(deaths, playersPerTeam, rnd);
    const a = split(Math.round(kills * 0.35), playersPerTeam, rnd);
    const mvp = split(roundsWon, playersPerTeam, rnd);
    return k.map((kills, i) => {
      const damageDealt = Math.round(kills * (85 + rnd() * 25) + a[i] * (30 + rnd() * 20));
      return {
        kills,
        deaths: d[i],
        assists: a[i],
        headshots: Math.round(kills * (0.3 + rnd() * 0.3)),
        mvps: mvp[i],
        damageDealt,
        adr: Math.round((damageDealt / rounds) * 10) / 10,
      };
    });
  };
  return {
    home: team(awayDeaths, homeDeaths, roundsHome),
    away: team(homeDeaths, awayDeaths, roundsAway),
  };
}

/** FNV-1a hash of some values: a stable seed for one series, whatever the order in which series are played. */
export function hashSeed(...parts: (string | number)[]): number {
  let h = 0x811c9dc5;
  for (const ch of parts.join('|')) {
    h ^= ch.codePointAt(0)!;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}
