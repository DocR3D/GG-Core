import { computeStandings, roundRobinPairings, snakeDistribute, FinishedSeries } from './round-robin';

describe('snakeDistribute', () => {
  it('répartit 8 seeds en 2 poules en serpentin (1-4-5-8 / 2-3-6-7)', () => {
    expect(snakeDistribute([1, 2, 3, 4, 5, 6, 7, 8], 2)).toEqual([[1, 4, 5, 8], [2, 3, 6, 7]]);
  });

  it('gère un nombre d’équipes non multiple du nombre de poules (18 équipes, 4 poules → 5/5/4/4)', () => {
    const groups = snakeDistribute(Array.from({ length: 18 }, (_, i) => i + 1), 4);
    expect(groups.map((g) => g.length)).toEqual([5, 5, 4, 4]);
    expect(groups.flat().sort((a, b) => a - b)).toEqual(Array.from({ length: 18 }, (_, i) => i + 1));
  });
});

describe('roundRobinPairings', () => {
  const pairsOf = (ids: string[]) => roundRobinPairings(ids).map((p) => [p.home, p.away].sort().join('-'));

  it.each([4, 5, 6])('%i équipes : chacun rencontre chacun exactement une fois', (n) => {
    const ids = Array.from({ length: n }, (_, i) => `T${i + 1}`);
    const pairs = pairsOf(ids);
    expect(pairs).toHaveLength((n * (n - 1)) / 2);
    expect(new Set(pairs).size).toBe(pairs.length);
  });

  it('personne ne joue deux fois dans le même round (5 équipes : une au repos par round)', () => {
    const p = roundRobinPairings(['A', 'B', 'C', 'D', 'E']);
    const rounds = new Set(p.map((x) => x.round));
    expect(rounds.size).toBe(5);
    for (const r of rounds) {
      const teams = p.filter((x) => x.round === r).flatMap((x) => [x.home, x.away]);
      expect(new Set(teams).size).toBe(teams.length);
      expect(teams).toHaveLength(4);
    }
  });
});

describe('computeStandings', () => {
  const win = (home: string, away: string, winner: string | null, games: [number, number][] = [[13, 5]]): FinishedSeries<string> => ({
    home, away, winner, games: games.map(([h, a]) => ({ home: h, away: a })),
  });

  it('classe aux points (3 par victoire)', () => {
    const s = computeStandings(['A', 'B', 'C'], [win('A', 'B', 'A'), win('A', 'C', 'A'), win('B', 'C', 'B')]);
    expect(s.map((r) => [r.teamId, r.points, r.rank])).toEqual([['A', 6, 1], ['B', 3, 2], ['C', 0, 3]]);
    expect(s.every((r) => !r.tied)).toBe(true);
  });

  it('à égalité de points, la confrontation directe passe avant la différence de score', () => {
    // B et C ont 6 points ; C a une bien meilleure différence de score, mais B a battu C
    const s = computeStandings(
      ['A', 'B', 'C', 'D'],
      [
        win('A', 'B', 'A', [[13, 11]]),
        win('B', 'C', 'B', [[13, 11]]),
        win('B', 'D', 'B', [[13, 11]]),
        win('C', 'A', 'C', [[13, 0]]),
        win('C', 'D', 'C', [[13, 0]]),
        win('D', 'A', 'D', [[13, 11]]),
      ],
    );
    expect(s.map((r) => [r.teamId, r.points])).toEqual([['B', 6], ['C', 6], ['D', 3], ['A', 3]]); // D a aussi battu A
    expect(s[0].tied).toBe(false);
  });

  it('égalité parfaite à trois (chacun bat un autre) → différence de score, puis drapeau tied pour l’admin', () => {
    const cycle = [win('A', 'B', 'A', [[13, 11]]), win('B', 'C', 'B', [[13, 11]]), win('C', 'A', 'C', [[13, 11]])];
    const s = computeStandings(['A', 'B', 'C'], cycle);
    expect(s.every((r) => r.points === 3 && r.scoreDiff === 0)).toBe(true);
    expect(s.every((r) => r.tied)).toBe(true);
    expect(s.map((r) => r.teamId)).toEqual(['A', 'B', 'C']); // ordre des seeds en attendant l'admin

    const decided = computeStandings(['A', 'B', 'C'], [win('A', 'B', 'A', [[13, 0]]), cycle[1], cycle[2]]);
    expect(decided[0].teamId).toBe('A');
    expect(decided.every((r) => !r.tied)).toBe(true);
  });

  it('compte les nuls (1 point) et les équipes sans match', () => {
    const s = computeStandings(['A', 'B', 'C'], [win('A', 'B', null, [[15, 15]])]);
    expect(s.find((r) => r.teamId === 'A')).toEqual(expect.objectContaining({ draws: 1, points: 1, played: 1 }));
    expect(s.find((r) => r.teamId === 'C')).toEqual(expect.objectContaining({ played: 0, points: 0, rank: 3 }));
  });
});
