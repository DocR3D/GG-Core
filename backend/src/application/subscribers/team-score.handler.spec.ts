/**
 * Tests unitaires — TeamScoreHandler
 *
 * TC-S01 : TEAM_SCORE valide → setScoreFromTeamEvent + push WS + checkAfterScore
 * TC-S02 : TEAM_SCORE payload invalide → warning, aucun appel
 * TC-S03 : MATCH_END_CONDITIONS → setMatchConfig
 * TC-S04 : Autre type d'event → ignoré
 */
import { TeamScoreHandler } from './team-score.handler';
import { EventTypes } from '@domain/events/event.types';

const MATCH_ID = 'm-score';

function makeState(snapshot = {}) {
  return {
    setScoreFromTeamEvent: jest.fn().mockResolvedValue(undefined),
    setMatchConfig:        jest.fn().mockResolvedValue(undefined),
    getSnapshot: jest.fn().mockResolvedValue({
      score:    { home: 3, away: 5, round: 8 },
      homeIsct: true,
      teams:    { home: { id: 'h1', name: 'Alpha' }, away: { id: 'a1', name: 'Beta' } },
      ...snapshot,
    }),
  } as any;
}

function makeOrch() {
  return {
    push: jest.fn().mockResolvedValue(undefined),
  } as any;
}

function makeRegulation() {
  return {
    checkAfterScore: jest.fn().mockResolvedValue(undefined),
  } as any;
}

function makeEvent(type: string, payload: any) {
  return { type, matchId: MATCH_ID, payload } as any;
}

// ---------------------------------------------------------------------------
// TC-S01 — TEAM_SCORE valide
// ---------------------------------------------------------------------------
describe('TC-S01 — TeamScoreHandler : TEAM_SCORE valide', () => {
  it('appelle setScoreFromTeamEvent + push WS + checkAfterScore', async () => {
    const state      = makeState();
    const orch       = makeOrch();
    const regulation = makeRegulation();
    const handler    = new TeamScoreHandler(state, orch, regulation);

    await handler.handle(makeEvent(EventTypes.TEAM_SCORE, { teamId: 3, score: 5 }));

    expect(state.setScoreFromTeamEvent).toHaveBeenCalledWith(MATCH_ID, 3, 5);
    expect(orch.push).toHaveBeenCalledWith(
      MATCH_ID,
      'score:update',
      expect.objectContaining({ score: expect.any(Object) }),
    );
    expect(regulation.checkAfterScore).toHaveBeenCalledWith(MATCH_ID);
  });

  it('inclut teamName dans le log sans erreur', async () => {
    const state      = makeState();
    const orch       = makeOrch();
    const regulation = makeRegulation();
    const handler    = new TeamScoreHandler(state, orch, regulation);

    await handler.handle(makeEvent(EventTypes.TEAM_SCORE, { teamId: 2, score: 8, teamName: 'Alpha' }));

    expect(state.setScoreFromTeamEvent).toHaveBeenCalledWith(MATCH_ID, 2, 8);
  });
});

// ---------------------------------------------------------------------------
// TC-S02 — TEAM_SCORE payload invalide
// ---------------------------------------------------------------------------
describe('TC-S02 — TeamScoreHandler : TEAM_SCORE payload invalide', () => {
  it.each([
    null,
    undefined,
    { score: 5 },         // teamId manquant
    { teamId: 3 },        // score manquant
    { teamId: 'x', score: 5 }, // teamId pas un number
  ])('ne crash pas et n\'appelle rien pour payload=%o', async (payload) => {
    const state      = makeState();
    const orch       = makeOrch();
    const regulation = makeRegulation();
    const handler    = new TeamScoreHandler(state, orch, regulation);

    await expect(
      handler.handle(makeEvent(EventTypes.TEAM_SCORE, payload)),
    ).resolves.not.toThrow();

    expect(state.setScoreFromTeamEvent).not.toHaveBeenCalled();
    expect(orch.push).not.toHaveBeenCalled();
    expect(regulation.checkAfterScore).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// TC-S03 — MATCH_END_CONDITIONS
// ---------------------------------------------------------------------------
describe('TC-S03 — TeamScoreHandler : MATCH_END_CONDITIONS', () => {
  it('appelle setMatchConfig avec les valeurs reçues', async () => {
    const state      = makeState();
    const orch       = makeOrch();
    const regulation = makeRegulation();
    const handler    = new TeamScoreHandler(state, orch, regulation);

    await handler.handle(makeEvent(EventTypes.MATCH_END_CONDITIONS, {
      maxRounds: 30,
      winRounds: 16,
      overtimeEnabled: true,
    }));

    expect(state.setMatchConfig).toHaveBeenCalledWith(MATCH_ID, {
      maxRounds:       30,
      winRounds:       16,
      overtimeEnabled: true,
    });
  });

  it('ne crash pas si payload est null', async () => {
    const state      = makeState();
    const orch       = makeOrch();
    const regulation = makeRegulation();
    const handler    = new TeamScoreHandler(state, orch, regulation);

    await expect(
      handler.handle(makeEvent(EventTypes.MATCH_END_CONDITIONS, null)),
    ).resolves.not.toThrow();

    expect(state.setMatchConfig).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// TC-S04 — Autre type d'event ignoré
// ---------------------------------------------------------------------------
describe('TC-S04 — TeamScoreHandler : autre type ignoré', () => {
  it('ne fait rien pour un event non géré', async () => {
    const state      = makeState();
    const orch       = makeOrch();
    const regulation = makeRegulation();
    const handler    = new TeamScoreHandler(state, orch, regulation);

    await handler.handle(makeEvent(EventTypes.ROUND_START, {}));

    expect(state.setScoreFromTeamEvent).not.toHaveBeenCalled();
    expect(state.setMatchConfig).not.toHaveBeenCalled();
    expect(orch.push).not.toHaveBeenCalled();
  });
});
