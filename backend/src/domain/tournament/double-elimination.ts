// src/domain/tournament/double-elimination.ts
// Pure double-elimination bracket builder (no database). Works for any number of teams >= 3: the bracket is
// built for the next power of two, seeds above the team count are BYEs, and byes are RESOLVED at generation —
// a match against a bye is not created, its team goes straight to the next slot (also in the lower bracket,
// where the "loser" of a bye match is itself a bye).

export type Bracket = 'UPPER' | 'LOWER' | 'FINAL';
export type Slot = 'HOME' | 'AWAY';

/** Where a slot's team comes from. */
export type SlotSource =
  | { kind: 'seed'; seed: number }
  | { kind: 'winner'; match: string }
  | { kind: 'loser'; match: string };

export interface BracketMatch {
  key: string; // e.g. "U1-3", "L2-1", "GF"
  bracket: Bracket;
  round: number; // 1-based within its bracket (FINAL = 1)
  position: number; // 1-based within the round, after bye removal
  home: SlotSource;
  away: SlotSource;
  winnerTo?: { match: string; slot: Slot };
  loserTo?: { match: string; slot: Slot };
}

/** Standard seed order of a bracket of size p (1 vs p, then 2 vs p-1 on the other half, …): [1, 8, 4, 5, 2, 7, 3, 6]. */
export function seedOrder(p: number): number[] {
  let order = [1];
  while (order.length < p) {
    const size = order.length * 2;
    order = order.flatMap((s) => [s, size + 1 - s]);
  }
  return order;
}

type RawSource = SlotSource | { kind: 'bye' };
interface RawMatch {
  key: string;
  bracket: Bracket;
  round: number;
  home: RawSource;
  away: RawSource;
}

