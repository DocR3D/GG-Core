// src/domain/tournament/round-robin.ts
// Pure group-stage algorithms (no database): snake distribution, round-robin schedule, standings.
// Game-agnostic: a "game score" is whatever the game scores (CS2 rounds, …).

/**
 * Distributes seeded teams into `groupCount` groups in a snake (1→A, 2→B, …, then back): every group gets a
 * balanced mix of strong and weak seeds. `teamIds` is in seed order (best first).
 */
export function snakeDistribute<T>(teamIds: T[], groupCount: number): T[][] {
  if (!Number.isInteger(groupCount) || groupCount < 1) throw new Error('groupCount must be >= 1');
  const groups: T[][] = Array.from({ length: groupCount }, () => []);
  teamIds.forEach((id, i) => {
    const row = Math.floor(i / groupCount);
    const col = i % groupCount;
    groups[row % 2 === 0 ? col : groupCount - 1 - col].push(id);
  });
  return groups;
}

export interface Pairing<T> {
  round: number; // 1-based
  home: T;
  away: T;
}

/**
 * Everyone plays everyone once (circle method). With an odd number of teams one team rests each round.
 * Home / away alternate so that nobody is always "home".
 */
export function roundRobinPairings<T>(teamIds: T[]): Pairing<T>[] {
  const BYE = Symbol('bye');
  const slots: (T | typeof BYE)[] = [...teamIds];
  if (slots.length % 2 === 1) slots.push(BYE);
  const n = slots.length;
  const pairings: Pairing<T>[] = [];
  for (let r = 0; r < n - 1; r++) {
    for (let i = 0; i < n / 2; i++) {
      const a = slots[i];
      const b = slots[n - 1 - i];
      if (a === BYE || b === BYE) continue;
      const swap = (r + i) % 2 === 1;
      pairings.push({ round: r + 1, home: (swap ? b : a) as T, away: (swap ? a : b) as T });
    }
    // rotate every slot but the first
    slots.splice(1, 0, slots.pop()!);
  }
  return pairings;
}

export interface FinishedSeries<T> {
  home: T;
  away: T;
  /** null = draw */
  winner: T | null;
  /** game scores of the series (e.g. CS2 rounds), used for the score difference tiebreaker */
  games: { home: number; away: number }[];
}

export interface StandingRow<T> {
  teamId: T;
  rank: number;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  /** 3 per win, 1 per draw */
  points: number;
  scoreFor: number;
  scoreAgainst: number;
  scoreDiff: number;
  /** still tied with another team after every tiebreaker: the admin decides (order falls back to seed) */
  tied: boolean;
}

/**
 * Group standings. Tiebreakers, in order: points, head-to-head points among the tied teams, score
 * difference, score for. Teams still tied are flagged `tied` and ordered by seed (their order in `teamIds`).
 */
export function computeStandings<T>(teamIds: T[], results: FinishedSeries<T>[]): StandingRow<T>[] {
  const rows = new Map<T, StandingRow<T>>(
    teamIds.map((id) => [
      id,
      { teamId: id, rank: 0, played: 0, wins: 0, draws: 0, losses: 0, points: 0, scoreFor: 0, scoreAgainst: 0, scoreDiff: 0, tied: false },
    ]),
  );
  for (const r of results) {
    const home = rows.get(r.home);
    const away = rows.get(r.away);
    if (!home || !away) continue;
    home.played++;
    away.played++;
    if (r.winner === null) {
      home.draws++;
      away.draws++;
    } else if (r.winner === r.home) {
      home.wins++;
      away.losses++;
    } else {
      away.wins++;
      home.losses++;
    }
    for (const g of r.games) {
      home.scoreFor += g.home;
      home.scoreAgainst += g.away;
      away.scoreFor += g.away;
      away.scoreAgainst += g.home;
    }
  }
  for (const row of rows.values()) {
    row.points = row.wins * 3 + row.draws;
    row.scoreDiff = row.scoreFor - row.scoreAgainst;
  }

  const seedIndex = new Map(teamIds.map((id, i) => [id, i]));
  const headToHead = (tiedIds: Set<T>, id: T) =>
    results
      .filter((r) => tiedIds.has(r.home) && tiedIds.has(r.away) && (r.home === id || r.away === id))
      .reduce((pts, r) => pts + (r.winner === null ? 1 : r.winner === id ? 3 : 0), 0);

  // Sort by points, then resolve each block of equal points with the tiebreakers
  const byPoints = [...rows.values()].sort((a, b) => b.points - a.points);
  const ordered: StandingRow<T>[] = [];
  for (let i = 0; i < byPoints.length; ) {
    let j = i;
    while (j < byPoints.length && byPoints[j].points === byPoints[i].points) j++;
    const block = byPoints.slice(i, j);
    const tiedIds = new Set(block.map((r) => r.teamId));
    const key = (r: StandingRow<T>) => [headToHead(tiedIds, r.teamId), r.scoreDiff, r.scoreFor];
    block.sort((a, b) => {
      const ka = key(a);
      const kb = key(b);
      for (let k = 0; k < ka.length; k++) if (ka[k] !== kb[k]) return kb[k] - ka[k];
      return (seedIndex.get(a.teamId) ?? 0) - (seedIndex.get(b.teamId) ?? 0);
    });
    for (let k = 0; k < block.length; k++) {
      const same = (o?: StandingRow<T>) => !!o && key(o).every((v, x) => v === key(block[k])[x]);
      block[k].tied = same(block[k - 1]) || same(block[k + 1]);
    }
    ordered.push(...block);
    i = j;
  }
  ordered.forEach((r, i) => (r.rank = i + 1));
  return ordered;
}
