/**
 * Tests unitaires — RegulationService
 *
 * TC-R01 : Vainqueur en régulation (t >= winRounds)
 * TC-R02 : Vainqueur en régulation (ct >= winRounds)
 * TC-R03 : Halftime détecté (round === maxRounds / 2)
 * TC-R04 : Égalité fin de régulation + overtime activé
 * TC-R05 : Égalité fin de régulation + overtime désactivé
 * TC-R06 : Aucun déclenchement si score/round non décisif
 * TC-R07 : Skip si phase != live_main / overtime
 */
import { RegulationService } from './regulation.service';
import { MatchPhase } from '@domain/phase.types';

const MATCH_ID = 'm-reg';

function makeState(opts: {
  phase?: string;
  score?: { t: number; ct: number };
  round?: number;
  config?: { maxRounds?: number; winRounds?: number; overtimeEnabled?: boolean };
}) {
  return {
    getScore: jest.fn().mockResolvedValue(opts.score ?? { t: 0, ct: 0 }),
    getMatchConfig: jest.fn().mockResolvedValue({
      maxRounds: opts.config?.maxRounds ?? 30,
      winRounds: opts.config?.winRounds ?? 16,
      overtimeEnabled: opts.config?.overtimeEnabled ?? false,
    }),
    getRound: jest.fn().mockResolvedValue(opts.round ?? 0),
  } as any;
}

function makeOrch(phase = MatchPhase.LIVE_MAIN) {
  return {
    getPhase: jest.fn().mockResolvedValue(phase),
    triggerMatchEnd: jest.fn().mockResolvedValue(undefined),
    runHalftime:     jest.fn().mockResolvedValue(undefined),
    runOvertime:     jest.fn().mockResolvedValue(undefined),
  } as any;
}

// ---------------------------------------------------------------------------
// TC-R01 — Vainqueur côté T
// ---------------------------------------------------------------------------
describe('TC-R01 — RegulationService : vainqueur T', () => {
  it('déclenche triggerMatchEnd quand t >= winRounds', async () => {
    const orch  = makeOrch();
    const state = makeState({ score: { t: 16, ct: 10 }, round: 26, config: { winRounds: 16 } });
    const svc   = new RegulationService(state, orch);

    await svc.checkAfterScore(MATCH_ID);

    expect(orch.triggerMatchEnd).toHaveBeenCalledWith(MATCH_ID, 'regulation_winner');
    expect(orch.runHalftime).not.toHaveBeenCalled();
    expect(orch.runOvertime).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// TC-R02 — Vainqueur côté CT
// ---------------------------------------------------------------------------
describe('TC-R02 — RegulationService : vainqueur CT', () => {
  it('déclenche triggerMatchEnd quand ct >= winRounds', async () => {
    const orch  = makeOrch();
    const state = makeState({ score: { t: 8, ct: 16 }, round: 24, config: { winRounds: 16 } });
    const svc   = new RegulationService(state, orch);

    await svc.checkAfterScore(MATCH_ID);

    expect(orch.triggerMatchEnd).toHaveBeenCalledWith(MATCH_ID, 'regulation_winner');
  });
});

// ---------------------------------------------------------------------------
// TC-R03 — Halftime (round = maxRounds / 2)
// ---------------------------------------------------------------------------
describe('TC-R03 — RegulationService : halftime', () => {
  it('déclenche runHalftime quand round === maxRounds / 2', async () => {
    const orch  = makeOrch();
    const state = makeState({ score: { t: 5, ct: 10 }, round: 15, config: { maxRounds: 30, winRounds: 16 } });
    const svc   = new RegulationService(state, orch);

    await svc.checkAfterScore(MATCH_ID);

    expect(orch.runHalftime).toHaveBeenCalledWith(MATCH_ID);
    expect(orch.triggerMatchEnd).not.toHaveBeenCalled();
    expect(orch.runOvertime).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// TC-R04 — Égalité + overtime activé
// ---------------------------------------------------------------------------
describe('TC-R04 — RegulationService : égalité + overtime activé', () => {
  it('déclenche runOvertime quand égalité à maxRounds avec overtime activé', async () => {
    const orch  = makeOrch();
    const state = makeState({
      score:  { t: 15, ct: 15 },
      round:  30,
      config: { maxRounds: 30, winRounds: 16, overtimeEnabled: true },
    });
    const svc = new RegulationService(state, orch);

    await svc.checkAfterScore(MATCH_ID);

    expect(orch.runOvertime).toHaveBeenCalledWith(MATCH_ID);
    expect(orch.triggerMatchEnd).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// TC-R05 — Égalité + overtime désactivé
// ---------------------------------------------------------------------------
describe('TC-R05 — RegulationService : égalité + overtime désactivé', () => {
  it('déclenche triggerMatchEnd (tie_no_overtime) quand overtime désactivé', async () => {
    const orch  = makeOrch();
    const state = makeState({
      score:  { t: 15, ct: 15 },
      round:  30,
      config: { maxRounds: 30, winRounds: 16, overtimeEnabled: false },
    });
    const svc = new RegulationService(state, orch);

    await svc.checkAfterScore(MATCH_ID);

    expect(orch.triggerMatchEnd).toHaveBeenCalledWith(MATCH_ID, 'tie_no_overtime');
    expect(orch.runOvertime).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// TC-R06 — Pas de déclenchement si score non décisif
// ---------------------------------------------------------------------------
describe('TC-R06 — RegulationService : aucune action si score non décisif', () => {
  it('ne déclenche rien si le round est en milieu de match', async () => {
    const orch  = makeOrch();
    const state = makeState({ score: { t: 5, ct: 6 }, round: 11, config: { maxRounds: 30, winRounds: 16 } });
    const svc   = new RegulationService(state, orch);

    await svc.checkAfterScore(MATCH_ID);

    expect(orch.triggerMatchEnd).not.toHaveBeenCalled();
    expect(orch.runHalftime).not.toHaveBeenCalled();
    expect(orch.runOvertime).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// TC-R07 — Skip si phase != live_main / overtime
// ---------------------------------------------------------------------------
describe('TC-R07 — RegulationService : skip si mauvaise phase', () => {
  it.each([
    MatchPhase.WARMUP_MAIN,
    MatchPhase.KNIFE_WARMUP,
    MatchPhase.KNIFE_LIVE,
    MatchPhase.POSTGAME,
  ])('ne fait rien en phase %s', async (phase) => {
    const orch  = makeOrch(phase as any);
    const state = makeState({ score: { t: 16, ct: 5 }, round: 21, config: { winRounds: 16 } });
    const svc   = new RegulationService(state, orch);

    await svc.checkAfterScore(MATCH_ID);

    expect(orch.triggerMatchEnd).not.toHaveBeenCalled();
    expect(orch.runHalftime).not.toHaveBeenCalled();
    expect(orch.runOvertime).not.toHaveBeenCalled();
  });
});
