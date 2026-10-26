/**
 * Tests unitaires — LiveRule
 * TC-06 : Round gagné après déconnexion (winner=T)
 * TC-07 : Round gagné par désamorçage (winner=CT, reason=defused)
 * MR12 Lifecycle :
 * - Anti-eBot Duplicate Round Guard
 * - Halftime detection at 12 rounds (swapteams, sides swap)
 * - Regulation Victory at 13 rounds (endMatch)
 * - Overtime MR3 trigger at 12-12
 * - Overtime Victory (2-point lead)
 */
import { LiveRule } from './live.rule';
import { EventTypes } from '@domain/events/event.types';
import { MatchPhase } from '@domain/phase.types';

const MATCH_ID = 'm-test';
const SERVER_ID = 'srv-a';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeCtx(overrides: {
  snapshot?: any;
  lastScoredRound?: number;
  isHalftimePlayed?: boolean;
  overtimeCount?: number;
  settings?: any;
} = {}) {
  return {
    matchId: MATCH_ID,
    serverId: SERVER_ID,
    say: jest.fn().mockResolvedValue(undefined),
    pubEvent: jest.fn().mockResolvedValue(undefined),
    orch: {
      rcon: jest.fn().mockResolvedValue(undefined),
      restartGame: jest.fn().mockResolvedValue(undefined),
      push: jest.fn().mockResolvedValue(undefined),
      roundEnd: jest.fn().mockResolvedValue(undefined),
      setPhase: jest.fn().mockResolvedValue(undefined),
      swapSides: jest.fn().mockResolvedValue(true),
      endMatch: jest.fn().mockResolvedValue(undefined),
    },
    state: {
      getServerIdFromMatchId: jest.fn().mockResolvedValue(SERVER_ID),
      getSnapshot: jest.fn().mockResolvedValue(
        overrides.snapshot ?? {
          score: { home: 0, away: 1, ct: 0, t: 1, round: 1 },
          sides: { home: 'T', away: 'CT' },
          teams: { home_name: 'TeamA', away_name: 'TeamB' },
        },
      ),
      getLastScoredRound: jest.fn().mockResolvedValue(overrides.lastScoredRound ?? 0),
      setLastScoredRound: jest.fn().mockResolvedValue(undefined),
      isHalftimePlayed: jest.fn().mockResolvedValue(overrides.isHalftimePlayed ?? false),
      setHalftimePlayed: jest.fn().mockResolvedValue(undefined),
      getOvertimeCount: jest.fn().mockResolvedValue(overrides.overtimeCount ?? 0),
      setOvertimeCount: jest.fn().mockResolvedValue(undefined),
      getSettings: jest.fn().mockResolvedValue(
        overrides.settings ?? {
          mrFormat: 12,
          otMrFormat: 3,
          overtimeEnabled: true,
          warmupAtHalftime: false,
          warmupAtOvertime: false,
        },
      ),
      setSettings: jest.fn().mockResolvedValue(undefined),
    },
  } as any;
}

function makeRoundWinEvent(winner: 'CT' | 'T', reason: string, round = 5) {
  return {
    type: EventTypes.TEAM_ROUND_WIN,
    matchId: MATCH_ID,
    serverId: SERVER_ID,
    round,
    tick: 0,
    payload: { winner, reason },
  } as any;
}

function makePauseCmd() {
  return { handle: jest.fn().mockResolvedValue(true) } as any;
}

