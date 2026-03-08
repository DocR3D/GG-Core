/**
 * Tests unitaires — LiveRule
 * TC-06 : Round gagné après déconnexion (winner=T)
 * TC-07 : Round gagné par désamorçage (winner=CT, reason=defused)
 */
import { LiveRule } from './live.rule';
import { EventTypes } from '@domain/events/event.types';

const MATCH_ID = 'm-test';
const SERVER_ID = 'srv-a';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeCtx() {
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
    },
    state: {
      getServerIdFromMatchId: jest.fn().mockResolvedValue(SERVER_ID),
      getSnapshot: jest.fn().mockResolvedValue({
        score: { home: 0, away: 1 },
        sides: { home: 'T', away: 'CT' },
        teams: { home_name: 'TeamA', away_name: 'TeamB' },
      }),
    },
  } as any;
}

function makeRoundWinEvent(winner: 'CT' | 'T', reason: string) {
  return {
    type: EventTypes.TEAM_ROUND_WIN,
    matchId: MATCH_ID,
    serverId: SERVER_ID,
    round: 5,
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

    await (rule as any).onTeamRoundWin(makeRoundWinEvent('T', 'elim'), ctx);

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

    await (rule as any).onTeamRoundWin(makeRoundWinEvent('CT', 'defused'), ctx);

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
// onEnter — vérification config RCON et restart
// ---------------------------------------------------------------------------
describe('LiveRule.onEnter', () => {
  it('envoie la config competitive et programme le restart à 3s', async () => {
    const rule = new LiveRule(makePauseCmd());
    const ctx = makeCtx();

    await rule.onEnter(ctx);

    expect(ctx.orch.rcon).toHaveBeenCalledWith(
      expect.objectContaining({ serverId: SERVER_ID }),
    );
    expect(ctx.orch.restartGame).toHaveBeenCalledWith(
      expect.objectContaining({ delay: 3 }),
    );
    expect(ctx.orch.setPhase).toHaveBeenCalledWith(MATCH_ID, 'live_main');
  });
});
