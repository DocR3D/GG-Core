import { rpsWinner, validateVetoConfig, VetoDone, VetoError, vetoSequence, vetoState } from './veto';

const POOL = ['de_ancient', 'de_anubis', 'de_dust2', 'de_inferno', 'de_mirage', 'de_nuke', 'de_train'];
const knife = { mapPool: POOL, sideMode: 'knife' as const };
const pick = { mapPool: POOL, sideMode: 'pick' as const };

describe('veto - sequences', () => {
  it('7 maps : BO1 6 bans, BO3 ban ban pick pick ban ban, BO5 ban ban pick x4', () => {
    expect(vetoSequence('BO1', 7)).toEqual(Array(6).fill('ban'));
    expect(vetoSequence('BO3', 7)).toEqual(['ban', 'ban', 'pick', 'pick', 'ban', 'ban']);
    expect(vetoSequence('BO5', 7)).toEqual(['ban', 'ban', 'pick', 'pick', 'pick', 'pick']);
  });

  it('autres tailles de pool ; pool trop petit refusé', () => {
    expect(vetoSequence('BO3', 5)).toEqual(['ban', 'ban', 'pick', 'pick']);
    expect(vetoSequence('BO3', 4)).toEqual(['ban', 'pick', 'pick']);
    expect(vetoSequence('BO1', 1)).toEqual([]);
    expect(() => vetoSequence('BO5', 4)).toThrow(VetoError);
  });

  it('configuration validée : pool requis, sans doublon, mode de side knife par défaut', () => {
    expect(validateVetoConfig({ mapPool: [' de_nuke ', 'de_train'] })).toEqual({ mapPool: ['de_nuke', 'de_train'], sideMode: 'knife' });
    expect(() => validateVetoConfig({ mapPool: [] })).toThrow(VetoError);
    expect(() => validateVetoConfig({ mapPool: ['de_nuke', 'de_nuke'] })).toThrow(/duplicates/);
    expect(() => validateVetoConfig({ mapPool: ['de_nuke'], sideMode: 'coin' as any })).toThrow(/sideMode/);
  });
});

describe('veto - déroulé', () => {
  it('BO1 : bans alternés depuis A, la dernière map est le decider (knife)', () => {
    const done: VetoDone[] = POOL.slice(0, 5).map((map, i) => ({ kind: 'ban', team: i % 2 ? 'B' : 'A', map }));
    let s = vetoState(knife, 'BO1', done);
    expect(s.next).toEqual({ kind: 'ban', team: 'B' });
    expect(s.remaining).toEqual(['de_nuke', 'de_train']);
    s = vetoState(knife, 'BO1', [...done, { kind: 'ban', team: 'B', map: 'de_train' }]);
    expect(s.finished).toBe(true);
    expect(s.maps).toEqual([{ map: 'de_nuke', pickedBy: null }]);
  });

  it('BO3 knife : picks dans l’ordre puis decider, aucun choix de side', () => {
    const s = vetoState(knife, 'BO3', [
      { kind: 'ban', team: 'A', map: 'de_train' },
      { kind: 'ban', team: 'B', map: 'de_anubis' },
      { kind: 'pick', team: 'A', map: 'de_mirage' },
      { kind: 'pick', team: 'B', map: 'de_inferno' },
      { kind: 'ban', team: 'A', map: 'de_dust2' },
      { kind: 'ban', team: 'B', map: 'de_nuke' },
    ]);
    expect(s.finished).toBe(true);
    expect(s.maps).toEqual([
      { map: 'de_mirage', pickedBy: 'A' },
      { map: 'de_inferno', pickedBy: 'B' },
      { map: 'de_ancient', pickedBy: null },
    ]);
  });

  it('BO3 mode pick : après chaque pick, l’adversaire choisit son side ; le decider reste au knife', () => {
    const steps: VetoDone[] = [
      { kind: 'ban', team: 'A', map: 'de_train' },
      { kind: 'ban', team: 'B', map: 'de_anubis' },
      { kind: 'pick', team: 'A', map: 'de_mirage' },
    ];
    expect(vetoState(pick, 'BO3', steps).next).toEqual({ kind: 'side', team: 'B', map: 'de_mirage' });
    steps.push({ kind: 'side', team: 'B', map: 'de_mirage', side: 'CT' }, { kind: 'pick', team: 'B', map: 'de_inferno' });
    expect(vetoState(pick, 'BO3', steps).next).toEqual({ kind: 'side', team: 'A', map: 'de_inferno' });
    steps.push(
      { kind: 'side', team: 'A', map: 'de_inferno', side: 'T' },
      { kind: 'ban', team: 'A', map: 'de_dust2' },
      { kind: 'ban', team: 'B', map: 'de_nuke' },
    );
    const s = vetoState(pick, 'BO3', steps);
    expect(s.maps).toEqual([
      { map: 'de_mirage', pickedBy: 'A', sideChosenBy: 'B', side: 'CT' },
      { map: 'de_inferno', pickedBy: 'B', sideChosenBy: 'A', side: 'T' },
      { map: 'de_ancient', pickedBy: null },
    ]);
  });

  it('refuse : mauvaise équipe, mauvaise action, map déjà prise, side invalide, veto terminé', () => {
    expect(() => vetoState(knife, 'BO3', [{ kind: 'ban', team: 'B', map: 'de_nuke' }])).toThrow(/expected ban by team A/);
    expect(() => vetoState(knife, 'BO3', [{ kind: 'pick', team: 'A', map: 'de_nuke' }])).toThrow(/expected ban/);
    expect(() =>
      vetoState(knife, 'BO3', [
        { kind: 'ban', team: 'A', map: 'de_nuke' },
        { kind: 'ban', team: 'B', map: 'de_nuke' },
      ]),
    ).toThrow(/not available/);
    const toSide: VetoDone[] = [
      { kind: 'ban', team: 'A', map: 'de_train' },
      { kind: 'ban', team: 'B', map: 'de_anubis' },
      { kind: 'pick', team: 'A', map: 'de_mirage' },
    ];
    expect(() => vetoState(pick, 'BO3', [...toSide, { kind: 'side', team: 'B', map: 'de_mirage', side: 'X' as any }])).toThrow(/side/);
    const bo1 = POOL.slice(0, 6).map((map, i): VetoDone => ({ kind: 'ban', team: i % 2 ? 'B' : 'A', map }));
    expect(() => vetoState(knife, 'BO1', [...bo1, { kind: 'ban', team: 'A', map: 'de_train' }])).toThrow(/finished/);
  });
});

describe('pierre-feuille-ciseaux', () => {
  it('gagnant ou égalité', () => {
    expect(rpsWinner('rock', 'scissors')).toBe('first');
    expect(rpsWinner('rock', 'paper')).toBe('second');
    expect(rpsWinner('paper', 'rock')).toBe('first');
    expect(rpsWinner('scissors', 'paper')).toBe('first');
    expect(rpsWinner('scissors', 'scissors')).toBeNull();
  });
});
