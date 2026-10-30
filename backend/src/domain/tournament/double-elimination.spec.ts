import { buildDoubleElimination, doubleElimPlacements, seedOrder, BracketMatch, SlotSource } from './double-elimination';

/** Plays the whole bracket: `pickHome(match)` decides each winner. Returns champion and losses per seed. */
function simulate(bracket: BracketMatch[], teamCount: number, pickHome: (m: BracketMatch, home: number, away: number) => boolean) {
  const teams = new Map<string, { home?: number; away?: number }>(bracket.map((m) => [m.key, {}]));
  const losses = new Map<number, number>(Array.from({ length: teamCount }, (_, i) => [i + 1, 0]));
  const place = (src: SlotSource, m: BracketMatch, slot: 'home' | 'away') => {
    if (src.kind === 'seed') teams.get(m.key)![slot] = src.seed;
  };
  bracket.forEach((m) => { place(m.home, m, 'home'); place(m.away, m, 'away'); });
  let champion: number | undefined;
  const played = new Set<string>();
  for (let guard = 0; played.size < bracket.length && guard < 1000; guard++) {
    for (const m of bracket) {
      const t = teams.get(m.key)!;
      if (played.has(m.key) || t.home === undefined || t.away === undefined) continue;
      expect(t.home).not.toBe(t.away);
      const homeWins = pickHome(m, t.home, t.away);
      const [w, l] = homeWins ? [t.home, t.away] : [t.away, t.home];
      losses.set(l, losses.get(l)! + 1);
      played.add(m.key);
      if (m.winnerTo) teams.get(m.winnerTo.match)![m.winnerTo.slot === 'HOME' ? 'home' : 'away'] = w;
      else champion = w;
      if (m.loserTo) teams.get(m.loserTo.match)![m.loserTo.slot === 'HOME' ? 'home' : 'away'] = l;
    }
  }
  return { champion, losses, played: played.size };
}

describe('seedOrder', () => {
  it('place les seeds de façon standard (1 contre 8, 4 contre 5…)', () => {
    expect(seedOrder(8)).toEqual([1, 8, 4, 5, 2, 7, 3, 6]);
  });
});

describe('buildDoubleElimination', () => {
  it.each(Array.from({ length: 30 }, (_, i) => i + 3))('%i équipes : arbre complet, cohérent et jouable', (n) => {
    const b = buildDoubleElimination(n);

    // 2n - 2 matchs (sans « bracket reset »), un seul par clé
    expect(b).toHaveLength(2 * n - 2);
    expect(new Set(b.map((m) => m.key)).size).toBe(b.length);

    // chaque seed entre exactement une fois dans l'arbre
    const seeds = b.flatMap((m) => [m.home, m.away]).filter((s) => s.kind === 'seed').map((s) => (s as any).seed).sort((x, y) => x - y);
    expect(seeds).toEqual(Array.from({ length: n }, (_, i) => i + 1));

    // câblage : seule la grande finale n'a pas de suite ; les perdants du haut descendent, ceux du bas sortent
    for (const m of b) {
      if (m.bracket === 'FINAL') expect(m.winnerTo).toBeUndefined();
      else expect(m.winnerTo).toBeDefined();
      if (m.bracket === 'UPPER') expect(m.loserTo).toBeDefined();
      else expect(m.loserTo).toBeUndefined();
    }
    const gf = b.find((m) => m.key === 'GF')!;
    const upperFinal = b.find((m) => m.winnerTo?.match === 'GF' && m.bracket === 'UPPER')!;
    expect(upperFinal.winnerTo!.slot).toBe('HOME'); // le finaliste du haut a l'avance en grande finale
    expect(gf.away.kind).toBe('winner');

    // simulation (le meilleur seed gagne toujours, puis le moins bon) : tout se joue, 2 défaites pour éliminer
    for (const favourite of [true, false]) {
      const res = simulate(b, n, (_m, h, a) => (favourite ? h < a : h > a));
      expect(res.played).toBe(b.length);
      expect(res.champion).toBe(favourite ? 1 : res.champion);
      const champ = res.champion!;
      for (const [seed, l] of res.losses) expect(l).toBe(seed === champ ? (res.losses.get(champ)! > 0 ? 1 : 0) : 2);
    }
  });

  it('16 équipes : premier tour standard 1-16, 8-9, 4-13, 5-12…, aucun exempt', () => {
    const r1 = buildDoubleElimination(16).filter((m) => m.bracket === 'UPPER' && m.round === 1);
    expect(r1.map((m) => [(m.home as any).seed, (m.away as any).seed])).toEqual([
      [1, 16], [8, 9], [4, 13], [5, 12], [2, 15], [7, 10], [3, 14], [6, 11],
    ]);
  });

  it('12 équipes : les 4 meilleurs seeds sont exemptés du 1er tour et entrent directement au 2e', () => {
    const b = buildDoubleElimination(12);
    const r1 = b.filter((m) => m.bracket === 'UPPER' && m.round === 1);
    expect(r1).toHaveLength(4);
    const r2Seeds = b.filter((m) => m.bracket === 'UPPER' && m.round === 2)
      .flatMap((m) => [m.home, m.away]).filter((s) => s.kind === 'seed').map((s) => (s as any).seed).sort();
    expect(r2Seeds).toEqual([1, 2, 3, 4]);
  });

  it('refuse moins de 3 équipes', () => {
    expect(() => buildDoubleElimination(2)).toThrow();
  });
});

describe('doubleElimPlacements', () => {
  it('8 équipes : 1, 2, 3, 4, 5-6, 7-8 selon le tour d’élimination', () => {
    const b = buildDoubleElimination(8);
    // résultats : le meilleur seed gagne toujours
    const teams = new Map<string, { home?: number; away?: number }>(b.map((m) => [m.key, {}]));
    b.forEach((m) => {
      if (m.home.kind === 'seed') teams.get(m.key)!.home = m.home.seed;
      if (m.away.kind === 'seed') teams.get(m.key)!.away = m.away.seed;
    });
    const results = new Map<string, { winner: number; loser: number }>();
    while (results.size < b.length) {
      for (const m of b) {
        const t = teams.get(m.key)!;
        if (results.has(m.key) || t.home === undefined || t.away === undefined) continue;
        const [w, l] = t.home < t.away ? [t.home, t.away] : [t.away, t.home];
        results.set(m.key, { winner: w, loser: l });
        if (m.winnerTo) teams.get(m.winnerTo.match)![m.winnerTo.slot === 'HOME' ? 'home' : 'away'] = w;
        if (m.loserTo) teams.get(m.loserTo.match)![m.loserTo.slot === 'HOME' ? 'home' : 'away'] = l;
      }
    }
    const placed = doubleElimPlacements(b.map((m) => ({ bracket: m.bracket, round: m.round, finished: true, ...results.get(m.key)! })))
      .sort((x, y) => x.team - y.team); // shared places: order inside a range does not matter
    expect(placed).toEqual([
      { place: '1', team: 1 }, { place: '2', team: 2 }, { place: '3', team: 3 }, { place: '4', team: 4 },
      { place: '5-6', team: 5 }, { place: '5-6', team: 6 }, { place: '7-8', team: 7 }, { place: '7-8', team: 8 },
    ]);
  });
});
