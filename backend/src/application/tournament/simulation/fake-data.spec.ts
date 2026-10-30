import { fakeGameStats, fakePlayerNames, fakeTeamNames, seededRandom } from './fake-data';

describe('fake tournament data', () => {
  it('même graine → mêmes tirages', () => {
    const a = seededRandom(42);
    const b = seededRandom(42);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });

  it('noms d’équipes uniques jusqu’à 64 équipes, joueurs différents d’une équipe à l’autre', () => {
    expect(new Set(fakeTeamNames(64)).size).toBe(64);
    expect(fakePlayerNames(0, 5)).not.toEqual(fakePlayerNames(1, 5));
    expect(fakePlayerNames(3, 5)).toHaveLength(5);
  });

  it('stats d’un game cohérentes : kills d’une équipe = morts de l’autre, le vainqueur fait plus de kills', () => {
    const rnd = seededRandom(7);
    for (let i = 0; i < 50; i++) {
      const { home, away } = fakeGameStats(13, 7, 5, rnd);
      const sum = (lines: typeof home, k: keyof (typeof home)[number]) => lines.reduce((s, l) => s + (l[k] as number), 0);
      expect(sum(home, 'kills')).toBe(sum(away, 'deaths'));
      expect(sum(away, 'kills')).toBe(sum(home, 'deaths'));
      expect(sum(home, 'kills')).toBeGreaterThan(sum(away, 'kills'));
      expect(sum(home, 'mvps')).toBe(13);
      expect([...home, ...away].every((l) => l.headshots <= l.kills && l.adr >= 0)).toBe(true);
    }
  });
});