// ---------------------------------------------------------------------------
// TC-06 — Déconnexion joueur → round attribué à T
// ---------------------------------------------------------------------------
describe('TC-06 — LiveRule : round gagné par élimination (déconnexion)', () => {
  it('appelle roundEnd avec winner=T et publie score:update', async () => {
    const rule = new LiveRule(makePauseCmd());
    const ctx = makeCtx();

    await (rule as any).onTeamRoundWin(makeRoundWinEvent('T', 'elim', 1), ctx);

    expect(ctx.orch.roundEnd).toHaveBeenCalledWith(MATCH_ID, 'T');
    expect(ctx.orch.push).toHaveBeenCalledWith(
      MATCH_ID,
      'score:update',
      expect.objectContaining({ score: expect.any(Object) }),
    );
  });

  it('ne crashe pas si winner est absent dans le payload', async () => {
    const rule = new LiveRule(makePauseCmd());
    const ctx = makeCtx();

    const badEvent = {
      type: EventTypes.TEAM_ROUND_WIN,
      matchId: MATCH_ID,
      serverId: SERVER_ID,
      round: 5,
      tick: 0,
      payload: {},
    } as any;

    await expect((rule as any).onTeamRoundWin(badEvent, ctx)).resolves.not.toThrow();
    expect(ctx.orch.roundEnd).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// TC-07 — Round gagné par désamorçage (defused)
// ---------------------------------------------------------------------------
describe('TC-07 — LiveRule : round gagné par désamorçage', () => {
  it('appelle roundEnd avec winner=CT (reason=defused) et publie score:update', async () => {
    const rule = new LiveRule(makePauseCmd());
    const ctx = makeCtx();

    await (rule as any).onTeamRoundWin(makeRoundWinEvent('CT', 'defused', 1), ctx);

    expect(ctx.orch.roundEnd).toHaveBeenCalledWith(MATCH_ID, 'CT');
    expect(ctx.orch.push).toHaveBeenCalledWith(
      MATCH_ID,
      'score:update',
      expect.objectContaining({
        score: expect.any(Object),
        sides: expect.any(Object),
        teams: expect.any(Object),
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// Anti-eBot Duplicate Round Protection
// ---------------------------------------------------------------------------
describe('Anti-eBot Protection — Duplicate Round Rejection', () => {
  it('ignore un événement de fin de round déjà scoré (évite emballement des rounds eBot)', async () => {
    const rule = new LiveRule(makePauseCmd());
    // Le match a déjà scoré le round 5
    const ctx = makeCtx({ lastScoredRound: 5 });

    // Réception d'un log dupliqué pour le round 5
    await (rule as any).onTeamRoundWin(makeRoundWinEvent('CT', 'normal', 5), ctx);

    // roundEnd ne doit PAS être rappelé pour ce duplicata
    expect(ctx.orch.roundEnd).not.toHaveBeenCalled();
    expect(ctx.state.setLastScoredRound).not.toHaveBeenCalled();
  });

  it('enregistre le nouveau numéro de round quand il progresse', async () => {
    const rule = new LiveRule(makePauseCmd());
    const ctx = makeCtx({ lastScoredRound: 5 });

    await (rule as any).onTeamRoundWin(makeRoundWinEvent('CT', 'normal', 6), ctx);

    expect(ctx.orch.roundEnd).toHaveBeenCalledWith(MATCH_ID, 'CT');
    expect(ctx.state.setLastScoredRound).toHaveBeenCalledWith(MATCH_ID, 6);
  });
});

// ---------------------------------------------------------------------------
// Halftime Management (MR12)
// ---------------------------------------------------------------------------
describe('Regulation Halftime (MR12)', () => {
  it('déclenche le halftime à 12 rounds joués (mp_swapteams, swapSides, restart rapide 3s)', async () => {
    const rule = new LiveRule(makePauseCmd());
    const ctx = makeCtx({
      lastScoredRound: 11,
      isHalftimePlayed: false,
      snapshot: {
        score: { ct: 7, t: 5, round: 12 },
        sides: { home: 'CT', away: 'T' },
        teams: { home_name: 'TeamA', away_name: 'TeamB' },
      },
    });

    await (rule as any).onTeamRoundWin(makeRoundWinEvent('CT', 'normal', 12), ctx);

    // Swap sides in game and state
    expect(ctx.orch.rcon).toHaveBeenCalledWith(
      expect.objectContaining({ command: 'mp_swapteams' }),
    );
    expect(ctx.orch.swapSides).toHaveBeenCalledWith(MATCH_ID);
    expect(ctx.state.setHalftimePlayed).toHaveBeenCalledWith(MATCH_ID, true);
    // Fast LAN mode: restart in 3s without waiting for !ready
    expect(ctx.orch.restartGame).toHaveBeenCalledWith(
      expect.objectContaining({ delay: 3 }),
    );
  });

  it('ne redéclenche pas le halftime si déjà joué', async () => {
    const rule = new LiveRule(makePauseCmd());
    const ctx = makeCtx({
      lastScoredRound: 12,
      isHalftimePlayed: true,
      snapshot: {
        score: { ct: 7, t: 6, round: 13 },
        sides: { home: 'T', away: 'CT' },
        teams: { home_name: 'TeamA', away_name: 'TeamB' },
      },
    });

    await (rule as any).onTeamRoundWin(makeRoundWinEvent('T', 'normal', 13), ctx);

    expect(ctx.orch.swapSides).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Regulation Victory (MR12: 13 points)
// ---------------------------------------------------------------------------
describe('Regulation Victory (MR12)', () => {
  it('termine le match quand une équipe atteint 13 points (scoreCT=13, scoreT=7)', async () => {
    const rule = new LiveRule(makePauseCmd());
    const ctx = makeCtx({
      lastScoredRound: 19,
      isHalftimePlayed: true,
      snapshot: {
        score: { ct: 13, t: 7, round: 20 },
        sides: { home: 'T', away: 'CT' },
        teams: { home_name: 'TeamA', away_name: 'TeamB' },
      },
    });

    await (rule as any).onTeamRoundWin(makeRoundWinEvent('CT', 'normal', 20), ctx);

    expect(ctx.orch.endMatch).toHaveBeenCalledWith(MATCH_ID, 'CT', ctx);
  });
});

// ---------------------------------------------------------------------------
// Overtime (MR3 at 12-12)
// ---------------------------------------------------------------------------
describe('Overtime (MR3)', () => {
  it('déclenche les prolongations à 12-12 (exec overtime.cfg, phase OVERTIME, otCount=1)', async () => {
    const rule = new LiveRule(makePauseCmd());
    const ctx = makeCtx({
      lastScoredRound: 23,
      isHalftimePlayed: true,
      snapshot: {
        score: { ct: 12, t: 12, round: 24 },
        sides: { home: 'T', away: 'CT' },
        teams: { home_name: 'TeamA', away_name: 'TeamB' },
      },
    });

    await (rule as any).onTeamRoundWin(makeRoundWinEvent('T', 'normal', 24), ctx);

    expect(ctx.orch.setPhase).toHaveBeenCalledWith(MATCH_ID, MatchPhase.OVERTIME);
    expect(ctx.orch.rcon).toHaveBeenCalledWith(
      expect.objectContaining({ command: 'exec overtime.cfg' }),
    );
    expect(ctx.state.setOvertimeCount).toHaveBeenCalledWith(MATCH_ID, 1);
  });

  it('déclare la victoire en Overtime si une équipe gagne avec 2 points d’avance (16-14)', async () => {
    const rule = new LiveRule(makePauseCmd());
    const ctx = makeCtx({
      lastScoredRound: 29,
      isHalftimePlayed: true,
      overtimeCount: 1,
      snapshot: {
        score: { ct: 16, t: 14, round: 30 },
        sides: { home: 'CT', away: 'T' },
        teams: { home_name: 'TeamA', away_name: 'TeamB' },
      },
    });

    await (rule as any).onTeamRoundWin(makeRoundWinEvent('CT', 'normal', 30), ctx);

    expect(ctx.orch.endMatch).toHaveBeenCalledWith(MATCH_ID, 'CT', ctx);
  });
});

// ---------------------------------------------------------------------------
// onEnter — vérification config RCON et restart
// ---------------------------------------------------------------------------
describe('LiveRule.onEnter', () => {
  it('envoie la config competitive et programme le restart à 3s lors du début de match (round 0)', async () => {
    const rule = new LiveRule(makePauseCmd());
    const ctx = makeCtx({
      snapshot: { score: { ct: 0, t: 0, round: 0 } },
    });

    await rule.onEnter(ctx);

    expect(ctx.orch.rcon).toHaveBeenCalledWith(
      expect.objectContaining({ serverId: SERVER_ID }),
    );
    expect(ctx.orch.restartGame).toHaveBeenCalledWith(
      expect.objectContaining({ delay: 3 }),
    );
    expect(ctx.orch.setPhase).toHaveBeenCalledWith(MATCH_ID, 'live_main');
  });

  it('ne doit PAS réinitialiser le jeu ou écraser la config si la phase est OVERTIME', async () => {
    const rule = new LiveRule(makePauseCmd());
    const ctx = makeCtx({
      overtimeCount: 1,
      snapshot: { score: { ct: 12, t: 12, round: 24 } },
    });
    ctx.orch.getPhase = jest.fn().mockResolvedValue(MatchPhase.OVERTIME);

    await rule.onEnter(ctx);

    // Ne doit pas exécuter gamemode_competitive ni restartGame
    expect(ctx.orch.restartGame).not.toHaveBeenCalled();
    expect(ctx.orch.rcon).not.toHaveBeenCalledWith(
      expect.objectContaining({ command: expect.stringContaining('gamemode_competitive') }),
    );
    expect(ctx.say).toHaveBeenCalledWith(expect.stringContaining('OVERTIME'));
  });

  it('ne doit PAS redémarrer le match si totalRounds > 0 (reprise en cours de jeu)', async () => {
    const rule = new LiveRule(makePauseCmd());
    const ctx = makeCtx({
      snapshot: { score: { ct: 7, t: 5, round: 12 } },
    });

    await rule.onEnter(ctx);

    // Ne doit pas relancer le match depuis le début
    expect(ctx.orch.restartGame).not.toHaveBeenCalled();
    expect(ctx.say).toHaveBeenCalledWith(expect.stringContaining('Reprise du match LIVE'));
  });
});