export function buildDoubleElimination(teamCount: number): BracketMatch[] {
  if (!Number.isInteger(teamCount) || teamCount < 3) throw new Error('double elimination needs at least 3 teams');
  const p = 2 ** Math.ceil(Math.log2(teamCount));
  const upperRounds = Math.log2(p);
  const raw: RawMatch[] = [];
  const key = (b: string, r: number, i: number) => `${b}${r}-${i + 1}`;
  const winner = (m: string): RawSource => ({ kind: 'winner', match: m });
  const loser = (m: string): RawSource => ({ kind: 'loser', match: m });

  // Upper bracket
  const order = seedOrder(p);
  for (let i = 0; i < p / 2; i++) {
    const seed = (s: number): RawSource => (s > teamCount ? { kind: 'bye' } : { kind: 'seed', seed: s });
    raw.push({ key: key('U', 1, i), bracket: 'UPPER', round: 1, home: seed(order[2 * i]), away: seed(order[2 * i + 1]) });
  }
  for (let r = 2; r <= upperRounds; r++) {
    for (let i = 0; i < p / 2 ** r; i++) {
      raw.push({ key: key('U', r, i), bracket: 'UPPER', round: r, home: winner(key('U', r - 1, 2 * i)), away: winner(key('U', r - 1, 2 * i + 1)) });
    }
  }

  // Lower bracket: L1 = losers of U1 paired; then alternately a "drop-in" round (lower winners vs the losers
  // coming down from the upper round, in reversed order every other time to delay rematches) and a round
  // pairing lower winners together.
  const l1 = p / 4;
  for (let i = 0; i < l1; i++) {
    raw.push({ key: key('L', 1, i), bracket: 'LOWER', round: 1, home: loser(key('U', 1, 2 * i)), away: loser(key('U', 1, 2 * i + 1)) });
  }
  let lowerRound = 1;
  for (let k = 1; k <= upperRounds - 1; k++) {
    const count = p / 2 ** (k + 1);
    const prev = lowerRound;
    lowerRound++;
    for (let i = 0; i < count; i++) {
      const j = k % 2 === 1 ? count - 1 - i : i;
      raw.push({
        key: key('L', lowerRound, i), bracket: 'LOWER', round: lowerRound,
        home: winner(key('L', prev, i)), away: loser(key('U', k + 1, j)),
      });
    }
    if (k <= upperRounds - 2) {
      const pairPrev = lowerRound;
      lowerRound++;
      for (let i = 0; i < count / 2; i++) {
        raw.push({
          key: key('L', lowerRound, i), bracket: 'LOWER', round: lowerRound,
          home: winner(key('L', pairPrev, 2 * i)), away: winner(key('L', pairPrev, 2 * i + 1)),
        });
      }
    }
  }

  // Grand final: upper-bracket winner at HOME (it gets the starting advantage), lower-bracket winner AWAY
  raw.push({ key: 'GF', bracket: 'FINAL', round: 1, home: winner(key('U', upperRounds, 0)), away: winner(key('L', lowerRound, 0)) });

  // --- bye resolution -------------------------------------------------------------------------------
  const byKey = new Map(raw.map((m) => [m.key, m]));
  const memo = new Map<RawSource, boolean>();
  const isBye = (s: RawSource): boolean => {
    if (memo.has(s)) return memo.get(s)!;
    let v: boolean;
    if (s.kind === 'bye') v = true;
    else if (s.kind === 'seed') v = false;
    else {
      const m = byKey.get(s.match)!;
      const hb = isBye(m.home);
      const ab = isBye(m.away);
      v = s.kind === 'winner' ? hb && ab : hb || ab; // a bye match's loser is a bye
    }
    memo.set(s, v);
    return v;
  };
  const isReal = (m: RawMatch) => !isBye(m.home) && !isBye(m.away);
  // Follow pass-through matches (exactly one bye side) back to the real source of a team
  const resolve = (s: RawSource): SlotSource => {
    if (s.kind === 'winner') {
      const m = byKey.get(s.match)!;
      if (!isReal(m)) return resolve(isBye(m.home) ? m.away : m.home);
    }
    if (s.kind === 'bye') throw new Error('unresolved bye');
    return s;
  };

  const real = raw.filter(isReal);
  const out: BracketMatch[] = [];
  const position = new Map<string, number>();
  for (const m of real) {
    const roundKey = `${m.bracket}${m.round}`;
    position.set(roundKey, (position.get(roundKey) ?? 0) + 1);
    out.push({ key: m.key, bracket: m.bracket, round: m.round, position: position.get(roundKey)!, home: resolve(m.home), away: resolve(m.away) });
  }
  const outByKey = new Map(out.map((m) => [m.key, m]));
  for (const m of out) {
    for (const slot of ['HOME', 'AWAY'] as const) {
      const src = slot === 'HOME' ? m.home : m.away;
      if (src.kind === 'winner') outByKey.get(src.match)!.winnerTo = { match: m.key, slot };
      if (src.kind === 'loser') outByKey.get(src.match)!.loserTo = { match: m.key, slot };
    }
  }
  return out;
}

export interface PlacedMatch<T> {
  bracket: Bracket;
  round: number;
  finished: boolean;
  winner: T | null;
  loser: T | null;
}

/**
 * Final placements of a double elimination: grand final winner 1st, loser 2nd, then teams knocked out in the
 * lower bracket share places by round (last lower round = 3rd, …; e.g. "5-6"). Only finished matches place a
 * team; the ranges come from the bracket structure, so partial results are already correct.
 */
export function doubleElimPlacements<T>(matches: PlacedMatch<T>[]): { place: string; team: T }[] {
  const out: { place: string; team: T }[] = [];
  const gf = matches.find((m) => m.bracket === 'FINAL');
  if (gf?.finished && gf.winner !== null && gf.loser !== null) {
    out.push({ place: '1', team: gf.winner }, { place: '2', team: gf.loser });
  }
  const lower = matches.filter((m) => m.bracket === 'LOWER');
  const rounds = [...new Set(lower.map((m) => m.round))].sort((a, b) => b - a);
  let next = 3;
  for (const r of rounds) {
    const inRound = lower.filter((m) => m.round === r);
    const place = inRound.length === 1 ? `${next}` : `${next}-${next + inRound.length - 1}`;
    for (const m of inRound) if (m.finished && m.loser !== null) out.push({ place, team: m.loser });
    next += inRound.length;
  }
  return out;
}
