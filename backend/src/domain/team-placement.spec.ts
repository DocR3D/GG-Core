import { decidePlacement, PlacementInput } from './team-placement';

const base = (sides: Record<string, string>, lineups = { home: ['h1', 'h2'], away: ['a1', 'a2'] }): PlacementInput => ({
  expected: { home: 'T', away: 'CT' },
  lineups,
  sides,
});

describe('decidePlacement (sides chosen in the veto)', () => {
  it('every team on its side → ok (TERRORIST as logged by CS2 counts as T)', () => {
    expect(decidePlacement(base({ h1: 'TERRORIST', h2: 'T', a1: 'CT', a2: 'CT' }))).toEqual({ kind: 'ok' });
  });

  it('both teams fully on the other side → swap', () => {
    expect(decidePlacement(base({ h1: 'CT', h2: 'CT', a1: 'TERRORIST', a2: 'TERRORIST' }))).toEqual({ kind: 'swap' });
  });

  it('one player on the wrong side → wrong, naming him', () => {
    const v = decidePlacement(base({ h1: 'TERRORIST', h2: 'CT', a1: 'CT', a2: 'CT' }));
    expect(v).toEqual({ kind: 'wrong', misplaced: [{ steamId: 'h2', team: 'home', on: 'CT', expected: 'T' }] });
  });

  it('one team on the wrong side, the other right (both on the same side) → wrong, not a swap', () => {
    const v = decidePlacement(base({ h1: 'CT', h2: 'CT', a1: 'CT', a2: 'CT' }));
    expect(v.kind).toBe('wrong');
  });

  it('spectators and players not yet in a side are ignored', () => {
    expect(decidePlacement(base({ h1: 'TERRORIST', h2: 'Spectator', a1: 'CT', a2: 'Unassigned' }))).toEqual({ kind: 'ok' });
  });

  it('nothing to check against → unknown', () => {
    expect(decidePlacement(base({}, { home: [], away: ['a1'] })).kind).toBe('unknown');
    expect(decidePlacement(base({ a1: 'CT' })).kind).toBe('unknown'); // nobody of home on a side
  });
});
