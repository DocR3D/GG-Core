import { seededRandom } from './fake-data';
import { gameScore } from './tournament-simulation.service';

describe('gameScore (scores factices de la Sandbox)', () => {
  it('donne des scores CS2 possibles : 13-0 à 13-11, prolongations 16-12 à 16-14 et 19-15 à 19-17', () => {
    const rnd = seededRandom(42);
    const seen = new Set<string>();
    for (let i = 0; i < 2000; i++) {
      const [win, lose] = gameScore(rnd);
      seen.add(`${win}-${lose}`);
      if (win === 13) expect(lose).toBeLessThanOrEqual(11);
      else if (win === 16) expect([12, 13, 14]).toContain(lose);
      else {
        expect(win).toBe(19);
        expect([15, 16, 17]).toContain(lose);
      }
    }
    // variés : des matchs serrés, des prolongations
    expect(seen.has('13-11')).toBe(true);
    expect([...seen].some((s) => s.startsWith('16-'))).toBe(true);
    expect(seen.size).toBeGreaterThan(12);
  });
});
